// Osada piratów na planetoidzie pod bazą (misja 1) i winda kosmiczna — DANE instancji (bez Three: testy Node czytają je
// wprost). Ten sam rejestrator i shader co baza piratów i budowle Z7 (portBuildingScene.js / portBuildings3D.js);
// styl Iron Skull (ciemne żelazo, rdza, czerwone pasy, kolce) — BEZ czaszek i napisów (decyzja użytkownika 2026-10-05).
//
// Wszystko w zestawie BG (pass tła, kamera perspektywy — głębia skały pod bazą). Współrzędne: układ bazy (x, h, z)
// z h = z świata (pirateRockLayout.js); rejestrator pisze h wprost (bez k7HeightToZ — pod płaszczyzną skala 1:1).
// Budowle nagrywane w ramce STYCZNEJ do kuli w swoim miejscu (frameAt: X — wschód obrócony o yaw, Y — normalna).
//
// GRUPY RENDERU (macierz grupy w układzie bazy — pirateRockSite3D.js): budowle (zapadanie), głowica kotwicy, odcinki
// liny, kabiny — każda część nagrana w położeniu POCZĄTKOWYM, macierz grupy = ruch sztywny od położenia początkowego
// (nienaruszone: tożsamość). Kanały efektów: ROCK_CH (zasilanie osady i windy, alarm).
import { PB_FX, PB_MAT, PB_MAX_GROUPS, PB_MAX_LAMPS, PortRecorder, pbHash1 } from './portBuildingScene.js';
import { quatMul } from './pirateRockLayout.js';

export const ROCK_CH = Object.freeze({
  power: 0,     // zasilanie osady 0..1 (okna gasną progami)
  alarm: 1,     // koguty alarmu (rozpad habitatu)
  lift: 2       // zasilanie windy (światła biegnące po linie, kabiny)
});

const M = PB_MAT;
const TAU = Math.PI * 2;

const qAxis = (x, y, z, a) => [x * Math.sin(a / 2), y * Math.sin(a / 2), z * Math.sin(a / 2), Math.cos(a / 2)];
function quatEuler(rx, ry, rz) {
  return quatMul(quatMul(qAxis(1, 0, 0, rx || 0), qAxis(0, 1, 0, ry || 0)), qAxis(0, 0, 1, rz || 0));
}
// oś +Y bryły na kierunek d
function quatFromY(dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len;
  const y = dy / len;
  const z = dz / len;
  if (y < -0.999999) return [1, 0, 0, 0];
  const w = 1 + y;
  const n = Math.hypot(z, x, w) || 1;
  return [z / n, 0, -x / n, w / n];
}

/**
 * Rejestrator w ramce budowli (frameAt) — te same bryły co PortRecorder (box, cyl, cone, ring, beam), ale wysokość
 * `y` liczona wzdłuż normalnej powierzchni, a obroty składane z obrotem ramki. y = środek bryły (jak PortRecorder).
 * Wymiary lokalne (położenia i rozmiary) w jednostkach PROJEKTU — rejestrator mnoży je przez skalę świata `k`
 * (pirateRockLayout.js: osada rośnie razem ze skałą).
 */
