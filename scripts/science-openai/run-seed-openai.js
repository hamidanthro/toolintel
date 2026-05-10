#!/usr/bin/env node
/**
 * Texas STAAR Grade 8 science seed batch — OpenAI-only pipeline.
 *
 * Mirrors scripts/social-studies/run-seed-openai.js (which itself
 * mirrors the reading pipeline). Generates a "scenario" stimulus +
 * 5 cluster questions per brief using gpt-4o for both stages.
 *
 * The Phase E-J Claude pipeline at scripts/science/ is the
 * cross-vendor verifier+judge gold-standard path; this OpenAI fork
 * is the "ship now" path while Anthropic billing is being topped up.
 * Quality bar: lower than Claude verifier+judge but acceptable v1
 * for a STAAR-tested grade currently sitting at 0 content.
 *
 * Targets TEKS §112.28 (Grade 8): Matter & Energy, Force/Motion/
 * Energy, Earth & Space, Organisms & Environments. Each brief maps
 * to ONE Readiness or Supporting SE per CLAUDE.md §38 KP.
 *
 * Usage:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/science-openai/run-seed-openai.js [--brief-id <id>] [--write]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE = 'texas';
const GRADE = '8';
const SUBJECT = 'science';
const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 90000;

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.resolve(__dirname, 'output');

// Texas Grade 8 science briefs covering TEKS §112.28 strands.
// Each brief maps to ONE SE (Readiness or Supporting). Mix of
// experiment, data_analysis, and described_diagram scenario types.
const BRIEFS = [
  // ----- Matter & Energy -----
  { id: 'g8s-conservation-mass-photosynthesis', strand: 'Matter & Energy',
    se: '8.6E', scenarioType: 'experiment',
    topic: 'students measure the mass of a closed terrarium with plants over four weeks; the question asks the student to identify what happens to the total mass and why (atoms rearrange in photosynthesis, mass is conserved)' },

  // ----- Force, Motion & Energy -----
  { id: 'g8s-newton-second-law-cart', strand: 'Force, Motion & Energy',
    se: '8.7A', scenarioType: 'experiment',
    topic: 'students push a 2 kg cart, then a 4 kg cart, with the same applied force across a smooth lab floor; the question asks the student to calculate or compare acceleration using a = F/m' },
  { id: 'g8s-newton-three-laws-rocket', strand: 'Force, Motion & Energy',
    se: '8.7B', scenarioType: 'described_diagram',
    topic: 'a description of a model rocket launch — fuel ignites, exhaust shoots downward, rocket lifts upward; the question asks the student to identify which of Newtons three laws explains the motion' },
  { id: 'g8s-em-spectrum-waves', strand: 'Force, Motion & Energy',
    se: '8.8A', scenarioType: 'data_analysis',
    topic: 'a chart of four electromagnetic waves (radio, visible light, X-ray, gamma) with their wavelengths in scientific notation; the question asks the student to identify which has the highest frequency and why' },

  // ----- Earth & Space -----
  { id: 'g8s-hr-diagram-star-life', strand: 'Earth & Space',
    se: '8.9A', scenarioType: 'described_diagram',
    topic: 'a description of the Hertzsprung-Russell diagram showing main sequence, red giants, white dwarfs; the question asks the student to identify which life-cycle stage a Sun-like star is currently in and where it goes next' },
  { id: 'g8s-galaxy-types-milky-way', strand: 'Earth & Space',
    se: '8.9B', scenarioType: 'described_diagram',
    topic: 'a description of three galaxy types (spiral, elliptical, irregular) with their general shapes; the question asks the student to identify which type the Milky Way is and where the solar system sits within it' },
  { id: 'g8s-sun-hydrosphere-weather', strand: 'Earth & Space',
    se: '8.10A', scenarioType: 'experiment',
    topic: 'students model the water cycle in a sealed container with a heat lamp; the question asks the student to identify how the Sun, hydrosphere, and atmosphere together drive weather (energy transfer, evaporation, condensation)' },
  { id: 'g8s-global-atmospheric-circulation', strand: 'Earth & Space',
    se: '8.10B', scenarioType: 'data_analysis',
    topic: 'a global wind-pattern map showing trade winds, westerlies, and polar easterlies; the question asks the student to identify which pattern brings most weather across Texas and why' },
  { id: 'g8s-tropical-cyclones-formation', strand: 'Earth & Space',
    se: '8.10C', scenarioType: 'described_diagram',
    topic: 'a description of warm Gulf of Mexico water (over 80°F) meeting moist air over the ocean during late summer; the question asks the student to identify the conditions that allow a tropical cyclone to form and intensify' },

  // ----- Organisms & Environments -----
  { id: 'g8s-ecological-succession-fire', strand: 'Organisms & Environments',
    se: '8.12B', scenarioType: 'data_analysis',
    topic: 'a Texas Hill Country area three years after a wildfire — grasses, shrubs, then juniper and oak returning over time; the question asks the student to identify whether this is primary or secondary succession and why' },
  { id: 'g8s-biodiversity-ecosystem-stability', strand: 'Organisms & Environments',
    se: '8.12C', scenarioType: 'data_analysis',
    topic: 'a comparison of two Texas grassland plots — one with 12 native species, one monoculture invaded by a single grass; the question asks the student to identify which plot is more stable when drought hits and why' },
  { id: 'g8s-cell-organelles-function', strand: 'Organisms & Environments',
    se: '8.13A', scenarioType: 'described_diagram',
    topic: 'a description of an animal cell labeled with cell membrane, nucleus, ribosomes, cytoplasm, and mitochondria; the question asks the student to identify which organelle is responsible for converting glucose into usable energy (ATP)' },
  { id: 'g8s-genes-inherited-traits', strand: 'Organisms & Environments',
    se: '8.13B', scenarioType: 'described_diagram',
    topic: 'a description of a gene as a section of DNA on a chromosome that codes for a single trait; the question asks the student to identify which inherited trait (from a list including learned skills) genes can determine and which cannot' },
  { id: 'g8s-trait-variation-adaptation', strand: 'Organisms & Environments',
    se: '8.13C', scenarioType: 'data_analysis',
    topic: 'data showing a Texas snake population over 20 years where lighter-colored snakes survive better in a brighter habitat; the question asks the student to identify how trait variation leads to differential reproductive success over generations' }
];

let _ddbClient = null, _PutCommand = null, _ScanCommand = null;
function getDdb() {
  if (_ddbClient) return { ddb: _ddbClient, PutCommand: _PutCommand, ScanCommand: _ScanCommand };
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const lib = require('@aws-sdk/lib-dynamodb');
  _PutCommand = lib.PutCommand;
  _ScanCommand = lib.ScanCommand;
  _ddbClient = lib.DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  return { ddb: _ddbClient, PutCommand: _PutCommand, ScanCommand: _ScanCommand };
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
        temperature: (opts && typeof opts.temperature === 'number') ? opts.temperature : 0.6,
        max_tokens: (opts && opts.max_tokens) || 2200
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

function buildScenarioSystem() {
  return `You write science-stimulus scenarios for a Texas STAAR Grade 8 science practice app. Texas STAAR Grade 8 science is tested under TEKS §112.28, covering Matter & Energy, Force/Motion/Energy, Earth & Space, and Organisms & Environments.

== Audience ==
13-14-year-old students. Vocabulary at grade-8 science level. Real STAAR Grade 8 stimulus passages cluster around 80-180 words plus a labeled visual (we generate text only — no images, but you can verbally describe the setup as if a kid were reading the passage and then looking at a photo or diagram).

== Output format (STRICT JSON) ==

{
  "title": "Short scenario title",
  "body": "## Title\\n\\nFirst paragraph of the experiment / data table description / diagram description.\\n\\n(optional second paragraph)",
  "topicNotes": "1-line internal note on the SE addressed"
}

== Body format ==
- Markdown. Open with "## " + title. 1-3 paragraphs.
- 80-180 words total. Real STAAR stimulus length.
- For experiments: describe the setup in plain language ("students place X on Y and measure Z").
- For data analysis: describe the data table or graph in words ("the table shows three trials...").
- For described diagrams: describe the diagram in words ("the diagram shows a labeled animal cell with...").
- DO NOT include images, HTML tags, or inline paragraph numbers.

== Strict-pass requirements ==
- Stay within Texas TEKS §112.28 Grade 8 scope.
- Names of scientific concepts should be accurate.
- Numbers should be physically realistic (e.g. tropical cyclone wind speeds in the 75+ mph range).
- The scenario must support a multiple-choice question that tests the SE listed in the brief.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildScenarioUser(brief) {
  return `Generate ONE science scenario for Texas STAAR Grade 8.

TEKS SE: ${brief.se}
Strand: ${brief.strand}
Scenario type: ${brief.scenarioType}
Topic: ${brief.topic}

Match the 80-180 word target. Apply ALL rules. Return strict JSON.`;
}

function buildQuestionsSystem() {
  return `You write multiple-choice science questions for a Texas STAAR Grade 8 practice app, given a scenario stimulus. Questions test:
- Direct application of the SE concept
- Data interpretation from the scenario
- Cause-effect within the scientific phenomenon
- Predicting what would happen if a variable changes

Output STRICT JSON:

{
  "questions": [
    {
      "stem": "Question text",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 2,
      "explanation": "Brief: cite specific scenario evidence + scientific reasoning. 1-2 sentences.",
      "questionType": "concept-application | data-interpretation | cause-effect | prediction"
    }
  ]
}

Rules (LOCKED):
- Exactly 5 questions per scenario.
- Mix question types — at least 3 distinct types across the 5.
- Exactly 4 choices each, one correct.
- Distractors plausible — common misconceptions or partially-true statements.
- Question must be answerable from the scenario + grade-8 science knowledge.
- Explanation cites specific scenario evidence ("the chart shows X, which means Y").
- AT LEAST ONE distractor per question reflects a documented misconception (CLAUDE.md §38 KP).

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildQuestionsUser(scenario) {
  return `Generate 5 science questions for the scenario below.

Title: ${scenario.title}

Scenario:
${scenario.body}

Return strict JSON.`;
}

function nowIso() { return new Date().toISOString(); }
function shortId() { return crypto.randomBytes(6).toString('hex'); }
function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

async function processBrief(brief, opts, apiKey) {
  console.log(`\n=== ${brief.id} (${brief.strand} · ${brief.se}) ===`);
  console.log(`topic: ${brief.topic.slice(0, 80)}${brief.topic.length > 80 ? '…' : ''}`);

  // Stage 1: scenario
  console.log('  ⏳ generating scenario…');
  const sSys = buildScenarioSystem();
  const sUser = buildScenarioUser(brief);
  let scenarioRaw;
  try {
    const resp = await callOpenAI(sSys, sUser, apiKey, { temperature: 0.6, max_tokens: 1200 });
    scenarioRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ scenario gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'scenario', error: err.message };
  }
  let scenarioJson;
  try { scenarioJson = JSON.parse(scenarioRaw); }
  catch (err) {
    console.error(`  ✗ scenario non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'scenario-parse', error: err.message };
  }
  const title = String(scenarioJson.title || '').trim();
  const body = String(scenarioJson.body || '').trim();
  if (!title || !body) {
    console.error('  ✗ scenario missing title or body');
    return { ok: false, brief, stage: 'scenario-empty' };
  }
  const wordCount = (body.match(/\S+/g) || []).length;
  console.log(`  ✓ scenario: "${title}" — ${wordCount}w`);
  if (wordCount < 60 || wordCount > 250) {
    console.warn(`  ⚠ word-count ${wordCount} outside target 60-250 (proceeding anyway)`);
  }

  // Stage 2: questions
  console.log('  ⏳ generating 5 questions…');
  const qSys = buildQuestionsSystem();
  const qUser = buildQuestionsUser({ title, body });
  let questionsRaw;
  try {
    const resp = await callOpenAI(qSys, qUser, apiKey, { temperature: 0.5, max_tokens: 2400 });
    questionsRaw = resp.choices[0].message.content;
  } catch (err) {
    console.error(`  ✗ questions gen failed: ${err.message.slice(0, 120)}`);
    return { ok: false, brief, stage: 'questions', error: err.message };
  }
  let questionsJson;
  try { questionsJson = JSON.parse(questionsRaw); }
  catch (err) {
    console.error(`  ✗ questions non-JSON: ${err.message.slice(0, 80)}`);
    return { ok: false, brief, stage: 'questions-parse', error: err.message };
  }
  const qs = Array.isArray(questionsJson.questions) ? questionsJson.questions : [];
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

  // Build records. Match the science schema established in Phase J:
  // stateGradeGenre uses '_science_scenario' suffix so the lambda's
  // existing handleGetScienceItem queries find these passages.
  const passageId = `p_tx_${GRADE}_sci_${shortId()}`;
  const stateGradeGenre = `${STATE}_${GRADE}_${SUBJECT}_scenario`;
  const passageRow = {
    passageId,
    state: STATE,
    grade: GRADE,
    subject: SUBJECT,
    scenarioType: brief.scenarioType,
    stateGradeGenre,
    title,
    body,
    topic: brief.topic,
    topicNotes: String(scenarioJson.topicNotes || '').slice(0, 200),
    strand: brief.strand,
    targetTeks: brief.se,
    wordCount,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'science-openai-v1',
    _briefId: brief.id
  };

  const poolKey = `${STATE}#${GRADE}#${SUBJECT}#${passageId}`;
  const questionRows = validQs.map((q, idx) => ({
    poolKey,
    contentId: `q_${shortId()}_${idx}`,
    state: STATE,
    grade: GRADE,
    subject: SUBJECT,
    type: 'multiple_choice',
    questionType: q.questionType || 'unknown',
    question: q.stem,
    choices: q.choices,
    correctIndex: q.correctIndex,
    answer: q.choices[q.correctIndex],
    explanation: q.explanation,
    passageId,
    strand: brief.strand,
    claimedTeks: brief.se,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'science-openai-v1',
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

  let briefs = BRIEFS.slice();
  if (opts.briefId) briefs = briefs.filter(b => b.id === opts.briefId);
  if (!briefs.length) {
    console.error(`No briefs matched --brief-id=${opts.briefId || '(unset)'}`);
    process.exit(1);
  }

  // Idempotency
  if (!opts.dryRun) {
    try {
      const { ddb, ScanCommand } = getDdb();
      const briefIdSet = new Set(briefs.map(b => b.id));
      const scanned = [];
      let last;
      do {
        const r = await ddb.send(new ScanCommand({
          TableName: PASSAGES_TABLE,
          FilterExpression: 'attribute_exists(#bid)',
          ExpressionAttributeNames: { '#bid': '_briefId' },
          ProjectionExpression: '#bid',
          ExclusiveStartKey: last
        }));
        for (const it of (r.Items || [])) if (it._briefId) scanned.push(it._briefId);
        last = r.LastEvaluatedKey;
      } while (last);
      const alreadyRun = new Set(scanned.filter(id => briefIdSet.has(id)));
      if (alreadyRun.size > 0) {
        console.log(`[idempotency] ${alreadyRun.size} brief(s) already in DDB, skipping: ${[...alreadyRun].join(', ')}`);
        briefs = briefs.filter(b => !alreadyRun.has(b.id));
      }
      if (briefs.length === 0) {
        console.log('[idempotency] All requested briefs already exist. Nothing to do.');
        return;
      }
    } catch (err) {
      console.warn('[idempotency] check failed (proceeding anyway):', err.message);
    }
  }

  ensureOutputDir();
  const startedAt = nowIso();
  const runId = startedAt.replace(/[:.]/g, '-');
  console.log(`[science-openai] runId=${runId} mode=${opts.dryRun ? 'dry-run' : 'WRITE'} briefs=${briefs.length}`);

  const results = [];
  for (const brief of briefs) {
    const r = await processBrief(brief, opts, apiKey);
    results.push(r);
    if (r.ok && !opts.dryRun) {
      try {
        await persist(r.passageRow, r.questionRows);
        console.log(`  ✓ persisted: scenario ${r.passageRow.passageId} + ${r.questionRows.length} questions`);
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

  const outPath = path.join(OUTPUT_DIR, `science-openai-${runId}.json`);
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
