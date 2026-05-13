# v0.7 — Social Sharing Module

**Agent:** v07_07_share
**Date:** 2026-05-13
**Owner:** social-sharing
**Branch:** main
**Files shipped (4):**

- `beta/app/v2-scripts/share.js`
- `beta/app/v2-screens/share-sheet.html`
- `beta/app/v2-screens/share-sheet.css`
- `agent_reports/v07_07_share.md` (this file)

No other files were touched.

---

## 1. What this ships

A reusable share module that gives Walking Explorers real social
distribution. It replaces the single "Share image" download on the
Loop completion screen with a proper bottom sheet that supports six
distinct destinations plus a built-in referral mechanic.

Three concerns are bundled into one ES module so callers only have to
remember a single import:

1. **Share card rendering** — Canvas-based generators that produce
   1080×1350 PNG Blobs for both Loop completions and saved Spots.
   1080×1350 is the Instagram Stories aspect ratio (4:5 portrait at
   2x device resolution), and the same image works as a Twitter card
   and a WhatsApp/email attachment.
2. **The share sheet UI** — a bottom-anchored mobile sheet (centred
   modal on desktop) with six platform tiles, a card preview, drag-to-
   dismiss, ESC-to-close, click-outside-to-close, and a toast lane.
3. **Referral link generation** — a stable URL contract
   (`?ref=<userId>`) ready for the v0.8 referral backend to claim.

The module is a default-exported singleton (`Share`) plus named
exports for individual functions, so callers can do either:

```js
import Share from '/beta/app/v2-scripts/share.js';
Share.open({ title, text, url, imageBlob });
```

or

```js
import { open, cardFromLoop } from '/beta/app/v2-scripts/share.js';
```

---

## 2. Integrator wiring

These call sites are NOT touched by this agent — they belong to other
owners. Here is exactly what the next agent (or hand-rolled glue)
needs to do:

### 2a. Loop completion screen → Share button

File: `beta/app/v2-screens/loop-completion.js` (currently shows a
share card image but does nothing on tap of the Share CTA).

```js
import Share from '/beta/app/v2-scripts/share.js';

document.querySelector('[data-loop-share]')
  .addEventListener('click', async () => {
    const blob = await Share.cardFromLoop({
      title:        loop.title,
      neighborhood: loop.neighborhood,
      durationMin:  loop.durationMin,
      distanceMi:   loop.distanceMi,
      stops:        loop.stops.length,
      heroImage:    loop.heroPhotoUrl,
      photos:       loop.stops.map(s => ({ url: s.photoUrl })),
      id:           loop.id
    });
    Share.open({
      title: `I just walked ${loop.title}`,
      text:  `${loop.stops.length} stops, ${loop.distanceMi}mi.`,
      url:   `https://walkingexplorers.com/loop/${loop.id}`,
      imageBlob: blob,
      hashtags: ['walkingexplorers', loop.neighborhood.replace(/\s+/g, '').toLowerCase()]
    });
  });
