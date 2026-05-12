/**
 * GradeEarn — Shared live-match engine.
 *
 * Provides the matchmaking + state-polling + answer + finish lifecycle
 * for any 1v1 or N-player real-time math game. Showdown is the first
 * consumer; Battle Royale / Bear & Cub / Co-op Quest / Math Karaoke
 * will reuse this same engine.
 *
 * Backend: lambda actions matchmake / matchState / matchAnswer /
 * matchFinish. DDB tables staar-matches + staar-match-history.
 *
 * Polling-based realtime: 500ms tick calling matchState. Server returns
 * serverNowMs on every call so the client can compute clock drift and
 * render the per-round timer accurately.
 *
 * Public API:
 *   const engine = new MatchEngine({ mode, gradeBand, inviteToken,
 *     onStateChange(state), onError(err) });
 *   await engine.start();
 *   engine.submitAnswer(choiceIdx);
 *   engine.destroy();
 *
 * State shape (every onStateChange call):
 *   {
 *     phase: 'queued' | 'live' | 'round-resolved' | 'done',
 *     matchId, mode, gradeBand, inviteToken,
 *     players: [{ userId, displayName, score, ... }],
 *     me, opponent,
 *     currentRound, totalRounds,
 *     problem: { stem, choices } | null,
 *     roundDeadline (epoch ms server-time),
 *     answeredUserIds: [...],
 *     roundWinnerUserId (after resolution),
 *     myAnswerChoice (locally tracked),
 *     finalResult: 'win' | 'loss' | 'tie' (only when phase=done)
 *   }
 */
