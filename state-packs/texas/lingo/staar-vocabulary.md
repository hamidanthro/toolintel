# STAAR Lingo Dictionary

Specific words, phrases, and conventions STAAR uses.

**Provenance:** Synthesized from publicly-known TEA STAAR documentation, score-report terminology, and the standardized phrasings observed across released test forms 2019-2024. Marked `[CLAUDE-SYNTHESIZED]` where applicable.

---

## 1. Score Categories

Texas STAAR reports student performance in four levels (in order, lowest to highest):

| Level | Meaning |
|---|---|
| **Did Not Meet Grade Level** | Student needs significant remediation; below grade-level performance |
| **Approaches Grade Level** | Student is approaching grade level but has gaps |
| **Meets Grade Level** | Student is at grade level — the passing standard for graduation requirements |
| **Masters Grade Level** | Student demonstrates above-grade-level mastery |

These exact phrasings appear on score reports and in TEA communications. Use them verbatim if a question or scenario references performance levels.

---

## 2. Subject and test names

| Term | Use |
|---|---|
| **STAAR** | State of Texas Assessments of Academic Readiness — the state test |
| **STAAR Math** | Math test (grades 3-8) |
| **STAAR RLA** | Reading Language Arts test (grades 3-8). NOT "STAAR Reading" — Texas uses "RLA" since the 2017 TEKS revision combined reading + writing. |
| **STAAR Science** | Science test (grades 5, 8) |
| **STAAR Social Studies** | Social Studies test (grade 8) |
| **STAAR EOC** | End of Course assessments — Algebra I, English I, English II, Biology, US History |
| **STAAR Spanish** | Spanish-language version available for grades 3-5 (math, science, RLA) |
| **STAAR Alternate 2** | For students with significant cognitive disabilities |
| **TELPAS** | Texas English Language Proficiency Assessment System — for emergent bilinguals |

---

## 3. TEKS naming convention

TEKS standards are referenced in MULTIPLE acceptable forms:

- **`(8.5)(A)`** — official TAC format
- **`8.5A`** — common shorthand (no parens)
- **`8.5(A)`** — also common
- **`8.5.A`** — sometimes seen in district documents

All four are equivalent. **Generation guidance:** use `8.5A` (no parens) consistently for our content metadata; that's what cold-start has been using since §31. Mixing styles in a single document confuses parsers downstream.

For reading: `3.6.F` style (with periods) is more common for ELAR because the substandard letters can be capitalized or lowercase. We use `3.6.F` with capital substandard.

---

## 4. Standard-language stem phrasings

STAAR uses specific recurring phrasings for question stems. Generators should use these patterns rather than reinventing:

### Reading (ELAR)
- "According to the passage, …"
- "Based on the passage, …"
- "Which sentence from the passage best supports …"
- "Which idea is most central to the passage?"
- "The author wrote this passage most likely to —" (note the dash — no period)
- "What can the reader infer about …"
- "Which of these is the best evidence for …"
- "How does paragraph X contribute to the development of …"
- "Read this sentence from the passage: '…' What does the word X most likely mean as it is used in this sentence?"

### Math
- "Which expression best represents …"
- "What is the value of …"
- "Which equation can be used to find …"
- "How many … are there in all?"
- "What is the total cost?"
- "Which point on the number line best represents …"
- "Which number is closest to …"
- "Look at the table. Which statement is true?"
- "Use the diagram below to answer the question."

### Science
- "According to the diagram, …"
- "Which best describes the relationship …"
- "Which step would be most important in the experiment?"
- "Which conclusion is best supported by the data?"
- "Why did the student include … in the procedure?"

### Social studies
- "According to the document, …"
- "Which of these best describes the causes of …"
- "Use the map to answer the question."
- "Which event led to …"
- "Which generalization is best supported by the data in the table?"

---

## 5. Cognitive operation verbs (Bloom-aligned, STAAR-aligned)

STAAR stems use these verbs consistently. The verb signals cognitive demand:

| Verb | Demand | Common in |
|---|---|---|
| identify, name, list, recall, define | Low (recall) | All |
| describe, summarize, paraphrase, classify | Low-medium | All |
| compare, contrast, distinguish | Medium | Science, ELAR, SS |
| solve, calculate, compute, determine | Medium | Math, Science |
| explain, illustrate, demonstrate | Medium | Math, Science, ELAR |
| apply, use | Medium | All |
| analyze, examine, investigate | High | All |
| infer, predict, conclude | High | ELAR, Science |
| evaluate, judge, justify | High | ELAR, SS, Algebra |
| synthesize, generate, create | High (rare on MC) | Constructed-response only |

**Generation guidance:** match the verb to the cognitive demand. Don't ask "identify" when you mean "analyze." Don't ask "evaluate" if a kid only needs to recall.

