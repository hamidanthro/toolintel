/**
 * area-model — STAAR Grade 4-5 multiplication & fraction × fraction.
 *
 * Two flavors:
 *
 * 1. MULTI-DIGIT MULTIPLICATION (TEKS 4.4D, 5.3D)
 *    Outer rectangle partitioned by place-value decomposition.
 *    Each sub-rectangle labeled with its partial product.
 *    Place-value labels above column widths and left of row heights.
 *
 *    SPEC:
 *      {
 *        "type":   "area-model",
 *        "rows":   [10, 4],          // row factors (e.g. 14 = 10+4)
 *        "cols":   [20, 3],          // col factors (e.g. 23 = 20+3)
 *        "showProducts": true        // show 200, 80, 30, 12 inside cells
 *      }
 *
 * 2. FRACTION × FRACTION (TEKS 5.3I)
 *    Unit square divided into a grid matching the denominators.
 *    One factor shaded as columns, other as rows; overlap is the product.
 *
 *    SPEC:
 *      {
 *        "type":           "area-model",
 *        "fractionGrid":   true,
 *        "rowDen":         3,        // denominator for the row factor
 *        "rowNum":         2,        // numerator (rows shaded)
 *        "colDen":         4,
 *        "colNum":         3
 *      }
 *
 * VALIDATION:
 *   - rows + cols: arrays of positive integers; sums must be positive
 *   - fractionGrid: numerators must satisfy 0 < num <= den, den 1..12
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) {
    console.error('[area-model] widget-renderer.js + svg-helpers.js must load first');
    return;
  }
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) {
      SVG.errorPlaceholder(container, v.reason);
      return;
    }
    if (spec.fractionGrid) {
      renderFractionGrid(spec, container);
    } else {
      renderMultiplication(spec, container);
    }
  }

  function renderMultiplication(spec, container) {
    var rows = spec.rows;
    var cols = spec.cols;
    var showProducts = spec.showProducts !== false;

    var width = 340;
    var height = 220;
    var pad = { l: 50, r: 18, t: 28, b: 18 };
    var gridW = width - pad.l - pad.r;
    var gridH = height - pad.t - pad.b;
    var totalCols = cols.reduce(sum, 0);
    var totalRows = rows.reduce(sum, 0);

    var svg = SVG.canvas(width, height, container);
    svg.setAttribute('class', 'widget-svg widget-area-model widget-area-model--mult');

    // Compute cell widths/heights proportional to factor magnitudes.
    var colWidths = cols.map(function (c) { return Math.round(gridW * c / totalCols); });
    var rowHeights = rows.map(function (r) { return Math.round(gridH * r / totalRows); });
    // Snap final col/row to fill remaining space (cumulative rounding).
    var wSum = colWidths.reduce(sum, 0);
    if (wSum !== gridW) colWidths[colWidths.length - 1] += (gridW - wSum);
    var hSum = rowHeights.reduce(sum, 0);
    if (hSum !== gridH) rowHeights[rowHeights.length - 1] += (gridH - hSum);

    // Column labels (above)
    var x = pad.l;
    for (var ci = 0; ci < cols.length; ci++) {
      SVG.text(x + colWidths[ci] / 2, pad.t - 8, String(cols[ci]), {
        'text-anchor': 'middle',
        'font-family': SVG.STAAR_FONT,
        'font-size': 13,
        'font-weight': 600,
        fill: SVG.STAAR_INK
      }, svg);
      x += colWidths[ci];
    }
    // Row labels (left)
    var y = pad.t;
    for (var ri = 0; ri < rows.length; ri++) {
      SVG.text(pad.l - 10, y + rowHeights[ri] / 2 + 5, String(rows[ri]), {
        'text-anchor': 'end',
        'font-family': SVG.STAAR_FONT,
        'font-size': 13,
        'font-weight': 600,
        fill: SVG.STAAR_INK
      }, svg);
      y += rowHeights[ri];
    }

    // Grid cells.
    var cy = pad.t;
    for (var rr = 0; rr < rows.length; rr++) {
      var cx = pad.l;
      for (var cc = 0; cc < cols.length; cc++) {
        SVG.rect(cx, cy, colWidths[cc], rowHeights[rr], {
          fill: '#ffffff',
          stroke: SVG.STAAR_INK,
          'stroke-width': 1.2,
          'stroke-dasharray': (rr === 0 && cc === 0) ? 'none' : '4 3'
        }, svg);
        if (showProducts) {
          SVG.text(cx + colWidths[cc] / 2, cy + rowHeights[rr] / 2 + 5, String(rows[rr] * cols[cc]), {
            'text-anchor': 'middle',
            'font-family': SVG.STAAR_FONT,
            'font-size': 13,
            'font-weight': 500,
            fill: SVG.STAAR_INK
          }, svg);
        }
        cx += colWidths[cc];
      }
      cy += rowHeights[rr];
    }
    // Outer border (heavier than dashed dividers).
    SVG.rect(pad.l, pad.t, gridW, gridH, {
      fill: 'none',
      stroke: SVG.STAAR_INK,
      'stroke-width': 1.5
    }, svg);
  }

  function renderFractionGrid(spec, container) {
    var rowDen = spec.rowDen, rowNum = spec.rowNum;
    var colDen = spec.colDen, colNum = spec.colNum;
    var size = 220;
    var pad = 8;
    var inner = size - pad * 2;
    var cellW = Math.floor(inner / colDen);
    var cellH = Math.floor(inner / rowDen);
    var width = cellW * colDen + pad * 2;
    var height = cellH * rowDen + pad * 2;

    var svg = SVG.canvas(width, height, container);
    svg.setAttribute('class', 'widget-svg widget-area-model widget-area-model--frac');

    var navy = SVG.color('navy');

    // Background grid: every cell white with thin stroke.
    for (var r = 0; r < rowDen; r++) {
      for (var c = 0; c < colDen; c++) {
        SVG.rect(pad + c * cellW, pad + r * cellH, cellW, cellH, {
          fill: '#ffffff',
          stroke: SVG.STAAR_GRID,
          'stroke-width': 1
        }, svg);
      }
    }
    // Column shading (left colNum columns).
    for (var rc = 0; rc < rowDen; rc++) {
      for (var cc = 0; cc < colNum; cc++) {
        SVG.rect(pad + cc * cellW, pad + rc * cellH, cellW, cellH, {
          fill: navy.fill,
          'fill-opacity': 0.25,
          stroke: 'none'
        }, svg);
      }
    }
    // Row shading (top rowNum rows) — cross-hatch effect through opacity stacking.
    for (var rr2 = 0; rr2 < rowNum; rr2++) {
      for (var cc2 = 0; cc2 < colDen; cc2++) {
        SVG.rect(pad + cc2 * cellW, pad + rr2 * cellH, cellW, cellH, {
          fill: navy.fill,
          'fill-opacity': 0.25,
          stroke: 'none'
        }, svg);
      }
    }
    // Overlap region — darker (the product).
    for (var rrr = 0; rrr < rowNum; rrr++) {
      for (var ccc = 0; ccc < colNum; ccc++) {
        SVG.rect(pad + ccc * cellW, pad + rrr * cellH, cellW, cellH, {
          fill: navy.fill,
          'fill-opacity': 0.35,
          stroke: navy.stroke,
          'stroke-width': 0.5
        }, svg);
      }
    }
    // Outer border.
    SVG.rect(pad, pad, cellW * colDen, cellH * rowDen, {
      fill: 'none',
      stroke: SVG.STAAR_INK,
      'stroke-width': 1.5
    }, svg);
  }

  function sum(a, b) { return a + b; }

  function validate(spec) {
    if (spec.fractionGrid) {
      var fields = ['rowDen', 'rowNum', 'colDen', 'colNum'];
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!Number.isInteger(spec[f]) || spec[f] < 1 || spec[f] > 12) {
          return { ok: false, reason: f + ' must be integer 1..12' };
        }
      }
      if (spec.rowNum > spec.rowDen) {
        return { ok: false, reason: 'rowNum must be <= rowDen' };
      }
      if (spec.colNum > spec.colDen) {
        return { ok: false, reason: 'colNum must be <= colDen' };
      }
      return { ok: true };
    }
    if (!Array.isArray(spec.rows) || !Array.isArray(spec.cols)) {
      return { ok: false, reason: 'rows and cols must be arrays' };
    }
    for (var ri = 0; ri < spec.rows.length; ri++) {
      if (!Number.isInteger(spec.rows[ri]) || spec.rows[ri] < 0) {
        return { ok: false, reason: 'rows[' + ri + '] must be non-negative integer' };
      }
    }
    for (var ci = 0; ci < spec.cols.length; ci++) {
      if (!Number.isInteger(spec.cols[ci]) || spec.cols[ci] < 0) {
        return { ok: false, reason: 'cols[' + ci + '] must be non-negative integer' };
      }
    }
    if (spec.rows.reduce(sum, 0) <= 0 || spec.cols.reduce(sum, 0) <= 0) {
      return { ok: false, reason: 'row/col sums must be > 0' };
    }
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('area-model', render);
})();