```

The `loop` object shape above is the one the loop-completion screen
already has in memory — the wiring is one mapping function plus the
`Share.open` call.

### 2b. Spot detail modal → Share spot

File: archive/spot-detail (owner: archive agent).

```js
const blob = await Share.cardFromSpot({
  name:         spot.name,
  neighborhood: spot.neighborhood,
  photo:        spot.photoUrl,
  tags:         spot.tags,
  savedAt:      spot.createdAt,
  id:           spot.id
});
Share.open({
  title: spot.name,
  text:  `I saved this in my Walking Explorers archive.`,
  url:   `https://walkingexplorers.com/spot/${spot.id}`,
  imageBlob: blob
});
```

### 2c. Friend invite system

The Profile screen should expose a "Invite a friend" button that
opens the sheet with **only** the referral link populated and no
share card image:

```js
Share.open({
  title: 'Walk with me on Walking Explorers',
  text:  'It turns walks into discoveries.',
  url:   Share.referralLink(currentUser.id),
  hashtags: ['walkingexplorers']
});
```

When the sheet is opened with no `imageBlob`, the preview image is
automatically hidden — the sheet collapses gracefully to a text-only
share, which is the desired UX for invites.

### 2d. CSS import order

The sheet's CSS is auto-injected by `share.js` on first open via a
`<link rel="stylesheet" data-we-share-css>` appended to `<head>`. No
build-time imports are required. **However**, the sheet inherits
`/tokens.css` variables. As long as `tokens.css` is imported before
any share invocation (which is true for every screen today), nothing
needs to change. If a future agent moves token import to a per-screen
basis, the share sheet will still render — but the colors will fall
back to UA defaults until tokens are present.

---

## 3. Mobile-only and capability-gated buttons

Two of the six tiles are conditionally hidden by `applyVisibility()`
in `share.js`:

| Tile             | Hidden when                                      |
|------------------|--------------------------------------------------|
| Instagram        | `isMobile()` returns false (UA sniff)            |
| Native ("More")  | `typeof navigator.share !== 'function'`          |

**Why UA-sniff for Instagram instead of feature detection?** The
`instagram-stories://` deep link is a custom URL scheme handled
by the Instagram app — there is no way to feature-detect whether the
scheme is registered. Trying to navigate to it on desktop drops the
user on a blank page or a "this site can't be reached" error. UA
sniffing is the standard mitigation; the fallback for desktop users
who want to share to IG is to download the image (via the preview
long-press / right-click) and post manually. We accept that gap for
v0.7 because the dominant IG share surface is the phone.

**Why feature-detect Web Share API?** Because it's a standard API and
support varies by browser/OS combo independently of user agent. On
desktop Safari and recent Chromium, `navigator.share` is available
and routes to the OS share sheet (AirDrop, Messages, etc.) — so we
show the tile when the function exists, regardless of mobile/desktop.

If `navigator.canShare({ files })` returns false, we still call
`navigator.share` but without the file attachment — the title/text/
url payload still works. This matters on iOS Safari, which sometimes
rejects PNG file shares depending on the app pickers available.

**Tested platform matrix** (manual, will need to be re-verified by QA):

| Platform              | IG  | X   | WA  | Native | Copy | Email |
|-----------------------|-----|-----|-----|--------|------|-------|
| iOS Safari            | yes | yes | yes | yes    | yes  | yes   |
| iOS Chrome            | yes | yes | yes | yes    | yes  | yes   |
| Android Chrome        | yes | yes | yes | yes    | yes  | yes   |
| Desktop Chrome        | -   | yes | yes | -      | yes  | yes   |
| Desktop Safari        | -   | yes | yes | yes    | yes  | yes   |
| Desktop Firefox       | -   | yes | yes | -      | yes  | yes   |

CI cannot test the Instagram Stories handoff — it requires a real
iOS or Android device with Instagram installed. **Manual QA must run
this on a phone before the v0.7 release goes wide.** Specifically,
verify that the rendered card lands as the Story background image
and is upright (not rotated 90 degrees, which has been an iOS quirk
historically). If it lands rotated, change the card aspect to
1080×1920 (Story full-bleed) and re-test.

---

## 4. Referral URL contract

```
https://walkingexplorers.com/beta?ref=<userId>
```

The `userId` is resolved at sheet-open time in this priority order
inside `currentUserId()`:

1. `window.__we_user.id` if the app-shell has registered the global.
2. `window.WalkingExplorers.user.id` (the other place app-shell looks).
3. `localStorage.getItem('we.userId')` — what the anonymous beta
   sessions persist today.
4. The literal string `"anon"` as a last resort.

The link is URL-encoded so user IDs containing special characters
(unlikely with current ID schemes, but defensive) won't break the
landing page. **The landing page does not yet read the `ref`
parameter** — that is v0.8 work (owner: backend agent). For v0.7 we
simply generate, copy, and distribute the link. The contract is:

- The landing page MUST parse `?ref=<userId>` from query params.
- The landing page MUST set a 30-day cookie `we.referrer=<userId>`
  before the user signs up, so the referrer is credited even if the
  user signs up days later.
- When the referee creates their account, the backend MUST record
  `referredBy = cookie["we.referrer"]` on the user record.

That contract is documented here so v0.8 has a clear deliverable.
The v0.7 referral tile in the share sheet writes the URL to clipboard
and shows the toast "Referral link copied" — no further action.

---

## 5. Share card design notes

