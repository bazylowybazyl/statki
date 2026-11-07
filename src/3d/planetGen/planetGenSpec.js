// src/3d/planetGen/planetGenSpec.js
//
// OPIS PLANETY Z ZIARNA (bez GPU; three tylko pośrednio — `profileMinima` z gasGiantAtmosphere.js): `describePlanet({ type, seed, r, ...nadpisania })` daje pełny
// zestaw parametrów — wygląd rodzaju (`look`: ukształtowanie, klimat, paleta, podrodzaj), strojenie materiału gry
// (`surface`: jasność, połysk, bloom — jak DirectPlanet.init), mgiełkę (`haze` — uHazeStrength / Color / Beta grafu
// powierzchni), poświatę (`halo` — powłoka planet tła, `ringAtm` — dysk limbu planet przy ringu), chmury, światła
// nocy, a dla olbrzymów: pasy, wiatr strefowy, wiry i pierścienie. Wypiek (planetGenBaker.js) czyta tylko ten opis —
// ta sama planeta z tego samego ziarna w każdej sesji, w workerze i w Node.
//
// Zmienność z ziarna jest STRUKTURALNA (nie „ta sama planeta w innym kolorze”): podrodzaj (np. lodowa: pęknięta
// skorupa / bruzdy / śnieżka / pręgi), udział oceanu, liczba i kształt płyt, siła gór, klimat (czapy, pasy pustyń),
// gęstość i wiek kraterów, baseny, wulkany, kaniony, liczba pasów i burz. Barwy — z palet podrodzaju z rozrzutem.
//
// Barwy w opisie: LINIOWE rgb (albedo), autorowane w sRGB przez `srgb('#rrggbb')`.
import { PLANET_GEN_TYPE, isPlanetGenType } from './planetGenTypes.js';
import { rngFor } from './planetGenRng.js';
import { profileMinima } from '../gasGiantAtmosphere.js';

/** sRGB (hex albo [0..255]) → liniowe rgb. */
export function srgb(c) {
  const arr = typeof c === 'string'
    ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
    : c;
  return arr.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** Rozrzut barwy: jasność × (1 ± j), odcień — przesunięcie kanałów ± h. */
function jitter(rng, c, j = 0.12, h = 0.06) {
  const k = 1 + (rng.next() * 2 - 1) * j;
  return c.map((v) => Math.max(0, v * k * (1 + (rng.next() * 2 - 1) * h)));
}
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// Częstość komórek płyt dla ~n płyt na kuli (komórki kraty 3D przecinające kulę jednostkową: ~ 4,6 · f²).
const plateFreq = (n) => Math.sqrt(n / 4.6);

// ── Strojenie materiału gry (DirectPlanet.init dla planet bez nazwy w Układzie Słonecznym) ─────────────────────────
const SURFACE_DEFAULT = Object.freeze({ bright: 1.0, sunInt: 1.1, specular: 0.0, bloom: 0.2 });

// ── Rodzaje ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const VEGETATION = {
  // [las równikowy, las umiarkowany, tajga, step / sawanna, tundra]
  zielona: ['#1d3a12', '#2b4a1c', '#1c2e1a', '#6f6a3a', '#5a5a48'],
  morska: ['#123a34', '#1d4a40', '#183230', '#5d6a48', '#4f5a52'],
  oliwkowa: ['#3a4316', '#4d5222', '#2f3a1e', '#857a45', '#625e4a'],
  rdzawa: ['#4a2416', '#5a3420', '#3a2a22', '#8a6440', '#5e5248']
};

function lookTerran(rng) {
  const water = rng.range(0.52, 0.8);
  const veg = rng.weighted([['zielona', 0.7], ['morska', 0.1], ['oliwkowa', 0.12], ['rdzawa', 0.08]]);
  const v = VEGETATION[veg].map((h) => jitter(rng, srgb(h), 0.1, 0.05));
  const temp = rng.range(-0.28, 0.22);   // klimat planety: < 0 zimniej (czapy dalej od biegunów), > 0 cieplej
  return {
    water,
    plateFreq: plateFreq(rng.int(10, 26)),
    contFreq: rng.range(0.9, 1.7),
    contWarp: rng.range(0.25, 0.65),
    coast: rng.range(0.6, 1.0),            // fraktalność wybrzeży (udział drobnych oktaw kształtu)
    islands: rng.range(0.0, 1.0),          // archipelagi na szelfach
    mountainKm: rng.range(3.0, 8.5),
    mountainFreq: rng.range(2.0, 3.4),
    border: rng.range(0.55, 1.0),          // góry na granicach płyt (1) ↔ rozrzucone (0)
    hillKm: rng.range(0.35, 1.1),
    oceanKm: rng.range(3.6, 6.2),
    ridgeKm: rng.range(0.8, 2.2),          // grzbiety śródoceaniczne
    temp,
    wet: rng.range(0.45, 1.1),             // wilgotność (lasy ↔ stepy)
    axisTilt: rng.range(0, 1),             // rozmycie pasów klimatu (nachylenie osi)
    vegetation: veg,
    palette: {
      rain: v[0], forest: v[1], taiga: v[2], steppe: v[3], tundra: v[4],
      desert: jitter(rng, srgb(rng.pick(['#c8a874', '#d0b07a', '#bf9a66', '#c9a26e'])), 0.08),
      desertRed: jitter(rng, srgb(rng.pick(['#9a5a36', '#a86a40', '#8c5a3e'])), 0.08),
      rock: jitter(rng, srgb(rng.pick(['#5e5650', '#625a4e', '#56524e'])), 0.08),
      snow: srgb('#e8edf2'),
      ice: jitter(rng, srgb('#d6e2ea'), 0.04),
      shallow: jitter(rng, srgb(rng.pick(['#1c5a6a', '#20606a', '#245a62'])), 0.1),
      ocean: jitter(rng, srgb(rng.pick(['#0a1e3a', '#0b2240', '#0a1a34', '#0c2438'])), 0.08),
      deep: jitter(rng, srgb(rng.pick(['#050e22', '#06102a', '#040c1e'])), 0.08)
    }
  };
}

