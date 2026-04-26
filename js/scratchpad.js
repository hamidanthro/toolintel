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
    toggleBtn = el('button', 'scratchpad-toggle');
    toggleBtn.id = 'scratchpad-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', 'Open scratchpad');
    toggleBtn.title = 'Scratchpad — sketch your work';
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 19l7-7 3 3-7 7-3-3z"/>
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
        <path d="M2 2l7.586 7.586"/>
        <circle cx="11" cy="11" r="2"/>
      </svg>
      <span>Scratchpad</span>`;
    toggleBtn.addEventListener('click', toggle);
    document.body.appendChild(toggleBtn);
  }

  function buildPad() {
    if (document.getElementById('scratchpad')) return;
    pad = el('div', 'scratchpad');
    pad.id = 'scratchpad';
    pad.setAttribute('role', 'dialog');
    pad.setAttribute('aria-label', 'Scratchpad');
    pad.innerHTML = `
      <div class="scratchpad-header" data-drag-handle>
        <div class="scratchpad-title">
          <span class="scratchpad-dot"></span>
          Scratchpad
        </div>
        <div class="scratchpad-tools">
          <button type="button" class="scratch-tool" data-tool="pencil" title="Pencil" aria-label="Pencil">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>
          </button>
          <button type="button" class="scratch-tool" data-tool="eraser" title="Eraser" aria-label="Eraser">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a2 2 0 010-2.8L13.2 3a2 2 0 012.8 0l5 5a2 2 0 010 2.8L11 20"/></svg>
          </button>
          <button type="button" class="scratch-clear" title="Clear all" aria-label="Clear">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
          <button type="button" class="scratch-close" title="Close" aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="scratchpad-surface">
        <canvas class="scratchpad-canvas"></canvas>
        <div class="scratchpad-hint">Sketch your work — pencil or finger. Won't be graded.</div>
      </div>
      <div class="scratchpad-resize" data-resize-handle aria-hidden="true"></div>`;
    document.body.appendChild(pad);

    canvas = pad.querySelector('.scratchpad-canvas');
    ctx = canvas.getContext('2d');

    // Restore position
    try {
      const pos = JSON.parse(localStorage.getItem(STORE_POS) || 'null');
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        pad.style.left = clamp(pos.left, 8, window.innerWidth - 200) + 'px';
        pad.style.top = clamp(pos.top, 8, window.innerHeight - 80) + 'px';
        pad.style.right = 'auto';
        pad.style.bottom = 'auto';
      }
      if (pos && pos.width && pos.height) {
        pad.style.width = pos.width + 'px';
        pad.style.height = pos.height + 'px';
      }
    } catch (_) {}

    wireTools();
    wireDrag();
    wireResize();
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
      ? "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%23333' stroke-width='2'><circle cx='12' cy='12' r='6'/></svg>\") 11 11, auto"
      : "crosshair";
  }

  function wireTools() {
    pad.querySelectorAll('.scratch-tool').forEach(b => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });
    pad.querySelector('.scratch-clear').addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      paintBg();
    });
    pad.querySelector('.scratch-close').addEventListener('click', close);
  }

  function wireDrag() {
    const handle = pad.querySelector('[data-drag-handle]');
    let startX = 0, startY = 0, padX = 0, padY = 0, dragging = false;
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = pad.getBoundingClientRect();
      padX = rect.left; padY = rect.top;
      startX = e.clientX; startY = e.clientY;
      pad.style.left = padX + 'px';
      pad.style.top = padY + 'px';
      pad.style.right = 'auto';
      pad.style.bottom = 'auto';
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      const nx = clamp(padX + (e.clientX - startX), 8, window.innerWidth - 80);
      const ny = clamp(padY + (e.clientY - startY), 8, window.innerHeight - 60);
      pad.style.left = nx + 'px';
      pad.style.top = ny + 'px';
    });
    handle.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      savePos();
    });
  }

  function wireResize() {
    const handle = pad.querySelector('[data-resize-handle]');
    let startX = 0, startY = 0, w = 0, h = 0, resizing = false;
    handle.addEventListener('pointerdown', e => {
      resizing = true;
      const rect = pad.getBoundingClientRect();
      w = rect.width; h = rect.height;
      startX = e.clientX; startY = e.clientY;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if (!resizing) return;
      const nw = clamp(w + (e.clientX - startX), 260, window.innerWidth - 40);
      const nh = clamp(h + (e.clientY - startY), 200, window.innerHeight - 40);
      pad.style.width = nw + 'px';
      pad.style.height = nh + 'px';
      sizeCanvas(true);
    });
    handle.addEventListener('pointerup', e => {
      if (!resizing) return;
      resizing = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      savePos();
    });
  }

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
    return '#1f2937';
  }
  function strokeWidth() {
    return 2.2;
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left), y: (e.clientY - r.top) };
  }

  function paintBg() {
    // Notebook ruled lines
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 130, 160, 0.18)';
    ctx.lineWidth = 1;
    for (let y = 28; y < h; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Margin line
    ctx.strokeStyle = 'rgba(244, 114, 114, 0.28)';
    ctx.beginPath();
    ctx.moveTo(38, 0); ctx.lineTo(38, h); ctx.stroke();
    ctx.restore();
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
    paintBg();
    if (prev) {
      const img = new Image();
      img.onload = () => { try { ctx.drawImage(img, 0, 0, rect.width, rect.height); } catch (_) {} };
      img.src = prev;
    }
  }

  function savePos() {
    const r = pad.getBoundingClientRect();
    localStorage.setItem(STORE_POS, JSON.stringify({
      left: r.left, top: r.top, width: r.width, height: r.height
    }));
  }

  function open() {
    if (!pad) buildPad();
    pad.classList.add('is-open');
    toggleBtn.classList.add('is-active');
    localStorage.setItem(STORE_OPEN, '1');
    sizeCanvas(true);
  }
  function close() {
    if (!pad) return;
    pad.classList.remove('is-open');
    toggleBtn.classList.remove('is-active');
    localStorage.setItem(STORE_OPEN, '0');
  }
  function toggle() {
    if (!pad || !pad.classList.contains('is-open')) open();
    else close();
  }

  function init() {
    buildToggle();
    buildPad();
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
