// POST /api/routes/ai-generate
// Walking Explorers v0.7 — AI route generator (deterministic v1).
// Body: { minutes, moods: string[], origin: {lat,lon} | {neighborhood}, freeText? }
//
// Scoring lives 100% server-side so the algorithm isn't shipped to the
// client and we can drop in an LLM call in v0.8 without changing the wire
// shape. See agent_reports/v07_03_ai_route.md for the algorithm rationale.

import { getSession } from '../../lib/auth.js';
import { rateLimit, readJson, json } from '../../lib/rate-limit.js';

/* ----------------------------------------------------------------------------
 * Stop catalog. 72 stops across 12 neighborhood routes — duplicated here so
 * /api/routes/ai-generate can score without coupling to the (smaller) ROUTES
 * meta in lib/data.js. Each stop carries lat/lon, the parent nbhd, free-form
 * `why`/`desc` text, and an optional `sponsored` flag.
 *
 * Mood tags are computed at module load time (see STOPS_WITH_MOODS) by
 * keyword matching against name+why+desc. Keeping the tagging deterministic
 * means the same input always produces the same output, which is important
 * for v0.7 (no LLM yet) and makes the endpoint trivially cacheable later.
 * ------------------------------------------------------------------------- */

const NBHD_CENTERS = {
  soho:        { lat: 40.7235, lon: -73.9980 },
  ev:          { lat: 40.7282, lon: -73.9842 },
  westvillage: { lat: 40.7350, lon: -74.0030 },
  chelsea:     { lat: 40.7470, lon: -74.0020 },
  williamsburg:{ lat: 40.7130, lon: -73.9610 },
  dumbo:       { lat: 40.7030, lon: -73.9890 },
  centralpark: { lat: 40.7820, lon: -73.9650 },
  les:         { lat: 40.7180, lon: -73.9880 },
};

