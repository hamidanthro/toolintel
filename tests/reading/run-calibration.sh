#!/usr/bin/env bash
# Wrapper to run the judge-passage calibration suite with the live
# Anthropic key from Secrets Manager.
#
# Cost per run: ~$0.10-0.30 (6 Anthropic Sonnet 4.5 calls).
set -euo pipefail
ANTHROPIC_API_KEY="$(aws secretsmanager get-secret-value \
  --secret-id staar-tutor/anthropic-api-key \
  --region us-east-1 \
  --query SecretString --output text)"
export ANTHROPIC_API_KEY
exec node "$(dirname "$0")/judge-calibration.test.js"
