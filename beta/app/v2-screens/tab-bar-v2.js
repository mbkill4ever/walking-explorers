/* ============================================================================
   Walking Explorers v2 — Tab Bar v2 module
   Owned by: tab-bar agent (v0.7.06)

   Public API:
     TabBar.mount(containerEl, opts)
       opts.onTabChange(name, meta?)   — fires whenever a tab becomes active
       opts.initialTab                  — 'explore' | 'around' | 'walk' | 'saved' | 'profile'
       opts.profileActions              — optional handlers for sheet items
         { onOffers, onFeedback, onChangelog, onSettings, onSignOut }
     TabBar.setActive(name)
     TabBar.setBadge(name, count|'dot'|0|null)
     TabBar.destroy()
     TabBar.openProfile()  /  TabBar.closeProfile()

   Active-walk contract:
     localStorage.we_active_walk_id (string)  — if set, the FAB shows the
       walking-person icon with a pulse halo and tapping it dispatches:
         window.dispatchEvent(new CustomEvent('we:resume-walk', { detail:{ walkId } }))
       and also calls onTabChange('walk', { intent:'resume', walkId }).
     If not set, tapping the FAB opens a popover with two options:
       - Start a walk      → onTabChange('walk', { intent:'start' }) +
                             window.dispatchEvent('we:start-walk')
       - Explore routes    → setActive('explore')
     The module listens to:
       - storage events for cross-tab sync
       - the custom 'we:active-walk-changed' event for same-tab sync
     so any other code that toggles we_active_walk_id can notify us cheaply.

   Sheet items wiring (Profile tab):
     - Offers      → opts.profileActions.onOffers || setActive('explore' …)
     - Feedback    → mailto: walking-explorers feedback fallback
     - What's new  → dispatches 'we:open-changelog'
     - Settings    → dispatches 'we:open-settings'
     - Sign out    → POST /api/auth/logout  then reload
   Each can be overridden via opts.profileActions.
   ============================================================================ */

const TABS = [
  { name: 'explore', label: 'Explore', icon: 'tab-explore', ariaLabel: 'Explore curated routes' },
  { name: 'around',  label: 'Around',  icon: 'tab-around',  ariaLabel: 'Around me — live map' },
  // 'walk' is the FAB; rendered separately.
  { name: 'saved',   label: 'Saved',   icon: 'tab-saved',   ariaLabel: 'Saved spots and routes' },
  { name: 'profile', label: 'Profile', icon: 'tab-profile', ariaLabel: 'Profile and menu' }
];

const ACTIVE_WALK_KEY = 'we_active_walk_id';

/* ----------------------------------------------------------------------------
   Module state — single-instance for simplicity. mount() replaces any prior.
   ---------------------------------------------------------------------------- */
let state = null;

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function svgUse(id, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + id);
  use.setAttribute('href', '#' + id);
  svg.appendChild(use);
  return svg;
}

function hasActiveWalk() {
  try { return !!localStorage.getItem(ACTIVE_WALK_KEY); } catch (_) { return false; }
}

function getActiveWalkId() {
  try { return localStorage.getItem(ACTIVE_WALK_KEY); } catch (_) { return null; }
}

/* ----------------------------------------------------------------------------
   Build the bar DOM
   ---------------------------------------------------------------------------- */
