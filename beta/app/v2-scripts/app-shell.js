/* Walking Explorers — app shell (legacy + v2 hooks). Extracted from index.html. */
"use strict";

/* ===== Escape helper (prevents XSS) ===== */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

/* ===== Lazy Leaflet loader ===== */
const LeafletLoader = {
  _promise: null,
  load() {
    if (typeof window.L !== 'undefined') return Promise.resolve(window.L);
    if (this._promise) return this._promise;
    this._promise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      s.crossOrigin = '';
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error('leaflet_load_failed'));
      document.head.appendChild(s);
    });
    return this._promise;
  }
};

/* ===== API client (cookie-based; auto-redirect on 401) ===== */
const API = {
  async _fetch(path, opts = {}) {
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const r = await fetch(path, opts);
    if (r.status === 401) { location.href = '/beta'; throw new Error('unauth'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'api_error'), { data, status: r.status });
    return data;
  },
  me() { return this._fetch('/api/auth/me'); },
  signOut() { return this._fetch('/api/auth/logout', { method: 'POST' }); },
  generateRoute(body) { return this._fetch('/api/routes/generate', { method: 'POST', body: JSON.stringify(body || {}) }); },
  spotsList() { return this._fetch('/api/spots/list'); },
  spotsSave(body) { return this._fetch('/api/spots/save', { method: 'POST', body: JSON.stringify(body) }); },
  spotsDelete(id) { return this._fetch('/api/spots/delete', { method: 'POST', body: JSON.stringify({ id }) }); },
  loopsSave(body) { return this._fetch('/api/loops/save', { method: 'POST', body: JSON.stringify(body) }); },
  loopsList() { return this._fetch('/api/loops/list'); },
  fbSubmit(body) { return this._fetch('/api/feedback/submit', { method: 'POST', body: JSON.stringify(body) }); },
  fbList(type) { return this._fetch('/api/feedback/list?type=' + encodeURIComponent(type || 'feature')); },
  fbVote(id) { return this._fetch('/api/feedback/vote', { method: 'POST', body: JSON.stringify({ id }) }); }
};

/* ===== Static client data ===== */
const NEIGHBORHOODS = [
  { id:'soho', name:'SoHo', grad:'linear-gradient(155deg, #C57E5E 0%, #6B3624 60%, #1F1108 100%)' },
  { id:'ev', name:'East Village', grad:'linear-gradient(155deg, #B85042 0%, #4A1812 60%, #16060A 100%)' },
  { id:'westvillage', name:'West Village', grad:'linear-gradient(155deg, #9CB585 0%, #3F5532 60%, #0F1A0E 100%)' },
  { id:'chelsea', name:'Chelsea', grad:'linear-gradient(155deg, #84B59F 0%, #2C5F2D 60%, #0E1F12 100%)' },
  { id:'williamsburg', name:'Williamsburg', grad:'linear-gradient(155deg, #E0B341 0%, #8C5B00 60%, #271800 100%)' },
  { id:'dumbo', name:'DUMBO', grad:'linear-gradient(155deg, #6D2E46 0%, #3A1226 60%, #14060D 100%)' },
  { id:'centralpark', name:'Central Park', grad:'linear-gradient(155deg, #4D7A4F 0%, #1F4521 60%, #0A1A0B 100%)' },
  { id:'les', name:'Lower East Side', grad:'linear-gradient(155deg, #C84B31 0%, #5C2114 60%, #1B0904 100%)' }
];

const TAGS = ['Café','Food','Hidden Gem','Work Spot','Date Spot','Viewpoint','Art','Nature','Shop','Revisit'];
const RATINGS = [
  { id:'low', label:'Low', color:'#6B7280' },
  { id:'medium', label:'Medium', color:'#5C9FE0' },
  { id:'high', label:'High', color:'#E0B341' },
  { id:'legendary', label:'Legendary', color:'#DC2626' }
];