---

## 6. Texas-specific terminology

### Education-system terms
- **TEA** — Texas Education Agency (state education department)
- **TEKS** — Texas Essential Knowledge and Skills (the curriculum standards)
- **ELAR** — English Language Arts and Reading (Texas's term for ELA combined with reading)
- **EOC** — End of Course (assessments at the end of specific high school courses)
- **ESC** — Education Service Center (regional educational service centers, ESC-1 through ESC-20)
- **ISD** — Independent School District (Texas school districts)
- **Charter** — open-enrollment charter school
- **DAEP** — Disciplinary Alternative Education Program (rarely relevant for content)
- **SBOE** — State Board of Education (sets TEKS)
- **TASB** — Texas Association of School Boards
- **STAAR Spanish** — Spanish-language STAAR for ELL students grades 3-5

### Course names (high school)
- **Algebra I** (not "Algebra 1") — proper Texas name
- **Geometry** (no number)
- **Algebra II** (uppercase Roman)
- **English I, English II, English III, English IV** — Roman numerals
- **Biology** (just "Biology", not "Biology I")
- **Chemistry, Physics**
- **United States History Studies Since 1877** — full official name; commonly "US History" or "USH"
- **World History Studies** — not currently STAAR EOC-tested

### Grade-level naming
- **Pre-K** (pre-kindergarten)
- **Kindergarten / K** (not "grade 0")
- **Grade 1 through Grade 12** — preferred over "1st grade"
- **Algebra I** is typically taken in grade 8 or 9 in Texas (Texas allows 8th-grade Algebra I for advanced students)

---

## 7. Answer-choice formatting conventions

### Multiple-choice (MC)
- 4 lettered choices: A, B, C, D
- Choice letters are NOT included in the choice text (i.e., the letter "A" is rendered by the test, not part of "A. 50")
- Choice text is plain, no leading bullet, no trailing period (typically)
- **Our generator follows this** — `choices: ["50", "100", "150", "200"]` is the right shape; not `["A. 50", ...]`

### Numeric (gridded)
- Student bubbles in digits in a grid
- Decimals allowed
- Negative numbers allowed (grades 6+)
- **Our generator** outputs `answer: "50"` as a string for `type: 'numeric'` questions (no choices)

### Multi-select (post-2023)
- "Choose 2" or "Choose 3" instructions are explicit
- 5-7 options; multiple correct
- **NOT supported by our generator currently** — kid UI is single-select only

---

## 8. Stimulus reference patterns

When the question references a stimulus (passage, diagram, map, table), STAAR uses specific connectors:

| Stimulus | Common reference phrase |
|---|---|
| Passage | "According to the passage" / "In the passage" / "Based on the passage" |
| Diagram | "Look at the diagram" / "In the diagram" / "Use the diagram" |
| Table | "Look at the table" / "Based on the table" / "Use the data in the table" |
| Graph | "According to the graph" / "Based on the graph" |
| Map | "Use the map" / "Based on the map" |
| Number line | "Use the number line" / "Look at the point on the number line" |
| Image | "Look at the picture" (lower grades) / "Use the image" |

---

## 9. Test administration terms (background context)

Mostly not relevant for question generation but useful to know:

- **STAAR Online** — primary delivery now; some paper allowed for accommodations
- **Test windows** — usually April for grades 3-8; May for EOC; December for retakes
- **Accommodations** — extra time, oral administration, large print, color overlay (per IEP/504)
- **STAAR Released** — the publicly-released items used to be PDFs; post-2025 they're online practice forms at txpt.cambiumtds.com

---

## 10. Phrases to AVOID using

These read as "not Texas" and signal content was generated for a different state's test:
- "Smarter Balanced" (that's California's CAASPP)
- "PARCC" (an old multi-state assessment, no longer used)
- "i-Ready" (a commercial assessment, not Texas state test)
- "Common Core" (Texas explicitly does NOT use Common Core; uses TEKS)
- "MCAS" (Massachusetts), "FAST" (Florida), "Regents" (New York), "MAP" (commercial)
- "B.E.S.T." (Florida's standards)

If our generator references a state test in scenario or context, it must be **STAAR** for Texas content.

---

## 11. Quick reference card

For a single Texas math grade-7 generated question, the metadata should look like:

```
state: "texas"
test: "STAAR Math"
authority: "Texas Education Agency"
standards: "Texas Essential Knowledge and Skills (TEKS)"
grade: "grade-7"
teks: "7.4D"  (or whichever applies)
```

The QUESTION TEXT itself does not need to mention "STAAR" or "TEKS" — those are metadata. The question reads as natural math/reading/science/SS for the grade.
