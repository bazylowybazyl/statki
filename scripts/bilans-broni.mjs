// Bilans mechaniki broni z dema (zadanie 18-A, docs/webgpu/PROJEKT-BRONI.md §2.8): pojedynki na
// prawdziwych sprite'ach kadłubów (readPng + HullBodies.createHull, obraz w rozmiarze renderu
// jak w grze), N strzałów na broń z kątami i punktami celowania z ziarnem — PRZED (dzisiejsza
// gra: pierwszy kadłub zatrzymuje pocisk, bez rykoszetu, Hexlance 1 cięcie) i PO (przebicia,
// rykoszety, krater wyjścia, seria Hexlance'a) na tych samych strzałach.
//
//   node scripts/bilans-broni.mjs [--n 1000] [--json plik.json] [--kratery tylko|nie]
//
// HP celu: bezpośrednie obrażenia (applyDamageToNPC) i sufit strukturalny gry
// (hp ≤ maxHp · (żywe węzły / startowe)^2,2, index.html enforceNpcHexIntegrityBalance) —
// strata HP = maxHp − min(maxHp − obrażenia, sufit). Harness `bitwa` nie mierzy bilansu
// (inna realizacja losowa po zmianie sekwencji Math.random).
//
// Kratery (zadanie 25c, część „Kratery”): broń bez przebić (Yamato — salwa 3 luf, armata, Goliath,
// gatling plazmowy, rakieta) w świeży kadłub — zabite węzły, strata HP i rozpady na strzał — oraz
// czas do zniszczenia (seria w środek celu z rozrzutem broni, HP z obrażeń i sufitu strukturalnego
// po każdym strzale). Liczone tym samym kodem kraterów co gra (flyShot → HullBodies.impact), więc
// przebieg na kodzie sprzed zmiany kraterów daje PRZED, po zmianie — PO. `--kratery tylko` — sama
// ta część, `--kratery nie` — bez niej.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPng } from './webgpu/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const N = Math.max(10, Number(argVal('--n', 1000)) || 1000);
const JSON_OUT = argVal('--json', null);
const CRATERS = argVal('--kratery', 'tak');

// ---------------- losowość z ziarnem ----------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Math.random gry (odrzut odłamków w kraterze) — ziarno na strzał, to samo PRZED i PO.
let _mr = mulberry32(1);
Math.random = () => _mr();
const reseed = (s) => { _mr = mulberry32(s); };

globalThis.window = { wrecks: [] };
const { HullBodies } = await import('../src/game/hullBodies.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { getHullRenderSize } = await import('../src/data/ships.js');
const { chargeTimeOf, burstCountOf, burstDelayOf } = await import('../src/game/weaponCharge.js');
const { createShot, flyShot, ledgerFor } = await import('../tests/helpers/hullFlight.mjs');

// ---------------- kadłuby z prawdziwych sprite'ów ----------------
// Obraz w rozmiarze renderu (getHullRenderSize) — to samo, co getNpcHexInitSource robi płótnem.
function resizeBox(img, tw, th) {
  const { width: sw, height: sh, data: src } = img;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sh / th), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sw / tw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * sw + xx) * 4, al = src[o + 3];
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al; n++;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return { width: tw, height: th, data: out };
}

const HULLS = {
  frigate: { file: 'src/assets/ships/piratefrigate.png', profile: 'pirate_frigate', hp: 1200 },
  destroyer: { file: 'src/assets/ships/piratedestroyer.png', profile: 'pirate_destroyer', hp: 4200 },
  battleship: { file: 'src/assets/ships/piratebattleship.png', profile: 'pirate_battleship', hp: 12000 },
  carrier: { file: 'src/assets/ships/terrancarrier.png', profile: 'terran_carrier', hp: 42000 },
  supercapital: { file: 'src/assets/ships/terransupercapital.png', profile: 'terran_supercapital', hp: 85000 },
  // Terra Nova (cele pirackiej armaty w bitwach NPC; HP z szablonów src/data/ships.js).
  tn_frigate: { file: 'src/assets/ships/terranfrigate.png', profile: 'terran_frigate', hp: 1200 },
  tn_destroyer: { file: 'src/assets/ships/terrandestroyer.png', profile: 'terran_destroyer', hp: 4200 },
  tn_battleship: { file: 'src/assets/ships/terranbattleship.png', profile: 'terran_battleship', hp: 12000 }
};
for (const [key, h] of Object.entries(HULLS)) {
  const png = readPng(join(ROOT, h.file));
  const size = getHullRenderSize(h.profile, png.width, png.height);
  h.image = resizeBox(png, size.w, size.h);
  h.w = size.w; h.h = size.h; h.key = key;
}

