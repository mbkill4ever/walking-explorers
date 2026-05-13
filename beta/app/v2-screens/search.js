/* ============================================================================
   Walking Explorers v0.7 — Search & Filter screen
   Owned by: Search & Filter agent

   ES module + window.Search fallback. No build step. No dependencies.

   Mission: replace the 12-route flat list with a typeable, filterable view
   that finds routes AND individual stops by free text, neighborhood, mood,
   or duration band.

   Public surface:
     Search.mount(container, opts)         - inject screen + bind events
     Search.setQuery(text)                 - programmatic query (re-runs match)
     Search.applyFilter(category, value)   - toggle one filter
     Search.clearFilters()                 - clear all filters + query
     Search.destroy()                      - tear down listeners

   opts = {
     routes:        Array<Route>,           // the 12-route ROUTES array
     promotions:    Array<Promotion>,       // optional (future: search offers)
     neighborhoods: Array<{id,name,grad}>,  // optional, falls back to window.NEIGHBORHOODS
     onPick:        (route, stop?) => void, // route to open detail; stop optional
     onCancel:      () => void              // Cancel link in top bar
   }

   localStorage contract:
     we_recent_searches : JSON.stringify(Array<string>)
       - last 5 non-empty queries, most-recent first
       - capped + de-duped (case-insensitive)
       - never written if length > 5
       - never read from outside this module
   ============================================================================ */

const _w = (typeof window !== 'undefined') ? window : {};

/* ----------------------------------------------------------------------------
   Static config — categories, options, mood->keyword map.
   ---------------------------------------------------------------------------- */

const DURATION_BANDS = [
  { id: 'under60', label: 'Under 60 min', test: (r) => Number(r.minutes) < 60 },
  { id: '60to90',  label: '60-90 min',   test: (r) => Number(r.minutes) >= 60 && Number(r.minutes) <= 90 },
  { id: '90plus',  label: '90+ min',     test: (r) => Number(r.minutes) > 90 }
];

/* The 8 neighborhoods the v0.7 app ships with. We hard-code id+label so the
   chip row is stable even if NEIGHBORHOODS evolves; missing ids are silently
   filtered out at mount. The 'all' chip is rendered as a sticky 'reset' for
   the neighborhood row. */
const NEIGHBORHOOD_CHIPS = [
  { id: 'all',          label: 'All' },
  { id: 'soho',         label: 'SoHo' },
  { id: 'ev',           label: 'East Village' },
  { id: 'westvillage',  label: 'West Village' },
  { id: 'chelsea',      label: 'Chelsea' },
  { id: 'williamsburg', label: 'Williamsburg' },
  { id: 'dumbo',        label: 'DUMBO' },
  { id: 'centralpark',  label: 'Central Park' },
  { id: 'les',          label: 'LES' }
];

const MOOD_CHIPS = [
  { id: 'coffee',       label: 'Coffee' },
  { id: 'hidden_gems',  label: 'Hidden gems' },
  { id: 'photo_spots',  label: 'Photo spots' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'food',         label: 'Food' },
  { id: 'art',          label: 'Art' },
  { id: 'nature',       label: 'Nature' },
  { id: 'books',        label: 'Books' },
  { id: 'sunset',       label: 'Sunset' },
  { id: 'date_worthy',  label: 'Date-worthy' }
];

/* Mood -> keyword list. Synced with the AI Route Generator agent's mapping;
   if they expose a richer map at runtime as `window.MOOD_KEYWORDS`, we prefer
   theirs. Keep keywords lowercase + already-folded (ASCII-only). */
const MOOD_KEYWORDS_DEFAULT = {
  coffee:       ['coffee', 'cafe', 'cafe',    'espresso', 'cappuccino', 'latte', 'pour-over', 'pour over'],
  hidden_gems:  ['hidden', 'secret', 'tucked', 'quiet', 'underrated', 'unknown', 'tiny'],
  photo_spots:  ['photogenic', 'photo', 'shot', 'instagram', 'iconic', 'view', 'photographed'],
  architecture: ['cast-iron', 'cast iron', 'brownstone', 'church', 'building', 'tower', 'arch', 'columns', 'cobblestone'],
  food:         ['restaurant', 'eat', 'meal', 'pizza', 'bagel', 'sandwich', 'brunch', 'food', 'dumpling', 'dumplings'],
  art:          ['gallery', 'galleries', 'museum', 'art', 'artist', 'studio', 'exhibition', 'mural', 'murals'],
  nature:       ['park', 'garden', 'tree', 'river', 'beach', 'water', 'pier'],
  books:        ['book', 'books', 'shop', 'literary', 'reading', 'novel', 'bookshop'],
  sunset:       ['sunset', 'golden', 'view', 'overlook', 'evening', 'hour', 'skyline'],
  date_worthy:  ['romantic', 'date', 'wine', 'bar', 'cocktail', 'intimate', 'sunset']
};

