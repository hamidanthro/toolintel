/**
 * State-pack loader (CLAUDE.md §35).
 *
 * Loads + caches the per-state knowledge pack from state-packs/<state>/
 * and exposes sampling helpers for the cold-start generator.
 *
 * Cached on first read per state; subsequent calls in the same process
 * are O(1). Read-only — never writes back.
 *
 * Graceful fallback: if a state has no pack directory, every helper
 * returns null. Callers should treat null as "use the §30/§32 fallback
 * pipeline" (hardcoded name pool + cognitive-demand spec only — no
 * pack-grade cultural / TEKS / STAAR-phrasing injection). This keeps
 * non-Texas state generation working unchanged until those states get
 * their own packs.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const PACK_ROOT = path.resolve(__dirname, '..', '..', 'state-packs');
const _cache = new Map();

// ---- pack loading ----

function loadPack(stateSlug) {
  if (!stateSlug) return null;
  const cached = _cache.get(stateSlug);
  if (cached !== undefined) return cached;
  const dir = path.join(PACK_ROOT, stateSlug);
  if (!fs.existsSync(dir)) {
    _cache.set(stateSlug, null);
    return null;
  }
  const teks = {};
  for (const subj of ['math', 'rla', 'science', 'social-studies']) {
    const f = path.join(dir, 'standards', `teks-${subj}.json`);
    if (fs.existsSync(f)) teks[subj] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  const namesPath = path.join(dir, 'cultural', 'authentic-names.json');
  const names = fs.existsSync(namesPath) ? JSON.parse(fs.readFileSync(namesPath, 'utf8')) : null;
  const allowedPath = path.join(dir, 'cultural', 'contexts-allowed.md');
  const allowedText = fs.existsSync(allowedPath) ? fs.readFileSync(allowedPath, 'utf8') : '';
  const lingoPath = path.join(dir, 'lingo', 'staar-vocabulary.md');
  const lingoText = fs.existsSync(lingoPath) ? fs.readFileSync(lingoPath, 'utf8') : '';

  const pack = {
    stateSlug,
    teks,
    names,
    contexts: parseContexts(allowedText),
    stems: { math: parseStemsForSubject(lingoText, 'Math') }
  };
  _cache.set(stateSlug, pack);
  return pack;
}

// ---- markdown parsers (best-effort; the pack files have a stable structure) ----

// Pull bullet items out of selected sections of contexts-allowed.md.
// Heuristic: capture all `- Foo` lines under sections likely to contain
// concrete usable contexts. Filter out any bullet that looks like
// meta-commentary (too long, contains "Generation", contains "Test:",
// contains markdown links or formatting markers).
function parseContexts(md) {
  if (!md) return [];
  const wanted = new Set([
    'Major regions', 'Major rivers', 'Major cities (population order, broad familiarity)',
    'Geographic features (STAAR-appropriate references)',
    'Authentic Texas place names',
    'Wildlife (STAAR-friendly nature contexts)',
    'Daily life and culture (STAAR-allowed contexts)',
    'STAAR-allowed scenario types',
    'Industries (real-world contexts STAAR uses)'
  ]);
  const sections = [];
  let cur = null;
  const lines = md.split('\n');
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      if (cur) sections.push(cur);
      // Strip leading "N. " section-number prefix so the title matches the wanted set
      const cleaned = heading[1].trim().replace(/^\d+\.\s+/, '');
      cur = { title: cleaned, bullets: [] };
      continue;
    }
    if (cur && /^\s*-\s+/.test(line)) {
      cur.bullets.push(line.replace(/^\s*-\s+/, '').trim());
    }
  }
  if (cur) sections.push(cur);

  const out = [];
  for (const sec of sections) {
    if (!wanted.has(sec.title)) continue;
    for (const raw of sec.bullets) {
      // Strip markdown bold and italics
      let item = raw.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
      // Skip overly-long bullets — those are usually paragraphs of guidance, not contexts
      if (item.length > 220) continue;
      // Skip bullets that look like meta-commentary
      if (/Generation guidance|Test:|See `|Note:|CAUTION:|Inspired by/.test(item)) continue;
      out.push(item);
    }
  }
  return out;
}

// Extract stem phrasing bullets from lingo/staar-vocabulary.md under
// section 4 ("Standard-language stem phrasings") for the named subject.
function parseStemsForSubject(md, subjectHeader) {
  if (!md) return [];
  const lines = md.split('\n');
  const out = [];
  let inSubject = false;
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      inSubject = h3[1].trim().toLowerCase().startsWith(subjectHeader.toLowerCase());
      continue;
    }
    // Stop if we hit a higher-level heading
    if (/^##\s+/.test(line) && inSubject) break;
    if (inSubject && /^\s*-\s+"/.test(line)) {
      // Bullet of form: - "Which expression best represents …"
      const m = line.match(/^\s*-\s+"(.+?)"/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

// ---- TEKS lookup ----

function _gradeKey(grade) {
  if (grade === 'algebra-1') return 'algebra_1';
  if (grade === 'algebra_1') return 'algebra_1';
  // grade-3 → grade_3
  return grade.replace(/^grade-/, 'grade_');
}

function getTeksFor(stateSlug, subject, grade, standardId) {
  const pack = loadPack(stateSlug);
  if (!pack || !pack.teks[subject]) return null;
  const subj = pack.teks[subject];
  const key = _gradeKey(grade);
  const gradeData = subj[key];
  if (!gradeData || !Array.isArray(gradeData.standards)) return null;
  if (!standardId || standardId === 'random') {
    const list = gradeData.standards;
    return list[Math.floor(Math.random() * list.length)];
  }
  return gradeData.standards.find(s => s.id === standardId) || null;
}

// ---- name sampling (demographic-weighted, anti-duplicate within batch) ----

function sampleAuthenticNames(stateSlug, count = 5) {
  const pack = loadPack(stateSlug);
  if (!pack || !pack.names || !pack.names.first_names) return null;
  const dist = pack.names._meta && pack.names._meta.demographic_target_for_question_pool;
  if (!dist) return null;
  const pool = pack.names.first_names;
  const buckets = Object.keys(dist);
  const out = [];
  let safety = count * 10;
  while (out.length < count && safety-- > 0) {
    // Weighted bucket pick
    const r = Math.random();
    let acc = 0, chosen = buckets[0];
    for (const b of buckets) {
      acc += dist[b];
      if (r < acc) { chosen = b; break; }
    }
    const names = pool[chosen];
    if (!names || !names.length) continue;
    const name = names[Math.floor(Math.random() * names.length)];
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// ---- cultural context sampling ----

function sampleCulturalContexts(stateSlug, count = 4) {
  const pack = loadPack(stateSlug);
  if (!pack || !pack.contexts || !pack.contexts.length) return null;
  const copy = pack.contexts.slice();
  const out = [];
  while (out.length < count && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// ---- STAAR stem phrasing sampling ----

function sampleStaarPhrasings(stateSlug, subject, count = 2) {
  const pack = loadPack(stateSlug);
  if (!pack || !pack.stems[subject] || !pack.stems[subject].length) return null;
  const copy = pack.stems[subject].slice();
  const out = [];
  while (out.length < count && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// Internal helpers exported for tests / debugging
function _clearCache() { _cache.clear(); }

module.exports = {
  loadPack,
  getTeksFor,
  sampleCulturalContexts,
  sampleAuthenticNames,
  sampleStaarPhrasings,
  _clearCache,
  // exported for inspection
  _internal: { parseContexts, parseStemsForSubject }
};
