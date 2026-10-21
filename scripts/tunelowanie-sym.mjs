// Tunelowanie kadłubów na silniku belek — symulacja w Node na PRAWDZIWYM HullBodies (2026-10-11).
//
// Silnik belek szuka styków dyskretnie: węzły ciała w pozach z KOŃCA kroku, styk = węzeł drugiego ciała bliżej niż
// contactDist (1,1 komórki). Krok fizyki gry: 60 Hz (domyślnie od 2026-10-11), 120 Hz (`?physHz=120`).
// Dla każdej pary (A leci stałą prędkością wzdłuż d, B stoi) liczymy geometrycznie, przy jakim przesunięciu A
// sztywne kadłuby PO RAZ PIERWSZY wchodzą w zasięg styku (sTrue) i kiedy go opuszczają (sLast), a potem puszczamy
// prawdziwy krok gry (ruch encji, HullBodies.step) od przesunięcia sTrue − v·dt·(1 + faza):
//   przelot   — para przeszła przez cały zasięg styku i silnik nie zgłosił ani jednego styku,
//   głębokość — o ile A wjechał za pierwszy PEWNY styk (para węzłów wchodzi w zasięg co najmniej o ¼ komórki;
//               pary styczne — okno styku ~1 j. — nie liczą się), zanim silnik go zauważył (w komórkach).
//
//   node scripts/tunelowanie-sym.mjs [--tryb kadluby|cienkie|pociski|wszystko] [--fazy 12] [--json plik] [--v 4200,8700]
// --v: własne prędkości trybu kadłubów [j/s] (np. wyjście z warpa z pędem: fregaty 4200 + 4500 czołowo = 8700).
// Rastry kadłubów z gry: .tmp/tunelowanie/kadluby.json (`node scripts/webgpu/tunelowanie-gra.mjs --tryb zrzut`).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const TRYB = arg('tryb', 'wszystko');
const FAZY = Math.max(1, Number(arg('fazy', 12)) | 0);
const JSON_OUT = arg('json', '');
const V_ARG = arg('v', '');
const DTS = [1 / 60, 1 / 120];
HullBodies.init();
const D = HullBodies.engine;

// ---------------------------------------------------------------- kadłuby
function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}

function loadHulls() {
  const file = join(repo, '.tmp', 'tunelowanie', 'kadluby.json');
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, 'utf8'));
  return list.filter((k) => !k.brak).map((k) => ({
    key: k.key, hullProfileId: k.hullProfileId, typ: k.typ, scale: k.scale, mass: k.mass,
    img: { width: k.obraz.w, height: k.obraz.h, data: new Uint8ClampedArray(Buffer.from(k.obraz.rgba, 'base64')) }
  }));
}

function makeEnt(spec, x, y, angle) {
  const e = { x, y, vx: 0, vy: 0, angle, angVel: 0, mass: spec.mass || 10000, visual: { spriteScale: spec.scale || 1 },
    shipFrame: spec.hullProfileId, type: spec.typ || 'frigate', name: spec.key };
  if (!HullBodies.createHull(e, spec.img, { hullProfileId: spec.hullProfileId })) throw new Error('kadłub: ' + spec.key);
  return e;
}

// Żywe węzły ciała w świecie GRY (y w dół): ciało ma pozycję i obrót w układzie silnika (Y = −y gry).
function nodesWorld(e) {
  const b = e.beamHull.body, s = b.nodeStore;
  const th = 2 * Math.atan2(b.quat.z, b.quat.w), c = Math.cos(th), n = Math.sin(th);
  const out = [];
  for (let i = 0; i < s.count; i++) {
    if (!s.active[i]) continue;
    const X = b.pos.x + c * s.x[i] - n * s.y[i], Y = b.pos.y + n * s.x[i] + c * s.y[i];
    out.push(X, -Y);
  }
  return Float64Array.from(out);
}

