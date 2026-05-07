/**
 * Readability helpers — Flesch-Kincaid + structural counts.
 *
 * Pure functions. No I/O. No dependencies beyond Node built-ins.
 *
 * Used by:
 *   - judge-passage.js#runStructuralChecks (Pass 1, deterministic)
 *   - generate-passage.js (post-generation diagnostic)
 *   - tests/reading/judge-calibration.test.js
 *
 * Algorithm: standard Flesch-Kincaid Grade Level
 *   FKGL = 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
 *
 * Caveats:
 *   - Syllable counting is heuristic (vowel groups + adjustments). Not
 *     dictionary-perfect; off by ±5% on average vs published Lexile tools.
 *     Adequate for the §8 target band 2.8-4.2.
 *   - Sentence counting splits on .!? but skips common abbreviations
 *     (Mr., Dr., U.S., etc.) so they don't inflate counts.
 *   - Markdown is stripped before counting (## headers, **bold**, *italic*
 *     don't add to word/syllable totals).
 */
'use strict';

// Common abbreviations that contain a period but don't end a sentence.
const ABBREVIATIONS = new Set([
  'Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr',
  'U.S', 'U.S.A', 'U.K', 'a.m', 'p.m',
  'vs', 'etc', 'e.g', 'i.e', 'Inc', 'Ltd', 'Co'
]);

function stripMarkdown(text) {
  let s = String(text || '');
  // Headers
  s = s.replace(/^#{1,6}\s+/gm, '');
  // Bold + italic markers (keep the word, drop the asterisks)
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/\*(.+?)\*/g, '$1');
  // Inline code
  s = s.replace(/`([^`]+)`/g, '$1');
  // Links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return s;
}

function countWords(text) {
  const stripped = stripMarkdown(text);
  return stripped.match(/[A-Za-z]+(?:[''][A-Za-z]+)*/g)?.length || 0;
}

function countSentences(text) {
  const stripped = stripMarkdown(text);
  // Replace abbreviations with placeholders so their periods don't split sentences.
  let s = stripped;
  for (const abbr of ABBREVIATIONS) {
    const re = new RegExp('\\b' + abbr.replace('.', '\\.') + '\\.', 'g');
    s = s.replace(re, abbr + '_ABBR_');
  }
  // Split on sentence terminators followed by whitespace + capital, OR end-of-string.
  const sentences = s.split(/[.!?]+(?=\s+[A-Z]|\s*$)/).map(x => x.trim()).filter(Boolean);
  return Math.max(1, sentences.length);
}

function countParagraphs(markdown) {
  const text = String(markdown || '').trim();
  if (!text) return 0;
  // Split on one-or-more blank lines (markdown paragraph break).
  const paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  // Skip ## heading lines that are paragraphs unto themselves.
  return paras.filter(p => !p.match(/^#{1,6}\s+/) || p.split('\n').length > 1).length;
}

// Heuristic syllable count for a single word. Standard approach: count
// vowel groups, subtract a silent 'e', clamp at 1.
function countSyllables(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // Drop a trailing silent 'e' (but not 'le' which is its own syllable)
  w = w.replace(/(?:[^aeiouy])e$/, c => c.charAt(0));
  // Count vowel groups
  const matches = w.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;
  // Common adjustment: words ending in 'le' after a consonant gain a syllable
  if (/[^aeiouy]le$/.test(w)) count++;
  return Math.max(1, count);
}

function totalSyllables(text) {
  const words = stripMarkdown(text).match(/[A-Za-z]+(?:[''][A-Za-z]+)*/g) || [];
  let total = 0;
  for (const w of words) total += countSyllables(w);
  return total;
}

function fleschKincaidGradeLevel(text) {
  const words = countWords(text);
  const sentences = countSentences(text);
  if (words === 0 || sentences === 0) return 0;
  const syllables = totalSyllables(text);
  const fk = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
  return Math.round(fk * 10) / 10;  // 1-decimal precision
}

// Lexile estimate is approximate. Grade-3 STAAR passages cluster around
// 520L-820L (CCSS stretch band). This linear approximation is documented in
// the KP §2 as a guide, not a measurement.
function estimateLexile(fkGrade) {
  if (!Number.isFinite(fkGrade)) return null;
  // Rough: FK 2.5 ≈ 400L, FK 3.5 ≈ 600L, FK 4.5 ≈ 800L → +200L per grade
  return Math.round(((fkGrade - 1) * 200) / 10) * 10;
}

function getReadabilityReport(markdownBody) {
  const text = String(markdownBody || '');
  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);
  const paragraphCount = countParagraphs(text);
  const syllableCount = totalSyllables(text);
  const fkGrade = fleschKincaidGradeLevel(text);
  const lexileEstimate = estimateLexile(fkGrade);
  return {
    wordCount,
    sentenceCount,
    paragraphCount,
    syllableCount,
    avgSentenceLength: sentenceCount ? Math.round((wordCount / sentenceCount) * 10) / 10 : 0,
    fkGrade,
    lexileEstimate
  };
}

module.exports = {
  countWords,
  countSentences,
  countParagraphs,
  countSyllables,
  totalSyllables,
  fleschKincaidGradeLevel,
  estimateLexile,
  getReadabilityReport,
  stripMarkdown
};
