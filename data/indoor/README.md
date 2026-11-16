# Indoor network data

`watisgrass/` holds the indoor network of the University of Waterloo campus: hallways, tunnels, enclosed bridges, stairwells and doors, with the floors they connect.

## Source and licence

The files in `watisgrass/` are copied unchanged from the **WATIsGrass** project by Ricky Qin and Manasva Katyal (https://github.com/rickyqin005/WATIsGrass, site https://watisgrass.co), from `web/src/geojson/` in its repository:

- `paths.json`: hallways, tunnels, bridges, walkways, stairs, doors
- `buildings.json`: a point inside each building, per floor, where a route can start or end
- `FORMAT.md`: their description of the format (their `web/src/geojson/README.md`)
- `LICENSE`: their licence, the GNU General Public License version 3

WATIsGrass is licensed under **GPL-3.0**. These files remain under that licence, and so does the indoor part of `public/data/campus.json`, which is derived from them.

What changed and what the licence means (this is a plain reading of the licence, not legal advice):

- Using the data on your own machine carries no obligations.
- If this project is published or deployed, the WATIsGrass data and anything derived from it must stay under GPL-3.0, with this credit and the licence text kept alongside.
- The app shows "Indoor routes: WATIsGrass (GPL-3.0)" at the bottom right for that reason. Please keep it.
- **Decision (2026-11-16): ThruLoo is released under GPL-3.0-only** (see the LICENSE and NOTICE.md at the repository root), so the app and the data share one licence.

## How it is used

`scripts/bake.ts` reads these files through `src/routing/indoor.ts` and adds them to the route graph:

- Hallways, tunnels and bridges become indoor edges at their floor. Stairs become edges between floors, costing 14 seconds a floor (WATIsGrass's figure).
- Their outdoor "walkway" lines are not used. Outside, routes run on the OpenStreetMap path network; each WATIsGrass door to the outside is joined to the nearest OSM entrance of the same building, or to the nearest path.
- Floor heights are worked out from the stairwell data, so tunnels can be drawn below ground and bridges above it.
- OpenStreetMap's own partial indoor mapping is deliberately not mixed in.

## Updating

Download a newer copy of WATIsGrass, replace `paths.json` and `buildings.json` with the files from its `web/src/geojson/` folder, and run `npm run data`. The bake report (`data/reports/bake-summary.json`, under `indoor`) lists what was read, which OSM building each code was matched to, and anything left unconnected.
