import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Nothing auto-registers: the marketing page must never install a
      // service worker. The product app at /app calls registerSW() itself.
      injectRegister: null,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "favicon-32x32.png", "favicon-16x16.png"],
      manifest: {
        name: "AllTheWay — your collaborative companion",
        short_name: "AllTheWay",
        description:
          "One companion that talks with you, watches and acts for you, and remembers how you think.",
        start_url: "/app",
        scope: "/app/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#f8f3e8",
        theme_color: "#f8f3e8",
        categories: ["productivity", "business"],
        icons: [
          {
            src: "/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff,woff2}"],
        // Install-time icons are fetched by the OS, not the page — precaching
        // them costs ~350 KB of offline budget for no benefit. Marketing photos
        // are below the fold and lazy-loaded, so they stay out too.
        globIgnores: ["**/android-chrome-*.png", "**/icon-maskable-*.png", "**/images/**"],
        // The PWA belongs to the product at /app, not the marketing page:
        // a first-time visitor should not pay for an app install to read a headline.
        navigateFallback: "/app/index.html",
        navigateFallbackAllowlist: [/^\/app/],
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  // `preview` does not inherit `server.proxy`, and the verification harnesses
  // run against the built app. Without this the built app has no gateway.
  preview: {
    proxy: {
      "/api": {
        target: process.env.GATEWAY_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  server: {
    proxy: {
      // Mirrors the Firebase Hosting rewrite, so the client is same-origin in
      // development. In production that holds for everything except the turn
      // stream, which cannot go through a Hosting rewrite (60s timeout) and so
      // is pointed at the gateway's own origin via VITE_STREAM_ORIGIN.
      "/api": {
        target: process.env.GATEWAY_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
