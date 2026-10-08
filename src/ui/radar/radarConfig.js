// src/ui/radar/radarConfig.js
//
// Radar taktyczny kokpitu (przebudowa 2026-10-07 — „radar do kichy, ma pokazywać to, co PRZED statkiem”).
// Wskaźnik PPI jak na okręcie: antena się obraca (przemiatanie), echo zapala się, gdy wiązka przez nie
// przejdzie, i gaśnie jak luminofor; na surowym echu siedzi nakładka śledzenia (ARPA): symbol strony,
// wektor prędkości, ślad ostatnich pozycji, numer śladu i klasa. Domyślnie DZIOBEM DO GÓRY (H-UP):
// kopuła kokpitu pokazuje górną połowę tarczy, więc widać to, co jest przed okrętem; Alt — pełne 360°.
// Strojenie na żywo: window.RadarTune (ten obiekt).

export const RADAR_RANGES = Object.freeze([5000, 10000, 20000, 40000, 60000]);

export const RADAR_TUNE = {
  // Antena: s na obrót. Echo gaśnie wykładniczo (luminofor), ślad = ostatnie pozycje z malowań.
  sweepPeriod: 2.4,
  echoTau: 1.05,
  echoFlash: 0.16,          // s jaśniejszego błysku tuż po malowaniu
  historyLen: 6,
  // Ślad (track) ustala się po tylu malowaniach: od tego chwili numer, wektor i kurs.
  trackMature: 2,
  // Identyfikacja klasy: z bliska (sygnatura / wzrok), po impulsie skanera X, przy namiarze.
  classifyRange: 7000,
  // Wektor prędkości: czas wyprzedzenia = zasięg / vectorBase (20 km → 10 s), sufit długości.
  vectorBase: 2000,
  vectorMaxFrac: 0.42,
  vectorMinSpeed: 12,
  // Ponad tę prędkość [j/s] ślad bez ekstrapolacji (przyloty warpem 12–30 km/s gwałtownie hamują).
  fastSpeed: 2500,
  // Zgubiony / zniszczony kontakt: znacznik ✕ tyle sekund.
  killFade: 2.8,
  // Nowy wrogi ślad: pierścień „nowy kontakt”.
  newContactSec: 1.1,
  // Impuls skanera (X) na tarczy: ogon pierścienia jako ułamek zasięgu.
  pingTail: 0.12,
  // Przejścia: zasięg (zoom tarczy) i orientacja H-UP ↔ N-UP.
  rangeEase: 0.24,
  orientEase: 0.32,
  // Najwięcej śladów (nadmiar: najdalsze myśliwce i wraki odpadają w zbieraczu).
  maxTracks: 240,
  // Podkład terenu (planety, ring, pas, budowle) przeliczany co tyle s albo po przesunięciu okrętu
  // (i od razu po zmianie budowli — odpadły kawałek doku, zniszczona stacja, gotowy olbrzym).
  terrainRefreshSec: 2.5,
  terrainMoveFrac: 0.09,
  // Rysowanie tarczy [Hz] (przemiatanie płynnie, koszt ~1 ms przy 1080p).
  fps: 30,
  // Szerokość wiązki [rad] — echo daleko jest szersze w azymucie (jak w prawdziwym radarze).
  beamWidth: 0.026,
  // Szum (ziarno luminoforu) i grubość linii (px płótna na px CSS).
  grain: 0.035,
  // Pas asteroid: echo drobnicy (clutter) i progi pojedynczych skał.
  clutterGain: 0.55,
  rockMinPx: 0.9,
  rockMaxDraw: 2600,
  // Etykiety: w kopule tylko namierzone / wybrane, po Alt — także najbliższe wrogie.
  tagsDome: 2,
  tagsFull: 5
};

// Strojenie na żywo z konsoli (zmiany działają od następnej klatki tarczy; podkład — po przeliczeniu).
if (typeof window !== 'undefined') window.RadarTune = RADAR_TUNE;

// Barwy (rgb bez alfy — alfa liczona przy rysowaniu). Symbole jak NTDS / MIL-STD-2525:
// wróg romb (czerwony), sojusznik koło (zielony), nieznany kwadrat (żółty), neutralny kwadrat (szaroniebieski).
export const RADAR_RGB = Object.freeze({
  bgCenter: '11, 19, 28',
  bgRim: '3, 6, 10',
  grid: '170, 200, 230',
  label: '205, 218, 232',
  sweep: '140, 220, 255',
  echo: '214, 244, 255',
  land: '255, 168, 72',
  landHot: '255, 214, 150',
  rock: '236, 170, 96',
  clutter: '226, 158, 88',
  structure: '255, 206, 132',
  hostile: '255, 74, 74',
  friendly: '61, 220, 132',
  unknown: '255, 208, 80',
  neutral: '150, 190, 212',
  station: '255, 176, 64',
  wreck: '150, 160, 172',
  missileHostile: '255, 128, 64',
  missileFriendly: '120, 220, 255',
  objective: '255, 92, 138',
  nav: '95, 205, 255',
  mass: '186, 160, 255',
  ghost: '150, 170, 196',
  own: '159, 220, 255',
  heading: '255, 138, 61',
  locked: '255, 110, 110',
  selected: '92, 200, 255',
  weapon: '255, 120, 72',
  ping: '150, 230, 255',
  outline: '3, 5, 8'
});

// Kody klas (jak kody kadłubów NATO) — krótkie na tarczy, pełna nazwa w etykiecie.
export const RADAR_CLASS = Object.freeze({
  supercapital: 'SC',
  carrier: 'CV',
  battleship: 'BB',
  destroyer: 'DD',
  frigate: 'FF',
  fighter: 'FT',
  freighter: 'TR',
  mining: 'MN',
  station: 'ST',
  platform: 'PL',
  wreck: 'WR',
  drone: 'DR',
  missile: 'MS',
  unknown: '??'
});

