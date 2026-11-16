// What kind of device this is, decided once at start-up.

const mq = (q: string) => typeof window !== 'undefined' && window.matchMedia?.(q).matches === true;

/** A finger rather than a mouse is the main way in: phones and tablets. */
export const touch = mq('(pointer: coarse)') || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !mq('(pointer: fine)'));

/**
 * A phone-class GPU: small screen or touch-first. Used to pick lighter
 * rendering settings (pixel ratio, shadows, antialiasing).
 */
export const lowPower = touch || mq('(max-width: 720px)');
