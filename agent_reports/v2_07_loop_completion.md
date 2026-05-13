# v2-07 — Loop Completion Redesign

**Owner:** Loop-completion-redesign agent
**Date:** 2026-05-13
**Files shipped:**
- `beta/app/v2-screens/loop-completion.html`
- `beta/app/v2-screens/loop-completion.css`
- `beta/app/v2-screens/loop-completion.js`

## Mission recap

Replace the v1 4-line "Walk complete" + button with a brand-defining
success moment that earns shares, return visits, and word-of-mouth.
Reference apps: Strava Activity Complete, Polarsteps trip recap,
Apple Fitness close-the-ring, BeReal daily reveal.

## UX flow

Total scripted runtime: ~3.4s, then interactive.

### Phase 1 — Celebrate (0 – 1.4s)

1. Section mounts, `data-phase` flips from `idle` to `celebrate`.
2. The backdrop fades from cream to a navy gradient with a soft gold
   radial glow at the top.
3. A burst of ~140 confetti rectangles (navy / gold / gold-soft / cream)
   bursts from screen center with physics (gravity 0.35, drag 0.985,
   ~1.8s lifetime). Drawn to a single full-screen canvas at devicePixelRatio.
4. Hero illustration scales in. The illustration uses
   `<use href="…illustrations.svg#illus-loop-complete-hero"/>` with an
   inline gold-circle + animated ring fallback so the screen still looks
   correct before the design-system sprite is shipped.
5. Headline "That's a Loop." types in word-by-word with a
   blur-to-clear filter transition (700 ms each, 140 ms stagger).
   "Loop." is gold for emphasis.
6. Stats row count up from 0 → final value with an
   `easeOutExpo` curve over 1200 ms:
   `1.7 mi · 6 stops · 1h 30m`.

### Phase 2 — Map recap (1.4 – 3.2s)

1. `data-phase` flips to `recap`. Phase 1 stays visible — phase 2 fades
   in beneath it.
2. The route polyline draws itself across the map using a
   `stroke-dasharray` ↔ `stroke-dashoffset` animation timed to the
   real path length (`getTotalLength()`).
3. Stop markers (gold dot, cream stroke) pop in sequence with a
   60 ms stagger.
4. Photo polaroids (cream frame, slight -6° tilt, drop-shadow) fly in
   from above and pin themselves at the photo's GPS coordinates.
   Each photo carries a 120 ms stagger delay.
5. **Leaflet path:** if `window.L` is available, a non-interactive
   Leaflet map is mounted instead of the SVG fallback — same gold
   polyline, same stop markers. Tile source: OpenStreetMap. All
   interactions (drag, zoom, scroll-wheel) are disabled so the recap
   stays "framed art".
6. Zero photos → the polyline + markers still play, plus a
   small nudge: "Next time, save a spot. Long-press any marker to drop
   a photo."

### Phase 3 — Share + interact (3.2s →)

1. The on-screen preview canvas (540×675) paints the share card with
   the same routine as the 1080×1350 export, so what the user sees is
   what gets posted.
2. Three CTAs:
   - **Share** — `_generateShareCard(data)` produces a 1080×1350 PNG
     Blob. Calls `navigator.share({ files, title, text, url })` first
     (with `navigator.canShare` capability check), falls back to
     text-only `navigator.share`, then falls back to copying the link
     and triggering a PNG download. A toast confirms the fallback path.
   - **Send to a friend** — POSTs to `/api/loops/invite` for a referral
     code (falls back to a locally-generated `WE-XXXXXX` code if the
     endpoint is missing). Opens native share with the invite text.
   - **Walk another** — hides the screen and dispatches a
     `walking-explorers:walk-another` `CustomEvent` for the host shell.
3. Journal prompt — POSTs `{ note, at }` to `/api/loops/journal`, falls
   back to `localStorage["we:journal"]` if offline. Inline status flips
   from "Saves to your private notes." → "Saved." / "Saved locally."

## Share-card design (1080×1350)

