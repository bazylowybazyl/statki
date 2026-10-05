// Suchy dok piratów (misja 1) jako DANE instancji — bez Three (testy node czytają je wprost). Ten sam
// rejestrator i shader co budowle portowe Z7 (portBuildingScene.js / portBuildings3D.js): zestawy BG (pod
// statkami), FG (ogrodzenie, bramy, pylony, maszty reflektorów, wieże — nad statkami) i dach hali (zanika jak
// dach K-7), płyty (pokład parkingu i hali, fartuchy), napisy, kanały efektów, lampy (reflektory).
//
// Wygląd jak sprite'y okrętów piratów „Iron Skull” (src/assets/ships/pirate*.png, paleta PIRATE_PORT_STYLE):
// ciemne żelazo przeżarte rdzą, czerwone ukośne pasy, kolce na krawędziach, szpony na dziobach trzonu, okrągłe
// włazy w ośmiokątnych ramach, kratki, wiązki rur, napis IRON SKULL na pokładach (bez czaszek — decyzja
// użytkownika 2026-10-05).
//
// KAWAŁKI = GRUPY RENDERU: każda bryła kawałka (layout.chunks — odcinek trzonu, rama końcowa z pylonami,
// brama, sekcja ogrodzenia, przęsło ściany hali, pas dachu, złącze, wieża) jest nagrana w grupie
// `chunk.group`. Macierz grupy przesuwa i obraca kawałek (odpadanie przy zniszczeniu, staranowana brama),
// a macierz z elements[15] = 0 chowa go w całości (shader: grupa ukryta) — „maska statyki” z planu zniszczeń
// (docs/PLAN-zniszczenia-swiata-3d.md § 6): gdy kawałek stanie się ciałem silnika belek, statyczny
// odpowiednik znika, ciało rysuje skóra. Grupa 0 — podłoże, które zostaje (pokład parkingu ze stanowiskami
// i kołyskami, pokład hali, fartuchy, napisy).
//
// Wysokości jak w K-7 (y nad pokładem; płaszczyzna gry y = 116 = z świata 0; nad nią ×0,42), materiały =
// kody K7_MAT, emisja w paśmie HDR 0,9–1,8 (reflektory i światła przeszkodowe nad progiem bloomu).
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { PB_FX, PB_MAT, PB_MAX_GROUPS, PB_MAX_LAMPS, PortRecorder, pbArrow, pbHash1, pbHazard, pbLabel, pbPlate, pbStripe } from './portBuildingScene.js';

// Kanały efektów (uChan, 16 liczb) — ustawia PirateDryDock3D.update ze stanu klatki.
export const DD_CH = Object.freeze({
  alarm: 0,                 // alarm stoczni (koguty)
  launch: (g) => 1 + g,     // wylot przez bramę hali g (0 = G-01, 1 = G-02, 2 = G-03): światła pasa
  gate: (g) => 4 + g,       // sygnał bramy hali g: 0 czerwony, 1 zielony
  bays: 8,                  // maska bitowa zajętych stanowisk parkingu (bit k = stanowisko k) — lampki zielone
  baysFree: 9               // maska wolnych (okręt zniszczony / odleciał) — lampki czerwone
});

const BAY_NAME = Object.freeze({ frigate: 'FREGATA', destroyer: 'NISZCZYCIEL', battleship: 'PANCERNIK' });

// ---------------------------------------------------------------------------
// Detale piratów

// Wiązka odsłoniętych rur (jak na sprite'ach) wzdłuż osi x na wierzchu o wysokości y: rury różnej grubości
// i barwy, obejmy co ~120.
function pipeBundle(f, x, y, z, len, width) {
  const M = PB_MAT;
  const n = Math.max(3, Math.round(width / 34));
  const mats = [M.hose, M.copper, M.rail, M.hose, M.dark];
  for (let i = 0; i < n; i++) {
    const r = 9 + 6 * pbHash1(i * 2.3 + x * 0.001);
    f.cyl(x, y + r, z - width / 2 + (i + 0.5) * (width / n), r, len, mats[i % mats.length], [0, 0, Math.PI / 2]);
  }
  for (let xx = x - len / 2 + 50; xx < x + len / 2 - 20; xx += 120) f.box(xx, y + 14, z, 16, 30, width + 14, M.dark);
}

// Rząd kolców wzdłuż odcinka (ax, az) → (bx, bz) na wysokości y: szpic na zewnątrz (ox, oz) i w górę (tilt),
// długości nierówne (hasz — bez Math.random).
function spikeRow(f, ax, az, bx, bz, y, step, len, r, ox, oz, tilt = 0.35, seed = 0) {
  const L = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(L / step));
  const dl = Math.hypot(ox, tilt, oz) || 1;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const k = 0.75 + 0.5 * pbHash1(seed * 17.3 + i * 3.1);
    const h = len * k;
    f.cone(ax + (bx - ax) * t + (ox / dl) * h * 0.42, y, az + (bz - az) * t + (oz / dl) * h * 0.42, r * (0.8 + 0.3 * k), h, PB_MAT.rail, [ox, tilt, oz]);
  }
}

// Okrągły właz (zaślepka gniazda jak na sprite'ach) w ośmiokątnej ramie na powierzchni o wierzchu y.
// Rama = płaski ośmioboczny stożek (geometria stożka ma 8 boków).
function hatch(f, x, y, z, r) {
  const M = PB_MAT;
  f.cone(x, y + 3, z, r * 1.22, 6, M.dark);
  f.cyl(x, y + 6, z, r, 4, M.rail);
  f.cyl(x, y + 8, z, r * 0.84, 4, M.steel);
  f.ring(x, y + 10, z, r * 0.92, 0, M.black, [Math.PI / 2, 0, 0]);
  f.box(x, y + 10.5, z, r * 0.95, 2, r * 0.12, M.dark);
}

// Kratka wentylacyjna z prętami (jak na sprite'ach): ciemna wnęka i pręty w poprzek osi `rot`.
function grille(f, x, y, z, w, d, rot = 0) {
  const M = PB_MAT;
  f.box(x, y, z, w, 4, d, M.black, rot);
  const n = Math.max(3, Math.round(w / 22));
  const c = Math.cos(rot);
  const s = -Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + (i + 0.5) * (w / n);
    f.box(x + c * u, y + 2, z + s * u, Math.max(4, (w / n) * 0.42), 4, d * 0.9, M.rail, rot);
  }
}

// Czerwone pasy po skosie (jak na barkach okrętów piratów) na prostokątnym wierzchu (głębokość d wzdłuż z).
function diagBands(f, x, y, z, d, angle = 0.6, width = 80, gap = 50, count = 2, mat = PB_MAT.yellow) {
  const L = d / Math.cos(angle);
  const step = (width + gap) / Math.cos(angle);
  for (let i = 0; i < count; i++) f.box(x + (i - (count - 1) / 2) * step, y, z, width, 1.5, L, mat, angle);
}

// Pasy ostrzegawcze (czerwono-czarne skosy) w prostokącie wzdłuż z.
function hazardZ(f, x, z0, z1, depth, y = 2) {
  const M = PB_MAT;
  const n = Math.max(2, Math.round((z1 - z0) / (depth * 0.9)));
  const w = (z1 - z0) / n;
  for (let i = 0; i < n; i++) f.box(x, y, z0 + (i + 0.5) * w, depth, 1.6, w * 0.52, i % 2 ? M.black : M.yellow, 0.5);
}

// ---------------------------------------------------------------------------
// Hala (K-7 piratów)

