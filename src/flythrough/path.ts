// Turns a route polyline into a camera move: a smooth curve through the route,
// a chase camera that looks ahead along it, a speed profile that eases in and
// out and slows for turns, and enough height to see over buildings.
//
// Where the route goes indoors (tunnels, hallways, bridges) a camera in the air
// would only see roofs and ground, so there it drops to head height a few
// steps behind on the route itself and slows to a brisk walk, as if you were
// walking it. The change is eased over about twenty metres either side.
//
// Everything is precomputed per metre of route, so the pose at a given time is
// a pure lookup. Scrubbing and replaying always show the same shot.

import * as THREE from 'three';

export interface FlyPose {
  /** Camera position in world space (x, up, -north). */
  position: THREE.Vector3;
  /** Point the camera looks at. */
  target: THREE.Vector3;
  /** Point on the route the camera is following, in data space. */
  x: number;
  y: number;
  /** Direction of travel in radians, 0 = north, clockwise. */
  heading: number;
  /** 0 for the overhead chase camera, 1 for the head-height indoor camera, in between while changing. */
  low: number;
}

export interface FlyOptions {
  /** Height of buildings at a data-space point, 0 for open ground. */
  heightAt?: (x: number, y: number) => number;
  cruise?: number;
  height?: number;
  back?: number;
  /** Per route point: height of the floor in metres (negative in tunnels). */
  elev?: number[];
  /** Per route point: 1 indoors (hallway, tunnel, bridge), 0 outside. */
  inside?: number[];
  /** Speed through indoor stretches, m/s. */
  indoorCruise?: number;
}

/** Eye height above the floor for the indoor camera. */
export const EYE_HEIGHT = 1.75;

const STEP = 1; // metres between samples

export class FlyPath {
  readonly length: number;
  /** Seconds for the whole move at 1x. */
  readonly duration: number;

  private n: number;
  private px: Float32Array; // route, data space
  private py: Float32Array;
  private cx: Float32Array; // camera, data space + height
  private cy: Float32Array;
  private ch: Float32Array;
  private lx: Float32Array; // look target, data space
  private ly: Float32Array;
  private time: Float32Array; // seconds at each sample
  private headings: Float32Array;
  private lh: Float32Array; // look target height
  private lowness: Float32Array;

  constructor(points: number[], opts: FlyOptions = {}) {
    const cruise = opts.cruise ?? 17;
    const baseHeight = opts.height ?? 15;
    const back = opts.back ?? 24;
    const heightAt = opts.heightAt ?? (() => 0);
    const indoorCruise = opts.indoorCruise ?? 5.5;
    const elevOf = (k: number) => opts.elev?.[k] ?? 0;
    const insideOf = (k: number) => opts.inside?.[k] ?? 0;

    // Long straight stretches get intermediate points, so the spline stays on
    // the route and only rounds the corners instead of bulging between sparse
    // vertices.
    const dense: number[] = [], denseE: number[] = [], denseI: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      const k = i / 2;
      if (i > 0) {
        const ax = points[i - 2], ay = points[i - 1];
        const steps = Math.floor(Math.hypot(points[i] - ax, points[i + 1] - ay) / 10);
        for (let s = 1; s <= steps; s++) {
          const t = s / (steps + 1);
          dense.push(ax + (points[i] - ax) * t, ay + (points[i + 1] - ay) * t);
          denseE.push(lerp(elevOf(k - 1), elevOf(k), t));
          // A stretch is indoors only if both of its ends are: the one leading up to a door is not.
          denseI.push(Math.min(insideOf(k - 1), insideOf(k)));
        }
      }
      dense.push(points[i], points[i + 1]);
      denseE.push(elevOf(k));
      denseI.push(insideOf(k));
    }
    points = dense;

