# CLAUDE.md — GradeEarn

> Onboarding context for any future Claude session in this repo. Read this first.
> Last reconciled against owner ground truth + AWS read-only inventory: 2026-05-02.

---

## 0. Status board (READ FIRST)

Mix of (a) ground-truth corrections from prior sessions and (b) retractions of
mistakes I made earlier in this session. Both surfaced rather than silently
overridden so future sessions don't repeat the same diagnoses.

1. **Phase 1 (cold-start refactor): ✅ DONE in commit `a1730a5`.**
   `scripts/cold-start/generators.js` routes through
   `scripts/cold-start/states-grades.js` → `js/states-data.js`. No
   `STATE_PROMPTS`, no Texas fallback, throws on unknown state slug. Cold-start
   CLI is structurally complete. Verified 2026-05-02 (smoke test +
   self-audit).

2. **Phase 2 (backend lambda refactor): 🟥 NOT DONE.**
   `lambda/pool-topup/generators.js:7` still defines `STATE_PROMPTS`;
   `:39` still has the silent Texas fallback
   (`STATE_PROMPTS[stateSlug] || STATE_PROMPTS.texas`); buildPrompt still does
   NOT throw on unknown state. Currently harmless because the
   `staar-pool-topup-hourly` EventBridge rule is DISABLED — the Phase 0 gate
   is what's keeping this from polluting the lake. **Do not re-enable the
   rule before this lands**; it will silently fall back to Texas for every
   other state. Phase 2 also includes building a JSON snapshot of
   `states-data.js` that lambda code can read at runtime — lambda cannot
   `require()` the frontend file directly because it depends on `window`.

   ~~Earlier this session, §0 #1 was framed as "Phase 1 is NOT done" and
   pointed at this same lambda file. RETRACTED — the lambda work is Phase 2,
   not Phase 1. The narrowly-scoped Phase 1 (cold-start CLI) shipped in
   `a1730a5`.~~

3. **`states-data.js` schema retraction.**
   ~~Earlier this session, §0 #2 claimed "states-data.js field is `gradesTested`,
   not `gradesTestedBySubject`." That was wrong.~~ RETRACTED 2026-05-02:
   `gradesTestedBySubject` exists on **all 51 states** with non-empty per-subject
   grade arrays. It is **attached at runtime** by an IIFE around line 1326 of
   `js/states-data.js` (Texas is hand-tuned via a `TEXAS_SUBJECT_GRADES`
   constant; the other 50 states are derived from `gradesTested`). The
   `gradesForState(slug, subject)` helper in `scripts/cold-start/states-grades.js`
   reads this field and works correctly today. Smoke test confirmed
   2026-05-02: `texas/science → ['grade-5','grade-8']` (2 grades),
   `texas/social-studies → ['grade-8']` (1 grade), `alabama/math → 7 grades`,
   `bogus-slug → []`. **Do not "patch" gradesForState** — patching it to read
   the flat `gradesTested` array would silently expand Texas science and
   social-studies sweeps to 7 grades each.

4. **`pricing.js` SES bleed is wired but currently dormant.** The code/env
   wiring (`FROM=wealthdeskpro@gmail.com`, `TO=hamid.ali87@gmail.com`) and
   the deployed `toolintel-pricing` lambda are all still there. But the
   zombie API Gateway `v7086lxsji` had **zero traffic in the last 7 days**,
   so the lambda has not been invoked. The risk is real but it's a tripwire,
   not an active bleed — the moment anything wakes that API, the emails
   start flowing again.

5. The earlier discovery report's claim of **"S3+CloudFront for the frontend"
   was wrong** — actual hosting is GitHub Pages from the `main` branch root.
   Corrected below.

6. **Five-commit cleanup of `states-data.js`:** only commit 1 (`b9eca24`,
   "add standards field to all 51 state records") is on `main`. There is no
   evidence of stranded commits 2–5 on disk — working tree is clean except
   the two untracked cold-start scripts. If 2–5 were drafted, they exist
   only in the human's head.

