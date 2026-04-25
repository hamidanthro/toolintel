#!/usr/bin/env node
/* eslint-disable no-console */
// Generates a large bank of STAAR practice questions and merges them into the
// existing data/grade-*-curriculum.json lesson question arrays.
//
// Usage:  node scripts/generate-bank.js
//
// Idempotent: questions with ids beginning with `gen-` are stripped before
// regenerating, so re-running this script produces a fresh deterministic bank.

const fs = require('fs');
const path = require('path');

// Seeded PRNG so the bank is stable across runs.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function shuffleA(rng, a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function fmt(n) { return n.toLocaleString('en-US'); }
function uniqueDistractors(rng, answer, generators, count = 3) {
  const out = new Set();
  let guard = 0;
  while (out.size < count && guard < 50) {
    const v = generators(rng);
    if (v != null && String(v) !== String(answer) && !out.has(String(v))) {
      out.add(String(v));
    }
    guard++;
  }
  return Array.from(out);
}
function mc(prompt, answer, distractors, explanation, rng) {
  const choices = shuffleA(rng, [String(answer), ...distractors]);
  return { type: 'multiple_choice', prompt, choices, answer: String(answer), explanation };
}
function num(prompt, answer, explanation, acceptable) {
  const q = { type: 'numeric', prompt, answer: String(answer), explanation };
  if (acceptable && acceptable.length) q.acceptable = acceptable.map(String);
  return q;
}

// ---------- Generators ----------
// Each generator returns a question object (no id; id is assigned by the writer).

const PLACES_G3 = [
  { name: 'ones', mul: 1 },
  { name: 'tens', mul: 10 },
  { name: 'hundreds', mul: 100 },
  { name: 'thousands', mul: 1000 },
  { name: 'ten-thousands', mul: 10000 }
];

function genPlaceValueG3(rng) {
  const place = pick(rng, PLACES_G3);
  const digit = randInt(rng, 1, 9);
  const number = digit * place.mul + randInt(rng, 0, place.mul - 1);
  // Ask for the value of `digit` in `number` (with random padding so digit lands at place).
  const padded = digit * place.mul + randInt(rng, 0, place.mul - 1);
  const value = digit * place.mul;
  return num(
    `What is the value of the digit ${digit} in ${fmt(padded)}?`,
    value,
    `The digit ${digit} sits in the ${place.name} place, so its value is ${digit} × ${fmt(place.mul)} = ${fmt(value)}.`,
    [fmt(value), String(value)]
  );
}

function genRoundingG3(rng) {
  const targets = [
    { mul: 10, name: 'ten' },
    { mul: 100, name: 'hundred' }
  ];
  const t = pick(rng, targets);
  const n = randInt(rng, 50, 9000);
  const rounded = Math.round(n / t.mul) * t.mul;
  return num(
    `Round ${fmt(n)} to the nearest ${t.name}.`,
    rounded,
    `The digit just to the right of the ${t.name}s place decides the rounding. ${fmt(n)} rounds to ${fmt(rounded)}.`,
    [fmt(rounded), String(rounded)]
  );
}

function genCompareG3(rng) {
  const a = randInt(rng, 1000, 99999);
  let b;
  do { b = randInt(rng, 1000, 99999); } while (b === a);
  const sym = a < b ? '<' : a > b ? '>' : '=';
  return mc(
    `Which symbol makes this true?  ${fmt(a)} ___ ${fmt(b)}`,
    sym,
    ['<', '>', '='].filter(s => s !== sym),
    `Compare digits left-to-right. ${fmt(a)} ${sym} ${fmt(b)}.`,
    rng
  );
}

function genAdd3DigitG3(rng) {
  const a = randInt(rng, 100, 899);
  const b = randInt(rng, 100, 899);
  const ans = a + b;
  return num(
    `${fmt(a)} + ${fmt(b)} = ?`,
    ans,
    `Add the ones, tens, and hundreds, regrouping when a column is 10 or more. ${a} + ${b} = ${ans}.`,
    [fmt(ans), String(ans)]
  );
}

