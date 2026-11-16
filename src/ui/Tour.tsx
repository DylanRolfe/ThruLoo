// First-visit tutorial: a spotlight on one control at a time, with a short card.
//
// Two short tours, each shown once (remembered in localStorage):
//   intro  the buttons and the search bar, as soon as the campus has loaded
//   route  the three route types, Start and Preview, the first time a route exists
// Add ?tour to the address to see both again.
//
// Controls are found with data-tour="…" attributes, so the same tour works for
// the phone layout and the desktop one. A step whose control is not on screen
// (no joystick on a desktop, say) is skipped.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { useCompact } from './layout';

type Art = 'outdoor' | 'prefer' | 'indoor';

interface Step {
  target: string;
  title: string;
  body: string;
  art?: Art;
}

const INTRO_KEY = 'wcw.tour.intro';
const ROUTE_KEY = 'wcw.tour.route';

const forced = () => new URLSearchParams(location.search).has('tour');

function seen(key: string): boolean {
  if (forced()) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function remember(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* private window: the tour will just show again next time */
  }
}

function introSteps(compact: boolean): Step[] {
  return [
    { target: 'locate', title: 'Use current location', body: 'Follow where you are on the map as you walk around campus.' },
    {
      target: 'tunnels',
      title: compact ? 'Toggle tunnels on the map' : 'Show tunnels on the map',
      body: 'Light up every tunnel, bridge and hallway so you can see how buildings connect.',
    },
    { target: 'map', title: compact ? 'Open bird’s-eye view' : 'Bird’s-eye view', body: 'Fly up for the whole campus map. Tap a building to get directions.' },
    { target: 'search', title: 'Enter your location here', body: 'Type a building or room, like RCH or MC 2017, and we’ll find the way.' },
    compact
      ? { target: 'move', title: 'Move with the joystick', body: 'Push gently to walk, push to the edge to run. Drag the scene to look around.' }
      : { target: 'move', title: 'Move with the keyboard', body: 'W A S D to walk, Shift to run, Space to jump. Click the scene to look around.' },
    { target: 'beta', title: 'Beta: report a problem', body: 'Found an error or a wrong route? Tap Beta to send it to us.' },
  ];
}

const ROUTE_STEPS: Step[] = [
  { target: 'mode-outdoor', title: 'Outdoor', body: 'The fastest way along paths and sidewalks. You’ll be outside the whole way.', art: 'outdoor' },
  { target: 'mode-preferIndoor', title: 'Prefer indoor', body: 'Optimizes for indoor routes: tunnels, bridges and hallways whenever they don’t add much time.', art: 'prefer' },
  { target: 'mode-indoorOnly', title: 'Indoor only', body: 'Indoor routes only, even if it takes a lot longer. Great for snow, rain and cold.', art: 'indoor' },
  { target: 'start', title: 'Start', body: 'Walks with you along the route, following your live location step by step.' },
  { target: 'preview', title: 'Preview', body: 'Watch a quick flythrough of the route before you set off.' },
];

/** Live navigation, the first time it starts. */
export const NAV_STEPS: Step[] = [
  { target: 'nav-steps', title: 'Next step', body: 'The next turn and how far it is. Tap it for the whole list.' },
  { target: 'nav-view', title: 'Street or map', body: 'Switch between the street view and an overhead map that follows you.' },
  { target: 'nav-end', title: 'End or Done', body: 'End stops navigation and leaves you where you are on the map. Done does the same once you arrive.' },
];

/** The flythrough, the first time it plays. */
export const FLY_STEPS: Step[] = [
  { target: 'fly-play', title: 'Play and pause', body: 'Play, pause or replay the flythrough. Space does the same.' },
  { target: 'fly-speed', title: 'Speed', body: 'Change the playback speed: 1×, 2× or 4×.' },
  { target: 'fly-skip', title: 'Skip ahead', body: 'Jump straight to the destination.' },
  { target: 'fly-walk', title: 'Walk from here', body: 'Put yourself on the route at this point and carry on walking.' },
];

/** A tour that plays once, the first time `when` becomes true, and is remembered after that. */
export function OnceTour({ storageKey, when, steps }: { storageKey: string; when: boolean; steps: Step[] }) {
  const [done, setDone] = useState(() => seen(storageKey));
  if (done || !when) return null;
  return (
    <Tour
      key={storageKey}
      steps={steps}
      onDone={() => {
        remember(storageKey);
        setDone(true);
      }}
    />
  );
}

export function Tutorial() {
  const compact = useCompact();
  const route = useApp((s) => s.route);
  const to = useApp((s) => s.to);
  const mode = useApp((s) => s.mode);
  const nav = useApp((s) => s.nav);
  const [introDone, setIntroDone] = useState(() => seen(INTRO_KEY));
  const [routeDone, setRouteDone] = useState(() => seen(ROUTE_KEY));

  // Give the route sheet a moment to slide in before pointing at it.
  const routeReady = !!route && !!to && mode !== 'fly' && !nav;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!routeReady) {
      setSettled(false);
      return;
    }
    const id = setTimeout(() => setSettled(true), 450);
    return () => clearTimeout(id);
  }, [routeReady]);

  if (!introDone) {
    return (
      <Tour
        key="intro"
        steps={introSteps(compact)}
        onDone={() => {
          remember(INTRO_KEY);
          setIntroDone(true);
        }}
      />
    );
  }
  if (!routeDone && routeReady && settled) {
    return (
      <Tour
        key="route"
        steps={ROUTE_STEPS}
        onDone={() => {
          remember(ROUTE_KEY);
          setRouteDone(true);
        }}
      />
    );
  }
  return null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6;
