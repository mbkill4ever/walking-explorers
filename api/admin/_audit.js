// api/admin/_audit.js
// Audit log helper — every admin write action should call logAudit().
// We persist entries to a sorted set `audit:log` (score = ts, member = id),
// with the full payload at `audit:entry:{id}`. The Audit tab reads via the
// /api/admin/audit endpoint, which pulls the most recent 200 entries.
//
// We never throw from logAudit — audit failures must not break user-facing
// admin operations. Worst case we silently drop the entry.

import { getKv } from '../../lib/kv.js';

const ZSET_KEY = 'audit:log';
const MAX_RETAIN = 1000; // hard cap; anything older trimmed best-effort

// Compact, URL-safe id. Avoids importing crypto in environments where it
// isn't always available; collisions don't matter for an audit log.
function newId() {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rnd}`;
}

/**
 * Log an admin action.
 * @param {object} entry
 * @param {string} entry.action  short verb, e.g. 'token.revoke'
 * @param {string} [entry.actor] usually the admin session id; fall back to 'admin'
 * @param {object} [entry.target] free-form { type, id, ...details }
 * @param {object} [entry.meta] free-form metadata
 */
export async function logAudit(entry) {
  try {
    const kv = await getKv();
    const ts = Date.now();
    const id = newId();
    const doc = {
      id,
      ts,
      action: String(entry && entry.action || 'unknown').slice(0, 64),
      actor: String(entry && entry.actor || 'admin').slice(0, 64),
      target: entry && entry.target ? entry.target : null,
      meta: entry && entry.meta ? entry.meta : null
    };
    await kv.set(`audit:entry:${id}`, doc);
    if (typeof kv.zadd === 'function') {
      await kv.zadd(ZSET_KEY, { score: ts, member: id }).catch(() => null);
    } else if (typeof kv.sadd === 'function') {
      // Fallback for very old kv stubs.
      await kv.sadd(ZSET_KEY, id).catch(() => null);
    }
    // Best-effort trim to MAX_RETAIN. Skip silently if the kv doesn't support
    // zremrangebyrank.
    if (typeof kv.zremrangebyrank === 'function') {
      await kv.zremrangebyrank(ZSET_KEY, 0, -(MAX_RETAIN + 1)).catch(() => null);
    }
    return doc;
  } catch {
    return null;
  }
}

/**
 * Resolve a stable actor label from a session object.
 * Sessions don't carry user identities for the admin (single shared password),
 * so we fall back to the session id prefix as the actor handle.
 */
export function actorFromSession(session) {
  if (!session) return 'admin';
  if (session.adminLabel) return String(session.adminLabel);
  if (session.sid) return 'admin:' + String(session.sid).slice(0, 8);
  return 'admin';
}
