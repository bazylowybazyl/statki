// Budowle portowe (Z7) jako DANE instancji — bez Three (testy node czytają je
// wprost). Wzór: haloPortK7Build.js (hala K-7): rejestrator prostopadłościanów,
// walców i torusów w zestawach
//   bg    pod statkami (pokład, łoża, ściany, rusztowania) — warstwa BG,
//   fg    nad statkami (dźwigi, wieże, kołnierz, rdzeń piasty, dach hangaru) — FG,
//   roof  dach zanikający (jak dach K-7) — dziś pusty, zostaje dla budowli z halą,
// płaskie wielokąty (pokład, dach), napisy na pokładzie, grupy ruchome (macierze
// liczy render co klatkę) i kanały efektów (światła, spawanie, zajętość).
//
// Wysokości jak w K-7 (y nad pokładem; płaszczyzna gry y = 116 = z świata 0;
// nad nią ×0,42 — k7HeightToZ), materiały = kody K7_MAT (paleta z profilu
// planety — portBuildingStyle.js), emisja 14–18 w paśmie HDR 0,9–1,4.
//
// Instancja (PB_STRIDE = 20): środek xyz, skala pionowa | rozmiar xyz, materiał |
// kwaternion | grupa, 0, 0, 0 | efekt: jasność, tryb, faza, parametr (PB_FX).
import { K7_ABOVE_SCALE, k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { K7_MAT } from '../haloRing/haloPortK7Build.js';
import { SHIPYARD_SPEC, shipyardPadTower } from './portShipyardLayout.js';

export const PB_MAT = K7_MAT;
export const PB_STRIDE = 20;
export const PB_MAX_GROUPS = 48;
export const PB_CHANNELS = 16;
export const PB_MAX_LAMPS = 8;

/**
 * Tryby efektu instancji (4. wektor: jasność, tryb, faza, parametr).
 *   steady  stałe światło (jasność × emisja materiału)
 *   blink   błysk: parametr = Hz, faza = przesunięcie
 *   chase   bieg świateł: parametr = Hz, faza = pozycja w szeregu (0..1)
 *   fill    zajętość: świeci, gdy kanał[parametr] ≥ faza, inaczej przygaszone
 *   weld    spawanie: kanał[parametr] = praca, kanał[parametr + 1] = czoło (0..1),
 *           faza = pozycja spawarki (0..1) — iskrzy tylko przy czole
 *   status  barwa czerwień → zieleń z kanału[parametr] (0 zamknięte, 1 otwarte)
 *   queue   światło kolejki: świeci, gdy kanał[parametr] > faza (liczba w kolejce)
 *   show    bryła widoczna, gdy (int(kanał[parametr]) & int(faza)) ≠ 0 (flagi bitowe)
 *   launch  bieg świateł pasa (1,2 Hz, faza = pozycja) tylko, gdy kanał[parametr] ≥ 0,5
 *           (zejście okrętu z pochylni); inaczej przygaszone stałe
 */
export const PB_FX = Object.freeze({ steady: 0, blink: 1, chase: 2, fill: 3, weld: 4, status: 5, queue: 6, show: 7, launch: 8 });

// Kanały (uniform vec4 × 4 = 16 liczb) — ustawia render co klatkę ze stanu.
export const YARD_CH = Object.freeze({
  slipBase: (i) => 3 * i,   // + 0 praca, + 1 czoło budowy, + 2 zejście (światła); do 4 pochylni
  refitOn: 12,              // flagi składów refitu z pracą (bit na skład)
  padsBusy: 13,             // flagi placów zajętych (bit na plac, kolejność shipyardPads)
  belt: 14,                 // taśma jedzie (0/1)
  padsRefit: 15             // flagi placów w reficie
});
export const HANGAR_CH = Object.freeze({
  drum: (i) => i,           // zajętość bębna 0..1 (0–7)
  gateIn: 8,                // 0 czerwone (stój), 1 zielone (wlot)
  queue: 9,                 // liczba statków w kolejce
  gateOut: 10,              // 0/1 — wylot w toku
  heavy: 11                 // zajętość zatoki ciężkiej
});

const TAU = Math.PI * 2;
const hash1 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const qAxis = (x, y, z, a) => [x * Math.sin(a / 2), y * Math.sin(a / 2), z * Math.sin(a / 2), Math.cos(a / 2)];
// Euler XYZ jak three.js: q = qx · qy · qz
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
function mapScale(y, extent) {
  const e = Math.max(1, extent);
  return (k7HeightToZ(y + e) - k7HeightToZ(y - e)) / (2 * e);
}

/** Rejestrator instancji (jak Recorder w haloPortK7Build.js) z efektami i grupami. */
export class PortRecorder {
  constructor() {
    this.sets = {
      bg: { box: [], cyl: [], torus: [] },
      fg: { box: [], cyl: [], torus: [] },
      roof: { box: [], cyl: [], torus: [] }
    };
    this.set = 'bg';
    this.group = 0;
    // 'abs' — wysokości K-7 bezwzględne; 'lin' — lokalne w grupie ruchomej
    // nad płaszczyzną lotu (tylko skala ×K7_ABOVE_SCALE)
    this.mode = 'abs';
    this.dx = 0;
    this.dz = 0;
    this._fx = [0, 0, 0, 0];
  }
  fx(gain = 1, mode = PB_FX.steady, phase = 0, param = 0) {
    this._fx = [gain, mode, phase, param];
    return this;
  }
  nofx() {
    this._fx = [0, 0, 0, 0];
    return this;
  }
  _push(kind, cx, cy, cz, vs, sx, sy, sz, mat, q) {
    const f = this._fx;
    this.sets[this.set][kind].push(cx + this.dx, cy, cz + this.dz, vs, sx, sy, sz, mat, q[0], q[1], q[2], q[3], this.group, 0, 0, 0, f[0], f[1], f[2], f[3]);
  }
  _range(y, h) {
    if (this.mode === 'lin') return [y * K7_ABOVE_SCALE, h * K7_ABOVE_SCALE];
    const z0 = k7HeightToZ(y - h / 2);
    const z1 = k7HeightToZ(y + h / 2);
    return [(z0 + z1) / 2, Math.max(0.5, z1 - z0)];
  }
  _y(y) { return this.mode === 'lin' ? y * K7_ABOVE_SCALE : k7HeightToZ(y); }
  _vs(y, extent) { return this.mode === 'lin' ? K7_ABOVE_SCALE : mapScale(y, extent); }
  box(x, y, z, w, h, d, mat, rotY = 0) {
    const [cy, hh] = this._range(y, h);
    this._push('box', x, cy, z, 1, w, hh, d, mat, qAxis(0, 1, 0, rotY));
    return this;
  }
  beam(a, b, w, mat, d = w) {
    const ay = this._y(a[1]);
    const by = this._y(b[1]);
    const dx = b[0] - a[0];
    const dy = by - ay;
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return this;
    this._push('box', (a[0] + b[0]) / 2, (ay + by) / 2, (a[2] + b[2]) / 2, 1, w, len, d, mat, quatFromY(dx, dy, dz));
    return this;
  }
  cyl(x, y, z, r, h, mat, rot = null) {
    if (!rot) {
      const [cy, hh] = this._range(y, h);
      this._push('cyl', x, cy, z, 1, r, hh, r, mat, [0, 0, 0, 1]);
    } else {
      const ext = Math.max(r, h / 2);
      this._push('cyl', x, this._y(y), z, this._vs(y, ext), r, h, r, mat, quatEuler(rot[0], rot[1], rot[2]));
    }
    return this;
  }
  ring(x, y, z, r, _t, mat, rot = null) {
    // grubość rurki = geometria torusa (jak w K-7); t zostaje w sygnaturze dla zgodności
    const q = rot ? quatEuler(rot[0], rot[1], rot[2]) : [0, 0, 0, 1];
    this._push('torus', x, this._y(y), z, this._vs(y, r), r, r, r, mat, q);
    return this;
  }
  count() {
    let n = 0;
    for (const set of Object.values(this.sets)) for (const arr of Object.values(set)) n += arr.length / PB_STRIDE;
    return n;
  }
}

// Płyta: wypukły wielokąt (x, z) wytłoczony w pionie (y od-do, wysokości K-7).
function plate(list, points, bottom, height, mat, set = 'bg') {
  list.push({ points: points.map(([x, z]) => [x, z]), z0: k7HeightToZ(bottom), z1: k7HeightToZ(bottom + height), mat, set });
}
// Napis na pokładzie (albo dachu: y i zestaw dachu), obrót w płaszczyźnie.
function label(list, text, x, z, width, depth, color, small = '', rotation = 0, y = 1.8, set = 'bg') {
  list.push({ text, small, color, x, z, width, depth, rotation, y: k7HeightToZ(y), set });
}
const stripe = (f, x, z, w, d, mat, y = 1.5) => f.box(x, y, z, w, 1.5, d, mat);

function arrow(f, x, z, length, mat, dir = 1, y = 3) {
  const tip = [x, y, z + dir * length * 0.5];
  const back = [x, y, z - dir * length * 0.5];
  f.beam(back, tip, 7, mat, 3);
  f.beam([x - length * 0.24, y, z + dir * length * 0.1], tip, 8, mat, 3);
  f.beam([x + length * 0.24, y, z + dir * length * 0.1], tip, 8, mat, 3);
}
// Pasy ostrzegawcze (żółto-czarne skosy) w prostokącie wzdłuż x.
function hazard(f, x0, x1, z, depth, y = 2) {
  const M = PB_MAT;
  const n = Math.max(2, Math.round((x1 - x0) / (depth * 0.9)));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) f.box(x0 + (i + 0.5) * w, y, z, w * 0.52, 1.6, depth, i % 2 ? M.black : M.yellow, 0.5);
}

