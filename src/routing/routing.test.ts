import { describe, expect, it } from 'vitest';
import { hash01, pointInPolygon, polylineLength, slicePolyline, type Pt } from '../lib/geom';
import { buildGraph, type WayInput } from './build';
import { RouteGraph } from './graph';
import { indoorOnlyProfile, outdoorProfile, preferIndoorProfile, WALK_SPEED } from './profiles';
import type { GraphData, GraphEdge, GraphNode } from './types';

const way = (id: string, nodes: number[], coords: Pt[], extra: Partial<WayInput> = {}): WayInput => ({
  id, nodes, coords, kind: 'footway', env: 'outdoor', level: 0, ...extra,
});

describe('geometry helpers', () => {
  it('slices a polyline by distance', () => {
    const line = [0, 0, 10, 0, 10, 10];
    expect(slicePolyline(line, 0, 20)).toEqual(line);
    expect(slicePolyline(line, 5, 15)).toEqual([5, 0, 10, 0, 10, 5]);
    expect(polylineLength(slicePolyline(line, 2.5, 17.5))).toBeCloseTo(15);
  });

  it('tests points against polygons with holes', () => {
    const poly = [[0, 0, 10, 0, 10, 10, 0, 10], [4, 4, 6, 4, 6, 6, 4, 6]];
    expect(pointInPolygon(2, 2, poly)).toBe(true);
    expect(pointInPolygon(5, 5, poly)).toBe(false);
    expect(pointInPolygon(12, 5, poly)).toBe(false);
  });
});

describe('buildGraph', () => {
  //   4
  //   |
  // 1-2-----3==5        6-7 (isolated fragment)
  const ways = [
    way('A', [1, 2, 3], [[0, 0], [100, 0], [200, 0]]),
    way('B', [2, 4], [[100, 0], [100, 100]]),
    way('C', [3, 5], [[200, 0], [300, 0]], { kind: 'steps' }),
    way('D', [6, 7], [[500, 500], [510, 500]]),
  ];
  const doors = [
    { building: 'X', node: 1, x: 0, y: 0, doorKind: 'main' },
    { building: 'Y', x: 150, y: 20, doorKind: 'yes' },
    { building: 'Y', node: 5, x: 300, y: 0, doorKind: 'main' },
    { building: 'Lost', node: 6, x: 500, y: 500, doorKind: 'yes' },
  ];
  const z: Pt[] = [[110, 90], [130, 90], [130, 110], [110, 110]];
  const { graph, doors: doorMap, report } = buildGraph(ways, doors, { needDoors: [{ building: 'Z', rings: [z] }], walls: [z] });
  const g = new RouteGraph(graph);

  it('keeps only the main component', () => {
    expect(report.components).toBe(2);
    expect(report.droppedKm).toBeCloseTo(0.01);
    expect(graph.nodes.some((n) => n.x === 500)).toBe(false);
  });

  it('contracts chains but splits where the edge kind changes', () => {
    const steps = graph.edges.filter((e) => e.kind === 'steps');
    expect(steps).toHaveLength(1);
    expect(steps[0].length).toBeCloseTo(100);
    // Node 3 has degree 2 but joins a footway to steps, so it must survive.
    expect(graph.nodes.some((n) => n.x === 200 && n.y === 0)).toBe(true);
  });

  it('uses an entrance that is already a path node directly', () => {
    const n = graph.nodes[doorMap.X[0]];
    expect([n.x, n.y, n.kind, n.building, n.doorKind]).toEqual([0, 0, 'door', 'X', 'main']);
  });

  it('snaps an off-network entrance onto the nearest path with a connector', () => {
    const connector = graph.edges.find((e) => e.kind === 'connector' && e.geometry[0] === 150 || e.kind === 'connector' && e.geometry[2] === 150);
    expect(connector).toBeDefined();
    expect(connector!.length).toBeCloseTo(20);
    expect(connector!.source).toBe('derived');
  });

  it('orders doors main first and re-attaches fragment doors to the main network', () => {
    expect(graph.nodes[doorMap.Y[0]].doorKind).toBe('main');
    expect(doorMap.Y).toHaveLength(2);
    // The mapped entrance of "Lost" sits on the dropped fragment, far from everything.
    expect(doorMap.Lost).toBeUndefined();
    expect(report.doorsDropped).toBe(1);
  });

  it('synthesises a door for a building with none, on the side facing the path', () => {
    expect(report.doorsSynthetic).toBe(1);
    const n = graph.nodes[doorMap.Z[0]];
    expect(n.doorKind).toBe('synthetic');
    expect(n.x).toBeCloseTo(110); // west wall, 10 m from the north-south path at x = 100
  });

  it('routes door to door through the snapped connector', () => {
    const r = g.route({ type: 'nodes', nodes: doorMap.X }, { type: 'nodes', nodes: doorMap.Y }, outdoorProfile)!;
    expect(r.length).toBeCloseTo(170); // 150 along the path + 20 connector, not 300 to the main door
    expect(r.seconds).toBeCloseTo(170 / WALK_SPEED);
    expect(r.points.slice(0, 2)).toEqual([0, 0]);
    expect(r.points.slice(-2)).toEqual([150, 20]);
  });

  it('routes between free points, including two points on the same edge', () => {
    const r = g.route({ type: 'point', x: 20, y: 5 }, { type: 'point', x: 100, y: 60 }, outdoorProfile)!;
    expect(r.length).toBeCloseTo(5 + 80 + 60);
    const same = g.route({ type: 'point', x: 20, y: 0 }, { type: 'point', x: 60, y: 0 }, outdoorProfile)!;
    expect(same.length).toBeCloseTo(40);
    const back = g.route({ type: 'point', x: 60, y: 0 }, { type: 'point', x: 20, y: 0 }, outdoorProfile)!;
    expect(back.length).toBeCloseTo(40);
    expect(back.points.slice(0, 2)).toEqual([60, 0]);
  });

  it('spreads a crossing penalty over the way and reports it in the time', () => {
    const built = buildGraph([way('A', [1, 2], [[0, 0], [50, 0]]), way('X', [2, 3], [[50, 0], [60, 0]], { kind: 'crossing', penalty: 3 }), way('B', [3, 4], [[60, 0], [100, 0]])], []);
    const crossing = built.graph.edges.find((e) => e.kind === 'crossing')!;
    expect(crossing.penalty).toBeCloseTo(3);
    const r = new RouteGraph(built.graph).route({ type: 'point', x: 0, y: 0 }, { type: 'point', x: 100, y: 0 }, outdoorProfile)!;
    expect(r.seconds).toBeCloseTo(100 / WALK_SPEED + 3);
  });

  it('adds crossing edges through a plaza', () => {
    // A 40 m square plaza with paths arriving at opposite corners.
    const ring: Pt[] = [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]];
    const built = buildGraph(
      [way('P', [1, 2, 3, 4, 1], ring, { kind: 'plaza', plaza: true }), way('in', [9, 1], [[-50, 0], [0, 0]]), way('out', [3, 8], [[40, 40], [90, 40]])],
      [],
    );
    expect(built.report.plazaEdges).toBe(1);
    const r = new RouteGraph(built.graph).route({ type: 'point', x: -50, y: 0 }, { type: 'point', x: 90, y: 40 }, outdoorProfile)!;
    expect(r.length).toBeCloseTo(50 + Math.hypot(40, 40) + 50, 1);
  });

  it('does not join ways on different floors that share a node position', () => {
    const built = buildGraph(
      [way('ground', [1, 2, 3], [[0, 0], [50, 0], [100, 0]]), way('tunnel', [10, 2, 11], [[50, -30], [50, 0], [50, 30]], { kind: 'tunnel', env: 'indoor', level: -1 })],
      [],
    );
    // The tunnel shares node 2 with the path but is on level -1: no connection, so it is a separate component.
    expect(built.report.components).toBe(2);
    expect(built.graph.edges.every((e) => e.level === 0)).toBe(true);
  });
});

