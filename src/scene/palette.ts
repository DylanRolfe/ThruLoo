// One place for the scene's colours. The look is a well-lit architectural
// model: warm paper ground, muted greens, stone and brick massing, and a single
// saturated accent (Waterloo gold) reserved for the route.

import type { AreaKind, RibbonKind } from '../data/types';

export const SKY = '#dfe8ee';
export const GROUND = '#e2e5d7';
export const ACCENT = '#f6b800';
export const ACCENT_DEEP = '#d99a00';

export const AREA_COLOURS: Record<AreaKind, string> = {
  grass: '#cfdcb6',
  park: '#cbdab2',
  garden: '#c5d7a9',
  wood: '#b5cb9f',
  scrub: '#c2d2aa',
  wetland: '#bcd2c2',
  pitch: '#bed7a2',
  playground: '#e5dbc1',
  construction: '#e0d5c2',
  railway: '#dcd9d6',
  parking: '#d9d6cf',
  plaza: '#efe9dc',
  platform: '#d8d5ce',
  water: '#a8cbe1',
  pool: '#9ccfe6',
};

export const RIBBON_COLOURS: Record<RibbonKind, string> = {
  road: '#c9c7c1',
  service: '#d2d0ca',
  aisle: '#d6d3cc',
  rail: '#9a9597',
  stream: '#a8cbe1',
  footway: '#f6f2e8',
  sidewalk: '#eeeae0',
  path: '#eadfc9',
  shared: '#f3ecdc',
  steps: '#d8cbb4',
  crossing: '#ffffff',
};

export const BUILDING_PALETTE = {
  // Limestone, concrete and buff brick.
  academic: ['#ddd3c3', '#d3c6b3', '#cbbba6', '#d8cdbd', '#c6b6a2', '#cfc3b6', '#c9ad98', '#bfa089', '#d6cfc6'],
  // Warmer brick for residences.
  residence: ['#c9a58e', '#c2987f', '#d0b09a', '#bb9079', '#cdb5a3'],
  // Off-campus context: pale and quiet so the campus reads first.
  context: ['#e4e0d7', '#e0dbd1', '#e7e3db', '#ddd8ce'],
  roof: '#f4f1ea',
};

/** The indoor network. Cool colours, so it never competes with the gold route. */
export const INDOOR_COLOURS: Record<string, string> = {
  tunnel: '#2a5bd7',
  skywalk: '#0b9aa8',
  corridor: '#5a6474',
  stairs: '#8d95a3',
  elevator: '#8d95a3',
  door: '#8d95a3',
};

/** The walkable insides. Pale floors so the character and the gold route read clearly on them. */
export const INTERIOR_COLOURS: Record<string, string> = {
  hall: '#f5f1e7',
  door: '#f2e2b0',
  tunnel: '#dfe6f6',
  tunnelWall: '#aebcdb',
  bridge: '#dbf0f0',
  railing: '#7fbcc1',
  outline: '#6f6a60',
  stairs: '#3c4452',
  stairsMark: '#fed34c',
  post: '#8d95a3',
};

export const TREE_COLOURS = ['#9fbd88', '#abc692', '#93b37e', '#b5ca9c', '#a3c08a'];
export const TRUNK_COLOUR = '#9c8672';
