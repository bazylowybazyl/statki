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

test('gra: overlay rozgrzewany próbkami fabryk tworzących materiały na każdy wybuch', () => {
  const body = functionBody(indexHtml, 'function startOverlay3D(');
  const call = body.indexOf('ov.prewarm?.(prewarmSamples)');
  assert.ok(call > 0, 'startOverlay3D woła ov.prewarm');
  for (const factory of ['makeRailgunExplosion', 'makeArmataImpact', 'makeAutocannonImpact']) {
    const at = body.indexOf(`prewarmSamples.push(window.${factory}(`);
    assert.ok(at > 0 && at < call, `próbka ${factory} przed rozgrzewką`);
  }
  // Pule (iskry, Yamato, reaktor, supernowa, rakiety) muszą już wisieć w scenie.
  for (const init of ['SparkSystem3D.init(ov.scene)', 'window.makeYamatoImpact = yamatoFactory(ov.scene)',
    'window.makeReactorBlow = reactorFactory(ov.scene)', 'initRocketSystem3D(rocketOv.scene)']) {
    const at = body.indexOf(init);
    assert.ok(at > 0 && at < call, `${init} przed rozgrzewką`);
  }
});

test('tarcze: materiały-trzymacze obu wariantów, rozgrzewka na ekranie ładowania', () => {
  const body = functionBody(shield3d, 'export function prewarmShields3D(');
  assert.match(body, /createHullShieldMaterial\(/);
  assert.match(body, /createShieldMaterial\(\)/);
  assert.match(body, /ShieldImpactFX\.init\(Core3D\.scene\)/, 'pule cząstek trafień w scenie przed kompilacją');
  assert.match(body, /Core3D\.renderer\.compile\(/);
  assert.match(body, /_programKeepers = \[hull\.material, sphere\.material\]/, 'materiały bez dispose trzymają programy');
  assert.doesNotMatch(body, /\.dispose\(/);
  const loading = indexHtml.indexOf("setLoadingProgress(70, 'Kompilacja shaderów broni')");
  const call = indexHtml.indexOf('prewarmShields3D();', loading);
  assert.ok(loading > 0 && call > loading && call - loading < 600, 'prewarmShields3D na ekranie ładowania, obok shaderów broni');
});