// Ściana hali K-7 na odcinku krawędzi [s0, s1] (normalna krawędzi na zewnątrz): korpus jak bryła kolizji K-7
// (y 290, h 580, d 88), cokół, listwa szczytowa, łatane panele i listwy od środka, przypory i zastrzały od
// zewnątrz, kolce wzdłuż górnej krawędzi.
function wallSpan(f, e, s0, s1, { buttress = true, seed = 0, spikes = true } = {}) {
  const M = PB_MAT;
  const len = s1 - s0;
  if (len < 1) return;
  const x = e.a[0] + e.ux * (s0 + s1) / 2;
  const z = e.a[1] + e.uz * (s0 + s1) / 2;
  const rot = -e.angle;
  f.box(x, 290, z, len, 580, 88, M.dark, rot);
  f.box(x, 46, z, len, 92, 118, M.steel, rot);
  f.box(x, 566, z, len, 28, 122, M.rail, rot);
  const count = Math.max(1, Math.floor(len / 390));
  const mod = len / count;
  for (let k = 0; k < count; k++) {
    const a = s0 + (k + 0.5) * mod;
    const px = e.a[0] + e.ux * a;
    const pz = e.a[1] + e.uz * a;
    const h = pbHash1(seed * 31 + k * 7.13);
    // panele od środka: łatane — rdza i blachy z odzysku
    const panel = h < 0.22 ? M.orange : h < 0.4 ? M.teal : (k % 4 === 0 ? M.pale : M.steel);
    f.box(px - e.nx * 50, 299, pz - e.nz * 50, Math.max(26, mod - 19), 300, 16, panel, rot);
    f.box(px - e.nx * 68, 395, pz - e.nz * 68, Math.min(mod - 30, 275), 24, 13, h > 0.5 ? M.paint : M.dark, rot);
    f.fx(0.9, PB_FX.steady);
    f.box(px - e.nx * 61, 159, pz - e.nz * 61, Math.min(mod - 30, 275), 7, 12, M.cyan, rot);
    f.nofx();
    for (const sy of [234, 319]) f.box(px - e.nx * 66, sy, pz - e.nz * 66, Math.min(mod - 40, 142), 22, 9, M.dark, rot);
    // rdza na listwie szczytowej (widać z góry)
    if (h < 0.35) f.box(px, 581, pz, Math.min(mod * 0.6, 220), 2, 100, M.orange, rot);
    if (buttress && len > 250) {
      f.box(px + e.nx * 59, 215, pz + e.nz * 59, 40, 430, 150, M.dark, rot);
      f.beam([px + e.nx * 100, -50, pz + e.nz * 100], [px + e.nx * 56, 438, pz + e.nz * 56], 36, M.steel);
    }
  }
  if (spikes) {
    const ax = e.a[0] + e.ux * s0 + e.nx * 58;
    const az = e.a[1] + e.uz * s0 + e.nz * 58;
    const bx = e.a[0] + e.ux * s1 + e.nx * 58;
    const bz = e.a[1] + e.uz * s1 + e.nz * 58;
    spikeRow(f, ax, az, bx, bz, 560, 240, 140, 26, e.nx, e.nz, 0.45, seed + 3);
  }
}

// Rama bramy hali: nadproże, ościeża w pasy, drabinki, listwy, sygnalizator (kanał bramy), napis.
function gateFrame(f, labels, e, gate, gi, LC) {
  const M = PB_MAT;
  const rot = -e.angle;
  const cw = gate.clearWidth;
  f.box(e.x, 673, e.z, cw + 155, 145, 174, M.dark, rot);
  f.box(e.x, 635, e.z, cw, 22, 183, M.rail, rot);
  f.fx(0.9, PB_FX.steady);
  f.box(e.x - e.nx * 91, 623, e.z - e.nz * 91, cw - 60, 12, 12, M.cyan, rot);
  f.nofx();
  for (const end of [gate.jamb, e.length - gate.jamb]) {
    const x = e.a[0] + e.ux * end;
    const z = e.a[1] + e.uz * end;
    f.box(x, 304, z, 33, 598, 135, M.yellow, rot);
    for (let y = 70; y < 590; y += 120) f.box(x, y, z, 35, 44, 137, M.black, rot);
    f.fx(0.9, PB_FX.steady);
    f.box(x - e.nx * 73, 315, z - e.nz * 73, 17, 434, 16, M.cyan, rot);
    f.nofx();
    for (let y = 110; y < 580; y += 95) f.box(x + e.nx * 72, y, z + e.nz * 72, 27, 35, 9, M.black, rot);
  }
  // nadproże: kolce ku kosmosowi
  spikeRow(f, e.a[0] + e.ux * gate.jamb + e.nx * 95, e.a[1] + e.uz * gate.jamb + e.nz * 95,
    e.b[0] - e.ux * gate.jamb + e.nx * 95, e.b[1] - e.uz * gate.jamb + e.nz * 95, 700, 210, 150, 26, e.nx, e.nz, 0.3, gi + 90);
  f.fx(1.2, PB_FX.status, 0, DD_CH.gate(gi));
  for (let k = -1; k <= 1; k++) {
    const o = k * cw * 0.3;
    f.box(e.x + e.ux * o + e.nx * 92, 681, e.z + e.uz * o + e.nz * 92, 125, 31, 8, M.status, rot);
  }
  f.nofx();
  pbLabel(labels, gate.id, e.x - e.nx * 150, e.z - e.nz * 150, gate.main ? 380 : 300, gate.main ? 92 : 76, LC.gate, gate.name, rot);
}

// ---------------------------------------------------------------------------
// Trzon

// Rękaw (pomost pod płaszczyzną gry) z nabrzeża trzonu do dziobu okrętu stanowiska: pomost, poręcze,
// wsporniki, światła prowadzące ku dziobowi, kleszcze cumownicze, wąż mediów; lampki zajętości na nabrzeżu.
function buildGangway(f, l, b) {
  const M = PB_MAT;
  const zq = l.spec.spineHalfDepth;
  const w = b.slot.x1 - b.slot.x0;
  const z0 = zq + 10;
  const z1 = b.bowZ - 12;
  if (z1 - z0 < 40) return;
  const zc = (z0 + z1) / 2;
  const L = z1 - z0;
  const gw = Math.min(64, w * 0.4);
  f.box(b.x, 66, zc, gw, 20, L, M.dark);
  f.box(b.x, 77, zc, gw - 10, 2, L - 6, M.floor);
  for (const s of [-1, 1]) f.box(b.x + s * (gw / 2 - 3), 92, zc, 5, 28, L, M.rail);
  for (let z = z0 + 60; z < z1 - 20; z += 110) f.box(b.x, 20, z, gw + 16, 80, 14, M.steel);
  const m = Math.max(1, Math.floor((L - 40) / 70));
  let k = 0;
  for (let z = z0 + 30; z < z1 - 10; z += 70, k++) {
    f.fx(1.0, PB_FX.chase, k / m, 0.7);
    f.box(b.x, 79, z, 10, 3, 18, M.cyan);
    f.nofx();
  }
  f.box(b.x, 82, z1 - 10, gw + 44, 44, 26, M.steel);
  f.box(b.x, 105, z1 - 10, gw + 40, 3, 22, M.yellow);
  for (const s of [-1, 1]) f.box(b.x + s * (gw / 2 + 26), 84, z1 + 4, 14, 40, 34, M.dark);
  f.beam([b.x + gw / 2 + 8, 104, z0 + 16], [b.x + gw / 2 + 8, 72, z1 - 30], 8, M.hose);
  const bit = 1 << b.index;
  f.fx(1.3, PB_FX.show, bit, DD_CH.bays);
  f.box(b.x - gw / 2 - 20, 168, zq - 12, 24, 8, 24, M.green);
  f.nofx();
  f.fx(1.3, PB_FX.show, bit, DD_CH.baysFree);
  f.box(b.x + gw / 2 + 20, 168, zq - 12, 24, 8, 24, M.red);
  f.nofx();
}

