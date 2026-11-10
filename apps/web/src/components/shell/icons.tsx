import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...props,
});

/** The shell's line icons (one path set each, so no icon library ships in the first load). */
export const Icons = {
  home: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  map: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15M15 6v15" />
    </svg>
  ),
  people: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7" />
    </svg>
  ),
  shield: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    </svg>
  ),
  teams: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M8 5v14" />
    </svg>
  ),
  chevronLeft: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  chevronRight: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  sun: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  moon: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  ),
  monitor: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  logout: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
    </svg>
  ),
};
