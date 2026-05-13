# v0.7 — Agent 8: Search & Filter

Owner: Search & Filter agent
Branch: `main`
New files (all owned exclusively by this agent):

- `beta/app/v2-screens/search.html`
- `beta/app/v2-screens/search.css`
- `beta/app/v2-screens/search.js`
- `agent_reports/v07_08_search.md` (this file)

## What was built

A full-screen Search screen that replaces the 12-route flat list with a
typeable, filterable view. The top of the screen is a 16px search input
(below that threshold iOS Safari zooms on focus, which we never want), then
three horizontally scrollable filter-chip rows (**Duration**, **Neighborhood**,
**Mood**), then either:

1. **Suggested + recent searches** when the input is empty and no filters
   are active, or
2. **An active-filter strip + results list** when the user has typed or
   tapped a chip, or
3. **A navy-gradient empty state** with a "Show me everything" CTA when the
   filter combination yields zero results.

Each result is a `we-search__card` that mirrors the Explore-tab route card
(cover gradient, neighborhood tag, title, two-line description, time + miles
meta) but is namespaced so it does not inherit from `app-shell.js`. When the
user's query also matches a stop name / `why` / `desc`, the card grows a
"Found N stop(s)" sub-section underneath with a tappable button per stop.
Clicking a stop sub-result calls `onPick(route, stop)` so the Route Detail
screen can scroll-to-stop.

## Integrator wiring

The screen is a standard ES module + window-global fallback. Two integration
shapes work — pick whichever fits the app-shell's tab routing:

### A. Mount into an empty container (recommended)

```html
<!-- beta/app/index.html, inside the search tab pane -->
<div id="searchTab" class="tab-pane" hidden></div>

<script type="module">
  import Search from '/beta/app/v2-screens/search.js';

  // On tab-enter:
  Search.mount(document.getElementById('searchTab'), {
    routes:        window.ROUTES,
    promotions:    window.PROMOTIONS,
    neighborhoods: window.NEIGHBORHOODS,
    onPick: (route, stop) => {
      window.State.currentRoute = route;
      window.Nav.go('detail');
      if (stop) {
        // optional: pass the stop name through a state hook so detail.js
        // scrolls to it after mount
        window.State.pendingStopName = stop.name;
      }
    },
    onCancel: () => window.Nav.go('explore')   // or Nav.back()
  });

  // On tab-leave:
  Search.destroy();
</script>
```

When the container is empty, `Search.mount` injects the full markup skeleton
itself (see `MARKUP_SKELETON` in `search.js`). When the container already
contains the markup from `search.html`, the module wires events onto the
existing DOM instead of replacing it.

### B. Standalone harness (for the dev loop)

Open `beta/app/v2-screens/search.html` directly in a browser, paste
`window.ROUTES = [...]` (the 12-route array from `app-shell.js` lines
74-196), `window.NEIGHBORHOODS = [...]`, and `window.PROMOTIONS = [...]`
into devtools, then refresh. The page becomes a fully working sandbox —
type, filter, hit Enter — without the rest of the app shell. Picks log to
`console` and pop an `alert()` so you can verify which route + stop the
click resolved to.

### CSS link

```html
<link rel="stylesheet" href="/beta/app/v2-screens/search.css">
```

Add this once in `index.html`'s `<head>` alongside the existing
`right-now.css` and `capture.css` links. The selectors are namespaced under
`.we-search` so they cannot leak.

### Brand tokens

The CSS reads `--navy`, `--gold`, `--cream`, `--ink`, `--mute`, `--line`,
`--ease-glide`, `--ease-out-soft`, etc. from `:root` in `index.html`. If the
screen is loaded outside that root, every property has a literal fallback
inline (`var(--navy, #1F3864)` etc.) so the visual result is identical.

## localStorage contract — recent searches

**Key:** `we_recent_searches`
**Value:** `JSON.stringify(Array<string>)` — at most 5 entries, most-recent
first.

Rules enforced by `search.js`:

- Only **non-empty** trimmed queries are ever written.
- Duplicates are removed using accent-folded, case-insensitive comparison
  (`fold("CAFE") === fold("café")`).
- Push is always to the front, then sliced to `RECENTS_MAX = 5`.
- Read is wrapped in `try/catch` — Safari private-mode and quota errors
  fall back to an empty array.
- Writes can fail silently (e.g. when storage is full) without breaking the
  UI.
- The module is the **sole writer**. Other modules MUST NOT read or write
  `we_recent_searches` — instead, call `Search.setQuery(text)` programmatically
  to add a recent through the public API.

A query is committed to recents when:

1. The user presses **Enter** in the input.
2. The user taps **Cancel** with non-empty input.
3. The user taps a result card or stop sub-result (we treat clicks as
   commits because the query led to a useful outcome).
4. The user taps a Suggested-search item (so suggested → recent).

A recent item can be removed by tapping the trailing `x` on the row; the
list re-renders without that entry. Tapping the row itself re-runs the
query.

## Free-text matching

- **Folding:** Strings are normalised to lowercase + NFD-decomposed +
  combining-marks-stripped (U+0300..U+036F). `"Café"` and `"cafe"` are
  treated as equal. Implemented in `fold(s)`.
