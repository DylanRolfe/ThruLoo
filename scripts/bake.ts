// Bakes data/geojson/*.geojson into public/data/campus.json: everything the app
// needs at runtime, projected to local metres, with the route graph prebuilt.
//
//   npm run data:bake
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Area, AreaKind, Building, BuildingPart, CampusData, NamedPlace, Ribbon, RibbonKind } from '../src/data/types';
import { closestOnSegment, pointInPolygon, polylineLength, segmentIntersection, slicePolyline, type Polygon, type Pt, type Ring } from '../src/lib/geom';
import { buildGraph, type DoorInput, type OutlineInput, type WayInput } from '../src/routing/build';
import { parseWatIsGrass } from '../src/routing/indoor';
import { RouteGraph } from '../src/routing/graph';
import { outdoorProfile } from '../src/routing/profiles';
import type { EdgeKind } from '../src/routing/types';
import { CAMPUS_BBOX, CAMPUS_ORIGIN, project } from './lib/campus.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Feature {
  id: string;
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
}
const load = async (name: string): Promise<Feature[]> =>
  JSON.parse(await readFile(resolve(root, 'data/geojson', name), 'utf8')).features;

const [fBuildings, fParts, fPaths, fAreas, fLines, fEntrances, fPoints] = await Promise.all(
  ['buildings', 'building-parts', 'paths', 'areas', 'lines', 'entrances', 'points'].map((n) => load(`${n}.geojson`)),
);
const overrides = JSON.parse(await readFile(resolve(root, 'data/overrides.json'), 'utf8'));
const summary = JSON.parse(await readFile(resolve(root, 'data/reports/geojson-summary.json'), 'utf8'));

const r2 = (v: number) => Math.round(v * 100) / 100;
const xy = ([lon, lat]: [number, number]): Pt => {
  const [x, y] = project(lat, lon) as [number, number];
  return [r2(x), r2(y)];
};

/** GeoJSON ring (closed, lon/lat) -> flat local ring without the closing repeat. */
function ringOf(coords: [number, number][]): Ring {
  const out: number[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [x, y] = xy(coords[i]);
    const n = out.length;
    if (n >= 2 && out[n - 2] === x && out[n - 1] === y) continue;
    out.push(x, y);
  }
  return out;
}
const polygonsOf = (g: Feature['geometry']): Polygon[] =>
  (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
    .map((poly: [number, number][][]) => poly.map(ringOf).filter((r) => r.length >= 6))
    .filter((poly: Polygon) => poly.length > 0);
const lineOf = (g: Feature['geometry']): number[] => (g.coordinates as [number, number][]).flatMap(xy);
const ringPts = (ring: Ring): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i += 2) out.push([ring[i], ring[i + 1]]);
  return out;
};

// ---------------------------------------------------------------- buildings
const partsByParent = new Map<string, BuildingPart[]>();
for (const f of fParts) {
  const p = f.properties;
  if (!p.parent) continue;
  const part: BuildingPart = { polygons: polygonsOf(f.geometry), height: p.height, minHeight: p.minHeight ?? 0, ...(p.colour ? { colour: p.colour } : {}) };
  if (!part.polygons.length || part.height <= part.minHeight) continue;
  if (!partsByParent.has(p.parent)) partsByParent.set(p.parent, []);
  partsByParent.get(p.parent)!.push(part);
}

