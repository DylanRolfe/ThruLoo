import type { Building } from '../data/types';
import type { Place } from '../routing/places';
import type { GraphNode, Route } from '../routing/types';

export function formatDistance(metres: number): { value: string; unit: string } {
  if (metres < 995) return { value: String(Math.round(metres / 10) * 10), unit: 'm' };
  return { value: (metres / 1000).toFixed(1), unit: 'km' };
}

export function formatMinutes(seconds: number): { value: string; unit: string } {
  const min = Math.max(1, Math.round(seconds / 60));
  return { value: String(min), unit: 'min walk' };
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** "the west entrance", from where the door sits relative to the middle of its building. */
export function entranceSide(door: GraphNode, building: Building): string {
  const angle = Math.atan2(door.x - building.centre[0], door.y - building.centre[1]); // 0 = north, clockwise
  const side = COMPASS[Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  return `the ${side} entrance`;
}

/** One line saying where the route ends. */
export function arrivalText(route: Route, to: Place, nodes: GraphNode[], building: Building | undefined): string {
  const door = route.endNode !== undefined ? nodes[route.endNode] : undefined;
  if (!door || !building) return to.kind === 'point' ? 'Ends at your dropped pin.' : `Ends at ${to.label}.`;
  const where = entranceSide(door, building);
  const name = building.name ?? building.code ?? to.label;
  if (to.kind === 'room') return `Ends at ${where} of ${name}. Room ${to.room} is inside.`;
  return `Ends at ${where} of ${name}.`;
}