class SurfaceRecorder {
  constructor(f, k = 1) {
    this.f = f;
    this.k = k;
    this.fr = null;
  }
  at(frame) { this.fr = frame; return this; }
  _p(a, y, b) {
    const F = this.fr;
    const k = this.k;
    a *= k; y *= k; b *= k;
    return [F.o[0] + F.X[0] * a + F.Y[0] * y + F.Z[0] * b, F.o[1] + F.X[1] * a + F.Y[1] * y + F.Z[1] * b, F.o[2] + F.X[2] * a + F.Y[2] * y + F.Z[2] * b];
  }
  // kierunek lokalny → układ bazy
  _d(a, y, b) {
    const F = this.fr;
    return [F.X[0] * a + F.Y[0] * y + F.Z[0] * b, F.X[1] * a + F.Y[1] * y + F.Z[1] * b, F.X[2] * a + F.Y[2] * y + F.Z[2] * b];
  }
  box(a, y, b, w, h, d, mat, yaw = 0) {
    const p = this._p(a, y, b);
    const k = this.k;
    this.f._push('box', p[0], p[1], p[2], 1, w * k, h * k, d * k, mat, quatMul(this.fr.quat, qAxis(0, 1, 0, yaw)));
    return this;
  }
  cyl(a, y, b, r, h, mat, rot = null) {
    const p = this._p(a, y, b);
    const k = this.k;
    this.f._push('cyl', p[0], p[1], p[2], 1, r * k, h * k, r * k, mat, rot ? quatMul(this.fr.quat, quatEuler(rot[0], rot[1], rot[2])) : this.fr.quat);
    return this;
  }
  cone(a, y, b, r, h, mat, dir = null) {
    const p = this._p(a, y, b);
    const k = this.k;
    this.f._push('cone', p[0], p[1], p[2], 1, r * k, h * k, r * k, mat, dir ? quatMul(this.fr.quat, quatFromY(dir[0], dir[1], dir[2])) : this.fr.quat);
    return this;
  }
  ring(a, y, b, r, mat, rot = null) {
    const p = this._p(a, y, b);
    const rk = r * this.k;
    this.f._push('torus', p[0], p[1], p[2], 1, rk, rk, rk, mat, rot ? quatMul(this.fr.quat, quatEuler(rot[0], rot[1], rot[2])) : this.fr.quat);
    return this;
  }
  beam(A, B, w, mat, d = w) {
    const a = this._p(A[0], A[1], A[2]);
    const b = this._p(B[0], B[1], B[2]);
    worldBeam(this.f, a, b, w * this.k, mat, d * this.k);
    return this;
  }
  fx(...args) { this.f.fx(...args); return this; }
  nofx() { this.f.nofx(); return this; }
}

/** Belka między punktami układu bazy (x, h, z). */
function worldBeam(f, a, b, w, mat, d = w) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  if (Math.hypot(dx, dy, dz) < 0.01) return;
  f._push('box', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1, w, Math.hypot(dx, dy, dz), d, mat, quatFromY(dx, dy, dz));
}
/** Walec wzdłuż odcinka a → b (układ bazy). */
function worldRod(f, a, b, r, mat) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < 0.01) return;
  f._push('cyl', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1, r, L, r, mat, quatFromY(dx, dy, dz));
}

// ---------------------------------------------------------------------------
// Detale (lokalnie w ramce budowli)

// Pierścień pasów ostrzegawczych (żółto-czarne) na krawędzi walca o promieniu r na wysokości y.
function hazardRing(s, r, y, n, h = 10, d = 26) {
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * TAU;
    const w = 2 * r * Math.tan(Math.PI / n) * 1.02;
    s.box(Math.cos(a) * r, y, Math.sin(a) * r, w, h, d, i % 2 ? M.black : M.yellow, -(a + Math.PI / 2));
  }
}
// Kolce wokół walca: szpic na zewnątrz i lekko w górę.
function spikeCrown(s, r, y, n, len, rad, seed) {
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5 * pbHash1(seed + i)) / n * TAU;
    const k = 0.8 + 0.4 * pbHash1(seed * 3.1 + i * 1.7);
    s.cone(Math.cos(a) * (r + len * k * 0.4), y, Math.sin(a) * (r + len * k * 0.4), rad, len * k, M.rail, [Math.cos(a), 0.3, Math.sin(a)]);
  }
}
// Rząd okien (świecą przy zasilaniu ≥ próg — gasną progami).
function windowRow(s, a0, y, b, len, n, w, yaw, seed, mat = M.warm) {
  const c = Math.cos(yaw);
  const sn = -Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (i + 0.5) * (len / n);
    s.fx(1.15, PB_FX.fill, 0.08 + 0.85 * pbHash1(seed + i * 2.3), ROCK_CH.power);
    s.box(a0 + c * u, y, b + sn * u, w, 14, 8, mat, yaw);
    s.nofx();
  }
}
const beacon = (s, a, y, b, mat = M.red, phase = 0, size = 22) => {
  s.fx(1.7, PB_FX.blink, phase, 0.5);
  s.box(a, y, b, size, size * 0.8, size, mat);
  s.nofx();
};
const alarmLamp = (s, a, y, b, phase = 0) => {
  s.fx(1.8, PB_FX.alarm, phase, ROCK_CH.alarm);
  s.box(a, y, b, 30, 24, 30, M.red);
  s.nofx();
};

