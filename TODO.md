# TODO

In-flight items captured from working sessions. Categories:
**pre-launch infra**, **pre-paid-launch**, **quality/content**,
**observed-bugs**. Each item carries lifecycle state + a resume hint
+ relevant commit hashes so a future session can pick up without
re-deriving context.

Append new items under the right category. Move resolved items to
`docs/archive/` rather than deleting (keeps the audit trail).

---

## quality/content

### §92 LIVE EXECUTION — math grade-orphan migration
- **State:** scripts shipped (commit `3e3bea1`); dry-run executed and
  matches audit exactly (593 rows: 412 `grade=3` + 34 `grade=1` +
  3 `grade=4` + 144 `grade=K`); 20-row sample inspected and green-lit;
  awaiting `--live` exec.
- **Resume:** `cd scripts/migrations && node m92-math-grade-orphans.js --live`
- **Verify:** post-run scan for `subject=math AND state=texas AND
  grade IN (1,3,4,K)` should return **0 rows**; canonical buckets
  `grade-1`/`grade-3`/`grade-4`/`grade-k` gain +593 with
  `_migration='§92'` stamp. Restore: `m92-restore.js --manifest
  <m92-live-*.jsonl> --live`.
- **Logged:** 2026-05-14

### §94 LAMBDA DEPLOY — wallet no-deduct
- **State:** lambda code change shipped (commit `120676d`); `handleLose`
  returns `lostCents: 0` always (still bumps `lifetimeAnswered++` for
  accuracy stats). Frontend already shows `+5 pts` everywhere.
- **⚠ Production lambda still deducts** until `./deploy.sh` runs. Until
  deploy: kid sees `+5 pts` in the UI → wrong answer → wallet ticks
  down by 5 → confusing.
- **Resume:** `./deploy.sh` (interactive, 9 safety phases, auto-backup
  per CLAUDE.md §19).
- **Logged:** 2026-05-14

### §27 LETTER-PREFIX SWEEP — gpt-4o-mini choice-text leak
- **State:** scoped, not started.
- **Issue:** model-generated choices include literal letter prefix
  (`"A. The revolution was solely..."`) which the UI then double-
  prefixes with its own letter chip → kids see `"A A. ..."`. Surfaced
  on g8 SS samples during §SS audit. Likely sibling-bug in Math +
  Reading content from same gpt-4o-mini era.
- **Order:** run AFTER §92 live so the newly-reachable 593 rows are
  swept in the same pass.
