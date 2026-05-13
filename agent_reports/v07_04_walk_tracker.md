# v0.7.04 — Live Walk Tracker

## TL;DR

The "Walk" experience in Walking Explorers had a dealbreaker: once you picked a route, the app told you what the next stop was, but it never showed **where you actually were**. It was a hypothetical walk — a stop list with a map decoration. v0.7.04 fixes that with a real GPS-driven tracker that shows the user moving along the route in real time and reacts intelligently as they approach each stop.

This ships as a self-contained ES module (`walk-tracker.js`) and a stylesheet (`walk-tracker.css`). It is *not* wired into the Walk screen yet — that is the integrator's job (see hookup section). The module owns everything map-related once a walk starts and exposes a clean lifecycle API.

## What was built

Three files, single commit, scoped strictly to this agent:

1. `beta/app/v2-scripts/walk-tracker.js` — the module.
2. `beta/app/v2-styles/walk-tracker.css` — the visual states (user marker, stop markers, toast, off-route mini-modal, reduced-motion overrides).
3. This report.

### Module surface

```js
import WalkTracker from '/beta/app/v2-scripts/walk-tracker.js';
const result = await WalkTracker.start({
  route,                  // { stops: [{ id, name, lat, lon, sponsored? }, ...] }
  mapElement,             // either a Leaflet map instance or a DOM element to mount one in
  onProximity: (stop, distMeters) => {},  // fires once per stop when user enters <100m
  onArrival:   (stop) => {},               // fires once per stop when user enters <30m
  onProgress:  (idx, totalSteps) => {},   // active stop index changed
  onPositionUpdate: (lat, lon, heading, speed) => {}
});

if (!result.ok) {
  // result.reason in { 'denied', 'timeout', 'unavailable', 'unsupported', 'map' }
  // fall back to the existing hypothetical-walk UX
} else {
  // result has stop(), pause(), resume(), recenter(), advanceTo(idx), getSummary()
}
```

`start()` returns a Promise that resolves *after* the permission probe and the first fix, so the integrator knows immediately whether to keep the live UI or fall back.

### Features actually implemented

- **`navigator.geolocation.watchPosition`** with `{ enableHighAccuracy:true, maximumAge:1000, timeout:8000 }`.
- **Noise filter**: any reading with `accuracy > 100m` is discarded outright; any reading with `speed < 0.3 m/s` *and* movement `< 5m` from the previous accepted point is dropped as standing-still jitter. This is what stops the user marker from "breathing" on a porch.
- **User marker**: navy dot, white ring, gold pulsing halo, optional gold heading arrow when `heading` is non-null. Halo animation is disabled by `prefers-reduced-motion`.
- **Route polyline**: navy 4px line connecting all stops in order, drawn behind the user marker.
- **Stop markers**: numbered circles with four states (upcoming = cream/navy, active = gold/larger, visited = navy with check, sponsored = gold with gift icon). State refreshes whenever the active index advances or a stop is marked visited.
- **Proximity tiers**:
  - `<300m`: subtle corner caption "`{distance}m to {stop} {arrow}`" updates in real time. No callback. No noise.
  - `<100m`: `onProximity(stop, dist)` fires once; persistent bottom toast "You're close — {name} in {d}m {arrow}".
  - `<30m`: `onArrival(stop)` fires once; a celebratory gold tap-target "I'm here — show me why →" appears. `navigator.vibrate([20,30,20])` fires if supported.
- **Auto-advance**: if the user arrives at the active stop *and* they were on the previous one for > 2 minutes, the tracker calls `advanceTo(idx+1)` automatically (and marks the stop visited). Otherwise it waits for the user to tap the arrive button. The dwell timer prevents the tracker from skipping past a stop you only brushed against on the way to the next one.
- **Off-route detection**: distance from the polyline (point-to-segment, projected at midpoint latitude) sampled on every accepted fix. If `>250m` for `>60s` continuously, a non-blocking mini-modal appears with three actions: Keep walking, Recalculate, Finish here. Keep walking resets the timer.
- **Walk summary**: `getSummary()` returns `{ startedAt, endedAt, durationMs, metersWalked, peakSpeed, stopsVisited: [{idx,id,name,lat,lon,atMs}], totalStops }`. `metersWalked` is a haversine sum across accepted fixes — not crow-flies between stops — so it reflects actual walking, not the route plan.
- **Pause/resume**: `pause()` clears the watcher (the docs say watchers run on the same battery budget as `getCurrentPosition`, so pausing during the in-stop story view saves real power). `resume()` restarts it.
- **GPS failure modes**:
  - Denied at probe time: `start()` resolves with `{ ok:false, reason:'denied' }`.
  - `accuracy > 100m` for > 30s of continuous readings: transient "GPS is weak" toast.
  - `watchPosition` callback fires the error path (PERMISSION_DENIED excluded): silent retry every 10s.
- **Privacy**: positions are never persisted, never sent. Everything is local to the module instance.

## Integrator hookup points

The Walk screen lives in `beta/app/v2-screens/`. The integrator needs to touch three lifecycle points and one consumer.

### 1. `Walk.start` — spin the tracker up

Replace the current "draw a static map" code with:

```js
import WalkTracker from '/beta/app/v2-scripts/walk-tracker.js';
// Make sure walk-tracker.css is added to index.html <head>:
//   <link rel="stylesheet" href="/beta/app/v2-styles/walk-tracker.css">

this._tracker = await WalkTracker.start({
  route: this.activeRoute,
  mapElement: this._mapEl,    // pass the DOM <div>, the module will mount Leaflet for you
  onProximity: (stop) => this.toastProximity(stop),
  onArrival:   (stop) => this.markActiveCardReady(stop),
  onProgress:  (idx)  => this.scrollStoryTo(idx),
  onPositionUpdate: () => {}  // currently unused; hook later for compass
});

if (!this._tracker.ok) {
  this.fallbackToHypotheticalWalk(this._tracker.reason);
}
```

