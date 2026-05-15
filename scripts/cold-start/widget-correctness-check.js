/**
 * Deterministic widget-row correctness checker.
 *
 * Pure-logic mirror of scripts/lake-audit/audit-widget-rows.js's
 * checkRow() function. Shipped as a standalone module so both:
 *   - scripts/lake-audit/audit-widget-rows.js (audit live lake rows)
 *   - scripts/cold-start/probe-widgets*.js   (pre-save check during
 *     generation — catches the bug class BEFORE it reaches the lake)
 *
 * Input: a candidate row {question, stimulus?, choices, correctIndex, ...}
 * Output: { ok: true } OR { ok: false, bug: 'BUG_*', reason: '...' }
 *
 * The two files MUST stay in sync. Tests:
 *   node scripts/cold-start/widget-correctness-check.test.js
 */
'use strict';

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lowestTerms(n, d) {
  if (d === 0) return null;
  const g = gcd(Math.abs(n), Math.abs(d));
  return { n: n / g, d: d / g };
}

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

function extractStemFraction(stem) {
  if (typeof stem !== 'string') return null;
  const m = stem.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return { num: parseInt(m[1]), den: parseInt(m[2]) };
  const partsMatch = stem.match(/into\s+(\d+)\s+(?:equal\s+)?(?:parts?|pieces?)/i);
  if (partsMatch) {
    const den = parseInt(partsMatch[1]);
    const shadesAll = /shades?\s+all|shaded\s+all|all\s+of\s+them|all\s+of\s+the/i.test(stem);
    if (shadesAll) return { num: den, den };
    const shadeM = stem.match(/(?:shades?|shaded|eats?|ate|colors?|colored|fills?|filled|pick(?:s|ed)?|takes?|took)\s+(\d+)/i);
    if (shadeM) return { num: parseInt(shadeM[1]), den };
  }
  const outOf = stem.match(/(\d+)\s+out\s+of\s+(\d+)/i);
  if (outOf) return { num: parseInt(outOf[1]), den: parseInt(outOf[2]) };
  return null;
}

function parseFirstInteger(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0]) : null;
}

function check(row) {
  if (!Array.isArray(row.choices) || row.choices.length < 2) return { ok: false, bug: 'BUG_SCHEMA', reason: 'choices < 2' };
  if (!Number.isInteger(row.correctIndex) || row.correctIndex < 0 || row.correctIndex >= row.choices.length) {
    return { ok: false, bug: 'BUG_CORRECT_INDEX', reason: 'correctIndex ' + row.correctIndex + ' for ' + row.choices.length + ' choices' };
  }
  const stim = row.stimulus;
  const hasObjChoice = Array.isArray(row.choices) && row.choices.some(c => c && typeof c === 'object' && c.type);
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
      default:                return { ok: false, bug: 'BUG_SCHEMA', reason: 'unknown stim type: ' + stim.type };
    }
  }
  return { ok: true }; // no stim + no widget choices = text MC, not in scope
}

function checkFractionBarChoices(row) {
  const choices = row.choices;
  const ci = row.correctIndex;
  for (let i = 0; i < 4; i++) {
    const c = choices[i];
    if (!c || typeof c !== 'object' || c.type !== 'fraction-bar') return { ok: false, bug: 'BUG_SCHEMA', reason: 'choice[' + i + '] not fraction-bar' };
    if (!Number.isInteger(c.parts) || c.parts < 1 || c.parts > 20) return { ok: false, bug: 'BUG_SCHEMA', reason: 'choice[' + i + '].parts out of range' };
    if (!Number.isInteger(c.filled) || c.filled < 0 || c.filled > c.parts) return { ok: false, bug: 'BUG_SCHEMA', reason: 'choice[' + i + '].filled out of range' };
  }
  const stemFrac = extractStemFraction(row.question || row.prompt || '');
  if (!stemFrac) return { ok: false, bug: 'BUG_AMBIGUOUS_STEM', reason: 'cant extract fraction from stem' };
  const correct = choices[ci];
  const correctReduced = lowestTerms(correct.filled, correct.parts);
  const stemReduced = lowestTerms(stemFrac.num, stemFrac.den);
  if (!correctReduced || !stemReduced) return { ok: false, bug: 'BUG_MATH', reason: 'cant reduce' };
  if (correctReduced.n !== stemReduced.n || correctReduced.d !== stemReduced.d) {
    return { ok: false, bug: 'BUG_MATH', reason: 'correct ' + correct.filled + '/' + correct.parts + ' != stem ' + stemFrac.num + '/' + stemFrac.den };
  }
  for (let i = 0; i < 4; i++) {
    if (i === ci) continue;
    const dC = choices[i];
    const dr = lowestTerms(dC.filled, dC.parts);
    if (!dr) continue;
    if (dr.n === correctReduced.n && dr.d === correctReduced.d) {
      return { ok: false, bug: 'BUG_DUP_DISTRACTOR', reason: 'distractor[' + i + '] = ' + dC.filled + '/' + dC.parts + ' is equivalent to correct' };
    }
  }
  return { ok: true };
}

