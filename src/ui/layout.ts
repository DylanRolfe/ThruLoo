// Phone layout or desktop layout. Phones and small tablets get the compact one:
// a search bar on top, the route in a bottom sheet, round buttons and a joystick.

import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 720px), (pointer: coarse) and (max-width: 1100px)';

const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null;

const subscribe = (cb: () => void) => {
  mql?.addEventListener('change', cb);
  return () => mql?.removeEventListener('change', cb);
};

export const isCompact = () => mql?.matches ?? false;

export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, () => mql?.matches ?? false, () => false);
}
