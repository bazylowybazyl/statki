// Dzielnica „Zakłady elektroniki” — ZAKŁAD OPTYKI (3 surowe kryształy → 1 soczewka) i STACJA ZASILANIA dzielnicy.
// Od drogi: przyjęcie kryształu, doki dostaw, ekspedycja. Na pokładzie: hodowla kryształu (dziesięć pieców
// wystających z niskiej hali), szlifiernia z dachem pilastym, napylarnia próżniowa, montaż i metrologia. Z tyłu
// w przestrzeń: KOPUŁA PRÓB (obrotowa szczelina — grupa ruchoma 1) i tunel KOLIMATORA na pirsie, skierowany
// w przestrzeń. Obok stacja zasilania: reaktor, maszynownia, pole transformatorów, własne pole radiatorów.
// Kanały budowli: 0 stan linii, 1 postęp partii, 2 próba w kolimatorze, 3 wygrzanie pieców, 4 radiatory stacji,
// 5 lampa stanu kopuły.
import { PB_FX, PB_MAT, newScene, pitDetail, pushLamp, sceneOf } from '../kit/sceny.js';
import { DECK, frameAt, frameKit, hala, kolumna, korpusy, maszty, osUlicy, radiator, wentylatory, wiezaProcesowa, zbiornikLezacy } from './narzedzia.js';

const M = PB_MAT;
export const OPT_CH = Object.freeze({ status: 0, progress: 1, test: 2, furnace: 3, heat: 4, dome: 5 });
export const OPT_GROUP = Object.freeze({ slit: 1 });

