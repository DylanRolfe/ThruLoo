// The walking character: input, collision against building walls, and a small
// animated figure.

import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FLOOR_HEIGHT } from '../indoor/surface';
import { pointInPolygon } from '../lib/geom';
import { pauseFollow } from '../state/gps';
import { gpsFix, keys, player, stick, view } from '../state/runtime';
import { useApp } from '../state/store';
import type { World } from '../state/world';
import { focus } from './focus';
import { buildWallCollider } from './geometry';
import { ACCENT } from './palette';

// A little brisker than real life (1.3 m/s) so crossing a 2 km campus stays fun.
export const WALK_SPEED = 2.4;
export const RUN_SPEED = 7.5;
const JUMP_SPEED = 4.8;
const GRAVITY = 15;
const RADIUS = 0.35;
const HALF_HEIGHT = 0.55;

/** Shared with the camera rig, which ray-casts against the same walls. */
export const physicsRefs = { capsule: null as Collider | null, walls: null as Collider | null };

const shortestAngle = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function Player({ world }: { world: World }) {
  const { world: physics, rapier } = useRapier();
  const group = useRef<THREE.Group>(null!);
  const marker = useRef<THREE.Group>(null!);
  const blob = useRef<THREE.Mesh>(null!);
  const limbs = useRef<{ legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group; body: THREE.Group }>({} as never);
  const controller = useRef<KinematicCharacterController | null>(null);
  const motion = useRef({
    vx: 0, vy: 0, vh: 0, phase: 0, nearTimer: 0,
    /** Seconds the live-location walk has been blocked by a wall. */
    stuck: 0,
    /** A flight of stairs in progress. */
    climb: null as { fromX: number; fromY: number; fromH: number; toX: number; toY: number; toH: number; t: number; seconds: number } | null,
  });

  // Is this spot open ground the character could step out onto? Checked only
  // when leaving through a doorway. The margin keeps the body clear of the wall.
  const solid = useRef(world.campus.buildings.filter((b) => b.solid));
  const openGround = (x: number, y: number) => {
    const m = RADIUS + 0.08;
    for (const b of solid.current) {
      if (Math.abs(b.centre[0] - x) > 220 || Math.abs(b.centre[1] - y) > 220) continue;
      for (const poly of b.polygons) {
        if (pointInPolygon(x, y, poly) || pointInPolygon(x + m, y, poly) || pointInPolygon(x - m, y, poly) || pointInPolygon(x, y + m, poly) || pointInPolygon(x, y - m, poly)) return false;
      }
    }
    return true;
  };

  useEffect(() => {
    const { campus } = world;
    const [sx, sy, heading] = campus.spawn;
    player.x = sx;
    player.y = sy;
    player.heading = heading;
    view.yaw = heading;

    const { vertices, indices } = buildWallCollider(campus.buildings, campus.wallGaps);
    const walls = physics.createCollider(rapier.ColliderDesc.trimesh(vertices, indices));
    const capsule = physics.createCollider(rapier.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setTranslation(sx, HALF_HEIGHT + RADIUS, -sy));
    const ctl = physics.createCharacterController(0.04);
    ctl.setSlideEnabled(true);
    ctl.setApplyImpulsesToDynamicBodies(false);
    controller.current = ctl;
    physicsRefs.capsule = capsule;
    physicsRefs.walls = walls;
    if (window.__campus) window.__campus.physics = { world: physics, rapier, capsule, walls };
    return () => {
      physicsRefs.capsule = null;
      controller.current = null;
      physics.removeCharacterController(ctl);
      physics.removeCollider(capsule, false);
      physics.removeCollider(walls, false);
    };
  }, [world, physics, rapier]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const m = motion.current;
    const capsule = physicsRefs.capsule;
    const mode = useApp.getState().mode;

    const surface = world.surface;
    if (player.teleport) {
      const t = player.teleport;
      player.x = t.x;
      player.y = t.y;
      if (t.heading !== undefined) player.heading = t.heading;
      const floor = t.indoor ? surface.at(t.x, t.y, t.h ?? 0) : null;
      player.indoor = floor !== null;
      player.h = player.floor = floor ? floor.height : 0;
      m.vx = m.vy = m.vh = 0;
      m.climb = null;
      player.teleport = null;
    }

    // Input, relative to where the camera is looking: keys, or the on-screen
    // joystick, which is analogue (a small push walks slowly).
    let f = 0, s = 0;
    // Navigating: the live location is the only thing that moves the character.
    const app = useApp.getState();
    if (mode === 'walk' && !app.nav) {
      f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (stick.x !== 0 || stick.y !== 0) {
        f = stick.y;
        s = stick.x;
      }
    }
    const sin = Math.sin(view.yaw), cos = Math.cos(view.yaw);
    let dx = f * sin + s * cos;
    let dy = f * cos - s * sin;
    const mag = Math.hypot(dx, dy);
    const moving = mag > 0.02;
    if (moving) {
      dx /= mag;
      dy /= mag;
    }
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || stick.run;
    const top = moving ? (run ? RUN_SPEED : WALK_SPEED * Math.max(0.3, Math.min(1, mag))) : 0;
    // Moving the character by hand stops it following the live location.
    if (moving && app.follow) pauseFollow();
    const following = mode === 'walk' && app.follow && gpsFix.valid && !moving && !m.climb;
    const k = Math.min(1, dt * (moving ? 9 : 14));
    m.vx += (dx * top - m.vx) * k;
    m.vy += (dy * top - m.vy) * k;

    const ctl = controller.current;
    if (m.climb) {
      // On the stairs: carried from one floor to the next, no steering.
      const c = m.climb;
      c.t = Math.min(1, c.t + dt / c.seconds);
      const e = c.t * c.t * (3 - 2 * c.t);
      player.x = c.fromX + (c.toX - c.fromX) * e;
      player.y = c.fromY + (c.toY - c.fromY) * e;
      player.h = player.floor = c.fromH + (c.toH - c.fromH) * e;
      player.speed = WALK_SPEED;
      m.vx = m.vy = 0;
      if (c.t >= 1) m.climb = null;
    } else if (following) {
      // Live location: walk the character to where the latest fix was placed
      // (on the route, a hallway, or a path; never inside a wall, see nav.ts).
      const tx = gpsFix.tx, ty = gpsFix.ty, th = gpsFix.th;
      const gx = tx - player.x, gy = ty - player.y, d = Math.hypot(gx, gy);
      if (gpsFix.jump || d > 120 || m.stuck > 1.5) {
        // First fix, a big jump, or walled in: go straight there.
        player.x = tx;
        player.y = ty;
        player.indoor = gpsFix.tIndoor;
        player.h = player.floor = gpsFix.tIndoor ? th : 0;
        player.speed = 0;
        gpsFix.jump = false;
        m.stuck = 0;
      } else if (d > 0.15) {
        // A believable pace that still catches up when it falls behind.
        const pace = Math.min(RUN_SPEED * 1.5, Math.max(WALK_SPEED * 0.6, d * 0.9));
        const step = Math.min(d, pace * dt);
        const mx = (gx / d) * step, my = (gy / d) * step;
        let got = step;
        if (!player.indoor && !gpsFix.tIndoor && ctl && capsule) {
          // Outside: slide along walls rather than through them.
          capsule.setTranslation({ x: player.x, y: HALF_HEIGHT + RADIUS, z: -player.y });
          ctl.computeColliderMovement(capsule, { x: mx, y: 0, z: -my });
          const moved = ctl.computedMovement();
          player.x += moved.x;
          player.y -= moved.z;
          got = Math.hypot(moved.x, moved.z);
          m.stuck = got < step * 0.3 ? m.stuck + dt : Math.max(0, m.stuck - dt);
        } else {
          player.x += mx;
          player.y += my;
        }
        player.speed = got / dt;
        if (d > 0.6) player.heading += shortestAngle(player.heading, Math.atan2(gx, gy)) * Math.min(1, dt * 6);
      } else {
        player.speed = 0;
        m.stuck = 0;
      }
      if (gpsFix.tIndoor) {
        const floor = surface.at(player.x, player.y, th);
        if (floor) {
          player.indoor = true;
          player.floor = floor.height;
        } else if (d < 2) {
          player.indoor = true;
          player.floor = th;
        }
      } else if (!player.indoor || d < 3 || !surface.at(player.x, player.y, player.floor)) {
        player.indoor = false;
        player.floor = 0;
      }
      player.h += (player.floor - player.h) * Math.min(1, dt * 6);
      m.vx = m.vy = m.vh = 0;
    } else if (player.indoor) {
      // Indoors: kept on the hallways, tunnels and bridges by the indoor surface
      // rather than by wall collision, and following their floor up and down.
      m.vh = 0;
      const next = surface.step({ x: player.x, y: player.y, h: player.floor, indoor: true }, m.vx * dt, m.vy * dt, openGround);
      player.speed = Math.hypot(next.x - player.x, next.y - player.y) / dt;
      player.x = next.x;
      player.y = next.y;
      player.floor = next.h;
      player.indoor = next.indoor;
      if (!player.indoor) player.h = player.floor = 0;
      else player.h += (player.floor - player.h) * Math.min(1, dt * 14);
      if (player.stairs !== 0 && player.indoor) {
        const well = surface.stairsNear(player.x, player.y, player.floor);
        const flight = well?.options.find((o) => o.up === player.stairs > 0);
        if (flight) {
          const floors = Math.abs(flight.height - player.floor) / FLOOR_HEIGHT;
          m.climb = { fromX: player.x, fromY: player.y, fromH: player.h, toX: flight.x, toY: flight.y, toH: flight.height, t: 0, seconds: Math.max(0.7, floors * 0.8) };
        }
      }
    } else {
      // Outside. Jump and gravity: the ground is flat, so it is handled here rather than by a ground collider.
      if (mode === 'walk' && keys.has('Space') && player.h === 0) m.vh = JUMP_SPEED;
      if (player.h > 0 || m.vh > 0) {
        m.vh -= GRAVITY * dt;
        player.h = Math.max(0, player.h + m.vh * dt);
        if (player.h === 0) m.vh = 0;
      }
      // Slide along walls.
      if (ctl && capsule && (Math.abs(m.vx) > 1e-3 || Math.abs(m.vy) > 1e-3)) {
        capsule.setTranslation({ x: player.x, y: player.h + HALF_HEIGHT + RADIUS, z: -player.y });
        ctl.computeColliderMovement(capsule, { x: m.vx * dt, y: 0, z: -m.vy * dt });
        const moved = ctl.computedMovement();
        player.x += moved.x;
        player.y -= moved.z;
        player.speed = Math.hypot(moved.x, moved.z) / dt;
      } else {
        player.speed = 0;
      }
      // Stepped into a doorway? From here the indoor surface takes over.
      if (player.h === 0) {
        const door = surface.enter(player.x, player.y);
        if (door) {
          player.indoor = true;
          player.floor = door.height;
        }
      }
    }
    player.stairs = 0;
    capsule?.setTranslation({ x: player.x, y: Math.max(0, player.h) + HALF_HEIGHT + RADIUS, z: -player.y });

    if (moving) player.heading += shortestAngle(player.heading, Math.atan2(dx, dy)) * Math.min(1, dt * 12);

    // Figure: position, facing, and a walk cycle driven by distance covered.
    const g = group.current;
    const running = player.speed > WALK_SPEED * 1.4;
    m.phase += player.speed * dt * (running ? 2.3 : 3.6);
    const stride = Math.min(1, player.speed / WALK_SPEED);
    const swing = Math.sin(m.phase) * (running ? 0.95 : 0.6) * stride;
    const l = limbs.current;
    l.legL.rotation.x = swing;
    l.legR.rotation.x = -swing;
    l.armL.rotation.x = -swing * 0.8;
    l.armR.rotation.x = swing * 0.8;
    l.body.position.y = Math.abs(Math.sin(m.phase)) * 0.045 * stride;
    l.body.rotation.x = running ? 0.16 : 0.04 * stride;
    g.position.set(player.x, player.h, -player.y);
    g.rotation.y = Math.PI - player.heading;
    blob.current.position.set(player.x, (player.indoor ? player.h : 0) + 0.09, -player.y);
    blob.current.scale.setScalar(player.indoor ? 1 : 1 / (1 + player.h * 0.8));

    // "You are here" marker for the map: sized in screen terms, not metres.
    const mk = marker.current;
    mk.visible = mode !== 'walk' || (useApp.getState().nav && useApp.getState().navView === 'map');
    if (mk.visible) {
      mk.position.set(player.x, 0.6, -player.y);
      mk.rotation.y = -player.heading;
      mk.scale.setScalar(Math.max(1, focus.height * 0.012));
    }

    // Where are we? Checked a few times a second.
    m.nearTimer -= dt;
    if (m.nearTimer <= 0) {
      m.nearTimer = 0.2;
      const app = useApp.getState();
      const floor = player.indoor ? surface.at(player.x, player.y, player.floor) : null;
      // Standing in a doorway outside the wall does not count as being inside yet.
      const indoors = floor !== null && (!floor.strip.portal || world.heights.at(player.x, player.y) > 0);
      const inside = floor && indoors ? `${floor.strip.code ?? ''}\t${floor.strip.floor ?? ''}\t${floor.strip.kind}` : null;
      let stairs: typeof app.stairs = null;
      if (player.indoor && !m.climb) {
        const well = surface.stairsNear(player.x, player.y, player.floor);
        if (well) {
          const up = well.options.find((o) => o.up), down = well.options.find((o) => !o.up);
          // If the route takes these stairs, say which way.
          const onRoute = app.route?.links.find((l) => (l.kind === 'stairs' || l.kind === 'elevator') && l.from === well.node);
          const suggest = onRoute ? (onRoute.to === up?.to ? 'up' : onRoute.to === down?.to ? 'down' : undefined) : undefined;
          stairs = { up: up?.label, down: down?.label, suggest };
        }
      }
      const sameStairs = (app.stairs?.up ?? '') === (stairs?.up ?? '') && (app.stairs?.down ?? '') === (stairs?.down ?? '') && app.stairs?.suggest === stairs?.suggest && (app.stairs === null) === (stairs === null);
      if (app.playerIndoors !== indoors || app.inside !== inside || !sameStairs) useApp.setState({ playerIndoors: indoors, inside, stairs });
      let best: string | null = null, bestD = 70;
      for (const b of world.campus.buildings) {
        if (!b.campus || !(b.code || b.name)) continue;
        const d = Math.hypot(b.centre[0] - player.x, b.centre[1] - player.y) - Math.sqrt(b.area) * 0.55;
        if (d < bestD) {
          bestD = d;
          // "code<TAB>name"; the HUD sets the code in bold.
          best = b.code ? `${b.code}\t${b.name ?? ''}` : `\t${b.name}`;
        }
      }
      if (best !== useApp.getState().near) useApp.setState({ near: best });
    }
  });

  const setLimb = (name: keyof typeof limbs.current) => (el: THREE.Group | null) => {
    if (el) limbs.current[name] = el;
  };

  return (
    <>
      <group ref={group}>
        <group ref={setLimb('body')}>
          {/* legs pivot at the hip */}
          <group ref={setLimb('legL')} position={[-0.1, 0.86, 0]}>
            <mesh position={[0, -0.43, 0]}>
              <boxGeometry args={[0.15, 0.86, 0.17]} />
              <meshLambertMaterial color="#2b3140" />
            </mesh>
          </group>
          <group ref={setLimb('legR')} position={[0.1, 0.86, 0]}>
            <mesh position={[0, -0.43, 0]}>
              <boxGeometry args={[0.15, 0.86, 0.17]} />
              <meshLambertMaterial color="#2b3140" />
            </mesh>
          </group>
          {/* torso in Waterloo gold, with a backpack */}
          <mesh position={[0, 1.17, 0]}>
            <boxGeometry args={[0.42, 0.62, 0.24]} />
            <meshLambertMaterial color={ACCENT} />
          </mesh>
          <mesh position={[0, 1.2, -0.19]}>
            <boxGeometry args={[0.32, 0.44, 0.15]} />
            <meshLambertMaterial color="#1c1f26" />
          </mesh>
          <group ref={setLimb('armL')} position={[-0.27, 1.42, 0]}>
            <mesh position={[0, -0.29, 0]}>
              <boxGeometry args={[0.11, 0.6, 0.13]} />
              <meshLambertMaterial color={ACCENT} />
            </mesh>
          </group>
          <group ref={setLimb('armR')} position={[0.27, 1.42, 0]}>
            <mesh position={[0, -0.29, 0]}>
              <boxGeometry args={[0.11, 0.6, 0.13]} />
              <meshLambertMaterial color={ACCENT} />
            </mesh>
          </group>
          <mesh position={[0, 1.64, 0]}>
            <sphereGeometry args={[0.155, 16, 12]} />
            <meshLambertMaterial color="#e8c4a2" />
          </mesh>
          <mesh position={[0, 1.7, -0.02]}>
            <sphereGeometry args={[0.165, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshLambertMaterial color="#3a2a20" />
          </mesh>
        </group>
      </group>

      {/* Contact shadow: the sun's shadow map is too coarse to ground something this small. */}
      <mesh ref={blob} rotation-x={-Math.PI / 2} renderOrder={10}>
        <circleGeometry args={[0.4, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.28} depthWrite={false} />
      </mesh>

      <group ref={marker} visible={false}>
        <mesh rotation-x={-Math.PI / 2} renderOrder={20}>
          <circleGeometry args={[1, 32]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} renderOrder={21}>
          <circleGeometry args={[0.72, 32]} />
          <meshBasicMaterial color="#1c64f2" depthTest={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, -1.25]} renderOrder={21}>
          <circleGeometry args={[0.55, 3, Math.PI / 2]} />
          <meshBasicMaterial color="#1c64f2" depthTest={false} />
        </mesh>
      </group>
    </>
  );
}
