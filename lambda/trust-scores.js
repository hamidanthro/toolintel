const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_TRUST_SCORES = 'toolintel-trust-scores';
const TABLE_TRUST_HISTORY = 'toolintel-trust-history';
const TABLE_IMPROVEMENT_REQUESTS = 'toolintel-trust-requests';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

const ADMIN_KEY = process.env.ADMIN_KEY;

// Component definitions
const COMPONENTS = [
    { id: 'reviewParticipation', name: 'Review Process Participation', maxScore: 12.5 },
    { id: 'certificationTransparency', name: 'Certification Transparency', maxScore: 12.5 },
    { id: 'pricingTransparency', name: 'Pricing Transparency', maxScore: 12.5 },
    { id: 'tosStability', name: 'Terms of Service Stability', maxScore: 12.5 },
    { id: 'incidentResponse', name: 'Incident Response Quality', maxScore: 12.5 },
    { id: 'claimAccuracy', name: 'Marketing Claim Accuracy', maxScore: 12.5 },
    { id: 'communityEngagement', name: 'Community Review Engagement', maxScore: 12.5 },
    { id: 'dataRightsClarity', name: 'Data Rights Clarity', maxScore: 12.5 }
];

exports.handler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    
    if (method === 'OPTIONS') {
        return { statusCode: 200, headers: CORS, body: '' };
    }

    const path = event.rawPath || event.path;

    try {
        // Get Trust Score for a tool (public API endpoint)
        if (path.match(/\/tools\/[\w-]+\/trust-score$/) && method === 'GET') {
            const toolSlug = path.split('/')[2];
            
            const result = await ddb.send(new GetCommand({
                TableName: TABLE_TRUST_SCORES,
                Key: { toolId: toolSlug }
            }));

            if (!result.Item) {
                return {
                    statusCode: 404,
                    headers: CORS,
                    body: JSON.stringify({ error: 'Tool not found' })
                };
            }

            const item = result.Item;
            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({
                    tool: item.toolId,
                    toolName: item.toolName,
                    vendorName: item.vendorName,
                    trustScore: item.trustScore,
                    productScore: item.productScore,
                    components: item.components,
                    lastUpdated: item.updatedAt
                })
            };
        }

        // Get leaderboard (public)
        if (path === '/trust-scores/leaderboard' && method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_TRUST_SCORES
            }));

            const items = (result.Items || [])
                .sort((a, b) => b.trustScore - a.trustScore)
                .map(item => ({
                    toolId: item.toolId,
                    toolName: item.toolName,
                    vendorName: item.vendorName,
                    trustScore: item.trustScore,
                    productScore: item.productScore,
                    gap: item.trustScore - item.productScore,
                    category: item.category
                }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(items)
            };
        }

        // Get most improved (public)
        if (path === '/trust-scores/improved' && method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_TRUST_HISTORY
            }));

            // Group by tool and calculate improvement over 90 days
            const now = new Date();
            const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            
            const improvements = {};
            (result.Items || []).forEach(item => {
                if (new Date(item.timestamp) >= ninetyDaysAgo) {
                    if (!improvements[item.toolId]) {
                        improvements[item.toolId] = { toolId: item.toolId, changes: [] };
                    }
                    improvements[item.toolId].changes.push(item);
                }
            });

            const improved = Object.values(improvements)
                .map(tool => {
                    const totalChange = tool.changes.reduce((sum, c) => sum + (c.newScore - c.oldScore), 0);
                    return { ...tool, totalChange };
                })
                .filter(t => t.totalChange > 0)
                .sort((a, b) => b.totalChange - a.totalChange)
                .slice(0, 5);

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(improved)
            };
        }

        // Get category leaders (public)
        if (path === '/trust-scores/leaders' && method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_TRUST_SCORES
            }));

            const items = result.Items || [];
            const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
            
            const leaders = {};
            categories.forEach(cat => {
                leaders[cat] = items
                    .filter(i => i.category === cat)
                    .sort((a, b) => b.trustScore - a.trustScore)
                    .slice(0, 3);
            });

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(leaders)
            };
        }

        // Submit improvement request (public)
        if (path === '/trust-scores/improvement-request' && method === 'POST') {
            const body = JSON.parse(event.body);
            const request = {
                id: `req-${Date.now()}`,
                toolId: body.toolId,
                toolName: body.toolName,
                vendorName: body.vendorName,
                contactName: body.contactName,
                contactEmail: body.contactEmail,
                message: body.message,
                status: 'pending',
                submitted: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_IMPROVEMENT_REQUESTS,
                Item: request
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: request.id })
            };
        }

        // Admin: Get all Trust Scores
        if (path === '/trust-scores/admin' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_TRUST_SCORES
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Admin: Update Trust Score
        if (path === '/trust-scores/admin/update' && method === 'POST') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const body = JSON.parse(event.body);
            const now = new Date().toISOString();

            // Get old score for history
            const oldResult = await ddb.send(new GetCommand({
                TableName: TABLE_TRUST_SCORES,
                Key: { toolId: body.toolId }
            }));

            const oldScore = oldResult.Item?.trustScore || 0;

            // Calculate new trust score
            const components = body.components;
            const trustScore = Object.values(components).reduce((sum, c) => sum + c.score, 0);

            // Update score
            await ddb.send(new PutCommand({
                TableName: TABLE_TRUST_SCORES,
                Item: {
                    toolId: body.toolId,
                    toolName: body.toolName,
                    vendorName: body.vendorName,
                    category: body.category,
                    trustScore: trustScore,
                    productScore: body.productScore,
                    components: components,
                    updatedAt: now
                }
            }));

            // Log history if score changed
            if (trustScore !== oldScore) {
                await ddb.send(new PutCommand({
                    TableName: TABLE_TRUST_HISTORY,
                    Item: {
                        id: `hist-${Date.now()}`,
                        toolId: body.toolId,
                        oldScore: oldScore,
                        newScore: trustScore,
                        reason: body.reason || 'Score update',
                        changedComponents: body.changedComponents || [],
                        timestamp: now
                    }
                }));
            }

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, trustScore })
            };
        }

        // Admin: Get improvement requests
        if (path === '/trust-scores/admin/requests' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_IMPROVEMENT_REQUESTS
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Admin: Get history
        if (path === '/trust-scores/admin/history' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const toolId = event.queryStringParameters?.toolId;
            
            let result;
            if (toolId) {
                result = await ddb.send(new ScanCommand({
                    TableName: TABLE_TRUST_HISTORY,
                    FilterExpression: 'toolId = :toolId',
                    ExpressionAttributeValues: { ':toolId': toolId }
                }));
            } else {
                result = await ddb.send(new ScanCommand({
                    TableName: TABLE_TRUST_HISTORY
                }));
            }

            const sorted = (result.Items || []).sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(sorted)
            };
        }

        return {
            statusCode: 404,
            headers: CORS,
            body: JSON.stringify({ error: 'Not found' })
        };

    } catch (err) {
        console.error('Error:', err);
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
