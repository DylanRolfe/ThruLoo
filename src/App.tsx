import { useEffect, useState } from 'react';
import { Scene } from './scene/Scene';
import { installInput } from './state/input';
import { fly, keys, player, stats, view } from './state/runtime';
import { useApp } from './state/store';
import { loadWorld, type World } from './state/world';
import { Hud } from './ui/Hud';
import { Panel } from './ui/Panel';
import { FLY_STEPS, NAV_STEPS, OnceTour, Tutorial } from './ui/Tour';
import { BetaPill, FeedbackSheet } from './ui/Feedback';
import { useCompact } from './ui/layout';
import { watchSurroundings } from './state/stuck';

declare global {
  interface Window {
    /** Handles for automated checks and for poking at the app from the console. */
    __campus?: { app: typeof useApp; world: World; player: typeof player; view: typeof view; fly: typeof fly; stats: typeof stats; keys: typeof keys; physics?: unknown };
  }
}

/** Applies ?from=REV&to=RCH%20101&route=indoor&view=map&fly=1 so a route can be shared as a link. */
function applyDeepLink(world: World) {
  const q = new URLSearchParams(location.search);
  const app = useApp.getState();
  const from = q.get('from'), to = q.get('to');
  const a = from ? world.places.resolve(from) : undefined;
  const b = to ? world.places.resolve(to) : undefined;
  if (a) {
    app.setFrom(a);
    // Start the player at the chosen start rather than the default spawn.
    const end = world.places.endpoint(a);
    const node = end?.type === 'nodes' ? world.graph.nodes[end.nodes[0]] : undefined;
    player.teleport = node ? { x: node.x, y: node.y } : { x: a.x, y: a.y };
  }
  if (b) app.setTo(b);
  const route = q.get('route');
  if (route === 'indoor') useApp.getState().setRouteMode('indoorOnly');
  else if (route === 'prefer') useApp.getState().setRouteMode('preferIndoor');
  if (q.has('tunnels')) useApp.setState({ showIndoor: true });
  if (q.get('view') === 'map') useApp.getState().setMode('map');
  if (q.get('fly') && useApp.getState().route) useApp.getState().startFly();
}

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null);
  const debug = new URLSearchParams(location.search).has('debug');
  const navigating = useApp((s) => s.nav && s.mode === 'walk');
  const flying = useApp((s) => s.mode === 'fly');
  const compact = useCompact();

  useEffect(() => {
    let cancelled = false;
    loadWorld()
      .then((w) => {
        if (cancelled) return;
        const [x, y, heading] = w.campus.spawn;
        Object.assign(player, { x, y, heading });
        view.yaw = heading;
        window.__campus = { app: useApp, world: w, player, view, fly, stats, keys };
        setWorld(w);
        applyDeepLink(w);
      })
      .catch((e: Error) => setError(e.message));
    const uninstall = installInput();
    // Stuck in a wall: the HUD offers a way out.
    const watch = window.setInterval(() => window.__campus && watchSurroundings(), 400);
    return () => {
      cancelled = true;
      uninstall();
      window.clearInterval(watch);
    };
  }, []);

  return (
    <div className="app">
      {world && labelLayer && <Scene world={world} labelLayer={labelLayer} />}
      <div className="labels" ref={setLabelLayer} aria-hidden="true" />
      {world ? (
        <>
          <Panel />
          <Hud debug={debug} />
          <Tutorial />
          {/* Each of these plays once, the first time its part of the app is on screen. */}
          <OnceTour storageKey="wcw.tour.nav" when={navigating} steps={NAV_STEPS} />
          <OnceTour storageKey="wcw.tour.fly" when={flying} steps={FLY_STEPS} />
          {/* Phones: the Beta tag sits beside the search bar. On desktop it is in the panel. */}
          {compact && <BetaPill className="beta-pill-corner" />}
          <FeedbackSheet />
        </>
      ) : (
        <div className="loading" role="status">
          <p className="wordmark wordmark-large">
            ThruLoo
          </p>
          {error ? <p className="loading-error">{error}</p> : <p className="loading-note">Building the campus</p>}
        </div>
      )}
    </div>
  );
}
