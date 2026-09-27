// Budowle portowe (Z7) jako DANE instancji — bez Three (testy node czytają je
// wprost). Wzór: haloPortK7Build.js (hala K-7): rejestrator prostopadłościanów,
// walców i torusów w zestawach
//   bg    pod statkami (pokład, łoża, ściany, rusztowania) — warstwa BG,
//   fg    nad statkami (mosty suwnic, żurawie, ramiona, dach hangaru) — FG,
//   roof  dach suchego doku — FG, zanika, gdy statek w środku (jak dach K-7),
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
  slipBase: (i) => 4 * i,   // + 0 praca, + 1 czoło budowy, + 2 zejście (światła), + 3 flagi bloków (1 = suwnica A, 2 = B)
  dockWork: 12,
  dockFront: 13,
  dockDoors: 14,
  dockStatus: 15
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
// Suwnica bramowa pochylni: grupy most (z), wózek (x), zblocze z blokiem
// poszycia (wysokość, flaga widoczności bloku).
function buildSlipGantry(f, addGroup, slip, k) {
  const M = PB_MAT;
  const g = slip.gantry;
  const half = g.span / 2;
  const top = g.legTop;
  f.set = 'fg';
  const gBridge = addGroup({ kind: 'slip-bridge', slip: slip.index, which: k, x: slip.x });
  f.group = gBridge;
  // nogi (A-rama przy każdej szynie), podwaliny z kołami — profil ≤ 1/20 rozpiętości
  for (const s of [-1, 1]) {
    const x = s * half;
    f.box(x, 36, 0, 40, 30, 230, M.dark);
    for (const zz of [-85, 85]) f.cyl(x, 20, zz, 18, 26, M.rail, [0, 0, Math.PI / 2]);
    for (const zz of [-90, 90]) f.beam([x, 44, zz], [x, top, zz * 0.2], g.leg, M.yellow);
    f.beam([x, 150, -70], [x, 150, 70], 14, M.steel);
    f.beam([x, 300, -48], [x, 300, 48], 12, M.steel);
  }
  // most: dwie belki skrzynkowe, kratownica, pomost, kabina
  for (const zz of [-g.girderGap / 2, g.girderGap / 2]) {
    f.box(0, top + 20, zz, g.span + 70, g.girderH, g.girder, M.yellow);
    f.box(0, top + 20 + g.girderH / 2 + 3, zz, g.span + 60, 5, g.girder - 6, M.rail);
    const n = Math.max(4, Math.round(g.span / 110));
    for (let i = 0; i < n; i++) {
      const x0 = -half + i * (g.span / n);
      f.beam([x0, top + 6, zz], [x0 + g.span / n, top + 34, zz], 8, M.steel);
    }
  }
  f.box(0, top + 2, 0, g.span - 40, 6, g.girderGap - g.girder, M.dark);
  f.box(-half + 70, top - 24, g.girderGap / 2 + 26, 70, 40, 44, M.pale);
  f.box(-half + 70, top - 22, g.girderGap / 2 + 49, 56, 18, 4, M.glass);
  f.fx(1, PB_FX.blink, hash1(slip.index * 7 + k), 0.7);
  for (const s of [-1, 1]) f.box(s * (half + 12), top + 42, 0, 12, 10, 12, M.warm);
  f.nofx();
  // wózek
  const gTrolley = addGroup({ kind: 'slip-trolley', parent: gBridge, slip: slip.index, which: k });
  f.group = gTrolley;
  f.box(0, top + 46, 0, 96, 26, g.girderGap + 30, M.dark);
  f.box(0, top + 64, 0, 64, 20, 70, M.yellow);
  f.cyl(0, top + 58, 0, 20, 70, M.rail, [0, 0, Math.PI / 2]);
  // zblocze (liniowo w grupie): trawersa, liny, blok poszycia (flaga bitowa)
  const gHoist = addGroup({ kind: 'slip-hoist', parent: gTrolley, slip: slip.index, which: k });
  f.group = gHoist;
  f.mode = 'lin';
  f.box(0, 0, 0, 150, 12, 36, M.yellow);
  for (const xx of [-60, 60]) f.box(xx, 8, 0, 8, 10, 26, M.dark);
  const base = 4 * slip.index;
  f.fx(1, PB_FX.show, k === 0 ? 1 : 2, base + 3);
  f.box(0, -26, 0, 120, 30, 86, k === 0 ? M.pale : M.steel);
  f.box(0, -10, 0, 124, 4, 90, M.dark);
  f.nofx();
  f.mode = 'abs';
  // liny (grupa ze skalą pionową liczoną z położenia zblocza)
  const gCables = addGroup({ kind: 'slip-cables', parent: gTrolley, slip: slip.index, which: k });
  f.group = gCables;
  f.mode = 'lin';
  for (const xx of [-44, 44]) for (const zz of [-12, 12]) f.box(xx, 0, zz, 3, 1, 3, M.black);
  f.mode = 'abs';
  f.group = 0;
  f.set = 'bg';
  return { bridge: gBridge, trolley: gTrolley, hoist: gHoist, cables: gCables, top };
}