const SUGGESTED_SEARCHES = [
  'SoHo cafes',
  'Hidden gems in Williamsburg',
  'Sunset walks',
  '60-minute walks',
  'Photo spots'
];

const RECENTS_KEY = 'we_recent_searches';
const RECENTS_MAX = 5;
const DEBOUNCE_MS = 150;

/* ----------------------------------------------------------------------------
   Pure helpers — folding, escaping, matching.
   ---------------------------------------------------------------------------- */

function esc(s) {
  if (typeof _w.esc === 'function') return _w.esc(s);
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* Accent-insensitive, case-insensitive folding. Strips combining marks so
   "cafe" and "café" compare equal. */
function fold(s) {
  if (s == null) return '';
  const str = String(s);
  // NFD splits "é" into "e" + combining accent; we strip the combining-marks
  // range U+0300..U+036F using \u-escapes so the source file is pure ASCII.
  if (typeof str.normalize === 'function') {
    return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  return str.toLowerCase();
}

/* Build a precomputed search index for routes once at mount. */
function buildIndex(routes, neighborhoods, moodKeywords) {
  const nbhdById = Object.create(null);
  (neighborhoods || []).forEach((n) => { if (n && n.id) nbhdById[n.id] = n; });

  return (routes || []).map((r) => {
    const nbhd = nbhdById[r.nbhd] || { name: '' };
    const stops = Array.isArray(r.stops) ? r.stops : [];
    // Concatenated, folded haystack for whole-route mood-keyword inference.
    const allText = [
      r.title || '', r.desc || '', nbhd.name || '',
      ...stops.map((s) => [s.name || '', s.why || '', s.desc || ''].join(' '))
    ].join(' ');
    const folded = fold(allText);
    const moods = Object.create(null);
    Object.keys(moodKeywords || {}).forEach((moodId) => {
      const kws = moodKeywords[moodId] || [];
      moods[moodId] = kws.some((kw) => folded.indexOf(fold(kw)) !== -1);
    });
    // Per-stop folded text for stop-level free-text matches.
    const stopIndex = stops.map((s) => ({
      stop: s,
      folded: fold([s.name || '', s.why || '', s.desc || ''].join(' ')),
      foldedName: fold(s.name || '')
    }));
    return {
      route: r,
      nbhd: nbhd,
      foldedTitle: fold(r.title || ''),
      foldedDesc: fold(r.desc || ''),
      foldedNbhd: fold(nbhd.name || ''),
      stopIndex,
      moods
    };
  });
}

/* Score a single indexed route against a folded query. Returns
   { score, titleHit, descHit, nbhdHit, stopHits } where stopHits is an array
   of { stop, where: 'name'|'why'|'desc' }. */
function scoreRoute(idx, q) {
  if (!q) return { score: 1, titleHit: false, descHit: false, nbhdHit: false, stopHits: [] };
  let score = 0;
  const titleHit = idx.foldedTitle.indexOf(q) !== -1;
  const descHit  = idx.foldedDesc.indexOf(q)  !== -1;
  const nbhdHit  = idx.foldedNbhd.indexOf(q)  !== -1;
  if (titleHit) score += 10;
  if (descHit)  score += 4;
  if (nbhdHit)  score += 3;
  const stopHits = [];
  for (const s of idx.stopIndex) {
    if (s.foldedName.indexOf(q) !== -1) {
      stopHits.push({ stop: s.stop, where: 'name' });
      score += 6;
    } else if (s.folded.indexOf(q) !== -1) {
      stopHits.push({ stop: s.stop, where: 'why' });
      score += 2;
    }
  }
  return { score, titleHit, descHit, nbhdHit, stopHits };
}

/* Render-time highlight: wrap matching substring in <mark>. q is already
   folded; we re-fold each chunk and walk indices in lockstep. */
function highlight(originalText, q) {
  const text = String(originalText == null ? '' : originalText);
  if (!q) return esc(text);
  const folded = fold(text);
  const idx = folded.indexOf(q);
  if (idx === -1) return esc(text);
  const before = text.slice(0, idx);
  const match  = text.slice(idx, idx + q.length);
  const after  = text.slice(idx + q.length);
  return esc(before) + '<mark>' + esc(match) + '</mark>' + highlight(after, q);
}

/* ----------------------------------------------------------------------------
   localStorage helpers — recent searches. Never throw; fail silent on Safari
   private mode / quota errors.
   ---------------------------------------------------------------------------- */

function readRecents() {
  try {
    const raw = _w.localStorage && _w.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === 'string' && x.length).slice(0, RECENTS_MAX);
  } catch (_) { return []; }
}

function writeRecents(arr) {
  try {
    if (!_w.localStorage) return;
    const trimmed = (arr || []).slice(0, RECENTS_MAX);
    _w.localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed));
  } catch (_) { /* private mode / over-quota — silent */ }
}

