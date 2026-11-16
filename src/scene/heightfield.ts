// Coarse grid of building heights, used by the flythrough camera to stay
// clear of anything between it and the point it is looking at.

import type { Building } from '../data/types';
import { pointInPolygon } from '../lib/geom';

export class HeightField {
  private data: Float32Array;
  private cols: number;
  private rows: number;

  constructor(buildings: Building[], private bounds: [number, number, number, number], private cell = 4) {
    const [x0, y0, x1, y1] = bounds;
    this.cols = Math.ceil((x1 - x0) / cell);
    this.rows = Math.ceil((y1 - y0) / cell);
    this.data = new Float32Array(this.cols * this.rows);
    for (const b of buildings) {
      if (b.minHeight > 0 && b.kind === 'roof') continue;
      for (const poly of b.polygons) {
        const ring = poly[0];
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (let i = 0; i < ring.length; i += 2) {
          bx0 = Math.min(bx0, ring[i]);
          by0 = Math.min(by0, ring[i + 1]);
          bx1 = Math.max(bx1, ring[i]);
          by1 = Math.max(by1, ring[i + 1]);
        }
        const c0 = Math.max(0, Math.floor((bx0 - x0) / cell)), c1 = Math.min(this.cols - 1, Math.floor((bx1 - x0) / cell));
        const r0 = Math.max(0, Math.floor((by0 - y0) / cell)), r1 = Math.min(this.rows - 1, Math.floor((by1 - y0) / cell));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const i = r * this.cols + c;
            if (this.data[i] >= b.top) continue;
            if (pointInPolygon(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell, poly)) this.data[i] = b.top;
          }
        }
      }
    }
  }

  /** Height of the tallest building covering this point, 0 for open ground. */
  at(x: number, y: number): number {
    const c = Math.floor((x - this.bounds[0]) / this.cell);
    const r = Math.floor((y - this.bounds[1]) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 0;
    return this.data[r * this.cols + c];
  }
}
