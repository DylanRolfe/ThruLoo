// Where the character can stand indoors.
//
// Every hallway, tunnel, bridge and doorway of the route graph becomes a strip:
// a line segment with a width and a height at each end. Standing "on" a strip
// means being within half its width of the segment, at about its height. That
// one rule gives corridors with walls, floors stacked on top of each other,
// tunnel ramps, and doorways through building walls, with no interior meshes
// to collide against.
//
// Pure TypeScript: no three.js, no physics engine, unit tested.

import { SegmentGrid } from '../lib/geom';
import type { EdgeKind, GraphData, GraphEdge, GraphNode } from '../routing/types';

/** Metres between floors. Shared with the drawing code. */
export const FLOOR_HEIGHT = 3.8;

/** Half-width of each kind of strip, in metres. */
export const HALF_WIDTH: Partial<Record<EdgeKind, number>> = { corridor: 1.4, tunnel: 1.5, skywalk: 1.4, door: 1.3 };

/** How big a step up or down the character takes in its stride. */
const STEP = 1.1;
/** Doorways may sit a little above or below the ground outside. */
const DOOR_STEP = 2.4;

export interface Strip {
  ax: number;
  ay: number;
  /** Height at each end, metres above ground. */
  ah: number;
  bx: number;
  by: number;
  bh: number;
  half: number;
  kind: EdgeKind;
  edge: number;
  /** A doorway between outside and inside: the only place to cross over. */
  portal: boolean;
  /**
   * A doorway with no length: outside and inside meet at one spot. On this
   * flat model its floor can sit well above or below the ground outside, so
   * it is entered and left regardless of height, like a door with steps.
   */
  spot: boolean;
  /** Building code and floor at the indoor end, for "you are in MC, floor 3". */
  code?: string;
  floor?: string;
}

export interface SurfaceHit {
  strip: Strip;
  /** Floor height under the point, metres. */
  height: number;
  /** Distance from the strip's centre line. */
  dist: number;
}

export interface StairOption {
  /** Graph node the stairs lead to. */
  to: number;
  up: boolean;
  /** Where they lead: "MC floor 3". */
  label: string;
  /** Height at the other end, metres. */
  height: number;
  x: number;
  y: number;
}

export interface Stairwell {
  node: number;
  x: number;
  y: number;
  options: StairOption[];
}

export interface WalkState {
  x: number;
  y: number;
  /** Feet above ground, metres. */
  h: number;
  indoor: boolean;
}

export class IndoorSurface {
  readonly strips: Strip[] = [];
  private grid = new SegmentGrid<number>(12);
  private stairNodes: number[] = [];
  private maxHalf = 0;

  constructor(private graph: GraphData) {
    const { nodes, edges } = graph;
    for (const e of edges) {
      if (e.env !== 'indoor') continue;
      const half = HALF_WIDTH[e.kind];
      if (!half) continue; // stairs and elevators are climbed, not walked
      const a = nodes[e.a], b = nodes[e.b];
      const inner = a.code ? a : b;
      const portal = e.kind === 'door' && (!a.code || !b.code);
      const g = e.geometry;
      const count = g.length / 2;
      const heights = (e.elev && e.elev.length === count ? e.elev : new Array<number>(count).fill(e.level)).map((v) => v * FLOOR_HEIGHT);
      const spot = portal && e.length < 0.3;
      const add = (i: number, j: number) => {
        this.strips.push({ ax: g[i * 2], ay: g[i * 2 + 1], ah: heights[i], bx: g[j * 2], by: g[j * 2 + 1], bh: heights[j], half, kind: e.kind, edge: e.id, portal, spot, code: inner.code, floor: inner.floor });
        const s = this.strips[this.strips.length - 1];
        this.grid.insert(s.ax, s.ay, s.bx, s.by, this.strips.length - 1);
      };
      if (e.length < 0.3) {
        // A door with no length is a spot, not a passage: stand on it at the indoor level.
        const h = heights[a.code ? 0 : count - 1];
        heights.fill(h);
        add(0, count - 1);
      } else {
        for (let i = 0; i + 1 < count; i++) add(i, i + 1);
      }
      this.maxHalf = Math.max(this.maxHalf, half);
    }
    const seen = new Set<number>();
    for (const e of edges) {
      if (e.kind !== 'stairs' && e.kind !== 'elevator') continue;
      for (const n of [e.a, e.b]) {
        if (!seen.has(n)) {
          seen.add(n);
          this.stairNodes.push(n);
        }
      }
    }
  }

