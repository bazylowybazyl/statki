// DZIELNICA „SKŁADY” — BRYŁY (dane instancji zestawu budowli portowych, bez three). Cztery budowle:
//   1. rząd przy ringu: doki kurierów, PUNKT NADAŃ gracza (rampa, cztery zatoki z lampami stanu), stacja towarowa;
//   2. farma zbiorników: przepompownia przy drodze, basen z obwałowaniami i zbiornikami, rurociągi do kratownicy drogi,
//      nabrzeże tankowców od przestrzeni (ramiona nalewcze, lampy stanu), wskaźniki napełnienia (kanały);
//   3. terminal kontenerowy: magazyn przy drodze, plac ze stosami w rodzinach barw pod SUWNICAMI BRAMOWYMI (grupy
//      ruchome), nabrzeże z dokami L i pasem MEGA pod SUWNICAMI NABRZEŻOWYMI (grupy ruchome);
//   4. wysokie składy: hale wysokiego składowania z rampami od drogi i dokami eksportu od przestrzeni.
// Wierzchy brył stalowe (steel, rail), dna doków i basenów jasne; listwy świetlne krótkie i przygaszone.
import { RING_V, ringScale } from '../kit/uklad.js';
import {
  PB_FX, PB_MAT, PB_MAX_GROUPS, YARD_H, controlBlock, greebles, megaDetail, newScene, pbHash1, pitDetail, pushLamp, sceneOf, spire
} from '../kit/sceny.js';
import { SK, wallsOf } from './uklad.js';

const M = PB_MAT;
const H = YARD_H;
const V = RING_V;
const sc = ringScale;

/** Rodziny barw kontenerów: główna barwa i domieszki. */
export const CONTAINER_FAMILIES = Object.freeze([
  [M.orange, M.orange, M.orange, M.yellow],
  [M.teal, M.teal, M.teal, M.steel],
  [M.yellow, M.yellow, M.orange, M.yellow],
  [M.pale, M.pale, M.steel, M.pale],
  [M.steel, M.steel, M.teal, M.pale]
]);

/**
 * Korpusy kawałków stref (jak `bodies` zestawu, ale wierzch tylko ze stali i szyn): blok od stępki do pokładu
 * (`floor: true` — basen / plac: tylko do dna y = 18, jasna podłoga), na licu od strony wylotów krawężnik, krótkie
 * przygaszone listwy świetlne i pas stali.
 */
export function rowBodies(T, f, layout, zones, { greeble = true, floor = false, strip = M.cyan } = {}) {
  for (const p of layout.pieces) {
    if (!zones.includes(p.zone)) continue;
    if (floor) {
      T.sec(p.s0, p.s1, p.v0, p.v1, H.keel, H.floor - H.keel, M.floor);
      continue;
    }
    T.sec(p.s0, p.s1, p.v0, p.v1, H.keel, H.deck - H.keel, M.dark);
    const k = pbHash1(Math.round(p.s0 * 0.61 + p.v0 * 0.17) + 2.2);
    const d = 9 / sc(p.v0);
    T.sec(p.s0 + d, p.s1 - d, p.v0 + 9, p.v1 - 9, H.deck, 6, k < 0.7 ? M.steel : M.rail);
    if (greeble && p.orient === 'arc') greebles(T, f, p);
    if (p.face && !p.pit) {
      const { v, sign } = p.face;
      T.run(p.s0, p.s1, v - sign * 9, H.deck + 9, 16, 16, M.rail, 500);
      // listwy świetlne krótkie (po ~160 j.), przygaszone
      const span = (p.s1 - p.s0) * sc(v);
      const n = Math.max(1, Math.floor(span / 420));
      f.fx(0.8, PB_FX.steady);
      for (let i = 0; i < n; i++) T.box(p.s0 + ((p.s1 - p.s0) * (i + 0.5)) / n, v + sign * 3, H.wallLight, 150, 5, 6, strip);
      f.nofx();
      T.run(p.s0 + 4, p.s1 - 4, v + sign * 2, 40, 30, 5, M.steel, 500, 1.0);
    }
  }
}

/** Ściana promieniowa (koniec basenu / placu): od v0 do v1 przy s, grubość `t` j. świata. */
function endWall(T, s, v0, v1, t = 120) {
  const vm = (v0 + v1) / 2;
  T.box(s, vm, (H.keel + H.deck) / 2, t, H.deck - H.keel, v1 - v0, M.dark);
  T.box(s, vm, H.deck + 3, t - 10, 6, v1 - v0 - 10, M.steel);
  T.box(s, vm, H.deck + 12, 16, 12, v1 - v0 - 20, M.rail);
}

