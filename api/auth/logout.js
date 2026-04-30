// POST /api/auth/logout
import { getSession, destroySession, clearSessionCookie } from '../../lib/auth.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (session) await destroySession(session.sid);
  clearSessionCookie(res);
  return json(res, 200, { ok: true });
}