function spawn(hullKey, x, y, angle = 0) {
  const h = HULLS[hullKey];
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: 10000, hp: h.hp, maxHp: h.hp, type: hullKey };
  HullBodies.createHull(e, h.image);
  e._hull = h;
  return e;
}

function releaseAll(list) {
  for (const e of list) HullBodies.release(e);
  for (const w of window.wrecks) HullBodies.release(w);
  window.wrecks.length = 0;
}

// Rozpady po strzale (krok silnika), potem strata HP z obrażeń i sufitu strukturalnego.
function settle(targets) {
  for (let k = 0; k < 3; k++) HullBodies.step(1 / 120, [...targets, ...window.wrecks]);
}
function hpLoss(e, direct) {
  const st = HullBodies.structuralState(e);
  const ratio = st ? st.ratio : 0;
  const cap = e.maxHp * Math.pow(Math.max(0, Math.min(1, ratio)), 2.2);
  const hp = Math.max(0, Math.min(e.maxHp - direct, cap));
  return { loss: e.maxHp - hp, ratio, killedStruct: st ? st.total - st.active : 0 };
}

// Punkt celowania na kadłubie (jak demo: wzdłuż ±0,375 długości, w poprzek ±0,175 szerokości).
function aimPoint(rng, e) {
  const h = e._hull;
  const along = (rng() - 0.5) * h.w * 0.75, across = (rng() - 0.5) * h.h * 0.35;
  const c = Math.cos(e.angle), s = Math.sin(e.angle);
  return [e.x + along * c - across * s, e.y + along * s + across * c];
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '—');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));

// ---------------- strzał pociskiem (Mjolnir, Valkyrie, Vulcan, Gatling) ----------------
// scenario(rng) → { targets, aim: [x, y], from: [x, y] } — cel(e) zbudowany od nowa na strzał.
function shotSeries(weaponId, name, scenario, serialBase) {
  const def = MASTER_WEAPONS[weaponId];
  const result = { weapon: weaponId, scenario: name, n: N, old: null, new: null };
  for (const mode of ['old', 'new']) {
    const geo = mulberry32(0xB1A5 + serialBase);
    const acc = { hit: 0, ricochet: 0, hulls: [], exits: 0, stuck: 0, direct: [], loss: [], killed: [], exitKilled: [], perHull: [] };
    for (let i = 0; i < N; i++) {
      const sc = scenario(geo);
      const spread = (geo() - 0.5) * (def.spread || 0);
      let dx = sc.aim[0] - sc.from[0], dy = sc.aim[1] - sc.from[1];
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      const c = Math.cos(spread), s = Math.sin(spread);
      const b = createShot(def, sc.from[0], sc.from[1], dx * c - dy * s, dx * s + dy * c, serialBase + i);
      b.life = 4000 / def.baseSpeed;
      reseed(serialBase * 7919 + i);
      const ledger = new Map();
      const log = flyShot(b, def, sc.targets, { mode, ledger });
      settle(sc.targets);
      let direct = 0, loss = 0, killed = 0, hullsHit = 0;
      const perHull = [];
      for (const e of sc.targets) {
        const rec = ledgerFor(ledger, e);
        const hl = hpLoss(e, rec.hp);
        if (rec.entries > 0 || rec.ricochets > 0) hullsHit++;
        direct += rec.hp; loss += hl.loss; killed += rec.killed;
        perHull.push(hl.loss);
      }
      if (hullsHit > 0) acc.hit++;
      if (log.some((ev) => ev.type === 'ricochet')) acc.ricochet++;
      if (log.some((ev) => ev.type === 'exit')) acc.exits++;
      if (log.some((ev) => ev.type === 'stuck')) acc.stuck++;
      acc.hulls.push(hullsHit);
      acc.direct.push(direct); acc.loss.push(loss); acc.killed.push(killed);
      acc.exitKilled.push(log.filter((ev) => ev.type === 'exit' || ev.type === 'stuck').reduce((s, ev) => s + (ev.killed || 0), 0));
      acc.perHull.push(perHull);
      releaseAll(sc.targets);
    }
    const perHullMean = acc.perHull[0].map((_, k) => mean(acc.perHull.map((p) => p[k])));
    result[mode] = {
      hitRate: acc.hit / N, ricochetRate: acc.ricochet / N, exitRate: acc.exits / N, stuckRate: acc.stuck / N,
      hullsPerShot: mean(acc.hulls), directPerShot: mean(acc.direct), lossPerShot: mean(acc.loss),
      killedPerShot: mean(acc.killed), exitCraterKilled: mean(acc.exitKilled), lossPerHull: perHullMean
    };
  }
  return result;
}

