// Każde demo .html w dema/ (i podkatalogach) ma wpis w spisie dema/index.html,
// a każdy wpis spisu wskazuje istniejący plik.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../dema/', import.meta.url);
const dir = root.pathname.replace(/^\/([A-Za-z]:)/, '$1');

function htmlFiles(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith('.html')) out.push(relative(dir, p).split('\\').join('/'));
  }
  return out;
}

test('spis dem obejmuje wszystkie pliki .html z dema/', () => {
  const index = readFileSync(join(dir, 'index.html'), 'utf8');
  const listed = new Set([...index.matchAll(/\['([^']+\.html)',\s*'/g)].map((m) => m[1]));
  const files = htmlFiles(decodeURIComponent(dir)).filter((f) => f !== 'index.html');
  const missing = files.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `brak w dema/index.html: ${missing.join(', ')}`);
  const stale = [...listed].filter((f) => !files.includes(f));
  assert.deepEqual(stale, [], `wpisy bez pliku: ${stale.join(', ')}`);
});
