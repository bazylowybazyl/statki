import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Fizyka chodzi w 120 Hz (PHYS_DT = 1/120), więc przy 47 fps jeden rAF robi ~2.9
// podkroków. Sensory/UI idą raz na klatkę, a kosztowne decyzje AI na osobnym,
// stałym zegarze 20 Hz. Integracja ruchu nadal zostaje na 120 Hz.

function sliceBetween(src, startNeedle, endNeedle) {
  const from = src.indexOf(startNeedle);
  assert.ok(from >= 0, `nie znaleziono kotwicy startowej: ${startNeedle}`);
  const to = src.indexOf(endNeedle, from);
  assert.ok(to > from, `nie znaleziono kotwicy końcowej: ${endNeedle}`);
  return src.slice(from, to);
}

test('physicsStep separates frame logic from fixed-rate AI logic', () => {
  assert.match(
    indexHtml,
    /function physicsStep\(dt, runFrameLogic = true, frameLogicDt = dt, runAiLogic = runFrameLogic, aiLogicDt = frameLogicDt, aiBrainPhase = 0, aiBrainPhaseCount = 1\)/,
    'physicsStep musi przyjmować niezależne bramki i dt dla klatki oraz AI'
  );
});

test('the loop runs UI once per frame and AI every sixth physics tick', () => {
  const loopSlice = sliceBetween(indexHtml, 'const bridgeStartTick = physicsTickId + 1;', 'physicsTickId = nextPhysicsTickId;');

  // Liczba podkroków znana PRZED pętlą — bez tego nie da się podać sumarycznego dt.
  assert.match(loopSlice, /const plannedSteps = Math\.min\(10, Math\.floor\(acc \/ PHYS_DT\)\)/);
  assert.match(loopSlice, /const frameLogicDt = Math\.max\(PHYS_DT, plannedSteps \* PHYS_DT\)/);

  assert.match(indexHtml, /new FixedStepCadence\(PHYS_HZ, AI_DECISION_TARGET_HZ\)/);
  assert.match(loopSlice, /const aiBrainPhase = aiDecisionCadence\.phase\(nextPhysicsTickId\)/);
  assert.match(loopSlice, /const runAiLogic = aiDecisionCadence\.isDue\(nextPhysicsTickId\)/);
  assert.match(
    loopSlice,
    /physicsStep\([\s\S]*PHYS_DT,[\s\S]*steps === 0,[\s\S]*frameLogicDt,[\s\S]*runAiLogic,[\s\S]*aiDecisionCadence\.dt,[\s\S]*aiBrainPhase,[\s\S]*aiDecisionCadence\.intervalTicks[\s\S]*\)/
  );
});

test('npcStep separates brains from movement integration', () => {
  assert.match(
    indexHtml,
    /function npcStep\(dt, aiDbg = null, runAiMaintenance = true, brainDt = dt, brainPhase = 0, brainPhaseCount = 1\)/,
    'npcStep musi rozkładać mózgi na fazy'
  );

  // Mózg odpala się tylko w przydzielonej fazie i dostaje pełne dt cyklu AI.
  assert.match(indexHtml, /const npcBrainDue = phaseCount === 1 \|\| \(sepUid\(npc\) % phaseCount\) === phase/);
  assert.match(indexHtml, /if \(npcBrainDue && npc\.ai\) \{/);
  assert.match(indexHtml, /npc\.ai\(brainDt\);/);

  // Integracja ruchu MUSI zostać poza bramką — myśliwiec przy 3400 u/s przeskakuje
  // ~70 u na klatkę, a pocisk pokonuje ~16 u na podkrok: ruch raz na klatkę
  // zaczyna gubić trafienia.
  const npcStepSlice = sliceBetween(indexHtml, 'function npcStep(dt, aiDbg', 'function pirateMissionStep');
  const moveIdx = npcStepSlice.indexOf('npc.x += npc.vx * dt;');
  assert.ok(moveIdx > 0, 'npcStep musi nadal integrować pozycję krokiem fizyki');

  // Siatka AI i koordynator przebudowują się tylko na ticku mózgu.
  assert.match(npcStepSlice, /if \(runAiMaintenance\) \{[\s\S]*rebuildAIGrid/);
});

test('sensor / CIC / scan layer is gated behind runFrameLogic', () => {
  const scanSlice = sliceBetween(indexHtml, '// hover scanning', "addTiming('scanUiTime'");

  assert.match(scanSlice, /SpotterDroneSystem\.update\(frameLogicDt/);
  assert.match(scanSlice, /SensorSystem\.update\(frameLogicDt/);
  assert.match(scanSlice, /CICDisplay\.update\(frameLogicDt/);
  assert.match(scanSlice, /koniec bloku runFrameLogic/);

  // Bramka otwiera się tuż przed blokiem skanu.
  const beforeScan = indexHtml.slice(0, indexHtml.indexOf('// hover scanning'));
  assert.match(beforeScan.slice(-400), /if \(runFrameLogic\) \{/);
});

test('squad / support-wing / mission waves share the fixed AI cadence', () => {
  const aiSlice = sliceBetween(indexHtml, 'const tAiTotal0 = performance.now();', "addTiming('aiTime'");

  assert.match(aiSlice, /if \(runAiLogic\) \{[\s\S]*SQUADS\.forEach/);
  assert.match(aiSlice, /updateFighterLaunchQueue\(aiLogicDt\)/);
  assert.match(aiSlice, /updateSupportWing\(aiLogicDt\)/);
  assert.match(aiSlice, /if \(runAiLogic\) pirateMissionStep\(aiLogicDt\)/);

  // npcStep zostaje POZA bramką (ruch co podkrok), tylko z przekazanym gate'em.
  assert.match(aiSlice, /npcStep\(dt, aiDbgEnabled \? AILiveDebug : null, runAiLogic, aiLogicDt, aiBrainPhase, aiBrainPhaseCount\)/);
});

test('separation is cached on the AI decision tick and reuses its result object', () => {
  const separationSlice = sliceBetween(indexHtml, 'function applySeparationForces', 'window.applySeparationForces');

  assert.match(separationSlice, /npc\.__sepDecisionTick === aiDecisionTickId/);
  assert.match(separationSlice, /npc\.__sepResult \|\| \(npc\.__sepResult = \{ ax: 0, ay: 0 \}\)/);
  assert.doesNotMatch(separationSlice, /npc\.__sepFrame === renderFrameId/);
});

test('projectiles and the destructor stay on the physics substep', () => {
  const physicsSlice = sliceBetween(indexHtml, 'function physicsStep(dt, runFrameLogic', "addTiming('physicsTime'");

  // Pociski MUSZĄ chodzić co podkrok — inaczej tunelują.
  assert.match(physicsSlice, /DestructorSystem\.update\(dt, allDestructibles\)/);
  assert.doesNotMatch(physicsSlice, /if \(runAiLogic\)[\s\S]{0,200}DestructorSystem\.update/);
  assert.match(physicsSlice, /TowSystem\.update\(dt\)/);
  assert.match(physicsSlice, /updateMegafreighterTrains\(dt\)/);
});
