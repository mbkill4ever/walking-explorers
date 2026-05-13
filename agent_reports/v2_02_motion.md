# v2_02 — Motion System

**Agent:** motion-system
**Scope (exclusive):** `beta/app/v2-styles/motion.css`, `beta/app/v2-scripts/motion.js`
**Status:** Delivered
**Date:** 2026-05-13

## What shipped

### `beta/app/v2-styles/motion.css`
A self-contained motion layer keyed off CSS variables. The whole animated surface is gated by `@media (prefers-reduced-motion: no-preference)`, with an explicit `@media (prefers-reduced-motion: reduce)` block that nukes transitions, animations, and parallax for users who opt out.

Tokens (top of file):
- Easings: `--ease-out-soft`, `--ease-spring`, `--ease-snap`, `--ease-glide`
- Durations: `--t-instant` 80ms · `--t-quick` 160ms · `--t-base` 260ms · `--t-relaxed` 420ms · `--t-cinematic` 700ms
- Surface helpers: `--shadow-rest`, `--shadow-lift`, `--shadow-press`, `--good-green`

Patterns implemented (1:1 with the brief):
1. Page transitions — `.page-enter-forward` / `.page-exit-forward` (and `-back`), 420ms `ease-out-soft`
2. Card entries — `.motion-fade-up` with `--motion-delay` driven by JS (60ms step, cap 6)
3. Card hover — `translateY(-2px)` + shadow lift, 160ms
4. Card press — `scale(0.985)` + shadow compress, 80ms
5. Photo parallax — native `animation-timeline: scroll()` with JS fallback writing `--parallax-y`
6. Buttons — press `scale(0.96)`; success keyframe `btnSuccess` pulses to `--good-green` over 600ms
7. Tab bar — `.tabbar__indicator` slides with spring; outline/filled icons cross-fade
8. Modal sheet — slide-up + backdrop fade; `.is-dragging` disables the transition for live touch
9. Toast — `.is-in` / `.is-out` for entrance/exit; auto-dismiss handled by JS
10. Skeleton shimmer — `::after` gradient sweep, 1.4s infinite
11. Pull-to-refresh — `--ptr-y` and `--ptr-progress` CSS vars; `.is-snapping` for spring return; `.is-spinning` for active refresh
12. Capture flash — full-screen white, 0 → 0.95 → 0 over 220ms
13. Confetti — `.confetti-burst > .confetti-piece` with `--c-x`, `--c-rot`, `--c-hue`, `--c-delay`
14. Save burst — bookmark scale 1 → 1.4 → 0.94 → 1 with green glow
15. AI ellipsis — three staggered bouncing dots
16. Reduced motion — explicit `@media (prefers-reduced-motion: reduce)` block

### `beta/app/v2-scripts/motion.js`
ES module, no dependencies. Exports named + default `Motion` and attaches `window.Motion` for the existing inline `onclick` handlers in `index.html`. Auto-inits on `DOMContentLoaded`.

Public surface:
- `Motion.init(options?)` — sets up IntersectionObserver for `.motion-fade-up` / `.motion-stagger`, attaches parallax fallback when `animation-timeline: scroll()` isn't supported, wires a `we:navigate` window event for page transitions, and tracks `prefers-reduced-motion` changes live.
- `Motion.fadeUpStagger(parent, childSelector?, { stepMs, maxStagger, baseDelay })` — applies `.motion-fade-up` to children, sets `--motion-delay`, observes them.
- `Motion.parallaxHero(element, ratio = 0.4)` — registers an element for JS-driven parallax when the native scroll-timeline isn't available.
- `Motion.celebrate(element, { count, palette })` — confetti burst attached to the element (auto-promotes static positioning to relative).
- `Motion.modalSheet(modal)` — accepts an Element or `{ sheet, backdrop, onClose }`. Opens with class toggle, live-tracks pointer/touch drag, snap-closes when dragged > 40% of sheet height or downward velocity > 0.6 px/ms, clicking the backdrop also closes.

Bonus utilities (still on `Motion`, used by other agents' UI code):
- `toast(node, { duration })` — `is-in` then `is-out` after 2400ms by default.
- `captureFlash()` — injects and removes the flash overlay.
- `saveBurst(iconEl)` — re-triggers `.save-burst` on the bookmark icon.
- `buttonSuccess(btn)` — re-triggers `.is-success` on a button.
- `attachPullToRefresh(container, { threshold, onRefresh, spinner })` — touch handlers + rubber-band damping.
- `moveTabIndicator(indicator, activeTab)` — measures and slides the indicator.

## Integration notes for other agents
- Cards just need `class="card"` (or `data-motion="card"`) and hover/press is free.
- For a staggered grid, wrap children in `.motion-stagger` — `Motion.init` auto-wires it.
- Hero images: add `class="parallax-hero"` and (optionally) `data-parallax="0.4"`.
- Navigation events: `window.dispatchEvent(new CustomEvent('we:navigate', { detail: { direction: 'forward' | 'back', target: pageEl }}))`.
- Modal sheets need `.modal-sheet` on the panel and `.modal-backdrop` on the scrim (link via `data-backdrop-id` or DOM order).
- All effects no-op silently when the user has `prefers-reduced-motion: reduce`. Confetti is suppressed entirely; transitions become instant.

## Restraint check
No decorative wiggle. Hover/press, page slides, and tab indicator are the only animations on the critical interaction path. Confetti, save burst, and capture flash are reserved for earned, infrequent moments (Loop completion, bookmark save, photo capture). The brand voice — Polarsteps-quiet, Things-3-tactile — is preserved.
