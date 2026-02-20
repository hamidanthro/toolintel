// ToolIntel Research Submission Portal Lambda
// Independent research submissions from researchers, academics, and security professionals

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  submissions: 'toolintel-research-submissions',
  requests: 'toolintel-research-requests',
  requestVotes: 'toolintel-research-request-votes'
};

// Submission types
const SUBMISSION_TYPES = {
  SECURITY: 'security',
  ACCURACY: 'accuracy',
  BIAS: 'bias'
};

// Review stages
const REVIEW_STAGES = {
  PENDING_AUTHENTICITY: 'pending_authenticity',
  PENDING_METHODOLOGY: 'pending_methodology',
  PENDING_VENDOR: 'pending_vendor',
  PUBLISHED: 'published',
  REJECTED: 'rejected'
};

// Vulnerability types
const VULNERABILITY_TYPES = [
  'Data Exposure',
  'Prompt Injection',
  'Training Data Leakage',
  'Authentication Bypass',
  'Output Manipulation',
  'Privacy Violation'
];

// Protected characteristics for bias studies
const PROTECTED_CHARACTERISTICS = [
  'Age',
  'Gender',
  'Race and Ethnicity',
  'Religion',
  'Disability',
  'National Origin',
  'Sexual Orientation',
  'Socioeconomic Status',
  'Other'
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
    // GET /research - Get portal data (published research, stats)
    if (method === 'GET' && path.endsWith('/research')) {
      const data = await getPortalData();
      return success(data);
    }

    // GET /research/published - Get all published research
    if (method === 'GET' && path.endsWith('/published')) {
      const published = await getPublishedResearch();
      return success({ submissions: published });
    }

    // GET /research/submission/:id - Get single submission
    if (method === 'GET' && path.match(/\/research\/submission\/[^/]+$/)) {
      const submissionId = path.split('/submission/')[1];
      const submission = await getSubmission(submissionId);
      if (!submission) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Submission not found' }) };
      }
      return success(submission);
    }

    // POST /research/submit/security - Submit security vulnerability
    if (method === 'POST' && path.endsWith('/submit/security')) {
      const body = JSON.parse(event.body || '{}');
      const result = await submitSecurityVulnerability(body);
      return created(result);
    }

    // POST /research/submit/accuracy - Submit accuracy study
    if (method === 'POST' && path.endsWith('/submit/accuracy')) {
      const body = JSON.parse(event.body || '{}');
      const result = await submitAccuracyStudy(body);
      return created(result);
    }

    // POST /research/submit/bias - Submit bias analysis
    if (method === 'POST' && path.endsWith('/submit/bias')) {
      const body = JSON.parse(event.body || '{}');
      const result = await submitBiasAnalysis(body);
      return created(result);
    }

    // GET /research/requests - Get all research requests
    if (method === 'GET' && path.endsWith('/requests')) {
      const requests = await getResearchRequests();
      return success({ requests });
    }

    // POST /research/requests - Submit new research request
    if (method === 'POST' && path.endsWith('/requests')) {
      const body = JSON.parse(event.body || '{}');
      const result = await submitResearchRequest(body);
      return created(result);
    }

    // POST /research/requests/:id/vote - Vote for a research request
    if (method === 'POST' && path.includes('/vote')) {
      const requestId = path.split('/requests/')[1].split('/vote')[0];
      const body = JSON.parse(event.body || '{}');
      const result = await voteForRequest(requestId, body.userId);
      return success(result);
    }

    // GET /research/tool/:toolSlug - Get research for specific tool
    if (method === 'GET' && path.includes('/tool/')) {
      const toolSlug = path.split('/tool/')[1];
      const research = await getToolResearch(toolSlug);
      return success({ toolSlug, research });
    }

    // ===== ADMIN ENDPOINTS =====

    // GET /research/admin/pending - Get all pending submissions
    if (method === 'GET' && path.endsWith('/admin/pending')) {
      const pending = await getPendingSubmissions();
      return success({ submissions: pending });
    }

    // GET /research/admin/published - Get published with stats
    if (method === 'GET' && path.endsWith('/admin/published')) {
      const published = await getPublishedWithStats();
      return success({ submissions: published });
    }

    // GET /research/admin/rejected - Get rejected submissions
    if (method === 'GET' && path.endsWith('/admin/rejected')) {
      const rejected = await getRejectedSubmissions();
      return success({ submissions: rejected });
    }

    // GET /research/admin/requests - Get research requests ranked by votes
    if (method === 'GET' && path.endsWith('/admin/requests')) {
      const requests = await getResearchRequestsAdmin();
      return success({ requests });
    }

    // POST /research/admin/submission/:id/advance - Advance to next stage
    if (method === 'POST' && path.includes('/advance')) {
      const submissionId = path.split('/submission/')[1].split('/advance')[0];
      const result = await advanceSubmission(submissionId);
      return success(result);
    }

    // POST /research/admin/submission/:id/reject - Reject submission
    if (method === 'POST' && path.includes('/reject')) {
      const submissionId = path.split('/submission/')[1].split('/reject')[0];
      const body = JSON.parse(event.body || '{}');
      const result = await rejectSubmission(submissionId, body.reason);
      return success(result);
    }

    // POST /research/admin/submission/:id/publish - Publish submission
    if (method === 'POST' && path.includes('/publish')) {
      const submissionId = path.split('/submission/')[1].split('/publish')[0];
      const result = await publishSubmission(submissionId);
      return success(result);
    }

    // POST /research/admin/submission/:id/impact - Update impact tracker
    if (method === 'POST' && path.includes('/impact')) {
      const submissionId = path.split('/submission/')[1].split('/impact')[0];
      const body = JSON.parse(event.body || '{}');
      const result = await updateImpactTracker(submissionId, body);
      return success(result);
    }

    // GET /research/admin/stats - Get admin dashboard stats
    if (method === 'GET' && path.endsWith('/admin/stats')) {
      const stats = await getAdminStats();
      return success(stats);
    }

    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Not found' }) };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
};

