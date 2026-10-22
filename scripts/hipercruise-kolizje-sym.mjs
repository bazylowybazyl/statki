// Hipercruise (E5, 20–40 tys. j/s) a trafienia i kolizje — symulacja w Node na PRAWDZIWYCH modułach gry (E9, 2026-10-22).
//
// Krok fizyki 60 Hz: przy 40 tys. j/s statek pokonuje ~667 j. na krok. Gracz rusza się w kroku PRZED pociskami i rakietami
// (physicsStep: ruch gracza → SimClock.advance → rakiety → … → pociski), a trafienia liczą się przeciw pozie z KOŃCA kroku.
//
//   1. pociski  — pocisk ze stojącego działa na szybki cel (Atlas): siatka szerokiej fazy (BulletSpatialGrid, wstawienie
//                 celu w pozie końca kroku, zapytanie odcinkiem w ŚWIECIE) + wąska faza w ruchu względnym (segX0,
//                 HullBodies.sweep) kontra sam ruch względny bez siatki (prawda). Wariant „zamiecione” — cel wstawiony
//                 z drogą kroku (insertSwept).
//   2. rakiety  — zapalnik rakiety (rocketSim.js: najbliższe zbliżenie odcinka lotu do środka celu ≤ promień zapalnika)
//                 przeciw celowi w pozie końca kroku kontra ruch względny (prawda: ciągłe zbliżenie w układzie celu).
//   3. ring     — kadłub w hipercruise na płytę ringu (HaloRingCollider.constrainShip co krok): przebicie płyty
//                 (statek kończy po stronie planety), prędkość wzdłuż płyty po uderzeniu.
//
//   4. koszt    — budowa siatki pocisków i zapytania: insert kontra insertSwept (tylko jawnie, `--tryb koszt`).
//
//   node scripts/hipercruise-kolizje-sym.mjs [--tryb pociski|rakiety|ring|koszt|wszystko] [--json plik]
// Rastry kadłubów: .tmp/tunelowanie/kadluby.json (`node scripts/webgpu/tunelowanie-gra.mjs --tryb zrzut`).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { BulletSpatialGrid } = await import('../src/game/bulletSpatialGrid.js');
const { HaloRingCollider } = await import('../src/game/haloRingCollision.js');
const { haloGameToLocal } = await import('../src/game/haloRingPlanets.js');

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const TRYB = arg('tryb', 'wszystko');
const JSON_OUT = arg('json', '');
const DT = 1 / 60;
const VT = [1400, 20000, 30000, 40000];
const wyniki = { pociski: [], rakiety: [], ring: [] };
HullBodies.init();

function loadHulls() {
  const file = join(repo, '.tmp', 'tunelowanie', 'kadluby.json');
  if (!existsSync(file)) return {};
  const out = {};
  for (const k of JSON.parse(readFileSync(file, 'utf8'))) {
    if (k.brak) continue;
    out[k.key] = { key: k.key, hullProfileId: k.hullProfileId, typ: k.typ, scale: k.scale, mass: k.mass,
      img: { width: k.obraz.w, height: k.obraz.h, data: new Uint8ClampedArray(Buffer.from(k.obraz.rgba, 'base64')) } };
  }
  return out;
}
function makeEnt(spec, x, y, angle) {
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: spec.mass || 10000, visual: { spriteScale: spec.scale || 1 },
    shipFrame: spec.hullProfileId, type: spec.typ || 'frigate', name: spec.key };
  if (!HullBodies.createHull(e, spec.img, { hullProfileId: spec.hullProfileId })) throw new Error('kadłub: ' + spec.key);
  e.radius = e.beamHull.radius;
  return e;
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '—').padStart(5) + '%';

