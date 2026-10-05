// Budowle portowe (Z7, docs/PLAN-ruch-v2-w-grze.md): HAK STYLU per planeta.
//
// Te same moduły (stocznia z placami refitu, hangar postojowy, boje redy) stoją
// na ringach Ziemi, Marsa i Jowisza i na megadokach planet bez ringu (Z8).
// Decyzja użytkownika 2026-09-26: ringi Marsa i Jowisza ORAZ ICH DOKI wyglądają
// inaczej niż Ziemia — budowle biorą więc styl doków z profilu planety
// (haloRingProfiles.js, pole `port`) i zmieniają nim wygląd, nie układ:
//
//   rodzina 'k7'       Ziemia: hala z dema K-7 — jasne płyty, żółte suwnice,
//                      cyjanowe listwy, dachy z belek i paneli;
//   rodzina 'vault'    Mars: sklepienia łukowe z regolitem, nasypy przy
//                      ścianach, rdza i krem, bursztynowe światła;
//   rodzina 'radiator' Jowisz: pola radiatorów, rurociągi, zbiorniki,
//                      grafit z żółtym oznakowaniem, światła sodowe i turkus.
//
// Wejście: klucz profilu ('earth' | 'mars' | 'jupiter'), profil ringu, styl
// doków profilu (`profile.port`) albo własny styl megadoku (Z8) — ten sam
// kształt co `port` (k7Palette, k7Emit, k7Glow, labels, roof, walls) plus
// opcjonalny blok `buildings` z nadpisaniami tylko dla budowli.
// Czyste dane: bez Three i DOM (czytają to testy node i worker nic tu nie liczy).
import { resolveHaloProfile } from '../haloRing/haloRingProfiles.js';

export const PORT_STYLE_FAMILIES = Object.freeze(['k7', 'vault', 'radiator']);
export const PORT_STYLE_WALLS = Object.freeze(['k7', 'berm', 'pipes']);

// Paleta materiałów = kody K7_MAT 0–13 (haloPortK7Build.js): stal, ciemny metal,
// jasne płyty, żółty, pomarańcz, turkus, pokład, szyny, czerń, wąż, miedź,
// szkło, farba, zimna farba. Emisja: cyjan, ciepła, biel, czerwień, zieleń.
export const PORT_PALETTE_SIZE = 14;

const ROOF_TO_FAMILY = Object.freeze({ k7: 'k7', vault: 'vault', radiator: 'radiator' });
const WALLS_FOR_FAMILY = Object.freeze({ k7: 'k7', vault: 'berm', radiator: 'pipes' });

// Rytm świateł boi redy per rodzina (IALA w uproszczeniu): okres [s],
// liczba błysków w okresie, długość błysku [s]. Ziemia: Fl 3 s, Mars:
// Fl(2) 5 s, Jowisz: Q (szybkie) — reda każdej planety „mówi” inaczej.
const BUOY_RHYTHM = Object.freeze({
  k7: Object.freeze({ period: 3.0, flashes: 1, flash: 0.35 }),
  vault: Object.freeze({ period: 5.0, flashes: 2, flash: 0.3 }),
  radiator: Object.freeze({ period: 1.0, flashes: 1, flash: 0.25 })
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const round4 = (x) => Math.round(x * 10000) / 10000;

/** sRGB hex (0xRRGGBB) → liniowe [r, g, b] (4 miejsca, jak paleta hali K-7). */
export function portHexLinear(hex) {
  const h = Number(hex) >>> 0;
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => round4(srgbToLinear(v / 255)));
}

function freezeDeep(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freezeDeep(v);
  }
  return o;
}

function asTriple(v, fallback) {
  if (Array.isArray(v) && v.length >= 3 && v.every((x) => Number.isFinite(Number(x)))) return [Number(v[0]), Number(v[1]), Number(v[2])];
  return fallback.slice();
}

// Piraci „Iron Skull” (suchy dok misji 1, pirateDryDockScene.js) — jak sprite'y okrętów piratów
// (src/assets/ships/pirate*.png): ciemne żelazo z nitami przeżarte rdzą (brąz, pomarańcz rdzy), czerwone ukośne
// pasy farby, napisy, okrągłe włazy w ośmiokątnych ramach, kratki, kolce (bez czaszek — decyzja użytkownika
// 2026-10-05). Kody K7_MAT:
// stal = żelazo z rdzą, ciemny = poczerniałe żelazo, jasny = wytarta krawędź blachy, „żółty” = czerwień pasów
// (piraci nie mają żółtego), pomarańcz = rdza, turkus = brąz rdzy, pokład = żelazna blacha, szkło przydymione.
// Emisja: listwy bursztynowe (ogień), sodowe reflektory, biel, czerwień przeszkodowa, zieleń sygnałów.
export const PIRATE_PORT_STYLE = Object.freeze({
  key: 'pirate',
  name: 'SUCHY DOK PIRATÓW',
  k7Palette: [0x6e5a4e, 0x2c2522, 0x8e7e70, 0x9c3128, 0x9a5430, 0x6a4632, 0x55483f, 0x7a7068,
    0x141110, 0x3a2a24, 0x8a5636, 0x2a1a16, 0x962c26, 0xd8ccb0],
  k7Emit: [[1.38, 0.62, 0.16], [1.34, 0.80, 0.36], [1.40, 1.30, 1.16], [1.40, 0.08, 0.05], [0.42, 1.18, 0.55]],
  k7Glow: [[0.060, 0.026, 0.010], [0.090, 0.040, 0.016]],
  labels: {
    gate: '#c8b896', hub: '#a2342b', clear: '#a49a8a', bank: '#b0a493', control: '#c2b7a5',
    logistics: '#9a8e7d', capital: '#c23a30', berthLead: '#d8ccb0', berth: '#c9b88e', stop: '#7a7066',
    terminal: '#d8cdbb', bayLane: '#a49a8a', bayBank: '#b0a493', bayId: '#8a7f73'
  },
  roof: 'k7',
  walls: 'k7',
  buildings: Object.freeze({ family: 'k7', walls: 'k7', shipyardHub: 'u', weld: [4.6, 3.6, 5.8] })
});