// ---------------------------------------------------------------------------
// Budowle

// Stacja dolna windy: ośmiokątna płyta, przypory z kolcami, wieża z wejściem liny, bębny wyciągarek, dok kabin.
function footStation(s, b, L) {
  const top = L.spec.stationTop;
  s.cyl(0, 30, 0, 500, 70, M.dark);
  s.cyl(0, 72, 0, 452, 16, M.steel);
  hazardRing(s, 470, 70, 32);
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) / 8 * TAU;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    s.beam([c * 430, 70, sn * 430], [c * 150, top * 0.55, sn * 150], 46, M.steel);
    s.cone(c * 480, 120, sn * 480, 18, 120, M.rail, [c, 0.4, sn]);
  }
  // wieża: trzy kondygnacje i głowica z prowadnicą liny
  s.cyl(0, 230, 0, 170, 300, M.dark);
  windowRow(s, 0, 300, 172, 260, 9, 18, 0, 11);
  windowRow(s, 0, 300, -172, 260, 9, 18, Math.PI, 17);
  s.cyl(0, 470, 0, 128, 180, M.steel);
  s.cyl(0, 590, 0, 98, 70, M.rail);
  s.cone(0, top - 20, 0, 116, 70, M.dark);
  s.ring(0, top - 40, 0, 120, M.yellow);
  spikeCrown(s, 170, 380, 10, 120, 16, 31);
  // bębny wyciągarek po bokach wieży
  for (const sgn of [-1, 1]) {
    s.cyl(sgn * 270, 150, 120, 70, 160, M.steel, [Math.PI / 2, 0, 0]);
    s.cyl(sgn * 270, 150, 120, 74, 30, M.orange, [Math.PI / 2, 0, 0]);
    s.box(sgn * 270, 80, 120, 180, 40, 220, M.dark);
  }
  // dok kabin: hala z wrotami i światłami biegnącymi
  s.box(-250, 110, -240, 300, 150, 200, M.dark, 0.2);
  s.box(-250, 110, -342, 220, 110, 8, M.black, 0.2);
  for (let i = 0; i < 6; i++) {
    s.fx(1.3, PB_FX.chase, i / 6, 0.5);
    s.box(-360 + i * 44, 34, -360, 16, 6, 16, M.warm);
    s.nofx();
  }
  for (let k = 0; k < 4; k++) beacon(s, Math.cos(k * TAU / 4) * 120, top + 12, Math.sin(k * TAU / 4) * 120, M.red, k / 4);
  alarmLamp(s, 0, top + 40, 0, 0.1);
  alarmLamp(s, 380, 110, 0, 0.6);
}

// Farma zbiorników wodoru i tlenu (lód → elektroliza): walce z kopułami, pasy, rury.
function tankFarm(s, b) {
  const pts = [[-240, -170], [0, -200], [240, -170], [-240, 170], [0, 200], [240, 170]];
  pts.forEach(([a, z], i) => {
    const h = 300 + 60 * pbHash1(i * 2.1);
    s.cyl(a, h / 2 + 10, z, 110, h, i % 3 === 1 ? M.steel : M.pale);
    s.cone(a, h + 50, z, 110, 80, M.pale);
    s.cone(a, 8, z, 116, 20, M.dark);
    for (let k = 0; k < 2; k++) s.cyl(a, h * (0.3 + 0.4 * k), z, 113, 18, k ? M.red : M.black);
    s.fx(1.4, PB_FX.blink, i / 6, 0.4);
    s.box(a, h + 96, z, 18, 14, 18, M.red);
    s.nofx();
  });
  // kolektor i rury między zbiornikami
  s.box(0, 40, 0, 600, 30, 40, M.steel);
  for (const [a, z] of pts) s.beam([a, 60, z], [a * 0.3, 40, 0], 22, M.copper);
  s.cyl(-380, 80, 0, 60, 140, M.dark);
  hazardRing(s, 70, 150, 12, 8, 14);
  alarmLamp(s, 380, 60, 0, 0.3);
}

