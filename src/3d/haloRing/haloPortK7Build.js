// Budowa hali K-7 jako DANE (bez Three): port funkcji CentralHub.build,
// CraneSystem, FuelHoseSystem i proceduralDockShip z dema K-7 na rejestrator
// instancji. Liczby i układ jak w K-7; wysokości przeliczane na z świata
// (k7HeightToZ: 1:1 pod płaszczyzną lotu, ×0,42 nad nią).
//
// Wynik: listy instancji (prostopadłościan / walec / torus) w trzech zestawach
// — `bg` (pod statkami), `fg` (nad statkami: suwnice, węże, dach) — z kodem
// materiału i indeksem grupy ruchomej; płaskie wielokąty (pokład, fartuchy,
// dach); napisy na pokładzie; definicje węży i grup. Statków NPC scena nie ma
// (2026-09-24: statki i ruch z osobnego systemu).
//
// Kompleks = hala K-7 + jej otwarte zatoki (haloPortBays.js): stanowiska zatok
// w tym samym standardzie (pola, pasy, napisy, lampki stanu) nagrywane w
// układzie huba hali przez przejście ramek — te same instancje i draw calle.
import {
  K7_ABOVE_SCALE,
  K7_HEIGHTS,
  k7CollarPosts,
  k7HeightToZ,
  k7SolidList
} from './haloPortK7Layout.js';
import { baySolidList, haloXfPoint } from './haloPortBays.js';

export const K7_MAT = Object.freeze({
  steel: 0, dark: 1, pale: 2, yellow: 3, orange: 4, teal: 5, floor: 6, rail: 7, black: 8, hose: 9,
  copper: 10, glass: 11, paint: 12, paintCold: 13, cyan: 14, warm: 15, white: 16, red: 17, green: 18, status: 19,
  deckPad: 20
});
export const K7_INSTANCE_STRIDE = 16; // cx cy cz vScale | sx sy sz mat | qx qy qz qw | group 0 0 0

const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const qAxis = (x, y, z, a) => [x * Math.sin(a / 2), y * Math.sin(a / 2), z * Math.sin(a / 2), Math.cos(a / 2)];
// Euler XYZ jak w three.js: q = qx · qy · qz
function quatEuler(rx, ry, rz) {
  return quatMul(quatMul(qAxis(1, 0, 0, rx || 0), qAxis(0, 1, 0, ry || 0)), qAxis(0, 0, 1, rz || 0));
}
// Obrót osi +Y na kierunek d (jak setFromUnitVectors(Y, d))
function quatFromY(dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len;
  const y = dy / len;
  const z = dz / len;
  if (y < -0.999999) return [1, 0, 0, 0];
  // (0,1,0) × d = (z, 0, -x)
  const w = 1 + y;
  const n = Math.hypot(z, 0, -x, w) || 1;
  return [z / n, 0, -x / n, w / n];
}
// pochodna odwzorowania wysokości w punkcie (skala pionowa brył obróconych)
function mapScale(y, extent) {
  const e = Math.max(1, extent);
  return (k7HeightToZ(y + e) - k7HeightToZ(y - e)) / (2 * e);
}

