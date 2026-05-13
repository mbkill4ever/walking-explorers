# v0.7.10 — Telemetry & Observability

**Agent:** Telemetry & Observability
**Files owned this sprint:**
- `beta/app/v2-scripts/telemetry.js` (new)
- `beta/app/v2-scripts/error-handler.js` (new)
- `agent_reports/v07_10_telemetry.md` (this report)

Nothing else was touched.

---

## 1. What shipped

Two ES modules that turn Walking Explorers from "flying blind" into a measurable product:

- **`telemetry.js`** — PostHog wrapper plus a strict tracking-plan implementation. The integrator simply imports it and calls `T.init({ apiKey: window.POSTHOG_KEY })`. Everywhere else in the app the codebase uses the null-safe pattern `window.WE_T?.track('event_name', { ... })`.
- **`error-handler.js`** — Sentry wrapper that also keeps a 20-entry localStorage ring buffer (`we_recent_errors`) so support can read recent errors even when Sentry is unreachable or unconfigured. It is the single place uncaught errors are funnelled, and it also fires a PostHog `app_error` event so we see crashes alongside funnels.

Both modules are **fully null-safe**: if `POSTHOG_KEY` / `SENTRY_DSN` are unset, every method becomes a quiet no-op. `T.track(...)` is safe to call before `T.init(...)`, and events fired pre-load are buffered and replayed once PostHog finishes loading.

---

## 2. Full event catalog (implemented & guarded)

Events not in this list still send (we prefer over-reporting to dropping) but log a `console.warn('[telemetry] unknown event:', ...)` in dev so we catch typos.

### Acquisition / Activation
- `token_gate_viewed`
- `code_submitted` `{ length, success }`
- `code_claimed` `{ tier }`
- `app_loaded` *(auto-fired on `T.init`)*
- `onboarding_started`
- `onboarding_step_completed` `{ step, moods?, walk_prefs?, gps_granted? }`
- `onboarding_completed`
- `onboarding_skipped` `{ atStep }`
- `first_route_viewed` `{ route_id, neighborhood }`
- `first_walk_started` `{ route_id }`
- `first_loop_completed` `{ route_id }`
- `first_spot_saved` `{ route_id, stop_idx }`

### Engagement
- `tab_switched` `{ from, to }`
- `route_detail_viewed` `{ route_id, source: 'explore'|'around'|'search'|'ai' }`
- `walk_started` `{ route_id, ai_generated, source }`
- `walk_stop_advanced` `{ route_id, stop_idx, method: 'tap'|'auto'|'proximity' }`
- `walk_paused` / `walk_resumed`
- `loop_completed` `{ route_id, duration_min, stops, spots_saved }`
- `spot_saved` `{ stop_name, has_photo, has_notes, tags_count, rating }`
- `feedback_submitted` `{ type, length }`   *(note: only length, never text)*
- `feedback_voted` `{ fb_id }`
- `offer_clicked` `{ promo_id }`
- `offer_added_to_route` `{ promo_id }`

### v0.7 new features
- `around_me_opened`
- `around_me_pin_tapped` `{ stop_name }`
- `around_me_offers_toggle` `{ on }`
- `ai_route_started`
- `ai_route_question_answered` `{ question, answer }`
- `ai_route_generated` `{ minutes, moods_count, distance, stop_count }`
- `ai_route_walked` `{ ai_route_id }`
- `search_opened`
- `search_query` `{ length, hits }`   *(only length, never query text)*
- `search_filter_applied` `{ category, value }`
- `share_sheet_opened` `{ source: 'loop'|'spot', target_id }`
- `share_target_picked` `{ platform: 'instagram'|'x'|'whatsapp'|'native'|'copy'|'email' }`
- `referral_link_copied`
- `walk_tracker_started` `{ route_id, gps_granted }`
- `walk_tracker_proximity_hit` `{ stop_idx }`
- `walk_tracker_offroute` `{ duration_s }`

