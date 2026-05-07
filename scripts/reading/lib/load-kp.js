/**
 * Knowledge Pack loader.
 *
 * Reads docs/knowledge-packs/texas-reading-grade3.md, splits by ## headers,
 * exposes section-by-section text for assembly into generator/judge prompts.
 *
 * Caches the parsed result in module scope — KP rarely changes within a
 * single process; restart picks up edits.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const KP_PATH = path.resolve(__dirname, '..', '..', '..', 'docs', 'knowledge-packs', 'texas-reading-grade3.md');

let _cache = null;

// Section-name → section-key map. Section names are matched by the ## header
// text after the leading number. e.g. "## 6. Texas cultural priorities" → 'culturalPriorities'.
const SECTION_KEYS = {
  '1.': 'testFormat',
  '2.': 'passageCharacteristics',
  '3.': 'teksStrands',
  '4.': 'questionTypes',
  '5.': 'exemplars',
  '6.': 'culturalPriorities',
  '7.': 'landmines',
  '8.': 'readingLevels',
  '9.': 'noNoList',
  '10.': 'pipelineNotes'
};

function getKpVersion() {
  try {
    return 'commit:' + execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (_) { return 'commit:unknown'; }
}

function parseSections(raw) {
  // Split on lines that begin with "## " (top-level subsections).
  // Skip the YAML-ish frontmatter at the top (everything before the first ## ).
  const lines = raw.split('\n');
  const sections = {};
  let currentKey = null;
  let buf = [];

  function flush() {
    if (currentKey) sections[currentKey] = buf.join('\n').trim();
    buf = [];
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      // After "## " grab the leading digit-token
      const m = line.match(/^## (\d+\.)\s*/);
      currentKey = m ? SECTION_KEYS[m[1]] || null : null;
      continue;
    }
    if (currentKey) buf.push(line);
  }
  flush();

  return sections;
}

function loadKP() {
  if (_cache) return _cache;
  const raw = fs.readFileSync(KP_PATH, 'utf8');
  const sections = parseSections(raw);
  _cache = {
    raw,
    sections,
    kpVersion: getKpVersion(),
    path: KP_PATH
  };
  return _cache;
}

// For tests / hot-reload during development.
function _clearCache() { _cache = null; }

module.exports = { loadKP, _clearCache };