// Helper responses
function success(data) {
  return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function created(data) {
  return { statusCode: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

// ===== PORTAL DATA =====

async function getPortalData() {
  const published = await getPublishedResearch();
  const requests = await getResearchRequests();
  
  return {
    submissionTypes: [
      {
        type: SUBMISSION_TYPES.SECURITY,
        title: 'Security Vulnerability Disclosure',
        description: 'For researchers who have discovered a security weakness or data exposure risk in a reviewed tool.',
        expectedFormat: 'Technical writeup with CVE (if assigned), proof of concept, and reproduction steps',
        reviewTimeline: '5 business days for authenticity, 14 days for methodology review',
        afterSubmission: 'Vendor notified immediately, 90-day disclosure timeline begins'
      },
      {
        type: SUBMISSION_TYPES.ACCURACY,
        title: 'Accuracy and Performance Study',
        description: 'For researchers who have conducted systematic testing of a tool\'s outputs against a defined benchmark.',
        expectedFormat: 'Full study document (PDF) with methodology, sample size, and quantitative results',
        reviewTimeline: '5 business days for authenticity, 14 days for methodology review',
        afterSubmission: 'Published with full attribution after vendor response period'
      },
      {
        type: SUBMISSION_TYPES.BIAS,
        title: 'Bias and Fairness Analysis',
        description: 'For researchers who have tested a tool for demographic bias, discriminatory outputs, or fairness failures.',
        expectedFormat: 'Study document with per-group sample sizes, disparity metrics, and qualitative analysis',
        reviewTimeline: '5 business days for authenticity, 14 days for methodology review',
        afterSubmission: 'Published with full attribution after vendor response period'
      }
    ],
    publishedResearch: published,
    researchRequests: requests.filter(r => r.votes >= 1).slice(0, 10),
    stats: {
      totalPublished: published.length,
      pendingReview: 3, // Sample
      communityPriorities: requests.filter(r => r.votes >= 10).length
    },
    vulnerabilityTypes: VULNERABILITY_TYPES,
    protectedCharacteristics: PROTECTED_CHARACTERISTICS
  };
}

// ===== SUBMISSION HANDLERS =====

async function submitSecurityVulnerability(data) {
  const {
    researcherName, affiliation, email, cveNumber, toolAffected,
    versionOrEndpoint, vulnerabilityType, severityRating, technicalDescription,
    proofOfConcept, discoveryDate, vendorNotified, vendorNotificationDate,
    vendorResponse, disclosurePreference
  } = data;

  if (!researcherName || !email || !toolAffected || !vulnerabilityType || !technicalDescription) {
    throw new Error('Missing required fields');
  }

  const submissionId = 'sec_' + Date.now();
  const now = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: TABLES.submissions,
    Item: {
      submissionId,
      type: SUBMISSION_TYPES.SECURITY,
      status: REVIEW_STAGES.PENDING_AUTHENTICITY,
      researcherName,
      affiliation,
      email,
      cveNumber,
      toolAffected,
      versionOrEndpoint,
      vulnerabilityType,
      severityRating,
      technicalDescription,
      proofOfConcept,
      discoveryDate,
      vendorNotified,
      vendorNotificationDate,
      vendorResponse,
      disclosurePreference,
      submittedAt: now,
      stageEnteredAt: now,
      impact: { scoreChanged: false, vendorAcknowledged: false, externalCitations: [] }
    }
  }));

  return {
    submissionId,
    message: 'Security vulnerability submission received. You will receive confirmation within 5 business days.',
    disclosureNote: 'ToolIntel follows a 90-day responsible disclosure timeline.'
  };
}

