// POST /api/spots/delete  body: { id }
import { getSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { readJson, json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const { id } = await readJson(req);
  if (!id) return json(res, 400, { error: 'missing_id' });
  const kv = await getKv();
  const spot = await kv.get(`spot:${id}`);
  if (!spot || spot.userId !== session.userId) return json(res, 404, { error: 'not_found' });
  await kv.del(`spot:${id}`);
  await kv.srem(`user:${session.userId}:spots`, id);
  return json(res, 200, { ok: true });
}