function genSub3DigitG3(rng) {
  const a = randInt(rng, 200, 999);
  const b = randInt(rng, 100, a - 1);
  const ans = a - b;
  return num(
    `${fmt(a)} − ${fmt(b)} = ?`,
    ans,
    `Subtract starting from the ones place, regrouping when needed. ${a} − ${b} = ${ans}.`,
    [fmt(ans), String(ans)]
  );
}

function genMulFactsG3(rng) {
  const a = randInt(rng, 2, 10);
  const b = randInt(rng, 2, 10);
  const ans = a * b;
  return num(
    `What is ${a} × ${b}?`,
    ans,
    `${a} groups of ${b} is ${ans}.`,
    [fmt(ans)]
  );
}

function genMulWordG3(rng) {
  const groups = randInt(rng, 3, 9);
  const each = randInt(rng, 3, 9);
  const ans = groups * each;
  const things = pick(rng, ['stickers', 'pencils', 'apples', 'marbles', 'cookies', 'shells', 'crayons']);
  return num(
    `Mia has ${groups} bags. Each bag has ${each} ${things}. How many ${things} are there in all?`,
    ans,
    `${groups} groups of ${each} = ${groups} × ${each} = ${ans}.`,
    [fmt(ans)]
  );
}

function genDivG3(rng) {
  const b = randInt(rng, 2, 10);
  const q = randInt(rng, 2, 10);
  const a = b * q;
  const things = pick(rng, ['marbles', 'cookies', 'crayons', 'cards', 'beads']);
  return num(
    `${a} ${things} are shared equally among ${b} friends. How many does each friend get?`,
    q,
    `${a} ÷ ${b} = ${q}, since ${b} × ${q} = ${a}.`,
    [String(q)]
  );
}

function genFactFamilyG3(rng) {
  const a = randInt(rng, 2, 10);
  const b = randInt(rng, 2, 10);
  const p = a * b;
  return num(
    `If ${a} × ${b} = ${p}, what is ${p} ÷ ${a}?`,
    b,
    `Multiplication and division are inverse. ${p} ÷ ${a} = ${b}.`,
    [String(b)]
  );
}

function genUnknownG3(rng) {
  const a = randInt(rng, 5, 50);
  const ans = randInt(rng, 5, 50);
  const total = a + ans;
  return num(
    `${a} + ? = ${total}. What number goes in the box?`,
    ans,
    `Subtract: ${total} − ${a} = ${ans}.`,
    [String(ans)]
  );
}

function genPerimeterG3(rng) {
  const l = randInt(rng, 2, 20);
  const w = randInt(rng, 2, 20);
  const ans = 2 * (l + w);
  return num(
    `A rectangle has length ${l} cm and width ${w} cm. What is its perimeter?`,
    ans,
    `Perimeter = 2 × (length + width) = 2 × (${l} + ${w}) = ${ans} cm.`,
    [String(ans), `${ans} cm`]
  );
}

function genAreaG3(rng) {
  const l = randInt(rng, 2, 15);
  const w = randInt(rng, 2, 15);
  const ans = l * w;
  return num(
    `A rectangle is ${l} units long and ${w} units wide. What is its area?`,
    ans,
    `Area = length × width = ${l} × ${w} = ${ans} square units.`,
    [String(ans)]
  );
}