function pushRecent(query) {
  const q = String(query || '').trim();
  if (!q) return;
  const list = readRecents().filter((x) => fold(x) !== fold(q));
  list.unshift(q);
  writeRecents(list.slice(0, RECENTS_MAX));
}

function removeRecent(query) {
  const list = readRecents().filter((x) => fold(x) !== fold(query));
  writeRecents(list);
}

/* ----------------------------------------------------------------------------
   Telemetry — best-effort, never throws.
   ---------------------------------------------------------------------------- */
function track(event, props) {
  try {
    if (_w.Telemetry && typeof _w.Telemetry.track === 'function') {
      _w.Telemetry.track(event, props || {});
    }
  } catch (_) { /* no-op */ }
}

/* ----------------------------------------------------------------------------
   Per-instance state. We support exactly one mounted Search at a time (the
   app shell tears one down before mounting another). The module captures all
   state in a closure object that Search.destroy() unbinds.
   ---------------------------------------------------------------------------- */

let _state = null;

/* ----------------------------------------------------------------------------
   HTML builders for the chip rows + active-filter strip
   ---------------------------------------------------------------------------- */

function renderFilterGroupsHtml() {
  const row = (cat, label, items, selected) =>
    '<div class="we-search__filter-group" data-category="' + esc(cat) + '">' +
      '<div class="we-search__filter-label">' + esc(label) + '</div>' +
      '<div class="we-search__chips" role="group" aria-label="' + esc(label) + ' filters">' +
        items.map((it) =>
          '<button type="button" class="we-search__chip" ' +
            'data-category="' + esc(cat) + '" data-value="' + esc(it.id) + '" ' +
            'aria-pressed="' + ((selected.indexOf(it.id) !== -1) ? 'true' : 'false') + '">' +
            esc(it.label) +
          '</button>'
        ).join('') +
      '</div>' +
    '</div>';

  return (
    row('duration',      'Duration',     DURATION_BANDS,     _state.filters.duration) +
    row('neighborhood',  'Neighborhood', NEIGHBORHOOD_CHIPS, _state.filters.neighborhood) +
    row('mood',          'Mood',         MOOD_CHIPS,         _state.filters.mood)
  );
}

function activeFilterChipsHtml(resultCount) {
  const flat = [];
  _state.filters.duration.forEach((id) => {
    const f = DURATION_BANDS.find((x) => x.id === id);
    if (f) flat.push({ category: 'duration', value: id, label: f.label });
  });
  _state.filters.neighborhood.forEach((id) => {
    const f = NEIGHBORHOOD_CHIPS.find((x) => x.id === id);
    if (f && id !== 'all') flat.push({ category: 'neighborhood', value: id, label: f.label });
  });
  _state.filters.mood.forEach((id) => {
    const f = MOOD_CHIPS.find((x) => x.id === id);
    if (f) flat.push({ category: 'mood', value: id, label: f.label });
  });

  if (!flat.length && !_state.query) return null;

  const chips = flat.map((f) =>
    '<span class="we-search__active-chip">' +
      esc(f.label) +
      '<button type="button" aria-label="Remove ' + esc(f.label) + '" ' +
        'data-action="remove" data-category="' + esc(f.category) + '" data-value="' + esc(f.value) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false">' +
          '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>' +
        '</svg>' +
      '</button>' +
    '</span>'
  ).join('');

  const noun = resultCount === 1 ? 'walk' : 'walks';
  return (
    '<span class="we-search__active-count">' + resultCount + ' ' + noun + '</span>' +
    chips +
    '<button type="button" class="we-search__active-clear" data-action="clear-all">Clear all</button>'
  );
}