/** Ściana wzdłuż łuku na krawędzi basenu (od dna do pokładu) — lico bryły sąsiadującej z basenem. */
function basinLip(T, a, b, v, sign) {
  T.run(a, b, v - sign * 9, H.deck + 9, 16, 16, M.rail, 500);
  T.run(a, b, v + sign * 3, 60, 40, 6, M.steel, 500, 1.0);
}

// ---------------------------------------------------------------------------
// 1. Rząd przy ringu: doki kurierów, PUNKT NADAŃ, stacja towarowa

/** rig.player: [{ ch, bay }] — lampy stanu ramp punktu nadań (kanał 1 = zestaw gotowy, 0 = załadunek). */
export function buildInnerScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const I = SK.inner;
  rowBodies(T, f, layout, ['IA', 'IC']);
  rowBodies(T, f, layout, ['PN', 'IB'], { greeble: false, strip: M.warm });
  for (const pit of layout.pits) if (pit.zone === 'IA' || pit.zone === 'IC') pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });

  // --- PUNKT NADAŃ: hala odpraw na pokładzie, rampa przy licu (bramy, lampy stanu), plac sortowni
  const a = I.pnA;
  const b = I.pnB;
  const mid = (a + b) / 2;
  const S = (d) => d / sc(500);
  // plac sortowni (jasna podłoga) z rzędami skrzyń w barwach przesyłek
  T.sec(a + S(120), mid - S(80), 200, 700, H.deck, 4, M.floor);
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 3; j++) {
      const h = pbHash1(i * 3.1 + j * 7.7 + 0.4);
      if (h < 0.22) continue;
      const mat = [M.orange, M.teal, M.yellow, M.pale][Math.floor(h * 31) % 4];
      T.box(a + S(260 + i * 120), 300 + j * 140, H.deck + 18, 80, 30, 70, mat);
    }
  }
  // hala odpraw: korpus, pas okien, dach ze stali, szyld
  f.set = 'fg';
  T.box(mid + S(420), 420, H.deck + 70, 980, 140, 560, M.steel);
  T.box(mid + S(420), 420 + 284, H.deck + 80, 900, 40, 8, M.glass);
  T.box(mid + S(420), 420, H.deck + 146, 1000, 12, 580, M.rail);
  for (const k of [0, 4]) T.box(mid + S(20 + k * 200), 420, H.deck + 160, 30, 16, 520, M.steel);
  T.box(mid + S(420), 160, H.deck + 158, 980, 10, 40, M.yellow);
  f.set = 'bg';
  T.label('PUNKT NADAŃ', mid + S(420), 440, 760, 210, style.labels.capital, 'USŁUGI RINGU · TOWAR GRACZA', H.deck + 156, 'fg');
  // rampa: daszek nad licem, bramy przy każdej zatoce gracza, lampy stanu (kanały) i strzałki
  const player = [];
  T.run(a + S(60), b - S(60), 975, 150, 14, 40, M.steel, 500);
  for (const bay of layout.playerBays || []) {
    const ch = player.length;
    const w = 300 / sc(V.inner1);
    T.box(bay.s, V.inner1 - 4, 80, 300, 120, 10, M.dark);
    T.box(bay.s, V.inner1 + 2, 80, 260, 100, 4, M.floor);
    for (const sd of [-1, 1]) T.box(bay.s + sd * w / 2, V.inner1 + 4, 80, 18, 130, 10, M.yellow);
    T.box(bay.s, V.inner1 + 4, 148, 320, 14, 10, M.yellow);
    f.fx(1.45, PB_FX.status, 0, ch);
    T.box(bay.s, V.inner1 - 30, H.deck + 22, 120, 14, 30, M.status);
    f.nofx();
    T.lamp(bay.s - w * 0.6, V.inner1 - 30, H.deck + 22, 18, bay.dir === 'in' ? M.green : M.warm, 1.0, PB_FX.blink, ch * 0.25, 0.7);
    player.push({ ch, bayId: bay.id, s: bay.s, dir: bay.dir });
  }
  pushLamp(lamps, mid, 700, 360, 1);

  // --- STACJA TOWAROWA (magazyn tranzytowy nad przystankiem kolei po stronie ringu)
  const sA = I.pnB;
  const sB = I.stB;
  const sm = (sA + sB) / 2;
  T.sec(sA + 40, sB - 40, 120, 700, H.deck, 4, M.floor);
  for (let i = 0; i < 14; i++) {
    const s = sA + 150 + i * ((sB - sA - 300) / 13);
    for (let j = 0; j < 3; j++) {
      const h = pbHash1(i * 1.7 + j * 4.3 + 9.2);
      if (h < 0.25) continue;
      const fam = CONTAINER_FAMILIES[Math.floor(pbHash1(i * 0.9 + 3.3) * CONTAINER_FAMILIES.length)];
      const tiers = 1 + Math.floor(h * 3);
      T.box(s, 220 + j * 150, H.deck + tiers * 20, 110, tiers * 40, 44, fam[Math.floor(h * 7) % fam.length]);
    }
  }
  controlBlock(T, f, sm, 830, 380, 180, 77);
  T.label('STACJA TOWAROWA', sm, 560, 900, 150, style.labels.clear, 'IMPORT DO FABRYK · PERON PO STRONIE RINGU');
  pushLamp(lamps, sm, 500, 360, 1);
  return sceneOf(f, plates, labels, lamps, { player });
}

