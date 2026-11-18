// HUTA — formowanie, runda 7 („Walcowanie — dopracowanie”): ZGORZELINA I ISKRY PRZY CHWYCIE WALCÓW F1–F3 (czysty JS, bez
// three; krok bez alokacji, losowość mulberry32 z ziarnem — powtarzalnie).
//
// Źródło: zgorzelina zrzucona na klatce (`mill.view.shed` — przyrost ξ · masa przechodzącej taśmy, liczony w kroku
// walcowni) i salwa przy chwycie czoła (czoło po długiej drodze ma grubą zgorzelinę). Z każdej porcji zgorzeliny:
//   PŁATKI   kruche łuski tlenku pękające na wejściu w klin walców (strefa pękania przed łukiem styku — ta sama, w której
//            obraz taśmy zdejmuje zgorzelinę, `CRACK_LEN`): wyskakują wstecz (−x), na boki (spod krawędzi
//            taśmy — tam wylatują poza beczkę walca i widać je z góry) i od taśmy; wirują (płytka — raz widać ją płasko,
//            raz kantem), stygną od temperatury lica taśmy przy chwycie (cienka łuska — szybko, τ ≈ 0,7 s): od ciemnej
//            czerwieni do szarej łuski. Nad dołem zgorzeliny (pod osią pasma) ściąga je pole dołu i gasną na dnie.
//   ISKRY    drobny tlenek dopalający się w locie — krótkie, jasne smugi szybkie (140–400 j./s), gasną w 0,25–0,6 s.
//   PYŁ      miałka zgorzelina z pękania łusek — miękki, ciemnoczerwony obłoczek przy chwycie (ok. 0,5–0,9 s); z kamery
//            gry czyta się jako dymek pracy klatki.
// Linia stoi w nieważkości: cząstka leci prosto, hamowana oporem atmosfery hali (płatek mocniej niż iskra); odbija się
// od walców (z prędkością obwodową beczki) i od taśmy. Ilość cząstek idzie za ilością zrzuconej zgorzeliny: więcej przy
// czole (gruba łuska po długiej drodze), przy większym przepływie (więcej taśmy na sekundę), mniej na F2 / F3 (łuska
// odrasta tylko między klatkami).
//
// Rekord rysunku (`ZGORZ.stride` = 12): iA = xyz + życie 0…1, iB = xyz z poprzedniego kroku + żar T̃, iC = rodzaj
// (0 iskra, 1 płatek, 2 pył), rozmiar [j.], kąt obrotu płatka [rad], ziarno 0…1 — materiał `zgorzelinaTSL.js`.
import { HALA, LINIA } from './geometria.js';
import { METAL_FIZ, PL, SLICE_CAP, SLICE_STRIDE } from './linia.js';
import { WALC, rollCenters } from './walcownia.js';
import { CRACK_LEN } from './stacje.js';
import { DZIEL } from '../dzielenie/geometria.js';
// (runda 9, „Czysta stal”) PŁATKI I PYŁ ZE STACJI ODZGORZANIA — ilość z liczonej masy zdjętego tlenku (`LIN_STAN.odzTot`)
import { ODZG, OZ_X0 } from './odzgorzanie.js';
import { LIN_STAN } from './linia.js';

export const ZGORZ = Object.freeze({
  stride: 12, cap: 2048,
  // zgorzelina na jedną cząstkę [jedn. · ξ] (strumień przy Q_nom, stal: F1 ≈ 1 900 jedn.·ξ/s → ~48 płatków, ~32 iskry,
  // ~8 obłoczków pyłu na sekundę; F2 ≈ ½, F3 ≈ ⅓ tego)
  perFlake: 40, perSpark: 40, perDust: 240,
  // salwa chwytu czoła (płatki, iskry, pył) na F1, F2, F3
  salvo: Object.freeze([Object.freeze([130, 90, 26]), Object.freeze([95, 65, 18]), Object.freeze([70, 50, 14])]),
  // opór atmosfery [1/s]: płatek, iskra, pył; pole dołu zgorzeliny [j./s²]
  drag: Object.freeze([0.8, 2.2, 3.2]), pitG: 520,
  // stygnięcie [s] (do żaru `cold`): iskra, płatek, pył
  cool: Object.freeze([0.3, 1.0, 0.5]), cold: 0.22,
  // odbicie od walca / taśmy (współczynnik restytucji), tarcie o beczkę (udział prędkości obwodowej)
  bounce: 0.3, rollGrip: 0.12
});

