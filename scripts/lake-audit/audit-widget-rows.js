#!/usr/bin/env node
/**
 * §110 phase 20b — comprehensive widget-row audit.
 *
 * Scans every widget row in staar-content-pool and applies per-
 * widget-type DETERMINISTIC checks (no LLM, no eyeball — just math).
 *
 * Classifies each row:
 *   OK                  — passed all checks
 *   BUG_CORRECT_INDEX   — correctIndex out of range or pointing at
 *                         wrong choice text
 *   BUG_MATH            — the marked choice's value doesn't match
 *                         what the stimulus says (e.g., clock shows
 *                         5:00 but correct choice is '6:00')
 *   BUG_DUP_DISTRACTOR  — duplicate choices, or a distractor is
 *                         mathematically equivalent to the correct
 *   BUG_SCHEMA          — widget spec violates its __validate contract
 *   BUG_FRACBAR_EQ      — fraction-bar correct choice not in lowest
 *                         terms or stem-named fraction can't be
 *                         determined
 *   NEEDS_EYEBALL       — couldn't deterministically classify (stem
 *                         too ambiguous, free-form question)
 *
 * Output: scripts/lake-audit/output/widget-audit-<UTC>.json
 *
 * Usage:
 *   AWS_REGION=us-east-1 node scripts/lake-audit/audit-widget-rows.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const POOL_KEYS = [
  'texas#grade-k#math#teks-concept',
  'texas#grade-2#math#teks-concept',
  'texas#grade-3#math#teks-concept',
  'texas#grade-3#math#teks-word-problem',
  'texas#grade-3#math#teks-data-interpretation',
  'texas#grade-4#math#teks-concept',
  'texas#grade-4#math#teks-computation'
];

const { validateWidgetSpec } = require('../../lambda/widget-validators');

// ============================================================
// PER-TYPE DETERMINISTIC CHECKS
// ============================================================

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lowestTerms(n, d) {
  if (d === 0) return null;
  const g = gcd(Math.abs(n), Math.abs(d));
  return { n: n / g, d: d / g };
}

// Parse "1/3" or "1 1/2" or "0.5" or "5" into {num, den} or {value}.
function parseFraction(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return { num: parseInt(mixed[1]) * parseInt(mixed[3]) + parseInt(mixed[2]), den: parseInt(mixed[3]) };
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return { num: parseInt(frac[1]), den: parseInt(frac[2]) };
  const dec = s.match(/^\d+(\.\d+)?$/);
  if (dec) return { num: parseFloat(s), den: 1 };
  return null;
}

// Extract a fraction naming from a stem. Recognizes:
//   "Which model represents 1/3?"        → 1/3
//   "shades 2/8 of the rectangle"        → 2/8
//   "Maria divides a rectangle into 4 equal parts. She shades 3 of them."
//   "cuts a rectangle into 5 equal parts and shades all of them"  (all=5/5)
//   "shades 1 of them"                   (need preceding 'into N parts')
function extractStemFraction(stem) {
  if (typeof stem !== 'string') return null;
  // Direct N/N fraction
  const m = stem.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return { num: parseInt(m[1]), den: parseInt(m[2]) };
  // "into N equal parts/pieces" + various shading verbs
  const partsMatch = stem.match(/into\s+(\d+)\s+(?:equal\s+)?(?:parts?|pieces?)/i);
  if (partsMatch) {
    const den = parseInt(partsMatch[1]);
    const shadesAll = /shades?\s+all|shaded\s+all|all\s+of\s+them|all\s+of\s+the/i.test(stem);
    if (shadesAll) return { num: den, den };
    // shades/shaded/eats/ate/colors/colored N
    const shadeM = stem.match(/(?:shades?|shaded|eats?|ate|colors?|colored|fills?|filled|pick(?:s|ed)?|takes?|took)\s+(\d+)/i);
    if (shadeM) return { num: parseInt(shadeM[1]), den };
  }
  // "X out of Y" pattern: "with 2 out of 6 equal parts shaded"
  const outOf = stem.match(/(\d+)\s+out\s+of\s+(\d+)/i);
  if (outOf) return { num: parseInt(outOf[1]), den: parseInt(outOf[2]) };
  return null;
}

// Extract first integer in a text choice like "40 sq cm" or "$240".
function parseFirstInteger(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0]) : null;
}

function checkFractionBarChoices(row) {
  const choices = row.choices;
  if (!Array.isArray(choices) || choices.length !== 4) return { bug: 'BUG_SCHEMA', reason: 'choices not 4' };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci > 3) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range: ' + ci };
  for (let i = 0; i < 4; i++) {
    const c = choices[i];
    if (!c || typeof c !== 'object' || c.type !== 'fraction-bar') return { bug: 'BUG_SCHEMA', reason: 'choice[' + i + '] not fraction-bar widget' };
    const wErr = validateWidgetSpec(c);
    if (wErr) return { bug: 'BUG_SCHEMA', reason: 'choice[' + i + '] ' + wErr };
  }
  // Extract the stem-named fraction.
  const stemFrac = extractStemFraction(row.question || row.prompt || '');
  if (!stemFrac) return { bug: 'NEEDS_EYEBALL', reason: 'cant extract fraction from stem' };
  // Correct choice must visualize the stem fraction (in any form;
  // lowest-terms reduction match).
  const correct = choices[ci];
  const correctReduced = lowestTerms(correct.filled, correct.parts);
  const stemReduced = lowestTerms(stemFrac.num, stemFrac.den);
  if (!correctReduced || !stemReduced) return { bug: 'BUG_MATH', reason: 'cant reduce' };
  if (correctReduced.n !== stemReduced.n || correctReduced.d !== stemReduced.d) {
    return { bug: 'BUG_MATH', reason: 'correct choice visualizes ' + correct.filled + '/' + correct.parts + ' = ' + correctReduced.n + '/' + correctReduced.d + ', stem names ' + stemFrac.num + '/' + stemFrac.den };
  }
  // No distractor should be mathematically equivalent to the correct.
  for (let i = 0; i < 4; i++) {
    if (i === ci) continue;
    const d = choices[i];
    const dr = lowestTerms(d.filled, d.parts);
    if (!dr) continue;
    if (dr.n === correctReduced.n && dr.d === correctReduced.d) {
      return { bug: 'BUG_DUP_DISTRACTOR', reason: 'distractor[' + i + '] = ' + d.filled + '/' + d.parts + ' is equivalent to correct' };
    }
  }
  return { bug: null };
}

function checkClockFace(row) {
  const stim = row.stimulus;
  if (!stim || stim.type !== 'clock-face') return { bug: 'BUG_SCHEMA', reason: 'no clock-face stimulus' };
  const wErr = validateWidgetSpec(stim);
  if (wErr) return { bug: 'BUG_SCHEMA', reason: 'stim: ' + wErr };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci >= row.choices.length) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range' };
  const correct = row.choices[ci];
  if (typeof correct !== 'string') return { bug: 'BUG_SCHEMA', reason: 'correct choice not string' };
  const mm = stim.minute < 10 ? '0' + stim.minute : '' + stim.minute;
  const expected = stim.hour + ':' + mm;
  if (correct.trim() !== expected) {
    return { bug: 'BUG_MATH', reason: 'clock shows ' + expected + ' but marked choice is "' + correct + '"' };
  }
  // No distractor should equal the correct.
  for (let i = 0; i < row.choices.length; i++) {
    if (i === ci) continue;
    if (String(row.choices[i]).trim() === expected) {
      return { bug: 'BUG_DUP_DISTRACTOR', reason: 'distractor[' + i + '] = "' + row.choices[i] + '" matches correct' };
    }
  }
  return { bug: null };
}

function checkBase10Blocks(row) {
  const stim = row.stimulus;
  if (!stim || stim.type !== 'base-10-blocks') return { bug: 'BUG_SCHEMA', reason: 'no base-10-blocks stimulus' };
  const wErr = validateWidgetSpec(stim);
  if (wErr) return { bug: 'BUG_SCHEMA', reason: 'stim: ' + wErr };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci >= row.choices.length) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range' };
  const expected = (stim.hundreds || 0) * 100 + (stim.tens || 0) * 10 + (stim.ones || 0);
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== expected) {
    return { bug: 'BUG_MATH', reason: 'blocks total ' + expected + ' but marked choice = "' + row.choices[ci] + '" (=' + correctVal + ')' };
  }
  return { bug: null };
}

function checkAreaModel(row) {
  const stim = row.stimulus;
  if (!stim || stim.type !== 'area-model') return { bug: 'BUG_SCHEMA', reason: 'no area-model stimulus' };
  const wErr = validateWidgetSpec(stim);
  if (wErr) return { bug: 'BUG_SCHEMA', reason: 'stim: ' + wErr };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci >= row.choices.length) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range' };
  // Multiplication-mode only (fractionGrid mode is a separate flavor).
  if (stim.fractionGrid) return { bug: 'NEEDS_EYEBALL', reason: 'fractionGrid mode — manual check' };
  if (!Array.isArray(stim.rows) || !Array.isArray(stim.cols)) return { bug: 'BUG_SCHEMA', reason: 'rows/cols not arrays' };
  const sumR = stim.rows.reduce((a, b) => a + b, 0);
  const sumC = stim.cols.reduce((a, b) => a + b, 0);
  const expected = sumR * sumC;
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== expected) {
    return { bug: 'BUG_MATH', reason: 'rows=' + sumR + ' × cols=' + sumC + ' = ' + expected + ' but marked choice = "' + row.choices[ci] + '"' };
  }
  return { bug: null };
}

function checkPlotter(row) {
  const stim = row.stimulus;
  if (!stim || stim.type !== 'plotter') return { bug: 'BUG_SCHEMA', reason: 'no plotter stimulus' };
  const wErr = validateWidgetSpec(stim);
  if (wErr) return { bug: 'BUG_SCHEMA', reason: 'stim: ' + wErr };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci >= row.choices.length) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range' };
  // Plotter questions ask "how many more / how many / total / fewest /
  // most" — parsing the natural-language stem deterministically is
  // hard. Do a SOFT check: the marked choice must be a non-negative
  // integer OR a category name from stim.categories. Anything else
  // is a strong signal of a bug.
  const correct = String(row.choices[ci]).trim();
  const categories = (stim.categories || []).map(c => String(c).trim());
  const isCategory = categories.includes(correct);
  const correctNum = parseFirstInteger(correct);
  if (!isCategory && correctNum === null) {
    return { bug: 'BUG_MATH', reason: 'plotter correct choice "' + correct + '" is neither a category nor an integer' };
  }
  // Sanity check: marked answer (if numeric) must be in the
  // possible-answer set for the chart values (sum / diff / max / individual).
  if (!isCategory && correctNum !== null) {
    const vals = (stim.values || []).slice();
    const possible = new Set();
    vals.forEach(v => possible.add(v));
    for (let i = 0; i < vals.length; i++) {
      for (let j = 0; j < vals.length; j++) {
        if (i === j) continue;
        possible.add(Math.abs(vals[i] - vals[j]));
        possible.add(vals[i] + vals[j]);
      }
    }
    possible.add(vals.reduce((a, b) => a + b, 0));
    possible.add(Math.max.apply(null, vals));
    possible.add(Math.min.apply(null, vals));
    if (!possible.has(correctNum)) {
      return { bug: 'BUG_MATH', reason: 'plotter correct ' + correctNum + ' not derivable from values [' + vals.join(',') + ']' };
    }
  }
  return { bug: null };
}

function checkNumberLine(row) {
  const stim = row.stimulus;
  if (!stim || stim.type !== 'number-line') return { bug: 'BUG_SCHEMA', reason: 'no number-line stimulus' };
  const wErr = validateWidgetSpec(stim);
  if (wErr) return { bug: 'BUG_SCHEMA', reason: 'stim: ' + wErr };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci >= row.choices.length) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range' };
  // Number-line questions ask for the fraction at the marker. Marker
  // value is stim.marks[0].at (decimal). Correct choice is a fraction
  // string. Convert and compare.
  if (!Array.isArray(stim.marks) || stim.marks.length === 0) return { bug: 'NEEDS_EYEBALL', reason: 'no marks on number-line' };
  const markAt = stim.marks[0].at;
  if (typeof markAt !== 'number') return { bug: 'BUG_SCHEMA', reason: 'mark.at not number' };
  const correctStr = String(row.choices[ci]).trim();
  const correctFrac = parseFraction(correctStr);
  if (!correctFrac) return { bug: 'NEEDS_EYEBALL', reason: 'correct "' + correctStr + '" not parseable as fraction' };
  const correctDec = correctFrac.num / correctFrac.den;
  // Allow small tolerance for floating-point.
  if (Math.abs(correctDec - markAt) > 0.02) {
    return { bug: 'BUG_MATH', reason: 'marker at ' + markAt + ' but correct "' + correctStr + '" = ' + correctDec };
  }
  return { bug: null };
}

function checkTapeDiagram(row) {
  const stim = row.stimulus;
  if (!stim || stim.type !== 'tape-diagram') return { bug: 'BUG_SCHEMA', reason: 'no tape-diagram stimulus' };
  const wErr = validateWidgetSpec(stim);
  if (wErr) return { bug: 'BUG_SCHEMA', reason: 'stim: ' + wErr };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci >= row.choices.length) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range' };
  const parts = stim.parts;
  if (!Array.isArray(parts)) return { bug: 'BUG_SCHEMA', reason: 'parts not array' };
  // Find the unknown cell (label === '?').
  const knownVals = parts.filter(p => p.label !== '?').map(p => parseInt(p.label, 10));
  const unknownCount = parts.filter(p => p.label === '?').length;
  const totalNum = parseInt(stim.total, 10);
  if (unknownCount !== 1) return { bug: 'NEEDS_EYEBALL', reason: 'expected exactly 1 ? cell, got ' + unknownCount };
  if (!Number.isFinite(totalNum)) return { bug: 'NEEDS_EYEBALL', reason: 'total not integer: ' + stim.total };
  if (knownVals.some(v => !Number.isFinite(v))) return { bug: 'NEEDS_EYEBALL', reason: 'some known labels not integer' };
  const expected = totalNum - knownVals.reduce((a, b) => a + b, 0);
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== expected) {
    return { bug: 'BUG_MATH', reason: 'total ' + totalNum + ' - known(' + knownVals.join('+') + '=' + knownVals.reduce((a,b)=>a+b,0) + ') = ' + expected + ' but marked = "' + row.choices[ci] + '"' };
  }
  return { bug: null };
}

function checkShape2d(row) {
  const stim = row.stimulus;
  if (!stim || stim.type !== 'shape-2d') return { bug: 'BUG_SCHEMA', reason: 'no shape-2d stimulus' };
  const wErr = validateWidgetSpec(stim);
  if (wErr) return { bug: 'BUG_SCHEMA', reason: 'stim: ' + wErr };
  const ci = row.correctIndex;
  if (!Number.isInteger(ci) || ci < 0 || ci >= row.choices.length) return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex out of range' };
  // shape-2d stems vary: area, perimeter, classification. We can
  // deterministically check ONLY when stem mentions 'area' or 'perimeter'
  // and labels include numeric dimensions.
  const stem = (row.question || row.prompt || '').toLowerCase();
  const labels = stim.labels || {};
  const asksArea = /\barea\b/.test(stem);
  const asksPerim = /\bperimeter\b/.test(stem);
  if (!asksArea && !asksPerim) return { bug: 'NEEDS_EYEBALL', reason: 'stem does not mention area or perimeter' };
  // Try to parse width/height (or leg1/leg2 for right-triangle).
  function numFromLabel(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  const w = numFromLabel(labels.width) || numFromLabel(labels.leg1) || numFromLabel(labels.base);
  const h = numFromLabel(labels.height) || numFromLabel(labels.leg2);
  if (w == null || h == null) return { bug: 'NEEDS_EYEBALL', reason: 'cant parse dimensions' };
  let expected;
  if (stim.shape === 'rectangle' || stim.shape === 'square') {
    expected = asksArea ? w * h : 2 * (w + h);
  } else if (stim.shape === 'right-triangle') {
    expected = asksArea ? 0.5 * w * h : null;
  } else {
    return { bug: 'NEEDS_EYEBALL', reason: 'shape ' + stim.shape + ' calc rule not encoded' };
  }
  if (expected == null) return { bug: 'NEEDS_EYEBALL', reason: 'cant compute expected' };
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== Math.round(expected)) {
    return { bug: 'BUG_MATH', reason: stim.shape + ' ' + (asksArea ? 'area' : 'perimeter') + ' = ' + expected + ' but marked = "' + row.choices[ci] + '"' };
  }
  return { bug: null };
}

// ============================================================
// Dispatcher
// ============================================================

function checkRow(row) {
  // Decide which check by widget type
  const stim = row.stimulus;
  const hasObjChoice = Array.isArray(row.choices) && row.choices.some(c => c && typeof c === 'object' && c.type);
  // Common pre-checks
  if (!Array.isArray(row.choices) || row.choices.length < 2) return { bug: 'BUG_SCHEMA', reason: 'choices < 2' };
  if (!Number.isInteger(row.correctIndex) || row.correctIndex < 0 || row.correctIndex >= row.choices.length) {
    return { bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex ' + row.correctIndex + ' for ' + row.choices.length + ' choices' };
  }

  if (hasObjChoice && row.choices.every(c => c && typeof c === 'object' && c.type === 'fraction-bar')) {
    return checkFractionBarChoices(row);
  }
  if (stim && typeof stim === 'object') {
    switch (stim.type) {
      case 'clock-face':      return checkClockFace(row);
      case 'base-10-blocks':  return checkBase10Blocks(row);
      case 'area-model':      return checkAreaModel(row);
      case 'plotter':         return checkPlotter(row);
      case 'number-line':     return checkNumberLine(row);
      case 'tape-diagram':    return checkTapeDiagram(row);
      case 'shape-2d':        return checkShape2d(row);
      default:                return { bug: 'NEEDS_EYEBALL', reason: 'unknown stim type: ' + stim.type };
    }
  }
  return { bug: 'NEEDS_EYEBALL', reason: 'no stimulus + no widget choices' };
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('[audit-widgets] starting');
  const allRows = [];
  for (const pk of POOL_KEYS) {
    console.log('[audit-widgets] scanning ' + pk);
    let lastKey;
    do {
      const r = await ddb.send(new QueryCommand({
        TableName: 'staar-content-pool',
        KeyConditionExpression: 'poolKey = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: lastKey
      }));
      for (const it of (r.Items || [])) {
        const hasObjChoice = Array.isArray(it.choices) && it.choices.some(c => c && typeof c === 'object' && c.type);
        const hasStim = it.stimulus && typeof it.stimulus === 'object' && it.stimulus.type;
        if (hasObjChoice || hasStim) allRows.push(it);
      }
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);
  }
  console.log('[audit-widgets] total widget rows: ' + allRows.length);

  // Partition by status so already-tombstoned rows don't muddy the
  // active-row summary. Active = served to kids; broken = audit-flagged
  // and excluded by lambda.
  const byBug = { ACTIVE: {}, BROKEN: {} };
  const details = [];
  for (const row of allRows) {
    const verdict = checkRow(row);
    const bug = verdict.bug || 'OK';
    const bucket = row.status === 'broken' ? 'BROKEN' : 'ACTIVE';
    byBug[bucket][bug] = (byBug[bucket][bug] || 0) + 1;
    details.push({
      contentId: row.contentId,
      poolKey: row.poolKey,
      status: row.status || 'active',
      widgetMode: row._widgetMode || null,
      stimulusType: row.stimulus && row.stimulus.type,
      bug,
      reason: verdict.reason || null,
      stem: (row.question || row.prompt || '').slice(0, 100),
      correctIndex: row.correctIndex,
      correctChoice: row.choices && row.choices[row.correctIndex]
    });
  }

  console.log('\n[audit-widgets] ----- SUMMARY -----');
  console.log(JSON.stringify(byBug, null, 2));

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'widget-audit-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary: byBug, totalRows: allRows.length, details }, null, 2));
  console.log('[audit-widgets] output: ' + outFile);
}

main().catch(err => { console.error(err); process.exit(1); });
