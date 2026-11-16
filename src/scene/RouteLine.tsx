// The route, plus start and destination markers, and the indoor network
// (tunnels, bridges, hallways, stairs) as a see-through overlay.
//
// Outdoor stretches lie on the ground and are hidden by buildings in front of
// them. Indoor stretches run at their floor height and show through walls, so
// a route through a tunnel or across a third-floor bridge is always legible.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EdgeKind, Route } from '../routing/types';
import { useApp } from '../state/store';
import type { World } from '../state/world';
import { focus } from './focus';
import { ACCENT, ACCENT_DEEP, INDOOR_COLOURS } from './palette';
import { buildRibbons, FLOOR_HEIGHT, ribbonVertexShader } from './ribbon';

const routeFragmentShader = /* glsl */ `
  uniform vec3 colour;
  uniform vec3 edge;
  uniform float time;
  uniform float width;
  uniform float opacity;
  uniform float insideOpacity;
  varying float vAlong;
  varying float vSide;
  varying float vInside;
  void main() {
    // Chevrons that flow from start to destination.
    float u = (vAlong - time * width * 2.2) / (width * 2.6) + abs(vSide) * 0.42;
    float chevron = smoothstep(0.42, 0.5, fract(u)) * (1.0 - smoothstep(0.86, 0.94, fract(u)));
    float border = smoothstep(0.72, 0.84, abs(vSide));
    vec3 c = mix(colour, vec3(1.0), chevron * 0.55);
    c = mix(c, edge, border);
    gl_FragColor = vec4(c, mix(opacity, insideOpacity, step(0.5, vInside)));
    #include <colorspace_fragment>
  }
`;

