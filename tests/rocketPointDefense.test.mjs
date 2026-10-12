// Obrona punktowa kontra rakiety 3D (2026-10-12): rakiety z src/effects3d/rocketSystem3D.js są celami CIWS,
// lasera PD i flaku gracza i NPC (zastępniki w buforach zagrożeń — syncThreats), zestrzelenie = intercept
// (bez detonacji głowicy). Trafienie pocisku CIWS na odcinku kroku w ruchu względnym — src/game/rocketIntercept.js.
// node --test tests/rocketPointDefense.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { ciwsShotHitsRocket, ciwsRocketReach } from '../src/game/rocketIntercept.js';
import { loadIndexFunction } from './helpers/indexSource.mjs';

globalThis.window = globalThis.window ?? {};
const { initRocketSystem3D, LAUNCH_ELEVATED, ROCKET_PD_TUNE } = await import('../src/effects3d/rocketSystem3D.js');
const { SimClock } = await import('../src/game/simClock.js');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Atrapa reżysera efektów: liczy zdarzenia (lot bez obrazu).
const events = { intercept: 0, detonate: 0, split: 0 };
const fxStub = {
  onLaunch() {}, onIgnite() {}, onFly() {}, prepareContact() {}, update() {},
  onSplit() { events.split++; },
  onDetonate() { events.detonate++; },
  onIntercept() { events.intercept++; }
};
const system = initRocketSystem3D(new THREE.Scene(), { effects: fxStub });
const active = () => system.rockets.filter((r) => r.active);
function clear() {
  for (const r of system.rockets) if (r.active) system._deactivate(r);
  system.cancelSalvos?.(null);
  for (let q = system._qN - 1; q >= 0; q--) system._qRemove(q);
  for (const k in events) events[k] = 0;
  system.pdTargets = true;
}
function step(sec, dt = 1 / 60, each = null) {
  for (let t = 0; t < sec; t += dt) {
    SimClock.sim += dt;
    SimClock.render = SimClock.sim;
    if (each) each(dt);
    system.update(dt);
  }
}

test('syncThreats: rakiety strony gracza i wrogie trafiają do swoich buforów, ten sam zastępnik co krok', () => {
  clear();
  const target = { x: 5000, y: 0, radius: 120, dead: false };
  const def = MASTER_WEAPONS.grad_launcher;
  system.fireSalvo(null, 0, 0, target, 1, def, 'blue', 0, 0, 6, 0, 0, LAUNCH_ELEVATED);
  system.fireSalvo(null, 0, 2000, target, 1, def, 'red', 0, 0, 4, 0, 0, LAUNCH_ELEVATED);
  step(0.5);
  const mine = [], enemy = [];
  assert.equal(system.syncThreats(mine, enemy, SimClock.sim, null), 10);
  assert.equal(mine.length, 6);
  assert.equal(enemy.length, 4);
  for (const p of mine) {
    assert.equal(p.type, 'rocket');
    assert.equal(p.owner, 'player');
    assert.equal(p.rocket3d, true);
    assert.ok(p.life > 0 && p.dead === false);
    assert.ok(p.r > 2 && p.r < 6, `promień mikrorakiety ${p.r}`);
    assert.ok(Math.hypot(p.vx, p.vy) > 200, 'prędkość całkowita');
  }
  for (const p of enemy) assert.equal(p.owner, 'npc');
  // Kolejny krok: te same obiekty (bez alokacji), pozycje dosunięte do czasu kroku fizyki.
  const first = mine[0];
  const r0 = first.slot;
  mine.length = enemy.length = 0;
  system.syncThreats(mine, enemy, SimClock.sim + 0.01, null);
  assert.equal(mine[0], first);
  const vx = r0.velocity.x + r0.frameVel.x;
  assert.ok(Math.abs(first.x - (r0.position.x + vx * 0.01)) < 1e-6, 'pozycja dosunięta o v·Δt');
  // Mgła wojny: wroga rakieta poza wzrokiem strony gracza nie jest celem — rakiety gracza zawsze.
  mine.length = enemy.length = 0;
  system.syncThreats(mine, enemy, SimClock.sim, () => false);
  assert.equal(enemy.length, 0);
  assert.equal(mine.length, 6);
  // A/B: pdTargets = false — rakiety 3D poza obroną punktową (stan sprzed zmiany).
  system.pdTargets = false;
  mine.length = enemy.length = 0;
  assert.equal(system.syncThreats(mine, enemy, SimClock.sim, null), 0);
  assert.equal(mine.length + enemy.length, 0);
});

