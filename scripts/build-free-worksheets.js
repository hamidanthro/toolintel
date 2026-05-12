#!/usr/bin/env node
/**
 * Free-worksheets static-page generator.
 *
 * Why: SEO. Reads each /data/grade-*-curriculum.json file, emits a
 * keyword-rich, content-rich static HTML page per grade at
 *   /free-worksheets/<grade-slug>-math.html
 * plus a hub page at /free-worksheets/index.html.
 *
 * Each page contains: H1, intro paragraphs, per-topic sections with
 * 5 sample questions (prompt + 4 choices + correct answer + short
 * explanation), download CTAs that link to the existing print system,
 * JSON-LD schema, and internal links to the other grade pages + the
 * main practice flow.
 *
 * Re-run after curriculum updates: `node scripts/build-free-worksheets.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const OUT_DIR = path.join(REPO_ROOT, 'free-worksheets');
const STATE_SLUG = 'texas';
const STATE_NAME = 'Texas';
const TEST_NAME = 'STAAR';

const GRADES = [
  { slug: 'grade-k', label: 'Kindergarten', short: 'K', urlSlug: 'kindergarten', file: 'grade-k-curriculum.json' },
  { slug: 'grade-1', label: 'Grade 1',      short: '1', urlSlug: 'grade-1',      file: 'grade-1-curriculum.json' },
  { slug: 'grade-2', label: 'Grade 2',      short: '2', urlSlug: 'grade-2',      file: 'grade-2-curriculum.json' },
  { slug: 'grade-3', label: 'Grade 3',      short: '3', urlSlug: 'grade-3',      file: 'grade-3-curriculum.json' },
  { slug: 'grade-4', label: 'Grade 4',      short: '4', urlSlug: 'grade-4',      file: 'grade-4-curriculum.json' },
  { slug: 'grade-5', label: 'Grade 5',      short: '5', urlSlug: 'grade-5',      file: 'grade-5-curriculum.json' },
  { slug: 'grade-6', label: 'Grade 6',      short: '6', urlSlug: 'grade-6',      file: 'grade-6-curriculum.json' },
  { slug: 'grade-7', label: 'Grade 7',      short: '7', urlSlug: 'grade-7',      file: 'grade-7-curriculum.json' },
  { slug: 'grade-8', label: 'Grade 8',      short: '8', urlSlug: 'grade-8',      file: 'grade-8-curriculum.json' },
  { slug: 'algebra-1', label: 'Algebra I',  short: 'A1', urlSlug: 'algebra-1',   file: 'algebra-1-curriculum.json' },
];

const SITE_ORIGIN = 'https://gradeearn.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Slugify a unit title for URL use.
//   "Place Value to 1,000,000,000" → "place-value-to-1-000-000-000"
//   "Decimals to Hundredths"       → "decimals-to-hundredths"
//   "Operations with Fractions"    → "operations-with-fractions"
// Stable + reversible enough that a re-slug after a curriculum update
// produces near-identical URLs (good for Google's crawl cache).
function slugify(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[+]/g, ' plus ')
    .replace(/['"`’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadCurriculum(file) {
  const p = path.join(DATA_DIR, file);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function countQuestions(curr) {
  let n = 0;
  (curr.units || []).forEach((u) => (u.lessons || []).forEach((l) => { n += (l.questions || []).length; }));
  return n;
}

// Pull a stable, deterministic sample from a unit. Always picks from
// the first lesson's questions so the static page never drifts when
// the JSON is re-sorted, and so Googlebot sees the same content on
// re-crawl (good for cache + rankings).
function sampleQuestionsFromUnit(unit, n) {
  const allQs = [];
  (unit.lessons || []).forEach((l) => {
    (l.questions || []).forEach((q) => { if (q && q.prompt && Array.isArray(q.choices)) allQs.push(q); });
  });
  // Take evenly-spaced indexes so we get question variety, not just q[0..4]
  if (allQs.length === 0) return [];
  if (allQs.length <= n) return allQs;
  const step = Math.floor(allQs.length / n);
  return Array.from({ length: n }, (_, i) => allQs[i * step]).filter(Boolean);
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

function renderUnitSection(unit, grade) {
  const samples = sampleQuestionsFromUnit(unit, 5);
  if (samples.length === 0) return '';
  const qHtml = samples.map((q, i) => renderQuestion(q, i + 1)).join('\n');

  const teks = unit.teks
    ? `<span class="fw-teks">TEKS ${esc(unit.teks)}</span>`
    : '';
  const summary = unit.summary
    ? `<p class="fw-unit-summary">${esc(unit.summary)}</p>`
    : '';

  const printUrl = `/practice.html?print=1&s=${STATE_SLUG}&g=${grade.slug}&subj=math&u=${encodeURIComponent(unit.id)}&n=20`;
  const onlineUrl = `/practice.html?s=${STATE_SLUG}&g=${grade.slug}&subj=math&u=${encodeURIComponent(unit.id)}`;

  return `
  <section class="fw-unit" id="${esc(unit.id)}">
    <header class="fw-unit-head">
      <h2 class="fw-unit-title">${esc(unit.title)}</h2>
      ${teks}
    </header>
    ${summary}
    <div class="fw-questions">
${qHtml}
    </div>
    <div class="fw-unit-cta">
      <a class="fw-btn fw-btn--primary" href="${esc(printUrl)}">Print 20-question worksheet</a>
      <a class="fw-btn fw-btn--ghost" href="${esc(onlineUrl)}">Practice online with AI tutor</a>
    </div>
  </section>`;
}

function renderJsonLd(grade, qCount, unitCount, dateModifiedIso) {
  // LearningResource + Article hybrid — gives Google rich-result context
  // for both the educational angle and the article-freshness angle.
  // datePublished is fixed (first crawl signal); dateModified pulls from
  // the file's mtime so re-runs of the generator update the freshness.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: `Free ${grade.label} STAAR Math Worksheets`,
    description: `Free printable ${grade.label} STAAR math worksheets with ${qCount.toLocaleString()}+ practice questions across ${unitCount} TEKS-aligned topics. Aligned to the Texas STAAR test.`,
    url: `${SITE_ORIGIN}/free-worksheets/${grade.urlSlug}-math.html`,
    educationalLevel: grade.label,
    learningResourceType: 'Worksheet',
    teaches: 'Mathematics',
    audience: { '@type': 'EducationalAudience', educationalRole: 'student' },
    isAccessibleForFree: true,
    inLanguage: 'en-US',
    datePublished: '2026-05-12',
    dateModified: dateModifiedIso,
    author: {
      '@type': 'Person',
      name: 'Hamid Ali',
      url: 'https://gradeearn.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'GradeEarn',
      url: 'https://gradeearn.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://gradeearn.com/og-image.png',
        width: 1200,
        height: 630,
      },
    },
    educationalAlignment: {
      '@type': 'AlignmentObject',
      alignmentType: 'teaches',
      educationalFramework: 'Texas Essential Knowledge and Skills (TEKS)',
      targetName: `${grade.label} Mathematics`,
    },
  };
  return `<script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n  </script>`;
}

function renderBreadcrumbLd(grade) {
  // BreadcrumbList — Google shows the breadcrumb trail in SERP results
  // instead of just the URL. Strong CTR signal.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Free worksheets', item: `${SITE_ORIGIN}/free-worksheets/` },
      { '@type': 'ListItem', position: 3, name: `${grade.label} math` },
    ],
  };
  return `<script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n  </script>`;
}

function renderFaqLd(grade, qCount) {
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Are these ${grade.label} STAAR math worksheets really free?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes. Every worksheet on this page is free to print or practice online. We don't ask for an email or a credit card. The worksheets pull from a library of more than ${qCount.toLocaleString()} ${grade.label} TEKS-aligned questions.`,
        },
      },
      {
        '@type': 'Question',
        name: `Are the questions aligned to the Texas STAAR test?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes. Every question is tagged to Texas Essential Knowledge and Skills (TEKS) for ${grade.label} mathematics and modeled after STAAR question shapes (multi-choice, multi-select, and grid-in).`,
        },
      },
      {
        '@type': 'Question',
        name: `How do I print the worksheets?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Click any "Print 20-question worksheet" button. A clean, printer-friendly page opens. Use your browser's Print menu (Cmd+P on Mac, Ctrl+P on Windows) and the worksheet renders as a tidy PDF or paper handout, with an answer key on the last page.`,
        },
      },
      {
        '@type': 'Question',
        name: `Can my kid practice online instead of printing?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes. Every topic has a "Practice online with AI tutor" link. The kid gets the same TEKS-aligned questions, and when they miss one, a built-in AI tutor walks them through it step by step.`,
        },
      },
    ],
  };
  return `<script type="application/ld+json">\n${JSON.stringify(faq, null, 2)}\n  </script>`;
}

function renderGradePage(grade) {
  const curr = loadCurriculum(grade.file);
  const units = curr.units || [];
  const qCount = countQuestions(curr);
  const unitsHtml = units.map((u) => renderUnitSection(u, grade)).join('\n');

  // SEO meta
  const pageTitle = `Free ${grade.label} STAAR Math Worksheets — ${qCount.toLocaleString()}+ TEKS Practice Questions`;
  const pageDesc = `Free printable ${grade.label} STAAR math worksheets for Texas families. ${qCount.toLocaleString()}+ TEKS-aligned questions across ${units.length} topics. Print, practice online, or use the built-in AI tutor — all free.`;
  const canonicalUrl = `${SITE_ORIGIN}/free-worksheets/${grade.urlSlug}-math.html`;

  // §17 SEO: rel="prev"/rel="next" between sequential grades.
  // Google uses this to understand the page sequence; helps with
  // pagination/sequence rich results.
  const gradeIdx = GRADES.findIndex((g) => g.slug === grade.slug);
  const prevGrade = gradeIdx > 0 ? GRADES[gradeIdx - 1] : null;
  const nextGrade = gradeIdx < GRADES.length - 1 ? GRADES[gradeIdx + 1] : null;
  const relPrev = prevGrade ? `\n  <link rel="prev" href="${SITE_ORIGIN}/free-worksheets/${prevGrade.urlSlug}-math.html" />` : '';
  const relNext = nextGrade ? `\n  <link rel="next" href="${SITE_ORIGIN}/free-worksheets/${nextGrade.urlSlug}-math.html" />` : '';

  // §17 SEO: dateModified pulled from curriculum-file mtime so
  // re-running the generator after a curriculum update refreshes the
  // freshness signal Google sees.
  let dateModifiedIso = new Date().toISOString().slice(0, 10);
  try {
    const stat = fs.statSync(path.join(DATA_DIR, grade.file));
    dateModifiedIso = stat.mtime.toISOString().slice(0, 10);
  } catch (_) {}

  // Related-grade nav
  const relatedNav = GRADES.filter((g) => g.slug !== grade.slug).map((g) => {
    return `<a class="fw-related-pill" href="/free-worksheets/${g.urlSlug}-math.html">${esc(g.label)} math</a>`;
  }).join('\n        ');

  // TOC
  const tocHtml = units.map((u) => `<li><a href="#${esc(u.id)}">${esc(u.title)}</a></li>`).join('\n        ');

  // Intro keyword-rich paragraphs
  const introP1 = `Looking for <strong>free ${grade.label} STAAR math worksheets</strong>? You're in the right place. This page has <strong>${qCount.toLocaleString()}+ TEKS-aligned practice questions</strong> for ${grade.label} mathematics — every one of them free to print or practice online, no sign-up required. Built for Texas families preparing for the STAAR test.`;
  const introP2 = `Every question is tagged to a specific TEKS standard, modeled on real ${TEST_NAME} item formats, and reviewed by an AI quality gate that catches ambiguity and bad arithmetic before it reaches your kid. The full library covers <strong>${units.length} ${grade.label} math topics</strong>: ${units.slice(0, 4).map((u) => esc(u.title)).join(', ')}${units.length > 4 ? ', and more' : ''}.`;
  const introP3 = `Scroll down for a sample of questions in each topic. Click <em>Print 20-question worksheet</em> on any topic to get a clean, printer-friendly PDF (with an answer key). Click <em>Practice online with AI tutor</em> to work through questions in the browser — wrong answers get a friendly walk-through from our built-in tutor.`;

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
  <meta name="keywords" content="free ${grade.label} math worksheets, ${grade.label} STAAR practice, TEKS math, Texas ${grade.label} math, printable math worksheets, ${grade.label} math test prep, free STAAR worksheets">
  <meta name="author" content="Hamid Ali, GradeEarn">

  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
  <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">

  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" hreflang="en-US" href="${canonicalUrl}" />
  <link rel="alternate" hreflang="x-default" href="${canonicalUrl}" />${relPrev}${relNext}

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="GradeEarn">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="${esc(pageTitle)} — GradeEarn">
  <meta property="og:description" content="${esc(pageDesc)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:secure_url" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Free ${esc(grade.label)} STAAR math worksheets from GradeEarn — TEKS-aligned, no sign-up required.">
  <meta property="article:author" content="Hamid Ali">
  <meta property="article:section" content="Education">
  <meta property="article:published_time" content="2026-05-12">
  <meta property="article:modified_time" content="${dateModifiedIso}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@gradeearn">
  <meta name="twitter:creator" content="@gradeearn">
  <meta name="twitter:title" content="${esc(pageTitle)}">
  <meta name="twitter:description" content="${esc(pageDesc)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png">
  <meta name="twitter:image:alt" content="Free ${esc(grade.label)} STAAR math worksheets from GradeEarn.">

  ${renderJsonLd(grade, qCount, units.length, dateModifiedIso)}

  ${renderBreadcrumbLd(grade)}

  ${renderFaqLd(grade, qCount)}

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=20260512b">
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
      <li class="breadcrumb-item breadcrumb-item--current">${esc(grade.label)} math</li>
    </ol>
  </nav>

  <article class="fw-article">

    <header class="fw-hero">
      <p class="fw-eyebrow">Free · Printable · TEKS-aligned</p>
      <h1 class="fw-h1">Free ${esc(grade.label)} STAAR Math Worksheets</h1>
      <p class="fw-lead">${qCount.toLocaleString()}+ Texas TEKS-aligned practice questions across ${units.length} topics. Print at home or practice online with a built-in AI tutor. No sign-up. No email. No paywall.</p>

      <!-- §17 SEO: visible author byline + last-updated date.
           Strong E-E-A-T signal for educational content. Google
           Helpful Content guidelines explicitly reward visible
           authorship on YMYL/education pages. -->
      <p class="fw-byline">
        By <a class="fw-byline-author" href="/about.html" rel="author">Hamid Ali</a>
        <span class="fw-byline-sep" aria-hidden="true">·</span>
        Updated <time datetime="${dateModifiedIso}">${new Date(dateModifiedIso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
      </p>

      <div class="fw-hero-cta">
        <a class="fw-btn fw-btn--primary" href="/practice.html?print=1&amp;s=${STATE_SLUG}&amp;g=${grade.slug}&amp;subj=math&amp;n=20">Print 20-question worksheet (all topics)</a>
        <a class="fw-btn fw-btn--ghost" href="/grade.html?s=${STATE_SLUG}&amp;g=${grade.slug}">Practice online with AI tutor</a>
      </div>
    </header>

    <section class="fw-intro">
      <p>${introP1}</p>
      <p>${introP2}</p>
      <p>${introP3}</p>
    </section>

    <nav class="fw-toc" aria-label="Topics in this worksheet">
      <h2 class="fw-toc-title">Jump to a topic</h2>
      <ol class="fw-toc-list">
        ${tocHtml}
      </ol>
    </nav>

${unitsHtml}

    <section class="fw-faq" aria-label="Frequently asked questions">
      <h2 class="fw-faq-title">Common questions</h2>

      <div class="fw-faq-q">
        <h3>Are these ${esc(grade.label)} STAAR math worksheets really free?</h3>
        <p>Yes. Every worksheet on this page is free to print or practice online. We don't ask for an email or a credit card. The full library has more than ${qCount.toLocaleString()} ${esc(grade.label)} TEKS-aligned questions.</p>
      </div>

      <div class="fw-faq-q">
        <h3>Are the questions aligned to the Texas STAAR test?</h3>
        <p>Yes. Every question is tagged to Texas Essential Knowledge and Skills (TEKS) for ${esc(grade.label)} mathematics and modeled after STAAR question shapes (multi-choice, multi-select, and grid-in answer formats).</p>
      </div>

      <div class="fw-faq-q">
        <h3>How do I print the worksheets?</h3>
        <p>Click any <em>Print 20-question worksheet</em> button. A clean, printer-friendly page opens. Use your browser's Print menu (Cmd+P on Mac, Ctrl+P on Windows) and the worksheet renders as a tidy PDF or paper handout, with an answer key on the last page.</p>
      </div>

      <div class="fw-faq-q">
        <h3>Can my kid practice online instead of printing?</h3>
        <p>Yes. Every topic above has a <em>Practice online with AI tutor</em> link. The kid gets the same TEKS-aligned questions in the browser, and when they miss one, a built-in AI tutor walks them through it step by step. Correct answers earn real cents redeemable for toys.</p>
      </div>

      <div class="fw-faq-q">
        <h3>Who built these worksheets?</h3>
        <p>GradeEarn is a Texas-focused STAAR prep app for K-12 families. Every question goes through an AI quality gate (gpt-4o for content review, Claude Sonnet 4.5 for independent math verification) before it reaches your kid — so you don't run into the typo-riddled "free worksheet PDF" experience that's all over the rest of the internet.</p>
      </div>
    </section>

    <section class="fw-related">
      <h2 class="fw-related-title">Free math worksheets for other grades</h2>
      <div class="fw-related-pills">
        ${relatedNav}
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
      <a href="#">Privacy</a>
    </nav>
  </div>
</footer>

<script src="/js/auth.js?v=20260511c"></script>
</body>
</html>
`;
}

// ============================================================
// Per-unit pages — long-tail SEO at /free-worksheets/<grade>/<unit>.html
// ============================================================
// Each unit on a grade-level page (e.g. "Place Value to 1,000,000,000"
// inside grade-4-math.html) ALSO gets its own dedicated page. Captures
// long-tail search queries like "fractions worksheets grade 5", "place
// value worksheets grade 4" — much higher search volume per page than
// the broad grade-level landing pages, and the per-page conversion
// rate is higher because the kid lands exactly on what they searched.
//
// Each per-unit page:
//   - URL: /free-worksheets/<grade-url-slug>/<unit-slug>.html
//   - Sample questions: 8 (more than the 5 on the grade index — this
//     IS the page the user wanted, give them more)
//   - Internal links: parent grade page, sibling units (within-grade),
//     same-topic in adjacent grades (vertical-curriculum links)
//   - Schema: LearningResource + BreadcrumbList + FAQPage (focused
//     to this unit's TEKS)

function renderUnitPage(unit, grade, allUnits) {
  const slug = slugify(unit.title);
  const samples = sampleQuestionsFromUnit(unit, 8);
  const qHtml = samples.map((q, i) => renderQuestion(q, i + 1)).join('\n');

  // Question count across the entire unit (for keyword-rich copy)
  let qCount = 0;
  (unit.lessons || []).forEach((l) => { qCount += (l.questions || []).length; });

  // Sibling units (within the same grade — for in-grade nav)
  const siblings = allUnits.filter((u) => u.id !== unit.id);

  // Look for the same topic in adjacent grades (vertical-curriculum
  // linking — e.g. grade-3 fractions ↔ grade-4 fractions ↔ grade-5
  // fractions). Matches loosely on the first 2-3 keywords of the
  // title (slugify both, check for prefix overlap).
  const verticalLinks = [];
  const myKey = slug.split('-').slice(0, 3).join('-');
  GRADES.forEach((g) => {
    if (g.slug === grade.slug) return;
    let other;
    try {
      const otherCurr = loadCurriculum(g.file);
      other = (otherCurr.units || []).find((u) => {
        const otherSlug = slugify(u.title);
        const otherKey = otherSlug.split('-').slice(0, 3).join('-');
        return otherKey === myKey
          || (myKey.length > 8 && otherSlug.startsWith(myKey))
          || (otherKey.length > 8 && slug.startsWith(otherKey));
      });
    } catch (_) {}
    if (other) {
      verticalLinks.push({
        grade: g,
        unit: other,
        url: `/free-worksheets/${g.urlSlug}/${slugify(other.title)}.html`,
      });
    }
  });

  const canonicalUrl = `${SITE_ORIGIN}/free-worksheets/${grade.urlSlug}/${slug}.html`;
  const parentUrl = `${SITE_ORIGIN}/free-worksheets/${grade.urlSlug}-math.html`;

  const pageTitle = `Free ${grade.label} ${unit.title} Worksheets — TEKS Practice`;
  const pageDesc = `Free printable ${grade.label} ${unit.title} worksheets aligned to Texas TEKS${unit.teks ? ' ' + unit.teks : ''}. ${qCount}+ practice questions, no sign-up.`;

  // File-mtime for dateModified (freshness signal)
  let dateModifiedIso = '2026-05-12';
  try { dateModifiedIso = fs.statSync(path.join(DATA_DIR, grade.file)).mtime.toISOString().slice(0, 10); } catch (_) {}

  // JSON-LD blocks
  const learningResourceLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: `Free ${grade.label} ${unit.title} Worksheets`,
    description: pageDesc,
    url: canonicalUrl,
    educationalLevel: grade.label,
    learningResourceType: 'Worksheet',
    teaches: unit.title,
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
      targetName: unit.teks ? `TEKS ${unit.teks}` : `${grade.label} Mathematics`,
    },
  }, null, 2);

  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Free worksheets', item: `${SITE_ORIGIN}/free-worksheets/` },
      { '@type': 'ListItem', position: 3, name: `${grade.label} math`, item: parentUrl },
      { '@type': 'ListItem', position: 4, name: unit.title },
    ],
  }, null, 2);

  // Sibling-unit + vertical-curriculum nav HTML
  const siblingsHtml = siblings.map((u) =>
    `<a class="fw-related-pill" href="/free-worksheets/${grade.urlSlug}/${slugify(u.title)}.html">${esc(u.title)}</a>`
  ).join('\n        ');

  const verticalHtml = verticalLinks.map((v) =>
    `<a class="fw-related-pill" href="${esc(v.url)}">${esc(v.grade.label)}: ${esc(v.unit.title)}</a>`
  ).join('\n        ');

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
  <meta name="keywords" content="${esc(unit.title.toLowerCase())} worksheets, ${esc(grade.label.toLowerCase())} ${esc(unit.title.toLowerCase())} practice, free ${esc(grade.label.toLowerCase())} math, TEKS ${esc(unit.teks || '')} practice, printable math worksheets">
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

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=20260512d">
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
      <a href="/articles/">Articles</a>
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
      <li class="breadcrumb-item breadcrumb-item--current">${esc(unit.title)}</li>
    </ol>
  </nav>

  <article class="fw-article">

    <header class="fw-hero">
      <p class="fw-eyebrow">Free · Printable · ${unit.teks ? 'TEKS ' + esc(unit.teks) : 'TEKS-aligned'}</p>
      <h1 class="fw-h1">Free ${esc(grade.label)} ${esc(unit.title)} Worksheets</h1>
      <p class="fw-lead">${qCount.toLocaleString()}+ Texas TEKS-aligned practice questions on ${esc(unit.title).toLowerCase()}. Print at home or practice online with a built-in AI tutor. No sign-up. No paywall.</p>
      <p class="fw-byline">
        By <a class="fw-byline-author" href="/about.html" rel="author">Hamid Ali</a>
        <span class="fw-byline-sep" aria-hidden="true">·</span>
        Updated <time datetime="${dateModifiedIso}">${new Date(dateModifiedIso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
      </p>

      <div class="fw-hero-cta">
        <a class="fw-btn fw-btn--primary" href="/practice.html?print=1&amp;s=${STATE_SLUG}&amp;g=${grade.slug}&amp;subj=math&amp;u=${encodeURIComponent(unit.id)}&amp;n=20">Print 20-question worksheet</a>
        <a class="fw-btn fw-btn--ghost" href="/practice.html?s=${STATE_SLUG}&amp;g=${grade.slug}&amp;subj=math&amp;u=${encodeURIComponent(unit.id)}">Practice online with AI tutor</a>
      </div>
    </header>

    <section class="fw-intro">
      <p>Looking for <strong>${esc(unit.title.toLowerCase())} worksheets</strong> for ${esc(grade.label)}? This page has ${qCount.toLocaleString()}+ TEKS-aligned practice questions on this exact topic${unit.teks ? `, mapped to Texas TEKS ${esc(unit.teks)}` : ''}. Every question goes through an AI quality gate before publishing — no typos, no wrong answer keys, no factually-broken explanations.</p>
      ${unit.summary ? `<p>${esc(unit.summary)}</p>` : ''}
      <p>Below: a sample of 8 questions with answers and explanations so you can see what's on the worksheet before you print. Each question has the correct choice marked and a one-line "why" so kids who get it wrong understand the fix.</p>
    </section>

    <section class="fw-questions" style="margin-bottom:32px;">
${qHtml}
    </section>

    <div class="fw-unit-cta">
      <a class="fw-btn fw-btn--primary" href="/practice.html?print=1&amp;s=${STATE_SLUG}&amp;g=${grade.slug}&amp;subj=math&amp;u=${encodeURIComponent(unit.id)}&amp;n=20">Print 20-question worksheet</a>
      <a class="fw-btn fw-btn--ghost" href="/practice.html?print=1&amp;s=${STATE_SLUG}&amp;g=${grade.slug}&amp;subj=math&amp;u=${encodeURIComponent(unit.id)}&amp;n=10">Print 10-question quick set</a>
      <a class="fw-btn fw-btn--ghost" href="/practice.html?s=${STATE_SLUG}&amp;g=${grade.slug}&amp;subj=math&amp;u=${encodeURIComponent(unit.id)}">Practice online with AI tutor</a>
    </div>

    <section class="fw-faq" aria-label="Frequently asked questions">
      <h2 class="fw-faq-title">Common questions</h2>

      <div class="fw-faq-q">
        <h3>Are these worksheets really free?</h3>
        <p>Yes. Free to print, free to practice online. No email, no sign-up, no paywall. We make money from optional paid features (toy redemption with real cents), not from the worksheets.</p>
      </div>

      <div class="fw-faq-q">
        <h3>${unit.teks ? `What is TEKS ${esc(unit.teks)}?` : `What TEKS standards does this cover?`}</h3>
        <p>${unit.teks ? `TEKS ${esc(unit.teks)} is the ${esc(grade.label)} ${esc(unit.title)} standard from the Texas Essential Knowledge and Skills.` : `This unit aligns to multiple ${esc(grade.label)} math TEKS standards.`} ${unit.summary ? esc(unit.summary) : ''}</p>
      </div>

      <div class="fw-faq-q">
        <h3>How many total questions are available?</h3>
        <p>${qCount.toLocaleString()}+ questions in our ${esc(grade.label)} ${esc(unit.title)} bank. Print as many 20-question worksheets as you like — each one pulls a fresh set so your kid doesn't see the same questions twice.</p>
      </div>

      <div class="fw-faq-q">
        <h3>Where do these questions come from?</h3>
        <p>Generated by our AI pipeline, then quality-gated by two independent models (gpt-4o for content review, Claude Sonnet 4.5 for math verification) before publishing. Every question is tagged to ${unit.teks ? `TEKS ${esc(unit.teks)}` : 'a specific TEKS standard'} and modeled on real STAAR item shapes.</p>
      </div>
    </section>

    ${verticalLinks.length > 0 ? `
    <section class="fw-related">
      <h2 class="fw-related-title">${esc(unit.title)} in other grades</h2>
      <div class="fw-related-pills">
        ${verticalHtml}
      </div>
    </section>
    ` : ''}

    <section class="fw-related">
      <h2 class="fw-related-title">More ${esc(grade.label)} math topics</h2>
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

function renderHubPage() {
  const items = GRADES.map((grade) => {
    let qCount = 0, unitCount = 0;
    try {
      const curr = loadCurriculum(grade.file);
      qCount = countQuestions(curr);
      unitCount = (curr.units || []).length;
    } catch (_) {}
    return `
      <a class="fw-hub-card" href="/free-worksheets/${grade.urlSlug}-math.html">
        <div class="fw-hub-card-head">
          <span class="fw-hub-card-grade">${esc(grade.short)}</span>
          <h3 class="fw-hub-card-title">${esc(grade.label)} math</h3>
        </div>
        <p class="fw-hub-card-meta">${qCount.toLocaleString()}+ questions · ${unitCount} topics</p>
        <span class="fw-hub-card-arrow" aria-hidden="true">→</span>
      </a>`;
  }).join('\n');

  let totalQ = 0;
  GRADES.forEach((g) => { try { totalQ += countQuestions(loadCurriculum(g.file)); } catch (_) {} });

  const pageTitle = `Free Texas STAAR Math Worksheets — ${totalQ.toLocaleString()}+ Questions (K-Algebra I)`;
  const pageDesc = `Free printable STAAR math worksheets for every Texas grade from Kindergarten through Algebra I. ${totalQ.toLocaleString()}+ TEKS-aligned practice questions. No sign-up. No email. Print or practice online.`;
  const canonicalUrl = `${SITE_ORIGIN}/free-worksheets/`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: pageTitle,
    description: pageDesc,
    url: canonicalUrl,
    hasPart: GRADES.map((g) => ({
      '@type': 'LearningResource',
      name: `Free ${g.label} STAAR Math Worksheets`,
      url: `${SITE_ORIGIN}/free-worksheets/${g.urlSlug}-math.html`,
      educationalLevel: g.label,
      learningResourceType: 'Worksheet',
    })),
  };

  // BreadcrumbList for the hub page
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Free worksheets' },
    ],
  };

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
  <meta name="keywords" content="free STAAR math worksheets, Texas STAAR practice, TEKS worksheets, printable math worksheets, K-8 math worksheets, Algebra I worksheets, free STAAR prep">
  <meta name="author" content="Hamid Ali, GradeEarn">

  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
  <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">

  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" hreflang="en-US" href="${canonicalUrl}" />
  <link rel="alternate" hreflang="x-default" href="${canonicalUrl}" />

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="GradeEarn">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="${esc(pageDesc)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:secure_url" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="GradeEarn — Free Texas STAAR math worksheets, K through Algebra I.">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@gradeearn">
  <meta name="twitter:creator" content="@gradeearn">
  <meta name="twitter:title" content="${esc(pageTitle)}">
  <meta name="twitter:description" content="${esc(pageDesc)}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png">

  <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
  </script>

  <script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=20260512b">
</head>
<body class="fw-page fw-page--hub">

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
      <a href="/free-worksheets/index.html" class="active">Free worksheets</a>
      <a href="/marketplace.html">Toys</a>
    </nav>
    <div id="user-slot" class="user-slot"></div>
  </div>
</header>

<main class="fw-main">
  <nav class="breadcrumb-nav breadcrumb-nav--minimal" aria-label="Breadcrumb">
    <ol class="breadcrumb breadcrumb--mid-dot">
      <li class="breadcrumb-item"><a href="/index.html">Home</a></li>
      <li class="breadcrumb-item breadcrumb-item--current">Free worksheets</li>
    </ol>
  </nav>

  <article class="fw-article fw-article--hub">

    <header class="fw-hero">
      <p class="fw-eyebrow">Free · Printable · TEKS-aligned</p>
      <h1 class="fw-h1">Free Texas STAAR Math Worksheets</h1>
      <p class="fw-lead">${totalQ.toLocaleString()}+ practice questions across every Texas grade, from Kindergarten through Algebra I. Free to print. Free to practice online. No sign-up, no email, no paywall.</p>
    </header>

    <section class="fw-intro">
      <p>Texas STAAR prep doesn't need to cost anything. This page links to <strong>${GRADES.length} grade-specific worksheet collections</strong> — every question tagged to a Texas TEKS standard, modeled on STAAR item shapes, and quality-gated by an AI review pipeline that catches ambiguity and bad math before it reaches your kid. Pick your kid's grade below to see sample questions and download a printable worksheet.</p>
      <p>Every worksheet is free to print as a PDF (browser's Print menu turns the page into a clean handout with an answer key on the back). If your kid would rather practice in the browser, each topic has a "Practice online with AI tutor" link — wrong answers get a step-by-step walkthrough from our built-in tutor, and correct answers earn real cents redeemable for toys we ship to your door.</p>
    </section>

    <section class="fw-hub-grid">
${items}
    </section>

    <section class="fw-faq" aria-label="Frequently asked questions">
      <h2 class="fw-faq-title">Common questions</h2>

      <div class="fw-faq-q">
        <h3>Are these worksheets really free?</h3>
        <p>Yes. Every worksheet on every grade page is free to print or practice online. We don't ask for an email, a phone number, or a credit card.</p>
      </div>

      <div class="fw-faq-q">
        <h3>How are these worksheets different from the free PDFs all over the internet?</h3>
        <p>Two ways. First, every question is TEKS-aligned and modeled on real STAAR item shapes — not generic "math practice." Second, every question goes through an AI quality gate (gpt-4o for content review, Claude Sonnet 4.5 for independent math verification) before it's published. The typo-riddled, wrong-answer-key experience you've probably hit on free-worksheet sites isn't a thing here.</p>
      </div>

      <div class="fw-faq-q">
        <h3>What if my kid wants to do more than print worksheets?</h3>
        <p>Click "Practice online with AI tutor" on any grade page. Your kid gets the same TEKS-aligned questions in the browser, plus a built-in AI tutor for wrong answers, daily streaks, and real cents that can be redeemed for toys. Free to start.</p>
      </div>

      <div class="fw-faq-q">
        <h3>Other states?</h3>
        <p>Not yet. GradeEarn is currently Texas-only — the content is calibrated to TEKS and STAAR. We may expand to other state tests (CAASPP, FAST, TCAP) in the future.</p>
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
      <a href="#">Privacy</a>
    </nav>
  </div>
</footer>

<script src="/js/auth.js?v=20260511c"></script>
</body>
</html>
`;
}

// ============================================================
// Main
// ============================================================

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalBytes = 0;
  let unitPagesWritten = 0;
  const allUnitUrls = []; // collected for sitemap output at end

  GRADES.forEach((g) => {
    try {
      // Grade index page
      const html = renderGradePage(g);
      const outPath = path.join(OUT_DIR, `${g.urlSlug}-math.html`);
      fs.writeFileSync(outPath, html);
      totalBytes += html.length;
      console.log(`✓ ${path.relative(REPO_ROOT, outPath)}  (${(html.length / 1024).toFixed(1)} KB)`);

      // Per-unit pages — one HTML file per topic inside this grade
      const curr = loadCurriculum(g.file);
      const units = curr.units || [];
      const gradeDir = path.join(OUT_DIR, g.urlSlug);
      if (!fs.existsSync(gradeDir)) fs.mkdirSync(gradeDir, { recursive: true });

      units.forEach((u) => {
        try {
          const unitHtml = renderUnitPage(u, g, units);
          const slug = slugify(u.title);
          const unitPath = path.join(gradeDir, `${slug}.html`);
          fs.writeFileSync(unitPath, unitHtml);
          totalBytes += unitHtml.length;
          unitPagesWritten++;
          allUnitUrls.push(`${SITE_ORIGIN}/free-worksheets/${g.urlSlug}/${slug}.html`);
        } catch (err) {
          console.error(`✗ ${g.urlSlug}/${slugify(u.title)}.html — ${err.message}`);
          process.exitCode = 1;
        }
      });
      console.log(`  → ${units.length} per-unit pages in ${g.urlSlug}/`);
    } catch (err) {
      console.error(`✗ ${g.urlSlug}-math.html — ${err.message}`);
      process.exitCode = 1;
    }
  });

  // Hub page
  try {
    const hubHtml = renderHubPage();
    const hubPath = path.join(OUT_DIR, 'index.html');
    fs.writeFileSync(hubPath, hubHtml);
    totalBytes += hubHtml.length;
    console.log(`✓ ${path.relative(REPO_ROOT, hubPath)}  (${(hubHtml.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`✗ index.html — ${err.message}`);
    process.exitCode = 1;
  }

  // Sitemap-fragment output — paste-ready URL list for sitemap.xml
  const fragmentPath = path.join(OUT_DIR, '.sitemap-unit-urls.txt');
  fs.writeFileSync(fragmentPath, allUnitUrls.join('\n') + '\n');
  console.log(`\nGenerated ${GRADES.length + 1 + unitPagesWritten} pages, ${(totalBytes / 1024).toFixed(1)} KB total.`);
  console.log(`  ${GRADES.length} grade index + 1 hub + ${unitPagesWritten} per-unit`);
  console.log(`  Unit-URL list (paste into sitemap.xml): ${path.relative(REPO_ROOT, fragmentPath)}`);
}

if (require.main === module) main();
module.exports = { GRADES, renderGradePage, renderHubPage };
