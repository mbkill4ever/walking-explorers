# v0.7 — AI Route Generator (v07_03)

Owner: ai-route agent
Date: 2026-05-13
Status: Shipped on `main`. Frontend + backend implemented; no integrator
wiring yet beyond the documented contract.

## What this ships

A guided, four-question flow that takes a user's constraints — time
available, mood, starting point, optional free-text — and returns a
personalized walking route generated server-side from the 72-stop catalog.

Five files, owned exclusively by this agent:

- `beta/app/v2-screens/ai-route.html` — markup, mounted by the JS module
- `beta/app/v2-screens/ai-route.css`  — visual styling, scoped to `.we-air`
- `beta/app/v2-screens/ai-route.js`   — `AIRoute.mount` / `AIRoute.destroy`
- `api/routes/ai-generate.js`         — POST /api/routes/ai-generate
- `agent_reports/v07_03_ai_route.md`  — this report

## Integrator wiring — the contract

The frontend module is a takeover. It expects to be mounted into an empty
container (a div is fine; the module sets `position: fixed; inset: 0;` on
its own root). Typical usage from whatever wires the rest of v0.7:

```js
import AIRoute from '/beta/app/v2-screens/ai-route.js';

const host = document.getElementById('ai-route-host');
AIRoute.mount(host, {
  onGenerated(route) {
    // `route` is the same shape the Detail screen consumes.
    // Hand it off to Detail and navigate. Two common patterns:

    // 1) If Detail is a separate screen and accepts a route via in-memory
    //    handoff (preferred — avoids re-fetching):
    window.__we_preloadedRoute = route;
    location.hash = '#detail/' + encodeURIComponent(route.id);

    // 2) If Detail expects to fetch by ID, persist briefly to KV first
    //    and read in Detail. Not implemented in v0.7.
  },
  onClose() {
    history.back(); // or your preferred dismissal behavior
  },
});
```

To open the takeover, the integrator just calls `mount` on a container.
To dismiss programmatically, call `AIRoute.destroy()`.

### Route object shape

The route returned by `onGenerated` matches the spec exactly:

```json
{
  "id": "ai_1747160000000",
  "title": "A SoHo cafe crawl with doors most people walk past",
  "nbhd": "soho",
  "minutes": 60,
  "miles": 1.2,
  "desc": "Generated for you — 4 stops in 1.2 miles, leaning toward coffee + hidden gems.",
  "isAiGenerated": true,
  "stops": [
    {
      "name": "Joe Coffee — Crosby Street",
      "lat": 40.7224,
      "lon": -73.9966,
      "why": "Quietest of NYC's prettiest cafe spots.",
      "desc": "Small, warm cafe with reclaimed-wood interiors. Order a pour-over.",
      "sponsored": false
    }
  ],
  "note": "avoid crowds"
}
```

`sponsored` only appears when true. `note` only appears when the user
typed a free-text twist. `isAiGenerated: true` is the flag the Detail
screen can use to render the "Generated for you" badge or hide things
like the photo-essay header that doesn't exist for AI routes.

### Pre-fill behaviour

On mount, the module reads two `localStorage` keys set during onboarding:

- `we_mood` — JSON array of mood IDs. The mood pills are pre-selected
  for any IDs that match. Onboarding uses slightly different IDs
  (`aesthetic_photo`, `sunsets`) than the new ai-route IDs
  (`photo_spots`, `sunset`). Both are supported by the backend via
  legacy aliases in `MOOD_KEYWORDS` so the user doesn't have to re-pick.
- `we_anchor` — `{ lat, lon, timestamp }` cached from onboarding. If
  present, geolocation defaults to "saved location, ready to go" instead
  of re-prompting. The user can still toggle to neighborhood mode.

### Auth and rate limit

The backend requires a valid `we_session` cookie (`getSession` from
`lib/auth.js`). Unauthenticated calls return 401. The brief specifies
10 generations per user per hour; the limiter uses
`rateLimit(req, 'aigen:' + session.userId, { max: 10, windowSec: 3600 })`
backed by the same KV bucket as the rest of the app. A 429 response is
surfaced to the user as "You've used today's 10 generations — try again
in an hour."

