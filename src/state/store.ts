// Reactive app state: what the UI shows and what mode the scene is in.

import { create } from 'zustand';
import { FlyPath } from '../flythrough/path';
import { FLOOR_HEIGHT } from '../indoor/surface';
import { slicePolyline } from '../lib/geom';
import type { Place } from '../routing/places';
import { indoorOnlyProfile, leastOutdoorProfile, outdoorProfile, preferIndoorProfile } from '../routing/profiles';
import type { Route, RouteProfile } from '../routing/types';
import { isCompact } from '../ui/layout';
import { lowPower } from './device';
import { fly, player, view } from './runtime';
import { getWorld } from './world';

export type Mode = 'walk' | 'map' | 'fly';

export type GpsStatus = 'off' | 'waiting' | 'on' | 'away' | 'denied' | 'unavailable' | 'insecure';

/** How much the route may go outside. */
export type RouteMode = 'outdoor' | 'preferIndoor' | 'indoorOnly';

const PROFILES: Record<RouteMode, RouteProfile> = {
  outdoor: outdoorProfile,
  preferIndoor: preferIndoorProfile(),
  indoorOnly: indoorOnlyProfile(),
};

export const ME: Place = { id: 'me', label: 'My location', kind: 'me', x: 0, y: 0 };

interface AppState {
  mode: Mode;
  /** Mode to return to when a flythrough ends or is cancelled. */
  returnMode: Mode;
  from: Place;
  to: Place | null;
  route: Route | null;
  /** Set when a destination is chosen but no route could be found. */
  routeError: string | null;
  routeMode: RouteMode;
  /** True when "indoor only" was asked for but no fully indoor route exists, so the route shown merely stays inside as much as it can. */
  routeFallback: boolean;
  /** Draw the whole tunnel, bridge and hallway network, not just the route. */
  showIndoor: boolean;
  /** Building or point picked on the map, waiting for "from here" / "to here". */
  selected: Place | null;
  /** Where the dropped pin stands on the map: the exact spot clicked. */
  pin: { x: number; y: number } | null;
  flyPlaying: boolean;
  flyDone: boolean;
  /** The Beta feedback sheet is open. */
  feedbackOpen: boolean;
  flySpeed: number;
  /** 0..1, updated a few times a second for the scrubber. */
  flyProgress: number;
  pointerLocked: boolean;
  /** Nearest campus building to the player, for the location chip. */
  near: string | null;
  /** The character is inside a building, tunnel or bridge: buildings are drawn see-through. */
  playerIndoors: boolean;
  /** The flythrough camera is down at head height on an indoor stretch. */
  flyIndoors: boolean;
  /** Where exactly, as "code<TAB>floor<TAB>kind", for the location chip. */
  inside: string | null;
  /** Stairs within reach, and which way the current route goes. */
  stairs: { up?: string; down?: string; suggest?: 'up' | 'down' } | null;
  shadows: boolean;
  /** Live location: off, waiting for a first fix, on, or why it is not working. */
  gps: GpsStatus;
  /** How far away the last fix was, in metres, when it was off campus. */
  gpsAway: number;
  /** The character follows the live location. Cleared when the person moves it themselves. */
  follow: boolean;
  /**
   * Getting somewhere: the character moves only with the live location, along
   * the route, and the UI shows where on the route you are. Otherwise exploring.
   */
  nav: boolean;
  /** While navigating: behind the character, or the map from above. */
  navView: 'street' | 'map';
  /** Metres along the route polyline of the latest fix, while on the route. */
  navAlong: number;
  navOnRoute: boolean;
  navArrived: boolean;
  /** The character is inside a wall, off every hallway and tunnel. */
  stuck: boolean;

  setMode(mode: Mode): void;
  setFrom(place: Place): void;
  setTo(place: Place | null): void;
  swap(): void;
  setRouteMode(mode: RouteMode): void;
  /** Pick a place. `pin` is where on the map it was clicked, which can be inside a building. */
  select(place: Place | null, pin?: { x: number; y: number }): void;
  clearRoute(): void;
  recompute(): void;
  startFly(): void;
  toggleFly(): void;
  seekFly(progress: number): void;
  skipFly(): void;
  exitFly(walkFromHere?: boolean): void;
  set(partial: Partial<AppState>): void;
}