class Recorder {
  constructor() {
    this.sets = { bg: { box: [], cyl: [], torus: [] }, fg: { box: [], cyl: [], torus: [] }, roof: { box: [], cyl: [], torus: [] } };
    this.set = 'bg';
    this.group = 0;
    // 'abs' — wysokości K-7 bezwzględne (k7HeightToZ); 'lin' — lokalne względem
    // ruchomej grupy nad płaszczyzną lotu (tylko skala ×K7_ABOVE_SCALE)
    this.mode = 'abs';
    this.dx = 0;
    this.dz = 0;
    // przejście ramki (zatoka → hub hali): X = ox + x·c − z·s, Z = oz + x·s + z·c
    this.xf = null;
    this._qxf = [0, 0, 0, 1];
  }
  setFrame(xf) {
    this.xf = xf;
    if (xf) this._qxf = qAxis(0, 1, 0, -xf.phi);
  }
  _push(kind, cx, cy, cz, vs, sx, sy, sz, mat, q) {
    let x = cx + this.dx;
    let z = cz + this.dz;
    if (this.xf) {
      const t = this.xf;
      const X = t.ox + x * t.c - z * t.s;
      z = t.oz + x * t.s + z * t.c;
      x = X;
      q = quatMul(this._qxf, q);
    }
    this.sets[this.set][kind].push(x, cy, z, vs, sx, sy, sz, mat, q[0], q[1], q[2], q[3], this.group, 0, 0, 0);
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
  // belka od a do b (oś Y bryły wzdłuż belki), przekrój w × d
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
  // walec K-7: promień r, wysokość h (oś Y), obrót Euler [rx, ry, rz]
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
  ring(x, y, z, r, t, mat, rot = null) {
    const q = rot ? quatEuler(rot[0], rot[1], rot[2]) : [0, 0, 0, 1];
    this._push('torus', x, this._y(y), z, this._vs(y, r), r, r, r, mat, q);
    return this;
  }
}

// Pokład / dach / fartuchy: wypukłe wielokąty wytłoczone w pionie (y od-do, wysokości K-7).
function plate(list, points, bottom, height, mat, set = 'bg') {
  list.push({ points: points.map(([x, z]) => [x, z]), z0: k7HeightToZ(bottom), z1: k7HeightToZ(bottom + height), mat, set });
}

// Napisy na pokładzie (groundText z K-7): pozycja, wymiary, obrót w płaszczyźnie.
function label(list, text, x, z, width, depth, color, small = '', rotation = 0, set = 'bg') {
  list.push({ text, small, color, x, z, width, depth, rotation, y: k7HeightToZ(1.8), set });
}

export function buildK7Scene(layout, ringInfo = {}) {
  const l = layout;
  const f = new Recorder();
  const M = K7_MAT;
  const plates = [];
  const labels = [];
  const groups = [];            // opisy grup ruchomych (indeks = pozycja + 1)
  const hoses = [];
  const lamps = [];             // lampki stanu stanowisk (indeks instancji w bg.box)
  const addGroup = (desc) => { groups.push(desc); return groups.length; };

  // ---- pokład hali
  plate(plates, l.footprint, -116, 116, M.floor);
  plate(plates, l.footprint, -138, 23, M.dark);

  // ---- ściany (K-7 buildWalls): bryły + detale od środka, bramy z ramami
  const solids = k7SolidList(l);
  // (słupy kołnierza rysuje buildHabitatPlug — tu tylko kolizja)
  for (const s of solids) if (!s.id.startsWith('COLLAR')) f.box(s.x, s.y, s.z, s.w, s.h, s.d, M[s.mat], -s.angle);
  for (const e of l.edges) {
    const gate = l.gates.find((g) => g.edge === e.i);
    const segments = gate ? [[0, gate.jamb], [e.length - gate.jamb, e.length]] : [[0, e.length]];
    for (const [s0, s1] of segments) {
      const x = e.a[0] + e.ux * (s0 + s1) / 2;
      const z = e.a[1] + e.uz * (s0 + s1) / 2;
      const len = s1 - s0;
      f.box(x, 46, z, len, 92, 118, M.steel, -e.angle);
      f.box(x, 566, z, len, 28, 122, M.pale, -e.angle);
      const count = Math.max(1, Math.floor(len / 390));
      for (let k = 0; k < count; k++) {
        const a = s0 + (k + 0.5) * (len / count);
        const px = e.a[0] + e.ux * a;
        const pz = e.a[1] + e.uz * a;
        f.box(px - e.nx * 50, 299, pz - e.nz * 50, Math.max(26, len / count - 19), 300, 16, k % 4 === 0 ? M.pale : M.steel, -e.angle);
        f.box(px - e.nx * 68, 395, pz - e.nz * 68, Math.min(len / count - 30, 275), 24, 13, M.white, -e.angle);
        f.box(px - e.nx * 61, 159, pz - e.nz * 61, Math.min(len / count - 30, 275), 7, 12, M.cyan, -e.angle);
        for (const sy of [234, 319]) f.box(px - e.nx * 66, sy, pz - e.nz * 66, Math.min(len / count - 40, 142), 22, 9, M.dark, -e.angle);
        if (len > 250) f.beam([px + e.nx * 100, -50, pz + e.nz * 100], [px + e.nx * 56, 438, pz + e.nz * 56], 36, M.steel);
      }
    }
    if (gate) {
      f.box(e.x, 673, e.z, gate.clearWidth + 155, 145, 174, M.dark, -e.angle);
      f.box(e.x, 635, e.z, gate.clearWidth, 22, 183, M.pale, -e.angle);
      f.box(e.x - e.nx * 91, 623, e.z - e.nz * 91, gate.clearWidth - 60, 12, 12, M.cyan, -e.angle);
      for (const end of [gate.jamb, e.length - gate.jamb]) {
        const x = e.a[0] + e.ux * end;
        const z = e.a[1] + e.uz * end;
        f.box(x, 304, z, 33, 598, 135, M.yellow, -e.angle);
        f.box(x - e.nx * 73, 315, z - e.nz * 73, 17, 434, 16, M.cyan, -e.angle);
        for (let y = 110; y < 580; y += 95) f.box(x + e.nx * 72, y, z + e.nz * 72, 27, 35, 9, M.black, -e.angle);
      }
      for (let k = -1; k <= 1; k++) f.box(e.x + e.ux * k * gate.clearWidth * 0.3, 681, e.z + e.nz * 92, 125, 31, 8, M.green, -e.angle);
      label(labels, gate.id, e.x - e.nx * 140, e.z - e.nz * 140, 360, 88, '#94cdd1', gate.name, -e.angle);
    }
  }

  // ---- pokład: stanowiska, pasy, strzałki (K-7 buildDeck)
  const stripe = (x, z, w, d, mat) => f.box(x, 1.5, z, w, 1.5, d, mat);
  const hubLabel = (text, x, z, width, depth, color, small, rotation) => label(labels, text, x, z, width, depth, color, small, rotation);
  recordBerths(f, hubLabel, lamps, l.berths);
  for (const lane of l.lanes) {
    for (const side of [-1, 1]) for (let z = 3230; z < l.frontZ + l.apronDepth - 70; z += 155) stripe(lane.x + side * 510, z, 8, 74, M.paintCold);
    for (let z = 3380; z < l.frontZ + l.apronDepth - 80; z += 670) {
      arrow(f, lane.x, z, 145, M.paintCold, false);
      for (const side of [-1, 1]) f.box(lane.x + side * 563, 8, z, 23, 6, 75, M.cyan);
    }
  }
  label(labels, 'K-7', 0, l.frontZ - 1210, 940, 330, '#687d83', 'CENTRAL HUB / ' + l.berths.length + ' BERTHS');
  label(labels, 'CLEAR MANOEUVRING AREA', 0, l.frontZ - 720, 1910, 68, '#99a6a2');
  for (const bank of l.sideBanks) {
    const z = (bank.z0 + bank.z1) / 2;
    const length = bank.z1 - bank.z0;
    for (const side of [-1, 1]) for (let zz = bank.z0; zz < bank.z1; zz += 155) stripe(bank.aisleX + side * (bank.aisleWidth / 2), zz, 5, 68, M.paintCold);
    for (let zz = 920; zz < bank.z1; zz += 660) directionArrow(f, bank.aisleX, zz, -Math.PI / 2, 105, M.paintCold);
    label(labels, bank.id + ' / 2L  4M  6S', bank.aisleX, bank.z1 - 35, 850, 86, '#aab7ad', 'LOGISTICS TAXI / KEEP CLEAR');
    const x = bank.side * (l.halfWidth - 165);
    f.box(x, 10, z, 95, 20, length, M.dark);
    for (let zz = bank.z0; zz < bank.z1; zz += 40) f.box(x, 22, zz, 83, 3, 7, M.rail);
    for (const off of [-56, 56]) stripe(x + off, z, 4, length, M.paint);
  }
  // listwy między stanowiskami kapitalnymi (środkowa szersza) i na zewnątrz skrajnych
  const capXs = l.berths.filter((b) => b.size === 'CAPITAL').map((b) => b.x).sort((a, b) => a - b);
  const dividers = [capXs[0] - 845];
  for (let i = 0; i + 1 < capXs.length; i++) dividers.push((capXs[i] + capXs[i + 1]) / 2);
  dividers.push(capXs[capXs.length - 1] + 845);
  for (const x of dividers) {
    const inner = Math.abs(x) < 1;
    const length = inner ? 3030 : 3560;
    const z = inner ? 2260 : 2500;
    const w = inner ? 130 : 82;
    f.box(x, 6, z, w, 12, length, M.dark);
    for (let zz = z - length / 2 + 12; zz < z + length / 2; zz += 24) f.box(x, 13, zz, w - 10, 3, 4, M.rail);
  }

  // ---- wyposażenie (K-7 buildEquipment)
  f.box(0, 331, 583, 340, 28, 400, M.pale);
  f.box(0, 227, 780, 267, 80, 16, M.glass);
  f.box(0, 124, 778, 260, 31, 11, M.yellow);
  for (const x of [-108, 108]) f.box(x, 300, 789, 30, 13, 7, M.warm);
  label(labels, 'PORT CONTROL', 0, 863, 340, 61, '#a6bbb6');
  for (const bank of l.sideBanks) {
    const side = bank.side;
    for (let k = 0; k < 4; k++) {
      const x = side * (l.halfWidth - 1300 + k * 290);
      const z = 420;
      f.box(x, 126, z, 232, 9, 208, M.dark);
      for (let i = 0; i < 6; i++) f.box(x - 84 + i * 33, 64, z + 104, 8, 107, 8, M.steel);
    }
    for (const id of bank.berthIds) {
      const b = l.berths.find((v) => v.id === id);
      const x = b.servicePoint.x;
      const z = b.servicePoint.z;
      f.box(x - side * 34, 94, z, 10, 105, 60, M.pale);
      f.box(x - side * 41, 117, z, 5, 21, 36, M.glass);
      f.box(x - side * 45, 68, z, 7, 12, 15, M.green);
      f.cyl(x, 175, z, 21, 36, M.yellow, [Math.PI / 2, 0, 0]);
      for (const off of [-b.length * 0.35, b.length * 0.35]) {
        f.cyl(side * (l.halfWidth - 185), 36, b.z + off, 13, 70, M.steel);
        f.cyl(side * (l.halfWidth - 185), 73, b.z + off, 19, 8, M.yellow);
      }
    }
    const serviceLength = bank.z1 - bank.z0;
    const mid = (bank.z0 + bank.z1) / 2;
    for (let row = 0; row < 3; row++) {
      const x = side * (l.halfWidth - 31);
      const y = 160 + row * 76;
      f.cyl(x, y, mid, 16, serviceLength, M.copper, [Math.PI / 2, 0, 0]);
      for (let z = bank.z0; z < bank.z1; z += 190) {
        f.box(x - side * 24, y, z, 12, 46, 38, M.black);
        f.ring(x, y, z, 19, 3, M.rail);
      }
    }
  }

  // ---- fartuchy przed bramami i boje podejścia (K-7 buildAprons)
  for (const gate of l.gates) {
    const half = gate.clearWidth / 2;
    const depth = gate.id === 'G-01' ? l.apronDepth : 710;
    const quad = [[-half, -30], [half, -30], [half, depth], [-half, depth]].map(([u, v]) => [gate.x + gate.ux * u + gate.nx * v, gate.z + gate.uz * u + gate.nz * v]);
    plate(plates, quad, -59, 57, M.floor);
    for (const side of [-1, 1]) {
      const u = side * (half - 25);
      for (let d = 80; d < depth; d += 155) f.box(gate.x + gate.ux * u + gate.nx * d, 2, gate.z + gate.uz * u + gate.nz * d, 38, 6, 64, M.cyan, -gate.angle + Math.PI / 2);
    }
    if (gate.id !== 'G-01') label(labels, 'LOGISTICS', gate.x + gate.nx * 470, gate.z + gate.nz * 470, 750, 77, '#80999e', '', -gate.angle);
  }
  for (const side of [-1, 1]) {
    const x = side * (l.frontHalfWidth + 160);
    const z = l.frontZ - 90;
    f.box(x, 280, z, 115, 34, 127, M.yellow);
    f.box(x, 305, z, 68, 12, 74, M.cyan);
    f.box(x, 140, z + 55, 35, 160, 9, M.white);
  }
  label(labels, 'K-7 / CAPITAL GATE', 0, l.frontZ + 510, 1420, 120, '#9caaa7');

  // ---- suwnice i węże paliwowe (K-7 CraneSystem + FuelHoseSystem)
  const cranes = [];
  for (const b of l.berths) {
    if (b.size !== 'CAPITAL') continue;
    cranes.push(buildCrane(f, b, addGroup));
    for (const a of b.serviceAnchors) hoses.push(buildHose(f, b, a, addGroup));
  }


  // ---- dach (K-7 buildRoof) — osobny zestaw, zanika przy statku w hali
  f.set = 'roof';
  plate(plates, l.footprint, 711, 82, M.dark, 'roof');
  for (let z = l.backZ + 220; z < l.frontZ - 140; z += 520) {
    const half = l.halfWidthAt(z) - 55;
    f.box(0, 819, z, half * 2, 62, 43, M.pale);
    const panelZ = z + 170;
    const panelDepth = Math.min(280, l.frontZ - panelZ - 50);
    const panelHalf = Math.min(l.halfWidthAt(panelZ - panelDepth / 2), l.halfWidthAt(panelZ + panelDepth / 2)) - 90;
    if (panelDepth > 40) {
      for (let x = -panelHalf + 22; x < panelHalf - 40; x += 485) {
        const w = Math.min(450, panelHalf - x - 22);
        if (w < 40) continue;
        f.box(x + w / 2, 802, panelZ, w, 20, panelDepth, M.steel);
        f.box(x + w / 2, 817, panelZ, w * 0.63, 10, 15, M.dark);
      }
    }
    for (const side of [-1, 1]) f.box(side * (half - 30), 848, z, 82, 19, 66, M.yellow);
  }
  for (const x of [-(l.halfWidth - 1120), l.halfWidth - 1120]) {
    for (const z of [1660, 3460, 5060]) {
      f.box(x, 853, z, 540, 105, 1120, M.dark);
      f.box(x, 916, z, 490, 22, 1060, M.pale);
      for (let i = 0; i < 10; i++) f.box(x, 937, z - 460 + i * 102, 392, 18, 32, M.steel);
      for (const side of [-1, 1]) f.cyl(x + side * 170, 938, z + 622, 67, 76, M.dark);
    }
  }
  for (const x of [-820, 820]) f.box(x, 892, 780, 330, 82, 280, M.pale);
  for (let z = 850; z < l.bodyEndZ; z += 480) f.box(0, 840, z, 16, 9, 125, M.white);
  f.set = 'bg';

  // ---- przypięcie do ringu: most do krawędzi dachu, zastrzały, tunele do habitatu
  buildHabitatPlug(f, plates, labels, l, ringInfo);

  // ---- otwarte zatoki kompleksu (stanowiska w standardzie K-7)
  for (const bay of ringInfo.bays || []) buildBay(f, plates, labels, lamps, bay.layout, bay.xf);

  return { sets: f.sets, plates, labels, groups, hoses, lamps, cranes };
}

// Stanowiska (pola, obrysy, podziałka, znaczniki pola STOP, napisy, lampka
// stanu, strzałka i pasy podejścia) — wspólne dla hali i zatok. `lab` rysuje
// napis w układzie, w którym leżą stanowiska (hub hali albo zatoka).
function recordBerths(f, lab, lamps, berths) {
  const M = K7_MAT;
  const stripe = (x, z, w, d, mat) => f.box(x, 1.5, z, w, 1.5, d, mat);
  for (const b of berths) {
    const hw = b.width / 2;
    const hl = b.length / 2;
    const capital = b.size === 'CAPITAL';
    const big = capital || b.size === 'MEGA';
    f.box(b.x, 0.8, b.z, b.width, 1.4, b.length, M.deckPad);
    for (const side of [-1, 1]) {
      stripe(b.x + side * hw, b.z, 5, b.length, M.paint);
      stripe(b.x, b.z + side * hl, b.width, 5, M.paint);
      const count = big ? Math.round(b.length / 240) : Math.max(3, Math.floor(b.length / 90));
      for (let j = 0; j < count; j++) stripe(b.x + side * (hw + 15), b.z - hl + 24 + j * (b.length - 48) / (count - 1), 22, 8, M.yellow);
    }
    const dx = Math.cos(b.angle);
    const dz = Math.sin(b.angle);
    const nx = -dz;
    const nz = dx;
    const place = (along, across) => ({ x: b.x + dx * along + nx * across, z: b.z + dz * along + nz * across });
    for (let q = -b.padLength * 0.37; q < b.padLength * 0.37; q += big ? 190 : 95) {
      const p = place(q, 0);
      f.box(p.x, 2, p.z, big ? 65 : 35, 1.5, 4, M.paintCold, -b.angle);
    }
    const cx = b.capture.halfWidth;
    const cz = b.capture.halfLength;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        stripe(b.x + sx * cx, b.z + sz * (cz - 12), 4, 24, M.paintCold);
        stripe(b.x + sx * (cx - 12), b.z + sz * cz, 24, 4, M.paintCold);
      }
    }
    const depth = b.size === 'MEGA' ? 150 : capital ? 135 : b.size === 'L' ? 108 : b.size === 'M' ? 80 : 58;
    const aft = place(-b.padLength / 2 + (big ? 180 : depth * 0.85 + 24), 0);
    const small = b.size === 'MEGA' ? 'MEGA / FREIGHT TRAIN' : capital ? 'ATLAS / REVERSIBLE' : b.size + ' / ' + (b.occupied ? 'OCCUPIED' : 'AVAILABLE');
    lab(b.id, aft.x, aft.z, b.padBeam * 0.76, depth, b.id === 'C-01' ? '#9ecdd0' : '#cbb992', small, -(b.angle + Math.PI / 2));
    const stop = place(b.padLength / 2 - (big ? 120 : 52), 0);
    lab('STOP', stop.x, stop.z, Math.min(250, b.padBeam * 0.63), big ? 58 : 33, '#778685', '', -(b.angle + Math.PI / 2));
    // lampka stanu stanowiska (kolor zmienia automat dokowania)
    const statusPoint = place(-b.padLength / 2 + 18, 0);
    lamps.push({ berthId: b.id, index: f.sets.bg.box.length / 16 });
    f.box(statusPoint.x, 4, statusPoint.z, 7, 3, b.padBeam * 0.69, b.occupied ? M.warm : M.green, -b.angle);
    // podejście z alei (stanowiska grzebieni: kurs wzdłuż x)
    if (b.approach && Math.abs(dx) > 0.5) {
      const tail = place(-b.padLength / 2 - 65, 0);
      directionArrow(f, tail.x, tail.z, b.angle, Math.min(110, b.padBeam * 0.43), M.paintCold);
      for (const sign of [-1, 1]) {
        const startX = b.approach.from.x;
        const endX = tail.x;
        const n = Math.max(1, Math.ceil(Math.abs(endX - startX) / 120));
        for (let j = 0; j <= n; j++) stripe(mix(startX, endX, j / n), b.z + sign * (b.padBeam / 2 - 15), 44, 3, M.paintCold);
      }
    }
  }
}

