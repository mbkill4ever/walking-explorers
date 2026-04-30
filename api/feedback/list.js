// GET /api/feedback/list?type=feature
// Public-ish (must be logged-in): list of items, default features sorted by votes.
import { getSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const url = new URL(req.url, 'http://x');
  const type = url.searchParams.get('type') || 'feature';
  const kv = await getKv();
  const key = type === 'feature' ? 'fb:features' : 'fb:all';
  const ids = await kv.zrange(key, 0, 49, { rev: true }).catch(() => kv.zrange(key, 0, 49));
  if (!ids || !ids.length) return json(res, 200, { items: [] });
  const items = await Promise.all(ids.map(id => kv.get(`fb:${id}`)));
  const visible = items.filter(Boolean).filter(i => i.type === type).map(i => ({
    id: i.id, type: i.type, title: i.title,
    body: i.body && i.body.slice(0, 300),
    votes: i.votes, status: i.status,
    createdAt: i.createdAt,
    mine: i.userId === session.userId
  }));
  return json(res, 200, { items: visible });
}
