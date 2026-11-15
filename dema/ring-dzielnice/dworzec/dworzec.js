// DWORZEC PROMÓW — bryły budowli „Dworzec” (dane PortRecorder): plac dworcowy, pirsy ze stanowiskami i galeriami,
// hala odlotów i przylotów ze szklanym sklepieniem i rotundą, rękawy do stanowisk, apsyda z wieżą kontroli ruchu,
// skrzydła: biuro kontraktów (KADRY) i odprawa. Bez zabudowy mieszkalnej — ludzie mieszkają w ringu.
import { PB_FX, PB_MAT, YARD_H, newScene, pitDetail, pushLamp, sceneOf, spire } from '../kit/sceny.js';
import { ringScale, yardPoint } from '../kit/uklad.js';
import { GAIN, annex, bodiesSteel, dome, faceWindows, gallery, hoop, lampPost, podium, roundTower, sleeve, tower, tree } from './bryly.js';
import { DW, GATES } from './uklad.js';

const M = PB_MAT;
const H = YARD_H;

/** Dok w ścianie promieniowej (pirs) z lampą stanu na kanale — jak `pitDetailRad` zestawu, z rękawem pasażerskim. */
function pierPit(T, f, pit, ch) {
  const sw = ringScale(pit.vc);
  const S = (d) => d / sw;
  const back = pit.open > 0 ? pit.s0 : pit.s1;
  const mouth = pit.open > 0 ? pit.s1 : pit.s0;
  const inward = pit.open > 0 ? 1 : -1;                 // od ściany tylnej ku wylotowi (znak s)
  const depthW = (pit.s1 - pit.s0) * sw;
  const wid = pit.v1 - pit.v0;
  T.sec(pit.s0, pit.s1, pit.v0, pit.v1, H.keel, H.floor - H.keel, M.floor);
  T.hazardRad(mouth - S(inward * 26), pit.v0 + 14, pit.v1 - 14, H.floor + 3, 26);
  const B = pit.berth;
  for (const side of [-1, 1]) T.box(B.s, pit.vc + side * B.width / 2, H.mark, B.length * 0.94, 2, 9, M.paintCold);
  const nose = B.s - S(inward * B.length / 2);
  T.box(nose - S(inward * 6), pit.vc, H.mark, 14, 2, B.width + 30, M.yellow);
  T.box((back + nose) / 2, pit.vc, H.gear, Math.abs(nose - back) * sw + 20, 22, Math.min(120, B.width * 0.4), M.steel);
  T.box(back + S(inward * 16), pit.vc, 70, 30, 80, Math.min(B.width * 0.7, 320), M.steel);
  T.box(back + S(inward * 16), pit.vc, 112, 26, 4, Math.min(B.width * 0.66, 300), M.yellow);
  for (const side of [-1, 1]) T.box(pit.sc, (side < 0 ? pit.v0 : pit.v1) + side * 9, H.deck + 9, depthW, 16, 16, M.rail);
  T.box(back - S(inward * 9), pit.vc, H.deck + 9, 16, 16, wid, M.rail);
  f.fx(1.45, PB_FX.status, 0, ch);
  T.box(back - S(inward * 34), pit.vc, H.deck + 22, 18, 12, 34, M.status);
  f.nofx();
  for (const side of [-1, 1]) T.lamp(mouth + S(inward * 8), (side < 0 ? pit.v0 : pit.v1) + side * 10, H.deck + 20, 16, M.warm, 1.0);
}

/** Zbiorniki paliwa promów: `n` leżących walców na kołyskach, żółte opaski, rurociąg zbiorczy. */
function tanks(T, f, s, v, n, y0) {
  const sw = ringScale(v);
  for (let i = 0; i < n; i++) {
    const tv = v + i * 200;
    T.box(s, tv, y0 + 10, 600, 20, 130, M.rail);
    T.pipe(s - 270 / sw, tv, s + 270 / sw, tv, y0 + 86, 68, M.steel);
    for (const ds of [-160, 160]) T.box(s + ds / sw, tv, y0 + 86, 18, 142, 142, M.yellow);
    T.lamp(s + 300 / sw, tv, y0 + 30, 12, M.warm, 0.9);
  }
  T.pipe(s - 310 / sw, v - 60, s - 310 / sw, v + (n - 1) * 200 + 60, y0 + 30, 12, M.copper);
}

