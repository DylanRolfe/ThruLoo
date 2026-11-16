// Beta feedback: a small pill, a sheet with the feedback form and the builder's
// Instagram and LinkedIn, and a short toast once a route ends. Every link opens
// in a new tab. Nothing opens on launch.

import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { CloseIcon, InstagramIcon, LinkedInIcon } from './icons';

export const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeuzNjUaOtcJrmeStYpphUULSmB454HccxIQb1O67qEEU1DDw/viewform';
const INSTAGRAM_URL = 'https://www.instagram.com/_dylanr8/';
const LINKEDIN_URL = 'https://www.linkedin.com/in/dylanrolfe/';
/** ThruLoo is GPL-3.0; this is where its source code is published. */
export const SOURCE_URL = 'https://github.com/DylanRolfe/Waterloo-Walk';
const WATISGRASS_URL = 'https://github.com/rickyqin005/WATIsGrass';
const OSM_URL = 'https://www.openstreetmap.org/copyright';

/** The Beta tag. It opens the feedback sheet. */
export function BetaPill({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      className={`beta-pill ${className}`.trim()}
      data-tour="beta"
      aria-haspopup="dialog"
      aria-label="Beta. Send feedback"
      title="Beta: send feedback"
      onClick={() => useApp.getState().set({ feedbackOpen: true })}
    >
      Beta
    </button>
  );
}

/** A small card over the scene. Tapping outside it, or Escape, closes it. */
export function FeedbackSheet() {
  const open = useApp((s) => s.feedbackOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useApp.getState().set({ feedbackOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const close = () => useApp.getState().set({ feedbackOpen: false });
  return (
    <div className="feedback-layer">
      <button type="button" className="feedback-scrim" aria-label="Close feedback" tabIndex={-1} onClick={close} />
      <section className="picked feedback" role="dialog" aria-labelledby="feedback-title">
        <div className="sheet-top">
          <p className="feedback-title" id="feedback-title">
            <b>ThruLoo Beta</b>
            <span>Found a bug or have an idea? Let me know.</span>
          </p>
          <button type="button" className="x-btn" onClick={close} aria-label="Close feedback">
            <CloseIcon />
          </button>
        </div>
        <div className="picked-actions feedback-actions">
          <a className="btn btn-gold" href={FEEDBACK_URL} target="_blank" rel="noopener" onClick={close}>
            Send feedback
          </a>
          <div className="feedback-social">
            <a className="btn" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
              <InstagramIcon />
              Instagram
            </a>
            <a className="btn" href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
              <LinkedInIcon />
              LinkedIn
            </a>
          </div>
        </div>
        <p className="feedback-credits">
          Indoor and tunnel routing data from{' '}
          <a href={WATISGRASS_URL} target="_blank" rel="noopener noreferrer">
            WATIsGrass
          </a>{' '}
          by Ricky Qin and Manasva Katyal (github.com/rickyqin005/WATIsGrass), licensed under the{' '}
          <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer">
            GNU GPL v3.0
          </a>
          . Map data ©{' '}
          <a href={OSM_URL} target="_blank" rel="noopener noreferrer">
            OpenStreetMap contributors
          </a>{' '}
          (ODbL). ThruLoo is free software under the GPL-3.0:{' '}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            source code
          </a>
          .
        </p>
      </section>
    </div>
  );
}

/**
 * Shown for about five seconds once a route reaches its end (walking or flythrough).
 * It sits in the corner the status chips use, so it never covers the map controls.
 */
export function ArrivalToast() {
  const arrived = useApp((s) => s.navArrived || s.flyDone);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!arrived) {
      setShown(false);
      return;
    }
    setShown(true);
    const id = window.setTimeout(() => setShown(false), 5000);
    return () => window.clearTimeout(id);
  }, [arrived]);
  if (!arrived || !shown) return null;
  return (
    <p className="chip chip-gps chip-feedback" role="status">
      <span>
        Got you there?{' '}
        <a className="feedback-link" href={FEEDBACK_URL} target="_blank" rel="noopener">
          Report an issue
        </a>
      </span>
      <button type="button" className="x-btn" onClick={() => setShown(false)} aria-label="Dismiss">
        <CloseIcon />
      </button>
    </p>
  );
}
