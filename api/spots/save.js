// POST /api/spots/save  body: { stopName, neighborhood, routeId, tags, rating, notes, lat, lon, photo }
import { getSession, newId } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';

const MAX_PHOTO_BYTES = 350 * 1024; // ~350KB base64 (post-resize on client)

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });

  const limit = await rateLimit(req, 'save_spot:' + session.userId, { max: 30, windowSec: 60 });
  if (!limit.ok) return json(res, 429, { error: 'too_many_saves', retryAfter: limit.retryAfter });

  const b = await readJson(req);
  if (!b.photo || typeof b.photo !== 'string') return json(res, 400, { error: 'missing_photo' });
  if (b.photo.length > MAX_PHOTO_BYTES) return json(res, 413, { error: 'photo_too_large' });

  const id = newId(10);
  const spot = {
    id, userId: session.userId,
    stopName: String(b.stopName || 'Quick spot').slice(0, 200),
    neighborhood: String(b.neighborhood || 'NYC').slice(0, 32),
    routeId: b.routeId || null,
    tags: Array.isArray(b.tags) ? b.tags.slice(0, 10).map(t => String(t).slice(0, 32)) : [],
    rating: ['low', 'medium', 'high', 'legendary'].includes(b.rating) ? b.rating : null,
    notes: String(b.notes || '').slice(0, 1000),
    lat: typeof b.lat === 'number' ? b.lat : null,
    lon: typeof b.lon === 'number' ? b.lon : null,
    photo: b.photo,
    savedAt: Date.now()
  };
  const kv = await getKv();
  await kv.set(`spot:${id}`, spot);
  await kv.sadd(`user:${session.userId}:spots`, id);
  await kv.incr('stats:spots:total').catch(() => {});
  return json(res, 200, { ok: true, spot: { ...spot, photo: undefined } });
}