// ---------------------------------------------------------------------------
// Dachy rodzin (wysokości K-7): prostokąt x0..x1 × z0..z1 na wysokości base.
function roofK7(f, x0, x1, z0, z1, base) {
  const M = PB_MAT;
  const w = x1 - x0;
  for (let z = z0 + 160; z < z1 - 80; z += 480) {
    f.box((x0 + x1) / 2, base + 70, z, w - 60, 40, 36, M.pale);
    for (let x = x0 + 60; x < x1 - 300; x += 420) {
      const pw = Math.min(380, x1 - 60 - x);
      if (pw > 60 && z + 330 < z1) f.box(x + pw / 2, base + 58, z + 170, pw, 16, 240, M.steel);
    }
    for (const sx of [x0 + 40, x1 - 40]) f.box(sx, base + 92, z, 70, 16, 60, M.yellow);
  }
  for (let x = x0 + 400; x < x1 - 300; x += 1100) {
    const zc = (z0 + z1) / 2;
    f.box(x, base + 110, zc, 360, 70, Math.min(900, z1 - z0 - 400), M.dark);
    for (let i = 0; i < 6; i++) f.box(x, base + 150, zc - 250 + i * 100, 300, 12, 26, M.steel);
  }
}
function roofVault(f, x0, x1, z0, z1, base) {
  const M = PB_MAT;
  const half = (x1 - x0) / 2 - 40;
  const xc = (x0 + x1) / 2;
  const rise = Math.min(210, half * 0.22);
  const n = 8;
  const arch = (h) => Array.from({ length: n + 1 }, (_, k) => {
    const u = (k / n) * 2 - 1;
    return [xc + u * h, base + 70 + rise * (1 - u * u)];
  });
  const zs = [];
  for (let z = z0 + 140; z < z1 - 60; z += 460) zs.push(z);
  zs.forEach((z, i) => {
    const pts = arch(half);
    for (let k = 0; k < n; k++) f.beam([pts[k][0], pts[k][1], z], [pts[k + 1][0], pts[k + 1][1], z], 30, M.pale, 56);
    for (const s of [-1, 1]) f.box(xc + s * (half - 20), base + 74, z, 64, 26, 80, M.yellow);
    const zn = zs[i + 1];
    if (zn === undefined) return;
    const zc = (z + zn) / 2;
    const pc = arch(half);
    for (let k = 0; k < n; k++) f.beam([pc[k][0], pc[k][1] - 8, zc], [pc[k + 1][0], pc[k + 1][1] - 8, zc], 14, k % 2 ? M.dark : M.hose, zn - z - 56);
    f.box(xc, base + 70 + rise - 2, zc, Math.min(200, half * 0.3), 10, zn - z - 120, M.glass);
  });
}
function roofRadiator(f, x0, x1, z0, z1, base) {
  const M = PB_MAT;
  const xc = (x0 + x1) / 2;
  for (let z = z0 + 160; z < z1 - 80; z += 480) f.box(xc, base + 70, z, x1 - x0 - 60, 40, 36, M.pale);
  const fieldW = Math.min(1100, (x1 - x0) * 0.36);
  const len = Math.max(200, z1 - z0 - 500);
  for (const xf of [x0 + fieldW * 0.5 + 120, x1 - fieldW * 0.5 - 120]) {
    const fins = Math.max(4, Math.floor(fieldW / 72));
    for (let k = 0; k < fins; k++) f.box(xf - fieldW / 2 + (k + 0.5) * (fieldW / fins), base + 130, (z0 + z1) / 2, 12, 150, len, M.copper);
    f.cyl(xf, base + 64, (z0 + z1) / 2, 24, len + 160, M.steel, [Math.PI / 2, 0, 0]);
  }
  f.cyl(xc, base + 82, (z0 + z1) / 2, 30, z1 - z0 - 300, M.copper, [Math.PI / 2, 0, 0]);
  for (const zt of [z0 + 300, z1 - 300]) {
    f.cyl(xc, base + 120, zt, Math.min(180, (x1 - x0) * 0.08), 110, M.pale);
    f.cyl(xc, base + 180, zt, Math.min(186, (x1 - x0) * 0.08 + 6), 10, M.yellow);
  }
}
function familyRoof(f, family, x0, x1, z0, z1, base) {
  if (family === 'vault') roofVault(f, x0, x1, z0, z1, base);
  else if (family === 'radiator') roofRadiator(f, x0, x1, z0, z1, base);
  else roofK7(f, x0, x1, z0, z1, base);
}

// Ściany z zewnątrz wg stylu (pod płaszczyzną lotu): nasyp z regolitu (Mars),
// rurociąg (Jowisz). side: −1/+1 (x), z0..z1, x = lico ściany.
function wallDressing(f, walls, x, side, z0, z1) {
  const M = PB_MAT;
  const zc = (z0 + z1) / 2;
  const d = z1 - z0;
  if (walls === 'berm') {
    f.beam([x + side * 380, -140, zc], [x + side * 20, 96, zc], 70, M.orange, d);
    f.beam([x + side * 480, -150, zc], [x + side * 330, -40, zc], 60, M.dark, d);
    f.box(x + side * 30, 98, zc, 36, 6, d, M.cyan);
  } else if (walls === 'pipes') {
    for (const [y, r, mat] of [[30, 24, M.copper], [66, 18, M.steel], [98, 12, M.copper]]) {
      f.cyl(x + side * (40 + (y - 30) * 0.4), y, zc, r, d, mat, [Math.PI / 2, 0, 0]);
    }
    for (let z = z0 + 100; z < z1; z += 400) {
      f.box(x + side * 50, 20, z, 90, 110, 16, M.dark);
      f.box(x + side * 50, 104, z, 96, 8, 30, M.yellow);
    }
  }
}

// ---------------------------------------------------------------------------
// Stocznia (szkic użytkownika 2026-09-27): galeria z taśmą wzdłuż ringu, trzon
// z taśmą do piasty, pochylnie po bokach trzonu (jeden dźwig, stojak dronów,
// stacja taśmy), piasta: okrąg z wypustkami (Ziemia) albo litera U.

// Punkt w układzie pola stanowiska (a wzdłuż kursu, c w poprzek) → układ stoczni.
function padPoint(b, a, c) {
  const ch = Math.cos(b.angle);
  const sh = Math.sin(b.angle);
  return [b.x + a * ch - c * sh, b.z + a * sh + c * ch];
}
// Obrót bryły wokół pionu: lokalne +x wzdłuż kierunku (dx, dz) układu.
const rotAlong = (dx, dz) => -Math.atan2(dz, dx);

// Prostokąt (środek, kierunek długości, długość, szerokość) jako wielokąt płyty.
function rectPoints(cx, cz, dx, dz, len, width) {
  const n = Math.hypot(dx, dz) || 1;
  const ux = dx / n;
  const uz = dz / n;
  const px = -uz;
  const pz = ux;
  const a = len / 2;
  const b = width / 2;
  return [
    [cx - ux * a - px * b, cz - uz * a - pz * b],
    [cx + ux * a - px * b, cz + uz * a - pz * b],
    [cx + ux * a + px * b, cz + uz * a + pz * b],
    [cx - ux * a + px * b, cz - uz * a + pz * b]
  ];
}

// Taśma na odcinku osiowym (x0,z0)→(x1,z1): koryto, listwy, pas z płytek,
// światła biegnące z prędkością taśmy (faza = droga od początku podajnika).
// sStart — droga podajnika w punkcie (x0, z0), sDir — +1 / −1 (kierunek ruchu).
function beltRun(f, x0, z0, x1, z1, sStart, sDir, lights = true) {
  const M = PB_MAT;
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  if (len < 1) return;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const H = SHIPYARD_SPEC.spine.housing;
  const Bw = SHIPYARD_SPEC.spine.belt;
  const box = (px, y, pz, l, h, w, mat) => (alongX ? f.box(px, y, pz, l, h, w, mat) : f.box(px, y, pz, w, h, l, mat));
  box(cx, 15, cz, len, 30, H, M.dark);
  box(cx, 34, cz, len, 3, Bw, M.black);
  for (const s of [-1, 1]) {
    const o = s * (Bw / 2 + 8);
    box(alongX ? cx : cx + o, 36, alongX ? cz + o : cz, len, 8, 10, M.rail);
  }
  // płytki pasa (poprzeczne listwy co 40 j.)
  const n = Math.floor(len / 40);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    box(px, 36, pz, 4, 1, Bw - 10, M.steel);
  }
  if (!lights) return;
  // światła biegnące: impuls co 800 j. drogi, z prędkością taśmy
  const nl = Math.floor(len / 160);
  for (let i = 0; i <= nl; i++) {
    const t = nl ? i / nl : 0.5;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    const s = sStart + sDir * t * len;
    f.fx(1.2, PB_FX.chase, (s / 800) % 1, 55 / 800);
    for (const side of [-1, 1]) {
      const o = side * (H / 2 + 10);
      f.box(alongX ? px : px + o, 20, alongX ? pz + o : pz, 12, 8, 12, M.green);
    }
    f.nofx();
  }
}

// Pola odbioru (włazy wind) i ich ramki na stacji / w składzie.
function hatchFrame(f, x, z, w, d, y) {
  const M = PB_MAT;
  f.box(x, y, z, w, 1.5, d, M.black);
  for (const s of [-1, 1]) {
    f.box(x + s * (w / 2 + 4), y + 0.5, z, 5, 2, d + 12, M.yellow);
    f.box(x, y + 0.5, z + s * (d / 2 + 4), w + 12, 2, 5, M.yellow);
  }
}

