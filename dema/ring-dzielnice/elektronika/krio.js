// Dzielnica „Zakłady elektroniki” — ZAKŁAD TAŚMY NADPRZEWODZĄCEJ (1 ziemie rzadkie + 1 przewód miedziany +
// 1 nadstop niklu → 2 taśmy). Od drogi: przyjęcie miedzi, doki dostaw, przyjęcie z kolei, ekspedycja taśmy.
// Na pokładzie: długa hala powlekania, PLAC SZPUL z suwnicą bramową (grupy ruchome: 1 brama, 2 wózek, 3 szpula
// na haku), kriogenika — sprężarkownia, kolumny chłodu (FG), baterie wymienników, skraplacze — i farma zbiorników
// helu i azotu (FG). W przestrzeń: pole radiatorów. Kanały budowli: 0 stan linii, 1 postęp partii, 2 radiatory.
import { PB_FX, PB_MAT, newScene, pitDetail, pushLamp, sceneOf } from '../kit/sceny.js';
import { DECK, frameAt, frameKit, hala, korpusy, maszty, osUlicy, radiator, wentylatory, wiezaProcesowa, zbiornik, zbiornikLezacy } from './narzedzia.js';

const M = PB_MAT;
export const KRIO_CH = Object.freeze({ status: 0, progress: 1, heat: 2 });
export const KRIO_GROUP = Object.freeze({ gantry: 1, trolley: 2, spool: 3 });

/** Plac szpul w ramce (u, w): tory suwnicy, rzędy szpul, punkt odbioru (wylot hali) i punkt zdania (rampa ekspedycji). */
export const KRIO_YARD = Object.freeze({
  sc: 6150, u0: -930, u1: 930, w0: 1250, w1: 2500,
  railA: 1290, railB: 2460, home: 1875,
  pick: Object.freeze({ u: -800, w: 1700 }),
  drop: Object.freeze({ u: 800, w: 1420 })
});

/** Szpula taśmy: bęben z miedzi i dwie tarcze; oś wzdłuż u. */
function szpula(K, u, w, y, r = 58) {
  K.pipe(u - 44, w, u + 44, w, y, r, M.copper);
  K.pipe(u - 52, w, u - 44, w, y, r + 17, M.rail);
  K.pipe(u + 44, w, u + 52, w, y, r + 17, M.rail);
}

