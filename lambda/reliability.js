// Lambda for uptime and reliability verification system
// DynamoDB tables: toolintel-reliability, toolintel-outage-reports

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });

const RELIABILITY_TABLE = 'toolintel-reliability';
const REPORTS_TABLE = 'toolintel-outage-reports';
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
        // GET /reliability?toolSlug=X - get reliability data for a tool (public)
        if (method === 'GET' && path === '/reliability' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: RELIABILITY_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            const items = result.Items || [];
            const metrics = items.find(i => i.recordType === 'METRICS');
            const incidents = items.filter(i => i.recordType.startsWith('INCIDENT#'))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            // Calculate uptime color
            let uptimeColor = 'green';
            if (metrics?.uptime90d < 99) uptimeColor = 'yellow';
            if (metrics?.uptime90d < 95) uptimeColor = 'red';
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    metrics: metrics || null,
                    incidents,
                    uptimeColor,
                    hasData: !!metrics
                }) 
            };
        }

        // GET /reliability/admin/all - get all monitored tools (admin)
        if (method === 'GET' && path === '/reliability/admin/all') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({
                TableName: RELIABILITY_TABLE,
                FilterExpression: 'recordType = :metrics',
                ExpressionAttributeValues: { ':metrics': 'METRICS' }
            }));
            
            const now = Date.now();
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            
            const tools = (result.Items || []).map(item => ({
                ...item,
                isAlerting: item.uptime7d < 95,
                lastCheckAge: item.lastCheck ? Math.floor((now - new Date(item.lastCheck).getTime()) / 60000) : null
            })).sort((a, b) => (a.toolName || a.toolSlug).localeCompare(b.toolName || b.toolSlug));
            
            return { statusCode: 200, headers, body: JSON.stringify(tools) };
        }

        // GET /reliability/reports/admin - get outage reports (admin)
        if (method === 'GET' && path === '/reliability/reports/admin') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: REPORTS_TABLE }));
            const items = (result.Items || []).sort((a, b) => 
                new Date(b.submittedAt) - new Date(a.submittedAt)
            );
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        // POST /reliability/report - submit outage report (public)
        if (method === 'POST' && path === '/reliability/report') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, toolName, reporterName, reporterEmail, incidentDateTime, description } = body;
            
            const required = { toolSlug, reporterName, reporterEmail, incidentDateTime, description };
            const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing: ${missing.join(', ')}` }) };
            }
            
            if (!isValidEmail(reporterEmail)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                toolSlug,
                toolName: toolName || toolSlug,
                reporterName,
                reporterEmail,
                incidentDateTime,
                description: description.substring(0, 2000),
                status: 'pending',
                submittedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: REPORTS_TABLE, Item: item }));
            
            await sendNotification(
                `[ToolIntel] Outage Report: ${toolName || toolSlug}`,
                `New outage report submitted.

Tool: ${toolName || toolSlug} (${toolSlug})
Incident Time: ${incidentDateTime}
Description: ${description}

Reported by: ${reporterName} (${reporterEmail})

Review: https://toolintel.ai/admin/reliability.html?key=${ADMIN_KEY}
`
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: item.id }) };
        }

        // PATCH /reliability/report/:id - update report status (admin)
        if (method === 'PATCH' && path.match(/^\/reliability\/report\/[^/]+$/)) {
            const id = path.split('/').pop();
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: REPORTS_TABLE,
                Key: { id },
                UpdateExpression: 'SET #status = :status, reviewedAt = :now, reviewNotes = :notes',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { 
                    ':status': body.status, 
                    ':now': new Date().toISOString(),
                    ':notes': body.reviewNotes || ''
                }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /reliability/admin/update-metrics - update metrics for a tool (admin)
        if (method === 'POST' && path === '/reliability/admin/update-metrics') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, uptime90d, uptime7d, avgResponseMs, outageCount90d, currentStatus } = body;
            
            if (!toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            const item = {
                toolSlug,
                recordType: 'METRICS',
                toolName: toolName || toolSlug,
                uptime90d: parseFloat(uptime90d) || 0,
                uptime7d: parseFloat(uptime7d) || 0,
                avgResponseMs: parseInt(avgResponseMs) || 0,
                outageCount90d: parseInt(outageCount90d) || 0,
                currentStatus: currentStatus || 'operational',
                lastCheck: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: RELIABILITY_TABLE, Item: item }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /reliability/admin/add-incident - add incident to history (admin)
        if (method === 'POST' && path === '/reliability/admin/add-incident') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, date, incidentType, duration, vendorResponseTime, description } = body;
            
            if (!toolSlug || !date || !incidentType) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, date, and incidentType required' }) };
            }
            
            const validTypes = ['Outage', 'Degraded Performance', 'Slow Response'];
            if (!validTypes.includes(incidentType)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid incident type' }) };
            }
            
            const item = {
                toolSlug,
                recordType: `INCIDENT#${new Date().toISOString()}`,
                date,
                incidentType,
                duration: duration || 'Unknown',
                vendorResponseTime: vendorResponseTime || 'Unknown',
                description: description || '',
                addedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: RELIABILITY_TABLE, Item: item }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /reliability/admin/init - initialize monitoring for a tool (admin)
        if (method === 'POST' && path === '/reliability/admin/init') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, monitorUrl } = body;
            
            if (!toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            const now = new Date().toISOString();
            
            // Create initial metrics
            await ddb.send(new PutCommand({
                TableName: RELIABILITY_TABLE,
                Item: {
                    toolSlug,
                    recordType: 'METRICS',
                    toolName: toolName || toolSlug,
                    monitorUrl: monitorUrl || '',
                    uptime90d: 100,
                    uptime7d: 100,
                    avgResponseMs: 0,
                    outageCount90d: 0,
                    currentStatus: 'operational',
                    lastCheck: now,
                    monitoringStarted: now,
                    updatedAt: now
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
