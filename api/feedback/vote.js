// POST /api/feedback/vote  body: { id }
// Each user can vote at most once per feature item.
import { getSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const limit = await rateLimit(req, 'vote:' + session.userId, { max: 30, windowSec: 60 });
  if (!limit.ok) return json(res, 429, { error: 'rate_limited' });

  const { id } = await readJson(req);
  if (!id) return json(res, 400, { error: 'missing_id' });
  const kv = await getKv();
  const item = await kv.get(`fb:${id}`);
  if (!item || item.type !== 'feature') return json(res, 404, { error: 'not_found' });
  const already = await kv.sismember(`fb:${id}:voters`, session.userId);
  if (already) return json(res, 200, { ok: true, votes: item.votes, already: true });
  await kv.sadd(`fb:${id}:voters`, session.userId);
  item.votes = (item.votes || 0) + 1;
  await kv.set(`fb:${id}`, item);
  await kv.zincrby('fb:features', 1, id).catch(() => {});
  return json(res, 200, { ok: true, votes: item.votes });
}
