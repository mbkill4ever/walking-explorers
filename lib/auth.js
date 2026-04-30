// Session signing/verification. No JWT — just signed random IDs stored in KV.
// Cookie format: we_session={sid}.{sig}
import crypto from 'crypto';
import { getKv } from './kv.js';

const COOKIE_NAME = 'we_session';
const ADMIN_COOKIE_NAME = 'we_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ADMIN_TTL_SECONDS = 60 * 60 * 8;          // 8 hours

function secret() {
  const s = process.env.COOKIE_SECRET;
  if (!s) {
    // We refuse to run without a secret in production. In Vercel preview/dev
    // before env is set, fall back to a deterministic dev secret + warn.
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('COOKIE_SECRET is not set');
    }
    return 'dev-only-not-for-production-please-set-COOKIE_SECRET';
  }
  return s;
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