### Retention (client signals; server-side rollups later)
- `session_started` *(auto-fired on `T.init`)*
- `session_ended` `{ duration_s }` *(auto-fired on `pagehide`/`beforeunload`)*
- `daily_active` *(auto-fired once per UTC day via `localStorage.we_daily_active_utc`)*

### Revenue placeholders (v0.8)
- `paywall_shown` / `paywall_dismissed`
- `subscription_started` / `subscription_renewed` / `subscription_canceled`

### Errors
- `app_error` `{ name, message, stack_short }` *(fired by `error-handler.js`)*

Every event auto-includes super props: `session_id`, `app_version` ("0.7.0"), `platform` ("web"), and the current `screen` / `route_id` / `tier` from `T.setContext({ ... })`.

---

## 3. Privacy guarantees (enforced in code)

- **Photos** — never sent. Any prop value starting with `blob:` is dropped before send. Any key matching `photo*` / `image_url` / `blob` is dropped.
- **GPS coords** — never sent. Keys matching `lat`, `lng`, `latitude`, `longitude`, `coords` are dropped, and lat/lng-like substrings in error messages are scrubbed to `[coords-redacted]`.
- **Free text** — feedback, notes, AI freeText and search query text are never sent. Only `length` and (for search) `hits` count.
- **Names / emails** — keys matching `email`, `name`, `first_name`, `last_name`, `full_name`, `phone`, `address` are dropped, and email patterns in error messages are scrubbed to `[email-redacted]`.
- **User identity** — `T.identify(userId)` only; userId is opaque (e.g. our internal hashed id), no PII traits.

---

## 4. Env vars Nova needs to add in Vercel

Both are **optional** — the app degrades gracefully without them, but you want them set for production.

| Name | Scope | Value source | Notes |
|---|---|---|---|
| `POSTHOG_KEY` | Production + Preview | PostHog → Project Settings → Project API Key (`phc_...`) | Client-side public key. Safe to expose. |
| `SENTRY_DSN` | Production + Preview | Sentry → Settings → Projects → walking-explorers → Client Keys (DSN) | Public DSN, safe to expose. |

The integrator wires them in `index.html`:
```html
<script>
  window.POSTHOG_KEY = '%POSTHOG_KEY%';
  window.SENTRY_DSN  = '%SENTRY_DSN%';
</script>
<script type="module">
  import T from '/beta/app/v2-scripts/telemetry.js';
  import E from '/beta/app/v2-scripts/error-handler.js';
  E.init({ dsn: window.SENTRY_DSN, release: 'walking-explorers@0.7.0',
           env: location.hostname === 'walkingexplorers.com' ? 'production' : 'preview' });
  T.init({ apiKey: window.POSTHOG_KEY });
  window.WE_T = T; window.WE_E = E;
</script>
```

Omit the `%...%` substitution if the env var is absent — the modules treat null DSN/key as "don't load the SDK."

---

## 5. PostHog dashboards Nova should create

In PostHog → Dashboards → New dashboard, name it **"Walking Explorers — North Star"**, and add these funnels and trends:

### Funnel A: Acquisition → Activation (the headline funnel)
1. `token_gate_viewed`
2. `code_claimed`
3. `onboarding_completed`
4. `first_route_viewed`
5. `first_walk_started`
6. `first_loop_completed`
7. `first_spot_saved`

Group by `tier` to compare beta-code holders vs free signups once we have both. Time window: 7 days from step 1.

### Funnel B: AI Route adoption (new in v0.7)
1. `ai_route_started`
2. `ai_route_question_answered` (count any)
3. `ai_route_generated`
4. `ai_route_walked`
5. `loop_completed` (filter `ai_generated = true`)

Use this to decide whether the AI flow earns its keep before v0.8.

### Funnel C: Around Me usage
1. `around_me_opened`
2. `around_me_pin_tapped`
3. `route_detail_viewed` (filter `source = 'around'`)
4. `walk_started`

### Funnel D: Share loop
1. `loop_completed`
2. `share_sheet_opened`
3. `share_target_picked`