// ---------------------------------------------------------------- 1. pociski
// Cel w (0, 0), kurs +x, prędkość vt (stała; bez obrotu). Pocisk ze stojącego działa pod kątem `kat` do kursu celu
// (90° — w poprzek, 180° — czołowo, 0° — w pościgu z tyłu… pocisk szybszy od celu), celowany w punkt kadłuba z rozrzutem
// wzdłuż i w poprzek. Krok k: cel w x_k = vt·t_k; pocisk z b_{k-1} do b_k. Układ celu z końca kroku: gra — odcinek
// (b_{k-1} + vt·dt, b_k) − x_k [segX0], siatka — odcinek świata b_{k-1} → b_k przeciw komórkom celu wstawionego w x_k.
function bullets(hulls) {
  if (!hulls.atlas) { console.log('\n(brak rastrów — pomiń pociski)'); return; }
  for (const key of ['atlas', 'destroyer', 'frigate_pd']) if (hulls[key]) bulletsOn(hulls[key]);
}
function bulletsOn(spec) {
  const e = makeEnt(spec, 0, 0, 0);
  const R = e.radius;
  const len = e.beamHull.srcWidth * e.beamHull.scale;
  console.log(`\n== 1. Pociski ze stojącego działa na ${spec.key} (promień ${R.toFixed(0)} j., długość ${len.toFixed(0)} j.) ==`);
  console.log('   zgubione = trafienia ruchu względnego, których siatka szerokiej fazy nie podała (odsetek trafień)');
  const VB = [3000, 7000, 15000];
  const KATY = [90, 135, 180, 45];
  const grid = new BulletSpatialGrid();
  const proxy = { x: 0, y: 0, radius: R };
  for (const vt of VT) {
    let line = `vt ${String(vt).padStart(5)} |`;
    const row = { cel: spec.key, vt, v: {} };
    for (const vb of VB) for (const kat of KATY) {
      const a = kat * Math.PI / 180;
      const dx = Math.cos(a), dy = Math.sin(a);
      if (vb * dx <= vt && kat < 90) { row.v[`${vb}/${kat}`] = null; continue; }   // pościg wolniejszy od celu
      let hitsTrue = 0, lostGrid = 0, lostSwept = 0;
      const N = 300;
      for (let i = 0; i < N; i++) {
        // Punkt celowania na kadłubie (układ celu) i chwila trafienia tc; pocisk startuje 3000 j. wcześniej po torze
        // w świecie: b(t) = P + vb·d·(t − tc), P = punkt celowania w świecie w chwili tc (cel w vt·tc).
        const u = -len * 0.55 + (1.1 * len * (i + 0.5)) / N;
        const w = ((i * 0.618034) % 1 - 0.5) * 300;
        const ph = (i * 0.414214) % 1;
        const tc = 1 + ph * DT;
        const Px = vt * tc + u, Py = w;
        const t0 = tc - 3000 / vb;
        let hitT = false, hitG = false, hitS = false;
        for (let k = Math.ceil(t0 / DT) + 1; k * DT < tc + 3000 / vb; k++) {
          const ta = Math.max(t0, (k - 1) * DT), tb = k * DT;
          const bx0 = Px + vb * dx * (ta - tc), by0 = Py + vb * dy * (ta - tc);
          const bx1 = Px + vb * dx * (tb - tc), by1 = Py + vb * dy * (tb - tc);
          const xk = vt * tb;
          const span = tb - ta;
          // ruch względny, układ celu (cel w 0, 0 — HullBodies w pozie startowej encji)
          const sx0 = bx0 + vt * span - xk, sy0 = by0, sx1 = bx1 - xk, sy1 = by1;
          const rel = !!HullBodies.sweep(e, sx0, sy0, sx1, sy1, 0);
          if (!rel) continue;
          hitT = true;
          // siatka: wstawienie w pozie końca kroku, zapytanie odcinkiem świata
          grid.clear(); proxy.x = xk; proxy.y = 0; grid.insert(proxy, R);
          if (grid.getPotentialTargetsAlongSegment(bx0, by0, bx1, by1, 0) > 0) hitG = true;
          grid.clear();
          if (typeof grid.insertSwept === 'function') grid.insertSwept(proxy, R, vt * DT, 0); else grid.insert(proxy, R);
          if (grid.getPotentialTargetsAlongSegment(bx0, by0, bx1, by1, 0) > 0) hitS = true;
          break;
        }
        if (hitT) { hitsTrue++; if (!hitG) lostGrid++; if (!hitS) lostSwept++; }
      }
      row.v[`${vb}/${kat}`] = { trafien: hitsTrue, zgubione: hitsTrue ? lostGrid / hitsTrue : 0, zgubioneZamiecione: hitsTrue ? lostSwept / hitsTrue : 0 };
      line += ` ${vb}/${kat}°:${pct(lostGrid, hitsTrue)}→${pct(lostSwept, hitsTrue)}`;
    }
    console.log(line);
    wyniki.pociski.push(row);
  }
  HullBodies.release(e);
}

