// POST /api/admin/login { password }
import { createAdminSession, setSessionCookie } from '../../lib/auth.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';
import crypto from 'crypto';

function safeEq(a, b) {
  const A = Buffer.from(a || '', 'utf8'); const B = Buffer.from(b || '', 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const limit = await rateLimit(req, 'admin_login', { max: 5, windowSec: 300 });
  if (!limit.ok) return json(res, 429, { error: 'too_many_attempts', retryAfter: limit.retryAfter });

  const { password } = await readJson(req);
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return json(res, 500, { error: 'admin_not_configured' });
  if (!safeEq(password, expected)) return json(res, 401, { error: 'bad_password' });

  const sid = await createAdminSession();
  setSessionCookie(res, sid, { admin: true });
  return json(res, 200, { ok: true });
}
