// Lambda for Procurement Intelligence Pack System
// Generates professional PDF packs with all review data

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const s3 = new S3Client({ region: 'us-east-1' });

const PACKS_TABLE = 'toolintel-procurement-packs';
const ANALYTICS_TABLE = 'toolintel-procurement-analytics';
const USERS_TABLE = 'toolintel-procurement-users';
const S3_BUCKET = 'toolintel-procurement-packs';

const PRICING_TABLE = 'toolintel-pricing';
const CLAIMS_TABLE = 'toolintel-claims';

const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Generate unique ID
function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

// Get current month key for analytics
function getMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Track download analytics
async function trackDownload(toolSlug, packType, sections) {
    const monthKey = getMonthKey();
    
    try {
        // Update tool-month counter
        await ddb.send(new UpdateCommand({
            TableName: ANALYTICS_TABLE,
            Key: { toolSlug, monthKey },
            UpdateExpression: 'SET downloads = if_not_exists(downloads, :zero) + :one, lastDownload = :now, toolName = if_not_exists(toolName, :name)',
            ExpressionAttributeValues: { 
                ':zero': 0, 
                ':one': 1, 
                ':now': new Date().toISOString(),
                ':name': toolSlug
            }
        }));
        
        // Track section usage for custom packs
        if (sections && sections.length > 0) {
            for (const section of sections) {
                await ddb.send(new UpdateCommand({
                    TableName: ANALYTICS_TABLE,
                    Key: { toolSlug: `_sections_${monthKey}`, monthKey: section },
                    UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one',
                    ExpressionAttributeNames: { '#count': 'count' },
                    ExpressionAttributeValues: { ':zero': 0, ':one': 1 }
                }));
            }
        }
    } catch (e) {
        console.error('Analytics tracking failed:', e);
    }
}

// Check if visitor has already downloaded (for free tier gating)
async function checkVisitorDownloads(visitorId) {
    try {
        const result = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { visitorId }
        }));
        return result.Item?.downloadCount || 0;
    } catch (e) {
        return 0;
    }
}

// Increment visitor download count
async function incrementVisitorDownload(visitorId) {
    try {
        await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { visitorId },
            UpdateExpression: 'SET downloadCount = if_not_exists(downloadCount, :zero) + :one, lastDownload = :now',
            ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': new Date().toISOString() }
        }));
    } catch (e) {
        console.error('Failed to track visitor:', e);
    }
}

// Fetch all tool data for the pack
async function fetchToolData(toolSlug) {
    const data = {
        toolSlug,
        pricing: null,
        claims: [],
        lastUpdated: null
    };
    
    // Fetch pricing
    try {
        const pricingResult = await ddb.send(new QueryCommand({
            TableName: PRICING_TABLE,
            KeyConditionExpression: 'toolSlug = :slug',
            ExpressionAttributeValues: { ':slug': toolSlug }
        }));
        
        const items = pricingResult.Items || [];
        data.pricing = items.find(i => i.recordType === 'CURRENT');
        data.pricingHistory = items.filter(i => i.recordType?.startsWith('HISTORY#'));
        
        if (data.pricing?.verifiedAt) {
            data.lastUpdated = data.pricing.verifiedAt;
        }
    } catch (e) {
        console.error('Failed to fetch pricing:', e);
    }
    
    // Fetch claims
    try {
        const claimsResult = await ddb.send(new QueryCommand({
            TableName: CLAIMS_TABLE,
            KeyConditionExpression: 'toolSlug = :slug',
            FilterExpression: '#status = :published',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':slug': toolSlug, ':published': 'published' }
        }));
        data.claims = claimsResult.Items || [];
    } catch (e) {
        console.error('Failed to fetch claims:', e);
    }
    
    return data;
}