/** Wieża kontroli ruchu na apsydzie: cokół, trzon z przyporami, kabina ze szklanym pasem, radar (grupa ruchoma), maszt. */
function controlTower(T, f, s, v, radarGroup) {
  const [x, z] = yardPoint(s, v);
  const y0 = H.deck;
  f.cyl(x, y0 + 50, z, 190, 100, M.steel);
  f.cyl(x, y0 + 104, z, 176, 8, M.rail);
  f.cyl(x, y0 + 74, z, 194, 22, M.glass);
  f.fx(GAIN.warm, PB_FX.steady);
  f.cyl(x, y0 + 40, z, 193, 8, M.warm);
  f.nofx();
  const top = y0 + 2350;
  f.cyl(x, (y0 + 108 + top) / 2, z, 76, top - y0 - 108, M.dark);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    f.beam([x + Math.cos(a) * 170, y0 + 108, z + Math.sin(a) * 170], [x + Math.cos(a) * 78, y0 + 1000, z + Math.sin(a) * 78], 18, M.steel);
    f.fx(GAIN.cold, PB_FX.steady);
    f.box(x + Math.cos(a) * 78, (y0 + 1040 + top) / 2, z + Math.sin(a) * 78, 7, top - y0 - 1100, 7, M.cyan, -a);
    f.nofx();
  }
  for (const k of [0.3, 0.55, 0.8]) f.cyl(x, y0 + 108 + (top - y0 - 108) * k, z, 90, 16, M.rail);
  // kabina: kielich, pas szyb, dach, pierścień świateł
  f.cyl(x, top + 14, z, 120, 28, M.steel);
  f.cyl(x, top + 44, z, 190, 32, M.steel);
  f.cyl(x, top + 86, z, 210, 52, M.glass);
  f.fx(GAIN.cold + 0.25, PB_FX.steady);
  f.cyl(x, top + 58, z, 212, 6, M.cyan);
  f.nofx();
  f.cyl(x, top + 118, z, 220, 12, M.steel);
  f.cyl(x, top + 128, z, 150, 8, M.rail);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    f.fx(1.0, PB_FX.chase, i / 8, 0.5);
    f.box(x + Math.cos(a) * 214, top + 116, z + Math.sin(a) * 214, 14, 7, 14, M.white, -a);
    f.nofx();
  }
  // radar: grupa ruchoma (obrót wokół osi wieży)
  f.group = radarGroup;
  f.cyl(x, top + 152, z, 10, 40, M.rail);
  f.box(x, top + 190, z, 260, 56, 14, M.steel, 0);
  f.box(x, top + 190, z + 9, 236, 44, 6, M.rail, 0);
  f.box(x, top + 164, z, 70, 8, 46, M.dark, 0);
  f.group = 0;
  f.cyl(x + 90, top + 205, z - 80, 4, 150, M.rail);
  f.fx(1.7, PB_FX.blink, 0.2, 0.5);
  f.box(x + 90, top + 283, z - 80, 14, 7, 14, M.red);
  f.nofx();
  return { x, z, top };
}