const STOPS = [
  // soho_aesthetic
  { route:'soho_aesthetic', nbhd:'soho', name:'Joe Coffee — Crosby Street', lat:40.7224, lon:-73.9966, why:'Quietest of NYC’s prettiest cafe spots.', desc:'Small, warm cafe with reclaimed-wood interiors. Order a pour-over.' },
  { route:'soho_aesthetic', nbhd:'soho', name:'McNally Jackson Books', lat:40.7232, lon:-73.9979, why:'Two-floor independent bookshop that fits the SoHo aesthetic.', desc:'One of the best magazine racks in Manhattan. Staff picks worth reading.' },
  { route:'soho_aesthetic', nbhd:'soho', name:'Lure Fishbar', lat:40.7240, lon:-73.9975, why:'Stylish underground fish house — a featured charter stop.', desc:'SoHo’s best basement room. Stop in for an oyster between meals.', sponsored:true },
  { route:'soho_aesthetic', nbhd:'soho', name:'INA SoHo', lat:40.7244, lon:-73.9989, why:'Consignment sweet spot for high-end designer resale.', desc:'Carries Prada and Chanel resale. The racks are an education.' },
  { route:'soho_aesthetic', nbhd:'soho', name:'Donut Plant', lat:40.7200, lon:-73.9943, why:'NYC institution since 1994 — mid-walk sweet break.', desc:'Order one tres-leches donut and walk it down Spring Street.' },
  { route:'soho_aesthetic', nbhd:'soho', name:'Mercer Street vista', lat:40.7253, lon:-73.9985, why:'The most-photographed cobblestone block in SoHo.', desc:'Cast-iron facades catch golden-hour light. Sunset photo spot.' },

  // ev_vintage
  { route:'ev_vintage', nbhd:'ev', name:'Abracadabra Coffee', lat:40.7288, lon:-73.9844, why:'Hidden cafe tucked into a townhouse.', desc:'Locals know it; almost no tourists. Espresso done right.' },
  { route:'ev_vintage', nbhd:'ev', name:'Tompkins Square Books', lat:40.7268, lon:-73.9810, why:'Used books with attitude.', desc:'Crate-digger energy. The poetry section alone is worth the stop.' },
  { route:'ev_vintage', nbhd:'ev', name:'Generation Records', lat:40.7298, lon:-73.9870, why:'Vinyl shop with deep punk and indie sections.', desc:'A vinyl pilgrimage stop. Staff recs are reliably weird.' },
  { route:'ev_vintage', nbhd:'ev', name:'L Train Vintage', lat:40.7290, lon:-73.9850, why:'Curated thrift with photo-ready dressing rooms.', desc:'Hand-picked vintage by the pound, but the good stuff is on the rack.' },
  { route:'ev_vintage', nbhd:'ev', name:'Veselka', lat:40.7300, lon:-73.9870, why:'24-hour Ukrainian diner — neighborhood institution.', desc:'Pierogis at any hour. Cash-only mid-walk dinner.' },
  { route:'ev_vintage', nbhd:'ev', name:'St. Marks Place murals', lat:40.7283, lon:-73.9858, why:'Open-air street-art wall.', desc:'Changes weekly. Photographers and graffiti writers both linger.' },

  // wv_books
  { route:'wv_books', nbhd:'westvillage', name:'Three Lives & Company', lat:40.7350, lon:-74.0020, why:'Tiny bookstore that everyone in the neighborhood loves.', desc:'Independent bookshop with a windowed corner-store feel.' },
  { route:'wv_books', nbhd:'westvillage', name:'Caffe Reggio', lat:40.7295, lon:-74.0007, why:'1927 cafe that claims the first cappuccino in America.', desc:'Tin ceiling, Renaissance paintings, espresso machine older than your grandparents.' },
  { route:'wv_books', nbhd:'westvillage', name:'Bleecker Street Records', lat:40.7320, lon:-74.0040, why:'Vinyl institution since 1991.', desc:'Deep jazz and blues. Two-hour browse if you let it happen.' },
  { route:'wv_books', nbhd:'westvillage', name:'Magnolia Bakery', lat:40.7355, lon:-74.0050, why:'Banana pudding pilgrimage.', desc:'Yes, the line is real. Yes, the pudding is the right answer.' },
  { route:'wv_books', nbhd:'westvillage', name:'Cornelia Street block', lat:40.7335, lon:-74.0035, why:'One of the prettiest blocks in lower Manhattan.', desc:'Brownstone-lined, cobblestoned in spots, lit by old streetlights.' },
  { route:'wv_books', nbhd:'westvillage', name:'Westside Pier sunset', lat:40.7355, lon:-74.0095, why:'Hudson River sunset from the West Village waterfront.', desc:'Walk to the pier just before sunset. Best on clear evenings.' },

  // highline_galleries
  { route:'highline_galleries', nbhd:'chelsea', name:'The High Line — 23rd St entry', lat:40.7480, lon:-74.0048, why:'The elevated park itself — entry point for a Chelsea walk.', desc:'Native gardens, public art installations, river-side benches.' },
  { route:'highline_galleries', nbhd:'chelsea', name:'David Zwirner Gallery', lat:40.7440, lon:-74.0070, why:'Blue-chip Chelsea gallery on 19th Street.', desc:'Major rotating shows. Always worth a 20-minute walkthrough.' },
  { route:'highline_galleries', nbhd:'chelsea', name:'Gagosian — 24th', lat:40.7490, lon:-74.0060, why:'Flagship Gagosian on West 24th.', desc:'The biggest names in contemporary art rotate through here.' },
  { route:'highline_galleries', nbhd:'chelsea', name:'Chelsea Market', lat:40.7424, lon:-74.0061, why:'Indoor food market in the old Nabisco factory.', desc:'Lobster rolls, tacos, pasta — all under industrial brick arches.' },
  { route:'highline_galleries', nbhd:'chelsea', name:'Little Island', lat:40.7430, lon:-74.0110, why:'Floating park on the Hudson, opened 2021.', desc:'Tulip-shaped concrete pods hold native plantings. Sunset deck.' },
  { route:'highline_galleries', nbhd:'chelsea', name:'Whitney Museum exterior', lat:40.7395, lon:-74.0090, why:'Renzo Piano architecture worth circling even without entry.', desc:'Outdoor terraces are free. Photogenic from every angle.' },

  // williamsburg
  { route:'williamsburg', nbhd:'williamsburg', name:'Devocion Coffee', lat:40.7140, lon:-73.9600, why:'Light-filled Colombian coffee roastery.', desc:'Plant wall, skylit ceiling. The flat white is the move.' },
  { route:'williamsburg', nbhd:'williamsburg', name:'Bushwick Collective murals', lat:40.7050, lon:-73.9230, why:'Outdoor mural belt across multiple Bushwick blocks.', desc:'Some of the best contemporary street art in the city.' },
  { route:'williamsburg', nbhd:'williamsburg', name:'Rough Trade NYC', lat:40.7170, lon:-73.9620, why:'Independent record shop with in-store performances.', desc:'Vinyl + zines + occasional surprise gig in the back room.' },
  { route:'williamsburg', nbhd:'williamsburg', name:'Smorgasburg', lat:40.7220, lon:-73.9580, why:'Open-air food market, Saturdays only.', desc:'70+ vendors. Come hungry. Brunch shoulder-to-shoulder.' },
  { route:'williamsburg', nbhd:'williamsburg', name:'Wythe Hotel rooftop', lat:40.7220, lon:-73.9580, why:'Skyline view of Manhattan from Brooklyn.', desc:'Sunset cocktails with the Manhattan skyline as wallpaper.' },
  { route:'williamsburg', nbhd:'williamsburg', name:'Domino Park', lat:40.7140, lon:-73.9670, why:'Waterfront park along the East River.', desc:'Built on the old Domino Sugar refinery footprint. Tacos on-site.' },

  // dumbo_bridge
  { route:'dumbo_bridge', nbhd:'dumbo', name:'Brooklyn Bridge Park — Pier 1', lat:40.7000, lon:-73.9970, why:'The classic Manhattan-skyline lawn.', desc:'Best at golden hour. Picnic-friendly. Long benches face the bridge.' },
  { route:'dumbo_bridge', nbhd:'dumbo', name:'Washington & Water vista', lat:40.7035, lon:-73.9890, why:'The Manhattan Bridge framing shot.', desc:'Cobblestone corner where every NYC postcard photo is taken.' },
  { route:'dumbo_bridge', nbhd:'dumbo', name:'Powerhouse Arena', lat:40.7035, lon:-73.9890, why:'DUMBO’s independent bookshop + gallery.', desc:'Photo books, art monographs, rotating exhibitions.' },
  { route:'dumbo_bridge', nbhd:'dumbo', name:'Time Out Market', lat:40.7028, lon:-73.9890, why:'Curated food hall above the waterfront.', desc:'Rooftop seating with bridge views. 21 vendors.' },
  { route:'dumbo_bridge', nbhd:'dumbo', name:'Empire Stores', lat:40.7028, lon:-73.9870, why:'Restored 19th-century coffee warehouses.', desc:'Brick arches, river views, indoor-outdoor galleries.' },
  { route:'dumbo_bridge', nbhd:'dumbo', name:'Jane’s Carousel', lat:40.7028, lon:-73.9925, why:'Restored 1922 carousel in a Jean Nouvel glass box.', desc:'Sunset behind the bridge, carousel turning. Photo-perfect.' },

  // central_park
  { route:'central_park', nbhd:'centralpark', name:'Bethesda Terrace', lat:40.7740, lon:-73.9710, why:'The architectural heart of Central Park.', desc:'Tiled arcade, fountain, lake views. Buskers play in the arcade.' },
  { route:'central_park', nbhd:'centralpark', name:'The Loeb Boathouse', lat:40.7752, lon:-73.9690, why:'Lakeside dining, rowboat rentals.', desc:'Rent a boat for $20. Sit lakeside for coffee otherwise.' },
  { route:'central_park', nbhd:'centralpark', name:'Strawberry Fields', lat:40.7755, lon:-73.9750, why:'John Lennon memorial mosaic.', desc:'Quiet garden corner. Imagine mosaic at center.' },
  { route:'central_park', nbhd:'centralpark', name:'Conservatory Garden', lat:40.7950, lon:-73.9520, why:'Hidden formal garden, north end of the park.', desc:'Three garden styles: Italian, French, English. Almost always quiet.' },
  { route:'central_park', nbhd:'centralpark', name:'Belvedere Castle', lat:40.7795, lon:-73.9690, why:'Stone overlook tower, mid-park.', desc:'Free entry. Best panoramic view inside the park.' },
  { route:'central_park', nbhd:'centralpark', name:'The Mall', lat:40.7715, lon:-73.9720, why:'Elm-lined promenade.', desc:'The only straight path in the park, by design. Iconic.' },

  // les_food
  { route:'les_food', nbhd:'les', name:'Russ & Daughters Cafe', lat:40.7220, lon:-73.9885, why:'Appetizing institution since 1914.', desc:'Bagel + lox + cream cheese, done by people who invented the genre.', sponsored:true },
  { route:'les_food', nbhd:'les', name:'Katz’s Delicatessen', lat:40.7222, lon:-73.9874, why:'The pastrami sandwich.', desc:'120 years old. Order at the counter, tip the cutter, hand-cut pastrami.' },
  { route:'les_food', nbhd:'les', name:'Tenement Museum', lat:40.7186, lon:-73.9899, why:'Walking history of immigrant NYC.', desc:'Restored 1860s tenement. Tickets required for interior tours.' },
  { route:'les_food', nbhd:'les', name:'Economy Candy', lat:40.7190, lon:-73.9892, why:'Floor-to-ceiling candy store, since 1937.', desc:'Every penny candy you remember, plus 800 you don’t.' },
  { route:'les_food', nbhd:'les', name:'Pianos', lat:40.7197, lon:-73.9879, why:'LES music venue with three rooms.', desc:'Indie and emerging acts. The bar room is free; back room has cover.' },
  { route:'les_food', nbhd:'les', name:'Essex Market', lat:40.7180, lon:-73.9886, why:'Indoor market with 37 food vendors.', desc:'Tacos, oysters, pastries. The new location is huge and bright.' },

  // soho_galleries
  { route:'soho_galleries', nbhd:'soho', name:'The Drawing Center', lat:40.7260, lon:-74.0020, why:'NYC’s only nonprofit gallery for drawings.', desc:'Quiet, focused exhibitions. The kind of art space SoHo used to be.' },
  { route:'soho_galleries', nbhd:'soho', name:'Donald Judd Foundation', lat:40.7250, lon:-73.9990, why:'Judd’s preserved SoHo loft, by reservation.', desc:'Five stories of his living and working space. Architecture pilgrimage.' },
  { route:'soho_galleries', nbhd:'soho', name:'Greene Street cast-iron row', lat:40.7240, lon:-73.9990, why:'The longest continuous run of cast-iron architecture.', desc:'Walk the block between Canal and Broome slowly.' },
  { route:'soho_galleries', nbhd:'soho', name:'The Apartment by The Line', lat:40.7235, lon:-74.0000, why:'Concept store in a converted loft.', desc:'Furniture, fashion, fragrance — staged like a friend’s apartment.' },
  { route:'soho_galleries', nbhd:'soho', name:'Aire Ancient Baths', lat:40.7228, lon:-74.0078, why:'Below-ground thermal baths.', desc:'18th-century textile warehouse turned hammam. Reservation only.' },
  { route:'soho_galleries', nbhd:'soho', name:'Vesuvio Bakery', lat:40.7252, lon:-74.0024, why:'The famous green storefront on Prince Street.', desc:'Most-photographed bakery facade in NYC. Bread is real too.' },

  // uws_classic
  { route:'uws_classic', nbhd:'centralpark', name:'Zabar’s', lat:40.7860, lon:-73.9790, why:'Iconic UWS appetizing market.', desc:'Bagels, cheese, smoked fish. Crowded on weekend mornings — go anyway.' },
  { route:'uws_classic', nbhd:'centralpark', name:'Lincoln Center Plaza', lat:40.7720, lon:-73.9840, why:'Fountain plaza, free outdoor performances most evenings.', desc:'Hang out by the fountain. Architecture worth the walk alone.' },
  { route:'uws_classic', nbhd:'centralpark', name:'AMNH exterior', lat:40.7813, lon:-73.9737, why:'The pink-granite Gilder Center is new and worth circling.', desc:'Even without entry, walk the new Columbus Ave addition.' },
  { route:'uws_classic', nbhd:'centralpark', name:'Symphony Space', lat:40.7950, lon:-73.9710, why:'Performance hall with rotating events.', desc:'Often free or low-cost evening readings, concerts, talks.' },
  { route:'uws_classic', nbhd:'centralpark', name:'The Dakota', lat:40.7762, lon:-73.9762, why:'The Dakota apartment building — Lennon lived here.', desc:'Iconic facade. Photo from across 72nd Street.' },
  { route:'uws_classic', nbhd:'centralpark', name:'Cafe Lalo', lat:40.7900, lon:-73.9740, why:'Old-school dessert cafe from "You’ve Got Mail."', desc:'Coffee + cake under hanging lamps. Stays open late.' },

  // harlem_history
  { route:'harlem_history', nbhd:'centralpark', name:'Apollo Theater', lat:40.8100, lon:-73.9500, why:'The Apollo. Music history, 125th Street.', desc:'Tours available. Marquee photo even when closed.' },
  { route:'harlem_history', nbhd:'centralpark', name:'Sylvia’s Restaurant', lat:40.8085, lon:-73.9430, why:'Queen of Soul Food, since 1962.', desc:'Fried chicken, collards, cornbread. Brunch is a scene.' },
  { route:'harlem_history', nbhd:'centralpark', name:'Studio Museum in Harlem', lat:40.8085, lon:-73.9470, why:'Contemporary art by artists of African descent.', desc:'New building reopening in stages. Garden and shop already open.' },
  { route:'harlem_history', nbhd:'centralpark', name:'Strivers’ Row', lat:40.8160, lon:-73.9420, why:'Landmark blocks of 1890s rowhouses.', desc:'138th and 139th Streets. Quietly grand, beautifully preserved.' },
  { route:'harlem_history', nbhd:'centralpark', name:'Marcus Garvey Park', lat:40.8030, lon:-73.9420, why:'Hill-top park with a fire watchtower.', desc:'The watchtower is the oldest in NYC. Climb at the top of the hill.' },
  { route:'harlem_history', nbhd:'centralpark', name:'Red Rooster Harlem', lat:40.8090, lon:-73.9430, why:'Marcus Samuelsson’s Harlem flagship.', desc:'Comfort food with Ethiopian and Scandinavian twists. Bar scene.' },

  // fidi_finance
  { route:'fidi_finance', nbhd:'dumbo', name:'Oculus / WTC Transit Hub', lat:40.7115, lon:-74.0124, why:'Calatrava’s white-rib transit cathedral.', desc:'Photogenic from every angle, especially at noon when light hits the spine.' },
  { route:'fidi_finance', nbhd:'dumbo', name:'9/11 Memorial Pools', lat:40.7115, lon:-74.0134, why:'Reflecting pools where the Twin Towers stood.', desc:'Walk the perimeter quietly. Names etched in bronze.' },
  { route:'fidi_finance', nbhd:'dumbo', name:'Stone Street', lat:40.7045, lon:-74.0110, why:'NYC’s oldest paved street, restored to cobblestone.', desc:'Tightly framed historic block. Pub-table outdoor dining.' },
  { route:'fidi_finance', nbhd:'dumbo', name:'Federal Hall', lat:40.7075, lon:-74.0102, why:'Where Washington was inaugurated.', desc:'Greek-revival exterior. Free interior. Wall Street view.' },
  { route:'fidi_finance', nbhd:'dumbo', name:'Battery Park esplanade', lat:40.7035, lon:-74.0170, why:'Harbor walk with Statue of Liberty views.', desc:'Best at sunset. Ferry traffic, distant statue, low waterfront sun.' },
  { route:'fidi_finance', nbhd:'dumbo', name:'Trinity Church graveyard', lat:40.7080, lon:-74.0120, why:'18th-century church with Hamilton’s grave.', desc:'Surrounded by skyscrapers. The contrast is the point.' },
];

