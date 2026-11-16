# Decisions

Choices that add to or differ from `BRIEF.md`, newest last.

## 2026-11-12: data spike

- **No UW Open Data API.** OSM `ref` tags cover 62 building codes directly and the gaps are small enough for the overrides file. No sign-up needed.
- **Level height is 4.0 m for academic and commercial buildings, 3.2 m for residences** (dormitory, apartments, houses). The brief says about 4 m per level; that overstates residence towers, which have much lower floor-to-floor heights.
- **OSM building parts are used for massing** where they cover the outline (44 buildings). The outline alone is wrong for several important buildings, for example Dana Porter Library (outline says 2 levels, parts give a 10-level tower).
- **Old building codes become search aliases.** E7 is tagged PSE in OSM with `old_ref=E7`; both resolve to the same building.
- **Busy roads are not walkable; quiet streets and service roads are, at a cost.** Ring Road, University Ave and Columbia St have separately mapped sidewalks and crossings, so routing along the roadway would produce routes nobody walks.
- **Cleaned GeoJSON stays in WGS84; projection happens at bake time.** Keeps the cleaned files usable in geojson.io or QGIS for side-by-side checks. Projection is a local equirectangular frame centred on 43.4715 N, 80.5445 W; error over the campus is a few centimetres.
- **Path features keep their OSM node ids.** Graph topology comes from shared node ids, not coordinate matching, so a tunnel under a path can never be joined to it by accident.
- **Indoor, tunnel and skywalk ways are fetched and classified now** even though Phase 1 ignores them, so Phase 2 does not need a new fetch or a schema change.
- **Data scripts are dependency-free Node (`.mjs`).** They run on a fresh clone before `npm install` and do not need a build step. The bake script will be TypeScript because it shares the graph code with the app.

## 2026-11-13: build

- **The open questions in the plan were settled with its defaults,** since approval came without answers: West Quad is the western wing of the northern REV pair, routes end at the fastest public entrance, and the ground is flat.
- **drei is not used.** The brief recommended it; nothing needed it once labels became an HTML overlay and the cameras a single custom rig, so it was removed rather than shipped unused.
- **Rapier does wall collision and camera ray casts only.** The ground is flat, so gravity and jumping are a few lines of arithmetic and there is no ground collider or rigid-body simulation. The character is a capsule collider moved by Rapier's kinematic character controller against one static triangle mesh of building walls.
- **Surveyed paths win over walls.** OSM has 160 places where a footpath crosses a building outline. Blocking them would break real routes, so the bake cuts a collider opening at each crossing, and the router and the collider always agree. Dead-end stubs that only lead to indoor corridors are pruned from the graph. The cost is a brief walk through a solid-looking wall.
- **Plaza outlines are only walkable where they are in the open,** and crossing edges are added between a plaza's connected perimeter points, so routes cut across squares instead of hugging the edge or running under adjacent buildings.
- **Walking speed in the game is 2.4 m/s, running 7.5 m/s.** Real walking pace on a 2 km campus is tedious to play. Route times still use 1.3 m/s.
- **Reported time is distance at 1.3 m/s plus 3 s per mapped road crossing.** Route choice also uses mild preferences (steps and service roads cost a little more) that do not inflate the reported time.
- **The ground never writes depth.** Nothing is ever below it, so ground layers are painted in a fixed order and cannot z-fight at any distance.
- **Windows are a shader pattern on campus buildings only,** laid out in whole bays and floors per wall so none are cut by corners or rooflines, fading to an average tone with distance. The surrounding city stays plain so the campus reads first.
- **The flythrough camera only clears buildings on its own half of the sight line.** Clearing everything between camera and route forces a near-vertical view whenever a building is right beside the path. The route line is drawn faintly through buildings instead.
- **UI direction: campus wayfinding signs.** Black blades with a gold band, codes in Barlow Condensed, fonts self-hosted through @fontsource so the app works offline.
- **Library docs were checked against the installed packages,** because Context7 was not authorised: type definitions for Rapier's character controller and ray casting, and three's source for the shadow map types.

## 2026-11-13: tunnels and bridges

