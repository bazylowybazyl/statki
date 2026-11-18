// HUTA — element 3 (formowanie i walcowanie), etap „Złożenie”: komora wytopu nad pokładem hali jako naczynie-lejek.
// Testy geometrii złożenia (PROJEKT § 5, p. 1), stanu zaworu dyszy i doku żużla, materiału otoczenia (WGSL w Node).
// Etap „Pasmo w polu” (PROJEKT § 5, p. 2, 4–9): bilans linii po każdym kroku z prawdziwą komorą, wypływ = dopływ,
// temperatura nierosnąca wzdłuż pasma, front krzepnięcia z przepływem, start i koniec pasma, zmiana metalu, fala,
// powtarzalność, krok i stacje bez alokacji, osprzęt pola poza pasmem, WGSL metalu linii.
// Etap „Kropla” (wylot bokiem, błona pola): rura spustowa i wylewka poza obrysem naczynia, droga strugi z góry do błony,
// zawór na wylewce, masa w rurze w bilansie, wypływ rośnie ze ściskiem, kształt błony = masa, osprzęt pola poza błoną.
// Etap „Wyciskanie” (runda 7): rękaw pola z wędrującym zaciskiem — zacisk jedzie ku gardzieli, gdy masy ubywa, za nim
// nie ma metalu, zrzut napełnia rękaw od miejsca wpadania, wypływ rośnie z posuwem zacisku, bilans 0 po każdym podkroku,
// stan taśmy przy F1 w nominale bez zmian, bramki zacisku poza błoną.
// Etap „Walcowanie” (klatki F1–F3): stałość przepływu masy przez każdą klatkę, prędkość obwodowa walców = prędkość taśmy
// na wyjściu, czoło i koniec przez klatki bez teleportacji (chwyty, pętle), bilans z komorą, krok bez alokacji, styk
// taśmy z walcami, bryły walcowni poza drogą taśmy, iskry zgorzeliny.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KOMORA, gasPipeRoute, pathSample } from '../dema/ring-dzielnice/huta/wytop/geometria.js';
import { LICZNIK, PROCES, STAN, UNITS_PER_TON, createMeltChamber } from '../dema/ring-dzielnice/huta/wytop/komora.js';
import { Budowniczy, buildChamberStatic } from '../dema/ring-dzielnice/huta/wytop/wyposazenie.js';
import {
  BLONA, DOK_ZUZLA, DROGA, HALA, LINIA, LINIA_DX, NACZYNIE, PATH, POMOST, SPUST, WIDOKI, ZACISK, ZAWOR, arcRingFrame, chamberInnerRadiusAt, legAt,
  slagDockFrame, spustPoint
} from '../dema/ring-dzielnice/huta/formowanie/geometria.js';
import { OTO, buildFormingStatic, flapHinge, flapRotate, shellRadiusAt, slagChutePath, valvePoint } from '../dema/ring-dzielnice/huta/formowanie/otoczenie.js';
import { RK_DX, RK_N, RK_X, areaAt, sectionAt, tubeVolume } from '../dema/ring-dzielnice/huta/formowanie/blona.js';
import { createNozzleValve, createSlagDock } from '../dema/ring-dzielnice/huta/formowanie/stanZlozenia.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';
import {
  LAND_X0, LIN_LICZNIK, LIN_STAN, LIN_WEJ, LIN_WEJ_N, METAL_FIZ, PASMO, PL, TRYB, VOL_TON, VOL_UNIT, createFormingLine, gateWidth, ironAt
} from '../dema/ring-dzielnice/huta/formowanie/linia.js';
import { CHLODNICE, STACJE, createStationFiller, lowestMetalY } from '../dema/ring-dzielnice/huta/formowanie/stacje.js';
import { CHILL_SHIFT, OTO_POLE, POLE_K } from '../dema/ring-dzielnice/huta/formowanie/polePasma.js';
import { PRZESLO, WALC, axisHalfAt, createRollingMill, rollCenters } from '../dema/ring-dzielnice/huta/formowanie/walcownia.js';
import { KLATKA, OSLONA, OTO_WALC, POLE_PETLA, buildRollingMill } from '../dema/ring-dzielnice/huta/formowanie/walcowniaBryly.js';
import { DZIEL, FRONT_MAX, XB } from '../dema/ring-dzielnice/huta/dzielenie/geometria.js';
import { createDivider } from '../dema/ring-dzielnice/huta/dzielenie/model.js';
import { ODZ_DEB, ZGORZ, createScaleDebris } from '../dema/ring-dzielnice/huta/formowanie/zgorzelina.js';
import { ISKRY_CAP, createLineSparks } from '../dema/ring-dzielnice/huta/formowanie/iskry.js';
import { ODZG, OZ_X0, OZ_X1, buildDescaler, descaleKeep, descaleProfile, descalerBoxes } from '../dema/ring-dzielnice/huta/formowanie/odzgorzanie.js';

const DT = 1 / 60;
const TAU = Math.PI * 2;

function outside() {
  const B = new Budowniczy(300000);
  buildFormingStatic(B);
  return B;
}
/** Linia z błoną w równowadze przy masie `tons` (rękaw i zacisk z `tubeEquilibrium`, bez kroków). */
function bagAt(tons, metal = 0) { return createFormingLine({ seed: 5, metal, prefillTons: tons, prefillRun: 0 }); }
/** Rekordy stacji błony z linii: [{ x, y, a, b, kind, sa, sb, shell, pin }] (metal i powłoka pola). */
function bagStations(line) {
  const out = new Float32Array(STACJE.n * STACJE.stride);
  createStationFiller().fill(line, null, 0, DT, out);
  const st = [];
  for (let q = STACJE.bag.i0; q < STACJE.bag.i0 + STACJE.bag.n; q++) {
    const r = q * STACJE.stride;
    st.push({ x: out[r], y: out[r + 1], a: out[r + 4], b: out[r + 5], kind: out[r + 7], sa: out[r + 20], sb: out[r + 21], shell: out[r + 22], pin: out[r + 23] });
  }
  return st;
}

test('formowanie/złożenie: bryły otoczenia bez NaN, w pojemności; nic nie sięga wyżej niż kołnierz z lampami (y ≤ 430)', () => {
  const B = outside();
  assert.equal(B.over, 0);
  assert.ok(B.n > 50000 && B.n < 300000, `wierzchołków ${B.n}`);
  let top = -Infinity;
  for (let i = 0; i < B.n; i++) {
    for (let j = 0; j < 3; j++) if (!Number.isFinite(B.pos[i * 3 + j]) || !Number.isFinite(B.nor[i * 3 + j])) assert.fail('NaN w bryłach otoczenia');
    top = Math.max(top, B.pos[i * 3 + 1]);
  }
  // nad płaszczyzną gry (gra ściska tam wysokość × 0,42) — tylko kołnierz z obudowami generatorów i rura tlenu (oś 13 j. nad)
  assert.ok(top <= 430, `najwyżej ${top.toFixed(1)}`);
});

test('formowanie/złożenie: płaszcz naczynia ≥ 37 j. od wnętrza komory (poza oknem zatoki i rurą gardzieli); profil gładki', () => {
  const C = new Budowniczy(300000);
  buildChamberStatic(C);
  const bay = KOMORA.bay;
  let worst = Infinity;
  let at = null;
  for (let i = 0; i < C.n; i++) {
    const x = C.pos[i * 3];
    const y = C.pos[i * 3 + 1];
    const z = C.pos[i * 3 + 2];
    if (y > NACZYNIE.flange.y0 - 1 || y < KOMORA.funnel.throatY - 1) continue;      // kołnierz z góry; rura gardzieli (wspólna z dyszą)
    if (x < 0 && z > bay.z0 - 12 && z < bay.z1 + 12 && y > NACZYNIE.bayBox.floorY - NACZYNIE.bayBox.thick - 1) continue;   // zatoka taśmy
    // zastrzały wysięgnika taśmy kotwią się w ścianie pod zatoką (do r 545, ukryte w grubości ściany pod płaszczem)
    if (x < 0 && z > bay.z0 && z < bay.z1 + 12 && y > -140 && Math.hypot(x, z) < 550) continue;
    const gap = shellRadiusAt(y) - Math.hypot(x, z);
    if (gap < worst) { worst = gap; at = [x, y, z]; }
  }
  assert.ok(worst >= 37, `najmniejszy odstęp płaszcz ↔ wnętrze ${worst.toFixed(1)} j. przy ${at && at.map((v) => v.toFixed(0))}`);
  // profil liczony (geometria) też: płaszcz ≥ 37 j. od leja i ściany ze szczeliną odciągu
  for (let y = NACZYNIE.flange.y0 - 5; y > KOMORA.funnel.throatY; y -= 5) {
    assert.ok(shellRadiusAt(y) - chamberInnerRadiusAt(y) >= 37 - 1e-6, `odstęp na y ${y}: ${(shellRadiusAt(y) - chamberInnerRadiusAt(y)).toFixed(1)}`);
  }
  // zaokrąglenia: promień płaszcza ciągły (bez schodów) od walca do gardzieli
  let prev = shellRadiusAt(NACZYNIE.flange.y0 - 1);
  for (let y = NACZYNIE.flange.y0 - 2; y > -775; y -= 1) {
    const r = shellRadiusAt(y);
    assert.ok(Math.abs(r - prev) < 2, `skok promienia płaszcza na y ${y}`);
    prev = r;
  }
  // gardziel nad pokładem hali; rura spustowa pod dyszą: od kolana nic nie wchodzi w bryłę naczynia (wierzch płaszcza rury
  // poniżej najniższego punktu dyszy), prześwit nad pokładem hali
  assert.ok(KOMORA.funnel.pipeY > LINIA.nozzleY, 'rura gardzieli kończy się w dyszy');
  const q = new Float64Array(6);
  for (let s = 60; s <= DROGA.sLip; s += 4) {
    spustPoint(s, q);
    if (Math.hypot(q[0], q[2]) < SPUST.elbowR) continue;
    assert.ok(q[1] + SPUST.rOut < -787 - 3, `rura spustowa wchodzi w naczynie na s ${s}`);
    assert.ok(q[1] - SPUST.rOut - HALA.deckY > 250, `rura nad pokładem hali na s ${s}`);
  }
});

test('formowanie/złożenie: nogi, rury, dok i słupy poza korytarzem linii; nad pasmem nic; pokład pod pełnym zasobnikiem', () => {
  const L = LINIA;
  const inCorr = (x, z, pad = 0) => x > L.corridorX && Math.abs(z) < L.corridor + pad;
  for (let k = 0; k < NACZYNIE.legs.az.length; k++) {
    for (let y = NACZYNIE.ring.y - NACZYNIE.ring.h / 2; y >= HALA.deckY; y -= 20) {
      const [x, z] = legAt(k, y);
      assert.ok(!inCorr(x, z, NACZYNIE.legs.w1 / 2 + NACZYNIE.legs.foot / 2), `noga ${k} w korytarzu na y ${y}`);
      // noga nie wchodzi w płaszcz
      assert.ok(Math.hypot(x, z) - NACZYNIE.legs.w0 > shellRadiusAt(y) - 1, `noga ${k} w płaszczu na y ${y}`);
    }
  }
  const q = new Float64Array(6);
  const route = gasPipeRoute(0).path;
  for (let s = 0; s <= route.len; s += 5) {
    pathSample(route, s, q);
    assert.ok(!inCorr(q[0], q[2], KOMORA.gaz.pipe.r), `rura tlenu w korytarzu (s ${s})`);
    // poza nogami
    for (let k = 0; k < 4; k++) {
      if (q[1] > NACZYNIE.ring.y - NACZYNIE.ring.h / 2 || q[1] < HALA.deckY) continue;
      const [lx, lz] = legAt(k, q[1]);
      assert.ok(Math.hypot(q[0] - lx, q[2] - lz) > NACZYNIE.legs.w1 / 2 * Math.SQRT2 + KOMORA.gaz.pipe.r, `rura tlenu w nodze ${k}`);
    }
  }
  const ch = slagChutePath();
  for (let s = 0; s <= ch.len; s += 5) {
    pathSample(ch, s, q);
    assert.ok(!inCorr(q[0], q[2], DOK_ZUZLA.pipeR), 'rura żużla w korytarzu');
    for (let k = 0; k < 4; k++) {
      if (q[1] > NACZYNIE.ring.y - NACZYNIE.ring.h / 2 || q[1] < HALA.deckY) continue;
      const [lx, lz] = legAt(k, q[1]);
      assert.ok(Math.hypot(q[0] - lx, q[2] - lz) > NACZYNIE.legs.w1 / 2 * Math.SQRT2 + DOK_ZUZLA.pipeR, `rura żużla w nodze ${k}`);
    }
  }
  const F = slagDockFrame();
  const hl = DOK_ZUZLA.len / 2;
  const hw = DOK_ZUZLA.wid / 2;
  for (const [u, v] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]) {
    const x = F.x + F.c * u - F.s * v;
    const z = F.z + F.s * u + F.c * v;
    assert.ok(!inCorr(x, z), 'dok żużla w korytarzu');
    assert.ok(x > HALA.deck.x0 && x < HALA.deck.x1 && z > HALA.deck.z0 && z < HALA.deck.z1, 'dok żużla na pokładzie hali');
    // dok poza stopami nóg (z cokołem)
    for (let k = 0; k < 4; k++) {
      const [lx, lz] = legAt(k, HALA.deckY);
      const a = NACZYNIE.legs.az[k] * Math.PI / 180;
      const du = (x - lx) * Math.cos(a) + (z - lz) * Math.sin(a);
      const dv = -(x - lx) * Math.sin(a) + (z - lz) * Math.cos(a);
      assert.ok(Math.abs(du) > NACZYNIE.legs.foot / 2 + 16 || Math.abs(dv) > NACZYNIE.legs.foot / 2 + 16, `dok na stopie nogi ${k}`);
    }
  }
  for (const [x, z] of POMOST.cols) assert.ok(!inCorr(x, z, POMOST.colW), 'słup pomostu w korytarzu');
  const T = KOMORA.gaz.tanks;
  for (const z of T.z) assert.ok(!inCorr(T.x0, z, T.r) && !inCorr(T.x1, z, T.r), 'zbiornik tlenu w korytarzu');
  // nad pasmem (|z| < 110, nad osią pasma, x od wylotu G0 do końca drogi pasma) nic nie stoi poza GÓRNYMI WALCAMI klatek
  // F1–F3 (w ich bryle obrotowej) — etap „Walcowanie”; runda 8: brama „DO ZWIJARKI” usunięta, nóż dzielenia stoi po
  // bokach taśmy (wózki |z| ≥ 110), rynna i stoły gniazd poniżej osi; runda 9: STACJA ODZGORZANIA (belka górna 14 j. nad
  // taśmą i brzegi ssaw) — jej prostopadłościany z `descalerBoxes`
  const B = outside();
  const rolls = [0, 1, 2].map((k) => rollCenters(k));
  const oz = descalerBoxes();
  const inOz = (x, y, z) => oz.some(({ b }) => x >= b[0] - 0.5 && x <= b[1] + 0.5 && y >= b[2] - 0.5 && y <= b[3] + 0.5 && z >= b[4] - 0.5 && z <= b[5] + 0.5);
  for (let i = 0; i < B.n; i++) {
    const x = B.pos[i * 3];
    const y = B.pos[i * 3 + 1];
    const z = B.pos[i * 3 + 2];
    if (Math.abs(z) < 110 && y > HALA.passY && x > L.gates[0].x - 10 && x < L.stripEndX + 60) {
      if (rolls.some(([xc, yu]) => Math.hypot(x - xc, y - yu) <= WALC.R + 0.01)) continue;   // górny walec
      if (inOz(x, y, z)) continue;                                                              // stacja odzgorzania
      assert.ok(Math.hypot(x, z) < Math.max(NACZYNIE.flange.rOut, NACZYNIE.ring.r1) + 4, `bryła nad pasmem: ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}`);
    }
  }
  // pokład ≥ 50 j. pod pełną błoną (250 t w rękawie, z zapasem na mody i falę 15 %)
  {
    let lo = Infinity;
    for (const st of bagStations(bagAt(250))) if (st.kind) lo = Math.min(lo, st.y - st.b * 1.15);
    assert.ok(lo - HALA.deckY >= 50, `błona nad pokładem: ${(lo - HALA.deckY).toFixed(0)} j.`);
  }
  // bramki zacisku (progi z płetwami, podpory): poza stopami nóg, zbiornikami tlenu i dokiem żużla
  const Zc = ZACISK;
  const TK = KOMORA.gaz.tanks;
  for (const sd of [-1, 1]) {
    for (let x = Zc.x0 - 20; x <= Zc.x1 + 20; x += 10) {
      for (const z of TK.z) assert.ok(Math.abs(sd * Zc.zR - z) > TK.r + 30 || x < TK.x0 - 40 || x > TK.x1 + 40, 'bramka zacisku w zbiorniku tlenu');
      for (let k = 0; k < 4; k++) { const [lx, lz] = legAt(k, HALA.deckY); assert.ok(Math.hypot(x - lx, sd * Zc.zR - lz) > NACZYNIE.legs.foot, `bramka zacisku przy stopie nogi ${k}`); }
    }
  }
  const Fd = slagDockFrame();
  for (const [u, v] of [[-DOK_ZUZLA.len / 2, -DOK_ZUZLA.wid / 2], [DOK_ZUZLA.len / 2, -DOK_ZUZLA.wid / 2], [DOK_ZUZLA.len / 2, DOK_ZUZLA.wid / 2], [-DOK_ZUZLA.len / 2, DOK_ZUZLA.wid / 2]]) {
    const zc = Fd.z + Fd.s * u + Fd.c * v;
    const xc = Fd.x + Fd.c * u - Fd.s * v;
    assert.ok(Math.abs(zc) > Zc.zR + 40 || xc < Zc.x0 - 40, 'dok żużla przy bramkach zacisku');
  }
});

test('formowanie/kropla: droga metalu — kolano, rura, wylewka i łuk strugi ciągłe w punkcie i stycznej; struga wchodzi w błonę z góry', () => {
  const a = new Float64Array(6);
  const b = new Float64Array(6);
  // ciągłość w każdym punkcie tablicy drogi (krok 1 j.): położenie, styczna — kąt < 2° na 1 j.
  for (let s = 1; s < DROGA.sEnd - 1; s += 1) {
    spustPoint(s - 0.5, a);
    spustPoint(s + 0.5, b);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert.ok(d > 0.9 && d < 1.02, `skok drogi na s ${s}: ${d.toFixed(3)}`);
    assert.ok(a[3] * b[3] + a[4] * b[4] > Math.cos(2 * Math.PI / 180), `załamanie stycznej na s ${s}`);
  }
  spustPoint(0, a);
  assert.ok(Math.abs(a[1] - SPUST.y0) < 1e-6 && Math.abs(a[0]) < 1e-6 && a[4] < -0.99, 'droga zaczyna się pionowo pod dyszą');
  spustPoint(DROGA.sLip, a);
  assert.ok(Math.abs(a[0] - SPUST.lip[0]) < 0.5 && Math.abs(a[1] - SPUST.lip[1]) < 0.5, 'warga wylewki');
  spustPoint(DROGA.sEnd, a);
  assert.ok(Math.abs(a[0] - SPUST.inlet[0]) < 0.5 && Math.abs(a[1] - SPUST.inlet[1]) < 0.5, 'koniec drogi w środku błony');
  assert.ok(a[4] < -0.8, `struga wchodzi z góry (styczna ${a[4].toFixed(2)})`);
  // łuk strugi: wyraźna składowa pozioma (z kamery gry) i opadanie bez wznoszenia
  assert.ok(SPUST.inlet[0] - SPUST.lip[0] > 250, 'struga ma składową poziomą');
  for (let s = DROGA.sLip; s < DROGA.sEnd; s += 2) { spustPoint(s, a); assert.ok(a[4] <= 1e-9, 'struga nie wznosi się'); }
  // kolejność elementów linii wzdłuż x; linia przesunięta o LINIA_DX względem etapu „Pasmo”
  const xs = [SPUST.lip[0], BLONA.x0, SPUST.inlet[0], ...LINIA.gates.map((g) => g.x), ...LINIA.stands.map((s) => s.x), XB, LINIA.stripEndX];
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1], `elementy linii po kolei (${i})`);
  assert.equal(LINIA.gates[0].x, 1020 + LINIA_DX);
  assert.equal(LINIA.stands[0].x, 1960 + LINIA_DX);
  assert.ok(LINIA.stripEndX < HALA.deck.x1 - 40, 'koniec drogi pasma na pokładzie hali');
});

