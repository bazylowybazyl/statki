// Budowle doków portów bez ringu (E14: krzyż, okrąg, koło z wlotem) jako DANE instancji — bez Three (testy node
// czytają je wprost). Ten sam rejestrator i shader co budowle portowe Z7 i baza piratów (portBuildingScene.js /
// portBuildings3D.js): zestawy BG (pod statkami) i FG (nadbudówki, maszty — nad statkami), płyty, lampy, grupy.
//
// Geometria z `src/3d/portDocks/portDockLayout.js` (ta sama, z której gra liczy kolizje, a bańka ścieżki) — lite
// części (piasta, ramiona, obręcz, ściana koła) leżą DOKŁADNIE na wielokątach `solids`. Układ lokalny doku (u, v)
// = gra obrócona o kąt doku; układ budowli: x = −v, z = u (ramka `portModuleFrame(x, −y, −kąt)` ma wyznacznik +1 —
// pułapka 37), kurs lokalny h → obrót bryły −(h + π/2). Wysokości jak w K-7 (y nad pokładem; płaszczyzna gry
// y = 116 = z świata 0; nad nią ×0,42), materiały = kody K7_MAT (paleta ze stylu frakcji), emisja HDR 14–18.
//
// Lite części PRZECHODZĄ przez płaszczyznę gry (korpus pod nią w BG, wierzch tuż nad nią); kadłuby na stanowiskach
// (z ∈ [−68, 0]) stoją obok — rękaw i kleszcze sięgają dziobu, znaczniki pól leżą pod kadłubami (widać puste pole).
// Obraca się tylko piasta koła (grupa `rig.hubGroup`, macierz obrotu wokół osi pionowej co klatkę — PortDock3D).
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { PB_FX, PB_MAT, PB_MAX_LAMPS, PortRecorder, pbPlate, pbHash1 } from './portBuildingScene.js';

const M = PB_MAT;
const TAU = Math.PI * 2;

/** Wysokości (K-7) części doku. */
export const PORT_DOCK_HEIGHTS = Object.freeze({
  bodyBottom: -110,   // spód korpusu ramion, obręczy, ściany
  deckTop: 150,       // wierzch pokładu (z ≈ +14 — tuż nad kadłubami)
  wallTop: 236,       // wierzch ściany koła (z ≈ +50)
  gear: 82,           // rękaw do dziobu (pod płaszczyzną, na wysokości kadłuba)
  marker: 26,         // znaczniki pól (pod kadłubami)
  lane: 30,           // światła pasów i alei (pod kadłubami)
  towerTop: 300       // nadbudówki piast (z ≈ +77; kamera gry wisi ~535 j. nad z = 0)
});
const H = PORT_DOCK_HEIGHTS;

// ---------------------------------------------------------------------------
// Układ doku (u, v) → budowla (x, z)

const B = (u, v) => [-v, u];
const rotH = (h) => -(h + Math.PI / 2);

function boxUV(f, u, v, y, len, h, wid, mat, heading) {
  f.box(-v, y, u, len, h, wid, mat, rotH(heading));
}
function segUV(f, u0, v0, u1, v1, y, h, wid, mat) {
  const len = Math.hypot(u1 - u0, v1 - v0);
  if (len < 0.5) return;
  boxUV(f, (u0 + u1) / 2, (v0 + v1) / 2, y, len, h, wid, mat, Math.atan2(v1 - v0, u1 - u0));
}
function cylUV(f, u, v, y, r, h, mat) {
  f.cyl(-v, y, u, r, h, mat);
}
/** Pozioma rura wzdłuż kursu h (układ doku). */
function pipeUV(f, u, v, y, r, len, mat, heading) {
  f.cyl(-v, y, u, r, len, mat, [0, rotH(heading), Math.PI / 2]);
}
function plateUV(plates, pts, bottom, height, mat, set = 'bg') {
  pbPlate(plates, pts.map(([u, v]) => B(u, v)), bottom, height, mat, set);
}
/** Wielokąt wypukły ściśnięty ku środkowi ciężkości o `d` j. (wierzch pokładu w obrysie korpusu). */
function inset(pts, d) {
  let cu = 0;
  let cv = 0;
  for (const [u, v] of pts) { cu += u; cv += v; }
  cu /= pts.length;
  cv /= pts.length;
  return pts.map(([u, v]) => {
    const du = u - cu;
    const dv = v - cv;
    const l = Math.hypot(du, dv) || 1;
    const k = Math.max(0, l - d) / l;
    return [cu + du * k, cv + dv * k];
  });
}
/** Pierścień prostopadłościanów (układ doku): promień środka r, grubość d, kąty a0..a1, n segmentów (zachodzą). */
function arcBoxes(f, r, d, y, h, a0, a1, n, mat, skip = null) {
  const da = (a1 - a0) / n;
  const len = 2 * (r + d / 2) * Math.tan(Math.abs(da) / 2) * 1.04;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k + 0.5) * da;
    if (skip && skip(a)) continue;
    boxUV(f, Math.cos(a) * r, Math.sin(a) * r, y, len, h, d, mat, a + Math.PI / 2);
  }
}
/** Pasy ostrzegawcze (żółto-czarne) wzdłuż odcinka. */
function hazardUV(f, u0, v0, u1, v1, y, wid) {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const n = Math.max(2, Math.round(len / (wid * 0.9)));
  const h = Math.atan2(v1 - v0, u1 - u0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    boxUV(f, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, y, (len / n) * 0.52, 1.6, wid, i % 2 ? M.black : M.yellow, h + 0.5);
  }
}
const dirOf = (h) => [Math.cos(h), Math.sin(h)];

