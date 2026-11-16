// Renders the cleaned GeoJSON as a flat SVG map for eyeballing the data against
// OSM or satellite imagery.
//
//   node scripts/preview-svg.mjs                       -> docs/data-preview.svg
//   node scripts/preview-svg.mjs --crop=-1150,-250,-650,150 --out=docs/rev.svg
//
// Crop is xmin,ymin,xmax,ymax in local metres (x east, y north of the origin).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPUS_BBOX, project } from './lib/campus.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const load = async (file) => {
  try { return JSON.parse(await readFile(resolve(root, file), 'utf8')).features; } catch { return []; }
};
const [areas, paths, lines, buildings, parts, entrances, points, routes] = await Promise.all(
  ['areas', 'paths', 'lines', 'buildings', 'building-parts', 'entrances', 'points']
    .map((n) => load(`data/geojson/${n}.geojson`))
    .concat(load('data/reports/spike-routes.geojson')),
);

const [x0, y0] = project(CAMPUS_BBOX.south, CAMPUS_BBOX.west);
const [x1, y1] = project(CAMPUS_BBOX.north, CAMPUS_BBOX.east);
const crop = arg('crop')?.split(',').map(Number) ?? [x0, y0, x1, y1];
const [cx0, cy0, cx1, cy1] = crop;
const scale = Math.min(4, 2400 / (cx1 - cx0)); // px per metre
const detail = scale > 2;

const P = ([lon, lat]) => {
  const [x, y] = project(lat, lon);
  return `${((x - cx0) * scale).toFixed(1)},${((cy1 - y) * scale).toFixed(1)}`;
};
const ringPath = (ring) => 'M' + ring.map(P).join('L') + 'Z';
const polyPath = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((poly) => poly.map(ringPath).join('')).join('');
const linePath = (g) => 'M' + g.coordinates.map(P).join('L');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const visible = (g) => {
  const flat = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0] : g.coordinates.flatMap((p) => p[0]);
  return flat.some(([lon, lat]) => { const [x, y] = project(lat, lon); return x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1; });
};

const AREA = { grass: '#cfe3b4', park: '#c6dfae', garden: '#bfdc9f', wood: '#9fc58c', scrub: '#b9d3a0', wetland: '#b7d6c6', water: '#a9cfe6', pool: '#8cc7e8', parking: '#dcdad3', pitch: '#a8d39a', playground: '#e6dcc0', plaza: '#ece7dc', platform: '#d0d0d0', construction: '#e3d3bd', railway: '#d8d4d8' };
const AREA_ORDER = ['park', 'grass', 'garden', 'scrub', 'wood', 'wetland', 'railway', 'construction', 'parking', 'pitch', 'playground', 'plaza', 'platform', 'water', 'pool'];
const PATH = {
  road: ['#ffffff', 7], service: ['#ffffff', 4], parking_aisle: ['#f4f3ee', 3],
  footway: ['#c0563a', 1.4], sidewalk: ['#d08a72', 1.1], crossing: ['#8a6ad0', 1.6], path: ['#b0703a', 1.3],
  pedestrian: ['#c0563a', 2.2], cycleway: ['#2f7fc0', 1.5], steps: ['#e02a6a', 2.4], platform: ['#999', 1], track: ['#a08050', 1.2],
};
const ENV = { indoor: '#2aa08a', skywalk: '#e09a00', tunnel: '#6a2ad0' };

const out = [];
const w = Math.round((cx1 - cx0) * scale), h = Math.round((cy1 - cy0) * scale);
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui,Segoe UI,sans-serif">`);
out.push(`<rect width="${w}" height="${h}" fill="#e9ece2"/>`);

