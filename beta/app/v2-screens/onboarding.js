/* =====================================================================
   Walking Explorers v0.7 — Onboarding module
   Public API:
     Onboarding.mount(containerEl, { onComplete })
     Onboarding.shouldShow()  -> boolean
   Storage keys:
     localStorage.we_onboarded   = '1'        (set on completion)
     localStorage.we_mood        = JSON array of mood ids
     localStorage.we_walk_prefs  = { minutes, miles }
     localStorage.we_anchor      = { lat, lon, timestamp }
   ===================================================================== */

const HTML_PATH = '/beta/app/v2-screens/onboarding.html';
const CSS_PATH  = '/beta/app/v2-screens/onboarding.css';
const PREFS_ENDPOINT = '/api/users/prefs';
const STORAGE_KEY = 'we_onboarded';

function shouldShow() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch (_) {
    return true;
  }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

async function loadHTML() {
  const res = await fetch(HTML_PATH, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('onboarding html failed: ' + res.status);
  return await res.text();
}

function injectCSS() {
  if (document.querySelector('link[data-we-onboarding-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_PATH;
  link.setAttribute('data-we-onboarding-css', '1');
  document.head.appendChild(link);
}

/* -------- Main mount -------- */
async function mount(containerEl, opts = {}) {
  if (!containerEl) throw new Error('Onboarding.mount: containerEl required');
  const onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : () => {};

  injectCSS();

  let html;
  try {
    html = await loadHTML();
  } catch (err) {
    console.error('[onboarding]', err);
    return;
  }

  containerEl.innerHTML = html;
  const root = containerEl.querySelector('.we-onb');
  if (!root) return;

  /* ----- State ----- */
  const state = {
    step: 1,
    moods: new Set(),
    minutes: 90,
    miles: 1.5,
    anchor: null,
  };

  /* ----- Helpers ----- */
  const panels = root.querySelectorAll('.we-onb__panel');
  const dots   = root.querySelectorAll('.we-onb__step');
  const backBtn = root.querySelector('.we-onb__back');

  function showStep(n) {
    state.step = n;
    root.dataset.step = String(n);
    panels.forEach((p) => {
      const idx = Number(p.getAttribute('data-panel'));
      const on = idx === n;
      p.hidden = !on;
      p.classList.toggle('is-active', on);
    });
    dots.forEach((d, i) => {
      const idx = i + 1;
      d.classList.toggle('is-on', idx === n);
      d.classList.toggle('is-done', idx < n);
    });
    backBtn.hidden = n === 1;

    // Focus the heading for screen readers
    const heading = root.querySelector(`.we-onb__panel[data-panel="${n}"] .we-onb__h1`);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: false }); } catch (_) {}
    }
  }

  function complete() {
    safeSet(STORAGE_KEY, '1');
    // Tear down
    root.remove();
    try { onComplete(); } catch (err) { console.error('[onboarding] onComplete error', err); }
  }

  function skipAll() {
    // Skipping the entire flow still marks onboarded so we don't nag.
    complete();
  }

  /* ----- Step 2: Mood pills ----- */
  const pills = root.querySelectorAll('.we-onb__pill');
  const moodContinueBtn = root.querySelector('[data-panel="2"] [data-action="next"][data-needs="mood"]');

  function syncMoodContinue() {
    if (moodContinueBtn) moodContinueBtn.disabled = state.moods.size === 0;
  }

  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const id = pill.getAttribute('data-mood');
      if (state.moods.has(id)) {
        state.moods.delete(id);
        pill.classList.remove('is-on');
        pill.setAttribute('aria-pressed', 'false');
      } else {
        state.moods.add(id);
        pill.classList.add('is-on');
        pill.setAttribute('aria-pressed', 'true');
      }
      syncMoodContinue();
    });
    pill.setAttribute('aria-pressed', 'false');
  });

  function persistMood() {
    if (state.moods.size > 0) {
      safeSet('we_mood', JSON.stringify([...state.moods]));
    }
  }

  /* ----- Step 3: Sliders ----- */
  const minutesInput = root.querySelector('[data-pref="minutes"]');
  const milesInput   = root.querySelector('[data-pref="miles"]');
  const previewEl    = root.querySelector('[data-preview]');

  function updatePreview() {
    if (!previewEl) return;
    const mins = Number(minutesInput.value);
    const mi = Number(milesInput.value).toFixed(1);
    state.minutes = mins;
    state.miles = Number(mi);
    previewEl.innerHTML = `About <strong>${mins} min</strong> &middot; <strong>${mi} mi</strong>`;
  }
  if (minutesInput) minutesInput.addEventListener('input', updatePreview);
  if (milesInput)   milesInput.addEventListener('input', updatePreview);
  updatePreview();

  async function persistPrefs() {
    const payload = { minutes: state.minutes, miles: state.miles };
    safeSet('we_walk_prefs', JSON.stringify(payload));
    // Fire-and-forget POST to integrator's endpoint
    try {
      fetch(PREFS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      }).catch(() => {}); // swallow — endpoint may not exist yet
    } catch (_) {}
  }

  /* ----- Step 4: Location ----- */
  const locStatus = root.querySelector('[data-loc-status]');
  const allowBtn  = root.querySelector('[data-action="allow-location"]');

  function setLocStatus(msg, kind) {
    if (!locStatus) return;
    locStatus.hidden = false;
    locStatus.textContent = msg;
    locStatus.classList.remove('is-ok', 'is-err');
    if (kind) locStatus.classList.add(kind === 'ok' ? 'is-ok' : 'is-err');
  }

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      setLocStatus("This browser can't share location. You can enable later in Settings.", 'err');
      window.setTimeout(complete, 1200);
      return;
    }
    allowBtn.disabled = true;
    allowBtn.textContent = 'Asking your browser…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const anchor = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          timestamp: Date.now(),
        };
        state.anchor = anchor;
        safeSet('we_anchor', JSON.stringify(anchor));
        setLocStatus('Locked in. Finding routes near you…', 'ok');
        window.setTimeout(complete, 900);
      },
      (err) => {
        console.warn('[onboarding] geolocation denied', err);
        setLocStatus("No problem — you can enable later in Settings.", 'err');
        allowBtn.disabled = false;
        allowBtn.textContent = 'Allow location';
        window.setTimeout(complete, 1400);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  /* ----- Delegated click handler ----- */
  root.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');

    if (action === 'next') {
      if (state.step === 2) {
        if (state.moods.size === 0) return; // guard
        persistMood();
        showStep(3);
      } else if (state.step === 3) {
        persistPrefs();
        showStep(4);
      } else if (state.step === 1) {
        showStep(2);
      }
    } else if (action === 'back') {
      if (state.step > 1) showStep(state.step - 1);
    } else if (action === 'skip-step') {
      if (state.step === 2) {
        showStep(3);
      } else if (state.step === 3) {
        persistPrefs();
        showStep(4);
      } else if (state.step === 4) {
        complete();
      }
    } else if (action === 'skip-all') {
      skipAll();
    } else if (action === 'allow-location') {
      requestLocation();
    }
  });

  /* ----- Keyboard: Escape skips entirely ----- */
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') skipAll();
  });

  // Initial render
  showStep(1);
}

const Onboarding = { mount, shouldShow };
export default Onboarding;
export { mount, shouldShow };
