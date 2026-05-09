// lib/csrf.js
// CSRF protection — double-submit cookie pattern with HMAC-signed tokens.
//
// Strategy
// --------
// On every request that returns HTML for an authenticated user (or any user we
// want to protect), set a cookie `csrf` containing a signed token bound to the
// current session id. Client JS reads the cookie and echoes the token back on
// every state-changing request (POST/PUT/PATCH/DELETE) via the custom header
// `x-csrf-token`. The server verifies that:
//   1. the header token matches the cookie token (double-submit), and
//   2. the token's HMAC signature is valid under COOKIE_SECRET, and
//   3. the token was issued for the same session id we have server-side, and
//   4. the token has not expired (default 8 hours).
//
// This blocks classic cross-site form/XHR CSRF because an attacker page on
// another origin cannot read the victim's `csrf` cookie (SameSite=Lax + the
// fact JS on evil.com can't read walkingexplorers.com cookies) and therefore
// cannot set a matching `x-csrf-token` header.
//
// Why HMAC the token instead of just storing in KV?
//   - Stateless verification, no extra KV round trip on every request.
//   - Tokens are bound to the session, so leaking one session's token doesn't
//     authorize another session's requests.
//
// Integration (handed off to the api/* agent — DO NOT WIRE HERE)
// --------------------------------------------------------------
// 1. Login / session-establishing endpoints:
//        import { generateCsrfToken, CSRF_COOKIE_NAME } from '../lib/csrf.js';
//        const token = generateCsrfToken(sessionId);
//        // Set as a NON-HttpOnly cookie so client JS can read+echo it.
//        // SameSite=Lax is enough for double-submit; Strict if you can.
//        res.setHeader('Set-Cookie', [
//          `${CSRF_COOKIE_NAME}=${token}; Path=/; Secure; SameSite=Lax; Max-Age=28800`
//        ]);
//
// 2. State-changing endpoints (POST/PUT/PATCH/DELETE under /api/*):
//        import { verifyCsrfRequest } from '../lib/csrf.js';
//        const ok = verifyCsrfRequest(req, sessionId);
//        if (!ok) return res.status(403).json({ error: 'csrf_failed' });
//
//    Where `req` exposes `req.headers['x-csrf-token']` and `req.headers.cookie`.
//
// 3. Safe methods (GET/HEAD/OPTIONS) MUST NOT mutate state, so they do not
//    require a CSRF check. The /api/* no-store Cache-Control set in vercel.json
//    keeps cached responses from leaking sensitive data either way.
//
// 4. Client-side helper (sketch — to be added in frontend code, not here):
//        function csrfHeader() {
//          const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
//          return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
//        }
//        fetch('/api/whatever', {
//          method: 'POST',
//          headers: { 'content-type': 'application/json', ...csrfHeader() },
//          body: JSON.stringify(payload)
//        });
//
// Env
// ---
//   COOKIE_SECRET — required, min 32 chars. Same secret used to sign session
//                   cookies so rotation is unified.
//
// This module has zero runtime dependencies beyond Node's built-in `crypto`,
// so it works in both Node and Edge runtimes (crypto.webcrypto is also fine,
// but we stick to node:crypto for simpler sync HMAC).

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const CSRF_COOKIE_NAME = 'csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

// 8 hours. Short enough to limit exposure, long enough to outlive a normal
// session of using the app.
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

// Methods that must be CSRF-checked.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getSecret() {
  const s = process.env.COOKIE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('csrf: COOKIE_SECRET env var missing or shorter than 32 chars');
  }
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function hmac(payload) {
  return createHmac('sha256', getSecret()).update(payload).digest();
}

/**
 * Generate a signed CSRF token bound to a session id.
 *
 * Token format: base64url(nonce).base64url(sessionId).base64url(expiresAtMs).base64url(hmac)
 *
 * @param {string} sessionId  Opaque session id (or user id) — must be the same
 *                            value the server has when verifying.
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=DEFAULT_TTL_MS]
 * @returns {string}          Token string suitable for cookie + header value.
 */
