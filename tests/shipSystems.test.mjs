import test from 'node:test';
import assert from 'node:assert/strict';

// Systemy okrętu pod F — „specjale F” (decyzje użytkownika 2026-10-08): dane i wybór (src/data/shipSystems.js),
// stan i manewr (src/game/shipSystem.js), użycie przez AI (src/ai/npcShipSystem.js), mnożniki dopalacza w modelu
// lotu NPC (src/game/flight/shipFlightModel.js).
globalThis.window = globalThis.window || {};
const {
  SHIP_SYSTEMS, HULL_SHIP_SYSTEMS, NPC_SHIP_SYSTEM_IDS, shipSystemFor, shipSystemOptionsFor, shipSystemDefFor,
  shipSystemHullKey, shipSystemKeyOfEntity, npcShipSystemFor
} = await import('../src/data/shipSystems.js');
const {
  createShipSystemState, bindShipSystem, shipSystemReady, startShipSystemBurst, stopShipSystem, stepShipSystem,
  shipSystemActive, shipSystemFireRateMul, shipSystemMainBoost, shipSystemGauge, SYS_END, SYS_READY, SYS_CHARGE,
  maneuverJumpPeak, maneuverJumpSpeed, maneuverJumpPhase, startManeuverJump, stepManeuverJump,
  maneuverFacingOffset, maneuverTurnDelta, startManeuverTurn, stepManeuverTurn, wrapSysAngle
} = await import('../src/game/shipSystem.js');
const {
  NPC_SYSTEM_AI, npcShipSystemDef, npcHasEngineBurst, npcFireRateMul, npcWantsRapidFire, npcWantsEngineBurst,
  stepNpcShipSystem
} = await import('../src/ai/npcShipSystem.js');
const { getFlightIntent, setFlightArrive, stepShipFlight, resolveShipFlightSpec } = await import('../src/game/flight/shipFlightModel.js');

const DT = 1 / 120;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Dane: który kadłub co ma

test('systemy F wg frakcji: Atlas — szarża albo manewr, Terra Nova — zryw, piraci — szybki ogień', () => {
  assert.deepEqual(shipSystemOptionsFor('atlas').map((d) => d.id), ['ram_burn', 'maneuver']);
  for (const hull of ['frigate', 'destroyer', 'battleship', 'carrier']) {
    assert.equal(shipSystemFor(hull).id, 'engine_burst', hull);
  }
  for (const hull of ['pirate_frigate', 'pirate_destroyer', 'pirate_supercapital']) {
    assert.equal(shipSystemFor(hull).id, 'rapid_fire', hull);
  }
  // Decyzja użytkownika: Iron Skull i Colossus wg frakcji, szarża zostaje im jako druga opcja.
  assert.deepEqual(shipSystemOptionsFor('pirate_battleship').map((d) => d.id), ['rapid_fire', 'ram_burn']);
  assert.deepEqual(shipSystemOptionsFor('supercapital').map((d) => d.id), ['engine_burst', 'ram_burn']);
  // Kadłuby bez systemu (F = rakieta): Corvus, megafrachtowiec, nieznane.
  assert.equal(shipSystemFor('corvus'), null);
  assert.equal(shipSystemFor('megafreighter'), null);
  assert.equal(shipSystemFor(''), null);
  assert.deepEqual(shipSystemOptionsFor('container_ship'), []);
  // Zgodność wstecz: SHIP_SYSTEMS[kadłub] = system domyślny (szarża Atlasa 3000 j/s).
  assert.equal(SHIP_SYSTEMS.atlas.id, 'ram_burn');
  assert.equal(SHIP_SYSTEMS.atlas.speed, 3000);
  for (const [hull, list] of Object.entries(HULL_SHIP_SYSTEMS)) {
    assert.equal(SHIP_SYSTEMS[hull], list[0]);
    for (const d of list) {
      assert.ok(d.label && d.short && d.icon && d.desc, `${hull}/${d.id}: etykiety`);
      if (d.id === 'maneuver') {
        assert.ok(d.charges >= 1 && d.recharge > 0 && d.jumpTime > 0 && d.turnRate > 0 && d.turnAccel > 0);
      } else {
        assert.ok(d.duration > 0 && d.recharge > d.duration, `${hull}/${d.id}: ładowanie dłuższe niż działanie`);
      }
      if (d.id === 'engine_burst') assert.ok(d.speedMul > 1 && d.thrustMul > 1 && d.brake > 0);
      if (d.id === 'rapid_fire') assert.ok(d.fireRateMul >= 1.5 && d.fireRateMul <= 2);
    }
  }
});