// ---------------------------------------------------------------------------
// 2. Farma zbiorników

function sphereTank(T, s, v, r, mat) {
  // kula jako warstwy walców (z góry — koło z cieniowaniem), pas równikowy, nogi, króciec
  const y0 = H.floor + 30;
  const cy = y0 + r;
  const N = 5;
  for (let i = 0; i < N; i++) {
    const t0 = -1 + (2 * i) / N;
    const t1 = -1 + (2 * (i + 1)) / N;
    const tm = (t0 + t1) / 2;
    T.cyl(s, v, cy + tm * r, r * Math.sqrt(Math.max(0.05, 1 - tm * tm)), ((t1 - t0) * r) * 1.02, mat);
  }
  T.cyl(s, v, cy, r * 1.02, 16, M.rail);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    T.box(s + (Math.cos(a) * r * 0.92) / sc(v), v + Math.sin(a) * r * 0.92, (H.floor + cy) / 2, 18, cy - H.floor, 18, M.steel);
  }
  T.cyl(s, v, cy + r + 14, r * 0.16, 30, M.steel);
  T.lamp(s, v, cy + r + 34, 14, M.red, 1.4, PB_FX.blink, pbHash1(s * 0.01 + v * 0.003), 0.5);
}

function cylTank(T, s, v, r, mat) {
  const h = 230;
  const y0 = H.floor + 6;
  T.cyl(s, v, y0 + h / 2, r, h, mat);
  T.cyl(s, v, y0 + h - 4, r * 1.04, 10, M.rail);
  T.cyl(s, v, y0 + h + 6, r * 0.82, 12, mat);
  T.cyl(s, v, y0 + h + 16, r * 0.3, 10, M.steel);
  // schody po obwodzie (pasek) i odpowietrznik
  T.box(s + (r * 0.95) / sc(v), v, y0 + h / 2, 24, h, 40, M.yellow);
  T.cyl(s - (r * 0.4) / sc(v), v + r * 0.3, y0 + h + 34, 10, 30, M.steel);
}

/**
 * rig: { quay: [{ ch, berthId, pitId }] — lampy stanu nabrzeża, levels: [{ ch, id }] — wskaźniki napełnienia płynów
 * (PB_FX.fill na kanale), collectors: [s] — rurociągi do kratownicy }.
 */