function checkClockFace(row) {
  const stim = row.stimulus;
  const ci = row.correctIndex;
  if (!Number.isInteger(stim.hour) || stim.hour < 1 || stim.hour > 12) return { ok: false, bug: 'BUG_SCHEMA', reason: 'hour out of range' };
  if (!Number.isInteger(stim.minute) || stim.minute < 0 || stim.minute > 59) return { ok: false, bug: 'BUG_SCHEMA', reason: 'minute out of range' };
  const correct = String(row.choices[ci]).trim();
  const mm = stim.minute < 10 ? '0' + stim.minute : '' + stim.minute;
  const expected = stim.hour + ':' + mm;
  if (correct !== expected) return { ok: false, bug: 'BUG_MATH', reason: 'clock=' + expected + ' but correct=' + correct };
  for (let i = 0; i < row.choices.length; i++) {
    if (i === ci) continue;
    if (String(row.choices[i]).trim() === expected) return { ok: false, bug: 'BUG_DUP_DISTRACTOR', reason: 'distractor[' + i + '] matches correct' };
  }
  return { ok: true };
}

function checkBase10Blocks(row) {
  const stim = row.stimulus;
  const ci = row.correctIndex;
  const expected = (stim.hundreds || 0) * 100 + (stim.tens || 0) * 10 + (stim.ones || 0);
  if (expected === 0) return { ok: false, bug: 'BUG_SCHEMA', reason: 'all digits zero' };
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== expected) return { ok: false, bug: 'BUG_MATH', reason: 'blocks=' + expected + ' but correct=' + correctVal };
  return { ok: true };
}

function checkAreaModel(row) {
  const stim = row.stimulus;
  if (stim.fractionGrid) return { ok: true }; // not in current generator scope
  const ci = row.correctIndex;
  if (!Array.isArray(stim.rows) || !Array.isArray(stim.cols)) return { ok: false, bug: 'BUG_SCHEMA', reason: 'rows/cols not arrays' };
  const sumR = stim.rows.reduce((a, b) => a + b, 0);
  const sumC = stim.cols.reduce((a, b) => a + b, 0);
  const expected = sumR * sumC;
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== expected) return { ok: false, bug: 'BUG_MATH', reason: sumR + '×' + sumC + '=' + expected + ' but correct=' + correctVal };
  return { ok: true };
}

function checkPlotter(row) {
  const stim = row.stimulus;
  const ci = row.correctIndex;
  if (!Array.isArray(stim.categories) || !Array.isArray(stim.values)) return { ok: false, bug: 'BUG_SCHEMA', reason: 'cat/val arrays' };
  const correct = String(row.choices[ci]).trim();
  const cats = stim.categories.map(c => String(c).trim());
  if (cats.includes(correct)) return { ok: true };
  const correctNum = parseFirstInteger(correct);
  if (correctNum === null) return { ok: false, bug: 'BUG_MATH', reason: 'plotter correct "' + correct + '" not category nor integer' };
  const vals = stim.values.slice();
  const possible = new Set();
  vals.forEach(v => possible.add(v));
  for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals.length; j++) if (i !== j) {
    possible.add(Math.abs(vals[i] - vals[j])); possible.add(vals[i] + vals[j]);
  }
  possible.add(vals.reduce((a, b) => a + b, 0));
  possible.add(Math.max.apply(null, vals));
  possible.add(Math.min.apply(null, vals));
  if (!possible.has(correctNum)) return { ok: false, bug: 'BUG_MATH', reason: 'plotter ' + correctNum + ' not in possible set' };
  return { ok: true };
}