export function buildOptykaScene(layout, style, occupied) {
  const { f, plates, labels, lamps, T } = newScene();
  const footprints = [];
  const E = layout.el;
  const mk = (sc, vc = 3600) => frameKit(f, plates, labels, frameAt(sc, vc), footprints);
  korpusy(T, f, layout, ['OPT', 'ENE'], { strip: M.white });
  for (const pit of layout.pits) if (pit.zone === 'OPT') pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });

  // --- HODOWLA KRYSZTAŁU: niska hala, z dachu wystaje dziesięć pieców (żar rośnie z postępem wsadu)
  {
    const K = mk(-1250);
    const R = hala(K, { u0: -1130, u1: 1130, w0: 1250, w1: 2750, h: 120, wall: M.rail, name: 'hodowla kryształu' });
    const top = R.top;
    let i = 0;
    for (const w of [1640, 2360]) {
      for (const u of [-900, -450, 0, 450, 900]) {
        K.cyl(u, w, top, 10, 150, M.rail);
        K.cyl(u, w, top + 10, 150, 112, M.steel);
        K.cyl(u, w, top + 76, 12, 124, M.rail);
        K.cyl(u, w, top + 160, 8, 96, M.rail);
        K.litCyl(u, w, top + 168, 5, 58, M.warm, 1.15, PB_FX.fill, 0.08 + 0.085 * i, OPT_CH.furnace);
        K.pipe(u + 124, w, u + 215, w, top + 24, 12, M.copper);
        i++;
      }
    }
    // szyny zasilania pieców i chłodnice na krawędzi dachu
    for (const w of [1640, 2360]) K.pipe(-1100, w + 150, 1100, w + 150, top + 16, 11, M.copper);
    for (const u of [-900, -450, 0, 450, 900]) for (const w of [1640, 2360]) K.pipe(u + 215, w, u + 215, w + 150, top + 20, 9, M.copper);
    wentylatory(K, top, -1060, 1060, 1290, 1410, 8, 1, 40);
    for (const w of [1908, 2092]) K.blk(0, w, top, 4, 2100, 9, M.paintCold);
    K.label('HODOWLA KRYSZTAŁU', 0, 2000, 1500, 150, style.labels.gate, 'PIECE · 3 KRYSZTAŁY → 1 SOCZEWKA', top + 3);
    for (let k = 0; k < 10; k++) K.lit(-760 + (1520 * k) / 9, 1262, top + 9, 7, 64, 10, M.white, 1.0, PB_FX.fill, (k + 0.5) / 10, OPT_CH.progress);
    for (const su of [-1, 1]) {
      f.fx(1.4, PB_FX.status, 0, OPT_CH.status);
      K.blk(su * 1060, 1262, top + 9, 12, 46, 20, M.status);
      f.nofx();
    }
  }

  // --- SZLIFIERNIA: dach pilasty (kalenice wzdłuż łuku, szkło od strony przestrzeni)
  {
    const K = mk(1050);
    const R = hala(K, { u0: -1060, u1: 1060, w0: 1250, w1: 2850, h: 216, wall: M.rail, name: 'szlifiernia' });
    const top = R.top;
    for (let j = 0; j < 7; j++) {
      if (j === 3) continue;
      const w = 1340 + j * 225;
      K.blk(0, w, top, 30, 2040, 64, M.steel);
      K.blk(0, w + 46, top, 12, 2040, 30, M.glass);
      for (const u of [-700, 0, 700]) K.lit(u, w - 38, top, 4, 96, 8, M.white, 0.9);
    }
    for (const w of [1924, 2106]) K.blk(0, w, top, 4, 2000, 9, M.paintCold);
    K.label('SZLIFIERNIA', 0, 2015, 1300, 150, style.labels.gate, 'SZLIFOWANIE I POLEROWANIE SOCZEWEK', top + 3);
  }

  // --- NAPYLARNIA PRÓŻNIOWA: cztery komory leżące na jasnym placu, pompy, linie chłodu
  {
    const K = mk(-1250);
    K.blk(0, 3400, DECK, 5, 2160, 900, M.rail);
    for (const u of [-780, -260, 260, 780]) {
      zbiornikLezacy(K, u, 3330, 520, 100, false, { cap: M.paintCold });
      K.blk(u + 170, 3330, DECK, 60, 90, 160, M.steel);
      K.blk(u + 170, 3330, DECK + 60, 6, 70, 130, M.rail);
      K.litCyl(u, 3330, DECK + 218, 4, 26, M.cyan, 0.9);
    }
    K.pipe(-1040, 3700, 1040, 3700, DECK + 40, 14, M.paintCold);
    for (const u of [-780, -260, 260, 780]) K.pipe(u, 3600, u, 3700, DECK + 40, 12, M.paintCold);
    for (let u = -1000; u <= 1000; u += 400) K.blk(u, 3700, DECK, 24, 26, 60, M.rail);
    K.label('NAPYLARNIA PRÓŻNIOWA', 0, 2858, 1300, 84, style.labels.clear, 'POWŁOKI SOCZEWEK');
  }

  // --- MONTAŻ I METROLOGIA: hala z okrągłymi lukami (soczewki w dachu), obok chłodnia
  {
    const K = mk(1050);
    const R = hala(K, { u0: -1060, u1: 280, w0: 3050, w1: 3850, h: 170, wall: M.rail, name: 'montaż i metrologia' });
    const top = R.top;
    for (const w of [3200, 3700]) {
      for (const u of w < 3400 ? [-880, -530, -180] : [-880, -530, -180, 130]) {
        K.cyl(u, w, top, 8, 80, M.steel);
        K.cyl(u, w, top + 8, 5, 62, M.glass);
        K.litCyl(u, w, top + 13, 3, 16, M.white, 0.9);
      }
    }
    K.label('MONTAŻ I METROLOGIA', -390, 3450, 1150, 110, style.labels.clear, '', top + 3);
    // wieża metrologii (FG): pion wzorcowy przy hali montażu
    wiezaProcesowa(K, 170, 3120, { side: 150, h: 560, seed: 3 });
    K.blk(690, 3450, DECK, 5, 700, 780, M.rail);
    wentylatory(K, DECK + 5, 400, 980, 3100, 3800, 2, 3, 92);
  }

  // --- pas frontowy: PRZYJĘCIE KRYSZTAŁU (zachód) i EKSPEDYCJA OPTYKI (wschód, przy przystanku kolei)
  {
    const K = mk(-1950);
    const R = hala(K, { u0: -430, u1: 430, w0: E.keep + 20, w1: 1020, h: 150, name: 'przyjęcie kryształu' });
    for (const u of [-250, 0, 250]) {
      K.blk(u, 640, R.top, 16, 170, 520, M.rail);
      K.blk(u, 640, R.top + 16, 4, 130, 470, M.glass);
    }
    K.label('KRYSZTAŁ', 0, 880, 600, 96, style.labels.clear, 'PRZYJĘCIE', R.top + 3);
    K.blk(200, 1135, DECK, 60, 96, 250, M.rail);
  }
  {
    const K = mk(1050);
    const R = hala(K, { u0: -1090, u1: 1090, w0: E.keep + 20, w1: 1020, h: 160, name: 'ekspedycja optyki' });
    // windy peronu kolei (przystanek s = 500): dwie obudowy przy licu
    for (const s of [500 - 256.5, 500 + 256.5]) {
      const u = (s - 1050) * 1.082;
      K.blk(u, 170, DECK, 150, 170, 180, M.steel);
      K.blk(u, 170, DECK + 150, 8, 130, 140, M.rail);
      K.lit(u, 76, DECK + 96, 5, 96, 6, M.green, 1.0);
    }
    for (const u of [-730, -240, 250, 740]) {
      K.cyl(u, 600, R.top, 9, 120, M.rail);
      K.cyl(u, 600, R.top + 9, 5, 96, M.glass);
    }
    K.label('EKSPEDYCJA', 0, 880, 1100, 110, style.labels.clear, 'SOCZEWKI · PAKOWANIE CZYSTE', R.top + 3);
    K.blk(-300, 1135, DECK, 60, 96, 250, M.rail);
  }
  for (const p of layout.pieces) {
    if (p.zone !== 'OPT' || p.bar !== 'front' || !p.pit) continue;
    const depth = p.v1 - p.v0;
    const K = mk((p.s0 + p.s1) / 2, p.v0);
    K.blk(0, depth / 2 + 20, DECK, 44, 380, depth - 120, M.steel);
    K.blk(0, depth / 2 + 20, DECK + 44, 6, 320, Math.max(40, depth - 170), M.rail);
    if (depth > 400) wentylatory(K, DECK + 50, -130, 130, depth / 2 - 130, depth / 2 + 170, 2, 2, 40);
  }

  // --- KOPUŁA PRÓB (FG): bęben, tor obrotu, czasza ze schodkowych pierścieni; szczelina = grupa ruchoma
  const dome = E.dome;
  const KD = mk(dome.s, dome.v);
  {
    const K = KD;
    K.claim('kopuła prób', -540, 540, -540, 540);
    K.blk(0, 0, DECK, 5, 1240, 1160, M.rail);
    f.set = 'fg';
    K.cyl(0, 0, DECK + 5, 26, 524, M.rail);
    K.cyl(0, 0, DECK + 31, 190, dome.r, M.rail);
    K.cyl(0, 0, DECK + 110, 22, dome.r + 4, M.glass);
    K.cyl(0, 0, DECK + 221, 14, dome.r + 16, M.steel);
    const rings = [[440, 100], [372, 90], [292, 76], [196, 58], [96, 36]];
    let y = DECK + 235;
    const tops = [];
    rings.forEach(([r, h], i) => {
      K.cyl(0, 0, y, h, r, i % 2 ? M.steel : M.rail);
      y += h;
      tops.push([r, y]);
    });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.26;
      let rin = 96;
      for (let i = tops.length - 2; i >= 0; i--) {
        const [r, yt] = tops[i];
        const rm = (rin + r) / 2;
        K.rot(Math.cos(a) * rm, Math.sin(a) * rm, yt, 7, r - rin, 12, M.steel, a);
        rin = r;
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.39;
      K.lamp(Math.cos(a) * (dome.r + 30), Math.sin(a) * (dome.r + 30), DECK + 40, 13, M.white, 1.1);
    }
    f.fx(1.4, PB_FX.status, 0, OPT_CH.dome);
    K.blk(-420, -420, DECK + 31, 60, 40, 40, M.status);
    f.nofx();
    // szczelina obserwacyjna (grupa 1): pas szkła po schodkach czaszy, prowadnice, głowica
    f.group = OPT_GROUP.slit;
    let r0 = 0;
    for (let i = tops.length - 1; i >= 0; i--) {
      const [r, yt] = tops[i];
      K.blk(0, (r0 + r) / 2, yt, 5, 78, r - r0 + 6, M.glass);
      for (const su of [-1, 1]) K.blk(su * 48, (r0 + r) / 2, yt, 9, 10, r - r0 + 6, M.rail);
      r0 = r;
    }
    K.blk(0, 452, DECK + 235, 30, 110, 40, M.steel);
    K.lit(0, 474, DECK + 242, 8, 60, 6, M.cyan, 1.2);
    K.blk(0, -250, tops[1][1], 14, 70, 90, M.rail);
    f.group = 0;
    f.set = 'bg';
    K.label('KOPUŁA PRÓB', 0, -670, 760, 70, style.labels.gate, 'SPRAWDZANIE SOCZEWEK');
  }

  // --- KOLIMATOR: tunel prób na pirsie, od kopuły w przestrzeń
  {
    const K = KD;
    const w0 = dome.r + 4;
    const w1 = E.tunnel.v1 - dome.v - 300;
    const yc = DECK + 116;
    K.blk(0, w0 + 90, DECK, 150, 230, 180, M.steel);
    K.blk(0, w0 + 90, DECK + 150, 8, 190, 140, M.rail);
    const seg = 410;
    const n = Math.round((w1 - w0 - 180) / seg);
    for (let k = 0; k < n; k++) {
      const a = w0 + 180 + ((w1 - w0 - 180) * k) / n;
      const b = w0 + 180 + ((w1 - w0 - 180) * (k + 1)) / n;
      K.pipe(0, a, 0, b, yc, 72, k % 3 === 1 ? M.rail : M.steel);
      K.pipe(0, a - 7, 0, a + 7, yc, 86, M.rail);
      K.blk(0, (a + b) / 2, DECK, 46, 200, 44, M.rail);
      K.pipe(0, (a + b) / 2 - 60, 0, (a + b) / 2 + 60, yc, 76, M.paintCold);
      K.lamp(108, (a + b) / 2, DECK + 10, 14, M.cyan, 1.2, PB_FX.launch, k / n, OPT_CH.test);
      K.lamp(-108, a + 40, DECK + 10, 12, M.white, 1.0);
    }
    K.pipe(74, w0 + 180, 74, w1, DECK + 30, 10, M.copper);
    // głowica kolimatora: obudowa, przesłona ze szkła, światło próby
    K.blk(0, w1 + 110, DECK, 190, 220, 220, M.steel);
    K.blk(0, w1 + 110, DECK + 190, 8, 180, 180, M.rail);
    K.blk(0, w1 + 224, DECK + 60, 110, 150, 10, M.glass);
    K.lit(0, w1 + 232, DECK + 86, 56, 96, 6, M.cyan, 1.3, PB_FX.fill, 0.5, OPT_CH.test);
    K.lamp(0, w1 + 110, DECK + 206, 18, M.red, 1.6, PB_FX.blink, 0.2, 0.5);
    for (const su of [-1, 1]) K.lamp(su * 104, w1 + 250, DECK + 14, 14, M.red, 1.4, PB_FX.blink, 0.5 + 0.2 * su, 0.5);
  }

  // --- STACJA ZASILANIA: reaktor (FG), maszynownia, pole transformatorów
  {
    const P = E.power;
    const K = mk((P.s0 + P.s1) / 2, E.opt.vBack);
    K.claim('stacja zasilania', -860, 860, 40, 1760);
    K.blk(0, 900, DECK, 5, 1700, 1700, M.rail);
    f.set = 'fg';
    K.cyl(-430, 540, DECK + 5, 20, 330, M.rail);
    K.cyl(-430, 540, DECK + 25, 240, 290, M.rail);
    K.cyl(-430, 540, DECK + 130, 18, 296, M.glass);
    K.cyl(-430, 540, DECK + 265, 14, 302, M.steel);
    K.cyl(-430, 540, DECK + 279, 80, 250, M.rail);
    K.cyl(-430, 540, DECK + 359, 64, 176, M.steel);
    K.cyl(-430, 540, DECK + 423, 40, 88, M.rail);
    K.lamp(-430, 540, DECK + 470, 16, M.red, 1.6, PB_FX.blink, 0.7, 0.5);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.52;
      K.blk(-430 + Math.cos(a) * 318, 540 + Math.sin(a) * 318, DECK + 5, 200, 46, 46, M.steel);
    }
    f.set = 'bg';
    for (const u of [560, 740]) kolumna(K, u, 1010, { r: 56, h: 380, seed: 31 + u, cap: M.rail });
    const R = hala(K, { u0: 80, u1: 800, w0: 230, w1: 880, h: 170, name: '' });
    wentylatory(K, R.top, 130, 750, 300, 520, 3, 1, 62);
    for (const u of [230, 440, 650]) {
      K.cyl(u, 760, R.top, 46, 30, M.steel);
      K.cyl(u, 760, R.top + 46, 6, 36, M.rail);
    }
    K.label('MASZYNOWNIA', 440, 630, 560, 84, style.labels.clear, '', R.top + 3);
    for (const w of [480, 600]) K.pipe(-140, w, 80, w, DECK + 60, 30, M.steel);
    // pole transformatorów: dwa rzędy, izolatory, szyny, bramki
    for (const w of [1250, 1560]) {
      for (let i = 0; i < 6; i++) {
        const u = -700 + 280 * i;
        K.blk(u, w, DECK + 5, 74, 110, 86, M.steel);
        K.blk(u, w - 56, DECK + 5, 60, 96, 20, M.rail);
        K.blk(u, w + 56, DECK + 5, 60, 96, 20, M.rail);
        for (const du of [-32, 0, 32]) {
          K.cyl(u + du, w, DECK + 79, 44, 7, M.copper);
          K.cyl(u + du, w, DECK + 123, 5, 11, M.rail);
        }
      }
      K.pipe(-790, w, 790, w, DECK + 132, 7, M.copper);
      for (const u of [-820, 0, 820]) K.blk(u, w, DECK + 5, 150, 22, 22, M.rail);
    }
    for (const u of [-820, 0, 820]) K.pipe(u, 1250, u, 1560, DECK + 150, 7, M.copper);
    K.pipe(0, 880, 0, 1250, DECK + 60, 16, M.copper);
    for (let k = 0; k < 6; k++) K.lit(-700 + 280 * k, 1405, DECK + 5, 4, 96, 8, M.warm, 0.9);
    // nasada trzonu radiatorów stacji
    for (const u of [-14, 134]) K.pipe(u, 1620, u, 1810, DECK + 30, 22, M.copper);
    K.label('STACJA ZASILANIA', -160, 1010, 1100, 110, style.labels.gate, 'REAKTOR · TRANSFORMATORY', DECK + 7);
  }
  // szyny zasilania wzdłuż tylnej krawędzi pokładu optyki: do fabryki układów i do kopuły
  T.pipeRun(-2360, 660, E.opt.vBack - 132, DECK + 22, 9, M.copper);
  T.pipeRun(-2360, 660, E.opt.vBack - 110, DECK + 22, 9, M.copper);
  T.run(-2360, 660, E.opt.vBack - 121, DECK, 12, 60, M.rail, 700, 0.06);

  osUlicy(T, -2350, 2150, 4775);
  maszty(T, -2300, 2100, 4775, { step: 780, h: 170 });
  maszty(T, -2300, 600, E.opt.vBack - 24, { step: 520 });

  radiator(T, f, layout.radiators.find((r) => r.zone === 'RADC'), { ch: OPT_CH.heat, color: style.labels.clear });

  // lampy hal wiszą wysoko nad dachami (światło pada z góry na dachy); 2 = chłodne, 1 = ciepłe
  for (const [s, v, y, kind] of [[-1250, 5600, 1400, 1], [1050, 5650, 1500, 2], [-1250, 7000, 1200, 2], [900, 7050, 1200, 2], [dome.s, dome.v, 1500, 2], [dome.s, 10800, 1100, 2], [1450, 8500, 1400, 1], [1050, 4250, 1000, 1]]) pushLamp(lamps, s, v, y, kind);
  const pivot = KD.P(0, 0);
  return sceneOf(f, plates, labels, lamps, { footprints, dome: { group: OPT_GROUP.slit, x: pivot[0], z: pivot[1] } });
}
