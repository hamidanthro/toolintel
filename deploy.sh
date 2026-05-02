#!/usr/bin/env bash
# deploy.sh — package and ship lambda/tutor-build/ to AWS Lambda staar-tutor.
#
# Usage:
#   ./deploy.sh                  # deploy default function (staar-tutor)
#   ./deploy.sh staar-tutor      # explicit function name
#   ./deploy.sh --yes            # skip the interactive y/N confirm
#   ./deploy.sh --allow-dirty    # deploy even if tutor-build/ has uncommitted changes (DANGEROUS)
#
# Order of guards (each phase aborts on failure with a distinct exit code):
#   1  PRECHECK         — aws/zip/jq/shasum installed, AWS creds resolve
#   2  GIT CLEAN        — lambda/tutor-build/ has no uncommitted changes (override: --allow-dirty)
#   3  PARITY CHECK     — scripts/check-tutor-parity.sh confirms tutor.js ↔ tutor-build/tutor.js parity
#   4  FETCH FUNCTION   — capture deployed Handler/Runtime/CodeSha256/LastModified, validate Handler match
#   5  BACKUP           — download deployed code zip to backups/ before any change
#   6  PACKAGE          — npm install --omit=dev, build new zip in build/, hash it
#   7  DRY RUN          — aws lambda update-function-code --dry-run; abort on AWS validation error
#   8  CONFIRM          — print summary; require single 'y' keypress (skip with --yes)
#   9  DEPLOY           — actual aws lambda update-function-code, then print rollback command
#
# Exit codes:
#   0 success
#   1 precheck failure
#   2 git dirty
#   3 parity drift
#   4 AWS fetch failure
#   5 backup failure
#   6 package failure
#   7 dry-run failure
#   8 user abort
#   9 deploy failure
#
# Backup naming: backups/<fn>-<utc-timestamp>-<sha8>.zip
#   sha8 = first 8 chars of the deployed CodeSha256 (base64). Lets you correlate
#   a backup to the exact production version it captures.
#
# IMPORTANT: this script writes to AWS. Read scripts/check-tutor-parity.sh and
# this script in full before running for the first time.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# --------------------------------------------------------------
# arg parsing
# --------------------------------------------------------------
FN="staar-tutor"
ASSUME_YES=0
ALLOW_DIRTY=0

for arg in "$@"; do
  case "$arg" in
    --yes)         ASSUME_YES=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --help|-h)
      sed -n '2,28p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    --*)
      echo "Unknown flag: $arg (try --help)" >&2
      exit 1
      ;;
    *)
      FN="$arg"
      ;;
  esac
done

DEPLOY_SOURCE="$REPO_ROOT/lambda/tutor-build"
BACKUP_DIR="$REPO_ROOT/backups"
BUILD_DIR="$REPO_ROOT/build"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR" "$BUILD_DIR"

# Color helpers (works on macOS + linux)
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
DIM=$'\033[2m'
RESET=$'\033[0m'

phase()  { printf "\n%s[%s]%s %s\n" "$GREEN" "$1" "$RESET" "$2"; }
warn()   { printf "%s%s%s\n" "$YELLOW" "$1" "$RESET" >&2; }
fail()   { printf "%s%s%s\n" "$RED" "$1" "$RESET" >&2; exit "${2:-1}"; }

# --------------------------------------------------------------
# [1/9] PRECHECK
# --------------------------------------------------------------
phase "1/9 PRECHECK" "tools and AWS credentials"

for tool in aws zip jq shasum git curl; do
  command -v "$tool" >/dev/null 2>&1 || fail "Missing required tool: $tool" 1
done
echo "  ✓ tools present (aws, zip, jq, shasum, git, curl)"

CALLER_JSON="$(aws sts get-caller-identity 2>&1)" || fail "AWS creds not configured. Run: aws configure" 1
ACCOUNT="$(echo "$CALLER_JSON" | jq -r '.Account')"
ARN="$(echo "$CALLER_JSON" | jq -r '.Arn')"
echo "  ✓ AWS account: $ACCOUNT"
echo "  ✓ AWS identity: $ARN"
echo "  Target function: $FN"

# --------------------------------------------------------------
# [2/9] GIT CLEAN
# --------------------------------------------------------------
phase "2/9 GIT CLEAN" "lambda/tutor-build/ has no uncommitted changes"

