import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { listUsers, listTokens } from '../../lib/tokens.js';
import { json } from '../../lib/rate-limit.js';
export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const kv = await getKv();
  const [users, tokens] = await Promise.all([listUsers(), listTokens()]);
  const counters = await Promise.all([
    kv.get('stats:spots:total'), kv.get('stats:loops:total'),
    kv.get('stats:feedback:bug'), kv.get('stats:feedback:feature'),
    kv.get('stats:feedback:rating'), kv.get('stats:feedback:neighborhood')
  ]);
  return json(res, 200, {
    users: { total: users.length, last24h: users.filter(u => u.createdAt > Date.now() - 86400000).length },
    tokens: {
      total: tokens.length,
      claimed: tokens.filter(t => t.status === 'claimed').length,
      unused: tokens.filter(t => t.status === 'unused').length,
      revoked: tokens.filter(t => t.status === 'revoked').length
    },
    activity: {
      spotsTotal: counters[0] || 0,
      loopsTotal: counters[1] || 0,
      bugs: counters[2] || 0,
      features: counters[3] || 0,
      ratings: counters[4] || 0,
      neighborhoodRequests: counters[5] || 0
    }
  });
}
