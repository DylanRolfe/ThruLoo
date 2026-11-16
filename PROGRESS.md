# Progress

Read this first when picking the project up in a new session. `BRIEF.md` is the spec, `PLAN.md` the approved design, `DECISIONS.md` the choices that differ from or add to the brief, `REPORT.md` the Phase 1 report (what was verified, known gaps, Phase 2 recommendation), `README.md` how to run and use it.

## Public release branch (2026-11-16)

The `public-release` branch is the public version: the 2D indoor floor-plan feature (`src/indoor2d`, `src/ui/FloorPlan.tsx`, `public/data/indoor`, the floor-plan scripts) and all University of Waterloo copyright data under `data/` (arcgis, accessability, official-map, docs, opendata, compiled) are removed. It has a fresh single-commit history so none of that is in its git history. The full version, with history, lives in the private copy (`master`). Tunnel, bridge and hallway routing (WATIsGrass data) is unchanged. Note: the dev notes (BRIEF, DECISIONS, REPORT) still describe floor plans as history.

## Where things stand

**Phase 1, Phase 2 (tunnels and bridges) and walkable interiors are complete** (2026-11-13), tested and committed. REPORT.md has a section for each. Next is the owner's review and a decision on what follows (terrain, rooms, or a visual pass on the interiors).

## Done

- Data pipeline: `scripts/fetch-osm.mjs`, `scripts/build-geojson.mjs`, `scripts/bake.ts` -> `public/data/campus.json`. `data/overrides.json` holds hand corrections, named places and the spawn.
- Routing (`src/routing`): graph builder, A* with point snapping, outdoor / prefer-indoor / indoor-only profiles, place search with aliases and rooms.
- Scene (`src/scene`): merged ground, buildings (with OSM parts and a window shader), instanced trees, following sun shadow, HTML labels, route ribbon and pins.
- Walking: Rapier kinematic character against a wall trimesh, third-person camera with spring arm.
- Map mode, flythrough (`src/flythrough/path.ts`), deep links, UI (`src/ui`).
- Phase 2: indoor network imported from WATIsGrass (`data/indoor/`, `src/routing/indoor.ts`), joined to the outdoor graph at its exits; Outdoor / Prefer indoor / Indoor only route types with a least-time-outside fallback; step-by-step directions (`src/ui/directions.ts`); see-through tunnel map (`T`); indoor stretches of routes drawn at floor height (`src/scene/ribbon.ts`, `RouteLine.tsx`).
- Walkable interiors: `src/indoor/surface.ts` (strips with width and height, doorways, stairwells, sliding), wired into `src/scene/Player.tsx`; `src/scene/Interiors.tsx` draws hallway floors, tunnel trenches, bridge railings and stair pads; buildings are cut away in a circle around the character while it is inside; `E`/`Q` take stairs.
- Mobile (2026-11-13): phone layout (`src/ui/layout.ts`, dock and bottom sheet in `Hud.tsx` / `Panel.tsx`), joystick (`src/ui/Joystick.tsx`), pinch zoom, live GPS following (`src/state/gps.ts`, follow branch in `Player.tsx`), lighter rendering on phones (`src/state/device.ts`). Flythrough drops to head height on indoor stretches (`src/flythrough/path.ts`) with the building cutaway around the camera.
- 79 tests (`npm test`), flow and screenshot script (`npm run shots`), which now also walks in and out of a door and auto-walks the whole MC to RCH indoor route.

## Waiting on the owner

1. Which REV wing is West Quad. Current guess is in `data/overrides.json` under `places`.
2. Check the six codes added from memory: M3, RAC, RA2, TJB, AVR, BRH.
3. Route to the fastest public entrance (current) or always the tagged main entrance.
4. Flat ground was accepted for Phase 1 by default; say if terrain should come before Phase 2.
5. Correct heights in `data/reports/height-estimates.csv` via overrides when convenient.
6. Context7 MCP needs authorising via `/mcp` if it is wanted.
7. ~~Licence~~ **Decided 2026-11-16: GPL-3.0-only** (WATIsGrass data is GPL-3.0, so the whole project follows). Done in the repo: `LICENSE`, `NOTICE.md`, README credits, credits in the Beta sheet, `license` in package.json. Still by hand: make the GitHub repo public, redeploy, and decide whether to remove the University-of-Waterloo files in `data/` (see NOTICE.md) before going public.

## Known issues

See REPORT.md "Known gaps" for the full list. The ones most likely to matter next:

- Walk-throughs under buildings have collider openings but no visible opening in the mesh.
- A route from "My location" is a snapshot; with live location on, a new one is planned when you are more than about 40 m off it.
- Live location was tested with a simulated GPS feed in the browser, not yet on a real phone walking campus. GPS is poor indoors and in tunnels; there the character holds the route.
- Indoors is hallway centre lines with a fixed width, not real rooms and walls; the cutaway is a circle around the character, not the shape of the building.
- A few WATIsGrass hallways and doors do not line up with the OSM footprints (M3 for one), so a strip can sit partly outside its building.
- "My location" as a route start snaps to the outdoor network even when you are standing indoors.
- Indoor floor heights are approximate (12 height relations in the data disagree on a flat-ground model).
- Bundle is 3.5 MB, 1.2 MB gzipped (Rapier is about 2 MB of it); campus.json is 0.5 MB gzipped. Split and add caching headers before deploying.
- Pointer lock could not be exercised by automation; drag-to-look was.

## Next (candidates, details at the end of REPORT.md)

1. Terrain, which would also fix the approximate floor heights and the doors that sit a floor off the ground.
2. Room positions for the main lecture halls.
3. A visual pass on interiors: cut away only the building you are in, give stairwells real steps, add ceilings to tunnels when seen from inside.

## Notes for whoever works on this next

- `window.__campus` (app store, world, player, view, fly, keys, stats, physics) is there for console poking and for `scripts/shots.mjs`.
- Playwright MCP `browser_navigate` can time out on bare `.svg` URLs; the page still loads.
- Do not edit `src/scene/Player.tsx` while a browser test is mid-walk: hot reload respawns the player.
- three r187: `PCFSoftShadowMap` is gone (use `shadows="percentage"`); light intensities are physical, so a white Lambert surface needs intensity near pi to read as white.
- `.codex/` and `WATIsGrass-main/` (the owner's download) are in the folder but not part of this project; both are git-ignored. The data the app uses is the copy in `data/indoor/watisgrass/`.
- An older dev server may still be holding port 5173; the preview then starts on 5174.

## Commands

```
npm run dev          # app at http://localhost:5173
npm test             # 78 tests
npm run build        # type-check + production build
npm run shots        # needs the dev server running
npm run data         # geojson + bake from the saved OSM response
npm run data:fetch   # re-download from Overpass (rare)
node scripts/preview-svg.mjs   # flat check map in docs/
```
