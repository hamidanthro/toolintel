// Lambda for Hype vs Reality Index System
// DynamoDB table: toolintel-hype-index

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const HYPE_TABLE = 'toolintel-hype-index';
const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const HYPE_STATUS = ['Overrated', 'Fairly Rated', 'Underrated', 'Emerging'];
const SENTIMENT_VALUES = ['Positive', 'Neutral', 'Negative', 'Mixed'];

// Calculate hype status from score gap
function calculateHypeStatus(mediaSentiment, independentScore) {
    if (mediaSentiment === null || mediaSentiment === undefined) {
        return { status: 'Emerging', color: 'gray' };
    }
    
    const gap = mediaSentiment - independentScore;
    
    if (gap >= 10) return { status: 'Overrated', color: 'red', gap };
    if (gap <= -10) return { status: 'Underrated', color: 'blue', gap };
    return { status: 'Fairly Rated', color: 'green', gap };
}

// Generate explanation text
function generateExplanation(toolName, status, gap, mediaSentiment, independentScore) {
    if (status === 'Emerging') {
        return `${toolName} has insufficient media coverage to calculate a reliable sentiment score.`;
    }
    
    const absGap = Math.abs(gap);
    
    if (status === 'Overrated') {
        return `${toolName} receives overwhelmingly positive press coverage. Our independent score is ${absGap} points below the implied media sentiment.`;
    }
    
    if (status === 'Underrated') {
        return `${toolName} scores ${absGap} points higher in our independent review than media sentiment suggests. It may be flying under the radar.`;
    }
    
    return `${toolName}'s media coverage closely matches our independent score, suggesting accurate market perception.`;
}

function getCurrentQuarter() {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    return `Q${q}-${now.getFullYear()}`;
}