export const useApp = create<AppState>((set, get) => ({
  mode: 'walk',
  returnMode: 'walk',
  from: ME,
  to: null,
  route: null,
  routeError: null,
  routeMode: 'outdoor',
  routeFallback: false,
  showIndoor: false,
  selected: null,
  pin: null,
  flyPlaying: false,
  flyDone: false,
  feedbackOpen: false,
  flySpeed: 1,
  flyProgress: 0,
  pointerLocked: false,
  near: null,
  playerIndoors: false,
  flyIndoors: false,
  inside: null,
  stairs: null,
  shadows: !lowPower,
  gps: 'off',
  gpsAway: 0,
  follow: false,
  nav: false,
  navView: 'street',
  navAlong: 0,
  navOnRoute: false,
  navArrived: false,
  stuck: false,

  set: (partial) => set(partial),

  setMode(mode) {
    // While navigating, "map" means the overhead view that keeps following you.
    if (get().nav && (mode === 'map' || mode === 'walk') && get().mode === 'walk') return set({ navView: mode === 'map' ? 'map' : 'street' });
    const cur = get().mode;
    if (mode === cur) return;
    if (mode === 'fly') return get().startFly();
    if (cur === 'fly') fly.path = null;
    if (mode === 'map') {
      // Open the map on the route if there is one, otherwise on the player.
      const r = get().route;
      if (r) frameMap(r.points);
      else {
        view.mapX = player.x;
        view.mapY = player.y;
        view.mapHeight = 900;
      }
    }
    if (document.pointerLockElement) document.exitPointerLock();
    set({ mode, flyPlaying: false, flyDone: false, flyIndoors: false, selected: mode === 'map' ? get().selected : null });
  },

  setFrom(place) {
    set({ from: place, selected: null });
    get().recompute();
  },
  setTo(place) {
    set({ to: place, selected: null });
    get().recompute();
  },
  swap() {
    const { from, to } = get();
    if (!to) return;
    set({ from: to, to: from.kind === 'me' ? mePlace() : from });
    get().recompute();
  },
  select: (place, pin) => set({ selected: place, pin: place ? (pin ?? (place.kind === 'point' ? { x: place.x, y: place.y } : null)) : null }),
  setRouteMode(routeMode) {
    if (routeMode === get().routeMode) return;
    set({ routeMode });
    get().recompute();
  },

  clearRoute() {
    if (get().mode === 'fly') get().exitFly();
    set({ to: null, from: ME, route: null, routeError: null, routeFallback: false, nav: false, navView: 'street', follow: false });
  },

  recompute() {
    const { from, to, mode } = get();
    if (mode === 'fly') get().exitFly();
    if (!to) return set({ route: null, routeError: null, routeFallback: false });
    const { graph, places } = getWorld();
    const a = from.kind === 'me' ? mePlace() : from;
    const start = places.endpoint(a), end = places.endpoint(to);
    const { routeMode } = get();
    let route = start && end ? graph.route(start, end, PROFILES[routeMode]) : null;
    let routeFallback = false;
    if (!route && start && end && routeMode === 'indoorOnly') {
      // Not every pair of buildings is joined indoors. Show the route with the
      // least time outside instead of nothing, and say so.
      route = graph.route(start, end, leastOutdoorProfile);
      routeFallback = route !== null;
    }
    set({ route, routeFallback, routeError: route ? null : 'No walking route found between these two places.', navAlong: 0, navArrived: false });
    if (route && get().mode === 'map') frameMap(route.points);
  },

  startFly() {
    const { route, mode } = get();
    if (!route) return;
    fly.path = new FlyPath(route.points, {
      heightAt: (x, y) => getWorld().heights.at(x, y),
      elev: route.elev.map((e) => e * FLOOR_HEIGHT),
      inside: route.inside,
    });
    fly.t = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    set({ mode: 'fly', returnMode: mode === 'fly' ? get().returnMode : mode, flyPlaying: true, flyDone: false, flyProgress: 0, selected: null });
  },
  toggleFly() {
    const { flyPlaying, flyDone } = get();
    if (flyDone) {
      fly.t = 0;
      return set({ flyDone: false, flyPlaying: true, flyProgress: 0 });
    }
    set({ flyPlaying: !flyPlaying });
  },
  seekFly(progress) {
    if (!fly.path) return;
    fly.t = Math.max(0, Math.min(1, progress)) * fly.path.duration;
    set({ flyProgress: progress, flyDone: false });
  },
  skipFly() {
    if (!fly.path) return;
    fly.t = fly.path.duration;
    set({ flyProgress: 1, flyDone: true, flyPlaying: false });
  },
  exitFly(walkFromHere = false) {
    if (get().mode !== 'fly') return;
    if (walkFromHere && fly.path) {
      let p = fly.path.pointAtProgress(Math.min(1, fly.t / fly.path.duration));
      const r = get().route;
      if (r && fly.t >= fly.path.duration - 0.05 && r.length > 8) {
        // At the destination: stand a few steps back from the door, facing it.
        const [x, y] = slicePolyline(r.points, r.length - 4, r.length - 4);
        const ex = r.points[r.points.length - 2], ey = r.points[r.points.length - 1];
        p = { x, y, heading: Math.atan2(ex - x, ey - y) };
      }
      // Indoors the character stands on the hallway, tunnel or bridge the route
      // is on at this point. If there is no floor there after all, or the spot
      // is inside a building with no way in, step out to the nearest path.
      const world = getWorld();
      let h = 0, indoor = false;
      if (r) {
        let best = Infinity;
        for (let i = 0; i < r.elev.length; i++) {
          const d = Math.hypot(r.points[i * 2] - p.x, r.points[i * 2 + 1] - p.y);
          if (d < best) {
            best = d;
            h = r.elev[i] * FLOOR_HEIGHT;
            indoor = r.inside[i] === 1;
          }
        }
      }
      if (indoor && !world.surface.at(p.x, p.y, h)) indoor = false;
      if (!indoor && world.heights.at(p.x, p.y) > 0) {
        const out = world.graph.snap(p.x, p.y, 250, outdoorProfile);
        if (out) p = { x: out.x, y: out.y, heading: p.heading };
      }
      player.teleport = { x: p.x, y: p.y, heading: p.heading, h: indoor ? h : 0, indoor };
      view.yaw = p.heading;
    }
    fly.path = null;
    const mode = walkFromHere ? 'walk' : get().returnMode;
    if (mode === 'map' && get().route) frameMap(get().route!.points);
    set({ mode, flyPlaying: false, flyDone: false, flyIndoors: false });
  },
}));

