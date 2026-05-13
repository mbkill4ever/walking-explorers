# v0.7.02 — Around Me

Owner: around-me agent
Files delivered (all NEW; no existing file touched):

- `beta/app/v2-screens/around-me.html`
- `beta/app/v2-screens/around-me.css`
- `beta/app/v2-screens/around-me.js`
- `agent_reports/v07_02_around_me.md` (this file)

## What this ships

A full-screen Leaflet map view named "Around Me" that fills the gap the user
called out in feedback: "there is no way to see, like, an option of what's
around you. So the GPS can appear, like, in real time where you are so you can
see all around you what is over there." Today the only map view in the app is
hidden inside a Detail screen after the user has already chosen one of the 12
routes. Around Me sits BEFORE that commitment — a live-location lobby of every
stop, every active offer, and a 20-minute reachable circle, so the user can
see the city the way the app already sees it, and then decide.

On mount the screen:

1. Boots a Leaflet map centered at the SoHo fallback (40.7235, -73.998) at
   zoom 14, so the user never stares at a grey rectangle while waiting for
   the GPS to lock.
2. Renders every curated stop from the 12 routes (72 stops total) as small
   navy circles, distance-clustered into 28px count-badges at zooms <15.
3. Starts `navigator.geolocation.watchPosition` with `enableHighAccuracy:true`.
   On first fix it hides the shimmer skeleton, drops a navy-dot user marker
   with a pulsing gold halo, slides the 1500m walk-ring to the user, and
   flies the map to zoom 15.
4. Populates the bottom-sheet's "Nearby stops" tab with the 10 closest stops
   (photo + name + 1-line "why this for you" + walking-distance badge), and
   the "Nearby routes" tab with the 5 closest routes by centroid distance.
5. Wires a "Offers nearby" chip in the top-left that toggles gold pins on the
   map for every promotion from `PROMOTIONS` (8 active).
6. Tapping any stop opens a peek card at the bottom with the stop's photo,
   neighborhood, "Part of [Route]", walking distance + minutes, and two
   actions: "Add to a quick walk" (writes to `State.draftStops`) and
   "Open route" (sets `State.currentRoute` + `Nav.go('detail')`).

When geolocation is denied (or unsupported), the navy-gradient empty state
takes over with a CSS-inline NYC skyline silhouette, a primary "Enable
location" CTA that re-prompts, and a secondary "Skip — show me Manhattan"
that anchors the map at SoHo without setting `userPos` (so the user
understands the gold dot is not their actual position).

## Architecture decisions worth flagging

- **No new dependencies.** Leaflet 1.9.4 is already loaded by the host
  index.html — the module references `L` as a global and falls back to the
  `<script src=leaflet.js>` tag inline in around-me.html only for standalone
  QA. Clustering is hand-rolled (greedy distance buckets per zoom level)
  rather than pulling `leaflet.markercluster`; for 72 stops it's plenty fast
  and zero extra weight.
- **Inlined data fallback.** `around-me.js` ships with `FALLBACK_ROUTES` and
  `FALLBACK_PROMOTIONS` mirrored from `lib/data.js` / app-shell.js as of
  v0.7.02. The module prefers `window.ROUTES` / `window.PROMOTIONS` when
  those exist (i.e. when mounted inside the app shell), and falls back to
  inlined data only when opened standalone. This is what makes the
  standalone QA loop possible without surgery on the data layer. If `ROUTES`
  ever changes shape this fallback must be kept in sync — flagged below
  under "Open questions".
- **Photos.json fetched once.** `loadPhotos()` tries three URL candidates so
  the same module works for standalone (`../v2-data/photos.json`) and
  shell-mounted (`/beta/app/v2-data/photos.json`) cases. Matching uses both
  array-index alignment (which holds for all 12 routes today) AND a
  case-insensitive substring fallback so a slight rename in either dataset
  doesn't break the peek-card photo.