const V1_HOUSE = /^(North|South|East|West) \d$/;
const buildings: Building[] = [];
for (const f of fBuildings) {
  const p = f.properties;
  const polygons = polygonsOf(f.geometry);
  if (!polygons.length) continue;
  let height: number = p.height;
  let minHeight: number = p.minHeight ?? 0;
  // Canopies are drawn as a thin slab at roof height.
  if (p.kind === 'roof') minHeight = Math.max(0, height - 0.4);
  if (p.kind === 'bridge' && minHeight === 0) minHeight = 4;
  if (height <= minHeight) height = minHeight + 3;
  const parts = (p.partCoverage ?? 0) >= 0.8 ? partsByParent.get(f.id) : undefined;
  const top = Math.max(height, ...(parts ?? []).map((q) => q.height));
  const [cx, cy] = xy(p.centre);
  buildings.push({
    id: f.id,
    ...(p.code ? { code: p.code } : {}),
    ...(p.name ? { name: V1_HOUSE.test(p.name) ? `V1 ${p.name}` : p.name } : {}),
    ...(p.aliases ? { aliases: p.aliases } : {}),
    kind: p.kind,
    campus: p.campus,
    height,
    minHeight,
    top,
    ...(p.colour ? { colour: p.colour } : {}),
    polygons,
    centre: [cx, cy],
    area: p.areaM2,
    ...(parts ? { parts } : {}),
    doors: [],
    anchors: [],
    solid: minHeight === 0 && p.kind !== 'roof' && p.kind !== 'bridge' && p.areaM2 >= 12,
  });
}
const buildingById = new Map(buildings.map((b) => [b.id, b]));

// -------------------------------------------------------------------- areas
const areas: Area[] = [];
for (const f of fAreas) {
  const polygons = polygonsOf(f.geometry);
  if (polygons.length) areas.push({ kind: f.properties.kind as AreaKind, polygons });
}

// ------------------------------------------------------------------ ribbons
const ROAD_WIDTH: Record<string, number> = { secondary: 11, secondary_link: 7, tertiary: 8.5, tertiary_link: 6, residential: 7, unclassified: 6.5 };
const ribbons: Ribbon[] = [];
for (const f of fPaths) {
  const p = f.properties;
  if (!['outdoor', 'covered', 'passage'].includes(p.env)) continue;
  if (p.area || ['corridor', 'construction', 'platform'].includes(p.kind)) continue;
  let kind: RibbonKind;
  let width: number;
  switch (p.kind) {
    case 'road': kind = 'road'; width = p.lanes ? Math.max(5.5, parseFloat(p.lanes) * 3.4) : ROAD_WIDTH[p.highway] ?? 7; break;
    case 'service': kind = 'service'; width = 4.6; break;
    case 'parking_aisle': kind = 'aisle'; width = 5.6; break;
    case 'sidewalk': kind = 'sidewalk'; width = 1.8; break;
    case 'crossing': kind = 'crossing'; width = 3; break;
    case 'steps': kind = 'steps'; width = 2.6; break;
    case 'cycleway': kind = 'shared'; width = 3.2; break;
    case 'pedestrian': kind = 'footway'; width = 4.5; break;
    case 'path': case 'track': kind = 'path'; width = 1.6; break;
    default: kind = 'footway'; width = 2.4;
  }
  ribbons.push({ kind, width, line: lineOf(f.geometry) });
}
for (const f of fLines) {
  const k = f.properties.kind;
  if (f.properties.tunnel === 'yes' || f.properties.tunnel === 'culvert') continue;
  if (k === 'stream') ribbons.push({ kind: 'stream', width: 3, line: lineOf(f.geometry) });
  else if (k === 'rail' || k === 'light_rail') ribbons.push({ kind: 'rail', width: 1.8, line: lineOf(f.geometry) });
}

// -------------------------------------------------------------------- trees
const [bx0, by0] = project(CAMPUS_BBOX.south, CAMPUS_BBOX.west) as [number, number];
const [bx1, by1] = project(CAMPUS_BBOX.north, CAMPUS_BBOX.east) as [number, number];
const trees: number[] = [];
for (const f of fPoints) {
  if (f.properties.kind !== 'tree') continue;
  const [x, y] = xy(f.geometry.coordinates);
  // A mapped tree inside a building footprint is a data error; skip it.
  if (buildings.some((b) => b.solid && Math.abs(b.centre[0] - x) < 150 && Math.abs(b.centre[1] - y) < 150 && b.polygons.some((poly) => pointInPolygon(x, y, poly)))) continue;
  trees.push(x, y);
}