// Odcinek trzonu: kadłub, pokład, dźwigary brzegowe, żebra, wiązki rur, nadbudowa (kręgosłup) z oknami,
// listwami i kolcami, wierzch kręgosłupa (włazy, kratki, pasy, czaszka, radiatory), nabrzeże od strony
// parkingu z rękawami do dziobów albo blok końcowy ze szponami dziobu trzonu, od strony hali — ściana tylna.
function buildSpineSegment(f, l, seg, si) {
  const M = PB_MAT;
  const S = l.spec;
  const P = l.parking;
  const zq = S.spineHalfDepth;
  const zk = S.keelHalfDepth;
  const x0 = seg.x0;
  const x1 = seg.x1;
  const xc = (x0 + x1) / 2;
  const len = x1 - x0;
  const end = seg.id === 'S-W' ? -1 : seg.id === 'S-E' ? 1 : 0;
  const h = l.hall;
  // kadłub pod pokładem: poczerniałe żelazo, burty z płyt łatanych rdzą, wręgi
  f.box(xc, -180, 0, len, 360, 2 * zq, M.dark);
  f.box(xc, -400, 0, len, 80, 2 * zq - 300, M.dark);
  for (const s of [-1, 1]) {
    f.box(xc, -120, s * (zq + 3), len - 8, 210, 6, M.steel);
    let k = 0;
    for (let x = x0 + 140; x < x1 - 60; x += 280, k++) {
      f.box(x, -150, s * (zq + 8), 30, 300, 12, M.dark);
      const r = pbHash1(si * 13.1 + k * 3.7 + s * 0.31);
      if (r < 0.4 && x + 140 < x1 - 40) f.box(x + 140, -110 - r * 60, s * (zq + 7), 150 + 140 * r, 90 + 60 * r, 6, r < 0.2 ? M.orange : M.teal);
    }
  }
  // pokład, dźwigary brzegowe (wytarte krawędzie), żebra, wiązki rur jak na sprite'ach
  f.box(xc, -5, 0, len - 6, 10, 2 * zq, M.floor);
  for (const s of [-1, 1]) {
    f.box(xc, 24, s * (zq - 22), len, 48, 44, M.steel);
    f.box(xc, 50, s * (zq - 22), len, 4, 48, M.rail);
    for (let x = x0 + 115; x < x1 - 20; x += 230) f.box(x, 14, s * (zk + (zq - zk) / 2), 24, 28, zq - zk - 40, M.dark);
    for (const [dz, r, m] of [[268, 11, M.hose], [296, 16, M.copper], [324, 11, M.hose], [350, 8, M.rail]]) f.cyl(xc, 30, s * dz, r, len - 20, m, [0, 0, Math.PI / 2]);
    for (let x = x0 + 70; x < x1 - 30; x += 260) f.box(x, 36, s * 309, 18, 30, 112, M.dark);
  }
  // kręgosłup: nadbudowa z płyt, okna (ciepła poświata), listwy bursztynowe, żebra, kolce na krawędziach
  const kx0 = end < 0 ? x0 + 200 : x0 + 17;
  const kx1 = end > 0 ? x1 - 200 : x1 - 17;
  const kxc = (kx0 + kx1) / 2;
  const klen = kx1 - kx0;
  f.box(kxc, 190, 0, klen, 380, 2 * zk, M.steel);
  f.box(kxc, 383, 0, klen - 10, 6, 2 * zk + 12, M.dark);
  for (const s of [-1, 1]) {
    f.box(kxc, 262, s * (zk + 1), klen - 90, 26, 4, M.glass);
    f.fx(0.9, PB_FX.steady);
    f.box(kxc, 214, s * (zk + 3), klen - 120, 6, 3, M.cyan);
    f.nofx();
    for (let x = kx0 + 80; x < kx1 - 40; x += 190) f.box(x, 190, s * (zk + 4), 14, 340, 10, M.dark);
    spikeRow(f, kx0 + 40, s * (zk + 4), kx1 - 40, s * (zk + 4), 372, 200, 130, 22, 0, s, 0.55, si * 2 + (s > 0 ? 1 : 0));
  }
  // wierzch kręgosłupa (to widać z góry): wzór odcinka z haszu kolejności
  const top = 387;
  const pat = (si + 1) % 4;
  if (end) {
    // blok końcowy: wierzch kręgosłupa za wieżą — właz i kratka
    hatch(f, end > 0 ? kx0 + 110 : kx1 - 110, top, 0, 80);
    grille(f, end > 0 ? kx0 + 110 : kx1 - 110, top, 165, 120, 50);
  } else if (pat === 0) {
    hatch(f, kxc - klen * 0.27, top, 0, 92);
    hatch(f, kxc + klen * 0.27, top, 0, 92);
    grille(f, kxc, top, 0, 140, 240);
  } else if (pat === 1) {
    diagBands(f, kxc - klen * 0.12, top, 0, 2 * zk, 0.62, 86, 46, 2);
    hatch(f, kxc + klen * 0.3, top, 0, 80);
  } else if (pat === 2) {
    pipeBundle(f, kxc, top, -zk * 0.42, klen * 0.82, 150);
    diagBands(f, kxc - klen * 0.2, top, zk * 0.5, zk - 20, 0.62, 70, 40, 2);
    grille(f, kxc + klen * 0.26, top, zk * 0.5, 130, 150);
  } else {
    const fins = 9;
    for (let i = 0; i < fins; i++) f.box(kxc - klen * 0.3 + (i + 0.5) * ((klen * 0.6) / fins), 412, -zk * 0.2, 12, 50, 2 * zk - 130, M.copper);
    f.cyl(kxc, 396, 0, 16, klen * 0.66, M.steel, [0, 0, Math.PI / 2]);
    for (const s of [-1, 1]) {
      const vx = kxc + s * klen * 0.36;
      f.cyl(vx, 395, zk * 0.45, 58, 14, M.dark);
      f.ring(vx, 402, zk * 0.45, 58, 0, M.rail, [Math.PI / 2, 0, 0]);
      for (const a of [0, Math.PI / 2]) f.box(vx, 403, zk * 0.45, 108, 3, 10, M.rail, a);
    }
  }
  f.fx(1.7, PB_FX.alarm, pbHash1(si * 1.9), DD_CH.alarm);
  f.box(end > 0 ? kx1 - 45 : kx0 + 45, 400, 0, 30, 24, 30, M.red);
  f.nofx();
  f.fx(0.95, PB_FX.steady);
  for (const s of [-1, 1]) f.box(end > 0 ? kx0 + 50 : kx1 - 50, 392, s * (zk - 18), 20, 8, 20, M.warm);
  f.nofx();

  if (end) {
    // blok końcowy: czoło z pasami, szpony dziobu trzonu (jak dzioby okrętów piratów), kolce na burtach
    const xe = end > 0 ? x1 : x0;
    f.box(xe - end * 70, -170, 0, 140, 340, 2 * zq - 160, M.dark);
    f.box(xe - end * 30, 20, 0, 60, 40, 2 * zq - 40, M.steel);
    for (let z = -zq + 50, k = 0; z < zq - 40; z += 70, k++) f.box(xe - end * 30, 42, z, 50, 4, 40, k % 2 ? M.black : M.yellow, 0.5);
    f.cone(xe + end * 240, 24, 0, 84, 540, M.rail, [end, 0.04, 0]);
    for (const s of [-1, 1]) {
      for (const [zb, L1, r1] of [[250, 380, 64], [395, 240, 42]]) {
        const a1 = 0.45;
        const d1x = end * Math.cos(a1);
        const d1z = s * Math.sin(a1);
        const bx = xe - end * 20;
        const bz = s * zb;
        f.cone(bx + d1x * L1 * 0.5, 22, bz + d1z * L1 * 0.5, r1, L1, M.rail, [d1x, 0.03, d1z]);
        // szpic zawinięty do środka
        const jx = bx + d1x * L1 * 0.7;
        const jz = bz + d1z * L1 * 0.7;
        const d2x = end * Math.cos(0.6);
        const d2z = -s * Math.sin(0.6);
        const L2 = L1 * 0.6;
        f.cone(jx + d2x * L2 * 0.5, 22, jz + d2z * L2 * 0.5, r1 * 0.34, L2, M.rail, [d2x, 0.03, d2z]);
      }
      spikeRow(f, x0 + 60, s * (zq + 4), x1 - 60, s * (zq + 4), 40, 170, 150, 26, 0, s, 0.25, si * 5 + s);
    }
  }

  // strona parkingu (+z): nabrzeże z pasem i światłami, rękawy do dziobów okrętów stanowisk odcinka
  const qx0 = Math.max(x0, P.x0);
  const qx1 = Math.min(x1, P.x1);
  if (qx1 - qx0 > 1) {
    f.box((qx0 + qx1) / 2, 80, zq - 10, qx1 - qx0 - 10, 160, 50, M.steel);
    pbHazard(f, qx0 + 20, qx1 - 20, zq + 4, 22, 163);
    f.fx(1.0, PB_FX.steady);
    for (let x = qx0 + 70; x < qx1 - 30; x += 140) f.box(x, 166, zq - 30, 18, 6, 10, M.cyan);
    f.nofx();
  }
  for (const b of l.berths) if (b.x >= x0 && b.x < x1) buildGangway(f, l, b);

  // strona hali (−z): w zasięgu hali — ściana tylna hali (wnętrze jak K-7), dalej niski mur z pasem i kolcami
  const hx0 = h.x - h.halfWidth;
  const hx1 = h.x + h.halfWidth;
  const ox0 = Math.max(x0, hx0);
  const ox1 = Math.min(x1, hx1);
  if (ox1 - ox0 > 1) {
    const back = { a: [ox0, -zq], b: [ox1, -zq], ux: 1, uz: 0, nx: 0, nz: 1, angle: 0, length: ox1 - ox0, x: (ox0 + ox1) / 2, z: -zq };
    wallSpan(f, back, 0, ox1 - ox0, { buttress: false, seed: si + 40, spikes: false });
    for (let x = ox0 + 300; x < ox1 - 200; x += 900) {
      f.box(x, 70, -zq - 52, 150, 140, 10, M.black);
      f.box(x, 146, -zq - 54, 160, 10, 12, M.yellow);
      f.fx(1.0, PB_FX.steady);
      f.box(x + 90, 120, -zq - 56, 10, 10, 6, M.green);
      f.nofx();
    }
  }
  const lowRuns = [];
  if (ox1 - ox0 > 1) {
    if (ox0 - x0 > 1) lowRuns.push([x0, ox0]);
    if (x1 - ox1 > 1) lowRuns.push([ox1, x1]);
  } else lowRuns.push([x0, x1]);
  for (const [a, b2] of lowRuns) {
    f.box((a + b2) / 2, 80, -zq + 10, b2 - a - 10, 160, 50, M.steel);
    pbHazard(f, a + 30, b2 - 30, -zq - 4, 22, 163);
  }
}

