// The static campus: ground, buildings, trees and light.

import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { AreaKind, Building } from '../data/types';
import { hash01, pointInPolygon } from '../lib/geom';
import { pointPlace } from '../routing/places';
import { focus } from './focus';
import { buildAreaGeometry, buildBuildingGeometry, buildHighlightGeometry, buildingAtTriangle, buildRibbonGeometry } from './geometry';
import { ACCENT, GROUND, TREE_COLOURS, TRUNK_COLOUR } from './palette';
import { fly, player, stats, view } from '../state/runtime';
import { lowPower } from '../state/device';
import { useApp } from '../state/store';
import type { World } from '../state/world';

// --------------------------------------------------------------------- light

const SUN = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();

export function Lighting() {
  const light = useRef<THREE.DirectionalLight>(null!);
  const shadows = useApp((s) => s.shadows);
  const radius = useRef(0);

  useFrame(() => {
    const l = light.current;
    const cam = l.shadow.camera;
    // The shadow box follows whatever the camera is looking at and grows with
    // the view, because one static shadow map cannot cover a 2 km campus.
    const r = focus.radius;
    if (Math.abs(r - radius.current) > radius.current * 0.08) {
      radius.current = r;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 10;
      cam.far = 1400 + r * 2;
      cam.updateProjectionMatrix();
      l.shadow.normalBias = Math.max(0.05, (r * 2) / l.shadow.mapSize.x) * 1.6;
    }
    // Snap to shadow texels so edges do not crawl as the focus moves.
    const texel = (radius.current * 2) / l.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    l.target.position.set(fx, 0, fz);
    l.position.set(fx + SUN.x * 700, SUN.y * 700, fz + SUN.z * 700);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      <hemisphereLight args={['#f6f9ff', '#d9d2c2', 2.0]} />
      <directionalLight ref={light} color="#fff4e2" intensity={1.75} castShadow={shadows} shadow-mapSize={lowPower ? [2048, 2048] : [4096, 4096]} shadow-bias={-0.0004} />
    </>
  );
}

// -------------------------------------------------------------------- ground

// Painted back to front. None of the ground writes depth: nothing is ever
// below it, so painter's order is exact and layers can never z-fight.
const NATURAL: AreaKind[] = ['park', 'grass', 'garden', 'scrub', 'wetland', 'railway', 'construction', 'playground', 'wood', 'pitch'];
const PAVED: AreaKind[] = ['parking', 'platform', 'plaza'];
const WATER: AreaKind[] = ['water', 'pool'];

export function Ground({ world }: { world: World }) {
  const { campus } = world;
  const layers = useMemo(
    () => [
      buildAreaGeometry(campus.areas, NATURAL),
      buildAreaGeometry(campus.areas, PAVED),
      buildRibbonGeometry(campus.ribbons, ['aisle', 'service', 'road'], 1.2), // kerb: a slightly wider, darker underlay
      buildRibbonGeometry(campus.ribbons, ['aisle', 'service', 'road', 'rail']),
      buildAreaGeometry(campus.areas, WATER),
      buildRibbonGeometry(campus.ribbons, ['stream']),
      buildRibbonGeometry(campus.ribbons, ['path', 'sidewalk', 'shared', 'footway', 'steps', 'crossing']),
    ],
    [campus],
  );
  const selectPoint = useApp((s) => s.select);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (useApp.getState().mode !== 'map' || e.delta > 5) return;
    e.stopPropagation();
    selectPoint(pointPlace(e.point.x, -e.point.z));
  };

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} renderOrder={-20} receiveShadow onClick={onClick}>
        <planeGeometry args={[30000, 30000]} />
        <meshLambertMaterial color={GROUND} depthWrite={false} />
      </mesh>
      {layers.map((geometry, i) => (
        <mesh key={i} geometry={geometry} renderOrder={-19 + i} receiveShadow>
          {i === 2 ? (
            <meshLambertMaterial color="#b9b6ae" depthWrite={false} />
          ) : (
            <meshLambertMaterial vertexColors depthWrite={false} />
          )}
        </mesh>
      ))}
    </group>
  );
}

// ----------------------------------------------------------------- buildings

