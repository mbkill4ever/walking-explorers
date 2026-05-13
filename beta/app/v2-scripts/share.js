/* ==========================================================================
   Walking Explorers v0.7 — Social Sharing Module
   --------------------------------------------------------------------------
   Owner: social-sharing agent (v07_07)
   Path:  /beta/app/v2-scripts/share.js
   API:   default export `Share`
     Share.open({ title, text, url, imageBlob?, hashtags? })
     Share.close()
     Share.cardFromLoop(loop)   -> Promise<Blob>  (PNG 1080x1350)
     Share.cardFromSpot(spot)   -> Promise<Blob>  (PNG 1080x1350)
     Share.referralLink(userId) -> string
   Design tokens (in sync with /tokens.css):
     navy   #1F3864 / #162B4A / #0E1B30
     gold   #E0B341 / #F2D67D
     cream  #FAF7F2 / #F4EFE6
     ink    #0E1320
   Sheet markup + styles live in:
     /beta/app/v2-screens/share-sheet.html
     /beta/app/v2-screens/share-sheet.css
   ========================================================================== */

const TOKENS = {
  navy100: '#1F3864',
  navy200: '#162B4A',
  navy300: '#0E1B30',
  gold:    '#E0B341',
  goldSoft:'#F2D67D',
  goldDark:'#B8941F',
  cream:   '#FAF7F2',
  cream2:  '#F4EFE6',
  ink:     '#0E1320',
  mute:    '#6B7280',
  line:    '#E8E2D6'
};

const CARD_W = 1080;
const CARD_H = 1350;
const SHEET_URL = '/beta/app/v2-screens/share-sheet.html';
const SHEET_CSS = '/beta/app/v2-screens/share-sheet.css';
const PUBLIC_BASE = 'https://walkingexplorers.com';

/* --------------------------------------------------------------------------
   1. Utilities
   -------------------------------------------------------------------------- */

const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  (typeof navigator !== 'undefined' && navigator.userAgent) || ''
);

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function safe(text, fallback = '') {
  return (text == null || text === '') ? fallback : String(text);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function blobToBase64(blob) {
  return blobToDataURL(blob).then(dataUrl => {
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  });
}

/** Promise-based image loader with crossOrigin set so it draws to canvas. */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) { reject(new Error('no url')); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed: ' + url));
    img.src = url;
  });
}

/** Best-effort image load — never throws, returns null on failure. */
async function tryLoadImage(url) {
  try { return await loadImage(url); }
  catch (_) { return null; }
}

function canvasToBlob(canvas, mime = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => {
      if (b) resolve(b);
      else   reject(new Error('canvas.toBlob returned null'));
    }, mime, quality);
  });
}

/* --------------------------------------------------------------------------
   2. Canvas drawing helpers
   -------------------------------------------------------------------------- */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}

