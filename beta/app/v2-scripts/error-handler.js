// error-handler.js — Walking Explorers v0.7
// Sentry wrapper + fallback to localStorage ring buffer.
//
// Public API:
//   import E from '/beta/app/v2-scripts/error-handler.js';
//   E.init({ dsn: window.SENTRY_DSN, release: 'walking-explorers@0.7.0', env: 'production' });
//   E.captureError(err, { context: 'walk_tracker', extra: { route_id } });
//   E.captureMessage('something noteworthy', 'info');
//   E.getRecentErrors();   // for admin panel
//   E.clearRecentErrors();
//
// Design rules:
//  - NULL-SAFE: if no DSN, Sentry never loads; errors still flow to console
//    + localStorage ring buffer + PostHog `app_error`.
//  - PRIVACY: photo blob: URLs and lat/lng-like strings are scrubbed from
//    breadcrumbs and error messages.
//  - SINGLE PIPE: ALL uncaught errors flow through one handler that also
//    fires T.track('app_error', ...) so PostHog sees them.

'use strict';

import T from '/beta/app/v2-scripts/telemetry.js';

const RING_KEY = 'we_recent_errors';
const RING_MAX = 20;
const SENTRY_CDN = 'https://browser.sentry-cdn.com/8.50.0/bundle.min.js';

const state = {
  initialized: false,
  loaded: false,
  dsn: null,
  release: 'walking-explorers@0.7.0',
  env: 'development',
  pending: []   // captured before Sentry was ready
};

// ---- Utilities -----------------------------------------------------------
function safeStorageGet(k){ try { return localStorage.getItem(k); } catch { return null; } }
function safeStorageSet(k,v){ try { localStorage.setItem(k,v); } catch {} }

