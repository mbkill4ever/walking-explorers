// POST /api/feedback/submit  body: { type: 'bug'|'feature'|'rating'|'neighborhood', title, body, meta }
import { getSession, newId } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';

const TYPES = ['bug', 'feature', 'rating', 'neighborhood'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });

  const limit = await rateLimit(req, 'feedback:' + session.userId, { max: 10, windowSec: 60 });
  if (!limit.ok) return json(res, 429, { error: 'rate_limited' });

  const b = await readJson(req);
  if (!TYPES.includes(b.type)) return json(res, 400, { error: 'bad_type' });
  const title = String(b.title || '').trim().slice(0, 140);
  const body = String(b.body || '').trim().slice(0, 4000);
  if (!title) return json(res, 400, { error: 'missing_title' });

  const id = newId(10);
  const item = {
    id, type: b.type, userId: session.userId,
    title, body,
    meta: b.meta && typeof b.meta === 'object' ? JSON.parse(JSON.stringify(b.meta).slice(0, 4000)) : null,
    status: 'open', votes: b.type === 'feature' ? 1 : 0,
    createdAt: Date.now()
  };
  const kv = await getKv();
  await kv.set(`fb:${id}`, item);
  await kv.zadd('fb:all', Date.now(), id);
  if (item.type === 'feature') await kv.zadd('fb:features', item.votes, id);
  await kv.incr('stats:feedback:' + b.type).catch(() => {});
  return json(res, 200, { ok: true, item: { ...item, body: undefined } });
}