// Żuraw wieżowy (grupa obrotu, wózek wysięgnika, hak) na grzbiecie.
function buildTowerCrane(f, addGroup, t, i) {
  const M = PB_MAT;
  const m = t.mast;
  // fundament i maszt kratowy (4 słupy + skratowanie)
  f.box(t.x, 10, t.z, 120, 20, 120, M.dark);
  f.set = 'fg';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(t.x + sx * m / 2, t.height / 2, t.z + sz * m / 2, 6, t.height, 6, M.yellow);
  for (let y = 40; y < t.height - 40; y += 70) {
    f.beam([t.x - m / 2, y, t.z - m / 2], [t.x + m / 2, y + 60, t.z - m / 2], 3, M.yellow);
    f.beam([t.x - m / 2, y, t.z + m / 2], [t.x + m / 2, y + 60, t.z + m / 2], 3, M.yellow);
    f.beam([t.x - m / 2, y + 30, t.z - m / 2], [t.x - m / 2, y + 90, t.z + m / 2], 3, M.yellow);
    f.beam([t.x + m / 2, y + 30, t.z - m / 2], [t.x + m / 2, y + 90, t.z + m / 2], 3, M.yellow);
  }
  const gSlew = addGroup({ kind: 'tower-slew', tower: i, x: t.x, z: t.z, y: t.height });
  f.group = gSlew;
  f.mode = 'lin';
  // obrotnica, kabina, wysięgnik (kratownica trójkątna), przeciwwysięgnik z balastem
  f.box(0, 0, 0, 56, 22, 56, M.dark);
  f.box(22, 12, -34, 34, 26, 30, M.pale);
  f.box(22, 12, -50, 28, 12, 3, M.glass);
  const J = t.jib;
  for (const zz of [-10, 10]) f.box(J / 2, 22, zz, J, 6, 4, M.yellow);
  f.box(J / 2, 44, 0, J - 20, 5, 4, M.yellow);
  for (let x = 20; x < J - 20; x += 50) {
    f.beam([x, 22, -10], [x + 25, 44, 0], 3, M.yellow);
    f.beam([x + 25, 44, 0], [x + 50, 22, 10], 3, M.yellow);
  }
  const C = t.counterJib;
  f.box(-C / 2, 24, 0, C, 10, 24, M.yellow);
  f.box(-C + 40, 10, 0, 70, 34, 40, M.dark);
  f.beam([0, 70, 0], [J * 0.6, 26, 0], 2, M.rail);
  f.beam([0, 70, 0], [-C + 40, 28, 0], 2, M.rail);
  f.box(0, 60, 0, 10, 40, 10, M.yellow);
  f.fx(1.6, PB_FX.blink, 0.13 * i, 0.5);
  f.box(0, 82, 0, 8, 6, 8, M.red);
  f.box(J, 30, 0, 7, 6, 7, M.red);
  f.nofx();
  const gTrolley = addGroup({ kind: 'tower-trolley', parent: gSlew, tower: i });
  f.group = gTrolley;
  f.box(0, 16, 0, 26, 8, 26, M.dark);
  const gHook = addGroup({ kind: 'tower-hook', parent: gTrolley, tower: i });
  f.group = gHook;
  f.box(0, 0, 0, 20, 12, 16, M.yellow);
  f.box(0, 8, 0, 2, 16, 2, M.black);
  f.mode = 'abs';
  f.group = 0;
  f.set = 'bg';
  return { slew: gSlew, trolley: gTrolley, hook: gHook };
}

