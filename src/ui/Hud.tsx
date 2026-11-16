// Everything around the edges: view switch, where you are, key hints, attribution.
//
// Desktop: view switch top right, status and key hints bottom left, credits
// bottom right. Phone (see layout.ts): one dock along the bottom with the
// status chips and joystick on the left, round buttons on the right, then the
// route sheet or flythrough bar. The WATIsGrass credit sits under the buttons.

import { useEffect, useState } from 'react';
import { touch } from '../state/device';
import { startGps, stopGps } from '../state/gps';
import { player, stats } from '../state/runtime';
import { useApp } from '../state/store';
import { getWorld } from '../state/world';
import { FlyBar } from './FlyBar';
import { LocateIcon, MapIcon, TunnelIcon, WalkIcon } from './icons';
import { Joystick } from './Joystick';
import { useCompact } from './layout';
import { NavBar } from './Nav';
import { StuckPrompt } from './IndoorPrompts';
import { Legend, PickedSheet, RouteSheet } from './Panel';
import { ArrivalToast } from './Feedback';

export function Hud({ debug }: { debug: boolean }) {
  const compact = useCompact();
  return compact ? <Dock debug={debug} /> : <DesktopHud debug={debug} />;
}

function DesktopHud({ debug }: { debug: boolean }) {
  const mode = useApp((s) => s.mode);
  const locked = useApp((s) => s.pointerLocked);
  const showIndoor = useApp((s) => s.showIndoor);
  const networkVisible = useApp((s) => s.showIndoor || s.routeMode !== 'outdoor');
  const inside = useApp((s) => s.inside);
  const nav = useApp((s) => s.nav);
  const { setMode, set } = useApp.getState();

  return (
    <>
      <div className="views" role="group" aria-label="View">
        <button type="button" className={mode === 'walk' ? 'view view-on' : 'view'} aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>
          Walk
        </button>
        <button type="button" data-tour="map" className={mode === 'map' ? 'view view-on' : 'view'} aria-pressed={mode === 'map'} onClick={() => setMode('map')}>
          Map <kbd>M</kbd>
        </button>
        <span className="views-sep" />
        <button type="button" data-tour="tunnels" className={showIndoor ? 'view view-on' : 'view'} aria-pressed={showIndoor} onClick={() => set({ showIndoor: !showIndoor })} title="Show every tunnel, bridge and hallway">
          Tunnels <kbd>T</kbd>
        </button>
        <span className="views-sep" />
        <LocateButton className="view view-locate" />
      </div>

      <div className="corner">
        {networkVisible && !inside && <Legend />}
        <StuckPrompt />
        <ArrivalToast />
        <Status />
        {mode === 'walk' && !nav && (
          <p className="hint" data-tour="move">
            <span>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> walk
            </span>
            <span>
              <kbd>Shift</kbd> run
            </span>
            {inside ? (
              <span>
                <kbd>E</kbd>
                <kbd>Q</kbd> stairs
              </span>
            ) : (
              <span>
                <kbd>Space</kbd> jump
              </span>
            )}
            <span>{locked ? <><kbd>Esc</kbd> frees the mouse</> : touch ? 'Drag the scene to look around' : 'Click the scene to look around'}</span>
          </p>
        )}
        {mode === 'map' && (
          <p className="hint">
            <span>Drag to pan</span>
            <span>Scroll to zoom</span>
            <span>Click a building for directions</span>
          </p>
        )}
        {mode === 'fly' && (
          <p className="hint">
            <span>
              <kbd>Space</kbd> pause
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
            <span>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> take over
            </span>
          </p>
        )}
      </div>

      {touch && mode === 'walk' && !nav && (
        <div className="stick-float">
          <Joystick />
        </div>
      )}
      <Credit debug={debug} />
      <FlyBar />
      {nav && mode === 'walk' && (
        <div className="navbar-float">
          <NavBar />
        </div>
      )}
    </>
  );
}