export function buildFarmScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const F = SK.farm;
  rowBodies(T, f, layout, ['TR', 'TQ'], { strip: M.warm });
  rowBodies(T, f, layout, ['TB'], { floor: true });
  basinLip(T, F.a, F.b, F.road1, 1);
  basinLip(T, F.a, F.b, F.basin1, -1);
  endWall(T, F.a + 60 / sc(7000), F.road1, F.basin1);
  endWall(T, F.b - 60 / sc(7000), F.road1, F.basin1);
  for (const pit of layout.pits) if (pit.zone === 'TR') pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });
  const quay = [];
  for (const pit of layout.pits) {
    if (pit.zone !== 'TQ') continue;
    const ch = quay.length;
    pitDetail(T, f, pit, { statusCh: ch });
    quay.push({ ch, berthId: pit.berth.id, pitId: pit.id, s: pit.sc });
  }

  // --- kolumny płynów: obwałowania (dwa rzędy), zbiorniki, napisy, wskaźniki napełnienia
  const n = SK.fluids.length;
  const colW = (F.b - F.a) / n;
  const levels = [];
  SK.fluids.forEach((fl, i) => {
    const s0 = F.a + colW * i;
    const s1 = s0 + colW;
    const smid = (s0 + s1) / 2;
    const mat = M[fl.mat];
    const ch = quay.length + i;
    for (const [rv0, rv1] of SK.bundRows) {
      const vm = (rv0 + rv1) / 2;
      const sw = sc(vm);
      const g = 70 / sw;
      // wał: niski mur dookoła (jasny wierzch), w środku dno z odpływem
      T.run(s0 + g, s1 - g, rv0, 60, 84, 40, M.steel, 400);
      T.run(s0 + g, s1 - g, rv1, 60, 84, 40, M.steel, 400);
      for (const ss of [s0 + g, s1 - g]) T.box(ss, vm, 60, 40, 84, rv1 - rv0, M.steel);
      T.run(s0 + g, s1 - g, rv0, 104, 6, 46, M.rail, 400);
      T.run(s0 + g, s1 - g, rv1, 104, 6, 46, M.rail, 400);
      // zbiorniki 2 × 2 (kule albo walce)
      const ws = (s1 - s0 - 2 * g) * sw;
      const r = Math.min(fl.kind === 'sphere' ? 300 : 280, ws / 4 - 40, (rv1 - rv0) / 4 - 40);
      for (const da of [-1, 1]) {
        for (const dv of [-1, 1]) {
          const ts = smid + (da * ws) / 4 / sw;
          const tv = vm + (dv * (rv1 - rv0)) / 4;
          if (fl.kind === 'sphere') sphereTank(T, ts, tv, r, mat);
          else cylTank(T, ts, tv, r, mat);
        }
      }
      // rury od zbiorników do korytarza
      const toward = rv0 > SK.pipeV ? -1 : 1;
      const edge = toward > 0 ? rv1 : rv0;
      T.pipe(smid, vm, smid, edge + toward * 30, 70, 14, M.copper);
    }
    // napis płynu na dnie przy korytarzu rur, wskaźnik napełnienia (5 lamp)
    T.label(fl.label, smid, SK.pipeV + 120, Math.min(colW * 0.85, 760), 90, style.labels.clear, fl.id === 'fusion_fuel' ? 'IMPORT · KOLEJ K1' : 'IMPORT OD OLBRZYMÓW', H.floor + 6);
    for (let k = 0; k < 5; k++) {
      f.fx(1.0, PB_FX.fill, (k + 0.5) / 5, ch);
      T.box(smid - (240 - k * 120) / sc(SK.pipeV), SK.pipeV - 120, H.floor + 14, 80, 10, 30, mat === M.pale ? M.white : M.cyan);
      f.nofx();
    }
    levels.push({ ch, id: fl.id });
  });

  // --- korytarz rurociągów wzdłuż basenu (trzy rury na kozłach) i kolektory do kratownicy drogi
  const pv = SK.pipeV;
  const pipes = [[M.copper, -60, 22, 90], [M.pale, 0, 18, 110], [M.hose, 60, 14, 80]];
  for (const [mat, dv, r, y] of pipes) T.pipeRun(F.a + 120 / sc(pv), F.b - 120 / sc(pv), pv + dv, y, r, mat, 420);
  for (let s = F.a + 200 / sc(pv); s < F.b; s += 420 / sc(pv)) {
    T.box(s, pv, 50, 20, 70, 200, M.steel);
    T.box(s, pv, 86, 26, 6, 210, M.rail);
  }
  // kolektory: przez basen do przepompowni (ściany między dokami), wierzchem przepompowni i w dół do kratownicy
  const walls = wallsOf(layout.pits, 'TR', F.a, F.b).filter((w) => (w[1] - w[0]) * sc(V.outer0) > 700);
  const collectors = [];
  walls.forEach((w, i) => {
    const s = w[0] + (w[1] - w[0]) * (i % 2 ? 0.62 : 0.38);
    collectors.push(s);
    const mat = i % 2 ? M.pale : M.copper;
    T.pipe(s, pv, s, F.road1 + 40, 110, 22, mat);                         // przez basen
    for (let v = pv - 400; v > F.road1 + 100; v -= 500) T.box(s, v, 55, 40, 110, 40, M.steel);
    T.cyl(s, F.road1 + 40, 190, 22, 180, mat);                             // pion na pokład przepompowni
    T.pipe(s, F.road1 + 40, s, V.outer0 + 60, H.deck + 30, 22, mat);      // wierzchem
    for (let v = F.road1 - 200; v > V.outer0 + 200; v -= 400) T.box(s, v, H.deck + 12, 50, 24, 50, M.steel);
    T.box(s, V.outer0 + 300, H.deck + 40, 140, 60, 160, M.steel);          // pompa
    T.lamp(s, V.outer0 + 300, H.deck + 76, 16, M.warm, 1.0, PB_FX.steady);
    T.cyl(s, V.outer0 + 60, (H.deck + 30 - 250) / 2, 22, H.deck + 30 + 250, mat);   // pion w licu w dół pod drogę
    T.pipe(s, V.outer0 + 60, s, V.road + 190, -250, 22, mat);             // pod drogą do kratownicy
    T.cyl(s, V.road + 190, -290, 24, 80, mat);
    T.beam([s, V.road + 900, -250], [s, V.road + 190, H.spineBottom], 18, M.rail);
    T.beam([s, V.outer0 - 100, -250], [s, V.outer0 - 10, H.spineBottom], 18, M.rail);
    T.box(s, V.outer0 - 10, (-250 + H.spineBottom) / 2, 40, -250 - H.spineBottom, 40, M.dark);
  });

  // --- nabrzeże tankowców: kolektor wzdłuż nabrzeża, ramiona nalewcze przy dokach, dyspozytornia
  T.pipeRun(F.a + 80 / sc(F.basin1), F.b - 80 / sc(F.basin1), F.basin1 + 70, H.deck + 26, 18, M.copper, 420);
  T.pipeRun(F.a + 80 / sc(F.basin1), F.b - 80 / sc(F.basin1), F.basin1 + 110, H.deck + 22, 14, M.pale, 420);
  for (const pit of layout.pits) {
    if (pit.zone !== 'TQ') continue;
    for (const side of [-1, 1]) {
      const ss = (side < 0 ? pit.s0 : pit.s1) + (side * 70) / sc(pit.vc);
      const vv = pit.v0 + 330;
      T.box(ss, vv, H.deck + 40, 50, 80, 50, M.steel);
      f.set = 'fg';
      T.seg(ss, vv, ss - (side * 150) / sc(vv), vv + 60, H.deck + 150, 16, 18, M.yellow);
      T.box(ss, vv, H.deck + 110, 22, 140, 22, M.yellow);
      f.set = 'bg';
    }
    T.pipe(pit.sc, F.basin1 + 70, pit.sc, pit.v0 - 20, H.deck + 26, 16, M.copper);
  }
  controlBlock(T, f, F.b - 700 / sc(F.basin1), F.basin1 + 520, 420, 240, 31);
  T.label('NABRZEŻE TANKOWCÓW', (F.a + F.b) / 2 - 900, F.quay1 - 120, 1300, 150, style.labels.capital, 'IMPORT PŁYNÓW OD OLBRZYMÓW · PRZESTRZEŃ', H.deck + 9);
  T.label('FARMA ZBIORNIKÓW', (F.a + F.b) / 2, F.road1 - 520, 1500, 180, style.labels.hub, 'PRZEPOMPOWNIA · ODBIÓR CYSTERNAMI I KOLEJĄ');
  spire(T, f, F.a + 300 / sc(F.basin1), F.basin1 + 500, 240, 11);
  pushLamp(lamps, (F.a + F.b) / 2 - 1500, 7000, 420, 1);
  pushLamp(lamps, (F.a + F.b) / 2 + 1500, 7000, 420, 1);
  pushLamp(lamps, (F.a + F.b) / 2, F.basin1 + 500, 380, 1);
  return sceneOf(f, plates, labels, lamps, { quay, levels, collectors });
}