// Pojedynczy cel: strzelec w odległości 2500 j. pod losowym namiarem, cel w (0, 0) pod kątem 0.
const single = (hullKey) => (rng) => {
  const e = spawn(hullKey, 0, 0, 0);
  const bearing = rng() * Math.PI * 2;
  const aim = aimPoint(rng, e);
  return { targets: [e], aim, from: [aim[0] + Math.cos(bearing) * 2500, aim[1] + Math.sin(bearing) * 2500] };
};
// Kolumna: fregata, niszczyciel, pancernik jeden za drugim wzdłuż osi strzału (±60 j. w bok,
// dowolne kursy), strzał w losowy punkt fregaty z odchyleniem osi ±3°.
const column = (rng) => {
  const axis = rng() * Math.PI * 2;
  const ax = Math.cos(axis), ay = Math.sin(axis);
  const dist = [0, 600, 1350];
  const targets = ['frigate', 'destroyer', 'battleship'].map((k, i) => {
    const off = (rng() - 0.5) * 120;
    return spawn(k, ax * dist[i] - ay * off, ay * dist[i] + ax * off, rng() * Math.PI * 2);
  });
  const aim = aimPoint(rng, targets[0]);
  const dev = (rng() - 0.5) * (6 * Math.PI / 180);
  const fx = Math.cos(axis + dev), fy = Math.sin(axis + dev);
  return { targets, aim, from: [aim[0] - fx * 2500, aim[1] - fy * 2500] };
};

