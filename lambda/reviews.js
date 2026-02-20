// Lambda for user reviews CRUD - Comprehensive version
// DynamoDB table: toolintel-reviews
// Required env: ADMIN_KEY

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ses = new SESClient({ region: 'us-east-1' });

const client = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = 'toolintel-reviews';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

// Send email notification for new review
async function sendReviewNotification(review) {
    const adminUrl = `https://toolintel.ai/admin/?key=${ADMIN_KEY}`;
    
    const subject = `[ToolIntel] New Review: ${review.tool} by ${review.fullName}`;
    const body = `New community review submitted for moderation.

Tool: ${review.tool}
Reviewer: ${review.fullName}
Email: ${review.email}
Job: ${review.jobTitle}
Usage: ${review.usageDuration}
Tier: ${review.pricingTier}
Score: ${'★'.repeat(review.overallScore)}${'☆'.repeat(5-review.overallScore)} (${review.overallScore}/5)

Ratings:
- Does what it claims: ${review.ratingClaims}
- Transparent pricing: ${review.ratingPricing}
- Would recommend: ${review.ratingRecommend}

Review:
${review.reviewText}

---
Approve/Reject: ${adminUrl}
`;

    try {
        await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: [NOTIFY_EMAIL] },
            Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: body } }
            }
        }));
        console.log('Notification email sent');
    } catch (err) {
        console.error('Failed to send notification email:', err);
        // Don't fail the request if email fails
    }
}

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

// Validate word count
function getWordCount(text) {
    return text ? text.trim().split(/\s+/).filter(w => w.length > 0).length : 0;
}

// Basic email validation
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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
            
            // For public view, exclude sensitive fields
            const publicReviews = (result.Items || []).map(r => ({
                id: r.id,
                tool: r.tool,
                fullName: r.fullName,
                jobTitle: r.jobTitle,
                usageDuration: r.usageDuration,
                pricingTier: r.pricingTier,
                ratingClaims: r.ratingClaims,
                ratingPricing: r.ratingPricing,
                ratingRecommend: r.ratingRecommend,
                overallScore: r.overallScore,
                reviewText: r.reviewText,
                createdAt: r.createdAt
                // Excludes: email, disclosure, status, rejectReason
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(publicReviews) };
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
            const { 
                tool, fullName, email, jobTitle, usageDuration, pricingTier,
                ratingClaims, ratingPricing, ratingRecommend, overallScore, reviewText, disclosure
            } = body;
            
            // Validate required fields
            const requiredFields = { tool, fullName, email, jobTitle, usageDuration, pricingTier, ratingClaims, ratingPricing, ratingRecommend, overallScore, reviewText };
            const missingFields = Object.entries(requiredFields).filter(([k, v]) => !v).map(([k]) => k);
            if (missingFields.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing required fields: ${missingFields.join(', ')}` }) };
            }
            
            // Validate email format
            if (!isValidEmail(email)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email format' }) };
            }
            
            // Validate word count (100-500)
            const wordCount = getWordCount(reviewText);
            if (wordCount < 100) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Review must be at least 100 words (currently ${wordCount})` }) };
            }
            if (wordCount > 500) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Review must be at most 500 words (currently ${wordCount})` }) };
            }
            
            // Validate overall score (1-5)
            if (overallScore < 1 || overallScore > 5) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Overall score must be 1-5' }) };
            }
            
            // Validate structured ratings
            const validRatings = ['yes', 'partially', 'no'];
            if (!validRatings.includes(ratingClaims) || !validRatings.includes(ratingPricing) || !validRatings.includes(ratingRecommend)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid rating values' }) };
            }
            
            // Validate usage duration
            const validDurations = ['less-than-1-month', '1-6-months', '6-plus-months'];
            if (!validDurations.includes(usageDuration)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid usage duration' }) };
            }
            
            // Validate pricing tier
            const validTiers = ['free', 'pro', 'team', 'enterprise', 'api'];
            if (!validTiers.includes(pricingTier)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid pricing tier' }) };
            }
            
            // Validate disclosure
            if (!disclosure) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Disclosure checkbox must be confirmed' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                tool,
                fullName: fullName.substring(0, 100),
                email: email.toLowerCase().substring(0, 255),
                jobTitle: jobTitle.substring(0, 200),
                usageDuration,
                pricingTier,
                ratingClaims,
                ratingPricing,
                ratingRecommend,
                overallScore: parseInt(overallScore),
                reviewText: reviewText.substring(0, 5000),
                disclosure: true,
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
            
            // Send email notification (async, don't block response)
            await sendReviewNotification(item);
            
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
            
            const updateExpression = body.rejectReason 
                ? 'SET #status = :status, rejectReason = :reason, updatedAt = :now'
                : 'SET #status = :status, updatedAt = :now';
            
            const expressionValues = body.rejectReason
                ? { ':status': body.status, ':reason': body.rejectReason, ':now': new Date().toISOString() }
                : { ':status': body.status, ':now': new Date().toISOString() };
            
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id },
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: expressionValues
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
