// Budowa hali K-7 jako DANE (bez Three): port funkcji CentralHub.build
// i proceduralDockShip z dema K-7 na rejestrator instancji. Liczby i układ jak
// w K-7; wysokości przeliczane na z świata (k7HeightToZ: 1:1 pod płaszczyzną
// lotu, ×0,42 nad nią).
//
// Wynik: listy instancji (prostopadłościan / walec / torus) w trzech zestawach
// — `bg` (pod statkami), `fg` (nad statkami: ramiona paliwowe, złączki, dach) —
// z kodem materiału i indeksem grupy ruchomej; płaskie wielokąty (pokład,
// fartuchy, dach); napisy na pokładzie; stanowiska paliwowe (`fuel`: grupy
// członów ramienia SCARA, wysięgnika i złączki — ruch liczy haloPortK7Fuel.js)
// i zamki pola (`clamps`). Statków NPC scena nie ma (2026-09-24: statki i ruch
// z osobnego systemu). Suwnice usunięte 2026-10-07 (decyzja użytkownika: „nie
// mają żadnej roli — cargo będą ładowały drony”); w ich miejscu — rurociągi
// paliwa od magazynu przy ścianie tylnej do słupków (buildFuelPiping).
//
// Kompleks = hala K-7 + jej otwarte zatoki (haloPortBays.js): stanowiska zatok
// w tym samym standardzie (pola, pasy, napisy, lampki stanu) nagrywane w
// układzie huba hali przez przejście ramek — te same instancje i draw calle.
import { HALO_PORT } from './haloRingConfig.js';
import {
  K7_ABOVE_SCALE,
  K7_FUEL_FARM,
  K7_FUEL_STATION,
  k7ArmWidthAt,
  k7FuelTanks,
  k7HallArms,
  k7HeightToZ,
  k7SolidList,
  k7ZToHeight
} from './haloPortK7Layout.js';
import { baySolidList, haloXfPoint } from './haloPortBays.js';
import { resolveHaloProfile } from './haloRingProfiles.js';
import { k7LightRig } from './haloPortK7Lights.js';

export const K7_MAT = Object.freeze({
  steel: 0, dark: 1, pale: 2, yellow: 3, orange: 4, teal: 5, floor: 6, rail: 7, black: 8, hose: 9,
  copper: 10, glass: 11, paint: 12, paintCold: 13, cyan: 14, warm: 15, white: 16, red: 17, green: 18, status: 19,
  deckPad: 20
});
// cx cy cz vScale | sx sy sz mat | qx qy qz qw | group, miganie (K7_BEACON), faza [s], okres [s]
export const K7_INSTANCE_STRIDE = 16;

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
    // soczewka migająca (haloPortK7Lights.js): kod, faza, okres — shader K-7 nadpisuje nimi emisję
    this.blink = 0;
    this.blinkPhase = 0;
    this.blinkPeriod = 0;
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
    this.sets[this.set][kind].push(x, cy, z, vs, sx, sy, sz, mat, q[0], q[1], q[2], q[3], this.group, this.blink, this.blinkPhase, this.blinkPeriod);
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
  // styl doków z profilu planety (dach, ściany, napisy); Ziemia = hala z dema K-7
  const style = ringInfo.style || resolveHaloProfile('earth').port;
  const LC = style.labels;
  const plates = [];
  const labels = [];
  const groups = [];            // opisy grup ruchomych (indeks = pozycja + 1)
  const lamps = [];             // lampki stanu stanowisk (indeks instancji w bg.box)
  const addGroup = (desc) => { groups.push(desc); return groups.length; };

  // ---- pokład hali
  plate(plates, l.footprint, -116, 116, M.floor);
  plate(plates, l.footprint, -138, 23, M.dark);

  // ---- ściany (K-7 buildWalls): bryły + detale od środka, bramy z ramami
  const solids = k7SolidList(l);
  // bryły z własnym kształtem (zbiorniki paliwa) rysuje buildFuelPiping — w liście są ich obrysy
  for (const s of solids) if (!s.shape) f.box(s.x, s.y, s.z, s.w, s.h, s.d, M[s.mat], -s.angle);
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
      label(labels, gate.id, e.x - e.nx * 140, e.z - e.nz * 140, 360, 88, LC.gate, gate.name, -e.angle);
    }
  }

  // ---- pokład: stanowiska, pasy, strzałki (K-7 buildDeck)
  const stripe = (x, z, w, d, mat) => f.box(x, 1.5, z, w, 1.5, d, mat);
  const hubLabel = (text, x, z, width, depth, color, small, rotation) => label(labels, text, x, z, width, depth, color, small, rotation);
  recordBerths(f, hubLabel, lamps, l.berths, LC);
  for (const lane of l.lanes) {
    for (const side of [-1, 1]) for (let z = 3230; z < l.frontZ + l.apronDepth - 70; z += 155) stripe(lane.x + side * 510, z, 8, 74, M.paintCold);
    for (let z = 3380; z < l.frontZ + l.apronDepth - 80; z += 670) {
      arrow(f, lane.x, z, 145, M.paintCold, false);
      for (const side of [-1, 1]) f.box(lane.x + side * 563, 8, z, 23, 6, 75, M.cyan);
    }
  }
  label(labels, 'K-7', 0, l.frontZ - 1210, 940, 330, LC.hub, 'CENTRAL HUB / ' + l.berths.length + ' BERTHS');
  label(labels, 'CLEAR MANOEUVRING AREA', 0, l.frontZ - 720, 1910, 68, LC.clear);
  for (const bank of l.sideBanks) {
    const z = (bank.z0 + bank.z1) / 2;
    const length = bank.z1 - bank.z0;
    for (const side of [-1, 1]) for (let zz = bank.z0; zz < bank.z1; zz += 155) stripe(bank.aisleX + side * (bank.aisleWidth / 2), zz, 5, 68, M.paintCold);
    for (let zz = 920; zz < bank.z1; zz += 660) directionArrow(f, bank.aisleX, zz, -Math.PI / 2, 105, M.paintCold);
    label(labels, bank.id + ' / 2L  4M  6S', bank.aisleX, bank.z1 - 35, 850, 86, LC.bank, 'LOGISTICS TAXI / KEEP CLEAR');
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
  label(labels, 'PORT CONTROL', 0, 863, 340, 61, LC.control);
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
    if (gate.id !== 'G-01') label(labels, 'LOGISTICS', gate.x + gate.nx * 470, gate.z + gate.nz * 470, 750, 77, LC.logistics, '', -gate.angle);
  }
  for (const side of [-1, 1]) {
    const x = side * (l.frontHalfWidth + 160);
    const z = l.frontZ - 90;
    f.box(x, 280, z, 115, 34, 127, M.yellow);
    f.box(x, 305, z, 68, 12, 74, M.cyan);
    f.box(x, 140, z + 55, 35, 160, 9, M.white);
  }
  label(labels, 'K-7 / CAPITAL GATE', 0, l.frontZ + 510, 1420, 120, LC.capital);
  // ściany z zewnątrz (styl planety): pod płaszczyzną lotu, poza halą
  if (style.walls === 'ecumene') buildEcumeneWalls(f, l);
  else if (style.walls === 'fable') buildFableWalls(f, l);

  // ---- obsługa stanowisk capital: słupki paliwowe z ramionami SCARA i bębnami przewodów, zamki pola;
  // rurociągi paliwa od magazynu przy ścianie tylnej (suwnic nie ma — 2026-10-07)
  const fuel = [];
  const clamps = [];
  for (const b of l.berths) {
    if (b.size !== 'CAPITAL') continue;
    clamps.push(buildClampPads(f, b, addGroup));
    for (const a of b.serviceAnchors) fuel.push(buildFuelStation(f, b, a, addGroup));
  }

  // ---- oświetlenie hali (haloPortK7Lights.js): soczewki migające i oprawy reflektorów
  const rig = k7LightRig(l);
  const beaconSlots = recordLightRig(f, rig);
  buildFuelPiping(f, l, rig);


  // ---- dach (K-7 buildRoof) — osobny zestaw, zanika przy statku w hali;
  // styl z profilu planety: 'k7' (Ziemia), 'ecumene' (Mars: wolny port
  // KEPLER z dema ECUMENE), 'fable' (Jowisz: płyty, radiatory i hangary
  // z dema ringu Fable)
  f.set = 'roof';
  plate(plates, l.footprint, 711, 82, M.dark, 'roof');
  if (style.roof === 'ecumene') buildEcumeneRoof(f, l);
  else if (style.roof === 'fable') buildFableRoof(f, l);
  else buildK7Roof(f, l);
  f.set = 'bg';

  // ---- pylony od płyty portu na podłodze habitatu do ściany tylnej hali
  buildDockPylons(f, plates, labels, l, ringInfo, style);

  // ---- otwarte zatoki kompleksu (stanowiska w standardzie K-7)
  for (const bay of ringInfo.bays || []) buildBay(f, plates, labels, lamps, bay.layout, bay.xf, LC);

  return { sets: f.sets, plates, labels, groups, fuel, clamps, lamps, rig, beaconSlots };
}

