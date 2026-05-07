# Texas STAAR Reading — Grade 3 Knowledge Pack

**Last updated:** 2026-05-07
**Scope:** Grade 3, realistic fiction + informational genres
**Authors:** Hamid + Owners' Room (Test Specialist, Reading Editor, Cultural Reviewer)
**Used by:** `scripts/reading/generate-passage.js`, `scripts/reading/generate-question.js`, `scripts/reading/judge-passage.js`, `scripts/reading/judge-question.js` (Phase 1 — not yet shipped)

---

## 1. Test format (grade 3) — STAAR redesign era (2023+)

The Spring 2024 form is the most recent fully-released grade 3 RLA test (PDF answer key + rationales + scoring guide are all public; the test itself is online-only via Cambium since 2022-23 — only 2021 and 2022 forms exist as full-text PDFs). All numbers below are extracted from the **Spring 2024** released materials unless flagged.

| Fact | Value | Source |
|---|---|---|
| Total items | **41** | 2024 answer key |
| Reporting Category 1 (Reading) | **25 items** (items 1-25) | 2024 answer key |
| Reporting Category 2 (Composition) | **16 items** (items 26-41) | 2024 answer key |
| Reading passages | **4** (drama + fiction + informational + paired info/fiction) | 2024 rationales |
| Composition stimulus passages | **3-4 short editing/revising passages** | 2024 rationales |
| Item type — Multiple Choice (4 options) | **37** | 2024 answer key |
| Item type — Multiselect (pick 2 of 5) | **1** | 2024 answer key (item 4) |
| Item type — Highlight Text (hot-text) | **1** | 2024 answer key (item 6) |
| Item type — Inline Choice (drop-down) | **1** | 2024 answer key (item 40) |
| Item type — Short Constructed Response (SCR) | **2** (1-2 sentences + evidence) | 2024 answer key (items 13, 30) |
| Item type — Extended Constructed Response (ECR) | **1** (10 pts, opinion essay) | 2024 answer key (item 25, TEKS 12.B) |
| Total maximum points | **55** | computed |
| Readiness vs Supporting standards | ~55 / 45 split favoring Readiness | 2024 answer key |
| Format | **Online via Cambium** (2022-23 forward) | TEA STAAR Redesign |
| Session limit | 4 hours (state policy; not per-item) | TEA |

**Pre-redesign 2022 form for reference:** 34 items, all 4-option MC, no constructed response, no paired passages, no composition section. Useful as a stem-and-distractor library; skip the format counts.

**v1 scope decision:** ship multiple-choice only. SCR, ECR, multiselect, hot-text, and inline-choice are out of scope for the kid UI's first pass — they require typed-input + rubric scoring + drag interaction the practice flow doesn't support yet.

## 2. Passage characteristics

### Realistic fiction

- **Word count:** **370-450 words** typical (verified: `The Unwelcome Neighbor` 2022 — ~440; `Cheese for Dinner` 2022 — ~370). Don't go below 300; don't exceed 480.
- **Paragraph count:** 13-19 paragraphs typical. Each paragraph 1-4 sentences.
- **Lexile band:** ~520-820L (CCSS stretch band for grade 3; **TEA does not publish Lexile cuts** — STAAR uses TEKS-based readability rather than Lexile. Treat as approximate guide; the Flesch-Kincaid target in §8 is the operational rule.)
- **Genre conventions:** character + setting + problem (page-1 establishment), 2-3 escalating beats, resolution. STAAR fiction at grade 3 does NOT require strong character arc — slice-of-life works.
- **Common topics observed in released fiction (2021, 2022):** fables/folktales (cross-cultural — Coyote/Conejo from Mexico; Panchatantra retelling from India), animal protagonists in everyday situations, a kid + a relative + a problem. **For our v1 we ship realistic fiction only**, so:
  - Friendship problems (lost item, misunderstanding, new kid)
  - Family small-stakes (missing pet, dropped craft, sibling shares space)
  - School/neighborhood (lost-and-found, science fair, art project)
  - Hobby starts (picking up an instrument, learning a recipe)
  - Volunteering / helping (food drive, library, neighbor garden)
  - Nature outings (creek walk, bird watching, beach day)
  - Discovery moments (finding something old in a closet, learning a story from grandparent)
  - Mild adversity overcome (rainy-day picnic moves indoors and is better)

