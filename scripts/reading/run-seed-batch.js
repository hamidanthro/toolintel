#!/usr/bin/env node
/**
 * Reading Phase 2 — seed batch.
 *
 * Generates 10 passages (6 realistic-fiction + 4 informational) per the
 * Owners' Room diversity ratio. For each passage, generates a 5-question
 * set. Both stages judge before save:
 *   - generatePassage → judgePassage (Pass 1 structural + Pass 2 LLM)
 *   - generateQuestionSet → per-question judgeQuestion in parallel
 *
 * Saves passing passages to staar-passages and passing questions to
 * staar-content-pool (poolKey = '<state>#<grade>#reading#<passageId>').
 *
 * Concurrency: 3 passages in flight at once. Within a passage, the 5
 * question judgments run in parallel.
 *
 * Cost: ~$3-5 Anthropic API. Wall-clock: ~10-20 min depending on rejects.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *     --secret-id staar-tutor/anthropic-api-key \
 *     --region us-east-1 --query SecretString --output text) \
 *     node scripts/reading/run-seed-batch.js
 */
'use strict';

// AWS SDK lives in scripts/cold-start/node_modules; NODE_PATH wired in run wrapper.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { generatePassage } = require('./generate-passage');
const { generateQuestionSet } = require('./generate-question');
const { judgePassage } = require('./judge-passage');
const { judgeQuestion } = require('./judge-question');
const { loadKP } = require('./lib/load-kp');

const REGION = 'us-east-1';
const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';
const STATE = 'texas';
const GRADE = '3';

