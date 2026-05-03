# ROLLBACK — staar-tutor lambda

If a deploy from `./deploy.sh` ships something that breaks production, this is
how you get back to a known-good state in under 90 seconds.

---

## 1. WHEN TO ROLLBACK

**Roll back immediately if you see any of these after a deploy:**

- 5xx spike on the `/tutor` endpoint (CloudWatch metric: `4XXError` or `5XXError`)
- Live testers report broken practice flow ("Check answer doesn't work", "AI tutor never replies")
- AI tutor replies returning empty strings or `null`
- Judge throwing on every question (cold-start sweep stops cold; lambda logs show repeated `JudgeRejectedTwiceError` or OpenAI 400s)
- End-of-set screen returns 500 instead of the summary
- Login or signup actions returning 500 (auth path broke)
- Any practice-page action consistently returning errors that worked before the deploy

**Decision rule:** if you are not sure, **roll back**. Forward-fixing under
pressure takes longer than rolling back and figuring out the issue calmly.
The backup zip is right there. Use it.

You always have a backup — `deploy.sh` makes one BEFORE every deploy.

---

## 2. ONE-LINER ROLLBACK

The exact command was printed at the bottom of your `deploy.sh` output.
Copy-paste that. The shape is:

```sh
aws lambda update-function-code \
  --function-name staar-tutor \
  --zip-file fileb://backups/staar-tutor-<timestamp>-<sha8>.zip
```

After that command lands:

```sh
# Wait for AWS to mark the function Active again
aws lambda wait function-updated --function-name staar-tutor

# Confirm the rollback took
aws lambda get-function-configuration \
  --function-name staar-tutor \
  --query '[CodeSha256,LastModified]' \
  --output text
```

The `CodeSha256` should now match the value embedded in the backup filename
(after the timestamp). Match = rollback succeeded.

**Pick the right backup.** Backups are named with a UTC timestamp + the
first 8 chars of the deployed `CodeSha256` they captured. Most recent backup
is usually the right one (it captured production right before the deploy
that broke things). If multiple deploys happened in the same incident
window, grab the *oldest* backup that still represents a known-good state:

```sh
ls -lt backups/staar-tutor-*.zip
```

---

## 3. WORST CASE — no backup available

If `backups/` is empty (you somehow deployed without using `deploy.sh`,
or the backups were deleted), recovery is harder but still possible.
Pick whichever path applies:

### 3a. The lambda has Versions enabled

```sh
aws lambda list-versions-by-function --function-name staar-tutor \
  --query 'Versions[*].[Version,LastModified,CodeSha256]' --output table
```

Then point the prod alias (or just direct calls) at the prior version:

```sh
# If using an alias (recommended; not yet set up — see CLAUDE.md §14)
aws lambda update-alias --function-name staar-tutor --name prod --function-version <N>
```

This is the fastest recovery if Lambda versioning is in place. As of
May 2 it isn't — adding it is in CLAUDE.md §14 deferred TODOs.

### 3b. The lambda has CloudWatch Logs (always true)

Logs preserve invocation traces but **not the deployed code**. Logs help
you understand *what* broke; they do not restore the prior code.

### 3c. Re-deploy from the last known-good git commit

The current deploy artifact source is `lambda/tutor-build/tutor.js`. After
commit `673db25` it's in parity with `lambda/tutor.js` and has been
since the May 2 work. To recover the previous code:

```sh
# Find the commit that landed before the bad deploy
git log --oneline lambda/tutor-build/tutor.js | head -10

# Check out a temporary worktree pinned to that commit
git worktree add /tmp/gradeearn-rollback <commit-sha>

# Re-deploy from that worktree (manually, since deploy.sh would re-deploy
# from the dirty current state)
cd /tmp/gradeearn-rollback
zip -rq /tmp/rollback.zip lambda/tutor-build/
aws lambda update-function-code \
  --function-name staar-tutor \
  --zip-file fileb:///tmp/rollback.zip

# Then clean up
git worktree remove /tmp/gradeearn-rollback
```

This is the slowest path. It works because every commit in this repo's
history of `lambda/tutor-build/tutor.js` represents a deployable state
(post-`673db25` parity). Avoid relying on this — use backups.

### 3d. Last resort: contact OpenAI / AWS support

If the lambda is wedged so badly it won't even invoke (e.g. the new code
crashes on cold start with a SyntaxError), nothing above helps. AWS support
can sometimes recover prior versions from internal snapshots. Have your
account ID ready (`860141646209`) and the function name (`staar-tutor`).

---

## 4. Restore a DynamoDB table via PITR

**When to use:** catastrophic data loss on a `staar-*` table — mass deletion,
table-wide bad write, a buggy script that touched too many rows, the kind
of incident where the in-place "flip status back" undo we used in §22 of
CLAUDE.md doesn't scale because the damage is too broad or too time-sensitive
to enumerate row-by-row.

