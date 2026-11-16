// Builds the route graph from classified ways and building doors.
//
// Pure TypeScript with no three.js or DOM dependency: it runs in the bake
// script, in unit tests, and could run in the browser.
//
// Topology comes from shared node ids (OSM node ids), never from coordinate
// matching. Node identity is (id, level), so a tunnel passing under a footpath
// is a different node even where the two share a position.

import { SegmentGrid, pointInRing, segmentIntersection, type Pt } from '../lib/geom';
import type { IndoorInput } from './indoor';
import type { EdgeEnv, EdgeKind, EdgeSource, GraphData, GraphEdge, GraphNode } from './types';

export interface WayInput {
  id: string;
  /** Stable ids, shared between ways exactly where they physically connect. */
  nodes: number[];
  coords: Pt[];
  kind: EdgeKind;
  env: EdgeEnv;
  level: number;
  name?: string;
  /** Fixed seconds for traversing the whole way (spread over its length). */
  penalty?: number;
  source?: 'osm' | 'manual';
  /** Closed pedestrian area: crossing edges are added between its connected perimeter nodes. */
  plaza?: boolean;
}

export interface DoorInput {
  building: string;
  /** Node id when the entrance is itself a node of the path network. */
  node?: number;
  x: number;
  y: number;
  doorKind: string;
  name?: string;
  level?: number;
}

export interface OutlineInput {
  building: string;
  rings: Pt[][];
}

export interface BuildOptions {
  /** Furthest a mapped entrance may be from the network and still be connected. */
  maxDoorSnap?: number;
  /** Buildings that must end up with at least one door; one is synthesised on the outline if needed. */
  needDoors?: OutlineInput[];
  maxSyntheticSnap?: number;
  /** Wall rings. Door connectors avoid crossing them when an alternative exists. */
  walls?: Pt[][];
  /** Hallways, tunnels, bridges and stairs, joined to the outdoor network at their exits. */
  indoor?: IndoorInput;
  /** Furthest an indoor exit may be from an outdoor path and still be joined to it. */
  maxExitSnap?: number;
}

export interface BuildReport {
  ways: number;
  components: number;
  mainShare: number;
  droppedKm: number;
  plazaEdges: number;
  /** Dead-end path segments inside building footprints that were removed. */
  prunedInteriorSegments: number;
  doorsDirect: number;
  doorsSnapped: number;
  doorsDropped: number;
  doorsSynthetic: number;
  syntheticOver25m: string[];
  buildingsWithoutDoor: string[];
  nodes: number;
  edges: number;
  totalKm: number;
  indoor?: {
    km: number;
    /** Exits joined to an existing entrance of the same building. */
    exitsAtEntrances: number;
    /** Exits joined to the nearest outdoor path. */
    exitsSnapped: number;
    exitsDropped: number;
    /** Metres of indoor network with no connection to the rest of the graph. */
    unreachableMetres: number;
    /** Metres of stairs and hallway stripped because they lead nowhere (not on any way between doors, tunnels and bridges). */
    deadEndMetres: number;
  };
}

export interface BuildResult {
  graph: GraphData;
  /** Door node ids per building, best first (main entrances, then ordinary ones, then synthetic). */
  doors: Record<string, number[]>;
  /** Indoor node ids per building code where a route may start or end inside it. */
  anchors: Record<string, number[]>;
  report: BuildReport;
}

interface Seg {
  a: number;
  b: number;
  len: number;
  kind: EdgeKind;
  env: EdgeEnv;
  level: number;
  name?: string;
  /** Penalty seconds per metre. */
  ppm: number;
  /** Fixed penalty seconds for this segment (stairs, doors). */
  fixed?: number;
  /** Segments merge into one edge only within the same group. */
  group?: string;
  building?: string;
  source: EdgeSource;
  alive: boolean;
}

interface DoorMeta {
  building: string;
  doorKind: string;
  name?: string;
}

const DOOR_RANK: Record<string, number> = { main: 0, yes: 1, secondary: 2, staircase: 3, home: 3, synthetic: 5 };

