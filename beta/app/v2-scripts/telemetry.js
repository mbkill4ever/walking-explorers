// telemetry.js — Walking Explorers v0.7
// PostHog wrapper + tracking-plan implementation.
//
// Public API:
//   import T from '/beta/app/v2-scripts/telemetry.js';
//   T.init({ apiKey: window.POSTHOG_KEY, user: { id, tier, signupAt } });
//   T.identify(userId, traits);
//   T.track(eventName, props);
//   T.page(name);
//   T.optIn(); T.optOut();
//   T.captureAppError({ name, message, stack });  // used by error-handler
//
// Design rules:
//  - NULL-SAFE: every method is callable before init() and when no apiKey.
//  - PRIVACY: no photos, no GPS coords, no free-text content, no PII.
//  - OPT-OUT: localStorage.we_telemetry_opt === 'out' silences everything.
//  - QUEUED: events fired before PostHog finishes loading are buffered and
//    replayed on load.
//
// Event catalog: see agent_reports/v07_10_telemetry.md.

'use strict';

const OPT_KEY = 'we_telemetry_opt';
const DAILY_KEY = 'we_daily_active_utc';
const SESSION_ID_KEY = 'we_session_id';
const POSTHOG_CDN = 'https://app.posthog.com/static/array.js';
const POSTHOG_HOST = 'https://app.posthog.com';

// ---- Allowed event names (typed-ish guard) -------------------------------
const ALLOWED_EVENTS = new Set([
  // Acquisition / Activation
  'token_gate_viewed','code_submitted','code_claimed','app_loaded',
  'onboarding_started','onboarding_step_completed','onboarding_completed','onboarding_skipped',
  'first_route_viewed','first_walk_started','first_loop_completed','first_spot_saved',
  // Engagement
  'tab_switched','route_detail_viewed','walk_started','walk_stop_advanced',
  'walk_paused','walk_resumed','loop_completed','spot_saved',
  'feedback_submitted','feedback_voted','offer_clicked','offer_added_to_route',
  // v0.7 new features
  'around_me_opened','around_me_pin_tapped','around_me_offers_toggle',
  'ai_route_started','ai_route_question_answered','ai_route_generated','ai_route_walked',
  'search_opened','search_query','search_filter_applied',
  'share_sheet_opened','share_target_picked','referral_link_copied',
  'walk_tracker_started','walk_tracker_proximity_hit','walk_tracker_offroute',
  // Retention
  'session_started','session_ended','daily_active',
  // Revenue placeholders (v0.8)
  'paywall_shown','paywall_dismissed',
  'subscription_started','subscription_renewed','subscription_canceled',
  // Errors
  'app_error','$pageview'
]);

// ---- Module state --------------------------------------------------------
const state = {
  initialized: false,
  loaded: false,        // PostHog script loaded & ready
  apiKey: null,
  queue: [],            // [{ kind, args }] buffered until loaded
  user: null,
  superProps: {},       // attached to every track()
  context: {            // mutable runtime context
    current_route: null,
    current_screen: null,
    tier: null
  }
};

// ---- Utilities -----------------------------------------------------------
function safeStorageGet(k){ try { return localStorage.getItem(k); } catch { return null; } }
function safeStorageSet(k,v){ try { localStorage.setItem(k,v); } catch {} }

function isOptedOut(){
  return safeStorageGet(OPT_KEY) === 'out';
}