/* ----------------------------------------------------------------------------
 * Mood keyword map. Each mood is keyed by the lower-case ID we expect from
 * the frontend. The arrays are case-insensitive substring matches against
 * the concatenation of (name + why + desc) for each stop.
 *
 * Aliases are added for the legacy onboarding mood ids (aesthetic_photo,
 * sunsets, vintage, history, music, aesthetic) so a freshly onboarded user's
 * we_mood localStorage payload works unchanged.
 * ------------------------------------------------------------------------- */
const MOOD_KEYWORDS = {
  coffee:       ['coffee', 'cafe', 'café', 'espresso', 'cappuccino', 'roast', 'pour-over'],
  hidden_gems:  ['hidden', 'quiet', 'tucked', 'tiny', 'locals know', 'almost no tourists', 'by reservation'],
  photo_spots:  ['photograph', 'photo', 'cobble', 'vista', 'facade', 'iconic', 'postcard', 'golden hour'],
  architecture: ['cast-iron', 'cast iron', 'architecture', 'rowhouse', 'tenement', 'cathedral', 'calatrava', 'piano', 'judd', 'nouvel', 'brownstone'],
  food:         ['food', 'restaurant', 'market', 'sandwich', 'donut', 'bakery', 'tacos', 'brunch', 'dining', 'oyster', 'pastrami', 'bagel', 'pierogi', 'pudding'],
  art:          ['gallery', 'galleries', 'museum', 'mural', 'street art', 'contemporary', 'drawing', 'art'],
  nature:       ['park', 'garden', 'lawn', 'waterfront', 'esplanade', 'lake'],
  books:        ['book', 'bookshop', 'bookstore', 'bookselling', 'zines', 'monographs'],
  sunset:       ['sunset', 'golden hour', 'rooftop', 'overlook', 'panoramic', 'skyline'],
  date:         ['rooftop', 'cocktail', 'sunset', 'romantic', 'hammam', 'thermal', 'jazz'],
  // Legacy aliases from onboarding's mood ids
  aesthetic_photo: ['photograph', 'photo', 'cobble', 'facade'],
  sunsets:      ['sunset', 'golden hour', 'rooftop', 'overlook', 'panoramic'],
  vintage:      ['vintage', 'thrift', 'consignment', 'used books', 'records', 'vinyl'],
  history:      ['history', 'historic', 'institution', 'memorial', 'tenement', 'oldest', 'restored', 'landmark', 'inaugurated'],
  music:        ['vinyl', 'records', 'music', 'jazz', 'punk', 'indie', 'apollo', 'concert', 'gig', 'venue', 'symphony'],
  aesthetic:    ['cast-iron', 'cobble', 'aesthetic', 'facade', 'brownstone', 'photograph'],
};

