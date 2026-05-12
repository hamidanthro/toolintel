#!/usr/bin/env node
/**
 * Per-TEKS static-page generator — long-tail SEO.
 *
 * Why: build-free-worksheets.js already emits per-grade (10) and per-unit
 * (~50) pages. This script adds the third tier: one page per individual
 * TEKS standard (~194 Texas math TEKS), each targeting a specific
 * long-tail query like "TEKS 3.2A worksheets" or "TEKS 5.3C practice".
 *
 * Output:
 *   /free-worksheets/<grade>/teks-<id-slug>.html
 *
 * e.g. TEKS 3.2A  → /free-worksheets/grade-3/teks-3-2a.html
 *      TEKS A.5C  → /free-worksheets/algebra-1/teks-a-5c.html
 *      TEKS 8.10B → /free-worksheets/grade-8/teks-8-10b.html
 *
 * Re-run after curriculum or teks-math.json updates:
 *   node scripts/build-teks-pages.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const OUT_DIR = path.join(REPO_ROOT, 'free-worksheets');
const TEKS_PACK = path.join(REPO_ROOT, 'state-packs/texas/standards/teks-math.json');
const SITE_ORIGIN = 'https://gradeearn.com';
const STATE_SLUG = 'texas';

// Source toggle: --source=lake reads questions from DynamoDB staar-content-pool
// (the §31/§35/§37 pack-wired sweep content — Texas-flavored, TEKS-tagged).
// Default (--source=curriculum) reads the static /data/grade-*-curriculum.json
// files (offline-safe, no AWS deps). Lake source yields ~190 TEKS pages vs
// curriculum's 103 because the lake covers more standards.
const SOURCE = (() => {
  const arg = process.argv.find((a) => a.startsWith('--source='));
  return arg ? arg.split('=')[1] : 'curriculum';
})();

const GRADES = [
  { gradeKey: 'grade_3',   slug: 'grade-3',   label: 'Grade 3',     urlSlug: 'grade-3',   file: 'grade-3-curriculum.json'   },
  { gradeKey: 'grade_4',   slug: 'grade-4',   label: 'Grade 4',     urlSlug: 'grade-4',   file: 'grade-4-curriculum.json'   },
  { gradeKey: 'grade_5',   slug: 'grade-5',   label: 'Grade 5',     urlSlug: 'grade-5',   file: 'grade-5-curriculum.json'   },
  { gradeKey: 'grade_6',   slug: 'grade-6',   label: 'Grade 6',     urlSlug: 'grade-6',   file: 'grade-6-curriculum.json'   },
  { gradeKey: 'grade_7',   slug: 'grade-7',   label: 'Grade 7',     urlSlug: 'grade-7',   file: 'grade-7-curriculum.json'   },
  { gradeKey: 'grade_8',   slug: 'grade-8',   label: 'Grade 8',     urlSlug: 'grade-8',   file: 'grade-8-curriculum.json'   },
  { gradeKey: 'algebra_1', slug: 'algebra-1', label: 'Algebra I',   urlSlug: 'algebra-1', file: 'algebra-1-curriculum.json' },
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// TEKS 3.2A → "3-2a", TEKS A.5C → "a-5c", TEKS 8.10B → "8-10b"
function teksSlug(id) {
  return String(id).toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]/g, '');
}

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// Bucket all questions in a curriculum file by TEKS id.
// Question TEKS resolution: q.teks > lesson.teks > unit.teks (last wins).
function bucketByTeks(curr) {
  const buckets = {};
  (curr.units || []).forEach((u) => {
    (u.lessons || []).forEach((l) => {
      (l.questions || []).forEach((q) => {
        const tid = q.teks || l.teks || u.teks;
        if (!tid) return;
        if (!q.prompt || !Array.isArray(q.choices)) return;
        if (!buckets[tid]) buckets[tid] = [];
        buckets[tid].push(q);
      });
    });
  });
  return buckets;
}

// Hand-rolled DynamoDB AttributeValue → plain JS (no SDK dep at repo root).
// Only covers the types this script consumes: S, N, L, BOOL, NULL.
function unmarshall(av) {
  if (av == null) return null;
  if ('S' in av) return av.S;
  if ('N' in av) return Number(av.N);
  if ('BOOL' in av) return !!av.BOOL;
  if ('NULL' in av) return null;
  if ('L' in av) return av.L.map(unmarshall);
  if ('M' in av) {
    const o = {};
    for (const k of Object.keys(av.M)) o[k] = unmarshall(av.M[k]);
    return o;
  }
  return null;
}

// Load Texas-math rows from staar-content-pool via the aws CLI.
// Auto-pagination: aws CLI follows NextToken by default and returns one
// merged Items array. Filter expression keeps the wire payload small
// (~14MB for ~14k rows).
function loadLakeBuckets() {
  console.log('[lake] scanning staar-content-pool (state=texas, subject=math, status=active)...');
  const args = [
    'dynamodb', 'scan',
    '--table-name', 'staar-content-pool',
    '--filter-expression', '#st = :s AND #sub = :sub AND #status = :a',
    '--expression-attribute-names', '{"#st":"state","#sub":"subject","#status":"status"}',
    '--expression-attribute-values', '{":s":{"S":"texas"},":sub":{"S":"math"},":a":{"S":"active"}}',
    '--projection-expression', '#g, teks, question, choices, correctIndex, explanation',
    '--expression-attribute-names', '{"#st":"state","#sub":"subject","#status":"status","#g":"grade"}',
    '--output', 'json',
    '--no-cli-pager'
  ];
  // Note: --expression-attribute-names appears twice above; aws CLI merges them.
  // Actually CLI rejects duplicate args — switch to a single combined map.
  const argsFinal = [
    'dynamodb', 'scan',
    '--table-name', 'staar-content-pool',
    '--filter-expression', '#st = :s AND #sub = :sub AND #status = :a',
    '--expression-attribute-names', JSON.stringify({
      '#st': 'state', '#sub': 'subject', '#status': 'status', '#g': 'grade'
    }),
    '--expression-attribute-values', JSON.stringify({
      ':s': { S: 'texas' }, ':sub': { S: 'math' }, ':a': { S: 'active' }
    }),
    '--projection-expression', '#g, teks, question, choices, correctIndex, explanation',
    '--output', 'json',
    '--no-cli-pager'
  ];
  const t0 = Date.now();
  const out = cp.execFileSync('aws', argsFinal, {
    maxBuffer: 200 * 1024 * 1024,
    encoding: 'utf8'
  });
  const data = JSON.parse(out);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[lake] scan done in ${elapsed}s — ${(data.Items || []).length} rows returned`);

  // Bucket by gradeKey (grade-3 → grade_3) → teks → [{prompt, choices, ...}]
  const buckets = {};
  let dropped = 0;
  for (const av of (data.Items || [])) {
    const row = unmarshall({ M: av });
    if (!row.teks || !row.grade || !row.question || !Array.isArray(row.choices)) {
      dropped++;
      continue;
    }
    const gradeKey = row.grade.replace('-', '_'); // grade-3 → grade_3, algebra-1 → algebra_1
    if (!buckets[gradeKey]) buckets[gradeKey] = {};
    if (!buckets[gradeKey][row.teks]) buckets[gradeKey][row.teks] = [];
    buckets[gradeKey][row.teks].push({
      prompt: row.question,
      choices: row.choices,
      correctIndex: row.correctIndex,
      explanation: row.explanation || ''
    });
  }
  if (dropped > 0) console.log(`[lake] dropped ${dropped} rows missing required fields`);
  return buckets;
}

// Take an evenly-spaced sample of N questions — deterministic so Googlebot
// sees stable content on re-crawl, varied so the page isn't just q[0..7].
function sampleN(arr, n) {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= n) return arr.slice();
  const step = Math.floor(arr.length / n);
  return Array.from({ length: n }, (_, i) => arr[i * step]).filter(Boolean);
}

function renderQuestion(q, qIndex) {
  const choices = (q.choices || []).map((c, i) => {
    const isCorrect = i === q.correctIndex;
    const cls = isCorrect ? 'fw-choice fw-choice--correct' : 'fw-choice';
    const marker = isCorrect ? ' <span class="fw-choice-tick" aria-label="Correct">✓</span>' : '';
    return `<li class="${cls}">${esc(c)}${marker}</li>`;
  }).join('\n          ');
  const explanation = q.explanation
    ? `<p class="fw-q-explanation"><strong>Why:</strong> ${esc(q.explanation)}</p>`
    : '';
  return `
      <article class="fw-q">
        <div class="fw-q-num" aria-hidden="true">${qIndex}</div>
        <div class="fw-q-body">
          <p class="fw-q-prompt">${esc(q.prompt)}</p>
          <ol class="fw-q-choices" type="A">
          ${choices}
          </ol>
          ${explanation}
        </div>
      </article>`;
}

function strandTitle(strand) {
  // "Number and operations" → "Number & Operations" (title-cased, "and" → "&")
  return String(strand || '').replace(/\band\b/g, '&').replace(/\w\S*/g, (w) =>
    w.charAt(0).toUpperCase() + w.slice(1)
  );
}