// ---------------- Hexlance: rzaz, seria z danych ----------------
function hexlanceSeries(hullKey, serialBase) {
  const def = MASTER_WEAPONS.hexlance_siege;
  const bursts = burstCountOf(def), delay = burstDelayOf(def, 0.12);
  const res = { weapon: 'hexlance_siege', scenario: `pojedynczy ${hullKey}`, n: N, old: null, new: null };
  for (const [mode, shots] of [['old', 1], ['new', bursts]]) {
    const geo = mulberry32(0x4E7 + serialBase);
    const killed = [], loss = [], cutPerShot = [];
    for (let i = 0; i < N; i++) {
      const e = spawn(hullKey, 0, 0, 0);
      // Cel dryfuje (0–150 j/s) i obraca się (±0,05 rad/s) między strzałami serii; Atlas stoi.
      const sp = geo() * 150, dirv = geo() * Math.PI * 2;
      e.vx = Math.cos(dirv) * sp; e.vy = Math.sin(dirv) * sp; e.angVel = (geo() - 0.5) * 0.1;
      const bearing = geo() * Math.PI * 2;
      const aim = aimPoint(geo, e);
      const fx = -Math.cos(bearing), fy = -Math.sin(bearing);
      const R = 3000;
      const mx = aim[0] - fx * R, my = aim[1] - fy * R;
      reseed(serialBase * 104729 + i);
      const base = e.beamHull.body.activeNodes;
      const cuts = [];
      for (let k = 0; k < shots; k++) {
        // Lot pocisku (12 000 j/s) klatka po klatce (60 Hz) i rzaz 35 j. przez wszystkie kadłuby.
        const speed = def.baseSpeed, step = speed / 60;
        let cut = 0;
        for (let d = R - 900; d < R + 900; d += step) {
          const x0 = mx + fx * d, y0 = my + fy * d, x1 = x0 + fx * step, y1 = y0 + fy * step;
          for (const t of [e, ...window.wrecks]) if (HullBodies.hasHull(t)) cut += HullBodies.cutSegment(t, x0, y0, x1, y1, 35);
        }
        cuts.push(cut);
        settle([e]);
        if (k < shots - 1) {
          for (const t of [e, ...window.wrecks]) { t.x += (t.vx || 0) * delay; t.y += (t.vy || 0) * delay; t.angle += (t.angVel || 0) * delay; }
        }
      }
      const hl = hpLoss(e, 0);
      killed.push(base - (HullBodies.hasHull(e) ? e.beamHull.body.activeNodes : 0));
      loss.push(hl.loss);
      cutPerShot.push(cuts);
      releaseAll([e]);
    }
    res[mode] = {
      shots, killedPerPress: mean(killed), lossPerPress: mean(loss),
      cutByShot: Array.from({ length: shots }, (_, k) => mean(cutPerShot.map((c) => c[k])))
    };
  }
  return res;
}

// ---------------- kratery (zadanie 25c) ----------------
// Kod kraterów gry: pocisk — flyShot (tryb gry, HullBodies.impact z tym, co podaje mu wzorzec
// tests/helpers/hullFlight.mjs), rakieta — wybuch na poszyciu jak rocketSystem3D._onHit (punkt styku
// wzdłuż ostatniego odcinka lotu, obrażenia HP w cel) i krater gry, jeśli gra go robi
// (src/game/hullCraters.js — przed zadaniem 25c go nie było: rakieta bez krateru).
let rocketCraterHit = null;
try { ({ rocketCraterHit } = await import('../src/game/hullCraters.js')); } catch { rocketCraterHit = null; }

const TAU = Math.PI * 2;
// Salwa: lufy równolegle co SALVO_PITCH j. w poprzek osi strzału, ten sam punkt celowania (Yamato:
// 3 lufy co 85 ms — cel stoi, więc liczy się tylko kolejność; między lufami krok silnika, jak w grze).
const SALVO_PITCH = 14;
const activeOf = (e) => (HullBodies.hasHull(e) ? e.beamHull.body.activeNodes : 0);
// Kroki silnika po strzale: rozpad sprawdzany co 10 kroków (splitCheckInterval) — 12 kroków (0,1 s) = odłamy
// odcięte przed pomiarem (sufit strukturalny liczy tylko kadłub, który został).
function settleFull(targets) { for (let k = 0; k < 12; k++) HullBodies.step(1 / 120, [...targets, ...window.wrecks]); }

function fireVolley(def, targets, from, aim, rng, barrels, serial, ledger) {
  let dx = aim[0] - from[0], dy = aim[1] - from[1];
  const l = Math.hypot(dx, dy); dx /= l; dy /= l;
  for (let k = 0; k < barrels; k++) {
    const off = (k - (barrels - 1) / 2) * SALVO_PITCH;
    const sp = (rng() - 0.5) * (def.spread || 0);
    const c = Math.cos(sp), s = Math.sin(sp);
    if (def.category === 'rocket') {
      rocketHitOnce(def, targets[0], from[0] - dy * off, from[1] + dx * off, dx * c - dy * s, dx * s + dy * c, ledger);
    } else {
      const b = createShot(def, from[0] - dy * off, from[1] + dx * off, dx * c - dy * s, dx * s + dy * c, serial + k);
      b.life = 6000 / def.baseSpeed;
      flyShot(b, def, targets, { mode: 'new', ledger });
    }
    if (k < barrels - 1) settleFull(targets);
  }
}

