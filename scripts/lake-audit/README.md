# scripts/lake-audit/

**READ-ONLY** scripts that scan `staar-content-pool` for cleanup candidates.
**No script in this directory ever deletes or updates production data.**
Deletion (a "tombstone" or hard-delete pass) lives in a separate, deliberately-
named script per cleanup phase, in a separate commit, after a human reviews
the audit JSON output here.

---

## audit-judge-existing-rows.js

Walks every `status='active'` row in `staar-content-pool` through the
cold-start Question Sanity Judge (`scripts/cold-start/judge.js`) and
classifies pass / reject. Writes per-row classification + summary to
`output/judge-audit-<UTC-timestamp>.json`. **READ-ONLY by construction**:
imports only `ScanCommand`; never imports `PutCommand`, `UpdateCommand`,
or `DeleteCommand`.

Catches the AMBIGUITY / MULTIPLE_CORRECT / STATE_LEAK / FACTUAL etc.
contamination class that pre-dates the writer-side judge wiring
(cold-start gate landed in commit `5e66a4f`; lambda gate landed in
`405b613`).

### Run

```sh
OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
    --secret-id staar-tutor/openai-api-key \
    --query SecretString --output text) \
  node scripts/lake-audit/audit-judge-existing-rows.js [--limit N] [--fresh]
```

Flags:
- `--limit N` — process only the first N active rows (smoke / spot-check).
- `--fresh` — delete the resume state file before starting.
- `--help` — print usage and exit.

Env vars:
- `OPENAI_API_KEY` (required)
- `JUDGE_AUDIT_MAX_CALLS` (default = active count + 50; throws if exceeded)

### Sequential, predictable cost

One judge call at a time. With `JUDGE_MODEL = 'gpt-4o'` (per CLAUDE.md
§27 retrospective): ~250 input + 150 output tokens per call ≈ $0.002 per
row. Full lake audit (~2000 rows) ≈ **$4** + ~30-60 minutes wall-clock.

### Resumable

Writes `output/judge-audit-state.json` every 100 rows. On crash,
re-running picks up where it left off (skips already-processed
contentIds). Clean completion (no `--limit`) writes the final
timestamped JSON and deletes the state file.

### Type branching

Rows with `type: undefined` (legacy cold-start) are normalized at audit
time: choices array → `multiple_choice`; non-empty answer string with
no choices → `numeric`. The judge's `inferType` reads the same shape.
Numeric rows skip MULTIPLE_CORRECT and ANSWER_LANGUAGE (per the §27
type-aware SYSTEM_PROMPT branch); multi-choice evaluates against all 7.

### Output JSON shape

```jsonc
{
  "summary": {
    "totalActive": 2010,
    "totalJudged": 2010,
    "totalPass": 1900,
    "totalReject": 110,
    "estimatedCostUSD": 4.02,
    "rejectsByCheck": { "FACTUAL": 60, "AMBIGUITY": 20, ... },
    "rejectsByState": { "alabama": 18, "texas": 12, ... },
    "rejectsByType": { "multiple_choice": 90, "numeric": 20 }
  },
  "rejects": [
    {
      "contentId": "...", "poolKey": "...", "state": "...",
      "subject": "...", "grade": "...", "type": "...",
      "questionExcerpt": "first 200 chars",
      "choices": [...] | null, "correctIndex": N | null,
      "answer": "..." | null,
      "failedChecks": ["FACTUAL"],
      "reasons": ["..."]
    }
  ]
}
```

Passes are NOT in the output (would bloat). Only rejects + summary
counts are written.

### What to do after reviewing the output

This script does not delete. Tombstone of judge-audit rejects is its
own future commit. Per the §22 lesson: ship a restore script in the
same commit, dry-run-first, branch on type, and do NOT auto-tombstone
without manual review of a sample.

---

## audit-texas-fallback.js

Scans every row in `staar-content-pool` and flags suspects against 8 heuristics
documented below. Writes per-row classification + summary to
`output/audit-<UTC-timestamp>.json`. Read-only — does not call any DynamoDB
write API.

### Run

