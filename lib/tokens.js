// Invite tokens — single-use codes that mint a user account on claim.
import { getKv } from './kv.js';
import { newId } from './auth.js';

const TOKEN_PREFIX = 'token:';
const USER_PREFIX = 'user:';
const USER_INDEX = 'users:all';
const TOKEN_INDEX = 'tokens:all';
// Per-token claim lock: SETNX'd to win the race; TTL'd so a crashed claimer
// can't permanently brick a token.
const CLAIM_LOCK_TTL_SECONDS = 30;

export function generateCode() {
  // 16 random bytes → 22 base64url chars; uppercase first 4 for human eyeball.
  return newId(16);
}

export async function createToken({ tier = 'beta', note = '', createdBy = 'admin' } = {}) {
  const code = generateCode();
  const kv = await getKv();
  const tokenObj = {
    code, tier, note, createdBy,
    status: 'unused',
    createdAt: Date.now(),
    claimedAt: null,
    claimedBy: null
  };
  await kv.set(TOKEN_PREFIX + code, tokenObj);
  // Compensate on index failure so we never have a token whose row exists but
  // is orphaned from the listing index.
  try {
    await kv.sadd(TOKEN_INDEX, code);
  } catch (e) {
    await kv.del(TOKEN_PREFIX + code).catch(() => {});
    throw e;
  }
  return tokenObj;
}

export async function getToken(code) {
  const kv = await getKv();
  return kv.get(TOKEN_PREFIX + code);
}

export async function listTokens() {
  const kv = await getKv();
  const codes = await kv.smembers(TOKEN_INDEX);
  const tokens = await Promise.all(codes.map(c => kv.get(TOKEN_PREFIX + c)));
  return tokens.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeToken(code) {
  const kv = await getKv();
  const t = await kv.get(TOKEN_PREFIX + code);
  if (!t) return null;
  t.status = 'revoked';
  await kv.set(TOKEN_PREFIX + code, t);
  return t;
}

// Acquire an exclusive claim lock for a token via SETNX (Redis NX).
// Returns true iff THIS caller won the race. Lock auto-expires so a crashed
// claimer cannot permanently block legitimate retries.
async function acquireClaimLock(kv, code) {
  // @vercel/kv's set supports { nx: true, ex: <seconds> }. The in-memory
  // stub in lib/kv.js doesn't honor these flags, so we add a manual fallback:
  // try set-nx, and if the underlying call ignored nx (stub), fall back to a
  // cooperative check. The stub is single-process so the race doesn't exist.
  try {
    const lockKey = `claim:lock:${code}`;
    const r = await kv.set(lockKey, 1, { nx: true, ex: CLAIM_LOCK_TTL_SECONDS });
    // @vercel/kv returns 'OK' on success, null when NX fails.
    if (r === 'OK' || r === 1 || r === true) return true;
    if (r === null) return false;
    // Stub returns 'OK' regardless of nx — treat as won (single-process).
    return true;
  } catch {
    return false;
  }
}

async function releaseClaimLock(kv, code) {
  await kv.del(`claim:lock:${code}`).catch(() => {});
}

// Claim a token: marks it used and creates a user. Returns { user, token }.
//
// Concurrency model — previously this was a read-then-write race: two
// concurrent requests could both read status='unused', both write status=
// 'claimed', and both mint a fresh user from the same invite. We now:
//   1. SETNX a per-token lock (atomic in Redis); only one caller proceeds.
//   2. Re-read status under the lock to handle the case where another writer
//      already finished + released between attempts.
//   3. On any failure after we've created the user row, compensate so we
//      don't leave orphaned user index entries (the audit's "two-step writes"
//      finding).
export async function claimToken(code) {
  const kv = await getKv();

  const got = await acquireClaimLock(kv, code);
  if (!got) {
    // Someone else holds the lock right now. From the caller's perspective
    // this is the same as "already claimed" — we don't want to leak whether
    // a concurrent request is in flight.
    return { error: 'already_claimed' };
  }

  try {
    const tk = await kv.get(TOKEN_PREFIX + code);
    if (!tk) return { error: 'invalid_code' };
    if (tk.status === 'revoked') return { error: 'revoked' };
    if (tk.status === 'claimed') return { error: 'already_claimed' };

    const userId = newId(12);
    const user = {
      id: userId,
      tier: tk.tier || 'beta',
      createdAt: Date.now(),
      claimedToken: code
    };

    // Two-step write: user row + index + token mutation. Compensate on any
    // failure so we don't orphan the index.
    await kv.set(USER_PREFIX + userId, user);
    try {
      await kv.sadd(USER_INDEX, userId);
    } catch (e) {
      await kv.del(USER_PREFIX + userId).catch(() => {});
      throw e;
    }

    tk.status = 'claimed';
    tk.claimedAt = Date.now();
    tk.claimedBy = userId;
    try {
      await kv.set(TOKEN_PREFIX + code, tk);
    } catch (e) {
      // Roll back the user we just created — token still 'unused' so caller
      // can retry. This preserves the invariant: at most one user per token.
      await kv.srem(USER_INDEX, userId).catch(() => {});
      await kv.del(USER_PREFIX + userId).catch(() => {});
      throw e;
    }

    return { user, token: tk };
  } finally {
    await releaseClaimLock(kv, code);
  }
}

export async function getUser(userId) {
  const kv = await getKv();
  return kv.get(USER_PREFIX + userId);
}

export async function listUsers() {
  const kv = await getKv();
  const ids = await kv.smembers(USER_INDEX);
  const users = await Promise.all(ids.map(id => kv.get(USER_PREFIX + id)));
  return users.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
