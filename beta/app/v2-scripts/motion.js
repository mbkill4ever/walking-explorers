/* ============================================================================
   Walking Explorers v2 — Motion Controller
   Owned by: motion-system agent

   ES module + window.Motion fallback (preserves inline onclick compatibility
   with the existing index.html). No dependencies. Vanilla.
   ============================================================================ */

const PREFERS_REDUCED = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SUPPORTS_SCROLL_TIMELINE = () =>
  typeof CSS !== 'undefined' &&
  CSS.supports &&
  CSS.supports('animation-timeline: scroll()');

/* ----------------------------------------------------------------------------
   Internal state
   ---------------------------------------------------------------------------- */
const state = {
  initialised: false,
  io: null,                  // IntersectionObserver for fade-up
  parallaxTargets: [],       // [{el, ratio}] for JS fallback parallax
  rafId: 0,
  reduced: false,
};

/* ----------------------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------------------- */
function onNextFrame(fn) {
  return requestAnimationFrame(() => requestAnimationFrame(fn));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/* ----------------------------------------------------------------------------
   Motion.init — set up observers + reduced-motion handling
   ---------------------------------------------------------------------------- */
function init(options = {}) {
  if (state.initialised) return;
  state.initialised = true;
  state.reduced = PREFERS_REDUCED();

  // Listen for changes to user motion preference.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => { state.reduced = e.matches; };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  // IntersectionObserver to trigger fade-up + stagger on entrance.
  if ('IntersectionObserver' in window) {
    state.io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          state.io.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

    // Auto-attach to anything already tagged .motion-fade-up in DOM.
    document.querySelectorAll('.motion-fade-up').forEach((el) => {
      state.io.observe(el);
    });

    // Auto-attach to .motion-stagger containers.
    document.querySelectorAll('.motion-stagger').forEach((parent) => {
      fadeUpStagger(parent, ':scope > *');
    });
  } else {
    // Old browsers: just show everything.
    document.querySelectorAll('.motion-fade-up').forEach((el) => el.classList.add('is-in'));
  }

  // Parallax fallback if scroll-timeline isn't supported.
  if (!SUPPORTS_SCROLL_TIMELINE() && !state.reduced) {
    document.querySelectorAll('.parallax-hero').forEach((el) => {
      const ratio = parseFloat(el.dataset.parallax || '0.4');
      parallaxHero(el, ratio);
    });
    if (state.parallaxTargets.length) {
      window.addEventListener('scroll', schedulePaint, { passive: true });
      schedulePaint();
    }
  }

  // Optional: page-transition listener hook. The host app can dispatch
  // window-level 'we:navigate' events with { direction: 'forward' | 'back' }.
  window.addEventListener('we:navigate', onNavigate);
}

function onNavigate(e) {
  if (state.reduced) return;
  const dir = (e.detail && e.detail.direction) || 'forward';
  const target = (e.detail && e.detail.target) || document.querySelector('.page.is-active');
  if (!target) return;
  target.classList.remove('page-enter-forward', 'page-enter-back', 'page-exit-forward', 'page-exit-back');
  void target.offsetWidth; // restart animation
  target.classList.add(dir === 'back' ? 'page-enter-back' : 'page-enter-forward');
}

/* ----------------------------------------------------------------------------
   Motion.fadeUpStagger — staggered entrance
     parent: Element | selector
     childSelector: string (default ':scope > *')
     options: { stepMs: 60, maxStagger: 6, baseDelay: 0 }
   ---------------------------------------------------------------------------- */
function fadeUpStagger(parent, childSelector = ':scope > *', options = {}) {
  const root = typeof parent === 'string' ? document.querySelector(parent) : parent;
  if (!root) return;
  const stepMs = options.stepMs ?? 60;
  const maxStagger = options.maxStagger ?? 6;
  const baseDelay = options.baseDelay ?? 0;

  const kids = Array.from(root.querySelectorAll(childSelector));
  kids.forEach((kid, i) => {
    kid.classList.add('motion-fade-up');
    const idx = Math.min(i, maxStagger - 1);
    kid.style.setProperty('--motion-delay', `${baseDelay + idx * stepMs}ms`);
    if (state.io) state.io.observe(kid);
    else kid.classList.add('is-in');
  });
}

/* ----------------------------------------------------------------------------
   Motion.parallaxHero — scroll-linked transform fallback
     element: Element
     ratio: number (default 0.4) — translate at ratio * scrollDelta
   ---------------------------------------------------------------------------- */
function parallaxHero(element, ratio = 0.4) {
  if (!element) return;
  if (state.reduced) return;
  // Native path: just let CSS handle it (no-op here).
  if (SUPPORTS_SCROLL_TIMELINE()) return;
  state.parallaxTargets.push({ el: element, ratio });
}

function schedulePaint() {
  if (state.rafId) return;
  state.rafId = requestAnimationFrame(paintParallax);
}

function paintParallax() {
  state.rafId = 0;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  for (const { el, ratio } of state.parallaxTargets) {
    const rect = el.getBoundingClientRect();
    // Distance of element centre from viewport centre, normalised to viewport.
    const centre = rect.top + rect.height / 2;
    const delta = (centre - vh / 2);
    const y = clamp(-delta * ratio, -120, 120);
    el.style.setProperty('--parallax-y', `${y.toFixed(1)}px`);
  }
}

/* ----------------------------------------------------------------------------
   Motion.celebrate — confetti burst at element position
   ---------------------------------------------------------------------------- */
function celebrate(element, options = {}) {
  if (state.reduced) return;
  const host = element || document.body;
  const count = options.count ?? 24;
  const palette = options.palette ?? [148, 200, 32, 14, 280]; // hues

  // Ensure host can position the burst layer.
  const prevPos = getComputedStyle(host).position;
  if (prevPos === 'static') host.style.position = 'relative';

  const layer = document.createElement('div');
  layer.className = 'confetti-burst';
  layer.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const x = (Math.random() * 280 - 140).toFixed(0);
    const rot = (Math.random() * 720 - 360).toFixed(0);
    const hue = palette[i % palette.length];
    piece.style.setProperty('--c-x', `${x}px`);
    piece.style.setProperty('--c-rot', `${rot}deg`);
    piece.style.setProperty('--c-hue', hue);
    piece.style.setProperty('--c-delay', `${Math.floor(Math.random() * 120)}ms`);
    piece.style.left = `${50 + (Math.random() * 20 - 10)}%`;
    layer.appendChild(piece);
  }

  host.appendChild(layer);
  setTimeout(() => layer.remove(), 1600);
}

