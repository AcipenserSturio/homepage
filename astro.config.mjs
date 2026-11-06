import { defineConfig } from 'astro/config';

// Everything is inlined into dist/index.html, so the page is one file that can be
// opened from disk or handed to a new tab extension.
export default defineConfig({
  site: 'https://home.asi.fish',
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'always' },
  vite: { build: { assetsInlineLimit: 1024 * 1024 } },
});
