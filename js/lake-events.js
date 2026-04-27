/**
 * GradeEarn — Content lake client (Prompt I1)
 *
 * Lightweight telemetry layer that captures learning signals
 * (answers, hesitation, rapid flips, rage-quits, stuck patterns)
 * and forwards them to the lake via STAARAuth.api('recordEvent').
 *
 * Zero UX changes: pure event capture.
 *
 * Public API:
 *   GradeEarnLake.startSession()
 *   GradeEarnLake.onQuestionShown({contentId, poolKey, state, grade, subject})
 *   GradeEarnLake.onChoiceFlip()
 *   GradeEarnLake.onAnswered({contentId, poolKey, pickedChoice, isCorrect})
 *   GradeEarnLake.pushRecent(contentId)
 *   GradeEarnLake.getRecent() -> string[]
 *   GradeEarnLake.recordEvent(eventType, payload)
 */
(function () {
  const RECENT_MAX = 50;
  const HESITATION_MS = 30000;
  const RAGE_QUIT_WINDOW_MS = 5000;
  const FLIP_TRIGGER = 3;

  let sessionId = null;
  let questionStartTime = null;
  let answerChanges = 0;
  let lastWrongAt = null;
  let consecutiveWrong = 0;
  let currentContext = {}; // { contentId, poolKey, state, grade, subject }

  function recentKey() {
    let username = 'guest';
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      if (u && u.username) username = u.username;
    } catch (_) {}
    return `staar.recent.${username}`;
  }

  function pushRecent(contentId) {
    if (!contentId) return;
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem(recentKey()) || '[]'); } catch (_) {}
    recent = recent.filter(id => id !== contentId);
    recent.unshift(contentId);
    recent = recent.slice(0, RECENT_MAX);
    try { localStorage.setItem(recentKey(), JSON.stringify(recent)); } catch (_) {}
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(recentKey()) || '[]'); }
    catch (_) { return []; }
  }

  function startSession() {
    if (!sessionId) {
      sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }
    return sessionId;
  }

  function recordEvent(eventType, payload) {
    if (!eventType) return;
    if (!sessionId) startSession();
    const body = Object.assign({
      eventType,
      sessionId,
      state: currentContext.state,
      grade: currentContext.grade,
      subject: currentContext.subject,
      poolKey: currentContext.poolKey,
      contentId: currentContext.contentId
    }, payload || {});

    if (window.STAARAuth && typeof window.STAARAuth.api === 'function') {
      const token = (window.STAARAuth.token && window.STAARAuth.token()) || null;
      window.STAARAuth.api('recordEvent', Object.assign({ token }, body)).catch(() => {});
    }
  }

  function onQuestionShown(ctx) {
    currentContext = Object.assign({}, ctx || {});
    questionStartTime = Date.now();
    answerChanges = 0;
  }

  function onChoiceFlip() {
    answerChanges++;
    if (answerChanges === FLIP_TRIGGER) {
      recordEvent('rapid-flip', { meta: { flips: answerChanges } });
    }
  }

  function onAnswered({ contentId, poolKey, pickedChoice, isCorrect }) {
    const cid = contentId || currentContext.contentId;
    const pk = poolKey || currentContext.poolKey;
    const timeToAnswer = questionStartTime ? (Date.now() - questionStartTime) / 1000 : null;

    recordEvent(isCorrect ? 'answered-correct' : 'answered-incorrect', {
      contentId: cid, poolKey: pk, pickedChoice,
      timeToAnswer,
      meta: { answerChanges }
    });

    if (timeToAnswer !== null && timeToAnswer > HESITATION_MS / 1000) {
      recordEvent('hesitation', {
        contentId: cid, poolKey: pk,
        meta: { timeToAnswer }
      });
    }

    if (isCorrect) {
      lastWrongAt = null;
      if (consecutiveWrong >= 3) {
        // Track 3 consecutive corrects after stuck for 'rebound' (simple heuristic)
        if (!consecutiveWrong._reboundCount) consecutiveWrong = 0;
      }
      consecutiveWrong = 0;
    } else {
      lastWrongAt = Date.now();
      consecutiveWrong++;
      if (consecutiveWrong === 3) {
        recordEvent('stuck', {
          contentId: cid, poolKey: pk,
          meta: { consecutiveWrong }
        });
      }
    }

    if (cid) pushRecent(cid);
  }

  // Rage-quit detection: tab close within 5s of a wrong answer.
  window.addEventListener('beforeunload', () => {
    if (!lastWrongAt) return;
    if ((Date.now() - lastWrongAt) > RAGE_QUIT_WINDOW_MS) return;
    try {
      const tutorEndpoint = (window.STAARAuth && window.STAARAuth.endpoint && window.STAARAuth.endpoint())
        || (window.TUTOR_ENDPOINT) || null;
      if (!tutorEndpoint) return;
      const token = (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null;
      const body = JSON.stringify({
        action: 'recordEvent',
        token,
        eventType: 'rage-quit',
        sessionId,
        contentId: currentContext.contentId,
        poolKey: currentContext.poolKey,
        state: currentContext.state,
        grade: currentContext.grade,
        subject: currentContext.subject
      });
      navigator.sendBeacon(tutorEndpoint, body);
    } catch (_) {}
  });

  window.GradeEarnLake = {
    startSession, recordEvent,
    onQuestionShown, onChoiceFlip, onAnswered,
    pushRecent, getRecent
  };
})();
