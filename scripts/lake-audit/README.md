# scripts/lake-audit/

**READ-ONLY** scripts that scan `staar-content-pool` for cleanup candidates.
**No script in this directory ever deletes or updates production data.**
Deletion (a "tombstone" or hard-delete pass) lives in a separate, deliberately-
named script per cleanup phase, in a separate commit, after a human reviews
the audit JSON output here.

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
