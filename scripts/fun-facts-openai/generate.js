/**
 * Fun-facts generator — OpenAI gpt-4o fork.
 *
 * Mirrors scripts/fun-facts/generate.js (which uses Claude Sonnet 4.5).
 * Anthropic billing is at $0 right now; this is the "ship now" path.
 *
 * Output shape unchanged: returns [{ fact, citation }, ...]
 */
'use strict';

const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
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
  food: 'Where foods come from, how they grow, surprising history, GLOBAL cultural variety. Encourage foods from many countries — sushi (Japan), tacos (Mexico), pad thai (Thailand), jollof rice (West Africa), pierogi (Poland), tagine (Morocco). Avoid food-as-cultural-stereotype — be respectful and accurate.',
  texas: 'Texas history, geography, culture, food (BBQ/Tex-Mex), state symbols (bluebonnet, mockingbird, longhorn), notable Texans, sports heritage (Cowboys, Astros, Mavericks, Spurs, Rangers), cool Texas places (Big Bend, Padre Island, Enchanted Rock, Caprock, Hill Country), and Texas-firsts.',
  sports: 'Surprising sports facts, records, origins of games, why rules are weird, kid-friendly. Include diverse athletes.',
  inventions: 'Diverse inventors and contributors. Mae Jemison, Katherine Johnson, Hedy Lamarr, George Washington Carver, Lewis Latimer, Madam C.J. Walker, Lonnie Johnson, Mary Anderson, Patricia Bath, etc. Show invention origin stories. Avoid only-white-male-inventors-from-textbooks.',
  history: 'Surprising historical moments kid-readable. Avoid violent or politically-charged content. Cool ancient civilizations, weird old laws, surprising firsts.',
  'math-numbers': 'Number facts, math curiosities, prime numbers, infinity, geometry surprises, things that "feel like magic but are math".',
  'weird-funny': 'Random surprising facts that don\'t fit other categories. Funny science, oddly-specific records, weird collective nouns.',
  dinosaurs: 'T-rex, herbivores, extinction theories, modern bird descendants, cool dig sites worldwide. Specific species names and dig locations preferred. Include diverse paleontologists (Mary Anning, Diana Salazar Burrows, Bolortsetseg Minjin, Sue Hendrickson). Avoid graphic predation content.',
  music: 'Instruments and how they make sound, surprising music facts, world music traditions, kid-friendly artists across genres and cultures (Yo-Yo Ma, Aretha Franklin, Bach, Bad Bunny, Ravi Shankar, Miriam Makeba, Hiromi Uehara). Origins of weird instruments, sound physics, music records.',
  geography: 'World wonders kids love (Pyramids of Giza, Great Wall of China, Eiffel Tower, Mount Everest, Amazon Rainforest, Sahara, Niagara Falls, Iguazu Falls). Weird places (Salar de Uyuni mirror salt flat, rainbow mountains in Peru, glowworm caves in New Zealand). Country facts (Iceland has more sheep than people, Australia has more kangaroos than people, Singapore is one city + one country). Longest rivers, tallest mountains, why oceans are salty. EQUITY MANDATORY: include Africa, South America, Asia, Pacific Islands. Avoid current borders disputes or political geography — stick to physical / cultural / natural wonder content.',
  'robots-tech': 'Internet history, video game origins, computer milestones, AI basics, robotic surgery, rovers on Mars (Perseverance, Curiosity, Zhurong). Include diverse pioneers — Ada Lovelace, Margaret Hamilton, Grace Hopper, Mark Dean, Joy Buolamwini, Ayanna Howard. Modern roboticists welcome.',
  mythology: 'Greek + Norse + Egyptian + Mesoamerican + Native American + Hindu + West African (Anansi) + Japanese + Polynesian myths. Kid-friendly tellings only. NO violence, NO scary content. Include diverse traditions equally — do not over-index on Greek/Norse.'
};

