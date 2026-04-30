import { getAdminSession, destroyAdminSession, clearSessionCookie } from '../../lib/auth.js';
import { json } from '../../lib/rate-limit.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const s = await getAdminSession(req);
  if (s) await destroyAdminSession(s.sid);
  clearSessionCookie(res, { admin: true });
  return json(res, 200, { ok: true });
}