/* ----------------------------------------------------------------------------
   Card builders
   ---------------------------------------------------------------------------- */

function gradientFor(nbhd) {
  if (nbhd && nbhd.grad) return nbhd.grad;
  return 'linear-gradient(135deg, #1F3864 0%, #162B4A 100%)';
}

function routeCardHtml(idx, hit, foldedQuery) {
  const r = idx.route;
  const nbhd = idx.nbhd || {};
  const titleHtml = foldedQuery ? highlight(r.title || '', foldedQuery) : esc(r.title || '');
  const descHtml  = foldedQuery ? highlight(r.desc  || '', foldedQuery) : esc(r.desc  || '');

  // Matching-stops sub-results (only when the user has a query AND we found
  // stop-level hits). De-dupe by stop name.
  let stopsHtml = '';
  if (foldedQuery && hit.stopHits && hit.stopHits.length) {
    const seen = Object.create(null);
    const items = [];
    for (const h of hit.stopHits) {
      const key = fold(h.stop.name || '');
      if (seen[key]) continue;
      seen[key] = 1;
      items.push(
        '<button type="button" class="we-search__stop" ' +
          'data-action="open-stop" data-stop-name="' + esc(h.stop.name || '') + '">' +
          '<div class="we-search__stop-name">' + highlight(h.stop.name || '', foldedQuery) + '</div>' +
          (h.stop.why
            ? '<div class="we-search__stop-why">' + highlight(h.stop.why, foldedQuery) + '</div>'
            : '') +
        '</button>'
      );
    }
    if (items.length) {
      const found = items.length;
      stopsHtml =
        '<div class="we-search__stops">' +
          '<div class="we-search__stops-h">Found ' + found + ' stop' + (found === 1 ? '' : 's') + '</div>' +
          items.join('') +
        '</div>';
    }
  }

  return (
    '<div class="we-search__card" role="listitem" tabindex="0" ' +
      'data-action="open-route" data-route-id="' + esc(r.id) + '">' +
      '<div class="we-search__cover" style="background:' + gradientFor(nbhd) + ';">' +
        '<div class="we-search__cover-overlay"></div>' +
        '<span class="we-search__cover-badge">NYC pick</span>' +
        '<div class="we-search__cover-meta">' + (Array.isArray(r.stops) ? r.stops.length : 0) + ' stops</div>' +
      '</div>' +
      '<div class="we-search__body">' +
        '<div class="we-search__nbhd">' + esc(nbhd.name || 'NYC') + '</div>' +
        '<h3 class="we-search__title">' + titleHtml + '</h3>' +
        '<p class="we-search__desc">' + descHtml + '</p>' +
        '<div class="we-search__meta-row">' +
          '<span>' + esc(formatMinutes(r.minutes)) + '</span>' +
          '<span>' + esc(String(r.miles)) + ' mi</span>' +
        '</div>' +
        stopsHtml +
      '</div>' +
    '</div>'
  );
}

function formatMinutes(m) {
  const n = Number(m);
  if (!isFinite(n) || n <= 0) return '—';
  if (n < 60) return n + ' min';
  const h = Math.floor(n / 60);
  const r = n - (h * 60);
  return r ? (h + 'h ' + r + 'm') : (h + 'h');
}

/* ----------------------------------------------------------------------------
   Suggest block (recent + suggested) builder
   ---------------------------------------------------------------------------- */

function suggestHtml() {
  const recents = readRecents();
  let html = '';
  if (recents.length) {
    html +=
      '<section class="we-search__suggest-section">' +
        '<h3 class="we-search__suggest-h">Recent</h3>' +
        '<div class="we-search__suggest-list">' +
          recents.map((q) =>
            '<button type="button" class="we-search__suggest-item" data-action="run-recent" data-query="' + esc(q) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
                '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>' +
              '</svg>' +
              '<span>' + esc(q) + '</span>' +
              '<span class="we-search__suggest-x" data-action="remove-recent" data-query="' + esc(q) + '" role="button" aria-label="Remove recent ' + esc(q) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>' +
              '</span>' +
            '</button>'
          ).join('') +
        '</div>' +
      '</section>';
  }
  // Always show suggestions when input is empty + no filters.
  html +=
    '<section class="we-search__suggest-section">' +
      '<h3 class="we-search__suggest-h">Try</h3>' +
      '<div class="we-search__suggest-list">' +
        SUGGESTED_SEARCHES.map((q) =>
          '<button type="button" class="we-search__suggest-item" data-action="run-suggest" data-query="' + esc(q) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
              '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>' +
            '</svg>' +
            '<span>' + esc(q) + '</span>' +
          '</button>'
        ).join('') +
      '</div>' +
    '</section>';
  return html;
}

