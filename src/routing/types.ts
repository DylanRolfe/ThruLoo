// Route graph data model. Built once at bake time, shipped as data.
// A route mode is a cost function over this graph, never a different graph.

export type NodeKind = 'junction' | 'door' | 'crossing' | 'stairs' | 'elevator';

export type EdgeKind =
  // Phase 1: above ground
  | 'footway' | 'sidewalk' | 'path' | 'plaza' | 'steps' | 'crossing'
  | 'service' | 'street' | 'connector' | 'door'
  // Phase 2: tunnels, bridges, interiors
  | 'tunnel' | 'skywalk' | 'corridor' | 'stairs' | 'elevator';

export type EdgeEnv = 'outdoor' | 'covered' | 'indoor';

export interface GraphNode {
  id: number;
  /** Metres east of the campus origin. */
  x: number;
  /** Metres north of the campus origin. */
  y: number;
  /** Floor: 0 ground, -1 tunnel level, 1, 2 ... Phase 1 is all 0. */
  level: number;
  kind: NodeKind;
  /** Set on doors and on indoor nodes. */
  building?: string;
  /** OSM entrance value ('main', 'yes', ...) or 'synthetic' when no entrance was mapped. */
  doorKind?: string;
  name?: string;
  /** Indoor nodes: building code and floor label as people say them ("MC", "3"). */
  code?: string;
  floor?: string;
}

export interface GraphEdge {
  id: number;
  a: number;
  b: number;
  /** Metres along the geometry. */
  length: number;
  kind: EdgeKind;
  env: EdgeEnv;
  /** Floor the edge runs on. Stairs and elevators also carry levelTo. */
  level: number;
  levelTo?: number;
  /** Fixed seconds: waiting at a crossing, opening a door, an elevator ride. */
  penalty?: number;
  /** Step-free, for a later accessibility mode. */
  accessible?: boolean;
  /** Indoor edges: which building you are inside. */
  building?: string;
  name?: string;
  /** Polyline [x, y, x, y, ...] from a to b. */
  geometry: number[];
  /**
   * Height of each geometry point in floors above ground, when it is not simply
   * `level` throughout: tunnels dip below ground, stairs climb.
   */
  elev?: number[];
  /**
   * osm: surveyed in OpenStreetMap. watisgrass: indoor network from the WATIsGrass project.
   * manual: hand-added. derived: made by the builder (door connectors, plaza crossings).
   */
  source: EdgeSource;
}

export type EdgeSource = 'osm' | 'watisgrass' | 'manual' | 'derived';

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RouteProfile {
  name: 'outdoor' | 'preferIndoor' | 'indoorOnly' | 'leastOutdoor';
  /** Walking speed in m/s. */
  speed: number;
  /** Search cost in seconds. Infinity means the edge may not be used. */
  cost(edge: GraphEdge): number;
}

export interface RouteStep {
  kind: EdgeKind;
  env: EdgeEnv;
  length: number;
}

/** One traversed edge (or part of one) of a route, in travel order. */
export interface RouteLink {
  /** Graph edge id, or -1 for the straight hop between a free point and the network. */
  edgeId: number;
  kind: EdgeKind;
  env: EdgeEnv;
  length: number;
  seconds: number;
  /** Graph node ids at each end in travel direction; -1 at a free point. */
  from: number;
  to: number;
}

export interface Route {
  /** Polyline [x, y, ...] from start to end. */
  points: number[];
  /** Height of each point in floors above ground (0 outdoors). */
  elev: number[];
  /** 1 for each point that is indoors, 0 otherwise. */
  inside: number[];
  links: RouteLink[];
  /** Metres. */
  length: number;
  /** Estimated walking time in seconds (length / speed plus fixed penalties). */
  seconds: number;
  /** Distance by edge kind, longest first. */
  steps: RouteStep[];
  edgeIds: number[];
  /** Real graph nodes at each end, when the route starts or ends on one (for example a door). */
  startNode?: number;
  endNode?: number;
}
