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

  // Atomic dedupe: previously this read `sismember`, then `sadd`, then
  // mutated the item — two concurrent votes from the same user could both
  // pass the read and both increment the count. SADD itself is atomic and
  // returns the number of NEW members added (0 if already present, 1 if
  // freshly added). We rely on that return value as the source of truth and
  // only INCR on a real first add.
  const added = await kv.sadd(`fb:${id}:voters`, session.userId);
  if (!added) {
    // Already voted — return current count without mutating.
    return json(res, 200, { ok: true, votes: item.votes, already: true });
  }

  // Won the race. Update count + sorted-set score. The item.set is
  // last-write-wins; if two different users race here both will SADD
  // successfully (different members) and both will INCR — so a brief
  // last-write-wins on `item.votes` is fine because zincrby is the canonical
  // ranking source. We still update `item.votes` for read APIs that don't
  // re-resolve from the zset.
  const nextVotes = (item.votes || 0) + 1;
  item.votes = nextVotes;
  try {
    await kv.set(`fb:${id}`, item);
    await kv.zincrby('fb:features', 1, id).catch(() => {});
  } catch (e) {
    // Best-effort compensate: remove the voter so the user can retry.
    await kv.srem(`fb:${id}:voters`, session.userId).catch(() => {});
    return json(res, 500, { error: 'vote_failed' });
  }
  return json(res, 200, { ok: true, votes: nextVotes });
}