## The scoring algorithm — v0.7 deterministic

No external model call in v0.7. The brief explicitly defers LLM
augmentation to v0.8. The whole pipeline runs in ~5ms on a serverless
cold start and is deterministic per (input, time) tuple, which is the
right shape for v0.7 demos and load testing.

### Step 1 — stop tagging (precomputed at module load)

The 72 stops in `STOPS` are tagged with implicit moods at module-load
time by keyword-matching against the concatenation of `name + why +
desc`. The keyword table `MOOD_KEYWORDS` covers every mood the
frontend offers, plus six legacy aliases from onboarding's ID set.

This is cheap to maintain (drop a string into the keyword arrays to
expand coverage), avoids hand-tagging the catalog (which would drift
the moment we add a stop), and is fast at runtime — each stop is a
`Set<string>` of resolved moods after first import.

### Step 2 — per-stop scoring

For each stop, given user inputs `(minutes, moods, origin, freeText)`:

```
score  =  (matched_moods.length * 25)        // mood overlap
       -  (miles_from_origin * 5)            // distance penalty
       +  (nbhd === origin.nbhd ? 50 : 0)    // neighborhood match
       +  (sponsored ? 5 : 0)                // small sponsored boost
```

Mood overlap is the dominant signal: three matched moods is +75,
roughly equivalent to a stop being 15 miles closer. Neighborhood
match is intentionally a hard +50 jump, which matters a lot when the
user picks "Williamsburg" — it ensures the route stays in the
neighborhood the user named even if a few SoHo stops are nominally
closer to their lat/lon. (The lat/lon path snaps to the nearest known
NYC neighborhood center so the +50 still fires for geo origins.)

The sponsored boost is deliberately tiny. It exists to break ties in
favor of revenue stops when two are otherwise equivalent — never enough
to surface a stop on its own. We also cap sponsored stops at one per
generated route (`sponsoredUsed >= 1` check during picking).

### Step 3 — pick + budget

Target stop count: `clamp(round(minutes / 18), 3, 7)`.
Distance budget: `1.0 + targetStops * 0.2` miles.

We sort all 72 stops by score descending and walk the list, keeping
stops that fit inside the distance budget until we hit `targetStops`.
If fewer than 3 stops fit (rare — happens only for very short walks
with an off-neighborhood origin), we relax the distance constraint
and fill from the same sorted list.

### Step 4 — order the picked stops geographically

A greedy nearest-neighbor TSP-lite. Start from the user's origin,
pick the nearest unvisited stop, repeat. O(n^2) but n ≤ 7, so this
is microseconds. The output is a sensible walking order — not
provably optimal, but good enough for a v0.7 route and far better
than score-order, which often produced "walk three blocks east,
then back west, then east again" patterns in early tests.

### Step 5 — title and description

Both are deterministic templated strings using a small `MOOD_NOUNS`
lookup table. The title takes the user's first two moods and weaves
them with the route's neighborhood label:

> "A SoHo cafe crawl with doors most people walk past"
> "An Upper Manhattan green-space walk with the best low-light blocks"

Article agreement ("A" vs "An") is handled with a vowel-initial regex
on the neighborhood label. The desc references the stop count, total
mileage, and mood lean, and surfaces the free-text twist as a
quoted note if the user provided one.

### Free text — v0.7 storage only

`freeText` is captured, validated (240 char max), stripped of
surrounding whitespace, and stored on the route object as `route.note`.
It is also surfaced in the desc line. The v0.7 scoring algorithm
does NOT condition on `freeText` content. This is intentional — the
brief says "store it in route.note for future LLM-augmentation in
v0.8." See the TODO below.

## Sanity-checked outputs

Tested locally with a stubbed-auth harness against five representative
inputs:

| Input | Title | Stops |
|---|---|---|
| coffee+hidden+photos, SoHo geo, 60min | A SoHo cafe crawl with doors most people walk past | Joe Coffee, Judd Foundation, Mercer vista |
| art+food+music, Williamsburg, 90min | A Williamsburg gallery hop with one bite per stop | Devocion, Rough Trade, Domino Park, Smorgasburg, Wythe rooftop |
| nature+sunset+photos, CP, 120min | An Upper Manhattan green-space walk with the best low-light blocks | Belvedere, Boathouse, Bethesda, Mall, Strawberry, Dakota, Zabar's |
| coffee only, West Village, 30min | A West Village cafe crawl | Three Lives, Cornelia, Caffe Reggio |
| empty moods, no origin | A walk through SoHo | McNally, Lure (sponsored), Greene Street |