---

## 0.1 Process notes (avoid repeating these mistakes)

**Reading static record literals is not equivalent to executing the file.**
`js/states-data.js` attaches fields at runtime via IIFEs (e.g.
`gradesTestedBySubject` around line 1326) that are not visible in the literal
section (lines 35–~310). Earlier this session I read lines 35–90, never
reached the IIFE, and falsely concluded `gradesTestedBySubject` didn't exist.
That produced a false bug claim against `gradesForState` which would have
broken Texas science / social-studies sweeps if patched.

**Before claiming a field is missing from `states-data.js`, run:**
```sh
node -e "const fs=require('fs'),vm=require('vm'); const s={window:{},console};
vm.createContext(s); vm.runInContext(fs.readFileSync('./js/states-data.js','utf8'),s);
console.log(Object.keys(s.window.STATES.find(x=>x.slug==='texas')));"
```
This prints the *runtime* shape of a state record, not the source-literal
shape. The source-literal shape is misleading.

**Same principle applies to `tutor.js`, `content-lake.js`, etc.** if any of
them attach fields dynamically. Don't trust the first 60 lines.

---

## 1. Owner & communication style

- **Hamid Ali** — solo founder, three kids (one newborn).
- **Email:** `hamid@gradeearn.com` (work, Google Workspace + Namecheap DNS) /
  `hamid.ali87@gmail.com` (personal — also the SES notify target on the
  retired pricing.js).
- **Communication style:**
  - Brief. Don't pad answers. Don't restate the prompt.
  - Baby-step on environment / AWS / DNS work — name one concrete next
    command at a time, don't dump 6-step plans before he's said yes to step 1.
  - Don't ask permission for read-only / safe-by-default actions; just do
    them and report. Do confirm before anything destructive or irreversible.
  - Don't cost-optimize when he says he has headroom. Don't litigate
    settled decisions (see §8).

**Goal of the business:** 1K paying customers in 12 months. Reliability is the
top priority for the next phase of work.

---

## 2. What this is

**GradeEarn** (gradeearn.com) is a K-12 state-test-prep PWA where kids
practice for their state's test (STAAR, CAASPP, FAST, TCAP, etc., all 50
states + DC) and **earn cents redeemable for real toys** capped at $100 per
kid lifetime. Free during beta. ~20 real testers in production.

The repo and GitHub remote are still named **`toolintel`** because the
project went through two rebrands: `toolintel → StarTest → GradeEarn`. Both
rebrands left substantial dead code; see §6 "Active legacy to retire".

- Working dir: `/Users/bob/clawd/toolintel/`
- Git remote: `git@github.com:hamidanthro/toolintel.git`
- Production domain: `gradeearn.com` (CNAME file → GitHub Pages)
- AWS account: `860141646209` (us-east-1)

---

## 3. Stack & build

**No build step.** Vanilla HTML/CSS/JS served as static files. Lambda backend
in Node.js 20.

| Layer | Tech |
|---|---|
| Frontend | Static HTML + vanilla JS (no bundler, no framework, no TS) |
| Styling | Single hand-authored `css/styles.css` (~360KB) |
| PWA | `service-worker.js` + `manifest.json` (installable; offline shell) |
| Frontend hosting | **GitHub Pages from `main` branch root** (see §4) |
| Backend | AWS Lambda (Node 20.x) behind API Gateway HTTP API v2 |
| Auth | Custom — HMAC-signed token in `localStorage`, secret in Secrets Manager |
| Database | DynamoDB (multiple tables — see §7) |
| AI | OpenAI `gpt-4o-mini` for tutoring + question generation; `text-embedding-3-small` for dedup |
| Storage | S3 (toy images) |
| Cold-start jobs | `scripts/cold-start/` — local Node CLI for bulk question generation |

