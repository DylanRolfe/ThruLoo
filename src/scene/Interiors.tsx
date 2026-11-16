// The walkable insides: hallways, tunnels and bridges as real floors.
//
// Hallways are flat floors with a dark outline. Tunnels are open trenches cut
// below ground level, bridges have railings, and stairwells are a pad on each
// floor joined by a post. Everything is one merged mesh. It sits inside the
// building shells, so it only shows when the buildings are drawn see-through
// (the character is indoors) or where it leaves them (tunnels and bridges).

import { useMemo } from 'react';
import * as THREE from 'three';
import { FLOOR_HEIGHT, HALF_WIDTH } from '../indoor/surface';
import type { GraphData } from '../routing/types';
import { useApp } from '../state/store';
import type { World } from '../state/world';
import { INTERIOR_COLOURS } from './palette';

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  quad(p: number[][], n: [number, number, number], c: THREE.Color) {
    const base = this.positions.length / 3;
    for (const v of p) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(c.r, c.g, c.b);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

/** Left and right edge of a polyline at a half-width, with mitred corners. Data space. */
function edges(px: number[], py: number[], half: number): { lx: number[]; ly: number[]; rx: number[]; ry: number[] } {
  const n = px.length;
  const lx: number[] = [], ly: number[] = [], rx: number[] = [], ry: number[] = [];
  for (let i = 0; i < n; i++) {
    let ix = 0, iy = 0, ox = 0, oy = 0;
    if (i > 0) {
      const l = Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]) || 1;
      ix = (px[i] - px[i - 1]) / l;
      iy = (py[i] - py[i - 1]) / l;
    }
    if (i < n - 1) {
      const l = Math.hypot(px[i + 1] - px[i], py[i + 1] - py[i]) || 1;
      ox = (px[i + 1] - px[i]) / l;
      oy = (py[i + 1] - py[i]) / l;
    }
    if (i === 0) [ix, iy] = [ox, oy];
    if (i === n - 1) [ox, oy] = [ix, iy];
    let tx = ix + ox, ty = iy + oy;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-4) [tx, ty] = [ix, iy];
    else [tx, ty] = [tx / tl, ty / tl];
    const m = half / Math.max(0.5, tx * ix + ty * iy);
    lx.push(px[i] - ty * m);
    ly.push(py[i] + tx * m);
    rx.push(px[i] + ty * m);
    ry.push(py[i] - tx * m);
  }
  return { lx, ly, rx, ry };
}