// Pochylnia: łoże, bloki stępki, kołyski boczne, szyny suwnic, rusztowania,
// spawarki, oznakowanie pola i płyty zejścia.
function buildSlip(f, plates, labels, s, berth, style) {
  const M = PB_MAT;
  const LC = style.labels;
  const x = s.x;
  const hb = s.padBeam / 2;
  const zc = (s.z0 + s.z1) / 2;
  const len = s.z1 - s.z0;
  // pole pochylni (ciemne płyty łoża)
  f.box(x, 0.8, zc, s.padBeam, 1.4, len, M.deckPad);
  for (const side of [-1, 1]) {
    stripe(f, x + side * hb, zc, 6, len, M.paint);
    for (let z = s.z0 + 40; z < s.z1; z += 120) stripe(f, x + side * (hb + 16), z, 22, 8, M.yellow);
  }
  stripe(f, x, s.z0, s.padBeam, 6, M.paint);
  // bloki stępki (oś) i kołyski boczne (przy dużych kadłubach)
  for (let z = s.z0 + 60; z < s.z1 - 40; z += 90) {
    f.box(x, 22, z, 46, 44, 26, M.dark);
    f.box(x, 46, z, 40, 4, 22, M.orange);
  }
  for (let z = s.z0 + 120; z < s.z1 - 80; z += 180) {
    for (const side of [-1, 1]) {
      f.box(x + side * 205, 28, z, 30, 56, 40, M.dark);
      f.beam([x + side * 205, 56, z], [x + side * 120, 60, z], 12, M.steel, 22);
      f.box(x + side * 118, 62, z, 18, 6, 26, M.yellow);
    }
  }
  // szyny suwnic
  for (const rx of s.rails) {
    const rz = (s.railZ0 + s.railZ1) / 2;
    const rl = s.railZ1 - s.railZ0;
    f.box(rx, 10, rz, 60, 20, rl, M.dark);
    f.box(rx, 22, rz, 22, 5, rl, M.rail);
    for (let z = s.railZ0 + 20; z < s.railZ1; z += 60) f.box(rx, 21, z, 50, 3, 8, M.rail);
  }
  // rusztowania przy burtach (y 0–104): słupy, pomosty, lampy robocze, spawarki
  const sp = 250;
  for (const side of [-1, 1]) {
    const xs = x + side * (hb + 22);
    f.box(xs, 36, zc, 30, 4, len - 40, M.steel);
    f.box(xs, 72, zc, 30, 4, len - 40, M.steel);
    let k = 0;
    for (let z = s.z0 + 30; z < s.z1 - 10; z += sp, k++) {
      f.box(xs - 13, 52, z, 5, 104, 5, M.yellow);
      f.box(xs + 13, 52, z, 5, 104, 5, M.yellow);
      if (k % 2 === 0) f.beam([xs, 4, z + 20], [xs, 70, z + 110], 4, M.steel, 20);
      f.fx(1, PB_FX.steady);
      f.box(xs - side * 10, 106, z, 8, 4, 16, M.warm);
      f.nofx();
      // spawarka przy krawędzi pola: ramię nad burtę kadłuba, końcówka iskrzy przy czole
      const zw = z + sp / 2;
      if (zw > s.z1 - 30) continue;
      const tipX = x + side * (hb - 150);
      f.cyl(x + side * (hb - 14), 30, zw, 14, 60, M.dark);
      f.beam([x + side * (hb - 14), 60, zw], [x + side * (hb - 90), 104, zw], 10, M.orange);
      f.beam([x + side * (hb - 90), 104, zw], [tipX, 100, zw], 8, M.orange);
      f.fx(1, PB_FX.weld, (zw - s.z0) / len, 4 * s.index);
      f.box(tipX, 98, zw, 7, 6, 7, M.white);
      f.nofx();
    }
  }
  // płyta zejścia: pas, strzałki, światła biegnące w kosmos (gdy zejście)
  const az0 = s.z1;
  const az1 = s.apronZ1;
  plate(plates, [[x - hb - 60, az0], [x + hb + 60, az0], [x + hb + 60, az1], [x - hb - 60, az1]], -60, 58, M.floor);
  hazard(f, x - hb, x + hb, az0 + 30, 36);
  for (const side of [-1, 1]) for (let z = az0 + 90; z < az1 - 30; z += 130) stripe(f, x + side * (hb - 40), z, 8, 70, M.paintCold);
  arrow(f, x, (az0 + az1) / 2 + 60, 200, M.paintCold, 1);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z = az0 + 70 + k * ((az1 - az0 - 120) / 4);
      f.fx(1.2, PB_FX.launch, k / 5, 4 * s.index + 2);
      f.box(x + side * (hb + 30), 6, z, 14, 6, 26, M.green);
      f.nofx();
    }
  }
  label(labels, `SLIPWAY ${s.index + 1}`, x, az1 - 110, s.padBeam * 0.8, 90, LC.capital, `${berth.maxLength} x ${berth.maxBeam} / LAUNCH LANE`);
  label(labels, s.id, x, s.z0 + 90, s.padBeam * 0.55, 70, LC.berth, 'KEEL LINE');
}

