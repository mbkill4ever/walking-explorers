/* ============================================================================
   Walking Explorers v2 — Right Now contextual onboarding card
   Owned by: right-now agent

   ES module + window.RightNow fallback. No build step. No dependencies.

   Mission: replace the generic greeting + 12-route menu with ONE editorial
   recommendation tailored to the current moment (time, weather, sunset,
   archive history). Spotify Daylist / Strava-weather-picker style.

   Public surface:
     RightNow.render(container)              — inject the card into a host
     RightNow.pick()                         — return the chosen route + ctx
     RightNow.refresh()                      — re-evaluate context, re-render

   Host-app contract (window globals, all optional — module degrades gracefully):
     window.ROUTES, window.NEIGHBORHOODS  — from index.html
     window.State, window.Nav             — for navigation on CTA click
     window.API.spotsList                 — for personalisation
     window.Telemetry.track               — for analytics
     window.esc                           — HTML-escape helper
   ============================================================================ */

/* ----------------------------------------------------------------------------
   Local helpers — each defensively falls back if globals are missing.
   ---------------------------------------------------------------------------- */
const _w = (typeof window !== 'undefined') ? window : {};

function esc(s) {
  if (typeof _w.esc === 'function') return _w.esc(s);
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function getRoutes() {
  return Array.isArray(_w.ROUTES) ? _w.ROUTES : [];
}

function routeById(id) {
  return getRoutes().find((r) => r.id === id) || null;
}

function neighbourhoodName(nbhdId) {
  const list = Array.isArray(_w.NEIGHBORHOODS) ? _w.NEIGHBORHOODS : [];
  const n = list.find((x) => x.id === nbhdId);
  return n ? n.name : 'NYC';
}

function track(event, props) {
  try {
    if (_w.Telemetry && typeof _w.Telemetry.track === 'function') {
      _w.Telemetry.track(event, props || {});
    }
  } catch (_) { /* no-op */ }
}

/* ----------------------------------------------------------------------------
   Weather: Open-Meteo (no API key, free) + WMO weather-code mapping.
   Defaults to NYC (40.7128, -74.0060) but is geolocation-aware if granted.
   ---------------------------------------------------------------------------- */
const DEFAULT_LAT = 40.7128;
const DEFAULT_LON = -74.0060;

/* WMO weather code → simple condition bucket.
   Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes) */
function wmoToCondition(code) {
  if (code == null) return 'clear';
  const c = Number(code);
  if (c === 0) return 'clear';
  if (c === 1 || c === 2) return 'partly_cloudy';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return 'rain';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 80 && c <= 82) return 'rain';
  if (c >= 85 && c <= 86) return 'snow';
  if (c >= 95 && c <= 99) return 'storm';
  return 'cloudy';
}

function conditionLabel(cond) {
  return ({
    clear: 'Clear',
    partly_cloudy: 'Partly cloudy',
    cloudy: 'Cloudy',
    fog: 'Foggy',
    drizzle: 'Drizzle',
    rain: 'Rain',
    snow: 'Snow',
    storm: 'Storm'
  })[cond] || 'Clear';
}

/* NOAA solar-position approximation — returns sunrise/sunset as JS Dates for a
   given latitude/longitude and local date. Accuracy is ±~2 minutes which is
   plenty for "the sun is setting soon" copywriting. */
function solarTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  // Day of year.
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = (date - start) + ((start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000);
  const N = Math.floor(diff / 86400000);

  // Approximate noon longitude correction.
  const lngHour = lon / 15;
  // Sunrise (rising = true) + sunset (rising = false).
  function compute(rising) {
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = (0.9856 * t) - 3.289;
    let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = deg * Math.atan(0.91764 * Math.tan(L * rad));
    RA = ((RA % 360) + 360) % 360;
    const Lquadrant = (Math.floor(L / 90)) * 90;
    const RAquadrant = (Math.floor(RA / 90)) * 90;
    RA = RA + (Lquadrant - RAquadrant);
    RA = RA / 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const zenith = 90.833;
    const cosH = (Math.cos(zenith * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null; // polar regions — not us
    let H = rising ? (360 - deg * Math.acos(cosH)) : (deg * Math.acos(cosH));
    H = H / 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    let UT = T - lngHour;
    UT = ((UT % 24) + 24) % 24;
    const hh = Math.floor(UT);
    const mm = Math.round((UT - hh) * 60);
    const d = new Date(date.getTime());
    d.setUTCHours(hh, mm, 0, 0);
    return d;
  }
  return { sunrise: compute(true), sunset: compute(false) };
}

function fmtClock(date) {
  if (!date) return '—';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ----------------------------------------------------------------------------
   Internal: gather + fetch context
   ---------------------------------------------------------------------------- */
async function gatherContext() {
  const now = new Date();
  const ctx = {
    hour: now.getHours(),
    minute: now.getMinutes(),
    dayIdx: now.getDay(),
    day: now.toLocaleDateString('en-US', { weekday: 'short' }),
    time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    isWeekend: (now.getDay() === 0 || now.getDay() === 6),
    lat: DEFAULT_LAT,
    lon: DEFAULT_LON,
    temp_f: 68,
    condition: 'clear',
    sunrise: null,
    sunset: null,
    minutesUntilSunset: null,
    visitedNeighborhoods: [],
    visitCountByNbhd: {},
    archiveSize: 0
  };

  // 1. Weather + sunset (Open-Meteo, free, no key).
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + ctx.lat +
      '&longitude=' + ctx.lon +
      '&current=temperature_2m,weather_code' +
      '&daily=sunrise,sunset' +
      '&temperature_unit=fahrenheit' +
      '&timezone=auto';
    const r = await fetch(url, { credentials: 'omit' });
    if (r.ok) {
      const d = await r.json();
      const t = d && d.current && d.current.temperature_2m;
      const wc = d && d.current && d.current.weather_code;
      if (typeof t === 'number') ctx.temp_f = Math.round(t);
      ctx.condition = wmoToCondition(wc);
      if (d && d.daily && Array.isArray(d.daily.sunrise) && d.daily.sunrise[0]) {
        ctx.sunrise = new Date(d.daily.sunrise[0]);
      }
      if (d && d.daily && Array.isArray(d.daily.sunset) && d.daily.sunset[0]) {
        ctx.sunset = new Date(d.daily.sunset[0]);
      }
    }
  } catch (_) { /* offline / blocked — fall through to local approximation */ }

  // 2. Sunrise/sunset fallback via local NOAA approximation.
  if (!ctx.sunset || !ctx.sunrise) {
    const sol = solarTimes(now, ctx.lat, ctx.lon);
    if (sol) {
      ctx.sunrise = ctx.sunrise || sol.sunrise;
      ctx.sunset = ctx.sunset || sol.sunset;
    }
  }

  if (ctx.sunset) {
    ctx.minutesUntilSunset = Math.round((ctx.sunset.getTime() - now.getTime()) / 60000);
  }

  // 3. Archive personalisation (best-effort — fail silent).
  try {
    if (_w.API && typeof _w.API.spotsList === 'function') {
      const a = await _w.API.spotsList();
      const spots = (a && a.spots) || [];
      ctx.archiveSize = spots.length;
      for (const s of spots) {
        if (!s || !s.neighborhood) continue;
        ctx.visitCountByNbhd[s.neighborhood] = (ctx.visitCountByNbhd[s.neighborhood] || 0) + 1;
      }
      ctx.visitedNeighborhoods = Object.keys(ctx.visitCountByNbhd);
    }
  } catch (_) { /* unauthenticated / offline — cold-start path */ }

  return ctx;
}

/* ----------------------------------------------------------------------------
   Rule tree — deterministic, prioritised. Returns { routeId, ruleId, reason }.

   ROUTE → RULE MAPPING (see also agent_reports/v2_08_right_now.md):
     R1  rain         → soho_galleries | les_food | soho_aesthetic
     R2  near sunset  → williamsburg | wv_books | fidi_finance | dumbo_bridge
     R3  weekend AM   → soho_aesthetic | wv_books
     R4  weekday lunch→ les_food (near user's last neighborhood when possible)
     R5  late night   → ev_vintage | les_food (finish before 10 PM)
     R6  repeat-nbhd  → a route in a fresh neighborhood the user hasn't tried
     R7  cold         → highline_galleries (indoor finish) | soho_galleries
     R8  default      → soho_aesthetic
   ---------------------------------------------------------------------------- */
function pickRoute(ctx) {
  const has = (id) => !!routeById(id);
  const visited = ctx.visitCountByNbhd || {};
  const totalVisits = Object.values(visited).reduce((a, b) => a + b, 0);
  const lastNbhd = ctx.visitedNeighborhoods[ctx.visitedNeighborhoods.length - 1] || null;

  /* R1 — Rain / snow / storm / drizzle → indoor-favored. ----------------- */
  if (['rain', 'drizzle', 'snow', 'storm'].includes(ctx.condition)) {
    let pickId = 'soho_galleries';
    if (lastNbhd === 'les' && has('les_food')) pickId = 'les_food';
    else if (lastNbhd === 'soho' && has('soho_aesthetic')) pickId = 'soho_aesthetic';
    return {
      routeId: pickId,
      ruleId: 'R1_rain_indoor',
      reasonTemplate: (r) =>
        "It's {{condition_lower}} in {{nbhd}} right now — perfect cover for galleries, bookshops, and slow cafes."
    };
  }

  /* R2 — Within 30–90 min of sunset → sunset route. ------------------------ */
  if (ctx.minutesUntilSunset != null && ctx.minutesUntilSunset >= 30 && ctx.minutesUntilSunset <= 90) {
    // Rotate through sunset routes by day-of-year so the rec feels fresh.
    const sunsetRoutes = ['williamsburg', 'wv_books', 'fidi_finance', 'dumbo_bridge'].filter(has);
    const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const pickId = sunsetRoutes[doy % sunsetRoutes.length] || 'williamsburg';
    return {
      routeId: pickId,
      ruleId: 'R2_pre_sunset',
      reasonTemplate: (r) =>
        "{{nbhd}} sunsets start at {{sunset_clock}}. {{sunset_stop_why}}"
    };
  }

  /* R3 — Sunny weekend morning → aesthetic walk. ---------------------------- */
  if (ctx.isWeekend && ctx.hour >= 8 && ctx.hour < 12 &&
      (ctx.condition === 'clear' || ctx.condition === 'partly_cloudy')) {
    const pickId = (totalVisits > 0 && visited['soho'] >= 2 && has('wv_books'))
      ? 'wv_books'
      : 'soho_aesthetic';
    return {
      routeId: pickId,
      ruleId: 'R3_weekend_morning_aesthetic',
      reasonTemplate: (r) =>
        "A {{temp}} {{day_long}} morning is exactly when {{nbhd}} feels like the postcard — cobblestones, cafes, empty streets."
    };
  }

  /* R4 — Weekday lunch (11—2 PM) → short food walk. ------------------------ */
  if (!ctx.isWeekend && ctx.hour >= 11 && ctx.hour <= 14) {
    let pickId = 'les_food';
    if (lastNbhd === 'soho' && has('soho_aesthetic')) pickId = 'soho_aesthetic';
    return {
      routeId: pickId,
      ruleId: 'R4_weekday_lunch',
      reasonTemplate: (r) =>
        "It's {{time}} on a {{day_long}} — a {{minutes}} loop through {{nbhd}} fits between meetings."
    };
  }

  /* R5 — Late evening (≥ 20:00) → short route that wraps before 10 PM. ----- */
  if (ctx.hour >= 20 || ctx.hour < 2) {
    const pickId = has('les_food') ? 'les_food' : 'ev_vintage';
    return {
      routeId: pickId,
      ruleId: 'R5_late_evening_short',
      reasonTemplate: (r) =>
        "It's late — a {{minutes}} walk through {{nbhd}} ends well before midnight. Old New York at its weirdest."
    };
  }

  /* R6 — Repeat-neighborhood explorer → push them somewhere fresh. ---------- */
  if (totalVisits >= 3) {
    const tried = new Set(ctx.visitedNeighborhoods);
    const fresh = getRoutes().find((r) => !tried.has(r.nbhd));
    if (fresh) {
      return {
        routeId: fresh.id,
        ruleId: 'R6_new_neighborhood',
        reasonTemplate: (r) =>
          "You've been deep in {{visited_top}}. {{nbhd}} is the next pocket of New York worth your eyes."
      };
    }
  }

  /* R7 — Cold (< 35°F) → indoor-heavy walk. --------------------------------- */
  if (ctx.temp_f != null && ctx.temp_f < 35) {
    const pickId = has('highline_galleries') ? 'highline_galleries' : 'soho_galleries';
    return {
      routeId: pickId,
      ruleId: 'R7_cold_indoor',
      reasonTemplate: (r) =>
        "It's {{temp}} outside — this loop ducks into Chelsea Market and gallery spaces between stops."
    };
  }

  /* R8 — Default → SoHo Aesthetic. ------------------------------------------ */
  return {
    routeId: 'soho_aesthetic',
    ruleId: 'R8_default',
    reasonTemplate: (r) =>
      "Today's editor’s pick: {{nbhd}} cast-iron streets, cafes, and tucked-away galleries — the highest-completion walk we have."
  };
}

/* ----------------------------------------------------------------------------
   Reason micro-copy — fill the template with concrete details about the
   chosen route + the moment, so it reads like an editor wrote it.
   ---------------------------------------------------------------------------- */
function fillReason(template, route, ctx) {
  const nbhd = neighbourhoodName(route && route.nbhd);
  const dayLong = (typeof Intl !== 'undefined')
    ? new Date().toLocaleDateString('en-US', { weekday: 'long' })
    : ctx.day;
  // Find a stop whose `why` mentions sunset / view, for R2.
  const sunsetStop = (route && Array.isArray(route.stops))
    ? route.stops.find((s) => (s.why || '').toLowerCase().match(/sunset|skyline|view|hudson|manhattan/))
    : null;
  const visitedTop = (() => {
    const entries = Object.entries(ctx.visitCountByNbhd || {}).sort((a, b) => b[1] - a[1]);
    return entries[0] ? neighbourhoodName(entries[0][0]) : 'one neighborhood';
  })();

  const replacements = {
    nbhd,
    temp: ctx.temp_f + '°F',
    time: ctx.time,
    day: ctx.day,
    day_long: dayLong,
    condition_lower: (conditionLabel(ctx.condition) || 'cloudy').toLowerCase(),
    sunset_clock: fmtClock(ctx.sunset),
    sunrise_clock: fmtClock(ctx.sunrise),
    minutes: route && route.minutes ? (route.minutes + ' min') : 'short',
    sunset_stop_why: sunsetStop
      ? (sunsetStop.name + ' has the best skyline angle on the loop.')
      : 'The walk ends at the water for golden hour.',
    visited_top: visitedTop
  };

  const raw = (typeof template === 'function') ? template(route) : String(template || '');
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, key) => (key in replacements ? replacements[key] : ''));
}

