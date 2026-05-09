// Session signing/verification. No JWT — just signed random IDs stored in KV.
// Cookie format: we_session={sid}.{sig}
import crypto from 'crypto';
import { getKv } from './kv.js';

const COOKIE_NAME = 'we_session';
const ADMIN_COOKIE_NAME = 'we_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ADMIN_TTL_SECONDS = 60 * 60 * 8;          // 8 hours

// --- Secret enforcement -----------------------------------------------------
// We refuse to run without a real COOKIE_SECRET in any deployed environment.
// Previously we only failed in `production`, which meant Vercel `preview`
// branches silently fell back to a hardcoded dev secret — anyone who guessed
// the fallback could mint sessions. We now fail-fast on BOTH `production` and
// `preview`, and only allow the dev fallback in local dev (no VERCEL_ENV).
//
// This check runs at module-load time so a misconfigured deploy fails the
// cold start of the very first function — not on the first authenticated
// request, where it would be much harder to notice.
const VERCEL_ENV = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development' | undefined
const IS_DEPLOYED = VERCEL_ENV === 'production' || VERCEL_ENV === 'preview';

if (IS_DEPLOYED && !process.env.COOKIE_SECRET) {
  // Throwing here aborts cold start. Vercel surfaces this in build/runtime
  // logs immediately, which is what we want.
  throw new Error(
    `COOKIE_SECRET is not set on VERCEL_ENV=${VERCEL_ENV}. ` +
    `Refusing to start with a dev-fallback secret on a deployed environment.`
  );
}

function secret() {
  const s = process.env.COOKIE_SECRET;
  if (s) return s;
  // Only reachable in pure local dev (no VERCEL_ENV). The IS_DEPLOYED guard
  // above already throws before we get here on production/preview.
  return 'dev-only-not-for-production-please-set-COOKIE_SECRET';
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function safeEq(a, b) {
  const A = Buffer.from(a || '', 'utf8');
  const B = Buffer.from(b || '', 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

export function newId(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function setSessionCookie(res, sid, opts = {}) {
  const isAdmin = !!opts.admin;
  const name = isAdmin ? ADMIN_COOKIE_NAME : COOKIE_NAME;
  const maxAge = isAdmin ? ADMIN_TTL_SECONDS : SESSION_TTL_SECONDS;
  const sig = sign(sid);
  const value = `${sid}.${sig}`;
  const cookie = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  // Append to any existing Set-Cookie header
  const existing = res.getHeader('Set-Cookie');
  if (existing) {
    res.setHeader('Set-Cookie', Array.isArray(existing) ? existing.concat(cookie) : [existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
}

export function clearSessionCookie(res, opts = {}) {
  const name = opts.admin ? ADMIN_COOKIE_NAME : COOKIE_NAME;
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(/;\s*/).filter(Boolean).map(p => {
      const i = p.indexOf('=');
      return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
    })
  );
}

function validateCookieValue(raw) {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  const sid = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!safeEq(sig, sign(sid))) return null;
  return sid;
}

// Resolve current user session. Returns null if unauthenticated.
export async function getSession(req) {
  const cookies = parseCookies(req);
  const sid = validateCookieValue(cookies[COOKIE_NAME]);
  if (!sid) return null;
  const kv = await getKv();
  const data = await kv.get(`session:${sid}`);
  if (!data) return null;
  return { sid, ...data };
}

// Resolve current admin session. Returns null if unauthenticated.
export async function getAdminSession(req) {
  const cookies = parseCookies(req);
  const sid = validateCookieValue(cookies[ADMIN_COOKIE_NAME]);
  if (!sid) return null;
  const kv = await getKv();
  const data = await kv.get(`admin:session:${sid}`);
  if (!data) return null;
  return { sid, ...data };
}

export async function createSession({ userId, tier }) {
  const sid = newId();
  const kv = await getKv();
  await kv.set(`session:${sid}`, { userId, tier, createdAt: Date.now() }, { ex: SESSION_TTL_SECONDS });
  return sid;
}

export async function createAdminSession() {
  const sid = newId();
  const kv = await getKv();
  await kv.set(`admin:session:${sid}`, { createdAt: Date.now() }, { ex: ADMIN_TTL_SECONDS });
  return sid;
}

export async function destroySession(sid) {
  const kv = await getKv();
  await kv.del(`session:${sid}`);
}

export async function destroyAdminSession(sid) {
  const kv = await getKv();
  await kv.del(`admin:session:${sid}`);
}
