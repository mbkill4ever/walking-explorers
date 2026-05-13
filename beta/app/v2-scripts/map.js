/* ============================================================
   Walking Explorers v2 — Map module (ES module)
   --------------------------------------------------------------
   Wraps Leaflet with our editorial style.
   Requires: Leaflet (window.L) and beta/app/v2-styles/map.css.

   Public API:
     Map.createDetailMap(container, route)
     Map.createWalkMap(container, route, currentIdx)
     Map.createArchiveMap(container, spots)
     Map.destroy(map)
   ============================================================ */

const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR =
  '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DEFAULT_ZOOM = 15;

function _assertLeaflet() {
  if (typeof window === 'undefined' || !window.L) {
    throw new Error('[we/map] Leaflet (window.L) not found. Load Leaflet before map.js.');
  }
  return window.L;
}

/**
 * Base map factory — wires up tile layer, attribution, zoom control.
 * Returns the Leaflet map instance.
 */
function _createBaseMap(container, opts = {}) {
  const L = _assertLeaflet();
  const map = L.map(container, {
    zoomControl: false,           // we add our own positioned control
    attributionControl: true,
    scrollWheelZoom: opts.scrollWheelZoom !== false,
    tap: true,
    minZoom: 11,
    maxZoom: 19,
    ...opts.leaflet,
  });

  L.tileLayer(OSM_TILES, {
    attribution: OSM_ATTR,
    maxZoom: 19,
    crossOrigin: true,
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  return map;
}

/**
 * Build a divIcon for a route stop.
 * @param {object} stop  - { name, sponsored, ... }
 * @param {number} idx   - 0-based stop index
 * @param {object} flags - { isCurrent, isVisited }
 */
function _createStopMarker(stop, idx, flags = {}) {
  const L = _assertLeaflet();
  const { isCurrent = false, isVisited = false } = flags;
  const classes = [
    'we-marker-stop',
    stop?.sponsored ? 'sponsored' : '',
    isCurrent ? 'current' : '',
    isVisited ? 'visited' : '',
  ].filter(Boolean).join(' ');

  const label = `Stop ${idx + 1}${stop?.name ? ': ' + stop.name : ''}${
    stop?.sponsored ? ' (sponsored)' : ''
  }${isCurrent ? ' — current' : ''}`;

  return L.divIcon({
    className: '',
    html: `<div class="${classes}" role="img" aria-label="${_escape(label)}">${idx + 1}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

/**
 * Build a photo-thumbnail divIcon for an archived spot.
 * @param {object} spot - { photoUrl, name, ... }
 */
function _createSpotMarker(spot) {
  const L = _assertLeaflet();
  const photo = spot?.photoUrl ? `background-image:url('${_escape(spot.photoUrl)}');` : '';
  const label = `My spot${spot?.name ? ': ' + spot.name : ''}`;

  return L.divIcon({
    className: '',
    html: `<div class="we-marker-spot" role="img" aria-label="${_escape(label)}" style="${photo}"></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

/**
 * Build an editorial popup card.
 * @param {object} item - { name, kind, photoUrl, body, ctaLabel, ctaHref }
 */
function _createPopupContent(item = {}) {
  const { name, kind, photoUrl, body, ctaLabel, ctaHref } = item;
  const parts = [];
  if (photoUrl) {
    parts.push(
      `<div class="pop-photo" style="background-image:url('${_escape(photoUrl)}')" role="img" aria-label="${_escape(name || 'Photo')}"></div>`
    );
  }
  if (kind) parts.push(`<div class="pop-meta">${_escape(kind)}</div>`);
  if (name) parts.push(`<h3 class="pop-title">${_escape(name)}</h3>`);
  if (body) parts.push(`<p class="pop-body">${_escape(body)}</p>`);
  if (ctaLabel && ctaHref) {
    parts.push(
      `<a class="pop-cta" href="${_escape(ctaHref)}" rel="noopener">${_escape(ctaLabel)}</a>`
    );
  }
  return parts.join('');
}

/**
 * Draw the route polyline with the brand styling.
 * Adds the `we-route-path` class so map.css picks it up.
 */
function _drawRoute(map, coords, opts = {}) {
  const L = _assertLeaflet();
  if (!coords?.length) return null;
  const line = L.polyline(coords, {
    className: 'we-route-path',
    interactive: false,
    smoothFactor: 1.2,
    // stroke styling lives in CSS, but Leaflet needs *something* here
    // so it produces an SVG <path>:
    color: '#1F3864',
    weight: 4,
    opacity: 1,
    ...opts,
  }).addTo(map);
  return line;
}

/** Compute bounding box for a list of [lat,lng] pairs. */
function _bounds(coords) {
  const L = _assertLeaflet();
  return L.latLngBounds(coords);
}

/** Tiny HTML escape — popup/marker content goes through innerHTML. */
function _escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* =============================================================
   PUBLIC API
   ============================================================= */

export const Map = {
  /**
   * Detail screen — full route preview, no "current" pulse.
   * @param {HTMLElement|string} container
   * @param {object} route - { stops: [{lat,lng,name,kind,photoUrl,sponsored}], path: [[lat,lng], ...] }
   * @returns {L.Map}
   */
  createDetailMap(container, route) {
    const L = _assertLeaflet();
    const map = _createBaseMap(container, { scrollWheelZoom: false });
    map.getContainer().setAttribute('role', 'region');
    map.getContainer().setAttribute('aria-label', 'Walk route map');

    const stops = route?.stops || [];
    const pathCoords = route?.path || stops.map((s) => [s.lat, s.lng]);

    _drawRoute(map, pathCoords);

    stops.forEach((stop, idx) => {
      const m = L.marker([stop.lat, stop.lng], {
        icon: _createStopMarker(stop, idx),
        keyboard: true,
        alt: `Stop ${idx + 1}${stop.name ? ': ' + stop.name : ''}`,
        title: stop.name || `Stop ${idx + 1}`,
      }).addTo(map);
      m.bindPopup(
        _createPopupContent({
          name: stop.name,
          kind: stop.kind || (stop.sponsored ? 'Sponsored stop' : `Stop ${idx + 1}`),
          photoUrl: stop.photoUrl,
          body: stop.summary,
        }),
        { closeButton: true, maxWidth: 280 }
      );
    });

    if (pathCoords.length) map.fitBounds(_bounds(pathCoords), { padding: [32, 32] });
    else map.setView([40.7128, -74.006], DEFAULT_ZOOM);

    return map;
  },

  /**
   * Walk screen — live walking experience.
   * Highlights the current stop with a pulse, fades visited stops,
   * draws the walked portion of the path in gold.
   * @param {HTMLElement|string} container
   * @param {object} route
   * @param {number} currentIdx - index of the stop the user is heading to
   * @returns {L.Map}
   */
  createWalkMap(container, route, currentIdx = 0) {
    const L = _assertLeaflet();
    const map = _createBaseMap(container, { scrollWheelZoom: true });
    map.getContainer().setAttribute('role', 'region');
    map.getContainer().setAttribute('aria-label', 'Live walking map');

    const stops = route?.stops || [];
    const pathCoords = route?.path || stops.map((s) => [s.lat, s.lng]);

    // 1. full route (dashed navy)
    _drawRoute(map, pathCoords);

    // 2. walked portion (solid gold) — everything up to currentIdx
    if (currentIdx > 0 && stops.length > 1) {
      const walked = stops.slice(0, currentIdx + 1).map((s) => [s.lat, s.lng]);
      if (walked.length >= 2) {
        L.polyline(walked, {
          className: 'we-route-walked',
          interactive: false,
          color: '#E0B341',
          weight: 5,
          opacity: 1,
        }).addTo(map);
      }
    }

    // 3. stop markers with state flags
    stops.forEach((stop, idx) => {
      const isCurrent = idx === currentIdx;
      const isVisited = idx < currentIdx;
      L.marker([stop.lat, stop.lng], {
        icon: _createStopMarker(stop, idx, { isCurrent, isVisited }),
        keyboard: true,
        alt: `Stop ${idx + 1}${stop.name ? ': ' + stop.name : ''}${
          isCurrent ? ' — current' : isVisited ? ' — visited' : ''
        }`,
        title: stop.name || `Stop ${idx + 1}`,
        zIndexOffset: isCurrent ? 1000 : 0,
      })
        .addTo(map)
        .bindPopup(
          _createPopupContent({
            name: stop.name,
            kind: stop.kind || (stop.sponsored ? 'Sponsored stop' : `Stop ${idx + 1}`),
            photoUrl: stop.photoUrl,
            body: stop.summary,
          }),
          { closeButton: true, maxWidth: 280 }
        );
    });

    // 4. Center on current stop with comfortable zoom
    const current = stops[currentIdx];
    if (current) {
      map.setView([current.lat, current.lng], DEFAULT_ZOOM + 1);
    } else if (pathCoords.length) {
      map.fitBounds(_bounds(pathCoords), { padding: [32, 32] });
    } else {
      map.setView([40.7128, -74.006], DEFAULT_ZOOM);
    }

    return map;
  },

  /**
   * Archive (My Spots) — photo-thumbnail markers, no route line.
   * Each marker shows the user's photo for that spot.
   * @param {HTMLElement|string} container
   * @param {Array} spots - [{ lat, lng, name, photoUrl, dateSaved, ... }]
   * @returns {L.Map}
   */
  createArchiveMap(container, spots) {
    const L = _assertLeaflet();
    const map = _createBaseMap(container, { scrollWheelZoom: true });
    map.getContainer().setAttribute('role', 'region');
    map.getContainer().setAttribute('aria-label', 'My saved spots map');

    const list = Array.isArray(spots) ? spots : [];
    const coords = [];

    list.forEach((spot) => {
      if (typeof spot?.lat !== 'number' || typeof spot?.lng !== 'number') return;
      coords.push([spot.lat, spot.lng]);

      L.marker([spot.lat, spot.lng], {
        icon: _createSpotMarker(spot),
        keyboard: true,
        alt: `My spot${spot.name ? ': ' + spot.name : ''}`,
        title: spot.name || 'Saved spot',
      })
        .addTo(map)
        .bindPopup(
          _createPopupContent({
            name: spot.name || 'Saved spot',
            kind: spot.dateSaved ? `Saved ${spot.dateSaved}` : 'My spot',
            photoUrl: spot.photoUrl,
            body: spot.note,
            ctaLabel: spot.ctaLabel,
            ctaHref: spot.ctaHref,
          }),
          { closeButton: true, maxWidth: 280 }
        );
    });

    if (coords.length === 1) {
      map.setView(coords[0], DEFAULT_ZOOM);
    } else if (coords.length > 1) {
      map.fitBounds(_bounds(coords), { padding: [40, 40] });
    } else {
      // empty state — fall back to a sensible default (NYC)
      map.setView([40.7128, -74.006], 12);
    }

    return map;
  },

  /**
   * Clean tear-down for SPA navigations.
   */
  destroy(map) {
    try {
      if (map && typeof map.remove === 'function') map.remove();
    } catch (_e) {
      /* swallow — map already disposed */
    }
  },

  // Exposed for tests / advanced callers
  _internals: {
    _createStopMarker,
    _createSpotMarker,
    _createPopupContent,
    _drawRoute,
  },
};

export default Map;
