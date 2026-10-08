// Rzeczy niefizyczne w kroku fizyki 120 Hz (audyt 2026-10-07 § 5.4, docs/AUDYT-wydajnosc-bitwa-2026-10-07.md):
// sondy integralności gniazd tylko po zmianie struktury kadłuba, typ myśliwca bez nowych napisów,
// dźwięk trafienia w tarczę tylko w kadrze / blisko kamery i z limitem głosów. Funkcje wycięte
// z index.html (PD gracza — tests/pointDefenseTargeting.test.mjs, bramka ringu —
// tests/npcWorldCollisions.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoiceLimiter } from '../src/game/audioVoiceLimiter.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

const html = readIndexHtml();

// ---------------------------------------------------------------------------
// Integralność gniazd: sondy po zmianie struktury, chybione co takt, pełne co HARDPOINT_FULL_CHECK_SEC

const CFG = new Function(`${sliceFunction(html, 'const HARDPOINT_INTEGRITY_CONFIG = Object.freeze({')}); return HARDPOINT_INTEGRITY_CONFIG;`)();
const FULL_SEC = Number(html.match(/const HARDPOINT_FULL_CHECK_SEC = (\d+(?:\.\d+)?);/)?.[1]);
const CALL_DT = 3 / 120;   // physicsStep: co 3. krok z zakumulowanym dt

function makeIntegrity() {
  const probes = [];
  const destroyed = [];
  const unsupported = new Set();
  const scope = {
    HullBodies: { hasHull: (e) => !!e?.beamHull && !e.beamHull.body.dead && e.beamHull.body.activeNodes > 0 },
    getEntityHardpoints: (e) => e.editorHardpoints,
    HARDPOINT_INTEGRITY_CONFIG: CFG,
    HARDPOINT_FULL_CHECK_SEC: FULL_SEC,
    _hardpointProbeState: new WeakMap(),
    isHardpointHexSupported: (e, hp) => { probes.push(hp.id); return !unsupported.has(hp.id); },
    markHardpointDestroyed: (e, hp) => { hp.destroyed = true; hp.__supportMisses = 0; destroyed.push(hp.id); return true; }
  };
  const update = loadIndexFunction(html, 'function updateEntityHardpointIntegrity(entity, dt) {', 'updateEntityHardpointIntegrity', scope);
  return { update, probes, destroyed, unsupported, scope };
}

function makeHullEntity(n = 56) {
  return {
    beamHull: { body: { dead: false, activeNodes: 4000, liveBeams: 15000, _maxDisp: 0 } },
    editorHardpoints: Array.from({ length: n }, (_, i) => ({ id: 'hp' + i, x: i, y: 0 }))
  };
}

// Dawna reguła: każdy takt sonduje wszystkie gniazda — wzorzec chwil zniszczenia.
function makeOldIntegrity(unsupported, destroyed) {
  return (entity, dt) => {
    entity.__oldTimer = (Number(entity.__oldTimer) || 0) - dt;
    if (entity.__oldTimer > 0) return;
    entity.__oldTimer = CFG.probeEverySec;
    for (const hp of entity.editorHardpoints) {
      if (hp.destroyed) continue;
      if (!unsupported.has(hp.id)) { hp.__supportMisses = 0; continue; }
      hp.__supportMisses = (hp.__supportMisses | 0) + 1;
      if (hp.__supportMisses >= CFG.lostChecksToDestroy) { hp.destroyed = true; hp.__supportMisses = 0; destroyed.push(hp.id); }
    }
  };
}

test('gniazda: nietknięty kadłub — sondy przy pierwszym takcie i potem raz na HARDPOINT_FULL_CHECK_SEC', () => {
  assert.ok(FULL_SEC > 0 && FULL_SEC <= 2, `HARDPOINT_FULL_CHECK_SEC = ${FULL_SEC}`);
  const env = makeIntegrity();
  const e = makeHullEntity(56);
  const seconds = 3;
  for (let t = 0; t < seconds; t += CALL_DT) env.update(e, CALL_DT);
  const fulls = env.probes.length / 56;
  assert.equal(env.probes.length % 56, 0, 'zawsze pełne przejście');
  assert.ok(fulls >= seconds / FULL_SEC && fulls <= seconds / FULL_SEC + 1, `pełnych sprawdzeń: ${fulls}`);
  // dawniej: co takt (0,1 s przy wywołaniu co 3. krok) — 30 przejść w 3 s
  assert.ok(env.probes.length < 56 * 30 / 5, `${env.probes.length} sond zamiast ~${56 * 30}`);
  assert.equal(env.destroyed.length, 0);
});

