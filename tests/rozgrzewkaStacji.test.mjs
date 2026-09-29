// Zadanie 25a: rozgrzewka stacji i wszystkiego, co kompilowało się dopiero w grze — szablony GLB stacji planet
// (pass FG, pass mapy cienia, wypiek i rozgrzewka rozpadu) i bryły stacji na ekranie ładowania (prepareStations3D),
// rozpad przez rejestr Core3D.warmup (pass cienia w tle — Core3D.prewarmShadowPass), stacja piracka gotowa z
// ekranu ładowania (stałe światła latarni — zestaw świateł passa się nie zmienia), smugi dalekich kadłubów.
// Bez GPU: wpisy rejestru (atrapa okna) i wzorce źródeł. Obraz i liczniki kompilacji: scripts/webgpu/zrzuty.mjs
// (sesje „stacja”, „piraci”; `pipeline.sync` / `budowy` scen).
// node --test tests/rozgrzewkaStacji.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { Core3D } from '../src/3d/core3d.js';
import { Destruction3D } from '../src/vfx/destruction3D.js';
import { createPirateStation } from '../src/space/pirateStation/pirateStationFactory.js';
import { fxRandom } from '../src/3d/fx/fxRandom.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

test('stacje planet: szablony GLB na ekranie ładowania — warstwa FG, wypiek rozpadu, pass FG i cień w rejestrze, bryły', () => {
  const src = code('src/3d/stations3D.js');
  const warm = src.slice(src.indexOf('function warmStationTemplate('), src.indexOf('export async function prepareStations3D('));
  assert.match(warm, /Core3D\.enableForeground3D\(root\);/, 'szablon na warstwie FG jak klony — klucze rozgrzewki rozpadu z warstwą');
  assert.match(warm, /Destruction3D\.prebake\(root\);/);
  assert.match(warm, /reg\.add\(\{ name: `stacje: bryła \$\{name\}`, objects: root, layer: 2 \}\);/);
  assert.match(warm, /reg\.add\(\{ name: `stacje: cień \$\{name\}`, objects: root, shadow: true \}\);/);
  const prep = src.slice(src.indexOf('export async function prepareStations3D('), src.indexOf('function cloneTemplate('));
  assert.match(prep, /station\.ringPort\) continue;/, 'stacja-port bez bryły');
  assert.match(prep, /entry\.loaded/, 'czeka na wczytanie szablonów');
  assert.match(prep, /initStations3D\(null, stations\);/, 'bryły stacji przed pierwszą klatką gry');
  // wczytany po ekranie ładowania — rozgrzewka od razu
  assert.match(src, /if \(stationsWarmRequested\) warmStationTemplate\(placeholder, path\);/);
  // index.html: przed flush() rejestru na ekranie ładowania
  const html = read('index.html');
  const start = html.slice(html.indexOf('async function startGame() {'), html.indexOf('if (newGameButton) {'));
  const at = start.indexOf('await prepareStations3D(stations);');
  assert.ok(at > 0 && at < start.indexOf('await Core3D.warmup?.flush('), 'stacje przed flush()');
  // przed pasem asteroid: rejestr kompiluje stacje w wolnych chwilach, gdy strona czeka na pipeline'y pasa
  assert.ok(at < start.indexOf('await asteroidBelt.precompute('), 'stacje przed pasem');
});

test('rozpad przez rejestr: pass sceny i pass cienia (tylko siatki rzucające cień), trójkąty w miejscu na układzie wypieku', async () => {
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) globalThis.window = {};
  const reg = Core3D.warmup;
  const before = reg._normal.length;
  try {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const casts = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    casts.castShadow = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)); // inny układ niż skrzynka
    const noCast = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    root.add(casts, noCast);
    Core3D.enableForeground3D(root);
    Destruction3D.prebake(root);
    const added = reg._normal.slice(before);
    const names = added.map((e) => `${e.name}${e.spec.shadow ? ' [cień]' : ''}`);
    const shadow = added.filter((e) => e.spec.shadow);
    assert.ok(shadow.length > 0 && shadow.every((e) => typeof e.spec.fallback === 'function'), 'pass cienia w tle, z zapasem rysunkiem');
    assert.ok(names.includes('rozpad stacji: trojkaty-cien [cień]'), 'trójkąty w miejscu (stary stan obiektu renderu cienia, układ wypieku)');
    // siatka bez castShadow: bez wpisów passa cienia (układ sfery tylko w passie sceny)
    const sphereLayout = added.filter((e) => e.name === 'rozpad stacji: implode');
    assert.equal(sphereLayout.length, 2, 'implozja: pass sceny dla obu układów');
    assert.equal(added.filter((e) => e.name === 'rozpad stacji: implode-cien').length, 1, 'implozja: cień tylko rzucającej');
    // trzymacze cienia powstają dopiero w rejestrze, z castShadow
    const holder = shadow[0].spec.objects();
    assert.equal(holder.castShadow, true);
    assert.equal(holder.name, 'Destruction3D:warm');
  } finally {
    reg._normal.length = before;
    if (!hadWindow) delete globalThis.window;
  }
});

