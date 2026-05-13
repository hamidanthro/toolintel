# DNS / domain status — toolintel.ai retirement

**Single-domain decision logged 2026-05-13.** Going forward
**`gradeearn.com` is the only domain.** `toolintel.ai` is being
retired. This doc is the runbook for the retirement.

---

## Current state (2026-05-13)

| Domain | DNS | TLS | Status |
|---|---|---|---|
| **`gradeearn.com`** | A → 185.199.108-111.153 (GitHub Pages CDN) | ✓ approved, expires 2026-08-04 | **Canonical.** Direct GitHub Pages serve from `main` branch. |
| **`www.gradeearn.com`** | (same cert) | ✓ approved | 301 → `https://gradeearn.com/` |
| **`toolintel.ai`** | A → CloudFront (`13.224.x.x`) | ✓ active | **Being retired.** CloudFront fronts the same Pages origin today. |

The repo's `CNAME` file already says `gradeearn.com` only — no
GitHub-Pages-side change needed.

---

## Why retire toolintel.ai

1. **Brand confusion.** `toolintel.ai` is a legacy host name from
   before the rebrand. Browser tab title on PWA-installed copies
   still shows "StarTest — State Test Prep" because the cached
   manifest captured that label.
2. **Two-domain ops overhead.** Every push now requires verifying
   both GH Pages and the CloudFront-fronted toolintel.ai mirror.
3. **CDN cache risk.** CloudFront on toolintel.ai uses
   `s-maxage=31536000` (1 year). During the rapid §61–§71 deploy
   cycle this morning, every intermediate state could have been
   edge-cached for a year. Single-domain removes the risk.
4. **Cost.** CloudFront + AWS WAF on toolintel.ai is unnecessary
   spend once the redirect lands.

---

## The retirement runbook (3 phases, do in order)

### Phase 1 — Active 301 redirect at toolintel.ai (do now)

Switch toolintel.ai from "serve same content" to "permanent
redirect to gradeearn.com." Old links keep working forever.
Search engines transfer ranking to gradeearn.com.

**Steps (AWS Console):**

1. Open AWS Console → CloudFront → find the distribution serving
   `toolintel.ai` (note its Distribution ID).
2. Behaviors → Default Behavior → Edit.
3. Function associations → CloudFront Functions → Viewer Request →
   Create function (or attach existing if one exists). Function code:
   ```js
   function handler(event) {
     var request = event.request;
     return {
       statusCode: 301,
       statusDescription: 'Moved Permanently',
       headers: {
         'location': { value: 'https://gradeearn.com' + request.uri }
       }
     };
   }
   ```
4. Publish the function. Attach to viewer-request on the default
   behavior of the toolintel.ai distribution.
5. **Invalidate cache** so the 301 takes effect immediately:
   ```sh
   aws cloudfront create-invalidation \
     --distribution-id <DIST_ID> \
     --paths '/*'
   ```
6. **Verify:**
   ```sh
   curl -sI https://toolintel.ai/        # should return 301 Location: https://gradeearn.com/
   curl -sI https://toolintel.ai/practice.html
   # should return 301 Location: https://gradeearn.com/practice.html
   ```

**Time:** ~15 min in AWS Console. Reversible (detach the function
to revert to passthrough).

### Phase 2 — Clean code references (do after Phase 1 verifies)

The lambda CORS allow-list at `lambda/tutor.js:85-86` (and its
build mirror `lambda/tutor-build/tutor.js:85-86`) still allows
`toolintel.ai` and `www.toolintel.ai`. After the 301 lands, no
real browser will send requests with `Origin: https://toolintel.ai`
because the page that originated the request would have been
redirected to `gradeearn.com` first. Removing them tightens the
security surface.

**Steps:**
1. Edit `lambda/tutor.js`: drop `'https://toolintel.ai'` and
   `'https://www.toolintel.ai'` from the ALLOWED_ORIGINS array.
2. Mirror the same edit to `lambda/tutor-build/tutor.js` (parity
   per CLAUDE.md §5).
3. `./deploy.sh` to ship the lambda update.
4. Run the parity check: `./scripts/check-tutor-parity.sh`.

**Time:** ~10 min. Defer until 24h after Phase 1 — gives the
redirect time to bake.

### Phase 3 — Full retirement (do when toolintel.ai traffic = 0)

After 30-60 days of zero direct toolintel.ai traffic (everyone
hits the 301 and lands on gradeearn.com):

1. **AWS:** Delete the CloudFront distribution.
2. **Route 53 / Namecheap:** Remove the toolintel.ai DNS A records.
   You can keep the domain registered as a defensive purchase (cheap,
   stops someone else from grabbing it), OR cancel at next renewal.
3. **Code:** Update CLAUDE.md §4 to remove the "two-domain" wording
   and reflect single-domain-from-day-this state.
4. **GitHub Pages settings:** No change needed — `CNAME` was already
   single-domain (`gradeearn.com`).

**Time:** ~10 min.

---

## HTTPS enforce flag (separate, do now)

GitHub Pages reports `"https_enforced": false`. Means anyone
hitting `http://gradeearn.com/` gets HTTP, not auto-redirected
to HTTPS. The TLS cert is approved and live, so flipping
enforce-HTTPS on costs nothing and closes a downgrade-attack vector.

**Action (one of two):**

```sh
gh api -X PUT repos/hamidanthro/toolintel/pages \
  --input - <<< '{"https_enforced": true}'
```

Or via UI: Repo → Settings → Pages → check "Enforce HTTPS".

---

## What ALREADY changed in the repo (2026-05-13)

- `CNAME` = `gradeearn.com` only (verified)
- All marketing meta tags (`og:url`, `canonical`, `og:image:alt`,
  `twitter:title`) point at `https://gradeearn.com/` (§58)
- Cache-bust strategy unified across all 314 HTML pages so
  styles.css and auth.js no longer ship 8 different versions
  (§72 — the immediate fix for "90% of changes invisible")
- New helper script `scripts/bump-cache.sh` enforces one-shot
  cache-bust rotation per push

---

## What remains for the user to execute (NOT code, manual ops)

- [ ] **AWS Console:** add CloudFront Function returning 301
      (Phase 1 above)
- [ ] **GitHub Pages:** flip `https_enforced` to true
- [ ] **CLAUDE.md §4:** owner-edit to remove dual-domain wording
      once Phase 3 ships (CI/agents will pick up the new policy)

Once Phase 1 is verified, ping me and I'll ship Phase 2 (lambda CORS
cleanup) the same session.
