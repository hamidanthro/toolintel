// Lambda for AI Tool Changelog System
// DynamoDB tables: toolintel-changelog, toolintel-changelog-subscriptions

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });

const CHANGELOG_TABLE = 'toolintel-changelog';
const SUBSCRIPTIONS_TABLE = 'toolintel-changelog-subscriptions';
const REVIEW_QUEUE_TABLE = 'toolintel-review-queue';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const CHANGE_TYPES = [
    'New Feature', 'Pricing Change', 'Model Update', 'API Change', 
    'Security Update', 'Policy Change', 'Performance Change', 'Discontinued Feature'
];

const SCORE_IMPACT = ['Positive', 'Negative', 'Neutral', 'Under Review'];

const SCORE_CATEGORIES = [
    'Core AI Performance', 'Data Privacy & Security', 'Transparency',
    'Reliability & Uptime', 'Compliance', 'Pricing Fairness',
    'Integration & Usability', 'Human Override', 'Vendor Accountability', 'Bias & Fairness'
];

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendNotification(to, subject, body) {
    try {
        await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
            Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: body } }
            }
        }));
        return true;
    } catch (err) {
        console.error('Email failed:', err);
        return false;
    }
}

// Format changelog stats
function getChangelogStats(entries) {
    if (!entries.length) return { count: 0, firstDate: null, lastDate: null };
    
    const sorted = entries.sort((a, b) => new Date(a.date) - new Date(b.date));
    return {
        count: entries.length,
        firstDate: sorted[0].date,
        lastDate: sorted[sorted.length - 1].date
    };
}

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /changelog?toolSlug=X - get changelog for a tool (public)
        if (method === 'GET' && path === '/changelog' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: CHANGELOG_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            const entries = (result.Items || [])
                .filter(i => i.recordType.startsWith('ENTRY#'))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            const scoreImpactEntries = entries.filter(e => e.oldScore !== undefined && e.newScore !== undefined);
            const stats = getChangelogStats(entries);
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    entries,
                    scoreImpactEntries,
                    stats,
                    hasEntries: entries.length > 0
                }) 
            };
        }

        // GET /changelog/category?category=X - get changelog for all tools in a category (public)
        if (method === 'GET' && path === '/changelog/category' && query.category) {
            const result = await ddb.send(new ScanCommand({
                TableName: CHANGELOG_TABLE,
                FilterExpression: 'category = :cat AND begins_with(recordType, :prefix)',
                ExpressionAttributeValues: { 
                    ':cat': query.category,
                    ':prefix': 'ENTRY#'
                }
            }));
            
            const entries = (result.Items || [])
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            // Filter to last 7 days if requested
            let filtered = entries;
            if (query.days) {
                const daysAgo = new Date();
                daysAgo.setDate(daysAgo.getDate() - parseInt(query.days));
                filtered = entries.filter(e => new Date(e.date) >= daysAgo);
            }
            
            return { statusCode: 200, headers, body: JSON.stringify(filtered) };
        }

        // POST /changelog/subscribe - subscribe to tool or category updates (public)
        if (method === 'POST' && path === '/changelog/subscribe') {
            const body = JSON.parse(event.body || '{}');
            const { email, toolSlug, category, subscriptionType } = body;
            
            if (!email || !isValidEmail(email)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid email required' }) };
            }
            
            if (!toolSlug && !category) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Either toolSlug or category required' }) };
            }
            
            const subId = crypto.randomUUID();
            const item = {
                subscriptionId: subId,
                email: email.toLowerCase(),
                toolSlug: toolSlug || null,
                category: category || null,
                subscriptionType: subscriptionType || (toolSlug ? 'tool' : 'category'),
                createdAt: new Date().toISOString(),
                active: true
            };
            
            await ddb.send(new PutCommand({ TableName: SUBSCRIPTIONS_TABLE, Item: item }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, subscriptionId: subId }) };
        }

        // DELETE /changelog/unsubscribe - unsubscribe from updates (public)
        if (method === 'DELETE' && path === '/changelog/unsubscribe') {
            const body = JSON.parse(event.body || '{}');
            const { subscriptionId, email } = body;
            
            if (subscriptionId) {
                await ddb.send(new DeleteCommand({
                    TableName: SUBSCRIPTIONS_TABLE,
                    Key: { subscriptionId }
                }));
            } else if (email) {
                // Find all subscriptions for email and delete
                const result = await ddb.send(new ScanCommand({
                    TableName: SUBSCRIPTIONS_TABLE,
                    FilterExpression: 'email = :email',
                    ExpressionAttributeValues: { ':email': email.toLowerCase() }
                }));
                
                for (const item of result.Items || []) {
                    await ddb.send(new DeleteCommand({
                        TableName: SUBSCRIPTIONS_TABLE,
                        Key: { subscriptionId: item.subscriptionId }
                    }));
                }
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // GET /changelog/admin/all - get all changelog entries (admin)
        if (method === 'GET' && path === '/changelog/admin/all') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: CHANGELOG_TABLE }));
            const items = (result.Items || [])
                .filter(i => i.recordType.startsWith('ENTRY#'))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            // Group by tool
            const toolMap = {};
            items.forEach(item => {
                if (!toolMap[item.toolSlug]) {
                    toolMap[item.toolSlug] = { toolSlug: item.toolSlug, toolName: item.toolName, entries: [] };
                }
                toolMap[item.toolSlug].entries.push(item);
            });
            
            const tools = Object.values(toolMap)
                .map(t => ({ ...t, stats: getChangelogStats(t.entries) }))
                .sort((a, b) => new Date(b.stats.lastDate || 0) - new Date(a.stats.lastDate || 0));
            
            return { statusCode: 200, headers, body: JSON.stringify({ tools, totalEntries: items.length }) };
        }

        // GET /changelog/admin/subscriptions - get all subscriptions (admin)
        if (method === 'GET' && path === '/changelog/admin/subscriptions') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: SUBSCRIPTIONS_TABLE }));
            return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
        }

        // GET /changelog/admin/review-queue - get tools flagged for re-review (admin)
        if (method === 'GET' && path === '/changelog/admin/review-queue') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            try {
                const result = await ddb.send(new ScanCommand({ TableName: REVIEW_QUEUE_TABLE }));
                const items = (result.Items || []).sort((a, b) => {
                    // High priority first, then by date
                    if (a.priority === 'high' && b.priority !== 'high') return -1;
                    if (b.priority === 'high' && a.priority !== 'high') return 1;
                    return new Date(b.addedAt) - new Date(a.addedAt);
                });
                return { statusCode: 200, headers, body: JSON.stringify(items) };
            } catch (err) {
                return { statusCode: 200, headers, body: JSON.stringify([]) };
            }
        }

        // POST /changelog/admin/add - add a changelog entry (admin)
        if (method === 'POST' && path === '/changelog/admin/add') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { 
                toolSlug, toolName, category, date, changeType, description, 
                scoreImpact, source, sourceName, sourceLink,
                oldScore, newScore, categoryAffected, requiresReview, reviewType
            } = body;
            
            if (!toolSlug || !date || !changeType || !description || !scoreImpact) {
                return { statusCode: 400, headers, body: JSON.stringify({ 
                    error: 'toolSlug, date, changeType, description, and scoreImpact required' 
                }) };
            }
            
            if (!CHANGE_TYPES.includes(changeType)) {
                return { statusCode: 400, headers, body: JSON.stringify({ 
                    error: `Invalid changeType. Must be: ${CHANGE_TYPES.join(', ')}` 
                }) };
            }
            
            if (!SCORE_IMPACT.includes(scoreImpact)) {
                return { statusCode: 400, headers, body: JSON.stringify({ 
                    error: `Invalid scoreImpact. Must be: ${SCORE_IMPACT.join(', ')}` 
                }) };
            }
            
            const entryId = crypto.randomUUID();
            const item = {
                toolSlug,
                recordType: `ENTRY#${entryId}`,
                entryId,
                toolName: toolName || toolSlug,
                category: category || null,
                date,
                changeType,
                description: description.substring(0, 300), // Max 2 sentences
                scoreImpact,
                source: source || 'vendor announcement',
                sourceName: sourceName || null,
                sourceLink: sourceLink || null,
                // Score change tracking
                oldScore: oldScore !== undefined ? parseInt(oldScore) : undefined,
                newScore: newScore !== undefined ? parseInt(newScore) : undefined,
                categoryAffected: categoryAffected || null,
                // Review flags
                requiresReview: requiresReview || false,
                reviewType: reviewType || null, // 'partial' or 'full'
                addedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: CHANGELOG_TABLE, Item: item }));
            
            // If requires review, add to review queue
            if (requiresReview) {
                try {
                    await ddb.send(new PutCommand({
                        TableName: REVIEW_QUEUE_TABLE,
                        Item: {
                            toolSlug,
                            toolName: toolName || toolSlug,
                            priority: 'high',
                            reason: `Changelog entry: ${changeType} - ${description.substring(0, 100)}`,
                            reviewType: reviewType || 'partial',
                            triggeredBy: entryId,
                            addedAt: new Date().toISOString()
                        }
                    }));
                } catch (err) {
                    console.error('Failed to add to review queue:', err);
                }
            }
            
            // Notify subscribers
            await notifySubscribers(item);
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, entryId }) };
        }

        // POST /changelog/admin/send-digest - send weekly category digest (admin/cron)
        if (method === 'POST' && path === '/changelog/admin/send-digest') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            // Get all category subscriptions
            const subsResult = await ddb.send(new ScanCommand({
                TableName: SUBSCRIPTIONS_TABLE,
                FilterExpression: 'subscriptionType = :type AND active = :active',
                ExpressionAttributeValues: { ':type': 'category', ':active': true }
            }));
            
            const subs = subsResult.Items || [];
            const categories = [...new Set(subs.map(s => s.category).filter(Boolean))];
            
            const results = [];
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            for (const category of categories) {
                // Get entries for this category in last 7 days
                const entriesResult = await ddb.send(new ScanCommand({
                    TableName: CHANGELOG_TABLE,
                    FilterExpression: 'category = :cat AND begins_with(recordType, :prefix)',
                    ExpressionAttributeValues: { ':cat': category, ':prefix': 'ENTRY#' }
                }));
                
                const entries = (entriesResult.Items || [])
                    .filter(e => new Date(e.addedAt) >= sevenDaysAgo)
                    .sort((a, b) => new Date(b.date) - new Date(a.date));
                
                if (entries.length === 0) continue;
                
                // Get subscribers for this category
                const categorySubs = subs.filter(s => s.category === category);
                const emails = categorySubs.map(s => s.email);
                
                // Send digest
                const subject = `[ToolIntel] Weekly ${category} Changelog — ${entries.length} update${entries.length > 1 ? 's' : ''}`;
                const body = formatDigestEmail(category, entries);
                
                for (const email of emails) {
                    await sendNotification(email, subject, body);
                }
                
                results.push({ category, entries: entries.length, subscribers: emails.length });
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ results }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};