// Zakład przerobu lodu: topielnia, hala elektrolizy, chłodnie kominowe, kominy z lampkami.
function plant(s, b) {
  s.box(-80, 120, 0, 620, 240, 360, M.dark);
  s.box(-80, 246, 0, 600, 14, 340, M.steel);
  for (let i = 0; i < 7; i++) s.box(-360 + i * 92, 254, 0, 20, 16, 350, M.rail);
  windowRow(s, -80, 160, 182, 560, 14, 22, 0, 41);
  windowRow(s, -80, 160, -182, 560, 14, 22, Math.PI, 47);
  s.box(330, 90, 60, 260, 180, 240, M.steel, 0.1);
  s.box(330, 186, 60, 230, 12, 210, M.orange, 0.1);
  for (const [a, z] of [[-200, -320], [60, -320]]) {
    s.cyl(a, 180, z, 120, 360, M.pale);
    s.cyl(a, 370, z, 132, 30, M.steel);
    s.cyl(a, 40, z, 140, 60, M.dark);
  }
  for (const [a, z] of [[-300, 120], [-150, 120]]) {
    s.cyl(a, 380, z, 26, 280, M.rail);
    s.cyl(a, 520, z, 30, 16, M.red);
    s.fx(1.6, PB_FX.blink, a * 0.001, 0.6);
    s.box(a, 538, z, 16, 14, 16, M.red);
    s.nofx();
  }
  grilleRow(s, 330, 200, 60, 200, 0.1);
  alarmLamp(s, -380, 260, 0, 0.45);
}
function grilleRow(s, a, y, b, w, yaw) {
  s.box(a, y, b, w, 6, 60, M.black, yaw);
  for (let i = 0; i < 6; i++) s.box(a - w / 2 + (i + 0.5) * (w / 6), y + 3, b, 10, 6, 56, M.rail, yaw);
}

// Silosy urobku (lód, regolit): cztery walce, suwnica na dachach, taśma.
function silos(s, b) {
  const pts = [[-150, -150], [150, -150], [-150, 150], [150, 150]];
  for (const [a, z] of pts) {
    s.cyl(a, 190, z, 96, 360, M.steel);
    s.cone(a, 405, z, 98, 70, M.dark);
    s.cyl(a, 60, z, 104, 30, M.orange);
  }
  s.box(0, 440, 0, 380, 24, 40, M.rail);
  s.box(0, 440, 0, 40, 24, 380, M.rail);
  s.beam([0, 440, 0], [-520, 30, 0], 30, M.dark);
  beacon(s, 0, 470, 0, M.red, 0.2);
}

// Reaktor osady: walec z kopułą, panele radiatorów (żar), pierścień rdzenia.
function reactor(s, b) {
  s.cyl(0, 120, 0, 200, 240, M.dark);
  s.cone(0, 300, 0, 204, 130, M.steel);
  s.ring(0, 245, 0, 206, M.rail);
  s.fx(1.4, PB_FX.fill, 0.15, ROCK_CH.power);
  s.ring(0, 60, 0, 212, M.cyan);
  s.nofx();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    s.beam([c * 200, 60, sn * 200], [c * 360, 60, sn * 360], 30, M.steel);
    s.fx(0.9, PB_FX.fill, 0.25, ROCK_CH.power);
    s.box(c * 480, 150, sn * 480, 260, 240, 10, M.warm, -a);
    s.nofx();
    s.box(c * 480, 150, sn * 480, 280, 260, 4, M.dark, -a);
  }
  spikeCrown(s, 200, 200, 8, 110, 14, 61);
  alarmLamp(s, 0, 380, 0, 0.7);
}

