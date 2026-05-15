/**
 * plotter — bar charts, dot plots, line plots, histograms.
 *
 * Port of Khan/perseus plotter, simplified to display-only.
 * STAAR convention (per research): single uniform fill color
 * across all bars/dots within a plot. No legend on Grade 3-5.
 * Y-axis title rotated 90° left of axis; X-axis labels horizontal.
 *
 * SPEC:
 *   {
 *     "type":       "plotter",
 *     "chart":      "bar",                  // bar | dot | line | histogram
 *     "categories": ["1st","2nd","3rd"],    // x-axis category labels
 *     "values":     [15, 25, 10],           // one value per category
 *     "xLabel":     "School grade",         // optional
 *     "yLabel":     "Students absent",      // optional
 *     "yMax":       30,                     // optional; computed from values if missing
 *     "yStep":      5,                      // optional; computed if missing
 *     "color":      "navy",                 // optional; default 'navy'
 *     "width":      400,
 *     "height":     280
 *   }
 *
 * dot plot:
 *   Renders one stack of solid dots per category. `values[i]` = stack height.
 *
 * line plot:
 *   Render values as a polyline with circular markers at each (x,y).
 *
 * histogram:
 *   N categories define N-1 bin boundaries. Each value[i] is the bin
 *   height between categories[i] and categories[i+1].
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) {
    console.error('[plotter] widget-renderer.js + svg-helpers.js must load first');
    return;
  }
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) {
      SVG.errorPlaceholder(container, v.reason);
      return;
    }

    var chart = spec.chart || 'bar';
    var cats = spec.categories;
    var vals = spec.values;
    var color = SVG.color(spec.color || SVG.STAAR_DEFAULT_COLOR);
    var width = (typeof spec.width === 'number' && spec.width > 200) ? spec.width : 400;
    var height = (typeof spec.height === 'number' && spec.height > 160) ? spec.height : 280;

    var yMax = (typeof spec.yMax === 'number' && spec.yMax > 0) ? spec.yMax : niceMax(Math.max.apply(null, vals));
    var yStep = (typeof spec.yStep === 'number' && spec.yStep > 0) ? spec.yStep : niceStep(yMax);

    // Plot area
    var pad = { l: 50, r: 18, t: 14, b: 52 };
    var plotW = width - pad.l - pad.r;
    var plotH = height - pad.t - pad.b;
    var plotX0 = pad.l;
    var plotY0 = pad.t;
    var plotX1 = pad.l + plotW;
    var plotY1 = pad.t + plotH;

    var svg = SVG.canvas(width, height, container);
    svg.setAttribute('class', 'widget-svg widget-plotter widget-plotter--' + chart);

    function yFor(val) {
      return plotY1 - (val / yMax) * plotH;
    }

    // Y-axis: solid black, ticks + labels at yStep intervals.
    SVG.line(plotX0, plotY0, plotX0, plotY1, {
      stroke: SVG.STAAR_INK,
      'stroke-width': 1.5
    }, svg);
    for (var ty = 0; ty <= yMax + 1e-9; ty += yStep) {
      var yy = yFor(ty);
      SVG.line(plotX0 - 5, yy, plotX0, yy, {
        stroke: SVG.STAAR_INK,
        'stroke-width': 1.5
      }, svg);
      SVG.text(plotX0 - 8, yy + 4, String(Math.round(ty * 100) / 100), {
        'text-anchor': 'end',
        'font-family': SVG.STAAR_FONT,
        'font-size': 11,
        fill: SVG.STAAR_INK
      }, svg);
    }

    // X-axis baseline (solid black).
    SVG.line(plotX0, plotY1, plotX1, plotY1, {
      stroke: SVG.STAAR_INK,
      'stroke-width': 1.5
    }, svg);

    // Bars / dots / line — per chart type.
    var n = chart === 'histogram' ? Math.max(1, cats.length - 1) : cats.length;
    var slot = plotW / n;
    if (chart === 'bar') {
      var barW = Math.floor(slot * 0.62);
      for (var i = 0; i < n; i++) {
        var bx = plotX0 + i * slot + (slot - barW) / 2;
        var by = yFor(vals[i]);
        var bh = plotY1 - by;
        SVG.rect(bx, by, barW, bh, {
          fill: color.fill,
          stroke: color.stroke,
          'stroke-width': 1
        }, svg);
      }
    } else if (chart === 'dot') {
      var dotR = Math.min(8, Math.floor(slot * 0.18));
      for (var di = 0; di < n; di++) {
        var dx = plotX0 + di * slot + slot / 2;
        var nDots = Math.round(vals[di]);
        var stackY = plotY1 - dotR;
        for (var k = 0; k < nDots; k++) {
          SVG.circle(dx, stackY, dotR, {
            fill: color.fill,
            stroke: color.stroke,
            'stroke-width': 1
          }, svg);
          stackY -= dotR * 2 + 1;
        }
      }
    } else if (chart === 'line') {
      var pts = [];
      for (var li = 0; li < n; li++) {
        var lx = plotX0 + li * slot + slot / 2;
        var ly = yFor(vals[li]);
        pts.push(lx + ',' + ly);
      }
      SVG.el('polyline', {
        points: pts.join(' '),
        fill: 'none',
        stroke: color.stroke,
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }, svg);
      for (var li2 = 0; li2 < n; li2++) {
        var lx2 = plotX0 + li2 * slot + slot / 2;
        var ly2 = yFor(vals[li2]);
        SVG.circle(lx2, ly2, 4, {
          fill: color.fill,
          stroke: color.stroke,
          'stroke-width': 1.5
        }, svg);
      }
    } else if (chart === 'histogram') {
      for (var hi = 0; hi < n; hi++) {
        var hx = plotX0 + hi * slot;
        var hy = yFor(vals[hi]);
        var hh = plotY1 - hy;
        SVG.rect(hx, hy, slot, hh, {
          fill: color.fill,
          stroke: color.stroke,
          'stroke-width': 1
        }, svg);
      }
    }

    // X-axis category labels.
    var labelStep = chart === 'histogram' ? slot : slot;
    var nLabels = chart === 'histogram' ? cats.length : cats.length;
    for (var ci = 0; ci < nLabels; ci++) {
      var cx = chart === 'histogram'
        ? plotX0 + ci * labelStep
        : plotX0 + ci * labelStep + labelStep / 2;
      SVG.text(cx, plotY1 + 16, String(cats[ci]), {
        'text-anchor': 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': 11,
        fill: SVG.STAAR_INK
      }, svg);
    }

    // Axis titles.
    if (spec.xLabel) {
      SVG.text(plotX0 + plotW / 2, height - 8, String(spec.xLabel), {
        'text-anchor': 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': 12,
        'font-weight': 600,
        fill: SVG.STAAR_INK
      }, svg);
    }
    if (spec.yLabel) {
      var yt = SVG.text(0, 0, String(spec.yLabel), {
        'text-anchor': 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': 12,
        'font-weight': 600,
        fill: SVG.STAAR_INK,
        transform: 'translate(14,' + (plotY0 + plotH / 2) + ') rotate(-90)'
      }, svg);
      yt.removeAttribute('x'); yt.removeAttribute('y');
    }
  }

  // Pick a "nice" y-axis max ≥ data max. E.g., 23 → 25, 47 → 50, 130 → 150.
  function niceMax(dataMax) {
    if (dataMax <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(dataMax)));
    var norm = dataMax / mag;
    var nice;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * mag;
  }
  function niceStep(yMax) {
    return yMax / 5;
  }

  function validate(spec) {
    if (!Array.isArray(spec.categories) || spec.categories.length < 1) {
      return { ok: false, reason: 'categories must be a non-empty array' };
    }
    if (!Array.isArray(spec.values)) {
      return { ok: false, reason: 'values must be an array' };
    }
    var chart = spec.chart || 'bar';
    var expectedLen = chart === 'histogram'
      ? spec.categories.length - 1
      : spec.categories.length;
    if (spec.values.length !== expectedLen) {
      return { ok: false, reason: 'values length (' + spec.values.length + ') must equal expected (' + expectedLen + ') for chart=' + chart };
    }
    for (var i = 0; i < spec.values.length; i++) {
      if (typeof spec.values[i] !== 'number' || spec.values[i] < 0) {
        return { ok: false, reason: 'values[' + i + '] must be a non-negative number' };
      }
    }
    var validCharts = ['bar', 'dot', 'line', 'histogram'];
    if (validCharts.indexOf(chart) === -1) {
      return { ok: false, reason: 'chart must be one of bar|dot|line|histogram' };
    }
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('plotter', render);
})();