function scrubString(s){
  if (typeof s !== 'string') return s;
  return s
    .replace(/blob:[^\s"')]+/g, '[blob-redacted]')
    .replace(/\b-?\d{1,3}\.\d{3,}\b\s*,\s*-?\d{1,3}\.\d{3,}\b/g, '[coords-redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email-redacted]');
}

function scrubBreadcrumb(b){
  if (!b || typeof b !== 'object') return b;
  try {
    if (b.message) b.message = scrubString(b.message);
    if (b.data) {
      for (const k of Object.keys(b.data)) {
        const v = b.data[k];
        if (typeof v === 'string') b.data[k] = scrubString(v);
      }
    }
  } catch(e){}
  return b;
}

function pushRingBuffer(entry){
  let arr = [];
  try { arr = JSON.parse(safeStorageGet(RING_KEY) || '[]'); } catch { arr = []; }
  arr.push(entry);
  if (arr.length > RING_MAX) arr = arr.slice(-RING_MAX);
  safeStorageSet(RING_KEY, JSON.stringify(arr));
}

function makeEntry(err, ctx){
  const e = (err && typeof err === 'object') ? err : { message: String(err) };
  return {
    ts: new Date().toISOString(),
    name: scrubString(String(e.name || 'Error')).slice(0,80),
    message: scrubString(String(e.message || '')).slice(0,500),
    stack: scrubString(String(e.stack || '')).slice(0,2000),
    context: ctx && ctx.context ? String(ctx.context).slice(0,80) : null,
    extra: ctx && ctx.extra ? safeJsonClone(ctx.extra) : null,
    we_ctx: T.getContext ? T.getContext() : null
  };
}

function safeJsonClone(o){
  try {
    return JSON.parse(JSON.stringify(o, (k,v)=> typeof v === 'string' ? scrubString(v) : v));
  } catch { return null; }
}

function tagsFromContext(){
  const c = T.getContext ? T.getContext() : {};
  return {
    screen: c.current_screen || 'unknown',
    route_id: c.current_route || 'none',
    tier: c.tier || 'unknown',
    session_id: c.session_id || 'none'
  };
}

function loadSentry(dsn, release, env){
  if (window.Sentry && window.Sentry.init) {
    initSentry(dsn, release, env);
    return;
  }
  const s = document.createElement('script');
  s.src = SENTRY_CDN;
  s.crossOrigin = 'anonymous';
  s.async = true;
  s.onload = () => initSentry(dsn, release, env);
  s.onerror = () => { /* fallback path: ring buffer + PostHog still work */ };
  document.head.appendChild(s);
}

function initSentry(dsn, release, env){
  try {
    window.Sentry.init({
      dsn,
      release,
      environment: env,
      tracesSampleRate: 0,        // perf off for now
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      beforeBreadcrumb(b){ return scrubBreadcrumb(b); },
      beforeSend(event){
        try {
          if (event && event.message) event.message = scrubString(event.message);
          if (event && event.exception && event.exception.values) {
            event.exception.values.forEach(v => {
              if (v.value) v.value = scrubString(v.value);
            });
          }
        } catch(e){}
        return event;
      }
    });
    state.loaded = true;
    // flush queued
    while (state.pending.length) {
      const { err, ctx } = state.pending.shift();
      sendToSentry(err, ctx);
    }
  } catch(e){ /* swallow */ }
}

function sendToSentry(err, ctx){
  if (!state.loaded || !window.Sentry) {
    state.pending.push({ err, ctx });
    return;
  }
  try {
    window.Sentry.withScope(scope => {
      const tags = tagsFromContext();
      Object.keys(tags).forEach(k => scope.setTag(k, tags[k]));
      if (ctx && ctx.context) scope.setTag('handler_context', ctx.context);
      if (ctx && ctx.extra)   scope.setExtras(safeJsonClone(ctx.extra) || {});
      if (err instanceof Error) window.Sentry.captureException(err);
      else window.Sentry.captureMessage(scrubString(String(err && err.message || err)));
    });
  } catch(e){}
}

// ---- Single error pipe ---------------------------------------------------
function handle(err, ctx){
  const entry = makeEntry(err, ctx);
  // 1. always: console
  try { console.error('[WE]', entry.context || '', entry.message, err); } catch(e){}
  // 2. always: ring buffer
  pushRingBuffer(entry);
  // 3. PostHog signal (one consolidated event)
  try { T.captureAppError && T.captureAppError(entry); } catch(e){}
  // 4. Sentry (if DSN present)
  if (state.dsn) sendToSentry(err, ctx);
}

// ---- Public API ----------------------------------------------------------
const E = {
  init(opts = {}) {
    if (state.initialized) return E;
    state.initialized = true;
    state.dsn = opts.dsn || null;
    state.release = opts.release || state.release;
    state.env = opts.env || state.env;

    // window.onerror
    window.addEventListener('error', (ev) => {
      const err = ev.error || new Error(ev.message || 'window.error');
      handle(err, { context: 'window_onerror', extra: {
        filename: ev.filename ? String(ev.filename).slice(0,200) : null,
        lineno: ev.lineno || null,
        colno: ev.colno || null
      }});
    });

    // unhandled promise rejection
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason;
      const err = (reason instanceof Error) ? reason : new Error(String(reason));
      handle(err, { context: 'unhandled_rejection' });
    });

    if (state.dsn) loadSentry(state.dsn, state.release, state.env);
    return E;
  },

  /** Manual capture. Always safe. */
  captureError(err, ctx = {}) {
    handle(err || new Error('unknown error'), ctx);
  },

  /** Lightweight message (info/warning/error). */
  captureMessage(msg, level = 'info') {
    const entry = {
      ts: new Date().toISOString(),
      name: 'Message',
      message: scrubString(String(msg)).slice(0,500),
      level,
      we_ctx: T.getContext ? T.getContext() : null
    };
    try { console.log('[WE:'+level+']', entry.message); } catch(e){}
    pushRingBuffer(entry);
    if (state.loaded && window.Sentry) {
      try {
        window.Sentry.withScope(scope => {
          scope.setLevel(level);
          const tags = tagsFromContext();
          Object.keys(tags).forEach(k => scope.setTag(k, tags[k]));
          window.Sentry.captureMessage(entry.message);
        });
      } catch(e){}
    }
  },

  /** Read recent errors (for admin panel support). */
  getRecentErrors() {
    try { return JSON.parse(safeStorageGet(RING_KEY) || '[]'); } catch { return []; }
  },

  clearRecentErrors() {
    safeStorageSet(RING_KEY, '[]');
  }
};

export default E;