function genElapsedG3(rng) {
  const startH = randInt(rng, 1, 9);
  const startM = pick(rng, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  const addM = randInt(rng, 10, 90);
  const total = startH * 60 + startM + addM;
  let endH = Math.floor(total / 60);
  const endM = total % 60;
  if (endH > 12) endH -= 12;
  const fmtT = (h, m) => `${h}:${String(m).padStart(2, '0')}`;
  return num(
    `A movie starts at ${fmtT(startH, startM)} and lasts ${addM} minutes. What time does it end?`,
    fmtT(endH, endM),
    `Add ${addM} minutes to ${fmtT(startH, startM)}. End time: ${fmtT(endH, endM)}.`,
    [fmtT(endH, endM)]
  );
}

function genEquivFracG3(rng) {
  const n = randInt(rng, 1, 4);
  const d = randInt(rng, n + 1, 8);
  const k = randInt(rng, 2, 4);
  const ans = `${n * k}/${d * k}`;
  const wrongs = [`${n + 1}/${d}`, `${n}/${d + k}`, `${n * k}/${d}`];
  return mc(
    `Which fraction is equivalent to ${n}/${d}?`,
    ans,
    wrongs,
    `Multiply both top and bottom by ${k}: ${n}×${k} = ${n * k}, ${d}×${k} = ${d * k}. So ${n}/${d} = ${ans}.`,
    rng
  );
}

function genCompareFracG3(rng) {
  // Same denominator for clarity at G3.
  const d = randInt(rng, 4, 10);
  let a = randInt(rng, 1, d - 1);
  let b;
  do { b = randInt(rng, 1, d - 1); } while (b === a);
  const sym = a < b ? '<' : '>';
  return mc(
    `Which symbol makes this true?  ${a}/${d} ___ ${b}/${d}`,
    sym,
    ['<', '>', '='].filter(s => s !== sym),
    `Same denominator means compare numerators: ${a} ${sym} ${b}, so ${a}/${d} ${sym} ${b}/${d}.`,
    rng
  );
}

// ---------- Grade 4 generators ----------
function genPlaceValueG4(rng) {
  const places = [
    { name: 'ones', mul: 1 },
    { name: 'tens', mul: 10 },
    { name: 'hundreds', mul: 100 },
    { name: 'thousands', mul: 1000 },
    { name: 'ten-thousands', mul: 10000 },
    { name: 'hundred-thousands', mul: 100000 },
    { name: 'millions', mul: 1000000 }
  ];
  const p = pick(rng, places);
  const digit = randInt(rng, 1, 9);
  const lower = randInt(rng, 0, p.mul - 1);
  const above = randInt(rng, 0, 9) * p.mul * 10;
  const number = above + digit * p.mul + lower;
  const value = digit * p.mul;
  return num(
    `What is the value of the digit ${digit} in ${fmt(number)}?`,
    value,
    `The ${digit} sits in the ${p.name} place: ${digit} × ${fmt(p.mul)} = ${fmt(value)}.`,
    [fmt(value), String(value)]
  );
}

function genRoundingG4(rng) {
  const places = [
    { mul: 10, name: 'ten' },
    { mul: 100, name: 'hundred' },
    { mul: 1000, name: 'thousand' },
    { mul: 10000, name: 'ten thousand' }
  ];
  const t = pick(rng, places);
  const n = randInt(rng, t.mul * 2, t.mul * 99);
  const rounded = Math.round(n / t.mul) * t.mul;
  return num(
    `Round ${fmt(n)} to the nearest ${t.name}.`,
    rounded,
    `Look at the digit just right of the ${t.name}s place. ${fmt(n)} rounds to ${fmt(rounded)}.`,
    [fmt(rounded), String(rounded)]
  );
}

function genDecimalPlaceG4(rng) {
  const whole = randInt(rng, 0, 99);
  const t = randInt(rng, 0, 9);
  const h = randInt(rng, 0, 9);
  const decStr = `${whole}.${t}${h}`;
  const which = pick(rng, ['tenths', 'hundredths']);
  const ans = which === 'tenths' ? t : h;
  return num(
    `What digit is in the ${which} place of ${decStr}?`,
    ans,
    `The first digit after the decimal point is tenths; the second is hundredths. In ${decStr}, the ${which} digit is ${ans}.`,
    [String(ans)]
  );
}

function genCompareDecimalsG4(rng) {
  const a = (randInt(rng, 100, 999) / 100).toFixed(2);
  let b;
  do { b = (randInt(rng, 100, 999) / 100).toFixed(2); } while (b === a);
  const sym = parseFloat(a) < parseFloat(b) ? '<' : '>';
  return mc(
    `Which symbol makes this true?  ${a} ___ ${b}`,
    sym,
    ['<', '>', '='].filter(s => s !== sym),
    `Line up the decimal points and compare digit by digit. ${a} ${sym} ${b}.`,
    rng
  );
}

function genMul1DigitG4(rng) {
  const a = randInt(rng, 12, 999);
  const b = randInt(rng, 2, 9);
  const ans = a * b;
  return num(
    `${fmt(a)} × ${b} = ?`,
    ans,
    `Use the standard algorithm or partial products: ${a} × ${b} = ${fmt(ans)}.`,
    [fmt(ans), String(ans)]
  );
}

function genMul2DigitG4(rng) {
  const a = randInt(rng, 12, 99);
  const b = randInt(rng, 12, 99);
  const ans = a * b;
  return num(
    `${a} × ${b} = ?`,
    ans,
    `Multiply by tens, then ones, and add: ${a} × ${b} = ${fmt(ans)}.`,
    [fmt(ans), String(ans)]
  );
}

function genLongDivG4(rng) {
  const b = randInt(rng, 3, 9);
  const q = randInt(rng, 12, 199);
  const a = b * q;
  return num(
    `${fmt(a)} ÷ ${b} = ?`,
    q,
    `${a} ÷ ${b} = ${q}, since ${b} × ${q} = ${fmt(a)}.`,
    [fmt(q), String(q)]
  );
}

function genDivRemainderG4(rng) {
  const b = randInt(rng, 3, 9);
  const q = randInt(rng, 10, 99);
  const r = randInt(rng, 1, b - 1);
  const a = b * q + r;
  return num(
    `What is the remainder when ${fmt(a)} is divided by ${b}?`,
    r,
    `${a} ÷ ${b} = ${q} remainder ${r}, because ${b} × ${q} + ${r} = ${a}.`,
    [String(r)]
  );
}

function genAddFracLikeG4(rng) {
  const d = randInt(rng, 4, 12);
  const a = randInt(rng, 1, d - 2);
  const b = randInt(rng, 1, d - a - 1);
  const ans = `${a + b}/${d}`;
  return mc(
    `${a}/${d} + ${b}/${d} = ?`,
    ans,
    [`${a + b}/${d * 2}`, `${a * b}/${d}`, `${a + b + 1}/${d}`],
    `Same denominator: add the numerators only. ${a} + ${b} = ${a + b}, so the answer is ${ans}.`,
    rng
  );
}

function genSubFracLikeG4(rng) {
  const d = randInt(rng, 4, 12);
  const a = randInt(rng, 2, d - 1);
  const b = randInt(rng, 1, a - 1);
  const ans = `${a - b}/${d}`;
  return mc(
    `${a}/${d} − ${b}/${d} = ?`,
    ans,
    [`${a - b}/${d * 2}`, `${a + b}/${d}`, `${a - b + 1}/${d}`],
    `Same denominator: subtract numerators. ${a} − ${b} = ${a - b}, so the answer is ${ans}.`,
    rng
  );
}

function genPerimeterG4(rng) {
  const l = randInt(rng, 4, 30);
  const w = randInt(rng, 4, 30);
  const ans = 2 * (l + w);
  return num(
    `Find the perimeter of a rectangle that is ${l} ft long and ${w} ft wide.`,
    ans,
    `P = 2(l + w) = 2(${l} + ${w}) = ${ans} ft.`,
    [String(ans), `${ans} ft`]
  );
}
function genAreaG4(rng) {
  const l = randInt(rng, 5, 30);
  const w = randInt(rng, 5, 30);
  const ans = l * w;
  return num(
    `What is the area of a rectangle that is ${l} m by ${w} m?`,
    ans,
    `A = l × w = ${l} × ${w} = ${ans} square meters.`,
    [String(ans), `${ans} sq m`]
  );
}

function genAngleClassifyG4(rng) {
  const deg = randInt(rng, 5, 175);
  let ans;
  if (deg < 90) ans = 'acute';
  else if (deg === 90) ans = 'right';
  else if (deg < 180) ans = 'obtuse';
  else ans = 'straight';
  return mc(
    `An angle measures ${deg}°. What type of angle is it?`,
    ans,
    ['acute', 'right', 'obtuse', 'straight'].filter(x => x !== ans).slice(0, 3),
    `Acute < 90°, right = 90°, obtuse between 90° and 180°, straight = 180°. ${deg}° is ${ans}.`,
    rng
  );
}

// ---------- Grade 5 generators ----------
function genDecimalPlaceG5(rng) {
  const whole = randInt(rng, 0, 999);
  const t = randInt(rng, 0, 9);
  const h = randInt(rng, 0, 9);
  const th = randInt(rng, 0, 9);
  const decStr = `${whole}.${t}${h}${th}`;
  const which = pick(rng, ['tenths', 'hundredths', 'thousandths']);
  const ans = which === 'tenths' ? t : which === 'hundredths' ? h : th;
  return num(
    `What digit is in the ${which} place of ${decStr}?`,
    ans,
    `Tenths is the 1st digit after the decimal, hundredths the 2nd, thousandths the 3rd. In ${decStr} the ${which} digit is ${ans}.`,
    [String(ans)]
  );
}

function genRoundDecimalG5(rng) {
  const n = (randInt(rng, 100, 9999) / 1000);
  const places = [
    { name: 'tenth', dp: 1 },
    { name: 'hundredth', dp: 2 }
  ];
  const p = pick(rng, places);
  const factor = Math.pow(10, p.dp);
  const ans = (Math.round(n * factor) / factor).toFixed(p.dp);
  return num(
    `Round ${n.toFixed(3)} to the nearest ${p.name}.`,
    ans,
    `Look at the digit right of the ${p.name}s place. ${n.toFixed(3)} rounds to ${ans}.`,
    [String(ans)]
  );
}

function genAddDecimalsG5(rng) {
  const a = randInt(rng, 100, 9999) / 100;
  const b = randInt(rng, 100, 9999) / 100;
  const ans = (a + b).toFixed(2);
  return num(
    `${a.toFixed(2)} + ${b.toFixed(2)} = ?`,
    ans,
    `Line up the decimal points, then add. Result: ${ans}.`,
    [String(ans)]
  );
}

function genSubDecimalsG5(rng) {
  let a = randInt(rng, 200, 9999) / 100;
  let b = randInt(rng, 100, 9999) / 100;
  if (b > a) [a, b] = [b, a];
  const ans = (a - b).toFixed(2);
  return num(
    `${a.toFixed(2)} − ${b.toFixed(2)} = ?`,
    ans,
    `Line up the decimal points, regroup as needed, and subtract. Result: ${ans}.`,
    [String(ans)]
  );
}

function genMulDecWholeG5(rng) {
  const a = randInt(rng, 11, 99) / 10;
  const b = randInt(rng, 2, 9);
  const ans = (a * b).toFixed(1);
  return num(
    `${a.toFixed(1)} × ${b} = ?`,
    ans,
    `Multiply ignoring the decimal: ${a * 10} × ${b} = ${a * 10 * b}, then place 1 decimal: ${ans}.`,
    [String(ans)]
  );
}

function genMulDecDecG5(rng) {
  const a = randInt(rng, 11, 99) / 10;
  const b = randInt(rng, 11, 99) / 10;
  const ans = (a * b).toFixed(2);
  return num(
    `${a.toFixed(1)} × ${b.toFixed(1)} = ?`,
    ans,
    `Multiply as whole numbers, then place 2 decimal points (one from each factor). Result: ${ans}.`,
    [String(ans)]
  );
}

function genDivDecWholeG5(rng) {
  const b = randInt(rng, 2, 9);
  const q = randInt(rng, 11, 99) / 10;
  const a = (q * b).toFixed(1);
  return num(
    `${a} ÷ ${b} = ?`,
    q.toFixed(1),
    `${a} ÷ ${b} = ${q.toFixed(1)} because ${q.toFixed(1)} × ${b} = ${a}.`,
    [q.toFixed(1)]
  );
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function genAddUnlikeFracG5(rng) {
  const d1 = pick(rng, [3, 4, 5, 6, 8]);
  let d2 = pick(rng, [2, 3, 4, 5, 6, 8, 10, 12].filter(x => x !== d1));
  const n1 = randInt(rng, 1, d1 - 1);
  const n2 = randInt(rng, 1, d2 - 1);
  const lcm = (d1 * d2) / gcd(d1, d2);
  const num1 = n1 * (lcm / d1);
  const num2 = n2 * (lcm / d2);
  let ansN = num1 + num2;
  let ansD = lcm;
  const g = gcd(ansN, ansD);
  ansN /= g; ansD /= g;
  const ans = ansD === 1 ? String(ansN) : `${ansN}/${ansD}`;
  return num(
    `${n1}/${d1} + ${n2}/${d2} = ?  (give answer in simplest form, like 3/4 or 1)`,
    ans,
    `Common denominator is ${lcm}. Convert: ${n1}/${d1} = ${num1}/${lcm}, ${n2}/${d2} = ${num2}/${lcm}. Sum = ${num1 + num2}/${lcm} = ${ans}.`,
    [ans]
  );
}

function genSubUnlikeFracG5(rng) {
  let d1 = pick(rng, [3, 4, 5, 6, 8]);
  let d2 = pick(rng, [2, 3, 4, 5, 6, 8, 10, 12].filter(x => x !== d1));
  let n1 = randInt(rng, 1, d1 - 1);
  let n2 = randInt(rng, 1, d2 - 1);
  let val1 = n1 / d1;
  let val2 = n2 / d2;
  if (val2 > val1) {
    [d1, d2] = [d2, d1];
    [n1, n2] = [n2, n1];
  }
  const lcm = (d1 * d2) / gcd(d1, d2);
  const num1 = n1 * (lcm / d1);
  const num2 = n2 * (lcm / d2);
  let ansN = num1 - num2;
  let ansD = lcm;
  if (ansN === 0) {
    return genSubUnlikeFracG5(rng);
  }
  const g = gcd(Math.abs(ansN), ansD);
  ansN /= g; ansD /= g;
  const ans = ansD === 1 ? String(ansN) : `${ansN}/${ansD}`;
  return num(
    `${n1}/${d1} − ${n2}/${d2} = ?  (simplest form)`,
    ans,
    `Common denominator ${lcm}: ${n1}/${d1} = ${num1}/${lcm}, ${n2}/${d2} = ${num2}/${lcm}. Difference = ${num1 - num2}/${lcm} = ${ans}.`,
    [ans]
  );
}

function genOrderOpsG5(rng) {
  const a = randInt(rng, 2, 9);
  const b = randInt(rng, 2, 9);
  const c = randInt(rng, 2, 9);
  const d = randInt(rng, 2, 5);
  const ans = a + b * c - d;
  return num(
    `${a} + ${b} × ${c} − ${d} = ?`,
    ans,
    `Multiply first: ${b} × ${c} = ${b * c}. Then ${a} + ${b * c} − ${d} = ${ans}.`,
    [String(ans)]
  );
}

function genVolumeG5(rng) {
  const l = randInt(rng, 2, 12);
  const w = randInt(rng, 2, 12);
  const h = randInt(rng, 2, 12);
  const ans = l * w * h;
  return num(
    `Find the volume of a rectangular prism that is ${l} × ${w} × ${h} units.`,
    ans,
    `V = l × w × h = ${l} × ${w} × ${h} = ${ans} cubic units.`,
    [String(ans), `${ans} cubic units`]
  );
}

function genCustomaryG5(rng) {
  const conv = pick(rng, [
    { from: 'feet', to: 'inches', factor: 12 },
    { from: 'yards', to: 'feet', factor: 3 },
    { from: 'pounds', to: 'ounces', factor: 16 },
    { from: 'gallons', to: 'quarts', factor: 4 },
    { from: 'quarts', to: 'pints', factor: 2 }
  ]);
  const n = randInt(rng, 2, 12);
  const ans = n * conv.factor;
  return num(
    `Convert: ${n} ${conv.from} = ? ${conv.to}`,
    ans,
    `1 ${conv.from.replace(/s$/, '')} = ${conv.factor} ${conv.to}, so ${n} ${conv.from} = ${ans} ${conv.to}.`,
    [String(ans), `${ans} ${conv.to}`]
  );
}

function genMetricG5(rng) {
  const conv = pick(rng, [
    { from: 'm', to: 'cm', factor: 100 },
    { from: 'km', to: 'm', factor: 1000 },
    { from: 'kg', to: 'g', factor: 1000 },
    { from: 'L', to: 'mL', factor: 1000 }
  ]);
  const n = randInt(rng, 2, 25);
  const ans = n * conv.factor;
  return num(
    `Convert: ${n} ${conv.from} = ? ${conv.to}`,
    ans,
    `1 ${conv.from} = ${fmt(conv.factor)} ${conv.to}, so ${n} ${conv.from} = ${fmt(ans)} ${conv.to}.`,
    [String(ans), fmt(ans), `${fmt(ans)} ${conv.to}`]
  );
}

// ---------- Bank specs ----------
const SPECS = {
  'grade-3-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genPlaceValueG3, count: 30 },
    { unit: 'u1', lesson: 'u1l2', gen: genCompareG3, count: 25 },
    { unit: 'u1', lesson: 'u1l3', gen: genRoundingG3, count: 30 },
    { unit: 'u2', lesson: 'u2l2', gen: genEquivFracG3, count: 20 },
    { unit: 'u2', lesson: 'u2l3', gen: genCompareFracG3, count: 20 },
    { unit: 'u3', lesson: 'u3l1', gen: genAdd3DigitG3, count: 30 },
    { unit: 'u3', lesson: 'u3l2', gen: genSub3DigitG3, count: 30 },
    { unit: 'u4', lesson: 'u4l2', gen: genMulFactsG3, count: 35 },
    { unit: 'u4', lesson: 'u4l3', gen: genMulWordG3, count: 25 },
    { unit: 'u5', lesson: 'u5l1', gen: genDivG3, count: 25 },
    { unit: 'u5', lesson: 'u5l2', gen: genFactFamilyG3, count: 20 },
    { unit: 'u6', lesson: 'u6l1', gen: genUnknownG3, count: 20 },
    { unit: 'u8', lesson: 'u8l1', gen: genPerimeterG3, count: 25 },
    { unit: 'u8', lesson: 'u8l2', gen: genAreaG3, count: 25 },
    { unit: 'u9', lesson: 'u9l1', gen: genElapsedG3, count: 20 }
  ],
  'grade-4-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genPlaceValueG4, count: 30 },
    { unit: 'u1', lesson: 'u1l3', gen: genRoundingG4, count: 30 },
    { unit: 'u2', lesson: 'u2l1', gen: genDecimalPlaceG4, count: 25 },
    { unit: 'u2', lesson: 'u2l2', gen: genCompareDecimalsG4, count: 25 },
    { unit: 'u4', lesson: 'u4l1', gen: genAddFracLikeG4, count: 25 },
    { unit: 'u4', lesson: 'u4l2', gen: genSubFracLikeG4, count: 25 },
    { unit: 'u5', lesson: 'u5l1', gen: genMul1DigitG4, count: 30 },
    { unit: 'u5', lesson: 'u5l2', gen: genMul2DigitG4, count: 30 },
    { unit: 'u6', lesson: 'u6l1', gen: genLongDivG4, count: 25 },
    { unit: 'u6', lesson: 'u6l2', gen: genDivRemainderG4, count: 25 },
    { unit: 'u8', lesson: 'u8l2', gen: genAngleClassifyG4, count: 20 },
    { unit: 'u9', lesson: 'u9l1', gen: genPerimeterG4, count: 25 },
    { unit: 'u9', lesson: 'u9l2', gen: genAreaG4, count: 25 }
  ],
  'grade-5-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genDecimalPlaceG5, count: 30 },
    { unit: 'u1', lesson: 'u1l3', gen: genRoundDecimalG5, count: 25 },
    { unit: 'u2', lesson: 'u2l1', gen: genAddDecimalsG5, count: 30 },
    { unit: 'u2', lesson: 'u2l2', gen: genSubDecimalsG5, count: 30 },
    { unit: 'u3', lesson: 'u3l1', gen: genMulDecWholeG5, count: 25 },
    { unit: 'u3', lesson: 'u3l2', gen: genMulDecDecG5, count: 25 },
    { unit: 'u3', lesson: 'u3l3', gen: genDivDecWholeG5, count: 25 },
    { unit: 'u4', lesson: 'u4l1', gen: genAddUnlikeFracG5, count: 25 },
    { unit: 'u4', lesson: 'u4l2', gen: genSubUnlikeFracG5, count: 25 },
    { unit: 'u6', lesson: 'u6l1', gen: genOrderOpsG5, count: 25 },
    { unit: 'u9', lesson: 'u9l1', gen: genVolumeG5, count: 25 },
    { unit: 'u10', lesson: 'u10l1', gen: genCustomaryG5, count: 25 },
    { unit: 'u10', lesson: 'u10l2', gen: genMetricG5, count: 25 }
  ]
};

