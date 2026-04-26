/* StarTest Scratchpad — a draggable sticky-note canvas so kids can sketch
   their work with a pencil/finger/stylus instead of grabbing paper.
   Loaded on practice.html. Toggleable via floating button.
*/
(function () {
  if (window.STAARScratchpad) return;

  const STORE_POS = 'staar.scratchpad.pos';
  const STORE_OPEN = 'staar.scratchpad.open';
  const STORE_TOOL = 'staar.scratchpad.tool';

  let pad, canvas, ctx, toggleBtn;
  let tool = localStorage.getItem(STORE_TOOL) || 'pencil';
  let drawing = false;
  let lastX = 0, lastY = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildToggle() {
    if (document.getElementById('scratchpad-toggle')) return;
    toggleBtn = el('button', 'scratchpad-launcher');
    toggleBtn.id = 'scratchpad-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', 'Open scratch paper');
    toggleBtn.title = 'Scratch paper (press S)';
    toggleBtn.innerHTML = `
      <span class="scratchpad-launcher-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
          <line x1="9" y1="17" x2="13" y2="17"/>
        </svg>
      </span>
      <span class="scratchpad-launcher-content">
        <span class="scratchpad-launcher-title">Scratch paper</span>
        <span class="scratchpad-launcher-hint">Press <kbd>S</kbd></span>
      </span>`;
    toggleBtn.addEventListener('click', toggle);
    document.body.appendChild(toggleBtn);
  }

  function buildPad() {
    if (document.getElementById('scratchpad')) return;
    pad = el('div', 'scratchpad-panel');
    pad.id = 'scratchpad';
    pad.setAttribute('role', 'dialog');
    pad.setAttribute('aria-label', 'Scratch paper');
    pad.innerHTML = `
      <div class="scratchpad-panel-header" data-drag-handle>
        <div class="scratchpad-panel-title">
          <span class="scratchpad-panel-title-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </span>
          Scratch paper
        </div>
        <div class="scratchpad-panel-actions">
          <button type="button" class="scratchpad-action-btn scratch-clear" title="Clear" aria-label="Clear">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
          <button type="button" class="scratchpad-action-btn scratch-close" title="Close (S)" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="scratchpad-canvas-area">
        <canvas class="scratchpad-canvas"></canvas>
      </div>
      <div class="scratchpad-toolbar">
        <button type="button" class="scratchpad-tool scratch-tool" data-tool="pencil" title="Pencil" aria-label="Pencil">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
        </button>
        <button type="button" class="scratchpad-tool scratch-tool" data-tool="eraser" title="Eraser" aria-label="Eraser">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a2 2 0 010-2.8L13.2 3a2 2 0 012.8 0l5 5a2 2 0 010 2.8L11 20"/></svg>
        </button>
        <span class="scratchpad-toolbar-hint">Sketch your work — won't be graded</span>
      </div>`;
    document.body.appendChild(pad);

    canvas = pad.querySelector('.scratchpad-canvas');
    ctx = canvas.getContext('2d');

    wireTools();
    wireDrag();
    wireDraw();

    setTool(tool, true);
    sizeCanvas();
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function setTool(name, silent) {
    tool = (name === 'eraser') ? 'eraser' : 'pencil';
    if (!silent) localStorage.setItem(STORE_TOOL, tool);
    pad.querySelectorAll('.scratch-tool').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tool === tool);
    });
    canvas.style.cursor = tool === 'eraser'
      ? "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2'><circle cx='12' cy='12' r='6'/></svg>\") 11 11, auto"
      : "crosshair";
  }

  function wireTools() {
    pad.querySelectorAll('.scratch-tool').forEach(b => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });
    pad.querySelector('.scratch-clear').addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    pad.querySelector('.scratch-close').addEventListener('click', close);
  }

  function wireDrag() { /* panel is fixed bottom-left; no drag */ }

  function wireDraw() {
    canvas.addEventListener('pointerdown', e => {
      drawing = true;
      const p = pos(e);
      lastX = p.x; lastY = p.y;
      // Dot for taps
      ctx.beginPath();
      ctx.arc(lastX, lastY, strokeWidth() / 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor();
      if (tool === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.arc(lastX, lastY, strokeWidth(), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fill();
      }
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = pos(e);
      ctx.save();
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = strokeWidth() * 2.2;
      } else {
        ctx.strokeStyle = strokeColor();
        ctx.lineWidth = strokeWidth();
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
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);

    // Block touch scroll while drawing
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }

  function strokeColor() {
    return 'rgba(255, 255, 255, 0.9)';
  }
  function strokeWidth() {
    return 2.2;
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left), y: (e.clientY - r.top) };
  }

  function sizeCanvas(preserve) {
    const surface = canvas.parentElement;
    const rect = surface.getBoundingClientRect();
    let prev = null;
    if (preserve) {
      try { prev = canvas.toDataURL(); } catch (_) {}
    }
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (prev) {
      const img = new Image();
      img.onload = () => { try { ctx.drawImage(img, 0, 0, rect.width, rect.height); } catch (_) {} };
      img.src = prev;
    }
  }

  function savePos() { /* no-op: panel is fixed */ }

  function open() {
    if (!pad) buildPad();
    pad.classList.add('is-open');
    if (toggleBtn) toggleBtn.classList.add('is-active');
    localStorage.setItem(STORE_OPEN, '1');
    sizeCanvas(true);
  }
  function close() {
    if (!pad) return;
    pad.classList.remove('is-open');
    if (toggleBtn) toggleBtn.classList.remove('is-active');
    localStorage.setItem(STORE_OPEN, '0');
  }
  function toggle() {
    if (!pad || !pad.classList.contains('is-open')) open();
    else close();
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
    buildToggle();
    buildPad();
    bindShortcut();
    if (localStorage.getItem(STORE_OPEN) === '1') open();
    window.addEventListener('resize', () => { if (pad) sizeCanvas(true); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.STAARScratchpad = { open, close, toggle };
})();
