// Lambda for pricing verification system
// DynamoDB tables: toolintel-pricing, toolintel-pricing-reports

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });

const PRICING_TABLE = 'toolintel-pricing';
const REPORTS_TABLE = 'toolintel-pricing-reports';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendNotification(subject, body) {
    try {
        await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: [NOTIFY_EMAIL] },
            Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: body } }
            }
        }));
    } catch (err) {
        console.error('Email failed:', err);
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
        // GET /pricing?toolSlug=X - get pricing data for a tool (public)
        if (method === 'GET' && path === '/pricing' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: PRICING_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            const items = result.Items || [];
            const current = items.find(i => i.recordType === 'CURRENT');
            const history = items.filter(i => i.recordType.startsWith('HISTORY#'))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            // Check if stale (> 90 days)
            const isStale = current && current.verifiedAt 
                ? (Date.now() - new Date(current.verifiedAt).getTime()) > (90 * 24 * 60 * 60 * 1000)
                : true;
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    current: current || null, 
                    history, 
                    isStale,
                    daysSinceVerification: current?.verifiedAt 
                        ? Math.floor((Date.now() - new Date(current.verifiedAt).getTime()) / (24 * 60 * 60 * 1000))
                        : null
                }) 
            };
        }

        // GET /pricing/admin/stale - get all tools with stale pricing (admin)
        if (method === 'GET' && path === '/pricing/admin/stale') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({
                TableName: PRICING_TABLE,
                FilterExpression: 'recordType = :current',
                ExpressionAttributeValues: { ':current': 'CURRENT' }
            }));
            
            const now = Date.now();
            const ninetyDays = 90 * 24 * 60 * 60 * 1000;
            
            const staleTools = (result.Items || [])
                .map(item => ({
                    ...item,
                    daysSinceVerification: item.verifiedAt 
                        ? Math.floor((now - new Date(item.verifiedAt).getTime()) / (24 * 60 * 60 * 1000))
                        : 999,
                    isStale: !item.verifiedAt || (now - new Date(item.verifiedAt).getTime()) > ninetyDays
                }))
                .filter(item => item.isStale)
                .sort((a, b) => b.daysSinceVerification - a.daysSinceVerification);
            
            return { statusCode: 200, headers, body: JSON.stringify(staleTools) };
        }

        // GET /pricing/reports/admin - get pricing change reports (admin)
        if (method === 'GET' && path === '/pricing/reports/admin') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: REPORTS_TABLE }));
            const items = (result.Items || []).sort((a, b) => 
                new Date(b.submittedAt) - new Date(a.submittedAt)
            );
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        // POST /pricing/report - submit pricing change report (public)
        if (method === 'POST' && path === '/pricing/report') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, toolName, submitterName, submitterEmail, tierAffected, oldPrice, newPrice, sourceUrl } = body;
            
            const required = { toolSlug, submitterName, submitterEmail, tierAffected, oldPrice, newPrice, sourceUrl };
            const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing: ${missing.join(', ')}` }) };
            }
            
            if (!isValidEmail(submitterEmail)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                toolSlug,
                toolName: toolName || toolSlug,
                submitterName,
                submitterEmail,
                tierAffected,
                oldPrice,
                newPrice,
                sourceUrl,
                status: 'pending',
                submittedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: REPORTS_TABLE, Item: item }));
            
            // Calculate change percentage
            const oldNum = parseFloat(oldPrice.replace(/[^0-9.]/g, '')) || 0;
            const newNum = parseFloat(newPrice.replace(/[^0-9.]/g, '')) || 0;
            const pctChange = oldNum > 0 ? ((newNum - oldNum) / oldNum * 100).toFixed(1) : 'N/A';
            
            await sendNotification(
                `[ToolIntel] Pricing Change Report: ${toolName || toolSlug}`,
                `New pricing change report submitted.

Tool: ${toolName || toolSlug} (${toolSlug})
Tier: ${tierAffected}
Old Price: ${oldPrice}
New Price: ${newPrice}
Change: ${pctChange}%

Source: ${sourceUrl}
Reported by: ${submitterName} (${submitterEmail})

Review: https://toolintel.ai/admin/pricing.html?key=${ADMIN_KEY}
`
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: item.id }) };
        }

        // PATCH /pricing/report/:id - update report status (admin)
        if (method === 'PATCH' && path.match(/^\/pricing\/report\/[^/]+$/)) {
            const id = path.split('/').pop();
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: REPORTS_TABLE,
                Key: { id },
                UpdateExpression: 'SET #status = :status, reviewedAt = :now',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':status': body.status, ':now': new Date().toISOString() }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /pricing/admin/update - update pricing for a tool (admin)
        if (method === 'POST' && path === '/pricing/admin/update') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, vendorUrl, tiers } = body;
            // tiers = [{ name, price, features, hiddenCosts }]
            
            if (!toolSlug || !tiers || !Array.isArray(tiers)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and tiers required' }) };
            }
            
            // Get current pricing to log history
            const currentResult = await ddb.send(new GetCommand({
                TableName: PRICING_TABLE,
                Key: { toolSlug, recordType: 'CURRENT' }
            }));
            
            const oldPricing = currentResult.Item;
            const now = new Date().toISOString();
            
            // If there's old pricing, log what changed
            if (oldPricing && body.changeDescription) {
                const historyItem = {
                    toolSlug,
                    recordType: `HISTORY#${now}`,
                    date: now,
                    changeDescription: body.changeDescription,
                    percentageChange: body.percentageChange || null,
                    oldTiers: oldPricing.tiers,
                    newTiers: tiers
                };
                await ddb.send(new PutCommand({ TableName: PRICING_TABLE, Item: historyItem }));
            }
            
            // Update current pricing
            const currentItem = {
                toolSlug,
                recordType: 'CURRENT',
                toolName: toolName || toolSlug,
                vendorUrl: vendorUrl || '',
                tiers,
                verifiedAt: now,
                updatedAt: now
            };
            
            await ddb.send(new PutCommand({ TableName: PRICING_TABLE, Item: currentItem }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /pricing/admin/verify - mark pricing as verified without changes (admin)
        if (method === 'POST' && path === '/pricing/admin/verify') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug } = body;
            if (!toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: PRICING_TABLE,
                Key: { toolSlug, recordType: 'CURRENT' },
                UpdateExpression: 'SET verifiedAt = :now',
                ExpressionAttributeValues: { ':now': new Date().toISOString() }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /pricing/admin/init - initialize pricing for a tool (admin)
        if (method === 'POST' && path === '/pricing/admin/init') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, vendorUrl, tiers } = body;
            
            if (!toolSlug || !tiers) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and tiers required' }) };
            }
            
            const now = new Date().toISOString();
            
            // Create current pricing
            await ddb.send(new PutCommand({
                TableName: PRICING_TABLE,
                Item: {
                    toolSlug,
                    recordType: 'CURRENT',
                    toolName: toolName || toolSlug,
                    vendorUrl: vendorUrl || '',
                    tiers,
                    verifiedAt: now,
                    updatedAt: now
                }
            }));
            
            // Create initial history entry
            await ddb.send(new PutCommand({
                TableName: PRICING_TABLE,
                Item: {
                    toolSlug,
                    recordType: `HISTORY#${now}`,
                    date: now,
                    changeDescription: 'Initial pricing recorded',
                    percentageChange: null
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