// ---------------------------------------------------------------------------
// Parking

// Pokład parkingu (grupa 0 — podłoże zostaje): płyta pod okrętami, kratownica, dźwigary brzegowe, łaty
// rdzy, stanowiska (pole, obrys, obrys kadłuba klasy, oś), kołyski pod kadłubami, napisy, emblematy
// i szyny bram taranowych w strefach wjazdu i wyjazdu.
function buildParkingDeck(f, plates, labels, l, LC) {
  const M = PB_MAT;
  const P = l.parking;
  const PS = l.spec.parking;
  const zq = l.spec.spineHalfDepth;
  const zf = P.z1;
  const x0 = P.x0 - 170;
  const x1 = P.x1 + 170;
  // płyta z blach (jaśniejsza od pokładu K-7 — plamy światła reflektorów mają być widać), pola stanowisk ciemne
  pbPlate(plates, [[x0, zq], [x1, zq], [x1, zf + 150], [x0, zf + 150]], -176, 22, M.steel);
  pbPlate(plates, [[x0 + 60, zq + 30], [x1 - 60, zq + 30], [x1 - 60, zf + 90], [x0 + 60, zf + 90]], -340, 164, M.dark);
  f.box((x0 + x1) / 2, -160, zf + 138, x1 - x0, 34, 24, M.steel);
  for (const x of [x0 + 12, x1 - 12]) f.box(x, -160, (zq + zf + 150) / 2, 24, 34, zf + 150 - zq, M.steel);
  let k = 0;
  for (let x = x0 + 300; x < x1 - 300; x += 520, k++) {
    const r = pbHash1(k * 7.7 + 3);
    if (r < 0.45) f.box(x, -153.5, zq + 80 + r * (zf - zq - 160), 240 + 200 * r, 1.5, 160 + 150 * r, r < 0.22 ? M.orange : M.teal);
  }
  for (const b of l.berths) {
    const w = b.slot.x1 - b.slot.x0;
    const z0 = zq + 30;
    const z1 = zf - 90;
    const zc = (z0 + z1) / 2;
    const bz0 = b.bowZ;
    const bz1 = b.bowZ + b.shipLength;
    // ciemne pole pod kadłubem klasy, czerwone linie parkingu między stanowiskami na całą głębokość
    f.box(b.x, -152, (bz0 + bz1) / 2, w - 14, 2, bz1 - bz0 + 120, M.deckPad);
    for (const s of [-1, 1]) pbStripe(f, b.x + s * (w / 2 - 8), zc, 8, z1 - z0, M.paint, -150);
    pbStripe(f, b.x, bz0 - 14, w - 40, 6, M.paintCold, -150);
    pbStripe(f, b.x, bz1 + 14, w - 40, 6, M.paintCold, -150);
    for (let z = bz0 + 30; z < bz1 - 30; z += 100) pbStripe(f, b.x, z, 6, 46, M.paintCold, -150);
    // kołyska: klocki stępki i podpory burtowe (pod kadłubem, pod płaszczyzną gry)
    for (let z = bz0 + 50; z < bz1 - 30; z += 90) {
      f.box(b.x, -128, z, Math.min(64, w * 0.36), 46, 34, M.dark);
      f.box(b.x, -104, z, Math.min(58, w * 0.33), 3, 30, M.orange);
    }
    for (const s of [-1, 1]) {
      for (const t of [0.3, 0.7]) f.box(b.x + s * w * 0.32, -136, bz0 + b.shipLength * t, 26, 30, 50, M.steel);
    }
    pbLabel(labels, b.id, b.x, z1 - 160, 300, 68, LC.berth, BAY_NAME[b.cls] || '', -Math.PI / 2, -148);
  }
  // strefy wjazdu i wyjazdu: emblemat piratów i napis na pokładzie, szyny bram, pasy przed bramami
  const lz = P.laneZ;
  for (const [xa, xb, gx, inX] of [[P.x0, P.x0 + PS.entry, P.x0, 1], [P.x1 - PS.exit, P.x1, P.x1, -1]]) {
    const xm = (xa + xb) / 2;
    // pole zakazu postoju: czerwone pasy po skosie przez tor (jak pasy na barkach okrętów piratów)
    diagBands(f, xm, -150.5, lz, (P.gateZ1 - P.gateZ0) * 0.6, 0.62 * inX, 110, 90, 2);
    pbLabel(labels, 'IRON SKULL', xm, zq + 150, 760, 105, LC.capital, '', 0, -148);
    for (const s of [-1, 1]) f.box(gx + s * 26, -150, (P.gateZ0 + P.gateZ1) / 2, 10, 6, P.gateZ1 - P.gateZ0, M.rail);
    hazardZ(f, gx + inX * 110, P.gateZ0, P.gateZ1, 70, -148.5);
  }
}

// Cokół ogrodzenia (pod płaszczyzną gry) z pasami — zostaje pod staranowaną bramą stanowiska.
function buildFencePlinth(f, xa, xb, z) {
  const len = xb - xa;
  if (len < 10) return;
  f.box((xa + xb) / 2, -60, z, len, 100, 120, PB_MAT.steel);
  pbHazard(f, xa + 6, xb - 6, z + 42, 24, -8);
  pbHazard(f, xa + 6, xb - 6, z - 42, 24, -8);
}