```sh
cd scripts/lake-audit
npm install                  # first time only — installs @aws-sdk/* deps
node audit-texas-fallback.js # ~20-30s for ~12k rows; cost <$0.02 in RCU
```

Requires the same AWS credentials your terminal session has (via
`aws configure` or env vars). Reads `us-east-1`, table
`staar-content-pool`. Both are hardcoded — change in the source if you
ever need to point at a non-prod table.

### Heuristics

| # | Key | What it catches |
|---|---|---|
| 1 | `STATE_LEAK_TEXAS` | Non-Texas row whose `question` / `explanation` / `passage.text` mentions Alamo, San Antonio, Houston, Dallas, Austin, "Texas", or `STAAR` (case-sensitive on STAAR to reduce noise). The original Texas-fallback-bug damage. |
| 2 | `STATE_LEAK_CALIFORNIA` | Non-CA row mentioning California, Sacramento, Los Angeles, CAASPP, or "Smarter Balanced". |
| 3 | `STATE_LEAK_FLORIDA` | Non-FL row mentioning Tallahassee, Miami, FAST (case-sensitive), or B.E.S.T. |
| 4 | `STATE_LEAK_NEW_YORK` | Non-NY row mentioning New York City, Regents, or NYC. |
| 5 | `STANDARDS_LEAK` | Row mentions `\bTEKS\b` but state is not texas. |
| 6 | `TEST_NAME_LEAK` | Row says "STAAR test" / "STAAR exam" / "STAAR assessment" but state is not texas. |
| 7 | `PROMPT_VERSION_LEGACY` | `promptVersion` is `cold-v0`, `cold-v1`, `cold-v1-regen`, or missing. (Pre-`a1730a5` cold-start versions had the silent Texas fallback. Anything `cold-v2`+ or `v1` / `reading-v1` (lambda) is fine.) |
| 8 | `MISSING_REQUIRED_FIELDS` | Row is missing one or more of: `question`, `choices` (array length ≥ 2), `correctIndex` (number), `state`. Indicates a broken row that would fail to render if served. |

### Output JSON shape

```jsonc
{
  "summary": {
    "totalScanned": 12238,
    "totalSuspect": 10335,
    "suspectFraction": 0.8445,
    "breakdownByHeuristic": { "PROMPT_VERSION_LEGACY": 10335, "STATE_LEAK_TEXAS": 504, "MISSING_REQUIRED_FIELDS": 186 },
    "breakdownByStateTop10": { "florida": 1986, "arkansas": 1558, ... },
    "breakdownByPromptVersion": { "cold-v1": 10149, "missing": 186 },
    "breakdownByStatus": { "deprecated": 10149, "active": 186 },
    "elapsedMs": 20985,
    "startedAt": "2026-05-03T00:14:06.163Z",
    "tableName": "staar-content-pool",
    "region": "us-east-1"
  },
  "suspects": [
    {
      "contentId": "q_0mohcah42_6f9bf1e0ea46",
      "poolKey": "alaska#grade-6#math#teks-concept",
      "state": "alaska",
      "subject": "math",
      "grade": "grade-6",
      "questionType": "concept",
      "promptVersion": "cold-v1",
      "generatedBy": "cold-start-v1",
      "generatedAt": 1777302955298,
      "status": "deprecated",
      "reviewStatus": "unreviewed",
      "tombstonedAt": 1777313316787,
      "questionExcerpt": "Sophia has a garden in her backyard...",
      "explanationExcerpt": "To find the area of the whole garden...",
      "matches": [
        { "heuristic": "PROMPT_VERSION_LEGACY", "hits": ["cold-v1"] }
      ]
    },
    ...
  ]
}
```

### How to interpret a suspect row

1. **Look at `status` first.**
   - `deprecated` → row is not served to kids; it's been tombstoned. Cleanup question is whether to hard-delete to reclaim storage.
   - `active` → row IS served to kids. Higher urgency — these are the ones to fix or kill first.

