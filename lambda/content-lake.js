/**
 * GradeEarn — CONTENT LAKE MODULE
 *
 * The single interface for reading and writing content artifacts.
 * Every other Lambda handler talks to the lake through this module.
 *
 * Public API:
 *   getOrGenerateQuestion({ poolKey, userId, recentContentIds, generator })
 *   savePoolItem({ poolKey, candidate, ... })           // for batch generate
 *   readPoolForBucket({ poolKey, recentContentIds })    // for batch generate
 *   getOrGenerateExplanation({ contentId, ... })
 *   getOrGenerateTutorResponse({ scopeKey, requestText, generator })
 *   recordEvent({ eventType, contentId, userId, sessionId, ... })
 *   computeEmbedding(text)
 *   areEmbeddingsTooSimilar(a, b, threshold)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand
} = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const POOL_TABLE = process.env.POOL_TABLE || 'staar-content-pool';
const EXPLANATIONS_TABLE = process.env.EXPLANATIONS_TABLE || 'staar-explanations';
const EVENTS_TABLE = process.env.EVENTS_TABLE || 'staar-content-events';
const TUTOR_TABLE = process.env.TUTOR_TABLE || 'staar-tutor-responses';

// Tunable thresholds
const POOL_MIN_THRESHOLD = 30;
const POOL_TARGET_SIZE = 100;
const DEDUP_SIMILARITY_THRESHOLD = 0.92;
const QUALITY_FETCH_TOP_PERCENT = 0.4;
const EVENT_TTL_DAYS = 90;
const RECENT_CONTENT_BUFFER = 50;

// ============================================================
// ID GENERATION — sortable
// ============================================================

function generateId(prefix = 'c') {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rand = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${ts}_${rand}`;
}

// ============================================================
// EMBEDDINGS — direct fetch to OpenAI to avoid extra dep
// ============================================================

async function computeEmbedding(text, apiKey) {
  if (!apiKey) throw new Error('computeEmbedding requires apiKey');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: String(text || '').slice(0, 8000),
      encoding_format: 'float'
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`embed ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.data[0].embedding;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom ? dot / denom : 0;
}

function areEmbeddingsTooSimilar(a, b, threshold = DEDUP_SIMILARITY_THRESHOLD) {
  return cosineSimilarity(a, b) >= threshold;
}

// ============================================================
// VALIDATION
// ============================================================

function validateQuestion(item) {
  const errors = [];
  const promptText = item.prompt || item.question;

  if (!promptText || typeof promptText !== 'string') {
    errors.push('prompt missing');
  }
  if (item.type === 'multiple_choice' || Array.isArray(item.choices)) {
    if (!Array.isArray(item.choices) || item.choices.length < 2 || item.choices.length > 4) {
      errors.push('choices must be 2-4 strings');
    } else if (item.choices.some(c => !c || typeof c !== 'string')) {
      errors.push('choices must all be non-empty strings');
    }
  }
  const answer = item.answer != null ? String(item.answer) : '';
  if (!answer) errors.push('answer required');
  if (!item.explanation || String(item.explanation).length < 6) {
    errors.push('explanation missing or too short');
  }

  // Reading-specific (when added)
  if (item.subject === 'reading' && item.passage && item.passage.text) {
    const wordCount = String(item.passage.text).split(/\s+/).filter(Boolean).length;
    const grade = item.grade || '';
    const isLowerGrade = ['grade-3', 'grade-4', 'grade-5', 'grade-k', 'grade-1', 'grade-2'].includes(grade);
    const min = isLowerGrade ? 60 : 120;
    const max = isLowerGrade ? 220 : 360;
    if (wordCount < min || wordCount > max) {
      errors.push(`passage word count ${wordCount} outside range ${min}-${max}`);
    }
  }

  // Lightweight profanity check
  const naughty = ['damn', 'hell', 'crap', 'stupid', 'idiot', 'dumb'];
  const allText = [promptText, ...(item.choices || []), item.explanation, item.passage?.text]
    .filter(Boolean).join(' ').toLowerCase();
  for (const w of naughty) {
    if (new RegExp(`\\b${w}\\b`).test(allText)) {
      errors.push(`contains disallowed word: ${w}`);
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateExplanation(item) {
  const errors = [];
  if (!item.explanation || String(item.explanation).length < 10) {
    errors.push('explanation too short');
  }
  return { valid: errors.length === 0, errors };
}

// ============================================================
// READ — query pool for a bucket
// ============================================================

async function readPoolForBucket({ poolKey, recentContentIds = [], limit = 100 }) {
  const recentSet = new Set(recentContentIds);
  const queryResult = await ddb.send(new QueryCommand({
    TableName: POOL_TABLE,
    IndexName: 'poolKey-quality-index',
    KeyConditionExpression: 'poolKey = :pk',
    FilterExpression: 'attribute_not_exists(#status) OR #status = :active',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':pk': poolKey, ':active': 'active' },
    ScanIndexForward: false,
    Limit: limit
  }));
  const items = (queryResult.Items || []).filter(item => !recentSet.has(item.contentId));
  return items;
}

// ============================================================
// WRITE — save a candidate to the pool (with dedup + embedding)
// ============================================================

/**
 * Save a generated question to the pool. Returns { contentId, saved, reason }.
 * Performs validation + embedding + similarity dedup against existing pool items.
 */