// ---------------------------------------------------------------------------
// Wspólne części

/** Lampa (emiter, pasmo HDR) w punkcie doku. */
function lampUV(f, u, v, y, size, mat, gain = 1.2, mode = PB_FX.steady, phase = 0, param = 0) {
  f.fx(gain, mode, phase, param);
  f.box(-v, y, u, size, size * 0.5, size, mat);
  f.nofx();
}

/**
 * Wyposażenie stanowiska: rękaw z konstrukcji do dziobu, kleszcze na krawędzi, lampa stanowiska na pokładzie
 * i znacznik pola (pod kadłubem — boki zimną farbą, linia stopu żółta). `gap` — konstrukcja → dziób.
 */
function berthGear(f, b, gap, deckTop) {
  const [hx, hy] = dirOf(b.heading);
  const L = b.padLength;
  const W = b.padWidth;
  const nu = b.u + hx * (L / 2);
  const nv = b.v + hy * (L / 2);
  const eu = nu + hx * gap;
  const ev = nv + hy * gap;
  const gw = Math.min(110, W * 0.42);
  // rękaw (od krawędzi konstrukcji do dziobu) i jego pokład
  segUV(f, eu + hx * 40, ev + hy * 40, nu - hx * 12, nv - hy * 12, H.gear, 22, gw, M.dark);
  segUV(f, eu + hx * 30, ev + hy * 30, nu - hx * 6, nv - hy * 6, H.gear + 12, 3, gw - 14, M.floor);
  // kleszcze cumownicze na krawędzi (żółty wierzch)
  boxUV(f, eu, ev, 60, 34, 70, Math.min(W * 0.7, 300), M.steel, b.heading);
  boxUV(f, eu, ev, 97, 30, 4, Math.min(W * 0.66, 290), M.yellow, b.heading);
  // lampa stanowiska na pokładzie konstrukcji (ciepła, stała)
  lampUV(f, eu + hx * 46, ev + hy * 46, deckTop + 12, 18, M.warm, 1.15);
  // znacznik pola: boki i linia stopu przy dziobie
  const sx = -hy;
  const sy = hx;
  for (const s of [-1, 1]) {
    segUV(f, b.u - hx * L * 0.42 + sx * s * W * 0.5, b.v - hy * L * 0.42 + sy * s * W * 0.5,
      nu - hx * 20 + sx * s * W * 0.5, nv - hy * 20 + sy * s * W * 0.5, H.marker, 2, 10, M.paintCold);
  }
  segUV(f, nu - hx * 14 + sx * W * 0.5, nv - hy * 14 + sy * W * 0.5, nu - hx * 14 - sx * W * 0.5, nv - hy * 14 - sy * W * 0.5,
    H.marker, 2, 16, M.yellow);
}

