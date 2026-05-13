/* ============================================================================
   Walking Explorers v2 — Photo Capture Screen Controller
   Owned by: photo-capture redesign agent.
   Pairs with: capture.html, capture.css
   Public surface: CaptureV2.open(stop, route) / CaptureV2.close()
   ============================================================================ */

/**
 * Filter library — single source of truth for both CSS preview classes
 * and the canvas .filter property used when baking the filter into the
 * exported image. Values must match capture.css's .filter-* declarations.
 */
const FILTERS = {
  none:      { label: 'None',      css: '' },
  navy:      { label: 'Navy',      css: 'contrast(1.05) saturate(0.9) hue-rotate(-5deg)' },
  editorial: { label: 'Editorial', css: 'contrast(1.1) saturate(0.7) sepia(0.15) brightness(0.98)' },
  cream:     { label: 'Cream',     css: 'brightness(1.05) contrast(0.95) saturate(0.85) sepia(0.1)' },
  punch:     { label: 'Punch',     css: 'contrast(1.15) saturate(1.2) brightness(1.02)' },
};

/** Server-side photo cap: 350 KB base64. We aim well under to leave headroom. */
const MAX_WIDTH        = 640;
const TARGET_QUALITY   = 0.82;
const MAX_PHOTO_BYTES  = 320 * 1024;

const DEFAULT_STATE = () => ({
  // Photo
  photoData:    null,      // raw (unfiltered) data URL — kept so re-filter doesn't degrade
  photoBaked:   null,      // filter-baked data URL — what gets POSTed
  photoNaturalW: 0,
  photoNaturalH: 0,
  filter:       'none',
  stickers:     [],        // [{id, glyph, x, y}]

  // Tagging
  moods:        new Set(),
  rating:       null,
  notes:        '',

  // Context
  stopName:     null,
  neighborhood: null,
  routeId:      null,
  addToArchive: true,

  // GPS
  lat:          null,
  lon:          null,
  gpsState:     'pending',  // pending | locked | error
  capturedAt:   null,
});

/** Internal element refs — populated by _cacheEls() on first open. */
const els = {};

/** Tiny no-op fallback Toast if the app's global Toast hasn't loaded. */
const Toast = (typeof window !== 'undefined' && window.Toast) || {
  show(msg) { try { console.log('[CaptureV2.toast]', msg); } catch {} },
};

