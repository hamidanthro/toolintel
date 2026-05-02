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
