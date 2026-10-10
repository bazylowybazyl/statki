// Odpalanie i gaszenie silników MAIN (etap E2 2026-10-09, src/game/engineIgnition.js): automat stanów (WYŁ. → ZAPŁON →
// PRACA → GASZENIE), ciąg i moc strugi w każdym stanie, gorący zapłon, przerwania, model lotu NPC i siły dysz gracza
// (thrusterModel: mainScale), wylot z doku NPC (storyNpcControl — zapłon przed startem, start dopiero w PRACY), wejście
// (akcja 'ship.engines' na klawiszu 0) i klej gry w index.html (blokady skoku i szarży, autozapłon, kampania).
// node --test tests/engineIgnition.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ENGINE_OFF, ENGINE_IGNITION, ENGINE_RUNNING, ENGINE_SHUTDOWN, ENGINE_IGNITION_TUNE as T,
  createEngineIgnition, engineStateOf, engineRunning, engineThrustScale, enginePlumeScale, engineBlocksDrive,
  igniteEngine, shutdownEngine, toggleEngine, setEngineState, stepEngineIgnition, ignitionPhase, engineHudLabel,
  engineIgnitionDuration, engineSmokeFlow, engineSequenceProgress
} from '../src/game/engineIgnition.js';

const run = (e, sec, dt = 1 / 120) => { for (let t = 0; t < sec - 1e-9; t += dt) stepEngineIgnition(e, dt); };

test('automat: encja bez stanu = silniki w pracy (NPC, dema, stare zapisy)', () => {
  const e = {};
  assert.equal(engineStateOf(e), ENGINE_RUNNING);
  assert.ok(engineRunning(e));
  assert.equal(engineThrustScale(e), 1);
  assert.equal(enginePlumeScale(e), 1);
  assert.equal(engineBlocksDrive(e), false);
  assert.equal(engineHudLabel(e), null);
  stepEngineIgnition(e, 0.1);
  assert.equal(e.engineIgn, undefined, 'krok nie tworzy stanu');
});

test('automat: WYŁ. → ZAPŁON (dym, potem płomień) → PRACA; ciąg dopiero w pracy, struga od błysku', () => {
  const e = { engineIgn: createEngineIgnition(false) };
  assert.equal(engineStateOf(e), ENGINE_OFF);
  assert.equal(engineThrustScale(e), 0);
  assert.equal(enginePlumeScale(e), 0);
  assert.ok(engineBlocksDrive(e));
  assert.equal(engineHudLabel(e), 'WYŁ.');
  const s0 = e.engineIgn.serial;
  assert.ok(igniteEngine(e));
  assert.equal(engineStateOf(e), ENGINE_IGNITION);
  assert.equal(e.engineIgn.serial, s0 + 1, 'nowa sekwencja (obraz: jeden dym na przejście)');
  assert.equal(igniteEngine(e), false, 'drugi zapłon w trakcie nic nie robi');
  assert.equal(engineHudLabel(e), 'ZAPŁON');
  // dym: bez ciągu i bez strugi, przepływ gazu (pył hal) rośnie
  run(e, T.smokeTime * 0.5);
  assert.equal(ignitionPhase(e), 0);
  assert.equal(engineThrustScale(e), 0, 'w zapłonie brak ciągu głównego');
  assert.equal(enginePlumeScale(e), 0, 'przed błyskiem bez strugi');
  assert.ok(engineSmokeFlow(e) > 0.3, 'zimny gaz z dysz');
  // po błysku: struga narasta, ciąg dalej 0
  run(e, T.smokeTime * 0.5 + T.flameTime * 0.5);
  assert.equal(ignitionPhase(e), 1);
  const p = enginePlumeScale(e);
  assert.ok(p > 0.3 && p < 0.7, `struga w połowie rampy: ${p}`);
  assert.equal(engineThrustScale(e), 0);
  assert.equal(engineSmokeFlow(e), 0, 'po błysku przepływ daje struga');
  run(e, T.flameTime * 0.5 + 0.02);
  assert.equal(engineStateOf(e), ENGINE_RUNNING);
  assert.equal(engineThrustScale(e), 1);
  assert.equal(enginePlumeScale(e), 1);
  assert.ok(!engineBlocksDrive(e));
  assert.ok(Math.abs(engineIgnitionDuration() - (T.smokeTime + T.flameTime)) < 1e-12);
});

