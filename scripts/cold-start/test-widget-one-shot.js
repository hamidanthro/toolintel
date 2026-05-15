#!/usr/bin/env node
/**
 * One-shot widget generation test with full transparency.
 * Bypasses generateOne's judge-reject-twice flow so we can see the
 * raw model output AND the judge verdict including prose reasons.
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/cold-start/test-widget-one-shot.js
 */
'use strict';

const { buildWidgetModePrompt } = require('./generators');
const { judgeQuestion } = require('./judge');
const { getOpenAI } = require('./lake-client');

async function main() {
  console.log('--- ONE-SHOT WIDGET GENERATION + JUDGE ---\n');

  const systemPrompt = buildWidgetModePrompt({
    stateSlug: 'texas',
    grade: 'grade-3',
    subject: 'math',
    questionType: 'concept',
    packEnrichment: null,
    widgetMode: 'fraction-bar-choices'
  });

  // Call OpenAI directly.
  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate the visual fraction question now. Pick the protagonist name from: Sofia, Diego, Mateo, Aanya, Imani.' }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.9,
    max_tokens: 800
  });
  const raw = completion.choices[0].message.content;
  console.log('RAW MODEL OUTPUT:');
  console.log(raw);
  console.log('');

  const parsed = JSON.parse(raw);
  console.log('PARSED:');
  console.log(JSON.stringify(parsed, null, 2));
  console.log('');

  // Now judge it.
  const verdict = await judgeQuestion(parsed, {
    stateSlug: 'texas',
    subject: 'math',
    grade: 'grade-3',
    gradeLabel: 'grade 3'
  });
  console.log('JUDGE VERDICT:');
  console.log(JSON.stringify(verdict, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