export function buildKrioScene(layout, style, occupied) {
  const { f, plates, labels, lamps, T } = newScene();
  const footprints = [];
  const E = layout.el;
  const mk = (sc, vc = 3600) => frameKit(f, plates, labels, frameAt(sc, vc), footprints);
  korpusy(T, f, layout, ['KRIO'], { strip: M.cyan });
  for (const pit of layout.pits) if (pit.zone === 'KRIO') pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });

  // --- HALA POWLEKANIA TAŚMY: długa hala wzdłuż drogi, kalenica z rurami chłodu, kominki, wylot na plac szpul
  {
    const K = mk(3750);
    const R = hala(K, { u0: -1480, u1: 1480, w0: 1250, w1: 2350, h: 200, wall: M.rail, name: 'hala taśmy' });
    const top = R.top;
    K.blk(0, 1560, top, 20, 2860, 84, M.steel);
    K.blk(0, 1560, top + 20, 4, 2800, 30, M.glass);
    K.pipe(-1440, 1500, 1440, 1500, top + 16, 13, M.paintCold);
    K.pipe(-1440, 1620, 1440, 1620, top + 16, 13, M.paintCold);
    for (let i = 0; i < 8; i++) {
      const u = -1260 + 360 * i;
      K.cyl(u, 1770, top, 54, 26, M.steel);
      K.cyl(u, 1770, top + 54, 6, 32, M.steel);
      K.lit(u + 90, 1700, top, 4, 96, 8, M.cyan, 0.9);
    }
    for (const w of [1878, 2262]) K.blk(0, w, top, 4, 2860, 9, M.paintCold);
    K.label('TAŚMA NADPRZEWODZĄCA', 0, 2070, 2100, 190, style.labels.gate, 'HALA POWLEKANIA', top + 3);
    for (let k = 0; k < 14; k++) K.lit(-1040 + 160 * k, 1262, top + 9, 7, 64, 10, M.cyan, 1.1, PB_FX.fill, (k + 0.5) / 14, KRIO_CH.progress);
    for (const su of [-1, 1]) {
      f.fx(1.4, PB_FX.status, 0, KRIO_CH.status);
      K.blk(su * 1400, 1262, top + 9, 12, 46, 20, M.status);
      f.nofx();
    }
    // trzy wieże powlekania wystające z dachu (FG)
    [-1000, 0, 1000].forEach((u, i) => wiezaProcesowa(K, u, 1400, { side: 190, h: 470 + 60 * (i % 2), seed: 50 + i }));
    // wylot taśmy na plac szpul
    K.blk(1570, 1700, DECK, 74, 160, 300, M.rail);
    K.blk(1570, 1700, DECK + 74, 5, 120, 260, M.glass);
    K.lit(1570, 1560, DECK + 80, 4, 96, 8, M.cyan, 1.0);
  }

  // --- PLAC SZPUL: jasna płyta, tory, szpule w rzędach, suwnica bramowa
  const Y = KRIO_YARD;
  const KY = mk(Y.sc);
  {
    const K = KY;
    const uc = (Y.u0 + Y.u1) / 2;
    const wc = (Y.w0 + Y.w1) / 2;
    K.claim('plac szpul', Y.u0, Y.u1, Y.w0, Y.w1);
    K.blk(uc, wc, DECK, 5, Y.u1 - Y.u0, Y.w1 - Y.w0, M.rail);
    for (const w of [Y.railA, Y.railB]) {
      K.blk(uc, w, DECK + 5, 9, Y.u1 - Y.u0 - 20, 20, M.rail);
      for (const su of [-1, 1]) K.blk(su * (Y.u1 - 14), w, DECK + 5, 40, 20, 40, M.yellow);
    }
    // szpule: trzy rzędy; część miejsc pusta (znaczniki na płycie)
    let i = 0;
    for (const w of [1900, 2110, 2320]) {
      for (let k = 0; k < 9; k++) {
        const u = -640 + 160 * k;
        K.blk(u, w, DECK + 5, 2, 130, 150, M.paintCold);
        K.blk(u, w, DECK + 6, 2, 118, 138, M.rail);
        if ((i * 7 + 3) % 5 !== 0) {
          szpula(K, u, w, DECK + 7 + 75);
          for (const su of [-1, 1]) K.blk(u + su * 48, w, DECK + 7, 12, 14, 110, M.rail);
        }
        i++;
      }
    }
    // punkt odbioru (przy wylocie hali) i rampa zdania do ekspedycji
    K.blk(Y.pick.u, Y.pick.w, DECK + 5, 14, 170, 190, M.rail);
    K.lit(Y.pick.u, Y.pick.w - 110, DECK + 5, 4, 96, 8, M.cyan, 1.0);
    K.blk(Y.drop.u, Y.drop.w, DECK + 5, 14, 170, 190, M.rail);
    K.lit(Y.drop.u, Y.drop.w + 110, DECK + 5, 4, 96, 8, M.warm, 1.0);
    K.blk(Y.drop.u, 1190, DECK, 60, 110, 130, M.rail);
    K.label('PLAC SZPUL', -200, 1560, 900, 120, style.labels.clear, 'SUWNICA · ODBIÓR Z HALI → EKSPEDYCJA', DECK + 7);

    // suwnica bramowa (FG): brama = grupa 1 (jedzie wzdłuż u), wózek z hakiem = grupa 2, szpula na haku = grupa 3
    f.set = 'fg';
    const yb = DECK + 300;
    f.group = KRIO_GROUP.gantry;
    for (const w of [Y.railA, Y.railB]) {
      K.blk(0, w, DECK + 14, 26, 230, 44, M.rail);
      for (const su of [-1, 1]) {
        K.blk(su * 84, w, DECK + 40, yb - DECK - 40, 24, 30, M.steel);
        K.beam([su * 84, w, DECK + 44], [0, w, yb - 6], 12, M.rail);
      }
      K.blk(0, w, yb, 30, 230, 56, M.steel);
      K.lamp(0, w, yb + 38, 14, M.red, 1.5, PB_FX.blink, w > 2000 ? 0.5 : 0, 0.6);
    }
    for (const su of [-1, 1]) {
      K.blk(su * 50, wc, yb + 4, 24, 20, Y.railB - Y.railA + 60, M.steel);
      K.blk(su * 50, wc, yb + 28, 5, 12, Y.railB - Y.railA + 40, M.paintCold);
    }
    K.blk(0, Y.railA - 60, yb - 40, 46, 110, 70, M.steel);
    K.blk(0, Y.railA - 60, yb - 28, 14, 116, 76, M.glass);
    for (const w of [1500, 1875, 2250]) K.lit(0, w, yb - 4, 5, 60, 12, M.white, 1.1);
    f.group = KRIO_GROUP.trolley;
    K.blk(0, Y.home, yb + 2, 30, 124, 92, M.yellow);
    K.blk(0, Y.home, yb + 32, 10, 70, 60, M.rail);
    K.cyl(0, Y.home, DECK + 208, yb - DECK - 206, 5, M.rail);
    K.blk(0, Y.home, DECK + 198, 10, 130, 18, M.rail);
    f.group = KRIO_GROUP.spool;
    szpula(K, 0, Y.home, DECK + 120);
    f.group = 0;
    f.set = 'bg';
  }

  // --- KRIOGENIKA: sprężarkownia, kolumny chłodu (FG), baterie wymienników, skraplacze
  {
    const K = mk(3600);
    K.claim('kriogenika', -1300, 1300, 2700, 4500);
    const R = hala(K, { u0: -1250, u1: -330, w0: 2760, w1: 3500, h: 170, name: '' });
    wentylatory(K, R.top, -1200, -380, 2800, 3060, 4, 1, 60);
    for (const u of [-1090, -790, -490]) {
      K.cyl(u, 3380, R.top, 44, 28, M.steel);
      K.cyl(u, 3380, R.top + 44, 6, 34, M.rail);
    }
    K.label('SPRĘŻARKOWNIA', -790, 3200, 760, 100, style.labels.clear, '', R.top + 3);
    // kolumny chłodu
    f.set = 'fg';
    for (const [u, h] of [[-1080, 640], [-830, 540], [-580, 640]]) {
      K.blk(u, 3980, DECK, 14, 200, 200, M.rail);
      K.blk(u, 3980, DECK + 14, h, 150, 150, M.steel);
      K.blk(u, 3980, DECK + h * 0.55, 10, 158, 158, M.paintCold);
      K.blk(u, 3980, DECK + 14 + h, 12, 166, 166, M.rail);
      K.cyl(u, 3980, DECK + 26 + h, 40, 22, M.steel);
      K.lamp(u, 3980, DECK + 72 + h, 14, M.red, 1.5, PB_FX.blink, u * 0.001 + 0.5, 0.5);
      K.cyl(u + 96, 3980, DECK, h * 0.9, 12, M.paintCold);
    }
    f.set = 'bg';
    K.pipe(-1140, 4110, -520, 4110, DECK + 40, 16, M.paintCold);
    K.blk(-830, 4300, DECK, 5, 760, 250, M.rail);
    for (const u of [-1040, -830, -620]) K.blk(u, 4300, DECK + 5, 54, 150, 170, M.steel);
    K.blk(470, 3130, DECK, 5, 1500, 800, M.rail);
    K.blk(470, 4080, DECK, 5, 1640, 520, M.rail);
    for (const u of [-250, 195, 300, 745, 850]) {
      K.blk(u, 4190, DECK + 5, 40, 70, 90, M.steel);
      K.cyl(u, 4190, DECK + 45, 14, 22, M.steel);
    }
    // baterie wymienników: ramy z miedzianymi żebrami, kolektory
    for (const u of [20, 470, 920]) {
      K.blk(u, 3130, DECK + 5, 14, 400, 640, M.steel);
      for (let k = 0; k < 9; k++) K.blk(u - 160 + 40 * k, 3130, DECK + 18, 78, 13, 590, M.copper);
      K.blk(u, 3130, DECK + 96, 8, 380, 60, M.rail);
      K.pipe(u - 190, 2800, u + 190, 2800, DECK + 60, 15, M.paintCold);
      K.pipe(u - 190, 3460, u + 190, 3460, DECK + 60, 15, M.paintCold);
    }
    K.pipe(-330, 2800, 1130, 2800, DECK + 60, 11, M.paintCold);
    K.label('KRIOGENIKA', 470, 3610, 1000, 110, style.labels.gate, 'WYMIENNIKI · SKRAPLACZE');
    for (const u of [-80, 470, 1020]) zbiornikLezacy(K, u, 4060, 430, 92, true);
    K.pipe(-300, 4250, 1240, 4250, DECK + 40, 14, M.paintCold);
    for (const u of [-80, 470, 1020]) K.pipe(u, 4160, u, 4250, DECK + 40, 12, M.paintCold);
    // rury chłodu do hali powlekania (przez pokład między halą a kriogeniką)
    for (const u of [-200, 700]) {
      K.pipe(u, 2376, u, 2800, DECK + 60, 15, M.paintCold);
      K.blk(u, 2590, DECK, 46, 60, 36, M.rail);
    }
  }

  // --- FARMA ZBIORNIKÓW HELU I AZOTU (FG): 2 × 4 zbiorniki na jasnej płycie, pomost między rzędami
  {
    const K = mk(6050);
    K.claim('zbiorniki', -1000, 1000, 2800, 4470);
    K.blk(0, 3560, DECK, 5, 1960, 1560, M.rail);
    f.set = 'fg';
    let i = 0;
    for (const w of [3170, 3950]) {
      for (const u of [-750, -250, 250, 750]) {
        zbiornik(K, u, w, 165, 380, { cap: i % 3 === 1 ? M.teal : M.paintCold, bands: 3, pad: false });
        K.pipe(u, w + (w < 3500 ? 165 : -165), u, 3560, DECK + 40, 13, M.paintCold);
        i++;
      }
    }
    K.blk(0, 3560, DECK + 300, 8, 1860, 60, M.steel);
    for (let u = -900; u <= 900; u += 300) K.blk(u, 3560, DECK + 5, 295, 14, 14, M.steel);
    // maszt odpowietrzenia z kogutem
    K.cyl(920, 4300, DECK + 5, 520, 9, M.steel);
    K.lamp(920, 4300, DECK + 532, 15, M.red, 1.5, PB_FX.blink, 0.35, 0.5);
    f.set = 'bg';
    K.pipe(-960, 3560, 960, 3560, DECK + 40, 18, M.paintCold);
    K.pipe(-960, 3560, -960, 2700, DECK + 40, 18, M.paintCold);
    for (const u of [-750, -250, 250, 750]) K.lit(u, 2880, DECK + 5, 4, 96, 8, M.cyan, 0.9);
    K.label('HEL · AZOT', 0, 4390, 900, 100, style.labels.clear, 'ZBIORNIKI KRIOGENICZNE', DECK + 7);
  }

  // --- pas frontowy: PRZYJĘCIE MIEDZI, PRZYJĘCIE Z KOLEI (windy peronu), EKSPEDYCJA TAŚMY
  {
    const K = mk(2750);
    const R = hala(K, { u0: -510, u1: 510, w0: E.keep + 20, w1: 1020, h: 150, name: 'przyjęcie miedzi' });
    for (const u of [-300, 0, 300]) szpulaZnak(K, u, 560, R.top);
    K.label('PRZEWÓD CU', 0, 880, 760, 96, style.labels.clear, 'PRZYJĘCIE', R.top + 3);
    K.blk(-200, 1135, DECK, 60, 96, 250, M.rail);
  }
  {
    const K = mk(5500);
    const R = hala(K, { u0: -440, u1: 440, w0: E.keep + 20, w1: 1020, h: 150, name: 'przyjęcie z kolei' });
    for (const u of [-278, 278]) {
      K.blk(u, 170, DECK, 150, 170, 180, M.steel);
      K.blk(u, 170, DECK + 150, 8, 130, 140, M.rail);
      K.lit(u, 76, DECK + 96, 5, 96, 6, M.green, 1.0);
    }
    for (const u of [-250, 0, 250]) {
      K.cyl(u, 700, R.top, 40, 76, M.steel);
      K.cone(u, 700, R.top + 40, 30, 76, M.rail);
    }
    K.label('ZIEMIE RZADKIE', 0, 900, 780, 90, style.labels.clear, 'PRZYJĘCIE · KOLEJ', R.top + 3);
  }
  {
    const K = mk(6600);
    const R = hala(K, { u0: -520, u1: 520, w0: E.keep + 20, w1: 1020, h: 160, name: 'ekspedycja taśmy' });
    for (const u of [-260, 260]) {
      K.blk(u, 560, R.top, 16, 300, 360, M.rail);
      K.blk(u, 560, R.top + 16, 4, 250, 300, M.glass);
    }
    K.label('EKSPEDYCJA', 0, 890, 800, 96, style.labels.clear, 'TAŚMA · NADSTOP', R.top + 3);
  }
  for (const p of layout.pieces) {
    if (p.zone !== 'KRIO' || p.bar !== 'front' || !p.pit) continue;
    const depth = p.v1 - p.v0;
    const K = mk((p.s0 + p.s1) / 2, p.v0);
    if (depth > 400) {
      K.blk(0, depth / 2 + 10, DECK, 5, 420, depth - 110, M.rail);
      for (const u of [-110, 110]) zbiornik(K, u, depth / 2 + 10, 78, 110, { bands: 1, pad: false });
    } else {
      K.blk(0, depth / 2 + 20, DECK, 40, 400, depth - 120, M.steel);
      K.blk(0, depth / 2 + 20, DECK + 40, 6, 340, depth - 160, M.rail);
    }
  }

  // szyny zasilania ze stacji wzdłuż tylnej krawędzi pokładu, nasada trzonu radiatorów
  T.pipeRun(2260, 4860, E.krio.vBack - 62, DECK + 22, 9, M.copper);
  T.pipeRun(2260, 4860, E.krio.vBack - 40, DECK + 22, 9, M.copper);
  T.run(2260, 4860, E.krio.vBack - 51, DECK, 12, 60, M.rail, 700, 0.06);
  {
    const K = mk(5000, E.krio.vBack);
    K.blk(0, -200, DECK, 80, 330, 330, M.steel);
    K.blk(0, -200, DECK + 80, 8, 290, 290, M.rail);
    for (let k = 0; k < 6; k++) K.blk(-110 + 44 * k, -200, DECK + 88, 30, 12, 260, M.copper);
    for (const u of [-74, 74]) K.pipe(u, -40, u, 20, DECK + 30, 22, M.copper);
    K.pipe(-165, -200, -1000, -200, DECK + 40, 14, M.paintCold);
  }
  osUlicy(T, 2250, 7150, 4775);
  maszty(T, 2300, 7100, 4775, { step: 780, h: 170 });
  maszty(T, 2500, 5100, 6030, { step: 520 });

  radiator(T, f, layout.radiators.find((r) => r.zone === 'RADE'), { ch: KRIO_CH.heat, color: style.labels.clear });

  // lampy hal wiszą wysoko nad dachami (światło pada z góry na dachy); 2 = chłodne, 1 = ciepłe
  for (const [s, v, y, kind] of [[3050, 5400, 1500, 2], [4450, 5400, 1500, 2], [Y.sc, 5480, 1400, 1], [3300, 7000, 1400, 2], [4300, 7050, 1400, 2], [6050, 7150, 1500, 2], [2750, 4250, 1000, 1], [6050, 4250, 1000, 1]]) pushLamp(lamps, s, v, y, kind);
  return sceneOf(f, plates, labels, lamps, { footprints, yard: { sc: Y.sc, t: KY.F.t, r: KY.F.r, ...KRIO_GROUP } });
}

/** Znak na dachu przyjęcia miedzi: krąg przewodu. */
function szpulaZnak(K, u, w, top) {
  K.cyl(u, w, top, 26, 96, M.rail);
  K.cyl(u, w, top + 26, 8, 84, M.copper);
  K.cyl(u, w, top + 26, 14, 34, M.rail);
}
