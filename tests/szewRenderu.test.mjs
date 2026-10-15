// Strażnik szwu gra ↔ warstwa renderu (RW-01, docs/PLAN-render-worker.md § 2, § 4 Etap 0).
//
// Zapadka liczników z scripts/webgpu/szewRenderu.mjs: każdy licznik ≤ sufit, klucz bez sufitu = 0. Liczba może spaść
// (sufit wolno wtedy obniżyć — nie trzeba), nie może wzrosnąć bez wpisu z powodem przy sufice (komentarz w tej linii:
// data, zadanie, dlaczego). Nowy import z renderu do src/game / src/ai = także wpis w KLASY_IMPORTOW (klasa A–E).
// Obecne liczby: `node scripts/webgpu/szewRenderu.mjs` (podsumowanie), `--sufity` (blok niżej), `--json plik` (miejsca).
// Sufity z 2026-10-15 (stan main 45431670; liczby 2026-10-07 dla porównania — PLAN § 2 „2026-10-15 vs 2026-10-07”).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { szewRenderu, grafGry, KLASY_IMPORTOW } from '../scripts/webgpu/szewRenderu.mjs';
import { repo } from '../scripts/webgpu/grafGry.mjs';

const SUFITY = {
  // index.html → render, per grupa (§ 2.1)
  'index:aktualizacja': 100,
  'index:dane': 31,
  'index:konfiguracja': 169,
  'index:zapytanie': 76,
  'index:zdarzenie': 66,
  // importy render → src/game / src/ai (lista dozwolona; klasy A–E w KLASY_IMPORTOW, § 2.2)
  'import:src/game/asteroidBeltField.js': 1,
  'import:src/game/asteroidBeltGiants.js': 1,
  'import:src/game/asteroidFieldLight.js': 1,
  'import:src/game/asteroidGiantBuilder.js': 1,
  'import:src/game/asteroidGiants.js': 1,
  'import:src/game/asteroidMining.js': 2,
  'import:src/game/asteroidMiningRig.js': 2,
  'import:src/game/asteroidRockKinds.js': 5,
  'import:src/game/asteroidRotation.js': 2,
  'import:src/game/asteroidStorms.js': 3,
  'import:src/game/beamBand3D.js': 1,
  'import:src/game/cargoPortOps.js': 1,
  'import:src/game/carrierVelocity.js': 16,
  'import:src/game/cloakLook.js': 9,
  'import:src/game/coldWrecks.js': 1,
  'import:src/game/cometNucleus.js': 1,
  'import:src/game/comets.js': 1,
  'import:src/game/coreModel.js': 3,
  'import:src/game/destructorConfig.js': 2,
  'import:src/game/engineIgnition.js': 3,
  'import:src/game/friendlyFire.js': 1,
  'import:src/game/haloRingCollision.js': 1,
  'import:src/game/haloRingPlanets.js': 2,
  'import:src/game/hexBodyHooks.js': 1,
  'import:src/game/hexGridSpace.js': 1,
  'import:src/game/hullBodies.js': 8,
  'import:src/game/hullCraters.js': 1,
  'import:src/game/hullMounts.js': 2,
  'import:src/game/k7BerthService.js': 1,
  'import:src/game/reactorCore.js': 1,
  'import:src/game/repairRig.js': 1,
  'import:src/game/repairSwarm.js': 1,
  'import:src/game/shipBridge.js': 3,
  'import:src/game/shipBridgeBeams.js': 2,
  'import:src/game/shipBridgeRuntime.js': 1,
  'import:src/game/shipLightRuntime.js': 5,
  'import:src/game/simClock.js': 15,
  'import:src/game/skyRegion.js': 1,
  'import:src/game/story/pirateBaseBodies.js': 1,
  'import:src/game/traffic/dockLayout.js': 2,
  'import:src/game/traffic/shipyards.js': 2,
  'import:src/game/view3D.js': 1,
  'import:src/game/warpDrive.js': 3,
  'import:src/game/weaponAim.js': 1,
  'import:src/game/weaponFeel.js': 2,
  'import:src/game/weaponShotBus.js': 1,
  'import:shieldSystem.js': 4, // 2026-10-15 RW-35: shieldSystem.js (korzeń repo) liczony od teraz jako symulacja — importy były już wcześniej
  'import:src/game/worldBodies.js': 2,
  // zmienne gry czytane w modułach przenoszonych (§ 2.4): 0 od RW-12 (2026-10-15) — tylko przez fasadę
  // RenderWorld (src/render/renderWorld.js); `okno:` / `okno-wartosc:` / `gamestate:` nie mają sufitów
  // zmienne gry czytane w modułach kanwy 2D (zostają na wątku głównym)
  'okno-kanwa:CANVAS_WEAPON_VFX_ENABLED': 1,
  'okno-kanwa:CICDisplay': 1,
  'okno-kanwa:DevTuning': 1,
  'okno-kanwa:H': 5,
  'okno-kanwa:PHYS_HZ': 1,
  'okno-kanwa:SparkSystem3D': 2,
  'okno-kanwa:W': 5,
  'okno-kanwa:__interpShipTurretAngles': 2,
  'okno-kanwa:__weaponAimAlpha': 2,
  'okno-kanwa:camera': 2,
  'okno-kanwa:ship': 2,
  'okno-kanwa:worldToScreen': 5,
  'okno-kanwa:worldToScreenInto': 1,
  // DOM i okno przeglądarki w modułach przenoszonych (§ 2.9): 0 od RW-35 (2026-10-15) — kanwy i obrazy przez
  // src/3d/canvas2d.js, praca w tle przez src/3d/harmonogram.js, okno i strona przez RenderWorld; `dom:` bez sufitów
  // odczyty GPU → CPU (§ 2.6)
  'gpu:src/3d/asteroids/rockBank.js': 1,
  'gpu:src/3d/gas/gasGrid.js': 5,
  'gpu:src/3d/haloRing/haloRingWorldGen.js': 1,
  'gpu:src/3d/shield3D.js': 2,
  'gpu:src/3d/tsl/zapisF16.js': 2,
  // Math.random w renderze (RW-20)
  'random:src/3d/planet3d.assets.js': 8,
  'random:src/3d/reactor3D.js': 3,
  'random:src/effects3d/rocketSystem3D.js': 2
};

