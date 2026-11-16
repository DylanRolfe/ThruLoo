// Turns the saved Overpass response into cleaned, classified GeoJSON layers in
// data/geojson/, applying hand corrections from data/overrides.json.
//
//   node scripts/build-geojson.mjs
//
// Output is WGS84 GeoJSON so it can be dropped into geojson.io or QGIS for a
// side-by-side check. Projection to local metres happens later, at bake time.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPUS_BBOX, project } from './lib/campus.mjs';
import { closestOnSegment, interiorPoint, pointInPolygon, ringArea } from './lib/geom.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawFile = resolve(root, 'data/raw/osm-overpass.json');
const overridesFile = resolve(root, 'data/overrides.json');
const outDir = resolve(root, 'data/geojson');
const reportDir = resolve(root, 'data/reports');

const raw = JSON.parse(await readFile(rawFile, 'utf8'));
const overrides = JSON.parse(await readFile(overridesFile, 'utf8'));
const buildingOverrides = overrides.buildings ?? {};

// ---------------------------------------------------------------- indexes
const nodes = new Map();
const ways = new Map();
const relations = [];
for (const el of raw.elements) {
  if (el.type === 'node') nodes.set(el.id, el);
  else if (el.type === 'way') ways.set(el.id, el);
  else relations.push(el);
}

const coord = (id) => {
  const n = nodes.get(id);
  return [n.lon, n.lat];
};
const wayCoords = (way) => way.nodes.filter((id) => nodes.has(id)).map(coord);
const isClosed = (way) => way.nodes.length >= 4 && way.nodes[0] === way.nodes[way.nodes.length - 1];

// Relation recursion drags in far-away members (e.g. the Cambridge campus of
// the UW site relation), so everything is filtered back to the fetch window.
const M = 0.0005;
const inWindow = ([lon, lat]) =>
  lat >= CAMPUS_BBOX.south - M && lat <= CAMPUS_BBOX.north + M &&
  lon >= CAMPUS_BBOX.west - M && lon <= CAMPUS_BBOX.east + M;
const anyInWindow = (coords) => coords.some(inWindow);

// ------------------------------------------------------- polygon assembly
function orient(ring, ccw) {
  return ringArea(ring) > 0 === ccw ? ring : ring.slice().reverse();
}

// Join member ways end to end into closed rings.
function stitch(memberWays) {
  const segs = memberWays.map((w) => w.nodes.slice());
  const rings = [];
  while (segs.length) {
    let cur = segs.pop();
    while (cur[0] !== cur[cur.length - 1]) {
      const tail = cur[cur.length - 1];
      const i = segs.findIndex((s) => s[0] === tail || s[s.length - 1] === tail);
      if (i < 0) break;
      const s = segs.splice(i, 1)[0];
      if (s[0] !== tail) s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (cur.length >= 4 && cur[0] === cur[cur.length - 1] && cur.every((id) => nodes.has(id))) {
      rings.push(cur.map(coord));
    }
  }
  return rings;
}

// -> array of polygons, each [outer, ...holes], RFC 7946 winding.
function relationPolygons(rel) {
  const members = (role) =>
    rel.members
      .filter((m) => m.type === 'way' && ways.has(m.ref) && (m.role === role || (role === 'outer' && m.role === '')))
      .map((m) => ways.get(m.ref));
  const outers = stitch(members('outer')).map((r) => orient(r, true));
  const inners = stitch(members('inner')).map((r) => orient(r, false));
  return outers.map((outer) => [outer, ...inners.filter((h) => pointInPolygon(h[0], [outer]))]);
}

function wayPolygons(way) {
  if (!isClosed(way) || !way.nodes.every((id) => nodes.has(id))) return [];
  return [[orient(wayCoords(way), true)]];
}

function polygonsOf(el) {
  const polys = el.type === 'way' ? wayPolygons(el) : relationPolygons(el);
  return polys.filter((p) => anyInWindow(p[0]));
}

const toGeometry = (polys) =>
  polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };

const areaM2 = (polys) =>
  polys.reduce((sum, poly) => {
    const a = poly.map((ring) => Math.abs(ringArea(ring.map(([lon, lat]) => project(lat, lon)))));
    return sum + a[0] - a.slice(1).reduce((s, v) => s + v, 0);
  }, 0);