// Kopuły mieszkalne górników: trzy kopuły z oknami i łącznikami.
function domes(s, b) {
  const pts = [[-200, -120], [180, -160], [0, 210]];
  pts.forEach(([a, z], i) => {
    s.cyl(a, 45, z, 140, 90, M.dark);
    s.cone(a, 140, z, 142, 110, M.glass);
    s.ring(a, 92, z, 142, M.rail);
    for (let k = 0; k < 10; k++) {
      const t = (k / 10) * TAU;
      s.fx(1.1, PB_FX.fill, 0.06 + 0.85 * pbHash1(i * 13 + k), ROCK_CH.power);
      s.box(a + Math.cos(t) * 141, 60, z + Math.sin(t) * 141, 26, 16, 8, M.warm, -(t + Math.PI / 2));
      s.nofx();
    }
    beacon(s, a, 210, z, M.green, i / 3, 16);
  });
  s.beam([-200, 40, -120], [180, 40, -160], 50, M.steel, 46);
  s.beam([0, 40, 210], [-200, 40, -120], 50, M.steel, 46);
  s.beam([0, 40, 210], [180, 40, -160], 50, M.steel, 46);
}

// Lądowiska: płyty z obrzeżem świateł, wahadłowiec z ładunkiem na jednym.
function pads(s, b) {
  for (const [a, z, ship] of [[-150, -260, true], [180, 230, false]]) {
    s.cyl(a, 12, z, 230, 24, M.floor);
    hazardRing(s, 222, 26, 28, 6, 14);
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * TAU;
      s.fx(1.3, PB_FX.chase, k / 12, 0.6);
      s.box(a + Math.cos(t) * 246, 22, z + Math.sin(t) * 246, 14, 8, 14, M.cyan);
      s.nofx();
    }
    if (ship) {
      s.box(a, 70, z, 260, 70, 110, M.dark, 0.4);
      s.cone(a + Math.cos(0.4) * 170, 70, z - Math.sin(0.4) * 170, 54, 90, M.steel, [Math.cos(0.4), 0, -Math.sin(0.4)]);
      s.box(a - 40, 120, z + 10, 90, 30, 80, M.orange, 0.4);
    }
  }
}

// Maszt łączności: kratownica, talerz, lampy (przewraca się przy zawaleniu).
function mast(s, b) {
  const H = 900;
  const r = 60;
  const legs = [[r, r], [-r, r], [-r, -r], [r, -r]];
  for (const [a, z] of legs) s.beam([a * 1.6, 0, z * 1.6], [a * 0.4, H, z * 0.4], 16, M.rail);
  for (let k = 1; k < 7; k++) {
    const t = k / 7;
    const k1 = 1.6 - 1.2 * t;
    const y = H * t;
    for (let i = 0; i < 4; i++) {
      const A = legs[i];
      const B = legs[(i + 1) % 4];
      s.beam([A[0] * k1, y, A[1] * k1], [B[0] * k1, y, B[1] * k1], 10, M.steel);
    }
  }
  s.cone(60, H * 0.72, 0, 110, 36, M.pale, [1, 0.6, 0]);
  s.cyl(0, H + 30, 0, 8, 60, M.steel);
  beacon(s, 0, H + 70, 0, M.red, 0.33, 26);
  beacon(s, 0, H * 0.5, 0, M.red, 0.83, 18);
  s.cyl(0, 20, 0, 140, 40, M.dark);
}

