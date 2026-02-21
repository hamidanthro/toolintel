const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_CONCERNS = 'toolintel-independence-concerns';
const TABLE_CERTIFICATIONS = 'toolintel-independence-certifications';
const TABLE_RELATIONSHIPS = 'toolintel-independence-relationships';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

const ADMIN_KEY = process.env.ADMIN_KEY;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS, body: '' };
    }

    const path = event.path;
    const method = event.httpMethod;

    try {
        // Submit a conflict concern (public)
        if (path === '/independence/concern' && method === 'POST') {
            const body = JSON.parse(event.body);
            const concern = {
                id: `concern-${Date.now()}`,
                name: body.name,
                email: body.email,
                toolVendor: body.toolVendor,
                concern: body.concern,
                evidence: body.evidence || '',
                status: 'pending',
                submitted: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_CONCERNS,
                Item: concern
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: concern.id })
            };
        }

        // Get all concerns (admin only)
        if (path === '/independence/concerns' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_CONCERNS
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Update concern status (admin only)
        if (path.startsWith('/independence/concern/') && method === 'PUT') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const concernId = path.split('/').pop();
            const body = JSON.parse(event.body);

            await ddb.send(new UpdateCommand({
                TableName: TABLE_CONCERNS,
                Key: { id: concernId },
                UpdateExpression: 'SET #status = :status, resolution = :resolution, updatedAt = :updatedAt',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': body.status,
                    ':resolution': body.resolution || '',
                    ':updatedAt': new Date().toISOString()
                }
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true })
            };
        }

        // Get certifications (public)
        if (path === '/independence/certifications' && method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_CERTIFICATIONS
            }));

            const sorted = (result.Items || []).sort((a, b) => 
                new Date(b.date) - new Date(a.date)
            );

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(sorted)
            };
        }

        // Add certification (admin only)
        if (path === '/independence/certification' && method === 'POST') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const body = JSON.parse(event.body);
            const cert = {
                id: `cert-${Date.now()}`,
                date: body.date,
                periodStart: body.periodStart,
                periodEnd: body.periodEnd,
                text: body.text,
                signer: body.signer || 'Hamid Ali',
                createdAt: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_CERTIFICATIONS,
                Item: cert
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: cert.id })
            };
        }

        // Get relationships (public)
        if (path === '/independence/relationships' && method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_RELATIONSHIPS
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Add relationship (admin only)
        if (path === '/independence/relationship' && method === 'POST') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const body = JSON.parse(event.body);
            const rel = {
                id: `rel-${Date.now()}`,
                company: body.company,
                type: body.type,
                periodStart: body.periodStart,
                periodEnd: body.periodEnd,
                hasTool: body.hasTool || false,
                notes: body.notes || '',
                createdAt: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_RELATIONSHIPS,
                Item: rel
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: rel.id })
            };
        }

        // Get independence ledger data (public)
        if (path === '/independence/ledger' && method === 'GET') {
            // In production, this would aggregate from the tools database
            // For now, return sample data structure
            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({
                    totalTools: 18,
                    fullyIndependent: 18,
                    disclosed: 0,
                    underReview: 0,
                    lastUpdated: new Date().toISOString()
                })
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
