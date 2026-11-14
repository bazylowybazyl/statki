// Dzielnica „Zakłady elektroniki” — FABRYKA UKŁADÓW SCALONYCH (6 rudy krzemu + 1 ruda niklu → 2 układy).
// Od drogi: przyjęcie wsadu z kolei, doki dostaw, śluza ekspedycji. Dalej dwie wielkie hale czyste z siatką
// wentylatorów i świetlikami, między nimi magistrala mediów. Z tyłu: port krzemu (doki L od strony przestrzeni,
// silosy na filarach) i oddział oczyszczania krzemu (cztery kolumny, reaktory, wymiennik). W przestrzeń: pole
// radiatorów. Kanały budowli: 0 stan linii, 1 postęp partii, 2 obciążenie radiatorów, 3 wysyłka ze śluzy.
import { PB_FX, PB_MAT, newScene, pitDetail, pushLamp, sceneOf } from '../kit/sceny.js';
import { DECK, frameAt, frameKit, hala, kolumna, korpusy, maszty, osUlicy, radiator, swietliki, wentylatory, zbiornik, zbiornikLezacy } from './narzedzia.js';

const M = PB_MAT;
export const FAB_CH = Object.freeze({ status: 0, progress: 1, heat: 2, ship: 3 });
const HALL_H = 236;

/** Hala czysta: 6 przęseł ze świetlikami, wentylatory filtrów, centrale przy tylnej ścianie, pas napisu w środku. */
function halaCzysta(K, style, half, name) {
  const R = hala(K, { u0: -half, u1: half, w0: 1250, w1: 3650, h: HALL_H, wall: M.rail, name });
  const top = R.top;
  const n = 6;
  const us = [];
  for (let i = 0; i <= n; i++) us.push(-half + 46 + ((2 * half - 92) * i) / n);
  // świetliki w dwóch odcinkach — między nimi czysty pas dachu z napisem
  swietliki(K, top, us, 1300, 2230, { dashes: 2 });
  swietliki(K, top, us, 2670, 3420, { dashes: 2 });
  for (const w of [2238, 2662]) K.blk(0, w, top, 4, 2 * half - 60, 9, M.paintCold);
  const bay = (2 * half - 92) / n;
  wentylatory(K, top, us[0] + 30, us[n] - 30, 1330, 2200, n, 3, Math.min(62, bay * 0.2));
  wentylatory(K, top, us[0] + 30, us[n] - 30, 2700, 3400, n, 2, Math.min(62, bay * 0.2));
  // centrale klimatyzacji przy tylnej attyce, kanały do dachu
  for (let i = 0; i < n; i++) {
    const u = (us[i] + us[i + 1]) / 2;
    K.blk(u, 3530, top, 44, bay * 0.62, 120, M.steel);
    K.blk(u, 3530, top + 44, 6, bay * 0.5, 90, M.rail);
    K.pipe(u, 3460, u, 3400, top + 20, 16, M.steel);
    // komin wyciągu z płuczką
    K.cyl(u + bay * 0.22, 3530, top + 50, 96, 21, M.steel);
    K.cyl(u + bay * 0.22, 3530, top + 146, 8, 27, M.paintCold);
    // pilastry ścian od drogi i od tyłu
    for (const w of [1241, 3659]) K.blk(us[i], w, DECK + 12, HALL_H - 40, 36, 18, M.steel);
  }
  for (const w of [1241, 3659]) K.blk(us[n], w, DECK + 12, HALL_H - 40, 36, 18, M.steel);
  K.pipe(us[0] + 50, 3445, us[n] - 50, 3445, top + 24, 13, M.steel);
  // postęp partii: lampki na attyce od strony drogi
  for (let k = 0; k < 12; k++) K.lit(-half * 0.7 + (half * 1.4 * k) / 11, 1262, top + 9, 7, 64, 10, M.cyan, 1.1, PB_FX.fill, (k + 0.5) / 12, FAB_CH.progress);
  for (const su of [-1, 1]) {
    K.f.fx(1.4, PB_FX.status, 0, FAB_CH.status);
    K.blk(su * (half - 60), 1262, top + 9, 12, 46, 20, M.status);
    K.f.nofx();
  }
  K.label(name, 0, 2450, Math.min(2 * half - 300, 1700), 220, style.labels.gate, 'UKŁADY SCALONE', top + 3);
}