/* ----------------------------------------------------------------------------
   Filter composition — AND across categories, OR within a category. Returns
   the surviving index entries (NOT mutated).
   ---------------------------------------------------------------------------- */

function applyAllFilters(indexes, filters) {
  const dur = filters.duration || [];
  const nbh = (filters.neighborhood || []).filter((id) => id !== 'all');
  const mood = filters.mood || [];

  return indexes.filter((idx) => {
    // Duration: OR within category.
    if (dur.length) {
      const ok = dur.some((bandId) => {
        const band = DURATION_BANDS.find((b) => b.id === bandId);
        return band ? band.test(idx.route) : false;
      });
      if (!ok) return false;
    }
    // Neighborhood: OR within category.
    if (nbh.length) {
      if (nbh.indexOf(idx.route.nbhd) === -1) return false;
    }
    // Mood: OR within category, using precomputed mood booleans.
    if (mood.length) {
      const ok = mood.some((moodId) => !!idx.moods[moodId]);
      if (!ok) return false;
    }
    return true;
  });
}

/* ----------------------------------------------------------------------------
   The main render — call after any state change. Pure: reads _state and the
   prebuilt indexes; writes innerHTML into _state.dom.*.
   ---------------------------------------------------------------------------- */

function rerender() {
  if (!_state || !_state.host) return;

  // 1. Top filter rows
  _state.dom.filters.innerHTML = renderFilterGroupsHtml();

  // 2. Compute results (filters + free-text query)
  const folded = fold(_state.query.trim());
  const filtered = applyAllFilters(_state.indexes, _state.filters);

  const scored = filtered
    .map((idx) => ({ idx, hit: scoreRoute(idx, folded) }))
    .filter((x) => !folded || x.hit.score > 0)
    .sort((a, b) => {
      // Higher score first.
      if (b.hit.score !== a.hit.score) return b.hit.score - a.hit.score;
      // Tie-breaker: title-match wins, then minutes ascending.
      if (a.hit.titleHit !== b.hit.titleHit) return a.hit.titleHit ? -1 : 1;
      return Number(a.idx.route.minutes || 0) - Number(b.idx.route.minutes || 0);
    });

  // 3. Active-filter strip + count
  const activeHtml = activeFilterChipsHtml(scored.length);
  if (activeHtml) {
    _state.dom.active.hidden = false;
    _state.dom.active.innerHTML = activeHtml;
  } else {
    _state.dom.active.hidden = true;
    _state.dom.active.innerHTML = '';
  }

  // 4. Suggest block — visible only when input empty AND no active filters
  const noFilters =
    !_state.filters.duration.length &&
    !_state.filters.neighborhood.filter((id) => id !== 'all').length &&
    !_state.filters.mood.length;
  const showSuggest = (!_state.query.trim() && noFilters);
  if (showSuggest) {
    _state.dom.suggest.hidden = false;
    _state.dom.suggest.innerHTML = suggestHtml();
  } else {
    _state.dom.suggest.hidden = true;
    _state.dom.suggest.innerHTML = '';
  }

  // 5. Results / empty state
  if (scored.length === 0 && (folded || !noFilters)) {
    _state.dom.results.innerHTML = '';
    _state.dom.empty.hidden = false;
  } else {
    _state.dom.empty.hidden = true;
    _state.dom.results.innerHTML = scored
      .map(({ idx, hit }) => routeCardHtml(idx, hit, folded))
      .join('');
  }

  // 6. Clear button visibility — input non-empty shows X
  if (_state.dom.clearBtn) {
    _state.dom.clearBtn.hidden = !_state.query.length;
  }
}

/* ----------------------------------------------------------------------------
   Event handlers — delegated where possible to keep them GC-friendly.
   ---------------------------------------------------------------------------- */