/** Phone layout: everything along the bottom edge in one column. */
function Dock({ debug }: { debug: boolean }) {
  const mode = useApp((s) => s.mode);
  const showIndoor = useApp((s) => s.showIndoor);
  const to = useApp((s) => s.to);
  const nav = useApp((s) => s.nav) && mode === 'walk';
  const picked = useApp((s) => s.selected) && mode === 'map';
  const { setMode, set } = useApp.getState();
  return (
    <div className="dock">
      <div className="dock-row">
        <div className="dock-left">
          <StuckPrompt />
          <ArrivalToast />
          <Status />
          {!nav && <FirstHint />}
          {mode === 'walk' && !nav && <Joystick />}
        </div>
        {mode !== 'fly' && !nav && (
          <div className="dock-right">
            <div className="fabs" role="group" aria-label="View">
              <LocateButton className="fab" />
              <button type="button" data-tour="tunnels" className={showIndoor ? 'fab fab-on' : 'fab'} aria-pressed={showIndoor} aria-label="Show tunnels, bridges and hallways" onClick={() => set({ showIndoor: !showIndoor })}>
                <TunnelIcon />
              </button>
              <button type="button" data-tour="map" className="fab" aria-label={mode === 'map' ? 'Walk view' : 'Map view'} onClick={() => setMode(mode === 'map' ? 'walk' : 'map')}>
                {mode === 'map' ? <WalkIcon /> : <MapIcon />}
              </button>
            </div>
            <IndoorCredit />
          </div>
        )}
      </div>
      {mode === 'fly' ? <FlyBar /> : nav ? <NavBar /> : picked ? <PickedSheet /> : to ? <RouteSheet /> : null}
      {/* Phones show only the WATIsGrass credit, under the round buttons. Shadows and the OSM line stay desktop-only. */}
      {debug && (
        <div className="credit">
          <Perf />
        </div>
      )}
    </div>
  );
}

/** Follow my live location. Off, then following; moving by hand pauses following, and a tap resumes it. */
function LocateButton({ className }: { className: string }) {
  const gps = useApp((s) => s.gps);
  const follow = useApp((s) => s.follow);
  const on = gps === 'on' || gps === 'waiting';
  const label = !on ? 'Follow my location' : follow ? 'Stop following my location' : 'Go back to my location';
  return (
    <button
      type="button"
      data-tour="locate"
      className={`${className}${on ? (follow ? ' locate-follow' : ' locate-on') : ''}${gps === 'waiting' ? ' locate-wait' : ''}`}
      aria-pressed={on && follow}
      aria-label={label}
      title={label}
      onClick={() => (on && follow ? stopGps() : startGps())}
    >
      <LocateIcon on={on && follow} />
      {className.includes('view') && <span>Locate</span>}
    </button>
  );
}