  /**
   * The floor under a point for someone whose feet are at height h, or null
   * when there is none within a step. Where floors overlap in plan the one
   * nearest in height wins.
   */
  at(x: number, y: number, h: number, portalsOnly = false): SurfaceHit | null {
    let best: SurfaceHit | null = null;
    let bestScore = Infinity;
    const r = this.maxHalf;
    this.grid.query(x - r, y - r, x + r, y + r, (_id, si, ax, ay, bx, by) => {
      const s = this.strips[si];
      if (portalsOnly && !s.portal) return;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const dist = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (dist > s.half) return;
      const height = s.ah + (s.bh - s.ah) * t;
      const dh = Math.abs(height - h);
      if (dh > (s.portal ? DOOR_STEP : STEP) && !(portalsOnly && s.spot)) return;
      // Height first, then how central: stay on your own floor, in the middle of the hall.
      const score = dh * 10 + dist;
      if (score < bestScore) {
        bestScore = score;
        best = { strip: s, height, dist };
      }
    });
    return best;
  }

  /** The stairwell someone at this spot and height could use, with where it leads. */
  stairsNear(x: number, y: number, h: number, reach = 2.2): Stairwell | null {
    const { nodes } = this.graph;
    let best: GraphNode | null = null;
    let bestDist = reach;
    for (const id of this.stairNodes) {
      const n = nodes[id];
      if (Math.abs(n.level * FLOOR_HEIGHT - h) > STEP) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    if (!best) return null;
    const here = best;
    const options: StairOption[] = [];
    for (const e of this.graph.edges as GraphEdge[]) {
      if ((e.kind !== 'stairs' && e.kind !== 'elevator') || (e.a !== here.id && e.b !== here.id)) continue;
      const other = nodes[e.a === here.id ? e.b : e.a];
      if (Math.abs(other.level - here.level) < 0.01) continue;
      options.push({ to: other.id, up: other.level > here.level, label: `${other.code ?? ''} floor ${other.floor ?? ''}`.trim(), height: other.level * FLOOR_HEIGHT, x: other.x, y: other.y });
    }
    if (!options.length) return null;
    // Nearest floor first in each direction.
    options.sort((p, q) => Math.abs(p.height - h) - Math.abs(q.height - h));
    return { node: here.id, x: here.x, y: here.y, options };
  }

  /**
   * Moves someone who is indoors by (dx, dy). They stay on the strips, slide
   * along the hallway when they push into its edge, and step outside only
   * through a doorway.
   */
  step(s: WalkState, dx: number, dy: number, canLeave: (x: number, y: number) => boolean): WalkState {
    const tx = s.x + dx, ty = s.y + dy;
    const ahead = this.at(tx, ty, s.h);
    if (ahead) return { x: tx, y: ty, h: ahead.height, indoor: true };

    const here = this.at(s.x, s.y, s.h);
    if (here?.strip.portal && (here.strip.spot || Math.abs(s.h) <= DOOR_STEP) && canLeave(tx, ty)) return { x: tx, y: ty, h: 0, indoor: false };

    if (here) {
      // Slide: keep the part of the movement that runs along the hallway.
      const st = here.strip;
      const ux = st.bx - st.ax, uy = st.by - st.ay;
      const len = Math.hypot(ux, uy);
      if (len > 0.01) {
        const along = (dx * ux + dy * uy) / len;
        const sx = s.x + (ux / len) * along, sy = s.y + (uy / len) * along;
        const slid = this.at(sx, sy, s.h);
        if (slid) return { x: sx, y: sy, h: slid.height, indoor: true };
      }
    }
    return s;
  }

  /**
   * The closest point on any hallway, tunnel or bridge within maxDist, on
   * whichever floor; floors near preferH win ties. For placing someone whose
   * position (from GPS) says they are inside a building.
   */
  nearest(x: number, y: number, maxDist: number, preferH = 0): { x: number; y: number; height: number; strip: Strip } | null {
    let best: { x: number; y: number; height: number; strip: Strip } | null = null;
    let bestScore = Infinity;
    this.grid.query(x - maxDist, y - maxDist, x + maxDist, y + maxDist, (_id, si, ax, ay, bx, by) => {
      const s = this.strips[si];
      // Doorway spots sit at odd heights; a hallway is a better place to stand.
      if (s.spot) return;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy;
      const dist = Math.hypot(x - px, y - py);
      if (dist > maxDist) return;
      const height = s.ah + (s.bh - s.ah) * t;
      const score = dist + Math.abs(height - preferH) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = { x: px, y: py, height, strip: s };
      }
    });
    return best;
  }

  /** Called while outside: has this spot stepped into a doorway? */
  enter(x: number, y: number): SurfaceHit | null {
    return this.at(x, y, 0, true);
  }
}
