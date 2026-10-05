// Ringi-archetypy — bryły portu poza halą K-7: otwarte zatoki (pokład,
// ściany, pylony z terminalem na płycie portu, suwnice pasów MEGA) i tranzyty przez
// płytę (wyściółka, portale). Wymiary 1:1 z planu dachu Halo
// (haloRingRoofPlan.js: docks / transits) — stanowiska standardu K-7 rysuje
// hala kompleksu (HaloPortK7), kolizje liczy haloPortDocking.js z tych samych
// liczb. Tu tylko wygląd: paleta i światła doków z profilu planety oraz
// „ubranie” w stylu dema (ECUMENE: stalowe cięgna, złote głowice, ciepłe
// i zimne pasy; Fable: radiatory z żarem, anteny, bursztynowe bramy).
// Czysta matematyka — Three buduje siatki w archRing.js.
import { HALO_PORT, HALO_TRANSIT, haloTransitAngles } from '../haloRingConfig.js';
import { HALO_BAY, bayArms, haloBayLayouts } from '../haloPortBays.js';
import { k7ArmWidthAt } from '../haloPortK7Layout.js';
import { PORT_PAD_H } from '../haloRingRoofPlan.js';
import { ArchBatch, archBeamMatrix, archDockBox, archHex } from './archFrame.js';

const M16 = new Array(16);

// Paleta z profilu (sRGB hex → liniowe) i emisja (HDR).
export function archPortPalette(style) {
  return {
    pal: style.k7Palette.map((h) => archHex(h)),
    emit: style.k7Emit.map((c) => c.slice(0, 3))
  };
}

// kody palety K-7 (haloPortK7Build.js K7_MAT)
const P = { steel: 0, dark: 1, light: 2, yellow: 3, orange: 4, teal: 5, deck: 6, rails: 7, black: 8, hose: 9, copper: 10, glass: 11, paint: 12, cold: 13 };
const E = { cyan: 0, warm: 1, white: 2, red: 3, green: 4 };

/**
 * Bryły portu ringu-archetypu. Zwraca { solid: ArchBatch (skrzynki z podstawą
 * na y = 0 w osi ringu), lights: [{x, y, z, color, size, phase}] }.
 * style — profil.port (paleta), dress — 'ecumene' | 'fable'.
 */
