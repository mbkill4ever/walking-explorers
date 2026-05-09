// Simple per-IP fixed-window rate limiter backed by KV.
// Returns { ok: bool, retryAfter: seconds }.
import { getKv } from './kv.js';

// --- Client IP resolution --------------------------------------------------
// SECURITY: never trust the raw `X-Forwarded-For` header. It is set by the
// client and can be spoofed to evade per-IP rate limits. Vercel injects
// `x-real-ip` (the verified edge-observed peer IP) and also exposes the
// resolved IP at `req.ip` on the Edge runtime. We prefer those.
//
// We deliberately fall back to req.socket.remoteAddress before XFF, because
// on Vercel's serverless runtime the socket address is the trusted edge
// proxy, and XFF would only be used on hops we don't control. As a last
// resort we read XFF — but only the LAST entry, which is the one appended
// by the most recent (i.e. trusted) hop, never the leftmost which the
// client controls.
//
// Reference: https://vercel.com/docs/edge-network/headers#x-forwarded-for
function resolveClientIp(req) {
  // Vercel-injected, verified.
  const realIp = req.headers && req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') return realIp.trim();

  // Edge runtime's resolved request IP, if present.
  if (req.ip && typeof req.ip === 'string') return req.ip.trim();

  // Trusted peer address from the underlying socket.
  const socketAddr = req.socket && req.socket.remoteAddress;
  if (socketAddr) return String(socketAddr).trim();

  // Last-resort XFF read: take the RIGHTMOST entry only. The leftmost is
  // attacker-controlled; the rightmost is the IP appended by the closest
  // proxy. Still imperfect — that's why this is the last fallback.
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  return 'anon';
}

export async function rateLimit(req, key, { max = 30, windowSec = 60 } = {}) {
  const ip = resolveClientIp(req);
  const bucket = `rl:${key}:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const kv = await getKv();
  const count = await kv.incr(bucket);
  if (count === 1) await kv.expire(bucket, windowSec).catch(() => {});
  const ok = count <= max;
  return { ok, count, max, retryAfter: ok ? 0 : windowSec };
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1024 * 1024) reject(new Error('payload_too_large')); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
