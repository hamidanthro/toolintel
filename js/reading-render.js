// GradeEarn — Reading passage renderer (Phase 3)
//
// Two pure-fn surfaces:
//   ReadingRender.renderPassage(markdown)  → safe HTML innerHTML string
//   ReadingRender.toPlainText(markdown)    → speakable text (no markdown chars,
//                                            no inline numbers — paragraph
//                                            numbers are CSS counter() at
//                                            render time, not in the data).
//
// Trust model: passage bodies come from staar-passages (DDB) and ultimately
// from the Phase 1 generator → judge pipeline. We still treat them as
// untrusted at render time. marked.js parses the markdown to HTML;
// DOMPurify enforces a strict whitelist before insertion.
//
// Allowed tags after sanitization: p, em, strong, h2, h3, br, ul, ol, li
// Allowed attributes: (none) — paragraph numbers come from CSS counter(),
// NOT from data-num attributes.
//
// Both libraries are loaded via <script> in practice.html (CDN). If either
// failed to load (offline / CSP), we fall back to a minimal escape-and-
// paragraph-split renderer so practice doesn't break entirely.

(function () {
  'use strict';

  const ALLOWED_TAGS = ['p', 'em', 'strong', 'h2', 'h3', 'br', 'ul', 'ol', 'li'];
  const ALLOWED_ATTR = []; // no attrs survive

  function _escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // Ultra-fallback: if marked or DOMPurify is missing (CDN failure), just
  // escape the markdown source and split by blank lines into <p>. Works
  // offline; loses markdown semantics but is safe.
  function _fallbackRender(markdown) {
    const text = String(markdown || '').trim();
    if (!text) return '';
    // Strip the leading "## Title" so it doesn't render twice (the kid UI
    // renders the title in its own header element).
    const stripped = text.replace(/^#{1,6}\s+.*\n+/, '');
    const paras = stripped.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
    return paras.map(p => `<p>${_escapeHtml(p)}</p>`).join('');
  }

  function _sanitize(html) {
    // DOMPurify is the runtime guard. Strict whitelist. If DOMPurify is
    // missing for any reason, return the fallback (escape) — never raw HTML.
    if (typeof window.DOMPurify === 'undefined' || !window.DOMPurify.sanitize) {
      console.warn('[reading-render] DOMPurify missing — falling back to escape-only');
      return _escapeHtml(html);
    }
    return window.DOMPurify.sanitize(String(html || ''), {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      KEEP_CONTENT: true
    });
  }

  function renderPassage(markdownBody) {
    const text = String(markdownBody || '').trim();
    if (!text) return '';

    // Strip the leading "## Title" header — the kid UI renders the title
    // separately. The body's H2 would create a duplicate heading.
    const stripped = text.replace(/^#{1,6}\s+[^\n]*\n+/, '');

    if (typeof window.marked === 'undefined') {
      console.warn('[reading-render] marked missing — using fallback renderer');
      return _fallbackRender(text);
    }

    let html;
    try {
      // marked v15+ uses marked.parse(); older uses marked(). Support both.
      const parser = (typeof window.marked.parse === 'function')
        ? window.marked.parse
        : window.marked;
      html = parser(stripped, {
        gfm: true,
        breaks: false,
        headerIds: false,
        mangle: false
      });
    } catch (err) {
      console.warn('[reading-render] marked threw:', err && err.message);
      return _fallbackRender(text);
    }

    return _sanitize(html);
  }

  // toPlainText — speakable version of the passage. Strips markdown markers
  // and joins paragraphs with periods + spaces so a single TTS pass reads
  // the whole thing naturally. Does NOT include paragraph numbers (those
  // are CSS-only — kid sees them visually, doesn't hear them).
  function toPlainText(markdownBody) {
    let s = String(markdownBody || '').trim();
    // Drop heading markers (## Title → Title)
    s = s.replace(/^#{1,6}\s+/gm, '');
    // Bold/italic markers
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/\*([^*]+)\*/g, '$1');
    // Inline code
    s = s.replace(/`([^`]+)`/g, '$1');
    // Markdown links [text](url) → text
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // List bullets
    s = s.replace(/^\s*[-*+]\s+/gm, '');
    s = s.replace(/^\s*\d+\.\s+/gm, '');
    // Collapse multiple newlines into single space — TTS reads continuously
    s = s.replace(/\n{2,}/g, '. ');
    s = s.replace(/\n/g, ' ');
    // Avoid double-period if a paragraph already ended with one
    s = s.replace(/\.\s*\.\s/g, '. ');
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  window.ReadingRender = {
    renderPassage,
    toPlainText,
    _sanitize,
    _fallbackRender
  };
})();
