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
const explosions = readFileSync(new URL('../src/3d/explosions/explosionFx.js', import.meta.url), 'utf8');
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

// Wybuchy WebGPU (2026-10-07, src/3d/explosions/explosionFx.js — zastąpiły reactorblow.js): krok klatki efektów
// rozgrzewa się raz przy gotowym urządzeniu — puste dispatche kerneli gazu i żaru, potem siatki (bryły gazu, żar,
// błyski, łby odłamków) odsłonięte z licznikiem instancji ≥ 2 (compileAsync pomija niewidoczne i puste) w passie
// swojej warstwy, z kamerą z góry i kamerą 3D (typ kamery wchodzi do klucza pipeline'u); stan przywrócony, bez dispose.
test('wybuchy (Core3D): rozgrzewka kroku — kernele gazu i żaru, siatki odsłonięte, obie kamery, bez dispose', () => {
  const warm = functionBody(explosions, '  _warm(ctx) {');
  assert.match(warm, /this\.grid\.warm\(ctx\.renderer\)/, 'kernele gazu (pipeline compute powstaje synchronicznie)');
  assert.match(warm, /this\.embers\.warm\(ctx\.renderer\)/, 'kernele żaru');
  assert.match(warm, /for \(const m of this\.warmMeshes\) m\.visible = true;/, 'ukryte siatki muszą przejść przez projekcję');
  // bryły wszystkich atlasów gazu (podstawowy, „fine”, „coarse” — etap D)
  assert.match(warm, /MS\.forEach\(\(ms, i\) => \{ ms\.geometry\.instanceCount = Math\.max\(2, savedG\[i\]\); \}\)/, 'pula bez instancji nie ma czego rysować');
  assert.match(warm, /core\.prewarmPass\?\.\(m, layer\);\s*core\.prewarmPass\?\.\(m, layer, \{ ortho: false \}\);/, 'kamera z góry i kamery 3D');
  assert.match(warm, /finally \{[\s\S]*ms\.geometry\.instanceCount = savedG\[i\];[\s\S]*m\.visible = vis\[i\];/, 'stan przywrócony');
  assert.doesNotMatch(warm, /\.dispose\(/);
  assert.match(explosions, /name: 'wybuchy'[\s\S]{0,300}warm: \(ctx\) => self\._warm\(ctx\)/);
  // Kernel przesunięcia żaru zarejestrowany w początku pul PRZED krokiem (rozgrzewka kroku kompiluje i jego).
  assert.ok(explosions.indexOf('origin.register({') > 0 && explosions.indexOf('origin.register({') < explosions.indexOf('core.addFxStep(this.step)'));
  // W grze fabryka powstaje przy starcie efektów Core3D (przed ekranem ładowania — rozgrzewka kroku w rejestrze).
  const start = indexHtml.indexOf('SparkSystem3D.init(Core3D.scene);');
  const factory = indexHtml.indexOf('window.makeReactorBlow = createExplosionFactory(');
  assert.ok(start > 0 && factory > start && factory - start < 1800, 'fabryka wybuchów przy starcie efektów Core3D');
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

test('tarcze: pula płytek i iskier rozgrzana na ekranie ładowania (pass tarcz, warstwa DIST, kernele)', () => {
  const body = functionBody(shield3d, 'export function prewarmShields3D(');
  assert.match(body, /ensurePool\(\)/, 'pula w scenie przed kompilacją');
  // compileAsync pomija niewidoczne — siatki odsłonięte na czas projekcji (Core3D.prewarmPass).
  assert.match(body, /p\.tileMesh\.visible = p\.sparkSprite\.visible = p\.distMesh\.visible = p\.glowMesh\.visible = true;/);
  assert.match(body, /Core3D\.prewarmPass\(p\.glowMesh, 7\)/);
  assert.match(body, /Core3D\.prewarmPass\(p\.tileMesh, 7\)/);
  assert.match(body, /Core3D\.prewarmPass\(p\.sparkSprite, 7\)/);
  assert.match(body, /Core3D\.prewarmPass\(p\.distMesh, FX_DISTORT_LAYER\)/);
  assert.doesNotMatch(body, /\.dispose\(/);
  // Kernele compute (pipeline synchronicznie) — krok efektów „tarcze” z warm.
  assert.match(shield3d, /name: 'tarcze',[\s\S]{0,600}warm\(ctx\)/);
  const loading = indexHtml.indexOf("setLoadingProgress(70, 'Kompilacja shaderów broni')");
  // zadanie 11: wywołanie przez rejestr (Core3D.warmup.run('tarcze …', () => prewarmShields3D())) — ta sama chwila
  const call = indexHtml.indexOf('prewarmShields3D()', loading);
  assert.ok(loading > 0 && call > loading && call - loading < 900, 'prewarmShields3D na ekranie ładowania, obok shaderów broni');
});