// Ściana ogrodzenia (FG — nad okrętami): cienka płyta z kratą od zewnątrz, czerwono-czarna krawędź, kolce.
function buildFenceWall(f, xa, xb, z, seed) {
  const M = PB_MAT;
  const len = xb - xa;
  if (len < 10) return;
  f.set = 'fg';
  f.box((xa + xb) / 2, 115, z, len, 290, 34, M.dark);
  const n = Math.max(2, Math.round(len / 60));
  for (let i = 0; i < n; i++) f.box(xa + (i + 0.5) * (len / n), 262, z, (len / n) * 0.9, 4, 40, i % 2 ? M.black : M.yellow);
  for (let x = xa + 20; x < xb - 10; x += 36) f.box(x, 110, z + 22, 7, 250, 8, M.rail);
  spikeRow(f, xa, z + 20, xb, z + 20, 240, 130, 110, 16, 0, 1, 0.45, seed);
  f.set = 'bg';
}

// Słup ogrodzenia: stopa (BG), kolumna z czerwonymi pasami, czapka z kolcem, kolec na zewnątrz, światło
// przeszkodowe (FG). Słup z masztem reflektora — bez kolca na czapce.
function buildPost(f, l, p, k) {
  const M = PB_MAT;
  const PS = l.spec.parking;
  f.box(p.x, -70, p.z, PS.post + 50, 120, 130, M.steel);
  f.set = 'fg';
  f.box(p.x, 140, p.z, PS.post, 400, PS.post, M.dark);
  f.box(p.x, 342, p.z, PS.post + 10, 6, PS.post + 10, M.rail);
  for (const s of [-1, 1]) f.box(p.x + s * (PS.post / 2 + 2), 140, p.z, 4, 380, PS.post * 0.5, M.yellow);
  if (!p.mast) f.cone(p.x, 385, p.z, 20, 80, M.rail);
  f.cone(p.x, 300, p.z + PS.post / 2 + 40, 15, 90, M.rail, [0, 0.35, 1]);
  f.fx(1.6, PB_FX.blink, pbHash1(k * 1.7), 0.5);
  f.box(p.x - 24, 350, p.z - 24, 14, 10, 14, M.red);
  f.nofx();
  f.set = 'bg';
}

// Brama stanowiska w ogrodzeniu (FG): dwa cienkie skrzydła z czerwono-czarną krawędzią, usztywnienia
// i kolce od zewnątrz, zamek z czerwonym światłem; szyna na cokole (BG).
function buildBayGate(f, l, g, k) {
  const M = PB_MAT;
  const half = g.w / 2;
  f.set = 'fg';
  for (const s of [-1, 1]) {
    const lw = half - 6;
    const xc = g.x + s * (lw / 2 + 3);
    f.box(xc, 100, g.z, lw, 280, g.d, M.steel);
    const n = Math.max(2, Math.round(lw / 36));
    for (let i = 0; i < n; i++) f.box(xc - lw / 2 + (i + 0.5) * (lw / n), 242, g.z, (lw / n) * 0.92, 3, g.d + 6, i % 2 ? M.black : M.yellow);
    for (let x = xc - lw / 2 + 20; x < xc + lw / 2 - 10; x += 60) f.box(x, 100, g.z + g.d / 2 + 5, 10, 270, 10, M.dark);
    spikeRow(f, xc - lw / 2, g.z + g.d / 2, xc + lw / 2, g.z + g.d / 2, 220, 70, 70, 11, 0, 1, 0.4, k * 3 + s);
  }
  f.box(g.x, 120, g.z, 20, 220, g.d + 16, M.dark);
  f.fx(1.4, PB_FX.blink, pbHash1(k * 3.1), 0.7);
  f.box(g.x, 250, g.z, 16, 10, 16, M.red);
  f.nofx();
  f.set = 'bg';
  f.box(g.x, -8, g.z, g.w + 30, 8, 30, M.rail);
}

// Brama taranowa na końcu toru (FG): dwa cienkie skrzydła (płyta, krawędź w pasy), żebra z kolcami ku
// nadlatującemu („taranuj mnie”), światła ostrzegawcze biegnące po krawędzi, zamek na styku z lampami.
function buildRamGate(f, l, g) {
  const M = PB_MAT;
  const out = g.out;
  const z0 = g.z - g.w / 2;
  const z1 = g.z + g.w / 2;
  f.set = 'fg';
  for (const s of [-1, 1]) {
    const za = s < 0 ? z0 : g.z + 8;
    const zb = s < 0 ? g.z - 8 : z1;
    const lw = zb - za;
    const zc = (za + zb) / 2;
    f.box(g.x, 110, zc, g.d, 340, lw, M.steel);
    f.box(g.x, 282, zc, g.d + 6, 5, lw, M.rail);
    const n = Math.max(4, Math.round(lw / 50));
    for (let i = 0; i < n; i++) f.box(g.x, 286, za + (i + 0.5) * (lw / n), g.d + 10, 3, (lw / n) * 0.9, i % 2 ? M.black : M.yellow);
    for (let z = za + 45; z < zb - 30; z += 105) {
      f.box(g.x + out * (g.d / 2 + 12), 110, z, 24, 330, 20, M.dark);
      f.cone(g.x + out * (g.d / 2 + 52), 230, z, 15, 90, M.rail, [out, 0.25, 0]);
    }
    const m = Math.max(1, Math.floor(lw / 110));
    let k = 0;
    for (let z = za + 55; z < zb - 40; z += 110, k++) {
      f.fx(1.3, PB_FX.chase, k / m, 0.8);
      f.box(g.x - out * (g.d / 2 + 8), 290, z, 12, 6, 26, M.warm);
      f.nofx();
    }
  }
  f.box(g.x, 150, g.z, g.d + 40, 280, 56, M.dark);
  f.box(g.x, 292, g.z, g.d + 44, 4, 60, M.yellow);
  f.fx(1.6, PB_FX.blink, out > 0 ? 0.5 : 0, 0.9);
  for (const dz of [-1, 1]) f.box(g.x, 300, g.z + dz * 40, 16, 10, 16, M.red);
  f.nofx();
  f.set = 'bg';
}

// Pylon ramy końcowej (narożnik parkingu): stopa (BG), kolumna z płyt, czapka z włazem, cztery kolce,
// kogut alarmu i światło przeszkodowe (FG). Maszt reflektora stoi w wewnętrznym narożniku czapki.
function buildPylon(f, l, p, k) {
  const M = PB_MAT;
  const W = l.spec.parking.pylon;
  const out = p.x < 0 ? -1 : 1;
  const inZ = p.corner === 'spine' ? 1 : -1;
  f.box(p.x, -150, p.z, W + 70, 300, W + 70, M.dark);
  f.set = 'fg';
  f.box(p.x, 140, p.z, W, 520, W, M.dark);
  f.box(p.x, 402, p.z, W + 12, 6, W + 12, M.rail);
  for (const s of [-1, 1]) f.box(p.x + s * (W / 2 + 2), 150, p.z, 4, 480, W * 0.45, M.yellow);
  hatch(f, p.x + out * 14, 405, p.z - inZ * 14, 44);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.cone(p.x + dx * (W / 2 + 50), 380, p.z + dz * (W / 2 + 50), 18, 110, M.rail, [dx, 0.3, dz]);
  f.fx(1.7, PB_FX.alarm, pbHash1(k * 4.3), DD_CH.alarm);
  f.box(p.x + out * (W / 2 - 18), 420, p.z - inZ * (W / 2 - 18), 24, 20, 24, M.red);
  f.nofx();
  f.fx(1.6, PB_FX.blink, pbHash1(k * 1.3), 0.5);
  f.box(p.x - out * (W / 2 - 14), 412, p.z - inZ * (W / 2 - 14), 14, 10, 14, M.red);
  f.nofx();
  f.set = 'bg';
}