test('formowanie/złożenie: widok 1 (perspektywa gry) obejmuje kołnierz, wylewkę, błonę, klatki, dzielenie z bramami WYJAZD, zbiorniki i dok', () => {
  const [x0, z0, x1, z1] = WIDOKI.top1;
  const Wpx = 1600;
  const Hpx = 900;
  const zoom = Math.min(Wpx / (x1 - x0), Hpx / (z1 - z0));
  const hc = (Hpx / 2) / Math.tan(17.5 * Math.PI / 180) / zoom;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const proj = (x, y, z) => {
    const k = hc / (hc + (HALA.planeY - y));
    return [Wpx / 2 + (x - cx) * zoom * k, Hpx / 2 + (z - cz) * zoom * k];
  };
  const inside = (p) => p[0] >= 0 && p[0] <= Wpx && p[1] >= 0 && p[1] <= Hpx;
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * TAU;
    assert.ok(inside(proj(Math.cos(a) * 640, 400, Math.sin(a) * 640)), 'kołnierz w kadrze');
  }
  // wylewka, łuk strugi, cała błona (pełna) i gardziel G0 w kadrze
  assert.ok(inside(proj(SPUST.lip[0], SPUST.lip[1], 0)), 'wylewka w kadrze');
  for (let x = BLONA.x0; x <= BLONA.xG0; x += 20) for (const z of [-320, 0, 320]) assert.ok(inside(proj(x, BLONA.yc, z)), `błona w kadrze (${x}, ${z})`);
  for (const z of [-ZACISK.zR, ZACISK.zR]) assert.ok(inside(proj(ZACISK.x0, ZACISK.finTop, z)) && inside(proj(ZACISK.x1, ZACISK.finTop, z)), 'bramki zacisku w kadrze');
  for (const s of LINIA.stands) for (const z of [-260, 260]) assert.ok(inside(proj(s.x, HALA.passY, z)), `${s.id} w kadrze`);
  // (runda 8) dzielenie: nóż, gniazda, odbiór i bramy WYJAZD w ścianie czołowej, krawędź pokładu
  assert.ok(inside(proj(XB, HALA.passY, 230)) && inside(proj(XB, HALA.passY, -230)), 'nóż dzielenia w kadrze');
  // (runda 9) brama WYJAZD KASET — po stronie −z; w kadrze 16:9 lico wewnętrzne ściany (nadproże od strony tunelu wychodzi
  // o kilka pikseli poza kadr — PROJEKT-chwyt-zwijanie § 6.3)
  for (const z of [DZIEL.exit.z0, DZIEL.exit.z1]) assert.ok(inside(proj(DZIEL.wall.x0, DZIEL.exit.y1, z)), 'brama WYJAZD KASET w kadrze');
  assert.ok(inside(proj(HALA.deck.x1, HALA.deckY, 0)), 'krawędź pokładu w kadrze');
  const T = KOMORA.gaz.tanks;
  for (const z of T.z) assert.ok(inside(proj(T.x1, T.y, z - T.r)) && inside(proj(T.x0, T.y, z - T.r)), 'zbiorniki w kadrze');
  const F = slagDockFrame();
  assert.ok(inside(proj(F.x, HALA.deckY, F.z)), 'dok żużla w kadrze');
});

test('formowanie/kropla: zawór wylewki — klapy w płaszczyźnie wargi zakrywają otwór, otwarte odchylają się z biegiem strugi; metal wychodzi z wylewki tylko przy otwartym zaworze', () => {
  const K = SPUST.klapy;
  const Z = ZAWOR;
  assert.ok(K.apo >= K.rAp);
  const rv = K.apo / Math.cos(Math.PI / K.n);
  const axisDist = (q) => {
    const d = [q[0] - Z.c[0], q[1] - Z.c[1], q[2] - Z.c[2]];
    const w = d[0] * Z.d[0] + d[1] * Z.d[1] + d[2] * Z.d[2];
    return { w, r: Math.hypot(d[0] - w * Z.d[0], d[1] - w * Z.d[1], d[2] - w * Z.d[2]) };
  };
  for (let k = 0; k < K.n; k++) {
    const a = (k / K.n) * TAU;
    const pts = [[0, 0], [Math.cos(a - Math.PI / K.n) * rv, Math.sin(a - Math.PI / K.n) * rv], [Math.cos(a + Math.PI / K.n) * rv, Math.sin(a + Math.PI / K.n) * rv]];
    for (let u = 0; u <= 1; u += 0.1) for (let v = 0; v <= 1 - u; v += 0.1) {
      const uv = [0, 1].map((j) => pts[0][j] * (1 - u - v) + pts[1][j] * u + pts[2][j] * v);
      const p = valvePoint(uv[0], uv[1], 0);
      // zamknięte: klapy leżą w płaszczyźnie wargi (zakrywają otwór — sześciokąt o apotemie ≥ promień otworu)
      assert.ok(Math.abs(axisDist(p).w) < 1e-9);
      const q = flapRotate(p, k, K.open);
      const ad = axisDist(q);
      assert.ok(ad.r >= K.rAp - 0.5 || ad.w > 1, `klapa ${k} w otworze po otwarciu`);
      assert.ok(ad.w >= -1e-6, `klapa ${k} otwiera się z biegiem strugi`);
    }
    const H = flapHinge(k);
    assert.ok(axisDist(H.h).r > K.rAp, `zawias ${k} poza otworem`);
  }
  // nad strugą (kierunek „w górę” w płaszczyźnie wargi) jest szczelina między klapami, nie klapa
  const up = [-Z.d[1], Z.d[0], 0];
  for (let k = 0; k < K.n; k++) {
    const H = flapHinge(k);
    const r = [H.h[0] - Z.c[0], H.h[1] - Z.c[1], H.h[2] - Z.c[2]];
    const c = (r[0] * up[0] + r[1] * up[1] + r[2] * up[2]) / Math.hypot(...r);
    assert.ok(c < Math.cos(25 * Math.PI / 180), `klapa ${k} dokładnie nad strugą`);
  }
  // z prawdziwą komorą: pełny spływ — zawór wylewki otwiera się, zanim metal przepłynie rurę, i zamyka po opróżnieniu rury;
  // masa za wargą wylewki rośnie tylko przy otwartym zaworze
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const line = createFormingLine({ seed: 11 });
  const inp = new Float64Array(LIN_WEJ_N);
  const last = { v: sim.counters[LICZNIK.delivered] };
  const valve = createNozzleValve();
  const C = line.counters;
  let crossedClosed = 0;
  let openedAt = null;
  let firstMetalAtLip = null;
  let closedAfter = null;
  for (let i = 0; i < 110 * 60; i++) {
    sim.step(DT);
    valve.step(DT, sim.view.stan[STAN.impactT], sim.counters[LICZNIK.funnel]);
    feedFromChamber(sim, inp, last);
    inp[LIN_WEJ.valve] = valve.state.open;
    const open0 = line.stan[LIN_STAN.spout];
    const past0 = C[LIN_LICZNIK.jet] + C[LIN_LICZNIK.reservoir] + C[LIN_LICZNIK.strip] + C[LIN_LICZNIK.exited];
    line.step(DT, inp);
    const past1 = C[LIN_LICZNIK.jet] + C[LIN_LICZNIK.reservoir] + C[LIN_LICZNIK.strip] + C[LIN_LICZNIK.exited];
    if (past1 > past0 && open0 < 0.999) crossedClosed++;
    if (openedAt === null && line.stan[LIN_STAN.spout] >= 1) openedAt = i;
    if (firstMetalAtLip === null && C[LIN_LICZNIK.jet] > 0) firstMetalAtLip = i;
    if (firstMetalAtLip !== null && closedAfter === null && line.stan[LIN_STAN.spout] <= 0) {
      closedAfter = i;
      assert.equal(C[LIN_LICZNIK.pipe], 0, 'zawór zamknięty dopiero przy pustej rurze');
    }
    if (closedAfter !== null) break;
  }
  assert.ok(openedAt !== null && firstMetalAtLip !== null && openedAt <= firstMetalAtLip, `zawór otwarty (${openedAt}) przed pierwszym metalem na wardze (${firstMetalAtLip})`);
  assert.ok(closedAfter !== null, 'zawór zamyka się po spływie');
  assert.equal(crossedClosed, 0, 'metal wychodzi z wylewki tylko przy otwartym zaworze');
});

test('formowanie/złożenie: dok żużla — bilans przyjęte = w skrzyni + oddane, poziom w pojemności, granulat z odbieralnika komory', () => {
  const dock = createSlagDock();
  let delivered = 0;
  for (let i = 0; i < 300 * 60; i++) {
    if (i % (92 * 60) === 60) delivered += 60;                         // zsyp koryta ~ obieg
    dock.step(DT, delivered);
    assert.ok(Math.abs(dock.audit()) < 1e-9, 'bilans doku');
    assert.ok(dock.state.level >= 0 && dock.state.level <= DOK_ZUZLA.cap + 1e-9);
  }
  assert.ok(dock.state.outT > 100, 'dok oddaje granulat do sieci ringu');
  // z prawdziwą komorą: zsyp koryta trafia do doku
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const C = sim.counters;
  const d2 = createSlagDock();
  let maxLevel = 0;
  for (let i = 0; i < 130 * 60; i++) {
    sim.step(DT);
    d2.step(DT, C[LICZNIK.slagOut] * sim.split[1] / UNITS_PER_TON);
    maxLevel = Math.max(maxLevel, d2.state.level);
  }
  assert.ok(d2.state.inT > 10, `dok przyjął ${d2.state.inT.toFixed(1)} t żużla`);
  assert.ok(maxLevel < DOK_ZUZLA.cap, `szczyt ${maxLevel.toFixed(1)} t w pojemności ${DOK_ZUZLA.cap} t`);
  assert.ok(Math.abs(d2.audit()) < 1e-9);
});

test('formowanie/złożenie: materiał otoczenia buduje się w Node (WGSL bez NaN, ten sam graf = ten sam kod), 1 siatka; obraz komory bez zmian', async () => {
  const THREE = await import('three/webgpu');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const build = (mesh) => {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.context.material = mesh.material;
    b.build();
    return { vertex: b.vertexShader, fragment: b.fragmentShader };
  };
  const sim = createMeltChamber({ seed: 7 });
  const root = new THREE.Group();
  const o = new WytopObraz({ root, sim });
  const z = new ZlozenieObraz({ root, U: o.U });
  assert.equal(z.meshes.length, 1);
  const w = build(z.mesh);
  assert.ok(w.vertex.length > 500 && w.fragment.length > 2000);
  assert.ok(!/NaN|undefined/.test(w.vertex + w.fragment));
  assert.ok((w.vertex + w.fragment).includes('FormowanieSwiatloLinii'), 'blok świateł linii ze stałą nazwą');
  assert.ok(!/dpdx|dpdy|fwidth/.test(w.fragment), 'bez pochodnych ekranu');
  const z2 = new ZlozenieObraz({ root: new THREE.Group(), U: o.U });
  assert.equal(build(z2.mesh).fragment, w.fragment, 'ten sam graf = ten sam kod');
  z.frame(1.2, 0.5, 0.3);
  assert.ok(z.OU.valve.value.x === 1.2 && z.OU.dock.value.x > 0);
  // rodzaje otoczenia nie kolidują z rodzajami wnętrza komory, którym materiał otoczenia nadaje inne znaczenie
  for (const k of [OTO.naczynie, OTO.poklad, OTO.emiter, OTO.klapa, OTO.granulat, OTO.dysza, OTO.dol, OTO.pasy, OTO.krata]) assert.ok(k >= 20);
});

// ===================================================================================================================
// Etap „Pasmo w polu”
// ===================================================================================================================

/** Wejście linii z kroku komory (jak strona dema). */
function feedFromChamber(sim, inp, last) {
  const S = sim.view.stan;
  const C = sim.counters;
  inp[LIN_WEJ.units] = C[LICZNIK.delivered] - last.v;
  last.v = C[LICZNIK.delivered];
  inp[LIN_WEJ.tempT] = S[STAN.temp];
  inp[LIN_WEJ.head] = S[STAN.level] - KOMORA.funnel.throatY;
  inp[LIN_WEJ.metal] = 0;
  inp[LIN_WEJ.impactT] = S[STAN.impactT];
  inp[LIN_WEJ.funnelUnits] = C[LICZNIK.funnel];
  inp[LIN_WEJ.twist] = S[STAN.twist];
}
/** Syntetyczny spływ gardzieli: rampa 0,9 s → 36 t/s → ogon 8 t/s (jak komora), razem `tons`. */
function syntheticDump(tons = 240) {
  const per = 36 * UNITS_PER_TON / 60;
  let left = Math.round(tons * UNITS_PER_TON);
  let t = 0;
  return () => {
    if (left <= 0) return 0;
    t += DT;
    let u = Math.round(t < 0.9 ? per * t / 0.9 : left < 8 * UNITS_PER_TON ? 8 * UNITS_PER_TON / 60 : per);
    u = Math.max(1, Math.min(u, left));
    left -= u;
    return u;
  };
}
const xOf = (s) => s - PATH.xOff;
/** Plastry od wylotu w dół pasma: [[x środka, T, f_s, udział miedzi], …]. */
function profile(line) {
  const out = [];
  for (let i = line.view.ring[1] - 1; i >= 0; i--) {
    const o = line.sliceOffset(i);
    out.push([xOf(0.5 * (line.view.slices[o + PL.s] + line.sliceTop(i))), line.view.slices[o + PL.T], line.view.slices[o + PL.fs], line.view.slices[o + PL.x]]);
  }
  return out;
}

test('formowanie/pasmo: bilans linii = 0 po każdym kroku w 2 obiegach z prawdziwą komorą; dopływ linii = metal oddany gardzielą', () => {
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const line = createFormingLine({ seed: 11 });
  const inp = new Float64Array(LIN_WEJ_N);
  const last = { v: sim.counters[LICZNIK.delivered] };
  const d0 = sim.counters[LICZNIK.delivered];
  let dumps = 0;
  let prevOn = 0;
  let Vmin = Infinity;
  for (let i = 0; i < 200 * 60; i++) {
    sim.step(DT);
    feedFromChamber(sim, inp, last);
    line.step(DT, inp);
    const a = line.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`bilans linii ${a.balance}, niezgodność ${a.mismatch} w kroku ${i}`);
    if (line.stan[LIN_STAN.jetOn] && !prevOn) dumps++;
    prevOn = line.stan[LIN_STAN.jetOn];
    if (i > 30 * 60) Vmin = Math.min(Vmin, line.stan[LIN_STAN.resV] / UNITS_PER_TON);
  }
  assert.equal(line.counters[LIN_LICZNIK.inflow], sim.counters[LICZNIK.delivered] - d0, 'dopływ linii = przyrost `delivered` komory co do jednostki');
  assert.ok(dumps >= 2, `spływów ${dumps}`);
  assert.equal(line.stan[LIN_STAN.mode], TRYB.PRACA, 'linia pracuje ciągle przez obiegi (zasobnik nie opróżnia się)');
  assert.ok(Vmin > 5, `zasobnik w obiegu ≥ ${Vmin.toFixed(1)} t`);
  assert.ok(line.counters[LIN_LICZNIK.exited] > 300 * UNITS_PER_TON, 'taśma wychodzi do walcowni');
});

test('formowanie/pasmo: temperatura nierosnąca wzdłuż pasma w stanie ustalonym; stal przy F1 1330–1600 K; front ≥ 200 j. przed F1', () => {
  for (const metal of [0, 1]) {
    const line = createFormingLine({ seed: 5, metal });
    line.setQ(1);
    for (let i = 0; i < 40 * 60; i++) line.step(DT);
    const P = profile(line);
    for (let k = 1; k < P.length; k++) {
      assert.ok(P[k][1] <= P[k - 1][1] + 2, `metal ${metal}: T rośnie na x ${P[k][0].toFixed(0)} (${P[k - 1][1].toFixed(1)} → ${P[k][1].toFixed(1)})`);
    }
    const at = (x) => P.find((q) => q[0] >= x);
    if (metal === 0) {
      const T1 = at(LINIA.stands[0].x)[1];
      assert.ok(T1 >= 1330 && T1 <= 1600, `stal przy F1 ${T1.toFixed(0)} K`);
    }
    const front = xOf(line.stan[LIN_STAN.frontSolid]);
    assert.ok(front < LINIA.stands[0].x - 200, `metal ${metal}: front ${front.toFixed(0)}`);
    assert.ok(front > LINIA.gates[4].x, `metal ${metal}: front ${front.toFixed(0)} za bramami`);
  }
});

test('formowanie/pasmo: front krzepnięcia przesuwa się z przepływem (0,8 → 1 → 1,25 Q), zawsze przed F1 − 200', () => {
  for (const metal of [0, 1]) {
    const fronts = [0.8, 1, 1.25].map((k) => {
      const line = createFormingLine({ seed: 5, metal });
      line.setQ(k);
      let acc = 0;
      for (let i = 0; i < 45 * 60; i++) { line.step(DT); if (i >= 35 * 60) acc += xOf(line.stan[LIN_STAN.frontSolid]); }
      return acc / (10 * 60);
    });
    assert.ok(fronts[0] < fronts[1] && fronts[1] < fronts[2], `metal ${metal}: front ${fronts.map((f) => f.toFixed(0))}`);
    assert.ok(fronts[2] - fronts[0] >= 150, `metal ${metal}: przesunięcie frontu ${(fronts[2] - fronts[0]).toFixed(0)} j.`);
    assert.ok(fronts[2] < LINIA.stands[0].x - 200, `metal ${metal}: front przy 1,25 Q ${fronts[2].toFixed(0)}`);
  }
});

test('formowanie/pasmo: start linii z zimnej (czoło po spływie, przez bramy po kolei) i koniec wsadu (odcięcie, ogon, nowe czoło)', () => {
  // START z prawdziwą komorą: przed spływem nic, czoło przy zasobniku ≥ 30 t, czoło jedzie bez skoków przez G0…G4, za
  // front krzepnięcia, F1…F3 i bramę „DO ZWIJARKI”
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const line = createFormingLine({ seed: 11, cold: true });
  const inp = new Float64Array(LIN_WEJ_N);
  const last = { v: sim.counters[LICZNIK.delivered] };
  const marks = [...LINIA.gates.map((g) => [g.id, g.x]), ...LINIA.stands.map((s) => [s.id, s.x]), ['brama', XB]];
  const passed = {};
  let prevHead = -1;
  let started = null;
  let firstSolid = null;
  let delivered = 0;
  for (let i = 0; i < 140 * 60; i++) {
    sim.step(DT);
    feedFromChamber(sim, inp, last);
    delivered += inp[LIN_WEJ.units];
    line.step(DT, inp);
    const S = line.stan;
    if (started === null) {
      if (line.view.ring[1] > 0) {
        started = i * DT;
        assert.ok(S[LIN_STAN.resV] / UNITS_PER_TON >= PASMO.startT - 1, 'czoło dopiero przy zasobniku ≥ 30 t');
        assert.ok(delivered > PASMO.startT * UNITS_PER_TON, 'czoło po spływie');
      } else {
        assert.equal(line.counters[LIN_LICZNIK.strip], 0, 'przed czołem pasma nie ma');
        continue;
      }
    }
    const head = xOf(S[LIN_STAN.front]);
    if (prevHead >= 0) {
      assert.ok(head >= prevHead - 1e-6, `czoło cofa się: ${prevHead.toFixed(1)} → ${head.toFixed(1)}`);
      assert.ok(head - prevHead <= 300 * DT, `skok czoła ${(head - prevHead).toFixed(1)} j.`);
    }
    prevHead = head;
    for (const [id, x] of marks) if (passed[id] === undefined && head >= x) passed[id] = i * DT;
    if (firstSolid === null && S[LIN_STAN.frontSolid] > 0) firstSolid = i * DT;
    if (passed.brama !== undefined) break;
  }
  assert.ok(started !== null && started > 60, `czoło po pierwszym spływie (${started})`);
  const order = marks.map(([id]) => passed[id]);
  for (let k = 0; k < order.length; k++) assert.ok(order[k] !== undefined, `czoło nie minęło ${marks[k][0]}`);
  for (let k = 1; k < order.length; k++) assert.ok(order[k] >= order[k - 1], `kolejność ${marks[k - 1][0]} → ${marks[k][0]}`);
  assert.ok(firstSolid !== null && firstSolid < passed.F1, 'czoło zastyga przed F1');

  // KONIEC WSADU (bez komory): drain → zasobnik do 3 t → odcięcie → ogon przez bramę → pusto → nowy spływ → nowe czoło
  const L2 = createFormingLine({ seed: 4 });
  const in2 = new Float64Array(LIN_WEJ_N);
  L2.drain();
  assert.equal(L2.stan[LIN_STAN.mode], TRYB.DOBIEG);
  let cutAt = null;
  let tailOut = null;
  let tailPrev = -1;
  for (let i = 0; i < 160 * 60; i++) {
    L2.step(DT, in2);
    const S = L2.stan;
    if (cutAt === null && !S[LIN_STAN.attached]) {
      cutAt = i;
      const V = S[LIN_STAN.resV] / UNITS_PER_TON;
      assert.ok(V <= PASMO.cutT + 0.05 && V > 0, `odcięcie przy ${V.toFixed(2)} t`);
      assert.equal(S[LIN_STAN.mode], TRYB.OGON);
    }
    if (cutAt !== null && L2.view.ring[1] > 0) {
      const tail = S[LIN_STAN.tail];
      if (tailPrev > 0) assert.ok(tail >= tailPrev - 1e-6 && tail - tailPrev <= 300 * DT, 'ogon jedzie bez skoków');
      tailPrev = tail;
    }
    if (cutAt !== null && tailOut === null && L2.view.ring[1] === 0) { tailOut = i; break; }
    if (L2.audit().balance !== 0) assert.fail('bilans w dobiegu');
  }
  assert.ok(cutAt !== null && tailOut !== null, 'pasmo odcięte i wyjechało');
  assert.equal(L2.stan[LIN_STAN.mode], TRYB.PUSTA);
  assert.equal(L2.counters[LIN_LICZNIK.strip], 0);
  assert.ok(L2.stan[LIN_STAN.resV] > 0, 'resztka w kołysce');
  const dump = syntheticDump(240);
  const starts0 = L2.stan[LIN_STAN.starts];
  for (let i = 0; i < 15 * 60; i++) { in2[LIN_WEJ.units] = dump(); in2[LIN_WEJ.head] = 200; in2[LIN_WEJ.tempT] = 0.95; L2.step(DT, in2); }
  assert.equal(L2.stan[LIN_STAN.starts], starts0 + 1, 'kolejny spływ daje nowe czoło');
  assert.ok(L2.view.ring[1] > 0 && L2.stan[LIN_STAN.mode] === TRYB.ROZRUCH);
  assert.equal(L2.audit().balance, 0);
});