// ============================================================
// Defensive schema gate for any PutItem to the pool.
// Catches bug 186 (May 2 lake audit): rows getting saved with
// correctIndex=null because the upstream writer didn't compute it.
// Layer 2 of a 2-layer fix; Layer 1 is in lambda/tutor.js#sanitizeQuestions.
//
// Branches on candidate.type:
//   multiple_choice (default) — requires choices[≥2] of non-empty strings
//                                AND correctIndex int in [0, choices.length)
//   numeric                   — requires non-empty answer string;
//                                correctIndex may be null (not applicable)
//
// On reject: logs a structured CloudWatch line with prefix
//   [lake.savePoolItem REJECTED]
// so the rejection rate is grep-able as a production health metric.
// Never throws — caller treats {saved:false, reason} as the outcome.
// ============================================================
function _enforceSaveSchema(candidate, contextForLog) {
  const errors = [];
  const t = candidate.type === 'numeric' ? 'numeric' : 'multiple_choice';

  if (!candidate.state || typeof candidate.state !== 'string') errors.push('state_missing');
  if (!candidate.subject || typeof candidate.subject !== 'string') errors.push('subject_missing');
  if (candidate.grade == null || candidate.grade === '') errors.push('grade_missing');

  const promptText = candidate.question || candidate.prompt || '';
  if (typeof promptText !== 'string' || promptText.length < 6) errors.push('question_missing_or_short');

  if (typeof candidate.explanation !== 'string') errors.push('explanation_missing');

  if (t === 'multiple_choice') {
    if (!Array.isArray(candidate.choices) || candidate.choices.length < 2) {
      errors.push('choices_missing_or_too_few');
    } else if (candidate.choices.some(c => !c || typeof c !== 'string')) {
      errors.push('choices_contain_empty_or_non_string');
    } else if (!Number.isInteger(candidate.correctIndex)
               || candidate.correctIndex < 0
               || candidate.correctIndex >= candidate.choices.length) {
      errors.push('correctIndex_invalid');
    }
  } else {
    // numeric: answer is the value; choices is not used.
    if (!candidate.answer || typeof candidate.answer !== 'string') errors.push('numeric_answer_missing');
  }

  if (errors.length) {
    const ctx = contextForLog || {};
    console.warn(
      `[lake.savePoolItem REJECTED] reason=${errors.join('+')} ` +
      `contentId=${ctx.contentId || 'pending'} ` +
      `state=${ctx.state || '?'} ` +
      `subject=${ctx.subject || '?'} ` +
      `grade=${ctx.grade || '?'} ` +
      `type=${t}`
    );
  }
  return errors;
}

