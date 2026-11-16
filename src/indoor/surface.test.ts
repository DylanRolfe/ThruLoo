import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CampusData } from '../data/types';
import type { GraphData, GraphEdge, GraphNode } from '../routing/types';
import { FLOOR_HEIGHT, IndoorSurface, type WalkState } from './surface';

// A door at x=0 leads into building A. Its floor-1 hallway runs east to a
// stairwell at x=20. From there: stairs up to a floor-2 hallway that carries on
// east, and a tunnel that dips under it on the way to building B at x=60.
const node = (id: number, x: number, level: number, code?: string, floor?: string): GraphNode => ({ id, x, y: 0, level, kind: 'junction', ...(code ? { code, floor } : {}) });
const nodes: GraphNode[] = [node(0, 0, 0), node(1, 5, 0, 'A', '1'), node(2, 20, 0, 'A', '1'), node(3, 20, 1, 'A', '2'), node(4, 40, 1, 'A', '2'), node(5, 60, 0, 'B', '1')];
const edge = (id: number, a: number, b: number, kind: GraphEdge['kind'], extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id, a, b, kind, env: 'indoor', level: nodes[a].level, length: Math.abs(nodes[b].x - nodes[a].x), geometry: [nodes[a].x, 0, nodes[b].x, 0], source: 'watisgrass', ...extra,
});
const graph: GraphData = {
  nodes,
  edges: [
    edge(0, 0, 1, 'door'),
    edge(1, 1, 2, 'corridor'),
    edge(2, 2, 3, 'stairs', { levelTo: 1, length: 0 }),
    edge(3, 3, 4, 'corridor'),
    edge(4, 2, 5, 'tunnel', { geometry: [20, 0, 28, 0, 52, 0, 60, 0], elev: [0, -0.9, -0.9, 0] }),
    // An outdoor path beside the door: never part of the indoor surface.
    { id: 5, a: 0, b: 0, kind: 'footway', env: 'outdoor', level: 0, length: 10, geometry: [0, -5, 0, 5], source: 'osm' },
  ],
};
const surface = new IndoorSurface(graph);
const open = () => true;
const walled = () => false;
const at = (x: number, y: number, h: number): WalkState => ({ x, y, h, indoor: true });

