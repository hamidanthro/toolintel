#!/usr/bin/env node
/**
 * Mass fun-facts generator — OpenAI fork.
 *
 * Generates THOUSANDS of new fun facts and APPENDS to data/fun-facts.json.
 * Skips ids that already exist (idempotent across re-runs).
 *
 * Per Hamid's spec:
 *   - Thousands of facts; "the most fun ones".
 *   - Global content welcome (kids in USA care about world wonders, food,
 *     animals, traditions). Categorized under existing 15 categories.
 *   - NO controversial content. Strict judge with CONTROVERSIAL failure
 *     mode added on top of the standard 9.
 *   - Grade-band tagged per bucket so the K-2 selector + multi-tag schema
 *     route facts to the right kid.
 *
 * Pipeline (per bucket: category × wowLevel × gradeBand):
 *   1. Generate `askFor` facts via gpt-4o
 *   2. Judge each fact via gpt-4o (factuality + age-fit + controversy)
 *   3. Embedding-dedup against the EXISTING data/fun-facts.json catalog
 *      using OpenAI text-embedding-3-small (cosine ≥ 0.85 → reject)
 *   4. Keep passes; collect rejects with reason
 *   5. Regenerate up to MAX_REGEN_ATTEMPTS times to hit target
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/fun-facts-openai/run-mass.js \
 *     [--target-per-bucket 30] [--write] [--probe] [--gradeBand all|k-2|3-4|5-8]
 *
 * Probe mode (--probe): runs 1 bucket per (cat × gradeBand) at L1 only
 * with target=10. ~150 facts total. Lets a human eyeball quality before
 * committing budget to the full sweep.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateFacts } = require('./generate');
const { judgeFact, FAILURE_MODES } = require('./judge');

const ROOT = path.resolve(__dirname, '..', '..');
const FINAL_PATH = path.join(ROOT, 'data', 'fun-facts.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const RAW_DIR = path.join(OUTPUT_DIR, 'raw');

const CATEGORIES = [
  'animals', 'space', 'body', 'food', 'texas', 'sports', 'inventions',
  'history', 'math-numbers', 'weird-funny', 'dinosaurs', 'music',
  'geography', 'robots-tech', 'mythology'
];
const LEVELS = [1, 2, 3];
const GRADE_BANDS = ['k-2', '3-4', '5-8'];

// Per-bucket target across (category, level, band). For 15 cats × 3 levels
// × 3 bands = 135 buckets. At target=15 per bucket → ~2025 facts. At
// target=20 → ~2700 facts. We'll go with 15 default and let Hamid scale.
const DEFAULT_TARGET = 15;
const BUFFER = 1.30;
const MAX_REGEN_ATTEMPTS = 3;
const BUCKET_CONCURRENCY = 4;
const JUDGE_CONCURRENCY = 4;

// Embedding dedup threshold. Started at 0.85; the probe showed too many
// near-duplicates of widely-known facts (panda 99% bamboo, cheetah speed,
// etc.) hitting the existing-catalog dedup at 0.85. 0.90 still catches
// real same-angle duplicates while leaving room for fresh wording.
const DEDUP_THRESHOLD = 0.90;
const EMBED_MODEL = 'text-embedding-3-small';

const CAT_PREFIX = {
  animals: 'an', space: 'sp', body: 'bd', food: 'fd', texas: 'tx',
  sports: 'sg', inventions: 'in', history: 'hi', 'math-numbers': 'mn',
  'weird-funny': 'wf', dinosaurs: 'dn', music: 'mu', geography: 'ge',
  'robots-tech': 'rt', mythology: 'my'
};

function nowIso() { return new Date().toISOString(); }

function ensureDirs() {
  for (const d of [OUTPUT_DIR, RAW_DIR, path.dirname(FINAL_PATH)]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function parseArgs(argv) {
  const opts = { target: DEFAULT_TARGET, write: false, probe: false, band: 'all' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--target-per-bucket') opts.target = parseInt(argv[++i], 10) || DEFAULT_TARGET;
    else if (argv[i] === '--write') opts.write = true;
    else if (argv[i] === '--probe') opts.probe = true;
    else if (argv[i] === '--gradeBand' || argv[i] === '--band') opts.band = String(argv[++i]).toLowerCase();
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: run-mass.js [--target-per-bucket N] [--write] [--probe] [--band all|k-2|3-4|5-8]');
      process.exit(0);
    }
  }
  return opts;
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

// -------- Embedding helpers --------

async function embedTexts(texts, apiKey) {
  if (!texts || texts.length === 0) return [];
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts })
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.data || []).map(d => d.embedding);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

// -------- ID generation --------

function makeId(category, existingIds) {
  const prefix = CAT_PREFIX[category] || category.slice(0, 2);
  // Find next sequential number after existing ones
  const used = new Set();
  for (const id of existingIds) {
    const m = id.match(new RegExp(`^ff-${prefix}-(\\d+)$`));
    if (m) used.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (used.has(n)) n++;
  while (used.has(n)) n++;  // double check
  used.add(n);
  return `ff-${prefix}-${String(n).padStart(3, '0')}`;
}

// -------- Bucket processor --------

async function processBucket({ category, wowLevel, gradeBand, target, apiKey, existingEmbeddings, existingFacts }) {
  const askFor = Math.ceil(target * BUFFER);
  const passes = [];
  const rejects = [];
  let attempts = 0;
  let totalGenerated = 0;
  let dedupedCount = 0;

  console.log(`[bucket] ${category}/L${wowLevel}/${gradeBand} → target ${target}, asking ${askFor}`);

  while (passes.length < target && attempts < MAX_REGEN_ATTEMPTS) {
    attempts++;
    const need = target - passes.length;
    const askThisRound = Math.max(Math.ceil(need * BUFFER), 5);
    const avoidList = passes.map(p => p.fact);

    let generated;
    try {
      generated = await generateFacts({
        category, wowLevel, count: askThisRound, avoidList, apiKey, gradeBand
      });
    } catch (err) {
      console.error(`[bucket] ${category}/L${wowLevel}/${gradeBand} attempt ${attempts} gen failed: ${err.message}`);
      continue;
    }
    totalGenerated += generated.length;

    // Embedding dedup against existing catalog FIRST (cheaper than judging)
    let newEmbeddings = [];
    try {
      newEmbeddings = await embedTexts(generated.map(g => g.fact), apiKey);
    } catch (err) {
      console.warn(`[bucket] ${category}/L${wowLevel}/${gradeBand} embed failed (continuing without dedup): ${err.message}`);
    }

    const dedupResults = generated.map((g, i) => {
      if (!newEmbeddings[i]) return { fact: g, dup: false, simTo: null };
      let maxSim = 0;
      for (const e of existingEmbeddings) {
        const s = cosine(newEmbeddings[i], e);
        if (s > maxSim) maxSim = s;
      }
      return { fact: g, dup: maxSim >= DEDUP_THRESHOLD, simTo: maxSim };
    });

    const nonDup = dedupResults.filter(r => !r.dup);
    const dups = dedupResults.filter(r => r.dup);
    dedupedCount += dups.length;
    for (const d of dups) {
      rejects.push({ category, wowLevel, gradeBand, fact: d.fact.fact, reasons: ['DEDUP'], note: `cosine ${d.simTo.toFixed(3)}` });
    }

    if (nonDup.length === 0) {
      console.log(`[bucket] ${category}/L${wowLevel}/${gradeBand} attempt ${attempts}: 0 non-dup of ${generated.length} generated`);
      continue;
    }

    // Judge non-dup facts
    const peers = nonDup.map(r => r.fact.fact);
    const verdicts = await mapConcurrent(nonDup, JUDGE_CONCURRENCY, async (item, i) => {
      const peerList = peers.filter((_, j) => j !== i);
      const v = await judgeFact({
        fact: item.fact.fact,
        citation: item.fact.citation,
        category, wowLevel,
        batchPeers: peerList,
        apiKey, gradeBand
      });
      return { item: item.fact, verdict: v, embedding: newEmbeddings[generated.indexOf(item.fact)] };
    });

    for (const r of verdicts) {
      if (r && r.__error) {
        rejects.push({ category, wowLevel, gradeBand, fact: '(judge error)', reasons: ['JUDGE_ERROR'], note: r.__error });
        continue;
      }
      const { item, verdict, embedding } = r;
      if (verdict.verdict === 'pass' && passes.length < target) {
        passes.push({
          fact: String(item.fact || '').trim(),
          citation: String(item.citation || '').trim(),
          category, wowLevel, gradeBand,
          embedding, // keep for in-batch dedup against subsequent passes
          _judgeConfidence: verdict.confidence,
          _judgeNote: verdict.note,
          _judgeSource: verdict.source
        });
        // Add to existing-embeddings pool so subsequent buckets dedup against it too
        if (embedding) existingEmbeddings.push(embedding);
      } else if (verdict.verdict === 'reject') {
        rejects.push({
          category, wowLevel, gradeBand,
          fact: String(item.fact || '').slice(0, 200),
          reasons: verdict.reasons,
          note: verdict.note
        });
      }
    }

    const numPasses = verdicts.filter(v => v && !v.__error && v.verdict.verdict === 'pass').length;
    const numRejects = verdicts.filter(v => v && !v.__error && v.verdict.verdict === 'reject').length;
    console.log(`[bucket] ${category}/L${wowLevel}/${gradeBand} attempt ${attempts}: gen=${generated.length} dup=${dups.length} pass=${numPasses} reject=${numRejects} (running ${passes.length}/${target})`);
  }

  return { category, wowLevel, gradeBand, passes, rejects, attempts, totalGenerated, dedupedCount, gaveUp: passes.length < target };
}

// -------- Main --------

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('FATAL: OPENAI_API_KEY env var not set.');
    process.exit(1);
  }

  const opts = parseArgs(process.argv);
  ensureDirs();

  // Load existing catalog so we can dedup + assign non-conflicting ids
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(FINAL_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[run] could not read existing catalog (starting fresh): ${err.message}`);
  }
  const existingIds = new Set(existing.map(f => f.id));
  const existingFactTexts = existing.map(f => f.fact);
  console.log(`[run] existing catalog: ${existing.length} facts`);

  // Embed existing facts for dedup
  console.log(`[run] embedding ${existingFactTexts.length} existing facts...`);
  const existingEmbeddings = [];
  // Batch embed existing in chunks of 100
  for (let i = 0; i < existingFactTexts.length; i += 100) {
    const chunk = existingFactTexts.slice(i, i + 100);
    const embs = await embedTexts(chunk, apiKey);
    existingEmbeddings.push(...embs);
  }
  console.log(`[run] embedded ${existingEmbeddings.length} existing facts`);

  // Build buckets
  const bands = opts.band === 'all' ? GRADE_BANDS : [opts.band];
  const targetCats = CATEGORIES;
  const targetLevels = opts.probe ? [1] : LEVELS;
  const targetBands = opts.probe ? bands.slice(0, 1) : bands;
  const probeTarget = 10;
  const target = opts.probe ? probeTarget : opts.target;

  const buckets = [];
  for (const category of targetCats) {
    for (const wowLevel of targetLevels) {
      for (const gradeBand of targetBands) {
        buckets.push({ category, wowLevel, gradeBand });
      }
    }
  }

  console.log(`[run] starting ${opts.probe ? 'PROBE' : 'MASS'} — ${buckets.length} buckets, target=${target}/bucket, concurrency=${BUCKET_CONCURRENCY}, write=${opts.write}`);
  console.log(`[run] expected facts: ~${buckets.length * target}`);

  const startedAt = nowIso();
  const startedMs = Date.now();

  const results = await mapConcurrent(buckets, BUCKET_CONCURRENCY, async (b) => {
    return processBucket({ ...b, target, apiKey, existingEmbeddings, existingFacts: existing });
  });

  // Assemble new facts with non-colliding ids
  const allNew = [];
  const allRejects = [];
  let totalGenerated = 0;
  let totalDeduped = 0;
  for (const r of results) {
    if (!r || r.__error) continue;
    totalGenerated += r.totalGenerated || 0;
    totalDeduped += r.dedupedCount || 0;
    for (const p of r.passes) {
      const id = makeId(p.category, existingIds);
      existingIds.add(id);
      allNew.push({
        id,
        category: p.category,
        fact: p.fact,
        wowLevel: p.wowLevel,
        isTexasRelevant: p.category === 'texas' || /\bTexas\b/.test(p.fact),
        citation: p.citation,
        gradeLevel: p.gradeBand,
        gradeLevels: [p.gradeBand],
        _generatedAt: nowIso(),
        _judgedAt: nowIso(),
        _judgeModel: 'gpt-4o',
        _judgeConfidence: p._judgeConfidence,
        _judgeNote: p._judgeNote,
        _judgeSource: p._judgeSource,
        _phase: 'mass-openai-v1'
      });
    }
    for (const rej of r.rejects) allRejects.push(rej);
  }

  const elapsedSec = ((Date.now() - startedMs) / 1000).toFixed(1);
  const summary = {
    startedAt,
    completedAt: nowIso(),
    elapsedSec,
    bucketsProcessed: results.length,
    bucketsGaveUp: results.filter(r => r && r.gaveUp).length,
    target,
    totalGenerated,
    totalDeduped,
    totalPassed: allNew.length,
    totalRejected: allRejects.length,
    rejectionRate: totalGenerated ? ((allRejects.length / totalGenerated) * 100).toFixed(1) + '%' : 'n/a'
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  // Write run report
  const stamp = nowIso().replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `mass-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    summary, opts, results: results.map(r => ({
      category: r.category, wowLevel: r.wowLevel, gradeBand: r.gradeBand,
      attempts: r.attempts, totalGenerated: r.totalGenerated,
      dedupedCount: r.dedupedCount, gaveUp: r.gaveUp,
      passCount: r.passes.length, rejectCount: r.rejects.length
    }))
  }, null, 2));
  console.log(`[run] report → ${reportPath}`);

  const rejectsPath = path.join(OUTPUT_DIR, `mass-${stamp}-rejects.json`);
  fs.writeFileSync(rejectsPath, JSON.stringify(allRejects, null, 2));
  console.log(`[run] rejects → ${rejectsPath}`);

  const newFactsPath = path.join(OUTPUT_DIR, `mass-${stamp}-new-facts.json`);
  fs.writeFileSync(newFactsPath, JSON.stringify(allNew, null, 2));
  console.log(`[run] new facts → ${newFactsPath}`);

  if (opts.write && allNew.length > 0) {
    const merged = existing.concat(allNew);
    fs.writeFileSync(FINAL_PATH, JSON.stringify(merged, null, 2) + '\n');
    console.log(`[run] APPENDED ${allNew.length} facts to ${FINAL_PATH} (total now ${merged.length})`);
  } else if (!opts.write) {
    console.log(`[run] DRY-RUN — to merge into catalog, re-run with --write`);
  }
}

if (require.main === module) {
  main().catch(err => { console.error('fatal:', err); process.exit(1); });
}
