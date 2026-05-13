# V2 — Icon System Report

**Agent:** v2_03_icons
**Date:** 2026-05-13
**Deliverable:** `beta/app/v2-styles/icons.svg`
**Commit:** `105950c` (file size 28.6 KB, 53 symbols)

---

## Usage

```html
<svg class="icon" aria-hidden="true" focusable="false">
  <use href="/beta/app/v2-styles/icons.svg#icon-explore"></use>
</svg>
```

Recommended CSS:

```css
.icon {
  width: 22px;
  height: 22px;
  color: var(--navy);          /* stroke color comes from currentColor */
  stroke: currentColor;
  fill: none;
  vertical-align: middle;
}
.icon-lg { width: 32px; height: 32px; }     /* for the brand mark */
.icon-active { color: var(--gold-dark); }
```

All icons inherit `currentColor` so a parent `color: ...` recolors stroke
(and the few intentionally filled shapes — `heart-fill`, `badge-check`,
the compass north needle, brand-mark skyline, sparkle accents).

---

## Style guarantees

- viewBox `0 0 24 24` for everything except `icon-walking-explorers` (`0 0 32 32`).
- `stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"` as the baseline.
- Inner safe area roughly 22×22 inside the 24-grid.
- Every `<symbol>` has a `<title>` for screen readers.
- Each icon carries a small narrative detail vs. generic geometry
  (see the thumbnail descriptions below).

---

## Icon inventory (53 total)

### Tab bar (5)

| ID | ASCII thumbnail | Narrative detail |
|----|----------------|------------------|
| `icon-explore` | `(O)` circle + diamond compass needle, pointing NE | needle is asymmetric, not perfect rhombus |
| `icon-archive` | `[==]` stacked memory pages with pin in the top sheet | small pin dot + stem = "saved location" |
| `icon-offers` | `<TAG` tag with a coffee-steam curl inside | reads as "a deal at a café" |
| `icon-feedback` | `(...)` speech bubble + check mark inside | check = "we heard you" |
| `icon-changelog` | `[||]` scroll/sheet + folded corner + sparkle | sparkle marks "new" |

### Navigation (8)

| ID | ASCII thumbnail | Notes |
|----|----------------|-------|
| `icon-back-arrow` | `<-` | rounded caps |
| `icon-forward-arrow` | `->` | rounded caps |
| `icon-close-x` | `X` | |
| `icon-menu-hamburger` | `=` 3 lines, middle one slightly shorter | editorial weight |
| `icon-settings-gear` | `*` 6-tooth gear with hollow center + small inner ring | |
| `icon-search` | `Q` magnifier, lens upper-left, handle lower-right | |
| `icon-filter` | `\_/` funnel + 3 internal rails | suggests filter chips |
| `icon-share` | `o-o-o` 3-node graph, 2 angled lines | |

### Walking & GPS (8)

| ID | ASCII thumbnail | Narrative detail |
|----|----------------|------------------|
| `icon-walking-person` | mid-stride figure, arm swing | head + leaning torso + open legs |
| `icon-footstep` | left foot, 3 toe dots | heel-print arch line (the requested twist) |
| `icon-route-line` | dotted curve with pins at both ends | gentle curve, not straight |
| `icon-map-pin` | teardrop pin + inner ring | classic but with breathing room |
| `icon-compass` | circle + N/S needle, N half filled | feels like a real compass card |
| `icon-location-arrow` | tilted NE triangle | classic GPS arrow |
| `icon-distance-ruler` | tilted ruler with 4 tick marks | implies measuring a route |
| `icon-time-clock` | clock at 2:00 | rounded hands |

### Capture & memory (8)

| ID | ASCII thumbnail | Narrative detail |
|----|----------------|------------------|
| `icon-camera` | camera body + lens + small viewfinder dot | viewfinder dot = "ready to shoot" |
| `icon-photo-stack` | 3 offset photo frames + small sun + mountain inside top frame | top frame contains a tiny landscape |
| `icon-bookmark` | ribbon | clean |
| `icon-heart-fill` | filled heart | stroked + filled in `currentColor` |
| `icon-star` | 5-point star | rounded joins |
| `icon-archive-box` | box + lid + pull-tab | physical "archive crate" feel |
| `icon-tag-label` | luggage tag with hole | reused on offers |
| `icon-note-pencil` | card + lines + pencil writing the corner | pencil bleeds outside the card edge |

