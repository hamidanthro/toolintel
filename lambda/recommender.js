// ToolIntel Team Size Recommender Lambda
// Feature 13: Personalized tool recommendations based on team profile

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  profiles: 'toolintel-recommender-profiles',
  analytics: 'toolintel-recommender-analytics',
  shares: 'toolintel-recommender-shares',
  tools: 'toolintel-tools'
};

// Industry presets (matches Regulatory Fit Filter)
const INDUSTRY_PRESETS = [
  'Healthcare',
  'Financial Services',
  'Legal',
  'Government',
  'Education',
  'Technology',
  'Retail/E-commerce',
  'Manufacturing',
  'Media/Entertainment',
  'General Enterprise'
];

// 10 methodology categories for priority ranking
const METHODOLOGY_CATEGORIES = [
  { id: 'core_ai', name: 'Core AI Capability', description: 'Raw model performance and accuracy' },
  { id: 'privacy', name: 'Data Privacy', description: 'How your data is handled and protected' },
  { id: 'compliance', name: 'Regulatory Compliance', description: 'Certifications and regulatory adherence' },
  { id: 'pricing', name: 'Pricing Transparency', description: 'Clear, fair pricing without hidden costs' },
  { id: 'integration', name: 'Integration & API', description: 'Developer experience and connectivity' },
  { id: 'support', name: 'Vendor Support', description: 'Response times and support quality' },
  { id: 'reliability', name: 'Uptime & Reliability', description: 'Service availability and stability' },
  { id: 'safety', name: 'AI Safety', description: 'Guardrails and responsible AI practices' },
  { id: 'transparency', name: 'Vendor Transparency', description: 'Openness about limitations and practices' },
  { id: 'innovation', name: 'Innovation Pace', description: 'Feature updates and roadmap execution' }
];