### Informational

- **Word count:** **470-700 words** typical (verified: `Book Clubs Are for Everyone!` 2022 — ~470; `Mission Blue` 2022 — ~580; 2024 soil passage — 19+ paragraphs, ~600-700). Don't go below 400; don't exceed 750.
- **Paragraph count:** 7-19 paragraphs. Often divided by **section headings** (e.g. "Hope Spots", "Beyond the Ocean", "Talking without Words", "Bringing Groups Together"). Headings are functional — questions reference them.
- **Lexile band:** same as fiction (~520-820L approximate).
- **Genre conventions:** topic introduction → supporting facts grouped by sub-theme → optional call-to-action close. Always factual, always verifiable. Often includes a **graphic** (photo, illustration, map, chart) — questions reference it.
- **Common topics observed (2021, 2022, 2024):** ocean conservation (`Mission Blue`), how things work (`More Than Air` — wind instruments through history), Earth/soil science, biographies of accessible figures, persuasive on kid topics (`Book Clubs Are for Everyone!`). For our v1:
  - Animals (behavior, habitats, specific species — kid-friendly)
  - Earth science (rocks, soil, water cycle, weather, deserts, oceans — at grade 3 depth)
  - How things work (instruments, simple machines, kitchen science)
  - Biographies of accessible figures (Patricia Bath, Mae Jemison, Wilma Rudolph, etc. — diverse, specific)
  - Texas places + landmarks (Padre Island, Big Bend, Hill Country) — historically accurate
  - Persuasive on kid topics (gardening, recycling, library use, walking instead of driving short distances)

### Always include in passages

- **Paragraph numbering** visible to the kid. Questions reference "paragraph 4" or "paragraphs 6 through 11" verbatim.
- **A title.** Often imaginative or topic-direct.
- **Author attribution** when generated. For AI content this becomes "Adapted for GradeEarn" or similar — never claim a real human authored it.

## 3. TEKS strands tested in grade 3 RLA

Strand codes follow the scheme `[Strand Number].[Letter][optional roman]` (e.g. `6.E`, `9.Diii`). The 2024 form maps every item to a TEKS code; below are the comprehension-focused strands relevant to v1 scope. **Composition strands (11, 12) are out of scope** — they're the editing/revising and essay items we don't ship yet.

| Strand | Focus | Sub-codes seen | 2024 frequency |
|---|---|---|---|
| **3 — Vocabulary** | meaning of words in context, multiple-meaning words, affixes, root words | 3.A, 3.B, 3.D | 3 items |
| **6 — Multiple genres / response** | text evidence, paired-text synthesis, making connections | 6.C, 6.E, 6.G | **6 items (most-tested reading strand)** |
| **7 — Multiple genres continued** | paraphrase, supporting details | 7.C, 7.D | 2 items |
| **8 — Author's purpose & craft** | figurative language, organizational patterns (chronology, comparison, cause-effect), print/graphic features | 8.B, 8.C, 8.D | 3 items |
| **9 — Multiple genres recognition** | theme, setting, characters/plot in fiction | 9.Di (theme), 9.Dii (setting), 9.Diii (characters/plot) | 4 items |
| **10 — Author's purpose** | author's purpose, text structure, use of print/graphic features | 10.A, 10.C, 10.D, 10.E | 4 items + 1 SCR |

**Plain-English descriptions for v1 generator:**

- **3.A:** What does this multiple-meaning word mean **as used in this sentence**?
- **3.B:** Use **context clues** to figure out what this word means.
- **3.D:** What does this **prefix/suffix/root** tell you about the word's meaning?
- **6.C:** **Make a connection** between this text and another text, your own life, or the world.
- **6.E:** **Synthesize** information across two paired texts (compare/contrast).
- **6.G:** Find **text evidence** that supports a stated idea (often multiselect "pick the 2").
- **7.C:** **Paraphrase** what a section says in your own words.
- **7.D:** Find the **details that support** a key idea or claim.
- **8.B:** Identify **figurative language** (similes, metaphors, sensory details).
- **8.C:** Identify the **organizational pattern** (chronological? compare/contrast? cause/effect?).
- **8.D:** What is the **purpose of this print or graphic feature** (heading, photo, chart, caption)?
- **9.Di:** What is the **theme** (lesson) of the story?
- **9.Dii:** How is the **setting** important to the story?
- **9.Diii:** What does this tell you about the **character** or **plot**?
- **10.A:** What is the author's **purpose** for writing this?
- **10.C:** How is the text **structured/organized**?
- **10.D:** Why does the author include this **print or graphic feature**?
- **10.E:** What does this **print feature** (heading, caption, bold word) help the reader understand?

