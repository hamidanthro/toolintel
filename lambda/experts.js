// ToolIntel Verified Expert Network Lambda
// Feature 14: Independent expert contributors system

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  experts: 'toolintel-experts',
  applications: 'toolintel-expert-applications',
  contributions: 'toolintel-expert-contributions',
  coi: 'toolintel-expert-coi',
  requests: 'toolintel-expert-requests'
};

// Domain expertise tags
const EXPERTISE_TAGS = [
  'AI Security',
  'Healthcare AI',
  'Legal AI',
  'Financial AI',
  'NLP and Language Models',
  'Computer Vision',
  'AI Ethics and Bias',
  'Regulatory Compliance',
  'Enterprise Architecture',
  'Developer Tools',
  'Data Privacy Law'
];

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
    // GET /experts - List all active contributors
    if (method === 'GET' && path.endsWith('/experts')) {
      const experts = await getActiveExperts();
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          experts,
          expertiseTags: EXPERTISE_TAGS,
          totalContributions: experts.reduce((sum, e) => sum + (e.contributionCount || 0), 0)
        })
      };
    }

    // GET /experts/:id - Get single expert profile
    if (method === 'GET' && path.match(/\/experts\/[^/]+$/)) {
      const expertId = path.split('/experts/')[1];
      const expert = await getExpert(expertId);
      
      if (!expert) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Expert not found' })
        };
      }
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(expert)
      };
    }

    // GET /experts/:id/coi - Get expert's COI disclosures
    if (method === 'GET' && path.includes('/coi')) {
      const expertId = path.split('/experts/')[1].split('/coi')[0];
      const disclosures = await getCoiDisclosures(expertId);
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expertId, disclosures })
      };
    }

    // POST /experts/apply - Submit application
    if (method === 'POST' && path.endsWith('/apply')) {
      const body = JSON.parse(event.body || '{}');
      const result = await submitApplication(body);
      
      return {
        statusCode: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // GET /experts/contributions/:toolSlug - Get contributions for a tool
    if (method === 'GET' && path.includes('/contributions/')) {
      const toolSlug = path.split('/contributions/')[1];
      const contributions = await getToolContributions(toolSlug);
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolSlug, contributions })
      };
    }

    // POST /experts/contributions - Submit a contribution
    if (method === 'POST' && path.endsWith('/contributions')) {
      const body = JSON.parse(event.body || '{}');
      const result = await submitContribution(body);
      
      return {
        statusCode: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // POST /experts/request - Request expert review
    if (method === 'POST' && path.endsWith('/request')) {
      const body = JSON.parse(event.body || '{}');
      const result = await requestExpertReview(body);
      
      return {
        statusCode: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // GET /experts/requests/:toolSlug - Get expert requests for a tool
    if (method === 'GET' && path.includes('/requests/')) {
      const toolSlug = path.split('/requests/')[1];
      const requests = await getExpertRequests(toolSlug);
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolSlug, requests })
      };
    }

    // GET /experts/transparency-report - Get quarterly transparency report
    if (method === 'GET' && path.endsWith('/transparency-report')) {
      const report = await generateTransparencyReport();
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      };
    }

    // ===== ADMIN ENDPOINTS =====
    
    // GET /experts/admin/applications - Get pending applications
    if (method === 'GET' && path.endsWith('/admin/applications')) {
      const applications = await getPendingApplications();
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ applications })
      };
    }

    // POST /experts/admin/applications/:id/approve
    if (method === 'POST' && path.includes('/approve')) {
      const appId = path.split('/applications/')[1].split('/approve')[0];
      const result = await approveApplication(appId);
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // POST /experts/admin/applications/:id/reject
    if (method === 'POST' && path.includes('/reject')) {
      const appId = path.split('/applications/')[1].split('/reject')[0];
      const body = JSON.parse(event.body || '{}');
      const result = await rejectApplication(appId, body.reason);
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // GET /experts/admin/contributions - Get pending contributions
    if (method === 'GET' && path.endsWith('/admin/contributions')) {
      const contributions = await getPendingContributions();
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contributions })
      };
    }

    // POST /experts/admin/contributions/:id/approve
    if (method === 'POST' && path.includes('/contributions/') && path.includes('/approve')) {
      const contribId = path.split('/contributions/')[1].split('/approve')[0];
      const result = await approveContribution(contribId);
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // GET /experts/admin/queue - Get expert assignment queue
    if (method === 'GET' && path.endsWith('/admin/queue')) {
      const queue = await getAssignmentQueue();
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue })
      };
    }

    // GET /experts/admin/stats - Get admin dashboard stats
    if (method === 'GET' && path.endsWith('/admin/stats')) {
      const stats = await getAdminStats();
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(stats)
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

// ===== HELPER FUNCTIONS =====

async function getActiveExperts() {
  // In production, query DynamoDB. For now, return sample data.
  return [
    {
      id: 'expert_001',
      name: 'Dr. Sarah Chen',
      title: 'AI Security Researcher',
      employer: 'Stanford University',
      expertise: ['AI Security', 'Data Privacy Law', 'Regulatory Compliance'],
      bio: 'Dr. Chen specializes in adversarial machine learning and AI system security. She has published over 40 peer-reviewed papers on AI safety and serves as an advisor to the IEEE AI Standards Committee.',
      profileUrl: 'https://linkedin.com/in/sarahchen-ai',
      contributionCount: 12,
      joinedAt: '2026-01-15T00:00:00Z',
      lastContribution: '2026-02-18T00:00:00Z'
    },
    {
      id: 'expert_002',
      name: 'Michael Torres, JD',
      title: 'Healthcare AI Compliance Attorney',
      employer: 'Morrison & Associates LLP',
      expertise: ['Healthcare AI', 'Regulatory Compliance', 'Legal AI'],
      bio: 'Michael advises healthcare organizations on AI implementation compliance. Former FDA counsel with 15 years of experience in medical device and AI regulation.',
      profileUrl: 'https://linkedin.com/in/mtorres-healthlaw',
      contributionCount: 8,
      joinedAt: '2026-01-22T00:00:00Z',
      lastContribution: '2026-02-15T00:00:00Z'
    },
    {
      id: 'expert_003',
      name: 'Dr. Priya Sharma',
      title: 'Senior NLP Research Scientist',
      employer: 'Independent Consultant',
      expertise: ['NLP and Language Models', 'AI Ethics and Bias', 'Enterprise Architecture'],
      bio: 'Former Google AI researcher with expertise in large language model evaluation. Ph.D. in Computational Linguistics from MIT. Author of "Practical LLM Assessment" (O\'Reilly, 2025).',
      profileUrl: 'https://linkedin.com/in/priyasharma-nlp',
      contributionCount: 15,
      joinedAt: '2026-01-08T00:00:00Z',
      lastContribution: '2026-02-19T00:00:00Z'
    }
  ];
}

async function getExpert(expertId) {
  const experts = await getActiveExperts();
  return experts.find(e => e.id === expertId) || null;
}

async function getCoiDisclosures(expertId) {
  // Sample COI disclosures
  return [
    {
      date: '2026-01-08T00:00:00Z',
      type: 'initial',
      statement: 'I confirm I have no financial relationship with any AI tool company in the ToolIntel database.',
      verified: true
    },
    {
      date: '2026-02-01T00:00:00Z',
      type: 'update',
      statement: 'Disclosure: I received travel reimbursement from Anthropic for speaking at a safety conference. This was after my Claude review was published and did not influence my analysis.',
      verified: true
    }
  ];
}

async function submitApplication(data) {
  const { name, email, employer, title, linkedin, expertise, statement, workExamples, noFinancialRelation, agreeToCode } = data;
  
  if (!name || !email || !expertise || !statement || !agreeToCode) {
    throw new Error('Missing required fields');
  }
  
  if (!noFinancialRelation) {
    throw new Error('Applicants must confirm no financial relationship with AI tool companies');
  }
  
  const applicationId = 'app_' + Date.now();
  
  await docClient.send(new PutCommand({
    TableName: TABLES.applications,
    Item: {
      applicationId,
      name,
      email,
      employer,
      title,
      linkedin,
      expertise,
      statement,
      workExamples,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null
    }
  }));
  
  return {
    applicationId,
    message: 'Application submitted successfully. You will receive a response within 14 days.'
  };
}

async function getToolContributions(toolSlug) {
  // Sample contributions for a tool
  return [
    {
      id: 'contrib_001',
      toolSlug,
      expertId: 'expert_003',
      expertName: 'Dr. Priya Sharma',
      expertTitle: 'Senior NLP Research Scientist',
      expertiseTag: 'NLP and Language Models',
      submittedAt: '2026-02-10T00:00:00Z',
      approvedAt: '2026-02-12T00:00:00Z',
      sections: {
        methodology: 'I tested the model across 500 diverse prompts including multi-turn conversations, reasoning tasks, and creative writing. Testing was conducted over two weeks with systematic documentation of response quality, latency, and edge case handling.',
        findings: 'The model demonstrates strong performance on straightforward tasks but shows inconsistency in complex multi-step reasoning. Response latency averaged 2.3 seconds, with occasional spikes to 8+ seconds during peak hours.',
        agreementAreas: 'I agree with ToolIntel\'s high scores for Core AI Capability (92) and Safety (95). The model\'s refusal behavior is well-calibrated and its factual accuracy on tested domains was impressive.',
        disagreementAreas: 'I believe the Integration & API score (82) may be generous. During testing, I encountered several undocumented API behaviors and the rate limiting documentation was incomplete. A score of 72-75 would be more accurate based on developer experience.',
        domainInsights: 'For NLP researchers specifically: The model excels at structured data extraction but struggles with domain-specific jargon unless heavily prompted. Consider fine-tuning or RAG approaches for specialized applications.'
      }
    }
  ];
}

async function submitContribution(data) {
  const { expertId, toolSlug, expertiseTag, sections } = data;
  
  if (!expertId || !toolSlug || !sections) {
    throw new Error('Missing required fields');
  }
  
  const requiredSections = ['methodology', 'findings', 'agreementAreas', 'disagreementAreas', 'domainInsights'];
  for (const section of requiredSections) {
    if (!sections[section]) {
      throw new Error(`Missing required section: ${section}`);
    }
  }
  
  const contributionId = 'contrib_' + Date.now();
  
  await docClient.send(new PutCommand({
    TableName: TABLES.contributions,
    Item: {
      contributionId,
      expertId,
      toolSlug,
      expertiseTag,
      sections,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      approvedAt: null
    }
  }));
  
  return {
    contributionId,
    message: 'Contribution submitted for editorial review.'
  };
}

async function requestExpertReview(data) {
  const { toolSlug, userId, expertiseRequested, reason } = data;
  
  if (!toolSlug || !expertiseRequested) {
    throw new Error('Tool and expertise type are required');
  }
  
  const requestId = 'req_' + Date.now();
  
  await docClient.send(new PutCommand({
    TableName: TABLES.requests,
    Item: {
      requestId,
      toolSlug,
      userId: userId || 'anonymous',
      expertiseRequested,
      reason,
      createdAt: new Date().toISOString()
    }
  }));
  
  return {
    requestId,
    message: 'Expert review request submitted. Requests are aggregated and prioritized based on demand.'
  };
}

async function getExpertRequests(toolSlug) {
  // Sample aggregated requests
  return {
    total: 7,
    byExpertise: [
      { expertise: 'Healthcare AI', count: 4 },
      { expertise: 'Regulatory Compliance', count: 2 },
      { expertise: 'AI Security', count: 1 }
    ]
  };
}

async function generateTransparencyReport() {
  const currentQuarter = 'Q1 2026';
  
  return {
    quarter: currentQuarter,
    generatedAt: new Date().toISOString(),
    activeContributors: 12,
    contributionsPublished: 28,
    disagreementsWithEditorial: {
      total: 8,
      byCategory: [
        { category: 'Integration & API', count: 3 },
        { category: 'Vendor Support', count: 2 },
        { category: 'Pricing Transparency', count: 2 },
        { category: 'Reliability', count: 1 }
      ]
    },
    applications: {
      received: 47,
      approved: 8,
      rejected: 31,
      pending: 8,
      approvalRate: '17%'
    },
    departures: [
      {
        reason: 'voluntary',
        count: 1,
        note: 'Career transition to vendor role'
      }
    ],
    note: 'This report is the most important trust signal the expert network produces.'
  };
}

async function getPendingApplications() {
  // Sample pending applications
  return [
    {
      applicationId: 'app_1234567890',
      name: 'Dr. James Wilson',
      email: 'jwilson@example.edu',
      employer: 'Johns Hopkins University',
      title: 'Associate Professor of Computer Science',
      expertise: ['AI Ethics and Bias', 'Healthcare AI'],
      statement: 'My research focuses on fairness and bias in medical AI systems...',
      submittedAt: '2026-02-18T10:30:00Z',
      score: 85
    }
  ];
}

async function approveApplication(applicationId) {
  // In production, update DynamoDB and create expert profile
  return {
    applicationId,
    status: 'approved',
    message: 'Application approved. Welcome email sent to contributor.'
  };
}

async function rejectApplication(applicationId, reason) {
  // In production, update DynamoDB and send rejection email
  return {
    applicationId,
    status: 'rejected',
    reason,
    message: 'Application rejected. Feedback email sent to applicant.'
  };
}

async function getPendingContributions() {
  // Sample pending contributions
  return [
    {
      contributionId: 'contrib_pending_001',
      expertId: 'expert_002',
      expertName: 'Michael Torres, JD',
      toolSlug: 'gpt-4',
      expertiseTag: 'Healthcare AI',
      submittedAt: '2026-02-19T14:00:00Z',
      preview: 'Analysis of GPT-4\'s HIPAA compliance capabilities...'
    }
  ];
}

async function approveContribution(contributionId) {
  return {
    contributionId,
    status: 'approved',
    message: 'Contribution approved and published.'
  };
}

async function getAssignmentQueue() {
  // Tools flagged for expert review
  return [
    {
      toolSlug: 'claude',
      toolName: 'Claude',
      requestedExpertise: 'Healthcare AI',
      requestCount: 4,
      priority: 'high'
    },
    {
      toolSlug: 'gemini',
      toolName: 'Gemini',
      requestedExpertise: 'Financial AI',
      requestCount: 3,
      priority: 'high'
    },
    {
      toolSlug: 'copilot',
      toolName: 'GitHub Copilot',
      requestedExpertise: 'AI Security',
      requestCount: 2,
      priority: 'medium'
    }
  ];
}

async function getAdminStats() {
  return {
    activeExperts: 12,
    pendingApplications: 8,
    pendingContributions: 3,
    queuedRequests: 15,
    contributionsThisMonth: 11,
    avgReviewTime: '4.2 days'
  };
}
