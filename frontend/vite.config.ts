import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    /**
     * PWA — generates manifest.webmanifest, registers a service worker,
     * and pre-caches the build output. We also add a runtime cache for
     * the Render API (NetworkFirst) so the app opens fast on flaky
     * networks while staying live whenever possible.
     */
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "icon-subtracker.svg",
        "icon-expense-tracker.svg",
      ],
      manifest: {
        name: "SubTracker",
        short_name: "SubTracker",
        description: "Personal finance dashboard — subscriptions, EMIs, cards, accounts.",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/subtracker-api-[a-z0-9-]+\.onrender\.com\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "subtracker-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