const PASSAGE_REGEN_BUDGET = 3;
const QUESTION_REGEN_BUDGET = 3;
const QUESTIONS_PER_PASSAGE = 5;
const MIN_QUESTIONS_TO_KEEP = 4;
const PASSAGE_CONCURRENCY = 3;

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(__dirname, 'output');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// ---- the 10 hand-curated briefs ----
const BRIEFS = [
  // 6 realistic fiction — diverse cities + protagonists per KP §6 ratio
  { genre: 'realistic-fiction', topic: 'sibling conflict, two siblings sharing a tablet, resolution within passage',
    setting: 'Brownsville, Texas', protagonistName: 'Mateo', protagonistDemographic: 'hispanic-latino' },
  { genre: 'realistic-fiction', topic: 'a lost pet finding its way home',
    setting: 'Lubbock, Texas', protagonistName: null, protagonistDemographic: 'unmarked' },
  { genre: 'realistic-fiction', topic: 'starting a new hobby (learning to play an instrument)',
    setting: 'Houston, Texas', protagonistName: 'Aaliyah', protagonistDemographic: 'black' },
  { genre: 'realistic-fiction', topic: 'helping an elderly neighbor with a small task',
    setting: 'El Paso, Texas', protagonistName: 'Linh', protagonistDemographic: 'asian' },
  { genre: 'realistic-fiction', topic: 'a rainy day picnic improvised indoors',
    setting: 'Galveston, Texas', protagonistName: null, protagonistDemographic: 'unmarked' },
  { genre: 'realistic-fiction', topic: 'finding an interesting old object in a closet or attic',
    setting: 'Amarillo, Texas', protagonistName: 'Kai', protagonistDemographic: 'native-american' },

  // 4 informational
  { genre: 'informational', topic: 'sea turtle behavior and habitat',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked', subject: 'sea turtles' },
  { genre: 'informational', topic: 'biography of Patricia Bath, eye doctor and inventor',
    setting: null, protagonistName: 'Patricia Bath', protagonistDemographic: 'black', subject: 'Patricia Bath' },
  { genre: 'informational', topic: 'how wind chimes make sound',
    setting: null, protagonistName: null, protagonistDemographic: 'unmarked', subject: 'wind chimes' },
  { genre: 'informational', topic: 'Big Bend National Park geography and wildlife',
    setting: 'Big Bend National Park, Texas', protagonistName: null, protagonistDemographic: 'unmarked', subject: 'Big Bend National Park' }
];

// ---- helpers ----

function ensureDirs() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function nowIso() { return new Date().toISOString(); }

function passageIdFor(brief, seq) {
  const genreCode = brief.genre === 'realistic-fiction' ? 'rf' : 'inf';
  return `p_tx_3_${genreCode}_${String(seq).padStart(3, '0')}`;
}

function questionIdFor(passageId, qIdx) {
  // contentId scheme: q_<rand9>_<sha8(passageId+stem)> — keep similar shape to math pool
  const rand = crypto.randomBytes(5).toString('hex').slice(0, 9);
  const sha = crypto.createHash('sha256').update(`${passageId}:${qIdx}`).digest('hex').slice(0, 8);
  return `q_${rand}_${sha}`;
}

async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      try { results[myIdx] = await fn(items[myIdx], myIdx); }
      catch (err) { results[myIdx] = { __error: err && err.message || String(err) }; }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- core: process one brief ----

async function processBrief(brief, seq, apiKey) {
  const log = [];
  const tag = `[brief ${seq + 1}/${BRIEFS.length} ${brief.genre} ${brief.topic.slice(0, 40)}]`;

  // Stage 1: passage generation + judging (up to 3 attempts)
  let passage = null;
  let passageVerdict = null;
  let passageRejects = [];

  for (let attempt = 1; attempt <= PASSAGE_REGEN_BUDGET; attempt++) {
    let gen;
    try {
      gen = await generatePassage({
        genre: brief.genre,
        topic: brief.topic,
        setting: brief.setting,
        protagonistName: brief.protagonistName,
        protagonistDemographic: brief.protagonistDemographic,
        apiKey
      });
    } catch (err) {
      log.push(`${tag} attempt ${attempt} GEN-FAIL: ${(err.message || '').slice(0, 200)}`);
      console.warn(`${tag} attempt ${attempt} GEN-FAIL: ${(err.message || '').slice(0, 200)}`);
      continue;
    }

    const verdict = await judgePassage({ ...gen, apiKey });
    if (verdict.verdict === 'pass') {
      passage = gen;
      passageVerdict = verdict;
      log.push(`${tag} PASSAGE OK (attempt ${attempt}, fk=${gen.fkGrade}, words=${gen.wordCount}, conf=${verdict.confidence})`);
      console.log(`${tag} PASSAGE OK (attempt ${attempt}, fk=${gen.fkGrade}, words=${gen.wordCount})`);
      break;
    } else {
      passageRejects.push({ attempt, title: gen.title, verdict });
      log.push(`${tag} attempt ${attempt} REJECT: ${verdict.source}, reasons=[${verdict.reasons.join(', ')}], note=${verdict.note}`);
      console.warn(`${tag} attempt ${attempt} REJECT: reasons=[${verdict.reasons.join(', ')}]`);
    }
  }

  if (!passage) {
    return { ok: false, brief, reason: 'passage-rejected-3x', passageRejects, log };
  }

  // Stage 2: question set generation + judging
  let savedQuestions = [];
  let questionRejects = [];

  for (let attempt = 1; attempt <= QUESTION_REGEN_BUDGET; attempt++) {
    let questionSet;
    try {
      questionSet = await generateQuestionSet({ passage, count: QUESTIONS_PER_PASSAGE, apiKey });
    } catch (err) {
      log.push(`${tag} Q attempt ${attempt} GEN-FAIL: ${(err.message || '').slice(0, 200)}`);
      console.warn(`${tag} Q attempt ${attempt} GEN-FAIL: ${(err.message || '').slice(0, 200)}`);
      continue;
    }

    // Judge each question in parallel
    const verdicts = await mapConcurrent(questionSet, 4, async (q) => judgeQuestion({ passage, question: q, apiKey }));

    const passing = [];
    for (let i = 0; i < questionSet.length; i++) {
      const v = verdicts[i];
      if (v && !v.__error && v.verdict === 'pass') passing.push({ q: questionSet[i], v });
      else questionRejects.push({ attempt, qIdx: i, stem: questionSet[i].stem.slice(0, 100), verdict: v });
    }

    log.push(`${tag} Q attempt ${attempt}: ${passing.length}/${questionSet.length} passed`);
    console.log(`${tag} Q attempt ${attempt}: ${passing.length}/${questionSet.length} passed`);

    if (passing.length >= MIN_QUESTIONS_TO_KEEP) {
      savedQuestions = passing.slice(0, QUESTIONS_PER_PASSAGE);
      break;
    }
  }

  if (savedQuestions.length < MIN_QUESTIONS_TO_KEEP) {
    return { ok: false, brief, reason: 'questions-below-min', passageGen: passage, questionRejects, log };
  }

  // Stage 3: persist
  const passageId = passageIdFor(brief, seq + 1);
  const passageRow = {
    passageId,
    stateGradeGenre: `${STATE}_${GRADE}_${passage.genre}`,
    state: STATE,
    grade: GRADE,
    genre: passage.genre,
    title: passage.title,
    body: passage.body,
    wordCount: passage.wordCount,
    paragraphCount: passage.paragraphCount,
    fkGrade: passage.fkGrade,
    lexileEstimate: passage.lexileEstimate,
    protagonistName: passage.protagonistName,
    protagonistDemographic: passage.protagonistDemographic,
    setting: passage.setting,
    topic: passage.topic,
    teksStrands: Array.from(new Set(savedQuestions.map(x => x.q.claimedTeks).filter(Boolean))),
    citation: brief.subject ? `informational subject: ${brief.subject}` : null,
    _generatedAt: passage._generatedAt,
    _generatedBy: passage._generatedBy,
    _judgedAt: nowIso(),
    _judgeVerdict: passageVerdict.verdict,
    _judgeConfidence: passageVerdict.confidence,
    _judgeNote: passageVerdict.note,
    _judgeFactsRequireCheck: !!passageVerdict.factsRequireCheck,
    _kpVersion: loadKP().kpVersion,
    _phase: 1,
    _topicNotes: passage._topicNotes
  };

  await ddb.send(new PutCommand({ TableName: PASSAGES_TABLE, Item: passageRow }));

  const poolKey = `${STATE}#${GRADE}#reading#${passageId}`;
  for (let i = 0; i < savedQuestions.length; i++) {
    const { q, v } = savedQuestions[i];
    const contentId = questionIdFor(passageId, i);
    // staar-content-pool has a status-generatedAt-index GSI where
    // generatedAt MUST be a Number (epoch ms), not an ISO string.
    // (Mirrors how the existing math pool rows are stored.)
    const generatedAtMs = Date.now();
    const questionRow = {
      poolKey,
      contentId,
      type: 'reading_mc',
      passageId,
      state: STATE,
      grade: GRADE,
      subject: 'reading',
      stem: q.stem,
      choices: q.choices,
      correctIndex: q.correctIndex,
      claimedTeks: q.claimedTeks,
      stemPattern: q.stemPattern,
      teks: q.claimedTeks,
      status: 'active',
      generatedAt: generatedAtMs,
      generatedAtIso: passage._generatedAt,   // human-readable copy
      generatedBy: passage._generatedBy,
      _judgedAt: nowIso(),
      _judgeConfidence: v.confidence,
      _judgeNote: v.note,
      _kpVersion: loadKP().kpVersion,
      _phase: 1,
      _seedRunId: 'reading-seed-' + passage._generatedAt
    };
    await ddb.send(new PutCommand({ TableName: POOL_TABLE, Item: questionRow }));
  }

  return {
    ok: true,
    brief,
    passageId,
    passageRow,
    savedQuestionCount: savedQuestions.length,
    savedQuestions,           // for review packet
    passageRejects,
    questionRejects,
    log
  };
}

// ---- main ----

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('FATAL: ANTHROPIC_API_KEY env var not set.');
    process.exit(1);
  }

  ensureDirs();
  const startedAt = nowIso();
  const startedMs = Date.now();
  const runId = startedAt.replace(/[:.]/g, '-');

  console.log(`[seed-batch] start runId=${runId}`);
  console.log(`[seed-batch] briefs=${BRIEFS.length}, concurrency=${PASSAGE_CONCURRENCY}, questions/passage=${QUESTIONS_PER_PASSAGE}\n`);

  // Index-aware concurrent runner
  const results = new Array(BRIEFS.length);
  let nextIdx = 0;
  const workers = Array(Math.min(PASSAGE_CONCURRENCY, BRIEFS.length)).fill(0).map(async () => {
    while (nextIdx < BRIEFS.length) {
      const myIdx = nextIdx++;
      try { results[myIdx] = await processBrief(BRIEFS[myIdx], myIdx, apiKey); }
      catch (err) { results[myIdx] = { ok: false, __error: err && err.message || String(err), brief: BRIEFS[myIdx] }; }
    }
  });
  await Promise.all(workers);

  // Summary
  const passed = results.filter(r => r && r.ok);
  const failed = results.filter(r => r && !r.ok);
  const totalQuestionsSaved = passed.reduce((s, r) => s + (r.savedQuestionCount || 0), 0);

  // Reject reason tally
  const passageRejectReasons = {};
  for (const r of results) {
    for (const pr of (r.passageRejects || [])) {
      for (const code of (pr.verdict?.reasons || [])) {
        passageRejectReasons[code] = (passageRejectReasons[code] || 0) + 1;
      }
    }
  }
  const questionRejectReasons = {};
  for (const r of results) {
    for (const qr of (r.questionRejects || [])) {
      for (const code of (qr.verdict?.reasons || [])) {
        questionRejectReasons[code] = (questionRejectReasons[code] || 0) + 1;
      }
    }
  }

  const summary = {
    runId, startedAt, endedAt: nowIso(),
    wallClockSec: Math.round((Date.now() - startedMs) / 1000),
    briefsAttempted: BRIEFS.length,
    passagesSaved: passed.length,
    questionsSaved: totalQuestionsSaved,
    failed: failed.length,
    passageRejectReasons,
    questionRejectReasons,
    saved: passed.map(r => ({
      passageId: r.passageId,
      title: r.passageRow.title,
      genre: r.passageRow.genre,
      setting: r.passageRow.setting,
      protagonistDemographic: r.passageRow.protagonistDemographic,
      wordCount: r.passageRow.wordCount,
      fkGrade: r.passageRow.fkGrade,
      questionCount: r.savedQuestionCount,
      teksStrands: r.passageRow.teksStrands
    })),
    gaveUp: failed.map(r => ({
      brief: r.brief,
      reason: r.reason || r.__error
    }))
  };

  const summaryPath = path.join(OUTPUT_DIR, `seed-batch-${runId}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // Reject log
  const rejectsPath = path.join(OUTPUT_DIR, `seed-rejects-${runId}.json`);
  fs.writeFileSync(rejectsPath, JSON.stringify({
    passageRejects: results.flatMap(r => (r?.passageRejects || []).map(pr => ({
      brief: r.brief,
      attempt: pr.attempt,
      title: pr.title,
      verdict: pr.verdict
    }))),
    questionRejects: results.flatMap(r => (r?.questionRejects || []).map(qr => ({
      passageBrief: r.brief.topic,
      attempt: qr.attempt,
      qIdx: qr.qIdx,
      stem: qr.stem,
      verdict: qr.verdict
    })))
  }, null, 2));

  // Review packet — pick 5 random saved passages, write markdown
  if (passed.length > 0) {
    const sample = [];
    const taken = new Set();
    while (sample.length < Math.min(5, passed.length)) {
      const i = Math.floor(Math.random() * passed.length);
      if (!taken.has(i)) { taken.add(i); sample.push(passed[i]); }
    }
    const reviewLines = [];
    reviewLines.push(`# Reading seed batch review — ${runId}\n`);
    reviewLines.push(`## Stats`);
    reviewLines.push(`- Briefs attempted: ${summary.briefsAttempted}`);
    reviewLines.push(`- Passages saved: ${summary.passagesSaved}`);
    reviewLines.push(`- Questions saved: ${summary.questionsSaved}`);
    reviewLines.push(`- Wall-clock: ${Math.round(summary.wallClockSec / 60 * 10) / 10} min`);
    reviewLines.push(`- Top passage rejects: ${Object.entries(passageRejectReasons).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}=${v}`).join(', ') || '(none)'}`);
    reviewLines.push(`- Top question rejects: ${Object.entries(questionRejectReasons).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}=${v}`).join(', ') || '(none)'}\n`);

    sample.forEach((r, i) => {
      const p = r.passageRow;
      reviewLines.push(`---\n`);
      reviewLines.push(`## Spot-check ${i + 1} of ${sample.length}: ${p.title}\n`);
      reviewLines.push(`- **passageId:** \`${p.passageId}\``);
      reviewLines.push(`- **Genre:** ${p.genre}`);
      reviewLines.push(`- **Setting:** ${p.setting || '(none)'}`);
      reviewLines.push(`- **Protagonist:** ${p.protagonistName || 'unmarked'} (${p.protagonistDemographic})`);
      reviewLines.push(`- **Word count:** ${p.wordCount}`);
      reviewLines.push(`- **Flesch-Kincaid:** ${p.fkGrade}`);
      reviewLines.push(`- **TEKS strands:** ${(p.teksStrands || []).join(', ') || '(none)'}\n`);
      reviewLines.push(`### Passage body\n`);
      reviewLines.push(p.body);
      reviewLines.push(`\n### Questions\n`);
      const qList = r.savedQuestions || [];
      qList.forEach((entry, qi) => {
        const q = entry.q;
        reviewLines.push(`**${qi + 1}.** ${q.stem}  *(TEKS ${q.claimedTeks || '?'}, ${q.stemPattern || '?'})*`);
        const letters = ['A','B','C','D'];
        q.choices.forEach((c, ci) => {
          const mark = ci === q.correctIndex ? ' **← correct**' : '';
          reviewLines.push(`  - ${letters[ci]}. ${c}${mark}`);
        });
        reviewLines.push('');
      });
      reviewLines.push(`**Hamid verdict:** [ ] PASS  [ ] REJECT  [ ] EDIT\n`);
      reviewLines.push(`**Notes:** ___________\n`);
    });

    const reviewPath = path.join(OUTPUT_DIR, `review-${runId}.md`);
    fs.writeFileSync(reviewPath, reviewLines.join('\n'));
    console.log(`\n[seed-batch] review packet: ${reviewPath}`);
  }

  // Console summary
  console.log('\n=== SEED BATCH SUMMARY ===');
  console.log(`runId:           ${runId}`);
  console.log(`Wall clock:      ${summary.wallClockSec}s (${Math.round(summary.wallClockSec / 60 * 10) / 10} min)`);
  console.log(`Briefs:          ${summary.briefsAttempted}`);
  console.log(`Passages saved:  ${summary.passagesSaved} / ${summary.briefsAttempted}`);
  console.log(`Questions saved: ${summary.questionsSaved}`);
  console.log(`Gave up:         ${summary.failed}`);
  console.log(`\nPassage reject reasons:`);
  for (const [code, n] of Object.entries(passageRejectReasons).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${code.padEnd(28)} ${n}`);
  }
  console.log(`\nQuestion reject reasons:`);
  for (const [code, n] of Object.entries(questionRejectReasons).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${code.padEnd(28)} ${n}`);
  }
  if (summary.gaveUp.length) {
    console.log(`\nGave up:`);
    for (const g of summary.gaveUp) console.log(`  ${g.brief.genre} / ${g.brief.topic.slice(0, 60)} → ${g.reason}`);
  }
  console.log(`\nSaved passages:`);
  for (const p of summary.saved) {
    console.log(`  ${p.passageId.padEnd(20)} ${p.genre.padEnd(20)} "${p.title.slice(0, 40)}" (${p.questionCount} qs, fk=${p.fkGrade})`);
  }

  console.log(`\nSummary saved: ${summaryPath}`);
  console.log(`Rejects saved: ${rejectsPath}`);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
