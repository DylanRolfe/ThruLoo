// Camera-scaled ribbons for lines that have to stay readable from walking
// height up to the whole-campus map: the route, and the indoor network.
// Each point becomes two vertices at the same position; the vertex shader
// pushes them apart by a width uniform.

import * as THREE from 'three';
import { FLOOR_HEIGHT } from '../indoor/surface';

export { FLOOR_HEIGHT };

export interface RibbonLine {
  /** [x, y, ...] in data space. */
  points: number[];
  /** Height of each point in floors above ground. Flat on the ground when omitted. */
  elev?: number[];
  /** 1 where the point is indoors. */
  inside?: number[];
  colour?: THREE.Color;
}

const WHITE = new THREE.Color('#ffffff');

/**
 * upright adds a second, vertical ribbon along each line, so it stays visible
 * from walking height instead of thinning to a sliver when seen edge-on.
 */
export function buildRibbons(lines: RibbonLine[], upright = false): THREE.BufferGeometry {
  const position: number[] = [], offset: number[] = [], side: number[] = [], along: number[] = [], inside: number[] = [], colour: number[] = [], index: number[] = [];

  for (const line of lines) {
    // Drop repeated points (same place and same height).
    const px: number[] = [], py: number[] = [], ph: number[] = [], pin: number[] = [];
    for (let i = 0; i < line.points.length; i += 2) {
      const x = line.points[i], y = line.points[i + 1];
      const h = line.elev ? line.elev[i / 2] : 0;
      const n = px.length;
      if (n && Math.hypot(x - px[n - 1], y - py[n - 1]) < 0.05 && Math.abs(h - ph[n - 1]) < 0.01) {
        if (line.inside?.[i / 2]) pin[n - 1] = 1;
        continue;
      }
      px.push(x);
      py.push(y);
      ph.push(h);
      pin.push(line.inside ? line.inside[i / 2] : 0);
    }
    const n = px.length;
    if (n < 2) continue;

    // Horizontal direction of each segment; vertical ones (stairs) borrow a neighbour's.
    const sx: number[] = [], sy: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = px[i + 1] - px[i], dy = py[i + 1] - py[i];
      const l = Math.hypot(dx, dy);
      sx.push(l > 1e-4 ? dx / l : NaN);
      sy.push(l > 1e-4 ? dy / l : NaN);
    }
    for (let i = 0; i < n - 1; i++) {
      if (!Number.isNaN(sx[i])) continue;
      let j = i - 1;
      while (j >= 0 && Number.isNaN(sx[j])) j--;
      if (j < 0) {
        j = i + 1;
        while (j < n - 1 && Number.isNaN(sx[j])) j++;
      }
      [sx[i], sy[i]] = j >= 0 && j < n - 1 && !Number.isNaN(sx[j]) ? [sx[j], sy[j]] : [1, 0];
    }

    const c = line.colour ?? WHITE;
    for (const vertical of upright ? [false, true] : [false]) {
    const base = position.length / 3;
    let dist = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) dist += Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1], (ph[i] - ph[i - 1]) * FLOOR_HEIGHT);
      const ix = i > 0 ? sx[i - 1] : sx[0], iy = i > 0 ? sy[i - 1] : sy[0];
      let tx = ix + (i < n - 1 ? sx[i] : 0), ty = iy + (i < n - 1 ? sy[i] : 0);
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-4) [tx, ty] = [ix, iy]; // a full reversal
      else [tx, ty] = [tx / tl, ty / tl];
      const miter = 1 / Math.max(0.55, tx * ix + ty * iy);
      // Data-space normal (-ty, tx) is world (x, z) = (-ty, -tx).
      const nx = -ty * miter, nz = -tx * miter;
      // Indoors the line lies just above the corridor floor.
      const y = pin[i] ? ph[i] * FLOOR_HEIGHT + 0.12 : ph[i] * FLOOR_HEIGHT;
      position.push(px[i], y, -py[i], px[i], y, -py[i]);
      if (vertical) offset.push(0, 1, 0, 0, -1, 0);
      else offset.push(nx, 0, nz, -nx, 0, -nz);
      side.push(1, -1);
      along.push(dist, dist);
      inside.push(pin[i], pin[i]);
      colour.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < n - 1) index.push(base + i * 2, base + i * 2 + 1, base + i * 2 + 3, base + i * 2, base + i * 2 + 3, base + i * 2 + 2);
    }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('offset', new THREE.Float32BufferAttribute(offset, 3));
  g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('inside', new THREE.Float32BufferAttribute(inside, 1));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(colour, 3));
  g.setIndex(index);
  // Positions are collapsed until the shader widens them, so skip culling.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export const ribbonVertexShader = /* glsl */ `
  attribute vec3 offset;
  attribute float side;
  attribute float along;
  attribute float inside;
  attribute vec3 tint;
  uniform float width;
  uniform float lift;
  varying float vAlong;
  varying float vSide;
  varying float vInside;
  varying vec3 vTint;
  void main() {
    vAlong = along;
    vSide = side;
    vInside = inside;
    vTint = tint;
    vec3 p = position + offset * width * 0.5;
    p.y += lift;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