- **Singleton, not a custom element.** I considered a `<we-around-me>` custom
  element but the rest of v2 sticks with module + `mount(container)` (see
  `right-now.js`), so I matched the convention. `AroundMe.destroy()` is
  rigorous about clearing `watchPosition`, removing every Leaflet handler
  the screen attached, and emptying the container — so the integrator can
  safely re-mount when the tab switches back.
- **Re-mount-safe.** Calling `AroundMe.mount(container)` twice destroys the
  previous instance before creating the new one.

## Integrator wiring (the punchline)

Open `beta/app/index.html` and wire ONE new tab. Concretely:

1. In whichever tab-bar JSX/HTML exists (search for "Explore" or "Right Now"
   labels — there's currently 3 tabs), add a 4th: `{ id: 'around', label: 'Around', icon: '🧭' }`.
2. Add a screen container next to the existing ones:
   ```html
   <section id="screen-around" class="screen" hidden></section>
   ```
3. In `beta/app/v2-scripts/app-shell.js`, where the other screens get
   mounted (search for `Nav.go` or the screen-switching reducer), add:
   ```js
   import AroundMe from '/beta/app/v2-screens/around-me.js';

   const ScreenHandlers = {
     // ...existing
     around: {
       enter() { AroundMe.mount(document.getElementById('screen-around')); },
       leave() { AroundMe.destroy(); }
     }
   };
   ```
   `enter()` should run when the tab becomes active; `leave()` when the user
   switches away. This is critical — leaving `watchPosition` running in the
   background drains the battery and the screen's own destroy() is the only
   place that calls `clearWatch`.
4. Add `<link rel="stylesheet" href="/beta/app/v2-screens/around-me.css">`
   to the `<head>` of index.html (alongside the other v2-screens CSS).
   Leaflet's CSS is already there from the existing map.css usage.

There is **no work required on the data layer**. The module reads
`window.ROUTES` and `window.PROMOTIONS` if app-shell.js has already hoisted
them onto window (it does today), and otherwise uses its inlined fallback.

## State + event contracts

- **`State.draftStops`** — array of stop objects the user pinned to "a quick
  walk." If your walk-builder doesn't read this yet, that's fine — the
  Around Me screen still tracks the intent via telemetry. When you wire the
  builder, just consume `State.draftStops` as the starting set.
- **`State.currentRoute`** — already used elsewhere; Around Me writes to it
  on "Open route" then calls `Nav.go('detail')`.
- **PostHog events** emitted (all under `around_me_*` for easy filtering):
  `around_me_mounted`, `around_me_first_fix`, `around_me_geo_error`,
  `around_me_permission_retry`, `around_me_fallback_used`,
  `around_me_offers_toggled`, `around_me_stop_peeked`,
  `around_me_promo_peeked`, `around_me_add_to_walk`, `around_me_open_route`,
  `around_me_route_opened`, `around_me_recentered`, `around_me_sheet_toggled`,
  `around_me_tab_changed`, `around_me_destroyed`. All fire through
  `window.Telemetry.track` (the existing PostHog stub).

## Design fidelity vs. the spec

- Navy + gold + cream palette throughout — pulled from the live tokens
  (`--navy`, `--gold`, `--cream`, `--ink`, `--mute`, `--line`) so a future
  dark-mode flip flows in automatically.
- The user marker is a navy dot with a gold pulsing halo (the spec called
  this out specifically). I deliberately did NOT use the gold-on-white dot
  from `map.css .we-user-dot` because the spec asked for the inverse on
  this screen. Both versions coexist — the existing route-detail map keeps
  its original look.
- All animations respect `prefers-reduced-motion`: the pulsing halo, the
  shimmer skeleton, the sheet/peek slide-in, and the cluster-marker hover.
- Map tiles get the same editorial filter `map.css .leaflet-tile-pane` ships
  for the rest of the app (grayscale 60% + sepia 20% + contrast 85%) so
  visual continuity is automatic.

## Standalone QA

Open `beta/app/v2-screens/around-me.html` directly in any modern browser:

- You'll get the "Locating you…" shimmer.
- If you allow location, the navy-dot + ring + nearby lists populate to
  wherever you actually are (with photos pulled from
  `../v2-data/photos.json`).
- If you deny, the navy-gradient empty state appears with the skyline
  silhouette and both CTAs work — "Skip" anchors at SoHo with the full
  marker layer rendered, "Enable" re-prompts.
- Tap "Offers nearby" — 8 gold pins drop on the map.
- Tap any stop — peek card with photo slides up from the bottom.
- Drag the bottom-sheet handle (or click it) — the Nearby stops / Nearby
  routes tabs become reachable.

## Open questions (for the integrator + Nova)

1. **Where exactly does the new tab live?** The current shell has Explore,
   Right Now, Archive. I assumed "Around" slots between Right Now and
   Archive — that's the natural read of "see what's around you BEFORE
   committing." Worth confirming before wiring the tab-bar.
2. **`State.draftStops` consumer.** The "Add to a quick walk" CTA writes to
   this array. If we want a visible cart-style affordance (e.g. a floating
   "3 stops queued · Build walk" pill), that's a separate ticket — happy to
   own that as v0.7.03 if helpful.
3. **`DEFAULT_LAT/LON` for non-NYC users.** Today the fallback is hardcoded
   to SoHo. Once we expand beyond NYC the integrator will want to feed in a
   per-region fallback through `AroundMe.mount(container, { fallbackCenter })`
   — the API already supports the option, just nobody passes it yet.
4. **Battery on the route-detail screen.** If the user goes Around → Detail,
   the Around Me screen's `watchPosition` is correctly cleared by `destroy()`
   on tab-leave — but if the integrator instead just `hidden`s the screen
   without calling `leave()`, the watch keeps running. The recipe above
   spells this out; please make sure the tab-switch handler hits `leave()`.
5. **Inlined data drift.** `FALLBACK_ROUTES` / `FALLBACK_PROMOTIONS` inside
   `around-me.js` is a duplicate of the canonical data, used only for the
   standalone QA path. If the canonical `ROUTES` schema changes meaningfully
   (e.g. stop adds a new field that the peek card should surface), we'll
   want to either (a) extend the fallback, or (b) drop the standalone test
   path and require app-shell mounting. (a) is cheap; (b) is cleaner. Right
   now I'm voting (a) because the standalone HTML has saved me roughly four
   debug cycles already.
6. **Marker clustering at higher densities.** My greedy bucket clusterer is
   O(N²) on stops-per-zoom-change. At 72 stops over 4 boroughs that's
   ~5,000 distance calcs per zoom — invisible. If the catalog grows past
   ~500 stops, switch to a grid hash or pull in `leaflet.markercluster`.

## Risk surface

- The peek card and the bottom sheet both occupy bottom-screen real estate.
  When both are open, the peek (`z-index: 700`) wins over the sheet
  (`z-index: 650`) — that's intentional. On phones <360px wide the peek
  card's two action buttons can wrap; tested OK at 320px in DevTools.
- iOS Safari sometimes silently fails `watchPosition` on insecure origins.
  All deployed URLs are HTTPS (Vercel) so this should be moot, but if
  someone tests via `file://` they'll see the empty state — that's not a
  bug, just a platform constraint.

## Telemetry to watch in week 1

- `around_me_first_fix` accuracy distribution — if median > 50m, we should
  consider widening the walk-ring or warning the user.
- `around_me_offers_toggled` toggle-on rate — strong signal of whether
  promotions belong on by default (currently off; my hypothesis is most
  users will leave them off until they're actively shopping).
- `around_me_open_route` conversion vs. the existing Right Now / Explore
  surfaces — if Around Me out-converts the editor's pick, that's the
  signal that the user's original feedback ("I want to see what's around
  me") generalizes well.