// Kopalnia lodu: odkrywka jest w mapie skały; tu wiertnice na skraju, koparka, taśmociąg do zakładu, reflektory.
function mine(s, b, L, plantB) {
  for (const [a, z, h] of [[-420, 330, 420], [380, -360, 380]]) {
    s.box(a, h / 2, z, 70, h, 70, M.rail);
    s.box(a, h + 20, z, 140, 40, 140, M.dark);
    s.cone(a, -30, z, 40, 120, M.steel, [0, -1, 0]);
    s.box(a + 90, 60, z, 120, 120, 100, M.orange);
    beacon(s, a, h + 60, z, M.red, a * 0.001);
  }
  s.box(0, 60, -520, 240, 110, 150, M.yellow, 0.6);
  s.box(-70, 140, -520, 110, 60, 110, M.dark, 0.6);
  s.beam([60, 80, -520], [260, 40, -400], 26, M.steel);
  for (const [a, z] of [[-560, -200], [560, 200]]) {
    s.cyl(a, 130, z, 14, 260, M.rail);
    s.fx(1.3, PB_FX.fill, 0.2, ROCK_CH.power);
    s.box(a, 270, z, 60, 24, 40, M.white);
    s.nofx();
  }
  // taśmociąg: od skraju odkrywki ku zakładowi (punkty na powierzchni, nad nią na podporach); b.e / b.n — świat,
  // przesunięcia i grubości w jednostkach projektu × k
  if (plantB) {
    const n = 8;
    const k = L.k || 1;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const e = (b.e - 420 * k) + ((plantB.e + 200 * k) - (b.e - 420 * k)) * t;
      const nn = (b.n + 380 * k) + ((plantB.n - 260 * k) - (b.n + 380 * k)) * t;
      const top = L.surfacePoint(e, nn, 90 * k);
      const foot = L.surfacePoint(e, nn, 0);
      worldBeam(s.f, [foot.x, foot.h, foot.z], [top.x, top.h, top.z], 14 * k, M.rail);
      if (prev) worldBeam(s.f, prev, [top.x, top.h, top.z], 38 * k, M.dark, 18 * k);
      prev = [top.x, top.h, top.z];
    }
  }
}

const BUILDERS = { foot: footStation, tanks: tankFarm, plant, silos, reactor, domes, pads, mast, mine };

// ---------------------------------------------------------------------------
// Winda: głowica kotwicy, lina, kabiny (układ bazy, położenia początkowe)

// Głowica kotwicy pod dyskiem mieszkalnym: odwrócony stożek z kolcami, pierścień zacisku, bęben, lampy.
function anchorHead(f, L) {
  const top = L.anchorTop[1];
  const bot = L.anchor[1];
  const H = top - bot;
  f._push('cyl', 0, top - 40, 0, 1, 340, 80, 340, M.dark, [0, 0, 0, 1]);
  f._push('cone', 0, bot + H * 0.45, 0, 1, 300, H * 0.9, 300, M.steel, [1, 0, 0, 0]);
  f._push('torus', 0, bot + H * 0.3, 0, 1, 230, 230, 230, M.yellow, [0, 0, 0, 1]);
  f._push('cyl', 0, bot + 30, 0, 1, 90, 60, 90, M.rail, [0, 0, 0, 1]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    f._push('cone', c * 330, top - 120, s * 330, 1, 20, 160, 20, M.rail, quatFromY(c, -0.5, s));
    f.fx(1.6, PB_FX.blink, k / 8, 0.5);
    f._push('box', c * 300, top - 90, s * 300, 1, 22, 18, 22, M.red, [0, 0, 0, 1]);
    f.nofx();
  }
  f.fx(1.8, PB_FX.alarm, 0.2, ROCK_CH.alarm);
  f._push('box', 0, bot - 10, 0, 1, 40, 30, 40, M.red, [0, 0, 0, 1]);
  f.nofx();
}

/**
 * Grubość liny w miejscu t (0 — głowica, 1 — stacja dolna) względem projektu: 1 + t · (k − 1). Głowica jest przy
 * habitacie (bez skali), stacja dolna — w skali skały; dokładnie tyle razy punkt liny w świecie jest dalej od punktu
 * widzenia niż punkt liny projektu na tym samym promieniu widzenia — z kamery lina wygląda jak w projekcie.
 */
export function pirateTetherThickness(L, t) {
  return 1 + Math.max(0, Math.min(1, t)) * ((L.k || 1) - 1);
}

