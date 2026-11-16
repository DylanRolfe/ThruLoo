// Per-frame mutable state. Deliberately not reactive: the render loop reads and
// writes these every frame, and React must not re-render for any of it.

import type { FlyPath } from '../flythrough/path';

export const player = {
  /** Metres east and north of the campus origin. */
  x: 0,
  y: 0,
  /** Height of the feet above ground, as drawn. */
  h: 0,
  /** Height of the floor being stood on indoors. h eases towards it. */
  floor: 0,
  /** Facing direction in radians, 0 = north, clockwise. */
  heading: 0,
  /** Current horizontal speed in m/s. */
  speed: 0,
  /** Inside the indoor network (a hallway, tunnel, bridge or doorway) rather than on open ground. */
  indoor: false,
  /** Set to move the player somewhere; consumed by the player controller. With indoor set, h is the floor height to stand on. */
  teleport: null as { x: number; y: number; heading?: number; h?: number; indoor?: boolean } | null,
  /** Request to take the stairs: 1 up, -1 down. Consumed by the player controller. */
  stairs: 0,
};

export const view = {
  /** Walk camera orbit, radians. Yaw 0 looks north. */
  yaw: 0,
  pitch: 0.32,
  distance: 9,
  /** performance.now() of the last time the person turned the camera themselves. */
  lookedAt: 0,
  /** Map camera: centre in data space and height above ground. */
  mapX: 0,
  mapY: 0,
  mapHeight: 1400,
  /** Overhead view while navigating: height above the character. */
  navMapHeight: 800,
};

export const fly = {
  path: null as FlyPath | null,
  /** Seconds into the move at 1x. */
  t: 0,
  /** 0 overhead, 1 at head height indoors. Written by the camera rig. */
  low: 0,
};

export const keys = new Set<string>();

/** On-screen joystick: x right, y forward, each -1..1. run when pushed to the rim. */
export const stick = { x: 0, y: 0, run: false };

/** Latest usable GPS fix, in campus metres. */
export const gpsFix = {
  valid: false,
  x: 0,
  y: 0,
  /** Metres, 95 % radius as the browser reports it. */
  accuracy: 0,
  /** performance.now() of the fix. */
  time: 0,
  /** Set on a fix that should move the character straight there rather than walk. */
  jump: false,
  /** Where the character should be for this fix: on the route, a hallway or a path, never in a wall (see nav.ts). */
  tx: 0,
  ty: 0,
  th: 0,
  tIndoor: false,
  /** A point some way ahead on the route, for the navigation camera to face; valid while on the route. */
  aheadX: 0,
  aheadY: 0,
  ahead: false,
};

/** Live numbers for the debug overlay and for automated checks. */
export const stats = { fps: 0, drawCalls: 0, triangles: 0 };
