// POST /api/auth/login { code }
// Validates an invite code, claims it, mints a session.
import { claimToken } from '../../lib/tokens.js';
import { createSession, setSessionCookie } from '../../lib/auth.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const limit = await rateLimit(req, 'login', { max: 5, windowSec: 60 });
  if (!limit.ok) {
    res.setHeader('Retry-After', limit.retryAfter);
    return json(res, 429, { error: 'too_many_attempts', retryAfter: limit.retryAfter });
  }

  const body = await readJson(req);
  const code = (body.code || '').trim();
  if (!code) return json(res, 400, { error: 'missing_code' });
  if (code.length < 8 || code.length > 64) return json(res, 400, { error: 'bad_code' });

  const result = await claimToken(code);
  if (result.error) {
    const map = {
      invalid_code: { status: 401, msg: "That code isn’t valid." },
      revoked: { status: 401, msg: "That code has been revoked." },
      already_claimed: { status: 401, msg: "That code has already been used." }
    };
    const m = map[result.error] || { status: 401, msg: 'Could not sign you in.' };
    return json(res, m.status, { error: result.error, message: m.msg });
  }

  const sid = await createSession({ userId: result.user.id, tier: result.user.tier });
  setSessionCookie(res, sid);
  return json(res, 200, { ok: true, user: { id: result.user.id, tier: result.user.tier } });
}