- **Substring match:** We use `String#indexOf` on folded text. No regex,
  no fuzzy matching (v0.8 work — see "Future expansion" below).
- **Per-route scoring:** title hit = +10, desc hit = +4, neighborhood hit =
  +3, stop-name hit = +6 per stop, stop-`why` hit = +2 per stop.
- **Ranking:** descending score → title-hit-first tie-breaker → ascending
  minutes.
- **Highlight:** the matching substring is wrapped in `<mark>` and styled
  with the gold token. Highlighting walks the original (non-folded) string
  so accents are preserved in the rendered output.

## Filter composition

- **AND across categories** (a duration AND a neighborhood AND a mood).
- **OR within a category** (Coffee OR Books is two mood chips lit; both
  match if either keyword group is present).
- "All" in the neighborhood row clears that row only — it is a soft reset.
- "Clear all" in the active-filter strip wipes every filter AND the query.

The mood-keyword map is hard-coded in `search.js` as `MOOD_KEYWORDS_DEFAULT`
and stays in sync with the AI Route Generator agent's published mapping.
If that agent later exposes a richer runtime mapping as
`window.MOOD_KEYWORDS`, this module prefers it without any code change.

## Telemetry events emitted

All events go through `window.Telemetry.track(name, props)` if defined;
otherwise they are no-ops. Names:

- `search_opened` { route_count }
- `search_typed` { length }
- `search_committed` { query_len }
- `search_cancelled` {}
- `search_filter_added` { category, value }
- `search_filter_removed` { category, value }
- `search_filter_cleared` { category }
- `search_filter_cleared_all` {}
- `search_suggest_picked` { query, source }
- `search_result_opened` { route_id, stop_name? }

## Accessibility

- Input is 16px to avoid iOS zoom; `enterkeyhint="search"` shows the right
  keyboard return label on mobile.
- The clear "x" has `aria-label="Clear search"`; the Cancel button has
  `aria-label="Cancel and return"`.
- Filter chips use `aria-pressed` (true/false) to communicate selection
  state to screen readers.
- The active-filter strip has a removable `<button>` per chip with
  `aria-label="Remove <label>"`.
- The empty state is `role="status"` so screen readers announce the
  no-results condition without focus-stealing.
- Results are `role="list"` / `role="listitem"`; each card is `tabindex="0"`
  with Enter + Space keyboard activation wired in `handleKeydown`.
- Focus rings use the navy + offset pattern from the rest of v0.7.

## Reduced motion

Every transition and animation is wrapped in
`@media (prefers-reduced-motion: reduce)` and explicitly cancelled with
`!important`. Hover-translate, chip-press scale, and the empty-state CTA
bounce all collapse to instant.

## Performance notes

- `buildIndex` runs once at `mount()` and precomputes folded haystacks +
  mood booleans per route. With 12 routes and ~6 stops each, this is
  ~72 small string normalisations — sub-millisecond on any device.
- The `input` event handler is debounced 150ms; the clear button shows /
  hides synchronously so the UI still feels instant.
- Filtering + ranking is `O(routes * stops)` per keystroke (~72 operations)
  and writes innerHTML once — no virtualisation needed below ~200 routes.

## Future expansion (v0.8+)

1. **Server-synced search history.** Today, `we_recent_searches` is
   per-device. v0.8 should add `POST /api/search/recent {query}` and
   `GET /api/search/recent` so the user's history follows them across
   devices. Migration is trivial — keep `we_recent_searches` as the
   write-through cache, hydrate it from the server on mount, push on Enter
   in addition to local storage. Backend storage in Vercel KV with TTL of
   60 days.
2. **AI-natural-language search via Claude API.** "Show me a quiet
   60-minute walk in SoHo with coffee" should resolve to
   `duration=60to90 OR under60`, `neighborhood=soho`, `mood=coffee,
   hidden_gems`. We can detect when a query contains > 2 stop-words +
   doesn't match anything in the index, and fall through to
   `POST /api/search/parse` that prompts Claude to return the filter
   triple. UI: a "Try AI search" link in the empty state.
3. **Promotion search.** `opts.promotions` is already wired but unused —
   v0.8 will surface a "Nearby deals" tab in the results when a query
   matches a promotion business name or offer text.
4. **Map-aware search.** Hook into the Around-Me agent's geolocation
   stream so "near me" or "closest" intent re-ranks by `haversine(stop,
   userPos)`.
5. **Stop-only mode.** A toggle that filters to stops (across all routes)
   instead of whole routes — useful for "I'm at Houston St, what's
   here?".
6. **Per-stop deep linking.** Once the Route Detail screen supports
   `?stop=<name>`, we should pass that through `onPick(route, stop)` and
   anchor-scroll on arrival.
7. **i18n.** Move every visible string into `microcopy.json` so the
   Translation agent can localise this screen along with the rest of v0.7.

## Files pushed in this commit

Single `push_files` commit containing four new files:

```
beta/app/v2-screens/search.html
beta/app/v2-screens/search.css
beta/app/v2-screens/search.js
agent_reports/v07_08_search.md
```

No other files were touched. The search screen is dark-launched until the
app-shell integrator wires it into the tab bar.
