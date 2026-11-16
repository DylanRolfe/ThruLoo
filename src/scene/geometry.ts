// Turns baked campus data into a handful of merged BufferGeometries.
// Data space is (x east, y north); world space is (x, up, -y), so north is -Z.

import earcut from 'earcut';
import * as THREE from 'three';
import type { Area, AreaKind, Building, Ribbon, RibbonKind } from '../data/types';
import { hash01, ringArea, type Polygon, type Ring } from '../lib/geom';
import { AREA_COLOURS, BUILDING_PALETTE, RIBBON_COLOURS } from './palette';

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  /** Window grid coordinates on walls: whole numbers at window-bay boundaries. Zero elsewhere. */
  bays: number[] = [];
  indices: number[] = [];

  get vertexCount() {
    return this.positions.length / 3;
  }
  get triangleCount() {
    return this.indices.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, shade = 1, bu = 0, bv = 0): number {
    this.bays.push(bu, bv);
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(c.r * shade, c.g * shade, c.b * shade);
    return this.positions.length / 3 - 1;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('bay', new THREE.Float32BufferAttribute(this.bays, 2));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const reverseRing = (ring: Ring): Ring => {
  const out: number[] = [];
  for (let i = ring.length - 2; i >= 0; i -= 2) out.push(ring[i], ring[i + 1]);
  return out;
};

/** Outer ring counter-clockwise, holes clockwise. */
function normalise(polygon: Polygon): Polygon {
  return polygon.map((ring, i) => (ringArea(ring) > 0 === (i === 0) ? ring : reverseRing(ring)));
}

/** Flat cap (roof, floor or ground patch) for a polygon at height y. */
function addCap(mb: MeshBuilder, polygon: Polygon, y: number, colour: THREE.Color, up: boolean, shade = 1) {
  const flat: number[] = [];
  const holes: number[] = [];
  polygon.forEach((ring, i) => {
    if (i > 0) holes.push(flat.length / 2);
    for (const v of ring) flat.push(v);
  });
  const tris = earcut(flat, holes, 2);
  const base = mb.vertexCount;
  for (let i = 0; i < flat.length; i += 2) mb.vertex(flat[i], y, -flat[i + 1], 0, up ? 1 : -1, 0, colour, shade);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const cross = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
    // Counter-clockwise in data space faces up in world space.
    if (cross > 0 === up) mb.indices.push(base + a, base + b, base + c);
    else mb.indices.push(base + a, base + c, base + b);
  }
}

/** floorHeight > 0 lays a window grid over the walls; 0 leaves them plain. */
function addPrism(mb: MeshBuilder, polygonIn: Polygon, bottom: number, top: number, wall: THREE.Color, roof: THREE.Color, floorHeight = 0) {
  const polygon = normalise(polygonIn);
  // Walls. The base is drawn slightly darker than the top: a cheap stand-in for
  // ambient occlusion where the building meets the ground.
  const baseShade = bottom === 0 ? 0.8 : 0.92;
  for (const ring of polygon) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], ay = ring[i * 2 + 1], bx = ring[j * 2], by = ring[j * 2 + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const nx = dy / len, nz = dx / len;
      // Whole numbers of bays and floors per wall, so windows are never cut by a corner or the roofline.
      const cols = floorHeight ? Math.round(len / 3.3) : 0;
      const rows = floorHeight ? Math.round((top - bottom) / floorHeight) : 0;
      const v = mb.vertexCount;
      mb.vertex(ax, bottom, -ay, nx, 0, nz, wall, baseShade, 0, 0);
      mb.vertex(bx, bottom, -by, nx, 0, nz, wall, baseShade, cols, 0);
      mb.vertex(bx, top, -by, nx, 0, nz, wall, 1, cols, rows);
      mb.vertex(ax, top, -ay, nx, 0, nz, wall, 1, 0, rows);
      mb.indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
  addCap(mb, polygon, top, roof, true);
  if (bottom > 0) addCap(mb, polygon, bottom, wall, false, 0.7);
}

const RESIDENTIAL = new Set(['dormitory', 'apartments', 'residential', 'house', 'detached', 'terrace', 'semidetached_house']);

function parseColour(css: string | undefined): THREE.Color | null {
  if (!css) return null;
  const s = css.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s) || s in THREE.Color.NAMES) return new THREE.Color(s);
  return null;
}