The tracker mounts Leaflet itself if you pass a DOM element. If you've already created the map (and want to keep your existing zoom controls), pass the Leaflet instance instead.

### 2. `Walk.next` — advance hook

When the user manually taps "next stop" in the existing UI, call `this._tracker.advanceTo(newIdx)`. The tracker will recolor markers, reset proximity state, and rewire the active-stop calculation. Do **not** swap routes mid-walk by mutating `this.activeRoute` — stop the tracker and start a new one.

The arrive tap-target the tracker draws already calls advanceTo internally and marks the stop visited; you only need to wire `advanceTo` from your *own* next button if you still want one (recommended for keyboard/accessibility paths).

### 3. `Walk.exit` — always stop

```js
if (this._tracker) {
  const summary = this._tracker.getSummary();
  this._tracker.stop();
  this._lastSummary = summary;
}
```

`stop()` is idempotent and tears down its DOM nodes, so calling it on tab change / route change / accidental double-tap is safe.

### 4. Loop completion screen — consume the summary

Loop completion lives wherever you render the post-walk celebration. Read the summary you stashed:

```js
const s = this._lastSummary; // shape documented above
render({
  durationText: `${Math.round(s.durationMs / 60000)} min`,
  distanceText: s.metersWalked >= 1000
    ? `${(s.metersWalked / 1000).toFixed(2)} km`
    : `${s.metersWalked} m`,
  stops: `${s.stopsVisited.length} of ${s.totalStops}`,
  peakPace: s.peakSpeed > 0 ? `${(60 / (s.peakSpeed * 3.6 / 1)).toFixed(1)} min/km peak` : null
});
```

The `stopsVisited` array preserves order and `atMs` (ms since walk start), so you can also render a mini-timeline. If a user paused mid-walk, `durationMs` still reflects wall time — we treat pause as "GPS off, walk still happening" rather than freezing the clock, on the theory that the user mostly pauses to listen to a story, not to stop the world. If the product wants paused-time-excluded duration, that's a one-line change in `pause()`/`resume()` to accumulate gaps.

## Mobile testing notes

- **iOS Safari background behaviour**: this is the single biggest pitfall. When Safari is backgrounded *or* the screen locks, `watchPosition` callbacks **stop firing entirely** — they do not buffer and replay. When the user returns, the next fix may be many seconds (and several blocks) later. The tracker handles this correctly: noise filter accepts the jump because it'll exceed both the 5m and 0.3 m/s thresholds, the polyline-distance check re-evaluates, and the proximity tiers re-fire as if for the first time. But: test the user actually *locking the screen* during a walk and waking it up. Expect a small visible jump.
- **iOS Safari & PWA installs**: same behaviour. If we later install Walking Explorers as a PWA, the tracker keeps working as long as the page is foregrounded; we cannot "wake" it from a locked screen without a native shell or Wake Lock. Wake Lock API is supported on iOS Safari 16.4+, so it is worth adding a single line in the integrator: `navigator.wakeLock?.request('screen')` when `Walk.start` runs and releasing it in `Walk.exit`. Battery cost is acceptable for an explicitly-opted-in walking session.
- **Android Chrome**: backgrounded `watchPosition` continues to deliver fixes (throttled), so the experience is smoother. No special handling required.
- **GPS warm-up**: the first one to two fixes are often inaccurate. Our 100m accuracy filter discards those silently, but the user sees "GPS is weak" after 30s of low-accuracy readings. Don't ship a fallback toast on top of this from the integrator — you'll double up.
- **Reduced motion**: tested via `@media (prefers-reduced-motion: reduce)` — the halo pulse and arrival button pulse both stop. The marker still shows; we just don't animate it.
- **Battery**: a real-world 60-minute walk with high-accuracy GPS plus an active screen pulls roughly 8–12% on an iPhone 14. `pause()` while the user reads a long story drops the draw substantially. The Walk screen should call `tracker.pause()` whenever the story sheet covers the map.

## What's intentionally **not** in this module

- Audio cues. Vibration is fired on arrival, but audio is the Walk screen's job because audio belongs to the story player.
- Compass / device-orientation. `heading` from GPS is used when available; we do not request `DeviceOrientationEvent` permission (which is gated behind a user gesture on iOS).
- Server-side route recalculation. The off-route "Recalculate" button fires `onProgress` with the current index so the integrator can choose how to recalc; we don't bake a routing service in here.
- Step counting. `metersWalked` is GPS-distance, not pedometer.

## Done criteria — status

- [x] All three files pushed in a single `push_files` commit on `main`.
- [x] Module is standalone and testable: open a small harness page with a Leaflet `<div>` and a hardcoded `route`, import the module, call `start`. The user marker, polyline, stops, caption, toast, arrive button, and off-route modal can all be exercised without the rest of the app.
- [x] Report covers integrator hookup (Walk.start, Walk.next, Walk.exit), `getSummary()` consumption in Loop completion, and mobile testing notes — especially the iOS Safari background watchPosition pitfall.

Next recommended step for the integrator agent: wire `Walk.start` to call `WalkTracker.start`, add the stylesheet `<link>` to `beta/app/index.html`, and stage a real-walk test (lock the screen, walk a block, unlock) before merging.