// Odcinek liny i–i+1: wiązka trzech kabli, rozpórki, światła biegnące w dół (zasilanie windy).
function cableSegment(f, L, i) {
  const P = L.tether.nodes;
  const a = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const b = [P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  // poprzeczka: prostopadła do liny i do pionu
  let px = dz;
  let pz = -dx;
  const pl = Math.hypot(px, pz) || 1;
  px /= pl; pz /= pl;
  const N = L.tether.segments;
  const s = pirateTetherThickness(L, (i + 0.5) / N);
  const w = 22 * s;
  for (const o of [-w, 0, w]) {
    worldRod(f, [a[0] + px * o, a[1], a[2] + pz * o], [b[0] + px * o, b[1], b[2] + pz * o], (o === 0 ? 11 : 8) * s, o === 0 ? M.steel : M.dark);
  }
  for (let k = 0; k < 2; k++) {
    const t = (k + 0.5) / 2;
    const c = [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
    worldBeam(f, [c[0] - px * 40 * s, c[1], c[2] - pz * 40 * s], [c[0] + px * 40 * s, c[1], c[2] + pz * 40 * s], 12 * s, M.rail, 12 * s);
    f.fx(1.5, PB_FX.chase, (i + t) / N, 0.35);
    f._push('box', c[0] + px * 44 * s, c[1], c[2] + pz * 44 * s, 1, 14 * s, 14 * s, 14 * s, M.cyan, [0, 0, 0, 1]);
    f.nofx();
  }
}

// Kabina windy na górnym końcu liny (położenie nagrania; jazdę i spadek daje macierz grupy).
function climber(f, L, k) {
  const P = L.tether.nodes;
  const N = L.tether.segments;
  const d = [P[N * 3] - P[0], P[N * 3 + 1] - P[1], P[N * 3 + 2] - P[2]];
  const q = quatFromY(d[0], d[1], d[2]);
  const c = [P[0], P[1], P[2]];
  f._push('box', c[0], c[1], c[2], 1, 150, 230, 150, M.dark, q);
  f._push('box', c[0], c[1], c[2], 1, 162, 40, 162, k ? M.orange : M.yellow, q);
  f._push('cyl', c[0], c[1], c[2], 1, 40, 300, 40, M.steel, q);
  f.fx(1.6, PB_FX.fill, 0.1, ROCK_CH.lift);
  f._push('box', c[0], c[1], c[2], 1, 156, 18, 156, M.warm, quatMul(q, qAxis(0, 1, 0, Math.PI / 4)));
  f.nofx();
}

/**
 * Scena osady i windy: { sets, plates ([]), labels ([]), lamps, groups, instances, groupOf: { buildings: { id: g },
 * head, segments: [g], climbers: [g] } }.
 */
export function buildPirateRockScene(L) {
  const f = new PortRecorder();
  const s = new SurfaceRecorder(f, L.k || 1);
  const lamps = [];
  const groupOf = { buildings: {}, head: 0, segments: [], climbers: [] };
  let g = 1;
  const plantB = L.buildingById.get('plant') || null;
  for (const b of L.buildings) {
    groupOf.buildings[b.id] = g;
    b.group = g;
    f.group = g++;
    s.at(b.frame);
    BUILDERS[b.kind]?.(s, b, L, plantB);
  }
  groupOf.head = g;
  f.group = g++;
  anchorHead(f, L);
  for (let i = 0; i < L.tether.segments; i++) {
    groupOf.segments.push(g);
    f.group = g++;
    cableSegment(f, L, i);
  }
  for (let k = 0; k < L.spec.climbers; k++) {
    groupOf.climbers.push(g);
    f.group = g++;
    climber(f, L, k);
  }
  if (g > PB_MAX_GROUPS) throw new Error(`osada na planetoidzie: ${g - 1} grup > ${PB_MAX_GROUPS - 1}`);
  f.group = 0;
  // lampy budowli: stacja dolna, zakład, kopuły, reaktor, lądowiska, kopalnia — w układzie bazy (x, h, z, rodzaj); bez
  // zbiorników i silosów (jasne walce pod lampą prześwietlały się na zrzutach)
  for (const id of ['foot', 'plant', 'domes', 'reactor', 'pads', 'mine']) {
    const b = L.buildingById.get(id);
    if (!b || lamps.length >= PB_MAX_LAMPS) continue;
    const p = L.surfacePoint(b.e, b.n, 420 * (L.k || 1));
    lamps.push([p.x, p.h, p.z, 1]);
  }
  return {
    sets: f.sets, plates: [], labels: [], lamps,
    groups: [...L.buildings.map((b) => ({ kind: 'building', id: b.id })), { kind: 'head' }],
    groupOf,
    instances: f.count()
  };
}