test('formowanie/pasmo: zmiana metalu — udział miedzi monotoniczny wzdłuż przejściówki, mieszanie w zasobniku', () => {
  const line = createFormingLine({ seed: 6, metal: 0 });
  line.setQ(1);
  const inp = new Float64Array(LIN_WEJ_N);
  const dump = syntheticDump(240);
  inp[LIN_WEJ.metal] = 1;
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.tempT] = 0.95;
  for (let i = 0; i < 12 * 60; i++) { inp[LIN_WEJ.units] = dump(); line.step(DT, inp); }
  const x = line.stan[LIN_STAN.resX];
  assert.ok(x > 0.3 && x < 1, `zasobnik zmieszany: udział miedzi ${x.toFixed(3)}`);
  const P = profile(line);
  for (let k = 1; k < P.length; k++) assert.ok(P[k][3] <= P[k - 1][3] + 1e-9, `udział miedzi rośnie w dół pasma na x ${P[k][0].toFixed(0)}`);
  assert.ok(P[0][3] > 0.3 && P[P.length - 1][3] === 0, 'przejściówka: od wylotu miedź, przy bramie jeszcze stal');
});

test('formowanie/pasmo: fala — impuls na wylocie biegnie z v + c (± 15 %), gaśnie ≥ 50 % w 2,5 s, za frontem < 10 % impulsu', () => {
  // λ(x) w oknach 30 j. (objętość na długość) — porównanie dwóch przebiegów z tego samego ziarna: z impulsem i bez
  const lam = (l, x0, x1, dx) => {
    const out = [];
    for (let x = x0; x < x1; x += dx) {
      const a = x + PATH.xOff;
      const b = a + dx;
      let m = 0;
      for (let i = 0; i < l.view.ring[1]; i++) {
        const o = l.sliceOffset(i);
        const s1 = l.view.slices[o + PL.s];
        const s0 = l.sliceTop(i);
        const ov = Math.max(0, Math.min(b, s1) - Math.max(a, s0));
        if (ov > 0) m += l.view.slices[o + PL.m] * ov / Math.max(s1 - s0, 1e-6);
      }
      out.push([x + dx / 2, m]);
    }
    return out;
  };
  for (const metal of [0, 1]) {
    const mk = () => { const l = createFormingLine({ seed: 3, metal, noise: 0 }); l.setQ(1); for (let i = 0; i < 30 * 60; i++) l.step(DT); return l; };
    const base = mk();
    const test = mk();
    const KICK = 0.3;
    test.kick(KICK, 0.15);
    let t = 0;
    const rec = [];
    let behind = 0;
    for (const T of [0.4, 0.9, 2.9, 5]) {
      while (t < T - 1e-9) { test.step(DT); base.step(DT); t += DT; }
      const a = lam(test, 1030 + LINIA_DX, 3060 + LINIA_DX, 30);
      const b = lam(base, 1030 + LINIA_DX, 3060 + LINIA_DX, 30);
      const dev = a.map(([x, m], i) => [x, b[i][1] > 0 ? m / b[i][1] - 1 : 0]);
      const pk = dev.reduce((p, q) => (Math.abs(q[1]) > Math.abs(p[1]) ? q : p), [0, 0]);
      const front = xOf(test.stan[LIN_STAN.frontSolid]);
      for (const [x, d] of dev) if (x > front + 30) behind = Math.max(behind, Math.abs(d));
      rec.push({ T, x: pk[0], a: pk[1] });
    }
    // prędkość grzbietu między 0,4 a 0,9 s a v + c(x) (c² = g_f · prasowanie · A / w)
    const v = test.stan[LIN_STAN.vLine];
    let tt = 0;
    for (let x = rec[0].x; x < rec[1].x; x += 1) {
      const c = Math.sqrt(PASMO.c * PASMO.c / LINIA.t0 * (1 + (PASMO.ironG - 1) * ironAt(x)) * PASMO.A0 / gateWidth(x));
      tt += 1 / (v + c);
    }
    const expect = (rec[1].x - rec[0].x) / tt;
    const got = (rec[1].x - rec[0].x) / 0.5;
    assert.ok(Math.abs(got / expect - 1) <= 0.15, `metal ${metal}: grzbiet ${got.toFixed(0)} j./s, v + c ${expect.toFixed(0)} j./s`);
    assert.ok(rec[0].a > 0.04, `metal ${metal}: fala widoczna (${rec[0].a.toFixed(3)})`);
    assert.ok(Math.abs(rec[2].a) <= 0.5 * rec[0].a, `metal ${metal}: zanik w 2,5 s ${rec[0].a.toFixed(3)} → ${rec[2].a.toFixed(3)}`);
    assert.ok(behind < 0.1 * KICK, `metal ${metal}: za frontem ${behind.toFixed(3)} (impuls ${KICK})`);
  }
  // strażnik długości plastrów: nigdzie krótszy niż 0,2 nominalnego (proporcjonalnie do masy plastra)
  const l = createFormingLine({ seed: 2 });
  const lNom = PASMO.sliceUnits * VOL_TON / UNITS_PER_TON / PASMO.A0;
  for (let i = 0; i < 20 * 60; i++) {
    l.step(DT);
    for (let k = 0; k < l.view.ring[1]; k++) {
      const o = l.sliceOffset(k);
      if (l.view.slices[o + PL.tail] === 2) continue;
      const len = l.view.slices[o + PL.s] - l.sliceTop(k);
      assert.ok(len >= 0.2 * lNom * Math.max(0.1, l.view.slices[o + PL.m] / PASMO.sliceUnits) - 1e-6, `plaster ${len.toFixed(2)} j.`);
    }
  }
});

test('formowanie/pasmo: powtarzalność (ten sam hasz z tego samego ziarna), krok linii i stacje bez alokacji', async () => {
  const run = (seed) => {
    const sim = createMeltChamber({ seed: 7, prewarm: true });
    const line = createFormingLine({ seed });
    const inp = new Float64Array(LIN_WEJ_N);
    const last = { v: sim.counters[LICZNIK.delivered] };
    for (let i = 0; i < 80 * 60; i++) { sim.step(DT); feedFromChamber(sim, inp, last); line.step(DT, inp); }
    return line.hash();
  };
  const h1 = run(11);
  assert.equal(run(11), h1, 'ten sam przebieg z tego samego ziarna');
  assert.notEqual(run(12), h1, 'inne ziarno — inny szum wypływu');
  // bez alokacji: krok linii ze spływem (struga, zasobnik, pasmo) i wypełnianie stacji — na świeżym egzemplarzu modułu
  // (jedna linia jak na stronie dema; wcześniejsze testy innych trybów — zimny start, dobieg, impuls — zmieniają
  // decyzje kompilatora dla funkcji kroku wspólnych dla wszystkich linii; znane: po zimnym starcie w tym samym procesie
  // krok alokuje ~0,4 KB, zapisane w raporcie)
  const fresh = await import('../dema/ring-dzielnice/huta/formowanie/linia.js?alokacje');
  const line = fresh.createFormingLine({ seed: 9 });
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.tempT] = 0.95;
  const filler = createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  const step = (i) => { inp[LIN_WEJ.units] = (i % 240) < 120 ? 600 : 0; line.step(DT, inp); };
  const warm = () => { for (let i = 0; i < 600; i++) { step(i); filler.fill(line, null, 0.5, DT, out); } };
  warm();
  const per60 = await untilSteady(() => allocatedBytes(step, 60), (b) => b < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(per60 < 8192, `krok linii alokuje ${per60} B na 60 kroków`);
  const perFill = await untilSteady(() => allocatedBytes(() => filler.fill(line, null, 0.5, DT, out), 60), (b) => b < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(perFill < 8192, `stacje alokują ${perFill} B na 60 klatek`);
});

test('formowanie/pasmo: stacje metalu bez NaN, błona pełna nad pokładem (≥ 50 j.) i między słupami pola, osprzęt pola poza pasmem', () => {
  const line = createFormingLine({ seed: 5, prefillTons: 250, prefillRun: 1 });
  const filler = createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  filler.fill(line, null, 1, DT, out);
  for (const v of out) assert.ok(Number.isFinite(v), 'NaN w stacjach');
  assert.ok(lowestMetalY(out) >= 50, `metal ${lowestMetalY(out).toFixed(1)} j. nad pokładem`);
  // błona pełna (i jej powłoka pola) mieści się między płetwami bramek zacisku (lico emitera na |z| = zR − 3) z zapasem na
  // drgania
  let maxZ = 0;
  let maxS = 0;
  for (let q = STACJE.bag.i0; q < STACJE.bag.i0 + STACJE.bag.n; q++) { maxZ = Math.max(maxZ, out[q * STACJE.stride + 4]); maxS = Math.max(maxS, out[q * STACJE.stride + 20]); }
  assert.ok(maxZ > 200 && maxZ * 1.12 < ZACISK.zR - ZACISK.finW / 2 - 10, `półszerokość błony ${maxZ.toFixed(0)}`);
  assert.ok(maxS < ZACISK.zR - ZACISK.finW / 2 - 4, `powłoka pola ${maxS.toFixed(0)} między płetwami`);
  // emitery G1–G4 ≥ 40 j. od brzegu pasma; panele C1 po dosunięciu (miedź) nie wchodzą nad pasmo
  for (const g of LINIA.gates.slice(1)) assert.ok(Math.max(g.a + 48, 118) - g.a >= 40);
  const B = outside();
  let n = 0;
  let poles = 0;
  for (let i = 0; i < B.n; i++) {
    if (B.aux[i * 2] === OTO_POLE.pole) poles++;
    if (B.aux[i * 2] !== OTO_POLE.chlodnica) continue;
    n++;
    const y = B.pos[i * 3 + 1];
    const z = B.pos[i * 3 + 2] + B.mov[i * 3 + 1] * CHILL_SHIFT;
    if (y > HALA.passY) assert.ok(Math.abs(z) >= 110, `panel chłodnicy nad pasmem po dosunięciu: z ${z.toFixed(0)}`);
  }
  assert.ok(n > 1000, 'panele chłodnic w siatce');
  assert.ok(poles > 1000, 'emitery pola w siatce');
});

test('formowanie/pasmo: WGSL metalu linii buduje się w Node (bez NaN, bez odwróconych smoothstep), dwa obrazy — ten sam program', async () => {
  const THREE = await import('three/webgpu');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { LiniaObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazLinii.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const build = (mesh) => {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera();
    b.context.material = mesh.material;
    b.build();
    return { vertex: b.vertexShader, fragment: b.fragmentShader };
  };
  const sim = createMeltChamber({ seed: 7 });
  const root = new THREE.Group();
  const o = new WytopObraz({ root, sim });
  const z = new ZlozenieObraz({ root, U: o.U });
  const l = new LiniaObraz({ root, U: o.U, zl: z });
  // (runda 9) trzecia siatka: warstwa plazmy stacji odzgorzania (własna geometria)
  assert.equal(l.meshes.length, 3, 'metal linii i powłoka pola — dwie siatki na wspólnej geometrii stacji (+ plazma odzgorzania)');
  assert.equal(l.meshes[2].name, 'Odzgorzanie_plazma');
  assert.equal(l.shell.geometry, l.mesh.geometry, 'powłoka pola na tej samej siatce stacji');
  const ws = build(l.shell);
  assert.ok(!/NaN|undefined/.test(ws.vertex + ws.fragment) && ws.fragment.length > 500, 'WGSL powłoki pola');
  assert.ok(l.shellMaterial.depthWrite === false && l.shellMaterial.transparent && l.shellMaterial.forceSinglePass, 'powłoka nie zasłania metalu');
  const w = build(l.mesh);
  const code = w.vertex + w.fragment;
  assert.ok(w.vertex.length > 1000 && w.fragment.length > 5000);
  assert.ok(!/NaN|undefined/.test(code));
  assert.ok(code.includes('FormowaniePasmoStacje') && code.includes('FormowaniePole'), 'bufory ze stałą nazwą');
  // (poprawki rundy 7) pochodne ekranu tylko w normalnej lica cieczy pasma (`LICO_CIECZY`): bez `fwidth`, każde wywołanie
  // na poziomie funkcji `main` — poza blokami `if` / pętli (pułapki 15, 29: pochodna w rozbieżnej gałęzi jest nieokreślona)
  assert.ok(!/fwidth/.test(w.fragment), 'bez fwidth');
  {
    const fs = w.fragment;
    const m0 = fs.search(/fn main\s*\(/);
    assert.ok(m0 >= 0, 'main fragmentu');
    const calls = [...fs.matchAll(/\b(dpdx|dpdy)\s*\(/g)];
    assert.equal(calls.length, 4, `pochodne: dpdx / dpdy pozycji i wysokości lica (${calls.length})`);
    for (const c of calls) {
      assert.ok(c.index > m0, 'pochodna w main');
      const seg = fs.slice(fs.indexOf('{', m0), c.index);
      const depth = (seg.match(/\{/g) || []).length - (seg.match(/\}/g) || []).length;
      assert.equal(depth, 1, `pochodna ${c[1]} na poziomie main (głębokość bloków ${depth})`);
    }
  }
  for (const m of code.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) assert.ok(Number(m[1]) < Number(m[2]), `odwrócony smoothstep ${m[0]}`);
  assert.ok(!/pow\(\s*-/.test(code), 'pow z ujemną stałą podstawą');
  const l2 = new LiniaObraz({ root: new THREE.Group(), U: o.U, zl: new ZlozenieObraz({ root: new THREE.Group(), U: o.U }) });
  assert.equal(build(l2.mesh).fragment, w.fragment, 'ten sam graf = ten sam kod');
  const wz = build(z.mesh);
  assert.ok(!/NaN|undefined/.test(wz.vertex + wz.fragment));
  // klatka obrazu: stacje i światło linii z prawdziwej linii
  const line = createFormingLine({ seed: 5 });
  l.frame(line, null, 0.5, DT, DT);
  assert.ok(l.live > 200, `stacji z metalem ${l.live}`);
  assert.ok(z.LU.data[16 + 2].w > 0.3, 'światło pasma przy wylocie');
});

// ===================================================================================================================
// Etap „Kropla”: wylot bokiem, błona pola
// ===================================================================================================================

/** Linia ze zrzutem syntetycznym (rampa → 36 t/s → ogon, jak komora): `cb(line, i)` po każdym kroku. */
function runDump(line, seconds, cb, tons = 240) {
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.tempT] = 0.95;
  inp[LIN_WEJ.valve] = 1;
  const dump = syntheticDump(tons);
  let fed = 0;
  for (let i = 0; i < seconds * 60; i++) {
    inp[LIN_WEJ.units] = dump();
    fed += inp[LIN_WEJ.units];
    line.step(DT, inp);
    if (cb) cb(line, i, fed);
  }
  return fed;
}

test('formowanie/kropla: wylewka, cały rękaw błony (z powłoką pola) i bramki zacisku leżą w rzucie z góry poza obrysem naczynia (z zapasem ≥ 50 j.)', () => {
  const R = Math.max(NACZYNIE.flange.rOut, NACZYNIE.ring.r1) + 50;
  const out = (x, z, what) => assert.ok(Math.hypot(x, z) >= R, `${what} w obrysie naczynia: (${x.toFixed(0)}, ${z.toFixed(0)})`);
  // wylewka: czoło z pierścieniem pola (r = lipR + obudowa), zawór (klapy zamknięte i otwarte), dysza wylewki 30 j. wstecz
  const Z = ZAWOR;
  const up = [-Z.d[1], Z.d[0], 0];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * TAU;
    for (const back of [0, 30]) {
      const r = SPUST.lipR + 9;
      const x = SPUST.lip[0] - Z.d[0] * back + up[0] * Math.cos(a) * r;
      const z = Math.sin(a) * r;
      out(x, z, 'wylewka');
    }
  }
  const K = SPUST.klapy;
  const rv = K.apo / Math.cos(Math.PI / K.n);
  for (let k = 0; k < K.n; k++) {
    for (const ang of [0, K.open]) {
      const a = (k / K.n) * TAU;
      for (const p of [[0, 0], [Math.cos(a - Math.PI / K.n) * rv, Math.sin(a - Math.PI / K.n) * rv], [Math.cos(a + Math.PI / K.n) * rv, Math.sin(a + Math.PI / K.n) * rv]]) {
        const q = flapRotate(valvePoint(p[0], p[1], 0), k, ang);
        out(q[0], q[2], 'klapa zaworu');
      }
    }
  }
  // struga od wargi do wlotu
  const q = new Float64Array(6);
  for (let s = DROGA.sLip; s <= DROGA.sEnd; s += 4) { spustPoint(s, q); out(q[0] - 70, 0, 'struga'); }
  // rękaw: obrys powłoki pola (z zapadniętym rękawem) i metalu z góry dla masy 0,5…270 t, z zapasem na mody (×1,15)
  for (const t of [0.5, 5, 20, 60, 120, 180, 230, 270]) {
    for (const st of bagStations(bagAt(t))) {
      out(st.x, Math.max(st.sa, st.a * 1.15), `rękaw (${t} t)`);
    }
  }
  // bramki zacisku (płetwy po bokach, progi)
  for (let x = ZACISK.x0 - 16; x <= ZACISK.x1 + 16; x += 8) out(x, ZACISK.zR + 12, 'bramka zacisku');
  // tylny kołnierz rękawu nie wchodzi pod wylewkę; miejsce wpadania strugi na pusty rękaw w rękawie, przed szyją
  assert.ok(BLONA.x0 > SPUST.lip[0] + 25, 'tył rękawu za wylewką');
  assert.ok(LAND_X0 > BLONA.x0 + BLONA.landMargin + BLONA.wp && LAND_X0 < BLONA.xN, `miejsce wpadania ${LAND_X0.toFixed(0)}`);
});

test('formowanie/kropla: struga wpada w błonę z góry — w otwarty rękaw przed zaciskiem, wejście nad środkiem przekroju, struga opada', () => {
  const line = createFormingLine({ seed: 4, prefillTons: 20, prefillRun: 2 });
  let landed = 0;
  const WB = new Float64Array(8);
  runDump(line, 14, (l) => {
    const S = l.stan;
    if (!(S[LIN_STAN.inRate] > 2)) return;
    landed++;
    const x = S[LIN_STAN.hitX];
    assert.ok(x > S[LIN_STAN.pinX] + 0.5 * BLONA.wp && x < BLONA.xN, `wejście w otwarty rękaw przed zaciskiem (x ${x.toFixed(0)}, zacisk ${S[LIN_STAN.pinX].toFixed(0)})`);
    sectionAt(x, areaAt(l.view.tube, x), WB);
    const yMid = BLONA.yc + WB[3];
    assert.ok(S[LIN_STAN.hitY] > yMid + 0.25 * Math.max(WB[1], BLONA.collH), `wejście nad środkiem przekroju (${S[LIN_STAN.hitY].toFixed(0)} vs środek ${yMid.toFixed(0)}, b ${WB[1].toFixed(0)})`);
    const ty = DROGA.ty[S[LIN_STAN.hitS] | 0];
    assert.ok(ty < -0.5, `struga opada przy wejściu (styczna ${ty.toFixed(2)})`);
  });
  assert.ok(landed > 300, `struga wchodziła w błonę ${landed} kroków`);
});

test('formowanie/kropla: masa w rurze spustowej i w strudze w bilansie (0 po każdym kroku); wypływ z gardzieli = dopływ linii', () => {
  const line = createFormingLine({ seed: 8 });
  const C = line.counters;
  let pipeMax = 0;
  let jetMax = 0;
  const fed = runDump(line, 20, (l) => {
    const a = l.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`bilans ${a.balance}, niezgodność ${a.mismatch}`);
    pipeMax = Math.max(pipeMax, C[LIN_LICZNIK.pipe]);
    jetMax = Math.max(jetMax, C[LIN_LICZNIK.jet]);
  });
  assert.equal(C[LIN_LICZNIK.inflow], fed, 'dopływ linii = metal oddany gardzielą co do jednostki');
  // rura pełna w spływie: masa = przekrój × długość rury (36 t/s płynie pełną rurą) — rzędu dziesiątek ton
  const pipeT = pipeMax / UNITS_PER_TON;
  assert.ok(pipeT > 25 && pipeT < 80, `w rurze najwięcej ${pipeT.toFixed(1)} t`);
  assert.ok(jetMax / UNITS_PER_TON > 2, 'w strudze między wylewką a błoną leci metal');
  assert.equal(C[LIN_LICZNIK.pipe], 0, 'po spływie rura pusta');
  assert.equal(C[LIN_LICZNIK.jet], 0, 'po spływie struga pusta');
});

test('formowanie/kropla: wypływ przez gardziel z ciśnienia (napięcie błony + ścisk zacisku); regulator steruje zaciskiem, wypływ = zadany', () => {
  // prawo wypływu: Q = Q_nom · (p_napięcia + σ), rosnące w σ i w masie
  const l = createFormingLine({ seed: 3, prefillTons: 140, prefillRun: 1 });
  let prev = -1;
  for (let s = 0; s <= 1.0001; s += 0.1) { const o = l.outflowAt(s); assert.ok(o.Q > prev); prev = o.Q; assert.ok(Math.abs(o.Q - PASMO.qNom * (o.pT + s)) < 1e-9); }
  // regulator: przy malejącej masie (bez dopływu) wypływ idzie za przepływem zadanym; ścisk w granicach
  const r = createFormingLine({ seed: 3, prefillTons: 200, prefillRun: 2 });
  for (let i = 0; i < 3 * 60; i++) r.step(DT);
  assert.ok(r.stan[LIN_STAN.sq] > 0.15, `pełna błona ściśnięta: σ ${r.stan[LIN_STAN.sq].toFixed(2)}`);
  for (let i = 0; i < 150 * 60 && r.stan[LIN_STAN.resV] > 30 * UNITS_PER_TON; i++) {
    r.step(DT);
    const S = r.stan;
    if (S[LIN_STAN.sq] > 1e-6 && S[LIN_STAN.sq] < 0.999) assert.ok(Math.abs(S[LIN_STAN.Q] - S[LIN_STAN.Qcmd]) < 0.02 * PASMO.qNom, `wypływ ${S[LIN_STAN.Q].toFixed(3)} ≠ zadany ${S[LIN_STAN.Qcmd].toFixed(3)}`);
  }
  assert.ok(r.stan[LIN_STAN.resV] <= 30 * UNITS_PER_TON, 'błona opróżniona do 30 t');
});

test('formowanie/wyciskanie: wypływ taśmy rośnie z posuwem zacisku (mocniejszy ścisk → szybszy zacisk, większy wypływ, szybsza taśma)', () => {
  const runAt = (sq) => {
    const l = createFormingLine({ seed: 3, prefillTons: 140, prefillRun: 4 });
    l.setSqueeze(sq);
    for (let i = 0; i < 60; i++) l.step(DT);
    const x0 = l.stan[LIN_STAN.pinX];
    const V0 = l.stan[LIN_STAN.resV];
    let Q = 0;
    for (let i = 0; i < 4 * 60; i++) { l.step(DT); Q += l.stan[LIN_STAN.Q]; }
    return { Q: Q / (4 * 60), adv: (l.stan[LIN_STAN.pinX] - x0) / 4, v: l.stan[LIN_STAN.vLine], dV: V0 - l.stan[LIN_STAN.resV] };
  };
  const lo = runAt(0.15);
  const hi = runAt(0.75);
  assert.ok(hi.Q > lo.Q * 1.3, `wypływ przy ścisku 0,75 (${hi.Q.toFixed(2)}) > przy 0,15 (${lo.Q.toFixed(2)})`);
  // (słaby ścisk: bramka ustępuje brzuchowi — zacisk stoi albo cofa się; mocny: jedzie ku G0 i wyciska)
  assert.ok(hi.adv > 3 && hi.adv > lo.adv + 5, `posuw zacisku ${lo.adv.toFixed(1)} → ${hi.adv.toFixed(1)} j./s`);
  assert.ok(hi.v > lo.v, 'taśma szybsza przy mocniejszym ścisku');
  assert.ok(hi.dV > lo.dV, 'błona ubywa szybciej');
});

test('formowanie/wyciskanie: z prawdziwą komorą — między zrzutami zacisk jedzie monotonicznie ku gardzieli, gdy masy ubywa; za zaciskiem nie ma metalu', () => {
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const line = createFormingLine({ seed: 11 });
  const inp = new Float64Array(LIN_WEJ_N);
  const last = { v: sim.counters[LICZNIK.delivered] };
  const S = line.stan;
  const CV = line.view.tube;
  let calm = 0;
  let prevX = -1;
  let prevV = -1;
  let travel = 0;
  let span = 0;
  let checked = 0;
  for (let i = 0; i < 200 * 60; i++) {
    sim.step(DT);
    feedFromChamber(sim, inp, last);
    line.step(DT, inp);
    // za zaciskiem (komórki z x ≤ zacisk) nie ma metalu — w każdym kroku
    const xp = S[LIN_STAN.pinX];
    for (let k = 0; k < RK_N && RK_X[k] <= xp; k++) if (CV[k] !== 0) assert.fail(`metal za zaciskiem: komórka x ${RK_X[k].toFixed(0)}, zacisk ${xp.toFixed(1)}`);
    // okno „między zrzutami”: bez dopływu, rury i strugi od 3 s, zacisk nie otwiera się przed zrzutem
    const quiet = inp[LIN_WEJ.units] === 0 && line.counters[LIN_LICZNIK.pipe] === 0 && line.counters[LIN_LICZNIK.jet] === 0 && S[LIN_STAN.spoutWant] === 0;
    calm = quiet ? calm + DT : 0;
    if (calm > 3) {
      const V = S[LIN_STAN.resV];
      if (prevX >= 0) {
        assert.ok(V <= prevV, 'masy ubywa między zrzutami');
        assert.ok(xp >= prevX - 1e-9, `zacisk cofa się między zrzutami: ${prevX.toFixed(3)} → ${xp.toFixed(3)} (t ${(i * DT).toFixed(2)})`);
        travel += xp - prevX;
        checked++;
      }
      prevX = xp; prevV = V;
    } else { if (prevX >= 0) span = Math.max(span, travel); prevX = -1; travel = 0; }
  }
  span = Math.max(span, travel);
  assert.ok(checked > 60 * 60, `okno między zrzutami ${(checked / 60).toFixed(0)} s`);
  assert.ok(span > 300, `zacisk przejechał między zrzutami ${span.toFixed(0)} j. (od tyłu rękawu ku gardzieli)`);
});

test('formowanie/wyciskanie: zrzut — zacisk otwiera rękaw przed strugą, metal wchodzi w miejscu wpadania, wypełniona część rośnie od niego ku tyłowi', () => {
  // linia z prawie pustą błoną (zacisk przy szyi), potem zrzut syntetyczny z zaworem
  const line = createFormingLine({ seed: 6, prefillTons: 12, prefillRun: 1 });
  const S = line.stan;
  const CV = line.view.tube;
  assert.ok(S[LIN_STAN.pinX] > LAND_X0 - BLONA.landMargin + 20, `zacisk przed zrzutem przy szyi (${S[LIN_STAN.pinX].toFixed(0)})`);
  const before = Float64Array.from(CV);
  let first = null;
  let rear = Infinity;
  let rearLanded = null;
  let grewBack = 0;
  runDump(line, 12, (l, i) => {
    const a = l.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`bilans ${a.balance}`);
    // (porównanie z krokiem tuż przed zetknięciem — stary metal przy szyi rozpływa się wolno w otwarty rękaw)
    if (first === null && !(S[LIN_STAN.inRate] > 0.5)) { before.set(CV); return; }
    if (first === null && S[LIN_STAN.inRate] > 0.5) {
      // pierwsze zetknięcie: zacisk już za miejscem wpadania, metal przybył tylko w komórkach wokół punktu wejścia
      first = S[LIN_STAN.hitX];
      assert.ok(S[LIN_STAN.pinX] < first - 0.5 * BLONA.wp, `zacisk otwarty przed strugą (${S[LIN_STAN.pinX].toFixed(0)} < ${first.toFixed(0)})`);
      for (let k = 0; k < RK_N; k++) {
        const gain = CV[k] - before[k];
        if (gain > 0.02 * BLONA.Aref * RK_DX) assert.ok(Math.abs(RK_X[k] - first) < 100, `metal przybył w x ${RK_X[k].toFixed(0)} (wejście ${first.toFixed(0)})`);
      }
    }
    // tył nowego metalu: pierwsza komórka od tyłu z wyraźnym metalem — po wejściu cofa się ku tyłowi rękawu
    if (first !== null && S[LIN_STAN.inRate] > 5) {
      let r = Infinity;
      for (let k = 0; k < RK_N; k++) if (CV[k] > 0.05 * BLONA.Aref * RK_DX) { r = RK_X[k]; break; }
      if (rearLanded === null) rearLanded = r;
      if (r < rear - 1e-9) grewBack++;
      assert.ok(r <= rear + RK_DX + 1e-9, `tył metalu skacze naprzód w zrzucie (${rear.toFixed(0)} → ${r.toFixed(0)})`);
      rear = Math.min(rear, r);
    }
  });
  assert.ok(first !== null && Math.abs(first - LAND_X0) < 60, `struga wpada na pusty rękaw w swoim miejscu (${first})`);
  assert.ok(rearLanded > first - 120, `wypełnianie zaczyna się przy miejscu wpadania (${rearLanded.toFixed(0)})`);
  assert.ok(rear < BLONA.x0 + 120 && grewBack > 10, `wypełniona część rozciąga się ku tyłowi rękawu (tył ${rear.toFixed(0)}, kroków ${grewBack})`);
  assert.ok(Math.abs(tubeVolume(CV) - S[LIN_STAN.resV] * VOL_UNIT) < 1e-6 * S[LIN_STAN.resV] * VOL_UNIT, 'rękaw = masa błony');
});

test('formowanie/wyciskanie: bilans 0 po każdym podkroku (z prawdziwą komorą, krok 1/240 s) i rękaw = masa błony', () => {
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const line = createFormingLine({ seed: 11 });
  const inp = new Float64Array(LIN_WEJ_N);
  const last = { v: sim.counters[LICZNIK.delivered] };
  const CV = line.view.tube;
  const S = line.stan;
  const d0 = sim.counters[LICZNIK.delivered];
  let dumps = 0;
  let prevOn = 0;
  for (let i = 0; i < 110 * 60; i++) {
    sim.step(DT);
    feedFromChamber(sim, inp, last);
    const units = inp[LIN_WEJ.units];
    for (let k = 0; k < 4; k++) {
      inp[LIN_WEJ.units] = k === 0 ? units : 0;
      line.step(PASMO.h, inp);
      const a = line.audit();
      if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`bilans ${a.balance}, niezgodność ${a.mismatch} w podkroku ${i}.${k}`);
      const want = S[LIN_STAN.resV] * VOL_UNIT;
      if (Math.abs(tubeVolume(CV) - want) > 1e-6 * Math.max(want, 1)) assert.fail(`rękaw ≠ masa błony w podkroku ${i}.${k}`);
    }
    if (units > 0 && !prevOn) dumps++;
    prevOn = units > 0;
  }
  assert.ok(dumps >= 1, 'w przebiegu był zrzut');
  assert.equal(line.counters[LIN_LICZNIK.inflow], sim.counters[LICZNIK.delivered] - d0, 'dopływ linii = metal oddany gardzielą co do jednostki');
});

