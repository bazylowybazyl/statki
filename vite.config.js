import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Katalogi robocze wewnątrz repo (pierwszy człon ścieżki względem korzenia) — bez obserwatora plików.
const WATCH_IGNORED_TOP = new Set(['.tmp', 'tmp', 'output', 'statki', 'dist', 'dist-electron', 'node_modules']);
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
function watchIgnored(file) {
  const rel = relative(repoRoot, String(file || ''));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false;
  const parts = rel.split(/[\\/]/);
  if (WATCH_IGNORED_TOP.has(parts[0])) return true;
  return parts[0] === '.claude' && parts[1] === 'worktrees';
}

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
    // Bez `entries` Vite skanuje KAŻDY *.html w katalogu (dema, dist-electron, kopie repo w statki/ —
    // 241 plików): skan trwał > 60 s, a żądania gry czekały na jego koniec. Gra + dema wystarczą.
    entries: ['index.html', 'destruktor*.html', 'ruch-v2.html', 'dema/**/*.html'],
  },
  server: {
    // Robocze śmieci (zrzuty .tmp ~64 tys. plików, kopie repo, buildy) — bez obserwatora plików. Ścieżki WZGLĘDEM
    // korzenia repo: obserwator dostaje ścieżki bezwzględne, a repo samo leży w katalogu `statki` — dawny wzorzec
    // '**/statki/**' wyłączał KAŻDY plik gry (serwer podawał moduły sprzed edycji, np. brak nowego eksportu).
    watch: {
      ignored: (file) => watchIgnored(file),
    },
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
