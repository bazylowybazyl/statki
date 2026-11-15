// HUTA — fizyczna ruda: stałe ziarna i tabela pięciu rud (czyste dane, bez three i DOM).
//
// Ziarno ma stałą masę 1/128 t (dokładną w zapisie dwójkowym): statek 360 t = 46 080 ziaren, paczka 1,5 t = 192,
// zasiek 900 t = 115 200. Średnica 6 j., komórka kraty 6 × 6 j., warstwa kolumny 5,1 j. (upakowanie gęstsze niż
// średnica). Tabela rudy zmienia FIZYKĘ, nie tylko barwę: kąt usypu (reguła stateczności kraty + tarcie ciał),
// sprężystość, rozrzut i prędkość wylotu, wielkość ziarna w rysunku, ilość pyłu.
//
// Pola fizyki rudy:
//   angle      — kąt usypu kopca usypanego strugą ciał [°] (cel; test mierzy kopiec i wymaga angle ± 3°)
//   ruleAngle  — kąt graniczny reguły stateczności kraty [°] (statyczny: ściany leja i krateru). Ciała toczą się
//                kawałek dalej (ziarno z lotu odbija się albo ślizga, klinuje się dopiero tocząc), więc kopiec z wylotu
//                wychodzi o 4,5–8° płytszy — `ruleAngle` jest STROJONY POMIAREM (kopiec z jednego statku, 16 kierunków:
//                `.tmp/huta/ruda/poprawki/katy.mjs`), żeby zmierzony kąt trafił w `angle`
//   fric       — tarcie ciała w ślizgu i toczeniu = tg(ruleAngle): na stoku granicznym ziarno nie zwalnia ani nie
//                przyspiesza, na łagodniejszym staje
//   fricHit    — tarcie w odbiciu (im mniejsze, tym dalej pryska odbite ziarno), rest — sprężystość odbicia
//   settleSpeed, nudge — próg spoczynku i rozpęd osypiska [j./s]; knockSpeed — próg wybicia ziarna z kopca
//   spoutSpeed, spoutSpread, spoutSwing — prędkość strugi [j./s], półkąt stożka rozrzutu [°], wahanie klapy [°]
//   grainScale — wielkość bryłki w rysunku; dust — ilość pyłu 0…1

export const GRAIN = Object.freeze({
  perTon: 128,            // ziaren na tonę
  d: 6,                   // średnica [j.]
  r: 3,                   // promień [j.]
  cell: 6,                // bok komórki kraty [j.]
  layer: 5.1              // wysokość warstwy kolumny [j.]
});

export const tonsToGrains = (t) => Math.round(t * GRAIN.perTon);
export const grainsToTons = (n) => n / GRAIN.perTon;

/**
 * Bajt cech ziarna (ten sam bajt jedzie z ładowni przez rurę i lot do kopca i na taśmę):
 *   bity 0–2  odcień (0…7; środek 3–4, partia statku przesuwa środek — w kopcu widać warstwy dostaw)
 *   bity 3–4  wariant kształtu bryłki (0…3)
 *   bity 5–6  skala (0…3 → 0,74 / 0,9 / 1,04 / 1,2 × `grainScale` rudy); kształt 3 ze skalą 3 (ok. 6 % ziaren) to
 *             BRYŁA × 1,5 — w stosie widać pojedyncze większe kawały, nie worek jednakowych kostek
 *   bit  7    żyłka z połyskiem (ok. 3 % ziaren)
 */
export const TRAIT = Object.freeze({ hueMask: 7, shapeShift: 3, shapeMask: 3, scaleShift: 5, scaleMask: 3, vein: 128 });
export const TRAIT_SCALES = Object.freeze([0.74, 0.9, 1.04, 1.2]);
export const TRAIT_BIG = 1.5;
/** Promień bryłki w rysunku przy skali 1 [j.] (× skala z cech × `grainScale` rudy). */
export const GRAIN_DRAW_R = 3.55;
/** Największy promień bryłki rudy w rysunku [j.] — tyle miejsca ziarno potrzebuje w świetle rury i w klatce dzwonu. */
export const grainHalfMax = (o) => GRAIN_DRAW_R * o.grainScale * TRAIT_BIG;

/** Bajt cech z haszu `h` (32 bity) i przesunięcia odcienia partii `tint` (−2…2). */
export function traitFromHash(h, tint) {
  // odcień: suma dwóch kostek 0…3 daje rozkład trójkątny wokół 3 — skrajne odcienie rzadziej
  let hue = (h & 3) + ((h >>> 2) & 3) + tint;
  if (hue < 0) hue = 0; else if (hue > 7) hue = 7;
  const shape = (h >>> 4) & 3;
  const scale = (h >>> 6) & 3;
  const vein = ((h >>> 8) & 255) < 8 ? 128 : 0;          // 8 / 256 ≈ 3,1 %
  return hue | (shape << 3) | (scale << 5) | vein;
}

// Barwy liniowe [r, g, b] — rozjaśnione względem `oreColor` huty (tam kopiec po × 0,45 był ciemną plamą), pod progiem
// bloomu (luminancja < 0,9 także dla żyłek). `shades` — od najciemniejszego do najjaśniejszego odcienia (rysunek
// interpoluje po 8 poziomach odcienia), `vein` — ziarna-żyłki, `dust` — kłęby pyłu.
function ore(def) { return Object.freeze({ ...def, shades: Object.freeze(def.shades.map((s) => Object.freeze(s))) }); }

