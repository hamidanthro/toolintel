/**
 * Cold-start question generator (I2).
 * State-aware prompt builder + single-question generator.
 */
const { getOpenAI } = require('./lake-client');
const { getStateRecord } = require('./states-grades');
const { judgeQuestion, JudgeRejectedTwiceError } = require('./judge');

// Hard kill switch: COLD_START_JUDGE=off bypasses the judge entirely
// and restores pre-judge behavior. Anything else (unset, "on", "true", etc.)
// leaves the judge enabled.
const JUDGE_ENABLED = process.env.COLD_START_JUDGE !== 'off';

// Curated style overrides for flagship states. These describe legitimate
// format quirks of each state's specific assessment (computer-adaptive,
// progress-monitoring windows, paper-based, etc.) and are allowed to
// reference their own state's test name. State metadata (testName /
// standards / testAuthority) is NOT duplicated here — it is read from
// js/states-data.js via getStateRecord().
const STATE_STYLE_OVERRIDES = {
  texas: 'Texas STAAR favors word problems with real-world contexts (Texas geography, Hispanic cultural contexts welcome, school-and-family scenarios). Math: 4-choice multiple choice. Rigor matches TEA released items.',
  california: 'CAASPP uses computer-adaptive testing; questions follow Smarter Balanced format. Multi-step reasoning is common.',
  florida: 'FAST uses three progress-monitoring windows. Questions match B.E.S.T. format which moved away from Common Core.',
  'new-york': 'NY uses paper and computer-based testing. Multi-step reasoning and academic vocabulary expected.'
};

// Generic style guidance for any state without a curated override above.
// Keeps content state-neutral so the per-state framing (testName / standards
// / testAuthority injected from js/states-data.js) is the only thing that
// distinguishes one state's questions from another's.
const GENERIC_STYLE = [
  'Use universally relatable word-problem contexts: sports, food, money, school, family, generic situations.',
  'Do NOT reference specific U.S. landmarks, cities, monuments, regional foods, sports teams, or cultural touchstones tied to any state.',
  'The state-specific flavor for this bucket is carried by the test framing (test name, standards, authority) injected separately — NOT by the problem content.',
  'Use generic placeholder names for people (Maria, Jamal, Priya, Chen, etc.) and generic settings (a school, a store, a park, a library).'
].join(' ');

const QUESTION_TYPE_PROMPTS = {
  math: {
    'word-problem': 'A real-world word problem requiring 1-3 steps. Setup should be relatable to a child of this grade.',
    'computation': 'Direct computation problem. Tests fluency with numbers, operations, fractions, decimals, or algebra concepts as grade-appropriate.',
    'concept': 'Conceptual understanding question. Tests "why" or "what" rather than "how" — e.g. "Which best represents...", "What does this fraction mean...".',
    'data-interpretation': 'Question with a small data set (table, simple chart described in text). Asks the student to read or analyze the data.'
  },
  reading: {
    'main-idea': 'Reading passage with a question asking for the main idea or central message.',
    'key-detail': 'Reading passage with a question about a specific detail in the text.',
    'vocabulary': 'Reading passage with a question asking the meaning of a word or phrase as used in the passage.',
    'inference': 'Reading passage with a question requiring the student to infer something not directly stated.',
    'author-purpose': 'Reading passage with a question about why the author wrote the text or used a particular technique.',
    'text-structure': 'Reading passage with a question about how the text is organized (sequence, cause/effect, comparison, etc.).'
  }
};

function gradeReadable(grade) {
  if (grade === 'grade-k') return 'kindergarten';
  if (grade === 'algebra-1') return 'Algebra 1 (high school)';
  if (grade === 'geometry') return 'Geometry (high school)';
  return `grade ${grade.replace('grade-', '')}`;
}