function handleInput(e) {
  _state.query = String(e.target.value || '');
  // Debounce the heavy rerender (filtering + DOM). 150ms feels live but avoids
  // burning a frame on every keystroke.
  if (_state.debounceId) clearTimeout(_state.debounceId);
  _state.debounceId = setTimeout(() => {
    _state.debounceId = null;
    rerender();
    if (_state.query.trim()) {
      track('search_typed', { length: _state.query.trim().length });
    }
  }, DEBOUNCE_MS);
  // Toggle clear-button immediately for snappy UX.
  if (_state.dom.clearBtn) _state.dom.clearBtn.hidden = !_state.query.length;
}

function handleInputSubmit(e) {
  // Enter key — commit query to recents.
  if (e.key === 'Enter' && _state.query.trim()) {
    pushRecent(_state.query.trim());
    track('search_committed', { query_len: _state.query.trim().length });
    e.target.blur();
  } else if (e.key === 'Escape') {
    _state.query = '';
    _state.dom.input.value = '';
    rerender();
  }
}

function handleClear() {
  _state.query = '';
  _state.dom.input.value = '';
  _state.dom.input.focus();
  rerender();
}

function handleCancel() {
  // Commit any pending query to recents so the user can re-run it later.
  if (_state.query.trim()) pushRecent(_state.query.trim());
  track('search_cancelled', {});
  if (typeof _state.opts.onCancel === 'function') {
    try { _state.opts.onCancel(); } catch (_) { /* swallow */ }
  } else if (_w.Nav && typeof _w.Nav.back === 'function') {
    _w.Nav.back();
  }
}

/* The big delegated click handler — handles chips, active-chip removal,
   "Clear all", "Show me everything", suggest/recent items, and result cards.
   Each branch returns early. */
function handleClick(e) {
  const t = e.target;
  if (!t || !t.closest) return;

  // ---- Filter chip toggle ----
  const chip = t.closest('.we-search__chip');
  if (chip && _state.dom.filters.contains(chip)) {
    const cat = chip.getAttribute('data-category');
    const val = chip.getAttribute('data-value');
    toggleFilter(cat, val);
    return;
  }

  // ---- Remove a single active-filter chip ----
  const removeBtn = t.closest('[data-action="remove"]');
  if (removeBtn && _state.dom.active.contains(removeBtn)) {
    const cat = removeBtn.getAttribute('data-category');
    const val = removeBtn.getAttribute('data-value');
    toggleFilter(cat, val);
    return;
  }

  // ---- Clear all (active strip) ----
  if (t.closest('[data-action="clear-all"]')) {
    clearAllFilters();
    return;
  }

  // ---- Show me everything (empty state) ----
  if (t.closest('#weSearchShowAll')) {
    clearAllFilters();
    return;
  }

  // ---- Suggest / recent item ----
  const recentRm = t.closest('[data-action="remove-recent"]');
  if (recentRm) {
    e.stopPropagation();
    const q = recentRm.getAttribute('data-query');
    removeRecent(q);
    rerender();
    return;
  }
  const suggest = t.closest('[data-action="run-suggest"], [data-action="run-recent"]');
  if (suggest) {
    const q = suggest.getAttribute('data-query') || '';
    _state.query = q;
    _state.dom.input.value = q;
    pushRecent(q);
    track('search_suggest_picked', { query: q, source: suggest.getAttribute('data-action') });
    rerender();
    return;
  }

  // ---- Stop sub-result ----
  const stopBtn = t.closest('[data-action="open-stop"]');
  if (stopBtn) {
    e.stopPropagation();
    const stopName = stopBtn.getAttribute('data-stop-name');
    const card = stopBtn.closest('.we-search__card');
    const routeId = card && card.getAttribute('data-route-id');
    const route = _state.opts.routes.find((r) => r.id === routeId);
    const stop = route && Array.isArray(route.stops)
      ? route.stops.find((s) => s.name === stopName)
      : null;
    if (_state.query.trim()) pushRecent(_state.query.trim());
    track('search_result_opened', { route_id: routeId, stop_name: stopName });
    if (typeof _state.opts.onPick === 'function') {
      try { _state.opts.onPick(route, stop); } catch (_) { /* swallow */ }
    }
    return;
  }

  // ---- Route card ----
  const card = t.closest('[data-action="open-route"]');
  if (card) {
    const routeId = card.getAttribute('data-route-id');
    const route = _state.opts.routes.find((r) => r.id === routeId);
    if (_state.query.trim()) pushRecent(_state.query.trim());
    track('search_result_opened', { route_id: routeId });
    if (typeof _state.opts.onPick === 'function') {
      try { _state.opts.onPick(route); } catch (_) { /* swallow */ }
    }
    return;
  }
}

