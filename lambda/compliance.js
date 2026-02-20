// Lambda for Regulatory Fit Filter System
// Handles compliance data, filtering, saved profiles, and verification queue

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand, BatchWriteCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const COMPLIANCE_TABLE = 'toolintel-compliance';
const PROFILES_TABLE = 'toolintel-compliance-profiles';
const ANALYTICS_TABLE = 'toolintel-compliance-search-analytics';

const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// All compliance items with categories
const COMPLIANCE_ITEMS = {
    // Data Privacy
    gdpr: { id: 'gdpr', name: 'GDPR Compliant', category: 'privacy', region: 'EU' },
    ccpa: { id: 'ccpa', name: 'CCPA Compliant', category: 'privacy', region: 'US-CA' },
    pipeda: { id: 'pipeda', name: 'PIPEDA Compliant', category: 'privacy', region: 'Canada' },
    pdpa: { id: 'pdpa', name: 'PDPA Compliant', category: 'privacy', region: 'Singapore' },
    lgpd: { id: 'lgpd', name: 'LGPD Compliant', category: 'privacy', region: 'Brazil' },
    
    // Healthcare
    hipaa: { id: 'hipaa', name: 'HIPAA BAA Available', category: 'healthcare' },
    hitrust: { id: 'hitrust', name: 'HITRUST Certified', category: 'healthcare' },
    fda21: { id: 'fda21', name: 'FDA 21 CFR Part 11', category: 'healthcare' },
    ferpa: { id: 'ferpa', name: 'FERPA Compliant', category: 'education' },
    coppa: { id: 'coppa', name: 'COPPA Compliant', category: 'education' },
    
    // Security
    soc2: { id: 'soc2', name: 'SOC 2 Type II Certified', category: 'security' },
    iso27001: { id: 'iso27001', name: 'ISO 27001 Certified', category: 'security' },
    fedramp: { id: 'fedramp', name: 'FedRAMP Authorized', category: 'security' },
    stateramp: { id: 'stateramp', name: 'StateRAMP Authorized', category: 'security' },
    pcidss: { id: 'pcidss', name: 'PCI DSS Compliant', category: 'security' },
    
    // AI Specific
    euaiact: { id: 'euaiact', name: 'EU AI Act Conformity', category: 'ai' },
    nistai: { id: 'nistai', name: 'NIST AI RMF Aligned', category: 'ai' },
    ieeeai: { id: 'ieeeai', name: 'IEEE AI Ethics Certified', category: 'ai' }
};

// Industry presets
const INDUSTRY_PRESETS = {
    healthcare: {
        name: 'Healthcare',
        items: ['hipaa', 'soc2', 'hitrust'],
        description: 'Recommended minimum compliance requirements for healthcare organizations handling protected health information.'
    },
    financial: {
        name: 'Financial Services',
        items: ['soc2', 'pcidss', 'gdpr', 'ccpa'],
        description: 'Recommended compliance requirements for financial institutions handling sensitive financial data.'
    },
    legal: {
        name: 'Legal',
        items: ['soc2', 'gdpr', 'ccpa', 'iso27001'],
        description: 'Recommended compliance for law firms and legal departments handling privileged information.'
    },
    government: {
        name: 'Government',
        items: ['fedramp', 'stateramp', 'soc2'],
        description: 'Required compliance for US federal and state government agencies.'
    },
    education: {
        name: 'Education',
        items: ['ferpa', 'coppa', 'soc2'],
        description: 'Required compliance for educational institutions handling student data.'
    },
    enterprise: {
        name: 'General Enterprise',
        items: ['soc2', 'gdpr', 'iso27001'],
        description: 'Standard enterprise compliance baseline for most business applications.'
    }
};

