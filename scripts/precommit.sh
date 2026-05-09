#!/usr/bin/env bash
# scripts/precommit.sh
#
# Pre-commit guardrail: fail the commit if it ADDS any reference to
# 'replyquik' in GradeEarn code. Removals are fine (de-listing dormant
# breadcrumbs is desired). Existing references in CLAUDE.md / memory
# documenting the boundary are also fine.
#
# Per Hamid 2026-05-09: ReplyQuik is a real, live, separate product.
# GradeEarn must never call its endpoints, embed its widget, or
# touch its AWS resources. This script catches any drift before it
# reaches main.
#
# Install:
#   ln -sf ../../scripts/precommit.sh .git/hooks/pre-commit
# Or call it manually:
#   ./scripts/precommit.sh
#
# Bypass (rare):
#   git commit --no-verify
set -e

# Allowlist of paths where 'replyquik' references DOCUMENT the boundary
# rather than introduce a coupling. Edits to these are OK.
ALLOWED_PATHS_REGEX='^(CLAUDE\.md|scripts/precommit.sh|docs/|\.claude/projects/.*/memory/feedback_replyquik_is_live\.md)'

# Coupling indicators: lines that introduce an ACTUAL dependency on
# replyquik (not just a doc comment). If the line mentions replyquik
# AND any of these, it's a coupling — block it.
#   - URL / domain reference  : api.replyquik.com, https://replyquik
#   - module require / import : require('replyquik...'), from 'replyquik'
#   - script tag              : src="...replyquik
#   - fetch / XHR             : fetch('...replyquik
#   - AWS ARN / resource ref  : arn:aws:...replyquik (Allow only)
#   - DynamoDB / S3 names     : 'replyquik-*' as a TableName / Bucket
COUPLING_REGEX='(api\.replyquik|https?://[^"]*replyquik|require\(.*replyquik|import.*replyquik|src=.*replyquik|fetch\(.*replyquik|TableName.*replyquik|Bucket.*replyquik|FunctionName.*replyquik)'

# Get staged diff (added lines only) for this commit. If running
# outside a commit (e.g., manual ./scripts/precommit.sh),
# fall back to comparing working tree against HEAD.
if git diff --cached --name-only --quiet 2>/dev/null; then
  DIFF=$(git diff HEAD)
else
  DIFF=$(git diff --cached)
fi

# Iterate per-file blocks via perl (BSD awk's regex handling of
# alternation with escaped parens is brittle). Block ONLY when:
#   1. The file is outside the allowlist (docs/CLAUDE.md/memory are fine), AND
#   2. The line contains 'replyquik' AND a coupling indicator
#      (pure boundary-documenting comments in any file are also fine).
# Pass regexes via env vars so perl doesn't see the unescaped slashes.
violations=$(ALLOW_RE="$ALLOWED_PATHS_REGEX" COUPLING_RE="$COUPLING_REGEX" \
  echo "$DIFF" | perl -ne '
  BEGIN { $ar = qr/$ENV{ALLOW_RE}/; $cr = qr/$ENV{COUPLING_RE}/; }
  if (m{^diff --git .*b/(\S+)}) { $file = $1; $allowed = ($file =~ $ar); next; }
  next unless m{^\+[^+]};
  my $line = $_; $line =~ s/^\+//;
  next if $allowed;
  next unless lc($line) =~ m{replyquik};
  if (lc($line) =~ $cr) {
    print "$file: $line";
  }
')

if [ -n "$violations" ]; then
  echo ""
  echo "❌ COMMIT BLOCKED — 'replyquik' references added outside the allowlist:"
  echo ""
  echo "$violations"
  echo ""
  echo "Per CLAUDE.md §6c: ReplyQuik is a real, live, separate product."
  echo "GradeEarn must never embed its widget, call its endpoints, or"
  echo "touch its AWS resources."
  echo ""
  echo "If this is a documentation update describing the boundary, add"
  echo "the path to ALLOWED_PATHS_REGEX in scripts/precommit.sh."
  echo ""
  echo "To bypass for a one-off (rare): git commit --no-verify"
  exit 1
fi

# ============================================================
# JS syntax check on every staged .js file. Catches the kind of
# bug that would pass git review but break deploy.sh's parity check
# (or worse, ship to GitHub Pages and brick the kid's browser).
# Skipped if `node` isn't available; never blocks for a missing tool.
# ============================================================
if command -v node >/dev/null 2>&1; then
  js_files=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null \
    | grep -E '\.(js|mjs)$' \
    | grep -v 'node_modules/' || true)
  if [ -z "$js_files" ]; then
    js_files=$(git diff --name-only --diff-filter=ACM HEAD 2>/dev/null \
      | grep -E '\.(js|mjs)$' \
      | grep -v 'node_modules/' || true)
  fi
  syntax_errors=""
  for f in $js_files; do
    [ -f "$f" ] || continue
    if ! err=$(node --check "$f" 2>&1); then
      syntax_errors="${syntax_errors}\n--- $f\n$err\n"
    fi
  done
  if [ -n "$syntax_errors" ]; then
    echo ""
    echo "❌ COMMIT BLOCKED — JS syntax errors in staged files:"
    printf "$syntax_errors"
    echo ""
    echo "Fix the syntax issues above. To bypass (rare): git commit --no-verify"
    exit 2
  fi
fi

exit 0