## 4. Question types in scope (v1)

### Multiple choice (4 options) — the only type we ship in v1

- 4 lettered options A/B/C/D
- Only ONE answer is correct
- Distractor design rules (judge enforces — see §7):
  - Each wrong answer must be **plausible given a misreading** of the text — never random fillers
  - At least 2 distractors should reference **real text content** but answer a different question
  - Avoid "all of the above" / "none of the above" — TEA never uses these at grade 3

### Question stems used at grade 3 (verbatim from 2022 + 2024 released)

Stems below are real STAAR phrasings — generators should match this register, not invent paraphrases.

**Vocabulary in context:**
- "What does the word ____ mean **in paragraph X**?"
- "**In paragraph X**, the prefix/suffix ____ helps the reader understand that ____ means —"
- "What is the meaning of the word ____ **in paragraph X**?"

**Key idea / details:**
- "What **key idea** about ____ do the details in paragraphs X **and** Y best support?"
- "Based on the information in paragraphs X **through** Y, what can the reader conclude about ____?"
- "What is the **central idea** of the selection?"
- "What is the **central idea** of paragraphs X **and** Y?"

**Author's purpose / structure:**
- "What is the **most likely reason** the author wrote this selection?"
- "How does the author **organize** the selection?"
- "**Which audience** is the author addressing in this selection?"

**Print / graphic features:**
- "What is the **most likely reason** the author includes this **illustration/photograph/chart**?"
- "What does the **heading** ____ help the reader understand?"

**Setting / character / plot (fiction):**
- "How is the **setting** of ____ important to the plot of the story?"
- "How can ____'s **relationship** with ____ best be described in paragraphs X **through** Y?"
- "Based on the events at the end of the story, what can the reader **predict** about ____?"
- "What does the reader learn about ____ from paragraphs X **through** Y?"

**Inference:**
- "What can the reader **infer** about ____ based on ____?"
- "Which sentence supports the idea that ____?"

### Out of scope for v1 (ship in later phases)

- 2-part / multiselect questions (Part A + Part B linked, or "pick 2 of 5")
- Hot text / Highlight Text (kid clicks evidence sentences in passage)
- Inline Choice / drop-down
- Short Constructed Response (1-2 sentences with evidence — needs typed input + rubric scoring)
- Extended Constructed Response (10-pt opinion essay — needs typed input + rubric scoring)

## 5. Released-test exemplars

Two exemplars below are real grade-3 STAAR passages, lifted from public TEA released materials. They define the bar — both word count, voice, question style, and distractor logic.

### Exemplar 1 — Realistic fiction (with caveat)

**Note:** TEA's 2022 form does NOT include a pure realistic-fiction passage. The closest fiction passage is `Cheese for Dinner` — a Mexican folktale with anthropomorphic animals. We use it for **stem and distractor patterns**, NOT for genre voice (our v1 ships realistic fiction with human protagonists, not folktales). See §10 for the realistic-fiction generation brief.

