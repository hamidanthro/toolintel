/**
 * Science judge SYSTEM_PROMPT loader.
 *
 * Reads prompts/science-judge-v1.md and extracts the SYSTEM_PROMPT block
 * (everything between '## SYSTEM_PROMPT' and the next '## ' heading).
 * Returns { systemPrompt, version }.
 *
 * Version is hardcoded to 'science-judge-v1' (matches the filename suffix
 * and the locked decision in CLAUDE.md §38). When the prompt is bumped
 * to v2, write prompts/science-judge-v2.md and update this loader.
 *
 * Caches in module scope.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.resolve(__dirname, '..', '..', '..', 'prompts', 'science-judge-v1.md');

let _cache = null;

function extractSystemPrompt(raw) {
  // Find the line `## SYSTEM_PROMPT` (anchored). Capture every line after
  // it until the next top-level `## ` heading (which marks the start of
  // a sibling section, e.g. '## Implementation notes for Claude Code').
  const lines = raw.split('\n');
  const buf = [];
  let inBlock = false;

  for (const line of lines) {
    if (!inBlock) {
      if (/^##\s+SYSTEM_PROMPT\b/.test(line)) {
        inBlock = true;
        continue;
      }
    } else {
      // A new sibling `## ` heading ends the block. `### ` (subsections)
      // are kept inside the block.
      if (/^##\s+(?!#)/.test(line)) break;
      buf.push(line);
    }
  }
  return buf.join('\n').trim();
}

function loadJudgePrompt() {
  if (_cache) return _cache;
  const raw = fs.readFileSync(PROMPT_PATH, 'utf8');
  const systemPrompt = extractSystemPrompt(raw);
  if (!systemPrompt) {
    throw new Error(`SYSTEM_PROMPT block not found in ${PROMPT_PATH}`);
  }
  _cache = { systemPrompt, version: 'science-judge-v1', path: PROMPT_PATH };
  return _cache;
}

function _clearCache() { _cache = null; }

module.exports = { loadJudgePrompt, _clearCache };
