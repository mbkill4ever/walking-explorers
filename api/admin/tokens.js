// GET   /api/admin/tokens          -> list
// POST  /api/admin/tokens          { count, tier, note } -> generate N
// DELETE /api/admin/tokens?code=... -> revoke
import { getAdminSession } from '../../lib/auth.js';
import { createToken, listTokens, revokeToken } from '../../lib/tokens.js';
import { readJson, json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });

  if (req.method === 'GET') {
    const tokens = await listTokens();
    return json(res, 200, { tokens });
  }
  if (req.method === 'POST') {
    const { count = 1, tier = 'beta', note = '' } = await readJson(req);
    const n = Math.max(1, Math.min(100, Number(count) || 1));
    const created = [];
    for (let i = 0; i < n; i++) created.push(await createToken({ tier, note, createdBy: 'admin' }));
    return json(res, 200, { ok: true, tokens: created });
  }
  if (req.method === 'DELETE') {
    const url = new URL(req.url, 'http://x');
    const code = url.searchParams.get('code');
    if (!code) return json(res, 400, { error: 'missing_code' });
    const t = await revokeToken(code);
    if (!t) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { ok: true, token: t });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}