// Okno styku sztywnych kadłubów: A przesuwa się o s wzdłuż d (jednostkowy), B stoi. Para (a, b) jest w zasięgu, gdy
// |(a + s d) − b| < cd. Zwraca [sTrue, sLast] (NaN — tory się nie spotykają) i grubość pary wzdłuż d.
function contactWindow(PA, PB, dx, dy, cd) {
  // cd — zasięg styku; pewny styk: contactWindow(…, cd − ¼ komórki).
  const nb = PB.length / 2;
  const bu = new Float64Array(nb), bw = new Float64Array(nb), order = new Int32Array(nb);
  for (let j = 0; j < nb; j++) { bu[j] = PB[2 * j] * dx + PB[2 * j + 1] * dy; bw[j] = -PB[2 * j] * dy + PB[2 * j + 1] * dx; order[j] = j; }
  order.sort((p, q) => bw[p] - bw[q]);
  const sw = Float64Array.from(order, (j) => bw[j]);
  const lower = (v) => { let lo = 0, hi = nb; while (lo < hi) { const m = (lo + hi) >> 1; if (sw[m] < v) lo = m + 1; else hi = m; } return lo; };
  let sTrue = Infinity, sLast = -Infinity;
  const cd2 = cd * cd;
  for (let i = 0; i < PA.length; i += 2) {
    const au = PA[i] * dx + PA[i + 1] * dy, aw = -PA[i] * dy + PA[i + 1] * dx;
    for (let k = lower(aw - cd); k < nb && sw[k] < aw + cd; k++) {
      const j = order[k], dw = aw - bw[j];
      const h = Math.sqrt(cd2 - dw * dw);
      const mid = bu[j] - au;
      if (mid - h < sTrue) sTrue = mid - h;
      if (mid + h > sLast) sLast = mid + h;
    }
  }
  return Number.isFinite(sTrue) ? { sTrue, sLast } : null;
}

function cleanup(...ents) {
  for (const e of ents) if (e) HullBodies.release(e);
  for (const w of window.wrecks) HullBodies.release(w);
  window.wrecks.length = 0;
}

// Jeden przebieg: A startuje sTrue − v·dt·(1 + faza) przed pierwszym możliwym stykiem, krok jak w grze (ruch encji,
// potem HullBodies.step), aż do pierwszego styku pary albo do przejścia całego okna styku.
function runOnce(specA, poseA, specB, poseB, dir, v, dt, phase, win, sure) {
  const A = makeEnt(specA, poseA.x, poseA.y, poseA.angle);
  const B = makeEnt(specB, poseB.x, poseB.y, poseB.angle);
  try {
    const s0 = win.sTrue - v * dt * (1 + phase);
    A.x += dir.x * s0; A.y += dir.y * s0;
    A.vx = dir.x * v; A.vy = dir.y * v;
    let s = s0;
    const maxSteps = Math.ceil((win.sLast - s0) / (v * dt)) + 2;
    for (let k = 1; k <= maxSteps; k++) {
      A.x += A.vx * dt; A.y += A.vy * dt;
      s += v * dt;
      HullBodies.step(dt, [A, B, ...window.wrecks]);
      if (HullBodies._pairs.get(A)?.get(B)) return { contact: true, depth: s - sure.sTrue, steps: k };
      // Bez styku silnik nie zmienia ruchu; gdyby jednak zmienił (syncOut) — trzymamy prędkość z założenia.
      A.vx = dir.x * v; A.vy = dir.y * v;
      if (s > win.sLast) break;
    }
    return { contact: false, depth: NaN, steps: maxSteps };
  } finally { cleanup(A, B); }
}