/** Cover-fit: draw img inside (dx,dy,dw,dh) cropping as needed. */
function drawCover(ctx, img, dx, dy, dw, dh) {
  const ir = img.width / img.height;
  const dr = dw / dh;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (ir > dr) {
    // image wider than dest → crop sides
    sw = img.height * dr;
    sx = (img.width - sw) / 2;
  } else {
    // image taller than dest → crop top/bottom
    sh = img.width / dr;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** Gradient backdrop used when no hero photo exists. */
function paintFallbackBackdrop(ctx, x, y, w, h) {
  // navy base
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0,    TOKENS.navy100);
  g.addColorStop(0.6,  TOKENS.navy200);
  g.addColorStop(1,    TOKENS.navy300);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  // gold glow
  const radial = ctx.createRadialGradient(
    x + w * 0.5, y + h * 0.25, 0,
    x + w * 0.5, y + h * 0.25, w * 0.7
  );
  radial.addColorStop(0,   'rgba(224,179,65,0.35)');
  radial.addColorStop(0.5, 'rgba(224,179,65,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(x, y, w, h);

  // skyline silhouette along the bottom of this region
  drawSkyline(ctx, x, y + h - 140, w, 140, TOKENS.navy300);
}

/** Tiny stylized NYC-ish skyline. Stateless. */
function drawSkyline(ctx, x, y, w, h, color = TOKENS.navy300) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  // Procedural rooftops
  const segments = 14;
  const segW = w / segments;
  let cursorY = y + h;
  for (let i = 0; i < segments; i++) {
    const top = y + h * (0.30 + 0.55 * Math.abs(Math.sin(i * 1.7 + 0.6)));
    ctx.lineTo(x + i * segW,        cursorY);
    ctx.lineTo(x + i * segW,        top);
    ctx.lineTo(x + (i + 1) * segW,  top);
    cursorY = top;
  }
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();

  // A couple antenna spikes
  ctx.fillRect(x + w * 0.32, y + h * 0.10, 4, h * 0.40);
  ctx.fillRect(x + w * 0.74, y + h * 0.18, 4, h * 0.32);
  ctx.restore();
}

/** Walking Explorers signature mark — dot + wordmark in cream-on-anything. */
function drawSignature(ctx, x, y, fillColor = TOKENS.navy100) {
  ctx.save();
  // Dot
  ctx.fillStyle = TOKENS.gold;
  ctx.beginPath();
  ctx.arc(x + 14, y + 14, 14, 0, Math.PI * 2);
  ctx.fill();
  // Wordmark
  ctx.fillStyle = fillColor;
  ctx.font = '600 28px Inter, -apple-system, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Walking Explorers', x + 40, y + 14);
  ctx.restore();
}

/** Wrap text into lines, returning the lines. Caller draws. */
function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* --------------------------------------------------------------------------
   3. Share-card renderers
   -------------------------------------------------------------------------- */

/**
 * Generate the Loop completion share card.
 * @param {Object} loop
 *   { title, neighborhood, durationMin, distanceMi, stops, heroImage,
 *     photos: [{url}], id }
 * @returns {Promise<Blob>}  PNG blob, 1080x1350
 */
