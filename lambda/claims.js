// Lambda for Marketing Claim Verification System
// DynamoDB tables: toolintel-claims, toolintel-claim-submissions, toolintel-claim-evidence, toolintel-claim-changes

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });

const CLAIMS_TABLE = 'toolintel-claims';
const SUBMISSIONS_TABLE = 'toolintel-claim-submissions';
const EVIDENCE_TABLE = 'toolintel-claim-evidence';
const CHANGES_TABLE = 'toolintel-claim-changes';

const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendNotification(subject, body, to = NOTIFY_EMAIL) {
    try {
        await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
            Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: body } }
            }
        }));
    } catch (err) {
        console.error('Email failed:', err);
    }
}

// Calculate summary badge status
function calculateBadgeStatus(claims) {
    if (!claims || claims.length === 0) return { status: 'none', label: 'No Claims Tested' };
    
    const hasUnverifiedOrFalse = claims.some(c => c.verdict === 'false' || c.verdict === 'unverified');
    const hasPartial = claims.some(c => c.verdict === 'partial');
    const allVerified = claims.every(c => c.verdict === 'verified');
    
    if (hasUnverifiedOrFalse) {
        return { status: 'red', label: 'Unverified or False Claims Detected', color: '#ef4444' };
    } else if (hasPartial) {
        return { status: 'yellow', label: 'Some Claims Partially Verified', color: '#f59e0b' };
    } else if (allVerified) {
        return { status: 'green', label: 'All Tested Claims Verified', color: '#10b981' };
    }
    return { status: 'none', label: 'Claims Under Review' };
}

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // ===== PUBLIC ENDPOINTS =====

        // GET /claims?toolSlug=X - get all verified claims for a tool
        if (method === 'GET' && path === '/claims' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: CLAIMS_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                FilterExpression: '#status = :published',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':slug': query.toolSlug, ':published': 'published' }
            }));
            
            const claims = (result.Items || []).sort((a, b) => 
                new Date(b.testedAt) - new Date(a.testedAt)
            );
            
            const badge = calculateBadgeStatus(claims);
            const unverifiedOrFalse = claims.filter(c => c.verdict === 'false' || c.verdict === 'unverified');
            
            // Get claim changes for this tool
            let changes = [];
            try {
                const changesResult = await ddb.send(new QueryCommand({
                    TableName: CHANGES_TABLE,
                    KeyConditionExpression: 'toolSlug = :slug',
                    ExpressionAttributeValues: { ':slug': query.toolSlug }
                }));
                changes = (changesResult.Items || []).sort((a, b) => 
                    new Date(b.detectedAt) - new Date(a.detectedAt)
                );
            } catch (e) { /* table may be empty */ }
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    claims,
                    badge,
                    unverifiedOrFalse,
                    changes,
                    totalClaims: claims.length,
                    verifiedCount: claims.filter(c => c.verdict === 'verified').length,
                    falseCount: claims.filter(c => c.verdict === 'false').length
                }) 
            };
        }

        // GET /claims/contested - most contested claims across all tools
        if (method === 'GET' && path === '/claims/contested') {
            // Get all submissions grouped by claim
            const subsResult = await ddb.send(new ScanCommand({ TableName: SUBMISSIONS_TABLE }));
            const submissions = subsResult.Items || [];
            
            // Count submissions per claim
            const claimCounts = {};
            for (const sub of submissions) {
                const key = `${sub.toolSlug}#${sub.claimText}`;
                if (!claimCounts[key]) {
                    claimCounts[key] = {
                        toolSlug: sub.toolSlug,
                        toolName: sub.toolName,
                        claimText: sub.claimText,
                        count: 0,
                        status: 'pending'
                    };
                }
                claimCounts[key].count++;
            }
            
            // Get published claims to update status
            const claimsResult = await ddb.send(new ScanCommand({
                TableName: CLAIMS_TABLE,
                FilterExpression: '#status = :published',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':published': 'published' }
            }));
            
            for (const claim of claimsResult.Items || []) {
                const key = `${claim.toolSlug}#${claim.claimText}`;
                if (claimCounts[key]) {
                    claimCounts[key].status = claim.verdict;
                    claimCounts[key].claimId = claim.claimId;
                }
            }
            
            // Sort by count descending
            const contested = Object.values(claimCounts)
                .filter(c => c.count >= 1)
                .sort((a, b) => b.count - a.count)
                .slice(0, 50);
            
            return { statusCode: 200, headers, body: JSON.stringify({ contested }) };
        }

        // GET /claims/detail?claimId=X&toolSlug=Y - get detailed claim with evidence
        if (method === 'GET' && path === '/claims/detail' && query.claimId && query.toolSlug) {
            const claimResult = await ddb.send(new GetCommand({
                TableName: CLAIMS_TABLE,
                Key: { toolSlug: query.toolSlug, claimId: query.claimId }
            }));
            
            if (!claimResult.Item) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Claim not found' }) };
            }
            
            // Get evidence submissions
            const evidenceResult = await ddb.send(new QueryCommand({
                TableName: EVIDENCE_TABLE,
                KeyConditionExpression: 'claimId = :id',
                ExpressionAttributeValues: { ':id': query.claimId }
            }));
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    claim: claimResult.Item,
                    evidence: evidenceResult.Items || []
                }) 
            };
        }

        // POST /claims/submit - community submission to flag a claim
        if (method === 'POST' && path === '/claims/submit') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, toolName, claimText, claimUrl, reasoning, submitterName, submitterEmail } = body;
            
            const required = { toolSlug, claimText, reasoning, submitterName, submitterEmail };
            const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing: ${missing.join(', ')}` }) };
            }
            
            if (!isValidEmail(submitterEmail)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email. Professional email required.' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                toolSlug,
                toolName: toolName || toolSlug,
                claimText,
                claimUrl: claimUrl || null,
                reasoning,
                submitterName,
                submitterEmail,
                status: 'pending',
                submittedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: SUBMISSIONS_TABLE, Item: item }));
            
            await sendNotification(
                `[ToolIntel] Claim Flagged: ${toolName || toolSlug}`,
                `New marketing claim flagged for review.

