// Ringi-archetypy — bryły portu poza halą K-7: otwarte zatoki (pokład,
// ściany, kołnierz z terminalem, klin, suwnice pasów MEGA) i tranzyty przez
// płytę (wyściółka, portale). Wymiary 1:1 z planu dachu Halo
// (haloRingRoofPlan.js: docks / transits) — stanowiska standardu K-7 rysuje
// hala kompleksu (HaloPortK7), kolizje liczy haloPortDocking.js z tych samych
// liczb. Tu tylko wygląd: paleta i światła doków z profilu planety oraz
// „ubranie” w stylu dema (ECUMENE: stalowe cięgna, złote głowice, ciepłe
// i zimne pasy; Fable: radiatory z żarem, anteny, bursztynowe bramy).
// Czysta matematyka — Three buduje siatki w archRing.js.
import { HALO_PORT, HALO_TRANSIT, haloTransitAngles } from '../haloRingConfig.js';
import { HALO_BAY, haloBayLayouts } from '../haloPortBays.js';
import { PORT_PAD_H } from '../haloRingRoofPlan.js';
import { ArchBatch, archDockBox, archHex } from './archFrame.js';

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
  const light = (th, rF, x, y, z, color, size, phase = 0) => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    const r = rF + y;
    lights.push({ x: r * c - s * x, y: r * s + c * x, z, color, size, phase });
  };
  const ecu = dress === 'ecumene';

  // ---- zatoki ---------------------------------------------------------------
  for (const bay of haloBayLayouts(layout)) {
    const th = bay.theta;
    const rF = floorMid + PORT_PAD_H;
    const len = HALO_PORT.dockLength;
    const D = bay.depth;
    const zD = HALO_PORT.deckTop;
    const zB = zD - 60;
    const zW = HALO_PORT.wallTop;
    const cW = HALO_PORT.collar;
    const cD = HALO_PORT.collarDepth;
    const zBase = Math.round(HALO_PORT.plugZMin * 0.75);
    const sink = (x) => (x * x) / (2 * rF) + 20;
    const sinkAll = sink(len * 0.5 + cW);
    const lanes = bay.lanes.map((v) => v.x);
    const spines = bay.spines.map((v) => v.x);
    // pokład, ściana tylna, ściany boczne
    box(th, rF, 0, HALO_PORT.backWall, D, zB, zD, len - 2 * HALO_PORT.sideWall, pal[P.deck]);
    box(th, rF, 0, -sinkAll, HALO_PORT.backWall, zB, zW, len, pal[P.steel]);
    for (const sd of [-1, 1]) {
      box(th, rF, sd * (len - HALO_PORT.sideWall) * 0.5, -sink(len * 0.5), D, zB, zW, HALO_PORT.sideWall, pal[P.steel]);
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
    // kołnierz na podłodze: słupy, nadproże, podstawa-terminal z oknami
    const cx = len * 0.5 + cW * 0.5;
    for (const sd of [-1, 1]) {
      box(th, rF, sd * cx, -60 - sink(len * 0.5 + cW), cD, zBase, zW + 80, cW, pal[P.hose]);
      glow(th, rF, sd * (len * 0.5 + 8), cD - 4, cD + 4, zBase + 60, zW + 60, 10, emit[E.cyan], 0.8);
    }
    box(th, rF, 0, -60, cD, zW, zW + 80, len, pal[P.hose]);
    box(th, rF, 0, -60 - sink(len * 0.5), cD, zBase, zB, len, pal[P.black]);
    for (let row = 0; row < 5; row++) {
      const zr = zB - 110 - row * 115;
      if (zr < zBase + 60) break;
      glow(th, rF, 0, cD, cD + 6, zr, zr + 20, len - 240, emit[E.warm], 0.55);
    }
    // klin nośny pod pokładem (schodami ku wylotowi)
    const steps = [[-sink(len * 0.5 - 150), 900, zBase], [900, 1800, Math.round(zBase * 0.66)], [1800, 2700, Math.round(zBase * 0.38)]];
    for (const [y0, y1, z0] of steps) {
      box(th, rF, 0, y0, y1, z0, zB, len - 300, pal[P.hose]);
      for (const sd of [-1, 1]) glow(th, rF, sd * (len * 0.5 - 150 - 3), y0, y1 - 20, z0 + 30, z0 + 38, 6, emit[E.cyan], 0.7);
    }
    // ---- ubranie w stylu dema ----
    if (ecu) {
      // ECUMENE (wolny port KEPLER): cięgna od słupów kołnierza do korony
      // ścian bocznych, złote głowice słupów, ciepły pas na koronie, zimne
      // latarnie wylotu
      for (const sd of [-1, 1]) {
        const xw = sd * (len - HALO_PORT.sideWall) * 0.5;
        for (const yb of [0.3, 0.55, 0.8]) {
          box(th, rF, xw, D * yb - 20, D * yb + 20, zW + 12, zW + 150, 36, pal[P.light], 0, 0.4);
          box(th, rF, xw, D * yb - 30, D * yb + 30, zW + 150, zW + 165, 60, pal[P.copper], 0, 0.6);
        }
        glow(th, rF, xw, 300, D - 120, zW + 12, zW + 17, HALO_PORT.sideWall * 0.6, emit[E.warm], 0.8);
        box(th, rF, sd * cx, cD - 40, cD + 40, zW + 80, zW + 110, cW + 40, pal[P.copper], 0, 0.6);
        light(th, rF, sd * (len * 0.5 - HALO_PORT.sideWall * 0.5), D + 30, zW + 60, emit[E.cyan], 26, 0.1);
      }
    } else {
      // Fable: radiatory na koronie ścian (ciemne lamele z żarem), anteny
      // z czerwonymi światłami na kołnierzu, bursztynowe bramy terminalu
      for (const sd of [-1, 1]) {
        const xw = sd * (len - HALO_PORT.sideWall) * 0.5;
        for (let y = 700; y < D - 120; y += 95) box(th, rF, xw, y - 4, y + 4, zW + 12, zW + 90, 170, pal[P.black], 5, 0.35);
        for (const yy of [cD * 0.3, cD * 0.8]) {
          box(th, rF, sd * (cx + 60), yy - 6, yy + 6, zW + 80, zW + 80 + 360, 12, pal[P.hose], 0, 0.2);
          light(th, rF, sd * (cx + 60), yy, zW + 450, emit[E.red], 22, Math.abs(yy * 0.001 + sd) % 1);
        }
        for (let k = 0; k < 3; k++) glow(th, rF, sd * (len * 0.25 + k * 420 - 420), cD, cD + 5, zB - 380, zB - 180, 300, emit[E.warm], 0.9);
      }
    }
    // światła: stroboskopy wylotu, czerwone na kołnierzu, nawigacja wylotu
    for (const sd of [-1, 1]) {
      light(th, rF, sd * len * 0.5, D, zW + 6, emit[E.white], 30, 0.25 * (sd + 1) + 0.3);
      light(th, rF, sd * (len * 0.5 + cW), cD, zW + 86, emit[E.red], 26, 0.3 + 0.2 * sd);
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