/** Kod klasy z typu bytu (npc.type, shipFrame, callInTemplateKey). */
export function radarClassCode(typeKey, entity = null) {
  const key = String(typeKey || '').toLowerCase();
  if (!key) return entity?.isCapitalShip ? RADAR_CLASS.battleship : RADAR_CLASS.unknown;
  if (key.includes('supercapital') || key.includes('atlas') || key.includes('dreadnought')) return RADAR_CLASS.supercapital;
  if (key.includes('carrier')) return RADAR_CLASS.carrier;
  if (key.includes('battleship') || key.includes('cruiser')) return RADAR_CLASS.battleship;
  if (key.includes('destroyer') || key.includes('raider')) return RADAR_CLASS.destroyer;
  if (key.includes('frigate') || key.includes('corvette') || key.includes('custos')) return RADAR_CLASS.frigate;
  if (key.includes('fighter') || key.includes('interceptor') || key.includes('bomber')) return RADAR_CLASS.fighter;
  if (key.includes('drone')) return RADAR_CLASS.drone;
  if (key.includes('freighter') || key.includes('tanker') || key.includes('container') || key.includes('shuttle')
    || key.includes('hauler') || key.includes('tug') || key.includes('smuggler') || key.includes('megafreighter')) return RADAR_CLASS.freighter;
  if (key.includes('harvester') || key.includes('belter') || key.includes('refinery') || key.includes('surveyor')) return RADAR_CLASS.mining;
  if (key.includes('platform')) return RADAR_CLASS.platform;
  if (key.includes('station')) return RADAR_CLASS.station;
  return entity?.isCapitalShip ? RADAR_CLASS.battleship : RADAR_CLASS.unknown;
}

// Fala aktywnego skanu (X): rusza z okrętu powoli i rozpędza się do prędkości fali czujników okrętu
// (Atlas 60 km/s). Stała prędkość przechodziła kadr (~5 km) w 2–3 klatki — fali nie było widać; tu
// r(t) = v·t² / (t + τ): pierwsze ~5 km ~0,3 s, 90 km ~2 s (dawniej 1,5 s). Ten sam profil liczy
// odsłanianie kontaktów w grze, tarcza radaru i fala w świecie.
export const SCAN_PULSE_RAMP = 0.7;

/** Promień fali po czasie t [s] przy prędkości docelowej v [j/s]. */
export function scanPulseRadius(t, v, ramp = SCAN_PULSE_RAMP) {
  const tt = Math.max(0, Number(t) || 0);
  return Math.max(0, Number(v) || 0) * tt * tt / (tt + ramp);
}

/** Czas dotarcia fali na odległość r (odwrotność scanPulseRadius). */
export function scanPulseTime(r, v, ramp = SCAN_PULSE_RAMP) {
  const d = Math.max(0, Number(r) || 0);
  const s = Math.max(1, Number(v) || 1);
  return (d + Math.sqrt(d * d + 4 * s * d * ramp)) / (2 * s);
}

// Nazwy planet w podpisach stacji (stacje planet nie mają własnych nazw — dawniej „STATION-EARTH”).
export const RADAR_PLANET_NAMES = Object.freeze({
  mercury: 'Merkury', venus: 'Wenus', earth: 'Ziemia', mars: 'Mars', jupiter: 'Jowisz', saturn: 'Saturn',
  uranus: 'Uran', neptune: 'Neptun', pluto: 'Pluton', ceres: 'Ceres'
});

/** Podpis stacji: własna nazwa, inaczej planeta + rodzaj („ZIEMIA · PORT K-7”; short — „ZIEMIA K-7”). */
export function radarStationLabel(st, short = false) {
  if (!st) return 'STACJA';
  if (typeof st.name === 'string' && st.name.trim()) return st.name.trim().toUpperCase();
  const pid = String(st.planet?.id || st.id || '').toLowerCase();
  const planet = RADAR_PLANET_NAMES[pid];
  if (planet && short) return `${planet.toUpperCase()}${st.ringPort ? ' K-7' : ''}`;
  if (planet) return `${planet.toUpperCase()} · ${st.ringPort ? 'PORT K-7' : st.abandoned ? 'STACJA OPUSZCZONA' : 'STACJA'}`;
  return st.id != null ? `STACJA ${String(st.id).toUpperCase()}` : 'STACJA';
}

/** Zasięg tarczy: następny / poprzedni z RADAR_RANGES (bez zawijania, chyba że wrap). */
export function stepRadarRange(range, direction, wrap = false) {
  const n = RADAR_RANGES.length;
  let i = RADAR_RANGES.indexOf(range);
  if (i < 0) i = 2;
  let next = i + (direction > 0 ? 1 : direction < 0 ? -1 : 0);
  if (wrap) next = (next + n) % n;
  return RADAR_RANGES[Math.max(0, Math.min(n - 1, next))];
}

/** „20 km”, „7,5 km”, „850 m” — jak reszta kokpitu (1 j. = 1 m), przecinek dziesiętny. */
export function formatRadarDistance(metres) {
  const m = Math.abs(Number(metres) || 0);
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  const digits = km >= 100 ? 0 : km >= 10 ? 1 : 2;
  let text = km.toFixed(digits);
  if (text.includes('.')) text = text.replace(/\.?0+$/, '');
  return `${text.replace('.', ',')} km`;
}

/** Podpis pierścienia: „5k”, „2,5k”. */
export function formatRadarRing(metres) {
  const k = metres / 1000;
  return `${Number.isInteger(k) ? k : String(Math.round(k * 10) / 10).replace('.', ',')}k`;
}