test('formowanie/wyciskanie: stan taśmy przy F1 w przepływie nominalnym bez zmian (30 × 200 j., 100 j./s; T jak w rundzie 6)', () => {
  // liczby rundy 6 (RAPORT-koncowy / RAPORT-pasmo): przy Q_nom front stal 2035, miedź 2058; T rdzenia 40 j. przed F1
  // stal 1483, miedź 1081 (± chwila próbkowania plastrów)
  const ref = [{ front: 2035, T: 1483 }, { front: 2058, T: 1081 }];
  for (const metal of [0, 1]) {
    const mill = createRollingMill();
    const line = createFormingLine({ seed: 5, metal, kin: mill, prefillTons: 400 });
    line.setQ(1);
    let fr = 0;
    for (let i = 0; i < 50 * 60; i++) { line.step(DT); if (i >= 40 * 60) fr += line.stan[LIN_STAN.frontSolid]; }
    fr /= 10 * 60;
    assert.ok(Math.abs(line.stan[LIN_STAN.vLine] - 100) < 0.5, `prędkość linii ${line.stan[LIN_STAN.vLine].toFixed(2)}`);
    assert.ok(Math.abs(fr - ref[metal].front) < 6, `metal ${metal}: front ${fr.toFixed(0)} (runda 6: ${ref[metal].front})`);
    const q = sliceAt(line, LINIA.stands[0].x - 40);
    const SL = line.view.slices;
    assert.ok(Math.abs(SL[q.o + PL.T] - ref[metal].T) < 4, `metal ${metal}: T przed F1 ${SL[q.o + PL.T].toFixed(0)} K (runda 6: ${ref[metal].T})`);
    assert.ok(Math.abs(SL[q.o + PL.A] / LINIA.w - LINIA.t0) < 0.6, `grubość przed F1 ${(SL[q.o + PL.A] / LINIA.w).toFixed(2)} j.`);
  }
});

test('formowanie/wyciskanie: mocniejszy ścisk po zrzucie — przepływ do 1,4 Q_nom (stal) / 1,3 (miedź), front zostaje ≥ 200 j. przed F1', () => {
  for (const metal of [0, 1]) {
    const sim = createMeltChamber({ seed: 7, metal, prewarm: true });
    const line = createFormingLine({ seed: 11, metal });
    const inp = new Float64Array(LIN_WEJ_N);
    const last = { v: sim.counters[LICZNIK.delivered] };
    let qMax = 0;
    let frMax = 0;
    let vMax = 0;
    for (let i = 0; i < 200 * 60; i++) {
      sim.step(DT);
      feedFromChamber(sim, inp, last);
      inp[LIN_WEJ.metal] = metal;
      line.step(DT, inp);
      if (i < 30 * 60) continue;
      qMax = Math.max(qMax, line.stan[LIN_STAN.Q] / PASMO.qNom);
      vMax = Math.max(vMax, line.stan[LIN_STAN.vLine]);
      if (line.stan[LIN_STAN.frontSolid] > 0) frMax = Math.max(frMax, xOf(line.stan[LIN_STAN.frontSolid]));
    }
    const cap = metal ? PASMO.regHiCu : PASMO.regHi;
    assert.ok(qMax > cap - 0.05 && qMax <= cap + 1e-6, `metal ${metal}: przepływ najwyżej ${qMax.toFixed(3)} Q_nom (granica ${cap})`);
    assert.ok(frMax < LINIA.stands[0].x - 200, `metal ${metal}: front najdalej ${frMax.toFixed(0)}`);
    assert.ok(vMax <= cap * 100 + 1, `metal ${metal}: taśma najszybciej ${vMax.toFixed(0)} j./s`);
  }
});

test('formowanie/wyciskanie: kształt rękawu — objętość = masa, brzuch skraca się od tyłu (przekrój prawie stały), spłaszczony, szyja do G0', () => {
  const WB = new Float64Array(8);
  const stats = (t) => {
    const l = bagAt(t);
    const CV = l.view.tube;
    assert.ok(Math.abs(tubeVolume(CV) / (l.stan[LIN_STAN.resV] * VOL_UNIT) - 1) < 1e-9, `rękaw = masa (${t} t)`);
    let amax = 0;
    for (let k = 0; k < RK_N; k++) if (RK_X[k] < BLONA.xN) amax = Math.max(amax, CV[k] / RK_DX);
    return { L: l.stan[LIN_STAN.resL], W: l.stan[LIN_STAN.memW], H: l.stan[LIN_STAN.memH], pin: l.stan[LIN_STAN.pinX], amax };
  };
  const full = stats(220);
  const mid = stats(120);
  const low = stats(45);
  // jak tubka: długość wypełnionej części maleje mocno, przekrój brzucha mało (wyciskanie od tyłu, nie „flaczenie”)
  assert.ok(full.L > 1.8 * low.L, `długość ${full.L.toFixed(0)} → ${low.L.toFixed(0)}`);
  assert.ok(low.W > 0.8 * full.W, `półszerokość brzucha ${full.W.toFixed(0)} → ${low.W.toFixed(0)}`);
  assert.ok(full.pin < mid.pin && mid.pin < low.pin, `zacisk ${full.pin.toFixed(0)} → ${mid.pin.toFixed(0)} → ${low.pin.toFixed(0)}`);
  for (const s of [full, mid, low]) assert.ok(s.H <= 0.5 * s.W, 'spłaszczony');
  // pełna błona nie jest kulą (kula 230 t: R = 38 · m^⅓ = 233 j.)
  assert.ok(2 * full.H < 0.6 * 2 * 38 * Math.cbrt(230), `wysokość ${(2 * full.H).toFixed(0)} j.`);
  // szyja kończy się w G0 okrągłym przekrojem gardzieli
  sectionAt(BLONA.xG0, Math.PI * BLONA.rNeck ** 2, WB);
  assert.ok(Math.abs(WB[0] - BLONA.rNeck) < 1e-9 && Math.abs(WB[1] - BLONA.rNeck) < 1e-9 && WB[2] === 2, 'G0 — okrąg r gardzieli');
  // przy wypływie nominalnym ostatnia komórka szyi ma przekrój bliski przekrojowi strugi G0 (złącze błona → pasmo bez skoku)
  {
    const l = bagAt(120);
    l.setQ(1);
    for (let i = 0; i < 6 * 60; i++) l.step(DT);
    const aEnd = l.view.tube[RK_N - 1] / RK_DX;
    assert.ok(Math.abs(Math.sqrt(aEnd / Math.PI) / BLONA.rNeck - 1) < 0.25, `przekrój przy G0 r ${Math.sqrt(aEnd / Math.PI).toFixed(1)} (r G0 ${BLONA.rNeck})`);
  }
});

