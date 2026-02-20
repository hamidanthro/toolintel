// Lambda for user reviews CRUD
// DynamoDB table: toolintel-reviews
// Required env: ADMIN_KEY

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = 'toolintel-reviews';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};
    
    try {
        // GET /reviews?tool=X&status=approved - public, get approved reviews
        if (method === 'GET' && path === '/reviews') {
            const tool = query.tool;
            const status = query.status || 'approved';
            
            if (!tool) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'tool required' }) };
            }
            
            const result = await ddb.send(new QueryCommand({
                TableName: TABLE,
                IndexName: 'tool-status-index',
                KeyConditionExpression: 'tool = :tool AND #status = :status',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':tool': tool, ':status': status }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
        }
        
        // GET /reviews/admin?key=X - admin only, get all reviews
        if (method === 'GET' && path === '/reviews/admin') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: TABLE }));
            const items = (result.Items || []).sort((a, b) => 
                new Date(b.createdAt) - new Date(a.createdAt)
            );
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }
        
        // POST /reviews - submit new review
        if (method === 'POST' && path === '/reviews') {
            const body = JSON.parse(event.body || '{}');
            const { tool, name, rating, review } = body;
            
            if (!tool || !name || !rating || !review) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing fields' }) };
            }
            
            if (rating < 1 || rating > 5) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'rating must be 1-5' }) };
            }
            
            if (review.length > 2000) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'review too long' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                tool,
                name: name.substring(0, 100),
                rating: parseInt(rating),
                review: review.substring(0, 2000),
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: item.id }) };
        }
        
        // PATCH /reviews/:id - update status (admin only)
        if (method === 'PATCH' && path.startsWith('/reviews/')) {
            const id = path.split('/').pop();
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            if (!['pending', 'approved', 'rejected'].includes(body.status)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid status' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id },
                UpdateExpression: 'SET #status = :status, updatedAt = :now',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':status': body.status, ':now': new Date().toISOString() }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }
        
        // DELETE /reviews/:id - delete (admin only)
        if (method === 'DELETE' && path.startsWith('/reviews/')) {
            const id = path.split('/').pop();
            
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }
        
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };
        
    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error' }) };
    }
};
