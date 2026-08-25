/**
 * The brand motif: many separate paths resolving into one point.
 * Decorative — the meaning is carried by the copy, not this graphic.
 */
export function Walkways({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 720"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="wk-blue" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--at-blue)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--at-blue)" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="wk-violet" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--at-violet)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--at-violet)" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="wk-glow" cx="50%" cy="50%" r="50%">
          <stop
            offset="0"
            stopColor="var(--at-magenta-light)"
            stopOpacity="0.28"
          />
          <stop
            offset="1"
            stopColor="var(--at-magenta-light)"
            stopOpacity="0"
          />
        </radialGradient>
      </defs>

      <ellipse cx="1010" cy="360" rx="300" ry="220" fill="url(#wk-glow)" />

      <path
        d="M -40 40 C 320 120 700 250 1010 360"
        stroke="url(#wk-blue)"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M -40 250 C 300 290 720 330 1010 360"
        stroke="url(#wk-violet)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M -40 460 C 300 450 720 400 1010 360"
        stroke="url(#wk-violet)"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M -40 680 C 320 610 700 470 1010 360"
        stroke="url(#wk-blue)"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}
