import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CampusData } from '../data/types';
import type { Pt } from '../lib/geom';
import { summarise } from '../ui/directions';
import { buildGraph, type WayInput } from './build';
import { RouteGraph } from './graph';
import { parseWatIsGrass, SECONDS_PER_FLOOR } from './indoor';
import { PlaceIndex } from './places';
import { indoorOnlyProfile, leastOutdoorProfile, outdoorProfile, preferIndoorProfile, WALK_SPEED } from './profiles';

// ------------------------------------------------------------------ fixture
// Two buildings 100 m apart, in "degrees" that the test projection scales to metres.
//
//   A: door at x=0, hallway on floor 1 to x=10, stairs down to the basement at x=10
//   tunnel from A's basement (x=10) to B's basement (x=90), with a bend
//   B: stairs at x=90, hallway on floor 1 to x=100, door at x=100
//   C: a hallway with no exit and no link to anything
//   An outdoor path runs past both doors, 300 m the long way round.
const bf = (buildingCode: string, floor: string) => ({ buildingCode, floor });
const line = (type: string, start: object, end: object, coordinates: number[][]) => ({ geometry: { type: 'LineString', coordinates }, properties: { type, start, end } });
const point = (properties: object, coordinates: number[]) => ({ geometry: { type: 'Point', coordinates }, properties });
const paths = [
  line('hallway', bf('A', '1'), bf('A', '1'), [[0, 0], [5, 0], [10, 0]]),
  point({ type: 'stairs', connections: [{ ...bf('A', '1'), level: 1 }, { ...bf('A', 'B'), level: 0 }] }, [10, 0]),
  line('tunnel', bf('A', 'B'), bf('B', 'B'), [[10, 0], [50, 8], [90, 0]]),
  point({ type: 'stairs', connections: [{ ...bf('B', 'B'), level: 0 }, { ...bf('B', '1'), level: 1 }] }, [90, 0]),
  line('hallway', bf('B', '1'), bf('B', '1'), [[90, 0], [100, 0]]),
  point({ type: 'door', start: bf('A', '1'), end: bf('OUT', '0') }, [0, 0]),
  point({ type: 'door', start: bf('OUT', '0'), end: bf('B', '1') }, [100, 0]),
  line('walkway', bf('OUT', '0'), bf('OUT', '0'), [[0, 0], [100, 0]]),
  line('hallway', bf('C', '1'), bf('C', '1'), [[200, 200], [210, 200]]),
];
const buildings = [
  point({ type: 'building', building: { buildingCode: 'A', floors: ['1'] } }, [5, 0]),
  point({ type: 'building', building: { buildingCode: 'B', floors: ['1', '7'] } }, [100, 0]),
];
const indoor = parseWatIsGrass(paths, buildings, (lon, lat) => [lon, lat]);
const outdoorWay: WayInput = { id: 'path', nodes: [1, 2, 3, 4], coords: [[0, -3], [0, -100], [100, -100], [100, -3]] as Pt[], kind: 'footway', env: 'outdoor', level: 0 };
const built = buildGraph([outdoorWay], [], { indoor });
const g = new RouteGraph(built.graph);
const A = { type: 'nodes' as const, nodes: built.anchors.A };
const B = { type: 'nodes' as const, nodes: built.anchors.B };