// Maszt reflektora (FG): słup od podstawy do L.y, obejmy, wysięgnik i głowica z trzema lampami skierowana
// w punkt L.aim, światło przeszkodowe na szczycie. (bx, bz) — miejsce słupa (domyślnie światło).
function buildFloodMast(f, L, baseY, k, bx = L.x, bz = L.z) {
  const M = PB_MAT;
  const top = L.y;
  f.set = 'fg';
  f.cyl(bx, (baseY + top) / 2, bz, 16, top - baseY, M.steel);
  for (const y of [baseY + 40, (baseY + top) / 2]) f.box(bx, y, bz, 44, 10, 44, M.dark);
  const a = Math.atan2(L.aim.z - bz, L.aim.x - bx);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  f.box(bx + ca * 40, top - 6, bz + sa * 40, 80, 14, 26, M.dark, -a);
  const hx = bx + ca * 92;
  const hz = bz + sa * 92;
  f.box(hx, top, hz, 46, 40, 150, M.dark, -a);
  f.fx(1.3, PB_FX.steady);
  for (const o of [-48, 0, 48]) f.box(hx + ca * 26 - sa * o, top - 4, hz + sa * 26 + ca * o, 10, 30, 38, M.white, -a);
  f.nofx();
  f.fx(1.6, PB_FX.blink, pbHash1(k * 2.9 + 0.4), 0.5);
  f.box(bx, top + 26, bz, 16, 12, 16, M.red);
  f.nofx();
  f.set = 'bg';
}

// ---------------------------------------------------------------------------
// Złącza, wieże, dach i wnętrze hali

// Złącze hali z trzonem (jak kołnierz K-7 na podłodze ringu): pylony w narożnikach tylnych, zastrzały,
// pasy, właz na czapce, kolce, koguty alarmu.
function buildCollar(f, l, s) {
  const M = PB_MAT;
  const h = l.hall;
  const zq = l.spec.spineHalfDepth;
  const cx = h.x + s * h.halfWidth;
  const cz = -zq - 150;
  f.box(cx + s * 40, -200, cz + 80, 320, 400, 360, M.dark);
  f.box(cx + s * 40, 330, cz, 300, 660, 380, M.steel);
  f.box(cx + s * 40, 668, cz, 316, 16, 396, M.rail);
  for (let y = 120; y < 640; y += 160) f.box(cx + s * 40, y, cz - 192, 304, 40, 6, (y / 160) % 2 < 1 ? M.yellow : M.black);
  for (const dz of [-120, 120]) f.beam([cx + s * 260, 40, -zq + 120 + dz * 0.5], [cx + s * 150, 560, cz + dz], 40, M.dark);
  hatch(f, cx + s * 40, 677, cz + 40, 95);
  spikeRow(f, cx + s * 200, cz - 190, cx + s * 200, cz + 190, 650, 130, 150, 28, s, 0, 0.35, 60 + s);
  f.box(cx + s * 40, 690, cz - 130, 90, 24, 90, M.dark);
  f.fx(1.7, PB_FX.alarm, s > 0 ? 0.5 : 0, DD_CH.alarm);
  f.box(cx + s * 40, 708, cz - 130, 30, 22, 30, M.red);
  f.nofx();
  f.fx(1.5, PB_FX.blink, s > 0 ? 0.25 : 0.75, 0.5);
  for (const dz of [-1, 1]) f.box(cx + s * 170, 680, cz + dz * 170, 14, 10, 14, M.red);
  f.nofx();
}

// Wieża na końcu trzonu: blok z włazem, kratką i kolcami (BG), maszt z anteną (FG), światła przeszkodowe, kogut.
function buildTower(f, l, s) {
  const M = PB_MAT;
  const tx = s * (l.halfLength - 260);
  f.box(tx, 260, 0, 320, 520, 320, M.steel);
  f.box(tx, 524, 0, 330, 8, 330, M.dark);
  for (const dz of [-1, 1]) f.box(tx + s * 162, 320, dz * 80, 4, 40, 90, M.glass);
  hatch(f, tx - s * 40, 528, -60, 78);
  grille(f, tx - s * 40, 528, 100, 150, 60);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) f.cone(tx + dx * 205, 500, dz * 205, 22, 130, M.rail, [dx, 0.3, dz]);
  f.fx(1.7, PB_FX.alarm, s > 0 ? 0.33 : 0.66, DD_CH.alarm);
  for (const dz of [-1, 1]) f.box(tx + s * 120, 540, dz * 120, 24, 18, 24, M.red);
  f.nofx();
  f.set = 'fg';
  f.cyl(tx + s * 110, 1000, 0, 34, 960, M.steel);
  for (const y of [760, 980, 1200]) {
    f.box(tx + s * 110, y, 0, 230, 10, 14, M.dark);
    f.box(tx + s * 110, y + 20, 0, 14, 10, 200, M.dark);
  }
  f.ring(tx + s * 220, 1280, 0, 120, 0, M.rail, [0, 0, Math.PI / 2]);
  f.cyl(tx + s * 170, 1280, 0, 14, 110, M.steel, [0, 0, Math.PI / 2]);
  f.fx(1.8, PB_FX.blink, s > 0 ? 0.0 : 0.5, 0.5);
  f.box(tx + s * 110, 1490, 0, 26, 20, 26, M.red);
  f.nofx();
  f.set = 'bg';
}

// Dach hali (zestaw dachu — zanika jak K-7) w trzech pasach-kawałkach: płyty z łatami rdzy, belki
// z czerwonymi końcami, okrągłe włazy w ośmiokątnych ramach, czerwone pasy na barkach, wiązki rur, kratki,
// kolce na obrzeżu, znaczniki osi, koguty alarmu.
function buildRoof(f, l, chunkOf) {
  const M = PB_MAT;
  const h = l.hall;
  const base = 711;
  const top = base + 82;
  f.set = 'roof';
  const strip = 260;
  let k = 0;
  for (let z = h.backZ; z > h.frontZ + 1; z -= strip, k++) {
    const z1 = z;
    const z0 = Math.max(h.frontZ, z - strip);
    const zm = (z0 + z1) / 2;
    const hw = Math.min(h.halfWidthAt(z0 + 1), h.halfWidthAt(z1 - 1)) - 20;
    f.group = chunkOf(zm);
    f.box(h.x, base + 41, zm, 2 * hw, 82, z1 - z0 + 2, M.dark);
    const r = pbHash1(k * 5.3 + 0.7);
    if (r < 0.55) f.box(h.x + (r - 0.27) * hw * 2.6, top + 1, zm, 260 + 420 * r, 2, z1 - z0 - 50, r < 0.27 ? M.orange : M.teal);
  }
  const beams = [];
  for (let z = h.backZ - 220; z > h.frontZ + 140; z -= 520) {
    beams.push(z);
    f.group = chunkOf(z);
    const half = h.halfWidthAt(z) - 55;
    f.box(h.x, 819, z, half * 2, 62, 43, M.rail);
    for (const side of [-1, 1]) f.box(h.x + side * (half - 30), 848, z, 82, 19, 66, M.yellow);
  }
  // między belkami: włazy (bok), pasy na barkach (tył), wiązki rur (środek), kratki (przód)
  const mids = [];
  for (let i = 0; i + 1 < beams.length; i++) mids.push((beams[i] + beams[i + 1]) / 2);
  mids.forEach((z, i) => {
    f.group = chunkOf(z);
    const half = h.halfWidthAt(z) - 55;
    if (i % 2 === 0) for (const s of [-1, 1]) hatch(f, h.x + s * Math.min(1220, half - 300), top + 1, z, 190);
    if (i === 1) for (const s of [-1, 1]) diagBands(f, h.x + s * 600, top + 2, z, 440, s * 0.55, 120, 70, 2);
    if (i === 3) for (const s of [-1, 1]) pipeBundle(f, h.x + s * 700, top + 1, z, 900, 200);
    if (i === 5) for (const s of [-1, 1]) grille(f, h.x + s * 900, top + 2, z, 260, 180);
  });
  // kolce na obrzeżu dachu (bez tyłu — lico trzonu)
  for (const e of h.edges) {
    if (e.i === h.backEdge) continue;
    const n = Math.max(1, Math.round(e.length / 250));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = e.a[0] + (e.b[0] - e.a[0]) * t;
      const z = e.a[1] + (e.b[1] - e.a[1]) * t;
      f.group = chunkOf(z);
      const kk = 0.75 + 0.5 * pbHash1(e.i * 31 + i * 1.7);
      const len = 190 * kk;
      f.cone(x + e.nx * len * 0.4, 790, z + e.nz * len * 0.4, 30 * kk, len, M.rail, [e.nx, 0.3, e.nz]);
    }
  }
  f.fx(0.9, PB_FX.steady);
  for (let z = h.backZ - 400; z > h.bodyEndZ; z -= 480) {
    f.group = chunkOf(z);
    f.box(h.x, 840, z, 16, 9, 125, M.cyan);
  }
  f.nofx();
  f.group = chunkOf(h.frontZ + 200);
  f.fx(1.7, PB_FX.alarm, 0.15, DD_CH.alarm);
  for (const s of [-1, 1]) f.box(h.x + s * (h.frontHalfWidth - 120), 870, h.frontZ + 120, 30, 22, 30, M.red);
  f.nofx();
  f.group = 0;
  f.set = 'bg';
}

