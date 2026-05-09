# Switching off root → gradeearn-deployer (CLAUDE.md §11)

Created 2026-05-09. The `gradeearn-deployer` IAM user exists in account
`860141646209` with the `GradeearnDeployerPolicy` managed policy attached.
**No access keys yet** — keys are intentionally not generated until you're
ready to swap profiles, so they don't leak through any logs or files.

## What the policy allows

- `lambda:UpdateFunctionCode`, `PublishVersion`, `UpdateAlias` and friends
  on `staar-tutor`, `staar-pool-topup`, `staar-quality-patrol`, `staar-tts`
  only (not other accounts' lambdas).
- `lambda:ListFunctions` account-wide for inspection.
- DynamoDB CRUD + DescribeTable + ContinuousBackups on every `staar-*`
  table and its indexes.
- Secrets Manager read on `staar-tutor/*` (OpenAI, Anthropic, auth-secret).
- S3 GetObject/PutObject/DeleteObject/ListBucket on `gradeearn-toy-images`
  and `staar-toy-images` (toy image management).
- CloudWatch logs read + alarm CRUD + metric data (for ops + the §7 alarms).
- API Gateway read-only.
- `sts:GetCallerIdentity` (so `aws sts get-caller-identity` works).

What it **doesn't** allow:
- IAM changes (so a leaked key can't escalate).
- Account-wide DynamoDB / Lambda CRUD on non-staar resources.
- Anything in regions other than us-east-1 (the policy resources are scoped).
- Anything in other accounts.

## Setup steps (run when ready to swap)

```sh
# 1. Generate access keys for the user (output shows them ONCE; capture them).
aws iam create-access-key --user-name gradeearn-deployer

# 2. Add a profile to ~/.aws/credentials. Replace the placeholders with the
#    AccessKeyId / SecretAccessKey from step 1's output.
cat >> ~/.aws/credentials <<'EOF'

[gradeearn-deployer]
aws_access_key_id = AKIA…
aws_secret_access_key = …
EOF

# 3. Add a profile to ~/.aws/config so region defaults are right.
cat >> ~/.aws/config <<'EOF'

[profile gradeearn-deployer]
region = us-east-1
output = json
EOF

# 4. Verify the new profile works (should print the user ARN, not :root).
AWS_PROFILE=gradeearn-deployer aws sts get-caller-identity

# 5. Make it the default for this shell.
export AWS_PROFILE=gradeearn-deployer

# 6. Smoke deploy — should still succeed, now from the user not root.
./deploy.sh --yes  # only when you actually want to redeploy
```

## After verifying, retire the root keys

Retire the *root* access keys (NOT the root password — root account access
stays). You're keeping root for the rare account-level ops (billing,
support, account closure).

1. Open https://console.aws.amazon.com/iam/home#/security_credentials
2. Under "Access keys (root user)", delete each one.

## Rollback

If the new profile breaks something, just unset `AWS_PROFILE`:

```sh
unset AWS_PROFILE
aws sts get-caller-identity   # back to root
```

## Future hardening (not done yet)

- Multi-Factor Auth on the root account (Console only — keys are gone).
- Rotate the deployer's access keys every 90 days.
- Even more granular policy: split read-only inspection from write-deploy
  into two separate users for daily-use vs scary-deploy roles.
