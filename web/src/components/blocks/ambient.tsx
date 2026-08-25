/**
 * Ambient atmosphere: three slow gradient orbs drawn from the brand tokens.
 * Decorative only — hidden from assistive tech, and static under reduced motion
 * (the drift keyframes are defined with a reduced-motion guard in globals.css).
 */
export function Ambient() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute -top-32 -left-24 size-[520px] rounded-full bg-blue/18 blur-[120px] motion-safe:animate-[drift_28s_ease-in-out_infinite]" />
      <div className="absolute -top-16 right-[-10%] size-[460px] rounded-full bg-violet/16 blur-[120px] motion-safe:animate-[drift_34s_ease-in-out_infinite_reverse]" />
      <div className="absolute top-[40%] left-[35%] size-[380px] rounded-full bg-magenta/12 blur-[130px] motion-safe:animate-[drift_40s_ease-in-out_infinite]" />
    </div>
  );
}