async function submitAccuracyStudy(data) {
  const {
    researcherName, affiliation, email, toolsStudied, methodology,
    keyFindings, studyDocumentUrl, peerReviewed, publishedElsewhere,
    publishedLink, datasetAvailability, noFinancialRelationship, irbApproval
  } = data;

  if (!researcherName || !email || !toolsStudied || !methodology || !keyFindings || !noFinancialRelationship) {
    throw new Error('Missing required fields');
  }

  const submissionId = 'acc_' + Date.now();
  const now = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: TABLES.submissions,
    Item: {
      submissionId,
      type: SUBMISSION_TYPES.ACCURACY,
      status: REVIEW_STAGES.PENDING_AUTHENTICITY,
      researcherName,
      affiliation,
      email,
      toolsStudied,
      methodology,
      keyFindings,
      studyDocumentUrl,
      peerReviewed,
      publishedElsewhere,
      publishedLink,
      datasetAvailability,
      noFinancialRelationship,
      irbApproval,
      submittedAt: now,
      stageEnteredAt: now,
      impact: { scoreChanged: false, vendorAcknowledged: false, externalCitations: [] }
    }
  }));

  return {
    submissionId,
    message: 'Accuracy study submission received. Authenticity check begins within 5 business days.'
  };
}

async function submitBiasAnalysis(data) {
  const {
    researcherName, affiliation, email, toolStudied, protectedCharacteristics,
    testingMethodology, quantitativeFindings, qualitativeAnalysis,
    recommendations, studyDocumentUrl, noFinancialRelationship
  } = data;

  if (!researcherName || !email || !toolStudied || !protectedCharacteristics || !testingMethodology || !noFinancialRelationship) {
    throw new Error('Missing required fields');
  }

  const submissionId = 'bias_' + Date.now();
  const now = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: TABLES.submissions,
    Item: {
      submissionId,
      type: SUBMISSION_TYPES.BIAS,
      status: REVIEW_STAGES.PENDING_AUTHENTICITY,
      researcherName,
      affiliation,
      email,
      toolStudied,
      protectedCharacteristics,
      testingMethodology,
      quantitativeFindings,
      qualitativeAnalysis,
      recommendations,
      studyDocumentUrl,
      noFinancialRelationship,
      submittedAt: now,
      stageEnteredAt: now,
      impact: { scoreChanged: false, vendorAcknowledged: false, externalCitations: [] }
    }
  }));

  return {
    submissionId,
    message: 'Bias analysis submission received. Authenticity check begins within 5 business days.'
  };
}

// ===== RESEARCH REQUESTS =====

async function getResearchRequests() {
  // Sample data - in production, query DynamoDB
  return [
    {
      requestId: 'req_001',
      toolSlug: 'hirevue',
      toolName: 'HireVue',
      question: 'Independent bias testing of AI-powered video interview assessments',
      requestedBy: 'anonymous',
      votes: 23,
      createdAt: '2026-02-15T00:00:00Z',
      isPriority: true
    },
    {
      requestId: 'req_002',
      toolSlug: 'clearview',
      toolName: 'Clearview AI',
      question: 'Accuracy testing of facial recognition across different lighting conditions and demographics',
      requestedBy: 'anonymous',
      votes: 18,
      createdAt: '2026-02-10T00:00:00Z',
      isPriority: true
    },
    {
      requestId: 'req_003',
      toolSlug: 'copilot',
      toolName: 'GitHub Copilot',
      question: 'Security analysis of code suggestions — potential for injecting vulnerable patterns',
      requestedBy: 'anonymous',
      votes: 12,
      createdAt: '2026-02-18T00:00:00Z',
      isPriority: true
    },
    {
      requestId: 'req_004',
      toolSlug: 'chatgpt',
      toolName: 'ChatGPT',
      question: 'Systematic testing of refusal consistency across rephrased harmful requests',
      requestedBy: 'anonymous',
      votes: 8,
      createdAt: '2026-02-19T00:00:00Z',
      isPriority: false
    }
  ];
}

