const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_CERTS = 'toolintel-certifications';
const TABLE_VERIFICATIONS = 'toolintel-cert-verifications';
const TABLE_SUBMISSIONS = 'toolintel-cert-submissions';

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
        // Get public stats
        if (path === '/certifications/stats' && method === 'GET') {
            const [certs, submissions] = await Promise.all([
                ddb.send(new ScanCommand({ TableName: TABLE_CERTS })),
                ddb.send(new ScanCommand({ TableName: TABLE_SUBMISSIONS }))
            ]);

            const certItems = certs.Items || [];
            const subItems = submissions.Items || [];

            const verified = certItems.filter(c => c.status === 'verified').length;
            const tools = [...new Set(certItems.map(c => c.toolId))].length;
            const pending = subItems.filter(s => s.status === 'pending').length;

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ verified, tools, pending })
            };
        }

        // Submit certification for verification (public)
        if (path === '/certifications/submit' && method === 'POST') {
            const body = JSON.parse(event.body);
            const submission = {
                id: `sub-${Date.now()}`,
                toolName: body.toolName,
                vendorName: body.vendorName,
                contactName: body.contactName,
                contactEmail: body.contactEmail,
                certType: body.certType,
                issuingBody: body.issuingBody,
                issueDate: body.issueDate,
                expirationDate: body.expirationDate,
                certNumber: body.certNumber || '',
                registryUrl: body.registryUrl || '',
                status: 'pending',
                submitted: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_SUBMISSIONS,
                Item: submission
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, id: submission.id })
            };
        }

        // Get leaderboard (public)
        if (path === '/certifications/leaderboard' && method === 'GET') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_CERTS,
                FilterExpression: '#status = :verified',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':verified': 'verified' }
            }));

            const certs = result.Items || [];
            
            // Group by tool and count
            const toolCounts = {};
            certs.forEach(cert => {
                if (!toolCounts[cert.toolId]) {
                    toolCounts[cert.toolId] = {
                        toolId: cert.toolId,
                        toolName: cert.toolName,
                        vendorName: cert.vendorName,
                        certs: []
                    };
                }
                toolCounts[cert.toolId].certs.push(cert.certType);
            });

            // Sort by count
            const leaderboard = Object.values(toolCounts)
                .map(t => ({ ...t, count: t.certs.length }))
                .sort((a, b) => b.count - a.count);

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(leaderboard)
            };
        }

        // Get certifications for a tool (public)
        if (path.startsWith('/certifications/tool/') && method === 'GET') {
            const toolId = path.split('/').pop();
            
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_CERTS,
                FilterExpression: 'toolId = :toolId',
                ExpressionAttributeValues: { ':toolId': toolId }
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Admin: Get all submissions
        if (path === '/certifications/admin/submissions' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_SUBMISSIONS
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
            };
        }

        // Admin: Get all certifications
        if (path === '/certifications/admin' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_CERTS
            }));

            const items = result.Items || [];
            const now = new Date();
            const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({
                    certifications: items,
                    stats: {
                        verified: items.filter(c => c.status === 'verified').length,
                        pending: items.filter(c => c.status === 'pending').length,
                        verifying: items.filter(c => c.status === 'verifying').length,
                        expiring: items.filter(c => c.status === 'verified' && new Date(c.expirationDate) <= in90Days && new Date(c.expirationDate) > now).length,
                        expired: items.filter(c => c.status === 'expired' || (c.status === 'verified' && new Date(c.expirationDate) <= now)).length
                    }
                })
            };
        }

        // Admin: Start verification
        if (path === '/certifications/admin/verify' && method === 'POST') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const body = JSON.parse(event.body);
            
            // Update submission status
            await ddb.send(new UpdateCommand({
                TableName: TABLE_SUBMISSIONS,
                Key: { id: body.submissionId },
                UpdateExpression: 'SET #status = :status, updatedAt = :now',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'verifying',
                    ':now': new Date().toISOString()
                }
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true })
            };
        }

        // Admin: Complete verification
        if (path === '/certifications/admin/complete' && method === 'POST') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const body = JSON.parse(event.body);
            const now = new Date().toISOString();

            // Create certification record
            const certification = {
                id: `cert-${Date.now()}`,
                toolId: body.toolId,
                toolName: body.toolName,
                vendorName: body.vendorName,
                certType: body.certType,
                issuingBody: body.issuingBody,
                issueDate: body.issueDate,
                expirationDate: body.expirationDate,
                certNumber: body.certNumber || '',
                status: body.outcome === 'verified' ? 'verified' : 'not-verified',
                verifiedAt: now,
                verificationMethod: body.method,
                verificationSource: body.source,
                verificationDocument: body.document,
                createdAt: now,
                updatedAt: now
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_CERTS,
                Item: certification
            }));

            // Log verification
            const verification = {
                id: `ver-${Date.now()}`,
                certificationId: certification.id,
                toolName: body.toolName,
                certType: body.certType,
                action: 'verification',
                method: body.method,
                source: body.source,
                document: body.document,
                outcome: body.outcome,
                notes: body.notes || '',
                timestamp: now
            };

            await ddb.send(new PutCommand({
                TableName: TABLE_VERIFICATIONS,
                Item: verification
            }));

            // Update submission status
            if (body.submissionId) {
                await ddb.send(new UpdateCommand({
                    TableName: TABLE_SUBMISSIONS,
                    Key: { id: body.submissionId },
                    UpdateExpression: 'SET #status = :status, certificationId = :certId, updatedAt = :now',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':status': 'completed',
                        ':certId': certification.id,
                        ':now': now
                    }
                }));
            }

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({ success: true, certificationId: certification.id })
            };
        }

        // Admin: Get verification history
        if (path === '/certifications/admin/history' && method === 'GET') {
            const key = event.queryStringParameters?.key;
            if (key !== ADMIN_KEY) {
                return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
            }

            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_VERIFICATIONS
            }));

            const sorted = (result.Items || []).sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(sorted)
            };
        }

        // Get verification evidence for a certification (public)
        if (path.startsWith('/certifications/evidence/') && method === 'GET') {
            const certId = path.split('/').pop();
            
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE_VERIFICATIONS,
                FilterExpression: 'certificationId = :certId',
                ExpressionAttributeValues: { ':certId': certId }
            }));

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify(result.Items || [])
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