**Title:** *Cheese for Dinner* (A Tale from Mexico, retold by Judy Goldman)
**Source:** [STAAR 2022 Grade 3 Reading, Passage 3 (pages 13-17)](https://tea.texas.gov/student-assessment/staar/released-test-questions/2022-staar-3-rla-test.pdf)
**Word count:** ~370
**Paragraph count:** 18
**Question count:** 7 (items 16-22)

A trickster tale: hungry Coyote corners Conejo (rabbit). Conejo claims a wheel of cheese rests at the bottom of the lake; Coyote dives chasing the moon's reflection; Conejo escapes to his burrow. 18 short paragraphs, simple direct dialogue, vivid Spanish-Mexican setting markers ("under a cloudless sky", proper noun characters in Spanish).

**Real questions on this passage:**
- (16) "How can Conejo's relationship with Coyote best be described in paragraphs 6 through 11?" → F (Conejo pretends to want to help Coyote)
- (17) "What is the meaning of the word *sly* in paragraph 16?" → C (Clever)
- (19) "What is the most likely reason the author includes this illustration in the story?" → C (To help the reader understand why Coyote believes there is cheese in the lake)
- (20) "Based on the events at the end of the story, what can the reader predict about Coyote?" → F (Coyote will not trust Conejo again)
- (21) "In paragraph 1, the word *cloudless* includes the suffix -less. The suffix helps the reader understand that *cloudless* means —" → B (clear)

**Why this works as a stem reference:** the questions span vocabulary (16, 17, 21), inference (16, 20), and graphic-feature purpose (19) — exactly the strand mix we expect for a 5-question set. Notice every stem is concrete ("paragraphs 6 through 11", "paragraph 16", "the events at the end of the story") — no abstract questions.

### Exemplar 2 — Informational (persuasive subgenre)

**Title:** *Book Clubs Are for Everyone!*
**Source:** [STAAR 2022 Grade 3 Reading, Passage 4 (pages 18-22)](https://tea.texas.gov/student-assessment/staar/released-test-questions/2022-staar-3-rla-test.pdf)
**Word count:** ~470
**Paragraph count:** 7
**Question count:** 7 (items 23-29)

Persuasive informational text. Argues kids should join book clubs because they (a) improve reading skills, (b) help finish books, (c) expose readers to new genres, (d) teach respectful listening, (e) help make friends. 2 photos. Clear topic sentence per paragraph; concluding call-to-action.

**Real questions on this passage:**
- (23) "In paragraph 4, the prefix *un-* in the word *unknown* helps the reader understand that the meaning of *unknown* is —" → C (not known)
- (24) "Which audience is the author addressing in this selection?" → F (Students)
- (25) "Based on the information in paragraphs 1 through 4, what can the reader conclude about students who join a book club?" → C (The students develop good reading habits)
- (26) "What is the most likely reason the author includes these photographs in the selection?" → G (To show that book clubs can meet at different places)
- (27) "What sentence supports the idea that joining a book club could help someone make friends?" → D (verbatim sentence quote)

**Why this works:** the passage has clear paragraph-level topic sentences, which makes "key idea / supporting details" questions clean to write. The 7-paragraph structure is a great target shape for our generator — long enough for multiple stand-alone questions, short enough to read in 2-3 minutes.

## 6. Texas cultural priorities

These rules are committee-authored (not researched). The Cultural Reviewer + Curriculum Director set them; the judge enforces them.

### Demographic representation

Texas K-12 enrollment (TEA 2024 data, approximate):

| Group | Share | Implication for passages |
|---|---|---|
| Hispanic/Latino | ~52% | Most-frequent protagonist demographic; default unless stated otherwise |
| White | ~24% | Significant; not the default |
| Black/African American | ~13% | Always present; never tokenized |
| Asian (Vietnamese, Filipino, Indian, Chinese) | ~5% | Visible across passages; specific country origin matters |
| Two or more races | ~3% | Underrepresented in test prep generally — make space |
| Native American (Caddo, Comanche, Lipan Apache, Tonkawa, Wichita) | ~1% | Historically present; modern presence understated; include carefully |

### Names to use across passages (rotate; don't always pick from one bucket)

- **Latina/Latino:** Maria, Diego, Camila, Mateo, Sofia, Luis, Isabella, Andrés, Valentina, Alejandro, Lucia, Carlos, Marisol, Ximena, Beatriz
- **White:** Sarah, Emma, Ethan, Olivia, Henry, Charlotte, Jack, Ruby, Jonah, Hazel, Theo, Marcus, William
- **Black:** Aaliyah, Jamal, Imani, DeShawn, Maya, Marcus, Aniya, Malik, Tiana, Jermaine, Naima, Chante, Damari
- **South Asian:** Priya, Aarav, Aanya, Rohan, Diya, Vikram, Ananya, Ishaan, Nisha
- **East/Southeast Asian:** Min, Linh, Kai, Hiro, Mei, Jin, Anh, Ren, Bao
- **Arab/Muslim:** Fatima, Omar, Yusuf, Aisha, Zaid, Layla, Hassan, Nadia, Khalil
- **Native American (only when historically appropriate):** Kai, Ayita, Tahkeome (drawn from Caddo, Cherokee, Comanche tribal traditions — research the specific tribe before naming)

Keep at least **30 distinct names in active rotation** so no name appears more than 1-2 times per 50-passage batch.

### Settings (Texas-specific where natural)

- **Cities to spread across:** Houston, San Antonio, El Paso, Austin, Dallas, Brownsville, Lubbock, Amarillo, Galveston, McAllen, Corpus Christi, Laredo, Waco, Tyler
- **Texas regional ecosystems:** Hill Country, Big Bend, Padre Island, Caprock Canyons, Piney Woods, Coastal Plains, Edwards Plateau
- **Don't use Texas as the only setting** — kids should encounter passages set in other places too. Roughly 60% Texas / 40% non-Texas split for v1.
- **Settings outside Texas should be specific:** "a small town in Oregon" beats "a small town"; "her grandmother's village in Vietnam" beats "another country"

### Avoid (cultural landmines)

- **Stereotype-loaded framings:** "abuela teaching the white kid Spanish words", "the brown kid lost in the museum", "the Asian kid who's good at math"
- **Tokenism:** Maya doesn't have to teach about her culture every time she appears. Most of her passage appearances should be about losing her cat, planting a tomato, or learning a recipe — same as everyone else.
- **Cowboy/oil/football monoculture:** Texas is more than these. Use them sparingly when relevant; don't force them.
- **Religion** (any): no church, mosque, temple as setting; no prayer; no Christian/Jewish/Muslim/Hindu holiday as the focal point of a passage. Diwali/Eid/Hanukkah/Christmas mentions OK only as background detail (e.g. "they were preparing for Diwali" then the story is about something else).
- **Politics** (any): no elections, voting, parties, ideology, immigration policy.
- **Death, abuse, divorce, drugs, violence, romance** — see §9.
- **"Lesson learned" moralizing endings:** STAAR fiction at grade 3 doesn't moralize — characters find a solution and the story ends. No "from that day forward, Maria always remembered to share."
- **Foods/holidays as the ONLY cultural marker:** a Hispanic protagonist who never eats Mexican food and never celebrates Día de Muertos is fine. Texture > stereotype.

### Embrace

- **Diverse protagonists in mundane situations:** the kid happens to be Hispanic AND happens to lose her cat AND solves it.
- **Texas-specific settings without overplaying:** Padre Island as the place where Sofia found a sand dollar, not as the place where Sofia learned about Texas history.
- **Indigenous Texas history when historically appropriate:** Caddo mound builders, Comanche horse culture, Lipan Apache plant knowledge — for informational passages on Texas history specifically. Get the tribe right; don't conflate.
- **Modern Texas:** Houston tech scene, El Paso border art, Lubbock cotton/wind-energy, Austin music + tech, Dallas trade, Galveston coast/marine biology.
- **Bilingual texture without explanation:** if Maria's grandmother says "ven aquí" once in a passage, don't translate — context carries it. STAAR does this in `Cheese for Dinner` ("Conejo" is the rabbit; never glossed).

## 7. AI-generation landmines (judge enforces)

The judge MUST flag:

1. **"Lifeless competence"** — passages that are grammatically perfect but have no spark. Symptoms: sentences average exactly 12 words, every paragraph is exactly 3 sentences, no concrete sensory detail (smell, texture, sound), no character has a quirk. Reject.

2. **Made-up "facts" in informational passages** — every fact must be verifiable. The judge should explicitly mark passages as `REQUIRES_FACTCHECK` if it's not 100% confident. Examples of dangerous claims:
   - "The first American library was founded in 1654 in Boston." (verify dates and locations)
   - "There are 217 species of sea turtle." (verify counts)
   - "Marie Curie discovered radioactivity in 1898." (verify discovery sequencing)

3. **"And from that day forward..."** moralizing endings.

4. **Cultural improvisation when not researched** — a Diwali passage written by an LLM that's never seen Diwali. Symptoms: vague generic-festival imagery instead of specifics (rangoli, diyas, Lakshmi puja). If a passage references a specific cultural moment, the judge must verify the specifics are accurate — or tell the generator to swap to a context the model knows better.

5. **Passages where the kid can answer the questions WITHOUT reading the passage** — common-sense distractors that any 8-year-old could rule out from the question stem alone. The questions must require comprehension, not vibes.

6. **Anachronism in historical informational** — Wilma Rudolph wins gold medals in 1960, not 1965. Patricia Bath gets her medical patent in 1988, not 1980. Year accuracy matters.

7. **Passage-question mismatch:** a passage about wind instruments where the question asks about birds. Always run a second pass: "does every question in the set have a textual answer in this specific passage?"

8. **Distractor weakness** (per §4): every distractor must be plausible-given-a-misreading. "The grass was green" as a wrong answer for "What is the main idea?" is unacceptable — too easy to rule out.

## 8. Reading levels — operational rules

### Vocabulary tier
- **Tier 1 (everyday words):** freely use ("dog", "ran", "happy", "teacher")
- **Tier 2 (academic, cross-domain):** introduce 2-4 per passage; context must support meaning ("observe", "discover", "remarkable" — wait, see CLAUDE.md §10 banned-vocab list — substitute)
- **Tier 3 (domain-specific):** only in informational, 1-2 per passage, must be supported by context or definition ("photosynthesis", "translucent", "migration")

### Sentence complexity
- Average sentence length: **8-12 words**
- Maximum sentence length: **20 words** (rare; mainly for compound-complex closers)
- Mix simple, compound, and complex sentences. **All-simple reads as condescending; all-complex is too hard.**

### Flesch-Kincaid grade level target
- **Target:** 3.0 - 3.9
- **Acceptable:** 2.8 - 4.2
- **Reject:** <2.5 (too simple, kid disengages) or >4.5 (too hard, kid gives up)

### Lexile cross-reference
- Approximate target band: **520L - 820L** (CCSS grade 3 stretch range)
- TEA does NOT publish Lexile cuts; this is a guide, not a hard rule. **The Flesch-Kincaid rule above is the operational rule.**

## 9. The "no-no" list (verbatim — judge enforces strict)

Reject any passage or question containing:

- ❌ **Death** of any character (animal or human)
- ❌ **Divorce, separation, family conflict** beyond minor (siblings sharing space is fine; parents fighting is not)
- ❌ **Romance** — no crushes, no hand-holding, no "she liked him". Friendship that is clearly platonic is fine.
- ❌ **Drugs, alcohol, smoking, vaping**
- ❌ **Religion** as theology — Christmas/Hanukkah/Eid/Diwali OK only as a cultural celebration, no prayer dialogue, no theological claims
- ❌ **Politics, voting, elections, parties, ideology**
- ❌ **Violence** — even "the boy fell and bled" — out. Cuts and scrapes can heal off-screen.
- ❌ **Bullying as central theme.** A brief mention of an unkind comment is OK; a whole passage about being bullied is not.
- ❌ **Mental illness portrayal** at grade 3.
- ❌ **Real public figures by name** — no Trump, Beyoncé, Elon Musk, current sports stars. Historical figures who are clearly removed (Wilma Rudolph, Patricia Bath, Marie Curie) are fine for informational.
- ❌ **Brand names** — no Nike, McDonald's, Coca-Cola, Disney, Apple. Use generic ("his sneakers", "the burger restaurant").
- ❌ **Made-up facts** presented as real in informational passages. Every fact must be verifiable.
- ❌ **Off-color humor or slang** — including playground slang that's age-marginal ("sus", "bet", "no cap")

## 10. Pipeline integration notes

### Generation prompts

`scripts/reading/generate-passage.js` (Phase 1 deliverable) loads sections **2, 6, 7, 8, 9** of this KP into the generator's system prompt. The generator then receives a per-call user prompt with:
- `genre`: 'realistic-fiction' | 'informational'
- `topic`: from a curated topic list per genre (see §2)
- `setting`: a Texas-rooted or specific non-Texas setting
- `protagonistName`: drawn from §6's diverse name pool
- `passageId`: stable id for the run

`scripts/reading/generate-question.js` (Phase 1) loads sections **3, 4, 7** of this KP plus the just-generated passage as system context. Generates 5 multiple-choice questions per passage spanning the strand mix in §3.

### Judge prompts

`scripts/reading/judge-passage.js` (Phase 1) loads sections **6, 7, 8, 9** as the rubric. Verdicts per section. Failure modes:
- `CULTURAL_LANDMINE` (any §6 violation)
- `LANDMINE_<n>` (any §7 violation, indexed 1-8)
- `READABILITY_TOO_SIMPLE` / `READABILITY_TOO_HARD` (§8)
- `NO_NO_<topic>` (any §9 violation, named)

`scripts/reading/judge-question.js` (Phase 1) loads sections **3, 4** as the rubric. Failure modes:
- `STEM_NOT_REAL_STAAR` (stem not in §4 catalog and not a recognizable variant)
- `WRONG_TEKS_LABEL` (claimed strand doesn't match actual question content)
- `WEAK_DISTRACTOR` (any distractor trivially eliminable)
- `OFF_TEXT` (question can't be answered from the passage)
- `DOUBLE_ANSWER` (more than one option satisfies the stem)

### Living document discipline

When this KP is updated, bump the **Last updated** field at top. The pipeline scripts re-read this file on each run — no rebuild step.

When sections 6 or 9 are edited (cultural rules / no-no list), **regenerate any content batches in flight** because the judge calibration shifted.

When section 4 stems are extended (e.g. when we ship 2-part questions or hot text), bump the v1 → v2 marker in the file's frontmatter.

## Sources cited

- [STAAR Released Test Questions — TEA hub](https://tea.texas.gov/student-assessment/testing/staar/staar-released-test-questions)
- [STAAR Spring 2024 Grade 3 RLA Answer Key (PDF)](https://tea.texas.gov/student-assessment/staar/released-test-questions/2024-staar-3-rla-key.pdf)
- [STAAR Spring 2024 Grade 3 RLA Rationales (PDF)](https://tea.texas.gov/student-assessment/staar/released-test-questions/2024-staar-3-rla-rationale.pdf)
- [STAAR May 2022 Grade 3 Reading Released Test (PDF)](https://tea.texas.gov/student-assessment/staar/released-test-questions/2022-staar-3-rla-test.pdf)
- [STAAR Spring 2024 Grade 3 RLA Constructed-Response Scoring Guide (PDF)](https://tea.texas.gov/student-assessment/staar/2024-staar-3-rla-scoring-guide.pdf)
- [TEKS for Grade 3 (revised June 2024) (PDF)](https://tea.texas.gov/academics/curriculum-standards/teks/grade3-teks-062024.pdf)
- [Custom Classroom by Angela — STAAR 2024 ELAR Insights](https://customclassroombyangela.com/692/key-insights-from-the-staar-2024-elar-test-what-you-need-to-know/)
- [ESC Region 13 — STAAR 2024-2025 Blueprint Breakdown (PDF)](https://esc13.net/assets/uploads/docs/resources/r13-staar-rla-blueprint-2024-2025.pdf)

## Open TODOs (Hamid review)

These are research gaps to confirm or judgment calls to ratify:

1. **[TODO: confirm]** §1 testing time. State policy is a 4-hour session limit — but is there a practice-time recommendation per practice session for our app? Probably 15-20 min for a kid; not from TEA.
2. **[TODO: confirm]** §2 Lexile band. Approximate guide only. If we ever want to publish "this passage is Lexile 650L" to parents, we need a real readability tool — `text-readability` npm or similar.
3. **[TODO: confirm]** §6 ratio targets. The 60% Texas / 40% non-Texas split is a Cultural Reviewer call; you may want to dial that to 50/50 or 70/30 based on what feels right.
4. **[TODO: confirm]** §6 names. The list is broad but not exhaustive. Add/remove based on community feedback once shipped.
5. **[TODO: review]** §9 no-no list. The most opinionated section; you may want to soften "no romance" (some grade-3 books do have light crushes) or harden "no bullying" further.
6. **[TODO: future expansion]** This KP is grade-3 + realistic-fiction + informational only. Phase 5+ work will add `texas-reading-grade4.md` (just word-count + Lexile band shifts), `texas-reading-poetry.md` (rhyme schemes, line-count rules), `texas-reading-drama.md` (act/scene structure, stage directions), etc. Each is additive.
7. **[TODO: ship-blocker before Phase 1]** Decide: do we generate paragraph numbers as `(1)` `(2)` `(3)` inline before each paragraph, OR as `<p data-num="1">...` markup the kid UI renders? Spec needs to be locked before the schema is written.