2. **Look at `matches[].heuristic`.**
   - `PROMPT_VERSION_LEGACY` alone on a deprecated row → expected residual from prior tombstone-legacy.js pass; safe-to-hard-delete category.
   - `STATE_LEAK_*` on a deprecated row → confirms the original Texas-fallback bug; same safe-to-delete category.
   - `MISSING_REQUIRED_FIELDS` on an active row → broken content currently being served; investigate why the writer (likely `lambda/tutor.js#handleGenerate`) is producing rows without `correctIndex`.

3. **Cross-reference `breakdownByState`.** A heavy concentration on one state may indicate a single bad sweep; a flat distribution suggests a writer-path bug.

### What to do after reviewing the output

This script does not delete. The next phase is a separate `tombstone-*.js`
script (or hard-delete script) that takes the audit JSON as input and
operates on a curated subset. That phase is its own deliberate commit
after Hamid reviews the audit results. See CLAUDE.md §20.

---

## tombstone-active-broken.js

Flips `status: active` → `status: broken` on rows the audit identified as
`MISSING_REQUIRED_FIELDS` AND `status: active`. **Writes to production** but
only updates a status field — **never hard-deletes**, fully reversible by
the inverse update.

### Run

```sh
# Dry-run (default — no writes; logs what it WOULD do)
node scripts/lake-audit/tombstone-active-broken.js

# Apply for real (requires explicit flag)
node scripts/lake-audit/tombstone-active-broken.js --apply
```

### Safety

- **DRY-RUN by default.** No `--apply` flag → no writes.
- **Per-row re-fetch.** Before any UpdateItem, GetItem to confirm the
  current state still matches what the audit recorded. If concurrent
  writes changed the row, skip with a logged reason.
- **`type: numeric` defensive check (added after the 2026-05-03
  incident).** Refuses to tombstone any row whose `type` is `numeric` —
  numeric questions legitimately have `correctIndex: null` and
  `choices: null`. Without this gate, an old audit JSON with the
  pre-fix MISSING_REQUIRED_FIELDS heuristic would repeat the original
  incident.
- **`ConditionExpression` on UpdateItem.** Refuses to overwrite if state
  drifted between the GetItem and the UpdateItem. Concurrent writes by
  any other path (lambda, judge, etc.) cannot be silently overwritten.
- **Sequential.** Not parallel. ~10s for 200 rows. Speed isn't the goal,
  safety is.
- **Retry with exponential backoff** on throttle / 5xx (3 attempts at
  100ms / 400ms / 1600ms). Past 3, log and skip.
- Per-row log line: `[tombstone] contentId=<id> state=<s> action=<...>`.
- Final summary printed + dumped to
  `output/tombstone-<UTC-timestamp>.json` for incident audit.

### Reversal

Every UPDATED row got `tombstoneReason='active_missing_correctIndex_fixed_by_writer_2026-05-03'`.
To restore them, write the inverse update keyed on the same contentIds:

```sh
# (See restore-falsely-tombstoned-numeric.js for the pattern, used in
#  the 2026-05-03 incident to restore 89 rows.)
```

---

## restore-falsely-tombstoned-numeric.js

**One-off incident script** from the 2026-05-03 over-tombstone incident.
Reads `/tmp/touched-numeric.json` (a list of contentIds produced during
incident triage), and for each row that's currently `status: broken` with
the matching `tombstoneReason`, flips it back to `status: active` and
removes the tombstone metadata.

This is preserved as the canonical pattern for "undo a tombstone" — copy
it for any future restore. Not intended to be re-run; the input file is
ephemeral.

### Safety

Same shape as the tombstone script: dry-run by default, per-row re-fetch
+ ConditionExpression so we only flip back the rows we actually
tombstoned with the matching reason. Refuses to touch rows that aren't
type=numeric (we never want to accidentally restore the 97 genuinely
broken multi-choice rows).

---

## hard-delete-tombstoned.js

Permanently `DeleteItem` rows from `staar-content-pool` matching one of two
well-defined categories. **Writes to production. Reversible only via PITR**
(35-day window — see `restore-hard-deleted-from-pitr.md` for the runbook).

### Run