export function generateCsrfToken(sessionId, opts = {}) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('csrf: sessionId required');
  }
  const ttl = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS;
  const nonce = randomBytes(16);
  const expiresAt = Date.now() + ttl;

  const nonceB = b64url(nonce);
  const sidB   = b64url(Buffer.from(sessionId, 'utf8'));
  const expB   = b64url(Buffer.from(String(expiresAt), 'utf8'));

  const payload = `${nonceB}.${sidB}.${expB}`;
  const sig = b64url(hmac(payload));
  return `${payload}.${sig}`;
}

/**
 * Verify a CSRF token against a known session id.
 *
 * @param {string} token       The token to verify (from the request).
 * @param {string} sessionId   The server-side session id to bind against.
 * @returns {boolean}          true iff token is well-formed, signature valid,
 *                             session matches, and token has not expired.
 */
export function verifyCsrfToken(token, sessionId) {
  if (!token || typeof token !== 'string') return false;
  if (!sessionId || typeof sessionId !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [nonceB, sidB, expB, sigB] = parts;

  // Re-derive the expected signature.
  let expectedSig, providedSig;
  try {
    expectedSig = hmac(`${nonceB}.${sidB}.${expB}`);
    providedSig = b64urlDecode(sigB);
  } catch {
    return false;
  }
  if (expectedSig.length !== providedSig.length) return false;
  if (!timingSafeEqual(expectedSig, providedSig)) return false;

  // Check session binding.
  let sidFromToken;
  try {
    sidFromToken = b64urlDecode(sidB).toString('utf8');
  } catch {
    return false;
  }
  if (sidFromToken !== sessionId) return false;

  // Check expiry.
  let expiresAt;
  try {
    expiresAt = Number(b64urlDecode(expB).toString('utf8'));
  } catch {
    return false;
  }
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  return true;
}

/**
 * Read the CSRF cookie value out of a Cookie header string.
 * @param {string|undefined} cookieHeader  Raw `req.headers.cookie`.
 * @returns {string|null}
 */
export function readCsrfCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k === CSRF_COOKIE_NAME) {
      return decodeURIComponent(p.slice(eq + 1));
    }
  }
  return null;
}

/**
 * Convenience wrapper to verify a full request in one call.
 * Implements the double-submit check: header token must equal cookie token,
 * and both must verify against the given sessionId.
 *
 * Safe methods (GET/HEAD/OPTIONS) are allowed through without a token, since
 * they must not mutate state. Callers are responsible for not mutating state
 * on safe methods.
 *
 * @param {{ method?: string, headers: Record<string,string|string[]> }} req
 * @param {string} sessionId
 * @returns {boolean}
 */
export function verifyCsrfRequest(req, sessionId) {
  const method = (req?.method || 'GET').toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return true;

  const headers = req.headers || {};
  const headerToken = String(
    headers[CSRF_HEADER_NAME] || headers[CSRF_HEADER_NAME.toUpperCase()] || ''
  );
  const cookieHeader = headers.cookie || headers.Cookie || '';
  const cookieToken = readCsrfCookie(Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader);

  if (!headerToken || !cookieToken) return false;

  // Double-submit: both values must match exactly.
  const a = Buffer.from(headerToken, 'utf8');
  const b = Buffer.from(cookieToken, 'utf8');
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  // And the (matching) token must be a valid signed token for this session.
  return verifyCsrfToken(headerToken, sessionId);
}

/**
 * Build a `Set-Cookie` value for the CSRF cookie.
 * NOTE: Must be NON-HttpOnly so client JS can echo it back as a header.
 * SameSite=Lax is sufficient for double-submit; Strict if your UX allows.
 *
 * @param {string} token
 * @param {object} [opts]
 * @param {number} [opts.maxAgeSec]
 * @param {boolean} [opts.secure=true]
 * @param {'Lax'|'Strict'|'None'} [opts.sameSite='Lax']
 * @returns {string}
 */
export function buildCsrfCookie(token, opts = {}) {
  const maxAge = Number.isFinite(opts.maxAgeSec) ? opts.maxAgeSec : DEFAULT_TTL_MS / 1000;
  const secure = opts.secure !== false;
  const sameSite = opts.sameSite || 'Lax';
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