// Styl doków (kształt `profile.port`) z dowolnego wejścia.
function portStyleOf(input) {
  if (!input) return resolveHaloProfile('earth').port;
  if (input === 'pirate') return PIRATE_PORT_STYLE;
  if (typeof input === 'string') return resolveHaloProfile(input).port;
  if (input.port && typeof input.port === 'object') return input.port;
  if (Array.isArray(input.k7Palette)) return input;
  if (input.key) return resolveHaloProfile(input.key).port;
  return resolveHaloProfile('earth').port;
}

function keyOf(input, port) {
  if (!input) return resolveHaloProfile('earth').key;
  if (input === 'pirate') return 'pirate';
  if (typeof input === 'string') return resolveHaloProfile(input).key;
  if (input?.key && typeof input.key === 'string') return input.key;
  if (port?.key && typeof port.key === 'string') return port.key;
  return 'custom';
}

/**
 * Styl budowli portowych z profilu planety albo stylu megadoku.
 * Zwraca zamrożony obiekt:
 *   key, name, family ('k7' | 'vault' | 'radiator'), walls ('k7' | 'berm' | 'pipes'),
 *   palette  14 × [r, g, b] liniowo (kody K7_MAT 0–13),
 *   emit     5 × [r, g, b] HDR (cyjan, ciepła, biel, czerwień, zieleń; pasmo 0,9–1,4),
 *   glow     2 × [r, g, b] (poświata szkła: stała, nocna),
 *   labels   kolory napisów na pokładzie (#rrggbb),
 *   buoy     { civil, military, queue: [r, g, b] HDR, period, flashes, flash },
 *   weld     [r, g, b] HDR iskry spawania (małe punkty — nad progiem bloomu),
 *   shipyardHub  kształt piasty stoczni: 'radial' (Ziemia — okrąg z wypustkami)
 *            albo 'u' (inne frakcje — litera U), createShipyardLayout({ hub }).
 */
export function resolvePortBuildingStyle(input = 'earth') {
  const port = portStyleOf(input);
  const extra = (port && typeof port.buildings === 'object' && port.buildings) || {};
  const own = (input && typeof input === 'object' && typeof input.buildings === 'object' && input.buildings) || {};
  const over = { ...extra, ...own };
  const earth = resolveHaloProfile('earth').port;
  const familyRaw = String(over.family || input?.family || ROOF_TO_FAMILY[port?.roof] || 'k7');
  const family = PORT_STYLE_FAMILIES.includes(familyRaw) ? familyRaw : 'k7';
  const wallsRaw = String(over.walls || port?.walls || WALLS_FOR_FAMILY[family]);
  const walls = PORT_STYLE_WALLS.includes(wallsRaw) ? wallsRaw : WALLS_FOR_FAMILY[family];
  const hexes = Array.isArray(port?.k7Palette) && port.k7Palette.length >= PORT_PALETTE_SIZE ? port.k7Palette : earth.k7Palette;
  const palette = hexes.slice(0, PORT_PALETTE_SIZE).map(portHexLinear);
  const emitSrc = Array.isArray(port?.k7Emit) && port.k7Emit.length >= 5 ? port.k7Emit : earth.k7Emit;
  const emit = emitSrc.slice(0, 5).map((c, i) => asTriple(c, earth.k7Emit[i]).map(round4));
  const glowSrc = Array.isArray(port?.k7Glow) && port.k7Glow.length >= 2 ? port.k7Glow : earth.k7Glow;
  const glow = glowSrc.slice(0, 2).map((c, i) => asTriple(c, earth.k7Glow[i]).map(round4));
  const labels = { ...earth.labels, ...(port?.labels || {}) };
  const rhythm = BUOY_RHYTHM[family];
  const buoyOver = over.buoy || {};
  const buoy = {
    // cywilna reda: ciepła (sodowa), wojskowa: czerwień, kolejka hangaru: cyjan
    civil: asTriple(buoyOver.civil, emit[1]),
    military: asTriple(buoyOver.military, emit[3]),
    queue: asTriple(buoyOver.queue, emit[0]),
    period: Math.max(0.2, Number(buoyOver.period) || rhythm.period),
    flashes: Math.max(1, Math.floor(Number(buoyOver.flashes) || rhythm.flashes)),
    flash: clamp01(Number(buoyOver.flash) || rhythm.flash) || rhythm.flash
  };
  return freezeDeep({
    key: keyOf(input, port),
    name: String(over.name || port?.name || 'PORT'),
    family,
    walls,
    palette,
    emit,
    glow,
    labels,
    buoy,
    // łuk spawalniczy: niebieskawa biel, drobne punkty (≤ 3 px) nad progiem 0,9
    weld: asTriple(over.weld, [4.2, 4.6, 6.2]),
    // szkic użytkownika 2026-09-27: stocznie frakcji różnią się piastą
    shipyardHub: over.shipyardHub === 'radial' || over.shipyardHub === 'u' ? over.shipyardHub : (family === 'k7' ? 'radial' : 'u')
  });
}
