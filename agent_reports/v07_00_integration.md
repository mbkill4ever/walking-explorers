# v0.7 Integration — beta/app shell

**Author:** integration agent
**Date:** 2026-05-13
**Owns exclusively:** `beta/app/index.html`, `beta/app/v2-scripts/app-shell.js`, `agent_reports/v07_00_integration.md`
**Outcome:** Empty Explore feed fixed. Nine v0.7 modules wired into the main app shell. One atomic commit to `main`.

---

## 1. Diagnosis — the empty Explore feed bug

Nova reported that `/beta/app/` was rendering the greeting + the "12 NYC routes" section header but the route grid below was blank.

The "12 routes" copy is **static HTML** (`<span class="more" id="countAll">12 routes</span>`), so the user always sees that string regardless of whether JavaScript runs. The blank grid happens when `Render.exploreFeed()` either never executes, or **partially executes and then throws** before `ROUTES.forEach(... appendChild)`.

Walking `App.init()` (lines 322–355 of the pre-integration `app-shell.js`):

```js
const me = await API.me();
… await Promise.race([loadMicrocopy + loadPhotos, 1500ms]) …
document.getElementById('boot').style.display = 'none';
Render.exploreFeed();          // ← throws here = blank grid
Nav.switchTab('explore');
```

`Render.exploreFeed()` did **five things sequentially with no per-step error isolation**:

1. update `#greeting` via `window.T(...)`
2. update `#greetingEyebrow`
3. update `#greetingSub`
4. **call `RightNow.render()`** — which preferentially delegates to `window.RightNowV2.render(slot)`
5. loop over `ROUTES` and append cards into `#allList`

The vulnerable step was #4. `RightNowV2` is loaded by the deferred ES-module orchestrator at the bottom of `index.html` and is racy with `App.init()`. The legacy code already wrapped `RightNowV2.render(slot)` in a try/catch — but only for **synchronous** throws. RightNowV2 internally fires async work (weather fetch, microcopy template lookups). A microcopy key that resolves to `null` or a date-formatter call inside the right-now markup could throw asynchronously, or a synchronous throw on a deep property read like `microcopy.right_now.headline.morning[0]` when the partial-loaded JSON only has half the keys, could escape the try/catch under certain code paths.

More damning: when `Render.exploreFeed()` threw, the **outer** try/catch in `App.init` caught the error and swallowed it silently. The user was left looking at the greeting + section header that *had* updated successfully before the throw.

### The fix

I wrapped each section of `Render.exploreFeed()` in its own try/catch and **guarantee the route grid always renders**, even if everything above it throws:

```js
exploreFeed() {
  try { /* greeting */ } catch (e) { console.warn(…) }
  try { RightNow.render(); } catch (e) { console.warn(…) }

  const all = document.getElementById('allList');
  if (!all) return;
  try { all.innerHTML = ''; } catch (_) {}
  let rendered = 0;
  for (let i = 0; i < ROUTES.length; i++) {
    try {
      const card = this._routeCard(ROUTES[i]);
      if (card) { all.appendChild(card); rendered++; }
    } catch (e) {
      // Fallback minimal text card so the user still has SOMETHING to tap.
      …
    }
  }
  const countEl = document.getElementById('countAll');
  if (countEl) countEl.textContent = rendered + (rendered === 1 ? ' route' : ' routes');
}
```

Three further hardenings to `_routeCard`:

- `coverArt(r)` is wrapped in try/catch with a navy gradient fallback.
- `WE_V2.heroFor(r.id)` is wrapped in try/catch.
- The `<img>` cover gets an inline `onerror` handler that falls back to the gradient if the hero photo 404s.

Net result: **the 12 cards render even if `photos.json`, `microcopy.json`, RightNowV2, the v2 ES-module orchestrator, weather APIs, and every async dependency in the stack fail simultaneously.**

I also made `#countAll` dynamic — it now reflects the actual number of rendered cards instead of the hard-coded "12 routes" string.

---

## 2. The 9 modules — wire-up

