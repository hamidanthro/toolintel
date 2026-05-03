#!/usr/bin/env node
/**
 * uniqueness-report.js — read-only report on duplicates in the active
 * question set of staar-content-pool.
 *
 * Two duplicate-detection methods, both bounded to active rows:
 *   (a) EXACT_TEXT — group by question.toLowerCase().replace(/\s+/g,' ').trim()
 *   (b) EMBEDDING_SIM — cosine similarity ≥ 0.92 between rows in the
 *       SAME poolKey bucket. Cross-poolKey pairs are NOT flagged
 *       (state-flavor differences are by design — a Texas grade-3 question
 *       and an Alabama grade-3 question can be similar without that being
 *       a duplicate.)
 *
 * READ-ONLY by construction:
 *   - imports only ScanCommand
 *   - never imports PutCommand / UpdateCommand / DeleteCommand
 *
 * Cosine-sim is O(N^2) within each poolKey bucket. Most buckets are
 * small (a few dozen rows) so this is cheap. Largest buckets in the
 * lake are <200 rows → 40k pair comparisons each, sub-second.
 *
 * Usage:
 *   node scripts/lake-audit/uniqueness-report.js
 *
 * Output: scripts/lake-audit/output/uniqueness-report-<UTC>.json
 *   {
 *     summary: {
 *       totalActive, uniqueByExactText,
 *       exactDuplicateGroupCount, totalRowsInExactDupGroups,
 *       embeddingDuplicatePairCount, totalRowsInEmbeddingDupPairs,
 *       totalRowsWithAnyDuplicate, percentLakeWithDuplicate
 *     },
 *     exactDuplicateGroups: [[contentId, contentId, ...], ...],
 *     embeddingDuplicatePairs: [{ a, b, cosineSim, poolKey }, ...]
 *   }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = 'staar-content-pool';
const REGION = process.env.AWS_REGION || 'us-east-1';
const COSINE_THRESHOLD = 0.92;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function normalizeText(s) {
  if (typeof s !== 'string') return '';
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}
function cosine(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

(async () => {
  const startedAt = new Date().toISOString();
  console.log(`[uniqueness] scanning active rows in ${TABLE}…`);

  const items = [];
  let last;
  let pages = 0;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#s = :a',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':a': 'active' },
      ProjectionExpression: 'contentId, poolKey, question, embedding',
      ExclusiveStartKey: last
    }));
    for (const it of (r.Items || [])) items.push(it);
    last = r.LastEvaluatedKey;
    pages++;
    if (pages % 5 === 0) console.log(`[uniqueness] scan progress: ${items.length} rows so far (page ${pages})`);
  } while (last);
  console.log(`[uniqueness] scan complete: ${items.length} active rows`);

  // ---- (a) EXACT_TEXT duplicate groups ----
  const byText = new Map();
  for (const it of items) {
    const key = normalizeText(it.question || '');
    if (!key) continue;
    if (!byText.has(key)) byText.set(key, []);
    byText.get(key).push(it.contentId);
  }
  const exactDuplicateGroups = [];
  let totalRowsInExactDupGroups = 0;
  const exactDupContentIds = new Set();
  for (const [, ids] of byText) {
    if (ids.length > 1) {
      exactDuplicateGroups.push(ids);
      totalRowsInExactDupGroups += ids.length;
      for (const id of ids) exactDupContentIds.add(id);
    }
  }
  // Sort by group size desc for the top-N report
  exactDuplicateGroups.sort((a, b) => b.length - a.length);

  // ---- (b) EMBEDDING_SIM within poolKey ----
  const byPool = new Map();
  for (const it of items) {
    if (!Array.isArray(it.embedding) || !it.embedding.length) continue;
    if (!byPool.has(it.poolKey)) byPool.set(it.poolKey, []);
    byPool.get(it.poolKey).push(it);
  }

  const embeddingDuplicatePairs = [];
  const embDupContentIds = new Set();
  let totalPairsCompared = 0;
  for (const [poolKey, rows] of byPool) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        totalPairsCompared++;
        const sim = cosine(rows[i].embedding, rows[j].embedding);
        if (sim >= COSINE_THRESHOLD) {
          embeddingDuplicatePairs.push({
            a: rows[i].contentId,
            b: rows[j].contentId,
            cosineSim: Number(sim.toFixed(4)),
            poolKey
          });
          embDupContentIds.add(rows[i].contentId);
          embDupContentIds.add(rows[j].contentId);
        }
      }
    }
  }
  embeddingDuplicatePairs.sort((a, b) => b.cosineSim - a.cosineSim);

  // ---- summary ----
  const allDupContentIds = new Set([...exactDupContentIds, ...embDupContentIds]);
  const totalActive = items.length;
  const uniqueByExactText = byText.size;
  const summary = {
    totalActive,
    uniqueByExactText,
    rowsWithEmbedding: byPool.size > 0
      ? Array.from(byPool.values()).reduce((acc, arr) => acc + arr.length, 0) : 0,
    poolKeyBuckets: byPool.size,
    embeddingPairsCompared: totalPairsCompared,
    cosineThreshold: COSINE_THRESHOLD,
    exactDuplicateGroupCount: exactDuplicateGroups.length,
    totalRowsInExactDupGroups,
    embeddingDuplicatePairCount: embeddingDuplicatePairs.length,
    totalRowsInEmbeddingDupPairs: embDupContentIds.size,
    totalRowsWithAnyDuplicate: allDupContentIds.size,
    percentLakeWithDuplicate: totalActive > 0
      ? Number((100 * allDupContentIds.size / totalActive).toFixed(2)) : 0,
    startedAt,
    finishedAt: new Date().toISOString()
  };

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
  const outPath = path.join(outDir, `uniqueness-report-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    summary, exactDuplicateGroups, embeddingDuplicatePairs
  }, null, 2));

  console.log('');
  console.log('===== SUMMARY =====');
  console.log(JSON.stringify(summary, null, 2));
  console.log('');
  console.log(`=== Top 5 exact-text duplicate groups (group size desc) ===`);
  for (const g of exactDuplicateGroups.slice(0, 5)) {
    console.log(`  ${g.length} rows: ${g.slice(0, 3).join(', ')}${g.length > 3 ? ', …' : ''}`);
  }
  console.log('');
  console.log(`=== Top 5 embedding-sim pairs (cosine desc) ===`);
  for (const p of embeddingDuplicatePairs.slice(0, 5)) {
    console.log(`  cos=${p.cosineSim} poolKey=${p.poolKey}`);
    console.log(`    a=${p.a} b=${p.b}`);
  }
  console.log('');
  console.log(`Output: ${outPath}`);
})().catch(e => { console.error('FATAL:', e && (e.stack || e.message || e)); process.exit(1); });