const feature = (id, geometry, properties) => ({ type: 'Feature', id, geometry, properties });
const osmId = (el) => `${el.type}/${el.id}`;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const prune = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

// ------------------------------------------------------------ campus area
const uwRelation = relations.find((r) => r.tags?.amenity === 'university' && r.tags?.short_name === 'UW');
const campusPolys = uwRelation ? polygonsOf(uwRelation) : [];
const insideCampus = (pt) => campusPolys.some((p) => pointInPolygon(pt, p));

// -------------------------------------------------------------- buildings
const RESIDENTIAL = new Set([
  'house', 'detached', 'semidetached_house', 'terrace', 'apartments', 'residential', 'dormitory',
]);
const DEFAULT_HEIGHT = {
  shed: 2.8, garage: 3, roof: 3.5, toilets: 3, service: 3.5, greenhouse: 4,
  house: 6.5, detached: 6.5, semidetached_house: 6.5, terrace: 6.5,
  retail: 5, commercial: 6, industrial: 7, chapel: 9,
  apartments: 13, residential: 10, dormitory: 13,
  office: 12, university: 12, college: 12, school: 9, public: 8, sports_centre: 11,
};
const levelHeight = (kind) => (RESIDENTIAL.has(kind) ? 3.2 : 4);
const codeLike = (s) => (s && /^[A-Z][A-Z0-9]{1,4}$/.test(s) ? s : undefined);

function heightOf(tags, kind, override, fallback) {
  const lh = levelHeight(kind);
  const levels = num(tags['building:levels']);
  const minLevel = num(tags['building:min_level']);
  const minHeight = num(tags.min_height) ?? (minLevel ? minLevel * lh : 0);
  if (override?.height != null) return { height: override.height, minHeight, source: 'override' };
  const h = num(tags.height);
  if (h) return { height: h, minHeight, source: 'osm:height' };
  if (levels) {
    const roof = num(tags['roof:levels']) ?? 0;
    return { height: +((levels + roof * 0.5) * lh).toFixed(1), minHeight, source: 'osm:levels' };
  }
  if (fallback != null) return { height: fallback, minHeight, source: 'parent' };
  return { height: DEFAULT_HEIGHT[kind] ?? 8, minHeight, source: 'default' };
}

const buildings = [];
const buildingPolys = new Map(); // feature id -> polygons
const nodeToBuilding = new Map(); // outline node id -> building feature id

function addBuilding(el) {
  const tags = el.tags;
  if (tags.building === 'no') return;
  const polys = polygonsOf(el);
  if (!polys.length) return;
  const id = osmId(el);
  const ov = buildingOverrides[id];
  if (ov?.hidden) return;
  const kind = tags.building === 'yes' ? (tags.amenity === 'university' ? 'university' : 'yes') : tags.building;
  const { height, minHeight, source } = heightOf(tags, kind, ov);
  const centre = interiorPoint(polys[0]);
  const code = ov?.code ?? tags.ref ?? codeLike(tags.short_name);
  const aliases = [
    ...new Set(
      [tags.old_ref, tags.short_name, tags.alt_name, tags.old_name, tags.official_name, ...(ov?.aliases ?? [])]
        .filter(Boolean)
        .flatMap((s) => s.split(';').map((t) => t.trim()))
        .filter((s) => s && s !== code),
    ),
  ];
  const campus = ov?.campus ?? (Boolean(tags.ref) || Boolean(ov?.code) || insideCampus(centre));
  buildings.push(
    feature(id, toGeometry(polys), prune({
      code,
      name: ov?.name ?? tags.name,
      aliases: aliases.length ? aliases : undefined,
      kind,
      campus,
      levels: num(tags['building:levels']),
      height,
      minHeight: minHeight || undefined,
      heightSource: source,
      colour: tags['building:colour'],
      roofColour: tags['roof:colour'],
      roofShape: tags['roof:shape'],
      material: tags['building:material'],
      layer: num(tags.layer) ?? undefined,
      wheelchair: tags.wheelchair,
      areaM2: Math.round(areaM2(polys)),
      centre: centre.map((v) => +v.toFixed(7)),
    })),
  );
  buildingPolys.set(id, polys);
  const outlineWays = el.type === 'way' ? [el] : el.members.filter((m) => m.type === 'way' && ways.has(m.ref)).map((m) => ways.get(m.ref));
  for (const w of outlineWays) for (const nid of w.nodes) if (!nodeToBuilding.has(nid)) nodeToBuilding.set(nid, id);
}