// Otwarta zatoka (haloPortBays.js) nagrywana w układzie zatoki i przenoszona
// do huba hali (xf): stanowiska jak w K-7, dwa pasy MEGA z szynami,
// oznakowaniem wjazdu i słupkami paliwowymi, podwójny grzebień z aleją
// pośrodku, grzbiety serwisowe (listwa, słupki obsługi, pachołki, rurociąg)
// między grzebieniem a pasami, napisy zatoki. Bryła
// zatoki (pokład, ściany, kołnierz, klin, suwnice) jest w megastrukturze ringu.
function buildBay(f, plates, labels, lamps, bay, xf) {
  const M = K7_MAT;
  const q = {};
  const lab = (text, x, z, width, depth, color, small, rotation = 0) => {
    haloXfPoint(xf, x, z, q);
    label(labels, text, q.x, q.z, width, depth, color, small, rotation - xf.phi);
  };
  const stripe = (x, z, w, d, mat) => f.box(x, 1.5, z, w, 1.5, d, mat);
  f.setFrame(xf);
  recordBerths(f, lab, lamps, bay.berths);
  // pasy MEGA: szyny wzdłuż pasa, wjazd od wylotu, słupki paliwowe przy dziobie
  bay.lanes.forEach((lane, k) => {
    const mega = bay.berths.find((b) => b.id === lane.berthId);
    const r0 = mega.z - mega.length / 2;
    const r1 = bay.openZ - 30;
    for (const side of [-1, 1]) {
      const x = lane.x + side * (lane.width / 2 - 40);
      f.box(x, 16, (r0 + r1) * 0.5, 60, 32, r1 - r0, M.dark);
      f.box(x, 34, (r0 + r1) * 0.5, 40, 6, r1 - r0 - 30, M.yellow);
      for (let z = bay.openZ - 60; z > bay.openZ - 520; z -= 155) stripe(lane.x + side * (lane.width / 2 - 110), z, 8, 74, M.paintCold);
      // słupki paliwowe przed dziobem (między ścianą tylną a polem)
      const px = lane.x + side * 400;
      const pz = bay.backZ + 70;
      f.box(px, 35, pz, 117, 70, 110, M.dark);
      f.box(px, 116, pz, 75, 168, 70, M.yellow);
      f.box(px, 173, pz + 36, 18, 14, 5, M.green);
    }
    arrow(f, lane.x, bay.openZ - 150, 150, M.paintCold, true);
    lab(bay.tag + ' / MEGA ' + (k + 1), lane.x, bay.openZ - 60, 900, 90, '#9caaa7', 'OPEN BAY / FREIGHT TRAIN LANE');
  });
  // grzbiety serwisowe: listwa z szynami, rurociąg, słupki obsługi i pachołki przy nosach pól
  for (const sp of bay.spines) {
    const len = sp.z1 - sp.z0;
    const zc = (sp.z0 + sp.z1) / 2;
    f.box(sp.x, 10, zc, sp.width, 20, len, M.dark);
    for (let z = sp.z0 + 20; z < sp.z1; z += 40) f.box(sp.x, 22, z, sp.width - 12, 3, 7, M.rail);
    for (const off of [-48, 48]) stripe(sp.x + off, zc, 4, len, M.paint);
    for (let row = 0; row < 3; row++) {
      const y = 160 + row * 76;
      const x = sp.x + sp.side * 42;
      f.cyl(x, y, zc, 16, len - 80, M.copper, [Math.PI / 2, 0, 0]);
      for (let z = sp.z0 + 60; z < sp.z1 - 40; z += 190) {
        f.box(x + sp.side * 24, y, z, 12, 46, 38, M.black);
        f.ring(x, y, z, 19, 3, M.rail);
      }
    }
  }
  for (const s of baySolidList(bay)) if (s.id.startsWith('SERVICE')) f.box(s.x, s.y, s.z, s.w, s.h, s.d, M[s.mat], -s.angle);
  for (const b of bay.berths) {
    if (!b.servicePoint) continue;
    const sd = b.side;
    const x = b.servicePoint.x;
    const z = b.servicePoint.z;
    f.box(x - sd * 34, 94, z, 10, 105, 60, M.pale);
    f.box(x - sd * 41, 117, z, 5, 21, 36, M.glass);
    f.box(x - sd * 45, 68, z, 7, 12, 15, M.green);
    f.cyl(x, 175, z, 21, 36, M.yellow, [Math.PI / 2, 0, 0]);
    for (const off of [-b.length * 0.35, b.length * 0.35]) {
      const bx = sd * (Math.abs(b.x) + b.width / 2 + 16);
      f.cyl(bx, 36, b.z + off, 13, 70, M.steel);
      f.cyl(bx, 73, b.z + off, 19, 8, M.yellow);
    }
  }
  // aleja pośrodku: listwy i strzałki ku podłodze, napisy
  const a = bay.aisle;
  for (const side of [-1, 1]) for (let z = a.z0 + 40; z < a.z1 - 40; z += 155) stripe(a.x + side * (a.width / 2), z, 5, 68, M.paintCold);
  for (let z = a.z1 - 420; z > a.z0 + 200; z -= 660) directionArrow(f, a.x, z, -Math.PI / 2, 105, M.paintCold);
  lab(bay.tag + ' / 4L 4M 4S', a.x, a.z1 - 60, 820, 84, '#aab7ad', 'OPEN BAY / KEEP CLEAR');
  // napis zatoki na pokładzie przy ścianie tylnej
  lab(bay.id, a.x, bay.backZ + 170, 760, 200, '#687d83', 'OPEN BAY / ' + bay.berths.length + ' BERTHS');
  f.setFrame(null);
}

