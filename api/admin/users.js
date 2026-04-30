import { getAdminSession } from '../../lib/auth.js';
import { listUsers } from '../../lib/tokens.js';
import { json } from '../../lib/rate-limit.js';
export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const users = await listUsers();
  return json(res, 200, { users });
}
