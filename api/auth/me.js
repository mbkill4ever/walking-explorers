// GET /api/auth/me
import { getSession } from '../../lib/auth.js';
import { getUser } from '../../lib/tokens.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const user = await getUser(session.userId);
  if (!user) return json(res, 401, { error: 'user_gone' });
  return json(res, 200, { user: { id: user.id, tier: user.tier, createdAt: user.createdAt } });
}