for (const kind of AREA_ORDER) {
  const d = areas.filter((a) => a.properties.kind === kind && visible(a.geometry)).map((a) => polyPath(a.geometry)).join('');
  if (d) out.push(`<path d="${d}" fill="${AREA[kind]}" fill-rule="evenodd"/>`);
}
for (const l of lines.filter((l) => visible(l.geometry))) {
  const k = l.properties.kind;
  const style = k === 'stream' || k === 'drain' ? ['#7fb6d9', k === 'stream' ? 2.5 : 1] : k === 'rail' || k === 'light_rail' ? ['#77707a', 1.6] : detail ? ['#a09a8a', 0.6] : null;
  if (style) out.push(`<path d="${linePath(l.geometry)}" fill="none" stroke="${style[0]}" stroke-width="${style[1]}"/>`);
}
// Roads first (casing then fill), then the pedestrian network on top.
const outdoor = paths.filter((p) => visible(p.geometry) && !ENV[p.properties.env] && p.properties.kind !== 'construction' && p.properties.kind !== 'corridor');
for (const pass of ['casing', 'fill']) {
  for (const kind of ['parking_aisle', 'service', 'road']) {
    const [colour, width] = PATH[kind];
    const d = outdoor.filter((p) => p.properties.kind === kind).map((p) => linePath(p.geometry)).join('');
    if (!d) continue;
    const sw = (width * scale) / 1.4;
    out.push(pass === 'casing'
      ? `<path d="${d}" fill="none" stroke="#b9b6ad" stroke-width="${(sw + 1.2).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
}
for (const kind of ['sidewalk', 'footway', 'path', 'track', 'cycleway', 'pedestrian', 'platform', 'crossing', 'steps']) {
  const [colour, width] = PATH[kind];
  const d = outdoor.filter((p) => p.properties.kind === kind).map((p) => linePath(p.geometry)).join('');
  if (d) out.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round"${kind === 'steps' ? ' stroke-dasharray="2 1.5"' : ''}/>`);
}

for (const b of buildings.filter((b) => visible(b.geometry))) {
  const p = b.properties;
  const fill = p.kind === 'roof' ? '#d9d2c4' : p.campus ? (p.heightSource === 'default' ? '#b8a48f' : '#a08b76') : '#cfc8bd';
  out.push(`<path d="${polyPath(b.geometry)}" fill="${fill}" fill-rule="evenodd" stroke="#6f6052" stroke-width="${p.campus ? 0.8 : 0.4}"/>`);
}
if (detail) {
  const d = parts.filter((p) => visible(p.geometry)).map((p) => polyPath(p.geometry)).join('');
  if (d) out.push(`<path d="${d}" fill="none" stroke="#5b4d40" stroke-width="0.5" stroke-dasharray="3 2"/>`);
}
// Indoor network on top of buildings: Phase 2 material, shown for reference.
for (const [env, colour] of Object.entries(ENV)) {
  const d = paths.filter((p) => p.properties.env === env && visible(p.geometry)).map((p) => linePath(p.geometry)).join('');
  if (d) out.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-width="${env === 'indoor' ? 1.1 : 2.6}" stroke-linecap="round" opacity="0.9"/>`);
}
if (detail) {
  for (const t of points.filter((p) => p.properties.kind === 'tree' && visible(p.geometry))) {
    const [x, y] = P(t.geometry.coordinates).split(',');
    out.push(`<circle cx="${x}" cy="${y}" r="${(2.2 * scale) / 2}" fill="#6fa765" opacity="0.55"/>`);
  }
}
for (const r of routes.filter((r) => visible(r.geometry))) {
  out.push(`<path d="${linePath(r.geometry)}" fill="none" stroke="#111" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" opacity="0.25"/>`);
  out.push(`<path d="${linePath(r.geometry)}" fill="none" stroke="#ffcc00" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`);
}
for (const e of entrances.filter((e) => visible(e.geometry))) {
  const [x, y] = P(e.geometry.coordinates).split(',');
  const k = e.properties.kind;
  const fill = k === 'main' ? '#00a650' : ['exit', 'emergency', 'service'].includes(k) ? '#888' : '#fff';
  out.push(`<circle cx="${x}" cy="${y}" r="${k === 'main' ? 3.2 : 2.2}" fill="${fill}" stroke="#222" stroke-width="0.7"/>`);
}
for (const b of buildings.filter((b) => visible(b.geometry))) {
  const p = b.properties;
  const label = p.code ?? (detail && p.campus ? p.name : null);
  if (!label) continue;
  const [x, y] = P(p.centre).split(',');
  const size = p.code ? (detail ? 13 : 10) : 8;
  out.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${p.code ? 700 : 400}" text-anchor="middle" dominant-baseline="central" fill="#1b1b1b" stroke="#fff" stroke-width="2.2" paint-order="stroke">${esc(label)}</text>`);
  if (detail) out.push(`<text x="${x}" y="${+y + size}" font-size="7" text-anchor="middle" fill="#333" stroke="#fff" stroke-width="1.6" paint-order="stroke">${esc(`${p.height} m · ${p.heightSource.replace('osm:', '')} · ${b.id}`)}</text>`);
}

// Scale bar and legend.
const bar = 100 * scale;
out.push(`<g transform="translate(20,${h - 30})"><rect x="-8" y="-20" width="${bar + 16}" height="38" fill="#fff" opacity="0.85" rx="4"/><path d="M0,0H${bar}M0,-5V5M${bar},-5V5" stroke="#111" stroke-width="2"/><text x="${bar / 2}" y="-7" font-size="11" text-anchor="middle">100 m</text></g>`);
const legend = [['#c0563a', 'footway'], ['#d08a72', 'sidewalk'], ['#2f7fc0', 'shared path / cycleway'], ['#8a6ad0', 'road crossing'], ['#e02a6a', 'steps'], ['#2aa08a', 'indoor corridor (Phase 2)'], ['#e09a00', 'skywalk bridge (Phase 2)'], ['#6a2ad0', 'tunnel (Phase 2)'], ['#ffcc00', 'spike test route']];
out.push(`<g transform="translate(${w - 210},16)"><rect x="-10" y="-8" width="204" height="${legend.length * 16 + 30}" fill="#fff" opacity="0.88" rx="4"/>`);
legend.forEach(([c, t], i) => out.push(`<path d="M0,${i * 16 + 6}h22" stroke="${c}" stroke-width="3"/><text x="30" y="${i * 16 + 10}" font-size="11">${t}</text>`));
out.push(`<text x="0" y="${legend.length * 16 + 14}" font-size="9" fill="#444">© OpenStreetMap contributors</text></g>`);
out.push('</svg>');

const outFile = resolve(root, arg('out') ?? 'docs/data-preview.svg');
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, out.join('\n') + '\n');
console.log(`${outFile}  ${w}x${h}px  ${(out.join('\n').length / 1e6).toFixed(2)} MB`);
