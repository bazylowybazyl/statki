import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Fizyka chodzi w 120 Hz (PHYS_DT = 1/120), więc przy 47 fps jeden rAF robi ~2.9
// podkroków. Warstwa decyzyjna (AI, sensory, CIC, skan) NIE zależy od kroku
// całkowania i płacenie za nią ×2.9 to była czysta strata — a im niższy fps, tym
// więcej podkroków, czyli spirala. Te testy pilnują, żeby rozdział nie wyparował
// przy kolejnym refaktorze.

function sliceBetween(src, startNeedle, endNeedle) {
  const from = src.indexOf(startNeedle);
  assert.ok(from >= 0, `nie znaleziono kotwicy startowej: ${startNeedle}`);
  const to = src.indexOf(endNeedle, from);
  assert.ok(to > from, `nie znaleziono kotwicy końcowej: ${endNeedle}`);
  return src.slice(from, to);
}

test('physicsStep takes a logic gate and a frame-wide dt', () => {
  assert.match(
    indexHtml,
    /function physicsStep\(dt, runLogic = true, logicDt = dt\)/,
    'physicsStep musi przyjmować runLogic i logicDt'
  );
});

test('the loop runs the decision layer only on the first substep', () => {
  const loopSlice = sliceBetween(indexHtml, 'const bridgeStartTick = physicsTickId + 1;', 'physicsTickId++;');

  // Liczba podkroków znana PRZED pętlą — bez tego nie da się podać sumarycznego dt.
  assert.match(loopSlice, /const plannedSteps = Math\.min\(10, Math\.floor\(acc \/ PHYS_DT\)\)/);
  assert.match(loopSlice, /const logicDt = Math\.max\(PHYS_DT, plannedSteps \* PHYS_DT\)/);

  // Gate = pierwszy podkrok klatki.
  assert.match(loopSlice, /physicsStep\(PHYS_DT, steps === 0, logicDt\)/);
});

test('npcStep separates brains from movement integration', () => {
  assert.match(
    indexHtml,
    /function npcStep\(dt, aiDbg = null, runBrains = true, brainDt = dt\)/,
    'npcStep musi umieć przebieg czysto ruchowy'
  );

  // Mózg odpala się tylko w przebiegu decyzyjnym i dostaje dt CAŁEJ klatki.
  assert.match(indexHtml, /if \(runBrains && npc\.ai\) \{/);
  assert.match(indexHtml, /npc\.ai\(brainDt\);/);

  // Integracja ruchu MUSI zostać poza bramką — myśliwiec przy 3400 u/s przeskakuje
  // ~70 u na klatkę, a pocisk pokonuje ~16 u na podkrok: ruch raz na klatkę
  // zaczyna gubić trafienia.
  const npcStepSlice = sliceBetween(indexHtml, 'function npcStep(dt, aiDbg', 'function pirateMissionStep');
  const moveIdx = npcStepSlice.indexOf('npc.x += npc.vx * dt;');
  assert.ok(moveIdx > 0, 'npcStep musi nadal integrować pozycję krokiem fizyki');

  // Siatka AI i koordynator przebudowują się raz na klatkę, nie co podkrok.
  assert.match(npcStepSlice, /if \(runBrains\) \{[\s\S]*rebuildAIGrid/);
});

test('sensor / CIC / scan layer is gated behind runLogic', () => {
  const scanSlice = sliceBetween(indexHtml, '// hover scanning', "addTiming('scanUiTime'");

  assert.match(scanSlice, /SpotterDroneSystem\.update\(logicDt/);
  assert.match(scanSlice, /SensorSystem\.update\(logicDt/);
  assert.match(scanSlice, /CICDisplay\.update\(logicDt/);
  assert.match(scanSlice, /koniec bloku runLogic/);

  // Bramka otwiera się tuż przed blokiem skanu.
  const beforeScan = indexHtml.slice(0, indexHtml.indexOf('// hover scanning'));
  assert.match(beforeScan.slice(-400), /if \(runLogic\) \{/);
});

test('squad / support-wing / mission waves run once per frame', () => {
  const aiSlice = sliceBetween(indexHtml, 'const tAiTotal0 = performance.now();', "addTiming('aiTime'");

  assert.match(aiSlice, /if \(runLogic\) \{[\s\S]*SQUADS\.forEach/);
  assert.match(aiSlice, /updateFighterLaunchQueue\(logicDt\)/);
  assert.match(aiSlice, /updateSupportWing\(logicDt\)/);
  assert.match(aiSlice, /if \(runLogic\) pirateMissionStep\(logicDt\)/);

  // npcStep zostaje POZA bramką (ruch co podkrok), tylko z przekazanym gate'em.
  assert.match(aiSlice, /npcStep\(dt, aiDbgEnabled \? AILiveDebug : null, runLogic, logicDt\)/);
});

test('projectiles and the destructor stay on the physics substep', () => {
  const physicsSlice = sliceBetween(indexHtml, 'function physicsStep(dt, runLogic', "addTiming('physicsTime'");

  // Pociski MUSZĄ chodzić co podkrok — inaczej tunelują.
  assert.match(physicsSlice, /DestructorSystem\.update\(dt, allDestructibles\)/);
  assert.doesNotMatch(physicsSlice, /if \(runLogic\)[\s\S]{0,200}DestructorSystem\.update/);
  assert.match(physicsSlice, /TowSystem\.update\(dt\)/);
  assert.match(physicsSlice, /updateMegafreighterTrains\(dt\)/);
});
