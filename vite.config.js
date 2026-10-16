import { defineConfig } from 'vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { isAbsolute, relative, join, resolve } from 'node:path';
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

// A/B WERSJI KODU w narzędziach pomiarowych (2026-10-15, sesja optymalizacji wydajności): HULLFALL_AB_DIR=<katalog> —
// pliki z katalogu (te same ścieżki względne repo, np. <katalog>/src/3d/worldBodies3D.js) serwowane ZAMIAST plików
// drzewa: moduły JS przez `load`, index.html przez transformIndexHtml (skrypty inline idą z podmienionego HTML).
// Wariant A (stary kod) i B (drzewo robocze) w tym samym drzewie, obok niezacommitowanej pracy innych sesji.
// Bez zmiennej — wtyczki nie ma. Wzór: scripts/webgpu/przestoje-gra.mjs --ab <katalog>.
function abOverride() {
  const dir = process.env.HULLFALL_AB_DIR;
  if (!dir || !existsSync(dir)) return null;
  const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();
  const files = new Map();
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p);
      else files.set(norm(resolve(repoRoot, relative(dir, p))), p);
    }
  };
  walk(resolve(dir));
  console.log(`[A/B] HULLFALL_AB_DIR: ${files.size} plików zastępczych z ${dir}`);
  return {
    name: 'hullfall-ab-override',
    enforce: 'pre',
    load(id) {
      if (!id || id.startsWith('\0')) return null;
      const clean = id.split('?')[0];
      if (clean.endsWith('.html')) return null;
      const f = files.get(norm(clean));
      return f ? readFileSync(f, 'utf8') : null;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const f = ctx && ctx.filename ? files.get(norm(ctx.filename)) : null;
        return f ? readFileSync(f, 'utf8') : html;
      }
    }
  };
}

export default defineConfig({
  base: './',
  // Prebundle zależności w drzewie (.tmp/vite-deps), nie w node_modules/.vite: worktree torów mają node_modules jako
  // junction do jednego katalogu, więc serwery Vite z kilku drzew naraz unieważniały sobie wspólny prebundle
  // („504 Outdated Optimize Dep”, „gra nie wstała” w harnessach).
  cacheDir: join(repoRoot, '.tmp', 'vite-deps'),
  plugins: [demaIndexRedirect, gameVersion, abOverride()].filter(Boolean),
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
