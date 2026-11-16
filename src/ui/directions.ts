// Turns a route's links into the handful of steps a person needs:
// which door, which floor, which tunnel or bridge.

import type { GraphNode, Route, RouteLink } from '../routing/types';

export interface Step {
  kind: 'outside' | 'enter' | 'leave' | 'hall' | 'stairs' | 'tunnel' | 'bridge' | 'door';
  text: string;
  /** Metres, where it helps. */
  metres?: number;
  /** Where the step starts and ends, metres along the route (by link length). */
  start: number;
  end: number;
}

export interface RouteSummary {
  steps: Step[];
  insideMetres: number;
  outsideMetres: number;
  floorsUp: number;
  floorsDown: number;
  usesIndoor: boolean;
}

const floorName = (n: GraphNode | undefined) => (n?.code ? `${n.code} floor ${n.floor}` : 'the building');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function summarise(route: Route, nodes: GraphNode[]): RouteSummary {
  const steps: Step[] = [];
  let insideMetres = 0, outsideMetres = 0, floorsUp = 0, floorsDown = 0;
  const node = (id: number) => (id >= 0 ? nodes[id] : undefined);
  const last = () => steps[steps.length - 1];
  // Metres along the route at the start of the current link. Every step pushed
  // or extended while handling a link ends where that link ends.
  let at = 0;
  const push = (step: Omit<Step, 'start' | 'end'>) => steps.push({ ...step, start: at, end: at });

  for (const link of route.links) {
    const from = node(link.from), to = node(link.to);
    const linkEnd = at + link.length;
    if (link.env !== 'indoor') {
      outsideMetres += link.length;
      if (last()?.kind === 'outside') last().metres! += link.length;
      else push({ kind: 'outside', text: 'Walk outside', metres: link.length });
    } else {
      insideMetres += link.length;
      indoorStep(link, from, to);
    }
    // Whichever step this link went into now runs to the end of the link.
    if (last()) last().end = linkEnd;
    at = linkEnd;
  }

  function indoorStep(link: RouteLink, from: GraphNode | undefined, to: GraphNode | undefined) {
    switch (link.kind) {
      case 'door':
        if (from?.code && to?.code) push({ kind: 'door', text: `Through the door into ${floorName(to)}` });
        else if (to?.code) push({ kind: 'enter', text: `Go in at ${floorName(to)}` });
        else push({ kind: 'leave', text: `Leave ${from?.code ?? 'the building'}` });
        break;
      case 'stairs':
      case 'elevator': {
        const rise = (to?.level ?? 0) - (from?.level ?? 0);
        if (rise > 0) floorsUp += rise;
        else floorsDown -= rise;
        const prev = last();
        // Several flights in the same stairwell read as one step.
        if (prev?.kind === 'stairs' && prev.text.startsWith(rise > 0 ? 'Stairs up' : 'Stairs down') && to?.code && prev.text.includes(` to ${to.code} `)) {
          prev.text = prev.text.replace(/floor \S+$/, `floor ${to.floor}`);
        } else {
          push({ kind: 'stairs', text: `Stairs ${rise > 0 ? 'up' : 'down'} to ${floorName(to)}` });
        }
        break;
      }
      case 'tunnel':
        push({ kind: 'tunnel', text: `Tunnel to ${floorName(to)}`, metres: link.length });
        break;
      case 'skywalk':
        push({ kind: 'bridge', text: from?.code === to?.code ? `Bridge across ${floorName(to)}` : `Bridge to ${floorName(to)}`, metres: link.length });
        break;
      default: {
        // Hallways: one step per building floor, however many segments it took.
        const where = floorName(to ?? from);
        const prev = last();
        if (prev?.kind === 'hall' && prev.text === `Along ${where}`) prev.metres! += link.length;
        else if (link.length < 0.5 && from?.code && to?.code && from.code !== to.code) push({ kind: 'door', text: `Continue into ${floorName(to)}` });
        else push({ kind: 'hall', text: `Along ${where}`, metres: link.length });
      }
    }
  }

  // Very short hallway hops between stairs and doors are noise.
  const tidy = steps.filter((s) => !(s.kind === 'hall' && (s.metres ?? 0) < 4));
  return { steps: tidy, insideMetres, outsideMetres, floorsUp, floorsDown, usesIndoor: insideMetres > 0 || tidy.some((s) => s.kind !== 'outside') };
}

/** "All indoors", "620 m indoors, 80 m outside", ... */
export function splitText(s: RouteSummary): string | null {
  if (!s.usesIndoor) return null;
  const m = (v: number) => (v >= 995 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v / 10) * 10} m`);
  const climb = [s.floorsUp ? `${plural(Math.round(s.floorsUp), 'floor')} up` : '', s.floorsDown ? `${plural(Math.round(s.floorsDown), 'floor')} down` : ''].filter(Boolean).join(', ');
  const where = s.outsideMetres < 5 ? 'Indoors all the way' : `${m(s.insideMetres)} indoors, ${m(s.outsideMetres)} outside`;
  return climb ? `${where}. ${climb[0].toUpperCase()}${climb.slice(1)}.` : `${where}.`;
}
