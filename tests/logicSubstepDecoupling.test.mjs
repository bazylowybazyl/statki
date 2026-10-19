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
    /function physicsStep\(dt, runFrameLogic = true, frameLogicDt = dt, runAiLogic = runFrameLogic, aiLogicDt = frameLogicDt, aiBrainPhase = 0, aiBrainPhaseCount = 1, brainTick = -1, aiMaintDone = false, frameInfoDeferred = false\)/,
    'physicsStep musi przyjmować niezależne bramki i dt dla klatki oraz AI'
  );
});

test('the loop runs UI once per frame and AI every sixth physics tick', () => {
  const loopSlice = sliceBetween(indexHtml, 'const plannedSteps = Math.min(10, Math.floor(acc / PHYS_DT));', 'physicsTickId = nextPhysicsTickId;');

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
    /function npcStep\(dt, aiDbg = null, runAiMaintenance = true, brainDt = dt, brainPhase = 0, brainPhaseCount = 1, brainTick = -1\)/,
    'npcStep musi rozkładać mózgi na fazy'
  );

  // Mózg odpala się tylko w przydzielonej fazie i dostaje pełne dt cyklu AI; policzony już dla tego kroku w klatce
  // bez kroku (blok „AI W KLATKACH BEZ KROKU”) nie liczy się drugi raz.
  assert.match(indexHtml, /const npcBrainDue = phaseCount === 1 \|\| \(sepUid\(npc\) % phaseCount\) === phase/);
  assert.match(indexHtml, /if \(npcBrainDue && npc\.ai && !\(brainTick > 0 && npc\.__brainTick === brainTick\)\) \{/);
  assert.match(indexHtml, /npc\.ai\(brainDt\);/);

  // Integracja ruchu MUSI zostać poza bramką — myśliwiec przy 3400 u/s przeskakuje
  // ~70 u na klatkę, a pocisk pokonuje ~16 u na podkrok: ruch raz na klatkę
  // zaczyna gubić trafienia.
  const npcStepSlice = sliceBetween(indexHtml, 'function npcStep(dt, aiDbg', 'function pirateMissionStep');
  const moveIdx = npcStepSlice.indexOf('npc.x += npc.vx * dt;');
  assert.ok(moveIdx > 0, 'npcStep musi nadal integrować pozycję krokiem fizyki');

  // Siatka AI i koordynator przebudowują się tylko na ticku mózgu.
  assert.match(npcStepSlice, /if \(runAiMaintenance\) layoutChanged = npcAiMaintenance\(brainDt\);/);
  const maintSlice = sliceBetween(indexHtml, 'function npcAiMaintenance(brainDt)', 'function runNpcBrain');
  assert.match(maintSlice, /rebuildAIGrid[\s\S]*updateFleetCoordinator/);
});

