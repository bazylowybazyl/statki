// Baza piratów (misja 1, szkic użytkownika z 2026-10-11) jako DANE instancji — bez Three (testy node czytają je wprost).
// Ten sam rejestrator i shader co budowle portowe Z7 i dawny suchy dok (portBuildingScene.js / portBuildings3D.js):
// zestawy BG (pod statkami) i FG (maszty, część techniczna habitatu — nad statkami), kanały efektów, lampy.
//
// Wygląd jak sprite'y piratów „Iron Skull” (PIRATE_PORT_STYLE): ciemne żelazo z rdzą, czerwone pasy, kolce, włazy
// w ośmiokątnych ramach, kratki, wiązki rur — BEZ czaszek (decyzja użytkownika 2026-10-05). Bez napisów i płyt
// podłoża: każda bryła należy do kawałka, który może się rozpaść (napis zostałby w próżni).
//
// KAWAŁKI = GRUPY RENDERU (layout.chunks): każda bryła kawałka jest nagrana w grupie `chunk.group` (macierz grupy
// przesuwa / chowa kawałek, ciało świata rysuje skóra — jak w suchym doku). Wysokości jak w K-7 (y nad pokładem;
// płaszczyzna gry y = 116 = z świata 0; nad nią ×0,42), materiały = kody K7_MAT, emisja w paśmie HDR 0,9–1,8.
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { PB_FX, PB_MAT, PB_MAX_GROUPS, PB_MAX_LAMPS, PortRecorder, pbHash1 } from './portBuildingScene.js';

// Kanały efektów (uChan, 16 liczb) — ustawia PirateBase3D.update ze stanu klatki.
export const PBASE_CH = Object.freeze({
  alarm: 0,                       // alarm bazy (koguty)
  busy: (k) => 1 + k,             // maski bitowe stanowisk z okrętem (24 bity na kanał, k = 0..1) — lampki zielone
  free: (k) => 3 + k,             // maski stanowisk pustych (okręt odleciał / zniszczony) — lampki czerwone
  habitat: 5,                     // zasilanie bębna i części technicznej (okna) 0..1
  disc: 6,                        // zasilanie dysku mieszkalnego (okna gasną od środka) 0..1
  bays: 7,                        // hangary dronów: start (światła biegnące) 0/1
  fuel: 8,                        // zasilanie zbiorników i kolektora 0..1
  warehouse: 9,                   // zasilanie magazynu 0..1
  // światła wnętrza modułów ciśnieniowych (2026-10-19, dekompresja — src/game/story/pirateBaseAtmosphere.js: moduł, który
  // stracił powietrze, miga i gaśnie): okna głowy wieży i przedziały ćwiartek bębna (k = indeks ćwiartki w układzie)
  tech: 10,
  drumQ: (k) => 11 + k
});
export const PBASE_BERTH_BITS = 24;

const TAU = Math.PI * 2;
const M = PB_MAT;

// ---------------------------------------------------------------------------
// Detale piratów

// Rząd kolców wzdłuż odcinka (ax, az) → (bx, bz) na wysokości y: szpic na zewnątrz (ox, oz) i w górę (tilt).
function spikeRow(f, ax, az, bx, bz, y, step, len, r, ox, oz, tilt = 0.35, seed = 0) {
  const L = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(L / step));
  const dl = Math.hypot(ox, tilt, oz) || 1;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const k = 0.75 + 0.5 * pbHash1(seed * 17.3 + i * 3.1);
    const h = len * k;
    f.cone(ax + (bx - ax) * t + (ox / dl) * h * 0.42, y, az + (bz - az) * t + (oz / dl) * h * 0.42, r * (0.8 + 0.3 * k), h, M.rail, [ox, tilt, oz]);
  }
}

// Okrągły właz w ośmiokątnej ramie na powierzchni o wierzchu y.
function hatch(f, x, y, z, r) {
  f.cone(x, y + 3, z, r * 1.22, 6, M.dark);
  f.cyl(x, y + 6, z, r, 4, M.rail);
  f.cyl(x, y + 8, z, r * 0.84, 4, M.steel);
  f.ring(x, y + 10, z, r * 0.92, 0, M.black, [Math.PI / 2, 0, 0]);
  f.box(x, y + 10.5, z, r * 0.95, 2, r * 0.12, M.dark);
}

// Kratka wentylacyjna z prętami: ciemna wnęka i pręty w poprzek osi `rot`.
function grille(f, x, y, z, w, d, rot = 0) {
  f.box(x, y, z, w, 4, d, M.black, rot);
  const n = Math.max(3, Math.round(w / 22));
  const c = Math.cos(rot);
  const s = -Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + (i + 0.5) * (w / n);
    f.box(x + c * u, y + 2, z + s * u, Math.max(4, (w / n) * 0.42), 4, d * 0.9, M.rail, rot);
  }
}

// Punkt na okręgu.
const ang = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

// Pierścień z prostopadłościanów: promień r (środek), grubość radialna d, wysokość y ± h/2, kąty a0..a1, segmenty co
// `step` rad (zachodzą na siebie, bez szczelin na zewnętrznej krawędzi).
function ringBoxes(f, r, d, y, h, a0, a1, step, mat, cb = null) {
  const n = Math.max(1, Math.ceil((a1 - a0) / step));
  const da = (a1 - a0) / n;
  const len = 2 * (r + d / 2) * Math.tan(da / 2) * 1.04;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k + 0.5) * da;
    const [x, z] = ang(a, r);
    if (cb && cb(a, k) === false) continue;
    f.box(x, y, z, len, h, d, mat, -(a + Math.PI / 2));
  }
}

// ---------------------------------------------------------------------------
// Habitat