/* Keyboard support for route cards (they're tabbable). */
function handleKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!t || !t.matches) return;
  if (t.matches('.we-search__card')) {
    e.preventDefault();
    t.click();
  }
}

/* ----------------------------------------------------------------------------
   Filter mutation helpers — keep _state.filters minimal & predictable.
   ---------------------------------------------------------------------------- */

function toggleFilter(category, value) {
  if (!category || !value) return;
  const arr = _state.filters[category];
  if (!Array.isArray(arr)) return;
  if (category === 'neighborhood' && value === 'all') {
    // "All" is a special reset within the row.
    _state.filters.neighborhood = [];
    rerender();
    track('search_filter_cleared', { category });
    return;
  }
  const i = arr.indexOf(value);
  if (i === -1) {
    arr.push(value);
    track('search_filter_added', { category, value });
  } else {
    arr.splice(i, 1);
    track('search_filter_removed', { category, value });
  }
  rerender();
}

function clearAllFilters() {
  _state.filters = { duration: [], neighborhood: [], mood: [] };
  _state.query = '';
  if (_state.dom.input) _state.dom.input.value = '';
  track('search_filter_cleared_all', {});
  rerender();
}

/* ----------------------------------------------------------------------------
   Fallback markup skeleton — declared BEFORE the public API so it's in TDZ-
   clear scope by the time Search.mount references it. Used only when the
   host element is empty (i.e. caller didn't preload the markup from
   search.html). Keeps the file self-sufficient when mounted into a vanilla
   <div> inside app-shell.js.
   ---------------------------------------------------------------------------- */
const MARKUP_SKELETON =
  '<header class="we-search__topbar">' +
    '<label class="we-search__inputwrap" for="weSearchInput">' +
      '<svg class="we-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>' +
      '</svg>' +
      '<input id="weSearchInput" class="we-search__input" type="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" inputmode="search" placeholder="Search routes, stops, neighborhoods" aria-label="Search routes, stops, neighborhoods" />' +
      '<button type="button" class="we-search__clear" id="weSearchClear" hidden aria-label="Clear search">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>' +
      '</button>' +
    '</label>' +
    '<button type="button" class="we-search__cancel" id="weSearchCancel" aria-label="Cancel and return">Cancel</button>' +
  '</header>' +
  '<div class="we-search__filters" id="weSearchFilters" role="region" aria-label="Filter routes"></div>' +
  '<div class="we-search__active" id="weSearchActive" hidden></div>' +
  '<section class="we-search__suggest" id="weSearchSuggest" aria-label="Suggested searches"></section>' +
  '<div class="we-search__results" id="weSearchResults" role="list"></div>' +
  '<div class="we-search__empty" id="weSearchEmpty" hidden role="status">' +
    '<div class="we-search__empty-art" aria-hidden="true">' +
      '<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
        '<defs><linearGradient id="weSearchEmptyGrad2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1F3864"/><stop offset="60%" stop-color="#162B4A"/><stop offset="100%" stop-color="#0E1B30"/></linearGradient></defs>' +
        '<rect x="0" y="0" width="200" height="140" rx="18" fill="url(#weSearchEmptyGrad2)"/>' +
        '<circle cx="86" cy="62" r="26" fill="none" stroke="#F2D67D" stroke-width="3"/>' +
        '<line x1="106" y1="82" x2="132" y2="108" stroke="#F2D67D" stroke-width="4" stroke-linecap="round"/>' +
        '<circle cx="86" cy="62" r="3" fill="#F2D67D"/>' +
      '</svg>' +
    '</div>' +
    '<h2 class="we-search__empty-title">No walks match those filters</h2>' +
    '<p class="we-search__empty-sub">Try a different keyword, drop a chip, or start over.</p>' +
    '<button type="button" class="we-search__empty-cta" id="weSearchShowAll">Show me everything</button>' +
  '</div>';

/* ----------------------------------------------------------------------------
   Public API
   ---------------------------------------------------------------------------- */

