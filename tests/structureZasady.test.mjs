// Zasady obszaru zawaleń (reguła .claude/rules/zawalenia-budowli.md, „Zasady obszaru”; plan zawaleń § 3.7) — strażnik
// statyczny dla src/game/structure*.js, beamRigid3D.js i beamPlateField3D.js:
// - gra nie losuje (zasada żelazna 9): bez Math.random i fxRandom — rozrzut z PRNG ziarna archetypu (structureRng);
// - moduły czyste: bez three, `window` i `document` — także przechodnio (dane układu z src/3d bez three);
// - importy tylko z listy (nowy import = moduł bez three / DOM, dopisany tutaj i w regule);
// - zegar ściany tylko w definicji `const nowMs` (odczyty w gałęzi `timing` pilnuje dynamicznie
//   tests/structureZegar.test.mjs — szpieg zegara);
// - Math.hypot tylko w budowie archetypu (`export function build…` do następnej funkcji eksportowanej; zasada 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAME = join(ROOT, 'src', 'game');
const FILES = [
  ...readdirSync(GAME).filter((f) => /^structure.*\.js$/.test(f)),
  'beamRigid3D.js',
  'beamPlateField3D.js'
].map((f) => join(GAME, f));

const ALLOWED_IMPORTS = new Set([
  './stepDecay.js',
  '../3d/portBuildings/pirateBaseLayout.js',
  '../3d/haloRing/haloPortK7Layout.js',
  './beamRigid3D.js'
]);
const isAreaImport = (spec) => /^\.\/structure[A-Za-z0-9]*\.js$/.test(spec);

// Kod bez komentarzy (prosty skaner: komentarze blokowe i liniowe poza napisami i szablonami). Liczba linii bez zmian —
// numery w komunikatach zgadzają się z plikiem.
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i, end < 0 ? src.length : end + 2);
      out += body.replace(/[^\n]/g, ' ');
      i += body.length;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const read = (p) => stripComments(readFileSync(p, 'utf8'));
const importsOf = (code) => [...code.matchAll(/\b(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g)]
  .map((m) => m[1] || m[2] || m[3]);
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const linesWith = (code, re) => code.split('\n').map((l, k) => ({ l, k: k + 1 })).filter(({ l }) => re.test(l));

test('pliki obszaru: structureGraph.js i moduły klastrów są pod strażnikiem', () => {
  const names = FILES.map(rel);
  for (const f of ['src/game/structureGraph.js', 'src/game/beamRigid3D.js', 'src/game/beamPlateField3D.js']) {
    assert.ok(names.includes(f), `brak ${f} na liście`);
    assert.ok(existsSync(join(ROOT, f)), `brak pliku ${f}`);
  }
});

test('gra nie losuje: bez Math.random i fxRandom (rozrzut z PRNG ziarna archetypu)', () => {
  for (const p of FILES) {
    const code = read(p);
    const bad = linesWith(code, /Math\s*\.\s*random|\bfxRandom/);
    assert.equal(bad.length, 0, `${rel(p)}: ${bad.map(({ k, l }) => `${k}: ${l.trim()}`).join(' | ')}`);
  }
});

test('moduły czyste: bez three, `window` i `document`', () => {
  for (const p of FILES) {
    const code = read(p);
    for (const spec of importsOf(code)) assert.ok(!/^three(\/|$)/.test(spec), `${rel(p)}: import „${spec}”`);
    const bad = linesWith(code, /\bwindow\b|\bdocument\b|\bglobalThis\s*\.\s*(window|document)\b/);
    assert.equal(bad.length, 0, `${rel(p)}: ${bad.map(({ k, l }) => `${k}: ${l.trim()}`).join(' | ')}`);
  }
});

test('importy tylko z listy; domknięcie importów bez three, DOM i Math.random', () => {
  for (const p of FILES) {
    for (const spec of importsOf(read(p))) {
      assert.ok(ALLOWED_IMPORTS.has(spec) || isAreaImport(spec),
        `${rel(p)}: import „${spec}” spoza listy — nowy import tylko moduł bez three / DOM (dopisz tutaj i w regule zawalenia-budowli)`);
    }
  }
  // przechodnio: dane układu z src/3d (pirateBaseLayout → …, haloPortK7Layout → haloRingConfig → ringScale)
  const seen = new Set(), stack = [...FILES];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    const code = read(p);
    for (const spec of importsOf(code)) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${rel(p)}: import „${spec}” spoza repozytorium (three, node:…)`);
      const next = resolve(dirname(p), spec);
      assert.ok(existsSync(next), `${rel(p)}: brak „${spec}”`);
      stack.push(next);
    }
    assert.ok(!/Math\s*\.\s*random/.test(code), `${rel(p)}: Math.random w domknięciu importów obszaru`);
    assert.ok(!/\bdocument\s*\.|\bwindow\s*[.[]|typeof\s+window\b/.test(code), `${rel(p)}: DOM / window w domknięciu importów obszaru`);
  }
  assert.ok(seen.size >= FILES.length + 4, `domknięcie: ${[...seen].map(rel).join(', ')}`);
});

test('zegar ściany: performance i Date.now tylko w definicji `const nowMs`', () => {
  let defs = 0;
  for (const p of FILES) {
    const code = read(p);
    const bad = linesWith(code, /\bperformance\b|\bDate\s*\.\s*now\b/).filter(({ l }) => !/^\s*const nowMs = /.test(l));
    assert.equal(bad.length, 0, `${rel(p)}: zegar poza nowMs — ${bad.map(({ k, l }) => `${k}: ${l.trim()}`).join(' | ')}`);
    defs += linesWith(code, /^\s*const nowMs = .*\bperformance\b/).length;
  }
  assert.ok(defs >= 2, `definicje nowMs widoczne po zdjęciu komentarzy: ${defs} (beamRigid3D, beamPlateField3D)`);
  // structureGraph.js nie czyta zegara wcale
  const sg = read(join(GAME, 'structureGraph.js'));
  assert.ok(!/\bnowMs\b|\bperformance\b|\bDate\s*\.\s*now\b/.test(sg), 'structureGraph.js czyta zegar');
});

test('Math.hypot tylko w budowie archetypu (build…Archetype); w kroku Math.sqrt', () => {
  let inArchetype = 0;
  for (const p of FILES) {
    const code = read(p);
    const lines = code.split('\n');
    let inBuild = false;
    const bad = [];
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      if (/^export\s+function\s/.test(l)) inBuild = /^export\s+function\s+build\w*Archetype\b/.test(l);
      if (/Math\s*\.\s*hypot/.test(l)) { if (inBuild) inArchetype++; else bad.push(`${k + 1}: ${l.trim()}`); }
    }
    assert.equal(bad.length, 0, `${rel(p)}: ${bad.join(' | ')}`);
  }
  // skaner widzi kod budowy (buildHighriseArchetype liczy obwód rzutu Math.hypot) — inaczej test nic nie sprawdza
  assert.ok(inArchetype > 0, 'Math.hypot w build…Archetype niewidoczny po zdjęciu komentarzy');
});
