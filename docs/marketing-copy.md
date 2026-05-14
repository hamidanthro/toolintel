# Marketing copy preserved for future unauthed surfaces

Hidden from the signed-in home in §88 (2026-05-13). Guests still see
these blocks rendered from `index.html` because `body.is-signed-in`
is only added in `showDashboard()` after auth resolves. **Do not
delete the markup in `index.html`** — guests need it. This file
preserves the copy in case the unauthed home is later split into a
dedicated `/parents` route or marketing site landing.

**TODO:** when a dedicated `/parents` or marketing landing ships,
move these blocks out of `index.html` and into that route. At that
point, the `body.is-signed-in` CSS hide can be removed.

---

## "For parents · Here's how it works" (3-step explainer)

**Eyebrow:** FOR PARENTS
**H2:** Here's how it works.

1. **Your kid practices**
   15 minutes a day. Questions aligned to your state's tests, adapted
   to their level by an AI tutor.

2. **They earn cents**
   Correct answers earn real cents. Streaks earn bonuses. Daily
   challenges earn extra.

3. **We ship them a toy**
   When they hit the right balance, they pick a toy from the
   marketplace. We ship it. To your door.

Source: `index.html` line 405-433, `<section class="parent-layer parent-layer--how">`.

---

## "Real rewards · Real toys. Shipped to your door."

**Eyebrow:** REAL REWARDS
**H2:** Real toys. Shipped to your door.
**Sub:** Not points. Not stickers. Not virtual badges. Real things.

Showcase items (emoji + label):
- 🧱 Building sets
- 📷 Cameras
- ⌚ Smart watches
- 🎮 Roblox credit

Source: `index.html` line 435-459, `<section class="parent-layer parent-layer--toys">`.

---

## Other parent-layer sections preserved in `index.html`

- `parent-layer--trust` — "Built for parents" trust marks
- `parent-layer--quote` — single-parent testimonial
- `parent-layer--pricing` — pricing block

Hidden from signed-in home via the same `body.is-signed-in` CSS
rule. Copy lives in `index.html` for guests; this file is the
extraction target if/when a dedicated `/parents` route ships.