function buildBar() {
  const bar = h('nav', {
    class: 'tabbar-v2',
    role: 'navigation',
    'aria-label': 'Primary'
  });

  // Build explore + around first, then FAB, then saved + profile.
  const order = ['explore', 'around', 'FAB', 'saved', 'profile'];
  const tabEls = {};
  let fabEl, popoverEl, haloEl;

  order.forEach((key) => {
    if (key === 'FAB') {
      const slot = h('div', { class: 'tabbar-v2__fab-slot' });
      haloEl = h('span', { class: 'tabbar-v2__fab-halo', 'aria-hidden': 'true' });
      fabEl = h('button', {
        type: 'button',
        class: 'tabbar-v2__fab',
        'aria-label': 'Start or continue a walk',
        'data-tab': 'walk'
      }, [
        haloEl,
        // Walking-person icon for FAB
        (() => {
          const s = svgUse('tab-walk', 'tabbar-v2__fab-icon');
          return s;
        })()
      ]);
      slot.appendChild(fabEl);
      bar.appendChild(slot);
      return;
    }
    const tab = TABS.find(t => t.name === key);
    const iconWrap = h('span', { class: 'tabbar-v2__icon-wrap' }, [
      svgUse(tab.icon, 'tabbar-v2__icon tabbar-v2__icon--outline'),
      svgUse(tab.icon + '-filled', 'tabbar-v2__icon tabbar-v2__icon--filled')
    ]);
    const badge = h('span', { class: 'tabbar-v2__badge', 'aria-hidden': 'true' });
    iconWrap.appendChild(badge);
    const tabBtn = h('button', {
      type: 'button',
      class: 'tabbar-v2__tab',
      'data-tab': tab.name,
      'aria-label': tab.ariaLabel
    }, [
      iconWrap,
      h('span', { class: 'tabbar-v2__label' }, tab.label)
    ]);
    tabEls[tab.name] = { btn: tabBtn, badge };
    bar.appendChild(tabBtn);
  });

  const indicator = h('span', { class: 'tabbar-v2__indicator', 'aria-hidden': 'true' });
  bar.appendChild(indicator);

  // FAB popover (sibling, fixed-positioned)
  popoverEl = buildFabPopover();

  return { bar, tabEls, fabEl, haloEl, indicator, popoverEl };
}

function buildFabPopover() {
  const pop = h('div', {
    class: 'tabbar-v2__fab-popover',
    role: 'menu',
    'aria-label': 'Walk options',
    hidden: ''
  });
  pop.appendChild(h('button', {
    type: 'button',
    class: 'tabbar-v2__pop-btn tabbar-v2__pop-btn--primary',
    'data-pop-action': 'start',
    role: 'menuitem'
  }, [
    svgUse('tab-walk', 'tabbar-v2__pop-btn-icon'),
    h('span', { class: 'tabbar-v2__pop-btn-text' }, [
      h('span', {}, 'Start a walk'),
      h('span', { class: 'tabbar-v2__pop-btn-sub' }, 'Generate an AI route from here')
    ])
  ]));
  pop.appendChild(h('button', {
    type: 'button',
    class: 'tabbar-v2__pop-btn',
    'data-pop-action': 'explore',
    role: 'menuitem'
  }, [
    svgUse('tab-explore', 'tabbar-v2__pop-btn-icon'),
    h('span', { class: 'tabbar-v2__pop-btn-text' }, [
      h('span', {}, 'Explore routes'),
      h('span', { class: 'tabbar-v2__pop-btn-sub' }, 'Pick from the curated list')
    ])
  ]));
  return pop;
}

/* ----------------------------------------------------------------------------
   Profile sheet DOM
   ---------------------------------------------------------------------------- */
