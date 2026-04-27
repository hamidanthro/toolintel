/**
 * GradeEarn — localStorage rebrand migration shim.
 *
 * One-time IIFE: copies any legacy "startest.*" keys to their
 * "gradeearn.*" equivalents on first page load post-rebrand,
 * then removes the legacy keys so the migration is idempotent.
 *
 * Lifetime: 90 days.
 * TODO(2026-07-26): Remove this file and its <script> tags from
 * every HTML page once the 90-day window expires.
 *
 * Order: this script MUST load before any other script that reads
 * gradeearn.* localStorage keys. Place it as the first script tag
 * in <head> or at the top of <body>.
 */
(function () {
  if (typeof localStorage === 'undefined') return;
  var KEYS = [
    'state',
    'state-detected',
    'state-detected-ts',
    'pwa-dismissed-until',
    'pwa-shown-this-session'
  ];
  for (var i = 0; i < KEYS.length; i++) {
    var k = KEYS[i];
    var legacyKey = 'startest.' + k;
    var newKey = 'gradeearn.' + k;
    try {
      var legacyVal = localStorage.getItem(legacyKey);
      if (legacyVal !== null) {
        if (localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, legacyVal);
        }
        localStorage.removeItem(legacyKey);
      }
    } catch (_) { /* private mode / quota / disabled — skip */ }
  }
})();