export function buildingColours(b: Building): { wall: THREE.Color; roof: THREE.Color } {
  const h = hash01(b.id);
  let wall: THREE.Color;
  if (!b.campus) {
    wall = new THREE.Color(BUILDING_PALETTE.context[Math.floor(h * BUILDING_PALETTE.context.length)]);
  } else {
    const set = RESIDENTIAL.has(b.kind) ? BUILDING_PALETTE.residence : BUILDING_PALETTE.academic;
    wall = new THREE.Color(set[Math.floor(h * set.length)]);
    const tagged = parseColour(b.colour);
    if (tagged) wall.lerp(tagged, 0.3);
  }
  // Small lightness jitter so neighbours with the same palette entry still read as separate.
  wall.offsetHSL(0, 0, (hash01(b.id, 7) - 0.5) * 0.05);
  const roof = wall.clone().lerp(new THREE.Color(BUILDING_PALETTE.roof), b.campus ? 0.62 : 0.5);
  return { wall, roof };
}

export interface BuildingMesh {
  geometry: THREE.BufferGeometry;
  /** First triangle index of each building, in building order. */
  triStart: Uint32Array;
}

export function buildBuildingGeometry(buildings: Building[]): BuildingMesh {
  const mb = new MeshBuilder();
  const triStart = new Uint32Array(buildings.length);
  buildings.forEach((b, i) => {
    triStart[i] = mb.triangleCount;
    const { wall, roof } = buildingColours(b);
    // Windows on campus buildings only: the surrounding city stays plain massing.
    const floor = !b.campus || b.kind === 'roof' ? 0 : RESIDENTIAL.has(b.kind) ? 3.1 : 3.8;
    if (b.parts) {
      for (const part of b.parts) {
        const tint = parseColour(part.colour);
        const w = tint ? wall.clone().lerp(tint, 0.25) : wall;
        for (const poly of part.polygons) addPrism(mb, poly, part.minHeight, part.height, w, roof, floor);
      }
    } else {
      for (const poly of b.polygons) addPrism(mb, poly, b.minHeight, b.height, wall, roof, floor);
    }
  });
  return { geometry: mb.build(), triStart };
}

/** Geometry for a single building, slightly inflated, used for the selection highlight. */
export function buildHighlightGeometry(b: Building): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const white = new THREE.Color('#ffffff');
  if (b.parts) for (const part of b.parts) for (const poly of part.polygons) addPrism(mb, poly, part.minHeight, part.height + 0.15, white, white);
  else for (const poly of b.polygons) addPrism(mb, poly, b.minHeight, b.height + 0.15, white, white);
  return mb.build();
}

/** Which building a triangle of the merged mesh belongs to. */
export function buildingAtTriangle(triStart: Uint32Array, faceIndex: number): number {
  let lo = 0, hi = triStart.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (triStart[mid] <= faceIndex) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function buildAreaGeometry(areas: Area[], kinds: AreaKind[]): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  // Paint in the order given, so later kinds sit on top of earlier ones.
  for (const kind of kinds) {
    const base = new THREE.Color(AREA_COLOURS[kind]);
    areas.forEach((area, i) => {
      if (area.kind !== kind) return;
      const c = base.clone().offsetHSL(0, 0, (hash01(kind, i) - 0.5) * 0.025);
      for (const poly of area.polygons) addCap(mb, normalise(poly), 0, c, true);
    });
  }
  return mb.build();
}

