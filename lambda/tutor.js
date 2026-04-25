// STAAR Prep — AI Tutor Lambda (OpenAI)
// Provides interactive, age-appropriate math help when a student answers incorrectly.
//
// Endpoint:
//   POST /tutor
//   Body: {
//     grade, question, correctAnswer, studentAnswer, explanation,
//     teks, topic, history: [{role, content}]
//   }
// Response: { reply: string, model: string }
//
// Environment variables:
//   OPENAI_MODEL        (default: gpt-4o-mini)
//   OPENAI_SECRET_NAME  (default: staar-tutor/openai-api-key)
//   ALLOWED_ORIGIN      (default: *)

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand, PutCommand, UpdateCommand, QueryCommand
} = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SECRET_NAME = process.env.OPENAI_SECRET_NAME || 'staar-tutor/openai-api-key';
const AUTH_SECRET_NAME = process.env.AUTH_SECRET_NAME || 'staar-tutor/auth-secret';
const USERS_TABLE = process.env.USERS_TABLE || 'staar-users';
const STATS_TABLE = process.env.STATS_TABLE || 'staar-stats';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const sm = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
let cachedKey = null;
let cachedAuthSecret = null;

async function getAuthSecret() {
  if (cachedAuthSecret) return cachedAuthSecret;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: AUTH_SECRET_NAME }));
  cachedAuthSecret = (res.SecretString || '').trim();
  return cachedAuthSecret;
}

async function getApiKey() {
  if (cachedKey) return cachedKey;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  cachedKey = (res.SecretString || '').trim();
  return cachedKey;
}

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function ok(body) {
  return { statusCode: 200, headers: cors, body: JSON.stringify(body) };
}
function bad(status, message) {
  return { statusCode: status, headers: cors, body: JSON.stringify({ error: message }) };
}

function clip(s, n = 1500) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) : s;
}

function buildSystemPrompt(grade) {
  const gradeNum = typeof grade === 'number' ? grade : parseInt(grade, 10);
  const gradeLabel = Number.isFinite(gradeNum) ? `Grade ${gradeNum}` : String(grade || 'elementary');

  // Reading level guidance per grade band (Texas TEKS / Lexile rough mapping)
  let reading;
  if (!Number.isFinite(gradeNum) || gradeNum <= 3) {
    reading = `The student is around 8 years old. Use very simple words (1–2 syllables when possible). Keep sentences under 12 words. Use everyday objects (cookies, marbles, blocks, pizza slices). Use 1 friendly emoji at most per reply, only if it helps (🍕 🧮 ⭐).`;
  } else if (gradeNum <= 5) {
    reading = `The student is 9–11 years old. Use clear, simple words. Keep sentences under 16 words. Use real-world examples a kid would know. Avoid emojis unless celebrating a correct step.`;
  } else {
    reading = `The student is a middle-schooler. Use clear language and proper math vocabulary, but define new terms in plain words. No emojis.`;
  }

  return `You are a friendly, patient math tutor for a ${gradeLabel} student preparing for the Texas STAAR math test.

READING LEVEL
${reading}

HOW TO TEACH
- Do NOT just reveal the answer. Guide the student with small hints and one question at a time.
- Break the problem into 2–4 short steps. Number them: 1. 2. 3.
- Use concrete pictures in words: equal groups, number lines, place-value blocks, pizza slices, etc.
- After explaining, end with ONE short check-in question (e.g., "Which step would you try first?").
- Be warm. Praise effort. Never call an answer "wrong" — say "not quite" or "let's try again".
- Stay on the math problem. Politely redirect off-topic questions.

FORMATTING (VERY IMPORTANT)
- Plain text only. NO markdown stars (**), NO hashtags (#), NO underscores for emphasis.
- Use a blank line between paragraphs.
- For steps, start each line with "1.", "2.", "3." on its own line.
- For lists of options, start each line with "- " on its own line.
- Keep the whole reply under 120 words.
- Do NOT use headings like "Step 1:" in bold — just write "Step 1." as normal text.`;
}