test('profil renderu NPC i id kadłuba gracza dają ten sam system; wybór tylko z listy kadłuba', () => {
  assert.equal(shipSystemHullKey('terran_frigate'), 'frigate');
  assert.equal(shipSystemHullKey('TERRAN_SUPERCAPITAL'), 'supercapital');
  assert.equal(shipSystemHullKey('capital_carrier'), 'carrier');
  assert.equal(shipSystemFor('terran_battleship'), shipSystemFor('battleship'));
  assert.equal(shipSystemDefFor('atlas', 'maneuver').id, 'maneuver');
  assert.equal(shipSystemDefFor('atlas'), shipSystemFor('atlas'));
  assert.equal(shipSystemDefFor('atlas', 'rapid_fire'), null, 'Atlas nie ma szybkiego ognia');
  assert.equal(shipSystemDefFor('frigate', 'ram_burn'), null);
  assert.equal(shipSystemDefFor('corvus', 'ram_burn'), null);
});

test('system NPC: rama albo typ i strona; myśliwce, frachtowce, furgony i Atlas-NPC bez systemu', () => {
  assert.equal(npcShipSystemFor({ type: 'frigate_pd', isPirate: true }).id, 'rapid_fire');
  assert.equal(npcShipSystemFor({ type: 'frigate_laser' }).id, 'engine_burst');
  assert.equal(npcShipSystemFor({ type: 'destroyer', shipFrame: 'pirate_destroyer' }).id, 'rapid_fire');
  assert.equal(npcShipSystemFor({ type: 'battleship', shipFrame: 'terran_battleship' }).id, 'engine_burst');
  assert.equal(npcShipSystemFor({ type: 'pirate_supercapital' }).id, 'rapid_fire');
  assert.equal(npcShipSystemFor({ type: 'supercapital', shipFrame: 'terran_supercapital' }).id, 'engine_burst');
  assert.equal(npcShipSystemFor({ type: 'carrier' }).id, 'engine_burst');
  assert.equal(npcShipSystemFor({ type: 'fighter' }), null);
  assert.equal(npcShipSystemFor({ type: 'freighter-small', shipFrame: 'terran_frigate', isCargoVan: true }), null);
  assert.equal(npcShipSystemFor({ type: 'freighter-medium', shipFrame: 'container_ship' }), null);
  assert.equal(npcShipSystemFor({ type: 'megafreighter_front', shipFrame: 'megafreighter' }), null);
  assert.equal(npcShipSystemFor({ type: 'atlas', shipFrame: 'atlas' }), null, 'szarży i manewru AI nie używa');
  // Wybór encji (np. przyszłe fitowanie NPC): Iron Skull z szarżą — AI jej nie używa, więc bez systemu.
  assert.equal(npcShipSystemFor({ type: 'battleship', shipFrame: 'pirate_battleship', shipSystemId: 'ram_burn' }), null);
  assert.equal(shipSystemKeyOfEntity({ type: 'battleship', isPirate: true }), 'pirate_battleship');
  assert.ok(NPC_SHIP_SYSTEM_IDS.includes('engine_burst') && NPC_SHIP_SYSTEM_IDS.includes('rapid_fire'));
});

// ---------------------------------------------------------------------------
// Stan: zryw silników i szybki ogień (semantyka szarży)

