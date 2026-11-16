// On-screen joystick for touch screens. Push to walk (a small push walks
// slowly), push to the rim to run. Writes to `stick`, which the character
// controller reads every frame, so nothing here re-renders while moving.

import { useEffect, useRef } from 'react';
import { stick } from '../state/runtime';

/** Radius the knob can travel, px. */
const TRAVEL = 44;
/** Past this share of the travel the character runs. */
const RUN_AT = 0.92;

export function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);

  useEffect(() => {
    // Held here: by cleanup time React has already cleared the refs.
    const el = base.current!;
    const knobEl = knob.current!;
    let cx = 0, cy = 0;

    const set = (x: number, y: number) => {
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > TRAVEL) {
        dx *= TRAVEL / d;
        dy *= TRAVEL / d;
      }
      const k = Math.min(1, d / TRAVEL);
      // A small dead zone so a resting thumb does not drift.
      const live = k < 0.12 ? 0 : (k - 0.12) / 0.88;
      const dir = d > 0 ? 1 / d : 0;
      stick.x = x === cx && y === cy ? 0 : (x - cx) * dir * live;
      stick.y = x === cx && y === cy ? 0 : -(y - cy) * dir * live;
      stick.run = k >= RUN_AT;
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      el.classList.toggle('stick-run', stick.run);
    };
    const reset = () => {
      active.current = null;
      stick.x = stick.y = 0;
      stick.run = false;
      knobEl.style.transform = '';
      el.classList.remove('stick-on', 'stick-run');
    };

    const onDown = (e: PointerEvent) => {
      if (active.current !== null) return;
      e.preventDefault();
      active.current = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer can already be gone */
      }
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      el.classList.add('stick-on');
      set(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === active.current) set(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === active.current) reset();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return (
    <div className="stick" ref={base} role="presentation" aria-hidden="true" data-tour="move">
      <div className="stick-knob" ref={knob} />
    </div>
  );
}
