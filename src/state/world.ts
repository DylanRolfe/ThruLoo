// The static campus: loaded once, then read-only.

import type { Building, CampusData } from '../data/types';
import { RouteGraph } from '../routing/graph';
import { PlaceIndex } from '../routing/places';
import { IndoorSurface } from '../indoor/surface';
import { HeightField } from '../scene/heightfield';

export interface World {
  campus: CampusData;
  graph: RouteGraph;
  places: PlaceIndex;
  heights: HeightField;
  /** Where the character can stand indoors. */
  surface: IndoorSurface;
  buildingById: Map<string, Building>;
}

let world: World | null = null;

export async function loadWorld(): Promise<World> {
  if (world) return world;
  const res = await fetch(`${import.meta.env.BASE_URL}data/campus.json`);
  if (!res.ok) throw new Error(`Could not load campus data (HTTP ${res.status}). Run "npm run data" to build it.`);
  const campus: CampusData = await res.json();
  world = {
    campus,
    graph: new RouteGraph(campus.graph),
    places: new PlaceIndex(campus.buildings, campus.places),
    heights: new HeightField(campus.buildings, campus.meta.bounds),
    surface: new IndoorSurface(campus.graph),
    buildingById: new Map(campus.buildings.map((b) => [b.id, b])),
  };
  return world;
}

export function getWorld(): World {
  if (!world) throw new Error('World not loaded yet');
  return world;
}
