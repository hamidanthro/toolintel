// Lambda for certification verification system
// DynamoDB table: toolintel-certifications
// S3 bucket: toolintel-certifications-pdfs

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const s3 = new S3Client({ region: 'us-east-1' });
const ses = new SESClient({ region: 'us-east-1' });

const TABLE = 'toolintel-certifications';
const BUCKET = 'toolintel-certifications-pdfs';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const CERT_TYPES = [
    'SOC 2 Type I',
    'SOC 2 Type II', 
    'ISO 27001',
    'HIPAA BAA',
    'GDPR Compliance Documentation',
    'EU AI Act Conformity Assessment',
    'FedRAMP',
    'HITRUST',
    'Other'
];

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDate(dateStr) {
    const d = new Date(dateStr);
    return d instanceof Date && !isNaN(d);
}

async function sendNotificationEmail(subject, body) {
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

    // Handle CORS preflight
    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /certifications/upload-url - get presigned URL for PDF upload
        if (method === 'GET' && path === '/certifications/upload-url') {
            const filename = query.filename;
            if (!filename) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'filename required' }) };
            }
            
            const key = `pending/${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const command = new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                ContentType: 'application/pdf'
            });
            
            const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
            return { statusCode: 200, headers, body: JSON.stringify({ uploadUrl, key }) };
        }

        // GET /certifications?toolSlug=X&status=verified - get verified certs for a tool (public)
        if (method === 'GET' && path === '/certifications' && query.toolSlug) {
            const status = query.status || 'verified';
            
            const result = await ddb.send(new QueryCommand({
                TableName: TABLE,
                IndexName: 'tool-status-index',
                KeyConditionExpression: 'toolSlug = :tool AND #status = :status',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':tool': query.toolSlug, ':status': status }
            }));
            
            // Return public fields only
            const certs = (result.Items || []).map(c => ({
                id: c.id,
                toolSlug: c.toolSlug,
                companyName: c.companyName,
                toolName: c.toolName,
                certType: c.certType,
                issuingBody: c.issuingBody,
                auditDate: c.auditDate,
                expirationDate: c.expirationDate,
                verifiedAt: c.verifiedAt,
                status: c.status
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(certs) };
        }

        // GET /certifications/public - get all verified certs (public registry)
        if (method === 'GET' && path === '/certifications/public') {
            const result = await ddb.send(new ScanCommand({
                TableName: TABLE,
                FilterExpression: '#status = :verified',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':verified': 'verified' }
            }));
            
            const certs = (result.Items || []).map(c => ({
                id: c.id,
                toolSlug: c.toolSlug,
                companyName: c.companyName,
                toolName: c.toolName,
                certType: c.certType,
                issuingBody: c.issuingBody,
                auditDate: c.auditDate,
                expirationDate: c.expirationDate,
                verifiedAt: c.verifiedAt
            })).sort((a, b) => a.toolName.localeCompare(b.toolName));
            
            return { statusCode: 200, headers, body: JSON.stringify(certs) };
        }

        // GET /certifications/admin - get all certs (admin only)
        if (method === 'GET' && path === '/certifications/admin') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: TABLE }));
            const items = (result.Items || []).sort((a, b) => 
                new Date(b.submittedAt) - new Date(a.submittedAt)
            );
            
            // Add expiring soon flag (within 60 days)
            const now = new Date();
            const sixtyDays = 60 * 24 * 60 * 60 * 1000;
            items.forEach(item => {
                if (item.status === 'verified' && item.expirationDate) {
                    const exp = new Date(item.expirationDate);
                    item.expiringSoon = (exp - now) < sixtyDays && (exp - now) > 0;
                    item.isExpired = exp < now;
                }
            });
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        // GET /certifications/pdf/:key - get presigned URL to view PDF (admin)
        if (method === 'GET' && path.startsWith('/certifications/pdf/')) {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const pdfKey = decodeURIComponent(path.replace('/certifications/pdf/', ''));
            const command = new GetObjectCommand({ Bucket: BUCKET, Key: pdfKey });
            const viewUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
            
            return { statusCode: 200, headers, body: JSON.stringify({ viewUrl }) };
        }

        // POST /certifications - submit new certification
        if (method === 'POST' && path === '/certifications') {
            const body = JSON.parse(event.body || '{}');
            const {
                toolSlug, companyName, toolName, certType, issuingBody,
                auditDate, expirationDate, pdfKey, contactEmail, confirmation
            } = body;
            
            // Validate required fields
            const required = { toolSlug, companyName, toolName, certType, issuingBody, auditDate, expirationDate, pdfKey, contactEmail };
            const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing required fields: ${missing.join(', ')}` }) };
            }
            
            if (!confirmation) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Confirmation checkbox required' }) };
            }
            
            if (!isValidEmail(contactEmail)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email format' }) };
            }
            
            if (!CERT_TYPES.includes(certType)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid certification type' }) };
            }
            
            if (!isValidDate(auditDate) || !isValidDate(expirationDate)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid date format' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                toolSlug,
                companyName: companyName.substring(0, 200),
                toolName: toolName.substring(0, 200),
                certType,
                issuingBody: issuingBody.substring(0, 200),
                auditDate,
                expirationDate,
                pdfKey,
                contactEmail: contactEmail.toLowerCase(),
                status: 'pending',
                submittedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
            
            // Send notification
            await sendNotificationEmail(
                `[ToolIntel] New Certification: ${toolName} - ${certType}`,
                `New certification submission for verification.

Tool: ${toolName} (${toolSlug})
Company: ${companyName}
Certification: ${certType}
Issuing Body: ${issuingBody}
Audit Date: ${auditDate}
Expiration: ${expirationDate}
Contact: ${contactEmail}

Review: https://toolintel.ai/admin/certifications.html?key=${ADMIN_KEY}
`
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: item.id }) };
        }

        // PATCH /certifications/:id - update status (admin only)
        if (method === 'PATCH' && path.startsWith('/certifications/') && !path.includes('/pdf/')) {
            const id = path.split('/').pop();
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const validStatuses = ['pending', 'under-review', 'verified', 'rejected'];
            if (!validStatuses.includes(body.status)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid status' }) };
            }
            
            if (body.status === 'rejected' && !body.rejectionReason) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Rejection reason required' }) };
            }
            
            const updateExpr = body.status === 'verified'
                ? 'SET #status = :status, verifiedAt = :now, verificationNotes = :notes'
                : body.status === 'rejected'
                    ? 'SET #status = :status, rejectedAt = :now, rejectionReason = :reason, verificationNotes = :notes'
                    : 'SET #status = :status, verificationNotes = :notes';
            
            const exprValues = {
                ':status': body.status,
                ':now': new Date().toISOString(),
                ':notes': body.verificationNotes || ''
            };
            if (body.status === 'rejected') {
                exprValues[':reason'] = body.rejectionReason;
            }
            
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id },
                UpdateExpression: updateExpr,
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: exprValues
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
