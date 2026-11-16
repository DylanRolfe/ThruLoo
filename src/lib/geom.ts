// 2D geometry helpers in the local metric frame (x east, y north, metres).

export type Pt = [number, number];

/** Flat ring: [x0, y0, x1, y1, ...], not closed (the last point is not a repeat of the first). */
export type Ring = number[];
/** [outer, ...holes] */
export type Polygon = Ring[];

export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

export interface Closest {
  x: number;
  y: number;
  t: number;
  dist: number;
}

export function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): Closest {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1];
    const xj = ring[j], yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  if (!pointInRing(x, y, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) if (pointInRing(x, y, polygon[i])) return false;
  return true;
}

/** Signed area, positive when counter-clockwise (y up). */
export function ringArea(ring: Ring): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return a / 2;
}

/** Parameter along ab where it crosses cd, or null when the segments do not properly intersect. */
export function segmentIntersection(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number | null {
  const rx = bx - ax, ry = by - ay;
  const sx = dx - cx, sy = dy - cy;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / denom;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

export function polylineLength(line: number[]): number {
  let len = 0;
  for (let i = 2; i < line.length; i += 2) len += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
  return len;
}

/** Sub-polyline between distances s0 <= s1 measured from the start. */
export function slicePolyline(line: number[], s0: number, s1: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2], ay = line[i - 1], bx = line[i], by = line[i + 1];
    const seg = Math.hypot(bx - ax, by - ay);
    const next = acc + seg;
    if (next >= s0 && acc <= s1 && seg > 0) {
      const t0 = Math.max(0, (s0 - acc) / seg);
      const t1 = Math.min(1, (s1 - acc) / seg);
      if (out.length === 0) out.push(ax + (bx - ax) * t0, ay + (by - ay) * t0);
      out.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
    }
    acc = next;
    if (acc > s1) break;
  }
  if (out.length === 0 && line.length >= 2) out.push(line[0], line[1]);
  return out;
}

export interface GridHit<T> extends Closest {
  id: number;
  payload: T;
}

/** Uniform grid over line segments, for nearest-segment queries. */
export class SegmentGrid<T> {
  private cells = new Map<number, number[]>();
  private segs: { ax: number; ay: number; bx: number; by: number; payload: T; alive: boolean }[] = [];

  constructor(private cell = 20) {}

  private key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  insert(ax: number, ay: number, bx: number, by: number, payload: T): number {
    const id = this.segs.length;
    this.segs.push({ ax, ay, bx, by, payload, alive: true });
    const c = this.cell;
    const x0 = Math.floor(Math.min(ax, bx) / c), x1 = Math.floor(Math.max(ax, bx) / c);
    const y0 = Math.floor(Math.min(ay, by) / c), y1 = Math.floor(Math.max(ay, by) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
    return id;
  }

  remove(id: number) {
    this.segs[id].alive = false;
  }

  /** Visits every live segment whose cells overlap the box. May visit a segment more than once. */
  query(x0: number, y0: number, x1: number, y1: number, visit: (id: number, payload: T, ax: number, ay: number, bx: number, by: number) => void) {
    const c = this.cell;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const id of list) {
          const s = this.segs[id];
          if (s.alive) visit(id, s.payload, s.ax, s.ay, s.bx, s.by);
        }
      }
    }
  }

  nearest(x: number, y: number, maxDist: number, accept?: (payload: T) => boolean): GridHit<T> | null {
    let best: GridHit<T> | null = null;
    this.query(x - maxDist, y - maxDist, x + maxDist, y + maxDist, (id, payload, ax, ay, bx, by) => {
      if (accept && !accept(payload)) return;
      const c = closestOnSegment(x, y, ax, ay, bx, by);
      if (c.dist <= maxDist && (!best || c.dist < best.dist)) best = { ...c, id, payload };
    });
    return best;
  }
}

/** Deterministic 0..1 hash of a string, for stable per-object variation. */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
