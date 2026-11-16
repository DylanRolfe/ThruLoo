// Placing GPS fixes on the real campus: never inside a wall.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CampusData } from '../data/types';
import { IndoorSurface } from '../indoor/surface';
import { RouteGraph } from '../routing/graph';
import { PlaceIndex } from '../routing/places';
import { indoorOnlyProfile } from '../routing/profiles';
import { HeightField } from '../scene/heightfield';
import { insideBuilding, nearestOnRoute, placeFix, pointAlong, polyLength } from './nav';
import type { World } from './world';

const campus: CampusData = JSON.parse(readFileSync(new URL('../../public/data/campus.json', import.meta.url), 'utf8'));
const world: World = {
  campus,
  graph: new RouteGraph(campus.graph),
  places: new PlaceIndex(campus.buildings, campus.places),
  heights: new HeightField(campus.buildings, campus.meta.bounds),
  surface: new IndoorSurface(campus.graph),
  buildingById: new Map(campus.buildings.map((b) => [b.id, b])),
};
const building = (code: string) => campus.buildings.find((b) => b.code === code)!;

describe('placeFix', () => {
  it('puts a fix in the middle of a building with hallways on one of its hallways', () => {
    const [x, y] = building('MC').centre;
    const p = placeFix(world, null, x, y, 10);
    expect(p.indoor).toBe(true);
    expect(world.surface.at(p.x, p.y, p.h)).not.toBeNull();
    expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(30);
  });

  it('puts a fix inside a building with no hallways on the nearest outdoor path, outside the walls', () => {
    const b = campus.buildings.find((c) => c.solid && c.campus && c.area > 400 && !world.surface.nearest(c.centre[0], c.centre[1], 30))!;
    const p = placeFix(world, null, b.centre[0], b.centre[1], 10);
    expect(p.indoor).toBe(false);
    expect(insideBuilding(world, p.x, p.y, 0)).toBe(false);
  });

  it('leaves a fix in the open where it is', () => {
    const [sx, sy] = campus.spawn;
    expect(insideBuilding(world, sx, sy)).toBe(false);
    const p = placeFix(world, null, sx, sy, 10);
    expect([p.x, p.y, p.indoor]).toEqual([sx, sy, false]);
  });

  it('keeps to the route close to it, at the right floor, and reports how far along', () => {
    const a = world.places.resolve('MC')!, b = world.places.resolve('RCH 101')!;
    const route = world.graph.route(world.places.endpoint(a)!, world.places.endpoint(b)!, indoorOnlyProfile())!;
    const len = polyLength(route);
    const mid = pointAlong(route, len / 2);
    const p = placeFix(world, route, mid.x + 6, mid.y - 4, 10);
    expect(p.onRoute).toBe(true);
    expect(p.along).toBeGreaterThan(len / 2 - 15);
    expect(p.along).toBeLessThan(len / 2 + 15);
    const near = nearestOnRoute(route, p.x, p.y)!;
    expect(near.dist).toBeLessThan(0.01);
    if (p.indoor) expect(world.surface.at(p.x, p.y, p.h)).not.toBeNull();
    // Far from the route: not on it.
    const off = placeFix(world, route, mid.x + 200, mid.y + 200, 10);
    expect(off.onRoute).toBe(false);
    expect(off.offRoute).toBeGreaterThan(100);
  });
});
