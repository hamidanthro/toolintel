// Lambda for Security Incident and Data Breach Verification System
// DynamoDB tables: toolintel-security-incidents, toolintel-incident-reports

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });

const INCIDENTS_TABLE = 'toolintel-security-incidents';
const REPORTS_TABLE = 'toolintel-incident-reports';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const INCIDENT_TYPES = ['Data Breach', 'Service Compromise', 'Unauthorized Access', 'Data Exposure', 'Other'];
const DISCLOSURE_QUALITY = ['Proactive', 'Reactive', 'Undisclosed'];

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUrl(url) {
    try { new URL(url); return true; } catch { return false; }
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

// Calculate incident status badge
function getIncidentStatus(incidents) {
    const now = new Date();
    const twentyFourMonthsAgo = new Date(now.setMonth(now.getMonth() - 24));
    
    const recentIncidents = incidents.filter(i => new Date(i.date) >= twentyFourMonthsAgo);
    const count = recentIncidents.length;
    
    if (count === 0) return { status: 'clean', color: 'green', text: 'No Verified Incidents in the Last 24 Months' };
    if (count === 1) return { status: 'single', color: 'yellow', text: '1 Incident Recorded — See Details' };
    return { status: 'multiple', color: 'red', text: `${count} Incidents Recorded — See Details` };
}

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /incidents?toolSlug=X - get security incident data for a tool (public)
        if (method === 'GET' && path === '/incidents' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: INCIDENTS_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            const items = result.Items || [];
            const incidents = items.filter(i => i.recordType.startsWith('INCIDENT#'))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            const statusBadge = getIncidentStatus(incidents);
            
            // Get disclosure quality (most recent incident's disclosure, or null)
            const latestWithDisclosure = incidents.find(i => i.disclosureQuality);
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    incidents,
                    statusBadge,
                    disclosureQuality: latestWithDisclosure?.disclosureQuality || null,
                    hasIncidents: incidents.length > 0
                }) 
            };
        }

        // GET /incidents/admin/all - get all tools with incidents (admin)
        if (method === 'GET' && path === '/incidents/admin/all') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: INCIDENTS_TABLE }));
            const items = result.Items || [];
            
            // Group by tool
            const toolMap = {};
            items.forEach(item => {
                if (!toolMap[item.toolSlug]) {
                    toolMap[item.toolSlug] = { toolSlug: item.toolSlug, incidents: [] };
                }
                if (item.recordType.startsWith('INCIDENT#')) {
                    toolMap[item.toolSlug].incidents.push(item);
                }
            });
            
            const tools = Object.values(toolMap).map(t => ({
                ...t,
                incidentCount: t.incidents.length,
                statusBadge: getIncidentStatus(t.incidents),
                latestIncident: t.incidents.length > 0 ? 
                    t.incidents.sort((a, b) => new Date(b.date) - new Date(a.date))[0] : null
            })).sort((a, b) => b.incidentCount - a.incidentCount);
            
            return { statusCode: 200, headers, body: JSON.stringify(tools) };
        }

        // GET /incidents/reports/admin - get submitted incident reports (admin)
        if (method === 'GET' && path === '/incidents/reports/admin') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: REPORTS_TABLE }));
            const items = (result.Items || []).sort((a, b) => 
                new Date(b.submittedAt) - new Date(a.submittedAt)
            );
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        // GET /incidents/reports/admin/pending - count pending reports (admin)
        if (method === 'GET' && path === '/incidents/reports/admin/pending') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({
                TableName: REPORTS_TABLE,
                FilterExpression: '#status = :pending',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':pending': 'pending' }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ count: (result.Items || []).length }) };
        }

        // POST /incidents/report - submit incident report (public)
        if (method === 'POST' && path === '/incidents/report') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, toolName, submitterName, submitterEmail, incidentDate, incidentType, description, sourceLink } = body;
            
            const required = { toolSlug, submitterName, submitterEmail, incidentDate, description };
            const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing: ${missing.join(', ')}` }) };
            }
            
            if (!isValidEmail(submitterEmail)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
            }
            
            if (sourceLink && !isValidUrl(sourceLink)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid source URL' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                toolSlug,
                toolName: toolName || toolSlug,
                submitterName,
                submitterEmail,
                incidentDate,
                incidentType: INCIDENT_TYPES.includes(incidentType) ? incidentType : 'Other',
                description: description.substring(0, 2000),
                sourceLink: sourceLink || null,
                status: 'pending',
                submittedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: REPORTS_TABLE, Item: item }));
            
            await sendNotification(
                `[ToolIntel] Security Incident Report: ${toolName || toolSlug}`,
                `New security incident report submitted.