const ROUTES = [
  { id:'soho_aesthetic', title:"SoHo Aesthetic Café Crawl", nbhd:'soho', minutes:90, miles:1.7,
    desc:"A photo-perfect loop through SoHo's cast-iron streets — cafés, vintage stores, and tucked-away galleries.",
    stops:[
      { name:'Joe Coffee — Crosby St', lat:40.7224, lon:-73.9966, why:"Quietest of NYC's prettiest café spots.", desc:'Small, warm café with reclaimed-wood interiors.' },
      { name:'McNally Jackson Books', lat:40.7232, lon:-73.9979, why:'Independent bookshop that fits your aesthetic.', desc:'Two-floor independent.' },
      { name:'Lure Fishbar', lat:40.7240, lon:-73.9975, sponsored:true, why:'Sponsored stop — native ad model.', desc:'Stylish underground fish house.' },
      { name:'INA SoHo', lat:40.7244, lon:-73.9989, why:'Carries Prada / Chanel resale.', desc:'Consignment sweet spot.' },
      { name:'Donut Plant', lat:40.7200, lon:-73.9943, why:'Mid-walk sweet break.', desc:'NYC institution since 1994.' },
      { name:'Mercer Street vista', lat:40.7253, lon:-73.9985, why:'Cobblestones + cast-iron + golden hour.', desc:'Most-photographed block.' }
    ]},
  { id:'ev_vintage', title:'East Village Vintage & Vinyl', nbhd:'ev', minutes:110, miles:2.0,
    desc:'Old New York at its weirdest — record stores, leather, downtown cafés.',
    stops:[
      { name:'Veselka', lat:40.7286, lon:-73.9891, why:'24-hour Ukrainian diner.', desc:'Pierogis and borscht.' },
      { name:'Astor Place neon', lat:40.7297, lon:-73.9911, why:'Photogenic neon.', desc:'Three floors of barber chairs.' },
      { name:'Other Music vinyl', lat:40.7281, lon:-73.9912, why:'Music mood — vinyl, listening booths.', desc:'Spiritual successor.' },
      { name:'Tompkins Square Park', lat:40.7264, lon:-73.9818, why:'Heart of EV culture.', desc:'Elm trees, chess tables.' },
      { name:"L'imprimerie", lat:40.7236, lon:-73.9847, sponsored:true, why:'Sponsored — French bakery.', desc:'Croissants out of the oven at 4pm.' },
      { name:'Russ & Daughters Café', lat:40.7222, lon:-73.9894, why:'Closes the walk on classic LES.', desc:'Spinoff of the 1914 appetizing shop.' }
    ]},
  { id:'wv_books', title:'West Village Bookshops & Brownstones', nbhd:'westvillage', minutes:75, miles:1.4,
    desc:'Bookshops most visitors miss.',
    stops:[
      { name:'Three Lives & Company', lat:40.7345, lon:-74.0019, why:'Bookshop you bookmarked.', desc:'Tiny, perfect, since 1968.' },
      { name:'Bleecker Street walk', lat:40.7340, lon:-74.0035, why:'Brownstone density peak.', desc:'Iconic NYC streetscape.' },
      { name:'Caffè Reggio', lat:40.7301, lon:-73.9998, why:"Greenwich Village's first cappuccino.", desc:'Same espresso machine since the 1900s.' },
      { name:'Strand Annex', lat:40.7332, lon:-74.0003, why:'Strand needs no introduction.', desc:'Rare-books section.' },
      { name:'Magnolia Bakery', lat:40.7351, lon:-74.0061, sponsored:true, why:'Sponsored — banana pudding.', desc:'Banana pudding is the move.' },
      { name:'Hudson River sunset', lat:40.7363, lon:-74.0094, why:'Best Manhattan-side sunset.', desc:'30–60 min before sunset.' }
    ]},
  { id:'highline_galleries', title:'High Line + Chelsea Galleries', nbhd:'chelsea', minutes:130, miles:2.4,
    desc:'Walk the elevated park, drop down for galleries, end at Little Island.',
    stops:[
      { name:'High Line — Gansevoort', lat:40.7396, lon:-74.0087, why:'Best entrance.', desc:'Start the elevated walk here.' },
      { name:'Whitney Museum patio', lat:40.7396, lon:-74.0089, why:'Free outdoor sculpture terraces.', desc:'Skip the lobby, take the side stairs.' },
      { name:'Pace Gallery', lat:40.7474, lon:-74.0064, why:"Pace's 540 W 25th flagship is free.", desc:'Multi-floor contemporary.' },
      { name:'Cookshop', lat:40.7457, lon:-74.0064, sponsored:true, why:'Sponsored — killer brunch.', desc:'Chelsea staple.' },
      { name:'Little Island', lat:40.7430, lon:-74.0125, why:"Heatherwick's tulip-pier park.", desc:'Free; the amphitheater is worth the climb.' },
      { name:'Chelsea Market', lat:40.7424, lon:-74.0061, why:'Indoor finish — food, vendors.', desc:'Lobster Place lobster roll.' }
    ]},
  { id:'williamsburg', title:'Williamsburg Street Art Walk', nbhd:'williamsburg', minutes:100, miles:1.9,
    desc:"Brooklyn's mural belt + cafés and vinyl shops.",
    stops:[
      { name:'Bedford Ave subway', lat:40.7170, lon:-73.9569, why:'Best people-watching.', desc:'Take the L from Manhattan.' },
      { name:'Devoción', lat:40.7128, lon:-73.9579, why:'Most-photographed plant wall.', desc:'Order the geisha pour-over.' },
      { name:'Bushwick Inlet murals', lat:40.7232, lon:-73.9620, why:'Rotating large-format murals.', desc:'Photogenic; afternoon light.' },
      { name:'Rough Trade NYC', lat:40.7176, lon:-73.9612, why:'Vinyl, listening booths.', desc:'Spend 30 minutes minimum.' },
      { name:'Five Leaves', lat:40.7234, lon:-73.9540, sponsored:true, why:'Sponsored — brunch.', desc:"Heath Ledger's old hangout." },
      { name:'Domino Park sunset', lat:40.7141, lon:-73.9686, why:'Wide-frame Manhattan skyline.', desc:'Old sugar-refinery park.' }
    ]},
  { id:'dumbo_bridge', title:'DUMBO + Brooklyn Bridge Loop', nbhd:'dumbo', minutes:90, miles:1.8,
    desc:'Cross the bridge, descend into DUMBO, end at the framed-bridge view.',
    stops:[
      { name:'Brooklyn Bridge', lat:40.7058, lon:-73.9966, why:'Walk pedestrian path.', desc:'~25 min to cross.' },
      { name:'Empire Stores', lat:40.7038, lon:-73.9881, why:'Renovated 1870s warehouse.', desc:'Take the elevator to the roof.' },
      { name:'Time Out Market', lat:40.7036, lon:-73.9888, why:'Curated Brooklyn-best food.', desc:"Pizza Moto's slice." },
      { name:'Washington Street view', lat:40.7035, lon:-73.9897, why:'Most-photographed framed-bridge.', desc:'Patience. Worth it.' },
      { name:"Jane's Carousel", lat:40.7037, lon:-73.9926, sponsored:true, why:'Sponsored — 1922 carousel.', desc:'$2 to ride.' },
      { name:'Pebble Beach', lat:40.7026, lon:-73.9926, why:'Water-level Manhattan view.', desc:'Skim stones.' }
    ]},
  { id:'central_park', title:'Central Park Hidden Corners', nbhd:'centralpark', minutes:120, miles:2.3,
    desc:'Skip the tourist track. Secret gardens, the rambles.',
    stops:[
      { name:'Conservatory Garden', lat:40.7950, lon:-73.9521, why:"Park's only formal garden.", desc:'Best in spring/fall.' },
      { name:'The Pool', lat:40.7948, lon:-73.9598, why:'Quietest body of water.', desc:'Bring a book.' },
      { name:'Belvedere Castle', lat:40.7794, lon:-73.9692, why:'Best aerial view.', desc:'Free to enter.' },
      { name:'Shakespeare Garden', lat:40.7802, lon:-73.9701, why:'Plants only mentioned in Shakespeare.', desc:"You'll be the only one in here." },
      { name:'Loeb Boathouse', lat:40.7754, lon:-73.9692, sponsored:true, why:'Sponsored — boat for $20.', desc:'Bar service available.' },
      { name:'Strawberry Fields', lat:40.7757, lon:-73.9745, why:"Lennon's spot.", desc:'Often quiet weekday mornings.' }
    ]},
  { id:'les_food', title:'Lower East Side Foodie Crawl', nbhd:'les', minutes:110, miles:1.6,
    desc:'Old-immigrant New York meets new-immigrant New York.',
    stops:[
      { name:'Pickle Guys', lat:40.7156, lon:-73.9923, why:'Last remaining pickle vendor.', desc:'Sour, half-sour, full-sour.' },
      { name:'Russ & Daughters Café', lat:40.7222, lon:-73.9894, why:'Bagel + lox pilgrimage.', desc:'Sit at the counter.' },
      { name:'Tenement Museum', lat:40.7188, lon:-73.9904, why:'Preserved 1880s tenement.', desc:'Book a tour.' },
      { name:"Joe's Shanghai", lat:40.7169, lon:-73.9952, sponsored:true, why:'Sponsored — soup dumplings.', desc:'Order the crab.' },
      { name:'Economy Candy', lat:40.7180, lon:-73.9892, why:'Vintage candy store.', desc:'Bring cash.' },
      { name:'Attaboy', lat:40.7178, lon:-73.9915, why:'Hidden bar, no menu.', desc:'Knock on 134 Eldridge.' }
    ]},
  { id:'soho_galleries', title:'SoHo Hidden Galleries', nbhd:'soho', minutes:100, miles:1.5,
    desc:'Galleries, lofts, streets that defined American art.',
    stops:[
      { name:'Drawing Center', lat:40.7220, lon:-74.0008, why:'Free; only nonprofit for drawing.', desc:'Tiny but punches above weight.' },
      { name:'Donald Judd Foundation', lat:40.7256, lon:-73.9981, why:'His preserved studio loft.', desc:'$32. Worth every dollar.' },
      { name:'The Earth Room', lat:40.7240, lon:-73.9994, sponsored:true, why:'Sponsored — 250 cu yd of dirt.', desc:'141 Wooster.' },
      { name:'Broken Kilometer', lat:40.7251, lon:-74.0023, why:'Another De Maria piece.', desc:'Cool and meditative.' },
      { name:'Housing Works Bookstore', lat:40.7232, lon:-74.0012, why:'Charity shop + literary events.', desc:'Proceeds fight HIV.' },
      { name:'Greene Street cobblestones', lat:40.7240, lon:-74.0003, why:'Most-photographed block.', desc:'Best afternoon light.' }
    ]},
  { id:'uws_classic', title:'Upper West Side Classic NY', nbhd:'centralpark', minutes:110, miles:2.0,
    desc:"Lincoln Center to Zabar's — UWS culture.",
    stops:[
      { name:'Lincoln Center plaza', lat:40.7727, lon:-73.9837, why:'Iconic NYC arts plaza.', desc:'Free during the day.' },
      { name:'Westsider Books', lat:40.7891, lon:-73.9742, why:'Three floors of stacks.', desc:'Cash preferred.' },
      { name:"Zabar's", lat:40.7886, lon:-73.9788, why:'Only UWS institution that matters.', desc:'Hot babka. Always.' },
      { name:'Cafe Lalo', lat:40.7837, lon:-73.9777, sponsored:true, why:"Sponsored — You've Got Mail.", desc:'Order the linzer torte.' },
      { name:'AMNH plaza', lat:40.7813, lon:-73.9740, why:'Architecture lesson.', desc:'Roosevelt + columns.' },
      { name:'Riverside Park overlook', lat:40.7872, lon:-73.9817, why:'Hudson sunset.', desc:'Bring a coffee.' }
    ]},
  { id:'harlem_history', title:'Harlem Renaissance Walk', nbhd:'centralpark', minutes:120, miles:2.2,
    desc:'The neighborhood that invented modern American culture.',
    stops:[
      { name:'Studio Museum in Harlem', lat:40.8085, lon:-73.9466, why:'Premier museum.', desc:'Free Sundays.' },
      { name:'Apollo Theater', lat:40.8104, lon:-73.9504, why:'Music history.', desc:'Take the photo.' },
      { name:"Sylvia's", lat:40.8086, lon:-73.9402, sponsored:true, why:'Sponsored — since 1962.', desc:'Sunday gospel brunch.' },
      { name:"Strivers' Row", lat:40.8169, lon:-73.9437, why:'Most photogenic brownstone block.', desc:'138th & 139th, 7th–8th.' },
      { name:'Schomburg Center', lat:40.8141, lon:-73.9402, why:'Research library, gorgeous interior.', desc:'Black history archives.' },
      { name:'Marcus Garvey Park', lat:40.8045, lon:-73.9438, why:'Bell tower for skyline views.', desc:'Free; mid-afternoon.' }
    ]},
  { id:'fidi_finance', title:'Financial District Old Manhattan', nbhd:'dumbo', minutes:90, miles:1.7,
    desc:'Original Manhattan — narrow streets, Dutch grid.',
    stops:[
      { name:'Stone Street', lat:40.7038, lon:-74.0117, why:'Cobblestone outdoor dining.', desc:'Lunch crowds 12-2pm.' },
      { name:'Trinity Church', lat:40.7081, lon:-74.0119, why:'Hamilton, Burr.', desc:'Free, quiet.' },
      { name:'Charging Bull / Fearless Girl', lat:40.7055, lon:-74.0134, why:'Most-photographed sculptures.', desc:'Aim 7am or evening.' },
      { name:'Fraunces Tavern', lat:40.7034, lon:-74.0117, sponsored:true, why:"Sponsored — Washington's farewell.", desc:'Tavern + small museum.' },
      { name:'9/11 Memorial pools', lat:40.7115, lon:-74.0134, why:'Treat with care.', desc:'Free. Allow time.' },
      { name:'Battery Park sunset', lat:40.7032, lon:-74.0170, why:'Statue of Liberty + harbor.', desc:'Stay for the lights.' }
    ]}
];

const PROMOTIONS = [
  { id:'p1', business:'Joe Coffee — Crosby St', offer:'15% off latte before 6 PM', expires:'Today, 6 PM', priceTier:'$$', nbhd:'soho', distance:'0.3 mi', sponsored:true, lat:40.7224, lon:-73.9966 },
  { id:'p2', business:'Devoción', offer:'Free pour-over with any pastry, 2-4 PM', expires:'Today, 4 PM', priceTier:'$$', nbhd:'williamsburg', distance:'1.2 mi', sponsored:true, lat:40.7128, lon:-73.9579 },
  { id:'p3', business:'Five Leaves', offer:'$12 brunch ricotta pancakes', expires:'This weekend', priceTier:'$$$', nbhd:'williamsburg', distance:'1.4 mi', sponsored:true, lat:40.7234, lon:-73.9540 },
  { id:'p4', business:'Donut Plant', offer:'Buy 3, get 1 free', expires:'All week', priceTier:'$', nbhd:'soho', distance:'0.5 mi', sponsored:false, lat:40.7200, lon:-73.9943 },
  { id:'p5', business:'INA SoHo (vintage)', offer:'20% off Prada resale this weekend', expires:'Sunday', priceTier:'$$$', nbhd:'soho', distance:'0.4 mi', sponsored:true, lat:40.7244, lon:-73.9989 },
  { id:'p6', business:'McNally Jackson Books', offer:'Free coffee w/ any book Tues–Thurs', expires:'Ongoing', priceTier:'$$', nbhd:'soho', distance:'0.4 mi', sponsored:false, lat:40.7232, lon:-73.9979 },
  { id:'p7', business:'Three Lives & Co.', offer:'$5 off staff-pick books', expires:'This month', priceTier:'$$', nbhd:'westvillage', distance:'0.9 mi', sponsored:false, lat:40.7345, lon:-74.0019 },
  { id:'p8', business:'Russ & Daughters Café', offer:'Half-off bagels & lox before 9 AM', expires:'Weekdays, 9 AM', priceTier:'$$$', nbhd:'les', distance:'0.7 mi', sponsored:true, lat:40.7222, lon:-73.9894 }
];

