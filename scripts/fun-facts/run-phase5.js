#!/usr/bin/env node
/**
 * Fun-facts Phase 5 — 1050 new global facts.
 *
 * 5 NEW categories (70 each = 350) + 10 TOP-UP categories (70 each = 700).
 * Targets 70 facts per category. Distribution per category:
 *   wow level 1: 40 facts (foundational)
 *   wow level 2: 20 facts (deeper)
 *   wow level 3: 10 facts (mind-blower)
 *
 * Reads existing data/fun-facts.json, dedups against current IDs +
 * topic angles, generates the gap, appends new facts (preserving the
 * per-category sequence numbers — ff-tx-037 follows ff-tx-036 etc.),
 * writes the merged file back.
 *
 * Quality rules relaxed in generate.js + judge.js:
 *   - Sentence cap 12 → 15 words
 *   - Total length 35 → 40 words
 *   - All other rules unchanged
 *
 * Usage:
 *   ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *     --secret-id staar-tutor/anthropic-api-key \
 *     --region us-east-1 --query SecretString --output text) \
 *     node scripts/fun-facts/run-phase5.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { generateFacts } = require('./generate');
const { judgeFact } = require('./judge');

// ----- Categories -----
const NEW_CATEGORIES = ['dinosaurs', 'music', 'geography', 'robots-tech', 'mythology'];
const TOPUP_CATEGORIES = ['animals', 'space', 'body', 'food', 'sports',
                          'inventions', 'history', 'math-numbers', 'weird-funny', 'texas'];
const ALL_CATEGORIES = NEW_CATEGORIES.concat(TOPUP_CATEGORIES);

const LEVELS = [1, 2, 3];
// 70 per category split 40/20/10 across L1/L2/L3.
const TARGETS = { 1: 40, 2: 20, 3: 10 };
const BUFFER = 1.20;
const MAX_REGEN_ATTEMPTS = 3;
const BUCKET_CONCURRENCY = 3;

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(__dirname, 'output');
const RAW_DIR = path.join(OUTPUT_DIR, 'raw-phase5');
const FINAL_PATH = path.join(ROOT, 'data', 'fun-facts.json');

// ----- ID helpers -----
const CATEGORY_PREFIX = {
  animals: 'an', space: 'sp', body: 'bd', food: 'fd', texas: 'tx',
  sports: 'sg', inventions: 'in', history: 'hi',
  'math-numbers': 'mn', 'weird-funny': 'wf',
  dinosaurs: 'dn', music: 'mu', geography: 'ge',
  'robots-tech': 'rt', mythology: 'my'
};
function categoryPrefix(cat) {
  return CATEGORY_PREFIX[cat] || cat.slice(0, 2);
}
function pad3(n) { return String(n).padStart(3, '0'); }

function ensureDirs() {
  for (const d of [OUTPUT_DIR, RAW_DIR, path.join(ROOT, 'data')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function nowIso() { return new Date().toISOString(); }

// ----- Concurrency helper -----
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

// ----- Existing-state introspection -----
function loadExistingCatalog() {
  let arr = [];
  try {
    const raw = fs.readFileSync(FINAL_PATH, 'utf8');
    arr = JSON.parse(raw);
    if (!Array.isArray(arr)) arr = [];
  } catch (err) {
    console.warn(`[phase5] could not read existing catalog (${err.message}); starting fresh`);
    arr = [];
  }
  return arr;
}

function existingCountsByBucket(catalog) {
  // { [category]: { 1: count, 2: count, 3: count, total } }
  const counts = {};
  for (const cat of ALL_CATEGORIES) counts[cat] = { 1: 0, 2: 0, 3: 0, total: 0 };
  for (const f of catalog) {
    if (!f || !counts[f.category]) continue;
    const lvl = f.wowLevel;
    if (counts[f.category][lvl] === undefined) continue;
    counts[f.category][lvl] += 1;
    counts[f.category].total += 1;
  }
  return counts;
}

// Highest existing per-category sequence — new IDs continue from there.
function maxSeqByCategory(catalog) {
  const max = {};
  for (const cat of ALL_CATEGORIES) max[cat] = 0;
  for (const f of catalog) {
    if (!f || !f.id || !ALL_CATEGORIES.includes(f.category)) continue;
    const m = String(f.id).match(/^ff-[a-z]{2,3}-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max[f.category]) max[f.category] = n;
  }
  return max;
}

// Per-category avoid-list: existing fact texts so generator doesn't repeat.
function avoidListsByCategory(catalog) {
  const out = {};
  for (const cat of ALL_CATEGORIES) out[cat] = [];
  for (const f of catalog) {
    if (!f || !ALL_CATEGORIES.includes(f.category)) continue;
    if (typeof f.fact === 'string') out[f.category].push(f.fact);
  }
  return out;
}

// ----- Per-bucket generation -----
async function processBucket({ category, wowLevel, targetGap, avoidList, apiKey }) {
  const target = targetGap;
  const passes = [];
  const rejects = [];
  let totalGenerated = 0;
  let attempts = 0;
  let gaveUp = false;

  if (target <= 0) {
    return { category, wowLevel, passes, rejects, attempts: 0, totalGenerated: 0, gaveUp: false };
  }

  console.log(`[bucket] ${category}/L${wowLevel} → gap ${target}`);

  // Running avoid-list grows with each successful pass to keep batch
  // diversity high across regen rounds.
  const liveAvoid = avoidList.slice(0, 60);

  while (passes.length < target && attempts < MAX_REGEN_ATTEMPTS) {
    attempts++;
    const need = target - passes.length;
    const askThisRound = Math.max(Math.ceil(need * BUFFER), 5);

    let generated;
    try {
      generated = await generateFacts({
        category, wowLevel, count: askThisRound,
        avoidList: liveAvoid.concat(passes.map(p => p.fact)),
        apiKey
      });
    } catch (err) {
      console.error(`[bucket] ${category}/L${wowLevel} attempt ${attempts} generation failed: ${err.message}`);
      continue;
    }
    totalGenerated += generated.length;

    try {
      fs.writeFileSync(
        path.join(RAW_DIR, `${category}-L${wowLevel}-attempt${attempts}.json`),
        JSON.stringify(generated, null, 2)
      );
    } catch (_) {}

    const peers = generated.map(g => g.fact);
    const verdicts = await mapConcurrent(generated, 4, async (item, i) => {
      const peerList = peers.filter((_, j) => j !== i);
      const v = await judgeFact({
        fact: item.fact, citation: item.citation,
        category, wowLevel, batchPeers: peerList, apiKey
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
          reasons: verdict.reasons, note: verdict.note, source: verdict.source
        });
      }
    }

    const newPasses = verdicts.filter(v => v && !v.__error && v.verdict.verdict === 'pass').length;
    const newRejects = verdicts.filter(v => v && !v.__error && v.verdict.verdict === 'reject').length;
    console.log(`[bucket] ${category}/L${wowLevel} attempt ${attempts}: +${newPasses} passes, ${newRejects} rejects (running ${passes.length}/${target})`);
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
    process.exit(1);
  }

  ensureDirs();
  const startedAt = nowIso();
  const startedMs = Date.now();

  const existing = loadExistingCatalog();
  const existCounts = existingCountsByBucket(existing);
  const seqByCat = maxSeqByCategory(existing);
  const avoidLists = avoidListsByCategory(existing);

  console.log(`[phase5] existing catalog: ${existing.length} facts`);
  for (const cat of ALL_CATEGORIES) {
    const c = existCounts[cat];
    const isNew = NEW_CATEGORIES.includes(cat);
    console.log(`  ${cat.padEnd(15)} L1=${c[1]} L2=${c[2]} L3=${c[3]} total=${c.total} ${isNew ? '(NEW)' : '(top-up)'}`);
  }

  // Build bucket list with per-bucket gap (target - existing).
  const buckets = [];
  for (const category of ALL_CATEGORIES) {
    for (const wowLevel of LEVELS) {
      const existingHere = existCounts[category][wowLevel] || 0;
      const gap = Math.max(0, TARGETS[wowLevel] - existingHere);
      if (gap > 0) buckets.push({ category, wowLevel, targetGap: gap });
    }
  }
  const totalGap = buckets.reduce((s, b) => s + b.targetGap, 0);
  console.log(`\n[phase5] total gap to fill: ${totalGap} facts across ${buckets.length} buckets`);
  console.log(`[phase5] concurrency=${BUCKET_CONCURRENCY}\n`);

  const bucketResults = await mapConcurrent(buckets, BUCKET_CONCURRENCY, async (b) => {
    return processBucket({
      ...b,
      avoidList: avoidLists[b.category] || [],
      apiKey
    });
  });

  // ----- Assembly: append new facts with continued sequence numbers -----
  const newFacts = [];
  const allRejects = [];
  // running per-category sequence cursor — start one after the highest existing
  const seqCursor = {};
  for (const cat of ALL_CATEGORIES) seqCursor[cat] = (seqByCat[cat] || 0) + 1;

  // Walk results in input order so IDs are stable per (category, level).
  for (const r of bucketResults) {
    if (!r || r.__error) continue;
    for (const p of r.passes) {
      const cat = p.category;
      const isTexasRelevant = (cat === 'texas') || /\btexas\b/i.test(p.fact);
      const id = `ff-${categoryPrefix(cat)}-${pad3(seqCursor[cat]++)}`;
      newFacts.push({
        id,
        category: cat,
        fact: p.fact,
        wowLevel: p.wowLevel,
        isTexasRelevant,
        citation: p.citation,
        gradeLevel: '3-4',
        _generatedAt: startedAt,
        _judgedAt: nowIso(),
        _judgeModel: 'claude-sonnet-4-5',
        _judgeConfidence: p._judgeConfidence,
        _judgeNote: p._judgeNote,
        _judgeSource: p._judgeSource,
        _phase: 5
      });
    }
    allRejects.push(...r.rejects);
  }

  const merged = existing.concat(newFacts);
  fs.writeFileSync(FINAL_PATH, JSON.stringify(merged, null, 2));
  console.log(`\n[phase5] ✓ wrote ${merged.length} total facts (existing ${existing.length} + new ${newFacts.length}) to ${FINAL_PATH}`);

  // ----- Reject log -----
  const rejectsPath = path.join(OUTPUT_DIR, `phase5-rejects-${startedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(rejectsPath, JSON.stringify(allRejects, null, 2));

  // ----- Reject reason breakdown -----
  const reasonCounts = {};
  for (const r of allRejects) {
    for (const reason of (r.reasons || [])) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  // ----- Per-category counts post-merge -----
  const finalCounts = {};
  for (const cat of ALL_CATEGORIES) finalCounts[cat] = { 1: 0, 2: 0, 3: 0, total: 0 };
  for (const f of merged) {
    if (!finalCounts[f.category]) continue;
    if (finalCounts[f.category][f.wowLevel] !== undefined) {
      finalCounts[f.category][f.wowLevel] += 1;
      finalCounts[f.category].total += 1;
    }
  }

  // ----- Run summary -----
  const summary = {
    runId: `fun-facts-phase5-${startedAt}`,
    startedAt,
    endedAt: nowIso(),
    wallClockSec: Math.round((Date.now() - startedMs) / 1000),
    existingFacts: existing.length,
    newFacts: newFacts.length,
    totalFacts: merged.length,
    totalRejects: allRejects.length,
    perCategoryFinal: finalCounts,
    rejectReasonBreakdown: reasonCounts,
    bucketsThatGaveUp: bucketResults.filter(b => b && b.gaveUp).map(b => `${b.category}/L${b.wowLevel}`)
  };
  const summaryPath = path.join(OUTPUT_DIR, `run-phase5-${startedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n=== PHASE 5 SUMMARY ===');
  console.log(`Existing facts:    ${existing.length}`);
  console.log(`New facts:         ${newFacts.length}`);
  console.log(`Total facts:       ${merged.length}`);
  console.log(`Total rejects:     ${allRejects.length}`);
  console.log(`Wall clock:        ${summary.wallClockSec}s (${Math.round(summary.wallClockSec / 60)} min)`);

  console.log('\nPer-category final counts (target 70 each):');
  for (const cat of ALL_CATEGORIES) {
    const c = finalCounts[cat];
    const isNew = NEW_CATEGORIES.includes(cat) ? ' (NEW)' : '';
    console.log(`  ${cat.padEnd(15)} L1=${c[1]}  L2=${c[2]}  L3=${c[3]}  total=${c.total}${isNew}`);
  }

  console.log('\nReject reason breakdown:');
  for (const [reason, n] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(24)} ${n}`);
  }
  if (summary.bucketsThatGaveUp.length) {
    console.log('\nBuckets that gave up (target not hit):');
    for (const b of summary.bucketsThatGaveUp) console.log(`  ${b}`);
  }

  // ----- Spot-check -----
  console.log('\n=== SPOT CHECK — 5 random per NEW category ===');
  for (const cat of NEW_CATEGORIES) {
    console.log(`\n--- ${cat.toUpperCase()} ---`);
    const inCat = newFacts.filter(f => f.category === cat);
    const sample = [];
    const taken = new Set();
    while (sample.length < Math.min(5, inCat.length)) {
      const idx = Math.floor(Math.random() * inCat.length);
      if (!taken.has(idx)) { taken.add(idx); sample.push(inCat[idx]); }
    }
    for (const f of sample) console.log(`  [L${f.wowLevel}] ${f.fact}`);
  }

  console.log('\n=== SPOT CHECK — 3 random per TOP-UP category (new facts only) ===');
  for (const cat of TOPUP_CATEGORIES) {
    const inCat = newFacts.filter(f => f.category === cat);
    if (inCat.length === 0) continue;
    console.log(`\n--- ${cat.toUpperCase()} (+${inCat.length}) ---`);
    const sample = [];
    const taken = new Set();
    while (sample.length < Math.min(3, inCat.length)) {
      const idx = Math.floor(Math.random() * inCat.length);
      if (!taken.has(idx)) { taken.add(idx); sample.push(inCat[idx]); }
    }
    for (const f of sample) console.log(`  [L${f.wowLevel}] ${f.fact}`);
  }

  console.log(`\nSummary saved: ${summaryPath}`);
  console.log(`Rejects saved: ${rejectsPath}`);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
