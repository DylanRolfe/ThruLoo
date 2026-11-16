// Stuck inside a wall: offer a way out. Nothing happens by itself.

import { getUnstuck } from '../state/stuck';
import { useApp } from '../state/store';

export function StuckPrompt() {
  const stuck = useApp((s) => s.stuck);
  const mode = useApp((s) => s.mode);
  if (!stuck || mode === 'fly') return null;
  return (
    <button type="button" className="prompt prompt-stuck" onClick={getUnstuck}>
      Stuck in a wall? Tap to get out
    </button>
  );
}
