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

### §27 LETTER-PREFIX SWEEP — gpt-4o-mini choice-text leak
- **State:** scoped 2026-05-14 — 143 affected rows table-wide (75
  science / 35 SS / 33 math) where ALL 4 choices start with literal
  `^[A-D]\.\s+`. Migration scripts in flight (m93-letter-prefix-strip.js
  + m93-restore.js). Dry-run executing.
- **Resume:** if dry-run passes sample-eyeball, run
  `cd scripts/migrations && node m93-letter-prefix-strip.js --live`.
- **Strategy:** UpdateItem (poolKey unchanged) — strip prefix from each
  choice + answer; stamp `_migration='§93'` + `_migrationBefore` for
  restore.
- **Logged:** 2026-05-14

### LAKE-WIDE JUDGE BACKFILL — Reading + Science coverage
- **State:** sample done 2026-05-14 (50 rows each, $0.20 total). Two
  findings:
  - **Reading: 12% reject rate** on sample (44/50 pass, 6 reject —
    3 FACTUAL, 2 AGE_FIT, 1 AMBIGUITY). Acceptable baseline; full
    sweep is reasonable but defer for now.
  - **Science: 56% reject rate** on sample (22/50 pass, 28 reject —
    15 AMBIGUITY, 6 FACTUAL, 5 ANSWER_LANGUAGE, 4 AGE_FIT,
    4 MULTIPLE_CORRECT). **Policy-decision territory** — tombstoning
    ~550 science rows requires Hamid eyeball + decision (regenerate
    vs leave vs gate). Texas Science KP shipped May 8; the post-KP
    rows may differ from these pre-KP rows.
  - Sample outputs: `scripts/lake-audit/output/judge-reading-2026-
    05-14T19-17-29-874Z.json`, `output/judge-science-2026-05-14T19-
    20-15-075Z.json`.
- **Side finding — pre-existing audit bug fixed.** The May 3 §27
  lake-wide audit (`audit-judge-existing-rows.js`) was passing
  `normalized.question` (just the stem string) to `judgeQuestion`
  instead of the full structured object. The judge couldn't see
  choices/correctIndex → reasonable rejections on legitimate rows.
  **The 87 rejects from §27 May 3 are tainted data.** Bug fixed
  2026-05-14; future runs of that script are accurate. Worth re-
  running the §27 audit before any tombstone work consumes those
  rejects.
- **Approach for full sweep (after Hamid eyeballs samples):**
  `cd scripts/lake-audit && OPENAI_API_KEY=... node
  judge-by-subject-sample.js --subject reading --all` (~$2.20,
  ~50 min wall-clock for 1,100 rows). Same for science. Then a
  sample-eyeball + tombstone pass.
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
- **Blocker:** medium-scope content build (multi-hour API spend); flag
  before kicking off.
- **Logged:** 2026-05-14

### TEXAS SCIENCE → USA SCIENCE FOLD-IN
- **State:** strategy locked (per §SS-USA-BROAD precedent), not
  started. Texas Science KP from May 8 (commit `438a353`) was
  built before the USA-broad strategy.
- **Plan:** fold Texas Science content into a forthcoming
  `usa-science.md` (NGSS-anchored) as a Texas overlay rather than
  a state-specific KP. No immediate code work — current Texas
  Science content stays live in the meantime.
- **Order:** behind SS USA-broad KP.
- **Logged:** 2026-05-14

---

## observed-bugs

### TEXT-CONTRAST AUDIT — H2/H3 on dark surfaces
- **State:** stopgap shipped 2026-05-14 (§96 — blanket white H1/H2/H3
  on every authed product `body.{page}-page` surface via
  `!important`). Real audit pass deferred.