// ---------------------------------------------------------------------------
// 3. Terminal kontenerowy

/**
 * Suwnica bramowa nad blokiem stosów (grupa `g`; wózek z chwytakiem — grupa `gt`) w położeniu domowym s.
 * Wszystko w zestawie fg (nad statkami), nogi na szynach ±70 j. poza blokiem.
 */
function gantry(T, f, s, v0, v1, g, gt, k) {
  const vA = v0 - 70;
  const vB = v1 + 70;
  const top = 430;
  const S = (d) => d / sc((vA + vB) / 2);
  f.set = 'fg';
  f.group = g;
  for (const v of [vA, vB]) {
    for (const ds of [-1, 1]) T.box(s + S(ds * 70), v, (H.floor + top) / 2, 26, top - H.floor, 26, M.yellow);
    T.box(s, v, H.floor + 14, 200, 26, 40, M.dark);
    T.box(s, v, top - 10, 180, 20, 34, M.yellow);
  }
  for (const ds of [-1, 1]) T.seg(s + S(ds * 60), vA, s + S(ds * 60), vB, top + 14, 30, 24, M.yellow);
  T.seg(s, vA, s, vB, top + 34, 8, 110, M.rail);
  T.box(s + S(80), vA + 40, top - 40, 60, 50, 60, M.glass);
  T.lamp(s, (vA + vB) / 2, top + 44, 12, M.white, 1.3, PB_FX.blink, pbHash1(k * 1.3), 1.5);
  f.group = gt;
  // wózek na dźwigarze i chwytak z kontenerem (domowo nad środkiem bloku)
  const vm = (v0 + v1) / 2;
  T.box(s, vm, top + 40, 120, 30, 90, M.steel);
  T.box(s, vm, (top + 190) / 2, 4, top - 190, 4, M.rail);
  T.box(s, vm, 186, 116, 10, 50, M.dark);
  T.box(s, vm, 160, 110, 40, 44, CONTAINER_FAMILIES[k % CONTAINER_FAMILIES.length][0]);
  f.group = 0;
  f.set = 'bg';
}