/* Precompute moods per stop so per-request cost is O(stops * userMoods). */
function tagMoods(stop) {
  const hay = (stop.name + ' ' + stop.why + ' ' + stop.desc).toLowerCase();
  const tags = new Set();
  for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
    if (keywords.some(k => hay.includes(k))) tags.add(mood);
  }
  return tags;
}
const STOPS_WITH_MOODS = STOPS.map(s => ({ ...s, _moods: tagMoods(s) }));

/* ----------------------------------------------------------------------------
 * Title composition lookup. Each mood maps to two noun phrases — a primary
 * noun (used as the head of the title) and a "with" phrase (used as the
 * secondary clause). Replaced by an LLM-generated title in v0.8.
 * ------------------------------------------------------------------------- */
const MOOD_NOUNS = {
  coffee:       { head: 'cafe crawl',         with: 'a slow caffeine arc' },
  hidden_gems:  { head: 'hidden-gem loop',    with: 'doors most people walk past' },
  photo_spots:  { head: 'photo walk',         with: 'a golden-hour route' },
  architecture: { head: 'architecture walk',  with: 'cast-iron and brick' },
  food:         { head: 'food crawl',         with: 'one bite per stop' },
  art:          { head: 'gallery hop',        with: 'a few quiet rooms' },
  nature:       { head: 'green-space walk',   with: 'a breath between blocks' },
  books:        { head: 'bookshop loop',      with: 'shelves worth a detour' },
  sunset:       { head: 'sunset walk',        with: 'the best low-light blocks' },
  date:         { head: 'date-night walk',    with: 'somewhere to linger' },
  aesthetic_photo: { head: 'photo walk',      with: 'a golden-hour route' },
  sunsets:      { head: 'sunset walk',        with: 'the best low-light blocks' },
  vintage:      { head: 'vintage crawl',      with: 'racks and crates' },
  history:      { head: 'history walk',       with: 'plaques that pay off' },
  music:        { head: 'music walk',         with: 'vinyl crates and venues' },
  aesthetic:    { head: 'aesthetic walk',     with: 'blocks built for photos' },
};