// Hala prefabrykacji bloków na tyle pochylni (dach wg rodziny, bramy na pochylnie).
function buildWorkshop(f, labels, l, style) {
  const M = PB_MAT;
  const w = l.workshop;
  if (!w) return;
  const xc = (w.x0 + w.x1) / 2;
  const zc = (w.z0 + w.z1) / 2;
  const W = w.x1 - w.x0;
  const D = w.z1 - w.z0;
  const H = w.height;
  f.box(xc, H / 2, zc, W, H, D, M.steel);
  f.box(xc, H - 8, zc, W + 20, 16, D + 20, M.pale);
  for (let x = w.x0 + 140; x < w.x1 - 60; x += 280) {
    f.box(x, H / 2, w.z1 + 4, 24, H - 20, 10, M.dark);
    f.box(x, H / 2, w.z0 - 4, 24, H - 20, 10, M.dark);
  }
  f.fx(1, PB_FX.steady);
  f.box(xc, 160, w.z1 + 9, W - 80, 7, 4, M.cyan);
  f.nofx();
  // bramy bloków na osi pochylni (ramy i skrzydła)
  for (const s of l.slips) {
    f.box(s.x, 120, w.z1 + 12, 420, 240, 14, M.dark);
    for (const side of [-1, 1]) f.box(s.x + side * 222, 126, w.z1 + 14, 24, 252, 20, M.yellow);
    f.box(s.x, 256, w.z1 + 14, 468, 24, 20, M.yellow);
    f.fx(1.1, PB_FX.blink, s.index * 0.37, 0.4);
    for (const side of [-1, 1]) f.box(s.x + side * 200, 272, w.z1 + 22, 12, 8, 6, M.warm);
    f.nofx();
  }
  familyRoof(f, style.family, w.x0 + 20, w.x1 - 20, w.z0 + 20, w.z1 - 20, H - 60);
  label(labels, 'PREFAB / BLOCK HALL', xc, zc, Math.min(W * 0.6, 1400), 110, style.labels.hub, `${l.id} / ${l.slips.length} SLIPWAYS`, 0, H + 1);
}