function checkNumberLine(row) {
  const stim = row.stimulus;
  const ci = row.correctIndex;
  if (!Array.isArray(stim.marks) || stim.marks.length === 0) return { ok: false, bug: 'BUG_SCHEMA', reason: 'no marks' };
  const markAt = stim.marks[0].at;
  if (typeof markAt !== 'number') return { ok: false, bug: 'BUG_SCHEMA', reason: 'mark.at not number' };
  const correctStr = String(row.choices[ci]).trim();
  const correctFrac = parseFraction(correctStr);
  if (!correctFrac) return { ok: false, bug: 'BUG_MATH', reason: 'correct ' + correctStr + ' not parseable' };
  const correctDec = correctFrac.num / correctFrac.den;
  if (Math.abs(correctDec - markAt) > 0.02) return { ok: false, bug: 'BUG_MATH', reason: 'mark=' + markAt + ' correct=' + correctDec };
  return { ok: true };
}

function checkTapeDiagram(row) {
  const stim = row.stimulus;
  const ci = row.correctIndex;
  if (!Array.isArray(stim.parts)) return { ok: false, bug: 'BUG_SCHEMA', reason: 'parts not array' };
  const knownVals = stim.parts.filter(p => p.label !== '?').map(p => parseInt(p.label, 10));
  const unknownCount = stim.parts.filter(p => p.label === '?').length;
  const totalNum = parseInt(stim.total, 10);
  if (unknownCount !== 1) return { ok: false, bug: 'BUG_SCHEMA', reason: 'expected 1 ? cell, got ' + unknownCount };
  if (!Number.isFinite(totalNum)) return { ok: false, bug: 'BUG_SCHEMA', reason: 'total not int' };
  if (knownVals.some(v => !Number.isFinite(v))) return { ok: false, bug: 'BUG_SCHEMA', reason: 'known label not int' };
  const expected = totalNum - knownVals.reduce((a, b) => a + b, 0);
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== expected) return { ok: false, bug: 'BUG_MATH', reason: 'expected=' + expected + ' correct=' + correctVal };
  return { ok: true };
}

function checkShape2d(row) {
  const stim = row.stimulus;
  const ci = row.correctIndex;
  const stem = (row.question || row.prompt || '').toLowerCase();
  const labels = stim.labels || {};
  const asksArea = /\barea\b/.test(stem);
  const asksPerim = /\bperimeter\b/.test(stem);
  if (!asksArea && !asksPerim) return { ok: true }; // classification questions OK
  function numFromLabel(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  const w = numFromLabel(labels.width) || numFromLabel(labels.leg1) || numFromLabel(labels.base);
  const h = numFromLabel(labels.height) || numFromLabel(labels.leg2);
  if (w == null || h == null) return { ok: true }; // can't check
  let expected;
  if (stim.shape === 'rectangle' || stim.shape === 'square') expected = asksArea ? w * h : 2 * (w + h);
  else if (stim.shape === 'right-triangle') expected = asksArea ? 0.5 * w * h : null;
  else return { ok: true };
  if (expected == null) return { ok: true };
  const correctVal = parseFirstInteger(String(row.choices[ci]));
  if (correctVal !== Math.round(expected)) return { ok: false, bug: 'BUG_MATH', reason: stim.shape + ' ' + (asksArea ? 'area' : 'perim') + '=' + expected + ' correct=' + correctVal };
  return { ok: true };
}

module.exports = { check, extractStemFraction, parseFraction, parseFirstInteger };