/* ===== Helpers ===== */
function coverArt(seed) {
  if (typeof seed !== 'string') seed = (seed && seed.id) || 'x';
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h*31 + seed.charCodeAt(i)) & 0xffffffff;
  const palettes = [['#1F3864','#5C9FE0','#E0B341'],['#6D2E46','#C84B31','#E0B341'],['#2C5F2D','#84B59F','#F2D67D'],['#0E1B30','#2E75B6','#F2D67D'],['#5B7C5B','#97BC62','#E0B341'],['#B85042','#E0B341','#FAF7F2'],['#1F3864','#B8941F','#FAF7F2'],['#162B4A','#5C9FE0','#E0B341'],['#028090','#E0B341','#F2D67D'],['#36454F','#5C9FE0','#E0B341'],['#6F4E7C','#E0B341','#F2D67D'],['#1A4D2E','#84B59F','#FAF7F2']];
  const pal = palettes[Math.abs(h) % palettes.length];
  return 'background:radial-gradient(circle at 20% 20%, '+pal[2]+' 0%, transparent 35%),radial-gradient(circle at 80% 80%, '+pal[1]+' 0%, transparent 45%),linear-gradient(135deg, '+pal[0]+' 0%, '+pal[1]+' 90%);';
}
function fmtMins(m) {
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? h + 'h ' + rem + 'm' : h + ' hr';
}
function routeById(id) { return ROUTES.find(r => r.id === id); }

/* ===== State ===== */
const State = {
  user: null, suggested: [], currentRoute: null,
  walkIdx: 0, walkPhotos: 0,
  archiveView: 'list', spots: [], loops: [],
  fbType: 'feature', fbItems: []
};

/* ===== Telemetry (PostHog stub) ===== */
const Telemetry = {
  ready: false,
  init() {
    try {
      // PostHog snippet — placeholder key; real key injected via env at deploy time.
      !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
      window.posthog.init('phc_PLACEHOLDER', { api_host: 'https://app.posthog.com', capture_pageview: false });
      this.ready = true;
    } catch (e) { /* fail silent */ }
  },
  identify(user) {
    if (!this.ready || !user) return;
    try {
      window.posthog.identify(user.id || user.email || 'anon', {
        email: user.email,
        loops_completed: user.loops_completed,
        cohort: user.cohort
      });
    } catch (e) {}
  },
  track(event, props) {
    if (!this.ready) return;
    try { window.posthog.capture(event, props || {}); } catch (e) {}
  }
};

/* ===== Toast ===== */
const Toast = {
  show(msg) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; region.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(window.__t);
    window.__t = setTimeout(() => el.classList.remove('show'), 2400);
  }
};

/* ===== Body lock for modals ===== */
const ModalLock = {
  _openCount: 0,
  open(modalEl) {
    if (modalEl) {
      modalEl.classList.add('show');
      modalEl.setAttribute('aria-hidden', 'false');
    }
    this._openCount++;
    document.body.classList.add('modal-open');
    // Focus trap setup
    if (modalEl) {
      this._lastFocus = document.activeElement;
      setTimeout(() => {
        const focusable = modalEl.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
        if (focusable.length) focusable[0].focus();
      }, 60);
    }
  },
  close(modalEl) {
    if (modalEl) {
      modalEl.classList.remove('show');
      modalEl.setAttribute('aria-hidden', 'true');
    }
    this._openCount = Math.max(0, this._openCount - 1);
    if (this._openCount === 0) document.body.classList.remove('modal-open');
    if (this._lastFocus && this._lastFocus.focus) try { this._lastFocus.focus(); } catch (e) {}
  }
};

/* Esc closes any open modal */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const cap = document.getElementById('captureModal');
    const spot = document.getElementById('spotModal');
    if (cap && cap.classList.contains('show')) Capture.close();
    else if (spot && spot.classList.contains('show')) Archive.closeSpot();
  }
  // Focus trap inside modals
  if (e.key === 'Tab') {
    const modal = document.querySelector('.modal.show');
    if (!modal) return;
    const f = modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});

/* ===== App boot ===== */
const App = {
  async init() {
    Telemetry.init();
    Telemetry.track('app_loaded');
    // Best-effort: warm v2 data caches in parallel with auth.
    if (window.WE_V2) {
      try { window.WE_V2.loadMicrocopy(); } catch (e) {}
      try { window.WE_V2.loadPhotos(); } catch (e) {}
    }
    try {
      const me = await API.me();
      State.user = me.user;
      Telemetry.identify(State.user);
      // Make sure v2 data is fully loaded before first paint (with a timeout).
      if (window.WE_V2) {
        try {
          await Promise.race([
            Promise.all([window.WE_V2.loadMicrocopy(), window.WE_V2.loadPhotos()]),
            new Promise(res => setTimeout(res, 1500))
          ]);
        } catch (e) {}
      }
      { const b = document.getElementById('boot'); if (b) b.style.display = 'none'; }
      // Expose state for v2 modules BEFORE any of them mount.
      window.State = State;
      window.ROUTES = ROUTES;
      window.PROMOTIONS = PROMOTIONS;
      window.NEIGHBORHOODS = NEIGHBORHOODS;
      window.Nav = Nav;
      window.Walk = Walk;
      window.Archive = Archive;
      window.Render = Render;
      window.Telemetry = Telemetry;
      window.esc = esc;

      // v0.7 — mount Tab Bar v2 (replaces legacy nav). Failures are tolerated — legacy nav stays as fallback.
      try { await App._mountTabBar(); }
      catch (e) { try { console.warn('[v0.7] TabBar v2 mount failed; legacy tab bar enabled', e); } catch(_){} ; try { document.getElementById('tabbar').classList.remove('hidden'); } catch(_){} }

      // v0.7 — Onboarding gate (first-launch only).
      let didOnboard = false;
      try {
        const obMod = await import('/beta/app/v2-screens/onboarding.js').catch(() => null);
        const Ob = obMod && (obMod.default || obMod.Onboarding);
        if (Ob && typeof Ob.shouldShow === 'function' && Ob.shouldShow()) {
          didOnboard = true;
          Render._track('onboarding_shown', {});
          const target = document.getElementById('onboarding');
          if (target) {
            await Ob.mount(target, {
              onComplete: () => {
                try { localStorage.setItem('we_onboarded', '1'); } catch (_) {}
                Render._track('onboarding_completed', {});
                Render.exploreFeed();
                Nav.switchTab('explore');
              }
            });
            // Show the onboarding screen.
            Nav.go('onboarding');
          }
        }
      } catch (e) { try { console.warn('[v0.7] onboarding failed', e); } catch(_){} }

      Render.exploreFeed();
      if (!didOnboard) Nav.switchTab('explore');

      // v0.7 — global event wiring (TabBar emits these; AI Route mounts on demand).
      App._wireV07Events();
    } catch (e) { /* will redirect via API client */ }
  },

  /* v0.7 — Tab Bar v2 mount with full event wiring back into legacy Nav. */
  async _mountTabBar() {
    const tbMod = await import('/beta/app/v2-screens/tab-bar-v2.js').catch((e) => { throw e; });
    const TabBar = tbMod && (tbMod.default || tbMod.TabBar);
    if (!TabBar || typeof TabBar.mount !== 'function') throw new Error('TabBar module missing');
    const mountEl = document.getElementById('we-tabbar');
    if (!mountEl) throw new Error('we-tabbar container missing');
    TabBar.mount(mountEl, {
      initialTab: 'explore',
      onTabChange: (name, meta) => {
        // Map v2 tab names → legacy Nav targets.
        if (name === 'explore')      return Nav.switchTab('explore');
        if (name === 'around')       return Nav.switchTab('around');
        if (name === 'saved')        return Nav.switchTab('archive');
        if (name === 'profile')      return; // sheet handled by TabBar itself.
        if (name === 'walk')         return; // handled via we:start-walk / we:resume-walk
      },
      profileActions: {
        onOffers:    () => Nav.switchTab('offers'),
        onFeedback:  () => Nav.switchTab('feedback'),
        onChangelog: () => Nav.switchTab('changelog'),
        onSettings:  () => { try { Toast && Toast.show('Settings coming soon'); } catch (_) {} },
        onSignOut:   () => App.signOut()
      }
    });
    window.TabBarV2 = TabBar;
  },

  /* v0.7 — global custom-event wiring (TabBar/profile-sheet/window-level intents). */
  _wireV07Events() {
    // FAB "Start a walk" → AI Route Generator.
    window.addEventListener('we:start-walk', () => {
      Render._track('ai_route_opened', { source: 'fab' });
      Nav.go('airoute');
    });
    // FAB "Resume walk" → back into the in-progress walk if we have a current route.
    window.addEventListener('we:resume-walk', () => {
      if (State.currentRoute) Nav.go('walk');
      else Nav.switchTab('explore');
    });
    // Profile-sheet event bridges (used when no override given).
    window.addEventListener('we:open-changelog', () => Nav.switchTab('changelog'));
    window.addEventListener('we:open-offers',    () => Nav.switchTab('offers'));
    window.addEventListener('we:open-settings',  () => { try { Toast.show('Settings coming soon'); } catch(_){} });

    // Loop-completion v2 share-button intercept: prefer the new Share module.
    document.addEventListener('click', async (ev) => {
      const btn = ev.target && ev.target.closest && ev.target.closest('[data-action="share"]');
      if (!btn) return;
      // Only intercept inside the v2 loop-completion screen.
      const inLoop = !!(btn.closest('.loop-screen') || btn.closest('#loop-v2') || btn.closest('#loop'));
      if (!inLoop) return;
      try {
        const shareMod = await import('/beta/app/v2-scripts/share.js').catch(() => null);
        const Share = shareMod && (shareMod.default || shareMod.Share);
        if (!Share || typeof Share.open !== 'function') return; // let native handler run
        ev.preventDefault();
        ev.stopPropagation();
        const r = State.currentRoute || {};
        const nbhd = NEIGHBORHOODS.find(n => n.id === r.nbhd);
        const loopData = {
          title: r.title || 'A Walking Explorers loop',
          slug: r.id || 'loop',
          neighborhood: nbhd ? nbhd.name : 'NYC',
          stops: (r.stops || []).map(s => ({ name: s.name, lat: s.lat, lng: s.lon })),
          miles: Number(r.miles) || 0,
          duration: (Number(r.minutes) || 0) * 60
        };
        let imageBlob = null;
        try { imageBlob = await Share.cardFromLoop(loopData); } catch (_) {}
        await Share.open({
          title: loopData.title,
          text: `Just finished "${loopData.title}" — ${loopData.stops.length} stops, ${loopData.miles} mi.`,
          url: 'https://walkingexplorers.com/beta/app',
          imageBlob: imageBlob,
          hashtags: ['walkingexplorers','nyc']
        });
        Render._track('loop_shared', { route_id: r.id });
      } catch (e) { try { console.warn('[v0.7] share intercept failed', e); } catch(_){} }
    }, true);
  },

  async signOut() {
    try { await API.signOut(); } catch {}
    location.href = '/beta';
  }
};