async function savePoolItem({
  poolKey, candidate, stateSlug, gradeSlug, subject, questionType,
  generatedByUserId = null, apiKey = null, existingPool = null
}) {
  // Validate (existing content-quality validator — checks prompt, answer,
  // explanation, profanity, reading word count, etc).
  const valid = validateQuestion({ ...candidate, subject, grade: gradeSlug });
  if (!valid.valid) {
    return { saved: false, reason: 'invalid:' + valid.errors.join(';') };
  }

  // Schema gate (Layer 2 of the May 3 writer-bug fix). The existing
  // validateQuestion does NOT check correctIndex; this does.
  const schemaForGate = { ...candidate, state: stateSlug, subject, grade: gradeSlug };
  const schemaErrors = _enforceSaveSchema(schemaForGate, {
    contentId: 'pending',
    state: stateSlug, subject, grade: gradeSlug
  });
  if (schemaErrors.length) {
    return { saved: false, reason: 'schema:' + schemaErrors.join(';') };
  }

  // Embed (best-effort: if no apiKey, save without embedding)
  let embedding = null;
  if (apiKey) {
    try {
      const embedText = candidate.subject === 'reading' && candidate.passage
        ? `${candidate.passage.text}\n\nQ: ${candidate.prompt || candidate.question}`
        : (candidate.prompt || candidate.question);
      embedding = await computeEmbedding(embedText, apiKey);
    } catch (e) {
      console.warn('[lake] embed failed, saving without:', e.message);
    }
  }

  // Dedup against pool slice (caller may pass pre-fetched, else query)
  if (embedding) {
    const slice = existingPool || await readPoolForBucket({ poolKey, limit: 100 });
    for (const existing of slice) {
      if (existing.embedding && areEmbeddingsTooSimilar(embedding, existing.embedding)) {
        return { saved: false, reason: 'duplicate:' + existing.contentId };
      }
    }
  }

  const contentId = generateId('q');
  const item = {
    poolKey,
    contentId,
    state: stateSlug,
    grade: gradeSlug,
    subject,
    questionType: questionType || 'unknown',
    type: candidate.type || 'multiple_choice',
    passage: candidate.passage || null,
    question: candidate.prompt || candidate.question,
    prompt: candidate.prompt || candidate.question,
    choices: candidate.choices || null,
    answer: String(candidate.answer || ''),
    correctIndex: typeof candidate.correctIndex === 'number' ? candidate.correctIndex : null,
    explanation: candidate.explanation || '',
    teks: candidate.teks || null,
    unitTitle: candidate.unitTitle || null,
    lessonTitle: candidate.lessonTitle || null,
    embedding,
    generatedBy: candidate._generatedBy || 'gpt-4o-mini',
    generatedAt: Date.now(),
    generatedByUserId,
    generatorPromptVersion: candidate._promptVersion || 'v1',
    timesServed: 1,
    timesCorrect: 0,
    timesIncorrect: 0,
    qualityScore: 0.5,
    reportedCount: 0,
    reviewStatus: 'auto-approved',
    status: 'active',
    language: 'en-US',
    hasMedia: false,
    mediaRefs: []
  };

  await ddb.send(new PutCommand({
    TableName: POOL_TABLE,
    Item: item
  }));

  return { saved: true, contentId, item };
}

// ============================================================
// READ + GENERATE — single question (used by lake-driven flows in I2)
// ============================================================