// Seria faz dla jednej konfiguracji i prędkości: odsetek przelotów, głębokość styku (komórki) — średnia i maks.
function series(specA, poseA, specB, poseB, dir, v, dt, win, sure, cs) {
  let miss = 0, sum = 0, max = 0, n = 0;
  for (let f = 0; f < FAZY; f++) {
    const r = runOnce(specA, poseA, specB, poseB, dir, v, dt, (f + 0.5) / FAZY, win, sure);
    if (!r.contact) { miss++; continue; }
    const d = r.depth / cs;
    sum += d; n++; if (d > max) max = d;
  }
  return { przeloty: miss / FAZY, glebSr: n ? sum / n : NaN, glebMax: n ? max : NaN };
}

const fmtPct = (x) => `${Math.round(x * 100)}%`.padStart(4);
const fmtC = (x) => (Number.isFinite(x) ? x.toFixed(2) : '  — ').padStart(5);
const wyniki = { cienkie: [], kadluby: [], pociski: [] };

// ---------------------------------------------------------------- 1. cienkie na cienkie (płyty z prostokątów)
// A i B — płyty 600 px długie, `rows` komórek grube; A leci w poprzek swojej długości (cienka wzdłuż ruchu),
// B leży równolegle (też cienka wzdłuż ruchu) albo w poprzek (gruba wzdłuż ruchu — kontrola: siatka B łapie A).
function thinPlates() {
  const cs = D.config.cellSize;
  const V = [500, 1000, 1500, 2000, 2500, 3000, 4000, 6000];
  console.log('\n== 1. Cienkie na cienkie: płyta A (rzędy wzdłuż ruchu) przez płytę B, odsetek przelotów bez styku ==');
  for (const [ra, rb, cross] of [[1, 1, false], [2, 1, false], [2, 2, false], [3, 3, false], [1, 1, true]]) {
    const specA = { key: `płyta${ra}`, img: plate(600, ra * 15), scale: 1, mass: 20000, typ: 'frigate' };
    const specB = { key: `płyta${rb}`, img: plate(600, rb * 15), scale: 1, mass: 20000, typ: 'frigate' };
    // Kąt 0: długość płyty wzdłuż x gry; A leci w +y (w poprzek siebie), B równolegle albo obrócona o 90°.
    const poseA = { x: 0, y: -400, angle: 0 }, poseB = { x: 0, y: 0, angle: cross ? Math.PI / 2 : 0 };
    const dir = { x: 0, y: 1 };
    const A0 = makeEnt(specA, poseA.x, poseA.y, poseA.angle), B0 = makeEnt(specB, poseB.x, poseB.y, poseB.angle);
    const cd = (A0.beamHull.cellSize + B0.beamHull.cellSize) * (D.config.nodeRadius / D.config.cellSize);
    const win = contactWindow(nodesWorld(A0), nodesWorld(B0), dir.x, dir.y, cd);
    const sure = contactWindow(nodesWorld(A0), nodesWorld(B0), dir.x, dir.y, cd - 0.25 * cs);
    cleanup(A0, B0);
    const label = `A ${ra} rz. × B ${cross ? 'w poprzek' : rb + ' rz.'}`;
    for (const dt of DTS) {
      const row = { para: label, hz: Math.round(1 / dt), okno: (win.sLast - win.sTrue) / cs, v: {} };
      let line = `${label.padEnd(18)} ${String(Math.round(1 / dt)).padStart(3)} Hz  okno ${row.okno.toFixed(1)} kom. |`;
      for (const v of V) {
        const r = series(specA, poseA, specB, poseB, dir, v, dt, win, sure, cs);
        row.v[v] = r;
        line += ` ${v}:${fmtPct(r.przeloty)}`;
      }
      console.log(line);
      wyniki.cienkie.push(row);
    }
  }
}