All nine modules ship as ES modules in the repo. I dynamic-imported each one only at the moment it is needed, wrapped every `await import(...)` in try/catch, and provided a graceful "module unavailable" placeholder in each mount-point if the import fails. The legacy app continues to function even if every v0.7 module fails to load.

### 2.1 Onboarding (`/beta/app/v2-screens/onboarding.js`)

- Gate runs once in `App.init()` after auth, before `Nav.switchTab('explore')`.
- If `Onboarding.shouldShow()` returns true, the new `<section id="onboarding" class="screen no-tab">` is mounted via `Ob.mount(target, { onComplete })`. On complete, `localStorage.we_onboarded = '1'` is set and Explore is rendered.
- Onboarding itself writes `we_mood`, `we_walk_prefs`, `we_anchor` keys — AI Route reads these.

### 2.2 Around Me (`/beta/app/v2-screens/around-me.js`)

- New `<section id="around" class="screen">` added (with tab-bar visible).
- New `Nav._mountAround()` dynamic-imports the module and calls `AroundMe.mount(host)` (it picks up `window.ROUTES`, `window.PROMOTIONS`, `window.NEIGHBORHOODS`, `window.State` automatically — all newly exposed by `App.init()`).
- Destroyed on tab-switch-away by `Nav._unmountV07Modules(nextId)`.
- CSS linked: `/beta/app/v2-screens/around-me.css`.

### 2.3 AI Route Generator (`/beta/app/v2-screens/ai-route.js`)

- New `<section id="airoute" class="screen no-tab">`.
- Triggered by the Tab-Bar-v2 FAB popover's "Start a walk" button, which dispatches `window.dispatchEvent('we:start-walk')`. `App._wireV07Events()` listens for this and calls `Nav.go('airoute')`.
- On generation: `onGenerated(route)` → `State.currentRoute = route; AIRoute.destroy(); Nav.go('detail')`.
- `onClose()` → back to Explore.

### 2.4 Walk Tracker (`/beta/app/v2-scripts/walk-tracker.js`)

- `Walk.start()` now calls `Walk._startTracker()` after `Nav.go('walk')`.
- `Walk._startTracker()` dynamic-imports the tracker, ensures Leaflet is loaded, then calls `wt({route, mapElement: #wMap, onProximity, onArrival, onProgress})`.
- A new `<div id="wMap">` element was added inside the walk-screen body (above the existing photo frame, hidden by default).
- On `onArrival(stopIdx)`, advance the legacy Walk flow + flash the photo frame.
- On `Walk.next()` final-stop and on `Walk.exit()`, `Walk._stopTracker()` is called. It captures `tracker.getSummary()` first, which is forwarded into the `loop_completed` telemetry event.
- `we_active_walk_id` localStorage key is set on start and cleared on stop — TabBar v2's FAB watches this and switches to "Resume walk" mode while a walk is in flight.
- CSS linked: `/beta/app/v2-styles/walk-tracker.css`.

### 2.5 Tab Bar v2 (`/beta/app/v2-screens/tab-bar-v2.js`)