test('zryw i szybki ogień: start z pełnego, działanie przez duration, ładowanie od zera, mnożniki tylko w toku', () => {
  for (const def of [shipSystemFor('frigate'), shipSystemFor('pirate_destroyer')]) {
    const st = createShipSystemState();
    assert.equal(bindShipSystem(st, def), true);
    assert.equal(bindShipSystem(st, def), false, 'ta sama definicja — bez resetu');
    assert.equal(shipSystemReady(st, def), true);
    assert.equal(shipSystemFireRateMul(st, def), 1);
    assert.equal(startShipSystemBurst(st, def), true);
    assert.equal(startShipSystemBurst(st, def), false, 'już działa');
    assert.equal(shipSystemActive(st), true);
    if (def.id === 'rapid_fire') {
      assert.equal(shipSystemFireRateMul(st, def), def.fireRateMul);
      assert.equal(shipSystemMainBoost(st, def), false, 'szybki ogień nie pali dopalacza');
    } else {
      assert.equal(shipSystemFireRateMul(st, def), 1);
      assert.equal(shipSystemMainBoost(st, def), true);
    }
    let ends = 0;
    for (let i = 0; i < (def.duration + 0.05) / DT; i++) if (stepShipSystem(st, def, DT) === SYS_END) ends++;
    assert.equal(ends, 1);
    assert.equal(st.active, false);
    assert.equal(shipSystemFireRateMul(st, def), 1);
    assert.equal(shipSystemReady(st, def), false);
    assert.ok(shipSystemGauge(st, def) < 0.02);
    let ready = 0;
    for (let i = 0; i < (def.recharge + 0.05) / DT; i++) if (stepShipSystem(st, def, DT) === SYS_READY) ready++;
    assert.equal(ready, 1);
    assert.equal(shipSystemReady(st, def), true);
    // Przerwanie nie zwraca ładunku; zmiana kadłuba (inna definicja) — system pełny.
    startShipSystemBurst(st, def);
    stepShipSystem(st, def, 1);
    assert.equal(stopShipSystem(st), true);
    assert.equal(shipSystemReady(st, def), false);
    assert.equal(bindShipSystem(st, shipSystemFor('atlas')), true);
    assert.equal(shipSystemReady(st, shipSystemFor('atlas')), true);
  }
});

// ---------------------------------------------------------------------------
// Manewr: ładunki, skok, obrót

test('manewr: 2 ładunki, odnawiane po kolei co recharge s', () => {
  const def = shipSystemDefFor('atlas', 'maneuver');
  const st = createShipSystemState();
  bindShipSystem(st, def);
  assert.equal(st.charges, def.charges);
  assert.equal(startManeuverJump(st, def, 0, 1, 1800, 0), true);
  assert.equal(startManeuverJump(st, def, 0, 1, 1800, 0), false, 'jedna akcja naraz');
  st.action = '';
  assert.equal(startManeuverTurn(st, def, 1, 0, Math.PI / 2), true);
  st.action = '';
  assert.equal(st.charges, 0);
  assert.equal(shipSystemReady(st, def), false);
  const events = [];
  for (let i = 0; i < (2 * def.recharge + 0.1) / DT; i++) {
    const ev = stepShipSystem(st, def, DT);
    if (ev) events.push([ev, Math.round(i * DT * 10) / 10]);
  }
  assert.deepEqual(events.map((e) => e[0]), [SYS_CHARGE, SYS_READY]);
  assert.ok(Math.abs(events[0][1] - def.recharge) < 0.05 && Math.abs(events[1][1] - 2 * def.recharge) < 0.05, JSON.stringify(events));
  assert.equal(st.charges, def.charges);
  assert.equal(shipSystemGauge(st, def), 1);
});

test('manewr — skok: przesunięcie = jumpHullFrac × długość kadłuba w jumpTime, prędkość boczna wraca do bazowej', () => {
  const def = shipSystemDefFor('atlas', 'maneuver');
  const hull = 1800;
  for (const base of [0, 140, -260]) {
    const st = createShipSystemState();
    bindShipSystem(st, def);
    assert.equal(startManeuverJump(st, def, 3, 4, hull, base), true);
    assert.ok(Math.abs(st.jumpDirX - 0.6) < 1e-12 && Math.abs(st.jumpDirY - 0.8) < 1e-12, 'kierunek znormalizowany');
    let v = base;
    let s = 0;
    let t = 0;
    let phases = '';
    while (st.action === 'jump' && t < 5) {
      const ph = maneuverJumpPhase(st) > 0 ? 'k' : 'b';
      if (!phases.endsWith(ph)) phases += ph;
      const w = stepManeuverJump(st, DT, v, 1e9);
      assert.ok(w === w);
      v = w;
      s += (v - base) * DT;
      t += DT;
    }
    assert.equal(phases, 'kb', 'najpierw wybicie, potem hamowanie');
    assert.ok(Math.abs(s - hull * def.jumpHullFrac) < 3, `przesunięcie ${s}`);
    assert.ok(Math.abs(t - def.jumpTime) < 2 * DT, `czas ${t}`);
    assert.equal(v, base);
    assert.equal(st.jumpAborted, false);
  }
  // Profil: wybicie najostrzejsze na starcie, szczyt na końcu wybicia, łagodne zero na końcu.
  const peak = maneuverJumpPeak(900, 1.1, 0.3);
  assert.ok(Math.abs(maneuverJumpSpeed(0.33, 1.1, 0.3, peak) - peak) < 1e-9);
  assert.equal(maneuverJumpSpeed(1.1, 1.1, 0.3, peak), 0);
  assert.ok(maneuverJumpSpeed(1.09, 1.1, 0.3, peak) < peak * 0.001);
});

