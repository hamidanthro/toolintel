/**
 * GradeEarn widget renderer — dispatch entry point.
 *
 * Public API:
 *   window.GradeEarnWidgets.render(spec, container)
 *
 * Loads each widget module on-demand from its file. Each widget
 * module attaches itself to window.GradeEarnWidgets._impls[name]
 * via registerWidget() below.
 *
 * SCHEMA (LLM-emittable, JSON):
 *
 *   { "type": "<widget-name>", ...widget-specific-props }
 *
 * Supported widgets (Tier 1+2, per CLAUDE.md §110):
 *   - fraction-bar
 *   - number-line
 *   - plotter
 *   - table
 *   - area-model
 *
 * Defensive: ANY malformed spec renders a small "Diagram
 * unavailable" placeholder via SVG.errorPlaceholder. The kid
 * never sees a broken question even if the LLM emits garbage.
 *
 * Each widget renderer is a pure function (spec, container) →
 * appends SVG/HTML to container, returns nothing. Render is
 * synchronous; no async, no fetch.
 */
(function () {
  'use strict';

  var impls = {};

  function registerWidget(name, fn) {
    if (typeof fn !== 'function') {
      console.error('[widgets] registerWidget: fn must be a function, got', typeof fn);
      return;
    }
    impls[name] = fn;
  }

  function render(spec, container) {
    if (!container || !(container instanceof HTMLElement)) {
      console.error('[widgets] render: container must be an HTMLElement');
      return;
    }
    if (!spec || typeof spec !== 'object' || !spec.type) {
      window.GradeEarnWidgetSVG.errorPlaceholder(container, 'missing spec.type');
      return;
    }
    var fn = impls[spec.type];
    if (!fn) {
      console.warn('[widgets] unknown widget type:', spec.type);
      window.GradeEarnWidgetSVG.errorPlaceholder(container, 'unknown type: ' + spec.type);
      return;
    }
    try {
      fn(spec, container);
    } catch (err) {
      console.error('[widgets] render failed for', spec.type, err);
      window.GradeEarnWidgetSVG.errorPlaceholder(container, 'render error: ' + (err && err.message));
    }
  }

  // Convenience: render an array of widget specs into already-created DOM
  // (e.g., for the 4 multiple-choice cards on a question).
  function renderAll(specs, containers) {
    if (!Array.isArray(specs) || !Array.isArray(containers)) return;
    var n = Math.min(specs.length, containers.length);
    for (var i = 0; i < n; i++) render(specs[i], containers[i]);
  }

  // Validate-only: returns { ok: bool, reason?: string } without rendering.
  // Used by the judge / lambda schema gate to drop questions whose
  // diagrams are incoherent (e.g., fraction-bar with filled > parts).
  function validate(spec) {
    if (!spec || typeof spec !== 'object' || !spec.type) {
      return { ok: false, reason: 'missing-type' };
    }
    var fn = impls[spec.type];
    if (!fn) return { ok: false, reason: 'unknown-type:' + spec.type };
    var validator = impls[spec.type].__validate;
    if (typeof validator !== 'function') return { ok: true };
    try {
      return validator(spec);
    } catch (err) {
      return { ok: false, reason: 'validator-threw:' + (err && err.message) };
    }
  }

  window.GradeEarnWidgets = {
    render: render,
    renderAll: renderAll,
    validate: validate,
    registerWidget: registerWidget,
    _impls: impls
  };
})();
