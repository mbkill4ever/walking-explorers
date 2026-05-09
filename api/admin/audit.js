// GET /api/admin/audit -> { entries: [{ id, ts, action, actor, target, meta }] }
// Returns the last 200 audit-log entries, newest first.
//
// Source: sorted set `audit:log` (score = ts, member = id) with documents at
// `audit:entry:{id}`. Falls back to a plain set `audit:log` if the KV stub
// doesn't support zsets — the audit log is best-effort, not a billing system.
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

const LIMIT = 200;

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  const kv = await getKv();
  let ids = [];
  try {
    ids = await kv.zrange('audit:log', 0, LIMIT - 1, { rev: true });
  } catch {
    try { ids = await kv.zrange('audit:log', 0, LIMIT - 1); } catch {}
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    try {
      const fallback = await kv.smembers('audit:log').catch(() => []);
      ids = (fallback || []).slice(-LIMIT).reverse();
    } catch {}
  }

  const entries = (await Promise.all(
    (ids || []).map(id => kv.get(`audit:entry:${id}`).catch(() => null))
  )).filter(Boolean);

  // Newest first regardless of source ordering.
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  return json(res, 200, { entries: entries.slice(0, LIMIT) });
}