/* ----------------------------------------------------------------------------
   Headline copywriter — <= 2 lines, hook-y, specific.
   ---------------------------------------------------------------------------- */
function makeHeadline(rule, route, ctx) {
  const nbhd = neighbourhoodName(route && route.nbhd);
  switch (rule.ruleId) {
    case 'R1_rain_indoor':
      return 'The rain is your excuse to slow down in ' + nbhd + '.';
    case 'R2_pre_sunset':
      return nbhd + ' sunsets start at ' + fmtClock(ctx.sunset) + '.';
    case 'R3_weekend_morning_aesthetic':
      return 'A quiet ' + nbhd + ' morning is the New York people post about.';
    case 'R4_weekday_lunch':
      return 'A 60-minute reset through ' + nbhd + ', between meetings.';
    case 'R5_late_evening_short':
      return 'Late-night ' + nbhd + ' — still warm, still weird.';
    case 'R6_new_neighborhood':
      return "You haven't walked " + nbhd + ' yet. Tonight you should.';
    case 'R7_cold_indoor':
      return 'Too cold to wander cold. ' + nbhd + ', mostly indoors.';
    case 'R8_default':
    default:
      return "Today's walk: " + (route ? route.title : nbhd) + '.';
  }
}

/* ----------------------------------------------------------------------------
   Photo backdrop — prefer v2-data/photos.json route hero, fall back to the
   coverArt gradient already used elsewhere in the app.
   ---------------------------------------------------------------------------- */
