import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Strażnicy rozgrzewki shaderów (2026-09-26). Bez niej pierwszy efekt w sesji kompilował
// programy w klatce gry (iskry pierwszej kolizji ~50 ms, Yamato 140–200 ms, tarcza pierwszego
// wroga ~200 ms), a efekty z materiałami tworzonymi na każdy wybuch (rail, armata, działko)
// i tarcze kompilowały się OD NOWA po każdej przerwie: dispose ostatniego materiału z danym
// programem niszczy program three. Cofnięcie nie psuje obrazu — tylko klatkę — więc bez testu
// wróciłoby niezauważone.

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const reactorBlow = readFileSync(new URL('../src/effects3d/reactorblow.js', import.meta.url), 'utf8');
const shield3d = readFileSync(new URL('../src/3d/shield3D.js', import.meta.url), 'utf8');

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `brak ${signature}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`niedomknięte ${signature}`);
}

// Zadanie 20: overlay efektów (drugi WebGLRenderer z własną rozgrzewką kompozytora) usunięty —
// wybuch reaktora ma pule w scenie Core3D i rozgrzewa je jego krok klatki efektów (warm: raz przy
// gotowym urządzeniu): compileAsync pomija niewidoczne i obiekty bez instancji, więc obie siatki
// odsłonięte na czas projekcji, cel composerTarget (prewarmPass warstwy 0), bez dispose.
test('wybuch reaktora (Core3D): rozgrzewka kroku — obie pule odsłonięte, prewarmPass passa ortho, bez dispose', () => {
  const warm = functionBody(reactorBlow, '  _warm(ctx) {');
  assert.match(warm, /for \(const m of this\.meshes\)/);
  assert.match(warm, /m\.visible = true;/, 'ukryte pule muszą przejść przez projekcję');
  assert.match(warm, /m\.geometry\.instanceCount = 2;/, 'pula bez instancji nie ma czego rysować');
  assert.match(warm, /core\.prewarmPass\(m, 0\)/, 'pass ortho (warstwa 0), cel composerTarget');
  assert.match(warm, /finally \{ m\.visible = vis; m\.geometry\.instanceCount = ic; \}/, 'stan przywrócony');
  assert.doesNotMatch(warm, /\.dispose\(/);
  assert.match(reactorBlow, /name: 'reaktor'[\s\S]{0,300}warm: \(ctx\) => self\._warm\(ctx\)/);
  // Fabryka powstaje przy starcie Core3D (krok rejestruje się od razu; warm przy gotowym urządzeniu).
  const start = indexHtml.indexOf('SparkSystem3D.init(Core3D.scene);');
  const factory = indexHtml.indexOf('window.makeReactorBlow = createReactorBlowFactory(Core3D);');
  assert.ok(start > 0 && factory > start && factory - start < 1200, 'fabryka wybuchu przy starcie efektów Core3D');
});

// Zadanie 17: fabryk trafień broni w overlayu (rail, armata, działko, Yamato) już nie ma — trafienia
// to receptury WeaponFx (pule GPU w Core3D, rozgrzewane krokiem Core3D.fx: kernele compute
// i siatki przez prewarmPass). Zadanie 20: overlaya nie ma wcale.
test('gra: efekty broni rozgrzewa krok Core3D.fx; overlay (i jego rozgrzewka) nie wraca', () => {
  assert.doesNotMatch(indexHtml, /startOverlay3D|ov\.prewarm|makeRailgunExplosion|makeArmataImpact|makeAutocannonImpact|makeYamatoImpact/);
  const wfx = readFileSync(new URL('../src/3d/weapons/weaponFx.js', import.meta.url), 'utf8');
  assert.match(wfx, /warm\(c\) \{ self\.gpu\.warm\(c\.renderer, c\.core\); self\._warmSystems\(c\); \}/);
  assert.match(wfx, /core\.prewarmPass\(mesh, 0\)/);
});

test('rakiety i iskry (Core3D): rozgrzewka kroków efektów — compute, mapa gęstości, pule odsłonięte', () => {
  const rocketFx = readFileSync(new URL('../src/3d/rockets/rocketFx.js', import.meta.url), 'utf8');
  const warm = functionBody(rocketFx, '  _warm(ctx) {');
  // Kernele compute (dispatch z count 0 kompiluje pipeline), pass mapy gęstości i wszystkie
  // siatki rakiet w passie sceny (compileAsync pomija niewidoczne — odsłonięte na czas projekcji).
  assert.match(warm, /computeAsync|compute\(/);
  assert.match(warm, /m\.visible = true;/);
  assert.match(warm, /ctx\.core\.prewarmPass\(m, 0\)/);
  assert.doesNotMatch(warm, /\.dispose\(/);
  assert.match(rocketFx, /name: 'rakiety'[\s\S]{0,200}warm: \(ctx\) => self\._warm\(ctx\)/);
  const sparks = readFileSync(new URL('../src/3d/sparkSystem3D.js', import.meta.url), 'utf8');
  assert.match(sparks, /name: 'iskry'/);
  assert.match(sparks, /m\.visible = true;[\s\S]{0,200}ctx\.core\.prewarmPass\(m, 0\)/);
});

test('tarcze: materiały-trzymacze obu wariantów, rozgrzewka na ekranie ładowania', () => {
  const body = functionBody(shield3d, 'export function prewarmShields3D(');
  assert.match(body, /createHullShieldMaterial\(/);
  assert.match(body, /createShieldMaterial\(\)/);
  assert.match(body, /ShieldImpactFX\.init\(Core3D\.scene\)/, 'pule cząstek trafień w scenie przed kompilacją');
  // WebGPU: compileAsync bez blokowania dla passa tarcz (warstwa 7, cel sceny) —
  // Core3D.prewarmPass (renderer.compile to tam alias compileAsync, zwraca Promise).
  assert.match(body, /Core3D\.prewarmPass\(probe, 7\)/);
  assert.match(body, /_programKeepers = \[hull\.material, sphere\.material\]/, 'materiały bez dispose trzymają programy');
  assert.doesNotMatch(body, /\.dispose\(/);
  // Klucz stanu budowy i układ wierzchołków pipeline'u zależą od zestawu atrybutów geometrii:
  // próbka obrysu na geometrii obrysu (aEdge), nie na sferze (port WebGPU, zadanie 14).
  assert.match(body, /new THREE\.Mesh\(buildHullShieldGeometry\(PREWARM_PROFILE\), createHullShieldMaterial\(PREWARM_PROFILE\)\)/);
  // Wstęgi i bańki trafień (ukryte do pierwszego trafienia) — rozgrzewka w passie tarcz.
  assert.match(body, /ShieldImpactFX\.prewarm\(\)/);
  const fx = readFileSync(new URL('../src/3d/shieldImpactFx.js', import.meta.url), 'utf8');
  const fxPrewarm = functionBody(fx, '    prewarm() {');
  assert.match(fxPrewarm, /mesh\.visible = true;[\s\S]*flashMesh\.visible = true;[\s\S]*Core3D\.prewarmPass\(root, 7\)/, 'compileAsync pomija niewidoczne — pule odsłonięte na czas projekcji');
  assert.doesNotMatch(fxPrewarm, /\.dispose\(/);
  const loading = indexHtml.indexOf("setLoadingProgress(70, 'Kompilacja shaderów broni')");
  const call = indexHtml.indexOf('prewarmShields3D();', loading);
  assert.ok(loading > 0 && call > loading && call - loading < 600, 'prewarmShields3D na ekranie ładowania, obok shaderów broni');
});