test('automat: rampa strugi i ciąg bez skoków (zapłon, praca, gaszenie)', () => {
  const e = { engineIgn: createEngineIgnition(false) };
  igniteEngine(e);
  let prev = 0, maxJump = 0;
  for (let i = 0; i < 400; i++) {
    stepEngineIgnition(e, 1 / 120);
    const p = enginePlumeScale(e);
    maxJump = Math.max(maxJump, Math.abs(p - prev));
    prev = p;
  }
  assert.equal(engineStateOf(e), ENGINE_RUNNING);
  assert.ok(maxJump < 0.03, `struga narasta płynnie: ${maxJump}`);
  shutdownEngine(e);
  assert.equal(engineHudLabel(e), 'GASZENIE');
  let pt = 1, pp = 1, jt = 0, jp = 0;
  for (let i = 0; i < 160; i++) {
    stepEngineIgnition(e, 1 / 120);
    const t = engineThrustScale(e), p = enginePlumeScale(e);
    jt = Math.max(jt, Math.abs(t - pt)); jp = Math.max(jp, Math.abs(p - pp));
    assert.ok(t <= pt + 1e-12, 'ciąg tylko spada');
    pt = t; pp = p;
  }
  assert.equal(engineStateOf(e), ENGINE_OFF);
  assert.ok(jt < 0.03 && jp < 0.03, `gaszenie płynne: ${jt} ${jp}`);
  assert.equal(engineThrustScale(e), 0);
  assert.ok(engineSequenceProgress(e) === 0);
});

test('automat: gaszenie w zapłonie (przed błyskiem — od razu WYŁ.; po błysku — od mocy strugi), gorący zapłon z gaszenia', () => {
  const a = { engineIgn: createEngineIgnition(false) };
  igniteEngine(a);
  run(a, T.smokeTime * 0.4);
  assert.ok(shutdownEngine(a));
  assert.equal(engineStateOf(a), ENGINE_OFF, 'przed błyskiem — wyłączone od razu');
  const b = { engineIgn: createEngineIgnition(false) };
  igniteEngine(b);
  run(b, T.smokeTime + T.flameTime * 0.6);
  const p0 = enginePlumeScale(b);
  shutdownEngine(b);
  assert.equal(engineStateOf(b), ENGINE_SHUTDOWN);
  assert.ok(Math.abs(enginePlumeScale(b) - p0) < 1e-9, `struga gaśnie od bieżącej mocy: ${enginePlumeScale(b)} vs ${p0}`);
  // gorący zapłon w trakcie gaszenia: bez dymu, struga wraca od mocy, na której gasła
  run(b, T.shutdownTime * 0.3);
  const p1 = enginePlumeScale(b);
  const s1 = b.engineIgn.serial;
  assert.ok(igniteEngine(b));
  assert.equal(engineStateOf(b), ENGINE_IGNITION);
  assert.ok(b.engineIgn.hot && b.engineIgn.serial === s1 + 1);
  assert.equal(ignitionPhase(b), 1, 'gorący zapłon od razu w płomieniu');
  assert.ok(Math.abs(enginePlumeScale(b) - p1) < 1e-6, 'bez skoku strugi');
  run(b, T.flameTime);
  assert.equal(engineStateOf(b), ENGINE_RUNNING);
  // przełącznik
  assert.ok(toggleEngine(b));
  assert.equal(engineStateOf(b), ENGINE_SHUTDOWN);
  assert.ok(toggleEngine(b));
  assert.equal(engineStateOf(b), ENGINE_IGNITION);
  setEngineState(b, ENGINE_OFF);
  assert.equal(engineStateOf(b), ENGINE_OFF);
  assert.equal(b.engineIgn.t, 0);
});