// Rakieta: zapalnik przy kadłubie — punkt styku = pierwszy materiał na linii lotu (traceThrough, jak
// src/3d/rockets/effects.js prepareContact), obrażenia HP = obrażenia broni (tarcza opuszczona).
const _rocketRel = { x: 0, y: 0 };
function rocketHitOnce(def, e, x0, y0, dirX, dirY, ledger) {
  const rec = ledgerFor(ledger, e);
  const L = 3000;
  const tr = HullBodies.traceThrough(e, x0, y0, x0 + dirX * L, y0 + dirY * L, 0);
  if (!tr || tr.entryT < 0) return;
  rec.hp += def.baseDamage;
  rec.entries++;
  if (!rocketCraterHit) return;
  const cx = x0 + dirX * L * tr.entryT, cy = y0 + dirY * L * tr.entryT;
  _rocketRel.x = dirX * (def.baseSpeed || 1000); _rocketRel.y = dirY * (def.baseSpeed || 1000);
  // Odcinek lotu: 60 j. przed punktem styku do punktu styku (zapalnik rusza przy kadłubie).
  const k = rocketCraterHit(HullBodies, e, cx - dirX * 60, cy - dirY * 60, cx, cy, def.baseDamage, def, _rocketRel);
  rec.killed += k;
}

// Trafienie (salwa) w świeży kadłub pod losowym namiarem w losowy punkt (jak `single`).
function craterSingle(weaponId, hullKey, barrels, serialBase, n) {
  const def = MASTER_WEAPONS[weaponId];
  const geo = mulberry32(0xC7A7 + serialBase);
  const acc = { hit: 0, split: 0, killed: [], loss: [], direct: [] };
  for (let i = 0; i < n; i++) {
    const e = spawn(hullKey, 0, 0, 0);
    const bearing = geo() * TAU;
    const aim = aimPoint(geo, e);
    const from = [aim[0] + Math.cos(bearing) * 2500, aim[1] + Math.sin(bearing) * 2500];
    reseed(serialBase * 7919 + i);
    const ledger = new Map();
    const base = e.beamHull.body.activeNodes;
    const wrecks0 = window.wrecks.length;
    fireVolley(def, [e], from, aim, geo, barrels, serialBase + i * 8, ledger);
    settleFull([e]);
    const rec = ledgerFor(ledger, e);
    if (rec.entries > 0) acc.hit++;
    if (window.wrecks.length > wrecks0) acc.split++;
    acc.killed.push(base - activeOf(e));
    acc.loss.push(hpLoss(e, rec.hp).loss);
    acc.direct.push(rec.hp);
    releaseAll([e]);
  }
  return { weapon: weaponId, target: hullKey, barrels, n, hitRate: acc.hit / n, splitRate: acc.split / n,
    nodes: HULLS[hullKey].nodes, killedPerShot: mean(acc.killed), lossPerShot: mean(acc.loss), directPerShot: mean(acc.direct) };
}

// Punkt celowania serii: żywy węzeł najbliższy środkowi żywych węzłów kadłuba (świat gry) — po
// rozpadzie kotwica encji (środek sprite'a) bywa w odciętej części, a środek kadłuba w kształcie „C”
// — w dziurze; strzelec celuje w kadłub, który został.
const _cen = { x: 0, y: 0 };
function liveCentroid(e) {
  const hull = e.beamHull, s = hull.body.nodeStore;
  let x = 0, y = 0, n = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const p = HullBodies.nodeWorld(hull, i);
    x += p.x; y += p.y; n++;
  }
  const mx = n ? x / n : e.x, my = n ? y / n : e.y;
  let best = Infinity;
  _cen.x = mx; _cen.y = my;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const p = HullBodies.nodeWorld(hull, i);
    const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
    if (d < best) { best = d; _cen.x = p.x; _cen.y = p.y; }
  }
  return _cen;
}

