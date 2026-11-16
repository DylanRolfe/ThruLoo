// Keyboard: held keys for movement, plus the app's shortcuts.

import { keys, player } from './runtime';
import { useApp } from './store';

const MOVEMENT = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export function installInput(): () => void {
  const onDown = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const app = useApp.getState();
    keys.add(e.code);

    // Keep the page from scrolling or the focused button from firing while walking.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;

    if (e.code === 'KeyM') {
      if (app.nav && app.mode === 'walk') app.set({ navView: app.navView === 'map' ? 'street' : 'map' });
      else app.setMode(app.mode === 'map' ? 'walk' : 'map');
    } else if (e.code === 'KeyT') {
      app.set({ showIndoor: !app.showIndoor });
    } else if (e.code === 'KeyE' || e.code === 'KeyQ') {
      if (app.mode === 'walk' && !app.nav) player.stairs = e.code === 'KeyE' ? 1 : -1;
    } else if (e.code === 'Escape') {
      if (app.mode === 'fly') app.exitFly();
      else if (app.selected) app.select(null);
    } else if (e.code === 'Slash') {
      e.preventDefault();
      document.getElementById('place-to')?.click();
    } else if (app.mode === 'fly') {
      if (e.code === 'Space') app.toggleFly();
      else if (MOVEMENT.has(e.code)) {
        // Any movement key hands control straight back to the player.
        app.exitFly();
        useApp.getState().setMode('walk');
      }
    }
  };
  const onUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
  };
}