let _photoCache = null;
async function loadPhotos() {
  if (_photoCache) return _photoCache;
  try {
    const r = await fetch('./v2-data/photos.json', { credentials: 'omit' });
    if (r.ok) {
      _photoCache = await r.json();
      return _photoCache;
    }
  } catch (_) { /* fall through */ }
  _photoCache = {};
  return _photoCache;
}

function photoFor(routeId, photos) {
  if (!photos) return null;
  // Support both { routeId: 'url' } and { routeId: { hero: 'url' } } shapes.
  const entry = photos[routeId];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.hero || entry.url || null;
}

function gradientFor(route) {
  // Use the same NEIGHBORHOODS gradient that the rest of the app uses.
  const list = Array.isArray(_w.NEIGHBORHOODS) ? _w.NEIGHBORHOODS : [];
  const n = list.find((x) => x.id === (route && route.nbhd));
  if (n && n.grad) return n.grad;
  return 'linear-gradient(135deg, #1F3864 0%, #162B4A 100%)';
}

/* ----------------------------------------------------------------------------
   HTML render
   ---------------------------------------------------------------------------- */
function renderHtml(pick, ctx) {
  const route = pick.route;
  const photoUrl = pick.photoUrl;
  const photoStyle = photoUrl
    ? ('background-image: url(\'' + esc(photoUrl) + '\');')
    : ('background-image: ' + gradientFor(route) + ';');

  return (
    '<section class="right-now-card" id="rightNowCard" ' +
      'aria-labelledby="rightNowTitle" aria-live="polite" aria-atomic="true" ' +
      'data-state="ready" data-rule-id="' + esc(pick.ruleId) + '" ' +
      'data-route-id="' + esc(route.id) + '">' +
      '<a class="right-now-card__skiplink" href="#allList">Skip to all routes</a>' +
      '<div class="right-now-card__bg" aria-hidden="true">' +
        '<div class="right-now-card__photo" style="' + photoStyle + '"></div>' +
        '<div class="right-now-card__scrim"></div>' +
      '</div>' +
      '<div class="right-now-card__content">' +
        '<div class="right-now-card__strip">' +
          '<span class="right-now-card__label">Right Now</span>' +
          '<span class="right-now-card__dot" aria-hidden="true">·</span>' +
          '<span class="right-now-card__when">' + esc(ctx.day + ' ' + ctx.time) + '</span>' +
          '<span class="right-now-card__dot" aria-hidden="true">·</span>' +
          '<span class="right-now-card__temp">' + esc(ctx.temp_f + '°F') + '</span>' +
          '<span class="right-now-card__dot" aria-hidden="true">·</span>' +
          '<span class="right-now-card__condition">' + esc(conditionLabel(ctx.condition)) + '</span>' +
        '</div>' +
        '<h2 class="right-now-card__headline" id="rightNowTitle">' +
          esc(pick.headline) +
        '</h2>' +
        '<p class="right-now-card__reason">' + esc(pick.reason) + '</p>' +
        '<button type="button" class="right-now-card__cta" data-motion="btn" ' +
          'data-action="start" data-route-id="' + esc(route.id) + '" ' +
          'aria-describedby="rightNowTitle">' +
          '<span class="right-now-card__cta-label">Walk ' + esc(route.title) + '</span>' +
          '<svg class="right-now-card__cta-arrow" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            '<line x1="5" y1="12" x2="19" y2="12"/>' +
            '<polyline points="12 5 19 12 12 19"/>' +
          '</svg>' +
        '</button>' +
        '<a class="right-now-card__secondary" href="#allList" data-action="browse">' +
          '<span>Or pick from the 11 other routes</span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            '<polyline points="6 9 12 15 18 9"/>' +
          '</svg>' +
        '</a>' +
      '</div>' +
    '</section>'
  );
}