function buildFirstUserMessage(payload) {
  return `Here is the problem the student is working on:

PROBLEM: ${clip(payload.question)}

The student answered: ${clip(String(payload.studentAnswer))}
The correct answer is: ${clip(String(payload.correctAnswer))}

${payload.topic ? `Topic: ${clip(payload.topic, 200)}\n` : ''}${payload.teks ? `TEKS standard: ${clip(payload.teks, 50)}\n` : ''}${payload.explanation ? `Reference explanation: ${clip(payload.explanation, 600)}\n` : ''}
Help me understand where I went wrong and how to think about this problem. Walk me through it step by step.`;
}

async function callOpenAI(apiKey, body) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`OpenAI ${res.status}: ${errText.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

exports.handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method;
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (method !== 'POST') {
    return bad(405, 'Method not allowed');
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return bad(400, 'Invalid JSON');
  }

  // Route by action. Default action is "tutor" for backward compatibility.
  const action = payload.action || 'tutor';
  if (action === 'generate') {
    return await handleGenerate(payload);
  }
  if (action === 'signup')   return await handleSignup(payload);
  if (action === 'login')    return await handleLogin(payload);
  if (action === 'getStats') return await handleGetStats(payload);
  if (action === 'putStats') return await handlePutStats(payload);

  if (!payload.question || payload.studentAnswer == null || payload.correctAnswer == null) {
    return bad(400, 'Missing required fields: question, studentAnswer, correctAnswer');
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(payload.grade) },
    { role: 'user', content: buildFirstUserMessage(payload) }
  ];

  if (Array.isArray(payload.history)) {
    const hist = payload.history.slice(-10);
    let lastRole = 'user';
    for (const turn of hist) {
      if (!turn || !turn.role || !turn.content) continue;
      if (turn.role === lastRole) continue;
      messages.push({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: clip(turn.content, 800)
      });
      lastRole = turn.role;
    }
    if (messages[messages.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: 'Please continue helping me.' });
    }
  }

  try {
    const apiKey = await getApiKey();
    const result = await callOpenAI(apiKey, {
      model: MODEL,
      messages,
      max_tokens: 600,
      temperature: 0.4
    });
    const reply = result?.choices?.[0]?.message?.content || '';
    return ok({ reply, model: MODEL });
  } catch (err) {
    console.error('OpenAI error:', err.message || err);
    return bad(502, 'AI tutor unavailable');
  }
};

// ===== Question generator =====
// Input:  { action: "generate", grade, count, seed, topics: [{title, teks, objective, sample?}] }
// Output: { questions: [{ id, type, prompt, choices?, answer, explanation, unitTitle, teks, lessonTitle }] }
async function handleGenerate(payload) {
  const grade = payload.grade;
  const count = Math.max(1, Math.min(30, parseInt(payload.count, 10) || 25));
  const seed = String(payload.seed || Date.now());
  const topics = Array.isArray(payload.topics) ? payload.topics.slice(0, 20) : [];

  if (topics.length === 0) {
    return bad(400, 'Missing topics for generation');
  }

  const system = buildGeneratorSystem(grade);
  const user = buildGeneratorUser({ count, seed, topics });

  try {
    const apiKey = await getApiKey();
    const result = await callOpenAI(apiKey, {
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      // OpenAI JSON mode: forces a JSON object response.
      response_format: { type: 'json_object' },
      max_tokens: 3500,
      temperature: 0.9,
      // A small seed nudge, but JSON mode + temperature does the heavy lifting.
      top_p: 0.95
    });
    const raw = result?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const questions = sanitizeQuestions(parsed.questions, count);
    if (!questions.length) {
      return bad(502, 'No questions generated');
    }
    return ok({ questions, model: MODEL, seed });
  } catch (err) {
    console.error('Generate error:', err.message || err);
    return bad(502, 'Question generator unavailable');
  }
}

function buildGeneratorSystem(grade) {
  const gradeNum = typeof grade === 'number' ? grade : parseInt(grade, 10);
  const gradeLabel = Number.isFinite(gradeNum) ? `Grade ${gradeNum}` : String(grade || 'elementary');
  let reading;
  if (!Number.isFinite(gradeNum) || gradeNum <= 3) {
    reading = 'Vocabulary at a Grade 3 level. Sentences under 18 words. Use kid-friendly contexts: snacks, pets, recess, sports, classroom, family, money, lunch.';
  } else if (gradeNum <= 5) {
    reading = 'Vocabulary at a Grade 4-5 level. Sentences under 22 words. Real-world contexts: school events, sports, shopping, travel, science.';
  } else {
    reading = 'Middle-school vocabulary. Use proper math terms.';
  }

  return `You are an expert ${gradeLabel} math item writer for the Texas STAAR exam.
