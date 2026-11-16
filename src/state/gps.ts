// Live location: watches the phone's GPS and turns fixes into campus metres.
// Each fix is placed somewhere the character can stand (see nav.ts) and, while
// navigating, measured against the route. The character controller does the
// moving (Player.tsx).

import { nearestOnRoute, placeFix, pointAlong, polyLength } from './nav';
import { gpsFix, player, view } from './runtime';
import { ME, useApp } from './store';
import { getWorld } from './world';

const R = 6378137;
const D2R = Math.PI / 180;

/** Same local equirectangular projection the bake uses (scripts/lib/campus.mjs). */
export function projectLatLon(lat: number, lon: number): [number, number] {
  const { origin } = getWorld().campus.meta;
  return [(lon - origin.lon) * D2R * R * Math.cos(origin.lat * D2R), (lat - origin.lat) * D2R * R];
}

/** How far past the edge of the model a fix still counts as "on campus". */
const MARGIN = 150;
/** Leave the route and plan a new one when the live location is this far from it. */
const OFF_ROUTE = 40;
/** Within this of the end, you have arrived. */
const ARRIVED = 15;
/** The navigation camera faces a point this far ahead on the route. */
const LOOK_AHEAD = 18;

let watchId: number | null = null;
let lastReroute = 0;
/** Last raw fix, so a new route or a mode change can re-place it straight away. */
let raw: { x: number; y: number; accuracy: number } | null = null;

/** Start following the live location (asking for permission the first time). */
export function startGps() {
  const app = useApp.getState();
  if (!('geolocation' in navigator)) return app.set({ gps: 'unavailable', follow: false });
  // Browsers only give location to secure pages: https, or localhost.
  if (!window.isSecureContext) return app.set({ gps: 'insecure', follow: false });
  app.set({ follow: true });
  if (app.mode !== 'walk') app.setMode('walk');
  gpsFix.jump = true;
  if (watchId !== null) {
    // Already watching: snap back to where the person is.
    if (raw) place(raw.x, raw.y, raw.accuracy);
    return;
  }
  app.set({ gps: 'waiting' });
  watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}

export function stopGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  raw = null;
  gpsFix.valid = false;
  useApp.getState().set({ gps: 'off', follow: false, nav: false, navView: 'street' });
}

/** The person took over (joystick, keys): keep the location but stop following it. Not while navigating. */
export function pauseFollow() {
  const app = useApp.getState();
  if (app.follow && !app.nav) app.set({ follow: false });
}

/** Get somewhere: follow the live location along the current route. */
export function startNav() {
  const app = useApp.getState();
  if (!app.route) return;
  if (app.mode !== 'walk') app.setMode('walk');
  app.set({ nav: true, navView: 'street', navArrived: false, navOnRoute: false, navAlong: 0, selected: null });
  startGps();
}

/**
 * Back to exploring. The location stays on, so the button can pick it up again.
 * Ending navigation from the overhead view keeps that same picture: the plain map
 * opens on the spot you were at, so nothing jumps.
 */
export function endNav() {
  const app = useApp.getState();
  const overhead = app.navView === 'map';
  if (overhead) {
    view.mapX = player.x;
    view.mapY = player.y;
    view.mapHeight = view.navMapHeight;
  }
  const end = { nav: false, navView: 'street' as const, follow: false, navArrived: false };
  app.set(overhead ? { ...end, mode: 'map' } : end);
  gpsFix.ahead = false;
}

function onFix(pos: GeolocationPosition) {
  const { latitude, longitude, accuracy } = pos.coords;
  const [x, y] = projectLatLon(latitude, longitude);
  const [x0, y0, x1, y1] = getWorld().campus.meta.bounds;
  const app = useApp.getState();
  const dx = Math.max(x0 - MARGIN - x, 0, x - x1 - MARGIN);
  const dy = Math.max(y0 - MARGIN - y, 0, y - y1 - MARGIN);
  if (dx > 0 || dy > 0) {
    gpsFix.valid = false;
    app.set({ gps: 'away', gpsAway: Math.hypot(dx, dy) });
    return;
  }
  raw = { x, y, accuracy };
  if (app.gps !== 'on') app.set({ gps: 'on' });
  place(x, y, accuracy);
}

/** Turn a raw fix into a spot to stand on, and update the route progress. */
function place(x: number, y: number, accuracy: number) {
  const world = getWorld();
  let app = useApp.getState();
  let p = placeFix(world, app.route, x, y, accuracy, player.indoor ? player.floor : 0);

  // Walked off the route? Plan a new one from here. When navigating this is
  // done even if the route started somewhere else.
  const now = performance.now();
  if (app.follow && app.route && app.mode === 'walk' && (app.nav || app.from.kind === 'me') && p.offRoute > OFF_ROUTE + Math.min(30, accuracy) && now - lastReroute > 8000) {
    lastReroute = now;
    // The route starts from where the character is, so put it there first.
    player.x = p.x;
    player.y = p.y;
    if (app.from.kind !== 'me') app.set({ from: ME });
    app.recompute();
    app = useApp.getState();
    p = placeFix(world, app.route, x, y, accuracy, player.indoor ? player.floor : 0);
  }

  Object.assign(gpsFix, { valid: true, x, y, accuracy, time: now, tx: p.x, ty: p.y, th: p.h, tIndoor: p.indoor });

  const route = app.route;
  if (route && p.onRoute) {
    const ahead = pointAlong(route, p.along + LOOK_AHEAD);
    Object.assign(gpsFix, { aheadX: ahead.x, aheadY: ahead.y, ahead: true });
  } else gpsFix.ahead = false;

  if (app.nav && route) {
    const left = polyLength(route) - p.along;
    const arrived = app.navArrived || (p.onRoute && left < ARRIVED);
    const along = p.onRoute ? Math.round(p.along) : app.navAlong;
    if (along !== app.navAlong || p.onRoute !== app.navOnRoute || arrived !== app.navArrived) app.set({ navAlong: along, navOnRoute: p.onRoute, navArrived: arrived });
  }
}

function onError(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) {
    stopGps();
    useApp.getState().set({ gps: 'denied' });
  }
  // Timeouts and lost signal: keep watching; the last fix stays in place.
}

export { nearestOnRoute };

// A new route (new destination, route type, re-plan) changes where on it the
// last fix belongs.
useApp.subscribe((s, prev) => {
  if (s.route !== prev.route && raw && s.follow) place(raw.x, raw.y, raw.accuracy);
});