describe('WATIsGrass import', () => {
  it('reads hallways, tunnels, stairs and doors, and leaves outdoor walkways out', () => {
    expect(indoor.report).toMatchObject({ hallways: 3, tunnels: 1, bridges: 0, stairwells: 2, doorsOutside: 2, skippedWalkways: 1 });
    expect(indoor.exits.map((e) => e.code).sort()).toEqual(['A', 'B']);
  });

  it('works out floor heights from the stairwells: floors with a door outside are ground level', () => {
    const level = (code: string, floor: string) => indoor.nodes.find((n) => n.code === code && n.floor === floor)!.level;
    expect(level('A', '1')).toBe(0);
    expect(level('A', 'B')).toBe(-1);
    expect(level('B', 'B')).toBe(-1);
    expect(level('B', '1')).toBe(0);
  });

  it('only keeps anchors that exist in the network', () => {
    expect(indoor.anchors.map((a) => `${a.code}${a.floor}`)).toEqual(['A1', 'B1']);
    expect(indoor.report.anchorsDropped).toBe(1); // B floor 7 has no hallway
  });

  it('joins exits to the outdoor network and drops indoor pieces that lead nowhere', () => {
    expect(built.report.indoor).toMatchObject({ exitsSnapped: 2, exitsDropped: 0, unreachableMetres: 10 });
    expect(built.graph.nodes.some((n) => n.code === 'C')).toBe(false);
    expect(built.graph.edges.filter((e) => e.kind === 'door' && e.env === 'indoor')).toHaveLength(2);
  });

  it('keeps a tunnel as one edge, underground', () => {
    const tunnels = built.graph.edges.filter((e) => e.kind === 'tunnel');
    expect(tunnels).toHaveLength(1);
    const t = tunnels[0];
    expect(t.source).toBe('watisgrass');
    expect(t.level).toBe(-1);
    expect(Math.min(...(t.elev ?? [t.level]))).toBe(-1); // basement to basement: already underground, so level
    expect(t.length).toBeCloseTo(2 * Math.hypot(40, 8), 0);
  });

  it('charges stairs by the floor', () => {
    const stairs = built.graph.edges.filter((e) => e.kind === 'stairs');
    expect(stairs).toHaveLength(2);
    expect(stairs.every((e) => e.penalty === SECONDS_PER_FLOOR && e.length === 0)).toBe(true);
    expect(stairs.map((e) => [e.level, e.levelTo].sort())).toEqual([[-1, 0], [-1, 0]]);
  });
});