/** Korpus pomostu wzdłuż odcinka: blok (przecina płaszczyznę), wierzch, krawężniki, listwy świetlne, żebra, kratownica. */
function pierBody(f, u0, v0, u1, v1, hw, style, seed) {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const h = Math.atan2(v1 - v0, u1 - u0);
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const nx = -Math.sin(h);
  const ny = Math.cos(h);
  const yc = (H.bodyBottom + H.deckTop) / 2;
  boxUV(f, cu, cv, yc, len, H.deckTop - H.bodyBottom, 2 * hw, M.dark, h);
  boxUV(f, cu, cv, H.deckTop + 3, len - 8, 6, 2 * hw - 36, M.floor, h);
  for (const s of [-1, 1]) {
    boxUV(f, cu + nx * s * (hw - 9), cv + ny * s * (hw - 9), H.deckTop + 10, len, 16, 18, M.rail, h);
    f.fx(1.05, PB_FX.steady);
    boxUV(f, cu + nx * s * (hw + 3), cv + ny * s * (hw + 3), H.deckTop - 24, len - 10, 5, 6, M.cyan, h);
    f.nofx();
  }
  // żebra poprzeczne co ~240 j. i co trzecie z pasami
  let k = 0;
  for (let t = 120; t < len - 60; t += 240, k++) {
    const pu = u0 + Math.cos(h) * t;
    const pv = v0 + Math.sin(h) * t;
    boxUV(f, pu, pv, H.deckTop + 8, 16, 6, 2 * hw - 30, M.dark, h);
    if (k % 3 === 1) boxUV(f, pu + Math.cos(h) * 50, pv + Math.sin(h) * 50, H.deckTop + 7, 60, 2, 2 * hw * 0.5, (k >> 1) % 2 ? M.yellow : M.black, h + 0.5);
    if (style.walls === 'pipes' && k % 2 === 0) pipeUV(f, pu + nx * hw * 0.45, pv + ny * hw * 0.45, H.deckTop + 18, 12, 200, M.copper, h);
    if (style.walls === 'berm' && k % 2 === 0) boxUV(f, pu, pv, H.deckTop + 14, 140, 10, 2 * hw * 0.55, M.orange, h);
  }
  // kratownica pod pokładem (widać w perspektywie przy brzegu kadru)
  boxUV(f, cu, cv, -240, len, 26, Math.min(2 * hw, 90), M.steel, h);
  for (let t = 80; t < len - 120; t += 300) {
    const a = [u0 + Math.cos(h) * t, v0 + Math.sin(h) * t];
    const b = [u0 + Math.cos(h) * (t + 150), v0 + Math.sin(h) * (t + 150)];
    f.beam([B(...a)[0], H.bodyBottom + 10, B(...a)[1]], [B(...b)[0], -228, B(...b)[1]], 18, M.dark);
  }
  void seed;
}

/** Wieża piasty (FG): trzon, pierścień sterowni z oknami, maszt z kogutem przeszkodowym. */
function hubTower(f, cu, cv, r, style, seed) {
  f.set = 'fg';
  cylUV(f, cu, cv, (H.deckTop + H.towerTop) / 2, r, H.towerTop - H.deckTop, M.steel);
  cylUV(f, cu, cv, H.towerTop - 30, r * 1.12, 18, M.pale);
  cylUV(f, cu, cv, H.towerTop - 52, r * 1.06, 20, M.glass);
  cylUV(f, cu, cv, H.towerTop + 4, r * 0.7, 16, M.dark);
  if (style.family === 'radiator') {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      boxUV(f, cu + Math.cos(a) * r * 1.3, cv + Math.sin(a) * r * 1.3, H.towerTop - 70, r * 0.6, 90, 10, M.copper, a);
    }
  }
  cylUV(f, cu, cv, H.towerTop + 60, 10, 110, M.rail);
  lampUV(f, cu, cv, H.towerTop + 118, 16, M.red, 1.7, PB_FX.blink, pbHash1(seed + 0.3), 0.5);
  f.set = 'bg';
}

/** Boja świetlna (pod płaszczyzną — statki przelatują nad nią): słupek i lampa. */
function beaconUV(f, u, v, mat, mode = PB_FX.blink, phase = 0, param = 0.8) {
  cylUV(f, u, v, H.lane - 20, 18, 60, M.dark);
  lampUV(f, u, v, H.lane + 14, 22, mat, 1.5, mode, phase, param);
}

// ---------------------------------------------------------------------------
// Krzyż

