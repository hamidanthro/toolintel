/**
 * shape-2d — labeled 2D geometric shapes (STAAR grade 2-8 staple).
 *
 * Renders simple closed shapes with optional side / angle labels.
 * Per STAAR: black outline 1.5px, no fill, labels in Verdana centered
 * outside the shape.
 *
 * SPEC:
 *   {
 *     "type":  "shape-2d",
 *     "shape": "rectangle",       // rectangle|square|triangle|right-triangle|circle|pentagon|hexagon|trapezoid|parallelogram
 *     "labels": {
 *       "width":  "8 cm",         // for rectangle/square
 *       "height": "5 cm",
 *       "side":   "10 in",        // for triangle (single side label)
 *       "base":   "12 ft",        // for triangle/trapezoid
 *       "leg1":   "3", "leg2": "4", "hyp": "5",  // for right-triangle
 *       "radius": "4",            // for circle
 *       "side1": "...", ...
 *     },
 *     "fill": null,               // optional palette color (default: white outline)
 *     "width":  240,
 *     "height": 180
 *   }
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) return;
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) { SVG.errorPlaceholder(container, v.reason); return; }

    var width = spec.width || 240;
    var height = spec.height || 180;
    var labels = spec.labels || {};
    var fillColor = spec.fill ? SVG.color(spec.fill).fill : '#ffffff';
    var fillOpacity = spec.fill ? 0.18 : 1;
    var stroke = SVG.STAAR_INK;
    var pad = 26;
    var cx = width / 2;
    var cy = height / 2;
    var svg = SVG.canvas(width, height, container);
    svg.setAttribute('class', 'widget-svg widget-shape-2d widget-shape-2d--' + spec.shape);

    function lbl(x, y, txt, opts) {
      if (!txt) return;
      var o = opts || {};
      SVG.text(x, y, String(txt), {
        'text-anchor': o.anchor || 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': 12,
        'font-weight': 500,
        fill: stroke
      }, svg);
    }

    switch (spec.shape) {
      case 'rectangle':
      case 'square': {
        var w = width - pad * 2;
        var h = spec.shape === 'square' ? w : height - pad * 2;
        var x = (width - w) / 2;
        var y = (height - h) / 2;
        SVG.rect(x, y, w, h, { fill: fillColor, 'fill-opacity': fillOpacity, stroke: stroke, 'stroke-width': 1.5 }, svg);
        lbl(x + w / 2, y - 8, labels.width || labels.top || labels.side1 || null);
        lbl(x + w / 2, y + h + 16, labels.bottom || null);
        lbl(x - 10, y + h / 2 + 4, labels.height || labels.left || labels.side2 || null, { anchor: 'end' });
        lbl(x + w + 10, y + h / 2 + 4, labels.right || null, { anchor: 'start' });
        break;
      }
      case 'circle': {
        var r = Math.min(width, height) / 2 - pad;
        SVG.circle(cx, cy, r, { fill: fillColor, 'fill-opacity': fillOpacity, stroke: stroke, 'stroke-width': 1.5 }, svg);
        if (labels.radius) {
          SVG.line(cx, cy, cx + r, cy, { stroke: stroke, 'stroke-width': 1, 'stroke-dasharray': '3 2' }, svg);
          lbl(cx + r / 2, cy - 6, labels.radius);
        }
        break;
      }
      case 'triangle': {
        var apex = { x: cx, y: pad };
        var bl = { x: pad, y: height - pad };
        var br = { x: width - pad, y: height - pad };
        SVG.el('path', {
          d: `M ${apex.x} ${apex.y} L ${bl.x} ${bl.y} L ${br.x} ${br.y} Z`,
          fill: fillColor, 'fill-opacity': fillOpacity,
          stroke: stroke, 'stroke-width': 1.5
        }, svg);
        lbl((bl.x + br.x) / 2, br.y + 16, labels.base || null);
        lbl((apex.x + bl.x) / 2 - 14, (apex.y + bl.y) / 2 + 4, labels.side1 || null, { anchor: 'end' });
        lbl((apex.x + br.x) / 2 + 14, (apex.y + br.y) / 2 + 4, labels.side2 || null, { anchor: 'start' });
        break;
      }
      case 'right-triangle': {
        var P = { x: pad, y: height - pad };           // right-angle vertex
        var Q = { x: width - pad, y: height - pad };   // along base
        var R = { x: pad, y: pad };                    // up the leg
        SVG.el('path', {
          d: `M ${P.x} ${P.y} L ${Q.x} ${Q.y} L ${R.x} ${R.y} Z`,
          fill: fillColor, 'fill-opacity': fillOpacity,
          stroke: stroke, 'stroke-width': 1.5
        }, svg);
        // Right-angle marker
        SVG.rect(P.x + 2, P.y - 10, 8, 8, { fill: 'none', stroke: stroke, 'stroke-width': 1 }, svg);
        lbl((P.x + Q.x) / 2, Q.y + 16, labels.leg1 || labels.base || null);
        lbl(P.x - 8, (P.y + R.y) / 2 + 4, labels.leg2 || labels.height || null, { anchor: 'end' });
        lbl((Q.x + R.x) / 2 + 10, (Q.y + R.y) / 2 - 4, labels.hyp || null, { anchor: 'start' });
        break;
      }
      case 'pentagon':
      case 'hexagon': {
        var sides = spec.shape === 'pentagon' ? 5 : 6;
        var rPoly = Math.min(width, height) / 2 - pad;
        var pts = [];
        for (var i = 0; i < sides; i++) {
          var theta = -Math.PI / 2 + i * (2 * Math.PI / sides);
          pts.push((cx + rPoly * Math.cos(theta)) + ',' + (cy + rPoly * Math.sin(theta)));
        }
        SVG.el('polygon', {
          points: pts.join(' '),
          fill: fillColor, 'fill-opacity': fillOpacity,
          stroke: stroke, 'stroke-width': 1.5
        }, svg);
        break;
      }
      case 'trapezoid': {
        var topW = (width - pad * 2) * 0.6;
        var botW = width - pad * 2;
        var hh = height - pad * 2;
        var tlX = (width - topW) / 2, tlY = pad;
        var blX = pad, blY = height - pad;
        var brX = width - pad, brY = height - pad;
        var trX = (width + topW) / 2, trY = pad;
        SVG.el('polygon', {
          points: [tlX + ',' + tlY, trX + ',' + trY, brX + ',' + brY, blX + ',' + blY].join(' '),
          fill: fillColor, 'fill-opacity': fillOpacity,
          stroke: stroke, 'stroke-width': 1.5
        }, svg);
        lbl(width / 2, tlY - 8, labels.top || null);
        lbl(width / 2, blY + 16, labels.bottom || labels.base || null);
        lbl(blX - 8, (blY + tlY) / 2 + 4, labels.height || null, { anchor: 'end' });
        break;
      }
      case 'parallelogram': {
        var ofs = (width - pad * 2) * 0.18;
        var pa = { x: pad + ofs, y: pad };
        var pb = { x: width - pad, y: pad };
        var pc = { x: width - pad - ofs, y: height - pad };
        var pd = { x: pad, y: height - pad };
        SVG.el('polygon', {
          points: [pa.x + ',' + pa.y, pb.x + ',' + pb.y, pc.x + ',' + pc.y, pd.x + ',' + pd.y].join(' '),
          fill: fillColor, 'fill-opacity': fillOpacity,
          stroke: stroke, 'stroke-width': 1.5
        }, svg);
        lbl((pa.x + pb.x) / 2, pa.y - 8, labels.top || labels.base || null);
        lbl((pa.x + pd.x) / 2 - 8, (pa.y + pd.y) / 2 + 4, labels.side || labels.height || null, { anchor: 'end' });
        break;
      }
    }
  }

  function validate(spec) {
    var ok = ['rectangle', 'square', 'circle', 'triangle', 'right-triangle', 'pentagon', 'hexagon', 'trapezoid', 'parallelogram'];
    if (ok.indexOf(spec.shape) === -1) return { ok: false, reason: 'shape must be one of ' + ok.join(', ') };
    if (spec.labels != null && (typeof spec.labels !== 'object')) return { ok: false, reason: 'labels must be object' };
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('shape-2d', render);
})();
