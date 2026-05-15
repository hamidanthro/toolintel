/**
 * base-10-blocks — STAAR K-3 place-value staple.
 *
 * Flat 2D representation (NOT isometric — STAAR convention per the §38
 * research). Black-on-white outline with grid lines. Optional navy fill
 * on the online variant. Renders a number by laying out:
 *   - flats (100s) as 10×10 grids
 *   - rods (10s) as 10×1 columns
 *   - units (1s) as single small squares
 *
 * SPEC:
 *   {
 *     "type":     "base-10-blocks",
 *     "hundreds": 2,
 *     "tens":     3,
 *     "ones":     5,
 *     "filled":   true,           // optional: light navy fill in each cell
 *     "width":    340,            // optional render width
 *     "height":   180             // optional render height
 *   }
 *
 * VALIDATION:
 *   - hundreds 0..9, tens 0..9, ones 0..9 (a kid-readable place-value
 *     digit picture; for "1000" use a separate widget later).
 *   - At least one digit > 0.
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) return;
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) { SVG.errorPlaceholder(container, v.reason); return; }
    var h = spec.hundreds, t = spec.tens, o = spec.ones;
    var filled = spec.filled !== false;
    var width = (typeof spec.width === 'number' && spec.width > 200) ? spec.width : 340;
    var pad = 8;
    var gap = 14;

    // Unit cell size — small enough that 2 hundreds fit on a typical row.
    var unit = 8;
    var flatSize = unit * 10;
    var rodH = unit * 10, rodW = unit;
    var rowH = flatSize;
    var totalH = pad * 2 + rowH;
    if (typeof spec.height === 'number' && spec.height > totalH) totalH = spec.height;

    var svg = SVG.canvas(width, totalH, container);
    svg.setAttribute('class', 'widget-svg widget-base-10-blocks');
    var navy = SVG.color('navy');
    var cellFill = filled ? navy.fill : '#ffffff';
    var cellFillOpacity = filled ? 0.18 : 1;
    var cellStroke = SVG.STAAR_INK;

    var x = pad;
    var y = pad;

    function drawFlat(ox, oy) {
      // 10×10 grid of unit squares
      for (var r = 0; r < 10; r++) {
        for (var c = 0; c < 10; c++) {
          SVG.rect(ox + c * unit, oy + r * unit, unit, unit, {
            fill: cellFill,
            'fill-opacity': cellFillOpacity,
            stroke: cellStroke,
            'stroke-width': 0.5
          }, svg);
        }
      }
      // Outer thicker border
      SVG.rect(ox, oy, flatSize, flatSize, {
        fill: 'none', stroke: cellStroke, 'stroke-width': 1.5
      }, svg);
    }
    function drawRod(ox, oy) {
      for (var r = 0; r < 10; r++) {
        SVG.rect(ox, oy + r * unit, rodW, unit, {
          fill: cellFill, 'fill-opacity': cellFillOpacity,
          stroke: cellStroke, 'stroke-width': 0.5
        }, svg);
      }
      SVG.rect(ox, oy, rodW, rodH, {
        fill: 'none', stroke: cellStroke, 'stroke-width': 1.5
      }, svg);
    }
    function drawUnit(ox, oy) {
      SVG.rect(ox, oy, unit, unit, {
        fill: cellFill, 'fill-opacity': cellFillOpacity,
        stroke: cellStroke, 'stroke-width': 1.5
      }, svg);
    }

    for (var i = 0; i < h; i++) { drawFlat(x, y); x += flatSize + gap; }
    for (var j = 0; j < t; j++) { drawRod(x, y); x += rodW + 3; }
    if (t > 0 && o > 0) x += gap - 3;
    if (h > 0 && t === 0 && o > 0) x += gap - 3;
    // Layout ones in a 5-per-row grid at the bottom of the row.
    var perRow = 5;
    for (var k = 0; k < o; k++) {
      var col = k % perRow;
      var row = Math.floor(k / perRow);
      drawUnit(x + col * (unit + 1), y + flatSize - unit - row * (unit + 1));
    }
  }

  function validate(spec) {
    function intRange(n) { return Number.isInteger(n) && n >= 0 && n <= 9; }
    if (!intRange(spec.hundreds)) return { ok: false, reason: 'hundreds 0..9' };
    if (!intRange(spec.tens)) return { ok: false, reason: 'tens 0..9' };
    if (!intRange(spec.ones)) return { ok: false, reason: 'ones 0..9' };
    if (spec.hundreds + spec.tens + spec.ones === 0) {
      return { ok: false, reason: 'at least one digit must be > 0' };
    }
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('base-10-blocks', render);
})();