async function submitResearchRequest(data) {
  const { toolSlug, toolName, question, userId } = data;

  if (!toolSlug || !question) {
    throw new Error('Tool and research question are required');
  }

  const requestId = 'req_' + Date.now();

  await docClient.send(new PutCommand({
    TableName: TABLES.requests,
    Item: {
      requestId,
      toolSlug,
      toolName: toolName || toolSlug,
      question,
      requestedBy: userId || 'anonymous',
      votes: 1,
      voters: [userId || 'anonymous'],
      createdAt: new Date().toISOString(),
      isPriority: false
    }
  }));

  return {
    requestId,
    message: 'Research request submitted. Others can now vote to prioritize this research.'
  };
}

async function voteForRequest(requestId, userId) {
  // In production: check if user already voted, increment vote count
  return {
    requestId,
    newVoteCount: 15,
    message: 'Vote recorded. Thank you for helping prioritize community research.'
  };
}

// ===== PUBLISHED RESEARCH =====

async function getPublishedResearch() {
  // Sample published research
  return [
    {
      submissionId: 'sec_1707840000000',
      type: 'security',
      typeLabel: 'Security Vulnerability',
      researcherName: 'Dr. Alex Rivera',
      affiliation: 'MIT CSAIL',
      toolStudied: 'Claude',
      title: 'Prompt Injection Vulnerability in System Message Parsing',
      summary: 'Discovered a method to override system instructions through carefully crafted Unicode characters that bypass input sanitization.',
      publishedAt: '2026-02-10T00:00:00Z',
      severityRating: 'High',
      impact: {
        scoreChanged: true,
        scoreChangeDetails: 'Privacy & Security score reduced from 94 to 91',
        vendorAcknowledged: true,
        vendorAcknowledgedDate: '2026-02-08T00:00:00Z',
        vendorFixed: true,
        vendorFixDate: '2026-02-15T00:00:00Z',
        externalCitations: [
          { source: 'Ars Technica', url: 'https://arstechnica.com/example', date: '2026-02-12' },
          { source: 'The Register', url: 'https://theregister.com/example', date: '2026-02-11' }
        ]
      }
    },
    {
      submissionId: 'bias_1707753600000',
      type: 'bias',
      typeLabel: 'Bias Analysis',
      researcherName: 'Prof. Maria Santos',
      affiliation: 'Stanford HAI',
      toolStudied: 'GPT-4',
      title: 'Gender Bias in Career Recommendation Outputs',
      summary: 'Systematic testing revealed GPT-4 recommends technical careers 34% more often for male-coded names vs female-coded names given identical qualifications.',
      publishedAt: '2026-02-05T00:00:00Z',
      impact: {
        scoreChanged: true,
        scoreChangeDetails: 'Bias & Fairness score reduced from 85 to 78',
        vendorAcknowledged: true,
        vendorAcknowledgedDate: '2026-02-18T00:00:00Z',
        vendorFixed: false,
        externalCitations: [
          { source: 'MIT Technology Review', url: 'https://technologyreview.com/example', date: '2026-02-08' }
        ]
      }
    },
    {
      submissionId: 'acc_1707667200000',
      type: 'accuracy',
      typeLabel: 'Accuracy Study',
      researcherName: 'Dr. James Park',
      affiliation: 'Google DeepMind (Independent)',
      toolStudied: 'Gemini Pro',
      title: 'Mathematical Reasoning Benchmark: Gemini vs GPT-4 vs Claude',
      summary: 'Comprehensive testing across 1,000 graduate-level math problems showed Gemini Pro achieving 67% accuracy vs GPT-4\'s 71% and Claude\'s 69%.',
      publishedAt: '2026-01-28T00:00:00Z',
      impact: {
        scoreChanged: false,
        vendorAcknowledged: false,
        externalCitations: []
      }
    }
  ];
}

async function getSubmission(submissionId) {
  // In production, fetch from DynamoDB
  const published = await getPublishedResearch();
  return published.find(s => s.submissionId === submissionId) || null;
}

async function getToolResearch(toolSlug) {
  const published = await getPublishedResearch();
  return published.filter(s => s.toolStudied.toLowerCase().replace(/\s+/g, '-') === toolSlug);
}

// ===== ADMIN FUNCTIONS =====