/* ----------------------------------------------------------------------------
   Public API
   ---------------------------------------------------------------------------- */
let _lastPick = null;

async function _composePick() {
  const ctx = await gatherContext();
  const rule = pickRoute(ctx);
  const route = routeById(rule.routeId) || getRoutes()[0] || null;
  const photos = await loadPhotos();
  const photoUrl = photoFor(rule.routeId, photos);
  const reason = fillReason(rule.reasonTemplate, route, ctx);
  const headline = makeHeadline(rule, route, ctx);
  const pick = { route, ruleId: rule.ruleId, reason, headline, photoUrl, ctx };
  _lastPick = pick;
  return pick;
}

function _attachHandlers(container, pick) {
  if (!container) return;
  const btn = container.querySelector('[data-action="start"]');
  if (btn) {
    btn.addEventListener('click', () => {
      try {
        if (_w.State && pick.route) _w.State.currentRoute = pick.route;
        track('right_now_started', {
          route_id: pick.route && pick.route.id,
          rule_id: pick.ruleId
        });
        if (_w.Nav && typeof _w.Nav.go === 'function') _w.Nav.go('detail');
      } catch (_) { /* no-op */ }
    });
  }
  const browse = container.querySelector('[data-action="browse"]');
  if (browse) {
    browse.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById('allList');
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      track('right_now_browsed', { from_rule: pick.ruleId });
    });
  }
}