// -------------------------------------------------------------- route graph
const BUSY = new Set(['secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'primary', 'primary_link']);
const EDGE_KIND: Record<string, EdgeKind> = {
  footway: 'footway', sidewalk: 'sidewalk', crossing: 'crossing', path: 'path', track: 'path', cycleway: 'path',
  pedestrian: 'footway', steps: 'steps', platform: 'footway', service: 'service', parking_aisle: 'service', road: 'street',
};
const CROSSING_WAIT = 3; // seconds per mapped road crossing

const ways: WayInput[] = [];
for (const f of fPaths) {
  const p = f.properties;
  if (!['outdoor', 'covered', 'passage'].includes(p.env)) continue; // Phase 1: above ground, outside
  const kind = EDGE_KIND[p.kind];
  if (!kind || p.foot === 'no') continue;
  const footOk = ['yes', 'designated', 'permissive'].includes(p.foot);
  if ((p.access === 'no' || p.access === 'private') && !footOk) continue;
  if (p.kind === 'road' && BUSY.has(p.highway) && !footOk) continue; // use the sidewalks
  const plaza = Boolean(p.area) && p.kind === 'pedestrian';
  ways.push({
    id: f.id,
    nodes: p.nodes,
    coords: (f.geometry.coordinates as [number, number][]).map(xy),
    kind: plaza ? 'plaza' : kind,
    env: p.env === 'outdoor' ? 'outdoor' : 'covered',
    level: 0,
    ...(p.name ? { name: p.name } : {}),
    ...(p.kind === 'crossing' ? { penalty: CROSSING_WAIT } : {}),
    ...(plaza ? { plaza: true } : {}),
  });
}

const PUBLIC_DOOR = new Set(['yes', 'main', 'secondary', 'staircase', 'home']);
const doors: DoorInput[] = [];
for (const f of fEntrances) {
  const p = f.properties;
  if (!p.building || !buildingById.has(p.building) || !PUBLIC_DOOR.has(p.kind)) continue;
  if (p.access === 'private' || p.access === 'no') continue;
  let [x, y] = xy(f.geometry.coordinates);
  // Entrances mapped slightly inside or outside the footprint are moved onto
  // the wall, so the connector to the nearest path starts outside the building.
  let best = 4;
  for (const poly of buildingById.get(p.building)!.polygons) for (const ring of poly) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const c = closestOnSegment(x, y, ring[i], ring[i + 1], ring[j], ring[j + 1]);
      if (c.dist < best) {
        best = c.dist;
        [x, y] = [r2(c.x), r2(c.y)];
      }
    }
  }
  doors.push({ building: p.building, node: p.node, x, y, doorKind: p.kind, ...(p.name ? { name: p.name } : {}) });
}

const outlineOf = (b: Building): OutlineInput => ({ building: b.id, rings: b.polygons.map((poly) => ringPts(poly[0])) });
const needDoors = buildings.filter((b) => b.solid && b.campus && (b.code || b.area >= 60)).map(outlineOf);
const walls = buildings.filter((b) => b.solid).flatMap((b) => b.polygons.flatMap((poly) => poly.map(ringPts)));

// ------------------------------------------------------------------ indoor
// Hallways, tunnels, bridges and stairs from WATIsGrass (GPL-3.0), see
// data/indoor/watisgrass/. OSM's own partial indoor mapping is not mixed in:
// one consistent network is worth more than two that do not join up.
const readIndoor = async (name: string) => JSON.parse(await readFile(resolve(root, 'data/indoor/watisgrass', name), 'utf8')).features;
const indoor = parseWatIsGrass(await readIndoor('paths.json'), await readIndoor('buildings.json'), (lon, lat) => xy([lon, lat]));

// Which OSM building is each WATIsGrass code? Decided by where its nodes
// actually are, with the code itself as the fallback.
const containing = (x: number, y: number) =>
  buildings.find((b) => b.kind !== 'roof' && Math.abs(b.centre[0] - x) < 250 && Math.abs(b.centre[1] - y) < 250 && b.polygons.some((poly) => pointInPolygon(x, y, poly)));
