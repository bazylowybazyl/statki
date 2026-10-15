// Taran a ZBIORNIK PALIWA (src/game/fuelTank.js) w Node na PRAWDZIWYM HullBodies: Atlas taranuje okręty z kilku stron
// i przy kilku prędkościach; zbiornik i rdzeń jak w grze (ReactorGame.attach → attachFuelTank, te same kadłuby co testy
// mostków). Bez przeglądarki — odpowiedź na pytania: jak często taran rozwala zbiornik, kiedy (przed śmiercią okrętu
// czy po), i ile kuli ognia wybuchu leży POD kadłubem taranującego (kadłub Atlasa jest przeszkodą gazu — komórki stałe,
// gaz w nie nie wchodzi; wrak ofiary nie jest — hostKey).
//
//   node scripts/zbiornik-taran-sym.mjs [--cele frigate,destroyer,battleship,pirate_frigate,pirate_destroyer,pirate_battleship]
//     [--strony rufa,burta-0.6,burta-0.3,burta0,burta0.3,burta0.6,dziob] [--tryby w600,w1500,szarza] [--czas 4] [--hz 60]
//     [--prog 0.5] [--json plik]   (--prog — własny próg pęknięcia zamiast reguły gry stepFuelTankRupture)
//
//   strony: burta<f> — Atlas dziobem w burtę ofiary w punkcie f wzdłuż jej długości (−1 rufa, 0 środek, 1 dziób);
//           dziob — czołowo w dziób ofiary; rufa — w rufę; musniecie — wzdłuż burty ofiary z zakładem 20 j. (otarcie).
//   tryby:  lekki — 300 j/s bez ciągu; w600 — start 600 j/s, W+Shift (150 j/s² do 1500); w1500 — 1500 j/s z W+Shift;
//           szarza — 2200 j/s, ciąg szarży (1100 j/s² do 3000). Ciąg przez cały przebieg (gracz trzyma klawisz).
//   --zgniot k=v,… — strojenie DYMU ZGNIOTU (src/game/crushSmoke.js, CRUSH_SMOKE_TUNE) bez zmiany plików; wiersz „zgniot”:
//           szczyt strat węzłów w oknie (ofiara, Atlas) i czasy dymów zgniotu; na końcu tabela dymu przy taranie wg klasy
//           ofiary i trybu: dawniej (śmierć) → + pęknięcie zbiornika → + dym zgniotu.
// Miary (czas od startu): tDmg — pierwsza martwa komórka zbiornika, tRup — zbiornik pęka (gra: stepFuelTankRupture), tDeath —
// konstrukcja ofiary < 20% (gra: applyDamageToNPC z sufitu konstrukcji — śmierć), core — ułamek martwych komórek komory
// reaktora w chwili śmierci (gra: rdzeń krytyczny → detonacja zamiast zbiornika), covDeath / covRup — ułamek kuli ognia
// wybuchu zbiornika (promień size × fire profilu) zakryty żywymi węzłami Atlasa w tej chwili (covDeath — tylko, gdy zbiornik
// nie pękł wcześniej: inaczej wybuchem śmierci jest wybuch pęknięcia).
import { writeFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { createReactorCoreGame } = await import('../src/game/reactorCoreGame.js');
const FT = await import('../src/game/fuelTank.js');
const { reactorCellNode } = await import('../src/game/reactorCore.js');
const { fireRadius, explosionProfile } = await import('../src/3d/explosions/explosionRecipes.js');
const { makeBridgeShip, bridgeHullImage } = await import('../tests/helpers/bridgeHulls.mjs');
const { CollisionFX } = await import('../src/vfx/collisionFx.js');
const { createCrushSmoke, CRUSH_SMOKE_TUNE } = await import('../src/game/crushSmoke.js');

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const CELE = String(arg('cele', 'frigate,destroyer,battleship,pirate_frigate,pirate_destroyer,pirate_battleship')).split(',');
const STRONY = String(arg('strony', 'rufa,burta-0.6,burta-0.3,burta0,burta0.3,burta0.6,dziob')).split(',');
const TRYBY = String(arg('tryby', 'w600,w1500,szarza')).split(',');
const CZAS = Number(arg('czas', 4));
const DT = 1 / Number(arg('hz', 60));
const PROG_SET = process.argv.includes('--prog');
const PROG = Number(arg('prog', 0.5));
const TRYB_DEF = {
  lekki: { v0: 300, thrust: 0, vmax: 300 },
  w600: { v0: 600, thrust: 150, vmax: 1500 },
  w1500: { v0: 1500, thrust: 150, vmax: 1500 },
  szarza: { v0: 2200, thrust: 1100, vmax: 3000 }
};
// DYM ZGNIOTU (src/game/crushSmoke.js — ta sama reguła co gra; --zgniot k=v,… — strojenie CRUSH_SMOKE_TUNE bez zmiany
// plików): straty węzłów poza bronią z haka HullBodies.onNodeLost, styk z CollisionFX (grind / impact).
const CRUSH_SET = Object.fromEntries(String(arg('zgniot', '')).split(',').filter(Boolean).map((p) => { const [k, v] = p.split('='); return [k, Number(v)]; }));
const crush = createCrushSmoke({ ...CRUSH_SMOKE_TUNE, ...CRUSH_SET });
const LOSS = new Map();   // encja → czasy strat węzłów (szczyt w oknie — strojenie progu)
let SIM_T = 0;

HullBodies.init();
HullBodies.onNodeLost = (e, hull, u, v, x, y) => {
  crush.lost(e, x, y, SIM_T);
  let l = LOSS.get(e); if (!l) LOSS.set(e, l = []);
  l.push(SIM_T);
};
const onContact = (ev) => { crush.contact(ev.A, SIM_T); crush.contact(ev.B, SIM_T); };
CollisionFX.on('grind', onContact);
CollisionFX.on('impact', onContact);
// Szczyt liczby strat w oknie `w` s.
function peakIn(times, w) {
  if (!times) return 0;
  let best = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] > w) j++;
    if (i - j + 1 > best) best = i - j + 1;
  }
  return best;
}
const RG = createReactorCoreGame({});