/* ===== Right Now contextual recommendation =====
   Picks a route based on time-of-day + weekday. Hidden once loops_completed > 0. */
const RightNow = {
  pick() {
    const now = new Date();
    const dow = now.getDay(); // 0=Sun
    const hr = now.getHours();
    const isWeekend = (dow === 0 || dow === 6);
    let routeId, ctx;
    // Late afternoon / evening -> sunset routes
    if (hr >= 16 && hr < 21) {
      routeId = isWeekend ? 'williamsburg' : 'wv_books';
      ctx = isWeekend ? 'It\'s a ' + this._dowName(dow) + ' afternoon — sunset over Brooklyn awaits.'
                      : 'It\'s a ' + this._dowName(dow) + ' evening in NYC — golden-hour West Village.';
    } else if (hr >= 9 && hr < 12) {
      routeId = 'soho_aesthetic';
      ctx = 'It\'s a ' + this._dowName(dow) + ' morning in NYC — try a SoHo café crawl.';
    } else if (hr >= 12 && hr < 16) {
      routeId = isWeekend ? 'central_park' : 'highline_galleries';
      ctx = isWeekend ? 'It\'s a ' + this._dowName(dow) + ' afternoon — Central Park is at its best.'
                      : 'It\'s a ' + this._dowName(dow) + ' afternoon — High Line + Chelsea galleries.';
    } else if (hr >= 21 || hr < 2) {
      routeId = 'ev_vintage';
      ctx = 'It\'s late in NYC — East Village vinyl & late-night diners.';
    } else {
      routeId = 'dumbo_bridge';
      ctx = 'Quiet hours in NYC — DUMBO and the Brooklyn Bridge before the crowds.';
    }
    return { route: routeById(routeId), ctx: ctx };
  },
  _dowName(d) { return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d]; },
  shouldShow() {
    return !State.user || (State.user.loops_completed === 0 || State.user.loops_completed == null);
  },
  render() {
    const slot = document.getElementById('rightNowSlot');
    if (!slot) return;
    if (!this.shouldShow()) { slot.innerHTML = ''; return; }
    // Prefer v2 module if available — weather-aware, photo-backed, deeper rule set.
    if (window.RightNowV2 && typeof window.RightNowV2.render === 'function') {
      try { window.RightNowV2.render(slot); return; } catch (e) { /* fall through */ }
    }
    const pick = this.pick();
    if (!pick.route) { slot.innerHTML = ''; return; }
    slot.innerHTML =
      '<div class="rightnow-card" id="rightNowCard" role="button" tabindex="0" aria-label="Try this recommended walk">' +
        '<div class="eyebrow">Right Now · For you</div>' +
        '<div class="ctx">' + esc(pick.ctx) + '</div>' +
        '<h3>' + esc(pick.route.title) + '</h3>' +
        '<span class="cta-pill">Start this walk →</span>' +
      '</div>';
    const card = document.getElementById('rightNowCard');
    if (card) {
      const go = () => {
        State.currentRoute = pick.route;
        Telemetry.track('route_viewed', { route_id: pick.route.id, source: 'right_now' });
        Nav.go('detail');
      };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    }
  }
};

/* ===== Capture ===== */
const Capture = {
  pending: null,
  open() {
    const route = State.currentRoute;
    const stop = route ? route.stops[State.walkIdx] : null;
    this.pending = {
      photoData: null, tags: new Set(), rating: null, notes: '',
      lat: null, lon: null,
      stopName: stop ? stop.name : 'Quick spot',
      routeId: route ? route.id : null,
      neighborhood: route ? route.nbhd : null
    };
    document.getElementById('captureStopLabel').textContent = stop ? 'Capturing at ' + stop.name : 'Capture a moment';
    const preview = document.getElementById('capturePreview');
    preview.style.display = 'none'; preview.src = '';
    document.getElementById('capturePlaceholder').style.display = '';
    document.getElementById('captureFile').value = '';
    document.getElementById('captureNotes').value = '';
    Render.captureTags(); Render.captureRatings();
    const gpsRow = document.getElementById('gpsRow');
    gpsRow.classList.remove('locked'); gpsRow.textContent = '📡 Locating you…';
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          this.pending.lat = pos.coords.latitude; this.pending.lon = pos.coords.longitude;
          gpsRow.classList.add('locked');
          gpsRow.textContent = '📍 GPS locked · ' + pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4);
        },
        () => { gpsRow.textContent = '📡 GPS unavailable'; },
        { timeout: 8000 }
      );
    } else { gpsRow.textContent = '📡 GPS unavailable'; }
    ModalLock.open(document.getElementById('captureModal'));
  },
  close() {
    ModalLock.close(document.getElementById('captureModal'));
    this.pending = null;
  },
  onFile(ev) {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 640;
        let w = img.width, h = img.height;
        if (w > MAX) { h = h * MAX / w; w = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const data = canvas.toDataURL('image/jpeg', 0.7);
        this.pending.photoData = data;
        const preview = document.getElementById('capturePreview');
        preview.src = data; preview.style.display = '';
        document.getElementById('capturePlaceholder').style.display = 'none';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  },
  toggleTag(t) { if (!this.pending) return; this.pending.tags.has(t) ? this.pending.tags.delete(t) : this.pending.tags.add(t); Render.captureTags(); },
  setRating(r) { if (!this.pending) return; this.pending.rating = r; Render.captureRatings(); },
  async save() {
    if (!this.pending) return;
    if (!this.pending.photoData) return Toast.show((window.T ? window.T('errors.no_photo','Add a photo first') : 'Add a photo first'));
    const btn = document.getElementById('captureSaveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const body = {
        stopName: this.pending.stopName,
        neighborhood: this.pending.neighborhood,
        routeId: this.pending.routeId,
        tags: Array.from(this.pending.tags),
        rating: this.pending.rating,
        notes: document.getElementById('captureNotes').value.trim(),
        lat: this.pending.lat, lon: this.pending.lon,
        photo: this.pending.photoData
      };
      await API.spotsSave(body);
      State.walkPhotos++;
      Telemetry.track('spot_saved', { route_id: body.routeId, neighborhood: body.neighborhood, rating: body.rating });
      try { Render._track && Render._track('spot_saved', { route_id: body.routeId, neighborhood: body.neighborhood, rating: body.rating }); } catch (_) {}
      this.close();
      Toast.show((window.T ? window.T('toasts.spot_saved', 'Spot saved to your Archive') : 'Spot saved to your Archive'));
      // Reload spots, THEN refresh tab badges (fixes race)
      try { const r = await API.spotsList(); State.spots = r.spots || []; } catch { State.spots = State.spots || []; }
      Render.tabBadges();
      const flash = document.querySelector('.stop-photo-frame .flash');
      if (flash) { flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 240); }
    } catch (e) {
      Toast.show((window.T ? (e.data && e.data.error === 'photo_too_large' ? window.T('errors.photo_too_large','Photo too large') : window.T('toasts.spot_save_failed','Failed to save — try again')) : (e.data && e.data.error === 'photo_too_large' ? 'Photo too large' : 'Failed to save — try again')));
    } finally { btn.disabled = false; btn.textContent = 'Save to my Archive'; }
  }
};