DIRTY="$(git -C "$REPO_ROOT" status --porcelain lambda/tutor-build/ || true)"
if [ -n "$DIRTY" ]; then
  if [ "$ALLOW_DIRTY" -eq 1 ]; then
    warn "  ⚠  --allow-dirty: deploying with uncommitted changes in tutor-build/"
    warn "$DIRTY" | sed 's/^/    /'
  else
    fail "  ❌ Uncommitted changes in lambda/tutor-build/. Commit first or pass --allow-dirty.

$(echo "$DIRTY" | sed 's/^/    /')" 2
  fi
else
  echo "  ✓ tutor-build/ is clean"
fi

# --------------------------------------------------------------
# [3/9] PARITY CHECK
# --------------------------------------------------------------
phase "3/9 PARITY CHECK" "tutor.js ↔ tutor-build/tutor.js"

if [ ! -x "$REPO_ROOT/scripts/check-tutor-parity.sh" ]; then
  fail "  ❌ scripts/check-tutor-parity.sh not found or not executable" 3
fi
"$REPO_ROOT/scripts/check-tutor-parity.sh" || fail "  ❌ Parity check failed (see [parity] lines above)" 3

# --------------------------------------------------------------
# [4/9] FETCH FUNCTION INFO
# --------------------------------------------------------------
phase "4/9 FETCH FUNCTION INFO" "current $FN configuration"

INFO_JSON="$(aws lambda get-function --function-name "$FN" 2>&1)" \
  || fail "  ❌ aws lambda get-function failed: $INFO_JSON" 4

DEPLOYED_HANDLER="$(echo "$INFO_JSON" | jq -r '.Configuration.Handler')"
DEPLOYED_RUNTIME="$(echo "$INFO_JSON" | jq -r '.Configuration.Runtime')"
DEPLOYED_SHA="$(echo "$INFO_JSON" | jq -r '.Configuration.CodeSha256')"
DEPLOYED_LAST="$(echo "$INFO_JSON" | jq -r '.Configuration.LastModified')"
CODE_URL="$(echo "$INFO_JSON" | jq -r '.Code.Location')"

echo "  Handler:      $DEPLOYED_HANDLER"
echo "  Runtime:      $DEPLOYED_RUNTIME"
echo "  Last modified: $DEPLOYED_LAST"
echo "  CodeSha256:   $DEPLOYED_SHA"

EXPECTED_HANDLER="tutor.handler"
if [ "$DEPLOYED_HANDLER" != "$EXPECTED_HANDLER" ]; then
  fail "  ❌ Handler mismatch: deployed=$DEPLOYED_HANDLER expected=$EXPECTED_HANDLER. Aborting." 4
fi
echo "  ✓ Handler matches expected: $EXPECTED_HANDLER"

# Short suffix for backup naming — first 8 chars of the base64 sha (alphanumeric-ish slice).
SHA_SHORT="$(echo "$DEPLOYED_SHA" | tr -dc 'A-Za-z0-9' | head -c 8)"

# --------------------------------------------------------------
# [5/9] BACKUP
# --------------------------------------------------------------
phase "5/9 BACKUP" "downloading current deployed code before any change"

BACKUP_PATH="$BACKUP_DIR/${FN}-${TIMESTAMP}-${SHA_SHORT}.zip"
curl -sSf -o "$BACKUP_PATH" "$CODE_URL" \
  || fail "  ❌ Backup download failed (presigned URL fetch)" 5

BACKUP_SIZE="$(wc -c <"$BACKUP_PATH" | tr -d ' ')"
BACKUP_HASH="$(shasum -a 256 "$BACKUP_PATH" | awk '{print $1}')"
echo "  ✓ Backup: $BACKUP_PATH"
echo "    size=$BACKUP_SIZE bytes"
echo "    sha256=$BACKUP_HASH"

# --------------------------------------------------------------
# [6/9] PACKAGE
# --------------------------------------------------------------
phase "6/9 PACKAGE" "build new deploy zip from $DEPLOY_SOURCE"

cd "$DEPLOY_SOURCE"
if [ -f package.json ]; then
  echo "  ⏳ npm install --omit=dev (production dependencies only)..."
  npm install --omit=dev --silent --no-audit --no-fund \
    || fail "  ❌ npm install failed in $DEPLOY_SOURCE" 6
  echo "  ✓ npm install done"