describe('IndoorSurface', () => {
  it('lets someone outside in only through a doorway', () => {
    expect(surface.enter(0.5, 0.3)?.strip.portal).toBe(true);
    expect(surface.enter(10, 0)).toBeNull(); // a hallway behind the wall is not a way in
    expect(surface.enter(0, 4)).toBeNull(); // the path outside is not indoors
  });

  it('tells stacked floors apart by height', () => {
    expect(surface.at(30, 0, FLOOR_HEIGHT)?.strip.kind).toBe('corridor'); // floor 2
    expect(surface.at(30, 0, -0.9 * FLOOR_HEIGHT)?.strip.kind).toBe('tunnel'); // underneath it
    expect(surface.at(30, 0, 0)).toBeNull(); // nothing at ground level here
    expect(surface.at(10, 0, 0)?.strip.code).toBe('A');
  });

  it('keeps a walker inside the hallway and slides them along its wall', () => {
    expect(surface.step(at(10, 0, 0), 0, 3, open)).toEqual(at(10, 0, 0)); // straight into the wall: no movement
    const slid = surface.step(at(10, 1.3, 0), 1, 1, open);
    expect(slid.x).toBeCloseTo(11);
    expect(slid.y).toBeCloseTo(1.3);
    expect(surface.step(at(10, 0, 0), 2, 0.5, open)).toEqual(at(12, 0.5, 0));
  });

  it('only lets a walker out through a doorway, and only onto open ground', () => {
    const out = surface.step(at(0.5, 0, 0), -3, 0, open);
    expect(out).toEqual({ x: -2.5, y: 0, h: 0, indoor: false });
    expect(surface.step(at(0.5, 0, 0), -3, 0, walled).indoor).toBe(true); // a wall outside the door: stay put
    expect(surface.step(at(10, 0, 0), 0, 3, open).indoor).toBe(true); // a hallway is not an exit
  });

  it('follows a tunnel down its ramp and up the other side', () => {
    let s = at(20, 0, 0);
    let lowest = 0, worstStep = 0;
    for (let i = 0; i < 400 && s.x < 59.9; i++) {
      const next = surface.step(s, 0.1, 0, walled);
      worstStep = Math.max(worstStep, Math.abs(next.h - s.h));
      lowest = Math.min(lowest, next.h);
      s = next;
    }
    expect(s.x).toBeGreaterThan(59.8);
    expect(lowest).toBeCloseTo(-0.9 * FLOOR_HEIGHT);
    // A ramp, not a drop. The one bigger step is where the hallway's rounded
    // end stops and the ramp, already a little lower, takes over; the
    // character's drawn height is smoothed over it.
    expect(worstStep).toBeLessThan(0.7);
    expect(s.h).toBeCloseTo(0, 1);
    expect(surface.at(s.x, s.y, s.h)?.strip.code).toBe('A'); // tunnel strips are labelled by their first building
  });

  it('offers the stairs when standing at a stairwell, with where they lead', () => {
    const below = surface.stairsNear(19, 0.5, 0)!;
    expect(below.node).toBe(2);
    expect(below.options).toEqual([{ to: 3, up: true, label: 'A floor 2', height: FLOOR_HEIGHT, x: 20, y: 0 }]);
    const above = surface.stairsNear(20.5, 0, FLOOR_HEIGHT)!;
    expect(above.options[0]).toMatchObject({ to: 2, up: false, label: 'A floor 1', height: 0 });
    expect(surface.stairsNear(10, 0, 0)).toBeNull(); // too far along the hall
    expect(surface.stairsNear(20, 0, -3)).toBeNull(); // in the tunnel underneath
  });
});

describe('campus indoor surface', () => {
  const campus: CampusData = JSON.parse(readFileSync(new URL('../../public/data/campus.json', import.meta.url), 'utf8'));
  const real = new IndoorSurface(campus.graph);

  it('has a floor under every hallway, tunnel and bridge of the route graph', () => {
    let checked = 0;
    for (const e of campus.graph.edges) {
      if (e.env !== 'indoor' || !['corridor', 'tunnel', 'skywalk'].includes(e.kind) || e.length < 0.3) continue;
      const n = e.geometry.length / 2;
      for (let i = 0; i < n; i++) {
        const h = (e.elev ? e.elev[i] : e.level) * FLOOR_HEIGHT;
        expect(real.at(e.geometry[i * 2], e.geometry[i * 2 + 1], h)).not.toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('has a doorway for every exit, reachable from outside at ground level', () => {
    const doors = campus.graph.edges.filter((e) => e.kind === 'door' && e.env === 'indoor' && (!campus.graph.nodes[e.a].code || !campus.graph.nodes[e.b].code));
    expect(doors.length).toBeGreaterThan(35);
    for (const e of doors) {
      const outside = campus.graph.nodes[campus.graph.nodes[e.a].code ? e.b : e.a];
      expect(real.enter(outside.x, outside.y)).not.toBeNull();
    }
  });

  it('never makes a walker climb more than a ramp between neighbouring points of a tunnel', () => {
    for (const e of campus.graph.edges.filter((x) => x.kind === 'tunnel')) {
      const n = e.geometry.length / 2;
      for (let i = 1; i < n; i++) {
        const run = Math.hypot(e.geometry[i * 2] - e.geometry[i * 2 - 2], e.geometry[i * 2 + 1] - e.geometry[i * 2 - 1]);
        const rise = Math.abs(((e.elev ? e.elev[i] : e.level) - (e.elev ? e.elev[i - 1] : e.level)) * FLOOR_HEIGHT);
        if (rise > 0.01) expect(rise / run).toBeLessThan(1.2);
      }
    }
  });
});
