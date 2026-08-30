/** True when this window is the installed PWA, not a browser tab. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as { standalone?: boolean }).standalone)
  );
}
