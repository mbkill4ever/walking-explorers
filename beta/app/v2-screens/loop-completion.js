/**
 * Walking Explorers v2 — Loop Completion sequence
 * ------------------------------------------------
 * Owner: Loop-completion-redesign agent
 * Files: loop-completion.{html,css,js}
 *
 * Public API:
 *   LoopCompletion.show(loopData)
 *     loopData = {
 *       route       : [[lat, lng], ...]   // optional polyline
 *       stops       : [{ name, lat, lng }]
 *       photos      : [{ blob | url, lat, lng, caption }]  // optional
 *       duration    : number  // seconds
 *       miles       : number
 *       neighborhood: string
 *       title       : string
 *       slug        : string  // for share URL
 *     }
 *
 * Reduced motion:
 *   Honored at every stage — the sequence collapses to its final frame.
 *
 * Defensive design:
 *   - Works without Leaflet (falls back to inline SVG polyline)
 *   - Works without navigator.share (copies link + downloads PNG)
 *   - Works without /api/loops/journal (silently no-ops + console.info)
 *   - Works without v2-styles SVG sprites (uses inline fallback paths/circles)
 */

const REDUCED_MOTION = typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const BRAND = {
  navy:     '#1F3864',
  navyDeep: '#0E1B30',
  gold:     '#E0B341',
  goldSoft: '#F2D67D',
  cream:    '#FAF7F2',
  cream2:   '#F4EFE6',
};

const SHARE_BASE = 'https://walkingexplorers.com/loop/';

/* ============================================================
   Utilities
   ============================================================ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Easing function — matches --ease-out cubic-bezier(.16, 1, .3, 1). */
function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

