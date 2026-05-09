// GET /api/admin/routes -> aggregated route stats from KV `loop:*` records
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  const kv = await getKv();

  // Read the canonical route catalog (if backend agent stores it at
  // `routes:catalog`), enrich with aggregates from the loop records indexed
  // at `loops:all`. Graceful when neither exists yet — just returns [].
  let catalog = await kv.get('routes:catalog').catch(() => null);
  if (!Array.isArray(catalog)) catalog = [];

  const loopIds = await kv.smembers('loops:all').catch(() => []);
  const loopRecords = (await Promise.all(
    (loopIds || []).map(id => kv.get(`loop:${id}`).catch(() => null))
  )).filter(Boolean);

  const byRoute = new Map();
  for (const loop of loopRecords) {
    const rid = loop.routeId || loop.route_id;
    if (!rid) continue;
    if (!byRoute.has(rid)) {
      byRoute.set(rid, {
        starts: 0, completions: 0, photoTotals: 0, loopsWithPhotos: 0,
        stopPhotoCounts: {}, title: loop.routeTitle || loop.title || null,
        neighborhood: loop.neighborhood || null
      });
    }
    const agg = byRoute.get(rid);
    agg.starts += 1;
    if (loop.completed || loop.completedAt) agg.completions += 1;
    const photos = Array.isArray(loop.photos) ? loop.photos.length :
                   typeof loop.photoCount === 'number' ? loop.photoCount : 0;
    if (photos > 0) {
      agg.photoTotals += photos;
      agg.loopsWithPhotos += 1;
    }
    if (Array.isArray(loop.stops)) {
      for (const stop of loop.stops) {
        const name = stop && (stop.name || stop.title);
        const count = (stop && stop.photoCount) || (Array.isArray(stop && stop.photos) ? stop.photos.length : 0);
        if (name && count > 0) {
          agg.stopPhotoCounts[name] = (agg.stopPhotoCounts[name] || 0) + count;
        }
      }
    }
  }

  const seen = new Set();
  const rows = [];

  function buildRow(routeId, catItem) {
    const agg = byRoute.get(routeId) || { starts: 0, completions: 0, photoTotals: 0, loopsWithPhotos: 0, stopPhotoCounts: {} };
    const total = agg.starts;
    const completionRate = total > 0 ? agg.completions / total : 0;
    const avgPhotos = agg.loopsWithPhotos > 0 ? agg.photoTotals / agg.loopsWithPhotos : 0;
    let mostPhotographedStop = null; let bestN = 0;
    for (const [name, n] of Object.entries(agg.stopPhotoCounts)) {
      if (n > bestN) { mostPhotographedStop = name; bestN = n; }
    }
    return {
      routeId,
      title: (catItem && catItem.title) || agg.title || routeId,
      neighborhood: (catItem && catItem.neighborhood) || agg.neighborhood || null,
      totalStarts: agg.starts,
      totalCompletions: agg.completions,
      completionRate: Number(completionRate.toFixed(3)),
      mostPhotographedStop,
      avgPhotos: Number(avgPhotos.toFixed(1))
    };
  }

  for (const item of catalog) {
    const rid = item.id || item.routeId;
    if (!rid) continue;
    seen.add(rid);
    rows.push(buildRow(rid, item));
  }
  for (const rid of byRoute.keys()) {
    if (!seen.has(rid)) rows.push(buildRow(rid, null));
  }

  rows.sort((a, b) => b.completionRate - a.completionRate);
  return json(res, 200, { routes: rows });
}
