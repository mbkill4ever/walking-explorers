# v0.7.9 — Graphic Polish Pass

**Agent:** Graphic Polish
**Branch:** main
**Files added (additive only — zero existing files touched):**
- `beta/app/v2-styles/polish.css`
- `beta/app/v2-styles/skeletons.css`
- `beta/app/v2-styles/empty-states.css`

This pass takes V2 from "looks ok" to the $200K feel: tactile cards, gold focus rings, balanced headings, tabular stats, brand-matched scrollbars, refined toasts, a real loading skeleton system, and an empty-state framework with per-surface gradient hues. Everything is gated by `prefers-reduced-motion` where motion is involved, and the dark-mode hook is in place for v0.8 without shipping it.

---

## 1) Integrator wiring — one place to edit

Add these three `<link rel="stylesheet">` tags to `beta/app/index.html`, **after** every existing stylesheet (including the token-bridge and any v2 stylesheets), so they cascade last and remain purely additive:

```html
<!-- v0.7.9 graphic polish — must load LAST -->
<link rel="stylesheet" href="/beta/app/v2-styles/polish.css">
<link rel="stylesheet" href="/beta/app/v2-styles/skeletons.css">
<link rel="stylesheet" href="/beta/app/v2-styles/empty-states.css">
```

The order matters — `polish.css` overrides defaults, `skeletons.css` defines loading primitives, and `empty-states.css` adds the empty framework. None of them rewrite existing rules destructively; they add new classes and tighten focus/hover/typography on existing selectors only.

No build step changes needed. No JS imports. No new font requests (Inter is already loaded; `font-feature-settings` just unlocks its built-in alternates).

---

## 2) Class hooks the JS layer should drive

These classes are the contract between the polish CSS and the integrator's JS. Wire them up in this order of value:

**Counts & stats**
- `.we-countup` — apply to any number element the integrator animates. CSS already pins tabular figures so the digits never reflow during count-up.

**Image fade-in**
- Add `.loaded` to an `<img>` once it fires `load` (or check `img.complete`). CSS fades 0→1 over 300ms.
- For cards, add `.is-ready` to inner `<img>` to trigger the `:has()` shortcut in supporting browsers (no JS required there).

**Skeletons (drop-in replacements for spinners/empties during fetch)**
- `.we-skel` — base shimmering placeholder (use for arbitrary boxes).
- `.we-skel--card` — full route-card placeholder. Structure: `<div class="we-skel we-skel--card"><div class="we-skel__img"></div><div class="we-skel__body"><span class="we-skel__line is-title"></span><span class="we-skel__line is-meta"></span></div></div>`
- `.we-skel--spot` — spot-card placeholder with thumb + 3 lines.
- `.we-skel--stop` — stop-list-item placeholder (number circle + line + chip).
- `.we-skel--profile` — avatar + name + meta.
- `.we-skel--stat` — small inline stat pill.
- `.we-skel--map` — gradient + grid that mimics a map tile.
- Helpers: `.we-skel--text-line` (with `.is-short` / `.is-medium` / `.is-long`), `.we-skel--circle` (with `.is-lg` / `.is-xl`), `.we-skel--block`, `.we-skel-group`, `.we-skel-grid`.
- A11y: put `aria-busy="true"` on the parent container while skeletons are visible, then flip to `aria-busy="false"` and swap content.

**Empty states**
- `.we-empty` + one of: `.we-empty--archive`, `.we-empty--offers`, `.we-empty--feedback`, `.we-empty--search`, `.we-empty--no-gps`, `.we-empty--no-walk`.
- Children: `.we-empty__icon` (drop an SVG inside), `.we-empty__title`, `.we-empty__body`, `.we-empty__cta`, optional `.we-empty__hint`.
- Compact variant: add `.is-compact` to `.we-empty` for inline panels.

**Microinteractions**
- `.is-bursting` — add to `.heart-save` / `.btn-save` / `.save-toggle` on save tap; remove after 480ms. CSS draws the gold particle ring and pops the icon.
- `.we-ptr` + `.is-active` — pull-to-refresh indicator (markup: `<div class="we-ptr"><span class="we-ptr__spinner"></span>Refreshing…</div>`).
- `.screen[data-state="entering"]` / `[data-state="exiting"]` — page transition shadow on the exiting screen. The router only has to set these data attributes during transitions; CSS handles the rest.

**Tabs**
- Existing `.tab-pill` / `[role="tab"].pill` / `.fb-tabs__pill` with `aria-selected="true"` (or `.is-active`) now gets a gold underline + subtle scale. No new classes required — the existing ARIA hook is enough.

---

## 3) Five specific swap-ins for the integrator

These are the highest-leverage places to replace current bland loading/empty UI with the new system. Each is a small, isolated edit.

