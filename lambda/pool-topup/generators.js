/**
 * Question generator for pool-topup Lambda.
 * Uses fetch (no openai npm dep) to keep zip small.
 * apiKey is read from process.env.OPENAI_API_KEY (set by handler).
 */

const STATE_PROMPTS = {
  texas: { testName: 'STAAR', standards: 'Texas Essential Knowledge and Skills (TEKS)', authority: 'Texas Education Agency (TEA)', style: 'Texas STAAR favors word problems with real-world contexts. 4-choice multiple choice. Rigor matches TEA released items.' },
  california: { testName: 'CAASPP / Smarter Balanced', standards: 'California Common Core State Standards', authority: 'California Department of Education', style: 'CAASPP uses computer-adaptive testing; Smarter Balanced format.' },
  florida: { testName: 'FAST', standards: 'Florida B.E.S.T. Standards', authority: 'Florida Department of Education', style: 'FAST uses three progress-monitoring windows. B.E.S.T. format.' },
  'new-york': { testName: 'New York State Tests', standards: 'Next Generation Learning Standards (NGLS)', authority: 'New York State Education Department', style: 'Multi-step reasoning and academic vocabulary.' }
};

const QUESTION_TYPE_PROMPTS = {
  math: {
    'word-problem': 'A real-world word problem requiring 1-3 steps.',
    'computation': 'Direct computation. Tests fluency with operations or algebra concepts as grade-appropriate.',
    'concept': 'Conceptual understanding. Tests "why" or "what" rather than "how".',
    'data-interpretation': 'Question with a small data set. Asks the student to read or analyze the data.'
  },
  reading: {
    'main-idea': 'Reading passage with a question asking for the main idea.',
    'key-detail': 'Reading passage with a question about a specific detail.',
    'vocabulary': 'Reading passage with a question asking the meaning of a word as used in the passage.',
    'inference': 'Reading passage requiring the student to infer something not directly stated.',
    'author-purpose': 'Reading passage with a question about why the author wrote the text.',
    'text-structure': 'Reading passage with a question about how the text is organized.'
  }
};

function gradeReadable(grade) {
  if (grade === 'grade-k') return 'kindergarten';
  if (grade === 'algebra-1') return 'Algebra 1 (high school)';
  if (grade === 'geometry') return 'Geometry (high school)';
  return `grade ${grade.replace('grade-', '')}`;
}

function buildPrompt({ stateSlug, grade, subject, questionType }) {
  const state = STATE_PROMPTS[stateSlug] || STATE_PROMPTS.texas;
  const typeGuide = QUESTION_TYPE_PROMPTS[subject]?.[questionType] || '';
  const grLabel = gradeReadable(grade);
  const earlyGrades = ['grade-k', 'grade-1', 'grade-2'];
  const earlyHint = earlyGrades.includes(grade) ? `

CRITICAL FOR EARLY GRADES:
- Vocabulary at or below the kid's reading level. Avoid "represents", "approximately", "expression". Use "shows", "about", "math sentence".
- Grade K: counting 0-20, shapes, simple addition/subtraction within 10.
- Grade 1: addition/subtraction within 20, place value (tens and ones).
- Grade 2: addition/subtraction within 100, place value (hundreds), simple multiplication.
- Word problems use concrete kid-relatable scenarios: cookies, blocks, animals, family.
- Keep four answer choices similar in magnitude so wrong answers reflect real misconceptions.` : '';

  if (subject === 'math') {
    return `You are an expert ${state.testName} math item writer.${earlyHint}

Generate ONE multiple-choice math question for ${grLabel} students preparing for the ${state.testName}.

Standards: align to ${state.standards} for ${grLabel}.
Authority: ${state.authority}.
Style: ${state.style}

Question type: ${questionType}. ${typeGuide}

Requirements:
- Exactly 4 answer choices.
- Exactly one correct answer.
- Distractors should reflect common student misconceptions.
- Question stem and choices clear, age-appropriate.
- Explanation references the correct answer and shows reasoning.
- Diverse student names. Realistic numbers for the grade.

Output ONLY valid JSON:
{
  "question": "...",
  "choices": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "..."
}`;
  }

  const wcRange = ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5'].includes(grade) ? '80-180 words' : '150-300 words';
  return `You are an expert ${state.testName} reading item writer.

Generate ONE reading passage and ONE multiple-choice comprehension question for ${grLabel} students.

Standards: align to ${state.standards} for ${grLabel}.
Authority: ${state.authority}.

Passage: ${wcRange}. Rotate fiction, nonfiction, poetry, informational. Avoid current events.

Question type: ${questionType}. ${typeGuide}

Requirements:
- Question answerable from the passage only.
- Distractors plausible but clearly wrong on careful reading.
- Explanation cites specific evidence in the passage.

Output ONLY valid JSON:
{
  "passage": { "title": "...", "text": "...", "type": "fiction" },
  "question": "...",
  "choices": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "..."
}`;
}

async function generateOne({ stateSlug, grade, subject, questionType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const systemPrompt = buildPrompt({ stateSlug, grade, subject, questionType });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate the question now.' }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.9,
      max_tokens: 1200
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices[0].message.content;
  const parsed = JSON.parse(text);
  return {
    ...parsed,
    _generatedBy: 'gpt-4o-mini',
    _promptVersion: 'cold-v1',
    _tokensUsed: data.usage?.total_tokens || 0
  };
}

module.exports = { generateOne, buildPrompt, STATE_PROMPTS, QUESTION_TYPE_PROMPTS };
