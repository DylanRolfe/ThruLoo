import type { EdgeKind, GraphEdge, RouteProfile } from './types';

export const WALK_SPEED = 1.3; // m/s, the brief's walking pace

// How much less pleasant an edge is than a plain footpath. Affects route
// choice only; the reported time uses real length and fixed penalties.
const KIND_FACTOR: Record<EdgeKind, number> = {
  footway: 1,
  sidewalk: 1,
  path: 1,
  plaza: 1,
  crossing: 1,
  steps: 1.25,
  service: 1.25,
  street: 1.5,
  connector: 1.2,
  door: 1,
  tunnel: 1,
  skywalk: 1,
  corridor: 1,
  stairs: 1.5,
  elevator: 1,
};

/** Real walking time over an edge. */
export function edgeSeconds(edge: GraphEdge, speed = WALK_SPEED): number {
  return edge.length / speed + (edge.penalty ?? 0);
}

function baseCost(edge: GraphEdge, speed: number): number {
  return (edge.length / speed) * KIND_FACTOR[edge.kind] + (edge.penalty ?? 0);
}

/** Stay above ground and outside. */
export const outdoorProfile: RouteProfile = {
  name: 'outdoor',
  speed: WALK_SPEED,
  cost: (edge) => (edge.env === 'indoor' ? Infinity : baseCost(edge, WALK_SPEED)),
};

/** Take tunnels and bridges when they do not cost much extra time. */
export function preferIndoorProfile(outdoorMultiplier = 3): RouteProfile {
  return {
    name: 'preferIndoor',
    speed: WALK_SPEED,
    cost: (edge) => baseCost(edge, WALK_SPEED) * (edge.env === 'indoor' ? 1 : outdoorMultiplier),
  };
}

/**
 * Spend as little time outside as possible, whatever it costs in distance.
 * Used when a strictly indoor route does not exist.
 */
export const leastOutdoorProfile: RouteProfile = {
  name: 'leastOutdoor',
  speed: WALK_SPEED,
  cost: (edge) => baseCost(edge, WALK_SPEED) * (edge.env === 'indoor' ? 1 : 40),
};

/**
 * Never step outside, apart from outdoor edges no longer than
 * maxOutdoorDash metres (0 forbids them entirely).
 */
export function indoorOnlyProfile(maxOutdoorDash = 0): RouteProfile {
  return {
    name: 'indoorOnly',
    speed: WALK_SPEED,
    cost: (edge) =>
      edge.env !== 'indoor' && edge.length > maxOutdoorDash ? Infinity : baseCost(edge, WALK_SPEED),
  };
}
