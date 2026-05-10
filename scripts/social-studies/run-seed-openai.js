#!/usr/bin/env node
/**
 * Texas Grade 8 social studies seed batch — OpenAI-only pipeline.
 *
 * Mirrors scripts/reading/run-seed-openai.js but for STAAR Grade 8
 * social studies (TEKS §113.20). Texas tests social studies at Grade 8
 * only; the scope is U.S. history 1763-1877 (Revolution → Reconstruction)
 * plus government/civics, geography, economics, and social-studies
 * skills. We generate informational stimulus passages + 5 cluster
 * questions, same shape as the reading pipeline.
 *
 * Sensitive-topic handling (locked):
 *   - Religion: factual mentions of Pilgrims, Puritans, religious
 *     freedom, the First Amendment OK. No theology, no "what
 *     Christians believe", no proselytizing.
 *   - Slavery: factual coverage of slavery, abolition, Civil War
 *     causes is REQUIRED for the period — but no graphic violence,
 *     no death scenes, no romanticization of "the South." Frame
 *     enslaved people as people, not labor units.
 *   - Civil War battles: factual (Antietam, Gettysburg) without
 *     gory detail; focus on outcome / strategy / human cost in
 *     civil-tone language.
 *   - Indigenous peoples: factual, named tribes (Comanche, Apache,
 *     Caddo) with specific land claims; do not flatten to "Native
 *     Americans" if a specific group is the actual subject.
 *
 * Usage:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/social-studies/run-seed-openai.js [--brief-id <id>] [--write]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Reuse the readability helper from the reading pipeline (already
// proven; handles word-count / FK / Lexile estimate).
const { getReadabilityReport } = require('../reading/lib/readability');

const STATE = 'texas';
const GRADE = '8';
const SUBJECT = 'social-studies';
const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 90000;

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.resolve(__dirname, 'output');

// Texas Grade 8 social studies briefs covering TEKS §113.20 strands.
// Mix of US history (1763-1877), Texas history threads, government,
// geography, economics. ~14 briefs for v1.
const BRIEFS = [
  // US History — Revolutionary period
  { id: 'g8ss-stamp-act-protests', strand: 'us-history',
    topic: 'why colonists protested the Stamp Act of 1765 — what the tax was, why "no taxation without representation" became a rallying cry, and how the Sons of Liberty organized resistance' },
  { id: 'g8ss-declaration-key-ideas', strand: 'us-history',
    topic: "the three big ideas in the Declaration of Independence — natural rights, government by consent, and the right to alter or abolish a government — and where Jefferson got each idea" },
  { id: 'g8ss-shays-rebellion', strand: 'us-history',
    topic: "Shays' Rebellion of 1786-87 — the farmers' debt crisis in western Massachusetts, why the Articles of Confederation couldn't respond, and how it pushed states to call the Constitutional Convention" },

  // Constitution + Government
  { id: 'g8ss-constitutional-compromises', strand: 'government',
    topic: "the three big compromises at the Constitutional Convention — the Great Compromise (House + Senate), the Three-Fifths Compromise, and the slave trade compromise — and what each one did" },
  { id: 'g8ss-bill-of-rights-five', strand: 'government',
    topic: "five amendments in the Bill of Rights every Texas 8th grader should recognize — 1st (speech, religion, press, assembly), 2nd (arms), 4th (search and seizure), 5th (self-incrimination), 10th (powers reserved to the states)" },
  { id: 'g8ss-checks-and-balances', strand: 'government',
    topic: "how checks and balances work between the three branches — three concrete examples (presidential veto + congressional override; senate confirms judges; judicial review) and why the founders designed it this way" },

  // Westward expansion + Texas
  { id: 'g8ss-louisiana-purchase', strand: 'us-history',
    topic: "the Louisiana Purchase of 1803 — why Jefferson hesitated about its constitutionality, how it doubled the country's size, and what Lewis and Clark were sent to learn" },
  { id: 'g8ss-texas-revolution-causes', strand: 'texas-history',
    topic: 'three causes of the Texas Revolution (1835-36) — disagreements over slavery, the centralization of power under Santa Anna, and the size of the Anglo settler population — and how they combined' },
  { id: 'g8ss-trail-of-tears', strand: 'us-history',
    topic: 'the Trail of Tears (1830s) — the Indian Removal Act, the forced relocation of the Cherokee Nation, and the human cost of the journey from Georgia to Indian Territory' },

  // Civil War era
  { id: 'g8ss-missouri-compromise', strand: 'us-history',
    topic: 'the Missouri Compromise of 1820 — the slave-state / free-state balance, the 36°30′ line, and why it bought 30 years before sectional tension exploded again' },
  { id: 'g8ss-fugitive-slave-act', strand: 'us-history',
    topic: 'the Fugitive Slave Act of 1850 — what it required of Northern states, why it sharpened opposition to slavery in the North, and how it changed the Underground Railroad' },
  { id: 'g8ss-civil-war-economy-north-south', strand: 'economics',
    topic: 'how the economies of the North and South differed before the Civil War — industrial manufacturing in the North vs. cotton agriculture in the South — and why those differences shaped the war strategy' },
  { id: 'g8ss-emancipation-proclamation', strand: 'us-history',
    topic: 'the Emancipation Proclamation (1863) — what it did and did not do legally, why Lincoln framed it as a war measure, and how it changed the moral stakes of the war' },

  // Reconstruction
  { id: 'g8ss-reconstruction-amendments', strand: 'government',
    topic: 'the three Reconstruction Amendments (13th, 14th, 15th) — what each one did, the order they passed, and why they are sometimes called "the second founding"' },

  // ---- Round 2 (Q phase): Texas-history depth + missing US strands ----

  // More Texas history (5)
  { id: 'g8ss-tx-republic-years', strand: 'texas-history',
    topic: 'the Republic of Texas (1836-1845) — its currency, two capitals (Houston then Austin), the diplomatic recognition challenge, and why it eventually pursued statehood' },
  { id: 'g8ss-tx-san-jacinto', strand: 'texas-history',
    topic: "the Battle of San Jacinto (April 21, 1836) — the surprise attack, Houston's strategy, the 18-minute fight, and the Treaty of Velasco that followed" },
  { id: 'g8ss-tx-annexation-1845', strand: 'texas-history',
    topic: 'the annexation of Texas in 1845 — why the U.S. hesitated for nine years, the slavery balance argument, and how the Joint Resolution finally brought Texas into the Union' },
  { id: 'g8ss-tx-civil-war-secession', strand: 'texas-history',
    topic: "Texas in the Civil War — Sam Houston's stand against secession, Texas's role as a Confederate state, and the late conflict at Palmito Ranch (May 1865) after Lee's surrender" },
  { id: 'g8ss-tx-reconstruction-state', strand: 'texas-history',
    topic: 'Texas during Reconstruction (1865-1873) — the new 1869 state constitution, the role of Freedmen, and why federal occupation ended in 1870' },

  // More US history (6)
  { id: 'g8ss-french-indian-war', strand: 'us-history',
    topic: "the French and Indian War (1754-1763) — the global Seven Years' War context, why Britain won North America, and how the war's costs led to colonial taxation" },
  { id: 'g8ss-boston-tea-party', strand: 'us-history',
    topic: 'the Boston Tea Party (December 1773) — the Tea Act dispute, the actual event, and the Coercive (Intolerable) Acts that followed' },
  { id: 'g8ss-articles-of-confederation-weaknesses', strand: 'us-history',
    topic: "the Articles of Confederation — what powers they gave the federal government, three concrete weaknesses (no taxing power, no commerce regulation, unanimity required for amendment), and how Shays' Rebellion exposed the limits" },
  { id: 'g8ss-manifest-destiny', strand: 'us-history',
    topic: 'Manifest Destiny in the 1840s — the phrase, the cultural assumptions behind it, and how it justified U.S. westward expansion through war, treaty, and purchase' },
  { id: 'g8ss-mexican-american-war', strand: 'us-history',
    topic: 'the Mexican-American War (1846-1848) — the disputed border, the Treaty of Guadalupe Hidalgo, the Mexican Cession (CA, NV, UT, AZ, NM, parts of CO and WY), and how the Wilmot Proviso reignited the slavery debate' },
  { id: 'g8ss-civil-war-antietam-turning', strand: 'us-history',
    topic: 'the Battle of Antietam (September 17, 1862) — the bloodiest single day in U.S. history at the time, why Lincoln treated it as a Union victory, and how it cleared the political path for the Emancipation Proclamation' },

  // More government (3)
  { id: 'g8ss-federalist-anti-federalist', strand: 'government',
    topic: 'the ratification debate of 1787-88 — the Federalist position (Hamilton, Madison, Jay), the Anti-Federalist position (Henry, George Mason), and how the promise of a Bill of Rights closed the deal' },
  { id: 'g8ss-federalist-no-10', strand: 'government',
    topic: "Federalist No. 10 — Madison's argument that a large republic is the best defense against the dangers of factions, and how that idea shows up in U.S. government today" },
  { id: 'g8ss-northwest-ordinance', strand: 'government',
    topic: 'the Northwest Ordinance of 1787 — how new states join the Union, why it banned slavery in the Northwest Territory, and what it set as a precedent for later state admissions' },

  // More economics (2)
  { id: 'g8ss-cotton-gin-economy', strand: 'economics',
    topic: "Eli Whitney's cotton gin (1793) — how it sped up cotton processing, why it expanded enslaved labor instead of reducing it, and how it tied the South's economy to plantation cotton" },
  { id: 'g8ss-northern-industrial-revolution', strand: 'economics',
    topic: 'industrialization in the North (1820s-1860s) — the Lowell mill system, the wave of immigration that fed the factories, the rise of cities, and how this economy contrasted with the agricultural South' }
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
  return `You write informational social-studies passages for a Texas STAAR Grade 8 practice app. Texas tests social studies at Grade 8 only, covering U.S. history 1763-1877 (Revolution through Reconstruction), the development of the U.S. Constitution and government structure, geography, economics of the period, and the place of Texas in U.S. history.

== Audience ==
13-14-year-old students. Vocabulary at grade-8 level (Tier 2 + selected Tier 3 academic vocabulary). Flesch-Kincaid 7.5-10.0 acceptable; informational social studies at this level naturally lands FK 8-12.

== Sensitive-topic discipline (LOCKED) ==
- Religion: factual mentions of Pilgrims, Puritans, religious freedom, First Amendment establishment + free-exercise clauses are REQUIRED for the period. NEVER theology, prayer, "what Christians/Jews/Muslims believe", proselytizing language.
- Slavery: factual coverage of slavery, abolition, the Civil War era is REQUIRED. Frame enslaved people as people. NO graphic violence, NO death scenes, NO romanticization of slavery or "the antebellum South."
- Civil War battles: factual (Antietam, Gettysburg) without gory detail; focus on strategy / outcome / human cost in civil-tone language.
- Indigenous peoples: factual, named tribes (Comanche, Apache, Caddo, Cherokee, Choctaw) with specific land claims and specific events. Don't flatten to "Native Americans" or "Indians" when a specific group is the subject.
- Politics: present multiple perspectives factually. Never editorialize about modern political parties.

== Output format (STRICT JSON) ==

{
  "title": "Short topic-direct title",
  "body": "## Title\\n\\nFirst paragraph...\\n\\nSecond paragraph...\\n\\n...",
  "topicNotes": "1-line internal note"
}

== Body format ==
- Markdown. Open with "## " + title. Each paragraph separated by single blank line.
- 450-700 words. Real STAAR Grade 8 social studies stimulus passages cluster around 500-650 words.
- Use **bold** sparingly for Tier-3 vocabulary or named treaties / acts (Stamp Act, Three-Fifths Compromise).
- May use ## section headings for multi-paragraph topics.
- DO NOT include images, HTML tags, or inline paragraph numbers.

== Strict-pass requirements ==
- Stay within Texas STAAR Grade 8 scope (US history 1763-1877, government, civics, geography, economics, Texas threads).
- Names of historical figures should be accurate (no fabricated quotes; if you're not 100% sure of a quote, paraphrase).
- Dates should be accurate within the year.
- Multiple perspectives where the historical record offers them — especially on slavery and Reconstruction.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildPassageUser(brief) {
  return `Generate ONE informational social-studies passage for Texas STAAR Grade 8.

Strand: ${brief.strand}
Topic: ${brief.topic}

Match the 450-700 word target. Multiple paragraphs (4-7 paragraphs typical). Apply ALL sensitive-topic rules. Return strict JSON.`;
}

function buildQuestionsSystem() {
  return `You write multiple-choice questions for a Texas STAAR Grade 8 social studies practice app, given a passage. STAAR Grade 8 social studies questions test:
- Key idea / main argument
- Specific factual recall (dates, names, events)
- Cause and effect
- Compare and contrast
- Historical context / sequence
- Reading a quote or excerpt for meaning

Output STRICT JSON:

{
  "questions": [
    {
      "stem": "Question text",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 2,
      "explanation": "Brief: cite specific paragraph evidence. 1-2 sentences.",
      "questionType": "main-idea | key-detail | cause-effect | compare-contrast | sequence | excerpt-meaning"
    }
  ]
}

Rules (LOCKED):
- Exactly 5 questions per passage.
- Mix question types — at least 3 distinct types across the 5.
- Exactly 4 choices each, one correct.
- Distractors plausible — common misconceptions or partially-true statements.
- Question must be answerable from the passage alone.
- Explanation cites SPECIFIC passage evidence ("paragraph 3 explains...").
- NO graphic content. NO theology or proselytizing language. NO modern-political-party editorializing.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildQuestionsUser(passage) {
  return `Generate 5 social-studies questions for the passage below.

Title: ${passage.title}

Passage:
${passage.body}

Return strict JSON.`;
}

function nowIso() { return new Date().toISOString(); }
function shortId() { return crypto.randomBytes(6).toString('hex'); }
function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

async function processBrief(brief, opts, apiKey) {
  console.log(`\n=== ${brief.id} (${brief.strand}) ===`);
  console.log(`topic: ${brief.topic.slice(0, 80)}${brief.topic.length > 80 ? '…' : ''}`);

  // Stage 1: passage
  console.log('  ⏳ generating passage…');
  const pSys = buildPassageSystem();
  const pUser = buildPassageUser(brief);
  let passageRaw;
  try {
    const resp = await callOpenAI(pSys, pUser, apiKey, { temperature: 0.6, max_tokens: 2200 });
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
  if (report.wordCount < 400 || report.wordCount > 800) {
    console.warn(`  ⚠ word-count ${report.wordCount} outside target 400-800 (proceeding anyway)`);
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

  // Build the records. stateGradeGenre format mirrors reading +
  // science: <state>_<grade>_<genre>. For social studies, we use a
  // single genre 'social-studies' so the lambda's GSI query is
  // straightforward.
  const passageId = `p_tx_${GRADE}_ss_${shortId()}`;
  const stateGradeGenre = `${STATE}_${GRADE}_${SUBJECT}`;
  const passageRow = {
    passageId,
    state: STATE,
    grade: GRADE,
    subject: SUBJECT,
    genre: SUBJECT,
    stateGradeGenre,
    title,
    body,
    topic: brief.topic,
    topicNotes: String(passageJson.topicNotes || '').slice(0, 200),
    strand: brief.strand,
    wordCount: report.wordCount,
    paragraphCount: report.paragraphCount,
    fkGrade: report.fkGrade,
    lexileEstimate: report.lexileEstimate,
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'social-studies-openai-v1',
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
    status: 'active',
    _generatedBy: MODEL,
    _generatedAt: nowIso(),
    _pipelineVersion: 'social-studies-openai-v1',
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

  // Idempotency: skip briefs whose ID is already in DDB.
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
  console.log(`[ss-openai] runId=${runId} mode=${opts.dryRun ? 'dry-run' : 'WRITE'} briefs=${briefs.length}`);

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

  const outPath = path.join(OUTPUT_DIR, `social-studies-openai-${runId}.json`);
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