export function buildGraph(ways: WayInput[], doors: DoorInput[], opts: BuildOptions = {}): BuildResult {
  const maxDoorSnap = opts.maxDoorSnap ?? 60;
  const maxSyntheticSnap = opts.maxSyntheticSnap ?? 80;

  // ------------------------------------------------------------ raw graph
  const nodeIndex = new Map<string, number>();
  const nx: number[] = [];
  const ny: number[] = [];
  const nLevel: number[] = [];
  const adj: number[][] = [];
  const segs: Seg[] = [];
  const doorMeta: (DoorMeta | undefined)[] = [];

  const newNode = (x: number, y: number, level: number): number => {
    nx.push(x);
    ny.push(y);
    nLevel.push(level);
    adj.push([]);
    return nx.length - 1;
  };
  const keyedNode = (id: number, level: number, x: number, y: number): number => {
    const key = `${id}:${level}`;
    let n = nodeIndex.get(key);
    if (n === undefined) {
      n = newNode(x, y, level);
      nodeIndex.set(key, n);
    }
    return n;
  };
  const addSeg = (seg: Seg): number => {
    segs.push(seg);
    const i = segs.length - 1;
    adj[seg.a].push(i);
    adj[seg.b].push(i);
    return i;
  };
  const degree = (n: number) => adj[n].reduce((d, s) => d + (segs[s].alive ? 1 : 0), 0);

  // Wall rings with bounding boxes, for "is this point inside a building" tests.
  const wallRings = (opts.walls ?? []).map((ring) => {
    const flat: number[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
      flat.push(x, y);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { flat, x0, y0, x1, y1 };
  });
  const insideWalls = (x: number, y: number) =>
    wallRings.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && pointInRing(x, y, r.flat));
  // Plaza outlines often overlap the buildings around them. A plaza edge is
  // only walkable where it is actually in the open.
  const plazaEdgeBlocked = (ax: number, ay: number, bx: number, by: number) => {
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      if (insideWalls(ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
    }
    return false;
  };

  for (const way of ways) {
    let wayLen = 0;
    for (let i = 1; i < way.coords.length; i++) {
      wayLen += Math.hypot(way.coords[i][0] - way.coords[i - 1][0], way.coords[i][1] - way.coords[i - 1][1]);
    }
    const ppm = way.penalty && wayLen > 0 ? way.penalty / wayLen : 0;
    for (let i = 1; i < way.nodes.length; i++) {
      const a = keyedNode(way.nodes[i - 1], way.level, way.coords[i - 1][0], way.coords[i - 1][1]);
      const b = keyedNode(way.nodes[i], way.level, way.coords[i][0], way.coords[i][1]);
      if (a === b) continue;
      if (way.plaza && plazaEdgeBlocked(nx[a], ny[a], nx[b], ny[b])) continue;
      const len = Math.hypot(nx[b] - nx[a], ny[b] - ny[a]);
      addSeg({ a, b, len, kind: way.kind, env: way.env, level: way.level, name: way.name, ppm, source: way.source ?? 'osm', alive: true });
    }
  }

  // ---------------------------------------------- keep the main component
  const comp = new Int32Array(nx.length).fill(-1);
  const compLen: number[] = [];
  for (let start = 0; start < nx.length; start++) {
    if (comp[start] !== -1 || adj[start].length === 0) continue;
    const id = compLen.length;
    let len = 0;
    const stack = [start];
    comp[start] = id;
    while (stack.length) {
      const n = stack.pop()!;
      for (const si of adj[n]) {
        const s = segs[si];
        len += s.len / 2;
        const other = s.a === n ? s.b : s.a;
        if (comp[other] === -1) {
          comp[other] = id;
          stack.push(other);
        }
      }
    }
    compLen.push(len);
  }
  let main = 0;
  for (let i = 1; i < compLen.length; i++) if (compLen[i] > compLen[main]) main = i;
  const totalLen = compLen.reduce((s, v) => s + v, 0);
  for (const s of segs) if (comp[s.a] !== main) s.alive = false;

  // ------------------------------------------------------- plaza crossings
  let plazaEdges = 0;
  for (const way of ways) {
    if (!way.plaza || way.nodes.length < 4) continue;
    const ring: number[] = [];
    const ringNodes: number[] = [];
    const count = way.nodes[0] === way.nodes[way.nodes.length - 1] ? way.nodes.length - 1 : way.nodes.length;
    for (let i = 0; i < count; i++) {
      ring.push(way.coords[i][0], way.coords[i][1]);
      const n = nodeIndex.get(`${way.nodes[i]}:${way.level}`);
      if (n !== undefined) ringNodes.push(n);
    }
    // Perimeter nodes that something else connects to.
    const gates = [...new Set(ringNodes)].filter((n) => degree(n) >= 3).slice(0, 48);
    for (let i = 0; i < gates.length; i++) {
      for (let j = i + 1; j < gates.length; j++) {
        const a = gates[i], b = gates[j];
        if (adj[a].some((si) => segs[si].alive && (segs[si].a === b || segs[si].b === b))) continue;
        let inside = true;
        for (let k = 1; k <= 7 && inside; k++) {
          const t = k / 8;
          inside = pointInRing(nx[a] + (nx[b] - nx[a]) * t, ny[a] + (ny[b] - ny[a]) * t, ring);
        }
        if (!inside || plazaEdgeBlocked(nx[a], ny[a], nx[b], ny[b])) continue;
        addSeg({ a, b, len: Math.hypot(nx[b] - nx[a], ny[b] - ny[a]), kind: 'plaza', env: way.env, level: way.level, ppm: 0, source: 'derived', alive: true });
        plazaEdges++;
      }
    }
  }

  // ----------------------------------------------------------------- doors
  const grid = new SegmentGrid<number>(20);
  const gridId = new Map<number, number>();
  const indexSeg = (si: number) => {
    const s = segs[si];
    gridId.set(si, grid.insert(nx[s.a], ny[s.a], nx[s.b], ny[s.b], si));
  };
  segs.forEach((s, si) => {
    if (s.alive) indexSeg(si);
  });

  const wallGrid = new SegmentGrid<null>(20);
  for (const ring of opts.walls ?? []) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      wallGrid.insert(p[0], p[1], q[0], q[1], null);
    }
  }
  // Does the straight line from a door to a network point pass through a wall?
  // The first half metre is ignored because the door itself sits on a wall.
  const crossesWall = (dx: number, dy: number, px: number, py: number): boolean => {
    const len = Math.hypot(px - dx, py - dy);
    if (len < 1) return false;
    const sx = dx + ((px - dx) * 0.5) / len, sy = dy + ((py - dy) * 0.5) / len;
    let hit = false;
    wallGrid.query(Math.min(sx, px), Math.min(sy, py), Math.max(sx, px), Math.max(sy, py), (_id, _p, ax, ay, bx, by) => {
      if (!hit && segmentIntersection(sx, sy, px, py, ax, ay, bx, by) !== null) hit = true;
    });
    return hit;
  };

  interface Snap {
    seg: number;
    t: number;
    x: number;
    y: number;
    dist: number;
    blocked: boolean;
  }
  // Nearest network point, preferring one that can be reached without crossing a wall.
  const snap = (x: number, y: number, maxDist: number): Snap | null => {
    const found = new Map<number, Snap>();
    grid.query(x - maxDist, y - maxDist, x + maxDist, y + maxDist, (_id, si, ax, ay, bx, by) => {
      if (found.has(si)) return;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d <= maxDist) found.set(si, { seg: si, t, x: px, y: py, dist: d, blocked: false });
    });
    const sorted = [...found.values()].sort((p, q) => p.dist - q.dist);
    if (!sorted.length) return null;
    for (const c of sorted) {
      if (!crossesWall(x, y, c.x, c.y)) return c;
    }
    return { ...sorted[0], blocked: true };
  };

  const splitSeg = (si: number, t: number, x: number, y: number): number => {
    const s = segs[si];
    if (t * s.len < 0.5) return s.a;
    if ((1 - t) * s.len < 0.5) return s.b;
    const n = newNode(x, y, s.level);
    s.alive = false;
    grid.remove(gridId.get(si)!);
    indexSeg(addSeg({ ...s, b: n, len: t * s.len, alive: true }));
    indexSeg(addSeg({ ...s, a: n, len: (1 - t) * s.len, alive: true }));
    return n;
  };

  const doorsByBuilding = new Map<string, number[]>();
  const registerDoor = (n: number, building: string, doorKind: string, name?: string) => {
    if (!doorMeta[n]) doorMeta[n] = { building, doorKind, name };
    const list = doorsByBuilding.get(building);
    if (!list) doorsByBuilding.set(building, [n]);
    else if (!list.includes(n)) list.push(n);
  };
  const connect = (x: number, y: number, level: number, s: Snap): number => {
    const n = splitSeg(s.seg, s.t, s.x, s.y);
    if (s.dist < 0.3) return n;
    const d = newNode(x, y, level);
    // Connectors are not indexed in the grid: later doors must snap to real paths.
    addSeg({ a: d, b: n, len: Math.hypot(nx[n] - x, ny[n] - y), kind: 'connector', env: 'outdoor', level, ppm: 0, source: 'derived', alive: true });
    return d;
  };

  let doorsDirect = 0, doorsSnapped = 0, doorsDropped = 0, doorsSynthetic = 0;
  for (const d of doors) {
    const level = d.level ?? 0;
    const existing = d.node !== undefined ? nodeIndex.get(`${d.node}:${level}`) : undefined;
    if (existing !== undefined && degree(existing) > 0) {
      registerDoor(existing, d.building, d.doorKind, d.name);
      doorsDirect++;
      continue;
    }
    const s = snap(d.x, d.y, maxDoorSnap);
    if (!s) {
      doorsDropped++;
      continue;
    }
    registerDoor(connect(d.x, d.y, level, s), d.building, d.doorKind, d.name);
    doorsSnapped++;
  }

  const syntheticOver25m: string[] = [];
  const buildingsWithoutDoor: string[] = [];
  for (const outline of opts.needDoors ?? []) {
    if (doorsByBuilding.has(outline.building)) continue;
    let best: { x: number; y: number; s: Snap } | null = null;
    for (const ring of outline.rings) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 3));
        for (let k = 0; k < steps; k++) {
          const x = p[0] + ((q[0] - p[0]) * (k + 0.5)) / steps;
          const y = p[1] + ((q[1] - p[1]) * (k + 0.5)) / steps;
          const s = snap(x, y, maxSyntheticSnap);
          if (!s) continue;
          // An unobstructed connector always beats one that crosses a wall.
          if (!best || (best.s.blocked && !s.blocked) || (best.s.blocked === s.blocked && s.dist < best.s.dist)) best = { x, y, s };
        }
      }
    }
    if (!best) {
      buildingsWithoutDoor.push(outline.building);
      continue;
    }
    registerDoor(connect(best.x, best.y, 0, best.s), outline.building, 'synthetic');
    doorsSynthetic++;
    if (best.s.dist > 25) syntheticOver25m.push(outline.building);
  }

  // ------------------------------------------- prune interior dead ends
  // Outdoor footways are often drawn a few metres past a door, to meet an
  // indoor corridor. With the indoor network left out those stubs lead nowhere
  // and would only tell the collider to open the wall. Through-passages
  // (breezeways, arcades) are not dead ends and survive.
  const deepInside = (n: number) => insideWalls(nx[n], ny[n]) && !wallGrid.nearest(nx[n], ny[n], 0.5);
  let prunedSegs = 0;
  const queue: number[] = [];
  for (let n = 0; n < nx.length; n++) if (!doorMeta[n] && degree(n) === 1) queue.push(n);
  while (queue.length) {
    const n = queue.pop()!;
    if (doorMeta[n] || degree(n) !== 1 || !deepInside(n)) continue;
    const si = adj[n].find((x) => segs[x].alive)!;
    segs[si].alive = false;
    prunedSegs++;
    queue.push(segs[si].a === n ? segs[si].b : segs[si].a);
  }

  // -------------------------------------------------------- indoor network
  // Added after the outdoor graph is settled, so nothing above can prune or
  // snap to it. Indoor and outdoor meet only at exits: a door edge between the
  // node just inside and a node on the outdoor network.
  const indoorMeta: ({ code: string; floor: string; building?: string; stairs?: boolean } | undefined)[] = [];
  const forceKeep = new Set<number>();
  const anchorsByCode = new Map<string, number[]>();
  let indoorReport: BuildReport['indoor'];
  if (opts.indoor) {
    const indoor = opts.indoor;
    const maxExitSnap = opts.maxExitSnap ?? 45;
    const index = new Map<string, number>();
    const firstIndoorNode = nx.length;
    for (const n of indoor.nodes) {
      const i = newNode(n.x, n.y, n.level);
      index.set(n.key, i);
      indoorMeta[i] = { code: n.code, floor: n.floor, building: n.building, stairs: n.stairs };
    }
    const firstIndoorSeg = segs.length;
    for (const e of indoor.edges) {
      const a = index.get(e.a)!, b = index.get(e.b)!;
      if (a === b) continue;
      const seg = (p: number, q: number, fixed?: number) =>
        addSeg({ a: p, b: q, len: Math.hypot(nx[q] - nx[p], ny[q] - ny[p]), kind: e.kind, env: 'indoor', level: nLevel[p], ppm: 0, fixed, group: e.group, building: indoorMeta[a]?.building, source: 'watisgrass', alive: true });
      // Bends of a tunnel or bridge become private nodes that nothing else can join.
      let prev = a;
      const inner = e.coords ? e.coords.length - 2 : 0;
      for (let k = 1; k <= inner; k++) {
        const mid = newNode(e.coords![k][0], e.coords![k][1], e.levels ? e.levels[k] : nLevel[a]);
        seg(prev, mid);
        prev = mid;
      }
      seg(prev, b, e.penalty);
    }

    let exitsAtEntrances = 0, exitsSnapped = 0, exitsDropped = 0;
    indoor.exits.forEach((ex, i) => {
      const inner = index.get(ex.node)!;
      const building = indoorMeta[inner]?.building;
      // Prefer an entrance OSM already has for this building, if one is right there.
      let door: number | undefined;
      let best = 14;
      for (const d of (building && doorsByBuilding.get(building)) || []) {
        const dist = Math.hypot(nx[d] - ex.x, ny[d] - ex.y);
        if (dist < best) {
          best = dist;
          door = d;
        }
      }
      if (door !== undefined) exitsAtEntrances++;
      else {
        const hit = snap(ex.x, ex.y, maxExitSnap);
        if (!hit) {
          exitsDropped++;
          return;
        }
        door = connect(ex.x, ex.y, 0, hit);
        exitsSnapped++;
      }
      forceKeep.add(door);
      addSeg({ a: door, b: inner, len: Math.hypot(nx[inner] - nx[door], ny[inner] - ny[door]), kind: 'door', env: 'indoor', level: 0, ppm: 0, fixed: 2, group: `exit:${i}`, building, source: 'watisgrass', alive: true });
    });

    // Drop indoor pieces that never reach the rest of the graph.
    const reached = new Uint8Array(nx.length);
    const start = segs.findIndex((sg) => sg.alive && sg.env !== 'indoor');
    if (start >= 0) {
      const stack = [segs[start].a];
      reached[segs[start].a] = 1;
      while (stack.length) {
        const n = stack.pop()!;
        for (const si of adj[n]) {
          if (!segs[si].alive) continue;
          const other = segs[si].a === n ? segs[si].b : segs[si].a;
          if (!reached[other]) {
            reached[other] = 1;
            stack.push(other);
          }
        }
      }
    }
    let unreachable = 0, km = 0;
    for (let si = firstIndoorSeg; si < segs.length; si++) {
      const sg = segs[si];
      if (sg.env !== 'indoor' || !sg.alive) continue;
      if (!reached[sg.a]) {
        sg.alive = false;
        unreachable += sg.len;
      }
    }

    // Dead ends. The network is there to get between buildings: in by a door,
    // along a hallway, through a tunnel or over a bridge, out again. A stairwell
    // climbing to floors where nothing else connects, or a hallway that just
    // stops, is on no such way, and getting around inside one building is the
    // floor plans' job. So strip leaves until none are left. Every tunnel, bridge
    // and building-to-building link is kept whole, whatever it leads to.
    const through = new Uint8Array(nx.length);
    for (let si = firstIndoorSeg; si < segs.length; si++) {
      const sg = segs[si];
      if (!sg.alive) continue;
      // A tunnel or a bridge, or any link from one building straight into the next (shared walls, joined wings).
      const ca = indoorMeta[sg.a]?.code, cb = indoorMeta[sg.b]?.code;
      if (sg.kind === 'tunnel' || sg.kind === 'skywalk' || (ca && cb && ca !== cb)) through[sg.a] = through[sg.b] = 1;
    }
    let deadEnds = 0;
    const leaves: number[] = [];
    for (let n = firstIndoorNode; n < nx.length; n++) leaves.push(n);
    while (leaves.length) {
      const n = leaves.pop()!;
      if (through[n]) continue;
      let only = -1, count = 0;
      for (const si of adj[n]) {
        if (segs[si].alive) {
          count++;
          only = si;
        }
      }
      if (count !== 1) continue;
      const sg = segs[only];
      sg.alive = false;
      deadEnds += sg.len;
      const other = sg.a === n ? sg.b : sg.a;
      if (other >= firstIndoorNode) leaves.push(other);
    }
    for (let si = firstIndoorSeg; si < segs.length; si++) if (segs[si].alive && segs[si].env === 'indoor') km += segs[si].len / 1000;

    const anchor = (code: string, n: number) => {
      forceKeep.add(n);
      const list = anchorsByCode.get(code);
      if (list) list.push(n);
      else anchorsByCode.set(code, [n]);
    };
    for (const an of indoor.anchors) {
      const n = index.get(an.node);
      if (n === undefined || !reached[n] || degree(n) === 0) continue;
      anchor(an.code, n);
    }
    // With the dead ends gone, a building joined to the rest only by a tunnel or
    // a bridge may have lost the hallway point that stood for "inside it". The
    // mouth of the tunnel or bridge is inside it just the same.
    const lost = new Set<string>();
    for (const an of indoor.anchors) if (!anchorsByCode.has(an.code)) lost.add(an.code);
    for (let n = firstIndoorNode; n < nx.length; n++) {
      const meta = indoorMeta[n];
      if (through[n] && meta && lost.has(meta.code) && degree(n) > 0) anchor(meta.code, n);
    }
    indoorReport = { km, exitsAtEntrances, exitsSnapped, exitsDropped, unreachableMetres: Math.round(unreachable), deadEndMetres: Math.round(deadEnds) };
  }

  // ----------------------------------------- contract chains into edges
  const sameClass = (p: Seg, q: Seg) => p.kind === q.kind && p.env === q.env && p.source === q.source && p.group === q.group && (p.env === 'indoor' || p.level === q.level);
  const liveAdj = (n: number) => adj[n].filter((si) => segs[si].alive);
  const isKeep = (n: number): boolean => {
    if (doorMeta[n] || forceKeep.has(n)) return true;
    const l = liveAdj(n);
    if (l.length !== 2) return l.length > 0;
    return !sameClass(segs[l[0]], segs[l[1]]) || l[0] === l[1];
  };

  const finalId = new Map<number, number>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const outNode = (n: number): number => {
    let id = finalId.get(n);
    if (id === undefined) {
      id = nodes.length;
      finalId.set(n, id);
      const meta = doorMeta[n];
      const inside = indoorMeta[n];
      nodes.push({
        id,
        x: round(nx[n]),
        y: round(ny[n]),
        level: nLevel[n],
        kind: meta ? 'door' : inside?.stairs ? 'stairs' : 'junction',
        ...(meta ? { building: meta.building, doorKind: meta.doorKind, ...(meta.name ? { name: meta.name } : {}) } : {}),
        ...(inside ? { code: inside.code, floor: inside.floor, ...(inside.building ? { building: inside.building } : {}) } : {}),
      });
    }
    return id;
  };

  const used = new Uint8Array(segs.length);
  const walk = (start: number, firstSeg: number) => {
    const first = segs[firstSeg];
    const geometry = [round(nx[start]), round(ny[start])];
    const heights = [nLevel[start]];
    let length = 0, penalty = 0;
    let cur = start, si = firstSeg;
    for (;;) {
      used[si] = 1;
      const s = segs[si];
      const next = s.a === cur ? s.b : s.a;
      length += s.len;
      penalty += s.len * s.ppm + (s.fixed ?? 0);
      geometry.push(round(nx[next]), round(ny[next]));
      heights.push(nLevel[next]);
      cur = next;
      if (isKeep(cur) || cur === start) break;
      const nextSeg = liveAdj(cur).find((x) => !used[x]);
      if (nextSeg === undefined) break;
      si = nextSeg;
    }
    edges.push({
      id: edges.length,
      a: outNode(start),
      b: outNode(cur),
      length: round(length),
      kind: first.kind,
      env: first.env,
      level: first.env === 'indoor' ? nLevel[start] : first.level,
      ...((first.kind === 'stairs' || first.kind === 'elevator') ? { levelTo: nLevel[cur] } : {}),
      ...(penalty > 0.05 ? { penalty: Math.round(penalty * 10) / 10 } : {}),
      ...(first.name ? { name: first.name } : {}),
      ...(first.building ? { building: first.building } : {}),
      geometry,
      ...(heights.some((h) => Math.abs(h - heights[0]) > 1e-6) ? { elev: heights.map((h) => Math.round(h * 100) / 100) } : {}),
      source: first.source,
    });
  };
  for (let n = 0; n < nx.length; n++) {
    if (!isKeep(n)) continue;
    for (const si of liveAdj(n)) if (!used[si]) walk(n, si);
  }
  // Closed loops with no junction on them.
  for (let si = 0; si < segs.length; si++) {
    if (segs[si].alive && !used[si]) walk(segs[si].a, si);
  }

  const doorsOut: Record<string, number[]> = {};
  for (const [building, list] of doorsByBuilding) {
    doorsOut[building] = list
      .slice()
      .sort((p, q) => (DOOR_RANK[doorMeta[p]!.doorKind] ?? 4) - (DOOR_RANK[doorMeta[q]!.doorKind] ?? 4))
      .map(outNode);
  }

  const anchorsOut: Record<string, number[]> = {};
  for (const [code, list] of anchorsByCode) anchorsOut[code] = [...new Set(list)].map(outNode);

  const totalKm = edges.reduce((s, e) => s + e.length, 0) / 1000;
  return {
    graph: { nodes, edges },
    doors: doorsOut,
    anchors: anchorsOut,
    report: {
      ways: ways.length,
      components: compLen.length,
      mainShare: totalLen > 0 ? compLen[main] / totalLen : 0,
      droppedKm: (totalLen - (compLen[main] ?? 0)) / 1000,
      plazaEdges,
      prunedInteriorSegments: prunedSegs,
      doorsDirect,
      doorsSnapped,
      doorsDropped,
      doorsSynthetic,
      syntheticOver25m,
      buildingsWithoutDoor,
      nodes: nodes.length,
      edges: edges.length,
      totalKm,
      ...(indoorReport ? { indoor: indoorReport } : {}),
    },
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
