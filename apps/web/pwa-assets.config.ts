// Turns public/logo.svg into the PNG icons phones and browsers want. Run it
// after changing the logo: `pnpm --filter @tasks/web generate-pwa-assets`,
// then commit the PNGs it writes next to the SVG in public/.

import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// The logo's tile colour. Maskable and Apple icons are full squares (the phone
// cuts its own shape out of them), so they get this colour as background
// instead of white, and the tile's rounded corners disappear into it.
const tile = '#4338ca';

export default defineConfig({
  preset: {
    // pwa-64/192/512 and favicon.ico, transparent around the rounded tile.
    ...minimal2023Preset,
    // Android crops maskable icons to a circle or squircle and only promises
    // the middle 80% survives; 10% padding keeps the whole calendar inside it.
    maskable: { sizes: [512], padding: 0.1, resizeOptions: { background: tile } },
    // iPhone home-screen icon (iOS rounds the corners itself).
    apple: { sizes: [180], padding: 0.1, resizeOptions: { background: tile } },
  },
  images: ['public/logo.svg'],
});