function buildSystemPrompt(gradeBand) {
  // gradeBand: 'k-2' | '3-4' | '5-8' | null (default 3-4)
  const band = gradeBand || '3-4';
  const readingLevel = band === 'k-2'
    ? 'Reading level: kindergarten to 2nd grade. Sentences ≤14 words. Vocabulary: top ~500 most common words + concrete nouns. NO words like "fascinating", "approximately", "phenomenon", "process", "particular", "approximately". Prefer single-syllable verbs.'
    : band === '5-8'
      ? 'Reading level: 5th-8th grade. Sentences ≤20 words. Vocabulary may include precise scientific or historical terms (genus names, scientific units, specific years). Still concrete and specific.'
      : 'Reading level: 3rd grade, must work for 8-year-olds reading at 2nd-grade level. Sentences ≤15 words. Vocabulary: top ~1000 most common English words + concrete proper nouns (Octopus, Mars, Hedy Lamarr, Texas). No "fascinating," "phenomenon," "remarkable," "extraordinary," "approximately," "complex," "essentially," or similar adult-register words.';

  return `You are a children's content writer. You write surprising, true facts that delight kids in the United States.
Your voice is like a smart older sibling at the dinner table — confident, specific, fun.

Rules (every fact must satisfy ALL):
- ${readingLevel}
- 1-3 sentences total per fact, ≤40 words total.
- First sentence = the wow. Optional 2nd-3rd = brief explanation.
- Specific numbers preferred ("86 billion neurons" beats "lots of neurons").
- Every fact must be verifiable and TRUE. Provide a brief internal citation (source/proof) — never shown to the kid.
- No duplicates within this batch. Each fact must be a different topic/angle.
- Don't assume background knowledge a kid wouldn't have.

Global content is welcome and encouraged:
- Kids in the USA love hearing about other countries, animals, foods, and cultures.
- Stay relatable and concrete: world animals (capybaras, kiwis, pandas), foods (tom yum, jollof, sushi), cool places (Pyramids of Giza, Great Wall, Sahara, Amazon), traditions (cherry blossom season in Japan, Carnival in Brazil), and weird customs.
- Spread coverage across continents — don't over-index on US/Europe.

Strictly avoid (NO EXCEPTIONS):
- Politics, current events, elections, parties, or political figures.
- Wars, military operations, or conflicts (ancient or modern).
- Religion or religious practices, EXCEPT in the mythology category where ancient myths are explicitly the topic.
- Divisive figures or topics families could disagree about.
- Scary, violent, sexual, or gross-beyond-fun-gross content.
- Death, gore, illness, or anything that could upset a young child.
- Anything controversial — if a fact would make a parent uncomfortable, skip it.

Output format: a single JSON object with key "facts" whose value is the array.
Each element: { "fact": "...", "citation": "..." }
Example: {"facts":[{"fact":"...","citation":"..."}]}
No prose around it, no markdown fences.`;
}

function buildUserPrompt({ category, wowLevel, count, avoidList, gradeBand }) {
  const guidance = CATEGORY_GUIDANCE[category] || '';
  const levelDesc = WOW_LEVEL_DESC[wowLevel] || '';
  let avoid = '';
  if (Array.isArray(avoidList) && avoidList.length) {
    avoid = `\n\nAvoid topics already covered (don't repeat these angles):\n` +
      avoidList.slice(0, 40).map(s => '- ' + String(s).slice(0, 110)).join('\n');
  }
  const bandTxt = gradeBand === 'k-2' ? 'Targeting K-2 readers (5-7 years old). Use very simple, concrete language. Single-clause sentences are best.'
                : gradeBand === '5-8' ? 'Targeting 5th-8th grade readers (10-13 years old). They like depth, scientific specificity, edgy weirdness, and history.'
                : 'Targeting 3rd-4th grade readers (8-9 years old).';
  return `Generate ${count} unique fun facts.

Category: ${category}
Guidance: ${guidance}

Wow level: ${wowLevel} (${levelDesc})

${bandTxt}${avoid}

Remember: appropriate reading level for the band, ≤40 words per fact, JSON object with "facts" array only.`;
}

async function callOpenAI(systemPrompt, userMessage, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate facts for one (category, wowLevel, gradeBand) bucket.
 * Returns array of { fact, citation } — no validation, no IDs.
 */
async function generateFacts({ category, wowLevel, count, avoidList, apiKey, gradeBand }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const system = buildSystemPrompt(gradeBand);
  const user = buildUserPrompt({ category, wowLevel, count, avoidList, gradeBand });
  const resp = await callOpenAI(system, user, apiKey);
  const raw = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  if (!raw) throw new Error('OpenAI returned no message content');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    throw new Error(`generator returned non-JSON: ${err.message} — first 200: ${String(raw).slice(0, 200)}`);
  }
  // gpt-4o with json_object mode returns object; expect facts array under "facts" key
  const arr = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed.facts) ? parsed.facts
            : Array.isArray(parsed.data) ? parsed.data
            : null;
  if (!arr) throw new Error('generator did not return a facts array — keys: ' + Object.keys(parsed).join(','));
  return arr.filter(x => x && typeof x === 'object' && typeof x.fact === 'string');
}

module.exports = { generateFacts, MODEL };
