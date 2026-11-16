// Getting from the 3D campus to a building's floor plans, by asking.
//
// Nothing is decided for the person. The outdoor route takes them to the
// building. Near a building that has plans there is an "Indoor map" button;
// on arriving, a prompt offers the same. Inside, they say which floor they are
// on and which room they want. No particular door has to be found, so a rough
// location is enough.
//
// Also here: noticing a character stuck inside a wall, and getting it out.

import type { Building } from '../data/types';
import { closestOnSegment, pointInRing } from '../lib/geom';
import { outdoorProfile } from '../routing/profiles';
import { player } from '../state/runtime';
import { useApp } from './store';
import { getWorld } from '../state/world';

/** How far inside a wall, for how many checks in a row, before "stuck" is offered. */
const STUCK_DEPTH = 0.3;
const STUCK_CHECKS = 2;
/** Getting unstuck leaves the character at least this far (metres) from any wall, so one step back doesn't re-trap them. */
const CLEARANCE = 6;

interface Outline {
  b: Building;
  box: [number, number, number, number];
}
let solid: Outline[] | null = null;

function outline(b: Building): Outline {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of b.polygons) {
    const r = poly[0];
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
    }
  }
  return { b, box: [x0, y0, x1, y1] };
}

/** Metres from a point to a building: negative inside (by how far in), positive outside. */
export function distanceToBuilding(b: Building, x: number, y: number): number {
  let edge = Infinity, inside = false;
  for (const poly of b.polygons) {
    const r = poly[0];
    if (pointInRing(x, y, r)) inside = true;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) edge = Math.min(edge, closestOnSegment(x, y, r[j], r[j + 1], r[i], r[i + 1]).dist);
  }
  return inside ? -edge : edge;
}

let stuckFor = 0;

/** Called a few times a second while the app runs: is the character stuck in a wall? */
export function watchSurroundings() {
  const app = useApp.getState();
  const world = getWorld();
  const walking = app.mode === 'walk';

  // ---- stuck in a wall: inside a building's outline but not on a hallway, tunnel or bridge
  if (!solid) solid = world.campus.buildings.filter((b) => b.solid).map(outline);
  let inWall = false;
  if (walking && !player.indoor && !app.follow) {
    for (const o of solid) {
      const [x0, y0, x1, y1] = o.box;
      if (player.x < x0 || player.x > x1 || player.y < y0 || player.y > y1) continue;
      if (distanceToBuilding(o.b, player.x, player.y) < -STUCK_DEPTH) {
        inWall = true;
        break;
      }
    }
  }
  stuckFor = inWall ? stuckFor + 1 : 0;
  const stuck = stuckFor >= STUCK_CHECKS;
  if (stuck !== app.stuck) app.set({ stuck });
}

/** Nearest point on any solid building's outline to (x, y), with the distance, or null. */
function nearestWall(x: number, y: number): { x: number; y: number; dist: number } | null {
  if (!solid) solid = getWorld().campus.buildings.filter((b) => b.solid).map(outline);
  let best: { x: number; y: number; dist: number } | null = null;
  for (const o of solid) {
    const [x0, y0, x1, y1] = o.box;
    if (x < x0 - CLEARANCE * 2 || x > x1 + CLEARANCE * 2 || y < y0 - CLEARANCE * 2 || y > y1 + CLEARANCE * 2) continue;
    for (const poly of o.b.polygons) {
      const r = poly[0];
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const c = closestOnSegment(x, y, r[j], r[j + 1], r[i], r[i + 1]);
        if (!best || c.dist < best.dist) best = c;
      }
    }
  }
  return best;
}

const insideAnySolid = (x: number, y: number) => (solid ?? []).some((o) => distanceToBuilding(o.b, x, y) < 0);

/** Put the character on the nearest outdoor path, then a few metres further from the wall. */
export function getUnstuck() {
  const hit = getWorld().graph.snap(player.x, player.y, 400, outdoorProfile);
  if (hit) {
    let { x, y } = hit;
    const wall = nearestWall(x, y);
    if (wall && wall.dist < CLEARANCE) {
      // Away from the wall; fall back to shorter pushes if that runs into another building.
      let dx = x - wall.x, dy = y - wall.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) [dx, dy] = [x - player.x, y - player.y];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      for (const push of [CLEARANCE - wall.dist, (CLEARANCE - wall.dist) * 0.66, (CLEARANCE - wall.dist) * 0.33]) {
        const nx = x + dx * push, ny = y + dy * push;
        if (!insideAnySolid(nx, ny)) {
          [x, y] = [nx, ny];
          break;
        }
      }
    }
    player.teleport = { x, y, h: 0, indoor: false };
  }
  stuckFor = 0;
  useApp.getState().set({ stuck: false });
}
