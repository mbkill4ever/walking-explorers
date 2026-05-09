// GET /api/admin/operations -> ops counters
// Returns { kvSizeApprox, apiErrors24h, rateLimitHits24h, suspiciousLogins24h }.
// All counters are read from KV keys the backend agent populates; missing
// values gracefully fall back to 0.
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  const kv = await getKv();

  // Daily-bucket counters: backend writes `ops:errors:YYYYMMDD` etc. Sum the
  // most recent two daily buckets to approximate 'last 24h'.
  const now = new Date();
  const dayKey = (d) => {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  };
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86400000));

  const [
    kvSize,
    errToday, errYest,
    rlToday, rlYest,
    suspToday, suspYest
  ] = await Promise.all([
    kv.get('ops:kv:sizeApprox').catch(() => 0),
    kv.get(`ops:errors:${today}`).catch(() => 0),
    kv.get(`ops:errors:${yesterday}`).catch(() => 0),
    kv.get(`ops:ratelimit:${today}`).catch(() => 0),
    kv.get(`ops:ratelimit:${yesterday}`).catch(() => 0),
    kv.get(`ops:suspiciousLogin:${today}`).catch(() => 0),
    kv.get(`ops:suspiciousLogin:${yesterday}`).catch(() => 0)
  ]);

  return json(res, 200, {
    kvSizeApprox: n(kvSize),
    apiErrors24h: n(errToday) + n(errYest),
    rateLimitHits24h: n(rlToday) + n(rlYest),
    suspiciousLogins24h: n(suspToday) + n(suspYest),
    asOf: now.toISOString()
  });
}
