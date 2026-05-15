/**
 * GradeEarn widget SVG helpers — vanilla, dependency-free.
 *
 * Tiny builder helpers used across every widget renderer
 * (js/widgets/*.js). Goal: keep each widget file readable
 * without leaning on JSX or a template library.
 *
 * SVG namespace must be set explicitly via createElementNS,
 * otherwise the browser treats elements as foreign HTML and
 * they render invisibly.
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null) continue;
        el.setAttribute(k, String(v));
      }
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  // Shorthand factories — every widget reaches for these.
  function rect(x, y, w, h, attrs, parent) {
    var a = Object.assign({ x: x, y: y, width: w, height: h }, attrs || {});
    return svgEl('rect', a, parent);
  }
  function line(x1, y1, x2, y2, attrs, parent) {
    var a = Object.assign({ x1: x1, y1: y1, x2: x2, y2: y2 }, attrs || {});
    return svgEl('line', a, parent);
  }
  function circle(cx, cy, r, attrs, parent) {
    var a = Object.assign({ cx: cx, cy: cy, r: r }, attrs || {});
    return svgEl('circle', a, parent);
  }
  function text(x, y, str, attrs, parent) {
    var a = Object.assign({ x: x, y: y }, attrs || {});
    var el = svgEl('text', a, parent);
    el.textContent = str;
    return el;
  }
  function group(attrs, parent) {
    return svgEl('g', attrs || {}, parent);
  }

  // Palette — STAAR-faithful defaults (per research on TEA released
  // test items 2018-2023). Navy is the canonical online-version bar/
  // fill color; medium-gray approximates the paper-version 50% black.
  // Bright colors (teal/green/orange) are NOT STAAR-canon — included
  // here only for legacy / non-test-mimicking widgets. The judge
  // should prefer "navy" or "gray" for any "looks like STAAR" item.
  var PALETTE = {
    navy:   { fill: '#1e3a8a', stroke: '#0f172a' },   // STAAR canonical online
    gray:   { fill: '#9ca3af', stroke: '#374151' },   // STAAR canonical paper
    blue:   { fill: '#5b8def', stroke: '#3b6fd4' },   // brand blue (non-test-mimic)
    teal:   { fill: '#22d3ee', stroke: '#0891b2' },
    orange: { fill: '#fb923c', stroke: '#ea580c' },
    purple: { fill: '#a78bfa', stroke: '#7c3aed' },
    green:  { fill: '#22c55e', stroke: '#15803d' },
    gold:   { fill: '#fbbf24', stroke: '#d97706' },   // attention / answer-highlight ONLY (per Manim convention)
    pink:   { fill: '#f472b6', stroke: '#db2777' }
  };
  function color(name) {
    return PALETTE[name] || PALETTE.blue;
  }

  // Format a number as a STAAR-style fraction label.
  // "decimal" → "0.5", "fraction" → "1/2", "mixed" → "1 1/2".
  function formatNumber(n, style) {
    if (style === 'fraction' || style === 'mixed') {
      var frac = toFraction(n);
      if (!frac) return String(n);
      if (style === 'mixed' && frac.whole) {
        if (frac.num === 0) return String(frac.whole);
        return frac.whole + ' ' + frac.num + '/' + frac.den;
      }
      return frac.num + '/' + frac.den;
    }
    // decimal: trim trailing zeros
    if (Number.isInteger(n)) return String(n);
    return parseFloat(n.toFixed(3)).toString();
  }

  // Approximate a decimal as a fraction with denominator up to 32.
  // Returns null for irrational-looking values.
  function toFraction(n) {
    if (n === 0) return { whole: 0, num: 0, den: 1 };
    var sign = n < 0 ? -1 : 1;
    var abs = Math.abs(n);
    var whole = Math.floor(abs);
    var frac = abs - whole;
    if (frac < 0.001) return { whole: sign * whole, num: 0, den: 1 };
    // Try standard denominators kids actually see in K-8.
    var dens = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 32, 100];
    for (var i = 0; i < dens.length; i++) {
      var d = dens[i];
      var num = Math.round(frac * d);
      if (Math.abs(num / d - frac) < 0.002) {
        var g = gcd(num, d);
        return { whole: sign * whole, num: num / g, den: d / g };
      }
    }
    return null;
  }
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  // Render a STAAR-style stacked fraction "num/den" with a horizontal
  // vinculum, anchored at (cx, cy_baseline). Returns a <g> element.
  // Per STAAR research §2: stacked fractions are the single biggest
  // "looks like the test" tell on number-line + fraction-bar labels.
  function stackedFraction(parent, cx, cyBaseline, num, den, fontSize, fill) {
    fontSize = fontSize || 12;
    fill = fill || '#0f172a';
    var g = svgEl('g', { 'pointer-events': 'none' }, parent);
    var gap = Math.max(1, Math.round(fontSize * 0.15));
    var halfH = fontSize * 0.55;
    // Numerator (above the bar)
    svgEl('text', {
      x: cx,
      y: cyBaseline - gap - 1,
      'text-anchor': 'middle',
      'font-family': 'Verdana, "DejaVu Sans", sans-serif',
      'font-size': fontSize,
      'font-weight': 500,
      fill: fill
    }, g).textContent = String(num);
    // Vinculum (horizontal bar)
    var halfW = Math.max(6, fontSize * 0.5);
    svgEl('line', {
      x1: cx - halfW,
      y1: cyBaseline + gap - halfH + 1,
      x2: cx + halfW,
      y2: cyBaseline + gap - halfH + 1,
      stroke: fill,
      'stroke-width': 1.2,
      'stroke-linecap': 'square'
    }, g);
    // Denominator (below the bar)
    svgEl('text', {
      x: cx,
      y: cyBaseline + gap + fontSize,
      'text-anchor': 'middle',
      'font-family': 'Verdana, "DejaVu Sans", sans-serif',
      'font-size': fontSize,
      'font-weight': 500,
      fill: fill
    }, g).textContent = String(den);
    return g;
  }

  // Render a label at (x, y). If the value is a fraction (denominator > 1
  // after simplification), use the stacked-fraction renderer per STAAR
  // convention. Otherwise render plain text.
  function fractionLabel(parent, x, y, value, fontSize, fill) {
    fontSize = fontSize || 12;
    fill = fill || '#0f172a';
    var frac = toFraction(value);
    if (!frac || frac.den === 1) {
      var t = svgEl('text', {
        x: x,
        y: y,
        'text-anchor': 'middle',
        'font-family': 'Verdana, "DejaVu Sans", sans-serif',
        'font-size': fontSize,
        'font-weight': 500,
        fill: fill
      }, parent);
      t.textContent = SVG_formatPlain(value);
      return t;
    }
    if (frac.whole === 0) {
      return stackedFraction(parent, x, y - fontSize * 0.4, frac.num, frac.den, fontSize, fill);
    }
    // Mixed number: render whole + stacked fraction inline.
    var g = svgEl('g', {}, parent);
    var wholeText = svgEl('text', {
      x: x - fontSize * 0.6,
      y: y + fontSize * 0.2,
      'text-anchor': 'end',
      'font-family': 'Verdana, "DejaVu Sans", sans-serif',
      'font-size': fontSize,
      'font-weight': 500,
      fill: fill
    }, g);
    wholeText.textContent = String(frac.whole);
    stackedFraction(g, x + fontSize * 0.4, y - fontSize * 0.4, frac.num, frac.den, fontSize, fill);
    return g;
  }
  function SVG_formatPlain(n) {
    if (Number.isInteger(n)) return String(n);
    return parseFloat(n.toFixed(3)).toString();
  }

  // Render an empty SVG canvas of given dimensions.
  function canvas(width, height, parent) {
    var svg = svgEl('svg', {
      xmlns: NS,
      viewBox: '0 0 ' + width + ' ' + height,
      width: width,
      height: height,
      class: 'widget-svg',
      role: 'img',
      'aria-hidden': 'false'
    }, parent);
    return svg;
  }

  // Render an inline error placeholder when a widget spec is malformed.
  // Never throw — the kid sees a tiny "diagram unavailable" pill, not
  // a blank or broken question.
  function errorPlaceholder(container, reason) {
    var div = document.createElement('div');
    div.className = 'widget-error';
    div.setAttribute('role', 'note');
    div.setAttribute('aria-label', 'Diagram unavailable');
    div.textContent = 'Diagram unavailable';
    if (reason) div.title = reason;
    container.appendChild(div);
    return div;
  }

  window.GradeEarnWidgetSVG = {
    NS: NS,
    el: svgEl,
    rect: rect,
    line: line,
    circle: circle,
    text: text,
    group: group,
    canvas: canvas,
    color: color,
    formatNumber: formatNumber,
    toFraction: toFraction,
    stackedFraction: stackedFraction,
    fractionLabel: fractionLabel,
    errorPlaceholder: errorPlaceholder,
    // Constants surfaced for renderer use.
    STAAR_FONT: 'Verdana, "DejaVu Sans", sans-serif',
    STAAR_DEFAULT_COLOR: 'navy',
    STAAR_INK: '#0f172a',
    STAAR_GRID: '#cbd5e1'
  };
})();