// Galeria wzdłuż ringu: pokład, taśma dwóch podajników, głowice podajników,
// obrotnica na złączu z trzonem.
function buildGallery(f, plates, labels, l, style) {
  const M = PB_MAT;
  const g = l.gallery;
  const belt = l.belt;
  const zc = (g.z0 + g.z1) / 2;
  plate(plates, [[g.x0, g.z0], [g.x1, g.z0], [g.x1, g.z1], [g.x0, g.z1]], -60, 60, M.floor);
  plate(plates, [[g.x0 + 40, g.z0], [g.x1 - 40, g.z0], [g.x1 - 40, g.z1 - 30], [g.x0 + 40, g.z1 - 30]], -320, 260, M.dark);
  // lico ringu (tył) i krawędź od kosmosu
  f.box((g.x0 + g.x1) / 2, 30, g.z0 + 16, g.x1 - g.x0, 60, 32, M.steel);
  f.box((g.x0 + g.x1) / 2, 62, g.z0 + 16, g.x1 - g.x0, 4, 36, M.pale);
  f.box((g.x0 + g.x1) / 2, 14, g.z1 - 12, g.x1 - g.x0, 28, 24, M.steel);
  for (let x = g.x0 + 200; x < g.x1 - 100; x += 400) f.box(x, 30, g.z1 - 12, 20, 4, 26, M.yellow);
  // przypory w licu ringu (co 600 j.)
  for (let x = g.x0 + 300; x < g.x1 - 200; x += 600) f.box(x, 50, g.z0 + 50, 60, 100, 70, M.dark);
  // taśma: dwa podajniki ku złączu (droga podajnika rośnie ku środkowi)
  const sh = belt.stub.x1;
  beltRun(f, -sh, belt.stubZ, -140, belt.stubZ, 0, 1);
  beltRun(f, sh, belt.stubZ, 140, belt.stubZ, 0, 1);
  // obrotnica na złączu z trzonem
  f.cyl(0, 18, belt.stubZ, 150, 36, M.dark);
  f.cyl(0, 36, belt.stubZ, 118, 2, M.black);
  for (let k = 0; k < 24; k++) {
    const a = (k + 0.5) / 24 * TAU;
    f.box(Math.cos(a) * 138, 37, belt.stubZ + Math.sin(a) * 138, 10, 2, 32, k % 3 ? M.steel : M.yellow, -a + Math.PI / 2);
  }
  // głowice podajników: windy, z których wyjeżdżają kontenery (w grze — ring)
  for (const s of [-1, 1]) {
    const hx = s * (sh + 80);
    f.box(hx, 55, zc, 140, 110, g.z1 - g.z0 - 60, M.steel);
    f.box(hx, 111, zc, 150, 4, g.z1 - g.z0 - 50, M.pale);
    hatchFrame(f, s * (sh - 30), belt.stubZ, 76, 24, 36.5);
    f.fx(1.2, PB_FX.blink, s > 0 ? 0.5 : 0, 0.5);
    f.box(hx - s * 60, 116, zc - 90, 12, 8, 12, M.warm);
    f.nofx();
    label(labels, s < 0 ? 'FEED A' : 'FEED B', hx, zc + 20, 120, 40, style.labels.logistics, '', 0, 114);
  }
}

// Trzon: pokład, dźwigary brzegowe, rurociąg, żebra, taśma do piasty, stacje
// odbioru przy pochylniach, kołnierz wpięcia w ring (FG).
function buildSpine(f, plates, labels, l, style) {
  const M = PB_MAT;
  const sp = l.spine;
  const belt = l.belt;
  const g = l.gallery;
  const z0 = g.z1 - 20;
  const z1 = sp.z1;
  const zc = (z0 + z1) / 2;
  const len = z1 - z0;
  plate(plates, [[sp.x0, z0], [sp.x1, z0], [sp.x1, z1], [sp.x0, z1]], -60, 57, M.floor);
  plate(plates, [[sp.x0 + 40, z0], [sp.x1 - 40, z0], [sp.x1 - 40, z1 - 40], [sp.x0 + 40, z1 - 40]], -340, 280, M.dark);
  // żebra poprzeczne (widać między rurami a taśmą)
  for (let z = z0 + 200; z < z1 - 100; z += 500) f.box(0, 4, z, sp.x1 - sp.x0 - 60, 8, 22, M.dark);
  // dźwigary brzegowe z listwą i drobnymi światłami krawędzi
  for (const s of [-1, 1]) {
    const x = s * (sp.x1 - 25);
    f.box(x, 20, zc, 50, 40, len, M.steel);
    f.box(x, 41, zc, 52, 3, len, s < 0 ? M.pale : M.pale);
    for (let z = z0 + 150; z < z1 - 50; z += 300) f.box(x, 43, z, 54, 2, 14, M.yellow);
    f.fx(0.9, PB_FX.steady);
    for (let z = z0 + 300; z < z1 - 100; z += 600) f.box(x + s * 27, 30, z, 6, 6, 10, M.warm);
    f.nofx();
    // rurociąg (miedź / stal) na wspornikach
    const px = s * 205;
    f.cyl(px, 34, zc, 16, len - 80, s < 0 ? M.copper : M.steel, [Math.PI / 2, 0, 0]);
    f.cyl(px + s * 34, 30, zc, 10, len - 80, M.hose, [Math.PI / 2, 0, 0]);
    for (let z = z0 + 120; z < z1 - 60; z += 400) f.box(px + s * 16, 14, z, 70, 28, 22, M.dark);
  }
  // taśma trzonu (oba podajniki) i właz końcowy przed terminalem
  const sEnd = belt.stub.x1;
  beltRun(f, 0, belt.stubZ + 140, 0, belt.end.z, sEnd + 140, 1);
  hatchFrame(f, 0, belt.end.z - 30, 40, 100, 36.5);
  hazard(f, -120, 120, belt.end.z - 110, 24, 2);
  // stacje odbioru: płyta z włazami wind, zjazd z taśmy, miejsce bloku dźwigu
  for (const s of l.slips) {
    const st = s.station;
    const side = s.side;
    const heavyZ = st.heavy.z;
    const pz0 = st.spots[0].z - 70;
    const pz1 = heavyZ + 100;
    f.box(st.x, 13, (pz0 + pz1) / 2, 160, 26, pz1 - pz0, M.steel);
    f.box(st.x, 26.5, (pz0 + pz1) / 2, 166, 1, pz1 - pz0 + 6, M.dark);
    for (const sp2 of st.spots) hatchFrame(f, sp2.x, sp2.z, 30, 62, 27.5);
    hatchFrame(f, st.x, heavyZ, 82, 140, 27.5);
    // zjazd z taśmy na stację (poprzeczny odcinek pasa)
    const bx0 = side * (SHIPYARD_SPEC.spine.housing / 2);
    const bx1 = st.x - side * 75;
    f.box((bx0 + bx1) / 2, 30, st.z + 20, Math.abs(bx1 - bx0), 4, 44, M.black);
    for (const o of [-26, 26]) f.box((bx0 + bx1) / 2, 33, st.z + 20 + o, Math.abs(bx1 - bx0), 5, 6, M.rail);
    f.fx(1.1, PB_FX.steady);
    f.box(st.x + side * 68, 30, pz0 + 16, 10, 6, 10, M.green);
    f.nofx();
  }
  // kołnierz wpięcia w ring (przeszkoda — FG): słupy z klamrami do trzonu
  const c = sp.collar;
  f.set = 'fg';
  for (const s of [-1, 1]) {
    const x = s * c.x;
    f.box(x, 300, c.z, c.width, 600, c.depth, M.steel);
    f.box(x, 604, c.z, c.width + 16, 10, c.depth + 16, M.pale);
    f.box(x, 90, c.z, c.width + 10, 70, c.depth + 10, M.dark);
    f.box(x, 611, c.z, c.width * 0.62, 6, c.depth * 0.66, M.dark);
    f.cyl(x, 618, c.z, c.width * 0.2, 12, M.steel);
    for (const dz of [-0.42, 0.42]) f.box(x, 612, c.z + dz * c.depth, c.width * 0.8, 6, 16, M.yellow);
    for (const dx of [-1, 1]) f.box(x + dx * c.width * 0.42, 612, c.z, 14, 6, c.depth * 0.5, M.orange);
    f.fx(1.6, PB_FX.blink, s > 0 ? 0.5 : 0, 0.5);
    for (const dz of [-1, 1]) f.box(x + s * (c.width / 2 - 20), 618, c.z + dz * (c.depth / 2 - 20), 14, 10, 14, M.red);
    f.nofx();
  }
  f.set = 'bg';
  for (const s of [-1, 1]) {
    // klamry między słupem a trzonem (pod płaszczyzną gry)
    const xa = s * sp.x1;
    const xb = s * (c.x - c.width / 2);
    for (const dz of [-0.28, 0.28]) f.box((xa + xb) / 2, 60, c.z + dz * c.depth, Math.abs(xb - xa), 60, 60, M.dark);
  }
}

