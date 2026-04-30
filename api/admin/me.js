import { getAdminSession } from '../../lib/auth.js';
import { json } from '../../lib/rate-limit.js';
export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  return json(res, 200, { ok: true });
}
