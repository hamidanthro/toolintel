#!/usr/bin/env bash
# check-tutor-parity.sh — verify lambda/tutor.js and lambda/tutor-build/tutor.js
# are in functional parity. Called by deploy.sh as a hard gate before
# packaging the deploy artifact.
#
# Exit 0 = parity OK, safe to deploy.
# Exit 1 = drift detected, deploy must abort.
#
# All output lines are prefixed [parity] so deploy.sh can grep status.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
A="$REPO_ROOT/lambda/tutor.js"
B="$REPO_ROOT/lambda/tutor-build/tutor.js"
JA="$REPO_ROOT/lambda/judge.js"
JB="$REPO_ROOT/lambda/tutor-build/judge.js"

if [ ! -f "$A" ]; then
  echo "[parity] FAIL: $A not found" >&2
  exit 1
fi
if [ ! -f "$B" ]; then
  echo "[parity] FAIL: $B not found" >&2
  exit 1
fi
if [ ! -f "$JA" ]; then
  echo "[parity] FAIL: $JA not found" >&2
  exit 1
fi
if [ ! -f "$JB" ]; then
  echo "[parity] FAIL: $JB not found" >&2
  exit 1
fi

FAIL=0

# ============================================================
# CHECK 1 — every named function declaration matches
# ============================================================
A_FUNCS="$(grep -oE '^(async )?function [a-zA-Z_][a-zA-Z0-9_]*' "$A" | sed 's/^async //' | sort -u)"
B_FUNCS="$(grep -oE '^(async )?function [a-zA-Z_][a-zA-Z0-9_]*' "$B" | sed 's/^async //' | sort -u)"

if [ "$A_FUNCS" = "$B_FUNCS" ]; then
  echo "[parity] OK: function declarations match ($(echo "$A_FUNCS" | wc -l | tr -d ' ') total)"
else
  FAIL=1
  echo "[parity] FAIL: function declarations differ" >&2
  echo "[parity]   in tutor.js but not in tutor-build/tutor.js:" >&2
  comm -23 <(echo "$A_FUNCS") <(echo "$B_FUNCS") | sed 's/^/[parity]     /' >&2
  echo "[parity]   in tutor-build/tutor.js but not in tutor.js:" >&2
  comm -13 <(echo "$A_FUNCS") <(echo "$B_FUNCS") | sed 's/^/[parity]     /' >&2
fi

# ============================================================
# CHECK 2 — every action route matches
# ============================================================
A_ROUTES="$(grep -oE "action === '[^']+'" "$A" | sort -u)"
B_ROUTES="$(grep -oE "action === '[^']+'" "$B" | sort -u)"

if [ "$A_ROUTES" = "$B_ROUTES" ]; then
  echo "[parity] OK: action routes match ($(echo "$A_ROUTES" | wc -l | tr -d ' ') total)"
else
  FAIL=1
  echo "[parity] FAIL: action routes differ" >&2
  echo "[parity]   in tutor.js but not in tutor-build/tutor.js:" >&2
  comm -23 <(echo "$A_ROUTES") <(echo "$B_ROUTES") | sed 's/^/[parity]     /' >&2
  echo "[parity]   in tutor-build/tutor.js but not in tutor.js:" >&2
  comm -13 <(echo "$A_ROUTES") <(echo "$B_ROUTES") | sed 's/^/[parity]     /' >&2
fi

# ============================================================
# CHECK 3 — high-risk function bodies must be byte-identical
# These are the ones the May 2 voice / summarizer commits actively touch.
# Drift here is the most user-visible breakage class.
# ============================================================
for fn in buildSystemPrompt buildSummarySystemPrompt buildFirstUserMessage; do
  a_body="$(awk "/^(async )?function ${fn}/,/^}\$/" "$A")"
  b_body="$(awk "/^(async )?function ${fn}/,/^}\$/" "$B")"
  if [ -z "$a_body" ] || [ -z "$b_body" ]; then
    FAIL=1
    echo "[parity] FAIL: $fn missing from one or both files" >&2
    continue
  fi
  if [ "$a_body" = "$b_body" ]; then
    echo "[parity] OK: $fn byte-identical"
  else
    FAIL=1
    echo "[parity] FAIL: $fn body differs (showing first 20 lines of diff):" >&2
    diff <(echo "$a_body") <(echo "$b_body") | head -20 | sed 's/^/[parity]   /' >&2
  fi
done

# ============================================================
# CHECK 4 — judge.js byte-identical between source and build
# Lambda runtime judge (May 3) — full file diff because the module
# is small and any drift between the two copies would mean the
# deployed quality gate doesn't match the source we test against.
# ============================================================
if cmp -s "$JA" "$JB"; then
  echo "[parity] OK: judge.js byte-identical between source and build"
else
  FAIL=1
  echo "[parity] FAIL: judge.js differs between source and build (showing first 20 lines of diff):" >&2
  diff "$JA" "$JB" | head -20 | sed 's/^/[parity]   /' >&2
fi

if [ "$FAIL" -ne 0 ]; then
  echo "[parity] ABORT — drift detected. Resolve before deploy." >&2
  echo "[parity] If this drift was intentional and tutor-build is the new source of truth," >&2
  echo "[parity] sync the changes into the other file and re-run." >&2
  exit 1
fi

echo "[parity] PASS — tutor.js, judge.js, and tutor-build/* are in sync."
exit 0
