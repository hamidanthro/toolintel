/**
 * GradeEarn — friend league page (v3, May 11 committee redesign).
 *
 * Layout:
 *   - Eyebrow:    "THIS WEEK · Resets in X days" + Add Friend pill
 *   - Banner:     pending incoming requests (non-blocking)
 *   - Podium:     top-3 silhouette/avatar cards (when ≥3 ranked rows)
 *   - You-card:   "You're #N · M correct from next rank" when kid isn't podium
 *   - List:       remaining ranks 4+ (or all rows if <3) with movement arrows
 *
 * Bottom sheet (opened by Add Friend pill OR Review banner) holds
 *   - Add friend form + share-code
 *   - Incoming / outgoing / friends-list with Accept/Decline/Unfriend
 *
 * Movement arrows are computed locally from a per-kid snapshot stored
 * in localStorage. Each successful league load updates today's snapshot;
 * the previous-day snapshot becomes the comparison base.
 *
 * Server returns weeklyCorrect (last 7d) so rank order is by THIS WEEK,
 * not lifetime. Lifetime correct is shown as secondary stat.
 */
(function () {
  'use strict';

  const STORE_PREV = 'gradeearn:league:prev-snapshot';
  const STORE_TODAY = 'gradeearn:league:today-snapshot';

  const podiumEl   = document.getElementById('league-podium');
  const youCardEl  = document.getElementById('league-you-card');
  const listEl     = document.getElementById('league-list');
  const footEl     = document.getElementById('league-foot');
  const bannerEl   = document.getElementById('league-requests-banner');
  const bannerTxt  = document.getElementById('league-requests-banner-text');
  const bannerBtn  = document.getElementById('league-banner-open');
  const addBtn     = document.getElementById('btn-add-friend');
  const sheetEl    = document.getElementById('league-sheet');
  const sheetBack  = document.getElementById('league-sheet-backdrop');
  const sheetBody  = document.getElementById('league-sheet-body');
  const sheetClose = document.getElementById('league-sheet-close');
  const weekLabel    = document.getElementById('league-week-label');
  const weekCountdwn = document.getElementById('league-week-countdown');

  if (!podiumEl || !listEl) return;

  // ---------- helpers ----------
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
  function gradeLabel(slug) {
    if (!slug) return '';
    if (slug === 'grade-k') return 'K';
    const m = String(slug).match(/grade-(\d+)/);
    if (m) return 'G' + m[1];
    if (slug === 'algebra-1') return 'Alg 1';
    return slug;
  }
  function token() {
    try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; }
  }
  async function api(action, payload) {
    return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {}));
  }

  // Color a kid's avatar background from their username hash so the
  // fallback initial-letter doesn't render as bland gray on every row.
  const AVATAR_COLORS = [
    'linear-gradient(135deg, #fbbf24, #f97316)', // amber
    'linear-gradient(135deg, #60a5fa, #3b82f6)', // blue
    'linear-gradient(135deg, #34d399, #10b981)', // green
    'linear-gradient(135deg, #f472b6, #ec4899)', // pink
    'linear-gradient(135deg, #a78bfa, #8b5cf6)', // purple
    'linear-gradient(135deg, #fb7185, #ef4444)', // red-rose
    'linear-gradient(135deg, #fbbf24, #d97706)', // gold
    'linear-gradient(135deg, #38bdf8, #0ea5e9)'  // sky
  ];
  function colorForUsername(u) {
    if (!u) return AVATAR_COLORS[0];
    let h = 0;
    for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function avatarHtml(row, size) {
    const has = !!row.avatarEmoji;
    const content = has ? row.avatarEmoji : ((row.displayName || row.username || '?').charAt(0).toUpperCase());
    const bg = has ? '' : ` style="background:${colorForUsername(row.username)};"`;
    const cls = has ? 'league-av league-av--emoji' : 'league-av league-av--letter';
    const sz = size ? ` league-av--${size}` : '';
    return `<span class="${cls}${sz}"${bg} aria-hidden="true">${esc(content)}</span>`;
  }

  // ---------- weekly framing ----------
  function setWeekCountdown() {
    // ISO week resets Monday 00:00 in the kid's local time (close enough
    // to Central for Texas). Show "Resets Monday" or "Resets in N days".
    const now = new Date();
    const dow = now.getDay(); // 0=Sun, 1=Mon, ...
    let daysUntilMon = (8 - dow) % 7;
    if (daysUntilMon === 0) daysUntilMon = 7;
    let copy;
    if (daysUntilMon === 1) copy = 'Resets tomorrow';
    else if (daysUntilMon === 7) copy = 'Just started';
    else copy = `Resets in ${daysUntilMon} days`;
    if (weekCountdwn) weekCountdwn.textContent = '· ' + copy;
  }

  // ---------- movement arrow ----------
  function loadPrev() {
    try {
      const raw = localStorage.getItem(STORE_PREV);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function loadToday() {
    try {
      const raw = localStorage.getItem(STORE_TODAY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function persistSnapshot(rows) {
    // If "today" snapshot is from a previous date, roll it into "prev"
    // first so we have a real day-over-day comparison.
    try {
      const today = todayISO();
      const t = loadToday();
      if (t && t.date && t.date !== today) {
        localStorage.setItem(STORE_PREV, JSON.stringify(t));
      }
      const snap = {
        date: today,
        ranks: rows.reduce((acc, r) => { acc[r.username] = r.rank; return acc; }, {})
      };
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

  // ---------- standings render ----------
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
    footEl.hidden = true;
    const btn = podiumEl.querySelector('[data-go-add]');
    if (btn) btn.addEventListener('click', openAddFriend);
  }

  function podiumCard(row, slot /* 1 | 2 | 3 */) {
    const youCls = row.isSelf ? ' is-self' : '';
    const tier   = slot === 1 ? 'gold' : slot === 2 ? 'silver' : 'bronze';
    const medal  = slot === 1 ? '👑'   : slot === 2 ? '🥈'      : '🥉';
    const name   = esc(row.displayName);
    const grade  = row.grade ? `<span class="podium-grade">${esc(gradeLabel(row.grade))}</span>` : '';
    return `
      <div class="podium-card podium-card--${tier}${youCls}" data-slot="${slot}">
        <div class="podium-medal" aria-hidden="true">${medal}</div>
        ${avatarHtml(row, 'lg')}
        <div class="podium-name">${name}${row.isSelf ? '<span class="league-you-chip">you</span>' : ''}</div>
        <div class="podium-stat">
          <span class="podium-stat-num">${row.weeklyCorrect}</span>
          <span class="podium-stat-label">this week</span>
        </div>
        <div class="podium-foot">${grade} · L${row.level}</div>
      </div>`;
  }

  function renderPodium(top3) {
    // Display order: 2nd, 1st, 3rd (so the gold card sits center, raised).
    const slots = [top3[1], top3[0], top3[2]];
    const html = slots.map((r, i) => {
      if (!r) return '<div class="podium-card podium-card--empty" aria-hidden="true"></div>';
      const slot = (i === 1) ? 1 : (i === 0 ? 2 : 3);
      return podiumCard(r, slot);
    }).join('');
    podiumEl.innerHTML = `<div class="league-podium-row">${html}</div>`;
  }

  function renderListRow(row) {
    const youCls = row.isSelf ? ' is-self' : '';
    const total  = row._totalCount || 0;
    const zoneCls = (total >= 6 && row.rank <= Math.ceil(total * 0.4)) ? ' zone-up'
                  : (total >= 8 && row.rank > total - Math.ceil(total * 0.25)) ? ' zone-down'
                  : '';
    const grade  = row.grade ? `<span class="league-grade-chip">${esc(gradeLabel(row.grade))}</span>` : '';
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
            ${row.isSelf ? '<span class="league-you-chip">you</span>' : ''}
            ${grade}
          </div>
          <div class="league-row-meta">
            <span class="league-row-week">+${row.weeklyCorrect} this week</span>
            <span class="league-row-life">· ${lifetime} all-time</span>
            ${row.streak > 1 ? `<span class="league-row-streak">· 🔥 ${row.streak}d</span>` : ''}
          </div>
        </div>
        <div class="league-row-level">L${row.level}</div>
      </div>`;
  }

  function renderYouCard(rows) {
    const me = rows.find(r => r.isSelf);
    if (!me || me.rank <= 3) { youCardEl.hidden = true; return; }
    const above = rows.find(r => r.rank === me.rank - 1);
    const gap = above ? Math.max(0, (above.weeklyCorrect || 0) - (me.weeklyCorrect || 0)) : 0;
    const climbCopy = above
      ? `<strong>${gap}</strong> correct away from <span class="you-card-target">${esc(above.displayName)}</span>`
      : `<strong>Lead</strong> your league — answer questions to stay on top!`;
    youCardEl.innerHTML = `
      <div class="you-card-rank-block">
        <div class="you-card-rank">#${me.rank}</div>
        <div class="you-card-rank-label">your rank</div>
      </div>
      ${avatarHtml(me, 'md')}
      <div class="you-card-body">
        <div class="you-card-name">${esc(me.displayName)} <span class="league-you-chip">you</span></div>
        <div class="you-card-copy">${climbCopy}</div>
      </div>
      <a class="you-card-cta" href="practice.html">Practice →</a>`;
    youCardEl.hidden = false;
  }

  function renderStandings(payload) {
    const rows = (payload && payload.league) || [];
    rows.forEach(r => { r._totalCount = rows.length; });

    if (rows.length === 0 || (rows.length === 1 && rows[0].isSelf)) {
      renderEmpty();
      return;
    }

    // Persist a snapshot so movement arrows work day-over-day.
    persistSnapshot(rows);

    // Top 3 + remaining. We always render a podium with up to 3 cards
    // (empty slots become ghost cards) — it's the visual anchor of the
    // page. Then a list of rank 4+ below.
    renderPodium(rows.slice(0, 3));
    const rest = rows.slice(3);
    listEl.innerHTML = rest.map(renderListRow).join('');

    // If the podium isn't full (fewer than 3 rows ranked), show an
    // explicit CTA so the kid + parent know it's not broken — the
    // empty podium slots are intentional and waiting for more friends.
    let cta = document.getElementById('league-grow-cta');
    if (rows.length < 4) {
      const need = 4 - rows.length;
      if (!cta) {
        cta = document.createElement('div');
        cta.id = 'league-grow-cta';
        cta.className = 'league-grow-cta';
        listEl.parentNode.insertBefore(cta, listEl.nextSibling);
      }
      cta.innerHTML = `
        <div class="league-grow-icon" aria-hidden="true">✨</div>
        <div class="league-grow-body">
          <div class="league-grow-title">Your league has room to grow</div>
          <div class="league-grow-sub">${
            rows.length === 1 ? "Add a friend so you have someone to race against."
            : need === 1 ? "Add one more friend to fill out the podium."
            : `Add ${need} more friends to fill out the podium.`
          }</div>
        </div>
        <button type="button" class="btn btn-primary league-grow-btn" data-grow-add>+ Add friend</button>`;
      const b = cta.querySelector('[data-grow-add]');
      if (b) b.addEventListener('click', () => openSheet('add'));
    } else if (cta) {
      cta.remove();
    }

    renderYouCard(rows);
    footEl.hidden = false;
  }

  // ---------- requests banner ----------
  function renderRequestsBanner(friendList) {
    const incoming = (friendList && Array.isArray(friendList.incoming)) ? friendList.incoming : [];
    if (incoming.length === 0) {
      bannerEl.hidden = true;
      return;
    }
    bannerEl.hidden = false;
    const n = incoming.length;
    const who = incoming.slice(0, 2).map(r => r.displayName || r.peer).join(', ');
    const more = n > 2 ? ` and ${n - 2} more` : '';
    bannerTxt.textContent = `${who}${more} ${n === 1 ? 'wants' : 'want'} to be your friend.`;
  }

  // ---------- bottom sheet (add friend + requests) ----------
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheetEl.hidden) closeSheet();
  });
  if (addBtn)     addBtn.addEventListener('click', () => openSheet('add'));
  if (bannerBtn)  bannerBtn.addEventListener('click', () => openSheet('requests'));
  function openAddFriend() { openSheet('add'); }

  function renderSheet(activeTab) {
    const fl = cache.friendList || { friends: [], incoming: [], outgoing: [] };
    const me = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
    const myUsername = (me && me.username) || '';

    sheetBody.innerHTML = `
      <div class="league-sheet-tabs">
        <button type="button" class="league-sheet-tab" data-sheet-tab="add">Add friend</button>
        <button type="button" class="league-sheet-tab" data-sheet-tab="requests">
          Requests
          ${fl.incoming.length > 0 ? `<span class="league-sheet-tab-dot">${fl.incoming.length}</span>` : ''}
        </button>
        <button type="button" class="league-sheet-tab" data-sheet-tab="friends">Friends (${fl.friends.length})</button>
      </div>
      <div id="league-sheet-content"></div>`;
    sheetBody.querySelectorAll('.league-sheet-tab').forEach(b => {
      b.classList.toggle('league-sheet-tab--active', b.getAttribute('data-sheet-tab') === activeTab);
      b.addEventListener('click', () => renderSheet(b.getAttribute('data-sheet-tab')));
    });
    const content = document.getElementById('league-sheet-content');
    if (activeTab === 'add')       content.innerHTML = renderAddTabHtml(myUsername);
    else if (activeTab === 'requests') content.innerHTML = renderRequestsTabHtml(fl);
    else                           content.innerHTML = renderFriendsTabHtml(fl);
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
    const incomingHtml = incoming.length === 0
      ? `<p class="league-section-empty">No incoming requests.</p>`
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
    const outgoingHtml = outgoing.length === 0
      ? `<p class="league-section-empty">No outgoing requests waiting.</p>`
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
    if (accepted.length === 0) {
      return `<p class="league-section-empty">No friends yet. Add some on the Add tab!</p>`;
    }
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
    // Add-friend
    const form = content.querySelector('#league-add-form');
    if (form) {
      const input = content.querySelector('#league-add-input');
      const status = content.querySelector('#league-add-status');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const target = (input.value || '').trim().toLowerCase();
        if (!target) return;
        if (target === myUsername.toLowerCase()) {
          status.textContent = "That's your own username!";
          status.className = 'league-add-status league-add-status--err';
          return;
        }
        status.textContent = 'Sending…';
        status.className = 'league-add-status';
        try {
          const r = await api('friendRequest', { target });
          if (r && r.status === 'accepted') {
            status.textContent = "You're now friends!";
            status.className = 'league-add-status league-add-status--ok';
            input.value = '';
            await Promise.all([loadLeague(), loadFriendList()]);
            renderRequestsBanner(cache.friendList);
            renderStandings(cache.league);
          } else if (r && r.status === 'pending_out') {
            status.textContent = `Request sent to @${target}.`;
            status.className = 'league-add-status league-add-status--ok';
            input.value = '';
            await loadFriendList();
            renderRequestsBanner(cache.friendList);
            renderSheet('add');
          } else if (r && r.error) {
            status.textContent = r.error;
            status.className = 'league-add-status league-add-status--err';
          }
        } catch (err) {
          status.textContent = (err && err.message) || 'User not found.';
          status.className = 'league-add-status league-add-status--err';
        }
      });
    }
    // Copy username
    const copyBtn = content.querySelector('.league-share-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const val = copyBtn.getAttribute('data-copy') || '';
        if (!val) return;
        try {
          await navigator.clipboard.writeText(val);
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
        } catch (_) {}
      });
    }
    // Requests
    content.querySelectorAll('.league-req-accept').forEach(b => {
      b.addEventListener('click', async () => {
        const target = b.getAttribute('data-target');
        b.disabled = true;
        try { await api('friendRespond', { target, decision: 'accept' }); } catch (_) {}
        await Promise.all([loadLeague(), loadFriendList()]);
        renderRequestsBanner(cache.friendList);
        renderStandings(cache.league);
        renderSheet('requests');
      });
    });
    content.querySelectorAll('.league-req-decline, .league-req-cancel, .league-friend-remove').forEach(b => {
      b.addEventListener('click', async () => {
        const target = b.getAttribute('data-target');
        const isUnfriend = b.classList.contains('league-friend-remove');
        if (isUnfriend && !confirm(`Unfriend ${target}?`)) return;
        b.disabled = true;
        try {
          if (b.classList.contains('league-req-decline')) {
            await api('friendRespond', { target, decision: 'decline' });
          } else {
            await api('friendUnfriend', { target });
          }
        } catch (_) {}
        await Promise.all([loadLeague(), loadFriendList()]);
        renderRequestsBanner(cache.friendList);
        renderStandings(cache.league);
        renderSheet(activeTab === 'friends' ? 'friends' : 'requests');
      });
    });
  }

  // ---------- locked / error ----------
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
    footEl.hidden = true;
    if (addBtn) addBtn.style.display = 'none';
  }
  function renderError(msg) {
    podiumEl.innerHTML = `<div class="card" style="max-width:680px;padding:24px;margin:18px auto;color:rgba(255,255,255,0.65);">${esc(msg)}</div>`;
    listEl.innerHTML = '';
  }

  // ---------- data ----------
  const cache = { league: null, friendList: null };
  async function loadLeague() {
    try { cache.league = await api('friendLeague', {}); }
    catch (e) { cache.league = { league: [], count: 0 }; }
  }
  async function loadFriendList() {
    try { cache.friendList = await api('friendList', {}); }
    catch (e) { cache.friendList = { friends: [], incoming: [], outgoing: [] }; }
  }

  // ---------- boot ----------
  setWeekCountdown();
  async function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser) {
      renderError('Please sign in first.');
      return;
    }
    const me = window.STAARAuth.currentUser();
    if (!me) {
      renderError('Please sign in first.');
      return;
    }
    if (!gradeIsG3Plus(me.grade)) {
      renderLocked();
      return;
    }
    await Promise.all([loadLeague(), loadFriendList()]);
    renderRequestsBanner(cache.friendList);
    renderStandings(cache.league);

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await Promise.all([loadLeague(), loadFriendList()]);
        renderRequestsBanner(cache.friendList);
        renderStandings(cache.league);
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
