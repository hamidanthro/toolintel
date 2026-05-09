#!/usr/bin/env node
/**
 * TEKS backfill — gpt-4o variant (CLAUDE.md §14 deferred TODO).
 *
 * Forked from teks-backfill.js. Same logic, same output shape, same DDB
 * write discipline (UpdateItem + ConditionExpression attribute_not_exists).
 * Only difference: uses gpt-4o instead of Claude Sonnet 4.5 because
 * Anthropic billing is at $0 on 2026-05-09 and gpt-4o is acceptable for
 * TEKS classification (single-token output, deterministic, low ambiguity
 * task — exactly the kind of work where vendor-correlation isn't a risk).
 *
 * Cost: ~2,140 rows × ~400 in + ~5 out tokens at $2.50 + $10 / 1M
 *   ≈ $5-7 total.
 *
 * Wall-clock: sequential at ~1-2 sec/call ≈ 30-60 min.
 *
 * Output: scripts/cold-start/output/teks-backfill-openai-<UTC>.json
 *
 * Run:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/cold-start/teks-backfill-openai.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const POOL_TABLE = 'staar-content-pool';
const PACK_ROOT = path.resolve(__dirname, '..', '..', 'state-packs');

const OPENAI_MODEL = 'gpt-4o';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
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

async function callOpenAI(systemPrompt, userMessage, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 32,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
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

async function scanRowsMissingTeks() {
  const items = [];
  let last;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: POOL_TABLE,
      FilterExpression: '#st = :s AND #sj = :sj AND #status = :a AND attribute_not_exists(#teks)',
      ExpressionAttributeNames: {
        '#st': 'state', '#sj': 'subject', '#status': 'status', '#teks': 'teks'
      },
      ExpressionAttributeValues: {
        ':s': 'texas', ':sj': 'math', ':a': 'active'
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
      const resp = await callOpenAI(SYSTEM, buildClassifyPrompt(item, teksList), apiKey);
      const raw = resp?.choices?.[0]?.message?.content || '';
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set'); process.exit(1);
  }

  console.log('[backfill] loading TEKS taxonomy...');
  const taxonomy = loadTeksTaxonomy();
  for (const g of Object.keys(taxonomy).sort()) {
    console.log(`  ${g}: ${taxonomy[g].length} TEKS`);
  }

  console.log('[backfill] scanning active math rows lacking teks field...');
  const t0 = Date.now();
  const rows = await scanRowsMissingTeks();
  console.log(`[backfill] found ${rows.length} rows to classify (took ${((Date.now()-t0)/1000).toFixed(1)}s)`);
  if (!rows.length) {
    console.log('[backfill] nothing to do — exiting');
    return;
  }

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
          UpdateExpression: 'SET #teks = :t, #ba = :ts, #bm = :m',
          ConditionExpression: 'attribute_not_exists(#teks)',
          ExpressionAttributeNames: {
            '#teks': 'teks', '#ba': '_teksBackfilledAt', '#bm': '_teksBackfillModel'
          },
          ExpressionAttributeValues: {
            ':t': chosen, ':ts': Date.now(), ':m': OPENAI_MODEL
          }
        }));
        writes++;
        results.push({ contentId: item.contentId, grade: item.grade, teks: chosen });
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') {
          results.push({ contentId: item.contentId, grade: item.grade, teks: chosen, skipped: 'already_set' });
        } else {
          errors++;
          results.push({ contentId: item.contentId, grade: item.grade, teks: null, error: e.message });
        }
      }
    }

    if (Date.now() - lastEmit > 30_000 || (i + 1) % 100 === 0) {
      const elapsedMin = ((Date.now() - tStart) / 60_000).toFixed(1);
      const rate = ((i + 1) / ((Date.now() - tStart) / 60_000)).toFixed(1);
      const eta = ((rows.length - i - 1) / parseFloat(rate)).toFixed(1);
      console.log(`[backfill] ${i+1}/${rows.length}  writes=${writes}  unmatched=${unmatched}  schema=${mismatchSchema}  errors=${errors}  rate=${rate}/min  elapsed=${elapsedMin}m  eta=${eta}m`);
      lastEmit = Date.now();
    }
  }

  const distByTeks = {};
  for (const r of results) {
    if (r.teks) distByTeks[r.teks] = (distByTeks[r.teks] || 0) + 1;
  }
  const sortedDist = Object.entries(distByTeks).sort((a, b) => b[1] - a[1]);

  const totalElapsed = ((Date.now() - tStart) / 60_000).toFixed(1);
  console.log(`\n=== BACKFILL SUMMARY (gpt-4o) ===`);
  console.log(`Total rows scanned:    ${rows.length}`);
  console.log(`Wrote teks:            ${writes}`);
  console.log(`Unmatched:             ${unmatched}`);
  console.log(`Schema-mismatch:       ${mismatchSchema}`);
  console.log(`Errors:                ${errors}`);
  console.log(`Wall-clock:            ${totalElapsed} min`);
  console.log();
  console.log(`Top 15 TEKS by frequency:`);
  for (const [t, n] of sortedDist.slice(0, 15)) console.log(`  ${t}: ${n}`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const outPath = path.join(outDir, `teks-backfill-openai-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    runAt: new Date().toISOString(),
    model: OPENAI_MODEL,
    totalScanned: rows.length,
    writes, unmatched, mismatchSchema, errors,
    walltimeMin: totalElapsed,
    distByTeks,
    results
  }, null, 2));
  console.log(`\nDetailed output: ${outPath}`);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
