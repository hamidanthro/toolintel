/**
 * MySpace — kid-facing personal dashboard.
 *
 * Vanilla JS (no React per CLAUDE.md §3). Single file drives every
 * page under /myspace/ + /myspace.html — each HTML page sets a
 * body[data-myspace-active] attribute the script uses to route
 * which renderer fires.
 *
 * Data store: localStorage keyed per signed-in user. No backend
 * persistence yet (Phase 2). AI chat IS wired to the backend
 * (action: 'myspaceChat'), with a local fallback that summarizes
 * the kid's data deterministically if the API fails.
 */

(function () {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  const API = 'https://4wvuw21yjl.execute-api.us-east-1.amazonaws.com';
  const STORAGE_PREFIX = 'gradeearn:myspace:';
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ============================================================
  // AUTH / USER
  // ============================================================
  function getUser() {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      return u || null;
    } catch (_) { return null; }
  }
  function getUserKey() {
    const u = getUser();
    return u && u.username ? u.username : '__guest__';
  }
  function getFirstName() {
    const u = getUser();
    if (!u) return 'friend';
    const name = String(u.displayName || u.username || '').trim();
    return (name.split(' ')[0] || 'friend').slice(0, 30);
  }
  function getAvatarLetter() {
    const n = getFirstName();
    return (n[0] || 'M').toUpperCase();
  }

  // ============================================================
  // DATA LAYER (localStorage)
  // ============================================================
  function _key(slot) { return STORAGE_PREFIX + getUserKey() + ':' + slot; }
  function _load(slot, fallback) {
    try {
      const raw = localStorage.getItem(_key(slot));
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function _save(slot, value) {
    try { localStorage.setItem(_key(slot), JSON.stringify(value)); } catch (_) {}
  }

  const data = {
    journal:  function () { return _load('journal', []); },
    homework: function () { return _load('homework', []); },
    timetable: function () { return _load('timetable', []); },
    tasks:    function () { return _load('tasks', []); },
    setJournal: function (v)  { _save('journal', v); },
    setHomework: function (v) { _save('homework', v); },
    setTimetable: function (v) { _save('timetable', v); },
    setTasks: function (v)    { _save('tasks', v); },
  };

  function uid() {
    return 'ms_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function streakDays() {
    // Streak = consecutive UTC days the kid wrote a journal entry, ending today or yesterday
    const entries = data.journal();
    if (entries.length === 0) return 0;
    const dayHas = new Set(entries.map(function (e) { return (e.date || '').slice(0, 10); }));
    let streak = 0;
    const cursor = new Date();
    // Allow today to count even if not yet written by checking yesterday backward
    if (!dayHas.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
    while (dayHas.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function tasksDoneToday() {
    const today = todayISO();
    return data.tasks().filter(function (t) {
      return t.done && t.doneAt && t.doneAt.slice(0, 10) === today;
    }).length;
  }

  function journalsThisWeek() {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    return data.journal().filter(function (e) {
      return new Date(e.date || 0).getTime() >= sevenDaysAgo;
    }).length;
  }

  function homeworkDueSoon() {
    const today = todayISO();
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 7);
    const horizonISO = horizon.toISOString().slice(0, 10);
    return data.homework().filter(function (h) {
      return !h.done && h.dueDate && h.dueDate >= today && h.dueDate <= horizonISO;
    });
  }
  function homeworkDueToday() {
    const today = todayISO();
    return data.homework().filter(function (h) { return !h.done && h.dueDate === today; });
  }

  // ============================================================
  // HTML ESCAPE
  // ============================================================
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============================================================
  // SHARED SHELL (rendered into subpages where #ms-shell-mount exists)
  // ============================================================
  function renderShell() {
    const mount = document.getElementById('ms-shell-mount');
    if (!mount) return; // main /myspace.html ships with shell pre-rendered
    const active = document.body.getAttribute('data-myspace-active') || 'home';
    const pageTitle = document.body.getAttribute('data-myspace-page-title') || 'MySpace';
    mount.innerHTML =
      '<aside class="ms-sidebar" aria-label="MySpace navigation">' +
        '<a class="ms-brand" href="/index.html" aria-label="GradeEarn home">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="#0f172a" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path d="M9 11l3-3 3 3M9 13l3 3 3-3" stroke="#fbbf24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' +
          '<span class="ms-brand-text">GradeEarn</span>' +
        '</a>' +
        '<nav class="ms-nav">' +
          sidebarLink('home', '/myspace.html', 'MySpace', svgGrid(), active) +
          sidebarLink('journal', '/myspace/journal.html', 'Journal', svgJournal(), active) +
          sidebarLink('homework', '/myspace/homework.html', 'Homework', svgHomework(), active) +
          sidebarLink('timetable', '/myspace/timetable.html', 'Timetable', svgCal(), active) +
          sidebarLink('tasks', '/myspace/tasks.html', 'Tasks', svgTasks(), active) +
          '<a class="ms-nav-item" href="/index.html"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg><span>Back</span></a>' +
        '</nav>' +
      '</aside>' +
      '<main class="ms-main">' +
        '<header class="ms-top">' +
          '<div class="ms-top-brand"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>GradeEarn</span></div>' +
          '<div class="ms-top-title">' + esc(pageTitle) + '</div>' +
          '<div class="ms-top-actions">' +
            '<a class="ms-top-btn ms-quicknote-btn" href="/myspace.html"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Dashboard</a>' +
            '<div class="ms-top-avatar">' + getAvatarLetter() + '</div>' +
          '</div>' +
        '</header>' +
        // The page's actual content (#ms-subpage-content) sits after this mount
      '</main>';
    // Move the page's existing content INTO the .ms-main column
    const content = document.getElementById('ms-subpage-content');
    const main = mount.querySelector('.ms-main');
    if (content && main) main.appendChild(content);
  }
  function sidebarLink(key, href, label, icon, active) {
    const cls = active === key ? 'ms-nav-item ms-nav-item--active' : 'ms-nav-item';
    return '<a class="' + cls + '" href="' + href + '">' + icon + '<span>' + esc(label) + '</span></a>';
  }
  function svgGrid()    { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'; }
  function svgJournal() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'; }
  function svgHomework(){ return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'; }
  function svgCal()     { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'; }
  function svgTasks()   { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 7 5 9 9 5"/><line x1="13" y1="7" x2="21" y2="7"/><polyline points="3 14 5 16 9 12"/><line x1="13" y1="14" x2="21" y2="14"/></svg>'; }

  // ============================================================
  // HOME PAGE — greeting + quick-win + AI Buddy + stats
  // ============================================================
  function initHome() {
    // Greeting
    const h = new Date().getHours();
    const slot = h < 12 ? 'morning' : (h < 18 ? 'afternoon' : 'evening');
    const greeting = document.getElementById('ms-greeting');
    if (greeting) greeting.textContent = 'Good ' + slot + ', ' + getFirstName();

    // Avatar
    const av = document.getElementById('ms-avatar');
    if (av) av.textContent = getAvatarLetter();

    renderDateEyebrow();
    renderQuickWin();
    renderBriefing();
    renderStats();
    renderSubjects();
    wireComposer();
    wireBriefingButtons();
    wireQuickNote();
    wireMorePopover();
  }

  function renderQuickWin() {
    const banner = document.getElementById('ms-quickwin');
    const text = document.getElementById('ms-quickwin-text');
    const link = document.getElementById('ms-quickwin-link');
    const dismiss = document.getElementById('ms-quickwin-dismiss');
    if (!banner) return;

    // Pick a quick win in priority order. §40 polish: the message is
    // prefixed with "Quick win —" inline rather than a bold "Quick win:"
    // banner. The "Go to X" CTA pill is gone; the inline link does both
    // jobs (acts as call-to-action + dismiss × at the end).
    let win = null;
    if (data.journal().length === 0) {
      win = { id: 'first-journal', msg: 'Quick win — write your first journal entry to start a streak.', link: '/myspace/journal.html', linkLabel: 'Journal' };
    } else if (data.timetable().length === 0) {
      win = { id: 'first-timetable', msg: 'Quick win — add this week\'s classes to your Timetable.', link: '/myspace/timetable.html', linkLabel: 'Timetable' };
    } else {
      const dueToday = homeworkDueToday();
      if (dueToday.length > 0) {
        win = { id: 'hw-due-today', msg: 'Quick win — you have ' + dueToday.length + ' homework due today.', link: '/myspace/homework.html', linkLabel: 'Homework' };
      }
    }
    if (!win) { banner.hidden = true; return; }

    // Dismissed-recently check (24h) — same localStorage key shape as before
    const dismissKey = STORAGE_PREFIX + getUserKey() + ':qw-dismiss:' + win.id;
    const dismissedAt = parseInt(localStorage.getItem(dismissKey) || '0', 10);
    if (Date.now() - dismissedAt < 24 * 60 * 60 * 1000) { banner.hidden = true; return; }

    text.textContent = win.msg + ' ';
    link.textContent = win.linkLabel;
    link.href = win.link;
    banner.hidden = false;
    dismiss.onclick = function () {
      try { localStorage.setItem(dismissKey, String(Date.now())); } catch (_) {}
      banner.hidden = true;
    };
  }

  function renderBriefing() {
    const body = document.getElementById('ms-briefing-body');
    if (!body) return;
    body.textContent = buildBriefingSummary();
  }

  function buildBriefingSummary() {
    const facts = [];
    const dueSoon = homeworkDueSoon();
    if (dueSoon.length > 0) {
      const next = dueSoon.slice().sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); })[0];
      facts.push(dueSoon.length + ' homework item' + (dueSoon.length === 1 ? '' : 's') + ' due in the next 7 days' +
        (next ? ' — earliest: ' + (next.subject || 'one') + ' on ' + niceDate(next.dueDate) : ''));
    }
    const j = journalsThisWeek();
    if (j > 0) facts.push('You\'ve written ' + j + ' journal entr' + (j === 1 ? 'y' : 'ies') + ' this week');
    const td = tasksDoneToday();
    if (td > 0) facts.push('You knocked out ' + td + ' task' + (td === 1 ? '' : 's') + ' today');
    const nextClass = findNextClass();
    if (nextClass) facts.push('Next on your schedule: ' + nextClass.subject + ' on ' + nextClass.day + ' at ' + nextClass.startTime);

    if (facts.length === 0) {
      return 'Quiet week so far. Add a journal entry or some homework and I\'ll start tracking your progress.';
    }
    return facts.join('. ') + '.';
  }

  function findNextClass() {
    const tt = data.timetable();
    if (tt.length === 0) return null;
    const today = new Date();
    const todayIdx = (today.getDay() + 6) % 7; // make Monday = 0
    const nowMin = today.getHours() * 60 + today.getMinutes();
    for (let offset = 0; offset < 7; offset++) {
      const dayIdx = (todayIdx + offset) % 7;
      const day = DAYS[dayIdx];
      const candidates = tt.filter(function (c) { return c.day === day; })
        .sort(function (a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (offset > 0) return c;
        const t = (c.startTime || '00:00').split(':');
        const minutes = (parseInt(t[0], 10) || 0) * 60 + (parseInt(t[1], 10) || 0);
        if (minutes > nowMin) return c;
      }
    }
    return tt[0];
  }

  function niceDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (_) { return iso; }
  }

  // §40 polish: numbers get visual prominence (.ms-stat-num) and the
  // following label gets small-caps treatment (.ms-stat-label) with
  // correct pluralization so we never ship "1 DAYS" / "1 JOURNAL
  // ENTRIES" again.
  function pluralize(n, singular, plural) {
    return n === 1 ? singular : plural;
  }
  function renderStats() {
    const t = document.getElementById('ms-stat-tasks');
    const j = document.getElementById('ms-stat-journals');
    const s = document.getElementById('ms-stat-streak');
    const tLabel = document.getElementById('ms-stat-tasks-label');
    const jLabel = document.getElementById('ms-stat-journals-label');
    const sLabel = document.getElementById('ms-stat-streak-label');

    const td = tasksDoneToday();
    const je = journalsThisWeek();
    const st = streakDays();

    if (t) t.textContent = td;
    if (j) j.textContent = je;
    if (s) s.textContent = st;

    if (tLabel) tLabel.textContent = pluralize(td, 'Task today', 'Tasks today');
    if (jLabel) jLabel.textContent = pluralize(je, 'Journal entry this week', 'Journal entries this week');
    if (sLabel) sLabel.textContent = pluralize(st, 'Day streak', 'Day streak');
  }

  // §40 polish: anchor the greeting with a small one-line date eyebrow.
  function renderDateEyebrow() {
    const el = document.getElementById('ms-date-eyebrow');
    if (!el) return;
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      el.textContent = fmt.format(new Date()).toUpperCase();
    } catch (_) {
      el.textContent = '';
    }
  }

  function renderSubjects() {
    const list = document.getElementById('ms-subject-list');
    const trigger = document.getElementById('ms-subject-trigger');
    if (!list) return;
    const subjects = new Set();
    data.homework().forEach(function (h) { if (h.subject) subjects.add(h.subject); });
    data.timetable().forEach(function (c) { if (c.subject) subjects.add(c.subject); });
    let html = '<li role="option" data-value="">All subjects</li>';
    Array.from(subjects).sort().forEach(function (s) {
      html += '<li role="option" data-value="' + esc(s) + '">' + esc(s) + '</li>';
    });
    list.innerHTML = html;

    // Open/close
    if (trigger) {
      trigger.onclick = function () {
        const open = list.hidden;
        list.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
      };
    }
    list.onclick = function (e) {
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      document.getElementById('ms-subject-label').textContent = li.textContent;
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.dataset.value = li.dataset.value || '';
    };
    document.addEventListener('click', function (e) {
      if (!list.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
        list.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function wireBriefingButtons() {
    const refresh = document.getElementById('ms-briefing-refresh');
    const dismiss = document.getElementById('ms-briefing-dismiss');
    if (refresh) refresh.addEventListener('click', renderBriefing);
    if (dismiss) dismiss.addEventListener('click', function () {
      const b = document.getElementById('ms-briefing');
      if (b) b.style.display = 'none';
    });
  }

  function wireQuickNote() {
    const open = document.getElementById('ms-quick-note');
    const overlay = document.getElementById('ms-quicknote-overlay');
    const close = document.getElementById('ms-quicknote-close');
    const cancel = document.getElementById('ms-quicknote-cancel');
    const save = document.getElementById('ms-quicknote-save');
    const ta = document.getElementById('ms-quicknote-text');
    if (!open || !overlay) return;
    function show() { overlay.hidden = false; setTimeout(function () { ta && ta.focus(); }, 0); }
    function hide() { overlay.hidden = true; if (ta) ta.value = ''; }
    open.addEventListener('click', show);
    if (close) close.addEventListener('click', hide);
    if (cancel) cancel.addEventListener('click', hide);
    if (save) save.addEventListener('click', function () {
      const text = (ta.value || '').trim();
      if (!text) { hide(); return; }
      const entries = data.journal();
      entries.unshift({ id: uid(), date: new Date().toISOString(), title: '', text: text });
      data.setJournal(entries);
      hide();
      renderQuickWin(); renderBriefing(); renderStats();
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
  }

  function wireMorePopover() {
    const btn = document.getElementById('ms-nav-more');
    const pop = document.getElementById('ms-popover');
    if (!btn || !pop) return;
    btn.addEventListener('click', function () {
      const open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (e.target === btn || btn.contains(e.target) || pop.contains(e.target)) return;
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });
    pop.querySelectorAll('[data-stub]').forEach(function (b) {
      b.addEventListener('click', function () {
        alert('Coming soon — for now, focus on Journal / Homework / Tasks.');
        pop.hidden = true;
      });
    });
  }

  // ============================================================
  // §41 AI BUDDY CHAT — Perplexity / ChatGPT / Claude anatomy
  // ============================================================
  // State machine: empty (no messages in active thread) ↔ active (≥1 msg).
  // Threads persist to localStorage keyed per-user. Server-side safety
  // pipeline (crisis-detector + output moderation + audit logging) is
  // untouched — every send still flows through it.

  const THREADS_KEY_PREFIX = 'gradeearn:myspace:threads:'; // + userKey
  const ACTIVE_THREAD_KEY_PREFIX = 'gradeearn:myspace:active-thread:';
  const MAX_THREADS = 50;
  const STREAM_WORD_MS = 30; // word-by-word reveal cadence (client-side stub
                              // until the lambda supports SSE — TODO: switch
                              // to real backend streaming when available)

  let chatState = {
    threads: [],            // array of { id, title, createdAt, updatedAt, messages }
    activeThreadId: null,
    isStreaming: false,
    streamAbort: null,      // AbortController for in-flight fetch
    streamCancelled: false  // user pressed Stop — drop result if it arrives
  };

  function chatThreadsKey() { return THREADS_KEY_PREFIX + getUserKey(); }
  function chatActiveKey()  { return ACTIVE_THREAD_KEY_PREFIX + getUserKey(); }

  function loadChatThreads() {
    try {
      const raw = localStorage.getItem(chatThreadsKey());
      chatState.threads = raw ? JSON.parse(raw) : [];
    } catch (_) { chatState.threads = []; }
    try {
      chatState.activeThreadId = localStorage.getItem(chatActiveKey()) || null;
    } catch (_) { chatState.activeThreadId = null; }
    // Drop active id if no longer present
    if (chatState.activeThreadId && !chatState.threads.find(function (t) { return t.id === chatState.activeThreadId; })) {
      chatState.activeThreadId = null;
    }
  }
  function persistChatThreads() {
    try { localStorage.setItem(chatThreadsKey(), JSON.stringify(chatState.threads)); } catch (_) {}
    try {
      if (chatState.activeThreadId) localStorage.setItem(chatActiveKey(), chatState.activeThreadId);
      else localStorage.removeItem(chatActiveKey());
    } catch (_) {}
  }
  function getActiveThread() {
    return chatState.threads.find(function (t) { return t.id === chatState.activeThreadId; }) || null;
  }
  function createNewThread() {
    const id = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const thread = { id: id, title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    chatState.threads.unshift(thread);
    if (chatState.threads.length > MAX_THREADS) chatState.threads = chatState.threads.slice(0, MAX_THREADS);
    chatState.activeThreadId = id;
    persistChatThreads();
    return thread;
  }
  function switchThread(id) {
    chatState.activeThreadId = id;
    persistChatThreads();
    renderChatSurface();
    renderRecentList();
  }
  function deleteThread(id) {
    chatState.threads = chatState.threads.filter(function (t) { return t.id !== id; });
    if (chatState.activeThreadId === id) chatState.activeThreadId = null;
    persistChatThreads();
    renderChatSurface();
    renderRecentList();
  }

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day === 1) return 'yesterday';
    if (day < 7) return day + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  // ---- Minimal markdown renderer (bold, italic, code, lists, links).
  // Home-rolled to avoid pulling a markdown dep (CLAUDE.md §3 — no bundler).
  // Escape first, then re-introduce inline + block constructs.
  function renderMarkdown(src) {
    let s = String(src || '').replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
    // Fenced code blocks (```...```)
    s = s.replace(/```([\s\S]*?)```/g, function (_, code) {
      return '<pre><code>' + code.replace(/^\n/, '') + '</code></pre>';
    });
    // Inline code
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Links [text](url) — only allow http(s) and mailto
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bold + italic
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // Bullet lists (single-level)
    s = s.replace(/(?:^|\n)((?:[-*] [^\n]+\n?)+)/g, function (_, block) {
      const items = block.trim().split(/\n/).map(function (line) {
        return '<li>' + line.replace(/^[-*] /, '') + '</li>';
      }).join('');
      return '\n<ul>' + items + '</ul>\n';
    });
    // Paragraphs: split on blank lines; preserve single newlines as <br>
    const parts = s.split(/\n{2,}/).map(function (p) {
      p = p.trim();
      if (!p) return '';
      if (/^<(ul|pre|h\d|blockquote)/.test(p)) return p;
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    });
    return parts.join('');
  }

  // ---- Render the chat surface (toggles empty ↔ active)
  function renderChatSurface() {
    const body = document.body;
    const thread = getActiveThread();
    const has = thread && thread.messages && thread.messages.length > 0;
    body.classList.toggle('ms-chat-active', !!has);

    // Empty-state greeting personalization
    const empty = document.getElementById('ms-chat-empty-greeting');
    if (empty) {
      const name = getFirstName();
      empty.textContent = name && name !== 'friend'
        ? 'What would you like to work on, ' + name + '?'
        : 'What would you like to work on?';
    }

    // Thread title
    const title = document.getElementById('ms-chat-title');
    if (title) title.textContent = thread ? thread.title : '';

    // Render thread messages
    const threadEl = document.getElementById('ms-chat-thread');
    if (threadEl) {
      threadEl.innerHTML = '';
      if (thread) {
        thread.messages.forEach(function (m, i) {
          const isLastAi = i === thread.messages.length - 1 && m.role === 'ai';
          renderMessageInto(threadEl, m, { withActions: m.role === 'ai', isStreaming: false, isLastAi: isLastAi });
        });
      }
      threadEl.scrollTop = threadEl.scrollHeight;
    }
  }

  function renderMessageInto(threadEl, msg, opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'ms-msg ms-msg--' + msg.role;
    wrap.dataset.msgId = msg.id || ('m_' + Math.random().toString(36).slice(2, 8));

    // Sparkle prefix for AI bubbles
    if (msg.role === 'ai') {
      const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      spark.setAttribute('class', 'ms-msg-spark');
      spark.setAttribute('viewBox', '0 0 24 24');
      spark.setAttribute('fill', 'none');
      spark.setAttribute('stroke', 'currentColor');
      spark.setAttribute('stroke-width', '1.8');
      spark.setAttribute('aria-hidden', 'true');
      spark.innerHTML = '<polygon points="12 2 15 8 21 9 17 14 18 21 12 18 6 21 7 14 3 9 9 8 12 2"/>';
      wrap.appendChild(spark);
    }

    const bodyWrap = document.createElement('div');
    bodyWrap.style.display = 'flex';
    bodyWrap.style.flexDirection = 'column';
    bodyWrap.style.maxWidth = '100%';

    const body = document.createElement('div');
    body.className = 'ms-msg-body';
    if (msg.role === 'ai') {
      body.innerHTML = renderMarkdown(msg.text || '');
    } else {
      body.textContent = msg.text || '';
    }
    bodyWrap.appendChild(body);

    if (msg.aborted) {
      const note = document.createElement('div');
      note.className = 'ms-msg-aborted';
      note.textContent = 'Stopped.';
      bodyWrap.appendChild(note);
    }

    if (opts.withActions) {
      bodyWrap.appendChild(buildActionsRow(msg, wrap));
    }

    wrap.appendChild(bodyWrap);
    threadEl.appendChild(wrap);
    return { wrap: wrap, body: body };
  }

  function buildActionsRow(msg, msgWrap) {
    const row = document.createElement('div');
    row.className = 'ms-msg-actions';
    function btn(label, svgPath, onClick, opts) {
      opts = opts || {};
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms-msg-act-btn';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svgPath + '</svg>';
      b.onclick = function () { onClick(b); };
      return b;
    }
    row.appendChild(btn('Copy', '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', function (b) {
      try {
        navigator.clipboard && navigator.clipboard.writeText(msg.text || '');
        const original = b.innerHTML;
        b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () { b.innerHTML = original; }, 1500);
      } catch (_) {}
    }));
    row.appendChild(btn('Regenerate', '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>', function () {
      regenerateLast();
    }));
    row.appendChild(btn('Thumbs up', '<path d="M14 9V5a3 3 0 0 0-6 0v4H2v12h16l4-12z"/>', function (b) {
      const pressed = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(!pressed));
      // TODO §41: wire to /api/myspace/chat/:messageId/feedback
      console.log('[chat-feedback] thumbsUp msgId=' + msgWrap.dataset.msgId + ' pressed=' + !pressed);
    }));
    row.appendChild(btn('Thumbs down', '<path d="M10 15v4a3 3 0 0 0 6 0v-4h6V3H6L2 15z"/>', function (b) {
      const pressed = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(!pressed));
      console.log('[chat-feedback] thumbsDown msgId=' + msgWrap.dataset.msgId + ' pressed=' + !pressed);
    }));
    return row;
  }

  function renderRecentList() {
    const listEl = document.getElementById('ms-recent-list');
    if (!listEl) return;
    if (chatState.threads.length === 0) {
      listEl.innerHTML = '<div class="ms-recent-empty">No previous chats yet.</div>';
      return;
    }
    listEl.innerHTML = '';
    chatState.threads.forEach(function (t) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ms-recent-item' + (t.id === chatState.activeThreadId ? ' active' : '');
      btn.innerHTML =
        '<div><div class="ms-recent-item-title">' + escHtml(t.title) + '</div>' +
        '<div class="ms-recent-item-time">' + relativeTime(t.updatedAt) + '</div></div>' +
        '<span class="ms-recent-item-delete" data-del="' + t.id + '" aria-label="Delete">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>' +
          '</svg>' +
        '</span>';
      btn.onclick = function (e) {
        // Click on delete: stop propagation and delete
        const del = e.target.closest('[data-del]');
        if (del) {
          e.stopPropagation();
          if (confirm('Delete this chat?')) deleteThread(t.id);
          return;
        }
        switchThread(t.id);
        closeRecentPanel();
      };
      listEl.appendChild(btn);
    });
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function openRecentPanel() {
    const panel = document.getElementById('ms-recent-panel');
    const btn = document.getElementById('ms-recent-btn');
    if (!panel || !btn) return;
    renderRecentList();
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
  }
  function closeRecentPanel() {
    const panel = document.getElementById('ms-recent-panel');
    const btn = document.getElementById('ms-recent-btn');
    if (!panel || !btn) return;
    panel.classList.remove('show');
    panel.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
  }

  // ---- Send + stream a message
  async function submitMessage(userText) {
    userText = String(userText || '').trim();
    if (!userText || chatState.isStreaming) return;

    // Make sure there's an active thread to attach to
    let thread = getActiveThread();
    if (!thread) thread = createNewThread();

    const userMsg = { id: 'm_u_' + Date.now(), role: 'user', text: userText, ts: Date.now() };
    thread.messages.push(userMsg);

    // Auto-title from the first user message
    if (thread.messages.filter(function (m) { return m.role === 'user'; }).length === 1) {
      thread.title = userText.slice(0, 40) + (userText.length > 40 ? '…' : '');
    }
    thread.updatedAt = Date.now();
    persistChatThreads();

    // Render user message + placeholder AI message with thinking dots
    document.body.classList.add('ms-chat-active');
    const threadEl = document.getElementById('ms-chat-thread');
    renderMessageInto(threadEl, userMsg, { withActions: false });

    const aiPlaceholder = { id: 'm_a_' + Date.now(), role: 'ai', text: '' };
    const aiRender = renderMessageInto(threadEl, aiPlaceholder, { withActions: false });
    aiRender.body.innerHTML = '<span class="ms-thinking-dots"><span></span><span></span><span></span></span>';
    threadEl.scrollTop = threadEl.scrollHeight;
    document.getElementById('ms-chat-title').textContent = thread.title;

    // Wire abort + send/stop UI
    chatState.isStreaming = true;
    chatState.streamCancelled = false;
    setComposerStopMode(true);

    const subjectFilter = document.getElementById('ms-subject-trigger').dataset.value || '';
    let replyText;
    try {
      replyText = await sendChat(userText, subjectFilter);
    } catch (err) {
      if (chatState.streamCancelled) {
        aiPlaceholder.aborted = true;
        thread.messages.push(aiPlaceholder);
        persistChatThreads();
        renderChatSurface();
        setComposerStopMode(false);
        chatState.isStreaming = false;
        return;
      }
      replyText = localFallbackReply(userText);
    }
    if (chatState.streamCancelled) {
      aiPlaceholder.aborted = true;
      aiPlaceholder.text = '';
      thread.messages.push(aiPlaceholder);
      persistChatThreads();
      renderChatSurface();
      setComposerStopMode(false);
      chatState.isStreaming = false;
      return;
    }

    // Client-side word-by-word reveal — keeps the chat-product feel even
    // though the backend returns a full JSON response. TODO §41: switch
    // to real SSE when the lambda supports it.
    await revealStreaming(aiRender.body, replyText);

    aiPlaceholder.text = replyText;
    thread.messages.push(aiPlaceholder);
    thread.updatedAt = Date.now();
    persistChatThreads();

    // Re-render the final AI bubble with markdown + actions (we built it
    // up with a streaming caret; replace cleanly now)
    aiRender.body.innerHTML = renderMarkdown(replyText);
    const parent = aiRender.wrap.children[1] || aiRender.wrap.lastChild;
    if (parent) parent.appendChild(buildActionsRow(aiPlaceholder, aiRender.wrap));

    setComposerStopMode(false);
    chatState.isStreaming = false;
    renderRecentList();
  }

  function revealStreaming(bodyEl, text) {
    return new Promise(function (resolve) {
      const words = String(text).split(/(\s+)/); // keep whitespace
      bodyEl.innerHTML = '';
      const span = document.createElement('span');
      const caret = document.createElement('span');
      caret.className = 'ms-stream-caret';
      bodyEl.appendChild(span);
      bodyEl.appendChild(caret);
      let i = 0;
      function step() {
        if (chatState.streamCancelled || i >= words.length) {
          caret.remove();
          resolve();
          return;
        }
        span.textContent += words[i++];
        const t = document.getElementById('ms-chat-thread');
        if (t && chatState && (Math.abs(t.scrollHeight - t.scrollTop - t.clientHeight) < 100)) {
          t.scrollTop = t.scrollHeight;
        }
        setTimeout(step, STREAM_WORD_MS);
      }
      step();
    });
  }

  function regenerateLast() {
    const thread = getActiveThread();
    if (!thread || thread.messages.length === 0 || chatState.isStreaming) return;
    // Find the last user message
    let lastUserIdx = -1;
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      if (thread.messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserText = thread.messages[lastUserIdx].text;
    // Drop everything from the last user message onward (we'll re-add it)
    thread.messages = thread.messages.slice(0, lastUserIdx);
    persistChatThreads();
    renderChatSurface();
    submitMessage(lastUserText);
  }

  function setComposerStopMode(stopping) {
    const send = document.getElementById('ms-composer-send');
    const sendIcon = document.getElementById('ms-send-icon');
    const stopIcon = document.getElementById('ms-stop-icon');
    if (!send) return;
    if (stopping) {
      send.classList.add('ms-composer-stop');
      send.disabled = false;
      send.setAttribute('aria-label', 'Stop generating');
      if (sendIcon) sendIcon.style.display = 'none';
      if (stopIcon) stopIcon.style.display = 'block';
    } else {
      send.classList.remove('ms-composer-stop');
      send.setAttribute('aria-label', 'Send');
      if (sendIcon) sendIcon.style.display = 'block';
      if (stopIcon) stopIcon.style.display = 'none';
      const input = document.getElementById('ms-composer-input');
      send.disabled = !input || input.value.trim().length === 0;
    }
  }

  function abortStream() {
    if (!chatState.isStreaming) return;
    chatState.streamCancelled = true;
    if (chatState.streamAbort) { try { chatState.streamAbort.abort(); } catch (_) {} }
  }

  // ---- Top-level composer wiring (called from setup)
  function wireComposer() {
    const form = document.getElementById('ms-composer');
    const input = document.getElementById('ms-composer-input');
    const send = document.getElementById('ms-composer-send');
    const charCount = document.getElementById('ms-composer-char-count');
    if (!form || !input || !send) return;

    // Load threads + populate UI
    loadChatThreads();
    renderChatSurface();
    renderRecentList();

    // Composer interactions
    input.addEventListener('input', function () {
      const len = input.value.length;
      send.disabled = chatState.isStreaming ? false : input.value.trim().length === 0;
      if (charCount) {
        if (len > 400) {
          charCount.classList.add('show');
          charCount.textContent = len + ' / 1000';
          charCount.classList.toggle('over', len > 1000);
        } else {
          charCount.classList.remove('show');
        }
      }
    });

    // Enter sends, Shift+Enter newlines, Escape aborts streaming
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatState.isStreaming) return;
        form.requestSubmit();
      }
      if (e.key === 'Escape' && chatState.isStreaming) {
        e.preventDefault();
        abortStream();
      }
    });

    // Form submit / Stop button
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (chatState.isStreaming) { abortStream(); return; }
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      send.disabled = true;
      if (charCount) charCount.classList.remove('show');
      submitMessage(msg);
      // Refocus the composer for fast follow-ups
      setTimeout(function () { input.focus(); }, 0);
    });

    // Suggested prompt chips → fill + send
    document.querySelectorAll('.ms-chat-suggest-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const prompt = chip.dataset.prompt || chip.textContent.trim();
        submitMessage(prompt);
      });
    });

    // Back-to-dashboard collapses to empty view (keeps the thread intact)
    const back = document.getElementById('ms-chat-back');
    if (back) back.addEventListener('click', function () {
      document.body.classList.remove('ms-chat-active');
    });

    // Recent Chats dropdown
    const recentBtn = document.getElementById('ms-recent-btn');
    const recentPanel = document.getElementById('ms-recent-panel');
    if (recentBtn) {
      recentBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (recentPanel.classList.contains('show')) closeRecentPanel();
        else openRecentPanel();
      });
    }
    document.addEventListener('click', function (e) {
      if (!recentPanel) return;
      if (!recentPanel.classList.contains('show')) return;
      if (recentPanel.contains(e.target) || (recentBtn && recentBtn.contains(e.target))) return;
      closeRecentPanel();
    });
    const newChatBtn = document.getElementById('ms-recent-newchat');
    if (newChatBtn) newChatBtn.addEventListener('click', function () {
      // New chat: clear active id, drop into empty state
      chatState.activeThreadId = null;
      persistChatThreads();
      renderChatSurface();
      renderRecentList();
      closeRecentPanel();
      setTimeout(function () { input.focus(); }, 0);
    });

    // Scroll-to-bottom button
    const threadEl = document.getElementById('ms-chat-thread');
    const stbBtn = document.getElementById('ms-scroll-to-bottom');
    if (threadEl && stbBtn) {
      threadEl.addEventListener('scroll', function () {
        const dist = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight;
        stbBtn.classList.toggle('show', dist > 80);
      });
      stbBtn.addEventListener('click', function () {
        threadEl.scrollTo({ top: threadEl.scrollHeight, behavior: 'smooth' });
      });
    }

    // Auto-focus composer on load
    setTimeout(function () { input.focus(); }, 60);
  }

  // ============================================================
  // FULL CONTEXT for the AI Buddy.
  // ============================================================
  // The previous shipped version only sent count-summary lines ("you
  // have 2 homework items due Friday"). The AI couldn't read actual
  // content — when the kid asked "tell me about my journal entry,"
  // the model truthfully said "I can't see it."
  //
  // This builds a fuller snapshot the model can reference:
  //   - Recent journal entries (latest 8, with title + first 240 chars)
  //   - All pending homework (subject / title / due / notes)
  //   - Full timetable (all classes per day)
  //   - All open tasks + 5 most recent completed
  //   - GradeEarn app practice data: streak, level/XP if Achievements
  //     module is loaded, recent unit from staar.stats.*
  //
  // Capped at ~6 KB of text so the lambda + OpenAI roundtrip stays
  // snappy. Lambda also re-trims at its end.
  function buildFullContext() {
    const lines = [];
    const u = getUser();
    const firstName = getFirstName();

    lines.push('— Student snapshot —');
    lines.push('First name: ' + firstName);
    if (u && u.grade) lines.push('Grade: ' + u.grade);

    // ----- Journal entries (latest 8, full title + 240-char excerpt)
    const journal = data.journal();
    if (journal.length > 0) {
      lines.push('');
      lines.push('JOURNAL ENTRIES (' + journal.length + ' total, most recent first):');
      journal.slice(0, 8).forEach(function (e, i) {
        const date = (e.date || '').slice(0, 10);
        const title = (e.title || '').trim() || 'Untitled';
        const body = String(e.text || '').replace(/\s+/g, ' ').trim();
        const excerpt = body.length > 240 ? body.slice(0, 240) + '…' : body;
        lines.push('  ' + (i + 1) + '. [' + date + '] ' + title);
        if (excerpt) lines.push('     "' + excerpt + '"');
      });
    } else {
      lines.push('');
      lines.push('JOURNAL: (no entries yet)');
    }

    // ----- Homework (all pending + last 3 completed for context)
    const hw = data.homework();
    const pendingHw = hw.filter(function (h) { return !h.done; });
    const recentDoneHw = hw.filter(function (h) { return h.done; }).slice(0, 3);
    lines.push('');
    if (pendingHw.length > 0) {
      lines.push('PENDING HOMEWORK (' + pendingHw.length + '):');
      pendingHw.forEach(function (h, i) {
        const due = h.dueDate ? 'due ' + h.dueDate : 'no due date';
        const subj = h.subject || 'General';
        const overdue = h.dueDate && h.dueDate < todayISO() ? ' [OVERDUE]' : '';
        lines.push('  ' + (i + 1) + '. ' + subj + ': ' + h.title + ' (' + due + ')' + overdue);
        if (h.notes) lines.push('     notes: ' + String(h.notes).slice(0, 140));
      });
    } else {
      lines.push('PENDING HOMEWORK: (none)');
    }
    if (recentDoneHw.length > 0) {
      lines.push('Recently completed homework:');
      recentDoneHw.forEach(function (h) {
        lines.push('  ✓ ' + (h.subject || 'General') + ': ' + h.title);
      });
    }

    // ----- Timetable
    const tt = data.timetable();
    lines.push('');
    if (tt.length > 0) {
      lines.push('WEEKLY TIMETABLE:');
      DAYS.forEach(function (d) {
        const dayClasses = tt.filter(function (c) { return c.day === d; })
          .sort(function (a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
        if (dayClasses.length > 0) {
          lines.push('  ' + d + ': ' + dayClasses.map(function (c) {
            return c.startTime + ' ' + c.subject + (c.room ? ' (' + c.room + ')' : '');
          }).join(' · '));
        }
      });
      const next = findNextClass();
      if (next) lines.push('Next class: ' + next.day + ' at ' + next.startTime + ' — ' + next.subject);
    } else {
      lines.push('TIMETABLE: (empty)');
    }

    // ----- Tasks (open + 5 recent completed)
    const tasks = data.tasks();
    const openTasks = tasks.filter(function (t) { return !t.done; });
    const doneTasks = tasks.filter(function (t) { return t.done; }).slice(0, 5);
    lines.push('');
    if (openTasks.length > 0) {
      lines.push('OPEN TASKS (' + openTasks.length + '):');
      openTasks.forEach(function (t, i) {
        lines.push('  ' + (i + 1) + '. ' + t.title);
      });
    } else {
      lines.push('OPEN TASKS: (none)');
    }
    if (doneTasks.length > 0) {
      lines.push('Recently completed tasks: ' + doneTasks.map(function (t) { return t.title; }).join(' · '));
    }

    // ----- GradeEarn app practice data (best-effort, may not be present)
    lines.push('');
    lines.push('PRACTICE APP STATS:');
    lines.push('  Journal streak: ' + streakDays() + ' day' + (streakDays() === 1 ? '' : 's'));
    lines.push('  Tasks done today: ' + tasksDoneToday());
    lines.push('  Journal entries this week: ' + journalsThisWeek());

    // Pull achievements/level data if the Achievements module loaded
    try {
      if (window.Achievements && typeof window.Achievements.getStats === 'function') {
        const s = window.Achievements.getStats();
        if (s) {
          if (s.xp != null) lines.push('  Total XP: ' + s.xp);
          if (s.loginStreak) lines.push('  Login streak: ' + s.loginStreak + ' days');
          if (s.streakShields) lines.push('  Streak shields held: ' + s.streakShields);
          if (typeof window.Achievements.levelFromXp === 'function') {
            const lev = window.Achievements.levelFromXp(s.xp || 0);
            if (lev && lev.level) lines.push('  Level: ' + lev.level + ' (' + (lev.inLevelXp || 0) + '/' + (lev.levelSpan || 0) + ' XP)');
          }
        }
      }
    } catch (_) {}

    // Pull journey data if available (last practiced grade, by-grade correct counts)
    try {
      if (u && u.username) {
        const raw = localStorage.getItem('staar.journey.' + u.username);
        if (raw) {
          const j = JSON.parse(raw);
          if (j && j.byGrade) {
            const grades = Object.keys(j.byGrade);
            if (grades.length > 0) {
              const counts = grades.map(function (g) {
                return g + ': ' + (j.byGrade[g].correct || 0) + ' correct';
              }).join(' · ');
              lines.push('  Practice history: ' + counts);
            }
          }
          if (j.bestStreak) lines.push('  Best practice streak: ' + j.bestStreak + ' in a row');
        }
      }
    } catch (_) {}

    let out = lines.join('\n');
    // Hard cap at ~6 KB to avoid bloating the request
    if (out.length > 6000) out = out.slice(0, 6000) + '\n…(truncated)';
    return out;
  }

  async function sendChat(message, subjectFilter) {
    // Build the full snapshot the AI Buddy needs to actually be useful
    const context = buildFullContext();
    const briefingSummary = buildBriefingSummary(); // short version for back-compat
    const u = getUser();
    const token = window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token();
    if (!token) throw new Error('Not signed in');

    const ctrl = new AbortController();
    const timeout = setTimeout(function () { ctrl.abort(); }, 15000);
    try {
      const r = await fetch(API + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'myspaceChat',
          token: token,
          message: message,
          subjectFilter: subjectFilter || '',
          context: context,
          summary: briefingSummary, // back-compat with older lambda
          firstName: getFirstName(),
          grade: u && u.grade ? u.grade : ''
        }),
        signal: ctrl.signal
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'API error');
      return data.reply || localFallbackReply(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  function localFallbackReply(message) {
    // Deterministic fallback if API is down or kid is signed out — picks
    // a useful one-liner based on what the kid asked.
    const m = message.toLowerCase();
    const dueToday = homeworkDueToday();
    const dueSoon = homeworkDueSoon();
    if (m.indexOf('homework') !== -1 || m.indexOf('due') !== -1) {
      if (dueToday.length > 0) return 'You have ' + dueToday.length + ' homework due today — want to start with the earliest one?';
      if (dueSoon.length > 0) return 'You have ' + dueSoon.length + ' homework in the next 7 days. Nothing today though.';
      return 'No homework on your list right now. Add some on the Homework tab so I can keep track.';
    }
    if (m.indexOf('schedule') !== -1 || m.indexOf('class') !== -1 || m.indexOf('timetable') !== -1) {
      const next = findNextClass();
      if (next) return 'Next class: ' + next.subject + ' on ' + next.day + ' at ' + next.startTime + '.';
      return 'Your timetable is empty — add a class on the Timetable tab and I\'ll track it.';
    }
    if (m.indexOf('streak') !== -1 || m.indexOf('journal') !== -1) {
      const s = streakDays();
      if (s > 0) return 'You\'re on a ' + s + '-day journal streak. Keep it up.';
      return 'No streak yet — write a quick journal entry today to start one.';
    }
    return 'Good question. I can help with your homework, schedule, and journal. Ask me something specific like "what\'s due tomorrow?"';
  }

  // ============================================================
  // JOURNAL PAGE
  // ============================================================
  function initJournal() {
    const empty = document.querySelector('.ms-empty');
    const list = document.getElementById('ms-journal-list');
    const newBtn = document.getElementById('ms-journal-new');
    const overlay = document.getElementById('ms-journal-overlay');
    const close = document.getElementById('ms-journal-close');
    const cancel = document.getElementById('ms-journal-cancel');
    const save = document.getElementById('ms-journal-save');
    const titleI = document.getElementById('ms-journal-title');
    const textI = document.getElementById('ms-journal-text');

    function render() {
      const entries = data.journal();
      if (entries.length === 0) {
        empty.style.display = '';
        list.hidden = true;
        return;
      }
      empty.style.display = 'none';
      list.hidden = false;
      list.innerHTML = entries.map(function (e) {
        return '<article class="ms-entry" data-id="' + esc(e.id) + '">' +
          '<header><h3>' + esc(e.title || 'Untitled') + '</h3>' +
          '<time>' + niceDate((e.date || '').slice(0, 10)) + '</time></header>' +
          '<p>' + esc(e.text || '').replace(/\n/g, '<br>') + '</p>' +
          '<button type="button" class="ms-entry-delete" data-id="' + esc(e.id) + '">Delete</button>' +
          '</article>';
      }).join('');
      list.querySelectorAll('.ms-entry-delete').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete this entry?')) return;
          const id = b.dataset.id;
          data.setJournal(data.journal().filter(function (e) { return e.id !== id; }));
          render();
        });
      });
    }

    function show() { overlay.hidden = false; setTimeout(function () { titleI && titleI.focus(); }, 0); }
    function hide() { overlay.hidden = true; titleI.value = ''; textI.value = ''; }

    newBtn && newBtn.addEventListener('click', show);
    close && close.addEventListener('click', hide);
    cancel && cancel.addEventListener('click', hide);
    save && save.addEventListener('click', function () {
      const text = (textI.value || '').trim();
      if (!text) { textI.focus(); return; }
      const entries = data.journal();
      entries.unshift({ id: uid(), date: new Date().toISOString(), title: (titleI.value || '').trim(), text: text });
      data.setJournal(entries);
      hide(); render();
    });

    render();
  }

  // ============================================================
  // HOMEWORK PAGE
  // ============================================================
  function initHomework() {
    const empty = document.querySelector('.ms-empty');
    const list = document.getElementById('ms-homework-list');
    const newBtn = document.getElementById('ms-homework-new');
    const overlay = document.getElementById('ms-homework-overlay');
    const close = document.getElementById('ms-homework-close');
    const cancel = document.getElementById('ms-homework-cancel');
    const save = document.getElementById('ms-homework-save');
    const subI = document.getElementById('ms-homework-subject');
    const titleI = document.getElementById('ms-homework-title');
    const dueI = document.getElementById('ms-homework-due');
    const notesI = document.getElementById('ms-homework-notes');

    function render() {
      const items = data.homework().slice().sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      });
      if (items.length === 0) { empty.style.display = ''; list.hidden = true; return; }
      empty.style.display = 'none';
      list.hidden = false;
      list.innerHTML = items.map(function (h) {
        const overdue = !h.done && h.dueDate && h.dueDate < todayISO();
        return '<article class="ms-hw' + (h.done ? ' ms-hw--done' : '') + (overdue ? ' ms-hw--overdue' : '') + '">' +
          '<label><input type="checkbox" data-id="' + esc(h.id) + '"' + (h.done ? ' checked' : '') + '><span></span></label>' +
          '<div class="ms-hw-body">' +
            '<div class="ms-hw-top"><span class="ms-hw-subject">' + esc(h.subject || 'General') + '</span>' +
              (h.dueDate ? '<time>Due ' + esc(niceDate(h.dueDate)) + (overdue ? ' · overdue' : '') + '</time>' : '') + '</div>' +
            '<h3>' + esc(h.title) + '</h3>' +
            (h.notes ? '<p>' + esc(h.notes).replace(/\n/g, '<br>') + '</p>' : '') +
          '</div>' +
          '<button type="button" class="ms-hw-delete" data-id="' + esc(h.id) + '" aria-label="Delete">×</button>' +
          '</article>';
      }).join('');
      list.querySelectorAll('input[type="checkbox"][data-id]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          const id = cb.dataset.id;
          const items = data.homework().map(function (h) {
            if (h.id === id) return Object.assign({}, h, { done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : null });
            return h;
          });
          data.setHomework(items);
          render();
        });
      });
      list.querySelectorAll('.ms-hw-delete').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete this homework?')) return;
          data.setHomework(data.homework().filter(function (h) { return h.id !== b.dataset.id; }));
          render();
        });
      });
    }

    function show() { overlay.hidden = false; dueI.value = ''; subI.value = ''; titleI.value = ''; notesI.value = ''; setTimeout(function () { subI.focus(); }, 0); }
    function hide() { overlay.hidden = true; }

    newBtn && newBtn.addEventListener('click', show);
    close && close.addEventListener('click', hide);
    cancel && cancel.addEventListener('click', hide);
    save && save.addEventListener('click', function () {
      const title = (titleI.value || '').trim();
      if (!title) { titleI.focus(); return; }
      const items = data.homework();
      items.unshift({
        id: uid(),
        subject: (subI.value || '').trim() || 'General',
        title: title,
        dueDate: dueI.value || '',
        notes: (notesI.value || '').trim(),
        done: false
      });
      data.setHomework(items);
      hide(); render();
    });

    render();
  }

  // ============================================================
  // TIMETABLE PAGE
  // ============================================================
  function initTimetable() {
    const grid = document.getElementById('ms-timetable-grid');
    const addBtn = document.getElementById('ms-timetable-add');
    const overlay = document.getElementById('ms-timetable-overlay');
    const close = document.getElementById('ms-timetable-close');
    const cancel = document.getElementById('ms-timetable-cancel');
    const save = document.getElementById('ms-timetable-save');
    const dayI = document.getElementById('ms-timetable-day');
    const startI = document.getElementById('ms-timetable-start');
    const subI = document.getElementById('ms-timetable-subject');
    const roomI = document.getElementById('ms-timetable-room');

    function render() {
      const tt = data.timetable();
      grid.innerHTML = DAYS.map(function (d) {
        const today = DAYS[(new Date().getDay() + 6) % 7];
        const dayClasses = tt.filter(function (c) { return c.day === d; })
          .sort(function (a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
        return '<div class="ms-tt-day' + (d === today ? ' ms-tt-day--today' : '') + '">' +
          '<header><span>' + d + '</span>' + (d === today ? '<span class="ms-tt-today">Today</span>' : '') + '</header>' +
          (dayClasses.length === 0 ?
            '<p class="ms-tt-empty">No classes</p>' :
            dayClasses.map(function (c) {
              return '<div class="ms-tt-class" data-id="' + esc(c.id) + '">' +
                '<div class="ms-tt-time">' + esc(c.startTime || '') + '</div>' +
                '<div class="ms-tt-subject">' + esc(c.subject) + '</div>' +
                (c.room ? '<div class="ms-tt-room">' + esc(c.room) + '</div>' : '') +
                '<button type="button" class="ms-tt-delete" data-id="' + esc(c.id) + '" aria-label="Delete">×</button>' +
              '</div>';
            }).join('')) +
          '</div>';
      }).join('');
      grid.querySelectorAll('.ms-tt-delete').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete this class?')) return;
          data.setTimetable(data.timetable().filter(function (c) { return c.id !== b.dataset.id; }));
          render();
        });
      });
    }

    function show() { overlay.hidden = false; subI.value = ''; startI.value = ''; roomI.value = ''; setTimeout(function () { subI.focus(); }, 0); }
    function hide() { overlay.hidden = true; }

    addBtn && addBtn.addEventListener('click', show);
    close && close.addEventListener('click', hide);
    cancel && cancel.addEventListener('click', hide);
    save && save.addEventListener('click', function () {
      const subject = (subI.value || '').trim();
      if (!subject) { subI.focus(); return; }
      const tt = data.timetable();
      tt.push({
        id: uid(),
        day: dayI.value,
        startTime: startI.value || '08:00',
        subject: subject,
        room: (roomI.value || '').trim()
      });
      data.setTimetable(tt);
      hide(); render();
    });

    render();
  }

  // ============================================================
  // TASKS PAGE
  // ============================================================
  function initTasks() {
    const empty = document.getElementById('ms-tasks-empty');
    const list = document.getElementById('ms-task-list');
    const form = document.getElementById('ms-task-form');
    const input = document.getElementById('ms-task-input');

    function render() {
      const tasks = data.tasks().slice().sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      if (tasks.length === 0) { empty.style.display = ''; list.hidden = true; return; }
      empty.style.display = 'none';
      list.hidden = false;
      list.innerHTML = tasks.map(function (t) {
        return '<li class="ms-task' + (t.done ? ' ms-task--done' : '') + '">' +
          '<label><input type="checkbox" data-id="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + '><span></span></label>' +
          '<span class="ms-task-text">' + esc(t.title) + '</span>' +
          '<button type="button" class="ms-task-delete" data-id="' + esc(t.id) + '" aria-label="Delete">×</button>' +
        '</li>';
      }).join('');
      list.querySelectorAll('input[type="checkbox"][data-id]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          const id = cb.dataset.id;
          const items = data.tasks().map(function (t) {
            if (t.id === id) return Object.assign({}, t, { done: cb.checked, doneAt: cb.checked ? new Date().toISOString() : null });
            return t;
          });
          data.setTasks(items);
          render();
        });
      });
      list.querySelectorAll('.ms-task-delete').forEach(function (b) {
        b.addEventListener('click', function () {
          data.setTasks(data.tasks().filter(function (t) { return t.id !== b.dataset.id; }));
          render();
        });
      });
    }

    form && form.addEventListener('submit', function (e) {
      e.preventDefault();
      const title = (input.value || '').trim();
      if (!title) return;
      const tasks = data.tasks();
      tasks.unshift({ id: uid(), title: title, done: false, createdAt: Date.now() });
      data.setTasks(tasks);
      input.value = '';
      render();
    });

    render();
  }

  // ============================================================
  // ROUTER
  // ============================================================
  function init() {
    renderShell();
    const active = document.body.getAttribute('data-myspace-active') || 'home';
    if (active === 'journal') return initJournal();
    if (active === 'homework') return initHomework();
    if (active === 'timetable') return initTimetable();
    if (active === 'tasks') return initTasks();
    initHome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
