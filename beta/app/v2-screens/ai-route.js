/* =====================================================================
   Walking Explorers v0.7 — AI Route Generator
   Owned by: ai-route agent (v07_03)

   Public API:
     import AIRoute from '/beta/app/v2-screens/ai-route.js';
     AIRoute.mount(containerEl, {
       onGenerated(route),   // called with the generated route on success
       onClose(),            // called when user dismisses
     });
     AIRoute.destroy();

   Wire-up notes for the integrator:
     - This module is purely client-side. It POSTs to /api/routes/ai-generate
       and hands the resulting route object back via onGenerated.
     - The route shape matches what the Detail screen expects (see the
       v07_03 report). The integrator is responsible for navigating to
       Detail and preloading the route.
     - Pre-fills moods from localStorage.we_mood (Onboarding's output) if
       present. Falls back to "no moods chosen" silently.
     - Geolocation is opt-in. If the user picks "Use my current location"
       and grants the prompt, we send lat/lon. Otherwise we send
       { neighborhood: '<chosen>' } or fall back to the SoHo default.
   ===================================================================== */

const HTML_PATH = '/beta/app/v2-screens/ai-route.html';
const CSS_PATH  = '/beta/app/v2-screens/ai-route.css';
const API_PATH  = '/api/routes/ai-generate';

const LS_MOOD = 'we_mood';
const LS_ANCHOR = 'we_anchor';

let _root = null;       // root .we-air element when mounted
let _container = null;  // host container element

function safeGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }

