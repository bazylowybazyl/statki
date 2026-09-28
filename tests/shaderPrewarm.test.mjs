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
const overlay = readFileSync(new URL('../src/effects3d/overlay.js', import.meta.url), 'utf8');
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

test('overlay3D: prewarm renderuje kompozytor ze wszystkim widocznym i trzyma próbki bez dispose', () => {
  const body = functionBody(overlay, 'function prewarm(');
  assert.match(body, /o\.frustumCulled = false/, 'próbki poza kadrem obcinane — program by nie powstał');
  assert.match(body, /o\.visible = true/, 'ukryte pule muszą przejść przez render (programy i bufory)');
  assert.match(body, /composer\.render\(\)/, 'passy kompozytora (bloom, alfa) kompilują się tylko w przebiegu');
  assert.match(body, /programKeepers\.push\(fx\)/, 'próbki trzymają programy przy życiu');
  assert.doesNotMatch(body, /\.dispose\(/, 'dispose próbki zniszczyłby program, który ma trzymać');
  assert.match(body, /renderer\.clear\(\)\s*;\s*\}\s*stats\.prewarmMs/, 'kanwa czyszczona w tym samym zadaniu — nic nie mignie');
  assert.match(overlay, /rawScene, rawLayer, prewarm,/, 'prewarm w API overlaya');
});

// Zadanie 17: fabryk trafień broni w overlayu (rail, armata, działko, Yamato) już nie ma — trafienia
// to receptury WeaponFx (pule GPU w Core3D, rozgrzewane krokiem Core3D.fx: kernele compute
// i siatki przez prewarmPass). Overlay rozgrzewa to, co w nim zostało.
test('gra: overlay rozgrzewany z pulami w scenie; efekty broni rozgrzewa krok Core3D.fx', () => {
  const body = functionBody(indexHtml, 'function startOverlay3D(');
  const call = body.indexOf('ov.prewarm?.()');
  assert.ok(call > 0, 'startOverlay3D woła ov.prewarm');
  assert.doesNotMatch(body, /makeRailgunExplosion|makeArmataImpact|makeAutocannonImpact|makeYamatoImpact/, 'fabryki trafień broni wróciły do overlaya');
  // Pule (iskry, reaktor, supernowa, rakiety) muszą już wisieć w scenie.
  for (const init of ['SparkSystem3D.init(ov.scene)', 'window.makeReactorBlow = reactorFactory(ov.scene)',
    'initRocketSystem3D(rocketOv.scene)']) {
    const at = body.indexOf(init);
    assert.ok(at > 0 && at < call, `${init} przed rozgrzewką`);
  }
  const wfx = readFileSync(new URL('../src/3d/weapons/weaponFx.js', import.meta.url), 'utf8');
  assert.match(wfx, /warm\(c\) \{ self\.gpu\.warm\(c\.renderer, c\.core\); self\._warmSystems\(c\); \}/);
  assert.match(wfx, /core\.prewarmPass\(mesh, 0\)/);
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