describe('A* search', () => {
  it('matches brute-force shortest paths on a random graph', () => {
    const rnd = (i: number) => hash01('rnd', i);
    const N = 70;
    const nodes: GraphNode[] = Array.from({ length: N }, (_, id) => ({ id, x: rnd(id * 2) * 1000, y: rnd(id * 2 + 1) * 1000, level: 0, kind: 'junction' }));
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 190; i++) {
      const a = Math.floor(rnd(1000 + i * 3) * N), b = Math.floor(rnd(1001 + i * 3) * N);
      if (a === b) continue;
      // Some edges wander: geometry longer than the straight line.
      const bend = rnd(1002 + i * 3) < 0.4 ? 150 : 0;
      const mx = (nodes[a].x + nodes[b].x) / 2 + bend, my = (nodes[a].y + nodes[b].y) / 2;
      const geometry = [nodes[a].x, nodes[a].y, mx, my, nodes[b].x, nodes[b].y];
      edges.push({ id: edges.length, a, b, length: polylineLength(geometry), kind: i % 5 === 0 ? 'steps' : 'footway', env: 'outdoor', level: 0, geometry, source: 'osm' });
    }
    const g = new RouteGraph({ nodes, edges });

    // Floyd-Warshall over search cost.
    const d = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : Infinity)));
    for (const e of edges) {
      const c = outdoorProfile.cost(e);
      d[e.a][e.b] = Math.min(d[e.a][e.b], c);
      d[e.b][e.a] = Math.min(d[e.b][e.a], c);
    }
    for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];

    let checked = 0;
    for (let i = 0; i < N; i += 3) {
      for (let j = 1; j < N; j += 7) {
        const r = g.route({ type: 'nodes', nodes: [i] }, { type: 'nodes', nodes: [j] }, outdoorProfile);
        if (!Number.isFinite(d[i][j])) {
          expect(r).toBeNull();
          continue;
        }
        const cost = r!.edgeIds.reduce((s, id) => s + outdoorProfile.cost(edges[id]), 0);
        expect(cost).toBeCloseTo(d[i][j], 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('with several destination doors, stops at the one that is fastest to reach', () => {
    const nodes: GraphNode[] = [0, 100, 200, 300].map((x, id) => ({ id, x, y: 0, level: 0, kind: 'door' }));
    const edges: GraphEdge[] = [0, 1, 2].map((i) => ({ id: i, a: i, b: i + 1, length: 100, kind: 'footway', env: 'outdoor', level: 0, geometry: [i * 100, 0, (i + 1) * 100, 0], source: 'osm' }));
    const r = new RouteGraph({ nodes, edges }).route({ type: 'nodes', nodes: [0] }, { type: 'nodes', nodes: [3, 1] }, outdoorProfile)!;
    expect(r.endNode).toBe(1);
    expect(r.length).toBeCloseTo(100);
  });
});

describe('route modes (Phase 2 readiness)', () => {
  // Two buildings 100 m apart: a 300 m outdoor path around a pond, or a 120 m tunnel.
  const nodes: GraphNode[] = [
    { id: 0, x: 0, y: 0, level: 0, kind: 'door', building: 'A' },
    { id: 1, x: 100, y: 0, level: 0, kind: 'door', building: 'B' },
    { id: 2, x: 0, y: 0, level: -1, kind: 'stairs', building: 'A' },
    { id: 3, x: 100, y: 0, level: -1, kind: 'stairs', building: 'B' },
  ];
  const outdoor: GraphEdge = { id: 0, a: 0, b: 1, length: 300, kind: 'footway', env: 'outdoor', level: 0, geometry: [0, 0, 50, 140, 100, 0], source: 'osm' };
  const tunnel: GraphEdge[] = [
    { id: 1, a: 0, b: 2, length: 8, kind: 'stairs', env: 'indoor', level: 0, levelTo: -1, geometry: [0, 0, 0, 0], source: 'manual', building: 'A' },
    { id: 2, a: 2, b: 3, length: 104, kind: 'tunnel', env: 'indoor', level: -1, geometry: [0, 0, 100, 0], source: 'manual', name: 'A to B tunnel' },
    { id: 3, a: 3, b: 1, length: 8, kind: 'stairs', env: 'indoor', level: -1, levelTo: 0, geometry: [100, 0, 100, 0], source: 'manual', building: 'B' },
  ];
  const withTunnel: GraphData = { nodes, edges: [outdoor, ...tunnel] };
  const from = { type: 'nodes' as const, nodes: [0] };
  const to = { type: 'nodes' as const, nodes: [1] };

  it('outdoor mode ignores the tunnel even though it is shorter', () => {
    const r = new RouteGraph(withTunnel).route(from, to, outdoorProfile)!;
    expect(r.edgeIds).toEqual([0]);
    expect(r.steps.every((s) => s.env === 'outdoor')).toBe(true);
  });

  it('prefer-indoor mode takes the tunnel', () => {
    const r = new RouteGraph(withTunnel).route(from, to, preferIndoorProfile())!;
    expect(r.edgeIds).toEqual([1, 2, 3]);
    expect(r.length).toBeCloseTo(0 + 100 + 0); // drawn length; walked length is in the edges
    expect(r.steps.find((s) => s.kind === 'tunnel')!.length).toBeCloseTo(104);
  });

  it('prefer-indoor still goes outside when the indoor way is far longer', () => {
    const longTunnel = { ...tunnel[1], length: 2000 };
    const r = new RouteGraph({ nodes, edges: [outdoor, tunnel[0], longTunnel, tunnel[2]] }).route(from, to, preferIndoorProfile())!;
    expect(r.edgeIds).toEqual([0]);
  });

  it('indoor-only mode uses the tunnel, and fails cleanly when there is none', () => {
    expect(new RouteGraph(withTunnel).route(from, to, indoorOnlyProfile())!.edgeIds).toEqual([1, 2, 3]);
    expect(new RouteGraph({ nodes, edges: [outdoor] }).route(from, to, indoorOnlyProfile())).toBeNull();
  });

  it('indoor-only can allow short outdoor dashes', () => {
    const dash: GraphEdge = { ...outdoor, length: 25, geometry: [0, 0, 100, 0] };
    const g = new RouteGraph({ nodes, edges: [dash] });
    expect(g.route(from, to, indoorOnlyProfile(0))).toBeNull();
    expect(g.route(from, to, indoorOnlyProfile(30))!.edgeIds).toEqual([0]);
  });
});
