// Loads the running app in a real browser, checks the main flows, and saves
// screenshots of the key views into docs/screenshots/.
//
//   npm run dev        (in another terminal)
//   npm run shots
//
// Uses installed Chrome when there is one; otherwise run
// `npx playwright install chromium` once.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'docs/screenshots');
const base = process.env.APP_URL ?? 'http://localhost:5173';
await mkdir(out, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const open = async (query = '') => {
  try {
    await page.goto(`${base}/?debug${query}`);
  } catch {
    console.error(`Could not reach ${base}. Start the app with "npm run dev" first.`);
    await browser.close();
    process.exit(1);
  }
  await page.waitForFunction(() => window.__campus?.physics, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
};
const shot = async (name) => {
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(`  saved docs/screenshots/${name}.png`);
};
const state = () => page.evaluate(() => {
  const s = window.__campus.app.getState();
  return { mode: s.mode, route: s.route && { metres: Math.round(s.route.length), minutes: +(s.route.seconds / 60).toFixed(1) }, flyDone: s.flyDone };
});
const results = {};

// 1. Whole campus from above.
await open('&view=map');
await page.evaluate(() => Object.assign(window.__campus.view, { mapX: -130, mapY: -40, mapHeight: 3300 }));
await page.waitForTimeout(1800);
await shot('campus-overview');

// 2. Spawn at REV West Quad, third person.
await open();
await page.evaluate(() => Object.assign(window.__campus.view, { pitch: 0.42, distance: 26 }));
await page.waitForTimeout(1200);
await shot('rev-walk');

// 3. Search by typing, as a person would.
await page.click('#place-to');
await page.keyboard.type('RCH 101');
await page.waitForTimeout(250);
await shot('search');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
results.revToRch = (await state()).route;
await shot('route-walk');

// 4. The route on the map.
await page.keyboard.press('m');
await page.waitForTimeout(2200);
results.mapMode = (await state()).mode;
await shot('route-map');

// 5. Flythrough: start, pause, mid-route frame, arrival.
await page.click('text=Show me');
await page.waitForTimeout(6000);
results.flyMode = (await state()).mode;
await shot('flythrough-start');
await page.evaluate(() => window.__campus.app.getState().seekFly(0.56));
await page.waitForTimeout(1500);
await page.keyboard.press('Space');
await shot('flythrough-mid');
await page.keyboard.press('Space');
await page.evaluate(() => window.__campus.app.getState().seekFly(0.97));
await page.waitForFunction(() => window.__campus.app.getState().flyDone, null, { timeout: 30000 });
await page.waitForTimeout(1500);
results.flyArrived = (await state()).flyDone;
await shot('flythrough-arrival');

// 6. Take control back at the destination and look at RCH from the ground.
await page.click('text=Walk from here');
await page.waitForTimeout(1600);
results.afterTakeover = (await state()).mode;
await page.evaluate(() => Object.assign(window.__campus.view, { pitch: 0.3, distance: 16 }));
await page.waitForTimeout(2500);
await shot('rch-walk');

// 7. Other routes from the brief, on the map.
await page.keyboard.press('m');
for (const [from, to] of [['MC', 'E7'], ['DC', 'SLC'], ['V1', 'QNC'], ['SLC', 'E5'], ['CIF', 'SCH']]) {
  await page.evaluate(([a, b]) => {
    const c = window.__campus, s = c.app.getState();
    s.setFrom(c.world.places.resolve(a));
    s.setTo(c.world.places.resolve(b));
  }, [from, to]);
  await page.waitForTimeout(1500);
  results[`${from}-${to}`] = (await state()).route;
  await shot(`route-${from}-${to}`.toLowerCase());
}

// 8. The tunnel, bridge and hallway network on the map.
await page.evaluate(() => {
  const s = window.__campus.app.getState();
  s.clearRoute();
  Object.assign(window.__campus.view, { mapX: 190, mapY: -60, mapHeight: 1250 });
});
await page.keyboard.press('t');
await page.waitForTimeout(1800);
results.tunnelsShown = await page.evaluate(() => window.__campus.app.getState().showIndoor);
await shot('tunnels-map');

// 9. An indoor-only route, chosen with the real controls.
await page.click('#place-from');
await page.keyboard.type('MC');
await page.keyboard.press('Enter');
await page.click('#place-to');
await page.keyboard.type('RCH 101');
await page.keyboard.press('Enter');
await page.click('text=Indoor only');
await page.waitForTimeout(2000);
results.indoor = await page.evaluate(() => {
  const s = window.__campus.app.getState();
  const outside = s.route.links.filter((l) => l.env !== 'indoor').reduce((sum, l) => sum + l.length, 0);
  return { mode: s.routeMode, metres: Math.round(s.route.length), minutes: +(s.route.seconds / 60).toFixed(1), outsideMetres: Math.round(outside), fallback: s.routeFallback, steps: document.querySelectorAll('.step').length };
});
await shot('route-indoor-map');
await page.click('text=Show me');
await page.waitForTimeout(1500);
await page.evaluate(() => window.__campus.app.getState().seekFly(0.5));
await page.waitForTimeout(1500);
await shot('flythrough-indoor');
await page.keyboard.press('Escape');

// 10. A pair with no fully indoor route falls back to the least time outside, and says so.
await page.evaluate(() => {
  const c = window.__campus, s = c.app.getState();
  s.setFrom(c.world.places.resolve('REV West Quad'));
});
await page.waitForTimeout(1800);
results.indoorFallback = await page.evaluate(() => {
  const s = window.__campus.app.getState();
  return { fallback: s.routeFallback, warned: !!document.querySelector('.sign-warn'), metres: Math.round(s.route.length) };
});
await shot('route-indoor-fallback');

// 11. The network seen from the ground.
await page.evaluate(() => {
  const s = window.__campus.app.getState();
  s.clearRoute();
  s.setRouteMode('outdoor');
  s.setMode('walk');
  window.__campus.player.teleport = { x: 215, y: -175, heading: 0.9 };
  Object.assign(window.__campus.view, { yaw: 0.9, pitch: 0.45, distance: 55 });
});
await page.waitForTimeout(3500);
await shot('tunnels-walk');

// 12. Walk in through a door and back out again, with the real movement keys.
const door = await page.evaluate(() => {
  const c = window.__campus, g = c.world.campus.graph;
  // A doorway with some length, so "outside it" has a direction, whose outer
  // end is on open ground and whose inner end is inside the building.
  let pick = null;
  for (const e of g.edges) {
    if (e.kind !== 'door' || e.env !== 'indoor' || e.length < 3 || !g.nodes[e.a].code === !g.nodes[e.b].code) continue;
    const out = g.nodes[g.nodes[e.a].code ? e.b : e.a], inn = g.nodes[g.nodes[e.a].code ? e.a : e.b];
    const l = Math.hypot(out.x - inn.x, out.y - inn.y);
    const ux = (out.x - inn.x) / l, uy = (out.y - inn.y) / l;
    const clear = [2, 3.5, 5].every((d) => c.world.heights.at(out.x + ux * d, out.y + uy * d) === 0);
    if (clear && c.world.heights.at(inn.x, inn.y) > 0 && Math.abs(inn.level) < 0.3) {
      pick = { out, inn, ux, uy };
      break;
    }
  }
  const { out, inn, ux, uy } = pick;
  c.app.getState().set({ showIndoor: false });
  c.player.teleport = { x: out.x + ux * 3.5, y: out.y + uy * 3.5 };
  Object.assign(c.view, { yaw: Math.atan2(-ux, -uy), pitch: 0.6, distance: 14 });
  return { code: inn.code, floor: inn.floor };
});
await page.waitForTimeout(600);
await page.keyboard.down('w');
await page.waitForTimeout(3000);
await page.keyboard.up('w');
await page.waitForTimeout(700);
results.walkedIn = await page.evaluate(() => ({ indoors: window.__campus.app.getState().playerIndoors, inside: window.__campus.app.getState().inside?.split('\t').slice(0, 2).join(' floor ') }));
results.walkedIn.expected = `${door.code} floor ${door.floor}`;
await shot('indoor-entered');
await page.keyboard.down('s');
await page.waitForTimeout(5000);
await page.keyboard.up('s');
await page.waitForTimeout(600);
results.walkedOut = await page.evaluate(() => ({ indoors: window.__campus.app.getState().playerIndoors, indoorState: window.__campus.player.indoor, h: window.__campus.player.h }));

// 13. Walk a whole indoor route: MC to RCH 101 through two tunnels and two
// bridges. A script steers along the route and presses the stairs key the app
// suggests; everything else is the real movement code.
await page.evaluate(() => {
  const c = window.__campus, s = c.app.getState();
  s.setFrom(c.world.places.resolve('MC'));
  s.setTo(c.world.places.resolve('RCH 101'));
  s.setRouteMode('indoorOnly');
  const FH = 3.8;
  const r = c.app.getState().route;
  const pts = r.points, elev = r.elev, n = pts.length / 2;
  c.player.teleport = { x: pts[0], y: pts[1], h: elev[0] * FH, indoor: r.inside[0] === 1 };
  Object.assign(c.view, { pitch: 0.7, distance: 20 });
  // Stairwells are two route points at one spot; in between floors there is no floor to stand on.
  const wells = [];
  for (let i = 1; i < n; i++) if (Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]) < 0.05) wells.push([pts[i * 2], pts[i * 2 + 1]]);
  const a = (window.__auto = { i: 1, done: false, t0: performance.now(), last: performance.now(), lastPos: [pts[0], pts[1], 0], lastKey: 0, flights: 0, stuck: 0, seen: {}, offFloor: 0, frames: 0 });
  c.keys.add('KeyW');
  c.keys.add('ShiftLeft');
  const tick = () => {
    const p = c.player, now = performance.now(), st = c.app.getState();
    a.frames++;
    if (st.inside) {
      const kind = st.inside.split('\t')[2];
      a.seen[kind] = (a.seen[kind] || 0) + 1;
    }
    // Every frame the character must be standing on an indoor floor, except while on the stairs.
    const onStairs = wells.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 2.4);
    if (!onStairs && (!p.indoor || !c.world.surface.at(p.x, p.y, p.floor))) a.offFloor++;
    while (a.i < n) {
      const near = Math.hypot(pts[a.i * 2] - p.x, pts[a.i * 2 + 1] - p.y) < 1.0;
      const sameSpotNext = a.i + 1 < n && Math.hypot(pts[a.i * 2 + 2] - pts[a.i * 2], pts[a.i * 2 + 3] - pts[a.i * 2 + 1]) < 0.05;
      // A stairwell is two route points at one spot: count the first as reached from either floor.
      if (near && (Math.abs(elev[a.i] * FH - p.floor) < 1.3 || sameSpotNext)) a.i++;
      else break;
    }
    if (a.i >= n) {
      a.done = true;
      a.seconds = (now - a.t0) / 1000;
      c.keys.clear();
      return;
    }
    if (st.stairs?.suggest && now - a.lastKey > 1500) {
      p.stairs = st.stairs.suggest === 'up' ? 1 : -1;
      a.lastKey = now;
      a.flights++;
    }
    if (Math.hypot(p.x - a.lastPos[0], p.y - a.lastPos[1]) > 0.5 || Math.abs(p.h - a.lastPos[2]) > 0.5) {
      a.lastPos = [p.x, p.y, p.h];
      a.last = now;
    } else if (now - a.last > 6000) {
      a.stuck++;
      a.i++;
      a.last = now;
    }
    c.view.yaw = Math.atan2(pts[a.i * 2] - p.x, pts[a.i * 2 + 1] - p.y);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const captured = new Set();
for (let k = 0; k < 150; k++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => ({ done: window.__auto.done, kind: window.__campus.app.getState().inside?.split('\t')[2], stairs: !!window.__campus.app.getState().stairs }));
  if (s.kind === 'tunnel' && !captured.has('tunnel')) {
    captured.add('tunnel');
    await shot('indoor-walk-tunnel');
  } else if (s.kind === 'skywalk' && !captured.has('bridge')) {
    captured.add('bridge');
    await shot('indoor-walk-bridge');
  } else if (s.kind === 'corridor' && s.stairs && !captured.has('stairs')) {
    captured.add('stairs');
    await shot('indoor-walk-stairs');
  }
  if (s.done) break;
}
await page.waitForTimeout(800);
await shot('indoor-walk-arrived');
results.indoorWalk = await page.evaluate(() => {
  const c = window.__campus, a = window.__auto, r = c.app.getState().route;
  const end = r.points.slice(-2);
  return {
    arrived: a.done,
    seconds: Math.round(a.seconds ?? 0),
    metresFromEnd: +Math.hypot(c.player.x - end[0], c.player.y - end[1]).toFixed(1),
    endsIn: c.app.getState().inside?.split('\t').slice(0, 2).join(' floor '),
    flightsOfStairs: a.flights,
    stuck: a.stuck,
    framesOffTheFloor: a.offFloor,
    frames: a.frames,
    walkedThrough: Object.keys(a.seen),
  };
});
await page.evaluate(() => {
  const s = window.__campus.app.getState();
  s.clearRoute();
  s.setRouteMode('outdoor');
});

results.render = await page.evaluate(() => {
  const s = window.__campus.stats;
  return { fps: Math.round(s.fps), drawCalls: s.drawCalls, triangles: s.triangles };
});
results.errors = errors;
console.log(JSON.stringify(results, null, 2));
await browser.close();
if (errors.length) process.exit(1);
