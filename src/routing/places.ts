// Search over buildings and named places: by code ("RCH"), old code ("E7"),
// name ("coutts"), or a room string ("RCH 101", "MC4020").

import type { Building, NamedPlace } from '../data/types';
import type { Endpoint } from './graph';

export interface Place {
  /** Stable id: building id, named place id, or "point:x,y". */
  id: string;
  /** Short label: "RCH", "RCH 101", "REV West Quad", "Dropped pin". */
  label: string;
  /** Longer description: the building's full name. */
  sub?: string;
  kind: 'building' | 'room' | 'place' | 'point' | 'me';
  building?: string;
  room?: string;
  x: number;
  y: number;
}

interface Entry {
  place: Place;
  /** Upper-case exact keys: code and aliases. */
  codes: string[];
  /** Lower-case name words for prefix matching. */
  words: string[];
  /** Full lower-case text for substring matching. */
  text: string;
  /** Tie-breaker: bigger and more important first. */
  weight: number;
}

const normalise = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const wordsOf = (s: string) => normalise(s).split(/[^a-z0-9]+/).filter(Boolean);

export class PlaceIndex {
  private entries: Entry[] = [];
  private byId = new Map<string, Place>();
  private buildings = new Map<string, Building>();

  constructor(buildings: Building[], named: NamedPlace[] = []) {
    for (const b of buildings) {
      this.buildings.set(b.id, b);
      if (!b.campus || !(b.code || b.name) || b.doors.length === 0) continue;
      const place: Place = { id: b.id, label: b.code ?? b.name!, sub: b.code ? b.name : undefined, kind: 'building', building: b.id, x: b.centre[0], y: b.centre[1] };
      const names = [b.name ?? '', ...(b.aliases ?? [])];
      this.add({
        place,
        codes: [b.code, ...(b.aliases ?? [])].filter((s): s is string => !!s).map((s) => s.toUpperCase()),
        words: names.flatMap(wordsOf),
        text: normalise([b.code ?? '', ...names].join(' ')),
        weight: (b.code ? 1e6 : 0) + b.area,
      });
    }
    for (const p of named) {
      const place: Place = { id: p.id, label: p.label, sub: p.sub, kind: 'place', building: p.building, x: p.x, y: p.y };
      const names = [p.label, ...(p.aliases ?? [])];
      this.add({ place, codes: names.map((s) => s.toUpperCase()), words: names.flatMap(wordsOf), text: normalise(names.join(' ')), weight: 2e6 });
    }
  }

  private add(entry: Entry) {
    // First registration wins when two buildings share a code (for example STJ).
    if (!this.byId.has(entry.place.id)) this.byId.set(entry.place.id, entry.place);
    this.entries.push(entry);
  }

  get(id: string): Place | undefined {
    return this.byId.get(id);
  }

  building(id: string | undefined): Building | undefined {
    return id ? this.buildings.get(id) : undefined;
  }

  /** The place for a building, whether or not it is searchable by name. */
  forBuilding(id: string): Place | undefined {
    const known = this.byId.get(id);
    if (known) return known;
    const b = this.buildings.get(id);
    if (!b || b.doors.length === 0) return undefined;
    return { id: b.id, label: b.code ?? b.name ?? 'Building', sub: b.code ? b.name : undefined, kind: 'building', building: b.id, x: b.centre[0], y: b.centre[1] };
  }

  search(query: string, limit = 8): Place[] {
    const q = query.trim();
    if (!q) return [];
    const upper = q.toUpperCase();
    const lower = normalise(q);
    const qWords = wordsOf(q);

    const scored: { place: Place; score: number; weight: number }[] = [];
    for (const e of this.entries) {
      let score = 0;
      if (e.codes.includes(upper)) score = e.codes[0] === upper ? 100 : 90;
      else if (e.codes.some((c) => c.startsWith(upper))) score = 70;
      else if (qWords.length && qWords.every((w) => e.words.some((x) => x.startsWith(w)))) score = 50;
      else if (lower.length >= 3 && e.text.includes(lower)) score = 30;
      if (score) scored.push({ place: e.place, score, weight: e.weight });
    }

    // "RCH 101", "RCH101", "mc 4020a": a room inside a known building.
    const room = /^([A-Za-z][A-Za-z0-9]{1,4}?)\s*[- ]?\s*(\d{3,4}[A-Za-z]?)$/.exec(q);
    if (room) {
      const code = room[1].toUpperCase();
      const hit = this.entries.find((e) => e.place.kind === 'building' && e.codes.includes(code));
      if (hit) {
        const b = hit.place;
        const label = `${hit.codes[0]} ${room[2].toUpperCase()}`;
        scored.push({
          place: { id: `${b.id}#${room[2].toUpperCase()}`, label, sub: b.sub ? `${b.sub}, via the nearest entrance` : 'Via the nearest entrance', kind: 'room', building: b.building, room: room[2].toUpperCase(), x: b.x, y: b.y },
          score: 110,
          weight: 0,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score || b.weight - a.weight || a.place.label.localeCompare(b.place.label));
    const seen = new Set<string>();
    const out: Place[] = [];
    for (const s of scored) {
      if (seen.has(s.place.id)) continue;
      seen.add(s.place.id);
      out.push(s.place);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Best single match for free text, for deep links such as ?to=RCH%20101. */
  resolve(text: string): Place | undefined {
    return this.search(text, 1)[0];
  }

  /**
   * Where routing should start or end for a place.
   * Buildings and rooms resolve to the building's public entrances; the router
   * picks whichever is fastest to reach. Room-level destinations arrive with
   * building interiors in a later phase.
   */
  endpoint(place: Place): Endpoint | null {
    if (place.kind === 'building' || place.kind === 'room') {
      // Doors for arriving from outside, hallway points for arriving through a
      // tunnel or bridge. The router ends at whichever it reaches first, and
      // the outdoor profile simply cannot reach the indoor ones.
      const b = this.buildings.get(place.building!);
      return b && b.doors.length ? { type: 'nodes', nodes: b.anchors.length ? [...b.doors, ...b.anchors] : b.doors } : null;
    }
    return { type: 'point', x: place.x, y: place.y };
  }
}

export function pointPlace(x: number, y: number, label = 'Dropped pin'): Place {
  return { id: `point:${x.toFixed(1)},${y.toFixed(1)}`, label, kind: 'point', x, y };
}