(function () {
  'use strict';

  function tokenFor() {
    try { return (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null; } catch (_) { return null; }
  }
  async function apiCall(action, payload) {
    if (!window.STAARAuth || !window.STAARAuth.api) throw new Error('Auth API not available');
    return await window.STAARAuth.api(action, Object.assign({ token: tokenFor() }, payload || {}));
  }

  function currentMe() {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      if (u && u.username) return { userId: u.username, displayName: u.displayName || u.username, grade: u.grade || null };
    } catch (_) {}
    return null;
  }

  class MatchEngine {
    constructor(opts) {
      this.mode = opts.mode || 'showdown';
      this.gradeBand = opts.gradeBand || (currentMe() && currentMe().grade) || 'grade-3';
      this.inviteToken = opts.inviteToken || null;
      this.onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : () => {};
      this.onError = typeof opts.onError === 'function' ? opts.onError : (e) => console.warn('[match]', e);

      this.matchId = null;
      this.clockDriftMs = 0; // serverNow - clientNow (add to Date.now() to estimate server time)
      this.pollTimer = null;
      this.pollIntervalMs = 700;
      this.lastSnapshot = null;
      this.lastRoundResolved = 0; // highest round whose resolution we surfaced
      this.myAnswerChoice = -1;
      this.destroyed = false;
    }

    serverNow() { return Date.now() + this.clockDriftMs; }

    async start() {
      try {
        const payload = { mode: this.mode, gradeBand: this.gradeBand };
        if (this.inviteToken) payload.inviteToken = this.inviteToken;
        const r = await apiCall('matchmake', payload);
        this._consume(r);
        this.startPolling();
      } catch (e) {
        this.onError(e);
      }
    }

    startPolling() {
      if (this.pollTimer) return;
      this.pollTimer = setInterval(() => this._poll(), this.pollIntervalMs);
    }
    stopPolling() {
      if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    }

    async _poll() {
      if (this.destroyed || !this.matchId) return;
      try {
        const r = await apiCall('matchState', { matchId: this.matchId });
        this._consume(r);
      } catch (e) {
        // Network blips: tolerate, will re-try on next tick
      }
    }

    async submitAnswer(choiceIdx) {
      if (!this.matchId || !this.lastSnapshot || this.lastSnapshot.phase !== 'live') return;
      const roundNumber = this.lastSnapshot.currentRound;
      if (!Number.isFinite(roundNumber)) return;
      // Local mark so UI reflects immediately
      this.myAnswerChoice = choiceIdx;
      this._emit();
      try {
        const r = await apiCall('matchAnswer', {
          matchId: this.matchId, roundNumber, choiceIndex: choiceIdx
        });
        this._consume(r);
      } catch (e) {
        this.onError(e);
      }
    }

    async finish() {
      if (!this.matchId) return null;
      try {
        const r = await apiCall('matchFinish', { matchId: this.matchId });
        this._consume(r);
        return r;
      } catch (e) {
        this.onError(e);
        return null;
      }
    }

    destroy() {
      this.destroyed = true;
      this.stopPolling();
    }

    // Consume any of: matchmake/matchState/matchAnswer/matchFinish response
    _consume(r) {
      if (!r) return;
      if (r.serverNowMs) this.clockDriftMs = r.serverNowMs - Date.now();
      if (r.matchId) this.matchId = r.matchId;

      // matchmake/matchState return a flat snapshot
      if (typeof r.status === 'string') {
        this._absorbSnapshot(r);
      }
      // matchAnswer/internal resolve returns {resolved, roundResult, nextRound, ...}
      if (r.resolved && r.roundNumber && r.roundNumber > this.lastRoundResolved) {
        this.lastRoundResolved = r.roundNumber;
        if (this.lastSnapshot) {
          this.lastSnapshot.phase = 'round-resolved';
          this.lastSnapshot.roundWinnerUserId = r.winnerUserId;
          this.lastSnapshot.lastRoundCorrectIndex = r.correctIndex;
          this.lastSnapshot.lastRoundAnswers = r.answers || {};
          // Battle Royale: surface elimination metadata
          this.lastSnapshot.eliminatedThisRound = r.eliminatedThisRound || [];
          this.lastSnapshot.aliveAfter = r.aliveAfter || null;
          this._emit();
        }
        if (r.nextRound) {
          // small delay so UI can render the resolution beat before flipping
          setTimeout(() => {
            if (this.destroyed || !this.lastSnapshot) return;
            this.lastSnapshot.phase = 'live';
            this.lastSnapshot.currentRound = r.nextRound.roundNumber;
            this.lastSnapshot.problem = r.nextRound.problem;
            this.lastSnapshot.roundDeadline = r.nextRound.deadline;
            this.lastSnapshot.roundStartedAt = r.nextRound.startedAt;
            this.lastSnapshot.answeredUserIds = [];
            this.lastSnapshot.roundWinnerUserId = null;
            this.lastSnapshot.lastRoundCorrectIndex = null;
            this.myAnswerChoice = -1;
            this._emit();
          }, 1400);
        }
      }
      if (r.matchFinished) {
        if (this.lastSnapshot) {
          this.lastSnapshot.phase = 'done';
          this.lastSnapshot.players = r.players || this.lastSnapshot.players;
          this.lastSnapshot.finalResult = this._computeMyResult(this.lastSnapshot.players);
          this._emit();
        }
        this.stopPolling();
      }
    }

    _absorbSnapshot(r) {
      const me = currentMe();
      const myId = me && me.userId;
      const players = (r.players || []).map(p => Object.assign({}, p));
      const opponent = players.find(p => p.userId !== myId) || null;
      const mePlayer = players.find(p => p.userId === myId) || null;

      const snap = {
        phase: r.status === 'live' ? 'live' : (r.status === 'done' ? 'done' : 'queued'),
        matchId: r.matchId,
        mode: r.mode || this.mode,
        gradeBand: r.gradeBand || this.gradeBand,
        inviteToken: r.inviteToken || this.lastSnapshot && this.lastSnapshot.inviteToken,
        players,
        me: mePlayer,
        opponent,
        currentRound: r.currentRound || 0,
        totalRounds: r.totalRounds || 10,
        problem: r.problem || null,
        roundStartedAt: r.roundStartedAt || null,
        roundDeadline: r.roundDeadline || null,
        answeredUserIds: r.answeredUserIds || [],
        roundWinnerUserId: r.roundWinnerUserId || null,
        lastRoundCorrectIndex: this.lastSnapshot ? this.lastSnapshot.lastRoundCorrectIndex : null,
        lastRoundAnswers: this.lastSnapshot ? this.lastSnapshot.lastRoundAnswers : null,
        myAnswerChoice: this.myAnswerChoice
      };
      if (snap.phase === 'done') {
        snap.finalResult = this._computeMyResult(players);
      }
      this.lastSnapshot = snap;
      this._emit();
    }

    _computeMyResult(players) {
      const me = currentMe();
      const myId = me && me.userId;
      if (!myId || !players || players.length === 0) return 'tie';
      const myP = players.find(p => p.userId === myId);
      const oppP = players.find(p => p.userId !== myId);
      if (!myP || !oppP) return 'tie';
      const myScore = myP.score || 0;
      const oppScore = oppP.score || 0;
      if (myScore > oppScore) return 'win';
      if (myScore < oppScore) return 'loss';
      return 'tie';
    }

    _emit() {
      try { this.onStateChange(Object.assign({}, this.lastSnapshot, { myAnswerChoice: this.myAnswerChoice })); }
      catch (e) { this.onError(e); }
    }
  }

  // Expose
  window.MatchEngine = MatchEngine;
})();