test('formowanie/kropla: pierścienie pola przy wylewce otaczają strugę i nie wchodzą w błonę; bramki zacisku poza błoną, nad metalem nic', () => {
  const q = new Float64Array(6);
  // wierzch pełnej błony (260 t) z zapasem na mody (+25 % wysokości, ×1,15 szerokości) — ze stacji rękawu
  const ST = bagStations(bagAt(260));
  const topAt = (x, z) => {
    let best = null;
    for (const st of ST) if (st.kind && (!best || Math.abs(st.x - x) < Math.abs(best.x - x))) best = st;
    if (!best || Math.abs(best.x - x) > 6) return -Infinity;
    const a = best.a * 1.15;
    if (Math.abs(z) >= a) return -Infinity;
    return best.y + best.b * 1.25 * Math.sqrt(1 - (z / a) ** 2);
  };
  SPUST.rings.forEach((off, k) => {
    spustPoint(DROGA.sLip + off, q);
    const R = SPUST.ringR[k] + 3 + 4.5;
    assert.ok(SPUST.ringR[k] - 2 - 2.2 > 62, `pierścień ${k} obejmuje strugę (r strugi przy wardze ≤ 62)`);
    for (let j = 0; j < 64; j++) {
      const a = (j / 64) * TAU;
      const x = q[0] + (-q[4]) * Math.cos(a) * R;
      const y = q[1] + q[3] * Math.cos(a) * R;
      const z = Math.sin(a) * R;
      assert.ok(y > topAt(x, z) + 5, `pierścień ${k} w błonie (pełnej) przy (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
    }
  });
  // pierścienie pola na łuku strugi (poprawki rundy 6): nad pełną błoną (+25 % wysokości na mody), obejmują strugę
  // (odległość od osi strugi > promień strugi na łuku ≤ 42 j. przy 36 t/s z pulsem + 8), z góry elipsy (pochylone ≥ 35° od pionu)
  {
    const f = new Float64Array(6);
    SPUST.arcRings.forEach((A, k) => {
      arcRingFrame(k, f);
      assert.ok(Math.abs(f[3]) > Math.sin(35 * Math.PI / 180), `pierścień łuku ${k} pochylony ku poziomowi`);
      const R = A.R + 3 + 4;
      for (let j = 0; j < 96; j++) {
        const a = (j / 96) * TAU;
        const x = f[0] + f[4] * Math.cos(a) * R;
        const y = f[1] + f[5] * Math.cos(a) * R;
        const z = Math.sin(a) * R;
        assert.ok(y > topAt(x, z) + 5, `pierścień łuku ${k} w błonie przy (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
        const xi = f[0] + f[4] * Math.cos(a) * (A.R - 4.2);
        const yi = f[1] + f[5] * Math.cos(a) * (A.R - 4.2);
        const zi = Math.sin(a) * (A.R - 4.2);
        let d = Infinity;
        for (let s = DROGA.sLip; s < DROGA.sEnd; s += 2) { spustPoint(s, q); d = Math.min(d, Math.hypot(q[0] - xi, q[1] - yi, zi)); }
        assert.ok(d > 50, `pierścień łuku ${k} obejmuje strugę (${d.toFixed(0)} j. od osi)`);
      }
    });
  }
  // BRAMKI ZACISKU: płetwy (lico emitera na |z| = zR − finW/2) poza powłoką pola i metalem dla każdej masy (z zapasem na
  // mody), żebra pod błoną (≥ 8 j. pod spodem metalu ×1,15), z góry nad metalem nic z bramek
  const ribTop = ZACISK.ribY + 4.2;
  for (const t of [1, 10, 40, 120, 250]) {
    for (const st of bagStations(bagAt(t))) {
      if (st.x < ZACISK.x0 - 10 || st.x > ZACISK.x1 + 10) continue;
      assert.ok(Math.max(st.sa, st.a * 1.15) < ZACISK.zR - ZACISK.finW / 2 - 4, `płetwy zacisku przy błonie (${t} t, x ${st.x.toFixed(0)})`);
      if (st.kind) assert.ok(st.y - st.b * 1.15 > ribTop + 8, `żebro zacisku pod błoną (${t} t, x ${st.x.toFixed(0)})`);
    }
  }
  const B = outside();
  let gate = 0;
  for (let i = 0; i < B.n; i++) {
    if (B.aux[i * 2] !== OTO_POLE.pole || B.aux[i * 2 + 1] !== POLE_K.zacisk) continue;
    gate++;
    const x = B.pos[i * 3];
    const y = B.pos[i * 3 + 1];
    const z = B.pos[i * 3 + 2];
    if (Math.abs(z) < ZACISK.zR - 20) assert.ok(y < ribTop + 0.5, `emiter zacisku nad błoną: (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)})`);
  }
  assert.ok(gate > 500, 'emitery bramek zacisku w siatce');
});

test('formowanie/kropla: błona odpowiada na zrzut prawdziwą dynamiką — mody i fala rosną przy uderzeniu i gasną po spływie', () => {
  const line = createFormingLine({ seed: 6, prefillTons: 30, prefillRun: 2 });
  const S = line.stan;
  const act = () => Math.abs(S[LIN_STAN.q0]) + Math.abs(S[LIN_STAN.q1]) + Math.abs(S[LIN_STAN.q2]);
  assert.ok(act() < 1e-6 && S[LIN_STAN.etaE] < 1e-6, 'przed zrzutem błona spokojna');
  let peak = 0;
  let peakEta = 0;
  let peakDent = 0;
  runDump(line, 9, () => { peak = Math.max(peak, act()); peakEta = Math.max(peakEta, S[LIN_STAN.etaE]); peakDent = Math.max(peakDent, S[LIN_STAN.dent]); });
  assert.ok(peak > 0.05, `mody po uderzeniu ${peak.toFixed(3)}`);
  assert.ok(peakEta > 0.01, `fala po uderzeniu ${peakEta.toFixed(3)}`);
  assert.ok(peakDent > 10, `wgniecenie pod strugą ${peakDent.toFixed(1)} j.`);
  for (let i = 0; i < 12 * 60; i++) line.step(DT);
  assert.ok(act() < 0.3 * peak && S[LIN_STAN.etaE] < 0.3 * peakEta && S[LIN_STAN.dent] < 1, 'po spływie błona się uspokaja');
});

// ===================================================================================================================
// Etap „Walcowanie” — klatki F1–F3 na zakrzepłej taśmie
// ===================================================================================================================

/** Plaster zawierający x (od czoła): { o, top, bot } albo null. */
function sliceAt(line, x) {
  for (let i = 0; i < line.view.ring[1]; i++) {
    const o = line.sliceOffset(i);
    const bot = line.view.slices[o + PL.s];
    const top = line.sliceTop(i);
    if (x <= bot && x >= top) return { o, i, top, bot };
  }
  return null;
}
/**
 * Prędkość taśmy wzdłuż łuku [j./s] przy x: dolna granica plastra zawierającego x (prędkość w x × wydłużenie łuku w jej
 * miejscu — pętle) i przekrój plastra.
 */
function stripSpeedAt(line, mill, x) {
  const q = sliceAt(line, x);
  const SL = line.view.slices;
  const s = SL[q.o + PL.s];
  const ix = Math.floor(s - (LINIA.gates[0].x - 60));
  return { v: SL[q.o + PL.u] * mill.stretch[Math.max(0, ix)], A: SL[q.o + PL.A], a: SL[q.o + PL.a], s };
}

test('formowanie/walcowanie: stałość przepływu masy przez każdą klatkę (szerokość × grubość × prędkość); grubość 30 → 20 → 13 → 9', () => {
  for (const metal of [0, 1]) {
    for (const q of [0.8, 1, 1.25]) {
      const mill = createRollingMill();
      const line = createFormingLine({ seed: 5, metal, kin: mill });
      line.setQ(q);
      for (let i = 0; i < 30 * 60; i++) line.step(DT);
      const V = mill.view;
      // kinematyka: przepływ przez łuk styku — v_wej · t_wej = v_wyj · t_wyj (co do zaokrąglenia); runda 7: grubość
      // wejścia rzeczywista (z plastrów przy chwycie — `rIn`), wyjścia — szczelina pod obciążeniem (bicie, sprężystość — `gap`)
      for (let k = 0; k < 3; k++) {
        const fIn = V.vEntry[k] * WALC.T[k] * V.rIn[k];
        const fOut = V.vExit[k] * WALC.T[k + 1] * V.gap[k];
        assert.ok(Math.abs(fIn / fOut - 1) < 1e-12, `klatka ${k}: przepływ kinematyki`);
      }
      // F1 sprzężona z odlewaniem: wejście = prędkość linii; odchyłki grubości wsadu i szczeliny w granicach szumu
      assert.ok(Math.abs(V.vEntry[0] / line.stan[LIN_STAN.vLine] - 1) < 1e-12, 'F1: v_wej = v_odl');
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(V.rIn[k] - 1) < 0.05 && Math.abs(V.gap[k] - 1) < WALC.ecc + 0.02, `${WALC.stands[k].id}: grubość wsadu ${V.rIn[k].toFixed(4)}, szczelina ${V.gap[k].toFixed(4)}`);
      // taśma (plastry Lagrange'a): przekrój × prędkość wzdłuż łuku przed chwytem i za każdą klatką — równe co do szumu
      // grubości z wylotu G0 (różne plastry w jednej chwili: ±1–2 %)
      const xs = [WALC.stands[0].e - 25, ...WALC.stands.map((s) => s.x + 40)];
      const flows = xs.map((x) => { const r = stripSpeedAt(line, mill, x); return r.A * r.v; });
      for (let k = 1; k < flows.length; k++) assert.ok(Math.abs(flows[k] / flows[0] - 1) < 0.025, `metal ${metal}, Q ${q}: przepływ za ${WALC.stands[k - 1].id} ${(flows[k] / flows[0]).toFixed(4)}`);
      // TEN SAM PLASTER (śledzony po współrzędnej masy) przed F1 i za każdą klatką: przepływ V·ū/ℓ (= przekrój × prędkość
      // wzdłuż łuku) stały — plaster cieńszy i dłuższy dokładnie o tyle, o ile szybszy
      const SL = line.view.slices;
      const tag = sliceAt(line, WALC.stands[0].e - 60);
      const m0 = SL[tag.o + PL.m0];
      const marks = [WALC.stands[0].e - 50, ...WALC.stands.map((s) => s.x + 45)];
      const got = [];
      for (let i = 0; i < 6 * 60 && got.length < marks.length; i++) {
        line.step(DT);
        for (let j = 0; j < line.view.ring[1]; j++) {
          const o = line.sliceOffset(j);
          if (SL[o + PL.m0] !== m0) continue;
          const top = line.sliceTop(j);
          const bot = SL[o + PL.s];
          const c = 0.5 * (top + bot);
          if (c >= marks[got.length]) got.push(SL[o + PL.m] * VOL_UNIT * 0.5 * (SL[o + PL.u] + line.sliceTopU(j)) / (bot - top));
          break;
        }
      }
      assert.equal(got.length, marks.length, 'plaster przeszedł przez wszystkie klatki');
      // (runda 7: przepływ za klatką oddycha z biciem walców — szczelina ±`ecc`, prędkość obwodowa stała; pętla bierze
      // różnicę, a regulator pętli zmienia prędkość klatki, zanim plaster dojdzie do znacznika — ten sam plaster za klatką
      // w granicach bicia, sprężystości klatki i korekty pętlownika: 3 %)
      for (let k = 1; k < got.length; k++) assert.ok(Math.abs(got[k] / got[0] - 1) < 0.03, `metal ${metal}, Q ${q}: przepływ plastra za ${WALC.stands[k - 1].id} ${(got[k] / got[0]).toFixed(5)}`);
      // masa, która przeszła przez przekrój przed F1 i za każdą klatką w oknie 20 s (współrzędna masy w punkcie) — równa
      // co do zmiany zawartości przęseł (szum grubości taśmy ±0,5 %)
      const mc = (x) => { const r = sliceAt(line, x); return SL[r.o + PL.m0] + SL[r.o + PL.m] * (r.bot - x) / (r.bot - r.top); };
      const c0 = xs.map(mc);
      for (let i = 0; i < 20 * 60; i++) line.step(DT);
      const passed = xs.map((x, k) => mc(x) - c0[k]);
      for (let k = 1; k < passed.length; k++) assert.ok(Math.abs(passed[k] / passed[0] - 1) < 4e-3, `metal ${metal}, Q ${q}: masa przez ${WALC.stands[k - 1].id} ${(passed[k] / passed[0]).toFixed(5)}`);
      assert.ok(Math.abs(passed[0] / UNITS_PER_TON / 20 / (q * PASMO.qNom) - 1) < 0.03, `metal ${metal}, Q ${q}: przepływ ${(passed[0] / UNITS_PER_TON / 20).toFixed(3)} t/s`);
      // grubość średnia za klatkami (przekrój / szerokość) = rozkład 20 / 13 / 9 (± 1,5 % — szum grubości z wylotu G0)
      WALC.stands.forEach((s, k) => {
        const r = stripSpeedAt(line, mill, s.x + 60);
        const t = r.A / (2 * r.a);
        assert.ok(Math.abs(t / WALC.T[k + 1] - 1) < 0.015, `metal ${metal}, Q ${q}: grubość za ${s.id} ${t.toFixed(2)}`);
      });
      // taśma przyspiesza: v rośnie odwrotnie do grubości
      assert.ok(V.vExit[0] > V.vEntry[0] && V.vExit[1] > V.vExit[0] && V.vExit[2] > V.vExit[1]);
      // wyrób: v = v_odlewania · 30 / 9 — w chwili w granicach zakłóceń (pętlowniki, bicie, napęd), średnio dokładnie
      assert.ok(Math.abs(V.vExit[2] / line.stan[LIN_STAN.vLine] / (30 / 9) - 1) < 0.03, 'wyrób: v ≈ v_odlewania · 30 / 9');
      {
        let sum = 0;
        for (let i = 0; i < 10 * 60; i++) { line.step(DT); sum += V.vExit[2] / line.stan[LIN_STAN.vLine] / (30 / 9); }
        // (szczelina ustala grubość, a taśma jest o 0,2–0,5 % szersza niż nominalne 200 j. — zamrożona przy krzepnięciu:
        // wyrób jedzie średnio o tyle wolniej niż v_odl · 30 / 9)
        assert.ok(sum / 600 < 1.002 && sum / 600 > 0.992, `wyrób: średnio v / (v_odl · 30 / 9) = ${(sum / 600).toFixed(5)}`);
      }
      assert.equal(line.audit().balance, 0);
    }
  }
});

test('formowanie/walcowanie: prędkość obwodowa walców = prędkość taśmy na wyjściu z klatki; walce kręcą się z taśmą', () => {
  const mill = createRollingMill();
  const line = createFormingLine({ seed: 7, kin: mill });
  line.setQ(1);
  for (let i = 0; i < 25 * 60; i++) line.step(DT);
  const V = mill.view;
  const a0 = Float64Array.from(V.ang);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(V.omega[k] * WALC.R - V.vExit[k]) < 1e-9, `${WALC.stands[k].id}: ω·R = v_wyj`);
    // taśma tuż za osią walców jedzie z prędkością obwodową (granice plastrów, RK2 w tablicy kinematyki)
    const r = stripSpeedAt(line, mill, WALC.stands[k].x + 6);
    assert.ok(Math.abs(r.v / (V.omega[k] * WALC.R) - 1) < 0.005, `${WALC.stands[k].id}: taśma ${r.v.toFixed(2)} j./s, walec ${(V.omega[k] * WALC.R).toFixed(2)} j./s`);
  }
  // kąt walca rośnie o ω·t (mod 2π); runda 7: ω zmienia się w podkrokach (zakłócenia przepływu) — w granicach 3 %
  const w0 = Float64Array.from(V.omega);
  line.step(DT);
  for (let k = 0; k < 3; k++) {
    let d = V.ang[k] - a0[k];
    if (d < 0) d += 2 * Math.PI;
    const wm = 0.5 * (w0[k] + V.omega[k]);
    assert.ok(Math.abs(d / (wm * DT) - 1) < 0.03, `${WALC.stands[k].id}: obrót walca ${d.toFixed(5)} rad na krok (ω·dt ${(wm * DT).toFixed(5)})`);
  }
});

test('formowanie/walcowanie: czoło wchodzi w klatki po kolei (chwyt, udar, pętla), koniec wychodzi z nich — bez teleportacji; bilans 0', () => {
  // START z zimnej linii: syntetyczny spływ, czoło przez F1 → F2 → F3 → bramę
  const mill = createRollingMill();
  const line = createFormingLine({ seed: 11, cold: true, kin: mill });
  const inp = new Float64Array(LIN_WEJ_N);
  const dump = syntheticDump(240);
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.tempT] = 0.95;
  const V = mill.view;
  const biteAt = [null, null, null];
  const biteX = [0, 0, 0];
  let prev = -1;
  let maxStep = 0;
  let loopOk = [false, false];
  for (let i = 0; i < 120 * 60; i++) {
    inp[LIN_WEJ.units] = dump();
    line.step(DT, inp);
    if (line.audit().balance !== 0) assert.fail(`bilans ${line.audit().balance} w kroku ${i}`);
    const S = line.stan;
    if (line.view.ring[1] === 0) continue;
    const head = S[LIN_STAN.front];
    // (czoło za końcem drogi wychodzi do zwijarki — plaster znika, czołem staje się następny)
    if (prev > 0 && prev < PASMO.sExit) {
      assert.ok(head >= prev - 1e-6, `czoło cofa się ${prev.toFixed(2)} → ${head.toFixed(2)}`);
      // bez teleportacji: przesunięcie czoła ≤ prędkość wyjścia F3 · krok (z zapasem na przyspieszenie w łuku styku)
      const vmax = S[LIN_STAN.vLine] * 30 / 9 * 1.06;
      assert.ok(head - prev <= vmax * DT + 0.2, `skok czoła ${(head - prev).toFixed(2)} j. przy ${prev.toFixed(0)}`);
      maxStep = Math.max(maxStep, head - prev);
    }
    prev = head;
    for (let k = 0; k < 3; k++) if (biteAt[k] === null && V.bites[k] > 0) { biteAt[k] = i * DT; biteX[k] = head; }
    for (let j = 0; j < 2; j++) if (V.mode[j] === PRZESLO.PETLA && Math.abs(V.dL[j] - WALC.loopSet) < 0.4 && V.hLoop[j] > 20) loopOk[j] = true;
    if (head >= XB && loopOk[0] && loopOk[1]) break;
  }
  for (let k = 0; k < 3; k++) {
    assert.ok(biteAt[k] !== null, `chwyt ${WALC.stands[k].id}`);
    assert.ok(Math.abs(biteX[k] - WALC.stands[k].e) < 4, `${WALC.stands[k].id}: chwyt przy czole ${biteX[k].toFixed(1)} (łuk styku od ${WALC.stands[k].e.toFixed(1)})`);
    if (k) assert.ok(biteAt[k] > biteAt[k - 1], 'chwyty po kolei');
    assert.equal(V.bites[k], 1, 'jeden chwyt na czoło');
  }
  assert.ok(loopOk[0] && loopOk[1], 'pętle w obu przęsłach wracają do luzu zadanego (8 j.)');
  assert.ok(prev >= XB, 'czoło minęło nóż dzielenia (runda 8: w miejscu bramy „DO ZWIJARKI”)');

  // KONIEC: linia z pasmem (start strony), dobieg → odcięcie → ogon przez klatki F1 → F3 i bramę
  const mill2 = createRollingMill();
  const L2 = createFormingLine({ seed: 4, kin: mill2 });
  const V2 = mill2.view;
  const in2 = new Float64Array(LIN_WEJ_N);
  L2.drain();
  let tailPrev = -1;
  const outAt = [null, null, null];
  let gone = null;
  for (let i = 0; i < 200 * 60; i++) {
    L2.step(DT, in2);
    if (L2.audit().balance !== 0) assert.fail('bilans w dobiegu z walcownią');
    const S = L2.stan;
    if (!S[LIN_STAN.attached] && L2.view.ring[1] > 0) {
      const tail = S[LIN_STAN.tail];
      if (tailPrev > 0) {
        assert.ok(tail >= tailPrev - 1e-6, 'ogon się nie cofa');
        assert.ok(tail - tailPrev <= S[LIN_STAN.vLine] * 30 / 9 * 1.06 * DT + 0.2, `skok ogona ${(tail - tailPrev).toFixed(2)} j.`);
      }
      tailPrev = tail;
    }
    for (let k = 0; k < 3; k++) if (outAt[k] === null && V2.tailOuts[k] > 0) outAt[k] = i;
    if (outAt[2] !== null && L2.view.ring[1] === 0) { gone = i; break; }
  }
  for (let k = 0; k < 3; k++) assert.ok(outAt[k] !== null, `koniec wyszedł z ${WALC.stands[k].id}`);
  assert.ok(outAt[0] < outAt[1] && outAt[1] < outAt[2], 'koniec wychodzi z klatek po kolei');
  assert.ok(gone !== null && L2.counters[LIN_LICZNIK.strip] === 0, 'pasmo wyjechało przez bramę');
  assert.ok(V2.dL[0] < 0.5 && V2.dL[1] < 0.5, 'pętle opadły po wyjściu końca');
});

test('formowanie/walcowanie: bilans całej linii = 0 po każdym kroku z prawdziwą komorą (z walcownią); dopływ = metal z gardzieli', () => {
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const mill = createRollingMill();
  const line = createFormingLine({ seed: 11, kin: mill });
  const inp = new Float64Array(LIN_WEJ_N);
  const last = { v: sim.counters[LICZNIK.delivered] };
  const d0 = sim.counters[LICZNIK.delivered];
  let minLoop = Infinity;
  for (let i = 0; i < 130 * 60; i++) {
    sim.step(DT);
    feedFromChamber(sim, inp, last);
    line.step(DT, inp);
    const a = line.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`bilans ${a.balance}, niezgodność ${a.mismatch} w kroku ${i}`);
    if (i > 10 * 60) minLoop = Math.min(minLoop, mill.view.hLoop[0], mill.view.hLoop[1]);
  }
  assert.equal(line.counters[LIN_LICZNIK.inflow], sim.counters[LICZNIK.delivered] - d0);
  assert.ok(line.counters[LIN_LICZNIK.exited] > 150 * UNITS_PER_TON, 'zwalcowana taśma wychodzi do zwijarki');
  assert.ok(minLoop > 15, `pętle trzymane przez cały obieg (najniżej ${minLoop.toFixed(1)} j.)`);
});