- **Other opportunities surfaced by the same screenshot (deferred):**
  1. **Empty viewport dead-zone** below the "Create your free account"
     card. Same class the planner flagged before. Add §94.4-style
     radial gradient OR contextual content ("What you'll get: ✓ Real
     toys, ✓ Saved progress, ✓ Daily quest").
  2. **No fallback nav for guests** hitting the sign-up wall. No
     "Maybe later, keep practicing" link.
  3. **Two primary-feeling CTAs in tension** — top-right "Sign in" pill
     + center "Create your free account" button compete for the same
     intent. §94 deferred item also flagged.
  4. **Card surface identical to page bg** — only faint border
     separates them; needs a 1px-lighter raised surface or subtle
     gradient.
- **Real fix path:**
  1. axe / Lighthouse pass across `/practice.html`, `/grade.html`,
     `/index.html`, `/myspace.html` to catalogue every contrast
     failure systematically.
  2. Tighter per-component color overrides (replace the §96 stopgap
     `!important` with proper specificity).
- **Logged:** 2026-05-14

---

## pre-launch infra

### §81 STATE-PICKER EXTRACTION
- **State:** TODO from §81 (slim practice top bar, commit `0e53187`).
  The practice context bar's ⋯ menu has a "Switch state" item that's
  currently a no-op + TODO comment — needs a reusable state-picker
  component before it can route somewhere real.
- **Today:** state-picker logic is embedded in onboarding (`states/`
  page) and not extractable as a component.
- **Order:** deferred — Texas-only product per memory rule; switch-
  state isn't a paying-user request today.
- **Logged:** 2026-05-14

---

## pre-paid-launch

### OWNER NOTIFICATION ON NEW ACCOUNT CREATION
- **State:** requested 2026-05-14. Not started.
- **Goal:** when a new GradeEarn account is created, notify Hamid
  (`hamid@gradeearn.com` per CLAUDE.md §1) in near-real-time so
  signups can be eyeballed during the paid-launch ramp.
- **External blocker:** SES sender verification, OR a Slack incoming-
  webhook URL Hamid provides. Cannot autonomously ship without one
  of those.
- **Approach when unblocked:**
  - **(A) SES email** to `hamid@gradeearn.com` from
    `lambda/tutor.js#handleSignup` (existing handler at ~line 1099).
    Requires a verified SES sender. CLAUDE.md §6d already has SES
    wired (was used for the retired pricing.js) — could repurpose
    that SES identity OR set up a clean
    `notifications@gradeearn.com` sender.
  - **(B) SNS topic** with email subscription.
  - **(C) Slack incoming-webhook.** Fastest if Hamid runs a Slack.
- **Payload:** username, displayName, email, state, grade, signup-flow
  source, IP (fraud-screen), timestamp.
- **PII discipline:** notification log itself stored on short
  retention (30 days) per CLAUDE.md §12 #2.
- **Order:** ship before legal Phase 4 launch ramp.
- **Logged:** 2026-05-14

### COPPA / legal cover (Phase 4 from CLAUDE.md §9)
- **State:** deferred per CLAUDE.md §9 until paid signups imminent.
  Includes age gate, parental consent flow, ToS, privacy policy,
  field-level encryption for parent PII, attorney review at end.
- **External blocker:** attorney review.
- **ReplyQuik separation:** stays untouched per memory rule
  (`feedback_replyquik_is_live.md`).

---

## ✅ Resolved this session (2026-05-14) — move to archive on next sweep

### §92 LIVE EXECUTION — math grade-orphan migration
- **Resolved:** 2026-05-14. 593/593 rows migrated, 0 failures.
- **Verified:** post-migration scan returns 0 bare-grade math
  orphans. Restore manifest:
  `scripts/migrations/output/m92-live-2026-05-14T18-29-41-117Z.jsonl`
- **Restore command (if needed within 35-day PITR window):**
  `cd scripts/migrations && node m92-restore.js --manifest
  output/m92-live-2026-05-14T18-29-41-117Z.jsonl --live`

### §94 LAMBDA DEPLOY — wallet no-deduct
- **Resolved:** 2026-05-14. `./deploy.sh --yes` ran cleanly. New
  CodeSha256: `Krxy6BCjGoO/B7X479IyC9lD7/jf8ivO1uguB5EgWz4=`.
  prod alias v3 → v4.
- **Rollback:** `aws lambda update-alias --function-name staar-tutor
  --name prod --function-version 3`. Backup zip:
  `backups/staar-tutor-20260514T183306Z-Kd89RDCI.zip`.
- **Effect:** wrong answers no longer deduct from wallet in
  production. lifetimeAnswered++ still bumps for accuracy stats.

### WRONG-ANSWER REVERSE-LOOKUP for bare-grade math rows
- **Resolved:** 2026-05-14. Post-§92 scan of `staar-content-events`
  found 0 events referencing bare-grade math poolKeys. Clean.

### ENFORCE HTTPS — final close-out
- **Resolved:** 2026-05-14. HTTP → 301 → HTTPS verified server-side
  (Fastly/GitHub-Pages, `Location: https://gradeearn.com/`). DNS +
  cert chain confirmed.