**No `package.json` at repo root.** Each lambda has its own
(`lambda/pool-topup/`, `lambda/quality-patrol/`, `lambda/tutor-build/`,
`scripts/cold-start/`).

**No CI, no tests, no Dockerfile, no linter, no TypeScript.** Treat any
"add hygiene" instinct with skepticism — house style is intentional vanilla.

---

## 4. Frontend deploy — GitHub Pages from `main`

Verified 2026-05-02 against `gh repo view hamidanthro/toolintel`:
- defaultBranchRef: `main`, visibility: PUBLIC
- No `.github/workflows/` directory
- No `gh-pages` branch (only `main` and `staging` on origin)
- No `_config.yml`, no `.nojekyll`
- `CNAME` = `gradeearn.com`

**Deploy mechanism:** GitHub Pages serves the `main` branch root directly.
A `git push origin main` is the deploy. Live within ~1–2 minutes.

**Implications:**
- There is no staging/preview environment for the live site. (`staging`
  branch exists but is ~30 commits behind `main`, only divergence is one
  ancient "Add waitlist form backend integration" commit. It is not used
  for previews today.)
- Cache-busting is via `?v=YYYYMMDD<letter>` query strings on every
  `<script>` tag. Bump these when shipping a JS change.
- The service worker shell-cache is keyed on `CACHE_VERSION = 'gradeearn-v1'`
  in `service-worker.js`. Bump this version when shell asset URLs change,
  otherwise installed PWAs serve stale code.
- A push to `main` is not reversible by deleting the branch (Pages will just
  show 404). Reverts must be commits.

**DNS:** Namecheap manages `gradeearn.com`; Google Workspace owns the MX
records for `hamid@gradeearn.com`.

---

## 5. Lambda deploy — manual zip with a fragile two-step

There is no deploy script in the repo today (Phase 6 of the build plan will
add one). The current process is **manual** and has a structural drift hazard
that's already biting:

```
lambda/tutor.js              ← edited source (forward-progress draft)
   │  (manual copy, often forgotten)
   ▼
lambda/tutor-build/index.js  ← packaging mirror — what actually gets zipped
   │  (zip + aws lambda update-function-code, manual)
   ▼
staar-tutor in AWS           ← what's actually serving traffic
```

**Verified deployed-vs-local drift (as of 2026-05-02, AWS read-only inventory):**

