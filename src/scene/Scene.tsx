import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Suspense } from 'react';
import * as THREE from 'three';
import { lowPower } from '../state/device';
import { useApp } from '../state/store';
import type { World } from '../state/world';
import { CameraRig } from './CameraRig';
import { Labels } from './Labels';
import { SKY } from './palette';
import { Player } from './Player';
import { Interiors } from './Interiors';
import { IndoorNetwork, RouteLine } from './RouteLine';
import { Buildings, Ground, Lighting, RenderStats, Trees } from './Static';

export function Scene({ world, labelLayer }: { world: World; labelLayer: HTMLElement }) {
  const shadows = useApp((s) => s.shadows);
  const [sx, sy] = world.campus.spawn;
  return (
    <Canvas
      shadows={shadows ? 'percentage' : false}
      // Phones have 3x screens and small GPUs: render at up to 1.5x there and
      // skip MSAA, which costs a lot of fill rate on tile-based mobile GPUs.
      dpr={lowPower ? [1, 1.5] : [1, 1.75]}
      camera={{ fov: 52, near: 0.4, far: 16000, position: [sx, 60, -sy + 80] }}
      gl={{ antialias: !lowPower, powerPreference: 'high-performance' }}
      performance={{ min: 0.6 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
      }}
    >
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 380, 2600]} />
      <Lighting />
      <Ground world={world} />
      <Buildings world={world} />
      <Trees world={world} />
      <Interiors world={world} />
      <IndoorNetwork world={world} />
      <RouteLine />
      <Suspense fallback={null}>
        {/* Physics is only used for wall collision and camera ray casts; nothing is simulated. */}
        <Physics gravity={[0, 0, 0]} timeStep="vary">
          <Player world={world} />
          <CameraRig />
        </Physics>
      </Suspense>
      <Labels world={world} container={labelLayer} />
      <RenderStats />
    </Canvas>
  );
}
