# Widget renderer — architecture (§110)

> Diagram infrastructure for STAAR math K-Algebra-1. Built 2026-05-15.
> Live demo: `/widgets-demo.html`.

## Why this exists

Pre-§110, GradeEarn content was text-only. STAAR's released test items
across grades 3-Algebra-1 use visual diagrams in roughly 30-40% of math
items (fraction bars, number lines, bar graphs, area models, tape
diagrams, coordinate planes). Shipping a Texas STAAR product without
diagrams caps quality at "looks vaguely like test prep" — never
"feels like the actual STAAR."

The competing approaches:

| Approach | Verdict |
|---|---|
| LLM emits raw SVG inline | Rejected: ~40% breakage rate, non-judgeable, drifts across model versions |
| Hand-author every item (IXL / Pearson / Cambium model) | Rejected: $200–$2000/item × 60k items doesn't fit a single-founder economy |
| LaTeX/MathJax only, skip visuals (most AI-native edtech) | Rejected: punts on the entire visual question class |
| **Typed widget DSL + LLM-emits-spec + deterministic renderer** | **Chosen** — Khan's Perseus is the industry reference; we ship Perseus-lite scoped to STAAR |

## Architectural shape

```
┌──────────────────────────────────────────────────────────────────────┐
│ Question JSON (lake row in staar-content-pool)                       │
│ {                                                                    │
│   "question": "Which model represents 1/3 of the poster?",          │
│   "choices": [                                                       │
│     { "type": "fraction-bar", "parts": 3, "filled": 1 },             │
│     { "type": "fraction-bar", "parts": 6, "filled": 1 },             │
│     { "type": "fraction-bar", "parts": 3, "filled": 2 },             │
│     { "type": "fraction-bar", "parts": 4, "filled": 1 }              │
│   ],                                                                 │
│   "correctIndex": 0,                                                 │
│   "explanation": "..."                                               │
│ }                                                                    │
└──────────────────────────────────────────────────────────────────────┘
            │                                                  │
            │ written by                                       │ rendered by
            ▼                                                  ▼
  cold-start/generators.js                          js/practice.js
  + lambda/tutor.js#handleGenerate                  → GradeEarnWidgets.render(spec, container)
            │                                                  │
            │ validated by                                     │ uses
            ▼                                                  ▼
  scripts/cold-start/judge.js                        js/widgets/*.js
  + lambda/judge.js (DIAGRAM_INCOHERENT)             (per-type renderers + SVG)
            │
            │ validated by
            ▼
  lambda/content-lake.js#_enforceSaveSchema
  (rejects schema-broken widget specs before PutItem)
```

Choices are **either** strings (text-only, current behavior, no change)
**or** widget spec objects with a `type` field. The frontend
`renderChoice()` switches on type and dispatches to the widget renderer
when needed. Backward compatible: every existing text-only question keeps
working unchanged.

## Files

| File | Role |
|---|---|
| `js/widgets/svg-helpers.js` | SVG element builders, palette, stacked-fraction renderer, error placeholder |
| `js/widgets/widget-renderer.js` | `window.GradeEarnWidgets.render(spec, container)` dispatch entry |
| `js/widgets/fraction-bar.js` | 🔨 custom (highest STAAR volume) |
| `js/widgets/number-line.js` | port of Khan/perseus number-line |
| `js/widgets/plotter.js` | port of Khan/perseus plotter (bar/dot/line/histogram) |
| `js/widgets/table.js` | semantic HTML `<table>` for data/function/two-way tables |
| `js/widgets/area-model.js` | 🔨 custom: multiplication area + fraction × fraction grid |
| `css/styles.css` §110 | `.widget-svg`, `.widget-table`, `.widget-mount`, `.widget-error` |
| `widgets-demo.html` | Live sandbox — load to see every widget rendered with sample specs |
| `docs/widgets/widget-spec-schema.md` | JSON schema cheat-sheet for LLM prompts + judge |

## Design conventions baked in

Per research synthesis from Perseus + STAAR-released test items + 10
open-source math libraries:

