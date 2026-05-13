/* ============================================================================
   Walking Explorers v2 — Around Me screen (live-location discovery)
   Owned by: around-me agent (v0.7.02)

   THE PROBLEM (user quote):
     "There is no way to see, like, an option of what's around you. So the GPS
      can appear, like, in real time where you are so you can see all around
      you what is over there."

   THIS MODULE'S JOB:
     A standalone full-screen Leaflet map view that shows the user's live
     location, every curated stop from the 12 routes, every active promotion,
     and a 20-minute-walk reachable ring — BEFORE the user commits to a
     specific route. Tap a stop for a peek card; expand the bottom sheet for
     the 10 nearest stops or 5 nearest routes by centroid distance.

   PUBLIC API (frozen — used by the integrator):
     AroundMe.mount(containerEl[, opts])  — mount the screen
     AroundMe.destroy()                   — full cleanup
     AroundMe.recenter()                  — programmatic re-center on user
     AroundMe.flyToStop(stopId)           — programmatic zoom-in

   HOST CONTRACT (all optional — module degrades gracefully):
     window.ROUTES          — used in preference to the inlined fallback
     window.PROMOTIONS      — used in preference to the inlined fallback
     window.State           — for setting State.currentRoute on "Open route"
     window.Nav.go('detail')— for navigating after route-open
     window.Telemetry.track — for analytics events
     window.esc             — HTML-escape helper (we have our own fallback)

   STANDALONE: open beta/app/v2-screens/around-me.html directly and the
   module mounts itself with the inlined data — full UI works end-to-end.

   No dependencies beyond Leaflet 1.9.4 (loaded globally as `L`).
   ========================================================================= */

/* ----------------------------------------------------------------------------
   0. Defensive globals + small utility helpers
   ---------------------------------------------------------------------------- */
const _w = (typeof window !== 'undefined') ? window : {};

function esc(s) {
  if (typeof _w.esc === 'function') return _w.esc(s);
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function track(event, props) {
  try {
    if (_w.Telemetry && typeof _w.Telemetry.track === 'function') {
      _w.Telemetry.track(event, props || {});
    }
  } catch (_) { /* swallow */ }
}

/* Haversine — meters between two {lat,lon}. */
const R_EARTH_M = 6371000;
function distMeters(a, b) {
  if (!a || !b) return Infinity;
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLon = (b.lon - a.lon) * toR;
  const lat1 = a.lat * toR;
  const lat2 = b.lat * toR;
  const x = Math.sin(dLat / 2) ** 2 +
            Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(x));
}

function formatDistance(m) {
  if (m == null || !isFinite(m)) return '—';
  const mi = m / 1609.344;
  if (mi < 0.1) return Math.round(m / 0.3048) + ' ft away';
  if (mi < 10)  return mi.toFixed(1) + ' mi away';
  return Math.round(mi) + ' mi away';
}

function walkingMinutes(m) {
  // 80 m/min is brisk-but-realistic NYC walking pace.
  return Math.max(1, Math.round(m / 80));
}

function centroid(points) {
  if (!points || !points.length) return null;
  let lat = 0, lon = 0;
  for (const p of points) { lat += p.lat; lon += p.lon; }
  return { lat: lat / points.length, lon: lon / points.length };
}