export function buildArchPortBodies(layout, style, dress = 'ecumene') {
  const solid = new ArchBatch('ArchPort');
  const lights = [];
  const { pal, emit } = archPortPalette(style);
  const floorMid = layout.radii.floorMid;
  const box = (th, rF, x, y0, y1, z0, z1, sx, color, kind = 4, p1 = 0.3) => {
    archDockBox(th, rF, x, (y0 + y1) * 0.5, z0, sx, y1 - y0, z1 - z0, M16);
    solid.push16(M16, color, kind, Math.abs(Math.sin(x * 0.013 + y0 * 0.007)), p1, 0);
  };
  const glow = (th, rF, x, y0, y1, z0, z1, sx, color, gain = 1) => {
    archDockBox(th, rF, x, (y0 + y1) * 0.5, z0, sx, y1 - y0, z1 - z0, M16);
    solid.push16(M16, color, 2, 0, gain, 0);
  };
  // belka między punktami układu doku (x wzdłuż, y promieniowo od rF, z świata)
  const P0 = { x: 0, y: 0, z: 0 };
  const P1 = { x: 0, y: 0, z: 0 };
  const beam = (th, rF, x0, y0, z0, x1, y1, z1, w, color, kind = 4, p1 = 0.3) => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    P0.x = (rF + y0) * c - s * x0; P0.y = (rF + y0) * s + c * x0; P0.z = z0;
    P1.x = (rF + y1) * c - s * x1; P1.y = (rF + y1) * s + c * x1; P1.z = z1;
    archBeamMatrix(P0, P1, w, M16);
    solid.push16(M16, color, kind, Math.abs(Math.sin(x0 * 0.013 + y0 * 0.007)), p1, 0);
  };
  // płyta pionowa wzdłuż odcinka (xa, ya) → (xb, yb) układu doku, grubości
  // wysokości trójkąta przy odcinku, po stronie `inward` (znak x ku osi
  // pylonu) — skośny bok zwężenia pylonu (X = u·T, Y = z·H, Z = d·L, wyznacznik
  // dodatni jak archDockBox)
  const taperSlab = (th, rF, xa, ya, xb, yb, inward, z0, z1, color) => {
    const dx = xb - xa;
    const dy = yb - ya;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const T = (Math.abs(dx) * Math.abs(dy)) / len + 10;
    const dxn = dx / len;
    const dyn = dy / len;
    let nx = -dyn;
    let ny = dxn;
    if (nx * inward < 0) { nx = -nx; ny = -ny; }
    const cx = (xa + xb) * 0.5 + nx * T * 0.5;
    const cy = (ya + yb) * 0.5 + ny * T * 0.5;
    const c = Math.cos(th);
    const s = Math.sin(th);
    M16[0] = (dyn * -s - dxn * c) * T; M16[1] = (dyn * c - dxn * s) * T; M16[2] = 0; M16[3] = 0;
    M16[4] = 0; M16[5] = 0; M16[6] = z1 - z0; M16[7] = 0;
    M16[8] = (dxn * -s + dyn * c) * len; M16[9] = (dxn * c + dyn * s) * len; M16[10] = 0; M16[11] = 0;
    const r = rF + cy;
    M16[12] = r * c - s * cx; M16[13] = r * s + c * cx; M16[14] = z0; M16[15] = 1;
    solid.push16(M16, color, 4, Math.abs(Math.sin(cx * 0.013 + cy * 0.007)), 0.3, 0);
  };
  const light = (th, rF, x, y, z, color, size, phase = 0) => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    const r = rF + y;
    lights.push({ x: r * c - s * x, y: r * s + c * x, z, color, size, phase });
  };
  const ecu = dress === 'ecumene';

  // ---- zatoki ---------------------------------------------------------------
  // Od 2026-10-05 (poprawka użytkownika: doki „za mocno wciśnięte w ring”)
  // zatoka stoi dockGap za krawędzią ścian: y od ściany tylnej zatoki (rF =
  // jej promień), płyta portu na podłodze na y = fY < 0; dwa pylony-korytarze
  // na wysokości zatoki (bayArms — przeszkoda lotu) od płyty portu do ściany
  // tylnej.
  for (const bay of haloBayLayouts(layout)) {
    const th = bay.theta;
    const rF = bay.frame.radius + bay.baseZ;
    const fY = floorMid + PORT_PAD_H - rF;
    const len = HALO_PORT.dockLength;
    const D = bay.depth;
    const zD = HALO_PORT.deckTop;
    const zB = zD - 60;
    const zW = HALO_PORT.wallTop;
    const cD = HALO_PORT.collarDepth;
    const zBase = Math.round(HALO_PORT.plugZMin * 0.75);
    const sink = (x) => (x * x) / (2 * (rF + fY)) + 20;
    const lanes = bay.lanes.map((v) => v.x);
    const spines = bay.spines.map((v) => v.x);
    // pokład, spód nośny, ściana tylna, ściany boczne
    box(th, rF, 0, HALO_PORT.backWall, D, zB, zD, len - 2 * HALO_PORT.sideWall, pal[P.deck]);
    box(th, rF, 0, 40, D - 60, zB - 110, zB, len - 2 * HALO_PORT.sideWall - 40, pal[P.hose]);
    box(th, rF, 0, 0, HALO_PORT.backWall, zB, zW, len, pal[P.steel]);
    for (const sd of [-1, 1]) {
      box(th, rF, sd * (len - HALO_PORT.sideWall) * 0.5, 0, D, zB, zW, HALO_PORT.sideWall, pal[P.steel]);
      glow(th, rF, sd * (len * 0.5 - HALO_PORT.sideWall - 3), HALO_PORT.backWall, D, zW - 30, zW - 22, 6, emit[E.cyan], 0.9);
      glow(th, rF, sd * (len * 0.5 - HALO_PORT.sideWall - 6), D - 60, D, zW - 8, zW, 12, emit[E.cyan], 0.9);
      box(th, rF, sd * (len - HALO_PORT.sideWall) * 0.5, 700, D - 40, zW, zW + 12, 40, pal[P.rails], 0, 0.4);
    }
    glow(th, rF, 0, HALO_PORT.backWall + 3, HALO_PORT.backWall + 9, zW - 30, zW - 22, len - 2 * HALO_PORT.sideWall, emit[E.cyan], 0.9);
    glow(th, rF, 0, D - 40, D, zB - 70, zB, len, emit[E.cyan], 0.7);
    // suwnice pasów MEGA (most od bieżni na ścianie do nogi na grzbiecie)
    lanes.forEach((lx, k) => {
      const sdl = Math.sign(lx) || 1;
      const xWall = sdl * (len * 0.5 - HALO_PORT.sideWall * 0.5);
      const xSpine = spines[k];
      const span = Math.abs(xWall - xSpine);
      for (const yb of HALO_BAY.gantryAt) {
        const y = D * yb;
        box(th, rF, (xWall + xSpine) * 0.5, y - HALO_PORT.gantryProfile * 0.5, y + HALO_PORT.gantryProfile * 0.5, zW + 12, zW + 12 + HALO_PORT.gantryProfile, span, pal[P.yellow], 0, 0.3);
        box(th, rF, xSpine, y - 40, y + 40, zD, zW + 12 + HALO_PORT.gantryProfile, 60, pal[P.dark], 0, 0.2);
        box(th, rF, xWall - sdl * 70, y - 60, y + 60, zW - 20, zW + 12, 90, pal[P.dark], 0, 0.2);
      }
    });
    // sterownia (przeszklenie ku zatoce)
    box(th, rF, 0, HALO_PORT.backWall - 20, HALO_PORT.backWall + 60, zW - 10, zW + 90, 520, pal[P.dark]);
    glow(th, rF, 0, HALO_PORT.backWall + 60, HALO_PORT.backWall + 64, zW + 10, zW + 70, 480, emit[E.cyan], 0.5);
    // ---- pylony: wystają wprost ze ściany tylnej zatoki, na jej wysokości
    // (bayArms — te same wielokąty co kolizje): rozszerzona stopa na płycie
    // portu (wieża do terminalu pod płaszczyzną), zwężenie, dźwigar-korytarz,
    // rozszerzenie i korzeń w ścianie tylnej; od środka brama przejścia.
    const arms = bayArms(bay).map((v) => ({
      ...v, y0: v.z0 - bay.baseZ, y1: v.z1 - bay.baseZ, footEnd: v.footEnd - bay.baseZ, rootStart: v.rootStart - bay.baseZ
    }));
    const zTermTop = -340;
    const armX = Math.abs(arms[0].x);
    const AF = arms[0].flareWidth;
    const xOut = armX + AF * 0.5 + 220;
    const face = fY + cD;
    box(th, rF, 0, fY - 60 - sink(xOut), face, zBase, zTermTop, 2 * xOut, pal[P.black]);
    for (let row = 0; row < 4; row++) {
      const zr = zTermTop - 110 - row * 120;
      if (zr < zBase + 60) break;
      glow(th, rF, 0, face, face + 6, zr, zr + 20, 2 * xOut - 240, emit[E.warm], 0.55);
    }
    const rail = 80;                             // pasy na krawędziach (ściany korytarza)
    let zTop = 0;
    for (const a of arms) {
      const { x, width: W, zw0, zw1, taper } = a;
      zTop = zw1;
      const hw = W * 0.5;
      const hf = AF * 0.5;
      const midA = a.footEnd + taper;
      const midB = a.rootStart - taper;
      // bryła: stopa (wieża od terminalu), zwężenia, dźwigar, korzeń w ścianie tylnej
      box(th, rF, x, a.y0, a.footEnd, zBase, zw1, AF, pal[P.dark]);
      box(th, rF, x, a.footEnd, a.rootStart, zw0, zw1, W, pal[P.dark]);
      box(th, rF, x, a.rootStart, a.y1, zw0 - 20, zw1, AF, pal[P.dark]);
      for (const sx of [-1, 1]) {
        taperSlab(th, rF, x + sx * hf, a.footEnd, x + sx * hw, midA, -sx, zw0, zw1, pal[P.dark]);
        taperSlab(th, rF, x + sx * hw, midB, x + sx * hf, a.rootStart, -sx, zw0 - 20, zw1, pal[P.dark]);
      }
      // pasy-ściany wzdłuż obu krawędzi całego obrysu (z góry — kontur belki)
      for (const sx of [-1, 1]) {
        const path = [[x + sx * hf, a.y0 + 60], [x + sx * hf, a.footEnd], [x + sx * hw, midA], [x + sx * hw, midB], [x + sx * hf, a.rootStart], [x + sx * hf, a.y1 - 40]];
        const ox = -sx * rail * 0.5;
        for (let k = 0; k + 1 < path.length; k++) {
          const [xa, ya] = path[k];
          const [xb, yb] = path[k + 1];
          if (Math.abs(xb - xa) < 1) box(th, rF, xa + ox, ya, yb, zw0, zw1 + 35, rail, pal[P.steel]);
          else beam(th, rF, xa + ox, ya, zw1 + 35 - rail * 0.5, xb + ox, yb, zw1 + 35 - rail * 0.5, rail, pal[P.steel]);
          if (k > 0) box(th, rF, xa + ox, ya - rail * 0.6, ya + rail * 0.6, zw1 - 20, zw1 + 40, rail + 20, pal[P.steel]);
        }
      }
      // żebra dachu w poprzek całej długości (szerokość z obrysu)
      for (let y = a.y0 + 220; y < a.y1 - 100; y += 280) box(th, rF, x, y - 26, y + 26, zw1, zw1 + 18, k7ArmWidthAt(a, y) - rail * 1.6, pal[P.light], 0, 0.4);
      // lica dźwigara: słupki i krzyżulce (kratownica Warrena)
      const n = Math.max(2, Math.round((midB - midA) / 320));
      const st = (midB - midA) / n;
      for (let i = 0; i <= n; i++) {
        const y = midA + i * st;
        for (const sx of [-1, 1]) {
          const xf = x + sx * (hw + 10);
          box(th, rF, xf, y - 28, y + 28, zw0, zw1 + 20, 30, pal[P.light], 0, 0.4);
          if (i < n) {
            const up = (i & 1) === 0;
            beam(th, rF, xf, y + 28, up ? zw0 + 25 : zw1 - 25, xf, y + st - 28, up ? zw1 - 25 : zw0 + 25, 26, pal[P.steel]);
          }
        }
      }
      // okna korytarza i listwy świetlne wzdłuż pasów
      for (const sx of [-1, 1]) {
        glow(th, rF, x + sx * (hw + 2), midA + 60, midB - 60, zw0 + 120, zw0 + 150, 6, emit[E.warm], 0.7);
        glow(th, rF, x + sx * (hw - rail - 6), midA + 30, midB - 30, zw1 + 4, zw1 + 12, 12, emit[E.cyan], 0.8);
      }
      // światła przeszkodowe na narożnikach stopy i korzenia
      for (const sx of [-1, 1]) {
        light(th, rF, x + sx * (hf - 40), a.footEnd - 60, zw1 + 60, emit[E.red], 24, 0.3 + 0.2 * sx);
        light(th, rF, x + sx * (hf - 40), a.rootStart + 60, zw1 + 60, emit[E.red], 24, 0.55 + 0.2 * sx);
      }
      // przejście z zatoki do pylonu: brama na licu ściany tylnej od środka
      box(th, rF, x, HALO_PORT.backWall + 2, HALO_PORT.backWall + 12, zD, zW - 20, W * 0.62, pal[P.black]);
      for (const sx of [-1, 1]) box(th, rF, x + sx * W * 0.33, HALO_PORT.backWall + 2, HALO_PORT.backWall + 16, zD, zW - 10, 40, pal[P.yellow], 0, 0.3);
      box(th, rF, x, HALO_PORT.backWall + 2, HALO_PORT.backWall + 16, zW - 20, zW - 4, W * 0.7, pal[P.yellow], 0, 0.3);
    }
    // ---- ubranie w stylu dema ----
    if (ecu) {
      // ECUMENE (wolny port KEPLER): cięgna na koronie ścian bocznych, złote
      // głowice słupów i stóp pylonów, ciepły pas na koronie, zimne latarnie
      // wylotu
      for (const sd of [-1, 1]) {
        const xw = sd * (len - HALO_PORT.sideWall) * 0.5;
        for (const yb of [0.3, 0.55, 0.8]) {
          box(th, rF, xw, D * yb - 20, D * yb + 20, zW + 12, zW + 150, 36, pal[P.light], 0, 0.4);
          box(th, rF, xw, D * yb - 30, D * yb + 30, zW + 150, zW + 165, 60, pal[P.copper], 0, 0.6);
        }
        glow(th, rF, xw, 300, D - 120, zW + 12, zW + 17, HALO_PORT.sideWall * 0.6, emit[E.warm], 0.8);
        box(th, rF, sd * armX, arms[0].footEnd - 320, arms[0].footEnd - 60, zTop + 30, zTop + 60, AF - 100, pal[P.copper], 0, 0.6);
        light(th, rF, sd * (len * 0.5 - HALO_PORT.sideWall * 0.5), D + 30, zW + 60, emit[E.cyan], 26, 0.1);
      }
    } else {
      // Fable: radiatory na koronie ścian (ciemne lamele z żarem), anteny
      // z czerwonymi światłami na stopach pylonów, bursztynowe bramy terminalu
      for (const sd of [-1, 1]) {
        const xw = sd * (len - HALO_PORT.sideWall) * 0.5;
        for (let y = 700; y < D - 120; y += 95) box(th, rF, xw, y - 4, y + 4, zW + 12, zW + 90, 170, pal[P.black], 5, 0.35);
        const xa = sd * (armX + AF * 0.5 - 60);
        for (const yy of [face + 60, face + 180]) {
          box(th, rF, xa, yy - 6, yy + 6, zTop + 30, zTop + 390, 12, pal[P.hose], 0, 0.2);
          light(th, rF, xa, yy, zTop + 460, emit[E.red], 22, Math.abs(yy * 0.001 + sd) % 1);
        }
        for (let k = 0; k < 2; k++) glow(th, rF, sd * (xOut * 0.35 + k * 420), face, face + 5, zBase + 140, zBase + 320, 300, emit[E.warm], 0.9);
      }
    }
    // światła: stroboskopy wylotu, nawigacja wylotu, reflektory na ścianach
    for (const sd of [-1, 1]) {
      light(th, rF, sd * len * 0.5, D, zW + 6, emit[E.white], 30, 0.25 * (sd + 1) + 0.3);
      light(th, rF, sd * (len * 0.5 - HALO_PORT.sideWall * 0.5), D - 20, zW + 20, sd > 0 ? emit[E.green] : emit[E.red], 24, 0.05);
      for (let k = 1; k <= 3; k++) light(th, rF, sd * (len * 0.5 - HALO_PORT.sideWall * 0.5), D * k / 4, zW + 6, emit[E.warm], 18, 0.05);
    }
  }

  // ---- tranzyty ---------------------------------------------------------------
  const T = HALO_TRANSIT;
  const frameR = floorMid + PORT_PAD_H;
  const slab = frameR - layout.radii.back;
  for (const th of haloTransitAngles()) {
    const rF = frameR;
    const hw = T.halfWidth;
    const W = T.wall;
    const ya = -slab - 40;
    const yb = 30;
    const [zc0, zc1] = T.cutZ;
    const [pz0, pz1] = T.portalZ;
    const outer = hw + W + T.frame;
    box(th, rF, 0, ya, yb, zc0, T.deckTop, 2 * (hw + W), pal[P.deck]);
    box(th, rF, 0, ya, yb, T.ceiling, zc1, 2 * (hw + W), pal[P.hose]);
    for (const sd of [-1, 1]) {
      box(th, rF, sd * (hw + W * 0.5), ya, yb, zc0, zc1, W, pal[P.steel]);
      glow(th, rF, sd * (hw + 2), ya + 20, yb - 20, -46, -38, 4, emit[E.cyan], 0.9);
      glow(th, rF, sd * (hw + 2), ya + 20, yb - 20, T.ceiling - 30, T.ceiling - 22, 4, emit[ecu ? E.warm : E.cyan], 0.8);
    }
    for (const side of [1, -1]) {
      const y0 = side > 0 ? -60 : -slab - 150;
      const y1 = side > 0 ? 150 : -slab + 60;
      const face = side > 0 ? y1 : y0;
      const fy0 = side > 0 ? face : face - 6;
      const fy1 = side > 0 ? face + 6 : face;
      for (const sd of [-1, 1]) {
        box(th, rF, sd * (hw + W + T.frame * 0.5), y0, y1, pz0, pz1, T.frame, pal[P.hose]);
        box(th, rF, sd * (hw + W + 24), fy0, fy1, pz0 + 60, pz1 - 60, 36, pal[P.yellow], 0, 0.3);
        box(th, rF, sd * (outer - 20), fy0, fy1, pz0 + 40, pz1 - 40, 30, pal[P.black]);
      }
      box(th, rF, 0, y0, y1, zc1, pz1, 2 * outer, pal[P.hose]);
      box(th, rF, 0, y0, y1, pz0, zc0, 2 * outer, pal[P.black]);
      glow(th, rF, 0, fy0, fy1, zc1 + 36, zc1 + 60, 2 * hw, emit[E.cyan], 0.9);
      glow(th, rF, 0, fy0, fy1, zc0 - 110, zc0 - 80, 2 * hw, emit[E.cyan], 0.9);
      const ly = face + side * 8;
      for (const z of [-260, 0, 260]) {
        light(th, rF, outer - 60, ly, z, emit[E.green], 26, 0.05);
        light(th, rF, -(outer - 60), ly, z, emit[E.red], 26, 0.05);
      }
      for (const sd of [-1, 1]) light(th, rF, sd * outer, ly, pz1, emit[E.white], 30, 0.25 * (sd + 1) + (side > 0 ? 0.3 : 0.8));
    }
  }
  return { solid, lights };
}
