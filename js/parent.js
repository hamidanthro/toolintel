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
