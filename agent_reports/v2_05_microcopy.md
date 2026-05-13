# v2-05 Microcopy — Agent Report

**Date:** 2026-05-13
**Agent:** Microcopy (Walking Explorers v2)
**Scope:** Authored `beta/app/v2-data/microcopy.json` — editorial rewrite of every user-facing string in the beta app.
**Files touched:** ONLY `beta/app/v2-data/microcopy.json` (new). No other file modified.

## Outcome

Committed: [microcopy.json](https://github.com/mbkill4ever/walking-explorers/blob/main/beta/app/v2-data/microcopy.json) — 54 KB, valid JSON, 34 top-level sections.

## Voice landed

Editorial-NYC. The reader has been to Manhattan, slightly. Observation over instruction, specificity over hedging, earned warmth over performative friendliness. Reference points called out in the voice_guide: New Yorker headlines, Atlas Obscura captions, Citymapper's smart-aleck moments. Three dos and three don'ts encoded.

Sample lines:
- Greeting (morning): "Good morning. The light's good before 10."
- Toast (vote): "Counted."
- Toast (feedback): "Heard. We read every one."
- Error (GPS): "We can't find you. Walk a few steps and try again."
- Empty (archive): "Your city memory starts here."
- Loop done: "That's a Loop. Recap incoming."
- Stop (Joe Coffee): "Reclaimed wood, no tourists, no Wi-Fi pressure. Order the cortado. Sit by the window."
- Stop (9/11 pools): "Treat with care. Allow time."

Zero exclamation marks in copy (one exception, deliberately within a single voice-guide quote of forbidden SaaS phrasing). No emoji decoration. No "Welcome to your dashboard."

## Structure delivered

| Section | Count | Notes |
|---|---|---|
| `voice_guide` | 1 paragraph | DOs/DON'Ts encoded for any future copy edits |
| `app` | 3 strings | name, tagline, subtitle |
| `greetings` | 16 lines | 4 each for morning/afternoon/evening/night — variant rotation |
| `greeting_eyebrows` | 7 | eyebrow labels above headers |
| `greeting_subs` | 4 | new/returning/post-loop variants |
| `buttons` | 33 | every CTA in the app, snake_case keys |
| `tabs` | 5 | bottom nav |
| `screen_titles` | 10 | header bar text |
| `section_headings` | 9 | feed sections |
| `labels` | 26 | static labels + sprintf-style templates ({n}, {total}, etc.) |
| `placeholders` | 6 | form inputs |
| `right_now` | 13 | time-of-day + weather contextual lines (weekday/weekend split, +rain/cold/hot) |
| `onboarding` | 9 | first-time nudges per surface |
| `empty_states` | 9 | archive/offers/feedback (4 tabs)/loops/search — each title+body+cta |
| `toasts` | 28 | every success and failure ack |
| `errors` | 15 | GPS, photo, network, server, auth |
| `modals` | 14 | capture, spot detail, delete, exit-walk |
| `rating_labels` | 8 | Low/Medium/High/Legendary + hint lines |
| `tags` | 10 | the existing TAGS array, polished |
| `feedback` | 15 | full feedback hub |
| `promotions` | 7 | offers screen + promo-route CTA |
| `loop` | 7 | completion screen |
| `share_recap` | 6 | 5 share headline templates + footer |
| `achievements` | 10 | first_loop, first_spot, five_spots, twenty_five_spots, neighborhood_explorer, five_neighborhoods, golden_hour, early_bird, night_walker, all_twelve |
| `routes` | 12 | all 12 — title_short, title_full, subtitle, description_card, description_long (150ish words editorial), mood_tags, best_time, weather |
| `stops` | 72 | every stop across all 12 routes — title, why_short, why_long, tip, duration_text |
| `changelog_eyebrow`, `changelog_intro` | 2 | release notes framing |
| `share_loop_message` | 1 | default share text with {tokens} |
| `explore_meta` | 5 | pill templates |
| `auth` | 5 | invite-only flow |
| `misc` | 17 | misc filler (today, ongoing, no_results, etc.) |

Total **~450 distinct strings** (well above the 300+ target).

## How I derived it

1. Fetched `beta/app/index.html` (96 KB) via the GitHub MCP and parsed the ROUTES / PROMOTIONS / NEIGHBORHOODS / TAGS / RATINGS arrays plus all hardcoded UI strings (greeting builder, empty states, toasts, errors, feedback flow, changelog).
2. Attempted `beta/app/v2-data/photos.json` three times per spec — file does not exist yet (returns 404). Proceeded with route copy as the photo mood proxy: every stop's `why_long` and `tip` already implies the photo mood (e.g., "golden hour", "afternoon light, west wall", "blue hour"). When the photos agent ships, the integration agent can cross-reference by stop slug.
3. Stop slugs in `microcopy.json.stops.*` follow lower_snake_case derived from the stop name. Two stops share the name "Russ & Daughters Café" across the EV and LES routes — I distinguished them as `russ_daughters_cafe` (EV) and `russ_daughters_les` (LES).
4. Route slugs match exactly the existing `ROUTES[].id` values from index.html, so the integration agent can swap copy 1:1 without renaming.

## Integration notes for the next agent

- All template strings use `{token}` not `${token}` — e.g., `"{n} stops"`, `"Capturing at {stop}"`, `"Adding {business} to the route…"`. Use a simple `String.prototype.replace` loop.
- Greeting rotation: pick one line from the time-of-day array per session (or per day) rather than always element 0.
- The route_id → microcopy.routes lookup matches `ROUTES[].id`. The stop_index → microcopy.stops lookup needs a slug map (the integration agent will need to generate one alongside the swap, or I can add it in a v2-05.1 follow-up if requested).
- `description_long` for routes is the only place I went beyond a sentence or two — these are the editorial paragraphs (≈100-160 words each) intended for the detail screen below the meta-stats row.
- `voice_guide` is the source of truth for any future copy changes — read it before editing.

## What I did NOT touch

- `beta/app/index.html` — left for the integration agent.
- Any other file in the repo.

Done. Hand off to the integration agent.