else
  echo "  (no package.json — zipping .js files only)"
fi

NEW_ZIP="$BUILD_DIR/${FN}-${TIMESTAMP}.zip"
rm -f "$NEW_ZIP"

# Zip everything except git/IDE/log noise. Include node_modules so the lambda
# has its production deps. Exclusions match what AWS Lambda would otherwise
# choke on or that bloat the zip without runtime value.
zip -rq "$NEW_ZIP" . \
  -x ".git/*" \
  -x ".DS_Store" \
  -x "*.zip" \
  -x "*.log" \
  -x "node_modules/.package-lock.json" \
  || fail "  ❌ zip failed" 6

cd "$REPO_ROOT"

NEW_SIZE="$(wc -c <"$NEW_ZIP" | tr -d ' ')"
NEW_HASH="$(shasum -a 256 "$NEW_ZIP" | awk '{print $1}')"
echo "  ✓ Built: $NEW_ZIP"
echo "    size=$NEW_SIZE bytes"
echo "    sha256=$NEW_HASH"

# AWS Lambda direct-upload limit is 50 MiB. Above that, you need S3.
LIMIT=$((50 * 1024 * 1024))
if [ "$NEW_SIZE" -gt "$LIMIT" ]; then
  fail "  ❌ Zip is $NEW_SIZE bytes (>50 MiB limit). Either trim node_modules or switch to S3 upload." 6
fi

# --------------------------------------------------------------
# [7/9] DRY RUN
# --------------------------------------------------------------
phase "7/9 DRY RUN" "aws lambda update-function-code --dry-run"

DRY_OUT="$(aws lambda update-function-code \
  --function-name "$FN" \
  --zip-file "fileb://$NEW_ZIP" \
  --dry-run 2>&1)" || fail "  ❌ Dry-run rejected by AWS:

$DRY_OUT" 7
echo "  ✓ Dry run accepted by AWS"

# --------------------------------------------------------------
# [8/9] CONFIRM
# --------------------------------------------------------------
phase "8/9 CONFIRM" "ready to ship"

cat <<SUMMARY
${DIM}-------------------------------------------------------------${RESET}
  Function:           $FN
  AWS account:        $ACCOUNT
  Currently deployed: $DEPLOYED_LAST  ($DEPLOYED_SHA)
  Backup saved:       $BACKUP_PATH
  New zip:            $NEW_ZIP
  New zip sha256:     $NEW_HASH
  Source dir:         $DEPLOY_SOURCE
${DIM}-------------------------------------------------------------${RESET}
SUMMARY

if [ "$ASSUME_YES" -eq 1 ]; then
  echo "  --yes: skipping interactive confirm"
else
  printf "Type 'y' to deploy, anything else to abort: "
  IFS= read -r ANSWER
  if [ "$ANSWER" != "y" ] && [ "$ANSWER" != "Y" ]; then
    warn "  Aborted by user."
    exit 8
  fi
fi

# --------------------------------------------------------------
# [9/9] DEPLOY
# --------------------------------------------------------------
phase "9/9 DEPLOY" "uploading new code"

DEPLOY_OUT="$(aws lambda update-function-code \
  --function-name "$FN" \
  --zip-file "fileb://$NEW_ZIP" \
  --output json 2>&1)" || fail "  ❌ Deploy failed: $DEPLOY_OUT" 9

# Wait for the function to become Active (state-after-update is "InProgress" briefly).
echo "  ⏳ waiting for function to become Active..."
aws lambda wait function-updated --function-name "$FN" \
  || fail "  ❌ Wait-for-update timed out" 9

POST_INFO="$(aws lambda get-function-configuration --function-name "$FN" 2>&1)" \
  || fail "  ❌ Post-deploy fetch failed" 9
POST_SHA="$(echo "$POST_INFO" | jq -r '.CodeSha256')"
POST_LAST="$(echo "$POST_INFO" | jq -r '.LastModified')"

cat <<DONE

${GREEN}✓ DEPLOY COMPLETE${RESET}
  New CodeSha256:   $POST_SHA
  Last modified:    $POST_LAST

${YELLOW}If anything looks wrong, ROLLBACK with:${RESET}
  aws lambda update-function-code \\
    --function-name $FN \\
    --zip-file fileb://$BACKUP_PATH

See ROLLBACK.md for full procedure.
DONE