/** A snapshot of where the player is standing, as a route endpoint. */
export function mePlace(): Place {
  return { ...ME, x: player.x, y: player.y };
}

/** Point the map camera at a polyline with some margin. */
function frameMap(points: number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]);
    y0 = Math.min(y0, points[i + 1]);
    x1 = Math.max(x1, points[i]);
    y1 = Math.max(y1, points[i + 1]);
  }
  // The directions panel covers the left of a wide window: fit the route into
  // what is left and centre it there.
  // On a phone the search bar covers the top and the route sheet the bottom.
  const w = window.innerWidth, fullH = Math.max(1, window.innerHeight);
  const compact = isCompact();
  const inset = !compact && w > 900 ? 380 : 0;
  const top = compact ? 80 : 0, bottom = compact ? 190 : 0;
  const h = Math.max(1, fullH - top - bottom);
  // Map camera field of view is 30 degrees vertically; fit the larger extent.
  const tan = Math.tan((30 * Math.PI) / 360);
  const need = Math.max((y1 - y0) / 2 / tan / (h / fullH), (x1 - x0) / 2 / (tan * ((w - inset) / fullH)));
  view.mapHeight = Math.max(260, need * 1.35 + 60);
  const metresPerPixel = (2 * view.mapHeight * tan) / fullH;
  view.mapX = (x0 + x1) / 2 - (inset / 2) * metresPerPixel;
  view.mapY = (y0 + y1) / 2 - ((bottom - top) / 2) * metresPerPixel;
}