export function buildRibbonGeometry(ribbons: Ribbon[], kinds: RibbonKind[], widen = 0): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const up = (a: number, b: number, c: number, pts: number[]) => {
    const cross = (pts[b * 2] - pts[a * 2]) * (pts[c * 2 + 1] - pts[a * 2 + 1]) - (pts[b * 2 + 1] - pts[a * 2 + 1]) * (pts[c * 2] - pts[a * 2]);
    return cross > 0;
  };
  for (const kind of kinds) {
    const colour = new THREE.Color(RIBBON_COLOURS[kind]);
    for (const r of ribbons) {
      if (r.kind !== kind) continue;
      // Drop repeated points.
      const p: number[] = [];
      for (let i = 0; i < r.line.length; i += 2) {
        const n = p.length;
        if (n >= 2 && Math.hypot(r.line[i] - p[n - 2], r.line[i + 1] - p[n - 1]) < 0.05) continue;
        p.push(r.line[i], r.line[i + 1]);
      }
      const n = p.length / 2;
      if (n < 2) continue;
      const half = (r.width + widen) / 2;
      const edge: number[] = []; // left, right per point
      for (let i = 0; i < n; i++) {
        let tx = 0, ty = 0;
        if (i > 0) {
          const dx = p[i * 2] - p[i * 2 - 2], dy = p[i * 2 + 1] - p[i * 2 - 1];
          const l = Math.hypot(dx, dy);
          tx += dx / l;
          ty += dy / l;
        }
        let px = tx, py = ty; // direction of the incoming segment
        if (i < n - 1) {
          const dx = p[i * 2 + 2] - p[i * 2], dy = p[i * 2 + 3] - p[i * 2 + 1];
          const l = Math.hypot(dx, dy);
          if (i === 0) [px, py] = [dx / l, dy / l];
          tx += dx / l;
          ty += dy / l;
        }
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        // Miter: widen at bends so the ribbon keeps its width, but never spike.
        const cos = Math.max(0.5, tx * px + ty * py);
        const m = half / cos;
        edge.push(p[i * 2] - ty * m, p[i * 2 + 1] + tx * m, p[i * 2] + ty * m, p[i * 2 + 1] - tx * m);
      }
      const base = mb.vertexCount;
      for (let i = 0; i < edge.length; i += 2) mb.vertex(edge[i], 0, -edge[i + 1], 0, 1, 0, colour);
      for (let i = 0; i < n - 1; i++) {
        const l0 = i * 2, r0 = i * 2 + 1, l1 = i * 2 + 2, r1 = i * 2 + 3;
        for (const [a, b, c] of [[l0, r0, r1], [l0, r1, l1]]) {
          if (up(a, b, c, edge)) mb.indices.push(base + a, base + b, base + c);
          else mb.indices.push(base + a, base + c, base + b);
        }
      }
    }
  }
  return mb.build();
}

/**
 * Vertical wall quads for the physics collider: solid buildings only, with
 * openings cut where a mapped path passes through a wall.
 */
export function buildWallCollider(buildings: Building[], wallGaps: number[]): { vertices: Float32Array; indices: Uint32Array } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const quad = (ax: number, ay: number, bx: number, by: number, h: number) => {
    const v = vertices.length / 3;
    vertices.push(ax, 0, -ay, bx, 0, -by, bx, h, -by, ax, h, -ay);
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  for (const b of buildings) {
    if (!b.solid) continue;
    const h = Math.max(b.top, 4);
    const near: number[] = [];
    for (let g = 0; g < wallGaps.length; g += 3) {
      if (Math.abs(wallGaps[g] - b.centre[0]) < 400 && Math.abs(wallGaps[g + 1] - b.centre[1]) < 400) near.push(wallGaps[g], wallGaps[g + 1], wallGaps[g + 2]);
    }
    for (const poly of b.polygons) for (const ring of poly) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[i * 2], ay = ring[i * 2 + 1], bx = ring[j * 2], by = ring[j * 2 + 1];
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        // Intervals of this wall, as fractions, that fall inside a gap circle.
        const cuts: [number, number][] = [];
        for (let g = 0; g < near.length; g += 3) {
          const t = ((near[g] - ax) * dx + (near[g + 1] - ay) * dy) / (len * len);
          const cx = ax + dx * t, cy = ay + dy * t;
          const d = Math.hypot(near[g] - cx, near[g + 1] - cy);
          const r = near[g + 2];
          if (d >= r) continue;
          const w = Math.sqrt(r * r - d * d) / len;
          if (t + w > 0 && t - w < 1) cuts.push([t - w, t + w]);
        }
        if (!cuts.length) {
          quad(ax, ay, bx, by, h);
          continue;
        }
        cuts.sort((p, q) => p[0] - q[0]);
        let at = 0;
        for (const [c0, c1] of cuts) {
          if (c0 > at + 0.02 / len) quad(ax + dx * at, ay + dy * at, ax + dx * c0, ay + dy * c0, h);
          at = Math.max(at, c1);
        }
        if (at < 1 - 0.02 / len) quad(ax + dx * at, ay + dy * at, bx, by, h);
      }
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
