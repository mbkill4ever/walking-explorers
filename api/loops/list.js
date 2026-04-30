// GET /api/loops/list
import { getSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const kv = await getKv();
  const ids = await kv.smembers(`user:${session.userId}:loops`);
  if (!ids || !ids.length) return json(res, 200, { loops: [] });
  const loops = await Promise.all(ids.map(id => kv.get(`loop:${id}`)));
  const filtered = loops.filter(Boolean).sort((a, b) => b.completedAt - a.completedAt);
  return json(res, 200, { loops: filtered });
}
