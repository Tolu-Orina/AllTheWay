import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

// Self-hosted so there is no Google Fonts round-trip and the PWA works offline.
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/poppins/latin-800.css";

import "./globals.css";
import App from "./App";
import { AuthProvider } from "@/auth/AuthProvider";
import { I18nProvider } from "@/app/i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/*
          Above App, not inside it.

          Every auth screen calls `useT`, and they render outside `/app`. With
          the provider wrapped around the authenticated area only, `useI18n`
          found no context and threw by design — so `/login` rendered nothing at
          all. A person could not sign in.

          One wrap, at the top, is also the only arrangement where the catalogue
          survives navigation between the public and signed-in halves without
          being torn down and refetched.
        */}
        <I18nProvider>
          <App />
        </I18nProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
