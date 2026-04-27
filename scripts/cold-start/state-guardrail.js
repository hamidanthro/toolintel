/**
 * State-specificity guardrail for generated content.
 *
 * Goal: every question saved to staar-content-pool must NOT contain any
 * cross-state contamination. A question generated for Alabama must not
 * mention Texas, the Alamo, San Antonio, etc. A question generated for
 * Texas IS allowed to mention Texas-related things (flagship style).
 *
 * Implementation: a keyword → owner-slug map. If a non-owner-state's
 * generated text contains the keyword, reject it.
 */
const { ALL_STATE_SLUGS, getStateRecord } = require('./states-grades');

// State name → owner-slug. Built from states-data.
function buildStateNameMap() {
  const map = {};
  for (const slug of ALL_STATE_SLUGS) {
    const r = getStateRecord(slug);
    if (!r) continue;
    if (r.name) map[r.name.toLowerCase()] = slug;
  }
  return map;
}

// Hand-curated landmarks/cities/regions strongly tied to specific states.
// Keyword (lowercase) → owner state slug. Owner-state may use freely;
// any other state's question containing the keyword is rejected.
const LANDMARK_OWNERS = {
  // Texas
  'alamo': 'texas',
  'san antonio': 'texas',
  'houston': 'texas',
  'dallas': 'texas',
  'austin': 'texas',
  'fort worth': 'texas',
  'el paso': 'texas',
  'rio grande': 'texas',
  'staar': 'texas',
  'teks': 'texas',
  // California
  'hollywood': 'california',
  'los angeles': 'california',
  'san francisco': 'california',
  'san diego': 'california',
  'golden gate': 'california',
  'disneyland': 'california',
  'yosemite': 'california',
  'sequoia': 'california',
  'silicon valley': 'california',
  'caaspp': 'california',
  // Florida
  'disney world': 'florida',
  'walt disney world': 'florida',
  'orlando': 'florida',
  'miami': 'florida',
  'everglades': 'florida',
  'key west': 'florida',
  'tampa': 'florida',
  'jacksonville': 'florida',
  'b.e.s.t.': 'florida',
  // New York
  'statue of liberty': 'new-york',
  'times square': 'new-york',
  'empire state': 'new-york',
  'central park': 'new-york',
  'manhattan': 'new-york',
  'brooklyn': 'new-york',
  'niagara falls': 'new-york',
  'broadway': 'new-york',
  // Other strong state-linked landmarks
  'mount rushmore': 'south-dakota',
  'badlands': 'south-dakota',
  'grand canyon': 'arizona',
  'sedona': 'arizona',
  'phoenix': 'arizona',
  'tucson': 'arizona',
  'yellowstone': 'wyoming',
  'jackson hole': 'wyoming',
  'mardi gras': 'louisiana',
  'new orleans': 'louisiana',
  'french quarter': 'louisiana',
  'bayou': 'louisiana',
  'las vegas': 'nevada',
  'reno': 'nevada',
  'lake tahoe': 'nevada',
  'seattle': 'washington',
  'mount rainier': 'washington',
  'space needle': 'washington',
  'puget sound': 'washington',
  'boston': 'massachusetts',
  'fenway': 'massachusetts',
  'harvard': 'massachusetts',
  'cape cod': 'massachusetts',
  'chicago': 'illinois',
  'lake michigan': 'illinois',
  'sears tower': 'illinois',
  'willis tower': 'illinois',
  'denver': 'colorado',
  'rocky mountains': 'colorado',
  'pikes peak': 'colorado',
  'philadelphia': 'pennsylvania',
  'liberty bell': 'pennsylvania',
  'pittsburgh': 'pennsylvania',
  'mount mckinley': 'alaska',
  'denali': 'alaska',
  'anchorage': 'alaska',
  'fairbanks': 'alaska',
  'juneau': 'alaska',
  'hawaiian islands': 'hawaii',
  'honolulu': 'hawaii',
  'pearl harbor': 'hawaii',
  'mauna kea': 'hawaii',
  'waikiki': 'hawaii',
  'detroit': 'michigan',
  'great lakes': 'michigan',
  'mackinac': 'michigan',
  'gateway arch': 'missouri',
  'st. louis': 'missouri',
  'kansas city': 'missouri',
  'mount hood': 'oregon',
  'crater lake': 'oregon',
  'portland, oregon': 'oregon',
  'graceland': 'tennessee',
  'great smoky mountains': 'tennessee',
  'nashville': 'tennessee',
  'memphis': 'tennessee',
  'french broad': 'north-carolina',
  'charlotte, north carolina': 'north-carolina',
  'outer banks': 'north-carolina',
  'kitty hawk': 'north-carolina',
  'savannah': 'georgia',
  'stone mountain': 'georgia',
  'atlanta': 'georgia',
  'churchill downs': 'kentucky',
  'kentucky derby': 'kentucky',
  'mammoth cave': 'kentucky',
  'louisville': 'kentucky',
  'mall of america': 'minnesota',
  'twin cities': 'minnesota',
  'minneapolis': 'minnesota',
  'st. paul': 'minnesota',
  'salt lake city': 'utah',
  'arches national park': 'utah',
  'zion national park': 'utah',
  'bryce canyon': 'utah',
  'gettysburg': 'pennsylvania',
};

const STATE_NAME_MAP = buildStateNameMap();

/**
 * Validate that the given content is appropriate for stateSlug.
 *
 * Returns array of error strings (empty array = valid).
 *
 * @param {object} item - generated question (question, choices, explanation, passage?)
 * @param {string} stateSlug - the target state for this question
 */
function validateStateSpecificity(item, stateSlug) {
  if (!stateSlug) return ['stateSlug missing'];
  const targetRecord = getStateRecord(stateSlug);
  if (!targetRecord) return [`unknown state slug: ${stateSlug}`];

  const targetName = (targetRecord.name || '').toLowerCase();

  // Combine all text fields that could leak cross-state references
  const parts = [
    item.question || '',
    Array.isArray(item.choices) ? item.choices.join(' ') : '',
    item.explanation || '',
    item.passage?.text || '',
    item.passage?.title || ''
  ];
  const lower = parts.join('  ').toLowerCase();

  const errors = [];

  // Check every other state's name
  for (const [otherName, otherSlug] of Object.entries(STATE_NAME_MAP)) {
    if (otherSlug === stateSlug) continue;
    if (otherName === targetName) continue;
    // Word-boundary match to avoid false positives (e.g. "hispanic" containing "panic")
    const re = new RegExp(`\\b${otherName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) {
      errors.push(`mentions other state: ${otherName}`);
      break; // one strike is enough
    }
  }

  // Check landmarks
  if (!errors.length) {
    for (const [keyword, ownerSlug] of Object.entries(LANDMARK_OWNERS)) {
      if (ownerSlug === stateSlug) continue;
      // simple substring match (landmarks often have spaces/punctuation already)
      if (lower.includes(keyword)) {
        errors.push(`mentions ${ownerSlug} landmark: ${keyword}`);
        break;
      }
    }
  }

  return errors;
}

module.exports = {
  validateStateSpecificity,
  LANDMARK_OWNERS,
  STATE_NAME_MAP
};