// Czas do zniszczenia: seria w żywy węzeł najbliżej środka kadłuba (rozrzut broni + drżenie celowania ±15 j.) z
// jednego losowego namiaru, 2000 j.; po każdym strzale / salwie krok silnika i HP = min(HP − obrażenia, sufit).
function craterTtk(weaponId, hullKey, barrels, serialBase, trials, maxShots) {
  const def = MASTER_WEAPONS[weaponId];
  const geo = mulberry32(0x77C0 + serialBase);
  const shots = [], lostAtDeath = [], capKills = [], splits = [];
  for (let t = 0; t < trials; t++) {
    const e = spawn(hullKey, 0, 0, geo() * TAU);
    const bearing = geo() * TAU;
    const base = e.beamHull.body.activeNodes;
    let hp = e.maxHp, n = 0, byCap = false, split = 0;
    for (; n < maxShots; ) {
      n++;
      const c = Math.cos(e.angle), s = Math.sin(e.angle);
      const al = (geo() - 0.5) * 30, ac = (geo() - 0.5) * 30;
      const cen = liveCentroid(e);
      const aim = [cen.x + al * c - ac * s, cen.y + al * s + ac * c];
      const from = [aim[0] + Math.cos(bearing) * 2000, aim[1] + Math.sin(bearing) * 2000];
      reseed(serialBase * 104729 + t * 1009 + n);
      const ledger = new Map();
      const wrecks0 = window.wrecks.length;
      fireVolley(def, [e], from, aim, geo, barrels, serialBase + t * 4096 + n * 8, ledger);
      settleFull([e]);
      if (window.wrecks.length > wrecks0) split++;
      hp -= ledgerFor(ledger, e).hp;
      const st = HullBodies.structuralState(e);
      const cap = e.maxHp * Math.pow(Math.max(0, Math.min(1, st ? st.ratio : 0)), 2.2);
      if (hp > cap) { hp = cap; if (hp <= 0) byCap = true; }
      if (hp <= 0 || !HullBodies.hasHull(e)) break;
    }
    shots.push(n);
    lostAtDeath.push(base - activeOf(e));
    capKills.push(byCap ? 1 : 0);
    splits.push(split);
    releaseAll([e]);
  }
  const cycle = (def.cooldown || 1) + chargeTimeOf(def);
  const m = mean(shots);
  return { weapon: weaponId, target: hullKey, barrels, trials, shotsToKill: m, timeToKill: m * cycle,
    maxShots: Math.max(...shots), capKillRate: mean(capKills), lostAtDeath: mean(lostAtDeath), splitsPerKill: mean(splits) };
}

// ---------------- przebieg ----------------
const t0 = performance.now();
const results = [];
const craterRows = [];
const ttkRows = [];
const log = (r) => { results.push(r); process.stderr.write(`  ${r.weapon} / ${r.scenario}: ${((performance.now() - t0) / 1000).toFixed(1)} s\n`); };
const logC = (list, r, what) => { list.push(r); process.stderr.write(`  ${what} ${r.weapon} / ${r.target}: ${((performance.now() - t0) / 1000).toFixed(1)} s\n`); };
process.stderr.write(`bilans-broni: ${N} strzałów na broń i scenariusz\n`);
for (const h of Object.values(HULLS)) h.nodes = spawnNodes(h.key);
function spawnNodes(key) { const e = spawn(key, 0, 0, 0); const n = e.beamHull.body.activeNodes; releaseAll([e]); return n; }

