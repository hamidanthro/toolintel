# Texas State Knowledge Pack

**Version:** 1.0
**Built:** 2026-05-03
**Last reviewed by Hamid:** TBD (see `REVIEW-CHECKLIST.md`)

## What this is

A comprehensive, machine-readable, human-readable foundation for all Texas content generation in the GradeEarn pipeline. Every cold-start sweep, lambda-runtime generate call, and future audit script that produces or evaluates Texas content references this pack.

The pack codifies:
- **What Texas tests** (TEKS standards, parsed JSON, with cognitive-demand tags and typical question shapes)
- **How Texas tests it** (STAAR question patterns, distractor design, cognitive-demand mix)
- **What Texas culture is** (allowed contexts) and **isn't** (avoided contexts)
- **Who Texas kids are** (authentic name pool reflecting real Texas demographics, anti-stereotype)
- **How Texas teaches** (pedagogical priorities per subject and grade)
- **The exact words STAAR uses** (vocabulary, phrasings, conventions)

This pack is **state-flavor authoritative**. If a generator prompt or judge prompt references "Texas" or "STAAR", it should pull facts from THIS pack rather than re-deriving from the model's training data.

---

## File index

```
state-packs/texas/
├── README.md                                    ← you are here
├── REVIEW-CHECKLIST.md                          ← 30-item Hamid review (10 min)
├── standards/
│   ├── teks-math.json                           ← grades 3-8 + Algebra I (194 standards)
│   ├── teks-rla.json                            ← grades 3-8 + English I/II (95 standards)
│   ├── teks-science.json                        ← grade 5, grade 8, Biology (53 standards)
│   └── teks-social-studies.json                 ← grade 8, US History EOC (39 standards)
├── test-fidelity/
│   ├── staar-question-shapes.md                 ← question types, stem lengths, distractor patterns
│   └── staar-released-exemplars.md              ← per-TEKS exemplar shapes (no verbatim STAAR text)
├── cultural/
│   ├── contexts-allowed.md                      ← Texas geography, history, industries, daily life
│   ├── contexts-avoided.md                      ← politics/religion/contested history off-limits
│   └── authentic-names.json                     ← culturally-diverse Texas-authentic name pool
├── pedagogy/
│   └── teaching-philosophy.md                   ← per-subject pedagogical priorities
└── lingo/
    └── staar-vocabulary.md                      ← exact STAAR phrasings, score categories, conventions
```

**Total:** 12 files. Roughly 50KB of structured data + documentation.

---

## How to use this pack in a generator prompt

### Pattern 1 — system prompt builds Texas context once

When `scripts/cold-start/generators.js#buildPrompt` constructs a Texas math generator system prompt, it can/should pull:

```
You are an expert STAAR Math item writer for [GRADE].

Standards: align to [TEKS-ID] from this exact text: <pull from teks-math.json>
Authority: Texas Education Agency
Test name: STAAR Math (per state-packs/texas/lingo/staar-vocabulary.md §2)

Style guide:
- Use Texas-flavor contexts where natural — see state-packs/texas/cultural/contexts-allowed.md
- Avoid all topics in state-packs/texas/cultural/contexts-avoided.md (politics, religion, brands, etc.)
- Use authentic-names.json for protagonist names; mix demographics roughly per Texas K-12 (40 hispanic / 28 anglo / 12 black / 10 asian / 10 other)
- Question shape: <pull typical_question_shape from teks-math.json for the chosen TEKS>
- Cognitive demand: target the per-grade mix per state-packs/texas/pedagogy/teaching-philosophy.md
- STAAR phrasings: prefer the standard stems from state-packs/texas/lingo/staar-vocabulary.md §4
```

### Pattern 2 — concrete example: grade 4 math generator

For a grade-4 math word-problem question on TEKS 4.2B (place value), the generator could pull:

| From | What |
|---|---|
| `teks-math.json` → `grade_4` → `4.2B` | text, cognitive_demand=medium, typical_question_shape="Large multi-digit number; identify the value of a specific digit. CAUTION: ensure the chosen digit appears at exactly one position; otherwise AMBIGUITY." |
| `staar-question-shapes.md` § Distractor patterns → Math | "Place-value error: kid drops/adds a zero. e.g., 350 vs 35 vs 3500." |
| `cultural/contexts-allowed.md` | optionally pull a Texas-flavor scenario (e.g., "the King Ranch counted 5,827 cattle" — but most place-value questions are scenario-free) |
| `cultural/authentic-names.json` | random protagonist if the question needs one |
| `lingo/staar-vocabulary.md` § Math stems | "What is the value of the digit X in N?" stem pattern |
| `pedagogy/teaching-philosophy.md` | grade-4 math is 30% recall / 55% application / 15% analysis — this question is application |

