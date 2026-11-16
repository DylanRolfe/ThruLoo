// Where from, where to, and the route sign.
//
// Desktop: one column top left. Phone: a slim search bar on top (just "Where
// to?" until there is a destination) and the route in a bottom sheet, drawn by
// the dock (Mobile.tsx) using RouteSheet below.

import { useMemo, useState } from 'react';
import type { Route } from '../routing/types';
import { useApp, type RouteMode } from '../state/store';
import { getWorld } from '../state/world';
import { splitText, summarise } from './directions';
import { arrivalText, formatDistance, formatMinutes } from './format';
import { startNav } from '../state/gps';
import { ChevronIcon, CloseIcon, GoIcon, PlayIcon, SwapIcon } from './icons';
import { NavSteps } from './Nav';
import { useCompact } from './layout';
import { PlaceInput } from './PlaceInput';
import { BetaPill } from './Feedback';

export function Panel() {
  const from = useApp((s) => s.from);
  const to = useApp((s) => s.to);
  const route = useApp((s) => s.route);
  const routeError = useApp((s) => s.routeError);
  const selected = useApp((s) => s.selected);
  const mode = useApp((s) => s.mode);
  const compact = useCompact();
  const showIndoor = useApp((s) => s.showIndoor);
  const networkVisible = useApp((s) => s.showIndoor || s.routeMode !== 'outdoor');
  const inside = useApp((s) => s.inside);
  const { setFrom, setTo, swap, clearRoute, startFly, select } = useApp.getState();

  // While a flythrough plays on a phone, the search bar would only be in the way.
  const nav = useApp((s) => s.nav);
  if (compact && mode === 'fly') return null;
  // Navigating: the current step takes the place of the search.
  if (nav && mode === 'walk') {
    return (
      <aside className={compact ? 'panel panel-compact' : 'panel'} aria-label="Directions">
        <NavSteps />
      </aside>
    );
  }

  return (
    <aside className={compact ? 'panel panel-compact' : 'panel'} aria-label="Directions">
      <div className="search">
        {!compact && (
          <div className="brand">
            <div className="brand-name">
              <img src="/logo.png" alt="" className="brand-logo" width="28" height="28" />
              <h1 className="wordmark">
                ThruLoo
              </h1>
            </div>
            <BetaPill />
          </div>
        )}
        <div className={to || !compact ? 'fields' : 'fields fields-single'} data-tour="search">
          {(to || !compact) && <PlaceInput id="place-from" label="From" value={from} allowMe placeholder="Starting point" onPick={setFrom} />}
          <PlaceInput id="place-to" label="To" value={to} placeholder={compact ? 'Where to?' : 'Where to? Try RCH 101'} onPick={setTo} />
          {(to || !compact) && (
            <button type="button" className="swap" onClick={swap} disabled={!to} aria-label="Swap start and destination" title="Swap start and destination">
              <SwapIcon />
            </button>
          )}
        </div>
        {!compact && <RouteModes />}
      </div>

      {/* Phones: only with the network switched on, or on the map, where there is room for it. */}
      {compact && !inside && (showIndoor || (networkVisible && mode === 'map')) && <Legend />}

      {/* On a phone the picked building is a bottom sheet, drawn by the dock. */}
      {!compact && selected && mode === 'map' && (
        <div className="picked">
          <p className="picked-name">
            <b>{selected.label}</b>
            {selected.sub && <span>{selected.sub}</span>}
          </p>
          <div className="picked-actions">
            <button type="button" className="btn btn-gold" onClick={() => setTo(selected)}>
              Directions to here
            </button>
            <button type="button" className="btn" onClick={() => setFrom(selected)}>
              Start from here
            </button>
            <button type="button" className="x-btn" onClick={() => select(null)} aria-label="Dismiss">
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      {!compact && routeError && (
        <p className="notice" role="alert">
          {routeError} Pick a different start or destination.
        </p>
      )}

      {!compact && route && to && <RouteSign />}
      {!compact && route && to && mode !== 'fly' && (
        <div className="route-actions">
          <button type="button" data-tour="start" className="btn btn-gold" onClick={startNav} title="Follow your live location along the route">
            <GoIcon /> Start
          </button>
          <button type="button" data-tour="preview" className="btn" onClick={startFly} title="Preview the route as a flythrough">
            <PlayIcon /> Preview
          </button>
          <button type="button" className="btn" onClick={clearRoute}>
            Clear route
          </button>
        </div>
      )}
    </aside>
  );
}

/** What the colours of the indoor network mean. */
export function Legend() {
  return (
    <p className="legend">
      <span className="key key-tunnel">Tunnel</span>
      <span className="key key-bridge">Bridge</span>
      <span className="key key-hall">Hallway</span>
      <span className="key key-stairs">Stairs</span>
    </p>
  );
}

/** Phone: the building tapped on the map, as a bottom sheet. */
export function PickedSheet() {
  const selected = useApp((s) => s.selected);
  const { setFrom, setTo, select } = useApp.getState();
  if (!selected) return null;
  return (
    <section className="sheet picked-sheet" aria-live="polite">
      <div className="sheet-top">
        <div className="sheet-head">
          <span className="sheet-to">{selected.label}</span>
          {selected.sub && <span className="sheet-figures">{selected.sub}</span>}
        </div>
        <button type="button" className="x-btn" onClick={() => select(null)} aria-label="Dismiss">
          <CloseIcon />
        </button>
      </div>
      <div className="picked-actions">
        <button type="button" className="btn btn-gold" onClick={() => setTo(selected)}>
          <GoIcon /> Directions
        </button>
        <button type="button" className="btn" onClick={() => setFrom(selected)}>
          Start here
        </button>
      </div>
    </section>
  );
}

const MODES: [RouteMode, string, string][] = [
  ['outdoor', 'Outdoor', 'The fastest way along paths and sidewalks'],
  ['preferIndoor', 'Prefer indoor', 'Use tunnels, bridges and hallways when they do not add much time'],
  ['indoorOnly', 'Indoor only', 'Stay inside the whole way, through tunnels and bridges'],
];

function RouteModes() {
  const routeMode = useApp((s) => s.routeMode);
  const setRouteMode = useApp((s) => s.setRouteMode);
  return (
    <div className="modes" role="group" aria-label="How much of the route may be outside">
      {MODES.map(([value, label, hint]) => (
        <button key={value} type="button" className={routeMode === value ? 'mode mode-on' : 'mode'} aria-pressed={routeMode === value} title={hint} data-tour={`mode-${value}`} onClick={() => setRouteMode(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function useSummary(route: Route) {
  const world = getWorld();
  return useMemo(() => summarise(route, world.graph.nodes), [route, world]);
}

/** Split, warning, steps and arrival note: everything below the headline figures. */
function RouteDetails({ route }: { route: Route }) {
  const to = useApp((s) => s.to)!;
  const fallback = useApp((s) => s.routeFallback);
  const world = getWorld();
  const summary = useSummary(route);
  const split = splitText(summary);
  const endsInside = route.inside[route.inside.length - 1] === 1;
  const endNode = route.endNode !== undefined ? world.graph.nodes[route.endNode] : undefined;
  return (
    <>
      {fallback && (
        <p className="sign-warn">
          These two are not joined indoors. This route keeps you outside for as short a stretch as it can.
        </p>
      )}
      {split && <p className="sign-split">{split}</p>}
      {summary.usesIndoor ? (
        <ol className="steps">
          {summary.steps.map((s, i) => (
            <li key={i} className={`step step-${s.kind}`}>
              <span>{s.text}</span>
              {s.metres !== undefined && s.metres >= 5 && <small>{Math.round(s.metres / 5) * 5} m</small>}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="sign-note">
        {endsInside && endNode?.code
          ? `Ends inside ${endNode.code}, on floor ${endNode.floor}.`
          : arrivalText(route, to, world.graph.nodes, world.places.building(to.building))}
      </p>
    </>
  );
}

/** The route summary, styled after a campus wayfinding blade. */
function RouteSign() {
  const route = useApp((s) => s.route)!;
  const to = useApp((s) => s.to)!;
  const from = useApp((s) => s.from);
  const distance = formatDistance(route.length);
  const time = formatMinutes(route.seconds);
  return (
    <section className="sign" aria-live="polite">
      <p className="sign-to">{to.label}</p>
      <p className="sign-from">from {from.kind === 'me' ? 'where you are' : from.label}</p>
      <dl className="sign-figures">
        <div>
          <dt>Distance</dt>
          <dd>
            {distance.value}
            <small>{distance.unit}</small>
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>
            {time.value}
            <small>{time.unit}</small>
          </dd>
        </div>
      </dl>
      <RouteDetails route={route} />
    </section>
  );
}

/** Phone: the route as a bottom sheet. Collapsed it is one line and two buttons; tap the line for the details. */
export function RouteSheet() {
  const route = useApp((s) => s.route);
  const to = useApp((s) => s.to);
  const routeError = useApp((s) => s.routeError);
  const [open, setOpen] = useState(false);
  const { startFly, clearRoute } = useApp.getState();
  if (!to) return null;
  const title = (
    <span className="sheet-title">
      <span className="sheet-to">{to.label}</span>
      {to.sub && <span className="sheet-sub">{to.sub}</span>}
    </span>
  );
  const clear = (
    <button type="button" className="x-btn" onClick={clearRoute} aria-label="Clear route">
      <CloseIcon />
    </button>
  );
  if (!route) {
    return (
      <section className="sheet">
        <div className="sheet-top">
          <div className="sheet-head">{title}</div>
          {clear}
        </div>
        <div className="sheet-body">
          <RouteModes />
        </div>
        {routeError && <p className="sheet-error">{routeError}</p>}
      </section>
    );
  }
  const distance = formatDistance(route.length);
  const time = formatMinutes(route.seconds);
  return (
    <section className={open ? 'sheet sheet-open' : 'sheet'} aria-live="polite">
      <div className="sheet-top">
        <button type="button" className="sheet-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          {title}
          <span className="sheet-figures">
            <span>
              <b>
                {time.value} {time.unit}
              </b>{' '}
              · {distance.value} {distance.unit}
            </span>
            <ChevronIcon />
          </span>
        </button>
        {clear}
      </div>
      <div className="sheet-body">
        <RouteModes />
        {open && <RouteDetails route={route} />}
      </div>
      <div className="sheet-actions">
        <button type="button" data-tour="start" className="btn btn-gold sheet-start" onClick={startNav}>
          <GoIcon /> Start
        </button>
        <button type="button" data-tour="preview" className="btn" onClick={startFly} aria-label="Preview the route as a flythrough">
          <PlayIcon /> Preview
        </button>
      </div>
    </section>
  );
}