test('model lotu NPC: wyłączone / w zapłonie — bez ciągu do przodu; po zapłonie okręt rusza; automat kroczy w stepShipFlight', async () => {
  const { stepShipFlight, setFlightArrive, usesShipFlightModel } = await import('../src/game/flight/shipFlightModel.js');
  const e = { type: 'destroyer', mission: true, capitalProfile: {}, x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 120, mass: 1e5 };
  assert.ok(usesShipFlightModel(e), 'niszczyciel misji lata modelem lotu');
  setEngineState(e, ENGINE_OFF);
  setFlightArrive(e, 5000, 0, { arrival: 0, speedMode: 'combat' });
  for (let i = 0; i < 120; i++) stepShipFlight(e, 1 / 120);
  assert.ok(Math.abs(e.vx) < 1, `wyłączone: brak ciągu do przodu (vx ${e.vx})`);
  igniteEngine(e);
  for (let i = 0; i < 120 * (engineIgnitionDuration() - 0.1); i++) stepShipFlight(e, 1 / 120);
  assert.equal(engineStateOf(e), ENGINE_IGNITION, 'automat kroczy w modelu lotu');
  assert.ok(Math.abs(e.vx) < 1, 'w zapłonie dalej bez ciągu');
  for (let i = 0; i < 240; i++) stepShipFlight(e, 1 / 120);
  assert.equal(engineStateOf(e), ENGINE_RUNNING);
  assert.ok(e.vx > 20, `po zapłonie rusza (vx ${e.vx})`);
});

test('siły dysz (thrusterModel): mainScale 0 gasi ciąg główny i wsteczny z obwiedni, 1 = dawne siły bit w bit', async () => {
  const { computeShipThrusterForces } = await import('../src/game/flight/thrusterModel.js');
  const ship = { mass: 1000, visual: { mainThrusters: [{ __throttle: 1, nozzleDeg: 90, offset: { x: -100, y: 0 } }], torqueThrusters: [] } };
  const a = { ...computeShipThrusterForces(ship, { mainForceMul: 1, reverseInput: 0 }, {}) };
  const b = { ...computeShipThrusterForces(ship, { mainForceMul: 1, reverseInput: 0, mainScale: 1 }, {}) };
  assert.deepEqual(a, b, 'mainScale 1 — bez zmian');
  const c = computeShipThrusterForces(ship, { mainForceMul: 1, reverseInput: 0, mainScale: 0 }, {});
  assert.equal(c.localFx, 0); assert.equal(c.localFy, 0);
  const r = computeShipThrusterForces(ship, { mainForceMul: 1, reverseInput: 1, mainScale: 0 }, {});
  assert.equal(r.localFx, 0, 'wsteczny z obwiedni ciągu głównego też gaśnie');
  const h = computeShipThrusterForces(ship, { mainForceMul: 1, reverseInput: 0, mainScale: 0.5 }, {});
  assert.ok(Math.abs(Math.hypot(h.localFx, h.localFy) - 0.5 * Math.hypot(a.localFx, a.localFy)) < 1e-6);
});

test('wylot z doku NPC (storyNpcControl): zapłon przed startem, start dopiero w PRACY; bez stanu — dawny wylot', async () => {
  globalThis.window = globalThis.window || {};
  const { createStoryNpcControl } = await import('../src/game/story/storyNpcControl.js');
  let now = 0;
  const woke = [];
  const C = createStoryNpcControl({ gameTime: () => now, wake: (n) => woke.push(n) });
  const npc = { type: 'destroyer', mission: true, capitalProfile: {}, x: 0, y: 0, vx: 0, vy: 0, angle: 1.2, pos: { x: 0, y: 0 } };
  setEngineState(npc, ENGINE_OFF);
  const path = [{ x: 0, y: -600, face: 1.2, speed: 160 }, { x: 0, y: -3000 }];
  C.launch(npc, path, 5);
  assert.equal(typeof npc.ai, 'function', 'rozkaz wylotu');
  now = 1; npc.ai();
  assert.equal(engineStateOf(npc), ENGINE_OFF, 'daleko przed startem — silniki dalej wyłączone');
  now = 5 - engineIgnitionDuration() + 0.01; npc.ai();
  assert.equal(engineStateOf(npc), ENGINE_IGNITION, 'zapłon tyle przed startem, ile trwa');
  now = 5.1; npc.ai();
  assert.ok(woke.length === 0 && npc.__dockLaunching, 'start czeka na pracę silników (w zapłonie stoi w stanowisku)');
  // start bez czasu na zapłon (opóźnienie 0): czeka na PRACĘ
  const n2 = { type: 'destroyer', mission: true, capitalProfile: {}, x: 0, y: 0, vx: 0, vy: 0, angle: 0, pos: { x: 0, y: 0 } };
  setEngineState(n2, ENGINE_OFF);
  C.launch(n2, path, 0);
  now = 10; n2.ai();
  assert.equal(engineStateOf(n2), ENGINE_IGNITION, 'opóźnienie 0 — zapłon od razu');
  const src = readFileSync(new URL('../src/game/story/storyNpcControl.js', import.meta.url), 'utf8');
  assert.ok(/if \(!engineRunning\(npc\)\) \{ setFlightStop\(npc, holdFace\); return; \}/.test(src), 'start dopiero w pracy');
});