/** Promise-based delay. */
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** Format seconds as "1h 30m" or "45m". */
function formatHM(totalSeconds) {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Project [[lat, lng], ...] to SVG viewBox coordinates (320 x 200). */
function projectRoute(coords, w = 320, h = 200, pad = 20) {
  if (!coords || coords.length === 0) return { points: [], path: '' };
  let minLat =  90, maxLat = -90, minLng =  180, maxLng = -180;
  coords.forEach(([lat, lng]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  });
  const dLat = Math.max(maxLat - minLat, 1e-6);
  const dLng = Math.max(maxLng - minLng, 1e-6);
  // Lock aspect by using the larger delta so the route doesn't stretch.
  const scale = Math.min((w - pad * 2) / dLng, (h - pad * 2) / dLat);
  const offX = (w - dLng * scale) / 2;
  const offY = (h - dLat * scale) / 2;
  const points = coords.map(([lat, lng]) => ([
    offX + (lng - minLng) * scale,
    offY + (maxLat - lat) * scale,  // invert Y so north is up
  ]));
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
  return { points, path };
}


/* ============================================================
   The public object
   ============================================================ */

export const LoopCompletion = {

  /** Show the screen and run the full sequence. */
  async show(loopData) {
    const data = this._normalize(loopData);
    this._lastData = data;
    const root = $('#loop-v2');
    if (!root) {
      console.warn('[loop-completion] #loop-v2 not in DOM');
      return;
    }

    // 1. Mount + announce.
    root.hidden = false;
    root.dataset.phase = 'idle';
    const live = $('#loop-v2-live', root);
    if (live) live.textContent =
      `Walk complete. ${data.miles.toFixed(1)} miles. ${data.stops.length} stops. ${formatHM(data.duration)}.`;

    // Wire CTAs once per show().
    this._wireActions(root, data);
    this._wireJournal(root);
    this._wireSkipLink(root);

    if (REDUCED_MOTION) {
      // Skip the show — paint the final frame and we're done.
      root.dataset.phase = 'done';
      this._setStatValues(root, data);
      this._drawMapRecap($('[data-loop-map]', root), data);
      await this._renderCardPreview(root, data);
      return;
    }

    // 2. PHASE 1 — celebrate (confetti + headline + stats).
    root.dataset.phase = 'celebrate';
    const canvas = $('.loop-confetti', root);
    this._confetti(canvas);
    this._animateStats($$('[data-count]', root), data, 1200);
    await wait(1400);

    // 3. PHASE 2 — recap (map + photos).
    root.dataset.phase = 'recap';
    this._drawMapRecap($('[data-loop-map]', root), data);
    await wait(1800);

    // 4. PHASE 3 — share.
    root.dataset.phase = 'share';
    await this._renderCardPreview(root, data);
    await wait(200);
    root.dataset.phase = 'done';
  },

  /** Hide the screen. */
  hide() {
    const root = $('#loop-v2');
    if (root) {
      root.hidden = true;
      root.dataset.phase = 'idle';
    }
  },


  /* ----------------------------------------------------------
     Data normalization
     ---------------------------------------------------------- */
  _normalize(d = {}) {
    return {
      route:        Array.isArray(d.route) ? d.route : [],
      stops:        Array.isArray(d.stops) ? d.stops : [],
      photos:       Array.isArray(d.photos) ? d.photos : [],
      duration:     Number(d.duration) || 0,
      miles:        Number(d.miles) || 0,
      neighborhood: String(d.neighborhood || ''),
      title:        String(d.title || 'Untitled loop'),
      slug:         String(d.slug || 'loop'),
    };
  },


  /* ----------------------------------------------------------
     Phase 1 — Confetti
     ---------------------------------------------------------- */
  _confetti(canvas) {
    if (!canvas || REDUCED_MOTION) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width  = canvas.clientWidth  * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize, { once: true });

    const colors = [BRAND.navy, BRAND.gold, BRAND.goldSoft, BRAND.cream];
    const cx = canvas.clientWidth  / 2;
    const cy = canvas.clientHeight / 2;
    const N  = Math.min(140, Math.floor(canvas.clientWidth / 4));
    const particles = [];
    for (let i = 0; i < N; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 9;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,    // bias upward
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 8,
        h: 3 + Math.random() * 6,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
      });
    }

    const G = 0.35;           // gravity per frame
    const DRAG = 0.985;       // air resistance
    const maxLife = 110;      // ~1.8s @ 60fps

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      let alive = false;
      for (const p of particles) {
        p.life++;
        if (p.life > maxLife) continue;
        alive = true;
        p.vx *= DRAG;
        p.vy = p.vy * DRAG + G;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - p.life / maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    };
    raf = requestAnimationFrame(tick);
  },


  /* ----------------------------------------------------------
     Phase 1 — Count-up stats
     ---------------------------------------------------------- */
  _animateStats(elements, data, duration = 1200) {
    if (!elements || !elements.length) return;
    elements.forEach((el) => {
      const fmt = el.dataset.countFormat;
      const decimals = parseInt(el.dataset.countDecimals || '0', 10);
      const target =
        fmt === 'hm'           ? data.duration :
        decimals > 0           ? data.miles    :
        /* default integer */    data.stops.length;
      el.dataset.countTarget = String(target);
    });

    if (REDUCED_MOTION) {
      this._setStatValues(elements[0].closest('.loop-screen'), data);
      return;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutExpo(t);
      elements.forEach((el) => {
        const target = parseFloat(el.dataset.countTarget) || 0;
        const fmt = el.dataset.countFormat;
        const decimals = parseInt(el.dataset.countDecimals || '0', 10);
        const v = target * eased;
        el.textContent =
          fmt === 'hm' ? formatHM(v) :
          v.toFixed(decimals);
      });
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  _setStatValues(root, data) {
    if (!root) return;
    $$('[data-count]', root).forEach((el) => {
      const fmt = el.dataset.countFormat;
      const decimals = parseInt(el.dataset.countDecimals || '0', 10);
      if (fmt === 'hm') {
        el.textContent = formatHM(data.duration);
      } else if (decimals > 0) {
        el.textContent = data.miles.toFixed(decimals);
      } else {
        el.textContent = String(data.stops.length);
      }
    });
  },


  /* ----------------------------------------------------------
     Phase 2 — Map recap (Leaflet if available, SVG fallback otherwise)
     ---------------------------------------------------------- */
  _drawMapRecap(container, data) {
    if (!container) return;
    const route = data.route.length ? data.route :
      data.stops.map((s) => [s.lat, s.lng]).filter(([lat, lng]) =>
        Number.isFinite(lat) && Number.isFinite(lng));

    const nudge = container.parentElement && container.parentElement.querySelector('[data-loop-nudge]');
    if (nudge) nudge.hidden = data.photos.length > 0;

    if (typeof window !== 'undefined' && window.L && route.length > 1) {
      try {
        this._drawLeafletRecap(container, route, data);
        return;
      } catch (err) {
        console.warn('[loop-completion] leaflet failed, using fallback', err);
      }
    }

    this._drawSvgRecap(container, route, data);
  },

  _drawLeafletRecap(container, route, data) {
    const svg = container.querySelector('.loop-map__fallback');
    if (svg) svg.style.display = 'none';

    let mapEl = container.querySelector('[data-leaflet-mount]');
    if (!mapEl) {
      mapEl = document.createElement('div');
      mapEl.setAttribute('data-leaflet-mount', '');
      mapEl.style.cssText = 'position:absolute;inset:0;border-radius:inherit;';
      container.appendChild(mapEl);
    }
    const map = window.L.map(mapEl, {
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, tap: false, touchZoom: false,
    });
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);
    const poly = window.L.polyline(route, {
      color: BRAND.gold, weight: 4, opacity: 0.95, lineJoin: 'round',
    }).addTo(map);
    map.fitBounds(poly.getBounds(), { padding: [20, 20] });

    data.stops.forEach((s) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
      const marker = window.L.circleMarker([s.lat, s.lng], {
        radius: 6, color: BRAND.cream, fillColor: BRAND.gold,
        fillOpacity: 1, weight: 2,
      }).addTo(map);
      if (s.name) marker.bindTooltip(s.name);
    });
  },

  _drawSvgRecap(container, route, data) {
    const svg = container.querySelector('.loop-map__fallback');
    if (!svg) return;
    const path = svg.querySelector('.loop-map__route');
    const markersG = svg.querySelector('.loop-map__markers');
    const photosG  = svg.querySelector('.loop-map__photos');
    if (!path) return;

    const W = 320, H = 200;
    const { path: d } = projectRoute(route, W, H, 24);
    path.setAttribute('d', d || '');
    try {
      const len = path.getTotalLength ? path.getTotalLength() : 1000;
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
      requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
    } catch (_) { /* no-op */ }

    if (markersG) {
      markersG.innerHTML = '';
      const stopCoords = data.stops
        .map((s) => [s.lat, s.lng])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
      const mk = projectRoute(stopCoords, W, H, 24).points;
      mk.forEach((p, i) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('class', 'loop-map__marker');
        c.setAttribute('cx', p[0]);
        c.setAttribute('cy', p[1]);
        c.setAttribute('r', '5');
        c.setAttribute('fill', BRAND.gold);
        c.setAttribute('stroke', BRAND.cream);
        c.setAttribute('stroke-width', '2');
        c.style.animationDelay = `${800 + i * 60}ms`;
        markersG.appendChild(c);
      });
    }

    if (photosG) {
      photosG.innerHTML = '';
      const photoCoords = data.photos
        .map((p) => [p.lat, p.lng])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
      const positions = projectRoute(photoCoords, W, H, 24).points;
      data.photos.forEach((photo, i) => {
        const p = positions[i];
        if (!p) return;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'loop-map__photo');
        g.setAttribute('transform', `translate(${p[0] - 14},${p[1] - 22}) rotate(-6 14 14)`);
        g.style.animationDelay = `${1200 + i * 120}ms`;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', '28');
        rect.setAttribute('height', '32');
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', BRAND.cream);
        rect.setAttribute('stroke', 'rgba(0,0,0,0.18)');
        rect.setAttribute('stroke-width', '0.5');
        g.appendChild(rect);
        const src = photo.url || (photo.blob && URL.createObjectURL(photo.blob));
        if (src) {
          const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
          img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', src);
          img.setAttribute('href', src);
          img.setAttribute('x', '2');
          img.setAttribute('y', '2');
          img.setAttribute('width', '24');
          img.setAttribute('height', '22');
          img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
          g.appendChild(img);
        } else {
          const ph = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          ph.setAttribute('x', '2'); ph.setAttribute('y', '2');
          ph.setAttribute('width', '24'); ph.setAttribute('height', '22');
          ph.setAttribute('fill', BRAND.cream2);
          g.appendChild(ph);
        }
        photosG.appendChild(g);
      });
    }
  },


  /* ----------------------------------------------------------
     Phase 3 — Share card generation
     ---------------------------------------------------------- */

  async _renderCardPreview(root, data) {
    const previewCanvas = $('.loop-card__canvas', root);
    if (!previewCanvas) return;
    await this._paintCard(previewCanvas, data, 540, 675);
  },

  async _generateShareCard(loopData) {
    const data = this._normalize(loopData);
    const off = document.createElement('canvas');
    off.width = 1080;
    off.height = 1350;
    await this._paintCard(off, data, 1080, 1350);
    return new Promise((resolve) => off.toBlob(resolve, 'image/png', 0.95));
  },

  async _paintCard(canvas, data, W, H) {
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const scale = W / 1080;
    const s = (n) => n * scale;

    // Background gradient.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,    BRAND.navy);
    grad.addColorStop(0.6,  '#162B4A');
    grad.addColorStop(1,    BRAND.navyDeep);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Gold radial glow top-center.
    const glow = ctx.createRadialGradient(W / 2, s(120), s(40), W / 2, s(120), s(560));
    glow.addColorStop(0, 'rgba(224,179,65,0.30)');
    glow.addColorStop(1, 'rgba(224,179,65,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Skyline silhouette at the bottom.
    this._drawSkyline(ctx, W, H, scale);

    // Hero photo collage / fallback.
    await this._drawHero(ctx, data, W, scale);

    // Stats row.
    const statsY = s(720);
    ctx.fillStyle = BRAND.gold;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 ${s(96)}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const cols = [
      `${data.miles.toFixed(1)} mi`,
      `${data.stops.length} stops`,
      formatHM(data.duration),
    ];
    const colW = W / 3;
    cols.forEach((txt, i) => {
      ctx.fillText(txt, colW * i + colW / 2, statsY);
    });
    ctx.fillStyle = BRAND.cream2;
    ctx.font = `500 ${s(22)}px Inter, sans-serif`;
    ['Miles', 'Stops', 'Time'].forEach((label, i) => {
      ctx.fillText(label.toUpperCase(), colW * i + colW / 2, statsY + s(36));
    });

    // Route title + neighborhood.
    ctx.fillStyle = BRAND.cream;
    ctx.font = `600 ${s(36)}px Inter, sans-serif`;
    this._wrapText(ctx, data.title, W / 2, s(870), W - s(120), s(48));
    if (data.neighborhood) {
      ctx.fillStyle = BRAND.gold;
      ctx.font = `500 ${s(22)}px Inter, sans-serif`;
      ctx.fillText(data.neighborhood.toUpperCase(), W / 2, s(940));
    }

    // Footer: wordmark + QR.
    ctx.fillStyle = BRAND.cream2;
    ctx.font = `600 ${s(20)}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('walkingexplorers.com', s(72), H - s(80));
    this._drawQrPlaceholder(ctx, W - s(160), H - s(160), s(96), SHARE_BASE + data.slug);

    // Top-left brand mark.
    ctx.fillStyle = BRAND.gold;
    ctx.beginPath();
    ctx.arc(s(72), s(72), s(14), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = BRAND.cream;
    ctx.font = `700 ${s(22)}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('Walking Explorers', s(100), s(80));
  },

  async _drawHero(ctx, data, W, scale) {
    const s = (n) => n * scale;
    const x = s(72), y = s(140), w = W - s(144), h = s(520);
    ctx.save();
    this._roundRect(ctx, x, y, w, h, s(28));
    ctx.clip();

    const photos = data.photos
      .map((p) => p.url || (p.blob && URL.createObjectURL(p.blob)))
      .filter(Boolean)
      .slice(0, 4);

    if (photos.length === 0) {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#2C4A7E');
      g.addColorStop(1, '#1F3864');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(224,179,65,0.5)';
      ctx.font = `500 ${s(20)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('A LOOP THROUGH', x + w / 2, y + h / 2 - s(20));
      ctx.fillStyle = BRAND.cream;
      ctx.font = `700 ${s(44)}px Inter, sans-serif`;
      ctx.fillText((data.neighborhood || 'the city').toUpperCase(), x + w / 2, y + h / 2 + s(40));
    } else {
      const tiles = this._tileLayout(photos.length, x, y, w, h, s(6));
      await Promise.all(photos.map((src, i) => this._drawImageTile(ctx, src, tiles[i])));
    }

    ctx.restore();
    ctx.strokeStyle = 'rgba(224,179,65,0.7)';
    ctx.lineWidth = s(2);
    this._roundRect(ctx, x, y, w, h, s(28));
    ctx.stroke();
  },

  _drawImageTile(ctx, src, tile) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const { x, y, w, h } = tile;
        const ar  = img.width / img.height;
        const tAr = w / h;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (ar > tAr) {
          sw = img.height * tAr;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / tAr;
          sy = (img.height - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
        resolve();
      };
      img.onerror = () => {
        ctx.fillStyle = '#2C4A7E';
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        resolve();
      };
      img.src = src;
    });
  },

  _tileLayout(n, x, y, w, h, gap) {
    if (n === 1) return [{ x, y, w, h }];
    if (n === 2) {
      const tw = (w - gap) / 2;
      return [
        { x, y, w: tw, h },
        { x: x + tw + gap, y, w: tw, h },
      ];
    }
    if (n === 3) {
      const tw = (w - gap) / 2;
      const th = (h - gap) / 2;
      return [
        { x, y, w: tw, h },
        { x: x + tw + gap, y, w: tw, h: th },
        { x: x + tw + gap, y: y + th + gap, w: tw, h: th },
      ];
    }
    const tw = (w - gap) / 2;
    const th = (h - gap) / 2;
    return [
      { x, y, w: tw, h: th },
      { x: x + tw + gap, y, w: tw, h: th },
      { x, y: y + th + gap, w: tw, h: th },
      { x: x + tw + gap, y: y + th + gap, w: tw, h: th },
    ];
  },

  _drawSkyline(ctx, W, H, scale) {
    const s = (n) => n * scale;
    ctx.fillStyle = BRAND.navyDeep;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - s(60));
    const buildings = [
      [80, 100], [60, 70], [120, 130], [80, 90], [100, 150],
      [70, 80],  [140, 110], [90, 60], [100, 95], [110, 130],
      [70, 85],  [130, 100], [90, 70], [120, 120],
    ];
    let x = 0, i = 0;
    while (x < W) {
      const [bw, bh] = buildings[i % buildings.length];
      ctx.lineTo(x,         H - s(60) - s(bh));
      ctx.lineTo(x + s(bw), H - s(60) - s(bh));
      x += s(bw);
      i++;
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  },

  _drawQrPlaceholder(ctx, x, y, size, url) {
    ctx.save();
    ctx.fillStyle = BRAND.cream;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = BRAND.navyDeep;
    const m = size * 0.22;
    [[0,0], [size - m, 0], [0, size - m]].forEach(([dx, dy]) => {
      ctx.fillRect(x + dx, y + dy, m, m);
      ctx.fillStyle = BRAND.cream;
      ctx.fillRect(x + dx + m*0.25, y + dy + m*0.25, m*0.5, m*0.5);
      ctx.fillStyle = BRAND.navyDeep;
    });
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
    const cells = 9, cs = size / cells;
    for (let yy = 0; yy < cells; yy++) {
      for (let xx = 0; xx < cells; xx++) {
        const inMarker =
          (xx < 3 && yy < 3) ||
          (xx > cells - 4 && yy < 3) ||
          (xx < 3 && yy > cells - 4);
        if (inMarker) continue;
        h = (h * 1103515245 + 12345) & 0x7fffffff;
        if ((h & 1) === 0) continue;
        ctx.fillRect(x + xx * cs + cs * 0.1, y + yy * cs + cs * 0.1, cs * 0.8, cs * 0.8);
      }
    }
    ctx.restore();
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  },

  _wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(/\s+/);
    let line = '';
    let yy = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = words[i];
        yy += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  },


  /* ----------------------------------------------------------
     Share, invite, walk-another wiring
     ---------------------------------------------------------- */
  _wireActions(root, data) {
    if (root._actionsWired) {
      root._actionsData = data;
      return;
    }
    root._actionsData = data;
    root._actionsWired = true;
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-loop-action]');
      if (!btn) return;
      const action = btn.dataset.loopAction;
      const d = root._actionsData || data;
      const url = SHARE_BASE + d.slug;
      if (action === 'share') {
        const blob = await this._generateShareCard(d);
        await this._shareCard(blob, d.title, url);
      } else if (action === 'invite') {
        await this._invite(d);
      } else if (action === 'walk-another') {
        this.hide();
        window.dispatchEvent(new CustomEvent('walking-explorers:walk-another'));
      }
    });
  },

  async _shareCard(blob, title, url) {
    const text = `${title} — a loop with Walking Explorers.`;
    if (blob && navigator.canShare && navigator.canShare({ files: [
      new File([blob], 'walking-explorers-loop.png', { type: 'image/png' })
    ]})) {
      try {
        await navigator.share({
          title, text, url,
          files: [ new File([blob], 'walking-explorers-loop.png', { type: 'image/png' }) ],
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.warn('[loop-completion] share failed', err);
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try { await navigator.clipboard.writeText(url); } catch (_) {}
    if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'walking-explorers-loop.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    this._toast('Link copied. Image downloaded.');
  },

  async _invite(data) {
    let code = 'WE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    try {
      const r = await fetch('/api/loops/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: data.slug }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.code) code = j.code;
      }
    } catch (_) { /* offline / endpoint missing */ }

    const url = `${SHARE_BASE}${data.slug}?ref=${encodeURIComponent(code)}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Walk this loop with me',
          text:  `Join me on Walking Explorers — use ${code} for a free week.`,
          url,
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try { await navigator.clipboard.writeText(url); } catch (_) {}
    this._toast(`Invite link copied — code ${code}`);
  },


  /* ----------------------------------------------------------
     Journal note
     ---------------------------------------------------------- */
  _wireJournal(root) {
    const form = $('[data-loop-journal]', root);
    if (!form || form._wired) return;
    form._wired = true;
    const hint = $('[data-loop-journal-hint]', form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('textarea', form).value.trim();
      if (!text) return;
      const ok = await this._saveJournalNote(text);
      if (hint) hint.textContent = ok ? 'Saved.' : 'Saved locally.';
    });
  },

  async _saveJournalNote(text) {
    try {
      const r = await fetch('/api/loops/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: text, at: Date.now() }),
      });
      if (r.ok) return true;
    } catch (_) { /* fall through */ }
    try {
      const key = 'we:journal';
      const cur = JSON.parse(localStorage.getItem(key) || '[]');
      cur.push({ note: text, at: Date.now() });
      localStorage.setItem(key, JSON.stringify(cur));
    } catch (_) {}
    console.info('[loop-completion] journal saved to localStorage fallback');
    return false;
  },


  /* ----------------------------------------------------------
     Skip link
     ---------------------------------------------------------- */
  _wireSkipLink(root) {
    const skip = $('[data-loop-skip]', root);
    if (!skip || skip._wired) return;
    skip._wired = true;
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      root.dataset.phase = 'done';
      this._setStatValues(root, this._lastData || { miles: 0, stops: [], duration: 0 });
      const card = $('#loop-v2-card', root);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  },


  /* ----------------------------------------------------------
     Tiny in-screen toast (does not interfere with global toasts)
     ---------------------------------------------------------- */
  _toast(msg) {
    const root = $('#loop-v2');
    if (!root) return;
    let t = root.querySelector('.loop-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'loop-toast';
      t.setAttribute('role', 'status');
      t.style.cssText = `
        position: fixed; left: 50%; bottom: calc(env(safe-area-inset-bottom) + 24px);
        transform: translateX(-50%); padding: 10px 16px;
        background: var(--color-navy-300); color: var(--color-cream);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 100px; font-size: 13px; font-weight: 500;
        box-shadow: var(--shadow-2); z-index: 10000;
        opacity: 0; transition: opacity 200ms ease;`;
      root.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2400);
  },
};

// Convenience: also expose on window for non-module callers.
if (typeof window !== 'undefined') {
  window.LoopCompletion = LoopCompletion;
}

export default LoopCompletion;
