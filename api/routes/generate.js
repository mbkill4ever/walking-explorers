// POST /api/routes/generate  body: { moods: [...], time: minutes, neighborhood }
// Server-side route generation. The premium ranking lives here; clients only see results.
import { getSession } from '../../lib/auth.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';
import { ROUTES } from '../../lib/data.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const session = await getSession(req);
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const limit = await rateLimit(req, 'gen:' + session.userId, { max: 30, windowSec: 60 });
  if (!limit.ok) return json(res, 429, { error: 'rate_limited' });

  const b = await readJson(req);
  const moods = Array.isArray(b.moods) ? b.moods : [];
  const time = Number(b.time) || 90;
  const nbhd = String(b.neighborhood || '').slice(0, 32);

  const scored = ROUTES.map(r => {
    let s = 0;
    if (nbhd && r.nbhd === nbhd) s += 100;
    s += r.moods.filter(m => moods.includes(m)).length * 25;
    const ratio = r.minutes / time;
    if (ratio > 1.6 || ratio < 0.5) s -= 30;
    s += Math.random() * 5; // small jitter so two identical inputs don't always order the same
    return { id: r.id, score: s };
  }).sort((a, b) => b.score - a.score).slice(0, 4);

  return json(res, 200, { suggested: scored.map(x => x.id) });
}
