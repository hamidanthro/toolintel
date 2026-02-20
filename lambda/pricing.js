// Lambda for pricing verification system
// DynamoDB tables: toolintel-pricing, toolintel-pricing-reports, toolintel-pricing-alerts, toolintel-pricing-hidden-costs, toolintel-pricing-free-tier

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ses = new SESClient({ region: 'us-east-1' });

const PRICING_TABLE = 'toolintel-pricing';
const REPORTS_TABLE = 'toolintel-pricing-reports';
const ALERTS_TABLE = 'toolintel-pricing-alerts';
const HIDDEN_COSTS_TABLE = 'toolintel-pricing-hidden-costs';
const FREE_TIER_TABLE = 'toolintel-pricing-free-tier';
const FAIRNESS_TABLE = 'toolintel-pricing-fairness';

const ADMIN_KEY = process.env.ADMIN_KEY || 'toolintel-admin-2026';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'hamid.ali87@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'wealthdeskpro@gmail.com';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendNotification(subject, body, to = NOTIFY_EMAIL) {
    try {
        await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
            Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: body } }
            }
        }));
    } catch (err) {
        console.error('Email failed:', err);
    }
}

// Calculate volatility rating based on history
function calculateVolatility(history, now = Date.now()) {
    const twoYearsAgo = now - (24 * 30 * 24 * 60 * 60 * 1000);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    
    const recentChanges = history.filter(h => new Date(h.date).getTime() > twoYearsAgo);
    const changeCount = recentChanges.length;
    
    // Check for short-notice changes (changes within 30 days of each other)
    let hasShortNotice = false;
    for (let i = 1; i < recentChanges.length; i++) {
        const gap = new Date(recentChanges[i-1].date).getTime() - new Date(recentChanges[i].date).getTime();
        if (gap < thirtyDays) {
            hasShortNotice = true;
            break;
        }
    }
    
    if (hasShortNotice) {
        return { rating: 'unpredictable', label: 'Unpredictable', color: '#ef4444' };
    } else if (changeCount >= 3) {
        return { rating: 'volatile', label: 'Volatile', color: '#f59e0b' };
    } else if (changeCount >= 1) {
        return { rating: 'moderate', label: 'Moderate', color: '#3b82f6' };
    } else {
        return { rating: 'stable', label: 'Stable', color: '#10b981' };
    }
}

// Calculate volatility explanation
function getVolatilityExplanation(toolName, history, volatility) {
    const twoYearsAgo = Date.now() - (24 * 30 * 24 * 60 * 60 * 1000);
    const recentChanges = history.filter(h => new Date(h.date).getTime() > twoYearsAgo);
    const changeCount = recentChanges.length;
    
    if (changeCount === 0) {
        return `${toolName} has maintained stable pricing for over 24 months.`;
    }
    
    // Calculate average increase
    const increases = recentChanges.filter(h => h.percentageChange > 0);
    const avgIncrease = increases.length > 0 
        ? (increases.reduce((sum, h) => sum + h.percentageChange, 0) / increases.length).toFixed(0)
        : 0;
    
    // Calculate timespan
    const oldestChange = recentChanges[recentChanges.length - 1];
    const months = Math.floor((Date.now() - new Date(oldestChange.date).getTime()) / (30 * 24 * 60 * 60 * 1000));
    
    if (volatility.rating === 'unpredictable') {
        return `${toolName} has made pricing changes with less than 30 days notice — budget accordingly.`;
    } else if (volatility.rating === 'volatile') {
        return `${toolName} has changed pricing ${changeCount} times in ${months} months — average increase ${avgIncrease}% per change.`;
    } else {
        return `${toolName} has changed pricing ${changeCount} time${changeCount > 1 ? 's' : ''} in the past 24 months.`;
    }
}

// Get price from 12 months ago for a specific tier
function getPriceFromHistory(history, tierName, monthsAgo = 12) {
    const targetDate = Date.now() - (monthsAgo * 30 * 24 * 60 * 60 * 1000);
    
    // Find the most recent change before targetDate that affected this tier
    const relevantHistory = history
        .filter(h => new Date(h.date).getTime() <= targetDate && h.newTiers)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (relevantHistory.length > 0 && relevantHistory[0].newTiers) {
        const tier = relevantHistory[0].newTiers.find(t => t.name === tierName);
        return tier ? tier.price : null;
    }
    
    return null;
}

