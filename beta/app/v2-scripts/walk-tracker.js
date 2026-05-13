// Walking Explorers v0.7 — Live Walk Tracker
// Self-contained ES module. Owns GPS watch, user marker, route polyline,
// stop markers, proximity logic, off-route detection, and walk summary.
//
// Public API:
//   import WalkTracker from '/beta/app/v2-scripts/walk-tracker.js';
//   const tracker = await WalkTracker.start({ route, mapElement, ...callbacks });
//   tracker.stop(); tracker.pause(); tracker.resume();
//   tracker.recenter(); tracker.advanceTo(idx);
//   tracker.getSummary();
//
// Privacy: positions live only in memory. Nothing is logged or transmitted.

const PROX_NEAR    = 300; // caption updates begin
const PROX_CLOSE   = 100; // onProximity fires + toast
const PROX_ARRIVE  = 30;  // onArrival fires + tap-target
const OFFROUTE_DIST = 250; // meters from polyline
const OFFROUTE_TIME = 60_000; // ms continuous off-route before suggestion
const WEAK_GPS_TIME = 30_000; // ms continuous low accuracy before warning
const DWELL_AUTOADV = 120_000; // 2 min on previous stop -> auto advance
const RETRY_AFTER   = 10_000; // watchPosition error backoff
const NOISE_DIST    = 5; // meters; below this + slow speed = ignore
const NOISE_SPEED   = 0.3; // m/s
const MAX_ACCURACY  = 100; // meters

// ---------- math helpers ----------
function toRad(d) { return d * Math.PI / 180; }
function haversine(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// distance from point P to segment AB (in meters, approximate using equirectangular projection at mid lat)
function distToSegment(p, a, b) {
  const midLat = toRad((a.lat + b.lat) / 2);
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(midLat);
  const px = p.lon * mPerDegLon, py = p.lat * mPerDegLat;
  const ax = a.lon * mPerDegLon, ay = a.lat * mPerDegLat;
  const bx = b.lon * mPerDegLon, by = b.lat * mPerDegLat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px-ax, py-ay);
  let t = ((px-ax)*dx + (py-ay)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t*dx, qy = ay + t*dy;
  return Math.hypot(px-qx, py-qy);
}
function distToPolyline(p, stops) {
  let best = Infinity;
  for (let i = 0; i < stops.length - 1; i++) {
    const d = distToSegment(p, stops[i], stops[i+1]);
    if (d < best) best = d;
  }
  return best;
}

// ---------- DOM helpers ----------
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// ---------- Leaflet-or-fallback layer ----------
// We rely on Leaflet if window.L is present (the Walk screen already loads it).
// If a DOM element is passed instead of a map instance, we'll create the map.
function ensureMap(mapElement, route) {
  const L = window.L;
  if (!L) throw new Error('walk-tracker: Leaflet (window.L) is required');
  let map = mapElement;
  if (mapElement instanceof HTMLElement) {
    map = L.map(mapElement, { zoomControl: false, attributionControl: false });
    const first = route.stops[0];
    map.setView([first.lat, first.lon], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OSM'
    }).addTo(map);
  }
  return map;
}

// ---------- main factory ----------
function start(opts) {
  return new Promise((resolve) => {
    const tracker = new WalkTrackerImpl(opts);
    tracker._init().then(resolve);
  });
}

class WalkTrackerImpl {
  constructor(opts) {
    this.route = opts.route;
    this.cb = {
      onProximity: opts.onProximity || (() => {}),
      onArrival:   opts.onArrival   || (() => {}),
      onProgress:  opts.onProgress  || (() => {}),
      onPositionUpdate: opts.onPositionUpdate || (() => {})
    };
    this.mapInput = opts.mapElement;

    // state
    this.watchId = null;
    this.activeIdx = 0;
    this.lastPos = null;        // {lat, lon, ts, heading, speed, accuracy}
    this.prevAcceptedPos = null;
    this.visited = new Set();
    this.offRouteSince = null;
    this.weakGpsSince = null;
    this.arrivedAtActiveAt = null;
    this.lastAdvanceAt = Date.now();
    this.paused = false;
    this.retryTimer = null;

    // summary
    this.summary = {
      startedAt: Date.now(),
      endedAt: null,
      metersWalked: 0,
      peakSpeed: 0,
      stopsVisited: [],
      durationMs: 0
    };

    // ui handles
    this.map = null;
    this.userMarker = null;
    this.userHalo = null;
    this.polyline = null;
    this.stopMarkers = [];
    this.captionEl = null;
    this.toastEl = null;
    this.arriveEl = null;
    this.offRouteEl = null;
    this.weakGpsToastShown = false;
  }

