#!/bin/bash
# GradeEarn — TTS lambda deploy
# - npm ci --omit=dev
# - zip handler + node_modules
# - aws lambda create-function (first time) or update-function-code (subsequent)
#
# Function: staar-tts (paralleling staar-tutor naming convention).
# Memory 512 MB, timeout 15s, arm64. Role: staar-tts-role.

set -euo pipefail

cd "$(dirname "$0")"

FN_NAME="staar-tts"
ROLE_NAME="staar-tts-role"
REGION="us-east-1"

echo "[tts deploy] installing prod deps"
npm ci --omit=dev > /dev/null 2>&1 || npm install --omit=dev > /dev/null 2>&1

echo "[tts deploy] zipping"
rm -f /tmp/staar-tts.zip
zip -rq /tmp/staar-tts.zip index.mjs node_modules package.json
SIZE=$(wc -c < /tmp/staar-tts.zip)
echo "[tts deploy] zip size: $SIZE bytes"

# Detect whether the function exists already.
if aws lambda get-function --function-name "$FN_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "[tts deploy] updating existing function $FN_NAME"
  aws lambda update-function-code \
    --function-name "$FN_NAME" \
    --zip-file fileb:///tmp/staar-tts.zip \
    --region "$REGION" \
    --query '{Sha256:CodeSha256,Updated:LastModified}' --output table
  aws lambda wait function-updated --function-name "$FN_NAME" --region "$REGION"
  echo "[tts deploy] update complete"
else
  ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>&1)
  if [[ "$ROLE_ARN" != arn:aws:iam::* ]]; then
    echo "[tts deploy] FATAL: IAM role $ROLE_NAME does not exist. Run scripts/create-tts-iam.sh first." >&2
    exit 1
  fi
  echo "[tts deploy] creating function $FN_NAME with role $ROLE_ARN"
  aws lambda create-function \
    --function-name "$FN_NAME" \
    --runtime nodejs20.x \
    --architectures arm64 \
    --memory-size 512 \
    --timeout 15 \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file fileb:///tmp/staar-tts.zip \
    --region "$REGION" \
    --query '{Arn:FunctionArn,Sha256:CodeSha256}' --output table
  echo "[tts deploy] create complete"
fi
