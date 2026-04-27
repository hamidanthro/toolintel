/**
 * Cold-start lake client (I2).
 *
 * Runs locally, writes directly to DynamoDB using ~/.aws credentials.
 * Mirrors the dedup + validation semantics of lambda/content-lake.js
 * but adapted for CLI use.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand
} = require('@aws-sdk/lib-dynamodb');
const OpenAI = require('openai').default || require('openai').OpenAI || require('openai');
const crypto = require('crypto');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const POOL_TABLE = 'staar-content-pool';
const DEDUP_THRESHOLD = 0.92;

function generateId(prefix = 'q') {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rand = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${ts}_${rand}`;
}

async function computeEmbedding(text) {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: String(text || '').slice(0, 8000),
    encoding_format: 'float'
  });
  return response.data[0].embedding;
}

function cosineSim(a, b) {
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

async function loadExistingPool(poolKey) {
  const result = await ddb.send(new QueryCommand({
    TableName: POOL_TABLE,
    KeyConditionExpression: 'poolKey = :pk',
    ExpressionAttributeValues: { ':pk': poolKey },
    Limit: 200
  }));
  return result.Items || [];
}

async function saveQuestion(item) {
  await ddb.send(new PutCommand({
    TableName: POOL_TABLE,
    Item: item,
    ConditionExpression: 'attribute_not_exists(contentId)'
  }));
}

function validateQuestion(item, subject, grade) {
  const errors = [];
  if (!item.question || typeof item.question !== 'string') errors.push('question missing');
  if (!Array.isArray(item.choices) || item.choices.length !== 4) errors.push('choices not 4');
  if (typeof item.correctIndex !== 'number' || item.correctIndex < 0 || item.correctIndex > 3) {
    errors.push('correctIndex invalid');
  }
  if (!item.explanation || item.explanation.length < 10) errors.push('explanation too short');

  if (subject === 'reading' && item.passage?.text) {
    const wc = item.passage.text.split(/\s+/).filter(Boolean).length;
    const lower = ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5'].includes(grade);
    const min = lower ? 60 : 120;
    const max = lower ? 220 : 360;
    if (wc < min || wc > max) errors.push(`passage word count ${wc} outside ${min}-${max}`);
  }

  // Letter-prefix smell: a choice rendered as just 'A' or 'A.' or 'A:' or '(A)'
  // means the model put labels in choices. UI re-labels A/B/C/D so this would
  // double-label.
  if (Array.isArray(item.choices)) {
    for (let i = 0; i < item.choices.length; i++) {
      const c = String(item.choices[i] || '').trim();
      if (/^[A-D][\.\):]?$/.test(c) || /^\([A-D]\)$/.test(c)) {
        errors.push(`choice ${i} is just a letter label`);
        break;
      }
      if (/^[A-D][\.\):]\s+/.test(c) || /^\([A-D]\)\s+/.test(c)) {
        errors.push(`choice ${i} starts with letter label`);
        break;
      }
    }
  }

  // LaTeX rendering markers — UI doesn't render LaTeX. Reject so the
  // generator retries in plain text.
  const allText = [item.question, ...(item.choices || []), item.explanation, item.passage?.text]
    .filter(Boolean).join(' ');
  if (/\\\(|\\\)|\\\[|\\\]|\$\$|\\frac\b|\\sqrt\b|\\times\b|\\div\b/.test(allText)) {
    errors.push('contains LaTeX syntax');
  }

  // Profanity / mean-spirited language — kids' product.
  const naughty = [
    'damn','hell','crap','stupid','idiot','dumb','sucks','shut up',
    'kill','die','dead','death','suicide','murder','blood','gun','shoot',
    'drug','drugs','alcohol','beer','wine','smoke','smoking','cigarette',
    'sex','sexy','hot','dating','boyfriend','girlfriend','kiss',
    'fight','punch','hate','racist'
  ];
  const lowerText = allText.toLowerCase();
  for (const w of naughty) {
    if (new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`).test(lowerText)) {
      errors.push(`disallowed for kids: ${w}`);
      break;
    }
  }

  // Grade-level numeric appropriateness.
  if (subject === 'math') {
    const earlyGrades = ['grade-k','grade-1','grade-2'];
    const lowerGrades = ['grade-3','grade-4','grade-5'];
    if (earlyGrades.includes(grade)) {
      // Reject any number > 100 in the question (early grades stay within 0-100).
      const nums = (item.question.match(/\b\d+(\.\d+)?\b/g) || []).map(Number);
      if (nums.some(n => n > 100)) {
        errors.push('early-grade question contains numbers > 100');
      }
      // No negatives below grade 6.
      if (/-\d/.test(item.question) || /\bnegative\b/i.test(item.question)) {
        errors.push('early-grade question contains negative numbers');
      }
    }
    if (lowerGrades.includes(grade)) {
      if (/-\d/.test(item.question) || /\bnegative\b/i.test(item.question)) {
        errors.push('lower-grade question contains negative numbers');
      }
    }
  }
  return errors;
}

module.exports = {
  getOpenAI, ddb, POOL_TABLE,
  generateId, computeEmbedding, cosineSim,
  loadExistingPool, saveQuestion, validateQuestion,
  DEDUP_THRESHOLD
};