  async _init() {
    if (!('geolocation' in navigator)) {
      return { ok: false, reason: 'unsupported', tracker: this._stub() };
    }
    try {
      this.map = ensureMap(this.mapInput, this.route);
    } catch (e) {
      return { ok: false, reason: 'map', error: e.message, tracker: this._stub() };
    }
    this._buildOverlay();
    this._drawRoute();
    this._drawStops();

    // Probe permission with a getCurrentPosition call; if denied, bail.
    const probe = await new Promise((res) => {
      navigator.geolocation.getCurrentPosition(
        (p) => res({ ok: true, p }),
        (err) => res({ ok: false, code: err.code }),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 1000 }
      );
    });
    if (!probe.ok) {
      const reason = probe.code === 1 ? 'denied' : (probe.code === 3 ? 'timeout' : 'unavailable');
      this._teardownUI();
      return { ok: false, reason, tracker: this._stub() };
    }

    this._handlePosition(probe.p, /*initial*/ true);
    this._startWatch();

    // Return a public-shaped object with bound methods.
    return Object.assign(this._publicApi(), { ok: true });
  }

  _stub() {
    return {
      stop: () => {}, pause: () => {}, resume: () => {},
      recenter: () => {}, advanceTo: () => {},
      getSummary: () => ({ ...this.summary })
    };
  }

  _publicApi() {
    return {
      stop: () => this.stop(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      recenter: () => this.recenter(),
      advanceTo: (i) => this.advanceTo(i),
      getSummary: () => this.getSummary()
    };
  }

  // ---------- UI scaffolding ----------
  _buildOverlay() {
    const container = this.map.getContainer ? this.map.getContainer() : null;
    const host = container ? container.parentElement : document.body;
    host.classList.add('we-walk-tracker__host');

    this.captionEl = el('div', 'we-walk-tracker__caption', '');
    this.captionEl.style.display = 'none';
    host.appendChild(this.captionEl);

    this.toastEl = el('div', 'we-walk-tracker__toast', '');
    this.toastEl.style.display = 'none';
    host.appendChild(this.toastEl);

    this.arriveEl = el('button', 'we-walk-tracker__arrive', '');
    this.arriveEl.style.display = 'none';
    this.arriveEl.addEventListener('click', () => this._handleArriveTap());
    host.appendChild(this.arriveEl);

    this.offRouteEl = el('div', 'we-walk-tracker__offroute', '');
    this.offRouteEl.style.display = 'none';
    host.appendChild(this.offRouteEl);
  }

  _drawRoute() {
    const L = window.L;
    const coords = this.route.stops.map((s) => [s.lat, s.lon]);
    this.polyline = L.polyline(coords, {
      color: '#1a2b4a', weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round'
    }).addTo(this.map);
    try { this.map.fitBounds(this.polyline.getBounds(), { padding: [32, 32] }); } catch (e) {}
  }

  _drawStops() {
    const L = window.L;
    this.route.stops.forEach((s, i) => {
      const sponsored = !!s.sponsored;
      const icon = L.divIcon({
        className: 'we-walk-tracker__stop-icon',
        html: this._stopMarkerHTML(i, 'upcoming', sponsored),
        iconSize: [32, 32], iconAnchor: [16, 16]
      });
      const m = L.marker([s.lat, s.lon], { icon }).addTo(this.map);
      this.stopMarkers.push({ marker: m, sponsored, idx: i });
    });
    this._refreshStopStates();
  }

  _stopMarkerHTML(i, state, sponsored) {
    const cls = ['we-walk-tracker__stop', `we-walk-tracker__stop--${state}`];
    if (sponsored) cls.push('we-walk-tracker__stop--sponsored');
    let inner;
    if (state === 'visited') inner = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    else if (sponsored) inner = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7H4v5h16V7zm-9 0V5a2 2 0 1 0-4 0v2m6 0V5a2 2 0 1 1 4 0v2M5 12v8h14v-8M12 7v13" stroke="#1a2b4a" stroke-width="1.6" fill="none"/></svg>';
    else inner = `<span>${i + 1}</span>`;
    return `<div class="${cls.join(' ')}">${inner}</div>`;
  }

  _refreshStopStates() {
    this.stopMarkers.forEach((sm) => {
      let state = 'upcoming';
      if (this.visited.has(sm.idx)) state = 'visited';
      else if (sm.idx === this.activeIdx) state = 'active';
      const html = this._stopMarkerHTML(sm.idx, state, sm.sponsored);
      const el = sm.marker.getElement();
      if (el) el.innerHTML = html;
      else sm.marker.setIcon(window.L.divIcon({
        className: 'we-walk-tracker__stop-icon', html,
        iconSize: [32, 32], iconAnchor: [16, 16]
      }));
    });
  }

  _ensureUserMarker(lat, lon, heading) {
    const L = window.L;
    const headingDeg = (heading == null || isNaN(heading)) ? null : heading;
    const arrow = headingDeg == null ? '' :
      `<div class="we-walk-tracker__user-arrow" style="transform:rotate(${headingDeg}deg)"></div>`;
    const html = `
      <div class="we-walk-tracker__user-marker">
        <div class="we-walk-tracker__user-halo"></div>
        <div class="we-walk-tracker__user-dot"></div>
        ${arrow}
      </div>`;
    if (!this.userMarker) {
      const icon = L.divIcon({
        className: 'we-walk-tracker__user-icon', html,
        iconSize: [44, 44], iconAnchor: [22, 22]
      });
      this.userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(this.map);
    } else {
      this.userMarker.setLatLng([lat, lon]);
      const elNode = this.userMarker.getElement();
      if (elNode) elNode.innerHTML = html;
    }
  }

  // ---------- GPS handling ----------
  _startWatch() {
    if (this.watchId != null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this._handlePosition(p, false),
      (err) => this._handleError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
    );
  }

  _stopWatch() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  _handleError(err) {
    if (err && err.code === 1) {
      // denied mid-walk -> stop trying
      this._stopWatch();
      return;
    }
    this._stopWatch();
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (!this.paused) this._startWatch(); }, RETRY_AFTER);
  }

  _handlePosition(pos, initial) {
    if (this.paused) return;
    const { latitude, longitude, accuracy, heading, speed } = pos.coords;
    const now = pos.timestamp || Date.now();

    // Weak GPS tracking
    if (accuracy != null && accuracy > MAX_ACCURACY) {
      if (this.weakGpsSince == null) this.weakGpsSince = now;
      if (!this.weakGpsToastShown && now - this.weakGpsSince > WEAK_GPS_TIME) {
        this._showToast('GPS is weak — accuracy may suffer.', { transient: true });
        this.weakGpsToastShown = true;
      }
      // Don't process the reading itself if it's grossly inaccurate.
      return;
    } else {
      this.weakGpsSince = null;
    }

    const current = { lat: latitude, lon: longitude, ts: now, heading, speed, accuracy };

    // Jitter filter: standing still + tiny movement
    if (this.prevAcceptedPos) {
      const d = haversine(this.prevAcceptedPos, current);
      const sp = speed == null ? 0 : speed;
      if (sp < NOISE_SPEED && d < NOISE_DIST) return;
      this.summary.metersWalked += d;
      if (sp > this.summary.peakSpeed) this.summary.peakSpeed = sp;
    }
    this.prevAcceptedPos = current;
    this.lastPos = current;
    this.summary.durationMs = now - this.summary.startedAt;

    this._ensureUserMarker(latitude, longitude, heading);
    this.cb.onPositionUpdate(latitude, longitude, heading, speed);

    if (initial) {
      try { this.map.setView([latitude, longitude], this.map.getZoom() || 17, { animate: false }); } catch(e) {}
    }

    this._evaluateProximity(current);
    this._evaluateOffRoute(current);
  }

  _evaluateProximity(p) {
    const stop = this.route.stops[this.activeIdx];
    if (!stop) return;
    const d = haversine(p, { lat: stop.lat, lon: stop.lon });

    // Caption (always shown when nearer than PROX_NEAR; hidden otherwise)
    if (d < PROX_NEAR) {
      this.captionEl.style.display = 'block';
      const bearing = this._bearingHint(p, stop);
      this.captionEl.textContent = `${Math.round(d)}m to ${stop.name || 'next stop'} ${bearing}`.trim();
    } else {
      this.captionEl.style.display = 'none';
    }

    if (d < PROX_ARRIVE) {
      if (this.arrivedAtActiveAt == null) {
        this.arrivedAtActiveAt = Date.now();
        this.cb.onArrival(stop);
        if (navigator.vibrate) try { navigator.vibrate([20, 30, 20]); } catch(e) {}
        this._showArriveTapTarget(stop);
        // Auto-advance if dwell on previous was long enough
        const dwellOnPrev = this.arrivedAtActiveAt - this.lastAdvanceAt;
        if (this.activeIdx > 0 && dwellOnPrev > DWELL_AUTOADV) {
          // mark visited and advance
          this._completeActiveAndAdvance();
        }
      }
    } else if (d < PROX_CLOSE) {
      this.cb.onProximity(stop, d);
      this._showProximityToast(stop, d);
    } else {
      this._hideProximityToast();
      this._hideArriveTapTarget();
      this.arrivedAtActiveAt = null;
    }
  }

  _bearingHint(from, to) {
    const dLon = toRad(to.lon - from.lon);
    const y = Math.sin(dLon) * Math.cos(toRad(to.lat));
    const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
              Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLon);
    let brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const arrows = ['↑','↗','→','↘','↓','↙','←','↖'];
    return arrows[Math.round(brng / 45) % 8];
  }

  _evaluateOffRoute(p) {
    const d = distToPolyline(p, this.route.stops);
    if (d > OFFROUTE_DIST) {
      if (this.offRouteSince == null) this.offRouteSince = Date.now();
      if (Date.now() - this.offRouteSince > OFFROUTE_TIME) this._showOffRoute();
    } else {
      this.offRouteSince = null;
      this._hideOffRoute();
    }
  }

  // ---------- toast / tap-target / off-route UI ----------
  _showProximityToast(stop, d) {
    const bearing = this.lastPos ? this._bearingHint(this.lastPos, stop) : '';
    this.toastEl.innerHTML = `<strong>You're close</strong> — ${this._escape(stop.name)} in ${Math.round(d)}m ${bearing}`;
    this.toastEl.style.display = 'block';
  }
  _hideProximityToast() { this.toastEl.style.display = 'none'; }

  _showArriveTapTarget(stop) {
    this.arriveEl.dataset.stopIdx = String(this.activeIdx);
    this.arriveEl.innerHTML = `I'm here — show me why <span aria-hidden="true">→</span>`;
    this.arriveEl.style.display = 'block';
  }
  _hideArriveTapTarget() { this.arriveEl.style.display = 'none'; }

  _handleArriveTap() {
    this._completeActiveAndAdvance();
  }

  _completeActiveAndAdvance() {
    const idx = this.activeIdx;
    if (!this.visited.has(idx)) {
      this.visited.add(idx);
      const s = this.route.stops[idx];
      this.summary.stopsVisited.push({
        idx, id: s.id, name: s.name, lat: s.lat, lon: s.lon, atMs: Date.now() - this.summary.startedAt
      });
    }
    this._hideArriveTapTarget();
    if (idx < this.route.stops.length - 1) {
      this.advanceTo(idx + 1);
    } else {
      this._refreshStopStates();
      this.cb.onProgress(idx, this.route.stops.length);
    }
  }

  _showOffRoute() {
    if (this.offRouteEl.style.display === 'block') return;
    this.offRouteEl.innerHTML = `
      <div class="we-walk-tracker__offroute-text">You're off route.</div>
      <div class="we-walk-tracker__offroute-actions">
        <button data-action="keep">Keep walking</button>
        <button data-action="recalc">Recalculate</button>
        <button data-action="finish">Finish here</button>
      </div>`;
    this.offRouteEl.style.display = 'block';
    this.offRouteEl.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', (ev) => {
        const a = ev.currentTarget.dataset.action;
        if (a === 'keep') { this._hideOffRoute(); this.offRouteSince = Date.now(); }
        else if (a === 'recalc') { this._hideOffRoute(); this.cb.onProgress(this.activeIdx, this.route.stops.length); /* integrator may recalc */ }
        else if (a === 'finish') { this._hideOffRoute(); this.stop(); }
      }, { once: true });
    });
  }
  _hideOffRoute() { if (this.offRouteEl) this.offRouteEl.style.display = 'none'; }

  _showToast(text, opts = {}) {
    this.toastEl.innerHTML = this._escape(text);
    this.toastEl.style.display = 'block';
    if (opts.transient) setTimeout(() => { if (this.toastEl) this.toastEl.style.display = 'none'; }, 4000);
  }

  _escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ---------- public methods ----------
  recenter() {
    if (this.lastPos && this.map) {
      try { this.map.panTo([this.lastPos.lat, this.lastPos.lon], { animate: true }); } catch(e) {}
    }
  }

  advanceTo(idx) {
    if (idx < 0 || idx >= this.route.stops.length) return;
    this.activeIdx = idx;
    this.lastAdvanceAt = Date.now();
    this.arrivedAtActiveAt = null;
    this._hideArriveTapTarget();
    this._hideProximityToast();
    this._refreshStopStates();
    this.cb.onProgress(idx, this.route.stops.length);
  }

  pause() {
    this.paused = true;
    this._stopWatch();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this._startWatch();
  }

  stop() {
    this._stopWatch();
    clearTimeout(this.retryTimer);
    this.summary.endedAt = Date.now();
    this.summary.durationMs = this.summary.endedAt - this.summary.startedAt;
    this._teardownUI();
  }

  _teardownUI() {
    [this.captionEl, this.toastEl, this.arriveEl, this.offRouteEl].forEach((n) => {
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
    this.captionEl = this.toastEl = this.arriveEl = this.offRouteEl = null;
  }

  getSummary() {
    const now = Date.now();
    const dur = (this.summary.endedAt || now) - this.summary.startedAt;
    return {
      startedAt: this.summary.startedAt,
      endedAt: this.summary.endedAt,
      durationMs: dur,
      metersWalked: Math.round(this.summary.metersWalked),
      peakSpeed: Number(this.summary.peakSpeed.toFixed(2)),
      stopsVisited: this.summary.stopsVisited.slice(),
      totalStops: this.route.stops.length
    };
  }
}

export default { start };