// Notify tool subscribers when a new entry is added
async function notifySubscribers(entry) {
    try {
        const result = await ddb.send(new ScanCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            FilterExpression: 'toolSlug = :slug AND active = :active',
            ExpressionAttributeValues: { ':slug': entry.toolSlug, ':active': true }
        }));
        
        const subs = result.Items || [];
        if (subs.length === 0) return;
        
        const subject = `[ToolIntel] ${entry.toolName || entry.toolSlug} Update: ${entry.changeType}`;
        const body = formatNotificationEmail(entry);
        
        for (const sub of subs) {
            await sendNotification(sub.email, subject, body);
        }
    } catch (err) {
        console.error('Failed to notify subscribers:', err);
    }
}

function formatNotificationEmail(entry) {
    let text = `${entry.toolName || entry.toolSlug} — Product Change Logged\n`;
    text += `${'='.repeat(50)}\n\n`;
    text += `Date: ${entry.date}\n`;
    text += `Type: ${entry.changeType}\n`;
    text += `Score Impact: ${entry.scoreImpact}\n\n`;
    text += `What changed:\n${entry.description}\n`;
    
    if (entry.oldScore !== undefined && entry.newScore !== undefined) {
        text += `\nScore Change: ${entry.oldScore} → ${entry.newScore}`;
        if (entry.categoryAffected) {
            text += ` (${entry.categoryAffected})`;
        }
        text += '\n';
    }
    
    if (entry.sourceLink) {
        text += `\nSource: ${entry.sourceLink}\n`;
    }
    
    text += `\n${'—'.repeat(50)}\n`;
    text += `View full changelog: https://toolintel.ai/reviews/${entry.toolSlug}.html#changelog\n\n`;
    text += `To unsubscribe, reply to this email with "unsubscribe".\n`;
    text += `\nToolIntel — No marketing. No upsell. Just updates.`;
    
    return text;
}