async function cardFromLoop(loop = {}) {
  const canvas = document.createElement('canvas');
  canvas.width  = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  // ----- Top half: hero photo or gradient ----------------------------------
  const heroH = Math.round(CARD_H * 0.55);
  const hero  = await tryLoadImage(loop.heroImage);
  if (hero) {
    drawCover(ctx, hero, 0, 0, CARD_W, heroH);
    // Vignette so text contrast holds if we ever overlay
    const v = ctx.createLinearGradient(0, heroH - 200, 0, heroH);
    v.addColorStop(0, 'rgba(14,19,32,0)');
    v.addColorStop(1, 'rgba(14,19,32,0.35)');
    ctx.fillStyle = v;
    ctx.fillRect(0, heroH - 200, CARD_W, 200);
  } else {
    paintFallbackBackdrop(ctx, 0, 0, CARD_W, heroH);
  }

  // ----- Bottom half: cream panel ------------------------------------------
  ctx.fillStyle = TOKENS.cream;
  ctx.fillRect(0, heroH, CARD_W, CARD_H - heroH);

  // Notch decoration — a gold bar straddling the seam
  ctx.fillStyle = TOKENS.gold;
  ctx.fillRect((CARD_W - 120) / 2, heroH - 8, 120, 16);

  let cursorY = heroH + 80;
  const pad = 72;

  // Eyebrow — neighborhood in uppercase gold
  if (loop.neighborhood) {
    ctx.fillStyle = TOKENS.goldDark;
    ctx.font = '700 32px Inter, -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(safe(loop.neighborhood).toUpperCase(), pad, cursorY);
    cursorY += 56;
  }

  // Title — navy bold, wrapping
  ctx.fillStyle = TOKENS.navy100;
  ctx.font = '800 72px Inter, -apple-system, system-ui, sans-serif';
  const lines = wrapText(ctx, safe(loop.title, 'My Walking Loop'), CARD_W - pad * 2);
  for (const line of lines.slice(0, 3)) {
    ctx.fillText(line, pad, cursorY);
    cursorY += 84;
  }
  cursorY += 8;

  // Stats row
  ctx.fillStyle = TOKENS.ink;
  ctx.font = '600 36px Inter, -apple-system, system-ui, sans-serif';
  const statParts = [];
  if (loop.durationMin != null) statParts.push(`⏱ ${loop.durationMin} min`);
  if (loop.distanceMi  != null) statParts.push(`📏 ${loop.distanceMi} mi`);
  if (loop.stops       != null) statParts.push(`📍 ${loop.stops} stops`);
  if (statParts.length) {
    ctx.fillText(statParts.join('   ·   '), pad, cursorY);
    cursorY += 80;
  }

  // Photo collage strip (max 4 thumbs, square, gap 12)
  const photos = Array.isArray(loop.photos) ? loop.photos.slice(0, 4) : [];
  if (photos.length) {
    const gap   = 16;
    const thumbW = (CARD_W - pad * 2 - gap * (photos.length - 1)) / photos.length;
    const thumbH = thumbW;
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const x = pad + i * (thumbW + gap);
      const img = await tryLoadImage(p && p.url);
      ctx.save();
      roundRect(ctx, x, cursorY, thumbW, thumbH, 18);
      ctx.clip();
      if (img) {
        drawCover(ctx, img, x, cursorY, thumbW, thumbH);
      } else {
        ctx.fillStyle = TOKENS.line;
        ctx.fillRect(x, cursorY, thumbW, thumbH);
      }
      ctx.restore();
      // Hairline border
      ctx.strokeStyle = 'rgba(14,19,32,0.08)';
      ctx.lineWidth = 2;
      roundRect(ctx, x, cursorY, thumbW, thumbH, 18);
      ctx.stroke();
    }
    cursorY += thumbH + 28;
  }

  // Signature row
  drawSignature(ctx, pad, CARD_H - 100, TOKENS.navy100);

  // Tiny skyline mark right side
  ctx.save();
  ctx.globalAlpha = 0.55;
  drawSkyline(ctx, CARD_W - 320, CARD_H - 110, 240, 70, TOKENS.navy300);
  ctx.restore();

  return canvasToBlob(canvas, 'image/png');
}

/**
 * Generate the Spot share card.
 * @param {Object} spot
 *   { name, neighborhood, photo, tags: [string], savedAt, id }
 */
