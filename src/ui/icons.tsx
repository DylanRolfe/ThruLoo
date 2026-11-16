// Small inline icons. All inherit the current text colour.

const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true } as const;

export const PlayIcon = () => (
  <svg {...base}>
    <path d="M4 2.5v11l9-5.5z" />
  </svg>
);
export const InstagramIcon = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="3.5" />
    <circle cx="8" cy="8" r="2.8" />
    <circle cx="11.6" cy="4.4" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);
export const LinkedInIcon = () => (
  <svg {...base}>
    <path d="M2 5.6h2.6V14H2zM3.3 1.8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM6.4 5.6h2.5v1.2h.04c.35-.66 1.2-1.4 2.5-1.4 2.6 0 3.1 1.7 3.1 3.9V14h-2.6V9.8c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V14H6.4z" />
  </svg>
);
export const PauseIcon = () => (
  <svg {...base}>
    <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" />
  </svg>
);
export const ReplayIcon = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
    <path d="M2.5 2.5v3.2h3.2" />
  </svg>
);
export const SkipIcon = () => (
  <svg {...base}>
    <path d="M3 2.5v11l7.5-5.5zM11.5 2.5h2v11h-2z" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
);
export const SwapIcon = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 2.5v10M5 12.5l-2.5-2.5M5 12.5l2.5-2.5M11 13.5v-10M11 3.5L8.5 6M11 3.5L13.5 6" />
  </svg>
);
export const ChevronIcon = () => (
  <svg {...base} className="chevron" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10l4-4 4 4" />
  </svg>
);

const big = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

/** Live location: a crosshair, filled in the middle while following. */
export const LocateIcon = ({ on }: { on?: boolean }) => (
  <svg {...big}>
    <circle cx="12" cy="12" r="6.5" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    <circle cx="12" cy="12" r="2.6" fill={on ? 'currentColor' : 'none'} />
  </svg>
);
/** Map view: a folded map. */
export const MapIcon = () => (
  <svg {...big}>
    <path d="M3.5 6.5l5-2.5 7 3 5-2.5v13l-5 2.5-7-3-5 2.5z" />
    <path d="M8.5 4v13M15.5 7v13" />
  </svg>
);
/** Walk view: a figure walking. */
export const WalkIcon = () => (
  <svg {...big}>
    <circle cx="13" cy="4.5" r="1.8" fill="currentColor" stroke="none" />
    <path d="M10 21l2.5-6.5L15 17v4M12.5 14.5l.8-5.5-3.3 1.8-1.5 3.2M13.3 9l2.2 3 3 1" />
  </svg>
);
/** Tunnels: an arch over a path. */
export const TunnelIcon = () => (
  <svg {...big}>
    <path d="M3 20v-8a9 9 0 0 1 18 0v8" />
    <path d="M8 20v-7a4 4 0 0 1 8 0v7" />
  </svg>
);
/** Floor plan: a room layout. */
export const PlanIcon = () => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
    <path d="M2.5 2.5h11v11h-11zM2.5 7.5h5M7.5 2.5v3M7.5 9.5v4M10.5 7.5h3" />
  </svg>
);
/** Start navigating: a direction arrow. */
export const GoIcon = () => (
  <svg {...base}>
    <path d="M8 1.5l5.5 13-5.5-3-5.5 3z" />
  </svg>
);
/** The step being walked: straight on. */
export const AheadIcon = () => (
  <svg {...big} width={26} height={26} strokeWidth={2.4}>
    <path d="M12 20V5M5 12l7-7 7 7" />
  </svg>
);
/** Arrived. */
export const CheckIcon = () => (
  <svg {...big} width={26} height={26} strokeWidth={2.4}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);
/** Back, on the indoor map. */
export const BackIcon = () => (
  <svg {...big} strokeWidth={2.4}>
    <path d="M15 5.5L8.5 12l6.5 6.5" />
  </svg>
);