// ---------------------------------------------------------------- 2. prawdziwe kadłuby z gry
// A leci dziobem (kurs 0, +x gry) w B: czołowo (B dziobem do A), burtą (B w poprzek) i po brzegu (przesunięcie w bok
// tak, że zostaje mały zakład kadłubów — końce, anteny, wysięgniki). Prędkości gry: lot bojowy, dopalacz 1500,
// PRZELOT 3000, czołówka dwóch szybkich, rampa wyjścia z warpa (9 L/s, 12–30 tys. j/s), skok (260 tys. j/s).
function realHulls(hulls) {
  if (!hulls.length) { console.log('\n(brak .tmp/tunelowanie/kadluby.json — najpierw `node scripts/webgpu/tunelowanie-gra.mjs --tryb zrzut`)'); return; }
  const by = Object.fromEntries(hulls.map((h) => [h.key, h]));
  const V = V_ARG ? V_ARG.split(',').map(Number).filter((v) => v > 0) : [500, 1500, 3000, 6000, 16200, 30000, 260000];
  const pairs = [
    ['atlas', 'frigate_pd'], ['atlas', 'destroyer'], ['atlas', 'pirate_battleship'], ['atlas', 'pirate_supercapital'],
    ['frigate_pd', 'frigate_pd'], ['destroyer', 'frigate_pd'], ['destroyer', 'destroyer']
  ].filter(([a, b]) => by[a] && by[b]);
  console.log('\n== 2. Prawdziwe kadłuby: odsetek przelotów bez styku | głębokość pierwszego styku śr./maks. [komórki] ==');
  console.log('   prędkości: ' + V.join(', ') + ' j/s');
  for (const [ka, kb] of pairs) {
    const specA = by[ka], specB = by[kb];
    for (const uklad of ['czołowo', 'burtą', 'brzeg-1', 'brzeg-0.3']) {
      const angB = uklad === 'burtą' ? Math.PI / 2 : Math.PI;
      const poseA = { x: -4000, y: 0, angle: 0 };
      const dir = { x: 1, y: 0 };
      const B0 = makeEnt(specB, 0, 0, angB);
      const A0 = makeEnt(specA, poseA.x, poseA.y, 0);
      const cs = Math.max(A0.beamHull.cellSize, B0.beamHull.cellSize);
      const cd = (A0.beamHull.cellSize + B0.beamHull.cellSize) * (D.config.nodeRadius / D.config.cellSize);
      const PA0 = nodesWorld(A0), PB = nodesWorld(B0);
      let lat = 0;
      if (uklad.startsWith('brzeg')) {
        // Największe przesunięcie w bok, przy którym tory jeszcze się spotykają (bisekcja), minus zakład w komórkach.
        const k = Number(uklad.split('-')[1]);
        const shifted = (dy) => { const P = Float64Array.from(PA0); for (let i = 1; i < P.length; i += 2) P[i] += dy; return P; };
        let lo = 0, hi = 4000;
        for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (contactWindow(shifted(m), PB, 1, 0, cd)) lo = m; else hi = m; }
        lat = lo - k * cs;
      }
      cleanup(A0, B0);
      poseA.y = lat;
      const A1 = makeEnt(specA, poseA.x, poseA.y, 0), B1 = makeEnt(specB, 0, 0, angB);
      const win = contactWindow(nodesWorld(A1), nodesWorld(B1), 1, 0, cd);
      const sure = contactWindow(nodesWorld(A1), nodesWorld(B1), 1, 0, cd - 0.25 * cs);
      cleanup(A1, B1);
      if (!win || !sure) continue;
      for (const dt of DTS) {
        const row = { para: `${ka} → ${kb}`, uklad, hz: Math.round(1 / dt), okno: (win.sLast - win.sTrue) / cs, v: {} };
        let line = `${(ka + ' → ' + kb).padEnd(30)} ${uklad.padEnd(9)} ${String(Math.round(1 / dt)).padStart(3)} Hz okno ${row.okno.toFixed(1).padStart(6)} |`;
        for (const v of V) {
          const r = series(specA, poseA, specB, { x: 0, y: 0, angle: angB }, dir, v, dt, win, sure, cs);
          row.v[v] = r;
          line += ` ${fmtPct(r.przeloty)} ${fmtC(r.glebSr)}/${fmtC(r.glebMax)} |`;
        }
        console.log(line);
        wyniki.kadluby.push(row);
      }
    }
  }
}