function drumQuadrant(f, l, qd, qi) {
  const H = l.habitat;
  const R = H.drumR;
  const wy = (H.floorY + H.wallTop) / 2;
  const wh = H.wallTop - H.floorY;
  const a0 = qd.a0;
  const a1 = qd.a1;
  const step = TAU / 64;
  const bayIn = (a) => H.bays.some((b) => Math.abs(Math.atan2(Math.sin(a - b.angle), Math.cos(a - b.angle))) < 0.055);
  // ściana zewnętrzna (rura): korpus, cokół, listwa szczytowa w czerwono-czarne pasy, łaty rdzy, kolce na zewnątrz
  ringBoxes(f, R - H.wall / 2, H.wall, wy, wh, a0, a1, step, M.dark);
  ringBoxes(f, R - H.wall / 2, H.wall + 26, H.floorY + 40, 80, a0, a1, step, M.steel);
  ringBoxes(f, R - H.wall / 2, H.wall + 18, H.rimTop - 10, 22, a0, a1, step, M.rail, (a, k) => {
    const [x, z] = ang(a, R - H.wall / 2);
    f.box(x, H.rimTop + 2, z, 40, 3, H.wall + 10, (k + qi) % 2 ? M.black : M.yellow, -(a + Math.PI / 2));
    if (pbHash1(qi * 13 + k * 1.7) < 0.3) f.box(x, H.rimTop + 4, z, 70, 2, H.wall - 20, M.orange, -(a + Math.PI / 2));
  });
  // przypory zewnętrzne co ~22°, kolce na krawędzi
  for (let a = a0 + 0.2; a < a1 - 0.05; a += 0.39) {
    const [x, z] = ang(a, R + 30);
    f.box(x, wy - 60, z, 60, wh - 140, 70, M.steel, -a);
    const [sx, sz] = ang(a, R + 90);
    f.cone(sx, H.rimTop - 30, sz, 22, 150, M.rail, [Math.cos(a), 0.35, Math.sin(a)]);
  }
  for (let a = a0 + 0.1; a < a1; a += 0.2) {
    const [x, z] = ang(a, R + 60);
    f.cone(x, H.rimTop - 10, z, 18, 120, M.rail, [Math.cos(a), 0.4, Math.sin(a)]);
  }
  // grodzie promieniowe (bulkheady) i pierścień wewnętrzny
  for (const s of H.spokes) {
    const w = Math.atan2(Math.sin(s - (a0 + a1) / 2), Math.cos(s - (a0 + a1) / 2));
    if (Math.abs(w) > Math.PI / 4) continue;
    const r0 = H.innerR;
    const r1 = R - H.wall;
    const [x, z] = ang(s, (r0 + r1) / 2);
    f.box(x, wy, z, r1 - r0 + 20, wh - 40, H.spokeW, M.dark, -s);
    f.box(x, H.wallTop - 10, z, r1 - r0, 16, H.spokeW + 14, M.rail, -s);
    // drzwi grodziowe (wnęka) i lampka
    boxAt(f, ang(s, r0 + 110), 30, 80, 180, H.spokeW + 8, M.black, -s);
    f.fx(1.0, PB_FX.fill, 0.2, PBASE_CH.drumQ(qi));
    boxAt(f, ang(s, r1 - 60), H.wallTop + 6, 18, 6, 18, M.warm, -s);
    f.nofx();
  }
  ringBoxes(f, H.innerR - H.innerW / 2, H.innerW, wy, wh, a0, a1, TAU / 48, M.steel);
  ringBoxes(f, H.innerR - H.innerW / 2, H.innerW + 10, H.wallTop - 6, 14, a0, a1, TAU / 48, M.rail);
  // dno przedziałów (pod płaszczyzną gry — widać je przez otwarty bęben): pokłady, łaty, oświetlone pasy, ładunek
  for (const [r, d, mat] of [[640, 160, M.floor], [790, 150, M.steel], [880, 60, M.dark]]) ringBoxes(f, r, d, H.floorY, 18, a0, a1, TAU / 72, mat);
  let k = 0;
  for (let a = a0 + 0.03; a < a1 - 0.02; a += 0.065, k++) {
    const h = pbHash1(qi * 31 + k * 2.3);
    const r = 600 + 270 * h;
    const [x, z] = ang(a, r);
    if (h < 0.35) f.box(x, H.floorY + 40, z, 90, 70, 60 + 50 * h, h < 0.18 ? M.orange : M.teal, -a);
    else if (h < 0.55) { f.box(x, H.floorY + 22, z, 70, 30, 70, M.dark, -a); hatch(f, x, H.floorY + 38, z, 26); }
    // światła przedziałów (zasilanie habitatu)
    f.fx(1.1, PB_FX.fill, 0.15 + 0.3 * h, PBASE_CH.drumQ(qi));
    const [lx, lz] = ang(a + 0.02, 600 + 300 * pbHash1(qi * 7 + k));
    f.box(lx, H.floorY + 12, lz, 60, 4, 10, h < 0.5 ? M.warm : M.cyan, -a);
    f.nofx();
  }
  // hangary dronów w ścianie: rama w pasy, wrota, światła startu (kanał bays)
  for (const b of H.bays) {
    const w = Math.atan2(Math.sin(b.angle - (a0 + a1) / 2), Math.cos(b.angle - (a0 + a1) / 2));
    if (Math.abs(w) > Math.PI / 4) continue;
    const [x, z] = ang(b.angle, R + 8);
    const rot = -(b.angle + Math.PI / 2);
    f.box(x, wy + 20, z, 230, wh - 60, 30, M.yellow, rot);
    f.box(x, wy + 10, z, 190, wh - 110, 36, M.black, rot);
    for (let i = 0; i < 4; i++) {
      const [px, pz] = ang(b.angle, R - 40 - i * 90);
      f.fx(1.4, PB_FX.launch, i / 4, PBASE_CH.bays);
      f.box(px, H.floorY + 30, pz, 20, 8, 70, M.warm, -b.angle);
      f.nofx();
    }
    f.fx(1.6, PB_FX.blink, b.angle, 0.8);
    boxAt(f, ang(b.angle - 0.06, R + 20), H.rimTop + 20, 16, 14, 16, M.red);
    f.nofx();
  }
  // koguty alarmu na krawędzi ćwiartki
  f.fx(1.7, PB_FX.alarm, qi * 0.25, PBASE_CH.alarm);
  boxAt(f, ang((a0 + a1) / 2, R - 40), H.rimTop + 30, 30, 24, 30, M.red);
  f.nofx();
}
// box() z punktem jako [x] … — pomocnik: box na (x, y, z) z punktu ang()
function boxAt(f, p, y, w, h, d, mat, rot = 0) { f.box(p[0], y, p[1], w, h, d, mat, rot); }