function lookOcean(rng) {
  const water = rng.range(0.92, 0.99);
  const tint = rng.weighted([['granat', 0.5], ['turkus', 0.25], ['zieleń', 0.15], ['ciemny', 0.1]]);
  const OC = {
    granat: ['#0a2042', '#04102a', '#1f6a80'], turkus: ['#0b3a4a', '#05202e', '#2a8a8a'],
    zieleń: ['#0d3a32', '#06221e', '#3a7a5a'], ciemny: ['#071628', '#030a16', '#1a4a5a']
  }[tint];
  return {
    water,
    tint,
    plateFreq: plateFreq(rng.int(14, 30)),
    contFreq: rng.range(1.4, 2.4),
    contWarp: rng.range(0.3, 0.7),
    coast: rng.range(0.5, 0.85),
    islands: rng.range(0.4, 1.0),
    chains: rng.int(2, 7),                 // łańcuchy wysp nad plamami gorąca
    atolls: rng.range(0.2, 1.0),
    mountainKm: rng.range(1.5, 4.0),
    mountainFreq: rng.range(2.4, 3.6),
    border: rng.range(0.3, 0.8),
    hillKm: rng.range(0.3, 0.8),
    oceanKm: rng.range(4.5, 8.0),
    ridgeKm: rng.range(1.2, 2.8),
    temp: rng.range(-0.2, 0.25),
    wet: 1.0,
    axisTilt: rng.range(0, 1),
    vegetation: 'zielona',
    palette: {
      rain: jitter(rng, srgb('#1d3a12')), forest: jitter(rng, srgb('#2b4a1c')), taiga: srgb('#1c2e1a'),
      steppe: srgb('#6f6a3a'), tundra: srgb('#5a5a48'), desert: srgb('#c8b088'), desertRed: srgb('#a8865e'),
      rock: srgb('#4a4640'), snow: srgb('#e8edf2'), ice: srgb('#d4e0ea'),
      shallow: jitter(rng, srgb(OC[2]), 0.1), ocean: jitter(rng, srgb(OC[0]), 0.08), deep: jitter(rng, srgb(OC[1]), 0.08)
    }
  };
}

function lookDesert(rng) {
  const style = rng.weighted([['płowa', 0.4], ['ruda', 0.3], ['biała', 0.12], ['brązowa', 0.18]]);
  const P = {
    płowa: ['#c9a874', '#b08a58', '#8a6a48', '#e0d2b8'],
    ruda: ['#b8703e', '#9a5634', '#6e4430', '#d8c0a0'],
    biała: ['#d8d0bc', '#bdb29a', '#8c8272', '#f0ece4'],
    brązowa: ['#9a7a56', '#7e6246', '#5a4a3a', '#d0c4ac']
  }[style];
  return {
    style,
    water: rng.chance(0.35) ? rng.range(0.005, 0.03) : 0,   // słone jeziora w najgłębszych nieckach
    plateFreq: plateFreq(rng.int(8, 20)),
    contFreq: rng.range(1.0, 1.9),
    contWarp: rng.range(0.3, 0.7),
    erg: rng.range(0.18, 0.5),             // morza wydm w nieckach (ułamek powierzchni)
    duneFreq: rng.range(70, 140),          // gęstość pasm wydm
    duneTurn: rng.range(-0.6, 0.6),        // skręt kierunku wiatru
    mesa: rng.range(0.0, 1.0),             // tarasy płaskowyżów
    mountainKm: rng.range(2.0, 6.5),
    mountainFreq: rng.range(2.2, 3.6),
    border: rng.range(0.4, 0.9),
    hillKm: rng.range(0.4, 1.2),
    craters: rng.range(0.0, 0.5),
    wadi: rng.range(0.0, 1.0),             // suche koryta
    salt: rng.range(0.2, 1.0),             // solniska w nieckach
    palette: {
      sand: jitter(rng, srgb(P[0]), 0.08), sandDark: jitter(rng, srgb(P[1]), 0.08),
      rock: jitter(rng, srgb(P[2]), 0.08), salt: jitter(rng, srgb(P[3]), 0.04),
      ice: srgb('#dfe4e6')
    }
  };
}

function lookRocky(rng) {
  const style = rng.weighted([['rdza', 0.45], ['ochra', 0.2], ['szara', 0.2], ['bazalt', 0.15]]);
  const P = {
    rdza: ['#a8603a', '#5e3426', '#c89060', '#3a2a24'],
    ochra: ['#a8844a', '#5e4a2e', '#c8aa70', '#3a3226'],
    szara: ['#7a7068', '#4a443e', '#9a9086', '#2e2a28'],
    bazalt: ['#5a4a40', '#2e2622', '#7a6656', '#1e1a18']
  }[style];
  return {
    style,
    dichotomyKm: rng.range(0.0, 3.5),
    dichotomyDir: rng.dir(),
    volcanoes: rng.int(0, 4),
    canyon: rng.chance(0.55) ? rng.range(0.5, 1.0) : 0,
    craters: rng.range(0.35, 0.85),
    craterAge: rng.range(0.4, 0.9),        // wiek (zatarcie)
    darkFrac: rng.range(0.15, 0.5),        // ciemne pola bazaltu (plamy albedo jak Syrtis)
    mountainKm: rng.range(1.0, 4.0),
    hillKm: rng.range(0.4, 1.0),
    capDeg: rng.range(2.0, 12.0),          // czapy polarne [° od bieguna]
    palette: {
      dust: jitter(rng, srgb(P[0]), 0.1), basalt: jitter(rng, srgb(P[1]), 0.1),
      bright: jitter(rng, srgb(P[2]), 0.08), dark: jitter(rng, srgb(P[3]), 0.08), ice: srgb('#e4e2dc')
    }
  };
}

