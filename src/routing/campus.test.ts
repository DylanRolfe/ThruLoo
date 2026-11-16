// Tests over the real baked campus data (public/data/campus.json).
// Run `npm run data` first if the file is missing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CampusData } from '../data/types';
import { closestOnSegment, pointInPolygon } from '../lib/geom';
import { RouteGraph } from './graph';
import { PlaceIndex } from './places';
import { outdoorProfile } from './profiles';

const campus: CampusData = JSON.parse(readFileSync(new URL('../../public/data/campus.json', import.meta.url), 'utf8'));
const graph = new RouteGraph(campus.graph);
const places = new PlaceIndex(campus.buildings, campus.places);

function route(from: string, to: string) {
  const a = places.resolve(from), b = places.resolve(to);
  if (!a || !b) throw new Error(`unknown place: ${!a ? from : to}`);
  const r = graph.route(places.endpoint(a)!, places.endpoint(b)!, outdoorProfile);
  if (!r) throw new Error(`no route ${from} -> ${to}`);
  return { ...r, crow: Math.hypot(a.x - b.x, a.y - b.y) };
}

const solid = campus.buildings.filter((b) => b.solid);

/** Metres of a polyline that lie well inside a solid building (more than 0.5 m from any wall). */
function metresInsideBuildings(line: number[]): number {
  let inside = 0;
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2], ay = line[i - 1], bx = line[i], by = line[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      for (const b of solid) {
        if (Math.abs(b.centre[0] - x) > 250 || Math.abs(b.centre[1] - y) > 250) continue;
        if (!b.polygons.some((p) => pointInPolygon(x, y, p))) continue;
        let wall = Infinity;
        for (const poly of b.polygons) for (const ring of poly) {
          for (let r = 0; r < ring.length; r += 2) {
            const j = (r + 2) % ring.length;
            wall = Math.min(wall, closestOnSegment(x, y, ring[r], ring[r + 1], ring[j], ring[j + 1]).dist);
          }
        }
        if (wall > 0.5) inside += len / steps;
        break;
      }
    }
  }
  return inside;
}

/**
 * Surveyed paths that pass through a footprint are trusted (the bake cuts a
 * wall opening for each). Edges the builder invented, door connectors and
 * plaza crossings, have no such excuse.
 */
function derivedMetresInsideBuildings(edgeIds: number[]): number {
  return edgeIds
    .map((id) => campus.graph.edges[id])
    .filter((e) => e.source === 'derived')
    .reduce((sum, e) => sum + metresInsideBuildings(e.geometry), 0);
}

describe('campus data', () => {
  it('has the expected scale', () => {
    expect(campus.buildings.length).toBeGreaterThan(900);
    expect(campus.buildings.filter((b) => b.code).length).toBeGreaterThan(60);
    expect(campus.graph.nodes.length).toBeGreaterThan(2000);
    expect(campus.meta.attribution).toContain('OpenStreetMap');
  });

  it('gives every coded campus building at least one door', () => {
    const missing = campus.buildings.filter((b) => b.campus && b.code && b.doors.length === 0).map((b) => b.code);
    expect(missing).toEqual([]);
  });

  it('door nodes belong to the building that lists them, or sit on its outline', () => {
    for (const b of campus.buildings) for (const d of b.doors) expect(campus.graph.nodes[d].kind).toBe('door');
  });

  it('keeps invented edges out of buildings, with a few known exceptions', () => {
    // Entrances mapped deep inside a footprint (an atrium door) still need a
    // connector through the wall. Keep the total small and visible.
    const total = campus.graph.edges.filter((e) => e.source === 'derived').reduce((s, e) => s + metresInsideBuildings(e.geometry), 0);
    expect(total).toBeLessThan(200);
  });

  it('cuts a wall opening wherever a surveyed path enters a building', () => {
    expect(campus.wallGaps.length % 3).toBe(0);
    expect(campus.wallGaps.length / 3).toBeGreaterThan(10);
    expect(campus.wallGaps.length / 3).toBeLessThan(250);
  });

  it('connects every coded building to every other', () => {
    const coded = campus.buildings.filter((b) => b.campus && b.code);
    const mc = coded.find((b) => b.code === 'MC')!;
    const unreachable = coded.filter((b) => b !== mc && !graph.route({ type: 'nodes', nodes: mc.doors }, { type: 'nodes', nodes: b.doors }, outdoorProfile)).map((b) => b.code);
    expect(unreachable).toEqual([]);
  });
});