for (const w of ways.values()) if (w.tags?.building) addBuilding(w);
for (const r of relations) if (r.tags?.building && r.tags.type === 'multipolygon') addBuilding(r);
// type=building relations only group an outline with its parts; the outline way
// and the parts are picked up on their own, so the relation adds nothing here.

const buildingById = new Map(buildings.map((b) => [b.id, b]));

// --------------------------------------------------------- building parts
const parts = [];
for (const el of [...ways.values(), ...relations]) {
  if (!el.tags?.['building:part'] || el.tags['building:part'] === 'no' || el.tags.building) continue;
  const polys = polygonsOf(el);
  if (!polys.length) continue;
  const pt = interiorPoint(polys[0]);
  let parent = null;
  for (const [id, bp] of buildingPolys) {
    if (bp.some((p) => pointInPolygon(pt, p))) {
      // Prefer the smallest containing outline (a building inside a courtyard).
      if (!parent || buildingById.get(id).properties.areaM2 < buildingById.get(parent).properties.areaM2) parent = id;
    }
  }
  const pb = parent ? buildingById.get(parent).properties : null;
  const { height, minHeight, source } = heightOf(el.tags, pb?.kind ?? 'yes', null, pb?.height);
  parts.push(
    feature(osmId(el), toGeometry(polys), prune({
      parent,
      name: el.tags.name,
      levels: num(el.tags['building:levels']),
      height,
      minHeight: minHeight || undefined,
      heightSource: source,
      colour: el.tags['building:colour'] ?? el.tags.colour,
      roofShape: el.tags['roof:shape'],
      areaM2: Math.round(areaM2(polys)),
    })),
  );
}
for (const b of buildings) {
  const mine = parts.filter((p) => p.properties.parent === b.id);
  if (!mine.length) continue;
  b.properties.partCount = mine.length;
  b.properties.partCoverage = +Math.min(1, mine.reduce((s, p) => s + p.properties.areaM2, 0) / Math.max(1, b.properties.areaM2)).toFixed(2);
}