test('gniazda: zmiana struktury (węzły, belki, wgniecenie, nowe ciało, nowa lista) — pełne sondowanie w najbliższym takcie', () => {
  const env = makeIntegrity();
  const e = makeHullEntity(10);
  const tick = () => { for (let k = 0; k < 4; k++) env.update(e, CALL_DT); };   // 4 wywołania = jeden takt sond
  tick();
  const changes = [
    () => { e.beamHull.body.activeNodes -= 3; },
    () => { e.beamHull.body.liveBeams -= 1; },
    () => { e.beamHull.body._maxDisp = 1.25; },
    () => { e.beamHull.body = { ...e.beamHull.body }; },
    () => { e.editorHardpoints = e.editorHardpoints.map((hp) => ({ ...hp })); }
  ];
  for (const change of changes) {
    env.probes.length = 0;
    tick();
    assert.equal(env.probes.length, 0, 'bez zmiany — bez sond');
    change();
    tick();
    assert.equal(env.probes.length, 10, String(change));
  }
});

test('gniazdo nad wyrwą ginie po lostChecksToDestroy chybionych sondach — tyle taktów co dawniej, bez dalszych zmian kadłuba', () => {
  const env = makeIntegrity();
  const e = makeHullEntity(12);
  const old = makeHullEntity(12);
  const oldDestroyed = [];
  const oldUpdate = makeOldIntegrity(env.unsupported, oldDestroyed);
  const at = [];
  const oldAt = [];
  let call = 0;
  const run = (calls) => {
    for (let k = 0; k < calls; k++, call++) {
      const n = env.destroyed.length, m = oldDestroyed.length;
      env.update(e, CALL_DT);
      oldUpdate(old, CALL_DT);
      if (env.destroyed.length > n) at.push([env.destroyed.at(-1), call]);
      if (oldDestroyed.length > m) oldAt.push([oldDestroyed.at(-1), call]);
    }
  };
  run(10);
  // trafienie: krater zabija węzły pod dwoma gniazdami — zmiana struktury, potem kadłub stoi
  env.unsupported.add('hp3');
  env.unsupported.add('hp7');
  e.beamHull.body.activeNodes -= 40;
  e.beamHull.body.liveBeams -= 90;
  run(40);
  assert.deepEqual(env.destroyed.sort(), ['hp3', 'hp7']);
  assert.deepEqual(at, oldAt, 'te same takty zniszczenia co przy sondowaniu wszystkiego');
  // sondy po zniszczeniu: tylko pełne sprawdzenia, zniszczone gniazda pomijane
  env.probes.length = 0;
  run(Math.round(2 * FULL_SEC / CALL_DT));
  assert.ok(env.probes.length <= 3 * 10, `${env.probes.length}`);
  assert.ok(!env.probes.includes('hp3') && !env.probes.includes('hp7'));
});

test('gniazdo wraca do podparcia (naprawa) — licznik chybień zerowany jak dawniej', () => {
  const env = makeIntegrity();
  const e = makeHullEntity(4);
  const tick = () => { for (let k = 0; k < 4; k++) env.update(e, CALL_DT); };
  tick();
  env.unsupported.add('hp1');
  e.beamHull.body.activeNodes -= 1;
  tick();
  assert.equal(e.editorHardpoints[1].__supportMisses, 1);
  env.unsupported.delete('hp1');   // wgniecenie wraca (naprawa R), struktura węzłów ta sama
  env.probes.length = 0;
  tick();
  assert.deepEqual(env.probes, ['hp1'], 'tylko chybione gniazdo');
  assert.equal(e.editorHardpoints[1].__supportMisses, 0);
  assert.equal(env.destroyed.length, 0);
  env.probes.length = 0;
  tick();
  assert.equal(env.probes.length, 0, 'nic do sondowania');
});

test('utrata podparcia bez zmiany klucza struktury — wykryta przy pełnym sprawdzeniu (zapas)', () => {
  const env = makeIntegrity();
  const e = makeHullEntity(6);
  for (let k = 0; k < 4; k++) env.update(e, CALL_DT);
  env.unsupported.add('hp2');
  let calls = 0;
  while (env.destroyed.length === 0 && calls < 200) { env.update(e, CALL_DT); calls++; }
  assert.deepEqual(env.destroyed, ['hp2']);
  assert.ok(calls * CALL_DT <= FULL_SEC + CFG.lostChecksToDestroy * 0.1 + 0.05, `${(calls * CALL_DT).toFixed(2)} s`);
});

test('gniazda: martwe, bez kadłuba albo bez gniazd — bez sond', () => {
  const env = makeIntegrity();
  const dead = makeHullEntity(3);
  dead.dead = true;
  const noHull = { editorHardpoints: [{ id: 'a' }] };
  const empty = makeHullEntity(0);
  for (let k = 0; k < 20; k++) {
    assert.equal(env.update(dead, CALL_DT), false);
    assert.equal(env.update(noHull, CALL_DT), false);
    assert.equal(env.update(empty, CALL_DT), false);
  }
  assert.equal(env.probes.length, 0);
});

// ---------------------------------------------------------------------------
// isFighterNPC: zapamiętany typ, wynik jak dawne String(type || '').toLowerCase()

function loadIsFighterNPC() {
  const decl = html.match(/const FIGHTER_NPC_TYPES = new Set\(\[[^\]]*\]\);/)?.[0];
  assert.ok(decl, 'FIGHTER_NPC_TYPES w index.html');
  const fn = sliceFunction(html, 'function isFighterNPC(npc) {');
  return new Function(`${decl}\nconst _fighterTypeMemo = new Map();\n${fn}\nreturn isFighterNPC;`)();
}