test('intercept: rakieta znika bez wybuchu i obrażeń, zastępnik gaśnie, licznik przyczyny', () => {
  clear();
  let damage = 0;
  window.applyDamageToNPC = (_e, d) => { damage += d; };
  window.applyDamageToPlayer = (d) => { damage += d; };
  const target = { x: 3000, y: 0, radius: 100, dead: false };
  system.fireSalvo(null, 0, 0, target, 500, MASTER_WEAPONS.missile_rack, 'red', 0, 0, 1, 0, 0, LAUNCH_ELEVATED);
  step(0.4);
  const mine = [], enemy = [];
  system.syncThreats(mine, enemy, SimClock.sim, null);
  const p = enemy[0];
  const before = system.stats.intercepted.ciws;
  assert.equal(system.intercept(p, 'ciws'), true);
  assert.equal(system.stats.intercepted.ciws, before + 1);
  assert.equal(events.intercept, 1);
  assert.equal(p.life, -1);
  assert.equal(p.dead, true);
  assert.equal(p.slot.active, false);
  assert.equal(p.slot.threat, null);
  assert.equal(system.activeRockets, 0);
  // Drugi raz ten sam zastępnik (rakieta w innym buforze tego kroku) — nic.
  assert.equal(system.intercept(p, 'flak'), false);
  step(2);
  assert.equal(damage, 0, 'bez obrażeń');
  assert.equal(events.detonate, 0, 'bez detonacji');
  delete window.applyDamageToNPC;
  delete window.applyDamageToPlayer;
});

test('pdHit (ROCKET_PD_TUNE, V3 — decyzja 2026-10-12): obrażenia PD × mnożnik przyczyny zdejmują punkty życia rakiety', () => {
  clear();
  const target = { x: 4000, y: 0, radius: 100, dead: false };
  const fire = (id, n = 1) => { system.fireSalvo(null, 0, 0, target, 1, MASTER_WEAPONS[id], 'red', 0, 0, n, 0, 0, LAUNCH_ELEVATED); step(0.3); return active(); };
  const T = ROCKET_PD_TUNE;
  // Mikrorakieta (Grad): 20 pkt — CIWS Mk I (12) dwa trafienia, laser PD (16 × 0,5) trzy.
  let [r] = fire('grad_launcher');
  assert.equal(r.pdHp, T.hpDefault);
  assert.equal(system.pdHit(r, 'ciws', MASTER_WEAPONS.ciws_mk1.baseDamage), 1);
  assert.equal(system.pdHit(r, 'ciws', MASTER_WEAPONS.ciws_mk1.baseDamage), 2, 'mikrorakieta: 2 × CIWS Mk I');
  assert.equal(system.pdHit(r, 'ciws', 12), 0, 'już jej nie ma');
  clear();
  [r] = fire('grad_launcher');
  const laser = MASTER_WEAPONS.laser_pd_mk1.baseDamage;
  assert.deepEqual([system.pdHit(r, 'laser', laser), system.pdHit(r, 'laser', laser), system.pdHit(r, 'laser', laser)], [1, 1, 2]);
  // Pancerna głowica manewrująca: 60 pkt — mocniejsze działo zabija szybciej (CIWS Mk II 18 → 4, Mk I 12 → 5).
  clear();
  [r] = fire('missile_rack');
  assert.equal(r.pdHp, T.hpById.missile_rack);
  let n = 0;
  while (system.pdHit(r, 'ciws', MASTER_WEAPONS.ciws_mk2.baseDamage) === 1) n++;
  assert.equal(n + 1, Math.ceil(T.hpById.missile_rack / MASTER_WEAPONS.ciws_mk2.baseDamage));
  // Flak przeciw rakietom: niskie obrażenia odłamków — Perun (460) w środku kuli zdejmuje ~11,5 pkt.
  clear();
  [r] = fire('supernova_missile');
  const hp0 = r.pdHp;
  assert.equal(system.pdHit(r, 'flak', MASTER_WEAPONS.flak_capital.baseDamage), 1);
  assert.ok(Math.abs(hp0 - r.pdHp - MASTER_WEAPONS.flak_capital.baseDamage * T.dmgMul.flak) < 1e-9);
  assert.ok(T.flakRocketRange > 0.3 && T.flakRocketRange < 0.8, 'flak bierze rakiety tylko w paśmie obrony punktowej');
  // Strojenie karty: pole pdHp (bez wpisu w hpById).
  clear();
  const keep = T.hpById.fast_missile_rack;
  delete T.hpById.fast_missile_rack;
  try {
    MASTER_WEAPONS.fast_missile_rack.pdHp = 5;
    [r] = fire('fast_missile_rack');
    assert.equal(r.pdHp, 5);
  } finally { delete MASTER_WEAPONS.fast_missile_rack.pdHp; T.hpById.fast_missile_rack = keep; }
});

