const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NOMINATIONS = 'toolintel-peer-nominations';
const TABLE_CRITIQUES = 'toolintel-peer-critiques';
const TABLE_FEEDBACK = 'toolintel-peer-feedback';
const TABLE_CYCLES = 'toolintel-peer-cycles';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

const ADMIN_KEY = process.env.ADMIN_KEY;

exports.handler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    
    if (method === 'OPTIONS') {
        return { statusCode: 200, headers: CORS, body: '' };
    }

    const path = event.rawPath || event.path;

    try {
        // Submit nomination (public)
        if (path === '/peer-review/nomination' && method === 'POST') {
            const body = JSON.parse(event.body);
            const nomination = {
                id: `nom-${Date.now()}`,
                nomineeName: body.nomineeName,
                nomineeEmail: body.nomineeEmail,
                nomineeTitle: body.nomineeTitle,
                expertise: body.nomineeExpertise,
                rationale: body.nomineeRationale,
                nominatorName: body.nominatorName,
                nominatorEmail: body.nominatorEmail,
                stage: 'nominated',
                cycle: '2026',
                submitted: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_NOMINATIONS,
                Item: nomination
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: nomination.id })
            };
        }

        // Get nominations (admin only)
        if (path === '/peer-review/nominations' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_NOMINATIONS
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Update nomination stage (admin only)
        if (path.startsWith('/peer-review/nomination/') && method === 'PUT') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const nominationId = path.split('/').pop();
            const body = JSON.parse(event.body);

            await ddb.send(new UpdateCommand({
                TableName: TABLE_NOMINATIONS,
                Key: { id: nominationId },
                UpdateExpression: 'SET stage = :stage, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':stage': body.stage,
                    ':updatedAt': new Date().toISOString()
                }
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true })
            };
        }

        // Submit community feedback (public)
        if (path === '/peer-review/feedback' && method === 'POST') {
            const body = JSON.parse(event.body);
            const feedback = {
                id: `fb-${Date.now()}`,
                name: body.name,
                email: body.email,
                context: body.context || '',
                element: body.element,
                concern: body.concern,
                evidence: body.evidence || '',
                status: 'pending',
                submitted: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_FEEDBACK,
                Item: feedback
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: feedback.id })
            };
        }

        // Get feedback (admin only)
        if (path === '/peer-review/feedback/admin' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_FEEDBACK
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Get published critiques (public)
        if (path === '/peer-review/critiques' && method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_CRITIQUES,
                FilterExpression: 'published = :pub',
                ExpressionAttributeValues: { ':pub': true }
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Add critique (admin only)
        if (path === '/peer-review/critique' && method === 'POST') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const body = JSON.parse(event.body);
            const critique = {
                id: `crit-${Date.now()}`,
                criticId: body.criticId,
                criticName: body.criticName,
                criticTitle: body.criticTitle,
                overallAssessment: body.overallAssessment,
                strengths: body.strengths,
                weaknesses: body.weaknesses,
                recommendations: body.recommendations,
                response: body.response || [],
                impactBadge: body.impactBadge || 'pending',
                cycle: body.cycle || '2026',
                published: false,
                submitted: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_CRITIQUES,
                Item: critique
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: critique.id })
            };
        }

        // Get stats (public)
        if (path === '/peer-review/stats' && method === 'GET') {
            const [nominations, critiques] = await Promise.all([
                ddb.send(new ScanCommand({ TableName: TABLE_NOMINATIONS })),
                ddb.send(new ScanCommand({ TableName: TABLE_CRITIQUES }))
            ]);

            const nomItems = nominations.Items || [];
            const critItems = critiques.Items || [];

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({
                    nominations: nomItems.length,
                    accepted: nomItems.filter(n => ['accepted', 'reviewing', 'submitted'].includes(n.stage)).length,
                    critiquesPublished: critItems.filter(c => c.published).length
                })
            };
        }

        // Get current cycle (public)
        if (path === '/peer-review/cycle' && method === 'GET') {
            const year = event.queryStringParameters?.year || '2026';
            
            const result = await ddb.send(new GetCommand({
                TableName: TABLE_CYCLES,
                Key: { id: year }
            }));

            if (result.Item) {
                return {
                    statusCode: 200,
                    headers: CORS,
                    body: JSON.stringify(result.Item)
                };
            }

            // Return default cycle
            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({
                    id: '2026',
                    currentStage: 2,
                    stages: [
                        { name: 'Methodology Published', date: '2026-02-01', completed: true },
                        { name: 'Nominations Open', date: '2026-02-15', active: true },
                        { name: 'Review Period', startDate: '2026-03-16', endDate: '2026-05-15' },
                        { name: 'Critiques Published', date: '2026-05-16' },
                        { name: 'Response & Update', date: '2026-06-15' }
                    ]
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
