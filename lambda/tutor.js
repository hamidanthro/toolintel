// StarTest — AI Tutor Lambda (OpenAI)
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
  GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand, ScanCommand
} = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SECRET_NAME = process.env.OPENAI_SECRET_NAME || 'staar-tutor/openai-api-key';
const AUTH_SECRET_NAME = process.env.AUTH_SECRET_NAME || 'staar-tutor/auth-secret';
const USERS_TABLE = process.env.USERS_TABLE || 'staar-users';
const STATS_TABLE = process.env.STATS_TABLE || 'staar-stats';
const TOYS_TABLE = process.env.TOYS_TABLE || 'staar-toys';
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'staar-orders';
const FRIENDS_TABLE = process.env.FRIENDS_TABLE || 'staar-friends';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || 'staar-messages';
const S3_TOY_BUCKET = process.env.S3_TOY_BUCKET || '';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const LIFETIME_CAP_CENTS = 10000; // $100
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const sm = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({ region: S3_REGION });
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
  const gradeBand = Number.isFinite(gradeNum)
    ? (gradeNum <= 3 ? 'K-3' : gradeNum <= 8 ? '4-8' : '9-12')
    : '4-8';
  const maxSentences = gradeBand === 'K-3' ? 4 : 6;

  return `You are the StarTest AI Tutor — a warm, encouraging, Socratic K-12 tutor for math, ELA, and science.
You're talking to a real kid right now who just got a question wrong (or asked for help). You're not a textbook. You're a friend who's good at this stuff.

## Your response structure (ALWAYS follow this)

1. Warm acknowledgment (1 short sentence)
   - If wrong: "Good try, {name}!" or "No worries — this one trips lots of kids up."
   - If they asked for help: "Sure thing — let's work through it!"
   - NEVER say "Wrong" or "Incorrect". Don't shame them.

2. Mistake awareness (1 sentence, only if their answer suggests a specific error)
   - If you can spot what they did, name it gently. e.g., "Looks like you might have subtracted 4 from 9 instead of regrouping."
   - If their answer is blank or random, skip this step.

3. One small step toward the answer (1-2 sentences)
   - Pick the SMALLEST first step. Don't dump the whole solution.
   - For math: identify the operation, the place value, or what's tricky.

4. A Socratic question that invites them in (1 sentence)
   - End with a question they CAN answer in <10 seconds.
   - NOT "what's the answer". Something like "What number do you think we'd write above the 2?"

## Hard rules

- TOTAL LENGTH: max ${maxSentences} short sentences (this student is in grade band ${gradeBand}). Never a wall of text.
- LANGUAGE LEVEL: match the student's grade. K-2 = simple words, no jargon. 3-5 = light math vocabulary. 6+ = full standard vocabulary.
- NEVER give the answer in the first response. Even if they beg, walk them through step by step.
- NEVER use exclamation points more than once per response. Premium ≠ peppy.
- NEVER use emojis unless the student uses one first.
- ADAPT to weak areas: if the topic is in the student's weak areas, slow down and add one more scaffolding step.
- USE STANDARD-ALIGNED VOCABULARY (e.g., for TEKS use "regrouping", not "borrowing").

## Visual rendering hooks (the UI renders these specially)

When walking through math, use these tokens:

- For vertical math, use a fenced code block with monospace alignment:
\`\`\`
  4 2 4
- 2 6 9
\`\`\`

- Use **bold** sparingly to draw the eye to a key term ONCE per response.

## Follow-up handling

If the student asks a follow-up:
- "I still don't get it" → try a completely different angle. Don't repeat. Use an analogy or a smaller example ("Let's try 14 - 9 first, then come back to 424 - 269").
- "Show me" or "Just tell me" → walk through the full solution step-by-step, then END with: "Now you try {a similar problem}."
- "Why?" → explain the underlying concept, not just the procedure.

## What you are NOT

- Not a chatbot. You're a tutor.
- Not a customer-service rep. Don't say "I'd be happy to help with that!"
- Not a textbook. Don't lecture.
- Not a parent. Don't moralize about effort.
- Not pretending to be human. If asked, you're an AI tutor built into StarTest.`;
}