test('Hydra: nosiciel zestrzelony przed podziałem — bez głowic potomnych; po podziale każda głowica osobno', () => {
  clear();
  window.applyDamageToNPC = () => {};
  const hydra = MASTER_WEAPONS.hydra_mirv;
  const target = { x: 7000, y: 0, radius: 150, dead: false };
  system.fireSalvo(null, 0, 0, target, 240, hydra, 'blue', 0, 0, 1, 0, 0, LAUNCH_ELEVATED);
  step(0.6);
  assert.equal(active().length, 1);
  system.intercept(active()[0], 'laser');
  step(6);
  assert.equal(events.split, 0, 'nosiciel nie pękł');
  assert.equal(active().length, 0);

  // Krok po kroku do podziału: zatrzymaj, gdy głowice są w locie.
  clear();
  system.fireSalvo(null, 0, 0, target, 240, hydra, 'blue', 0, 0, 1, 0, 0, LAUNCH_ELEVATED);
  for (let t = 0; t < 6 && events.split === 0; t += 1 / 60) step(1 / 60);
  assert.equal(events.split, 1);
  const kids = active();
  assert.equal(kids.length, hydra.submunition.count);
  system.intercept(kids[0], 'ciws');
  assert.equal(active().length, hydra.submunition.count - 1, 'zestrzelona jedna głowica, reszta leci');
  delete window.applyDamageToNPC;
});

test('Supernowa zestrzelona: bez wybuchu (onDetonate), bez obrażeń obszarowych', () => {
  clear();
  let damage = 0;
  window.applyDamageToNPC = (_e, d) => { damage += d; };
  const npcs = [{ x: 4000, y: 0, radius: 200, dead: false }];
  window.npcs = npcs;
  system.fireSalvo(null, 0, 0, npcs[0], 10000, MASTER_WEAPONS.supernova_missile, 'blue', 0, 0, 4, 0.07, 0, LAUNCH_ELEVATED);
  step(1.2);
  for (const r of active()) system.intercept(r, 'flak');
  step(3);
  assert.equal(events.detonate, 0);
  assert.equal(damage, 0);
  assert.equal(system.stats.intercepted.flak >= 4, true);
  delete window.applyDamageToNPC;
  delete window.npcs;
});

test('ciwsShotHitsRocket: odcinek kroku w ruchu względnym — mijanie między krokami trafia, obok — nie', () => {
  // Czołowo: pocisk 2000 j/s w prawo, rakieta 2500 j/s w lewo; w kroku 1/60 mijają się (koniec kroku już za sobą).
  const dt = 1 / 60;
  const b = { x: 20, y: 0, vx: 2000, vy: 0, r: 2 };
  const bx0 = b.x - b.vx * dt;
  const rb = { x: -20, y: 1, vx: -2500, vy: 0, r: 4 };
  const reach = ciwsRocketReach(b, dt);
  assert.ok(ciwsShotHitsRocket(b, bx0, 0, rb, dt, reach), 'minęli się w kroku — trafienie');
  // Dawny test punktu końcowego: 40 j. > 6 j. — pudło.
  assert.ok(Math.hypot(b.x - rb.x, b.y - rb.y) > 6);
  // Ten sam przelot 30 j. obok — pudło.
  assert.equal(ciwsShotHitsRocket(b, bx0, 0, { ...rb, y: 30 }, dt, reach), false);
  // Rakieta daleko poza drogą względną — wstępne odrzucenie.
  assert.equal(ciwsShotHitsRocket(b, bx0, 0, { ...rb, x: 5000 }, dt, reach), false);
  // Pościg: rakieta ucieka tym samym kierunkiem szybciej niż pocisk — nie dogania.
  const chase = { x: 100, y: 0, vx: 2600, vy: 0, r: 4 };
  assert.equal(ciwsShotHitsRocket(b, bx0, 0, chase, dt, reach), false);
});