function arrow(f, x, z, length, mat, inward = true) {
  const dir = inward ? -1 : 1;
  const tip = [x, 3, z + dir * length * 0.5];
  const back = [x, 3, z - dir * length * 0.5];
  f.beam(back, tip, 6, mat, 3);
  f.beam([x - length * 0.24, 3, z + dir * length * 0.1], tip, 7, mat, 3);
  f.beam([x + length * 0.24, 3, z + dir * length * 0.1], tip, 7, mat, 3);
}
function directionArrow(f, x, z, angle, length, mat) {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const nx = -dz;
  const nz = dx;
  const tip = [x + dx * length * 0.5, 3, z + dz * length * 0.5];
  const tail = [x - dx * length * 0.5, 3, z - dz * length * 0.5];
  f.beam(tail, tip, 5, mat, 2);
  for (const side of [-1, 1]) f.beam([x + dx * length * 0.1 + nx * side * length * 0.22, 3, z + dz * length * 0.1 + nz * side * length * 0.22], tip, 6, mat, 2);
}

// Suwnica stanowiska kapitalnego: część stała (grupa 0) + most, wózek,
// chwytak, szczęki i liny jako grupy ruchome (macierze liczy haloPortK7.js).
function buildCrane(f, b, addGroup) {
  const M = K7_MAT;
  const homeZ = b.z + 1130;
  const workZ = b.z + 245;
  const legZs = [b.z - 1110, b.z + 1110];
  f.dx = b.x;
  for (const side of [-1, 1]) {
    const x = side * 615;
    f.box(x, 16, b.z, 102, 32, 2440, M.dark);
    f.box(x, 39, b.z, 76, 8, 2390, M.yellow);
    f.set = 'fg';
    f.box(x, 452, b.z, 44, 64, 2410, M.dark);
    f.box(x, 489, b.z, 26, 13, 2440, M.rail);
    f.set = 'bg';
    for (let k = 0; k < 17; k++) {
      f.box(x, 40, b.z - 1120 + k * 140, 106, 8, 18, M.rail);
      for (const off of [-39, 39]) f.cyl(x + off, 45, b.z - 1120 + k * 140, 5, 4, M.rail);
    }
    f.set = 'fg';
    for (const z of legZs) {
      f.box(x, 234, z, 62, 448, 75, M.pale);
      f.box(x, 260, z - 40, 18, 352, 9, M.yellow);
      f.box(x, 7, z, 158, 14, 180, M.dark);
      f.beam([x, 365, z], [x - side * 40, 446, z + 175], 22, M.steel);
    }
    for (let i = 0; i < 11; i++) {
      const z = b.z - 1000 + i * 205;
      f.box(x, 415, z, 14, 21, 120, M.white);
      f.box(x, 447, z, 38, 10, 70, M.black);
    }
    f.set = 'bg';
  }
  f.dx = 0;
  // most (grupa): lokalnie x względem stanowiska, z względem położenia mostu
  f.set = 'fg';
  const gBridge = addGroup({ kind: 'bridge', berthId: b.id, x: b.x, homeZ, workZ });
  f.group = gBridge;
  for (const zz of [-73, 73]) {
    f.box(0, 518, zz, 1370, 28, 25, M.yellow);
    f.box(0, 617, zz, 1370, 22, 25, M.yellow);
    for (let i = 0; i < 10; i++) {
      const xx = -648 + i * 132;
      f.beam([xx, 532, zz], [xx + 128, 604, zz], 13, M.steel);
      f.beam([xx, 604, zz], [xx + 128, 532, zz], 10, M.dark);
    }
    f.box(0, 627, zz, 1350, 8, 17, M.rail);
  }
  for (const x of [-615, 615]) {
    f.box(x, 510, 0, 160, 46, 240, M.dark);
    f.box(x, 548, 0, 93, 42, 182, M.yellow);
    for (const z of [-79, 79]) {
      f.cyl(x, 497, z, 30, 45, M.rail, [Math.PI / 2, 0, 0]);
      f.box(x, 583, z, 11, 12, 19, M.warm);
    }
  }
  f.box(-465, 584, 0, 184, 66, 113, M.pale);
  f.box(-465, 586, 60, 128, 29, 7, M.glass);
  f.box(-467, 629, 0, 130, 14, 109, M.dark);
  // wózek (grupa, dziecko mostu)
  const gTrolley = addGroup({ kind: 'trolley', parent: gBridge, berthId: b.id });
  f.group = gTrolley;
  f.box(0, 647, 0, 185, 30, 214, M.dark);
  f.box(0, 675, 0, 121, 41, 123, M.yellow);
  f.cyl(0, 665, 0, 38, 110, M.rail, [0, 0, Math.PI / 2]);
  for (const xx of [-72, 72]) for (const zz of [-72, 72]) f.cyl(xx, 635, zz, 18, 18, M.rail, [0, 0, Math.PI / 2]);
  f.box(0, 678, 73, 54, 32, 40, M.black);
  f.box(0, 680, 96, 25, 15, 3, M.green);
  // chwytak (grupa; wysokości lokalne liniowo — przesunięcie w macierzy grupy)
  const gSpreader = addGroup({ kind: 'spreader', parent: gTrolley, berthId: b.id });
  f.group = gSpreader;
  f.mode = 'lin';
  f.box(0, 0, 0, 307, 28, 24, M.yellow);
  f.box(0, 0, 0, 22, 24, 155, M.dark);
  for (const xx of [-128, 128]) {
    for (const zz of [-42, 42]) {
      f.box(xx, -15, zz, 27, 24, 25, M.steel);
      f.cyl(xx, -34, zz, 18, 17, M.black);
      f.ring(xx, -43, zz, 18, 3, M.rail, [Math.PI / 2, 0, 0]);
    }
  }
  f.box(0, 17, 0, 55, 19, 49, M.dark);
  const jaws = [];
  for (const side of [-1, 1]) {
    const g = addGroup({ kind: 'jaw', parent: gSpreader, side, berthId: b.id });
    f.group = g;
    for (const z of [-42, 42]) f.box(side * 148, -42, z, 10, 22, 31, M.rail);
    jaws.push(g);
  }
  // liny (grupa ze skalą pionową: długość liczona z położenia chwytaka)
  const gCables = addGroup({ kind: 'cables', parent: gTrolley, berthId: b.id });
  f.group = gCables;
  for (const xx of [-102, 102]) for (const zz of [-42, 42]) f.box(xx, 0, zz, 3, 1, 3, M.black);
  f.mode = 'abs';
  f.group = 0;
  f.set = 'bg';
  return { berthId: b.id, bridge: gBridge, trolley: gTrolley, spreader: gSpreader, jaws, cables: gCables, homeZ, workZ };
}

