# Widget spec schema — LLM cheat sheet

> JSON shapes for every widget the generator can emit. Plain-language
> field descriptions, valid ranges, example specs. This is what the
> system prompt feeds the model + what the judge validates against.

## Global rules

- Every widget has a `type` field. Required.
- Every widget has a renderer at `js/widgets/<type>.js` that runs a
  `__validate(spec)` function returning `{ ok, reason }`.
- Color names: `navy` (STAAR-canonical online), `gray` (STAAR-canonical
  paper), `blue`, `teal`, `orange`, `purple`, `green`, `gold`, `pink`.
  **Prefer `navy` for "looks like STAAR" items.** Use `gold` only as
  "answer/highlight" attention color.

---

## `fraction-bar`

Solid rectangle partitioned into `parts` equal cells with leftmost
`filled` cells shaded. The IXL-screenshot widget.

```json
{
  "type": "fraction-bar",
  "parts": 3,
  "filled": 1,
  "color": "navy",
  "label": null
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | string | ✓ | — | must be `"fraction-bar"` |
| `parts` | int | ✓ | — | denominator, 1..20 |
| `filled` | int | ✓ | — | numerator, 0..parts |
| `color` | string | ✗ | `"navy"` | palette name |
| `width` | int | ✗ | 280 | px; > 80 |
| `height` | int | ✗ | 56 | px; > 24 |
| `label` | string \| `"auto"` \| null | ✗ | null | caption below; `"auto"` → "filled/parts" |

**Validation rules** (also enforced server-side):
- `parts` ∈ Z, 1 ≤ parts ≤ 20
- `filled` ∈ Z, 0 ≤ filled ≤ parts

---

## `number-line`

Horizontal axis with ticks, optional marker points, optional inequality
ray. Labels use STAAR-stacked-fraction format when `labelStyle` is
`fraction` or `mixed`.

```json
{
  "type": "number-line",
  "range": [0, 1],
  "step": 0.25,
  "labelStyle": "fraction",
  "marks": [{ "at": 0.75, "color": "navy", "label": "P" }]
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | string | ✓ | — | `"number-line"` |
| `range` | `[number, number]` | ✓ | — | `[min, max]`; max > min |
| `step` | number | ✗ | 1 | major-tick interval |
| `minorStep` | number | ✗ | null | optional finer ticks |
| `labelStyle` | `"decimal"` \| `"fraction"` \| `"mixed"` | ✗ | `"decimal"` | label format |
| `labelEvery` | int | ✗ | 1 | label every Nth major tick |
| `marks` | `[{at, color?, label?}]` | ✗ | `[]` | marker points |
| `inequality` | `"lt"`\|`"le"`\|`"gt"`\|`"ge"` \| null | ✗ | null | shade a ray + endpoint |
| `inequalityAt` | number | ✗ | — | required if inequality is set |
| `width` | int | ✗ | 360 | px |
| `height` | int | ✗ | 80 | px |

**Validation rules:**
- `max > min`
- `step > 0 && step ≤ (max-min)`
- `marks[].at` ∈ [min, max]
- if `inequality` is set, `inequalityAt` must be a number in [min, max]

---

## `plotter`

Bar / dot / line / histogram chart. **Single uniform fill color across
all bars** (STAAR convention — never differentiate by color).

```json
{
  "type": "plotter",
  "chart": "bar",
  "categories": ["1st", "2nd", "3rd", "4th", "5th"],
  "values": [15, 25, 5, 10, 10],
  "xLabel": "School grade",
  "yLabel": "Students absent",
  "yMax": 30,
  "yStep": 5,
  "color": "navy"
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | string | ✓ | — | `"plotter"` |
| `chart` | `"bar"`\|`"dot"`\|`"line"`\|`"histogram"` | ✗ | `"bar"` | |
| `categories` | string[] | ✓ | — | x-axis labels |
| `values` | number[] | ✓ | — | one per category (or n-1 for histogram) |
| `xLabel` | string | ✗ | — | x-axis title |
| `yLabel` | string | ✗ | — | y-axis title (rotated 90°) |
| `yMax` | number | ✗ | nice-max(values) | y-axis upper bound |
| `yStep` | number | ✗ | yMax/5 | y-axis tick interval |
| `color` | string | ✗ | `"navy"` | palette name |
| `width` | int | ✗ | 400 | px |
| `height` | int | ✗ | 280 | px |

**Validation rules:**
- `categories.length ≥ 1`
- For `chart === "histogram"`, `values.length === categories.length - 1`
- For others, `values.length === categories.length`
- All `values[i] ≥ 0`

---

## `table`

Semantic HTML `<table>` with `<thead>` + `<tbody>`. Verdana font, bold
header row, light-gray header fill.

```json
{
  "type": "table",
  "headers": ["Day", "Steps"],
  "rows": [
    ["Mon", "5,200"],
    ["Tue", "6,100"],
    ["Wed", "4,800"]
  ],
  "align": ["left", "right"],
  "caption": null
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | string | ✓ | — | `"table"` |
| `headers` | string[] | ✓ | — | column titles |
| `rows` | string[][] | ✓ | — | each row.length must === headers.length |
| `align` | string[] | ✗ | — | per-column CSS `text-align` |
| `caption` | string | ✗ | null | table title above |

**Validation rules:**
- `headers.length ≥ 1`
- every `rows[i].length === headers.length`

---

## `area-model`

Two flavors:

### Multi-digit multiplication

Outer rectangle partitioned by place-value decomposition. Each
sub-rectangle labeled with its partial product.

```json
{
  "type": "area-model",
  "rows": [10, 4],
  "cols": [20, 3],
  "showProducts": true
}
```

Above: 14 × 23 split as (10+4) × (20+3) showing 200, 30, 80, 12.

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | ✓ | `"area-model"` |
| `rows` | int[] | ✓ | row factor decomposition |
| `cols` | int[] | ✓ | col factor decomposition |
| `showProducts` | bool | ✗ | label each cell with its product (default true) |

### Fraction × fraction grid

Unit square divided into rowDen × colDen cells, with rows + cols shaded
+ overlap region darkest.

```json
{
  "type": "area-model",
  "fractionGrid": true,
  "rowDen": 3,
  "rowNum": 2,
  "colDen": 4,
  "colNum": 3
}
```

Above: 2/3 × 3/4 — top 2 rows shaded + left 3 columns shaded + the 6-cell
top-left overlap is darkest (= 6/12 = 1/2 = the product).

| Field | Type | Required | Notes |
|---|---|---|---|
| `fractionGrid` | bool | ✓ | must be true for this flavor |
| `rowDen` | int | ✓ | row denominator, 1..12 |
| `rowNum` | int | ✓ | row numerator, 0..rowDen |
| `colDen` | int | ✓ | col denominator, 1..12 |
| `colNum` | int | ✓ | col numerator, 0..colDen |

---

## Multiple-choice questions with widget choices

When the question is "Which model represents 1/3?", the `choices` array
in the question JSON contains widget specs INSTEAD of strings:

```json
{
  "question": "Which model represents 1/3 of the poster?",
  "choices": [
    { "type": "fraction-bar", "parts": 3, "filled": 1 },
    { "type": "fraction-bar", "parts": 6, "filled": 1 },
    { "type": "fraction-bar", "parts": 3, "filled": 2 },
    { "type": "fraction-bar", "parts": 4, "filled": 1 }
  ],
  "correctIndex": 0,
  "explanation": "The poster is divided into 3 equal parts. One part shaded is 1/3."
}
```

The frontend `renderChoice(choice)` switches on `typeof choice`:
- If `string`: render as text (current behavior, no change).
- If `object && choice.type`: dispatch to widget renderer.

## Stimulus widgets (question has a diagram)

A question can carry ONE stimulus widget in its `stimulus` field:

```json
{
  "stimulus": { "type": "number-line", "range": [0, 1], "step": 0.25,
                "labelStyle": "fraction",
                "marks": [{ "at": 0.5 }] },
  "question": "What fraction is marked on the number line?",
  "choices": ["1/4", "1/2", "3/4", "1"],
  "correctIndex": 1,
  "explanation": "..."
}
```

## DIAGRAM_INCOHERENT — judge failure mode

The 9th failure mode added to the judge in §110. Triggers when:
- A widget spec is structurally invalid (caught by `__validate`).
- The diagram contradicts the marked answer (e.g., question asks "Which
  model is 1/3?" but `correctIndex` points to a `fraction-bar` with
  `parts: 6, filled: 2` — that's 2/6 = 1/3 mathematically equivalent but
  visually not the canonical 1/3 representation).
- The stimulus widget doesn't match the question (e.g., asking about a
  number line but stimulus is a fraction-bar).
- Any choice widget would render an error placeholder.
