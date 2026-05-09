// GET  /api/admin/users
//   -> users list, enriched with per-user activity counts + cohort tag from
//      the token they claimed (if any).
// POST /api/admin/users { id, action: 'ban' | 'unban' }
//   -> writes/clears `user:{id}:banned` and emits an audit entry. The auth
//      layer is owned by the backend agent; this endpoint just sets the flag.
import { getAdminSession } from '../../lib/auth.js';
import { listUsers } from '../../lib/tokens.js';
import { getKv } from '../../lib/kv.js';
import { readJson, json } from '../../lib/rate-limit.js';
import { logAudit, actorFromSession } from './_audit.js';

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const actor = actorFromSession(s);
  const kv = await getKv();

  if (req.method === 'GET') {
    const users = await listUsers();

    // Per-user activity counters live at predictable keys; missing == 0.
    const enriched = await Promise.all(users.map(async (u) => {
      const id = u.id;
      const claimedToken = u.claimedToken || u.tokenCode || null;
      const [
        lastSeen, totalLoops, totalSpots, totalFeedback, planTier, banned, cohortFromToken
      ] = await Promise.all([
        kv.get(`user:${id}:lastSeen`).catch(() => null),
        kv.get(`user:${id}:loops:count`).catch(() => 0),
        kv.get(`user:${id}:spots:count`).catch(() => 0),
        kv.get(`user:${id}:feedback:count`).catch(() => 0),
        kv.get(`user:${id}:planTier`).catch(() => null),
        kv.get(`user:${id}:banned`).catch(() => null),
        claimedToken ? kv.get(`token:${claimedToken}:cohort`).catch(() => null) : Promise.resolve(null)
      ]);
      return {
        ...u,
        claimedToken,
        cohort: cohortFromToken || null,
        lastSeen: lastSeen ? Number(lastSeen) || lastSeen : null,
        totalLoops: n(totalLoops),
        totalSpots: n(totalSpots),
        totalFeedback: n(totalFeedback),
        planTier: planTier || u.tier || 'free',
        banned: !!banned
      };
    }));

    return json(res, 200, { users: enriched });
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const id = body && body.id;
    const action = body && body.action;
    if (!id || !['ban', 'unban'].includes(action))
      return json(res, 400, { error: 'bad_input' });

    if (action === 'ban') {
      await kv.set(`user:${id}:banned`, { at: Date.now(), by: actor }).catch(() => null);
    } else {
      await kv.del(`user:${id}:banned`).catch(() => null);
    }
    await logAudit({
      action: 'user.' + action,
      actor,
      target: { type: 'user', id }
    });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'method_not_allowed' });
}