export function Buildings({ world }: { world: World }) {
  const { campus, places } = world;
  const { geometry, triStart } = useMemo(() => buildBuildingGeometry(campus.buildings), [campus]);
  const material = useMemo(() => windowedMaterial(), []);
  // While the character is indoors the buildings are cut away in a circle
  // around them, so the hallways and whoever is in them can be seen. Further
  // out the campus stays solid.
  // The flythrough does the same around its camera while it is down at head
  // height on an indoor stretch.
  useFrame(({ camera }, dt) => {
    const cut = material.userData.cut as { centre: { value: THREE.Vector2 }; radius: { value: number } };
    const { mode, playerIndoors, nav, navView } = useApp.getState();
    // From straight above (the navigation map) the whole campus stays solid.
    const overhead = nav && navView === 'map';
    const flyLow = mode === 'fly' && fly.low > 0.02;
    const target = flyLow ? 30 * Math.min(1, fly.low * 1.6) : playerIndoors && mode === 'walk' && !overhead ? 34 + view.distance * 1.1 : 0;
    // Follow the flythrough closely; it moves faster than anyone walks.
    cut.radius.value += (target - cut.radius.value) * Math.min(1, dt * (flyLow ? 12 : 5));
    if (cut.radius.value < 0.05) cut.radius.value = 0;
    if (mode === 'fly') cut.centre.value.set(camera.position.x, camera.position.z);
    else cut.centre.value.set(player.x, -player.y);
  });
  const select = useApp((s) => s.select);
  const selectedId = useApp((s) => s.selected?.building);
  const toId = useApp((s) => s.to?.building);
  const fromId = useApp((s) => s.from.building);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (useApp.getState().mode !== 'map' || e.delta > 5 || e.faceIndex == null) return;
    e.stopPropagation();
    const b = campus.buildings[buildingAtTriangle(triStart, e.faceIndex)];
    // Buildings without a door (off-campus context) fall back to a dropped pin beside them.
    select(places.forBuilding(b.id) ?? pointPlace(e.point.x, -e.point.z), { x: e.point.x, y: -e.point.z });
  };

  // No tinted shells while the character is inside one: it would wash out the hallways.
  const indoors = useApp((s) => s.playerIndoors);
  const highlighted = indoors ? [] : [...new Set([selectedId, toId, fromId].filter((id): id is string => !!id))];

  return (
    <group>
      <mesh geometry={geometry} material={material} castShadow receiveShadow onClick={onClick} />
      {highlighted.map((id) => {
        const b = world.buildingById.get(id);
        return b ? <Highlight key={id} building={b} strong={id === toId} /> : null;
      })}
    </group>
  );
}

/**
 * Lambert material with a window grid on walls, driven by the "bay" attribute
 * (whole numbers at bay boundaries). The grid fades to its average tone with
 * distance, so far-off buildings neither shimmer nor change brightness.
 */
function windowedMaterial(): THREE.Material {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  // The cutaway: everything within a radius of a point (the character) is not
  // drawn. Radius 0 switches it off. The rim is dithered so it reads as a soft
  // edge rather than a knife cut.
  const cut = { centre: { value: new THREE.Vector2() }, radius: { value: 0 } };
  m.userData.cut = cut;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.cutCentre = cut.centre;
    shader.uniforms.cutRadius = cut.radius;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 bay;\nvarying vec2 vBay;\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBay = bay;\nvGround = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBay;\nvarying vec2 vGround;\nuniform vec2 cutCentre;\nuniform float cutRadius;')
      .replace(
        'void main() {',
        `void main() {
        if (cutRadius > 0.0) {
          float rim = (cutRadius - distance(vGround, cutCentre)) / 5.0;
          float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (rim > noise) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 f = fract(vBay);
          vec2 aa = fwidth(vBay) * 0.75;
          float across = smoothstep(0.2 - aa.x, 0.2 + aa.x, f.x) * (1.0 - smoothstep(0.8 - aa.x, 0.8 + aa.x, f.x));
          float upward = smoothstep(0.34 - aa.y, 0.34 + aa.y, f.y) * (1.0 - smoothstep(0.8 - aa.y, 0.8 + aa.y, f.y));
          float sharp = 1.0 - smoothstep(0.1, 0.4, max(aa.x, aa.y));
          // Roofs and walls too small for a bay have a constant coordinate: no grid there.
          float grid = step(1e-6, aa.x) * step(1e-6, aa.y);
          float glass = mix(0.276, across * upward, sharp) * grid;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.68, 0.8), glass * 0.6);
        }`,
      );
  };
  return m;
}

