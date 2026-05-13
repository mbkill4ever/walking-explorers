# v2_09 — Photo Capture Redesign

**Owner:** photo-capture redesign agent
**Scope (exclusive):** `beta/app/v2-screens/capture.html`, `beta/app/v2-screens/capture.css`, `beta/app/v2-screens/capture.js`

## Mission

Replace the plain "file input + tag grid + rating row + notes" capture modal with an Instagram/BeReal-quality full-screen capture moment: hero photo, filters, stickers, location tag, mood, single-tap save. Make every tap feel intentional so users go from "tourist with a phone" to "person building their archive of NYC."

## UX flow & timing

### Step 1 — Open (0–400 ms)
- User taps "Save Spot" during a walk.
- App calls `CaptureV2.open(stop, route)`.
- Full-screen modal mounts: `position: fixed; inset: 0; z-index: 200`.
- `capture-in` animation runs **400 ms** (`var(--ease-out-soft)`): opacity 0 → 1, translateY 18 px → 0, scale 0.985 → 1.
- Background scroll is locked (`body { overflow: hidden }`).
- Focus moves to the close button after **80 ms**.
- Screen reader announces: *"Capture screen opened. Tap to take a photo, or skip to add details without one."*
- GPS request fires immediately in the background; the "Locating…" chip shows pending state.

### Step 2 — Capture (tap → 240 ms flash → photo)
- Empty state: 80 px dashed ring with camera icon, **"Tap to capture"** label, **"A single photo is enough"** hint.
- Tap anywhere on the empty state opens the native camera (`input type="file" capture="environment"`).
- On selection: **camera flash overlay fires** — `.capture-flash` animation, white 0 → 0.95 → 0 over **220 ms** (`--ease-snap`).
- File is read → drawn to `<canvas>` → downscaled to **MAX 640 px** width → re-encoded as JPEG at quality 0.82, stepping down to 0.45 if the result exceeds 320 KB (server cap is 350 KB).
- Photo fades into the 4:5 preview frame; top-right action buttons (Retake, Sticker) appear.
- Filter chips' thumbnails repaint with the user's photo so each filter preview is a live miniature.
- Screen reader announces: *"Photo captured"*.

### Step 3 — Edit (filter strip + stickers)
- **Filter strip** at the bottom (above the sheet): glass-blur background (`backdrop-filter: blur(14px)`), horizontally scrollable, scroll-snap, 5 chips:
  - **None** — `filter: none`
  - **Navy** — `contrast(1.05) saturate(0.9) hue-rotate(-5deg)`
  - **Editorial** — `contrast(1.1) saturate(0.7) sepia(0.15) brightness(0.98)`
  - **Cream** — `brightness(1.05) contrast(0.95) saturate(0.85) sepia(0.1)`
  - **Punch** — `contrast(1.15) saturate(1.2) brightness(1.02)`
- Tap a chip → selected chip gets a **gold border** (`var(--cap-gold)`), CSS class swaps on the photo frame, filter applies in **260 ms** via `transition: filter`. SR announces *"Filter Editorial applied"*.
- **Sticker button** opens a 5-slot tray with: 🗽 Nbhd (becomes neighborhood badge pill), 🧭 Route, ☀️ Sunny, 🌇 Golden, 💛 Love.
- Stickers pop onto the photo at a randomised offset from center via `stickerPop` keyframes (380 ms spring) — scale 0.4 → 1.15 → 1.
- Nbhd / Route stickers render as gold pill badges with text; emoji stickers render as 36 px drop-shadowed glyphs.

### Step 4 — Tagging (bottom sheet)
- Sheet snaps in below filter strip: `border-radius: 18px 18px 0 0`, `box-shadow: 0 -8px 32px rgba(0,0,0,0.35)`, `max-height: 62vh`.
- Handle bar at the top — tap to collapse the sheet to 76 px (just the handle), tap again to expand. `is-collapsed` class drives this via CSS `max-height` transition (**420 ms**).
- Contents (top → bottom):
  1. **Caption textarea** — placeholder *"Quick note about this spot…"*, gold focus ring, live character counter (`0 / 240`), goes to `notes` on save.
  2. **GPS + time strip** — pill chips:
     - `📍 Locating…` (italic muted) → `📍 Near Mercer & Prince St` (green) on success → `📍 Location unavailable` (red) on error.
     - `🕐 3:42 PM` — auto-stamped at open via `fmtTime(new Date())`.
  3. **Mood pills** (replaces "tags") — 7 pills, white with subtle border, **tap toggles** `aria-pressed`. Active state: navy fill, white text. Options: Photogenic, Cozy, Quiet, Buzzy, Hidden gem, Worth a return, Friend would love.
  4. **Revisit rating** — 4 pills in a row, color-coded when active: 1★ grey, 2★ blue, 3★ gold, 4★ green. `role="radiogroup"`, each `role="radio"` with `aria-checked`.
- **Save block**:
  - **"Save to my city"** — full-width 50 px button, navy background, gold focus ring, scales 0.985 on press.
  - **"Add to my route's archive"** — toggle switch, defaults **ON**, green when active, thumb slides 14 px right with a slight spring.

