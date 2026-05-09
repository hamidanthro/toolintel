#!/usr/bin/env node
/**
 * Texas Grade 3 reading seed batch — OpenAI-only pipeline.
 *
 * Single-file fork of the Claude-based scripts/reading/* pipeline.
 * Uses gpt-4o for both passage generation and question generation.
 * No separate judge stage in v1 — OpenAI generates + we light-validate
 * locally + save. Lower quality bar than the cross-vendor pipeline,
 * acceptable while Anthropic billing is being topped up.
 *
 * Usage:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/reading/run-seed-openai.js [--brief-id <id>] [--write]
 *
 * Default: dry-run (prints generated content + would-save target,
 * does NOT touch DDB). Pass --write to actually persist.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { loadKP } = require('./lib/load-kp');
const { getReadabilityReport } = require('./lib/readability');

const STATE = 'texas';
const GRADE = '3';
const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 90000;

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.resolve(__dirname, 'output');

// 6 hand-curated Texas Grade 3 reading briefs. Mix of realistic-fiction
// + informational; all kid-grounded, Texas-rooted, §9-clean.
const BRIEFS = [
  {
    id: 'g3-rf-bluebonnets-spring',
    genre: 'realistic-fiction',
    topic: 'a kid notices the first bluebonnets of spring on a family drive and decides to keep a wildflower journal',
    setting: 'Hill Country highway between Austin and Fredericksburg',
    protagonistName: 'Lucia',
    protagonistDemographic: 'hispanic-latino'
  },
  {
    id: 'g3-rf-rio-grande-fishing',
    genre: 'realistic-fiction',
    topic: 'a kid goes fishing with grandparent on the Rio Grande for the first time and learns to be patient',
    setting: 'McAllen area along the Rio Grande',
    protagonistName: 'Mateo',
    protagonistDemographic: 'hispanic-latino'
  },
  {
    id: 'g3-rf-galveston-seawall',
    genre: 'realistic-fiction',
    topic: 'a kid spots a baby sea turtle nest on Galveston Beach and helps a volunteer protect it',
    setting: 'Galveston Island',
    protagonistName: 'Jamal',
    protagonistDemographic: 'black'
  },
  {
    id: 'g3-info-armadillos',
    genre: 'informational',
    topic: 'why nine-banded armadillos are so common in Texas — what they eat, where they live, why they roll up',
    setting: null,
    protagonistName: null,
    protagonistDemographic: 'unmarked'
  },
  {
    id: 'g3-info-staar-bats',
    genre: 'informational',
    topic: 'the Mexican free-tailed bats that fly out from the Congress Avenue Bridge in Austin every summer evening',
    setting: null,
    protagonistName: null,
    protagonistDemographic: 'unmarked'
  },
  {
    id: 'g3-info-pecan-state-tree',
    genre: 'informational',
    topic: 'how the pecan tree became the Texas state tree and why pecans are part of Texas family traditions',
    setting: null,
    protagonistName: null,
    protagonistDemographic: 'unmarked'
  }
];

let _ddbClient = null, _PutCommand = null, _DocClient = null;
function getDdb() {
  if (_ddbClient) return { ddb: _ddbClient, PutCommand: _PutCommand };
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const lib = require('@aws-sdk/lib-dynamodb');
  _DocClient = lib.DynamoDBDocumentClient;
  _PutCommand = lib.PutCommand;
  _ddbClient = _DocClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  return { ddb: _ddbClient, PutCommand: _PutCommand };
}

function parseArgs(argv) {
  const opts = { dryRun: true, briefId: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--write') opts.dryRun = false;
    else if (argv[i] === '--brief-id') opts.briefId = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: run-seed-openai.js [--brief-id <id>] [--write]');
      process.exit(0);
    }
  }
  return opts;
}

async function callOpenAI(systemPrompt, userMessage, apiKey, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.7,
        max_tokens: (opts && opts.max_tokens) || 2400
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

function buildPassageSystem() {
  const kp = loadKP();
  const sec = kp.sections;
  return `You are a children's reading-passage writer for a Texas STAAR grade-3 practice app. You write passages that match what a kid would see on the actual STAAR test: kid-readable (Flesch-Kincaid 2.8-4.2), factually grounded, Texas-rooted often but not always, and free of landmines.

== KP §2 — Passage characteristics ==
${sec.passageCharacteristics || ''}

== KP §6 — Texas cultural priorities ==
${sec.culturalPriorities || ''}

== KP §7 — AI-generation landmines ==
${sec.landmines || ''}

== KP §8 — Reading levels ==
${sec.readingLevels || ''}

== KP §9 — No-no list (STRICT) ==
${sec.noNoList || ''}

== Output format (STRICT JSON) ==

{
  "title": "Short imaginative or topic-direct title",
  "body": "## Title\\n\\nFirst paragraph...\\n\\nSecond paragraph...\\n\\n...",
  "topicNotes": "1-line internal note on the topic chosen"
}

== Body format ==
- Markdown. Open with "## " + title. Each paragraph separated by single blank line.
- 220-380 words for realistic-fiction; 280-450 words for informational.
- Use **bold** sparingly for Tier-3 vocabulary (informational only).
- DO NOT include images, HTML tags, or inline paragraph numbers.

== Strict-pass requirements ==
- §9 violations are STRICT — no death, romance, divorce, drugs, religion-as-theology, politics, violence, bullying-as-plot, mental-illness, disability-as-deficit, brand names, or current real public figures.
- §6 generator naming rule: protagonist's name should NOT match the obvious cultural-fit plot.
- Sibling conflict OK if resolved in-passage. Weather events OK if no character is hurt.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildPassageUser(brief) {
  const genreLabel = brief.genre === 'realistic-fiction' ? 'Realistic fiction' : 'Informational';
  const protagonistLine = brief.protagonistName
    ? `Protagonist: ${brief.protagonistName} (${brief.protagonistDemographic || 'unspecified'})`
    : `Protagonist: demographically unmarked (no named protagonist)`;
  return `Generate ONE passage.

Genre: ${genreLabel}
Topic: ${brief.topic}
Setting: ${brief.setting || '(your choice — pick a Texas city or specific elsewhere)'}
${protagonistLine}

Match KP §2 word-count band for this genre, KP §8 readability target, and obey ALL §6/§7/§9 rules. Return strict JSON.`;
}

function buildQuestionsSystem() {
  return `You write reading-comprehension multiple-choice questions for a Texas STAAR grade-3 practice app, given a passage. STAAR grade-3 reading questions test: main idea, key detail, vocabulary-in-context, inference, and author's purpose.

Output STRICT JSON:

{
  "questions": [
    {
      "stem": "Question text",
      "choices": ["A choice", "B choice", "C choice", "D choice"],
      "correctIndex": 2,
      "explanation": "Brief: cite specific evidence in the passage. 1-2 sentences.",
      "questionType": "main-idea | key-detail | vocabulary | inference | author-purpose"
    }
  ]
}

Rules (LOCKED):
- Exactly 5 questions per passage.
- Mix question types — at least 3 distinct types across the 5.
- Exactly 4 choices each, one correct.
- Distractors plausible but clearly wrong on careful reading of the passage.
- Question must be answerable from the passage only — no outside knowledge.
- For vocabulary questions, name the word clearly: "What does the word ___ mean as it is used in paragraph N?"
- Explanation cites SPECIFIC passage evidence (e.g. "paragraph 3, the sentence about...").
- NO §9 landmines (no death, no current real public figures, etc.).

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildQuestionsUser(passage) {
  return `Generate 5 reading-comprehension questions for the passage below.

Title: ${passage.title}

Passage:
${passage.body}

Return strict JSON.`;
}

function nowIso() { return new Date().toISOString(); }
function shortId() { return crypto.randomBytes(6).toString('hex'); }
function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

async function processBrief(brief, opts, apiKey) {
  console.log(`\n=== ${brief.id} (${brief.genre}) ===`);
  console.log(`topic: ${brief.topic.slice(0, 80)}${brief.topic.length > 80 ? '…' : ''}`);

  // Stage 1: passage
  console.log('  ⏳ generating passage…');
  const pSys = buildPassageSystem();
  const pUser = buildPassageUser(brief);
  let passageRaw;
  try {
    const resp = await callOpenAI(pSys, pUser, apiKey, { temperature: 0.7, max_tokens: 1600 });
    passageRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ passage gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'passage', error: err.message };
  }
  let passageJson;
  try { passageJson = JSON.parse(passageRaw); }
  catch (err) {
    console.error(`  ✗ passage non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'passage-parse', error: err.message };
  }
  const title = String(passageJson.title || '').trim();
  const body = String(passageJson.body || '').trim();
  if (!title || !body) {
    console.error('  ✗ passage missing title or body');
    return { ok: false, brief, stage: 'passage-empty' };
  }
  const report = getReadabilityReport(body);
  console.log(`  ✓ passage: "${title}" — ${report.wordCount}w, FK=${report.fkGrade.toFixed(1)}, lex≈${report.lexileEstimate}`);

  // Light validation
  const targetMin = brief.genre === 'realistic-fiction' ? 200 : 260;
  const targetMax = brief.genre === 'realistic-fiction' ? 420 : 480;
  if (report.wordCount < targetMin || report.wordCount > targetMax) {
    console.warn(`  ⚠ word-count ${report.wordCount} outside target ${targetMin}-${targetMax} (proceeding anyway)`);
  }
  if (report.fkGrade < 2.5 || report.fkGrade > 4.5) {
    console.warn(`  ⚠ FK grade ${report.fkGrade.toFixed(1)} outside 2.5-4.5 (proceeding anyway)`);
  }

  // Stage 2: questions
  console.log('  ⏳ generating 5 questions…');
  const qSys = buildQuestionsSystem();
  const qUser = buildQuestionsUser({ title, body });
  let questionsRaw;
  try {
    const resp = await callOpenAI(qSys, qUser, apiKey, { temperature: 0.6, max_tokens: 2400 });
    questionsRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ questions gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'questions', error: err.message, passage: { title, body } };
  }
  let questionsJson;
  try { questionsJson = JSON.parse(questionsRaw); }
  catch (err) {
    console.error(`  ✗ questions non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'questions-parse', error: err.message };
  }
  const qs = Array.isArray(questionsJson.questions) ? questionsJson.questions : [];
  if (qs.length < 4) {
    console.error(`  ✗ only ${qs.length} questions returned (need 4-5)`);
    return { ok: false, brief, stage: 'questions-short' };
  }
  // Schema validate each
  const validQs = [];
  for (const q of qs.slice(0, 5)) {
    if (!q || typeof q.stem !== 'string' || !Array.isArray(q.choices) || q.choices.length !== 4) continue;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) continue;
    if (typeof q.explanation !== 'string') continue;
    validQs.push(q);
  }
  if (validQs.length < 4) {
    console.error(`  ✗ only ${validQs.length} schema-valid questions`);
    return { ok: false, brief, stage: 'questions-invalid' };
  }
  console.log(`  ✓ ${validQs.length} valid questions generated`);
  validQs.forEach((q, i) => {
    console.log(`     ${i + 1}. [${q.questionType || '?'}] ${q.stem.slice(0, 80)}…`);
  });

  // Build the records
  const passageId = `p_tx_${GRADE}_${brief.genre.replace('realistic-fiction', 'rf').replace('informational', 'info')}_${shortId()}`;
  const stateGradeGenre = `${STATE}_${GRADE}_${brief.genre}`;
  const passageRow = {
    passageId,
    state: STATE,
    grade: GRADE,
    genre: brief.genre,
    stateGradeGenre,
    title,
    body,
    topic: brief.topic,
    topicNotes: String(passageJson.topicNotes || '').slice(0, 200),
    setting: brief.setting,
    protagonistName: brief.protagonistName,
    protagonistDemographic: brief.protagonistDemographic || 'unmarked',
    wordCount: report.wordCount,
    paragraphCount: report.paragraphCount,
    fkGrade: report.fkGrade,
    lexileEstimate: report.lexileEstimate,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'reading-openai-v1',
    _kpVersion: loadKP().version || 'unknown',
    _briefId: brief.id
  };

  const poolKey = `${STATE}#${GRADE}#reading#${passageId}`;
  const questionRows = validQs.map((q, idx) => ({
    poolKey,
    contentId: `q_${shortId()}_${idx}`,
    state: STATE,
    grade: GRADE,
    subject: 'reading',
    type: 'multiple_choice',
    questionType: q.questionType || 'unknown',
    question: q.stem,
    choices: q.choices,
    correctIndex: q.correctIndex,
    answer: q.choices[q.correctIndex],
    explanation: q.explanation,
    passageId,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'reading-openai-v1',
    _briefId: brief.id
  }));

  return { ok: true, brief, passageRow, questionRows };
}

async function persist(passageRow, questionRows) {
  const { ddb, PutCommand } = getDdb();
  await ddb.send(new PutCommand({ TableName: PASSAGES_TABLE, Item: passageRow }));
  for (const q of questionRows) {
    await ddb.send(new PutCommand({ TableName: POOL_TABLE, Item: q }));
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

  const briefs = opts.briefId ? BRIEFS.filter(b => b.id === opts.briefId) : BRIEFS.slice();
  if (!briefs.length) {
    console.error(`No briefs matched --brief-id=${opts.briefId || '(unset)'}`);
    process.exit(1);
  }

  ensureOutputDir();
  const startedAt = nowIso();
  const runId = startedAt.replace(/[:.]/g, '-');
  console.log(`[reading-openai] runId=${runId} mode=${opts.dryRun ? 'dry-run' : 'WRITE'} briefs=${briefs.length}`);

  const results = [];
  for (const brief of briefs) {
    const r = await processBrief(brief, opts, apiKey);
    results.push(r);
    if (r.ok && !opts.dryRun) {
      try {
        await persist(r.passageRow, r.questionRows);
        console.log(`  ✓ persisted: passage ${r.passageRow.passageId} + ${r.questionRows.length} questions`);
      } catch (err) {
        console.error(`  ✗ persist failed: ${err.message.slice(0, 200)}`);
        r.persistError = err.message;
      }
    }
  }

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Briefs attempted: ${results.length}`);
  console.log(`Passed: ${ok.length}`);
  console.log(`Failed: ${failed.length}`);
  for (const r of failed) {
    console.log(`  FAIL ${r.brief.id} @${r.stage}: ${(r.error || '').slice(0, 80)}`);
  }
  console.log(`Mode: ${opts.dryRun ? 'DRY-RUN (no DDB writes)' : 'WRITE (persisted)'}`);

  const outPath = path.join(OUTPUT_DIR, `reading-openai-${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    runId, startedAt, mode: opts.dryRun ? 'dry-run' : 'write',
    briefsAttempted: results.length, passed: ok.length, failed: failed.length,
    results
  }, null, 2));
  console.log(`Output: ${outPath}`);

  process.exit(ok.length === results.length ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