// Pochylnia: plac z łożem kadłuba, bloki stępki, kołyski, szyny dźwigu, stojak
// dronów, wieże narożne (FG), płyta zejścia ze światłami.
function buildBerth(f, plates, labels, s, berth, style) {
  const M = PB_MAT;
  const LC = style.labels;
  const x = s.x;
  const hw = s.width / 2;
  const zc = s.z;
  const len = s.length;
  const hb = s.padBeam / 2;
  const pz0 = zc - s.padLength / 2;
  const pz1 = zc + s.padLength / 2;
  plate(plates, [[x - hw, s.z0], [x + hw, s.z0], [x + hw, s.z1], [x - hw, s.z1]], -60, 60, M.floor);
  plate(plates, [[x - hw + 40, s.z0 + 40], [x + hw - 40, s.z0 + 40], [x + hw - 40, s.z1 - 40], [x - hw + 40, s.z1 - 40]], -300, 240, M.dark);
  // krawędzie placu: dźwigary wzdłużne, pasy ostrzegawcze na czołach
  for (const side of [-1, 1]) {
    f.box(x + side * (hw - 10), 12, zc, 20, 24, len, M.steel);
    f.box(x + side * (hw - 10), 25, zc, 22, 2, len, M.yellow);
  }
  hazard(f, x - hw + 20, x + hw - 20, s.z0 + 20, 32, 2);
  hazard(f, x - hw + 20, x + hw - 20, s.z1 - 20, 32, 2);
  // łoże kadłuba
  f.box(x, 1, zc, s.padBeam, 2, s.padLength, M.deckPad);
  for (const side of [-1, 1]) {
    stripe(f, x + side * hb, zc, 6, s.padLength, M.paint, 2.5);
    for (let z = pz0 + 40; z < pz1; z += 120) stripe(f, x + side * (hb + 16), z, 22, 8, M.yellow, 2.5);
  }
  stripe(f, x, pz0, s.padBeam, 6, M.paint, 2.5);
  stripe(f, x, pz1, s.padBeam, 6, M.paint, 2.5);
  for (let z = pz0 + 80; z < pz1 - 60; z += 150) stripe(f, x, z, 6, 60, M.paintCold, 2.5);
  // bloki stępki (kadłub w budowie leży na nich, y = 110) i kołyski boczne
  for (let z = pz0 + 60; z < pz1 - 40; z += 90) {
    f.box(x, 50, z, 46, 100, 26, M.dark);
    f.box(x, 101.5, z, 40, 3, 22, M.orange);
  }
  for (let z = pz0 + 120; z < pz1 - 80; z += 180) {
    for (const side of [-1, 1]) {
      f.box(x + side * 205, 50, z, 30, 100, 40, M.dark);
      f.beam([x + side * 205, 100, z], [x + side * 120, 104, z], 12, M.steel, 22);
      f.box(x + side * 118, 106, z, 18, 6, 26, M.yellow);
    }
  }
  // szyny dźwigu (na dłuższych krawędziach)
  for (const rx of s.rails) {
    f.box(rx, 10, zc, 60, 20, len - 40, M.dark);
    f.box(rx, 22, zc, 22, 5, len - 40, M.rail);
    for (let z = s.z0 + 40; z < s.z1 - 20; z += 60) f.box(rx, 21, z, 50, 3, 8, M.rail);
    for (const zz of [s.z0 + 30, s.z1 - 30]) f.box(rx, 34, zz, 70, 30, 24, M.yellow);
  }
  // stojak dronów: łoże, kołyski (ramki), lampki gotowości
  const r = s.rack;
  const rz0 = r.z0 - 40;
  const rz1 = r.z1 + 40;
  f.box(r.x, 17, (rz0 + rz1) / 2, 120, 34, rz1 - rz0, M.dark);
  f.box(r.x, 34.5, (rz0 + rz1) / 2, 124, 1, rz1 - rz0 + 4, M.steel);
  for (const slot of r.slots) {
    f.box(slot.x, 35.5, slot.z, 32, 1.5, 66, M.black);
    for (const sz of [-1, 1]) f.box(slot.x, 36, slot.z + sz * 35, 34, 2, 4, M.yellow);
  }
  for (let k = 0; k < r.slots.length; k += 4) {
    const slot = r.slots[k];
    f.fx(1.1, PB_FX.chase, k / r.slots.length, 0.35);
    f.box(r.x - s.side * 64, 34, slot.z, 8, 6, 8, M.cyan);
  }
  f.nofx();
  // wieże narożne (przeszkody, FG): światła przeszkodowe i reflektory na plac
  f.set = 'fg';
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      const tx = x + cx * (hw - 45);
      const tz = zc + cz * (len / 2 - 45);
      f.box(tx, 160, tz, 90, 320, 90, M.steel);
      f.box(tx, 322, tz, 100, 8, 100, M.yellow);
      f.box(tx, 150, tz, 96, 20, 96, M.dark);
      f.fx(1.6, PB_FX.blink, 0.25 * (cx + 1) + 0.12 * (cz + 1), 0.5);
      f.box(tx, 332, tz, 14, 10, 14, M.red);
      f.nofx();
      f.fx(0.8, PB_FX.steady);
      f.box(tx - cx * 48, 300, tz - cz * 30, 6, 10, 26, M.white);
      f.nofx();
    }
  }
  f.set = 'bg';
  // płyta zejścia: pas, strzałka, światła biegnące ku piaście (przy zejściu)
  const az0 = s.z1;
  const az1 = s.apronZ1;
  plate(plates, [[x - hb - 60, az0], [x + hb + 60, az0], [x + hb + 60, az1], [x - hb - 60, az1]], -40, 40, M.floor);
  for (const side of [-1, 1]) {
    f.box(x + side * (hb + 50), 8, (az0 + az1) / 2, 20, 16, az1 - az0, M.steel);
    for (let z = az0 + 60; z < az1 - 30; z += 110) stripe(f, x + side * (hb - 40), z, 8, 60, M.paintCold, 2);
  }
  arrow(f, x, (az0 + az1) / 2 + 40, 180, M.paintCold, 1, 3);
  const ch = YARD_CH.slipBase(s.index) + 2;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = az0 + 40 + k * ((az1 - az0 - 60) / 4);
      f.fx(1.2, PB_FX.launch, k / 5, ch);
      f.box(x + side * (hb + 50), 18, z, 14, 6, 24, M.green);
      f.nofx();
    }
  }
  label(labels, `SLIPWAY ${s.index + 1}`, x, s.z0 + 130, s.padBeam * 0.8, 90, LC.capital, `${berth.maxLength} x ${berth.maxBeam} / DRONE SWARM`);
  label(labels, s.id, x, az1 - 70, 260, 60, LC.berth, 'LAUNCH');
}

// Jeden dźwig pochylni (FG): most na szynach z wysięgnikiem nad trzonem do
// stacji taśmy (ściąg z masztu), wózek, zblocze z trawersą bloku, liny.
// Grupy: most (z), wózek (x), zblocze (wysokość), liny (skala pionowa).
function buildCrane(f, addGroup, s) {
  const M = PB_MAT;
  const C = s.crane;
  const top = C.legTop;
  f.set = 'fg';
  const gBridge = addGroup({ kind: 'crane-bridge', slip: s.index, x: s.x });
  f.group = gBridge;
  // bryły względem (s.x, 0, z mostu)
  const xi = C.innerRail - s.x;
  const xo = C.outerRail - s.x;
  const xt = C.tipX - s.x;
  for (const lx of [xi, xo]) {
    f.box(lx, 20, 0, 64, 26, 230, M.dark);
    for (const zz of [-85, 85]) f.cyl(lx, 14, zz, 16, 24, M.rail, [0, 0, Math.PI / 2]);
    for (const zz of [-95, 95]) f.beam([lx, 34, zz], [lx, top, zz * 0.25], C.leg, M.yellow);
    f.beam([lx, 160, -72], [lx, 160, 72], 14, M.steel);
    f.beam([lx, 320, -44], [lx, 320, 44], 12, M.steel);
  }
  const gx0 = Math.min(xo, xt) - 30;
  const gx1 = Math.max(xo, xt) + 30;
  const glen = gx1 - gx0;
  const gxc = (gx0 + gx1) / 2;
  for (const zz of [-C.girderGap / 2, C.girderGap / 2]) {
    f.box(gxc, top + 20, zz, glen, C.girderH, C.girder, M.yellow);
    f.box(gxc, top + 20 + C.girderH / 2 + 3, zz, glen - 10, 5, C.girder - 6, M.rail);
    const n = Math.max(4, Math.round(glen / 110));
    for (let i = 0; i < n; i++) {
      const xa = gx0 + i * (glen / n);
      f.beam([xa, top + 6, zz], [xa + glen / n, top + 34, zz], 8, M.steel);
    }
  }
  f.box(gxc, top + 2, 0, glen - 40, 6, C.girderGap - C.girder, M.dark);
  // maszt nad nogą przy trzonie i ściągi wysięgnika
  f.beam([xi, top + 40, 0], [xi, top + 170, 0], 18, M.yellow);
  f.beam([xi, top + 170, 0], [xt, top + 42, 0], 6, M.rail);
  f.beam([xi, top + 170, 0], [xo, top + 42, 0], 6, M.rail);
  // kabina na końcu od kosmosu
  f.box(xo, top - 24, C.girderGap / 2 + 34, 80, 44, 48, M.pale);
  f.box(xo, top - 22, C.girderGap / 2 + 59, 64, 20, 4, M.glass);
  f.fx(1, PB_FX.blink, hash1(s.index * 7 + 1), 0.7);
  for (const xx of [gx0 + 10, gx1 - 10]) f.box(xx, top + 44, 0, 12, 10, 12, M.warm);
  f.nofx();
  f.fx(1.6, PB_FX.blink, 0.5, 0.5);
  f.box(xi, top + 178, 0, 12, 8, 12, M.red);
  f.nofx();
  // wózek
  const gTrolley = addGroup({ kind: 'crane-trolley', parent: gBridge, slip: s.index });
  f.group = gTrolley;
  f.box(0, top + 46, 0, 110, 26, C.girderGap + 34, M.dark);
  f.box(0, top + 64, 0, 70, 20, 80, M.yellow);
  f.cyl(0, top + 58, 0, 22, 80, M.rail, [0, 0, Math.PI / 2]);
  // zblocze z trawersą pod blok (liniowo w grupie)
  const gHoist = addGroup({ kind: 'crane-hoist', parent: gTrolley, slip: s.index });
  f.group = gHoist;
  f.mode = 'lin';
  f.box(0, 10, 0, 60, 12, 30, M.yellow);
  f.box(0, 2, 0, 116, 5, 70, M.dark);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * 54, 1, sz * 31, 10, 7, 10, M.yellow);
  f.mode = 'abs';
  // liny (grupa ze skalą pionową liczoną z położenia zblocza)
  const gCables = addGroup({ kind: 'crane-cables', parent: gTrolley, slip: s.index });
  f.group = gCables;
  f.mode = 'lin';
  for (const xx of [-24, 24]) for (const zz of [-10, 10]) f.box(xx, 0, zz, 3, 1, 3, M.black);
  f.mode = 'abs';
  f.group = 0;
  f.set = 'bg';
  return { bridge: gBridge, trolley: gTrolley, hoist: gHoist, cables: gCables, top };
}

