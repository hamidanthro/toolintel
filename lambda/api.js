// ToolIntel Developer API Lambda
// Programmatic access to independent AI tool intelligence

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  apiKeys: 'toolintel-api-keys',
  apiUsage: 'toolintel-api-usage',
  webhooks: 'toolintel-api-webhooks',
  webhookLogs: 'toolintel-api-webhook-logs'
};

// API Tiers
const TIERS = {
  free: { limit: 100, name: 'Free', fullAccess: false },
  professional: { limit: 10000, name: 'Professional', fullAccess: true },
  enterprise: { limit: Infinity, name: 'Enterprise', fullAccess: true }
};

// Sandbox tools (10 pre-selected for testing)
const SANDBOX_TOOLS = ['claude', 'gpt-4', 'gemini', 'copilot', 'midjourney', 'perplexity', 'jasper', 'stable-diffusion', 'dall-e-3', 'cursor'];

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const path = event.path || '';
  const method = event.httpMethod;
  const apiKey = event.headers['x-api-key'] || event.headers['X-API-Key'];
  const isSandbox = path.includes('/sandbox/');

  try {
    // ===== PUBLIC ENDPOINTS (no auth) =====
    
    // GET /api/status - API status page data
    if (method === 'GET' && path.endsWith('/api/status')) {
      const status = await getApiStatus();
      return success(status);
    }

    // GET /api/tiers - Get pricing tiers
    if (method === 'GET' && path.endsWith('/api/tiers')) {
      return success(getTierInfo());
    }

    // ===== SANDBOX ENDPOINTS (rate limited by IP) =====
    
    if (isSandbox) {
      const clientIp = event.requestContext?.identity?.sourceIp || 'unknown';
      const sandboxAllowed = await checkSandboxLimit(clientIp);
      
      if (!sandboxAllowed) {
        return error(429, 'Sandbox rate limit exceeded. Maximum 10 requests per day per IP.');
      }

      // GET /api/sandbox/tools
      if (method === 'GET' && path.endsWith('/sandbox/tools')) {
        const tools = await getToolsList({ sandbox: true });
        return success(tools);
      }

      // GET /api/sandbox/tools/:toolname
      if (method === 'GET' && path.includes('/sandbox/tools/')) {
        const toolname = path.split('/sandbox/tools/')[1].split('/')[0];
        if (!SANDBOX_TOOLS.includes(toolname)) {
          return error(404, `Tool not in sandbox. Available: ${SANDBOX_TOOLS.join(', ')}`);
        }
        const tool = await getToolDetails(toolname);
        return success(tool);
      }

      return error(404, 'Sandbox endpoint not found');
    }

    // ===== AUTHENTICATED API ENDPOINTS =====
    
    if (!apiKey) {
      return error(401, 'API key required. Include X-API-Key header.');
    }

    const keyData = await validateApiKey(apiKey);
    if (!keyData) {
      return error(401, 'Invalid API key');
    }

    // Check rate limit
    const withinLimit = await checkRateLimit(apiKey, keyData.tier);
    if (!withinLimit) {
      return error(429, `Rate limit exceeded for ${keyData.tier} tier`);
    }

    // Log usage
    await logApiUsage(apiKey, path, method);

    // GET /api/tools - List all tools
    if (method === 'GET' && path.match(/\/api\/tools\/?$/)) {
      const params = event.queryStringParameters || {};
      const tools = await getToolsList(params);
      
      // Free tier: only basic metadata
      if (keyData.tier === 'free') {
        tools.tools = tools.tools.map(t => ({
          slug: t.slug,
          name: t.name,
          category: t.category,
          overallScore: t.overallScore,
          reviewDate: t.reviewDate
        }));
      }
      
      return success(tools);
    }

    // GET /api/tools/:toolname - Get tool details
    if (method === 'GET' && path.match(/\/api\/tools\/[^/]+\/?$/)) {
      const toolname = path.split('/api/tools/')[1].replace(/\/$/, '');
      const tool = await getToolDetails(toolname);
      
      if (!tool) {
        return error(404, 'Tool not found');
      }
      
      // Free tier: limited data
      if (keyData.tier === 'free') {
        return success({
          slug: tool.slug,
          name: tool.name,
          category: tool.category,
          overallScore: tool.overallScore,
          reviewDate: tool.reviewDate,
          methodologyVersion: tool.methodologyVersion,
          _note: 'Upgrade to Professional for full access to category scores, pricing, compliance data, and more.'
        });
      }
      
      return success(tool);
    }

    // GET /api/tools/:toolname/changelog - Get tool change history
    if (method === 'GET' && path.includes('/changelog')) {
      if (keyData.tier === 'free') {
        return error(403, 'Changelog access requires Professional or Enterprise tier');
      }
      
      const toolname = path.split('/api/tools/')[1].split('/changelog')[0];
      const changelog = await getToolChangelog(toolname);
      return success(changelog);
    }

    // GET /api/categories/compare - Compare tools
    if (method === 'GET' && path.includes('/categories/compare')) {
      if (keyData.tier === 'free') {
        return error(403, 'Comparison API requires Professional or Enterprise tier');
      }
      
      const params = event.queryStringParameters || {};
      const tools = params.tools ? params.tools.split(',') : [];
      const weights = params.weights ? JSON.parse(params.weights) : null;
      
      if (tools.length < 2 || tools.length > 4) {
        return error(400, 'Provide 2-4 tool names in the tools parameter');
      }
      
      const comparison = await compareTools(tools, weights);
      return success(comparison);
    }

    // ===== WEBHOOK ENDPOINTS (Professional/Enterprise) =====

    // GET /api/webhooks - List registered webhooks
    if (method === 'GET' && path.endsWith('/api/webhooks')) {
      if (keyData.tier === 'free') {
        return error(403, 'Webhooks require Professional or Enterprise tier');
      }
      
      const webhooks = await getWebhooks(apiKey);
      return success({ webhooks });
    }

    // POST /api/webhooks - Register webhook
    if (method === 'POST' && path.endsWith('/api/webhooks')) {
      if (keyData.tier === 'free') {
        return error(403, 'Webhooks require Professional or Enterprise tier');
      }
      
      const body = JSON.parse(event.body || '{}');
      const result = await registerWebhook(apiKey, body);
      return created(result);
    }

    // DELETE /api/webhooks/:id - Delete webhook
    if (method === 'DELETE' && path.includes('/api/webhooks/')) {
      const webhookId = path.split('/api/webhooks/')[1];
      const result = await deleteWebhook(apiKey, webhookId);
      return success(result);
    }

    // ===== ADMIN ENDPOINTS =====

    // GET /api/admin/keys - List all API keys
    if (method === 'GET' && path.endsWith('/admin/keys')) {
      const keys = await getAllApiKeys();
      return success({ keys });
    }

    // POST /api/admin/keys - Create API key
    if (method === 'POST' && path.endsWith('/admin/keys')) {
      const body = JSON.parse(event.body || '{}');
      const result = await createApiKey(body);
      return created(result);
    }

    // DELETE /api/admin/keys/:key - Revoke API key
    if (method === 'DELETE' && path.includes('/admin/keys/')) {
      const key = path.split('/admin/keys/')[1];
      const result = await revokeApiKey(key);
      return success(result);
    }

    // GET /api/admin/usage - Usage analytics
    if (method === 'GET' && path.endsWith('/admin/usage')) {
      const usage = await getUsageAnalytics();
      return success(usage);
    }

    // GET /api/admin/webhooks - Webhook monitor
    if (method === 'GET' && path.endsWith('/admin/webhooks')) {
      const webhooks = await getWebhookMonitor();
      return success(webhooks);
    }

    // GET /api/admin/abuse - Abuse detection
    if (method === 'GET' && path.endsWith('/admin/abuse')) {
      const abuse = await getAbuseDetection();
      return success(abuse);
    }

    // GET /api/admin/stats - Overall stats
    if (method === 'GET' && path.endsWith('/admin/stats')) {
      const stats = await getAdminStats();
      return success(stats);
    }

    return error(404, 'Endpoint not found');

  } catch (err) {
    console.error('Error:', err);
    return error(500, err.message);
  }
};

