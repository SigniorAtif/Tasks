import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Where the dev server forwards API calls. The real API listens on 3000; point
// this somewhere else (a mock, another port) with API_PROXY_TARGET. `||`, not
// `??`, so an empty value counts as unset, like every other variable in .env.
const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000';

// The browser only ever talks to Vite's origin (http://localhost:5173). Vite
// forwards these paths to the API, so the session cookie is first-party and
// there's no CORS, exactly like production where one server serves both.
// `changeOrigin: false` keeps the browser's Host header, so Better Auth's
// origin checks see localhost:5173, the same origin as BETTER_AUTH_URL.
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/healthz': { target: apiTarget, changeOrigin: false },
};

export default defineConfig({
  plugins: [
    // Reads src/routes/ and writes src/routeTree.gen.ts on every dev start,
    // file change and build. It must run before the React plugin.
    tanstackRouter({
      target: 'react',
      // Match the repo's import style: name the file with its extension.
      addExtensions: true,
      quoteStyle: 'single',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken instead of quietly moving to 5174: the
    // API's BETTER_AUTH_URL and the Google redirect URI both name 5173.
    strictPort: true,
    proxy,
  },
  // `vite preview` serves the production build; it needs the same forwarding.
  preview: { proxy },
});