function lookIce(rng) {
  const style = rng.weighted([['pęknięta', 0.38], ['bruzdy', 0.22], ['śnieżka', 0.22], ['pręgi', 0.18]]);
  const lin = rng.pick(['#8a4a30', '#9a6a48', '#6a5a52', '#7a4a3e']);
  const base = rng.pick(['#e6e8ea', '#e2dfd6', '#dce6ee', '#e8e2d6']);
  return {
    style,
    lineae: style === 'pęknięta' ? rng.range(0.6, 1.0) : (style === 'pręgi' ? rng.range(0.2, 0.5) : rng.range(0.0, 0.35)),
    chaos: style === 'pęknięta' ? rng.range(0.1, 0.45) : rng.range(0.0, 0.15),
    grooves: style === 'bruzdy' ? rng.range(0.6, 1.0) : rng.range(0.0, 0.2),
    darkTerrain: style === 'bruzdy' ? rng.range(0.35, 0.6) : rng.range(0.0, 0.15),
    stripes: style === 'pręgi' ? rng.range(0.7, 1.0) : 0,
    stripeLat: rng.chance(0.5) ? -1 : 1,
    rock: style === 'śnieżka' ? rng.range(0.25, 0.55) : 0,   // odsłonięte góry spod lodu
    seas: style === 'śnieżka' ? rng.range(0.2, 0.5) : 0,     // zamarznięte morza (gładkie, niebieskie)
    craters: rng.range(0.1, style === 'bruzdy' ? 0.8 : 0.45),
    mountainKm: style === 'śnieżka' ? rng.range(2.0, 6.0) : rng.range(0.3, 1.5),
    palette: {
      ice: jitter(rng, srgb(base), 0.04, 0.03), iceBlue: jitter(rng, srgb(rng.pick(['#a8c4d8', '#b8d0de', '#9cbcd2'])), 0.06),
      lineae: jitter(rng, srgb(lin), 0.1), dark: jitter(rng, srgb(rng.pick(['#6a645c', '#5a5650', '#74685a'])), 0.08),
      rock: jitter(rng, srgb(rng.pick(['#4a4642', '#544c44'])), 0.08), frost: srgb('#f4f6f8')
    }
  };
}

function lookVolcanic(rng) {
  const style = rng.weighted([['siarka', 0.4], ['lawa', 0.35], ['popiół', 0.25]]);
  return {
    style,
    paterae: style === 'siarka' ? rng.range(0.5, 1.0) : rng.range(0.3, 0.8),   // kaldery (gęstość)
    flows: rng.range(0.3, 1.0),            // potoki lawy
    lava: style === 'lawa' ? rng.range(0.5, 1.0) : (style === 'popiół' ? rng.range(0.1, 0.35) : rng.range(0.05, 0.2)),
    plumes: style === 'siarka' ? rng.range(0.4, 1.0) : 0,   // pierścienie opadu pióropuszy
    mountainKm: rng.range(1.5, 6.0),
    craters: style === 'popiół' ? rng.range(0.0, 0.3) : 0,
    palette: style === 'siarka' ? {
      base: jitter(rng, srgb(rng.pick(['#c8b060', '#d0b86a', '#c0a050'])), 0.08), second: jitter(rng, srgb('#b87838'), 0.1),
      bright: jitter(rng, srgb('#e8e4c8'), 0.05), dark: srgb('#2a1e16'), red: jitter(rng, srgb('#9a3a20'), 0.1),
      lava: srgb('#ff7a1e')
    } : style === 'lawa' ? {
      base: jitter(rng, srgb('#2a2422'), 0.15), second: jitter(rng, srgb('#3e2a22'), 0.1), bright: srgb('#5a4a42'),
      dark: srgb('#120e0c'), red: jitter(rng, srgb('#6a2414'), 0.1), lava: srgb(rng.pick(['#ff6a10', '#ff8a24', '#ff5408']))
    } : {
      base: jitter(rng, srgb(rng.pick(['#5a5650', '#4e4a46', '#62584e'])), 0.1), second: jitter(rng, srgb('#3a3632'), 0.1),
      bright: srgb('#8a847a'), dark: srgb('#1e1c1a'), red: srgb('#6a3a26'), lava: srgb('#ff6a18')
    }
  };
}

function lookBarren(rng) {
  const style = rng.weighted([['księżyc', 0.35], ['merkury', 0.3], ['kallisto', 0.2], ['ciemna', 0.15]]);
  const P = {
    księżyc: ['#76746e', '#4e4d4e', '#a8a6a0'],
    merkury: ['#6e665c', '#5a544c', '#9c9488'],
    kallisto: ['#4a4440', '#3a3634', '#9c988e'],
    ciemna: ['#3a3634', '#2a2826', '#7a746a']
  }[style];
  return {
    style,
    craters: rng.range(0.6, 1.0),          // gęstość (nasycenie)
    basins: rng.int(style === 'księżyc' ? 2 : 0, style === 'kallisto' ? 2 : 6),
    maria: style === 'księżyc' ? rng.range(0.5, 1.0) : (style === 'merkury' ? rng.range(0.1, 0.4) : rng.range(0.0, 0.15)),
    fresh: rng.range(0.03, 0.12),          // ułamek świeżych kraterów (jasny wyrzut, promienie)
    scarps: style === 'merkury' ? rng.range(0.4, 1.0) : rng.range(0.0, 0.3),
    reliefKm: rng.range(2.0, 5.0),
    palette: {
      high: jitter(rng, srgb(P[0]), 0.1, 0.04), mare: jitter(rng, srgb(P[1]), 0.1, 0.05), fresh: jitter(rng, srgb(P[2]), 0.06, 0.03)
    }
  };
}

