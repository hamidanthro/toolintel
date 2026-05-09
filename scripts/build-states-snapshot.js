#!/usr/bin/env node
/**
 * Build a JSON snapshot of js/states-data.js for the lambda runtime.
 *
 * Why: lambda code can't `require('../../js/states-data.js')` directly —
 * that file is browser-side (uses `window.STATES`) and needs a `window`
 * shim. Cold-start scripts handle this via a Node vm sandbox (see
 * scripts/cold-start/states-grades.js); the lambda doesn't have time at
 * cold start to re-evaluate a 1466-line script. So we generate a
 * data-only JSON snapshot at deploy time and the lambda just `require`s it.
 *
 * The snapshot includes a `_sourceHash` field so the lambda can detect
 * a stale snapshot at startup. CLAUDE.md §0 #2 mandates this for
 * Phase 2 of the cold-start refactor.
 *
 * Outputs:
 *   - lambda/pool-topup/states-snapshot.json
 *   - lambda/tutor-build/states-snapshot.json (for tutor.js use later)
 *
 * Run:
 *   node scripts/build-states-snapshot.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.resolve(__dirname, '..', 'js', 'states-data.js');
const code = fs.readFileSync(SRC, 'utf8');
const sourceHash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'states-data.js' });
const STATES = sandbox.window.STATES || [];
if (!STATES.length) {
  console.error('FATAL: failed to extract STATES from', SRC);
  process.exit(1);
}

// Trim to only the fields lambda code reads. Drops things like
// description / SEO blob / customNotes that bloat the zip.
const PROMPT_FIELDS = [
  'slug', 'name', 'nameAbbr',
  'testName', 'testFullName', 'testAuthority', 'testAuthorityShort',
  'standards', 'testWindow', 'testWindowMonth',
  'gradesTested', 'gradesTestedBySubject',
  'subjectsAvailable', 'subjectsComingSoon',
  'active'
];

const trimmed = STATES.map(s => {
  const out = {};
  for (const k of PROMPT_FIELDS) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  return out;
});

const snapshot = {
  _sourceHash: sourceHash,
  _builtAt: new Date().toISOString(),
  _sourceFile: 'js/states-data.js',
  _stateCount: trimmed.length,
  states: trimmed
};

const targets = [
  path.resolve(__dirname, '..', 'lambda', 'pool-topup', 'states-snapshot.json'),
  path.resolve(__dirname, '..', 'lambda', 'tutor-build', 'states-snapshot.json')
];

for (const target of targets) {
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2));
  console.log(`✓ wrote ${target} (${trimmed.length} states, sourceHash=${sourceHash})`);
}

// Sanity prints
const tx = trimmed.find(s => s.slug === 'texas');
if (tx) {
  console.log(`  texas: testName=${tx.testName}, scienceGrades=${(tx.gradesTestedBySubject?.science || []).join(',')}`);
}
const al = trimmed.find(s => s.slug === 'alabama');
if (al) {
  console.log(`  alabama: testName=${al.testName}, mathGrades=${(al.gradesTestedBySubject?.math || []).length} grades`);
}