function buildFirstUserMessage(payload) {
  const ctx = [];
  if (payload.studentName) ctx.push(`Name: ${clip(payload.studentName, 40)}`);
  if (payload.studentGrade != null) ctx.push(`Grade: ${clip(String(payload.studentGrade), 20)}`);
  if (payload.studentState) ctx.push(`State: ${clip(payload.studentState, 4)}`);
  if (payload.testName) ctx.push(`Test: ${clip(payload.testName, 20)}`);
  if (payload.teks || payload.standard) ctx.push(`Standard: ${clip(payload.teks || payload.standard, 50)}`);
  if (payload.topic) ctx.push(`Topic: ${clip(payload.topic, 200)}`);
  if (payload.accuracyToDate != null) ctx.push(`Accuracy on this topic so far: ${clip(String(payload.accuracyToDate), 20)}`);
  if (Array.isArray(payload.weakAreas) && payload.weakAreas.length) {
    ctx.push(`Weak areas: ${payload.weakAreas.slice(0, 5).map(s => clip(String(s), 60)).join(', ')}`);
  }

  return `STUDENT CONTEXT
${ctx.join('\n')}

THIS QUESTION
Question: ${clip(payload.question)}
Correct answer: ${clip(String(payload.correctAnswer))}
Student answered: ${clip(String(payload.studentAnswer || '(blank)'))}
${payload.explanation ? `Reference explanation: ${clip(payload.explanation, 600)}\n` : ''}
The student needs help. Respond using the structure in your system prompt: warm acknowledgment, mistake awareness (if their answer reveals one), one small step, then end with a Socratic question they can answer.`;
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
  if (action === 'earn')           return await handleEarn(payload);
  if (action === 'lose')           return await handleLose(payload);
  if (action === 'heartbeat')      return await handleHeartbeat(payload);
  if (action === 'markMastered')   return await handleMarkMastered(payload);
  if (action === 'leaderboard')    return await handleLeaderboard(payload);
  if (action === 'liveCount')      return await handleLiveCount(payload);
  if (action === 'dashboard')      return await handleDashboard(payload);
  if (action === 'setGrade')       return await handleSetGrade(payload);
  if (action === 'getWallet')      return await handleGetWallet(payload);
  if (action === 'listToys')       return await handleListToys(payload);
  if (action === 'checkout')       return await handleCheckout(payload);
  if (action === 'listMyOrders')   return await handleListMyOrders(payload);
  if (action === 'adminListToys')      return await handleAdminListToys(payload);
  if (action === 'adminUpsertToy')     return await handleAdminUpsertToy(payload);
  if (action === 'adminDeleteToy')     return await handleAdminDeleteToy(payload);
  if (action === 'adminPresignUpload') return await handleAdminPresignUpload(payload);
  if (action === 'adminListOrders')    return await handleAdminListOrders(payload);
  if (action === 'adminUpdateOrder')   return await handleAdminUpdateOrder(payload);
  if (action === 'adminLiveUsers')     return await handleAdminLiveUsers(payload);

  // ===== Friends + safe chat (canned phrases only) =====
  if (action === 'friendRequest')  return await handleFriendRequest(payload);
  if (action === 'friendRespond')  return await handleFriendRespond(payload);
  if (action === 'friendList')     return await handleFriendList(payload);
  if (action === 'friendUnfriend') return await handleFriendUnfriend(payload);
  if (action === 'chatSend')       return await handleChatSend(payload);
  if (action === 'chatHistory')    return await handleChatHistory(payload);
  if (action === 'chatInbox')      return await handleChatInbox(payload);

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
      // De-dupe, then make sure the answer is kept when capping at 4.
      const uniq = Array.from(new Set(choices));
      const withAnswer = uniq.includes(item.answer) ? uniq : [item.answer, ...uniq];
      // Always include the answer; keep up to 3 distractors.
      const distractors = withAnswer.filter(c => c !== item.answer).slice(0, 3);
      item.choices = [item.answer, ...distractors];
      // Light shuffle so the answer isn't always first.
      for (let i = item.choices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [item.choices[i], item.choices[j]] = [item.choices[j], item.choices[i]];
      }
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

const VALID_GRADES = new Set(['grade-k', 'grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5', 'grade-6', 'grade-7', 'grade-8', 'algebra-1']);
function sanitizeGrade(g) {
  const s = String(g || '').trim().toLowerCase();
  return VALID_GRADES.has(s) ? s : null;
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

async function makeToken(userId, username) {
  const secret = await getAuthSecret();
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const subject = username ? `${userId}:${username}` : userId;
  const payload = `${subject}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [subject, expStr, sig] = parts;
  if (!subject || !expStr || !sig) return null;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const secret = await getAuthSecret();
  const expected = crypto.createHmac('sha256', secret).update(`${subject}.${expStr}`).digest('hex');
  if (!timingSafeEqual(sig, expected)) return null;
  const [userId, username] = subject.includes(':') ? subject.split(':') : [subject, null];
  return { userId, username: username || null, exp };
}

async function authedUser(payload) {
  const auth = await verifyToken(payload.token);
  if (!auth) return null;
  // Fire-and-forget: stamp lastSeenAt so the live-count endpoint can see who's active.
  if (auth.username) {
    ddb.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { username: auth.username },
      UpdateExpression: 'SET lastSeenAt = :ts',
      ExpressionAttributeValues: { ':ts': Date.now() }
    })).catch(() => {});
  }
  return auth; // { userId, username }
}

function isAdmin(username) {
  if (!username) return false;
  return ADMIN_USERNAMES.includes(String(username).toLowerCase());
}

async function requireAdmin(payload) {
  const auth = await authedUser(payload);
  if (!auth) return { error: bad(401, 'Not signed in') };
  if (!isAdmin(auth.username)) return { error: bad(403, 'Admin only') };
  return { auth };
}

async function handleSignup(payload) {
  const username = sanitizeUsername(payload.username);
  const password = String(payload.password || '');
  const displayName = String(payload.displayName || '').trim().slice(0, 32) || username;
  const email = String(payload.email || '').trim().toLowerCase().slice(0, 120);
  const grade = sanitizeGrade(payload.grade);

  if (username.length < 3 || username.length > 24) {
    return bad(400, 'Username must be 3-24 characters (letters, numbers, _ . -)');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return bad(400, 'Please enter a valid email address');
  }
  if (password.length < 6 || password.length > 128) {
    return bad(400, 'Password must be at least 6 characters');
  }
  if (!grade) {
    return bad(400, 'Please pick your current grade');
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
        email,
        grade,
        salt,
        passwordHash,
        color,
        balanceCents: 0,
        lifetimeCents: 0,
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

  const token = await makeToken(userId, username);
  return ok({ token, user: { userId, username, displayName, grade, color, balanceCents: 0, lifetimeCents: 0, isAdmin: isAdmin(username) } });
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

  const token = await makeToken(user.userId, user.username);
  return ok({
    token,
    user: {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName || user.username,
      grade: user.grade || null,
      color: user.color || '#1e40af',
      balanceCents: user.balanceCents || 0,
      lifetimeCents: user.lifetimeCents || 0,
      isAdmin: isAdmin(user.username)
    }
  });
}

// ===== Stats sync =====
// putStats: { token, slug, data }
// getStats: { token, slug? }   // if slug omitted, returns all grades for the user

async function handlePutStats(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  const userId = auth.userId;
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

  // Denormalize per-slug totals on the user record so the dashboard can
  // show "out of N answered" without scanning the stats table. We store
  // these as MAX(existing, incoming) so a kid practicing on a fresh
  // device with empty localStorage can't roll the cloud totals backwards.
  const correct = Math.max(0, parseInt(data.correct, 10) || 0);
  const total = Math.max(0, parseInt(data.total, 10) || 0);
  if (auth.username) {
    try {
      // First read existing values; only write if the incoming numbers
      // are greater than what we already have.
      const cur = await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { username: auth.username },
        ProjectionExpression: 'slugCorrect, slugTotal'
      }));
      const curC = parseInt(cur.Item?.slugCorrect?.[slug], 10) || 0;
      const curT = parseInt(cur.Item?.slugTotal?.[slug], 10) || 0;
      const newC = Math.max(curC, correct);
      const newT = Math.max(curT, total);
      if (newC !== curC || newT !== curT) {
        await ddb.send(new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { username: auth.username },
          UpdateExpression: 'SET slugCorrect = if_not_exists(slugCorrect, :empty), slugCorrect.#s = :c, slugTotal = if_not_exists(slugTotal, :empty), slugTotal.#s = :t',
          ExpressionAttributeNames: { '#s': slug },
          ExpressionAttributeValues: { ':empty': {}, ':c': newC, ':t': newT }
        }));
      }
    } catch (_) { /* non-fatal */ }
  }

  return ok({ ok: true });
}

async function handleGetStats(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  const userId = auth.userId;
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

// ===== Wallet (earn / get) =====

async function handleGetWallet(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  const r = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username }
  }));
  if (!r.Item) return bad(404, 'User not found');
  return ok({
    balanceCents: r.Item.balanceCents || 0,
    lifetimeCents: r.Item.lifetimeCents || 0,
    capCents: LIFETIME_CAP_CENTS,
    masteredSections: r.Item.masteredSections || {}
  });
}

function normalizeSectionKey(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t || t.length > 200) return null;
  return /^[A-Za-z0-9_\-|:.]+$/.test(t) ? t : null;
}

// Numeric rank for a grade slug. K=0, 1..8=grade-N, algebra-1=9. -1 for unknown.
// Used by handleEarn to enforce the no-farming-below-your-grade rule.
function _gradeRank(slug) {
  if (!slug) return -1;
  if (slug === 'grade-k') return 0;
  if (slug === 'algebra-1') return 9;
  const m = String(slug).match(/^grade-(\d+)$/);
  return m ? parseInt(m[1], 10) : -1;
}

async function handleEarn(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  if (!auth.username) return bad(401, 'Please sign in again');

  let cents = parseInt(payload.cents, 10);
  if (!Number.isFinite(cents) || cents < 1) cents = 1;
  if (cents > 5) cents = 5;

  const sectionKey = normalizeSectionKey(payload.section);

  // Read current lifetime to compute the actual award (cap-aware).
  const r = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username }
  }));
  if (!r.Item) return bad(404, 'User not found');
  const lifetime = r.Item.lifetimeCents || 0;
  const balance = r.Item.balanceCents || 0;
  const mastered = r.Item.masteredSections || {};

  // ----- Grade-gating server-side enforcement (Prompt 21) -----
  // The section key encodes "<grade-slug>|<unit>|<lesson>". If a user with a set
  // grade attempts to earn points on a grade below their level, reject the award.
  // This blocks URL-tampering kids from grinding easy questions to farm toys.
  // (Logged-out / no-grade users aren't gated server-side here — they hit the
  // 100-question guest cap anyway.)
  try {
    const userGradeSlug = String(r.Item.grade || '').trim();
    const sectionGradeSlug = sectionKey ? String(sectionKey).split('|')[0] : '';
    if (userGradeSlug && sectionGradeSlug && _gradeRank(sectionGradeSlug) < _gradeRank(userGradeSlug)) {
      return bad(403, 'Cannot earn points for grades below your current level');
    }
  } catch (_) { /* never break earn on a parsing edge case */ }

  if (sectionKey && mastered[sectionKey]) {
    return ok({
      awardedCents: 0,
      balanceCents: balance,
      lifetimeCents: lifetime,
      capCents: LIFETIME_CAP_CENTS,
      locked: true,
      masteredSections: mastered
    });
  }

  const room = Math.max(0, LIFETIME_CAP_CENTS - lifetime);
  const award = Math.min(cents, room);

  if (award <= 0) {
    return ok({
      awardedCents: 0,
      balanceCents: balance,
      lifetimeCents: lifetime,
      capCents: LIFETIME_CAP_CENTS,
      capped: true
    });
  }

  const upd = await ddb.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username },
    UpdateExpression: 'SET balanceCents = if_not_exists(balanceCents, :z) + :a, lifetimeCents = if_not_exists(lifetimeCents, :z) + :a, lifetimeCorrect = if_not_exists(lifetimeCorrect, :z) + :one, lifetimeAnswered = if_not_exists(lifetimeAnswered, :z) + :one',
    ExpressionAttributeValues: { ':a': award, ':z': 0, ':one': 1 },
    ReturnValues: 'ALL_NEW'
  }));
  return ok({
    awardedCents: award,
    balanceCents: upd.Attributes.balanceCents || 0,
    lifetimeCents: upd.Attributes.lifetimeCents || 0,
    capCents: LIFETIME_CAP_CENTS,
    capped: (upd.Attributes.lifetimeCents || 0) >= LIFETIME_CAP_CENTS
  });
}

// ===== Toys (public list) =====

function publicToy(t) {
  return {
    toyId: t.toyId,
    name: t.name,
    description: t.description || '',
    priceCents: t.priceCents,
    imageUrl: t.imageUrl || '',
    stock: typeof t.stock === 'number' ? t.stock : null
  };
}

async function handleListToys() {
  const r = await ddb.send(new ScanCommand({
    TableName: TOYS_TABLE,
    FilterExpression: 'attribute_not_exists(active) OR active = :t',
    ExpressionAttributeValues: { ':t': true }
  }));
  const toys = (r.Items || [])
    .filter(t => (t.stock == null || t.stock > 0))
    .map(publicToy)
    .sort((a, b) => a.priceCents - b.priceCents);
  return ok({ toys });
}

// ===== Checkout =====

function validString(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}
function validEmail(v) {
  const s = validString(v, 120);
  if (!s) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

async function handleCheckout(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');

  const toyId = validString(payload.toyId, 80);
  if (!toyId) return bad(400, 'Missing toy');

  const parent = payload.parent || {};
  if (parent.consent !== true) return bad(400, 'Parent consent is required');
  const parentName  = validString(parent.name, 80);
  const parentEmail = validEmail(parent.email);
  const parentPhone = validString(parent.phone, 30);
  if (!parentName || !parentEmail || !parentPhone) {
    return bad(400, 'Parent name, email, and phone are required');
  }

  const a = payload.address || {};
  const addr = {
    line1:   validString(a.line1, 120),
    line2:   validString(a.line2, 120) || '',
    city:    validString(a.city, 80),
    state:   validString(a.state, 40),
    zip:     validString(a.zip, 20),
    country: validString(a.country, 60) || 'USA'
  };
  if (!addr.line1 || !addr.city || !addr.state || !addr.zip) {
    return bad(400, 'Shipping address is incomplete');
  }

  // Look up toy + user.
  const [toyRes, userRes] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TOYS_TABLE, Key: { toyId } })),
    ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { username: auth.username } }))
  ]);
  const toy = toyRes.Item;
  const user = userRes.Item;
  if (!toy || toy.active === false) return bad(404, 'Toy not available');
  if (typeof toy.stock === 'number' && toy.stock <= 0) return bad(409, 'That toy is out of stock');
  if (!user) return bad(404, 'User not found');

  const balance = user.balanceCents || 0;
  if (balance < toy.priceCents) return bad(402, 'Not enough cents yet — keep practicing!');

  // Decrement balance with condition.
  try {
    await ddb.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { username: auth.username },
      UpdateExpression: 'SET balanceCents = balanceCents - :p',
      ConditionExpression: 'balanceCents >= :p',
      ExpressionAttributeValues: { ':p': toy.priceCents }
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return bad(402, 'Not enough cents to buy this toy');
    }
    throw err;
  }

  // Decrement stock if tracked.
  if (typeof toy.stock === 'number') {
    try {
      await ddb.send(new UpdateCommand({
        TableName: TOYS_TABLE,
        Key: { toyId },
        UpdateExpression: 'SET stock = stock - :one',
        ConditionExpression: 'stock >= :one',
        ExpressionAttributeValues: { ':one': 1 }
      }));
    } catch { /* ignore */ }
  }

  const orderId = 'o_' + crypto.randomBytes(8).toString('hex');
  const order = {
    orderId,
    userId: auth.userId,
    username: auth.username,
    displayName: user.displayName || auth.username,
    toyId,
    toyName: toy.name,
    toyImageUrl: toy.imageUrl || '',
    priceCents: toy.priceCents,
    status: 'pending',
    address: addr,
    parent: { name: parentName, email: parentEmail, phone: parentPhone, consent: true, consentAt: Date.now() },
    createdAt: Date.now()
  };
  await ddb.send(new PutCommand({ TableName: ORDERS_TABLE, Item: order }));

  return ok({ order, balanceCents: balance - toy.priceCents });
}

async function handleListMyOrders(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  const r = await ddb.send(new QueryCommand({
    TableName: ORDERS_TABLE,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': auth.userId }
  }));
  const orders = (r.Items || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return ok({ orders });
}

// ===== Admin =====

async function handleAdminListToys(payload) {
  const g = await requireAdmin(payload); if (g.error) return g.error;
  const r = await ddb.send(new ScanCommand({ TableName: TOYS_TABLE }));
  const toys = (r.Items || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return ok({ toys });
}

async function handleAdminUpsertToy(payload) {
  const g = await requireAdmin(payload); if (g.error) return g.error;
  const t = payload.toy || {};
  const name = validString(t.name, 100);
  if (!name) return bad(400, 'Toy name is required');
  const description = validString(t.description, 600) || '';
  const priceCents = parseInt(t.priceCents, 10);
  if (!Number.isFinite(priceCents) || priceCents < 1 || priceCents > 50000) {
    return bad(400, 'Price must be 1 to 50000 cents');
  }
  const imageUrl = validString(t.imageUrl, 500) || '';
  const stock = (t.stock === '' || t.stock == null) ? null : parseInt(t.stock, 10);
  const active = t.active !== false;

  const toyId = validString(t.toyId, 80) || ('toy_' + crypto.randomBytes(6).toString('hex'));
  const item = {
    toyId,
    name,
    description,
    priceCents,
    imageUrl,
    stock: Number.isFinite(stock) ? stock : null,
    active,
    createdAt: t.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  await ddb.send(new PutCommand({ TableName: TOYS_TABLE, Item: item }));
  return ok({ toy: item });
}

async function handleAdminDeleteToy(payload) {
  const g = await requireAdmin(payload); if (g.error) return g.error;
  const toyId = validString(payload.toyId, 80);
  if (!toyId) return bad(400, 'Missing toyId');
  await ddb.send(new DeleteCommand({ TableName: TOYS_TABLE, Key: { toyId } }));
  return ok({ ok: true });
}

async function handleAdminPresignUpload(payload) {
  const g = await requireAdmin(payload); if (g.error) return g.error;
  if (!S3_TOY_BUCKET) return bad(500, 'S3 bucket not configured');
  const ct = String(payload.contentType || '').toLowerCase();
  const allowed = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  if (!allowed[ct]) return bad(400, 'Image must be JPEG, PNG, WEBP, or GIF');
  const key = `images/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${allowed[ct]}`;
  const cmd = new PutObjectCommand({
    Bucket: S3_TOY_BUCKET,
    Key: key,
    ContentType: ct
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
  const publicUrl = `https://${S3_TOY_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
  return ok({ uploadUrl, publicUrl, key });
}

async function handleAdminListOrders(payload) {
  const g = await requireAdmin(payload); if (g.error) return g.error;
  const r = await ddb.send(new ScanCommand({ TableName: ORDERS_TABLE }));
  const orders = (r.Items || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return ok({ orders });
}

async function handleAdminUpdateOrder(payload) {
  const g = await requireAdmin(payload); if (g.error) return g.error;
  const orderId = validString(payload.orderId, 80);
  if (!orderId) return bad(400, 'Missing orderId');
  const status = validString(payload.status, 30);
  const allowed = ['pending', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return bad(400, 'Invalid status');
  const tracking = validString(payload.trackingNumber, 80) || '';
  await ddb.send(new UpdateCommand({
    TableName: ORDERS_TABLE,
    Key: { orderId },
    UpdateExpression: 'SET #s = :s, trackingNumber = :t, updatedAt = :u',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': status, ':t': tracking, ':u': Date.now() }
  }));
  return ok({ ok: true });
}

async function handleLose(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  if (!auth.username) return bad(401, 'Please sign in again');

  let cents = parseInt(payload.cents, 10);
  if (!Number.isFinite(cents) || cents < 1) cents = 1;
  if (cents > 5) cents = 5;

  const sectionKey = normalizeSectionKey(payload.section);

  const r = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username }
  }));
  if (!r.Item) return bad(404, 'User not found');
  const balance = r.Item.balanceCents || 0;
  const lifetime = r.Item.lifetimeCents || 0;
  const mastered = r.Item.masteredSections || {};

  // Always bump the monotonic answered counter FIRST — wrong answers count
  // as attempts toward accuracy even when the section is mastered (no cents
  // deducted). Fire-and-forget; we don't await the increment in the
  // mastered short-circuit either.
  ddb.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username },
    UpdateExpression: 'SET lifetimeAnswered = if_not_exists(lifetimeAnswered, :z) + :one',
    ExpressionAttributeValues: { ':z': 0, ':one': 1 }
  })).catch(() => {});

  if (sectionKey && mastered[sectionKey]) {
    return ok({
      lostCents: 0,
      balanceCents: balance,
      lifetimeCents: lifetime,
      capCents: LIFETIME_CAP_CENTS,
      locked: true,
      masteredSections: mastered
    });
  }

  // (legacy duplicate bump removed — answered is now incremented above so
  // it also covers the mastered-section path.)

  const deduct = Math.min(cents, balance); // floor at 0

  if (deduct <= 0) {
    return ok({
      lostCents: 0,
      balanceCents: balance,
      lifetimeCents: lifetime,
      capCents: LIFETIME_CAP_CENTS,
      flooredAtZero: true
    });
  }

  const upd = await ddb.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username },
    UpdateExpression: 'SET balanceCents = balanceCents - :d',
    ConditionExpression: 'balanceCents >= :d',
    ExpressionAttributeValues: { ':d': deduct },
    ReturnValues: 'ALL_NEW'
  }));
  return ok({
    lostCents: deduct,
    balanceCents: upd.Attributes.balanceCents || 0,
    lifetimeCents: upd.Attributes.lifetimeCents || 0,
    capCents: LIFETIME_CAP_CENTS,
    flooredAtZero: (upd.Attributes.balanceCents || 0) === 0
  });
}

