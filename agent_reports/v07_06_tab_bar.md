# v0.7.06 — Tab Bar Restructure (agent report)

**Owner:** tab-bar agent
**Files shipped:**
- `beta/app/v2-screens/tab-bar-v2.html` (test harness + inline icon sprite)
- `beta/app/v2-screens/tab-bar-v2.css`
- `beta/app/v2-screens/tab-bar-v2.js` (ES module, default export)
- `agent_reports/v07_06_tab_bar.md` (this file)

**Status:** Renders standalone; pushed cleanly to `main`.

---

## What changed

The v0.6 tab bar had five flat destinations — Explore / My Spots / Offers / Feedback / What's new — which already felt cramped on a 375 px viewport. The v0.7 roadmap adds Around Me (live GPS map), AI Route Generator, and Search to the navigable surface area, taking us to seven or eight top-level destinations. Cramming eight icons across the bottom would make every tap zone too narrow and would shout for attention in a product whose whole voice is editorial restraint.

The new bar collapses to five entries with a hero in the center:

```
  Explore   Around   [ WALK ]   Saved   Profile
```

- **Explore** — unchanged (curated route list).
- **Around** — the new live GPS map from Agent #3.
- **Walk** — a 56 px gold radial-gradient FAB raised 14 px above the bar with the walking-person glyph. This is the primary action and the only destination on the bar with brand color. It does *not* navigate to a fixed view; it routes based on state (see below).
- **Saved** — combines the old My Spots + Saved Routes. The integrator should make `/beta/app/saved` a tabbed view internally.
- **Profile** — opens a slide-up sheet rather than a screen. The sheet houses the long tail that used to occupy two whole tabs each (Offers, Feedback, What's new), plus new Settings and Sign out entries.

The net effect: tap zones grow from ~75 px to ~85 px per visible tab, and the FAB gives the brand a clear visual anchor without competing with the navy app chrome.

## Integrator hookup

The module is framework-free ES, default export. Drop into any page that currently renders `<nav class="tabbar">…</nav>` like this:

```html
<link rel="stylesheet" href="/beta/app/v2-screens/tab-bar-v2.css" />
<!-- Mount point — anywhere; the bar is position:fixed bottom by default. -->
<div id="app-tabbar"></div>

<script type="module">
  import TabBar from '/beta/app/v2-screens/tab-bar-v2.js';
  TabBar.mount(document.getElementById('app-tabbar'), {
    initialTab: 'explore',
    onTabChange: (name, meta) => {
      // 'explore' | 'around' | 'walk' | 'saved' | 'profile'
      // For 'walk': meta = { intent: 'start' | 'resume', walkId? }
      router.go(name, meta);
    },
    profileActions: {                      // all optional — defaults exist
      onOffers:    () => router.go('offers'),
      onChangelog: () => router.go('whats-new'),
      onSettings:  () => router.go('settings'),
      onSignOut:   () => auth.signOut()
    }
  });
</script>
```

The inline `<symbol>` definitions for `tab-explore`, `tab-around`, `tab-walk`, `tab-saved`, `tab-profile` (plus filled variants and sheet sub-icons) live at the top of `tab-bar-v2.html`. When the icons-sprite agent promotes them into `/beta/app/v2-styles/icons.svg`, the module needs no code changes — both the inline sprite and the production sprite use the same IDs, and the `<use href="#tab-explore">` references resolve to whichever sprite is present in the DOM. The integrator should keep the inline sprite in the host page until that promotion is done.

No other module needs to be touched. The old `<nav class="tabbar">` markup and its associated CSS can be deleted whole.

## Active-walk state contract

The FAB chooses between two behaviors based on a single localStorage key.

| key | value | meaning |
|---|---|---|
| `we_active_walk_id` | non-empty string | a walk is in progress (any source — Route Generator, Right-Now CTA, deeplink) |
| `we_active_walk_id` | missing / empty | no walk in progress |

- **No active walk:** tapping the FAB opens a small popover with two choices — *Start a walk* (dispatches `we:start-walk` and fires `onTabChange('walk', { intent: 'start' })`) and *Explore routes* (jumps to the Explore tab).
- **Active walk:** the FAB grows a pulsing gold halo, its `aria-label` becomes "Resume walk in progress", and tapping it dispatches `we:resume-walk` with `detail.walkId` and fires `onTabChange('walk', { intent: 'resume', walkId })`. The integrator should listen to either the callback or the event and push the user back into the Walk screen.

For cross-component sync the module listens to two events:
- the native `storage` event (cross-tab) on `we_active_walk_id`
- a custom `we:active-walk-changed` event on `window` (same-tab)

Any code that writes or clears `we_active_walk_id` should also dispatch `window.dispatchEvent(new Event('we:active-walk-changed'))` so the FAB updates instantly. Storage events do not fire in the same tab that wrote them; this is the conventional workaround.

## Profile sheet wiring

The sheet is rendered into `document.body` (not into the mount container) so it escapes any ancestor with `overflow: hidden` or `transform`. It is hidden by default and uses `role="dialog" aria-modal="true"` with a focus trap on Tab/Shift+Tab and an Esc-to-close handler. The backdrop click also closes. When closed, focus returns to whatever element had focus before opening — typically the Profile tab button.

Default sub-item behaviors (each overrideable via `opts.profileActions`):

| item | default action |
|---|---|
| Offers nearby | dispatches `we:open-offers` |
| Send feedback | `mailto:hello@walkingexplorers.com?subject=Walking Explorers feedback` |
| What's new | dispatches `we:open-changelog` |
| Settings | dispatches `we:open-settings` |
| Sign out | `POST /api/auth/logout` (credentials: include), clears `we_active_walk_id`, navigates to `/` |

The Offers item carries its own badge slot driven by `TabBar.setBadge('offers', n)`. The Saved tab and Around tab badges are driven by `TabBar.setBadge('saved', 3)` (numeric pill) or `TabBar.setBadge('around', 'dot')` (single 8 px dot). Pass `0` or `null` to clear.

## Accessibility checklist

- Each tab is a `<button>` with `aria-label` (set per-tab) and gains `aria-current="page"` when active.
- Walk FAB always has an `aria-label` ("Start or continue a walk" or "Resume walk in progress") and toggles `aria-expanded` when the popover opens.
- Sheet: `role="dialog" aria-modal="true" aria-labelledby="tabbar-v2-profile-heading"`, focus moves to the first list item on open, focus trap on Tab, Esc closes.
- All affordances honor `prefers-reduced-motion: reduce` — the indicator stops sliding, the FAB skips its scale-press, the popover and sheet snap rather than spring, and the halo pulse is suppressed.
- Focus-visible outlines on every interactive element use the gold token to remain consistent with the rest of the app.

## Test harness

Opening `beta/app/v2-screens/tab-bar-v2.html` directly in a browser renders the bar inside a phone-shaped shell with controls that exercise: numeric badge on Saved, single dot on Saved, single dot on Around, clearing all badges, simulating an active walk (which flips the FAB visual), clearing the active walk, and force-activating the Profile tab. A live event log shows the `onTabChange` payloads as they fire, which is the integrator's contract surface.

## Future considerations

- **Notifications tab in v0.8:** the spec already foresaw this. The cleanest path is to keep the bar at five entries by splitting Profile into a Notifications tab (with bell icon + persistent badge) and folding the current Profile sheet behind the user's avatar in a top-right header chip. The sheet markup can move to a shared `Sheet` primitive at that point.
- **Search:** placed in the per-screen header (e.g. Explore's filter row, Saved's list header) rather than the bar — the bar is too valuable for top-level destinations. If usage analytics later show search is the #1 entry, a sixth bar slot is feasible by removing the Profile tab and moving its sheet trigger to a long-press on the FAB.
- **Sprite promotion:** the icons-sprite agent should append `tab-explore`, `tab-around`, `tab-walk`, `tab-saved`, `tab-profile` (each plus `-filled` variant) and the `tab-ic-*` sheet icons into `/beta/app/v2-styles/icons.svg`. The IDs are already chosen to be sprite-safe. Once promoted, the inline `<svg id="tab-bar-v2-sprite">` block in `tab-bar-v2.html` can be removed from any host page that already links the master sprite.
- **Haptics:** the FAB tap is the obvious candidate for `navigator.vibrate(8)` once we land iOS WebKit haptics in v0.8. Wrapped behind a feature flag, not in this drop.
- **Bar hiding on scroll:** intentionally not implemented. The bar is the only way to escape a Walk screen mid-walk, so hiding it would be hostile. If we ever want immersive Walk mode, the Walk screen itself can hide the bar via `body.classList.add('tabbar-hidden')` + a CSS rule.

No other files were touched.