// Send price change alerts to subscribers
async function sendPriceAlerts(toolSlug, toolName, tierAffected, oldPrice, newPrice, percentageChange) {
    try {
        const result = await ddb.send(new QueryCommand({
            TableName: ALERTS_TABLE,
            KeyConditionExpression: 'toolSlug = :slug',
            ExpressionAttributeValues: { ':slug': toolSlug }
        }));
        
        const subscribers = (result.Items || []).filter(s => s.confirmed);
        if (subscribers.length === 0) return;
        
        const changeDir = percentageChange > 0 ? 'increased' : percentageChange < 0 ? 'decreased' : 'changed';
        const subject = `[ToolIntel] ${toolName} pricing ${changeDir}`;
        const body = `
Price Change Alert

Tool: ${toolName}
Tier: ${tierAffected}
Old Price: ${oldPrice}
New Price: ${newPrice}
Change: ${percentageChange > 0 ? '+' : ''}${percentageChange}%

View full pricing history:
https://toolintel.ai/tools/${toolSlug}/pricing-history

---
You received this because you subscribed to price alerts for ${toolName}.
To unsubscribe, visit: https://toolintel.ai/tools/${toolSlug}/pricing-history
`;
        
        for (const sub of subscribers) {
            await sendNotification(subject, body, sub.email);
        }
    } catch (err) {
        console.error('Failed to send price alerts:', err);
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
        // ===== PUBLIC ENDPOINTS =====

        // GET /pricing?toolSlug=X - get full pricing data for a tool
        if (method === 'GET' && path === '/pricing' && query.toolSlug) {
            const toolSlug = query.toolSlug;
            
            // Get pricing data
            const pricingResult = await ddb.send(new QueryCommand({
                TableName: PRICING_TABLE,
                KeyConditionExpression: 'toolSlug = :slug',
                ExpressionAttributeValues: { ':slug': toolSlug }
            }));
            
            const items = pricingResult.Items || [];
            const current = items.find(i => i.recordType === 'CURRENT');
            const history = items.filter(i => i.recordType.startsWith('HISTORY#'))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            // Calculate per-tier historical prices
            const tiersWithHistory = (current?.tiers || []).map(tier => {
                const price12MonthsAgo = getPriceFromHistory(history, tier.name, 12);
                let percentageChange = null;
                
                if (price12MonthsAgo) {
                    const oldNum = parseFloat(price12MonthsAgo.replace(/[^0-9.]/g, '')) || 0;
                    const newNum = parseFloat(tier.price.replace(/[^0-9.]/g, '')) || 0;
                    if (oldNum > 0) {
                        percentageChange = ((newNum - oldNum) / oldNum * 100).toFixed(1);
                    }
                }
                
                return {
                    ...tier,
                    price12MonthsAgo,
                    percentageChange: percentageChange ? parseFloat(percentageChange) : null,
                    verifiedAt: tier.verifiedAt || current?.verifiedAt
                };
            });
            
            // Calculate volatility
            const volatility = calculateVolatility(history);
            const volatilityExplanation = getVolatilityExplanation(
                current?.toolName || toolSlug, 
                history, 
                volatility
            );
            
            // Check if stale (> 90 days)
            const isStale = current && current.verifiedAt 
                ? (Date.now() - new Date(current.verifiedAt).getTime()) > (90 * 24 * 60 * 60 * 1000)
                : true;
            
            // Get hidden costs
            let hiddenCosts = [];
            try {
                const hcResult = await ddb.send(new QueryCommand({
                    TableName: HIDDEN_COSTS_TABLE,
                    KeyConditionExpression: 'toolSlug = :slug',
                    ExpressionAttributeValues: { ':slug': toolSlug }
                }));
                hiddenCosts = (hcResult.Items || []).sort((a, b) => 
                    new Date(b.verifiedAt) - new Date(a.verifiedAt)
                );
            } catch (e) { /* table may not exist yet */ }
            
            // Get free tier history
            let freeTierHistory = [];
            try {
                const ftResult = await ddb.send(new QueryCommand({
                    TableName: FREE_TIER_TABLE,
                    KeyConditionExpression: 'toolSlug = :slug',
                    ExpressionAttributeValues: { ':slug': toolSlug }
                }));
                freeTierHistory = (ftResult.Items || []).sort((a, b) => 
                    new Date(b.date) - new Date(a.date)
                );
            } catch (e) { /* table may not exist yet */ }
            
            // Get pricing fairness trend
            let fairnessTrend = [];
            try {
                const pfResult = await ddb.send(new QueryCommand({
                    TableName: FAIRNESS_TABLE,
                    KeyConditionExpression: 'toolSlug = :slug',
                    ExpressionAttributeValues: { ':slug': toolSlug }
                }));
                fairnessTrend = (pfResult.Items || []).sort((a, b) => 
                    new Date(b.date) - new Date(a.date)
                );
            } catch (e) { /* table may not exist yet */ }
            
            // Calculate summary stats for pricing history page
            const totalChanges = history.filter(h => h.changeDescription !== 'Initial pricing recorded').length;
            const priceIncreases = history.filter(h => h.percentageChange > 0);
            const avgAnnualIncrease = priceIncreases.length > 0 
                ? (priceIncreases.reduce((sum, h) => sum + h.percentageChange, 0) / priceIncreases.length).toFixed(1)
                : 0;
            const highestIncrease = priceIncreases.length > 0 
                ? Math.max(...priceIncreases.map(h => h.percentageChange)).toFixed(1)
                : 0;
            
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    current: current ? { ...current, tiers: tiersWithHistory } : null,
                    history,
                    isStale,
                    daysSinceVerification: current?.verifiedAt 
                        ? Math.floor((Date.now() - new Date(current.verifiedAt).getTime()) / (24 * 60 * 60 * 1000))
                        : null,
                    volatility,
                    volatilityExplanation,
                    hiddenCosts,
                    freeTierHistory,
                    fairnessTrend,
                    summary: {
                        totalChanges,
                        avgAnnualIncrease: parseFloat(avgAnnualIncrease),
                        highestIncrease: parseFloat(highestIncrease)
                    }
                }) 
            };
        }

        // POST /pricing/report - submit pricing change report (public)
        if (method === 'POST' && path === '/pricing/report') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, toolName, submitterName, submitterEmail, tierAffected, oldPrice, newPrice, sourceUrl } = body;
            
            const required = { toolSlug, submitterName, submitterEmail, tierAffected, oldPrice, newPrice, sourceUrl };
            const missing = Object.entries(required).filter(([k, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing: ${missing.join(', ')}` }) };
            }
            
            if (!isValidEmail(submitterEmail)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
            }
            
            const item = {
                id: crypto.randomUUID(),
                toolSlug,
                toolName: toolName || toolSlug,
                submitterName,
                submitterEmail,
                tierAffected,
                oldPrice,
                newPrice,
                sourceUrl,
                status: 'pending',
                submittedAt: new Date().toISOString()
            };
            
            await ddb.send(new PutCommand({ TableName: REPORTS_TABLE, Item: item }));
            
            const oldNum = parseFloat(oldPrice.replace(/[^0-9.]/g, '')) || 0;
            const newNum = parseFloat(newPrice.replace(/[^0-9.]/g, '')) || 0;
            const pctChange = oldNum > 0 ? ((newNum - oldNum) / oldNum * 100).toFixed(1) : 'N/A';
            
            await sendNotification(
                `[ToolIntel] Pricing Change Report: ${toolName || toolSlug}`,
                `New pricing change report submitted.

Tool: ${toolName || toolSlug} (${toolSlug})
Tier: ${tierAffected}
Old Price: ${oldPrice}
New Price: ${newPrice}
Change: ${pctChange}%

Source: ${sourceUrl}
Reported by: ${submitterName} (${submitterEmail})

Review: https://toolintel.ai/admin/pricing.html?key=${ADMIN_KEY}
`
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, id: item.id }) };
        }

        // POST /pricing/alerts/subscribe - subscribe to price alerts
        if (method === 'POST' && path === '/pricing/alerts/subscribe') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, email } = body;
            
            if (!toolSlug || !email) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and email required' }) };
            }
            
            if (!isValidEmail(email)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
            }
            
            const confirmToken = crypto.randomUUID();
            
            await ddb.send(new PutCommand({
                TableName: ALERTS_TABLE,
                Item: {
                    toolSlug,
                    email,
                    confirmed: false,
                    confirmToken,
                    subscribedAt: new Date().toISOString()
                }
            }));
            
            // Get tool name
            const toolResult = await ddb.send(new GetCommand({
                TableName: PRICING_TABLE,
                Key: { toolSlug, recordType: 'CURRENT' }
            }));
            const toolName = toolResult.Item?.toolName || toolSlug;
            
            await sendNotification(
                `[ToolIntel] Confirm price alert subscription for ${toolName}`,
                `You requested to receive price change alerts for ${toolName}.

Click below to confirm your subscription:
https://toolintel.ai/pricing/alerts/confirm?token=${confirmToken}&tool=${toolSlug}&email=${encodeURIComponent(email)}

If you didn't request this, you can ignore this email.
`,
                email
            );
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true, message: 'Check your email to confirm' }) };
        }

        // GET /pricing/alerts/confirm - confirm subscription
        if (method === 'GET' && path === '/pricing/alerts/confirm') {
            const { token, tool, email } = query;
            
            if (!token || !tool || !email) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid confirmation link' }) };
            }
            
            // Verify token matches
            const result = await ddb.send(new GetCommand({
                TableName: ALERTS_TABLE,
                Key: { toolSlug: tool, email: decodeURIComponent(email) }
            }));
            
            if (!result.Item || result.Item.confirmToken !== token) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid or expired confirmation' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: ALERTS_TABLE,
                Key: { toolSlug: tool, email: decodeURIComponent(email) },
                UpdateExpression: 'SET confirmed = :confirmed, confirmedAt = :now',
                ExpressionAttributeValues: { ':confirmed': true, ':now': new Date().toISOString() }
            }));
            
            // Redirect to tool page with success message
            return {
                statusCode: 302,
                headers: { ...headers, Location: `/reviews/${tool}.html?alert_confirmed=1` },
                body: ''
            };
        }

        // DELETE /pricing/alerts/unsubscribe - unsubscribe from alerts
        if (method === 'DELETE' && path === '/pricing/alerts/unsubscribe') {
            const body = JSON.parse(event.body || '{}');
            const { toolSlug, email } = body;
            
            if (!toolSlug || !email) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and email required' }) };
            }
            
            await ddb.send(new DeleteCommand({
                TableName: ALERTS_TABLE,
                Key: { toolSlug, email }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // ===== ADMIN ENDPOINTS =====

        // GET /pricing/admin/queue - verification queue with report counts
        if (method === 'GET' && path === '/pricing/admin/queue') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            // Get all current pricing
            const pricingResult = await ddb.send(new ScanCommand({
                TableName: PRICING_TABLE,
                FilterExpression: 'recordType = :current',
                ExpressionAttributeValues: { ':current': 'CURRENT' }
            }));
            
            // Get pending reports and count by tool
            const reportsResult = await ddb.send(new ScanCommand({
                TableName: REPORTS_TABLE,
                FilterExpression: '#status = :pending',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':pending': 'pending' }
            }));
            
            const reportCounts = {};
            for (const report of reportsResult.Items || []) {
                reportCounts[report.toolSlug] = (reportCounts[report.toolSlug] || 0) + 1;
            }
            
            const now = Date.now();
            const ninetyDays = 90 * 24 * 60 * 60 * 1000;
            
            const queue = (pricingResult.Items || [])
                .map(item => ({
                    toolSlug: item.toolSlug,
                    toolName: item.toolName,
                    vendorUrl: item.vendorUrl,
                    verifiedAt: item.verifiedAt,
                    daysSinceVerification: item.verifiedAt 
                        ? Math.floor((now - new Date(item.verifiedAt).getTime()) / (24 * 60 * 60 * 1000))
                        : 999,
                    isStale: !item.verifiedAt || (now - new Date(item.verifiedAt).getTime()) > ninetyDays,
                    pendingReports: reportCounts[item.toolSlug] || 0,
                    tiers: item.tiers
                }))
                .filter(item => item.isStale || item.pendingReports > 0)
                .sort((a, b) => {
                    // Sort by pending reports first, then by days stale
                    if (b.pendingReports !== a.pendingReports) {
                        return b.pendingReports - a.pendingReports;
                    }
                    return b.daysSinceVerification - a.daysSinceVerification;
                });
            
            return { statusCode: 200, headers, body: JSON.stringify(queue) };
        }

        // GET /pricing/admin/stale - get all tools with stale pricing (legacy)
        if (method === 'GET' && path === '/pricing/admin/stale') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({
                TableName: PRICING_TABLE,
                FilterExpression: 'recordType = :current',
                ExpressionAttributeValues: { ':current': 'CURRENT' }
            }));
            
            const now = Date.now();
            const ninetyDays = 90 * 24 * 60 * 60 * 1000;
            
            const staleTools = (result.Items || [])
                .map(item => ({
                    ...item,
                    daysSinceVerification: item.verifiedAt 
                        ? Math.floor((now - new Date(item.verifiedAt).getTime()) / (24 * 60 * 60 * 1000))
                        : 999,
                    isStale: !item.verifiedAt || (now - new Date(item.verifiedAt).getTime()) > ninetyDays
                }))
                .filter(item => item.isStale)
                .sort((a, b) => b.daysSinceVerification - a.daysSinceVerification);
            
            return { statusCode: 200, headers, body: JSON.stringify(staleTools) };
        }

        // GET /pricing/reports/admin - get pricing change reports
        if (method === 'GET' && path === '/pricing/reports/admin') {
            if (query.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const result = await ddb.send(new ScanCommand({ TableName: REPORTS_TABLE }));
            const items = (result.Items || []).sort((a, b) => 
                new Date(b.submittedAt) - new Date(a.submittedAt)
            );
            
            return { statusCode: 200, headers, body: JSON.stringify(items) };
        }

        // PATCH /pricing/report/:id - update report status
        if (method === 'PATCH' && path.match(/^\/pricing\/report\/[^/]+$/)) {
            const id = path.split('/').pop();
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            await ddb.send(new UpdateCommand({
                TableName: REPORTS_TABLE,
                Key: { id },
                UpdateExpression: 'SET #status = :status, reviewedAt = :now',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':status': body.status, ':now': new Date().toISOString() }
            }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /pricing/admin/update - update pricing for a tool
        if (method === 'POST' && path === '/pricing/admin/update') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, vendorUrl, tiers, changeDescription, tierAffected, oldPrice, newPrice, percentageChange, fairnessScore } = body;
            
            if (!toolSlug || !tiers || !Array.isArray(tiers)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and tiers required' }) };
            }
            
            // Get current pricing to log history
            const currentResult = await ddb.send(new GetCommand({
                TableName: PRICING_TABLE,
                Key: { toolSlug, recordType: 'CURRENT' }
            }));
            
            const oldPricing = currentResult.Item;
            const now = new Date().toISOString();
            
            // Add per-tier verification timestamps
            const tiersWithTimestamps = tiers.map(tier => ({
                ...tier,
                verifiedAt: now
            }));
            
            // If there's a change, log history and send alerts
            if (changeDescription) {
                const historyItem = {
                    toolSlug,
                    recordType: `HISTORY#${now}`,
                    date: now,
                    changeDescription,
                    tierAffected: tierAffected || null,
                    oldPrice: oldPrice || null,
                    newPrice: newPrice || null,
                    percentageChange: percentageChange || null,
                    oldTiers: oldPricing?.tiers || null,
                    newTiers: tiersWithTimestamps
                };
                await ddb.send(new PutCommand({ TableName: PRICING_TABLE, Item: historyItem }));
                
                // Send alerts to subscribers
                if (tierAffected && oldPrice && newPrice && percentageChange !== undefined) {
                    await sendPriceAlerts(
                        toolSlug,
                        toolName || oldPricing?.toolName || toolSlug,
                        tierAffected,
                        oldPrice,
                        newPrice,
                        percentageChange
                    );
                }
            }
            
            // Update pricing fairness trend if score provided
            if (fairnessScore !== undefined) {
                await ddb.send(new PutCommand({
                    TableName: FAIRNESS_TABLE,
                    Item: {
                        toolSlug,
                        date: now,
                        score: fairnessScore,
                        priceChangeDescription: changeDescription || null
                    }
                }));
            }
            
            // Update current pricing
            const currentItem = {
                toolSlug,
                recordType: 'CURRENT',
                toolName: toolName || oldPricing?.toolName || toolSlug,
                vendorUrl: vendorUrl || oldPricing?.vendorUrl || '',
                tiers: tiersWithTimestamps,
                verifiedAt: now,
                updatedAt: now
            };
            
            await ddb.send(new PutCommand({ TableName: PRICING_TABLE, Item: currentItem }));
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /pricing/admin/verify - quick verify (one-click, no changes)
        if (method === 'POST' && path === '/pricing/admin/verify') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug } = body;
            if (!toolSlug) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug required' }) };
            }
            
            const now = new Date().toISOString();
            
            // Get current to update tier timestamps too
            const currentResult = await ddb.send(new GetCommand({
                TableName: PRICING_TABLE,
                Key: { toolSlug, recordType: 'CURRENT' }
            }));
            
            if (currentResult.Item && currentResult.Item.tiers) {
                // Update all tier verification timestamps
                const updatedTiers = currentResult.Item.tiers.map(tier => ({
                    ...tier,
                    verifiedAt: now
                }));
                
                await ddb.send(new UpdateCommand({
                    TableName: PRICING_TABLE,
                    Key: { toolSlug, recordType: 'CURRENT' },
                    UpdateExpression: 'SET verifiedAt = :now, tiers = :tiers',
                    ExpressionAttributeValues: { ':now': now, ':tiers': updatedTiers }
                }));
            } else {
                await ddb.send(new UpdateCommand({
                    TableName: PRICING_TABLE,
                    Key: { toolSlug, recordType: 'CURRENT' },
                    UpdateExpression: 'SET verifiedAt = :now',
                    ExpressionAttributeValues: { ':now': now }
                }));
            }
            
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, verifiedAt: now }) };
        }

        // POST /pricing/admin/hidden-cost - add hidden cost entry
        if (method === 'POST' && path === '/pricing/admin/hidden-cost') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, description, howDiscovered, source } = body;
            
            if (!toolSlug || !description) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and description required' }) };
            }
            
            const now = new Date().toISOString();
            
            await ddb.send(new PutCommand({
                TableName: HIDDEN_COSTS_TABLE,
                Item: {
                    toolSlug,
                    id: crypto.randomUUID(),
                    description,
                    howDiscovered: howDiscovered || 'Editor testing',
                    source: source || 'ToolIntel review',
                    verifiedAt: now
                }
            }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /pricing/admin/free-tier - update free tier status
        if (method === 'POST' && path === '/pricing/admin/free-tier') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, status, notes } = body;
            // status: 'full' | 'limited' | 'trial' | 'none'
            
            if (!toolSlug || !status) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and status required' }) };
            }
            
            const validStatuses = ['full', 'limited', 'trial', 'none'];
            if (!validStatuses.includes(status)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: `status must be one of: ${validStatuses.join(', ')}` }) };
            }
            
            const now = new Date().toISOString();
            
            await ddb.send(new PutCommand({
                TableName: FREE_TIER_TABLE,
                Item: {
                    toolSlug,
                    date: now,
                    status,
                    notes: notes || null
                }
            }));
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
        }

        // POST /pricing/admin/init - initialize pricing for a tool
        if (method === 'POST' && path === '/pricing/admin/init') {
            const body = JSON.parse(event.body || '{}');
            
            if (body.key !== ADMIN_KEY) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: 'unauthorized' }) };
            }
            
            const { toolSlug, toolName, vendorUrl, tiers, freeTierStatus } = body;
            
            if (!toolSlug || !tiers) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'toolSlug and tiers required' }) };
            }
            
            const now = new Date().toISOString();
            
            // Add per-tier timestamps
            const tiersWithTimestamps = tiers.map(tier => ({
                ...tier,
                verifiedAt: now
            }));
            
            // Create current pricing
            await ddb.send(new PutCommand({
                TableName: PRICING_TABLE,
                Item: {
                    toolSlug,
                    recordType: 'CURRENT',
                    toolName: toolName || toolSlug,
                    vendorUrl: vendorUrl || '',
                    tiers: tiersWithTimestamps,
                    verifiedAt: now,
                    updatedAt: now
                }
            }));
            
            // Create initial history entry
            await ddb.send(new PutCommand({
                TableName: PRICING_TABLE,
                Item: {
                    toolSlug,
                    recordType: `HISTORY#${now}`,
                    date: now,
                    changeDescription: 'Initial pricing recorded',
                    percentageChange: null,
                    newTiers: tiersWithTimestamps
                }
            }));
            
            // Initialize free tier status if provided
            if (freeTierStatus) {
                await ddb.send(new PutCommand({
                    TableName: FREE_TIER_TABLE,
                    Item: {
                        toolSlug,
                        date: now,
                        status: freeTierStatus,
                        notes: 'Initial status'
                    }
                }));
            }
            
            return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'not found' }) };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'internal error', details: err.message }) };
    }
};