/** Tiny API shim — prefers the app's global API.spotsSave. */
const API = (typeof window !== 'undefined' && window.API) ? window.API : {
  async spotsSave(payload) {
    const r = await fetch('/api/spots/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('save_failed:' + r.status);
    return r.json();
  },
};

/** Geolocation wrapper — resolves with {lat, lon} or rejects. */
function locate(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no_geo'));
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(new Error('geo_timeout')); } }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => { if (done) return; done = true; clearTimeout(t); resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      (e) => { if (done) return; done = true; clearTimeout(t); reject(e); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

/** Format a Date as a friendly 12-h time string. */
function fmtTime(d) {
  try {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

/* ============================================================================
   Public controller
   ============================================================================ */
export const CaptureV2 = {
  state: DEFAULT_STATE(),

  /**
   * Open the capture screen.
   * @param {{name?: string}} stop
   * @param {{id?: string, nbhd?: string, neighborhood?: string}} route
   */
  open(stop = {}, route = {}) {
    const root = document.getElementById('captureV2');
    if (!root) {
      console.warn('[CaptureV2] #captureV2 not in DOM');
      return;
    }
    this._cacheEls();

    this.state = DEFAULT_STATE();
    this.state.stopName     = stop.name || stop.stopName || 'Unnamed spot';
    this.state.routeId      = route.id || route.routeId || null;
    this.state.neighborhood = route.nbhd || route.neighborhood || null;
    this.state.capturedAt   = new Date();

    this._render();
    this._bind();
    this._startGps();

    // Remember focus owner so we can return on close.
    this._prevFocus = document.activeElement;

    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => root.classList.add('active'));

    // Lock background scroll (mobile Safari rubber-band fix).
    this._bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Initial focus -> close button (so Esc / Tab discoverable).
    setTimeout(() => els.close && els.close.focus({ preventScroll: true }), 80);
    this._announce('Capture screen opened. Tap to take a photo, or skip to add details without one.');
  },

  /**
   * Close the capture screen and clean up.
   */
  close() {
    const root = document.getElementById('captureV2');
    if (!root) return;
    root.classList.remove('active');
    root.classList.add('closing');
    setTimeout(() => {
      root.classList.remove('closing');
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      this._unbind();
      document.body.style.overflow = this._bodyOverflow || '';
      if (this._prevFocus && this._prevFocus.focus) this._prevFocus.focus({ preventScroll: true });
    }, 320);
  },

  /* ---------------------------------------------------------------------- *
     Filters & stickers
   * ---------------------------------------------------------------------- */
  setFilter(name) {
    if (!FILTERS[name]) return;
    this.state.filter = name;
    this._applyFilter();
    // Update aria + selected state on filter chips.
    document.querySelectorAll('#capV2Filters .filter-chip').forEach((chip) => {
      const sel = chip.dataset.filter === name;
      chip.classList.toggle('selected', sel);
      chip.setAttribute('aria-checked', String(sel));
    });
    this._announce(`Filter ${FILTERS[name].label} applied`);
  },

  _applyFilter() {
    if (!els.photoFrame) return;
    // Reset filter classes on frame.
    Object.keys(FILTERS).forEach((k) => els.photoFrame.classList.remove('filter-' + k));
    els.photoFrame.classList.add('filter-' + this.state.filter);
  },

  toggleMood(name) {
    if (!name) return;
    if (this.state.moods.has(name)) this.state.moods.delete(name);
    else this.state.moods.add(name);
    const btn = document.querySelector(`.mood-pill[data-mood="${CSS.escape(name)}"]`);
    if (btn) btn.setAttribute('aria-pressed', String(this.state.moods.has(name)));
  },

  setRating(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1 || n > 4) return;
    this.state.rating = n;
    document.querySelectorAll('#capV2Rating .rating-pill').forEach((pill) => {
      pill.setAttribute('aria-checked', String(Number(pill.dataset.rating) === n));
    });
  },

  addSticker(glyph, label) {
    const layer = els.stickerLayer;
    if (!layer || !glyph) return;
    const id = 'sticker_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const node = document.createElement('span');
    node.className = 'sticker-placed';
    if (label === 'Nbhd') {
      node.classList.add('is-nbhd-badge');
      node.textContent = this.state.neighborhood || 'Nbhd';
    } else if (label === 'Route') {
      node.classList.add('is-route-badge');
      node.textContent = this.state.routeId ? 'On route' : 'My route';
    } else {
      node.textContent = glyph;
    }
    // Place near the centre with a small random offset.
    const dx = (Math.random() - 0.5) * 30;
    const dy = (Math.random() - 0.5) * 30;
    node.style.left = `calc(50% + ${dx}px)`;
    node.style.top  = `calc(50% + ${dy}px)`;
    node.style.transform = 'translate(-50%, -50%)';
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', `Sticker: ${label}`);
    layer.appendChild(node);
    this.state.stickers.push({ id, glyph, label });
  },

  /* ---------------------------------------------------------------------- *
     File / camera input
   * ---------------------------------------------------------------------- */
  async _onFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      Toast.show('Please choose an image file');
      return;
    }
    // Fire capture flash for tactile feedback.
    this._flash();

    try {
      const raw = await this._readResize(file, MAX_WIDTH, TARGET_QUALITY);
      this.state.photoData = raw.dataUrl;
      this.state.photoNaturalW = raw.w;
      this.state.photoNaturalH = raw.h;
      this._showPhoto(raw.dataUrl);
      this._paintFilterThumbs(raw.dataUrl);
      this._announce('Photo captured');
    } catch (e) {
      console.warn('[CaptureV2] file read failed', e);
      Toast.show('Couldn’t read that photo');
    } finally {
      // Allow re-selecting the same file.
      if (ev.target) ev.target.value = '';
    }
  },

  /**
   * Read + resize + JPEG-compress a file into a data URL.
   * No filter applied here; filter is baked at save time.
   */
  _readResize(file, maxW, quality) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error);
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('img_decode_failed'));
        img.onload = () => {
          try {
            const scale = Math.min(1, maxW / img.naturalWidth);
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            let dataUrl = c.toDataURL('image/jpeg', quality);

            // Step down quality until below the server cap.
            let q = quality;
            while (dataUrl.length > MAX_PHOTO_BYTES && q > 0.45) {
              q -= 0.08;
              dataUrl = c.toDataURL('image/jpeg', q);
            }
            resolve({ dataUrl, w, h });
          } catch (err) { reject(err); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  },

  /**
   * Bake the currently-selected CSS filter into a fresh data URL.
   * Returns the unfiltered raw if no photo or no filter.
   */
  _bakeFilter() {
    const raw = this.state.photoData;
    if (!raw) return null;
    const cssFilter = FILTERS[this.state.filter] && FILTERS[this.state.filter].css;
    if (!cssFilter) return raw;

    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(raw);
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if ('filter' in ctx) ctx.filter = cssFilter;
          ctx.drawImage(img, 0, 0);
          let baked = c.toDataURL('image/jpeg', TARGET_QUALITY);
          let q = TARGET_QUALITY;
          while (baked.length > MAX_PHOTO_BYTES && q > 0.45) {
            q -= 0.08;
            baked = c.toDataURL('image/jpeg', q);
          }
          resolve(baked);
        } catch { resolve(raw); }
      };
      img.src = raw;
    });
  },

  /* ---------------------------------------------------------------------- *
     Save
   * ---------------------------------------------------------------------- */
  async save() {
    const btn = els.saveBtn;
    if (!btn) return;
    if (btn.disabled) return;

    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Saving…';

    // Bake filter into the image (so server receives the styled version).
    let photo = null;
    try {
      photo = this.state.photoData ? await this._bakeFilter() : null;
      this.state.photoBaked = photo;
    } catch (e) {
      photo = this.state.photoData; // fall back to unfiltered
    }

    const payload = {
      stopName:     this.state.stopName,
      neighborhood: this.state.neighborhood,
      routeId:      this.state.routeId,
      tags:         Array.from(this.state.moods),  // backward-compat with current server
      moods:        Array.from(this.state.moods),
      rating:       this.state.rating,
      notes:        this.state.notes,
      filter:       this.state.filter,
      stickers:     this.state.stickers.map(s => s.glyph || s.label),
      lat:          this.state.lat,
      lon:          this.state.lon,
      photo,
      addToArchive: this.state.addToArchive,
    };

    try {
      await API.spotsSave(payload);
      this._showSuccessAnimation();
      this._announce('Saved to your archive');
      setTimeout(() => this.close(), 800);
      // Optional: try to nudge the rest of the app to refresh the badge.
      try { window.dispatchEvent(new CustomEvent('we:spot-saved', { detail: payload })); } catch {}
    } catch (e) {
      console.warn('[CaptureV2] save failed', e);
      btn.disabled = false;
      btn.textContent = originalLabel;
      Toast.show('Failed to save — try again');
      this._announce('Save failed. Please try again.');
    }
  },

  _showSuccessAnimation() {
    const frame = els.photoFrame;
    const burst = els.sparkleBurst;
    if (!frame) return;

    // Build sparkle burst — 12 dots radiating outward.
    if (burst) {
      burst.innerHTML = '';
      const N = 12;
      for (let i = 0; i < N; i++) {
        const angle = (Math.PI * 2 * i) / N;
        const dist = 70 + Math.random() * 30;
        const dot = document.createElement('span');
        dot.className = 'spark';
        dot.style.setProperty('--spark-x', `${Math.cos(angle) * dist}px`);
        dot.style.setProperty('--spark-y', `${Math.sin(angle) * dist}px`);
        dot.style.animationDelay = (i * 18) + 'ms';
        burst.appendChild(dot);
      }
    }

    frame.classList.add('is-saving');
    if (els.saveBtn) els.saveBtn.classList.add('is-success');

    setTimeout(() => {
      frame.classList.remove('is-saving');
      if (els.saveBtn) els.saveBtn.classList.remove('is-success');
    }, 760);
  },

  /* ---------------------------------------------------------------------- *
     GPS
   * ---------------------------------------------------------------------- */
  _startGps() {
    this._setGpsState('pending', 'Locating…');
    locate()
      .then(({ lat, lon }) => {
        this.state.lat = lat;
        this.state.lon = lon;
        const label = this.state.stopName
          ? `Near ${this.state.stopName}`
          : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        this._setGpsState('locked', label);
      })
      .catch(() => {
        this._setGpsState('error', 'Location unavailable');
      });
  },

  _setGpsState(state, text) {
    this.state.gpsState = state;
    if (els.gpsChip) els.gpsChip.dataset.state = state;
    if (els.gpsText) els.gpsText.textContent = text;
  },

  /* ---------------------------------------------------------------------- *
     Rendering / bindings
   * ---------------------------------------------------------------------- */
  _cacheEls() {
    els.root           = document.getElementById('captureV2');
    els.close          = document.getElementById('capV2Close');
    els.skip           = document.getElementById('capV2SkipPhoto');
    els.stopNameText   = document.getElementById('capV2StopName');
    els.emptyState     = document.getElementById('capV2EmptyState');
    els.photoFrame     = document.getElementById('capV2PhotoFrame');
    els.photoImg       = document.getElementById('capV2PhotoImg');
    els.photoActions   = document.getElementById('capV2PhotoActions');
    els.retakeBtn      = document.getElementById('capV2Retake');
    els.stickerToggle  = document.getElementById('capV2StickerToggle');
    els.stickerTray    = document.getElementById('capV2StickerTray');
    els.stickerLayer   = document.getElementById('capV2StickerLayer');
    els.fileInput      = document.getElementById('capV2FileInput');
    els.flash          = document.getElementById('capV2Flash');
    els.sparkleBurst   = document.getElementById('capV2SparkleBurst');
    els.filters        = document.getElementById('capV2Filters');
    els.sheet          = document.getElementById('capV2Sheet');
    els.sheetHandle    = document.getElementById('capV2SheetHandle');
    els.sheetBody      = document.getElementById('capV2SheetBody');
    els.caption        = document.getElementById('capV2Caption');
    els.captionCount   = document.getElementById('capV2CaptionCount');
    els.gpsChip        = document.getElementById('capV2GpsChip');
    els.gpsText        = document.getElementById('capV2GpsText');
    els.timeChip       = document.getElementById('capV2TimeChip');
    els.timeText       = document.getElementById('capV2TimeText');
    els.moodGroup      = document.getElementById('capV2MoodGroup');
    els.rating         = document.getElementById('capV2Rating');
    els.saveBtn        = document.getElementById('capV2Save');
    els.archiveToggle  = document.getElementById('capV2ArchiveToggle');
    els.live           = document.getElementById('capV2Live');
  },

  _render() {
    // Header bits.
    if (els.stopNameText) els.stopNameText.textContent = this.state.stopName || '';
    if (els.timeText)     els.timeText.textContent = fmtTime(this.state.capturedAt);

    // Reset photo state.
    if (els.photoImg) els.photoImg.removeAttribute('src');
    if (els.photoFrame) {
      els.photoFrame.hidden = true;
      Object.keys(FILTERS).forEach((k) => els.photoFrame.classList.remove('filter-' + k));
      els.photoFrame.classList.add('filter-none');
    }
    if (els.emptyState)  els.emptyState.hidden = false;
    if (els.photoActions) els.photoActions.hidden = true;
    if (els.stickerLayer) els.stickerLayer.innerHTML = '';
    if (els.stickerTray)  els.stickerTray.hidden = true;
    if (els.stickerToggle) els.stickerToggle.setAttribute('aria-expanded', 'false');

    // Reset filter chips.
    if (els.filters) {
      els.filters.querySelectorAll('.filter-chip').forEach((c) => {
        const sel = c.dataset.filter === 'none';
        c.classList.toggle('selected', sel);
        c.setAttribute('aria-checked', String(sel));
        // Clear any previously-applied background thumb.
        const t = c.querySelector('.thumb');
        if (t) t.style.backgroundImage = '';
      });
    }

    // Reset caption.
    if (els.caption) els.caption.value = '';
    if (els.captionCount) els.captionCount.textContent = '0 / 240';

    // Reset moods / rating.
    document.querySelectorAll('.mood-pill').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    document.querySelectorAll('#capV2Rating .rating-pill').forEach((p) => p.setAttribute('aria-checked', 'false'));

    // Archive toggle defaults ON.
    if (els.archiveToggle) els.archiveToggle.checked = true;

    // Save button.
    if (els.saveBtn) {
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = 'Save to my city';
      els.saveBtn.classList.remove('is-success');
    }
  },

  _bind() {
    if (this._bound) return;
    this._bound = true;

    const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

    on(els.close, 'click', this._handleClose = () => this.close());
    on(els.skip,  'click', this._handleSkip  = () => this.close());
    on(els.emptyState, 'click', this._handleEmptyClick = () => els.fileInput && els.fileInput.click());
    on(els.fileInput, 'change', this._handleFile = (e) => this._onFile(e));
    on(els.retakeBtn, 'click', this._handleRetake = () => els.fileInput && els.fileInput.click());

    on(els.stickerToggle, 'click', this._handleStickerToggle = () => {
      const tray = els.stickerTray;
      if (!tray) return;
      const open = tray.hidden;
      tray.hidden = !open;
      els.stickerToggle.setAttribute('aria-expanded', String(open));
    });

    if (els.stickerTray) {
      this._handleStickerPick = (e) => {
        const btn = e.target.closest('.sticker-opt');
        if (!btn) return;
        const glyph = btn.querySelector('.sticker-glyph')?.textContent || '⭐';
        const label = btn.querySelector('.sticker-label')?.textContent || '';
        this.addSticker(glyph, label);
        els.stickerTray.hidden = true;
        if (els.stickerToggle) els.stickerToggle.setAttribute('aria-expanded', 'false');
      };
      els.stickerTray.addEventListener('click', this._handleStickerPick);
    }

    if (els.filters) {
      this._handleFilterClick = (e) => {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        this.setFilter(chip.dataset.filter);
      };
      els.filters.addEventListener('click', this._handleFilterClick);
    }

    on(els.sheetHandle, 'click', this._handleSheetToggle = () => {
      const collapsed = els.sheet.classList.toggle('is-collapsed');
      els.sheetHandle.setAttribute('aria-expanded', String(!collapsed));
    });

    if (els.caption) {
      this._handleCaption = (e) => {
        this.state.notes = e.target.value;
        if (els.captionCount) els.captionCount.textContent = `${e.target.value.length} / 240`;
      };
      els.caption.addEventListener('input', this._handleCaption);
    }

    if (els.moodGroup) {
      this._handleMood = (e) => {
        const pill = e.target.closest('.mood-pill');
        if (!pill) return;
        this.toggleMood(pill.dataset.mood);
      };
      els.moodGroup.addEventListener('click', this._handleMood);
    }

    if (els.rating) {
      this._handleRating = (e) => {
        const pill = e.target.closest('.rating-pill');
        if (!pill) return;
        this.setRating(pill.dataset.rating);
      };
      els.rating.addEventListener('click', this._handleRating);
    }

    on(els.archiveToggle, 'change', this._handleArchive = (e) => {
      this.state.addToArchive = !!e.target.checked;
    });

    on(els.saveBtn, 'click', this._handleSave = () => this.save());

    // Esc closes; basic focus-trap.
    this._handleKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
      if (e.key === 'Tab') this._trapTab(e);
    };
    document.addEventListener('keydown', this._handleKey);
  },

  _unbind() {
    document.removeEventListener('keydown', this._handleKey || (() => {}));
    this._bound = false;
    // Per-element listeners are GC'd along with the elements; explicit removeEventListener
    // would be needed only if the modal nodes were preserved across opens. Our markup
    // is stable, so we keep the handlers attached but harmless after close.
  },

  /* ---------------------------------------------------------------------- *
     A11y helpers
   * ---------------------------------------------------------------------- */
  _trapTab(e) {
    const root = els.root;
    if (!root) return;
    const focusables = root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  },

  _announce(msg) {
    if (!els.live) return;
    els.live.textContent = '';
    // Force a re-announce by detaching then re-setting.
    setTimeout(() => { els.live.textContent = msg; }, 30);
  },

  /* ---------------------------------------------------------------------- *
     Misc
   * ---------------------------------------------------------------------- */
  _flash() {
    const f = els.flash;
    if (!f) return;
    f.classList.remove('is-firing');
    // force reflow so the animation restarts
    // eslint-disable-next-line no-unused-expressions
    f.offsetWidth;
    f.classList.add('is-firing');
    setTimeout(() => f.classList.remove('is-firing'), 240);
  },

  _showPhoto(dataUrl) {
    if (els.photoImg) els.photoImg.src = dataUrl;
    if (els.photoFrame) els.photoFrame.hidden = false;
    if (els.emptyState) els.emptyState.hidden = true;
    if (els.photoActions) els.photoActions.hidden = false;
    this._applyFilter();
  },

  /** Repaint each filter chip's thumbnail with the user's photo as the source. */
  _paintFilterThumbs(dataUrl) {
    if (!els.filters || !dataUrl) return;
    els.filters.querySelectorAll('.filter-chip .thumb').forEach((t) => {
      t.style.backgroundImage = `url("${dataUrl}")`;
    });
  },
};

// Expose globally for non-module callers (legacy app shell).
if (typeof window !== 'undefined') {
  window.CaptureV2 = CaptureV2;
}

export default CaptureV2;