/**
 * (runda 9) Zgorzelina zdjęta w STACJI ODZGORZANIA (`odzgorzanie.js`): cząstek na jednostkę zdjętej masy [1/jedn.] —
 * płatki, iskry (dopalający się tlenek), pył; połowa z każdego lica. Z górnego lica pole odciągu ciągnie je do SSAW po
 * bokach taśmy (przyspieszenie ku punktowi ssania `suckG` [j./s²], tłumienie przepływu `suckDamp` [1/s]) — cząstka
 * znika we wlocie ssawy (licznik `counts[3]`); z dolnego — w dół i wstecz, do dołu zgorzeliny F3.
 */
export const ODZ_DEB = Object.freeze({ flakes: 40, sparks: 4, dust: 5, suckG: 1500, suckDamp: 1.6, downG: 1600 });


const NS = 3;
const SP = WALC.stands;
const ROLL = SP.map((s, k) => rollCenters(k));
const MS = METAL_FIZ[0];
const MC = METAL_FIZ[1];
const PY = HALA.passY;
const PIT = LINIA.pit;
// (runda 9) pole ściągające iskry i krople szczeliny pod osią — obszar dawnej rynny odpadu rundy 8 (zasada G: tor iskier
// noża bez zmian; rynna została tylko pod nożem, x `DZIEL.kerf.x0`…`x1`, a dalej iskry gasną na wysokości dawnego dna)
const CH = Object.freeze({ x0: DZIEL.kerf.x0, x1: 4700, hz: 100, yFloor: DZIEL.kerf.yFloor });
/** (runda 9) ssawa odciągu stacji odzgorzania i punkt ssania (x, y nad osią, |z|). */
const MO = ODZG.mouth;
const MU = ODZG.mouth.suck;
/** Pole rynny odpadu [j./s²] (jak pole dołu zgorzeliny, mocniej — krople szczeliny nie mogą zawisnąć nad rynną). */
const CHUTE_G = 900;