function make(key, x, y, angle) {
  const { def } = bridgeHullImage(key);
  const e = makeBridgeShip(HullBodies, key, x, y, angle);
  RG.attach(e, def.profile);
  FT.attachFuelTank(e, def.profile);
  return e;
}
// zasięg kadłuba w jego układzie (dziób = +x encji w grze): nos, rufa, pół-szerokość
const _w = { x: 0, y: 0 };
function extent(e) {
  const hull = e.beamHull, s = hull.body.nodeStore;
  const c = Math.cos(e.angle), sn = Math.sin(e.angle);
  let nose = -Infinity, tail = Infinity, halfW = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    HullBodies.nodeWorld(hull, i, _w);
    const dx = _w.x - e.x, dy = _w.y - e.y;
    const a = dx * c + dy * sn, b = -dx * sn + dy * c;
    if (a > nose) nose = a; if (a < tail) tail = a;
    if (Math.abs(b) > halfW) halfW = Math.abs(b);
  }
  return { nose, tail, halfW };
}
function release(list) {
  for (const e of list) if (e) HullBodies.release(e);
  for (const w of window.wrecks) HullBodies.release(w);
  window.wrecks.length = 0;
}
// komórki zbiornika: żywe u gospodarza, żywe na wrakach rodu, martwe
function tankCells(e) {
  const t = e.fuelTank;
  let host = 0, wreck = 0;
  const hh = e.beamHull?.entity === e ? e.beamHull : null;
  for (let k = 0; k < t.cellX.length; k++) {
    if (hh && !hh.body.dead && reactorCellNode(hh, t.cellX[k], t.cellY[k]) >= 0) { host++; continue; }
    for (const w of window.wrecks) {
      const wh = w.beamHull;
      if (!wh || wh.entity !== w || wh.body.dead || wh.dmgKey !== t.lineage) continue;
      if (reactorCellNode(wh, t.cellX[k], t.cellY[k]) >= 0) { wreck++; break; }
    }
  }
  return { host, wreck, dead: t.cellX.length - host - wreck, n: t.cellX.length };
}
function coreLost(e) {
  const c = (e.reactorCores || []).find((k) => k && !k.invalid);
  if (!c) return null;
  const hh = e.beamHull?.entity === e ? e.beamHull : null;
  let live = 0;
  for (let k = 0; k < c.cellX.length; k++) if (hh && !hh.body.dead && reactorCellNode(hh, c.cellX[k], c.cellY[k]) >= 0) live++;
  return 1 - live / c.cellX.length;
}
// Ułamek kuli (x, y, R) zakryty żywymi węzłami kadłuba `a` (węzeł bliżej niż 0,75 komórki od punktu próbki).
function coverage(a, x, y, R) {
  const hull = a.beamHull, s = hull.body.nodeStore, cs = hull.body.cellSize;
  const cells = new Map();
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    HullBodies.nodeWorld(hull, i, _w);
    if (Math.abs(_w.x - x) > R + cs || Math.abs(_w.y - y) > R + cs) continue;
    const k = Math.floor(_w.x / cs) + ',' + Math.floor(_w.y / cs);
    let l = cells.get(k); if (!l) cells.set(k, l = []);
    l.push(_w.x, _w.y);
  }
  const step = cs * 0.5, r2 = (0.75 * cs) ** 2;
  let n = 0, hit = 0;
  for (let py = y - R; py <= y + R; py += step) {
    for (let px = x - R; px <= x + R; px += step) {
      if ((px - x) ** 2 + (py - y) ** 2 > R * R) continue;
      n++;
      const cx = Math.floor(px / cs), cy = Math.floor(py / cs);
      let ok = false;
      for (let oy = -1; oy <= 1 && !ok; oy++) for (let ox = -1; ox <= 1 && !ok; ox++) {
        const l = cells.get((cx + ox) + ',' + (cy + oy));
        if (!l) continue;
        for (let j = 0; j < l.length; j += 2) if ((l[j] - px) ** 2 + (l[j + 1] - py) ** 2 < r2) { ok = true; break; }
      }
      if (ok) hit++;
    }
  }
  return n ? hit / n : 0;
}
function blastCoverageAt(atlas, tb) {
  const R = fireRadius(tb.size, explosionProfile(tb.profile));
  return { cov: coverage(atlas, tb.x, tb.y, R), R, x: tb.x, y: tb.y };
}
// wybuch śmierci: zbiornik (nie pękł wcześniej) — null, gdy pękł (gra: wybuch zbiornika już był)
function blastCoverage(victim, atlas) {
  const tb = FT.fuelTankBlast(victim, {}, { candidates: window.wrecks });
  return tb ? blastCoverageAt(atlas, tb) : null;
}