/* ----------------------------------------------------------------------------
   Motion.modalSheet — open with drag-to-dismiss
     modal: { sheet, backdrop, onClose }
     -- or just an Element with [data-backdrop-id] on the sheet for backdrop lookup
   ---------------------------------------------------------------------------- */
function modalSheet(modal) {
  if (!modal) return null;

  let sheet, backdrop, onClose;
  if (modal instanceof Element) {
    sheet = modal;
    const backdropId = sheet.dataset.backdropId;
    backdrop = backdropId ? document.getElementById(backdropId) : sheet.previousElementSibling;
  } else {
    sheet = modal.sheet;
    backdrop = modal.backdrop;
    onClose = modal.onClose;
  }
  if (!sheet) return null;

  // Open.
  sheet.classList.add('is-open');
  if (backdrop) backdrop.classList.add('is-open');

  // Drag-to-dismiss state.
  let startY = 0;
  let curY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let dragging = false;

  const onStart = (e) => {
    if (state.reduced) return;
    const t = e.touches ? e.touches[0] : e;
    startY = t.clientY;
    lastY = startY;
    lastT = performance.now();
    velocity = 0;
    dragging = true;
    sheet.classList.add('is-dragging');
  };

  const onMove = (e) => {
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    const now = performance.now();
    curY = t.clientY - startY;
    if (curY < 0) curY = curY * 0.25; // rubber-band when dragging up
    const dt = Math.max(1, now - lastT);
    velocity = (t.clientY - lastY) / dt; // px per ms
    lastY = t.clientY;
    lastT = now;
    sheet.style.transform = `translate3d(0, ${curY}px, 0)`;
  };

  const close = () => {
    sheet.classList.remove('is-open', 'is-dragging');
    if (backdrop) backdrop.classList.remove('is-open');
    sheet.style.transform = '';
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('mousedown', onStart);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    if (backdrop) backdrop.removeEventListener('click', close);
    if (typeof onClose === 'function') onClose();
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('is-dragging');
    const distance = sheet.offsetHeight || 400;
    // Snap-close if dragged > 40% OR velocity > 0.6 px/ms downward.
    if (curY > distance * 0.4 || velocity > 0.6) {
      close();
    } else {
      sheet.style.transform = '';
    }
    curY = 0;
    velocity = 0;
  };

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: true });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  if (backdrop) backdrop.addEventListener('click', close);

  return { close };
}