// Wnętrze hali (grupa 0 — podłoże): pola eskorty, pochylnie, pas wylotu do G-01, napis, łup piratów
// przy ścianach (kontenery), zbiorniki, sterownia przy ścianie tylnej.
function buildHallInterior(f, labels, l, LC) {
  const M = PB_MAT;
  const h = l.hall;
  for (const p of h.pads) {
    const hb = p.padBeam / 2;
    const hl = p.padLength / 2;
    f.box(p.x, 1, p.z, p.padBeam, 2, p.padLength, M.deckPad);
    for (const s of [-1, 1]) pbStripe(f, p.x + s * hb, p.z, 6, p.padLength, M.paint, 2.5);
    pbStripe(f, p.x, p.z - hl, p.padBeam, 6, M.paint, 2.5);
    pbStripe(f, p.x, p.z + hl, p.padBeam, 6, M.paint, 2.5);
    for (let z = p.z + hl - 80; z > p.z - hl + 60; z -= 140) pbStripe(f, p.x, z, 6, 56, M.paintCold, 2.5);
    pbArrow(f, p.x, p.z - hl - 110, 120, M.paintCold, -1);
    const side = p.x >= h.x ? 1 : -1;
    const tx = p.x + side * (hb + 70);
    f.box(tx, 94, p.z + hl * 0.4, 30, 188, 60, M.pale);
    f.box(tx, 192, p.z + hl * 0.4, 70, 8, 70, M.yellow);
    f.cyl(tx - side * 28, 175, p.z + hl * 0.4, 16, 30, M.hose, [Math.PI / 2, 0, 0]);
    f.fx(1.0, PB_FX.steady);
    f.box(tx, 60, p.z + hl * 0.4 - 36, 10, 10, 6, M.green);
    f.nofx();
    pbLabel(labels, p.id, p.x, p.z + hl + 70, 220, 64, LC.berth, '', 0);
  }
  // pochylnie: łoże, bloki stępki pod kadłubem w budowie (y 110 — portHullBuild3D), rusztowania, lampy
  for (const s of h.slips) {
    const hb = s.padBeam / 2;
    const hl = s.padLength / 2;
    f.box(s.x, 1, s.z, s.padBeam + 120, 2, s.padLength + 140, M.deckPad);
    for (const side of [-1, 1]) {
      pbStripe(f, s.x + side * (hb + 50), s.z, 10, s.padLength + 100, M.yellow, 2.5);
      for (let z = s.z - hl; z < s.z + hl; z += 120) pbStripe(f, s.x + side * (hb + 70), z, 20, 8, M.black, 3);
    }
    for (let z = s.z - hl + 50; z < s.z + hl - 30; z += 90) {
      f.box(s.x, 50, z, 46, 100, 26, M.dark);
      f.box(s.x, 101.5, z, 40, 3, 22, M.orange);
    }
    for (const side of [-1, 1]) {
      for (const z of [s.z - hl * 0.55, s.z + hl * 0.55]) {
        f.box(s.x + side * (hb - 40), 30, z, 30, 60, 30, M.dark);
        f.box(s.x + side * (hb - 40), 61, z, 34, 3, 34, M.orange);
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tx = s.x + sx * (hb + 40);
        const tz = s.z + sz * (hl + 40);
        for (const [ox, oz] of [[-24, -24], [24, -24], [24, 24], [-24, 24]]) f.cyl(tx + ox, 160, tz + oz, 5, 320, M.rail);
        for (let y = 60; y < 330; y += 90) f.box(tx, y, tz, 54, 4, 54, M.steel);
        f.fx(1.0, PB_FX.steady);
        f.box(tx - sx * 20, 316, tz, 20, 8, 14, M.warm);
        f.nofx();
      }
    }
    pbLabel(labels, `P-${s.index + 1}`, s.x, s.z - hl - 120, 300, 100, LC.berthLead, 'POCHYLNIA', 0);
  }
  // pas wylotu do G-01: linie, strzałki, światła biegnące ku bramie (kanał wylotu)
  const lane0 = h.backZ - 1500;
  const lane1 = h.frontZ - 20;
  for (const s of [-1, 1]) {
    for (let z = lane0; z > lane1; z -= 155) pbStripe(f, h.x + s * 420, z, 8, 74, M.paintCold);
    let k = 0;
    const n = Math.floor((lane0 - lane1) / 260);
    for (let z = lane0; z > lane1; z -= 260) {
      f.fx(1.2, PB_FX.launch, 1 - k++ / Math.max(1, n), DD_CH.launch(0));
      f.box(h.x + s * 470, 8, z, 22, 6, 60, M.warm);
      f.nofx();
    }
  }
  for (let z = lane0 - 300; z > lane1 + 200; z -= 670) {
    if (Math.abs(z - (h.backZ - 2850)) < 420) continue;
    pbArrow(f, h.x, z, 150, M.paintCold, -1);
  }
  pbLabel(labels, 'IRON SKULL', h.x, h.backZ - 2850, 820, 186, LC.capital, `SUCHY DOK / ${l.berths.length} STANOWISK`, 0);
  // łup przy ścianach: stosy kontenerów (rdza / brąz / żelazo / miedź)
  const crateMats = [M.orange, M.teal, M.steel, M.copper];
  for (const s of [-1, 1]) {
    const x = h.x + s * (h.halfWidth - 230);
    let k = 0;
    for (let z = h.backZ - 300; z > h.bodyEndZ + 300; z -= 230) {
      if (Math.abs(z - (h.backZ - 950)) < 560) continue;
      const hgt = 40 + Math.floor(pbHash1(k * 3.3 + s) * 3) * 40;
      f.box(x, hgt / 2, z, 150, hgt, 190, crateMats[(k + (s > 0 ? 1 : 0)) % crateMats.length]);
      f.box(x, hgt + 1, z, 152, 2, 192, M.dark);
      k++;
    }
  }
  // zbiorniki paliwa przy ścianie tylnej i sterownia z oknem
  for (const s of [-1, 1]) {
    for (const dx of [520, 760]) {
      f.cyl(h.x + s * dx, 90, h.backZ - 140, 90, 180, s > 0 ? M.pale : M.steel);
      f.ring(h.x + s * dx, 182, h.backZ - 140, 92, 0, M.yellow, [Math.PI / 2, 0, 0]);
    }
  }
  f.box(h.x, 260, h.backZ - 120, 360, 120, 150, M.dark);
  f.box(h.x, 270, h.backZ - 197, 300, 60, 4, M.glass);
  f.fx(1.0, PB_FX.steady);
  for (const dx of [-110, 110]) f.box(h.x + dx, 330, h.backZ - 199, 30, 8, 6, M.warm);
  f.nofx();
}