export function buildTerminalScene(layout, style) {
  const { f, plates, labels, lamps, T } = newScene();
  const status = [];
  const C = layout.court;
  const Hl = DW.hall;

  // --- korpusy i dno placu dworcowego
  bodiesSteel(T, f, layout, ['DW'], { strip: M.warm });
  podium(plates, layout.apse, H.deck, M.rail);
  T.sec(C.s0, C.s1, C.v0, C.v1, H.keel, H.floor - H.keel, M.steel);
  T.hazardRun(C.s0 + 14, C.s1 - 14, C.v0 + 40, H.floor + 3, 44);
  // strzałki bramek: przylot (zielone, w głąb placu) i odlot (bursztynowe, ku drodze)
  for (const [gs, dv, mat] of [[GATES.inW, 1, M.green], [GATES.inE, 1, M.green], [GATES.outE, -1, M.warm], [GATES.outW, -1, M.warm]]) {
    for (let k = 0; k < 3; k++) {
      f.fx(0.9, PB_FX.chase, dv > 0 ? 1 - k / 3 : k / 3, 0.8);
      T.chevron(gs, C.v0 + 330 + k * 190 + (dv > 0 ? 90 : 0), H.floor + 4, 130, 16, mat, 0, dv);
      f.nofx();
    }
    T.box(gs, C.v0 + 150, H.floor + 3, 330, 2, 12, M.paintCold);
  }
  // koło obrotu pośrodku placu i oś świateł ku hali
  {
    const [x, z] = yardPoint(0, 4800);
    hoop(f, x, z, 470, H.floor + 3, 2.4, 14, M.paintCold, 36);
    hoop(f, x, z, 150, H.floor + 3, 2.4, 10, M.yellow, 16);
    for (let k = 0; k < 9; k++) T.lamp(0, 5360 + k * 60, H.floor + 5, 12, M.cyan, 0.9, PB_FX.chase, 1 - k / 9, 0.7);
  }
  T.label('DWORZEC PROMÓW', 0, 4190, 1500, 170, style.labels.terminal, 'PLAC DWORCOWY · PRZYLOT ZIELONE · ODLOT BURSZTYNOWE', H.floor + 4);

  // --- stanowiska: hala (wyloty w ścianie tylnej placu) i pirsy; lampy stanu na kanałach budowli
  let n = 0;
  for (const pit of layout.pits) {
    if (pit.zone !== 'DW') continue;
    const ch = status.length;
    status.push({ ch, berthId: pit.berth.id });
    n++;
    if (pit.orient === 'arc') {
      pitDetail(T, f, pit, { statusCh: ch });
      // oś podejścia na dnie placu
      T.box(pit.sc, pit.v0 - 250, H.floor + 3, 8, 2, 380, M.paintCold);
      for (let k = 0; k < 4; k++) T.lamp(pit.sc, pit.v0 - 70 - k * 90, H.floor + 5, 11, M.green, 0.85, PB_FX.chase, 1 - k / 4, 0.8);
      T.label(`${pit.cls.toUpperCase()}-${n}`, pit.sc, pit.v0 - 520, 190, 70, style.labels.berth, '', H.floor + 4);
    } else {
      pierPit(T, f, pit, ch);
      const mouth = pit.open > 0 ? pit.s1 : pit.s0;
      const dir = pit.open > 0 ? 1 : -1;
      const sw = ringScale(pit.vc);
      T.box(mouth + (dir * 230) / sw, pit.vc, H.floor + 3, 340, 2, 8, M.paintCold);
      for (let k = 0; k < 3; k++) T.lamp(mouth + (dir * (70 + k * 90)) / sw, pit.vc, H.floor + 5, 11, M.green, 0.85, PB_FX.chase, 1 - k / 3, 0.8);
      T.label(`${pit.cls.toUpperCase()}-${n}`, mouth + (dir * 520) / sw, pit.vc, 170, 64, style.labels.berth, '', H.floor + 4);
    }
  }

  // ======================= nadbudowa (nad pokładem — zestaw FG) =======================
  f.set = 'fg';
  const deck = H.deck + 6;

  // --- pirsy: galeria pasażerska wzdłuż pirsu, rękawy do stanowisk, poczekalnie na zębach, wieżyczki przy wlocie
  for (const side of [-1, 1]) {
    const sg = side * 2440;
    gallery(f, yardPoint(sg, 3850), yardPoint(sg, 5960), 210, deck, { eave: 60, ridge: 150, bay: 140, seed: 40 + side, phase: side > 0 ? 1 : 0 });
    const pits = layout.pits.filter((p) => p.zone === 'DW' && p.orient === 'rad' && Math.sign(p.sc) === side);
    for (const pit of pits) {
      const back = pit.open > 0 ? pit.s0 : pit.s1;
      const sw = ringScale(pit.vc);
      sleeve(f, yardPoint(sg - (side * 100) / sw, pit.vc), yardPoint(back + (side * 26) / sw, pit.vc), deck, { wid: pit.cls === 'm' ? 60 : 46 });
    }
    // poczekalnie na zębach między stanowiskami
    const teeth = [[4230, 4400], [4850, 5030], [5300, 5450], [5720, 5985]];
    for (const [a, b] of teeth) {
      const sc = side * (DW.courtHalf + 190);
      T.box(sc, (a + b) / 2, deck + 24, 290, 48, b - a - 46, M.glass);
      T.box(sc, (a + b) / 2, deck + 52, 304, 8, b - a - 34, M.steel);
      f.fx(GAIN.warm, PB_FX.steady);
      T.box(sc, (a + b) / 2, deck + 14, 296, 6, b - a - 40, M.warm);
      f.nofx();
    }
    f.set = 'bg';
    spire(T, f, side * 2020, 3700, 96, 11 + side);
    f.set = 'fg';
    // zejście z kładki pasażerskiej (z przejścia w ringu) do galerii pirsu: przeszklony trzon wind
    T.box(sg, 3790, deck + 150, 200, 300, 110, M.steel);
    T.box(sg, 3790, deck + 170, 208, 180, 80, M.glass);
    f.fx(GAIN.warm, PB_FX.steady);
    T.box(sg, 3790, deck + 60, 210, 10, 116, M.warm);
    f.nofx();
    // pas techniczny za galerią (od strony skrzydła): latarnie
    for (let v = 3900; v < 5900; v += 400) {
      const p = yardPoint(side * 2590, v);
      lampPost(f, p[0], p[1], deck, M.warm);
    }
  }

  // --- hala odlotów i przylotów: dwie nawy ze szklanym sklepieniem i rotunda w osi
  const vm = (Hl.v0 + Hl.v1) / 2;
  const wd = Hl.v1 - Hl.v0;
  for (const side of [-1, 1]) {
    const a = side * 430;
    const b = side * Hl.half;
    const cuts = 3;
    for (let i = 0; i < cuts; i++) {
      gallery(f, yardPoint(a + ((b - a) * i) / cuts, vm), yardPoint(a + ((b - a) * (i + 1)) / cuts, vm), wd, deck,
        { eave: Hl.eave, ridge: Hl.top, bay: 136, profile: 'arch', open: 3, phase: i, seed: 70 + i + side * 5, green: false });
    }
    // szczyt nawy (ściana czołowa) ze szkłem
    T.box(b, vm, deck + Hl.eave / 2, 14, Hl.eave, wd, M.steel);
    T.box(b, vm, deck + Hl.eave + 120, 14, 240, wd * 0.62, M.steel);
    T.box(b + (side * 6) / ringScale(vm), vm, deck + Hl.eave + 60, 8, 260, wd * 0.5, M.glass);
    // posadzka hali widoczna przez otwarte przęsła: jasna, z ciepłym światłem i zielenią w donicach
    const s0 = Math.min(a, b);
    const s1 = Math.max(a, b);
    T.run(s0, s1, vm, deck + 3, 5, wd - 30, M.steel, 420, 1.0);
    f.fx(GAIN.warm * 0.9, PB_FX.steady);
    T.run(s0 + 20, s1 - 20, vm - wd * 0.2, deck + 8, 5, 26, M.warm, 420, 1.0);
    T.run(s0 + 20, s1 - 20, vm + wd * 0.2, deck + 8, 5, 26, M.warm, 420, 1.0);
    f.nofx();
    for (let i = 0; i < 7; i++) {
      const p = yardPoint(s0 + ((s1 - s0) * (i + 0.5)) / 7, vm + (i % 2 ? 60 : -60));
      tree(f, p[0], p[1], deck + 8, 26, 300 + i + side);
    }
    // fasada od placu: szkło na całą wysokość okapu, dwa pasy ciepłego światła, pilastry
    T.run(s0, s1, Hl.v0 - 6, deck + Hl.eave / 2 + 6, Hl.eave - 24, 8, M.glass, 300, 1.0);
    f.fx(GAIN.warm, PB_FX.steady);
    T.run(s0 + 10, s1 - 10, Hl.v0 - 11, deck + 60, 9, 5, M.warm, 300, 0.96);
    T.run(s0 + 10, s1 - 10, Hl.v0 - 11, deck + 125, 9, 5, M.warm, 300, 0.96);
    T.run(s0 + 10, s1 - 10, Hl.v0 - 11, deck + 190, 9, 5, M.warm, 300, 0.96);
    f.nofx();
    const np = Math.round(((s1 - s0) * ringScale(Hl.v0)) / 150);
    for (let i = 0; i <= np; i++) T.box(s0 + ((s1 - s0) * i) / np, Hl.v0 - 10, deck + Hl.eave / 2, 12, Hl.eave, 14, M.steel);
    // okap nad peronem rękawów (na słupach)
    T.run(s0, s1, Hl.v0 - 90, deck + 176, 8, 170, M.steel, 300, 1.0);
    T.run(s0, s1, Hl.v0 - 172, deck + 182, 6, 10, M.yellow, 300, 1.0);
    for (let i = 0; i <= 5; i++) T.cyl(s0 + ((s1 - s0) * i) / 5, Hl.v0 - 160, deck + 88, 7, 176, M.rail);
    // ściana zewnętrzna hali (od przestrzeni): okna
    faceWindows(T, f, s0 + 20, s1 - 20, Hl.v1 + 6, 1, 90 + side, [deck + 60, deck + 125, deck + 190]);
  }
  // rotunda: bęben ze szklanym pasem, kopuła, portal ku placowi
  {
    const [x, z] = yardPoint(0, vm);
    f.cyl(x, deck + 230, z, 440, 460, M.steel);
    f.cyl(x, deck + 300, z, 446, 200, M.glass);
    f.fx(GAIN.warm, PB_FX.steady);
    f.cyl(x, deck + 150, z, 448, 10, M.warm);
    f.cyl(x, deck + 250, z, 448, 10, M.warm);
    f.cyl(x, deck + 350, z, 448, 10, M.warm);
    f.nofx();
    f.cyl(x, deck + 466, z, 456, 12, M.rail);
    dome(f, x, z, 420, deck + 472, 560, { meridians: 16, rings: 3, glass: 1, beam: 9, seed: 5 });
    T.box(0, Hl.v0 - 60, deck + 110, 420, 220, 190, M.steel);
    T.box(0, Hl.v0 - 158, deck + 96, 300, 150, 10, M.glass);
    f.fx(GAIN.cold + 0.3, PB_FX.steady);
    T.box(0, Hl.v0 - 160, deck + 200, 330, 16, 8, M.cyan);
    f.nofx();
    T.box(0, Hl.v0 - 60, deck + 226, 440, 12, 210, M.rail);
  }
  // rękawy od fasady hali do stanowisk
  for (const pit of layout.pits) {
    if (pit.zone !== 'DW' || pit.orient !== 'arc') continue;
    const from = Math.abs(pit.sc) < 200 ? Hl.v0 - 160 : Hl.v0 - 14;
    sleeve(f, yardPoint(pit.sc, from), yardPoint(pit.sc, pit.v1 + 26), deck, { wid: pit.cls === 'l' ? 70 : 58 });
    // poczekalnie przy stanowiskach (na pokładzie między rękawami)
  }
  for (const sc of [-1560, -960, -380, 380, 960, 1560]) {
    T.box(sc, 6470, deck + 22, 150, 44, 520, M.glass);
    T.box(sc, 6470, deck + 48, 162, 8, 534, M.steel);
    f.fx(GAIN.warm, PB_FX.steady);
    T.box(sc, 6470, deck + 12, 156, 6, 526, M.warm);
    f.nofx();
  }
  T.label('ODLOTY', -1020, 7080, 520, 110, style.labels.terminal, 'HALA ZACHODNIA', deck + 4, 'fg');
  T.label('PRZYLOTY', 1020, 7080, 520, 110, style.labels.terminal, 'HALA WSCHODNIA', deck + 4, 'fg');

  // --- naroża: zaplecze hali (bagaż, służby) i biurowiec przewoźników
  for (const side of [-1, 1]) {
    const sc = side * 2200;
    annex(T, f, sc, 6420, 820, 640, 240, 200 + side, deck);
    tower(T, f, sc, 7330, 520, 600, 760, 210 + side * 3, { y0: deck, tiers: 2, shift: 1, green: false });
    annex(T, f, sc, 8130, 800, 520, 180, 220 + side, deck);
    // łącznik hali z narożem
    T.box(side * 1700, vm, deck + 150, 150, 300, 420, M.steel);
    T.box(side * 1700, vm, deck + 200, 156, 80, 300, M.glass);
  }

  // --- apsyda: wieża kontroli ruchu, budynek służb, anteny
  const tw = controlTower(T, f, DW.tower.s, DW.tower.v, 1);
  annex(T, f, -520, 8760, 420, 360, 170, 231, deck);
  annex(T, f, 520, 8760, 420, 360, 170, 232, deck);
  for (const [ds, dv] of [[-330, 9230], [330, 9230], [0, 9310]]) {
    const p = yardPoint(ds, dv);
    f.cyl(p[0], deck + 26, p[1], 6, 52, M.rail);
    f.cyl(p[0], deck + 56, p[1], 44, 8, M.steel);
    f.cyl(p[0], deck + 62, p[1], 30, 5, M.rail);
  }
  T.label('KONTROLA RUCHU', 0, 8640, 520, 80, style.labels.control, 'WIEŻA DWORCA', deck + 4, 'fg');

  // --- skrzydło zachodnie: BIURO KONTRAKTÓW (KADRY) — rotunda na cokole z pomarańczowym pasem, szyld na dachu
  {
    const sc = -3075;
    T.box(sc, 4230, deck + 85, 800, 170, 1060, M.steel);
    T.box(sc, 4230, deck + 150, 812, 22, 1072, M.orange);
    T.box(sc, 4230, deck + 176, 780, 8, 1040, M.rail);
    faceWindows(T, f, sc - 330, sc + 330, 3700, -1, 301, [deck + 50, deck + 105]);
    const [x, z] = yardPoint(sc, 4470);
    roundTower(f, x, z, 230, 1400, 303, { y0: deck + 180, body: M.steel });
    f.fx(GAIN.cold + 0.35, PB_FX.steady);
    f.cyl(x, deck + 180 + 1340, z, 238, 14, M.cyan);
    f.cyl(x, deck + 196, z, 250, 8, M.cyan);
    f.nofx();
    // szyld: rama ze światłem wokół napisu na dachu cokołu
    const ly = deck + 184;
    T.label('KADRY', sc, 3910, 560, 150, style.labels.gate, 'BIURO KONTRAKTÓW', ly, 'fg');
    f.fx(GAIN.cold + 0.35, PB_FX.steady);
    for (const dv of [-100, 100]) T.box(sc, 3910 + dv, ly + 3, 640, 5, 7, M.cyan);
    for (const ds of [-1, 1]) T.box(sc + (ds * 320) / ringScale(3910), 3910, ly + 3, 7, 5, 200, M.cyan);
    f.nofx();
    // podcień od drogi (żółty akcent) i latarnie
    T.box(sc, 3668, deck + 70, 520, 8, 110, M.yellow);
    for (const ds of [-240, 240]) T.cyl(sc + ds / ringScale(3640), 3622, deck + 34, 6, 68, M.rail);
    // za biurem: archiwum i zaplecze kontraktów, biurowiec przewoźników, zbiorniki paliwa promów
    annex(T, f, sc, 5300, 760, 620, 260, 310, deck);
    tower(T, f, sc, 6130, 640, 320, 900, 311, { y0: deck, tiers: 2, green: false });
    annex(T, f, sc, 6900, 760, 520, 230, 312, deck);
    tanks(T, f, sc, 7480, 3, deck);
    annex(T, f, sc, 8200, 760, 420, 170, 313, deck);
    // plac przed biurem: pierścień wokół rotundy i latarnie
    {
      const [px, pz] = yardPoint(sc, 4470);
      hoop(f, px, pz, 300, deck + 186, 3, 12, M.pale, 28);
      for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        lampPost(f, px + Math.cos(a) * 350, pz + Math.sin(a) * 350, deck + 184, i % 2 ? M.white : M.warm);
      }
    }
  }
  // --- skrzydło wschodnie: ODPRAWA — hala odpraw i kontroli medycznej, bagaż, biurowiec, zbiorniki
  {
    const sc = 3075;
    T.box(sc, 4230, deck + 60, 800, 120, 1060, M.steel);
    T.box(sc, 4230, deck + 124, 780, 8, 1040, M.rail);
    faceWindows(T, f, sc - 330, sc + 330, 3700, -1, 321, [deck + 40, deck + 90]);
    // hala odpraw: szklana nawa wzdłuż skrzydła na cokole
    gallery(f, yardPoint(sc, 4040), yardPoint(sc, 4740), 520, deck + 128, { eave: 120, ridge: 330, bay: 130, profile: 'arch', open: 3, green: false, seed: 322 });
    f.fx(GAIN.warm * 0.9, PB_FX.steady);
    for (const ds of [-110, 110]) T.box(sc + ds / ringScale(4400), 4390, deck + 136, 26, 5, 640, M.warm);
    f.nofx();
    T.label('ODPRAWA', sc, 3850, 520, 120, style.labels.terminal, 'KONTROLA MEDYCZNA · BAGAŻ', deck + 132, 'fg');
    annex(T, f, sc, 5300, 760, 620, 260, 324, deck);
    {
      const [x, z] = yardPoint(sc, 6130);
      roundTower(f, x, z, 220, 760, 325, { y0: deck, body: M.dark });
    }
    annex(T, f, sc, 6900, 760, 520, 230, 326, deck);
    tanks(T, f, sc, 7480, 3, deck);
    annex(T, f, sc, 8200, 760, 420, 170, 327, deck);
  }
  // listwy na koronie lica zewnętrznego dworca (od przestrzeni)
  for (const [a, b] of [[-DW.termHalf + 30, -DW.apse.half0 - 30], [DW.apse.half0 + 30, DW.termHalf - 30]]) {
    for (let s = a; s < b; s += 640) faceWindows(T, f, s, Math.min(b, s + 620), DW.backV1, 1, s * 0.031, [150, 205]);
  }
  f.fx(0.8, PB_FX.steady);
  T.run(-DW.termHalf + 30, -DW.apse.half0 - 30, DW.backV1 - 12, deck + 10, 5, 6, M.cyan, 420, 1.0);
  T.run(DW.apse.half0 + 30, DW.termHalf - 30, DW.backV1 - 12, deck + 10, 5, 6, M.cyan, 420, 1.0);
  f.nofx();
  f.set = 'bg';

  pushLamp(lamps, 0, 4700, 340, 1);
  pushLamp(lamps, 0, 5650, 340, 1);
  pushLamp(lamps, -1250, 4500, 340, 1);
  pushLamp(lamps, 1250, 4500, 340, 1);
  pushLamp(lamps, -900, 7050, 420, 1);
  pushLamp(lamps, 900, 7050, 420, 1);
  pushLamp(lamps, -3075, 3900, 520, 2);
  pushLamp(lamps, 0, 8800, 520, 2);
  return sceneOf(f, plates, labels, lamps, { status, radar: { group: 1, x: tw.x, z: tw.z } });
}
