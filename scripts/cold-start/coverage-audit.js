#!/usr/bin/env node
/**
 * Coverage audit (CLAUDE.md §35).
 *
 * Read-only DDB scan over staar-content-pool. Classifies every active
 * Texas math row by (grade × TEKS × question-type). Joins against the
 * §34 Texas Knowledge Pack TEKS taxonomy (194 standards) and the
 * §35 coverage-plan.json (per-bucket targets, STAAR-frequency-weighted)
 * to produce a gap report.
 *
 * Output:
 *   - JSON dump of every active row's classification
 *   - markdown gap report with per-grade bucket fill %, top-10 underserved,
 *     top-5 missing entirely, Texas-specific gaps
 *
 * Usage:
 *   node coverage-audit.js [--state texas] [--subject math]
 *
 * Constraints (CLAUDE.md §35):
 *   - READ-ONLY. No PutItem, no UpdateItem, no DeleteItem.
 *   - Does not invoke OpenAI / Anthropic / any judge / any verifier.
 *   - Pack and plan loaded once per process.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const POOL_TABLE = 'staar-content-pool';

const args = require('minimist')(process.argv.slice(2), {
  string: ['state', 'subject'],
  default: { state: 'texas', subject: 'math' }
});

const PACK_ROOT = path.resolve(__dirname, '..', '..', 'state-packs');
const TEKS_TYPES = ['word-problem', 'computation', 'concept', 'data-interpretation'];

function loadTeksTaxonomy(stateSlug, subject) {
  const f = path.join(PACK_ROOT, stateSlug, 'standards', `teks-${subject}.json`);
  if (!fs.existsSync(f)) return null;
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const byGrade = {};
  for (const k of Object.keys(data)) {
    if (k.startsWith('_')) continue;
    // grade_4 → grade-4, algebra_1 → algebra-1
    const grade = k.replace(/^grade_/, 'grade-').replace('algebra_1', 'algebra-1');
    byGrade[grade] = data[k].standards.map(s => ({
      id: s.id,
      strand: s.strand,
      cognitive_demand: s.cognitive_demand,
      text: s.text
    }));
  }
  return byGrade;
}

function loadPlan(stateSlug) {
  const f = path.join(PACK_ROOT, stateSlug, 'coverage-plan.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

async function scanActiveRows(stateSlug, subject) {
  const items = [];
  let last;
  let scannedTotal = 0;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: POOL_TABLE,
      FilterExpression: '#st = :s AND #sj = :sj AND (attribute_not_exists(#status) OR #status = :a)',
      ExpressionAttributeNames: {
        '#st': 'state',
        '#sj': 'subject',
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':s': stateSlug,
        ':sj': subject,
        ':a': 'active'
      },
      ProjectionExpression: 'contentId, poolKey, grade, questionType, teks, generatedBy, promptVersion, generatedAt, #status',
      ExclusiveStartKey: last
    }));
    scannedTotal += (r.ScannedCount || 0);
    for (const it of (r.Items || [])) items.push(it);
    last = r.LastEvaluatedKey;
  } while (last);
  return { items, scannedTotal };
}

function classify(rows, taxonomy) {
  // Counts per (grade × type) and per (grade × teks × type).
  const byGradeType = {};                 // grade → type → count
  const byGradeTeksType = {};             // grade → teks → type → count
  const untaggedByGrade = {};             // grade → count of rows with no teks
  const allTaggedTeksByGrade = {};        // grade → Set of teks ids actually seen
  const orphanTeksByGrade = {};           // grade → Set of teks ids in lake but NOT in pack taxonomy

  for (const r of rows) {
    const grade = r.grade;
    const type = r.questionType;
    const teks = r.teks || null;

    byGradeType[grade] = byGradeType[grade] || {};
    byGradeType[grade][type] = (byGradeType[grade][type] || 0) + 1;

    if (teks) {
      byGradeTeksType[grade] = byGradeTeksType[grade] || {};
      byGradeTeksType[grade][teks] = byGradeTeksType[grade][teks] || {};
      byGradeTeksType[grade][teks][type] = (byGradeTeksType[grade][teks][type] || 0) + 1;

      allTaggedTeksByGrade[grade] = allTaggedTeksByGrade[grade] || new Set();
      allTaggedTeksByGrade[grade].add(teks);

      const knownTeks = (taxonomy[grade] || []).map(t => t.id);
      if (!knownTeks.includes(teks)) {
        orphanTeksByGrade[grade] = orphanTeksByGrade[grade] || new Set();
        orphanTeksByGrade[grade].add(teks);
      }
    } else {
      untaggedByGrade[grade] = (untaggedByGrade[grade] || 0) + 1;
    }
  }

  return {
    byGradeType,
    byGradeTeksType,
    untaggedByGrade,
    allTaggedTeksByGrade,
    orphanTeksByGrade
  };
}

function applyPlan(taxonomy, plan, classification) {
  // Build a per-(grade × teks × type) gap object using the plan's per-tier
  // targets. Each TEKS lives in ONE tier per the plan; the per-type target
  // is plan.tiers[<tier>].target_per_type.
  if (!plan) return null;
  const gaps = [];   // [{ grade, teks, strand, tier, type, have, need, gap }]
  for (const grade of Object.keys(taxonomy)) {
    const teksList = taxonomy[grade];
    for (const t of teksList) {
      const tier = plan.teks_tier[grade] && plan.teks_tier[grade][t.id]
        ? plan.teks_tier[grade][t.id]
        : (plan.default_tier || 'standard');
      const tierSpec = plan.tiers[tier];
      const need = tierSpec ? tierSpec.target_per_type : 0;
      for (const type of TEKS_TYPES) {
        const have = (((classification.byGradeTeksType[grade] || {})[t.id] || {})[type] || 0);
        const gap = Math.max(0, need - have);
        gaps.push({
          grade, teks: t.id, strand: t.strand, cognitive_demand: t.cognitive_demand,
          tier, type, have, need, gap
        });
      }
    }
  }
  return gaps;
}

function md(s) { return s.replace(/\|/g, '\\|'); }

function buildReport(classification, taxonomy, plan, gaps, stateSlug, subject, scanInfo) {
  const lines = [];
  const now = new Date().toISOString();
  lines.push(`# Coverage Audit — ${stateSlug} ${subject}`);
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Source: \`${POOL_TABLE}\` (DynamoDB, us-east-1)`);
  lines.push(`Scan: ${scanInfo.totalRows} active rows (scanned ${scanInfo.scannedTotal} total)`);
  lines.push('');

  // ---- Section 1: by grade × type ----
  lines.push('## 1. Coverage by (grade × question-type)');
  lines.push('');
  const allGrades = Object.keys(classification.byGradeType).sort();
  lines.push(`| Grade | word-problem | computation | concept | data-interpretation | Total | Untagged TEKS |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const g of allGrades) {
    const c = classification.byGradeType[g] || {};
    const total = TEKS_TYPES.reduce((a, t) => a + (c[t] || 0), 0);
    const untagged = classification.untaggedByGrade[g] || 0;
    lines.push(`| ${g} | ${c['word-problem']||0} | ${c['computation']||0} | ${c['concept']||0} | ${c['data-interpretation']||0} | ${total} | ${untagged} |`);
  }
  lines.push('');

  // ---- Section 2: TEKS taxonomy coverage (per-grade % covered) ----
  if (taxonomy) {
    lines.push('## 2. TEKS taxonomy coverage');
    lines.push('');
    lines.push(`| Grade | TEKS in pack | TEKS with ≥1 row | % covered | Orphan TEKS |`);
    lines.push(`|---|---|---|---|---|`);
    for (const g of Object.keys(taxonomy).sort()) {
      const total = taxonomy[g].length;
      const seen = (classification.allTaggedTeksByGrade[g] || new Set()).size;
      const orphans = (classification.orphanTeksByGrade[g] || new Set()).size;
      const pct = total ? ((seen / total) * 100).toFixed(0) : '—';
      lines.push(`| ${g} | ${total} | ${seen} | ${pct}% | ${orphans} |`);
    }
    lines.push('');
  }

  // ---- Section 3: plan-driven gap (top underserved + top missing) ----
  if (gaps && plan) {
    lines.push('## 3. Plan-driven gap (top underserved by absolute gap)');
    lines.push('');
    lines.push(`Targets per tier (per type): ${Object.entries(plan.tiers).map(([k, v]) => `${k}=${v.target_per_type}`).join(', ')}.`);
    lines.push('');

    // Top 10 underserved (have > 0 but gap > 0)
    const partial = gaps.filter(g => g.have > 0 && g.gap > 0)
                        .sort((a, b) => b.gap - a.gap || b.need - a.need);
    lines.push('### 3a. Top 10 partially-covered buckets (have ≥1 but below target)');
    lines.push('');
    lines.push(`| # | grade | TEKS | strand | type | tier | have | need | gap |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    partial.slice(0, 10).forEach((g, i) => {
      lines.push(`| ${i + 1} | ${g.grade} | ${g.teks} | ${md(g.strand)} | ${g.type} | ${g.tier} | ${g.have} | ${g.need} | ${g.gap} |`);
    });
    lines.push('');

    // Top 5 missing entirely
    const missing = gaps.filter(g => g.have === 0)
                        .sort((a, b) => b.need - a.need);
    const missingCount = missing.length;
    lines.push(`### 3b. Top 5 buckets with ZERO coverage (out of ${missingCount} totally-missing buckets)`);
    lines.push('');
    lines.push(`| # | grade | TEKS | strand | type | tier | need |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    missing.slice(0, 5).forEach((g, i) => {
      lines.push(`| ${i + 1} | ${g.grade} | ${g.teks} | ${md(g.strand)} | ${g.type} | ${g.tier} | ${g.need} |`);
    });
    lines.push('');

    // Section 3c — top tagged TEKS that are *fully covered* (just for sanity)
    const fullyCovered = gaps.filter(g => g.have > 0 && g.gap === 0);
    lines.push(`### 3c. Buckets at-or-above target: ${fullyCovered.length} of ${gaps.length} planned buckets`);
    lines.push('');

    // ---- Section 4: probe-target candidates ----
    // Pull 6 distinct TEKS from partial buckets first; if there aren't enough
    // (the §31 sweep was TEKS-untagged so the lake has near-zero partial
    // coverage on launch), fall back to the top of the zero-coverage HEAVY
    // tier. Diversify across grades so the probe touches multiple grade-bands.
    lines.push('## 4. Probe-target candidates (Phase G input)');
    lines.push('');
    lines.push('6 distinct TEKS deduped by id and diversified across grades. Pulls from partially-covered buckets first; falls back to highest-tier zero-coverage buckets when partial coverage is thin (the §31 sweep was TEKS-untagged so most buckets show have=0 on launch).');
    lines.push('');
    const probeTeks = [];
    const seenTeks = new Set();
    const seenGrades = new Map();
    function tryAdd(g, gradeCap) {
      if (probeTeks.length >= 6) return;
      if (seenTeks.has(g.teks)) return;
      const cnt = seenGrades.get(g.grade) || 0;
      if (gradeCap && cnt >= gradeCap) return;
      probeTeks.push(g);
      seenTeks.add(g.teks);
      seenGrades.set(g.grade, cnt + 1);
    }
    // Pass 1 — partials, one-per-grade
    for (const g of partial) tryAdd(g, 1);
    // Pass 2 — partials, up to two-per-grade
    for (const g of partial) tryAdd(g, 2);
    // Pass 3 — fall back to zero-coverage HEAVY tier, one-per-grade
    const heavyMissing = missing
      .filter(g => g.tier === 'heavy')
      .sort((a, b) => a.grade.localeCompare(b.grade) || a.teks.localeCompare(b.teks));
    for (const g of heavyMissing) tryAdd(g, 1);
    // Pass 4 — fall back to zero-coverage HEAVY tier, up to two-per-grade
    for (const g of heavyMissing) tryAdd(g, 2);
    // Pass 5 — last resort, anything (no cap)
    for (const g of [...partial, ...missing]) tryAdd(g, null);
    lines.push(`| # | grade | TEKS | type | strand | tier | have | need | gap |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    probeTeks.forEach((g, i) => {
      lines.push(`| ${i + 1} | ${g.grade} | ${g.teks} | ${g.type} | ${md(g.strand)} | ${g.tier} | ${g.have} | ${g.need} | ${g.gap} |`);
    });
    lines.push('');
    lines.push('### Probe spec (Phase G)');
    lines.push('');
    lines.push('Run a 24-question probe (4 per TEKS × 6 distinct TEKS). Use `COLD_START_PROBE_RUN_ID` env stamp.');
    lines.push('');

    // ---- Section 5: Texas-specific signal ----
    const texasSpecific = ['3.9', '4.10', '5.10', '6.14', '7.13', '8.12'];   // financial-literacy-rich strands
    const texasGaps = gaps.filter(g => texasSpecific.some(prefix => g.teks.startsWith(prefix)));
    lines.push('## 5. Texas-signature gaps (personal financial literacy strand)');
    lines.push('');
    lines.push('TEKS strands 3.9 / 4.10 / 5.10 / 6.14 / 7.13 / 8.12 are the Texas signature financial-literacy strand (per `state-packs/texas/pedagogy/teaching-philosophy.md`).');
    lines.push('');
    const texasMissing = texasGaps.filter(g => g.have === 0).length;
    const texasPartial = texasGaps.filter(g => g.have > 0 && g.gap > 0).length;
    const texasFull = texasGaps.filter(g => g.gap === 0 && g.have > 0).length;
    lines.push(`- Total Texas-signature buckets in plan: **${texasGaps.length}**`);
    lines.push(`- Missing entirely: **${texasMissing}**`);
    lines.push(`- Partially covered: **${texasPartial}**`);
    lines.push(`- At-or-above target: **${texasFull}**`);
    lines.push('');

    // Save the probe-target list as a side JSON for the probe runner to read.
    return { md: lines.join('\n'), probeTeks };
  }

  return { md: lines.join('\n'), probeTeks: [] };
}

async function main() {
  const stateSlug = args.state;
  const subject = args.subject;

  console.log(`[coverage-audit] state=${stateSlug} subject=${subject}`);
  const taxonomy = loadTeksTaxonomy(stateSlug, subject);
  if (!taxonomy) {
    console.warn(`[coverage-audit] no pack taxonomy at state-packs/${stateSlug}/standards/teks-${subject}.json — proceeding with grade×type only`);
  }
  const plan = loadPlan(stateSlug);
  if (!plan) {
    console.warn(`[coverage-audit] no coverage-plan.json — proceeding without plan-driven gaps`);
  }

  console.log(`[coverage-audit] scanning DDB...`);
  const t0 = Date.now();
  const { items, scannedTotal } = await scanActiveRows(stateSlug, subject);
  console.log(`[coverage-audit] scanned ${scannedTotal} rows in ${((Date.now()-t0)/1000).toFixed(1)}s, kept ${items.length} active`);

  const classification = classify(items, taxonomy || {});
  const gaps = (taxonomy && plan) ? applyPlan(taxonomy, plan, classification) : null;

  const { md: report, probeTeks } = buildReport(
    classification, taxonomy, plan, gaps, stateSlug, subject,
    { totalRows: items.length, scannedTotal }
  );

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const reportPath = path.join(outDir, `texas-math-coverage-gap-${stamp}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`[coverage-audit] report: ${reportPath}`);

  const jsonPath = path.join(outDir, `texas-math-coverage-classification-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    stateSlug, subject, scannedTotal, totalActive: items.length,
    classification: {
      byGradeType: classification.byGradeType,
      byGradeTeksType: classification.byGradeTeksType,
      untaggedByGrade: classification.untaggedByGrade,
      allTaggedTeksByGrade: Object.fromEntries(
        Object.entries(classification.allTaggedTeksByGrade).map(([k, v]) => [k, [...v]])
      ),
      orphanTeksByGrade: Object.fromEntries(
        Object.entries(classification.orphanTeksByGrade).map(([k, v]) => [k, [...v]])
      )
    },
    gaps,
    probeTeks
  }, null, 2));
  console.log(`[coverage-audit] classification JSON: ${jsonPath}`);

  if (probeTeks && probeTeks.length) {
    const probePath = path.join(outDir, 'probe-target-teks.json');
    fs.writeFileSync(probePath, JSON.stringify(probeTeks, null, 2));
    console.log(`[coverage-audit] probe-target list: ${probePath} (${probeTeks.length} TEKS)`);
  }

  console.log(`\n--- Top-line numbers ---`);
  console.log(`Active rows: ${items.length}`);
  for (const g of Object.keys(classification.byGradeType).sort()) {
    const c = classification.byGradeType[g];
    const total = TEKS_TYPES.reduce((a, t) => a + (c[t] || 0), 0);
    const tagged = (classification.allTaggedTeksByGrade[g] || new Set()).size;
    const taxonomyCount = (taxonomy && taxonomy[g]) ? taxonomy[g].length : '?';
    console.log(`  ${g}: ${total} rows, ${tagged}/${taxonomyCount} TEKS covered`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