function buildCrossScene(f, g, style, plates, lamps) {
  const m = g.model;
  const hw = m.armHalf;
  const hub = g.solids.find((s) => s.tag === 'hub');
  // piasta: korpus (przecina płaszczyznę), wierzch, pasy przy wejściach ramion, wieża
  plateUV(plates, hub.points, H.bodyBottom, H.deckTop - H.bodyBottom, M.dark);
  plateUV(plates, inset(hub.points, 40), H.deckTop, 6, M.floor);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    hazardUV(f, (m.hubHalf - 70) * c - s * hw, (m.hubHalf - 70) * s + c * hw, (m.hubHalf - 70) * c + s * hw, (m.hubHalf - 70) * s - c * hw, H.deckTop + 8, 34);
  }
  hubTower(f, 0, 0, m.hubHalf * 0.42, style, 1);
  for (const [cu, cv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    lampUV(f, cu * (m.hubHalf - 50), cv * (m.hubHalf - 50), H.deckTop + 16, 20, M.white, 1.2);
    if (lamps.length < PB_MAX_LAMPS) lamps.push([-(cv * (m.hubHalf - 50)), k7HeightToZ(260), cu * (m.hubHalf - 50), 1]);
  }
  // ramiona: pomost od piasty do czubka, zakończenie czubka, światła czubka
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const u0 = m.hubHalf - 40;
    pierBody(f, u0 * c, u0 * s, m.armLen * c, m.armLen * s, hw, style, k);
    // czubek: blok cumowniczy (pas MEGA / capital) z pasami
    boxUV(f, (m.armLen - 50) * c, (m.armLen - 50) * s, (H.bodyBottom + H.deckTop + 40) / 2, 100, H.deckTop + 40 - H.bodyBottom, 2 * hw + 40, M.steel, a);
    hazardUV(f, (m.armLen - 30) * c - s * (hw + 10), (m.armLen - 30) * s + c * (hw + 10), (m.armLen - 30) * c + s * (hw + 10), (m.armLen - 30) * s - c * (hw + 10), H.deckTop + 46, 40);
    f.set = 'fg';
    for (const side of [-1, 1]) {
      lampUV(f, (m.armLen - 40) * c - s * side * (hw + 6), (m.armLen - 40) * s + c * side * (hw + 6), H.deckTop + 70, 18,
        side > 0 ? M.green : M.red, 1.6, PB_FX.blink, 0.25 * k, 0.6);
    }
    f.set = 'bg';
    // boje bram grzebieni (wejście alei): para słupków z zielonymi lampami po obu bokach ramienia
    for (const side of [-1, 1]) {
      const y = side * m.aisle;
      for (const o of [-1, 1]) {
        const v = y + o * 300;
        beaconUV(f, m.gateU * c - s * v, m.gateU * s + c * v, M.green, PB_FX.blink, 0.1 * k + (o > 0 ? 0.5 : 0), 0.7);
      }
      // światła alei biegnące ku piaście (wejście)
      const n = Math.max(3, Math.floor((m.gateU - m.firstPad) / 340));
      for (let i = 0; i <= n; i++) {
        const t = m.gateU - (i / n) * (m.gateU - m.firstPad + 200);
        lampUV(f, t * c - s * y, t * s + c * y, H.lane, 14, M.green, 1.1, PB_FX.chase, i / (n + 1), 0.9);
      }
    }
  }
  // stanowiska: wyposażenie przy krawędzi ramienia (grzebienie) albo czubka (capital, MEGA)
  for (const b of g.berths) {
    berthGear(f, b, b.armSide === 0 ? 60 : 30, H.deckTop);
    if (b.armSide === 0) {
      // światła pasa czubka po obu stronach pola (biegną ku czubkowi)
      const [hx, hy] = dirOf(b.heading);
      const sx = -hy;
      const sy = hx;
      const n = 5;
      for (let i = 0; i < n; i++) {
        const t = b.padLength * (0.6 - (i / (n - 1)) * 1.0);
        for (const s of [-1, 1]) {
          lampUV(f, b.u - hx * t + sx * s * (b.padWidth / 2 + 110), b.v - hy * t + sy * s * (b.padWidth / 2 + 110),
            H.lane, 16, M.warm, 1.1, PB_FX.chase, i / n, 0.7);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Okrąg

function buildRoundScene(f, g, style, plates, lamps) {
  const m = g.model;
  const rMid = (m.rim + m.rimInner) / 2;
  const d = m.rim - m.rimInner;
  const n = Math.max(48, Math.min(160, Math.ceil((TAU * m.rim) / 420)));
  const yc = (H.bodyBottom + H.deckTop) / 2;
  // obręcz: korpus, wierzch, krawężniki, listwy (zewnętrzna — cyjan), żebra co ~10°
  arcBoxes(f, rMid, d, yc, H.deckTop - H.bodyBottom, 0, TAU, n, M.dark);
  arcBoxes(f, rMid, d - 34, H.deckTop + 3, 6, 0, TAU, n, M.floor);
  arcBoxes(f, m.rimInner + 10, 18, H.deckTop + 10, 16, 0, TAU, n, M.rail);
  arcBoxes(f, m.rim - 10, 18, H.deckTop + 10, 16, 0, TAU, n, M.rail);
  f.fx(1.05, PB_FX.steady);
  arcBoxes(f, m.rim + 3, 6, H.deckTop - 24, 5, 0, TAU, n, M.cyan);
  f.nofx();
  arcBoxes(f, rMid, Math.min(90, d * 0.5), -240, 26, 0, TAU, Math.ceil(n / 2), M.steel);
  const ribs = Math.max(24, Math.round((TAU * m.rim) / 700));
  for (let k = 0; k < ribs; k++) {
    const a = (k / ribs) * TAU;
    boxUV(f, Math.cos(a) * rMid, Math.sin(a) * rMid, H.deckTop + 8, d - 30, 6, 16, M.dark, a);
    if (style.walls === 'pipes' && k % 2 === 0) pipeUV(f, Math.cos(a + 0.01) * (m.rimInner + 60), Math.sin(a + 0.01) * (m.rimInner + 60), H.deckTop + 18, 12, 260, M.copper, a + Math.PI / 2);
  }
  // szprychy i piasta
  const hub = g.solids.find((s) => s.tag === 'hub');
  plateUV(plates, hub.points, H.bodyBottom, H.deckTop - H.bodyBottom, M.dark);
  plateUV(plates, inset(hub.points, 40), H.deckTop, 6, M.floor);
  for (const s of g.solids) {
    if (s.tag !== 'spoke') continue;
    const [p0, p1, p2, p3] = s.points;
    const a0 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const a1 = [(p0[0] + p3[0]) / 2, (p0[1] + p3[1]) / 2];
    pierBody(f, a0[0], a0[1], a1[0], a1[1], m.spokeHalf, style, 0);
  }
  hubTower(f, 0, 0, m.hubR * 0.38, style, 2);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const r = m.hubR * 0.7;
    lampUV(f, Math.cos(a) * r, Math.sin(a) * r, H.deckTop + 16, 22, M.white, 1.2);
    if (lamps.length < PB_MAX_LAMPS) lamps.push([-(Math.sin(a) * r), k7HeightToZ(260), Math.cos(a) * r, 1]);
  }
  // światła przeszkodowe na obręczy co 30°
  f.set = 'fg';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + 0.07;
    lampUV(f, Math.cos(a) * rMid, Math.sin(a) * rMid, H.deckTop + 60, 16, M.red, 1.6, PB_FX.blink, (k % 3) * 0.33, 0.5);
  }
  f.set = 'bg';
  for (const b of g.berths) {
    berthGear(f, b, m.padGap, H.deckTop);
    // boja podejścia promieniowego (za polem, zielona, migająca)
    const [hx, hy] = dirOf(b.heading);
    const t = b.padLength / 2 + 240;
    if (b.cls === 'capital' || b.cls === 'mega') {
      for (const s of [-1, 1]) {
        beaconUV(f, b.u - hx * t + hy * s * (b.padWidth / 2 + 120), b.v - hy * t - hx * s * (b.padWidth / 2 + 120), M.green, PB_FX.blink, pbHash1(b.index + b.dock * 31), 0.7);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Koło z wlotem

function buildWheelScene(f, g, style, plates, lamps, addGroup) {
  const m = g.model;
  const rMidWall = (m.Rin + m.Rout) / 2;
  // ściana: korpus z wielokątów kolizji (te same czworokąty), wierzch, krawężniki, listwy
  for (const s of g.solids) {
    if (s.tag !== 'wall' && s.tag !== 'slot') continue;
    plateUV(plates, s.points, H.bodyBottom - 40, H.wallTop - H.bodyBottom + 40, M.dark);
    plateUV(plates, inset(s.points, 30), H.wallTop, 6, M.floor);
  }
  const slotA = Math.asin(m.slotHalf / m.Rin) + 0.004;
  const n = Math.max(64, Math.min(220, Math.ceil((TAU * m.Rin) / 480)));
  const outSlot = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < slotA + 0.01;
  arcBoxes(f, m.Rin + 10, 20, H.wallTop + 10, 18, 0, TAU, n, M.rail, outSlot);
  arcBoxes(f, m.Rout - 10, 20, H.wallTop + 10, 18, 0, TAU, n, M.rail, (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < Math.asin(m.slotHalf / m.Rout) + 0.01);
  f.fx(1.05, PB_FX.steady);
  arcBoxes(f, m.Rin - 3, 6, H.wallTop - 40, 5, 0, TAU, n, M.cyan, outSlot);
  f.nofx();
  // przypory i żebra na zewnętrznej stronie ściany (styl rodziny: radiatory, nasypy, pas K-7)
  const nb = Math.max(36, Math.round((TAU * m.Rout) / 900));
  for (let k = 0; k < nb; k++) {
    const a = ((k + 0.5) / nb) * TAU;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < Math.asin(m.slotHalf / m.Rout) + 0.06) continue;
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (style.family === 'radiator') {
      for (const o of [-1, 0, 1]) boxUV(f, c * (m.Rout + 120) - s * o * 120, s * (m.Rout + 120) + c * o * 120, 90, 240, 160, 10, M.copper, a);
    } else if (style.family === 'vault') {
      boxUV(f, c * (m.Rout + 110), s * (m.Rout + 110), 10, 220, 200, 360, M.orange, a);
    } else {
      boxUV(f, c * (m.Rout + 60), s * (m.Rout + 60), 40, 120, 300, 90, M.steel, a);
      boxUV(f, c * (m.Rout + 40), s * (m.Rout + 40), H.wallTop - 20, 80, 10, 200, M.pale, a);
    }
    boxUV(f, c * rMidWall, s * rMidWall, H.wallTop + 8, m.Rout - m.Rin - 40, 6, 18, M.dark, a);
  }
  // szczelina: ościeża z pasami, światła przeszkodowe, cztery pasy świateł — każda połowa koła ma wlot (zewnętrzny,
  // ±laneOff, zielony — światła biegną do środka) i wylot (wewnętrzny, ±outOff, bursztynowy — biegną na zewnątrz)
  for (const side of [-1, 1]) {
    const v = side * m.slotHalf;
    const ui = Math.sqrt(Math.max(0, m.Rin * m.Rin - v * v));
    const uo = Math.sqrt(Math.max(0, m.Rout * m.Rout - v * v));
    hazardUV(f, ui + 40, v - side * 40, uo - 40, v - side * 40, H.wallTop + 8, 60);
    f.set = 'fg';
    for (const u of [ui + 30, uo - 30]) lampUV(f, u, v - side * 30, H.wallTop + 50, 20, side > 0 ? M.green : M.red, 1.7, PB_FX.blink, side > 0 ? 0 : 0.5, 0.6);
    f.set = 'bg';
    if (lamps.length < PB_MAX_LAMPS) lamps.push([-(v - side * 200), k7HeightToZ(300), ui - 200, 2]);
  }
  const laneIn = m.Rin - 500;
  const laneOut = m.waitU + 300;
  const nLane = Math.max(8, Math.round((laneOut - laneIn) / 280));
  const outOff = Number.isFinite(m.outOff) ? m.outOff : 0;
  // kreski krawędzi pasa w połowie odstępu sąsiednich pasów (pod kadłubami)
  const edge = Math.max(300, (m.laneOff - outOff) * 0.45);
  const lanes = [[m.laneOff, M.green, true], [-m.laneOff, M.green, true], [outOff, M.warm, false]];
  if (outOff > 1) lanes.push([-outOff, M.warm, false]);
  for (const [v, mat, inward] of lanes) {
    for (let i = 0; i <= nLane; i++) {
      const t = i / nLane;
      const u = laneOut - t * (laneOut - laneIn);
      lampUV(f, u, v, H.lane, 16, mat, 1.15, PB_FX.chase, inward ? t : 1 - t, 0.8);
    }
    for (let i = 0; i < nLane; i += 2) {
      const u = laneOut - ((i + 0.5) / nLane) * (laneOut - laneIn);
      for (const s of [-1, 1]) boxUV(f, u, v + s * edge, H.marker, 120, 2, 10, M.paintCold, 0);
    }
  }
  // pierścienie wewnętrzne: A (wlot) — zielone, B (wylot) — bursztynowe, co ~6° poza strefą szczeliny
  for (const [r, mat] of [[m.ringA, M.green], [m.ringB, M.warm]]) {
    const steps = Math.max(36, Math.round((TAU * r) / 700));
    for (let k = 0; k < steps; k++) {
      const a = ((k + 0.5) / steps) * TAU;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.3) continue;
      lampUV(f, Math.cos(a) * r, Math.sin(a) * r, H.lane, 14, mat, 0.95);
    }
  }
  // piasta: podstawa (stoi, kolizje) i korona obracająca się (grupa)
  const hub = g.solids.find((s) => s.tag === 'hub');
  plateUV(plates, hub.points, H.bodyBottom - 60, H.deckTop - H.bodyBottom + 60, M.dark);
  plateUV(plates, inset(hub.points, 60), H.deckTop, 6, M.floor);
  arcBoxes(f, m.hubR - 30, 40, H.deckTop + 10, 16, 0, TAU, 48, M.rail);
  f.fx(1.0, PB_FX.steady);
  arcBoxes(f, m.hubR + 3, 6, H.deckTop - 30, 5, 0, TAU, 48, M.cyan);
  f.nofx();
  const hubGroup = addGroup({ kind: 'hub' });
  f.group = hubGroup;
  f.set = 'fg';
  const R = m.hubR;
  cylUV(f, 0, 0, H.deckTop + 40, R * 0.34, 70, M.steel);
  cylUV(f, 0, 0, H.deckTop + 80, R * 0.3, 14, M.pale);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    segUV(f, c * R * 0.3, s * R * 0.3, c * R * 0.86, s * R * 0.86, H.deckTop + 46, 34, 110, M.dark);
    segUV(f, c * R * 0.3, s * R * 0.3, c * R * 0.86, s * R * 0.86, H.deckTop + 66, 6, 70, k % 2 ? M.yellow : M.pale);
    // moduły mieszkalne na końcach ramion korony (okna — szkło z poświatą)
    boxUV(f, c * R * 0.88, s * R * 0.88, H.deckTop + 54, R * 0.22, 60, R * 0.14, M.steel, a + Math.PI / 2);
    boxUV(f, c * R * 0.88, s * R * 0.88, H.deckTop + 88, R * 0.2, 8, R * 0.05, M.glass, a + Math.PI / 2);
    lampUV(f, c * R * 0.99, s * R * 0.99, H.deckTop + 92, 16, M.white, 1.4, PB_FX.blink, k * 0.25, 0.4);
  }
  arcBoxes(f, R * 0.62, 50, H.deckTop + 50, 26, 0, TAU, 32, M.steel);
  arcBoxes(f, R * 0.62, 30, H.deckTop + 68, 4, 0, TAU, 32, style.family === 'radiator' ? M.copper : M.pale);
  f.set = 'bg';
  f.group = 0;
  // stała wieża w osi piasty (sterownia) — nad koroną
  hubTower(f, 0, 0, R * 0.16, style, 3);
  // stanowiska na wewnętrznej ścianie
  for (const b of g.berths) berthGear(f, b, 60, H.wallTop);
  return hubGroup;
}

// ---------------------------------------------------------------------------

/**
 * Scena doku: `{ sets, plates, labels ([]), lamps, groups, rig: { hubGroup }, instances }`. `geometry` —
 * `buildPortDockGeometry(spec)`, `style` — `resolvePortBuildingStyle(...)`.
 */
export function buildPortDockScene(geometry, style) {
  const f = new PortRecorder();
  const plates = [];
  const lamps = [];
  const groups = [];
  const addGroup = (desc) => {
    groups.push(desc);
    return groups.length;
  };
  let hubGroup = 0;
  if (geometry.kind === 'round') buildRoundScene(f, geometry, style, plates, lamps);
  else if (geometry.kind === 'wheel') hubGroup = buildWheelScene(f, geometry, style, plates, lamps, addGroup);
  else buildCrossScene(f, geometry, style, plates, lamps);
  f.group = 0;
  f.set = 'bg';
  return { sets: f.sets, plates, labels: [], lamps, groups, rig: { hubGroup }, instances: f.count() };
}
