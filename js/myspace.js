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
    const cta = document.getElementById('ms-quickwin-cta');
    const dismiss = document.getElementById('ms-quickwin-dismiss');
    if (!banner) return;

    // Pick a quick win in priority order
    let win = null;
    if (data.journal().length === 0) {
      win = { id: 'first-journal', msg: 'Write your first journal entry to start a streak.', link: '/myspace/journal.html', linkLabel: 'Journal' };
    } else if (data.timetable().length === 0) {
      win = { id: 'first-timetable', msg: 'Add this week\'s classes to your Timetable.', link: '/myspace/timetable.html', linkLabel: 'Timetable' };
    } else {
      const dueToday = homeworkDueToday();
      if (dueToday.length > 0) {
        win = { id: 'hw-due-today', msg: 'You have ' + dueToday.length + ' homework due today.', link: '/myspace/homework.html', linkLabel: 'Homework' };
      }
    }
    if (!win) { banner.hidden = true; return; }

    // Dismissed-recently check (24h)
    const dismissKey = STORAGE_PREFIX + getUserKey() + ':qw-dismiss:' + win.id;
    const dismissedAt = parseInt(localStorage.getItem(dismissKey) || '0', 10);
    if (Date.now() - dismissedAt < 24 * 60 * 60 * 1000) { banner.hidden = true; return; }

    text.textContent = win.msg;
    link.textContent = win.linkLabel;
    link.href = win.link;
    cta.textContent = 'Go to ' + win.linkLabel;
    cta.href = win.link;
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

  function renderStats() {
    const t = document.getElementById('ms-stat-tasks');
    const j = document.getElementById('ms-stat-journals');
    const s = document.getElementById('ms-stat-streak');
    if (t) t.textContent = tasksDoneToday();
    if (j) j.textContent = journalsThisWeek();
    if (s) s.textContent = streakDays();
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
  // AI BUDDY CHAT
  // ============================================================
  function wireComposer() {
    const form = document.getElementById('ms-composer');
    const input = document.getElementById('ms-composer-input');
    const send = document.getElementById('ms-composer-send');
    const thread = document.getElementById('ms-chat-thread');
    if (!form || !input || !send) return;

    input.addEventListener('input', function () {
      send.disabled = input.value.trim().length === 0;
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg) return;
      const subjectFilter = document.getElementById('ms-subject-trigger').dataset.value || '';
      input.value = '';
      send.disabled = true;

      thread.hidden = false;
      appendMessage(thread, 'user', msg);
      const thinking = appendMessage(thread, 'ai', '…');
      thinking.classList.add('ms-msg--thinking');

      let reply;
      try {
        reply = await sendChat(msg, subjectFilter);
      } catch (_) {
        reply = localFallbackReply(msg);
      }
      thinking.classList.remove('ms-msg--thinking');
      thinking.textContent = reply;
    });
  }

  function appendMessage(thread, who, text) {
    const div = document.createElement('div');
    div.className = 'ms-msg ms-msg--' + who;
    div.textContent = text;
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
    return div;
  }

  async function sendChat(message, subjectFilter) {
    // Build a tiny snapshot of the kid's data for the backend to use as context
    const summary = buildBriefingSummary();
    const u = getUser();
    const token = window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token();
    if (!token) throw new Error('Not signed in');

    const ctrl = new AbortController();
    const timeout = setTimeout(function () { ctrl.abort(); }, 12000);
    try {
      const r = await fetch(API + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'myspaceChat',
          token: token,
          message: message,
          subjectFilter: subjectFilter || '',
          summary: summary,
          firstName: getFirstName()
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
