// Strażnik usunięcia silnika heksów (2026-10-19): kadłuby, wraki, budowle, mostki i rdzenie są na silniku belek
// (src/game/hullBodies.js, docs/PORT-silnik-belek.md). Dawny silnik heksów (destructor.js i spółka, dema
// mostki-demo / rdzen-demo) i rusztowanie workera fizyki v2 (src/physics/, ?workerPhysicsV2, benchmark:100k)
// usunięto z repo; ten test pilnuje, żeby nie wróciły do grafu gry ani do jej kodu.
//
// „Gra” = pliki osiągalne z index.html w grafie importów (scripts/webgpu/grafGry.mjs — statyczne, dynamiczne,
// workery, skrypty modułowe strony). Kod bez komentarzy i napisów (lekser grafGry). Wyjątki: WYJATKI niżej —
// każdy z powodem i dokładną liczbą trafień; wpis, który przestał być potrzebny, też jest błędem.
// node --test tests/graBezHeksow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grafImportow, lex, loadSource } from '../scripts/webgpu/grafGry.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const graf = grafImportow('index.html', repo);

// Pliki i katalogi dawnego silnika heksów, jego dem i rusztowania workera fizyki v2.
const USUNIETE = [
  'src/game/destructor.js', 'src/game/destructor3D.js', 'src/game/destructorConfig.js',
  'src/game/destructorGpuSoftBody.js', 'src/game/destructorGpuSoftBody3D.js', 'src/game/hexArenaBridge.js',
  'src/game/hexContactGrid.js', 'src/game/hexGridSpace.js', 'src/game/hexBodyHooks.js', 'src/game/shipCore.js',
  'src/3d/coreFx3D.js', 'src/3d/coreFx3D.tsl.js', 'src/physics', 'src/benchmark',
  'dema/mostki-demo.html', 'dema/rdzen-demo.html', 'dema/asteroidy.html', 'scripts/benchmark100k.mjs'
];
const USUNIETY_PLIK = /(^|\/)(destructor|destructor3D|destructorConfig|destructorGpuSoftBody|destructorGpuSoftBody3D|hexArenaBridge|hexContactGrid|hexGridSpace|hexBodyHooks|shipCore|coreFx3D|coreFx3D\.tsl)\.js$/;

// Pola i API kadłubów heksowych, latających heksów i workera fizyki v2.
const SLOWA = [
  'hexGrid', 'isAsteroidHex', 'DESTRUCTOR_CONFIG', 'DestructorSystem', 'initHexBody', 'disposeHexBody',
  'captureHexBodySnapshot', 'flyingHexDebris', 'spawnFlyingHexDebris', 'hexTemplate', '_packedBody',
  'getHexProbeDrift', 'HexBodyHooks', 'destroyShard', 'workerPhysicsV2', 'PhysicsBridge', 'physicsKernel',
  // heks trafiony przez sweep / raymarch, niesiony do krateru (applyHexImpact bez argumentu `shard` od 2026-10-19)
  'hitShard', 'beamHitShard', 'hitHexShard'
];

const WYJATKI = [];

function kodGry() {
  const out = new Map();
  for (const plik of graf.keys()) out.set(plik, lex(loadSource(join(repo, plik)).js).codeOnly);
  return out;
}

test('silnik heksów i rusztowanie workera fizyki v2 usunięte z repo i z grafu gry', () => {
  for (const p of USUNIETE) assert.equal(existsSync(join(repo, p)), false, `${p} wrócił`);
  assert.ok(graf.size > 250, `graf gry: tylko ${graf.size} plików`);
  assert.ok(graf.has('src/game/hullBodies.js') && graf.has('src/game/destructorBeams3D.js'), 'graf gry nie sięga silnika belek');
  const wGrafie = [...graf.keys()].filter((f) => /^src\/(physics|benchmark)\//.test(f) || USUNIETY_PLIK.test(f));
  assert.deepEqual(wGrafie, [], 'gra znów ładuje silnik heksów albo worker fizyki v2');
});

test('kod gry bez pól i API kadłubów heksowych (komentarze i napisy się nie liczą)', () => {
  const kod = kodGry();
  const wyjatek = new Map(WYJATKI.map((w) => [`${w.plik}|${w.slowo}`, w]));
  const problemy = [];
  const zuzyte = new Map();
  for (const [plik, code] of kod) {
    for (const slowo of SLOWA) {
      const n = (code.match(new RegExp(`\\b${slowo}\\b`, 'g')) || []).length;
      if (!n) continue;
      const w = wyjatek.get(`${plik}|${slowo}`);
      if (w) { zuzyte.set(w, n); continue; }
      problemy.push(`${plik}: ${slowo} ×${n}`);
    }
  }
  assert.deepEqual(problemy, [], 'kadłuby gry są na belkach (src/game/hullBodies.js) — heksowe pola i API nie wracają:\n' + problemy.join('\n'));
  for (const w of WYJATKI) {
    assert.ok(w.powod.length > 20, `${w.plik}: brak powodu wyjątku`);
    assert.equal(zuzyte.get(w) || 0, w.ile, `${w.plik} (${w.slowo}): wyjątek nieaktualny — popraw liczbę albo usuń wpis z WYJATKI`);
  }
});

test('wykrywanie: słowo w kodzie łapie, w komentarzu i napisie — nie', () => {
  const code = lex([
    '// dawniej entity.hexGrid',
    "const label = 'hexGrid';",
    'const g = entity.beamHull;',
    'if (e.hexGrid) wake(e);'
  ].join('\n')).codeOnly;
  assert.equal((code.match(/\bhexGrid\b/g) || []).length, 1);
});
