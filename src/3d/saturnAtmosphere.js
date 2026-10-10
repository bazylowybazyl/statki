// src/3d/saturnAtmosphere.js
//
// Żywa atmosfera Saturna (2026-10-09, prośba użytkownika: „animowana atmosfera Saturna — tam też są cyklony
// i ruchoma atmosfera”). Silnik wspólny z Jowiszem (gasGiantAtmosphere.js + .tsl.js), tu model planety. Dane
// (profil wiatru Cassini, sześciokąt, czapy polarne, wiry) — src/data/saturnAtmosphere.js, wspólne z generatorem
// mapy (scripts/planety/saturn.py). Wpięcie: planet3d.assets.js (DirectPlanet — rodzaj grafu 'saturn').
//
// CO SIĘ RUSZA (wiatry Saturna są ~3× szybsze niż Jowisza: dżet równikowy ~370 m/s w Systemie III):
//   • PASY z prędkością wiatru strefowego — granice na minimach profilu, a szeroki dżet równikowy pocięty na
//     segmenty o rozrzucie wiatru ≤ maxSpread (reszta prędkości w fazach zostaje mała — bez rozmycia detalu);
//   • TURBULENCJA w strefach ścinania (jak Jowisz);
//   • WIRY: anticyklon po Wielkiej Białej Plamie 2011, owale alei burz 41° S, owale 60° N i 52° S;
//   • CZAPA PŁN.: SZEŚCIOKĄT (dżet ~75° N stoi w Systemie III, chmury płyną wzdłuż jego boków), wir polarny —
//     jądro obraca się sztywnie (cyklon: przeciwnie do wskazówek zegara patrząc z północy);
//   • CZAPA PŁD.: wir polarny południa (cyklon — zgodnie ze wskazówkami patrząc z południa = na wschód).
//
// DANE: mapa `saturn_hf_color.jpg` (scripts/planety/saturn.py — barwy pasów z map Hubble OPAL 2019–2025, detal
// i obiekty z położeń w src/data/saturnAtmosphere.js), szerokość PLANETOCENTRYCZNA liniowo w v, u rośnie na wschód.
import { GasGiantAtmosphere, GasGiantModel, profileMinima, tableWind } from './gasGiantAtmosphere.js';
import { SATURN_ATMOSPHERE as SA } from '../data/saturnAtmosphere.js';

export const SATURN_RADIUS_EQ = SA.radiusEqKm * 1000;
export const SATURN_RADIUS_POLAR = SA.radiusPolarKm * 1000;

/** Wiatr strefowy Saturna [m/s] na szerokości planetocentrycznej φc [°] (tabela Cassini, interpolacja liniowa). */
export function saturnZonalWind(latDeg) {
  return tableWind(SA.wind, SA.windStepDeg, latDeg);
}

export const SATURN_VORTEX_CAP = 8;
export const SATURN_BAND_CAP = 48;
export const SATURN_BANDS = Object.freeze({ blendDeg: 0.6, minDeg: 1.8, vortexReach: 1.3, vortexPad: 0.3 });
// Rozrzut wiatru w jednym pasie sztywnym [m/s] (dżet równikowy: ~16 pasów zamiast jednego).
export const SATURN_MAX_SPREAD = 36;

export const SATURN_VORTICES = Object.freeze(SA.vortices.map((v) => Object.freeze({ ...v })));

/** Czapy polarne modelu: granica (minimum profilu), jądro obracane sztywnie, sześciokąt płn. */
export const SATURN_POLES = Object.freeze({
  north: Object.freeze({ cap: SA.poles.north.cap, core: SA.poles.north.core, blend: 1.6,
    hexagon: Object.freeze({ ...SA.hexagon }) }),
  south: Object.freeze({ cap: SA.poles.south.cap, core: SA.poles.south.core, blend: 1.6 })
});

// Strojenie (window.SaturnAtmTune): czytane co klatkę. Tempo: dżet równikowy 370 m/s — przy 2000 s na s gry
// równik okrąża planetę w ~5 min gry (Jowisz przy 5000 i 137 m/s: ~9 min).
export const SATURN_ATM_TUNE = {
  on: 1,
  timeScale: 2000,
  period: 9,
  desync: 0.7,
  contrast: 0.55,
  eddy: 30,
  eddyFloor: 0.25,
  eddyScaleU: 18,
  eddyScaleV: 13,
  vortexSpeed: 1.5,
  // tempo obrotu czap polarnych (ponad wiatr — wir polarny ma być widocznie „wirującym okiem”)
  poleSpeed: 2.5,
  refPxPerTexel: 1.5,
  zoomFollow: 0.75,
  vortexZoomFollow: 0.3,
  zoomLag: 0.4
};
if (typeof window !== 'undefined') window.SaturnAtmTune = SATURN_ATM_TUNE;

// Klucze `material.uniforms` czytane przez gałąź Saturna (po kluczach powierzchni planety).
export const SATURN_UNIFORM_KEYS = Object.freeze({ uSatClock: 'vec4', uSatFlow: 'vec4', uSatTurb: 'vec4', uSatPole: 'vec4' });

/** Granice pasów: ±90° i minima profilu (głębsze niż 12 m/s od sąsiednich szczytów). */
export function saturnCuts() {
  return [-90, ...profileMinima(saturnZonalWind), 90];
}

export const SATURN_MODEL = new GasGiantModel({
  id: 'saturnAtmosphere',
  radius: SATURN_RADIUS_EQ,
  windAt: saturnZonalWind,
  cuts: saturnCuts(),
  maxSpread: SATURN_MAX_SPREAD,
  vortices: SATURN_VORTICES,
  bands: SATURN_BANDS,
  bandCap: SATURN_BAND_CAP,
  vortexCap: SATURN_VORTEX_CAP,
  windTexels: 720,
  turbFade: [58, 8],
  texSize: [8192, 4096],
  names: { bands: 'saturnBands', vortices: 'saturnVortices', wind: 'saturnWind' },
  keys: { clock: 'uSatClock', flow: 'uSatFlow', turb: 'uSatTurb', pole: 'uSatPole' },
  tune: SATURN_ATM_TUNE,
  poles: SATURN_POLES
});

/** Zegar i strojenie atmosfery Saturna (DirectPlanet._spin → step()). */
export class SaturnAtmosphere extends GasGiantAtmosphere {
  constructor(planet, dayTexture) {
    super(SATURN_MODEL, planet, dayTexture);
  }
}