test('sensor / CIC / scan layer is gated behind runFrameLogic', () => {
  // Warstwa informacyjna to osobna funkcja (stepFrameInfo): w kroku tylko za bramką runFrameLogic, a od etapu 0
  // audytu fizyki odłożona do klatki bez kroku (loop()).
  const scanSlice = sliceBetween(indexHtml, 'function stepFrameInfo(frameLogicDt) {', 'koniec stepFrameInfo');
  assert.match(scanSlice, /\/\/ hover scanning/);
  assert.match(scanSlice, /SpotterDroneSystem\.update\(frameLogicDt/);
  assert.match(scanSlice, /SensorSystem\.update\(frameLogicDt/);
  assert.match(scanSlice, /CICDisplay\.update\(frameLogicDt/);

  const physicsSlice = sliceBetween(indexHtml, 'function physicsStep(dt, runFrameLogic', "addTiming('scanUiTime'");
  assert.match(physicsSlice, /if \(runFrameLogic && !frameInfoDeferred\) stepFrameInfo\(frameLogicDt\);/);
  const loopBody = sliceBetween(indexHtml, 'function loop(now) {', '// =============== Render');
  assert.match(loopBody, /steps === 0 && physicsTickId > 0 && AiOffStepTune\.enabled\) \{[\s\S]*stepFrameInfo\(_frameInfoDt\)/);
});

test('squad / support-wing / mission waves share the fixed AI cadence', () => {
  const aiSlice = sliceBetween(indexHtml, 'const tAiTotal0 = performance.now();', "addTiming('aiTime'");

  assert.match(aiSlice, /if \(runAiLogic && !aiMaintDone\) \{[\s\S]*SQUADS\.forEach/);
  assert.match(aiSlice, /updateFighterLaunchQueue\(aiLogicDt\)/);
  assert.match(aiSlice, /updateSupportWing\(aiLogicDt\)/);
  assert.match(aiSlice, /if \(runAiLogic\) pirateMissionStep\(aiLogicDt\)/);

  // npcStep zostaje POZA bramką (ruch co podkrok), tylko z przekazanym gate'em.
  assert.match(aiSlice, /npcStep\(dt, aiDbgEnabled \? AILiveDebug : null, runAiLogic && !aiMaintDone, aiLogicDt, aiBrainPhase, aiBrainPhaseCount, brainTick\)/);
});

// Etap 0 audytu fizyki (docs/AUDYT-fizyka-worker-2026-10-17.md § 6 E): praca decyzyjna kroku w klatkach bez kroku.
test('AI decisions of the next step run in frames without a physics step', () => {
  const block = sliceBetween(indexHtml, 'AI W KLATKACH BEZ KROKU (etap 0', 'let acc = 0;');
  // Tylko okręty z modelem lotu i myśliwce z pilotem — inne mózgi potrafią całkować ruch same (npcFlight.js).
  assert.match(block, /npc\.fighter \|\| usesShipFlightModel\(npc\)/);
  assert.match(block, /!npc\.command/);
  // Takt decyzji zaczyna się przed mózgami kubełka 0 (pamięć separacji po numerze taktu).
  assert.match(block, /aiDecisionTickId\+\+;[\s\S]*SQUADS\.forEach[\s\S]*npcAiMaintenance\(brainDt\)/);
  assert.match(block, /runNpcBrain\(npc, brainDt, dbg\);\s*npc\.__brainTick = tick;/);
  // Tylko w klatkach bez kroku, z budżetem, po krokach tej klatki; present() zostaje pierwszą pracą loop().
  const loopBody = sliceBetween(indexHtml, 'function loop(now) {', '// =============== Render');
  assert.match(loopBody, /steps === 0 && physicsTickId > 0 && AiOffStepTune\.enabled[\s\S]*runAiOffStep\(physicsTickId \+ 1, performance\.now\(\) \+ aiOffStepBudget\(frame, PHYS_DT - acc\)\)/);
  assert.ok(loopBody.indexOf('runAiOffStep(') > loopBody.indexOf('physicsTickId = nextPhysicsTickId;'));
  assert.ok(loopBody.indexOf('rwHost.present()') < loopBody.indexOf('physicsStep('));
  // Takt policzony poza krokiem nie liczy się drugi raz.
  assert.match(loopBody, /if \(runAiLogic && !\(aiPre && _aiOff\.maintDone\)\) \{\s*aiDecisionTickId\+\+;/);
});

test('separation is cached on the AI decision tick and reuses its result object', () => {
  const separationSlice = sliceBetween(indexHtml, 'function applySeparationForces', 'window.applySeparationForces');

  assert.match(separationSlice, /npc\.__sepDecisionTick === aiDecisionTickId/);
  assert.match(separationSlice, /npc\.__sepResult \|\| \(npc\.__sepResult = \{ ax: 0, ay: 0 \}\)/);
  assert.doesNotMatch(separationSlice, /npc\.__sepFrame === renderFrameId/);
});

test('projectiles and the destructor stay on the physics substep', () => {
  const physicsSlice = sliceBetween(indexHtml, 'function physicsStep(dt, runFrameLogic', "addTiming('physicsTime'");

  // Pociski MUSZĄ chodzić co podkrok — inaczej tunelują. Kadłuby: silnik belek (HullBodies)
  // w każdym podkroku; heksowego destruktora gra nie ładuje (etap 8, docs/PORT-silnik-belek.md).
  // (z encjami budowli — ciała świata, src/game/worldBodies.js — w tym samym kroku)
  assert.match(physicsSlice, /worldBodies\.step\(dt, _worldFocus\);/);
  assert.match(physicsSlice, /HullBodies\.step\(dt, worldBodies\.withEntities\(allDestructibles\)\)/);
  assert.doesNotMatch(physicsSlice, /DestructorSystem/);
  assert.doesNotMatch(physicsSlice, /if \(runAiLogic\)[\s\S]{0,200}HullBodies\.step/);
  assert.match(physicsSlice, /TowSystem\.update\(dt\)/);
  assert.match(physicsSlice, /updateMegafreighterTrains\(dt\)/);
});
