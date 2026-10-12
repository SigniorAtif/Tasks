// Installs the service worker that vite-plugin-pwa generates at build time
// (sw.js). It caches the app shell so the app opens without a network and can
// be installed to the home screen. Under `pnpm dev` this import is a no-op.

import { registerSW } from 'virtual:pwa-register';

export function registerServiceWorker(): void {
  // `immediate`: register now instead of waiting for the page's load event.
  // With registerType 'autoUpdate' (vite.config.ts), when a newer service
  // worker takes over after a deploy, the page reloads itself once.
  registerSW({ immediate: true });
}