function habitatCore(f, l) {
  const H = l.habitat;
  // szyb (przecina płaszczyznę gry; nad bębnem przechodzi w szyję — habitatTech), grodzie wewnętrzne, trzon do dysku
  f.cyl(0, (H.floorY + H.coreTop) / 2, 0, H.coreR, H.coreTop - H.floorY, M.steel);
  for (const y of [H.floorY + 60, 40, 230, 520]) f.ring(0, y, 0, H.coreR + 8, 0, M.rail, [Math.PI / 2, 0, 0]);
  for (const s of H.innerSpokes) {
    const r0 = H.coreR;
    const r1 = H.innerR - H.innerW;
    const [x, z] = ang(s, (r0 + r1) / 2);
    f.box(x, (H.floorY + H.wallTop) / 2, z, r1 - r0 + 20, H.wallTop - H.floorY - 60, 54, M.dark, -s);
    f.box(x, H.wallTop - 20, z, r1 - r0, 14, 66, M.yellow, -s);
  }
  // dno między szybem a pierścieniem: pokład z włazami windy
  ringBoxes(f, (H.coreR + H.innerR - H.innerW) / 2, H.innerR - H.innerW - H.coreR, H.floorY, 18, 0, TAU, TAU / 24, M.floor);
  for (const s of H.innerSpokes) {
    const [hx, hz] = ang(s + 0.5, 380);
    hatch(f, hx, H.floorY + 12, hz, 36);
  }
  // światła windy (bieg wzdłuż szybu — z góry widać pas na obwodzie)
  for (let i = 0; i < 12; i++) {
    f.fx(1.2, PB_FX.chase, i / 12, 0.35);
    boxAt(f, ang((i / 12) * TAU, H.coreR + 12), H.wallTop + 120, 22, 10, 22, M.cyan);
    f.nofx();
  }
  // trzon pod bębnem do dysku mieszkalnego
  f.cyl(0, (H.floorY - 40 + H.tier2Y) / 2, 0, H.stemR, H.floorY - 40 - H.tier2Y, M.dark);
  for (const y of [H.floorY - 120, (H.floorY + H.tier2Y) / 2, H.tier2Y + 60]) f.ring(0, y, 0, H.stemR + 10, 0, M.rail, [Math.PI / 2, 0, 0]);
}

// Część techniczna nad bębnem (FG, duch) = SZYJA i GŁOWA (2026-10-14, prośba użytkownika: „powiększ górę i zrób
// znacznie dłuższą szyję”). Szyja: rura z kratownicą czterech dźwigarów, obręcze, rury, winda (bieg świateł),
// platforma w połowie. Głowa: talerz ze schodkowym spodem do szyi, okna cywilów na obwodzie i świetliki na wierzchu
// (zasilanie habitatu), piasta z kopułą, radiatory, talerze łączności, maszty anten, kolce na obrzeżu.
function habitatTech(f, l) {
  const H = l.habitat;
  f.set = 'fg';
  habitatNeck(f, H);
  habitatHead(f, H);
  f.set = 'bg';
}

function habitatNeck(f, H) {
  const n0 = H.neckY0;
  const n1 = H.neckY1;
  const nl = n1 - n0;
  // nasada na szczycie szybu, rura szyi, kołnierz pod głową
  f.cyl(0, H.coreTop - 20, 0, H.coreR + 24, 70, M.rail);
  f.cyl(0, H.coreTop + 110, 0, H.neckR + 80, 200, M.steel);
  f.cyl(0, (n0 + n1) / 2, 0, H.neckR, nl, M.dark);
  f.cyl(0, n1 - 70, 0, H.neckR + 70, 180, M.steel);
  // obręcze rury w pasy
  let k = 0;
  for (let y = n0 + 520; y < n1 - 260; y += 600, k++) {
    f.cyl(0, y, 0, H.neckR + 12, 50, M.rail);
    f.cyl(0, y + 34, 0, H.neckR + 6, 16, k % 2 ? M.yellow : M.red);
  }
  // kratownica: cztery dźwigary od nasady do kołnierza, obręcze i stężenia zygzakiem w każdym przęśle
  const legR = H.neckR + 80;
  const legs = [0, 1, 2, 3].map((i) => (i / 4) * TAU + Math.PI / 4);
  const t0 = H.coreTop + 160;
  const t1 = n1 - 150;
  for (const a of legs) {
    const [x, z] = ang(a, legR);
    f.cyl(x, (t0 + t1) / 2, z, 24, t1 - t0, M.steel);
  }
  const bays = Math.max(3, Math.round((t1 - t0) / 360));
  const bh = (t1 - t0) / bays;
  for (let i = 0; i <= bays; i++) {
    const y0 = t0 + i * bh;
    f.ring(0, y0, 0, legR, 0, M.rail, [Math.PI / 2, 0, 0]);
    if (i === bays) break;
    for (let s = 0; s < 4; s++) {
      const [ax, az] = ang(legs[s], legR);
      const [bx, bz] = ang(legs[(s + 1) % 4], legR);
      if ((i + s) % 2) f.beam([ax, y0, az], [bx, y0 + bh, bz], 12, M.rail);
      else f.beam([bx, y0, bz], [ax, y0 + bh, az], 12, M.rail);
    }
  }
  // rury (miedź) wzdłuż szyi
  for (const a of [0, Math.PI]) {
    const [x, z] = ang(a, H.neckR + 30);
    f.cyl(x, (t0 + t1) / 2, z, 16, t1 - t0, M.copper);
  }
  // winda: bieg świateł w górę po obu stronach rury
  const lifts = Math.max(6, Math.round(nl / 150));
  for (const side of [Math.PI / 2, -Math.PI / 2]) {
    for (let i = 0; i < lifts; i++) {
      f.fx(1.3, PB_FX.chase, i / lifts, 0.35);
      boxAt(f, ang(side, H.neckR + 6), n0 + 260 + i * ((nl - 420) / lifts), 16, 34, 16, M.cyan, -side);
      f.nofx();
    }
  }
  // platforma w połowie szyi: pokład, kolce, światła przeszkodowe, kogut alarmu
  const py = n0 + nl * 0.45;
  const pr = H.neckR + 240;
  f.cyl(0, py, 0, pr, 60, M.steel);
  f.cyl(0, py - 50, 0, pr * 0.7, 60, M.dark);
  ringBoxes(f, pr - 16, 40, py + 36, 14, 0, TAU, TAU / 24, M.rail, (a, i) => {
    boxAt(f, ang(a, pr - 16), py + 44, 40, 3, 46, i % 2 ? M.black : M.yellow, -(a + Math.PI / 2));
  });
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * TAU;
    const [cx, cz] = ang(a, pr + 40);
    f.cone(cx, py, cz, 18, 130, M.rail, [Math.cos(a), 0.25, Math.sin(a)]);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    f.fx(1.6, PB_FX.blink, i / 4, 0.6);
    boxAt(f, ang(a, pr - 40), py + 56, 20, 16, 20, M.red);
    f.nofx();
  }
  f.fx(1.8, PB_FX.alarm, 0.25, PBASE_CH.alarm);
  boxAt(f, ang(Math.PI / 4, pr - 60), py + 60, 30, 24, 30, M.red);
  f.nofx();
}

