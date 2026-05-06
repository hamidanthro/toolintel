/**
 * Fun-facts generator — Claude Sonnet 4.5.
 * Asks for a JSON array of { fact, citation } objects per (category, wowLevel) batch.
 *
 * No deps — uses Node 20+ built-in fetch.
 */
'use strict';

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const TIMEOUT_MS = 60000;

const WOW_LEVEL_DESC = {
  1: 'foundational — broad-appeal "wow" facts a lot of kids will react to',
  2: 'deeper — more specific or surprising than level 1; off the obvious path',
  3: 'mind-blower — genuinely uncommon, "tell your friend at recess" tier'
};

const CATEGORY_GUIDANCE = {
  animals: 'Diverse species. Behavior, biology, weird abilities. No frightening predator-kills-prey content.',
  space: 'Planets, stars, moons, missions, surprising scale, cool astronomy facts.',
  body: 'Human anatomy and biology. Cells, organs, senses, growth, weird body things kids find cool. No medical scariness.',
  food: 'Where foods come from, how they grow, surprising history, cultural variety.',
  texas: 'Texas history, geography, culture, food (BBQ/Tex-Mex), state symbols (bluebonnet, mockingbird, longhorn), notable Texans, sports heritage (Cowboys, Astros, Mavericks, Spurs, Rangers), cool Texas places (Big Bend, Padre Island, Enchanted Rock, Caprock, Hill Country), and Texas-firsts.',
  sports: 'Surprising sports facts, records, origins of games, why rules are weird, kid-friendly. Include diverse athletes.',
  inventions: 'Diverse inventors and contributors. Mae Jemison, Katherine Johnson, Hedy Lamarr, George Washington Carver, Lewis Latimer, Madam C.J. Walker, Lonnie Johnson, Mary Anderson, Patricia Bath, etc. Show invention origin stories. Avoid only-white-male-inventors-from-textbooks.',
  history: 'Surprising historical moments kid-readable. Avoid violent or politically-charged content. Cool ancient civilizations, weird old laws, surprising firsts.',
  'math-numbers': 'Number facts, math curiosities, prime numbers, infinity, geometry surprises, things that "feel like magic but are math".',
  'weird-funny': 'Random surprising facts that don\'t fit other categories. Funny science, oddly-specific records, weird collective nouns.',
  // §73 — Phase 5 new categories.
  dinosaurs: 'T-rex, herbivores, extinction theories, modern bird descendants, cool dig sites worldwide. Specific species names and dig locations preferred. Include diverse paleontologists (Mary Anning, Diana Salazar Burrows, Bolortsetseg Minjin, Sue Hendrickson). Avoid graphic predation content.',
  music: 'Instruments and how they make sound, surprising music facts, world music traditions, kid-friendly artists across genres and cultures (Yo-Yo Ma, Aretha Franklin, Bach, Bad Bunny, Ravi Shankar, Miriam Makeba, Hiromi Uehara). Origins of weird instruments, sound physics, music records.',
  geography: 'World wonders, weird places (Door to Hell, Salar de Uyuni, Marble Caves, Hashima Island), country facts, longest rivers, tallest mountains, why oceans are salty. Equity is mandatory: include Africa, South America, Asia, Pacific Islands, not just US/Europe.',
  'robots-tech': 'Internet history, video game origins, computer milestones, AI basics, robotic surgery, rovers on Mars (Perseverance, Curiosity, Zhurong). Include diverse pioneers — Ada Lovelace, Margaret Hamilton, Grace Hopper, Mark Dean, Joy Buolamwini, Ayanna Howard. Modern roboticists welcome.',
  mythology: 'Greek + Norse + Egyptian + Mesoamerican + Native American + Hindu + West African (Anansi) + Japanese + Polynesian myths. Kid-friendly tellings only. NO violence, NO scary content. Include diverse traditions equally — do not over-index on Greek/Norse.'
};

function buildSystemPrompt() {
  return `You are a children's content writer. You write surprising, true facts that delight 3rd–4th graders.\nYour voice is like a smart older sibling at the dinner table — confident, specific, fun.\n\nRules (every fact must satisfy ALL):\n- Reading level: 3rd grade, must work for 8-year-olds reading at 2nd-grade level.\n- Vocabulary: top ~1000 most common English words + concrete proper nouns (Octopus, Mars, Hedy Lamarr, Texas). No \"fascinating,\" \"phenomenon,\" \"remarkable,\" \"extraordinary,\" \"approximately,\" \"complex,\" \"essentially,\" or similar adult-register words.\n- Sentence cap: 15 words per sentence (count carefully).\n- 1-3 sentences total per fact, ≤40 words total.\n- First sentence = the wow. Optional 2nd-3rd = brief explanation.\n- Specific numbers preferred (\"86 billion neurons\" beats \"lots of neurons\").\n- NO scary, violent, sexual, gross-beyond-fun-gross, or politically charged content.\n- Every fact must be verifiable and TRUE. Provide a brief internal citation (source/proof) — never shown to the kid.\n- No duplicates within this batch. Each fact must be a different topic/angle.\n- Don't assume background knowledge a 3rd-grader wouldn't have.\n\nOutput format: a single JSON array, no prose around it, no markdown fences.\nEach element: { \"fact\": \"...\", \"citation\": \"...\" }`;
}

function buildUserPrompt({ category, wowLevel, count, avoidList }) {
  const guidance = CATEGORY_GUIDANCE[category] || '';
  const levelDesc = WOW_LEVEL_DESC[wowLevel] || '';
  let avoid = '';
  if (Array.isArray(avoidList) && avoidList.length) {
    avoid = `\n\nAvoid topics already covered in this category (don\'t repeat these angles):\n` +
      avoidList.slice(0, 40).map(s => '- ' + String(s).slice(0, 110)).join('\n');
  }
  return `Generate ${count} unique fun facts.\n\nCategory: ${category}\nGuidance: ${guidance}\n\nWow level: ${wowLevel} (${levelDesc})\n\n${avoid}\n\nRemember: 3rd-grade reading level, ≤15 words per sentence, ≤40 words per fact, JSON array only.`;
}

async function callAnthropic(systemPrompt, userMessage, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Generate facts for one (category, wowLevel) bucket.
 * Returns array of { fact, citation } — no validation, no IDs.
 */
async function generateFacts({ category, wowLevel, count, avoidList, apiKey }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const system = buildSystemPrompt();
  const user = buildUserPrompt({ category, wowLevel, count, avoidList });
  const resp = await callAnthropic(system, user, apiKey);
  const raw = resp && resp.content && resp.content[0] && resp.content[0].text;
  if (!raw) throw new Error('Anthropic returned no text content');
  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(`generator returned non-JSON: ${err.message} — first 200: ${String(raw).slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('generator did not return a JSON array');
  return parsed.filter(x => x && typeof x === 'object' && typeof x.fact === 'string');
}

module.exports = { generateFacts, MODEL };
