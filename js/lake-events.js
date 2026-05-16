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
      // §118 — resolve the api promise so we can capture the lambda's
      // `pacing` field on answered events and broadcast it. The pacing
      // payload tells the UI when the adaptive engine has bumped the
      // session difficulty band ("Stepping up" pill) or eased it back.
      window.STAARAuth.api('recordEvent', Object.assign({ token }, body))
        .then((resp) => {
          try {
            if (resp && resp.pacing) {
              window.dispatchEvent(new CustomEvent('gradeearn:pacing', {
                detail: { pacing: resp.pacing, eventType }
              }));
            }
          } catch (_) {}
        })
        .catch(() => {});
    }
  }

  function onQuestionShown(ctx) {
    currentContext = Object.assign({}, ctx || {});
    questionStartTime = Date.now();
    answerChanges = 0;
  }

  // §118 — compute the difficulty band of an item from its TEKS
  // cognitive_demand + type. Mirrors lambda/adaptive.js's
  // inferItemDifficultyBand so the frontend can attach `itemBand`
  // to answer events without an extra DDB round-trip on the server.
  // Returns 0..4 clamped; defaults to 2 (centre) on unknown.
  const _DEMAND_DELTA = { l: -1, m: 0, h: +1 };
  const _TYPE_DELTA = {
    'computation': -1, 'word-problem': 0, 'concept': 0, 'data-interpretation': +1
  };
  function inferItemBand(teks, type) {
    let band = 2;
    if (window.GE_TEKS_DEMAND && teks && window.GE_TEKS_DEMAND[teks]) {
      band += (_DEMAND_DELTA[window.GE_TEKS_DEMAND[teks]] || 0);
    }
    if (type && _TYPE_DELTA[type] != null) band += _TYPE_DELTA[type];
    if (band < 0) band = 0;
    if (band > 4) band = 4;
    return band;
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

    // §118 — itemBand goes into meta so the lambda's adaptive engine
    // can score the answer against the item's difficulty (ELO step).
    // Without this, the engine assumes band=2 (centre) for every
    // answer, which makes the rating updates noisier.
    const itemBand = inferItemBand(currentContext.teks, currentContext.type);
    recordEvent(isCorrect ? 'answered-correct' : 'answered-incorrect', {
      contentId: cid, poolKey: pk, pickedChoice,
      timeToAnswer,
      meta: { answerChanges, itemBand }
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