// Plac postoju / refitu (dowolny kurs): łoże, obrys, oś, znaki przechwytu,
// zderzak dziobowy, lampy zajętości i refitu (flagi bitowe z kanałów),
// wieża serwisowa z wysięgnikiem (FG). Place U bez pokładu: ramy i wysięgniki.
function buildPad(f, labels, b, index, style) {
  const M = PB_MAT;
  const LC = style.labels;
  const L = b.padLength;
  const Wd = b.padBeam;
  const rot = -b.angle;
  const at = (a, c) => padPoint(b, a, c);
  const floating = b.ring === 'basin' || b.ring === 'arm';
  let p = at(0, 0);
  if (floating) {
    // kratownica w ramie zawieszona na wysięgnikach — pod nią otwarty basen
    for (const s of [-1, 1]) {
      const q = at(0, s * (Wd / 2 + 16));
      f.box(q[0], -2, q[1], L + 56, 20, 26, M.steel, rot);
      f.box(q[0], 9, q[1], L + 56, 2, 28, M.pale, rot);
      const e = at(s * (L / 2 + 16), 0);
      f.box(e[0], -2, e[1], 26, 20, Wd + 58, M.steel, rot);
      const rail = at(0, s * Wd * 0.24);
      f.box(rail[0], -6, rail[1], L, 12, 22, M.dark, rot);
    }
    const bars = Math.max(3, Math.round(L / 170));
    for (let j = 1; j < bars; j++) {
      const q = at(-L / 2 + j * (L / bars), 0);
      f.box(q[0], -8, q[1], 14, 10, Wd, M.dark, rot);
    }
    const gap = b.size === 'CAPITAL' ? 110 : 90;
    for (const s of [-1, 1]) {
      const q = at(L / 2 + 26 + gap / 2, s * Wd * 0.3);
      f.box(q[0], -4, q[1], gap + 30, 30, 40, M.steel, rot);
    }
  } else {
    f.box(p[0], 1, p[1], L, 2, Wd, M.deckPad, rot);
  }
  for (const s of [-1, 1]) {
    let q = at(0, s * Wd / 2);
    f.box(q[0], 2.5, q[1], L, 1.5, 6, M.paint, rot);
    q = at(s * L / 2, 0);
    f.box(q[0], 2.5, q[1], 6, 1.5, Wd, M.paint, rot);
    const count = Math.max(3, Math.round(L / 200));
    for (let j = 0; j < count; j++) {
      q = at(-L / 2 + 30 + j * (L - 60) / (count - 1), s * (Wd / 2 + 14));
      f.box(q[0], 2.5, q[1], 8, 1.5, 20, M.yellow, rot);
    }
  }
  for (let a = -L * 0.36; a < L * 0.36; a += Math.max(120, L / 9)) {
    const q = at(a, 0);
    f.box(q[0], 2.5, q[1], L / 22, 1.5, 6, M.paintCold, rot);
  }
  const cx = b.capture.halfLength;
  const cz = b.capture.halfWidth;
  for (const sa of [-1, 1]) for (const sc of [-1, 1]) {
    let q = at(sa * cx, sc * (cz - 12));
    f.box(q[0], 2.5, q[1], 4, 1.5, 24, M.paintCold, rot);
    q = at(sa * (cx - 12), sc * cz);
    f.box(q[0], 2.5, q[1], 24, 1.5, 4, M.paintCold, rot);
  }
  // zderzak dziobowy
  p = at(L / 2 - 24, 0);
  f.box(p[0], 6, p[1], 16, 12, Wd * 0.5, M.yellow, rot);
  // lampy: zajęty (czerwień) i refit (bursztyn) — flagi bitowe kanałów 13 / 15
  const bit = 2 ** (index % 23);
  for (const s of [-1, 1]) {
    const q = at(L / 2 - 50, s * (Wd / 2 - 30));
    f.fx(1.2, PB_FX.show, bit, YARD_CH.padsBusy);
    f.box(q[0], 5, q[1], 14, 6, 14, M.red, rot);
    f.nofx();
    const r = at(-L / 2 + 50, s * (Wd / 2 - 30));
    f.fx(1.2, PB_FX.show, bit, YARD_CH.padsRefit);
    f.box(r[0], 5, r[1], 14, 6, 14, M.warm, rot);
    f.nofx();
  }
  // wieża serwisowa (przeszkoda, FG) z wysięgnikiem nad burtę
  const t = shipyardPadTower(b);
  f.set = 'fg';
  f.box(t.x, 120, t.z, 70, 240, 70, M.steel);
  f.box(t.x, 242, t.z, 80, 6, 80, M.yellow);
  const toward = at(-L / 2 + 90, 0);
  const dx = toward[0] - t.x;
  const dz = toward[1] - t.z;
  const dl = Math.hypot(dx, dz) || 1;
  const reach = Math.min(dl - Wd * 0.3, 90 + Wd * 0.12);
  f.beam([t.x, 236, t.z], [t.x + dx / dl * reach, 220, t.z + dz / dl * reach], 16, M.orange);
  f.fx(1.2, PB_FX.show, bit, YARD_CH.padsRefit);
  f.box(t.x + dx / dl * reach, 210, t.z + dz / dl * reach, 8, 6, 8, M.white);
  f.nofx();
  f.fx(1.5, PB_FX.blink, hash1(index + 3), 0.5);
  f.box(t.x, 250, t.z, 12, 8, 12, M.red);
  f.nofx();
  f.set = 'bg';
  const cls = b.size === 'CAPITAL' ? (b.maxBeam >= 1000 ? 'CAPITAL' : 'CARRIER') : b.size;
  p = at(-L * 0.18, 0);
  label(labels, b.id.slice(b.id.lastIndexOf('-') + 1), p[0], p[1], Math.min(L, Wd) * 0.55, Math.min(L, Wd) * 0.22, cls === 'CAPITAL' ? LC.berthLead : LC.berth, `${cls} / PARK + REFIT`, 0, 3);
}

// Skład refitu: płyta, włazy odbioru, stojak dronów, znaki narożne.
function buildDepot(f, labels, d, index, style) {
  const M = PB_MAT;
  f.box(d.x, 11, d.z, d.w, 22, d.d, M.steel);
  f.box(d.x, 22.5, d.z, d.w + 6, 1, d.d + 6, M.dark);
  for (const dz of [-100, 0, 100]) hatchFrame(f, d.x - 70, d.z + dz, 30, 62, 23.5);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 3; c++) {
      const x = d.x + 26 + c * 52;
      const z = d.z - 190 + r * 76;
      f.box(x, 23.5, z, 32, 1.5, 66, M.black);
      for (const sz of [-1, 1]) f.box(x, 24, z + sz * 35, 34, 2, 4, M.yellow);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    f.box(d.x + sx * (d.w / 2 - 20), 24, d.z + sz * (d.d / 2 - 6), 40, 2, 8, M.yellow);
    f.box(d.x + sx * (d.w / 2 - 6), 24, d.z + sz * (d.d / 2 - 20), 8, 2, 40, M.yellow);
  }
  f.fx(1.1, PB_FX.show, 2 ** index, YARD_CH.refitOn);
  f.box(d.x + d.w / 2 - 20, 26, d.z - d.d / 2 + 20, 12, 6, 12, M.warm);
  f.nofx();
  label(labels, 'REFIT', d.x, d.z + d.d / 2 + 50, 160, 50, style.labels.logistics, '', 0, 2);
}

