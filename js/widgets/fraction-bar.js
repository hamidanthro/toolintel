/**
 * fraction-bar — STAAR's most common K-5 visual.
 *
 * The IXL-screenshot widget. Renders a rectangle subdivided into
 * `parts` equal cells, with the leftmost `filled` cells shaded.
 *
 * SPEC:
 *   {
 *     "type":   "fraction-bar",
 *     "parts":  3,           // denominator, 1..20
 *     "filled": 1,           // numerator, 0..parts
 *     "color":  "blue",      // blue|teal|orange|purple|green|gold|pink (default blue)
 *     "width":  280,         // optional render width in px (default 280)
 *     "height": 56,          // optional render height (default 56)
 *     "label":  null         // optional "1/3" caption below (auto-generated if "auto")
 *   }
 *
 * Visual conventions (matched against STAAR released items + IXL):
 *   - 2px outer rounded border
 *   - 1.5px internal divider lines
 *   - Shaded cells: brand color fill at 0.55 opacity + 1.5px stroke
 *   - Unshaded cells: white fill, light gray stroke
 *   - Border-radius: 6px on outer rectangle, 0 on internal cells
 *   - All cells perfectly equal width (no aspect drift)
 *
 * VALIDATION (used by lambda judge / schema gate):
 *   - parts must be integer 1..20
 *   - filled must be integer 0..parts
 *   - color must be one of the palette names (or omitted)
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) {
    console.error('[fraction-bar] widget-renderer.js + svg-helpers.js must load first');
    return;
  }
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) {
      SVG.errorPlaceholder(container, v.reason);
      return;
    }
    var parts = spec.parts;
    var filled = spec.filled;
    // Default to navy (STAAR canonical online color). Caller can pass
    // any palette name; bright colors are non-test-mimicking.
    var color = SVG.color(spec.color || SVG.STAAR_DEFAULT_COLOR);
    var width = (typeof spec.width === 'number' && spec.width > 80) ? spec.width : 280;
    var height = (typeof spec.height === 'number' && spec.height > 24) ? spec.height : 56;

    // Padding so the stroke isn't clipped at the SVG edge.
    // SACRED EQUAL-PARTS RULE: floor cellW to integer px so that
    // floating-point arithmetic can't make "equal" parts visibly
    // unequal. Trim innerW to parts × cellW so right edge aligns.
    var pad = 2;
    var rawInnerW = width - pad * 2;
    var cellW = Math.floor(rawInnerW / parts);
    var innerW = cellW * parts;
    var innerH = height - pad * 2;

    var totalHeight = height + (spec.label ? 22 : 0);
    var svg = SVG.canvas(width, totalHeight, container);
    svg.setAttribute('class', 'widget-svg widget-fraction-bar');

    // Outer rounded rect — sits BEHIND the cell strokes so the
    // rounded corners read clean.
    SVG.rect(pad, pad, innerW, innerH, {
      fill: '#ffffff',
      stroke: color.stroke,
      'stroke-width': 2,
      rx: 6,
      ry: 6
    }, svg);

    // Shaded cells. We draw each filled cell as a separate rect on
    // top of the white background so the divider strokes don't
    // interrupt the fill. The leftmost filled cell carries the
    // top-left + bottom-left rounded corners; the rightmost-of-
    // filled carries the top-right + bottom-right corners — but
    // ONLY when filled === parts (whole bar shaded). Else inner
    // filled cells are square.
    var g = SVG.group({ 'pointer-events': 'none' }, svg);
    for (var i = 0; i < filled; i++) {
      var x = pad + i * cellW;
      var isFirst = i === 0;
      var isLast = i === filled - 1 && filled === parts;
      var cellRx = (isFirst || isLast) ? 6 : 0;
      SVG.rect(x, pad, cellW, innerH, {
        fill: color.fill,
        'fill-opacity': 0.55,
        stroke: 'none',
        rx: cellRx,
        ry: cellRx
      }, g);
    }

    // Internal dividers — vertical lines between cells.
    for (var j = 1; j < parts; j++) {
      var dx = pad + j * cellW;
      SVG.line(dx, pad, dx, pad + innerH, {
        stroke: color.stroke,
        'stroke-width': 1.5,
        'stroke-linecap': 'square'
      }, svg);
    }

    // Optional label caption below the bar.
    if (spec.label) {
      var labelText = spec.label === 'auto'
        ? (filled + '/' + parts)
        : String(spec.label);
      SVG.text(width / 2, height + 16, labelText, {
        'text-anchor': 'middle',
        'font-family': 'Inter, sans-serif',
        'font-size': 13,
        'font-weight': 600,
        fill: '#0f172a'
      }, svg);
    }
  }

  function validate(spec) {
    if (!Number.isInteger(spec.parts) || spec.parts < 1 || spec.parts > 20) {
      return { ok: false, reason: 'parts must be integer 1..20, got ' + spec.parts };
    }
    if (!Number.isInteger(spec.filled) || spec.filled < 0 || spec.filled > spec.parts) {
      return { ok: false, reason: 'filled must be integer 0..parts (parts=' + spec.parts + '), got ' + spec.filled };
    }
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('fraction-bar', render);
})();