async function getOrGenerateQuestion({ poolKey, userId, recentContentIds = [], generator, apiKey }) {
  const pool = await readPoolForBucket({ poolKey, recentContentIds });

  if (pool.length >= POOL_MIN_THRESHOLD) {
    const topN = Math.max(1, Math.floor(pool.length * QUALITY_FETCH_TOP_PERCENT));
    const candidates = pool.slice(0, topN);
    const picked = candidates[Math.floor(Math.random() * candidates.length)];

    ddb.send(new UpdateCommand({
      TableName: POOL_TABLE,
      Key: { poolKey: picked.poolKey, contentId: picked.contentId },
      UpdateExpression: 'ADD timesServed :one',
      ExpressionAttributeValues: { ':one': 1 }
    })).catch(err => console.warn('[lake] timesServed update failed:', err.message));

    return { content: picked, fromCache: true, contentId: picked.contentId };
  }

  // Pool too small — generate
  const [stateSlug, gradeSlug, subject, questionType] = poolKey.split('#');
  let attempts = 0;
  const MAX_ATTEMPTS = 3;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const candidate = await generator({ stateSlug, gradeSlug, subject, questionType });
    const result = await savePoolItem({
      poolKey, candidate, stateSlug, gradeSlug, subject, questionType,
      generatedByUserId: userId, apiKey, existingPool: pool
    });
    if (result.saved) {
      return { content: result.item, fromCache: false, contentId: result.contentId };
    }
    console.warn(`[lake] gen attempt ${attempts} not saved: ${result.reason}`);
  }

  // Last-resort fallback to any pool item
  if (pool.length > 0) {
    const fallback = pool[Math.floor(Math.random() * pool.length)];
    console.warn('[lake] using fallback after exhausted retries');
    return { content: fallback, fromCache: true, contentId: fallback.contentId };
  }

  throw new Error(`Could not produce question for ${poolKey} after ${MAX_ATTEMPTS} attempts`);
}

// ============================================================
// EXPLANATIONS
// ============================================================

async function getOrGenerateExplanation({
  contentId, wrongChoiceIndex, detailLevel = 'detailed', generator
}) {
  const variantKey = `${wrongChoiceIndex}#${detailLevel}`;

  const get = await ddb.send(new GetCommand({
    TableName: EXPLANATIONS_TABLE,
    Key: { contentId, variantKey }
  }));

  if (get.Item) {
    ddb.send(new UpdateCommand({
      TableName: EXPLANATIONS_TABLE,
      Key: { contentId, variantKey },
      UpdateExpression: 'ADD timesServed :one',
      ExpressionAttributeValues: { ':one': 1 }
    })).catch(() => {});
    return { content: get.Item, fromCache: true };
  }

  const candidate = await generator();
  const valid = validateExplanation(candidate);
  if (!valid.valid) {
    throw new Error(`Generated explanation invalid: ${valid.errors.join(', ')}`);
  }

  const item = {
    contentId,
    variantKey,
    wrongChoiceIndex,
    detailLevel,
    explanation: candidate.explanation,
    generatedBy: candidate._generatedBy || 'gpt-4o-mini',
    generatedAt: Date.now(),
    timesServed: 1,
    timesHelpful: 0,
    timesNotHelpful: 0,
    qualityScore: 0.5,
    language: 'en-US',
    status: 'active'
  };

  await ddb.send(new PutCommand({ TableName: EXPLANATIONS_TABLE, Item: item }));
  return { content: item, fromCache: false };
}

// ============================================================
// TUTOR RESPONSES (open-ended)
// ============================================================

