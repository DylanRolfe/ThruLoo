// Runtime route graph: adjacency, point snapping and A* search.

import { SegmentGrid, polylineLength, slicePolyline } from '../lib/geom';
import { edgeSeconds } from './profiles';
import type { EdgeEnv, EdgeKind, GraphData, GraphEdge, GraphNode, Route, RouteLink, RouteProfile, RouteStep } from './types';

/** Where a route starts or ends: any of a set of graph nodes (a building's doors), or a free point. */
export type Endpoint = { type: 'nodes'; nodes: number[] } | { type: 'point'; x: number; y: number };

export interface EdgeSnap {
  edge: GraphEdge;
  /** Metres along the edge from node a. */
  s: number;
  x: number;
  y: number;
  /** Metres from the query point to the edge. */
  dist: number;
}

/** One traversable link during a search: a whole edge, or part of one next to a snapped point. */
interface Link {
  to: number;
  cost: number;
  seconds: number;
  length: number;
  kind: EdgeKind;
  env: EdgeEnv;
  edgeId: number;
  /** Geometry in travel direction. */
  geometry: number[];
  /** Travelling the edge from b to a. */
  reverse: boolean;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.keys, v = this.vals;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

const reversed = (line: number[]) => {
  const out = new Array<number>(line.length);
  for (let i = 0; i < line.length; i += 2) {
    out[line.length - 2 - i] = line[i];
    out[line.length - 1 - i] = line[i + 1];
  }
  return out;
};

export class RouteGraph {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
  private adj: number[][];
  private grid: SegmentGrid<{ edge: number; s0: number; len: number }> | null = null;

  constructor(data: GraphData) {
    this.nodes = data.nodes;
    this.edges = data.edges;
    this.adj = this.nodes.map(() => []);
    for (const e of this.edges) {
      this.adj[e.a].push(e.id);
      if (e.b !== e.a) this.adj[e.b].push(e.id);
    }
  }

  edgesAt(node: number): GraphEdge[] {
    return this.adj[node].map((id) => this.edges[id]);
  }

  /**
   * Nearest point on the outdoor network that the profile is allowed to use.
   * Free points are places on the ground, so they never attach to a hallway
   * or tunnel that happens to run beneath them.
   */
  snap(x: number, y: number, maxDist = 120, profile?: RouteProfile): EdgeSnap | null {
    if (!this.grid) {
      this.grid = new SegmentGrid(25);
      for (const e of this.edges) {
        let s0 = 0;
        const g = e.geometry;
        for (let i = 2; i < g.length; i += 2) {
          const len = Math.hypot(g[i] - g[i - 2], g[i + 1] - g[i - 1]);
          this.grid.insert(g[i - 2], g[i - 1], g[i], g[i + 1], { edge: e.id, s0, len });
          s0 += len;
        }
      }
    }
    // Widen the search in steps so the common case stays cheap.
    for (const radius of [15, 40, maxDist]) {
      const hit = this.grid.nearest(x, y, Math.min(radius, maxDist), (p) => {
        const e = this.edges[p.edge];
        return e.env !== 'indoor' && (!profile || Number.isFinite(profile.cost(e)));
      });
      if (hit) {
        const edge = this.edges[hit.payload.edge];
        // Edge lengths are rounded at bake time, so clamp to stay inside the edge.
        return { edge, s: Math.min(edge.length, hit.payload.s0 + hit.t * hit.payload.len), x: hit.x, y: hit.y, dist: hit.dist };
      }
    }
    return null;
  }

