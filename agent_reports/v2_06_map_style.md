# v2-06 — Map Style Agent Report

**Date:** 2026-05-13
**Agent:** map-style (v2 build)
**Scope:** Owns EXCLUSIVELY `beta/app/v2-styles/map.css` and `beta/app/v2-scripts/map.js`.
**Status:** Shipped to `main`.

---

## Mission recap

Stock OSM tiles are loud and generic. We can't afford Mapbox in v0.6, so we stay
on Leaflet + OSM and reskin everything we control via CSS filters and custom
Leaflet primitives. The target aesthetic is a New Yorker / Atlas Obscura
illustrated map: muted, editorial, navy + gold.

## What shipped

### `beta/app/v2-styles/map.css`

| Section | Purpose |
|---|---|
| `.leaflet-tile-pane` filter | `grayscale(60%) sepia(20%) contrast(85%) brightness(105%)` — mutes greens, adds a cream undertone, softens harshness. The single biggest visual win. |
| Dark-mode tile filter | `grayscale(70%) invert(85%) hue-rotate(180deg) brightness(85%)` — inverted, cool, still muted. Triggered by `prefers-color-scheme: dark`. |
| `.we-marker-stop` | Navy circle, cream border, numbered. Variants: `.sponsored` (gold flipped palette), `.visited` (faded), `.current` (pulsing halo via keyframes). |
| `.we-marker-spot` | 44px photo-thumbnail circle for the archive map. |
| `.we-route-path` | Navy dashed polyline with drop-shadow. `draw-route` keyframe animates `stroke-dashoffset` from 400 → 0 over 1.6s. |
| `.we-route-walked` | Solid gold polyline for completed portion of the walk. |
| Popups | Cream card, 16px radius, optional 16:9 photo banner, editorial typography (`pop-title`, `pop-meta`, `pop-body`, `pop-cta`). |
| Attribution | Translucent cream pill with backdrop blur — barely there. |
| Zoom controls | Cream rounded buttons, navy glyphs, gold focus ring. |
| `.we-user-dot` | Gold pulsing dot for the user's live location. |
| `prefers-reduced-motion` | All keyframes (`pulse-current`, `draw-route`, `pulse-user`) disabled. |

### `beta/app/v2-scripts/map.js`

ES module exporting a `Map` object with three factories matching the brief:

- `Map.createDetailMap(container, route)` — full route preview, no current-stop pulse, `scrollWheelZoom: false`, fits bounds to the path.
- `Map.createWalkMap(container, route, currentIdx)` — live walking view: dashed full route + solid gold walked portion + visited/current/upcoming marker states, centers on current stop, `currentIdx` marker gets `zIndexOffset: 1000`.
- `Map.createArchiveMap(container, spots)` — photo-thumbnail markers, no route line, sensible fallbacks for 0/1/N spots.

Also exported via `Map._internals` for tests:

- `_createStopMarker(stop, idx, { isCurrent, isVisited })`
- `_createSpotMarker(spot)`
- `_createPopupContent({ name, kind, photoUrl, body, ctaLabel, ctaHref })`
- `_drawRoute(map, coords)`

Plus `Map.destroy(map)` for SPA route teardown.

## Accessibility

- Every `divIcon` carries `role="img"` + a descriptive `aria-label` (stop number, name, sponsored/current/visited state).
- Every Leaflet marker gets `alt` and `title` set on the underlying image.
- Map containers get `role="region"` + `aria-label` ("Walk route map", "Live walking map", "My saved spots map").
- Popup CTA links carry `rel="noopener"`.
- All popup/marker content runs through an `_escape()` helper before going into `innerHTML`.
- Zoom controls expose a `:focus-visible` gold outline.
- All three pulse/draw animations are gated by `prefers-reduced-motion: reduce`.

## Technical notes / decisions

1. **CSS filter on `.leaflet-tile-pane`, not individual tiles.** Tile-level filters cause seam flicker during pan; pane-level is one composited layer.
2. **Stroke styling in CSS, color/weight repeated on the JS polyline.** Leaflet won't emit the SVG `<path>` without at least some inline stroke props, so we set them both places. The CSS rules win for `stroke-dasharray`, `filter`, and the animation.
3. **`smoothFactor: 1.2`** on the route — slight simplification at low zooms, keeps the line readable on mobile without losing turn detail.
4. **Photo-thumbnail markers** use `background-image` (rather than an `<img>`) so the cream ring and circular crop work without extra DOM.
5. **Empty archive fallback** lands on NYC (40.7128, -74.006) at zoom 12 — same default we use elsewhere in the app.

## Out of scope (deliberately)

- Did not touch `index.html`, tokens, components, or any existing JS — strict file ownership per brief.
- No Mapbox / MapLibre swap — locked to OSM for v0.6 per the cost constraint.
- No service-worker tile caching — separate concern, owned by the offline agent.
- No clustering for archive — punted to v0.7 when spot counts grow.

## How to wire it up (for the integration agent)

```html
<link rel="stylesheet" href="/beta/app/v2-styles/map.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script type="module">
  import { Map } from '/beta/app/v2-scripts/map.js';
  const map = Map.createWalkMap(document.getElementById('map'), route, 2);
</script>
```

## Files changed

- `beta/app/v2-styles/map.css` (new)
- `beta/app/v2-scripts/map.js` (new)
- `agent_reports/v2_06_map_style.md` (this report)