exports.handler = async (event) => {
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;
    const query = event.queryStringParameters || {};

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // GET /hype-index?toolSlug=X - get hype data for a tool (public)
        if (method === 'GET' && path === '/hype-index' && query.toolSlug) {
            const result = await ddb.send(new QueryCommand({
                TableName: HYPE_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': query.toolSlug }
            }));
            
            const items = result.Items || [];
            const current = items.find(i => i.recordType === 'CURRENT');
            const sources = items.filter(i => i.recordType.startsWith('SOURCE#'));
            const history = items.filter(i => i.recordType.startsWith('HISTORY#'))
                .sort((a, b) => b.quarter.localeCompare(a.quarter));
            
            if (!current) {
                return { 
                    statusCode: 200, 
                    headers, 
                    body: JSON.stringify({ 
                        hasData: false,
                        hypeStatus: { status: 'Emerging', color: 'gray' },
                        explanation: 'This tool has not yet been analyzed for media sentiment.',
                        sources: [],
                        history: []
                    }) 
                };
            }
            
            const hypeStatus = calculateHypeStatus(current.mediaSentiment, current.independentScore);
            const explanation = generateExplanation(
                current.toolName || query.toolSlug,
                hypeStatus.status,
                hypeStatus.gap,
                current.mediaSentiment,
                current.independentScore
            );
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    hasData: true,
                    mediaSentiment: current.mediaSentiment,
                    independentScore: current.independentScore,
                    hypeStatus,
                    explanation,
                    sources: sources.map(s => ({
                        publication: s.publication,
                        sentiment: s.sentiment,
                        lastCoverageDate: s.lastCoverageDate,
                        articleUrl: s.articleUrl
                    })).slice(0, 10),
                    history: history.map(h => ({
                        quarter: h.quarter,
                        mediaSentiment: h.mediaSentiment,
                        independentScore: h.independentScore,
                        gap: h.gap,
                        status: h.status
                    })),
                    lastUpdated: current.updatedAt
                }) 
            };
        }

        // GET /hype-index/leaderboard - get full leaderboard (public)
        if (method === 'GET' && path === '/hype-index/leaderboard') {
            const result = await ddb.send(new ScanCommand({
                TableName: HYPE_TABLE,
                FilterExpression: 'recordType = :current',
                ExpressionAttributeValues: { ':current': 'CURRENT' }
            }));
            
            const tools = (result.Items || [])
                .filter(t => t.mediaSentiment !== null && t.mediaSentiment !== undefined)
                .map(t => {
                    const gap = t.mediaSentiment - t.independentScore;
                    const status = calculateHypeStatus(t.mediaSentiment, t.independentScore);
                    return {
                        toolSlug: t.toolSlug,
                        toolName: t.toolName,
                        category: t.category,
                        mediaSentiment: t.mediaSentiment,
                        independentScore: t.independentScore,
                        gap,
                        absGap: Math.abs(gap),
                        status: status.status
                    };
                })
                .sort((a, b) => b.gap - a.gap); // Overrated (positive gap) first
            
            const overrated = tools.filter(t => t.gap > 0);
            const underrated = tools.filter(t => t.gap < 0).reverse(); // Most underrated first
            const fairlyRated = tools.filter(t => t.gap === 0 || (t.gap > -10 && t.gap < 10 && t.status === 'Fairly Rated'));
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    overrated,
                    underrated,
                    fairlyRated,
                    totalTools: tools.length
                }) 
            };
        }

        // GET /hype-index/quarterly-report - get quarterly hype report (public)
        if (method === 'GET' && path === '/hype-index/quarterly-report') {
            const quarter = query.quarter || getCurrentQuarter();
            
            const result = await ddb.send(new GetCommand({
                TableName: HYPE_TABLE,
                Key: { toolSlug: '_QUARTERLY_REPORT', recordType: `REPORT#${quarter}` }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Item || null) };
        }

        // GET /hype-index/admin/all - get all tools with hype data (admin)
        if (method === 'GET' && path === '/hype-index/admin/all') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({
                TableName: HYPE_TABLE,
                FilterExpression: 'recordType = :current',
                ExpressionAttributeValues: { ':current': 'CURRENT' }
            }));
            
            const tools = (result.Items || []).map(t => {
                const status = calculateHypeStatus(t.mediaSentiment, t.independentScore);
                return {
                    ...t,
                    hypeStatus: status,
                    gap: status.gap
                };
            }).sort((a, b) => Math.abs(b.gap || 0) - Math.abs(a.gap || 0));
            
            return { statusCode: 200, headers, body: JSON.stringify(tools) };
        }

        // GET /hype-index/admin/flagged - get tools with significant gap changes (admin)
        if (method === 'GET' && path === '/hype-index/admin/flagged') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({
                TableName: HYPE_TABLE,
                FilterExpression: 'recordType = :current AND flagged = :true',
                ExpressionAttributeValues: { ':current': 'CURRENT', ':true': true }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify(result.Items || []) };
        }

        // POST /hype-index/admin/update - update hype data for a tool (admin)
        if (method === 'POST' && path === '/hype-index/admin/update') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, category, mediaSentiment, independentScore, flagged } = body;
            
            if (!toolSlug || independentScore === undefined) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and independentScore required' }) };
            }
            
            // Get previous data for history
            const prevResult = await ddb.send(new GetCommand({
                TableName: HYPE_TABLE,
                Key: { toolSlug, recordType: 'CURRENT' }
            }));
            const prev = prevResult.Item;
            
            // Calculate if gap changed significantly
            const newGap = mediaSentiment !== null ? mediaSentiment - independentScore : null;
            const prevGap = prev?.mediaSentiment !== null ? (prev?.mediaSentiment - prev?.independentScore) : null;
            const gapChanged = prevGap !== null && newGap !== null && Math.abs(newGap - prevGap) >= 5;
            
            // Save current
            await ddb.send(new PutCommand({
                TableName: HYPE_TABLE,
                Item: {
                    toolSlug,
                    recordType: 'CURRENT',
                    toolName: toolName || toolSlug,
                    category: category || null,
                    mediaSentiment: mediaSentiment !== undefined ? mediaSentiment : null,
                    independentScore,
                    flagged: flagged || gapChanged || false,
                    updatedAt: new Date().toISOString()
                }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, gapChanged }) };
        }

        // POST /hype-index/admin/add-source - add media source for a tool (admin)
        if (method === 'POST' && path === '/hype-index/admin/add-source') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, publication, sentiment, lastCoverageDate, articleUrl } = body;
            
            if (!toolSlug || !publication || !sentiment) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug, publication, and sentiment required' }) };
            }
            
            if (!SENTIMENT_VALUES.includes(sentiment)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid sentiment. Must be: ${SENTIMENT_VALUES.join(', ')}` }) };
            }
            
            const sourceId = crypto.randomUUID();
            await ddb.send(new PutCommand({
                TableName: HYPE_TABLE,
                Item: {
                    toolSlug,
                    recordType: `SOURCE#${sourceId}`,
                    sourceId,
                    publication,
                    sentiment,
                    lastCoverageDate: lastCoverageDate || new Date().toISOString().split('T')[0],
                    articleUrl: articleUrl || null,
                    addedAt: new Date().toISOString()
                }
            }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, sourceId }) };
        }

        // DELETE /hype-index/admin/remove-source - remove media source (admin)
        if (method === 'DELETE' && path === '/hype-index/admin/remove-source') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, sourceId } = body;
            
            if (!toolSlug || !sourceId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and sourceId required' }) };
            }
            
            await ddb.send(new DeleteCommand({
                TableName: HYPE_TABLE,
                Key: { toolSlug, recordType: `SOURCE#${sourceId}` }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /hype-index/admin/save-history - save quarterly history snapshot (admin)
        if (method === 'POST' && path === '/hype-index/admin/save-history') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, quarter, mediaSentiment, independentScore } = body;
            
            if (!toolSlug || !quarter) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and quarter required' }) };
            }
            
            const gap = mediaSentiment !== null ? mediaSentiment - independentScore : null;
            const status = calculateHypeStatus(mediaSentiment, independentScore);
            
            await ddb.send(new PutCommand({
                TableName: HYPE_TABLE,
                Item: {
                    toolSlug,
                    recordType: `HISTORY#${quarter}`,
                    quarter,
                    mediaSentiment,
                    independentScore,
                    gap,
                    status: status.status,
                    savedAt: new Date().toISOString()
                }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /hype-index/admin/publish-quarterly-report - publish quarterly hype report (admin)
        if (method === 'POST' && path === '/hype-index/admin/publish-quarterly-report') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { quarter, mostOverrated, mostUnderrated, overratedAnalysis, underratedAnalysis } = body;
            
            if (!quarter || !mostOverrated || !mostUnderrated) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'quarter, mostOverrated, and mostUnderrated required' }) };
            }
            
            await ddb.send(new PutCommand({
                TableName: HYPE_TABLE,
                Item: {
                    toolSlug: '_QUARTERLY_REPORT',
                    recordType: `REPORT#${quarter}`,
                    quarter,
                    mostOverrated,
                    mostUnderrated,
                    overratedAnalysis: overratedAnalysis || '',
                    underratedAnalysis: underratedAnalysis || '',
                    publishedAt: new Date().toISOString()
                }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // PATCH /hype-index/admin/clear-flag - clear flagged status (admin)
        if (method === 'PATCH' && path === '/hype-index/admin/clear-flag') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug } = body;
            
            if (!toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: HYPE_TABLE,
                Key: { toolSlug, recordType: 'CURRENT' },
                UpdateExpression: 'SET flagged = :false',
                ExpressionAttributeValues: { ':false': false }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