function habitatHead(f, H) {
  const y0 = H.ringY0;
  const y1 = H.ringY1;
  const ry = (y0 + y1) / 2;
  const rh = y1 - y0;
  const rr = (H.ringR0 + H.ringR1) / 2;
  const rd = H.ringR1 - H.ringR0;
  const hr = H.headR;
  // spód talerza: schodki od obrzeża do szyi
  const steps = [[H.ringR1 - 30, 90], [H.ringR1 - 170, 90], [H.ringR1 - 330, 90], [hr + 60, 100], [H.neckR + 110, 110]];
  let yb = y0;
  steps.forEach(([r, h], i) => {
    f.cyl(0, yb - h / 2, 0, r, h + 4, i % 2 ? M.steel : M.dark);
    yb -= h;
  });
  // talerz: pierścień, ciemny pas w połowie, listwa szczytowa w pasy
  ringBoxes(f, rr, rd, ry, rh, 0, TAU, TAU / 44, M.steel);
  ringBoxes(f, H.ringR1 - 6, 20, y0 + rh * 0.36, 60, 0, TAU, TAU / 44, M.dark);
  ringBoxes(f, H.ringR1 - 30, 70, y1 + 6, 14, 0, TAU, TAU / 56, M.rail, (a, i) => {
    boxAt(f, ang(a, H.ringR1 - 30), y1 + 14, 60, 3, 76, i % 2 ? M.black : M.yellow, -(a + Math.PI / 2));
  });
  // okna cywilów na obwodzie (cztery rzędy) i świetliki na wierzchu — zasilanie habitatu
  const wins = 64;
  const wlen = 2 * H.ringR1 * Math.tan(Math.PI / wins) * 0.62;
  [0.16, 0.56, 0.72, 0.88].forEach((t, row) => {
    for (let i = 0; i < wins; i++) {
      const h = pbHash1(row * 41.7 + i * 2.9);
      if (h < 0.18) continue;
      const a = ((i + 0.5) / wins) * TAU;
      f.fx(1.2, PB_FX.fill, 0.08 + 0.7 * h, PBASE_CH.tech);
      boxAt(f, ang(a, H.ringR1 + 2), y0 + rh * t, wlen, 34, 10, h < 0.7 ? M.warm : h < 0.9 ? M.white : M.cyan, -(a + Math.PI / 2));
      f.nofx();
    }
  });
  const skyR = H.ringR0 + rd * 0.3;
  for (let i = 0; i < 40; i++) {
    const a = ((i + 0.5) / 40) * TAU;
    f.fx(1.2, PB_FX.fill, 0.1 + 0.6 * pbHash1(i * 4.1), PBASE_CH.tech);
    boxAt(f, ang(a, skyR), y1 + 12, 54, 4, rd * 0.22, i % 3 ? M.warm : M.white, -(a + Math.PI / 2));
    f.nofx();
  }
  // włazy i kratki na wierzchu talerza
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.26;
    const [x, z] = ang(a, H.ringR0 + 40);
    f.box(x, y1 + 6, z, 70, 12, 70, M.dark, -a);
    hatch(f, x, y1 + 12, z, 26);
    const [gx, gz] = ang(a + Math.PI / 6, H.ringR0 + 40);
    grille(f, gx, y1 + 10, gz, 120, 40, -(a + Math.PI / 6 + Math.PI / 2));
  }
  // piasta z oknami, obręcze, szprychy do talerza
  f.cyl(0, (y0 - 80 + H.headTop) / 2, 0, hr, H.headTop - y0 + 80, M.dark);
  for (const y of [y0 + 100, y1 - 30]) f.ring(0, y, 0, hr + 6, 0, M.rail, [Math.PI / 2, 0, 0]);
  ringBoxes(f, hr + 10, 30, H.headTop - 30, 40, 0, TAU, TAU / 32, M.rail);
  for (let i = 0; i < 24; i++) {
    const h = pbHash1(i * 7.3 + 3.1);
    if (h < 0.25) continue;
    const a = ((i + 0.5) / 24) * TAU;
    f.fx(1.1, PB_FX.fill, 0.1 + 0.6 * h, PBASE_CH.tech);
    boxAt(f, ang(a, hr + 2), (y1 + H.headTop) / 2, 2 * hr * Math.tan(Math.PI / 24) * 0.55, 44, 8, h < 0.75 ? M.warm : M.white, -(a + Math.PI / 2));
    f.nofx();
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    boxAt(f, ang(a, (hr + H.ringR0) / 2), ry, H.ringR0 - hr + 40, 90, 90, M.dark, -a);
  }
  // kopuła na piaście
  f.cyl(0, H.headTop + 20, 0, hr * 0.92, 40, M.steel);
  f.cyl(0, H.headTop + 70, 0, hr * 0.7, 60, M.glass);
  f.cyl(0, H.headTop + 115, 0, hr * 0.42, 40, M.glass);
  // radiatory (miedź): cztery baterie żeber na wierzchu talerza
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * TAU + Math.PI / 4;
    const [cx, cz] = ang(a, H.ringR1 - 140);
    const tx = -Math.sin(a);
    const tz = Math.cos(a);
    for (let i = -2; i <= 2; i++) f.box(cx + tx * i * 48, y1 + 120, cz + tz * i * 48, 12, 220, 220, M.copper, -(a + Math.PI / 2));
  }
  // talerze łączności (pochylone na zewnątrz)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    const [x, z] = ang(a, H.ringR1 - 170);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    f.cyl(x, y1 + 110, z, 20, 200, M.steel);
    f.cone(x + dx * 40, y1 + 260, z + dz * 40, 200, 90, M.pale, [dx, 1.2, dz]);
    f.ring(x + dx * 46, y1 + 268, z + dz * 46, 196, 0, M.rail, [Math.PI / 2 - 0.6, -a, 0]);
  }
  // maszty anten z poprzeczkami i światłami przeszkodowymi
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.35;
    const [x, z] = ang(a, hr * 0.82);
    const base = H.headTop + 40;
    const top = H.mastTop - i * 260;
    f.cyl(x, (base + top) / 2, z, 14, top - base, M.rail);
    for (let y = base + 220; y < top - 120; y += 300) f.box(x, y, z, 110, 6, 8, M.dark, -a);
    f.fx(1.8, PB_FX.blink, i * 0.25, 0.5);
    f.box(x, top + 14, z, 20, 16, 20, M.red);
    f.nofx();
  }
  // kolce na obrzeżu i światła przeszkodowe pod talerzem
  for (let a = 0.08; a < TAU; a += 0.15) {
    const [x, z] = ang(a, H.ringR1 + 50);
    f.cone(x, y1 - 30, z, 20, 140, M.rail, [Math.cos(a), 0.3, Math.sin(a)]);
  }
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * TAU;
    f.fx(1.6, PB_FX.blink, i / 8, 0.5);
    boxAt(f, ang(a, H.ringR1 + 8), y0 + 20, 22, 16, 22, M.red);
    f.nofx();
  }
  // kogut alarmu na szczycie kopuły
  f.fx(1.8, PB_FX.alarm, 0.5, PBASE_CH.alarm);
  f.box(0, H.headTop + 160, 0, 50, 36, 50, M.red);
  f.nofx();
}