Tool: ${toolName || toolSlug} (${toolSlug})
Incident Date: ${incidentDate}
Type: ${item.incidentType}
Description: ${description}
Source: ${sourceLink || 'Not provided'}

Reported by: ${submitterName} (${submitterEmail})

URGENT: Review and verify within 24 hours.
Review: https://toolintel.ai/admin/incidents.html?key=${ADMIN_KEY}
`
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: item.id }) };
        }

        // PATCH /incidents/report/:id - update report status (admin)
        if (method === 'PATCH' && path.match(/^\/incidents\/report\/[^/]+$/)) {
            const id = path.split('/').pop();
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const validStatuses = ['pending', 'verified', 'rejected', 'needs-more-info'];
            if (!validStatuses.includes(body.status)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid status' }) };
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

        // POST /incidents/admin/add - add verified incident (admin)
        if (method === 'POST' && path === '/incidents/admin/add') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, date, incidentType, scope, vendorResponse, sourceLink, sourceName, disclosureQuality, description } = body;
            
            if (!toolSlug || !date || !incidentType) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, date, and incidentType required' }) };
            }
            
            if (!INCIDENT_TYPES.includes(incidentType)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid incident type. Must be: ${INCIDENT_TYPES.join(', ')}` }) };
            }
            
            if (disclosureQuality && !DISCLOSURE_QUALITY.includes(disclosureQuality)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid disclosure quality. Must be: ${DISCLOSURE_QUALITY.join(', ')}` }) };
            }
            
            const incidentId = crypto.randomUUID();
            const item = {
                toolSlug,
                recordType: `INCIDENT#${incidentId}`,
                incidentId,
                toolName: toolName || toolSlug,
                date,
                incidentType,
                scope: scope || 'Unknown',
                vendorResponse: vendorResponse || 'No public response',
                sourceLink: sourceLink || null,
                sourceName: sourceName || 'Public Report',
                disclosureQuality: disclosureQuality || null,
                description: description || '',
                verified: true,
                addedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: INCIDENTS_TABLE, Item: item }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, incidentId }) };
        }

        // DELETE /incidents/admin/delete - remove incident (admin) - NOT EXPOSED TO VENDORS
        if (method === 'DELETE' && path === '/incidents/admin/delete') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            // Note: This exists only for correcting editorial errors, not vendor requests
            // Vendors cannot request removal - see permanent note on tool pages
            
            const { toolSlug, recordType, reason } = body;
            
            if (!toolSlug || !recordType || !reason) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, recordType, and reason required' }) };
            }
            
            // Log the deletion for audit trail
            console.log(`INCIDENT DELETED: ${toolSlug} | ${recordType} | Reason: ${reason} | By admin at ${new Date().toISOString()}`);
            
            await ddb.send(new DeleteCommand({
                TableName: INCIDENTS_TABLE,
                Key: { toolSlug, recordType }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, deleted: true }) };
        }

        // GET /incidents/admin/queue - get pending breach disclosures to review (admin)
        if (method === 'GET' && path === '/incidents/admin/queue') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            // This endpoint is for flagged disclosures detected through public sources
            // Returns reports pending verification within 24h target
            const result = await ddb.send(new ScanCommand({
                TableName: REPORTS_TABLE,
                FilterExpression: '#status = :pending',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':pending': 'pending' }
            }));
            
            const items = (result.Items || [])
                .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)) // Oldest first
                .map(item => {
                    const submittedAt = new Date(item.submittedAt);
                    const now = new Date();
                    const hoursAgo = Math.floor((now - submittedAt) / (1000 * 60 * 60));
                    return {
                        ...item,
                        hoursAgo,
                        urgent: hoursAgo >= 20 // Flag if approaching 24h deadline
                    };
                });
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