Tool: ${toolName || toolSlug}
Claim: "${claimText}"
Source: ${claimUrl || 'Not provided'}

Reasoning:
${reasoning}

Submitted by: ${submitterName} (${submitterEmail})

Review: https://toolintel.ai/admin/claims.html?key=${ADMIN_KEY}
`
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: item.id }) };
        }

        // POST /claims/evidence - vendor evidence submission
        if (method === 'POST' && path === '/claims/evidence') {
            const body = JSON.parse(event.body || '{}');
            const { claimId, toolSlug, vendorName, vendorEmail, evidenceType, evidenceDescription, evidenceUrl } = body;
            
            const required = { claimId, toolSlug, vendorName, vendorEmail, evidenceDescription };
            const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing: ${missing.join(', ')}` }) };
            }
            
            if (!isValidEmail(vendorEmail)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
            }
            
            const item = {
                claimId,
                submissionId: crypto.randomUUID(),
                toolSlug,
                vendorName,
                vendorEmail,
                evidenceType: evidenceType || 'documentation',
                evidenceDescription,
                evidenceUrl: evidenceUrl || null,
                status: 'pending',
                submittedAt: new Date().toISOString(),
                reviewedAt: null,
                reviewNotes: null,
                decision: null
            };
            
            await ddb.send(new PutCommand({ TableName: EVIDENCE_TABLE, Item: item }));
            
            // Get claim details
            const claimResult = await ddb.send(new GetCommand({
                TableName: CLAIMS_TABLE,
                Key: { toolSlug, claimId }
            }));
            
            await sendNotification(
                `[ToolIntel] Vendor Evidence Submitted: ${toolSlug}`,
                `Vendor submitted evidence for a claim.

Tool: ${toolSlug}
Claim: "${claimResult.Item?.claimText || 'Unknown'}"
Current Verdict: ${claimResult.Item?.verdict || 'Unknown'}

Evidence Type: ${evidenceType || 'documentation'}
Description: ${evidenceDescription}
URL: ${evidenceUrl || 'None'}

Submitted by: ${vendorName} (${vendorEmail})

Review: https://toolintel.ai/admin/claims.html?key=${ADMIN_KEY}
`
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
        }

        // ===== ADMIN ENDPOINTS =====

        // GET /claims/admin/queue - get claims queue for review
        if (method === 'GET' && path === '/claims/admin/queue') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            // Get pending submissions
            const subsResult = await ddb.send(new ScanCommand({
                TableName: SUBMISSIONS_TABLE,
                FilterExpression: '#status = :pending',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':pending': 'pending' }
            }));
            
            // Group by claim text to count duplicates
            const grouped = {};
            for (const sub of subsResult.Items || []) {
                const key = `${sub.toolSlug}#${sub.claimText}`;
                if (!grouped[key]) {
                    grouped[key] = { ...sub, submissionCount: 0, submissions: [] };
                }
                grouped[key].submissionCount++;
                grouped[key].submissions.push(sub);
            }
            
            // Sort by submission count (most reported first)
            const queue = Object.values(grouped).sort((a, b) => b.submissionCount - a.submissionCount);
            
            // Get pending evidence submissions
            const evidenceResult = await ddb.send(new ScanCommand({
                TableName: EVIDENCE_TABLE,
                FilterExpression: '#status = :pending',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':pending': 'pending' }
            }));
            
            // Get all draft claims (not yet published)
            const draftsResult = await ddb.send(new ScanCommand({
                TableName: CLAIMS_TABLE,
                FilterExpression: '#status = :draft',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':draft': 'draft' }
            }));
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    communitySubmissions: queue,
                    pendingEvidence: evidenceResult.Items || [],
                    draftClaims: draftsResult.Items || []
                }) 
            };
        }

        // GET /claims/admin/all - get all claims for a tool (including drafts)
        if (method === 'GET' && path === '/claims/admin/all') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            if (!query.toolSlug) {
                // Return all claims across all tools
                const result = await ddb.send(new ScanCommand({ TableName: CLAIMS_TABLE }));
                return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
            }
            
            const result = await ddb.send(new QueryCommand({
                TableName: CLAIMS_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
        }

        // POST /claims/admin/create - create a new claim to test
        if (method === 'POST' && path === '/claims/admin/create') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, claimText, claimSource, claimType, priority } = body;
            
            if (!toolSlug || !claimText) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and claimText required' }) };
            }
            
            const claimId = crypto.randomUUID();
            
            await ddb.send(new PutCommand({
                TableName: CLAIMS_TABLE,
                Item: {
                    toolSlug,
                    claimId,
                    toolName: toolName || toolSlug,
                    claimText,
                    claimSource: claimSource || null,
                    claimType: claimType || 'performance',
                    priority: priority || 'normal',
                    status: 'draft',
                    verdict: null,
                    evidence: null,
                    methodology: null,
                    testedAt: null,
                    createdAt: new Date().toISOString()
                }
            }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, claimId }) };
        }

        // PATCH /claims/admin/update - update claim with test results
        if (method === 'PATCH' && path === '/claims/admin/update') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, claimId, verdict, evidence, methodology, publish } = body;
            
            if (!toolSlug || !claimId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and claimId required' }) };
            }
            
            const updates = [];
            const values = {};
            const names = {};
            
            if (verdict) {
                updates.push('#verdict = :verdict');
                names['#verdict'] = 'verdict';
                values[':verdict'] = verdict;
            }
            if (evidence) {
                updates.push('evidence = :evidence');
                values[':evidence'] = evidence;
            }
            if (methodology) {
                updates.push('methodology = :methodology');
                values[':methodology'] = methodology;
            }
            if (publish) {
                updates.push('#status = :published');
                updates.push('testedAt = :now');
                names['#status'] = 'status';
                values[':published'] = 'published';
                values[':now'] = new Date().toISOString();
            }
            
            if (updates.length === 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nothing to update' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: CLAIMS_TABLE,
                Key: { toolSlug, claimId },
                UpdateExpression: 'SET ' + updates.join(', '),
                ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
                ExpressionAttributeValues: values
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // PATCH /claims/admin/submission - update submission status
        if (method === 'PATCH' && path === '/claims/admin/submission') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { id, status } = body;
            
            await ddb.send(new UpdateCommand({
                TableName: SUBMISSIONS_TABLE,
                Key: { id },
                UpdateExpression: 'SET #status = :status, reviewedAt = :now',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':status': status, ':now': new Date().toISOString() }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // PATCH /claims/admin/evidence - review vendor evidence
        if (method === 'PATCH' && path === '/claims/admin/evidence') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { claimId, submissionId, decision, reviewNotes, newVerdict } = body;
            
            // Update evidence record
            await ddb.send(new UpdateCommand({
                TableName: EVIDENCE_TABLE,
                Key: { claimId, submissionId },
                UpdateExpression: 'SET #status = :reviewed, decision = :decision, reviewNotes = :notes, reviewedAt = :now',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { 
                    ':reviewed': 'reviewed', 
                    ':decision': decision,
                    ':notes': reviewNotes || null,
                    ':now': new Date().toISOString()
                }
            }));
            
            // If verdict changed, update the claim
            if (newVerdict) {
                // Get the claim first to find toolSlug
                const evidenceResult = await ddb.send(new GetCommand({
                    TableName: EVIDENCE_TABLE,
                    Key: { claimId, submissionId }
                }));
                
                const toolSlug = evidenceResult.Item?.toolSlug;
                if (toolSlug) {
                    await ddb.send(new UpdateCommand({
                        TableName: CLAIMS_TABLE,
                        Key: { toolSlug, claimId },
                        UpdateExpression: 'SET #verdict = :verdict, lastReviewedAt = :now',
                        ExpressionAttributeNames: { '#verdict': 'verdict' },
                        ExpressionAttributeValues: { ':verdict': newVerdict, ':now': new Date().toISOString() }
                    }));
                }
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /claims/admin/change - log a claim change (vendor modified/removed claim)
        if (method === 'POST' && path === '/claims/admin/change') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, claimId, originalClaim, changeType, claimPublishedDate, verdictPublishedDate, changeDetectedDate, notes } = body;
            
            if (!toolSlug || !originalClaim || !changeType) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, originalClaim, and changeType required' }) };
            }
            
            await ddb.send(new PutCommand({
                TableName: CHANGES_TABLE,
                Item: {
                    toolSlug,
                    changeId: crypto.randomUUID(),
                    claimId: claimId || null,
                    originalClaim,
                    changeType, // 'removed' | 'modified'
                    claimPublishedDate: claimPublishedDate || null,
                    verdictPublishedDate: verdictPublishedDate || null,
                    detectedAt: changeDetectedDate || new Date().toISOString(),
                    notes: notes || null
                }
            }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