/** Suwnica nabrzeżowa (grupa `g`, wózek `gt`): portal na nabrzeżu, wysięgnik nad pasem MEGA, zaplecze nad placem. */
function stsCrane(T, f, s, vLegA, vLegB, vBack, vTip, g, gt, k) {
  const top = 560;
  const S = (d) => d / sc((vLegA + vLegB) / 2);
  f.set = 'fg';
  f.group = g;
  for (const v of [vLegA, vLegB]) {
    for (const ds of [-1, 1]) T.box(s + S(ds * 110), v, (H.deck + top) / 2, 34, top - H.deck, 34, M.orange);
    T.box(s, v, H.deck + 14, 280, 26, 50, M.dark);
  }
  T.seg(s, vLegA, s, vLegB, top - 40, 40, 250, M.orange);
  for (const ds of [-1, 1]) T.seg(s + S(ds * 50), vBack, s + S(ds * 50), vTip, top + 20, 34, 30, M.orange);
  T.seg(s, vBack, s, vTip, top + 44, 8, 70, M.rail);
  T.box(s, vLegA, top + 90, 60, 100, 60, M.orange);
  T.beam([s, vLegA, top + 140], [s, vTip - 200, top + 30], 10, M.rail);
  T.beam([s, vLegA, top + 140], [s, vBack + 100, top + 30], 10, M.rail);
  T.box(s, vBack + 120, top + 40, 200, 60, 200, M.dark);
  T.box(s + S(130), vLegB + 30, top - 20, 70, 50, 70, M.glass);
  T.lamp(s, vTip - 20, top + 54, 14, M.red, 1.6, PB_FX.blink, pbHash1(k * 2.1), 0.6);
  T.lamp(s, vLegA, top + 150, 14, M.red, 1.6, PB_FX.blink, pbHash1(k * 2.7), 0.6);
  f.group = gt;
  const vm = (vLegA + vLegB) / 2;
  T.box(s, vm, top + 50, 130, 30, 110, M.steel);
  T.box(s, vm, (top + 300) / 2, 4, top - 300, 4, M.rail);
  T.box(s, vm, 296, 124, 10, 52, M.dark);
  T.box(s, vm, 270, 118, 40, 46, CONTAINER_FAMILIES[(k + 2) % CONTAINER_FAMILIES.length][0]);
  f.group = 0;
  f.set = 'bg';
}

/**
 * rig: { gantries: [{ g, gt, s, sMin, sMax, v0, v1 }], sts: [{ g, gt, s, sMin, sMax, vLegs, vBack, vTip }],
 * quay: [{ ch, berthId, pitId }], mega: [{ ch, berthId }] }.
 */