// Soczewki świateł (walec: obudowa + szkło z kodem migania) i oprawy reflektorów (skrzynka + jasne czoło).
// Zwraca miejsca soczewek stanowisk ({ berthId, set, index } w zestawie walców) — lampka stanowiska przełącza
// w nich kod migania (wolne: zielone, zajęte: czerwone ciągłe).
function recordLightRig(f, rig) {
  const M = K7_MAT;
  const slots = [];
  const lensMat = [M.black, M.red, M.green, M.cyan, M.cyan, M.white, M.warm, M.red];
  for (const b of rig.beacons) {
    f.set = b.set;
    f.cyl(b.x, b.y - 7, b.z, b.r + 6, 10, M.dark);
    f.blink = b.kind;
    f.blinkPhase = b.phase;
    f.blinkPeriod = b.period;
    if (b.berthId) slots.push({ berthId: b.berthId, set: b.set, index: f.sets[b.set].cyl.length / K7_INSTANCE_STRIDE });
    f.cyl(b.x, b.y, b.z, b.r, 8, lensMat[b.kind] ?? M.white);
    f.blink = 0;
    f.blinkPhase = 0;
    f.blinkPeriod = 0;
  }
  f.set = 'fg';
  for (const s of rig.spots) {
    const yaw = s.housing.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    f.box(s.x - fx * 26, s.y + 6, s.z - fz * 26, 86, 46, 58, M.dark, yaw);
    f.box(s.x + fx * 6, s.y, s.z + fz * 6, 70, 30, 10, M.white, yaw);
    f.box(s.x - fx * 40, s.y - 40, s.z - fz * 40, 18, 60, 18, M.steel, yaw);
  }
  f.set = 'bg';
  return slots;
}

// Dach hali z dema K-7 (Ziemia): belki poprzeczne, panele, moduły wentylacji.
function buildK7Roof(f, l) {
  const M = K7_MAT;
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
}

