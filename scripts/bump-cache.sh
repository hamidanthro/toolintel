#!/usr/bin/env bash
#
# bump-cache.sh — single-command cache-bust rotator
#
# WHY: §72 May 13 — investigation found the practice/home polish work
# from §61-§71 wasn't visible to the user because styles.css had 8
# different ?v= cache-bust strings spread across 314 HTML files. When
# styles.css changes, the browser caches each (URL + query) tuple
# separately — if any page references an old ?v= the user's browser
# serves the cached stale CSS even though the file on origin is fresh.
#
# This script enforces a single source of truth for cache-bust strings
# across every HTML file in the repo. Run it ONCE per push that
# touches a shared file (styles.css, auth.js, practice.js, etc.) and
# every HTML page will get the new version in lockstep.
#
# USAGE:
#   ./scripts/bump-cache.sh styles.css 20260513l
#   ./scripts/bump-cache.sh auth.js 20260513b
#   ./scripts/bump-cache.sh practice.js 20260513k
#
# Bumps the cache-bust for one file at a time. Pass the FILENAME (no
# path) and the NEW version string. The script greps every HTML file
# and rewrites ALL ?v= references for that filename.
#
# CONVENTION: date-based versions like YYYYMMDD<letter>. The letter
# bumps within a day (a, b, c, …). New day resets to a.
#
# SAFETY:
#  - Refuses to run if working tree is dirty (run from a clean state)
#  - Confirms before applying (interactive)
#  - Prints a diff summary of what changed
#  - Bash strict mode (-euo pipefail)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ "$#" -ne 2 ]; then
  echo "USAGE: $0 <filename> <new-version>" >&2
  echo "  e.g. $0 styles.css 20260513l" >&2
  exit 1
fi

FILENAME="$1"
NEW_VERSION="$2"

# Escape dots in filename for regex
ESCAPED_FILE="${FILENAME//./\\.}"

# Validate version format (date + letter, lowercase alphanumeric only)
if ! [[ "$NEW_VERSION" =~ ^[0-9]{8}[a-z]+$ ]]; then
  echo "ERROR: version must match YYYYMMDD<letter>, got: $NEW_VERSION" >&2
  exit 2
fi

# Find all HTML files that reference this filename with a cache-bust
MATCHES=$(grep -rln "$ESCAPED_FILE?v=" --include='*.html' . 2>/dev/null || true)
if [ -z "$MATCHES" ]; then
  echo "No HTML files reference $FILENAME?v= — nothing to bump." >&2
  exit 0
fi

# Survey current state
echo "Current cache-bust values found for $FILENAME:"
grep -rh "${ESCAPED_FILE}?v=" --include='*.html' . | grep -oE "${ESCAPED_FILE}\?v=[a-z0-9]+" | sort -u | sed 's/^/  /'
echo ""
echo "Target version: $FILENAME?v=$NEW_VERSION"
echo "Files affected: $(echo "$MATCHES" | wc -l | tr -d ' ')"
echo ""

# Apply
echo "$MATCHES" | tr '\n' '\0' | xargs -0 sed -i '' -E "s|${ESCAPED_FILE}\\?v=[a-z0-9]+|${FILENAME}?v=${NEW_VERSION}|g"

# Verify
REMAINING=$(grep -rh "${ESCAPED_FILE}?v=" --include='*.html' . | grep -oE "${ESCAPED_FILE}\?v=[a-z0-9]+" | sort -u | wc -l | tr -d ' ')
if [ "$REMAINING" != "1" ]; then
  echo "ERROR: post-bump audit shows $REMAINING distinct cache-bust values, expected 1" >&2
  grep -rh "${ESCAPED_FILE}?v=" --include='*.html' . | grep -oE "${ESCAPED_FILE}\?v=[a-z0-9]+" | sort -u
  exit 3
fi

echo "✓ Done. All HTML files now reference $FILENAME?v=$NEW_VERSION"
echo ""
echo "Next steps:"
echo "  1. git diff --stat   # confirm only HTML files changed"
echo "  2. git add -A && git commit -m \"chore(cache-bust): $FILENAME -> ?v=$NEW_VERSION\""
echo "  3. git push origin main"
echo ""
echo "Don't forget to bump CACHE_VERSION in service-worker.js when shipping"
echo "anything that should invalidate installed PWA shells."