// Helper responses
function success(data) {
  return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function created(data) {
  return { statusCode: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function error(code, message) {
  return { statusCode: code, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}

// ===== API KEY MANAGEMENT =====

async function validateApiKey(apiKey) {
  // In production, query DynamoDB
  // Sample validation
  if (apiKey.startsWith('ti_free_')) return { tier: 'free', valid: true };
  if (apiKey.startsWith('ti_pro_')) return { tier: 'professional', valid: true };
  if (apiKey.startsWith('ti_ent_')) return { tier: 'enterprise', valid: true };
  if (apiKey === 'ti_demo_key') return { tier: 'professional', valid: true };
  return null;
}

async function checkRateLimit(apiKey, tier) {
  // In production, check Redis/DynamoDB for request count
  return true;
}

async function checkSandboxLimit(clientIp) {
  // In production, track per-IP requests in DynamoDB
  return true;
}

async function logApiUsage(apiKey, path, method) {
  // In production, log to DynamoDB
  console.log(`API Usage: ${apiKey} ${method} ${path}`);
}

// ===== TOOLS DATA =====

async function getToolsList(params = {}) {
  const { category, minScore, compliance, region, pricingTier, sandbox } = params;
  
  // Sample tools data
  let tools = [
    { slug: 'claude', name: 'Claude', vendor: 'Anthropic', category: 'Foundation Models', subcategory: 'LLM', overallScore: 89, reviewDate: '2026-02-20', methodologyVersion: '1.0' },
    { slug: 'gpt-4', name: 'GPT-4', vendor: 'OpenAI', category: 'Foundation Models', subcategory: 'LLM', overallScore: 87, reviewDate: '2026-02-18', methodologyVersion: '1.0' },
    { slug: 'gemini', name: 'Gemini', vendor: 'Google', category: 'Foundation Models', subcategory: 'LLM', overallScore: 84, reviewDate: '2026-02-20', methodologyVersion: '1.0' },
    { slug: 'copilot', name: 'GitHub Copilot', vendor: 'GitHub/Microsoft', category: 'AI Coding', subcategory: 'Code Completion', overallScore: 86, reviewDate: '2026-02-20', methodologyVersion: '1.0' },
    { slug: 'midjourney', name: 'Midjourney', vendor: 'Midjourney', category: 'Image Generation', subcategory: 'Art Generation', overallScore: 81, reviewDate: '2026-02-15', methodologyVersion: '1.0' },
    { slug: 'perplexity', name: 'Perplexity', vendor: 'Perplexity AI', category: 'AI Search', subcategory: 'Research Assistant', overallScore: 82, reviewDate: '2026-02-20', methodologyVersion: '1.0' },
    { slug: 'jasper', name: 'Jasper', vendor: 'Jasper AI', category: 'AI Writing', subcategory: 'Marketing Copy', overallScore: 78, reviewDate: '2026-02-10', methodologyVersion: '1.0' },
    { slug: 'stable-diffusion', name: 'Stable Diffusion', vendor: 'Stability AI', category: 'Image Generation', subcategory: 'Open Source', overallScore: 77, reviewDate: '2026-02-20', methodologyVersion: '1.0' },
    { slug: 'dall-e-3', name: 'DALL-E 3', vendor: 'OpenAI', category: 'Image Generation', subcategory: 'Art Generation', overallScore: 80, reviewDate: '2026-02-20', methodologyVersion: '1.0' },
    { slug: 'cursor', name: 'Cursor', vendor: 'Anysphere', category: 'AI Coding', subcategory: 'IDE', overallScore: 85, reviewDate: '2026-02-12', methodologyVersion: '1.0' }
  ];

  if (sandbox) {
    tools = tools.filter(t => SANDBOX_TOOLS.includes(t.slug));
  }

  if (category) {
    tools = tools.filter(t => t.category.toLowerCase() === category.toLowerCase());
  }

  if (minScore) {
    tools = tools.filter(t => t.overallScore >= parseInt(minScore));
  }

  return {
    tools,
    total: tools.length,
    page: 1,
    perPage: 50
  };
}

async function getToolDetails(toolname) {
  // Full tool data
  const toolsData = {
    'claude': {
      slug: 'claude',
      name: 'Claude',
      vendor: 'Anthropic',
      website: 'https://claude.ai',
      category: 'Foundation Models',
      subcategory: 'LLM',
      overallScore: 89,
      reviewDate: '2026-02-20',
      methodologyVersion: '1.0',
      verdict: 'Best for complex reasoning and teams prioritizing safety.',
      categoryScores: {
        coreAiPerformance: { score: 92, weight: 25 },
        dataPrivacySecurity: { score: 95, weight: 20 },
        transparency: { score: 90, weight: 15 },
        reliabilityUptime: { score: 88, weight: 10 },
        compliance: { score: 91, weight: 10 },
        pricingFairness: { score: 75, weight: 8 },
        integrationUsability: { score: 82, weight: 5 },
        humanOverride: { score: 90, weight: 4 },
        vendorAccountability: { score: 85, weight: 2 },
        biasFairness: { score: 88, weight: 1 }
      },
      pricing: {
        verifiedAt: '2026-02-18T10:30:00Z',
        tiers: [
          { name: 'Free', price: '$0/mo', limits: 'Limited messages' },
          { name: 'Pro', price: '$20/mo', limits: '5x usage, Opus access' },
          { name: 'API', price: 'Pay-per-token', limits: 'Full access' }
        ],
        volatilityRating: 'Stable',
        hiddenCosts: []
      },
      compliance: {
        soc2: { status: 'Verified', verifiedAt: '2026-01-15' },
        gdpr: { status: 'Verified', verifiedAt: '2026-01-15' },
        hipaa: { status: 'BAA Available', verifiedAt: '2026-01-20' },
        fedramp: { status: 'In Progress', verifiedAt: null },
        euAiAct: { status: 'Preparing', verifiedAt: null },
        iso27001: { status: 'Verified', verifiedAt: '2026-01-10' }
      },
      incidentHistory: [
        { date: '2025-11-15', type: 'Outage', severity: 'Medium', duration: '2 hours', resolved: true }
      ],
      policyChangeLog: [
        { date: '2026-02-01', change: 'Updated data retention policy to 30 days default', impact: 'Positive' }
      ],
      hypeIndex: {
        marketingScore: 72,
        socialBuzz: 85,
        realityGap: 8,
        trend: 'Stable'
      },
      claimVerification: {
        summary: 'Mostly Verified',
        verified: 8,
        partiallyTrue: 2,
        unverified: 1,
        false: 0
      }
    }
  };

  // Generate similar data for other tools
  if (!toolsData[toolname]) {
    const tools = await getToolsList({ sandbox: true });
    const tool = tools.tools.find(t => t.slug === toolname);
    if (tool) {
      return {
        ...tool,
        categoryScores: {
          coreAiPerformance: { score: Math.floor(tool.overallScore * 0.95 + Math.random() * 10), weight: 25 },
          dataPrivacySecurity: { score: Math.floor(tool.overallScore * 0.9 + Math.random() * 15), weight: 20 },
          transparency: { score: Math.floor(tool.overallScore * 0.85 + Math.random() * 10), weight: 15 },
          reliabilityUptime: { score: Math.floor(tool.overallScore * 0.9 + Math.random() * 10), weight: 10 },
          compliance: { score: Math.floor(tool.overallScore * 0.85 + Math.random() * 10), weight: 10 },
          pricingFairness: { score: Math.floor(70 + Math.random() * 20), weight: 8 },
          integrationUsability: { score: Math.floor(tool.overallScore * 0.9 + Math.random() * 10), weight: 5 },
          humanOverride: { score: Math.floor(80 + Math.random() * 15), weight: 4 },
          vendorAccountability: { score: Math.floor(75 + Math.random() * 20), weight: 2 },
          biasFairness: { score: Math.floor(75 + Math.random() * 20), weight: 1 }
        },
        pricing: { verifiedAt: new Date().toISOString(), tiers: [], volatilityRating: 'Unknown' },
        compliance: {},
        incidentHistory: [],
        policyChangeLog: []
      };
    }
    return null;
  }

  return toolsData[toolname];
}

async function getToolChangelog(toolname) {
  return {
    toolSlug: toolname,
    changelog: [
      { date: '2026-02-20', change: 'Initial review published', scoreImpact: null, oldScore: null, newScore: 89 },
      { date: '2026-02-15', change: 'Pricing tier verified', scoreImpact: null },
      { date: '2026-02-10', change: 'SOC 2 compliance verified', scoreImpact: '+2', oldScore: 87, newScore: 89 }
    ]
  };
}

async function compareTools(toolNames, weights) {
  const tools = [];
  for (const name of toolNames) {
    const tool = await getToolDetails(name);
    if (tool) tools.push(tool);
  }

  if (tools.length < 2) {
    throw new Error('At least 2 valid tools required for comparison');
  }

  // Calculate weighted scores
  const defaultWeights = {
    coreAiPerformance: 25,
    dataPrivacySecurity: 20,
    transparency: 15,
    reliabilityUptime: 10,
    compliance: 10,
    pricingFairness: 8,
    integrationUsability: 5,
    humanOverride: 4,
    vendorAccountability: 2,
    biasFairness: 1
  };

  const activeWeights = weights || defaultWeights;

  const results = tools.map(tool => {
    let weightedScore = 0;
    for (const [category, weight] of Object.entries(activeWeights)) {
      const catScore = tool.categoryScores?.[category]?.score || 0;
      weightedScore += (catScore * weight) / 100;
    }

    return {
      slug: tool.slug,
      name: tool.name,
      overallScore: tool.overallScore,
      weightedScore: Math.round(weightedScore),
      categoryScores: tool.categoryScores
    };
  });

  results.sort((a, b) => b.weightedScore - a.weightedScore);

  return {
    comparison: results,
    winner: results[0],
    weightsUsed: activeWeights,
    generatedAt: new Date().toISOString()
  };
}

// ===== WEBHOOKS =====

async function getWebhooks(apiKey) {
  return [
    {
      id: 'wh_001',
      url: 'https://example.com/webhook',
      events: ['score_change', 'pricing_change'],
      tools: ['claude', 'gpt-4'],
      createdAt: '2026-02-15T00:00:00Z',
      lastTriggered: '2026-02-19T14:30:00Z',
      successRate: 98.5
    }
  ];
}

async function registerWebhook(apiKey, data) {
  const { url, events, tools } = data;
  
  if (!url || !events || events.length === 0) {
    throw new Error('URL and at least one event type required');
  }

  const webhookId = 'wh_' + Date.now();

  return {
    id: webhookId,
    url,
    events,
    tools: tools || [],
    message: 'Webhook registered. You will receive POST notifications for the specified events.'
  };
}

async function deleteWebhook(apiKey, webhookId) {
  return { message: 'Webhook deleted', id: webhookId };
}

// ===== STATUS =====

async function getApiStatus() {
  return {
    status: 'operational',
    uptime: 99.97,
    uptimeLast30Days: 99.95,
    avgResponseTime: 145,
    responseTimeLast30Days: [
      { date: '2026-02-20', avgMs: 142 },
      { date: '2026-02-19', avgMs: 148 },
      { date: '2026-02-18', avgMs: 138 }
    ],
    incidents: [],
    lastIncident: {
      date: '2026-01-28',
      type: 'Degraded Performance',
      duration: '15 minutes',
      resolved: true
    },
    endpoints: {
      '/api/tools': 'operational',
      '/api/tools/:toolname': 'operational',
      '/api/tools/:toolname/changelog': 'operational',
      '/api/categories/compare': 'operational',
      '/api/webhooks': 'operational'
    }
  };
}

function getTierInfo() {
  return {
    tiers: [
      {
        name: 'Free',
        price: '$0/month',
        requestLimit: 100,
        features: [
          'Overall scores and basic metadata',
          'No authentication beyond API key',
          'Attribution required'
        ],
        limitations: [
          'No detailed category scores',
          'No pricing data',
          'No compliance data',
          'No changelog access'
        ],
        bestFor: 'Personal projects and evaluation'
      },
      {
        name: 'Professional',
        price: '$49/month',
        requestLimit: 10000,
        features: [
          'Full access to all endpoints',
          'Detailed scores, pricing, compliance',
          'Changelog access',
          'Webhook support',
          'Priority support'
        ],
        limitations: ['Standard rate limiting'],
        bestFor: 'Startups and small development teams'
      },
      {
        name: 'Enterprise',
        price: 'Custom',
        requestLimit: 'Unlimited',
        features: [
          'Everything in Professional',
          'Dedicated rate limits',
          'SLA guarantee',
          'Custom data fields on request',
          'Signed data attribution agreement'
        ],
        limitations: [],
        bestFor: 'Procurement platforms and enterprise systems'
      }
    ],
    webhookEvents: [
      'score_change',
      'security_incident',
      'pricing_change',
      'certification_change',
      'tos_change',
      'expert_analysis',
      'claim_verdict'
    ]
  };
}

// ===== ADMIN FUNCTIONS =====

async function getAllApiKeys() {
  return [
    { key: 'ti_pro_abc123...', tier: 'professional', owner: 'acme@company.com', requestsLast30Days: 4521, lastUsed: '2026-02-20T16:45:00Z', status: 'active' },
    { key: 'ti_free_xyz789...', tier: 'free', owner: 'dev@startup.io', requestsLast30Days: 87, lastUsed: '2026-02-19T10:20:00Z', status: 'active' },
    { key: 'ti_ent_def456...', tier: 'enterprise', owner: 'procurement@bigcorp.com', requestsLast30Days: 45230, lastUsed: '2026-02-20T17:00:00Z', status: 'active' }
  ];
}

async function createApiKey(data) {
  const { email, tier, company } = data;
  const key = `ti_${tier.substring(0, 3)}_${Math.random().toString(36).substring(2, 15)}`;
  
  return {
    key,
    tier,
    email,
    company,
    createdAt: new Date().toISOString(),
    message: 'API key created. Send this to the user securely — it cannot be retrieved later.'
  };
}

async function revokeApiKey(key) {
  return { message: 'API key revoked', key };
}

async function getUsageAnalytics() {
  return {
    totalRequestsLast90Days: 234567,
    byEndpoint: {
      '/api/tools': 89234,
      '/api/tools/:toolname': 112340,
      '/api/tools/:toolname/changelog': 12456,
      '/api/categories/compare': 20537
    },
    byTier: {
      free: 15234,
      professional: 98456,
      enterprise: 120877
    },
    mostQueriedTools: [
      { slug: 'claude', queries: 34521 },
      { slug: 'gpt-4', queries: 31245 },
      { slug: 'gemini', queries: 18934 },
      { slug: 'copilot', queries: 15678 },
      { slug: 'midjourney', queries: 12456 }
    ],
    requestsByDay: [
      { date: '2026-02-20', count: 8234 },
      { date: '2026-02-19', count: 7891 },
      { date: '2026-02-18', count: 8012 }
    ]
  };
}

async function getWebhookMonitor() {
  return {
    totalWebhooks: 47,
    activeWebhooks: 45,
    deliverySuccessRate: 97.8,
    eventsTriggeredLast24h: 156,
    webhooks: [
      { id: 'wh_001', owner: 'acme@company.com', url: 'https://acme.com/webhook', events: ['score_change'], successRate: 100, lastTriggered: '2026-02-20T15:30:00Z' },
      { id: 'wh_002', owner: 'bigcorp@enterprise.com', url: 'https://api.bigcorp.com/toolintel', events: ['score_change', 'pricing_change', 'security_incident'], successRate: 98.5, lastTriggered: '2026-02-20T14:00:00Z' }
    ]
  };
}

async function getAbuseDetection() {
  return {
    flaggedKeys: [
      {
        key: 'ti_free_suspicious...',
        reason: 'Exceeded rate limit 5x in 24 hours',
        requestCount: 523,
        expectedLimit: 100,
        flaggedAt: '2026-02-20T12:00:00Z',
        status: 'pending_review'
      }
    ],
    unusualPatterns: [
      {
        key: 'ti_pro_unusual...',
        pattern: 'Scraping all tools sequentially',
        detectedAt: '2026-02-19T08:00:00Z',
        status: 'reviewed_ok'
      }
    ]
  };
}

async function getAdminStats() {
  return {
    totalApiKeys: 234,
    activeKeysLast30Days: 156,
    keysByTier: { free: 189, professional: 38, enterprise: 7 },
    totalRequests30Days: 234567,
    avgDailyRequests: 7819,
    webhooksRegistered: 47,
    webhookDeliveryRate: 97.8,
    flaggedForAbuse: 1,
    revenue: { mrr: 2842, enterpriseContracts: 3 }
  };
}
