/* StarTest Scratchpad — inline expandable canvas mounted directly below the
   question card on the practice page. Default collapsed; pressing S or
   clicking the toggle expands it. Auto-clears + collapses between questions.
   Mounts only when #scratchpad-mount is present in the DOM. */
(function () {
  if (window.STAARScratchpad) return;

  const STORE_TOOL = 'staar.scratchpad.tool';

  let root, toggleBtn, body, canvas, ctx, collapseBtn, clearBtn;
  let tool = localStorage.getItem(STORE_TOOL) || 'pen';
  let drawing = false;
  let lastX = 0, lastY = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  // Stroke history for undo
  let strokes = [];   // [{tool, points:[{x,y}], width}]
  let active = null;  // current stroke being drawn

  function mountMarkup(host) {
    host.innerHTML = `
      <div class="scratchpad-inline" data-state="collapsed">
        <button class="scratchpad-toggle" type="button" aria-expanded="false">
          <span class="scratchpad-toggle-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="9" y1="13" x2="15" y2="13"/>
              <line x1="9" y1="17" x2="13" y2="17"/>
            </svg>
          </span>
          <span class="scratchpad-toggle-label">Need scratch paper?</span>
          <span class="scratchpad-toggle-hint">Press <kbd>S</kbd> or click to open</span>
          <span class="scratchpad-toggle-chevron" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 5L7 8.5L10.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
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
              <button type="button" class="scratchpad-action-btn scratchpad-clear-btn" aria-label="Clear">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/>
                </svg>
              </button>
              <button type="button" class="scratchpad-action-btn scratchpad-collapse-btn" aria-label="Collapse">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3.5 9L7 5.5L10.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
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

  function open() {
    root.setAttribute('data-state', 'expanded');
    toggleBtn.setAttribute('aria-expanded', 'true');
    // Defer canvas sizing until layout has updated.
    requestAnimationFrame(() => sizeCanvas(true));
  }
  function close() {
    root.setAttribute('data-state', 'collapsed');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }
  function toggle() {
    if (root.getAttribute('data-state') === 'expanded') close();
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
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (preserve) redrawAll();
    else { strokes = []; active = null; ctx.clearRect(0, 0, rect.width, rect.height); }
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

    toggleBtn.addEventListener('click', open);
    collapseBtn.addEventListener('click', close);
    clearBtn.addEventListener('click', clearCanvas);
    root.querySelectorAll('.scratchpad-tool[data-tool="pen"], .scratchpad-tool[data-tool="eraser"]').forEach(b => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });
    root.querySelector('.scratchpad-undo-btn').addEventListener('click', undo);

    setTool(tool, true);
    wireDraw();
    bindShortcut();
    window.addEventListener('resize', () => {
      if (root.getAttribute('data-state') === 'expanded') sizeCanvas(true);
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
