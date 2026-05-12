/**
 * game-rewards.js — shared wallet-credit helper for every Games surface.
 *
 * Why this exists: the user explicitly asked for a unified scoring system —
 * cents earned in any Game must be added to the SAME wallet that the
 * Practice page tops up (so the toy marketplace, the header wallet pill,
 * and the trophy room all see one consistent balance).
 *
 * Mechanism: every reward call goes through the existing `earn` lambda
 * action (lambda/tutor.js#handleEarn — same one Practice + number-tetris
 * already use). That action:
 *   - Awards 1-5 cents per call (hard cap; bigger payouts call this in a loop)
 *   - Updates staar-users.balanceCents (spendable) + lifetimeCents (the
 *     $100 lifetime cap counter)
 *   - Updates lifetimeCorrect + lifetimeAnswered (every earn counts as
 *     one answered+correct question — so games show up in the stats row
 *     on the dashboard, alongside practice)
 *   - Enforces the grade-gate, the $100 lifetime cap, and per-section
 *     mastery lock
 *
 * Game-side daily cap (defense in depth): each gameSlug keeps a
 * localStorage daily-cents counter so a kid can't grind one game all day.
 * Per-game default cap is 50¢/day; tetris already uses this pattern and
 * keeps its own internal accounting (this helper doesn't double-cap it).
 *
 * Surfacing: after a successful award, dispatches a
 * `gradeearn:wallet-updated` event so the top-nav wallet pill re-renders.
 * Same event Practice uses.
 */
(function (global) {
  'use strict';

  const DAILY_CAP_CENTS_DEFAULT = 50;
  const STORAGE_PREFIX = 'gradeearn:game-daily:';
  const todayStr = () => new Date().toISOString().slice(0, 10);

  function getUserKey() {
    try {
      const u = global.STAARAuth && global.STAARAuth.currentUser && global.STAARAuth.currentUser();
      return (u && u.username) || 'guest';
    } catch (_) { return 'guest'; }
  }

  function loadDaily(gameSlug) {
    const key = STORAGE_PREFIX + getUserKey() + ':' + gameSlug;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const v = JSON.parse(raw);
        if (v && v.date === todayStr()) return { date: v.date, cents: Number(v.cents) || 0, key: key };
      }
    } catch (_) {}
    return { date: todayStr(), cents: 0, key: key };
  }
  function saveDaily(daily) {
    try { localStorage.setItem(daily.key, JSON.stringify({ date: daily.date, cents: daily.cents })); } catch (_) {}
  }

  function dispatchWalletEvent(balanceCents) {
    try {
      const ev = new CustomEvent('gradeearn:wallet-updated', { detail: { balanceCents } });
      document.dispatchEvent(ev);
    } catch (_) {}
  }

  /**
   * Award cents to the player's wallet from a Game.
   *
   * @param {number} amount - cents to award (1-N; will be split into 5¢
   *   server calls automatically so big payouts work)
   * @param {string} gameSlug - e.g. 'math-bingo', 'number-tetris'. Used
   *   for the daily-cap counter and the section key sent to the lambda.
   * @param {object} [opts]
   * @param {number} [opts.dailyCap=50] - per-game daily cap in cents
   * @param {string} [opts.grade] - kid's grade slug (so the lambda's
   *   grade-gate accepts the award; pass the active game's target grade)
   * @returns {Promise<{awarded: number, capped: boolean, offline: boolean}>}
   */
  async function award(amount, gameSlug, opts) {
    opts = opts || {};
    const dailyCap = Number(opts.dailyCap) || DAILY_CAP_CENTS_DEFAULT;
    const grade = String(opts.grade || '').trim();
    amount = Math.max(0, Math.floor(Number(amount) || 0));
    if (amount <= 0) return { awarded: 0, capped: false, offline: false };

    // Anonymous users can't earn — the lambda will reject. Bail early.
    const u = global.STAARAuth && global.STAARAuth.currentUser && global.STAARAuth.currentUser();
    if (!u) return { awarded: 0, capped: false, offline: false, anonymous: true };

    const daily = loadDaily(gameSlug);
    const room = Math.max(0, dailyCap - daily.cents);
    const toAward = Math.min(amount, room);
    if (toAward <= 0) return { awarded: 0, capped: true, offline: false };

    // Server caps at 5¢ per call — split bigger payouts into a loop.
    let remaining = toAward;
    let totalAwarded = 0;
    let lastBalance = null;
    let offline = false;

    while (remaining > 0) {
      const chunk = Math.min(5, remaining);
      try {
        const r = await global.STAARAuth.api('earn', {
          token: global.STAARAuth.token && global.STAARAuth.token(),
          cents: chunk,
          section: (grade || 'game') + '|' + gameSlug + '|none'
        });
        if (r && typeof r.balanceCents === 'number') {
          lastBalance = r.balanceCents;
          const credited = (typeof r.awardedCents === 'number') ? r.awardedCents : chunk;
          totalAwarded += credited;
          if (credited === 0 || r.capped) break; // server cap hit
        } else {
          offline = true;
          break;
        }
      } catch (_) {
        offline = true;
        break;
      }
      remaining -= chunk;
    }

    // Local daily-cap counter tracks what we attempted (so a server
    // failure doesn't let a grinder re-try over and over)
    daily.cents += toAward;
    saveDaily(daily);

    if (lastBalance != null) dispatchWalletEvent(lastBalance);
    return { awarded: totalAwarded, capped: room <= toAward && room > 0, offline };
  }

  /**
   * Convenience: convert a game session score to cents using a simple
   * tier table. Lets games that already track session points pay out
   * without re-implementing the same rules.
   *
   *   0   pts → 0¢   (no participation credit)
   *   1-49        → 1¢
   *   50-149      → 2¢
   *   150-299     → 3¢
   *   300-499     → 4¢
   *   500+        → 5¢ (max per session)
   */
  function scoreToCents(score) {
    score = Math.max(0, Number(score) || 0);
    if (score === 0)   return 0;
    if (score < 50)    return 1;
    if (score < 150)   return 2;
    if (score < 300)   return 3;
    if (score < 500)   return 4;
    return 5;
  }

  /**
   * Surface a small toast confirming the wallet credit. Falls back
   * silently if the toast helper isn't present on this surface.
   */
  function toastAward(cents, opts) {
    opts = opts || {};
    if (cents <= 0 && !opts.cappedMessage) return;
    try {
      if (global.STAARAuth && global.STAARAuth.toastWalletEarn) {
        global.STAARAuth.toastWalletEarn(cents);
        return;
      }
    } catch (_) {}
    // Native fallback: tiny inline toast
    try {
      const el = document.createElement('div');
      el.className = 'game-toast game-toast--reward';
      el.textContent = cents > 0
        ? '+' + cents + '¢ to your wallet'
        : (opts.cappedMessage || 'Daily reward cap reached');
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(13,29,58,0.95);border:1px solid rgba(251,191,36,0.4);color:#fff;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,0.4);';
      document.body.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch (_) {} }, 2400);
    } catch (_) {}
  }

  global.GradeEarnReward = {
    award,
    scoreToCents,
    toastAward,
    DAILY_CAP_CENTS_DEFAULT
  };
}(window));
