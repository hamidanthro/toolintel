/**
 * GradeEarn — friend league (committee redesign v4, May 11).
 *
 * Single render(data) → HTML pass. No mid-state mutation across
 * helpers. Heights, copy, countdown, invite affordances, tooltips
 * all derived from the same league payload.
 *
 * Backend contract (returned by handleFriendLeague):
 *   {
 *     league: [
 *       { username, displayName, grade, avatarEmoji, level, streak,
 *         lifetimeCorrect, weeklyCorrect, xp, isSelf, rank }
 *     ],
 *     count
 *   }
 * Streak is `loginStreak` server-side. If a field is missing,
 * placeholders + a TODO comment flag the gap.
 */
(function () {
  'use strict';

  const STORE_PREV  = 'gradeearn:league:prev-snapshot';
  const STORE_TODAY = 'gradeearn:league:today-snapshot';

  // ============================================================
  // DOM handles
  // ============================================================
  const podiumEl   = document.getElementById('league-podium');
  const youCardEl  = document.getElementById('league-you-card');
  const listEl     = document.getElementById('league-list');
  const footEl     = document.getElementById('league-foot');
  const footLife   = document.getElementById('league-foot-lifetime');
  const bannerEl   = document.getElementById('league-requests-banner');
  const bannerTxt  = document.getElementById('league-requests-banner-text');
  const bannerBtn  = document.getElementById('league-banner-open');
  const manageRow  = document.getElementById('league-manage-row');
  const manageBtn  = document.getElementById('btn-manage-friends');
  const sheetEl    = document.getElementById('league-sheet');
  const sheetBack  = document.getElementById('league-sheet-backdrop');
  const sheetBody  = document.getElementById('league-sheet-body');
  const sheetClose = document.getElementById('league-sheet-close');
  const countdownEl= document.getElementById('leagueResetCountdown');
  const toastEl    = document.getElementById('league-toast');

  if (!podiumEl || !listEl) return;

  // ============================================================
  // utils
  // ============================================================
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function gradeIsG3Plus(grade) {
    if (!grade) return false;
    const m = String(grade).match(/grade-(\d+)/);
    if (!m) return false;
    return parseInt(m[1], 10) >= 3;
  }
  function gradeFullLabel(slug) {
    if (!slug) return 'Grade not set';
    if (slug === 'grade-k') return 'Kindergarten';
    const m = String(slug).match(/grade-(\d+)/);
    if (m) return `Grade ${m[1]}`;
    if (slug === 'algebra-1') return 'Algebra 1';
    return slug;
  }
  function token() {
    try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; }
  }
  async function api(action, payload) {
    return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {}));
  }
  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    setTimeout(() => { toastEl.hidden = true; }, ms || 2200);
  }

  // Hash-based avatar gradient when the kid hasn't set an emoji
  const AVATAR_COLORS = [
    'linear-gradient(135deg, #fbbf24, #f97316)',
    'linear-gradient(135deg, #60a5fa, #3b82f6)',
    'linear-gradient(135deg, #34d399, #10b981)',
    'linear-gradient(135deg, #f472b6, #ec4899)',
    'linear-gradient(135deg, #a78bfa, #8b5cf6)',
    'linear-gradient(135deg, #fb7185, #ef4444)',
    'linear-gradient(135deg, #fbbf24, #d97706)',
    'linear-gradient(135deg, #38bdf8, #0ea5e9)'
  ];
  function colorForUsername(u) {
    if (!u) return AVATAR_COLORS[0];
    let h = 0;
    for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  // Avatar with data-avatar-url placeholder. TODO(lambda): handleFriendLeague
  // could return avatarUrl in addition to avatarEmoji once profile-image
  // upload exists; for now the URL is empty and we fall back to emoji
  // or initial-letter.
  function avatarHtml(row, size, avatarUrl) {
    const url = avatarUrl || '';
    const has = !!row.avatarEmoji;
    const content = has ? row.avatarEmoji : ((row.displayName || row.username || '?').charAt(0).toUpperCase());
    const bg = has ? '' : ` style="background:${colorForUsername(row.username)};"`;
    const cls = has ? 'league-av league-av--emoji' : 'league-av league-av--letter';
    const sz = size ? ` league-av--${size}` : '';
    const imgFallback = url
      ? `<img class="league-av-img" src="${esc(url)}" alt="" />`
      : esc(content);
    return `<span class="${cls}${sz}" data-avatar-url="${esc(url)}"${bg} aria-hidden="true">${imgFallback}</span>`;
  }

  // ============================================================
  // movement arrows (day-over-day rank delta)
  // ============================================================
  function loadPrev()  { try { return JSON.parse(localStorage.getItem(STORE_PREV)  || 'null'); } catch (_) { return null; } }
  function loadToday() { try { return JSON.parse(localStorage.getItem(STORE_TODAY) || 'null'); } catch (_) { return null; } }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function persistSnapshot(rows) {
    try {
      const today = todayISO();
      const t = loadToday();
      if (t && t.date && t.date !== today) {
        localStorage.setItem(STORE_PREV, JSON.stringify(t));
      }
      const snap = { date: today, ranks: rows.reduce((acc, r) => { acc[r.username] = r.rank; return acc; }, {}) };
      localStorage.setItem(STORE_TODAY, JSON.stringify(snap));
    } catch (_) {}
  }
  function rankDelta(username, currentRank) {
    const prev = loadPrev();
    if (!prev || !prev.ranks || !(username in prev.ranks)) return null;
    return prev.ranks[username] - currentRank;
  }
  function movementHtml(username, currentRank) {
    const d = rankDelta(username, currentRank);
    if (d === null) return '<span class="league-mv league-mv--new" title="New this period">NEW</span>';
    if (d > 0)  return `<span class="league-mv league-mv--up"   title="Up ${d}">▲${d}</span>`;
    if (d < 0)  return `<span class="league-mv league-mv--down" title="Down ${-d}">▼${-d}</span>`;
    return '<span class="league-mv league-mv--same" title="No change">—</span>';
  }

  // ============================================================
  // T3.1 — countdown to next reset
  // Reset cadence: next Monday 00:00 LOCAL time. CLAUDE.md notes the
  // weekly cron isn't built yet (rolling 7-day window today) — when
  // the lambda cron lands, swap this to read serverResetAt from the
  // payload. TODO(lambda): handleFriendLeague should return
  // resetAtMs once weekly-period table exists.
  // ============================================================
  function nextResetDate() {
    const now = new Date();
    const dow = now.getDay(); // 0=Sun .. 6=Sat
    let daysUntilMon = (8 - dow) % 7; // 0..6
    if (daysUntilMon === 0) daysUntilMon = 7; // Monday → next Monday
    const r = new Date(now);
    r.setDate(now.getDate() + daysUntilMon);
    r.setHours(0, 0, 0, 0);
    return r;
  }
  function formatCountdown(ms) {
    if (ms <= 0) return 'Now';
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins  = Math.floor((ms % 3600000) / 60000);
    const secs  = Math.floor((ms % 60000) / 1000);
    if (ms > 86400000) return `${days}d ${hours}h`;
    if (ms > 3600000)  return `${hours}h ${mins}m`;
    if (ms > 60000)    return `${mins}m ${secs}s`;
    return `${secs}s`;
  }
  let _countdownTimer = null;
  function startCountdown() {
    if (!countdownEl) return;
    const tick = () => {
      const remaining = nextResetDate() - new Date();
      countdownEl.textContent = formatCountdown(remaining);
      // <2h urgency
      countdownEl.classList.toggle('league-eyebrow-countdown--urgent', remaining < 7200000 && remaining > 0);
    };
    tick();
    // Update every second when <1h (so the s ticks visibly), else every 60s.
    if (_countdownTimer) clearInterval(_countdownTimer);
    const remaining = nextResetDate() - new Date();
    _countdownTimer = setInterval(tick, remaining < 3600000 ? 1000 : 60000);
  }

  // ============================================================
  // bottom sheet
  // ============================================================
  function openSheet(initialTab) {
    sheetEl.hidden = false;
    document.body.classList.add('league-sheet-open');
    renderSheet(initialTab || 'add');
  }
  function closeSheet() {
    sheetEl.hidden = true;
    document.body.classList.remove('league-sheet-open');
  }
  if (sheetBack)  sheetBack.addEventListener('click', closeSheet);
  if (sheetClose) sheetClose.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheetEl.hidden) closeSheet(); });
  if (bannerBtn) bannerBtn.addEventListener('click', () => openSheet('requests'));
  if (manageBtn) manageBtn.addEventListener('click', () => openSheet('friends'));

  // ============================================================
  // INVITE actions — Share / Contacts fallback
  // ============================================================
  async function inviteShareLink() {
    const me = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
    const u = (me && me.username) || '';
    const url = 'https://gradeearn.com/?invite=' + encodeURIComponent(u);
    const text = `Add me on GradeEarn — username: ${u}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'GradeEarn invite', text, url });
        return;
      } catch (_) { /* user cancelled — silent */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied!');
    } catch (_) {
      toast('Tap and hold the link to copy.');
    }
  }
  function inviteFromContacts() {
    // TODO(lambda): future — wire to Contact Picker API where supported
    // OR a server-side address-book lookup for parent-confirmed contacts.
    toast('Coming soon — for now use Share Link.');
  }

  // ============================================================
  // render — single pass dispatcher
  // ============================================================
  function render() {
    const r = cache.league;
    if (!r) {
      podiumEl.innerHTML = `<div class="card" style="max-width:680px;padding:20px;color:rgba(255,255,255,0.55);">Loading…</div>`;
      return;
    }
    const rows = (r.league || []);
    if (rows.length === 0 || (rows.length === 1 && rows[0].isSelf)) {
      renderEmpty();
      return;
    }
    rows.forEach(row => { row._totalCount = rows.length; });
    persistSnapshot(rows);

    renderPodium(rows);
    renderYouCard(rows);
    renderList(rows);
    renderRequestsBanner(cache.friendList);
    renderManageRow(rows);
    renderFoot(rows);
  }

  function renderEmpty() {
    podiumEl.innerHTML = `
      <div class="league-empty">
        <div class="league-empty-emoji" aria-hidden="true">👋</div>
        <h2 class="league-empty-title">No friends yet</h2>
        <p class="league-empty-sub">Add a friend to start your league. They'll see your rank and you'll see theirs — friendly competition that keeps everyone practicing.</p>
        <button type="button" class="btn btn-primary" data-go-add>Add your first friend</button>
      </div>`;
    listEl.innerHTML = '';
    youCardEl.hidden = true;
    if (footEl) footEl.hidden = true;
    if (manageRow) manageRow.hidden = true;
    const btn = podiumEl.querySelector('[data-go-add]');
    if (btn) btn.addEventListener('click', () => openSheet('add'));
  }

  // ============================================================
  // T1 + T2 — podium with real geometry
  //
  // Layout order in DOM: slot2 (left, 2nd, medium), slot1 (center, 1st,
  // tall), slot3 (right, 3rd, short). align-end so the bottoms line up
  // and the gold 1st-place card rises above the others.
  //
  // Rules per spec:
  //   - Medal emoji ONLY when row.weeklyCorrect > 0 AND the rank is
  //     real (rank 1/2/3 with positive points).
  //   - Crown 👑 ONLY on rank 1 with points > 0.
  //   - User's card layered on top: gold border + "YOU" badge wherever
  //     their rank lands — both work simultaneously (1st-tallest AND
  //     gold-bordered if user is winning).
  // ============================================================
  function rankLabel(n) {
    if (n === 1) return '1st place';
    if (n === 2) return '2nd place';
    if (n === 3) return '3rd place';
    return `${n}th place`;
  }
  function rankShort(n) {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return `${n}th`;
  }
  function podiumCard(row, slot /* 1 | 2 | 3 */) {
    if (!row) {
      // Empty card body differs depending on which slot is empty.
      // Right (slot 3) is the typical empty case — render invite UI.
      if (slot === 3) return inviteCardHtml();
      // Left or center empty → quiet placeholder
      return `
        <div class="podium-card podium-card--empty" data-slot="${slot}" aria-hidden="true">
          <div class="podium-empty-plus">+</div>
          <div class="podium-empty-label">Empty</div>
        </div>`;
    }
    const youCls = row.isSelf ? ' is-self' : '';
    const tier   = slot === 1 ? 'gold' : slot === 2 ? 'silver' : 'bronze';
    const earnedMedal = row.weeklyCorrect > 0;
    const medal  = earnedMedal
      ? (slot === 1 ? '👑' : slot === 2 ? '🥈' : '🥉')
      : '';
    const fullGrade = row.grade ? esc(gradeFullLabel(row.grade)) : 'Grade not set';
    const youBadge = row.isSelf ? '<span class="league-you-chip">YOU</span>' : '';
    const streak = row.streak > 1
      ? `<span class="podium-streak${row.streak >= 3 ? ' is-hot' : ''}" title="Practice in a row to keep your streak">🔥 ${row.streak}d</span>`
      : '';
    const rankBadge = earnedMedal
      ? `<div class="podium-medal" aria-hidden="true">${medal}</div>`
      : `<div class="podium-rank-text">${rankShort(slot)}</div>`;
    return `
      <article class="podium-card podium-card--${tier}${youCls}" data-slot="${slot}" data-username="${esc(row.username)}">
        ${rankBadge}
        ${avatarHtml(row, 'lg')}
        <div class="podium-name">${esc(row.displayName)}${youBadge}</div>
        <div class="podium-grade-line" title="${fullGrade}">${fullGrade}</div>
        <div class="podium-stat">
          <span class="podium-stat-num">${row.weeklyCorrect}</span>
          <span class="podium-stat-label">this week</span>
        </div>
        <div class="podium-foot">
          <span class="podium-level" title="Level ${row.level} — earn correct answers to level up">Level ${row.level}</span>
          ${streak}
        </div>
      </article>`;
  }
  function inviteCardHtml() {
    return `
      <article class="podium-card podium-card--invite" data-slot="3">
        <div class="podium-invite-plus" aria-hidden="true">+</div>
        <div class="podium-invite-title">Invite a friend</div>
        <p class="podium-invite-sub">Fill the podium to start a race.</p>
        <div class="podium-invite-actions">
          <button type="button" class="podium-invite-btn podium-invite-btn--primary" data-invite-share>Share link</button>
          <button type="button" class="podium-invite-btn" data-invite-contacts>From contacts</button>
        </div>
      </article>`;
  }
  function renderPodium(rows) {
    const top3 = rows.slice(0, 3);
    // Visual order: slot 2 (left), slot 1 (center, raised), slot 3 (right)
    const slot1 = top3[0] || null;
    const slot2 = top3[1] || null;
    const slot3 = top3[2] || null;
    podiumEl.innerHTML = `
      <div class="league-podium-row">
        ${podiumCard(slot2, 2)}
        ${podiumCard(slot1, 1)}
        ${podiumCard(slot3, 3)}
      </div>`;
    // Wire invite buttons (if invite card is present)
    const shareBtn = podiumEl.querySelector('[data-invite-share]');
    if (shareBtn) shareBtn.addEventListener('click', inviteShareLink);
    const contBtn = podiumEl.querySelector('[data-invite-contacts]');
    if (contBtn) contBtn.addEventListener('click', inviteFromContacts);
  }

  // ============================================================
  // T2 — fill the YOU card (only shown when kid isn't in podium)
  // ============================================================
  function renderYouCard(rows) {
    const me = rows.find(r => r.isSelf);
    if (!me) { youCardEl.hidden = true; return; }

    // If kid is in podium, the podium card already shows YOU.
    if (me.rank <= 3) { youCardEl.hidden = true; return; }

    const above = rows.find(r => r.rank === me.rank - 1);
    const gap = above ? Math.max(0, (above.weeklyCorrect || 0) - (me.weeklyCorrect || 0)) : 0;
    const climbCopy = above
      ? `<strong>${gap}</strong> ${gap === 1 ? 'point' : 'points'} to overtake <span class="you-card-target">${esc(above.displayName)}</span>`
      : `In the lead 💪 — stay sharp to hold #1.`;
    const myGrade = me.grade ? esc(gradeFullLabel(me.grade)) : 'Grade not set';
    const streakHtml = me.streak > 1
      ? `<span class="you-card-streak${me.streak >= 3 ? ' is-hot' : ''}" title="Practice in a row to keep your streak">🔥 ${me.streak}d streak</span>`
      : '<span class="you-card-streak you-card-streak--cold">Start a streak today</span>';

    youCardEl.innerHTML = `
      <div class="you-card-rank-block">
        <div class="you-card-rank">#${me.rank}</div>
        <div class="you-card-rank-label">Rank ${me.rank} of ${rows.length}</div>
      </div>
      ${avatarHtml(me, 'md')}
      <div class="you-card-body">
        <div class="you-card-name">
          ${esc(me.displayName)}
          <span class="league-you-chip">YOU</span>
          <span class="you-card-grade" title="Grade ${me.grade || 'not set'}">${myGrade}</span>
        </div>
        <div class="you-card-copy">${climbCopy}</div>
        <div class="you-card-meta">
          <span class="you-card-level" title="Level ${me.level} — earn correct answers to level up">Level ${me.level}</span>
          ${streakHtml}
        </div>
      </div>
      <a class="you-card-cta" href="practice.html">Practice →</a>`;
    youCardEl.hidden = false;
  }

  // ============================================================
  // list rows (rank 4+)
  // ============================================================
  function renderList(rows) {
    const rest = rows.slice(3);
    if (rest.length === 0) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = rest.map(row => {
      const total = row._totalCount || 0;
      const youCls = row.isSelf ? ' is-self' : '';
      const zoneCls = (total >= 6 && row.rank <= Math.ceil(total * 0.4)) ? ' zone-up'
                    : (total >= 8 && row.rank > total - Math.ceil(total * 0.25)) ? ' zone-down'
                    : '';
      const fullGrade = row.grade ? esc(gradeFullLabel(row.grade)) : 'Grade not set';
      const lifetime = (row.lifetimeCorrect || 0).toLocaleString();
      return `
        <div class="league-row${youCls}${zoneCls}" data-username="${esc(row.username)}">
          <div class="league-row-rank">
            <span class="league-rank-num">${row.rank}</span>
            ${movementHtml(row.username, row.rank)}
          </div>
          ${avatarHtml(row, 'md')}
          <div class="league-row-identity">
            <div class="league-row-name">
              <span class="league-name-text">${esc(row.displayName)}</span>
              ${row.isSelf ? '<span class="league-you-chip">YOU</span>' : ''}
              <span class="league-row-grade" title="Grade ${row.grade || 'not set'}">${fullGrade}</span>
            </div>
            <div class="league-row-meta">
              <span class="league-row-week">+${row.weeklyCorrect} this week</span>
              <span class="league-row-life">· ${lifetime} all-time</span>
              ${row.streak > 1 ? `<span class="league-row-streak${row.streak >= 3 ? ' is-hot' : ''}" title="Practice in a row to keep your streak">· 🔥 ${row.streak}d</span>` : ''}
            </div>
          </div>
          <div class="league-row-level" title="Level ${row.level} — earn correct answers to level up">L${row.level}</div>
        </div>`;
    }).join('');
  }

  // ============================================================
  // banner + manage row + foot
  // ============================================================
  function renderRequestsBanner(fl) {
    const incoming = (fl && Array.isArray(fl.incoming)) ? fl.incoming : [];
    if (incoming.length === 0) { bannerEl.hidden = true; return; }
    const n = incoming.length;
    const who = incoming.slice(0, 2).map(r => r.displayName || r.peer).join(', ');
    const more = n > 2 ? ` and ${n - 2} more` : '';
    bannerTxt.textContent = `${who}${more} ${n === 1 ? 'wants' : 'want'} to be your friend.`;
    bannerEl.hidden = false;
  }
  function renderManageRow(rows) {
    // Show "Manage friends ›" when there are ≥1 accepted friends
    // (so the kid has someone to unfriend / see online status of)
    // OR pending in/out requests. Replaces the duplicate "+ Add friend"
    // button — banner CTAs cover the empty-podium path; this covers
    // the full-league management path.
    const fl = cache.friendList || {};
    const total = (fl.friends || []).length + (fl.incoming || []).length + (fl.outgoing || []).length;
    if (manageRow) manageRow.hidden = total === 0;
  }
  function renderFoot(rows) {
    if (!footEl) return;
    const me = rows.find(r => r.isSelf);
    if (footLife) {
      footLife.textContent = me
        ? `Your lifetime: ${me.lifetimeCorrect.toLocaleString()} correct.`
        : '';
    }
    footEl.hidden = false;
  }

  // ============================================================
  // bottom-sheet render (Add / Requests / Friends)
  // ============================================================
  function renderSheet(activeTab) {
    const fl = cache.friendList || { friends: [], incoming: [], outgoing: [] };
    const me = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
    const myUsername = (me && me.username) || '';
    sheetBody.innerHTML = `
      <div class="league-sheet-tabs">
        <button type="button" class="league-sheet-tab" data-sheet-tab="add">Add friend</button>
        <button type="button" class="league-sheet-tab" data-sheet-tab="requests">
          Requests${fl.incoming.length > 0 ? `<span class="league-sheet-tab-dot">${fl.incoming.length}</span>` : ''}
        </button>
        <button type="button" class="league-sheet-tab" data-sheet-tab="friends">Friends (${fl.friends.length})</button>
      </div>
      <div id="league-sheet-content"></div>`;
    sheetBody.querySelectorAll('.league-sheet-tab').forEach(b => {
      b.classList.toggle('league-sheet-tab--active', b.getAttribute('data-sheet-tab') === activeTab);
      b.addEventListener('click', () => renderSheet(b.getAttribute('data-sheet-tab')));
    });
    const content = document.getElementById('league-sheet-content');
    if (activeTab === 'add')      content.innerHTML = renderAddTabHtml(myUsername);
    else if (activeTab === 'requests') content.innerHTML = renderRequestsTabHtml(fl);
    else                          content.innerHTML = renderFriendsTabHtml(fl);
    wireSheet(content, activeTab, myUsername);
  }
  function renderAddTabHtml(myUsername) {
    return `
      <form class="league-add-form" id="league-add-form" autocomplete="off">
        <label class="league-add-label" for="league-add-input">Friend's username</label>
        <div class="league-add-row">
          <input type="text" id="league-add-input" class="league-add-input" placeholder="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" required />
          <button type="submit" class="btn btn-primary league-add-btn">Send</button>
        </div>
        <p class="league-add-hint">Lowercase letters, numbers, underscores, dots, dashes.</p>
        <p class="league-add-status" id="league-add-status"></p>
      </form>
      <div class="league-share">
        <div class="league-share-label">Your username — share so friends can add you</div>
        <div class="league-share-row">
          <code class="league-share-code">${esc(myUsername || '— sign in —')}</code>
          <button type="button" class="btn btn-secondary league-share-copy" data-copy="${esc(myUsername)}" ${myUsername ? '' : 'disabled'}>Copy</button>
        </div>
      </div>`;
  }
  function renderRequestsTabHtml(fl) {
    const incoming = fl.incoming || [];
    const outgoing = fl.outgoing || [];
    const incomingHtml = incoming.length === 0 ? `<p class="league-section-empty">No incoming requests.</p>`
      : incoming.map(row => `
        <div class="league-req-row" data-username="${esc(row.peer)}">
          ${avatarHtml({ displayName: row.displayName || row.peer, username: row.peer, avatarEmoji: row.avatarEmoji || null }, 'sm')}
          <div class="league-identity">
            <div class="league-name">${esc(row.displayName || row.peer)}</div>
            <div class="league-meta-thin">@${esc(row.peer)}</div>
          </div>
          <div class="league-req-actions">
            <button type="button" class="btn btn-primary league-req-accept" data-target="${esc(row.peer)}">Accept</button>
            <button type="button" class="btn btn-secondary league-req-decline" data-target="${esc(row.peer)}">Decline</button>
          </div>
        </div>`).join('');
    const outgoingHtml = outgoing.length === 0 ? `<p class="league-section-empty">No outgoing requests waiting.</p>`
      : outgoing.map(row => `
        <div class="league-req-row league-req-row--out" data-username="${esc(row.peer)}">
          ${avatarHtml({ displayName: row.displayName || row.peer, username: row.peer, avatarEmoji: null }, 'sm')}
          <div class="league-identity">
            <div class="league-name">${esc(row.displayName || row.peer)}</div>
            <div class="league-meta-thin">Waiting for them to accept</div>
          </div>
          <button type="button" class="btn btn-secondary league-req-cancel" data-target="${esc(row.peer)}">Cancel</button>
        </div>`).join('');
    return `
      <section class="league-section">
        <h3 class="league-section-title">Incoming <span class="league-section-count">${incoming.length}</span></h3>
        ${incomingHtml}
      </section>
      <section class="league-section">
        <h3 class="league-section-title">Outgoing <span class="league-section-count">${outgoing.length}</span></h3>
        ${outgoingHtml}
      </section>`;
  }
  function renderFriendsTabHtml(fl) {
    const accepted = fl.friends || [];
    if (accepted.length === 0) return `<p class="league-section-empty">No friends yet. Add some on the Add tab!</p>`;
    return accepted.map(row => `
      <div class="league-friend-row" data-username="${esc(row.peer)}">
        ${avatarHtml({ displayName: row.displayName || row.peer, username: row.peer, avatarEmoji: null }, 'sm')}
        <div class="league-identity">
          <div class="league-name">${esc(row.displayName || row.peer)} ${row.online ? '<span class="league-online-dot" title="Online"></span>' : ''}</div>
          <div class="league-meta-thin">@${esc(row.peer)}</div>
        </div>
        <button type="button" class="league-friend-remove" data-target="${esc(row.peer)}">Unfriend</button>
      </div>`).join('');
  }
  function wireSheet(content, activeTab, myUsername) {
    const form = content.querySelector('#league-add-form');
    if (form) {
      const input = content.querySelector('#league-add-input');
      const status = content.querySelector('#league-add-status');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const target = (input.value || '').trim().toLowerCase();
        if (!target) return;
        if (target === myUsername.toLowerCase()) {
          status.textContent = "That's your own username!"; status.className = 'league-add-status league-add-status--err'; return;
        }
        status.textContent = 'Sending…'; status.className = 'league-add-status';
        try {
          const r = await api('friendRequest', { target });
          if (r && r.status === 'accepted') {
            status.textContent = "You're now friends!"; status.className = 'league-add-status league-add-status--ok';
            input.value = '';
            await Promise.all([loadLeague(), loadFriendList()]);
            render();
          } else if (r && r.status === 'pending_out') {
            status.textContent = `Request sent to @${target}.`; status.className = 'league-add-status league-add-status--ok';
            input.value = '';
            await loadFriendList();
            renderRequestsBanner(cache.friendList); renderSheet('add');
          } else if (r && r.error) {
            status.textContent = r.error; status.className = 'league-add-status league-add-status--err';
          }
        } catch (err) {
          status.textContent = (err && err.message) || 'User not found.'; status.className = 'league-add-status league-add-status--err';
        }
      });
    }
    const copyBtn = content.querySelector('.league-share-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const val = copyBtn.getAttribute('data-copy') || ''; if (!val) return;
        try { await navigator.clipboard.writeText(val); copyBtn.textContent = 'Copied ✓'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800); } catch (_) {}
      });
    }
    content.querySelectorAll('.league-req-accept').forEach(b => {
      b.addEventListener('click', async () => {
        const target = b.getAttribute('data-target'); b.disabled = true;
        try { await api('friendRespond', { target, decision: 'accept' }); } catch (_) {}
        await Promise.all([loadLeague(), loadFriendList()]);
        render(); renderSheet('requests');
      });
    });
    content.querySelectorAll('.league-req-decline, .league-req-cancel, .league-friend-remove').forEach(b => {
      b.addEventListener('click', async () => {
        const target = b.getAttribute('data-target');
        const isUnfriend = b.classList.contains('league-friend-remove');
        if (isUnfriend && !confirm(`Unfriend ${target}?`)) return;
        b.disabled = true;
        try {
          if (b.classList.contains('league-req-decline')) await api('friendRespond', { target, decision: 'decline' });
          else await api('friendUnfriend', { target });
        } catch (_) {}
        await Promise.all([loadLeague(), loadFriendList()]);
        render(); renderSheet(activeTab === 'friends' ? 'friends' : 'requests');
      });
    });
  }

  // ============================================================
  // locked / error
  // ============================================================
  function renderLocked() {
    podiumEl.innerHTML = `
      <div class="league-empty">
        <div class="league-empty-emoji" aria-hidden="true">🔒</div>
        <h2 class="league-empty-title">Friend leagues unlock in Grade 3</h2>
        <p class="league-empty-sub">Younger kids practice on their own pace. Once your kid is Grade 3 or above, friend leagues + weekly rankings unlock automatically.</p>
        <a class="btn btn-primary" href="index.html">Back to dashboard</a>
      </div>`;
    listEl.innerHTML = '';
    youCardEl.hidden = true;
    if (footEl) footEl.hidden = true;
    if (manageRow) manageRow.hidden = true;
  }
  function renderError(msg) {
    podiumEl.innerHTML = `<div class="card" style="max-width:680px;padding:24px;margin:18px auto;color:rgba(255,255,255,0.65);">${esc(msg)}</div>`;
    listEl.innerHTML = '';
  }

  // ============================================================
  // data + boot
  // ============================================================
  const cache = { league: null, friendList: null };
  async function loadLeague() {
    try { cache.league = await api('friendLeague', {}); }
    catch (_) { cache.league = { league: [], count: 0 }; }
  }
  async function loadFriendList() {
    try { cache.friendList = await api('friendList', {}); }
    catch (_) { cache.friendList = { friends: [], incoming: [], outgoing: [] }; }
  }
  async function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser) { renderError('Please sign in first.'); return; }
    const me = window.STAARAuth.currentUser();
    if (!me) { renderError('Please sign in first.'); return; }
    if (!gradeIsG3Plus(me.grade)) { renderLocked(); return; }
    startCountdown();
    await Promise.all([loadLeague(), loadFriendList()]);
    render();
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await Promise.all([loadLeague(), loadFriendList()]);
        render();
      }
    });
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
    boot();
  } else {
    document.addEventListener('gradeearn:auth-changed', boot, { once: true });
    setTimeout(() => { if (!cache.league) boot(); }, 600);
  }
})();