if (CRATERS !== 'tylko') {
  log(shotSeries('siege_railgun', 'kolumna fregata+niszczyciel+pancernik', column, 100000));
  log(shotSeries('siege_railgun', 'pojedynczy pancernik', single('battleship'), 110000));
  for (const k of ['frigate', 'destroyer', 'battleship', 'carrier', 'supercapital']) {
    log(shotSeries('special_valkyrie_railgun', `pojedynczy ${k}`, single(k), 200000 + k.length * 1000));
  }
  log(shotSeries('special_valkyrie_railgun', 'kolumna fregata+niszczyciel+pancernik', column, 230000));
  for (const k of ['destroyer', 'battleship']) {
    log(shotSeries('vulcan_minigun', `pojedynczy ${k}`, single(k), 300000 + k.length * 1000));
    log(shotSeries('gatling_s', `pojedynczy ${k}`, single(k), 400000 + k.length * 1000));
  }
  log(hexlanceSeries('battleship', 500000));
  log(hexlanceSeries('carrier', 510000));
}
if (CRATERS !== 'nie') {
  const NC = Math.max(20, Math.round(N / 4));
  const NT = Math.max(8, Math.round(N / 25));
  // [broń, lufy, cele pojedyncze, cele serii]
  const PLAN = [
    ['special_yamato_cannon', 3, ['frigate', 'destroyer', 'battleship', 'carrier', 'supercapital'], ['destroyer', 'battleship', 'carrier', 'supercapital']],
    ['armata_mk1', 1, ['tn_frigate', 'tn_destroyer', 'tn_battleship', 'battleship'], ['tn_frigate', 'tn_destroyer', 'tn_battleship']],
    ['special_goliath_autocannon', 1, ['destroyer', 'battleship'], ['destroyer', 'battleship']],
    ['special_plasma_gatling', 1, ['battleship'], ['battleship']],
    ['siege_railgun', 1, [], ['battleship', 'carrier']],
    ['special_valkyrie_railgun', 1, [], ['destroyer', 'battleship']],
    ['missile_rack', 1, ['tn_destroyer', 'tn_battleship'], ['tn_destroyer', 'tn_battleship']]
  ];
  let sb = 600000;
  for (const [id, barrels, singles, series] of PLAN) {
    for (const k of singles) logC(craterRows, craterSingle(id, k, barrels, (sb += 1000), NC), 'krater');
    for (const k of series) logC(ttkRows, craterTtk(id, k, barrels, (sb += 1000), NT, 900), 'seria');
  }
}
const elapsed = (performance.now() - t0) / 1000;

