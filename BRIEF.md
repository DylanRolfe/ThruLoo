# UW Campus 3D: Phase 1 brief for Claude Code (Fable 5.2)

Suggested run settings: `/model fable`, effort `high`. Put this file in an empty repo as `BRIEF.md`, then tell Claude Code: "Read BRIEF.md and start."

---

## Why this exists

I'm an incoming University of Waterloo Mechatronics student. Waterloo's campus is large and confusing, and in winter students move between buildings through a network of tunnels and bridges that most newcomers never learn. I want a browser-based 3D recreation of the campus that does two things:

1. Lets someone walk and run around campus like a game, so it feels like being there.
2. Shows the fastest walking route between two places, then flies a camera along that route so you can see exactly how you'll get there. My test case: from my residence, Ron Eydt Village (REV), West Quad, to RCH 101 (J.R. Coutts Engineering Lecture Hall).

This is a portfolio project first, desktop browser first. It should look polished enough to show people. Later phases add the tunnel and bridge network (with an "indoor only" route option for winter) and possibly building interiors. Phase 1 is above ground only, but the data model has to be ready for those later phases.

You are the owner and long-term maintainer of this codebase, and its design is up to you. Where this brief recommends a library or approach, treat it as a strong default; if you find a better option, use it and note why in `DECISIONS.md`.

## Phase 1 scope

**In scope**
- Every building on UW main campus, generated from real footprint data with correct position, shape, and approximate height. Ring Road and everything inside it is the priority; include the residences north of it (REV, V1, etc.) and anything needed for the REV to RCH route.
- Ground plane with roads, footpaths, Ring Road, grass, parking lots, and the main open spaces, all from map data.
- Third-person walk and run with collision against buildings. Keyboard and mouse (WASD, shift to run, mouse to look).
- Building labels (code and name) that stay readable without cluttering the view.
- Routing: pick a start and a destination (click on a building or the map, or search by building code like RCH, MC, DC), compute the fastest walking route over the footpath network, draw it as a clear line on the ground, show distance and estimated walking time.
- Flythrough: a "Show me" button that flies a smooth camera along the route at a comfortable height and speed, ending at the destination entrance. Pausable, skippable, and the player can take back control at any time.
- A top-down map view toggle so the route is easy to understand at a glance.

**Out of scope for now (but plan for it)**
- Tunnels, bridges, and indoor connections. Do not invent them. Design the route graph so they can be added later as edge types with a floor level, and so a "prefer indoor" or "indoor only" route mode is a small change rather than a rewrite.
- Building interiors and room-level navigation. For now, a room like RCH 101 resolves to its building's main entrance.
- Mobile and touch controls. Keep them possible, don't build them yet.

## Data

- **OpenStreetMap via the Overpass API** is the primary source: building footprints (`building=*`, with `height`, `building:levels`, `name`, `ref`), footpaths and roads (`highway=footway|path|pedestrian|service|...`), entrances (`entrance=*`), and land use. Fetch it once with a script, save the raw response and a cleaned GeoJSON into the repo, and build from the saved files so the app never depends on Overpass at runtime. OSM is ODbL licensed: show "© OpenStreetMap contributors" in the app.
- Where a building has no height, estimate it from `building:levels` (about 4 m per level) and otherwise use a sensible default, and log which buildings were estimated so I can correct them by hand. Keep hand corrections in a small overrides file that survives re-fetching the data.
- **UW Open Data API v3** (openapi.data.uwaterloo.ca) has official building codes and names, but it needs an API key. Ask me before signing up for anything. OSM `ref` tags may already cover most codes; use the API only if OSM has gaps.
- Project lat/lon to a local metric coordinate system centred on campus so one unit equals one metre.

## Recommended stack

- Vite + TypeScript + React Three Fiber (Three.js) + drei.
- Physics and character controller: Rapier (`@react-three/rapier`).
- Building meshes: extrude footprints (earcut or Three's shape extrusion), flat roofs are fine for v1. Merge or batch static geometry so the whole campus renders smoothly.
- Routing: build a weighted graph from footpaths, with buildings connected to the graph at their entrances (or the nearest path point when entrances are missing). A* or Dijkstra (ngraph.path or your own). Edges should carry at least: length, type (outdoor path, road crossing, and later tunnel, bridge, indoor), floor level, and an optional penalty, so later route modes are just different cost functions.
- Camera path: smooth the route points into a curve (e.g. CatmullRomCurve3) and drive the camera along it with eased speed and look-ahead.
- Static hosting (Vercel or Cloudflare Pages). Don't deploy without asking me.

## Look and feel

Stylized and clean, not photoreal. Think a well-lit architectural model: accurate massing, soft shadows, a restrained palette, subtle variation between buildings, readable labels. Polished over detailed. Simple, smooth UI: a search box for start and destination, a route summary card, and the flythrough controls. 60 fps on a normal laptop is the target; tell me if the full campus makes that hard and what you traded off.

## How I'll judge Phase 1

- I can spawn at REV West Quad, walk to RCH, and not clip through buildings.
- Building positions and shapes match a satellite or OSM view when compared side by side.
- The REV to RCH route follows real paths, looks like a route a student would actually take, and the distance and time are plausible (about 1.3 m/s walking pace).
- Routes between at least five other building pairs (e.g. MC to E7, DC to SLC, V1 to QNC) also look sensible.
- The flythrough is smooth, readable, and ends at the right entrance.
- Fresh clone, `npm install`, `npm run dev` works.

## Working approach

1. **Data spike and plan first.** Fetch the OSM data, then write `PLAN.md` covering your architecture, the route graph data model (including how tunnels, bridges, and floors will slot in later), and a short data quality report: how many buildings, how many are missing heights or names, whether the footpath network is connected around REV and RCH. Then stop and show me. This is the only planned checkpoint.
2. After I approve, build in vertical slices so there is always something running: ground and buildings, then walking, then routing, then the flythrough, then polish.
3. Keep `PROGRESS.md` updated with what's done, what's next, and known issues, so a fresh session can pick up where you left off.
4. **Verify your own work.** Unit test the routing (graph building, shortest path, connectivity). Use Playwright, or the browser tools you have, to load the app, take screenshots of key views (campus overview, REV area, RCH area, the drawn route, a frame from the flythrough) and look at them before calling a slice done. Don't report something as working unless you saw it work.
5. Three.js, React Three Fiber, drei, and Rapier change APIs often. Check current docs through Context7 before relying on an API from memory. Use the frontend-design skill for the 2D UI layer (search, route card, controls).
6. Commit to git at the end of every working slice with a clear message, so any bad change is easy to roll back.
7. Use cheaper subagents for mechanical work like data cleaning scripts, tests, and boilerplate, and keep design decisions and review with you.

Routine steps that need no approval: installing npm packages, creating and editing files in this repo, running scripts, tests, and dev servers, and fetching from Overpass. Ask me first before signing up for any service, adding paid dependencies, deploying, or deleting anything outside this repo.

## Finishing work

Please avoid stopping while you still owe work from the current phase. If you hit an ordinary obstacle, diagnose it and work through it. If something is genuinely blocked on me (an API key, a judgment call on scope), record it in `PROGRESS.md`, keep going on everything else, and raise it in your report. If you notice yourself offering to wait or asking whether to continue, proceed on the next part of the task instead.

Every few tool calls, give me a one-line update on where things stand.

## Final report

When Phase 1 is done, write a short report for someone who hasn't watched you work: what was built, how to run it, screenshots of the key views, what you verified and how, known gaps (especially data gaps), and your recommendation for how to add the tunnel network in Phase 2.
