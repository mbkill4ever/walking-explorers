// GET    /api/admin/announcements -> { announcement }
// POST   /api/admin/announcements { text, priority } -> sets banner (7-day TTL)
// DELETE /api/admin/announcements -> clears banner
//
// Public consumers read the same KV key (`announcement:current`) via the
// auth/me endpoint — that wiring belongs to the backend agent.
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { readJson, json } from '../../lib/rate-limit.js';

const KEY = 'announcement:current';
const SEVEN_DAYS_SEC = 60 * 60 * 24 * 7;

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const kv = await getKv();

  if (req.method === 'GET') {
    const announcement = await kv.get(KEY).catch(() => null);
    return json(res, 200, { announcement: announcement || null });
  }

  if (req.method === 'POST') {
    const { text, priority = 'info' } = await readJson(req);
    const t = (text || '').toString().trim();
    if (!t) return json(res, 400, { error: 'missing_text' });
    if (t.length > 280) return json(res, 400, { error: 'text_too_long' });
    if (!['info', 'warn'].includes(priority))
      return json(res, 400, { error: 'bad_priority' });

    const announcement = {
      text: t,
      priority,
      createdAt: Date.now(),
      expiresAt: Date.now() + SEVEN_DAYS_SEC * 1000
    };
    await kv.set(KEY, announcement);
    try { await kv.expire(KEY, SEVEN_DAYS_SEC); } catch {}
    return json(res, 200, { ok: true, announcement });
  }

  if (req.method === 'DELETE') {
    await kv.del(KEY).catch(() => null);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'method_not_allowed' });
}
