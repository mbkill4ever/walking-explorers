// GET /api/admin/promotions -> sponsored stops / promotions
// Returns [{ id, business, offer, addedToRoute, redemptionsTracked }].
// Source of truth: KV key `promotions:list` (array). Falls back to [] when
// the backend agent has not seeded the list yet.
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  const kv = await getKv();
  let list = await kv.get('promotions:list').catch(() => null);
  if (!Array.isArray(list)) list = [];

  const promotions = await Promise.all(list.map(async (p) => {
    const id = p.id || p.promoId || null;
    let redemptionsTracked = 0;
    if (id) {
      const v = await kv.get(`promo:${id}:redemptions`).catch(() => 0);
      redemptionsTracked = Number(v) || 0;
    }
    return {
      id,
      business: p.business || p.name || null,
      offer: p.offer || p.description || null,
      addedToRoute: p.addedToRoute || p.routeId || null,
      redemptionsTracked
    };
  }));

  return json(res, 200, { promotions });
}
