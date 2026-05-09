// GET /api/admin/routes-stats
// Aggregated per-route stats for the Routes admin tab.
//
// Returns one row per route (12 in total once the catalog is seeded):
//   { routeId, title, neighborhood,
//     totalStarts, totalCompletions, completionRate,
//     mostPhotographedStop, dropOffStop, avgPhotos, viewCount }
//
// Sources:
//   - `routes:catalog`            (array)  — canonical route list (backend agent)
//   - `loops:all`                 (set)    — ids of every loop record
//   - `loop:{id}`                 (object) — one loop record
//   - `route:{id}:views`          (number) — view counter (best-effort)
//
// Each loop record may include:
//   { routeId, completed|completedAt, photos|photoCount,
//     stops: [{ name, photoCount, lastReachedIndex }],
//     reachedStopIndex, abandonedAt }
//
// All keys are read defensively — missing data => 0 / null in the response.
import { getAdminSession } from '../../lib/auth.js';
import { getKv } from '../../lib/kv.js';
import { json } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  const s = await getAdminSession(req);
  if (!s) return json(res, 401, { error: 'unauthenticated' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  const kv = await getKv();

  let catalog = await kv.get('routes:catalog').catch(() => null);
  if (!Array.isArray(catalog)) catalog = [];

  const loopIds = await kv.smembers('loops:all').catch(() => []);
  const loopRecords = (await Promise.all(
    (loopIds || []).map(id => kv.get(`loop:${id}`).catch(() => null))
  )).filter(Boolean);

  const byRoute = new Map();
  function getAgg(rid, seedTitle, seedHood) {
    if (!byRoute.has(rid)) {
      byRoute.set(rid, {
        starts: 0, completions: 0,
        photoTotals: 0, loopsWithPhotos: 0,
        stopPhotoCounts: {},
        dropOffByStop: {},
        title: seedTitle || null,
        neighborhood: seedHood || null
      });
    }
    return byRoute.get(rid);
  }

  for (const loop of loopRecords) {
    const rid = loop.routeId || loop.route_id;
    if (!rid) continue;
    const agg = getAgg(rid, loop.routeTitle || loop.title, loop.neighborhood);
    agg.starts += 1;
    const completed = !!(loop.completed || loop.completedAt);
    if (completed) agg.completions += 1;

    const photos = Array.isArray(loop.photos) ? loop.photos.length :
                   typeof loop.photoCount === 'number' ? loop.photoCount : 0;
    if (photos > 0) {
      agg.photoTotals += photos;
      agg.loopsWithPhotos += 1;
    }

    if (Array.isArray(loop.stops)) {
      for (const stop of loop.stops) {
        const name = stop && (stop.name || stop.title);
        const count = (stop && stop.photoCount) ||
          (Array.isArray(stop && stop.photos) ? stop.photos.length : 0);
        if (name && count > 0) {
          agg.stopPhotoCounts[name] = (agg.stopPhotoCounts[name] || 0) + count;
        }
      }
    }

    // Drop-off stop: if the loop wasn't completed, we record the last stop the
    // user reached. Fields we'll accept (in priority): loop.lastStopName,
    // loop.reachedStopIndex against loop.stops, or stops[].lastReached === true.
    if (!completed) {
      let dropName = null;
      if (loop.lastStopName) dropName = loop.lastStopName;
      else if (Array.isArray(loop.stops)) {
        const idx = Number(loop.reachedStopIndex);
        if (Number.isFinite(idx) && idx >= 0 && loop.stops[idx]) {
          dropName = loop.stops[idx].name || loop.stops[idx].title || null;
        } else {
          for (const stop of loop.stops) {
            if (stop && stop.lastReached) { dropName = stop.name || stop.title; break; }
          }
        }
      }
      if (dropName) {
        agg.dropOffByStop[dropName] = (agg.dropOffByStop[dropName] || 0) + 1;
      }
    }
  }

  // View counts come from a separate counter that the public route handler
  // increments. Fall back to 0 silently.
  async function viewsFor(rid) {
    const v = await kv.get(`route:${rid}:views`).catch(() => 0);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function buildRow(routeId, catItem, viewCount) {
    const agg = byRoute.get(routeId) || {
      starts: 0, completions: 0, photoTotals: 0, loopsWithPhotos: 0,
      stopPhotoCounts: {}, dropOffByStop: {}
    };
    const total = agg.starts;
    // Completion rate — completions / max(views, starts). When views are
    // populated this is a more honest "of everyone who saw the route, how many
    // finished it"; when not, it falls back to completions/starts.
    const denom = Math.max(viewCount || 0, total);
    const completionRate = denom > 0 ? agg.completions / denom : 0;
    const avgPhotos = agg.loopsWithPhotos > 0 ? agg.photoTotals / agg.loopsWithPhotos : 0;

    let mostPhotographedStop = null; let bestPhotos = 0;
    for (const [name, n] of Object.entries(agg.stopPhotoCounts)) {
      if (n > bestPhotos) { mostPhotographedStop = name; bestPhotos = n; }
    }
    let dropOffStop = null; let bestDrop = 0;
    for (const [name, n] of Object.entries(agg.dropOffByStop)) {
      if (n > bestDrop) { dropOffStop = name; bestDrop = n; }
    }
    return {
      routeId,
      title: (catItem && catItem.title) || agg.title || routeId,
      neighborhood: (catItem && catItem.neighborhood) || agg.neighborhood || null,
      totalStarts: agg.starts,
      totalCompletions: agg.completions,
      completionRate: Number(completionRate.toFixed(3)),
      mostPhotographedStop,
      dropOffStop,
      avgPhotos: Number(avgPhotos.toFixed(1)),
      viewCount: viewCount || 0
    };
  }

  const seen = new Set();
  const rows = [];

  for (const item of catalog) {
    const rid = item.id || item.routeId;
    if (!rid) continue;
    seen.add(rid);
    const v = await viewsFor(rid);
    rows.push(buildRow(rid, item, v));
  }
  for (const rid of byRoute.keys()) {
    if (!seen.has(rid)) {
      const v = await viewsFor(rid);
      rows.push(buildRow(rid, null, v));
    }
  }

  rows.sort((a, b) => b.completionRate - a.completionRate);
  return json(res, 200, { routes: rows });
}