function formatDigestEmail(category, entries) {
    let text = `${category} — Weekly Changelog Digest\n`;
    text += `${'='.repeat(50)}\n`;
    text += `${entries.length} change${entries.length > 1 ? 's' : ''} logged in the past 7 days\n\n`;
    
    // Group by tool
    const byTool = {};
    entries.forEach(e => {
        if (!byTool[e.toolSlug]) byTool[e.toolSlug] = [];
        byTool[e.toolSlug].push(e);
    });
    
    for (const [slug, toolEntries] of Object.entries(byTool)) {
        const toolName = toolEntries[0].toolName || slug;
        text += `\n📦 ${toolName}\n`;
        text += `${'—'.repeat(30)}\n`;
        
        for (const e of toolEntries) {
            text += `• [${e.date}] ${e.changeType}: ${e.description}`;
            if (e.oldScore !== undefined && e.newScore !== undefined) {
                text += ` (Score: ${e.oldScore}→${e.newScore})`;
            }
            text += '\n';
        }
    }
    
    text += `\n${'='.repeat(50)}\n`;
    text += `Browse category: https://toolintel.ai/categories/${category.toLowerCase().replace(/\s+/g, '-')}.html\n\n`;
    text += `To unsubscribe, reply to this email with "unsubscribe".\n`;
    text += `\nToolIntel — No marketing. No upsell. Just updates.`;
    
    return text;
}