describe('routing over the indoor network', () => {
  it('outdoor mode never enters, even from inside a building', () => {
    const r = g.route({ type: 'point', x: 0, y: -3 }, { type: 'point', x: 100, y: -3 }, outdoorProfile)!;
    expect(r.links.every((l) => l.env !== 'indoor')).toBe(true);
    expect(r.length).toBeCloseTo(97 + 100 + 97, 0);
    expect(g.route(A, B, outdoorProfile)).toBeNull(); // anchors are indoors: unreachable without going inside
  });

  it('indoor-only goes hallway, stairs, tunnel, stairs, hallway', () => {
    const r = g.route(A, B, indoorOnlyProfile())!;
    expect(r.links.map((l) => l.kind)).toEqual(['corridor', 'stairs', 'tunnel', 'stairs', 'corridor']);
    expect(r.links.every((l) => l.env === 'indoor')).toBe(true);
    const walked = 5 + 2 * Math.hypot(40, 8) + 10;
    expect(r.seconds).toBeCloseTo(walked / WALK_SPEED + 2 * SECONDS_PER_FLOOR, 0);
    // The line follows the floors: ground, down, under, up, ground.
    expect(r.elev[0]).toBe(0);
    expect(Math.min(...r.elev)).toBe(-1);
    expect(r.elev[r.elev.length - 1]).toBe(0);
    expect(r.inside.every((v) => v === 1)).toBe(true);
    expect(r.points.length / 2).toBe(r.elev.length);
  });

  it('prefer-indoor takes the tunnel between points outside each door', () => {
    const r = g.route({ type: 'point', x: 0, y: -3 }, { type: 'point', x: 100, y: -3 }, preferIndoorProfile())!;
    expect(r.links.some((l) => l.kind === 'tunnel')).toBe(true);
    expect(r.links.filter((l) => l.kind === 'door')).toHaveLength(2);
    expect(r.inside[0]).toBe(0);
    expect(r.inside.includes(1)).toBe(true);
  });

  it('a point on the ground never attaches to a hallway underneath it', () => {
    const s = g.snap(50, 7, 200)!;
    expect(s.edge.env).not.toBe('indoor');
  });

  it('describes the route in steps', () => {
    const r = g.route({ type: 'point', x: 0, y: -3 }, { type: 'point', x: 100, y: -3 }, preferIndoorProfile())!;
    const s = summarise(r, built.graph.nodes);
    expect(s.steps.map((x) => x.kind)).toEqual(['outside', 'enter', 'hall', 'stairs', 'tunnel', 'stairs', 'hall', 'leave', 'outside']);
    expect(s.steps.find((x) => x.kind === 'tunnel')!.text).toBe('Tunnel to B floor B');
    expect(s.floorsUp).toBe(1);
    expect(s.floorsDown).toBe(1);
    expect(s.outsideMetres).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------- real data
const campus: CampusData = JSON.parse(readFileSync(new URL('../../public/data/campus.json', import.meta.url), 'utf8'));
const graph = new RouteGraph(campus.graph);
const places = new PlaceIndex(campus.buildings, campus.places);
const between = (from: string, to: string, profile = indoorOnlyProfile()) => {
  const a = places.resolve(from)!, b = places.resolve(to)!;
  return graph.route(places.endpoint(a)!, places.endpoint(b)!, profile);
};
const outside = (r: NonNullable<ReturnType<typeof between>>) => r.links.filter((l) => l.env !== 'indoor').reduce((s, l) => s + l.length, 0);

describe('campus indoor network', () => {
  const indoorEdges = campus.graph.edges.filter((e) => e.env === 'indoor');

  it('has no dead ends: every stairwell and hallway is on a way between doors, tunnels and bridges', () => {
    const degree = new Map<number, number>();
    for (const e of campus.graph.edges) for (const n of [e.a, e.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
    const link = new Set<number>();
    for (const e of indoorEdges) {
      const a = campus.graph.nodes[e.a], b = campus.graph.nodes[e.b];
      if (e.kind === 'tunnel' || e.kind === 'skywalk' || (a.code && b.code && a.code !== b.code)) link.add(e.a).add(e.b);
    }
    const stranded = campus.graph.nodes.filter((n) => n.code && degree.get(n.id) === 1 && !link.has(n.id));
    expect(stranded).toEqual([]);
  });

  it('has the whole WATIsGrass network, credited', () => {
    expect(indoorEdges.every((e) => e.source === 'watisgrass')).toBe(true);
    expect(indoorEdges.filter((e) => e.kind === 'tunnel')).toHaveLength(10);
    expect(indoorEdges.filter((e) => e.kind === 'skywalk')).toHaveLength(12);
    expect(indoorEdges.reduce((s, e) => s + e.length, 0)).toBeGreaterThan(4500);
    expect(campus.meta.indoorAttribution).toMatch(/WATIsGrass/);
    // Buildings that only had dead-end hallways are no longer "indoors" on the 3D network: their floors are the floor plans' job.
    expect(campus.buildings.filter((b) => b.anchors.length).length).toBeGreaterThan(30);
  });

  it('draws every tunnel below ground and every bridge above it', () => {
    for (const e of indoorEdges) {
      const heights = e.elev ?? [e.level];
      if (e.kind === 'tunnel') expect(Math.min(...heights)).toBeLessThan(0);
      if (e.kind === 'skywalk') expect(Math.max(...heights)).toBeGreaterThanOrEqual(1);
    }
  });

  it('accepts the codes students use indoors', () => {
    expect(places.resolve('DP')!.label).toBe('LIB');
    expect(places.resolve('EXP')!.label).toBe('AHS');
  });

  it.each([['MC', 'DC'], ['MC', 'RCH 101'], ['PAC', 'E3'], ['EV1', 'SCH'], ['SLC', 'E7'], ['DC', 'E5']])('%s to %s can be walked entirely indoors', (from, to) => {
    const r = between(from, to)!;
    expect(r).not.toBeNull();
    expect(outside(r)).toBe(0);
    expect(r.inside.every((v) => v === 1)).toBe(true);
    expect(r.seconds / 60).toBeLessThan(15);
  });

  it('MC to RCH indoors uses tunnels and bridges, and says so', () => {
    const r = between('MC', 'RCH')!;
    const s = summarise(r, campus.graph.nodes);
    expect(s.steps.some((x) => x.kind === 'tunnel')).toBe(true);
    expect(s.steps.some((x) => x.kind === 'bridge')).toBe(true);
    expect(s.floorsUp + s.floorsDown).toBeGreaterThan(2);
    expect(campus.graph.nodes[r.endNode!].code).toBe('RCH');
  });

  it('REV to RCH has no fully indoor route, and the fallback spends less time outside than the outdoor route', () => {
    expect(between('REV West Quad', 'RCH 101')).toBeNull();
    const least = between('REV West Quad', 'RCH 101', leastOutdoorProfile)!;
    const direct = between('REV West Quad', 'RCH 101', outdoorProfile)!;
    expect(outside(least)).toBeLessThan(outside(direct) * 0.8);
    expect(outside(direct)).toBeCloseTo(direct.length, 0);
  });

  it('prefer-indoor never spends more time outside than the outdoor route', () => {
    for (const [from, to] of [['MC', 'E7'], ['DC', 'SLC'], ['V1', 'QNC'], ['CPH', 'DC'], ['QNC', 'STC']]) {
      const prefer = between(from, to, preferIndoorProfile())!;
      const direct = between(from, to, outdoorProfile)!;
      expect(outside(prefer)).toBeLessThanOrEqual(outside(direct) + 1);
    }
  });
});