// ---------------------------------------------------------------- 2. rakiety
// Zapalnik jak w rocketSim.js: odcinek lotu rakiety w kroku (prevTravelPos → position), najbliższy punkt do środka celu
// z KOŃCA kroku, detonacja przy odległości ≤ fuse. Prawda: to samo w układzie celu (odcinek przesunięty o v_celu·dt).
// Rakieta leci prosto (bez naprowadzania) pod kątem `kat` do kursu celu, chybienie celowane `miss` od środka.
function rockets() {
  console.log('\n== 2. Zapalnik rakiety na szybki cel (fuse = max(80, 0,9 × promień celu): Atlas 777, niszczyciel ~160, fregata 80) ==');
  console.log('   fałszywe = detonacja, choć w układzie celu rakieta mija zapalnik; zgubione = odwrotnie (odsetek prób)');
  for (const fuse of [777, 160, 80]) rocketsFuse(fuse);
}
function rocketsFuse(fuse) {
  console.log(`-- zapalnik ${fuse} j.`);
  const VR = [2500, 6000];
  const KATY = [90, 180, 135];
  for (const vt of VT) {
    let line = `vt ${String(vt).padStart(5)} |`;
    const row = { fuse, vt, v: {} };
    for (const vr of VR) for (const kat of KATY) {
      const a = kat * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
      let fals = 0, lost = 0, N = 0;
      for (let i = 0; i < 400; i++) {
        const miss = (i / 399) * fuse * 2;               // odległość toru (w świecie) od środka celu w chwili tc
        const ph = (i * 0.618034) % 1;
        const tc = 1 + ph * DT;
        // punkt toru rakiety w chwili tc: obok celu (cel w vt·tc, 0), przesunięty w poprzek toru rakiety o miss
        const Px = vt * tc - dy * miss, Py = dx * miss;
        const t0 = tc - 2;
        let game = false, truth = false;
        for (let k = Math.ceil(t0 / DT) + 1; k * DT < tc + 2; k++) {
          const ta = (k - 1) * DT, tb = k * DT;
          const x1 = Px + vr * dx * (ta - tc), z1 = Py + vr * dy * (ta - tc);
          const x2 = Px + vr * dx * (tb - tc), z2 = Py + vr * dy * (tb - tc);
          const tx = vt * tb, ty = 0;
          const closest = (ax, az) => {
            const sx = x2 - ax, sz = z2 - az, l2 = sx * sx + sz * sz;
            let t = l2 > 1e-9 ? ((tx - ax) * sx + (ty - az) * sz) / l2 : 1;
            t = Math.max(0, Math.min(1, t));
            const cx = ax + sx * t, cz = az + sz * t;
            return Math.sqrt((tx - cx) * (tx - cx) + (ty - cz) * (ty - cz));
          };
          if (!game && closest(x1, z1) <= fuse) game = true;
          if (!truth && closest(x1 + vt * DT, z1) <= fuse) truth = true;
          if (game && truth) break;
        }
        N++;
        if (game && !truth) fals++;
        if (truth && !game) lost++;
      }
      row.v[`${vr}/${kat}`] = { falszywe: fals / N, zgubione: lost / N };
      line += ` ${vr}/${kat}°: ${pct(fals, N)} / ${pct(lost, N)} |`;
    }
    console.log(line);
    wyniki.rakiety.push(row);
  }
}

// ---------------------------------------------------------------- 3. ring
// Kadłub (w × h gry) leci ze stałą prędkością v na płytę ringu pod kątem `kat` do płyty (90° — prostopadle), start
// 3000 j. nad podłogą, kąt świata 0,4 rad od tranzytów. Co krok: ruch, constrainShip (jak stepShipRingCollisions — gracz
// ze ścianami portu). Pierwszy styk zrywa hipercruise (gra: resetHypercruise) — liczymy stronę płyty po kroku styku
// i prędkość, z którą statek zostaje (składowa w głąb płyty zerowana przez kolider).
const SHIPS = [
  { key: 'atlas', w: 1800, h: 806 },
  { key: 'destroyer', w: 288, h: 215 },
  { key: 'frigate', w: 192, h: 143 }
];
function ring() {
  console.log('\n== 3. Płyta ringu: przebicia (statek po stronie planety) i prędkość po uderzeniu ==');
  const VR = [6000, 12000, 20000, 30000, 40000];
  const KATY = [90, 45, 15];
  for (const id of ['earth', 'mars', 'jupiter']) {
    const col = new HaloRingCollider({ id, name: id, x: 0, y: 0 });
    const mid = (col.back + col.floorMid) * 0.5;
    // Kierunek świata z dala od tranzytów i hal (lokalny układ ringu — kąt od osi x lokalnej).
    let ang = 0;
    for (let s = 0; s < 64; s++) {
      const a = s * Math.PI * 2 / 64 + 0.05;
      const p = haloGameToLocal(col.place, Math.cos(a) * col.floorMid, Math.sin(a) * col.floorMid, { x: 0, y: 0 });
      if (!col._inTransit(p.x, p.y) && col.pointInSlab(Math.cos(a) * (col.floorMid - 5), Math.sin(a) * (col.floorMid - 5))) { ang = a; break; }
    }
    for (const sh of SHIPS) {
      for (const kat of KATY) {
        let line = `${id.padEnd(8)} płyta ${String(Math.round(col.floorMid - col.back)).padStart(4)} j. ${sh.key.padEnd(9)} ${String(kat).padStart(2)}° |`;
        const row = { ring: id, plyta: col.floorMid - col.back, statek: sh.key, kat, v: {} };
        for (const v of VR) {
          let through = 0, slideMax = 0, N = 0;
          for (let f = 0; f < 12; f++) {
            const nx = Math.cos(ang), ny = Math.sin(ang);       // na zewnątrz (habitat)
            const tx = -ny, ty = nx;
            const a = kat * Math.PI / 180;
            const vx = (-nx * Math.sin(a) + tx * Math.cos(a)) * v, vy = (-ny * Math.sin(a) + ty * Math.cos(a)) * v;
            const r0 = col.floorMid + 3000 + (f / 12) * v * DT * Math.sin(a);
            const ship = { pos: { x: nx * r0 - tx * 3000 / Math.tan(Math.max(a, 0.2)), y: ny * r0 - ty * 3000 / Math.tan(Math.max(a, 0.2)) },
              vel: { x: vx, y: vy }, angle: Math.atan2(vy, vx), w: sh.w, h: sh.h, radius: Math.hypot(sh.w, sh.h) / 2 };
            let hit = false;
            for (let k = 0; k < 600 && !hit; k++) {
              ship.pos.x += ship.vel.x * DT; ship.pos.y += ship.vel.y * DT;
              const res = col.constrainShip(ship, true);
              if (res.hit) hit = true;
              const rc = Math.hypot(ship.pos.x, ship.pos.y);
              if (rc < mid) { through++; hit = true; }
            }
            N++;
            slideMax = Math.max(slideMax, Math.hypot(ship.vel.x, ship.vel.y));
          }
          row.v[v] = { przebicia: through / N, predkoscPo: slideMax };
          line += ` ${String(v / 1000).padStart(2)}k: ${pct(through, N)} ${String(Math.round(slideMax)).padStart(5)} j/s |`;
        }
        console.log(line);
        wyniki.ring.push(row);
      }
    }
  }
}