// Sektor dysku mieszkalnego (pod płaszczyzną gry, duch): płyta z pierścieni brył, tarasy, świetliki (okna gasną od
// środka przy implozji — kanał dysku, faza z promienia), aleje promieniowe, kopuły, kolce i światła na obrzeżu.
function discSector(f, l, k, n) {
  const H = l.habitat;
  const a0 = ((k - 0.5) / n) * TAU;
  const a1 = ((k + 0.5) / n) * TAU;
  const yc = (H.discY0 + H.discY1) / 2;
  const hh = H.discY1 - H.discY0;
  const seed = k * 11.3;
  // płyta główna: pierścienie co 300 j. (od trzonu do obrzeża)
  for (let r = H.stemR + 150; r < H.discR; r += 300) {
    const d = Math.min(300, H.discR - r + 150);
    ringBoxes(f, r, d, yc, hh, a0, a1, Math.min(TAU / n, 480 / r), (Math.round(r / 300) % 2) ? M.dark : M.steel);
  }
  // tarasy (wyższe pierścienie bliżej środka)
  for (let r = H.stemR + 150; r < H.tier1R; r += 300) {
    const top = r < H.tier2R ? H.tier2Y : H.tier1Y;
    ringBoxes(f, r, 300, (H.discY1 + top) / 2, top - H.discY1, a0, a1, Math.min(TAU / n, 480 / r), M.steel);
  }
  // świetliki i okna dzielnic: pas na każdym pierścieniu (z przerwami), faza zasilania rośnie ku środkowi
  for (let r = H.stemR + 300; r < H.discR - 80; r += 300) {
    const top = r < H.tier2R ? H.tier2Y : r < H.tier1R ? H.tier1Y : H.discY1;
    const frac = r / H.discR;
    const segs = Math.max(2, Math.round(((a1 - a0) * r) / 260));
    for (let i = 0; i < segs; i++) {
      const h = pbHash1(seed + r * 0.013 + i * 1.9);
      if (h < 0.4) continue;
      const a = a0 + ((i + 0.5) / segs) * (a1 - a0);
      f.fx(0.7 + 0.3 * h, PB_FX.fill, 0.08 + 0.85 * (1 - frac) * (0.85 + 0.15 * h), PBASE_CH.disc);
      boxAt(f, ang(a, r + (h - 0.5) * 120), top + 4, 150 + 90 * h, 4, 26, h < 0.6 ? M.warm : h < 0.85 ? M.cyan : M.white, -(a + Math.PI / 2));
      f.nofx();
    }
  }
  // aleje promieniowe z lampami
  for (const t of [0.3, 0.72]) {
    const a = a0 + (a1 - a0) * t;
    const r0 = H.stemR + 200;
    const r1 = H.discR - 120;
    const [x, z] = ang(a, (r0 + r1) / 2);
    f.box(x, H.discY1 + 14, z, r1 - r0, 22, 70, M.black, -a);
    let i = 0;
    for (let r = r0 + 100; r < r1; r += 230, i++) {
      f.fx(1.0, PB_FX.fill, 0.08 + 0.85 * (1 - r / H.discR), PBASE_CH.disc);
      boxAt(f, ang(a, r), H.discY1 + 30, 26, 6, 26, M.cyan, -a);
      f.nofx();
    }
  }
  // kopuły (ogrody / hale) na płycie zewnętrznej — między tarasem a obrzeżem
  const band = H.discR - H.tier1R;
  for (let i = 0; i < 2; i++) {
    const h = pbHash1(seed * 3 + i * 7.7);
    const a = a0 + (a1 - a0) * (0.25 + 0.5 * h);
    const rd = Math.min(160 + 90 * h, band * 0.36);
    const r = H.tier1R + band / 2 + (pbHash1(seed + i) - 0.5) * Math.max(0, band - 2 * rd - 160);
    const [x, z] = ang(a, r);
    f.cyl(x, H.discY1 + 30, z, rd, 60, M.dark);
    f.cyl(x, H.discY1 + 70, z, rd * 0.86, 30, M.glass);
    f.fx(0.9, PB_FX.fill, 0.2, PBASE_CH.disc);
    f.cyl(x, H.discY1 + 88, z, rd * 0.3, 8, M.green);
    f.nofx();
  }
  // obrzeże: listwa w pasy, kolce na zewnątrz, światła przeszkodowe
  ringBoxes(f, H.discR - 40, 90, H.discY1 + 10, 40, a0, a1, Math.min(TAU / n, 380 / H.discR), M.rail, (a, i) => {
    boxAt(f, ang(a, H.discR - 40), H.discY1 + 32, 70, 3, 96, i % 2 ? M.black : M.yellow, -(a + Math.PI / 2));
  });
  for (let a = a0 + 0.05; a < a1; a += 0.11) {
    const [cx, cz] = ang(a, H.discR + 70);
    f.cone(cx, H.discY1 - 40, cz, 30, 200, M.rail, [Math.cos(a), 0.15, Math.sin(a)]);
  }
  f.fx(1.5, PB_FX.blink, k / n, 0.4);
  boxAt(f, ang((a0 + a1) / 2, H.discR - 30), H.discY1 + 50, 24, 16, 24, M.red);
  f.nofx();
}

// ---------------------------------------------------------------------------
// Pomosty

