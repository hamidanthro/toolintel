# Restoring rows that `hard-delete-tombstoned.js` deleted

You ran `hard-delete-tombstoned.js --apply` and now want some (or all) of
the deleted rows back. This is the runbook.

The deletion was permanent at the row level — DeleteItem doesn't keep
versions. But DynamoDB **PITR** (CLAUDE.md §23) keeps the entire table's
state for the last 35 days. You can't selectively un-delete; you can only
restore the whole table to a point in time and then surgically copy the
rows you want back into the live table.

This is exactly **Pattern C** in `ROLLBACK.md §4` ("partial copy-back for
targeted damage"). The 35-day window means: if it's been more than 35
days since the deletion, **the rows are gone forever** — PITR can't help.

---

## When to use this

- You ran `hard-delete-tombstoned.js --apply` and either (a) it deleted
  more than expected, (b) you realized a category filter was wrong, or
  (c) some downstream consumer surfaces a need for those rows.
- The deletion was within the last 35 days.

If (b) is the case (filter was wrong), ALSO investigate whether
additional rows are at risk; this runbook only handles the rows already
deleted.

---

## What you can't do

- **No selective PITR restore.** PITR restores the whole table to a
  timestamp; you can't say "give me back just contentId X."
- **No in-place restore.** PITR restore creates a NEW table. You must
  use one of the cut-over patterns to get rows back into the live table.
- **No restore beyond 35 days.** That window is fixed by AWS. After 35
  days, deleted rows are gone for good.

---

## What you can do (the 5 steps)

### 1. Find the timestamp BEFORE the deletion

The hard-delete output JSON has `startedAt` for the deletion run.
Pick a target time **just before** that timestamp (e.g. 1 minute earlier).

```sh
# Most recent hard-delete output
LATEST=$(ls -t scripts/lake-audit/output/hard-delete-*.json | head -1)
jq -r '.startedAt' "$LATEST"
# e.g.  2026-05-03T04:15:00.000Z

# Pick TARGET = 1 minute before
TARGET=2026-05-03T04:14:00Z

# (Optional sanity-check: PITR has the timestamp covered)
aws dynamodb describe-continuous-backups --table-name staar-content-pool \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.EarliestRestorableDateTime' \
  --output text
```

### 2. Restore to a side table

```sh
SRC=staar-content-pool
DST=staar-content-pool-restored-$(date -u +%Y%m%dT%H%M%SZ)

aws dynamodb restore-table-to-point-in-time \
  --source-table-name "$SRC" \
  --target-table-name "$DST" \
  --restore-date-time "$TARGET"

# Returns immediately; restore runs in the background. Wait for Active:
aws dynamodb wait table-exists --table-name "$DST"
aws dynamodb describe-table --table-name "$DST" \
  --query 'Table.{Status:TableStatus,ItemCount:ItemCount,Size:TableSizeBytes}' \
  --output json
```

For a ~200 MB table, restore takes a few minutes.

### 3. Identify the deleted contentIds

The hard-delete output JSON logs every contentId that was DELETED.
Extract them:

```sh
jq -r '.perCategory[].results[] | select(.action == "DELETED") | "\(.poolKey)\t\(.contentId)"' \
  scripts/lake-audit/output/hard-delete-<UTC>.json \
  > /tmp/deleted-keys.tsv
wc -l /tmp/deleted-keys.tsv
```

### 4. Surgical copy-back (per-row, sequential)

For each `(poolKey, contentId)` pair, GetItem from the side table,
PutItem back into the live table. **Sequential, with a Condition that
the live row does not currently exist** — refuses to overwrite anything
written to the live table since the deletion.

```js
// scripts/lake-audit/restore-from-side-table.js (write this on demand)
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const SRC = 'staar-content-pool-restored-<utc>';
const DST = 'staar-content-pool';
const keys = require('fs').readFileSync('/tmp/deleted-keys.tsv', 'utf8')
  .trim().split('\n').map(l => { const [pk, cid] = l.split('\t'); return { poolKey: pk, contentId: cid }; });

(async () => {
  let restored = 0, skipped = 0, missing = 0;
  for (const k of keys) {
    const r = await ddb.send(new GetCommand({ TableName: SRC, Key: k }));
    if (!r.Item) { missing++; console.warn(`[restore] ${k.contentId} not in side table`); continue; }
    try {
      await ddb.send(new PutCommand({
        TableName: DST,
        Item: r.Item,
        ConditionExpression: 'attribute_not_exists(contentId)'
      }));
      restored++;
      if (restored % 100 === 0) console.log(`[restore] ${restored} done`);
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') {
        skipped++;
        console.warn(`[restore] ${k.contentId} already exists in live, skipping`);
      } else throw e;
    }
  }
  console.log({ restored, skipped, missing });
})();
```

Run with `NODE_PATH=$(pwd)/scripts/lake-audit/node_modules node ...`.

### 5. Verify counts and clean up the side table

```sh
# Confirm the restored count makes sense
aws dynamodb describe-table --table-name "$DST" \
  --query 'Table.ItemCount' --output text

# Verify a few sample contentIds are back
aws dynamodb get-item --table-name staar-content-pool \
  --key '{"poolKey":{"S":"<pk>"},"contentId":{"S":"<cid>"}}' \
  --output json

# Drop the side table once you're confident
aws dynamodb delete-table --table-name "$DST"
```

**IMPORTANT:** the side table starts with PITR DISABLED (default for
restored tables). If you keep it around for any reason, re-enable PITR
on it. Otherwise just delete it.

---

## Estimate

For 10,246 rows (a full undo of the May 3 hard-delete):
- Restore op: ~2-5 minutes (200 MB table)
- Surgical copy-back script: ~5 minutes (10k GetItem+PutItem at ~30ms each, sequential)
- Cost: ~$0.20 in restore + brief parallel storage; negligible.

For a smaller subset (say "I only need back the 97 multi-choice"):
- Same ~5 min restore (PITR is whole-table; can't restore subset)
- Copy-back ~3 seconds (97 rows)
- Same cost.

---

## When NOT to use this

- The deleted rows are deprecated content nobody serves and nobody
  references. Restoring them just re-fills the lake with dead data.
- It's been more than 35 days since the deletion (PITR window expired).
- The deletion was correct and you're second-guessing — re-read the
  hard-delete output JSON's filter+counts before assuming you need
  to restore.
