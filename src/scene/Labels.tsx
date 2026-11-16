// Building labels as an HTML overlay: crisp at any distance and cheap for a
// hundred or so buildings. Each frame the labels are projected, the ones hidden
// behind buildings are dropped, and the rest are placed greedily in priority
// order so they never overlap.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Building } from '../data/types';
import { useApp } from '../state/store';
import type { World } from '../state/world';

interface Item {
  b: Building;
  el: HTMLDivElement;
  anchor: THREE.Vector3;
  /** Larger shows first. */
  weight: number;
  shown: boolean;
  detail: boolean;
  strong: boolean;
  x: number;
  y: number;
}

const v = new THREE.Vector3();

export function Labels({ world, container }: { world: World; container: HTMLElement }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const frame = useRef(0);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const b of world.campus.buildings) {
      if (!b.campus || b.kind === 'roof' || !(b.code || (b.name && b.area >= 250))) continue;
      const el = document.createElement('div');
      el.className = b.code ? 'label' : 'label label-minor';
      if (b.code) {
        const code = document.createElement('b');
        code.textContent = b.code;
        el.appendChild(code);
      }
      if (b.name) {
        const name = document.createElement('span');
        name.textContent = b.name;
        el.appendChild(name);
      }
      out.push({
        b, el,
        anchor: new THREE.Vector3(b.centre[0], b.top + 2, -b.centre[1]),
        weight: (b.code ? 4000 : 0) + Math.min(b.area, 9000),
        shown: false, detail: false, strong: false, x: -1, y: -1,
      });
    }
    return out;
  }, [world]);

  useEffect(() => {
    for (const it of items) container.appendChild(it.el);
    return () => {
      for (const it of items) it.el.remove();
    };
  }, [items, container]);

  useFrame(() => {
    const app = useApp.getState();
    const mode = app.mode;
    // Every other frame is plenty for text while walking; on the map every frame, or names trail behind a drag.
    if (mode !== 'map' && frame.current++ % 2) return;
    // The camera moved earlier this frame; its view matrix is only refreshed at render, which is after this.
    camera.updateMatrixWorld();
    const camH = camera.position.y;
    const strongIds = new Set([app.to?.building, app.from.building, app.selected?.building]);

    // How far labels reach, and when names join codes, depends on the view.
    const reach = mode === 'walk' ? 380 : mode === 'fly' ? 520 : Infinity;
    const minorReach = mode === 'map' ? (camH < 700 ? Infinity : 0) : 150;
    const detailWithin = mode === 'map' ? (camH < 520 ? Infinity : 0) : 110;

    const candidates: { it: Item; sx: number; sy: number; score: number; detail: boolean; strong: boolean }[] = [];
    for (const it of items) {
      const strong = strongIds.has(it.b.id);
      v.copy(it.anchor);
      const dist = v.distanceTo(camera.position);
      const isMinor = !it.b.code;
      if (!strong && dist > (isMinor ? minorReach : reach)) continue;
      v.project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;

      // Hidden behind something taller? Walk the sight line over the height grid.
      if (mode !== 'map' && !strong) {
        let blocked = false;
        for (let k = 1; k <= 7 && !blocked; k++) {
          const f = k / 8.5;
          const x = camera.position.x + (it.anchor.x - camera.position.x) * f;
          const z = camera.position.z + (it.anchor.z - camera.position.z) * f;
          const rayY = camera.position.y + (it.anchor.y - camera.position.y) * f;
          const h = world.heights.at(x, -z);
          if (h > rayY + 0.5 && h !== it.b.top) blocked = true;
        }
        if (blocked) continue;
      }
      candidates.push({
        it,
        sx: (v.x * 0.5 + 0.5) * size.width,
        sy: (-v.y * 0.5 + 0.5) * size.height,
        score: (strong ? 1e9 : 0) + it.weight / (mode === 'map' ? 1 : Math.max(40, dist)),
        detail: strong || dist < detailWithin,
        strong,
      });
    }
    candidates.sort((a, b) => b.score - a.score);

    const placed: number[] = []; // x0, y0, x1, y1
    const visible = new Set<Item>();
    for (const c of candidates) {
      const text = c.it.b.code ?? c.it.b.name!;
      const nameLen = c.detail || !c.it.b.code ? Math.min(c.it.b.name?.length ?? 0, 30) : 0;
      const w = Math.max(text.length * (c.it.b.code ? 10 : 6) + (c.strong ? 18 : 6), nameLen * 5.6) + 8;
      const h = (c.it.b.code ? 20 : 14) + (nameLen && c.it.b.code ? 14 : 0) + (c.strong ? 6 : 0);
      const x0 = c.sx - w / 2, y0 = c.sy - h, x1 = c.sx + w / 2, y1 = c.sy;
      let clash = false;
      for (let i = 0; i < placed.length && !clash; i += 4) {
        clash = x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1];
      }
      if (clash && !c.strong) continue;
      placed.push(x0, y0, x1, y1);
      visible.add(c.it);
      const it = c.it;
      const x = Math.round(c.sx * 2) / 2, y = Math.round(c.sy * 2) / 2;
      if (x !== it.x || y !== it.y) {
        it.x = x;
        it.y = y;
        it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
      if (c.detail !== it.detail) {
        it.detail = c.detail;
        it.el.classList.toggle('label-detail', c.detail);
      }
      if (c.strong !== it.strong) {
        it.strong = c.strong;
        it.el.classList.toggle('label-strong', c.strong);
      }
    }
    for (const it of items) {
      const show = visible.has(it);
      if (show !== it.shown) {
        it.shown = show;
        it.el.classList.toggle('label-show', show);
      }
    }
  });

  return null;
}