function RouteRibbon({ route }: { route: Route }) {
  const geometry = useMemo(() => buildRibbons([{ points: route.points, elev: route.elev, inside: route.inside }]), [route]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const make = (opacity: number, insideOpacity: number, depthTest: boolean) =>
    new THREE.ShaderMaterial({
      vertexShader: ribbonVertexShader,
      fragmentShader: routeFragmentShader,
      uniforms: {
        colour: { value: new THREE.Color(ACCENT) },
        edge: { value: new THREE.Color(ACCENT_DEEP) },
        time: { value: 0 },
        width: { value: 2.4 },
        lift: { value: 0.06 },
        opacity: { value: opacity },
        insideOpacity: { value: insideOpacity },
      },
      transparent: true,
      depthTest,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  // Solid where visible. Behind a building an outdoor stretch is a faint hint;
  // an indoor stretch is drawn almost solid, because inside is where it is.
  const solid = useMemo(() => make(1, 1, true), []);
  const ghost = useMemo(() => make(0.22, 0.9, false), []);
  useEffect(() => () => (solid.dispose(), ghost.dispose()), [solid, ghost]);

  useFrame((_, dt) => {
    // Narrower than a footpath up close, about three pixels wide from the air.
    const width = Math.max(1.5, focus.height * 0.011);
    for (const m of [solid, ghost]) {
      m.uniforms.time.value += dt;
      m.uniforms.width.value = width;
    }
  });

  // With the character indoors the buildings are see-through anyway, and a
  // line drawn over everything would cover the character standing on it.
  const xray = useApp((s) => !s.playerIndoors || (s.nav && s.navView === 'map'));
  return (
    <>
      {xray && <mesh geometry={geometry} material={ghost} renderOrder={8} />}
      <mesh geometry={geometry} material={solid} renderOrder={9} />
    </>
  );
}

function Pin({ x, y, h = 0, kind }: { x: number; y: number; h?: number; kind: 'start' | 'end' }) {
  const group = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const g = group.current;
    // Small beside the walker, readable from the flythrough camera, constant on screen from the map.
    const s = Math.max(0.45, Math.min(focus.height * 0.06, 1.3), focus.height * 0.014);
    g.scale.setScalar(s);
    g.position.set(x, h + (kind === 'end' ? (focus.height < 40 ? 2.6 : 0.4) + (Math.sin(clock.elapsedTime * 2.4) * 0.25 + 0.25) * s : 0.1), -y);
  });
  if (kind === 'start') {
    return (
      <group ref={group}>
        <mesh rotation-x={-Math.PI / 2} renderOrder={12}>
          <ringGeometry args={[0.75, 1.25, 32]} />
          <meshBasicMaterial color="#16181d" depthTest={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} renderOrder={12}>
          <circleGeometry args={[0.75, 32]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} />
        </mesh>
      </group>
    );
  }
  return (
    <group ref={group}>
      <mesh position={[0, 2.6, 0]} renderOrder={13}>
        <sphereGeometry args={[1.05, 24, 16]} />
        <meshBasicMaterial color={ACCENT} depthTest={false} />
      </mesh>
      <mesh position={[0, 1.15, 0]} rotation-x={Math.PI} renderOrder={13}>
        <coneGeometry args={[0.8, 2.3, 24]} />
        <meshBasicMaterial color={ACCENT} depthTest={false} />
      </mesh>
      <mesh position={[0, 2.6, 0]} renderOrder={14}>
        <sphereGeometry args={[0.42, 16, 12]} />
        <meshBasicMaterial color="#16181d" depthTest={false} />
      </mesh>
    </group>
  );
}

export function RouteLine() {
  const route = useApp((s) => s.route);
  const selected = useApp((s) => s.selected);
  if (!route) {
    return selected?.kind === 'point' ? <Pin x={selected.x} y={selected.y} kind="start" /> : null;
  }
  const p = route.points, e = route.elev;
  return (
    <>
      <RouteRibbon route={route} />
      <Pin x={p[0]} y={p[1]} h={e[0] * FLOOR_HEIGHT} kind="start" />
      <Pin x={p[p.length - 2]} y={p[p.length - 1]} h={e[e.length - 1] * FLOOR_HEIGHT} kind="end" />
      {selected?.kind === 'point' && <Pin x={selected.x} y={selected.y} kind="start" />}
    </>
  );
}

// ------------------------------------------------------------ indoor network

const networkFragmentShader = /* glsl */ `
  uniform float opacity;
  varying float vSide;
  varying vec3 vTint;
  void main() {
    // A pale core keeps thin lines readable over dark roofs and pale ground alike.
    vec3 c = mix(vTint, vec3(1.0), (1.0 - smoothstep(0.0, 0.45, abs(vSide))) * 0.35);
    gl_FragColor = vec4(c, opacity);
    #include <colorspace_fragment>
  }
`;

const DRAWN: EdgeKind[] = ['corridor', 'stairs', 'elevator', 'door', 'skywalk', 'tunnel'];

/** Every tunnel, bridge, hallway and stairwell, drawn through the buildings at its real floor. */
export function IndoorNetwork({ world }: { world: World }) {
  const show = useApp((s) => (s.showIndoor || s.routeMode !== 'outdoor') && !s.playerIndoors);
  const hasRoute = useApp((s) => s.route !== null);

  const geometry = useMemo(() => {
    const colours = Object.fromEntries(DRAWN.map((k) => [k, new THREE.Color(INDOOR_COLOURS[k] ?? INDOOR_COLOURS.corridor)]));
    const lines = [];
    // Drawn in this order so tunnels and bridges sit on top of hallways.
    for (const kind of DRAWN) {
      for (const e of world.graph.edges) {
        if (e.env !== 'indoor' || e.kind !== kind) continue;
        const count = e.geometry.length / 2;
        lines.push({ points: e.geometry, elev: e.elev ?? new Array(count).fill(e.level), inside: new Array(count).fill(1), colour: colours[kind] });
      }
    }
    return buildRibbons(lines, true);
  }, [world]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ribbonVertexShader,
        fragmentShader: networkFragmentShader,
        uniforms: { width: { value: 1 }, lift: { value: 0 }, opacity: { value: 0.9 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material]);

  useFrame(() => {
    material.uniforms.width.value = Math.max(1, focus.height * 0.0065);
    // Step back a little when a route is drawn over the network.
    material.uniforms.opacity.value = hasRoute ? 0.55 : 0.9;
  });

  return show ? <mesh geometry={geometry} material={material} renderOrder={7} /> : null;
}