// Odcinek pomostu s0..s1: pokład (przecina płaszczyznę gry), krawężniki, żebra, kolce, światła, kratownica pod spodem,
// rura paliwowa z obejmami po stronie `pipe`.
function pierSpan(f, l, p, s0, s1, seed) {
  const P = l.spec.pier;
  const len = s1 - s0;
  const cx = p.ax + p.ux * (s0 + s1) / 2;
  const cz = p.az + p.uz * (s0 + s1) / 2;
  const rot = -p.angle;
  const hw = p.halfW;
  const at = (s, o) => [p.ax + p.ux * s + p.nx * o, p.az + p.uz * s + p.nz * o];
  f.box(cx, (P.deckY0 + P.deckY1) / 2, cz, len, P.deckY1 - P.deckY0, 2 * hw, M.dark, rot);
  f.box(cx, P.deckY1 + 3, cz, len - 6, 6, 2 * hw - 30, M.floor, rot);
  for (const o of [-1, 1]) {
    boxAt(f, at((s0 + s1) / 2, o * (hw - 9)), P.deckY1 + 12, len, 22, 18, M.rail, rot);
    // kolce nad płaszczyzną gry (nie wchodzą w ciało pomostu — tor taranu wzdłuż rzędu zostaje wolny)
    spikeRow(f, ...at(s0, o * (hw - 4)), ...at(s1, o * (hw - 4)), P.deckY1 + 60, 280, 110, 16, p.nx * o, p.nz * o, 0.45, seed * 2 + (o > 0 ? 1 : 0));
  }
  let k = 0;
  for (let s = s0 + 90; s < s1 - 40; s += 180, k++) {
    boxAt(f, at(s, 0), P.deckY1 + 9, 18, 6, 2 * hw - 24, M.dark, rot);
    const h = pbHash1(seed * 7.1 + k * 1.3);
    if (h < 0.2) boxAt(f, at(s + 90, (h - 0.1) * 300), P.deckY1 + 7, 110, 2, 60, M.orange, rot);
    if (k % 3 === 1) {
      f.fx(1.0, PB_FX.steady);
      for (const o of [-1, 1]) boxAt(f, at(s, o * (hw - 26)), P.deckY1 + 14, 12, 4, 12, M.cyan, rot);
      f.nofx();
    }
    if (k % 5 === 2) for (const o of [-1, 1]) boxAt(f, at(s + 40, o * hw * 0.45), P.deckY1 + 8, 70, 3, 14, (k + (o > 0 ? 1 : 0)) % 2 ? M.yellow : M.black, rot + 0.5);
  }
  // kratownica pod pokładem: dolny pas i zastrzały
  boxAt(f, at((s0 + s1) / 2, 0), -250, len, 30, 60, M.steel, rot);
  for (let s = s0 + 60; s < s1 - 60; s += 240) {
    const [x0, z0] = at(s, 0);
    const [x1, z1] = at(s + 120, 0);
    f.beam([x0, P.deckY0 + 10, z0], [x1, -238, z1], 20, M.dark);
    const [x2, z2] = at(Math.min(s1 - 10, s + 240), 0);
    f.beam([x1, -238, z1], [x2, P.deckY0 + 10, z2], 20, M.dark);
  }
  // rura paliwowa i powrotna na wspornikach z boku pomostu (pod płaszczyzną gry, widoczna obok pokładu)
  const po = p.pipe * P.pipeOff;
  const pr = [0, -p.angle, Math.PI / 2];
  const [px, pz] = at((s0 + s1) / 2, po);
  f.cyl(px, P.pipeY, pz, P.pipeR, len, M.copper, pr);
  const [qx, qz] = at((s0 + s1) / 2, po + p.pipe * 50);
  f.cyl(qx, P.pipeY - 16, qz, P.pipeR * 0.55, len, M.hose, pr);
  for (let s = s0 + 70; s < s1 - 20; s += 200) {
    boxAt(f, at(s, po * 0.82), P.pipeY + 6, 24, 40, Math.abs(po) * 0.5 + 60, M.dark, rot);
    const [rx, rz] = at(s, po);
    f.ring(rx, P.pipeY, rz, P.pipeR + 6, 0, M.rail, [0, -p.angle + Math.PI / 2, 0]);
  }
}

// Stanowisko: rękaw z pomostu do dziobu (pod płaszczyzną), kleszcze cumownicze, wąż paliwa z zaworem rury, lampki
// zajętości na pomoście; stanowisko w remoncie — kołyska pod kadłubem, platformy, iskry spawania, lampy robocze.
function berthGear(f, l, p, b) {
  const P = l.spec.pier;
  const ox = b.out.x;
  const oz = b.out.z;
  const rot = -Math.atan2(oz, ox);
  const e0 = P.halfW;
  const e1 = P.halfW + P.gap;
  const at = (o, t = 0) => [b.tapX + ox * o + p.ux * t, b.tapZ + oz * o + p.uz * t];
  const gw = Math.min(70, b.beam * 0.4);
  boxAt(f, at((e0 + e1 + 40) / 2), 80, e1 - e0 + 60, 22, gw, M.dark, rot);
  boxAt(f, at((e0 + e1 + 40) / 2), 92, e1 - e0 + 50, 3, gw - 10, M.floor, rot);
  // kleszcze cumownicze pod płaszczyzną gry (dziób okrętu nad nimi — bez styku z ciałem pomostu)
  boxAt(f, at(e1 + 14), 50, 26, 46, gw + 40, M.steel, rot);
  boxAt(f, at(e1 + 14), 74, 22, 3, gw + 36, M.yellow, rot);
  // wąż paliwa z zaworu rury (strona rury) do dziobu
  const po = p.pipe * P.pipeOff;
  const [vx, vz] = [b.tapX + p.nx * po, b.tapZ + p.nz * po];
  f.ring(vx, P.pipeY + 20, vz, P.pipeR + 12, 0, M.yellow, [Math.PI / 2, 0, 0]);
  f.cyl(vx, P.pipeY + 34, vz, 10, 30, M.rail);
  const [hx, hz] = at(e1 + 6, gw * 0.3);
  f.beam([vx, P.pipeY + 10, vz], [hx, 84, hz], 9, M.hose);
  // lampki zajętości (zielona — okręt stoi, czerwona — pusto)
  const bit = 2 ** (b.index % PBASE_BERTH_BITS);
  const ch = Math.floor(b.index / PBASE_BERTH_BITS);
  f.fx(1.3, PB_FX.show, bit, PBASE_CH.busy(ch));
  boxAt(f, at(e0 - 18, -gw * 0.6), P.deckY1 + 16, 18, 8, 18, M.green);
  f.nofx();
  f.fx(1.3, PB_FX.show, bit, PBASE_CH.free(ch));
  boxAt(f, at(e0 - 18, gw * 0.6), P.deckY1 + 16, 18, 8, 18, M.red);
  f.nofx();
  if (!b.repair) return;
  // remont: kołyska pod kadłubem (bloki stępki i podpory burtowe), platformy przy burtach, iskry spawania, lampy
  const L = b.length;
  const B = b.beam;
  const shipAt = (a, c) => [b.x - ox * a + p.ux * c, b.z - oz * a + p.uz * c];
  for (let a = -L / 2 + 40; a < L / 2 - 30; a += Math.max(70, L / 7)) {
    boxAt(f, shipAt(a, 0), 30, 40, 60, Math.min(70, B * 0.35), M.dark, rot);
    boxAt(f, shipAt(a, 0), 61, 34, 3, Math.min(64, B * 0.32), M.orange, rot);
  }
  for (const c of [-1, 1]) {
    boxAt(f, shipAt(0, c * (B / 2 + 28)), 70, L * 0.8, 10, 34, M.steel, rot);
    for (let a = -L * 0.38; a <= L * 0.38; a += L * 0.19) {
      const [sx, sz] = shipAt(a, c * (B / 2 + 28));
      f.cyl(sx, 20, sz, 6, 120, M.rail);
    }
    const n = Math.max(2, Math.round(L / 160));
    for (let i = 0; i < n; i++) {
      const h = pbHash1(b.index * 9.1 + i * 2.7 + c);
      f.fx(2.2, PB_FX.blink, h, 2.5 + 3 * h);
      boxAt(f, shipAt(-L * 0.4 + (L * 0.8 * (i + 0.5)) / n, c * (B / 2 + 8)), 76, 8, 6, 8, M.white, rot);
      f.nofx();
    }
  }
  f.fx(1.0, PB_FX.steady);
  for (const c of [-1, 1]) boxAt(f, shipAt(L / 2 - 30, c * (B / 2 + 40)), 90, 16, 8, 26, M.warm, rot);
  f.nofx();
}

