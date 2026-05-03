# STAAR Released-Item Exemplars (Pattern Descriptions, Not Verbatim)

**Provenance:** [CLAUDE-SYNTHESIZED, based on widely-known STAAR question patterns from publicly-released test forms 2019–2024]. The pre-2025 paper-based STAAR released-test PDFs (which were the canonical reference) appear to have been migrated to online-only at `txpt.cambiumtds.com` requiring student login. This document captures TYPICAL SHAPES per major TEKS based on what was widely observed in those releases.

**No question is reproduced verbatim.** Each entry describes the SHAPE: stimulus type, computational/analytical structure, what the marked correct answer represents, what the distractors mimic. Use these shapes to inspire generation; do not copy text from this document.

---

## Math

### TEKS 3.4A — One- and two-step word problems within 1,000 (add/subtract)
- **Shape:** Word problem with 2-3 sentences setting up a scenario (often shopping, classroom items, or party planning). Uses 2-3 numbers under 1,000. Asks for total or difference after one or two arithmetic operations.
- **Stimulus:** None (text-only)
- **Choices:** 4 numeric options
- **Marked correct:** the result of the correct sequence of ops
- **Distractors:** (a) result of single op when problem needs two; (b) reverse op (added when should subtract); (c) place-value error (off-by-100)
- **Inspired by:** STAAR 2022 Grade 3 Math released items, multiple instances

### TEKS 3.4F — Recall multiplication facts up to 10×10
- **Shape:** Pure-fact computation, no word context
- **Stimulus:** None
- **Choices:** 4 numeric values close to the correct product
- **Marked correct:** the actual product
- **Distractors:** (a) sum (e.g., 7×6 marked as 42; distractor 13 = 7+6); (b) off-by-one in one factor; (c) common confusion fact (7×8 vs 6×9)
- **Inspired by:** STAAR 2021 Grade 3 Math fluency items

### TEKS 4.2B — Place value of digits in whole numbers
- **Shape:** A multi-digit number is shown (typically 5-7 digits). Question asks the value of a SPECIFIC digit. CAUTION (CLAUDE.md §13/§25): the chosen digit MUST appear at exactly one position in the number, otherwise the question is AMBIGUOUS and will be rejected by the judge.
- **Stimulus:** A multi-digit numeral, often with comma-separated thousands
- **Choices:** 4 place-value-magnitude options (e.g., 5, 50, 500, 5,000)
- **Marked correct:** the place-value of the targeted digit
- **Distractors:** off-by-one place values
- **Inspired by:** STAAR 2023 Grade 4 Math released items

### TEKS 4.4H — Multi-step problems with multiplication/division (interpret remainders)
- **Shape:** Word problem requires 2-3 steps. Often has a remainder that must be interpreted (round up for "how many cars/buses needed", round down for "how many full bags").
- **Stimulus:** None or a small image
- **Choices:** 4 numeric, with at least one being the unrounded remainder-version
- **Marked correct:** the contextually correct rounded answer
- **Distractors:** (a) un-rounded; (b) rounded the wrong direction; (c) one operation only
- **Inspired by:** STAAR 2024 Grade 4 Math released items

### TEKS 5.3K — Add/subtract positive rational numbers fluently
- **Shape:** Multi-step word problem involving fractions with unequal denominators OR mixed numbers OR decimals. Common context: recipe scaling, money, distance.
- **Stimulus:** None
- **Choices:** 4 fractional or decimal options
- **Marked correct:** the result of correct LCD addition/subtraction
- **Distractors:** (a) added numerators and denominators directly without LCD; (b) only added numerators; (c) used wrong LCD
- **Inspired by:** STAAR 2022 Grade 5 Math released items

### TEKS 6.5B — Solve real-world problems with percents (find part, whole, or percent)
- **Shape:** Real-world percent problem. One of {part, whole, percent} is missing. Common contexts: tip, sale, survey results.
- **Stimulus:** Often none; sometimes a small data table
- **Choices:** 4 numeric (dollars, percentages, or whole-number counts)
- **Marked correct:** the result of the correct percent operation
- **Distractors:** (a) confused part/whole; (b) used wrong base; (c) calculation error in the percent operation
- **Inspired by:** STAAR 2023 Grade 6 Math released items

### TEKS 7.4D — Percent change problems (multi-step financial literacy)
- **Shape:** Word problem requires applying percent increase or decrease, then sometimes a second operation. Contexts: tip on a meal, sale price, tax, simple interest.
- **Stimulus:** None
- **Choices:** 4 monetary or numeric answers
- **Marked correct:** result of the correct percent + arithmetic chain
- **Distractors:** (a) found percent only, didn't apply increase/decrease; (b) wrong direction (decrease when should increase); (c) used wrong base
- **Inspired by:** STAAR 2024 Grade 7 Math released items

### TEKS 7.11A — Two-step equations and inequalities
- **Shape:** Word problem translates to a two-step equation (like 3x + 5 = 26 or 2x − 4 ≥ 10). Kid solves OR identifies the equation.
- **Stimulus:** None
- **Choices:** 4 numeric options for x, OR 4 candidate equations
- **Marked correct:** the value that makes the equation true OR the equation that models the situation
- **Distractors:** (a) sign error (chose −4 when correct is +4); (b) inverse-op error; (c) skipped second step
- **Inspired by:** STAAR 2022 Grade 7 Math released items

