import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FlyPath, type FlyPose } from './path';

const pose = (): FlyPose => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), x: 0, y: 0, heading: 0, low: 0 });

describe('FlyPath', () => {
  // 300 m north, then 200 m east.
  const corner = new FlyPath([0, 0, 0, 300, 200, 300]);

  it('covers the route at a comfortable speed', () => {
    expect(corner.length).toBeGreaterThan(480);
    expect(corner.length).toBeLessThan(505);
    const average = corner.length / corner.duration;
    expect(average).toBeGreaterThan(8);
    expect(average).toBeLessThan(18);
  });

  it('starts behind the start looking along the route, and ends looking at the destination', () => {
    const start = corner.pose(0, pose());
    expect(start.position.z).toBeGreaterThan(10); // south of the start (north is -z)
    expect(start.position.y).toBeGreaterThan(10);
    expect(start.target.z).toBeLessThan(0); // looking north
    const end = corner.pose(corner.duration, pose());
    expect(end.x).toBeCloseTo(200, 0);
    expect(end.y).toBeCloseTo(300, 0);
    expect(end.target.x).toBeCloseTo(200, 0);
    expect(end.target.z).toBeCloseTo(-300, 0);
  });

  it('moves forward monotonically and never jerks the camera', () => {
    const a = pose(), b = pose();
    let travelled = 0, worstStep = 0, worstTurn = 0;
    const dt = 1 / 30;
    corner.pose(0, a);
    let lastDir = new THREE.Vector3().subVectors(a.target, a.position).normalize();
    for (let t = dt; t <= corner.duration; t += dt) {
      corner.pose(t, b);
      const step = Math.hypot(b.x - a.x, b.y - a.y);
      travelled += step;
      worstStep = Math.max(worstStep, a.position.distanceTo(b.position));
      const dir = new THREE.Vector3().subVectors(b.target, b.position).normalize();
      worstTurn = Math.max(worstTurn, dir.angleTo(lastDir));
      lastDir = dir;
      a.position.copy(b.position);
      a.x = b.x;
      a.y = b.y;
    }
    expect(travelled).toBeGreaterThan(corner.length * 0.97);
    expect(worstStep).toBeLessThan(1.2); // metres per frame at 30 fps: under 36 m/s
    expect(worstTurn).toBeLessThan(0.06); // radians per frame: the corner is swept, not snapped
  });

  it('slows down for the corner', () => {
    const a = pose(), b = pose();
    const speedAt = (t: number) => {
      corner.pose(t, a);
      corner.pose(t + 0.5, b);
      return Math.hypot(b.x - a.x, b.y - a.y) / 0.5;
    };
    // Find the time the camera passes the corner.
    let tCorner = 0;
    for (let t = 0; t < corner.duration; t += 0.25) {
      if (corner.pose(t, a).y >= 295) {
        tCorner = t;
        break;
      }
    }
    expect(speedAt(tCorner)).toBeLessThan(speedAt(tCorner - 8) * 0.9);
  });

  it('climbs to clear a building between the camera and the route', () => {
    // A 30 m block the camera has to pass over while following a route beside it.
    const heightAt = (x: number, y: number) => (x > -40 && x < 40 && y > 100 && y < 160 ? 30 : 0);
    const flat = new FlyPath([0, 0, 0, 400]);
    const blocked = new FlyPath([0, 0, 0, 400], { heightAt });
    const p = pose();
    let peak = 0, flatPeak = 0;
    for (let t = 0; t < blocked.duration; t += 0.2) {
      const q = blocked.pose(t, p);
      // Whenever the camera is over the block it must be above its roof.
      if (heightAt(q.position.x, -q.position.z) > 0) expect(q.position.y).toBeGreaterThan(30);
      peak = Math.max(peak, q.position.y);
    }
    for (let t = 0; t < flat.duration; t += 0.2) flatPeak = Math.max(flatPeak, flat.pose(t, p).position.y);
    expect(peak).toBeGreaterThan(32);
    expect(flatPeak).toBeLessThan(20);
  });

  it('orbits the destination after arriving', () => {
    const at = corner.pose(corner.duration, pose());
    const later = corner.pose(corner.duration + 5, pose());
    const r0 = Math.hypot(at.position.x - at.target.x, at.position.z - at.target.z);
    const r1 = Math.hypot(later.position.x - later.target.x, later.position.z - later.target.z);
    expect(r1).toBeCloseTo(r0, 3);
    expect(later.position.distanceTo(at.position)).toBeGreaterThan(3);
  });

  it('drops to head height through a tunnel and climbs out again', () => {
    // 200 m outside, 150 m through a tunnel 3.8 m down, 200 m outside again.
    const pts = [0, 0, 0, 200, 0, 350, 0, 550];
    const tunnel = new FlyPath(pts, { elev: [0, -3.8, -3.8, 0], inside: [0, 1, 1, 0] });
    const p = pose();
    let lowest = Infinity, maxLowSpeed = 0, lastY = 0, lastT = 0;
    for (let t = 0; t < tunnel.duration; t += 0.1) {
      const q = tunnel.pose(t, p);
      if (q.y > 220 && q.y < 330) {
        // Well inside the tunnel: fully down, eye height above the tunnel floor,
        // looking along it rather than down at it, at walking pace.
        expect(q.low).toBeGreaterThan(0.95);
        expect(q.position.y).toBeGreaterThan(-3.8 + 1.2);
        expect(q.position.y).toBeLessThan(-3.8 + 2.4);
        expect(Math.abs(q.target.y - q.position.y)).toBeLessThan(1);
        const behind = q.y - -q.position.z;
        expect(behind).toBeGreaterThan(2);
        expect(behind).toBeLessThan(8);
        if (lastT) maxLowSpeed = Math.max(maxLowSpeed, (q.y - lastY) / (t - lastT));
        lastY = q.y;
        lastT = t;
      }
      if (q.y < 150) expect(q.low).toBeLessThan(0.05);
      lowest = Math.min(lowest, q.position.y);
    }
    expect(lowest).toBeLessThan(0);
    expect(maxLowSpeed).toBeLessThan(7);
    expect(tunnel.pose(tunnel.duration, p).low).toBeLessThan(0.05);
  });

  it('handles a route with a single point', () => {
    const tiny = new FlyPath([5, 5, 5, 5]);
    const p = tiny.pose(0, pose());
    expect(Number.isFinite(p.position.x)).toBe(true);
    expect(Number.isFinite(tiny.duration)).toBe(true);
  });
});