test('killRocketThreat (index.html): rakieta 3D — intercept, kanwa — efekt i life = -1', () => {
  const calls = [];
  const scope = {
    window: { rocketSystem3D: { pdHit: (rb, cause, dmg) => { calls.push(['3d', cause, dmg]); return 2; } } },
    ActiveCarrier: { set: () => {}, clear: () => {} },
    writeCarrierVelocity: () => null,
    SimClock: { sim: 0 },
    _impactCarrier: {},
    spawnBulletImpactEffect: (rb, x, y, s) => calls.push(['kanwa', s])
  };
  const kill = loadIndexFunction(html, 'function killRocketThreat(rb, cause, fxScale, damage) {', 'killRocketThreat', scope);
  assert.equal(kill({ rocket3d: true, life: 1 }, 'flak', 0.9, 40), true);
  const canvas = { life: 2, x: 1, y: 2, ivx: 0, ivy: 0 };
  assert.equal(kill(canvas, 'ciws', 1.3), true);
  assert.equal(canvas.life, -1);
  assert.equal(kill(canvas, 'ciws', 1.3), false, 'już zestrzelona');
  assert.deepEqual(calls, [['3d', 'flak', 40], ['kanwa', 1.3]]);
});

test('index.html: obrona punktowa gracza i NPC bierze rakiety 3D (bufory, CIWS obu stron, laser, flak)', () => {
  const ciws = html.slice(html.indexOf('function ciwsStep(dt) {'), html.indexOf('function fireCIWSGun('));
  assert.match(ciws, /window\.rocketSystem3D\?\.syncThreats\(_pdPlayerRocketBuffer, _pdEnemyRocketBuffer, SimClock\.sim, _pdHostileRocketVisible\)/);
  assert.doesNotMatch(ciws, /bullets\.indexOf\(target\)/, 'laser gracza nie szuka rakiety w bullets (rakiety 3D tam nie ma)');
  assert.match(ciws, /killRocketThreat\(target, 'laser', 1\.2, \(stats\?\.dmg \?\? wDef\.baseDamage\) \|\| LASER_PD_DAMAGE\)/);
  assert.match(ciws, /const rocketRange = isFlak \? range \* \(Number\(window\.RocketPdTune\?\.flakRocketRange\) \|\| 1\) : range;/,
    'flak bierze rakiety tylko w paśmie obrony punktowej');
  assert.match(html, /const _pdHostileRocketVisible = \(x, y\) => SensorSystem\.pointVisible\(x, y\);/);
  const flak = html.slice(html.indexOf('function detonateFlakShell(b) {'), html.indexOf('function handlePlayerDestroyed('));
  assert.match(flak, /killRocketThreat\(rb, 'flak', 0\.9, flakDmg\)/);
  const loop = html.slice(html.indexOf('// --- CIWS INTERCEPT RAKIET ---'), html.indexOf('// --- PRZEBICIA (zadanie 18-B'));
  assert.match(loop, /if \(b\.type === 'ciws'\) \{/, 'CIWS każdej strony (dawniej tylko owner player)');
  assert.match(loop, /b\.owner === 'npc' \? _pdPlayerRocketBuffer : _pdEnemyRocketBuffer/);
  assert.match(loop, /ciwsShotHitsRocket\(b, bx0, by0, rb, span, reach\)/);
  assert.match(loop, /killRocketThreat\(rb, 'ciws', 1\.3, b\.damage\)/);
  // Laser PD NPC: trafienie rakiety z szybkiej ścieżki → zestrzelenie, bez obrażeń kadłubów.
  assert.match(html, /if \(beamHit\.kind === 'rocket'\) \{\n\s*killRocketThreat\(beamHit\.entity, 'laser', 1\.2, damage\);\n\s*beamHit\.entity = null;/);
});
