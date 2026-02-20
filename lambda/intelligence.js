// Lambda for Category Trend Intelligence System
// DynamoDB tables: toolintel-intelligence, toolintel-intelligence-subscribers

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });

const INTELLIGENCE_TABLE = 'toolintel-intelligence';
const SUBSCRIBERS_TABLE = 'toolintel-intelligence-subscribers';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getCurrentQuarter() {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    return `Q${q}-${now.getFullYear()}`;
}

function getPreviousQuarter(quarter) {
    const [q, year] = quarter.replace('Q', '').split('-').map(Number);
    if (q === 1) return `Q4-${year - 1}`;
    return `Q${q - 1}-${year}`;
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

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /intelligence - get current quarter data (public)
        if (method === 'GET' && path === '/intelligence') {
            const currentQ = query.quarter || getCurrentQuarter();
            const prevQ = getPreviousQuarter(currentQ);
            
            // Get current quarter data
            const currentResult = await ddb.send(new GetCommand({
                TableName: INTELLIGENCE_TABLE,
                Key: { quarter: currentQ, recordType: 'SUMMARY' }
            }));
            
            // Get previous quarter for comparison
            const prevResult = await ddb.send(new GetCommand({
                TableName: INTELLIGENCE_TABLE,
                Key: { quarter: prevQ, recordType: 'SUMMARY' }
            }));
            
            // Get quarterly report
            const reportResult = await ddb.send(new GetCommand({
                TableName: INTELLIGENCE_TABLE,
                Key: { quarter: currentQ, recordType: 'REPORT' }
            }));
            
            // Get compliance trend (last 4 quarters)
            const complianceTrend = await getComplianceTrend(currentQ);
            
            // Get leaderboards
            const leaderboards = await ddb.send(new GetCommand({
                TableName: INTELLIGENCE_TABLE,
                Key: { quarter: currentQ, recordType: 'LEADERBOARDS' }
            }));
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    quarter: currentQ,
                    previousQuarter: prevQ,
                    summary: currentResult.Item || null,
                    previousSummary: prevResult.Item || null,
                    report: reportResult.Item || null,
                    complianceTrend,
                    leaderboards: leaderboards.Item || null
                }) 
            };
        }

        // GET /intelligence/categories - get category grid data (public)
        if (method === 'GET' && path === '/intelligence/categories') {
            const currentQ = query.quarter || getCurrentQuarter();
            
            const result = await ddb.send(new QueryCommand({
                TableName: INTELLIGENCE_TABLE,
                KeyConditionExpression: 'quarter = :q AND begins_with(recordType, :prefix)',
                ExpressionAttributeValues: { 
                    ':q': currentQ,
                    ':prefix': 'CATEGORY#'
                }
            }));
            
            const categories = (result.Items || []).map(item => ({
                category: item.category,
                avgScore: item.avgScore,
                prevAvgScore: item.prevAvgScore,
                scoreDiff: item.scoreDiff,
                toolCount: item.toolCount,
                biggestImprovement: item.biggestImprovement,
                biggestDecline: item.biggestDecline
            })).sort((a, b) => (a.category || '').localeCompare(b.category || ''));
            
            return { statusCode: 200, headers, body: JSON.stringify(categories) };
        }

        // GET /intelligence/report/:quarter - get specific quarter report (public)
        if (method === 'GET' && path.match(/^\/intelligence\/report\/Q\d-\d{4}$/)) {
            const quarter = path.split('/').pop();
            
            const result = await ddb.send(new GetCommand({
                TableName: INTELLIGENCE_TABLE,
                Key: { quarter, recordType: 'REPORT' }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Item || null) };
        }

        // POST /intelligence/subscribe - subscribe to quarterly reports (public)
        if (method === 'POST' && path === '/intelligence/subscribe') {
            const body = JSON.parse(event.body || '{}');
            const { email } = body;
            
            if (!email || !isValidEmail(email)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid email required' }) };
            }
            
            const subId = crypto.randomUUID();
            const item = {
                subscriptionId: subId,
                email: email.toLowerCase(),
                createdAt: new Date().toISOString(),
                active: true
            };
            
            await ddb.send(new PutCommand({ TableName: SUBSCRIBERS_TABLE, Item: item }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
        }

        // GET /intelligence/admin/draft - get draft summary for current quarter (admin)
        if (method === 'GET' && path === '/intelligence/admin/draft') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const currentQ = query.quarter || getCurrentQuarter();
            
            // Get all category data
            const catResult = await ddb.send(new QueryCommand({
                TableName: INTELLIGENCE_TABLE,
                KeyConditionExpression: 'quarter = :q AND begins_with(recordType, :prefix)',
                ExpressionAttributeValues: { ':q': currentQ, ':prefix': 'CATEGORY#' }
            }));
            
            const categories = catResult.Items || [];
            const flagged = categories.filter(c => Math.abs(c.scoreDiff || 0) >= 3);
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    quarter: currentQ,
                    categories,
                    flaggedCategories: flagged,
                    needsAttention: flagged.length > 0
                }) 
            };
        }

        // GET /intelligence/admin/subscribers - get all subscribers (admin)
        if (method === 'GET' && path === '/intelligence/admin/subscribers') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: SUBSCRIBERS_TABLE }));
            return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
        }

        // POST /intelligence/admin/calculate - calculate quarterly data (admin)
        if (method === 'POST' && path === '/intelligence/admin/calculate') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const quarter = body.quarter || getCurrentQuarter();
            const prevQ = getPreviousQuarter(quarter);
            const { categoryData, toolScores } = body;
            
            if (!categoryData || !Array.isArray(categoryData)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'categoryData array required' }) };
            }
            
            // Store category data
            for (const cat of categoryData) {
                await ddb.send(new PutCommand({
                    TableName: INTELLIGENCE_TABLE,
                    Item: {
                        quarter,
                        recordType: `CATEGORY#${cat.category}`,
                        category: cat.category,
                        avgScore: cat.avgScore,
                        prevAvgScore: cat.prevAvgScore || null,
                        scoreDiff: cat.prevAvgScore ? (cat.avgScore - cat.prevAvgScore) : null,
                        toolCount: cat.toolCount,
                        biggestImprovement: cat.biggestImprovement || null,
                        biggestDecline: cat.biggestDecline || null,
                        updatedAt: new Date().toISOString()
                    }
                }));
            }
            
            // Calculate summary
            const totalTools = categoryData.reduce((sum, c) => sum + (c.toolCount || 0), 0);
            const avgPlatformScore = categoryData.length > 0 
                ? Math.round(categoryData.reduce((sum, c) => sum + (c.avgScore || 0), 0) / categoryData.length)
                : 0;
            
            await ddb.send(new PutCommand({
                TableName: INTELLIGENCE_TABLE,
                Item: {
                    quarter,
                    recordType: 'SUMMARY',
                    totalTools,
                    totalCategories: categoryData.length,
                    avgPlatformScore,
                    updatedAt: new Date().toISOString()
                }
            }));
            
            // Store leaderboards if provided
            if (toolScores) {
                const sorted = [...toolScores].sort((a, b) => (b.scoreDiff || 0) - (a.scoreDiff || 0));
                const mostImproved = sorted.filter(t => (t.scoreDiff || 0) > 0).slice(0, 5);
                const mostDeclined = sorted.filter(t => (t.scoreDiff || 0) < 0).slice(0, 5);
                
                await ddb.send(new PutCommand({
                    TableName: INTELLIGENCE_TABLE,
                    Item: {
                        quarter,
                        recordType: 'LEADERBOARDS',
                        mostImproved,
                        mostDeclined,
                        updatedAt: new Date().toISOString()
                    }
                }));
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, quarter }) };
        }

        // POST /intelligence/admin/publish-report - publish quarterly report (admin)
        if (method === 'POST' && path === '/intelligence/admin/publish-report') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { quarter, title, summary, content, categoryHighlights, complianceData } = body;
            
            if (!quarter || !summary || !content) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'quarter, summary, and content required' }) };
            }
            
            await ddb.send(new PutCommand({
                TableName: INTELLIGENCE_TABLE,
                Item: {
                    quarter,
                    recordType: 'REPORT',
                    title: title || `${quarter} Trend Report`,
                    summary,
                    content,
                    categoryHighlights: categoryHighlights || [],
                    complianceData: complianceData || null,
                    publishedAt: new Date().toISOString(),
                    status: 'published'
                }
            }));
            
            // Store compliance trend data if provided
            if (complianceData) {
                await ddb.send(new PutCommand({
                    TableName: INTELLIGENCE_TABLE,
                    Item: {
                        quarter,
                        recordType: 'COMPLIANCE',
                        dataPrivacy: complianceData.dataPrivacy,
                        compliance: complianceData.compliance,
                        transparency: complianceData.transparency,
                        updatedAt: new Date().toISOString()
                    }
                }));
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /intelligence/admin/send-quarterly-email - send to all subscribers (admin)
        if (method === 'POST' && path === '/intelligence/admin/send-quarterly-email') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { quarter, summaryText, pdfUrl } = body;
            
            if (!quarter || !summaryText) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'quarter and summaryText required' }) };
            }
            
            // Get subscribers
            const subsResult = await ddb.send(new ScanCommand({
                TableName: SUBSCRIBERS_TABLE,
                FilterExpression: 'active = :active',
                ExpressionAttributeValues: { ':active': true }
            }));
            
            const subscribers = subsResult.Items || [];
            const subject = `[ToolIntel] ${quarter} Quarterly Trend Report`;
            
            let emailBody = `${quarter} AI Tools Market Trend Report\n`;
            emailBody += `${'='.repeat(50)}\n\n`;
            emailBody += `${summaryText}\n\n`;
            if (pdfUrl) {
                emailBody += `Download full report: ${pdfUrl}\n\n`;
            }
            emailBody += `View online: https://toolintel.ai/intelligence\n\n`;
            emailBody += `${'—'.repeat(50)}\n`;
            emailBody += `You received this because you subscribed to ToolIntel quarterly reports.\n`;
            emailBody += `To unsubscribe, reply with "unsubscribe".`;
            
            let sent = 0;
            for (const sub of subscribers) {
                const success = await sendNotification(sub.email, subject, emailBody);
                if (success) sent++;
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent, total: subscribers.length }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};

// Get compliance trend for last 4 quarters
async function getComplianceTrend(currentQuarter) {
    const quarters = [currentQuarter];
    let q = currentQuarter;
    for (let i = 0; i < 3; i++) {
        q = getPreviousQuarter(q);
        quarters.push(q);
    }
    
    const trend = [];
    for (const quarter of quarters.reverse()) {
        try {
            const result = await ddb.send(new GetCommand({
                TableName: INTELLIGENCE_TABLE,
                Key: { quarter, recordType: 'COMPLIANCE' }
            }));
            if (result.Item) {
                trend.push({
                    quarter,
                    dataPrivacy: result.Item.dataPrivacy,
                    compliance: result.Item.compliance,
                    transparency: result.Item.transparency
                });
            }
        } catch (err) {
            // Quarter data doesn't exist
        }
    }
    
    return trend;
}