function lookToxic(rng) {
  const style = rng.weighted([['wenus', 0.45], ['tytan', 0.25], ['chlor', 0.15], ['smog', 0.15]]);
  const P = {
    wenus: ['#e8dcb4', '#c8b88a', '#f4ecd2'],
    tytan: ['#c8884a', '#9a6030', '#d8a468'],
    chlor: ['#c8d090', '#9aa868', '#e0e4b8'],
    smog: ['#a89478', '#7a6a58', '#c8b89c']
  }[style];
  return {
    style,
    bands: rng.range(0.45, 1.0),           // pasma chmur (kontrast smug pokładu)
    swirl: rng.range(0.3, 1.0),            // kształt „Y” i kołnierze polarne
    cover: rng.range(0.88, 0.98),
    surfaceKm: rng.range(1.5, 4.5),
    palette: {
      cloud: jitter(rng, srgb(P[0]), 0.04, 0.03), cloudDark: jitter(rng, srgb(P[1]), 0.06, 0.04), cloudBright: srgb(P[2]),
      ground: jitter(rng, srgb(rng.pick(['#6a5240', '#5a4a3a', '#4a3a30'])), 0.1), groundDark: srgb('#2a201a')
    }
  };
}

// ── Gazowe olbrzymy ───────────────────────────────────────────────────────────────────────────────────────────────
const GAS_PALETTES = {
  jowisz: { zone: '#e8dcc4', belt: '#a06a42', accent: '#c8462a', pole: '#8a8478', storm: '#f4eee2' },
  saturn: { zone: '#e8d4a4', belt: '#c09a60', accent: '#d8b070', pole: '#b0a078', storm: '#f4ecd4' },
  amoniak: { zone: '#dfe2e2', belt: '#9aa0a4', accent: '#7a8a9a', pole: '#8a929a', storm: '#f6f8f8' },
  siarka: { zone: '#e8d088', belt: '#b47a38', accent: '#d8902c', pole: '#9a8058', storm: '#f8eec8' },
  rdza: { zone: '#d8b498', belt: '#8a4a32', accent: '#a83a24', pole: '#6a5048', storm: '#f0dccc' },
  gorący: { zone: '#5a4a52', belt: '#2a2230', accent: '#8a3a2a', pole: '#2a2630', storm: '#9a8a90' }
};
const ICE_PALETTES = {
  uran: { zone: '#aee0e4', belt: '#94d0d8', accent: '#d8f0f2', pole: '#c4ecee', storm: '#f0fafa', dark: '#5a8a9a' },
  neptun: { zone: '#3a64c8', belt: '#2a4ca8', accent: '#6a90e0', pole: '#2a48a0', storm: '#e8f0fa', dark: '#14245a' },
  turkus: { zone: '#5ab0b8', belt: '#3a8a98', accent: '#8ad0d4', pole: '#4a9aa8', storm: '#e6f6f6', dark: '#1a4a5a' },
  zielony: { zone: '#8ac8a8', belt: '#6aa890', accent: '#b0e0c8', pole: '#7ab8a0', storm: '#eef8f0', dark: '#2a5a4a' }
};

/** Profil wiatru z ekstremów [[φ °, m/s], …] (interpolacja kosinusowa, jak jupiterZonalWind). */
export function windFromExtrema(ext) {
  return (lat) => {
    if (lat <= ext[0][0]) return ext[0][1];
    if (lat >= ext[ext.length - 1][0]) return ext[ext.length - 1][1];
    let i = 1;
    while (ext[i][0] < lat) i++;
    const [l0, w0] = ext[i - 1];
    const [l1, w1] = ext[i];
    const t = (lat - l0) / (l1 - l0);
    return w0 + (w1 - w0) * (1 - Math.cos(Math.PI * t)) * 0.5;
  };
}