function buildPrompt({ stateSlug, grade, subject, questionType }) {
  const record = getStateRecord(stateSlug);
  if (!record) {
    throw new Error(`generators.buildPrompt: unknown state slug "${stateSlug}"`);
  }
  const testName = record.testName;
  const testAuthority = record.testAuthority;
  const standards = record.standards;
  if (!testName) {
    throw new Error(`generators.buildPrompt: state "${stateSlug}" is missing required metadata field testName`);
  }
  if (!testAuthority) {
    throw new Error(`generators.buildPrompt: state "${stateSlug}" is missing required metadata field testAuthority`);
  }
  if (!standards) {
    throw new Error(`generators.buildPrompt: state "${stateSlug}" is missing required metadata field standards`);
  }
  const style = STATE_STYLE_OVERRIDES[stateSlug] || GENERIC_STYLE;
  const typeGuide = QUESTION_TYPE_PROMPTS[subject]?.[questionType] || '';
  const grLabel = gradeReadable(grade);
  const earlyGrades = ['grade-k', 'grade-1', 'grade-2'];
  const earlyHint = earlyGrades.includes(grade) ? `

CRITICAL FOR EARLY GRADES:
- Vocabulary at or below the kid's reading level. Avoid "represents", "approximately", "expression". Use "shows", "about", "math sentence".
- Grade K: counting 0-20, recognizing shapes, simple addition/subtraction within 10.
- Grade 1: addition/subtraction within 20, place value (tens and ones), simple measurement.
- Grade 2: addition/subtraction within 100, place value (hundreds), simple multiplication concepts.
- Word problems must use concrete kid-relatable scenarios: cookies, blocks, animals, family members.
- Keep all four answer choices similar in magnitude so wrong answers reflect real misconceptions, not orders-of-magnitude errors.` : '';

  if (subject === 'math') {
    return `You are an expert ${testName} math item writer.${earlyHint}

Generate ONE multiple-choice math question for ${grLabel} students preparing for the ${testName}.

Standards: align to ${standards} for ${grLabel}.
Authority: ${testAuthority}.
Style: ${style}

Question type: ${questionType}. ${typeGuide}

Requirements:
- Exactly 4 answer choices.
- Exactly one correct answer.
- BEFORE writing, solve the problem yourself and double-check the arithmetic. The marked correctIndex MUST equal the choice that solves the problem. The explanation MUST reach the same numerical answer as the marked choice — no contradictions.
- Distractors should reflect common student misconceptions, not random wrong answers.
- Question stem and choices clear, unambiguous, age-appropriate.
- Explanation references the correct answer and shows the reasoning a student should follow.
- Use diverse student names from many cultures.
- Numbers must be realistic for the grade. Show no negative numbers below grade 6.
- Each choice contains ONLY the answer text. Do NOT include letter labels (no "A:", "A.", "(A)", or "A " prefix). The system adds A/B/C/D labels in the UI.
- Output PLAIN TEXT only. Do NOT use LaTeX (\\frac, \\sqrt, \\(...\\), $$...$$, etc.). Write fractions as "1/4", multiplication as "3 × 4" or "3 * 4", division as "12 ÷ 3" or "12 / 3".
- Content must be appropriate for K–12 students: no violence, weapons, drugs, alcohol, romance/dating, or scary themes.

Output ONLY valid JSON, no preamble:
{
  "question": "...",
  "choices": ["<answer text only>", "<answer text only>", "<answer text only>", "<answer text only>"],
  "correctIndex": 0,
  "explanation": "..."
}`;
  }

  if (subject === 'reading') {
    const wcRange = ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5'].includes(grade) ? '80-180 words' : '150-300 words';
    return `You are an expert ${testName} reading item writer.

Generate ONE reading passage and ONE multiple-choice comprehension question for ${grLabel} students.

Standards: align to ${standards} for ${grLabel}.
Authority: ${testAuthority}.

Passage:
- Length: ${wcRange}.
- Type: rotate across fiction, nonfiction, poetry, informational.
- Topic: age-appropriate; favor universal themes (animals, nature, family, sports, history snippets, simple science).
- Avoid: current events, politics, controversial topics, regionally-narrow content.

Question type: ${questionType}. ${typeGuide}

Requirements:
- Question must be answerable from the passage (no outside knowledge required).
- Distractors plausible but clearly wrong on careful reading.
- Explanation cites specific evidence in the passage.
- Each choice contains ONLY the answer text. Do NOT include letter labels (no "A:", "A.", "(A)", or "A " prefix). The system adds A/B/C/D labels in the UI.

Output ONLY valid JSON, no preamble:
{
  "passage": { "title": "...", "text": "...", "type": "fiction" },
  "question": "...",
  "choices": ["<answer text only>", "<answer text only>", "<answer text only>", "<answer text only>"],
  "correctIndex": 0,
  "explanation": "..."
}`;
  }

  throw new Error(`Unsupported subject for cold-start: ${subject}`);
}

