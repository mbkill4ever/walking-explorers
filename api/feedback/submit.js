// POST /api/feedback/submit  body: { type: 'bug'|'feature'|'rating'|'neighborhood', title, body, meta }
import { getSession, newId } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';
import { escapeHtml, escapeIfString } from '../../lib/util.js';

const TYPES = ['bug', 'feature', 'rating', 'neighborhood'];

// Recursively escape string leaves of a `meta` blob (objects/arrays kept,
// numbers/booleans untouched). Capped at MAX_META_DEPTH to defang pathological
// payloads.
const MAX_META_DEPTH = 4;
function escapeMeta(value, depth = 0) {
  if (depth > MAX_META_DEPTH) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => escapeMeta(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 20)) {
      out[escapeHtml(k).slice(0, 64)] = escapeMeta(v, depth + 1);
    }
    return out;
  }
  return escapeIfString(value);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });

  const limit = await rateLimit(req, 'feedback:' + session.userId, { max: 10, windowSec: 60 });
  if (!limit.ok) return json(res, 429, { error: 'rate_limited' });

  const b = await readJson(req);
  if (!TYPES.includes(b.type)) return json(res, 400, { error: 'bad_type' });
  const rawTitle = String(b.title || '').trim().slice(0, 140);
  const rawBody = String(b.body || '').trim().slice(0, 4000);
  if (!rawTitle) return json(res, 400, { error: 'missing_title' });

  // Defense-in-depth: escape user-controlled strings before they ever hit KV.
  // The admin panel renders this list; if any code path uses innerHTML the
  // payload is already inert. Render-side escaping remains the contract.
  const title = escapeHtml(rawTitle);
  const body = escapeHtml(rawBody);

  const id = newId(10);
  let meta = null;
  if (b.meta && typeof b.meta === 'object') {
    try {
      // Re-parse through JSON to drop functions/symbols and cap size.
      const safe = JSON.parse(JSON.stringify(b.meta).slice(0, 4000));
      meta = escapeMeta(safe);
    } catch { meta = null; }
  }

  const item = {
    id, type: b.type, userId: session.userId,
    title, body,
    meta,
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
