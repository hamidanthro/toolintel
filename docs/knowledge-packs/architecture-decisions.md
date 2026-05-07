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