function buildProfileSheet() {
  const backdrop = h('div', {
    class: 'tabbar-v2__sheet-backdrop',
    'aria-hidden': 'true'
  });
  const heading = h('h2', {
    class: 'tabbar-v2__sheet-heading',
    id: 'tabbar-v2-profile-heading'
  }, 'Profile & menu');
  const sub = h('p', { class: 'tabbar-v2__sheet-sub' }, 'Settings, offers, feedback, and more.');

  const makeItem = (opts) => {
    const el = h(opts.href ? 'a' : 'button', {
      class: 'tabbar-v2__sheet-item' + (opts.danger ? ' tabbar-v2__sheet-item--danger' : ''),
      'data-action': opts.action,
      ...(opts.href ? { href: opts.href } : { type: 'button' }),
      role: 'menuitem'
    }, [
      svgUse(opts.icon, 'tabbar-v2__sheet-item-icon'),
      h('span', { class: 'tabbar-v2__sheet-item-label' }, opts.label),
      opts.badgeEl || null,
      opts.metaText ? h('span', { class: 'tabbar-v2__sheet-item-meta' }, opts.metaText) : null,
      opts.danger ? null : svgUse('tab-ic-chevron', 'tabbar-v2__sheet-item-chevron')
    ]);
    return el;
  };

  const offersBadge = h('span', { class: 'tabbar-v2__sheet-item-badge' });
  const offersItem  = makeItem({ icon: 'tab-ic-offers',    label: 'Offers nearby',  action: 'offers',  badgeEl: offersBadge });
  const fbItem      = makeItem({ icon: 'tab-ic-feedback',  label: 'Send feedback',  action: 'feedback' });
  const clItem      = makeItem({ icon: 'tab-ic-changelog', label: "What's new",      action: 'changelog' });
  const setItem     = makeItem({ icon: 'tab-ic-settings',  label: 'Settings',        action: 'settings' });
  const divider     = h('hr', { class: 'tabbar-v2__sheet-divider' });
  const outItem     = makeItem({ icon: 'tab-ic-signout',   label: 'Sign out',        action: 'signout', danger: true });

  const list = h('div', {
    class: 'tabbar-v2__sheet-list',
    role: 'menu',
    'aria-labelledby': 'tabbar-v2-profile-heading'
  }, [offersItem, fbItem, clItem, setItem, divider, outItem]);

  const sheet = h('div', {
    class: 'tabbar-v2__sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'tabbar-v2-profile-heading',
    tabindex: '-1',
    hidden: ''
  }, [
    h('div', { class: 'tabbar-v2__sheet-grabber', 'aria-hidden': 'true' }),
    heading,
    sub,
    list
  ]);
  backdrop.hidden = true;
  return { backdrop, sheet, offersBadge, items: { offers: offersItem, feedback: fbItem, changelog: clItem, settings: setItem, signout: outItem } };
}

/* ----------------------------------------------------------------------------
   Mount / destroy
   ---------------------------------------------------------------------------- */
function mount(container, opts = {}) {
  if (state) destroy();
  if (!container) throw new Error('TabBar.mount: container is required');

  const { bar, tabEls, fabEl, haloEl, indicator, popoverEl } = buildBar();
  const { backdrop, sheet, offersBadge, items: sheetItems } = buildProfileSheet();

  container.appendChild(bar);
  // Sheet + popover live on document.body so they escape any container with overflow:hidden.
  document.body.appendChild(popoverEl);
  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  state = {
    container, bar, tabEls, fabEl, haloEl, indicator,
    popoverEl, backdrop, sheet, offersBadge, sheetItems,
    activeTab: opts.initialTab || 'explore',
    onTabChange: typeof opts.onTabChange === 'function' ? opts.onTabChange : () => {},
    profileActions: opts.profileActions || {},
    listeners: [],
    prevFocus: null,
    sheetOpen: false,
    popoverOpen: false,
    badges: {}
  };

  wireTabClicks();
  wireFab();
  wireSheet();
  wireActiveWalkSync();
  wireResize();

  // Initial render
  applyActive(state.activeTab, { silent: true });
  refreshFabVisual();

  return PUBLIC_API;
}

function wireTabClicks() {
  Object.entries(state.tabEls).forEach(([name, { btn }]) => {
    const handler = () => activateTab(name);
    btn.addEventListener('click', handler);
    state.listeners.push(() => btn.removeEventListener('click', handler));
  });
}