// Fartuchy przed bramami hali (płyty) ze światłami biegnącymi wylotu i oznakowaniem.
function buildAprons(f, plates, labels, l, LC) {
  const M = PB_MAT;
  const h = l.hall;
  h.gates.forEach((g, gi) => {
    const half = g.clearWidth / 2;
    const depth = g.main ? l.spec.hall.apronDepth : l.spec.hall.sideApron;
    const quad = [[-half, -30], [half, -30], [half, depth], [-half, depth]].map(([u, v]) => [g.x + g.ux * u + g.nx * v, g.z + g.uz * u + g.nz * v]);
    pbPlate(plates, quad, -59, 57, M.floor);
    for (const side of [-1, 1]) {
      const u = side * (half - 25);
      let k = 0;
      const n = Math.floor(depth / 155);
      for (let d = 80; d < depth; d += 155) {
        f.fx(1.3, PB_FX.launch, k++ / Math.max(1, n), DD_CH.launch(gi));
        f.box(g.x + g.ux * u + g.nx * d, 2, g.z + g.uz * u + g.nz * d, 38, 6, 64, M.warm, -g.angle + Math.PI / 2);
        f.nofx();
      }
    }
    const mx = g.x + g.nx * depth * 0.55;
    const mz = g.z + g.nz * depth * 0.55;
    pbLabel(labels, g.main ? 'WYLOT' : g.id, mx, mz, g.main ? 820 : 520, g.main ? 150 : 110, g.main ? LC.capital : LC.logistics, g.main ? 'G-01 / TRZYMAĆ PAS' : '', -g.angle);
  });
}

// ---------------------------------------------------------------------------

/**
 * Scena suchego doku: { sets, plates, labels, lamps, groups (opisy kawałków), rig, instances }.
 * rig.lights — maszty reflektorów i światła hali (layout.lights) dla świateł gry.
 */
export function buildPirateDryDockScene(l, style) {
  const f = new PortRecorder();
  const plates = [];
  const labels = [];
  const lamps = [];
  const LC = style.labels;
  const M = PB_MAT;
  const P = l.parking;
  const PS = l.spec.parking;
  const G = (id) => l.chunkById.get(id).group;
  if (l.chunks.length + 1 > PB_MAX_GROUPS) throw new Error(`suchy dok: ${l.chunks.length} kawałków > ${PB_MAX_GROUPS - 1}`);

  // ---- trzon: odcinki (kawałki) z nabrzeżem, rękawami i lampkami stanowisk
  l.spine.segments.forEach((seg, si) => {
    f.group = G(seg.id);
    buildSpineSegment(f, l, seg, si);
  });
  // ---- parking: pokład, stanowiska, kołyski, napisy (podłoże)
  f.group = 0;
  buildParkingDeck(f, plates, labels, l, LC);
  // ---- ogrodzenie: przęsła stref wjazdu / wyjazdu (ściana), cokół pod bramami stanowisk, słupy
  const posts = P.posts;
  const fz = P.z1;
  const xW = P.x0 + PS.pylon / 2;
  const xE = P.x1 - PS.pylon / 2;
  const first = posts[0].x - PS.post / 2;
  const last = posts[posts.length - 1].x + PS.post / 2;
  f.group = G('P-1');
  buildFencePlinth(f, xW, first, fz);
  buildFenceWall(f, xW, first, fz, 1);
  f.group = G('P-3');
  buildFencePlinth(f, last, xE, fz);
  buildFenceWall(f, last, xE, fz, 2);
  for (let i = 0; i + 1 < posts.length; i++) {
    f.group = G(posts[i].chunk);
    buildFencePlinth(f, posts[i].x + PS.post / 2, posts[i + 1].x - PS.post / 2, fz);
  }
  posts.forEach((p, k) => {
    f.group = G(p.chunk);
    buildPost(f, l, p, k);
  });
  // ---- bramy: stanowisk w ogrodzeniu i taranowe na końcach toru (cienkie — do taranowania)
  for (const g of P.gates) {
    f.group = G(g.chunk);
    if (g.kind === 'ram') buildRamGate(f, l, g);
    else buildBayGate(f, l, g, l.berths.findIndex((b) => b.id === g.berth));
  }
  // ---- pylony ram końcowych
  P.pylons.forEach((p, k) => {
    f.group = G(p.chunk);
    buildPylon(f, l, p, k);
  });
  // ---- maszty reflektorów (pylony, słupy z masztem) i lampy budowli (reflektory, światła pochylni)
  l.lights.forEach((L, k) => {
    if (L.kind === 'flood') {
      f.group = G(L.chunk);
      const py = P.pylons.find((p) => p.x === L.x && p.z === L.z);
      if (py) {
        const out = py.x < 0 ? -1 : 1;
        const inZ = py.corner === 'spine' ? 1 : -1;
        buildFloodMast(f, L, 405, k, py.x - out * 48, py.z + inZ * 48);
      } else buildFloodMast(f, L, 345, k);
    }
    if (lamps.length < PB_MAX_LAMPS) lamps.push([L.x, k7HeightToZ(L.kind === 'flood' ? L.y - 140 : L.y), L.z, 1]);
  });
  // ---- wieże i złącza hali z trzonem
  f.group = G('T-W');
  buildTower(f, l, -1);
  f.group = G('T-E');
  buildTower(f, l, 1);
  f.group = G('K-W');
  buildCollar(f, l, -1);
  f.group = G('K-E');
  buildCollar(f, l, 1);

  // ---- hala: ściany (kawałki), bramy, dach, wnętrze, fartuchy
  const h = l.hall;
  const E = h.edges;
  const gateOn = (edge) => h.gates.find((g) => g.edge === edge);
  const wallParts = [
    ['H-W1', E[4], 0, E[4].length / 2],
    ['H-W2', E[4], E[4].length / 2, E[4].length],
    ['H-E2', E[2], 0, E[2].length / 2],
    ['H-E1', E[2], E[2].length / 2, E[2].length]
  ];
  wallParts.forEach(([id, e, s0, s1], i) => {
    f.group = G(id);
    wallSpan(f, e, s0, s1, { seed: i + 1 });
  });
  for (const [id, edge] of [['H-G1', 0], ['H-SE', 1], ['H-SW', 5]]) {
    const e = E[edge];
    const g = gateOn(edge);
    f.group = G(id);
    wallSpan(f, e, 0, g.jamb, { buttress: false, seed: edge + 11, spikes: false });
    wallSpan(f, e, e.length - g.jamb, e.length, { buttress: false, seed: edge + 17, spikes: false });
    gateFrame(f, labels, e, g, h.gates.indexOf(g), LC);
  }
  const roofChunk = (z) => {
    const t = (h.backZ - z) / (h.backZ - h.frontZ);
    return G(t < 1 / 3 ? 'R-1' : t < 2 / 3 ? 'R-2' : 'R-3');
  };
  buildRoof(f, l, roofChunk);
  f.group = 0;
  pbPlate(plates, h.footprint, -116, 116, M.floor);
  pbPlate(plates, h.footprint, -170, 54, M.dark);
  buildHallInterior(f, labels, l, LC);
  buildAprons(f, plates, labels, l, LC);

  return {
    sets: f.sets, plates, labels, lamps,
    groups: l.chunks.map((c) => ({ kind: 'chunk', id: c.id, chunkKind: c.kind })),
    rig: { lights: l.lights },
    instances: f.count()
  };
}
