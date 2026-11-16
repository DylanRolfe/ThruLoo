// Getting somewhere: what to do now, and how far is left.
//
// The banner on top says the current step and the next one; tap it for the
// whole list with where you are marked. The bar at the bottom has the distance
// and time left, the street / map switch, and End.

import { useMemo, useState } from 'react';
import { endNav } from '../state/gps';
import { polyLength } from '../state/nav';
import { useApp } from '../state/store';
import { getWorld } from '../state/world';
import { summarise, type Step } from './directions';
import { formatDistance, formatMinutes } from './format';
import { AheadIcon, CheckIcon, ChevronIcon, MapIcon, WalkIcon } from './icons';

/** Which step the person is on, from how far along the route they are. */
function useProgress() {
  const route = useApp((s) => s.route);
  const along = useApp((s) => s.navAlong);
  const world = getWorld();
  return useMemo(() => {
    if (!route) return null;
    const summary = summarise(route, world.graph.nodes);
    let steps: Step[] = summary.steps;
    if (!steps.length) steps = [{ kind: 'outside', text: 'Walk outside', start: 0, end: route.length }];
    const poly = Math.max(1, polyLength(route));
    // Steps are measured in link metres, the fix in polyline metres; they match to within rounding.
    const linkTotal = route.links.reduce((a, l) => a + l.length, 0) || poly;
    const at = (along / poly) * linkTotal;
    let current = 0;
    for (let i = 0; i < steps.length; i++) if (steps[i].start <= at + 1) current = i;
    const left = Math.max(0, poly - along);
    return { steps, current, at, left, seconds: route.seconds * (left / poly) };
  }, [route, along, world]);
}

const stepLeft = (s: Step, at: number) => Math.max(0, s.end - Math.max(at, s.start));

export function NavSteps() {
  const p = useProgress();
  const to = useApp((s) => s.to);
  const gps = useApp((s) => s.gps);
  const onRoute = useApp((s) => s.navOnRoute);
  const arrived = useApp((s) => s.navArrived);
  const [open, setOpen] = useState(false);
  if (!p || !to) return null;
  const now = p.steps[p.current];
  const next = p.steps[p.current + 1];
  const metres = stepLeft(now, p.at);

  let headline: React.ReactNode;
  let sub: React.ReactNode = next ? <>Then {lower(next.text)}</> : <>Then you are there</>;
  if (arrived) {
    headline = <>You have arrived at {to.label}</>;
    sub = null;
  } else if (gps === 'waiting' || gps === 'off') {
    headline = <>Finding your location…</>;
    sub = <>Starting with {lower(p.steps[0].text)}</>;
  } else if (gps !== 'on') {
    headline = <>Live location is not available</>;
    sub = null;
  } else if (!onRoute) {
    headline = <>Off the route</>;
    sub = <>Head back to the line. If you keep going, a new route is planned from where you are.</>;
  } else {
    headline = (
      <>
        {metres >= 5 && <small>{Math.round(metres / 5) * 5} m</small>}
        {now.text}
      </>
    );
  }

  return (
    <section data-tour="nav-steps" className={`navsteps${open ? ' navsteps-open' : ''}${arrived ? ' navsteps-done' : ''}`} aria-live="polite">
      <button type="button" className="navsteps-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="navsteps-icon">{arrived ? <CheckIcon /> : <AheadIcon />}</span>
        <span className="navsteps-text">
          <span className="navsteps-now">{headline}</span>
          {sub && <span className="navsteps-next">{sub}</span>}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <ol className="steps navsteps-list">
          {p.steps.map((s, i) => (
            <li key={i} className={`step step-${s.kind}${i < p.current ? ' step-past' : ''}${i === p.current && onRoute && !arrived ? ' step-now' : ''}`}>
              <span>{s.text}</span>
              {s.metres !== undefined && s.metres >= 5 && <small>{Math.round(s.metres / 5) * 5} m</small>}
              {i === p.current && onRoute && !arrived && <em>you are here</em>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function NavBar() {
  const p = useProgress();
  const to = useApp((s) => s.to);
  const view = useApp((s) => s.navView);
  const arrived = useApp((s) => s.navArrived);
  const set = useApp((s) => s.set);
  if (!p || !to) return null;
  const distance = formatDistance(p.left);
  const time = formatMinutes(p.seconds);
  return (
    <div className="navbar" role="group" aria-label="Navigation">
      <div className="navbar-left">
        {arrived ? (
          <p className="navbar-figures">
            <b>Arrived</b>
          </p>
        ) : (
          <p className="navbar-figures">
            <b>{time.value} min</b>
          </p>
        )}
        <p className="navbar-to">{arrived ? to.label : `${distance.value} ${distance.unit} · to ${to.label}`}</p>
      </div>
      <button
        type="button"
        className="navbar-btn"
        data-tour="nav-view"
        onClick={() => set({ navView: view === 'map' ? 'street' : 'map' })}
        aria-label={view === 'map' ? 'Street view' : 'Map view'}
        title={view === 'map' ? 'Street view' : 'Map view'}
      >
        {view === 'map' ? <WalkIcon /> : <MapIcon />}
      </button>
      <button type="button" data-tour="nav-end" className="navbar-btn navbar-end" onClick={endNav} aria-label="End navigation">
        {arrived ? 'Done' : 'End'}
      </button>
    </div>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
