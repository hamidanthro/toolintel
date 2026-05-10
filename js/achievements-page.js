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

  function buildTrophyCard(ach, earned, progress) {
    const cents = (ach.reward && ach.reward.cents) || 0;
    const tierStyle = `--trophy-tier-color: ${tierColor(ach.tier)};`;
    const progressBar = !earned && progress
      ? `<div class="trophy-progress"><div class="trophy-progress-bar" style="width:${progress.pct}%"></div><div class="trophy-progress-label">${progress.current} / ${progress.threshold}</div></div>`
      : '';
    const earnedClass = earned ? 'trophy-card--earned' : 'trophy-card--locked';
    const rewardLine = cents > 0
      ? `<div class="trophy-card-reward">+${cents}¢</div>`
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

  function renderDailyMission(missionState) {
    const root = document.getElementById('daily-mission-card');
    if (!root) return;
    if (missionState.completed) {
      root.innerHTML = `
        <div class="daily-mission daily-mission--complete">
          <div class="daily-mission-emoji" aria-hidden="true">✅</div>
          <div class="daily-mission-text">
            <div class="daily-mission-title">Today's mission complete!</div>
            <div class="daily-mission-sub">You answered ${missionState.target} correctly. +${missionState.rewardCents}¢ bonus earned.</div>
          </div>
        </div>
      `;
    } else {
      const pct = missionState.target ? Math.round((missionState.current / missionState.target) * 100) : 0;
      root.innerHTML = `
        <div class="daily-mission daily-mission--inprogress">
          <div class="daily-mission-emoji" aria-hidden="true">🎯</div>
          <div class="daily-mission-text">
            <div class="daily-mission-title">Answer ${missionState.target} questions correctly</div>
            <div class="daily-mission-sub">Progress: ${missionState.current} / ${missionState.target} · reward +${missionState.rewardCents}¢</div>
            <div class="daily-mission-progress"><div class="daily-mission-progress-bar" style="width:${pct}%"></div></div>
          </div>
        </div>
      `;
    }
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

    // Daily mission
    renderDailyMission(window.Achievements.getDailyMissionState());

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