test('manewr — skok: obcy impuls boczny (zderzenie) zrywa skok', () => {
  const def = shipSystemDefFor('atlas', 'maneuver');
  const st = createShipSystemState();
  bindShipSystem(st, def);
  startManeuverJump(st, def, 1, 0, 1800, 0);
  let v = 0;
  for (let i = 0; i < 30; i++) v = stepManeuverJump(st, DT, v, 150);
  assert.equal(st.action, 'jump');
  assert.ok(Number.isNaN(stepManeuverJump(st, DT, v - 600, 150)), 'ściana zatrzymała okręt');
  assert.equal(st.action, '');
  assert.equal(st.jumpAborted, true);
});

// Symulacja obrotu manewru: obrót kadłuba przez prędkość kątową z kroku, cel (namiar) może się obracać.
function runTurn(def, dir, angle0, aim0, aimRate = 0, seconds = 8) {
  const st = createShipSystemState();
  bindShipSystem(st, def);
  let angle = angle0;
  let omega = 0;
  let aim = aim0;
  assert.equal(startManeuverTurn(st, def, dir, angle, aim), true);
  const startLeft = st.turnLeft;
  let t = 0;
  let maxOmega = 0;
  let travel = 0;
  while (st.action === 'turn' && t < seconds) {
    aim = wrapSysAngle(aim + aimRate * DT);
    const w = stepManeuverTurn(st, def, DT, angle, aim);
    omega = w;
    maxOmega = Math.max(maxOmega, Math.abs(omega));
    angle = wrapSysAngle(angle + omega * DT);
    travel += omega * DT;
    t += DT;
  }
  return { t, err: Math.abs(wrapSysAngle(aim - angle)), omega, maxOmega, travel, startLeft, st };
}

test('manewr — obrót: 90° i 180° w czasie z profilu, kończy się na kursie z zerową prędkością kątową', () => {
  const def = shipSystemDefFor('atlas', 'maneuver');
  const q = runTurn(def, 0, 0, Math.PI / 2);
  assert.equal(q.st.action, '');
  assert.ok(q.err < 1 * DEG, `błąd ${q.err / DEG}°`);
  assert.equal(q.omega, 0);
  assert.ok(q.t > 1.2 && q.t < 2.4, `90° w ${q.t} s`);
  assert.ok(q.maxOmega <= def.turnRate * DEG + 1e-9);
  const h = runTurn(def, 0, 0, Math.PI - 0.01);
  assert.ok(h.t > 2.2 && h.t < 3.6, `180° w ${h.t} s`);
  // Zwykły obrót Atlasa (18°/s) — 90° w ~5 s: manewr ma być kilka razy szybszy.
  assert.ok(q.t < 90 / 18 / 2);
});

test('manewr — obrót ma własną prędkość kątową: limit obrotu napędu (gra przycina angVel przed manewrem) go nie dławi', () => {
  // physicsStep: ω += moment dysz, ω = clamp(ω, ±limit napędu 18°/s), potem applyPlayerManeuver. Pierwsza wersja
  // brała przycięte ω za start profilu — obrót szedł 19°/s (pomiar w grze: 90° w 4,7 s).
  const def = shipSystemDefFor('atlas', 'maneuver');
  const st = createShipSystemState();
  bindShipSystem(st, def);
  const lim = 18 * DEG;
  let angle = 0;
  let angVel = 0;
  assert.equal(startManeuverTurn(st, def, 1, angle, Math.PI / 2, 0, angVel), true);
  let t = 0;
  let wMax = 0;
  while (st.action === 'turn' && t < 8) {
    angVel = Math.max(-lim, Math.min(lim, angVel));   // limit napędu przed manewrem
    const w = stepManeuverTurn(st, def, DT, angle, Math.PI / 2);
    angVel = w;
    wMax = Math.max(wMax, Math.abs(w));
    angle += angVel * DT;
    t += DT;
  }
  assert.ok(t < 2.4, `90° w ${t} s`);
  assert.ok(wMax > 60 * DEG, `szczyt ${wMax / DEG}°/s`);
  assert.ok(Math.abs(wrapSysAngle(Math.PI / 2 - angle)) < 1 * DEG);
});

