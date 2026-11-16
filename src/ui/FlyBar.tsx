// Transport controls for the route flythrough.

import { useApp } from '../state/store';
import { CloseIcon, PauseIcon, PlayIcon, ReplayIcon, SkipIcon } from './icons';

const SPEEDS = [1, 2, 4];

export function FlyBar() {
  const mode = useApp((s) => s.mode);
  const playing = useApp((s) => s.flyPlaying);
  const done = useApp((s) => s.flyDone);
  const progress = useApp((s) => s.flyProgress);
  const speed = useApp((s) => s.flySpeed);
  const to = useApp((s) => s.to);
  if (mode !== 'fly') return null;
  const { toggleFly, seekFly, skipFly, exitFly, set } = useApp.getState();

  return (
    <div className="flybar" role="group" aria-label="Flythrough controls">
      <button type="button" data-tour="fly-play" className="fly-btn fly-btn-main" onClick={toggleFly} aria-label={done ? 'Replay' : playing ? 'Pause' : 'Play'} title={done ? 'Replay' : playing ? 'Pause (Space)' : 'Play (Space)'}>
        {done ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="fly-track">
        <p className="fly-status">{done ? `Arrived at ${to?.label ?? 'your destination'}` : `Flying to ${to?.label ?? 'your destination'}`}</p>
        <input
          className="fly-scrub"
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          aria-label="Position along the route"
          style={{ '--p': `${progress * 100}%` } as React.CSSProperties}
          onChange={(e) => seekFly(Number(e.target.value) / 1000)}
        />
      </div>
      <button
        type="button"
        data-tour="fly-speed"
        className="fly-btn fly-speed"
        onClick={() => set({ flySpeed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })}
        aria-label={`Playback speed ${speed} times. Change speed`}
        title="Change speed"
      >
        {speed}×
      </button>
      <button type="button" data-tour="fly-skip" className="fly-btn" onClick={skipFly} disabled={done} aria-label="Skip to the destination" title="Skip to the destination">
        <SkipIcon />
      </button>
      <span className="fly-sep" />
            <button type="button" data-tour="fly-walk" className="fly-text" onClick={() => exitFly(true)} title="Put me on the route at this point">
        Walk<span className="fly-long"> from here</span>
      </button>
      <button type="button" className="fly-btn" onClick={() => exitFly()} aria-label="Close flythrough" title="Close (Esc)">
        <CloseIcon />
      </button>
    </div>
  );
}