function Highlight({ building, strong }: { building: Building; strong: boolean }) {
  const geometry = useMemo(() => buildHighlightGeometry(building), [building]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={5}>
      <meshBasicMaterial color={ACCENT} transparent opacity={strong ? 0.26 : 0.18} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} depthWrite={false} />
    </mesh>
  );
}

// --------------------------------------------------------------------- trees

interface Tree {
  x: number;
  y: number;
  size: number;
  tint: number;
}

/** Mapped trees plus a seeded scatter inside woodland polygons, which OSM maps as areas rather than trees. */
function collectTrees(world: World): Tree[] {
  const { campus } = world;
  const trees: Tree[] = [];
  for (let i = 0; i < campus.trees.length; i += 2) {
    const k = `t${i}`;
    trees.push({ x: campus.trees[i], y: campus.trees[i + 1], size: 0.85 + hash01(k) * 0.5, tint: hash01(k, 3) });
  }
  let budget = 2600;
  campus.areas.forEach((area, ai) => {
    if (area.kind !== 'wood') return;
    for (const poly of area.polygons) {
      const ring = poly[0];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        x0 = Math.min(x0, ring[i]);
        y0 = Math.min(y0, ring[i + 1]);
        x1 = Math.max(x1, ring[i]);
        y1 = Math.max(y1, ring[i + 1]);
      }
      // Jittered grid: even coverage without visible rows.
      const step = 11;
      for (let gx = x0; gx < x1 && budget > 0; gx += step) {
        for (let gy = y0; gy < y1 && budget > 0; gy += step) {
          const k = `w${ai}:${Math.round(gx)}:${Math.round(gy)}`;
          const x = gx + hash01(k, 1) * step, y = gy + hash01(k, 2) * step;
          if (!pointInPolygon(x, y, poly) || world.heights.at(x, y) > 0) continue;
          trees.push({ x, y, size: 0.9 + hash01(k, 4) * 0.7, tint: hash01(k, 5) });
          budget--;
        }
      }
    }
  });
  return trees;
}

export function Trees({ world }: { world: World }) {
  const trees = useMemo(() => collectTrees(world), [world]);
  const crowns = useRef<THREE.InstancedMesh>(null!);
  const trunks = useRef<THREE.InstancedMesh>(null!);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const palette = TREE_COLOURS.map((hex) => new THREE.Color(hex));
    trees.forEach((t, i) => {
      const r = 2.6 * t.size;
      const trunk = 2.2 * t.size;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.tint * Math.PI * 2);
      m.compose(new THREE.Vector3(t.x, trunk + r * 0.75, -t.y), q, new THREE.Vector3(r, r * 1.15, r));
      crowns.current.setMatrixAt(i, m);
      crowns.current.setColorAt(i, c.copy(palette[Math.floor(t.tint * palette.length) % palette.length]).offsetHSL(0, 0, (hash01(`${i}`, 9) - 0.5) * 0.05));
      m.compose(new THREE.Vector3(t.x, (trunk + r * 0.3) / 2, -t.y), q, new THREE.Vector3(1, trunk + r * 0.3, 1));
      trunks.current.setMatrixAt(i, m);
    });
    for (const mesh of [crowns.current, trunks.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (crowns.current.instanceColor) crowns.current.instanceColor.needsUpdate = true;
  }, [trees]);

  return (
    <group>
      <instancedMesh ref={crowns} args={[undefined, undefined, trees.length]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshLambertMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 1, 5, 1, true]} />
        <meshLambertMaterial color={TRUNK_COLOUR} />
      </instancedMesh>
    </group>
  );
}

// --------------------------------------------------------------------- stats

/** Publishes renderer statistics for the performance readout and automated checks. */
export function RenderStats() {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames++;
    a.time += dt;
    if (a.time >= 0.5) {
      const info = gl.info.render;
      stats.fps = a.frames / a.time;
      stats.drawCalls = info.calls;
      stats.triangles = info.triangles;
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}