async function handleMarkMastered(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  if (!auth.username) return bad(401, 'Please sign in again');

  const sectionKey = normalizeSectionKey(payload.section);
  if (!sectionKey) return bad(400, 'Invalid section');

  const label = (typeof payload.label === 'string') ? payload.label.slice(0, 200) : '';
  const now = new Date().toISOString();

  const upd = await ddb.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username },
    UpdateExpression: 'SET masteredSections = if_not_exists(masteredSections, :empty), masteredSections.#k = :v',
    ExpressionAttributeNames: { '#k': sectionKey },
    ExpressionAttributeValues: {
      ':empty': {},
      ':v': { at: now, label }
    },
    ReturnValues: 'ALL_NEW'
  }));
  return ok({
    masteredSections: upd.Attributes.masteredSections || {},
    section: sectionKey
  });
}

function sumValues(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let total = 0;
  for (const k of Object.keys(obj)) {
    const v = parseInt(obj[k], 10);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

function userTotals(item) {
  // Prefer the monotonic counters that handleEarn/handleLose maintain
  // (these never get clobbered by client-side stat resets). Fall back to
  // the per-slug sums for legacy users; if even that's missing but they
  // have lifetime cents, estimate from cents (~3c per correct, average
  // payout for 1..5 difficulty is 3) so they don't appear with 0/0.
  const monoCorrect = parseInt(item?.lifetimeCorrect, 10);
  const monoAnswered = parseInt(item?.lifetimeAnswered, 10);
  const slugC = sumValues(item?.slugCorrect);
  const slugT = sumValues(item?.slugTotal);
  const cents = parseInt(item?.lifetimeCents, 10) || 0;

  let correct = Number.isFinite(monoCorrect) && monoCorrect > 0
    ? monoCorrect
    : slugC;
  let answered = Number.isFinite(monoAnswered) && monoAnswered > 0
    ? monoAnswered
    : slugT;

  // Legacy reconciliation: if slug stats look way smaller than what cents
  // implies, trust cents (it's append-only and never overwritten).
  if (!Number.isFinite(monoCorrect) && cents > 0) {
    const estFromCents = Math.round(cents / 3);
    if (estFromCents > correct) correct = estFromCents;
    if (correct > answered) answered = correct;
  }

  return {
    correct,
    answered,
    lifetimeCents: cents,
    balanceCents: parseInt(item?.balanceCents, 10) || 0,
    monotonic: Number.isFinite(monoCorrect)
  };
}

async function handleLeaderboard(payload) {
  // Public-ish: anyone signed in can see the top board with display names only.
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');

  const r = await ddb.send(new ScanCommand({
    TableName: USERS_TABLE,
    ProjectionExpression: 'username, displayName, slugCorrect, slugTotal, lifetimeCents'
  }));
  const items = r.Items || [];
  const rows = items.map(it => {
    const t = userTotals(it);
    const acc = t.answered > 0 ? Math.round((t.correct / t.answered) * 100) : 0;
    return {
      username: it.username,
      displayName: it.displayName || it.username,
      correct: t.correct,
      answered: t.answered,
      accuracy: acc,
      // Legacy users without monotonic counters get a "~" badge instead of
      // a hard percentage since the answered count is estimated.
      accuracyKnown: t.monotonic,
      lifetimeCents: t.lifetimeCents
    };
  })
  .filter(r => r.correct > 0 || r.lifetimeCents > 0)
  .sort((a, b) =>
    (b.correct - a.correct) ||
    (b.lifetimeCents - a.lifetimeCents) ||
    (b.accuracy - a.accuracy)
  );

  const top = rows.slice(0, 10).map((r, idx) => ({ rank: idx + 1, ...r }));
  const meRow = rows.findIndex(r => r.username === auth.username);
  const me = meRow >= 0 ? { rank: meRow + 1, ...rows[meRow] } : null;

  return ok({ top, me, totalUsers: rows.length });
}

// Public endpoint: how many students are active right now.
// Active = lastSeenAt within the last 10 minutes.
async function handleLiveCount(_payload) {
  const cutoff = Date.now() - 10 * 60 * 1000;
  try {
    const r = await ddb.send(new ScanCommand({
      TableName: USERS_TABLE,
      ProjectionExpression: 'lastSeenAt'
    }));
    const items = r.Items || [];
    const total = items.length;
    const online = items.filter(it => {
      const ts = parseInt(it.lastSeenAt, 10);
      return Number.isFinite(ts) && ts >= cutoff;
    }).length;
    return ok({ online, total });
  } catch (_) {
    return ok({ online: 0, total: 0 });
  }
}

// Admin-only: detailed view of who is online right now and who is actively
// practicing. "Online" = any authed action in the last 10 minutes.
// "Practicing" = heartbeat received in the last 3 minutes (heartbeats only
// come from the practice page).
async function handleAdminLiveUsers(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  if (!isAdmin(auth.username)) return bad(403, 'Admin only');

  const now = Date.now();
  const onlineCutoff = now - 10 * 60 * 1000;
  const practicingCutoff = now - 3 * 60 * 1000;

  const r = await ddb.send(new ScanCommand({
    TableName: USERS_TABLE,
    ProjectionExpression: 'username, displayName, grade, color, lastSeenAt, lastPracticingAt, lifetimeCents, lifetimeSeconds'
  }));
  const items = r.Items || [];
  const totalUsers = items.length;

  const enriched = items.map(it => {
    const lastSeenAt = parseInt(it.lastSeenAt, 10) || 0;
    const lastPracticingAt = parseInt(it.lastPracticingAt, 10) || 0;
    return {
      username: it.username,
      displayName: it.displayName || it.username,
      grade: it.grade || null,
      color: it.color || null,
      lastSeenAt,
      lastPracticingAt,
      lifetimeCents: parseInt(it.lifetimeCents, 10) || 0,
      lifetimeSeconds: parseInt(it.lifetimeSeconds, 10) || 0,
      isOnline: lastSeenAt >= onlineCutoff,
      isPracticing: lastPracticingAt >= practicingCutoff
    };
  });

  const onlineList = enriched
    .filter(u => u.isOnline)
    .sort((a, b) => {
      // Practicing first, then by most-recent activity.
      if (a.isPracticing !== b.isPracticing) return a.isPracticing ? -1 : 1;
      return b.lastSeenAt - a.lastSeenAt;
    });

  return ok({
    totalUsers,
    onlineCount: onlineList.length,
    practicingCount: onlineList.filter(u => u.isPracticing).length,
    serverNow: now,
    users: onlineList
  });
}

// ===== Friends + safe chat =====
//
// Tables:
//   staar-friends:   PK username (S), SK peer (S)
//                    attrs: status ('pending_out'|'pending_in'|'accepted'),
//                           updatedAt, peerDisplayName
//   staar-messages:  PK convId (S, sorted "a|b"), SK ts (N)
//                    attrs: from, code (int idx into SAFE_PHRASES), id
//
// Chat is intentionally NOT free-text. Clients submit a numeric code that
// indexes into SAFE_PHRASES. The server validates the code and stores it,
// so there is no path for users to send arbitrary text, links, or PII.

const SAFE_PHRASES = [
  'Hi! 👋',
  'GG! 🎮',
  'Nice work! ⭐',
  'Good luck! 🍀',
  'Let’s race! 🏁',
  'Wow! 🤩',
  'You’re fast! ⚡',
  'Math high-five! ✋',
  'I’m practicing now 📚',
  'See you on the leaderboard! 🏆',
  'Cheering you on! 📣',
  'Bye! 👋'
];
const SAFE_REACTIONS = ['👍', '❤️', '🎉', '🔥', '😂', '🤔'];
// Codes 0..N-1 = phrases; codes 1000..1000+M-1 = reactions.
const REACTION_CODE_BASE = 1000;

function isValidChatCode(c) {
  const n = parseInt(c, 10);
  if (!Number.isFinite(n)) return false;
  if (n >= 0 && n < SAFE_PHRASES.length) return true;
  if (n >= REACTION_CODE_BASE && n < REACTION_CODE_BASE + SAFE_REACTIONS.length) return true;
  return false;
}

function convId(a, b) {
  return [a, b].sort().join('|');
}

function sanitizeUsername(u) {
  if (typeof u !== 'string') return null;
  const s = u.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(s)) return null;
  return s;
}

async function getUserItem(username) {
  const r = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username }
  }));
  return r.Item || null;
}