const DATA_DIR = path.join(__dirname, '..', 'data');

function uniqByPrompt(arr) {
  const seen = new Set();
  return arr.filter(q => {
    const key = q.prompt;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildBank(file, specs) {
  const full = path.join(DATA_DIR, file);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  let totalAdded = 0;

  // Strip previously-generated questions so re-runs are deterministic.
  for (const u of data.units) {
    for (const l of u.lessons) {
      l.questions = (l.questions || []).filter(q => !q.id || !q.id.startsWith('gen-'));
    }
  }

  for (const spec of specs) {
    const unit = data.units.find(u => u.id === spec.unit);
    if (!unit) { console.warn(`  skip: unit ${spec.unit} not found in ${file}`); continue; }
    const lesson = unit.lessons.find(l => l.id === spec.lesson);
    if (!lesson) { console.warn(`  skip: lesson ${spec.lesson} not found in ${file}`); continue; }
    const rng = mulberry32(hashString(`${file}|${spec.lesson}`));
    const generated = [];
    let guard = 0;
    while (generated.length < spec.count && guard < spec.count * 6) {
      const q = spec.gen(rng);
      if (q) generated.push(q);
      guard++;
    }
    const unique = uniqByPrompt(generated).slice(0, spec.count);
    unique.forEach((q, idx) => {
      q.id = `gen-${spec.lesson}-${String(idx + 1).padStart(3, '0')}`;
    });
    lesson.questions = (lesson.questions || []).concat(unique);
    totalAdded += unique.length;
  }

  fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n');
  console.log(`${file}: +${totalAdded} questions`);
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

for (const [file, specs] of Object.entries(SPECS)) {
  buildBank(file, specs);
}
console.log('Done.');
