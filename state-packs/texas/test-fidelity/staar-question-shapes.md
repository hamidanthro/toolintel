# STAAR Question Shapes — Pattern Catalog

**Provenance:** [CLAUDE-SYNTHESIZED] — patterns observed from publicly-known STAAR test forms (2019, 2021–2024). The actual released test PDFs at `tea.texas.gov/student-assessment/staar/staar-released-test-questions` link to the 2025 online practice (`txpt.cambiumtds.com`) which requires a student account to view. The PRE-2025 paper-based released-test PDFs (which were the canonical "released items" for years) appear to have been deprecated from public access in the move to online-only testing. This document captures what was widely observed in those releases and what is publicly known about STAAR formatting.

**This document does NOT reproduce any STAAR question verbatim.** It documents observable patterns: stem length, choice structure, distractor design, stimulus types, distribution by cognitive demand. Use these patterns to GENERATE state-flavor-authentic content; do not paste from this document directly.

---

## 1. Question Types Used

STAAR uses 4 main item types. The mix shifted with the 2023 redesign which introduced "technology-enhanced items" (TEIs) for computer-based testing.

| Type | Description | Used at |
|---|---|---|
| **Multiple-choice (4 options A/B/C/D)** | Single-select with 4 lettered choices. Most common. | All grades, all subjects |
| **Gridded numeric** | Bubble in a numeric answer (decimal or whole). Math-only. | Math grades 3-8 + algebra |
| **Multi-select** | "Choose 2 / Choose 3" with 5-7 options. Post-2023 redesign. | All subjects, mostly grades 6+ |
| **Technology-enhanced (TEI)** | Drag-drop, hot-spot, fill-in, drop-down. Online only. | Post-2023 redesign, all grades |
| **Short constructed response** | 1-2 sentence written answer. RLA only. | RLA grades 3-8, English I/II EOC |

**For our pipeline:** generate primarily multi-choice (`type: 'multiple_choice'`, 4 lettered choices). Numeric gridded is also supported (`type: 'numeric'`). TEI / multi-select / constructed-response are NOT in scope today — kid-facing UI doesn't render them.

---

## 2. Stimulus Types

What appears in front of the question stem.

### Math
- **No-stimulus**: bare computation or pure word problem (no image)
- **Image stimulus**: number-line diagram, geometric figure, array, fraction model
- **Table stimulus**: input-output tables, frequency tables, comparison data
- **Graph stimulus**: bar graph, dot plot, pictograph (grade 3-5), histogram, box plot, scatter plot (grade 6+), coordinate plane (grade 5+)
- **Diagram stimulus**: real-world scene with measurements labeled

Distribution per grade:
- Grade 3: ~50% no-stimulus, ~30% image, ~20% table/graph
- Grade 5: ~35% no-stimulus, ~30% image, ~35% table/graph
- Grade 8: ~25% no-stimulus, ~30% diagram, ~45% table/graph/coordinate plane

### RLA
- **Single-passage**: one literary OR informational passage with multiple questions about it
- **Paired-passage**: two related passages with cross-text questions
- **Drama/poetry**: shorter, less common
- **Embedded multimedia**: post-2023 redesign uses videos / images alongside passages (skip — kid UI is text-only)

Passage word counts per grade — see `_passage_specs` in `teks-rla.json`.

### Science (grade 5, grade 8, Biology EOC)
- **Diagram + question**: lab setup, organism diagram, cycle diagram (water/rock/carbon)
- **Data table**: experimental results, controlled variables
- **Scenario + question**: real-world setting (e.g., a biologist studying frogs)

### Social studies (grade 8, US History EOC)
- **Primary source excerpt**: short quotation from speech, document, letter (with attribution)
- **Map**: thematic, political, or geographic
- **Chart/timeline**: events over time
- **Image**: historical photo, painting, political cartoon (post-2023)

---

## 3. Stem Length Patterns

Median stem length by grade and subject (words, observed):

| Grade | Math stem | RLA stem (excl. passage) | Science stem | SS stem |
|---|---|---|---|---|
| 3 | 25-40 | 12-20 | — | — |
| 4 | 35-55 | 15-25 | — | — |
| 5 | 40-65 | 18-30 | 30-50 | — |
| 6 | 45-75 | 18-32 | — | — |
| 7 | 50-80 | 20-35 | — | — |
| 8 | 55-90 | 22-40 | 40-70 | 25-55 |
| EOC | 60-110 | 25-50 | 50-90 (Biology) | 30-65 (USH) |

**Generation guidance:** stay within these ranges. Stems shorter than the lower bound feel under-described; longer than the upper feel like a reading test.

---

## 4. Distractor Design Patterns

