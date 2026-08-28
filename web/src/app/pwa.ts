import { registerSW } from "virtual:pwa-register";

/**
 * Registers the service worker for the product app only.
 *
 * The marketing page deliberately never calls this — a first-time visitor
 * reading a headline should not be charged for an app install. `injectRegister`
 * is null in vite.config.ts precisely so registration is explicit and lives here.
 */
export function registerAppServiceWorker() {
  if (import.meta.env.DEV) return;

  const start = () =>
    registerSW({
      immediate: false,
      onRegisteredSW(_url, registration) {
        // Check hourly so a long-lived installed session still picks up releases.
        if (registration) {
          setInterval(() => void registration.update(), 60 * 60 * 1000);
        }
      },
    });

  // Precaching the app bundle on the first /app visit used to start in the
  // same tick as Home's data fetches. On a phone that saturates the radio
  // and is the "signed in, still a blank page" second half of the report.
  // Idle, with a bound, so first paint and the first APIs go first.
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 4_000 });
  } else {
    window.setTimeout(start, 2_500);
  }
}