function wireFab() {
  const onFab = (e) => {
    e.preventDefault();
    if (hasActiveWalk()) {
      const walkId = getActiveWalkId();
      window.dispatchEvent(new CustomEvent('we:resume-walk', { detail: { walkId } }));
      state.onTabChange('walk', { intent: 'resume', walkId });
      return;
    }
    // Toggle popover
    if (state.popoverOpen) closePopover();
    else openPopover();
  };
  state.fabEl.addEventListener('click', onFab);
  state.listeners.push(() => state.fabEl.removeEventListener('click', onFab));

  const onPop = (e) => {
    const btn = e.target.closest('[data-pop-action]');
    if (!btn) return;
    const action = btn.dataset.popAction;
    closePopover();
    if (action === 'start') {
      window.dispatchEvent(new CustomEvent('we:start-walk'));
      state.onTabChange('walk', { intent: 'start' });
    } else if (action === 'explore') {
      activateTab('explore');
    }
  };
  state.popoverEl.addEventListener('click', onPop);
  state.listeners.push(() => state.popoverEl.removeEventListener('click', onPop));

  // Click outside closes popover
  const onDocClick = (e) => {
    if (!state.popoverOpen) return;
    if (state.popoverEl.contains(e.target) || state.fabEl.contains(e.target)) return;
    closePopover();
  };
  document.addEventListener('click', onDocClick, true);
  state.listeners.push(() => document.removeEventListener('click', onDocClick, true));

  // Esc closes popover
  const onKey = (e) => {
    if (e.key === 'Escape' && state.popoverOpen) {
      closePopover();
      state.fabEl.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  state.listeners.push(() => document.removeEventListener('keydown', onKey));
}

function openPopover() {
  state.popoverEl.hidden = false;
  // Allow reflow for the transition
  requestAnimationFrame(() => state.popoverEl.classList.add('is-open'));
  state.popoverOpen = true;
  state.fabEl.setAttribute('aria-expanded', 'true');
}
function closePopover() {
  state.popoverEl.classList.remove('is-open');
  state.popoverOpen = false;
  state.fabEl.setAttribute('aria-expanded', 'false');
  // Delay hidden until transition done
  setTimeout(() => { if (!state.popoverOpen) state.popoverEl.hidden = true; }, 220);
}

function wireSheet() {
  // Backdrop click closes
  const onBd = () => closeProfile();
  state.backdrop.addEventListener('click', onBd);
  state.listeners.push(() => state.backdrop.removeEventListener('click', onBd));

  // Esc closes + focus trap
  const onKey = (e) => {
    if (!state.sheetOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeProfile();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = state.sheet.querySelectorAll('button, a, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  state.listeners.push(() => document.removeEventListener('keydown', onKey));

  // Item clicks
  const onItem = (e) => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    e.preventDefault();
    handleSheetAction(item.dataset.action);
  };
  state.sheet.addEventListener('click', onItem);
  state.listeners.push(() => state.sheet.removeEventListener('click', onItem));
}

function handleSheetAction(action) {
  const pa = state.profileActions;
  switch (action) {
    case 'offers':
      closeProfile();
      if (typeof pa.onOffers === 'function') return pa.onOffers();
      window.dispatchEvent(new CustomEvent('we:open-offers'));
      break;
    case 'feedback':
      closeProfile();
      if (typeof pa.onFeedback === 'function') return pa.onFeedback();
      window.location.href = 'mailto:hello@walkingexplorers.com?subject=Walking%20Explorers%20feedback';
      break;
    case 'changelog':
      closeProfile();
      if (typeof pa.onChangelog === 'function') return pa.onChangelog();
      window.dispatchEvent(new CustomEvent('we:open-changelog'));
      break;
    case 'settings':
      closeProfile();
      if (typeof pa.onSettings === 'function') return pa.onSettings();
      window.dispatchEvent(new CustomEvent('we:open-settings'));
      break;
    case 'signout':
      closeProfile();
      if (typeof pa.onSignOut === 'function') return pa.onSignOut();
      defaultSignOut();
      break;
  }
}

async function defaultSignOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (_) { /* swallow — still reload */ }
  try { localStorage.removeItem(ACTIVE_WALK_KEY); } catch (_) {}
  window.location.href = '/';
}

function wireActiveWalkSync() {
  const onChange = () => refreshFabVisual();
  window.addEventListener('storage', (e) => {
    if (e.key === ACTIVE_WALK_KEY) onChange();
  });
  window.addEventListener('we:active-walk-changed', onChange);
  state.listeners.push(() => window.removeEventListener('we:active-walk-changed', onChange));
}

function wireResize() {
  const onResize = () => positionIndicator();
  window.addEventListener('resize', onResize, { passive: true });
  state.listeners.push(() => window.removeEventListener('resize', onResize));
}

function refreshFabVisual() {
  if (!state) return;
  if (hasActiveWalk()) {
    state.fabEl.classList.add('is-walk-active');
    state.fabEl.setAttribute('aria-label', 'Resume walk in progress');
  } else {
    state.fabEl.classList.remove('is-walk-active');
    state.fabEl.setAttribute('aria-label', 'Start or continue a walk');
  }
}

/* ----------------------------------------------------------------------------
   Activation logic
   ---------------------------------------------------------------------------- */
function activateTab(name) {
  if (name === 'profile') {
    // Profile is a sheet, not a destination view. Activate visually while open.
    applyActive('profile');
    openProfile();
    state.onTabChange('profile');
    return;
  }
  applyActive(name);
  state.onTabChange(name);
}

function applyActive(name, { silent = false } = {}) {
  state.activeTab = name;
  Object.entries(state.tabEls).forEach(([n, { btn }]) => {
    const active = (n === name);
    btn.classList.toggle('is-active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  positionIndicator();
  if (silent) return;
}

function positionIndicator() {
  if (!state) return;
  const tab = state.tabEls[state.activeTab];
  if (!tab || state.activeTab === 'walk') {
    state.indicator.classList.remove('is-visible');
    return;
  }
  const barRect = state.bar.getBoundingClientRect();
  const btnRect = tab.btn.getBoundingClientRect();
  const x = (btnRect.left - barRect.left) + (btnRect.width / 2) - 2;
  state.indicator.style.transform = `translateX(${x}px)`;
  state.indicator.classList.add('is-visible');
}

/* ----------------------------------------------------------------------------
   Profile sheet open/close
   ---------------------------------------------------------------------------- */
function openProfile() {
  if (!state || state.sheetOpen) return;
  state.prevFocus = document.activeElement;
  state.sheet.hidden = false;
  state.backdrop.hidden = false;
  // Force reflow for transition
  requestAnimationFrame(() => {
    state.sheet.classList.add('is-open');
    state.backdrop.classList.add('is-open');
    state.sheet.focus();
    const firstItem = state.sheet.querySelector('[data-action]');
    if (firstItem) firstItem.focus();
  });
  state.sheetOpen = true;
}

function closeProfile() {
  if (!state || !state.sheetOpen) return;
  state.sheet.classList.remove('is-open');
  state.backdrop.classList.remove('is-open');
  state.sheetOpen = false;
  setTimeout(() => {
    if (state && !state.sheetOpen) {
      state.sheet.hidden = true;
      state.backdrop.hidden = true;
    }
  }, 420);
  // When closing, return to the previous tab visually (not profile)
  // The integrator can call setActive() again if needed.
  if (state.prevFocus && typeof state.prevFocus.focus === 'function') {
    try { state.prevFocus.focus(); } catch (_) {}
  }
}

/* ----------------------------------------------------------------------------
   Badge management
   ---------------------------------------------------------------------------- */
function setBadge(name, value) {
  if (!state) return;
  if (name === 'offers') {
    // Sheet sub-item badge
    const b = state.offersBadge;
    if (!value || value === 0) {
      b.classList.remove('is-visible');
      b.textContent = '';
    } else {
      b.textContent = value === 'dot' ? '•' : String(value);
      b.classList.add('is-visible');
    }
    return;
  }
  const tab = state.tabEls[name];
  if (!tab) return;
  const b = tab.badge;
  if (!value || value === 0) {
    b.classList.remove('is-visible');
    b.classList.remove('is-dot');
    b.textContent = '';
  } else if (value === 'dot') {
    b.classList.add('is-visible');
    b.classList.add('is-dot');
    b.textContent = '';
  } else {
    b.classList.add('is-visible');
    b.classList.remove('is-dot');
    b.textContent = String(value);
  }
  state.badges[name] = value;
}

/* ----------------------------------------------------------------------------
   Destroy
   ---------------------------------------------------------------------------- */
function destroy() {
  if (!state) return;
  state.listeners.forEach((off) => { try { off(); } catch (_) {} });
  [state.bar, state.popoverEl, state.backdrop, state.sheet].forEach((el) => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  state = null;
}

/* ----------------------------------------------------------------------------
   Public API
   ---------------------------------------------------------------------------- */
const PUBLIC_API = {
  mount,
  setActive: (name) => state && applyActive(name),
  setBadge,
  destroy,
  openProfile,
  closeProfile
};

export default PUBLIC_API;
export { mount, setBadge, destroy, openProfile, closeProfile };
