#!/usr/bin/env node
/**
 * audit-texas-fallback.js — READ-ONLY scan of staar-content-pool for legacy
 * Texas-fallback contamination and other state-leak / version / shape issues.
 *
 * Why this exists: pre commit a1730a5, the cold-start generator silently
 * fell back to Texas prompts whenever a non-flagship state was requested.
 * Rows generated in that window can carry Texas landmarks in question text,
 * the wrong state's test name (STAAR for non-TX rows), or wrong standards
 * (TEKS for non-TX rows). The tombstone-legacy.js pass deprecated bulk
 * cold-v1 rows but didn't touch content; this audit catches what slipped
 * through and what newer (cold-v2) generation may have re-introduced.
 *
 * USAGE:
 *   cd scripts/lake-audit && npm install && node audit-texas-fallback.js
 *
 * OUTPUT:
 *   scripts/lake-audit/output/audit-<UTC-timestamp>.json
 *   - summary.* — counts only, no row contents
 *   - suspects[] — per-row classification with truncated excerpts
 *
 * NEVER DELETES. NEVER UPDATES. Read-only DynamoDB scan only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const FLAGSHIP_STATES = new Set(['texas', 'california', 'florida', 'new-york']);

// ============================================================
// Heuristic vocabularies
// ============================================================

// Substring matches (case-insensitive). State landmarks/cities. Word
// boundaries are NOT enforced — false positives are acceptable for an
// audit (Hamid eyeballs the JSON before any deletion).
const TEXAS_KEYWORDS_CI = ['Alamo', 'San Antonio', 'Houston', 'Dallas', 'Austin', 'Texas'];
const CALIFORNIA_KEYWORDS_CI = ['California', 'Sacramento', 'Los Angeles'];
const FLORIDA_KEYWORDS_CI = ['Tallahassee', 'Miami'];
const NEW_YORK_KEYWORDS_CI = ['New York City'];

// Case-sensitive markers. Acronym-style strings whose lowercase form is a
// common English word ("FAST", "Regents", "STAAR" etc) — case-sensitive
// reduces noise without losing the real signal.
const CASE_SENSITIVE_TX = ['STAAR'];
const CASE_SENSITIVE_CA = ['CAASPP', 'Smarter Balanced'];
const CASE_SENSITIVE_FL = ['FAST', 'B.E.S.T.'];
const CASE_SENSITIVE_NY = ['Regents', 'NYC'];

// Standards-leak: TEKS in question/explanation but state != texas.
const TEKS_RE = /\bTEKS\b/;

// Test-name-leak: explicit references to "your STAAR test" or similar.
const STAAR_TEST_RE = /\bSTAAR (test|exam|assessment)\b/;

// Heuristic 5: known prompt versions in the lake. Anything not in this set
// (or missing) gets flagged as PROMPT_VERSION_LEGACY.
// Per CLAUDE.md history:
//   cold-v0 / unstamped — pre-versioning, very old
//   cold-v1            — state-aware but with the silent Texas fallback
//   cold-v1-regen      — judge regen path on cold-v1 prompts
//   cold-v2            — current, no fallback, throws on unknown state
//   cold-v2-regen      — judge regen path on cold-v2 prompts
//   reading-v1         — lambda-side reading generator (legitimate)
//   v1                 — lambda-side handleGenerate stamp
const KNOWN_PROMPT_VERSIONS = new Set([
  'cold-v2', 'cold-v2-regen', 'reading-v1', 'v1'
]);
// cold-v0 and cold-v1 are explicitly the legacy buckets.
const LEGACY_PROMPT_VERSIONS = new Set([
  'cold-v0', 'cold-v1', 'cold-v1-regen'
]);

// ============================================================
// Per-row classifier
// ============================================================

function evaluateRow(row) {
  const matches = [];

  const state = String(row.state || '').toLowerCase();
  const question = String(row.question || '');
  const explanation = String(row.explanation || '');
  const passageText = (row.passage && row.passage.text) ? String(row.passage.text) : '';
  const allText = `${question}\n${explanation}\n${passageText}`;
  const allTextLower = allText.toLowerCase();

  // (1) STATE_LEAK_TEXAS — non-texas row with Texas content
  if (state !== 'texas') {
    const hits = [];
    for (const kw of TEXAS_KEYWORDS_CI) {
      if (allTextLower.includes(kw.toLowerCase())) hits.push(kw);
    }
    for (const kw of CASE_SENSITIVE_TX) {
      if (allText.includes(kw)) hits.push(kw);
    }
    if (hits.length) matches.push({ heuristic: 'STATE_LEAK_TEXAS', hits });
  }

  // (2a) STATE_LEAK_CALIFORNIA — non-CA row with CA content
  if (state !== 'california') {
    const hits = [];
    for (const kw of CALIFORNIA_KEYWORDS_CI) {
      if (allTextLower.includes(kw.toLowerCase())) hits.push(kw);
    }
    for (const kw of CASE_SENSITIVE_CA) {
      if (allText.includes(kw)) hits.push(kw);
    }
    if (hits.length) matches.push({ heuristic: 'STATE_LEAK_CALIFORNIA', hits });
  }

  // (2b) STATE_LEAK_FLORIDA — non-FL row with FL content
  if (state !== 'florida') {
    const hits = [];
    for (const kw of FLORIDA_KEYWORDS_CI) {
      if (allTextLower.includes(kw.toLowerCase())) hits.push(kw);
    }
    for (const kw of CASE_SENSITIVE_FL) {
      if (allText.includes(kw)) hits.push(kw);
    }
    if (hits.length) matches.push({ heuristic: 'STATE_LEAK_FLORIDA', hits });
  }

  // (2c) STATE_LEAK_NEW_YORK — non-NY row with NY content
  if (state !== 'new-york') {
    const hits = [];
    for (const kw of NEW_YORK_KEYWORDS_CI) {
      if (allTextLower.includes(kw.toLowerCase())) hits.push(kw);
    }
    for (const kw of CASE_SENSITIVE_NY) {
      if (allText.includes(kw)) hits.push(kw);
    }
    if (hits.length) matches.push({ heuristic: 'STATE_LEAK_NEW_YORK', hits });
  }

  // (3) STANDARDS_LEAK — TEKS referenced for non-texas state
  if (state !== 'texas' && TEKS_RE.test(allText)) {
    matches.push({ heuristic: 'STANDARDS_LEAK', hits: ['TEKS'] });
  }

  // (4) TEST_NAME_LEAK — explicit "STAAR test" / "STAAR exam" for non-TX
  if (state !== 'texas' && STAAR_TEST_RE.test(allText)) {
    matches.push({ heuristic: 'TEST_NAME_LEAK', hits: ['STAAR test/exam/assessment'] });
  }

  // (5) PROMPT_VERSION_LEGACY — cold-v0 or unversioned
  const pv = row.promptVersion;
  if (!pv) {
    matches.push({ heuristic: 'PROMPT_VERSION_LEGACY', hits: ['promptVersion missing'] });
  } else if (LEGACY_PROMPT_VERSIONS.has(pv)) {
    matches.push({ heuristic: 'PROMPT_VERSION_LEGACY', hits: [pv] });
  }

  // (6) MISSING_REQUIRED_FIELDS — broken row shape
  // Schema uses `state` and `correctIndex` (NOT `stateSlug` and `answer`).
  // Choices must be an array of length ≥ 2 to be answerable.
  const missing = [];
  if (!row.question) missing.push('question');
  if (!Array.isArray(row.choices) || row.choices.length < 2) missing.push('choices');
  if (typeof row.correctIndex !== 'number') missing.push('correctIndex');
  if (!row.state) missing.push('state');
  if (missing.length) {
    matches.push({ heuristic: 'MISSING_REQUIRED_FIELDS', hits: missing });
  }

  return matches;
}

function summarize(suspects, totalScanned) {
  const byHeuristic = {};
  const byState = {};
  const byPromptVersion = { missing: 0 };
  const byStatus = {};

  for (const s of suspects) {
    for (const m of s.matches) {
      byHeuristic[m.heuristic] = (byHeuristic[m.heuristic] || 0) + 1;
    }
    const st = s.state || '(unknown)';
    byState[st] = (byState[st] || 0) + 1;
    const pv = s.promptVersion;
    if (!pv) byPromptVersion.missing++;
    else byPromptVersion[pv] = (byPromptVersion[pv] || 0) + 1;
    const status = s.status || '(unknown)';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  // Top 10 states by suspect count
  const topStates = Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((o, [k, v]) => { o[k] = v; return o; }, {});

  return {
    totalScanned,
    totalSuspect: suspects.length,
    suspectFraction: totalScanned ? +(suspects.length / totalScanned).toFixed(4) : 0,
    breakdownByHeuristic: byHeuristic,
    breakdownByStateTop10: topStates,
    breakdownByPromptVersion: byPromptVersion,
    breakdownByStatus: byStatus
  };
}

// ============================================================
// Main
// ============================================================

async function main() {
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `audit-${stamp}.json`);

  console.log(`[audit] table=${TABLE} region=${REGION}`);
  console.log(`[audit] output=${outFile}`);
  console.log(`[audit] heuristics: STATE_LEAK_TEXAS, STATE_LEAK_CALIFORNIA, STATE_LEAK_FLORIDA, STATE_LEAK_NEW_YORK, STANDARDS_LEAK, TEST_NAME_LEAK, PROMPT_VERSION_LEGACY, MISSING_REQUIRED_FIELDS`);
  console.log();

  const suspects = [];
  let totalScanned = 0;
  let lastKey;

  do {
    const params = {
      TableName: TABLE,
      // Drop the embedding to keep response payloads small (each row's
      // embedding is ~7KB; with 12k rows that's >80MB transferred).
      ProjectionExpression: '#s, #st, #pk, contentId, #q, choices, correctIndex, explanation, passage, promptVersion, generatedBy, generatedAt, grade, subject, questionType, qualityScore, reviewStatus, tombstonedAt, tombstoneReason',
      ExpressionAttributeNames: {
        '#s':  'state',
        '#st': 'status',
        '#pk': 'poolKey',
        '#q':  'question'
      }
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const resp = await ddb.send(new ScanCommand(params));
    const items = resp.Items || [];

    for (const row of items) {
      totalScanned++;
      const matches = evaluateRow(row);
      if (matches.length === 0) continue;

      const q = String(row.question || '');
      const ex = String(row.explanation || '');
      suspects.push({
        contentId: row.contentId,
        poolKey: row.poolKey,
        state: row.state,
        subject: row.subject,
        grade: row.grade,
        questionType: row.questionType,
        promptVersion: row.promptVersion || null,
        generatedBy: row.generatedBy || null,
        generatedAt: row.generatedAt || null,
        status: row.status || null,
        reviewStatus: row.reviewStatus || null,
        tombstonedAt: row.tombstonedAt || null,
        questionExcerpt: q.slice(0, 200),
        explanationExcerpt: ex.slice(0, 100),
        matches
      });
    }

    if (totalScanned % 1000 < items.length) {
      console.log(`[audit] scanned=${totalScanned} suspects=${suspects.length}`);
    }

    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);

  const summary = summarize(suspects, totalScanned);
  summary.elapsedMs = Date.now() - startedAt;
  summary.startedAt = new Date(startedAt).toISOString();
  summary.tableName = TABLE;
  summary.region = REGION;

  const output = { summary, suspects };
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log();
  console.log('=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log();
  console.log(`[audit] wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
  console.log(`[audit] elapsed ${(summary.elapsedMs / 1000).toFixed(1)}s`);
  console.log('[audit] DONE — read-only scan complete, NO rows modified');
}

main().catch((err) => {
  console.error('[audit] FATAL:', err && (err.stack || err.message || err));
  process.exit(1);
});
