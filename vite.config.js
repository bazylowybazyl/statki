import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Wersja w menu (index.html: __HULLFALL_VERSION__) = "version" z package.json — tę samą dostaje exe
// i instalator; podbija ją scripts/wydanie.mjs.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const gameVersion = {
  name: 'hullfall-version',
  transformIndexHtml: (html) => html.replaceAll('__HULLFALL_VERSION__', pkg.version),
};

// /dema bez ukośnika dostawał od Vite grę (fallback na /index.html) —
// przekierowanie do spisu dem (dema/index.html).
const demaIndexRedirect = {
  name: 'dema-index-redirect',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/dema' || req.url.startsWith('/dema?')) {
        res.statusCode = 301;
        res.setHeader('Location', '/dema/' + req.url.slice(5));
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [demaIndexRedirect, gameVersion],
  define: {
    __HEX_SIM_BUILD__: JSON.stringify('hex-sim-v2'),
  },
  // Port WebGPU (docs/webgpu/SPIKE.md p. 1): three, three/webgpu i three/tsl
  // prebundlowane razem — jeden rdzeń klas, a pierwsze wykrycie three/webgpu
  // w dev nie przeładowuje strony.
  optimizeDeps: {
    include: ['three', 'three/webgpu', 'three/tsl'],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
