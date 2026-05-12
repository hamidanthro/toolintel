/**
 * GradeEarn — Math Sprint (game #3, May 11).
 *
 * Mechanic: 60-second sprint. A math problem appears with 4 choices;
 * tap the right one to score. +10 per correct, +1/+2/+3/+4/+5 streak
 * bonus per consecutive correct (caps at +5), −3 per wrong (streak
 * resets). Most problems right wins.
 *
 * Problems are procedurally generated per the kid's grade level —
 * no static bank to maintain. K-1 use single-digit add; 2-3
 * progress through subtraction + multiplication; 4-5 add division
 * + larger numbers; 6-8 hit pre-algebra, integers, percent; algebra-1
 * hits one-step equations and slope.
 *
 * Multiplayer (async race) — opponents strip polls getGameScores
 * every 5s. + Challenge friend opens the existing invite sheet.
 */
(function () {
  'use strict';

  const GAME_ID = 'math-sprint';
  const DURATION_SEC = 60;
  const NEXT_DELAY_OK = 320;
  const NEXT_DELAY_WRONG = 700;

  // DOM
  const scoreEl       = document.getElementById('gameYourScore');
  const headerStat    = document.getElementById('gameHeaderStat');
  const opponentsEl   = document.getElementById('gameOpponents');
  const statusEl      = document.getElementById('gameStatus');
  const preStartEl    = document.getElementById('msPreStart');
  const startBtn      = document.getElementById('msStartBtn');
  const statsEl       = document.getElementById('msStats');
  const correctEl     = document.getElementById('msCorrect');
  const wrongEl       = document.getElementById('msWrong');
  const timerEl       = document.getElementById('msTimer');
  const streakEl      = document.getElementById('msStreak');
  const timerStatEl   = document.getElementById('msTimerStat');
  const streakStatEl  = document.getElementById('msStreakStat');
  const boardEl       = document.getElementById('msBoard');
  const questionEl    = document.getElementById('msQuestion');
  const choicesEl     = document.getElementById('msChoices');
  const progressEl    = document.getElementById('msProgressFill');
  const completeEl    = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak  = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn  = document.getElementById('msPlayAgain');
  const toastEl       = document.getElementById('gameToast');

  // State
  let grade = 'grade-k';
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let streak = 0;
  let bestStreak = 0;
  let currentProblem = null;
  let problemNumber = 0;
  let startedAt = null;
  let endsAt = null;
  let tickTimer = null;
  let inputLocked = false;
  let opponentsPollTimer = null;
  let nextTimer = null;

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function token() {
    try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; }
  }
  async function api(action, payload) {
    if (!window.STAARAuth || !window.STAARAuth.api) return null;
    return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {}));
  }
  function todayDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.hidden = true; }, ms || 1600);
  }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function gradeLabel(g) {
    if (!g) return '';
    if (g === 'grade-k') return 'Kindergarten';
    if (g === 'algebra-1') return 'Algebra I';
    return g.replace('grade-', 'Grade ');
  }

  // ---------- problem generators (per grade) ----------
  // Each returns { question, answer, choices? } — choices is optional;
  // if omitted, plausible distractors are generated from the numeric
  // answer. For non-numeric answers (fractions, expressions) the
  // generator MUST supply its own choices.

  const COUNT_EMOJIS = ['🍎','⭐','🐶','🌸','🚗','🐱','🦋','🍓'];
  const GENERATORS = {
    'grade-k': () => {
      const n = randInt(2, 9);
      const emoji = pick(COUNT_EMOJIS);
      return { question: emoji.repeat(n) + '\nHow many?', answer: String(n) };
    },
    'grade-1': () => {
      // single-digit add to 10 OR simple subtract within 10
      if (Math.random() < 0.6) {
        const a = randInt(1, 8); const b = randInt(1, 10 - a);
        return { question: `${a} + ${b}`, answer: String(a + b) };
      }
      const a = randInt(3, 10); const b = randInt(1, a - 1);
      return { question: `${a} − ${b}`, answer: String(a - b) };
    },
    'grade-2': () => {
      // add/sub within 20
      if (Math.random() < 0.5) {
        const a = randInt(2, 18); const b = randInt(2, 20 - a < 2 ? 2 : 20 - a);
        return { question: `${a} + ${b}`, answer: String(a + b) };
      }
      const a = randInt(8, 20); const b = randInt(2, a - 1);
      return { question: `${a} − ${b}`, answer: String(a - b) };
    },
    'grade-3': () => {
      // mult facts 2-9 + simple division
      if (Math.random() < 0.7) {
        const a = randInt(2, 9); const b = randInt(2, 9);
        return { question: `${a} × ${b}`, answer: String(a * b) };
      }
      const b = randInt(2, 9); const ans = randInt(2, 9);
      return { question: `${b * ans} ÷ ${b}`, answer: String(ans) };
    },
    'grade-4': () => {
      // mult 6-12 + division facts + 2-digit add
      const r = Math.random();
      if (r < 0.4) {
        const a = randInt(6, 12); const b = randInt(3, 9);
        return { question: `${a} × ${b}`, answer: String(a * b) };
      } else if (r < 0.7) {
        const b = randInt(3, 9); const ans = randInt(3, 12);
        return { question: `${b * ans} ÷ ${b}`, answer: String(ans) };
      }
      const a = randInt(20, 80); const b = randInt(10, 50);
      return { question: `${a} + ${b}`, answer: String(a + b) };
    },
    'grade-5': () => {
      // larger mult/div, fractions of whole numbers
      const r = Math.random();
      if (r < 0.4) {
        const a = randInt(7, 15); const b = randInt(5, 20);
        return { question: `${a} × ${b}`, answer: String(a * b) };
      } else if (r < 0.7) {
        // fraction of a whole
        const denom = pick([2, 3, 4, 5, 10]);
        const num = randInt(2, 12);
        const whole = denom * num;
        return { question: `1/${denom} of ${whole}`, answer: String(num) };
      } else if (r < 0.9) {
        // decimal × 10 / 100
        const a = randInt(2, 99) / 10;
        const mul = pick([10, 100]);
        const product = (a * mul);
        return { question: `${a} × ${mul}`, answer: String(Number.isInteger(product) ? product : product.toFixed(1)) };
      }
      // percent of 100
      const p = pick([10, 20, 25, 50, 75]);
      return { question: `${p}% of 100`, answer: String(p) };
    },
    'grade-6': () => {
      const r = Math.random();
      if (r < 0.35) {
        // percent of any whole
        const p = pick([10, 20, 25, 50, 75]);
        const whole = pick([20, 40, 60, 80, 100, 200]);
        return { question: `${p}% of ${whole}`, answer: String(Math.round(p * whole / 100)) };
      } else if (r < 0.6) {
        // one-step equation x + a = b
        if (Math.random() < 0.5) {
          const a = randInt(2, 19); const x = randInt(1, 30);
          return { question: `x + ${a} = ${x + a}\nx = ?`, answer: String(x) };
        }
        const a = randInt(2, 9); const x = randInt(2, 12);
        return { question: `${a}x = ${a * x}\nx = ?`, answer: String(x) };
      } else if (r < 0.85) {
        // ratio / proportion small
        const k = randInt(2, 8); const a = randInt(2, 9); const b = a * k;
        return { question: `${a} : ${b} = 1 : ?`, answer: String(k) };
      }
      // GCD / LCM-style basics
      const opts = [[6, 8, 2], [9, 12, 3], [15, 20, 5], [8, 12, 4], [10, 25, 5]];
      const [a, b, ans] = pick(opts);
      return { question: `GCD(${a}, ${b})`, answer: String(ans) };
    },
    'grade-7': () => {
      const r = Math.random();
      if (r < 0.4) {
        // two-step: ax + b = c
        const a = randInt(2, 9); const x = randInt(2, 9); const b = randInt(-15, 15);
        return { question: `${a}x ${b >= 0 ? '+' : '−'} ${Math.abs(b)} = ${a * x + b}\nx = ?`, answer: String(x) };
      } else if (r < 0.7) {
        // integer operations
        const a = randInt(-12, 12); const b = randInt(-12, 12);
        const op = pick(['+', '−', '×']);
        const ans = op === '+' ? a + b : op === '−' ? a - b : a * b;
        return { question: `${a < 0 ? `(${a})` : a} ${op} ${b < 0 ? `(${b})` : b}`, answer: String(ans) };
      } else if (r < 0.9) {
        // proportion: a/b = c/?
        const k = randInt(2, 6); const a = randInt(2, 8); const b = a * k;
        const c = randInt(2, 9); const ans = c * k;
        return { question: `${a}/${b} = ${c}/?`, answer: String(ans) };
      }
      // fraction add same denom
      const d = pick([4, 5, 6, 8, 10]);
      const a = randInt(1, d - 2); const b = randInt(1, d - 1 - a);
      return { question: `${a}/${d} + ${b}/${d}`, answer: `${a + b}/${d}` };
    },
    'grade-8': () => {
      const r = Math.random();
      if (r < 0.3) {
        // squares
        const n = randInt(3, 12);
        return { question: `${n}²`, answer: String(n * n) };
      } else if (r < 0.55) {
        // square roots (perfect squares)
        const n = pick([4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144]);
        return { question: `√${n}`, answer: String(Math.sqrt(n)) };
      } else if (r < 0.75) {
        // cubes 1-5
        const n = randInt(2, 6);
        return { question: `${n}³`, answer: String(n * n * n) };
      } else if (r < 0.9) {
        // pythagorean triples
        const trip = pick([[3,4,5],[6,8,10],[5,12,13],[8,15,17],[9,12,15]]);
        return { question: `legs ${trip[0]}, ${trip[1]}\nhypotenuse?`, answer: String(trip[2]) };
      }
      // scientific notation × 10^n
      const a = randInt(2, 9); const n = randInt(1, 4);
      return { question: `${a} × 10^${n}`, answer: String(a * Math.pow(10, n)) };
    },
    'algebra-1': () => {
      const r = Math.random();
      if (r < 0.3) {
        // evaluate polynomial at x
        const a = randInt(2, 5); const b = randInt(1, 8); const x = randInt(2, 6);
        return { question: `${a}x + ${b}, when x = ${x}`, answer: String(a * x + b) };
      } else if (r < 0.55) {
        // slope of two points (positive integer slope)
        const m = randInt(2, 5);
        const x1 = randInt(0, 3); const y1 = randInt(0, 5);
        const dx = randInt(1, 4);
        return { question: `slope of (${x1},${y1}) and (${x1+dx},${y1+m*dx})`, answer: String(m) };
      } else if (r < 0.75) {
        // factor x²+(a+b)x+ab → pair
        const a = randInt(1, 6); const b = randInt(1, 6);
        if (a === b) {
          return { question: `factor x² + ${a+b}x + ${a*b}\n(x + ?)²`, answer: String(a) };
        }
        const choices = shuffleInPlace([
          `(x+${a})(x+${b})`,
          `(x+${a+1})(x+${b-1})`,
          `(x+${a-1})(x+${b+1})`,
          `(x−${a})(x−${b})`
        ]);
        return { question: `factor x² + ${a+b}x + ${a*b}`, answer: `(x+${a})(x+${b})`, choices };
      } else if (r < 0.9) {
        // distribute
        const a = randInt(2, 6); const b = randInt(1, 9);
        const choices = shuffleInPlace([
          `${a}x + ${a*b}`,
          `${a}x + ${b}`,
          `${a*b}x + ${a}`,
          `x + ${a*b}`
        ]);
        return { question: `${a}(x + ${b})`, answer: `${a}x + ${a*b}`, choices };
      }
      // exponents: x^a × x^b
      const a = randInt(2, 5); const b = randInt(2, 5);
      const choices = shuffleInPlace([
        `x^${a + b}`,
        `x^${a * b}`,
        `2x^${a + b}`,
        `x^${a + b + 1}`
      ]);
      return { question: `x^${a} × x^${b}`, answer: `x^${a + b}`, choices };
    }
  };

  function buildProblem() {
    const fn = GENERATORS[grade] || GENERATORS['grade-k'];
    const p = fn();
    if (!p.choices) p.choices = genNumericChoices(p.answer);
    return p;
  }

  // For numeric answers, generate 3 plausible-but-wrong neighbors
  // (off-by-one, off-by-ten/place-value, swapped digits) plus the answer.
  function genNumericChoices(answer) {
    const numAns = parseFloat(answer);
    const isInt = Number.isInteger(numAns);
    if (isNaN(numAns)) {
      // Non-numeric — caller should have provided choices; pad with answer + variants
      return shuffleInPlace([answer, answer + '?', answer + ' ', answer + '!']);
    }
    const choices = new Set([answer]);
    const candidates = [
      numAns + 1, numAns - 1,
      numAns + 10, numAns - 10,
      numAns * 2, Math.round(numAns / 2),
      numAns + 2, numAns - 2
    ];
    shuffleInPlace(candidates);
    for (const c of candidates) {
      if (choices.size >= 4) break;
      if (c < 0) continue;
      const fmt = isInt ? String(Math.round(c)) : String(c);
      if (fmt === answer) continue;
      choices.add(fmt);
    }
    // Pad if still short
    let extra = 1;
    while (choices.size < 4) {
      choices.add(String(Math.max(0, numAns + extra * 5)));
      extra++;
      if (extra > 20) break;
    }
    return shuffleInPlace(Array.from(choices));
  }

  // ---------- problem cycle ----------
  function nextProblem() {
    if (endsAt && Date.now() >= endsAt) return;
    currentProblem = buildProblem();
    problemNumber++;
    questionEl.textContent = currentProblem.question;
    choicesEl.innerHTML = '';
    currentProblem.choices.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ms-choice';
      btn.textContent = c;
      btn.addEventListener('click', () => onChoice(c, btn));
      choicesEl.appendChild(btn);
    });
    // Scale font down if the question is long (e.g. multi-line)
    const len = String(currentProblem.question).length;
    questionEl.style.fontSize = len > 28 ? '1.6rem' : len > 18 ? '2.1rem' : '2.6rem';
    inputLocked = false;
  }

  function onChoice(value, btn) {
    if (inputLocked) return;
    inputLocked = true;
    const ok = value === currentProblem.answer;
    if (ok) {
      const bonus = Math.min(streak, 5);
      const pts = 10 + bonus;
      score += pts;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      correctCount++;
      btn.classList.add('is-correct');
      try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
      try { window.STAARFx && window.STAARFx.haptic && window.STAARFx.haptic('light'); } catch (_) {}
      showFloating(btn, '+' + pts, bonus >= 3);
    } else {
      score = Math.max(0, score - 3);
      streak = 0;
      wrongCount++;
      btn.classList.add('is-wrong');
      // Briefly highlight the correct answer too
      [...choicesEl.querySelectorAll('.ms-choice')].forEach(b2 => {
        if (b2.textContent === currentProblem.answer) b2.classList.add('is-show-correct');
      });
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
      try { window.STAARFx && window.STAARFx.haptic && window.STAARFx.haptic('medium'); } catch (_) {}
    }
    scoreEl.textContent = String(score);
    correctEl.textContent = String(correctCount);
    wrongEl.textContent = String(wrongCount);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');

    nextTimer = setTimeout(nextProblem, ok ? NEXT_DELAY_OK : NEXT_DELAY_WRONG);
    // Debounced server submit
    queueSubmit();
  }

  function showFloating(anchor, text, hot) {
    const f = document.createElement('div');
    f.className = 'game-float-pts' + (hot ? ' game-float-pts--prize' : '');
    f.textContent = text;
    const rect = anchor.getBoundingClientRect();
    f.style.left = (rect.left + rect.width / 2) + 'px';
    f.style.top  = (rect.top  + rect.height / 2) + 'px';
    document.body.appendChild(f);
    setTimeout(() => { try { f.remove(); } catch (_) {} }, 900);
  }

  // ---------- timing ----------
  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tick(); // immediate
    tickTimer = setInterval(tick, 100);
  }
  function tick() {
    const remaining = Math.max(0, endsAt - Date.now());
    const sec = Math.ceil(remaining / 1000);
    timerEl.textContent = String(sec);
    const pct = (remaining / (DURATION_SEC * 1000)) * 100;
    if (progressEl) progressEl.style.width = pct + '%';
    if (sec <= 10) timerStatEl.classList.add('is-danger'); else timerStatEl.classList.remove('is-danger');
    if (remaining <= 0) finishGame();
  }

  // ---------- start / finish ----------
  function startGame() {
    score = 0; correctCount = 0; wrongCount = 0; streak = 0; bestStreak = 0; problemNumber = 0;
    startedAt = Date.now();
    endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0';
    correctEl.textContent = '0';
    wrongEl.textContent = '0';
    timerEl.textContent = String(DURATION_SEC);
    streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot');
    timerStatEl.classList.remove('is-danger');

    preStartEl.hidden = true;
    statsEl.hidden = false;
    boardEl.hidden = false;
    completeEl.hidden = true;
    statusEl.textContent = `Math Sprint · ${gradeLabel(grade)}`;

    nextProblem();
    startTick();
    startOpponentsPoll();
  }

  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    [...choicesEl.querySelectorAll('.ms-choice')].forEach(b => b.disabled = true);

    completeTitle.textContent = score >= 200 ? 'Lightning round! ⚡' : score >= 100 ? 'Solid sprint!' : score >= 50 ? 'Nice run!' : 'Keep training!';
    completeScore.textContent = String(score);
    completeCorrect.textContent = String(correctCount);
    completeStreak.textContent = String(bestStreak);

    // §51 unified scoring: convert session score → wallet cents and
    // credit the same balanceCents that Practice tops up. Daily cap
    // applies per-game; lifetime $100 cap applies globally.
    try {
      if (window.GradeEarnReward) {
        const cents = window.GradeEarnReward.scoreToCents(score);
        if (cents > 0) {
          window.GradeEarnReward.award(cents, 'math-sprint', { grade })
            .then((r) => { if (r && r.awarded > 0) window.GradeEarnReward.toastAward(r.awarded); });
        }
      }
    } catch (_) {}

    // Friend comparison
    completeFriends.innerHTML = '';
    api('getGameScores', { gameId: GAME_ID, date: todayDateKey() })
      .then(r => {
        if (!r || !Array.isArray(r.scores)) return;
        const me = window.STAARAuth.currentUser();
        const myName = me && me.username;
        const friends = r.scores.filter(s => s.username !== myName);
        if (friends.length === 0) {
          completeFriends.innerHTML = '<p class="game-complete-empty">No friends have played today yet — invite them on the league page!</p>';
          return;
        }
        friends.sort((a, b) => (b.score || 0) - (a.score || 0));
        const beat = friends.filter(f => (f.score || 0) < score);
        const lost = friends.filter(f => (f.score || 0) > score);
        completeFriends.innerHTML = `
          <div class="game-complete-cmp">
            ${beat.length > 0 ? `<div class="game-complete-cmp-line game-complete-cmp-line--win">🏆 Beat ${beat.length} ${beat.length === 1 ? 'friend' : 'friends'}: ${beat.slice(0, 3).map(f => esc(f.displayName || f.username)).join(', ')}</div>` : ''}
            ${lost.length > 0 ? `<div class="game-complete-cmp-line game-complete-cmp-line--lost">Behind: ${lost.slice(0, 3).map(f => `${esc(f.displayName || f.username)} (${f.score || 0})`).join(', ')}</div>` : ''}
          </div>`;
      });

    completeEl.hidden = false;
    try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
    doSubmit();
  }

  // ---------- server score submission ----------
  let submitTimer = null;
  function queueSubmit() {
    clearTimeout(submitTimer);
    submitTimer = setTimeout(doSubmit, 600);
  }
  async function doSubmit() {
    const payload = {
      gameId: GAME_ID,
      date: todayDateKey(),
      score,
      // wordsFound reused for solved-problem count so the existing
      // lambda schema serves us without modification.
      wordsFound: new Array(correctCount).fill('SOLVED'),
      totalWords: correctCount + wrongCount,
      durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000),
      puzzleId: 'sprint-' + grade + '-' + todayDateKey(),
      prize: 'Math Sprint',
      foundPrize: bestStreak >= 5
    };
    try { await api('submitGameScore', payload); }
    catch (_) {}
  }

  // ---------- opponents poll ----------
  function startOpponentsPoll() {
    refreshOpponents();
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    opponentsPollTimer = setInterval(refreshOpponents, 5000);
  }
  async function refreshOpponents() {
    try {
      const r = await api('getGameScores', { gameId: GAME_ID, date: todayDateKey() });
      if (!r || !Array.isArray(r.scores)) { renderOpponentsStrip([]); return; }
      const me = window.STAARAuth.currentUser();
      const myName = (me && me.username) || '';
      const friends = r.scores.filter(s => s.username !== myName);
      friends.sort((a, b) => (b.score || 0) - (a.score || 0));
      renderOpponentsStrip(friends.slice(0, 3));
    } catch (_) { renderOpponentsStrip([]); }
  }
  function renderOpponentsStrip(friends) {
    const friendsHtml = friends.length === 0
      ? '<div class="game-opp-empty">— no friends playing yet —</div>'
      : friends.map(f => `
          <div class="game-opponent">
            <span class="game-opp-name">${esc(f.displayName || f.username)}</span>
            <span class="game-opp-score">${(f.score || 0)}<span class="game-opp-score-label">pts</span></span>
          </div>`).join('');
    opponentsEl.innerHTML = `
      <div class="game-opponents-label">Friends today</div>
      <div class="game-opponents-list">${friendsHtml}</div>
      <button type="button" class="game-challenge-btn" id="gameChallengeBtn">+ Challenge friend</button>`;
    opponentsEl.hidden = false;
    const cb = document.getElementById('gameChallengeBtn');
    if (cb) cb.addEventListener('click', openInviteSheet);
  }

  // ---------- INVITE FLOW (shared shape with word-connect + memory-match) ----------
  async function openInviteSheet() {
    const wrap = document.createElement('div');
    wrap.id = 'gameInviteSheet';
    wrap.className = 'game-invite-sheet';
    wrap.innerHTML = `
      <div class="game-invite-sheet-backdrop"></div>
      <div class="game-invite-sheet-panel" role="dialog" aria-modal="true">
        <div class="game-invite-sheet-grab" aria-hidden="true"></div>
        <button type="button" class="game-invite-sheet-close" aria-label="Close">✕</button>
        <h3 class="game-invite-sheet-title">Challenge a friend</h3>
        <p class="game-invite-sheet-sub">They'll get a banner on the game page inviting them to race you.</p>
        <div id="gameInviteFriends" class="game-invite-friends">Loading…</div>
      </div>`;
    document.body.appendChild(wrap);
    const closeSheet = () => { try { wrap.remove(); } catch (_) {} };
    wrap.querySelector('.game-invite-sheet-backdrop').addEventListener('click', closeSheet);
    wrap.querySelector('.game-invite-sheet-close').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { closeSheet(); document.removeEventListener('keydown', escClose); }
    });
    try {
      const r = await api('friendList', {});
      const accepted = (r && Array.isArray(r.friends)) ? r.friends : [];
      const list = document.getElementById('gameInviteFriends');
      if (accepted.length === 0) {
        list.innerHTML = `
          <div class="game-invite-empty">
            <div class="game-invite-empty-emoji" aria-hidden="true">👋</div>
            <p>Add friends first, then come back to challenge them.</p>
            <a class="btn btn-primary" href="../league.html">Add a friend →</a>
          </div>`;
      } else {
        list.innerHTML = accepted.map(f => `
          <div class="game-invite-friend" data-username="${esc(f.peer)}">
            <span class="game-invite-friend-av">${esc((f.displayName || f.peer).charAt(0).toUpperCase())}</span>
            <span class="game-invite-friend-name">${esc(f.displayName || f.peer)}</span>
            <button type="button" class="game-invite-ping-btn" data-target="${esc(f.peer)}" data-display="${esc(f.displayName || f.peer)}">Ping</button>
          </div>`).join('');
        list.querySelectorAll('.game-invite-ping-btn').forEach(b => {
          b.addEventListener('click', async () => {
            const target = b.getAttribute('data-target');
            const display = b.getAttribute('data-display');
            b.disabled = true;
            b.textContent = 'Sending…';
            try {
              await api('sendGameInvite', { target, gameId: GAME_ID });
              b.textContent = 'Sent ✓';
              b.classList.add('is-sent');
              toast(`Invited ${display}!`, 1800);
              try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
            } catch (_) {
              b.disabled = false;
              b.textContent = 'Try again';
            }
          });
        });
      }
    } catch (_) {
      document.getElementById('gameInviteFriends').innerHTML =
        '<p class="game-invite-empty"><span class="game-invite-empty-emoji">⚠️</span>Could not load friends.</p>';
    }
  }

  async function checkIncomingInvites() {
    const inviteBanner = document.getElementById('gameInviteBanner');
    if (!inviteBanner) return;
    try {
      const r = await api('getGameInvites', { gameId: GAME_ID });
      const invites = (r && Array.isArray(r.invites)) ? r.invites : [];
      if (invites.length === 0) { inviteBanner.hidden = true; return; }
      const inv = invites.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))[0];
      inviteBanner.innerHTML = `
        <span class="game-invite-banner-icon" aria-hidden="true">⚡</span>
        <span class="game-invite-banner-text">
          <strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race
        </span>
        <button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      inviteBanner.hidden = false;
      inviteBanner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => {
        inviteBanner.hidden = true;
        try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {}
      });
      try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
    } catch (_) {}
  }

  // ---------- How-to-play dismiss ----------
  const HOWTO_KEY = 'ms_howto_dismissed';
  const howToCard = document.getElementById('howToPlay');
  const howToDismiss = document.getElementById('howToDismiss');
  if (howToCard) {
    try {
      if (localStorage.getItem(HOWTO_KEY) === '1') howToCard.hidden = true;
    } catch (_) {}
  }
  if (howToDismiss) {
    howToDismiss.addEventListener('click', () => {
      if (howToCard) howToCard.hidden = true;
      try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {}
    });
  }

  // ---------- wiring ----------
  if (startBtn) startBtn.addEventListener('click', () => {
    try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
    startGame();
  });
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => {
    completeEl.hidden = true;
    startGame();
  });

  // ---------- boot ----------
  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) {
      statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.';
      preStartEl.hidden = true;
      return;
    }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Math Sprint · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
    boot();
  } else {
    document.addEventListener('gradeearn:auth-changed', boot, { once: true });
    (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})();
  }
})();
