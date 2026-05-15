/**
 * Widget-spec server-side validators.
 *
 * Pure-logic mirror of the per-widget __validate functions in
 * js/widgets/<type>.js. Used both inside the lambda (content-lake.js
 * _enforceSaveSchema) and by offline test scripts that need to verify
 * widget specs without booting the AWS SDK.
 *
 * KEEP IN SYNC with js/widgets/<type>.js validators. Frontend +
 * lambda must agree on what's a valid spec, otherwise the lake will
 * accept content that the kid's browser can't render.
 *
 * Returns null when the spec is valid, or a short error string
 * ('parts_out_of_range', etc.) describing the first problem found.
 */
'use strict';

function validateWidgetSpec(spec) {
  if (!spec || typeof spec !== 'object') return 'not_object';
  if (typeof spec.type !== 'string') return 'no_type';
  switch (spec.type) {
    case 'fraction-bar': {
      if (!Number.isInteger(spec.parts) || spec.parts < 1 || spec.parts > 20) return 'parts_out_of_range';
      if (!Number.isInteger(spec.filled) || spec.filled < 0 || spec.filled > spec.parts) return 'filled_out_of_range';
      return null;
    }
    case 'number-line': {
      if (!Array.isArray(spec.range) || spec.range.length !== 2) return 'range_invalid';
      const [min, max] = spec.range;
      if (typeof min !== 'number' || typeof max !== 'number' || max <= min) return 'range_max_le_min';
      if (spec.step != null && (typeof spec.step !== 'number' || spec.step <= 0 || spec.step > (max - min))) return 'step_invalid';
      if (spec.marks) {
        if (!Array.isArray(spec.marks)) return 'marks_not_array';
        for (let i = 0; i < spec.marks.length; i++) {
          const m = spec.marks[i];
          if (!m || typeof m.at !== 'number') return 'marks_at_invalid';
          if (m.at < min - 1e-9 || m.at > max + 1e-9) return 'marks_out_of_range';
        }
      }
      if (spec.inequality) {
        if (['lt','le','gt','ge'].indexOf(spec.inequality) === -1) return 'inequality_invalid';
        if (typeof spec.inequalityAt !== 'number') return 'inequalityAt_invalid';
      }
      return null;
    }
    case 'plotter': {
      if (!Array.isArray(spec.categories) || spec.categories.length < 1) return 'categories_invalid';
      if (!Array.isArray(spec.values)) return 'values_invalid';
      const chart = spec.chart || 'bar';
      if (['bar','dot','line','histogram'].indexOf(chart) === -1) return 'chart_invalid';
      const expectedLen = chart === 'histogram' ? spec.categories.length - 1 : spec.categories.length;
      if (spec.values.length !== expectedLen) return 'values_length_mismatch';
      for (let i = 0; i < spec.values.length; i++) {
        if (typeof spec.values[i] !== 'number' || spec.values[i] < 0) return 'values_negative';
      }
      return null;
    }
    case 'table': {
      if (!Array.isArray(spec.headers) || spec.headers.length < 1) return 'headers_invalid';
      if (!Array.isArray(spec.rows)) return 'rows_invalid';
      const nCols = spec.headers.length;
      for (let i = 0; i < spec.rows.length; i++) {
        if (!Array.isArray(spec.rows[i])) return 'row_' + i + '_not_array';
        if (spec.rows[i].length !== nCols) return 'row_' + i + '_wrong_length';
      }
      return null;
    }
    case 'area-model': {
      if (spec.fractionGrid) {
        const fields = ['rowDen','rowNum','colDen','colNum'];
        for (const f of fields) {
          if (!Number.isInteger(spec[f]) || spec[f] < 1 || spec[f] > 12) return f + '_out_of_range';
        }
        if (spec.rowNum > spec.rowDen) return 'rowNum_exceeds_rowDen';
        if (spec.colNum > spec.colDen) return 'colNum_exceeds_colDen';
        return null;
      }
      if (!Array.isArray(spec.rows) || !Array.isArray(spec.cols)) return 'rows_cols_invalid';
      const sumRow = spec.rows.reduce((a,b)=>a+b,0);
      const sumCol = spec.cols.reduce((a,b)=>a+b,0);
      if (sumRow <= 0 || sumCol <= 0) return 'rows_cols_sum_zero';
      return null;
    }
    case 'tape-diagram': {
      if (!Array.isArray(spec.parts) || spec.parts.length < 1 || spec.parts.length > 10) return 'parts_out_of_range';
      for (let i = 0; i < spec.parts.length; i++) {
        const p = spec.parts[i];
        if (!p || typeof p !== 'object') return 'part_' + i + '_not_object';
        if (p.label == null || (typeof p.label !== 'string' && typeof p.label !== 'number')) return 'part_' + i + '_label_missing';
      }
      return null;
    }
    case 'base-10-blocks': {
      const digits = ['hundreds','tens','ones'];
      for (const f of digits) {
        if (!Number.isInteger(spec[f]) || spec[f] < 0 || spec[f] > 9) return f + '_out_of_range';
      }
      if ((spec.hundreds + spec.tens + spec.ones) === 0) return 'all_digits_zero';
      return null;
    }
    case 'shape-2d': {
      const ok = ['rectangle','square','circle','triangle','right-triangle','pentagon','hexagon','trapezoid','parallelogram'];
      if (ok.indexOf(spec.shape) === -1) return 'shape_invalid';
      if (spec.labels != null && typeof spec.labels !== 'object') return 'labels_not_object';
      return null;
    }
    case 'clock-face': {
      if (!Number.isInteger(spec.hour) || spec.hour < 1 || spec.hour > 12) return 'hour_out_of_range';
      if (!Number.isInteger(spec.minute) || spec.minute < 0 || spec.minute > 59) return 'minute_out_of_range';
      return null;
    }
    default:
      return 'unknown_type:' + spec.type;
  }
}