/* ----------------------------------------------------------------------------
   Bonus utilities — composable bits the host app can call directly
   ---------------------------------------------------------------------------- */
function toast(node, { duration = 2400 } = {}) {
  if (!node) return;
  node.classList.remove('is-out');
  onNextFrame(() => node.classList.add('is-in'));
  setTimeout(() => {
    node.classList.remove('is-in');
    node.classList.add('is-out');
  }, duration);
}

function captureFlash() {
  if (state.reduced) return;
  const layer = document.createElement('div');
  layer.className = 'capture-flash is-firing';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 260);
}

function saveBurst(iconEl) {
  if (!iconEl || state.reduced) return;
  iconEl.classList.remove('save-burst');
  void iconEl.offsetWidth;
  iconEl.classList.add('save-burst');
}

function buttonSuccess(btn) {
  if (!btn || state.reduced) return;
  btn.classList.remove('is-success');
  void btn.offsetWidth;
  btn.classList.add('is-success');
  setTimeout(() => btn.classList.remove('is-success'), 700);
}

/* ----------------------------------------------------------------------------
   Pull-to-refresh — attach to a scroll container.
     attachPullToRefresh(container, { threshold: 80, onRefresh })
   ---------------------------------------------------------------------------- */
function attachPullToRefresh(container, { threshold = 80, onRefresh, spinner } = {}) {
  if (!container) return () => {};
  let startY = 0;
  let pulling = false;
  let y = 0;

  const onStart = (e) => {
    if (container.scrollTop > 0 || state.reduced) return;
    pulling = true;
    startY = (e.touches ? e.touches[0] : e).clientY;
    container.classList.remove('is-snapping');
  };
  const onMove = (e) => {
    if (!pulling) return;
    const t = (e.touches ? e.touches[0] : e).clientY;
    const dy = t - startY;
    if (dy < 0) return;
    // Rubber-band damping.
    y = Math.pow(dy, 0.85);
    const progress = clamp(y / threshold, 0, 1.2);
    container.style.setProperty('--ptr-y', `${y}px`);
    container.style.setProperty('--ptr-progress', progress.toFixed(3));
  };
  const onEnd = async () => {
    if (!pulling) return;
    pulling = false;
    container.classList.add('is-snapping');
    if (y >= threshold && typeof onRefresh === 'function') {
      if (spinner) spinner.classList.add('is-spinning');
      try { await onRefresh(); } finally {
        if (spinner) spinner.classList.remove('is-spinning');
      }
    }
    container.style.setProperty('--ptr-y', '0px');
    container.style.setProperty('--ptr-progress', '0');
    y = 0;
  };

  container.addEventListener('touchstart', onStart, { passive: true });
  container.addEventListener('touchmove', onMove, { passive: true });
  container.addEventListener('touchend', onEnd);

  return () => {
    container.removeEventListener('touchstart', onStart);
    container.removeEventListener('touchmove', onMove);
    container.removeEventListener('touchend', onEnd);
  };
}

/* ----------------------------------------------------------------------------
   Tab indicator — slide between tabs.
     moveTabIndicator(indicator, activeTab)
   ---------------------------------------------------------------------------- */
function moveTabIndicator(indicator, activeTab) {
  if (!indicator || !activeTab) return;
  const parentBox = indicator.parentElement.getBoundingClientRect();
  const tabBox = activeTab.getBoundingClientRect();
  indicator.style.width = `${tabBox.width}px`;
  indicator.style.transform = `translate3d(${tabBox.left - parentBox.left}px, 0, 0)`;
}

/* ----------------------------------------------------------------------------
   Public surface
   ---------------------------------------------------------------------------- */
export const Motion = {
  init,
  fadeUpStagger,
  parallaxHero,
  celebrate,
  modalSheet,
  toast,
  captureFlash,
  saveBurst,
  buttonSuccess,
  attachPullToRefresh,
  moveTabIndicator,
  get prefersReducedMotion() { return state.reduced; },
};

// Backward-compat: expose as a global so existing inline onclick handlers
// in index.html (which can't import ES modules) can still reach it.
if (typeof window !== 'undefined') {
  window.Motion = Motion;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Motion.init());
  } else {
    Motion.init();
  }
}

export default Motion;
