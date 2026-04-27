/**
 * Cold-start question generator (I2).
 * State-aware prompt builder + single-question generator.
 */
const { getOpenAI } = require('./lake-client');
const { getStateRecord } = require('./states-grades');

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
- Distractors should reflect common student misconceptions, not random wrong answers.
- Question stem and choices clear, unambiguous, age-appropriate.
- Explanation references the correct answer and shows the reasoning a student should follow.
- Use diverse student names from many cultures.
- Numbers must be realistic for the grade. Show no negative numbers below grade 6.
- Each choice contains ONLY the answer text. Do NOT include letter labels (no "A:", "A.", "(A)", or "A " prefix). The system adds A/B/C/D labels in the UI.

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

async function generateOne({ state, grade, subject, type }) {
  const stateSlug = state;
  const questionType = type;
  const systemPrompt = buildPrompt({ stateSlug, grade, subject, questionType });
  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate the question now.' }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.9,
    max_tokens: 1200
  });
  const text = completion.choices[0].message.content;
  const parsed = JSON.parse(text);
  return {
    ...parsed,
    _generatedBy: 'gpt-4o-mini',
    _promptVersion: 'cold-v1',
    _tokensUsed: completion.usage?.total_tokens || 0
  };
}

module.exports = { generateOne, buildPrompt, STATE_STYLE_OVERRIDES, GENERIC_STYLE, QUESTION_TYPE_PROMPTS };