// Mars (ECUMENE, wolny port KEPLER z dema): płaski pokład dachu z jasnymi
// belkami poprzecznymi, słupy z cięgnami skośnymi do krawędzi (trim.beam
// dema), złote głowice, ciepłe listwy wzdłuż krawędzi, zimna oś; wieża
// kontroli z zimną latarnią przy ścianie tylnej. Wysokości K-7 (×0,42 nad
// płaszczyzną lotu): szczyt ≤ ~1 100 → z < 435.
function buildEcumeneRoof(f, l) {
  const M = K7_MAT;
  const zs = [];
  for (let z = l.backZ + 220; z < l.frontZ - 140; z += 520) zs.push(z);
  for (const z of zs) {
    const half = l.halfWidthAt(z) - 55;
    f.box(0, 812, z, half * 2, 34, 38, M.pale);
    // słupy nad ścianami z cięgnami do środka dachu (jak słupki pomostów KEPLER)
    for (const side of [-1, 1]) {
      const xp = side * (half - 60);
      f.box(xp, 900, z, 26, 150, 26, M.pale);
      f.box(xp, 978, z, 58, 12, 58, M.copper);
      f.beam([xp, 970, z], [side * (half * 0.42), 830, z], 16, M.steel);
      f.box(xp - side * 30, 822, z, 14, 6, 480, M.warm);
    }
  }
  // pola paneli między belkami (stalowy błękit dema) i zimna oś
  for (let i = 0; i + 1 < zs.length; i++) {
    const zc = (zs[i] + zs[i + 1]) * 0.5;
    const half = Math.min(l.halfWidthAt(zs[i]), l.halfWidthAt(zs[i + 1])) - 120;
    for (let x = -half; x < half - 200; x += 640) {
      const w = Math.min(600, half - x);
      f.box(x + w / 2, 800, zc, w - 30, 16, 440, i % 2 ? M.steel : M.hose);
    }
  }
  f.box(0, 832, (l.backZ + l.bodyEndZ) * 0.5, 22, 6, l.bodyEndZ - l.backZ - 700, M.cyan);
  // wieża kontroli z latarnią (zimne światło jak wieża portu dema)
  const tz = l.backZ + 420;
  f.box(0, 880, tz, 460, 150, 380, M.steel);
  f.box(0, 962, tz, 500, 22, 420, M.dark);
  f.box(0, 1030, tz, 14, 130, 14, M.pale);
  f.box(0, 1100, tz, 22, 16, 22, M.cyan);
  // moduły technologiczne na narożnikach (złote pasy)
  for (const x of [-(l.halfWidth - 900), l.halfWidth - 900]) {
    for (const z of [1900, 4300]) {
      f.box(x, 850, z, 520, 80, 700, M.dark);
      f.box(x, 895, z, 480, 10, 660, M.copper);
    }
  }
}

// Jowisz (ring Fable): dach z ciemnych płyt kadłuba, pola radiatorów (ciemne
// lamele z czerwonym żarem), hangary serwisowe z bursztynowymi bramami,
// anteny z czerwonymi światłami, wieże kontroli z cyjanowymi oknami.
function buildFableRoof(f, l) {
  const M = K7_MAT;
  for (let z = l.backZ + 220; z < l.frontZ - 140; z += 520) {
    const half = l.halfWidthAt(z) - 55;
    f.box(0, 816, z, half * 2, 50, 60, M.dark);
    for (const side of [-1, 1]) f.box(side * (half - 40), 846, z, 70, 14, 70, M.hose);
  }
  const zMid = (l.backZ + l.bodyEndZ) * 0.5;
  const len = l.bodyEndZ - l.backZ - 1600;
  // pola radiatorów: lamele w poprzek osi hali (grafit), czerwony żar na
  // krawędziach (widać go z kamery gry), kolektory wzdłuż końców lamel
  for (const xc of [-(l.halfWidth - 1300), l.halfWidth - 1300]) {
    for (let k = 0; k < 16; k++) {
      const z = zMid - len * 0.5 + (k + 0.5) * (len / 16);
      f.box(xc, 880, z, 1500, 150, 16, M.hose);
      f.box(xc, 958, z, 1480, 6, 8, M.red);
    }
    for (const sx of [-1, 1]) f.box(xc + sx * 770, 870, zMid, 40, 110, len + 60, M.dark);
  }
  // hangary serwisowe z bramami (bursztyn)
  for (const x of [-900, 900]) {
    for (const z of [1500, 3900]) {
      f.box(x, 870, z, 620, 110, 520, M.steel);
      f.box(x, 870, z + 262, 440, 60, 6, M.warm);
    }
  }
  // wieże kontroli (cyjanowe okna) i anteny z czerwonymi światłami
  for (const x of [-360, 360]) {
    f.cyl(x, 900, l.backZ + 520, 40, 180, M.steel);
    f.box(x, 1000, l.backZ + 520, 150, 20, 150, M.dark);
    f.box(x, 1000, l.backZ + 520 + 76, 120, 10, 4, M.cyan);
  }
  for (const [x, z] of [[-(l.halfWidth - 300), 1100], [l.halfWidth - 300, 1100], [-(l.halfWidth - 300), l.bodyEndZ - 500], [l.halfWidth - 300, l.bodyEndZ - 500]]) {
    f.cyl(x, 900, z, 8, 230, M.steel);
    f.box(x, 1020, z, 26, 14, 26, M.red);
  }
}

// Mars (ECUMENE): żebra na zewnątrz ścian bocznych jak żebra powłoki dema
// (stal, co 390 j.), skośne belki między nimi, złote głowice, czerwone
// znaczniki — pod płaszczyzną lotu, poza halą.
function buildEcumeneWalls(f, l) {
  const M = K7_MAT;
  const z0 = 700;
  const z1 = l.bodyEndZ - 200;
  for (const side of [-1, 1]) {
    const x = side * (l.halfWidth + 60);
    let k = 0;
    for (let z = z0; z <= z1; z += 390, k++) {
      f.box(x, -20, z, 70, 230, 44, M.steel);
      f.box(x, 98, z, 90, 10, 60, M.copper);
      if (k % 3 === 0) f.box(x + side * 38, 80, z, 10, 12, 10, M.red);
      if (z + 390 <= z1) {
        f.beam([x + side * 30, -110, z], [x + side * 30, 70, z + 390], 18, M.pale);
        f.beam([x + side * 30, 70, z], [x + side * 30, -110, z + 390], 18, M.dark);
      }
    }
  }
}