- **The indoor network is WATIsGrass's, imported as data, not traced.** The owner supplied the repository. Its GeoJSON is copied unchanged into `data/indoor/watisgrass/` with its GPL-3.0 licence, and read at bake time. Its graph rule is kept exactly: a node is a (coordinate, building, floor) triple, and features join only where they name the same triple.
- **OSM's own indoor ways are still left out.** Phase 1 planned to import them. WATIsGrass is complete and self-consistent; OSM's indoor mapping is partial and would not join up with it.
- **WATIsGrass's outdoor walkways are not used.** Outside, routes stay on the OSM path network. Each WATIsGrass exit is joined to an existing OSM entrance of the same building when one is within 14 m, otherwise to the nearest path.
- **Exits do not add entrances for outdoor routing.** The link between an exit and the outdoor network is an indoor edge, so the Outdoor route type behaves exactly as in Phase 1, with the same distances.
- **Floor heights are solved, not read.** The data only has relative heights per stairwell. They are spread across floors joined by stairs, tunnels, bridges and doors, then each connected group is shifted so its floors with outside doors average ground level. Tunnels are drawn dipping 0.9 of a floor below their lower end, and bridges are kept at least one floor up, because the solved numbers are approximate on a flat-ground model.
- **Indoor-only falls back instead of failing.** If no fully indoor route exists, the route with the least time outside is shown with a notice. A blank result would be less useful in winter than "this is the best you can do".
- **A building is a set of doors plus hallway points.** Routes may start or end at either; the Outdoor type cannot reach the hallway points, so nothing changes for it. Free points (a dropped pin, your location) only ever attach to the outdoor network.
- **Stairs cost 14 seconds a floor,** WATIsGrass's figure, and doors 2 seconds. Walking speed stays 1.3 m/s.
- **The network is drawn as see-through ribbons at floor height,** with a second, vertical ribbon so lines stay visible from the ground. Indoor stretches of a route show through walls almost solid; outdoor stretches hidden behind a building stay a faint hint.
- **The character still cannot go indoors.** Routes are shown, described and flown. Making tunnels walkable needs real interior geometry and is a separate piece of work.
- **The surrounding city was kept.** The owner offered to cut it for speed; the frame rate did not need it.

## 2026-11-13: walkable tunnels

- **Indoors, the character is kept on "strips", not collided against interior walls.** Every hallway, tunnel, bridge and doorway is a line segment with a width and a height at each end (`src/indoor/surface.ts`). Standing on one means being within half its width, at about its height. That single rule gives corridor walls, stacked floors, tunnel ramps and doorways through building walls without building or colliding against any interior meshes. Rapier is still used outdoors; indoors it is not consulted.
- **Doorways are the only crossing between outside and inside.** Outside, stepping into a doorway's strip hands the character to the indoor surface, which can then carry it through the wall. Inside, the character can only step off the strips from a doorway, and only onto open ground. Ground-level hallways that happen to run under an outdoor breezeway do not capture someone walking the breezeway.
- **Stairs are a key press, not geometry.** The data has stairwells as points, with no run to walk up. Standing at one offers `E` (up) and `Q` (down) with where each leads, and marks the one the current route takes. The character is then carried between floors.
- **Buildings are cut away in a circle around the character while it is inside,** and stay solid beyond it. The first attempt faded every building to a faint shell; inside large buildings made of many overlapping parts (MC) the layers piled up into a murky veil over the character. The cutaway is a discard in the building shader, driven by two uniforms on the one merged mesh, with a dithered rim. The x-ray route pass and the building highlights are switched off at the same time, because both would cover the character.
- **Tunnels are open trenches, bridges have railings, hallways are flat floors with an outline.** The outline is a wider, darker strip under each floor, so where hallways meet the floors cover the joins and only the outer edge of the whole floor plan shows.
- **Tunnel shape changed for walking.** A tunnel between two basements now runs level instead of dipping further. A tunnel the height solver left at ground level still goes down a ramp and up again, but the ramps are measured along the whole tunnel (up to 9 m each) so none is a cliff.
- **Doors that sit a floor off the ground are entered anyway.** On this flat model a few exits come out at a solved height of plus or minus a floor. Where such a door has no length to ramp over, it is treated as a door with steps: you go in or out regardless of height, and the drawn height eases over.
- **The drawn height eases towards the floor height.** Logic uses the exact floor; the figure and camera follow it smoothly, which hides small steps where a hallway's rounded end meets a ramp.