/* ===== Archive ===== */
const Archive = {
  setView(v) {
    State.archiveView = v;
    document.querySelectorAll('#archiveToggle button').forEach(b => b.classList.toggle('on', b.textContent.toLowerCase() === v));
    Render.archive();
  },
  async ensureLoaded(force) {
    if (State.spots && !force) return;
    try { const r = await API.spotsList(); State.spots = r.spots || []; }
    catch { State.spots = []; }
  },
  openSpot(id) {
    const s = (State.spots || []).find(x => x.id === id); if (!s) return;
    const ratingObj = RATINGS.find(r => r.id === s.rating);
    const ratingHtml = ratingObj ? '<div style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;font-weight:600;color:'+ratingObj.color+';"><span style="width:10px;height:10px;border-radius:50%;background:'+ratingObj.color+';"></span>'+esc(ratingObj.label)+' revisit</div>' : '';
    const tags = (s.tags || []).map(t => '<span style="font-size:11px;padding:3px 8px;background:var(--cream-2);border-radius:100px;">'+esc(t)+'</span>').join('');
    const nbhdName = (NEIGHBORHOODS.find(n => n.id === s.neighborhood) || {}).name || 'NYC';
    const date = new Date(s.savedAt).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    const gps = (s.lat != null && s.lon != null) ? '<div class="muted" style="font-size:11px;margin-top:8px;display:inline-flex;align-items:center;gap:4px;"><svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><use href="/beta/app/v2-styles/icons.svg#icon-map-pin"/></svg> '+s.lat.toFixed(4)+', '+s.lon.toFixed(4)+'</div>' : '';
    const photo = s.photo || '';
    document.getElementById('spotModalContent').innerHTML =
      (photo ? '<div style="aspect-ratio:4/3;border-radius:14px;overflow:hidden;margin-bottom:14px;"><img src="'+esc(photo)+'" alt="Captured spot photo" style="width:100%;height:100%;object-fit:cover;"></div>' : '') +
      '<h3 style="margin:0 0 4px;font-size:20px;">'+esc(s.stopName)+'</h3>' +
      '<div style="font-size:11px;font-weight:700;color:var(--gold-dark);letter-spacing:0.06em;text-transform:uppercase;">'+esc(nbhdName)+' · '+esc(date)+'</div>' +
      ratingHtml +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">'+tags+'</div>' +
      (s.notes ? '<div style="margin-top:10px;font-size:14px;line-height:1.5;color:var(--ink-2);">'+esc(s.notes)+'</div>' : '') +
      gps;
    document.getElementById('spotDeleteBtn').onclick = async () => {
      if (!confirm('Delete this spot from your Archive?')) return;
      try { await API.spotsDelete(id); State.spots = State.spots.filter(x => x.id !== id); this.closeSpot(); Render.archive(); Render.tabBadges(); Toast.show((window.T ? window.T('toasts.spot_deleted', 'Spot deleted') : 'Spot deleted')); }
      catch { Toast.show((window.T ? window.T('toasts.spot_delete_failed','Failed to delete') : 'Failed to delete')); }
    };
    // v0.7 — Share button (dynamically inject if not present yet).
    let shareBtn = document.getElementById('spotShareBtn');
    if (!shareBtn) {
      shareBtn = document.createElement('button');
      shareBtn.id = 'spotShareBtn';
      shareBtn.className = 'btn btn-outline btn-block';
      shareBtn.innerHTML = 'Share this spot';
      const deleteBtn = document.getElementById('spotDeleteBtn');
      if (deleteBtn && deleteBtn.parentNode) deleteBtn.parentNode.insertBefore(shareBtn, deleteBtn);
    }
    shareBtn.onclick = async () => {
      try {
        const mod = await import('/beta/app/v2-scripts/share.js').catch(() => null);
        const Share = mod && (mod.default || mod.Share);
        if (!Share) { Toast.show('Share is unavailable'); return; }
        const spotData = { stopName: s.stopName, neighborhood: (NEIGHBORHOODS.find(n => n.id === s.neighborhood) || {}).name || 'NYC', rating: s.rating, tags: s.tags || [], photo: s.photo, lat: s.lat, lon: s.lon };
        let imageBlob = null;
        try { imageBlob = await Share.cardFromSpot(spotData); } catch (_) {}
        await Share.open({
          title: spotData.stopName,
          text: `Found this in ${spotData.neighborhood}: ${spotData.stopName}. Saved on Walking Explorers.`,
          url: 'https://walkingexplorers.com/beta/app',
          imageBlob: imageBlob,
          hashtags: ['walkingexplorers','nyc']
        });
        Render._track('spot_shared', { spot_id: id });
      } catch (e) { try { console.warn('[v0.7] spot share failed', e); } catch(_){} }
    };
    ModalLock.open(document.getElementById('spotModal'));
  },
  closeSpot() { ModalLock.close(document.getElementById('spotModal')); },
  _map: null,
  _mapTeardown() {
    if (this._map) {
      try { this._map.off(); } catch (e) {}
      try { this._map.remove(); } catch (e) {}
      this._map = null;
    }
    const oldEl = document.getElementById('archiveMap');
    if (oldEl) oldEl.innerHTML = '';
  },
  async drawMap() {
    this._mapTeardown();
    const spots = (State.spots || []).filter(s => s.lat != null && s.lon != null);
    let L;
    try { L = await LeafletLoader.load(); } catch (e) { Toast.show((window.T ? window.T('toasts.map_failed','Map failed to load') : 'Map failed to load')); return; }
    setTimeout(() => {
      const el = document.getElementById('archiveMap'); if (!el) return;
      const center = spots.length ? [spots[0].lat, spots[0].lon] : [40.7233, -73.9991];
      this._map = L.map('archiveMap', { zoomControl: true, attributionControl: true }).setView(center, 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap', maxZoom:19 }).addTo(this._map);
      if (!spots.length) { L.popup().setLatLng(center).setContent('<b>No GPS-tagged spots yet</b>').openOn(this._map); return; }
      const bounds = [];
      spots.forEach(s => {
        const ratingObj = RATINGS.find(r => r.id === s.rating) || { color:'#1F3864' };
        const photo = s.photo || '';
        const m = L.marker([s.lat, s.lon], {
          icon: L.divIcon({
            className:'',
            html:'<div style="background:'+ratingObj.color+';width:30px;height:30px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);'+(photo?'background-image:url('+esc(photo)+');background-size:cover;background-position:center;':'')+'"></div>',
            iconSize:[30,30], iconAnchor:[15,15]
          })
        }).addTo(this._map);
        m.bindPopup('<div style="text-align:center;">'+(photo ? '<img src="'+esc(photo)+'" style="width:160px;height:120px;object-fit:cover;border-radius:8px;display:block;margin:0 auto 6px;" alt="">' : '')+'<b>'+esc(s.stopName)+'</b><br><small>'+esc((s.tags||[]).slice(0,2).join(' · '))+'</small></div>');
        bounds.push([s.lat, s.lon]);
      });
      if (bounds.length > 1) this._map.fitBounds(bounds, { padding:[40,40] });
    }, 60);
  }
};

/* ===== Promotions ===== */
const Promotions = {
  list() { return PROMOTIONS; },
  generateRoute(seed) {
    const seedArr = seed ? [seed] : [];
    const pool = PROMOTIONS.filter(p => !seedArr.find(s => s.id === p.id));
    const promos = seedArr.slice();
    while (promos.length < 4 && pool.length) promos.push(pool.splice(Math.floor(Math.random()*pool.length), 1)[0]);
    const allStops = ROUTES.flatMap(r => r.stops.filter(s => !s.sponsored));
    const aesthetic = [];
    while (aesthetic.length < 2 && allStops.length) aesthetic.push(allStops.splice(Math.floor(Math.random()*allStops.length), 1)[0]);
    const stops = promos.map(p => ({ name:p.business, lat:p.lat, lon:p.lon, sponsored:p.sponsored, desc:p.offer, why:'Promo · '+p.offer+' · expires '+p.expires }))
      .concat(aesthetic.map(s => ({ name:s.name, lat:s.lat, lon:s.lon, desc:s.desc, why:'Curated near your offers — '+s.why })));
    State.currentRoute = { id:'promo_'+Date.now(), title:'Promo Route · '+(seedArr[0] ? seedArr[0].nbhd.toUpperCase() : 'NYC'), nbhd:(seedArr[0] && seedArr[0].nbhd) || 'soho', minutes:90, miles:2.0, desc:'Built from '+promos.length+' nearby offers + '+aesthetic.length+' aesthetic finds.', stops, isPromoRoute:true };
    Telemetry.track('promo_route_generated', { promos: promos.length });
    Nav.go('detail');
  },
  addToRoute(id) { const p = PROMOTIONS.find(x => x.id === id); if (p) { Toast.show('Adding '+p.business+'…'); setTimeout(() => this.generateRoute(p), 500); } }
};

/* ===== Walk ===== */
const Walk = {
  /* v0.7 — live GPS tracker instance (null when not active). */
  _tracker: null,
  _trackerSummary: null,
  start() {
    State.walkIdx = 0; State.walkPhotos = 0;
    Telemetry.track('walk_started', { route_id: State.currentRoute && State.currentRoute.id });
    Render._track('walk_started', { route_id: State.currentRoute && State.currentRoute.id });
    // Mark active-walk in localStorage so TabBar FAB shows resume mode.
    try { if (State.currentRoute) localStorage.setItem('we_active_walk_id', State.currentRoute.id); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('we:active-walk-changed')); } catch (_) {}
    Nav.go('walk');
    // Kick off live tracker — non-blocking. If geolocation is denied, the tracker
    // returns a stub and we silently continue with the legacy stop-by-stop flow.
    Walk._startTracker();
  },
  async _startTracker() {
    if (Walk._tracker) { try { Walk._tracker.stop(); } catch (_) {} Walk._tracker = null; }
    const route = State.currentRoute;
    if (!route || !route.stops || !route.stops.length) return;
    try {
      const mod = await import('/beta/app/v2-scripts/walk-tracker.js').catch((e) => { throw e; });
      const wt = mod && mod.default && mod.default.start;
      if (typeof wt !== 'function') return;
      // Make sure Leaflet is loaded (the tracker requires window.L).
      try { await LeafletLoader.load(); } catch (_) { return; }
      const mapEl = document.getElementById('wMap');
      if (!mapEl) return;
      mapEl.style.display = '';
      const result = await wt({
        route: route,
        mapElement: mapEl,
        onProximity: (stopIdx, dist) => {
          Render._track('walk_proximity', { route_id: route.id, stop_idx: stopIdx, dist_m: Math.round(dist) });
        },
        onArrival: (stopIdx) => {
          Render._track('walk_stop_advanced', { route_id: route.id, stop_idx: stopIdx, source: 'tracker' });
          if (stopIdx > State.walkIdx) { State.walkIdx = stopIdx; Walk.renderStop(); }
          const flash = document.querySelector('.stop-photo-frame .flash');
          if (flash) { flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 240); }
        },
        onProgress: (summary) => { Walk._trackerSummary = summary; },
        onPositionUpdate: () => { /* reserved */ }
      });
      // result is the public api when ok:true, or a stub when ok:false.
      if (result && result.ok) { Walk._tracker = result; }
      else { Walk._tracker = result || null; mapEl.style.display = 'none'; }
    } catch (e) {
      try { console.warn('[v0.7] walk-tracker start failed', e); } catch(_){}
      const mapEl = document.getElementById('wMap'); if (mapEl) mapEl.style.display = 'none';
    }
  },
  _stopTracker() {
    if (!Walk._tracker) return;
    try { Walk._trackerSummary = Walk._tracker.getSummary && Walk._tracker.getSummary(); } catch (_) {}
    try { Walk._tracker.stop && Walk._tracker.stop(); } catch (_) {}
    Walk._tracker = null;
    try { localStorage.removeItem('we_active_walk_id'); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('we:active-walk-changed')); } catch (_) {}
    const mapEl = document.getElementById('wMap'); if (mapEl) mapEl.style.display = 'none';
  },
  renderStop() {
    const r = State.currentRoute; if (!r) return Nav.switchTab('explore');
    const s = r.stops[State.walkIdx];
    document.getElementById('wCounter').textContent = 'Stop '+(State.walkIdx+1)+' of '+r.stops.length;
    document.getElementById('wTitle').textContent = s.name;
    {
      const wp = document.getElementById('wPhoto');
      const stopPhoto = (window.WE_V2 && window.WE_V2.stopFor) ? window.WE_V2.stopFor(r.id, State.walkIdx) : null;
      if (stopPhoto) {
        wp.setAttribute('style', 'background-image:url(' + JSON.stringify(stopPhoto.url).replace(/^"|"$/g,'') + ');background-size:cover;background-position:center;');
        wp.setAttribute('aria-label', stopPhoto.alt || s.name);
      } else {
        wp.setAttribute('style', coverArt(r.id+'-'+State.walkIdx));
      }
    }
    document.getElementById('wPhotoLabel').textContent = s.name;
    document.getElementById('wSponsoredTag').style.display = s.sponsored ? '' : 'none';
    document.getElementById('wDesc').textContent = s.desc || '';
    document.getElementById('wWhy').innerHTML = '<b>Why this for you:</b> ' + esc(s.why);
    document.getElementById('wDist').textContent = (r.miles * (State.walkIdx+1) / r.stops.length).toFixed(1) + ' mi';
    document.getElementById('wTime').textContent = Math.round(r.minutes * (State.walkIdx+1) / r.stops.length) + ' min';
    document.getElementById('wNext').textContent = State.walkIdx === r.stops.length - 1 ? 'Finish & save Loop →' : 'Next stop →';
    document.getElementById('wProgressFill').style.width = (((State.walkIdx + 1) / r.stops.length) * 100) + '%';
    Telemetry.track('stop_walked', { route_id: r.id, stop_idx: State.walkIdx, stop_name: s.name });
  },
  async next() {
    const r = State.currentRoute;
    if (State.walkIdx === r.stops.length - 1) {
      Render._track('walk_stop_advanced', { route_id: r.id, stop_idx: State.walkIdx, source: 'manual', final: true });
      Walk._stopTracker();
      try { await API.loopsSave({ routeId:r.id, routeTitle:r.title, nbhd:r.nbhd, stops:r.stops.length, miles:r.miles, minutes:r.minutes, photos:State.walkPhotos }); } catch {}
      Telemetry.track('loop_completed', { route_id: r.id, photos: State.walkPhotos });
      Render._track('loop_completed', { route_id: r.id, photos: State.walkPhotos, tracker_summary: Walk._trackerSummary || null });
      // bump locally so Right Now disappears immediately
      if (State.user) State.user.loops_completed = (State.user.loops_completed || 0) + 1;
      Nav.go('loop');
      const nbhd = NEIGHBORHOODS.find(n => n.id === r.nbhd);
      document.getElementById('loopTitle').textContent = 'Your '+(nbhd ? nbhd.name : 'NYC')+' Loop';
      document.getElementById('loopMeta').textContent = r.title+' · '+r.stops.length+' stops · '+r.miles+' mi';
    } else {
      State.walkIdx++;
      Render._track('walk_stop_advanced', { route_id: r.id, stop_idx: State.walkIdx, source: 'manual' });
      this.renderStop();
    }
  },
  exit() {
    if (confirm('Exit this walk?')) { Walk._stopTracker(); Nav.switchTab('explore'); }
  }
};