export const ORES = Object.freeze([
  ore({
    index: 0, id: 'zelazo', lane: 'stal', res: 'iron_ore', name: 'RUDA ŻELAZA',
    // grudki hematytu: ciężkie, średnio sypkie, rdzawy pył
    angle: 35, ruleAngle: 39.6, fric: 0.827, fricHit: 0.8, rest: 0.2, settleSpeed: 16, nudge: 80,
    spoutSpeed: 300, spoutSpread: 7, spoutSwing: 6, grainScale: 1.0, dust: 0.6, knockSpeed: 170,
    initialStock: 470,
    shades: [[0.3, 0.1, 0.055], [0.5, 0.185, 0.1], [0.66, 0.3, 0.17]],
    vein: [0.62, 0.6, 0.58], sheen: 0.55, dustColor: [0.52, 0.3, 0.22]
  }),
  ore({
    index: 1, id: 'miedz', lane: 'miedz', res: 'copper_ore', name: 'RUDA MIEDZI',
    // kanciaste bryły malachitu i chalkopirytu: zazębiają się, stromy kopiec, mało pyłu
    angle: 38, ruleAngle: 43.5, fric: 0.949, fricHit: 0.85, rest: 0.16, settleSpeed: 18, nudge: 80,
    spoutSpeed: 290, spoutSpread: 9, spoutSwing: 6, grainScale: 1.1, dust: 0.4, knockSpeed: 180,
    initialStock: 430,
    shades: [[0.07, 0.25, 0.17], [0.14, 0.42, 0.29], [0.26, 0.58, 0.42]],
    vein: [0.86, 0.43, 0.18], sheen: 0.7, dustColor: [0.3, 0.46, 0.38]
  }),
  ore({
    index: 2, id: 'glin', lane: 'glin', res: 'aluminum_ore', name: 'RUDA GLINU',
    // boksyt: gliniasty, „martwy” (prawie bez odbicia), najstromszy kopiec, dużo ochrowego pyłu
    angle: 40, ruleAngle: 44.2, fric: 0.972, fricHit: 0.9, rest: 0.08, settleSpeed: 20, nudge: 80,
    spoutSpeed: 275, spoutSpread: 6, spoutSwing: 5, grainScale: 0.95, dust: 1.0, knockSpeed: 200,
    initialStock: 380,
    shades: [[0.4, 0.22, 0.08], [0.62, 0.39, 0.16], [0.78, 0.56, 0.28]],
    vein: [0.82, 0.76, 0.64], sheen: 0.25, dustColor: [0.68, 0.5, 0.3]
  }),
  ore({
    index: 3, id: 'tytan', lane: 'tytan', res: 'titanium_ore', name: 'RUDA TYTANU',
    // drobny ilmenit: sypki jak piasek, żywe odbicia, płaski kopiec i szeroki wachlarz z wylotu
    angle: 30, ruleAngle: 38.2, fric: 0.787, fricHit: 0.7, rest: 0.3, settleSpeed: 14, nudge: 80,
    spoutSpeed: 320, spoutSpread: 11, spoutSwing: 7, grainScale: 0.85, dust: 0.3, knockSpeed: 150,
    initialStock: 420,
    shades: [[0.17, 0.13, 0.3], [0.3, 0.24, 0.47], [0.45, 0.39, 0.64]],
    vein: [0.7, 0.74, 0.9], sheen: 0.8, dustColor: [0.42, 0.38, 0.56]
  }),
  ore({
    index: 4, id: 'weglista', lane: 'ceramika', res: 'carbon_ore', name: 'RUDA WĘGLISTA',
    // lekka i krucha: najszerszy rozrzut z wylotu, kruszy się przy uderzeniu (odbija słabiej niż tytan), chmury ciemnego pyłu
    angle: 33, ruleAngle: 38.9, fric: 0.807, fricHit: 0.88, rest: 0.18, settleSpeed: 15, nudge: 80,
    spoutSpeed: 305, spoutSpread: 12, spoutSwing: 7, grainScale: 1.05, dust: 0.9, knockSpeed: 160,
    initialStock: 300,
    // grafit z chłodnym odcieniem (czarna ruda z góry była plamą z białym szumem połysku — bryłę kopca ma dawać cień, nie iskry)
    shades: [[0.062, 0.066, 0.08], [0.125, 0.134, 0.16], [0.215, 0.23, 0.27]],
    vein: [0.3, 0.32, 0.38], sheen: 0.4, dustColor: [0.15, 0.155, 0.18]
  })
]);

/** Pasmo kąta usypu rudy [°]: `angle` ± 3 (test mierzy kopiec usypany ciałami). */
export const angleBand = (o) => [o.angle - 3, o.angle + 3];

export function oreOf(which) {
  if (typeof which === 'number') return ORES[Math.max(0, Math.min(ORES.length - 1, which | 0))];
  if (typeof which === 'string') { const o = ORES.find((q) => q.id === which || q.lane === which || q.res === which); if (o) return o; }
  if (which && typeof which === 'object' && which.id) return which;
  return ORES[0];
}