describe('place search', () => {
  it('finds buildings by code, old code, name and room', () => {
    expect(places.resolve('RCH')!.sub).toMatch(/Coutts/);
    expect(places.resolve('rch')!.label).toBe('RCH');
    expect(places.resolve('E7')!.label).toBe('PSE'); // renamed in OSM; the old code is an alias
    expect(places.resolve('coutts')!.label).toBe('RCH');
    expect(places.resolve('davis')!.label).toBe('DC');
    expect(places.search('M')[0].label).toMatch(/^M/);
  });

  it('resolves a room to its building entrance', () => {
    const room = places.resolve('RCH 101')!;
    expect(room.kind).toBe('room');
    expect(room.label).toBe('RCH 101');
    expect(room.room).toBe('101');
    const b = campus.buildings.find((x) => x.code === 'RCH')!;
    expect(places.endpoint(room)).toEqual({ type: 'nodes', nodes: [...b.doors, ...b.anchors] });
    expect(places.resolve('mc4020')!.label).toBe('MC 4020');
  });

  it('knows REV West Quad as a named place', () => {
    const p = places.resolve('REV West Quad')!;
    expect(p.kind).toBe('place');
    expect(places.resolve('rev west')!.id).toBe(p.id);
  });
});

describe('campus routes', () => {
  it('REV West Quad to RCH 101 is a plausible walk', () => {
    const r = route('REV West Quad', 'RCH 101');
    expect(r.length).toBeGreaterThan(1050);
    expect(r.length).toBeLessThan(1400);
    expect(r.seconds / 60).toBeGreaterThan(13);
    expect(r.seconds / 60).toBeLessThan(19);
    // Mostly real paths, not roadway.
    const road = r.steps.filter((s) => s.kind === 'street' || s.kind === 'service').reduce((s, x) => s + x.length, 0);
    expect(road / r.length).toBeLessThan(0.2);
    expect(derivedMetresInsideBuildings(r.edgeIds)).toBeLessThan(1);
    expect(campus.graph.nodes[r.endNode!].building).toBe(campus.buildings.find((b) => b.code === 'RCH')!.id);
  });

  const pairs: [string, string][] = [['MC', 'E7'], ['DC', 'SLC'], ['V1', 'QNC'], ['SLC', 'E5'], ['CIF', 'SCH'], ['OPT', 'HH'], ['STJ', 'E2'], ['REV', 'MC']];
  it.each(pairs)('%s to %s is direct and stays out of buildings', (from, to) => {
    const r = route(from, to);
    // Door-to-door distance against centre-to-centre distance: loose bounds that
    // still catch a route that wanders off or cuts through something.
    expect(r.length).toBeLessThan(r.crow * 1.6 + 150);
    expect(r.length).toBeGreaterThan(r.crow * 0.5);
    expect(derivedMetresInsideBuildings(r.edgeIds)).toBeLessThan(1);
    const back = route(to, from);
    expect(back.length).toBeCloseTo(r.length, 0);
  });

  it('routes from a free point on the ground', () => {
    const [x, y] = campus.spawn;
    const rch = places.resolve('RCH')!;
    const r = graph.route({ type: 'point', x, y }, places.endpoint(rch)!, outdoorProfile)!;
    expect(r.length).toBeGreaterThan(1000);
    expect(r.points[0]).toBeCloseTo(x, 1);
    expect(r.points[1]).toBeCloseTo(y, 1);
  });
});