// Suchy dok: pokład z polem capital, ściany, drzwi teleskopowe (grupy), nadproże
// (FG), suwnice remontowe (FG), ramiona serwisowe (FG), lampy, dach (roof).
function buildDrydock(f, plates, labels, lamps, addGroup, l, style) {
  const M = PB_MAT;
  const d = l.drydock;
  const b = l.berths.find((v) => v.kind === 'drydock');
  const LC = style.labels;
  const x = d.x;
  const H = d.wallTop;
  const hw = d.halfWidth;
  const len = d.z1 - d.z0;
  const zc = (d.z0 + d.z1) / 2;
  // pole capital (standard K-7) i oznakowanie
  f.box(x, 0.8, b.z, b.padBeam, 1.4, b.padLength, M.deckPad);
  for (const side of [-1, 1]) {
    stripe(f, x + side * b.padBeam / 2, b.z, 6, b.padLength, M.paint);
    stripe(f, x, b.z + side * b.padLength / 2, b.padBeam, 6, M.paint);
    const count = Math.round(b.padLength / 240);
    for (let j = 0; j < count; j++) stripe(f, x + side * (b.padBeam / 2 + 15), b.z - b.padLength / 2 + 24 + j * (b.padLength - 48) / (count - 1), 22, 8, M.yellow);
  }
  for (let q = -b.padLength * 0.37; q < b.padLength * 0.37; q += 190) stripe(f, x, b.z + q, 8, 65, M.paintCold);
  const cx = b.capture.halfWidth;
  const cz = b.capture.halfLength;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    stripe(f, x + sx * cx, b.z + sz * (cz - 12), 4, 24, M.paintCold);
    stripe(f, x + sx * (cx - 12), b.z + sz * cz, 24, 4, M.paintCold);
  }
  label(labels, 'DRY DOCK', x, b.z + b.padLength / 2 - 190, b.padBeam * 0.76, 135, LC.berthLead, 'CAPITAL REFIT / REVERSIBLE');
  label(labels, 'STOP', x, b.z - b.padLength / 2 + 120, 250, 58, LC.stop);
  label(labels, d.id, x, d.z1 - 200, 700, 150, LC.hub, 'DRY DOCK / DOORS CLOSE ON LOCK');
  hazard(f, x - hw, x + hw, d.z1 + d.wall / 2 - 70, 40);
  // ściany (jak K-7: listwy, przypory, pas świetlny) + kieszenie drzwi
  f.box(x, H / 2, d.backZ + d.wall / 2, 2 * d.outerHalf, H, d.wall, M.steel);
  for (const side of [-1, 1]) {
    const wx = x + side * (hw + d.wall / 2);
    f.box(wx, H / 2, zc + d.wall / 2, d.wall, H, len + d.wall, M.steel);
    f.box(wx, H - 14, zc + d.wall / 2, d.wall + 12, 28, len + d.wall, M.pale);
    f.box(wx, 46, zc + d.wall / 2, d.wall + 10, 92, len + d.wall, M.dark);
    f.fx(1, PB_FX.steady);
    f.box(wx - side * (d.wall / 2 + 3), 160, zc, 4, 7, len - 60, M.cyan);
    f.nofx();
    for (let z = d.z0 + 200; z < d.z1 - 100; z += 390) {
      f.box(wx + side * (d.wall / 2 + 16), 215, z, 30, 430, 60, M.dark);
      f.fx(0.6, PB_FX.steady);
      f.box(wx - side * (d.wall / 2 + 6), 395, z, 6, 16, 160, M.white);
      f.nofx();
    }
    // kieszeń drzwi (poza ścianą, przy czole)
    const px = x + side * (d.outerHalf + d.door.pocket / 2);
    f.box(px, H / 2, d.door.z, d.door.pocket, H, d.wall + 40, M.dark);
    f.box(px, H - 10, d.door.z, d.door.pocket + 10, 20, d.wall + 50, M.yellow);
    wallDressing(f, style.walls, x + side * d.outerHalf, side, d.z0 + 100, d.z1 - 200);
  }
  // drzwi teleskopowe: 3 skrzydła na stronę, każde grupa (ruch w x)
  const doors = [];
  const leafW = hw / d.door.leaves;
  for (const side of [-1, 1]) {
    for (let k = 0; k < d.door.leaves; k++) {
      const g = addGroup({ kind: 'dock-door', side, leaf: k });
      f.group = g;
      // zamknięte: skrzydło k od osi ku ścianie; otwarte: w kieszeni (render liczy przesunięcie)
      const lx = x + side * (leafW * (k + 0.5));
      const lz = d.door.z + (k - 1) * (d.door.thick * 0.9);
      f.box(lx, H / 2, lz, leafW - 6, H - 20, d.door.thick, k % 2 ? M.steel : M.pale);
      f.box(lx, H / 2, lz + d.door.thick / 2 + 2, leafW - 40, 18, 4, M.yellow);
      f.box(lx, 60, lz + d.door.thick / 2 + 2, leafW - 30, 24, 4, M.black);
      doors.push({ group: g, side, leaf: k, closedX: lx, openX: x + side * (d.outerHalf + d.door.pocket / 2 + (k - 1) * 6), leafW });
      f.group = 0;
    }
  }
  // nadproże nad otworem (statek przelatuje pod nim) + światła stanu drzwi
  f.set = 'fg';
  f.box(x, H - 40, d.door.z, 2 * d.outerHalf, 80, d.wall + 60, M.dark);
  f.box(x, H - 2, d.door.z, 2 * d.outerHalf + 20, 10, d.wall + 70, M.yellow);
  f.fx(1.2, PB_FX.status, 0, YARD_CH.dockDoors);
  for (const sx of [-0.62, -0.2, 0.2, 0.62]) f.box(x + sx * hw, H - 44, d.door.z + d.wall / 2 + 34, 36, 16, 6, M.status);
  f.nofx();
  // suwnice remontowe: most na szynach koron ścian, wózek, głowica z ramionami
  const G = d.gantry;
  const gantries = [];
  for (let k = 0; k < G.count; k++) {
    const gBridge = addGroup({ kind: 'dock-bridge', which: k });
    f.group = gBridge;
    for (const zz of [-G.girderGap / 2, G.girderGap / 2]) {
      f.box(x, G.y + 40, zz, 2 * hw + d.wall, G.girderH, G.girder, M.yellow);
      f.box(x, G.y + 40 + G.girderH / 2 + 4, zz, 2 * hw, 8, G.girder - 10, M.rail);
    }
    for (const side of [-1, 1]) {
      f.box(x + side * (hw + d.wall / 2), G.y + 10, 0, d.wall + 30, 40, G.girderGap + 120, M.dark);
      f.fx(1, PB_FX.blink, 0.21 * k + (side > 0 ? 0.5 : 0), 0.6);
      f.box(x + side * (hw - 20), G.y + 96, 0, 12, 10, 12, M.warm);
      f.nofx();
    }
    const gTrolley = addGroup({ kind: 'dock-trolley', parent: gBridge, which: k });
    f.group = gTrolley;
    f.box(0, G.y + 92, 0, 140, 30, G.girderGap + 40, M.dark);
    f.box(0, G.y + 110, 0, 90, 18, 90, M.yellow);
    const gHead = addGroup({ kind: 'dock-head', parent: gTrolley, which: k });
    f.group = gHead;
    f.mode = 'lin';
    f.box(0, 0, 0, 120, 26, 120, M.pale);
    f.cyl(0, -18, 0, 26, 20, M.dark);
    for (const [ax, az] of [[-60, 0], [60, 0], [0, -60], [0, 60]]) {
      f.beam([ax * 0.5, -10, az * 0.5], [ax, -60, az], 7, M.orange);
      f.fx(1, PB_FX.weld, 0.5 + (ax + az) / 480, YARD_CH.dockWork);
      f.box(ax, -64, az, 6, 6, 6, M.white);
      f.nofx();
    }
    f.mode = 'abs';
    f.group = 0;
    gantries.push({ bridge: gBridge, trolley: gTrolley, head: gHead });
  }
  // ramiona serwisowe na ścianach (nad kadłubem): podstawa, dwa człony, końcówka
  for (const a of d.arms) {
    const s = a.side;
    const bx = a.x;
    f.box(bx, a.y, a.z, 40, 60, 90, M.dark);
    const elbow = [bx - s * a.reach * 0.55, a.y + 110, a.z];
    const tip = [bx - s * a.reach, a.y + 30, a.z];
    f.beam([bx, a.y + 20, a.z], elbow, 18, M.orange);
    f.beam(elbow, tip, 14, M.orange);
    f.box(tip[0], tip[1] - 8, tip[2], 20, 18, 20, M.dark);
    f.fx(1, PB_FX.weld, (a.z - d.z0) / len, YARD_CH.dockWork);
    f.box(tip[0], tip[1] - 22, tip[2], 7, 6, 7, M.white);
    f.nofx();
  }
  // lampy sufitowe (widać po zaniku dachu): wąskie, tuż nad progiem bloomu
  f.fx(0.7, PB_FX.steady);
  for (let z = d.z0 + 400; z < d.z1 - 200; z += 700) {
    for (const s of [-0.45, 0.45]) f.box(x + s * hw, 700, z, 90, 5, 12, M.white);
  }
  f.nofx();
  f.set = 'bg';
  // obsługa przy ścianie tylnej: blok, słupy paliwowe, węże w pętlach
  f.box(x, 90, d.z0 + 70, 900, 180, 120, M.dark);
  f.box(x, 186, d.z0 + 70, 860, 12, 110, M.yellow);
  for (const a of b.serviceAnchors) {
    f.box(a.x, 110, a.z + 40, 90, 220, 70, M.steel);
    f.cyl(a.x, 224, a.z + 40, 34, 50, M.black, [0, 0, Math.PI / 2]);
    f.fx(1, PB_FX.status, 0, YARD_CH.dockStatus);
    f.box(a.x, 150, a.z + 78, 20, 12, 4, M.status);
    f.nofx();
  }
  // lampy hali (światło wnętrza w shaderze): nad polem, ciepłe i zimne
  for (const [lx, lz, kind] of [[-0.3, 0.25, 1], [0.3, 0.25, 2], [-0.3, 0.72, 2], [0.3, 0.72, 1]]) {
    if (lamps.length < PB_MAX_LAMPS) lamps.push([x + lx * hw * 2, k7HeightToZ(420), d.z0 + lz * len, kind]);
  }
  // dach (zestaw roof — zanika, gdy statek w doku)
  f.set = 'roof';
  plate(plates, [[x - d.outerHalf, d.backZ], [x + d.outerHalf, d.backZ], [x + d.outerHalf, d.z1 + d.wall], [x - d.outerHalf, d.z1 + d.wall]], d.roofBase, 82, M.dark, 'roof');
  familyRoof(f, style.family, x - d.outerHalf + 20, x + d.outerHalf - 20, d.backZ + 20, d.z1 + d.wall - 20, d.roofBase + 60);
  f.fx(1.5, PB_FX.blink, 0.3, 0.5);
  for (const sx of [-1, 1]) for (const zz of [d.backZ + 60, d.z1 + d.wall - 60]) f.box(x + sx * (d.outerHalf - 50), d.roofBase + 190, zz, 14, 10, 14, M.red);
  f.nofx();
  label(labels, 'D1', x, zc, 600, 400, LC.hub, 'CAPITAL REFIT', 0, d.roofBase + 83, 'roof');
  f.set = 'bg';
  return { doors, gantries };
}