/* ===== Feedback ===== */
const Feedback = {
  setType(t) {
    State.fbType = t;
    document.querySelectorAll('#fbTabs .tab-pill').forEach(b => b.classList.toggle('on', b.dataset.fbtab === t));
    document.getElementById('fbBoardTitle').textContent = ({ feature:'Feature requests', bug:'Bug reports', rating:'Route ratings', neighborhood:'Neighborhood requests' })[t];
    Render.fbList();
  },
  async submit() {
    const title = document.getElementById('fbTitle').value.trim();
    const body = document.getElementById('fbBody').value.trim();
    if (!title) { Toast.show((window.T ? window.T('errors.no_summary','Enter a short summary') : 'Enter a short summary')); return; }
    try {
      await API.fbSubmit({ type: State.fbType, title, body });
      document.getElementById('fbTitle').value = '';
      document.getElementById('fbBody').value = '';
      Telemetry.track('feedback_submitted', { type: State.fbType });
      Toast.show((window.T ? window.T('toasts.feedback_submitted','Submitted — thank you') : 'Submitted — thank you'));
      Render.fbList();
    } catch { Toast.show((window.T ? window.T('toasts.feedback_submit_failed','Failed to submit') : 'Failed to submit')); }
  },
  async vote(id, btn) {
    if (btn.classList.contains('voted')) return;
    try {
      const r = await API.fbVote(id);
      btn.classList.add('voted');
      btn.querySelector('.n').textContent = r.votes;
      Telemetry.track('vote_cast', { id });
      Toast.show((window.T ? window.T('toasts.vote_counted','Vote counted') : 'Vote counted'));
    } catch { Toast.show((window.T ? window.T('toasts.vote_failed','Failed to vote') : 'Failed to vote')); }
  }
};

