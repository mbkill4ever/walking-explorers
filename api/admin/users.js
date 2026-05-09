// GET /api/admin/users -> users list, enriched with per-user activity counts
import { getAdminSession } from '../../lib/auth.js';
import { listUsers } from '../../lib/tokens.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  const users = await listUsers();
  const kv = await getKv();

  // Per-user activity counters live at predictable keys; missing == 0.
  const enriched = await Promise.all(users.map(async (u) => {
    const id = u.id;
    const [lastSeen, totalLoops, totalSpots, totalFeedback, planTier] = await Promise.all([
      kv.get(`user:${id}:lastSeen`).catch(() => null),
      kv.get(`user:${id}:loops:count`).catch(() => 0),
      kv.get(`user:${id}:spots:count`).catch(() => 0),
      kv.get(`user:${id}:feedback:count`).catch(() => 0),
      kv.get(`user:${id}:planTier`).catch(() => null)
    ]);
    return {
      ...u,
      lastSeen: lastSeen ? Number(lastSeen) || lastSeen : null,
      totalLoops: n(totalLoops),
      totalSpots: n(totalSpots),
      totalFeedback: n(totalFeedback),
      planTier: planTier || u.tier || 'free'
    };
  }));

  return json(res, 200, { users: enriched });
}