// ---------------------------------------------------------------- 3. pociski muskające szybki cel
// Gra: cele ruszają się w kroku PRZED pociskami (npcStep, potem bulletsAndCollisionsStep), a odcinek pocisku
// b.px → b.x sprawdza się przeciw celowi w pozie z KOŃCA kroku. Ruch względny: początek odcinka przesunięty o
// v_celu·dt. Pocisk leci w poprzek kursu celu, przesunięcia wzdłuż kursu celu losowane w paśmie obejmującym kadłub.
function grazingBullets(hulls) {
  const by = Object.fromEntries(hulls.map((h) => [h.key, h]));
  const targets = ['frigate_pd', 'destroyer', 'atlas'].filter((k) => by[k]);
  if (!targets.length) return;
  console.log('\n== 3. Pociski w poprzek kursu celu: niezgodność trafień (odcinek względem pozy końcowej ↔ ruch względny) ==');
  console.log('   odsetek pocisków lecących na obrys celu, którym gra daje inny wynik (trafienie ↔ pudło) niż ruch względny');
  const VT = [500, 1400, 3200], VB = [2000, 7000, 15000];
  for (const key of targets) {
    const e = makeEnt(by[key], 0, 0, 0);
    try {
      const len = e.beamHull.srcWidth * e.beamHull.scale;
      for (const dt of DTS) {
        let line = `${key.padEnd(12)} ${String(Math.round(1 / dt)).padStart(3)} Hz |`;
        const row = { cel: key, hz: Math.round(1 / dt), v: {} };
        for (const vt of VT) for (const vb of VB) {
          // Cel leci w +x (kurs 0) z prędkością vt, pocisk w +y. W układzie celu z końca kroku k (cel w 0, 0):
          // gra — odcinek od (u − vt·t_k, y_{k−1}) do (u − vt·t_k, y_k); ruch względny — od (u − vt·t_{k−1}, y_{k−1}).
          let diff = 0, onHull = 0;
          const N = 400;
          for (let i = 0; i < N; i++) {
            const u0 = -len * 0.6 + (1.2 * len * (i + 0.5)) / N;
            const ph = ((i * 0.618034) % 1);                       // faza pocisku w kroku
            const yStart = -1500 - vb * dt * ph;
            // Pocisk przecina oś celu (y = 0) w chwili tc, wtedy w układzie celu jest w x = u0.
            const tc = -yStart / vb;
            let endHit = false, relHit = false;
            for (let k = 1; k < 100000; k++) {
              const ya = yStart + vb * dt * (k - 1), yb = yStart + vb * dt * k;
              if (ya > 1500) break;
              const xk = u0 - vt * (dt * k - tc), xk1 = u0 - vt * (dt * (k - 1) - tc);
              if (!endHit && HullBodies.sweep(e, xk, ya, xk, yb, 0)) endHit = true;
              if (!relHit && HullBodies.sweep(e, xk1, ya, xk, yb, 0)) relHit = true;
              if (endHit && relHit) break;
            }
            if (endHit || relHit) onHull++;
            if (endHit !== relHit) diff++;
          }
          const r = onHull ? diff / onHull : 0;
          row.v[`${vt}/${vb}`] = r;
          line += ` ${vt}/${vb}: ${(r * 100).toFixed(1).padStart(4)}%`;
        }
        console.log(line);
        wyniki.pociski.push(row);
      }
    } finally { cleanup(e); }
  }
}

const t0 = Date.now();
const hulls = loadHulls();
if (TRYB === 'cienkie' || TRYB === 'wszystko') thinPlates();
if (TRYB === 'kadluby' || TRYB === 'wszystko') realHulls(hulls);
if (TRYB === 'pociski' || TRYB === 'wszystko') grazingBullets(hulls);
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s, faz na konfigurację: ${FAZY})`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(wyniki, null, 1));