test('manewr — obrót w zadaną stronę: A przy celu po prawej to obrót przez lewą (prawie pełny), D — krótki', () => {
  const def = shipSystemDefFor('atlas', 'maneuver');
  const aim = 40 * DEG;
  assert.ok(Math.abs(maneuverTurnDelta(0, aim, 1) - aim) < 1e-12);
  assert.ok(Math.abs(maneuverTurnDelta(0, aim, -1) - (2 * Math.PI - aim)) < 1e-12);
  assert.ok(Math.abs(maneuverTurnDelta(0, aim, 0) - aim) < 1e-12);
  const right = runTurn(def, 1, 0, aim);
  const left = runTurn(def, -1, 0, aim);
  assert.ok(right.travel > 0 && Math.abs(right.travel - aim) < 1 * DEG, `D: ${right.travel / DEG}°`);
  assert.ok(left.travel < 0 && Math.abs(-left.travel - (2 * Math.PI - aim)) < 1 * DEG, `A: ${left.travel / DEG}°`);
  assert.ok(left.err < 1 * DEG && left.t < def.turnTimeout);
});

test('manewr — obrót goni ruchomy cel i nie przeskakuje o pełny obrót przez dziób', () => {
  const def = shipSystemDefFor('atlas', 'maneuver');
  // Cel ucieka w stronę obrotu (15°/s) — obrót dłuższy, ale kończy się na celu.
  const chase = runTurn(def, 1, 0, 60 * DEG, 15 * DEG);
  assert.ok(chase.err < 1 * DEG, `błąd ${chase.err / DEG}°`);
  assert.ok(chase.travel > 60 * DEG && chase.travel < 120 * DEG, `obrót ${chase.travel / DEG}°`);
  // Cel wychodzi naprzeciw (−20°/s): obrót krótszy, bez dobijania o 360°.
  const meet = runTurn(def, 1, 0, 60 * DEG, -20 * DEG);
  assert.ok(meet.err < 1 * DEG);
  assert.ok(meet.travel > 0 && meet.travel < 60 * DEG, `obrót ${meet.travel / DEG}°`);
  // Cel szybszy niż obrót manewru — limit czasu kończy obrót.
  const lost = runTurn(def, 1, 0, 90 * DEG, 120 * DEG, 20);
  assert.equal(lost.st.action, '');
  assert.ok(lost.t <= def.turnTimeout + 2 * DT);
});

test('manewr — wybór burty: dziób przy prawie równym pokryciu, burta przy dział na jednej burcie', () => {
  const out = { offset: 0, count: 0, symmetric: false };
  const half = Math.PI / 2;
  // Atlas-podobny: działa na obu burtach i dziobie (łuki 180°) — dziób.
  const bow = Float64Array.from([0, half, half, half, -half, half, Math.PI / 4, half, -Math.PI / 4, half]);
  maneuverFacingOffset(bow, 5, 0.75, out);
  assert.equal(out.offset, 0);
  // Same działa prawej burty — cel na prawym trawersie (namiar +90°).
  const starboard = Float64Array.from([half, half * 0.5, half, half * 0.5, half, half * 0.5]);
  maneuverFacingOffset(starboard, 3, 0.75, out);
  assert.ok(Math.abs(out.offset - half) <= 46 * DEG, `namiar ${out.offset / DEG}°`);
  assert.equal(out.count, 3);
  assert.equal(out.symmetric, false);
  // Dwie baterie burtowe, dziób pusty — burta, układ symetryczny.
  const broadside = Float64Array.from([half, 0.6, half, 0.6, -half, 0.6, -half, 0.6]);
  maneuverFacingOffset(broadside, 4, 0.75, out);
  assert.ok(Math.abs(Math.abs(out.offset) - half) <= 35 * DEG, `namiar ${out.offset / DEG}°`);
  assert.equal(out.symmetric, true);
});

