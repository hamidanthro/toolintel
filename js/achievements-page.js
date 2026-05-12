// GradeEarn — Achievements page renderer (achievements.html).

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function tierColor(tier) {
    return tier === 'diamond' ? '#a5f3fc'
         : tier === 'gold'    ? '#fcd34d'
         : tier === 'silver'  ? '#cbd5e1'
         : '#d4a574'; // bronze default
  }

  // §46 polish: shared coin SVG for muted reward chips on both the
  // daily-quest "all done" badge and per-trophy reward badges. Tiny
  // gold accent on a neutral chip — keeps reward visible without
  // adding a second gold flag per row.
  const COIN_SVG = '<svg class="reward-chip-coin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5h4.5a2 2 0 010 4H9.5a2 2 0 000 4H14"/></svg>';

  function buildTrophyCard(ach, earned, progress) {
    const cents = (ach.reward && ach.reward.cents) || 0;
    const tierStyle = `--trophy-tier-color: ${tierColor(ach.tier)};`;
    const progressBar = !earned && progress
      ? `<div class="trophy-progress"><div class="trophy-progress-bar" style="width:${progress.pct}%"></div><div class="trophy-progress-label">${progress.current} / ${progress.threshold}</div></div>`
      : '';
    const earnedClass = earned ? 'trophy-card--earned' : 'trophy-card--locked';
    const rewardLine = cents > 0
      ? `<div class="trophy-card-reward reward-chip">${COIN_SVG}<span>+${cents}¢</span></div>`
      : '';
    return `
      <div class="trophy-card ${earnedClass} trophy-card--${escapeHtml(ach.tier)}" style="${tierStyle}" data-trophy-id="${escapeHtml(ach.id)}">
        <div class="trophy-card-emoji" aria-hidden="true">${escapeHtml(ach.emoji)}</div>
        <div class="trophy-card-body">
          <div class="trophy-card-name">${escapeHtml(ach.name)}</div>
          <div class="trophy-card-desc">${escapeHtml(ach.description)}</div>
          ${progressBar}
        </div>
        ${rewardLine}
      </div>
    `;
  }

  // Updated for the multi-task daily-quest shape introduced in
  // commit 54f9c31. missionState now has { date, tasks: [{id, label,
  // emoji, target, current, done}], rewardCents, completed } —
  // NOT the old {target, current} shape. Renders one row per task
  // with its own progress bar.
  function renderDailyMission(missionState) {
    const root = document.getElementById('daily-mission-card');
    if (!root) return;
    if (!missionState || !Array.isArray(missionState.tasks) || missionState.tasks.length === 0) {
      // Defensive — old or corrupted state. Render a friendly empty message.
      root.innerHTML = `<div class="daily-mission daily-mission--inprogress">
        <div class="daily-mission-emoji" aria-hidden="true">🎯</div>
        <div class="daily-mission-text">
          <div class="daily-mission-title">Today's quest is loading…</div>
        </div>
      </div>`;
      return;
    }
    const reward = Number.isFinite(missionState.rewardCents) ? missionState.rewardCents : 0;
    if (missionState.completed) {
      root.innerHTML = `
        <div class="daily-mission daily-mission--complete">
          <div class="daily-mission-emoji" aria-hidden="true">✅</div>
          <div class="daily-mission-text">
            <div class="daily-mission-title">Today's quest complete!</div>
            <div class="daily-mission-sub">All 3 tasks done · +${reward}¢ bonus earned.</div>
          </div>
        </div>
      `;
      return;
    }
    const tasksHtml = missionState.tasks.map(t => {
      const pct = t.target > 0 ? Math.min(100, Math.round((t.current / t.target) * 100)) : 0;
      const doneCls = t.done ? 'dq-task--done' : '';
      return `<div class="dq-task ${doneCls}">
        <div class="dq-task-emoji" aria-hidden="true">${t.done ? '✅' : escapeHtml(t.emoji || '🎯')}</div>
        <div class="dq-task-body">
          <div class="dq-task-label">${escapeHtml(t.label || '')}</div>
          <div class="dq-task-progress"><div class="dq-task-progress-bar" style="width:${pct}%"></div></div>
          <div class="dq-task-sub">${t.current} / ${t.target}</div>
        </div>
      </div>`;
    }).join('');
    // §46 polish: outer "Today's quest" h2 in achievements.html now
    // serves as the section heading — the inner dq-head-title is
    // removed. The "+N¢ all done" reward becomes a muted chip with a
    // small gold coin icon (same pattern as +50 pts on Home).
    root.innerHTML = `
      <div class="daily-mission daily-mission--inprogress" style="display:block;">
        <div class="dq-head" style="margin-bottom:10px;">
          <div class="dq-head-spacer"></div>
          <div class="dq-head-reward reward-chip">${COIN_SVG}<span>+${reward}¢ all done</span></div>
        </div>
        <div class="dq-tasks">${tasksHtml}</div>
      </div>
    `;
  }

  async function init() {
    if (!window.Achievements) {
      console.warn('[ach-page] Achievements module not loaded');
      return;
    }
    const cat = await window.Achievements.getCatalog();
    const earnedIds = new Set(window.Achievements.getEarned());
    const stats = window.Achievements.getStats();

    // Hero subtitle
    const sub = document.getElementById('hero-sub');
    if (sub) {
      sub.textContent = earnedIds.size > 0
        ? `${earnedIds.size} of ${cat.length} trophies earned. Keep going.`
        : `${cat.length} trophies waiting for you. Earn your first by answering a question.`;
    }

    // Stats tiles
    document.getElementById('stat-earned').textContent = String(earnedIds.size);
    document.getElementById('stat-correct').textContent = String(stats.lifetimeCorrect || 0);
    document.getElementById('stat-streak').textContent = String(stats.loginStreak || 0);
    document.getElementById('stat-mastered').textContent = String(stats.topicsMastered || 0);

    // Daily mission — render now + re-render on cross-tab storage
    // updates (kid playing in another tab bumps task progress; this
    // card reflects it within seconds) AND on achievement unlocks.
    function refreshDailyMission() {
      try { renderDailyMission(window.Achievements.getDailyMissionState()); } catch (_) {}
    }
    refreshDailyMission();
    window.addEventListener('storage', (e) => {
      if (!e || !e.key) return;
      if (e.key.indexOf('gradeearn:achievements:dailyMission') === 0) refreshDailyMission();
    });
    if (window.Achievements.onUnlock) {
      window.Achievements.onUnlock(() => refreshDailyMission());
    }

    // Earned section
    const earnedAchs = cat.filter(a => earnedIds.has(a.id));
    const lockedAchs = cat.filter(a => !earnedIds.has(a.id));

    const earnedGrid = document.getElementById('earned-grid');
    const earnedSub = document.getElementById('earned-sub');
    if (earnedAchs.length === 0) {
      earnedSub.textContent = "You haven't earned any trophies yet. Answer a question correctly to earn your first.";
      earnedGrid.innerHTML = '';
    } else {
      earnedSub.textContent = `${earnedAchs.length} earned. Total cents from rewards: ${earnedAchs.reduce((s, a) => s + ((a.reward && a.reward.cents) || 0), 0)}¢.`;
      earnedGrid.innerHTML = earnedAchs.map(a => buildTrophyCard(a, true, null)).join('');
    }

    // Coming up next: 6 closest-to-completion locked achievements with progress
    const lockedWithProgress = await Promise.all(
      lockedAchs.map(async a => ({ a, p: await window.Achievements.getProgress(a.id) }))
    );
    const reachable = lockedWithProgress
      .filter(x => x.p && x.p.threshold > 0 && x.p.pct < 100)
      .sort((a, b) => b.p.pct - a.p.pct)
      .slice(0, 6);
    document.getElementById('locked-grid').innerHTML = reachable.map(x => buildTrophyCard(x.a, false, x.p)).join('');

    // All catalog (locked sub-section showing the rest)
    const remaining = lockedAchs.filter(a => !reachable.find(r => r.a.id === a.id));
    document.getElementById('catalog-grid').innerHTML = remaining.map(a => {
      // Skip rendering progress here — too noisy. Just show locked tile.
      return buildTrophyCard(a, false, null);
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
