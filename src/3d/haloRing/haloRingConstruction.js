// Ring w budowie (Jowisz, decyzja użytkownika 2026-10-22: „unfinished”) — czysta matematyka,
// bez Three i DOM (gra, kolizje, radar, ruch v2 i render czytają te same liczby).
//
// Profil planety (`construction` w haloRingProfiles.js) podaje przerwy w płycie ringu: środek
// względem kąta stacji (kompleks portu 0) i pół-rozpiętość [rad], oraz szerokość frontu budowy
// [rad] — pasa na końcu zbudowanego segmentu, gdzie kratownica stoi, a obłożenie (pokład,
// podłoga, ściany) dopiero się kończy. Przerwa to PRAWDZIWY przelot w płaszczyźnie gry (jak
// tranzyt, tylko szeroki); front należy do płyty (kratownica jest przeszkodą). Hale K-7, zatoki
// i tranzyty stoją tylko na zbudowanych segmentach — `haloRingConstruction` sprawdza to przy
// budowie układu (przerwa na porcie albo tranzycie = błąd profilu).
import { HALO_PORT, HALO_STATION_ANGLE, HALO_TAU, HALO_TRANSIT, haloPortComplexAngles, haloTransitAngles } from './haloRingConfig.js';

const wrap = (a) => ((a % HALO_TAU) + HALO_TAU) % HALO_TAU;
// różnica kątów w (−π, π]
export const haloAngleDiff = (a, b) => {
  const d = wrap(a - b);
  return d > Math.PI ? d - HALO_TAU : d;
};

const NONE = Object.freeze({ gaps: Object.freeze([]), segments: Object.freeze([]), front: 0, active: false });

// Przerwy i zbudowane segmenty ringu z profilu planety. floorMid — promień podłogi (sprawdzenie
// odstępu od portu i tranzytów w jednostkach łuku).
export function haloRingConstruction(profile, floorMid = 54500) {
  const c = profile?.construction;
  if (!c?.gaps?.length) return NONE;
  const gaps = c.gaps
    .map((g) => ({ center: wrap(HALO_STATION_ANGLE + Number(g.at)), half: Math.max(0, Number(g.half) || 0) }))
    .filter((g) => g.half > 0)
    .sort((a, b) => a.center - b.center);
  const front = Math.max(0, Number(c.front) || 0);
  // port (kompleks: hala i zatoki z kołnierzem) i tranzyty (z portalem) muszą leżeć na segmentach
  const R = Math.max(1, Number(floorMid) || 54500);
  const portHalf = (Math.abs(HALO_PORT.dockOffsets[1]) + HALO_PORT.dockLength * 0.5 + HALO_PORT.collar) / R;
  const transitHalf = (HALO_TRANSIT.halfWidth + HALO_TRANSIT.wall + HALO_TRANSIT.frame + HALO_TRANSIT.apron) / R;
  for (const g of gaps) {
    for (const a of haloPortComplexAngles()) {
      if (Math.abs(haloAngleDiff(g.center, a)) < g.half + front + portHalf) throw new Error(`haloRingConstruction: przerwa ${g.center.toFixed(3)} na kompleksie portu`);
    }
    for (const a of haloTransitAngles()) {
      if (Math.abs(haloAngleDiff(g.center, a)) < g.half + front + transitHalf) throw new Error(`haloRingConstruction: przerwa ${g.center.toFixed(3)} na tranzycie`);
    }
  }
  // segmenty między przerwami (od końca przerwy i do początku następnej, kąty rosnące)
  const segments = gaps.map((g, i) => {
    const next = gaps[(i + 1) % gaps.length];
    const a0 = g.center + g.half;
    let a1 = next.center - next.half;
    while (a1 <= a0) a1 += HALO_TAU;
    return Object.freeze({ a0, a1 });
  });
  return Object.freeze({ gaps: Object.freeze(gaps.map((g) => Object.freeze(g))), segments: Object.freeze(segments), front, active: true });
}

// Indeks przerwy pod kątem θ (margines [rad] poszerza przerwę), −1 = zbudowany segment.
export function haloGapIndexAt(theta, construction, margin = 0) {
  const gaps = construction?.gaps;
  if (!gaps?.length) return -1;
  for (let i = 0; i < gaps.length; i++) {
    if (Math.abs(haloAngleDiff(theta, gaps[i].center)) < gaps[i].half + margin) return i;
  }
  return -1;
}

// Odległość kątowa od najbliższej krawędzi przerwy: > 0 na segmencie, < 0 w przerwie,
// Infinity bez przerw. Front budowy = 0 < d < construction.front.
export function haloGapEdgeDistance(theta, construction) {
  const gaps = construction?.gaps;
  if (!gaps?.length) return Infinity;
  let best = Infinity;
  for (let i = 0; i < gaps.length; i++) {
    const d = Math.abs(haloAngleDiff(theta, gaps[i].center)) - gaps[i].half;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}
