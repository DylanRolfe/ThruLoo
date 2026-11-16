// Where to put the character for a GPS fix, and how far along the route it is.
//
// Raw GPS wanders several metres and is worst indoors, so a fix is never used
// as is when that would put someone inside a wall:
//   1. near the route: on the route (indoors too: the right hallway and floor)
//   2. in the open: where the fix says
//   3. inside a building: on the nearest hallway or tunnel of that building
//   4. otherwise: on the nearest outdoor path

import type { Building } from '../data/types';
import { closestOnSegment, pointInPolygon } from '../lib/geom';
import { FLOOR_HEIGHT } from '../indoor/surface';
import { outdoorProfile } from '../routing/profiles';
import type { Route } from '../routing/types';
import type { World } from './world';

export interface Placement {
  x: number;
  y: number;
  /** Floor height in metres (0 outside, negative in tunnels). */
  h: number;
  indoor: boolean;
  /** Placed on the route, and how far along it (metres of polyline). */
  onRoute: boolean;
  along: number;
  /** Distance from the fix to the route, metres (Infinity without one). */
  offRoute: number;
}

/** Route points closer than this to the fix win, widened for a poor fix. */
const routeTolerance = (accuracy: number) => Math.max(18, Math.min(45, accuracy));
/** How far to look for a hallway when the fix lands inside a building. */
const INDOOR_REACH = 30;
/** Keep this far off walls, about the character's radius. */
const WALL_MARGIN = 0.5;

export function placeFix(world: World, route: Route | null, x: number, y: number, accuracy: number, preferH = 0): Placement {
  let offRoute = Infinity;
  if (route) {
    const near = nearestOnRoute(route, x, y);
    if (near) {
      offRoute = near.dist;
      if (near.dist < routeTolerance(accuracy)) {
        const h = near.elev * FLOOR_HEIGHT;
        // Only call it indoors if there really is a floor there to stand on.
        const indoor = near.inside && world.surface.at(near.x, near.y, h) !== null;
        return { x: near.x, y: near.y, h: indoor ? h : 0, indoor, onRoute: true, along: near.along, offRoute };
      }
    }
  }
  const free = { onRoute: false, along: 0, offRoute };
  if (!insideBuilding(world, x, y)) return { x, y, h: 0, indoor: false, ...free };

  const hall = world.surface.nearest(x, y, INDOOR_REACH, preferH);
  if (hall) return { x: hall.x, y: hall.y, h: hall.height, indoor: true, ...free };

  const path = world.graph.snap(x, y, 250, outdoorProfile);
  if (path) return { x: path.x, y: path.y, h: 0, indoor: false, ...free };
  return { x, y, h: 0, indoor: false, ...free };
}

const solidCache = new WeakMap<World, { b: Building; x0: number; y0: number; x1: number; y1: number }[]>();

/** Is (x, y) inside, or within a body's width of, a solid building? */
export function insideBuilding(world: World, x: number, y: number, margin = WALL_MARGIN): boolean {
  let solid = solidCache.get(world);
  if (!solid) {
    solid = world.campus.buildings
      .filter((b) => b.solid)
      .map((b) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const ring of b.polygons)
          for (const r of ring)
            for (let i = 0; i < r.length; i += 2) {
              x0 = Math.min(x0, r[i]);
              x1 = Math.max(x1, r[i]);
              y0 = Math.min(y0, r[i + 1]);
              y1 = Math.max(y1, r[i + 1]);
            }
        return { b, x0, y0, x1, y1 };
      });
    solidCache.set(world, solid);
  }
  for (const s of solid) {
    if (x < s.x0 - margin || x > s.x1 + margin || y < s.y0 - margin || y > s.y1 + margin) continue;
    for (const poly of s.b.polygons) {
      if (pointInPolygon(x, y, poly) || pointInPolygon(x + margin, y, poly) || pointInPolygon(x - margin, y, poly) || pointInPolygon(x, y + margin, poly) || pointInPolygon(x, y - margin, poly)) return true;
    }
  }
  return false;
}

export interface RoutePoint {
  x: number;
  y: number;
  dist: number;
  /** Floors above ground. */
  elev: number;
  inside: boolean;
  /** Metres along the polyline from the start. */
  along: number;
}

/** Closest point on a route to (x, y). */
export function nearestOnRoute(route: Route, x: number, y: number): RoutePoint | null {
  const p = route.points;
  let best: RoutePoint | null = null;
  let s = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    const c = closestOnSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]);
    if (!best || c.dist < best.dist) {
      const k = i / 2;
      best = {
        x: c.x,
        y: c.y,
        dist: c.dist,
        elev: route.elev[k] + (route.elev[k + 1] - route.elev[k]) * c.t,
        inside: route.inside[k] === 1 && route.inside[k + 1] === 1,
        along: s + len * c.t,
      };
    }
    s += len;
  }
  return best;
}

/** Length of the route polyline, metres. */
export function polyLength(route: Route): number {
  const p = route.points;
  let s = 0;
  for (let i = 0; i + 3 < p.length; i += 2) s += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  return s;
}

/** The point a given distance along the route polyline. */
export function pointAlong(route: Route, along: number): { x: number; y: number } {
  const p = route.points;
  let s = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (s + len >= along && len > 0) {
      const t = (along - s) / len;
      return { x: p[i] + (p[i + 2] - p[i]) * t, y: p[i + 1] + (p[i + 3] - p[i + 1]) * t };
    }
    s += len;
  }
  return { x: p[p.length - 2], y: p[p.length - 1] };
}