/** Where you are, stairs within reach, and what the live location is doing. */
function Status() {
  const mode = useApp((s) => s.mode);
  const near = useApp((s) => s.near);
  const inside = useApp((s) => s.inside);
  const navOn = useApp((s) => s.nav);
  const stairs = useApp((s) => s.stairs);
  const gps = useApp((s) => s.gps);
  const gpsAway = useApp((s) => s.gpsAway);
  const follow = useApp((s) => s.follow);
  const [code, name] = (near ?? '').split('\t');
  const [inCode, inFloor, inKind] = (inside ?? '').split('\t');
  const keysHint = !touch;
  const dismiss = () => stopGps();

  const gpsNote =
    gps === 'waiting' ? 'Finding your location…'
    : gps === 'away' ? `You are ${gpsAway >= 1000 ? `${(gpsAway / 1000).toFixed(gpsAway < 10000 ? 1 : 0)} km` : `${Math.round(gpsAway / 10) * 10} m`} from campus. Live location starts when you get here.`
    : gps === 'denied' ? 'Location is blocked for this site. Allow it in your browser settings to follow yourself on the map.'
    : gps === 'insecure' ? 'Live location needs the site to be served over https.'
    : gps === 'unavailable' ? 'This browser cannot share its location.'
    : null;

  return (
    <>
      {gpsNote && (
        <p className="chip chip-gps" role="status">
          <span>{gpsNote}</span>
          {gps !== 'waiting' && (
            <button type="button" className="chip-x" onClick={dismiss} aria-label="Dismiss">
              ×
            </button>
          )}
        </p>
      )}
      {mode === 'walk' && !navOn && stairs && (
        <p className="stairs" role="status">
          {stairs.up && (
            <button type="button" className={stairs.suggest === 'up' ? 'stair stair-route' : 'stair'} onClick={() => (player.stairs = 1)}>
              {keysHint && <kbd>E</kbd>} Stairs up to {stairs.up}
              {stairs.suggest === 'up' && <em>your route</em>}
            </button>
          )}
          {stairs.down && (
            <button type="button" className={stairs.suggest === 'down' ? 'stair stair-route' : 'stair'} onClick={() => (player.stairs = -1)}>
              {keysHint && <kbd>Q</kbd>} Stairs down to {stairs.down}
              {stairs.suggest === 'down' && <em>your route</em>}
            </button>
          )}
        </p>
      )}
      {mode === 'walk' && inside && (
        <p className="near chip">
          {inKind === 'tunnel' ? (
            <>In a tunnel, towards <b>{inCode}</b></>
          ) : inKind === 'skywalk' ? (
            <>On a bridge, towards <b>{inCode}</b></>
          ) : (
            <>
              Inside <b>{inCode}</b> floor {inFloor}
            </>
          )}
        </p>
      )}
      {mode === 'walk' && !inside && near && (
        <p className="near chip">
          {follow && gps === 'on' && <span className="live-dot" aria-label="Live" />}
          Near <b>{code}</b> {name}
        </p>
      )}
    </>
  );
}

/** Phones: how to move, once, until the first touch. */
function FirstHint() {
  const mode = useApp((s) => s.mode);
  const [show, setShow] = useState(true);
  useEffect(() => {
    const hide = () => setShow(false);
    const id = setTimeout(hide, 9000);
    window.addEventListener('pointerdown', hide, { once: true });
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', hide);
    };
  }, []);
  if (!show || mode !== 'walk') return null;
  return <p className="chip chip-hint">Stick to walk, push to the edge to run. Drag to look, pinch to zoom.</p>;
}

/** Phones: the indoor network credit, linking to WATIsGrass on GitHub. */
function IndoorCredit() {
  const indoorCredit = getWorld().campus.meta.indoorAttribution;
  if (!indoorCredit) return null;
  return (
    <a className="credit" href="https://github.com/rickyqin005/WATIsGrass" target="_blank" rel="noreferrer">
      {indoorCredit}
    </a>
  );
}

/** Desktop only: the corner has room for it. Phones get just the indoor credit (see IndoorCredit). */
function Credit({ debug }: { debug: boolean }) {
  const shadows = useApp((s) => s.shadows);
  const set = useApp((s) => s.set);
  const indoorCredit = getWorld().campus.meta.indoorAttribution;
  return (
    <div className="credit">
      {debug && <Perf />}
      <button type="button" className="credit-toggle" aria-pressed={shadows} onClick={() => set({ shadows: !shadows })} title="Turn shadows off if the frame rate is low">
        Shadows {shadows ? 'on' : 'off'}
      </button>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
      {indoorCredit && (
        <a href="https://github.com/rickyqin005/WATIsGrass" target="_blank" rel="noreferrer">
          {indoorCredit}
        </a>
      )}
    </div>
  );
}

function Perf() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="perf">
      {stats.fps.toFixed(0)} fps, {stats.drawCalls} draws, {(stats.triangles / 1000).toFixed(0)}k tris
    </span>
  );
}
