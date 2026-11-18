// HUTA — wytop: tabela metali (czyste dane, bez three i DOM).
//
// Metal zmienia BARWĘ żaru (rampa temperatury), żużla, iskier i światła rzucanego na komorę — liczby procesu (masy,
// receptura 3 rudy → 2 metalu, czasy) są wspólne. Budowa pod pięć metali huty; dziś pełne są dwa (`gotowy`), pozostałe
// trzy mają miejsce w tabeli i barwy robocze.
//
// Barwy liniowe [r, g, b]. Rampa żaru jak w `kit/tworzywo3d.js`: kanał ZIELONY trzymany nisko — po ACES wyższy daje
// żółto-białą plamę zamiast pomarańczu; jasność ustala obraz (limit luminancji), tu jest tylko barwa.
//   ramp[0]  ledwie świeci: ciemna wiśnia (stygnąca kra, ziarno na granicy 0 g, strefa wsadu) — temperatura 0,35
//   ramp[1]  czerwony pomarańcz — 0,6 (najchłodniejsza kula w obiegu)
//   ramp[2]  pomarańcz ciekłego metalu — 0,9
//   ramp[3]  żółty: najgorętsze miejsca (środek komórki konwekcji, pas cewek, menisk, błysk wtopienia) — 1,2;
//            z jasnością ponad próg poświaty wychodzi po ACES żółto-biało (wzór użytkownika: jasny rdzeń, czerwone brzegi)
//   limb     domieszka barwy przy brzegu tarczy (miedź: zielonkawy płomyk)
//   slag     żużel zimny (matowy), slagHot — świeża kra
//   light    barwa światła kuli na ścianach i dnie komory
//   ore      indeks rudy w `ruda/rudy.js` (te same bryłki co w demie rudy)
//   split    podział ziarna rudy na [metal, żużel, gaz] w jednostkach 1/1536 t (ziarno 1/128 t = 12 jednostek; metal
//            zawsze 8 = 2/3 — receptura ekonomii 3 rudy → 2 metalu bez zmian). Stal 8 / 2 / 2 (gaz 16,7 %: ruda żelaza
//            ma ~30 % tlenu — połowa wychodzi gazem, resztę wiąże żużel), miedź 8 / 3 / 1 (ruda tlenkowa miedzi ma mniej
//            tlenu: miedź dymi wyraźnie mniej). Gaz to tlen z rudy (produkt: zbiorniki na pokładzie)
//   gasSmoke barwa składnika `dym` gazu (pył i para z rudy: odcień rudy przygaszony), gasFume — `opar` (mgiełka oparów
//            metalu i tlenu)

const freeze = (m) => Object.freeze({ ...m, ramp: Object.freeze(m.ramp.map((c) => Object.freeze(c))), split: Object.freeze(m.split || [8, 2, 2]) });

export const METALE = Object.freeze([
  freeze({
    index: 0, id: 'stal', name: 'STAL', oreName: 'ruda żelaza', ore: 0, gotowy: true,
    ramp: [[0.4, 0.028, 0.006], [0.95, 0.1, 0.01], [1.0, 0.21, 0.015], [1.0, 0.5, 0.11]],
    limb: [1.0, 0.05, 0.0], limbGain: 0.0,
    slag: [0.15, 0.12, 0.1], slagHot: [0.5, 0.05, 0.01],
    spark: [1.0, 0.5, 0.14], light: [1.0, 0.3, 0.06],
    split: [8, 2, 2], gasSmoke: [0.17, 0.1, 0.06], gasFume: [0.92, 0.94, 1.0]
  }),
  freeze({
    index: 1, id: 'miedz', name: 'MIEDŹ', oreName: 'ruda miedzi', ore: 1, gotowy: true,
    // miedź: jasny pomarańcz-żółty (złocisty), bez różu; brzeg tarczy, poświata i iskry z zielonkawym odcieniem
    // (barwa płomienia miedzi), żużel ciemny, zielonkawy
    ramp: [[0.34, 0.04, 0.012], [0.85, 0.17, 0.016], [0.95, 0.38, 0.03], [0.82, 0.5, 0.14]],
    limb: [0.1, 0.9, 0.3], limbGain: 0.5,
    slag: [0.045, 0.085, 0.07], slagHot: [0.3, 0.09, 0.04],
    spark: [0.4, 1.0, 0.42], light: [0.82, 0.46, 0.1],
    split: [8, 3, 1], gasSmoke: [0.085, 0.11, 0.1], gasFume: [0.75, 1.0, 0.85]
  }),
  freeze({
    index: 2, id: 'glin', name: 'GLIN', oreName: 'ruda glinu', ore: 2, gotowy: false,
    ramp: [[0.36, 0.02, 0.01], [0.9, 0.1, 0.03], [1.0, 0.26, 0.09], [1.0, 0.42, 0.2]],
    limb: [1.0, 0.3, 0.1], limbGain: 0.0,
    slag: [0.2, 0.17, 0.13], slagHot: [0.45, 0.08, 0.02],
    spark: [1.0, 0.6, 0.3], light: [1.0, 0.36, 0.14],
    split: [8, 2, 2], gasSmoke: [0.12, 0.11, 0.1], gasFume: [0.92, 0.94, 1.0]
  }),
  freeze({
    index: 3, id: 'tytan', name: 'TYTAN', oreName: 'ruda tytanu', ore: 3, gotowy: false,
    ramp: [[0.3, 0.02, 0.06], [0.85, 0.1, 0.12], [1.0, 0.3, 0.22], [1.0, 0.5, 0.42]],
    limb: [0.5, 0.5, 1.0], limbGain: 0.3,
    slag: [0.09, 0.09, 0.13], slagHot: [0.4, 0.08, 0.08],
    spark: [0.8, 0.8, 1.0], light: [1.0, 0.4, 0.3],
    split: [8, 2, 2], gasSmoke: [0.1, 0.1, 0.11], gasFume: [0.92, 0.94, 1.0]
  }),
  freeze({
    index: 4, id: 'ceramika', name: 'CERAMIKA', oreName: 'ruda węglista', ore: 4, gotowy: false,
    ramp: [[0.4, 0.015, 0.0], [0.95, 0.09, 0.0], [1.0, 0.24, 0.02], [1.0, 0.44, 0.1]],
    limb: [1.0, 0.1, 0.0], limbGain: 0.0,
    slag: [0.05, 0.05, 0.055], slagHot: [0.45, 0.06, 0.01],
    spark: [1.0, 0.5, 0.12], light: [1.0, 0.32, 0.07],
    split: [8, 2, 2], gasSmoke: [0.08, 0.08, 0.08], gasFume: [0.92, 0.94, 1.0]
  })
]);

export function metalOf(which) {
  if (typeof which === 'number') return METALE[Math.max(0, Math.min(METALE.length - 1, which | 0))];
  if (typeof which === 'string') { const m = METALE.find((q) => q.id === which); if (m) return m; }
  if (which && typeof which === 'object' && which.id) return which;
  return METALE[0];
}