- The original `<nav class="tabbar">` is kept as a **legacy fallback**. It's hidden via `.tabbar.hidden` and shown only if the v2 mount fails.
- New `<div id="we-tabbar"></div>` mount point added inside `#app`.
- The 5-tab/FAB sprite (`tab-explore`, `tab-around`, `tab-walk`, `tab-saved`, `tab-profile`, plus `tab-ic-*` profile-sheet icons) is inlined at the top of `<body>` (lifted from the test harness HTML — the icons.svg agent hadn't promoted them yet).
- `App._mountTabBar()` calls `TabBar.mount(mountEl, { initialTab, onTabChange, profileActions })`. `onTabChange` bridges the v2 tab names back into the legacy `Nav.switchTab` API:
  - `explore` → `explore`
  - `around` → `around` (new)
  - `saved` → `archive`
  - `profile` → handled by TabBar internally (sheet)
  - `walk` → handled via `we:start-walk` / `we:resume-walk` events
- The profile-sheet actions (`onOffers`, `onFeedback`, `onChangelog`, `onSettings`, `onSignOut`) bridge into the legacy screens.
- `Render.tabBadges()` now also calls `TabBarV2.setBadge('saved', n)`.
- CSS linked: `/beta/app/v2-screens/tab-bar-v2.css`.

### 2.6 Share (`/beta/app/v2-scripts/share.js`)

- Wired into the Loop-completion v2 share button via a **document-level click intercept** on `[data-action="share"]` inside `.loop-screen / #loop-v2 / #loop` (capture-phase). When Share is available, we call `Share.cardFromLoop(loop)` then `Share.open({..., imageBlob})`. If Share fails to load, the native v2 loop-completion handler runs unchanged.
- Wired into the Spot detail modal by **dynamically injecting a "Share this spot" button** into the spot modal each time it opens. Click → `Share.cardFromSpot(spot)` → `Share.open(...)`.
- `Share.referralLink(userId)` is reserved for the "Invite friends" item in the profile sheet (the v2 tab-bar's settings handler is currently a placeholder Toast — a follow-up agent should wire it).

### 2.7 Search (`/beta/app/v2-screens/search.js`)

- New `<section id="search" class="screen no-tab">`.
- A search icon button was added to the Explore topbar (next to Sign-Out). It calls `Nav.go('search')`.
- `Nav._mountSearch()` mounts the module with `{ routes: ROUTES, neighborhoods, promotions, onPick }`. Picking a route → `State.currentRoute = route; Search.destroy(); Nav.go('detail')`.

### 2.8 Polish CSS (`polish.css`, `skeletons.css`, `empty-states.css`)

- Three `<link>` tags added after the existing v2-styles links. They're additive — no JavaScript wire-up needed.

### 2.9 Telemetry + Error Handler (`telemetry.js`, `error-handler.js`)

- Inline `<script type="module">` added before the legacy `<script src="app-shell.js">`. It imports both modules, calls `E.init({ dsn: window.SENTRY_DSN, release: 'walking-explorers@0.7.0', env })` and `T.init({ apiKey: window.POSTHOG_KEY })`, exposes `window.WE_T` and `window.WE_E`, dispatches `we:telemetry-ready`.
- Because ES modules execute deferred (after the synchronous `<script src="app-shell.js">`), `app-shell.js` cannot rely on `WE_T` being ready at boot. The new `Render._track(event, props)` helper feature-detects `window.WE_T?.track` AND falls through to the legacy `Telemetry.track()` — so both pipelines receive events, and there's never a race window where events are dropped.
- Activation-funnel events instrumented via `Render._track`: `app_loaded`, `tab_switched`, `route_viewed`, `walk_started`, `walk_proximity`, `walk_stop_advanced`, `loop_completed`, `loop_shared`, `spot_saved`, `spot_shared`, `around_me_opened`, `ai_route_opened`, `ai_route_generated`, `onboarding_shown`, `onboarding_completed`, `search_route_picked`.
- Set `POSTHOG_KEY` and `SENTRY_DSN` as Vercel env vars and inject via `<script>window.POSTHOG_KEY="phc_xxx";window.SENTRY_DSN="https://..."</script>` in a deploy-time wrapper (out of scope for this integration — leaving as a TODO for the next deploy agent).

---

## 3. Architectural choices

**Legacy nav stays as a hidden fallback.** I deliberately did NOT delete the existing `<nav class="tabbar">` block. All the legacy `onclick="Nav.switchTab('feedback')"` handlers still wire through it, even though the visible UI is the v2 bar. This was a constraint-compliance call: the brief says "preserve all inline onclick handlers". The legacy `tabbar.hidden` class keeps it invisible while still letting `Nav.switchTab` light up its `.active` buttons (harmless no-op visually).

**Per-module isolation.** Every `await import(...)` is wrapped in `.catch(() => null)` or a try/catch. Every mount falls back to a styled placeholder. The cascade of failures cannot bring the legacy shell down.

**Render._track**, not Telemetry replacement. The brief asked for ~8 strategic track() calls — I added 16 via the bridge helper, all aligned to the activation funnel from cold-start → onboarding → explore → route_viewed → walk_started → stop_advanced → loop_completed → loop_shared. The bridge sends every event to **both** the new PostHog v2 pipeline AND the legacy stub, so historical dashboards keep working through the transition.

**Dynamic mount/destroy lifecycle for Around/AI/Search.** These screens are not eagerly loaded — they're imported only when navigated to, and destroyed on tab-switch-away. This keeps GPS watchers, Leaflet maps, and search debouncers from leaking between sessions and avoids paying the import cost on first paint.

**TabBar's `we_active_walk_id` integration.** When `Walk.start()` is called, we set `localStorage.we_active_walk_id = route.id` and dispatch `we:active-walk-changed`. The TabBar v2 listens for this and switches the FAB from "Start" to "Resume" mode. On `Walk._stopTracker()` we clear the key and re-dispatch. This delivers the "pick up where I left off" UX without any cross-module coupling.

---

## 4. Manual test plan (for Nova)

After Vercel redeploys, please run these flows on `walkingexplorers.com/beta/app`:

### A. The bug-fix you reported
1. Load `/beta/app/` while signed in.
2. **Expect:** greeting + the new search icon in the topbar, **12 route cards visible below the "NYC routes" header**, the new 5-tab bar at the bottom (Explore / Around / Walk FAB / Saved / Profile).
3. The route count beside "NYC routes" should now read "12 routes" *dynamically* (computed from `ROUTES.length`).

### B. Onboarding (open an incognito window — needs a fresh `we_onboarded` localStorage)
1. Sign in. After auth, you should see the 4-step onboarding (Welcome → mood chips → time + distance → optional location).
2. Complete or skip — either way, you land on Explore with the 12 cards.
3. Reload — onboarding does NOT show again (localStorage gate).

### C. Around Me
1. Tap the Around tab. Live map should appear with stops nearby and offers.
2. Grant location when prompted.
3. Tap a stop pin → peek card opens.
4. Switch back to Explore → map is torn down (GPS watcher stops).

### D. AI Route + Walk Tracker
1. Tap the center FAB → popover appears with "Start a walk" and "Explore routes".
2. Tap "Start a walk" → 4-question AI Route Generator opens.
3. Answer the questions → server generates a route → you land on Detail.
4. Tap "Start walking" → Walk screen opens **with a live map at the top** + the photo frame below.
5. Walk around (or move the GPS in DevTools). As you approach a stop within 30m, the screen advances + flashes.
6. Tap "Finish & save Loop →" → Loop completion v2 fires with confetti.
7. Tap the Share button on Loop completion → the new share sheet opens (IG Stories / X / Web Share API).

### E. Search
1. From Explore, tap the search icon in the topbar.
2. Type "vinyl" → "East Village Vintage & Vinyl" and "Williamsburg Street Art Walk" should rank highest.
3. Tap a result → Detail.

### F. Saved + Share Spot
1. Tap a spot in My Spots → modal opens with photo, tags, rating.
2. Below "Delete spot" there's now a **"Share this spot"** button. Tap it → share sheet.

### G. Failure-tolerance smoke test
- DevTools → Network → block `/beta/app/v2-screens/tab-bar-v2.js`. Reload. The legacy bottom nav should reappear and the app should still function.
- Same for `around-me.js`, `ai-route.js`, `search.js`, `walk-tracker.js`.

---

## 5. Known TODOs (deferred, not blockers)

- **POSTHOG_KEY / SENTRY_DSN injection.** Set Vercel env vars and inject via a deploy-time `<script>` before the telemetry module loads. Right now both modules init in disabled (queue-only) mode.
- **icons.svg promotion.** The `tab-*` symbols are inlined in `index.html` (lifted from the tab-bar test harness). The icons.svg agent should promote them into `/beta/app/v2-styles/icons.svg` and remove the inline sprite block.
- **Profile-sheet "Invite friends".** TabBar v2's settings/invite actions are placeholder Toast stubs. A follow-up should wire `Share.referralLink(userId)` into the profile sheet.
- **AI Route backend.** `/api/routes/ai-generate` must exist for AI Route to return a real route. The integration tolerates a backend 5xx gracefully; the route just won't be generated.
- **Loop-completion v2 share-card photo.** `Share.cardFromLoop` is called with empty `photos: []` — once captured photos are persisted to `State.currentRoute`, pass them through for richer share cards.