async function cardFromSpot(spot = {}) {
  const canvas = document.createElement('canvas');
  canvas.width  = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  // ----- Top 70%: photo ----------------------------------------------------
  const photoH = Math.round(CARD_H * 0.70);
  const img    = await tryLoadImage(spot.photo);
  if (img) {
    drawCover(ctx, img, 0, 0, CARD_W, photoH);
  } else {
    paintFallbackBackdrop(ctx, 0, 0, CARD_W, photoH);
  }

  // Cream caption panel
  ctx.fillStyle = TOKENS.cream;
  ctx.fillRect(0, photoH, CARD_W, CARD_H - photoH);

  // Gold bar at seam
  ctx.fillStyle = TOKENS.gold;
  ctx.fillRect((CARD_W - 120) / 2, photoH - 8, 120, 16);

  const pad = 72;
  let cursorY = photoH + 50;

  // "Saved in my Archive" eyebrow
  ctx.fillStyle = TOKENS.goldDark;
  ctx.font = '700 28px Inter, -apple-system, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('SAVED IN MY ARCHIVE', pad, cursorY);
  cursorY += 50;

  // Spot name
  ctx.fillStyle = TOKENS.navy100;
  ctx.font = '800 60px Inter, -apple-system, system-ui, sans-serif';
  const titleLines = wrapText(ctx, safe(spot.name, 'A spot'), CARD_W - pad * 2);
  for (const line of titleLines.slice(0, 2)) {
    ctx.fillText(line, pad, cursorY);
    cursorY += 72;
  }
  cursorY += 4;

  // Neighborhood + date row
  const metaBits = [];
  if (spot.neighborhood) metaBits.push(spot.neighborhood);
  if (spot.savedAt) {
    try {
      const d = new Date(spot.savedAt);
      if (!isNaN(d)) metaBits.push(
        d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      );
    } catch (_) { /* ignore */ }
  }
  if (metaBits.length) {
    ctx.fillStyle = TOKENS.ink;
    ctx.font = '500 30px Inter, -apple-system, system-ui, sans-serif';
    ctx.fillText(metaBits.join('  ·  '), pad, cursorY);
    cursorY += 50;
  }

  // Tags row — pill chips
  const tags = Array.isArray(spot.tags) ? spot.tags.slice(0, 4) : [];
  if (tags.length) {
    ctx.font = '600 24px Inter, -apple-system, system-ui, sans-serif';
    let chipX = pad;
    const chipY = cursorY;
    const chipH = 42;
    for (const tag of tags) {
      const label = '#' + String(tag).replace(/^#/, '');
      const textW = ctx.measureText(label).width;
      const chipW = textW + 32;
      if (chipX + chipW > CARD_W - pad) break;
      ctx.fillStyle = 'rgba(31,56,100,0.08)';
      roundRect(ctx, chipX, chipY, chipW, chipH, 21);
      ctx.fill();
      ctx.fillStyle = TOKENS.navy100;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, chipX + 16, chipY + chipH / 2);
      ctx.textBaseline = 'top';
      chipX += chipW + 10;
    }
  }

  // Signature + skyline
  drawSignature(ctx, pad, CARD_H - 80, TOKENS.navy100);
  ctx.save();
  ctx.globalAlpha = 0.55;
  drawSkyline(ctx, CARD_W - 320, CARD_H - 90, 240, 60, TOKENS.navy300);
  ctx.restore();

  return canvasToBlob(canvas, 'image/png');
}

/* --------------------------------------------------------------------------
   4. Referral link
   -------------------------------------------------------------------------- */

function referralLink(userId) {
  const id = encodeURIComponent(String(userId || 'anon'));
  return `${PUBLIC_BASE}/beta?ref=${id}`;
}

/** Best-effort: pull the current user's id from app-shell state, falling
 *  back to a localStorage anon id, or "anon". Never throws. */
function currentUserId() {
  try {
    if (typeof window !== 'undefined') {
      // 1. app-shell registers a global with current user
      const u = window.__we_user || (window.WalkingExplorers && window.WalkingExplorers.user);
      if (u && u.id) return u.id;
      // 2. localStorage fallback
      const ls = localStorage.getItem('we.userId');
      if (ls) return ls;
    }
  } catch (_) { /* ignore */ }
  return 'anon';
}

/* --------------------------------------------------------------------------
   5. Platform handlers
   -------------------------------------------------------------------------- */