// Make a kid-friendly page title-slug from the TEKS text (first ~7 words,
// truncated at end-of-clause but tolerating commas inside numbers).
function teksTopicHeadline(text) {
  // Break at clause-end punctuation (period, semicolon, colon) ONLY —
  // not commas, since they appear inside numbers like "100,000".
  const cleaned = String(text || '').replace(/[.;:].*$/, '').trim();
  const words = cleaned.split(/\s+/).slice(0, 7).join(' ');
  // Trim trailing comma if a phrase ended just before one.
  return words.replace(/,$/, '') || 'Practice';
}

// Map a TEKS id → other grades' TEKS in the same numeric position
// (vertical-curriculum linking). E.g. 3.2A → 4.2A, 5.2A, etc.
// Approximation: match by the trailing letter-suffix and the second
// numeric segment after the dot. Skip if no match.
function findVerticalLinks(teks, allTeksByGrade) {
  const m = /^([A-Za-z0-9]+)\.([0-9]+)([A-Z]?)$/.exec(teks.id);
  if (!m) return [];
  const sub = m[2] + m[3];
  const out = [];
  GRADES.forEach((g) => {
    const arr = allTeksByGrade[g.gradeKey] || [];
    const match = arr.find((t) => {
      if (t.id === teks.id) return false;
      const m2 = /^([A-Za-z0-9]+)\.([0-9]+)([A-Z]?)$/.exec(t.id);
      return m2 && (m2[2] + m2[3]) === sub;
    });
    if (match) out.push({ grade: g, teks: match });
  });
  return out;
}