const MARGIN = 12;

function find(target: string): Box | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** The whole screen with a rounded hole over the control, for the dimming layer's clip-path. */
function dimPath(b: Box): string {
  const x = b.x - PAD, y = b.y - PAD, w = b.w + PAD * 2, h = b.h + PAD * 2, r = 12;
  const W = window.innerWidth, H = window.innerHeight;
  return (
    `M0 0H${W}V${H}H0Z ` +
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

export function Tour({ steps, onDone }: { steps: Step[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index];

  const next = () => (index + 1 >= steps.length ? onDone() : setIndex(index + 1));
  const back = () => setIndex(Math.max(0, index - 1));

  // Follow the control every frame: layouts shift (sheets slide in, keyboards open).
  // If it never turns up, move on.
  useEffect(() => {
    let raf = 0;
    const started = performance.now();
    let last: Box | null = null;
    const tick = () => {
      const b = find(step.target);
      if (!b && !last && performance.now() - started > 700) {
        next();
        return;
      }
      if (b && (!last || b.x !== last.x || b.y !== last.y || b.w !== last.w || b.h !== last.h)) {
        last = b;
        setBox(b);
      }
      raf = requestAnimationFrame(tick);
    };
    setBox(null);
    setPos(null);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `next` closes over `index`, which is what changes this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step.target]);

  // Put the card on whichever side of the control has room, with its arrow on the control.
  useLayoutEffect(() => {
    const c = card.current;
    if (!box || !c) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = c.offsetWidth, h = c.offsetHeight;
    const gap = 16;
    const below = vh - (box.y + box.h + PAD) - gap;
    const above = box.y - PAD - gap;
    const putAbove = above >= h || (below < h && above > below);
    const top = putAbove ? Math.max(MARGIN, box.y - PAD - gap - h) : Math.min(vh - h - MARGIN, box.y + box.h + PAD + gap);
    const cx = box.x + box.w / 2;
    const left = Math.min(Math.max(MARGIN, cx - w / 2), Math.max(MARGIN, vw - w - MARGIN));
    const arrow = Math.min(Math.max(20, cx - left), w - 20);
    setPos((p) => (p && p.left === left && p.top === top && p.arrow === arrow && p.above === putAbove ? p : { left, top, arrow, above: putAbove }));
  }, [box, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDone();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        next();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const last = index + 1 === steps.length;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Quick tour">
      <div className="tour-shield" style={box ? { clipPath: `path(evenodd, "${dimPath(box)}")` } : undefined} />
      {box && (
        <div
          className="tour-spot"
          style={{ left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 }}
        />
      )}
      {box && (
        <div
          key={index}
          ref={card}
          className={`tour-card${pos ? (pos.above ? ' tour-above' : ' tour-below') : ''}`}
          style={pos ? { left: pos.left, top: pos.top, ['--arrow' as string]: `${pos.arrow}px` } : { left: 0, top: 0, visibility: 'hidden' }}
        >
          <p className="tour-count">
            {index + 1} of {steps.length}
          </p>
          <h2>{step.title}</h2>
          {step.art && <RouteArt kind={step.art} />}
          <p className="tour-body">{step.body}</p>
          <div className="tour-actions">
            <button type="button" className="tour-skip" onClick={onDone}>
              Skip
            </button>
            <div className="tour-nav">
              {index > 0 && (
                <button type="button" className="tour-skip tour-back" onClick={back}>
                  Back
                </button>
              )}
              <button type="button" className="btn btn-gold tour-next" onClick={next} autoFocus>
                {last ? 'Got it' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A tiny animated sketch of what each route type does: a walker on a path, outside or through a tunnel. */
function RouteArt({ kind }: { kind: Art }) {
  const still = reduced();
  const outdoor = 'M8 40 C 50 40, 60 22, 100 26 S 160 40, 212 22';
  const prefer = 'M8 40 C 30 40, 36 36, 60 36 L 120 36 C 150 36, 160 24, 212 22';
  const indoor = 'M8 36 L 212 36';
  const d = kind === 'outdoor' ? outdoor : kind === 'prefer' ? prefer : indoor;
  return (
    <svg className={`tour-art tour-art-${kind}`} viewBox="0 0 220 52" role="img" aria-label={kind === 'outdoor' ? 'A route outside' : kind === 'prefer' ? 'A route that dips indoors' : 'A route entirely indoors'}>
      <rect className="art-ground" x="0" y="46" width="220" height="6" rx="2" />
      {kind === 'outdoor' && <circle className="art-sun" cx="188" cy="10" r="6" />}
      {kind === 'prefer' && <rect className="art-building" x="48" y="24" width="84" height="22" rx="3" />}
      {kind === 'indoor' && <rect className="art-building" x="2" y="22" width="216" height="24" rx="3" />}
      <path className="art-path" d={d} pathLength="1" />
      <circle className="art-dot" r="4.5" cx={still ? 8 : undefined}>
        {!still && <animateMotion dur="3.2s" repeatCount="indefinite" path={d} />}
      </circle>
    </svg>
  );
}