// ---------------------------------------------------------------------------
// AI: kiedy NPC sięga po system

function piratePlatform(targetAt, opts = {}) {
  const target = { x: targetAt, y: 0, radius: 120, type: 'frigate' };
  const gun = (mountAngle, cachedTarget) => ({
    group: 'main', pd: false, ammo: null, mountAngle, arc: Math.PI / 2 + 0.12,
    def: { baseRange: 4000 }, cachedTarget, hpOffset: { destroyed: false }
  });
  return {
    npc: {
      x: 0, y: 0, angle: 0, type: 'destroyer', isPirate: true, shipFrame: 'pirate_destroyer', mission: true,
      autoWeapons: [gun(0, target), gun(0, target), gun(0, 'third' in opts ? opts.third : target),
        { group: 'aux', pd: true, mountAngle: 0, arc: 7, def: { baseRange: 1200 }, cachedTarget: target }]
    },
    target
  };
}

test('AI szybki ogień: dość dział z celem w zasięgu i łuku; maskowany cel, pocisk i dalekie cele nie liczą się', () => {
  const near = piratePlatform(2500);
  assert.equal(npcWantsRapidFire(near.npc), true);
  assert.equal(npcWantsRapidFire(piratePlatform(6000).npc), false, 'poza zasięgiem');
  const behind = piratePlatform(-2500);
  assert.equal(npcWantsRapidFire(behind.npc), false, 'cel za rufą — poza łukiem dział dziobowych');
  const one = piratePlatform(2500, { third: null });
  one.npc.autoWeapons[1].cachedTarget = null;
  assert.equal(npcWantsRapidFire(one.npc), false, '1 z 3 dział — za mało');
  const cloaked = piratePlatform(2500);
  cloaked.target.cloak = { state: 'on' };
  assert.equal(npcWantsRapidFire(cloaked.npc), false, 'maskowany gracz nie jest powodem');
  const rocket = piratePlatform(2500);
  rocket.target.type = 'rocket';
  assert.equal(npcWantsRapidFire(rocket.npc), false);
});

test('AI szybki ogień: krok systemu po rapidHold, mnożnik przeładowania w toku, potem chłodzenie', () => {
  const { npc } = piratePlatform(2500);
  const def = npcShipSystemDef(npc);
  assert.equal(def.id, 'rapid_fire');
  assert.equal(npcHasEngineBurst(npc), false);
  const brain = 1 / 20;
  const gun = npc.autoWeapons[0];
  const pd = npc.autoWeapons[3];
  let t = 0;
  while (npcFireRateMul(npc) === 1 && t < 2) {
    gun.cd = 1;   // przeładowanie w toku (capitalAI odlicza je co takt — tu stoi)
    pd.cd = 0.5;
    stepNpcShipSystem(npc, brain);
    t += brain;
  }
  assert.ok(Math.abs(t - NPC_SYSTEM_AI.rapidHold) < brain * 1.5, `start po ${t} s`);
  assert.equal(npcFireRateMul(npc), def.fireRateMul);
  // Kontrakt z fitowaniem: szybki ogień = źródło 'system' modyfikatorów okrętu, fireRate mnoży przeładowanie
  // (capitalAI: cooldown × modifiers.fireRate po strzale), przeładowania w toku przeliczone od razu.
  assert.ok(Math.abs(npc.modifiers.fireRate - 1 / def.fireRateMul) < 1e-12);
  assert.ok(Math.abs(gun.cd - 1 / def.fireRateMul) < 1e-12, `przeładowanie w toku ${gun.cd}`);
  assert.ok(Math.abs(pd.cd - 0.5 / def.fireRateMul) < 1e-12, 'cała broń okrętu');
  gun.cd = 0.4;
  for (let i = 0; i < Math.ceil(def.duration / brain) + 1; i++) stepNpcShipSystem(npc, brain);
  assert.equal(npcFireRateMul(npc), 1);
  assert.equal(npc.modifiers.fireRate, 1);
  assert.ok(Math.abs(gun.cd - 0.4 * def.fireRateMul) < 1e-9, 'koniec szybkiego ognia wydłuża przeładowanie w toku z powrotem');
  assert.equal(shipSystemReady(npc.__fSys, def), false, 'chłodzenie');
  // Uśpiony (misja) — system gaśnie i nie rusza.
  npc.__fSys.charge = 1;
  npc.combatDisabled = true;
  for (let i = 0; i < 40; i++) stepNpcShipSystem(npc, brain);
  assert.equal(npcFireRateMul(npc), 1);
});