### Routes & stops (10)

| ID | ASCII thumbnail | Narrative detail |
|----|----------------|------------------|
| `icon-cafe` | mug + handle + 2 steam curls | curls of steam (twist) |
| `icon-bookshop` | 3 stacked books, 1 leaning | one book leans diagonal |
| `icon-gallery` | picture frame + tiny sun + mountain inside | a painting in the frame |
| `icon-shopping` | shopping bag + handles + crinkle line | crinkle = paper, not plastic |
| `icon-restaurant` | fork (3 tines) + knife | not the generic spoon+fork |
| `icon-nature` | single leaf + central vein | leaf curves, vein is a line |
| `icon-viewpoint` | 2 binocular barrels + bridge + tiny ocular eyepieces on top | small lenses inside each barrel |
| `icon-historic` | Greek column: capital + 3 flutes + base | fluted shaft, capital + base |
| `icon-bar` | martini glass + olive on a stick | olive = filled dot at top of pick |
| `icon-park` | layered evergreen tree with trunk | 3-tier "Christmas tree" geometry |

### Weather + time (6)

| ID | ASCII thumbnail | Notes |
|----|----------------|-------|
| `icon-sun` | sun + 8 rays | |
| `icon-partly-cloudy` | small sun upper-left + cloud overlapping | sun peeks behind cloud |
| `icon-rain` | cloud + 3 raindrops | drops fall at slight angle |
| `icon-snow` | 6-arm snowflake | extra little forks at each tip |
| `icon-moon` | crescent + a tiny star | small star (editorial, not generic moon) |
| `icon-golden-hour` | half-sun setting on horizon + rays + a building edge | the requested signature mood — building silhouette on the horizon |

### Achievements & social (8)

| ID | ASCII thumbnail | Narrative detail |
|----|----------------|------------------|
| `icon-trophy` | cup + 2 ear handles + base + stem | full trophy with proper base |
| `icon-medal` | ribbon V + medallion + star inside | medallion has a filled star |
| `icon-group-of-people` | 2 heads + 2 shoulders, one slightly forward | composition feels like a small group, not a stack |
| `icon-invite-friend` | head + body + plus sign on the right | classic "add user" |
| `icon-vote-up-thumb` | thumbs-up + cuff | thumb extended cleanly |
| `icon-chat-bubble` | speech bubble + 3 dots inside | dots = active typing |
| `icon-badge-check` | scalloped rosette badge + filled check | check is reverse-knockout in cream |
| `icon-sparkle` | 4-point star + small accent star | extra little accent sparkle |

### Brand signature (1, 32×32)

| ID | ASCII thumbnail | Narrative detail |
|----|----------------|------------------|
| `icon-walking-explorers` | filled NYC skyline silhouette across the top + tiny walking figure mid-stride below + gold-dot destination ahead | the skyline polygon is a simplified port of `/index.html .skyline` (7 building peaks instead of 25). The figure walks toward a dot on the right — the Walking Explorers narrative compressed into a 32×32 mark. |

---

## Notes for the integration agent

1. The sprite is one file; reference symbols via `#icon-<id>`.
2. Default rendering wants `width: 22px; height: 22px` (the spec's tab-bar size). Brand mark wants 32×32.
3. `icon-badge-check` uses `fill: var(--cream, #FAF7F2)` for the inner check stroke so the knockout is visible on dark badges. If the integration palette ever changes cream, override that fill at the use-site:
   ```html
   <svg style="--cream: #fff;">
     <use href="...#icon-badge-check"/>
   </svg>
   ```
4. Filled icons (intentionally): `icon-heart-fill`, `icon-badge-check`, the compass north needle (half), brand mark skyline, sparkle accent dots. Everything else is stroke-only.
5. No raster, no embedded fonts, no external references — safe to inline or `<use>` cross-origin once `crossOrigin` is configured on the use-site.
6. The sprite has `style="display:none"` on the root `<svg>` so it can be `<object>`-loaded or fetch-embedded without taking layout space.

---

## Files touched

- **Created:** `beta/app/v2-styles/icons.svg`
- **Created:** `agent_reports/v2_03_icons.md` (this file)

Nothing else was modified.