function renderTeksPage(teks, grade, allTeksInGrade, allTeksByGrade, samples, totalCount) {
  const slug = teksSlug(teks.id);
  const canonicalUrl = `${SITE_ORIGIN}/free-worksheets/${grade.urlSlug}/teks-${slug}.html`;
  const parentUrl = `${SITE_ORIGIN}/free-worksheets/${grade.urlSlug}-math.html`;
  const headline = teksTopicHeadline(teks.text);

  const pageTitle = `TEKS ${teks.id} Worksheets — ${grade.label} ${headline} (Free STAAR Practice)`;
  const pageDesc = `Free printable TEKS ${teks.id} worksheets for ${grade.label}. ${totalCount.toLocaleString()}+ practice questions on ${esc(teks.text).slice(0, 120)}. Aligned to Texas STAAR. No sign-up.`;

  let dateModifiedIso = '2026-05-12';
  try { dateModifiedIso = fs.statSync(path.join(DATA_DIR, grade.file)).mtime.toISOString().slice(0, 10); } catch (_) {}

  const qHtml = samples.map((q, i) => renderQuestion(q, i + 1)).join('\n');

  // Sibling TEKS in same grade (in-grade nav)
  const siblings = allTeksInGrade.filter((t) => t.id !== teks.id);
  const siblingsHtml = siblings.slice(0, 30).map((t) =>
    `<a class="fw-related-pill" href="/free-worksheets/${grade.urlSlug}/teks-${teksSlug(t.id)}.html">TEKS ${esc(t.id)}</a>`
  ).join('\n        ');

  // Vertical-curriculum links (same TEKS suffix in other grades)
  const verticalLinks = findVerticalLinks(teks, allTeksByGrade);
  const verticalHtml = verticalLinks.map((v) =>
    `<a class="fw-related-pill" href="/free-worksheets/${v.grade.urlSlug}/teks-${teksSlug(v.teks.id)}.html">${esc(v.grade.label)} TEKS ${esc(v.teks.id)}</a>`
  ).join('\n        ');

  // Print + practice URLs — pre-filter by TEKS so /practice.html knows
  // to draw from this standard specifically.
  const printUrl  = `/practice.html?print=1&s=${STATE_SLUG}&g=${grade.slug}&subj=math&teks=${encodeURIComponent(teks.id)}&n=20`;
  const onlineUrl = `/practice.html?s=${STATE_SLUG}&g=${grade.slug}&subj=math&teks=${encodeURIComponent(teks.id)}`;

  // JSON-LD: LearningResource
  const learningResourceLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: `Free TEKS ${teks.id} Worksheets — ${grade.label} STAAR Math`,
    description: pageDesc,
    url: canonicalUrl,
    educationalLevel: grade.label,
    learningResourceType: 'Worksheet',
    teaches: teks.text,
    audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
    isAccessibleForFree: true,
    inLanguage: 'en-US',
    datePublished: '2026-05-12',
    dateModified: dateModifiedIso,
    author: { '@type': 'Person', name: 'Hamid Ali', url: 'https://gradeearn.com' },
    publisher: {
      '@type': 'Organization',
      name: 'GradeEarn',
      url: 'https://gradeearn.com',
      logo: { '@type': 'ImageObject', url: 'https://gradeearn.com/og-image.png', width: 1200, height: 630 },
    },
    educationalAlignment: {
      '@type': 'AlignmentObject',
      alignmentType: 'teaches',
      educationalFramework: 'Texas Essential Knowledge and Skills (TEKS)',
      targetName: `TEKS ${teks.id}`,
      targetDescription: teks.text,
    },
  }, null, 2);

  // JSON-LD: BreadcrumbList
  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Free worksheets', item: `${SITE_ORIGIN}/free-worksheets/` },
      { '@type': 'ListItem', position: 3, name: `${grade.label} math`, item: parentUrl },
      { '@type': 'ListItem', position: 4, name: `TEKS ${teks.id}` },
    ],
  }, null, 2);

  // JSON-LD: FAQPage (focused on this standard)
  const faqLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `What is TEKS ${teks.id}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `TEKS ${teks.id} is a ${grade.label} ${strandTitle(teks.strand)} standard from the Texas Essential Knowledge and Skills. The standard says: ${teks.text}`
        },
      },
      {
        '@type': 'Question',
        name: `How many TEKS ${teks.id} practice questions are available?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `${totalCount.toLocaleString()} practice questions tagged to TEKS ${teks.id}. All free to print or practice online.`
        },
      },
      {
        '@type': 'Question',
        name: `Are these questions aligned to the STAAR test?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes. Every question is tagged to TEKS ${teks.id} and modeled on STAAR item shapes (multi-choice and grid-in). Each question goes through an AI quality gate before publishing — gpt-4o for content review and Claude Sonnet 4.5 for independent math verification.`
        },
      },
    ],
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://4wvuw21yjl.execute-api.us-east-1.amazonaws.com https://api.gradeearn.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#060d1f">
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">

  <title>${esc(pageTitle)} — GradeEarn</title>
  <meta name="description" content="${esc(pageDesc)}">
  <meta name="keywords" content="TEKS ${esc(teks.id)} worksheets, TEKS ${esc(teks.id)} practice, ${esc(grade.label.toLowerCase())} STAAR ${esc(teks.id)}, ${esc(strandTitle(teks.strand).toLowerCase())} worksheets ${esc(grade.label.toLowerCase())}, free Texas math worksheets, printable STAAR practice">
  <meta name="author" content="Hamid Ali, GradeEarn">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
  <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">

  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" hreflang="en-US" href="${canonicalUrl}" />
  <link rel="alternate" hreflang="x-default" href="${canonicalUrl}" />
  <link rel="up" href="${parentUrl}" />

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="GradeEarn">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="${esc(pageDesc)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="article:author" content="Hamid Ali">
  <meta property="article:section" content="Education">
  <meta property="article:published_time" content="2026-05-12">
  <meta property="article:modified_time" content="${dateModifiedIso}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@gradeearn">

  <script type="application/ld+json">