const rows = [];
for (const key of CELE) {
  const probe = make(key, 0, 0, 0);
  const V = extent(probe);
  const tank = probe.fuelTank;
  const len = V.nose - V.tail;
  const tankAlong = (() => { const tb = FT.fuelTankBlast(probe, {}); return tb.x - probe.x; })();
  release([probe]);
  const atlasProbe = make('atlas', 0, 0, 0);
  const A = extent(atlasProbe);
  release([atlasProbe]);
  console.log(`\n=== ${key}: długość ${len.toFixed(0)}, pół-szer. ${V.halfW.toFixed(0)}, zbiornik ${tank.cellX.length} kom., x=${tankAlong.toFixed(0)} od środka (${(tankAlong / (len / 2)).toFixed(2)} pół-dł.), wybuch ${tank.profile} size ${tank.size.toFixed(0)} ===`);
  for (const side of STRONY) for (const mode of TRYBY) {
    const md = TRYB_DEF[mode];
    window.wrecks.length = 0;
    const victim = make(key, 0, 0, 0);
    let ax, ay, aang;
    if (side === 'dziob') { ax = V.nose + A.nose + 120; ay = 0; aang = Math.PI; }
    else if (side === 'rufa') { ax = V.tail - A.nose - 120; ay = 0; aang = 0; }
    else if (side === 'musniecie') { ax = V.tail - A.nose - 120; ay = -(V.halfW + A.halfW - 20); aang = 0; }
    else {
      const f = Number(side.slice(5));
      ax = (V.nose + V.tail) / 2 + f * len / 2; ay = -(V.halfW + A.nose + 120); aang = Math.PI / 2;
    }
    const atlas = make('atlas', ax, ay, aang);
    const hx = Math.cos(aang), hy = Math.sin(aang);
    atlas.vx = hx * md.v0; atlas.vy = hy * md.v0;
    const ents = [atlas, victim];
    const steps = Math.round(CZAS / DT);
    let tDmg = null, tRup = null, tAll = null, tDeath = null, tContact = null;
    let covRup = null, covDeath = null, coreAtDeath = null, tankAtDeath = null, coreAtRup = null;
    crush.reset(); LOSS.clear(); SIM_T = 0;
    const puffs = { victim: [], atlas: [], wreck: [] };
    for (let k = 0; k < steps; k++) {
      const along = atlas.vx * hx + atlas.vy * hy;
      if (along < md.vmax) { atlas.vx += hx * md.thrust * DT; atlas.vy += hy * md.thrust * DT; }
      for (const e of [...ents, ...window.wrecks]) if (!e.dead) { e.x += e.vx * DT; e.y += e.vy * DT; e.angle += (e.angVel || 0) * DT; }
      SIM_T = (k + 1) * DT;
      HullBodies.step(DT, [...ents, ...window.wrecks]);
      const t = (k + 1) * DT;
      if (tContact === null && HullBodies.hasContact(atlas, victim)) tContact = t;
      const tc = tankCells(victim);
      const deadFrac = tc.dead / tc.n;
      if (tDmg === null && tc.dead > 0) tDmg = t;
      // pęknięcie = reguła gry (stepFuelTankRupture, FUEL_TANK_TUNE.ruptureDeadFrac); --prog tylko gdy podany jawnie
      if (tRup === null) {
        const rb = PROG_SET ? (deadFrac >= PROG ? FT.fuelTankBlast(victim, {}, { candidates: window.wrecks }) : null)
          : FT.stepFuelTankRupture(victim, {}, { candidates: window.wrecks, time: t });
        if (rb) { tRup = t; covRup = blastCoverageAt(atlas, rb); coreAtRup = coreLost(victim); }
      }
      if (tAll === null && tc.dead === tc.n) tAll = t;
      const st = HullBodies.structuralState(victim);
      if (tDeath === null && (!st || st.ratio < 0.2)) {
        tDeath = t; covDeath = blastCoverage(victim, atlas); coreAtDeath = coreLost(victim); tankAtDeath = tc;
      }
      // dym zgniotu jak w grze (po pęknięciu zbiornika i śmierci — kolejność kroku integralności): wraki nie dymią, okręt po świeżym pęknięciu zbiornika / po śmierci też nie
      crush.step(t, (e, x, y, n) => {
        if (e === atlas) { puffs.atlas.push(+t.toFixed(2)); return true; }
        if (e !== victim) { puffs.wreck.push(+t.toFixed(2)); return false; }
        if (tDeath !== null) return false;
        if (victim.fuelTank?.ruptured && t - victim.fuelTank.rupturedAt < crush.tune.afterRupture) return false;
        puffs.victim.push(+t.toFixed(2));
        return true;
      });
    }
    const st = HullBodies.structuralState(victim);
    const tcEnd = tankCells(victim);
    const r = {
      cel: key, strona: side, tryb: mode, tContact,
      tDmg, tRup, tAll, tDeath, ratioEnd: st ? +st.ratio.toFixed(2) : 0,
      tankEnd: tcEnd, tankAtDeath, coreAtRup, coreAtDeath,
      covRup: covRup ? +covRup.cov.toFixed(2) : null, covDeath: covDeath ? +covDeath.cov.toFixed(2) : null,
      R: covDeath?.R ?? covRup?.R ?? null,
      zgniot: { ofiara: puffs.victim, atlas: puffs.atlas, wrak: puffs.wreck,
        pikOfiara: peakIn(LOSS.get(victim), crush.tune.window), pikAtlas: peakIn(LOSS.get(atlas), crush.tune.window),
        stratyOfiara: LOSS.get(victim)?.length || 0, stratyAtlas: LOSS.get(atlas)?.length || 0 }
    };
    rows.push(r);
    const f = (v) => (v === null || v === undefined ? '  —  ' : (typeof v === 'number' ? v.toFixed(2).padStart(5) : String(v)));
    const z = r.zgniot;
    console.log(`${side.padEnd(10)} ${mode.padEnd(7)} styk ${f(tContact)}  zbiornik: 1.kom ${f(tDmg)} ≥${PROG * 100}% ${f(tRup)} cały ${f(tAll)} | śmierć ${f(tDeath)} (konstr. koniec ${f(r.ratioEnd)}) | zbiornik przy śmierci ${tankAtDeath ? `${tankAtDeath.dead}/${tankAtDeath.n} martwe, ${tankAtDeath.wreck} na wraku` : '—'} | rdzeń martwy ${f(coreAtDeath ?? coreAtRup)} | kula pod Atlasem: przy pęknięciu ${f(r.covRup)} przy śmierci ${f(r.covDeath)}`);
    console.log(`${''.padEnd(18)} zgniot: pik/${crush.tune.window}s ofiara ${z.pikOfiara} Atlas ${z.pikAtlas} (strat ${z.stratyOfiara} / ${z.stratyAtlas}) | dym zgniotu: ofiara [${z.ofiara.join(' ')}] Atlas [${z.atlas.join(' ')}] wraki ${z.wrak.length}`);
    release(ents);
  }
}
const out = arg('json', '');
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));