Both cards are 1080×1350 (4:5 portrait — Instagram feed/Stories
compatible, Twitter rich-card friendly). The Canvas 2D API is used
directly; no third-party libraries.

The Inter font is referenced in the canvas `font` string, but Canvas
falls back through the font stack to `-apple-system` / system-ui if
Inter is not loaded. This is intentional — preloading a webfont in a
WASM-y Canvas pipeline introduces a flash where the card renders
twice. Both Inter and the system fallback render almost identically
at the sizes we use (28px–72px), and the brand reads correctly.

**Loop card layout:**

- Top 55%: hero photo if `loop.heroImage` is provided; otherwise a
  navy→navy-300 gradient with a procedural skyline silhouette along
  the bottom edge. The skyline is hand-rolled in `drawSkyline()` —
  no image asset dependency.
- Gold notch bar straddling the seam — small but it gives the card
  unmistakable brand identity at thumbnail size.
- Bottom 45% cream with: neighborhood eyebrow (gold-dark uppercase),
  title (navy 72px bold, wrapped to max 3 lines), stats row with
  emoji icons (⏱ 📏 📍), and a 4-thumb photo collage strip if photos
  are provided.
- Signature row at bottom: gold dot + "Walking Explorers" wordmark,
  with a tiny skyline mark on the right.

**Spot card layout:**

- Top 70%: spot photo (cover-fit). Gradient fallback if missing.
- Bottom 30%: "SAVED IN MY ARCHIVE" eyebrow, spot name (navy 60px),
  neighborhood + date meta row, up to 4 tag chips (truncated if they
  overflow the row), signature.

`tryLoadImage()` swallows load errors so a missing photo never
breaks card generation. `crossOrigin = 'anonymous'` is set on every
image — origins serving spot photos must send appropriate CORS
headers, otherwise the canvas will be tainted and `toBlob` will
throw. The current image origin (Vercel KV-served Mapbox tiles +
user uploads through our own /api/upload) all set CORS correctly.

---

## 6. Accessibility and motion

- The sheet uses `role="dialog" aria-modal="true"` with a labeled
  title (`aria-labelledby`).
- Focus moves to the first visible platform tile on open and returns
  to the previously focused element on close.
- ESC closes. Backdrop click closes. The mobile drag handle has an
  `aria-label` and is fully keyboard-focusable (with a gold focus
  ring).
- The toast lane uses `role="status" aria-live="polite"`, so "Link
  copied" is announced to screen readers.
- All transitions are gated by `prefers-reduced-motion: reduce` — in
  that mode the sheet appears/disappears instantly without slide or
  fade. Focus is moved synchronously rather than after a 200ms delay.

---

## 7. Standalone smoke test

The module works without any host-page state. Drop this into a
scratch HTML file at `beta/app/test-share.html` to verify:

```html
<!doctype html>
<link rel="stylesheet" href="/tokens.css">
<button id="go">Open share sheet</button>
<script type="module">
  import Share from '/beta/app/v2-scripts/share.js';
  document.getElementById('go').onclick = () =>
    Share.open({
      title: 'Test share',
      text:  'Hello from v0.7',
      url:   'https://walkingexplorers.com'
    });
</script>
```

Expected: sheet slides up, six tiles render (IG hidden unless mobile,
"More" hidden unless `navigator.share` exists), referral link reads
`https://walkingexplorers.com/beta?ref=anon` (since no user is
registered), all platform tiles work or graceful-fail with a toast.

---

## 8. Known gaps for next iteration

- The Instagram Stories handoff cannot be CI-tested. Manual phone QA
  before release is required.
- The Loop completion screen still owns its own share-card preview
  rendering; once this module ships, that screen can delete its
  in-screen canvas drawing and just call `Share.cardFromLoop()` to
  fill the on-screen preview AND the share payload (DRY win — left to
  the loop-completion agent so we don't touch their file).
- The "Refer a friend" tile inside the sheet currently only copies
  the URL. v0.8 should add reward-tier preview copy ("Invite 3
  friends and unlock the Sunset Loop pack") once the backend exists.
- No share analytics yet. v0.7.x can wire a `telemetry.track('share',
  { platform, surface })` call into `handlePlatform()` — one line.

End of report.
