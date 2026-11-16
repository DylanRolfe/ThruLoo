// One owner for the camera across all three modes, so mode changes can blend
// smoothly instead of cutting.
//
//   walk: third-person orbit around the player, mouse look, spring arm
//   map:  straight down, north up, drag to pan, wheel to zoom
//   fly:  follows the precomputed flythrough path

import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { FlyPose } from '../flythrough/path';
import { fly, gpsFix, player, view } from '../state/runtime';
import { useApp, type Mode } from '../state/store';
import { focus } from './focus';
import { physicsRefs } from './Player';

const WALK_FOV = 52;
const MAP_FOV = 30;
const FLY_FOV = 50;
const BLEND_SECONDS = 1.1;
export const MAP_MIN_HEIGHT = 120;
export const MAP_MAX_HEIGHT = 5200;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { world: physics, rapier } = useRapier();

  const rig = useRef({
    /** The current shot: a mode, or the overhead navigation view. */
    mode: null as Mode | 'navmap' | null,
    blend: 1,
    fromPos: new THREE.Vector3(),
    fromQuat: new THREE.Quaternion(),
    fromFov: WALK_FOV,
    armLength: view.distance,
    progressTimer: 0,
  });
  const tmp = useRef({
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    up: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    mat: new THREE.Matrix4(),
    pose: { position: new THREE.Vector3(), target: new THREE.Vector3(), x: 0, y: 0, heading: 0, low: 0 } as FlyPose,
  });

  // ------------------------------------------------------------ pointer input
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let moved = 0;
    let lastX = 0, lastY = 0;
    // Every finger on the canvas, for pinch-to-zoom.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch = 0, pinchX = 0, pinchY = 0;

    const look = (dx: number, dy: number, gain = 1, tilt = 1) => {
      view.yaw += dx * 0.0026 * gain;
      view.pitch = Math.max(-0.12, Math.min(1.35, view.pitch + dy * 0.0022 * gain * tilt));
      view.lookedAt = performance.now();
    };
    const navMapOn = () => {
      const a = useApp.getState();
      return a.mode === 'walk' && a.nav && a.navView === 'map';
    };
    const metresPerPixel = () => (2 * view.mapHeight * Math.tan((MAP_FOV * Math.PI) / 360)) / el.clientHeight;
    const pinchState = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // A first finger always starts a fresh gesture: anything still tracked is a finger whose
      // lift was missed, and left in place it would turn a one-finger drag into a pinch.
      if (e.pointerType === 'touch' && e.isPrimary) {
        touches.clear();
        dragging = false;
      }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone: carry on without capture */
      }
      if (touches.size === 2) {
        // Second finger: stop looking, start pinching.
        const p = pinchState();
        [pinch, pinchX, pinchY] = [p.d, p.x, p.y];
        dragging = false;
        moved = 99;
        return;
      }
      if (touches.size > 2) return;
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      const mode = useApp.getState().mode;
      if (document.pointerLockElement === el) {
        if (mode === 'walk') look(e.movementX, e.movementY);
        return;
      }
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const p = pinchState();
        // Fingers sliding together are a pan, not a zoom: only a real change in spread zooms.
        const ratio = p.d > 1 && pinch > 1 && Math.abs(p.d - pinch) > 1.5 ? pinch / p.d : 1;
        if (navMapOn()) view.navMapHeight = Math.max(MAP_MIN_HEIGHT, Math.min(1600, view.navMapHeight * ratio));
        else if (mode === 'walk') view.distance = Math.max(2.5, Math.min(70, view.distance * ratio));
        else if (mode === 'map') {
          // Two fingers: pan with their midpoint and zoom about it, so the ground between them stays put.
          const mpp = metresPerPixel();
          view.mapX -= (p.x - pinchX) * mpp;
          view.mapY += (p.y - pinchY) * mpp;
          const before = view.mapHeight;
          view.mapHeight = Math.max(MAP_MIN_HEIGHT, Math.min(MAP_MAX_HEIGHT, before * ratio));
          const rect = el.getBoundingClientRect();
          const tan = Math.tan((MAP_FOV * Math.PI) / 360);
          const shrink = before - view.mapHeight;
          view.mapX += (((p.x - rect.left) / rect.width) * 2 - 1) * tan * (rect.width / rect.height) * shrink;
          view.mapY -= (((p.y - rect.top) / rect.height) * 2 - 1) * tan * shrink;
        }
        [pinch, pinchX, pinchY] = [p.d, p.x, p.y];
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      // A finger covers less ground than a mouse for the same turn.
      // One finger turns the camera (mostly sideways: up and down tilts gently, it is not a zoom).
      if (mode === 'walk') look(dx, dy, e.pointerType === 'mouse' ? 1 : 1.6, e.pointerType === 'mouse' ? 1 : 0.55);
      else if (mode === 'map') {
        const mpp = metresPerPixel();
        view.mapX -= dx * mpp;
        view.mapY += dy * mpp;
      }
    };
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (touches.size === 1) {
        // Back to one finger after a pinch: carry on dragging from it, without a jump.
        const [rest] = [...touches.values()];
        lastX = rest.x;
        lastY = rest.y;
        dragging = true;
        return;
      }
      if (!dragging) return;
      dragging = false;
      // A plain click in walk mode captures the mouse for looking around. Not for
      // touch: there is no pointer to capture, and a tap should do nothing.
      if (e.pointerType === 'mouse' && moved < 4 && useApp.getState().mode === 'walk' && document.pointerLockElement !== el) {
        // Unadjusted movement is unsupported in some browsers, and locking can be
        // refused (for example straight after Esc); neither should throw.
        try {
          const p = el.requestPointerLock() as unknown as Promise<void> | undefined;
          p?.catch?.(() => {});
        } catch {
          /* ignore */
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const mode = useApp.getState().mode;
      const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      if (navMapOn()) view.navMapHeight = Math.max(MAP_MIN_HEIGHT, Math.min(1600, view.navMapHeight * Math.exp(dy * 0.0014)));
      else if (mode === 'walk') view.distance = Math.max(2.5, Math.min(70, view.distance * Math.exp(dy * 0.0012)));
      else if (mode === 'map') {
        // Zoom about the cursor, so the point under it stays put.
        const before = view.mapHeight;
        view.mapHeight = Math.max(MAP_MIN_HEIGHT, Math.min(MAP_MAX_HEIGHT, before * Math.exp(dy * 0.0014)));
        const rect = el.getBoundingClientRect();
        const tan = Math.tan((MAP_FOV * Math.PI) / 360);
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
        const shrink = before - view.mapHeight;
        view.mapX += nx * tan * (rect.width / rect.height) * shrink;
        view.mapY -= ny * tan * shrink;
      }
    };
    const onLockChange = () => useApp.setState({ pointerLocked: document.pointerLockElement === el });

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, [gl]);

  // --------------------------------------------------------------- per frame
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const r = rig.current;
    const t = tmp.current;
    const app = useApp.getState();
    const mode = app.mode;
    let fov = WALK_FOV;

    const navMap = mode === 'walk' && app.nav && app.navView === 'map';
    if (navMap) {
      // Navigating, zoomed out: straight down over the character, north up,
      // following it as it moves.
      fov = MAP_FOV;
      t.target.set(player.x, 0, -player.y);
      t.pos.set(player.x, view.navMapHeight, -player.y);
      t.up.set(0, 0, -1);
      focus.x = player.x;
      focus.z = -player.y;
      focus.radius = Math.max(260, Math.min(1700, view.navMapHeight * 0.8));
    } else if (mode === 'walk') {
      // Following the live location there are no keys to steer by, so swing
      // round behind the character: while navigating, to face along the route
      // ahead; otherwise the way it walks. Not if the person has just turned
      // the camera themselves.
      const facing = app.nav && gpsFix.ahead && Math.hypot(gpsFix.aheadX - player.x, gpsFix.aheadY - player.y) > 3 ? Math.atan2(gpsFix.aheadX - player.x, gpsFix.aheadY - player.y) : player.heading;
      if (app.follow && (app.nav || player.speed > 0.4) && performance.now() - view.lookedAt > (app.nav ? 4000 : 3000)) {
        let d = (facing - view.yaw) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        view.yaw += d * Math.min(1, dt * 1.2);
      }
      t.target.set(player.x, player.h + 1.55, -player.y);
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const dir = t.up.set(-Math.sin(view.yaw) * cp, sp, Math.cos(view.yaw) * cp); // player -> camera
      // Spring arm: pull the camera in when a wall is between it and the player.
      let want = view.distance;
      // Indoors the buildings are see-through, so there is nothing to pull the camera in for.
      const hit = player.indoor ? null : physics.castRay(new rapier.Ray(t.target, dir), view.distance + 0.5, true, undefined, undefined, physicsRefs.capsule ?? undefined);
      if (hit) want = Math.max(0.8, Math.min(want, hit.timeOfImpact - 0.4));
      // Shorten immediately, lengthen gently.
      r.armLength = want < r.armLength ? want : r.armLength + (want - r.armLength) * Math.min(1, dt * 4);
      t.pos.copy(t.target).addScaledVector(dir, r.armLength);
      t.pos.y = Math.max(0.35, t.pos.y);
      t.up.set(0, 1, 0);
      focus.x = player.x;
      focus.z = -player.y;
      focus.radius = 170 + view.distance * 2;
    } else if (mode === 'map') {
      fov = MAP_FOV;
      t.target.set(view.mapX, 0, -view.mapY);
      t.pos.set(view.mapX, view.mapHeight, -view.mapY);
      t.up.set(0, 0, -1); // north up
      focus.x = view.mapX;
      focus.z = -view.mapY;
      focus.radius = Math.max(260, Math.min(1700, view.mapHeight * 0.8));
    } else {
      fov = FLY_FOV;
      const path = fly.path;
      if (path) {
        if (app.flyPlaying || app.flyDone) fly.t += dt * (app.flyDone ? 1 : app.flySpeed);
        if (!app.flyDone && fly.t >= path.duration) useApp.setState({ flyDone: true, flyPlaying: false, flyProgress: 1 });
        path.pose(fly.t, t.pose);
        t.pos.copy(t.pose.position);
        t.target.copy(t.pose.target);
        fly.low = t.pose.low;
        // A wider view at head height, as when walking.
        fov = FLY_FOV + (WALK_FOV + 8 - FLY_FOV) * t.pose.low;
        const low = t.pose.low > 0.5;
        if (low !== app.flyIndoors) useApp.setState({ flyIndoors: low });
        r.progressTimer -= dt;
        if (r.progressTimer <= 0 && !app.flyDone) {
          r.progressTimer = 0.1;
          useApp.setState({ flyProgress: Math.min(1, fly.t / path.duration) });
        }
      }
      t.up.set(0, 1, 0);
      focus.x = t.target.x;
      focus.z = t.target.z;
      focus.radius = 260;
    }

    t.mat.lookAt(t.pos, t.target, t.up);
    t.quat.setFromRotationMatrix(t.mat);

    // Blend from wherever the camera was when the mode changed.
    const shot = navMap ? 'navmap' : mode;
    if (shot !== r.mode) {
      const first = r.mode === null;
      r.mode = shot;
      r.blend = first ? 1 : 0;
      r.fromPos.copy(camera.position);
      r.fromQuat.copy(camera.quaternion);
      r.fromFov = camera.fov;
      r.armLength = view.distance;
    }
    if (r.blend < 1) {
      r.blend = Math.min(1, r.blend + dt / BLEND_SECONDS);
      const k = ease(r.blend);
      camera.position.lerpVectors(r.fromPos, t.pos, k);
      camera.quaternion.slerpQuaternions(r.fromQuat, t.quat, k);
      fov = r.fromFov + (fov - r.fromFov) * k;
    } else {
      camera.position.copy(t.pos);
      camera.quaternion.copy(t.quat);
    }
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    focus.height = camera.position.y;
    // Fog thins out with altitude so the map view stays clear.
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = Math.max(380, camera.position.y * 1.6);
      fog.far = Math.max(2600, camera.position.y * 6);
    }
  });

  return null;
}