/* Stable id for a stop (routeId + slug of stop name). */
function stopId(routeId, stopName) {
  const slug = String(stopName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return routeId + '__' + slug;
}

/* Match a stop in photos.json by index OR by fuzzy name (since the JSON's
   `name` strings are sometimes slightly different from the ROUTES `name`). */
function findPhotoForStop(photosJson, routeId, stopIndex, stopName) {
  if (!photosJson || !photosJson.routes) return null;
  const r = photosJson.routes[routeId];
  if (!r || !Array.isArray(r.stops)) return null;
  // Try by index first — both arrays are 6-stops parallel in the dataset.
  if (typeof stopIndex === 'number' && r.stops[stopIndex] && r.stops[stopIndex].url) {
    return r.stops[stopIndex].url;
  }
  // Fallback: case-insensitive substring match on name.
  const needle = String(stopName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!needle) return null;
  for (const s of r.stops) {
    const hay = String(s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (hay && (hay.includes(needle) || needle.includes(hay))) return s.url;
  }
  return null;
}

function findHeroForRoute(photosJson, routeId) {
  if (!photosJson || !photosJson.routes) return null;
  const r = photosJson.routes[routeId];
  return (r && r.hero && r.hero.url) || null;
}

/* ----------------------------------------------------------------------------
   1. Inlined data fallback — used only when window.ROUTES / window.PROMOTIONS
      aren't provided. Mirrors lib/data.js + v2-scripts/app-shell.js exactly
      as of v0.7.02. Keep in sync if the canonical data ever changes.
   ---------------------------------------------------------------------------- */
const FALLBACK_ROUTES = [
  { id:'soho_aesthetic', title:"SoHo Aesthetic Café Crawl", nbhd:'soho', minutes:90, miles:1.7,
    desc:"A photo-perfect loop through SoHo's cast-iron streets — cafés, vintage stores, and tucked-away galleries.",
    stops:[
      { name:'Joe Coffee — Crosby St', lat:40.7224, lon:-73.9966, why:"Quietest of NYC's prettiest café spots." },
      { name:'McNally Jackson Books',   lat:40.7232, lon:-73.9979, why:'Independent bookshop that fits your aesthetic.' },
      { name:'Lure Fishbar',            lat:40.7240, lon:-73.9975, sponsored:true, why:'Stylish underground fish house.' },
      { name:'INA SoHo',                lat:40.7244, lon:-73.9989, why:'Carries Prada / Chanel resale.' },
      { name:'Donut Plant',             lat:40.7200, lon:-73.9943, why:'Mid-walk sweet break.' },
      { name:'Mercer Street vista',     lat:40.7253, lon:-73.9985, why:'Cobblestones + cast-iron + golden hour.' }
    ]},
  { id:'ev_vintage', title:'East Village Vintage & Vinyl', nbhd:'ev', minutes:110, miles:2.0,
    desc:'Old New York at its weirdest — record stores, leather, downtown cafés.',
    stops:[
      { name:'Veselka',               lat:40.7286, lon:-73.9891, why:'24-hour Ukrainian diner.' },
      { name:'Astor Place neon',      lat:40.7297, lon:-73.9911, why:'Photogenic neon.' },
      { name:'Other Music vinyl',     lat:40.7281, lon:-73.9912, why:'Vinyl, listening booths.' },
      { name:'Tompkins Square Park',  lat:40.7264, lon:-73.9818, why:'Heart of EV culture.' },
      { name:"L'imprimerie",          lat:40.7236, lon:-73.9847, sponsored:true, why:'French bakery — croissants at 4pm.' },
      { name:'Russ & Daughters Café', lat:40.7222, lon:-73.9894, why:'Closes the walk on classic LES.' }
    ]},
  { id:'wv_books', title:'West Village Bookshops & Brownstones', nbhd:'westvillage', minutes:75, miles:1.4,
    desc:'Bookshops most visitors miss.',
    stops:[
      { name:'Three Lives & Company', lat:40.7345, lon:-74.0019, why:'Bookshop you bookmarked.' },
      { name:'Bleecker Street walk',  lat:40.7340, lon:-74.0035, why:'Brownstone density peak.' },
      { name:'Caffè Reggio',          lat:40.7301, lon:-73.9998, why:"Greenwich Village's first cappuccino." },
      { name:'Strand Annex',          lat:40.7332, lon:-74.0003, why:'Strand needs no introduction.' },
      { name:'Magnolia Bakery',       lat:40.7351, lon:-74.0061, sponsored:true, why:'Banana pudding is the move.' },
      { name:'Hudson River sunset',   lat:40.7363, lon:-74.0094, why:'Best Manhattan-side sunset.' }
    ]},
  { id:'highline_galleries', title:'High Line + Chelsea Galleries', nbhd:'chelsea', minutes:130, miles:2.4,
    desc:'Walk the elevated park, drop down for galleries, end at Little Island.',
    stops:[
      { name:'High Line — Gansevoort', lat:40.7396, lon:-74.0087, why:'Best entrance.' },
      { name:'Whitney Museum patio',   lat:40.7396, lon:-74.0089, why:'Free outdoor sculpture terraces.' },
      { name:'Pace Gallery',           lat:40.7474, lon:-74.0064, why:"Pace's 540 W 25th flagship is free." },
      { name:'Cookshop',               lat:40.7457, lon:-74.0064, sponsored:true, why:'Killer brunch.' },
      { name:'Little Island',          lat:40.7430, lon:-74.0125, why:"Heatherwick's tulip-pier park." },
      { name:'Chelsea Market',         lat:40.7424, lon:-74.0061, why:'Indoor finish — food, vendors.' }
    ]},
  { id:'williamsburg', title:'Williamsburg Street Art Walk', nbhd:'williamsburg', minutes:100, miles:1.9,
    desc:"Brooklyn's mural belt + cafés and vinyl shops.",
    stops:[
      { name:'Bedford Ave subway',     lat:40.7170, lon:-73.9569, why:'Best people-watching.' },
      { name:'Devoción',               lat:40.7128, lon:-73.9579, why:'Most-photographed plant wall.' },
      { name:'Bushwick Inlet murals',  lat:40.7232, lon:-73.9620, why:'Rotating large-format murals.' },
      { name:'Rough Trade NYC',        lat:40.7176, lon:-73.9612, why:'Vinyl, listening booths.' },
      { name:'Five Leaves',            lat:40.7234, lon:-73.9540, sponsored:true, why:"Brunch — Heath Ledger's old spot." },
      { name:'Domino Park sunset',     lat:40.7141, lon:-73.9686, why:'Wide-frame Manhattan skyline.' }
    ]},
  { id:'dumbo_bridge', title:'DUMBO + Brooklyn Bridge Loop', nbhd:'dumbo', minutes:90, miles:1.8,
    desc:'Cross the bridge, descend into DUMBO, end at the framed-bridge view.',
    stops:[
      { name:'Brooklyn Bridge',        lat:40.7058, lon:-73.9966, why:'Walk pedestrian path.' },
      { name:'Empire Stores',          lat:40.7038, lon:-73.9881, why:'Renovated 1870s warehouse.' },
      { name:'Time Out Market',        lat:40.7036, lon:-73.9888, why:'Curated Brooklyn-best food.' },
      { name:'Washington Street view', lat:40.7035, lon:-73.9897, why:'Most-photographed framed-bridge.' },
      { name:"Jane's Carousel",        lat:40.7037, lon:-73.9926, sponsored:true, why:'1922 carousel — $2 to ride.' },
      { name:'Pebble Beach',           lat:40.7026, lon:-73.9926, why:'Water-level Manhattan view.' }
    ]},
  { id:'central_park', title:'Central Park Hidden Corners', nbhd:'centralpark', minutes:120, miles:2.3,
    desc:'Skip the tourist track. Secret gardens, the rambles.',
    stops:[
      { name:'Conservatory Garden', lat:40.7950, lon:-73.9521, why:"Park's only formal garden." },
      { name:'The Pool',            lat:40.7948, lon:-73.9598, why:'Quietest body of water.' },
      { name:'Belvedere Castle',    lat:40.7794, lon:-73.9692, why:'Best aerial view.' },
      { name:'Shakespeare Garden',  lat:40.7802, lon:-73.9701, why:'Plants only mentioned in Shakespeare.' },
      { name:'Loeb Boathouse',      lat:40.7754, lon:-73.9692, sponsored:true, why:'Boat for $20.' },
      { name:'Strawberry Fields',   lat:40.7757, lon:-73.9745, why:"Lennon's spot." }
    ]},
  { id:'les_food', title:'Lower East Side Foodie Crawl', nbhd:'les', minutes:110, miles:1.6,
    desc:'Old-immigrant New York meets new-immigrant New York.',
    stops:[
      { name:'Pickle Guys',           lat:40.7156, lon:-73.9923, why:'Last remaining pickle vendor.' },
      { name:'Russ & Daughters Café', lat:40.7222, lon:-73.9894, why:'Bagel + lox pilgrimage.' },
      { name:'Tenement Museum',       lat:40.7188, lon:-73.9904, why:'Preserved 1880s tenement.' },
      { name:"Joe's Shanghai",        lat:40.7169, lon:-73.9952, sponsored:true, why:'Soup dumplings.' },
      { name:'Economy Candy',         lat:40.7180, lon:-73.9892, why:'Vintage candy store.' },
      { name:'Attaboy',               lat:40.7178, lon:-73.9915, why:'Hidden bar, no menu.' }
    ]},
  { id:'soho_galleries', title:'SoHo Hidden Galleries', nbhd:'soho', minutes:100, miles:1.5,
    desc:'Galleries, lofts, streets that defined American art.',
    stops:[
      { name:'Drawing Center',           lat:40.7220, lon:-74.0008, why:'Free; only nonprofit for drawing.' },
      { name:'Donald Judd Foundation',   lat:40.7256, lon:-73.9981, why:'His preserved studio loft.' },
      { name:'The Earth Room',           lat:40.7240, lon:-73.9994, sponsored:true, why:'250 cu yd of dirt.' },
      { name:'Broken Kilometer',         lat:40.7251, lon:-74.0023, why:'Another De Maria piece.' },
      { name:'Housing Works Bookstore',  lat:40.7232, lon:-74.0012, why:'Charity shop + literary events.' },
      { name:'Greene Street cobblestones', lat:40.7240, lon:-74.0003, why:'Most-photographed block.' }
    ]},
  { id:'uws_classic', title:'Upper West Side Classic NY', nbhd:'centralpark', minutes:110, miles:2.0,
    desc:"Lincoln Center to Zabar's — UWS culture.",
    stops:[
      { name:'Lincoln Center plaza', lat:40.7727, lon:-73.9837, why:'Iconic NYC arts plaza.' },
      { name:'Westsider Books',      lat:40.7891, lon:-73.9742, why:'Three floors of stacks.' },
      { name:"Zabar's",              lat:40.7886, lon:-73.9788, why:'Only UWS institution that matters.' },
      { name:'Cafe Lalo',            lat:40.7837, lon:-73.9777, sponsored:true, why:"You've Got Mail set." },
      { name:'AMNH plaza',           lat:40.7813, lon:-73.9740, why:'Architecture lesson.' },
      { name:'Riverside Park overlook', lat:40.7872, lon:-73.9817, why:'Hudson sunset.' }
    ]},
  { id:'harlem_history', title:'Harlem Renaissance Walk', nbhd:'centralpark', minutes:120, miles:2.2,
    desc:'The neighborhood that invented modern American culture.',
    stops:[
      { name:'Studio Museum in Harlem', lat:40.8085, lon:-73.9466, why:'Premier museum.' },
      { name:'Apollo Theater',          lat:40.8104, lon:-73.9504, why:'Music history.' },
      { name:"Sylvia's",                lat:40.8086, lon:-73.9402, sponsored:true, why:'Since 1962.' },
      { name:"Strivers' Row",           lat:40.8169, lon:-73.9437, why:'Most photogenic brownstone block.' },
      { name:'Schomburg Center',        lat:40.8141, lon:-73.9402, why:'Research library, gorgeous interior.' },
      { name:'Marcus Garvey Park',      lat:40.8045, lon:-73.9438, why:'Bell tower for skyline views.' }
    ]},
  { id:'fidi_finance', title:'Financial District Old Manhattan', nbhd:'dumbo', minutes:90, miles:1.7,
    desc:'Original Manhattan — narrow streets, Dutch grid.',
    stops:[
      { name:'Stone Street',                lat:40.7038, lon:-74.0117, why:'Cobblestone outdoor dining.' },
      { name:'Trinity Church',              lat:40.7081, lon:-74.0119, why:'Hamilton, Burr.' },
      { name:'Charging Bull / Fearless Girl', lat:40.7055, lon:-74.0134, why:'Most-photographed sculptures.' },
      { name:'Fraunces Tavern',             lat:40.7034, lon:-74.0117, sponsored:true, why:"Washington's farewell." },
      { name:'9/11 Memorial pools',         lat:40.7115, lon:-74.0134, why:'Treat with care.' },
      { name:'Battery Park sunset',         lat:40.7032, lon:-74.0170, why:'Statue of Liberty + harbor.' }
    ]}
];

const FALLBACK_PROMOTIONS = [
  { id:'p1', business:'Joe Coffee — Crosby St',  offer:'15% off latte before 6 PM',          expires:'Today, 6 PM',     nbhd:'soho',         lat:40.7224, lon:-73.9966, sponsored:true  },
  { id:'p2', business:'Devoción',                offer:'Free pour-over with any pastry, 2-4 PM', expires:'Today, 4 PM', nbhd:'williamsburg', lat:40.7128, lon:-73.9579, sponsored:true  },
  { id:'p3', business:'Five Leaves',             offer:'$12 brunch ricotta pancakes',         expires:'This weekend',    nbhd:'williamsburg', lat:40.7234, lon:-73.9540, sponsored:true  },
  { id:'p4', business:'Donut Plant',             offer:'Buy 3, get 1 free',                   expires:'All week',        nbhd:'soho',         lat:40.7200, lon:-73.9943, sponsored:false },
  { id:'p5', business:'INA SoHo (vintage)',      offer:'20% off Prada resale this weekend',   expires:'Sunday',          nbhd:'soho',         lat:40.7244, lon:-73.9989, sponsored:true  },
  { id:'p6', business:'McNally Jackson Books',   offer:'Free coffee w/ any book Tues–Thurs',  expires:'Ongoing',         nbhd:'soho',         lat:40.7232, lon:-73.9979, sponsored:false },
  { id:'p7', business:'Three Lives & Co.',       offer:'$5 off staff-pick books',             expires:'This month',      nbhd:'westvillage',  lat:40.7345, lon:-74.0019, sponsored:false },
  { id:'p8', business:'Russ & Daughters Café',   offer:'Half-off bagels & lox before 9 AM',   expires:'Weekdays, 9 AM',  nbhd:'les',          lat:40.7222, lon:-73.9894, sponsored:true  }
];

function getRoutes()     { return Array.isArray(_w.ROUTES)     ? _w.ROUTES     : FALLBACK_ROUTES; }
function getPromotions() { return Array.isArray(_w.PROMOTIONS) ? _w.PROMOTIONS : FALLBACK_PROMOTIONS; }

/* ----------------------------------------------------------------------------
   2. Photo cache (photos.json) — fetched once, never re-fetched.
   ---------------------------------------------------------------------------- */
let _photosCache = null;

async function loadPhotos() {
  if (_photosCache) return _photosCache;
  // Resolve relative to this module — works both standalone (./v2-data) and
  // when mounted by app-shell (/beta/app/v2-data).
  const candidates = [
    '../v2-data/photos.json',           // standalone (this file is in v2-screens)
    '/beta/app/v2-data/photos.json',    // mounted in app shell
    './v2-data/photos.json'             // hand-served from app root
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (r.ok) {
        _photosCache = await r.json();
        return _photosCache;
      }
    } catch (_) { /* try next */ }
  }
  _photosCache = { routes: {} };
  return _photosCache;
}

/* ----------------------------------------------------------------------------
   3. Cluster helper — simple distance-bucket clustering by zoom.
      No external deps. Good enough for ~72 stops over Manhattan + Brooklyn.

      Strategy: walk every stop, greedy-merge any within Nmeters of an
      existing cluster head at the current zoom. Tuning:
        zoom < 13 → bucket size 600m
        zoom = 13 → 300m
        zoom = 14 → 150m
        zoom >= 15 → no clustering (all stops shown individually)
   ---------------------------------------------------------------------------- */
function bucketSizeForZoom(z) {
  if (z >= 15) return 0;
  if (z === 14) return 150;
  if (z === 13) return 300;
  return 600;
}

function clusterStops(stops, zoom) {
  const bucket = bucketSizeForZoom(zoom);
  if (bucket === 0) return stops.map(s => ({ kind: 'single', stops: [s], lat: s.lat, lon: s.lon }));
  const clusters = [];
  for (const s of stops) {
    let merged = false;
    for (const c of clusters) {
      if (distMeters({ lat: c.lat, lon: c.lon }, { lat: s.lat, lon: s.lon }) < bucket) {
        c.stops.push(s);
        // Recompute centroid for the cluster head.
        const cen = centroid(c.stops);
        c.lat = cen.lat; c.lon = cen.lon;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ kind: 'single', stops: [s], lat: s.lat, lon: s.lon });
  }
  // Re-label single vs cluster.
  return clusters.map(c => ({
    kind: c.stops.length > 1 ? 'cluster' : 'single',
    stops: c.stops, lat: c.lat, lon: c.lon
  }));
}

/* ----------------------------------------------------------------------------
   4. Skyline SVG — used only for the GPS-denied empty state.
      Inline so we don't ship a separate asset. Suggests NYC silhouette.
   ---------------------------------------------------------------------------- */
const SKYLINE_SVG = `
<svg viewBox="0 0 800 280" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="amSkyFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#0E1B30" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0E1B30" stop-opacity="0.65"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="800" height="280" fill="url(#amSkyFade)"/>
  <!-- Skyline silhouette: rough Manhattan profile -->
  <path d="M0,280 L0,210 L30,210 L30,190 L55,190 L55,170 L85,170 L85,200
           L110,200 L110,150 L140,150 L140,180 L170,180 L170,140 L200,140
           L200,170 L230,170 L230,120 L260,120 L260,160 L290,160 L290,90
           L320,90 L320,140 L355,140 L355,110 L385,110 L385,70 L415,70
           L415,130 L450,130 L450,100 L480,100 L480,140 L510,140 L510,160
           L545,160 L545,120 L580,120 L580,150 L615,150 L615,190 L645,190
           L645,170 L675,170 L675,200 L705,200 L705,180 L735,180 L735,210
           L770,210 L770,200 L800,200 L800,280 Z"
        fill="#FAF7F2" opacity="0.85"/>
  <!-- Tiny lit windows -->
  <g fill="#E0B341" opacity="0.7">
    <rect x="120" y="160" width="3" height="3"/>
    <rect x="120" y="170" width="3" height="3"/>
    <rect x="200" y="150" width="3" height="3"/>
    <rect x="295" y="100" width="3" height="3"/>
    <rect x="305" y="115" width="3" height="3"/>
    <rect x="390" y="80"  width="3" height="3"/>
    <rect x="455" y="115" width="3" height="3"/>
    <rect x="555" y="135" width="3" height="3"/>
    <rect x="650" y="180" width="3" height="3"/>
  </g>
</svg>`;

/* ----------------------------------------------------------------------------
   5. Markup builder — produces the static shell of the screen.
      All interactive surfaces have data-attribute hooks documented in
      around-me.html under "DOM CONTRACT".
   ---------------------------------------------------------------------------- */
function renderShell() {
  return (
    '<div class="am-root am-mounted" data-screen="around-me">' +

      // The map node.
      '<div class="am-map" id="aroundMeMap" aria-label="Map of stops and offers near you" role="application"></div>' +

      // Top overlay chips.
      '<div class="am-overlay--top">' +
        '<button type="button" class="am-chip" data-action="toggle-offers" aria-pressed="false" aria-label="Show offers nearby on the map">' +
          '<span class="am-chip__icon" aria-hidden="true">🎁</span>' +
          '<span>Offers nearby</span>' +
        '</button>' +
        '<button type="button" class="am-chip am-chip--recenter" data-action="recenter" aria-label="Re-center map on your location" title="Re-center">' +
          '<span aria-hidden="true">⊕</span>' +
        '</button>' +
      '</div>' +

      // Live-status pill (center, top).
      '<div class="am-status" data-status role="status" aria-live="polite" data-state="locating">' +
        '<span class="am-status__dot" aria-hidden="true"></span>' +
        '<span data-status-label>Locating you…</span>' +
      '</div>' +

      // Peek card (hidden until a stop is tapped).
      '<div class="am-overlay--peek" data-peek data-open="false" aria-hidden="true">' +
        '<button type="button" class="am-peek__close" data-action="close-peek" aria-label="Close stop preview">×</button>' +
        '<div class="am-peek__photo" data-peek-photo></div>' +
        '<div class="am-peek__body">' +
          '<div class="am-peek__meta" data-peek-meta>Stop</div>' +
          '<h3 class="am-peek__title" data-peek-title>—</h3>' +
          '<div class="am-peek__route" data-peek-route>Part of —</div>' +
          '<div class="am-peek__distance" data-peek-distance>—</div>' +
          '<div class="am-peek__actions">' +
            '<button type="button" class="am-btn am-btn--accent" data-action="add-to-walk">Add to a quick walk</button>' +
            '<button type="button" class="am-btn am-btn--secondary" data-action="open-route">Open route</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Bottom sheet (Nearby stops / Nearby routes).
      '<div class="am-sheet" data-sheet data-open="false" aria-label="Nearby stops and routes">' +
        '<div class="am-sheet__handle" aria-hidden="true" data-action="toggle-sheet" tabindex="0" role="button"></div>' +
        '<div class="am-sheet__tabs" role="tablist" aria-label="Nearby content">' +
          '<button type="button" class="am-tab" role="tab" aria-selected="true"  data-tab="stops"  id="amTabStops">Nearby stops</button>' +
          '<button type="button" class="am-tab" role="tab" aria-selected="false" data-tab="routes" id="amTabRoutes">Nearby routes</button>' +
        '</div>' +
        '<div class="am-sheet__body" data-panel-host>' +
          '<div role="tabpanel" data-panel="stops"  aria-labelledby="amTabStops">' +
            '<div class="am-sheet__empty">Locating you…</div>' +
          '</div>' +
          '<div role="tabpanel" data-panel="routes" aria-labelledby="amTabRoutes" hidden>' +
            '<div class="am-sheet__empty">Locating you…</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Loading skeleton (visible until first GPS fix or fallback).
      '<div class="am-loading" data-loading>' +
        '<div class="am-skeleton" aria-hidden="true"></div>' +
        '<div class="am-loading__caption">Locating you… <span>high-accuracy GPS</span></div>' +
      '</div>' +

      // Empty state — GPS denied. Hidden by default.
      '<div class="am-empty" data-empty hidden>' +
        '<div class="am-empty__skyline" aria-hidden="true">' + SKYLINE_SVG + '</div>' +
        '<h2 class="am-empty__title">Turn on location to see what\'s around you.</h2>' +
        '<p class="am-empty__body">We use your live location only to show stops and offers nearby. We never store it.</p>' +
        '<div class="am-empty__actions">' +
          '<button type="button" class="am-btn am-btn--primary" data-action="request-permission">Enable location</button>' +
          '<button type="button" class="am-btn am-btn--secondary" data-action="fallback-soho">Skip — show me Manhattan</button>' +
        '</div>' +
      '</div>' +

    '</div>'
  );
}

/* ----------------------------------------------------------------------------
   6. The AroundMe screen — encapsulated as a class so multiple instances
      could in theory coexist; in practice the integrator mounts ONE.
   ---------------------------------------------------------------------------- */
class AroundMeScreen {

  constructor(container, opts) {
    this.container = container;
    this.opts = Object.assign({
      fallbackCenter: { lat: 40.7235, lon: -73.998 },  // SoHo center per spec
      initialZoom: 14,
      reachableMeters: 1500,                            // ~20-min walk
      maxNearbyStops: 10,
      maxNearbyRoutes: 5
    }, opts || {});

    /* State. */
    this.map = null;
    this.tileLayer = null;
    this.userMarker = null;
    this.userPos = null;        // {lat, lon} or null
    this.lastFix = null;        // timestamp
    this.watchId = null;
    this.stops = [];            // flat array: {routeId, idx, ...stop}
    this.routes = [];
    this.promotions = [];
    this.photos = null;
    this.showOffers = false;
    this.stopMarkers = [];      // {marker, stop}
    this.promoMarkers = [];
    this.clusterMarkers = [];
    this.walkRing = null;
    this.activeTab = 'stops';
    this.selectedStop = null;
    this.destroyed = false;
    this._zoomHandler = null;
    this._moveHandler = null;
    this._domHandlers = [];     // {el, type, fn} for clean removeEventListener
  }

  // -------- public lifecycle -------------------------------------------------

  async mount() {
    if (this.destroyed) return;
    this.container.innerHTML = renderShell();
    this._cacheDom();
    this._wireDom();

    // Load routes/promotions/photos in parallel.
    this.routes = getRoutes();
    this.promotions = getPromotions();
    // Flatten all stops with route reference.
    this.stops = [];
    for (const r of this.routes) {
      if (!Array.isArray(r.stops)) continue;
      r.stops.forEach((s, idx) => {
        if (typeof s.lat === 'number' && typeof s.lon === 'number') {
          this.stops.push(Object.assign({}, s, {
            routeId: r.id,
            routeTitle: r.title,
            routeMinutes: r.minutes,
            stopIdx: idx,
            id: stopId(r.id, s.name)
          }));
        }
      });
    }

    this.photos = await loadPhotos();

    // Boot Leaflet map. Center at the fallback (SoHo) until GPS resolves —
    // this lets the user see SOMETHING immediately instead of grey.
    this._initMap(this.opts.fallbackCenter, this.opts.initialZoom);
    this._renderStopMarkers();   // initial render — clustered at zoom 14
    this._renderInitialLists();  // populate sheet using fallback center

    // Kick off geolocation.
    this._startGeolocation();

    track('around_me_mounted', {
      stops: this.stops.length,
      promotions: this.promotions.length
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    // Stop watching GPS.
    if (this.watchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      try { navigator.geolocation.clearWatch(this.watchId); } catch (_) {}
    }
    this.watchId = null;
    // Tear down DOM listeners.
    for (const h of this._domHandlers) {
      try { h.el.removeEventListener(h.type, h.fn); } catch (_) {}
    }
    this._domHandlers = [];
    // Tear down Leaflet map.
    if (this.map) {
      try { this.map.off(); this.map.remove(); } catch (_) {}
      this.map = null;
    }
    // Clear DOM.
    if (this.container) this.container.innerHTML = '';

    track('around_me_destroyed', {});
  }

  recenter() {
    if (!this.map) return;
    const target = this.userPos || this.opts.fallbackCenter;
    this.map.flyTo([target.lat, target.lon], Math.max(this.map.getZoom(), 15), {
      duration: 0.6
    });
    track('around_me_recentered', { has_user: !!this.userPos });
  }

  flyToStop(id) {
    if (!this.map) return;
    const s = this.stops.find(x => x.id === id);
    if (!s) return;
    this.map.flyTo([s.lat, s.lon], 17, { duration: 0.5 });
    this._showPeek(s);
  }

  // -------- internals --------------------------------------------------------

  _cacheDom() {
    const $ = (sel) => this.container.querySelector(sel);
    this.$ = {
      map:      $('[id="aroundMeMap"]'),
      status:   $('[data-status]'),
      statusLabel: $('[data-status-label]'),
      peek:     $('[data-peek]'),
      peekPhoto: $('[data-peek-photo]'),
      peekTitle: $('[data-peek-title]'),
      peekMeta:  $('[data-peek-meta]'),
      peekRoute: $('[data-peek-route]'),
      peekDistance: $('[data-peek-distance]'),
      sheet:    $('[data-sheet]'),
      panelHost: $('[data-panel-host]'),
      loading:  $('[data-loading]'),
      empty:    $('[data-empty]'),
      tabs:     this.container.querySelectorAll('[role="tab"]'),
      panels:   this.container.querySelectorAll('[role="tabpanel"]')
    };
  }

  _on(el, type, fn) {
    if (!el) return;
    el.addEventListener(type, fn);
    this._domHandlers.push({ el, type, fn });
  }

  _wireDom() {
    const root = this.container;

    // Delegate all action clicks to the root for simplicity.
    const onClick = (e) => {
      const t = e.target.closest('[data-action]');
      if (!t || !root.contains(t)) return;
      const action = t.getAttribute('data-action');
      switch (action) {
        case 'toggle-offers':    this._toggleOffers(t); break;
        case 'recenter':         this.recenter(); break;
        case 'close-peek':       this._hidePeek(); break;
        case 'add-to-walk':      this._handleAddToWalk(); break;
        case 'open-route':       this._handleOpenRoute(); break;
        case 'request-permission': this._requestPermission(); break;
        case 'fallback-soho':    this._useFallbackLocation(); break;
        case 'toggle-sheet':     this._toggleSheet(); break;
      }
    };
    this._on(root, 'click', onClick);

    // Tab clicks.
    for (const tab of this.$.tabs) {
      this._on(tab, 'click', () => this._selectTab(tab.getAttribute('data-tab')));
      this._on(tab, 'keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const tabs = Array.from(this.$.tabs);
        const i = tabs.indexOf(tab);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        this._selectTab(next.getAttribute('data-tab'));
      });
    }

    // Sheet handle keyboard activation.
    const handle = root.querySelector('[data-action="toggle-sheet"]');
    this._on(handle, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleSheet(); }
    });
  }

  _initMap(center, zoom) {
    if (typeof L === 'undefined') {
      // Leaflet missing — show empty state instead of an inscrutable error.
      this._showEmpty('Map library failed to load.');
      return;
    }

    this.map = L.map(this.$.map, {
      center: [center.lat, center.lon],
      zoom: zoom,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true
    });

    // Standard OSM tiles — map.css applies our editorial filter.
    this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Reachable walk ring (1500m). Hidden until we have a user position; for
    // now anchor at center so the visual layout doesn't jump on first fix.
    this.walkRing = L.circle([center.lat, center.lon], {
      radius: this.opts.reachableMeters,
      className: 'am-walk-ring',
      interactive: false
    }).addTo(this.map);

    // Re-cluster on zoom changes.
    this._zoomHandler = () => this._renderStopMarkers();
    this.map.on('zoomend', this._zoomHandler);

    // Sheet ranking depends on user position; if the user pans we ALSO want
    // the bottom sheet to reflect the panned location (so "nearby" tracks
    // where the user is looking). Throttle to once per 400ms.
    let lastMoveT = 0;
    this._moveHandler = () => {
      const now = Date.now();
      if (now - lastMoveT < 400) return;
      lastMoveT = now;
      // Only re-rank if user has NOT consented yet (no userPos). When we
      // have userPos, "nearby" always means near the user.
      if (!this.userPos) {
        const c = this.map.getCenter();
        this._renderLists({ lat: c.lat, lon: c.lng });
      }
    };
    this.map.on('moveend', this._moveHandler);
  }

  // -------- markers + clustering --------------------------------------------

  _renderStopMarkers() {
    if (!this.map) return;

    // Wipe existing stop/cluster markers.
    for (const m of this.stopMarkers) try { this.map.removeLayer(m.marker); } catch (_) {}
    for (const m of this.clusterMarkers) try { this.map.removeLayer(m); } catch (_) {}
    this.stopMarkers = [];
    this.clusterMarkers = [];

    const zoom = this.map.getZoom();
    const clusters = clusterStops(this.stops, zoom);

    for (const c of clusters) {
      if (c.kind === 'cluster') {
        const icon = L.divIcon({
          className: '',
          html: '<div class="am-marker-cluster" aria-label="' + c.stops.length + ' stops">' + c.stops.length + '</div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        const m = L.marker([c.lat, c.lon], { icon, keyboard: false }).addTo(this.map);
        m.on('click', () => {
          // Zoom in until the cluster breaks apart.
          this.map.flyTo([c.lat, c.lon], Math.min((this.map.getZoom() || 14) + 2, 17), { duration: 0.4 });
        });
        this.clusterMarkers.push(m);
      } else {
        const s = c.stops[0];
        const icon = L.divIcon({
          className: '',
          html: '<div class="am-marker-stop" data-stop-id="' + esc(s.id) + '" aria-label="' + esc(s.name) + '"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        const m = L.marker([s.lat, s.lon], { icon, keyboard: false, title: s.name }).addTo(this.map);
        m.on('click', () => this._showPeek(s));
        this.stopMarkers.push({ marker: m, stop: s });
      }
    }

    if (this.showOffers) this._renderPromoMarkers();
  }

  _renderPromoMarkers() {
    if (!this.map) return;
    for (const m of this.promoMarkers) try { this.map.removeLayer(m); } catch (_) {}
    this.promoMarkers = [];
    if (!this.showOffers) return;
    for (const p of this.promotions) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="am-marker-promo" aria-label="' + esc(p.business + ': ' + p.offer) + '"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 18]
      });
      const m = L.marker([p.lat, p.lon], { icon, keyboard: false, title: p.business + ' — ' + p.offer }).addTo(this.map);
      m.on('click', () => this._showPromoPeek(p));
      this.promoMarkers.push(m);
    }
  }

  _toggleOffers(chip) {
    this.showOffers = !this.showOffers;
    chip.setAttribute('aria-pressed', String(this.showOffers));
    this._renderPromoMarkers();
    track('around_me_offers_toggled', { on: this.showOffers });
  }

  // -------- geolocation ------------------------------------------------------

  _startGeolocation() {
    if (!('geolocation' in navigator)) {
      this._showEmpty();
      return;
    }
    this._setStatus('locating', 'Locating you…');
    try {
      this.watchId = navigator.geolocation.watchPosition(
        (pos)   => this._onPosition(pos),
        (err)   => this._onGeoError(err),
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
      );
    } catch (e) {
      this._onGeoError(e);
    }
  }

  _onPosition(pos) {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    this.userPos = { lat, lon };
    this.lastFix = pos.timestamp;

    // First fix? hide skeleton, center, drop user marker, render lists.
    if (this.$.loading && !this.$.loading.hasAttribute('hidden')) {
      this.$.loading.setAttribute('hidden', '');
      this._setStatus('live', 'Live');
    }

    // Drop / update the user marker.
    if (!this.userMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="am-user-dot" aria-label="Your location"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      this.userMarker = L.marker([lat, lon], { icon, keyboard: false, zIndexOffset: 1000 }).addTo(this.map);
      this.map.flyTo([lat, lon], 15, { duration: 0.6 });
    } else {
      this.userMarker.setLatLng([lat, lon]);
    }

    // Move the walk ring.
    if (this.walkRing) this.walkRing.setLatLng([lat, lon]);

    // Refresh nearby lists.
    this._renderLists({ lat, lon });

    // Track once on first fix.
    if (!this._firstFixTracked) {
      this._firstFixTracked = true;
      track('around_me_first_fix', { accuracy: Math.round(accuracy || 0) });
    }
  }

  _onGeoError(err) {
    // Hide loading skeleton.
    if (this.$.loading) this.$.loading.setAttribute('hidden', '');
    this._setStatus('error', 'Location unavailable');
    this._showEmpty();
    track('around_me_geo_error', { code: err && err.code });
  }

  _requestPermission() {
    // The most-reliable way to re-prompt is just to call watchPosition again.
    // If the user had permanently denied, this fails again — which is fine,
    // the empty state stays. We hide it optimistically so the user gets
    // feedback that we tried.
    if (this.$.empty) this.$.empty.setAttribute('hidden', '');
    if (this.$.loading) this.$.loading.removeAttribute('hidden');
    this._startGeolocation();
    track('around_me_permission_retry', {});
  }

  _useFallbackLocation() {
    if (this.$.empty) this.$.empty.setAttribute('hidden', '');
    if (this.$.loading) this.$.loading.setAttribute('hidden', '');
    this._setStatus('locating', 'Showing Manhattan center');
    // Anchor at SoHo per spec — do NOT set userPos; we want the user to know
    // this isn't their real location (no live navy dot).
    const c = this.opts.fallbackCenter;
    this.map.flyTo([c.lat, c.lon], 14, { duration: 0.4 });
    if (this.walkRing) this.walkRing.setLatLng([c.lat, c.lon]);
    this._renderLists(c);
    track('around_me_fallback_used', {});
  }

  _showEmpty(reason) {
    if (this.$.loading) this.$.loading.setAttribute('hidden', '');
    if (this.$.empty)   this.$.empty.removeAttribute('hidden');
  }

  _setStatus(state, label) {
    if (!this.$.status) return;
    this.$.status.setAttribute('data-state', state);
    if (this.$.statusLabel) this.$.statusLabel.textContent = label;
  }

  // -------- peek card -------------------------------------------------------

  _showPeek(stop) {
    if (!this.$.peek || !stop) return;
    this.selectedStop = stop;

    // Photo.
    const url = findPhotoForStop(this.photos, stop.routeId, stop.stopIdx, stop.name);
    if (this.$.peekPhoto) {
      this.$.peekPhoto.style.backgroundImage = url ? "url('" + url.replace(/'/g, "\\'") + "')" : 'none';
    }

    // Title + meta.
    if (this.$.peekTitle) this.$.peekTitle.textContent = stop.name;
    if (this.$.peekMeta)  this.$.peekMeta.textContent  = (stop.nbhd || stop.routeId || '').toString().toUpperCase();
    if (this.$.peekRoute) this.$.peekRoute.textContent = 'Part of ' + stop.routeTitle;

    // Distance — relative to user if known, else map center.
    const from = this.userPos || (this.map ? { lat: this.map.getCenter().lat, lon: this.map.getCenter().lng } : null);
    const meters = from ? distMeters(from, { lat: stop.lat, lon: stop.lon }) : null;
    if (this.$.peekDistance) {
      this.$.peekDistance.textContent = meters != null
        ? (formatDistance(meters) + ' · ~' + walkingMinutes(meters) + ' min walk')
        : '—';
    }

    this.$.peek.setAttribute('data-open', 'true');
    this.$.peek.setAttribute('aria-hidden', 'false');

    // Highlight the marker.
    for (const m of this.stopMarkers) {
      const el = m.marker.getElement();
      if (!el) continue;
      const dot = el.querySelector('.am-marker-stop');
      if (!dot) continue;
      dot.classList.toggle('am-marker-stop--active', m.stop.id === stop.id);
    }

    track('around_me_stop_peeked', { stop_id: stop.id, route_id: stop.routeId });
  }

  _showPromoPeek(promo) {
    if (!this.$.peek || !promo) return;
    // Promo peeks reuse the same UI but with offer copy.
    this.selectedStop = null;
    if (this.$.peekPhoto) this.$.peekPhoto.style.backgroundImage = 'linear-gradient(135deg, #E0B341, #B8941F)';
    if (this.$.peekTitle) this.$.peekTitle.textContent = promo.business;
    if (this.$.peekMeta)  this.$.peekMeta.textContent  = 'OFFER · ' + (promo.expires || 'limited').toUpperCase();
    if (this.$.peekRoute) this.$.peekRoute.textContent = promo.offer;
    const from = this.userPos || (this.map ? { lat: this.map.getCenter().lat, lon: this.map.getCenter().lng } : null);
    const meters = from ? distMeters(from, { lat: promo.lat, lon: promo.lon }) : null;
    if (this.$.peekDistance) {
      this.$.peekDistance.textContent = meters != null ? formatDistance(meters) : '—';
    }
    this.$.peek.setAttribute('data-open', 'true');
    this.$.peek.setAttribute('aria-hidden', 'false');
    track('around_me_promo_peeked', { promo_id: promo.id });
  }

  _hidePeek() {
    if (!this.$.peek) return;
    this.$.peek.setAttribute('data-open', 'false');
    this.$.peek.setAttribute('aria-hidden', 'true');
    this.selectedStop = null;
    for (const m of this.stopMarkers) {
      const el = m.marker.getElement();
      if (!el) continue;
      const dot = el.querySelector('.am-marker-stop');
      if (dot) dot.classList.remove('am-marker-stop--active');
    }
  }

  _handleAddToWalk() {
    // Hand-off to the host app — best-effort. The contract: set State.draftStops
    // and let the integrator pick it up in their walk-builder.
    const s = this.selectedStop;
    if (!s) return;
    try {
      if (_w.State) {
        if (!Array.isArray(_w.State.draftStops)) _w.State.draftStops = [];
        if (!_w.State.draftStops.find(x => x.id === s.id)) _w.State.draftStops.push(s);
      }
    } catch (_) {}
    track('around_me_add_to_walk', { stop_id: s.id, route_id: s.routeId });
    // Cheap toast feedback.
    this._toast('Added to your quick walk');
  }

  _handleOpenRoute() {
    const s = this.selectedStop;
    if (!s) return;
    try {
      const route = this.routes.find(r => r.id === s.routeId);
      if (route && _w.State) _w.State.currentRoute = route;
      if (_w.Nav && typeof _w.Nav.go === 'function') _w.Nav.go('detail');
    } catch (_) {}
    track('around_me_open_route', { route_id: s.routeId, from_stop_id: s.id });
  }

  _toast(msg) {
    // Use the host app's Toast if it's wired; otherwise inline a tiny one.
    try {
      if (_w.Toast && typeof _w.Toast.show === 'function') return _w.Toast.show(msg);
    } catch (_) {}
    const el = document.createElement('div');
    el.textContent = msg;
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:absolute;left:50%;bottom:140px;transform:translateX(-50%);' +
      'background:rgba(14,19,32,0.92);color:white;padding:10px 16px;border-radius:999px;' +
      'font-size:13px;font-weight:600;z-index:900;box-shadow:0 6px 18px rgba(0,0,0,0.25);';
    this.container.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 1800);
  }

  // -------- bottom sheet -----------------------------------------------------

  _toggleSheet() {
    if (!this.$.sheet) return;
    const open = this.$.sheet.getAttribute('data-open') === 'true';
    this.$.sheet.setAttribute('data-open', String(!open));
    track('around_me_sheet_toggled', { open: !open });
  }

  _selectTab(name) {
    this.activeTab = name;
    for (const t of this.$.tabs) {
      t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === name));
    }
    for (const p of this.$.panels) {
      const match = p.getAttribute('data-panel') === name;
      if (match) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    }
    track('around_me_tab_changed', { tab: name });
  }

  _renderInitialLists() {
    // Until we have userPos, rank against the map center (SoHo fallback).
    const c = this.opts.fallbackCenter;
    this._renderLists(c);
  }

  _renderLists(origin) {
    if (!origin) return;
    this._renderStopsPanel(origin);
    this._renderRoutesPanel(origin);
  }

  _renderStopsPanel(origin) {
    const panel = this.container.querySelector('[data-panel="stops"]');
    if (!panel) return;
    const scored = this.stops
      .map(s => ({ s, d: distMeters(origin, { lat: s.lat, lon: s.lon }) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.opts.maxNearbyStops);
    if (!scored.length) {
      panel.innerHTML = '<div class="am-sheet__empty">No stops nearby.</div>';
      return;
    }
    const html = scored.map(({ s, d }) => {
      const photo = findPhotoForStop(this.photos, s.routeId, s.stopIdx, s.name);
      const photoStyle = photo
        ? 'background-image:url(\'' + esc(photo) + '\');'
        : 'background-image:linear-gradient(135deg, var(--navy), var(--navy-2));';
      return (
        '<div class="am-list-item" role="button" tabindex="0" data-stop-id="' + esc(s.id) + '">' +
          '<div class="am-list-thumb" style="' + photoStyle + '"></div>' +
          '<div class="am-list-body">' +
            '<div class="am-list-name">' + esc(s.name) + '</div>' +
            '<div class="am-list-why">' + esc(s.why || s.routeTitle) + '</div>' +
            '<div class="am-list-meta">' + esc(s.routeTitle) + '</div>' +
          '</div>' +
          '<div class="am-list-dist">' + esc(formatDistance(d)) + '</div>' +
        '</div>'
      );
    }).join('');
    panel.innerHTML = html;

    // Wire item taps.
    panel.querySelectorAll('.am-list-item').forEach(el => {
      const id = el.getAttribute('data-stop-id');
      const go = () => this.flyToStop(id);
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  _renderRoutesPanel(origin) {
    const panel = this.container.querySelector('[data-panel="routes"]');
    if (!panel) return;

    const ranked = this.routes
      .map(r => {
        const cen = centroid(r.stops || []);
        if (!cen) return null;
        return { r, d: distMeters(origin, cen) };
      })
      .filter(Boolean)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.opts.maxNearbyRoutes);

    if (!ranked.length) {
      panel.innerHTML = '<div class="am-sheet__empty">No routes nearby.</div>';
      return;
    }

    const html = ranked.map(({ r, d }) => {
      const hero = findHeroForRoute(this.photos, r.id);
      const heroStyle = hero
        ? 'background-image:url(\'' + esc(hero) + '\');'
        : 'background-image:linear-gradient(135deg, var(--navy), var(--gold));';
      const walkMin = walkingMinutes(d);
      return (
        '<div class="am-list-item" role="button" tabindex="0" data-route-id="' + esc(r.id) + '">' +
          '<div class="am-list-thumb" style="' + heroStyle + '"></div>' +
          '<div class="am-list-body">' +
            '<div class="am-list-name">' + esc(r.title) + '</div>' +
            '<div class="am-list-why">' + esc(r.desc || '') + '</div>' +
            '<div class="am-list-meta">' + esc(r.miles + ' mi · ' + r.minutes + ' min walk') + '</div>' +
          '</div>' +
          '<div class="am-list-dist">' + esc(walkMin + ' min<br>to start') + '</div>' +
        '</div>'
      );
    }).join('');
    panel.innerHTML = html;

    panel.querySelectorAll('.am-list-item').forEach(el => {
      const id = el.getAttribute('data-route-id');
      const go = () => {
        const route = this.routes.find(r => r.id === id);
        if (!route) return;
        try {
          if (_w.State) _w.State.currentRoute = route;
          if (_w.Nav && typeof _w.Nav.go === 'function') _w.Nav.go('detail');
        } catch (_) {}
        track('around_me_route_opened', { route_id: id });
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }
}

/* ----------------------------------------------------------------------------
   7. Singleton wrapper — the public API surface.
   ---------------------------------------------------------------------------- */
let _instance = null;

export const AroundMe = {
  mount(containerEl, opts) {
    if (!containerEl) throw new Error('AroundMe.mount: containerEl is required.');
    if (_instance) {
      // Tolerate re-mount calls by destroying the previous instance first.
      try { _instance.destroy(); } catch (_) {}
      _instance = null;
    }
    _instance = new AroundMeScreen(containerEl, opts || {});
    // mount() is async; we kick it off but resolve immediately for the host.
    Promise.resolve(_instance.mount()).catch(() => {});
    return _instance;
  },

  destroy() {
    if (_instance) {
      try { _instance.destroy(); } catch (_) {}
      _instance = null;
    }
  },

  recenter()        { if (_instance) _instance.recenter(); },
  flyToStop(id)     { if (_instance) _instance.flyToStop(id); },

  // Exposed for tests / debugging.
  _instance:      () => _instance,
  _clusterStops:  clusterStops,
  _distMeters:    distMeters,
  _findPhotoForStop: findPhotoForStop
};

// Window-global fallback so non-module inline code in the shell can call it.
if (typeof window !== 'undefined') {
  window.AroundMe = AroundMe;
}

export default AroundMe;
