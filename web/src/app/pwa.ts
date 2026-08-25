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

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // Check hourly so a long-lived installed session still picks up releases.
      if (registration) {
        setInterval(() => void registration.update(), 60 * 60 * 1000);
      }
    },
  });
}