function generateId(length = 12) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// Track search analytics for verification prioritization
async function trackSearchHit(toolSlug) {
    try {
        await ddb.send(new UpdateCommand({
            TableName: ANALYTICS_TABLE,
            Key: { toolSlug },
            UpdateExpression: 'SET searchHits = if_not_exists(searchHits, :zero) + :one, lastSearched = :now',
            ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': new Date().toISOString() }
        }));
    } catch (e) {
        console.error('Failed to track search:', e);
    }
}

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /compliance/items - get all compliance item definitions
        if (method === 'GET' && path === '/compliance/items') {
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    items: COMPLIANCE_ITEMS,
                    presets: INDUSTRY_PRESETS
                }) 
            };
        }

        // GET /compliance/all - get compliance data for all tools
        if (method === 'GET' && path === '/compliance/all') {
            const result = await ddb.send(new ScanCommand({ TableName: COMPLIANCE_TABLE }));
            const items = result.Items || [];
            
            // Group by tool
            const byTool = {};
            for (const item of items) {
                if (!byTool[item.toolSlug]) {
                    byTool[item.toolSlug] = {
                        toolSlug: item.toolSlug,
                        toolName: item.toolName,
                        compliance: {}
                    };
                }
                byTool[item.toolSlug].compliance[item.complianceId] = {
                    status: item.status, // 'verified' | 'vendor_reported' | 'expired' | 'none'
                    verifiedAt: item.verifiedAt,
                    expiresAt: item.expiresAt,
                    issuer: item.issuer,
                    notes: item.notes
                };
            }
            
            // Count tools per compliance item
            const counts = {};
            Object.keys(COMPLIANCE_ITEMS).forEach(id => counts[id] = 0);
            
            for (const tool of Object.values(byTool)) {
                for (const [compId, comp] of Object.entries(tool.compliance)) {
                    if (comp.status === 'verified' || comp.status === 'vendor_reported') {
                        counts[compId] = (counts[compId] || 0) + 1;
                    }
                }
            }
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    tools: Object.values(byTool),
                    counts
                }) 
            };
        }

        // GET /compliance/tool?toolSlug=X - get compliance for one tool
        if (method === 'GET' && path === '/compliance/tool' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: COMPLIANCE_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            const compliance = {};
            for (const item of result.Items || []) {
                compliance[item.complianceId] = {
                    status: item.status,
                    verifiedAt: item.verifiedAt,
                    expiresAt: item.expiresAt,
                    issuer: item.issuer,
                    notes: item.notes
                };
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ compliance }) };
        }

        // POST /compliance/filter - filter tools by compliance (and track analytics)
        if (method === 'POST' && path === '/compliance/filter') {
            const body = JSON.parse(event.body || '{}');
            const { requirements } = body; // Array of compliance IDs
            
            if (!requirements || requirements.length === 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'requirements array required' }) };
            }
            
            // Get all compliance data
            const result = await ddb.send(new ScanCommand({ TableName: COMPLIANCE_TABLE }));
            const items = result.Items || [];
            
            // Group by tool
            const byTool = {};
            for (const item of items) {
                if (!byTool[item.toolSlug]) {
                    byTool[item.toolSlug] = {
                        toolSlug: item.toolSlug,
                        toolName: item.toolName,
                        compliance: {}
                    };
                }
                byTool[item.toolSlug].compliance[item.complianceId] = item.status;
            }
            
            // Filter and categorize
            const fullMatch = [];
            const partialMatch = [];
            
            for (const tool of Object.values(byTool)) {
                const met = [];
                const missing = [];
                
                for (const req of requirements) {
                    const status = tool.compliance[req];
                    if (status === 'verified' || status === 'vendor_reported') {
                        met.push(req);
                    } else {
                        missing.push(req);
                    }
                }
                
                if (met.length === requirements.length) {
                    fullMatch.push({ ...tool, met, missing: [] });
                } else if (met.length > 0) {
                    partialMatch.push({ ...tool, met, missing });
                }
                
                // Track search hit for this tool
                if (met.length > 0) {
                    await trackSearchHit(tool.toolSlug);
                }
            }
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    fullMatch,
                    partialMatch,
                    totalMatches: fullMatch.length + partialMatch.length
                }) 
            };
        }

        // POST /compliance/profile - save compliance profile
        if (method === 'POST' && path === '/compliance/profile') {
            const body = JSON.parse(event.body || '{}');
            const { visitorId, profileName, requirements } = body;
            
            if (!visitorId || !profileName || !requirements) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'visitorId, profileName, and requirements required' }) };
            }
            
            const profileId = generateId(8);
            
            await ddb.send(new PutCommand({
                TableName: PROFILES_TABLE,
                Item: {
                    visitorId,
                    profileId,
                    profileName,
                    requirements,
                    createdAt: new Date().toISOString()
                }
            }));
            
            return { 
                statusCode: 201, 
                headers, 
                body: JSON.stringify({ 
                    success: true, 
                    profileId,
                    shareUrl: `https://toolintel.ai/reviews.html?profile=${profileId}`
                }) 
            };
        }

        // GET /compliance/profile/:id - get a shared profile
        if (method === 'GET' && path.match(/^\/compliance\/profile\/[^/]+$/)) {
            const profileId = path.split('/').pop();
            
            // Scan for profile (since we don't know the visitorId)
            const result = await ddb.send(new ScanCommand({
                TableName: PROFILES_TABLE,
                FilterExpression: 'profileId = :pid',
                ExpressionAttributeValues: { ':pid': profileId }
            }));
            
            if (!result.Items || result.Items.length === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Profile not found' }) };
            }
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Items[0]) };
        }

        // GET /compliance/profiles?visitorId=X - get user's saved profiles
        if (method === 'GET' && path === '/compliance/profiles' && query.visitorId) {
            const result = await ddb.send(new QueryCommand({
                TableName: PROFILES_TABLE,
                KeyConditionExpression: 'visitorId = :vid',
                ExpressionAttributeValues: { ':vid': query.visitorId }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
        }

        // ===== ADMIN ENDPOINTS =====

        // POST /compliance/admin/set - set compliance status for a tool
        if (method === 'POST' && path === '/compliance/admin/set') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, complianceId, status, verifiedAt, expiresAt, issuer, notes } = body;
            
            if (!toolSlug || !complianceId || !status) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, complianceId, and status required' }) };
            }
            
            await ddb.send(new PutCommand({
                TableName: COMPLIANCE_TABLE,
                Item: {
                    toolSlug,
                    complianceId,
                    toolName: toolName || toolSlug,
                    status, // 'verified' | 'vendor_reported' | 'expired' | 'none'
                    verifiedAt: verifiedAt || (status === 'verified' ? new Date().toISOString() : null),
                    expiresAt: expiresAt || null,
                    issuer: issuer || null,
                    notes: notes || null,
                    updatedAt: new Date().toISOString()
                }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /compliance/admin/bulk - bulk set compliance for a tool
        if (method === 'POST' && path === '/compliance/admin/bulk') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, items } = body;
            // items = [{ complianceId, status, verifiedAt?, expiresAt?, issuer?, notes? }]
            
            if (!toolSlug || !items || !Array.isArray(items)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and items array required' }) };
            }
            
            const now = new Date().toISOString();
            
            for (const item of items) {
                await ddb.send(new PutCommand({
                    TableName: COMPLIANCE_TABLE,
                    Item: {
                        toolSlug,
                        complianceId: item.complianceId,
                        toolName: toolName || toolSlug,
                        status: item.status,
                        verifiedAt: item.verifiedAt || (item.status === 'verified' ? now : null),
                        expiresAt: item.expiresAt || null,
                        issuer: item.issuer || null,
                        notes: item.notes || null,
                        updatedAt: now
                    }
                }));
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, count: items.length }) };
        }

        // GET /compliance/admin/queue - verification queue (vendor-reported, sorted by search hits)
        if (method === 'GET' && path === '/compliance/admin/queue') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            // Get all compliance items with vendor_reported status
            const compResult = await ddb.send(new ScanCommand({
                TableName: COMPLIANCE_TABLE,
                FilterExpression: '#status = :vendor',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':vendor': 'vendor_reported' }
            }));
            
            // Get search analytics
            const analyticsResult = await ddb.send(new ScanCommand({ TableName: ANALYTICS_TABLE }));
            const searchHits = {};
            for (const item of analyticsResult.Items || []) {
                searchHits[item.toolSlug] = item.searchHits || 0;
            }
            
            // Group by tool and add search hits
            const byTool = {};
            for (const item of compResult.Items || []) {
                if (!byTool[item.toolSlug]) {
                    byTool[item.toolSlug] = {
                        toolSlug: item.toolSlug,
                        toolName: item.toolName,
                        searchHits: searchHits[item.toolSlug] || 0,
                        unverifiedItems: []
                    };
                }
                byTool[item.toolSlug].unverifiedItems.push({
                    complianceId: item.complianceId,
                    name: COMPLIANCE_ITEMS[item.complianceId]?.name || item.complianceId
                });
            }
            
            // Sort by search hits
            const queue = Object.values(byTool).sort((a, b) => b.searchHits - a.searchHits);
            
            return { statusCode: 200, headers, body: JSON.stringify({ queue }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