Layered top → bottom:
1. Linear navy gradient background.
2. Gold radial glow at the top.
3. Gold dot + "Walking Explorers" wordmark, top-left.
4. Hero photo collage — 1-up, 2-up, 3-up, or 4-up tile layout based on
   how many user photos exist, masked into a rounded-rect with a gold
   hairline. Cover-fit cropping. If zero photos: a gradient panel with
   "A LOOP THROUGH `{NEIGHBORHOOD}`" — never blank.
5. Three stats — `Inter Black 96px`, gold, with `12px` uppercase
   labels beneath in cream.
6. Route title — `Inter Semibold 36px`, cream, wrapped to 2 lines.
7. Neighborhood — `Inter Medium 22px`, gold, uppercase.
8. Skyline silhouette across the bottom edge in `--color-navy-300`.
9. `walkingexplorers.com` wordmark at bottom-left.
10. QR-code-shaped marker at bottom-right linking to the loop URL.
    This is a stylized placeholder driven by a hash of the URL —
    swap with a real QR library (`qrcode-generator`) when one is
    bundled.

Fonts are loaded via CSS `font-family: Inter, -apple-system, …`. If
Inter is not loaded into the page, the canvas falls back to the
platform UI font without breaking layout.

## Accessibility

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` so the
  celebration is announced as a modal experience.
- `aria-live="polite"` region speaks the result line:
  "Walk complete. 1.7 miles. 6 stops. 1 hour 30 minutes."
- Skip-link (visually hidden but `:focus-visible` lifts it into view)
  jumps straight to the share card and forces all stats to their final
  values.
- `prefers-reduced-motion: reduce`:
  - No confetti.
  - No headline blur animation.
  - No count-up — stats render at final values immediately.
  - No polyline draw — full path rendered.
  - No photo fly-in.
  - Backdrop appears solid.
- All interactive elements have `:focus-visible` outlines (gold,
  3px offset).
- Touch targets are ≥52px.

## Responsive matrix

| Viewport | Behavior |
|----------|----------|
| ≤360px (iPhone SE) | Headline drops to `--text-3xl`; illus shrinks to 80px; stat values drop to `--text-xl`. |
| 361 – 767px | Default mobile layout — stacked CTAs, full-bleed phases at 560px max. |
| 768 – 1023px (iPad portrait) | Phases widen to 640px; CTAs become a row; share card preview grows to 420px. |
| ≥1024px (iPad landscape / desktop) | Phases widen to 720px; share card preview grows to 480px. |

## Resilience notes

- Renders correctly without `/beta/app/v2-styles/illustrations.svg`
  (inline fallback shapes).
- Renders correctly without `/beta/app/v2-styles/icons.svg` (inline
  fallback path on every `<use>`).
- Works without Leaflet (SVG polyline fallback).
- Works without `/api/loops/journal` (localStorage fallback).
- Works without `/api/loops/invite` (locally generated code).
- Works without `navigator.share` (clipboard + PNG download).
- Works without `navigator.clipboard` (silent best-effort).
- Works without DPR > 1 (canvas resolves at 1x).

## Wiring (for the host shell)

```js
import { LoopCompletion } from '/beta/app/v2-screens/loop-completion.js';

LoopCompletion.show({
  route:        [[lat,lng], …],
  stops:        [{ name, lat, lng }, …],
  photos:       [{ url, lat, lng }, …],
  duration:     5400,       // seconds
  miles:        1.7,
  neighborhood: 'Capitol Hill',
  title:        'The Stairway Loop',
  slug:         'stairway-loop',
});

window.addEventListener('walking-explorers:walk-another', () => {
  // navigate the host back to Explore
});
```

## Open follow-ups (out of scope for this agent)

- Bundle a real QR code generator and replace `_drawQrPlaceholder`.
- Implement `/api/loops/invite` and `/api/loops/journal` on the API
  side (Vercel + KV).
- Coordinate with the design-system agent to land the
  `#illus-loop-complete-hero`, `#icon-share`, and `#icon-friend`
  sprite entries in `v2-styles/`.
- Add an A/B-testable headline copy variant — possible alternates:
  "You closed it.", "Loop, closed.", "{n} stops. {miles} miles."
