#!/usr/bin/env node
/* eslint-disable no-console */
// Generates a HUGE bank of STAAR practice questions and merges them into the
// existing data/grade-*-curriculum.json lesson question arrays.
//
// Usage:  node scripts/generate-bank.js
//
// Idempotent: questions with ids beginning with `gen-` are stripped before
// regenerating, so re-running this script produces a fresh deterministic bank.
//
// Each generator returns a question object (no id; id is assigned by the
// writer). Generators use multiple prompt phrasings, names, and item nouns so
// the unique-prompt space comfortably exceeds 1,000 per lesson.

const fs = require('fs');
const path = require('path');

// ---------- Deterministic RNG ----------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng, lo, hi) { return Math.floor(rng() * (hi - lo + 1)) + lo; }
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
function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// ---------- Question helpers ----------
function mc(prompt, answer, distractors, explanation, rng) {
  const choices = shuffleA(rng, [String(answer), ...distractors]);
  return { type: 'multiple_choice', prompt, choices, answer: String(answer), explanation };
}
function num(prompt, answer, explanation, acceptable) {
  const q = { type: 'numeric', prompt, answer: String(answer), explanation };
  if (acceptable && acceptable.length) q.acceptable = acceptable.map(String);
  return q;
}

// ---------- Phrasing banks ----------
const NAMES = [
  'Mia', 'Liam', 'Noah', 'Ava', 'Sophia', 'Ethan', 'Olivia', 'Lucas', 'Emma', 'Mason',
  'Isabella', 'Logan', 'Aria', 'Elijah', 'Mila', 'James', 'Harper', 'Aiden', 'Layla',
  'Jackson', 'Zoe', 'Carter', 'Nora', 'Owen', 'Riley', 'Wyatt', 'Lily', 'Caleb', 'Hannah',
  'Daniel', 'Maya', 'Henry', 'Ella', 'Jack', 'Aaliyah', 'Levi', 'Stella', 'Sebastian',
  'Camila', 'Mateo', 'Penelope', 'Asher', 'Eleanor', 'Saad', 'Aisha', 'Zara', 'Omar',
  'Yusuf', 'Layla', 'Ibrahim', 'Khalid', 'Fatima'
];

const ITEMS = {
  small: ['stickers', 'pencils', 'crayons', 'erasers', 'beads', 'marbles', 'shells', 'paper clips'],
  food: ['apples', 'cookies', 'grapes', 'cherries', 'strawberries', 'oranges', 'cupcakes', 'donuts'],
  toys: ['toy cars', 'action figures', 'puzzle pieces', 'building blocks', 'dolls', 'play coins'],
  cards: ['baseball cards', 'trading cards', 'flash cards', 'index cards']
};
const ALL_ITEMS = [...ITEMS.small, ...ITEMS.food, ...ITEMS.toys, ...ITEMS.cards];

const ADD_PHRASINGS = [
  (a, b) => `${fmt(a)} + ${fmt(b)} = ?`,
  (a, b) => `What is ${fmt(a)} + ${fmt(b)}?`,
  (a, b) => `Find the sum of ${fmt(a)} and ${fmt(b)}.`,
  (a, b) => `Add ${fmt(a)} and ${fmt(b)}.`,
  (a, b) => `What number is ${fmt(b)} more than ${fmt(a)}?`,
  (a, b) => `${fmt(a)} plus ${fmt(b)} equals what?`
];
const SUB_PHRASINGS = [
  (a, b) => `${fmt(a)} − ${fmt(b)} = ?`,
  (a, b) => `What is ${fmt(a)} − ${fmt(b)}?`,
  (a, b) => `Subtract ${fmt(b)} from ${fmt(a)}.`,
  (a, b) => `Find the difference: ${fmt(a)} − ${fmt(b)}.`,
  (a, b) => `What number is ${fmt(b)} less than ${fmt(a)}?`,
  (a, b) => `${fmt(a)} take away ${fmt(b)} is what?`
];
const MUL_PHRASINGS = [
  (a, b) => `${a} × ${b} = ?`,
  (a, b) => `What is ${a} × ${b}?`,
  (a, b) => `Find the product of ${a} and ${b}.`,
  (a, b) => `Multiply ${a} by ${b}.`,
  (a, b) => `${a} groups of ${b} equals what?`,
  (a, b) => `${a} times ${b} is what?`
];
const DIV_PHRASINGS = [
  (a, b) => `${fmt(a)} ÷ ${b} = ?`,
  (a, b) => `What is ${fmt(a)} ÷ ${b}?`,
  (a, b) => `Divide ${fmt(a)} by ${b}.`,
  (a, b) => `Find the quotient of ${fmt(a)} and ${b}.`,
  (a, b) => `${fmt(a)} divided by ${b} equals what?`
];

// ---------- Generators: Grade 3 ----------
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
  // Build a number with `digit` in the chosen place, plus random fill.
  const upperFill = randInt(rng, 0, 9) * place.mul * 10
    + randInt(rng, 0, 9) * place.mul * 100
    + randInt(rng, 0, 9) * place.mul * 1000;
  const lowerFill = place.mul > 1 ? randInt(rng, 0, place.mul - 1) : 0;
  const number = upperFill + digit * place.mul + lowerFill;
  const value = digit * place.mul;
  const phrasings = [
    `What is the value of the digit ${digit} in ${fmt(number)}?`,
    `In the number ${fmt(number)}, what is the value of the ${digit}?`,
    `Look at ${fmt(number)}. What does the digit ${digit} represent?`,
    `${fmt(number)} — what value does the ${digit} have?`
  ];
  return num(
    pick(rng, phrasings),
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
  const n = randInt(rng, 25, 9999);
  const rounded = Math.round(n / t.mul) * t.mul;
  const phrasings = [
    `Round ${fmt(n)} to the nearest ${t.name}.`,
    `What is ${fmt(n)} rounded to the nearest ${t.name}?`,
    `If you round ${fmt(n)} to the nearest ${t.name}, what do you get?`,
    `Estimate ${fmt(n)} by rounding to the nearest ${t.name}.`
  ];
  return num(
    pick(rng, phrasings),
    rounded,
    `Look at the digit just right of the ${t.name}s place. ${fmt(n)} rounds to ${fmt(rounded)}.`,
    [fmt(rounded), String(rounded)]
  );
}

function genCompareG3(rng) {
  const a = randInt(rng, 1000, 99999);
  let b;
  do { b = randInt(rng, 1000, 99999); } while (b === a);
  const sym = a < b ? '<' : '>';
  const phrasings = [
    `Which symbol makes this true?  ${fmt(a)} ___ ${fmt(b)}`,
    `Compare: ${fmt(a)} ___ ${fmt(b)}. Which symbol fits?`,
    `Pick the symbol: ${fmt(a)} ___ ${fmt(b)}`,
    `${fmt(a)} ___ ${fmt(b)}. Which is correct?`
  ];
  return mc(
    pick(rng, phrasings),
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
    pick(rng, ADD_PHRASINGS)(a, b),
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
    pick(rng, SUB_PHRASINGS)(a, b),
    ans,
    `Subtract starting from the ones place, regrouping when needed. ${a} − ${b} = ${ans}.`,
    [fmt(ans), String(ans)]
  );
}

function genMulFactsG3(rng) {
  const a = randInt(rng, 2, 12);
  const b = randInt(rng, 2, 12);
  const ans = a * b;
  // Mix raw multiplication with short word problems for prompt variety.
  const useWord = rng() < 0.5;
  if (useWord) {
    const name = pick(rng, NAMES);
    const item = pick(rng, ALL_ITEMS);
    const phrasings = [
      `${name} has ${a} packs of ${b} ${item}. How many ${item} in all?`,
      `${name} arranged ${item} into ${a} rows of ${b}. How many ${item}?`,
      `An array has ${a} rows and ${b} columns. How many squares are in the array?`,
      `${a} bags each hold ${b} ${item}. How many ${item} altogether?`,
      `${name} bought ${a} boxes with ${b} ${item} in each box. Total ${item}?`
    ];
    return num(
      pick(rng, phrasings),
      ans,
      `${a} groups of ${b} = ${a} × ${b} = ${ans}.`,
      [fmt(ans), String(ans)]
    );
  }
  return num(
    pick(rng, MUL_PHRASINGS)(a, b),
    ans,
    `${a} × ${b} = ${ans}.`,
    [fmt(ans), String(ans)]
  );
}