// Generate HTML for PDF (will be converted to PDF via external service or returned as HTML)
function generatePackHTML(toolData, reviewData, options = {}) {
    const now = new Date().toISOString();
    const {
        customLogo,
        customCompany,
        customNotes,
        sections = ['all'],
        isShared = false
    } = options;
    
    const includeSection = (name) => sections.includes('all') || sections.includes(name);
    
    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A';
    
    let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Procurement Intelligence Pack - ${reviewData.toolName}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, sans-serif; color: #1f2937; line-height: 1.6; font-size: 11pt; }
        
        .page { padding: 48px; max-width: 8.5in; margin: 0 auto; }
        .page-break { page-break-after: always; }
        
        h1 { font-size: 28pt; color: #0f2744; margin-bottom: 8px; }
        h2 { font-size: 16pt; color: #0f2744; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
        h3 { font-size: 12pt; color: #0f2744; margin: 16px 0 8px; }
        
        p { margin-bottom: 12px; }
        
        .cover { text-align: center; padding: 120px 48px; }
        .cover-logo { font-size: 14pt; color: #3b82f6; margin-bottom: 60px; font-weight: 700; }
        .cover-tool { font-size: 36pt; color: #0f2744; font-weight: 700; margin-bottom: 8px; }
        .cover-vendor { font-size: 14pt; color: #6b7280; margin-bottom: 40px; }
        .cover-date { font-size: 11pt; color: #9ca3af; margin-bottom: 60px; }
        .cover-disclaimer { font-size: 9pt; color: #9ca3af; max-width: 400px; margin: 0 auto; line-height: 1.5; }
        ${customLogo ? `.custom-logo { max-width: 200px; margin-bottom: 20px; }` : ''}
        ${customCompany ? `.custom-company { font-size: 12pt; color: #6b7280; margin-bottom: 40px; }` : ''}
        
        .score-ring { display: inline-block; width: 80px; height: 80px; border-radius: 50%; border: 4px solid #10b981; text-align: center; line-height: 72px; font-size: 24pt; font-weight: 700; color: #065f46; margin-right: 20px; vertical-align: middle; }
        .score-ring.yellow { border-color: #f59e0b; color: #92400e; }
        .score-ring.red { border-color: #ef4444; color: #991b1b; }
        
        .summary-text { display: inline-block; vertical-align: middle; max-width: 500px; }
        
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 10pt; }
        th { background: #f9fafb; font-weight: 600; color: #4b5563; }
        
        .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 9pt; font-weight: 500; }
        .badge.green { background: #d1fae5; color: #065f46; }
        .badge.yellow { background: #fef3c7; color: #92400e; }
        .badge.red { background: #fee2e2; color: #991b1b; }
        .badge.gray { background: #f3f4f6; color: #6b7280; }
        
        .finding { padding: 12px; background: #f9fafb; border-left: 3px solid #3b82f6; margin-bottom: 12px; }
        .finding-title { font-weight: 600; color: #0f2744; margin-bottom: 4px; }
        
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #9ca3af; text-align: center; line-height: 1.6; }
        
        .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 72pt; color: rgba(0,0,0,0.03); pointer-events: none; z-index: -1; }
        
        ${isShared ? `.shared-watermark { position: fixed; top: 20px; right: 20px; font-size: 8pt; color: #9ca3af; }` : ''}
    </style>
</head>
<body>
    ${isShared ? `<div class="shared-watermark">Generated: ${formatDate(now)} • Expires in 90 days</div>` : ''}
    
    <!-- COVER PAGE -->
    <div class="page cover">
        ${customLogo ? `<img src="${customLogo}" class="custom-logo" alt="Company Logo">` : ''}
        ${customCompany ? `<div class="custom-company">Prepared for: ${customCompany}</div>` : ''}
        <div class="cover-logo">ToolIntel</div>
        <div class="cover-tool">${reviewData.toolName}</div>
        <div class="cover-vendor">${reviewData.vendorName || 'AI Tool Review'}</div>
        <div class="cover-date">Procurement Intelligence Pack<br>Generated: ${formatDate(now)}</div>
        <div class="cover-disclaimer">This document was generated from independently verified data. ToolIntel has no financial relationship with this vendor.</div>
    </div>
    <div class="page-break"></div>
`;

    // EXECUTIVE SUMMARY
    if (includeSection('executive')) {
        const scoreClass = reviewData.score >= 80 ? '' : reviewData.score >= 60 ? 'yellow' : 'red';
        html += `
    <div class="page">
        <h2>Executive Summary</h2>
        <div style="margin: 20px 0;">
            <div class="score-ring ${scoreClass}">${reviewData.score || 'N/A'}</div>
            <div class="summary-text">
                <p><strong>${reviewData.verdict || 'Review pending.'}</strong></p>
            </div>
        </div>
        
        <h3>Key Findings</h3>
        ${(reviewData.keyFindings || ['Review data not yet available']).map(f => `
        <div class="finding">
            <div class="finding-title">${f.title || f}</div>
            ${f.description ? `<p>${f.description}</p>` : ''}
        </div>
        `).join('')}
    </div>
    <div class="page-break"></div>
`;
    }

    // SCORE BREAKDOWN
    if (includeSection('scores')) {
        html += `
    <div class="page">
        <h2>Score Breakdown</h2>
        <table>
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Score</th>
                    <th>Assessment</th>
                </tr>
            </thead>
            <tbody>
                ${(reviewData.scores || [
                    { category: 'Core AI Performance', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Data Privacy & Security', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Transparency', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Pricing Fairness', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Reliability', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Vendor Stability', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Integration', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Support Quality', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Ethical AI Practices', score: 'N/A', rationale: 'Pending evaluation' },
                    { category: 'Market Position', score: 'N/A', rationale: 'Pending evaluation' }
                ]).map(s => `
                <tr>
                    <td><strong>${s.category}</strong></td>
                    <td>${s.score}/100</td>
                    <td>${s.rationale}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    <div class="page-break"></div>
`;
    }

    // COMPLIANCE SCORECARD
    if (includeSection('compliance')) {
        html += `
    <div class="page">
        <h2>Compliance Scorecard</h2>
        <p>Regulatory fit verification for enterprise procurement.</p>
        <table>
            <thead>
                <tr>
                    <th>Regulation / Standard</th>
                    <th>Status</th>
                    <th>Notes</th>
                </tr>
            </thead>
            <tbody>
                ${(reviewData.compliance || [
                    { standard: 'SOC 2 Type II', status: 'pending', notes: 'Verification pending' },
                    { standard: 'HIPAA BAA Available', status: 'pending', notes: 'Verification pending' },
                    { standard: 'GDPR Compliant', status: 'pending', notes: 'Verification pending' },
                    { standard: 'FedRAMP', status: 'pending', notes: 'Verification pending' },
                    { standard: 'EU AI Act Ready', status: 'pending', notes: 'Verification pending' },
                    { standard: 'ISO 27001', status: 'pending', notes: 'Verification pending' }
                ]).map(c => `
                <tr>
                    <td><strong>${c.standard}</strong></td>
                    <td><span class="badge ${c.status === 'yes' ? 'green' : c.status === 'partial' ? 'yellow' : c.status === 'no' ? 'red' : 'gray'}">${c.status === 'yes' ? '✓ Yes' : c.status === 'partial' ? '◐ Partial' : c.status === 'no' ? '✗ No' : '? Pending'}</span></td>
                    <td>${c.notes || ''}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        
        <h2>Verified Certifications</h2>
        ${(reviewData.certifications && reviewData.certifications.length > 0) ? `
        <table>
            <thead>
                <tr>
                    <th>Certification</th>
                    <th>Issuing Body</th>
                    <th>Audit Date</th>
                    <th>Expiration</th>
                </tr>
            </thead>
            <tbody>
                ${reviewData.certifications.map(c => `
                <tr>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.issuer || 'N/A'}</td>
                    <td>${formatDate(c.auditDate)}</td>
                    <td>${formatDate(c.expirationDate)}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        ` : '<p><span class="badge gray">No certifications on file</span></p>'}
    </div>
    <div class="page-break"></div>
`;
    }

    // PRICING
    if (includeSection('pricing')) {
        html += `
    <div class="page">
        <h2>Current Verified Pricing</h2>
        <p style="color: #6b7280; font-size: 9pt;">Last verified: ${formatDate(toolData.pricing?.verifiedAt)}</p>
        
        ${toolData.pricing?.tiers ? `
        <table>
            <thead>
                <tr>
                    <th>Tier</th>
                    <th>Price</th>
                    <th>Features</th>
                    <th>Hidden Costs</th>
                </tr>
            </thead>
            <tbody>
                ${toolData.pricing.tiers.map(t => `
                <tr>
                    <td><strong>${t.name}</strong></td>
                    <td>${t.price}</td>
                    <td>${t.features || 'See vendor site'}</td>
                    <td>${t.hiddenCosts || 'None noted'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        ` : '<p><span class="badge gray">Pricing data not yet verified</span></p>'}
        
        ${toolData.hiddenCosts && toolData.hiddenCosts.length > 0 ? `
        <h3>Hidden Cost Log</h3>
        <ul>
            ${toolData.hiddenCosts.map(c => `<li><strong>${c.description}</strong> — Discovered: ${formatDate(c.verifiedAt)}</li>`).join('')}
        </ul>
        ` : ''}
    </div>
    <div class="page-break"></div>
`;
    }

    // SECURITY & INCIDENTS
    if (includeSection('security')) {
        html += `
    <div class="page">
        <h2>Security Incident History</h2>
        ${(reviewData.incidents && reviewData.incidents.length > 0) ? `
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Severity</th>
                    <th>Description</th>
                    <th>Resolution</th>
                </tr>
            </thead>
            <tbody>
                ${reviewData.incidents.map(i => `
                <tr>
                    <td>${formatDate(i.date)}</td>
                    <td><span class="badge ${i.severity === 'high' ? 'red' : i.severity === 'medium' ? 'yellow' : 'gray'}">${i.severity}</span></td>
                    <td>${i.description}</td>
                    <td>${i.resolution || 'N/A'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        ` : '<p><span class="badge green">✓ No verified security incidents on record</span></p>'}
        
        <h2>Uptime & Reliability</h2>
        <table>
            <tr>
                <td><strong>90-Day Uptime</strong></td>
                <td>${reviewData.uptime?.percentage || 'N/A'}%</td>
            </tr>
            <tr>
                <td><strong>Incident Count (90 days)</strong></td>
                <td>${reviewData.uptime?.incidentCount ?? 'N/A'}</td>
            </tr>
        </table>
    </div>
    <div class="page-break"></div>
`;
    }

    // POLICY CHANGES
    if (includeSection('policies')) {
        html += `
    <div class="page">
        <h2>Policy Change Summary (24 Months)</h2>
        <p>Terms of Service and Privacy Policy modifications.</p>
        ${(reviewData.policyChanges && reviewData.policyChanges.length > 0) ? `
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Policy</th>
                    <th>Change Summary</th>
                </tr>
            </thead>
            <tbody>
                ${reviewData.policyChanges.map(p => `
                <tr>
                    <td>${formatDate(p.date)}</td>
                    <td>${p.policyType}</td>
                    <td>${p.summary}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        ` : '<p><span class="badge green">✓ No significant policy changes in the past 24 months</span></p>'}
    </div>
    <div class="page-break"></div>
`;
    }

    // MARKETING CLAIMS
    if (includeSection('claims')) {
        html += `
    <div class="page">
        <h2>Marketing Claim Verification</h2>
        ${toolData.claims.length > 0 ? `
        <table>
            <thead>
                <tr>
                    <th>Claim</th>
                    <th>Verdict</th>
                    <th>Evidence</th>
                </tr>
            </thead>
            <tbody>
                ${toolData.claims.map(c => `
                <tr>
                    <td>"${c.claimText}"</td>
                    <td><span class="badge ${c.verdict === 'verified' ? 'green' : c.verdict === 'partial' ? 'yellow' : 'red'}">${c.verdict}</span></td>
                    <td>${c.evidence || 'See full review'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        ` : '<p><span class="badge gray">No marketing claims tested yet</span></p>'}
    </div>
    <div class="page-break"></div>
`;
    }

    // VENDOR RESPONSE
    if (includeSection('vendor')) {
        html += `
    <div class="page">
        <h2>Vendor Response</h2>
        ${reviewData.vendorResponse ? `
        <div style="padding: 16px; background: #f9fafb; border-radius: 8px; white-space: pre-wrap;">${reviewData.vendorResponse}</div>
        <p style="font-size: 9pt; color: #9ca3af; margin-top: 12px;">This is the vendor's unedited response to our review findings.</p>
        ` : '<p><span class="badge gray">No response submitted</span></p>'}
    </div>
    <div class="page-break"></div>
`;
    }

    // METADATA
    if (includeSection('metadata')) {
        html += `
    <div class="page">
        <h2>Review Metadata</h2>
        <table>
            <tr><td><strong>Reviewer</strong></td><td>${reviewData.reviewer || 'ToolIntel Editorial Team'}</td></tr>
            <tr><td><strong>Initial Review Date</strong></td><td>${formatDate(reviewData.reviewDate)}</td></tr>
            <tr><td><strong>Methodology Version</strong></td><td>${reviewData.methodologyVersion || 'v1.0'}</td></tr>
            <tr><td><strong>Last Updated</strong></td><td>${formatDate(reviewData.lastUpdated || toolData.lastUpdated)}</td></tr>
            <tr><td><strong>Next Scheduled Refresh</strong></td><td>${formatDate(reviewData.nextRefresh)}</td></tr>
            <tr><td><strong>Pack Generated</strong></td><td>${formatDate(now)}</td></tr>
        </table>
    </div>
`;
    }

    // CUSTOM NOTES
    if (customNotes) {
        html += `
    <div class="page-break"></div>
    <div class="page">
        <h2>Internal Notes</h2>
        <div style="padding: 16px; background: #fef3c7; border-radius: 8px; white-space: pre-wrap;">${customNotes}</div>
        <p style="font-size: 9pt; color: #9ca3af; margin-top: 12px;">These notes were added by ${customCompany || 'the requesting organization'} and are not part of the ToolIntel review.</p>
    </div>
`;
    }

    // FOOTER
    html += `
    <div class="page">
        <div class="footer">
            <p><strong>This Procurement Intelligence Pack was generated by ToolIntel — Independent AI Tool Intelligence.</strong></p>
            <p>toolintel.ai — No sponsored content. No pay-to-play. Data verified independently.</p>
            <p style="margin-top: 12px;">ToolIntel accepts no payment from vendors for reviews, rankings, or placement. Our revenue comes from subscriptions, not commissions. Full conflict of interest disclosure available at toolintel.ai/conflict-of-interest</p>
        </div>
    </div>
</body>
</html>
`;

    return html;
}

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /procurement/check - check if visitor can download free
        if (method === 'GET' && path === '/procurement/check') {
            const visitorId = query.visitorId;
            if (!visitorId) {
                return { statusCode: 200, headers, body: JSON.stringify({ canDownloadFree: true, downloads: 0 }) };
            }
            
            const downloads = await checkVisitorDownloads(visitorId);
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    canDownloadFree: downloads === 0,
                    downloads,
                    requiresAccount: downloads > 0
                }) 
            };
        }

        // GET /procurement/last-updated?toolSlug=X - get pack last updated timestamp
        if (method === 'GET' && path === '/procurement/last-updated') {
            if (!query.toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            const toolData = await fetchToolData(query.toolSlug);
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    lastUpdated: toolData.lastUpdated,
                    pricingVerified: toolData.pricing?.verifiedAt || null,
                    claimsCount: toolData.claims.length
                }) 
            };
        }

        // POST /procurement/generate - generate pack (returns HTML, frontend converts to PDF)
        if (method === 'POST' && path === '/procurement/generate') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, visitorId, reviewData, options } = body;
            
            if (!toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            // Check free tier eligibility
            if (!options?.isCustom && visitorId) {
                const downloads = await checkVisitorDownloads(visitorId);
                if (downloads > 0) {
                    return { statusCode: 403, headers, body: JSON.stringify({ 
                        error: 'Free download limit reached',
                        requiresAccount: true
                    }) };
                }
            }
            
            // Fetch tool data
            const toolData = await fetchToolData(toolSlug);
            
            // Generate HTML
            const html = generatePackHTML(toolData, reviewData || { 
                toolName: toolData.pricing?.toolName || toolSlug,
                score: null,
                verdict: 'Review data pending. Check toolintel.ai for the latest information.'
            }, options || {});
            
            // Track download
            await trackDownload(toolSlug, options?.isCustom ? 'custom' : 'standard', options?.sections);
            
            // Increment visitor count for free downloads
            if (visitorId && !options?.isCustom) {
                await incrementVisitorDownload(visitorId);
            }
            
            // Generate pack ID for potential sharing
            const packId = generateId();
            
            return { 
                statusCode: 200, 
                headers: { ...headers, 'Content-Type': 'text/html' },
                body: JSON.stringify({
                    packId,
                    html,
                    toolSlug,
                    generatedAt: new Date().toISOString()
                })
            };
        }

        // POST /procurement/share - create shareable link
        if (method === 'POST' && path === '/procurement/share') {
            const body = JSON.parse(event.body || '{}');
            const { packId, html, toolSlug, toolName } = body;
            
            if (!packId || !html) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'packId and html required' }) };
            }
            
            const shareId = generateId().slice(0, 12);
            const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
            
            // Store pack metadata
            await ddb.send(new PutCommand({
                TableName: PACKS_TABLE,
                Item: {
                    packId: shareId,
                    originalPackId: packId,
                    toolSlug,
                    toolName,
                    html,
                    createdAt: new Date().toISOString(),
                    expiresAt,
                    views: 0
                }
            }));
            
            return { 
                statusCode: 201, 
                headers, 
                body: JSON.stringify({ 
                    shareId,
                    shareUrl: `https://toolintel.ai/pack/${shareId}`,
                    expiresAt
                }) 
            };
        }

        // GET /procurement/shared/:id - get shared pack
        if (method === 'GET' && path.match(/^\/procurement\/shared\/[^/]+$/)) {
            const shareId = path.split('/').pop();
            
            const result = await ddb.send(new GetCommand({
                TableName: PACKS_TABLE,
                Key: { packId: shareId }
            }));
            
            if (!result.Item) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pack not found' }) };
            }
            
            // Check expiration
            if (new Date(result.Item.expiresAt) < new Date()) {
                return { statusCode: 410, headers, body: JSON.stringify({ error: 'Pack expired' }) };
            }
            
            // Increment view count
            await ddb.send(new UpdateCommand({
                TableName: PACKS_TABLE,
                Key: { packId: shareId },
                UpdateExpression: 'SET #views = if_not_exists(#views, :zero) + :one',
                ExpressionAttributeNames: { '#views': 'views' },
                ExpressionAttributeValues: { ':zero': 0, ':one': 1 }
            }));
            
            return { 
                statusCode: 200, 
                headers: { ...headers, 'Content-Type': 'text/html' },
                body: result.Item.html
            };
        }

        // GET /procurement/admin/analytics - admin analytics
        if (method === 'GET' && path === '/procurement/admin/analytics') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            // Get all analytics data
            const result = await ddb.send(new ScanCommand({ TableName: ANALYTICS_TABLE }));
            const items = result.Items || [];
            
            // Separate tool downloads from section counts
            const toolDownloads = items.filter(i => !i.toolSlug.startsWith('_sections_'));
            const sectionCounts = items.filter(i => i.toolSlug.startsWith('_sections_'));
            
            // Aggregate by tool
            const byTool = {};
            for (const item of toolDownloads) {
                if (!byTool[item.toolSlug]) {
                    byTool[item.toolSlug] = { toolSlug: item.toolSlug, toolName: item.toolName, total: 0, byMonth: {} };
                }
                byTool[item.toolSlug].total += item.downloads || 0;
                byTool[item.toolSlug].byMonth[item.monthKey] = item.downloads || 0;
            }
            
            // Sort by total downloads
            const topTools = Object.values(byTool).sort((a, b) => b.total - a.total);
            
            // Aggregate sections
            const sections = {};
            for (const item of sectionCounts) {
                const section = item.monthKey;
                sections[section] = (sections[section] || 0) + (item.count || 0);
            }
            const topSections = Object.entries(sections)
                .map(([section, count]) => ({ section, count }))
                .sort((a, b) => b.count - a.count);
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    topTools: topTools.slice(0, 20),
                    topSections,
                    totalDownloads: topTools.reduce((sum, t) => sum + t.total, 0)
                }) 
            };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