// POST { token, target } — send a friend request. Idempotent.
async function handleFriendRequest(payload) {
  const auth = await authedUser(payload);
  if (!auth || !auth.username) return bad(401, 'Not signed in');
  const target = sanitizeUsername(payload.target);
  if (!target) return bad(400, 'Invalid target');
  if (target === auth.username) return bad(400, 'You can’t friend yourself');

  const me = await getUserItem(auth.username);
  const them = await getUserItem(target);
  if (!them) return bad(404, 'User not found');

  // If a row already exists either way, surface its status (idempotent).
  const existing = await ddb.send(new GetCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: auth.username, peer: target }
  }));
  if (existing.Item && existing.Item.status === 'accepted') {
    return ok({ status: 'accepted' });
  }
  // If THEY already requested ME, auto-accept.
  if (existing.Item && existing.Item.status === 'pending_in') {
    return await acceptPair(auth.username, me, target, them);
  }

  const now = Date.now();
  await ddb.send(new PutCommand({
    TableName: FRIENDS_TABLE,
    Item: {
      username: auth.username,
      peer: target,
      status: 'pending_out',
      peerDisplayName: them.displayName || target,
      updatedAt: now
    }
  }));
  await ddb.send(new PutCommand({
    TableName: FRIENDS_TABLE,
    Item: {
      username: target,
      peer: auth.username,
      status: 'pending_in',
      peerDisplayName: (me && me.displayName) || auth.username,
      updatedAt: now
    }
  }));
  return ok({ status: 'pending_out' });
}