### TEKS 8.7A — Pythagorean Theorem
- **Shape:** Right triangle with legs labeled, find hypotenuse. OR ladder/diagonal-distance word problem.
- **Stimulus:** Diagram of right triangle with two side measurements labeled, one unknown
- **Choices:** 4 numeric options (often √-form or decimal)
- **Marked correct:** the result of √(a²+b²) or √(c²−a²)
- **Distractors:** (a) added legs instead of squaring; (b) found c² instead of c; (c) used the wrong leg
- **Inspired by:** STAAR 2024 Grade 8 Math released items

### TEKS A.5A — Solve linear equations (variables on both sides)
- **Shape:** Algebraic equation with variables on both sides, often requiring distribution. Sometimes embedded in a word problem.
- **Stimulus:** None
- **Choices:** 4 values for x
- **Marked correct:** the solution
- **Distractors:** (a) wrong combination of like terms; (b) sign error in distribution; (c) divided wrong direction
- **Inspired by:** STAAR Algebra I EOC released items, multiple years

---

## Reading Language Arts

### TEKS 3.6F / 4.6F / 5.6F — Make inferences with evidence
- **Shape:** Reading passage (literary or informational) followed by a question asking what can be inferred about a character / situation / topic. Often paired with a "best evidence" question (which line supports your answer?).
- **Stimulus:** Single passage, length per grade per `_passage_specs` in `teks-rla.json`
- **Choices:** 4 candidate inferences
- **Marked correct:** the inference best supported by passage evidence
- **Distractors:** (a) plausible inference NOT supported by passage; (b) opposite of correct; (c) detail-level paraphrase that's true-but-not-the-inference
- **Inspired by:** STAAR Reading 2022 Grade 4 + 2023 Grade 5 released items

### TEKS 8.7A — Theme inference across texts
- **Shape:** Two paired passages on related topics. Question asks what theme is common across both.
- **Stimulus:** 2 passages, ~400-500 words each
- **Choices:** 4 candidate themes (1-3 word abstract concepts)
- **Marked correct:** the theme present in BOTH passages
- **Distractors:** (a) theme in only one passage; (b) topic instead of theme; (c) opposite theme
- **Inspired by:** STAAR Reading 2023 Grade 8 released items

### TEKS 6.8E.i / 7.8E.i — Identify author's claim in argumentative text
- **Shape:** Argumentative passage. Question asks what claim the author is making.
- **Stimulus:** Persuasive passage, ~400-600 words
- **Choices:** 4 candidate claims
- **Marked correct:** the central thesis
- **Distractors:** (a) supporting evidence (true but not the claim); (b) counterclaim the author is rebutting; (c) audience-targeting fact
- **Inspired by:** STAAR Reading 2024 Grade 7 released items

---

## Science

### TEKS 5.9B — Energy flow through food chain/web
- **Shape:** Food web diagram. Question asks about energy flow direction OR what happens if one organism is removed.
- **Stimulus:** Food web/chain diagram with labeled organisms (often Texas-relevant: hawk, snake, mouse, grass, etc.)
- **Choices:** 4 candidate impacts or directions
- **Marked correct:** the energy flow that follows producer → consumer → decomposer order
- **Distractors:** (a) reversed direction; (b) wrong trophic level; (c) misidentified producer
- **Inspired by:** STAAR Science 2022 Grade 5 released items

### TEKS 8.5C — Periodic table interpretation
- **Shape:** Excerpt of periodic table or single-element data card. Question asks about element's properties from atomic number or position.
- **Stimulus:** Periodic table image (excerpt) or element fact box
- **Choices:** 4 candidate properties or behaviors
- **Marked correct:** the property predicted by group/period
- **Distractors:** (a) confused group with period; (b) right family wrong row; (c) confused metal/nonmetal
- **Inspired by:** STAAR Science 2023 Grade 8 released items

---

## Social Studies

### TEKS 8.4A — Causes of the American Revolution
- **Shape:** Primary-source excerpt OR cause-effect question. Identifies which cause led to which event.
- **Stimulus:** Quote from a colonial figure OR primary-source excerpt OR none
- **Choices:** 4 candidate causes
- **Marked correct:** the historically-attested cause (Stamp Act, Intolerable Acts, Proclamation of 1763, etc.)
- **Distractors:** (a) right type of cause but wrong era; (b) wrong direction (effect labeled as cause); (c) common-misconception cause
- **Inspired by:** STAAR Social Studies 2023 Grade 8 released items

### TEKS USH.7A — Cold War events
- **Shape:** Map, photo, or quote stimulus. Question asks about a specific Cold War event or its significance.
- **Stimulus:** Cold War map (NATO/Warsaw Pact alignment), photo, or short quote
- **Choices:** 4 candidate events or interpretations
- **Marked correct:** the event matching the stimulus
- **Distractors:** (a) right era wrong region; (b) similar event in different decade; (c) wrong actor (USSR vs China etc.)
- **Inspired by:** STAAR US History EOC 2022 released items

---

## What this list is NOT

- Not exhaustive — only the most-frequently-tested major TEKS get exemplars here
- Not verbatim — these are SHAPES, not actual STAAR text
- Not the only valid shape per TEKS — these are typical patterns, not the only forms

For a TEKS not listed above, the patterns in `staar-question-shapes.md` plus the `typical_question_shape` field in the `teks-*.json` files give the next-best guidance.