  /**
   * Fastest route under the profile, or null when none exists.
   * Building endpoints are sets of door nodes: the search starts from all of
   * the start's doors at once and stops at whichever destination door is
   * reached first.
   */
  route(from: Endpoint, to: Endpoint, profile: RouteProfile): Route | null {
    const N = this.nodes.length;
    const START = N, END = N + 1; // virtual nodes for free points
    const extra = new Map<number, Link[]>();
    const addLink = (from: number, link: Link) => {
      const list = extra.get(from);
      if (list) list.push(link);
      else extra.set(from, [link]);
    };

    const partial = (edge: GraphEdge, s0: number, s1: number, to: number, flip: boolean): Link => {
      const f = edge.length > 0 ? (s1 - s0) / edge.length : 0;
      const geometry = slicePolyline(edge.geometry, s0, s1);
      return {
        to,
        cost: profile.cost(edge) * f,
        seconds: edgeSeconds(edge, profile.speed) * f,
        length: s1 - s0,
        kind: edge.kind,
        env: edge.env,
        edgeId: edge.id,
        geometry: flip ? reversed(geometry) : geometry,
        reverse: flip,
      };
    };
    // A straight hop between a free point and the network.
    const hop = (ax: number, ay: number, bx: number, by: number, to: number): Link => {
      const length = Math.hypot(bx - ax, by - ay);
      return { to, cost: (length / profile.speed) * 1.2, seconds: length / profile.speed, length, kind: 'connector', env: 'outdoor', edgeId: -1, geometry: [ax, ay, bx, by], reverse: false };
    };

    const sources: number[] = [];
    const targets = new Set<number>();
    let startSnap: EdgeSnap | null = null;
    let endSnap: EdgeSnap | null = null;

    if (from.type === 'nodes') sources.push(...from.nodes);
    else {
      startSnap = this.snap(from.x, from.y, 150, profile);
      if (!startSnap) return null;
      sources.push(START);
    }
    if (to.type === 'nodes') for (const n of to.nodes) targets.add(n);
    else {
      endSnap = this.snap(to.x, to.y, 150, profile);
      if (!endSnap) return null;
      targets.add(END);
    }
    if (!sources.length || !targets.size) return null;

    // Virtual nodes sit ON the network at the snapped position; the hop from the
    // free point to that position is added when the polyline is assembled.
    if (startSnap) {
      const e = startSnap.edge;
      addLink(START, partial(e, 0, startSnap.s, e.a, true));
      addLink(START, partial(e, startSnap.s, e.length, e.b, false));
    }
    if (endSnap) {
      const e = endSnap.edge;
      addLink(e.a, partial(e, 0, endSnap.s, END, false));
      addLink(e.b, partial(e, endSnap.s, e.length, END, true));
      if (startSnap && startSnap.edge.id === e.id) {
        const [s0, s1] = [Math.min(startSnap.s, endSnap.s), Math.max(startSnap.s, endSnap.s)];
        addLink(START, partial(e, s0, s1, END, startSnap.s > endSnap.s));
      }
    }

    // Heuristic: straight-line time to the nearest target. Admissible because
    // every profile costs at least length / speed.
    const tx: number[] = [], ty: number[] = [];
    for (const t of targets) {
      if (t === END) {
        tx.push(endSnap!.x);
        ty.push(endSnap!.y);
      } else {
        tx.push(this.nodes[t].x);
        ty.push(this.nodes[t].y);
      }
    }
    const pos = (n: number): [number, number] =>
      n === START ? [startSnap!.x, startSnap!.y] : n === END ? [endSnap!.x, endSnap!.y] : [this.nodes[n].x, this.nodes[n].y];
    const h = (n: number) => {
      const [x, y] = pos(n);
      let best = Infinity;
      for (let i = 0; i < tx.length; i++) best = Math.min(best, Math.hypot(tx[i] - x, ty[i] - y));
      return best / profile.speed;
    };

    const g = new Float64Array(N + 2).fill(Infinity);
    const prevNode = new Int32Array(N + 2).fill(-1);
    const prevLink: (Link | null)[] = new Array(N + 2).fill(null);
    const closed = new Uint8Array(N + 2);
    const heap = new MinHeap();
    for (const s of sources) {
      g[s] = 0;
      heap.push(h(s), s);
    }

    let goal = -1;
    while (heap.size) {
      const [, n] = heap.pop();
      if (closed[n]) continue;
      closed[n] = 1;
      if (targets.has(n)) {
        goal = n;
        break;
      }
      const relax = (link: Link) => {
        if (!Number.isFinite(link.cost) || closed[link.to]) return;
        const cand = g[n] + link.cost;
        if (cand < g[link.to]) {
          g[link.to] = cand;
          prevNode[link.to] = n;
          prevLink[link.to] = link;
          heap.push(cand + h(link.to), link.to);
        }
      };
      if (n < N) {
        for (const id of this.adj[n]) {
          const e = this.edges[id];
          const cost = profile.cost(e);
          if (!Number.isFinite(cost)) continue;
          const forward = e.a === n;
          relax({ to: forward ? e.b : e.a, cost, seconds: edgeSeconds(e, profile.speed), length: e.length, kind: e.kind, env: e.env, edgeId: e.id, geometry: forward ? e.geometry : reversed(e.geometry), reverse: !forward });
        }
      }
      const more = extra.get(n);
      if (more) for (const link of more) relax(link);
    }
    if (goal === -1) return null;

    // ------------------------------------------------------- reconstruct
    const links: Link[] = [];
    const froms: number[] = [];
    let first = goal;
    for (let n = goal; prevNode[n] !== -1; n = prevNode[n]) {
      links.push(prevLink[n]!);
      froms.push(prevNode[n]);
      first = prevNode[n];
    }
    links.reverse();
    froms.reverse();
    if (startSnap && from.type === 'point' && startSnap.dist > 0.3) {
      links.unshift(hop(from.x, from.y, startSnap.x, startSnap.y, START));
      froms.unshift(-1);
    }
    if (endSnap && to.type === 'point' && endSnap.dist > 0.3) {
      links.push(hop(endSnap.x, endSnap.y, to.x, to.y, END));
      froms.push(END);
    }
    const real = (n: number) => (n >= 0 && n < N ? n : -1);

    const points: number[] = [];
    const elev: number[] = [];
    const inside: number[] = [];
    const routeLinks: RouteLink[] = [];
    const byKind = new Map<string, RouteStep>();
    const edgeIds: number[] = [];
    let seconds = 0;
    links.forEach((link, li) => {
      const geo = link.geometry;
      const count = geo.length / 2;
      // Height of each point: indoor edges carry their floor, everything else is on the ground.
      const edge = link.edgeId >= 0 ? this.edges[link.edgeId] : null;
      const indoor = link.env === 'indoor' && edge !== null;
      const profileOf = indoor && edge!.elev && edge!.elev.length === count ? edge!.elev : null;
      for (let i = 0; i < count; i++) {
        const h = !indoor ? 0 : profileOf ? profileOf[link.reverse ? count - 1 - i : i] : edge!.level;
        const n = points.length;
        if (n >= 2 && Math.abs(points[n - 2] - geo[i * 2]) < 1e-6 && Math.abs(points[n - 1] - geo[i * 2 + 1]) < 1e-6 && Math.abs(elev[elev.length - 1] - h) < 1e-6) {
          // Same spot: keep one point, and call it indoors if either side is.
          if (indoor) inside[inside.length - 1] = 1;
          continue;
        }
        points.push(geo[i * 2], geo[i * 2 + 1]);
        elev.push(h);
        inside.push(indoor ? 1 : 0);
      }
      routeLinks.push({ edgeId: link.edgeId, kind: link.kind, env: link.env, length: link.length, seconds: link.seconds, from: real(froms[li]), to: real(link.to) });
      seconds += link.seconds;
      if (link.edgeId >= 0 && edgeIds[edgeIds.length - 1] !== link.edgeId) edgeIds.push(link.edgeId);
      const key = `${link.kind}|${link.env}`;
      const step = byKind.get(key);
      if (step) step.length += link.length;
      else byKind.set(key, { kind: link.kind, env: link.env, length: link.length });
    });
    if (points.length < 4) {
      // Start and end coincide: still return a drawable two-point line.
      const [x, y] = points.length >= 2 ? [points[0], points[1]] : pos(goal);
      const h = elev[0] ?? 0, ins = inside[0] ?? 0;
      points.length = 0;
      points.push(x, y, x, y);
      elev.length = 0;
      elev.push(h, h);
      inside.length = 0;
      inside.push(ins, ins);
    }
    return {
      points,
      elev,
      inside,
      links: routeLinks,
      length: polylineLength(points),
      seconds,
      steps: [...byKind.values()].sort((p, q) => q.length - p.length),
      edgeIds,
      startNode: first < N ? first : undefined,
      endNode: goal < N ? goal : undefined,
    };
  }
}
