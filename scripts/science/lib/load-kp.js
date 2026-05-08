/**
 * Texas Science Knowledge Pack loader.
 *
 * Reads docs/knowledge-packs/texas-science.md, splits by ## headers, and
 * exposes section-by-section text for assembly into generator/judge prompts.
 *
 * Differs from scripts/reading/lib/load-kp.js in two ways (per Phase D1
 * locked decisions):
 *   1. Version is the first 12 chars of sha256(content), NOT a git short
 *      SHA. Stable across unrelated repo commits — the version only
 *      changes when the KP file itself changes. Re-judging on KP edits
 *      becomes a meaningful query.
 *   2. Section keys are bare strings ('0', '1', ..., '9') rather than
 *      a section-name → key map. Callers reference numbered sections
 *      directly (sections['3'] for the SE catalog, etc.).
 *
 * Caches the parsed result in module scope.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KP_PATH = path.resolve(__dirname, '..', '..', '..', 'docs', 'knowledge-packs', 'texas-science.md');

let _cache = null;

function parseSections(raw) {
  // Sections are headed by `^## N. Title` where N is a digit. Everything
  // before the first such header is treated as the document preamble and
  // discarded. We capture the section number, then collect every line up
  // to (but not including) the next `## N.` header.
  const lines = raw.split('\n');
  const sections = {};
  let currentKey = null;
  let buf = [];

  function flush() {
    if (currentKey !== null) sections[currentKey] = buf.join('\n').trim();
    buf = [];
  }

  for (const line of lines) {
    const m = line.match(/^## (\d+)\.\s+/);
    if (m) {
      flush();
      currentKey = m[1];
      continue;
    }
    if (currentKey !== null) buf.push(line);
  }
  flush();

  return sections;
}

function loadKP() {
  if (_cache) return _cache;
  const content = fs.readFileSync(KP_PATH, 'utf8');
  const version = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  const sections = parseSections(content);
  _cache = { content, version, sections, path: KP_PATH };
  return _cache;
}

// For tests / hot-reload during development.
function _clearCache() { _cache = null; }

module.exports = { loadKP, _clearCache };
