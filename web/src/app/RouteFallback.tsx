/**
 * What fills the gap while a route's chunk arrives.
 *
 * Deliberately almost nothing: a spinner that appears for 80ms is a flash that
 * reads as jank, so this is a quiet, non-moving placeholder that holds the
 * layout rather than announcing itself.
 *
 * It does announce to assistive technology, because a screen reader user gets
 * no visual cue that anything is happening at all.
 */
export function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="grid min-h-dvh place-items-center bg-background"
    >
      <span className="sr-only">Loading</span>
    </div>
  );
}