function terranCruiser(dest, opts = {}) {
  const npc = {
    x: 0, y: 0, vx: 0, vy: 0, angle: opts.angle ?? 0, angVel: 0, type: 'battleship', shipFrame: 'terran_battleship',
    mission: true, radius: 220, target: opts.target || null,
    autoWeapons: [{ group: 'main', pd: false, mountAngle: 0, arc: 1.7, def: { baseRange: 4500 } }]
  };
  setFlightArrive(npc, dest.x, dest.y, { arrival: 0, speedMode: 'cruise', approachCap: opts.cap });
  return npc;
}

test('AI zryw silników: daleki punkt dziobem do przodu; nie w walce, nie w bok, nie przed przeszkodą', () => {
  const def = shipSystemFor('battleship');
  assert.equal(npcWantsEngineBurst(terranCruiser({ x: 9000, y: 0 }), def), true);
  assert.equal(npcWantsEngineBurst(terranCruiser({ x: 1500, y: 0 }), def), false, 'blisko');
  assert.equal(npcWantsEngineBurst(terranCruiser({ x: 0, y: 9000 }), def), false, 'punkt w bok — najpierw obrót');
  const fight = terranCruiser({ x: 9000, y: 0 }, { target: { x: 4000, y: 0, radius: 200 } });
  assert.equal(npcWantsEngineBurst(fight, def), false, 'cel w zasięgu dział');
  const far = terranCruiser({ x: 9000, y: 0 }, { target: { x: 12000, y: 0, radius: 200 } });
  assert.equal(npcWantsEngineBurst(far, def), true, 'cel poza zasięgiem — dolot');
  fight.__fleeing = true;
  assert.equal(npcWantsEngineBurst(fight, def), true, 'ucieczka');
  const cloaked = terranCruiser({ x: 9000, y: 0 }, { target: { x: 4000, y: 0, radius: 200, cloak: { state: 'on' } } });
  assert.equal(npcWantsEngineBurst(cloaked, def), true, 'maskowany cel nie trzyma okrętu w walce');
  assert.equal(npcWantsEngineBurst(terranCruiser({ x: 9000, y: 0 }, { cap: 100 }), def), false, 'przeszkoda na kursie');
});

test('AI zryw silników: dopalacz w intencji lotu z mnożnikami systemu — okręt szybszy o speedMul, potem wraca', () => {
  const npc = terranCruiser({ x: 60000, y: 0 });
  const def = npcShipSystemDef(npc);
  assert.equal(def.id, 'engine_burst');
  assert.equal(npcHasEngineBurst(npc), true);
  const spec = resolveShipFlightSpec(npc);
  const brainDt = 1 / 20;
  let brainT = 0;
  let maxSpeed = 0;
  let boosted = 0;
  for (let i = 0; i < 20 / DT; i++) {
    brainT -= DT;
    if (brainT <= 0) {
      brainT += brainDt;
      // Mózg odświeża intencję jak capitalArriveControls (dopalacz zostaje — ustawia go system F).
      setFlightArrive(npc, 60000, 0, { arrival: 0, speedMode: 'combat' });
      stepNpcShipSystem(npc, brainDt);
    }
    stepShipFlight(npc, DT);
    if (npc.__fSysBoost) boosted += DT;
    maxSpeed = Math.max(maxSpeed, Math.hypot(npc.vx, npc.vy));
  }
  assert.ok(Math.abs(boosted - def.duration) < 0.2, `zryw ${boosted} s`);
  assert.ok(maxSpeed > spec.maxSpeed * (def.speedMul - 0.15), `prędkość ${maxSpeed} / limit ${spec.maxSpeed}`);
  assert.ok(maxSpeed <= spec.maxSpeed * def.speedMul + 1);
  const it = getFlightIntent(npc);
  assert.equal(it.boost, false, 'po zrywie dopalacz zgaszony');
  assert.equal(it.boostSpeedMul, 0);
  assert.ok(Math.hypot(npc.vx, npc.vy) <= spec.maxSpeed + 1, 'regulator wraca do prędkości bojowej');
});
