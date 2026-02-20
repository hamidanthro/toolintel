// Lambda for Terms of Service and Privacy Policy Change Tracking
// DynamoDB tables: toolintel-policy-changes, toolintel-policy-archives

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const https = require('https');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });
const s3 = new S3Client({ region: 'us-east-1' });

const CHANGES_TABLE = 'toolintel-policy-changes';
const MONITORS_TABLE = 'toolintel-policy-monitors';
const ARCHIVE_BUCKET = 'toolintel-policy-archives';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const DOCUMENT_TYPES = ['Terms of Service', 'Privacy Policy', 'Data Processing Agreement', 'Acceptable Use Policy'];
const BUYER_IMPACT = ['Low', 'Medium', 'High'];
const DATA_RIGHTS_TOPICS = ['training_data', 'ip_rights', 'arbitration'];

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

// Calculate policy change status badge
function getPolicyStatus(changes) {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.setMonth(now.getMonth() - 12));
    
    const recentChanges = changes.filter(c => new Date(c.date) >= twelveMonthsAgo);
    const count = recentChanges.length;
    
    if (count === 0) return { status: 'stable', color: 'green', text: 'No Policy Changes in the Last 12 Months' };
    if (count <= 2) return { status: 'moderate', color: 'yellow', text: `${count} Change${count > 1 ? 's' : ''} Recorded — See Details` };
    return { status: 'frequent', color: 'red', text: `${count} Changes Recorded — Review Carefully` };
}

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /policies?toolSlug=X - get policy data for a tool (public)
        if (method === 'GET' && path === '/policies' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: CHANGES_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            const items = result.Items || [];
            const changes = items.filter(i => i.recordType.startsWith('CHANGE#'))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            const dataRights = items.find(i => i.recordType === 'DATA_RIGHTS') || null;
            
            const statusBadge = getPolicyStatus(changes);
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    changes,
                    dataRights: dataRights ? {
                        trainingData: dataRights.trainingData || null,
                        ipRights: dataRights.ipRights || null,
                        arbitration: dataRights.arbitration || null,
                        lastVerified: dataRights.lastVerified || null
                    } : null,
                    statusBadge,
                    hasChanges: changes.length > 0
                }) 
            };
        }

        // GET /policies/archives?toolSlug=X - get archived policy versions (public)
        if (method === 'GET' && path === '/policies/archives' && query.toolSlug) {
            try {
                const listResult = await s3.send(new ListObjectsV2Command({
                    Bucket: ARCHIVE_BUCKET,
                    Prefix: `${query.toolSlug}/`
                }));
                
                const archives = (listResult.Contents || [])
                    .map(obj => {
                        const parts = obj.Key.split('/');
                        const filename = parts[parts.length - 1];
                        const [docType, timestamp] = filename.replace('.html', '').split('_');
                        return {
                            key: obj.Key,
                            documentType: docType.replace(/-/g, ' '),
                            timestamp: timestamp,
                            date: new Date(parseInt(timestamp)).toISOString(),
                            size: obj.Size,
                            url: `https://${ARCHIVE_BUCKET}.s3.amazonaws.com/${obj.Key}`
                        };
                    })
                    .sort((a, b) => b.timestamp - a.timestamp);
                
                return { statusCode: 200, headers, body: JSON.stringify(archives) };
            } catch (err) {
                // Bucket might not exist or be empty
                return { statusCode: 200, headers, body: JSON.stringify([]) };
            }
        }

        // GET /policies/admin/all - get all tools with policy tracking (admin)
        if (method === 'GET' && path === '/policies/admin/all') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: CHANGES_TABLE }));
            const items = result.Items || [];
            
            // Group by tool
            const toolMap = {};
            items.forEach(item => {
                if (!toolMap[item.toolSlug]) {
                    toolMap[item.toolSlug] = { toolSlug: item.toolSlug, changes: [], dataRights: null };
                }
                if (item.recordType.startsWith('CHANGE#')) {
                    toolMap[item.toolSlug].changes.push(item);
                } else if (item.recordType === 'DATA_RIGHTS') {
                    toolMap[item.toolSlug].dataRights = item;
                }
            });
            
            const tools = Object.values(toolMap).map(t => ({
                ...t,
                changeCount: t.changes.length,
                statusBadge: getPolicyStatus(t.changes),
                latestChange: t.changes.length > 0 ? 
                    t.changes.sort((a, b) => new Date(b.date) - new Date(a.date))[0] : null
            })).sort((a, b) => b.changeCount - a.changeCount);
            
            return { statusCode: 200, headers, body: JSON.stringify(tools) };
        }

        // GET /policies/admin/monitors - get monitored URLs (admin)
        if (method === 'GET' && path === '/policies/admin/monitors') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: MONITORS_TABLE }));
            const items = (result.Items || []).sort((a, b) => 
                (a.toolSlug || '').localeCompare(b.toolSlug || '')
            );
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        // GET /policies/admin/queue - get pending changes to review (admin)
        if (method === 'GET' && path === '/policies/admin/queue') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({
                TableName: MONITORS_TABLE,
                FilterExpression: 'changeDetected = :true',
                ExpressionAttributeValues: { ':true': true }
            }));
            
            const items = (result.Items || []).sort((a, b) => 
                new Date(a.changeDetectedAt || 0) - new Date(b.changeDetectedAt || 0)
            );
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        // POST /policies/admin/add-change - add a policy change record (admin)
        if (method === 'POST' && path === '/policies/admin/add-change') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, date, documentType, whatChanged, buyerImpact, sourceLink, sourceName } = body;
            
            if (!toolSlug || !date || !documentType || !whatChanged || !buyerImpact) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, date, documentType, whatChanged, and buyerImpact required' }) };
            }
            
            if (!DOCUMENT_TYPES.includes(documentType)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid documentType. Must be: ${DOCUMENT_TYPES.join(', ')}` }) };
            }
            
            if (!BUYER_IMPACT.includes(buyerImpact)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid buyerImpact. Must be: ${BUYER_IMPACT.join(', ')}` }) };
            }
            
            const changeId = crypto.randomUUID();
            const item = {
                toolSlug,
                recordType: `CHANGE#${changeId}`,
                changeId,
                toolName: toolName || toolSlug,
                date,
                documentType,
                whatChanged: whatChanged.substring(0, 200), // Max 1 sentence
                buyerImpact,
                sourceLink: sourceLink || null,
                sourceName: sourceName || 'Vendor Website',
                addedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: CHANGES_TABLE, Item: item }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, changeId }) };
        }

        // POST /policies/admin/update-data-rights - update data rights tracking (admin)
        if (method === 'POST' && path === '/policies/admin/update-data-rights') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, trainingData, ipRights, arbitration } = body;
            
            if (!toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            const item = {
                toolSlug,
                recordType: 'DATA_RIGHTS',
                trainingData: trainingData || null, // { status: 'Opt-out available', lastChanged: '2024-01-15' }
                ipRights: ipRights || null,
                arbitration: arbitration || null,
                lastVerified: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: CHANGES_TABLE, Item: item }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /policies/admin/add-monitor - add URL to monitor (admin)
        if (method === 'POST' && path === '/policies/admin/add-monitor') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, documentType, url } = body;
            
            if (!toolSlug || !documentType || !url) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, documentType, and url required' }) };
            }
            
            if (!isValidUrl(url)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid URL' }) };
            }
            
            const monitorId = `${toolSlug}#${documentType.replace(/\s+/g, '-').toLowerCase()}`;
            const item = {
                monitorId,
                toolSlug,
                toolName: toolName || toolSlug,
                documentType,
                url,
                lastChecked: null,
                lastHash: null,
                changeDetected: false,
                changeDetectedAt: null,
                createdAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: MONITORS_TABLE, Item: item }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, monitorId }) };
        }

        // POST /policies/admin/check-monitors - check all monitors for changes (admin/cron)
        if (method === 'POST' && path === '/policies/admin/check-monitors') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const monitorsResult = await ddb.send(new ScanCommand({ TableName: MONITORS_TABLE }));
            const monitors = monitorsResult.Items || [];
            
            const results = [];
            const changesDetected = [];
            
            for (const monitor of monitors) {
                try {
                    // Fetch the URL content
                    const content = await fetchUrl(monitor.url);
                    const newHash = crypto.createHash('md5').update(content).digest('hex');
                    
                    const changed = monitor.lastHash && monitor.lastHash !== newHash;
                    
                    // Update monitor
                    await ddb.send(new UpdateCommand({
                        TableName: MONITORS_TABLE,
                        Key: { monitorId: monitor.monitorId },
                        UpdateExpression: 'SET lastChecked = :now, lastHash = :hash, changeDetected = :changed, changeDetectedAt = :changedAt',
                        ExpressionAttributeValues: {
                            ':now': new Date().toISOString(),
                            ':hash': newHash,
                            ':changed': changed,
                            ':changedAt': changed ? new Date().toISOString() : monitor.changeDetectedAt
                        }
                    }));
                    
                    if (changed) {
                        changesDetected.push(monitor);
                        
                        // Archive the new version
                        const timestamp = Date.now();
                        const archiveKey = `${monitor.toolSlug}/${monitor.documentType.replace(/\s+/g, '-').toLowerCase()}_${timestamp}.html`;
                        await s3.send(new PutObjectCommand({
                            Bucket: ARCHIVE_BUCKET,
                            Key: archiveKey,
                            Body: content,
                            ContentType: 'text/html'
                        }));
                    }
                    
                    results.push({ monitorId: monitor.monitorId, success: true, changed });
                } catch (err) {
                    results.push({ monitorId: monitor.monitorId, success: false, error: err.message });
                }
            }
            
            // Send notification if changes detected
            if (changesDetected.length > 0) {
                await sendNotification(
                    `[ToolIntel] Policy Changes Detected: ${changesDetected.length} document(s)`,
                    `Policy changes detected for review:\n\n${changesDetected.map(m => 
                        `• ${m.toolName || m.toolSlug}: ${m.documentType}\n  URL: ${m.url}`
                    ).join('\n\n')}\n\nReview queue: https://toolintel.ai/admin/policies.html?key=${ADMIN_KEY}`
                );
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ results, changesDetected: changesDetected.length }) };
        }

        // POST /policies/admin/resolve-change - mark change as reviewed (admin)
        if (method === 'POST' && path === '/policies/admin/resolve-change') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { monitorId } = body;
            
            if (!monitorId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'monitorId required' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: MONITORS_TABLE,
                Key: { monitorId },
                UpdateExpression: 'SET changeDetected = :false, reviewedAt = :now',
                ExpressionAttributeValues: {
                    ':false': false,
                    ':now': new Date().toISOString()
                }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // DELETE /policies/admin/delete-change - remove a change record (admin)
        if (method === 'DELETE' && path === '/policies/admin/delete-change') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, recordType, reason } = body;
            
            if (!toolSlug || !recordType || !reason) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, recordType, and reason required' }) };
            }
            
            console.log(`POLICY CHANGE DELETED: ${toolSlug} | ${recordType} | Reason: ${reason} | By admin at ${new Date().toISOString()}`);
            
            await ddb.send(new DeleteCommand({
                TableName: CHANGES_TABLE,
                Key: { toolSlug, recordType }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};

// Helper to fetch URL content
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : require('http');
        const req = protocol.get(url, { timeout: 10000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow redirect
                return fetchUrl(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}
