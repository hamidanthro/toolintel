/**
 * Cold-start question generator (I2).
 * State-aware prompt builder + single-question generator.
 */
const { getOpenAI } = require('./lake-client');

const STATE_PROMPTS = {
  texas: {
    testName: 'STAAR',
    standards: 'Texas Essential Knowledge and Skills (TEKS)',
    authority: 'Texas Education Agency (TEA)',
    style: 'Texas STAAR favors word problems with real-world contexts (Texas geography, Hispanic cultural contexts welcome, school-and-family scenarios). Math: 4-choice multiple choice. Rigor matches TEA released items.'
  },
  california: {
    testName: 'CAASPP / Smarter Balanced',
    standards: 'California Common Core State Standards',
    authority: 'California Department of Education',
    style: 'CAASPP uses computer-adaptive testing; questions follow Smarter Balanced format. Multi-step reasoning is common.'
  },
  florida: {
    testName: 'FAST',
    standards: 'Florida B.E.S.T. Standards',
    authority: 'Florida Department of Education',
    style: 'FAST uses three progress-monitoring windows. Questions match B.E.S.T. format which moved away from Common Core.'
  },
  'new-york': {
    testName: 'New York State Tests',
    standards: 'Next Generation Learning Standards (NGLS)',
    authority: 'New York State Education Department',
    style: 'NY uses paper and computer-based testing. Multi-step reasoning and academic vocabulary expected.'
  }
};

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
  return `grade ${grade.replace('grade-', '')}`;
}

function buildPrompt({ stateSlug, grade, subject, questionType }) {
  const state = STATE_PROMPTS[stateSlug] || STATE_PROMPTS.texas;
  const typeGuide = QUESTION_TYPE_PROMPTS[subject]?.[questionType] || '';
  const grLabel = gradeReadable(grade);

  if (subject === 'math') {
    return `You are an expert ${state.testName} math item writer.

Generate ONE multiple-choice math question for ${grLabel} students preparing for the ${state.testName}.

Standards: align to ${state.standards} for ${grLabel}.
Authority: ${state.authority}.
Style: ${state.style}

Question type: ${questionType}. ${typeGuide}

Requirements:
- Exactly 4 answer choices.
- Exactly one correct answer.
- Distractors should reflect common student misconceptions, not random wrong answers.
- Question stem and choices clear, unambiguous, age-appropriate.
- Explanation references the correct answer and shows the reasoning a student should follow.
- Use diverse student names from many cultures.
- Numbers must be realistic for the grade. Show no negative numbers below grade 6.

Output ONLY valid JSON, no preamble:
{
  "question": "...",
  "choices": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "..."
}`;
  }

  if (subject === 'reading') {
    const wcRange = ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5'].includes(grade) ? '80-180 words' : '150-300 words';
    return `You are an expert ${state.testName} reading item writer.

Generate ONE reading passage and ONE multiple-choice comprehension question for ${grLabel} students.

Standards: align to ${state.standards} for ${grLabel}.
Authority: ${state.authority}.

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

Output ONLY valid JSON, no preamble:
{
  "passage": { "title": "...", "text": "...", "type": "fiction" },
  "question": "...",
  "choices": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "..."
}`;
  }

  throw new Error(`Unsupported subject for cold-start: ${subject}`);
}

async function generateOne({ stateSlug, grade, subject, questionType }) {
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

module.exports = { generateOne, buildPrompt, STATE_PROMPTS, QUESTION_TYPE_PROMPTS };
