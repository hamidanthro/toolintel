// GradeEarn — Reading stopwords (§77 Phase C tap-any-word)
//
// High-frequency English words that we DON'T offer definitions for.
// Tap-any-word in a passage skips these — kids already know them, and
// asking gpt-4o-mini to "define 'the'" is a waste of latency + cost.
//
// Source: top ~80 words from Dolch + Fry sight-word lists (Grade K-3
// most-frequent). Also includes common contractions split by apostrophe.
//
// Public surface: window.STAARStopwords.{ has, normalize }
//   has(word)      → boolean (case-insensitive, strips punctuation)
//   normalize(w)   → lowercased, punctuation-stripped form
(function () {
  'use strict';

  const STOPWORDS = new Set([
    // Articles + determiners
    'a','an','the','this','that','these','those','my','your','his','her',
    'its','our','their','some','any','no','all','each','every','both',
    // Pronouns
    'i','me','we','us','you','he','him','she','it','they','them',
    'who','whom','which','what','whose',
    // Auxiliary + common verbs
    'is','am','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','can','could','should','shall',
    'may','might','must','get','got','go','went','come','came',
    'say','said','see','saw','make','made','take','took','give','gave',
    'know','knew','think','thought','look','looked','want','wanted',
    'put','set','let','run','ran','find','found','tell','told',
    'ask','asked','feel','felt','try','tried','leave','left','call','called',
    // Conjunctions + prepositions
    'and','or','but','so','if','as','than','then','because','though',
    'while','when','where','why','how','before','after','until','since',
    'to','of','in','on','at','by','for','with','from','into','onto',
    'about','out','off','up','down','over','under','through','around',
    'between','among','near','against','without','within',
    // Adverbs + intensifiers
    'not','no','yes','very','just','only','also','too','more','most',
    'less','least','much','many','few','little','some','any','again',
    'always','never','ever','often','sometimes','here','there','now','then',
    // Numbers + simple quantifiers
    'one','two','three','four','five','six','seven','eight','nine','ten',
    'first','second','last','next','other','another','same','new','old'
  ]);

  function normalize(w) {
    if (w == null) return '';
    return String(w).toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  }

  function has(word) {
    const n = normalize(word);
    return n.length === 0 || STOPWORDS.has(n);
  }

  window.STAARStopwords = { has, normalize };
})();