function newSessionId(){
  // 16 hex chars, opaque
  const buf = new Uint8Array(8);
  (crypto && crypto.getRandomValues) ? crypto.getRandomValues(buf) : buf.forEach((_,i)=>buf[i]=Math.floor(Math.random()*256));
  return Array.from(buf).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function getOrCreateSessionId(){
  let sid = safeStorageGet(SESSION_ID_KEY);
  if (!sid) { sid = newSessionId(); safeStorageSet(SESSION_ID_KEY, sid); }
  return sid;
}

function todayUTC(){
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function scrubProps(props){
  // Defensive scrub: drop keys that ever look like PII / photo blobs / GPS.
  if (!props || typeof props !== 'object') return {};
  const out = {};
  const BANNED = /^(email|name|first_name|last_name|full_name|phone|address|photo|photo_url|image_url|blob|lat|lng|latitude|longitude|coords|notes|note|feedback_text|free_text|query_text)$/i;
  for (const k of Object.keys(props)) {
    if (BANNED.test(k)) continue;
    const v = props[k];
    if (typeof v === 'string' && v.startsWith('blob:')) continue;
    if (typeof v === 'string' && v.length > 500) { out[k] = v.slice(0,500); continue; }
    out[k] = v;
  }
  return out;
}

function loadPostHog(apiKey){
  // Inline the official PostHog snippet (trimmed). Loads array.js async.
  if (window.posthog && window.posthog.__loaded) { state.loaded = true; flushQueue(); return; }
  if (window.posthog) {
    // Snippet already on page — just init.
    try {
      window.posthog.init(apiKey, {
        api_host: POSTHOG_HOST,
        capture_pageview: false,
        persistence: 'localStorage+cookie',
        loaded: () => { state.loaded = true; flushQueue(); }
      });
    } catch(e){ /* no-op */ }
    return;
  }
  // Inline stub mimicking PostHog's official loader
  !function(t,e){
    var o,n,p,r;
    e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){
      function g(t,e){
        var o=e.split('.');
        2==o.length&&(t=t[o[0]],e=o[1]);
        t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)));};
      }
      (p=t.createElement('script')).type='text/javascript';
      p.async=!0;
      p.src=s.api_host+'/static/array.js';
      (r=t.getElementsByTagName('script')[0]).parentNode.insertBefore(p,r);
      var u=e;for(void 0!==a?u=e[a]=[]:a='posthog',u.people=u.people||[],u.toString=function(t){var e='posthog';return'posthog'!==a&&(e+='.'+a),t||(e+=' (stub)'),e;},u.people.toString=function(){return u.toString(1)+'.people (stub)';},o='capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId'.split(' '),n=0;n<o.length;n++)g(u,o[n]);
      e._i.push([i,s,a]);
    },e.__SV=1);
  }(document, window.posthog || []);
  try {
    window.posthog.init(apiKey, {
      api_host: POSTHOG_HOST,
      capture_pageview: false,
      persistence: 'localStorage+cookie',
      loaded: () => { state.loaded = true; flushQueue(); }
    });
  } catch(e){ /* no-op */ }
}

function flushQueue(){
  if (!state.loaded || !window.posthog) return;
  while (state.queue.length) {
    const { kind, args } = state.queue.shift();
    try {
      if (kind === 'track')    window.posthog.capture(args[0], args[1]);
      else if (kind === 'identify') window.posthog.identify(args[0], args[1]);
      else if (kind === 'page') window.posthog.capture('$pageview', args[0]);
      else if (kind === 'optIn')  window.posthog.opt_in_capturing && window.posthog.opt_in_capturing();
      else if (kind === 'optOut') window.posthog.opt_out_capturing && window.posthog.opt_out_capturing();
    } catch(e) { /* no-op */ }
  }
}