${learningResourceLd}
  </script>

  <script type="application/ld+json">
${breadcrumbLd}
  </script>

  <script type="application/ld+json">
${faqLd}
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=20260512n">
</head>
<body class="fw-page">

<header class="site-header">
  <div class="container">
    <a class="brand" href="/index.html" aria-label="GradeEarn home">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#fbbf24" aria-hidden="true">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
      </svg>
      <span class="brand-text">Grade<span class="brand-text-accent">Earn</span></span>
    </a>
    <nav class="nav" aria-label="Primary">
      <a href="/index.html">Home</a>
      <a href="/free-worksheets/index.html">Free worksheets</a>
      <a href="/marketplace.html">Toys</a>
    </nav>
    <div id="user-slot" class="user-slot"></div>
  </div>
</header>

<main class="fw-main">
  <nav class="breadcrumb-nav breadcrumb-nav--minimal" aria-label="Breadcrumb">
    <ol class="breadcrumb breadcrumb--mid-dot">
      <li class="breadcrumb-item"><a href="/index.html">Home</a></li>
      <li class="breadcrumb-item"><a href="/free-worksheets/index.html">Free worksheets</a></li>
      <li class="breadcrumb-item"><a href="${esc(parentUrl)}">${esc(grade.label)} math</a></li>
      <li class="breadcrumb-item breadcrumb-item--current">TEKS ${esc(teks.id)}</li>
    </ol>
  </nav>

  <article class="fw-article">

    <header class="fw-hero">
      <p class="fw-eyebrow">Free · Printable · TEKS ${esc(teks.id)} · ${esc(strandTitle(teks.strand))}</p>
      <h1 class="fw-h1">TEKS ${esc(teks.id)} Worksheets — ${esc(grade.label)} ${esc(headline)}</h1>
      <p class="fw-lead">${totalCount.toLocaleString()}+ Texas-aligned practice questions on this exact ${esc(grade.label)} standard. Print at home or practice online with a built-in AI tutor. No sign-up, no paywall.</p>
      <p class="fw-byline">
        By <a class="fw-byline-author" href="/about.html" rel="author">Hamid Ali</a>
        <span class="fw-byline-sep" aria-hidden="true">·</span>
        Updated <time datetime="${dateModifiedIso}">${new Date(dateModifiedIso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
      </p>

      <div class="fw-hero-cta">
        <a class="fw-btn fw-btn--primary" href="${esc(printUrl)}">Print 20-question worksheet</a>
        <a class="fw-btn fw-btn--ghost" href="${esc(onlineUrl)}">Practice online with AI tutor</a>
      </div>
    </header>

    <section class="fw-intro">
      <p><strong>What TEKS ${esc(teks.id)} says:</strong> ${esc(teks.text)}</p>
      <p>This page has ${totalCount.toLocaleString()}+ practice questions tagged specifically to TEKS ${esc(teks.id)}. Below: a sample of ${samples.length} with answers and explanations so you can preview the worksheet before printing. Every question goes through an AI quality gate (gpt-4o for content review, Claude Sonnet 4.5 for math verification) before publishing.</p>
      ${teks.cognitive_demand ? `<p><strong>Cognitive demand:</strong> ${esc(teks.cognitive_demand)}. ${teks.typical_question_shape ? `<strong>Typical question shape:</strong> ${esc(teks.typical_question_shape)}.` : ''}</p>` : ''}
    </section>

    <section class="fw-questions" style="margin-bottom:32px;">
${qHtml}
    </section>

    <div class="fw-unit-cta">
      <a class="fw-btn fw-btn--primary" href="${esc(printUrl)}">Print 20-question TEKS ${esc(teks.id)} worksheet</a>
      <a class="fw-btn fw-btn--ghost" href="/practice.html?print=1&amp;s=${STATE_SLUG}&amp;g=${grade.slug}&amp;subj=math&amp;teks=${encodeURIComponent(teks.id)}&amp;n=10">Print 10-question quick set</a>
      <a class="fw-btn fw-btn--ghost" href="${esc(onlineUrl)}">Practice online with AI tutor</a>
    </div>

    <section class="fw-faq" aria-label="Frequently asked questions">
      <h2 class="fw-faq-title">Common questions about TEKS ${esc(teks.id)}</h2>

      <div class="fw-faq-q">
        <h3>What is TEKS ${esc(teks.id)}?</h3>
        <p>TEKS ${esc(teks.id)} is a ${esc(grade.label)} ${esc(strandTitle(teks.strand))} standard from the Texas Essential Knowledge and Skills. The standard says: ${esc(teks.text)}</p>
      </div>

      <div class="fw-faq-q">
        <h3>How many TEKS ${esc(teks.id)} practice questions are available?</h3>
        <p>${totalCount.toLocaleString()}+ practice questions tagged to TEKS ${esc(teks.id)}. All free to print or practice online. We pull a fresh set each time you print a worksheet so your kid doesn't see the same questions twice.</p>
      </div>

      <div class="fw-faq-q">
        <h3>What kind of questions test TEKS ${esc(teks.id)} on the STAAR?</h3>
        <p>${teks.typical_question_shape ? esc(teks.typical_question_shape) + '.' : 'Multi-choice and grid-in formats are most common on the STAAR for ' + esc(grade.label) + ' math.'} ${teks.cognitive_demand === 'high' ? 'TEKS ' + esc(teks.id) + ' is a high-cognitive-demand standard — multi-step reasoning is expected.' : teks.cognitive_demand === 'medium' ? 'TEKS ' + esc(teks.id) + ' is a medium-cognitive-demand standard — 1-2 step questions are typical.' : teks.cognitive_demand === 'low' ? 'TEKS ' + esc(teks.id) + ' is a low-cognitive-demand standard — single-step identify/recall is typical.' : ''}</p>
      </div>

      <div class="fw-faq-q">
        <h3>Where do these questions come from?</h3>
        <p>Generated by our AI pipeline, then independently quality-gated by two cross-vendor models (gpt-4o for content review, Claude Sonnet 4.5 for math verification) before publishing. Every question is tagged to TEKS ${esc(teks.id)} and modeled on real STAAR item shapes. No typos, no wrong answer keys, no broken explanations.</p>
      </div>
    </section>

    ${verticalLinks.length > 0 ? `
    <section class="fw-related">
      <h2 class="fw-related-title">TEKS ${esc(teks.id)} in other grades</h2>
      <p class="fw-related-sub">The same numbering across the Texas vertical curriculum.</p>
      <div class="fw-related-pills">
        ${verticalHtml}
      </div>
    </section>
    ` : ''}

    <section class="fw-related">
      <h2 class="fw-related-title">More ${esc(grade.label)} TEKS</h2>
      <div class="fw-related-pills">
        <a class="fw-related-pill" href="${esc(parentUrl)}">← All ${esc(grade.label)} math</a>
        ${siblingsHtml}
      </div>
    </section>

  </article>
</main>

<footer class="site-footer">
  <div class="container">
    <p class="footer-copyright">&copy; 2026 GradeEarn. All rights reserved.</p>
    <nav class="footer-mobile-links">
      <a href="/about.html">How it works</a>
      <a href="/free-worksheets/index.html">Free worksheets</a>
      <a href="/articles/">Articles</a>
    </nav>
  </div>
</footer>

<script src="/js/auth.js?v=20260511c"></script>
</body>
</html>
`;
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const teksPack = loadJson(TEKS_PACK);
  const allTeksByGrade = {};
  GRADES.forEach((g) => { allTeksByGrade[g.gradeKey] = (teksPack[g.gradeKey] && teksPack[g.gradeKey].standards) || []; });

  // Pre-bucket questions by TEKS per grade. Source defaults to curriculum
  // JSON; --source=lake reads from staar-content-pool (Texas-flavored,
  // pack-wired content — yields ~190 TEKS pages vs curriculum's 103).
  let teksBuckets = {};
  if (SOURCE === 'lake') {
    console.log('[source] lake (DynamoDB staar-content-pool)');
    const lakeBuckets = loadLakeBuckets();
    GRADES.forEach((g) => { teksBuckets[g.gradeKey] = lakeBuckets[g.gradeKey] || {}; });
  } else {
    console.log('[source] curriculum (/data/grade-*-curriculum.json)');
    GRADES.forEach((g) => {
      try {
        teksBuckets[g.gradeKey] = bucketByTeks(loadJson(path.join(DATA_DIR, g.file)));
      } catch (err) {
        console.error(`✗ ${g.urlSlug} curriculum load failed: ${err.message}`);
        teksBuckets[g.gradeKey] = {};
      }
    });
  }

  let pagesWritten = 0;
  let pagesSkipped = 0;
  let totalBytes = 0;
  const sitemapUrls = [];

  GRADES.forEach((g) => {
    const teksList = allTeksByGrade[g.gradeKey] || [];
    const gradeDir = path.join(OUT_DIR, g.urlSlug);
    if (!fs.existsSync(gradeDir)) fs.mkdirSync(gradeDir, { recursive: true });

    teksList.forEach((t) => {
      const allQs = (teksBuckets[g.gradeKey] && teksBuckets[g.gradeKey][t.id]) || [];
      if (allQs.length === 0) {
        pagesSkipped++;
        return;
      }
      const samples = sampleN(allQs, 8);
      try {
        const html = renderTeksPage(t, g, teksList, allTeksByGrade, samples, allQs.length);
        const slug = teksSlug(t.id);
        const outPath = path.join(gradeDir, `teks-${slug}.html`);
        fs.writeFileSync(outPath, html);
        totalBytes += html.length;
        pagesWritten++;
        sitemapUrls.push(`${SITE_ORIGIN}/free-worksheets/${g.urlSlug}/teks-${slug}.html`);
      } catch (err) {
        console.error(`✗ ${g.urlSlug}/teks-${teksSlug(t.id)}.html — ${err.message}`);
        process.exitCode = 1;
      }
    });

    const inGrade = (teksBuckets[g.gradeKey] && Object.keys(teksBuckets[g.gradeKey]).length) || 0;
    console.log(`  ${g.urlSlug}: ${teksList.length} TEKS in pack, ${inGrade} with curriculum questions, pages emitted: ${teksList.filter(t => ((teksBuckets[g.gradeKey] && teksBuckets[g.gradeKey][t.id]) || []).length > 0).length}`);
  });

  // Sitemap fragment for sitemap.xml
  const fragmentPath = path.join(OUT_DIR, '.sitemap-teks-urls.txt');
  fs.writeFileSync(fragmentPath, sitemapUrls.join('\n') + '\n');

  console.log(`\n✓ ${pagesWritten} per-TEKS pages written, ${(totalBytes / 1024).toFixed(1)} KB total`);
  console.log(`  Skipped (no questions in curriculum): ${pagesSkipped}`);
  console.log(`  Sitemap URLs: ${path.relative(REPO_ROOT, fragmentPath)}`);
}

if (require.main === module) main();
module.exports = { GRADES, renderTeksPage };