async function acceptPair(meName, meItem, peerName, peerItem) {
  const now = Date.now();
  await ddb.send(new UpdateCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: meName, peer: peerName },
    UpdateExpression: 'SET #s = :s, updatedAt = :t, peerDisplayName = :n',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':s': 'accepted',
      ':t': now,
      ':n': (peerItem && peerItem.displayName) || peerName
    }
  }));
  await ddb.send(new UpdateCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: peerName, peer: meName },
    UpdateExpression: 'SET #s = :s, updatedAt = :t, peerDisplayName = :n',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':s': 'accepted',
      ':t': now,
      ':n': (meItem && meItem.displayName) || meName
    }
  }));
  return ok({ status: 'accepted' });
}

// POST { token, target, decision: 'accept'|'decline' }
async function handleFriendRespond(payload) {
  const auth = await authedUser(payload);
  if (!auth || !auth.username) return bad(401, 'Not signed in');
  const target = sanitizeUsername(payload.target);
  if (!target) return bad(400, 'Invalid target');
  const decision = payload.decision === 'accept' ? 'accept' : payload.decision === 'decline' ? 'decline' : null;
  if (!decision) return bad(400, 'Invalid decision');

  // Must be a pending_in request from target.
  const r = await ddb.send(new GetCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: auth.username, peer: target }
  }));
  if (!r.Item || r.Item.status !== 'pending_in') {
    return bad(404, 'No pending request from that user');
  }

  if (decision === 'decline') {
    await ddb.send(new DeleteCommand({
      TableName: FRIENDS_TABLE,
      Key: { username: auth.username, peer: target }
    }));
    await ddb.send(new DeleteCommand({
      TableName: FRIENDS_TABLE,
      Key: { username: target, peer: auth.username }
    }));
    return ok({ status: 'declined' });
  }

  const me = await getUserItem(auth.username);
  const them = await getUserItem(target);
  if (!them) return bad(404, 'User not found');
  return await acceptPair(auth.username, me, target, them);
}