### Step 5 — Save (button → success → close)
- User taps Save.
- Button: `disabled = true`, label switches to **"Saving…"**.
- JS bakes the active CSS filter into the JPEG via a fresh `canvas` with `ctx.filter = "<filter css>"`, then redraws and re-encodes. Result stays under 320 KB.
- POST to `/api/spots/save` with the existing contract (`stopName`, `neighborhood`, `routeId`, `tags`, `rating`, `notes`, `photo`, `lat`, `lon`) **plus new fields**: `moods`, `filter`, `stickers`, `addToArchive`. `tags` is sent alongside `moods` for back-compat with the current server schema.
- On success:
  - **Success animation** fires (~760 ms total):
    - Gold inner border + outer glow pulses on the photo (`successGlow` keyframes — 720 ms, peaks at 20 %).
    - **12 gold sparkles** burst outward from photo center, each radiating 70–100 px at evenly-spaced angles, with an 18 ms-per-piece stagger.
    - Save button background animates to green (`.is-success`).
  - SR announces *"Saved to your archive"*.
  - **800 ms** later: `close()` runs — the modal fades out via `capture-out` (320 ms, opacity 1 → 0, translateY 0 → 8 px, scale 1 → 0.99).
  - `window.dispatchEvent('we:spot-saved')` fires so the app shell can refresh badges.
- On failure:
  - Button re-enables, label restored.
  - Toast: *"Failed to save — try again"*.
  - SR announces *"Save failed. Please try again."*

## Accessibility

- Dialog role: `role="dialog" aria-modal="true" aria-labelledby="capV2Title" aria-describedby="capV2Sub"`.
- Initial focus → close button; `Esc` closes; `Tab` / `Shift+Tab` cycle inside the modal (focus trap).
- Filter strip is `role="radiogroup"`, each chip `role="radio"` with `aria-checked`. SR announces filter name on apply.
- Mood pills use `aria-pressed`; rating pills use `role="radio"` + `aria-checked` + descriptive `aria-label` (e.g. "Four stars, must return").
- Caption has visible `<textarea>` with `aria-label` for SRs; live character counter is `aria-live="polite"`.
- Polite live region (`#capV2Live`) announces: open, photo captured, filter applied, save success, save failure.
- All interactive elements have a visible focus ring (2 px gold outline, 2 px offset).
- Reduced-motion: every animation in `capture.css` is wrapped or fallback-ed by `@media (prefers-reduced-motion: reduce)` — animations are disabled and the success glow shows in its end state instantly.

## State model

```
state = {
  photoData, photoBaked, photoNaturalW, photoNaturalH,
  filter: 'none' | 'navy' | 'editorial' | 'cream' | 'punch',
  stickers: [{id, glyph, label}],
  moods: Set<string>,
  rating: 1 | 2 | 3 | 4 | null,
  notes: string,
  stopName, neighborhood, routeId,
  addToArchive: bool,
  lat, lon, gpsState: 'pending' | 'locked' | 'error',
  capturedAt: Date,
}
```

## Public API

```js
import { CaptureV2 } from '/beta/app/v2-screens/capture.js';

CaptureV2.open(stop, route);   // {name} and {id, nbhd}
CaptureV2.close();
CaptureV2.setFilter('punch');
CaptureV2.toggleMood('Cozy');
CaptureV2.setRating(3);
CaptureV2.addSticker('💛', 'Love');
CaptureV2.save();
```

Falls back gracefully if `window.API` or `window.Toast` aren't present (uses `fetch('/api/spots/save')` and `console.log` respectively). Exposes itself as `window.CaptureV2` for the legacy non-module app shell.

## Files

- `beta/app/v2-screens/capture.html` — semantic markup, ARIA, focus targets
- `beta/app/v2-screens/capture.css` — full visual layer, animations, reduced-motion fallbacks
- `beta/app/v2-screens/capture.js` — ES-module controller, geolocation, canvas resize + filter bake, focus trap

## Design references hit

- **Instagram Stories editor** — filter strip with glass blur, live thumbnails, sticker tray
- **VSCO** — restrained 5-filter set, cinematic frame
- **BeReal capture** — single photo, intentional moment, full-screen immersion
- **Polarsteps add-photo** — caption + GPS-stamp + mood combo
- **Linear / Arc / Things 3** — gold accent, subtle springs, 220–420 ms motion vocabulary

## Notes for downstream agents

- The agent that owns the app shell needs to (a) `<link>` `capture.css`, (b) inject `capture.html` once at boot or include it in the SPA template, and (c) call `CaptureV2.open(stop, route)` instead of the legacy `Capture.open(...)` when "Save Spot" is tapped.
- Server (`api/spots/save.js`) currently expects `tags`; we send both `tags` and `moods` so no server change is required to ship. Future cleanup: drop `tags` once all clients are on v2 and add `filter` + `stickers` + `moods` to the persisted schema.
- The capture flash class `.capture-flash` is also defined in `v2-styles/motion.css`. Our local copy uses a separate keyframe name (`captureFlashLocal`) so the two don't conflict when both are present.