// Piasta Ziemi: tarcza z obręczą, rdzeń (terminal taśmy, gniazdo dronów, wieża
// — FG), wypustki z pokładem, składy refitu.
function buildRadialHub(f, plates, labels, lamps, l, style) {
  const M = PB_MAT;
  const h = l.hub;
  const hz = h.z;
  const R = h.disc;
  const LC = style.labels;
  const circle = (r, n = 64) => Array.from({ length: n }, (_, k) => {
    const a = (k / n) * TAU;
    return [Math.sin(a) * r, hz + Math.cos(a) * r];
  });
  plate(plates, circle(R), -60, 60, M.floor);
  plate(plates, circle(R - 60), -340, 280, M.dark);
  // wypustki: pokład, dźwigary brzegowe, czoło z pasami i światłami nawigacyjnymi
  for (const pr of h.prongs) {
    const len = pr.r1 - pr.r0;
    const rc = (pr.r0 + pr.r1) / 2;
    const cx = pr.dirX * rc;
    const cz = hz + pr.dirZ * rc;
    plate(plates, rectPoints(cx, cz, pr.dirX, pr.dirZ, len, pr.width), -60, 57, M.floor);
    plate(plates, rectPoints(cx - pr.dirX * 40, cz - pr.dirZ * 40, pr.dirX, pr.dirZ, len - 120, pr.width - 80), -300, 240, M.dark);
    const rot = rotAlong(pr.dirX, pr.dirZ);
    const px = pr.dirZ;
    const pz = -pr.dirX;
    const eLen = pr.r1 - R + 40;
    const eMid = (R - 40 + pr.r1) / 2;
    for (const s of [-1, 1]) {
      const ex = pr.dirX * eMid + px * s * (pr.width / 2 - 14);
      const ez = hz + pr.dirZ * eMid + pz * s * (pr.width / 2 - 14);
      f.box(ex, 16, ez, eLen, 32, 28, M.steel, rot);
      f.box(ex, 33, ez, eLen, 2, 30, M.pale, rot);
    }
    const tx = pr.dirX * (pr.r1 - 20);
    const tz = hz + pr.dirZ * (pr.r1 - 20);
    f.box(tx, 16, tz, 40, 32, pr.width, M.steel, rot);
    for (let k = 0; k < 6; k++) {
      const o = (k - 2.5) / 6 * (pr.width - 60);
      f.box(tx + px * o, 33, tz + pz * o, 42, 2, (pr.width - 60) / 6 * 0.5, k % 2 ? M.black : M.yellow, rot);
    }
    f.fx(1.5, PB_FX.blink, hash1(pr.index * 3 + 1), 0.5);
    for (const s of [-1, 1]) f.box(tx + px * s * (pr.width / 2 - 20), 40, tz + pz * s * (pr.width / 2 - 20), 16, 8, 16, s < 0 ? M.red : M.green, rot);
    f.nofx();
  }
  // obręcz tarczy (segmenty) z przerwami na wypustki i trzon
  const n = 72;
  const chord = 2 * R * Math.sin(Math.PI / n) + 2;
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) / n * TAU;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const x = dx * (R - 20);
    const z = hz + dz * (R - 20);
    const open = h.prongs.some((pr) => Math.abs(pr.dirZ * x - pr.dirX * (z - hz)) < pr.width / 2 + 10 && pr.dirX * x + pr.dirZ * (z - hz) > 0)
      || (Math.abs(x) < l.spine.x1 + 10 && z < hz);
    if (open) continue;
    f.box(x, 16, z, chord, 32, 40, k % 6 === 0 ? M.yellow : M.steel, a);
    if (k % 6 === 3) {
      f.fx(0.9, PB_FX.steady);
      f.box(dx * (R - 2), 30, hz + dz * (R - 2), 10, 6, 10, M.warm, a);
      f.nofx();
    }
  }
  // oznakowanie tarczy: przerywany okrąg wokół rdzenia i promienie między placami
  const rMark = h.core + 110;
  for (let k = 0; k < 40; k++) {
    const a = (k + 0.5) / 40 * TAU;
    f.box(Math.sin(a) * rMark, 2, hz + Math.cos(a) * rMark, 40, 1.5, 7, M.paintCold, a);
  }
  // rdzeń: podstawa (BG) z portalem taśmy i włazami gniazda dronów
  f.cyl(0, 55, hz, h.core, 110, M.dark);
  f.cyl(0, 111, hz, h.core + 8, 3, M.steel);
  for (let k = 0; k < 16; k++) {
    const a = (k + 0.5) / 16 * TAU;
    const x = Math.sin(a) * (h.core - 44);
    const z = hz + Math.cos(a) * (h.core - 44);
    f.box(x, 113, z, 46, 2, 34, M.black, a);
    f.box(x, 114, z, 50, 1, 4, M.yellow, a);
    f.fx(1.0, PB_FX.chase, k / 16, 0.12);
    f.box(Math.sin(a) * (h.core - 8), 110, hz + Math.cos(a) * (h.core - 8), 8, 6, 8, M.cyan, a);
    f.nofx();
  }
  const pz = hz - h.core - 18;
  f.box(0, 50, pz, 260, 100, 36, M.dark);
  f.box(0, 102, pz, 280, 6, 46, M.yellow);
  for (const s of [-1, 1]) f.box(s * 135, 50, pz, 14, 100, 48, M.yellow);
  // wieża (przeszkoda, FG): trzon, dach gniazda z włazami startowymi, kabina, maszt
  f.set = 'fg';
  const tr = h.core * 0.74;
  f.cyl(0, 300, hz, tr, 380, M.steel);
  f.cyl(0, 492, hz, tr + 12, 16, M.pale);
  f.cyl(0, 470, hz, tr + 4, 30, M.dark);
  for (let k = 0; k < 12; k++) {
    const a = (k + 0.5) / 12 * TAU;
    const x = Math.sin(a) * (tr - 70);
    const z = hz + Math.cos(a) * (tr - 70);
    f.box(x, 501, z, 56, 3, 56, M.black, a);
    for (const s of [-1, 1]) f.box(x + Math.cos(a) * s * 30, 502, z - Math.sin(a) * s * 30, 4, 3, 60, M.yellow, a);
    f.fx(1.1, PB_FX.chase, k / 12, 0.2);
    f.box(Math.sin(a) * (tr - 20), 504, hz + Math.cos(a) * (tr - 20), 10, 6, 10, M.green, a);
    f.nofx();
  }
  f.box(0, 520, hz + 60, 150, 40, 90, M.pale);
  f.box(0, 522, hz + 106, 130, 22, 4, M.glass);
  f.beam([0, 500, hz - 60], [0, 640, hz - 60], 10, M.steel);
  f.fx(1.8, PB_FX.blink, 0.1, 0.5);
  f.box(0, 646, hz - 60, 14, 10, 14, M.red);
  f.nofx();
  f.set = 'bg';
  label(labels, `SHIPYARD ${l.id}`, 0, hz + h.core + 150, 560, 130, LC.hub, `${l.slips.length} SLIPWAYS / ${l.capacity.pads} PADS`, 0, 2);
  if (lamps.length < PB_MAX_LAMPS) lamps.push([0, k7HeightToZ(560), hz, 2]);
}

// Ramię U wg rodziny stylu: K-7 — szopy serwisowe z jasnym dachem, Mars —
// bunkry łukowe (półwalce), Jowisz — pola radiatorów; wszystko pod płaszczyzną gry.
function armDressing(f, family, a, z0, z1) {
  const M = PB_MAT;
  const x = a.x + a.side * 150;
  for (let z = z0; z < z1; z += 1100) {
    if (family === 'vault') {
      f.cyl(x, 20, z + 250, 120, 380, M.hose, [Math.PI / 2, 0, 0]);
      f.cyl(x, 24, z + 250, 124, 12, M.orange, [Math.PI / 2, 0, 0]);
      f.box(x, 40, z + 40, 90, 70, 20, M.dark);
    } else if (family === 'radiator') {
      for (let k = 0; k < 7; k++) f.box(x - 120 + k * 40, 60, z + 250, 8, 110, 420, M.copper);
      f.cyl(x, 20, z + 250, 16, 480, M.steel, [Math.PI / 2, 0, 0]);
    } else {
      f.box(x, 45, z + 250, 260, 90, 380, M.steel);
      f.box(x, 91, z + 250, 250, 4, 360, M.pale);
      f.box(x, 94, z + 250, 60, 4, 300, M.dark);
    }
  }
}

// Piasta U (inne frakcje): belka z terminalem taśmy, dwa ramiona, basen
// z placami w ramach, bloki na końcach belki i czoła ramion (FG, dach rodziny).
function buildUHub(f, plates, labels, lamps, l, style) {
  const M = PB_MAT;
  const h = l.hub;
  const b = h.base;
  const LC = style.labels;
  plate(plates, [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]], -60, 60, M.floor);
  plate(plates, [[b.x0 + 40, b.z0 + 40], [b.x1 - 40, b.z0 + 40], [b.x1 - 40, b.z1 - 40], [b.x0 + 40, b.z1 - 40]], -340, 280, M.dark);
  for (const a of h.arms) {
    const x0 = a.x - a.width / 2;
    const x1 = a.x + a.width / 2;
    plate(plates, [[x0, a.z0], [x1, a.z0], [x1, a.z1], [x0, a.z1]], -60, 57, M.floor);
    plate(plates, [[x0 + 40, a.z0 + 40], [x1 - 40, a.z0 + 40], [x1 - 40, a.z1 - 40], [x0 + 40, a.z1 - 40]], -340, 280, M.dark);
    const zc = (b.z1 + a.z1) / 2;
    const len = a.z1 - b.z1;
    for (const s of [-1, 1]) {
      const ex = a.x + s * (a.width / 2 - 14);
      f.box(ex, 16, zc, 28, 32, len, M.steel);
      f.box(ex, 33, zc, 30, 2, len, M.pale);
    }
    // środek ramienia: tor serwisowy i rury
    f.box(a.x, 3, zc, 120, 6, len - 200, M.dark);
    for (let z = b.z1 + 200; z < a.z1 - 300; z += 300) f.box(a.x, 7, z, 110, 2, 8, M.yellow);
    f.cyl(a.x - a.side * 150, 26, zc, 18, len - 300, M.copper, [Math.PI / 2, 0, 0]);
    // czoło ramienia: pasy i światła nawigacyjne
    hazard(f, x0 + 20, x1 - 20, a.z1 - 20, 32, 3);
    armDressing(f, style.family, a, b.z1 + 300, a.z1 - 420);
  }
  // krawędzie belki: od basenu (między ramionami) i od trzonu (bez przejścia taśmy)
  f.box(0, 16, b.z1 - 14, h.basin.x1 - h.basin.x0, 32, 28, M.steel);
  for (const s of [-1, 1]) {
    const xa = s * (l.spine.x1 + 20);
    const xb = s * b.x1;
    f.box((xa + xb) / 2, 16, b.z0 + 14, Math.abs(xb - xa), 32, 28, M.steel);
  }
  // bloki na końcach belki i czoła ramion (FG, dach rodziny), terminal taśmy
  f.set = 'fg';
  for (const s of [-1, 1]) {
    const bx = s * (b.x1 - 350);
    const bz = (b.z0 + b.z1) / 2;
    const bd = b.z1 - b.z0 - 120;
    f.box(bx, 180, bz, 500, 360, bd, M.steel);
    f.box(bx, 362, bz, 510, 6, bd + 10, M.pale);
    familyRoof(f, style.family, bx - 230, bx + 230, bz - bd / 2 + 20, bz + bd / 2 - 20, 300);
    f.fx(1.6, PB_FX.blink, s > 0 ? 0.5 : 0, 0.5);
    for (const dz of [-1, 1]) f.box(bx + s * 230, 420, bz + dz * (bd / 2 - 20), 14, 10, 14, M.red);
    f.nofx();
  }
  for (const a of h.arms) {
    const tz = a.z1 - 150;
    f.box(a.x, 180, tz, a.width - 80, 360, 240, M.steel);
    f.box(a.x, 362, tz, a.width - 70, 6, 250, M.yellow);
    f.fx(1.6, PB_FX.blink, a.side > 0 ? 0.25 : 0.75, 0.5);
    for (const s of [-1, 1]) f.box(a.x + s * (a.width / 2 - 60), 372, tz + 100, 14, 10, 14, s === a.side ? M.green : M.red);
    f.nofx();
  }
  const t = h.terminal;
  f.box(t.x, 240, t.z, t.w, 480, t.d, M.steel);
  f.box(t.x, 482, t.z, t.w + 12, 6, t.d + 12, M.pale);
  familyRoof(f, style.family, t.x - t.w / 2 + 20, t.x + t.w / 2 - 20, t.z - t.d / 2 + 20, t.z + t.d / 2 - 20, 420);
  for (let k = 0; k < 6; k++) {
    const x = t.x - t.w / 2 + 90 + k * ((t.w - 180) / 5);
    f.box(x, 486, t.z + t.d / 2 - 60, 56, 3, 56, M.black);
    f.fx(1.1, PB_FX.chase, k / 6, 0.2);
    f.box(x, 490, t.z + t.d / 2 - 22, 10, 6, 10, M.green);
    f.nofx();
  }
  f.beam([t.x + t.w / 2 - 80, 480, t.z - t.d / 2 + 80], [t.x + t.w / 2 - 80, 620, t.z - t.d / 2 + 80], 10, M.steel);
  f.fx(1.8, PB_FX.blink, 0.1, 0.5);
  f.box(t.x + t.w / 2 - 80, 626, t.z - t.d / 2 + 80, 14, 10, 14, M.red);
  f.nofx();
  f.set = 'bg';
  // portal taśmy w terminalu
  f.box(0, 50, t.z - t.d / 2 - 18, 260, 100, 36, M.dark);
  f.box(0, 102, t.z - t.d / 2 - 18, 280, 6, 46, M.yellow);
  label(labels, `SHIPYARD ${l.id}`, -(t.w / 2 + 800), (b.z0 + b.z1) / 2 + 60, 900, 200, LC.hub, `${l.slips.length} SLIPWAYS / ${l.capacity.pads} PADS / PARK + REFIT`, 0, 2);
  if (lamps.length < PB_MAX_LAMPS) lamps.push([0, k7HeightToZ(600), t.z + 400, 2]);
}

