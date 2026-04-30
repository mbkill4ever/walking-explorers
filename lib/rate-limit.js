// Simple per-IP fixed-window rate limiter backed by KV.
// Returns { ok: bool, retryAfter: seconds }.
import { getKv } from './kv.js';

export async function rateLimit(req, key, { max = 30, windowSec = 60 } = {}) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'anon';
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