async function loadHTML() {
  const res = await fetch(HTML_PATH, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('ai-route html failed: ' + res.status);
  return await res.text();
}

function injectCSS() {
  if (document.querySelector('link[data-we-ai-route-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_PATH;
  link.setAttribute('data-we-ai-route-css', '1');
  document.head.appendChild(link);
}

/* --------------------------------------------------------------------------
 * Mount.
 * ------------------------------------------------------------------------- */
async function mount(containerEl, opts = {}) {
  if (!containerEl) throw new Error('AIRoute.mount: containerEl required');
  // If already mounted, tear down first.
  if (_root) destroy();

  const onGenerated = typeof opts.onGenerated === 'function' ? opts.onGenerated : () => {};
  const onClose = typeof opts.onClose === 'function' ? opts.onClose : () => {};

  injectCSS();

  let html;
  try { html = await loadHTML(); }
  catch (err) {
    console.error('[ai-route]', err);
    return;
  }
  containerEl.innerHTML = html;
  _container = containerEl;
  _root = containerEl.querySelector('.we-air');
  if (!_root) return;

  /* ---------- State ---------- */
  const state = {
    step: 1,
    minutes: null,            // 30 | 60 | 90 | 120 | 'flexible'
    moods: new Set(),
    originMode: 'geo',        // 'geo' | 'nbhd'
    nbhd: '',
    geoCoords: null,          // { lat, lon } after grant
    freeText: '',
    inFlight: false,
  };

  // Pre-fill moods from localStorage (Onboarding agent's output).
  try {
    const raw = safeGet(LS_MOOD);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const m of arr) if (typeof m === 'string') state.moods.add(m);
    }
  } catch (_) {}

  /* ---------- Element refs ---------- */
  const panels = _root.querySelectorAll('.we-air__panel');
  const dots   = _root.querySelectorAll('.we-air__step');
  const backBtn = _root.querySelector('.we-air__back');

  function panel(name) {
    return _root.querySelector(`.we-air__panel[data-panel="${name}"]`);
  }

  function showStep(n) {
    state.step = n;
    _root.dataset.step = String(n);
    panels.forEach((p) => {
      const id = p.getAttribute('data-panel');
      // Numeric panels 1-4 vs special states "loading" / "error".
      const on = String(id) === String(n);
      p.hidden = !on;
      p.classList.toggle('is-active', on);
    });
    dots.forEach((d, i) => {
      const idx = i + 1;
      const numericStep = typeof n === 'number' ? n : 0;
      d.classList.toggle('is-on', idx === numericStep);
      d.classList.toggle('is-done', idx < numericStep);
    });
    backBtn.hidden = !(typeof n === 'number' && n > 1);

    // Focus the heading for screen readers
    const heading = _root.querySelector(`.we-air__panel[data-panel="${n}"] .we-air__h1`);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: false }); } catch (_) {}
    }
  }

  /* ---------- Step 1: time chips ---------- */
  const timeChips = _root.querySelectorAll('.we-air__chip[data-time]');
  const timeNext = _root.querySelector('[data-panel="1"] [data-needs="time"]');
  function syncTime() { if (timeNext) timeNext.disabled = state.minutes == null; }
  timeChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const v = chip.getAttribute('data-time');
      state.minutes = v === 'flexible' ? 'flexible' : Number(v);
      timeChips.forEach(c => {
        const on = c === chip;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      syncTime();
    });
    chip.setAttribute('aria-checked', 'false');
  });

  /* ---------- Step 2: mood pills ---------- */
  const pills = _root.querySelectorAll('.we-air__pill');
  const moodNext = _root.querySelector('[data-panel="2"] [data-needs="mood"]');
  function syncMood() { if (moodNext) moodNext.disabled = state.moods.size === 0; }
  pills.forEach((pill) => {
    const id = pill.getAttribute('data-mood');
    if (state.moods.has(id)) {
      pill.classList.add('is-on');
      pill.setAttribute('aria-pressed', 'true');
    } else {
      pill.setAttribute('aria-pressed', 'false');
    }
    pill.addEventListener('click', () => {
      if (state.moods.has(id)) {
        state.moods.delete(id);
        pill.classList.remove('is-on');
        pill.setAttribute('aria-pressed', 'false');
      } else {
        state.moods.add(id);
        pill.classList.add('is-on');
        pill.setAttribute('aria-pressed', 'true');
      }
      syncMood();
    });
  });
  syncMood();

  /* ---------- Step 3: origin selector ---------- */
  const originBtns = _root.querySelectorAll('.we-air__origin-btn');
  const nbhdWrap = _root.querySelector('[data-nbhd-wrap]');
  const nbhdSelect = _root.querySelector('[data-nbhd]');
  const originStatus = _root.querySelector('[data-origin-status]');

  function syncOriginUI() {
    originBtns.forEach(b => {
      const on = b.getAttribute('data-origin-mode') === state.originMode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (nbhdWrap) nbhdWrap.hidden = state.originMode !== 'nbhd';
  }
  originBtns.forEach(b => {
    b.addEventListener('click', () => {
      state.originMode = b.getAttribute('data-origin-mode') || 'geo';
      syncOriginUI();
    });
  });
  syncOriginUI();
  if (nbhdSelect) {
    nbhdSelect.addEventListener('change', () => {
      state.nbhd = nbhdSelect.value || '';
    });
  }
  // If we already have a cached anchor from onboarding, surface that.
  try {
    const raw = safeGet(LS_ANCHOR);
    if (raw) {
      const anchor = JSON.parse(raw);
      if (anchor && typeof anchor.lat === 'number' && typeof anchor.lon === 'number') {
        state.geoCoords = { lat: anchor.lat, lon: anchor.lon };
        if (originStatus) originStatus.textContent = 'Using your saved location';
      }
    }
  } catch (_) {}

  function requestGeo() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        if (originStatus) originStatus.textContent = "This browser can't share location";
        resolve(null);
        return;
      }
      if (originStatus) originStatus.textContent = 'Asking your browser…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          state.geoCoords = coords;
          if (originStatus) originStatus.textContent = 'Locked in';
          resolve(coords);
        },
        () => {
          if (originStatus) originStatus.textContent = "Couldn't get your location — pick a neighborhood instead";
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  /* ---------- Step 4: free text ---------- */
  const freeInput = _root.querySelector('[data-freetext]');
  if (freeInput) {
    freeInput.addEventListener('input', () => {
      state.freeText = String(freeInput.value || '').slice(0, 240);
    });
  }

  /* ---------- Generation ---------- */
  function buildPayload() {
    const minutes = state.minutes === 'flexible' || state.minutes == null
      ? 60  // server treats "flexible" as a 60-min default; user can still expand
      : Number(state.minutes);
    let origin;
    if (state.originMode === 'geo' && state.geoCoords) {
      origin = { lat: state.geoCoords.lat, lon: state.geoCoords.lon };
    } else if (state.originMode === 'nbhd' && state.nbhd) {
      origin = { neighborhood: state.nbhd };
    } else {
      // Sensible fallback: send no origin and let server default.
      origin = null;
    }
    return {
      minutes,
      moods: [...state.moods],
      origin,
      freeText: state.freeText || '',
    };
  }

  function cycleLoaderSub() {
    const sub = _root.querySelector('[data-loader-sub]');
    if (!sub) return null;
    const lines = [
      'Picking stops near you',
      'Sorting by mood and distance',
      'Sequencing the walk so it flows',
      'Almost there…',
    ];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % lines.length;
      sub.textContent = lines[i];
    }, 1200);
    return () => clearInterval(id);
  }

  async function generate() {
    if (state.inFlight) return;
    state.inFlight = true;

    // If user chose geo and we don't have coords yet, ask now.
    if (state.originMode === 'geo' && !state.geoCoords) {
      await requestGeo();
    }

    showStep('loading');
    const stopLoader = cycleLoaderSub();

    try {
      const payload = buildPayload();
      const res = await fetch(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data || !data.ok || !data.route) {
        const msg = data && data.error === 'rate_limited'
          ? "You've used today's 10 generations — try again in an hour."
          : data && data.error === 'unauthenticated'
            ? 'Sign in to generate a personalized walk.'
            : 'Network glitch — try once more.';
        showError(msg);
        return;
      }
      // Success — hand the route back. Integrator wires the navigation.
      try { onGenerated(data.route); } catch (err) { console.error('[ai-route] onGenerated threw', err); }
    } catch (err) {
      console.error('[ai-route] generate failed', err);
      showError('Network glitch — try once more.');
    } finally {
      if (stopLoader) stopLoader();
      state.inFlight = false;
    }
  }

  function showError(msg) {
    const errPanel = panel('error');
    if (errPanel) {
      const msgEl = errPanel.querySelector('[data-error-msg]');
      if (msgEl) msgEl.textContent = msg;
    }
    showStep('error');
  }

  /* ---------- Close ---------- */
  function close() {
    try { onClose(); } catch (_) {}
    destroy();
  }

  /* ---------- Delegated click handler ---------- */
  _root.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');

    if (action === 'next') {
      if (state.step === 1 && state.minutes == null) return;
      if (state.step === 2 && state.moods.size === 0) return;
      if (state.step === 3) {
        // If geo and no coords yet, fire the geolocation request now.
        if (state.originMode === 'geo' && !state.geoCoords) {
          await requestGeo();
        }
      }
      const next = state.step + 1;
      if (next <= 4) showStep(next);
    } else if (action === 'back') {
      if (typeof state.step === 'number' && state.step > 1) showStep(state.step - 1);
    } else if (action === 'skip-step') {
      if (state.step < 4) showStep(state.step + 1);
    } else if (action === 'generate') {
      generate();
    } else if (action === 'retry') {
      generate();
    } else if (action === 'close') {
      close();
    }
  });

  /* ---------- Keyboard: Esc closes ---------- */
  _root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // Initial render
  showStep(1);
  syncTime();
}

function destroy() {
  if (!_root) return;
  try { _root.remove(); } catch (_) {}
  _root = null;
  _container = null;
}

const AIRoute = { mount, destroy };
export default AIRoute;
export { mount, destroy };
