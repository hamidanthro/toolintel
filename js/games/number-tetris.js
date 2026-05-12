/**
 * GradeEarn — Number Tetris (game #14, May 12).
 *
 * Tetris-shaped math game. Tetrominoes fall with random digits on
 * every cell. A row clears when the 10 digits sum to the kid's
 * grade target (K-1: 5, gr 2-3: 10, gr 4: 15, gr 5: 20, gr 6: 20
 * with negatives, gr 7-8: 30 with negatives + multipliers,
 * algebra-1: 50 with all the trimmings).
 *
 * Earnings: 1c per row clear, 3c for 2 rows, 5c for 3+ (server caps
 * any 'earn' call at 5c). Client session cap of 50c per day tracked
 * in localStorage. Uses the existing /default → action:'earn'
 * lambda endpoint — no schema change.
 */
(function () {
  'use strict';

  const GAME_ID = 'number-tetris';
  const COLS = 10;
  const ROWS = 20;
  const DAILY_CAP_CENTS = 50;

  // DOM
  const canvas = document.getElementById('ntCanvas');
  const nextCanvas = document.getElementById('ntNextCanvas');
  const scoreEl = document.getElementById('gameYourScore');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('ntPreStart');
  const startBtn = document.getElementById('ntStartBtn');
  const statsEl = document.getElementById('ntStats');
  const targetEl = document.getElementById('ntTarget');
  const linesEl = document.getElementById('ntLines');
  const levelEl = document.getElementById('ntLevel');
  const centsEl = document.getElementById('ntCents');
  const boardEl = document.getElementById('ntBoard');
  const pauseOverlay = document.getElementById('ntPauseOverlay');
  const resumeBtn = document.getElementById('ntResumeBtn');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeLines = document.getElementById('gameCompleteLines');
  const completeCents = document.getElementById('gameCompleteCents');
  const completeBest = document.getElementById('gameCompleteBest');
  const playAgainBtn = document.getElementById('ntPlayAgain');
  const toastEl = document.getElementById('gameToast');

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1300); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }
  function prefersReducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } }

  // ---------- grade math config ----------
  // weights array parallels digits; index k means weight for digits[k].
  // Higher weight = more common. Lower digits should be weighted heavier
  // so rows hover near target (need a few specific picks to land exactly).
  // Targets tuned so an average row is reachable. Minimum row sum
  // with 10 cells × digit=1 is 10, so targets ≤9 require 0s in the
  // pool. Each row's expected sum (EV per cell × 10) sits ~30% above
  // the target so kids must steer pieces, not pray.
  const GRADE_CONFIG = {
    'grade-k':   { target: 10, digits: [0,1,2,3],           weights: [5,5,3,1],   neg: false, multAfterLevel: 99 },
    'grade-1':   { target: 12, digits: [0,1,2,3,4],         weights: [4,5,4,2,1], neg: false, multAfterLevel: 99 },
    'grade-2':   { target: 15, digits: [0,1,2,3,4,5],       weights: [3,4,4,3,2,1], neg: false, multAfterLevel: 99 },
    'grade-3':   { target: 18, digits: [0,1,2,3,4,5,6],     weights: [2,4,4,3,3,2,1], neg: false, multAfterLevel: 99 },
    'grade-4':   { target: 22, digits: [0,1,2,3,4,5,6,7],   weights: [2,3,3,4,3,3,2,1], neg: false, multAfterLevel: 99 },
    'grade-5':   { target: 28, digits: [0,1,2,3,4,5,6,7,8,9], weights: [2,3,3,3,3,3,2,2,1,1], neg: false, multAfterLevel: 99 },
    'grade-6':   { target: 25, digits: [0,1,2,3,4,5,6,7,8,9], weights: [2,3,3,3,3,3,2,2,1,1], neg: true,  negDigits: [-1,-2,-3,-4], negChance: 0.16, multAfterLevel: 99 },
    'grade-7':   { target: 35, digits: [0,1,2,3,4,5,6,7,8,9], weights: [1,2,3,3,3,3,3,2,2,1], neg: true,  negDigits: [-1,-2,-3,-4,-5], negChance: 0.20, multAfterLevel: 5 },
    'grade-8':   { target: 40, digits: [0,1,2,3,4,5,6,7,8,9], weights: [1,2,3,3,3,3,3,2,2,1], neg: true,  negDigits: [-1,-2,-3,-4,-5], negChance: 0.20, multAfterLevel: 5 },
    'algebra-1': { target: 50, digits: [0,1,2,3,4,5,6,7,8,9,10,12], weights: [1,2,3,3,3,3,3,2,2,1,1,1], neg: true,  negDigits: [-1,-2,-3,-4,-5,-6], negChance: 0.22, multAfterLevel: 1 }
  };

  function weightedPick(digits, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < digits.length; i++) {
      r -= weights[i];
      if (r <= 0) return digits[i];
    }
    return digits[digits.length - 1];
  }
  function pickDigit(cfg, level) {
    if (cfg.neg && Math.random() < cfg.negChance) {
      return cfg.negDigits[randInt(0, cfg.negDigits.length - 1)];
    }
    return weightedPick(cfg.digits, cfg.weights);
  }
  function shouldSpawnMultiplier(cfg, level, spawnIdx) {
    if (level < cfg.multAfterLevel) return false;
    return (spawnIdx % 20) === 0;
  }

  // ---------- tetrominoes ----------
  // Each shape is a list of cell rotations. Each rotation is a 4x4 grid
  // of 0/1. Standard Tetris layouts; simple matrix-rotation pieces all
  // share the SRS-ish spawn orientations.
  const SHAPES = {
    I: {
      color: '#3b82f6',
      rots: [
        [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
        [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
        [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
        [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]
      ]
    },
    O: {
      color: '#fbbf24',
      rots: [
        [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]]
      ]
    },
    T: {
      color: '#a855f7',
      rots: [
        [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
        [[0,1,0,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
        [[0,0,0,0],[1,1,1,0],[0,1,0,0],[0,0,0,0]],
        [[0,1,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]]
      ]
    },
    L: {
      color: '#f97316',
      rots: [
        [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
        [[0,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,0,0]],
        [[0,0,0,0],[1,1,1,0],[1,0,0,0],[0,0,0,0]],
        [[1,1,0,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]]
      ]
    },
    J: {
      color: '#2563eb',
      rots: [
        [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
        [[0,1,1,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
        [[0,0,0,0],[1,1,1,0],[0,0,1,0],[0,0,0,0]],
        [[0,1,0,0],[0,1,0,0],[1,1,0,0],[0,0,0,0]]
      ]
    },
    S: {
      color: '#22c55e',
      rots: [
        [[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
        [[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,0,0]]
      ]
    },
    Z: {
      color: '#ef4444',
      rots: [
        [[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
        [[0,0,1,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]]
      ]
    }
  };
  const SHAPE_KEYS = Object.keys(SHAPES);

  // ---------- game state ----------
  let ctx, nctx;
  let cellSize = 24;
  let grid = []; // 2D [row][col], each cell null or { digit, color, isMult }
  let current = null; // { key, rot, x, y, digits[4][4], color }
  let next = null;
  let score = 0, lines = 0, level = 1;
  let centsThisSession = 0;
  let centsToday = 0;
  let bestScore = 0;
  let gravityMs = 800;
  let lastFallAt = 0;
  let isPaused = false;
  let isOver = false;
  let isRunning = false;
  let lastFrame = 0;
  let flashRows = []; // {rowIdx, untilTime}
  let cfg = null;
  let grade = 'grade-3';
  let multSpawnCounter = 0;
  let rafId = null;

  // ---------- localStorage ----------
  const LS_DAILY = 'nt_daily';
  const LS_BEST = 'nt_best';
  function loadDaily() {
    try {
      const raw = localStorage.getItem(LS_DAILY);
      if (!raw) return { date: todayDateKey(), cents: 0 };
      const j = JSON.parse(raw);
      if (j.date !== todayDateKey()) return { date: todayDateKey(), cents: 0 };
      return j;
    } catch (_) { return { date: todayDateKey(), cents: 0 }; }
  }
  function saveDaily(d) { try { localStorage.setItem(LS_DAILY, JSON.stringify(d)); } catch (_) {} }
  function loadBest() { try { return parseInt(localStorage.getItem(LS_BEST), 10) || 0; } catch (_) { return 0; } }
  function saveBest(v) { try { localStorage.setItem(LS_BEST, String(v)); } catch (_) {} }

  // ---------- canvas sizing ----------
  function resizeCanvas() {
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const wrapW = wrap.clientWidth;
    const wrapH = window.innerHeight - 200; // reserve UI space
    const fromW = Math.floor(wrapW / COLS);
    const fromH = Math.floor(wrapH / ROWS);
    cellSize = Math.max(14, Math.min(fromW, fromH));
    const w = cellSize * COLS;
    const h = cellSize * ROWS;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (nextCanvas) {
      const ns = Math.max(16, cellSize * 0.7);
      nextCanvas.width = ns * 4 * dpr;
      nextCanvas.height = ns * 4 * dpr;
      nextCanvas.style.width = (ns * 4) + 'px';
      nextCanvas.style.height = (ns * 4) + 'px';
      nctx = nextCanvas.getContext('2d');
      nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // ---------- grid ----------
  function emptyGrid() {
    const g = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) row.push(null);
      g.push(row);
    }
    return g;
  }

  // ---------- piece spawn ----------
  function spawnPiece() {
    multSpawnCounter++;
    const key = next ? next.key : SHAPE_KEYS[randInt(0, SHAPE_KEYS.length - 1)];
    const piece = makePiece(key);
    next = makePiece(SHAPE_KEYS[randInt(0, SHAPE_KEYS.length - 1)]);
    return piece;
  }
  function makePiece(key) {
    const shape = SHAPES[key];
    const rot = 0;
    const digits = [];
    for (let r = 0; r < 4; r++) {
      const row = [];
      for (let c = 0; c < 4; c++) {
        if (shape.rots[rot][r][c]) {
          // assign a digit
          let d = pickDigit(cfg, level);
          row.push(d);
        } else row.push(null);
      }
      digits.push(row);
    }
    // Optional multiplier flag for one cell (if eligible)
    const isMult = shouldSpawnMultiplier(cfg, level, multSpawnCounter);
    let multAt = null;
    if (isMult) {
      // pick a filled cell at random
      const filled = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (digits[r][c] != null) filled.push([r, c]);
      if (filled.length > 0) multAt = filled[randInt(0, filled.length - 1)];
    }
    return {
      key, rot, x: 3, y: -1, digits, color: shape.color, multAt
    };
  }

  // ---------- collision / placement ----------
  function pieceCells(piece) {
    // return list of {gr, gc, digit, isMult}
    const out = [];
    const shape = SHAPES[piece.key];
    const rot = shape.rots[piece.rot % shape.rots.length];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (rot[r][c]) {
          const gr = piece.y + r;
          const gc = piece.x + c;
          const isMult = piece.multAt && piece.multAt[0] === r && piece.multAt[1] === c;
          out.push({ gr, gc, digit: piece.digits[r][c], isMult });
        }
      }
    }
    return out;
  }
  function collides(piece) {
    const cells = pieceCells(piece);
    for (const cell of cells) {
      if (cell.gc < 0 || cell.gc >= COLS) return true;
      if (cell.gr >= ROWS) return true;
      if (cell.gr < 0) continue; // above top — ok during spawn
      if (grid[cell.gr][cell.gc]) return true;
    }
    return false;
  }
  function lockPiece() {
    const cells = pieceCells(current);
    for (const cell of cells) {
      if (cell.gr < 0) continue;
      grid[cell.gr][cell.gc] = { digit: cell.digit, color: current.color, isMult: cell.isMult };
    }
    // Row clear check
    checkRowClears();
  }
  function rotateCurrent() {
    if (!current || isPaused || isOver) return;
    const next = SHAPES[current.key].rots.length;
    const newRot = (current.rot + 1) % next;
    const test = Object.assign({}, current, { rot: newRot });
    if (!collides(test)) current.rot = newRot;
  }
  function moveCurrent(dx, dy) {
    if (!current || isPaused || isOver) return false;
    const test = Object.assign({}, current, { x: current.x + dx, y: current.y + dy });
    if (collides(test)) return false;
    current.x += dx; current.y += dy;
    return true;
  }
  function softDrop() {
    if (moveCurrent(0, 1)) score += 1;
  }
  function hardDrop() {
    if (!current || isPaused || isOver) return;
    let cells = 0;
    while (moveCurrent(0, 1)) cells++;
    score += cells * 2;
    lockAndNext();
  }
  function lockAndNext() {
    lockPiece();
    current = spawnPiece();
    if (collides(current)) {
      isOver = true;
      endGame();
    }
  }

  // ---------- row clearing ----------
  function checkRowClears() {
    const toClear = [];
    for (let r = 0; r < ROWS; r++) {
      const row = grid[r];
      if (row.some(c => !c)) continue; // not full
      let sum = 0;
      for (const cell of row) {
        const v = cell.isMult ? cell.digit * 2 : cell.digit;
        sum += v;
      }
      if (sum === cfg.target) toClear.push(r);
    }
    if (toClear.length === 0) return;

    const reduced = prefersReducedMotion();
    if (!reduced) {
      // brief flash before clear
      const now = performance.now();
      flashRows = toClear.map(r => ({ row: r, until: now + 200 }));
      render();
      setTimeout(() => { flashRows = []; performClear(toClear); }, 200);
    } else {
      performClear(toClear);
    }
  }
  function performClear(rows) {
    rows.sort((a, b) => a - b);
    // Remove rows top-down to bottom-up
    for (const r of rows.slice().reverse()) {
      grid.splice(r, 1);
      grid.unshift(new Array(COLS).fill(null));
    }
    const count = rows.length;
    lines += count;

    // Score
    let pts = 0;
    if (count === 1) pts = 100;
    else if (count === 2) pts = 300;
    else if (count === 3) pts = 500;
    else pts = 800;
    score += pts;
    scoreEl.textContent = String(score);
    linesEl.textContent = String(lines);

    // Cents (server caps 1-5 per 'earn' call)
    let centsForClear = 0;
    if (count === 1) centsForClear = 1;
    else if (count === 2) centsForClear = 3;
    else centsForClear = 5;
    awardCents(centsForClear);

    // Level up every 10 lines
    const newLevel = Math.floor(lines / 10) + 1;
    if (newLevel !== level) {
      level = newLevel;
      gravityMs = Math.max(80, Math.floor(800 * Math.pow(0.85, level - 1)));
      levelEl.textContent = String(level);
      toast(`Level ${level}! Faster…`, 1100);
    }

    // FX
    try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
    try { window.STAARFx && window.STAARFx.haptic && window.STAARFx.haptic(count >= 3 ? 'medium' : 'light'); } catch (_) {}
    if (count >= 4) { try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {} }
  }

  // ---------- earnings ----------
  async function awardCents(amount) {
    if (amount <= 0) return;
    const daily = loadDaily();
    const room = Math.max(0, DAILY_CAP_CENTS - daily.cents);
    const toAward = Math.min(amount, room);
    if (toAward <= 0) {
      toast('Daily cap reached — try again tomorrow', 1400);
      return;
    }
    // Client-side update immediately for snappy UI
    daily.cents += toAward;
    saveDaily(daily);
    centsThisSession += toAward;
    centsToday = daily.cents;
    centsEl.textContent = centsToday + '¢';

    // Server call (existing 'earn' action — caps at 5c per call)
    try {
      const r = await api('earn', {
        cents: toAward,
        section: `${grade}|number-tetris|none`
      });
      if (r && typeof r.balanceCents === 'number') {
        // Update top-nav badge via the standard event pattern
        try {
          const ev = new CustomEvent('gradeearn:wallet-updated', { detail: { balanceCents: r.balanceCents } });
          document.dispatchEvent(ev);
        } catch (_) {}
      }
    } catch (_) {
      // Offline tolerance: keep local cap intact, just no server credit
    }
  }

  // ---------- render ----------
  function render() {
    if (!ctx) return;
    const w = cellSize * COLS;
    const h = cellSize * ROWS;
    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    // Faint grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * cellSize + 0.5, 0); ctx.lineTo(c * cellSize + 0.5, h); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellSize + 0.5); ctx.lineTo(w, r * cellSize + 0.5); ctx.stroke(); }

    // Locked cells
    const now = performance.now();
    const flashing = new Set(flashRows.filter(f => f.until > now).map(f => f.row));
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        if (!cell) continue;
        drawCell(c, r, cell.color, cell.digit, cell.isMult, flashing.has(r));
      }
    }
    // Current piece
    if (current && !isOver) {
      const cells = pieceCells(current);
      // Highlight: would this piece's lock complete a clear at any row?
      const previewWouldClear = checkPreviewWouldClear(current);
      for (const cell of cells) {
        if (cell.gr < 0) continue;
        drawCell(cell.gc, cell.gr, current.color, cell.digit, cell.isMult, false, previewWouldClear);
      }
    }
  }

  function drawCell(c, r, color, digit, isMult, isFlashing, outlineHighlight) {
    const x = c * cellSize, y = r * cellSize, s = cellSize;
    // Body
    ctx.fillStyle = isFlashing ? '#fbbf24' : color;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    // Inner shadow / highlight
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 1, y + 1, s - 2, Math.max(2, s * 0.18));
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + 1, y + s - 1 - Math.max(2, s * 0.18), s - 2, Math.max(2, s * 0.18));
    // Multiplier badge
    if (isMult) {
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
    }
    // Digit
    if (digit != null) {
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.floor(s * 0.55)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(digit), x + s / 2, y + s / 2 + 1);
    }
    if (outlineHighlight) {
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
    }
  }

  // Look-ahead: drop current piece to its resting spot, check if any
  // row would clear. Used for the subtle gold outline hint.
  function checkPreviewWouldClear(piece) {
    if (!piece) return false;
    let test = Object.assign({}, piece);
    while (true) {
      const next = Object.assign({}, test, { y: test.y + 1 });
      if (collides(next)) break;
      test = next;
    }
    // Simulate lock on a copy of grid
    const cells = pieceCells(test);
    const touched = new Set();
    for (const cell of cells) {
      if (cell.gr < 0) return false;
      touched.add(cell.gr);
    }
    for (const r of touched) {
      let sum = 0, full = true;
      for (let c = 0; c < COLS; c++) {
        const cellAtPiece = cells.find(p => p.gr === r && p.gc === c);
        const lockedCell = grid[r][c];
        if (!cellAtPiece && !lockedCell) { full = false; break; }
        const d = cellAtPiece ? (cellAtPiece.isMult ? cellAtPiece.digit * 2 : cellAtPiece.digit) : (lockedCell.isMult ? lockedCell.digit * 2 : lockedCell.digit);
        sum += d;
      }
      if (full && sum === cfg.target) return true;
    }
    return false;
  }

  function renderNext() {
    if (!nctx || !next) return;
    const ns = Math.max(16, cellSize * 0.7);
    nctx.fillStyle = '#0f172a';
    nctx.fillRect(0, 0, ns * 4, ns * 4);
    const shape = SHAPES[next.key];
    const rot = shape.rots[0];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (rot[r][c]) {
          const x = c * ns, y = r * ns;
          nctx.fillStyle = shape.color;
          nctx.fillRect(x + 1, y + 1, ns - 2, ns - 2);
          nctx.fillStyle = '#fff';
          nctx.font = `800 ${Math.floor(ns * 0.5)}px Inter, system-ui, sans-serif`;
          nctx.textAlign = 'center';
          nctx.textBaseline = 'middle';
          nctx.fillText(String(next.digits[r][c]), x + ns / 2, y + ns / 2);
        }
      }
    }
  }

  // ---------- game loop ----------
  function loop(now) {
    if (!isRunning) return;
    rafId = requestAnimationFrame(loop);
    if (isPaused || isOver) return;
    if (now - lastFallAt > gravityMs) {
      if (!moveCurrent(0, 1)) {
        lockAndNext();
      }
      lastFallAt = now;
    }
    render();
    renderNext();
  }

  // ---------- input: keyboard ----------
  function onKey(e) {
    if (!isRunning || isOver) return;
    if (e.key === 'p' || e.key === 'P') { togglePause(); e.preventDefault(); return; }
    if (isPaused) return;
    if (e.key === 'ArrowLeft') { moveCurrent(-1, 0); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { moveCurrent(1, 0); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { softDrop(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'x' || e.key === 'X') { rotateCurrent(); e.preventDefault(); }
    else if (e.key === 'z' || e.key === 'Z') {
      // counter-clockwise: rotate forward 3 times = once back
      const n = SHAPES[current.key].rots.length;
      const test = Object.assign({}, current, { rot: (current.rot + n - 1) % n });
      if (!collides(test)) current.rot = test.rot;
      e.preventDefault();
    }
    else if (e.key === ' ' || e.code === 'Space') { hardDrop(); e.preventDefault(); }
  }

  // ---------- input: touch ----------
  let touchStart = null;
  function onTouchStart(e) {
    if (isPaused || isOver) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onTouchEnd(e) {
    if (!touchStart || isPaused || isOver) { touchStart = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const dt = Date.now() - touchStart.t;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (absX < 12 && absY < 12 && dt < 250) {
      // tap → rotate
      rotateCurrent();
    } else if (absX > absY) {
      // horizontal swipe → move (per ~24px)
      const steps = Math.max(1, Math.round(absX / Math.max(24, cellSize)));
      for (let i = 0; i < steps; i++) moveCurrent(dx > 0 ? 1 : -1, 0);
    } else {
      // vertical swipe
      if (dy > 0) {
        // fast swipe down = hard drop
        if (dt < 220 && absY > 60) hardDrop();
        else { const steps = Math.max(1, Math.round(absY / Math.max(24, cellSize))); for (let i = 0; i < steps; i++) softDrop(); }
      } else if (dy < 0) {
        // swipe up = rotate alt
        rotateCurrent();
      }
    }
    touchStart = null;
  }

  // ---------- input: on-screen control buttons ----------
  function wireMobileButtons() {
    document.querySelectorAll('.nt-ctrl').forEach(b => {
      b.addEventListener('click', () => {
        if (isOver) return;
        const action = b.getAttribute('data-action');
        if (action === 'left') moveCurrent(-1, 0);
        else if (action === 'right') moveCurrent(1, 0);
        else if (action === 'rotate') rotateCurrent();
        else if (action === 'soft') softDrop();
        else if (action === 'hard') hardDrop();
        else if (action === 'pause') togglePause();
      });
    });
  }

  function togglePause() {
    if (!isRunning || isOver) return;
    isPaused = !isPaused;
    if (pauseOverlay) pauseOverlay.hidden = !isPaused;
  }
  if (resumeBtn) resumeBtn.addEventListener('click', togglePause);
  const pauseBtn = document.getElementById('ntPauseBtn');
  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);

  // ---------- start / end ----------
  function startGame() {
    cfg = GRADE_CONFIG[grade] || GRADE_CONFIG['grade-3'];
    grid = emptyGrid();
    score = 0; lines = 0; level = 1; flashRows = []; multSpawnCounter = 0;
    gravityMs = 800;
    centsThisSession = 0;
    centsToday = loadDaily().cents;
    bestScore = loadBest();
    isPaused = false; isOver = false;
    next = makePiece(SHAPE_KEYS[randInt(0, SHAPE_KEYS.length - 1)]);
    current = spawnPiece();

    scoreEl.textContent = '0';
    targetEl.textContent = String(cfg.target);
    linesEl.textContent = '0';
    levelEl.textContent = '1';
    centsEl.textContent = centsToday + '¢';
    statusEl.textContent = `Number Tetris · ${gradeLabel(grade)} · target = ${cfg.target}`;

    preStartEl.hidden = true;
    statsEl.hidden = false;
    boardEl.hidden = false;
    completeEl.hidden = true;
    if (tutorialEl) tutorialEl.hidden = true;
    const sidebarEl = document.getElementById('ntSidebar');
    if (sidebarEl) sidebarEl.hidden = false;
    if (pauseOverlay) pauseOverlay.hidden = true;

    resizeCanvas();
    render();
    renderNext();

    isRunning = true;
    lastFallAt = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    isOver = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (score > bestScore) saveBest(score);
    completeTitle.textContent = lines >= 10 ? 'Solid stack! 🧱' : lines >= 4 ? 'Nice run!' : 'Try again!';
    completeScore.textContent = String(score);
    completeLines.textContent = String(lines);
    completeCents.textContent = centsThisSession + '¢';
    completeBest.innerHTML = `<p class="game-complete-empty">Best: ${Math.max(score, bestScore)} pts · Total earned today: ${centsToday}¢ / ${DAILY_CAP_CENTS}¢</p>`;
    completeEl.hidden = false;
    try { window.STAARFx && window.STAARFx.haptic && window.STAARFx.haptic('medium'); } catch (_) {}
    // Submit a final score to the leaderboard (uses gameId pattern)
    try { api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(lines).fill('LINE'), totalWords: lines, durationSec: 0, puzzleId: 'nt-' + grade, prize: 'Number Tetris', foundPrize: lines >= 4 }); } catch (_) {}
  }

  // ---------- howto + tutorial ----------
  const HOWTO_KEY = 'nt_howto_dismissed';
  const TUT_KEY = 'nt_tutorial_seen';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  // Tutorial: 3-step illustrated walkthrough. Always available; the
  // first launch on a fresh device auto-opens it. Repeat plays can
  // skip by reading the small "(See demo again)" link instead.
  const tutorialEl = document.getElementById('ntTutorial');
  const tutStepEl = document.getElementById('ntTutStepNum');
  const tutTitleEl = document.getElementById('ntTutTitle');
  const tutVisualEl = document.getElementById('ntTutVisual');
  const tutBodyEl = document.getElementById('ntTutBody');
  const tutSkipBtn = document.getElementById('ntTutSkip');
  const tutBackBtn = document.getElementById('ntTutBack');
  const tutNextBtn = document.getElementById('ntTutNext');
  let tutStep = 0;

  // Find a valid 10-cell row that sums to the current target, using
  // small-friendly digits. We start from a baseline distribution and
  // adjust the last cells. Returns array of 10 digits.
  function sampleRowForTarget(target) {
    const cells = new Array(10).fill(0);
    let remaining = target;
    // Greedy fill with small digits
    for (let i = 0; i < 10 && remaining > 0; i++) {
      const max = Math.min(9, remaining);
      const v = Math.max(0, Math.min(max, Math.round(remaining / (10 - i))));
      cells[i] = v;
      remaining -= v;
    }
    // If still remaining, distribute to earliest non-9 cell
    for (let i = 0; i < 10 && remaining > 0; i++) {
      const room = 9 - cells[i];
      const add = Math.min(room, remaining);
      cells[i] += add; remaining -= add;
    }
    // Shuffle for visual variety
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells;
  }

  function tutorialSteps() {
    const tgt = cfg.target;
    const row = sampleRowForTarget(tgt);
    const mathStr = row.join(' + ') + ' = <strong>' + tgt + '</strong>';
    const rowHtml = row.map(d => `<span class="nt-tut-cell" style="background:${d === 0 ? 'rgba(255,255,255,0.06)' : '#22c55e'};color:${d === 0 ? 'rgba(255,255,255,0.4)' : '#fff'}">${d}</span>`).join('');
    return [
      {
        title: `Make rows that sum to ${tgt}`,
        visual: `<div class="nt-tut-row">${rowHtml}</div><div class="nt-tut-math">${mathStr} ✓</div>`,
        body: `Every row has <strong>10 cells</strong>. When the digits add up to <strong>${tgt}</strong>, the whole row clears.`
      },
      {
        title: 'Cleared rows earn cents',
        visual: `<div class="nt-tut-row nt-tut-row--clearing">${rowHtml}</div><div class="nt-tut-earn">+1¢ <span class="nt-tut-earn-sub">(per row cleared)</span></div>`,
        body: `<strong>1 row = 1¢</strong> · <strong>2 rows = 3¢</strong> · <strong>3+ rows = 5¢</strong><br>Daily cap: 50¢. Tomorrow it resets.`
      },
      {
        title: 'Steer the falling blocks',
        visual: `<div class="nt-tut-controls"><div class="nt-tut-ctl-row"><strong>📱 Phone</strong> · tap = rotate · swipe ←/→ = move · swipe ↓↓ fast = hard drop</div><div class="nt-tut-ctl-row"><strong>💻 Desktop</strong> · ← → move · ↑ rotate · ↓ soft · Space hard · P pause</div></div>`,
        body: `Plan each piece. <strong>You don't HAVE to make ${tgt} every row</strong> — but each one you do earns cents. Ready?`
      }
    ];
  }

  function renderTutorialStep() {
    const steps = tutorialSteps();
    const s = steps[tutStep];
    if (!s) return;
    tutStepEl.textContent = String(tutStep + 1);
    tutTitleEl.textContent = s.title;
    tutVisualEl.innerHTML = s.visual;
    tutBodyEl.innerHTML = s.body;
    tutBackBtn.hidden = tutStep === 0;
    tutNextBtn.textContent = tutStep === steps.length - 1 ? '▶ Play' : 'Next →';
  }
  function showTutorial() {
    if (!tutorialEl) { startGame(); return; }
    tutStep = 0;
    renderTutorialStep();
    tutorialEl.hidden = false;
    preStartEl.hidden = true;
  }
  function closeTutorial(startAfter) {
    if (tutorialEl) tutorialEl.hidden = true;
    try { localStorage.setItem(TUT_KEY, '1'); } catch (_) {}
    if (startAfter) startGame();
    else preStartEl.hidden = false;
  }
  if (tutSkipBtn) tutSkipBtn.addEventListener('click', () => closeTutorial(true));
  if (tutBackBtn) tutBackBtn.addEventListener('click', () => { tutStep = Math.max(0, tutStep - 1); renderTutorialStep(); });
  if (tutNextBtn) tutNextBtn.addEventListener('click', () => {
    const steps = tutorialSteps();
    if (tutStep >= steps.length - 1) { closeTutorial(true); return; }
    tutStep++; renderTutorialStep();
  });

  if (startBtn) startBtn.addEventListener('click', () => {
    // Show tutorial on first launch (or if user explicitly re-opens it).
    let seen = false;
    try { seen = localStorage.getItem(TUT_KEY) === '1'; } catch (_) {}
    if (seen) startGame();
    else showTutorial();
  });
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  document.addEventListener('keydown', onKey);
  if (canvas) {
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
  }
  wireMobileButtons();
  window.addEventListener('resize', () => { if (isRunning) { resizeCanvas(); render(); renderNext(); } });

  // ---------- boot ----------
  function boot() {
    // Grade detection: signed-in user > ?g= URL param > grade-3
    let g = null;
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      if (u && u.grade) g = u.grade;
    } catch (_) {}
    if (!g) {
      const params = new URLSearchParams(window.location.search);
      const qg = params.get('g');
      if (qg && GRADE_CONFIG[qg]) g = qg;
    }
    if (!g) g = 'grade-3';
    grade = g;
    cfg = GRADE_CONFIG[grade] || GRADE_CONFIG['grade-3'];
    statusEl.textContent = `Number Tetris · ${gradeLabel(grade)} · target = ${cfg.target}`;
    targetEl.textContent = String(cfg.target);
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
