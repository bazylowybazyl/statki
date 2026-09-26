import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

// Vite w trybie dev podaje katalog public/ PRZED plikami z roota, a `vite build`
// pakuje to, co <link>/<script> z index.html wskazuje w roocie. Plik w public/ pod
// tą samą ścieżką = dev i build wyglądają różnie: do 2026-09-26 dev podawał
// sierpniową kopię public/assets/css/main.css (bez stylów tabletu stacji).
test('public/ nie przesłania arkuszy i skryptów, które index.html ładuje z roota', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/<(?:link|script)\b[^>]*?\s(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) && !url.includes('${'))
    .map((url) => url.replace(/^\.?\//, '').split(/[?#]/)[0]);

  assert.ok(refs.includes('assets/css/main.css'), 'index.html powinien ładować assets/css/main.css');
  const shadowed = refs.filter((rel) => existsSync(join(root, 'public', rel)));
  assert.deepEqual(shadowed, [], `public/ przesłania w trybie dev: ${shadowed.join(', ')}`);
});
