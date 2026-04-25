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

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SECRET_NAME = process.env.OPENAI_SECRET_NAME || 'staar-tutor/openai-api-key';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const sm = new SecretsManagerClient({});
let cachedKey = null;

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
  const gradeLabel = typeof grade === 'number' ? `Grade ${grade}` : String(grade || 'elementary');
  return `You are a friendly, patient math tutor for a ${gradeLabel} student preparing for the Texas STAAR math test.

Rules:
- Use simple, age-appropriate language. Short sentences.
- Do NOT just reveal the answer. Guide the student step by step with hints and questions.
- Show your work with concrete examples (drawings in words, equal groups, place-value blocks, number lines).
- If the student already saw the correct answer, focus on WHY their answer was wrong and how to think about it.
- Stay focused on the math problem at hand. Politely redirect off-topic questions.
- Keep responses under 150 words unless the student asks for more detail.
- Be encouraging. Praise effort and correct reasoning steps.`;
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
