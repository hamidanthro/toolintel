/**
 * Pool top-up Lambda (I2).
 *
 * Hourly: scan pool, find buckets below POOL_TARGET, generate
 * TOPUP_BATCH new questions per low bucket, save with embedding +
 * dedup. Hard cap MAX_GENERATIONS_PER_RUN per invocation.
 *
 * Triggered by EventBridge rule staar-pool-topup-hourly.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const crypto = require('crypto');
const { generateOne } = require('./generators');

const REGION = 'us-east-1';
const POOL_TABLE = 'staar-content-pool';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const secrets = new SecretsManagerClient({ region: REGION });

const POOL_TARGET = 50;
const TOPUP_BATCH = 5;
const MAX_GENERATIONS_PER_RUN = 50;
const DEDUP_THRESHOLD = 0.92;

let _apiKey = null;
async function getApiKey() {
  if (_apiKey) return _apiKey;
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: 'staar-tutor/openai-api-key' }));
  let s = out.SecretString;
  try {
    const j = JSON.parse(s);
    _apiKey = j.OPENAI_API_KEY || j.openai_api_key || j.apiKey || s;
  } catch (e) { _apiKey = s; }
  return _apiKey;
}

async function computeEmbedding(text, apiKey) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: String(text || '').slice(0, 8000) })
  });
  if (!res.ok) throw new Error(`embed failed ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; magA += a[i]*a[i]; magB += b[i]*b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom ? dot/denom : 0;
}

function generateId(prefix='q') {
  const ts = Date.now().toString(36).padStart(9, '0');
  return `${prefix}_${ts}_${crypto.randomBytes(6).toString('hex')}`;
}

function parsePoolKey(pk) {
  const [state, grade, subject, typeRaw] = pk.split('#');
  const type = (typeRaw || '').replace(/^teks-/, '');
  return { state, grade, subject, type };
}

function validateQuestion(item, subject) {
  if (!item.question || typeof item.question !== 'string') return false;
  if (!Array.isArray(item.choices) || item.choices.length !== 4) return false;
  if (typeof item.correctIndex !== 'number' || item.correctIndex < 0 || item.correctIndex > 3) return false;
  if (!item.explanation || item.explanation.length < 10) return false;
  return true;
}

async function aggregatePoolCounts() {
  const counts = new Map();
  let lastKey;
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: POOL_TABLE,
      ProjectionExpression: 'poolKey, #s, embedding',
      ExpressionAttributeNames: { '#s': 'status' },
      ExclusiveStartKey: lastKey
    }));
    for (const it of out.Items || []) {
      if (it.status && it.status !== 'active') continue;
      if (!counts.has(it.poolKey)) counts.set(it.poolKey, { count: 0, embeddings: [] });
      const e = counts.get(it.poolKey);
      e.count++;
      if (it.embedding) e.embeddings.push(it.embedding);
    }
    lastKey = out.LastEvaluatedKey;
  } while (lastKey);
  return counts;
}

exports.handler = async (event) => {
  const startedAt = Date.now();
  const apiKey = await getApiKey();
  process.env.OPENAI_API_KEY = apiKey; // generators.js uses this via getOpenAI

  const counts = await aggregatePoolCounts();
  const lowBuckets = [...counts.entries()]
    .filter(([_, v]) => v.count < POOL_TARGET)
    .map(([pk, v]) => ({ pk, ...parsePoolKey(pk), have: v.count, embeddings: v.embeddings }))
    .sort((a, b) => a.have - b.have);

  console.log(`Top-up scan: ${counts.size} buckets total, ${lowBuckets.length} below target ${POOL_TARGET}`);

  let generations = 0, saved = 0, dedup = 0, invalid = 0, errors = 0;

  for (const b of lowBuckets) {
    if (generations >= MAX_GENERATIONS_PER_RUN) break;
    const need = Math.min(TOPUP_BATCH, POOL_TARGET - b.have, MAX_GENERATIONS_PER_RUN - generations);
    if (need <= 0) continue;
    console.log(`  ${b.pk}  have=${b.have} need=${need}`);

    for (let i = 0; i < need && generations < MAX_GENERATIONS_PER_RUN; i++) {
      generations++;
      try {
        const item = await generateOne({
          stateSlug: b.state, grade: b.grade, subject: b.subject, questionType: b.type
        });
        if (!validateQuestion(item, b.subject)) { invalid++; continue; }

        const seedText = item.passage?.text ? `${item.passage.text} ${item.question}` : item.question;
        const embedding = await computeEmbedding(seedText, apiKey);
        const tooSimilar = b.embeddings.some(e => cosineSim(e, embedding) >= DEDUP_THRESHOLD);
        if (tooSimilar) { dedup++; continue; }

        const contentId = generateId('q');
        await ddb.send(new PutCommand({
          TableName: POOL_TABLE,
          Item: {
            poolKey: b.pk,
            contentId,
            state: b.state,
            grade: b.grade,
            subject: b.subject,
            questionType: b.type,
            question: item.question,
            choices: item.choices,
            correctIndex: item.correctIndex,
            explanation: item.explanation,
            passage: item.passage || null,
            embedding,
            qualityScore: 0.6,
            timesServed: 0,
            timesCorrect: 0,
            timesIncorrect: 0,
            reportedCount: 0,
            reviewStatus: 'unreviewed',
            status: 'active',
            generatedAt: Date.now(),
            generatedBy: 'pool-topup-v1',
            promptVersion: item._promptVersion || 'cold-v1',
            tokensUsed: item._tokensUsed || 0
          }
        }));
        b.embeddings.push(embedding);
        saved++;
      } catch (err) {
        errors++;
        console.error(`  ! ${b.pk}: ${err.message}`);
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const summary = { generations, saved, dedup, invalid, errors, elapsedMs, lowBuckets: lowBuckets.length };
  console.log('TOPUP_SUMMARY', JSON.stringify(summary));
  return summary;
};