// POST { token } — list all friends + pending in/out
async function handleFriendList(payload) {
  const auth = await authedUser(payload);
  if (!auth || !auth.username) return bad(401, 'Not signed in');
  const r = await ddb.send(new QueryCommand({
    TableName: FRIENDS_TABLE,
    KeyConditionExpression: 'username = :u',
    ExpressionAttributeValues: { ':u': auth.username }
  }));
  const rows = (r.Items || []).map(it => ({
    peer: it.peer,
    displayName: it.peerDisplayName || it.peer,
    status: it.status,
    updatedAt: it.updatedAt || 0
  }));

  // Look up lastSeenAt for accepted friends so the UI can show online dots.
  const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  const accepted = rows.filter(r => r.status === 'accepted');
  const seenMap = {};
  await Promise.all(accepted.map(async f => {
    try {
      const u = await ddb.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { username: f.peer },
        ProjectionExpression: 'lastSeenAt'
      }));
      const ts = parseInt(u.Item && u.Item.lastSeenAt, 10);
      seenMap[f.peer] = Number.isFinite(ts) ? ts : 0;
    } catch (_) {
      seenMap[f.peer] = 0;
    }
  }));
  for (const f of accepted) {
    const ts = seenMap[f.peer] || 0;
    f.lastSeenAt = ts;
    f.online = ts > 0 && (now - ts) <= ONLINE_WINDOW_MS;
  }

  return ok({
    friends:    accepted.sort((a, b) =>
      (b.online === a.online ? 0 : (b.online ? 1 : -1)) ||
      (b.updatedAt - a.updatedAt)
    ),
    incoming:   rows.filter(r => r.status === 'pending_in').sort((a, b) => b.updatedAt - a.updatedAt),
    outgoing:   rows.filter(r => r.status === 'pending_out').sort((a, b) => b.updatedAt - a.updatedAt)
  });
}