// ------------------------------------------------------------------ paths
const ROADS = new Set(['residential', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link']);
const PATH_TAGS = [
  'name', 'surface', 'access', 'foot', 'bicycle', 'service', 'footway', 'crossing', 'lit', 'wheelchair',
  'incline', 'width', 'lanes', 'oneway', 'tunnel', 'bridge', 'covered', 'indoor', 'step_count', 'ramp',
  'conveying', 'construction', 'sidewalk',
];

function pathKind(t) {
  const h = t.highway;
  if (h === 'footway') return t.footway === 'crossing' ? 'crossing' : t.footway === 'sidewalk' ? 'sidewalk' : 'footway';
  if (h === 'service') return t.service === 'parking_aisle' ? 'parking_aisle' : 'service';
  if (ROADS.has(h)) return 'road';
  return h; // steps, path, pedestrian, cycleway, corridor, platform, track, construction
}

// Where the way physically is. Phase 1 routes over outdoor/covered/passage only.
function pathEnv(t) {
  const indoor = t.highway === 'corridor' || t.indoor === 'yes';
  if (t.tunnel === 'yes') return 'tunnel';
  if (t.bridge && t.bridge !== 'no' && (indoor || t.covered === 'yes')) return 'skywalk';
  if (indoor) return 'indoor';
  if (t.tunnel === 'building_passage') return 'passage';
  if (t.covered === 'yes') return 'covered';
  return 'outdoor';
}

const parseLevels = (v) => (v == null ? undefined : String(v).split(';').map(parseFloat).filter(Number.isFinite));

const paths = [];
const areas = [];
for (const w of ways.values()) {
  const t = w.tags;
  if (!t?.highway) continue;
  if (!w.nodes.every((id) => nodes.has(id))) continue;
  const coords = wayCoords(w);
  if (!anyInWindow(coords)) continue;
  const isArea = t.area === 'yes' && isClosed(w);
  const picked = Object.fromEntries(PATH_TAGS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
  paths.push(
    feature(osmId(w), { type: 'LineString', coordinates: coords }, prune({
      highway: t.highway,
      kind: pathKind(t),
      env: pathEnv(t),
      levels: parseLevels(t.level),
      layer: num(t.layer) ?? undefined,
      area: isArea || undefined,
      ...picked,
      nodes: w.nodes,
    })),
  );
  if (isArea) {
    areas.push(feature(osmId(w), toGeometry(wayPolygons(w)), prune({ kind: t.highway === 'platform' ? 'platform' : 'plaza', name: t.name, surface: t.surface })));
  }
}

// ------------------------------------------------------------------ areas
function areaKind(t) {
  if (t.natural === 'water') return 'water';
  if (t.natural === 'wetland') return 'wetland';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub') return 'scrub';
  if (t.amenity === 'parking') return t.parking === 'underground' ? null : 'parking';
  if (t.leisure === 'pitch' || t.leisure === 'track') return 'pitch';
  if (t.leisure === 'swimming_pool') return 'pool';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'garden' || t.landuse === 'flowerbed') return 'garden';
  if (t.leisure === 'park' || t.leisure === 'nature_reserve') return 'park';
  if (['grass', 'meadow', 'recreation_ground', 'village_green', 'allotments', 'farmland'].includes(t.landuse)) return 'grass';
  if (t.natural === 'grassland' || t.natural === 'grass') return 'grass';
  if (t.landuse === 'construction' || t.landuse === 'brownfield') return 'construction';
  if (t.landuse === 'railway') return 'railway';
  return null;
}
for (const el of [...ways.values(), ...relations]) {
  const t = el.tags;
  if (!t || t.building || t['building:part'] || t.highway) continue;
  if (el.type === 'relation' && t.type !== 'multipolygon') continue;
  const kind = areaKind(t);
  if (!kind) continue;
  const polys = polygonsOf(el);
  if (!polys.length) continue;
  areas.push(feature(osmId(el), toGeometry(polys), prune({ kind, name: t.name, sport: t.sport, surface: t.surface, access: t.access, areaM2: Math.round(areaM2(polys)) })));
}

// ------------------------------------------------------------------ lines
const lines = [];
for (const w of ways.values()) {
  const t = w.tags;
  if (!t || t.highway || t.building) continue;
  let kind = null;
  if (t.waterway) kind = ['stream', 'river'].includes(t.waterway) ? 'stream' : 'drain';
  else if (t.railway === 'rail' || t.railway === 'light_rail') kind = t.railway;
  else if (t.barrier && !isClosed(w)) kind = t.barrier;
  else if (t.barrier && isClosed(w) && !areaKind(t)) kind = t.barrier;
  else if (t.natural === 'tree_row') kind = 'tree_row';
  if (!kind || !w.nodes.every((id) => nodes.has(id))) continue;
  const coords = wayCoords(w);
  if (!anyInWindow(coords)) continue;
  lines.push(feature(osmId(w), { type: 'LineString', coordinates: coords }, prune({ kind, name: t.name, tunnel: t.tunnel, layer: num(t.layer) ?? undefined })));
}

// -------------------------------------------------------------- entrances
// Outline segments in local metres, for snapping entrances that are not
// literally a vertex of a building outline.
const outlineSegs = [];
for (const [id, polys] of buildingPolys) {
  for (const poly of polys) for (const ring of poly) {
    const pts = ring.map(([lon, lat]) => project(lat, lon));
    for (let i = 0; i + 1 < pts.length; i++) outlineSegs.push({ id, a: pts[i], b: pts[i + 1] });
  }
}
function nearestBuilding(lon, lat, maxDist) {
  const p = project(lat, lon);
  let best = null;
  for (const s of outlineSegs) {
    if (Math.min(s.a[0], s.b[0]) - maxDist > p[0] || Math.max(s.a[0], s.b[0]) + maxDist < p[0]) continue;
    const { dist } = closestOnSegment(p, s.a, s.b);
    if (dist <= maxDist && (!best || dist < best.dist)) best = { id: s.id, dist };
  }
  return best;
}

const entrances = [];
const points = [];
for (const n of nodes.values()) {
  const t = n.tags;
  if (!t) continue;
  const pt = [n.lon, n.lat];
  if (!inWindow(pt)) continue;
  if (t.entrance) {
    let building = nodeToBuilding.get(n.id);
    let snapped;
    if (!building) {
      const near = nearestBuilding(n.lon, n.lat, 4);
      if (near) {
        building = near.id;
        snapped = +near.dist.toFixed(1);
      }
    }
    const b = building ? buildingById.get(building)?.properties : null;
    entrances.push(
      feature(osmId(n), { type: 'Point', coordinates: pt }, prune({
        kind: t.entrance,
        building,
        code: b?.code,
        name: t.name,
        ref: t.ref,
        level: t.level,
        door: t.door,
        access: t.access,
        wheelchair: t.wheelchair,
        snapped,
        node: n.id,
      })),
    );
    continue;
  }
  let kind = null;
  if (t.natural === 'tree') kind = 'tree';
  else if (t.highway === 'crossing') kind = 'crossing';
  else if (t.highway === 'elevator') kind = 'elevator';
  else if (t.highway === 'bus_stop') kind = 'bus_stop';
  else if (t.highway === 'street_lamp') kind = 'street_lamp';
  else if (t.highway === 'traffic_signals') kind = 'traffic_signals';
  else if (t.barrier) kind = `barrier:${t.barrier}`;
  if (!kind) continue;
  points.push(feature(osmId(n), { type: 'Point', coordinates: pt }, prune({ kind, name: t.name, access: t.access, foot: t.foot, crossing: t.crossing, level: t.level, node: n.id })));
}
for (const b of buildings) {
  const mine = entrances.filter((e) => e.properties.building === b.id);
  if (mine.length) b.properties.entrances = mine.length;
}

// ----------------------------------------------------------------- output
await mkdir(outDir, { recursive: true });
await mkdir(reportDir, { recursive: true });
const collection = (features) => ({ type: 'FeatureCollection', features });
const write = (name, features) => writeFile(resolve(outDir, name), JSON.stringify(collection(features)) + '\n');

buildings.sort((a, b) => a.id.localeCompare(b.id));
await write('buildings.geojson', buildings);
await write('building-parts.geojson', parts);
await write('paths.geojson', paths);
await write('areas.geojson', areas);
await write('lines.geojson', lines);
await write('entrances.geojson', entrances);
await write('points.geojson', points);
await write('campus.geojson', campusPolys.length ? [feature(osmId(uwRelation), toGeometry(campusPolys), { name: uwRelation.tags.name })] : []);

// Height log: every campus building whose height is not a surveyed value.
const csv = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const campusB = buildings.filter((b) => b.properties.campus);
const estimated = campusB
  .filter((b) => !['osm:height', 'override'].includes(b.properties.heightSource))
  .sort((a, b) => a.properties.heightSource.localeCompare(b.properties.heightSource) || (b.properties.areaM2 - a.properties.areaM2));
await writeFile(
  resolve(reportDir, 'height-estimates.csv'),
  ['osm_id,code,name,kind,levels,height_m,source,footprint_m2']
    .concat(estimated.map((b) => { const p = b.properties; return [b.id, p.code, p.name, p.kind, p.levels, p.height, p.heightSource, p.areaM2].map(csv).join(','); }))
    .join('\n') + '\n',
);

const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const summary = {
  osmTimestamp: raw.osm3s?.timestamp_osm_base,
  fetchedAt: raw.fetched_at,
  buildings: {
    total: buildings.length,
    campus: campusB.length,
    campusWithCode: campusB.filter((b) => b.properties.code).length,
    campusNamed: campusB.filter((b) => b.properties.name).length,
    campusUnnamed: campusB.filter((b) => !b.properties.name).length,
    campusHeightSource: count(campusB, (b) => b.properties.heightSource),
    allHeightSource: count(buildings, (b) => b.properties.heightSource),
    campusWithEntrances: campusB.filter((b) => b.properties.entrances).length,
    codedWithoutEntrances: campusB.filter((b) => b.properties.code && !b.properties.entrances).map((b) => b.properties.code),
    withParts: buildings.filter((b) => b.properties.partCount).length,
  },
  parts: { total: parts.length, orphan: parts.filter((p) => !p.properties.parent).length },
  paths: { total: paths.length, byKind: count(paths, (p) => p.properties.kind), byEnv: count(paths, (p) => p.properties.env) },
  areas: count(areas, (a) => a.properties.kind),
  lines: count(lines, (l) => l.properties.kind),
  entrances: { total: entrances.length, byKind: count(entrances, (e) => e.properties.kind), withBuilding: entrances.filter((e) => e.properties.building).length },
  points: count(points, (p) => p.properties.kind.split(':')[0]),
};
await writeFile(resolve(reportDir, 'geojson-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
