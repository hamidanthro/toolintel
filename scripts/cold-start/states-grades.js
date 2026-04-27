/**
 * Per-state metadata bridge for cold-start scripts.
 *
 * Auto-derived from js/states-data.js (single source of truth).
 * That file is browser-side (uses `window.STATES`), so we evaluate it in a
 * Node `vm` sandbox with a `window` shim, then read `gradesTestedBySubject`
 * (for grade lists) and the full state record (for testName / standards /
 * testAuthority and any other field the prompt builder needs).
 *
 * Usage:
 *   const { gradesForState, ALL_STATE_SLUGS, getStateRecord } = require('./states-grades');
 *   gradesForState('texas', 'reading')   // => ['grade-3', ..., 'grade-8']
 *   getStateRecord('alabama').testName   // => 'ACAP'
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', '..', 'js', 'states-data.js');
const code = fs.readFileSync(SRC, 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'states-data.js' });

const STATES = sandbox.window.STATES || [];
if (!STATES.length) {
  throw new Error('states-grades: failed to load STATES from ' + SRC);
}

const GRADES_BY_SUBJECT = {};
const RECORDS_BY_SLUG = {};
for (const s of STATES) {
  GRADES_BY_SUBJECT[s.slug] = s.gradesTestedBySubject || {};
  RECORDS_BY_SLUG[s.slug] = s;
}

const ALL_STATE_SLUGS = Object.keys(GRADES_BY_SUBJECT).sort();

function gradesForState(stateSlug, subject) {
  const map = GRADES_BY_SUBJECT[stateSlug];
  if (!map) return [];
  return Array.isArray(map[subject]) ? map[subject].slice() : [];
}

function getStateRecord(stateSlug) {
  return RECORDS_BY_SLUG[stateSlug] || null;
}

module.exports = { ALL_STATE_SLUGS, gradesForState, GRADES_BY_SUBJECT, getStateRecord };