async function getPendingSubmissions() {
  // Sample pending submissions
  return [
    {
      submissionId: 'sec_1708387200000',
      type: 'security',
      status: REVIEW_STAGES.PENDING_AUTHENTICITY,
      researcherName: 'Anonymous Researcher',
      email: 'researcher@university.edu',
      toolAffected: 'Midjourney',
      vulnerabilityType: 'Training Data Leakage',
      severityRating: 'Medium',
      submittedAt: '2026-02-19T12:00:00Z',
      stageEnteredAt: '2026-02-19T12:00:00Z',
      daysInStage: 1
    },
    {
      submissionId: 'bias_1708300800000',
      type: 'bias',
      status: REVIEW_STAGES.PENDING_METHODOLOGY,
      researcherName: 'Dr. Sarah Kim',
      email: 's.kim@berkeley.edu',
      affiliation: 'UC Berkeley',
      toolStudied: 'Stable Diffusion',
      protectedCharacteristics: ['Race and Ethnicity', 'Gender'],
      submittedAt: '2026-02-18T12:00:00Z',
      stageEnteredAt: '2026-02-19T10:00:00Z',
      daysInStage: 1
    },
    {
      submissionId: 'acc_1708214400000',
      type: 'accuracy',
      status: REVIEW_STAGES.PENDING_VENDOR,
      researcherName: 'Prof. Michael Chen',
      email: 'm.chen@cmu.edu',
      affiliation: 'Carnegie Mellon',
      toolsStudied: 'Perplexity',
      submittedAt: '2026-02-17T12:00:00Z',
      stageEnteredAt: '2026-02-20T08:00:00Z',
      daysInStage: 0,
      vendorNotifiedAt: '2026-02-20T08:30:00Z'
    }
  ];
}

async function getPublishedWithStats() {
  const published = await getPublishedResearch();
  return published.map(s => ({
    ...s,
    citationCount: s.impact.externalCitations?.length || 0,
    hasScoreImpact: s.impact.scoreChanged
  }));
}

async function getRejectedSubmissions() {
  return [
    {
      submissionId: 'acc_rejected_001',
      type: 'accuracy',
      researcherName: 'John Doe',
      toolStudied: 'ChatGPT',
      submittedAt: '2026-02-01T00:00:00Z',
      rejectedAt: '2026-02-08T00:00:00Z',
      rejectionReason: 'Methodology concerns: Sample size of 50 prompts is insufficient for statistical significance. Recommended minimum is 500 for accuracy studies. Additionally, no control baseline was established.'
    },
    {
      submissionId: 'sec_rejected_001',
      type: 'security',
      researcherName: 'Anonymous',
      toolAffected: 'Claude',
      submittedAt: '2026-01-25T00:00:00Z',
      rejectedAt: '2026-01-30T00:00:00Z',
      rejectionReason: 'Unable to verify researcher identity. Professional email required — submission used personal Gmail with no verifiable institutional affiliation.'
    }
  ];
}

async function getResearchRequestsAdmin() {
  const requests = await getResearchRequests();
  return requests.sort((a, b) => b.votes - a.votes);
}

async function advanceSubmission(submissionId) {
  // In production, update status in DynamoDB
  return {
    submissionId,
    message: 'Submission advanced to next review stage.',
    newStatus: REVIEW_STAGES.PENDING_METHODOLOGY
  };
}

async function rejectSubmission(submissionId, reason) {
  if (!reason) throw new Error('Rejection reason is required');
  
  return {
    submissionId,
    status: REVIEW_STAGES.REJECTED,
    reason,
    message: 'Submission rejected. Researcher will be notified with the provided explanation.'
  };
}

async function publishSubmission(submissionId) {
  return {
    submissionId,
    status: REVIEW_STAGES.PUBLISHED,
    publishedAt: new Date().toISOString(),
    message: 'Submission published with full attribution.'
  };
}

async function updateImpactTracker(submissionId, impactData) {
  const { scoreChanged, scoreChangeDetails, vendorAcknowledged, vendorFixed, externalCitation } = impactData;
  
  return {
    submissionId,
    impact: {
      scoreChanged,
      scoreChangeDetails,
      vendorAcknowledged,
      vendorFixed,
      externalCitations: externalCitation ? [externalCitation] : []
    },
    message: 'Impact tracker updated.'
  };
}

async function getAdminStats() {
  return {
    totalSubmissions: 47,
    pendingAuthenticity: 3,
    pendingMethodology: 5,
    pendingVendor: 2,
    published: 34,
    rejected: 14,
    rejectionRate: '30%',
    avgReviewDays: 12,
    researchRequests: 28,
    priorityRequests: 4
  };
}
