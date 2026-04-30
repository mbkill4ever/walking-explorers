// Thin wrapper around Vercel KV that gracefully no-ops if KV is not yet configured.
// This lets the deployment build & boot even before you've enabled KV in the dashboard.
//
// Once you enable Vercel KV (Storage → Create → KV), the env vars KV_REST_API_URL and
// KV_REST_API_TOKEN are auto-injected into all deployments.
let _kv = null;
let _stub = null;

async function getKv() {
  if (_kv) return _kv;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = await import('@vercel/kv');
    _kv = mod.kv;
    return _kv;
  }
  // In-memory fallback for local dev / pre-KV deployments. NOT shared across
  // function invocations on Vercel — strictly a degraded mode.
  if (!_stub) {
    const map = new Map();
    _stub = {
      get: async (k) => { const v = map.get(k); return v == null ? null : v; },
      set: async (k, v, opts) => { map.set(k, v); return 'OK'; },
      del: async (k) => { return map.delete(k) ? 1 : 0; },
      incr: async (k) => { const n = (map.get(k) || 0) + 1; map.set(k, n); return n; },
      expire: async () => 1,
      hset: async (k, obj) => { const cur = map.get(k) || {}; Object.assign(cur, obj); map.set(k, cur); return 1; },
      hget: async (k, f) => { const cur = map.get(k); return cur ? cur[f] : null; },
      hgetall: async (k) => map.get(k) || null,
      hdel: async (k, f) => { const cur = map.get(k); if (cur) { delete cur[f]; return 1; } return 0; },
      sadd: async (k, ...vals) => { const cur = map.get(k) || new Set(); vals.forEach(v => cur.add(v)); map.set(k, cur); return vals.length; },
      srem: async (k, ...vals) => { const cur = map.get(k); if (!cur) return 0; let n = 0; vals.forEach(v => { if (cur.delete(v)) n++; }); return n; },
      smembers: async (k) => Array.from(map.get(k) || []),
      sismember: async (k, v) => { const cur = map.get(k); return cur && cur.has(v) ? 1 : 0; },
      zadd: async (k, ...args) => { const cur = map.get(k) || []; for (let i = 0; i < args.length; i += 2) cur.push({ score: args[i], member: args[i+1] }); cur.sort((a,b) => b.score - a.score); map.set(k, cur); return 1; },
      zrange: async (k, s, e) => { const cur = map.get(k) || []; return cur.slice(s, e === -1 ? undefined : e + 1).map(x => x.member); },
      zincrby: async (k, by, member) => { const cur = map.get(k) || []; let entry = cur.find(x => x.member === member); if (!entry) { entry = { score: 0, member }; cur.push(entry); } entry.score += by; cur.sort((a,b) => b.score - a.score); map.set(k, cur); return entry.score; },
      zscore: async (k, member) => { const cur = map.get(k) || []; const e = cur.find(x => x.member === member); return e ? e.score : null; }
    };
  }
  return _stub;
}

export function kvAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export default { getKv, kvAvailable };
export { getKv };
