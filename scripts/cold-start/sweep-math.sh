#!/usr/bin/env zsh
# Launcher: full math sweep, all 51 states.
set -euo pipefail
source /tmp/.openai_env
cd /Users/bob/clawd/toolintel/scripts/cold-start
exec node run.js --all-states --subject math --target 10 --concurrency 5 --cost-ceiling 120
