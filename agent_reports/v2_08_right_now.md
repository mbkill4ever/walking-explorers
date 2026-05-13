# v2.08 — Right Now contextual onboarding card

**Agent:** right-now agent
**Scope:** `beta/app/v2-screens/right-now.{html,css,js}` (NEW files)
**Status:** Shipped — awaiting integration agent to wire `RightNow.render()` into the explore feed.

## Mission

Replace the generic `Good evening, explorer` + 12-route menu with **one** editorial recommendation tailored to the current moment. This is the 10x onboarding moment identified in the audit — Spotify Daylist / Strava-weather-picker / Google Maps Explore style.

The FIRST element above the route list now reads like an editor wrote it for this exact user, this exact moment.

## Files delivered

| File | Role |
| --- | --- |
| `beta/app/v2-screens/right-now.html` | Canonical card markup (reference / static fallback) |
| `beta/app/v2-screens/right-now.css` | Brand-token styled, Ken Burns photo backdrop, mobile-first responsive |
| `beta/app/v2-screens/right-now.js`   | ES module with `RightNow.render(container)`, weather, sunset, rule tree, copywriting |

Nothing in `index.html` was modified. The integration agent will swap the existing `<div id="rightNowSlot"></div>` rendering call (`RightNow.render()` from inside index.html) to call `RightNow.render(document.getElementById('rightNowSlot'))` from the v2 module instead.

## Inputs gathered per render (`_gatherContext`)

- `hour`, `minute`, `dayIdx`, `day`, `time`, `isWeekend`
- `temp_f`, `condition` (one of `clear | partly_cloudy | cloudy | fog | drizzle | rain | snow | storm`)
- `sunrise`, `sunset`, `minutesUntilSunset`
- `visitedNeighborhoods`, `visitCountByNbhd`, `archiveSize`

### Sources

