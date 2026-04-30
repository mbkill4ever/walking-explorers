// GET /api/spots/list
import { getSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const kv = await getKv();
  const ids = await kv.smembers(`user:${session.userId}:spots`);
  if (!ids || !ids.length) return json(res, 200, { spots: [] });
  const spots = await Promise.all(ids.map(id => kv.get(`spot:${id}`)));
  const filtered = spots.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
  return json(res, 200, { spots: filtered });
}