function buildHose(f, b, a, addGroup) {
  const M = K7_MAT;
  const s = a.side;
  f.box(a.x, 35, a.z, 117, 70, 135, M.dark);
  f.box(a.x, 116, a.z, 75, 168, 78, M.yellow);
  f.set = 'fg';
  f.box(a.x, 204, a.z, 93, 20, 105, M.steel);
  f.cyl(a.x, 224, a.z, 46, 62, M.black, [0, 0, Math.PI / 2]);
  for (const o of [-33, 33]) f.cyl(a.x + o, 224, a.z, 54, 9, M.rail, [0, 0, Math.PI / 2]);
  f.set = 'bg';
  f.box(a.x - s * 44, 150, a.z, 6, 68, 50, M.black);
  f.box(a.x - s * 49, 173, a.z, 5, 14, 18, M.green);
  f.cyl(a.x, 78, a.z - 74, 8, 126, M.copper);
  f.beam([a.x, 26, a.z - 74], [a.x, 26, a.z - 335], 15, M.copper);
  f.box(a.x, 17, a.z - 340, 82, 34, 81, M.dark);
  // złączka na końcu węża (grupa: położenie i obrót z krzywej węża)
  f.set = 'fg';
  const g = addGroup({ kind: 'coupler', berthId: b.id, side: s });
  f.group = g;
  f.mode = 'lin';
  f.cyl(0, 0, 0, 17, 46, M.steel);
  f.cyl(0, 18, 0, 22, 10, M.yellow);
  f.cyl(0, -19, 0, 23, 10, M.rail);
  f.cyl(0, -26, 0, 14, 9, M.black);
  for (const x of [-20, 20]) f.box(x, 0, 0, 7, 32, 8, M.dark);
  f.ring(0, 11, 0, 18, 2, M.status, [Math.PI / 2, 0, 0]);
  f.mode = 'abs';
  f.group = 0;
  f.set = 'bg';
  return { berthId: b.id, anchor: a, group: g };
}

