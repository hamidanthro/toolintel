/**
 * StarTest — STATE-AWARE DASHBOARD RENDERER
 *
 * Powers the logged-in home page experience for users who have a state.
 * - Hides hero-anon, state-picker, legacy #dashboard
 * - Shows #state-dashboard with greeting, streak, test countdown,
 *   continue-practicing CTA, stats tiles, practice-ahead grades.
 * - Re-renders on `startest:auth-changed` event.
 */

(function () {
  function init() {
    const dash = document.getElementById('state-dashboard');
    if (!dash) return;

    const auth = window.STAARAuth;
    const u = (auth && auth.currentUser && auth.currentUser()) || null;
    const state = (u && u.state && window.STATES_API && window.STATES_API.getBySlug(u.state)) || null;

    if (!u || !u.state || !state) {
      // Hide our dashboard; legacy flow handles guests / state-less users.
      dash.hidden = true;
      return;
    }

    // Hide competing surfaces so the state dashboard owns the page.
    hide('hero-anon');
    hide('state-picker');
    hide('dashboard'); // legacy logged-in dashboard
    const mobileHero = document.querySelector('.mobile-hero');
    if (mobileHero) mobileHero.hidden = true;
    document.querySelectorAll('.parent-layer').forEach(el => { el.hidden = true; });

    dash.hidden = false;

    renderWelcome(u);
    renderStreak(u);
    renderTestCountdown(u, state);
    renderContinueCard(u, state);
    renderStats(u);
    renderPracticeAhead(u, state);
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  // ============================================================
  // WELCOME
  // ============================================================
  function renderWelcome(u) {
    document.getElementById('sdash-greeting').textContent = greetingForTime();
    document.getElementById('sdash-name').textContent =
      u.displayName || u.username || 'there';
  }
  function greetingForTime() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  // ============================================================
  // STREAK
  // ============================================================
  function renderStreak(u) {
    const journey = readJourney(u.username);
    const streak = parseInt(journey.streak, 10) || 0;
    if (streak > 0) {
      document.getElementById('sdash-streak-count').textContent = streak;
      document.getElementById('sdash-streak').hidden = false;
    }
  }

  function readJourney(username) {
    try {
      const raw = localStorage.getItem(`staar.journey.${username}`);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  // ============================================================
  // TEST COUNTDOWN
  // ============================================================
  function renderTestCountdown(u, state) {
    if (!window.STATES_API || !window.STATES_API.daysUntilNextTestWindow) return;
    const calendar = window.STATES_API.daysUntilNextTestWindow(u.state);
    const message = window.STATES_API.getTestWindowMessage(u.state);
    if (!calendar || !message) return;

    const card = document.getElementById('sdash-countdown');
    card.dataset.urgency = message.urgency;
    document.getElementById('sdash-countdown-eyebrow').textContent = message.eyebrow;
    document.getElementById('sdash-countdown-message').textContent = message.message;
    document.getElementById('sdash-countdown-days').textContent = calendar.days;
    card.hidden = false;
  }

  // ============================================================
  // CONTINUE PRACTICING
  // ============================================================
  function renderContinueCard(u, state) {
    const journey = readJourney(u.username);
    const grade = u.grade;
    const lastSubject = journey.lastSubject || 'math';

    const isFreshDay = isFirstSessionToday(journey);
    document.getElementById('sdash-continue-eyebrow').textContent =
      isFreshDay ? "Today's practice" : 'Pick up where you left off';

    document.getElementById('sdash-continue-title').textContent =
      isFreshDay ? `Today's first ${state.testName} session` : 'Continue practicing';

    let subText;
    const totalA = parseInt(journey.totalAnswered, 10) || 0;
    const totalC = parseInt(journey.totalCorrect, 10) || 0;
    const accuracy = totalA > 0 ? Math.round((totalC / totalA) * 100) : null;
    if (journey.lastSession && accuracy !== null) {
      subText = `Last session: ${accuracy}% accuracy. Keep building.`;
    } else if (isFreshDay) {
      subText = '15 minutes a day is the goal. Let\'s go.';
    } else {
      subText = `Aligned to ${state.testName} ${state.standards || 'state standards'}.`;
    }
    document.getElementById('sdash-continue-sub').textContent = subText;

    if (grade) {
      const ctaUrl = `practice.html?s=${encodeURIComponent(u.state)}&g=${encodeURIComponent(grade)}&subj=${encodeURIComponent(lastSubject)}`;
      document.getElementById('sdash-continue-cta').setAttribute('href', ctaUrl);
    } else {
      document.getElementById('sdash-continue-cta').setAttribute('href', `states/?s=${encodeURIComponent(u.state)}`);
    }

    document.getElementById('sdash-ctx-test').textContent = state.testName;
    document.getElementById('sdash-ctx-grade').textContent = readableGrade(grade);
  }

  function isFirstSessionToday(journey) {
    if (!journey.lastSession) return true;
    const last = new Date(journey.lastSession);
    const now = new Date();
    if (isNaN(last.getTime())) return true;
    return last.toDateString() !== now.toDateString();
  }

  function readableGrade(slug) {
    if (!slug) return '—';
    if (slug === 'grade-k') return 'K';
    if (slug === 'algebra-1') return 'Algebra 1';
    const m = String(slug).match(/grade-(\d+)/);
    return m ? `Grade ${m[1]}` : slug;
  }

  // ============================================================
  // STATS
  // ============================================================
  function renderStats(u) {
    const journey = readJourney(u.username);
    const totalA = parseInt(journey.totalAnswered, 10) || 0;
    const totalC = parseInt(journey.totalCorrect, 10) || 0;

    document.getElementById('sdash-stat-questions').textContent = formatNumber(totalA);
    document.getElementById('sdash-stat-accuracy').textContent =
      totalA > 0 ? Math.round((totalC / totalA) * 100) + '%' : '—';
    document.getElementById('sdash-stat-cents').textContent = formatNumber(u.balanceCents || 0);
    document.getElementById('sdash-stat-mastered').textContent =
      formatNumber(parseInt(journey.topicsMastered, 10) || 0);
  }

  function formatNumber(n) {
    n = Number(n) || 0;
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return String(n);
  }

  // ============================================================
  // PRACTICE AHEAD
  // ============================================================
  function renderPracticeAhead(u, state) {
    const grade = u.grade;
    const allGrades = state.gradesTested || [];
    if (!grade || !allGrades.length) return;

    const idx = allGrades.indexOf(grade);
    if (idx === -1) return;

    const aheadGrades = allGrades.slice(idx + 1, idx + 4);
    if (aheadGrades.length === 0) return;

    document.getElementById('sdash-ahead-test').textContent = state.testName;

    const list = document.getElementById('sdash-ahead-list');
    list.innerHTML = aheadGrades.map(g => `
      <a class="dashboard-grade-quick" href="grade.html?s=${encodeURIComponent(u.state)}&g=${encodeURIComponent(g)}">
        <span class="dashboard-grade-quick-name">${escapeHtml(readableGrade(g))}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </a>
    `).join('');
    document.getElementById('sdash-ahead').hidden = false;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============================================================
  // INIT + auth-changed listener
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('startest:auth-changed', init);
})();