function lookGas(rng, ice) {
  const palName = ice
    ? rng.weighted([['uran', 0.35], ['neptun', 0.35], ['turkus', 0.18], ['zielony', 0.12]])
    : rng.weighted([['jowisz', 0.32], ['saturn', 0.24], ['amoniak', 0.12], ['siarka', 0.12], ['rdza', 0.12], ['gorący', 0.08]]);
  const pal = Object.fromEntries(Object.entries((ice ? ICE_PALETTES : GAS_PALETTES)[palName]).map(([k, v]) => [k, jitter(rng, srgb(v), 0.06, 0.04)]));
  const contrast = ice ? rng.range(0.05, palName === 'uran' ? 0.12 : 0.3) : rng.range(palName === 'saturn' ? 0.25 : 0.45, palName === 'saturn' ? 0.55 : 1.0);
  // Pasy: granice od równika ku biegunom, szerokości maleją ku biegunom (jak u Jowisza), strefa równikowa szersza.
  const bands = [];
  const halfCount = ice ? rng.int(3, 6) : rng.int(5, 9);
  const eqHalf = rng.range(ice ? 8 : 5, ice ? 18 : 12);
  for (const hemi of [1, -1]) {
    let lat = eqHalf;
    let k = 0;
    bands.push({ lo: 0, hi: eqHalf, hemi, kind: 'zone', k: 0 });
    while (lat < 82 && k < halfCount) {
      const w = rng.range(ice ? 7 : 4.5, ice ? 16 : 10) * (1.15 - lat / 140);
      const hi = Math.min(84, lat + w);
      bands.push({ lo: lat, hi, hemi, kind: (k % 2 === 0) ? 'belt' : 'zone', k: k + 1 });
      lat = hi;
      k++;
    }
    bands.push({ lo: lat, hi: 90, hemi, kind: 'polar', k: k + 1 });
  }
  // Rekord pasa dla wypieku: [φ dolny, φ górny] (stopnie, rosnąco), barwa, turbulencja, rodzaj.
  const rows = [];
  for (const b of bands) {
    const lo = b.hemi > 0 ? b.lo : -b.hi;
    const hi = b.hemi > 0 ? b.hi : -b.lo;
    if (b.kind === 'zone' && b.k === 0 && b.hemi < 0) continue;   // strefa równikowa raz
    const eq = b.k === 0;
    let col;
    if (b.kind === 'polar') col = pal.pole;
    else if (b.kind === 'zone') col = lerp3(pal.zone, pal.storm, rng.range(0, 0.25));
    else col = lerp3(pal.belt, pal.accent, rng.chance(0.25) ? rng.range(0.3, 0.8) : rng.range(0, 0.2));
    // kontrast pasa (belt ciemniejszy od strefy o `contrast`)
    if (b.kind === 'belt') col = lerp3(pal.zone, col, clamp01(contrast * rng.range(0.7, 1.3)));
    rows.push({
      lo: eq ? -eqHalf : lo, hi: eq ? eqHalf : hi, color: col.map((v) => round(v)),
      turb: b.kind === 'belt' ? rng.range(0.5, 1.0) : rng.range(0.15, 0.5),
      kind: b.kind === 'belt' ? 1 : (b.kind === 'polar' ? 2 : 0)
    });
  }
  rows.sort((a, b) => a.lo - b.lo);
  // Wiatr strefowy: dżety na granicach pasów (na przemian na wschód i na zachód, słabnące ku biegunom),
  // superrotacja równika (olbrzym) albo prąd wsteczny na równiku i dżety na średnich szerokościach (lodowy olbrzym).
  const ext = [[-90, 0]];
  const eqWind = ice ? -rng.range(120, 380) : rng.range(60, 160);
  for (let i = 0; i < rows.length - 1; i++) {
    const edge = rows[i].hi;
    const a = Math.abs(edge);
    if (a < 1) continue;
    let w;
    if (ice) w = Math.sin(Math.min(1, a / 70) * Math.PI) * rng.range(80, 220) - 20;
    else w = ((i % 2 === 0) ? 1 : -0.35) * rng.range(30, 140) * (1.1 - a / 100);
    ext.push([edge, w]);
  }
  ext.push([0, eqWind]);
  ext.push([90, 0]);
  ext.sort((a, b) => a[0] - b[0]);
  // przy biegunach zero (jądro czapy bez ruchu sztywnego — pas najbliżej bieguna prawie stoi)
  for (const e of ext) if (Math.abs(e[0]) > 80 && Math.abs(e[0]) < 90) e[1] *= 0.3;
  const windAt = windFromExtrema(ext);
  const cuts = [-90, ...profileMinima(windAt, -89.5, 89.5, 0.25, 8), 90];
  // Wiry: wielka plama (czasem), owale w strefach, barki w pasach; ciemne plamy lodowych olbrzymów.
  const vortices = [];
  const nV = ice ? rng.int(0, 3) : rng.int(3, 8);
  const zoneRows = rows.filter((r) => r.kind === 0 && Math.abs((r.lo + r.hi) / 2) > 8);
  const beltRows = rows.filter((r) => r.kind === 1);
  const used = [];
  const fits = (u, lat, a, b) => used.every((o) => {
    const du = Math.abs(((u - o.u + 540) % 360) - 180);
    return du > (a + o.a) * 1.4 || Math.abs(lat - o.lat) > (b + o.b) * 1.4;
  });
  const addV = (rec) => { if (fits(rec.u, rec.lat, rec.a, rec.b)) { vortices.push(rec); used.push(rec); } };
  if (!ice && rng.chance(palName === 'saturn' ? 0.2 : 0.55)) {
    const r = rng.pick(zoneRows.length ? zoneRows : rows);
    const lat = (r.lo + r.hi) / 2;
    const b = Math.max(3.5, Math.min(8, (r.hi - r.lo) * 0.55));
    addV({ id: 'wielka plama', u: rng.range(0, 360), lat, a: b * rng.range(1.7, 2.2), b, sense: lat < 0 ? 1 : -1,
      periodDays: rng.range(4, 7), core: 0.3, drift: null, rigid: true, color: 'accent', big: 1 });
  }
  for (let i = 0; i < nV * 3 && vortices.length < nV + (vortices.length && vortices[0].big ? 1 : 0); i++) {
    if (ice) {
      const lat = rng.range(-55, 55);
      const b = rng.range(2.5, 6);
      addV({ id: `plama ${i}`, u: rng.range(0, 360), lat, a: b * rng.range(1.4, 2.0), b, sense: lat < 0 ? 1 : -1,
        periodDays: rng.range(3, 8), core: 0.4, drift: null, rigid: true, color: 'dark', big: 0 });
      continue;
    }
    const inBelt = rng.chance(0.35) && beltRows.length;
    const r = inBelt ? rng.pick(beltRows) : rng.pick(zoneRows.length ? zoneRows : rows);
    const lat = (r.lo + r.hi) / 2;
    const b = Math.max(1.2, Math.min(3.2, (r.hi - r.lo) * rng.range(0.22, 0.36)));
    addV({ id: `owal ${i}`, u: rng.range(0, 360), lat, a: b * rng.range(1.4, 2.0), b,
      sense: (lat < 0 ? 1 : -1) * (inBelt ? -1 : 1), periodDays: rng.range(1.8, 3.2), core: 0.5, drift: null, rigid: true,
      color: inBelt ? 'belt' : 'storm', big: 0 });
  }
  const ring = rng.chance(ice ? 0.45 : 0.4) ? {
    inner: round(rng.range(1.22, 1.55), 3), outer: round(rng.range(1.9, ice ? 2.3 : 2.6), 3),
    opacity: round(ice ? rng.range(0.15, 0.4) : rng.range(0.45, 0.95), 3),
    color: (ice ? jitter(rng, srgb('#6a6a70'), 0.15) : jitter(rng, srgb(rng.pick(['#c8b49a', '#b0a08a', '#d0c4b0', '#9a8a78'])), 0.1)).map((v) => round(v)),
    gaps: rng.int(1, 4), tiltDeg: round(rng.range(-28, 28), 2), seed: rng.int(1, 1e6)
  } : null;
  return {
    palette: palName, contrast, rows, ext, cuts, vortices, ring,
    windAt,
    storms: ice ? rng.range(0.2, 1.0) : rng.range(0.2, 0.9),   // drobne jasne chmury konwekcji
    festoons: ice ? 0 : rng.range(0.2, 1.0),                    // girlandy na skraju strefy równikowej
    turb: ice ? rng.range(0.15, 0.4) : rng.range(0.55, 1.0),
    polarHaze: rng.range(0.3, 0.9),
    colors: pal
  };
}

