# DNS / domain status (verified 2026-05-09)

**Both domains are live and serve the same site from GitHub Pages.**
The cutover that CLAUDE.md §4 framed as pending has already happened.

## Current state

| Domain | DNS | TLS | What it serves |
|---|---|---|---|
| **`gradeearn.com`** | A → 185.199.108.153 / .109 / .110 / .111 (GitHub Pages CDN) | ✓ approved, expires 2026-08-04 | Same site as toolintel.ai, served directly from GitHub Pages from `main` branch. |
| **`www.gradeearn.com`** | (covered by same cert) | ✓ approved | 301 → `https://gradeearn.com/` |
| **`toolintel.ai`** | A → 13.224.x.x (AWS CloudFront) | ✓ active | Same site (legacy host name; CloudFront fronts the same Pages origin). |

Verified via:
```
$ dig +short A gradeearn.com
185.199.111.153
185.199.110.153
185.199.109.153
185.199.108.153

$ curl -sI https://gradeearn.com/ | head -2
HTTP/2 200
server: GitHub.com

$ gh api repos/hamidanthro/toolintel/pages
"html_url":"http://gradeearn.com/", "https_certificate":{"state":"approved",...}
```

## What's left if you want to fully retire `toolintel.ai`

The brand is GradeEarn (CLAUDE.md §1, §2). `toolintel.ai` is a legacy
host name. Keeping it live indefinitely is fine — old links keep working —
but here's the runbook if you ever want to retire it.

### Phase A — soft-deprecate (passive; low-risk)

1. **Update marketing copy** to reference `gradeearn.com` as the canonical
   URL everywhere. (Most of CLAUDE.md and the README already do this.)
2. **Update OG / SEO meta tags** — `og:url`, `canonical` — to point at
   `https://gradeearn.com/`. Already done in this commit's index.html.
3. **Wait for organic traffic to migrate** (3-6 months typically).

### Phase B — active redirect (when you're ready)

Switch the `toolintel.ai` CloudFront distribution from "serve same content"
to "301 redirect to gradeearn.com". This costs nothing extra and keeps old
bookmarks / shared links from breaking.

In AWS Console:
1. CloudFront → distribution serving `toolintel.ai` → Behaviors
2. Edit the default behavior: viewer protocol policy → Redirect HTTP to HTTPS
3. Add a Lambda@Edge function (or use a CloudFront Function) on
   viewer-request that returns:
   ```
   { status: 301, statusDescription: 'Moved',
     headers: { location: [{ value: 'https://gradeearn.com' + request.uri }] } }
   ```
4. Test: `curl -sI https://toolintel.ai/` should return `301 Location: https://gradeearn.com/`.

### Phase C — full retirement

When traffic is near zero on `toolintel.ai`:
1. Remove the CloudFront distribution.
2. Cancel the `toolintel.ai` domain renewal at next expiry.
3. Update `CLAUDE.md` §4 to reflect single-domain state.

## What you DON'T need to do

- **`CNAME` file in repo:** already correct (`gradeearn.com`).
- **GitHub Pages settings:** already configured (custom domain set,
  HTTPS enforced flag is currently `false` — see below).
- **DNS records on Namecheap:** already correct for `gradeearn.com`.

## One thing worth flipping: enforce HTTPS

GitHub Pages reports `"https_enforced": false`. Means anyone hitting
`http://gradeearn.com/` gets HTTP, not auto-redirected to HTTPS. The
TLS cert is approved and live, so flipping enforce-HTTPS on costs
nothing and closes a downgrade-attack vector.

**Action:**
```sh
gh api -X PUT repos/hamidanthro/toolintel/pages \
  --input - <<< '{"https_enforced": true}'
```

Or via UI: Repo → Settings → Pages → check "Enforce HTTPS".

## Stale doc cleanup

CLAUDE.md §4 is being updated in the same commit as this file to
reflect "cutover complete" instead of "cutover pending."
