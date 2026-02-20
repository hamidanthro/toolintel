// Lambda for Comparison Engine with Use-Case Weighting
// Handles shared comparisons, saved profiles, and analytics

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const COMPARISONS_TABLE = 'toolintel-comparisons';
const PROFILES_TABLE = 'toolintel-comparison-profiles';
const ANALYTICS_TABLE = 'toolintel-comparison-analytics';

const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function generateId(length = 12) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// Track comparison analytics
async function trackComparison(tools, weights, preset) {
    try {
        // Track tool pair (sorted for consistency)
        const sortedTools = [...tools].sort();
        for (let i = 0; i < sortedTools.length; i++) {
            for (let j = i + 1; j < sortedTools.length; j++) {
                const pairKey = `${sortedTools[i]}|${sortedTools[j]}`;
                await ddb.send(new UpdateCommand({
                    TableName: ANALYTICS_TABLE,
                    Key: { analyticsType: 'tool_pair', itemKey: pairKey },
                    UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, lastCompared = :now',
                    ExpressionAttributeNames: { '#count': 'count' },
                    ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': new Date().toISOString() }
                }));
            }
        }
        
        // Track preset usage
        if (preset) {
            await ddb.send(new UpdateCommand({
                TableName: ANALYTICS_TABLE,
                Key: { analyticsType: 'preset', itemKey: preset },
                UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one',
                ExpressionAttributeNames: { '#count': 'count' },
                ExpressionAttributeValues: { ':zero': 0, ':one': 1 }
            }));
        }
        
        // Track weight adjustments (if custom)
        if (weights && !preset) {
            for (const [category, weight] of Object.entries(weights)) {
                if (weight !== 10) { // 10% is default
                    await ddb.send(new UpdateCommand({
                        TableName: ANALYTICS_TABLE,
                        Key: { analyticsType: 'weight_adjustment', itemKey: category },
                        UpdateExpression: 'SET totalWeight = if_not_exists(totalWeight, :zero) + :weight, #count = if_not_exists(#count, :zero) + :one',
                        ExpressionAttributeNames: { '#count': 'count' },
                        ExpressionAttributeValues: { ':zero': 0, ':weight': weight, ':one': 1 }
                    }));
                }
            }
        }
    } catch (e) {
        console.error('Analytics tracking failed:', e);
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
        // POST /compare/share - create shareable comparison
        if (method === 'POST' && path === '/compare/share') {
            const body = JSON.parse(event.body || '{}');
            const { tools, weights, preset } = body;
            
            if (!tools || tools.length < 2) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'At least 2 tools required' }) };
            }
            
            const compareId = generateId();
            
            await ddb.send(new PutCommand({
                TableName: COMPARISONS_TABLE,
                Item: {
                    compareId,
                    tools,
                    weights: weights || null,
                    preset: preset || null,
                    createdAt: new Date().toISOString(),
                    views: 0
                }
            }));
            
            // Track analytics
            await trackComparison(tools, weights, preset);
            
            return { 
                statusCode: 201, 
                headers, 
                body: JSON.stringify({ 
                    compareId,
                    shareUrl: `https://toolintel.ai/compare?id=${compareId}`
                }) 
            };
        }

        // GET /compare/shared/:id - get shared comparison
        if (method === 'GET' && path.match(/^\/compare\/shared\/[^/]+$/)) {
            const compareId = path.split('/').pop();
            
            const result = await ddb.send(new GetCommand({
                TableName: COMPARISONS_TABLE,
                Key: { compareId }
            }));
            
            if (!result.Item) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Comparison not found' }) };
            }
            
            // Increment view count
            await ddb.send(new UpdateCommand({
                TableName: COMPARISONS_TABLE,
                Key: { compareId },
                UpdateExpression: 'SET #views = if_not_exists(#views, :zero) + :one',
                ExpressionAttributeNames: { '#views': 'views' },
                ExpressionAttributeValues: { ':zero': 0, ':one': 1 }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Item) };
        }

        // POST /compare/profile - save custom weight profile
        if (method === 'POST' && path === '/compare/profile') {
            const body = JSON.parse(event.body || '{}');
            const { userId, profileName, weights } = body;
            
            if (!userId || !profileName || !weights) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId, profileName, and weights required' }) };
            }
            
            const profileId = generateId(8);
            
            await ddb.send(new PutCommand({
                TableName: PROFILES_TABLE,
                Item: {
                    userId,
                    profileId,
                    profileName,
                    weights,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, profileId }) };
        }

        // GET /compare/profiles?userId=X - get user's saved profiles
        if (method === 'GET' && path === '/compare/profiles') {
            if (!query.userId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId required' }) };
            }
            
            const result = await ddb.send(new QueryCommand({
                TableName: PROFILES_TABLE,
                KeyConditionExpression: 'userId = :uid',
                ExpressionAttributeValues: { ':uid': query.userId }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
        }

        // DELETE /compare/profile - delete a saved profile
        if (method === 'DELETE' && path === '/compare/profile') {
            const body = JSON.parse(event.body || '{}');
            const { userId, profileId } = body;
            
            if (!userId || !profileId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId and profileId required' }) };
            }
            
            await ddb.send(new DeleteCommand({
                TableName: PROFILES_TABLE,
                Key: { userId, profileId }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /compare/track - track comparison for analytics (anonymous)
        if (method === 'POST' && path === '/compare/track') {
            const body = JSON.parse(event.body || '{}');
            const { tools, weights, preset } = body;
            
            if (tools && tools.length >= 2) {
                await trackComparison(tools, weights, preset);
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // GET /compare/admin/analytics - admin analytics
        if (method === 'GET' && path === '/compare/admin/analytics') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: ANALYTICS_TABLE }));
            const items = result.Items || [];
            
            // Group by type
            const toolPairs = items
                .filter(i => i.analyticsType === 'tool_pair')
                .sort((a, b) => (b.count || 0) - (a.count || 0))
                .slice(0, 20)
                .map(i => ({
                    tools: i.itemKey.split('|'),
                    count: i.count,
                    lastCompared: i.lastCompared
                }));
            
            const presets = items
                .filter(i => i.analyticsType === 'preset')
                .sort((a, b) => (b.count || 0) - (a.count || 0))
                .map(i => ({
                    preset: i.itemKey,
                    count: i.count
                }));
            
            const weightAdjustments = items
                .filter(i => i.analyticsType === 'weight_adjustment')
                .sort((a, b) => (b.count || 0) - (a.count || 0))
                .map(i => ({
                    category: i.itemKey,
                    avgWeight: i.count > 0 ? Math.round(i.totalWeight / i.count) : 0,
                    adjustmentCount: i.count
                }));
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    toolPairs,
                    presets,
                    weightAdjustments,
                    totalComparisons: toolPairs.reduce((sum, p) => sum + p.count, 0)
                }) 
            };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