// podsumowanie
const n = rows.length;
const ruptured = rows.filter((r) => r.tRup !== null);
const died = rows.filter((r) => r.tDeath !== null);
const rupBeforeDeath = rows.filter((r) => r.tRup !== null && (r.tDeath === null || r.tRup <= r.tDeath));
const rupNoDeath = rows.filter((r) => r.tRup !== null && r.tDeath === null);
const diedNoRup = rows.filter((r) => r.tDeath !== null && r.tRup === null);
const cov = died.map((r) => r.covDeath).filter((v) => v !== null).sort((a, b) => a - b);
const covR = ruptured.map((r) => r.covRup).filter((v) => v !== null).sort((a, b) => a - b);
const med = (a) => (a.length ? a[a.length >> 1] : null);
console.log(`\nprzebiegów ${n}: zbiornik pęka (≥${PROG * 100}%) ${ruptured.length}, ofiara ginie ${died.length}, pęka przed śmiercią ${rupBeforeDeath.length}, pęka bez śmierci ${rupNoDeath.length}, ginie bez pęknięcia ${diedNoRup.length}`);
console.log(`kula pod Atlasem przy śmierci: mediana ${med(cov)}, > 50%: ${cov.filter((v) => v > 0.5).length}/${cov.length}; przy pęknięciu: mediana ${med(covR)}, > 50%: ${covR.filter((v) => v > 0.5).length}/${covR.length}`);
// Dym przy taranie wg klasy ofiary i trybu: śmierć / pęknięcie zbiornika / + dym zgniotu (ofiary albo Atlasa).
const klasa = (k) => /frigate/.test(k) ? 'fregaty' : /destroyer/.test(k) ? 'niszczyciele' : 'pancerniki';
const grupy = new Map();
for (const r of rows) {
  const k = `${klasa(r.cel)} ${r.strona === 'musniecie' ? 'muśnięcie' : 'taran'} ${r.tryb}`;
  let g = grupy.get(k); if (!g) grupy.set(k, g = { n: 0, smierc: 0, peka: 0, zgniot: 0, ofiara: 0, atlas: 0 });
  g.n++;
  const dead = r.tDeath !== null, rup = r.tRup !== null, zo = r.zgniot.ofiara.length > 0, za = r.zgniot.atlas.length > 0;
  if (dead) g.smierc++;
  if (dead || rup) g.peka++;
  if (dead || rup || zo || za) g.zgniot++;
  g.ofiara += r.zgniot.ofiara.length; g.atlas += r.zgniot.atlas.length;
}
console.log('\ndym przy taranie (przebiegi z dymem / wszystkie): dawniej (śmierć) → + pęknięcie zbiornika → + dym zgniotu; dymów zgniotu ofiara / Atlas');
for (const [k, g] of grupy) console.log(`${k.padEnd(32)} ${g.smierc}/${g.n} → ${g.peka}/${g.n} → ${g.zgniot}/${g.n}   (${g.ofiara} / ${g.atlas})`);