1. **STAAR-faithful palette** — navy (#1e3a8a) is the canonical
   online-test fill; medium gray (#9ca3af) is the paper-test fill.
   Bright colors are explicitly NON-test-mimicking; the judge should
   prefer `navy` / `gray` for "looks like STAAR" items. **Gold/yellow is
   reserved for "look here / this is the answer"** (Manim convention).
2. **Verdana font** for all in-diagram labels (every TEA-released PDF
   uses Verdana; this is the single biggest "looks like STAAR" tell).
3. **Stacked fractions** for number-line + fraction-bar labels (vinculum
   rendered as SVG `<line>`, not inline text `"1/3"`).
4. **Sacred equal-parts rule** — fraction-bar cell widths are floored to
   integer pixels, then innerW is trimmed to `parts × cellW` so the
   right edge aligns. Floating-point math can't produce visibly unequal
   "equal" parts.
5. **Stroke hierarchy** — 1.5px primary axes/borders, 1.2px dividers,
   1px grid lines, 0.5-0.75px secondary ticks.
6. **Single uniform fill color** across all bars in a plotter chart
   (STAAR rule — never differentiate bars by color).
7. **Number-line arrowheads on BOTH ends**, both axes of coordinate
   plane carry arrows on all 4 ends.
8. **Defensive validation** — every widget exports a `__validate(spec)`
   function returning `{ ok, reason }`. Used both at render time (showing
   a tiny "Diagram unavailable" placeholder instead of throwing) and at
   judge / save time (rejecting bad specs before they hit the lake).
9. **SVG, not Canvas** — text-selectable, screen-reader-friendly,
   zoom-crisp on phones, DevTools-inspectable. Canvas only earns its
   complexity above ~1000 elements (Plotly/ECharts adaptive threshold).
10. **No build step** — vanilla JS, IIFE-wrapped, attaches to
    `window.GradeEarnWidgets` and `window.GradeEarnWidgetSVG`. Honors
    the project's house style (CLAUDE.md §3).

## Coverage

5 widgets covers ~60-70% of STAAR K-Algebra-1 math visual question types
per the analysis at https://www.texasassessment.gov/. The remaining
20-30% (clocks, money, base-10 blocks, 3D shapes, transformations,
right-triangle Pythagorean, probability spinners, nets, scale drawings)
are Tier 2/3 — defer until Tier 1 quality + adoption metrics justify
expansion.

## Integration plan

| Phase | Status | Description |
|---|---|---|
| **1. Frontend widget library** | ✅ DONE (this commit) | js/widgets/* + CSS §110 + demo page |
| **2. Docs** | ✅ DONE (this commit) | architecture.md + widget-spec-schema.md |
| **3. Lambda schema gate** | next | `lambda/content-lake.js#_enforceSaveSchema` rejects malformed widget specs at PutItem time |
| **4. Judge extension** | next | `judge.js` + `lambda/judge.js` add DIAGRAM_INCOHERENT failure mode (e.g., "filled > parts", "wrong fraction visualization for the answer") |
| **5. Generator extension** | next | `scripts/cold-start/generators.js` learns to emit widget-spec choices for K-5 fraction items |
| **6. Practice render** | next | `js/practice.js` detects widget-spec choices and dispatches to GradeEarnWidgets.render() |
| **7. Probe** | next | 50-question grade-3 fraction probe with fraction-bar widgets; eyeball-gate at 90% LOOKS_CLEAN |

Phases 3-7 are deferred to follow-up commits — they require lambda
deploys + parity-check passes, which deserve their own focused turns.

## What this doesn't ship

- **Interactive widgets** — no drag-to-shade, no number-line click-to-mark.
  Display-only for v1. Interaction is a separate Tier 4 effort and
  introduces a/11y + touch-event complexity that doesn't earn its keep at
  the MVP scope.
- **3D widgets** — rectangular prisms, cylinders, cones, spheres. Tier 3.
- **Geometric construction widgets** — protractor, compass. Tier 4.
- **MathML/KaTeX inline math** — labels are plain SVG text or stacked
  fractions. If algebra-1 items need polynomial labels, that's a future
  KaTeX integration.

## Acceptance check (manual)

1. Load `/widgets-demo.html` locally or in a browser pointing at
   gradeearn.com. Every section renders without console errors. The
   error-handling section shows three "Diagram unavailable" pills.
2. Inspect a `fraction-bar` SVG in DevTools — cell widths are integer
   pixels (not `93.33...`).
3. Inspect a `number-line` with `labelStyle: "fraction"` — labels are
   stacked `<g>` groups with `<line>` vinculum, not inline `"1/3"` text.
4. Inspect any SVG `<text>` element — `font-family` includes Verdana.
5. Inspect a bar `plotter` — every bar has identical `fill` color.
