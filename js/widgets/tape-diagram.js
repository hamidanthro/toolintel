/**
 * tape-diagram (strip-diagram) — Texas STAAR grade 3-5 staple for
 * multi-step word problems + ratio reasoning.
 *
 * Renders a horizontal "tape" partitioned into labeled parts. STAAR
 * convention: black outline, ~1.5px stroke, monochrome paper version;
 * navy fills allowed on the online version (we default to white).
 *
 * SPEC:
 *   {
 *     "type":  "tape-diagram",
 *     "parts": [
 *       { "label": "12", "fill": "navy" },
 *       { "label": "?",  "fill": null }
 *     ],
 *     "total": "30",                  // optional: brace + total label above
 *     "totalAt": "top",               // top|bottom|null (default top if total)
 *     "width":  340,
 *     "height": 64
 *   }
 *
 * Each part's width is proportional to its numeric label (when labels
 * are numeric); otherwise parts are equal width. Labels render INSIDE
 * each cell, centered.
 *
 * VALIDATION:
 *   - parts: array of 1-10 objects with .label (string or number)
 *   - total: optional string
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) return;
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) { SVG.errorPlaceholder(container, v.reason); return; }
    var parts = spec.parts;
    var width = (typeof spec.width === 'number' && spec.width > 120) ? spec.width : 340;
    var height = (typeof spec.height === 'number' && spec.height > 32) ? spec.height : 64;
    var totalLabel = spec.total ? String(spec.total) : null;
    var totalAt = spec.totalAt || (totalLabel ? 'top' : null);

    var pad = 4;
    var braceH = 14;
    var topRoom = totalAt === 'top' ? braceH + 6 : 0;
    var botRoom = totalAt === 'bottom' ? braceH + 6 : 0;
    var totalH = height + topRoom + botRoom;

    // Compute proportional widths if all labels parse as numbers.
    var numericLabels = parts.map(function (p) {
      var n = Number(p.label);
      return Number.isFinite(n) ? n : null;
    });
    var allNumeric = numericLabels.every(function (n) { return n !== null && n > 0; });
    var availW = width - pad * 2;
    var widths;
    if (allNumeric) {
      var sum = numericLabels.reduce(function (a, b) { return a + b; }, 0);
      widths = numericLabels.map(function (n) { return Math.max(20, Math.floor(availW * n / sum)); });
      // Reconcile rounding so the cells exactly fill availW.
      var widthSum = widths.reduce(function (a, b) { return a + b; }, 0);
      widths[widths.length - 1] += (availW - widthSum);
    } else {
      var cellW = Math.floor(availW / parts.length);
      widths = parts.map(function () { return cellW; });
      widths[widths.length - 1] += availW - cellW * parts.length;
    }

    var svg = SVG.canvas(width, totalH, container);
    svg.setAttribute('class', 'widget-svg widget-tape-diagram');

    var bandTop = pad + topRoom;
    var bandH = height - pad * 2;

    // Cells.
    var x = pad;
    for (var i = 0; i < parts.length; i++) {
      var fillColor = '#ffffff';
      if (parts[i].fill) {
        var c = SVG.color(parts[i].fill);
        fillColor = c.fill;
      }
      SVG.rect(x, bandTop, widths[i], bandH, {
        fill: fillColor,
        'fill-opacity': parts[i].fill ? 0.25 : 1,
        stroke: SVG.STAAR_INK,
        'stroke-width': 1.5
      }, svg);
      SVG.text(x + widths[i] / 2, bandTop + bandH / 2 + 5, String(parts[i].label), {
        'text-anchor': 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': 13,
        'font-weight': 600,
        fill: SVG.STAAR_INK
      }, svg);
      x += widths[i];
    }

    // Optional total label + brace.
    if (totalLabel) {
      var braceY = totalAt === 'top' ? bandTop - 4 : bandTop + bandH + 4;
      var braceDir = totalAt === 'top' ? -1 : 1;
      var bx0 = pad, bx1 = pad + availW;
      var cx = (bx0 + bx1) / 2;
      var bend = braceY + braceDir * braceH;
      // Simple C-bracket: two horizontal + two short verticals.
      var path = 'M ' + bx0 + ' ' + braceY +
                 ' L ' + bx0 + ' ' + bend +
                 ' L ' + bx1 + ' ' + bend +
                 ' L ' + bx1 + ' ' + braceY;
      SVG.el('path', {
        d: path,
        fill: 'none',
        stroke: SVG.STAAR_INK,
        'stroke-width': 1.2
      }, svg);
      var textY = totalAt === 'top' ? bend - 4 : bend + 14;
      SVG.text(cx, textY, totalLabel, {
        'text-anchor': 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': 13,
        'font-weight': 700,
        fill: SVG.STAAR_INK
      }, svg);
    }
  }

  function validate(spec) {
    if (!Array.isArray(spec.parts) || spec.parts.length < 1 || spec.parts.length > 10) {
      return { ok: false, reason: 'parts must be array of 1-10 entries' };
    }
    for (var i = 0; i < spec.parts.length; i++) {
      var p = spec.parts[i];
      if (!p || typeof p !== 'object') return { ok: false, reason: 'parts[' + i + '] must be object' };
      if (p.label == null || (typeof p.label !== 'string' && typeof p.label !== 'number')) {
        return { ok: false, reason: 'parts[' + i + '].label required (string or number)' };
      }
    }
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('tape-diagram', render);
})();
