// GET /api/admin/feedback  ?status=open|closed&limit=100
// POST /api/admin/feedback { id, status, publishToChangelog? }
//
// When status === 'shipped' AND publishToChangelog is truthy, we also append
// the item to KV `changelog:public` (an array) so the public /changelog page
// can render it later.
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { readJson, json } from '../../lib/rate-limit.js';
import { logAudit, actorFromSession } from './_audit.js';

const ALLOWED_STATUSES = ['open', 'reviewing', 'planned', 'shipped', 'rejected', 'closed'];

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const actor = actorFromSession(s);
  const kv = await getKv();

  if (req.method === 'GET') {
    const ids = await kv.zrange('fb:all', 0, 199, { rev: true }).catch(() => kv.zrange('fb:all', 0, 199));
    const items = await Promise.all((ids || []).map(id => kv.get(`fb:${id}`)));
    return json(res, 200, { items: items.filter(Boolean) });
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const { id, status, publishToChangelog } = body || {};
    if (!id || !ALLOWED_STATUSES.includes(status))
      return json(res, 400, { error: 'bad_input' });
    const item = await kv.get(`fb:${id}`);
    if (!item) return json(res, 404, { error: 'not_found' });
    const prevStatus = item.status || 'open';
    item.status = status;
    item.updatedAt = Date.now();
    await kv.set(`fb:${id}`, item);

    let changelogEntry = null;
    if (status === 'shipped' && publishToChangelog) {
      // Append to the public changelog list. We keep a flat array under one
      // key — easy for the public page to fetch and render. Newest first.
      let list = await kv.get('changelog:public').catch(() => null);
      if (!Array.isArray(list)) list = [];
      changelogEntry = {
        id: 'cl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        sourceFeedbackId: id,
        title: String(item.title || '').slice(0, 200),
        body: String(item.body || '').slice(0, 1000),
        type: item.type || 'feature',
        publishedAt: Date.now(),
        publishedBy: actor
      };
      list.unshift(changelogEntry);
      // Keep the list bounded — last 200 entries.
      if (list.length > 200) list = list.slice(0, 200);
      await kv.set('changelog:public', list);
      item.changelogPublished = true;
      item.changelogPublishedAt = changelogEntry.publishedAt;
      await kv.set(`fb:${id}`, item);
    }

    await logAudit({
      action: 'feedback.status',
      actor,
      target: { type: 'feedback', id, title: item.title || null },
      meta: {
        from: prevStatus,
        to: status,
        publishedToChangelog: !!changelogEntry,
        changelogId: changelogEntry ? changelogEntry.id : null
      }
    });

    return json(res, 200, { ok: true, item, changelogEntry });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}
