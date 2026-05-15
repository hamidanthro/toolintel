/**
 * number-line — STAAR all-grade visual (K-Algebra-1).
 *
 * Port of Khan/perseus number-line, simplified to display-only.
 * Renders a horizontal axis with ticks, optional labels, and
 * optional marker points / arrows for inequalities.
 *
 * SPEC:
 *   {
 *     "type":       "number-line",
 *     "range":      [0, 10],     // [min, max], required
 *     "step":       1,           // major-tick interval (default 1)
 *     "minorStep":  null,        // optional minor-tick interval
 *     "labelStyle": "decimal",   // decimal | fraction | mixed (default decimal)
 *     "labelEvery": 1,           // label every Nth major tick (default 1)
 *     "marks": [                 // optional points to mark on the line
 *       { "at": 3.5, "color": "blue", "label": "X" }
 *     ],
 *     "inequality": null,        // optional: "lt"|"le"|"gt"|"ge" + "at" for arrow
 *     "inequalityAt": null,
 *     "width":  360,             // optional render width (default 360)
 *     "height": 80               // optional render height (default 80)
 *   }
 *
 * VALIDATION:
 *   - range must be [number, number] with max > min
 *   - step must be > 0 and <= (max-min)
 *   - marks[].at must be within [min, max]
 *   - inequality must be one of lt|le|gt|ge or null
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) {
    console.error('[number-line] widget-renderer.js + svg-helpers.js must load first');
    return;
  }
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) {
      SVG.errorPlaceholder(container, v.reason);
      return;
    }

    var min = spec.range[0];
    var max = spec.range[1];
    var step = spec.step || 1;
    var minorStep = spec.minorStep || null;
    var labelStyle = spec.labelStyle || 'decimal';
    var labelEvery = Number.isInteger(spec.labelEvery) && spec.labelEvery > 0 ? spec.labelEvery : 1;
    var width = (typeof spec.width === 'number' && spec.width > 120) ? spec.width : 360;
    var height = (typeof spec.height === 'number' && spec.height > 40) ? spec.height : 80;
    var marks = Array.isArray(spec.marks) ? spec.marks : [];

    var pad = { l: 22, r: 22, t: 26, b: 28 };
    var axisY = pad.t + (height - pad.t - pad.b) / 2;
    var axisX0 = pad.l;
    var axisX1 = width - pad.r;

    var svg = SVG.canvas(width, height, container);
    svg.setAttribute('class', 'widget-svg widget-number-line');

    // Map a domain value (min..max) → pixel x.
    function xFor(val) {
      return axisX0 + (val - min) / (max - min) * (axisX1 - axisX0);
    }

    // Main axis line with arrowheads at both ends.
    var arrow = SVG.el('defs', {}, svg);
    var marker = SVG.el('marker', {
      id: 'nl-arrow',
      viewBox: '0 0 10 10',
      refX: 6,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto'
    }, arrow);
    SVG.el('path', {
      d: 'M0,0 L10,5 L0,10 z',
      fill: '#1e293b'
    }, marker);

    SVG.line(axisX0, axisY, axisX1, axisY, {
      stroke: '#1e293b',
      'stroke-width': 1.5,
      'marker-start': 'url(#nl-arrow)',
      'marker-end': 'url(#nl-arrow)'
    }, svg);

    // Minor ticks (lighter, no labels).
    if (minorStep && minorStep > 0 && minorStep < step) {
      var mt = min;
      while (mt <= max + 1e-9) {
        var mx = xFor(mt);
        SVG.line(mx, axisY - 4, mx, axisY + 4, {
          stroke: '#94a3b8',
          'stroke-width': 1
        }, svg);
        mt += minorStep;
      }
    }

    // Major ticks with labels.
    var t = min;
    var ti = 0;
    while (t <= max + 1e-9) {
      var tx = xFor(t);
      SVG.line(tx, axisY - 7, tx, axisY + 7, {
        stroke: '#1e293b',
        'stroke-width': 1.5
      }, svg);
      if (ti % labelEvery === 0) {
        // STAAR convention: stacked fraction for fraction labelStyle,
        // plain text otherwise. fractionLabel handles both cases.
        if (labelStyle === 'fraction' || labelStyle === 'mixed') {
          SVG.fractionLabel(svg, tx, axisY + 18, t, 12, SVG.STAAR_INK);
        } else {
          SVG.text(tx, axisY + 22, SVG.formatNumber(t, labelStyle), {
            'text-anchor': 'middle',
            'font-family': SVG.STAAR_FONT,
            'font-size': 12,
            'font-weight': 500,
            fill: SVG.STAAR_INK
          }, svg);
        }
      }
      t += step;
      ti += 1;
    }

    // Inequality ray + endpoint (open or closed circle).
    if (spec.inequality && typeof spec.inequalityAt === 'number') {
      var ineq = spec.inequality;
      var at = spec.inequalityAt;
      var ix = xFor(at);
      var inDir = (ineq === 'lt' || ineq === 'le') ? -1 : 1;
      var rayEndX = inDir < 0 ? axisX0 : axisX1;
      var ineqColor = SVG.color(SVG.STAAR_DEFAULT_COLOR);
      SVG.line(ix, axisY, rayEndX, axisY, {
        stroke: ineqColor.stroke,
        'stroke-width': 3,
        'stroke-linecap': 'round',
        'marker-end': 'url(#nl-arrow)'
      }, svg);
      var isClosed = (ineq === 'le' || ineq === 'ge');
      SVG.circle(ix, axisY, 6, {
        fill: isClosed ? ineqColor.fill : '#ffffff',
        stroke: ineqColor.stroke,
        'stroke-width': 2
      }, svg);
    }

    // Marker points.
    for (var i = 0; i < marks.length; i++) {
      var mk = marks[i];
      if (typeof mk.at !== 'number' || mk.at < min - 1e-9 || mk.at > max + 1e-9) continue;
      var mc = SVG.color(mk.color || 'blue');
      var mxp = xFor(mk.at);
      SVG.circle(mxp, axisY, 6, {
        fill: mc.fill,
        stroke: mc.stroke,
        'stroke-width': 1.5
      }, svg);
      if (mk.label) {
        SVG.text(mxp, axisY - 14, String(mk.label), {
          'text-anchor': 'middle',
          'font-family': SVG.STAAR_FONT,
          'font-size': 12,
          'font-weight': 600,
          fill: mc.stroke
        }, svg);
      }
    }
  }

  function validate(spec) {
    if (!Array.isArray(spec.range) || spec.range.length !== 2) {
      return { ok: false, reason: 'range must be [min, max]' };
    }
    var min = spec.range[0], max = spec.range[1];
    if (typeof min !== 'number' || typeof max !== 'number' || max <= min) {
      return { ok: false, reason: 'range must satisfy max > min' };
    }
    if (spec.step != null) {
      if (typeof spec.step !== 'number' || spec.step <= 0 || spec.step > (max - min)) {
        return { ok: false, reason: 'step must be positive and <= max-min' };
      }
    }
    if (spec.marks) {
      if (!Array.isArray(spec.marks)) return { ok: false, reason: 'marks must be array' };
      for (var i = 0; i < spec.marks.length; i++) {
        var m = spec.marks[i];
        if (!m || typeof m.at !== 'number') {
          return { ok: false, reason: 'marks[' + i + '].at must be a number' };
        }
        if (m.at < min - 1e-9 || m.at > max + 1e-9) {
          return { ok: false, reason: 'marks[' + i + '].at=' + m.at + ' out of range [' + min + ',' + max + ']' };
        }
      }
    }
    if (spec.inequality) {
      var validIneq = ['lt', 'le', 'gt', 'ge'];
      if (validIneq.indexOf(spec.inequality) === -1) {
        return { ok: false, reason: 'inequality must be one of lt|le|gt|ge' };
      }
      if (typeof spec.inequalityAt !== 'number') {
        return { ok: false, reason: 'inequalityAt must be a number when inequality is set' };
      }
    }
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('number-line', render);
})();