// Maszt reflektora (FG): słup, obejmy, głowica z lampami w punkt L.aim, światło przeszkodowe, kogut alarmu.
function floodMast(f, L, baseY, k) {
  const top = L.y;
  f.set = 'fg';
  f.cyl(L.x, (baseY + top) / 2, L.z, 16, top - baseY, M.steel);
  for (const y of [baseY + 40, (baseY + top) / 2]) f.box(L.x, y, L.z, 44, 10, 44, M.dark);
  const a = Math.atan2(L.aim.z - L.z, L.aim.x - L.x);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  f.box(L.x + ca * 40, top - 6, L.z + sa * 40, 80, 14, 26, M.dark, -a);
  const hx = L.x + ca * 92;
  const hz = L.z + sa * 92;
  f.box(hx, top, hz, 46, 40, 150, M.dark, -a);
  f.fx(1.3, PB_FX.steady);
  for (const o of [-48, 0, 48]) f.box(hx + ca * 26 - sa * o, top - 4, hz + sa * 26 + ca * o, 10, 30, 38, M.white, -a);
  f.nofx();
  f.fx(1.6, PB_FX.blink, pbHash1(k * 2.9 + 0.4), 0.5);
  f.box(L.x, top + 26, L.z, 16, 12, 16, M.red);
  f.nofx();
  f.fx(1.7, PB_FX.alarm, pbHash1(k * 1.3), PBASE_CH.alarm);
  f.box(L.x - 30, top - 30, L.z - 30, 22, 18, 22, M.red);
  f.nofx();
  f.set = 'bg';
}

// ---------------------------------------------------------------------------
// Paliwo i magazyn

// Zbiornik paliwa: walec w pasy ostrzegawcze, kołnierze, drabina, wierzch z włazem, odpowietrznikami i pierścieniem
// pasów (widać z góry), lampy zasilania, kogut.
function fuelTank(f, l, t, i) {
  const F = l.spec.fuel;
  const yc = (F.tankY0 + F.tankY1) / 2;
  const h = F.tankY1 - F.tankY0;
  f.cyl(t.x, yc, t.z, t.r, h, M.pale);
  for (let y = F.tankY0 + 120; y < F.tankY1 - 60; y += 220) f.ring(t.x, y, t.z, t.r + 4, 0, M.dark, [Math.PI / 2, 0, 0]);
  f.cyl(t.x, F.tankY1 + 8, t.z, t.r * 0.98, 16, M.steel);
  // pierścień pasów ostrzegawczych na wierzchu (czerwono-czarne klocki) i strzałki w stronę kolektora
  const n = 24;
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * TAU;
    boxAt(f, [t.x + Math.cos(a) * t.r * 0.82, t.z + Math.sin(a) * t.r * 0.82], F.tankY1 + 18, 64, 3, 42, k % 2 ? M.black : M.yellow, -(a + Math.PI / 2));
  }
  hatch(f, t.x, F.tankY1 + 16, t.z, t.r * 0.28);
  for (const [dx, dz] of [[0.5, 0.2], [-0.35, 0.45], [-0.2, -0.5]]) {
    f.cyl(t.x + dx * t.r, F.tankY1 + 60, t.z + dz * t.r, 16, 90, M.rail);
    f.cyl(t.x + dx * t.r, F.tankY1 + 108, t.z + dz * t.r, 24, 8, M.dark);
  }
  f.box(t.x + t.r + 6, yc, t.z, 14, h - 40, 50, M.rail);
  f.fx(1.2, PB_FX.fill, 0.2, PBASE_CH.fuel);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.3;
    boxAt(f, [t.x + Math.cos(a) * (t.r + 6), t.z + Math.sin(a) * (t.r + 6)], F.tankY1 - 40, 14, 10, 14, M.warm);
  }
  f.nofx();
  f.fx(1.8, PB_FX.blink, i * 0.33, 0.6);
  f.box(t.x, F.tankY1 + 140, t.z, 22, 16, 22, M.red);
  f.nofx();
}

// Kolektor: blok pomp i zaworów, rury z każdego zbiornika i do sieci (narożnik P0), pochodnia z płomykiem.
function fuelManifold(f, l) {
  const m = l.manifold;
  const P0 = l.nodes.P0;
  const P = l.spec.pier;
  f.box(m.x, 60, m.z, m.w, 360, m.d, M.dark);
  f.box(m.x, 244, m.z, m.w + 10, 8, m.d + 10, M.rail);
  for (const [dx, dz] of [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.22], [0.25, 0.22]]) {
    f.cyl(m.x + dx * m.w, 262, m.z + dz * m.d, 54, 40, M.copper);
    f.ring(m.x + dx * m.w, 286, m.z + dz * m.d, 44, 0, M.yellow, [Math.PI / 2, 0, 0]);
  }
  grille(f, m.x, 250, m.z, m.w * 0.5, 80);
  for (const t of l.tanks) {
    f.beam([m.x, 120, m.z], [t.x, 120, t.z], 38, M.copper);
    f.beam([m.x, 80, m.z], [t.x, 80, t.z], 20, M.hose);
  }
  f.beam([m.x, P.pipeY + 20, m.z], [P0.x, P.pipeY + 20, P0.z], 44, M.copper);
  // pochodnia (płomyk nad progiem bloomu)
  const fx0 = m.x + m.w / 2 + 120;
  const fz0 = m.z - m.d / 2 - 80;
  f.cyl(fx0, 300, fz0, 18, 600, M.rail);
  f.fx(2.4, PB_FX.blink, 0.1, 1.7);
  f.cone(fx0, 640, fz0, 22, 70, M.warm);
  f.nofx();
  f.fx(1.2, PB_FX.fill, 0.2, PBASE_CH.fuel);
  for (const s of [-1, 1]) f.box(m.x + s * (m.w / 2 + 6), 180, m.z, 8, 10, m.d * 0.6, M.warm);
  f.nofx();
}