export function buildFabScene(layout, style, occupied) {
  const { f, plates, labels, lamps, T } = newScene();
  const footprints = [];
  const E = layout.el;
  const mk = (sc, vc = 3600) => frameKit(f, plates, labels, frameAt(sc, vc), footprints);
  korpusy(T, f, layout, ['FAB'], { strip: M.cyan });
  for (const pit of layout.pits) if (pit.zone === 'FAB') pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });

  // --- dwie hale czyste
  halaCzysta(mk(-6050), style, 1130, 'HALA CZYSTA 1');
  halaCzysta(mk(-3675), style, 1270, 'HALA CZYSTA 2');

  // --- magistrala mediów między halami: rury na podporach, stacja zaworów, dwa zbiorniki gazów
  {
    const K = mk(-4928);
    for (let w = 1260; w <= 3700; w += 305) K.blk(0, w, DECK, 26, 230, 26, M.rail);
    K.pipe(-78, 1220, -78, 3740, DECK + 44, 17, M.paintCold);
    K.pipe(-30, 1220, -30, 3740, DECK + 50, 24, M.steel);
    K.pipe(28, 1220, 28, 3740, DECK + 40, 12, M.copper);
    K.pipe(74, 1220, 74, 3740, DECK + 44, 15, M.steel);
    for (const w of [1700, 3200]) {
      // zamknięty most przerzutu płytek między halami (oparty na ścianach obu hal)
      K.blk(0, w, DECK + 150, 56, 380, 92, M.rail);
      K.blk(0, w, DECK + 166, 20, 384, 98, M.glass);
      K.lit(0, w, DECK + 206, 4, 96, 8, M.cyan, 0.9);
    }
    K.blk(0, 2450, DECK + 62, 30, 200, 70, M.steel);
    K.lit(0, 2450, DECK + 92, 4, 90, 8, M.cyan, 0.9);
    K.pipe(-128, 2450, 128, 2450, DECK + 46, 12, M.paintCold);
    K.blk(0, 1150, DECK, 60, 190, 110, M.steel);
    K.blk(0, 1150, DECK + 60, 6, 150, 80, M.rail);
  }

  // --- pas frontowy, zachód: PRZYJĘCIE WSADU z kolei (dwie windy peronu, zasobniki, galeria do hali 1)
  {
    const K = mk(-6550);
    const R = hala(K, { u0: -610, u1: 610, w0: E.keep + 20, w1: 1020, h: 150, name: 'przyjęcie wsadu' });
    for (const u of [-278, 278]) {
      K.blk(u, 170, DECK, 150, 170, 180, M.steel);
      K.blk(u, 170, DECK + 150, 8, 130, 140, M.rail);
      K.lit(u, 76, DECK + 96, 5, 96, 6, M.green, 1.0);
    }
    for (const u of [-420, -140, 140, 420]) {
      K.cyl(u, 800, R.top, 46, 84, M.steel);
      K.cyl(u, 800, R.top + 46, 8, 90, M.rail);
      K.cone(u, 800, R.top + 54, 30, 60, M.rail);
    }
    K.blk(0, 480, R.top, 10, 1000, 60, M.rail);
    K.label('PRZYJĘCIE WSADU', 0, 590, 900, 110, style.labels.clear, 'KRZEM · NIKIEL', R.top + 3);
    K.blk(330, 1135, DECK, 64, 96, 250, M.rail);
    K.blk(330, 1135, DECK + 64, 5, 70, 230, M.glass);
  }

  // --- pas frontowy, wschód: ŚLUZA EKSPEDYCJI (trzy komory, światła wysyłki, galeria z hali 2)
  {
    const K = mk(-3350);
    const R = hala(K, { u0: -930, u1: 930, w0: E.keep + 20, w1: 1020, h: 160, name: 'śluza ekspedycji' });
    for (const u of [-600, 0, 600]) {
      K.blk(u, 520, R.top, 22, 420, 330, M.rail);
      K.blk(u, 520, R.top + 22, 5, 300, 200, M.glass);
      K.lit(u, 372, R.top + 22, 4, 96, 8, M.cyan, 0.9);
    }
    for (let k = 0; k < 10; k++) K.lamp(-810 + 180 * k, 288, DECK + 70, 14, M.warm, 1.15, PB_FX.launch, k / 10, FAB_CH.ship);
    K.label('EKSPEDYCJA', 0, 860, 1100, 120, style.labels.clear, 'UKŁADY · ŚLUZA CZYSTA', R.top + 3);
    K.blk(320, 1135, DECK, 64, 96, 250, M.rail);
    K.blk(320, 1135, DECK + 64, 5, 70, 230, M.glass);
  }

  // --- zaplecze doków dostaw od drogi: stacja gazów technicznych za dokiem M, sprężarki za dokiem L
  for (const p of layout.pieces) {
    if (p.zone !== 'FAB' || p.bar !== 'front' || !p.pit) continue;
    const depth = p.v1 - p.v0;
    const K = mk((p.s0 + p.s1) / 2, p.v0);
    if (depth > 400) {
      for (const u of [-130, 0, 130]) zbiornikLezacy(K, u, depth / 2 + 10, depth - 190, 44, false);
      K.blk(0, depth / 2 + 10, DECK, 5, 420, depth - 110, M.rail);
    } else {
      K.blk(0, depth / 2 + 20, DECK, 40, 400, depth - 120, M.steel);
      K.blk(0, depth / 2 + 20, DECK + 40, 6, 340, depth - 160, M.rail);
    }
  }

  // --- PORT KRZEMU: filary między dokami od strony przestrzeni — silosy, światła podejścia
  for (const p of layout.pieces) {
    if (p.zone !== 'FAB' || p.bar !== 'port') continue;
    const sc = (p.s0 + p.s1) / 2;
    const K = mk(sc, p.v0);
    if (!p.pit) {
      const depth = p.v1 - p.v0;
      K.blk(0, depth / 2, DECK, 6, 400, depth - 90, M.rail);
      for (const u of [-105, 105]) for (const w of [230, 500, 770]) zbiornik(K, u, w, 84, 150, { cap: M.rail, bands: 1, pad: false });
      K.blk(0, 500, DECK + 166, 12, 30, 640, M.rail);
      K.blk(0, 1010, DECK, 40, 300, 90, M.steel);
      for (const u of [-170, 170]) K.lamp(u, depth - 30, DECK + 24, 18, M.red, 1.5, PB_FX.blink, 0.3 + 0.2 * Math.sign(u), 0.5);
      for (let k = 0; k < 5; k++) K.lamp(0, depth - 60 - k * 150, DECK + 180, 12, M.green, 1.1, PB_FX.chase, 1 - k / 5, 0.8);
    } else {
      // za dokiem: taśmociąg zabudowany do hali 1
      const depth = p.v1 - p.v0;
      K.blk(0, depth / 2, DECK, 54, 130, depth - 30, M.rail);
      K.blk(0, depth / 2, DECK + 54, 5, 96, depth - 50, M.glass);
      K.lit(0, depth - 40, DECK + 60, 4, 96, 8, M.green, 1.0);
    }
  }
  T.label('PORT KRZEMU', -6100, 7326, 900, 100, style.labels.clear, 'RUDA Z PRZESTRZENI');

  // --- ODDZIAŁ OCZYSZCZANIA KRZEMU: cztery kolumny (FG), reaktory, estakada rur, wymiennik przy trzonie radiatorów
  {
    const K = mk(-3700, E.fab.vBack);
    K.blk(0, 610, DECK, 5, 2900, 1040, M.rail);
    [-1270, -850, 850, 1270].forEach((u, i) => kolumna(K, u, 640, { r: 104, h: 640 - 90 * (i % 2), seed: 11 + i }));
    // pomosty między kolumnami w parach (FG)
    f.set = 'fg';
    for (const u of [-1060, 1060]) {
      K.blk(u, 640, DECK + 450, 8, 240, 34, M.steel);
      K.blk(u, 625, DECK + 458, 14, 240, 4, M.steel);
      K.blk(u, 655, DECK + 458, 14, 240, 4, M.steel);
    }
    f.set = 'bg';
    for (const u of [-470, 470]) {
      K.cyl(u, 700, DECK + 5, 112, 132, M.steel);
      K.cyl(u, 700, DECK + 60, 12, 140, M.rail);
      K.cyl(u, 700, DECK + 117, 8, 100, M.glass);
      K.litCyl(u, 700, DECK + 125, 5, 46, M.cyan, 0.9);
      K.pipe(u, 560, u, 240, DECK + 40, 20, M.steel);
    }
    // estakada: dwie rury wzdłuż łuku na podporach, odejścia do hali 2
    for (let u = -1380; u <= 1380; u += 276) K.blk(u, 226, DECK + 5, 30, 26, 110, M.rail);
    K.pipe(-1400, 204, 1400, 204, DECK + 52, 19, M.steel);
    K.pipe(-1400, 250, 1400, 250, DECK + 48, 13, M.paintCold);
    for (const u of [-1270, -850, 850, 1270]) K.pipe(u, 250, u, 520, DECK + 48, 13, M.paintCold);
    for (const u of [-640, 640]) K.pipe(u, 204, u, -130, DECK + 52, 19, M.steel);
    // wymiennik ciepła u nasady trzonu radiatorów
    K.blk(0, 700, DECK + 5, 110, 520, 780, M.steel);
    K.blk(0, 700, DECK + 115, 8, 470, 730, M.rail);
    for (let k = 0; k < 9; k++) K.blk(-200 + 50 * k, 700, DECK + 123, 36, 12, 640, M.copper);
    for (const u of [-74, 74]) K.pipe(u, 1090, u, 1210, DECK + 30, 24, M.copper);
    K.label('OCZYSZCZANIE KRZEMU', -1060, 1040, 760, 100, style.labels.clear, 'KOLUMNY DESTYLACJI', DECK + 7);
    K.label('REAKTORY', 1060, 1040, 520, 100, style.labels.clear, 'OSADZANIE WARSTW', DECK + 7);
  }

  // --- ulice serwisowe: oś między pasem frontowym a halami, maszty świateł przy tylnej krawędzi hal
  osUlicy(T, -7150, -2450, 4775);
  maszty(T, -7080, -5080, 7330, { step: 500 });
  maszty(T, -4800, -2500, 7345, { step: 460 });
  maszty(T, -7100, -2500, 4775, { step: 780, h: 170 });

  // --- pole radiatorów (bryły rysuje `radiator` — własne płyty, niższe od pokładu; strefa nie idzie przez `korpusy`)
  radiator(T, f, layout.radiators.find((r) => r.zone === 'RADW'), { ch: FAB_CH.heat, color: style.labels.clear });

  // lampy hal wiszą wysoko nad dachami (światło pada z góry na dachy); 2 = chłodne, 1 = ciepłe
  for (const [s, v, y, kind] of [[-6560, 6050, 1500, 2], [-5560, 6050, 1500, 2], [-4230, 6050, 1500, 2], [-3120, 6050, 1500, 2], [-3700, 8000, 1300, 2], [-6100, 8000, 1100, 1], [-3350, 4250, 1000, 1], [-6550, 4250, 1000, 1]]) pushLamp(lamps, s, v, y, kind);
  return sceneOf(f, plates, labels, lamps, { footprints });
}