test('isFighterNPC: ten sam wynik co dawne porównanie po toLowerCase, także przy powtórzeniach', () => {
  const isFighterNPC = loadIsFighterNPC();
  const old = (npc) => {
    if (!npc) return false;
    if (npc.fighter) return true;
    const t = String(npc.type || '').toLowerCase();
    return t === 'fighter' || t === 'interceptor' || t === 'drone' || t === 'ally_fighter' || t === 'carrier_fighter';
  };
  const types = ['fighter', 'Fighter', 'INTERCEPTOR', 'drone', 'Drone ', 'ally_fighter', 'carrier_fighter', 'Carrier_Fighter',
    'bomber', 'frigate', 'pirate_supercapital', '', undefined, null, 0, 7, new String('Drone'), 'fighterK'];
  const cases = [null, undefined, {}, { fighter: true }, { fighter: 1, type: 'frigate' }, ...types.map((type) => ({ type }))];
  for (let pass = 0; pass < 3; pass++) {
    for (const npc of cases) assert.equal(isFighterNPC(npc), old(npc), JSON.stringify(npc));
  }
  for (let i = 0; i < 600; i++) assert.equal(isFighterNPC({ type: `t${i}` }), false);
  assert.equal(isFighterNPC({ type: 'Interceptor' }), true, 'po wyczyszczeniu pamięci dalej poprawnie');
});

// ---------------------------------------------------------------------------
// Dźwięk trafienia w tarczę: tylko w kadrze albo blisko kamery, przez limit głosów strzałów

function makeShieldAudio({ inFrame = () => false } = {}) {
  const sources = [];
  const now = { ms: 1000 };
  const shotVoiceLimiter = createVoiceLimiter();
  const scope = {
    camera: { x: 0, y: 0 },
    impactFxScreenPx: (x, y, size) => (inFrame(x, y) ? size : 0),
    shotVoiceLimiter,
    performance: { now: () => now.ms },
    fxRandom: { next: () => { throw new Error('dźwięk tarczy nie losuje z fxRandom'); } },
    OPTIONS: { audio: { sfx: 1 } },
    window: {
      AudioSys: {
        masterGain: {},
        sounds: { shieldHit: { duration: 0.6 } },
        ctx: {
          createBufferSource: () => { const s = { playbackRate: { value: 1 }, connect() {}, start() { sources.push(s); } }; return s; },
          createGain: () => ({ gain: { value: 0 }, connect() {} })
        }
      }
    }
  };
  scope.playDynamicSound = loadIndexFunction(html, "function playDynamicSound(soundKey, x, y, pitchVar = 0, volume = 1.0) {", 'playDynamicSound', scope);
  const play = loadIndexFunction(html, 'function playShieldHitSound(x, y) {', 'playShieldHitSound', scope);
  return { play, sources, now, scope };
}

test('dźwięk tarczy: trafienie poza kadrem i daleko od kamery — cisza; w kadrze albo blisko — gra', () => {
  const env = makeShieldAudio({ inFrame: (x) => Math.abs(x) < 9000 });
  env.play(50000, 0);
  assert.equal(env.sources.length, 0, 'poza kadrem, 50 km od kamery');
  env.now.ms += 100;
  env.play(1500, 900);
  assert.equal(env.sources.length, 1, 'w kadrze');
  env.now.ms += 100;
  const near = makeShieldAudio({ inFrame: () => false });
  near.play(1200, 1200);
  assert.equal(near.sources.length, 1, 'tuż za brzegiem kadru, blisko kamery');
  near.now.ms += 100;
  near.play(5000, 0);
  assert.equal(near.sources.length, 1, 'poza kadrem i dalej niż pełna głośność — cisza');
});

test('dźwięk tarczy: setki trafień w kadrze w jednej chwili — najwyżej limit głosów', () => {
  const env = makeShieldAudio({ inFrame: () => true });
  for (let i = 0; i < 500; i++) env.play(i, 0);
  assert.equal(env.sources.length, 1, 'jeden start na okno minIntervalMs');
  // seria przez 2 s co 1 ms: starty co ≥ minIntervalMs, równocześnie ≤ maxVoicesPerKey
  for (let i = 0; i < 2000; i++) { env.now.ms += 1; env.play(0, 0); }
  const { minIntervalMs, maxVoicesPerKey } = env.scope.shotVoiceLimiter.limits;
  assert.ok(env.sources.length <= 1 + 2000 / minIntervalMs, `${env.sources.length}`);
  assert.ok(env.scope.shotVoiceLimiter.activeVoices('shieldHit', env.now.ms) <= maxVoicesPerKey);
});

test('pętla pocisków: trafienie w tarczę gra przez playShieldHitSound, bez AudioSys.playSound', () => {
  const step = sliceFunction(html, 'function bulletsAndCollisionsStep(dt, emitTrails = true, trailDt = dt) {');
  assert.match(step, /if \(window\.AudioSys\) playShieldHitSound\(hitX, hitY\);/);
  assert.doesNotMatch(step, /playSound\('shieldHit'\)/);
});