export function buildTerminalScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const C = SK.ct;
  rowBodies(T, f, layout, ['CR', 'CL', 'CQ'], { strip: M.cyan });
  rowBodies(T, f, layout, ['CY'], { floor: true });
  basinLip(T, C.a, C.b, C.road1, 1);
  basinLip(T, C.a, C.b, C.yard1, -1);
  endWall(T, C.a + 60 / sc(7000), C.road1, C.yard1);
  endWall(T, C.b - 60 / sc(7000), C.road1, C.yard1);
  for (const pit of layout.pits) if (pit.zone === 'CR') pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });
  const quay = [];
  for (const pit of layout.pits) {
    if (pit.zone !== 'CL') continue;
    const ch = quay.length;
    pitDetail(T, f, pit, { statusCh: ch });
    quay.push({ ch, berthId: pit.berth.id, pitId: pit.id, s: pit.sc });
  }
  const mega = [];
  megaDetail(T, f, layout, 'CQ', style, (berthId) => { const ch = quay.length + mega.length; mega.push({ ch, berthId }); return ch; });

  // --- plac: pasy jezdne między blokami, szyny suwnic, stosy kontenerów w rodzinach barw
  const gantries = [];
  let group = 0;
  const blocks = C.blocks;
  blocks.forEach(([v0, v1], bi) => {
    const vm = (v0 + v1) / 2;
    const sw = sc(vm);
    for (const v of [v0 - 70, v1 + 70]) T.run(C.stackA - 100 / sw, C.stackB + 100 / sw, v, H.floor + 4, 6, 14, M.rail, 500);
    // pas jezdny za blokiem (żółte linie krawędzi)
    if (bi < blocks.length - 1) {
      const lv = (v1 + blocks[bi + 1][0]) / 2;
      for (const o of [-150, 150]) T.run(C.stackA, C.stackB, lv + o, H.floor + 2, 2, 10, M.yellow, 600);
    }
    const pitch = 125 / sw;
    const nb = Math.floor((C.stackB - C.stackA) / pitch);
    const rows = Math.floor((v1 - v0) / 50);
    for (let i = 0; i < nb; i++) {
      if (i % 12 === 11) continue;                       // przejście poprzeczne co 12 kontenerów
      const s = C.stackA + (i + 0.5) * pitch;
      const fam = CONTAINER_FAMILIES[Math.floor(pbHash1(Math.floor(i / 12) * 3.7 + bi * 11.1) * CONTAINER_FAMILIES.length)];
      for (let j = 0; j < rows; j++) {
        const h = pbHash1(i * 0.731 + j * 2.913 + bi * 17.3);
        if (h < 0.1) continue;
        const tiers = 1 + Math.floor(pbHash1(i * 1.37 + j * 0.53 + bi) * 4);
        const mat = fam[Math.floor(h * 113) % fam.length];
        T.box(s, v0 + 25 + j * 50, H.floor + tiers * 20, 112, tiers * 40, 44, mat);
      }
    }
    // dwie suwnice na blok, każda w swojej połowie
    const half = (C.stackB - C.stackA) / 2;
    for (let q = 0; q < 2; q++) {
      const sMin = C.stackA + q * half + (q ? 450 : 150) / sw;
      const sMax = C.stackA + (q + 1) * half - (q ? 150 : 450) / sw;
      const s0 = (sMin + sMax) / 2;
      const g = ++group;
      const gt = ++group;
      gantry(T, f, s0, v0, v1, g, gt, bi * 2 + q);
      gantries.push({ g, gt, s: s0, sMin, sMax, v0, v1 });
    }
  });

  // --- suwnice nabrzeżowe nad pasem MEGA
  const sts = [];
  const lane = layout.megaLanes.find((m) => m.zone === 'CQ');
  if (lane) {
    const vLegA = C.yard1 + 120;
    const vLegB = C.quay1 - 120;
    const vBack = C.yard1 - 500;
    const vTip = lane.v + lane.width / 2 + 250;
    T.run(lane.sc - lane.sHalf * 1.25, lane.sc + lane.sHalf * 1.25, vLegA, H.deck + 4, 6, 20, M.rail, 500);
    T.run(lane.sc - lane.sHalf * 1.25, lane.sc + lane.sHalf * 1.25, vLegB, H.deck + 4, 6, 20, M.rail, 500);
    for (let k = 0; k < 3; k++) {
      const s = lane.sc + (k - 1) * lane.sHalf * 0.62;
      const g = ++group;
      const gt = ++group;
      stsCrane(T, f, s, vLegA, vLegB, vBack, vTip, g, gt, k);
      sts.push({ g, gt, s, sMin: s - lane.sHalf * 0.16, sMax: s + lane.sHalf * 0.16, vLegs: (vLegA + vLegB) / 2, vBack: vBack + 200, vTip: vTip - 200, vShip: lane.v });
    }
  }
  // nabrzeże L: ramy bram i stosik kontenerów przy każdym doku
  for (const pit of layout.pits) {
    if (pit.zone !== 'CL') continue;
    for (const side of [-1, 1]) {
      const ss = (side < 0 ? pit.s0 : pit.s1) + (side * 90) / sc(pit.vc);
      for (let k = 0; k < 3; k++) T.box(ss, pit.v0 + 150 + k * 60, H.deck + 20, 100, 40, 44, CONTAINER_FAMILIES[(k + (side > 0 ? 1 : 3)) % 5][0]);
    }
  }
  controlBlock(T, f, C.lB + 300 / sc(C.yard1), C.yard1 + 550, 380, 220, 41);
  spire(T, f, C.b - 260 / sc(C.yard1), C.yard1 + 550, 240, 13);
  T.label('TERMINAL KONTENEROWY', (C.a + C.b) / 2 - 600, C.road1 - 480, 1700, 190, style.labels.hub, 'IMPORT RAFINATÓW · EKSPORT ZIEMI · KOLEJ K2 / K3');
  T.label('NABRZEŻE', (C.a + C.lB) / 2, C.quay1 - 80, 900, 110, style.labels.capital, 'FRACHTOWCE · PRZESTRZEŃ');
  pushLamp(lamps, (C.a + C.b) / 2 - 1800, 7000, 520, 1);
  pushLamp(lamps, (C.a + C.b) / 2 + 1800, 7000, 520, 1);
  pushLamp(lamps, C.megaS, C.quay1 + 200, 600, 1);
  if (group + 1 > PB_MAX_GROUPS) throw new Error(`terminal: ${group} grup > ${PB_MAX_GROUPS - 1}`);
  return sceneOf(f, plates, labels, lamps, { gantries, sts, quay, mega, groups: group });
}

// ---------------------------------------------------------------------------
// 4. Wysokie składy