```sh
# Dry-run on a specific category
node scripts/lake-audit/hard-delete-tombstoned.js --category=tombstoned-broken-mc

# Apply for real
node scripts/lake-audit/hard-delete-tombstoned.js --category=tombstoned-broken-mc --apply

# Both categories in one run (default)
node scripts/lake-audit/hard-delete-tombstoned.js --apply
```

### Categories

- **`deprecated-cold-v1`** — `status='deprecated' AND promptVersion='cold-v1'`.
  ~10,149 legacy rows from the Texas-fallback era. Already filtered out at
  read time (status=deprecated → never served). Hard-deleting reclaims
  storage and erases the 504 confirmed Texas-leak rows for good.
- **`tombstoned-broken-mc`** — `status='broken' AND tombstoneReason=<§22 reason> AND type='multiple_choice'`.
  The 97 broken multi-choice rows tombstoned after the writer-bug fix.
  Genuinely malformed (missing `correctIndex`, garbage letter-label choices).
- **`both`** — default. Deletes both categories in one run.

### Safety contract (every guardrail)

- **DEFAULT mode is DRY-RUN.** Requires `--apply` to delete.
- **PITR precondition:** the script REFUSES to `--apply` if PITR is not
  ENABLED on `staar-content-pool` (exit code 2 with explicit instructions).
  Hard-delete without PITR = no recovery path. Don't.
- **Re-fetches every target via DynamoDB scan with the LIVE filter** before
  each batch. Never trusts a cached/stale list.
- **Per-row safety re-check** before adding to a delete batch. For
  `tombstoned-broken-mc`: row must STILL be `status=broken AND type=multiple_choice
  AND tombstoneReason matches`. If anything diverged (e.g., concurrent write
  flipped status), the row is SKIPPED with a logged reason.
- **Defensive type check** specifically for `tombstoned-broken-mc`: refuses
  to delete anything whose type isn't `multiple_choice` even if the live
  filter returned it. Belt-and-suspenders against the §22 incident class.
- **`BatchWriteItem` 25 rows max per request.** Sequential batches (not
  parallel) — speed isn't the goal, safety is.
- **Two-tier throttle handling** (added after the first Cat 1 run hit a
  GSI throttle mid-run):
  1. SDK-level `ThrottlingException` / `ProvisionedThroughputExceededException` /
     `RequestLimitExceeded` / 5xx — retry the entire `BatchWriteCommand`
     with exponential backoff: 200ms / 800ms / 3.2s / 10s (4 attempts after
     the initial). Beyond that, throw and abort.
  2. Per-item `UnprocessedItems` in a successful response — retry just
     those at 100ms / 400ms / 1600ms (3 attempts).
- Per-row log: `[hard-delete] contentId=<id> state=<s> category=<cat> action=<dry-run-would-delete|DELETED|SKIPPED:reason>`
- Per-batch log: `[hard-delete] batch <n>/<total> sent=<N> deleted=<N> unprocessed=<N>`
- Output JSON at `output/hard-delete-<UTC>.json` with full per-row results.

### Cost

DynamoDB on-demand DeleteItem ≈ 1 WCU per KB. Our rows are ~16 KB each
(with embeddings). Upper bound for 10,246 rows = 164k WCU = **$0.21**.
Functionally free.

### Recovery if you regret a deletion

`restore-hard-deleted-from-pitr.md` in this same directory documents the
5-step PITR-based recovery (restore to side table → identify deleted
contentIds from the hard-delete output JSON → surgical PutItem back into
live → verify → drop side table). Window: 35 days from deletion.

---

## Future scripts in this directory

The convention here:

- `audit-*.js` — read-only scans that produce JSON reports
- `tombstone-*.js` — soft-delete (sets `status: deprecated`, idempotent)
- `hard-delete-*.js` — permanent removal (DeleteItem) — only for already-deprecated rows, never live ones
- `output/` — gitignored (large JSON dumps)

Every script in this directory is required to:
1. Print exactly which DynamoDB API operations it will perform before any work
2. Default to dry-run; require an explicit `--apply` flag for any write
3. Log the contentId of every row it modifies (for incident audit)
4. Refuse to delete any row whose `status` is `active`