/* ===== Render ===== */
const Render = {
  /* v0.7 — hardened exploreFeed. Even when greeting/RightNow throws (e.g. RightNowV2
     promise rejection, microcopy partial state, weather API timeout), the 12-card
     route grid still renders. Each card has its own try/catch so one broken record
     can't blank the whole feed. */
  exploreFeed() {
    // 1) Greeting / right-now. Wrapped in try/catch so it CANNOT block route render.
    try {
      const greet = document.getElementById('greeting');
      if (greet) {
        const hour = new Date().getHours();
        let g = 'Good morning'; if (hour >= 12 && hour < 17) g = 'Good afternoon'; else if (hour >= 17) g = 'Good evening';
        greet.textContent = (window.T && window.WE_V2 && window.WE_V2.microcopy)
          ? window.T('greetings.' + (hour<12?'morning':hour<17?'afternoon':hour<21?'evening':'night'), g + ', explorer')
          : (g + ', explorer');
      }
      const ey = document.getElementById('greetingEyebrow');
      if (ey && window.T) ey.textContent = window.T('right_now.eyebrow', 'Today in NYC');
      const gs = document.getElementById('greetingSub');
      if (gs) gs.textContent = (window.T ? window.T('app.tagline', '12 hand-curated NYC routes') : '12 hand-curated NYC routes');
    } catch (e) { try { console.warn('[explore] greeting failed', e); } catch(_){} }
    try { RightNow.render(); } catch (e) { try { console.warn('[explore] RightNow.render failed', e); } catch(_){} }

    // 2) Route list — the load-bearing render. ALWAYS run, isolate per-card errors.
    const all = document.getElementById('allList');
    if (!all) return;
    try { all.innerHTML = ''; } catch (_) {}
    let rendered = 0;
    for (let i = 0; i < ROUTES.length; i++) {
      try {
        const card = this._routeCard(ROUTES[i]);
        if (card) { all.appendChild(card); rendered++; }
      } catch (e) {
        try { console.warn('[explore] _routeCard failed for ' + ROUTES[i].id, e); } catch (_) {}
        // Fallback: minimal text-only card so the user still has SOMETHING to tap.
        try {
          const r = ROUTES[i];
          const fb = document.createElement('div');
          fb.className = 'route-card motion-fade-up';
          fb.style.padding = '16px 18px';
          fb.innerHTML = '<div class="title" style="font-size:17px;font-weight:700;letter-spacing:-0.01em;">'+esc(r.title)+'</div>' +
            '<div class="desc" style="color:var(--ink-2);font-size:13.5px;margin-top:6px;">'+esc(r.desc || '')+'</div>';
          fb.onclick = () => { State.currentRoute = r; Render._track('route_viewed', { route_id:r.id, source:'feed_fallback' }); Nav.go('detail'); };
          all.appendChild(fb); rendered++;
        } catch (_) {}
      }
    }
    // Dynamic count label (replaces hard-coded "12 routes").
    const countEl = document.getElementById('countAll');
    if (countEl) countEl.textContent = rendered + (rendered === 1 ? ' route' : ' routes');
  },
  /* v0.7 — track() bridge: prefers WE_T (PostHog v2 module) but always
     forwards to the legacy Telemetry stub so existing dashboards keep working. */
  _track(event, props) {
    try { if (window.WE_T && typeof window.WE_T.track === 'function') window.WE_T.track(event, props || {}); } catch (_) {}
    try { Telemetry.track(event, props); } catch (_) {}
  },
  _routeCard(r) {
    const nbhd = NEIGHBORHOODS.find(n => n.id === r.nbhd);
    const el = document.createElement('div'); el.className = 'route-card motion-fade-up';
    let hero = null;
    try { hero = (window.WE_V2 && window.WE_V2.heroFor) ? window.WE_V2.heroFor(r.id) : null; } catch (_) {}
    let coverStyle = '';
    try { coverStyle = coverArt(r); } catch (_) { coverStyle = 'background:linear-gradient(135deg,#1F3864,#2E75B6);'; }
    const coverHtml = (hero && hero.url)
      ? '<img class="cover-art" src="' + esc(hero.url) + '" alt="' + esc(hero.alt || r.title) + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentNode.style.cssText+=\';'+esc(coverStyle)+'\';">'
      : '<div class="cover-art" style="' + coverStyle + '"></div>';
    el.innerHTML =
      '<div class="route-cover">' +
        coverHtml +
        '<div class="cover-overlay"></div>' +
        '<span class="badge-ai">NYC pick</span>' +
        '<div class="meta-pill"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><use href="/beta/app/v2-styles/icons.svg#icon-map-pin"/></svg> '+r.stops.length+' stops</div>' +
      '</div>' +
      '<div class="route-body">' +
        '<div class="nbhd-tag">'+esc(nbhd ? nbhd.name : 'NYC')+'</div>' +
        '<div class="title">'+esc(r.title)+'</div>' +
        '<div class="desc">'+esc(r.desc)+'</div>' +
        '<div class="meta-row"><span><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><use href="/beta/app/v2-styles/icons.svg#icon-time-clock"/></svg> '+esc(fmtMins(r.minutes))+'</span><span><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><use href="/beta/app/v2-styles/icons.svg#icon-distance-ruler"/></svg> '+esc(String(r.miles))+' mi</span></div>' +
      '</div>';
    el.onclick = () => {
      State.currentRoute = r;
      Render._track('route_viewed', { route_id: r.id, source: 'feed' });
      Nav.go('detail');
    };
    return el;
  },
  _detailMap: null,
  _detailMapTeardown() {
    if (this._detailMap) {
      try { this._detailMap.off(); } catch (e) {}
      try { this._detailMap.remove(); } catch (e) {}
      this._detailMap = null;
    }
    const oldEl = document.getElementById('map');
    if (oldEl) oldEl.innerHTML = '';
  },
  async detail(route) {
    const nbhd = NEIGHBORHOODS.find(n => n.id === route.nbhd);
    {
      const hero = (window.WE_V2 && window.WE_V2.heroFor) ? window.WE_V2.heroFor(route.id) : null;
      const heroEl = document.getElementById('dHeroArt');
      if (hero) {
        heroEl.setAttribute('style', 'background-image:url(' + JSON.stringify(hero.url).replace(/^"|"$/g,'') + ');background-size:cover;background-position:center;');
        heroEl.setAttribute('aria-label', hero.alt || route.title);
        heroEl.classList.add('parallax-hero');
      } else {
        heroEl.setAttribute('style', coverArt(route));
      }
    }
    document.getElementById('dTitle').textContent = route.title;
    document.getElementById('dNbhd').textContent = nbhd ? nbhd.name : 'NYC';
    document.getElementById('dStops').textContent = route.stops.length;
    document.getElementById('dMins').textContent = fmtMins(route.minutes);
    document.getElementById('dMiles').textContent = route.miles + ' mi';
    document.getElementById('dDesc').textContent = route.desc;
    this._detailMapTeardown();
    let L;
    try { L = await LeafletLoader.load(); } catch (e) { Toast.show('Map failed to load'); }
    setTimeout(() => {
      if (!L) return;
      this._detailMap = L.map('map', { zoomControl: false, attributionControl: true }).setView([route.stops[0].lat, route.stops[0].lon], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap', maxZoom:19 }).addTo(this._detailMap);
      const path = route.stops.map(s => [s.lat, s.lon]);
      L.polyline(path, { color:'#1F3864', weight:4, opacity:0.9 }).addTo(this._detailMap);
      route.stops.forEach((s, i) => {
        L.marker([s.lat, s.lon], {
          icon: L.divIcon({
            className:'',
            html:'<div style="background:'+(s.sponsored?'#E0B341':'#1F3864')+';color:'+(s.sponsored?'#1F3864':'white')+';width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.30);">'+(i+1)+'</div>',
            iconSize:[30,30], iconAnchor:[15,15]
          })
        }).addTo(this._detailMap).bindPopup('<b>'+esc(s.name)+'</b><br><small>'+esc(s.desc || '')+'</small>');
      });
      this._detailMap.fitBounds(path, { padding:[40,40] });
    }, 60);
    const list = document.getElementById('dStopsList'); list.innerHTML = '';
    route.stops.forEach((s, i) => {
      const el = document.createElement('div'); el.className = 'stop' + (s.sponsored ? ' sponsored' : '');
      el.innerHTML = '<div class="n">'+(i+1)+'</div><div class="body" style="flex:1;"><h3>'+esc(s.name)+'</h3><p>'+esc(s.desc || '')+'</p><div class="why"><b>Why this for you:</b> '+esc(s.why)+'</div></div>'+(s.sponsored ? '<span class="badge">Sponsored</span>' : '');
      list.appendChild(el);
    });
  },
  async archive() {
    await Archive.ensureLoaded();
    const c = document.getElementById('archiveContent');
    document.getElementById('archiveToggle').style.display = State.spots.length ? '' : 'none';
    if (!State.spots.length) {
      c.innerHTML = '<div class="archive-empty"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div><h3>Your city memory starts here.</h3><p>Capture a photo on your next walk to start your archive.</p><button class="btn btn-primary" onclick="Nav.switchTab(\'explore\')">Pick a route</button></div>';
      return;
    }
    if (State.archiveView === 'map') { c.innerHTML = '<div id="archiveMap"></div>'; Archive.drawMap(); return; }
    let html = '<div class="spot-list">';
    State.spots.forEach(s => {
      const ratingObj = RATINGS.find(r => r.id === s.rating);
      const nbhdName = (NEIGHBORHOODS.find(n => n.id === s.neighborhood) || {}).name || 'NYC';
      const date = new Date(s.savedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
      const tags = (s.tags || []).slice(0, 3).map(t => '<span>'+esc(t)+'</span>').join('');
      const rb = ratingObj ? '<div class="rating-badge" style="background:'+ratingObj.color+';"></div>' : '';
      const photo = s.photo || '';
      html += '<div class="spot-card" onclick="Archive.openSpot(\'' + esc(s.id) + '\')"><div class="photo"' + (photo ? ' style="background-image:url(' + esc(photo) + ')"' : '') + '>' + rb + '</div><div class="body"><h4>'+esc(s.stopName)+'</h4><div class="nbhd-tag">'+esc(nbhdName)+'</div><div class="tag-row">'+tags+'</div><div class="meta"><span>'+esc(date)+'</span>'+(s.lat != null ? '<span><svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-1px;"><use href="/beta/app/v2-styles/icons.svg#icon-map-pin"/></svg> GPS</span>' : '')+'</div></div></div>';
    });
    html += '</div>'; c.innerHTML = html;
  },
  offers() {
    const list = document.getElementById('offerList'); list.innerHTML = '';
    PROMOTIONS.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'offer-card' + (p.sponsored && i < 2 ? ' featured' : '');
      el.innerHTML = '<div class="head"><div><div class="name">'+esc(p.business)+'</div><div class="nbhd-tag">'+esc((NEIGHBORHOODS.find(n => n.id === p.nbhd) || {}).name || 'NYC')+(p.sponsored ? ' · Sponsored' : '')+'</div></div><div class="price">'+esc(p.priceTier)+'</div></div><div class="offer">'+esc(p.offer)+'</div><div class="meta"><span><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><use href="/beta/app/v2-styles/icons.svg#icon-map-pin"/></svg> '+esc(p.distance)+'</span><span><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><use href="/beta/app/v2-styles/icons.svg#icon-time-clock"/></svg> '+esc(p.expires)+'</span></div><div class="actions"><button class="add-btn" onclick="Promotions.addToRoute(\''+esc(p.id)+'\')" aria-label="Add '+esc(p.business)+' to route">Add to route →</button></div>';
      list.appendChild(el);
    });
  },
  async fbList() {
    try {
      const r = await API.fbList(State.fbType);
      State.fbItems = r.items || [];
      const list = document.getElementById('fbList'); list.innerHTML = '';
      document.getElementById('fbCount').textContent = State.fbItems.length + (State.fbItems.length === 1 ? ' item' : ' items');
      if (!State.fbItems.length) {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--mute);font-size:13.5px;">Nothing here yet. Be the first.</div>';
        return;
      }
      State.fbItems.forEach(it => {
        const el = document.createElement('div'); el.className = 'fb-card';
        const showVote = State.fbType === 'feature';
        el.innerHTML = '<div class="head">' +
          (showVote ? '<button class="vote" onclick="Feedback.vote(\''+esc(it.id)+'\', this)" aria-label="Vote for '+esc(it.title)+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg><span class="n">'+(it.votes || 0)+'</span></button>' : '') +
          '<div class="body"><h4>'+esc(it.title)+'</h4>' +
          (it.body ? '<p>'+esc(it.body)+'</p>' : '') +
          '<div class="meta"><span class="status '+esc(it.status || 'open')+'">'+esc(it.status || 'open')+'</span>' +
          (it.mine ? '<span style="color:var(--gold-dark);">your post</span>' : '') +
          '</div></div></div>';
        list.appendChild(el);
      });
    } catch { Toast.show((window.T ? window.T('toasts.list_failed','Failed to load') : 'Failed to load')); }
  },
  changelog() {
    const releases = [
      { v:'v0.7 — Discovery, generation, social', date:'May 13, 2026', items:[
        'NEW: Around Me — live GPS map with nearby curated stops and promotional offers',
        'NEW: AI Route Generator — 4-question flow that generates a personalized walk from the Walk FAB',
        'NEW: Walk Tracker — live GPS tracking with proximity alerts and auto-advance at each stop',
        'NEW: Share — IG Stories / X / Web Share API, canvas-rendered share cards for loops and spots',
        'NEW: Search — mood + duration + neighborhood filters across the curated route library',
        'NEW: 5-tab navigation with center FAB (Explore / Around / Walk / Saved / Profile)',
        'NEW: First-launch Onboarding flow — mood, time/distance preferences, optional location',
        'FIX: Empty Explore feed — Render.exploreFeed now isolates greeting/RightNow errors so the 12 cards always render',
        'INTERNAL: PostHog + Sentry instrumented via dedicated v2 modules with safe fallbacks'
      ]},
      { v:'v0.6.1 — Graphical polish & editorial voice', date:'May 13, 2026', items:[
        'Real NYC photography on every route — 84 lazy-loaded images replacing gradient placeholders',
        'Custom SVG icon set (50+) and editorial illustrations (18) replace generic emojis and feather icons',
        '300+ rewritten microcopy strings — observational, editorial-NYC voice',
        'Motion system: page transitions, staggered card entries, parallax hero, confetti on Loop complete',
        'Capture v2: filters, moods, single-tap save with success animation',
        'Loop completion v2: confetti + animated map recap + canvas-rendered share card',
        'Custom map style: muted tiles, navy/gold markers, animated route draw-on',
        'Right Now: weather-aware, time-aware, neighborhood-aware contextual card',
        'All animations respect prefers-reduced-motion'
      ]},
      { v:'v0.6 — Security, a11y, performance', date:'May 9, 2026', items:[
        'XSS-safe rendering across routes, spots, and feedback',
        'iOS-friendly: 100svh, 16px inputs, safe-area for the tab bar',
        'WCAG AA pass: aria labels, dialog semantics, focus trap, Esc-close',
        'Performance: Leaflet now lazy-loads only when a map is opened',
        'Right Now contextual recommendation on first app load',
        'Telemetry stub (PostHog) tracking app loaded, walks, spots, loops, feedback'
      ]},
      { v:'v0.5 — Beta platform', date:'April 30, 2026', items:[
        'Token-gated beta access at walkingexplorers.com/beta',
        'Server-side route generation, spot saving, loop tracking',
        'Real photo capture with GPS, tags, ratings, notes',
        'Feedback hub: bug reports, feature requests with voting, route ratings, neighborhood requests',
        'Admin panel for token generation, user management, feedback moderation'
      ]},
      { v:'v0.4 — City memory + promotions', date:'April 29, 2026', items:[
        'Explorer Archive (My Spots) with list + map views',
        'Promotions Near Me + Generate Promo Route',
        '12 NYC routes · 72 hand-picked stops'
      ]},
      { v:'v0.3 — Visual identity', date:'April 28, 2026', items:[
        'Inter typography, gradient cover art, custom skyline silhouette',
        'Real NYC landmark photos (Brooklyn Bridge, Washington Sq Arch, etc.)'
      ]}
    ];
    document.getElementById('changelogContent').innerHTML = releases.map(r =>
      '<article class="release"><h2>'+esc(r.v)+'</h2><time>'+esc(r.date)+'</time><ul>'+r.items.map(i => '<li>'+esc(i)+'</li>').join('')+'</ul></article>'
    ).join('');
  },
  captureTags() {
    const grid = document.getElementById('tagGrid'); grid.innerHTML = '';
    TAGS.forEach(t => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tag' + (Capture.pending && Capture.pending.tags.has(t) ? ' selected' : '');
      el.textContent = t;
      el.setAttribute('aria-pressed', !!(Capture.pending && Capture.pending.tags.has(t)));
      el.onclick = () => Capture.toggleTag(t);
      grid.appendChild(el);
    });
  },
  captureRatings() {
    const row = document.getElementById('ratingRow'); row.innerHTML = '';
    RATINGS.forEach(r => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rating-pill r-' + r.id + (Capture.pending && Capture.pending.rating === r.id ? ' selected' : '');
      el.setAttribute('role', 'radio');
      el.setAttribute('aria-checked', !!(Capture.pending && Capture.pending.rating === r.id));
      el.setAttribute('aria-label', r.label + ' revisit');
      el.innerHTML = '<span class="dot" style="background:'+r.color+';" aria-hidden="true"></span>'+esc(r.label);
      el.onclick = () => Capture.setRating(r.id);
      row.appendChild(el);
    });
  },
  tabBadges() {
    // Legacy tab bar (kept for fallback).
    const archiveBtn = document.querySelector('.tabbar button[data-tab="archive"]');
    if (archiveBtn) archiveBtn.classList.toggle('has-dot', !!(State.spots && State.spots.length > 0));
    // v0.7 — Tab Bar v2 uses "saved" tab name + numeric/dot badge.
    try {
      if (window.TabBarV2 && typeof window.TabBarV2.setBadge === 'function') {
        const n = (State.spots && State.spots.length) || 0;
        window.TabBarV2.setBadge('saved', n > 0 ? n : null);
      }
    } catch (_) {}
  }
};