// ── Atmosfera, chmury, noc wg rodzaju ─────────────────────────────────────────────────────────────────────────────
// Mgiełka: niebieska tylko nad ciemnym gruntem i wodą (na jasnym suchym gruncie daje fiolet) — pustynie i rdza
// mają płową, lód — obojętną i słabą.
function atmosphereFor(type, look, rng) {
  const blue = { color: [0.55, 0.72, 1.0], beta: [0.05, 0.10, 0.22] };
  const tan = { color: [0.84, 0.74, 0.6], beta: [0.075, 0.085, 0.1] };
  const dust = { color: [0.9, 0.62, 0.42], beta: [0.14, 0.10, 0.07] };
  const neutral = { color: [0.82, 0.84, 0.86], beta: [0.06, 0.065, 0.07] };
  let haze = { strength: 0, ...blue };
  let halo = { color: [0.3, 0.6, 1.0], sunset: [1.2, 0.4, 0.1], power: 8.0, coef: 0.47 };
  let ringAtm = { height: 1000, day: [0.26, 0.5, 1.0], sunset: [1.0, 0.38, 0.12], gain: 0.8 };
  switch (type) {
    case 'terran': case 'ocean':
      // słabiej niż Ziemia gry (1,0 na suchym lądzie): nad ciemną wodą pełna mgiełka daje jaskrawy błękit i szeroki
      // pomarańczowy pas zachodu
      // barwa i współczynniki mniej zróżnicowane niż domyślny błękit (0,05 / 0,10 / 0,22): ekstynkcja zabiera
      // błękit z jasnego lądu, a rozpraszanie go dokłada — przy dużej różnicy suchy ląd wychodzi fioletowy
      haze = { strength: rng.range(0.4, 0.55), color: [0.66, 0.78, 0.98], beta: [0.05, 0.075, 0.12] };
      halo = { color: [0.3, 0.6, 1.0], sunset: [1.2, 0.4, 0.1], power: 9.0, coef: 0.47 };
      ringAtm = { height: rng.range(1000, 1500), day: [0.26, 0.5, 1.0], sunset: [1.0, 0.38, 0.12], gain: 0.95 };
      break;
    case 'desert':
      haze = { strength: rng.range(0.3, 0.65), ...tan };
      halo = { color: [0.85, 0.66, 0.42], sunset: [1.1, 0.5, 0.2], power: 8.5, coef: 0.42 };
      ringAtm = { height: 900, day: [0.8, 0.62, 0.42], sunset: [1.0, 0.45, 0.2], gain: 0.6 };
      break;
    case 'rocky':
      haze = { strength: rng.range(0.08, 0.34), ...dust };
      halo = { color: [0.8, 0.4, 0.2], sunset: [0.2, 0.5, 1.5], power: 9.0, coef: 0.4 };
      ringAtm = { height: 700, day: [0.85, 0.5, 0.3], sunset: [0.35, 0.55, 1.0], gain: 0.45 };
      break;
    case 'ice':
      haze = { strength: look.style === 'śnieżka' ? rng.range(0.15, 0.4) : rng.range(0.0, 0.12), ...neutral };
      halo = { color: [0.7, 0.8, 0.9], sunset: [0.9, 0.8, 0.9], power: 10.0, coef: 0.32 };
      ringAtm = { height: 600, day: [0.7, 0.8, 0.95], sunset: [0.9, 0.7, 0.8], gain: 0.35 };
      break;
    case 'volcanic':
      haze = look.style === 'siarka' ? { strength: 0.0, ...tan }
        : { strength: look.style === 'lawa' ? rng.range(0.04, 0.14) : rng.range(0.15, 0.35), color: look.style === 'lawa' ? [0.7, 0.6, 0.55] : [0.66, 0.64, 0.62], beta: [0.09, 0.09, 0.09] };
      halo = { color: look.style === 'lawa' ? [0.9, 0.45, 0.2] : [0.7, 0.66, 0.6], sunset: [1.2, 0.5, 0.2], power: 9.5, coef: 0.38 };
      ringAtm = { height: 700, day: [0.8, 0.55, 0.35], sunset: [1.0, 0.4, 0.15], gain: 0.4 };
      break;
    case 'barren':
      haze = { strength: 0, ...neutral };
      halo = { color: [0.6, 0.6, 0.6], sunset: [0.8, 0.7, 0.6], power: 12.0, coef: 0.18 };
      ringAtm = { height: 300, day: [0.5, 0.5, 0.5], sunset: [0.6, 0.5, 0.4], gain: 0.0 };
      break;
    case 'toxic': {
      const hz = { wenus: [1.0, 0.82, 0.5], tytan: [0.95, 0.62, 0.3], chlor: [0.82, 0.9, 0.5], smog: [0.82, 0.72, 0.56] }[look.style];
      haze = { strength: rng.range(0.7, 0.95), color: hz, beta: [0.07, 0.11, 0.16] };
      halo = { color: hz.map((v) => v * 0.9), sunset: [1.2, 0.5, 0.1], power: 6.0, coef: 0.5 };
      ringAtm = { height: 2200, day: hz.map((v) => v * 0.8), sunset: [1.0, 0.45, 0.15], gain: 0.85 };
      break;
    }
    case 'gas': {
      const z = look.colors.zone;
      haze = { strength: rng.range(0.0, 0.3), color: [0.93, 0.83, 0.64], beta: [0.06, 0.08, 0.12] };
      halo = { color: [Math.min(1, z[0] * 0.9), Math.min(1, z[1] * 0.9), Math.min(1, z[2] * 0.85)], sunset: [1.0, 0.55, 0.25], power: 5.0, coef: 0.47 };
      ringAtm = { height: 2400, day: [0.72, 0.64, 0.52], sunset: [1.0, 0.55, 0.25], gain: 0.75 };
      break;
    }
    case 'ice_giant': {
      const z = look.colors.zone;
      haze = { strength: rng.range(0.25, 0.5), color: [z[0] * 0.8 + 0.15, z[1] * 0.8 + 0.15, z[2] * 0.8 + 0.2], beta: [0.12, 0.08, 0.05] };
      halo = { color: [z[0] * 0.8, z[1] * 0.9, Math.min(1, z[2] * 1.1)], sunset: [0.8, 0.8, 1.0], power: 4.0, coef: 0.47 };
      ringAtm = { height: 1800, day: [0.4, 0.7, 0.85], sunset: [0.7, 0.7, 1.0], gain: 0.7 };
      break;
    }
    default: break;
  }
  const r3 = (a) => a.map((v) => round(v));
  return {
    haze: { strength: round(haze.strength, 3), color: r3(haze.color), beta: r3(haze.beta) },
    halo: { color: r3(halo.color), sunset: r3(halo.sunset), power: halo.power, coef: halo.coef },
    ringAtm: { height: Math.round(ringAtm.height), day: r3(ringAtm.day), sunset: r3(ringAtm.sunset), gain: round(ringAtm.gain, 3) }
  };
}