// POST { token, target } — remove friendship from both sides
async function handleFriendUnfriend(payload) {
  const auth = await authedUser(payload);
  if (!auth || !auth.username) return bad(401, 'Not signed in');
  const target = sanitizeUsername(payload.target);
  if (!target) return bad(400, 'Invalid target');
  await ddb.send(new DeleteCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: auth.username, peer: target }
  }));
  await ddb.send(new DeleteCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: target, peer: auth.username }
  }));
  return ok({ status: 'removed' });
}

// POST { token, target, code } — send a canned message. Code MUST be valid.
async function handleChatSend(payload) {
  const auth = await authedUser(payload);
  if (!auth || !auth.username) return bad(401, 'Not signed in');
  const target = sanitizeUsername(payload.target);
  if (!target) return bad(400, 'Invalid target');
  if (!isValidChatCode(payload.code)) return bad(400, 'Invalid message');

  // Must be friends.
  const friend = await ddb.send(new GetCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: auth.username, peer: target }
  }));
  if (!friend.Item || friend.Item.status !== 'accepted') {
    return bad(403, 'You can only chat with friends');
  }

  // Light per-pair rate limit: max 12 messages per minute (one direction).
  const now = Date.now();
  const since = now - 60_000;
  const cid = convId(auth.username, target);
  const recent = await ddb.send(new QueryCommand({
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: 'convId = :c AND ts >= :t',
    FilterExpression: '#f = :u',
    ExpressionAttributeNames: { '#f': 'from' },
    ExpressionAttributeValues: { ':c': cid, ':t': since, ':u': auth.username }
  }));
  if ((recent.Items || []).length >= 12) {
    return bad(429, 'Slow down — too many messages');
  }

  const id = crypto.randomBytes(8).toString('hex');
  await ddb.send(new PutCommand({
    TableName: MESSAGES_TABLE,
    Item: {
      convId: cid,
      ts: now,
      id,
      from: auth.username,
      code: parseInt(payload.code, 10)
    }
  }));
  return ok({ id, ts: now });
}

