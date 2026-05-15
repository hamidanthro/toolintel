/**
 * clock-face — analog clock for STAAR grades 1-3 telling-time items.
 *
 * Renders an analog clock with hour + minute hands at the specified
 * time. Hour numbers 1-12 around the face. Minute ticks every 5 mins.
 *
 * SPEC:
 *   {
 *     "type":   "clock-face",
 *     "hour":   3,           // 1..12
 *     "minute": 15,          // 0..59
 *     "showSecondHand": false,
 *     "size":   200          // px square
 *   }
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) return;
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) { SVG.errorPlaceholder(container, v.reason); return; }
    var size = spec.size || 200;
    var cx = size / 2, cy = size / 2;
    var r = size / 2 - 10;
    var svg = SVG.canvas(size, size, container);
    svg.setAttribute('class', 'widget-svg widget-clock-face');
    var stroke = SVG.STAAR_INK;

    // Outer circle
    SVG.circle(cx, cy, r, { fill: '#ffffff', stroke: stroke, 'stroke-width': 2 }, svg);

    // Minute ticks (every 5 deg = every minute; longer every 5 min)
    for (var i = 0; i < 60; i++) {
      var ang = (i / 60) * 2 * Math.PI - Math.PI / 2;
      var inner = r - (i % 5 === 0 ? 8 : 4);
      var x1 = cx + Math.cos(ang) * r;
      var y1 = cy + Math.sin(ang) * r;
      var x2 = cx + Math.cos(ang) * inner;
      var y2 = cy + Math.sin(ang) * inner;
      SVG.line(x1, y1, x2, y2, {
        stroke: stroke,
        'stroke-width': i % 5 === 0 ? 1.5 : 1
      }, svg);
    }

    // Hour numbers
    for (var h = 1; h <= 12; h++) {
      var hAng = (h / 12) * 2 * Math.PI - Math.PI / 2;
      var lr = r - 22;
      SVG.text(cx + Math.cos(hAng) * lr, cy + Math.sin(hAng) * lr + 5, String(h), {
        'text-anchor': 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': Math.floor(size * 0.085),
        'font-weight': 700,
        fill: stroke
      }, svg);
    }

    // Hands. Minute first, then hour on top.
    var minAng = ((spec.minute % 60) / 60) * 2 * Math.PI - Math.PI / 2;
    var minLen = r - 14;
    SVG.line(cx, cy, cx + Math.cos(minAng) * minLen, cy + Math.sin(minAng) * minLen, {
      stroke: stroke, 'stroke-width': 2.5, 'stroke-linecap': 'round'
    }, svg);

    var hourFrac = (spec.hour % 12) + (spec.minute / 60);
    var hourAng = (hourFrac / 12) * 2 * Math.PI - Math.PI / 2;
    var hourLen = r * 0.55;
    SVG.line(cx, cy, cx + Math.cos(hourAng) * hourLen, cy + Math.sin(hourAng) * hourLen, {
      stroke: stroke, 'stroke-width': 4, 'stroke-linecap': 'round'
    }, svg);

    // Center dot
    SVG.circle(cx, cy, 4, { fill: stroke, stroke: 'none' }, svg);
  }

  function validate(spec) {
    if (!Number.isInteger(spec.hour) || spec.hour < 1 || spec.hour > 12) return { ok: false, reason: 'hour must be integer 1..12' };
    if (!Number.isInteger(spec.minute) || spec.minute < 0 || spec.minute > 59) return { ok: false, reason: 'minute must be integer 0..59' };
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('clock-face', render);
})();
