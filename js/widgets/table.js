/**
 * table — data tables, frequency tables, function tables, two-way tables.
 *
 * Renders an HTML <table> rather than SVG (semantically correct + accessible).
 * STAAR convention: bold header row with light gray fill; thin black
 * borders; Verdana font; tight padding.
 *
 * SPEC:
 *   {
 *     "type":    "table",
 *     "headers": ["Day", "Steps"],
 *     "rows":    [
 *       ["Mon", "5,200"],
 *       ["Tue", "6,100"],
 *       ["Wed", "4,800"]
 *     ],
 *     "align":   ["left", "right"],   // optional per-column alignment
 *     "caption": null                 // optional table title
 *   }
 */
(function () {
  'use strict';
  if (!window.GradeEarnWidgets || !window.GradeEarnWidgetSVG) {
    console.error('[table] widget-renderer.js + svg-helpers.js must load first');
    return;
  }
  var SVG = window.GradeEarnWidgetSVG;

  function render(spec, container) {
    var v = validate(spec);
    if (!v.ok) {
      SVG.errorPlaceholder(container, v.reason);
      return;
    }
    var headers = spec.headers;
    var rows = spec.rows;
    var align = Array.isArray(spec.align) ? spec.align : [];
    var nCols = headers.length;

    var t = document.createElement('table');
    t.className = 'widget-table';
    if (spec.caption) {
      var cap = document.createElement('caption');
      cap.className = 'widget-table-caption';
      cap.textContent = String(spec.caption);
      t.appendChild(cap);
    }
    var thead = document.createElement('thead');
    var hrow = document.createElement('tr');
    for (var hi = 0; hi < nCols; hi++) {
      var th = document.createElement('th');
      th.textContent = String(headers[hi]);
      if (align[hi]) th.style.textAlign = String(align[hi]);
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    t.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var ri = 0; ri < rows.length; ri++) {
      var tr = document.createElement('tr');
      var row = rows[ri];
      for (var ci = 0; ci < nCols; ci++) {
        var td = document.createElement('td');
        var val = (ci < row.length) ? row[ci] : '';
        td.textContent = val == null ? '' : String(val);
        if (align[ci]) td.style.textAlign = String(align[ci]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);

    container.appendChild(t);
  }

  function validate(spec) {
    if (!Array.isArray(spec.headers) || spec.headers.length < 1) {
      return { ok: false, reason: 'headers must be non-empty array' };
    }
    if (!Array.isArray(spec.rows)) {
      return { ok: false, reason: 'rows must be array' };
    }
    var nCols = spec.headers.length;
    for (var i = 0; i < spec.rows.length; i++) {
      if (!Array.isArray(spec.rows[i])) {
        return { ok: false, reason: 'rows[' + i + '] must be array' };
      }
      if (spec.rows[i].length !== nCols) {
        return { ok: false, reason: 'rows[' + i + '] length (' + spec.rows[i].length + ') != headers length (' + nCols + ')' };
      }
    }
    if (spec.align != null && !Array.isArray(spec.align)) {
      return { ok: false, reason: 'align must be array or omitted' };
    }
    return { ok: true };
  }
  render.__validate = validate;

  window.GradeEarnWidgets.registerWidget('table', render);
})();