The single-sponsored-per-route rule held in every case. Geographic
ordering was clean (no backtracking) in 4/5 cases; the empty-moods
case picked three stops separated by ~0.1mi total, which is the
correct degenerate behavior.

## Manual curl test

Once deployed, a smoke test from the integrator's terminal looks like:

```bash
curl -X POST https://walkingexplorers.com/api/routes/ai-generate \
  -H "Cookie: we_session=<your sid>.<sig>" \
  -H "Content-Type: application/json" \
  -d '{
    "minutes": 60,
    "moods": ["coffee", "hidden_gems", "photo_spots"],
    "origin": { "lat": 40.723, "lon": -73.998 },
    "freeText": "avoid crowds"
  }'
```

Expected: 200 with `{ ok: true, route: { ... } }`. Without the cookie,
401. After ten calls in an hour, 429 with `retryAfter: 3600`.

## TODO for v0.8 — LLM augmentation

The whole point of doing v0.7 deterministically is that v0.8 can slot
in an LLM call without breaking anything that calls into the route
shape we ship today. The plan:

1. **Title + desc rewriting.** Keep the deterministic title/desc as a
   fallback. Add an optional second pass: send `{ moods, freeText,
   stops: [name+why] }` to a small model with a 50-word title-and-desc
   prompt. Use the LLM output if it returns valid JSON within the
   budget; otherwise keep the templated version. This alone should
   produce noticeably more editorial-feeling routes — "A SoHo cafe
   crawl with doors most people walk past" is fine; "A 60-minute SoHo
   loop for someone who's tired of the photo crowds and wants the
   quiet block" is better.

2. **Free-text re-ranking.** Currently `freeText` is dead-weight on
   scoring. In v0.8 we'd add a re-rank pass: given the top 12 stops
   from the deterministic scorer plus the free-text string, ask the
   model which 3-7 best fit and in what order. The deterministic
   scorer stays the gate (so we never spend tokens on the full 72) and
   the LLM only fine-tunes the final set.

3. **`isAiGenerated` payload extension.** Add an optional
   `route.aiNotes` field surfacing per-stop one-liners written by the
   model — "Skip Devocion if you don't want a wait; Joe Coffee is the
   move when crowds are the constraint." Keep the existing
   `stop.why` / `stop.desc` as the deterministic baseline so the UI
   has something to render even when the LLM call fails.

4. **Caching.** With LLM in the loop, identical `(moods, minutes,
   origin, freeText)` tuples should hit a 24-hour KV cache. The
   deterministic pipeline today doesn't need this; the LLM pipeline
   will.

5. **Cost budget.** Rate limit can stay at 10/hr/user, but we should
   add a global daily cost cap that falls back to the deterministic
   path when exceeded, so a runaway integration never burns the
   month's API budget on a Sunday.

## Known limitations and follow-ups

- **NYC-only.** The stop catalog is duplicated inside the API file.
  Any catalog change has to be made in both `api/routes/ai-generate.js`
  (the 72-stop list) and the underlying walks HTML pages. v0.8 should
  consolidate to a single JSON catalog under `lib/`.
- **Mood tagging by substring is brittle.** Bare keywords like "art"
  match anywhere — including a desc that mentions "the art space SoHo
  used to be" even if the stop is more about furniture. I tuned the
  obvious offenders during testing but a longer audit + a stop-level
  blacklist would help. v0.8's LLM pass would dodge this entirely.
- **No "save as a real route" yet.** The generated route lives only in
  memory until Detail navigates away. v0.8 should let the user star
  the generated route, which would write it to a `user:routes:<userId>`
  KV bucket.
- **Geolocation prompt timing.** We ask on "Continue" from step 3
  rather than on the origin-button click, so the user has a moment to
  switch to neighborhood mode if they don't want the prompt. This
  feels right but is worth a usability check.