Your job is to generate fresh, ORIGINAL practice questions that match Texas TEKS standards.

READING LEVEL
${reading}

QUALITY RULES
- Each question must clearly target the requested TEKS standard.
- Vary the scenario, names, and numbers across questions \u2014 do NOT reuse the same setup.
- Use diverse student names from many cultures (Maya, Diego, Aanya, Liam, Zoe, Kenji, Amara, Noah, Priya, Mateo, etc.). Never repeat the same name twice in a set.
- Use a wide variety of contexts (sports, animals, baking, art, music, building, nature) \u2014 do not let any single context dominate.
- Numbers must be realistic for the grade. Show no negative numbers below Grade 6.
- Multiple-choice: exactly 4 plausible options, one correct. The correct answer must match an option byte-for-byte.
- Numeric answers: a single number string (no units in the answer field, units in the prompt only).
- Explanation: 1\u20132 short sentences, no markdown stars, plain text.

OUTPUT FORMAT (STRICT JSON, no prose around it)
{
  "questions": [
    {
      "id": "gen-<unique>",
      "type": "multiple_choice" | "numeric",
      "prompt": "string",
      "choices": ["A","B","C","D"],   // omit for numeric
      "answer": "string",
      "explanation": "string",
      "teks": "3.2A",
      "unitTitle": "Place Value & Whole Numbers",
      "lessonTitle": "Reading and writing numbers"
    }
  ]
}`;
}

function buildGeneratorUser({ count, seed, topics }) {
  const topicLines = topics.map((t, i) =>
    `${i + 1}. TEKS ${t.teks || '?'} \u2014 ${t.title || ''}${t.objective ? ` | objective: ${clip(t.objective, 160)}` : ''}${t.sample ? ` | sample: "${clip(t.sample, 140)}"` : ''}`
  ).join('\n');

  return `Generate exactly ${count} fresh STAAR-style practice questions.

Distribute the questions across these TEKS topics (roughly even, but you may shift one or two):
${topicLines}