/**
 * Validate the save-schema for a question candidate. Pure logic (no
 * DynamoDB / no logging), so safe to call from tests. Returns an
 * array of error strings; empty array means valid.
 */
function validateSaveSchema(candidate) {
  const errors = [];
  const t = candidate.type === 'numeric' ? 'numeric' : 'multiple_choice';

  if (!candidate.state || typeof candidate.state !== 'string') errors.push('state_missing');
  if (!candidate.subject || typeof candidate.subject !== 'string') errors.push('subject_missing');
  if (candidate.grade == null || candidate.grade === '') errors.push('grade_missing');

  const promptText = candidate.question || candidate.prompt || '';
  if (typeof promptText !== 'string' || promptText.length < 6) errors.push('question_missing_or_short');

  if (typeof candidate.explanation !== 'string') errors.push('explanation_missing');

  if (t === 'multiple_choice') {
    if (!Array.isArray(candidate.choices) || candidate.choices.length < 2) {
      errors.push('choices_missing_or_too_few');
    } else {
      for (let i = 0; i < candidate.choices.length; i++) {
        const c = candidate.choices[i];
        if (c == null) { errors.push('choice_' + i + '_null'); continue; }
        if (typeof c === 'string') {
          if (c.length === 0) errors.push('choice_' + i + '_empty');
        } else if (typeof c === 'object' && c.type) {
          const wErr = validateWidgetSpec(c);
          if (wErr) errors.push('choice_' + i + '_widget:' + wErr);
        } else {
          errors.push('choice_' + i + '_not_string_or_widget');
        }
      }
      if (!Number.isInteger(candidate.correctIndex)
          || candidate.correctIndex < 0
          || candidate.correctIndex >= candidate.choices.length) {
        errors.push('correctIndex_invalid');
      }
    }
    if (candidate.stimulus != null) {
      if (typeof candidate.stimulus !== 'object' || !candidate.stimulus.type) {
        errors.push('stimulus_not_widget_object');
      } else {
        const sErr = validateWidgetSpec(candidate.stimulus);
        if (sErr) errors.push('stimulus_widget:' + sErr);
      }
    }
  } else {
    if (!candidate.answer || typeof candidate.answer !== 'string') errors.push('numeric_answer_missing');
  }

  return errors;
}

module.exports = { validateWidgetSpec, validateSaveSchema };