// Use cases by category
const USE_CASES = {
  'ai-coding': [
    'Daily code completion',
    'Code review and quality',
    'Documentation generation',
    'Security scanning',
    'Full application building',
    'Legacy code modernization'
  ],
  'foundation-models': [
    'Complex reasoning tasks',
    'Content generation',
    'Data analysis',
    'Customer support automation',
    'Research assistance',
    'Multi-modal applications'
  ],
  'chatbots': [
    'Customer service automation',
    'Internal knowledge base',
    'Lead qualification',
    'Appointment scheduling',
    'FAQ automation',
    'Sales assistance'
  ],
  'writing': [
    'Marketing copy',
    'Technical documentation',
    'Email drafting',
    'Content repurposing',
    'SEO optimization',
    'Social media content'
  ],
  'image-gen': [
    'Marketing visuals',
    'Product mockups',
    'Social media graphics',
    'Concept art',
    'Photo editing/enhancement',
    'Brand asset creation'
  ],
  'default': [
    'General productivity',
    'Team collaboration',
    'Process automation',
    'Data analysis',
    'Content creation',
    'Research'
  ]
};

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const path = event.path || '';
  const method = event.httpMethod;

  try {
    // GET /recommender/config - Get form configuration
    if (method === 'GET' && path.endsWith('/config')) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industries: INDUSTRY_PRESETS,
          categories: METHODOLOGY_CATEGORIES,
          teamSizes: [
            { id: 'solo', name: 'Solo user', min: 1, max: 1 },
            { id: 'small', name: 'Small team (2-10)', min: 2, max: 10 },
            { id: 'mid', name: 'Mid-size team (11-50)', min: 11, max: 50 },
            { id: 'large', name: 'Large team (51-200)', min: 51, max: 200 },
            { id: 'enterprise', name: 'Enterprise (200+)', min: 200, max: 10000 }
          ],
          budgets: [
            { id: 'under10', name: 'Under $10', min: 0, max: 10 },
            { id: '10to25', name: '$10-25', min: 10, max: 25 },
            { id: '25to50', name: '$25-50', min: 25, max: 50 },
            { id: '50to100', name: '$50-100', min: 50, max: 100 },
            { id: 'over100', name: 'Over $100', min: 100, max: 1000 }
          ]
        })
      };
    }

    // GET /recommender/use-cases/:category - Get use cases for category
    if (method === 'GET' && path.includes('/use-cases/')) {
      const category = path.split('/use-cases/')[1];
      const useCases = USE_CASES[category] || USE_CASES['default'];
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, useCases })
      };
    }

    // POST /recommender/recommend - Generate recommendation
    if (method === 'POST' && path.endsWith('/recommend')) {
      const body = JSON.parse(event.body || '{}');
      const recommendation = await generateRecommendation(body);
      
      // Track analytics
      await trackAnalytics(body);
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(recommendation)
      };
    }

    // POST /recommender/profile - Save user profile
    if (method === 'POST' && path.endsWith('/profile')) {
      const body = JSON.parse(event.body || '{}');
      const { userId, profileName, inputs } = body;
      
      if (!userId || !profileName || !inputs) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'userId, profileName, and inputs required' })
        };
      }

      const profileId = `${userId}#${Date.now()}`;
      await docClient.send(new PutCommand({
        TableName: TABLES.profiles,
        Item: {
          profileId,
          userId,
          profileName,
          inputs,
          createdAt: new Date().toISOString(),
          lastRecommendation: null,
          notificationsEnabled: true
        }
      }));

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, message: 'Profile saved' })
      };
    }

    // GET /recommender/profiles/:userId - Get user's saved profiles
    if (method === 'GET' && path.includes('/profiles/')) {
      const userId = path.split('/profiles/')[1];
      
      const result = await docClient.send(new QueryCommand({
        TableName: TABLES.profiles,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId }
      }));

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: result.Items || [] })
      };
    }

    // POST /recommender/share - Create shareable link
    if (method === 'POST' && path.endsWith('/share')) {
      const body = JSON.parse(event.body || '{}');
      const { inputs, recommendation } = body;
      
      const shareId = generateShareId();
      await docClient.send(new PutCommand({
        TableName: TABLES.shares,
        Item: {
          shareId,
          inputs,
          recommendation,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days
        }
      }));

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          shareId, 
          shareUrl: `https://toolintel.ai/recommend/${shareId}` 
        })
      };
    }

    // GET /recommender/share/:shareId - Get shared recommendation
    if (method === 'GET' && path.includes('/share/')) {
      const shareId = path.split('/share/')[1];
      
      const result = await docClient.send(new GetCommand({
        TableName: TABLES.shares,
        Key: { shareId }
      }));

      if (!result.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Recommendation not found or expired' })
        };
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result.Item)
      };
    }

    // GET /recommender/analytics - Admin analytics
    if (method === 'GET' && path.endsWith('/analytics')) {
      const analytics = await getAnalytics();
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(analytics)
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function generateRecommendation(inputs) {
  const { 
    teamSize, 
    industry, 
    budget, 
    priorities, // Array of category IDs in order (top 5)
    sensitiveData, 
    apiAccess, 
    supportCritical,
    useCases,
    category 
  } = inputs;

  // Get all tools in this category (or all if no category)
  const tools = await getToolsForCategory(category);
  
  if (tools.length === 0) {
    return {
      confidence: 'low',
      message: 'Our reviewed database in this category is still growing. Check back as we publish more reviews or browse all tools in this category manually.',
      tools: [],
      calculation: null
    };
  }

  // Calculate weighted scores for each tool
  const scoredTools = tools.map(tool => {
    const weightedScore = calculateWeightedScore(tool, {
      priorities,
      sensitiveData,
      apiAccess,
      supportCritical,
      budget,
      teamSize
    });
    return { ...tool, weightedScore, matchDetails: weightedScore.details };
  });

  // Sort by weighted score
  scoredTools.sort((a, b) => b.weightedScore.total - a.weightedScore.total);

  // Filter by budget if specified
  const budgetFiltered = filterByBudget(scoredTools, budget, teamSize);
  
  // Determine confidence level
  const confidence = determineConfidence(budgetFiltered);
  
  // Get top recommendation
  const topTool = budgetFiltered[0];
  const runnerUp = budgetFiltered[1];
  const budgetAlt = findBudgetAlternative(scoredTools, budget, teamSize, topTool?.slug);

  // Generate explanations
  const explanation = generateExplanation(topTool, inputs);
  const runnerUpNote = runnerUp ? generateRunnerUpNote(runnerUp, topTool, inputs) : null;
  const tradeoffs = generateTradeoffs(budgetFiltered.slice(1, 4), topTool);

  return {
    confidence,
    topRecommendation: topTool ? {
      tool: topTool,
      explanation,
      score: topTool.weightedScore.total
    } : null,
    runnerUp: runnerUp ? {
      tool: runnerUp,
      note: runnerUpNote,
      score: runnerUp.weightedScore.total
    } : null,
    budgetAlternative: budgetAlt ? {
      tool: budgetAlt,
      note: `Lower cost option within your budget at ${formatPrice(budgetAlt.pricing?.perUser)}/user/month`
    } : null,
    tradeoffs,
    calculation: {
      inputsUsed: inputs,
      priorityWeights: calculatePriorityWeights(priorities),
      toolsEvaluated: scoredTools.length,
      eliminationSteps: getEliminationSteps(scoredTools, budgetFiltered, inputs)
    }
  };
}

function calculateWeightedScore(tool, params) {
  const { priorities, sensitiveData, apiAccess, supportCritical, budget, teamSize } = params;
  
  // Base weights from priorities (top priority = 25%, 2nd = 20%, 3rd = 15%, 4th = 10%, 5th = 5%, rest = 5% split)
  const priorityWeights = calculatePriorityWeights(priorities);
  
  let totalScore = 0;
  const details = {};

  // Calculate score for each category
  METHODOLOGY_CATEGORIES.forEach(cat => {
    const toolScore = tool.scores?.[cat.id] || 50; // Default to 50 if no score
    const weight = priorityWeights[cat.id] || 0.025; // Minimum 2.5% weight
    const contribution = toolScore * weight;
    totalScore += contribution;
    details[cat.id] = { score: toolScore, weight, contribution };
  });

  // Bonuses/penalties for yes/no questions
  if (sensitiveData && tool.scores?.compliance >= 80) {
    totalScore += 5;
    details.sensitiveDataBonus = 5;
  }
  if (sensitiveData && tool.scores?.compliance < 60) {
    totalScore -= 10;
    details.sensitiveDataPenalty = -10;
  }

  if (apiAccess && tool.scores?.integration >= 80) {
    totalScore += 5;
    details.apiAccessBonus = 5;
  }
  if (apiAccess && tool.scores?.integration < 50) {
    totalScore -= 10;
    details.apiAccessPenalty = -10;
  }

  if (supportCritical && tool.scores?.support >= 80) {
    totalScore += 5;
    details.supportBonus = 5;
  }
  if (supportCritical && tool.scores?.support < 60) {
    totalScore -= 10;
    details.supportPenalty = -10;
  }

  return { total: Math.round(totalScore * 10) / 10, details };
}

function calculatePriorityWeights(priorities) {
  const weights = {};
  const priorityValues = [0.25, 0.20, 0.15, 0.10, 0.05]; // Top 5 priorities
  
  priorities.forEach((catId, index) => {
    if (index < 5) {
      weights[catId] = priorityValues[index];
    }
  });

  // Remaining categories split the remaining 25%
  const remaining = METHODOLOGY_CATEGORIES.filter(c => !priorities.includes(c.id));
  const remainingWeight = 0.25 / remaining.length;
  remaining.forEach(cat => {
    weights[cat.id] = remainingWeight;
  });

  return weights;
}

function filterByBudget(tools, budget, teamSize) {
  if (!budget) return tools;
  
  const budgetRanges = {
    'under10': { max: 10 },
    '10to25': { max: 25 },
    '25to50': { max: 50 },
    '50to100': { max: 100 },
    'over100': { max: Infinity }
  };

  const maxBudget = budgetRanges[budget]?.max || Infinity;
  
  return tools.filter(tool => {
    const price = tool.pricing?.perUser || 0;
    return price <= maxBudget;
  });
}

function findBudgetAlternative(tools, budget, teamSize, excludeSlug) {
  const budgetTools = filterByBudget(tools, budget, teamSize)
    .filter(t => t.slug !== excludeSlug)
    .sort((a, b) => (a.pricing?.perUser || 0) - (b.pricing?.perUser || 0));
  
  return budgetTools[0] || null;
}

function determineConfidence(tools) {
  if (tools.length >= 3) {
    const gap = tools[0]?.weightedScore.total - (tools[1]?.weightedScore.total || 0);
    if (gap >= 5) return 'high';
    return 'medium';
  }
  if (tools.length >= 1) return 'medium';
  return 'low';
}

function generateExplanation(tool, inputs) {
  if (!tool) return null;
  
  const { teamSize, industry, budget, priorities } = inputs;
  const teamDesc = {
    'solo': 'a solo user',
    'small': 'a small team',
    'mid': `a ${industry || 'mid-size'} team`,
    'large': 'a large team',
    'enterprise': 'an enterprise organization'
  }[teamSize] || 'your team';

  const topPriority = METHODOLOGY_CATEGORIES.find(c => c.id === priorities[0])?.name || 'your priorities';
  const topScore = tool.scores?.[priorities[0]] || 'strong';

  return `For ${teamDesc} with a $${getBudgetMax(budget)}/user budget, ${tool.name} scores highest on your weighted criteria. It excels in ${topPriority} (score: ${topScore}) which you ranked as your top priority, and ${tool.verdict || 'provides solid capabilities across your key requirements'}.`;
}

function generateRunnerUpNote(runnerUp, topTool, inputs) {
  const diff = Object.keys(runnerUp.scores || {}).find(key => 
    runnerUp.scores[key] > (topTool?.scores?.[key] || 0) + 10
  );
  
  if (diff) {
    const catName = METHODOLOGY_CATEGORIES.find(c => c.id === diff)?.name || diff;
    return `Choose ${runnerUp.name} instead if ${catName} is more important than the editorial score suggests.`;
  }
  
  return `${runnerUp.name} is a close second and may suit teams preferring ${runnerUp.verdict || 'a different approach'}.`;
}

function generateTradeoffs(otherTools, topTool) {
  return otherTools.map(tool => ({
    tool: tool.name,
    slug: tool.slug,
    tradeoff: `Choosing ${tool.name} over ${topTool?.name || 'the top pick'} means ${getTradeoffReason(tool, topTool)}.`
  }));
}

function getTradeoffReason(tool, topTool) {
  if (!topTool) return 'exploring an alternative option';
  
  const scoreDiff = (topTool.weightedScore?.total || 0) - (tool.weightedScore?.total || 0);
  if (scoreDiff > 10) {
    return `accepting a ${Math.round(scoreDiff)} point lower match score for your specific requirements`;
  }
  return 'trading off some capabilities for others based on your unique needs';
}

function getEliminationSteps(allTools, finalTools, inputs) {
  const steps = [];
  
  steps.push({
    step: 'Initial pool',
    count: allTools.length,
    description: `Started with ${allTools.length} reviewed tools`
  });

  if (inputs.budget) {
    const budgetFiltered = filterByBudget(allTools, inputs.budget, inputs.teamSize);
    if (budgetFiltered.length < allTools.length) {
      steps.push({
        step: 'Budget filter',
        count: budgetFiltered.length,
        eliminated: allTools.length - budgetFiltered.length,
        description: `Removed ${allTools.length - budgetFiltered.length} tools exceeding budget`
      });
    }
  }

  steps.push({
    step: 'Priority weighting',
    count: finalTools.length,
    description: `Ranked ${finalTools.length} tools by weighted score based on your priorities`
  });

  return steps;
}

function getBudgetMax(budget) {
  const ranges = { 'under10': 10, '10to25': 25, '25to50': 50, '50to100': 100, 'over100': '100+' };
  return ranges[budget] || '?';
}

function formatPrice(price) {
  if (!price) return 'Free';
  return `$${price}`;
}

async function getToolsForCategory(category) {
  // For now, return mock data - in production, query DynamoDB
  // This would be replaced with actual tool data from the reviews
  return [
    {
      slug: 'claude',
      name: 'Claude',
      verdict: 'Best for complex reasoning and teams prioritizing safety',
      scores: { core_ai: 92, privacy: 89, compliance: 85, pricing: 78, integration: 82, support: 80, reliability: 88, safety: 95, transparency: 90, innovation: 85 },
      pricing: { perUser: 20 }
    },
    {
      slug: 'gpt-4',
      name: 'GPT-4',
      verdict: 'Most versatile with strongest ecosystem',
      scores: { core_ai: 94, privacy: 75, compliance: 80, pricing: 70, integration: 95, support: 85, reliability: 90, safety: 82, transparency: 70, innovation: 92 },
      pricing: { perUser: 20 }
    },
    {
      slug: 'gemini',
      name: 'Gemini',
      verdict: 'Best value for Google Workspace teams',
      scores: { core_ai: 88, privacy: 78, compliance: 82, pricing: 85, integration: 88, support: 75, reliability: 85, safety: 80, transparency: 75, innovation: 88 },
      pricing: { perUser: 19 }
    },
    {
      slug: 'copilot',
      name: 'GitHub Copilot',
      verdict: 'Essential for development teams',
      scores: { core_ai: 90, privacy: 72, compliance: 75, pricing: 80, integration: 92, support: 78, reliability: 88, safety: 75, transparency: 72, innovation: 90 },
      pricing: { perUser: 19 }
    },
    {
      slug: 'perplexity',
      name: 'Perplexity',
      verdict: 'Best for research and fact-checking',
      scores: { core_ai: 85, privacy: 80, compliance: 75, pricing: 90, integration: 70, support: 72, reliability: 82, safety: 78, transparency: 85, innovation: 80 },
      pricing: { perUser: 8 }
    }
  ];
}

async function trackAnalytics(inputs) {
  const date = new Date().toISOString().split('T')[0];
  
  await docClient.send(new UpdateCommand({
    TableName: TABLES.analytics,
    Key: { date, type: 'daily' },
    UpdateExpression: 'SET recommendations = if_not_exists(recommendations, :zero) + :one, teamSizes.#ts = if_not_exists(teamSizes.#ts, :zero) + :one, industries.#ind = if_not_exists(industries.#ind, :zero) + :one',
    ExpressionAttributeNames: {
      '#ts': inputs.teamSize || 'unknown',
      '#ind': inputs.industry || 'unknown'
    },
    ExpressionAttributeValues: {
      ':zero': 0,
      ':one': 1
    }
  })).catch(() => {}); // Ignore errors for analytics
}

async function getAnalytics() {
  // Get last 30 days of analytics
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    dates.push(date);
  }

  // This would query actual analytics - returning mock for now
  return {
    totalRecommendations: 1247,
    last30Days: 342,
    topTeamSizes: [
      { size: 'small', count: 145 },
      { size: 'mid', count: 98 },
      { size: 'solo', count: 67 }
    ],
    topIndustries: [
      { industry: 'Technology', count: 112 },
      { industry: 'Healthcare', count: 78 },
      { industry: 'Financial Services', count: 65 }
    ],
    topPriorities: [
      { category: 'core_ai', avgRank: 1.8 },
      { category: 'pricing', avgRank: 2.4 },
      { category: 'privacy', avgRank: 2.9 }
    ],
    mostRecommended: [
      { tool: 'Claude', count: 89 },
      { tool: 'GPT-4', count: 76 },
      { tool: 'Gemini', count: 54 }
    ]
  };
}

function generateShareId() {
  return 'rec_' + Math.random().toString(36).substring(2, 15);
}