function buildHashtagString(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.map(t => String(t).replace(/^#/, '').replace(/\s+/g, '')).join(',');
}

function buildShareText({ title, text, url }) {
  const parts = [];
  if (title) parts.push(title);
  if (text)  parts.push(text);
  return parts.join(' — ') + (url ? ` ${url}` : '');
}

async function shareToInstagramStories(opts) {
  if (!opts.imageBlob) {
    throw new Error('Instagram Stories share requires an imageBlob');
  }
  const b64 = await blobToBase64(opts.imageBlob);
  const uri = `instagram-stories://share?source_application=walking-explorers` +
              `&background_image=${encodeURIComponent(b64)}`;
  // We cannot detect handler success — best-effort open.
  window.location.href = uri;
}

function shareToX({ title, text, url, hashtags }) {
  const tweet = [title, text].filter(Boolean).join(' — ');
  const params = new URLSearchParams();
  if (tweet) params.set('text', tweet);
  if (url)   params.set('url',  url);
  const tags = buildHashtagString(hashtags);
  if (tags)  params.set('hashtags', tags);
  window.open(`https://twitter.com/intent/tweet?${params.toString()}`,
              '_blank', 'noopener,noreferrer');
}

function shareToWhatsApp(opts) {
  const text = buildShareText(opts);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,
              '_blank', 'noopener,noreferrer');
}

function shareViaEmail({ title, text, url }) {
  const subject = title || 'A walk worth sharing';
  const body    = [text, url].filter(Boolean).join('\n\n');
  // mailto: ignores window.open in most browsers — use location
  window.location.href =
    `mailto:?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
}

async function shareNative(opts) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    throw new Error('Web Share API not available');
  }
  const payload = {
    title: opts.title || '',
    text:  opts.text  || '',
    url:   opts.url   || ''
  };
  // Attach the file if supported.
  if (opts.imageBlob && typeof navigator.canShare === 'function') {
    const file = new File([opts.imageBlob], 'walking-explorers.png', { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      payload.files = [file];
    }
  }
  await navigator.share(payload);
}

async function copyToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for older browsers / iOS Safari pre-13.4
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); }
  finally { ta.remove(); }
}

/* --------------------------------------------------------------------------
   6. Share-sheet DOM (single mounted instance, lazy-built)
   -------------------------------------------------------------------------- */

let _sheetEl       = null;
let _sheetTemplate = null;
let _cssLoaded     = false;
let _activeOpts    = null;
let _previousFocus = null;
let _dragState     = null;

const SHEET_MARKUP_FALLBACK = `
<div class="we-share" role="dialog" aria-modal="true" aria-labelledby="we-share-title" hidden>
  <div class="we-share__backdrop" data-share-close></div>
  <div class="we-share__sheet" role="document">
    <button class="we-share__handle" type="button" aria-label="Drag to dismiss" data-share-handle>
      <span></span>
    </button>
    <header class="we-share__head">
      <h2 class="we-share__title" id="we-share-title">Share this walk</h2>
      <button class="we-share__close" type="button" aria-label="Close" data-share-close>&times;</button>
    </header>
    <figure class="we-share__preview">
      <img class="we-share__preview-img" alt="" data-share-preview />
      <figcaption class="we-share__preview-cap" data-share-caption></figcaption>
    </figure>
    <div class="we-share__grid" role="group" aria-label="Share to platform">
      <button class="we-share__tile" type="button" data-share-platform="instagram" data-mobile-only>
        <span class="we-share__tile-icon" aria-hidden="true">IG</span>
        <span class="we-share__tile-label">Instagram</span>
      </button>
      <button class="we-share__tile" type="button" data-share-platform="x">
        <span class="we-share__tile-icon" aria-hidden="true">X</span>
        <span class="we-share__tile-label">X</span>
      </button>
      <button class="we-share__tile" type="button" data-share-platform="whatsapp">
        <span class="we-share__tile-icon" aria-hidden="true">WA</span>
        <span class="we-share__tile-label">WhatsApp</span>
      </button>
      <button class="we-share__tile" type="button" data-share-platform="native" data-native-only>
        <span class="we-share__tile-icon" aria-hidden="true">&#8682;</span>
        <span class="we-share__tile-label">More</span>
      </button>
      <button class="we-share__tile" type="button" data-share-platform="copy">
        <span class="we-share__tile-icon" aria-hidden="true">&#128279;</span>
        <span class="we-share__tile-label">Copy link</span>
      </button>
      <button class="we-share__tile" type="button" data-share-platform="email">
        <span class="we-share__tile-icon" aria-hidden="true">&#9993;</span>
        <span class="we-share__tile-label">Email</span>
      </button>
    </div>
    <section class="we-share__refer" aria-labelledby="we-share-refer-label">
      <h3 class="we-share__refer-label" id="we-share-refer-label">Refer a friend</h3>
      <p class="we-share__refer-hint">Send this link. They get the app, you'll both get goodies in v0.8.</p>
      <div class="we-share__refer-row">
        <input class="we-share__refer-input" type="text" readonly data-share-refer-input aria-label="Your referral link" />
        <button class="we-share__refer-btn" type="button" data-share-refer-copy>Copy</button>
      </div>
    </section>
    <div class="we-share__toast" role="status" aria-live="polite" data-share-toast></div>
  </div>
</div>`;

function ensureCss() {
  if (_cssLoaded) return;
  if (typeof document === 'undefined') return;
  const existing = document.querySelector('link[data-we-share-css]');
  if (existing) { _cssLoaded = true; return; }
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = SHEET_CSS;
  link.setAttribute('data-we-share-css', '');
  document.head.appendChild(link);
  _cssLoaded = true;
}

async function fetchTemplate() {
  if (_sheetTemplate) return _sheetTemplate;
  try {
    const res = await fetch(SHEET_URL, { credentials: 'same-origin' });
    if (res.ok) {
      _sheetTemplate = await res.text();
      return _sheetTemplate;
    }
  } catch (_) { /* fall through */ }
  _sheetTemplate = SHEET_MARKUP_FALLBACK;
  return _sheetTemplate;
}

async function ensureSheet() {
  if (_sheetEl) return _sheetEl;
  ensureCss();
  const html = await fetchTemplate();
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  _sheetEl = wrap.firstElementChild;
  document.body.appendChild(_sheetEl);
  bindSheet(_sheetEl);
  return _sheetEl;
}

function showToast(msg) {
  const el = _sheetEl && _sheetEl.querySelector('[data-share-toast]');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

function bindSheet(root) {
  // Close handlers
  root.querySelectorAll('[data-share-close]').forEach(el => {
    el.addEventListener('click', close);
  });

  // Platform tiles
  root.querySelectorAll('[data-share-platform]').forEach(btn => {
    btn.addEventListener('click', () => handlePlatform(btn.dataset.sharePlatform));
  });

  // Referral copy
  const referBtn = root.querySelector('[data-share-refer-copy]');
  if (referBtn) {
    referBtn.addEventListener('click', async () => {
      const input = root.querySelector('[data-share-refer-input]');
      if (!input) return;
      try {
        await copyToClipboard(input.value);
        showToast('Referral link copied');
      } catch (_) {
        showToast('Could not copy link');
      }
    });
  }

  // ESC to close
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // Drag-to-dismiss on the handle
  const handle = root.querySelector('[data-share-handle]');
  const sheet  = root.querySelector('.we-share__sheet');
  if (handle && sheet) {
    const onStart = (clientY) => {
      _dragState = { startY: clientY, dy: 0 };
      sheet.style.transition = 'none';
    };
    const onMove = (clientY) => {
      if (!_dragState) return;
      _dragState.dy = Math.max(0, clientY - _dragState.startY);
      sheet.style.transform = `translateY(${_dragState.dy}px)`;
    };
    const onEnd = () => {
      if (!_dragState) return;
      const shouldClose = _dragState.dy > 120;
      sheet.style.transition = '';
      sheet.style.transform = '';
      _dragState = null;
      if (shouldClose) close();
    };
    handle.addEventListener('touchstart', e => onStart(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchmove',  e => onMove(e.touches[0].clientY),  { passive: true });
    handle.addEventListener('touchend',   onEnd);
    handle.addEventListener('mousedown', e => {
      onStart(e.clientY);
      const mm = ev => onMove(ev.clientY);
      const mu = () => {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup',   mu);
        onEnd();
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup',   mu);
    });
  }
}

function applyVisibility(root) {
  // Hide IG button on desktop
  root.querySelectorAll('[data-mobile-only]').forEach(el => {
    el.hidden = !isMobile();
  });
  // Hide native-share tile if API not available
  const nativeAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  root.querySelectorAll('[data-native-only]').forEach(el => {
    el.hidden = !nativeAvailable;
  });
}

async function handlePlatform(platform) {
  if (!_activeOpts) return;
  try {
    switch (platform) {
      case 'instagram':
        await shareToInstagramStories(_activeOpts);
        break;
      case 'x':
        shareToX(_activeOpts);
        break;
      case 'whatsapp':
        shareToWhatsApp(_activeOpts);
        break;
      case 'native':
        await shareNative(_activeOpts);
        close();
        break;
      case 'copy': {
        const link = _activeOpts.url || '';
        await copyToClipboard(link);
        showToast('Link copied');
        break;
      }
      case 'email':
        shareViaEmail(_activeOpts);
        break;
    }
  } catch (err) {
    // Native share aborted by user is an AbortError — silent.
    if (err && err.name === 'AbortError') return;
    showToast('Could not share. Try another option.');
    // eslint-disable-next-line no-console
    console.warn('[Share]', platform, err);
  }
}

/* --------------------------------------------------------------------------
   7. open / close
   -------------------------------------------------------------------------- */

async function open(opts = {}) {
  if (typeof document === 'undefined') return;
  _activeOpts = {
    title:     safe(opts.title, ''),
    text:      safe(opts.text,  ''),
    url:       safe(opts.url,   PUBLIC_BASE),
    imageBlob: opts.imageBlob || null,
    hashtags:  Array.isArray(opts.hashtags) ? opts.hashtags : ['walkingexplorers']
  };

  const root = await ensureSheet();
  applyVisibility(root);

  // Preview image
  const preview = root.querySelector('[data-share-preview]');
  const caption = root.querySelector('[data-share-caption]');
  if (preview) {
    if (_activeOpts.imageBlob) {
      if (preview._previewUrl) URL.revokeObjectURL(preview._previewUrl);
      const url = URL.createObjectURL(_activeOpts.imageBlob);
      preview._previewUrl = url;
      preview.src = url;
      preview.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  }
  if (caption) caption.textContent = _activeOpts.title || '';

  // Title in header
  const titleEl = root.querySelector('#we-share-title');
  if (titleEl) titleEl.textContent = _activeOpts.title || 'Share';

  // Referral link
  const referInput = root.querySelector('[data-share-refer-input]');
  if (referInput) referInput.value = referralLink(currentUserId());

  // Show
  _previousFocus = document.activeElement;
  root.hidden = false;
  // Force reflow then add a state class so CSS transitions can run.
  // eslint-disable-next-line no-unused-expressions
  root.offsetHeight;
  root.classList.add('is-open');
  document.documentElement.style.overflow = 'hidden';

  // Focus management — first focusable tile
  const firstTile = root.querySelector('[data-share-platform]:not([hidden])');
  if (firstTile) {
    if (prefersReducedMotion()) firstTile.focus();
    else setTimeout(() => firstTile.focus(), 200);
  }
}

function close() {
  if (!_sheetEl) return;
  _sheetEl.classList.remove('is-open');
  document.documentElement.style.overflow = '';
  const finish = () => {
    if (_sheetEl) _sheetEl.hidden = true;
    if (_previousFocus && typeof _previousFocus.focus === 'function') {
      _previousFocus.focus();
    }
    _previousFocus = null;
  };
  if (prefersReducedMotion()) finish();
  else setTimeout(finish, 220);
  _activeOpts = null;
}

/* --------------------------------------------------------------------------
   8. Public API
   -------------------------------------------------------------------------- */

const Share = {
  open,
  close,
  cardFromLoop,
  cardFromSpot,
  referralLink,
  // Exposed for tests / debugging — not part of the stable API
  _internals: { loadImage, drawCover, wrapText }
};

export default Share;
export { open, close, cardFromLoop, cardFromSpot, referralLink };