Mix question types: about 70% multiple_choice, about 30% numeric.
Use seed "${seed}" to make this set DIFFERENT from any previous run \u2014 vary scenarios, names, numbers, and contexts.
Return ONLY valid JSON matching the schema. No markdown, no commentary.`;
}

function sanitizeQuestions(arr, max) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const q of arr) {
    if (!q || typeof q !== 'object') continue;
    const type = q.type === 'numeric' ? 'numeric' : 'multiple_choice';
    const prompt = clip(String(q.prompt || '').trim(), 600);
    const answer = clip(String(q.answer ?? '').trim(), 200);
    const explanation = clip(String(q.explanation || '').trim(), 500);
    if (!prompt || !answer) continue;

    const item = {
      id: clip(String(q.id || `gen-${Math.random().toString(36).slice(2, 10)}`), 60),
      type,
      prompt,
      answer,
      explanation,
      teks: clip(String(q.teks || ''), 20),
      unitTitle: clip(String(q.unitTitle || ''), 100),
      lessonTitle: clip(String(q.lessonTitle || ''), 120)
    };

    if (type === 'multiple_choice') {
      const choices = Array.isArray(q.choices) ? q.choices.map(c => clip(String(c).trim(), 100)).filter(Boolean) : [];
      if (choices.length < 2) continue;
      // Ensure the answer appears as one of the choices (case-insensitive match).
      const match = choices.find(c => c.toLowerCase() === answer.toLowerCase());
      if (!match) continue;
      item.answer = match; // normalize to exact choice text
      // Trim to 4 choices max, ensure answer present.
      const uniq = Array.from(new Set(choices)).slice(0, 4);
      if (!uniq.includes(item.answer)) uniq.push(item.answer);
      item.choices = uniq.slice(0, 4);
    }

    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

// ===== Auth (signup/login) =====

const COLORS = ['#1e40af', '#f59e0b', '#16a34a', '#db2777', '#7c3aed', '#0ea5e9', '#dc2626', '#0d9488'];

function sanitizeUsername(u) {
  return String(u || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

function hashPassword(password, salt) {
  // scrypt with conservative params (suitable for Lambda 512MB)
  const buf = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return buf.toString('hex');
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function makeToken(userId) {
  const secret = await getAuthSecret();
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!userId || !expStr || !sig) return null;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const secret = await getAuthSecret();
  const expected = crypto.createHmac('sha256', secret).update(`${userId}.${expStr}`).digest('hex');
  if (!timingSafeEqual(sig, expected)) return null;
  return { userId, exp };
}

async function authedUser(payload) {
  const auth = await verifyToken(payload.token);
  if (!auth) return null;
  return auth.userId;
}

async function handleSignup(payload) {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');
  const displayName = String(payload.displayName || '').trim().slice(0, 32) || username;

  if (username.length < 3 || username.length > 24) {
    return bad(400, 'Username must be 3-24 characters (letters, numbers, _ . -)');
  }
  if (password.length < 6 || password.length > 128) {
    return bad(400, 'Password must be at least 6 characters');
  }

  const existing = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username }
  }));
  if (existing.Item) {
    return bad(409, 'That username is already taken');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const userId = 'u_' + crypto.randomBytes(6).toString('hex');
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  try {
    await ddb.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        username,
        userId,
        displayName,
        salt,
        passwordHash,
        color,
        createdAt: Date.now()
      },
      ConditionExpression: 'attribute_not_exists(username)'
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return bad(409, 'That username is already taken');
    }
    throw err;
  }

  const token = await makeToken(userId);
  return ok({ token, user: { userId, username, displayName, color } });
}

async function handleLogin(payload) {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');
  if (!username || !password) return bad(400, 'Username and password required');

  const res = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username }
  }));
  const user = res.Item;
  // Generic error to avoid revealing which field is wrong.
  const fail = () => bad(401, 'Wrong username or password');
  if (!user) return fail();

  const candidate = hashPassword(password, user.salt);
  if (!timingSafeEqual(candidate, user.passwordHash)) return fail();

  const token = await makeToken(user.userId);
  return ok({
    token,
    user: {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName || user.username,
      color: user.color || '#1e40af'
    }
  });
}

// ===== Stats sync =====
// putStats: { token, slug, data }
// getStats: { token, slug? }   // if slug omitted, returns all grades for the user

async function handlePutStats(payload) {
  const userId = await authedUser(payload);
  if (!userId) return bad(401, 'Not signed in');
  const slug = String(payload.slug || '').trim().toLowerCase();
  if (!slug) return bad(400, 'Missing slug');
  const data = payload.data;
  if (!data || typeof data !== 'object') return bad(400, 'Missing data');

  // Cap blob size so we don't accidentally write huge items.
  const json = JSON.stringify(data);
  if (json.length > 12000) return bad(413, 'Stats too large');

  await ddb.send(new PutCommand({
    TableName: STATS_TABLE,
    Item: {
      userId,
      slug,
      data,
      updatedAt: Date.now()
    }
  }));
  return ok({ ok: true });
}

async function handleGetStats(payload) {
  const userId = await authedUser(payload);
  if (!userId) return bad(401, 'Not signed in');
  const slug = payload.slug ? String(payload.slug).trim().toLowerCase() : null;

  if (slug) {
    const r = await ddb.send(new GetCommand({
      TableName: STATS_TABLE,
      Key: { userId, slug }
    }));
    return ok({ stats: r.Item ? { [slug]: r.Item.data } : {} });
  }

  const r = await ddb.send(new QueryCommand({
    TableName: STATS_TABLE,
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId }
  }));
  const out = {};
  for (const it of (r.Items || [])) {
    if (it.slug) out[it.slug] = it.data;
  }
  return ok({ stats: out });
}