test('stacja piracka: wygląd z własnego strumienia (bez Math.random gry i wspólnego fxRandom), światła latarni pożyczone ze sceny, pozycja latarni co klatkę', () => {
  const lights = [new THREE.PointLight(), new THREE.PointLight()];
  fxRandom.seed(0x25a);
  const fxState = fxRandom.state;
  const mathRandom = Math.random;
  let gameDraws = 0;
  // UUID three (MathUtils.generateUUID) losuje z Math.random przy każdym obiekcie — harness ma na nie osobny strumień
  Math.random = () => { if (!/generateUUID/.test(new Error().stack)) gameDraws++; return mathRandom(); };
  let a;
  try {
    a = createPirateStation({ worldRadius: 360, beaconLights: lights });
  } finally {
    Math.random = mathRandom;
  }
  assert.equal(gameDraws, 0, 'bez losowań gry');
  assert.equal(fxRandom.state, fxState, 'bez losowań wspólnego ciągu efektów (budowa na ekranie ładowania nie przesuwa iskier i świateł)');
  let inGroup = 0;
  a.object3d.traverse((o) => { if (o.isLight) inGroup++; });
  assert.equal(inGroup, 0, 'światła latarni nie w grupie stacji (stały zestaw świateł passa)');
  assert.equal(lights[0].distance, 80 * 7.5, 'zasięg jak dawniej (80 × skala)');
  assert.equal(lights[0].color.getHex(), 0xff3b3b);
  assert.equal(lights[1].color.getHex(), 0x39a3ff);
  a.object3d.rotation.x = Math.PI * 0.5;
  a.object3d.scale.setScalar(25);
  a.object3d.position.set(1000, -2000, -100);
  a.update(0.5, 1 / 60);
  assert.ok(lights[0].intensity > 0, 'puls latarni');
  assert.ok(Math.abs(lights[0].position.x - 1000) < 1e-6 && Math.abs(lights[0].position.z - (3393.75 - 100)) < 0.01, 'światło w miejscu latarni (świat)');
  // każda budowa od tego samego ziarna → te same okna (niezależnie od stanu fxRandom)
  fxRandom.seed(0x1234);
  const b = createPirateStation({ worldRadius: 360, beaconLights: [new THREE.PointLight(), new THREE.PointLight()] });
  const counts = (s) => { const n = []; s.object3d.traverse((o) => { if (o.isInstancedMesh) n.push(o.count); }); return n.join(','); };
  assert.equal(counts(a), counts(b));
  // bez pożyczonych świateł — jak dawniej (dema)
  const c = createPirateStation({ worldRadius: 360 });
  let own = 0;
  c.object3d.traverse((o) => { if (o.isLight) own++; });
  assert.equal(own, 2);
  for (const s of [a, b, c]) s.dispose();
});

test('stacja piracka w grze: stałe światła latarni (wszystkie warstwy, zgaszone), bryła gotowa z ekranu ładowania', () => {
  const src = code('src/3d/world3d.js');
  const lights = src.slice(src.indexOf('function ensurePirateBeaconLights('), src.indexOf('function buildPirateStation3D('));
  assert.match(lights, /new THREE\.PointLight\(color, 0, 80, 2\.0\)/, 'zgaszone do misji');
  assert.match(lights, /light\.layers\.enableAll\(\);/, 'ten sam zestaw świateł w każdym passie i w rozgrzewce kamerą wszystkich warstw');
  assert.match(src, /export function initWorld3D\(\) \{[\s\S]*?ensurePirateBeaconLights\(\);/, 'od startu gry');
  assert.match(src, /Core3D\.warmup\?\.add\(\{ name: 'stacja piracka: bryła', objects: [^\n]*layer: 2, phase: 'loading' \}\);/);
  assert.match(src, /Core3D\.warmup\?\.add\(\{ name: 'stacja piracka: cień', objects: [^\n]*shadow: true, phase: 'loading' \}\);/);
  assert.match(src, /pirateStation3D = prebuiltPirate \|\| buildPirateStation3D\(\);/);
  // wypiek rozpadu na ekranie ładowania nie przesuwa wspólnego ciągu efektów (stan fxRandom wraca)
  const pre = src.slice(src.indexOf('function ensurePrebuiltPirateStation('), src.indexOf("Core3D.warmup?.add({ name: 'stacja piracka: bryła'"));
  assert.match(pre, /const fxState = fxRandom\.state;[\s\S]*Destruction3D\.prebake\([\s\S]*finally \{\s*fxRandom\.state = fxState;/);
  assert.match(src, /createPirateStation\(\{ worldRadius: 360, beaconLights: ensurePirateBeaconLights\(\) \|\| undefined \}\)/);
});

test('smugi dalekich kadłubów: batch rozgrzany na ekranie ładowania (dawniej pipeline przy pierwszej smudze)', () => {
  assert.match(read('src/3d/hexBodyImpostorBatch.js'),
    /Core3D\.warmup\?\.add\(\{ name: 'smugi dalekich kadłubów \(hexBodyImpostorBatch\)', objects: \(\) => \(ensureBuilt\(\) \? mesh : null\), layer: 0, phase: 'loading' \}\);/);
});