// ---- Public API ----------------------------------------------------------
const T = {
  /**
   * Init telemetry. Safe to call multiple times.
   * If apiKey is falsy or user is opted out, becomes a no-op shell.
   */
  init(opts = {}) {
    if (state.initialized) return T;
    state.initialized = true;
    state.apiKey = opts.apiKey || null;
    state.user   = opts.user || null;

    // Always set up session signals, even with no key (lets us flush to PostHog later if injected)
    const sid = getOrCreateSessionId();
    state.superProps = {
      session_id: sid,
      app_version: '0.7.0',
      platform: 'web'
    };

    // Fire app_loaded + session_started (queued if PostHog not yet loaded)
    T.track('app_loaded', {});
    T.track('session_started', { session_id: sid });

    // daily_active — once per UTC day
    const last = safeStorageGet(DAILY_KEY);
    const today = todayUTC();
    if (last !== today) {
      safeStorageSet(DAILY_KEY, today);
      T.track('daily_active', { date: today });
    }

    // session_ended on unload (best effort)
    const start = Date.now();
    const sendEnd = () => {
      try {
        const dur = Math.round((Date.now() - start) / 1000);
        T.track('session_ended', { duration_s: dur, session_id: sid });
      } catch(e){}
    };
    window.addEventListener('pagehide', sendEnd, { once: true });
    window.addEventListener('beforeunload', sendEnd, { once: true });

    if (state.apiKey && !isOptedOut()) {
      loadPostHog(state.apiKey);
    }

    if (state.user && state.user.id) {
      T.identify(state.user.id, {
        tier: state.user.tier,
        signup_at: state.user.signupAt
      });
      state.context.tier = state.user.tier || null;
    }

    return T;
  },

  /**
   * Identify the current user. userId is opaque (no PII).
   */
  identify(userId, traits = {}) {
    if (!userId) return;
    if (isOptedOut()) return;
    const cleanTraits = scrubProps(traits);
    if (state.loaded && window.posthog) {
      try { window.posthog.identify(userId, cleanTraits); } catch(e){}
    } else {
      state.queue.push({ kind: 'identify', args: [userId, cleanTraits] });
    }
  },

  /**
   * Track a named event with props. Unknown event names are logged in dev
   * but still sent — better to over-report than to drop.
   */
  track(eventName, props = {}) {
    if (!eventName || typeof eventName !== 'string') return;
    if (isOptedOut()) return;
    if (!ALLOWED_EVENTS.has(eventName) && eventName !== '$pageview') {
      // eslint-disable-next-line no-console
      try { console.warn('[telemetry] unknown event:', eventName); } catch(e){}
    }
    const merged = Object.assign(
      {},
      state.superProps,
      {
        screen: state.context.current_screen || null,
        route_id: state.context.current_route || null,
        tier: state.context.tier || null
      },
      scrubProps(props)
    );
    if (state.loaded && window.posthog) {
      try { window.posthog.capture(eventName, merged); } catch(e){}
    } else {
      state.queue.push({ kind: 'track', args: [eventName, merged] });
    }
  },

  /**
   * Logical page view (single-page app screens).
   */
  page(name) {
    if (!name) return;
    state.context.current_screen = name;
    if (isOptedOut()) return;
    const merged = Object.assign({}, state.superProps, { screen: name });
    if (state.loaded && window.posthog) {
      try { window.posthog.capture('$pageview', merged); } catch(e){}
    } else {
      state.queue.push({ kind: 'page', args: [merged] });
    }
  },

  /**
   * Update mutable runtime context tags (current_route, current_screen, tier).
   */
  setContext(patch = {}) {
    Object.assign(state.context, patch || {});
  },

  /** Return current context (read-only copy) — used by error-handler. */
  getContext() {
    return Object.assign({
      session_id: state.superProps.session_id || null
    }, state.context);
  },

  /** Register super props sent with every event. */
  register(props = {}) {
    Object.assign(state.superProps, scrubProps(props));
  },

  optIn() {
    safeStorageSet(OPT_KEY, 'in');
    if (state.loaded && window.posthog && window.posthog.opt_in_capturing) {
      try { window.posthog.opt_in_capturing(); } catch(e){}
    } else {
      state.queue.push({ kind: 'optIn', args: [] });
    }
  },

  optOut() {
    safeStorageSet(OPT_KEY, 'out');
    if (state.loaded && window.posthog && window.posthog.opt_out_capturing) {
      try { window.posthog.opt_out_capturing(); } catch(e){}
    }
    // Drop any pending queue
    state.queue.length = 0;
  },

  isOptedOut,

  /**
   * Called by error-handler so PostHog sees errors too. Not user-facing.
   */
  captureAppError(err = {}) {
    T.track('app_error', {
      name: String(err.name || 'Error').slice(0,80),
      message: String(err.message || '').slice(0,200),
      stack_short: String(err.stack || '').split('\n').slice(0,3).join(' | ').slice(0,400)
    });
  }
};

export default T;
