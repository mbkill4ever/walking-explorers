// GET /api/admin/feedback  ?status=open|closed&limit=100
// POST /api/admin/feedback { id, status }
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { readJson, json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const kv = await getKv();

  if (req.method === 'GET') {
    const ids = await kv.zrange('fb:all', 0, 199, { rev: true }).catch(() => kv.zrange('fb:all', 0, 199));
    const items = await Promise.all((ids || []).map(id => kv.get(`fb:${id}`)));
    return json(res, 200, { items: items.filter(Boolean) });
  }
  if (req.method === 'POST') {
    const { id, status } = await readJson(req);
    if (!id || !['open','reviewing','planned','shipped','rejected','closed'].includes(status))
      return json(res, 400, { error: 'bad_input' });
    const item = await kv.get(`fb:${id}`);
    if (!item) return json(res, 404, { error: 'not_found' });
    item.status = status;
    item.updatedAt = Date.now();
    await kv.set(`fb:${id}`, item);
    return json(res, 200, { ok: true, item });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}