const codeToBuilding = new Map<string, Building>();
const indoorMatches: Record<string, string> = {};
for (const code of indoor.report.codes) {
  const votes = new Map<Building, number>();
  for (const n of indoor.nodes) {
    if (n.code !== code) continue;
    const b = containing(n.x, n.y);
    if (b) votes.set(b, (votes.get(b) ?? 0) + 1);
  }
  const byName = buildings.find((b) => b.campus && (b.code === code || b.aliases?.includes(code)));
  // A building that carries the code wins; otherwise go by where the nodes are (DP is LIB in OSM, EXP is AHS).
  const best = [...votes.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
  const pick = byName ?? best;
  if (!pick) continue;
  codeToBuilding.set(code, pick);
  indoorMatches[code] = pick.code ?? pick.name ?? pick.id;
  // Make the code people use indoors searchable too (DP for the library, EXP for the AHS expansion).
  if (pick.code !== code && !(pick.aliases ?? []).includes(code)) pick.aliases = [...(pick.aliases ?? []), code];
}
for (const n of indoor.nodes) n.building = codeToBuilding.get(n.code)?.id;

const built = buildGraph(ways, doors, { needDoors, walls, indoor });
for (const [id, list] of Object.entries(built.doors)) buildingById.get(id)!.doors = list;
for (const [code, list] of Object.entries(built.anchors)) {
  const b = codeToBuilding.get(code);
  if (b) b.anchors = [...new Set([...b.anchors, ...list])];
}
const graph = new RouteGraph(built.graph);

// ---------------------------------------------------------------- wall gaps
// Where a walkable path runs through a building (tunnel=building_passage) the
// collider needs an opening, or the player would be stopped by a wall the map
// says they can walk through.
// The same goes for breezeways and arcades that mappers drew as ordinary
// footways through a footprint (PAS, EIT, V1). Rule: wherever a surveyed path
// in the route graph crosses a solid wall, the wall gets an opening, so the
// router and the collider always agree about where you can walk.
const wallGaps: number[] = [];
const solidRings = buildings
  .filter((b) => b.solid)
  .flatMap((b) => b.polygons.flatMap((poly) => poly.map((ring) => ({ ring, poly }))))
  .map(({ ring, poly }) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]);
      y0 = Math.min(y0, ring[i + 1]);
      x1 = Math.max(x1, ring[i]);
      y1 = Math.max(y1, ring[i + 1]);
    }
    return { ring, poly, x0, y0, x1, y1 };
  });
for (const e of built.graph.edges) {
  if (e.source !== 'osm' || e.kind === 'plaza') continue;
  const line = e.geometry;
  const total = polylineLength(line);
  const radius = e.kind === 'service' || e.kind === 'street' ? 3.2 : 2.2;
  let before = 0;
  for (let k = 2; k < line.length; k += 2) {
    const ax = line[k - 2], ay = line[k - 1], bx = line[k], by = line[k + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    for (const r of solidRings) {
      if (Math.max(ax, bx) < r.x0 || Math.min(ax, bx) > r.x1 || Math.max(ay, by) < r.y0 || Math.min(ay, by) > r.y1) continue;
      const ring = r.ring;
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        const t = segmentIntersection(ax, ay, bx, by, ring[i], ring[i + 1], ring[j], ring[j + 1]);
        if (t === null) continue;
        // A real crossing has the path outside the footprint on one side of the
        // wall and inside on the other. Paths that only touch the wall (a shared
        // node, a door they stop at) do not count.
        const s = before + t * segLen;
        const probe = (d: number): boolean => {
          if (s + d < 0 || s + d > total) return false;
          const [px, py] = slicePolyline(line, s + d, s + d);
          return pointInPolygon(px, py, r.poly);
        };
        if (probe(-0.5) !== probe(0.5)) wallGaps.push(r2(ax + (bx - ax) * t), r2(ay + (by - ay) * t), radius);
      }
    }
    before += segLen;
  }
}