/* ===== Navigation ===== */
const Nav = {
  /* v0.7 — track which v2 screen module is currently mounted so we can destroy
     it on tab switch (Around Me, AI Route, Search). */
  _mounted: { around: false, airoute: false, search: false },

  go(id) {
    // v0.7 — destroy any previously-mounted v2 screen when switching AWAY.
    try { Nav._unmountV07Modules(id); } catch (_) {}

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    const tabbar = document.getElementById('tabbar');
    if (tabbar) {
      if (el && el.classList.contains('no-tab')) tabbar.classList.add('hidden'); else tabbar.classList.remove('hidden');
    }
    // v0.7 — mirror visibility on the v2 tab bar.
    const v2bar = document.getElementById('we-tabbar');
    if (v2bar) v2bar.style.display = (el && el.classList.contains('no-tab')) ? 'none' : '';

    // Map main-tab id → v2 tab-bar name for active highlight.
    try {
      if (window.TabBarV2 && typeof window.TabBarV2.setActive === 'function') {
        const tabMap = { explore:'explore', around:'around', archive:'saved' };
        if (tabMap[id]) window.TabBarV2.setActive(tabMap[id]);
      }
    } catch (_) {}

    if (id === 'detail' && State.currentRoute) Render.detail(State.currentRoute);
    if (id === 'walk') Walk.renderStop();
    if (id === 'explore') Render.exploreFeed();
    if (id === 'archive') Render.archive();
    if (id === 'offers') Render.offers();
    if (id === 'feedback') { Feedback.setType(State.fbType); }
    if (id === 'changelog') Render.changelog();
    // v0.7 — mount-on-demand for new screens.
    if (id === 'around')   Nav._mountAround();
    if (id === 'airoute')  Nav._mountAIRoute();
    if (id === 'search')   Nav._mountSearch();
    Render.tabBadges();
    Render._track('tab_switched', { tab: id });
  },
  switchTab(tabId) {
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    this.go(tabId);
  },

  /* ---------- v0.7 dynamic screen mounts ---------- */
  async _mountAround() {
    const host = document.getElementById('around');
    if (!host) return;
    try {
      const mod = await import('/beta/app/v2-screens/around-me.js').catch((e) => { throw e; });
      const AroundMe = mod && (mod.default || mod.AroundMe);
      if (!AroundMe || typeof AroundMe.mount !== 'function') throw new Error('AroundMe missing');
      // Always re-mount fresh so GPS watchers + map start from a clean slate.
      try { AroundMe.destroy(); } catch (_) {}
      AroundMe.mount(host);
      Nav._mounted.around = true;
      Render._track('around_me_opened', {});
    } catch (e) {
      try { console.warn('[v0.7] Around Me mount failed', e); } catch(_){}
      host.innerHTML = '<div class="archive-empty" style="padding:60px 28px;text-align:center;"><h3>Around Me is loading…</h3><p>Live map is taking longer than expected. Please retry.</p><button class="btn btn-primary" onclick="Nav.switchTab(\'explore\')">Back to Explore</button></div>';
    }
  },
  async _mountAIRoute() {
    const host = document.getElementById('airoute');
    if (!host) return;
    try {
      const mod = await import('/beta/app/v2-screens/ai-route.js').catch((e) => { throw e; });
      const AIRoute = mod && (mod.default || mod.AIRoute);
      if (!AIRoute || typeof AIRoute.mount !== 'function') throw new Error('AIRoute missing');
      try { AIRoute.destroy(); } catch (_) {}
      await AIRoute.mount(host, {
        onGenerated: (route) => {
          if (!route) return;
          State.currentRoute = route;
          try { AIRoute.destroy(); } catch (_) {}
          Render._track('ai_route_generated', { route_id: route.id || null, stops: (route.stops || []).length });
          Nav.go('detail');
        },
        onClose: () => { try { AIRoute.destroy(); } catch (_) {}; Nav.switchTab('explore'); }
      });
      Nav._mounted.airoute = true;
    } catch (e) {
      try { console.warn('[v0.7] AI Route mount failed', e); } catch(_){}
      host.innerHTML = '<div class="archive-empty" style="padding:60px 28px;text-align:center;"><h3>AI Route is unavailable</h3><p>Try again in a moment, or pick a curated route.</p><button class="btn btn-primary" onclick="Nav.switchTab(\'explore\')">Pick a route</button></div>';
    }
  },
  async _mountSearch() {
    const host = document.getElementById('search');
    if (!host) return;
    try {
      const mod = await import('/beta/app/v2-screens/search.js').catch((e) => { throw e; });
      const Search = mod && (mod.default || mod.Search);
      if (!Search || typeof Search.mount !== 'function') throw new Error('Search missing');
      try { Search.destroy(); } catch (_) {}
      Search.mount(host, {
        routes: ROUTES,
        neighborhoods: NEIGHBORHOODS,
        promotions: PROMOTIONS,
        onPick: (route /*, stop */) => {
          if (!route) return;
          State.currentRoute = route;
          try { Search.destroy(); } catch (_) {}
          Render._track('search_route_picked', { route_id: route.id || null });
          Nav.go('detail');
        }
      });
      Nav._mounted.search = true;
    } catch (e) {
      try { console.warn('[v0.7] Search mount failed', e); } catch(_){}
      host.innerHTML = '<div class="archive-empty" style="padding:60px 28px;text-align:center;"><h3>Search is loading…</h3><button class="btn btn-primary" onclick="Nav.switchTab(\'explore\')">Back to Explore</button></div>';
    }
  },

  _unmountV07Modules(nextId) {
    // Destroy any mounted module when switching to a DIFFERENT screen.
    if (Nav._mounted.around && nextId !== 'around') {
      try { window.AroundMe && window.AroundMe.destroy && window.AroundMe.destroy(); } catch (_) {}
      Nav._mounted.around = false;
    }
    if (Nav._mounted.airoute && nextId !== 'airoute') {
      // ai-route.js doesn't expose destroy on window; best-effort dynamic import.
      import('/beta/app/v2-screens/ai-route.js').then(m => { try { (m.default || m).destroy(); } catch(_){} }).catch(()=>{});
      Nav._mounted.airoute = false;
    }
    if (Nav._mounted.search && nextId !== 'search') {
      try { window.Search && window.Search.destroy && window.Search.destroy(); } catch (_) {}
      Nav._mounted.search = false;
    }
  }
};

/* v2: delegate Capture.open to CaptureV2 when available. */
(function () {
  const originalOpen = Capture.open.bind(Capture);
  Capture.open = function () {
    if (window.CaptureV2 && typeof window.CaptureV2.open === 'function') {
      const route = State.currentRoute;
      const stop = route ? route.stops[State.walkIdx] : null;
      try {
        // Provide an onSave hook so we can update local state + tab badges.
        window.CaptureV2._onSavedHook = async function (saved) {
          State.walkPhotos = (State.walkPhotos || 0) + 1;
          try { const r = await API.spotsList(); State.spots = r.spots || []; } catch {}
          if (typeof Render !== 'undefined' && Render.tabBadges) Render.tabBadges();
        };
        window.CaptureV2.open(stop || {}, route || {});
        return;
      } catch (e) { console.warn('[v2 Capture] failed, falling back', e); }
    }
    return originalOpen();
  };
})();

/* v2: hijack loop completion to render the immersive recap. */
(function () {
  const originalGo = Nav.go.bind(Nav);
  Nav.go = function (id) {
    if (id === 'loop' && window.LoopCompletionV2 && typeof window.LoopCompletionV2.show === 'function') {
      const r = State.currentRoute;
      if (r) {
        try {
          const nbhd = NEIGHBORHOODS.find(n => n.id === r.nbhd);
          window.LoopCompletionV2.show({
            title: r.title,
            slug: r.id,
            neighborhood: nbhd ? nbhd.name : 'NYC',
            stops: (r.stops || []).map(s => ({ lat: s.lat, lng: s.lon, name: s.name })),
            route: (r.stops || []).map(s => [s.lat, s.lon]),
            photos: [], // captured photos optional
            miles: Number(r.miles) || 0,
            duration: (Number(r.minutes) || 0) * 60
          });
          // Hide the legacy loop screen but keep nav consistency.
          document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
          { const tb = document.getElementById('tabbar'); if (tb) tb.classList.add('hidden'); }
          { const v2tb = document.getElementById('we-tabbar'); if (v2tb) v2tb.style.display = 'none'; }
          return;
        } catch (e) { console.warn('[v2 LoopCompletion] failed, falling back', e); }
      }
    }
    return originalGo(id);
  };
})();

/* Wire feedback tab clicks */
document.querySelectorAll('#fbTabs .tab-pill').forEach(b => {
  b.addEventListener('click', () => Feedback.setType(b.dataset.fbtab));
});

App.init();