test('formowanie/walcowanie: krok linii z walcownią, iskry walcowni i stacje bez alokacji', async () => {
  // (świeże egzemplarze modułów: wcześniejsze testy wołają te same funkcje z innymi kinematykami — `openMill`, brak —
  // i kompilator wybiera dla nich wolniejsze ścieżki; na stronie dema linia, walcownia i stacje są jedne)
  const fresh = await import('../dema/ring-dzielnice/huta/formowanie/linia.js?walcowanie');
  const freshMill = await import('../dema/ring-dzielnice/huta/formowanie/walcownia.js?walcowanie');
  const freshSt = await import('../dema/ring-dzielnice/huta/formowanie/stacje.js?walcowanie');
  const freshSp = await import('../dema/ring-dzielnice/huta/formowanie/iskry.js?walcowanie');
  const freshZg = await import('../dema/ring-dzielnice/huta/formowanie/zgorzelina.js?walcowanie');
  const mill = freshMill.createRollingMill();
  const line = fresh.createFormingLine({ seed: 9, kin: mill });
  const sparks = freshSp.createLineSparks(23);
  const debris = freshZg.createScaleDebris(31);
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.tempT] = 0.95;
  const filler = freshSt.createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  const step = (i) => { inp[LIN_WEJ.units] = (i % 240) < 120 ? 600 : 0; line.step(DT, inp); debris.step(DT, mill, line); sparks.step(DT, line); };
  const warm = () => { for (let i = 0; i < 600; i++) { step(i); filler.fill(line, mill, 0.5, DT, out); } };
  warm();
  const per60 = await untilSteady(() => allocatedBytes(step, 60), (b) => b < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(per60 < 8192, `krok linii z walcownią alokuje ${per60} B na 60 kroków`);
  const perFill = await untilSteady(() => allocatedBytes(() => filler.fill(line, mill, 0.5, DT, out), 60), (b) => b < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(perFill < 8192, `stacje z walcownią alokują ${perFill} B na 60 klatek`);
});

test('formowanie/walcowanie: taśma w łuku styku idzie po okręgu walców (±0,1 j.), pętla nad pętlownikiem, bryły klatek poza taśmą', () => {
  const mill = createRollingMill();
  const line = createFormingLine({ seed: 5, kin: mill });
  line.setQ(1);
  for (let i = 0; i < 20 * 60; i++) line.step(DT);
  const filler = createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  filler.fill(line, mill, 0.5, DT, out);
  for (const v of out) assert.ok(Number.isFinite(v), 'NaN w stacjach');
  const PY = HALA.passY;
  let inArc = 0;
  for (let k = 0; k < 3; k++) {
    const S = WALC.stands[k];
    const [xc, yu, yl] = rollCenters(k);
    // szczelina walców = grubość osi na wyjściu
    assert.ok(Math.abs((yu - WALC.R) - (yl + WALC.R) - 2 * S.bOut) < 1e-9);
    assert.ok(Math.abs(axisHalfAt(S.x) - S.bOut) < 1e-9 && Math.abs(axisHalfAt(S.e) - S.bIn) < 1e-6, `${S.id}: profil łuku`);
    for (let q = STACJE.strip.i0; q < STACJE.n; q++) {
      const r = q * STACJE.stride;
      const x = out[r];
      if (out[r + 7] === 0 || x < S.e + 1 || x > S.x) continue;
      inArc++;
      const dx = x - xc;
      const rollLo = yu - Math.sqrt(WALC.R * WALC.R - dx * dx);
      const rollHi = yl + Math.sqrt(WALC.R * WALC.R - dx * dx);
      assert.ok(Math.abs(out[r + 1] + out[r + 5] - rollLo) < 0.1, `${S.id}: lico górne ${(out[r + 1] + out[r + 5] - rollLo).toFixed(3)} od walca na x ${x}`);
      assert.ok(Math.abs(rollHi - (out[r + 1] - out[r + 5])) < 0.1, `${S.id}: lico dolne od walca na x ${x}`);
    }
  }
  assert.ok(inArc >= 20, `stacji w łukach styku ${inArc}`);
  // pętla: szczyt nad środkiem przęsła, pętlownik polowy pod nią (wierzch emitera pod taśmą płaską)
  for (let j = 0; j < 2; j++) {
    const sp = WALC.spans[j];
    let crest = -1e9;
    let crestX = 0;
    for (let q = STACJE.strip.i0; q < STACJE.n; q++) {
      const r = q * STACJE.stride;
      if (out[r] > sp.a && out[r] < sp.b && out[r + 1] - PY > crest) { crest = out[r + 1] - PY; crestX = out[r]; }
    }
    assert.ok(Math.abs(crest - mill.view.hLoop[j]) < 1 && crest > 20, `przęsło ${j}: szczyt pętli ${crest.toFixed(1)} j.`);
    assert.ok(Math.abs(crestX - sp.xm) < 12, `przęsło ${j}: szczyt nad pętlownikiem (${crestX.toFixed(0)} / ${sp.xm.toFixed(0)})`);
    assert.ok(WALC.looperY < -WALC.b[j + 1] - 20, 'emiter pętlownika pod taśmą');
  }
  // bryły walcowni: nad pasmem tylko górne walce i brama; cokół pętlownika i noże C3 poza dolnymi walcami; stojaki poza taśmą
  const B = new Budowniczy(80000);
  buildRollingMill(B);
  assert.equal(B.over, 0);
  let rolls = 0;
  for (let i = 0; i < B.n; i++) {
    const x = B.pos[i * 3];
    const y = B.pos[i * 3 + 1];
    const z = B.pos[i * 3 + 2];
    if (B.aux[i * 2] === OTO_WALC.walec) { rolls++; continue; }
    for (let k = 0; k < 3; k++) {
      const [xc, yu, yl] = rollCenters(k);
      if (Math.abs(z) > KLATKA.barrel) continue;
      for (const yc of [yu, yl]) assert.ok(Math.hypot(x - xc, y - yc) >= WALC.R - 0.5, `bryła w walcu ${WALC.stands[k].id}: ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}`);
    }
    // korytarz taśmy (|z| ≤ 104, ±12 j. wokół osi z pętlą) wolny do końca drogi pasma (runda 8: bez bramy); runda 9: poza
    // STACJĄ ODZGORZANIA za F3 (taśma płaska, bez pętli — belki 14,6 j. nad licem i 5,7 j. pod spodem; test „czysta stal”)
    if (descalerBoxes().some(({ b: q }) => x >= q[0] - 0.5 && x <= q[1] + 0.5 && y >= q[2] - 0.5 && y <= q[3] + 0.5 && z >= q[4] - 0.5 && z <= q[5] + 0.5)) continue;
    if (x < LINIA.stripEndX + 60 && Math.abs(z) < 104 && y > PY - 14 && y < PY + 45) assert.fail(`bryła w drodze taśmy: ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}`);
  }
  assert.ok(rolls > 5000, 'walce w siatce (rodzaj walec)');
  // (runda 8) koniec drogi pasma za najdalszym czołem przed cięciem, przed gniazdami i ścianą czołową hali
  assert.ok(PASMO.sExit > FRONT_MAX + 20 && PASMO.sExit < DZIEL.wall.x0 && OSLONA.x0 < XB);
  assert.deepEqual([...POLE_PETLA], [16, 17]);
});

test('formowanie/walcowanie: zgorzelina i iskry walcowni — salwa przy chwycie czoła, strumień z zrzuconej zgorzeliny, płatki, iskry i pył, w pojemności puli', () => {
  // (runda 7: własna pula `zgorzelina.js` — płatki łuski, iskry, pył; ilość z zrzuconej zgorzeliny)
  const mill = createRollingMill();
  const line = createFormingLine({ seed: 11, cold: true, kin: mill });
  const debris = createScaleDebris(5);
  const inp = new Float64Array(LIN_WEJ_N);
  const dump = syntheticDump(240);
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.tempT] = 0.95;
  let jump = 0;
  for (let i = 0; i < 120 * 60; i++) {
    inp[LIN_WEJ.units] = dump();
    const b0 = mill.view.bites[0];
    const n0 = debris.count;
    line.step(DT, inp);
    debris.step(DT, mill, line);
    if (mill.view.bites[0] !== b0) jump = debris.count - n0;
    assert.ok(debris.count <= ZGORZ.cap);
    if (mill.view.bites[2] > 0 && i % 60 === 0 && mill.view.biteT[2] > 3) break;
  }
  const sv = ZGORZ.salvo[0];
  assert.ok(jump >= sv[0] + sv[1] + sv[2] - 2, `salwa przy chwycie F1: ${jump} cząstek`);
  // w stanie ustalonym zgorzelina sypie się ciągle (z każdej klatki): są płatki, iskry i pył; rekordy bez NaN
  let live = 0;
  const kinds = [0, 0, 0];
  for (let i = 0; i < 120; i++) {
    inp[LIN_WEJ.units] = dump(); line.step(DT, inp); debris.step(DT, mill, line); live += debris.count;
    for (let q = 0; q < debris.count; q++) kinds[debris.data[q * ZGORZ.stride + 8] | 0]++;
  }
  assert.ok(live / 120 > 20, `cząstki przy klatkach w pracy: średnio ${(live / 120).toFixed(0)}`);
  assert.ok(kinds[0] > 0 && kinds[1] > kinds[0] * 0.8 && kinds[2] > 0, `rodzaje: iskry ${kinds[0]}, płatki ${kinds[1]}, pył ${kinds[2]}`);
  for (let q = 0; q < debris.count * ZGORZ.stride; q++) assert.ok(Number.isFinite(debris.data[q]), 'NaN w rekordach zgorzeliny');
  for (let k = 0; k < 3; k++) assert.ok(mill.view.shed[k] > 0, `${WALC.stands[k].id}: zgorzelina zrzucona`);
  // płatki i iskry nie wchodzą w walce (beczka)
  for (let q = 0; q < debris.count; q++) {
    const o = q * ZGORZ.stride;
    if (debris.data[o + 8] === 2) continue;
    const x = debris.data[o];
    const y = debris.data[o + 1];
    const z = debris.data[o + 2];
    if (Math.abs(z) > 135) continue;
    for (let k = 0; k < 3; k++) {
      const [xc, yu, yl] = rollCenters(k);
      for (const yc of [yu, yl]) assert.ok(Math.hypot(x - xc, y - yc) > WALC.R - 1, `cząstka w walcu ${WALC.stands[k].id}`);
    }
  }
});

test('formowanie/walcowanie (runda 9, „Gorętsza taśma”): temperatura końca walcowania za F3 — stal 1150 K, miedź 1000 K (noże C3 z regulatorem); 0,7 / 1 / 1,4 (miedź 1,3); front przed F1', () => {
  // Dawniej noże C3 dmuchały pełną mocą i gasiły taśmę za F3 z ok. 1300 do ok. 900 K (stal) / 1015 → 755 K (miedź) —
  // arkusze z kamery gry nie świeciły. Regulator trzyma temperaturę za nożami (pirometr wyjścia) w celu `Tfin`; poniżej
  // celu (mały przepływ — taśma stygnie dłużej przed F3) noże stoją i taśmy nie grzeją. Paleta żaru bez zmian.
  const cases = [
    // [metal, Q, dolna, górna granica T za nożami C3 [K], noże stoją (u ≈ 0)]
    [0, 0.7, 1080, 1160, true], [0, 1, 1125, 1175, false], [0, 1.4, 1120, 1190, false],
    [1, 0.7, 800, 900, true], [1, 1, 975, 1025, null], [1, 1.3, 970, 1035, false]
  ];
  for (const [metal, Q, lo, hi, idle] of cases) {
    const mill = createRollingMill();
    const div = createDivider({});
    const line = createFormingLine({ seed: 11, metal, kin: mill, divider: div });
    const inp = new Float64Array(LIN_WEJ_N);
    inp[LIN_WEJ.tempT] = 1; inp[LIN_WEJ.metal] = metal;
    const S = line.stan;
    let n = 0, Tout = 0, Tin = 0, u = 0, Tmax = 0, front = 0;
    for (let i = 0; i < 50 * 60; i++) {
      line.setQ(Q);
      line.step(DT, inp);
      if (i < 35 * 60) continue;
      assert.ok(S[LIN_STAN.c3u] >= 0 && S[LIN_STAN.c3u] <= 1, 'otwarcie noży 0…1');
      if (S[LIN_STAN.c3Tout] <= 0 || S[LIN_STAN.c3Tin] <= 0) continue;
      n++; Tout += S[LIN_STAN.c3Tout]; Tin += S[LIN_STAN.c3Tin]; u += S[LIN_STAN.c3u];
      Tmax = Math.max(Tmax, S[LIN_STAN.c3Tout]); front += S[LIN_STAN.frontSolid] - PATH.xOff;
    }
    assert.ok(n > 600, `metal ${metal}, Q ${Q}: taśma pod pirometrami (${n})`);
    Tout /= n; Tin /= n; u /= n; front /= n;
    const tag = `metal ${metal}, Q ${Q}: za F3 przed nożami ${Tin.toFixed(0)} K, za nożami ${Tout.toFixed(0)} K, noże ${u.toFixed(2)}`;
    assert.ok(Tout >= lo && Tout <= hi, tag);
    assert.ok(Tout <= Tin + 1, `${tag} — noże nie grzeją`);
    if (idle === true) assert.ok(u < 0.02, `${tag} — poniżej celu noże stoją`);
    if (idle === false) assert.ok(u > 0.1, `${tag} — powyżej celu noże dmuchają`);
    // walcowanie na gorąco z zapasem: stal poniżej 1300 K (bez przegrzania wyrobu), miedź ≥ 300 K poniżej solidusu
    assert.ok(Tmax < (metal ? METAL_FIZ[1].Tsol - 300 : 1300), `${tag} — najwyżej ${Tmax.toFixed(0)} K`);
    assert.ok(front < LINIA.stands[0].x - 150, `${tag} — front krzepnięcia ${front.toFixed(0)} przed F1`);
  }
});

test('formowanie/walcowanie (runda 7): pętlowniki pracują w stanie ustalonym — zakłócenia przepływu (szum grubości, bicie walców, napęd), ramię nadąża za pętlą; cały zakres przepływu', () => {
  // obieg z prawdziwą komorą: prędkość odlewania zmienia się 0,7 ↔ 1,4 nominału; pętle żyją, ale trzymają luz (nie
  // napinają taśmy, nie rosną bez końca), ramię pętlownika idzie za pętlą (głowica pod taśmą)
  for (const metal of [0, 1]) {
    const sim = createMeltChamber({ seed: 7, metal, prewarm: true });
    const mill = createRollingMill();
    const line = createFormingLine({ seed: 11, metal, kin: mill });
    const inp = new Float64Array(LIN_WEJ_N);
    const last = { v: sim.counters[LICZNIK.delivered] };
    const V = mill.view;
    const st = [[], []];
    const arm = [[], []];
    let vMin = 1e9;
    let vMax = 0;
    for (let i = 0; i < 110 * 60; i++) {
      sim.step(DT);
      feedFromChamber(sim, inp, last);
      inp[LIN_WEJ.metal] = metal;
      line.step(DT, inp);
      if (i < 15 * 60) continue;
      vMin = Math.min(vMin, line.stan[LIN_STAN.vLine]);
      vMax = Math.max(vMax, line.stan[LIN_STAN.vLine]);
      for (let j = 0; j < 2; j++) {
        assert.equal(V.mode[j], PRZESLO.PETLA, 'pętla w pracy');
        assert.ok(V.dL[j] > 1.5 && V.dL[j] < 20, `przęsło ${j}: luz ${V.dL[j].toFixed(2)} j.`);
        st[j].push(V.dL[j]);
        arm[j].push(V.arm[j]);
        // głowica pętlownika pod taśmą (bez dotyku): szczyt głowicy niżej niż spód pętli nad nią
        const sp = WALC.spans[j];
        const xh = sp.xm + WALC.armDx + WALC.armL * Math.cos(V.arm[j]);
        const yh = WALC.armDy + WALC.armL * Math.sin(V.arm[j]);
        const xi = (xh - sp.a) / sp.L;
        const yLoop = V.hLoop[j] * Math.sin(Math.PI * xi) ** 2 - WALC.b[j + 1];
        assert.ok(yh + 12 < yLoop, `przęsło ${j}: głowica ${yh.toFixed(1)} pod pętlą ${yLoop.toFixed(1)}`);
      }
    }
    assert.ok(vMin < 75 && vMax > 125, `prędkość odlewania w obiegu ${vMin.toFixed(0)}…${vMax.toFixed(0)} j./s`);
    const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    // pętle pracują: luz się waha (nie stoi jak przy idealnym przepływie), ramię się rusza
    assert.ok(sd(st[0]) > 0.5 && sd(st[1]) > 0.2, `metal ${metal}: odchylenie luzu ${sd(st[0]).toFixed(2)} / ${sd(st[1]).toFixed(2)} j.`);
    assert.ok(sd(arm[0]) * 180 / Math.PI > 1 && sd(arm[1]) * 180 / Math.PI > 0.4, `metal ${metal}: ramię ${(sd(arm[0]) * 180 / Math.PI).toFixed(2)}° / ${(sd(arm[1]) * 180 / Math.PI).toFixed(2)}°`);
    assert.equal(line.audit().balance, 0);
  }
  // cały zakres przepływu po wyciskaniu: stal 0,7…1,4, miedź 0,7…1,3 — taśma przy chwycie F1 zakrzepła, pętle trzymane
  for (const [metal, q] of [[0, 0.7], [0, 1.4], [1, 0.7], [1, 1.3]]) {
    const mill = createRollingMill();
    const line = createFormingLine({ seed: 5, metal, kin: mill });
    line.setQ(q);
    for (let i = 0; i < 30 * 60; i++) line.step(DT);
    let minH = 1e9;
    for (let i = 0; i < 10 * 60; i++) { line.step(DT); minH = Math.min(minH, mill.view.hLoop[0], mill.view.hLoop[1]); }
    assert.ok(minH > 15, `metal ${metal}, Q ${q}: pętle ≥ 15 j. (najniżej ${minH.toFixed(1)})`);
    const fs = line.stan[LIN_STAN.frontSolid];
    assert.ok(fs > 0 && fs < WALC.stands[0].e - 150, `metal ${metal}, Q ${q}: front krzepnięcia ${fs.toFixed(0)} przed chwytem F1`);
    assert.ok(Math.abs(mill.view.vExit[2] / line.stan[LIN_STAN.vLine] / (30 / 9) - 1) < 0.04, `metal ${metal}, Q ${q}: wyrób`);
    assert.equal(line.audit().balance, 0);
  }
});

// ===================================================================================================================
// Runda 7, etap „Formowanie — dopracowanie”: obraz od G0 do F1 z liczonego stanu (jeziorko, nacisk bram, chłodnice)
// ===================================================================================================================

/** Linia w stanie ustalonym przy wymuszonym przepływie `q` (× Q_nom), błona dolewana tym samym tempem; z walcownią. */
function steadyLine(q, metal = 0, seconds = 40) {
  const mill = createRollingMill();
  const line = createFormingLine({ seed: 11, metal, kin: mill });
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.tempT] = 1;
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.metal] = metal;
  inp[LIN_WEJ.valve] = 1;
  line.setQ(q);
  let carry = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const want = q * PASMO.qNom * UNITS_PER_TON / 60 + carry;
    const u = Math.floor(want);
    carry = want - u;
    inp[LIN_WEJ.units] = u;
    line.step(DT, inp);
  }
  return { line, mill };
}
/** Stacje pasma z linii: [{ x, a, b, kind, wp, Tpool, Ts, sa, sb, shell, band, glow }] i wypełniacz. */
function stripStations(line, mill) {
  const filler = createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  filler.fill(line, mill, 1, DT, out);
  const st = [];
  for (let q = STACJE.strip.i0; q < STACJE.n; q++) {
    const r = q * STACJE.stride;
    if (out[r + 7] === 0) continue;
    st.push({ x: out[r], a: out[r + 4], b: out[r + 5], kind: out[r + 7], wp: out[r + 24], Tpool: out[r + 26], Ts: out[r + 9], sa: out[r + 20], sb: out[r + 21], shell: out[r + 22], band: out[r + 23], glow: out[r + 18] });
  }
  for (const v of out) assert.ok(Number.isFinite(v), 'NaN w stacjach');
  return { st, filler, out };
}

