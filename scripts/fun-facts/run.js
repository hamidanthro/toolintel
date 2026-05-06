#!/usr/bin/env node
/**
 * Fun-facts orchestrator — generate + judge + assemble 500 facts.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *     --secret-id staar-tutor/anthropic-api-key --query SecretString \
 *     --output text) node scripts/fun-facts/run.js
 *
 * Per Owners' Room spec v2:
 *   - 10 categories × 50 facts each = 500 total
 *   - Distribution per category: 30 L1 + 15 L2 + 5 L3
 *   - Generator + judge are Claude Sonnet 4.5
 *   - 20% buffer on generation; up to 3 regen attempts per bucket
 *
 * Outputs:
 *   - data/fun-facts.json (final assembled array)
 *   - scripts/fun-facts/output/raw/{category}-L{level}.json (per-bucket gen output)
 *   - scripts/fun-facts/output/rejects.json (every reject with reason)
 *   - scripts/fun-facts/output/run-{timestamp}.json (final run summary)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { generateFacts } = require('./generate');
const { judgeFact, FAILURE_MODES } = require('./judge');

const CATEGORIES = [
  'animals', 'space', 'body', 'food', 'texas',
  'sports', 'inventions', 'history', 'math-numbers', 'weird-funny'
];
const LEVELS = [1, 2, 3];
const TARGETS = { 1: 30, 2: 15, 3: 5 };
const BUFFER = 1.20;            // ask for 20% more than target
const MAX_REGEN_ATTEMPTS = 3;
const BUCKET_CONCURRENCY = 3;   // run 3 buckets in parallel

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(__dirname, 'output');
const RAW_DIR = path.join(OUTPUT_DIR, 'raw');
const FINAL_PATH = path.join(ROOT, 'data', 'fun-facts.json');

function ensureDirs() {
  for (const d of [OUTPUT_DIR, RAW_DIR, path.join(ROOT, 'data')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function nowIso() { return new Date().toISOString(); }

function categoryPrefix(cat) {
  // Stable 2-3 letter prefix per category for fact IDs.
  const map = {
    animals: 'an', space: 'sp', body: 'bd', food: 'fd', texas: 'tx',
    sports: 'sg', inventions: 'in', history: 'hi',
    'math-numbers': 'mn', 'weird-funny': 'wf'
  };
  return map[cat] || cat.slice(0, 2);
}

function pad3(n) { return String(n).padStart(3, '0'); }

/**
 * Map-with-concurrency: run async fn across items, at most N in flight.
 * Returns array of results in input order.
 */
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      try {
        results[myIdx] = await fn(items[myIdx], myIdx);
      } catch (err) {
        results[myIdx] = { __error: err && err.message || String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Process one (category, wowLevel) bucket end-to-end.
 *   - Generate target * 1.2 facts
 *   - Judge each
 *   - Keep passes; collect rejects
 *   - If pass count < target, regenerate the gap (up to MAX_REGEN_ATTEMPTS)
 * Returns { passes: [...], rejects: [...], attempts, generated, gaveUp }.
 */
async function processBucket({ category, wowLevel, apiKey }) {
  const target = TARGETS[wowLevel];
  const askFor = Math.ceil(target * BUFFER);
  const passes = [];
  const rejects = [];
  let totalGenerated = 0;
  let attempts = 0;
  let gaveUp = false;

  console.log(`[bucket] ${category}/L${wowLevel} → target ${target}, asking for ${askFor}`);

  while (passes.length < target && attempts < MAX_REGEN_ATTEMPTS) {
    attempts++;
    const need = target - passes.length;
    const askThisRound = Math.max(Math.ceil(need * BUFFER), 5);
    const avoidList = passes.map(p => p.fact);

    let generated;
    try {
      generated = await generateFacts({
        category, wowLevel, count: askThisRound, avoidList, apiKey
      });
    } catch (err) {
      console.error(`[bucket] ${category}/L${wowLevel} attempt ${attempts} generation failed: ${err.message}`);
      continue;
    }
    totalGenerated += generated.length;

    // Save raw gen output for this attempt (overwrites prior attempt of same bucket).
    const rawPath = path.join(RAW_DIR, `${category}-L${wowLevel}-attempt${attempts}.json`);
    try {
      fs.writeFileSync(rawPath, JSON.stringify(generated, null, 2));
    } catch (_) { /* best-effort */ }

    // Judge each fact in this attempt's batch (concurrency=4 within a batch).
    const peers = generated.map(g => g.fact);
    const verdicts = await mapConcurrent(generated, 4, async (item, i) => {
      // Each fact's batch peers exclude itself.
      const peerList = peers.filter((_, j) => j !== i);
      const v = await judgeFact({
        fact: item.fact,
        citation: item.citation,
        category, wowLevel,
        batchPeers: peerList,
        apiKey
      });
      return { item, verdict: v };
    });

    for (const r of verdicts) {
      if (r && r.__error) {
        rejects.push({ category, wowLevel, fact: '(judge error)', reasons: ['JUDGE_ERROR'], note: r.__error });
        continue;
      }
      const { item, verdict } = r;
      if (verdict.verdict === 'pass' && passes.length < target) {
        passes.push({
          fact: String(item.fact || '').trim(),
          citation: String(item.citation || '').trim(),
          category, wowLevel,
          _judgeConfidence: verdict.confidence,
          _judgeNote: verdict.note,
          _judgeSource: verdict.source
        });
      } else if (verdict.verdict === 'reject') {
        rejects.push({
          category, wowLevel,
          fact: String(item.fact || '').slice(0, 200),
          reasons: verdict.reasons,
          note: verdict.note,
          source: verdict.source
        });
      }
      // verdict=pass but we've already hit target → ignore extras
    }

    console.log(`[bucket] ${category}/L${wowLevel} attempt ${attempts}: +${verdicts.filter(v => v && !v.__error && v.verdict.verdict === 'pass').length} passes, ${verdicts.filter(v => v && !v.__error && v.verdict.verdict === 'reject').length} rejects (running passes=${passes.length}/${target})`);
  }

  if (passes.length < target) {
    gaveUp = true;
    console.warn(`[bucket] ${category}/L${wowLevel} GAVE UP after ${attempts} attempts: ${passes.length}/${target} passes`);
  } else {
    console.log(`[bucket] ${category}/L${wowLevel} DONE: ${passes.length}/${target} in ${attempts} attempts`);
  }

  return { category, wowLevel, passes, rejects, attempts, totalGenerated, gaveUp };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('FATAL: ANTHROPIC_API_KEY env var not set.');
    console.error('Run with:');
    console.error('  ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \\');
    console.error('    --secret-id staar-tutor/anthropic-api-key \\');
    console.error('    --query SecretString --output text) node scripts/fun-facts/run.js');
    process.exit(1);
  }

  ensureDirs();
  const startedAt = nowIso();
  const startedMs = Date.now();

  // Build bucket list (30 buckets total).
  const buckets = [];
  for (const category of CATEGORIES) {
    for (const wowLevel of LEVELS) {
      buckets.push({ category, wowLevel });
    }
  }
  console.log(`[run] starting — ${buckets.length} buckets, concurrency=${BUCKET_CONCURRENCY}`);

  const bucketResults = await mapConcurrent(buckets, BUCKET_CONCURRENCY, async (b) => {
    return processBucket({ ...b, apiKey });
  });

  // Assemble final array with stable IDs per category.
  const final = [];
  const allRejects = [];
  const counts = {};

  for (const cat of CATEGORIES) {
    counts[cat] = { 1: 0, 2: 0, 3: 0, total: 0 };
    let seq = 1;
    for (const lvl of LEVELS) {
      const r = bucketResults.find(x => x && x.category === cat && x.wowLevel === lvl);
      if (!r) continue;
      counts[cat][lvl] = r.passes.length;
      counts[cat].total += r.passes.length;
      for (const p of r.passes) {
        const isTexasRelevant = (cat === 'texas') || /\btexas\b/i.test(p.fact);
        final.push({
          id: `ff-${categoryPrefix(cat)}-${pad3(seq++)}`,
          category: cat,
          fact: p.fact,
          wowLevel: lvl,
          isTexasRelevant,
          citation: p.citation,
          gradeLevel: '3-4',
          _generatedAt: startedAt,
          _judgedAt: nowIso(),
          _judgeModel: 'claude-sonnet-4-5',
          _judgeConfidence: p._judgeConfidence,
          _judgeNote: p._judgeNote,
          _judgeSource: p._judgeSource
        });
      }
      allRejects.push(...r.rejects);
    }
  }

  // Save final output.
  fs.writeFileSync(FINAL_PATH, JSON.stringify(final, null, 2));
  console.log(`\n[run] ✓ wrote ${final.length} facts to ${FINAL_PATH}`);

  // Save rejects log.
  const rejectsPath = path.join(OUTPUT_DIR, 'rejects.json');
  fs.writeFileSync(rejectsPath, JSON.stringify(allRejects, null, 2));

  // Reject reason breakdown.
  const reasonCounts = {};
  for (const r of allRejects) {
    for (const reason of (r.reasons || [])) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }

  // Run summary.
  const summary = {
    runId: `fun-facts-${startedAt}`,
    startedAt,
    endedAt: nowIso(),
    wallClockSec: Math.round((Date.now() - startedMs) / 1000),
    totalFacts: final.length,
    totalRejects: allRejects.length,
    perCategory: counts,
    rejectReasonBreakdown: reasonCounts,
    bucketsThatGaveUp: bucketResults.filter(b => b && b.gaveUp).map(b => `${b.category}/L${b.wowLevel}`),
    finalPath: FINAL_PATH
  };
  const summaryPath = path.join(OUTPUT_DIR, `run-${startedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n=== RUN SUMMARY ===');
  console.log(`Total facts:       ${final.length} (target 500)`);
  console.log(`Total rejects:     ${allRejects.length}`);
  console.log(`Wall clock:        ${summary.wallClockSec}s (${Math.round(summary.wallClockSec / 60)} min)`);
  console.log('\nPer-category counts:');
  for (const cat of CATEGORIES) {
    const c = counts[cat];
    console.log(`  ${cat.padEnd(15)} L1=${c[1]}  L2=${c[2]}  L3=${c[3]}  total=${c.total}`);
  }
  console.log('\nReject reason breakdown:');
  for (const [reason, n] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(24)} ${n}`);
  }
  if (summary.bucketsThatGaveUp.length) {
    console.log('\nBuckets that gave up (target not hit):');
    for (const b of summary.bucketsThatGaveUp) console.log(`  ${b}`);
  }

  // Spot-check: 5 random facts per category.
  console.log('\n=== SPOT CHECK — 5 random per category ===');
  for (const cat of CATEGORIES) {
    console.log(`\n--- ${cat.toUpperCase()} ---`);
    const inCat = final.filter(f => f.category === cat);
    const sample = [];
    const taken = new Set();
    while (sample.length < Math.min(5, inCat.length)) {
      const idx = Math.floor(Math.random() * inCat.length);
      if (!taken.has(idx)) { taken.add(idx); sample.push(inCat[idx]); }
    }
    for (const f of sample) {
      console.log(`  [L${f.wowLevel}] ${f.fact}`);
    }
  }

  console.log(`\nSummary saved: ${summaryPath}`);
  console.log(`Rejects saved: ${rejectsPath}`);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