export function createScaleDebris(seed = 31) {
  const N = ZGORZ.cap;
  const ST = ZGORZ.stride;
  const pos = new Float64Array(N * 3);
  const vel = new Float64Array(N * 3);
  const life = new Float64Array(N * 2);           // pozostało [s], całość [s]
  const heat = new Float64Array(N);               // żar T̃
  const kind = new Uint8Array(N);
  const size = new Float64Array(N);
  const spin = new Float64Array(N * 2);           // kąt [rad], prędkość kątowa [rad/s]
  const side = new Int8Array(N);                  // strona taśmy przy narodzinach (+1 nad, −1 pod)
  const org = new Uint8Array(N);                  // (runda 9) pochodzenie: 0 — klatki i nóż, 1 — stacja odzgorzania
  const data = new Float32Array(N * ST);
  let n = 0;
  const rs = new Uint32Array(1);
  rs[0] = (seed >>> 0) ^ 0x85EBCA6B;
  const R = new Float64Array(1);
  function rnd() {
    rs[0] += 0x6D2B79F5;
    let t = rs[0];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    R[0] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // stan przy chwycie klatek: żar lica T̃ (z plastra w punkcie chwytu), prędkość wejścia
  const biteT = new Float64Array(NS).fill(0.5);
  const seen = new Int32Array(NS);
  const shedSeen = new Float64Array(NS);
  const acc = new Float64Array(NS * 3);
  const cnt = new Float64Array(5);                // [0] urodzone (narastająco), [1] żywe, [2] płatki w dołach, [3] w ssawach odciągu (stacja odzgorzania), [4] urodzone w stacji
  // (runda 9) stacja odzgorzania: [0] `odzTot` linii przy poprzednim kroku, [1..3] ułamki płatków, iskier, pyłu, [4] T̃ lica, [5] prędkość taśmy, [6] init
  const accD = new Float64Array(7);
  let init = false;

  /** Żar lica taśmy przy chwycie klatki k (T̃ z temperatury lica plastra w punkcie chwytu). */
  function sampleBite(line) {
    const SL = line.view.slices;
    const ring = line.view.ring;
    const nn = ring[1];
    const r0 = ring[0];
    for (let k = 0; k < NS; k++) {
      const e = SP[k].e;
      for (let i = 0; i < nn; i++) {
        const o = ((r0 + i) & (SLICE_CAP - 1)) * SLICE_STRIDE;
        if (SL[o + PL.s] < e) continue;
        const t = SL[o + PL.tail];
        const top = t === 2 ? -1e9 : t === 1 ? SL[o + PL.ts] : (i + 1 < nn ? SL[((r0 + i + 1) & (SLICE_CAP - 1)) * SLICE_STRIDE + PL.s] : -1e9);
        if (top > e) continue;
        const x = SL[o + PL.x];
        const T0 = MS.T0 + (MC.T0 - MS.T0) * x;
        const T1 = MS.T1 + (MC.T1 - MS.T1) * x;
        // (lico w łuku styku chłodzi walec — zgorzelina pęka z taśmy o temperaturze rdzenia lica tuż przed nim)
        biteT[k] = (SL[o + PL.Ts] - SL[o + PL.dTs] - T0) / (T1 - T0);
        break;
      }
    }
  }

  /** Cząstka rodzaju q (0 iskra, 1 płatek, 2 pył) z łuku styku klatki k. */
  function spawn(k, q) {
    if (n >= N) return;
    const S = SP[k];
    const i = n++;
    rnd(); const sd = R[0] < (q === 1 ? 0.55 : 0.5) ? -1 : 1;
    // (łuska pęka na wejściu w klin walców — w strefie pękania przed łukiem styku, `CRACK_LEN`; stamtąd wyskakuje)
    rnd(); const x = S.e - 2 - CRACK_LEN * 0.75 * R[0];
    rnd(); const z = (R[0] * 2 - 1) * 98;
    // kierunek: wstecz z klina walców, na boki (krawędź — mocniej na zewnątrz), od taśmy
    rnd(); const back = q === 0 ? 0.6 + 0.4 * R[0] : 0.35 + 0.6 * R[0];
    rnd(); const lat = z / 100 * (0.25 + 0.85 * R[0]);
    rnd(); const lat2 = (R[0] - 0.5) * 0.5;
    rnd(); const up = q === 0 ? 0.12 + 0.45 * R[0] : 0.25 + 0.65 * R[0];
    let dx = -back;
    let dz = lat + lat2;
    let dy = sd * up;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= l; dy /= l; dz /= l;
    rnd();
    const sp = q === 0 ? 140 + 260 * R[0] * R[0] : q === 1 ? 45 + 120 * R[0] : 22 + 50 * R[0];
    pos[i * 3] = x; pos[i * 3 + 1] = PY + sd * (S.bIn + 0.7); pos[i * 3 + 2] = z;
    vel[i * 3] = dx * sp; vel[i * 3 + 1] = dy * sp; vel[i * 3 + 2] = dz * sp;
    rnd();
    life[i * 2] = life[i * 2 + 1] = q === 0 ? 0.25 + 0.35 * R[0] : q === 1 ? 1.0 + 1.0 * R[0] : 0.5 + 0.4 * R[0];
    rnd();
    const T = biteT[k];
    // iskra: tlenek dopala się w locie — jaśniej niż lico; płatek i pył: temperatura lica (cienka łuska nieco chłodniej)
    heat[i] = q === 0 ? T + 0.18 + 0.12 * R[0] : T * (0.86 + 0.12 * R[0]);
    kind[i] = q;
    rnd();
    size[i] = q === 0 ? 0.6 : q === 1 ? 1.4 + 3.2 * R[0] * R[0] : 7 + 9 * R[0];
    rnd(); spin[i * 2] = R[0] * 6.2832;
    rnd(); spin[i * 2 + 1] = q === 1 ? (R[0] - 0.5) * 34 : 0;
    side[i] = sd;
    org[i] = 0;
    const o = i * ST;
    data[o] = data[o + 4] = pos[i * 3]; data[o + 1] = data[o + 5] = pos[i * 3 + 1]; data[o + 2] = data[o + 6] = pos[i * 3 + 2];
    data[o + 3] = 1; data[o + 7] = heat[i];
    rnd();
    data[o + 8] = q; data[o + 9] = size[i]; data[o + 10] = spin[i * 2]; data[o + 11] = R[0];
    cnt[0]++;
  }

  /**
   * (runda 9) Cząstka rodzaju q (0 iskra, 1 płatek, 2 pył) zdjęta w STACJI ODZGORZANIA: z lica (strona na zmianę),
   * w strefie styku (gęściej przy jej początku — tlenek odrywa się wykładniczo z drogą), z prędkością taśmy częściowo
   * wytraconą w warstwie plazmy (pochylonej pod prąd): wstecz, na boki ku ssawom (górne lico) albo w dół (dolne).
   */
  function spawnDescale(q, k) {
    if (n >= N) return;
    const i = n++;
    const sd = (k & 1) === 0 ? 1 : -1;
    rnd(); const x = OZ_X0 + ODZG.wf * R[0] * R[0];
    rnd(); const z = (R[0] * 2 - 1) * 97;
    const zs = z >= 0 ? 1 : -1;
    rnd(); const back = q === 0 ? 60 + 160 * R[0] : 30 + 90 * R[0];
    rnd(); const lat = (q === 0 ? 120 : 70) + 200 * R[0] * (0.4 + 0.6 * Math.abs(z) / 97);
    rnd(); const up = q === 2 ? 15 + 30 * R[0] : 30 + 70 * R[0];
    pos[i * 3] = x; pos[i * 3 + 1] = PY + sd * 5.6; pos[i * 3 + 2] = z;
    vel[i * 3] = 0.12 * accD[5] - back; vel[i * 3 + 1] = sd * up; vel[i * 3 + 2] = sd > 0 ? zs * lat : zs * lat * 0.25;
    rnd();
    life[i * 2] = life[i * 2 + 1] = q === 0 ? 0.22 + 0.3 * R[0] : q === 1 ? 1.6 + 0.8 * R[0] : 0.5 + 0.4 * R[0];
    rnd();
    const T = accD[4];
    heat[i] = q === 0 ? T + 0.2 + 0.15 * R[0] : T * (0.82 + 0.12 * R[0]);
    kind[i] = q;
    rnd();
    size[i] = q === 0 ? 0.55 : q === 1 ? 1.2 + 2.4 * R[0] * R[0] : 7 + 9 * R[0];
    rnd(); spin[i * 2] = R[0] * 6.2832;
    rnd(); spin[i * 2 + 1] = q === 1 ? (R[0] - 0.5) * 40 : 0;
    side[i] = sd;
    org[i] = 1;
    const o = i * ST;
    data[o] = data[o + 4] = pos[i * 3]; data[o + 1] = data[o + 5] = pos[i * 3 + 1]; data[o + 2] = data[o + 6] = pos[i * 3 + 2];
    data[o + 3] = 1; data[o + 7] = heat[i];
    rnd();
    data[o + 8] = q; data[o + 9] = size[i]; data[o + 10] = spin[i * 2]; data[o + 11] = R[0];
    cnt[0]++;
    cnt[4]++;
  }

  /** (runda 9) Przyrost zdjętej masy w kroku → cząstki (stan lica przy stacji: T̃ i prędkość z plastra pod linią styku). */
  function descaleEmit(line) {
    const L = line.stan;
    const tot = L[LIN_STAN.odzTot];
    if (accD[6] === 0) { accD[0] = tot; accD[6] = 1; return; }
    const d = tot - accD[0];
    accD[0] = tot;
    if (!(d > 0)) return;
    const SL = line.view.slices;
    const ring = line.view.ring;
    const nn = ring[1];
    const r0 = ring[0];
    accD[4] = 0.4; accD[5] = 0;
    for (let i = 0; i < nn; i++) {
      const o = ((r0 + i) & (SLICE_CAP - 1)) * SLICE_STRIDE;
      if (SL[o + PL.s] < ODZG.xf) break;
      const x = SL[o + PL.x];
      const T0 = MS.T0 + (MC.T0 - MS.T0) * x;
      const T1 = MS.T1 + (MC.T1 - MS.T1) * x;
      accD[4] = (SL[o + PL.Ts] - T0) / (T1 - T0);
      accD[5] = SL[o + PL.u];
    }
    accD[1] += d * ODZ_DEB.flakes;
    accD[2] += d * ODZ_DEB.sparks;
    accD[3] += d * ODZ_DEB.dust;
    let k = 0;
    while (accD[1] >= 1) { accD[1] -= 1; spawnDescale(1, k++); }
    while (accD[2] >= 1) { accD[2] -= 1; spawnDescale(0, k++); }
    while (accD[3] >= 1) { accD[3] -= 1; spawnDescale(2, k++); }
  }

  /** Odbicie od walców klatek (beczka |z| ≤ 135) i od taśmy (|z| < 100 — strona z narodzin). */
  function collide(i) {
    const x = pos[i * 3];
    const z = pos[i * 3 + 2];
    // (najpierw taśma, potem walce — przy chwycie walec dotyka taśmy)
    // taśma: płatek nie przechodzi na drugą stronę (przed i za klatkami, w pasie taśmy)
    // (runda 9: cząstki stacji odzgorzania niesie pole odciągu od lica — bez warstwy 12 j. taśmy w walcowni)
    if (org[i] === 0 && Math.abs(z) < 100 && x > SP[0].e - 400 && x < LINIA.stripEndX) {
      const b = 12;
      const rel = (pos[i * 3 + 1] - PY) * side[i];
      if (rel < b) {
        pos[i * 3 + 1] = PY + side[i] * b;
        const vy = vel[i * 3 + 1] * side[i];
        if (vy < 0) vel[i * 3 + 1] = -vy * ZGORZ.bounce * side[i];
      }
    }
    if (Math.abs(z) <= 135) {
      for (let k = 0; k < NS; k++) {
        const c = ROLL[k];
        if (Math.abs(x - c[0]) > WALC.R + 6) continue;
        for (let u = 0; u < 2; u++) {
          const yc = u === 0 ? c[1] : c[2];
          const rx = x - c[0];
          const ry = pos[i * 3 + 1] - yc;
          const d = Math.sqrt(rx * rx + ry * ry);
          const rr = WALC.R + 0.8;
          if (d >= rr || d < 1e-6) continue;
          const nx = rx / d;
          const ny = ry / d;
          pos[i * 3] = c[0] + nx * rr;
          pos[i * 3 + 1] = yc + ny * rr;
          // prędkość obwodowa beczki w tym punkcie (górny walec: spód idzie z taśmą, +x; dolny: wierzch +x)
          const w = (u === 0 ? 1 : -1) * omegaK[k];
          const sx = -w * ry;
          const sy = w * rx;
          const vn = vel[i * 3] * nx + vel[i * 3 + 1] * ny;
          if (vn < 0) {
            vel[i * 3] -= (1 + ZGORZ.bounce) * vn * nx;
            vel[i * 3 + 1] -= (1 + ZGORZ.bounce) * vn * ny;
          }
          vel[i * 3] += (sx - vel[i * 3]) * ZGORZ.rollGrip;
          vel[i * 3 + 1] += (sy - vel[i * 3 + 1]) * ZGORZ.rollGrip;
        }
      }
    }
  }
  const omegaK = new Float64Array(NS);

  /**
   * (runda 8) ISKRY SZCZELINY noża dzielenia (z liczonej masy szczeliny — liczbę podaje dzielenie): z ogniska ostrza
   * (x, y, z), ognisko jedzie z taśmą (`vx`), przemiata w kierunku `dir` (±1 w z), żar kropli `Tt` (T̃ solidusu).
   * 70 % w dół i wstecz (stopiony metal wydmuchiwany z dołu szczeliny — pod taśmą, z góry niewidoczny, do rynny), 30 %
   * wzdłuż przemiatania; `endK` — udział tych bocznych, które idą BOKIEM poza krawędź taśmy (koniec przemiatania).
   * (`zFrom`, `span`): iskry kroku rodzą się wzdłuż całego odcinka przemiecionego w tym kroku (z `zFrom` do `z`) i w
   * chwilach rozłożonych w kroku (`span` [s]) — pierwsze lecą już dłużej; inaczej z kamery gry iskry kroku wychodziły
   * paczkami z jednego punktu co 1/60 s (kropki co ~17 j. wzdłuż szczeliny).
   */
  function emitKerf(x, y, z, vx, count, dir, Tt, endK, zFrom = z, span = 0) {
    for (let k = 0; k < count && n < N; k++) {
      const fk = (k + 0.5) / count;
      const age = (1 - fk) * span;
      const i = n++;
      rnd(); const down = R[0] < 0.7;
      rnd(); const sp = 180 + 240 * R[0];
      let dx; let dy; let dz;
      if (down) {
        rnd(); dx = -0.15 - 0.45 * R[0];
        rnd(); dy = -0.55 - 0.45 * R[0];
        rnd(); dz = (R[0] - 0.5) * 0.5 + dir * 0.15;
      } else {
        rnd(); dx = (R[0] - 0.6) * 0.45;
        rnd(); dy = 0.04 + 0.3 * R[0];
        rnd(); dz = dir * (0.7 + 0.5 * R[0]) * (0.6 + 0.4 * endK);
      }
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= l; dy /= l; dz /= l;
      rnd();
      vel[i * 3] = dx * sp + vx; vel[i * 3 + 1] = dy * sp; vel[i * 3 + 2] = dz * sp;
      // ognisko `age` s wcześniej: z odcinka przemiatania, x cofnięte o drogę taśmy; iskra przeleciała już `age` s
      const zk = zFrom + (z - zFrom) * fk;
      pos[i * 3] = x - vx * age + (R[0] - 0.5) * 1.6 + vel[i * 3] * age;
      pos[i * 3 + 1] = y + (down ? -5.5 : 5.5) + vel[i * 3 + 1] * age;
      pos[i * 3 + 2] = zk + vel[i * 3 + 2] * age;
      rnd();
      life[i * 2 + 1] = 0.25 + 0.45 * R[0];
      life[i * 2] = life[i * 2 + 1] - age;
      rnd();
      heat[i] = Tt * (0.75 + 0.25 * R[0]);
      kind[i] = 0;
      size[i] = 0.6;
      spin[i * 2] = 0; spin[i * 2 + 1] = 0;
      side[i] = down ? -1 : 1;
      org[i] = 0;
      const o = i * ST;
      data[o] = data[o + 4] = pos[i * 3]; data[o + 1] = data[o + 5] = pos[i * 3 + 1]; data[o + 2] = data[o + 6] = pos[i * 3 + 2];
      data[o + 3] = 1; data[o + 7] = heat[i];
      rnd();
      data[o + 8] = 0; data[o + 9] = size[i]; data[o + 10] = 0; data[o + 11] = R[0];
      cnt[0]++;
    }
  }

  return {
    emitKerf,
    data,
    counts: cnt,
    get count() { return n; },
    /** Krok strony (dt): salwy chwytu, strumień z zrzuconej zgorzeliny, ruch, stygnięcie, odbicia, zgaśnięcie. */
    step(dt, mill, line) {
      const V = mill.view;
      if (!V || !V.shed) return;
      if (!init) { for (let k = 0; k < NS; k++) { seen[k] = V.bites[k]; shedSeen[k] = V.shed[k]; } init = true; }
      for (let k = 0; k < NS; k++) omegaK[k] = V.omega[k];
      if (line) { sampleBite(line); descaleEmit(line); }
      for (let k = 0; k < NS; k++) {
        if (V.bites[k] !== seen[k]) {
          seen[k] = V.bites[k];
          const sv = ZGORZ.salvo[k];
          for (let q = 0; q < sv[0]; q++) spawn(k, 1);
          for (let q = 0; q < sv[1]; q++) spawn(k, 0);
          for (let q = 0; q < sv[2]; q++) spawn(k, 2);
        }
        const ds = V.shed[k] - shedSeen[k];
        shedSeen[k] = V.shed[k];
        if (ds > 0) {
          acc[k * 3] += ds / ZGORZ.perFlake;
          acc[k * 3 + 1] += ds / ZGORZ.perSpark;
          acc[k * 3 + 2] += ds / ZGORZ.perDust;
        }
        while (acc[k * 3] >= 1) { acc[k * 3] -= 1; spawn(k, 1); }
        while (acc[k * 3 + 1] >= 1) { acc[k * 3 + 1] -= 1; spawn(k, 0); }
        while (acc[k * 3 + 2] >= 1) { acc[k * 3 + 2] -= 1; spawn(k, 2); }
      }
      const dr0 = Math.exp(-ZGORZ.drag[1] * dt);
      const dr1 = Math.exp(-ZGORZ.drag[0] * dt);
      const dr2 = Math.exp(-ZGORZ.drag[2] * dt);
      for (let i = 0; i < n;) {
        life[i * 2] -= dt;
        if (life[i * 2] <= 0) {
          const j = --n;
          if (i !== j) {
            for (let c = 0; c < 3; c++) { pos[i * 3 + c] = pos[j * 3 + c]; vel[i * 3 + c] = vel[j * 3 + c]; }
            life[i * 2] = life[j * 2]; life[i * 2 + 1] = life[j * 2 + 1];
            heat[i] = heat[j]; kind[i] = kind[j]; size[i] = size[j]; side[i] = side[j]; org[i] = org[j];
            spin[i * 2] = spin[j * 2]; spin[i * 2 + 1] = spin[j * 2 + 1];
            for (let c = 0; c < ST; c++) data[i * ST + c] = data[j * ST + c];
          }
          continue;
        }
        const q = kind[i];
        const o = i * ST;
        data[o + 4] = pos[i * 3]; data[o + 5] = pos[i * 3 + 1]; data[o + 6] = pos[i * 3 + 2];
        // pole dołu zgorzeliny: pod osią pasma, nad dołem klatki — płatki i pył ściąga w dół
        if (q !== 0 && pos[i * 3 + 1] < PY - 6 && Math.abs(pos[i * 3 + 2]) < PIT.hz) {
          for (let k = 0; k < NS; k++) if (Math.abs(pos[i * 3] - LINIA.stands[k].x) < PIT.hx + 30) { vel[i * 3 + 1] -= ZGORZ.pitG * dt; break; }
        }
        // (runda 8) pole rynny odpadu dzielenia: pod osią taśmy, nad rynną — iskry szczeliny i krople ściąga w dół
        if (pos[i * 3 + 1] < PY - 6 && Math.abs(pos[i * 3 + 2]) < CH.hz && pos[i * 3] > CH.x0 - 20 && pos[i * 3] < CH.x1) vel[i * 3 + 1] -= CHUTE_G * dt;
        // (runda 9) POLE ODCIĄGU stacji odzgorzania: górne lico — przyspieszenie ku punktowi ssania ssawy po swojej stronie i
        // tłumienie przepływu (cząstka płynie ze strumieniem gazu ku wlotowi); dolne — w dół i wstecz (do dołu zgorzeliny F3)
        if (org[i] === 1) {
          if (side[i] > 0) {
            const zs = pos[i * 3 + 2] >= 0 ? 1 : -1;
            const dx = MU[0] - pos[i * 3];
            const dy = PY + MU[1] - pos[i * 3 + 1];
            const dz = zs * MU[2] - pos[i * 3 + 2];
            const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1;
            const kd = Math.exp(-ODZ_DEB.suckDamp * dt);
            for (let c = 0; c < 3; c++) vel[i * 3 + c] *= kd;
            vel[i * 3] += ODZ_DEB.suckG * dt * dx / dl;
            vel[i * 3 + 1] += ODZ_DEB.suckG * dt * dy / dl;
            vel[i * 3 + 2] += ODZ_DEB.suckG * dt * dz / dl;
            // wlot ssawy: cząstka znika w gardle (licznik ssaw)
            const az = Math.abs(pos[i * 3 + 2]);
            if (az > MO.z0 + 4 && pos[i * 3] > MO.x0 && pos[i * 3] < MO.x1 && pos[i * 3 + 1] > PY + MO.y0 && pos[i * 3 + 1] < PY + MO.y1) {
              life[i * 2] = Math.min(life[i * 2], 0.02); cnt[3]++; org[i] = 2;
            }
          } else {
            vel[i * 3] -= 0.25 * ODZ_DEB.downG * dt;
            vel[i * 3 + 1] -= ODZ_DEB.downG * dt;
          }
        }
        const dr = q === 0 ? dr0 : q === 1 ? dr1 : dr2;
        for (let c = 0; c < 3; c++) { vel[i * 3 + c] *= dr; pos[i * 3 + c] += vel[i * 3 + c] * dt; }
        if (q !== 2) collide(i);
        // stygnięcie (do żaru szarej łuski), obrót płatka
        heat[i] += (ZGORZ.cold - heat[i]) * (1 - Math.exp(-dt / ZGORZ.cool[q]));
        spin[i * 2] += spin[i * 2 + 1] * dt;
        // pokład hali: iskra gaśnie na płycie, płatek na dnie dołu zgorzeliny pod klatką
        if (pos[i * 3 + 1] < HALA.deckY + 2 - (q !== 0 ? PIT.depth - 4 : 0)) { life[i * 2] = Math.min(life[i * 2], 0.05); if (q === 1) cnt[2]++; }
        // (runda 8) dno rynny odpadu: kropla gaśnie na dnie
        else if (pos[i * 3 + 1] < CH.yFloor + 1 && Math.abs(pos[i * 3 + 2]) < CH.hz && pos[i * 3] > CH.x0 && pos[i * 3] < CH.x1) life[i * 2] = Math.min(life[i * 2], 0.05);
        data[o] = pos[i * 3]; data[o + 1] = pos[i * 3 + 1]; data[o + 2] = pos[i * 3 + 2]; data[o + 3] = life[i * 2] / life[i * 2 + 1];
        data[o + 7] = heat[i];
        data[o + 10] = spin[i * 2];
        i++;
      }
      cnt[1] = n;
    }
  };
}