// Przypięcie K-7 do ringu (nowe, K-7 stał przy innym ringu). Hub-lokalne z
// ringu: krawędź ścian habitatu na z = −originGap; podłoga habitatu na
// z = floorBase − (rim + originGap). Wysokości tu już W Z ŚWIATA (mode 'lin'
// nie dotyczy): zapis bezpośredni przez box/beam z konwersją odwrotną.
// Wpięcie hali w podłogę habitatu (na środku wstęgi, w płaszczyźnie gry):
// kołnierz na podłodze (słupy, nadproże, podstawa-terminal z oknami na kosmos)
// i klin nośny pod pokładem od podłogi ku krawędzi ścian. Bez mostów i
// zastrzałów — hala wyrasta z habitatu. Wysokości w świecie przeliczane na
// wysokości K-7 (odwrotność k7HeightToZ), więc nad płaszczyzną lotu też
// działa ściśnięcie ×0,42.
const yW = (z) => (z <= 0 ? z + K7_HEIGHTS.hullTop : K7_HEIGHTS.hullTop + z / K7_ABOVE_SCALE);
function buildHabitatPlug(f, plates, labels, l, ring) {
  const M = K7_MAT;
  const floorZ = ring.floorZ ?? l.backZ;          // z huba powierzchni podłogi
  const rimZ = ring.rimZ ?? floorZ + 1500;        // z huba krawędzi ścian
  const zLow = -1250;                             // spód podstawy (z świata)
  const zHall = -275;                             // pod kadłubem hali (spód −254)
  const zTop = 360;                               // wierzch kołnierza
  const posts = k7CollarPosts(l, floorZ);
  const x1 = Math.abs(posts[0].x) + posts[0].w * 0.5;
  const face = floorZ + 262;                      // lico kołnierza (od strony kosmosu)
  const boxW = (x, z0w, z1w, zc, w, d, mat) => {
    const y0 = yW(z0w);
    const y1 = yW(z1w);
    f.box(x, (y0 + y1) * 0.5, zc, w, y1 - y0, d, mat);
  };
  // hub jest styczny do podłogi na środku hali, a podłoga pod krawędziami
  // opada (krzywizna ringu x²/2R: ~380 j. przy słupach) — bryły styku
  // z podłogą sięgają do niej, żeby końce kołnierza nie wisiały nad terenem
  const R = ring.floorR || 42259;
  const floorAt = (x) => floorZ - (x * x) / (2 * R) - 20;
  const toFloor = (x, zc, d) => {
    const top = zc + d * 0.5;
    const bot = Math.min(zc - d * 0.5, floorAt(Math.abs(x)));
    return [(top + bot) * 0.5, top - bot];
  };
  // słupy po bokach hali (także przeszkody lotu — k7SolidList)
  for (const p of posts) {
    const [pzc, pd] = toFloor(Math.abs(p.x) + p.w * 0.5, p.z, p.d);
    boxW(p.x, zLow, zTop, pzc, p.w, pd, M.dark);
    boxW(p.x, zLow + 40, zTop - 40, p.z + p.d * 0.5 + 4, p.w - 60, 8, M.steel);
    boxW(p.x - p.side * (p.w * 0.5 - 24), zLow + 80, zTop - 60, p.z + p.d * 0.5 + 10, 14, 8, M.cyan);
    boxW(p.x + p.side * (p.w * 0.5 - 18), zLow, zTop, p.z + p.d * 0.5 + 6, 22, 10, M.yellow);
  }
  // nadproże nad dachem hali i podstawa-terminal pod kadłubem
  boxW(0, 290, zTop, floorZ + 90, 2 * x1, 340, M.dark);
  boxW(0, 300, zTop - 12, face + 4, 2 * x1 - 120, 8, M.steel);
  {
    const [bzc, bd] = toFloor(x1, floorZ + 90, 340);
    boxW(0, zLow, zHall, bzc, 2 * x1, bd, M.dark);
  }
  // okna terminalu: pasy ciepłego światła co ~120 j. + słupki
  for (let row = 0; row < 7; row++) {
    const z0 = zHall - 120 - row * 122;
    if (z0 < zLow + 60) break;
    boxW(0, z0, z0 + 26, face + 4, 2 * x1 - 420, 6, row % 3 === 1 ? M.cyan : M.warm);
  }
  for (let x = -x1 + 300; x <= x1 - 300; x += 520) boxW(x, zLow + 40, zHall - 40, face + 8, 18, 10, M.steel);
  labels.push({ text: 'PORT KEPLER', small: 'K-7 / TERMINAL HABITATU', color: '#b8cdc6', x: 0, z: face + 14, width: 2600, depth: 355, rotation: 0, y: -560, vertical: true, set: 'bg' });
  // klin nośny pod pokładem: od podłogi (spód podstawy) do kadłuba hali za krawędzią ścian
  const zEnd = Math.max(rimZ + 950, floorZ + 2400);
  plates.push({ axis: 'x', points: [[floorZ + 110, zHall], [zEnd, zHall], [floorZ + 110, zLow]], z0: -(l.halfWidth - 60), z1: l.halfWidth - 60, mat: M.dark, set: 'bg' });
  // żebra wzdłuż spadku klina i listwa świetlna przy podłodze
  const ribA = [floorZ + 140, zLow + 30];
  const ribB = [zEnd - 60, zHall - 12];
  for (let x = -l.halfWidth + 300; x <= l.halfWidth - 300; x += 1100) {
    const n = Math.hypot(ribB[0] - ribA[0], ribB[1] - ribA[1]);
    const oz = -(ribB[1] - ribA[1]) / n * 34;   // odsunięcie pod powierzchnię spadku
    const oy = (ribB[0] - ribA[0]) / n * 34;
    f.beam([x, yW(ribA[1] - oy), ribA[0] + oz], [x, yW(ribB[1] - oy), ribB[0] + oz], 70, M.steel, 90);
  }
  boxW(0, zLow + 10, zLow + 34, floorZ + 150, 2 * l.halfWidth - 200, 12, M.cyan);
  // kotwy przy podłodze
  for (let x = -l.halfWidth + 500; x <= l.halfWidth - 500; x += 1000) boxW(x, zLow, zLow + 160, floorZ + 60, 180, 150, M.steel);
}