test('wejście: akcja ship.engines na klawiszu 0 (bez pada), w kolejności keydown i w GameActions', async () => {
  const A = await import('../src/input/inputActions.js');
  assert.ok(A.ACTION_BY_ID['ship.engines']);
  assert.deepEqual(A.KEYBOARD_LAYOUT['ship.engines'], ['Digit0', 'Numpad0']);
  assert.equal(A.PAD_LAYOUT['ship.engines'], null);
  assert.ok(A.KEYDOWN_ORDER.includes('ship.engines'));
  assert.deepEqual(A.buildKeydownMap().get('Digit0'), ['ship.engines'], 'klawisz 0 tylko dla silników');
});

test('klej gry (index.html): ciąg × stan silników, blokady skoku i szarży z autozapłonem, holownik, kampania, HUD', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(/mainScale: engineThrustScale\(ship\)/.test(html), 'siły dysz gracza × stan silników');
  assert.ok(/burnDef\.accel \* mainEngineFraction\(ship\) \* engineThrustScale\(ship\)/.test(html), 'szarża × stan silników');
  assert.ok(/stepPlayerEngineIgnition\(dt\);/.test(html), 'krok automatu w physicsStep');
  assert.ok(/if \(playerEnginesBlockDrive\('WARP'\)\) return;/.test(html), 'warp ręczny: autozapłon i blokada');
  assert.ok(/playerEnginesBlockDrive\(def\.label\)/.test(html), 'szarża / zryw: autozapłon i blokada');
  assert.ok(/autoIgnitePlayerEngines\('SKOK PO ROZRUCHU'\)/.test(html), 'TRAVEL TO czeka na rozruch');
  assert.ok(/'ship\.engines': \{[\s\S]{0,120}togglePlayerEngines\(\)/.test(html), 'akcja klawisza 0');
  assert.ok(/shutdownEngine\(ship\);[\s\S]{0,40}\} else \{\s*StoryGame\._block\.delete\('tug'\)/.test(html), 'na pokładzie holownika silniki gasną');
  assert.ok(/engineHudLabel\(ship\)/.test(html), 'stan silników na sylwetce nad szyną broni');
  assert.ok(/__explosions\.interiorLight = \(x, y\) => HallDust\.interiorLightAt\(x, y\)/.test(html), 'dym zapłonu w hali: światło wnętrza z pyłu hal');
  const hd = readFileSync(new URL('../src/3d/gasField/hallDust.js', import.meta.url), 'utf8');
  assert.ok(/interiorLightAt\(x, y\) \{[\s\S]{0,700}hallDomainDistance\(dom, hx, hz\) > 0\) return 0;/.test(hd), 'światło wnętrza tylko w domenie aktywnej hali');
  const story = readFileSync(new URL('../src/game/story/storyGame.js', import.meta.url), 'utf8');
  assert.ok(/setEngineState\(this\.deps\.ship\?\.\(\), ENGINE_OFF\)/.test(story), 'Atlas w doku z wyłączonymi silnikami');
  assert.ok(/s\.t >= Math\.max\(0, STORY_UNDOCK\.driveAt - ENGINE_IGNITION_TUNE\.smokeTime\)[\s\S]{0,80}igniteEngine\(this\.deps\.ship\?\.\(\)\)/.test(story),
    'zapłon smokeTime przed zwolnieniem zamków (błysk w chwili zwolnienia)');
});
