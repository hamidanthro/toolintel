# Architecture decisions — Texas Reading rollout

Decisions made via Owners' Room committee deliberation. Each
decision shows the question, the options considered, the call
made, and the rationale.

## Decision 1 — Paragraph numbering format

**Date:** 2026-05-07
**Owners:** Test Specialist, Apple, Tesla, Google UX, Security, Accessibility
**Status:** RESOLVED

### Question

How should paragraph numbers (which question stems reference) be encoded in passage data?

### Options considered

- A. Inline numbers in markdown text: `(1) Maya woke up...`
- B. Markup with data-num attribute: `<p data-num="1">Maya woke up...</p>`
- C. Markdown storage + CSS counter() rendering at display time

### Decision

C — markdown storage + CSS counter() rendering.

### Rationale

- A breaks the speaker (reads "open paren one close paren")
- A breaks screen readers (same)
- A bakes presentation into content (can't restyle later)
- B stores HTML which adds attack surface
- B requires escaping/sanitization at render time
- C separates concerns: storage = data, presentation = CSS
- C costs ~30-60 min to implement vs ~4-6 hours estimated initially (CSS counter is mature)
- C lets us drop the visual numbers entirely later if we want, without touching content

## Decision 2 — KP §6 demographic ratio

**Date:** 2026-05-07
**Owners:** Test Specialist, Cultural Reviewer, Apple
**Status:** RESOLVED

### Question

Should every passage have a specifically-named diverse protagonist (matching Texas demographics ~76% non-white)?

### Options considered

- A. 90%+ named diverse protagonists (over-representation)
- B. ~52% Hispanic + matching enrollment (true mirror)
- C. TEA-released-test pattern: ~35% Hispanic, 15% Black, 10% Asian, 10% other, 30% unmarked

### Decision

C — match TEA's actual pattern.

### Rationale

- TEA's own released tests don't make every protagonist starkly diverse — about half are demographically unmarked
- Forcing 100% named-diverse leads to "every passage teaches diversity" feel (afterschool special)
- 30% unmarked gives the generator permission to just write a story
- The ratio still over-represents diversity vs raw enrollment share — deliberately

## Decision 3 — KP §6 generator naming rule

**Date:** 2026-05-07
**Owners:** Apple, Cultural Reviewer
**Status:** RESOLVED

### Question

Should generator match protagonist names to "appropriate" story types?

### Decision

NO. Names are independent of plots. Maria gets the soccer story, Sarah gets the tamale-shopping story, Aisha gets the bird-watching story.

### Rationale

LLMs default to stereotype-matching (Maria + piñata, Aisha + hijab). The judge flags this as `STEREOTYPE_RISK`. Names should be drawn from labeled pools (so generator can balance representation) but applied to plots without regard to "fit".

This is a real mechanism the deliberation surfaced — the day was worth it for this single judge rule.

## Decision 4 — KP §9 sibling conflict + weather + bullying refinement

**Date:** 2026-05-07
**Owners:** Curriculum, Reading Editor
**Status:** RESOLVED

### Decision

- **Sibling conflict:** allowed if resolved within passage (was: blanket reject)
- **Weather danger:** allowed if no character is hurt (was: ambiguous)
- **Bullying:** plot rejected, mention allowed (was: plot rejected, ambiguous on mention)

### Rationale

- Sibling conflict is universal grade-3 experience; resolution-modeling is age-appropriate
- Weather events are common in real STAAR (Texas kids know hurricanes); banning all weather over-corrects
- Bullying mention is realistic; bullying as plot hits raw nerves for kids currently experiencing it

## Decision 5 — KP §9 disability framing

**Date:** 2026-05-07
**Owners:** Accessibility, Reading Editor
**Status:** RESOLVED

### Decision

Disability as deficit (kid's blindness is the problem to solve) — REJECTED.
Disability as identity (Patricia Bath's biography; Maya plays soccer and uses a wheelchair) — ALLOWED.

### Rationale

Critical accessibility gap in original KP. Disability is identity, not deficit. The original §9 didn't address disability framing at all; the Accessibility committee call closed the gap.

---

## Science schema (locked 2026-05-08)

**Scope:** Texas Grades 3-8 + Biology. Text-only items in v1 (no diagrams).

**Pipeline:** Mirror reading (`scripts/reading/`), NOT math (`scripts/cold-start/`).
- Generator: Claude Sonnet 4.5 (matches reading)
- Judge: gpt-4o (matches lambda runtime + cold-start math judge)
- KP-driven via `docs/knowledge-packs/texas-science.md`

**Pool key format** (mirrors reading exactly):
- Standalone: `texas#<grade>#science#standalone`
- Cluster (lab scenario): `texas#<grade>#science#<scenarioId>`
- Grade is bare number (3, 4, 5, 6, 7, 8) or `"biology"`

**Item row fields in `staar-content-pool`:**

| Field | Value |
|---|---|
| `subject` | `"science"` |
| `type` | `"science_mc"` \| `"science_multi_select"` \| `"science_inline"` \| `"science_numeric"` |
| `stem` | question text |
| `stemPattern` | e.g. `"Which of these..."` |
| `choices` | string array |
| `correctIndex` | int (or array for multi_select) |
| `claimedTeks` | generator's claim, e.g. `"5.6A"` |
| `teks` | post-judge verified TEK |
| `strand` | one of: `matter_energy`, `force_motion_energy`, `earth_space`, `organisms_environments`, `bio_structures`, `bio_genetics`, `bio_evolution`, `bio_ecology`, `sci_eng_practices` |
| `standardType` | `"Readiness"` \| `"Supporting"` \| `"Practice"` |
| `regionTag` | optional Texas region tag (see KP §4) |
| `scenarioId` | optional FK to `staar-passages` |
| `_kpVersion`, `_judgeVerdict`, `_judgeVersion`, `_judgedAt` | reading conventions |

**Lab scenarios:** Reuse `staar-passages` with `genre="science_scenario"`. No new table. Same passageId hash + stateGradeGenre GSI. Optional new field `scenarioType`: `"experiment"` | `"data_analysis"` | `"described_diagram"`.

**Tables added:** ZERO. Reuses `staar-content-pool` + `staar-passages`.

**Existing teks-science.json reconciliation:**
- `state-packs/texas/standards/teks-science.json` is `[CLAUDE-SYNTHESIZED]` and has at least one wrong TAC section (lists §112.16 for Grade 5; actual is §112.7 per TEA 19 TAC Ch 112 Aug 2024 update).
- The new `docs/knowledge-packs/texas-science.md` is TEA-verified (fetched live from tea.texas.gov 2026-05-07) and is the canonical source.
- JSON file stays as machine-readable index; rebuild from MD when JSON is needed by code.

**New tables:** ZERO.
**Lambda changes for Phase B+C:** ZERO.
**Frontend changes for Phase B+C:** ZERO.

---

## §SS-USA-BROAD — Social Studies + Science go USA-broad (May 14, 2026)

**Decision date:** 2026-05-14
**Status:** Active strategy
**Supersedes:** "Texas depth-first per-state KP" applied only to Math and Reading (STAAR-tested core).
**Trigger:** May 14 audit of Texas Social Studies content (see CLAUDE.md §91 / `staar-content-pool`).

### Why

Social Studies varies less by state than Math. A USA-broad KP for SS (US history, world geography, civics/government, economics) is portable across all 50 states. Building 50 state-specific SS KPs is ~50× the cost for ~5% additional accuracy. Same logic applies to Science — the periodic table doesn't change between Texas and California.

Texas Math + Reading remain Texas-tuned because:
- Texas STAAR Math diverges materially from Common Core (TEKS strands like Personal Financial Literacy aren't in CC).
- STAAR Reading uses Texas-authored passages with regional context kids recognize.

For SS + Science, that divergence is small enough that USA-broad coverage gets us 95% of the way for 2% of the cost.

### Default policy

Build **one USA-broad KP per subject** for SS + Science. Source:
- **Social Studies:** NCSS C3 Framework + Common Core ELA Social Studies strands.
- **Science:** NGSS (Next Generation Science Standards).

National content pool (`state` field set to `usa` or omitted) by default. Single judge prompt per subject. Single content sweep covers all 50 states' kids.

### State-specific overlays

Only build state-specific content where state tests **materially** diverge:
- **Texas STAAR Grade 8 SS:** Texas-history strand (1763-1877 Texas Revolution / Republic / statehood / Reconstruction). Build as a Texas overlay on top of the USA-broad SS KP.
- **Other states:** Add overlays as each state is onboarded, only after inspecting their test specs and finding material divergence.

Overlay rows in `staar-content-pool` carry `state='texas'` (or other); USA-broad rows don't.

### What this affects

- **`staar-content-pool` schema:** SS + Science rows don't need `state` on USA-broad content; `state='texas'` only on overlay rows.
- **`liveForGrade` and similar gates:** SS gated off as of §91 until USA-broad KP ships + judge sweep clears. Re-enable per-grade after content lands.
- **`docs/knowledge-packs/` future structure:**
  - `usa-social-studies.md` (USA-broad SS KP — to build)
  - `usa-science.md` (USA-broad Science KP — to build)
  - `texas-math.md` (state-tuned, lives in state-packs/texas/)
  - `texas-reading.md` (state-tuned, lives in state-packs/texas/)
  - `texas-science.md` (existing, May 8 commit `438a353`) — **preserve**; eventually folds in as Texas overlay on `usa-science.md` (no immediate rewrite).
  - `texas-ss-overlay.md` (future — only the Texas-history strand for STAAR G8)
- **Prompts directory** mirrors the pattern: `usa-ss-judge-v1.md`, `usa-science-judge-v1.md`, plus Texas-overlay variants only where needed.

### Open issues from the May 14 audit

- **870 existing Texas SS rows in `staar-content-pool`** are unjudged + schema-broken (grade field as bare `k`/`2`/`3`/`8` instead of `grade-k`/etc.). **Decision: leave in place, gated off.** Don't tombstone — they may be reusable as overlay seeds for the Texas G8 history strand later. Audit JSON: see §91 commit message.
- **Grade-field schema mismatch** (math = `grade-3` with prefix; reading/science/SS = bare `3`/`k`). **Separate read-path bug** — read paths must already be normalizing somewhere because SS reads have been serving content. Audit prompt in flight (see follow-up §92).
- **§27 letter-prefix-in-choice-text bug** on G8 SS samples (`"A. The revolution was solely..."`). gpt-4o-mini leaking the letter into the string. Likely exists in Math + Reading content too — **separate sweep needed** after schema audit lands.

### Precedent for Science

Texas Science KP (May 8, 2026, commit `438a353`) is a Texas-tuned investment. Per this strategy, Science also defaults USA-broad. Texas Science KP becomes a TX overlay on top of `usa-science.md`. **No action needed now** — just don't deepen the Texas-only science investment without considering the USA-broad direction first.

