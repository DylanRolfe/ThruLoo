// Shape of public/data/campus.json, written by scripts/bake.ts.
// All coordinates are local metres: x east, y north of the campus origin.

import type { Polygon } from '../lib/geom';
import type { GraphData } from '../routing/types';

export interface BuildingPart {
  polygons: Polygon[];
  height: number;
  minHeight: number;
  colour?: string;
}

export interface Building {
  /** OSM id, for example "way/43250607". */
  id: string;
  code?: string;
  name?: string;
  /** Old codes and alternative names that search should accept. */
  aliases?: string[];
  /** OSM building type: university, dormitory, house, roof, ... */
  kind: string;
  /** On UW property (or carrying a UW code). Campus buildings are labelled and searchable. */
  campus: boolean;
  height: number;
  minHeight: number;
  /** Highest point including parts, for label placement. */
  top: number;
  colour?: string;
  polygons: Polygon[];
  /** A point inside the footprint. */
  centre: [number, number];
  area: number;
  /** Detailed massing. When present the parts are drawn instead of the outline. */
  parts?: BuildingPart[];
  /** Graph node ids of the public entrances, best first. */
  doors: number[];
  /** Graph node ids inside the building (hallway points on each floor) where an indoor route may start or end. */
  anchors: number[];
  /** Blocks the player. False for canopies, elevated bridges and tiny structures. */
  solid: boolean;
}

export type AreaKind =
  | 'grass' | 'park' | 'garden' | 'wood' | 'scrub' | 'wetland' | 'water' | 'pool'
  | 'parking' | 'pitch' | 'playground' | 'plaza' | 'platform' | 'construction' | 'railway';

export interface Area {
  kind: AreaKind;
  polygons: Polygon[];
}

export type RibbonKind =
  | 'road' | 'service' | 'aisle' | 'footway' | 'sidewalk' | 'path' | 'shared' | 'steps' | 'crossing'
  | 'stream' | 'rail';

export interface Ribbon {
  kind: RibbonKind;
  width: number;
  line: number[];
}

export interface NamedPlace {
  id: string;
  label: string;
  sub?: string;
  aliases?: string[];
  x: number;
  y: number;
  /** Building to highlight when this place is selected. */
  building?: string;
}

export interface CampusData {
  meta: {
    /** Latitude and longitude of the local frame's origin. */
    origin: { lat: number; lon: number };
    /** [minX, minY, maxX, maxY] of everything in the file. */
    bounds: [number, number, number, number];
    osmTimestamp?: string;
    bakedAt: string;
    attribution: string;
    /** Credit for the indoor network, when one is baked in. */
    indoorAttribution?: string;
  };
  buildings: Building[];
  areas: Area[];
  ribbons: Ribbon[];
  /** Tree positions, flat [x, y, x, y, ...]. */
  trees: number[];
  /** Wall openings where a path passes through a building: flat [x, y, radius, ...]. */
  wallGaps: number[];
  graph: GraphData;
  places: NamedPlace[];
  /** Where the player starts: [x, y, heading in radians, 0 = north, clockwise]. */
  spawn: [number, number, number];
}