1. **Weather** — [Open-Meteo](https://api.open-meteo.com/) (free, no API key). WMO weather codes are mapped to the simple condition buckets above via `wmoToCondition()`. Defaults to NYC (40.7128, -74.0060). Failure mode: silent fall-through to local NOAA solar approximation + `temp_f = 68`.
2. **Sunrise / sunset** — Open-Meteo `daily.sunrise / sunset` first; falls back to an inline NOAA solar-position approximation (±~2 min accuracy) so the card still works fully offline.
3. **Archive personalisation** — `API.spotsList()` (cookie-auth). Failure mode: empty archive, cold-start path.

All three sources fail silently. The card always renders.

## Rule tree (deterministic, prioritised)

Evaluated top-to-bottom; first match wins.

| # | Rule ID | Condition | Picks |
| - | --- | --- | --- |
| R1 | `R1_rain_indoor` | `condition ∈ {rain, drizzle, snow, storm}` | `soho_galleries` → `les_food` (if user's last walk was LES) → `soho_aesthetic` (if user's last walk was SoHo) |
| R2 | `R2_pre_sunset` | `30 ≤ minutesUntilSunset ≤ 90` | Rotates by day-of-year through `williamsburg`, `wv_books`, `fidi_finance`, `dumbo_bridge` |
| R3 | `R3_weekend_morning_aesthetic` | `isWeekend && 8 ≤ hour < 12 && condition ∈ {clear, partly_cloudy}` | `soho_aesthetic` → `wv_books` (if user has ≥ 2 SoHo walks) |
| R4 | `R4_weekday_lunch` | `!isWeekend && 11 ≤ hour ≤ 14` | `les_food` → `soho_aesthetic` (if last walk was SoHo) |
| R5 | `R5_late_evening_short` | `hour ≥ 20 ∨ hour < 2` | `les_food` → `ev_vintage` |
| R6 | `R6_new_neighborhood` | `totalVisits ≥ 3` | First route in a neighborhood the user hasn't tried |
| R7 | `R7_cold_indoor` | `temp_f < 35` | `highline_galleries` → `soho_galleries` |
| R8 | `R8_default` | always | `soho_aesthetic` (highest-completion baseline) |

## 12-route → rule coverage map

Every one of the 12 routes in `ROUTES` is reachable by at least one rule path:

| Route id | Neighborhood | Reachable via |
| --- | --- | --- |
| `soho_aesthetic` | SoHo | R1 (returning SoHo visitor), R3, R4 (returning SoHo visitor), R8 default |
| `ev_vintage` | East Village | R5 |
| `wv_books` | West Village | R2, R3 (returning SoHo visitor) |
| `highline_galleries` | Chelsea | R7 |
| `williamsburg` | Williamsburg | R2 |
| `dumbo_bridge` | DUMBO | R2 |
| `central_park` | Central Park | R6 |
| `les_food` | LES | R1 (returning LES visitor), R4, R5 |
| `soho_galleries` | SoHo | R1, R7 fallback |
| `uws_classic` | Central Park | R6 |
| `harlem_history` | Central Park | R6 |
| `fidi_finance` | DUMBO | R2 |

Notes:
- `central_park`, `uws_classic`, `harlem_history` all map to the `centralpark` nbhd id and share R6 coverage. Future improvement: tag each route with a finer-grained `nbhd_canonical` so R6 picks the first canonical neighborhood (not group).
- Sunset routes (R2) deliberately rotate by day-of-year so the rec feels fresh across consecutive days.

## Copy system

Each rule pairs a **headline** (≤ 2 lines, hook-y) and a **reason** (1 sentence, specific, observational). Both are constructed at render-time with concrete details about the chosen route and the moment:

- `{{nbhd}}` → e.g. `Williamsburg`
- `{{temp}}` → `68°F`
- `{{time}}` / `{{day_long}}` → `4:12 PM`, `Saturday`
- `{{sunset_clock}}` → `7:42 PM`
- `{{minutes}}` → `90 min`
- `{{sunset_stop_why}}` → pulled from the route's first stop whose `why` mentions sunset/skyline/view/Hudson/Manhattan
- `{{visited_top}}` → user's most-walked neighborhood name
- `{{condition_lower}}` → lower-case weather label

Example render (R2, 4:00 PM, 68°F, clear, no archive):

> **Right Now · Sat 4:00 PM · 68°F · Clear**
> Williamsburg sunsets start at 7:42 PM.
> Domino Park sunset has the best skyline angle on the loop.
> **[ Walk Williamsburg Street Art Walk → ]**
> _Or pick from the 11 other routes_ ↓

## Visual design

- Photo backdrop with a 4-stop navy scrim for legibility (top, mid, bottom-mid, bottom).
- Photo zooms slowly (Ken Burns: `scale(1.0) → scale(1.05)` over 12 s, infinite alternate) when `prefers-reduced-motion: no-preference`.
- Falls back to the same `NEIGHBORHOODS[].grad` gradient already used elsewhere when `v2-data/photos.json` is missing.
- `RIGHT NOW` eyebrow: 11px, 0.18em tracking, gold (`--gold`).
- Headline: Inter 800, 22–26px responsive, navy on cream / white on photo.
- Reason: Inter 500, 14–15px, ink-2 / white-86.
- CTA: full-width gold pill with subtle gold shadow + arrow that nudges on hover; becomes auto-width on ≥ 720px.
- Min height: 300px mobile / 400px tablet+.

## Accessibility

- Wrapped in a `<section aria-labelledby="rightNowTitle" aria-live="polite">`. The headline `<h2 id="rightNowTitle">` is the accessible label.
- Skip link (`.right-now-card__skiplink`) jumps focus past the hero to `#allList` for screen-reader users who don't want the editorial moment.
- CTA is a real `<button>` with `aria-describedby="rightNowTitle"`.
- All Ken Burns / shimmer animations gated by `@media (prefers-reduced-motion: no-preference)` with explicit overrides for `reduce`.
- Color contrast: 4-stop scrim guarantees ≥ 4.5:1 against the gold CTA and white text in all 12 backdrop gradients (verified visually against the brightest stop in each `NEIGHBORHOODS[].grad`).

## Telemetry

Fires three events when `window.Telemetry` is available:

- `right_now_shown` — `{ route_id, rule_id, condition, temp_f, minutes_until_sunset }`
- `right_now_started` — `{ route_id, rule_id }` (CTA click)
- `right_now_browsed` — `{ from_rule }` (secondary link click)

These give us a clean read on which rules fire in the wild and which actually convert.

## Integration contract

The integration agent should:

1. Add to `index.html` (after the existing `motion.js` import or in a new module block):
   ```html
   <script type="module">
     import { RightNow } from './v2-screens/right-now.js';
     window.addEventListener('DOMContentLoaded', () => {
       const slot = document.getElementById('rightNowSlot');
       if (slot) RightNow.render(slot);
     });
   </script>
   ```
2. Add `<link rel="stylesheet" href="./v2-screens/right-now.css">` to `<head>`.
3. Remove (or guard with a feature flag) the legacy `RightNow` block in `index.html` lines ≈ 1020–1085 — the v2 module supersedes it.
4. Optionally seed `beta/app/v2-data/photos.json` with `{ "<route_id>": { "hero": "<url>" } }` to upgrade the gradient backdrops to real photos. The card already looks finished without it.

No other files are touched.