1. **Routes feed (Explore screen) initial load** — replace the current spinner/blank state with a `.we-skel-grid` containing 4× `.we-skel--card`. Toggle `aria-busy` on the grid container while fetching.
2. **Around Me list while GPS resolves** — show a `.we-skel-group` of 3× `.we-skel--spot`. When GPS denied or unavailable, switch to `.we-empty.we-empty--no-gps` with title "Waiting for your location" and a CTA to retry/permissions.
3. **Active Walk → Map tile** — while Mapbox tiles load, render `.we-skel--map` underneath; remove on `map.on('load')`. This kills the gray flash users currently see.
4. **Archive screen empty** — replace current "no walks yet" copy with `.we-empty.we-empty--archive`, title "Your trail begins here", body "Finish a walk to start your archive — every spot, every photo, every memory.", CTA "Start a walk".
5. **Offers screen empty** — `.we-empty.we-empty--offers`, title "No offers near you yet", body "As you walk, partner spots will surface here with member discounts.", CTA "Explore routes". Apply the same pattern for **Feedback empty** (`--feedback`, "Be the first to weigh in") and **Search empty** (`--search`, "Search the world on foot").

Bonus quick win: stick `.we-countup` on the homepage / profile stat numbers (total miles, spots discovered, streak) so the integrator's count-up animation lands without digit jitter — the tabular-num feature is already wired.

---

## 4) Design decisions worth flagging

- **Focus rings are now gold-soft (3px) + gold (1px) ring** via `:focus-visible`. This replaces browser blue everywhere and reads as intentional brand polish. Browsers without `:focus-visible` (rare in our user base) fall back to default outline — acceptable.
- **`text-wrap: balance` and `pretty`** are progressive enhancements. Browsers without support simply wrap as before — no fallback needed.
- **`font-feature-settings: "ss01", "cv11"`** unlocks Inter's stylistic alternates (single-storey `a`, straight `l`). If we ever swap fonts, remove this line.
- **Scrollbars** are styled only at `pointer: fine` — phones get the native overlay scrollbars unchanged.
- **Reduced-motion master kill** at the bottom of polish.css zeroes out all animations and transitions when the user opts out — defensive against any animation we forgot to gate individually.
- **`color-scheme: light`** is declared on `:root` so form controls and scrollbars stay in light-theme rendering even on macOS dark OS preference. The `@media (prefers-color-scheme: dark)` block is intentionally empty — placeholder for v0.8.
- **Image fade-in** uses both a `.loaded` class (JS-driven) and a `:has()` selector (zero-JS) so it works whether or not the integrator wires up the load listener. Older browsers without `:has()` simply rely on the class.

---

## 5) Future polish for v0.8 and beyond

- **Dark mode** — fill in the `@media (prefers-color-scheme: dark)` block in polish.css. The token-bridge already centralizes colors, so it's a one-file change. Suggested palette: invert ink/cream, keep gold, deepen navy to near-black for surfaces.
- **Theme picker** — three brand presets (Classic / Sunset / Forest) toggled via a `data-theme` attribute on `<html>`. Token-bridge can carry the swap.
- **Haptics polyfill via CSS variables** — coordinate vibration patterns with class hooks (`.is-bursting`, `.is-active`) so JS can read a `--haptic-pattern` token per interaction.
- **Scroll-driven animations** — once Safari ships `animation-timeline: scroll()`, replace the page-transition shadow with a real scroll-linked depth.
- **View Transitions API** — wrap the screen router in `document.startViewTransition()` and let the browser tween element morphs (route-card → route-detail hero is the dream).
- **Variable font axis tuning** — Inter has a `slnt` axis; map it subtly to active-tab state for an extra micro-detail.
- **Reduced-data mode** (`prefers-reduced-data`) — swap cover-art images for SVG placeholders to save bytes on metered connections.
- **High-contrast mode** (`forced-colors: active`) — verify focus rings and skeleton shimmer remain visible; add `forced-color-adjust: none` where needed.
- **Skeleton → real-content cross-fade** — currently a hard swap. A 120ms cross-fade on the `aria-busy` flip would feel buttery.
- **Empty-state illustrations** — wire each `.we-empty__icon` to a unique SVG from the existing illustrations.svg sprite (compass for search, gift for offers, footprints for archive, etc.) instead of the generic gradient orb.
- **Sound design** — barely-there clicks/taps tied to `.is-bursting` and tab changes (opt-in only).

---

## 6) Verification checklist for the integrator

- [ ] Three `<link>` tags added to `beta/app/index.html` after existing styles.
- [ ] Hard refresh on desktop + iOS + Android — confirm no layout shift, no console errors, no missing fonts.
- [ ] Tab through any screen with keyboard — focus ring is gold, not blue.
- [ ] Hover any route/spot/fb card on desktop — slight lift + shadow, no jank.
- [ ] Toggle OS "Reduce motion" — animations cease, fades become instant.
- [ ] Throttle network to Slow 3G, reload Explore — skeleton grid shows, then fades to real cards.
- [ ] Force-deny location, open Around Me — `we-empty--no-gps` renders with pulse animation.
- [ ] Open Archive on a brand-new account — `we-empty--archive` renders with sunset-gold orb.
- [ ] Save any spot — heart bursts gold and scales.

Ship it.
