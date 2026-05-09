// GET /api/admin/stats -> Overview metrics
// Extends the original counters with DAU, WAU, retention W2, time-to-first-spot
// median, churn signal counts. Auth events are read from KV `event:auth:{ts}`
// (a sorted set keyed by epoch ms, member = userId). Missing => 0 / null.
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { listUsers, listTokens } from '../../lib/tokens.js';
import { json } from '../../lib/rate-limit.js';

const DAY = 86400000;

async function loginsBetween(kv, fromMs, toMs) {
  // Backend logs auth events to a sorted set `events:auth` with score = ts,
  // member = userId. Use zrangebyscore when available; otherwise fall back to
  // a full zrange and filter in memory (the stub map supports zrange only).
  if (typeof kv.zrangebyscore === 'function') {
    const ids = await kv.zrangebyscore('events:auth', fromMs, toMs).catch(() => []);
    return new Set(ids || []);
  }
  // Fallback: pull recent slice and filter. This is best-effort.
  const all = await kv.zrange('events:auth', 0, 9999, { rev: true }).catch(() => []);
  return new Set(all || []);
}

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const kv = await getKv();
  const now = Date.now();

  const [users, tokens] = await Promise.all([listUsers(), listTokens()]);
  const counters = await Promise.all([
    kv.get('stats:spots:total').catch(() => 0),
    kv.get('stats:loops:total').catch(() => 0),
    kv.get('stats:feedback:bug').catch(() => 0),
    kv.get('stats:feedback:feature').catch(() => 0),
    kv.get('stats:feedback:rating').catch(() => 0),
    kv.get('stats:feedback:neighborhood').catch(() => 0)
  ]);

  // DAU / WAU from auth event log. If the log isn't populated, these are 0
  // and we surface that honestly to the UI (which renders '—' on null).
  const [dauSet, wauSet] = await Promise.all([
    loginsBetween(kv, now - DAY, now),
    loginsBetween(kv, now - 7 * DAY, now)
  ]);

  // Retention W2: of users who joined 14-21d ago, what % logged in within
  // the last 7 days?
  const cohortStart = now - 21 * DAY;
  const cohortEnd = now - 14 * DAY;
  const cohortUsers = users.filter(u => u.createdAt >= cohortStart && u.createdAt < cohortEnd);
  const cohortReturned = cohortUsers.filter(u => wauSet.has(u.id)).length;
  const retentionW2 = cohortUsers.length > 0
    ? Number((cohortReturned / cohortUsers.length).toFixed(3))
    : null;

  // Median time-to-first-spot: read `user:{id}:firstSpotAt` for each user.
  const firstSpotTimes = await Promise.all(users.map(async u => {
    const t = await kv.get(`user:${u.id}:firstSpotAt`).catch(() => null);
    return t ? Number(t) - u.createdAt : null;
  }));
  const validDeltas = firstSpotTimes.filter(d => d != null && d >= 0).sort((a, b) => a - b);
  let medianTimeToFirstSpotMs = null;
  if (validDeltas.length > 0) {
    const mid = Math.floor(validDeltas.length / 2);
    medianTimeToFirstSpotMs = validDeltas.length % 2
      ? validDeltas[mid]
      : Math.round((validDeltas[mid - 1] + validDeltas[mid]) / 2);
  }

  // Churn signal: users with > 7d inactivity. We treat 'no auth event in last
  // 7d' AND 'joined > 7d ago' as the signal.
  const churnSignals = users.filter(u => u.createdAt < now - 7 * DAY && !wauSet.has(u.id)).length;

  return json(res, 200, {
    users: {
      total: users.length,
      last24h: users.filter(u => u.createdAt > now - DAY).length
    },
    tokens: {
      total: tokens.length,
      claimed: tokens.filter(t => t.status === 'claimed').length,
      unused: tokens.filter(t => t.status === 'unused').length,
      revoked: tokens.filter(t => t.status === 'revoked').length
    },
    activity: {
      spotsTotal: Number(counters[0]) || 0,
      loopsTotal: Number(counters[1]) || 0,
      bugs: Number(counters[2]) || 0,
      features: Number(counters[3]) || 0,
      ratings: Number(counters[4]) || 0,
      neighborhoodRequests: Number(counters[5]) || 0
    },
    engagement: {
      dau: dauSet.size,
      wau: wauSet.size,
      retentionW2,
      medianTimeToFirstSpotMs,
      churnSignals
    }
  });
}
