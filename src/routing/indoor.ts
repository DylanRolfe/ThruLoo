// Reads the WATIsGrass indoor network (hallways, tunnels, bridges, stairs,
// doors) into the shape the graph builder takes.
//
// WATIsGrass (https://watisgrass.co, GPL-3.0) stores everything as
// GeoJSON. Its graph is implicit: a node is a (coordinate, building, floor)
// triple, and two features are connected exactly where they name the same
// triple. This parser keeps that rule, so the network here is the one their
// app routes over. See data/indoor/watisgrass/FORMAT.md for the format.
//
// This file is original ThruLoo code (GPL-3.0-only, see LICENSE); no WATIsGrass
// source code is copied. Credit and a list of changes: NOTICE.md.

import type { Pt } from '../lib/geom';
import type { EdgeKind } from './types';

export interface IndoorNode {
  key: string;
  x: number;
  y: number;
  code: string;
  floor: string;
  /** Height in floors above ground, solved from the stairwell data. */
  level: number;
  /** OSM id of the building this node is in, filled in by the caller. */
  building?: string;
  stairs?: boolean;
}

export interface IndoorEdge {
  a: string;
  b: string;
  kind: EdgeKind;
  /** Full polyline including both ends, for tunnels and bridges with bends. */
  coords?: Pt[];
  /** Height of each point of coords, in floors. */
  levels?: number[];
  /** Fixed seconds: climbing stairs, opening a door. */
  penalty?: number;
  /** Edges of one hallway on one floor share a group and are merged into runs. */
  group: string;
}

export interface IndoorExit {
  /** Indoor node just inside the door. */
  node: string;
  x: number;
  y: number;
  code: string;
}

export interface IndoorAnchor {
  code: string;
  floor: string;
  node: string;
}

export interface IndoorInput {
  nodes: IndoorNode[];
  edges: IndoorEdge[];
  exits: IndoorExit[];
  /** Points inside each building where a route may start or end. */
  anchors: IndoorAnchor[];
  report: {
    hallways: number;
    tunnels: number;
    bridges: number;
    stairwells: number;
    doorsOutside: number;
    doorsBetween: number;
    skippedWalkways: number;
    codes: string[];
    levelConflicts: number;
    anchorsDropped: number;
  };
}

interface BF {
  buildingCode: string;
  floor: string;
}
interface Feature {
  geometry: { type: string; coordinates: any };
  properties: any;
}

/** Seconds to climb or descend one floor, as WATIsGrass models it. */
export const SECONDS_PER_FLOOR = 14;
const DOOR_SECONDS = 2;
/** A tunnel is at least this far below ground, in floors. */
const TUNNEL_DIP = 0.9;

const bfKey = (b: BF) => `${b.buildingCode}|${b.floor}`;
const isOutside = (b: BF) => b.buildingCode === 'OUT';
const sameBF = (a: BF, b: BF) => a.buildingCode === b.buildingCode && a.floor === b.floor;

/** Height a floor label suggests when nothing else is known: "1" is ground, "B" is one below. */
function nominalLevel(floor: string): number {
  if (/^B\d*$/i.test(floor)) return -(parseInt(floor.slice(1), 10) || 1);
  const n = parseInt(floor, 10);
  return Number.isFinite(n) ? n - 1 : 0;
}