const NBHD_LABEL = {
  soho:'SoHo', ev:'East Village', westvillage:'West Village', chelsea:'Chelsea',
  williamsburg:'Williamsburg', dumbo:'DUMBO', centralpark:'Upper Manhattan',
  les:'Lower East Side',
};

/* ----------------------------------------------------------------------------
 * Geo helpers.
 * ------------------------------------------------------------------------- */
function haversineMiles(a, b) {
  const toRad = x => (x * Math.PI) / 180;
  const R = 3958.7613; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function resolveOrigin(origin) {
  if (!origin || typeof origin !== 'object') return { ...NBHD_CENTERS.soho, nbhd: 'soho' };
  if (typeof origin.lat === 'number' && typeof origin.lon === 'number') {
    // Snap to nearest known nbhd for the "neighborhood match" bonus.
    let best = 'soho';
    let bestD = Infinity;
    for (const [k, c] of Object.entries(NBHD_CENTERS)) {
      const d = haversineMiles({ lat: origin.lat, lon: origin.lon }, c);
      if (d < bestD) { bestD = d; best = k; }
    }
    return { lat: origin.lat, lon: origin.lon, nbhd: best };
  }
  const n = String(origin.neighborhood || '').toLowerCase().slice(0, 32);
  if (NBHD_CENTERS[n]) return { ...NBHD_CENTERS[n], nbhd: n };
  return { ...NBHD_CENTERS.soho, nbhd: 'soho' };
}

/* ----------------------------------------------------------------------------
 * Greedy nearest-neighbor TSP-lite. Picks a starting stop closest to origin,
 * then chains by nearest remaining. Good enough for 3-7 stops, deterministic,
 * and O(n^2) which is fine at this size.
 * ------------------------------------------------------------------------- */
function orderByNearestNeighbor(stops, origin) {
  if (stops.length <= 1) return stops.slice();
  const remaining = stops.slice();
  const ordered = [];
  let current = { lat: origin.lat, lon: origin.lon };
  while (remaining.length) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMiles(current, remaining[i]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const next = remaining.splice(bestI, 1)[0];
    ordered.push(next);
    current = next;
  }
  return ordered;
}

function totalRouteMiles(orderedStops, origin) {
  if (!orderedStops.length) return 0;
  let miles = haversineMiles(origin, orderedStops[0]);
  for (let i = 1; i < orderedStops.length; i++) {
    miles += haversineMiles(orderedStops[i - 1], orderedStops[i]);
  }
  return miles;
}

/* ----------------------------------------------------------------------------
 * Composers. Both are intentionally tiny templated strings — they'll be
 * replaced by an LLM-generated title/desc pair in v0.8.
 * ------------------------------------------------------------------------- */
function composeTitle(nbhd, moods) {
  const nbhdLabel = NBHD_LABEL[nbhd] || 'NYC';
  // English article agreement: use "An" before vowel-initial neighborhood
  // labels (e.g. "An Upper Manhattan ..."). Cheap heuristic; good enough.
  const article = /^[aeiouAEIOU]/.test(nbhdLabel) ? 'An' : 'A';
  const primary = moods[0] && MOOD_NOUNS[moods[0]];
  const secondary = moods[1] && MOOD_NOUNS[moods[1]];
  if (primary && secondary && moods[0] !== moods[1]) {
    return `${article} ${nbhdLabel} ${primary.head} with ${secondary.with}`;
  }
  if (primary) return `${article} ${nbhdLabel} ${primary.head}`;
  return `A walk through ${nbhdLabel}`;
}

function composeDesc(stops, miles, moods, freeText) {
  const moodLabel = moods.length ? moods.slice(0, 2).join(' + ').replace(/_/g, ' ') : 'your vibe';
  const mi = miles.toFixed(1);
  let base = `Generated for you — ${stops.length} stops in ${mi} miles, leaning toward ${moodLabel}.`;
  if (freeText) base += ` Note: "${freeText.slice(0, 80)}".`;
  return base;
}

/* ----------------------------------------------------------------------------
 * Handler.
 * ------------------------------------------------------------------------- */
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  const session = await getSession(req);
  if (!session) return json(res, 401, { ok: false, error: 'unauthenticated' });

  // 10 per user per hour, per the brief.
  const limit = await rateLimit(req, 'aigen:' + session.userId, { max: 10, windowSec: 60 * 60 });
  if (!limit.ok) {
    return json(res, 429, { ok: false, error: 'rate_limited', retryAfter: limit.retryAfter });
  }

  const body = await readJson(req);
  const minutesRaw = Number(body.minutes);
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0
    ? Math.min(240, Math.max(15, minutesRaw))
    : 60;
  const moods = Array.isArray(body.moods)
    ? body.moods.filter(m => typeof m === 'string').slice(0, 10).map(m => m.toLowerCase())
    : [];
  const origin = resolveOrigin(body.origin);
  const freeText = typeof body.freeText === 'string' ? body.freeText.trim().slice(0, 240) : '';

  // Stop count target: ~18 min per stop, clamped [3, 7].
  const targetStops = Math.min(7, Math.max(3, Math.round(minutes / 18)));
  const distanceBudgetMiles = 1.0 + targetStops * 0.2;

  // Score every stop.
  const scored = STOPS_WITH_MOODS.map(stop => {
    let score = 0;

    // Mood overlap: +25 per matched mood.
    if (moods.length) {
      let overlap = 0;
      for (const m of moods) if (stop._moods.has(m)) overlap += 1;
      score += overlap * 25;
    }

    // Distance penalty: each mile from origin costs 5 points.
    const distMiles = haversineMiles({ lat: origin.lat, lon: origin.lon }, stop);
    score -= distMiles * 5;

    // Neighborhood match bonus: +50 for being in the chosen/snapped nbhd.
    if (stop.nbhd === origin.nbhd) score += 50;

    // Sponsored boost (small, +5).
    if (stop.sponsored) score += 5;

    return { stop, score, distMiles };
  });

  // Sort by score desc, then walk down picking those within budget. We allow
  // ONE sponsored stop per generated route (small revenue lever; never the
  // only reason a stop appears).
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let sponsoredUsed = 0;
  for (const cand of scored) {
    if (picked.length >= targetStops) break;
    if (cand.distMiles > distanceBudgetMiles) continue;
    if (cand.stop.sponsored) {
      if (sponsoredUsed >= 1) continue;
      sponsoredUsed += 1;
    }
    picked.push(cand);
  }

  // Backfill if not enough fit the budget — relax distance constraint.
  if (picked.length < 3) {
    for (const cand of scored) {
      if (picked.length >= targetStops) break;
      if (picked.find(p => p.stop === cand.stop)) continue;
      if (cand.stop.sponsored && sponsoredUsed >= 1) continue;
      picked.push(cand);
      if (cand.stop.sponsored) sponsoredUsed += 1;
    }
  }

  // Order picked stops geographically (greedy nearest-neighbor).
  const orderedStops = orderByNearestNeighbor(picked.map(p => p.stop), origin);

  // Compute total route distance for the desc + the response.
  const milesTotal = totalRouteMiles(orderedStops, origin);

  // The neighborhood we'll claim the route belongs to: most common nbhd
  // among picked stops, fallback to the snapped origin nbhd.
  const nbhdCounts = {};
  for (const s of orderedStops) nbhdCounts[s.nbhd] = (nbhdCounts[s.nbhd] || 0) + 1;
  let routeNbhd = origin.nbhd;
  let bestCount = 0;
  for (const [n, c] of Object.entries(nbhdCounts)) {
    if (c > bestCount) { bestCount = c; routeNbhd = n; }
  }

  const title = composeTitle(routeNbhd, moods);
  const desc = composeDesc(orderedStops, milesTotal, moods, freeText);

  // Strip internal fields before returning.
  const stopsOut = orderedStops.map(s => ({
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    why: s.why,
    desc: s.desc,
    ...(s.sponsored ? { sponsored: true } : {}),
  }));

  const route = {
    id: 'ai_' + Date.now(),
    title,
    nbhd: routeNbhd,
    minutes,
    miles: Math.round(milesTotal * 10) / 10,
    desc,
    isAiGenerated: true,
    stops: stopsOut,
    ...(freeText ? { note: freeText } : {}),
  };

  return json(res, 200, { ok: true, route });
}