The output: a clean grade-4 STAAR-style place-value question with the exact digit-uniqueness check baked in (so it doesn't reproduce the §32 "85,759,578" ambiguity bug class).

### Pattern 3 — judge consumes the pack too

The judge (cold-start + lambda) at `scripts/cold-start/judge.js` and `lambda/judge.js` already has Texas-flavor rules embedded in its SYSTEM_PROMPT (e.g., "Texas is a flagship state — own-state references are allowed"). When the judge needs to evaluate STATE_LEAK or AGE_FIT for Texas content, it can/should reference this pack's `contexts-allowed.md` and `contexts-avoided.md`.

---

## Sources used to build this pack

| Source | What it provided | Status |
|---|---|---|
| Texas Education Agency (tea.texas.gov) | Top-level TEKS gateway | ✓ accessible |
| 19 TAC Chapter 111-113 (Texas Administrative Code) | Official TEKS text | ⚠️ TAC site migrated; standards in this pack are CLAUDE-SYNTHESIZED from training knowledge of publicly-published TEKS. Verify against current TAC before publishing dependent products. |
| STAAR released test forms (2019-2024) | Question patterns, stem conventions, distractor design | ⚠️ Pre-2025 PDF released-test forms appear to be deprecated; STAAR online practice now requires student login. Patterns in `test-fidelity/` are CLAUDE-SYNTHESIZED from widely-known patterns in those releases. |
| Texas State Historical Association | Historical and geographic facts | ✓ training-knowledge-based |
| Texas Almanac | Place names, geography | ✓ training-knowledge-based |
| US Census + Texas Demographic Center | Demographic distribution, name frequencies | ✓ training-knowledge-based |
| TEA score-report documentation | STAAR score categories, terminology | ✓ training-knowledge-based |

**Provenance markers:** every file in this pack uses `[CLAUDE-SYNTHESIZED]` markers at the top to flag content not directly fetched from a primary source. If you're using this pack for high-stakes content (e.g., for compliance, regulatory submission, or distribution to schools), verify the relevant sections against current authoritative sources before relying.

---

## Standing rules (per CLAUDE.md §34)

1. **No Texas content generation may proceed without referencing this pack.** A Texas generator prompt that ignores `cultural/contexts-allowed.md` will produce off-state content; one that ignores `lingo/staar-vocabulary.md` will use generic phrasings instead of STAAR-authentic ones.

2. **Same pack template required for every state we expand to.** When the second-state pack (California, New York, Florida — pick one) is built, it must mirror this pack's structure: `standards/`, `test-fidelity/`, `cultural/`, `pedagogy/`, `lingo/`. The `_meta` blocks at the top of each JSON must use the same field names so cross-state tooling stays uniform.

3. **The pack is documentation + structured data, NOT code.** This directory has no `.js`, `.json` schemas requiring validation by a build step, or anything that gets `require()`d at runtime today. Content is pulled at PROMPT-CONSTRUCTION time by the generator scripts. Future tooling could add a JSON-schema validator; not yet needed.

4. **Updates need provenance.** When adding to or revising a file, mark the change with a date and source. The `_meta` blocks have `built` dates; add a `revised` field if making material changes.

5. **PII / live data does NOT belong here.** This is reference / template data. Real student records, real parent emails, anything from the production lake — none of that goes in `state-packs/`.

---

## Known gaps (logged for future iteration)

- **Released-test PDFs deprecated.** The pre-2025 STAAR released-test PDFs were the canonical reference for STAAR shape patterns. With Texas's move to online-only assessment via `txpt.cambiumtds.com` (which requires student login), the publicly-accessible reference base for these patterns has shrunk. Patterns in this pack are based on prior-released-test observation. If anyone has access to the current Cambium portal, comparing this pack's shapes against current items would be a worthwhile audit.
- **TAC migration**. The Texas Administrative Code site has migrated; specific chapter URLs aren't directly accessible from the gateway. TEKS text in `standards/*.json` is CLAUDE-SYNTHESIZED from training knowledge — accurate to the standards' intent but the EXACT WORDING should be verified against current TAC before relying on this pack for compliance documentation.
- **No Spanish-language coverage**. STAAR Spanish exists for grades 3-5 (math, science, RLA). Not covered in this pack v1.0. Logged in CLAUDE.md §14 for future expansion.
- **No constructed-response coverage**. STAAR includes constructed-response items in RLA. Our generator doesn't produce those today (kid UI is multi-choice + numeric only). Out of scope for this pack until the kid UI supports constructed-response.
- **No district-level customization**. Some Texas districts add local context (e.g., curriculum scope-and-sequence documents). This pack is state-level only.