/** rig: { quay: [{ ch, berthId, pitId }] }. */
export function buildHighBayScene(layout, style, { occupied = new Set() } = {}) {
  const { f, plates, labels, lamps, T } = newScene();
  const Hs = SK.hs;
  rowBodies(T, f, layout, ['HB'], { greeble: false, strip: M.warm });
  rowBodies(T, f, layout, ['HQ'], { strip: M.cyan });
  const quay = [];
  for (const pit of layout.pits) {
    if (pit.zone !== 'HQ') continue;
    const ch = quay.length;
    pitDetail(T, f, pit, { statusCh: ch, occupied: occupied.has(pit.berth.id) });
    quay.push({ ch, berthId: pit.berth.id, pitId: pit.id, s: pit.sc });
  }
  // hale wysokiego składowania: trzy hale wzdłuż łuku, każda z regałami (żebra dachu), świetlikami i rampą od drogi
  const halls = [['HALA A', 'PŁYTY KADŁUBA · NAPĘDY'], ['HALA B', 'AWIONIKA · UKŁADY · OPTYKA'], ['HALA C', 'UZBROJENIE · TAŚMA NADPRZEWODZĄCA']];
  const n = halls.length;
  const v0 = V.outer0 + 420;
  const v1 = Hs.v1 - 260;
  const vm = (v0 + v1) / 2;
  const sw = sc(vm);
  const span = (Hs.b - Hs.a) / n;
  halls.forEach(([name, small], i) => {
    const a = Hs.a + span * i + 70 / sw;
    const b = Hs.a + span * (i + 1) - 70 / sw;
    const m = (a + b) / 2;
    const ls = (b - a) * sw;
    f.set = 'fg';
    T.box(m, vm, H.deck + 130, ls, 260, v1 - v0, M.dark);
    T.box(m, vm, H.deck + 264, ls - 30, 8, v1 - v0 - 30, M.rail);
    const ribs = Math.max(4, Math.round(ls / 170));
    for (let k = 0; k <= ribs; k++) T.box(a + ((b - a) * k) / ribs, vm, H.deck + 272, 22, 14, v1 - v0 + 20, M.steel);
    // świetliki krótkie, w szachownicę; urządzenia na dachu
    const rowsV = 5;
    for (let k = 0; k < ribs; k++) {
      const s = a + ((b - a) * (k + 0.5)) / ribs;
      for (let j = 0; j < rowsV; j++) {
        if ((k + j) % 2) continue;
        T.box(s, v0 + ((v1 - v0) * (j + 0.5)) / rowsV, H.deck + 270, 70, 6, 260, M.glass);
      }
    }
    for (let k = 0; k < 3; k++) {
      const s = a + ((b - a) * (0.2 + 0.3 * k));
      T.box(s, v1 - 260, H.deck + 300, 120, 50, 120, M.steel);
      T.cyl(s, v1 - 260, H.deck + 336, 36, 20, M.rail);
    }
    T.box(m, v0 + 30, H.deck + 276, ls - 60, 10, 30, M.yellow);
    // przybudówki rampowe od drogi (niższe), bramy z żółtymi ramami
    T.box(m, V.outer0 + 200, H.deck + 60, ls * 0.9, 120, 300, M.steel);
    T.box(m, V.outer0 + 200, H.deck + 124, ls * 0.92, 8, 310, M.rail);
    f.set = 'bg';
    T.label(name, m, vm, Math.min(ls * 0.7, 700), 190, style.labels.capital, small, H.deck + 280, 'fg');
  });
  // rampy przy zatokach ciężarówek: bramy na licu i strzałki
  for (const bay of layout.truckBays) {
    if (bay.side < 0 || bay.s < Hs.a || bay.s > Hs.b) continue;
    const w = 280 / sc(V.outer0);
    T.box(bay.s, V.outer0 + 4, 80, 280, 120, 10, M.dark);
    for (const sd of [-1, 1]) T.box(bay.s + sd * w / 2, V.outer0 - 4, 80, 18, 130, 10, M.yellow);
    T.box(bay.s, V.outer0 - 4, 148, 300, 14, 10, M.yellow);
  }
  // nabrzeże eksportu: wózki widłowe-skrzynie przy dokach
  for (const pit of layout.pits) {
    if (pit.zone !== 'HQ') continue;
    for (const side of [-1, 1]) {
      const ss = (side < 0 ? pit.s0 : pit.s1) + (side * 90) / sc(pit.vc);
      for (let k = 0; k < 2; k++) T.box(ss, pit.v0 + 200 + k * 70, H.deck + 18, 90, 36, 50, k ? M.pale : M.orange);
    }
  }
  T.label('WYSOKIE SKŁADY', (Hs.a + Hs.b) / 2, Hs.quay1 - 120, 1400, 160, style.labels.hub, 'EKSPORT PODZESPOŁÓW · DOKI L OD PRZESTRZENI', H.deck + 9);
  spire(T, f, Hs.b - 300 / sc(Hs.v1), Hs.v1 - 120, 220, 17);
  pushLamp(lamps, (Hs.a + Hs.b) / 2, Hs.quay1 + 300, 380, 1);
  return sceneOf(f, plates, labels, lamps, { quay });
}