function cloudsFor(type, look, rng) {
  // style: 0 — ziemskie (pasy klimatu, cyklony), 1 — pokład (toksyczna), 2 — pył / mgła cienka
  switch (type) {
    case 'terran':
      return { style: 0, opacity: round(rng.range(0.55, 0.75), 3), cover: round(rng.range(0.26, 0.48), 3),
        cyclones: rng.int(2, 6), stretch: round(rng.range(1.6, 2.4), 3), tint: [1, 1, 1], sizeMul: 1 };
    case 'ocean':
      return { style: 0, opacity: round(rng.range(0.6, 0.8), 3), cover: round(rng.range(0.36, 0.56), 3),
        cyclones: rng.int(3, 8), stretch: round(rng.range(1.5, 2.2), 3), tint: [1, 1, 1], sizeMul: 1 };
    case 'desert':
      return rng.chance(0.55) ? { style: 2, opacity: round(rng.range(0.25, 0.45), 3), cover: round(rng.range(0.08, 0.22), 3),
        cyclones: 0, stretch: round(rng.range(1.8, 3.0), 3), tint: look.palette.sand.map((v) => round(Math.min(1.4, v / Math.max(...look.palette.sand)), 3)), sizeMul: 1 } : null;
    case 'rocky':
      return rng.chance(0.4) ? { style: 2, opacity: round(rng.range(0.2, 0.35), 3), cover: round(rng.range(0.05, 0.16), 3),
        cyclones: 0, stretch: round(rng.range(1.8, 3.0), 3), tint: [1.05, 0.98, 0.92], sizeMul: 1 } : null;
    case 'ice':
      return look.style === 'śnieżka' ? { style: 0, opacity: round(rng.range(0.35, 0.5), 3), cover: round(rng.range(0.2, 0.4), 3),
        cyclones: rng.int(0, 2), stretch: 2.0, tint: [1, 1, 1], sizeMul: 1 } : null;
    case 'volcanic':
      return look.style !== 'siarka' ? { style: 2, opacity: round(rng.range(0.25, 0.45), 3), cover: round(rng.range(0.08, 0.2), 3),
        cyclones: 0, stretch: 1.6, tint: look.style === 'lawa' ? [0.62, 0.58, 0.56] : [0.7, 0.68, 0.66], sizeMul: 0.8 } : null;
    case 'toxic': {
      // barwa pokładu z palety podrodzaju (maska = luminancja, barwa = chroma — graf chmur gry), smugi ciemniejsze
      const norm = (c) => { const m = Math.max(...c); return c.map((v) => round(Math.min(1.4, v / m), 3)); };
      return { style: 1, opacity: round(rng.range(0.82, 0.96), 3), cover: look.cover, cyclones: 2, stretch: round(rng.range(2.2, 3.2), 3),
        tint: norm(look.palette.cloud), tint2: norm(look.palette.cloudDark).map((v) => round(v * 0.85, 3)), sizeMul: 1 };
    }
    default: return null;
  }
}