export function buildInteriorGeometry(graph: GraphData): THREE.BufferGeometry {
  const b = new Builder();
  const colour = (hex: string) => new THREE.Color(hex);
  const C = Object.fromEntries(Object.entries(INTERIOR_COLOURS).map(([k, v]) => [k, colour(v)]));
  const UP: [number, number, number] = [0, 1, 0];

  for (const e of graph.edges) {
    if (e.env !== 'indoor') continue;
    const half = HALF_WIDTH[e.kind];
    if (!half || e.length < 0.3) continue;

    // Points and heights, without repeats.
    const px: number[] = [], py: number[] = [], ph: number[] = [];
    const count = e.geometry.length / 2;
    for (let i = 0; i < count; i++) {
      const x = e.geometry[i * 2], y = e.geometry[i * 2 + 1];
      const h = (e.elev && e.elev.length === count ? e.elev[i] : e.level) * FLOOR_HEIGHT;
      const n = px.length;
      if (n && Math.hypot(x - px[n - 1], y - py[n - 1]) < 0.05) continue;
      px.push(x);
      py.push(y);
      ph.push(h);
    }
    if (px.length < 2) continue;

    const floor = e.kind === 'tunnel' ? C.tunnel : e.kind === 'skywalk' ? C.bridge : e.kind === 'door' ? C.door : C.hall;
    // A wider, darker strip just underneath outlines the whole connected floor
    // plan: where two hallways meet, the upper floors cover the join.
    const casing = edges(px, py, half + 0.3);
    const top = edges(px, py, half);
    for (let i = 0; i + 1 < px.length; i++) {
      b.quad(
        [[casing.lx[i], ph[i] - 0.04, -casing.ly[i]], [casing.rx[i], ph[i] - 0.04, -casing.ry[i]], [casing.rx[i + 1], ph[i + 1] - 0.04, -casing.ry[i + 1]], [casing.lx[i + 1], ph[i + 1] - 0.04, -casing.ly[i + 1]]],
        UP, C.outline,
      );
      b.quad(
        [[top.lx[i], ph[i], -top.ly[i]], [top.rx[i], ph[i], -top.ry[i]], [top.rx[i + 1], ph[i + 1], -top.ry[i + 1]], [top.lx[i + 1], ph[i + 1], -top.ly[i + 1]]],
        UP, floor,
      );

      // Sides. Tunnels get trench walls up to ground level; bridges get railings.
      const wallTop = (h: number) => (e.kind === 'tunnel' ? (h < -0.25 ? 0 : h) : e.kind === 'skywalk' ? h + 1.15 : h);
      const t0 = wallTop(ph[i]), t1 = wallTop(ph[i + 1]);
      if (t0 - ph[i] > 0.05 || t1 - ph[i + 1] > 0.05) {
        const wall = e.kind === 'tunnel' ? C.tunnelWall : C.railing;
        for (const [sx, sy] of [[top.lx, top.ly], [top.rx, top.ry]] as const) {
          const dx = sx[i + 1] - sx[i], dy = sy[i + 1] - sy[i];
          const l = Math.hypot(dx, dy) || 1;
          b.quad(
            [[sx[i], ph[i], -sy[i]], [sx[i + 1], ph[i + 1], -sy[i + 1]], [sx[i + 1], t1, -sy[i + 1]], [sx[i], t0, -sy[i]]],
            [dy / l, 0, dx / l], wall,
          );
        }
      }
    }
  }

  // Stairwells: a pad on each floor and a post between them.
  const pads = new Set<string>();
  const pad = (x: number, y: number, h: number) => {
    const key = `${x},${y},${h.toFixed(2)}`;
    if (pads.has(key)) return;
    pads.add(key);
    const r = 1.25;
    b.quad([[x - r, h + 0.03, -(y - r)], [x + r, h + 0.03, -(y - r)], [x + r, h + 0.03, -(y + r)], [x - r, h + 0.03, -(y + r)]], UP, C.stairs);
    const q = r * 0.55;
    b.quad([[x - q, h + 0.05, -(y - q)], [x + q, h + 0.05, -(y - q)], [x + q, h + 0.05, -(y + q)], [x - q, h + 0.05, -(y + q)]], UP, C.stairsMark);
  };
  for (const e of graph.edges) {
    if (e.kind !== 'stairs' && e.kind !== 'elevator') continue;
    const a = graph.nodes[e.a], c = graph.nodes[e.b];
    const h0 = a.level * FLOOR_HEIGHT, h1 = c.level * FLOOR_HEIGHT;
    pad(a.x, a.y, h0);
    pad(c.x, c.y, h1);
    const lo = Math.min(h0, h1), hi = Math.max(h0, h1), w = 0.09;
    for (const [nx, nz, x0, y0, x1, y1] of [[0, 1, -w, -w, w, -w], [1, 0, w, -w, w, w], [0, -1, w, w, -w, w], [-1, 0, -w, w, -w, -w]] as const) {
      b.quad([[a.x + x0, lo, -(a.y + y0)], [a.x + x1, lo, -(a.y + y1)], [a.x + x1, hi, -(a.y + y1)], [a.x + x0, hi, -(a.y + y0)]], [nx, 0, nz], C.post);
    }
  }
  return b.build();
}

export function Interiors({ world }: { world: World }) {
  const visible = useApp((s) => s.playerIndoors || s.flyIndoors || s.showIndoor || s.routeMode !== 'outdoor');
  const geometry = useMemo(() => buildInteriorGeometry(world.campus.graph), [world]);
  return (
    <mesh geometry={geometry} visible={visible}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}