export const Search = {
  /* Mount the screen inside `container`. Returns nothing — call destroy() to
     unmount. Idempotent: a second mount on the same instance auto-destroys
     the previous one first. */
  mount(container, opts) {
    const host = (typeof container === 'string') ? document.querySelector(container) : container;
    if (!host) return;
    if (_state) Search.destroy();

    const moodKeywords = (opts && opts.moodKeywords) || _w.MOOD_KEYWORDS || MOOD_KEYWORDS_DEFAULT;
    const routes = (opts && opts.routes) || _w.ROUTES || [];
    const neighborhoods = (opts && opts.neighborhoods) || _w.NEIGHBORHOODS || [];

    _state = {
      host,
      opts: Object.assign({}, opts),
      query: '',
      filters: { duration: [], neighborhood: [], mood: [] },
      indexes: buildIndex(routes, neighborhoods, moodKeywords),
      dom: {},
      debounceId: null,
      bound: {}
    };
    _state.opts.routes = routes;
    _state.opts.neighborhoods = neighborhoods;

    // If the host doesn't already contain the markup (i.e. caller is just
    // handing us an empty div), inject the full skeleton. Otherwise reuse
    // whatever IDs match.
    if (!host.querySelector('#weSearchInput')) {
      host.innerHTML = MARKUP_SKELETON;
    }

    _state.dom.input    = host.querySelector('#weSearchInput');
    _state.dom.clearBtn = host.querySelector('#weSearchClear');
    _state.dom.cancel   = host.querySelector('#weSearchCancel');
    _state.dom.filters  = host.querySelector('#weSearchFilters');
    _state.dom.active   = host.querySelector('#weSearchActive');
    _state.dom.suggest  = host.querySelector('#weSearchSuggest');
    _state.dom.results  = host.querySelector('#weSearchResults');
    _state.dom.empty    = host.querySelector('#weSearchEmpty');

    // Bind events. We store the bound refs so destroy() can remove them.
    _state.bound.input    = handleInput;
    _state.bound.keydown  = handleInputSubmit;
    _state.bound.clear    = handleClear;
    _state.bound.cancel   = handleCancel;
    _state.bound.click    = handleClick;
    _state.bound.cardKey  = handleKeydown;

    if (_state.dom.input)    _state.dom.input.addEventListener('input',  _state.bound.input);
    if (_state.dom.input)    _state.dom.input.addEventListener('keydown', _state.bound.keydown);
    if (_state.dom.clearBtn) _state.dom.clearBtn.addEventListener('click', _state.bound.clear);
    if (_state.dom.cancel)   _state.dom.cancel.addEventListener('click',   _state.bound.cancel);
    host.addEventListener('click', _state.bound.click);
    host.addEventListener('keydown', _state.bound.cardKey);

    track('search_opened', { route_count: routes.length });
    rerender();
    // Autofocus the input on mount (mobile keyboards open; desktop cursor lands).
    if (_state.dom.input && !_state.dom.input.matches(':focus')) {
      try { _state.dom.input.focus({ preventScroll: true }); } catch (_) { _state.dom.input.focus(); }
    }
  },

  /* Programmatic query (e.g. deep-link "?q=vinyl"). */
  setQuery(text) {
    if (!_state) return;
    _state.query = String(text || '');
    if (_state.dom.input) _state.dom.input.value = _state.query;
    rerender();
  },

  applyFilter(category, value) {
    if (!_state) return;
    toggleFilter(category, value);
  },

  clearFilters() {
    if (!_state) return;
    clearAllFilters();
  },

  destroy() {
    if (!_state) return;
    const s = _state;
    if (s.debounceId) clearTimeout(s.debounceId);
    if (s.dom.input)    s.dom.input.removeEventListener('input',  s.bound.input);
    if (s.dom.input)    s.dom.input.removeEventListener('keydown', s.bound.keydown);
    if (s.dom.clearBtn) s.dom.clearBtn.removeEventListener('click', s.bound.clear);
    if (s.dom.cancel)   s.dom.cancel.removeEventListener('click',   s.bound.cancel);
    if (s.host) {
      s.host.removeEventListener('click', s.bound.click);
      s.host.removeEventListener('keydown', s.bound.cardKey);
    }
    _state = null;
  },

  /* Exposed for tests / debugging only. Don't call these from app code. */
  _buildIndex: buildIndex,
  _scoreRoute: scoreRoute,
  _fold:       fold,
  _readRecents: readRecents,
  _writeRecents: writeRecents,
  _MOOD_KEYWORDS_DEFAULT: MOOD_KEYWORDS_DEFAULT
};

// Window-global fallback for non-module callers.
if (typeof window !== 'undefined') { window.Search = Search; }

export default Search;