test('formowanie/runda7: jeziorko — klin cieczy z góry zwęża się od brzegów ku środkowi i kończy na froncie; dłuższy przy większym przepływie', () => {
  for (const metal of [0, 1]) {
    const tips = [];
    for (const q of [0.7, 1, 1.3]) {
      const { line, mill } = steadyLine(q, metal);
      const front = line.stan[LIN_STAN.frontSolid] - PATH.xOff;
      const { st } = stripStations(line, mill);
      const name = `${metal ? 'miedź' : 'stal'} ${q}`;
      // przy G0 metal płynie całą szerokością (rdzeń ciekły), dalej klin zwęża się (bez skoków w górę) i znika na froncie
      const g0 = st.filter((s) => s.x < LINIA.gates[0].x + 30);
      assert.ok(g0.every((s) => s.wp > 0.9), `${name}: przy G0 jeziorko ${g0.map((s) => s.wp.toFixed(2))}`);
      let prev = 1;
      let tip = -1;
      for (const s of st) {
        if (s.x > front + 40) break;
        assert.ok(s.wp <= prev + 0.03, `${name}: jeziorko rośnie wzdłuż drogi przy x ${s.x.toFixed(0)} (${prev.toFixed(3)} → ${s.wp.toFixed(3)})`);
        prev = Math.min(prev, s.wp);
        if (s.wp > 0.05) tip = s.x;
        // powierzchnia jeziorka w temperaturze rdzenia (nie niższej niż lico)
        if (s.wp > 0.05) assert.ok(s.Tpool >= s.Ts - 1e-4, `${name}: jeziorko chłodniejsze od lica przy x ${s.x.toFixed(0)}`);
      }
      for (const s of st) if (s.x > front + 5) assert.equal(s.wp, 0, `${name}: za frontem nie ma cieczy (x ${s.x.toFixed(0)}, front ${front.toFixed(0)})`);
      assert.ok(tip > front - 80 && tip <= front + 5, `${name}: koniec klina ${tip.toFixed(0)} przy froncie ${front.toFixed(0)}`);
      tips.push(tip);
    }
    assert.ok(tips[0] + 60 < tips[1] && tips[1] + 60 < tips[2], `${metal ? 'miedź' : 'stal'}: klin dłuższy z przepływem ${tips.map((t) => t.toFixed(0))}`);
  }
});

test('formowanie/runda7: nacisk bram z liczonego stanu — G1 > G2 > G3 > G4, rośnie z przepływem i z falą grubości; powłoka pola dociska metal na bramie i sięga do emiterów', () => {
  const P = [];
  for (const q of [0.7, 1, 1.3]) {
    const { line, mill } = steadyLine(q);
    const { st, filler } = stripStations(line, mill);
    const p = Array.from(filler.press);
    P.push(p);
    for (let k = 1; k < 4; k++) assert.ok(p[k] > p[k + 1], `Q ${q}: G${k} ${p[k].toFixed(2)} > G${k + 1} ${p[k + 1].toFixed(2)}`);
    // powłoka pola w strefie bram (rodzaj 4): na płaszczyźnie bramy dociśnięta (b + 3) i z mostem do lica emitera, między
    // bramami luźniejsza; za G4 + 60 j. brak
    for (const s of st) {
      if (s.x > LINIA.gates[4].x + 61) { assert.equal(s.shell, 0, `powłoka za strefą bram (x ${s.x.toFixed(0)})`); continue; }
      if (s.x > LINIA.gates[4].x + 40) continue;            // (powłoka wygasa za G4)
      assert.equal(s.shell, 4, `rodzaj powłoki w strefie bram (x ${s.x.toFixed(0)})`);
      assert.ok(s.sa > s.a + 2.5 && s.sb > s.b + 2.5, `powłoka nad metalem (x ${s.x.toFixed(0)})`);
    }
    const near = (x) => st.reduce((m, s) => (Math.abs(s.x - x) < Math.abs(m.x - x) ? s : m));
    for (let k = 1; k < 5; k++) {
      const g = LINIA.gates[k];
      const at = near(g.x);
      const mid = near(g.x - 40);
      assert.ok(at.sb - at.b < 4, `G${k}: pole dociska metal (warstwa ${(at.sb - at.b).toFixed(1)})`);
      assert.ok(mid.sb - mid.b > 9, `G${k}: między bramami warstwa luźna (${(mid.sb - mid.b).toFixed(1)})`);
      assert.ok(at.sa > Math.max(g.a + 48, 118) - 16, `G${k}: most pola do emitera (${at.sa.toFixed(0)})`);
      assert.ok(at.band > 0.8 * p[k] && at.band > mid.band * 3, `G${k}: pas siły na płaszczyźnie bramy (${at.band.toFixed(2)}, między ${mid.band.toFixed(2)})`);
    }
  }
  for (let k = 0; k < 5; k++) assert.ok(P[0][k] < P[1][k] && P[1][k] < P[2][k], `G${k}: nacisk rośnie z przepływem ${P.map((p) => p[k].toFixed(2))}`);
  // fala grubości (impuls na wylocie) przechodząca przez bramę G2 ściska ją mocniej niż w spoczynku
  const { line, mill } = steadyLine(1);
  const filler = createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  filler.fill(line, mill, 1, DT, out);
  const base = filler.press[2];
  line.kick(0.3, 0.25);
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.tempT] = 1;
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.valve] = 1;
  let peak = 0;
  let carry = 0;
  for (let i = 0; i < 4 * 60; i++) {
    const want = PASMO.qNom * UNITS_PER_TON / 60 + carry;
    inp[LIN_WEJ.units] = Math.floor(want);
    carry = want - inp[LIN_WEJ.units];
    line.step(DT, inp);
    filler.fill(line, mill, 1, DT, out);
    peak = Math.max(peak, filler.press[2]);
  }
  assert.ok(peak > base * 1.05, `fala przez G2: nacisk ${base.toFixed(3)} → ${peak.toFixed(3)}`);
  // pusta linia (zimny start przed pierwszym metalem): bramy bez nacisku
  const cold = createFormingLine({ seed: 3, cold: true });
  const fc = createStationFiller();
  fc.fill(cold, null, 1, DT, out);
  assert.deepEqual(Array.from(fc.press), [0, 0, 0, 0, 0]);
});

test('formowanie/runda7: chłodnice — strumień ciepła paneli z modelu ciepła linii; gorąca strefa paneli idzie z frontem przy większym przepływie, miedź oddaje więcej', () => {
  const center = [];
  const sum = [];
  for (const metal of [0, 1]) {
    for (const q of [0.7, 1, 1.3]) {
      const { line, mill } = steadyLine(q, metal);
      const { filler } = stripStations(line, mill);
      const f = Array.from(filler.chillFlux(line));
      assert.equal(f.length, CHLODNICE.n);
      assert.ok(f.every((v) => Number.isFinite(v) && v >= 0));
      const s = f.reduce((a, b) => a + b, 0);
      // C2 (χ 1,4) bierze mniej niż C1 (χ 2,2 · k_metal)
      assert.ok(f[CHLODNICE.n - 1] < Math.max(...f.slice(0, CHLODNICE.n - 2)) * 0.6, 'C2 bierze mniej niż C1');
      center.push(f.reduce((a, v, i) => a + v * i, 0) / s);
      sum.push(s);
    }
  }
  for (const m of [0, 3]) assert.ok(center[m] < center[m + 1] && center[m + 1] < center[m + 2], `środek strumienia przesuwa się z przepływem ${center.slice(m, m + 3).map((c) => c.toFixed(2))}`);
  for (let k = 0; k < 3; k++) assert.ok(sum[3 + k] > 1.5 * sum[k], `miedź oddaje więcej ciepła panelom (${sum[3 + k].toFixed(1)} wobec ${sum[k].toFixed(1)})`);
  // bez metalu pod panelami — zero
  const cold = createFormingLine({ seed: 3, cold: true });
  assert.ok(createStationFiller().chillFlux(cold).every((v) => v === 0));
});

test('formowanie/runda7: lico emitera bram i żar paneli w materiale otoczenia (WGSL w Node, 12 × vec4 kanałów pola); stacje z naciskiem i strumień chłodnic bez alokacji', async () => {
  const THREE = await import('three/webgpu');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { LiniaObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazLinii.js');
  const sim = createMeltChamber({ seed: 7 });
  const o = new WytopObraz({ root: new THREE.Group(), sim });
  const z = new ZlozenieObraz({ root: new THREE.Group(), U: o.U });
  assert.equal(z.OU.pole.array.length, 12, 'kanały pola: 16 linii + 4 walcowni + 12 przedziałów ciepła paneli + 16 dzielenia (runda 8)');
  assert.ok(CHLODNICE.kanal >= 20 && CHLODNICE.kanal + CHLODNICE.n <= 32);
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const b = renderer.backend.createNodeBuilder(z.mesh, renderer);
  b.material = z.mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = z.mesh.material;
  b.build();
  const code = b.vertexShader + b.fragmentShader;
  assert.ok(!/NaN|undefined/.test(code));
  for (const m of code.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) assert.ok(Number(m[1]) < Number(m[2]), `odwrócony smoothstep ${m[0]}`);
  // klatka obrazu: kanały ciepła paneli z linii (pierwsza klatka — od razu strumień; dalej bezwładność w czasie linii)
  const l = new LiniaObraz({ root: new THREE.Group(), U: o.U, zl: z });
  const { line, mill } = steadyLine(1, 0, 25);
  l.frame(line, mill, 1, DT, DT);
  const want = Array.from(l.filler.chillFlux(line));
  for (let i = 0; i < CHLODNICE.n; i++) assert.ok(Math.abs(l.str[CHLODNICE.kanal + i] - want[i]) < 1e-5, 'pierwsza klatka — ciepło paneli = strumień');
  assert.ok(l.str[POLE_K.G1] > l.str[POLE_K.G4], 'emiter G1 jaśniejszy niż G4 (większy nacisk)');
  // bez alokacji (świeże egzemplarze modułów — jedna linia, jak na stronie dema)
  const freshL = await import('../dema/ring-dzielnice/huta/formowanie/linia.js?runda7');
  const freshSt = await import('../dema/ring-dzielnice/huta/formowanie/stacje.js?runda7');
  const ln = freshL.createFormingLine({ seed: 9 });
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.head] = 200;
  inp[LIN_WEJ.tempT] = 0.95;
  const filler = freshSt.createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  const step = (i) => { inp[LIN_WEJ.units] = (i % 240) < 120 ? 600 : 0; ln.step(DT, inp); };
  const warm = () => { for (let i = 0; i < 600; i++) { step(i); filler.fill(ln, null, 0.5, DT, out); filler.chillFlux(ln); } };
  warm();
  const per = await untilSteady(() => allocatedBytes(() => { filler.fill(ln, null, 0.5, DT, out); filler.chillFlux(ln); }, 60), (v) => v < 8192, { warm, rounds: 60, pauseMs: 50 });
  assert.ok(per < 8192, `stacje (z naciskiem bram) i strumień chłodnic alokują ${per} B na 60 klatek`);
});

// ===================================================================================================================
// Runda 7, etap „Poprawki”: ugięcie lica pod bramą z nacisku, lico panelu chłodnicy z przejmowania ciepła, skorupa
// ===================================================================================================================

test('formowanie/poprawki r7: pod bramą G1–G4 lico ugięte (wgniecenie ∝ nacisk, spiętrzenie przed bramą), przekrój w fizyce bez zmian', async () => {
  const { GATE_DENT } = await import('../dema/ring-dzielnice/huta/formowanie/stacje.js');
  assert.ok(GATE_DENT > 0.1 && GATE_DENT < 0.4);
  const { line, mill } = steadyLine(1);
  const { st, filler } = stripStations(line, mill);
  const p = Array.from(filler.press);
  const near = (x) => st.reduce((m, s) => (Math.abs(s.x - x) < Math.abs(m.x - x) ? s : m));
  const rel = [];
  for (let k = 1; k < 5; k++) {
    const g = LINIA.gates[k].x;
    const at = near(g);
    const up = near(g - 15);
    const dn = near(g + 14);
    assert.ok(at.b < up.b && at.b < dn.b, `G${k}: lico ugięte na płaszczyźnie bramy (b ${at.b.toFixed(1)}; przed ${up.b.toFixed(1)}, za ${dn.b.toFixed(1)})`);
    rel.push(1 - at.b / (0.5 * (up.b + dn.b)));
  }
  assert.ok(rel[0] > rel[3], `wgniecenie rośnie z naciskiem (G1 ${rel[0].toFixed(3)}, G4 ${rel[3].toFixed(3)}; nacisk ${p.slice(1).map((v) => v.toFixed(2))})`);
  // fizyka linii bez zmian: wgniecenie jest obrazem (stany plastrów nietknięte przez wypełnianie stacji)
  const h0 = line.hash();
  createStationFiller().fill(line, mill, 1, DT, new Float32Array(STACJE.n * STACJE.stride));
  assert.equal(line.hash(), h0);
});

test('formowanie/poprawki r7: lico panelu chłodnicy z przejmowania ciepła do chłodziwa — miedź nie jest ~3× jaśniejsza od stali; stal bez zmian', async () => {
  const THREE = await import('three/webgpu');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { LiniaObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazLinii.js');
  const sim = createMeltChamber({ seed: 7 });
  const o = new WytopObraz({ root: new THREE.Group(), sim });
  const heat = [];
  const flux = [];
  for (const metal of [0, 1]) {
    const z = new ZlozenieObraz({ root: new THREE.Group(), U: o.U });
    const l = new LiniaObraz({ root: new THREE.Group(), U: o.U, zl: z });
    const { line, mill } = steadyLine(1, metal, 25);
    l.frame(line, mill, 1, DT, DT);
    let s = 0;
    for (let i = 0; i < CHLODNICE.n; i++) s += l.str[CHLODNICE.kanal + i];
    heat.push(s);
    flux.push(Array.from(l.filler.chillFlux(line)).reduce((a, b) => a + b, 0));
    assert.equal(l.LM.gate.value.y, 1, 'skorupa włączona domyślnie');
  }
  assert.ok(flux[1] > 1.5 * flux[0], 'miedź oddaje panelom więcej ciepła (strumień)');
  assert.ok(heat[1] > 0.4 * heat[0] && heat[1] < 1.5 * heat[0], `żar lica paneli: stal ${heat[0].toFixed(1)}, miedź ${heat[1].toFixed(1)}`);
});

// ===================================================================================================================
// Etap „Struga” (2026-11-18): ogon spływu płynny (słowa użytkownika: „jak strumień jest mniejszy, zaczyna »szaleć« i leci,
// cofa się, leci, cofa się — powinno to być »płynne«”) i wejście strugi w błonę (zlanie na widocznej powierzchni)
// ===================================================================================================================

/**
 * Jeden obieg z prawdziwą komorą i zaworem dyszy (jak strona dema), z obrazem strugi co krok strony: `cb(rec)` dostaje
 * rekord kroku { t, du, pipe, jet, lipOut [t/s] (metal przez wargę w tym kroku), end (koniec strugi w obrazie: największe
 * s żywej stacji strugi; −1 — brak), start (najmniejsze s żywej stacji), rAt(s) (promień w stacji najbliższej s), spout,
 * want, stan, entry }. Kończy po pierwszym spływie (rura, struga puste, zawór zamknięty).
 */
function runRealDump(cb, maxSeconds = 160) {
  const sim = createMeltChamber({ seed: 7, prewarm: true });
  const S = sim.view.stan;
  const C = sim.counters;
  const valve = createNozzleValve();
  const line = createFormingLine({ seed: 11 });
  const LC = line.counters;
  const inp = new Float64Array(LIN_WEJ_N);
  const last = { v: C[LICZNIK.delivered] };
  const filler = createStationFiller();
  const out = new Float32Array(STACJE.n * STACJE.stride);
  let pipePrev = 0;
  let started = false;
  const rAt = (s) => {
    let best = -1;
    let bd = 1e9;
    for (let q = STACJE.jet.i0; q < STACJE.jet.i0 + STACJE.jet.n; q++) { const d = Math.abs(out[q * STACJE.stride + 3] - s); if (d < bd) { bd = d; best = q; } }
    return out[best * STACJE.stride + 4];
  };
  for (let i = 0; i < maxSeconds * 60; i++) {
    sim.step(DT);
    valve.step(DT, S[STAN.impactT], C[LICZNIK.funnel]);
    feedFromChamber(sim, inp, last);
    inp[LIN_WEJ.valve] = valve.state.open;
    line.step(DT, inp);
    const a = line.audit();
    if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`bilans linii ${a.balance}, niezgodność ${a.mismatch} w kroku ${i}`);
    const pipe = LC[LIN_LICZNIK.pipe];
    const jet = LC[LIN_LICZNIK.jet];
    const lipOut = (inp[LIN_WEJ.units] - (pipe - pipePrev)) * 60 / UNITS_PER_TON;
    pipePrev = pipe;
    if (inp[LIN_WEJ.units] > 0) started = true;
    if (!started) continue;
    filler.fill(line, null, 0, DT, out);
    let end = -1;
    let start = 1e9;
    for (let q = STACJE.jet.i0; q < STACJE.jet.i0 + STACJE.jet.n; q++) {
      const r = q * STACJE.stride;
      if (out[r + 4] > 0.05) { end = Math.max(end, out[r + 3]); start = Math.min(start, out[r + 3]); }
    }
    cb({ t: i * DT, i, du: inp[LIN_WEJ.units], pipe, jet, lipOut, end, start, rAt, spout: line.stan[LIN_STAN.spout], want: line.stan[LIN_STAN.spoutWant], stan: line.stan, entry: filler.entry, out });
    if (pipe === 0 && jet === 0 && inp[LIN_WEJ.units] === 0 && line.stan[LIN_STAN.spout] === 0) return line;
  }
  assert.fail('obieg nie skończył się w czasie');
}

test('formowanie/struga: ogon spływu płynny — wypływ na wylewce nie rośnie, koniec strugi przy błonie nie cofa się i nie skacze, zawór zamyka się raz; bilans 0', () => {
  const rec = [];
  runRealDump((r) => rec.push({ t: r.t, du: r.du, pipe: r.pipe, jet: r.jet, lipOut: r.lipOut, end: r.end, start: r.start, spout: r.spout, want: r.want, q: r.stan[LIN_STAN.lipQ], v: r.stan[LIN_STAN.lipV] }));
  // OGON: od chwili, gdy dopływ z gardzieli spada poniżej 0,7 szczytu (lej się opróżnia), do pustej rury i strugi
  const peak = Math.max(...rec.map((r) => r.du));
  const i0 = rec.findIndex((r, i) => i > 0 && rec[i - 1].du >= 0.7 * peak && r.du < 0.7 * peak);
  assert.ok(i0 > 0, 'spływ ma ogon');
  const iEnd = rec.findIndex((r, i) => i > i0 && r.pipe === 0 && r.jet === 0);
  assert.ok(iEnd > i0, 'ogon się kończy');
  // (1) wypływ przez wargę wylewki w ogonie nierosnący (metal oddawany w kroku strony; ± 1 jedn. w kroku — 0,04 t/s)
  let rise = 0;
  let riseAt = -1;
  for (let i = i0 + 1; i < iEnd; i++) {
    const d = rec[i].lipOut - rec[i - 1].lipOut;
    if (d > rise) { rise = d; riseAt = i; }
  }
  assert.ok(rise <= 0.25, `wypływ na wylewce w ogonie rośnie o ${rise.toFixed(2)} t/s na krok (t = ${riseAt >= 0 ? rec[riseAt].t.toFixed(2) : '-'} s)`);
  // (2) koniec strugi w obrazie (przy błonie): póki rura oddaje metal — nie cofa się i nie skacze (± 6 j. na krok strony)
  let back = 0;
  let jump = 0;
  for (let i = i0 + 1; i < iEnd; i++) {
    if (rec[i].pipe === 0 || rec[i - 1].end < 0 || rec[i].end < 0) continue;
    const d = rec[i].end - rec[i - 1].end;
    back = Math.max(back, -d);
    jump = Math.max(jump, Math.abs(d));
  }
  assert.ok(back <= 6 && jump <= 6, `koniec strugi w ogonie: cofa się o ${back.toFixed(0)} j., skacze o ${jump.toFixed(0)} j. na krok`);
  // (3) struga cienieje i zwalnia w sposób ciągły: wypływ przez wargę (przekrój strugi = wypływ / prędkość) i prędkość
  // metalu na wardze w ogonie nie rosną; zmiana na krok strony ograniczona (bez skoków)
  let qUp = 0;
  let vUp = 0;
  let qStep = 0;
  for (let i = i0 + 1; i < iEnd; i++) {
    if (rec[i].pipe === 0) continue;
    qUp = Math.max(qUp, rec[i].q - rec[i - 1].q);
    vUp = Math.max(vUp, rec[i].v - rec[i - 1].v);
    qStep = Math.max(qStep, Math.abs(rec[i].q - rec[i - 1].q));
  }
  assert.ok(qUp <= 1e-9, `wypływ przez wargę w ogonie rośnie o ${qUp.toFixed(4)} t/s na krok`);
  // (prędkość wylotu z gardzieli niesie drobne drgania jeziora w leju — tolerancja 0,5 j./s na krok przy ~600 j./s)
  assert.ok(vUp <= 0.5, `prędkość na wardze w ogonie rośnie o ${vUp.toFixed(3)} j./s na krok`);
  assert.ok(qStep <= 1, `wypływ przez wargę zmienia się skokiem o ${qStep.toFixed(2)} t/s na krok strony`);
  // (4) urwanie: po opróżnieniu rury górny koniec strugi jedzie tylko w dół drogi (do błony), aż struga zniknie
  const iDry = rec.findIndex((r, i) => i > i0 && r.pipe === 0);
  for (let i = iDry + 1; i < rec.length; i++) {
    if (rec[i].end < 0) break;
    assert.ok(rec[i].start >= rec[i - 1].start - 1e-6, `ogon strugi po urwaniu cofa się (t = ${rec[i].t.toFixed(2)} s)`);
  }
  // (5) zawór wylewki: otwiera się i zamyka dokładnie raz na obieg
  let opens = 0;
  let closes = 0;
  for (let i = 1; i < rec.length; i++) {
    if (rec[i].want === 1 && rec[i - 1].want === 0) opens++;
    if (rec[i].want === 0 && rec[i - 1].want === 1) closes++;
  }
  assert.ok(opens <= 1 && closes === 1, `zawór: otwarcia ${opens}, zamknięcia ${closes}`);
  assert.ok(rec[rec.length - 1].spout === 0, 'zawór zamknięty po spływie');
});

