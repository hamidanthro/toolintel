// STAAR Prep — AI Tutor Lambda
// Provides interactive, age-appropriate math help when a student answers incorrectly.
// Uses AWS Bedrock (Claude) via the InvokeModel API.
//
// Endpoint:
//   POST /tutor
//   Body: {
//     grade: 3,                       // numeric or string (e.g. 3 or "algebra-1")
//     question: "...",                // the prompt the student saw
//     correctAnswer: "24",            // the correct answer
//     studentAnswer: "20",            // what the student typed/picked
//     explanation: "...",             // canned explanation from the curriculum
//     teks: "3.4D",                   // (optional) TEKS code
//     topic: "Multiplication",        // (optional) unit title
//     history: [                      // (optional) follow-up turns
//       { role: "user" | "assistant", content: "..." }
//     ]
//   }
//
// Response: { reply: "..." }
//
// Environment variables:
//   BEDROCK_MODEL_ID  (default: anthropic.claude-3-5-haiku-20241022-v1:0)
//   BEDROCK_REGION    (default: us-east-1)
//   ALLOWED_ORIGIN    (default: *)

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-haiku-20241022-v1:0';
const REGION = process.env.BEDROCK_REGION || 'us-east-1';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const bedrock = new BedrockRuntimeClient({ region: REGION });

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

// Truncate any field to a safe length to keep the prompt small and prevent abuse.
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

  // Build the conversation. The first turn is synthesized from the structured payload.
  // Any history items appended represent follow-up turns from the student.
  const messages = [
    { role: 'user', content: buildFirstUserMessage(payload) }
  ];

  if (Array.isArray(payload.history)) {
    // Skip the first user message we already added; append the remaining alternating turns.
    // Expected shape: [{role:'user', content}, {role:'assistant', content}, ...]
    // We trust the client to send a coherent history but cap length to last 10 turns and clip each.
    const hist = payload.history.slice(-10);
    let lastRole = 'user';
    for (const turn of hist) {
      if (!turn || !turn.role || !turn.content) continue;
      if (turn.role === lastRole) continue; // avoid two same-role messages in a row
      messages.push({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: clip(turn.content, 800) });
      lastRole = turn.role;
    }
    // Ensure the conversation ends on a user turn so the model replies.
    if (messages[messages.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: 'Please continue helping me.' });
    }
  }

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 600,
    temperature: 0.4,
    system: buildSystemPrompt(payload.grade),
    messages
  };

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body)
    }));
    const json = JSON.parse(new TextDecoder().decode(res.body));
    const reply = (json.content && json.content[0] && json.content[0].text) || '';
    return ok({ reply, model: MODEL_ID });
  } catch (err) {
    console.error('Bedrock error:', err);
    return bad(502, 'AI tutor unavailable');
  }
};
