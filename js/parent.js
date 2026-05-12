/**
 * GradeEarn — parent dashboard (Tier 6 AA, May 10)
 *
 * Fetches getParentSummary (7-day window) and renders the data the
 * existing handleGetParentSummary lambda action already produces. Also
 * provides a parent-email + weekly-consent capture form so the future
 * cron lambda has someone to email.
 */
(function () {
  'use strict';

  const root = document.getElementById('parent-root');
  if (!root) return;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function pct(n) { return Math.round(n * 100) + '%'; }

  function renderError(msg) {
    root.innerHTML = `
      <article class="card" style="max-width:760px;padding:32px 28px;">
        <p>Couldn't load: ${escapeHtml(msg)}</p>
        <a class="btn btn-primary" href="index.html">Back to home</a>
      </article>`;
  }

  function renderEmpty() {
    root.innerHTML = `
      <article class="card" style="max-width:760px;padding:32px 28px;text-align:center;">
        <p style="color:var(--muted);margin:0 0 18px;">No practice activity in the last 7 days yet.</p>
        <a class="btn btn-primary" href="index.html">Go practice</a>
      </article>`;
  }

  function renderSummary(summary, emailState) {
    const accuracy = summary.total > 0 ? Math.round((summary.correct / summary.total) * 100) : 0;
    const bySubject = summary.bySubject || {};
    const subjectRows = Object.keys(bySubject).map(subj => {
      const s = bySubject[subj];
      const pctNum = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
      return `
        <div class="parent-subject-row">
          <div class="parent-subject-name">${escapeHtml(subj)}</div>
          <div class="parent-subject-bar"><div class="parent-subject-fill" style="width:${pctNum}%;"></div></div>
          <div class="parent-subject-score">${s.correct}/${s.total} · ${pctNum}%</div>
        </div>`;
    }).join('');

    const strongHtml = (summary.strongTopics || []).slice(0, 3).map(t => `<li>${escapeHtml(t.teks || t.topic || t.id || '—')} <span class="parent-topic-stat">${t.correct}/${t.total}</span></li>`).join('') || '<li class="parent-empty">Keep practicing — patterns will emerge.</li>';
    const needsHtml  = (summary.needsWorkTopics || []).slice(0, 3).map(t => `<li>${escapeHtml(t.teks || t.topic || t.id || '—')} <span class="parent-topic-stat">${t.correct}/${t.total}</span></li>`).join('') || '<li class="parent-empty">Nothing standing out — solid week.</li>';

    const emailVal = emailState.parentEmail || '';
    const consentChecked = emailState.weeklyConsent ? 'checked' : '';

    root.innerHTML = `
      <div class="parent-grid">
        <article class="card parent-card parent-card--hero">
          <div class="parent-stat-row">
            <div class="parent-stat">
              <div class="parent-stat-num">${summary.total}</div>
              <div class="parent-stat-label">Questions</div>
            </div>
            <div class="parent-stat">
              <div class="parent-stat-num">${accuracy}<span class="parent-stat-suffix">%</span></div>
              <div class="parent-stat-label">Accuracy</div>
            </div>
            <div class="parent-stat">
              <div class="parent-stat-num">${summary.activeDays || 0}</div>
              <div class="parent-stat-label">Active days</div>
            </div>
            <div class="parent-stat">
              <div class="parent-stat-num">${summary.centsEarned || 0}<span class="parent-stat-suffix">¢</span></div>
              <div class="parent-stat-label">Earned</div>
            </div>
          </div>
        </article>

        ${subjectRows ? `
        <article class="card parent-card">
          <h3 class="parent-card-title">By subject</h3>
          <div class="parent-subjects">${subjectRows}</div>
        </article>` : ''}

        <article class="card parent-card">
          <h3 class="parent-card-title">What's clicking</h3>
          <ul class="parent-topic-list">${strongHtml}</ul>
        </article>

        <article class="card parent-card">
          <h3 class="parent-card-title">Worth another look</h3>
          <ul class="parent-topic-list">${needsHtml}</ul>
        </article>

        <article class="card parent-card parent-card--email">
          <h3 class="parent-card-title">Weekly summary email</h3>
          <p class="parent-card-subtitle">Get this snapshot delivered to your inbox every Sunday.</p>
          <form id="parent-email-form" class="parent-email-form">
            <label for="parent-email-input" class="parent-email-label">Parent email</label>
            <input type="email" id="parent-email-input" class="parent-email-input" placeholder="parent@example.com" value="${escapeHtml(emailVal)}" autocomplete="email" />
            <label class="parent-consent-row">
              <input type="checkbox" id="parent-consent" ${consentChecked} />
              <span>Send me a weekly summary. I can opt out any time.</span>
            </label>
            <div class="parent-email-actions">
              <button type="submit" class="btn btn-primary" id="parent-email-save">Save</button>
              <span class="parent-email-status" id="parent-email-status"></span>
            </div>
            <p class="parent-email-note">Email delivery starts when our scheduled job lands (coming soon). Saving here puts you on the list.</p>
          </form>
        </article>

        <article class="card parent-card parent-card--rights">
          <h3 class="parent-card-title">Your data &amp; rights</h3>
          <p class="parent-card-subtitle">COPPA gives parents the right to review, export, or delete the data we hold on your child. All three are below.</p>
          <div class="parent-rights-actions">
            <button type="button" class="btn btn-secondary" id="parent-export-btn">Download data export (.json)</button>
            <button type="button" class="btn btn-secondary" id="parent-audit-btn">View activity log</button>
            <button type="button" class="btn btn-danger" id="parent-delete-btn">Request account deletion</button>
          </div>
          <p id="parent-rights-status" class="parent-rights-status" aria-live="polite"></p>
          <div id="parent-audit-panel" class="parent-audit-panel" hidden></div>
          <p class="parent-email-note">Audit + safety + consent records are kept for 7 / 3 / 7 years respectively per COPPA. Everything else is deleted within 30 days of a deletion request.</p>
        </article>
      </div>`;

    // Wire the email form.
    const form = document.getElementById('parent-email-form');
    const status = document.getElementById('parent-email-status');
    const saveBtn = document.getElementById('parent-email-save');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('parent-email-input').value.trim();
      const consent = document.getElementById('parent-consent').checked;
      saveBtn.disabled = true; status.textContent = 'Saving…';
      try {
        const token = window.STAARAuth.token && window.STAARAuth.token();
        const r = await window.STAARAuth.api('setParentEmail', {
          token, email: email, weeklyConsent: consent
        });
        if (r && r.ok) status.textContent = email ? 'Saved.' : 'Cleared.';
        else status.textContent = 'Something went wrong.';
      } catch (err) {
        status.textContent = (err && err.message) || 'Error.';
      }
      saveBtn.disabled = false;
      setTimeout(() => { status.textContent = ''; }, 3000);
    });

    // Data & rights: export, audit, delete
    wireRightsPanel();
  }

  function setRightsStatus(msg, isError) {
    const el = document.getElementById('parent-rights-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('parent-rights-status--error', !!isError);
  }

  async function downloadDataExport() {
    setRightsStatus('Preparing export…');
    try {
      const token = window.STAARAuth.token && window.STAARAuth.token();
      const r = await window.STAARAuth.api('getMyDataExport', { token });
      if (!r || !r.export) {
        setRightsStatus('Export failed — please try again.', true);
        return;
      }
      const blob = new Blob([JSON.stringify(r.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = 'gradeearn-data-export-' + (r.export.userId || 'me') + '-' + dateStr + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRightsStatus('Export downloaded.');
    } catch (err) {
      setRightsStatus((err && err.message) || 'Export failed.', true);
    }
  }

  async function loadAuditTrail() {
    const panel = document.getElementById('parent-audit-panel');
    if (!panel) return;
    if (!panel.hidden && panel.dataset.loaded === '1') {
      panel.hidden = true;
      return;
    }
    setRightsStatus('Loading activity log…');
    try {
      const token = window.STAARAuth.token && window.STAARAuth.token();
      const r = await window.STAARAuth.api('getMyAuditTrail', { token });
      const events = (r && r.events) || [];
      if (!events.length) {
        panel.innerHTML = '<p class="parent-audit-empty">No events recorded yet.</p>';
      } else {
        const rows = events.slice(0, 50).map(function (ev) {
          const when = ev.occurredAt ? new Date(ev.occurredAt).toLocaleString() : '—';
          const type = escapeHtml(ev.type || ev.eventType || 'event');
          const meta = ev.metadata ? escapeHtml(JSON.stringify(ev.metadata)) : '';
          return '<tr><td class="parent-audit-when">' + escapeHtml(when) + '</td>'
            + '<td class="parent-audit-type">' + type + '</td>'
            + '<td class="parent-audit-meta">' + meta + '</td></tr>';
        }).join('');
        panel.innerHTML =
          '<table class="parent-audit-table">'
          + '<thead><tr><th>When</th><th>Event</th><th>Details</th></tr></thead>'
          + '<tbody>' + rows + '</tbody>'
          + '</table>'
          + '<p class="parent-audit-note">Showing most recent ' + Math.min(events.length, 50) + ' of ' + events.length + ' events.</p>';
      }
      panel.dataset.loaded = '1';
      panel.hidden = false;
      setRightsStatus('');
    } catch (err) {
      setRightsStatus((err && err.message) || 'Activity log failed.', true);
    }
  }

  async function requestDeletion() {
    const ok1 = window.confirm(
      'Request account deletion?\n\n'
      + 'Your account will be tombstoned immediately (login disabled). '
      + 'Content is removed within 30 days. Audit + safety + consent '
      + 'records are kept per COPPA legal requirements.\n\n'
      + 'This is irreversible.'
    );
    if (!ok1) return;
    const phrase = window.prompt('To confirm, type DELETE in capital letters:');
    if (phrase !== 'DELETE') {
      setRightsStatus('Cancelled — confirmation phrase did not match.');
      return;
    }
    setRightsStatus('Submitting deletion request…');
    try {
      const token = window.STAARAuth.token && window.STAARAuth.token();
      const r = await window.STAARAuth.api('requestAccountDeletion', { token, confirm: true });
      if (r && r.ok) {
        setRightsStatus('Deletion requested. ' + (r.message || ''));
        document.getElementById('parent-delete-btn').disabled = true;
      } else {
        setRightsStatus((r && r.message) || 'Deletion request failed.', true);
      }
    } catch (err) {
      setRightsStatus((err && err.message) || 'Deletion request failed.', true);
    }
  }

  function wireRightsPanel() {
    const exportBtn = document.getElementById('parent-export-btn');
    const auditBtn  = document.getElementById('parent-audit-btn');
    const deleteBtn = document.getElementById('parent-delete-btn');
    if (exportBtn) exportBtn.addEventListener('click', downloadDataExport);
    if (auditBtn)  auditBtn.addEventListener('click',  loadAuditTrail);
    if (deleteBtn) deleteBtn.addEventListener('click', requestDeletion);
  }

  async function load() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) {
      renderError('Please sign in first.');
      return;
    }
    const token = window.STAARAuth.token && window.STAARAuth.token();
    try {
      const [summaryR, emailR] = await Promise.all([
        window.STAARAuth.api('getParentSummary', { token, windowDays: 7 }),
        window.STAARAuth.api('getParentEmail', { token })
      ]);
      if (!summaryR || !summaryR.summary) {
        renderEmpty();
        return;
      }
      if (summaryR.summary.total === 0) {
        renderEmpty();
        return;
      }
      renderSummary(summaryR.summary, emailR || {});
    } catch (e) {
      renderError(e.message || 'Network error.');
    }
  }

  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
    load();
  } else {
    document.addEventListener('gradeearn:auth-changed', load, { once: true });
    setTimeout(() => {
      if (root.innerHTML.indexOf('ge-skel') >= 0) load();
    }, 600);
  }
})();
