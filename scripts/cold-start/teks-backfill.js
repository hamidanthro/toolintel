#!/usr/bin/env node
/**
 * TEKS backfill (CLAUDE.md §37 v2).
 *
 * Reads every active Texas math row that lacks a `teks` field (the §31
 * sweep predates the §35 wire-up that persists the chosen TEKS), asks
 * Claude Sonnet 4.5 to classify each by best-matching TEKS, writes the
 * inferred TEKS back via UpdateItem with ConditionExpression
 * attribute_not_exists(teks) so we never overwrite an already-set field.
 *
 * Why Claude (not gpt-4o):
 *   - Same vendor as the §33 verifier; cross-vendor reliability for math
 *     judgement.
 *   - Different model family from the OpenAI generator that wrote the
 *     §31 rows in the first place — uncorrelated errors.
 *
 * Cost estimate: ~1,200 rows × ~400 in + ~5 out tokens at $3 + $15 / 1M
 *   ≈ $1.50 - $2 total.
 *
 * Wall-clock estimate: sequential (no concurrency) at ~3-5 sec/call ≈
 *   60-100 min total. Predictable; safe for unattended run.
 *
 * Output: scripts/cold-start/output/teks-backfill-section31-<UTC>.json
 *   with per-row classification, distribution by TEKS, and unmatched count.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const POOL_TABLE = 'staar-content-pool';
const PACK_ROOT = path.resolve(__dirname, '..', '..', 'state-packs');

const ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 30000;

function loadTeksTaxonomy() {
  const f = path.join(PACK_ROOT, 'texas', 'standards', 'teks-math.json');
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const byGrade = {};
  for (const k of Object.keys(data)) {
    if (k.startsWith('_')) continue;
    const grade = k.replace(/^grade_/, 'grade-').replace('algebra_1', 'algebra-1');
    byGrade[grade] = data[k].standards.map(s => ({
      id: s.id, strand: s.strand, text: s.text
    }));
  }
  return byGrade;
}

async function callClaude(systemPrompt, userMessage, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 32,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = `You are an expert classifier of Texas K-12 math questions to TEKS standards.

You will be given a multi-choice math question + the candidate TEKS standards for the question's grade. Your job is to identify the SINGLE best-matching TEKS standard ID.

Rules:
- Output ONLY the standard ID (e.g., "4.2B" or "A.10E"). Nothing else. No explanation, no whitespace beyond the ID itself.
- If genuinely ambiguous between two, return the more specific (longer text or narrower scope).
- If the question genuinely doesn't match any standard in the provided list, return exactly: unmatched
- Match on the underlying math operation / concept, not on surface vocabulary.`;

function buildClassifyPrompt(item, teksList) {
  const choices = (item.choices || []).map((c, i) => `  ${'ABCD'[i]}. ${c}`).join('\n');
  const candidates = teksList.map(t => `  ${t.id}: ${t.text.slice(0, 200)}`).join('\n');
  return `Grade: ${item.grade}
Question type: ${item.questionType || 'multiple_choice'}

Question: ${item.question}

${choices}

Candidate TEKS standards for this grade:
${candidates}

Return only the single best-matching TEKS ID.`;
}

async function scanSection31Rows() {
  const items = [];
  let last;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: POOL_TABLE,
      FilterExpression: '#st = :s AND #sj = :sj AND #status = :a AND begins_with(#srid, :prefix) AND attribute_not_exists(#teks)',
      ExpressionAttributeNames: {
        '#st': 'state', '#sj': 'subject', '#status': 'status',
        '#srid': '_sweepRunId', '#teks': 'teks'
      },
      ExpressionAttributeValues: {
        ':s': 'texas', ':sj': 'math', ':a': 'active',
        ':prefix': 'sweep-texas-math-'
      },
      ProjectionExpression: 'contentId, poolKey, grade, questionType, question, choices, correctIndex, explanation',
      ExclusiveStartKey: last
    }));
    for (const it of (r.Items || [])) items.push(it);
    last = r.LastEvaluatedKey;
  } while (last);
  return items;
}

async function classifyOne(item, teksList, apiKey) {
  const t0 = Date.now();
  let attempts = 0;
  let lastErr = null;
  while (attempts < 3) {
    attempts++;
    try {
      const resp = await callClaude(SYSTEM, buildClassifyPrompt(item, teksList), apiKey);
      const raw = resp?.content?.[0]?.text || '';
      const teks = String(raw).trim();
      const elapsed = Date.now() - t0;
      return { teks, elapsed, attempts };
    } catch (err) {
      lastErr = err;
      if (attempts < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempts));
      }
    }
  }
  return { teks: null, error: lastErr.message, elapsed: Date.now() - t0, attempts };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set'); process.exit(1);
  }

  console.log('[backfill] loading TEKS taxonomy...');
  const taxonomy = loadTeksTaxonomy();
  for (const g of Object.keys(taxonomy).sort()) {
    console.log(`  ${g}: ${taxonomy[g].length} TEKS`);
  }

  console.log('[backfill] scanning §31 rows lacking teks field...');
  const t0 = Date.now();
  const rows = await scanSection31Rows();
  console.log(`[backfill] found ${rows.length} rows to classify (took ${((Date.now()-t0)/1000).toFixed(1)}s)`);
  if (!rows.length) {
    console.log('[backfill] nothing to do — exiting');
    return;
  }

  // Sort by grade so output is reproducible
  rows.sort((a, b) => `${a.grade}|${a.contentId}`.localeCompare(`${b.grade}|${b.contentId}`));

  const knownTeksByGrade = {};
  for (const g of Object.keys(taxonomy)) {
    knownTeksByGrade[g] = new Set(taxonomy[g].map(t => t.id));
  }

  const results = [];
  let writes = 0, unmatched = 0, errors = 0, mismatchSchema = 0;
  const tStart = Date.now();
  let lastEmit = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const teksList = taxonomy[item.grade];
    if (!teksList) {
      console.warn(`[backfill] row ${i} grade=${item.grade} not in taxonomy — skipping`);
      results.push({ contentId: item.contentId, grade: item.grade, teks: null, reason: 'unknown_grade' });
      continue;
    }

    const cls = await classifyOne(item, teksList, apiKey);
    const claimed = cls.teks;
    let chosen = null;
    if (cls.error) {
      errors++;
      results.push({ contentId: item.contentId, grade: item.grade, teks: null, error: cls.error });
    } else if (claimed === 'unmatched') {
      unmatched++;
      results.push({ contentId: item.contentId, grade: item.grade, teks: null, reason: 'classifier_unmatched' });
    } else if (knownTeksByGrade[item.grade].has(claimed)) {
      chosen = claimed;
    } else {
      mismatchSchema++;
      results.push({ contentId: item.contentId, grade: item.grade, teks: null, reason: 'schema_mismatch', claimed });
    }

    if (chosen) {
      try {
        await ddb.send(new UpdateCommand({
          TableName: POOL_TABLE,
          Key: { poolKey: item.poolKey, contentId: item.contentId },
          UpdateExpression: 'SET #teks = :t, #ba = :ts',
          ConditionExpression: 'attribute_not_exists(#teks)',
          ExpressionAttributeNames: { '#teks': 'teks', '#ba': '_teksBackfilledAt' },
          ExpressionAttributeValues: { ':t': chosen, ':ts': Date.now() }
        }));
        writes++;
        results.push({ contentId: item.contentId, grade: item.grade, teks: chosen });
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') {
          // Already had teks set — skip silently
          results.push({ contentId: item.contentId, grade: item.grade, teks: chosen, skipped: 'already_set' });
        } else {
          errors++;
          results.push({ contentId: item.contentId, grade: item.grade, teks: null, error: e.message });
        }
      }
    }

    // Periodic progress
    if (Date.now() - lastEmit > 30_000 || (i + 1) % 100 === 0) {
      const elapsedMin = ((Date.now() - tStart) / 60_000).toFixed(1);
      const rate = ((i + 1) / ((Date.now() - tStart) / 60_000)).toFixed(1);
      const eta = ((rows.length - i - 1) / parseFloat(rate)).toFixed(1);
      console.log(`[backfill] ${i+1}/${rows.length}  writes=${writes}  unmatched=${unmatched}  schema=${mismatchSchema}  errors=${errors}  rate=${rate}/min  elapsed=${elapsedMin}m  eta=${eta}m`);
      lastEmit = Date.now();
    }
  }

  // Build distribution
  const distByTeks = {};
  for (const r of results) {
    if (r.teks) distByTeks[r.teks] = (distByTeks[r.teks] || 0) + 1;
  }
  const sortedDist = Object.entries(distByTeks).sort((a, b) => b[1] - a[1]);

  const totalElapsed = ((Date.now() - tStart) / 60_000).toFixed(1);
  console.log(`\n=== BACKFILL SUMMARY ===`);
  console.log(`Total rows scanned:    ${rows.length}`);
  console.log(`Wrote teks:            ${writes}`);
  console.log(`Unmatched (classifier): ${unmatched}`);
  console.log(`Schema-mismatch:       ${mismatchSchema}`);
  console.log(`Errors:                ${errors}`);
  console.log(`Wall-clock:            ${totalElapsed} min`);
  console.log();
  console.log(`Top 15 TEKS by frequency:`);
  for (const [t, n] of sortedDist.slice(0, 15)) console.log(`  ${t}: ${n}`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const outPath = path.join(outDir, `teks-backfill-section31-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    runAt: new Date().toISOString(),
    totalRows: rows.length,
    writes, unmatched, schemaMismatch: mismatchSchema, errors,
    wallClockMinutes: parseFloat(totalElapsed),
    distributionByTeks: Object.fromEntries(sortedDist),
    perRow: results
  }, null, 2));
  console.log(`\nReport: ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