### Trends to add
- **Daily Active Users** — unique users firing `daily_active` per day.
- **Loop completions per active user** — `loop_completed` / unique-users-with-`session_started`, daily.
- **Spots saved per loop** — `spot_saved` count broken down by `route_id`, weekly.
- **App errors per session** — `app_error` count divided by `session_started` count, daily. (Anything above ~0.05 is a yellow flag.)

### Insights
- Cohort: "Activated users" = anyone who fired `first_loop_completed`. Use this cohort to filter retention.
- Retention chart: `session_started` retention over 8 weeks for the Activated cohort.

---

## 6. Sentry setup

When Nova creates the Sentry project:
1. Platform: **JavaScript → Browser**.
2. Copy the DSN into Vercel as `SENTRY_DSN`.
3. Create an alert rule: **"Send to email on any new issue in production."** This is the canary — until v0.7 has been live a week or two, we want every new error type in our inbox.

For **source maps later** (we don't need them yet — the bundle is unminified), Nova can run from the project root after wiring `SENTRY_AUTH_TOKEN`:
```bash
npm i -g @sentry/cli
sentry-cli releases new walking-explorers@0.7.0 --org <org> --project walking-explorers
sentry-cli releases files walking-explorers@0.7.0 upload-sourcemaps ./beta/app/v2-scripts --url-prefix '~/beta/app/v2-scripts'
sentry-cli releases finalize walking-explorers@0.7.0
```
A Vercel `vercel.json` build hook can do this on every deploy, but we'll set that up when the bundler lands.

---

## 7. Opt-out UI hook (for Settings)

The Settings screen agent should add a toggle calling exactly these two methods, no glue required:

```js
// Read current state
const isOut = window.WE_T?.isOptedOut?.() ?? false;

// Toggle handler
function setTelemetryEnabled(enabled) {
  if (enabled) window.WE_T?.optIn();
  else         window.WE_T?.optOut();
}
```

State persists in `localStorage.we_telemetry_opt` (`'in'` or `'out'`). Default is opted-in (we are a small private beta with explicit consent in the token-gate copy).

---

## 8. Support / debug surface

The error-handler keeps the last 20 errors in `localStorage.we_recent_errors`. The admin panel can dump them for a support case:

```js
const recent = window.WE_E?.getRecentErrors?.() ?? [];
console.table(recent);
// After triage:
window.WE_E?.clearRecentErrors?.();
```

Each entry contains `ts, name, message, stack (truncated), context, extra, we_ctx { current_screen, current_route, tier, session_id }` — enough to correlate with a PostHog session without leaking PII.

---

## 9. How other agents should instrument their features

The pattern, repeated everywhere:

```js
// At a key user action:
window.WE_T?.track('walk_started', {
  route_id: route.id,
  ai_generated: !!route.ai_generated,
  source: 'explore'
});

// When entering a screen:
window.WE_T?.page('walk_tracker');
window.WE_T?.setContext({ current_screen: 'walk_tracker', current_route: route.id });

// On a try/catch you couldn't recover from:
window.WE_E?.captureError(err, { context: 'walk_tracker', extra: { route_id: route.id } });
```

The `?.` is load-bearing — if telemetry didn't load (no key, offline, ad-blocker) the call is a silent no-op. The empty-list bug Nova hit today would have surfaced as an `app_error` event in PostHog *and* a Sentry issue, with `screen` and `route_id` tags attached.

---

## 10. Done criteria — self-check

- [x] All three files pushed in a single `push_files` commit.
- [x] `T.track(...)` safe to call without prior `T.init(...)`.
- [x] Both modules no-op when `POSTHOG_KEY` / `SENTRY_DSN` are unset.
- [x] Photos, GPS, free text, names, emails never sent (scrub list + key blocklist + regex scrub).
- [x] Errors flow to console + ring buffer + PostHog + Sentry through one funnel.
- [x] Opt-out is one method call; persists in localStorage.
- [x] Event catalog, env vars, dashboards, Sentry commands, opt-out hook documented (this file).
