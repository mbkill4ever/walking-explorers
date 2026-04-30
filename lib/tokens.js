// Invite tokens — single-use codes that mint a user account on claim.
import { getKv } from './kv.js';
import { newId } from './auth.js';

const TOKEN_PREFIX = 'token:';
const USER_PREFIX = 'user:';
const USER_INDEX = 'users:all';
const TOKEN_INDEX = 'tokens:all';

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
  await kv.sadd(TOKEN_INDEX, code);
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

// Claim a token: marks it used and creates a user. Returns { user, token }.
export async function claimToken(code) {
  const kv = await getKv();
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
  await kv.set(USER_PREFIX + userId, user);
  await kv.sadd(USER_INDEX, userId);

  tk.status = 'claimed';
  tk.claimedAt = Date.now();
  tk.claimedBy = userId;
  await kv.set(TOKEN_PREFIX + code, tk);

  return { user, token: tk };
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