    // Control points: drop near-duplicates, keep the ends exact.
    const ctrl: THREE.Vector3[] = [];
    const ctrlE: number[] = [], ctrlI: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      const v = new THREE.Vector3(points[i], 0, points[i + 1]);
      const last = ctrl[ctrl.length - 1];
      const isEnd = i === points.length - 2;
      const j = i / 2;
      if (last && last.distanceTo(v) < 1.5) {
        const c = ctrl.length - 1;
        if (isEnd) {
          ctrl[c] = v;
          ctrlE[c] = denseE[j];
        }
        if (denseI[j]) ctrlI[c] = 1;
        continue;
      }
      ctrl.push(v);
      ctrlE.push(denseE[j]);
      ctrlI.push(denseI[j]);
    }
    if (ctrl.length === 1) {
      ctrl.push(ctrl[0].clone().add(new THREE.Vector3(0.1, 0, 0)));
      ctrlE.push(ctrlE[0]);
      ctrlI.push(ctrlI[0]);
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    curve.arcLengthDivisions = Math.max(200, ctrl.length * 12);
    this.length = curve.getLength();
    const n = (this.n = Math.max(2, Math.ceil(this.length / STEP) + 1));
    const spaced = curve.getSpacedPoints(n - 1);
    const ds = this.length / (n - 1);

    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    // Floor height and indoors-ness at each sample. The curve's parameter maps
    // evenly onto the control points, so each sample knows which two it lies between.
    const floor = new Float32Array(n);
    const low = (this.lowness = new Float32Array(n));
    for (let i = 0; i < n; i++) {
      this.px[i] = spaced[i].x;
      this.py[i] = spaced[i].z;
      const p = curve.getUtoTmapping(i / (n - 1), 0) * (ctrl.length - 1);
      const a = Math.min(ctrl.length - 1, Math.floor(p)), b = Math.min(ctrl.length - 1, a + 1);
      floor[i] = lerp(ctrlE[a], ctrlE[b], p - a);
      low[i] = Math.min(ctrlI[a], ctrlI[b]);
    }
    // Come down a little before the door, and stay down through short hops
    // outside between two buildings.
    dilate(low, Math.round(8 / ds));
    smooth(low, Math.round(10 / ds));
    smooth(low, Math.round(6 / ds));
    // The eye follows stairs and ramps smoothly rather than step by step.
    smooth(floor, Math.round(3 / ds));

    // Heading from a wide window around each sample: the camera swings through
    // corners instead of snapping with every kink in the path.
    const ahead = Math.round(24 / ds), behind = Math.round(16 / ds);
    const hx = new Float32Array(n), hy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - behind), b = Math.min(n - 1, i + ahead);
      let dx = this.px[b] - this.px[a], dy = this.py[b] - this.py[a];
      const l = Math.hypot(dx, dy);
      if (l < 0.01) [dx, dy] = [0, 1];
      else [dx, dy] = [dx / l, dy / l];
      hx[i] = dx;
      hy[i] = dy;
    }
    smooth(hx, Math.round(8 / ds));
    smooth(hy, Math.round(8 / ds));
    this.headings = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(hx[i], hy[i]) || 1;
      hx[i] /= l;
      hy[i] /= l;
      this.headings[i] = Math.atan2(hx[i], hy[i]);
    }

    // Camera and look target. Near the end the target settles on the destination.
    this.cx = new Float32Array(n);
    this.cy = new Float32Array(n);
    this.ch = new Float32Array(n);
    this.lx = new Float32Array(n);
    this.ly = new Float32Array(n);
    const ex = this.px[n - 1], ey = this.py[n - 1];
    for (let i = 0; i < n; i++) {
      const remaining = (n - 1 - i) * ds;
      const settle = 1 - smoothstep(Math.min(1, remaining / 45));
      const lead = 9 * (1 - settle);
      this.lx[i] = lerp(this.px[i] + hx[i] * lead, ex, settle);
      this.ly[i] = lerp(this.py[i] + hy[i] * lead, ey, settle);
      const b = back - 5 * settle;
      this.cx[i] = this.px[i] - hx[i] * b;
      this.cy[i] = this.py[i] - hy[i] * b;
    }
    smooth(this.cx, Math.round(5 / ds));
    smooth(this.cy, Math.round(5 / ds));

    // Height: clear whatever stands between the camera and the route. Only the
    // camera's half of the sight line counts. A building right beside the route
    // would otherwise force a near-vertical view; the route line shows faintly
    // through buildings, so losing sight of it for a moment is the better trade.
    for (let i = 0; i < n; i++) {
      let h = baseHeight;
      for (let f = 0.5; f <= 1.001; f += 0.1) {
        const bh = heightAt(lerp(this.lx[i], this.cx[i], f), lerp(this.ly[i], this.cy[i], f));
        if (bh > 0) h = Math.max(h, 1.5 + (bh + 2.5 - 1.5) / f);
      }
      this.ch[i] = Math.min(h, 70);
    }
    dilate(this.ch, Math.round(14 / ds));
    smooth(this.ch, Math.round(18 / ds));
    smooth(this.ch, Math.round(10 / ds));

    // Indoors: eye height, a few steps behind on the route, looking ahead along it.
    this.lh = new Float32Array(n).fill(1.5);
    const behindLow = Math.round(4.5 / ds), aheadLow = Math.round(10 / ds);
    for (let i = 0; i < n; i++) {
      const k = low[i];
      if (k <= 0.001) continue;
      const b = Math.max(0, i - behindLow);
      const a = Math.min(n - 1, i + aheadLow);
      let bx = this.px[b], by = this.py[b];
      if (i - b < behindLow) {
        // At the very start there is no route behind: back off along the heading.
        const short = (behindLow - (i - b)) * ds;
        bx -= hx[i] * short;
        by -= hy[i] * short;
      }
      this.cx[i] = lerp(this.cx[i], bx, k);
      this.cy[i] = lerp(this.cy[i], by, k);
      this.ch[i] = lerp(this.ch[i], floor[b] + EYE_HEIGHT, k);
      this.lx[i] = lerp(this.lx[i], this.px[a], k);
      this.ly[i] = lerp(this.ly[i], this.py[a], k);
      this.lh[i] = lerp(1.5, floor[a] + EYE_HEIGHT - 0.35, k);
    }

    // Speed: ease in and out, slow down in turns and when the camera is climbing.
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * ds;
      const a = Math.max(0, i - Math.round(6 / ds)), b = Math.min(n - 1, i + Math.round(6 / ds));
      let turn = Math.abs(this.headings[b] - this.headings[a]);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      const turnFactor = 1 / (1 + turn * 1.6);
      const easeIn = 0.25 + 0.75 * smoothstep(Math.min(1, s / 30));
      const easeOut = 0.2 + 0.8 * smoothstep(Math.min(1, (this.length - s) / 45));
      // Indoors a brisk walk, where corners matter less.
      speed[i] = lerp(cruise * Math.max(0.35, turnFactor), indoorCruise * Math.max(0.6, turnFactor), low[i]) * easeIn * easeOut;
    }
    smooth(speed, Math.round(10 / ds));
    this.time = new Float32Array(n);
    for (let i = 1; i < n; i++) this.time[i] = this.time[i - 1] + ds / ((speed[i] + speed[i - 1]) / 2);
    this.duration = this.time[n - 1];
  }

  /** Camera pose at a time in seconds. Past the end the camera holds a slow orbit of the destination. */
  pose(t: number, out: FlyPose): FlyPose {
    const n = this.n;
    const clamped = Math.max(0, Math.min(this.duration, t));
    // Binary search for the sample interval containing this time.
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.time[mid] <= clamped) lo = mid;
      else hi = mid;
    }
    const span = this.time[hi] - this.time[lo];
    const f = span > 0 ? (clamped - this.time[lo]) / span : 0;
    const at = (a: Float32Array) => lerp(a[lo], a[hi], f);

    let cx = at(this.cx), cy = at(this.cy);
    const lx = at(this.lx), ly = at(this.ly);
    if (t > this.duration) {
      const angle = Math.min(t - this.duration, 90) * 0.1;
      const ox = cx - lx, oy = cy - ly;
      cx = lx + ox * Math.cos(angle) - oy * Math.sin(angle);
      cy = ly + ox * Math.sin(angle) + oy * Math.cos(angle);
    }
    out.position.set(cx, at(this.ch), -cy);
    out.target.set(lx, at(this.lh), -ly);
    out.x = at(this.px);
    out.y = at(this.py);
    out.heading = this.headings[f < 0.5 ? lo : hi];
    out.low = at(this.lowness);
    return out;
  }

  /** Route position at a fraction 0..1 of the duration. */
  pointAtProgress(p: number): { x: number; y: number; heading: number } {
    const pose = this.pose(p * this.duration, { position: new THREE.Vector3(), target: new THREE.Vector3(), x: 0, y: 0, heading: 0, low: 0 });
    return { x: pose.x, y: pose.y, heading: pose.heading };
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** In-place box blur with clamped ends. */
function smooth(a: Float32Array, radius: number) {
  if (radius < 1) return;
  const n = a.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + a[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius), hi = Math.min(n - 1, i + radius);
    a[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
}

/** In-place running maximum, so the camera starts climbing before an obstacle and stays up until past it. */
function dilate(a: Float32Array, radius: number) {
  if (radius < 1) return;
  const src = a.slice();
  for (let i = 0; i < a.length; i++) {
    let m = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(a.length - 1, i + radius); k++) m = Math.max(m, src[k]);
    a[i] = m;
  }
}