// Jowisz (Fable): rurociągi (stal i ciemny metal) wzdłuż ścian, lamele
// radiatorów pod nimi, światła pozycyjne czerwone/zielone — pod płaszczyzną.
function buildFableWalls(f, l) {
  const M = K7_MAT;
  const z0 = 700;
  const z1 = l.bodyEndZ - 200;
  const zc = (z0 + z1) * 0.5;
  for (const side of [-1, 1]) {
    const x = side * (l.halfWidth + 70);
    for (const [y, r, mat] of [[40, 22, M.hose], [80, 16, M.steel]]) {
      f.cyl(x + side * (y - 40) * 0.3, y, zc, r, z1 - z0, mat, [Math.PI / 2, 0, 0]);
    }
    for (let z = z0 + 60; z < z1; z += 120) f.box(x + side * 60, -40, z, 60, 110, 6, M.black);
    for (let z = z0 + 100; z < z1; z += 400) f.box(x + side * 20, 20, z, 80, 100, 16, M.dark);
    for (let z = z0; z <= z1; z += 800) f.box(x + side * 44, 100, z, 12, 12, 12, side > 0 ? M.green : M.red);
  }
}

// Stanowiska (pola, obrysy, podziałka, znaczniki pola STOP, napisy, lampka
// stanu, strzałka i pasy podejścia) — wspólne dla hali i zatok. `lab` rysuje
// napis w układzie, w którym leżą stanowiska (hub hali albo zatoka).
function recordBerths(f, lab, lamps, berths, LC = resolveHaloProfile('earth').port.labels) {
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
    lab(b.id, aft.x, aft.z, b.padBeam * 0.76, depth, b.id === 'C-01' ? LC.berthLead : LC.berth, small, -(b.angle + Math.PI / 2));
    const stop = place(b.padLength / 2 - (big ? 120 : 52), 0);
    lab('STOP', stop.x, stop.z, Math.min(250, b.padBeam * 0.63), big ? 58 : 33, LC.stop, '', -(b.angle + Math.PI / 2));
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
// zatoki (pokład, ściany, pylony z terminalem) jest w megastrukturze
// ringu (haloRingRoofPlan.js; archetypy — arch/archPort.js).
function buildBay(f, plates, labels, lamps, bay, xf, LC = resolveHaloProfile('earth').port.labels) {
  const M = K7_MAT;
  const q = {};
  const lab = (text, x, z, width, depth, color, small, rotation = 0) => {
    haloXfPoint(xf, x, z, q);
    label(labels, text, q.x, q.z, width, depth, color, small, rotation - xf.phi);
  };
  const stripe = (x, z, w, d, mat) => f.box(x, 1.5, z, w, 1.5, d, mat);
  f.setFrame(xf);
  recordBerths(f, lab, lamps, bay.berths, LC);
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
    lab(bay.tag + ' / MEGA ' + (k + 1), lane.x, bay.openZ - 60, 900, 90, LC.bayLane, 'OPEN BAY / FREIGHT TRAIN LANE');
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
  lab(bay.tag + ' / 4L 4M 4S', a.x, a.z1 - 60, 820, 84, LC.bayBank, 'OPEN BAY / KEEP CLEAR');
  // napis zatoki na pokładzie przy ścianie tylnej
  lab(bay.id, a.x, bay.backZ + 170, 760, 200, LC.bayId, 'OPEN BAY / ' + bay.berths.length + ' BERTHS');
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

// Zamki magnetyczne pola stanowiska capital (poza `clamp`): płyty na pokładzie wzdłuż burt zadokowanego kadłuba
// (stanowiska capital mają kurs −π/2 — kadłub wzdłuż z huba); listwy świecą (emisja grupy), gdy zamki trzymają
// statek. Ciemne podstawy i żółte obrzeża — część stała.
function buildClampPads(f, b, addGroup) {
  const M = K7_MAT;
  const g = addGroup({ kind: 'clamps', berthId: b.id });
  const across = 470;
  for (const side of [-1, 1]) {
    for (const dz of [-760, -260, 260, 760]) {
      const x = b.x + side * across;
      const z = b.z + dz;
      f.box(x, 3, z, 64, 6, 210, M.dark);
      f.box(x + side * 24, 4, z, 8, 3, 198, M.yellow);
      for (const ez of [-1, 1]) f.box(x, 6.5, z + ez * 98, 50, 3, 6, M.rail);
      f.group = g;
      f.box(x - side * 6, 7, z, 20, 2, 176, M.status);
      f.group = 0;
    }
  }
  return { berthId: b.id, group: g };
}

// Stanowisko paliwowe (słupek `a` stanowiska `b`, K7_FUEL_STATION): cokół i kolumna, bęben przewodu na licu ku
// stanowisku, skrzynka sterowania, obrotnica barku i ramię SCARA — grupy ruchome: człon 1 (bark), człon 2 (łokieć),
// trzon wysięgnika, złączka. Ruch (kąty, wysięgnik, złączka i przewód) liczy haloPortK7Fuel.js z poz obsługi,
// macierze grup — haloPortK7.js. Układ lokalny członów: oś przegubu w zerze, człon wzdłuż +x, wysokości K-7.
function buildFuelStation(f, b, a, addGroup) {
  const M = K7_MAT;
  const F = K7_FUEL_STATION;
  const s = a.side;
  const ix = -s;
  const x = a.x;
  const z = a.z;
  // cokół i kolumna
  f.box(x, F.plinth.h * 0.5, z, F.plinth.w, F.plinth.h, F.plinth.d, M.dark);
  f.box(x, F.plinth.h + 2, z, F.plinth.w - 18, 4, F.plinth.d - 18, M.steel);
  for (const sz of [-1, 1]) f.box(x, F.plinth.h * 0.55, z + sz * (F.plinth.d * 0.5 + 1), F.plinth.w - 24, 12, 3, M.yellow);
  f.box(x, (F.plinth.h + F.column.top) * 0.5, z, F.column.w, F.column.top - F.plinth.h, F.column.d, M.yellow);
  f.box(x - ix * (F.column.w * 0.5 + 2), 160, z, 4, 170, F.column.d - 22, M.dark);
  for (const yy of [92, 232]) f.box(x, yy, z, F.column.w + 4, 6, F.column.d + 4, M.dark);
  // skrzynka sterowania na licu zewnętrznym
  f.box(x - ix * (F.column.w * 0.5 + 9), 166, z, 12, 74, 54, M.pale);
  f.box(x - ix * (F.column.w * 0.5 + 16), 182, z, 3, 22, 36, M.glass);
  f.box(x - ix * (F.column.w * 0.5 + 16), 150, z + 17, 3, 9, 9, M.green);
  // pion paliwa z rurociągu do bębna (wzdłuż lica kolumny)
  f.cyl(x + ix * (F.column.w * 0.5 + 6), (F.plinth.h + F.reel.y) * 0.5, z - F.column.d * 0.5 + 12, 8, F.reel.y - F.plinth.h, M.copper);
  // bęben przewodu (oś wzdłuż z) na wspornikach, piasta, prowadnica rolkowa w wylocie
  const R = F.reel;
  const rx = x + ix * R.out;
  const ROT_Z = [Math.PI / 2, 0, 0];
  f.set = 'fg';
  f.cyl(rx, R.y, z, R.r, R.w, M.black, ROT_Z);
  for (const sz of [-1, 1]) {
    f.cyl(rx, R.y, z + sz * (R.w * 0.5 + 4), R.r + 10, 7, M.rail, ROT_Z);
    f.box(x + ix * (F.column.w * 0.5 + 16), R.y, z + sz * (R.w * 0.5 + 11), 32, 34, 8, M.dark);
  }
  f.cyl(rx, R.y, z, 13, R.w + 30, M.yellow, ROT_Z);
  const ex = x + ix * F.exit.out;
  f.box(ex, F.exit.y - 9, z, 24, 8, 50, M.dark);
  for (const sz of [-1, 1]) f.cyl(ex, F.exit.y - 3, z + sz * 17, 6, 28, M.rail, [0, 0, Math.PI / 2]);
  // obrotnica barku na szczycie kolumny
  const S = F.shoulder;
  f.cyl(x, F.column.top + 22, z, S.r, 44, M.dark);
  f.ring(x, F.column.top + 6, z, S.r + 3, 0, M.rail, [Math.PI / 2, 0, 0]);
  f.cyl(x, F.column.top + 46, z, S.r - 8, 6, M.yellow);
  // ---- człon 1 (bark)
  const L1 = F.link1;
  const gLink1 = addGroup({ kind: 'fuel-link1', berthId: b.id, side: s });
  f.group = gLink1;
  f.cyl(0, L1.y, 0, S.r - 6, L1.h + 20, M.steel);
  f.box(L1.len * 0.5, L1.y, 0, L1.len, L1.h, L1.w, M.yellow);
  f.box(L1.len * 0.5 - 6, L1.y + L1.h * 0.5 + 1.5, 0, L1.len - 80, 3, L1.w * 0.34, M.dark);
  f.box(L1.len - 40, L1.y + L1.h * 0.5 + 1.5, 0, 16, 3, L1.w - 6, M.black);
  f.box(L1.len * 0.46, L1.y - 3, L1.w * 0.5 + 5, L1.len * 0.66, 12, 8, M.dark);
  // ---- człon 2 (łokieć) z tuleją wysięgnika
  const L2 = F.link2;
  const gLink2 = addGroup({ kind: 'fuel-link2', berthId: b.id, side: s, parent: gLink1 });
  f.group = gLink2;
  f.cyl(0, (F.elbow.y0 + F.elbow.y1) * 0.5, 0, F.elbow.r, F.elbow.y1 - F.elbow.y0, M.dark);
  f.cyl(0, F.elbow.y1 + 2, 0, F.elbow.r - 10, 5, M.yellow);
  f.box(L2.len * 0.5, L2.y, 0, L2.len, L2.h, L2.w, M.yellow);
  f.box(L2.len * 0.5, L2.y + L2.h * 0.5 + 1.5, 0, L2.len - 70, 3, L2.w * 0.34, M.dark);
  f.box(L2.len - 34, L2.y + L2.h * 0.5 + 1.5, 0, 14, 3, L2.w - 6, M.black);
  f.cyl(L2.len, L2.y + 8, 0, 22, L2.h + 34, M.steel);
  f.ring(L2.len, L2.y - L2.h * 0.5 - 6, 0, 20, 0, M.rail, [Math.PI / 2, 0, 0]);
  // ---- trzon wysięgnika (grupa w przegubie złączki; wysokości lokalne liniowo w górę)
  const gRod = addGroup({ kind: 'fuel-rod', berthId: b.id, side: s });
  f.group = gRod;
  f.mode = 'lin';
  f.cyl(0, F.rod * 0.5, 0, 9, F.rod, M.rail);
  f.cyl(0, F.rod + 3, 0, 13, 7, M.dark);
  f.cyl(0, 2, 0, 15, 10, M.dark);
  // ---- złączka (grupa: położenie i oś z fizyki; przewód wchodzi z boku)
  const gCoupler = addGroup({ kind: 'coupler', berthId: b.id, side: s });
  f.group = gCoupler;
  f.cyl(0, 0, 0, 17, 46, M.steel);
  f.cyl(0, 18, 0, 22, 10, M.yellow);
  f.cyl(0, -19, 0, 23, 10, M.rail);
  f.cyl(0, -26, 0, 14, 9, M.black);
  for (const xx of [-20, 20]) f.box(xx, 0, 0, 7, 32, 8, M.dark);
  f.ring(0, 11, 0, 18, 2, M.status, [Math.PI / 2, 0, 0]);
  f.cyl(0, F.wrist * 0.55, 0, 6, F.wrist * 0.9, M.dark);
  f.mode = 'abs';
  f.group = 0;
  f.set = 'bg';
  return { berthId: b.id, side: s, anchor: a, link1: gLink1, link2: gLink2, rod: gRod, coupler: gCoupler };
}

// Rurociągi paliwa (2026-10-07, prośba użytkownika: „dopracuj modelowanie doku — brak jest rur”): magazyn przy ścianie
// tylnej — zbiorniki-cygara na siodłach (k7FuelTanks: te same obrysy w kolizjach i gazie hali), pompy, kolektory paliwa
// i powrotu wzdłuż ściany; z kolektorów rurociągi na legarach wzdłuż boków stanowisk capital (dawne bieżnie suwnic)
// do zaworów przy słupkach paliwowych; piony do zaworów upustowych na ścianie tylnej (`rig.vents` — kogut nad zaworem,
// gaz hali) i rury instalacji na licu ściany (nad płaszczyzną lotu). Barwy: paliwo — miedź, powrót — turkus, azot
// (przedmuch) — jasne, opaski — żółte.
function buildFuelPiping(f, l, rig) {
  const M = K7_MAT;
  const FF = K7_FUEL_FARM;
  const H = FF.header;
  const RK = FF.rack;
  const ROT_X = [0, 0, Math.PI / 2];
  const ROT_Z = [Math.PI / 2, 0, 0];
  const RING_X = [0, Math.PI / 2, 0];
  const RING_Y = [Math.PI / 2, 0, 0];
  const pipeX = (x0, x1, y, z, r, mat) => f.cyl((x0 + x1) * 0.5, y, z, r, Math.abs(x1 - x0), mat, ROT_X);
  const pipeZ = (x, y, z0, z1, r, mat) => f.cyl(x, y, (z0 + z1) * 0.5, r, Math.abs(z1 - z0), mat, ROT_Z);
  const pipeY = (x, z, y0, y1, r, mat) => f.cyl(x, (y0 + y1) * 0.5, z, r, y1 - y0, mat);
  // zawór: korpus, pokrętło (pierścień) i trzpień
  const valve = (x, y, z, r) => {
    f.box(x, y, z, r * 3.2, r * 2.6, r * 2.2, M.dark);
    f.ring(x, y + r * 2.4, z, r * 1.5, 0, M.red, RING_Y);
    f.cyl(x, y + r * 1.7, z, r * 0.35, r * 1.4, M.steel);
  };
  const capital = l.berths.filter((b) => b.size === 'CAPITAL');
  f.set = 'bg';
  // ---- zbiorniki
  for (const t of k7FuelTanks(l)) {
    const half = t.len * 0.5;
    f.cyl(t.x, t.y, t.z, t.r, t.len, M.pale, ROT_X);
    for (const sx of [-1, 1]) {
      f.cyl(t.x + sx * (half + 8), t.y, t.z, t.r * 0.86, 16, M.pale, ROT_X);
      f.cyl(t.x + sx * (half + 20), t.y, t.z, t.r * 0.56, 10, M.pale, ROT_X);
      // siodło
      f.box(t.x + sx * half * 0.62, (t.y - t.r * 0.35) * 0.5, t.z, 36, t.y - t.r * 0.35, t.r * 1.9, M.dark);
      f.box(t.x + sx * half * 0.62, 3, t.z, 60, 6, t.r * 2.2, M.steel);
    }
    for (const k of [-0.36, 0, 0.36]) f.ring(t.x + k * t.len, t.y, t.z, t.r + 1, 0, M.yellow, RING_X);
    // właz i zawór oddechowy na grzbiecie
    f.cyl(t.x + half * 0.2, t.y + t.r + 5, t.z, 15, 12, M.steel);
    f.ring(t.x + half * 0.2, t.y + t.r + 11, t.z, 13, 0, M.rail, RING_Y);
    f.cyl(t.x - half * 0.55, t.y + t.r + 8, t.z, 7, 18, M.copper);
    // odejście do kolektora paliwa (od spodu zbiornika ku ścianie tylnej) z zaworem
    const ox = t.x + half * 0.42;
    pipeZ(ox, H.y, H.fuelZ + H.fuelR, t.z - t.r * 0.6, 9, M.copper);
    f.ring(ox, H.y, (H.fuelZ + t.z) * 0.5, 11, 0, M.rail, [0, 0, 0]);
    valve(ox, H.y, H.retZ + 30, 9);
  }
  // ---- pompy (między zbiornikami stanowiska) z odejściem do kolektora
  for (const b of capital) {
    const pz = FF.tank.z - 30;
    f.box(b.x, 7, pz, 92, 14, 150, M.dark);
    f.cyl(b.x, 38, pz - 26, 22, 46, M.teal);
    f.cyl(b.x, 40, pz + 34, 17, 64, M.yellow, ROT_Z);
    f.box(b.x, 66, pz + 34, 26, 8, 40, M.dark);
    pipeZ(b.x, 30, H.fuelZ + H.fuelR, pz - 48, 9, M.copper);
  }
  // ---- kolektory wzdłuż ściany tylnej (paliwo i powrót) na podporach, kołnierze
  pipeX(-H.x, H.x, H.y, H.fuelZ, H.fuelR, M.copper);
  pipeX(-H.x, H.x, H.y - 8, H.retZ, H.retR, M.teal);
  for (const sx of [-1, 1]) {
    f.cyl(sx * (H.x + 9), H.y, H.fuelZ, H.fuelR * 0.75, 18, M.dark, ROT_X);
    f.cyl(sx * (H.x + 7), H.y - 8, H.retZ, H.retR * 0.75, 14, M.dark, ROT_X);
  }
  for (let x = -H.x + 120; x < H.x; x += 260) {
    if (Math.abs(x) < 200) continue;
    f.box(x, (H.y - H.fuelR) * 0.5, (H.fuelZ + H.retZ) * 0.5, 26, H.y - H.fuelR + 4, 96, M.dark);
  }
  for (let x = -H.x + 250; x < H.x - 100; x += 520) {
    f.ring(x, H.y, H.fuelZ, H.fuelR + 3, 0, M.rail, RING_X);
    f.ring(x + 130, H.y - 8, H.retZ, H.retR + 2.5, 0, M.rail, RING_X);
  }
  // ---- rurociągi wzdłuż stanowisk do słupków paliwowych (paliwo, azot od zewnątrz, powrót od stanowiska)
  for (const b of capital) {
    for (const a of b.serviceAnchors) {
      const s = a.side;
      const x0 = a.x;
      const z0 = RK.z0;
      const z1 = a.z - K7_FUEL_STATION.plinth.d * 0.5 - 30;
      pipeZ(x0, RK.y + 4, z0, z1, RK.fuelR, M.copper);
      pipeZ(x0 + s * RK.gap, RK.y, z0 + 40, z1, RK.gasR, M.pale);
      pipeZ(x0 - s * RK.gap, RK.y + 1, z0 + 40, z1, RK.retR, M.teal);
      for (let z = z0 + 120; z < z1 - 40; z += 230) {
        f.box(x0, 5, z, 2 * RK.gap + 46, 10, 18, M.dark);
        f.box(x0, 1, z, 2 * RK.gap + 70, 2, 30, M.steel);
      }
      for (let z = z0 + 240; z < z1 - 60; z += 460) {
        f.ring(x0, RK.y + 4, z, RK.fuelR + 3, 0, M.rail, [0, 0, 0]);
        f.ring(x0, RK.y + 4, z + 18, RK.fuelR + 1.5, 0, M.yellow, [0, 0, 0]);
      }
      // zawór odcinający przy kolektorze, stacja zaworów przed słupkiem
      valve(x0, RK.y + 6, z0 + 70, 10);
      f.box(x0, 20, z1 + 14, 2 * RK.gap + 40, 40, 34, M.dark);
      f.cyl(x0, 52, z1 + 14, 11, 28, M.yellow);
      f.box(x0 - s * (RK.gap + 22), 30, z1 + 14, 6, 10, 10, M.green);
      f.box(x0 + s * (RK.gap + 22), 30, z1 + 14, 6, 10, 10, M.red);
    }
  }
  // ---- piony do zaworów upustowych na ścianie tylnej (gaz hali: zawory 'wall' z haloPortK7Lights.js)
  const faceZ = l.backZ + l.wallThickness * 0.5 + 24;
  for (const v of rig?.vents || []) {
    if (v.kind !== 'wall') continue;
    const px = v.x + 40;
    pipeY(px, faceZ, H.y, 412, 11, M.pale);
    f.ring(px, H.y + 40, faceZ, 13, 0, M.rail, RING_Y);
    f.box(px, 236, faceZ + 4, 36, 54, 30, M.dark);
    f.ring(px, 266, faceZ + 22, 15, 0, M.red, [0, 0, 0]);
    pipeZ(px, 412, faceZ - 10, faceZ + 36, 11, M.pale);
    f.cyl(px, 412, faceZ + 42, 17, 12, M.dark, ROT_Z);
    for (const yy of [150, 330]) f.box(px, yy, faceZ - 12, 30, 12, 26, M.dark);
  }
  // ---- rury instalacji na licu ściany tylnej (nad płaszczyzną lotu — przy ścianie, nie nad stanowiskami)
  f.set = 'fg';
  const X = l.halfWidth - 300;
  pipeX(-X, X, 252, faceZ + 4, 10, M.teal);
  pipeX(-X, X, 284, faceZ + 14, 8, M.pale);
  for (let x = -X + 100; x < X; x += 400) f.box(x, 268, faceZ - 6, 16, 64, 26, M.dark);
  for (let x = -X + 300; x < X - 100; x += 800) {
    f.ring(x, 252, faceZ + 4, 12.5, 0, M.rail, RING_X);
    f.ring(x + 200, 284, faceZ + 14, 10, 0, M.rail, RING_X);
  }
  f.set = 'bg';
}


// Pylony hali (poprawki użytkownika 2026-10-05: doki „za mocno wciśnięte
// w ring” — szkic: dok daleko za krawędzią ringu na dwóch ramionach; pylony
// „za słabe, jakby nie miały utrzymać”; „dok leży NA pylonach, a pylony mają
// wystawać BEZPOŚREDNIO z niego — ze ściany tylnej przechodzi się do pylonu”).
// Hala stoi HALO_PORT.dockGap za krawędzią ścian habitatu; trzymają ją dwa
// masywne pylony-korytarze NA WYSOKOŚCI HALI (k7HallArms — te same wielokąty
// co kolizje): rozszerzona stopa na płycie portu (wieża do terminalu „PORT
// KEPLER” pod płaszczyzną, z oknami na kosmos), zwężenie, dźwigar ze
// ścianami-pasami i żebrami dachu, rozszerzenie i korzeń wpięty w ścianę
// tylną; w ścianie od środka hali brama przejścia do pylonu. Pylony są
// przeszkodą lotu (buildPortCollision), między nimi można przelecieć.
// Wysokości w świecie przeliczane na wysokości K-7 (yW = k7ZToHeight).
// Dawny kołnierz z nadprożem i klin nośny (hala wpięta w podłogę) usunięte.
const yW = k7ZToHeight;
function buildDockPylons(f, plates, labels, l, ring, style = resolveHaloProfile('earth').port) {
  const M = K7_MAT;
  // z huba powierzchni podłogi (płyta portu); bez ringu — pylony długości odsunięcia Ziemi
  const floorZ = Number.isFinite(ring.floorZ) ? ring.floorZ : l.backZ - 4000;
  const frame = { floorZ, floorR: ring.floorR || 42259 };
  const zLow = HALO_PORT.plugZMin;                // spód terminalu i wież stóp (z świata)
  const zTerm = -330;                             // dach terminalu
  const boxW = (x, z0w, z1w, zc, w, d, mat) => {
    const y0 = yW(z0w);
    const y1 = yW(z1w);
    f.box(x, (y0 + y1) * 0.5, zc, w, y1 - y0, d, mat);
  };
  const R = frame.floorR;
  const floorAt = (x) => floorZ - (x * x) / (2 * R) - 20;
  const arms = k7HallArms(frame, l);
  const xOut = Math.abs(arms[0].x) + arms[0].flareWidth * 0.5 + 300;
  // ---- terminal na płycie portu (między stopami pylonów, okna na kosmos)
  const face = floorZ + 400;
  {
    const bot = floorAt(xOut);
    boxW(0, zLow, zTerm, (face + bot) * 0.5, 2 * xOut, face - bot, M.dark);
  }
  boxW(0, zTerm, zTerm + 14, face - 20, 2 * xOut - 80, 40, M.pale);
  for (let row = 0; row < 6; row++) {
    const z0 = zTerm - 110 - row * 128;
    if (z0 < zLow + 60) break;
    boxW(0, z0, z0 + 28, face + 4, 2 * xOut - 360, 6, row % 3 === 1 ? M.cyan : M.warm);
  }
  for (let x = -xOut + 260; x <= xOut - 260; x += 520) boxW(x, zLow + 40, zTerm - 40, face + 8, 18, 10, M.steel);
  boxW(0, zLow + 10, zLow + 34, face + 6, 2 * xOut - 160, 8, M.cyan);
  labels.push({ text: style.name, small: style.terminal, color: style.labels.terminal, x: 0, z: face + 14, width: 2600, depth: 355, rotation: 0, y: -560, vertical: true, set: 'bg' });
  // ---- pylony
  const rail = 110;                                 // pasy na krawędziach (ściany korytarza)
  for (const a of arms) {
    const { x, width: W, flareWidth: WF, zw0, zw1, footEnd, rootStart, taper } = a;
    const [foot, mid, root] = a.polys;
    const midA = footEnd + taper;
    const midB = rootStart - taper;
    const midL = midB - midA;
    const mc = (midA + midB) * 0.5;
    const hw = W * 0.5;
    const hf = WF * 0.5;
    // bryła z wielokątów k7DockArms: stopa ze zwężeniem (wieża od terminalu pod
    // płaszczyzną), dźwigar, rozszerzenie z korzeniem w ścianie tylnej
    plates.push({ points: foot, z0: zLow, z1: zw1, mat: M.dark, set: 'bg' });
    plates.push({ points: mid, z0: zw0, z1: zw1, mat: M.dark, set: 'bg' });
    plates.push({ points: root, z0: zw0 - 20, z1: zw1, mat: M.dark, set: 'bg' });
    // pasy-ściany wzdłuż obu krawędzi całego obrysu (z góry — kontur belki)
    const rz = zw1 + 45 - rail * 0.5;
    for (const sx of [-1, 1]) {
      const path = [[x + sx * hf, a.z0 + 60], [x + sx * hf, footEnd], [x + sx * hw, midA], [x + sx * hw, midB], [x + sx * hf, rootStart], [x + sx * hf, a.z1 - 40]];
      for (let k = 0; k + 1 < path.length; k++) {
        const [xa, za] = path[k];
        const [xb, zb] = path[(k + 1)];
        const px = (xa + xb) * 0.5 - sx * rail * 0.5;
        if (Math.abs(xb - xa) < 1) boxW(px, zw0, zw1 + 45, (za + zb) * 0.5, rail, zb - za, M.steel);
        else f.beam([xa - sx * rail * 0.5, yW(rz), za], [xb - sx * rail * 0.5, yW(rz), zb], rail, M.steel);
        if (k > 0) boxW(xa - sx * rail * 0.5, zw1 - 20, zw1 + 50, za, rail + 20, rail + 20, M.steel);
      }
    }
    // żebra dachu w poprzek całej długości (szerokość z obrysu)
    for (let z = a.z0 + 260; z < a.z1 - 120; z += 300) {
      boxW(x, zw1, zw1 + 22, z, k7ArmWidthAt(a, z) - rail * 1.6, 64, M.pale);
    }
    // lica dźwigara: słupki i krzyżulce (kratownica Warrena), okna korytarza
    const n = Math.max(2, Math.round(midL / 340));
    const st = midL / n;
    for (let i = 0; i <= n; i++) {
      const z = midA + i * st;
      for (const sx of [-1, 1]) {
        const xf = x + sx * (hw + 10);
        boxW(xf, zw0, zw1 + 20, z, 30, 60, M.pale);
        if (i < n) {
          const up = (i & 1) === 0;
          f.beam([xf, yW(up ? zw0 + 30 : zw1 - 20), z + 30], [xf, yW(up ? zw1 - 20 : zw0 + 30), z + st - 30], 30, M.steel);
        }
      }
    }
    for (const sx of [-1, 1]) {
      boxW(x + sx * (hw + 2), zw0 + 150, zw0 + 190, mc, 6, midL - 120, M.warm);
      boxW(x + sx * (hw - rail - 6), zw1 + 4, zw1 + 12, mc, 12, midL - 60, M.cyan);
    }
    // światła przeszkodowe na narożnikach stopy i korzenia
    for (const sx of [-1, 1]) {
      boxW(x + sx * (hf - 40), zw1 + 45, zw1 + 85, footEnd - 60, 50, 50, M.red);
      boxW(x + sx * (hf - 40), zw1 + 45, zw1 + 85, rootStart + 60, 50, 50, M.red);
    }
    // przejście z hali do pylonu: brama w ścianie tylnej od środka (rama, wrota, światło)
    const zin = l.backZ + l.wallThickness * 0.5 + 6;
    boxW(x, -116, 160, zin, W * 0.62, 10, M.black);
    for (const sx of [-1, 1]) boxW(x + sx * W * 0.33, -116, 175, zin + 4, 40, 14, M.yellow);
    boxW(x, 160, 180, zin + 4, W * 0.7, 14, M.yellow);
    boxW(x, 140, 150, zin + 10, W * 0.5, 6, M.green);
  }
}