**Window:** PITR keeps every change for the last 35 days (DynamoDB's fixed
retention). Earliest restorable timestamp varies per table — see CLAUDE.md
§23 for the as-enabled date per table.

**What PITR can and cannot do:**
- ✅ Restore to a NEW table at ANY second within the 35-day window
- ✅ Granular: restore to e.g. `2026-05-03T03:00:00Z` (one second before
  the bad write) and inspect the state
- ❌ Cannot restore IN PLACE — must restore to a new table name
- ❌ Cannot restore individual rows — it's a whole-table operation
- ❌ Restored table starts with PITR DISABLED — re-enable on it before relying

### The 5-step restore

```sh
# 1. Find the earliest restorable timestamp for this table
aws dynamodb describe-continuous-backups --table-name staar-content-pool \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.EarliestRestorableDateTime' \
  --output text

# 2. Pick a target time. Use the timestamp just BEFORE the bad write.
#    For incident triage: check CloudWatch logs to find the exact moment
#    the bad write happened, then choose target = bad_write_time - 1s.
TARGET=2026-05-03T03:00:00Z
SRC=staar-content-pool
DST=staar-content-pool-restored-$(date -u +%Y%m%dT%H%M%SZ)

# 3. Kick off the restore. Returns immediately; restore runs in the background.
aws dynamodb restore-table-to-point-in-time \
  --source-table-name "$SRC" \
  --target-table-name "$DST" \
  --restore-date-time "$TARGET"

# 4. Wait for the restored table to become Active (can take 10s of minutes
#    for tables in the GBs; staar-content-pool at ~200MB is a few minutes)
aws dynamodb wait table-exists --table-name "$DST"
aws dynamodb describe-table --table-name "$DST" \
  --query 'Table.{Status:TableStatus,ItemCount:ItemCount,Size:TableSizeBytes}' \
  --output json

# 5. Sanity-check restored contents BEFORE cutting over
aws dynamodb scan --table-name "$DST" --select COUNT --output json | jq '.Count'
# Spot-check a row that you know was healthy at the target time:
aws dynamodb get-item --table-name "$DST" \
  --key '{"poolKey":{"S":"texas#grade-3#math#teks-3.4a"},"contentId":{"S":"<known-good-id>"}}' \
  --output json
```

### Cutting over to the restored table

Two patterns; pick based on urgency vs cleanliness:

**Pattern A — fast, requires lambda redeploy:**
1. Update the lambda's `POOL_TABLE` env var (or constant in code) to point
   at the restored table name
2. Redeploy the lambda via `./deploy.sh`
3. Verify reads/writes hit the new table
4. Delete the old (broken) table once you're confident: `aws dynamodb delete-table`

**Pattern B — transparent to the lambda, slower:**
1. Copy data back from the restored table to the original table via
   `aws dynamodb scan` + `aws dynamodb batch-write-item` (or via DynamoDB
   Streams + a one-off Lambda)
2. Verify counts match
3. Delete the restored table once original is confirmed good

Pattern A is faster (~5-15 min total). Pattern B is more transparent (the
lambda doesn't need to know anything happened) but takes longer for tables
with many rows.

### After restore

1. **Re-enable PITR on the restored table.** Restored tables start
   PITR-disabled by default:
   ```sh
   aws dynamodb update-continuous-backups --table-name "$DST" \
     --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
   ```
2. Add an entry to the rollback log below.

### Cost of a restore

The restore operation itself is free. Storage of the restored table costs
the standard $0.25/GB-month. Old + new running in parallel doubles your
storage cost briefly; cheaper than the alternative of permanent data loss.

---

## Where backups live

```
/Users/bob/clawd/toolintel/backups/
  staar-tutor-20260502T143022Z-Viiox+Y1.zip
  staar-tutor-20260503T091547Z-AbCdEfGh.zip
  …
```

`backups/*.zip` is gitignored (the parent `*.zip` pattern in `.gitignore`
covers it). Files stay local. **Don't commit them — they contain the
production lambda code including embedded helpers.**

Keep at least the last 5 backups. Delete older ones manually when the
directory gets noisy.

---

## After a rollback

1. Note in your incident log: when, what broke, which backup you rolled to.
2. Investigate the broken deploy from the new zip in `build/<fn>-<timestamp>.zip` — that's still on disk for you to inspect.
3. Fix the bug locally, run `./deploy.sh` again. The fresh deploy makes its own backup of the now-rolled-back state, so you can roll forward and back without losing the chain.

---

## Rollback log (append entries here)

```
<date-utc>  <function>  <bad-deploy-sha8>  →  <restored-from-sha8>  <one-line-cause>
```

(Empty so far — first incident gets the first row.)