| Lambda | Local source of truth | Drift vs deployed |
|---|---|---|
| `staar-tutor` (tutor.js) | `lambda/tutor-build/tutor.js` | only 3 lines: `StarTest`→`GradeEarn` strings (the brand-rename commit was never deployed) |
| `staar-tutor` (tutor.js) | `lambda/tutor.js` | **+321 / −5** lines — substantial forward-progress work that has not been packaged or deployed |
| `staar-tutor` (content-lake.js) | `lambda/tutor-build/content-lake.js` | 1 line (StarTest→GradeEarn header) |
| `staar-tutor` (content-lake.js) | `lambda/content-lake.js` | +7 / −7 lines |
| `staar-pool-topup` (index.js) | `lambda/pool-topup/index.js` | identical ✓ |
| `staar-pool-topup` (generators.js) | `lambda/pool-topup/generators.js` | +12 / −1 lines — this is the **Phase 2** lambda refactor target (see §0 #2). The same fix that landed in cold-start in `a1730a5` needs to be ported here. Currently dormant because the EventBridge schedule is DISABLED. |
| `staar-quality-patrol` (index.js) | `lambda/quality-patrol/index.js` | 1 line (StarTest→GradeEarn header) |

**Trap:** `lambda/tutor-build/` is in `.gitignore`. Any change there is
invisible to git review. So a deploy that uses `tutor-build/` as its source
gets **zero code review**. This is the single biggest reliability hazard in
the deploy story today, and Phase 6 (deploy.sh + ROLLBACK.md) is what fixes
it.

---

## 6. Active legacy to retire (Phase 3 work)

Four retired products have left active surface area in this repo or in AWS.
**Aggressive deletion** is the agreed approach (NOT moving to a `_legacy/`
folder — git history preserves anything we delete).

### 6a. ToolIntel (AI-tool review site — first incarnation of the repo)

Frontend modules (loaded by NO active HTML page; all point at the dormant
zombie API):
`js/certification-form.js`, `js/expert-contribution.js`,
`js/claim-verification.js`, `js/compliance-filter.js`, `js/hype-index.js`,
`js/policy-changes.js`, `js/pricing-table.js`, `js/procurement-pack.js`,
`js/reliability-monitor.js`, `js/security-incidents.js`,
`js/product-changelog.js`, `js/team-recommender.js`, `js/trust-score.js`.

Lambda directory (24 of 25 top-level lambdas are toolintel-era):
`api.js`, `audit.js`, `certifications.js`, `changelog.js`, `claims.js`,
`compare.js`, `compliance.js`, `experts.js`, `hype-index.js`, `incidents.js`,
`independence.js`, `intelligence.js`, `peer-review.js`, `policies.js`,
`pricing.js`, `procurement.js`, `recommender.js`, `reliability.js`,
`research.js`, `reviews.js`, `submit.js`, `trust-scores.js`, `waitlist.js`.

AWS-side: API Gateway `v7086lxsji` ("toolintel-api", 23 integrated
`toolintel-*` lambdas). **Zero traffic in last 7 days.**
Recommendation: archive the lambdas (or delete) and delete the API.

Other artifacts: `data/review-database.json`, `data/tools-queue.json`,
`BACKLOG.md`, `agents/review-intelligence-agent.md`, `methodology-v1.pdf`.

### 6b. StarTest (rebrand interim — same backend, just old name)

The deployed `staar-tutor` lambda still says "StarTest" in its prompts and
header comments because the rebrand commit (`536006b`,
"chore(brand): rename StarTest → GradeEarn across 37 files") landed in the
repo but has not been redeployed to AWS. Real children are currently
talking to a tutor that says "I'm an AI tutor built into StarTest." Fix is
a single re-package + re-upload of `tutor.js` once Phase 6 deploy.sh exists.

DynamoDB tables and most env var names still carry the `staar-` /
`STAAR_*` prefix. Leave the table names alone — renaming a live DynamoDB
table is a migration, not a chore. The `STAAR_TUTOR_ENDPOINT` global on the
frontend is a safe rename target later.

### 6c. ReplyQuik (AI customer-support chatbot)

**Still running on AWS AppRunner — verified 2026-05-02:**
- `replyquik-api-main` (RUNNING, last updated 2026-04-29)
- `replyquik-api-staging` (RUNNING)
- EventBridge rule `AWSAppRunnerManagedRuleForECREvent` is **ENABLED** and
  watches the `replyquik-backend` ECR repo for image pushes ("DO-NOT-DELETE.
  The rule is used by AWS AppRunner.").

ReplyQuik also leaks into the GradeEarn frontend: every active HTML page
(including `admin.html` and `practice.html`) loads
`https://api.replyquik.com/widget.js`. Third-party JS that runs in
gradeearn.com's origin can read the localStorage auth token. **High blast
radius — kids' product.** Remove the widget tags as part of this phase.

### 6d. WealthDeskPro (defunct finance product)

`lambda/pricing.js` still hardcodes:
- `FROM_EMAIL = 'wealthdeskpro@gmail.com'`
- `NOTIFY_EMAIL = 'hamid.ali87@gmail.com'`
- Uses SES `SendEmailCommand` on `/pricing/report`, `/pricing/admin/update`,
  `/pricing/admin/verify` paths.

The deployed `toolintel-pricing` Lambda still has `FROM_EMAIL`,
`NOTIFY_EMAIL`, `ADMIN_KEY` env vars set, last modified Feb 20 2026,
**0 invocations in last 7 days** (because the zombie API has zero traffic).
This is a tripwire: re-enable the API, the bleed restarts. Delete in
sequence: API Gateway integration → Lambda → SES identity (if dedicated).

---

## 7. Architecture map (active GradeEarn surface only)

```
gradeearn.com (GitHub Pages from main branch root)
   │
   ├── Static HTML pages (index, grades, grade, practice, marketplace,
   │     settings, admin, about, 404, /states/index.html)
   ├── /js/*.js (active subset — see §6 for orphans)
   ├── /css/styles.css
   ├── /data/grade-{k,1..8}-curriculum.json + algebra-1-curriculum.json
   │     (~40MB total of curriculum JSON, served as static assets)
   └── service-worker.js (caches shell, never caches API calls)

API Gateway HTTP API v2 (us-east-1)
   ApiId: 4wvuw21yjl   Name: staar-tutor-api
   ApiEndpoint: https://4wvuw21yjl.execute-api.us-east-1.amazonaws.com
   Created: 2026-04-25
   ~22,300 invocations / week, ~184 errors / week (~0.82% error rate)
   │
   └── $default route → staar-tutor Lambda (action-dispatched, ~40 actions)
         │
         ├── DynamoDB (10 staar-* tables)
         ├── S3 (toy images, presigned uploads)
         ├── Secrets Manager
         │     • staar-tutor/openai-api-key
         │     • staar-tutor/auth-secret
         └── OpenAI API (chat completions + embeddings)

Background lambdas (EventBridge schedules)
   • staar-pool-topup    (rate(1 hour))   STATE = DISABLED ⚠
   • staar-quality-patrol (cron(0 8 * * ? *))  STATE = DISABLED ⚠

Both background jobs are intentionally disabled (Phase 0 of the build plan
above). Texas reading-passages feature is BLOCKED until pool-topup is
re-enabled with the Phase 1 generators.js refactor in place.
```

### Active GradeEarn DynamoDB tables (us-east-1)
`staar-users`, `staar-stats`, `staar-toys`, `staar-orders`, `staar-friends`,
`staar-messages`, `staar-content-pool`, `staar-explanations`,
`staar-content-events`, `staar-tutor-responses`.

No PITR (point-in-time-recovery) confirmed yet — that is a Phase 6 reliability
deliverable.

---

## 8. Single source of truth: `js/states-data.js`

`window.STATES` is a 51-element array (50 states + DC). Lives in
`js/states-data.js` (1466 lines). Owner-mandated: **anywhere else in the
codebase that needs state metadata, derive it from this file. Do not
duplicate the table in another module.** This is the contract being enforced
by Phase 1 (kill `STATE_PROMPTS` in generators.js) and Phase 2 (replace
Lambda `STATE_METADATA` with a JSON snapshot built from this file at
build time, with a hash check).

### Schema (verified per-record on disk 2026-05-02)
```js
{
  slug: 'alabama',                 // URL slug, lowercase, hyphenated
  name: 'Alabama',
  nameAbbr: 'AL',

  testName: 'ACAP',                // short test acronym shown in UI
  testFullName: 'Alabama Comprehensive Assessment Program',
  testAuthority: 'Alabama State Department of Education',
  testAuthorityShort: 'ALSDE',
  testAuthorityUrl: 'https://www.alabamaachieves.org/',

  standards: 'Alabama Course of Study',   // added in commit b9eca24, all 51 records

  gradesTested: ['grade-2','grade-3',…],  // flat list of all grades the state tests in
  // gradesTestedBySubject: { math: [...], reading: [...], science: [...], 'social-studies': [...] }
  // ↑ NOT in the source literal — attached at runtime by an IIFE around line 1326.
  //   Texas hand-tuned (e.g. science=['grade-5','grade-8'], social-studies=['grade-8']).
  //   Other 50 states derived from gradesTested. Read via gradesForState(slug, subject)
  //   in scripts/cold-start/states-grades.js. See §0 #3.
  testWindow: 'April',
  testWindowMonth: 4,

  description: '…',
  whatItCovers: 'Math, English Language Arts, and Science.',

  subjectsAvailable: SUBJECTS_DEFAULT,           // = ['math','reading']
  subjectsComingSoon: SUBJECTS_COMING_SOON_DEFAULT, // = ['science','social-studies']

  customNotes: null,
  seoTitle: '…',
  seoDescription: '…',
  curriculumOverrideKey: null,
  features: {},
  pricing: null,
  active: true,
}
```

Two shared constants at the top of the file:
```js
var SUBJECTS_DEFAULT = ['math', 'reading'];
var SUBJECTS_COMING_SOON_DEFAULT = ['science', 'social-studies'];
```
Most states share these by reference — change them in one place to flip
defaults globally.

---

## 9. Build plan (Hamid-approved, 2026-04-27)

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Disable background EventBridge rules to stop active bleed | ✅ DONE | `staar-pool-topup-hourly` and `staar-quality-patrol-daily` both verified DISABLED |
| 1 | Refactor cold-start `scripts/cold-start/generators.js`: drop STATE_PROMPTS, drop Texas fallback, throw on unknown state | ✅ DONE | Landed in `a1730a5`. Verified 2026-05-02. See §0 #1. |
| 2 | Backend lambda refactor: (a) port the Phase 1 fix into `lambda/pool-topup/generators.js` (kill STATE_PROMPTS + Texas fallback there too); (b) replace lambda `STATE_METADATA` with a build-time JSON snapshot of `states-data.js` (with hash check) so the lambda has a single source of truth for state metadata | 🟥 NOT STARTED | See §0 #2. Lambda cannot `require()` the frontend file — needs a snapshot. |
| 3 | Kill 4 retired-product surfaces (toolintel, StarTest residue, ReplyQuik AppRunner+widget, WealthDeskPro pricing.js+SES) | ⏳ pending | Detail in §6. Aggressive delete, NOT _legacy/ folder |
| 4 | Legal cover: COPPA-compliant signup with age gate + parental consent, ToS, privacy policy, field-level encryption for parent PII, attorney review at end | ⏳ pending | COPPA + FERPA real risk: kids under 13, real money via toy redemption, shipping addresses in `staar-orders` |
| 5 | AI review system: LLM-as-judge as permanent batch validator on every sweep bucket, $0.50/sweep cost cap, semantic checks for state-flavor + age + factual accuracy, drift detection on live lake daily | ⏳ pending | AI-only review — no humans in the loop |
| 6 | Reliability infra: deploy.sh (backup-first + dry-run + uncommitted-changes guard), ROLLBACK.md, CloudWatch alarms + SNS-to-email, DynamoDB PITR on all 5+ tables, Lambda versioning + prod alias, IAM cleanup off root | ⏳ pending | Critical: ~started this pass but pivoted to CLAUDE.md reconcile; resume next |
| 7 | Run actual sweeps (math + reading) with all rails in place | ⏳ pending | Texas reading-passages is the headline blocker |

---

## 10. Decisions already made (do not re-litigate)

- DBA filing handled via SOSDirect (Texas Secretary of State).
- Content lives in the lake only (DynamoDB `staar-content-pool` etc.).
  Static curriculum JSON in `/data/` is fallback / seed only.
- No human review tool on the roadmap — AI-only validation (LLM-as-judge).
- Aggressive deletion for retired-product code (NOT a `_legacy/` quarantine
  folder). Git history is the archive.
- Brand: navy + gold. **No teal / cyan / green.** Mobile-first. Premium
  understated.
- House style is vanilla HTML/CSS/JS. No bundler, no TS, no framework.

---

## 11. Open hygiene items

- **Git identity:** the last 30+ commits on `main` are authored
  `Bob <bob@Bobs-Mac-mini.local>` — needs the global git user fixed before
  any future push, and ideally an `--author` rewrite of recent commits
  before the next push.
- **Working tree:** clean except two untracked cold-start scripts
  (`scripts/cold-start/sweep-math.sh`, `scripts/cold-start/tombstone-legacy.js`).
  These run real DynamoDB scans/updates and source `/tmp/.openai_env`.
- **Stranded `states-data.js` commits 2–5** (claimed in handoff) are not on
  disk. Either they exist only in memory or they were never written. The
  one commit that did land is `b9eca24` (standards field on all 51).
- **AWS root credentials in use** (`Arn: iam::860141646209:root`). Phase 6
  includes "IAM cleanup off root" — until that lands, ANY local AWS call
  has full account permissions.
- **No `.env.example`** at repo root. A scaffolded one was started this
  session at `lambda/.env.example` — review it before relying on it.

---

## 12. Risk surface (high-priority)

1. **`tutor-build/` is gitignored AND is the source for the deployed lambda.**
   No code review on changes there. Phase 6 deploy.sh must guard against this.
2. **Children's data + redeemable currency.** COPPA / FERPA exposure on
   `staar-users`, `staar-orders` (shipping addresses), `staar-messages`,
   parent-consent flow. Lifetime cap $100 in `tutor.js` is the only built-in
   guard. Phase 4 is the legal cover.
3. **Auth token in `localStorage`** + **third-party `replyquik` widget loaded
   on every page including `admin.html`** = token-exfiltration path. Killing
   the widget is part of Phase 3.
4. **DynamoDB has no PITR** confirmed. A bad lambda + a destructive bug =
   permanent data loss for live testers. Phase 6 fix.
5. **No CloudWatch alarms / SNS / on-call.** Phase 6.
6. **No deploy script and no rollback** — phase 6, in flight.
7. **`pricing.js` SES tripwire** — see §6d. Dormant today, alive the moment
   the zombie API gets a request.
8. **Service worker pre-caches `/js/*.js` paths without query-string
   versions.** Once a kid's PWA caches old scripts, only a `CACHE_VERSION`
   bump can refresh them. Be deliberate about SW updates.

---

## TOP 3 THINGS YOU SHOULD KNOW

1. **The deploy story is held together by tape and is the single biggest
   reliability risk.** Frontend = `git push origin main` (no preview, no
   rollback besides revert commits). Backend = manually copy `tutor.js`
   into a gitignored `tutor-build/` directory, manually `zip`, manually
   `aws lambda update-function-code`. The `lambda/tutor-build/` dir is
   gitignored, so changes there bypass code review. Today's verified state:
   the local `tutor.js` is +321 / −5 lines ahead of what's deployed; the
   deployed lambda still says "StarTest" in the system prompt to ~20 real
   kids. Phase 6 fixes all of this and was actively in flight when this
   pass started.

2. **Phase 2 — not Phase 1 — is the actual cold-start blocker.**
   Phase 1 (cold-start CLI `scripts/cold-start/generators.js`) shipped in
   `a1730a5` and is verified clean. The remaining work lives in
   `lambda/pool-topup/generators.js`, which still has `STATE_PROMPTS`, still
   has `STATE_PROMPTS[stateSlug] || STATE_PROMPTS.texas` (line 39), and still
   doesn't throw on unknown state. Texas reading-passages is blocked until
   this lambda refactor lands AND `staar-pool-topup-hourly` is re-enabled in
   EventBridge (it was disabled in Phase 0). Don't re-enable the rule before
   the refactor — it will silently fall back to Texas for every other state.

3. **Three retired products are still live in AWS or the page bundle.**
   ReplyQuik (two AppRunner services RUNNING + a JS widget loaded on
   every gradeearn.com page including admin), WealthDeskPro
   (`pricing.js` SES wired to send from `wealthdeskpro@gmail.com` to
   Hamid's personal inbox — currently dormant only because the zombie API
   has zero traffic), and ToolIntel (23 lambdas + a whole second API
   Gateway). All of this needs to die in Phase 3 before the COPPA / legal
   work in Phase 4 can credibly claim a clean surface.