export function parseWatIsGrass(paths: Feature[], buildings: Feature[], project: (lon: number, lat: number) => Pt): IndoorInput {
  const nodes = new Map<string, IndoorNode>();
  const edges: IndoorEdge[] = [];
  const exits: IndoorExit[] = [];
  const node = (coord: [number, number], b: BF): string => {
    const key = `${coord[0]},${coord[1]}|${bfKey(b)}`;
    if (!nodes.has(key)) {
      const [x, y] = project(coord[0], coord[1]);
      nodes.set(key, { key, x, y, code: b.buildingCode, floor: b.floor, level: 0 });
    }
    return key;
  };

  // Height relations between building floors: [a, b, floors b is above a].
  const relations: [string, string, number][] = [];
  const hasExit = new Set<string>();
  const report = { hallways: 0, tunnels: 0, bridges: 0, stairwells: 0, doorsOutside: 0, doorsBetween: 0, skippedWalkways: 0, codes: [] as string[], levelConflicts: 0, anchorsDropped: 0 };

  paths.forEach((f, fi) => {
    const p = f.properties;
    const type: string = p.type;
    if (f.geometry.type === 'LineString') {
      // Outdoor walkways are WATIsGrass's own stand-in for the path network; OSM's is used instead.
      if (type === 'walkway' || isOutside(p.start) || isOutside(p.end)) {
        report.skippedWalkways++;
        return;
      }
      const coords: [number, number][] = f.geometry.coordinates;
      const kind: EdgeKind = type === 'tunnel' ? 'tunnel' : type === 'bridge' ? 'skywalk' : 'corridor';
      if (type === 'tunnel') report.tunnels++;
      else if (type === 'bridge') report.bridges++;
      else report.hallways++;
      if (sameBF(p.start, p.end)) {
        // Along one floor: every vertex is a place other features may connect.
        for (let i = 0; i + 1 < coords.length; i++) {
          edges.push({ a: node(coords[i], p.start), b: node(coords[i + 1], p.start), kind, group: `${kind}:${bfKey(p.start)}` });
        }
      } else {
        // Between two building floors: one link, joined only at its ends.
        const a = node(coords[0], p.start), b = node(coords[coords.length - 1], p.end);
        edges.push({ a, b, kind, coords: coords.map(([lon, lat]) => project(lon, lat)), group: `link:${fi}` });
        relations.push([bfKey(p.start), bfKey(p.end), 0]);
      }
    } else if (f.geometry.type === 'Point') {
      const coord: [number, number] = f.geometry.coordinates;
      if (type === 'door' || type === 'open') {
        if (isOutside(p.start) || isOutside(p.end)) {
          const inner: BF = isOutside(p.start) ? p.end : p.start;
          if (isOutside(inner)) return;
          const [x, y] = project(coord[0], coord[1]);
          exits.push({ node: node(coord, inner), x, y, code: inner.buildingCode });
          hasExit.add(bfKey(inner));
          report.doorsOutside++;
        } else if (!sameBF(p.start, p.end)) {
          edges.push({ a: node(coord, p.start), b: node(coord, p.end), kind: type === 'door' ? 'door' : 'corridor', penalty: type === 'door' ? DOOR_SECONDS : 0, group: `link:${fi}` });
          relations.push([bfKey(p.start), bfKey(p.end), 0]);
          report.doorsBetween++;
        }
      } else if (type === 'stairs' || type === 'elevator') {
        const stops: (BF & { level: number })[] = [...(p.connections ?? [])].sort((s, t) => s.level - t.level);
        report.stairwells++;
        for (let i = 0; i + 1 < stops.length; i++) {
          const rise = stops[i + 1].level - stops[i].level;
          const a = node(coord, stops[i]), b = node(coord, stops[i + 1]);
          nodes.get(a)!.stairs = true;
          nodes.get(b)!.stairs = true;
          edges.push({ a, b, kind: type === 'stairs' ? 'stairs' : 'elevator', penalty: Math.abs(rise) * SECONDS_PER_FLOOR, group: `link:${fi}:${i}` });
          relations.push([bfKey(stops[i]), bfKey(stops[i + 1]), rise]);
        }
      }
    }
  });

  // ------------------------------------------------------------ heights
  // The data gives relative heights only (floors within a stairwell, and
  // "these two floors meet" for tunnels, bridges and doors). Spread them
  // through each connected group of floors, then shift the group so the
  // floors that open to the outside sit at ground level on average.
  const adj = new Map<string, [string, number][]>();
  const link = (a: string, b: string, d: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push([b, d]);
  };
  for (const [a, b, d] of relations) {
    link(a, b, d);
    link(b, a, -d);
  }
  const floors = new Set<string>();
  for (const n of nodes.values()) floors.add(`${n.code}|${n.floor}`);
  const height = new Map<string, number>();
  for (const seed of floors) {
    if (height.has(seed)) continue;
    const group = [seed];
    height.set(seed, 0);
    for (let i = 0; i < group.length; i++) {
      const cur = group[i];
      for (const [next, d] of adj.get(cur) ?? []) {
        const h = height.get(cur)! + d;
        if (!height.has(next)) {
          height.set(next, h);
          group.push(next);
        } else if (Math.abs(height.get(next)! - h) > 0.01) {
          report.levelConflicts++; // real ground is not flat; the first answer stands
        }
      }
    }
    const atGround = group.filter((k) => hasExit.has(k)).map((k) => height.get(k)!).sort((p, q) => p - q);
    const shift = atGround.length
      ? -atGround[atGround.length >> 1]
      : nominalLevel(seed.split('|')[1]) - height.get(seed)!;
    for (const k of group) height.set(k, Math.max(-3, Math.min(14, height.get(k)! + shift)));
  }
  for (const n of nodes.values()) n.level = height.get(`${n.code}|${n.floor}`) ?? 0;

  // Tunnels dip below ground between their ends; bridges and other links run straight from floor to floor.
  for (const e of edges) {
    if (!e.coords) continue;
    const la = nodes.get(e.a)!.level, lb = nodes.get(e.b)!.level;
    // The solved heights are approximate (real ground slopes, this model's does
    // not), so a bridge can come out lower than a bridge can be. It crosses
    // open air: keep it at least a storey up.
    const lowBridge = e.kind === 'skywalk' && Math.min(la, lb) < 1;
    // A tunnel between two basements is already underground and runs level.
    // One that the height solver left at ground level is taken down a ramp,
    // along, and up again.
    const low = lowBridge ? 1 : Math.min(la, lb, -TUNNEL_DIP);
    const level = e.kind === 'tunnel' && Math.abs(la - lb) < 0.01 && la <= low + 0.01;
    if ((e.kind !== 'tunnel' && !lowBridge) || level) {
      e.levels = e.coords.map((_, i) => la + ((lb - la) * i) / (e.coords!.length - 1));
      continue;
    }
    // The change in height is a ramp at each end, measured along the whole
    // line so it is never squeezed into one short first segment. A point is
    // added where each ramp ends.
    const pts = e.coords;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const ramp = Math.min(9, total * 0.35);
    const pointAt = (s: number): Pt => {
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const t = cum[i] > cum[i - 1] ? (s - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    };
    const levelAt = (s: number) => (s < ramp ? la + ((low - la) * s) / ramp : s > total - ramp ? lb + ((low - lb) * (total - s)) / ramp : low);
    const stops = [...new Set([...cum, ramp, total - ramp])].filter((s) => s >= 0 && s <= total).sort((p, q) => p - q);
    const coords: Pt[] = [], levels: number[] = [];
    for (const s of stops) {
      const p = s === 0 ? pts[0] : s === total ? pts[pts.length - 1] : pointAt(s);
      const prev = coords[coords.length - 1];
      if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.05) continue;
      coords.push(p);
      levels.push(levelAt(s));
    }
    e.coords = coords;
    e.levels = levels;
  }

  // ------------------------------------------------------------ anchors
  const anchors: IndoorAnchor[] = [];
  for (const f of buildings) {
    if (f.geometry.type !== 'Point' || f.properties.type !== 'building') continue;
    const b = f.properties.building;
    for (const floor of b.floors as string[]) {
      const key = `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}|${b.buildingCode}|${floor}`;
      if (nodes.has(key)) anchors.push({ code: b.buildingCode, floor, node: key });
      else report.anchorsDropped++;
    }
  }

  report.codes = [...new Set([...nodes.values()].map((n) => n.code))].sort();
  return { nodes: [...nodes.values()], edges, exits, anchors, report };
}