// POST { token, target, since? } — fetch recent messages with one peer.
async function handleChatHistory(payload) {
  const auth = await authedUser(payload);
  if (!auth || !auth.username) return bad(401, 'Not signed in');
  const target = sanitizeUsername(payload.target);
  if (!target) return bad(400, 'Invalid target');

  const friend = await ddb.send(new GetCommand({
    TableName: FRIENDS_TABLE,
    Key: { username: auth.username, peer: target }
  }));
  if (!friend.Item || friend.Item.status !== 'accepted') {
    return bad(403, 'You can only chat with friends');
  }

  const since = parseInt(payload.since, 10);
  const cid = convId(auth.username, target);
  const params = {
    TableName: MESSAGES_TABLE,
    KeyConditionExpression: Number.isFinite(since)
      ? 'convId = :c AND ts > :s'
      : 'convId = :c',
    ExpressionAttributeValues: Number.isFinite(since)
      ? { ':c': cid, ':s': since }
      : { ':c': cid },
    Limit: 50,
    ScanIndexForward: true
  };
  const r = await ddb.send(new QueryCommand(params));
  const items = (r.Items || []).map(m => ({
    id: m.id,
    ts: m.ts,
    from: m.from,
    code: m.code
  }));
  return ok({
    messages: items,
    phrases: SAFE_PHRASES,
    reactions: SAFE_REACTIONS,
    reactionBase: REACTION_CODE_BASE
  });
}

// POST { token, since? } — totals for the inbox bell.
// Returns counts of pending requests and unread messages per peer (since ts).
async function handleChatInbox(payload) {
  const auth = await authedUser(payload);
  if (!auth || !auth.username) return ok({ pendingRequests: 0, unread: {} });
  const since = parseInt(payload.since, 10) || 0;

  const f = await ddb.send(new QueryCommand({
    TableName: FRIENDS_TABLE,
    KeyConditionExpression: 'username = :u',
    ExpressionAttributeValues: { ':u': auth.username }
  }));
  const items = f.Items || [];
  const pendingRequests = items.filter(i => i.status === 'pending_in').length;
  const friends = items.filter(i => i.status === 'accepted').map(i => i.peer);

  // For each friendship, query messages since `since` from the peer.
  const unread = {};
  await Promise.all(friends.map(async (peer) => {
    const cid = convId(auth.username, peer);
    const r = await ddb.send(new QueryCommand({
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: 'convId = :c AND ts > :t',
      FilterExpression: '#f = :p',
      ExpressionAttributeNames: { '#f': 'from' },
      ExpressionAttributeValues: { ':c': cid, ':t': since, ':p': peer },
      Select: 'COUNT'
    }));
    if (r.Count && r.Count > 0) unread[peer] = r.Count;
  }));

  return ok({ pendingRequests, unread });
}


// Adds time-on-task to lifetimeSeconds. Capped per call so a hostile or
// buggy client can't fast-forward the counter.
async function handleHeartbeat(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  if (!auth.username) return bad(401, 'Please sign in again');
  let secs = parseInt(payload.seconds, 10);
  if (!Number.isFinite(secs) || secs < 1) return ok({ lifetimeSeconds: 0 });
  // Hard cap: at most 120 seconds added per call (clients heartbeat ~once
  // a minute; this allows a little slack for slow networks).
  if (secs > 120) secs = 120;
  try {
    const upd = await ddb.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { username: auth.username },
      UpdateExpression: 'SET lifetimeSeconds = if_not_exists(lifetimeSeconds, :z) + :s, lastPracticingAt = :now',
      ExpressionAttributeValues: { ':z': 0, ':s': secs, ':now': Date.now() },
      ReturnValues: 'ALL_NEW'
    }));
    return ok({ lifetimeSeconds: parseInt(upd.Attributes.lifetimeSeconds, 10) || 0 });
  } catch (_) {
    return ok({ lifetimeSeconds: 0 });
  }
}

async function handleDashboard(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  if (!auth.username) return bad(401, 'Please sign in again');

  const r = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username }
  }));
  if (!r.Item) return bad(404, 'User not found');
  const t = userTotals(r.Item);
  const acc = t.answered > 0 ? Math.round((t.correct / t.answered) * 100) : 0;
  return ok({
    displayName: r.Item.displayName || r.Item.username,
    username: r.Item.username,
    grade: r.Item.grade || null,
    correct: t.correct,
    answered: t.answered,
    accuracy: acc,
    balanceCents: t.balanceCents,
    lifetimeCents: t.lifetimeCents,
    lifetimeSeconds: parseInt(r.Item.lifetimeSeconds, 10) || 0,
    capCents: LIFETIME_CAP_CENTS,
    masteredSections: r.Item.masteredSections || {}
  });
}

async function handleSetGrade(payload) {
  const auth = await authedUser(payload);
  if (!auth) return bad(401, 'Not signed in');
  if (!auth.username) return bad(401, 'Please sign in again');
  const grade = sanitizeGrade(payload.grade);
  if (!grade) return bad(400, 'Pick a valid grade');

  // Only allow setting once. If grade is already set, reject (so kids can't switch down).
  const cur = await ddb.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username }
  }));
  if (!cur.Item) return bad(404, 'User not found');
  if (cur.Item.grade) return bad(409, 'Grade is already set. Ask an adult to change it.');

  await ddb.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { username: auth.username },
    UpdateExpression: 'SET grade = :g',
    ExpressionAttributeValues: { ':g': grade }
  }));
  return ok({ grade });
}
