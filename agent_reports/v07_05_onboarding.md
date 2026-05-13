# v0.7.5 — Onboarding Flow

**Owner:** Onboarding agent
**Scope:** 4-step first-run onboarding for Walking Explorers v0.7.
**Status:** Built, ready to wire.

---

## Files shipped

| File | Role |
|------|------|
| `beta/app/v2-screens/onboarding.html` | Self-contained markup (Welcome / Mood / Prefs / Location). Loaded via fetch by the JS module. |
| `beta/app/v2-screens/onboarding.css` | All styles scoped under `.we-onb`. Navy → cream gradient, gold sunrise, gold skyline, Inter typography, reduced-motion safe. |
| `beta/app/v2-screens/onboarding.js` | ES module exporting `{ mount, shouldShow }`. Handles state, sliders, geolocation, localStorage. |
| `agent_reports/v07_05_onboarding.md` | This document. |

No other files were touched.

---

## Module API

```js
import Onboarding from '/beta/app/v2-screens/onboarding.js';

// Should the first-run flow render?
if (Onboarding.shouldShow()) {
  const host = document.getElementById('we-onboarding-root');
  Onboarding.mount(host, {
    onComplete: () => {
      // integrator: hide host, render Explore now
      host.hidden = true;
      App.renderExplore();
    }
  });
} else {
  App.renderExplore();
}
```

- `shouldShow()` returns `true` when `localStorage.we_onboarded !== '1'`.
- `mount(containerEl, opts)` is async (it fetches the HTML partial), but you can call it without awaiting — the integrator only needs the `onComplete` callback.
- On completion (or full skip), the module sets `localStorage.we_onboarded = '1'`, removes its DOM, and invokes `onComplete()`.

---

## Integrator wiring — App.init flow

Drop this into the bootstrap path **after** the user's code claim succeeds and **before** Explore would normally render:

```js
// app/init.js (or wherever App.init lives)
async function init() {
  await Auth.restoreSession();

  // Gate: if user has not been onboarded, take them through it first.
  const Onboarding = (await import('/beta/app/v2-screens/onboarding.js')).default;

  if (Onboarding.shouldShow()) {
    // Make sure there's a host element. Create one if needed.
    let host = document.getElementById('we-onboarding-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'we-onboarding-root';
      document.body.appendChild(host);
    }

    await Onboarding.mount(host, {
      onComplete: () => {
        host.remove();
        App.renderExplore();   // proceed to normal first screen
      }
    });
    return;  // do NOT render Explore yet
  }

  App.renderExplore();
}
```

Key points:
1. **Gate Explore render** on `!Onboarding.shouldShow()` — the module itself does not navigate anywhere; it just signals completion.
2. **Single mount per session** — once `we_onboarded === '1'` is set, subsequent loads skip the flow entirely.
3. **Onboarding cleans up its own DOM** when complete. The integrator only needs to remove the host wrapper if it created one.

---

## Data the module writes to localStorage

| Key | Shape | Set when |
|-----|-------|----------|
| `we_onboarded` | `'1'` | On completion OR full-flow skip |
| `we_mood` | `JSON.stringify(string[])` of mood ids | After step 2, if at least one mood selected |
| `we_walk_prefs` | `JSON.stringify({ minutes, miles })` | After step 3 (or step-3 skip) |
| `we_anchor` | `JSON.stringify({ lat, lon, timestamp })` | After step 4, on geolocation success |

Mood ids (stable, for backend/route tuning):
`coffee`, `hidden_gems`, `aesthetic_photo`, `architecture`, `food`, `art`, `nature`, `books`, `sunsets`, `date`.

---

## Server hook expected from integrator

The step-3 commit fires (fire-and-forget):

```
POST /api/users/prefs
Content-Type: application/json
Credentials: same-origin

{ "minutes": 90, "miles": 1.5 }
```

Failures are swallowed silently — local state is the source of truth until the endpoint exists. When the integrator creates this endpoint, no client change is needed.

---

## Step-by-step behavior

### Step 1 — Welcome
- Gold sunrise gradient backdrop, navy → cream page.
- Primary CTA → step 2.
- Skip link → marks onboarded and fires `onComplete()`.

### Step 2 — Mood (multi-select)
- 10 toggleable pills. `aria-pressed` reflects state.
- "Continue" is disabled until at least one pill is selected.
- "Skip" advances to step 3 without writing `we_mood`.

### Step 3 — Time & distance
- Slider 1: 30–180 min, step 15, default 90.
- Slider 2: 0.5–5 mi, step 0.1, default 1.5.
- Live preview line: `About 90 min · 1.5 mi`.
- Persists locally and POSTs to `/api/users/prefs`.

### Step 4 — Location
- Explains WHY before any native prompt.
- "Allow location" calls `navigator.geolocation.getCurrentPosition`.
  - Success → store `we_anchor`, show "Locked in…", complete after ~900ms.
  - Denial / error → show "No problem — you can enable later in Settings." then complete after ~1.4s.
- "Not now" skips and completes.

---

## Visual / a11y notes

- Full-screen takeover at `z-index: 200`.
- 200ms fade-in on mount; 320ms slide-in per step.
- `prefers-reduced-motion: reduce` disables both.
- Focus moves to each step's `<h1>` (tabindex -1) for screen-reader announcement.
- Escape key skips the whole flow (same as the step-1 Skip link).
- All interactive elements have `:focus-visible` outline (gold).

---

## Manual test plan

1. `localStorage.clear()` and reload — flow appears.
2. Click through all 4 steps with default values — verify localStorage has `we_onboarded`, `we_walk_prefs`, and (on success) `we_anchor`.
3. Select 2 moods, advance — verify `we_mood` is a JSON array of 2 strings.
4. Step 2: try to advance with zero selections — Continue button stays disabled.
5. Step 4: deny browser location prompt — verify graceful copy and that flow still completes.
6. Reload after completion — onboarding does **not** appear; Explore renders directly.
7. Devtools `prefers-reduced-motion: reduce` — verify no fade/slide/ping animations.
8. Mobile (≤480px) — verify card padding shrinks, CTA is full-width, skyline scales down.

---

## What's intentionally out of scope

- Camera and notification permissions — spec only asked for location at step 4.
- Server-side persistence beyond the fire-and-forget POST.
- Re-entry from Settings — once `we_onboarded = '1'`, the module won't auto-show. Integrator can clear the key to re-trigger if needed.
- Analytics events — none fired. Integrator can wrap `onComplete` and DOM events if needed.