async function getOrGenerateTutorResponse({
  scopeKey, requestText, requestType, generator, apiKey
}) {
  let requestEmbedding = null;
  if (apiKey) {
    try { requestEmbedding = await computeEmbedding(requestText, apiKey); }
    catch (e) { console.warn('[lake] tutor embed failed:', e.message); }
  }

  const result = await ddb.send(new QueryCommand({
    TableName: TUTOR_TABLE,
    IndexName: 'scopeKey-quality-index',
    KeyConditionExpression: 'scopeKey = :sk',
    ExpressionAttributeValues: { ':sk': scopeKey },
    ScanIndexForward: false,
    Limit: 50
  }));

  if (requestEmbedding) {
    let bestMatch = null;
    let bestSim = 0;
    for (const existing of (result.Items || [])) {
      if (!existing.requestEmbedding) continue;
      const sim = cosineSimilarity(requestEmbedding, existing.requestEmbedding);
      if (sim > bestSim) { bestSim = sim; bestMatch = existing; }
    }
    if (bestMatch && bestSim >= 0.88) {
      ddb.send(new UpdateCommand({
        TableName: TUTOR_TABLE,
        Key: { scopeKey: bestMatch.scopeKey, responseId: bestMatch.responseId },
        UpdateExpression: 'ADD timesServed :one',
        ExpressionAttributeValues: { ':one': 1 }
      })).catch(() => {});
      return { content: bestMatch, fromCache: true };
    }
  }

  const candidate = await generator();
  const responseId = generateId('t');
  const item = {
    scopeKey,
    responseId,
    triggerType: requestType,
    triggerContext: requestText,
    requestEmbedding,
    responseText: candidate.responseText,
    responseEmbedding: apiKey ? await computeEmbedding(candidate.responseText, apiKey).catch(() => null) : null,
    generatedBy: candidate._generatedBy || 'gpt-4o-mini',
    generatedAt: Date.now(),
    timesServed: 1,
    timesHelpful: 0,
    qualityScore: 0.5,
    language: 'en-US',
    status: 'active'
  };

  await ddb.send(new PutCommand({ TableName: TUTOR_TABLE, Item: item }));
  return { content: item, fromCache: false };
}

// ============================================================
// EVENTS
// ============================================================

/**
 * Event types: served, answered-correct, answered-incorrect,
 * requested-explanation, requested-hint, requested-similar,
 * marked-helpful, marked-not-helpful, reported-bad,
 * hesitation, rapid-flip, rage-quit, stuck, rebound
 */
async function recordEvent({
  eventType, contentId, userId, sessionId,
  state, grade, subject, poolKey,
  pickedChoice, timeToAnswer, meta
}) {
  const timestamp = Date.now();
  const eventDate = new Date(timestamp).toISOString().slice(0, 10);
  const eventDateKey = `${eventDate}#${poolKey || 'unknown'}`;
  const eventTimeUserId = `${timestamp}#${userId || 'anon'}`;
  const expiresAt = Math.floor(timestamp / 1000) + (EVENT_TTL_DAYS * 86400);

  const item = {
    eventDateKey,
    eventTimeUserId,
    eventId: generateId('e'),
    eventType,
    contentId: contentId || null,
    userId: userId || 'anon',
    sessionId: sessionId || null,
    state: state || null,
    grade: grade || null,
    subject: subject || null,
    poolKey: poolKey || null,
    pickedChoice: typeof pickedChoice === 'number' ? pickedChoice : null,
    timeToAnswer: typeof timeToAnswer === 'number' ? timeToAnswer : null,
    meta: meta || {},
    timestamp,
    expiresAt
  };

  return ddb.send(new PutCommand({
    TableName: EVENTS_TABLE,
    Item: item
  })).catch(err => {
    console.warn('[lake] recordEvent failed:', err.message);
  });
}

module.exports = {
  getOrGenerateQuestion,
  savePoolItem,
  readPoolForBucket,
  getOrGenerateExplanation,
  getOrGenerateTutorResponse,
  recordEvent,
  computeEmbedding,
  cosineSimilarity,
  areEmbeddingsTooSimilar,
  validateQuestion,
  validateExplanation,
  _enforceSaveSchema,
  generateId,
  POOL_TABLE,
  EXPLANATIONS_TABLE,
  EVENTS_TABLE,
  TUTOR_TABLE,
  POOL_MIN_THRESHOLD,
  POOL_TARGET_SIZE,
  RECENT_CONTENT_BUFFER,
  DEDUP_SIMILARITY_THRESHOLD
};
