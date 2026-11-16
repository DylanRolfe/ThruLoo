// What the camera is currently looking at, in world space. Written by the
// camera rig each frame, read by the sun (to place its shadow box) and by the
// labels (to decide how much to show).

export const focus = {
  x: 0,
  z: 0,
  /** Half-width of the area that should receive shadows, in metres. */
  radius: 180,
  /** Camera height above ground. */
  height: 10,
};