function genMulWordG3(rng) {
  const groups = randInt(rng, 3, 12);
  const each = randInt(rng, 3, 12);
  const ans = groups * each;
  const name = pick(rng, NAMES);
  const item = pick(rng, ALL_ITEMS);
  const phrasings = [
    `${name} has ${groups} bags. Each bag has ${each} ${item}. How many ${item} in all?`,
    `${name} packs ${each} ${item} into each of ${groups} boxes. Total ${item}?`,
    `There are ${groups} shelves with ${each} ${item} on each. How many ${item} total?`,
    `${name} buys ${groups} packs of ${item}. Each pack has ${each}. How many ${item}?`,
    `A teacher hands out ${each} ${item} to each of ${groups} students. How many ${item} are given out?`,
    `${groups} kids each collect ${each} ${item}. How many ${item} together?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `${groups} groups of ${each} = ${groups} × ${each} = ${ans}.`,
    [fmt(ans), String(ans)]
  );
}

function genDivG3(rng) {
  const b = randInt(rng, 2, 12);
  const q = randInt(rng, 2, 12);
  const a = b * q;
  const name = pick(rng, NAMES);
  const item = pick(rng, ALL_ITEMS);
  const phrasings = [
    `${a} ${item} are shared equally among ${b} friends. How many does each friend get?`,
    `${name} splits ${a} ${item} into ${b} equal piles. How many per pile?`,
    `${a} ${item} go into ${b} bags evenly. ${item} per bag?`,
    `If ${a} ${item} are arranged in ${b} equal rows, how many in each row?`,
    `${name} divides ${a} ${item} among ${b} kids equally. Each kid gets how many?`,
    `${a} ÷ ${b} = ?`
  ];
  return num(
    pick(rng, phrasings),
    q,
    `${a} ÷ ${b} = ${q}, since ${b} × ${q} = ${a}.`,
    [String(q), fmt(q)]
  );
}

function genFactFamilyG3(rng) {
  const a = randInt(rng, 2, 12);
  const b = randInt(rng, 2, 12);
  const p = a * b;
  const phrasings = [
    `If ${a} × ${b} = ${p}, what is ${p} ÷ ${a}?`,
    `${a} × ${b} = ${p}. Use this fact to find ${p} ÷ ${b}.`,
    `Given ${a} × ${b} = ${p}, the missing factor in ${a} × ? = ${p} is what?`,
    `Knowing ${b} × ${a} = ${p}, what is ${p} ÷ ${a}?`,
    `Fact family: ${a}, ${b}, and ${p}. What is ${p} ÷ ${a}?`
  ];
  // For the second phrasing we want the answer to be a; for others b.
  const idx = Math.floor(rng() * phrasings.length);
  const ans = idx === 1 ? a : b;
  return num(
    phrasings[idx],
    ans,
    `Multiplication and division are inverse operations. The answer is ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genUnknownG3(rng) {
  const op = pick(rng, ['add', 'sub']);
  if (op === 'add') {
    const a = randInt(rng, 5, 90);
    const ans = randInt(rng, 5, 90);
    const total = a + ans;
    const phrasings = [
      `${a} + ? = ${total}. What number goes in the box?`,
      `What number makes this true? ${a} + ? = ${total}`,
      `Find the missing number: ? + ${a} = ${total}`,
      `${total} − ${a} = ?`
    ];
    return num(
      pick(rng, phrasings),
      ans,
      `Subtract: ${total} − ${a} = ${ans}.`,
      [String(ans), fmt(ans)]
    );
  }
  const a = randInt(rng, 20, 100);
  const ans = randInt(rng, 5, a - 1);
  const diff = a - ans;
  const phrasings = [
    `${a} − ? = ${diff}. What number goes in the box?`,
    `Find the missing number: ${a} − ? = ${diff}`,
    `${a} take away what number gives ${diff}?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `Subtract: ${a} − ${diff} = ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genPerimeterG3(rng) {
  const l = randInt(rng, 2, 40);
  const w = randInt(rng, 2, 40);
  const ans = 2 * (l + w);
  const unit = pick(rng, ['cm', 'm', 'in', 'ft']);
  const phrasings = [
    `A rectangle has length ${l} ${unit} and width ${w} ${unit}. What is its perimeter?`,
    `Find the perimeter of a ${l} ${unit} by ${w} ${unit} rectangle.`,
    `A rectangular yard is ${l} ${unit} long and ${w} ${unit} wide. What is its perimeter?`,
    `What is the perimeter of a rectangle whose sides are ${l} ${unit} and ${w} ${unit}?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `Perimeter = 2 × (length + width) = 2 × (${l} + ${w}) = ${ans} ${unit}.`,
    [String(ans), `${ans} ${unit}`, `${ans}${unit}`]
  );
}

function genAreaG3(rng) {
  const l = randInt(rng, 2, 25);
  const w = randInt(rng, 2, 25);
  const ans = l * w;
  const unit = pick(rng, ['units', 'cm', 'm', 'ft', 'in']);
  const phrasings = [
    `A rectangle is ${l} ${unit} long and ${w} ${unit} wide. What is its area?`,
    `Find the area of a ${l} by ${w} rectangle (in square ${unit}).`,
    `What is the area in square ${unit} of a rectangle ${l} ${unit} × ${w} ${unit}?`,
    `A rectangular tile is ${l} ${unit} by ${w} ${unit}. What is the area?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `Area = length × width = ${l} × ${w} = ${ans} square ${unit}.`,
    [String(ans), `${ans} sq ${unit}`, `${ans} square ${unit}`]
  );
}

function genElapsedG3(rng) {
  const startH = randInt(rng, 1, 9);
  const startM = pick(rng, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  const addM = randInt(rng, 5, 120);
  const total = startH * 60 + startM + addM;
  let endH = Math.floor(total / 60);
  const endM = total % 60;
  if (endH > 12) endH -= 12;
  const fmtT = (h, m) => `${h}:${String(m).padStart(2, '0')}`;
  const start = fmtT(startH, startM);
  const end = fmtT(endH, endM);
  const activities = ['movie', 'book club', 'soccer practice', 'lesson', 'meeting', 'game', 'class', 'rehearsal'];
  const act = pick(rng, activities);
  const phrasings = [
    `A ${act} starts at ${start} and lasts ${addM} minutes. What time does it end?`,
    `${pick(rng, NAMES)}'s ${act} began at ${start} and ran ${addM} minutes. End time?`,
    `If ${start} is the start and ${addM} minutes pass, what time is it?`,
    `Start: ${start}. After ${addM} minutes, the time is ___?`
  ];
  return num(
    pick(rng, phrasings),
    end,
    `Add ${addM} minutes to ${start}. End time: ${end}.`,
    [end]
  );
}

function genEquivFracG3(rng) {
  const n = randInt(rng, 1, 6);
  const d = randInt(rng, n + 1, 10);
  const k = randInt(rng, 2, 6);
  const ans = `${n * k}/${d * k}`;
  // Build distractor pool, then drop any that collide with the answer.
  const pool = [
    `${n + 1}/${d * k}`,
    `${n}/${d * k}`,
    `${n * k}/${d}`,
    `${n * k + 1}/${d * k}`,
    `${n * k - 1}/${d * k}`,
    `${n}/${d + k}`,
    `${n + k}/${d + k}`
  ].filter(x => x !== ans);
  const wrongs = shuffleA(rng, Array.from(new Set(pool))).slice(0, 3);
  const phrasings = [
    `Which fraction is equivalent to ${n}/${d}?`,
    `${n}/${d} is the same as which fraction?`,
    `Pick the fraction equal to ${n}/${d}.`,
    `Which of these equals ${n}/${d}?`
  ];
  return mc(
    pick(rng, phrasings),
    ans,
    shuffleA(rng, wrongs).slice(0, 3),
    `Multiply numerator and denominator by ${k}: ${n}×${k} = ${n * k}, ${d}×${k} = ${d * k}. So ${n}/${d} = ${ans}.`,
    rng
  );
}

function genCompareFracG3(rng) {
  // Same denominator scenario for clarity.
  const d = randInt(rng, 3, 12);
  let a = randInt(rng, 1, d - 1);
  let b;
  do { b = randInt(rng, 1, d - 1); } while (b === a);
  const sym = a < b ? '<' : '>';
  const phrasings = [
    `Which symbol makes this true?  ${a}/${d} ___ ${b}/${d}`,
    `Compare the fractions: ${a}/${d} ___ ${b}/${d}`,
    `Pick the symbol that makes ${a}/${d} ___ ${b}/${d} true.`,
    `${a}/${d} ___ ${b}/${d}. Which symbol fits?`
  ];
  return mc(
    pick(rng, phrasings),
    sym,
    ['<', '>', '='].filter(s => s !== sym),
    `Same denominator means compare numerators: ${a} ${sym} ${b}, so ${a}/${d} ${sym} ${b}/${d}.`,
    rng
  );
}

// ---------- Generators: Grade 4 ----------
const PLACES_G4 = [
  { name: 'ones', mul: 1 },
  { name: 'tens', mul: 10 },
  { name: 'hundreds', mul: 100 },
  { name: 'thousands', mul: 1000 },
  { name: 'ten-thousands', mul: 10000 },
  { name: 'hundred-thousands', mul: 100000 },
  { name: 'millions', mul: 1000000 }
];

function genPlaceValueG4(rng) {
  const p = pick(rng, PLACES_G4);
  const digit = randInt(rng, 1, 9);
  const above = randInt(rng, 0, 99) * p.mul * 10;
  const below = p.mul > 1 ? randInt(rng, 0, p.mul - 1) : 0;
  const number = above + digit * p.mul + below;
  const value = digit * p.mul;
  const phrasings = [
    `What is the value of the digit ${digit} in ${fmt(number)}?`,
    `In ${fmt(number)}, what does the digit ${digit} represent?`,
    `${fmt(number)} — find the value of the ${digit}.`,
    `The digit ${digit} in ${fmt(number)} has what value?`
  ];
  return num(
    pick(rng, phrasings),
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
    { mul: 10000, name: 'ten thousand' },
    { mul: 100000, name: 'hundred thousand' }
  ];
  const t = pick(rng, places);
  const n = randInt(rng, t.mul * 2, t.mul * 99);
  const rounded = Math.round(n / t.mul) * t.mul;
  const phrasings = [
    `Round ${fmt(n)} to the nearest ${t.name}.`,
    `What is ${fmt(n)} rounded to the nearest ${t.name}?`,
    `Estimate ${fmt(n)} to the nearest ${t.name}.`,
    `${fmt(n)} rounded to the ${t.name}s place is what?`
  ];
  return num(
    pick(rng, phrasings),
    rounded,
    `Look at the digit just right of the ${t.name}s place. ${fmt(n)} rounds to ${fmt(rounded)}.`,
    [fmt(rounded), String(rounded)]
  );
}

function genDecimalPlaceG4(rng) {
  const whole = randInt(rng, 0, 999);
  const t = randInt(rng, 0, 9);
  const h = randInt(rng, 0, 9);
  const decStr = `${whole}.${t}${h}`;
  const which = pick(rng, ['tenths', 'hundredths']);
  const ans = which === 'tenths' ? t : h;
  const phrasings = [
    `What digit is in the ${which} place of ${decStr}?`,
    `In the decimal ${decStr}, which digit is in the ${which} place?`,
    `${decStr} — find the digit in the ${which} place.`,
    `Identify the ${which} digit of ${decStr}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `The first digit after the decimal is tenths; the second is hundredths. In ${decStr}, the ${which} digit is ${ans}.`,
    [String(ans)]
  );
}

function genCompareDecimalsG4(rng) {
  const a = (randInt(rng, 100, 9999) / 100).toFixed(2);
  let b;
  do { b = (randInt(rng, 100, 9999) / 100).toFixed(2); } while (b === a);
  const sym = parseFloat(a) < parseFloat(b) ? '<' : '>';
  const phrasings = [
    `Which symbol makes this true?  ${a} ___ ${b}`,
    `Compare the decimals: ${a} ___ ${b}`,
    `${a} ___ ${b}. Pick the correct symbol.`,
    `Which symbol fits in ${a} ___ ${b}?`
  ];
  return mc(
    pick(rng, phrasings),
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
    pick(rng, MUL_PHRASINGS)(a, b),
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
    pick(rng, MUL_PHRASINGS)(a, b),
    ans,
    `Multiply by tens, then ones, and add: ${a} × ${b} = ${fmt(ans)}.`,
    [fmt(ans), String(ans)]
  );
}

function genLongDivG4(rng) {
  const b = randInt(rng, 2, 9);
  const q = randInt(rng, 12, 999);
  const a = b * q;
  return num(
    pick(rng, DIV_PHRASINGS)(a, b),
    q,
    `${fmt(a)} ÷ ${b} = ${fmt(q)}, since ${b} × ${q} = ${fmt(a)}.`,
    [fmt(q), String(q)]
  );
}

function genDivRemainderG4(rng) {
  const b = randInt(rng, 2, 9);
  const q = randInt(rng, 10, 199);
  const r = randInt(rng, 1, b - 1);
  const a = b * q + r;
  const phrasings = [
    `What is the remainder when ${fmt(a)} is divided by ${b}?`,
    `${fmt(a)} ÷ ${b} has what remainder?`,
    `Find the remainder: ${fmt(a)} ÷ ${b}.`,
    `If you divide ${fmt(a)} by ${b}, what is left over?`
  ];
  return num(
    pick(rng, phrasings),
    r,
    `${a} ÷ ${b} = ${q} remainder ${r}, because ${b} × ${q} + ${r} = ${a}.`,
    [String(r), fmt(r)]
  );
}

function genAddFracLikeG4(rng) {
  const d = randInt(rng, 4, 16);
  const a = randInt(rng, 1, d - 2);
  const b = randInt(rng, 1, d - a - 1);
  const ans = `${a + b}/${d}`;
  const phrasings = [
    `${a}/${d} + ${b}/${d} = ?`,
    `What is ${a}/${d} + ${b}/${d}?`,
    `Find the sum: ${a}/${d} + ${b}/${d}.`,
    `Add the fractions: ${a}/${d} + ${b}/${d}.`
  ];
  const pool = [
    `${a + b}/${d * 2}`,
    `${a * b}/${d}`,
    `${a + b + 1}/${d}`,
    `${a + b - 1}/${d}`,
    `${a + b}/${d + 1}`,
    `${a}/${d}`,
    `${b}/${d}`
  ].filter(x => x !== ans);
  const wrongs = Array.from(new Set(pool)).slice(0, 3);
  return mc(
    pick(rng, phrasings),
    ans,
    wrongs,
    `Same denominator: add the numerators only. ${a} + ${b} = ${a + b}, so the answer is ${ans}.`,
    rng
  );
}

function genSubFracLikeG4(rng) {
  const d = randInt(rng, 4, 16);
  const a = randInt(rng, 2, d - 1);
  const b = randInt(rng, 1, a - 1);
  const ans = `${a - b}/${d}`;
  const phrasings = [
    `${a}/${d} − ${b}/${d} = ?`,
    `What is ${a}/${d} − ${b}/${d}?`,
    `Find the difference: ${a}/${d} − ${b}/${d}.`,
    `Subtract: ${a}/${d} − ${b}/${d}.`
  ];
  const pool = [
    `${a - b}/${d * 2}`,
    `${a + b}/${d}`,
    `${a - b + 1}/${d}`,
    `${a - b - 1}/${d}`,
    `${a - b}/${d + 1}`,
    `${a}/${d}`,
    `${b}/${d}`
  ].filter(x => x !== ans && !x.startsWith('0/') && !x.startsWith('-'));
  const wrongs = Array.from(new Set(pool)).slice(0, 3);
  return mc(
    pick(rng, phrasings),
    ans,
    wrongs,
    `Same denominator: subtract numerators. ${a} − ${b} = ${a - b}, so the answer is ${ans}.`,
    rng
  );
}

function genPerimeterG4(rng) {
  const l = randInt(rng, 4, 60);
  const w = randInt(rng, 4, 60);
  const ans = 2 * (l + w);
  const unit = pick(rng, ['ft', 'm', 'cm', 'in', 'yd']);
  const phrasings = [
    `Find the perimeter of a rectangle that is ${l} ${unit} long and ${w} ${unit} wide.`,
    `A rectangle has sides ${l} ${unit} and ${w} ${unit}. What is the perimeter?`,
    `What is the perimeter of a ${l} ${unit} by ${w} ${unit} rectangle?`,
    `A rectangular field is ${l} ${unit} × ${w} ${unit}. Perimeter?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `P = 2(l + w) = 2(${l} + ${w}) = ${ans} ${unit}.`,
    [String(ans), `${ans} ${unit}`]
  );
}

function genAreaG4(rng) {
  const l = randInt(rng, 5, 50);
  const w = randInt(rng, 5, 50);
  const ans = l * w;
  const unit = pick(rng, ['m', 'ft', 'cm', 'in', 'yd']);
  const phrasings = [
    `What is the area of a rectangle that is ${l} ${unit} by ${w} ${unit}?`,
    `Find the area of a ${l} ${unit} × ${w} ${unit} rectangle.`,
    `A rectangle has length ${l} ${unit} and width ${w} ${unit}. What is its area?`,
    `Area of a ${l} by ${w} rectangle (in square ${unit})?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `A = l × w = ${l} × ${w} = ${fmt(ans)} square ${unit}.`,
    [String(ans), fmt(ans), `${ans} sq ${unit}`, `${fmt(ans)} sq ${unit}`]
  );
}

function genAngleClassifyG4(rng) {
  const deg = randInt(rng, 1, 179);
  let ans;
  if (deg < 90) ans = 'acute';
  else if (deg === 90) ans = 'right';
  else ans = 'obtuse';
  const phrasings = [
    `An angle measures ${deg}°. What type of angle is it?`,
    `What kind of angle has a measure of ${deg}°?`,
    `Classify a ${deg}° angle.`,
    `An angle is ${deg}°. Acute, right, or obtuse?`
  ];
  return mc(
    pick(rng, phrasings),
    ans,
    ['acute', 'right', 'obtuse'].filter(x => x !== ans),
    `Acute < 90°, right = 90°, obtuse between 90° and 180°. ${deg}° is ${ans}.`,
    rng
  );
}

// ---------- Generators: Grade 5 ----------
function genDecimalPlaceG5(rng) {
  const whole = randInt(rng, 0, 9999);
  const t = randInt(rng, 0, 9);
  const h = randInt(rng, 0, 9);
  const th = randInt(rng, 0, 9);
  const decStr = `${whole}.${t}${h}${th}`;
  const which = pick(rng, ['tenths', 'hundredths', 'thousandths']);
  const ans = which === 'tenths' ? t : which === 'hundredths' ? h : th;
  const phrasings = [
    `What digit is in the ${which} place of ${decStr}?`,
    `In ${decStr}, which digit is in the ${which} place?`,
    `${decStr} — find the digit in the ${which} place.`,
    `Identify the ${which} digit of ${decStr}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `Tenths is the 1st digit after the decimal, hundredths the 2nd, thousandths the 3rd. In ${decStr} the ${which} digit is ${ans}.`,
    [String(ans)]
  );
}

function genRoundDecimalG5(rng) {
  const whole = randInt(rng, 0, 99);
  const frac = randInt(rng, 1, 999);
  const fracStr = String(frac).padStart(3, '0');
  const d1 = parseInt(fracStr[0], 10);
  const d2 = parseInt(fracStr[1], 10);
  const d3 = parseInt(fracStr[2], 10);
  const places = [
    { name: 'tenth', dp: 1 },
    { name: 'hundredth', dp: 2 }
  ];
  const p = pick(rng, places);
  // Use integer arithmetic to round half-up; avoids JS FP errors (e.g. 70.865 stored as 70.8649999…).
  let intVal, divider;
  if (p.dp === 1) {
    // Combine whole + first decimal digit, round-half-up by second.
    intVal = whole * 10 + d1;
    if (d2 >= 5) intVal += 1;
    divider = 10;
  } else {
    intVal = whole * 100 + d1 * 10 + d2;
    if (d3 >= 5) intVal += 1;
    divider = 100;
  }
  const ansWhole = Math.floor(intVal / divider);
  const ansFrac = intVal % divider;
  const ans = `${ansWhole}.${String(ansFrac).padStart(p.dp, '0')}`;
  const display = `${whole}.${fracStr}`;
  const phrasings = [
    `Round ${display} to the nearest ${p.name}.`,
    `What is ${display} rounded to the nearest ${p.name}?`,
    `${display} rounded to the ${p.name}s place is what?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `Look at the digit right of the ${p.name}s place. ${display} rounds to ${ans}.`,
    [String(ans)]
  );
}

function genAddDecimalsG5(rng) {
  const a = randInt(rng, 100, 99999) / 100;
  const b = randInt(rng, 100, 99999) / 100;
  const ans = (a + b).toFixed(2);
  return num(
    pick(rng, ADD_PHRASINGS)(a.toFixed(2), b.toFixed(2)),
    ans,
    `Line up the decimal points, then add. Result: ${ans}.`,
    [String(ans)]
  );
}

function genSubDecimalsG5(rng) {
  let a = randInt(rng, 200, 99999) / 100;
  let b = randInt(rng, 100, 99999) / 100;
  if (b > a) [a, b] = [b, a];
  const ans = (a - b).toFixed(2);
  return num(
    pick(rng, SUB_PHRASINGS)(a.toFixed(2), b.toFixed(2)),
    ans,
    `Line up the decimal points, regroup as needed, and subtract. Result: ${ans}.`,
    [String(ans)]
  );
}

function genMulDecWholeG5(rng) {
  const a = randInt(rng, 11, 999) / 10;
  const b = randInt(rng, 2, 12);
  const ans = (a * b).toFixed(1);
  return num(
    pick(rng, MUL_PHRASINGS)(a.toFixed(1), b),
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
    pick(rng, MUL_PHRASINGS)(a.toFixed(1), b.toFixed(1)),
    ans,
    `Multiply as whole numbers, then place 2 decimal points (one from each factor). Result: ${ans}.`,
    [String(ans)]
  );
}

function genDivDecWholeG5(rng) {
  const b = randInt(rng, 2, 12);
  const q = randInt(rng, 11, 999) / 10;
  const a = (q * b).toFixed(1);
  return num(
    pick(rng, DIV_PHRASINGS)(a, b),
    q.toFixed(1),
    `${a} ÷ ${b} = ${q.toFixed(1)} because ${q.toFixed(1)} × ${b} = ${a}.`,
    [q.toFixed(1)]
  );
}

function genAddUnlikeFracG5(rng) {
  const denoms = [2, 3, 4, 5, 6, 8, 10, 12];
  const d1 = pick(rng, denoms);
  const d2 = pick(rng, denoms.filter(x => x !== d1));
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
  const phrasings = [
    `${n1}/${d1} + ${n2}/${d2} = ?  (simplest form)`,
    `Find the sum in simplest form: ${n1}/${d1} + ${n2}/${d2}.`,
    `What is ${n1}/${d1} + ${n2}/${d2} in simplest form?`,
    `Add the fractions and simplify: ${n1}/${d1} + ${n2}/${d2}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `Common denominator is ${lcm}. Convert: ${n1}/${d1} = ${num1}/${lcm}, ${n2}/${d2} = ${num2}/${lcm}. Sum = ${num1 + num2}/${lcm} = ${ans}.`,
    [ans]
  );
}

function genSubUnlikeFracG5(rng) {
  const denoms = [2, 3, 4, 5, 6, 8, 10, 12];
  let d1 = pick(rng, denoms);
  let d2 = pick(rng, denoms.filter(x => x !== d1));
  let n1 = randInt(rng, 1, d1 - 1);
  let n2 = randInt(rng, 1, d2 - 1);
  if (n2 / d2 > n1 / d1) {
    [d1, d2] = [d2, d1];
    [n1, n2] = [n2, n1];
  }
  if (n1 / d1 === n2 / d2) return genSubUnlikeFracG5(rng);
  const lcm = (d1 * d2) / gcd(d1, d2);
  const num1 = n1 * (lcm / d1);
  const num2 = n2 * (lcm / d2);
  let ansN = num1 - num2;
  let ansD = lcm;
  const g = gcd(Math.abs(ansN), ansD);
  ansN /= g; ansD /= g;
  const ans = ansD === 1 ? String(ansN) : `${ansN}/${ansD}`;
  const phrasings = [
    `${n1}/${d1} − ${n2}/${d2} = ?  (simplest form)`,
    `Find the difference in simplest form: ${n1}/${d1} − ${n2}/${d2}.`,
    `What is ${n1}/${d1} − ${n2}/${d2} in simplest form?`,
    `Subtract and simplify: ${n1}/${d1} − ${n2}/${d2}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `Common denominator ${lcm}: ${n1}/${d1} = ${num1}/${lcm}, ${n2}/${d2} = ${num2}/${lcm}. Difference = ${num1 - num2}/${lcm} = ${ans}.`,
    [ans]
  );
}

function genOrderOpsG5(rng) {
  const a = randInt(rng, 2, 20);
  const b = randInt(rng, 2, 12);
  const c = randInt(rng, 2, 12);
  const d = randInt(rng, 1, 15);
  // Pick a template; compute its result.
  const templates = [
    { expr: `${a} + ${b} × ${c} − ${d}`, val: a + b * c - d, hint: `Multiply first: ${b} × ${c} = ${b * c}. Then ${a} + ${b * c} − ${d}.` },
    { expr: `${a} × ${b} + ${c} × ${d}`, val: a * b + c * d, hint: `Both products first: ${a * b} + ${c * d}.` },
    { expr: `(${a} + ${b}) × ${c}`, val: (a + b) * c, hint: `Parentheses first: ${a + b}. Then × ${c}.` },
    { expr: `${a} × (${b} + ${c})`, val: a * (b + c), hint: `Parentheses first: ${b + c}. Then ${a} × that.` },
    { expr: `${a * b} ÷ ${b} + ${c}`, val: (a * b) / b + c, hint: `Division first: ${a * b} ÷ ${b} = ${a}. Then + ${c}.` }
  ];
  const t = pick(rng, templates);
  const phrasings = [
    `${t.expr} = ?`,
    `Evaluate: ${t.expr}`,
    `What is the value of ${t.expr}?`,
    `Use the order of operations: ${t.expr}.`
  ];
  return num(
    pick(rng, phrasings),
    t.val,
    `${t.hint} = ${t.val}.`,
    [String(t.val), fmt(t.val)]
  );
}

function genVolumeG5(rng) {
  const l = randInt(rng, 2, 20);
  const w = randInt(rng, 2, 20);
  const h = randInt(rng, 2, 20);
  const ans = l * w * h;
  const phrasings = [
    `Find the volume of a rectangular prism that is ${l} × ${w} × ${h} units.`,
    `A rectangular prism has length ${l}, width ${w}, and height ${h}. Find its volume.`,
    `What is the volume of a ${l} by ${w} by ${h} box?`,
    `A box measures ${l} units long, ${w} units wide, and ${h} units tall. Volume?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `V = l × w × h = ${l} × ${w} × ${h} = ${fmt(ans)} cubic units.`,
    [String(ans), fmt(ans), `${ans} cubic units`, `${fmt(ans)} cubic units`]
  );
}

function genCustomaryG5(rng) {
  const conv = pick(rng, [
    { from: 'feet', to: 'inches', factor: 12, sing: 'foot' },
    { from: 'yards', to: 'feet', factor: 3, sing: 'yard' },
    { from: 'yards', to: 'inches', factor: 36, sing: 'yard' },
    { from: 'miles', to: 'feet', factor: 5280, sing: 'mile' },
    { from: 'pounds', to: 'ounces', factor: 16, sing: 'pound' },
    { from: 'tons', to: 'pounds', factor: 2000, sing: 'ton' },
    { from: 'gallons', to: 'quarts', factor: 4, sing: 'gallon' },
    { from: 'gallons', to: 'pints', factor: 8, sing: 'gallon' },
    { from: 'gallons', to: 'cups', factor: 16, sing: 'gallon' },
    { from: 'quarts', to: 'pints', factor: 2, sing: 'quart' },
    { from: 'quarts', to: 'cups', factor: 4, sing: 'quart' },
    { from: 'pints', to: 'cups', factor: 2, sing: 'pint' }
  ]);
  const n = randInt(rng, 2, 25);
  const ans = n * conv.factor;
  const phrasings = [
    `Convert: ${n} ${conv.from} = ? ${conv.to}`,
    `How many ${conv.to} are in ${n} ${conv.from}?`,
    `${n} ${conv.from} equals how many ${conv.to}?`,
    `Change ${n} ${conv.from} to ${conv.to}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `1 ${conv.sing} = ${conv.factor} ${conv.to}, so ${n} ${conv.from} = ${fmt(ans)} ${conv.to}.`,
    [String(ans), fmt(ans), `${ans} ${conv.to}`, `${fmt(ans)} ${conv.to}`]
  );
}

function genMetricG5(rng) {
  const conv = pick(rng, [
    { from: 'm', to: 'cm', factor: 100 },
    { from: 'm', to: 'mm', factor: 1000 },
    { from: 'cm', to: 'mm', factor: 10 },
    { from: 'km', to: 'm', factor: 1000 },
    { from: 'km', to: 'cm', factor: 100000 },
    { from: 'kg', to: 'g', factor: 1000 },
    { from: 'g', to: 'mg', factor: 1000 },
    { from: 'L', to: 'mL', factor: 1000 },
    { from: 'kL', to: 'L', factor: 1000 }
  ]);
  const n = randInt(rng, 2, 50);
  const ans = n * conv.factor;
  const phrasings = [
    `Convert: ${n} ${conv.from} = ? ${conv.to}`,
    `How many ${conv.to} are in ${n} ${conv.from}?`,
    `${n} ${conv.from} equals how many ${conv.to}?`,
    `Change ${n} ${conv.from} to ${conv.to}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `1 ${conv.from} = ${fmt(conv.factor)} ${conv.to}, so ${n} ${conv.from} = ${fmt(ans)} ${conv.to}.`,
    [String(ans), fmt(ans), `${fmt(ans)} ${conv.to}`]
  );
}

// ---------- Generators: Kindergarten ----------
const NUMBER_WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];

function genCountTo10K(rng) {
  const n = randInt(rng, 1, 10);
  const item = pick(rng, ['🍎','⭐','🐶','🐱','🐰','🌸','🍌','🐟','🚗','⚽','🦋','🐢']);
  const row = item.repeat(n);
  const phrasings = [
    `Count the pictures: ${row}  How many are there?`,
    `How many ${item} do you see?  ${row}`,
    `Count: ${row}  How many?`
  ];
  return num(
    pick(rng, phrasings),
    n,
    `Count one by one. There are ${n}.`,
    [String(n), NUMBER_WORDS[n]]
  );
}

function genCountTo20K(rng) {
  const n = randInt(rng, 11, 20);
  const item = pick(rng, ['⭐','🍎','🐶','🌸','🍓','🐢','🐝']);
  const row = item.repeat(n);
  return num(
    `Count the pictures: ${row}  How many are there?`,
    n,
    `Count one by one. There are ${n}.`,
    [String(n), NUMBER_WORDS[n]]
  );
}

function genNumberNamesK(rng) {
  const n = randInt(rng, 0, 20);
  const correctWord = NUMBER_WORDS[n];
  // Choose direction: digit -> word, or word -> digit.
  if (rng() < 0.5) {
    // Show digit, ask which word.
    const wrongs = shuffleA(rng, NUMBER_WORDS.filter(w => w !== correctWord)).slice(0, 3);
    return mc(
      `Which word matches the number ${n}?`,
      correctWord,
      wrongs,
      `${n} is written as "${correctWord}".`,
      rng
    );
  }
  // Show word, ask which digit.
  const wrongDigits = shuffleA(rng, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].filter(x => x !== n)).slice(0, 3);
  return mc(
    `Which number matches the word "${correctWord}"?`,
    String(n),
    wrongDigits.map(String),
    `"${correctWord}" is the number ${n}.`,
    rng
  );
}

function genMoreLessEqualK(rng) {
  const a = randInt(rng, 0, 12);
  let b;
  do { b = randInt(rng, 0, 12); } while (b === a);
  const itemA = pick(rng, ['🍎','⭐','🐱','🌸']);
  const itemB = pick(rng, ['🍌','🐟','🚗','🐶']);
  // Two prompt families to keep the answer space simple and unambiguous.
  if (rng() < 0.5) {
    // "Set A has more or less than Set B?" — answer is more/less.
    const ans = a > b ? 'more' : 'less';
    const phrasings = [
      `Set A: ${itemA.repeat(a)}\nSet B: ${itemB.repeat(b)}\nDoes Set A have more or less than Set B?`,
      `Compare: ${a} and ${b}. Is ${a} more or less than ${b}?`,
      `Is ${a} more or less than ${b}?`
    ];
    return mc(
      pick(rng, phrasings),
      ans,
      ['more', 'less'].filter(x => x !== ans),
      `${a} is ${ans} than ${b}.`,
      rng
    );
  }
  // "Which number is greater?" — answer is the larger digit.
  const greater = Math.max(a, b);
  return mc(
    `Which number is greater: ${a} or ${b}?`,
    String(greater),
    [String(a === greater ? b : a)],
    `${greater} is greater than ${a === greater ? b : a}.`,
    rng
  );
}

function genOneMoreLessK(rng) {
  const n = randInt(rng, 1, 19);
  const direction = pick(rng, ['more', 'less']);
  const ans = direction === 'more' ? n + 1 : n - 1;
  const phrasings = [
    `What number is one ${direction} than ${n}?`,
    `One ${direction} than ${n} is what number?`,
    `Find the number that is 1 ${direction} than ${n}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    direction === 'more' ? `${n} + 1 = ${ans}.` : `${n} − 1 = ${ans}.`,
    [String(ans), NUMBER_WORDS[ans]]
  );
}

function genAddWithin10K(rng) {
  const a = randInt(rng, 0, 10);
  const b = randInt(rng, 0, 10 - a);
  const ans = a + b;
  const phrasings = [
    `${a} + ${b} = ?`,
    `What is ${a} plus ${b}?`,
    `Add ${a} and ${b}.`,
    `${pick(rng, NAMES)} has ${a} ${pick(rng, ITEMS.small)}. ${pick(rng, NAMES)} gives ${pick(rng, ['her','him','them'])} ${b} more. How many in all?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `${a} + ${b} = ${ans}.`,
    [String(ans), NUMBER_WORDS[ans] || String(ans)]
  );
}

function genSubWithin10K(rng) {
  const a = randInt(rng, 1, 10);
  const b = randInt(rng, 0, a);
  const ans = a - b;
  const item = pick(rng, ITEMS.small);
  const name = pick(rng, NAMES);
  const phrasings = [
    `${a} − ${b} = ?`,
    `What is ${a} minus ${b}?`,
    `Subtract ${b} from ${a}.`,
    `${name} has ${a} ${item} and gives away ${b}. How many ${item} are left?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `${a} − ${b} = ${ans}.`,
    [String(ans), NUMBER_WORDS[ans] || String(ans)]
  );
}

const SHAPES_2D_K = [
  { name: 'circle', sides: 0, hint: 'A circle has no straight sides.' },
  { name: 'triangle', sides: 3, hint: 'A triangle has 3 sides.' },
  { name: 'square', sides: 4, hint: 'A square has 4 equal sides.' },
  { name: 'rectangle', sides: 4, hint: 'A rectangle has 4 sides (2 long, 2 short).' },
  { name: 'pentagon', sides: 5, hint: 'A pentagon has 5 sides.' },
  { name: 'hexagon', sides: 6, hint: 'A hexagon has 6 sides.' }
];

function genIdShapeK(rng) {
  const s = pick(rng, SHAPES_2D_K);
  const phrasings = [
    `Which shape has ${s.sides} sides?`,
    `A shape with ${s.sides} ${s.sides === 1 ? 'side' : 'sides'} is a ___?`,
    `Pick the shape that has ${s.sides} sides.`
  ];
  if (s.sides === 0) {
    return mc(
      `Which shape has no straight sides?`,
      s.name,
      shuffleA(rng, SHAPES_2D_K.filter(x => x.name !== s.name)).slice(0, 3).map(x => x.name),
      s.hint,
      rng
    );
  }
  return mc(
    pick(rng, phrasings),
    s.name,
    shuffleA(rng, SHAPES_2D_K.filter(x => x.name !== s.name && x.sides !== s.sides)).slice(0, 3).map(x => x.name),
    s.hint,
    rng
  );
}

function genShapeSidesK(rng) {
  const s = pick(rng, SHAPES_2D_K.filter(x => x.sides > 0));
  const phrasings = [
    `How many sides does a ${s.name} have?`,
    `A ${s.name} has how many sides?`,
    `Count the sides of a ${s.name}.`
  ];
  return num(
    pick(rng, phrasings),
    s.sides,
    s.hint,
    [String(s.sides), NUMBER_WORDS[s.sides]]
  );
}

// ---------- Generators: Grade 1 ----------
function genCountTo120G1(rng) {
  // "What number comes next: 47, 48, 49, ?"  or  "What number comes before 100?"
  const style = pick(rng, ['next', 'before', 'between']);
  if (style === 'next') {
    const start = randInt(rng, 1, 117);
    const phrasings = [
      `What number comes next: ${start}, ${start + 1}, ${start + 2}, ___?`,
      `Count forward from ${start + 2}. The next number is ___?`,
      `${start + 2} + 1 = ?`
    ];
    return num(
      pick(rng, phrasings),
      start + 3,
      `Count forward by 1: ${start + 2} → ${start + 3}.`,
      [String(start + 3), fmt(start + 3)]
    );
  }
  if (style === 'before') {
    const n = randInt(rng, 2, 120);
    return num(
      `What number comes just before ${n}?`,
      n - 1,
      `${n} − 1 = ${n - 1}.`,
      [String(n - 1), fmt(n - 1)]
    );
  }
  const a = randInt(rng, 1, 118);
  const b = a + 2;
  return num(
    `What number is between ${a} and ${b}?`,
    a + 1,
    `${a}, ${a + 1}, ${b}. The number between is ${a + 1}.`,
    [String(a + 1), fmt(a + 1)]
  );
}

function genTensOnesG1(rng) {
  const tens = randInt(rng, 1, 9);
  const ones = randInt(rng, 0, 9);
  const n = tens * 10 + ones;
  const ask = pick(rng, ['tens', 'ones']);
  const ans = ask === 'tens' ? tens : ones;
  const phrasings = [
    `In ${n}, how many ${ask} are there?`,
    `${n} = ___ tens and ___ ones. How many ${ask}?`,
    `What is the digit in the ${ask} place of ${n}?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `${n} = ${tens} tens + ${ones} ones, so the ${ask} digit is ${ans}.`,
    [String(ans)]
  );
}

function genCompareG1(rng) {
  const a = randInt(rng, 1, 120);
  let b;
  do { b = randInt(rng, 1, 120); } while (b === a);
  const sym = a < b ? '<' : '>';
  const phrasings = [
    `Which symbol makes this true?  ${a} ___ ${b}`,
    `Compare: ${a} ___ ${b}. Pick the right symbol.`,
    `${a} ___ ${b}. Is it < or >?`
  ];
  return mc(
    pick(rng, phrasings),
    sym,
    ['<', '>', '='].filter(s => s !== sym),
    `${a} ${sym} ${b}.`,
    rng
  );
}

function genAddWithin10G1(rng) {
  const a = randInt(rng, 0, 10);
  const b = randInt(rng, 0, 10 - a);
  const ans = a + b;
  return num(
    pick(rng, ADD_PHRASINGS)(a, b),
    ans,
    `${a} + ${b} = ${ans}.`,
    [String(ans)]
  );
}

function genAddWithin20G1(rng) {
  const a = randInt(rng, 1, 19);
  const b = randInt(rng, 1, 20 - a);
  const ans = a + b;
  return num(
    pick(rng, ADD_PHRASINGS)(a, b),
    ans,
    `${a} + ${b} = ${ans}.`,
    [String(ans)]
  );
}

function genSubWithin10G1(rng) {
  const a = randInt(rng, 1, 10);
  const b = randInt(rng, 0, a);
  const ans = a - b;
  return num(
    pick(rng, SUB_PHRASINGS)(a, b),
    ans,
    `${a} − ${b} = ${ans}.`,
    [String(ans)]
  );
}

function genSubWithin20G1(rng) {
  const a = randInt(rng, 5, 20);
  const b = randInt(rng, 1, a);
  const ans = a - b;
  return num(
    pick(rng, SUB_PHRASINGS)(a, b),
    ans,
    `${a} − ${b} = ${ans}.`,
    [String(ans)]
  );
}

function genWordProblemG1(rng) {
  const op = pick(rng, ['add', 'sub']);
  const name = pick(rng, NAMES);
  const item = pick(rng, ALL_ITEMS);
  if (op === 'add') {
    const a = randInt(rng, 1, 12);
    const b = randInt(rng, 1, 20 - a);
    const ans = a + b;
    const phrasings = [
      `${name} has ${a} ${item}. A friend gives ${name} ${b} more. How many ${item} now?`,
      `${name} found ${a} ${item} on Monday and ${b} more on Tuesday. How many altogether?`,
      `There are ${a} ${item} on a tray. ${name} adds ${b} more. How many ${item} are on the tray?`,
      `${a} ${item} plus ${b} ${item} equals how many?`
    ];
    return num(
      pick(rng, phrasings),
      ans,
      `${a} + ${b} = ${ans}.`,
      [String(ans)]
    );
  }
  const a = randInt(rng, 5, 20);
  const b = randInt(rng, 1, a);
  const ans = a - b;
  const phrasings = [
    `${name} has ${a} ${item}. ${name} gives away ${b}. How many ${item} are left?`,
    `There were ${a} ${item} in the basket. ${name} took ${b}. How many remain?`,
    `${a} ${item} minus ${b} ${item} equals how many?`,
    `${name} had ${a} ${item} and ate ${b}. How many ${item} are left?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `${a} − ${b} = ${ans}.`,
    [String(ans)]
  );
}

function genShapesG1(rng) {
  const s = pick(rng, SHAPES_2D_K.filter(x => x.sides > 0));
  // Mix: identify by side count, or count sides.
  if (rng() < 0.5) {
    return mc(
      `Which shape has ${s.sides} sides?`,
      s.name,
      shuffleA(rng, SHAPES_2D_K.filter(x => x.name !== s.name && x.sides !== s.sides && x.sides > 0)).slice(0, 3).map(x => x.name),
      s.hint,
      rng
    );
  }
  return num(
    `How many sides does a ${s.name} have?`,
    s.sides,
    s.hint,
    [String(s.sides)]
  );
}

function genMeasureLengthG1(rng) {
  const unit = pick(rng, ['paper clips', 'cubes', 'pencils', 'crayons']);
  const a = randInt(rng, 2, 12);
  const b = randInt(rng, 2, 12);
  const phrasings = [
    `A book is ${a} ${unit} long. A pencil is ${b} ${unit} long. How much longer is the longer one?`,
    `${pick(rng, NAMES)}'s desk is ${a} ${unit} long and a notebook is ${b} ${unit} long. How many more ${unit} is the longer object?`
  ];
  const ans = Math.abs(a - b);
  return num(
    pick(rng, phrasings),
    ans,
    `Subtract: |${a} − ${b}| = ${ans} ${unit}.`,
    [String(ans), `${ans} ${unit}`]
  );
}

function genTellTimeG1(rng) {
  const h = randInt(rng, 1, 12);
  const m = pick(rng, [0, 30]);
  const time = `${h}:${String(m).padStart(2, '0')}`;
  const phrasings = [
    `What time does the clock show: hour hand on ${h}, minute hand on ${m === 0 ? '12' : '6'}?`,
    `If it is exactly ${m === 0 ? `${h} o'clock` : `half past ${h}`}, what is the time written?`
  ];
  return num(
    pick(rng, phrasings),
    time,
    m === 0 ? `${h} o'clock is written ${time}.` : `Half past ${h} is written ${time}.`,
    [time]
  );
}

const COINS = [
  { name: 'penny', value: 1 },
  { name: 'nickel', value: 5 },
  { name: 'dime', value: 10 },
  { name: 'quarter', value: 25 }
];

function genIdCoinG1(rng) {
  const c = pick(rng, COINS);
  const phrasings = [
    `Which coin is worth ${c.value} ${c.value === 1 ? 'cent' : 'cents'}?`,
    `A ${c.value === 1 ? '1-cent' : `${c.value}-cent`} coin is called a ___?`,
    `What is the name of the coin worth ${c.value}¢?`
  ];
  return mc(
    pick(rng, phrasings),
    c.name,
    shuffleA(rng, COINS.filter(x => x.name !== c.name)).slice(0, 3).map(x => x.name),
    `A ${c.name} is worth ${c.value}¢.`,
    rng
  );
}

// ---------- Generators: Grade 2 ----------
function genPlaceValueG2(rng) {
  const places = [
    { name: 'ones', mul: 1 },
    { name: 'tens', mul: 10 },
    { name: 'hundreds', mul: 100 }
  ];
  const p = pick(rng, places);
  const digit = randInt(rng, 1, 9);
  const above = p.mul === 100 ? randInt(rng, 0, 1) * 1000 : randInt(rng, 0, 11) * p.mul * 10;
  const below = p.mul > 1 ? randInt(rng, 0, p.mul - 1) : 0;
  let n = above + digit * p.mul + below;
  if (n > 1200) n = digit * p.mul + below;
  const value = digit * p.mul;
  const phrasings = [
    `What is the value of the digit ${digit} in ${fmt(n)}?`,
    `In ${fmt(n)}, what does the ${digit} represent?`,
    `The digit ${digit} in ${fmt(n)} is in the ${p.name} place. What is its value?`
  ];
  return num(
    pick(rng, phrasings),
    value,
    `The ${digit} sits in the ${p.name} place: ${digit} × ${p.mul} = ${value}.`,
    [String(value), fmt(value)]
  );
}

function genCompareG2(rng) {
  const a = randInt(rng, 10, 1200);
  let b;
  do { b = randInt(rng, 10, 1200); } while (b === a);
  const sym = a < b ? '<' : '>';
  return mc(
    pick(rng, [
      `Which symbol makes this true?  ${fmt(a)} ___ ${fmt(b)}`,
      `Compare: ${fmt(a)} ___ ${fmt(b)}.`,
      `${fmt(a)} ___ ${fmt(b)}. Pick <, >, or =.`
    ]),
    sym,
    ['<', '>', '='].filter(s => s !== sym),
    `${fmt(a)} ${sym} ${fmt(b)}.`,
    rng
  );
}

function genSkipCountG2(rng) {
  const step = pick(rng, [2, 5, 10, 100]);
  const start = step === 100 ? randInt(rng, 100, 800) : randInt(rng, step, 80);
  const seq = [start, start + step, start + 2 * step];
  return num(
    `Skip count by ${step}s: ${seq.join(', ')}, ___?`,
    seq[2] + step,
    `Add ${step} to ${seq[2]}: ${seq[2]} + ${step} = ${seq[2] + step}.`,
    [String(seq[2] + step), fmt(seq[2] + step)]
  );
}

function genAdd2DigitG2(rng) {
  const a = randInt(rng, 10, 89);
  const b = randInt(rng, 10, 89);
  const ans = a + b;
  return num(
    pick(rng, ADD_PHRASINGS)(a, b),
    ans,
    `Add ones, then tens, regrouping if needed. ${a} + ${b} = ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genAdd3DigitG2(rng) {
  const a = randInt(rng, 100, 499);
  const b = randInt(rng, 100, 499);
  const ans = a + b;
  return num(
    pick(rng, ADD_PHRASINGS)(a, b),
    ans,
    `Add ones, tens, then hundreds. ${a} + ${b} = ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genSub2DigitG2(rng) {
  const a = randInt(rng, 20, 99);
  const b = randInt(rng, 10, a - 1);
  const ans = a - b;
  return num(
    pick(rng, SUB_PHRASINGS)(a, b),
    ans,
    `Subtract ones, then tens, regrouping if needed. ${a} − ${b} = ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genSub3DigitG2(rng) {
  const a = randInt(rng, 200, 999);
  const b = randInt(rng, 100, a - 1);
  const ans = a - b;
  return num(
    pick(rng, SUB_PHRASINGS)(a, b),
    ans,
    `${a} − ${b} = ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genEqualGroupsG2(rng) {
  const groups = randInt(rng, 2, 6);
  const each = randInt(rng, 2, 6);
  const ans = groups * each;
  const name = pick(rng, NAMES);
  const item = pick(rng, ALL_ITEMS);
  const phrasings = [
    `${name} has ${groups} bags. Each bag has ${each} ${item}. How many ${item} in all?`,
    `There are ${groups} groups of ${each}. How many in total?`,
    `${groups} plates each have ${each} ${item}. Total ${item}?`,
    `${each} + ${each} ${groups > 2 ? `+ ${each}`.repeat(groups - 2) : ''} = ?`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `${groups} groups of ${each} = ${groups} × ${each} = ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genArrayG2(rng) {
  const r = randInt(rng, 2, 8);
  const c = randInt(rng, 2, 8);
  const ans = r * c;
  return num(
    pick(rng, [
      `An array has ${r} rows and ${c} columns. How many squares are in the array?`,
      `Find the total in a ${r}-by-${c} array.`,
      `${r} rows of ${c} dots — how many dots?`
    ]),
    ans,
    `${r} × ${c} = ${ans}.`,
    [String(ans), fmt(ans)]
  );
}

function genFractionsG2(rng) {
  const f = pick(rng, [
    { word: 'half', parts: 2 },
    { word: 'third', parts: 3 },
    { word: 'fourth', parts: 4 }
  ]);
  if (rng() < 0.5) {
    return num(
      `If a shape is divided into equal parts and one part is one ${f.word}, into how many equal parts is the shape divided?`,
      f.parts,
      `One ${f.word} means 1 of ${f.parts} equal parts.`,
      [String(f.parts), NUMBER_WORDS[f.parts]]
    );
  }
  const wrongs = [2, 3, 4, 5, 6, 8].filter(x => x !== f.parts).slice(0, 3);
  return mc(
    `A pizza is cut into ${f.parts} equal pieces. One piece is one ___?`,
    f.word,
    ['half', 'third', 'fourth', 'fifth', 'sixth', 'eighth'].filter(x => x !== f.word).slice(0, 3),
    `${f.parts} equal parts → each is one ${f.word}.`,
    rng
  );
}

function genCoinTotalG2(rng) {
  // Combine 2-4 coin types into a total in cents.
  const choices = shuffleA(rng, COINS).slice(0, randInt(rng, 2, 4));
  let total = 0;
  const counts = choices.map(c => {
    const n = randInt(rng, 1, 4);
    total += n * c.value;
    return { coin: c, n };
  });
  const desc = counts.map(({ coin, n }) => `${n} ${coin.name}${n === 1 ? '' : 's'}`).join(' and ');
  const phrasings = [
    `What is the total value of ${desc}?`,
    `${pick(rng, NAMES)} has ${desc}. How many cents in all?`,
    `Find the total: ${desc}.`
  ];
  return num(
    pick(rng, phrasings),
    total,
    `${counts.map(({ coin, n }) => `${n} × ${coin.value}¢ = ${n * coin.value}¢`).join('; ')}. Total = ${total}¢.`,
    [String(total), `${total}¢`, `${total} cents`]
  );
}

function genTime5G2(rng) {
  const h = randInt(rng, 1, 12);
  const m = pick(rng, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  const time = `${h}:${String(m).padStart(2, '0')}`;
  const phrasings = [
    `If the hour hand is just past ${h} and the minute hand points to ${m / 5 || 12}, what time is it?`,
    `Write the time: ${m} minutes after ${h}.`,
    `What time is ${m} minutes after ${h} o'clock?`
  ];
  return num(
    pick(rng, phrasings),
    time,
    `${m} minutes after ${h}:00 is ${time}.`,
    [time]
  );
}

function genShapeSidesG2(rng) {
  const shapes = [
    { name: 'triangle', sides: 3, vertices: 3 },
    { name: 'square', sides: 4, vertices: 4 },
    { name: 'rectangle', sides: 4, vertices: 4 },
    { name: 'pentagon', sides: 5, vertices: 5 },
    { name: 'hexagon', sides: 6, vertices: 6 },
    { name: 'octagon', sides: 8, vertices: 8 }
  ];
  const s = pick(rng, shapes);
  const ask = pick(rng, ['sides', 'vertices']);
  const ans = ask === 'sides' ? s.sides : s.vertices;
  const phrasings = [
    `How many ${ask} does a ${s.name} have?`,
    `A ${s.name} has how many ${ask}?`,
    `Count the ${ask} of a ${s.name}.`
  ];
  return num(
    pick(rng, phrasings),
    ans,
    `A ${s.name} has ${s.sides} sides and ${s.vertices} vertices.`,
    [String(ans), NUMBER_WORDS[ans]]
  );
}

// ---------- Bank specs ----------
const TARGET = 1000;
const SPECS = {
  'grade-k-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genCountTo10K },
    { unit: 'u1', lesson: 'u1l2', gen: genCountTo20K },
    { unit: 'u1', lesson: 'u1l3', gen: genNumberNamesK },
    { unit: 'u2', lesson: 'u2l1', gen: genMoreLessEqualK },
    { unit: 'u2', lesson: 'u2l2', gen: genOneMoreLessK },
    { unit: 'u3', lesson: 'u3l1', gen: genAddWithin10K },
    { unit: 'u3', lesson: 'u3l2', gen: genSubWithin10K },
    { unit: 'u4', lesson: 'u4l1', gen: genIdShapeK },
    { unit: 'u4', lesson: 'u4l2', gen: genShapeSidesK }
  ],
  'grade-1-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genCountTo120G1 },
    { unit: 'u1', lesson: 'u1l2', gen: genTensOnesG1 },
    { unit: 'u1', lesson: 'u1l3', gen: genCompareG1 },
    { unit: 'u2', lesson: 'u2l1', gen: genAddWithin10G1 },
    { unit: 'u2', lesson: 'u2l2', gen: genAddWithin20G1 },
    { unit: 'u3', lesson: 'u3l1', gen: genSubWithin10G1 },
    { unit: 'u3', lesson: 'u3l2', gen: genSubWithin20G1 },
    { unit: 'u4', lesson: 'u4l1', gen: genWordProblemG1 },
    { unit: 'u5', lesson: 'u5l1', gen: genShapesG1 },
    { unit: 'u5', lesson: 'u5l2', gen: genMeasureLengthG1 },
    { unit: 'u6', lesson: 'u6l1', gen: genTellTimeG1 },
    { unit: 'u6', lesson: 'u6l2', gen: genIdCoinG1 }
  ],
  'grade-2-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genPlaceValueG2 },
    { unit: 'u1', lesson: 'u1l2', gen: genCompareG2 },
    { unit: 'u1', lesson: 'u1l3', gen: genSkipCountG2 },
    { unit: 'u2', lesson: 'u2l1', gen: genAdd2DigitG2 },
    { unit: 'u2', lesson: 'u2l2', gen: genAdd3DigitG2 },
    { unit: 'u3', lesson: 'u3l1', gen: genSub2DigitG2 },
    { unit: 'u3', lesson: 'u3l2', gen: genSub3DigitG2 },
    { unit: 'u4', lesson: 'u4l1', gen: genEqualGroupsG2 },
    { unit: 'u4', lesson: 'u4l2', gen: genArrayG2 },
    { unit: 'u5', lesson: 'u5l1', gen: genFractionsG2 },
    { unit: 'u6', lesson: 'u6l1', gen: genCoinTotalG2 },
    { unit: 'u7', lesson: 'u7l1', gen: genTime5G2 },
    { unit: 'u8', lesson: 'u8l1', gen: genShapeSidesG2 }
  ],
  'grade-3-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genPlaceValueG3 },
    { unit: 'u1', lesson: 'u1l2', gen: genCompareG3 },
    { unit: 'u1', lesson: 'u1l3', gen: genRoundingG3 },
    { unit: 'u2', lesson: 'u2l2', gen: genEquivFracG3 },
    { unit: 'u2', lesson: 'u2l3', gen: genCompareFracG3 },
    { unit: 'u3', lesson: 'u3l1', gen: genAdd3DigitG3 },
    { unit: 'u3', lesson: 'u3l2', gen: genSub3DigitG3 },
    { unit: 'u4', lesson: 'u4l2', gen: genMulFactsG3 },
    { unit: 'u4', lesson: 'u4l3', gen: genMulWordG3 },
    { unit: 'u5', lesson: 'u5l1', gen: genDivG3 },
    { unit: 'u5', lesson: 'u5l2', gen: genFactFamilyG3 },
    { unit: 'u6', lesson: 'u6l1', gen: genUnknownG3 },
    { unit: 'u8', lesson: 'u8l1', gen: genPerimeterG3 },
    { unit: 'u8', lesson: 'u8l2', gen: genAreaG3 },
    { unit: 'u9', lesson: 'u9l1', gen: genElapsedG3 }
  ],
  'grade-4-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genPlaceValueG4 },
    { unit: 'u1', lesson: 'u1l3', gen: genRoundingG4 },
    { unit: 'u2', lesson: 'u2l1', gen: genDecimalPlaceG4 },
    { unit: 'u2', lesson: 'u2l2', gen: genCompareDecimalsG4 },
    { unit: 'u4', lesson: 'u4l1', gen: genAddFracLikeG4 },
    { unit: 'u4', lesson: 'u4l2', gen: genSubFracLikeG4 },
    { unit: 'u5', lesson: 'u5l1', gen: genMul1DigitG4 },
    { unit: 'u5', lesson: 'u5l2', gen: genMul2DigitG4 },
    { unit: 'u6', lesson: 'u6l1', gen: genLongDivG4 },
    { unit: 'u6', lesson: 'u6l2', gen: genDivRemainderG4 },
    { unit: 'u8', lesson: 'u8l2', gen: genAngleClassifyG4 },
    { unit: 'u9', lesson: 'u9l1', gen: genPerimeterG4 },
    { unit: 'u9', lesson: 'u9l2', gen: genAreaG4 }
  ],
  'grade-5-curriculum.json': [
    { unit: 'u1', lesson: 'u1l1', gen: genDecimalPlaceG5 },
    { unit: 'u1', lesson: 'u1l3', gen: genRoundDecimalG5 },
    { unit: 'u2', lesson: 'u2l1', gen: genAddDecimalsG5 },
    { unit: 'u2', lesson: 'u2l2', gen: genSubDecimalsG5 },
    { unit: 'u3', lesson: 'u3l1', gen: genMulDecWholeG5 },
    { unit: 'u3', lesson: 'u3l2', gen: genMulDecDecG5 },
    { unit: 'u3', lesson: 'u3l3', gen: genDivDecWholeG5 },
    { unit: 'u4', lesson: 'u4l1', gen: genAddUnlikeFracG5 },
    { unit: 'u4', lesson: 'u4l2', gen: genSubUnlikeFracG5 },
    { unit: 'u6', lesson: 'u6l1', gen: genOrderOpsG5 },
    { unit: 'u9', lesson: 'u9l1', gen: genVolumeG5 },
    { unit: 'u10', lesson: 'u10l1', gen: genCustomaryG5 },
    { unit: 'u10', lesson: 'u10l2', gen: genMetricG5 }
  ]
};

// ---------- Sanity checker ----------
// Quick verification on each generated question to catch typos in formulas.
// For numeric questions whose prompt is a pure arithmetic expression we can
// evaluate it and confirm it matches the stored answer.
function sanityCheck(q) {
  if (q.type !== 'numeric') return true;
  const m = q.prompt.match(/^([\d., ]+)\s*([+\-×*\/÷])\s*([\d., ]+)\s*=\s*\?$/);
  if (!m) return true;
  const a = parseFloat(m[1].replace(/[, ]/g, ''));
  const b = parseFloat(m[3].replace(/[, ]/g, ''));
  let v;
  switch (m[2]) {
    case '+': v = a + b; break;
    case '-': case '−': v = a - b; break;
    case '×': case '*': v = a * b; break;
    case '÷': case '/': v = a / b; break;
    default: return true;
  }
  const stored = parseFloat(String(q.answer).replace(/[, ]/g, ''));
  return Math.abs(v - stored) < 1e-6;
}

// ---------- Writer ----------
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
  let totalFailed = 0;

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
    const maxAttempts = TARGET * 25;
    while (generated.length < TARGET && guard < maxAttempts) {
      const q = spec.gen(rng);
      if (q && sanityCheck(q)) {
        generated.push(q);
      } else if (q) {
        totalFailed++;
      }
      guard++;
    }
    const unique = uniqByPrompt(generated).slice(0, TARGET);
    unique.forEach((q, idx) => {
      q.id = `gen-${spec.lesson}-${String(idx + 1).padStart(4, '0')}`;
    });
    lesson.questions = (lesson.questions || []).concat(unique);
    totalAdded += unique.length;
    if (unique.length < TARGET) {
      console.log(`  note: ${spec.lesson} produced ${unique.length}/${TARGET} unique (parameter space limit).`);
    }
  }

  fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n');
  console.log(`${file}: +${totalAdded} questions  (sanity-failed dropped: ${totalFailed})`);
}

for (const [file, specs] of Object.entries(SPECS)) {
  buildBank(file, specs);
}
console.log('Done.');