/**
 * Scena stoczni z układu (createShipyardLayout) i stylu (resolvePortBuildingStyle).
 * Wynik: { sets, plates, labels, groups, lamps, rig } — rig.slips[i].crane: grupy
 * dźwigu, z których render liczy macierze (portBuildings3D.js).
 */
export function buildShipyardScene(l, style) {
  const f = new PortRecorder();
  const plates = [];
  const labels = [];
  const groups = [];
  const lamps = [];
  const addGroup = (desc) => {
    groups.push(desc);
    return groups.length;
  };
  buildGallery(f, plates, labels, l, style);
  buildSpine(f, plates, labels, l, style);
  const slipsRig = [];
  for (const s of l.slips) {
    const berth = l.berths.find((b) => b.kind === 'slip' && b.slipIndex === s.index);
    buildBerth(f, plates, labels, s, berth, style);
    slipsRig.push({ slip: s, crane: buildCrane(f, addGroup, s) });
    if (lamps.length < PB_MAX_LAMPS - 2) lamps.push([s.x, k7HeightToZ(380), s.z, 1]);
  }
  if (l.hub.kind === 'radial') buildRadialHub(f, plates, labels, lamps, l, style);
  else buildUHub(f, plates, labels, lamps, l, style);
  let pi = 0;
  for (const b of l.berths) if (b.kind === 'pad') buildPad(f, labels, b, pi++, style);
  l.depots.forEach((d, i) => buildDepot(f, labels, d, i, style));
  if (groups.length + 1 > PB_MAX_GROUPS) throw new Error(`stocznia: ${groups.length} grup > ${PB_MAX_GROUPS - 1}`);
  return {
    sets: f.sets, plates, labels, groups, lamps,
    rig: { slips: slipsRig },
    instances: f.count()
  };
}

// ---------------------------------------------------------------------------
// Hangar postojowy

// Wierzch bębna w dachu: tarcza (grupa obrotu), rowki kołysek, piasta, wieniec
// lamp zajętości (fill z kanału bębna).
function buildDrumTop(f, addGroup, drum, y, style) {
  const M = PB_MAT;
  const g = addGroup({ kind: 'drum', drum: drum.index, x: drum.x, z: drum.z, slots: drum.slots });
  f.group = g;
  f.mode = 'lin';
  const R = drum.outerR - 50;
  // tarcza obrotowa (walec płaski), piasta, obręcz z segmentów (jasna)
  f.cyl(0, 0, 0, R, 16, style.family === 'vault' ? M.pale : M.steel);
  f.cyl(0, 14, 0, drum.hubR * 0.62, 12, M.dark);
  f.cyl(0, 22, 0, drum.hubR * 0.3, 14, style.family === 'radiator' ? M.copper : M.pale);
  const segs = 40;
  const chord = 2 * (R + 12) * Math.sin(Math.PI / segs) + 4;
  for (let k = 0; k < segs; k++) {
    const a = (k + 0.5) / segs * TAU;
    f.box(Math.cos(a) * (R + 12), 10, Math.sin(a) * (R + 12), 34, 8, chord, k % 5 === 0 ? M.yellow : M.pale, -a);
  }
  // kołyski: rowki promieniowe z zaciskami
  for (let k = 0; k < drum.slots; k++) {
    const a = (k + 0.5) / drum.slots * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r0 = drum.hubR;
    const r1 = drum.hubR + drum.cradleLength;
    const rm = (r0 + r1) / 2;
    f.box(c * rm, 9, s * rm, drum.cradleLength, 3, drum.cradleBeam * 0.82, M.black, -a);
    f.box(c * (r0 + 20), 11, s * (r0 + 20), 14, 4, drum.cradleBeam * 0.6, M.yellow, -a);
    f.box(c * (r1 - 20), 11, s * (r1 - 20), 14, 4, drum.cradleBeam * 0.6, M.yellow, -a);
    // szprycha między kołyskami
    const b = (k + 1) / drum.slots * TAU;
    f.box(Math.cos(b) * rm, 12, Math.sin(b) * rm, drum.cradleLength + 30, 5, 12, M.pale, -b);
    // lampa zajętości na obręczy (świeci, gdy bęben zapełniony powyżej progu)
    f.fx(1.1, PB_FX.fill, (k + 0.5) / drum.slots, HANGAR_CH.drum(drum.index));
    f.box(c * (R + 8), 16, s * (R + 8), 30, 6, 30, M.warm, -a);
    f.nofx();
  }
  f.mode = 'abs';
  f.group = 0;
  return g;
}

// Dach hangaru: siatka paneli omijająca bębny (koło + zapas) i zatokę wind;
// rodzina: K-7 — stal i jasne płyty z wywietrznikami, Mars — regolit
// (pasy na przemian) ze świetlikami, Jowisz — pola radiatorów i rury.
function hangarRoofPanels(f, l, style, roofY) {
  const M = PB_MAT;
  const fam = style.family;
  const x0 = -l.halfWidth + l.wall + 40;
  const x1 = l.halfWidth - l.wall - 40;
  const z0 = l.backZ + l.wall + 40;
  const z1 = l.frontZ - l.wall - 40;
  const cw = 300;
  const cd = 220;
  const gap = 16;
  const holes = l.drums.map((d) => ({ x: d.x, z: d.z, r: d.outerR + 70 }));
  const hv = l.heavy ? { x0: l.heavy.x - l.heavy.width / 2 - 60, x1: l.heavy.x + l.heavy.width / 2 + 60, z0: l.heavy.z - l.heavy.depth / 2 - 60, z1: l.heavy.z + l.heavy.depth / 2 + 60 } : null;
  let k = 0;
  const nx = Math.floor((x1 - x0) / cw);
  const nz = Math.floor((z1 - z0) / cd);
  const ox = x0 + ((x1 - x0) - nx * cw) / 2;
  const oz = z0 + ((z1 - z0) - nz * cd) / 2;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = ox + i * cw;
      const b = oz + j * cd;
      const cx = a + cw / 2;
      const cz = b + cd / 2;
      const hit = holes.some((h) => {
        const px = Math.max(a, Math.min(h.x, a + cw));
        const pz = Math.max(b, Math.min(h.z, b + cd));
        return Math.hypot(px - h.x, pz - h.z) < h.r;
      });
      if (hit || (hv && a < hv.x1 && a + cw > hv.x0 && b < hv.z1 && b + cd > hv.z0)) continue;
      k++;
      const pick = Math.floor(hash1(i * 31 + j * 7 + 3) * 13);
      let mat = pick < 2 ? M.pale : M.steel;
      if (fam === 'vault') mat = (i + (j >> 1)) % 2 ? M.hose : M.dark;
      f.box(cx, roofY + 64, cz, cw - gap, 8, cd - gap, mat);
      if (fam === 'radiator' && pick % 3 === 0) {
        for (let q = 0; q < 4; q++) f.box(a + 50 + q * ((cw - 100) / 3), roofY + 90, cz, 8, 40, cd - 60, M.copper);
      } else if (fam === 'vault' && pick === 4) {
        f.box(cx, roofY + 72, cz, cw * 0.55, 6, cd * 0.5, M.glass);
      } else if (pick === 5) {
        f.box(cx, roofY + 80, cz, 110, 24, 110, M.dark);
        f.cyl(cx, roofY + 96, cz, 34, 10, M.steel);
      } else if (pick === 7) {
        f.box(cx, roofY + 72, cz, cw * 0.7, 6, 20, M.dark);
      }
    }
  }
  // rurociąg przy licu (Jowisz) albo świetlik korytarza transferowego
  const cz0 = l.corridor.z0 + 80;
  const cz1 = l.frontZ - 120;
  if (fam === 'radiator') {
    for (const [dz, r, mat] of [[-80, 26, M.copper], [0, 20, M.steel], [80, 26, M.copper]]) {
      f.cyl(0, roofY + 110, (cz0 + cz1) / 2 + dz, r, x1 - x0 - 200, mat, [0, 0, Math.PI / 2]);
    }
  } else {
    // świetlik: szkło (poświata nocą), nie emiter — długi jasny pas zalewałby bloom
    f.box(0, roofY + 74, (cz0 + cz1) / 2, x1 - x0 - 300, 6, 60, M.glass);
    for (let x = x0 + 200; x < x1 - 200; x += 700) f.box(x, roofY + 80, (cz0 + cz1) / 2, 20, 8, 90, M.pale);
  }
  return k;
}