function warehouseHall(f, l) {
  const w = l.warehouse;
  const top = w.wallTop;
  const yc = (-300 + top) / 2;
  const h = top + 300;
  // ściany (przecinają płaszczyznę gry) z przyporami i pasami
  for (const s of [-1, 1]) {
    f.box(w.x, yc, w.z + s * (w.d / 2 - w.wall / 2), w.w, h, w.wall, M.dark);
    f.box(w.x + s * (w.w / 2 - w.wall / 2), yc, w.z, w.wall, h, w.d, M.dark);
  }
  for (let x = w.x - w.w / 2 + 150; x < w.x + w.w / 2; x += 300) for (const s of [-1, 1]) f.box(x, yc - 40, w.z + s * (w.d / 2 + 24), 50, h - 120, 50, M.steel);
  // dach (nad płaszczyzną): płyty, belki, włazy, kratki, pasy, rury
  f.box(w.x, w.roofY, w.z, w.w + 40, 30, w.d + 40, M.steel);
  for (let x = w.x - w.w / 2 + 160; x < w.x + w.w / 2 - 80; x += 320) f.box(x, w.roofY + 26, w.z, 24, 20, w.d, M.rail);
  for (let i = 0; i < 3; i++) hatch(f, w.x - w.w * 0.3 + i * w.w * 0.3, w.roofY + 18, w.z - w.d * 0.25, 80);
  grille(f, w.x + w.w * 0.28, w.roofY + 18, w.z + w.d * 0.22, 260, 160);
  for (const s of [-1, 1]) f.box(w.x + s * w.w * 0.15, w.roofY + 20, w.z + w.d * 0.22, 90, 3, w.d * 0.4, M.yellow, 0.55);
  f.cyl(w.x, w.roofY + 34, w.z + w.d * 0.4, 18, w.w * 0.9, M.copper, [0, 0, Math.PI / 2]);
  // wrota załadunkowe od strony pomostu (+z) i lampy
  for (const s of [-1, 0, 1]) {
    const x = w.x + s * 420;
    f.box(x, 60, w.z + w.d / 2 + 6, 300, 240, 20, M.yellow);
    f.box(x, 55, w.z + w.d / 2 + 10, 260, 210, 20, M.black);
    f.fx(1.2, PB_FX.fill, 0.2, PBASE_CH.warehouse);
    f.box(x, 200, w.z + w.d / 2 + 22, 240, 8, 8, M.warm);
    f.nofx();
  }
  spikeRow(f, w.x - w.w / 2, w.z - w.d / 2 - 30, w.x + w.w / 2, w.z - w.d / 2 - 30, top - 20, 260, 140, 22, 0, -1, 0.35, 77);
  f.fx(1.7, PB_FX.alarm, 0.3, PBASE_CH.alarm);
  for (const s of [-1, 1]) f.box(w.x + s * (w.w / 2 - 50), w.roofY + 40, w.z - w.d / 2 + 50, 28, 22, 28, M.red);
  f.nofx();
}

function warehouseYard(f, l) {
  const a = l.warehouse.annex;
  f.box(a.x, -80, a.z, a.w, 60, a.d, M.dark);
  f.box(a.x, -48, a.z, a.w - 20, 4, a.d - 20, M.floor);
  const mats = [M.orange, M.teal, M.steel, M.copper];
  let k = 0;
  for (let x = a.x - a.w / 2 + 90; x < a.x + a.w / 2 - 60; x += 130) {
    for (let z = a.z - a.d / 2 + 110; z < a.z + a.d / 2 - 80; z += 230, k++) {
      const h = pbHash1(k * 3.3 + 1.1);
      const top = -40 + 120 * (1 + Math.floor(h * 4));
      f.box(x, (-40 + top) / 2, z, 110, top + 40, 200, mats[k % mats.length]);
      f.box(x, top + 2, z, 112, 4, 202, M.dark);
    }
  }
  f.fx(1.0, PB_FX.fill, 0.2, PBASE_CH.warehouse);
  for (const s of [-1, 1]) f.box(a.x + s * (a.w / 2 - 10), 40, a.z, 8, 8, a.d * 0.8, M.warm);
  f.nofx();
}

// ---------------------------------------------------------------------------

/**
 * Scena bazy: { sets, plates ([]), labels ([]), lamps, groups (opisy kawałków), rig, instances }.
 * rig.lights — maszty reflektorów (layout.lights) dla świateł gry.
 */
export function buildPirateBaseScene(l, style) {
  const f = new PortRecorder();
  const lamps = [];
  const G = (id) => l.chunkById.get(id).group;
  if (l.chunks.length + 1 > PB_MAX_GROUPS) throw new Error(`baza piratów: ${l.chunks.length} kawałków > ${PB_MAX_GROUPS - 1}`);
  void style;
  // ---- habitat: ćwiartki bębna, szyb z trzonem, część techniczna (duch), dysk mieszkalny (duch)
  l.habitat.quadrants.forEach((qd, qi) => {
    f.group = G(qd.id);
    drumQuadrant(f, l, qd, qi);
  });
  f.group = G('H-C');
  habitatCore(f, l);
  f.group = G('H-T');
  habitatTech(f, l);
  const ds = l.habitat.discSectors;
  for (let k = 0; k < ds; k++) {
    f.group = G(`D-${k + 1}`);
    discSector(f, l, k, ds);
  }
  // ---- pomosty: odcinki (kawałki), stanowiska (rękawy, węże, lampki, remont)
  l.piers.forEach((p, pi) => {
    const parts = p.chunks.length;
    for (let i = 0; i < parts; i++) {
      f.group = G(p.chunks[i]);
      pierSpan(f, l, p, (p.len * i) / parts, (p.len * (i + 1)) / parts, pi * 5 + i);
    }
    for (const b of l.berths) {
      if (b.pier !== p.id) continue;
      f.group = G(b.chunk);
      berthGear(f, l, p, b);
    }
  });
  // ---- paliwo i magazyn
  l.tanks.forEach((t, i) => {
    f.group = G(t.chunk);
    fuelTank(f, l, t, i);
  });
  f.group = G('P-M');
  fuelManifold(f, l);
  f.group = G('M-1');
  warehouseHall(f, l);
  f.group = G('M-2');
  warehouseYard(f, l);
  // ---- maszty reflektorów (kawałek masztu) i lampy budowli
  l.lights.forEach((L, k) => {
    f.group = G(L.chunk);
    const baseY = L.chunk.startsWith('H-') ? l.habitat.rimTop : l.spec.pier.deckY1;
    floodMast(f, L, baseY, k);
    if (lamps.length < PB_MAX_LAMPS) lamps.push([L.x, k7HeightToZ(L.y - 140), L.z, 1]);
  });
  f.group = 0;
  return {
    sets: f.sets, plates: [], labels: [], lamps,
    groups: l.chunks.map((c) => ({ kind: 'chunk', id: c.id, chunkKind: c.kind })),
    rig: { lights: l.lights },
    instances: f.count()
  };
}