/**
 * Scena stoczni z układu (createShipyardLayout) i stylu (resolvePortBuildingStyle).
 * Wynik: { sets, plates, labels, groups, lamps, rig } — rig: grupy suwnic, żurawi,
 * drzwi i głowic, z których render liczy macierze (portBuildings3D.js).
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
  const M = PB_MAT;
  // pokład i korpus pod nim (megadok: widoczny bok; ring: płyta na podłodze)
  plate(plates, l.footprint, -116, 116, M.floor);
  plate(plates, l.footprint, -420, 304, M.dark);
  for (const s of l.spines) {
    const zc = (s.z0 + s.z1) / 2;
    const len = s.z1 - s.z0;
    f.box(s.x, 10, zc, s.width - 40, 20, len, M.dark);
    for (let z = s.z0 + 20; z < s.z1; z += 40) f.box(s.x, 22, z, s.width - 52, 3, 7, M.rail);
    for (let row = 0; row < 3; row++) f.cyl(s.x + (row - 1) * 40, 40 + row * 10, zc, 12, len - 60, M.copper, [Math.PI / 2, 0, 0]);
  }
  const slipsRig = [];
  for (const s of l.slips) {
    const berth = l.berths.find((b) => b.kind === 'slip' && b.slipIndex === s.index);
    buildSlip(f, plates, labels, s, berth, style);
    const gantries = [];
    for (let k = 0; k < s.gantry.count; k++) gantries.push(buildSlipGantry(f, addGroup, s, k));
    slipsRig.push({ slip: s, gantries });
    if (lamps.length < PB_MAX_LAMPS - 4) lamps.push([s.x, k7HeightToZ(380), (s.z0 + s.z1) / 2, 1]);
  }
  const towers = l.towers.map((t, i) => buildTowerCrane(f, addGroup, t, i));
  buildWorkshop(f, labels, l, style);
  const dock = l.drydock ? buildDrydock(f, plates, labels, lamps, addGroup, l, style) : null;
  if (groups.length + 1 > PB_MAX_GROUPS) throw new Error(`stocznia: ${groups.length} grup > ${PB_MAX_GROUPS - 1}`);
  return {
    sets: f.sets, plates, labels, groups, lamps,
    rig: { slips: slipsRig, towers, dock },
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

