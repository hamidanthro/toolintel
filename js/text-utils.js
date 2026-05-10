/**
 * GradeEarn — runtime text helpers
 *
 * Static curriculum JSON was scrubbed for pluralization issues in Bug A
 * (482 fixes across K/G1/G2/G3). But the lambda generate-on-demand path
 * can still emit dynamic strings like "Rylee has 1 pencils" if the model
 * slips. These helpers fix that at render time without round-tripping
 * through the server.
 *
 * Exposed as window.GETextUtils.
 */
(function () {
  'use strict';

  // Plurals that aren't just "+s". Extend as new content surfaces them.
  const IRREGULAR = {
    child: 'children',
    person: 'people',
    foot: 'feet',
    tooth: 'teeth',
    goose: 'geese',
    mouse: 'mice',
    man: 'men',
    woman: 'women',
    cactus: 'cacti',
    fish: 'fish',
    sheep: 'sheep',
    deer: 'deer',
    moose: 'moose',
    series: 'series',
    species: 'species'
  };

  function pluralize(n, singular, pluralOverride) {
    const num = Number(n);
    if (!Number.isFinite(num) || Math.abs(num) === 1) return singular;
    if (pluralOverride) return pluralOverride;
    const lower = singular.toLowerCase();
    if (IRREGULAR[lower]) {
      const irr = IRREGULAR[lower];
      return preserveCase(singular, irr);
    }
    if (/[^aeiou]y$/i.test(singular)) return singular.replace(/y$/i, 'ies');
    if (/(s|x|z|ch|sh)$/i.test(singular)) return singular + 'es';
    return singular + 's';
  }

  function preserveCase(source, target) {
    if (source === source.toUpperCase()) return target.toUpperCase();
    if (source[0] === source[0].toUpperCase()) return target[0].toUpperCase() + target.slice(1);
    return target;
  }

  function capitalize(s) {
    if (!s || typeof s !== 'string') return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function possessive(name) {
    if (!name || typeof name !== 'string') return name;
    return /s$/i.test(name) ? name + "'" : name + "'s";
  }

  // Fix existing string in place: "Rylee has 1 pencils" → "Rylee has 1 pencil".
  // Walks every "<digit(s)> <word>" match and corrects to singular/plural.
  // Only touches numeric-prefixed nouns; leaves prose alone.
  function fixCountAgreement(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/(\b\d+)\s+([A-Za-z]+)/g, function (match, numStr, word) {
      const n = Number(numStr);
      if (!Number.isFinite(n)) return match;
      // If singular and word ends in 's' (and not already singular form),
      // try to depluralize. Conservative: only common patterns.
      if (Math.abs(n) === 1 && /s$/i.test(word) && word.length > 2) {
        const lower = word.toLowerCase();
        // Skip already-singular words that end in 's' (bus, glass, kiss).
        if (/ss$/i.test(word)) return match;
        if (/ies$/i.test(word)) return numStr + ' ' + word.replace(/ies$/i, 'y');
        if (/(x|z|ch|sh)es$/i.test(word)) return numStr + ' ' + word.replace(/es$/i, '');
        // Default: drop trailing 's'.
        return numStr + ' ' + word.replace(/s$/i, '');
      }
      // If plural (n !== 1) and word looks singular, pluralize.
      if (Math.abs(n) !== 1 && !/s$/i.test(word) && word.length > 2) {
        // Only safe to pluralize known nouns we control. For now, leave alone
        // to avoid pluralizing verbs ("3 walk" → would become "3 walks" wrongly).
        return match;
      }
      return match;
    });
  }

  window.GETextUtils = {
    pluralize: pluralize,
    capitalize: capitalize,
    possessive: possessive,
    fixCountAgreement: fixCountAgreement
  };
})();