- **Approach:** scan `staar-content-pool` for choice strings matching
  `^[A-D]\.\s+` regex; bucket by subject/grade; tombstone or in-place
  rewrite via a §93 migration script (same Put+Delete pattern as §92
  since `poolKey` doesn't change here — `UpdateItem` is enough).
- **Logged:** 2026-05-14

### LAKE-WIDE JUDGE BACKFILL — Reading + Science coverage
- **State:** identified, not prioritized.
- **Coverage today:** Reading 2.5% `_judgedAt`, Science 10.7%
  `_judgedAt`, Math 97.2% `_judge`, SS 0%. Pre-judge era content
  never went through the gate; new writes get judged.
- **Approach:** adapt `scripts/lake-audit/audit-judge-existing-rows.js`
  (the §27 lake-wide judge run, gpt-4o JUDGE_MODEL per CLAUDE.md §27)
  per subject — Reading + Science each get their own pass. Cost
  estimate: 1100 + 976 rows × ~$0.002/call ≈ $4-5 + Anthropic
  verifier ≈ $10. Drift-rejects tombstoned per §28 pattern.
- **Order:** lower urgency than §92 + §27 sweep. Schedule after
  Math content is stable.
- **Logged:** 2026-05-14

### SS USA-BROAD KNOWLEDGE PACK
- **State:** strategy locked (§SS-USA-BROAD in
  `docs/knowledge-packs/architecture-decisions.md`), no content yet.
  SS gated off in `js/grade-page.js#liveForGrade` (§91, commit
  `10e98e2`) until this ships.
- **Scope:** K-8 + Algebra-1-equivalent. US history strands by grade,
  world geography, civics, economics. Anchor on NCSS C3 Framework +
  Common Core ELA Social Studies strands.
- **Existing 870 Texas SS rows:** preserved in pool (unjudged,
  schema-broken, gated off). May be reusable as TX g8 history overlay
  seeds when the overlay ships. **Do not tombstone yet.**
- **Resume:** scope/draft `docs/knowledge-packs/usa-social-studies.md`
  + `prompts/usa-ss-judge-v1.md`, then a content-gen pipeline modeled
  on `scripts/science/` (Texas Science May 8 commit `438a353`).
- **Logged:** 2026-05-14

### TEXAS SCIENCE → USA SCIENCE FOLD-IN
- **State:** strategy locked (per §SS-USA-BROAD precedent), not
  started. Texas Science KP from May 8 (commit `438a353`) was
  built before the USA-broad strategy.
- **Plan:** fold Texas Science content into a forthcoming
  `usa-science.md` (NGSS-anchored) as a Texas overlay rather than
  a state-specific KP. No immediate code work — current Texas
  Science content stays live in the meantime.
- **Order:** behind SS USA-broad KP (which establishes the
  USA-broad-with-overlay pattern).
- **Logged:** 2026-05-14

---

## observed-bugs

### TEXT-CONTRAST AUDIT — H2/H3 on dark surfaces
- **State:** Hamid screenshot 2026-05-14, `/practice.html?review=1`
  (signed-out guest, Grade 1): the H2 "Review your wrong answers"
  renders in dark navy on the dark navy page bg — effectively
  invisible (WCAG AA contrast fail). Likely repeats anywhere a
  generic `<h2>` renders on a `body.practice-page` /
  `body.grade-page` surface without an explicit color override.
- **Likely cause:** generic `<h2>` rule sets `color: var(--ink)` (dark
  navy); `body.practice-page` sets `color: #fff` on body but the
  h2 selector wins by specificity.
- **Other opportunities surfaced by the same screenshot:**
  1. **Empty viewport pattern.** Below the "Create your free account"
     card, ~70% of the viewport is empty navy. Same dead-zone class
     the planner flagged on home/practice. Needs the same intentional
     whitespace treatment (radial gradient / divider) from §94.4 — or
     contextual content (e.g., "What you'll get when you sign up:
     ✓ Earn cents toward real toys, ✓ Save progress, ✓ Daily quest").
  2. **No fallback nav for guests.** Signed-out guest who taps
     'Review your wrong answers' lands here, hits a sign-up wall,
     and has no clear path forward except 'Create account' or
     `back-arrow → Grade 1`. No 'maybe later, keep practicing' link.
  3. **'Sign in' top-right is a bare pill.** Per §94 deferred item:
     should be small text link OR a sign-in modal trigger, not a
     button competing with the gold 'Create account'. Two primary-
     feeling CTAs on the same screen for adjacent intents.
  4. **No surface chrome differentiation.** Card has the same navy
     bg as the page — only the (faint) border separates them. Card
     should sit on a slightly raised surface (gradient or 1px
     lighter) to read as a distinct affordance.
- **Approach:**
  1. Run an axe / Lighthouse contrast pass on `/practice.html`,
     `/grade.html`, `/index.html`, `/myspace.html` to catalogue
     every failing pair systematically (not just this one).
  2. Stopgap CSS while the audit is in flight:
     ```css
     body.practice-page h1, body.practice-page h2, body.practice-page h3,
     body.grade-page h1, body.grade-page h2, body.grade-page h3,
     body.myspace-page h1, body.myspace-page h2, body.myspace-page h3 {
       color: rgba(255, 255, 255, 0.95) !important;
     }
     ```
  3. Real fix: every authed product surface inherits white text by
     default; explicit color overrides only where intentional
     (e.g., gold for accents).
- **Logged:** 2026-05-14

### WRONG-ANSWER REVERSE-LOOKUP for bare-grade math rows
- **State:** moot after §92 live ships. Kept here as a post-migration
  verification step.
- **Verify post-§92:** scan `staar-content-events` (or wherever
  wrong-answer logs live) for entries referencing math `poolKey`
  values that still point at `texas#3#math#...` / `texas#K#math#...`
  / etc. (the pre-migration bare form). Either rewrite those
  references to the canonical form, or accept that orphan log
  references are tolerable since the migration left a
  `_migrationBefore` trail.
- **Logged:** 2026-05-14

### ENFORCE HTTPS — final close-out
- **State:** ✅ resolved 2026-05-14. HTTP → 301 → HTTPS verified
  server-side (Fastly/GitHub-Pages, `Location: https://gradeearn.com/`).
  DNS + cert chain confirmed by Hamid.
- **Logged:** 2026-05-14
- **Move to archive** on next sweep.

---

## pre-launch infra

### §81 STATE-PICKER EXTRACTION
- **State:** TODO from §81 (slim practice top bar, commit `0e53187`).
  The practice context bar's ⋯ menu has a "Switch state" item that's
  currently a no-op + TODO comment — needs a reusable state-picker
  component before it can route somewhere real.
- **Today:** state-picker logic is embedded in onboarding (`states/`
  page) and not extractable as a component. Needed for the
  switch-state breadcrumb tap referenced in §81's accept list.
- **Order:** deferred behind current Math + Reading content priorities
  and behind the kill-home work landing (§87-§90). Re-prioritize
  when "switch state during practice" becomes a paying-user request.
- **Logged:** 2026-05-14

---

## pre-paid-launch

### OWNER NOTIFICATION ON NEW ACCOUNT CREATION
- **State:** requested 2026-05-14. Not started.
- **Goal:** when a new GradeEarn account is created, notify Hamid
  (`hamid@gradeearn.com` per CLAUDE.md §1) in near-real-time so
  signups can be eyeballed during the paid-launch ramp.
- **Approach options:**
  - **(A) SES email** to `hamid@gradeearn.com` from
    `lambda/tutor.js#handleSignup` (existing handler at ~line 1099).
    Easy. Requires a verified SES sender. CLAUDE.md §6d already
    has SES wired (was used for the retired pricing.js) — could
    repurpose that SES identity OR set up a clean
    `notifications@gradeearn.com` sender.
  - **(B) SNS topic** with an email subscription. More flexible
    (lets future additions add Slack / webhook subscribers) but
    more moving parts.
  - **(C) Slack incoming-webhook.** Fastest if Hamid runs a Slack
    workspace; brittle if not. Easiest to dismiss / search.
- **Payload (any option):** username, displayName, email, state,
  grade, signup-flow source (referrer / utm), IP (fraud-screen),
  timestamp.
- **PII discipline:** notification log itself stored on short
  retention (30 days) per the COPPA exposure surface (CLAUDE.md
  §12 #2). Don't write the kid's name into Slack history that
  persists forever.
- **Order:** ship BEFORE the legal Phase 4 launch ramp so the first
  paying signups are watched live.
- **Logged:** 2026-05-14

### COPPA / legal cover (Phase 4 from CLAUDE.md §9)
- **State:** deferred per CLAUDE.md §9 until paid signups imminent.
  Includes age gate, parental consent flow, ToS, privacy policy,
  field-level encryption for parent PII, attorney review at end.
- **ReplyQuik separation:** stays untouched per memory rule
  (`feedback_replyquik_is_live.md`).
