// GET   /api/admin/tokens          -> list
// POST  /api/admin/tokens          { count, tier, note, cohort } -> generate N
// DELETE /api/admin/tokens?code=... -> revoke
import { getAdminSession } from '../../lib/auth.js';
import { createToken, listTokens, revokeToken } from '../../lib/tokens.js';
import { getKv } from '../../lib/kv.js';
import { readJson, json } from '../../lib/rate-limit.js';
import { logAudit, actorFromSession } from './_audit.js';

const ALLOWED_COHORTS = ['friends', 'investors', 'press', 'waitlist', 'custom'];

function sanitizeCohort(raw) {
  if (raw == null) return null;
  const c = String(raw).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return c || null;
}

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  const actor = actorFromSession(s);

  if (req.method === 'GET') {
    const tokens = await listTokens();
    // Enrich with cohort tag (stored on a sidecar key so we don't have to
    // touch lib/tokens.js, which is owned by the backend agent).
    const kv = await getKv();
    const codes = tokens.map(t => t.code);
    const cohorts = await Promise.all(
      codes.map(c => kv.get(`token:${c}:cohort`).catch(() => null))
    );
    tokens.forEach((t, i) => { t.cohort = cohorts[i] || null; });
    return json(res, 200, { tokens });
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const { count = 1, tier = 'beta', note = '' } = body || {};
    let cohort = sanitizeCohort(body && body.cohort);
    // 'custom' is a UI affordance — we expect a real label, not the literal
    // word 'custom'. Fall through to null so it stays untagged in that case.
    if (cohort === 'custom') cohort = null;
    const n = Math.max(1, Math.min(100, Number(count) || 1));
    const kv = await getKv();
    const created = [];
    for (let i = 0; i < n; i++) {
      const tok = await createToken({ tier, note, createdBy: 'admin' });
      if (cohort) {
        await kv.set(`token:${tok.code}:cohort`, cohort).catch(() => null);
        tok.cohort = cohort;
      } else {
        tok.cohort = null;
      }
      created.push(tok);
    }
    await logAudit({
      action: 'token.generate',
      actor,
      target: { type: 'tokens', count: created.length, tier, cohort: cohort || null },
      meta: { note: note ? String(note).slice(0, 120) : null }
    });
    return json(res, 200, { ok: true, tokens: created });
  }
  if (req.method === 'DELETE') {
    const url = new URL(req.url, 'http://x');
    const code = url.searchParams.get('code');
    if (!code) return json(res, 400, { error: 'missing_code' });
    const t = await revokeToken(code);
    if (!t) return json(res, 404, { error: 'not_found' });
    await logAudit({
      action: 'token.revoke',
      actor,
      target: { type: 'token', code }
    });
    return json(res, 200, { ok: true, token: t });
  }
  return json(res, 405, { error: 'method_not_allowed' });
}
