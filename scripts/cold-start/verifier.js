/**
 * Math verifier — second-pass quality gate.
 *
 * After a question is generated, ask gpt-4o (the stronger model) to:
 *   1. Solve the question independently from scratch.
 *   2. Pick which choice (A/B/C/D) matches its solution.
 *   3. Rate explanation quality.
 *
 * If the verifier's chosen answer ≠ the generator's marked correctIndex,
 * the question is rejected. This catches the gpt-4o-mini arithmetic
 * hallucinations observed in the probe.
 *
 * Cost: ~400 tokens × $5/1M input + $20/1M output ≈ $0.005 per verify.
 * Rejection rate runs ~25-40% on grade-3..8 math, so net cost per saved
 * question is roughly 1.5×$0.005 = $0.0075 + the original gen.
 */
const { getOpenAI } = require('./lake-client');

const VERIFIER_MODEL = 'gpt-4o';

function gradeReadable(grade) {
  if (grade === 'grade-k') return 'Kindergarten';
  if (grade === 'algebra-1') return 'Algebra 1';
  if (grade === 'geometry') return 'Geometry';
  const m = grade.match(/grade-(\d+)/);
  return m ? `Grade ${m[1]}` : grade;
}

const SYSTEM = 'You are an expert K-12 math teacher reviewing a multiple-choice question. Your job is to solve the problem yourself from scratch — do not trust any provided answer key — and then judge which lettered choice (A/B/C/D) matches your solution. Output ONLY valid JSON.';

function buildPrompt(item, grade) {
  const choicesBlock = item.choices.map((c, i) => `  ${'ABCD'[i]}. ${c}`).join('\n');
  return `Question (${gradeReadable(grade)}):
${item.question}

Choices:
${choicesBlock}

Tasks:
1. Solve the problem yourself, step by step.
2. State which lettered choice (A/B/C/D) your solution matches. If your answer matches none of the four choices, set chosenLetter to null.
3. Judge whether the explanation provided below correctly justifies your chosen answer.

Provided explanation:
${item.explanation || '(none)'}

Output ONLY this JSON, no preamble:
{
  "myWork": "step-by-step reasoning",
  "myAnswer": "the value you computed",
  "chosenLetter": "A" | "B" | "C" | "D" | null,
  "explanationConsistent": true | false,
  "issues": ["list of any factual errors, contradictions, or grade-inappropriate content"]
}`;
}

/**
 * Returns { ok: bool, reason?: string, verifier?: object }.
 *
 * ok=true means the verifier independently solved to the same letter as
 * item.correctIndex AND found no factual issues.
 */
async function verifyMath(item, grade) {
  const correctLetter = 'ABCD'[item.correctIndex];
  const prompt = buildPrompt(item, grade);
  let raw;
  try {
    const resp = await getOpenAI().chat.completions.create({
      model: VERIFIER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0
    });
    raw = resp.choices[0].message.content;
  } catch (err) {
    return { ok: false, reason: `verifier-api-error: ${err.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `verifier-bad-json: ${err.message}`, raw };
  }

  if (!parsed.chosenLetter) {
    return { ok: false, reason: `verifier-no-match (none of A/B/C/D match computed answer "${parsed.myAnswer}")`, verifier: parsed };
  }
  if (parsed.chosenLetter !== correctLetter) {
    return { ok: false, reason: `verifier-answer-mismatch: marked=${correctLetter} verifier=${parsed.chosenLetter} (verifier's answer="${parsed.myAnswer}")`, verifier: parsed };
  }
  if (parsed.explanationConsistent === false) {
    return { ok: false, reason: `verifier-explanation-inconsistent: ${(parsed.issues || []).join('; ')}`, verifier: parsed };
  }
  if (Array.isArray(parsed.issues) && parsed.issues.length) {
    // Hard-fail on any flagged issue. We can soften this later if too aggressive.
    return { ok: false, reason: `verifier-flagged-issues: ${parsed.issues.join('; ')}`, verifier: parsed };
  }
  return { ok: true, verifier: parsed };
}

module.exports = { verifyMath, VERIFIER_MODEL };