function nightFor(type, look, rng) {
  // cities — gęstość cywilizacji (0 — dzika planeta), lava — żar lawy nocą
  const civ = (p, lo, hi) => (rng.chance(p) ? round(rng.range(lo, hi), 3) : 0);
  switch (type) {
    case 'terran': return { cities: civ(0.75, 0.25, 1.0), lava: 0 };
    case 'ocean': return { cities: civ(0.55, 0.15, 0.7), lava: 0 };
    case 'desert': return { cities: civ(0.5, 0.1, 0.6), lava: 0 };
    case 'rocky': return { cities: civ(0.4, 0.05, 0.4), lava: 0 };
    case 'ice': return { cities: civ(0.3, 0.05, 0.3), lava: 0 };
    case 'volcanic': return { cities: civ(0.15, 0.03, 0.2), lava: round(look.style === 'lawa' ? rng.range(0.7, 1.0) : (look.style === 'popiół' ? rng.range(0.3, 0.6) : rng.range(0.15, 0.4)), 3) };
    case 'barren': return { cities: civ(0.35, 0.03, 0.25), lava: 0 };
    case 'toxic': return { cities: civ(0.3, 0.05, 0.35), lava: 0 };
    default: return { cities: 0, lava: 0 };
  }
}

function surfaceFor(type, look) {
  const s = { ...SURFACE_DEFAULT };
  if (type === 'terran' || type === 'ocean') Object.assign(s, { bright: 1.15, sunInt: 1.0, specular: 1.2, bloom: 0.6 });
  if (type === 'ice') Object.assign(s, { bright: 0.92, sunInt: 1.0, specular: 0.25, bloom: 0.25 });
  if (type === 'volcanic' && look.style === 'lawa') Object.assign(s, { specular: 0.35 });
  if (type === 'toxic') Object.assign(s, { bright: 0.95, sunInt: 1.0 });
  if (type === 'gas') Object.assign(s, { bright: 0.92, sunInt: 0.94, bloom: 0.05 });
  if (type === 'ice_giant') Object.assign(s, { bright: 0.96, sunInt: 1.0, bloom: 0.1 });
  return s;
}

const LOOKS = {
  terran: lookTerran, ocean: lookOcean, desert: lookDesert, rocky: lookRocky, ice: lookIce, volcanic: lookVolcanic,
  barren: lookBarren, toxic: lookToxic, gas: (rng) => lookGas(rng, false), ice_giant: (rng) => lookGas(rng, true)
};

/**
 * Pełny opis planety z ziarna. `desc` = { type, seed (uint32), r? (promień w grze), rKm?, look? (nadpisania pól
 * wyglądu), clouds?: null | {…}, night?: {…} }. Wynik zamrożony płytko (obiekty wewnątrz — dane, nie zmieniać).
 */
export function describePlanet(desc) {
  const type = desc?.type;
  if (!isPlanetGenType(type)) throw new Error(`planetGen: nieznany rodzaj „${type}”`);
  const seed = (Number(desc.seed) >>> 0);
  const T = PLANET_GEN_TYPE[type];
  const rngLook = rngFor(seed, `${type}:wygląd`);
  const rngAtm = rngFor(seed, `${type}:atmosfera`);
  const rngGeo = rngFor(seed, `${type}:domena`);
  const look = { ...LOOKS[type](rngLook), ...(desc.look || {}) };
  const rKm = Number(desc.rKm) || round(rngGeo.range(T.rKm[0], T.rKm[1]), 0);
  const seedOffset = [round(rngGeo.range(20, 420), 3), round(rngGeo.range(20, 420), 3), round(rngGeo.range(20, 420), 3)];
  const atm = atmosphereFor(type, look, rngAtm);
  const clouds = desc.clouds === null ? null : (desc.clouds || cloudsFor(type, look, rngAtm));
  const night = { ...nightFor(type, look, rngAtm), ...(desc.night || {}) };
  return Object.freeze({
    type, seed, kind: T.kind, name: T.name, r: Number(desc.r) || null, rKm,
    seedOffset, seedInt: seed % 9973,
    look, surface: surfaceFor(type, look), ...atm, clouds, night
  });
}

/** Mapy, które powstaną dla opisu (bez wypieku): { day, normal, spec, night, clouds } → true/false. */
export function plannedMaps(spec) {
  if (spec.kind === 'gas') return { day: true, normal: false, spec: false, night: false, clouds: false };
  const water = (spec.look.water || 0) > 0.001;
  const lavaGloss = spec.type === 'volcanic' && spec.look.style === 'lawa';
  return {
    day: true, normal: true,
    spec: water || lavaGloss || spec.type === 'ice',
    night: (spec.night.cities > 0) || (spec.night.lava > 0),
    clouds: !!spec.clouds
  };
}

/**
 * Pamięć GPU map dla opisu przy szerokości `size` (wysokość = size / 2) [bajty]: dzień, normalne, chmury — RGBA8
 * w pełnej rozdzielczości, połysk R8 i noc RGBA8 w połowie; mipmapy × 4/3. Tekstura profilu wiatru olbrzyma — 4 kB.
 */
export function plannedBytes(spec, size) {
  const m = plannedMaps(spec);
  const full = size * (size / 2);
  const half = full / 4;
  const mip = 4 / 3;
  let b = 0;
  if (m.day) b += full * 4 * mip;
  if (m.normal) b += full * 4 * mip;
  if (m.clouds) b += full * 4 * mip;
  if (m.spec) b += half * 1 * mip;
  if (m.night) b += half * 4 * mip;
  if (spec.kind === 'gas') b += 512 * 8;
  return Math.round(b);
}