// ---------------------------------------------------------------- 4. koszt siatki
// Budowa siatki pocisków (clear + wstawienie N celów) i 400 zapytań odcinkami pocisków na krok: insert (poza końca
// kroku) kontra insertSwept (z drogą v·dt). Cele w bitwie (kwadrat 30 × 30 km, 1400 j/s), k z nich w hipercruise.
function cost() {
  console.log('\n== 4. Koszt siatki pocisków na krok [µs]: insert → insertSwept ==');
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const [N, fast] of [[60, 0], [60, 1], [200, 0], [200, 10], [200, 50]]) {
    const ents = Array.from({ length: N }, (_, i) => {
      const a = rnd() * Math.PI * 2, v = i < fast ? 40000 : 1400;
      return { x: rnd() * 30000, y: rnd() * 30000, _blkMaxR: 80 + rnd() * 700, vx: Math.cos(a) * v, vy: Math.sin(a) * v };
    });
    const segs = Array.from({ length: 400 }, () => { const x = rnd() * 30000, y = rnd() * 30000, a = rnd() * 6.28; return [x, y, x + Math.cos(a) * 120, y + Math.sin(a) * 120]; });
    const row = { N, wHipercruise: fast };
    // Na przemian, 6 rund po 300 kroków; wynik — minimum rundy (maszyna dzieli CPU z innymi procesami).
    const best = { false: Infinity, true: Infinity }, kand = {};
    for (let round = 0; round < 6; round++) for (const swept of [false, true]) {
      const grid = new BulletSpatialGrid();
      const R = 300;
      let cand = 0;
      const t0 = process.hrtime.bigint();
      for (let r = 0; r < R; r++) {
        grid.clear();
        for (const e of ents) { if (swept) grid.insertSwept(e, e._blkMaxR, e.vx * DT, e.vy * DT); else grid.insert(e); }
        for (const s of segs) cand += grid.getPotentialTargetsAlongSegment(s[0], s[1], s[2], s[3], 2);
      }
      best[swept] = Math.min(best[swept], Number(process.hrtime.bigint() - t0) / 1000 / R);
      kand[swept] = cand / R;
    }
    for (const swept of [false, true]) row[swept ? 'zamiecione' : 'insert'] = { us: +best[swept].toFixed(1), kandydaci: +kand[swept].toFixed(1) };
    console.log(`N ${String(N).padStart(3)}, w hipercruise ${String(fast).padStart(2)}: ${row.insert.us} µs (${row.insert.kandydaci} kand.) → ${row.zamiecione.us} µs (${row.zamiecione.kandydaci} kand.)`);
    wyniki.koszt = wyniki.koszt || [];
    wyniki.koszt.push(row);
  }
}

const t0 = Date.now();
const hulls = loadHulls();
if (TRYB === 'koszt') cost();
if (TRYB === 'pociski' || TRYB === 'wszystko') bullets(hulls);
if (TRYB === 'rakiety' || TRYB === 'wszystko') rockets();
if (TRYB === 'ring' || TRYB === 'wszystko') ring();
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(wyniki, null, 1));
