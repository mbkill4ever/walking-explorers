// POST /api/loops/save  body: { routeId, routeTitle, nbhd, stops, miles, minutes, photos }
import { getSession, newId } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { readJson, json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });

  const b = await readJson(req);
  const id = newId(10);
  const loop = {
    id, userId: session.userId,
    routeId: String(b.routeId || '').slice(0, 64),
    routeTitle: String(b.routeTitle || 'NYC walk').slice(0, 200),
    nbhd: String(b.nbhd || 'NYC').slice(0, 32),
    stops: Number(b.stops) || 0,
    miles: Number(b.miles) || 0,
    minutes: Number(b.minutes) || 0,
    photos: Number(b.photos) || 0,
    completedAt: Date.now()
  };
  const kv = await getKv();
  await kv.set(`loop:${id}`, loop);
  await kv.sadd(`user:${session.userId}:loops`, id);
  await kv.incr('stats:loops:total').catch(() => {});
  return json(res, 200, { ok: true, loop });
}