// One OpenAI call. Returns { parsed, tokensUsed }. On the regen path,
// pass the prior judge verdict via `regenFeedback` and the user message
// will carry the failure-mode context to the model.
//
// Culturally-diverse first-name pool injected into every user message.
// gpt-4o-mini at temp 0.9 defaults to "Maria" across calls when given only
// the system-prompt instruction "use diverse names" — see CLAUDE.md §29 +
// §30. Per-call user-message injection of a SHUFFLED 5-name subset gives
// the model a concrete short list to pick from, which it follows much more
// reliably than the vague style instruction in the system prompt.
const NAME_POOL = [
  'Aanya', 'Aisha', 'Carlos', 'Chen', 'Diego',
  'Fatima', 'Hiro', 'Imani', 'Jamal', 'Jin',
  'Kenji', 'Liam', 'Mateo', 'Nia', 'Noah',
  'Omar', 'Priya', 'Ravi', 'Sofia', 'Tatiana',
  'Yusuf', 'Zara', 'Zoe', 'Amara', 'Lila'
];

function pickShuffledNames(n) {
  const copy = NAME_POOL.slice();
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

async function _callGenerator(systemPrompt, regenFeedback) {
  const namesLine = `Pick the protagonist's first name from this short list (one of these, your choice): ${pickShuffledNames(5).join(', ')}.`;
  const userMessage = regenFeedback
    ? `Generate the question now. ${namesLine}\n\nPrevious attempt was rejected by quality review for: ${regenFeedback.failedChecks.join(', ')}. Specifically: ${regenFeedback.reasons.join(' ')} Generate a new question that fixes these issues.`
    : `Generate the question now. ${namesLine}`;
  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.9,
    max_tokens: 1200
  });
  const text = completion.choices[0].message.content;
  const parsed = JSON.parse(text);
  return { parsed, tokensUsed: completion.usage?.total_tokens || 0 };
}

async function generateOne({ state, grade, subject, type }) {
  const stateSlug = state;
  const questionType = type;
  const systemPrompt = buildPrompt({ stateSlug, grade, subject, questionType });
  const judgeContext = { stateSlug, subject, grade, gradeLabel: gradeReadable(grade) };

  const first = await _callGenerator(systemPrompt, null);

  if (!JUDGE_ENABLED) {
    return {
      ...first.parsed,
      _generatedBy: 'gpt-4o-mini',
      _promptVersion: 'cold-v1',
      _tokensUsed: first.tokensUsed
    };
  }

  const verdict1 = await judgeQuestion(first.parsed, judgeContext);
  if (verdict1.verdict === 'pass') {
    return {
      ...first.parsed,
      _generatedBy: 'gpt-4o-mini',
      _promptVersion: 'cold-v1',
      _tokensUsed: first.tokensUsed,
      _judge: 'pass'
    };
  }

  // First attempt rejected — regenerate ONCE with judge feedback appended
  // to the user message. No third attempt: two strikes and out is intentional.
  const second = await _callGenerator(systemPrompt, verdict1);
  const verdict2 = await judgeQuestion(second.parsed, judgeContext);
  if (verdict2.verdict === 'pass') {
    return {
      ...second.parsed,
      _generatedBy: 'gpt-4o-mini',
      _promptVersion: 'cold-v1-regen',
      _tokensUsed: first.tokensUsed + second.tokensUsed,
      _judge: 'pass-after-regen'
    };
  }

  throw new JudgeRejectedTwiceError(verdict1.failedChecks, verdict2.failedChecks);
}

module.exports = { generateOne, buildPrompt, STATE_STYLE_OVERRIDES, GENERIC_STYLE, QUESTION_TYPE_PROMPTS };
