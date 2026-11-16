// Fetches raw OpenStreetMap data for UW main campus from the Overpass API and
// saves it to data/raw/osm-overpass.json. Run rarely: the app builds from the
// saved file and never talks to Overpass at runtime.
//
//   node scripts/fetch-osm.mjs
//
// Data © OpenStreetMap contributors, ODbL.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPUS_BBOX } from './lib/campus.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(root, 'data/raw/osm-overpass.json');

const { south, west, north, east } = CAMPUS_BBOX;
const bbox = `${south},${west},${north},${east}`;

// Everything the scene or the route graph could want. Tagged nodes are fetched
// explicitly (entrances, crossings, barriers); untagged geometry nodes come in
// through the recursion at the end.
const query = `
[out:json][timeout:180];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["building:part"](${bbox});
  relation["building:part"](${bbox});
  way["highway"](${bbox});
  way["area:highway"](${bbox});
  way["railway"](${bbox});
  way["waterway"](${bbox});
  way["landuse"](${bbox});
  relation["landuse"](${bbox});
  way["leisure"](${bbox});
  relation["leisure"](${bbox});
  way["natural"](${bbox});
  relation["natural"](${bbox});
  way["amenity"](${bbox});
  relation["amenity"](${bbox});
  way["barrier"](${bbox});
  way["man_made"](${bbox});
  way["indoor"](${bbox});
  node["entrance"](${bbox});
  node["door"](${bbox});
  node["highway"](${bbox});
  node["barrier"](${bbox});
  node["railway"](${bbox});
  node["natural"="tree"](${bbox});
);
(._;>;);
out body qt;
`;

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchFrom(endpoint) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'campus-3d-data-fetch/0.1',
    },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`${endpoint} -> HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.elements) || json.elements.length === 0) {
    throw new Error(`${endpoint} -> empty response${json.remark ? ': ' + json.remark : ''}`);
  }
  if (json.remark) throw new Error(`${endpoint} -> ${json.remark}`);
  return json;
}

let data;
for (const endpoint of endpoints) {
  try {
    console.log(`Fetching ${bbox} from ${endpoint} ...`);
    data = await fetchFrom(endpoint);
    break;
  } catch (err) {
    console.warn(`  failed: ${err.message}`);
  }
}
if (!data) {
  console.error('All Overpass endpoints failed.');
  process.exit(1);
}

data.fetched_at = new Date().toISOString();
data.bbox = CAMPUS_BBOX;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(data));

const counts = { node: 0, way: 0, relation: 0 };
for (const el of data.elements) counts[el.type]++;
console.log(
  `Saved ${outFile}\n  ${counts.node} nodes, ${counts.way} ways, ${counts.relation} relations` +
    `\n  OSM data timestamp: ${data.osm3s?.timestamp_osm_base ?? 'unknown'}`,
);