// ------------------------------------------------------------------- places
const places: NamedPlace[] = [];
for (const p of overrides.places ?? []) {
  let [x, y] = xy([p.lon, p.lat]);
  if (p.building) {
    // Snap to that building's nearest door so routes start exactly at it.
    let best = Infinity;
    for (const id of buildingById.get(p.building)?.doors ?? []) {
      const n = built.graph.nodes[id];
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < best && d < 30) {
        best = d;
        [x, y] = [n.x, n.y];
      }
    }
  }
  places.push({ id: p.id, label: p.label, ...(p.sub ? { sub: p.sub } : {}), ...(p.aliases ? { aliases: p.aliases } : {}), x, y, ...(p.building ? { building: p.building } : {}) });
}

// -------------------------------------------------------------------- spawn
// A few metres along the path leading away from the spawn place, facing along it.
let spawn: [number, number, number] = [0, 0, 0];
const spawnPlace = places.find((p) => p.id === (overrides.spawn ?? '')) ?? places[0];
if (spawnPlace) {
  spawn = [spawnPlace.x, spawnPlace.y, 0];
  // Stand a little way down the path that leads towards the middle of campus,
  // facing along it, so the first view is open ground rather than a wall.
  const towards = buildings.find((b) => b.code === 'MC');
  const lead = towards && graph.route({ type: 'point', x: spawnPlace.x, y: spawnPlace.y }, { type: 'nodes', nodes: towards.doors }, outdoorProfile);
  if (lead && lead.length > 30) {
    const [px, py] = slicePolyline(lead.points, 14, 14);
    const [qx, qy] = slicePolyline(lead.points, 22, 22);
    spawn = [r2(px), r2(py), +Math.atan2(qx - px, qy - py).toFixed(3)];
  }
}

// ------------------------------------------------------------------- output
const campus: CampusData = {
  meta: {
    origin: CAMPUS_ORIGIN,
    bounds: [r2(bx0), r2(by0), r2(bx1), r2(by1)],
    osmTimestamp: summary.osmTimestamp,
    bakedAt: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors',
    indoorAttribution: 'Indoor routes: WATIsGrass (GPL-3.0)',
  },
  buildings,
  areas,
  ribbons,
  trees,
  wallGaps,
  graph: built.graph,
  places,
  spawn,
};

const outFile = resolve(root, 'public/data/campus.json');
await mkdir(dirname(outFile), { recursive: true });
const json = JSON.stringify(campus);
await writeFile(outFile, json);

const coded = buildings.filter((b) => b.code);
const report = {
  file: 'public/data/campus.json',
  megabytes: +(json.length / 1e6).toFixed(2),
  buildings: buildings.length,
  campusBuildings: buildings.filter((b) => b.campus).length,
  solidBuildings: buildings.filter((b) => b.solid).length,
  buildingsWithParts: buildings.filter((b) => b.parts).length,
  codedWithoutDoor: coded.filter((b) => !b.doors.length).map((b) => b.code),
  areas: areas.length,
  ribbons: ribbons.length,
  trees: trees.length / 2,
  wallGaps: wallGaps.length / 3,
  indoor: {
    ...indoor.report,
    codes: indoor.report.codes.length,
    matchedToOsm: indoorMatches,
    unmatched: indoor.report.codes.filter((c) => !codeToBuilding.has(c)),
    buildingsWithAnchors: buildings.filter((b) => b.anchors.length).length,
    edgesByKind: built.graph.edges.filter((e) => e.env === 'indoor').reduce((m: Record<string, number>, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {}),
  },
  places: places.map((p) => p.label),
  spawn,
  graph: { ...built.report, mainShare: +built.report.mainShare.toFixed(4), droppedKm: +built.report.droppedKm.toFixed(2), totalKm: +built.report.totalKm.toFixed(1) },
};
await writeFile(resolve(root, 'data/reports/bake-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