test('formowanie/struga: wejście w błonę na widocznej powierzchni metalu — stopa zlania, bez czubka nad powierzchnią i bez przebicia przez metal', () => {
  let n = 0;
  let worstAbove = 0;
  let worstBelow = 0;
  let worstFoot = 1e9;
  runRealDump((r) => {
    const L = r.stan;
    if (!(L[LIN_STAN.landed] > 0) || r.pipe === 0) return;
    const E = r.entry;
    if (!(E[1] > 3)) return;
    n++;
    // koniec strugi leży tuż pod widoczną powierzchnią (zanurzenie ≤ ~1,3 r), nie wisi nad nią
    worstAbove = Math.max(worstAbove, E[0] - r.end);
    worstBelow = Math.max(worstBelow, r.end - E[0] - 1.3 * E[1]);
    // przy powierzchni struga rozszerza się w stopę (promień na wejściu > promień 2,5 r wyżej)
    const rFoot = r.rAt(E[0]);
    const rUp = r.rAt(E[0] - 2.5 * E[1]);
    if (rUp > 0) worstFoot = Math.min(worstFoot, rFoot / rUp);
  });
  assert.ok(n > 200, `kroków ze strugą w błonie ${n}`);
  assert.ok(worstAbove <= 3, `koniec strugi nad powierzchnią o ${worstAbove.toFixed(1)} j.`);
  assert.ok(worstBelow <= 3, `struga przebija metal o ${worstBelow.toFixed(1)} j. głębiej niż 1,3 r`);
  assert.ok(worstFoot >= 1.3, `stopa zlania: promień przy powierzchni ${worstFoot.toFixed(2)} × promień wyżej`);
});

test('formowanie/struga: rura spustowa — kolumna nie rozrywa się, wypływ z wypełnienia (pełna rura = pełny spływ), czoło spływu cienką strugą', () => {
  const qs = [];
  let maxPipe = 0;
  let firstLip = -1;
  runRealDump((r) => {
    const L = r.stan;
    maxPipe = Math.max(maxPipe, r.pipe);
    if (firstLip < 0 && L[LIN_STAN.lipQ] > 0) firstLip = L[LIN_STAN.lipQ];
    if (L[LIN_STAN.pipeOn] > 0) qs.push(L[LIN_STAN.lipQ]);
  });
  // pierwszy metal na wardze: cienka struga rozruchu (dopływ z gardzieli rośnie od zera)
  assert.ok(firstLip > 0 && firstLip < 3, `pierwszy wypływ przez wargę ${firstLip.toFixed(2)} t/s`);
  // w fazie kolumny wypływ bez przerw do końca (rura nie oddaje „pustych” chwil)
  const gaps = qs.filter((q, i) => i > 0 && i < qs.length - 1 && q === 0).length;
  assert.equal(gaps, 0, 'kolumna oddaje metal bez przerw');
  assert.ok(Math.max(...qs) < 1.15 * 36, `wypływ przez wargę najwyżej ${Math.max(...qs).toFixed(1)} t/s`);
  assert.ok(maxPipe / UNITS_PER_TON < 60, `w rurze najwięcej ${(maxPipe / UNITS_PER_TON).toFixed(1)} t`);
});

test('formowanie/struga (runda 8): pola wzoru płyną wzdłuż strugi — kilka pól naraz, średnia jasność strugi bez skoków (pełny spływ i ogon)', async () => {
  // Model wzoru na CPU (`strugaWzor.js` — te same szumy, stałe i bilans ciepła odcinka co shader metalu), stany stacji
  // z prawdziwej komory, klatki co 1/30 s jak seria zrzutów. Przed rundą 8: na widocznej strudze 1,6 pola (najmniej 1),
  // średnia jasność skakała do 23 % na klatkę i wahała się 0,46…2,05 × średniej — cała struga migała.
  const { STRUGA_WZOR, jetVisibleStats } = await import('../dema/ring-dzielnice/huta/formowanie/strugaWzor.js');
  const res = new Float64Array(4);
  const rows = [];
  runRealDump((r) => {
    if ((r.i & 1) || !(r.stan[LIN_STAN.landed] > 0) || !(r.stan[LIN_STAN.lipQ] > 0)) return;
    jetVisibleStats(r.out, STACJE.jet.i0, STACJE.jet.n, STACJE.stride, r.entry[0], r.stan[LIN_STAN.time], STRUGA_WZOR.zoneK, res);
    rows.push({ full: r.stan[LIN_STAN.lipQ] >= 30, B: res[0], F: res[1], len: res[2] });
  });
  for (const full of [true, false]) {
    const R = rows.filter((r) => r.full === full);
    const tag = full ? 'pełny spływ' : 'ogon';
    assert.ok(R.length > (full ? 100 : 50), `${tag}: klatek ${R.length}`);
    const fAvg = R.reduce((a, r) => a + r.F, 0) / R.length;
    const fMin = Math.min(...R.map((r) => r.F));
    if (full) assert.ok(fAvg >= 3 && fMin >= 2, `${tag}: pól wzoru na widocznej strudze średnio ${fAvg.toFixed(2)}, najmniej ${fMin}`);
    let dMax = 0;
    for (let i = 1; i < R.length; i++) dMax = Math.max(dMax, Math.abs(R[i].B - R[i - 1].B) / (0.5 * (R[i].B + R[i - 1].B)));
    const mB = R.reduce((a, r) => a + r.B, 0) / R.length;
    const lo = Math.min(...R.map((r) => r.B)) / mB;
    const hi = Math.max(...R.map((r) => r.B)) / mB;
    assert.ok(dMax <= 0.08, `${tag}: średnia jasność strugi zmienia się o ${(dMax * 100).toFixed(1)} % na klatkę 1/30 s`);
    assert.ok(lo >= 0.85 && hi <= 1.25, `${tag}: średnia jasność strugi ${lo.toFixed(2)}…${hi.toFixed(2)} × średniej`);
  }
  // shader liczy to samo: pola strugi gęstsze o `zoneK`, średnia po widocznej strudze w etapie wierzchołków (pętla po stacjach)
  const THREE = await import('three/webgpu');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { LiniaObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazLinii.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const root = new THREE.Group();
  const o = new WytopObraz({ root, sim: createMeltChamber({ seed: 7 }) });
  const l = new LiniaObraz({ root, U: o.U, zl: new ZlozenieObraz({ root, U: o.U }) });
  const b = renderer.backend.createNodeBuilder(l.mesh, renderer);
  b.material = l.mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = l.mesh.material;
  b.build();
  const nMean = Math.ceil(STACJE.jet.n / STRUGA_WZOR.meanEvery);
  assert.ok(b.vertexShader.includes(`for ( var zj : i32 = 0; zj < ${nMean}; zj ++ )`), 'średnia pól strugi w etapie wierzchołków');
  // koniec widocznej strugi w uniformie czasu linii (z): wejście strugi w błonę z wypełnienia stacji
  l.frame(createFormingLine({ seed: 5 }), null, 0.5, DT, DT);
  assert.equal(l.LM.time.value.z, l.filler.entry[0]);
});
// ---------------------------------------------------------------------------------------------------------------------
// RUNDA 9, ETAP „CZYSTA STAL” (SPEC § 12.1 H): stacja odzgorzania za F3 i kurtyna osłony (argon) — `odzgorzanie.js`

/** Linia z walcownią i dzieleniem, wymuszony przepływ q (× Q_nom), `seconds` s po rozbiegu strony; `cb` po każdym kroku. */
function cleanRig(q, metal, seconds, { descale = true, cb = null } = {}) {
  const mill = createRollingMill();
  const div = createDivider({});
  const line = createFormingLine({ seed: 11, metal, kin: mill, divider: div, descale });
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.tempT] = 1;
  inp[LIN_WEJ.metal] = metal;
  line.setQ(q);
  for (let i = 0; i < seconds * 60; i++) { line.step(DT, inp); if (cb) cb(line, div, i); }
  return { line, mill, div };
}
/** ξ ważone masą plastrów ciała stałego ze środkiem w [a, b). */
function xiBand(line, a, b) {
  const SL = line.view.slices;
  let sx = 0; let m = 0;
  for (let i = 0; i < line.view.ring[1]; i++) {
    const o = line.sliceOffset(i);
    const c = 0.5 * (SL[o + PL.s] + line.sliceTop(i));
    if (c >= a && c < b && SL[o + PL.fs] >= 0.999 && SL[o + PL.tail] === 0) { sx += SL[o + PL.xi] * SL[o + PL.m]; m += SL[o + PL.m]; }
  }
  return m > 0 ? sx / m : NaN;
}
/** Rekord ciała dzielenia (`dzielenie/model.js`): krok, stan (0 — wolne), ξ, wiek. */
const ARK_REC = Object.freeze({ n: 46, cap: 96, st: 0, xi: 20, age: 39 });

test('formowanie/czysta stal: tlenek za stacją odzgorzania < 0,005 przy 0,7 / 1 / 1,4 Q (stal) i 0,7 / 1 / 1,3 Q (miedź); arkusze czyste; sprawność maleje z prędkością', () => {
  for (const metal of [0, 1]) {
    const qs = metal ? [0.7, 1.0, 1.3] : [0.7, 1.0, 1.4];
    const keep = [];
    for (const q of qs) {
      const sheets = [];
      const { line } = cleanRig(q, metal, 16, {
        cb: (l, div, i) => {
          if (i < 8 * 60) return;
          const B = div.view.bodies;
          for (let k = 0; k < ARK_REC.cap; k++) { const o = k * ARK_REC.n; if (B[o + ARK_REC.st] !== 0 && B[o + ARK_REC.age] < DT * 0.99) sheets.push(B[o + ARK_REC.xi]); }
        }
      });
      const id = `${metal ? 'miedź' : 'stal'} ${q}`;
      const before = xiBand(line, LINIA.stands[2].x + 20, OZ_X0);
      const after = xiBand(line, OZ_X1 + 20, XB - 20);
      assert.ok(before > 0.03, `${id}: przed stacją taśma z tlenkiem (ξ ${before})`);
      assert.ok(after < 0.005, `${id}: za stacją ξ ${after}`);
      assert.ok(sheets.length >= 1, `${id}: arkusze odcięte w próbie (${sheets.length})`);
      for (const x of sheets) assert.ok(x < 0.005, `${id}: arkusz przy cięciu ξ ${x}`);
      assert.ok(Math.abs(line.stan[LIN_STAN.odzU] - 1) < 1e-3, 'stacja pracuje pełną mocą pod taśmą');
      keep.push(after / before);
    }
    assert.ok(keep[0] < keep[1] && keep[1] < keep[2], `sprawność maleje z prędkością taśmy: ${keep.map((k) => k.toExponential(2))}`);
  }
  // rachunek strefy: udział, który zostaje = exp(−k · wf / v); profil ciągły, 1 przed strefą, wynik za strefą
  assert.ok(Math.abs(descaleKeep(334) - Math.exp(-ODZG.k * ODZG.wf / 334)) < 1e-12);
  assert.ok(descaleKeep(468) < 0.03 && descaleKeep(234) < 1e-3);
  assert.equal(descaleProfile(OZ_X0 - 1, 334), 1);
  assert.ok(Math.abs(descaleProfile(OZ_X1 + 30, 334) - descaleKeep(334)) < 1e-12);
  for (let x = OZ_X0; x < OZ_X1; x += 0.5) assert.ok(descaleProfile(x + 0.5, 334) <= descaleProfile(x, 334) && descaleProfile(x + 0.5, 334) > descaleProfile(x, 334) * 0.8);
});

test('formowanie/czysta stal: pod osłoną (za strefą stacji) tlenek nie rośnie — bez stacji (A/B) rośnie do noża', () => {
  for (const descale of [true, false]) {
    const seen = new Map();
    let grew = 0;
    let checked = 0;
    cleanRig(1.0, 0, 6, {
      descale,
      cb: (line) => {
        const SL = line.view.slices;
        for (let i = 0; i < line.view.ring[1]; i++) {
          const o = line.sliceOffset(i);
          if (SL[o + PL.tail] !== 0 || SL[o + PL.fs] < 0.999) continue;
          const c = 0.5 * (SL[o + PL.s] + line.sliceTop(i));
          const key = SL[o + PL.m0];
          if (c <= OZ_X1 + 1 || c > XB - 2) { seen.delete(key); continue; }
          const prev = seen.get(key);
          if (prev !== undefined) { checked++; if (SL[o + PL.xi] > prev + 1e-12) grew++; }
          seen.set(key, SL[o + PL.xi]);
        }
      }
    });
    assert.ok(checked > 2000, `sprawdzone przejścia plastrów (${checked})`);
    if (descale) assert.equal(grew, 0, 'za strefą stacji (osłona argonu) ξ plastra stoi');
    else assert.ok(grew > checked * 0.9, `bez stacji i osłony tlenek rośnie aż do noża (${grew} / ${checked})`);
  }
});

test('formowanie/czysta stal: bilans 0 po każdym podkroku z kontem zgorzeliny (stal, miedź); konto = zdjęta masa co do jednostki; obraz frontu', () => {
  for (const metal of [0, 1]) {
    const mill = createRollingMill();
    const div = createDivider({});
    const line = createFormingLine({ seed: 11, metal, kin: mill, divider: div });
    const inp = new Float64Array(LIN_WEJ_N);
    inp[LIN_WEJ.tempT] = 1;
    inp[LIN_WEJ.metal] = metal;
    const S = line.stan;
    const C = line.counters;
    const c0 = C[LIN_LICZNIK.scale];
    const t0 = S[LIN_STAN.odzTot];
    for (let i = 0; i < 6 * 240; i++) {
      line.step(1 / 240, inp);
      const a = line.audit();
      if (a.balance !== 0 || a.mismatch !== 0) assert.fail(`bilans ${a.balance}, niezgodność ${a.mismatch} w podkroku ${i}`);
      const da = div.audit();
      if (da.balance !== 0) assert.fail(`bilans dzielenia ${da.balance} w podkroku ${i}`);
    }
    assert.ok(Number.isInteger(C[LIN_LICZNIK.scale]));
    assert.ok(C[LIN_LICZNIK.scale] - c0 > 20, `konto zgorzeliny rośnie (${C[LIN_LICZNIK.scale] - c0} jedn. w 6 s)`);
    // konto (całe jednostki) + ułamek w plastrach = zdjęta masa narastająco
    assert.ok(Math.abs(C[LIN_LICZNIK.scale] + S[LIN_STAN.odzAcc] - S[LIN_STAN.odzTot]) < 1e-6);
    assert.ok(S[LIN_STAN.odzAcc] >= 0 && S[LIN_STAN.odzAcc] < 1);
    // strumień: 0,05–0,6 % przepływu metalu (zgorzelina wtórna walcowni gorącej 0,1–0,5 %)
    const rate = (S[LIN_STAN.odzTot] - t0) / UNITS_PER_TON / 6;
    const flow = S[LIN_STAN.Q];
    assert.ok(rate > 0.0005 * flow && rate < 0.006 * flow, `${metal ? 'miedź' : 'stal'}: zdjęto ${(rate * 1000).toFixed(1)} kg/s przy ${flow.toFixed(2)} t/s`);
    assert.equal(line.tons().zgorzelina, C[LIN_LICZNIK.scale] / UNITS_PER_TON);
    // OBRAZ: front czyszczenia w stacjach pasma — przed strefą ξ łuski, za nią reszta (gęste stacje co 2 j.)
    const out = new Float32Array(STACJE.n * STACJE.stride);
    createStationFiller().fill(line, mill, 0, DT, out);
    const pre = [];
    const post = [];
    for (let q = STACJE.strip.i0; q < STACJE.n; q++) {
      const r = q * STACJE.stride;
      if (out[r + 7] < 2.5) continue;
      const x = out[r];
      if (x > OZ_X0 - 12 && x < OZ_X0) pre.push(out[r + 11]);
      if (x > OZ_X1 && x < OZ_X1 + 40) post.push(out[r + 11]);
    }
    assert.ok(pre.length >= 4 && post.length >= 10, `stacje gęsto wokół stacji odzgorzania (${pre.length}, ${post.length})`);
    assert.ok(pre.every((v) => v > 0.02), `przed strefą łuska (${pre.map((v) => v.toFixed(3))})`);
    assert.ok(post.every((v) => v < 0.004), `za strefą czysto (${post.map((v) => v.toFixed(4))})`);
  }
});

test('formowanie/czysta stal: płatki i pył ze stacji — ilość z masy zdjętej, górne do ssaw odciągu; bez NaN', () => {
  const mill = createRollingMill();
  const line = createFormingLine({ seed: 11, metal: 0, kin: mill });
  const debris = createScaleDebris(31);
  const inp = new Float64Array(LIN_WEJ_N);
  inp[LIN_WEJ.tempT] = 1;
  debris.step(DT, mill, line);
  const t0 = line.stan[LIN_STAN.odzTot];
  const b0 = debris.counts[4];
  for (let i = 0; i < 4 * 60; i++) { line.step(DT, inp); debris.step(DT, mill, line); }
  const d = line.stan[LIN_STAN.odzTot] - t0;
  const born = debris.counts[4] - b0;
  const per = ODZ_DEB.flakes + ODZ_DEB.sparks + ODZ_DEB.dust;
  assert.ok(born > 100, `cząstki ze stacji (${born})`);
  assert.ok(Math.abs(born - d * per) <= 3, `liczba cząstek = masa zdjęta × ${per} (${born} vs ${(d * per).toFixed(1)})`);
  assert.ok(debris.counts[3] > 0.3 * born, `płatki i pył w ssawach odciągu (${debris.counts[3]} z ${born})`);
  for (let q = 0; q < debris.count * ZGORZ.stride; q++) assert.ok(Number.isFinite(debris.data[q]), 'NaN w rekordach');
});

test('formowanie/czysta stal: plazma stacji — WGSL w Node bez NaN, uniformy od zer; bryły stacji i kurtyny poza drogą taśmy', async () => {
  const THREE = await import('three/webgpu');
  const { WytopObraz } = await import('../dema/ring-dzielnice/huta/wytop/obraz.js');
  const { ZlozenieObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazZlozenia.js');
  const { LiniaObraz } = await import('../dema/ring-dzielnice/huta/formowanie/obrazLinii.js');
  const { Budowniczy } = await import('../dema/ring-dzielnice/huta/wytop/wyposazenie.js');
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const root = new THREE.Group();
  const o = new WytopObraz({ root, sim: createMeltChamber({ seed: 7 }) });
  const l = new LiniaObraz({ root, U: o.U, zl: new ZlozenieObraz({ root, U: o.U }) });
  assert.deepEqual(l.OZ.A.value.toArray(), [0, 0, 0, 0]);
  assert.deepEqual(l.OZ.B.value.toArray(), [0, 0, 0, 0]);
  const b = renderer.backend.createNodeBuilder(l.descale, renderer);
  b.material = l.descale.material; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = l.descale.material;
  b.build();
  assert.ok(!/NaN|undefined/.test(b.vertexShader + b.fragmentShader) && b.fragmentShader.length > 1000);
  assert.ok(l.descale.material.transparent && l.descale.material.depthWrite === false && l.descale.material.forceSinglePass);
  // bryły: stacja i kurtyna poza drogą taśmy (nad licem ≥ 15 j., pod spodem ≥ 5 j.), wszystko za klatką F3
  const B = new Budowniczy(60000);
  buildDescaler(B, { frames: [] });
  assert.ok(B.n > 1000 && !B.over);
  for (let i = 0; i < B.n; i++) {
    const x = B.pos[i * 3]; const y = B.pos[i * 3 + 1]; const z = B.pos[i * 3 + 2];
    if (Math.abs(z) < 100.5 && x > OZ_X0 - 30 && x < ODZG.tower.x1 + 5) assert.ok(y > HALA.passY + 4.5 + 15 || y < HALA.passY - 4.5 - 5, `bryła stacji na drodze taśmy: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
    assert.ok(x > LINIA.stands[2].x + 70, `bryły stacji za klatką F3 (${x.toFixed(1)})`);
  }
});