export const RightNow = {
  async render(container) {
    const host = (typeof container === 'string') ? document.querySelector(container) : container;
    if (!host) return null;
    host.innerHTML =
      '<section class="right-now-card" data-state="loading" aria-live="polite">' +
      '<div class="right-now-card__bg" aria-hidden="true">' +
        '<div class="right-now-card__photo"></div>' +
        '<div class="right-now-card__scrim"></div>' +
      '</div>' +
      '<div class="right-now-card__content">' +
        '<div class="right-now-card__strip">' +
          '<span class="right-now-card__label">Right Now</span>' +
        '</div>' +
        '<h2 class="right-now-card__headline" id="rightNowTitle">Finding your walk for right now…</h2>' +
      '</div>' +
      '</section>';

    try {
      const pick = await _composePick();
      if (!pick.route) {
        host.innerHTML = '';
        return null;
      }
      host.innerHTML = renderHtml(pick, pick.ctx);
      _attachHandlers(host, pick);
      track('right_now_shown', {
        route_id: pick.route.id,
        rule_id: pick.ruleId,
        condition: pick.ctx.condition,
        temp_f: pick.ctx.temp_f,
        minutes_until_sunset: pick.ctx.minutesUntilSunset
      });
      return pick;
    } catch (e) {
      host.innerHTML = '';
      return null;
    }
  },

  async pick() {
    return _composePick();
  },

  async refresh(container) {
    return this.render(container || document.getElementById('rightNowSlot'));
  },

  /* Exposed for tests / debugging — deterministic rule eval against any ctx. */
  _pickRoute: pickRoute,
  _wmoToCondition: wmoToCondition,
  _solarTimes: solarTimes,
  _gatherContext: gatherContext
};

// Window-global fallback so inline non-module code in index.html can call it.
if (typeof window !== 'undefined') {
  window.RightNow = RightNow;
}

export default RightNow;