STAAR distractors are intentionally designed to catch specific common misconceptions. They are NOT random.

### Math distractor patterns
- **Off-by-one**: kid forgets to "round up" when the answer must be a whole bag/box. Marked correct: 4. Distractor: 3.
- **Operation reversal**: kid added when should multiply, or vice versa. e.g., 6 × 7 = 42; distractor 13 = 6 + 7.
- **Last-step omission**: kid sets up correctly but stops one step early. e.g., kid finds 3/4 of $24 = $18 but the question asked for the remaining $6.
- **Place-value error**: kid drops/adds a zero. e.g., 350 vs 35 vs 3500.
- **Sign error**: in integer ops, kid forgets the negative. e.g., −8 + 5 = −3, distractor +3 or −13.
- **Fraction-equivalent mismatch**: kid simplifies wrong. e.g., 6/8 = 3/4 marked, distractor 6/8 = 3/8.
- **Unit confusion**: kid mixes inches and feet, or seconds and minutes.

A clean STAAR-style 4-option MC has each distractor mapping to ONE common kid error.

### RLA distractor patterns
- **True-but-not-the-answer**: a detail from the passage that's accurate but doesn't answer the question
- **Out-of-passage truth**: a generally-true statement that isn't supported by the passage specifically
- **Opposite**: the inverse of the correct answer (e.g., theme is "perseverance" → distractor is "giving up")
- **Surface-level paraphrase**: matches words from the passage but misses the inference

### Science distractor patterns
- **Common misconception**: the everyday-incorrect belief (e.g., "we have seasons because Earth is closer to the Sun" — wrong; cause is tilt)
- **Right-process-wrong-target**: kid identifies condensation but the question asked about evaporation
- **Plausible variable**: in experimental design, distractors include controlled variables that aren't the correct independent variable

### Social studies distractor patterns
- **Wrong-era**: same type of event (war, treaty) but different time period
- **Right-event-wrong-cause**: kid knows the event but misidentifies what triggered it
- **Geographic confusion**: same region but different state/country

---

## 5. Cognitive Demand Distribution

STAAR aims for a balanced mix per grade. Approximate observed distribution:

| Grade | Recall (low) | Application (medium) | Analysis (high) |
|---|---|---|---|
| Grade 3 | 35% | 50% | 15% |
| Grade 4 | 30% | 55% | 15% |
| Grade 5 | 25% | 55% | 20% |
| Grade 6 | 20% | 55% | 25% |
| Grade 7 | 15% | 55% | 30% |
| Grade 8 | 15% | 50% | 35% |
| EOC (Algebra I, English I/II, USH, Biology) | 10% | 45% | 45% |

**Generation guidance:** for a bucket of N questions, target the cognitive-demand mix above. Don't generate 100% recall; don't generate 100% high-analysis. The cognitive-demand label is recorded per TEKS in `teks-*.json`.

---

## 6. Form Composition (per STAAR test)

Approximate questions per form (varies by year/grade; STAAR redesigned 2023):

| Test | Items per form |
|---|---|
| STAAR Math grade 3 | 32 |
| STAAR Math grade 4-5 | 36 |
| STAAR Math grade 6-8 | 38 |
| STAAR Algebra I EOC | 54 |
| STAAR RLA grade 3 | 38 (across passages) |
| STAAR RLA grade 4-5 | 42 |
| STAAR RLA grade 6-8 | 46 |
| STAAR English I EOC | 50 + essay |
| STAAR English II EOC | 50 + essay |
| STAAR Science grade 5/8 | 36 |
| STAAR Biology EOC | 54 |
| STAAR Social Studies grade 8 | 44 |
| STAAR US History EOC | 68 |

**This is for context only** — our generator produces questions for the practice POOL, not assembled test forms. Each saved question stands alone.

---

## 7. Standard Field Conventions on STAAR

Each STAAR item is labeled with the TEKS it assesses. The item-to-TEKS mapping is published per test form. Key conventions:

- TEKS IDs in STAAR docs use the form `(8.5)(A)` or `8.5A` interchangeably.
- A single STAAR item can assess one TEKS (most common) or sometimes a "readiness vs supporting" pair.
- "Readiness standards" are the foundational standards STAAR weights heavily; "supporting standards" appear less often. See TEA's STAAR Assessed Curriculum documents per grade for the readiness/supporting designation.

---

## 8. What we DON'T do

- We do NOT use multi-select or technology-enhanced items (kid UI doesn't render them)
- We do NOT use embedded multimedia (videos, audio)
- We do NOT use constructed-response (kid UI is multi-choice + numeric only)
- We do NOT replicate the full STAAR test-form composition; we fill a practice pool that the kid samples from