const graf = grafGry();
const wynik = szewRenderu(repo, { graf });

function przekroczenia(w) {
  const out = [];
  for (const [k, n] of Object.entries(w.liczniki)) {
    const sufit = SUFITY[k] ?? 0;
    if (n > sufit) out.push(`${k}: ${n} > ${sufit}\n    ${(w.szczegoly.miejsca[k] || []).slice(-8).join('\n    ')}`);
  }
  return out;
}

test('szew renderu: liczniki nie rosną ponad sufity', (t) => {
  const zle = przekroczenia(wynik);
  assert.deepEqual(zle, [], `szew renderu urósł (sufit w tests/szewRenderu.test.mjs — podnieść tylko z powodem):\n  ${zle.join('\n  ')}`);
  const nizej = Object.entries(SUFITY).filter(([k, s]) => (wynik.liczniki[k] || 0) < s).map(([k, s]) => `${k} ${wynik.liczniki[k] || 0}/${s}`);
  if (nizej.length) t.diagnostic(`poniżej sufitu (można obniżyć): ${nizej.join(', ')}`);
});

test('szew renderu: każdy moduł symulacji importowany przez render ma klasę A–E', () => {
  const bez = Object.keys(wynik.liczniki).filter((k) => k.startsWith('import:')).map((k) => k.slice(7)).filter((m) => !/^[A-E]$/.test(KLASY_IMPORTOW[m] || ''));
  assert.deepEqual(bez, [], 'nowy moduł symulacji importowany przez render — wpis w KLASY_IMPORTOW (scripts/webgpu/szewRenderu.mjs)');
  for (const k of Object.keys(SUFITY)) if (k.startsWith('import:')) assert.ok(KLASY_IMPORTOW[k.slice(7)], `sufit bez klasy: ${k}`);
});

test('szew renderu: strażnik łapie window.ship w src/3d i nowy import src/game z renderu (kopia w pamięci)', () => {
  const plik = 'src/3d/core3d.js';
  const text = readFileSync(join(repo, plik), 'utf8');
  const zmieniony = `import { stepDecay120 } from '../game/stepDecay.js';\n${text}\nexport const __szewProba = () => [window.ship, stepDecay120];\n`;
  const w = szewRenderu(repo, { graf, nadpisz: { [plik]: zmieniony } });
  const zle = przekroczenia(w).map((s) => s.split(':').slice(0, 2).join(':'));
  assert.ok(zle.includes('okno:ship'), `window.ship nie złapane: ${zle.join(', ')}`);
  assert.ok(zle.includes('import:src/game/stepDecay.js'), `nowy import nie złapany: ${zle.join(', ')}`);
  assert.equal((w.liczniki['okno:ship'] || 0) - (wynik.liczniki['okno:ship'] || 0), 1);
});
