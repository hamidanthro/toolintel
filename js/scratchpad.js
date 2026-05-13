/* GradeEarn Scratchpad — inline expandable canvas mounted directly below the
   question card on the practice page. Default collapsed; pressing S or
   clicking the toggle expands it. Auto-clears + collapses between questions.
   Mounts only when #scratchpad-mount is present in the DOM. */
(function () {
  if (window.STAARScratchpad) return;

  const STORE_TOOL = 'staar.scratchpad.tool';

  let root, toggleBtn, body, canvas, ctx, collapseBtn, clearBtn, closeBtn, questionClone;
  let tool = localStorage.getItem(STORE_TOOL) || 'pen';
  let drawing = false;
  let lastX = 0, lastY = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  // Stroke history for undo
  let strokes = [];   // [{tool, points:[{x,y}], width}]
  let active = null;  // current stroke being drawn

  // Mobile fullscreen mode threshold. Matches the practice-surface
  // mobile rules in css/styles.css (§18 / §31 / §38).
  function isMobile() { return window.matchMedia('(max-width: 767px)').matches; }

  function mountMarkup(host) {
    host.innerHTML = `
      <div class="scratchpad-inline" data-state="collapsed">
        <!-- §77 (May 13) — collapsed scratchpad is just a pencil icon
             now (was a labeled card with "Need scratch paper?" +
             keyboard hint + chevron taking up a full row inside the
             question card). User saw IXL's blue pencil and asked for
             the same affordance shape. SVG = tilted pencil glyph;
             aria-label still says "Open scratch paper" for SR users
             since the visible text is gone. -->
        <button class="scratchpad-toggle scratchpad-toggle--icon" type="button" aria-expanded="false" aria-label="Open scratch paper" title="Scratch paper (press S)">
          <span class="scratchpad-toggle-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
            </svg>
          </span>
        </button>
        <div class="scratchpad-body">
          <div class="scratchpad-body-header">
            <span class="scratchpad-body-title">
              <span class="scratchpad-body-title-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </span>
              Scratch paper
            </span>
            <span class="scratchpad-body-hint">Sketch your work — won't be graded</span>
            <div class="scratchpad-body-actions">
              <button type="button" class="scratchpad-action-btn scratchpad-clear-btn" aria-label="Clear scratch work">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/>
                </svg>
              </button>
              <button type="button" class="scratchpad-action-btn scratchpad-collapse-btn" aria-label="Minimize (keep work)" title="Minimize — keep your work">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3.5 9L7 5.5L10.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button type="button" class="scratchpad-action-btn scratchpad-close-btn" aria-label="Close (discard work)" title="Close — discard your work">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="scratchpad-question-clone" aria-hidden="true"></div>
          <div class="scratchpad-canvas-area">
            <canvas class="scratchpad-canvas"></canvas>
          </div>
          <div class="scratchpad-toolbar">
            <button type="button" class="scratchpad-tool" data-tool="pen" aria-label="Pen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
            </button>
            <button type="button" class="scratchpad-tool" data-tool="eraser" aria-label="Eraser">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a2 2 0 010-3l9-9a2 2 0 013 0l5 5a2 2 0 010 3l-7 7"/><path d="M9 9l6 6"/></svg>
            </button>
            <span class="scratchpad-tool-divider"></span>
            <button type="button" class="scratchpad-tool scratchpad-undo-btn" data-tool="undo" aria-label="Undo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/></svg>
            </button>
            <span class="scratchpad-tool-divider scratchpad-scroll-divider"></span>
            <button type="button" class="scratchpad-tool scratchpad-scroll-btn scratchpad-scroll-up-btn" aria-label="Scroll up">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button type="button" class="scratchpad-tool scratchpad-scroll-btn scratchpad-scroll-down-btn" aria-label="Scroll down">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  function setTool(name, silent) {
    tool = (name === 'eraser') ? 'eraser' : 'pen';
    if (!silent) localStorage.setItem(STORE_TOOL, tool);
    root.querySelectorAll('.scratchpad-tool[data-tool="pen"], .scratchpad-tool[data-tool="eraser"]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tool === tool);
    });
    if (canvas) {
      canvas.style.cursor = tool === 'eraser'
        ? "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2'><circle cx='12' cy='12' r='6'/></svg>\") 11 11, auto"
        : "crosshair";
    }
  }

  // Populate the in-overlay question clone from the live #qbox so the
  // kid can re-read the stem + choices while drawing in fullscreen mode.
  // Cleared on close; rebuilt every open() so the latest question is
  // always shown.
  function populateQuestionClone() {
    if (!questionClone) return;
    const qbox = document.getElementById('qbox');
    if (!qbox) { questionClone.innerHTML = ''; return; }
    // Clone the rendered question card. Strip handler-attached buttons
    // (the clone is read-only, kid still answers in the real qbox after
    // minimizing). Keeping the visual structure means the question stem,
    // choices, and any feedback panels render with familiar styling.
    const clone = qbox.cloneNode(true);
    // Disable any inputs in the clone so the kid can't accidentally
    // submit through it; they always answer through the real qbox.
    clone.querySelectorAll('button, input, label').forEach(el => {
      el.setAttribute('tabindex', '-1');
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') el.disabled = true;
    });
    questionClone.innerHTML = '';
    questionClone.appendChild(clone);
  }

  function open() {
    if (isMobile()) {
      root.setAttribute('data-state', 'fullscreen');
      populateQuestionClone();
      // Lock body scroll so the page underneath doesn't wander.
      document.body.classList.add('scratchpad-fullscreen-open');
    } else {
      root.setAttribute('data-state', 'expanded');
    }
    toggleBtn.setAttribute('aria-expanded', 'true');
    // Defer canvas sizing until layout has updated.
    requestAnimationFrame(() => sizeCanvas(true));
  }
  function close() {
    // Minimize: collapse but DO NOT clear strokes — kid can resume.
    root.setAttribute('data-state', 'collapsed');
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('scratchpad-fullscreen-open');
  }
  // §55 — Discard: wipe canvas + collapse. Used by the X button.
  // Previously prompted ("Discard your scratch work?") which adds
  // friction and surfaced the browser-native confirm dialog mid-app.
  // Kid uses minimize [⌄] to preserve work; close [✕] is the
  // explicit "I'm done with this scratch" action.
  function closeAndDiscard() {
    clearCanvas();
    close();
  }
  function toggle() {
    const s = root.getAttribute('data-state');
    if (s === 'expanded' || s === 'fullscreen') close();
    else open();
  }

  function clearCanvas() {
    if (!ctx) return;
    strokes = [];
    active = null;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
  }

  // External API: called by practice.js when the next question loads.
  function reset() {
    clearCanvas();
    close();
  }

  function undo() {
    if (!strokes.length) return;
    strokes.pop();
    redrawAll();
  }

  function redrawAll() {
    if (!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    for (const s of strokes) drawStroke(s);
  }

  function drawStroke(s) {
    if (!s.points.length) return;
    ctx.save();
    if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = s.width * 2.2;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = s.width;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const p0 = s.points[0];
    ctx.moveTo(p0.x, p0.y);
    if (s.points.length === 1) {
      ctx.arc(p0.x, p0.y, s.width / 2, 0, Math.PI * 2);
      if (s.tool === 'eraser') ctx.fill(); else { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); }
    } else {
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left), y: (e.clientY - r.top) };
  }

  function wireDraw() {
    canvas.addEventListener('pointerdown', e => {
      drawing = true;
      const p = pos(e);
      lastX = p.x; lastY = p.y;
      active = { tool, width: 2.4, points: [{ x: p.x, y: p.y }] };
      strokes.push(active);
      drawStroke(active);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing || !active) return;
      const p = pos(e);
      active.points.push({ x: p.x, y: p.y });
      // Incremental segment for performance.
      ctx.save();
      if (active.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = active.width * 2.2;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = active.width;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
      lastX = p.x; lastY = p.y;
    });
    const stop = e => {
      if (!drawing) return;
      drawing = false;
      active = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }

  function sizeCanvas(preserve) {
    if (!canvas) return;
    const surface = canvas.parentElement;
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    // In fullscreen mode the canvas is "Word-document tall" — multi-page
    // vertical drawing space the kid scrolls through. The parent
    // .scratchpad-canvas-area handles overflow:auto. In normal expanded
    // mode the canvas matches its parent height (single visible page).
    const fullscreen = root && root.getAttribute('data-state') === 'fullscreen';
    const cssWidth = rect.width;
    const cssHeight = fullscreen ? Math.max(1800, Math.round(rect.height * 4)) : rect.height;
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (preserve) redrawAll();
    else { strokes = []; active = null; ctx.clearRect(0, 0, cssWidth, cssHeight); }
  }

  // Page-up / page-down scroll the .scratchpad-canvas-area (the parent
  // of the canvas) by ~80% of its visible height, smooth-scrolled. Used
  // in fullscreen mode where the canvas is much taller than the
  // viewport and touch-action: none on the canvas blocks swipe-scroll.
  function scrollPage(direction) {
    if (!canvas) return;
    const surface = canvas.parentElement;
    if (!surface) return;
    const delta = surface.clientHeight * 0.8 * (direction || 1);
    surface.scrollBy({ top: delta, left: 0, behavior: 'smooth' });
  }

  function bindShortcut() {
    document.addEventListener('keydown', e => {
      if (e.key !== 's' && e.key !== 'S') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = document.activeElement;
      if (a && a.matches && a.matches('input, textarea, [contenteditable], [contenteditable="true"]')) return;
      e.preventDefault();
      toggle();
    });
  }

  function init() {
    const host = document.getElementById('scratchpad-mount');
    if (!host) return; // not on a practice page
    mountMarkup(host);
    root = host.querySelector('.scratchpad-inline');
    toggleBtn = root.querySelector('.scratchpad-toggle');
    body = root.querySelector('.scratchpad-body');
    canvas = root.querySelector('.scratchpad-canvas');
    ctx = canvas.getContext('2d');
    collapseBtn = root.querySelector('.scratchpad-collapse-btn');
    clearBtn = root.querySelector('.scratchpad-clear-btn');
    closeBtn = root.querySelector('.scratchpad-close-btn');
    questionClone = root.querySelector('.scratchpad-question-clone');

    toggleBtn.addEventListener('click', open);
    collapseBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', closeAndDiscard);
    clearBtn.addEventListener('click', clearCanvas);
    root.querySelectorAll('.scratchpad-tool[data-tool="pen"], .scratchpad-tool[data-tool="eraser"]').forEach(b => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });
    root.querySelector('.scratchpad-undo-btn').addEventListener('click', undo);
    root.querySelector('.scratchpad-scroll-up-btn').addEventListener('click', () => scrollPage(-1));
    root.querySelector('.scratchpad-scroll-down-btn').addEventListener('click', () => scrollPage(1));

    setTool(tool, true);
    wireDraw();
    bindShortcut();
    window.addEventListener('resize', () => {
      const s = root.getAttribute('data-state');
      if (s === 'expanded' || s === 'fullscreen') sizeCanvas(true);
    });
    // If the viewport crosses the mobile/desktop boundary while open,
    // re-key the state so the right CSS branch applies.
    window.addEventListener('resize', () => {
      const s = root.getAttribute('data-state');
      if (s === 'expanded' && isMobile()) {
        root.setAttribute('data-state', 'fullscreen');
        populateQuestionClone();
        document.body.classList.add('scratchpad-fullscreen-open');
        requestAnimationFrame(() => sizeCanvas(true));
      } else if (s === 'fullscreen' && !isMobile()) {
        root.setAttribute('data-state', 'expanded');
        document.body.classList.remove('scratchpad-fullscreen-open');
        requestAnimationFrame(() => sizeCanvas(true));
      }
    });
  }

  function tryInit() {
    if (document.getElementById('scratchpad-mount')) {
      init();
      return true;
    }
    return false;
  }

  function watchForMount() {
    if (tryInit()) return;
    const obs = new MutationObserver(() => {
      if (tryInit()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Safety timeout: stop watching after 30s.
    setTimeout(() => obs.disconnect(), 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForMount);
  } else {
    watchForMount();
  }

  window.STAARScratchpad = { open, close, toggle, reset, clear: clearCanvas };
})();