// ---------------- raport ----------------
const lines = [];
lines.push(`# Bilans mechaniki broni z dema — ${N} strzałów na scenariusz (${elapsed.toFixed(0)} s)`);
lines.push('');
lines.push('Pociski: trafienia, rykoszety, przejścia na wylot i zakleszczenia; obrażenia HP bezpośrednie, strata HP z sufitem strukturalnym (suma po celach), zabite węzły (kratery wejścia, wyjścia, zakleszczenia). PRZED = dzisiejsza gra, PO = mechanika z dema.');
lines.push('');
lines.push('| Broń | Scenariusz | Tryb | trafienia | rykoszety | na wylot | zakleszczenia | kadłuby / strzał | HP / strzał | strata HP / strzał | węzły / strzał | węzły kraterów wyjścia |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  if (r.weapon === 'hexlance_siege') continue;
  for (const mode of ['old', 'new']) {
    const m = r[mode];
    lines.push(`| ${r.weapon} | ${r.scenario} | ${mode === 'old' ? 'PRZED' : 'PO'} | ${pct(m.hitRate * N, N)} | ${pct(m.ricochetRate * N, N)} | ${pct(m.exitRate * N, N)} | ${pct(m.stuckRate * N, N)} | ${m.hullsPerShot.toFixed(2)} | ${f1(m.directPerShot)} | ${f1(m.lossPerShot)} | ${m.killedPerShot.toFixed(2)} | ${m.exitCraterKilled.toFixed(2)} |`);
  }
}
lines.push('');
lines.push('Kolumna — strata HP na kadłub (fregata / niszczyciel / pancernik):');
for (const r of results.filter((x) => x.scenario.startsWith('kolumna'))) {
  lines.push(`- ${r.weapon}: PRZED ${r.old.lossPerHull.map(f1).join(' / ')}, PO ${r.new.lossPerHull.map(f1).join(' / ')}`);
}
lines.push('');
lines.push('Hexlance: cel dryfuje 0–150 j/s i obraca się ±0,05 rad/s między strzałami serii (co burstDelay), Atlas stoi; bez obrażeń HP — strata z sufitu strukturalnego. Węzły utracone = zniszczone rzazem + odcięte w odłamy.');
lines.push('');
lines.push('| Hexlance | cięć na naciśnięcie | węzły utracone / naciśnięcie | strata HP / naciśnięcie | węzły zniszczone kolejnymi cięciami serii |');
lines.push('|---|---|---|---|---|');
for (const r of results.filter((x) => x.weapon === 'hexlance_siege')) {
  for (const mode of ['old', 'new']) {
    const m = r[mode];
    lines.push(`| ${r.scenario} ${mode === 'old' ? 'PRZED' : 'PO'} | ${m.shots} | ${m.killedPerPress.toFixed(1)} | ${f1(m.lossPerPress)} | ${m.cutByShot.map((v) => v.toFixed(1)).join(' / ')} |`);
  }
}
lines.push('');
// DPS: strata HP na strzał / (przeładowanie + ładowanie); PRZED bez ładowania.
lines.push('| Broń (scenariusz) | dps PRZED | dps PO | zmiana |');
lines.push('|---|---|---|---|');
for (const r of results) {
  if (r.weapon === 'hexlance_siege') continue;
  const def = MASTER_WEAPONS[r.weapon];
  const before = r.old.lossPerShot / def.cooldown;
  const after = r.new.lossPerShot / (def.cooldown + chargeTimeOf(def));
  lines.push(`| ${r.weapon} (${r.scenario}) | ${f1(before)} | ${f1(after)} | ${before > 0 ? `${(100 * (after / before - 1)).toFixed(1)}%` : '—'} |`);
}
if (craterRows.length || ttkRows.length) {
  lines.push('');
  lines.push(`## Kratery (zadanie 25c) — kod kraterów tego drzewa${rocketCraterHit ? ' (rakieta: krater gry)' : ' (rakieta bez krateru)'}`);
  lines.push('');
  lines.push('Trafienie (salwa Yamato = 3 lufy) w świeży kadłub w losowy punkt z losowego namiaru: zabite i odcięte węzły, strata HP (obrażenia + sufit strukturalny), rozpady (odłam → wrak).');
  lines.push('');
  lines.push('| Broń | Cel (węzłów) | lufy | trafienia | węzły / strzał | % kadłuba | HP / strzał | strata HP / strzał | dps | rozpady |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of craterRows) {
    const def = MASTER_WEAPONS[r.weapon];
    const cyc = (def.cooldown || 1) + chargeTimeOf(def);
    lines.push(`| ${r.weapon} | ${r.target} (${r.nodes}) | ${r.barrels} | ${pct(r.hitRate * r.n, r.n)} | ${r.killedPerShot.toFixed(1)} | ${(100 * r.killedPerShot / r.nodes).toFixed(1)}% | ${f1(r.directPerShot)} | ${f1(r.lossPerShot)} | ${f1(r.lossPerShot / cyc)} | ${pct(r.splitRate * r.n, r.n)} |`);
  }
  lines.push('');
  lines.push('Czas do zniszczenia: seria z jednego namiaru w żywy węzeł najbliżej środka kadłuba (rozrzut broni, drżenie celowania ±15 j.), HP = min(HP − obrażenia, sufit) po każdym strzale; cykl = przeładowanie + ładowanie; limit 900 strzałów.');
  lines.push('');
  lines.push('| Broń | Cel | próby | strzały do zniszczenia | czas [s] | maks. strzałów | zniszczenie przez sufit | węzły utracone | rozpady / cel |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of ttkRows) {
    lines.push(`| ${r.weapon} | ${r.target} | ${r.trials} | ${r.shotsToKill.toFixed(1)} | ${r.timeToKill.toFixed(1)} | ${r.maxShots} | ${pct(r.capKillRate * r.trials, r.trials)} | ${r.lostAtDeath.toFixed(0)} | ${r.splitsPerKill.toFixed(2)} |`);
  }
}
console.log(lines.join('\n'));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ n: N, elapsed, results, craters: craterRows, ttk: ttkRows }, null, 2));