/**
 * Scena hangaru z układu (createHangarLayout) i stylu.
 * Wynik: { sets, plates, labels, groups, lamps, rig: { drums: [grupa] } }.
 */
export function buildHangarScene(l, style) {
  const f = new PortRecorder();
  const plates = [];
  const labels = [];
  const groups = [];
  const lamps = [];
  const addGroup = (desc) => {
    groups.push(desc);
    return groups.length;
  };
  const M = PB_MAT;
  const LC = style.labels;
  const hw = l.halfWidth;
  const H = l.wallTop;
  const W = l.wall;
  const zc = (l.backZ + l.frontZ) / 2;
  const len = l.frontZ - l.backZ;
  // pokład hali i płyta przed bramami, korpus pod nimi (bębny w głąb)
  plate(plates, l.footprint, -116, 116, M.floor);
  plate(plates, [[-hw, l.frontZ], [hw, l.frontZ], [hw, l.apronZ1], [-hw, l.apronZ1]], -90, 90, M.floor);
  plate(plates, [[-hw, l.backZ], [hw, l.backZ], [hw, l.apronZ1], [-hw, l.apronZ1]], -620, 504, M.dark);
  // ściany: lico z bramami, boki, tył (listwy jak K-7, przypory, pas świetlny)
  const wallRun = (x, z, w, d, rot = 0) => {
    f.box(x, H / 2, z, w, H, d, M.steel, rot);
    f.box(x, H - 12, z, w + 10, 24, d + 10, M.pale, rot);
    f.box(x, 46, z, w + 8, 92, d + 8, M.dark, rot);
  };
  wallRun(0, l.backZ + W / 2, 2 * hw, W);
  for (const side of [-1, 1]) {
    wallRun(side * (hw - W / 2), zc, W, len);
    f.fx(1, PB_FX.steady);
    f.box(side * (hw + 3), 170, zc, 5, 7, len - 200, M.cyan);
    f.nofx();
    for (let z = l.backZ + 300; z < l.frontZ - 200; z += 520) f.box(side * (hw + 18), 220, z, 34, 440, 70, M.dark);
    wallDressing(f, style.walls, side * hw, side, l.backZ + 200, l.frontZ - 300);
  }
  const zf = l.frontZ - W / 2;
  const cuts = l.gates.map((g) => [g.x - g.width / 2 - g.jamb, g.x + g.width / 2 + g.jamb]).sort((a, b) => a[0] - b[0]);
  let cx = -hw;
  for (const [c0, c1] of cuts) {
    if (c0 - cx > 1) wallRun((cx + c0) / 2, zf, c0 - cx, W);
    cx = c1;
  }
  if (hw - cx > 1) wallRun((cx + hw) / 2, zf, hw - cx, W);
  for (let x = -hw + 400; x < hw - 300; x += 600) {
    if (cuts.some(([c0, c1]) => x > c0 - 80 && x < c1 + 80)) continue;
    f.box(x, 220, l.frontZ + 14, 40, 440, 30, M.dark);
    f.box(x, 395, l.frontZ + 4, 200, 20, 10, M.white);
  }
  // bramy: ościeża, nadproże (FG), sygnalizacja, światła wlotu biegnące do bramy
  for (const g of l.gates) {
    const inGate = g.kind === 'in';
    for (const s of [-1, 1]) {
      const jx = g.x + s * (g.width / 2 + g.jamb / 2);
      f.box(jx, H / 2, zf, g.jamb, H, W + 60, M.yellow);
      f.fx(1, PB_FX.steady);
      f.box(jx - s * (g.jamb / 2 + 3), 300, l.frontZ + 6, 6, 400, 6, M.cyan);
      f.nofx();
    }
    f.set = 'fg';
    f.box(g.x, H - 50, zf, g.width + 2 * g.jamb, 100, W + 80, M.dark);
    f.box(g.x, H - 4, zf, g.width + 2 * g.jamb + 30, 12, W + 90, M.yellow);
    f.fx(1.3, inGate ? PB_FX.status : PB_FX.blink, inGate ? 0 : 0.2, inGate ? HANGAR_CH.gateIn : 0.8);
    for (const s of [-0.3, 0, 0.3]) f.box(g.x + s * g.width, H - 60, l.frontZ + 48, 60, 24, 8, inGate ? M.status : M.warm);
    f.nofx();
    f.set = 'bg';
    // pas na płycie przed bramą
    const a0 = l.frontZ + 20;
    const a1 = l.apronZ1 - 20;
    for (const s of [-1, 1]) for (let z = a0 + 40; z < a1; z += 130) stripe(f, g.x + s * (g.width / 2 - 40), z, 8, 70, M.paintCold);
    arrow(f, g.x, (a0 + a1) / 2, 220, M.paintCold, inGate ? -1 : 1);
    hazard(f, g.x - g.width / 2, g.x + g.width / 2, a0 + 20, 36);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const z = a1 - 30 - k * ((a1 - a0 - 60) / 5);
        f.fx(1.2, PB_FX.chase, inGate ? k / 6 : 1 - k / 6, 1.2);
        f.box(g.x + s * (g.width / 2 + 40), 6, z, 16, 6, 30, inGate ? M.green : M.warm);
        f.nofx();
      }
    }
    label(labels, inGate ? 'IN' : 'OUT', g.x, (a0 + a1) / 2 + (inGate ? 150 : -150), 420, 150, LC.gate, inGate ? 'HANGAR ENTRY / HOLD FOR GREEN' : 'HANGAR EXIT / KEEP CLEAR');
  }
  // pas kolejki przed bramą IN: słupki z lampami (świecą do długości kolejki)
  const q = l.queue;
  q.slots.forEach((s, k) => {
    for (const side of [-1, 1]) {
      const bx = s.x + side * 560;
      f.box(bx, 70, s.z, 36, 60, 36, M.dark);
      f.set = 'fg';
      f.fx(1.3, PB_FX.queue, k, HANGAR_CH.queue);
      f.box(bx, 122, s.z, 24, 8, 24, M.cyan);
      f.nofx();
      f.set = 'bg';
    }
  });
  // dach (FG, nieprzezroczysty — w hangarze statków nie widać) z wierzchami bębnów
  f.set = 'fg';
  const roofY = l.roofBase;
  plate(plates, l.footprint, roofY, 60, M.dark, 'fg');
  // pola dachu: panele wokół bębnów i wind (styl rodziny)
  hangarRoofPanels(f, l, style, roofY);
  const drums = l.drums.map((d) => buildDrumTop(f, addGroup, d, roofY + 60, style));
  // pierścienie osadzenia bębnów w dachu (nieruchome)
  for (const d of l.drums) {
    f.cyl(d.x, roofY + 58, d.z, d.outerR - 10, 8, M.pale);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      f.box(d.x + Math.cos(a) * (d.outerR + 20), roofY + 70, d.z + Math.sin(a) * (d.outerR + 20), 60, 20, 26, M.yellow, -a);
    }
  }
  // zatoka ciężka: włazy wind (pokrywy dwudzielne), obramowanie, lampy zajętości
  const hatches = [];
  if (l.heavy) {
    for (const p of l.heavy.pads) {
      f.box(p.x, roofY + 62, p.z, p.padBeam + 80, 10, p.padLength + 80, M.yellow);
      for (const s of [-1, 1]) {
        f.box(p.x, roofY + 72, p.z + s * p.padLength / 4, p.padBeam - 20, 14, p.padLength / 2 - 20, s < 0 ? M.steel : M.pale);
        for (let k = 0; k < 4; k++) f.box(p.x, roofY + 80, p.z + s * (p.padLength / 4 - 300 + k * 200), p.padBeam - 80, 4, 18, M.dark);
      }
      hatches.push(p.id);
      f.fx(1.2, PB_FX.fill, 0.5, HANGAR_CH.heavy);
      for (const s of [-1, 1]) f.box(p.x + s * (p.padBeam / 2 + 30), roofY + 80, p.z, 20, 10, 60, M.warm);
      f.nofx();
    }
    label(labels, 'HEAVY LIFT', l.heavy.x, l.heavy.z - l.heavy.depth / 2 + 180, 1000, 160, LC.bank, `${l.heavy.pads.length} x ${l.heavy.levels} / CAPITAL + MEGA`, 0, roofY + 80, 'fg');
  }
  // światła przeszkodowe na narożnikach, reflektory lica
  f.fx(1.6, PB_FX.blink, 0.0, 0.5);
  for (const sx of [-1, 1]) for (const zz of [l.backZ + 80, l.frontZ - 80]) f.box(sx * (hw - 60), roofY + 120, zz, 16, 12, 16, M.red);
  f.nofx();
  f.set = 'bg';
  for (const d of l.drums) {
    const tag = d.id.slice(d.id.lastIndexOf('-') + 1);
    label(labels, tag, d.x, d.z + d.outerR + 170, 560, 150, LC.hub, `${d.slots} x ${d.levels} = ${d.capacity}`, 0, roofY + 75, 'fg');
  }
  label(labels, l.id, 0, l.corridor.z0 + (l.frontZ - l.corridor.z0) * 0.55, 1300, 300, LC.hub, `PARKING HANGAR / ${l.capacity.total} BERTHS`, 0, roofY + 70, 'fg');
  // reflektory płyty (światło w shaderze)
  for (const g of l.gates) lamps.push([g.x, k7HeightToZ(360), l.frontZ + 250, g.kind === 'in' ? 2 : 1]);
  if (groups.length + 1 > PB_MAX_GROUPS) throw new Error(`hangar: ${groups.length} grup > ${PB_MAX_GROUPS - 1}`);
  return {
    sets: f.sets, plates, labels, groups, lamps,
    rig: { drums, hatches },
    instances: f.count()
  };
}

