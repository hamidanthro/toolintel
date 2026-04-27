// GradeEarn — kid-friendly effects: sound (Web Audio), haptics, confetti.
// Zero dependencies, zero asset files. All effects respect STAARPrefs.
(function () {
  const prefs = () => (window.STAARPrefs && window.STAARPrefs.get()) || {};

  // ---------- Web Audio: build tones on the fly so we ship no audio files.
  let _ac = null;
  function ac() {
    if (_ac) return _ac;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      _ac = new Ctx();
    } catch (_) { _ac = null; }
    return _ac;
  }
  function tone({ freq = 660, dur = 0.18, type = 'sine', vol = 0.18, attack = 0.01, release = 0.08, slideTo = null }) {
    if (!prefs().sound) return;
    const c = ac(); if (!c) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (_) {} }
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.linearRampToValueAtTime(0, t0 + dur + release);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + release + 0.02);
  }
  function chord(freqs, opts) {
    freqs.forEach((f, i) => setTimeout(() => tone(Object.assign({ freq: f }, opts || {})), i * 70));
  }

  function playCorrect() {
    chord([523.25, 659.25, 783.99], { dur: 0.16, type: 'triangle', vol: 0.16 }); // C-E-G
  }
  function playWrong() {
    tone({ freq: 240, slideTo: 180, dur: 0.22, type: 'sawtooth', vol: 0.10, attack: 0.005, release: 0.12 });
  }
  function playMilestone() {
    chord([523.25, 659.25, 783.99, 1046.5], { dur: 0.18, type: 'triangle', vol: 0.18 });
  }
  function playClick() {
    tone({ freq: 880, dur: 0.05, type: 'square', vol: 0.06, attack: 0.001, release: 0.03 });
  }

  // ---------- Haptics
  function vibrate(pattern) {
    if (!prefs().haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {}
  }

  // ---------- Confetti (tiny canvas burst, no deps).
  function confetti({ count = 80, duration = 1600 } = {}) {
    if (!prefs().confetti) return;
    if (typeof document === 'undefined') return;
    let canvas = document.getElementById('staar-fx-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'staar-fx-canvas';
      Object.assign(canvas.style, {
        position: 'fixed', inset: '0', width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '9998'
      });
      document.body.appendChild(canvas);
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = window.innerWidth, H = window.innerHeight;
    const colors = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#eab308', '#ec4899'];
    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * 80,
        y: H / 2,
        vx: (Math.random() - 0.5) * 9,
        vy: -Math.random() * 11 - 4,
        g: 0.32 + Math.random() * 0.15,
        r: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        c: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() < 0.5 ? 'rect' : 'circle'
      });
    }
    const start = performance.now();
    function frame(t) {
      const elapsed = t - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        if (p.shape === 'rect') ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        else { ctx.beginPath(); ctx.arc(0, 0, p.r * 0.8, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      if (elapsed < duration) requestAnimationFrame(frame);
      else {
        ctx.clearRect(0, 0, W, H);
        try { canvas.parentNode && canvas.parentNode.removeChild(canvas); } catch (_) {}
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- Read-aloud (Web Speech API).
  function speak(text) {
    if (!prefs().readAloud) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(String(text || ''));
      u.rate = 0.95;
      u.pitch = 1.05;
      synth.speak(u);
    } catch (_) {}
  }
  function stopSpeak() {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
  }
  function readAloudEnabled() { return !!prefs().readAloud; }

  // ---------- Toast (re-used by milestone messages)
  function toast(msg, opts = {}) {
    const t = document.createElement('div');
    t.className = 'fx-toast' + (opts.kind ? ' fx-toast-' + opts.kind : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('fx-toast-in'));
    setTimeout(() => {
      t.classList.remove('fx-toast-in');
      setTimeout(() => { try { t.remove(); } catch (_) {} }, 350);
    }, opts.duration || 2400);
  }

  window.STAARFx = {
    playCorrect, playWrong, playMilestone, playClick,
    vibrate, confetti, speak, stopSpeak, readAloudEnabled, toast
  };
})();
