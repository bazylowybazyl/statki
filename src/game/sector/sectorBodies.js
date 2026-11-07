// src/game/sector/sectorBodies.js
//
// SKRÓT ZAWARTOŚCI UKŁADU: planety i pasy, z ziarna układu. Mapa gwiezdna nie buduje światów —
// podaje opis, z którego gra po wejściu do układu (przeładowanie strony z id układu) zbuduje
// planety generatorem planet (`src/3d/planetGen/`, sesja „Generator planet”) i pasy.
//
// Opis planety: `{ id, type, seed, orbitAU, r }` — `id` unikalne w CAŁYM sektorze (`<idUkładu>:<n>`,
// Słońce: `sol:earth`), `type` z listy wspólnej z generatorem planet (`PLANET_TYPES`), `seed` — u32 dla
// generatora, `orbitAU` — orbita w AU MAPY (jak `SYSTEM_MAP_PLANETS`: Ziemia 25, Neptun 120; świat układu
// mieści do 140 + 2 AU mapy), `r` — promień planety w świecie [j.] (jak `baseR`). Pas: `{ id, kind, innerAU,
// outerAU }` (`kind` 'asteroid' | 'ice').
//
// Rodzaj planety z TEMPERATURY ORBITY τ = orbitAU / (25 · hz gwiazdy): τ ≈ 1 — strefa życia (Ziemia),
// τ ≈ 2 — Jowisz, τ ≈ 4,8 — Neptun. Moduł czysty; jedyny import danych to tabela Układu Słonecznego.

import { SYSTEM_MAP_PLANETS } from '../../data/systemMap.js';
import { STAR_CLASSES } from './sectorStars.js';
import { SectorRng, hashU32 } from './sectorRandom.js';

/** Rodzaje planet — lista WSPÓLNA z generatorem planet (`src/3d/planetGen/`). */
export const PLANET_TYPES = Object.freeze([
  'terran', 'ocean', 'desert', 'rocky', 'ice', 'volcanic', 'barren', 'toxic', 'gas', 'ice_giant'
]);

/** Etykiety rodzajów (UI mapy). */
export const PLANET_TYPE_LABELS = Object.freeze({
  terran: 'ziemska', ocean: 'oceaniczna', desert: 'pustynna', rocky: 'skalista', ice: 'lodowa',
  volcanic: 'wulkaniczna', barren: 'martwa', toxic: 'toksyczna', gas: 'gazowy olbrzym', ice_giant: 'lodowy olbrzym'
});

/** Orbita mapy Ziemi — odniesienie strefy życia (τ = 1). */
export const HZ_ORBIT_AU = 25;
/** Najdalsza orbita planety [AU mapy] (Neptun 120; Kuiper Słońca 125–140, brzeg świata 142). */
export const MAX_ORBIT_AU = 122;

/** Układ Słoneczny — rodzaje z listy generatora planet (`systemMap.js` ma dawne 'rocky' / 'gas'). */
const SOL_TYPES = Object.freeze({
  mercury: 'barren', venus: 'toxic', earth: 'terran', mars: 'desert',
  jupiter: 'gas', saturn: 'gas', uranus: 'ice_giant', neptune: 'ice_giant'
});

/** Pasy Słońca (`BELT_DEFINITIONS` w `src/data/asteroidTypes.js`: główny 35,5–47, Kuiper 125–140). */
const SOL_BELTS = Object.freeze([
  Object.freeze({ id: 'sol:main', kind: 'asteroid', innerAU: 35.5, outerAU: 47 }),
  Object.freeze({ id: 'sol:kuiper', kind: 'ice', innerAU: 125, outerAU: 140 })
]);

/** Ciała Układu Słonecznego — stały rdzeń sektora (orbity i promienie z `SYSTEM_MAP_PLANETS`). */
export function solBodies() {
  const planets = SYSTEM_MAP_PLANETS.map((p) => Object.freeze({
    id: `sol:${p.id}`,
    type: SOL_TYPES[p.id] || p.type,
    seed: hashU32('sol', p.id),
    orbitAU: p.orbitAU,
    r: p.baseR
  }));
  return { planets: Object.freeze(planets), belts: SOL_BELTS };
}

/** Wagi rodzajów w paśmie temperatury τ. */
function typeWeights(tau, life, neutron) {
  if (neutron) return [['barren', 0.6], ['ice', 0.4]];
  if (tau < 0.45) return [['volcanic', 0.35], ['barren', 0.45], ['toxic', 0.2]];
  if (tau < 0.8) return [['toxic', 0.35], ['desert', 0.3], ['rocky', 0.2], ['barren', 0.15]];
  if (tau < 1.3) {
    return life
      ? [['terran', 0.28], ['ocean', 0.18], ['desert', 0.24], ['rocky', 0.2], ['toxic', 0.1]]
      : [['desert', 0.35], ['rocky', 0.35], ['barren', 0.3]];
  }
  if (tau < 1.9) return [['rocky', 0.3], ['desert', 0.15], ['ice', 0.25], ['barren', 0.3]];
  if (tau < 3.4) return [['gas', 0.6], ['ice_giant', 0.15], ['ice', 0.15], ['barren', 0.1]];
  return [['ice_giant', 0.45], ['gas', 0.2], ['ice', 0.25], ['barren', 0.1]];
}

/** Promień planety [j.] wg rodzaju (zakresy jak `baseR` Układu Słonecznego: 2000–3800). */
const RADIUS_RANGE = Object.freeze({
  terran: [2400, 3200], ocean: [2400, 3300], desert: [1800, 3000], rocky: [1500, 3000], ice: [1400, 2600],
  volcanic: [1500, 2800], barren: [1400, 2600], toxic: [2000, 3100], gas: [3500, 4400], ice_giant: [2300, 3000]
});

const isGiant = (type) => type === 'gas' || type === 'ice_giant';

/**
 * Planety i pasy układu z ziarna sektora. `sys` — { id, star, companion } (klasa gwiazdy głównej i
 * towarzysza). Ziarno ciał = hasz (ziarno sektora, id układu) — zawartość nie zależy od kolejności
 * generacji ani od liczby układów.
 */
export function generateSystemBodies(sectorSeed, sys) {
  const cls = STAR_CLASSES[sys.star] || STAR_CLASSES.G;
  const rng = new SectorRng(hashU32(sectorSeed, sys.id, 'ciała'));
  const binary = !!sys.companion;
  const neutron = sys.star === 'N';
  const [nMin, nMax] = cls.planets;
  // Podwójny: orbity okołopodwójne (od ~14 AU), o jedną planetę mniej.
  const count = Math.max(0, rng.int(nMin, nMax) - (binary ? 1 : 0));
  const hz = cls.hz;
  const planets = [];
  let a = binary ? rng.range(13, 18) : rng.range(6, 11);
  // Olbrzym (KIII) spalił wnętrze układu: orbity od ~20 AU.
  if (sys.star === 'KIII') a = rng.range(20, 28);
  for (let i = 0; i < count && a <= MAX_ORBIT_AU; i++) {
    const tau = a / (HZ_ORBIT_AU * hz);
    const type = rng.weighted(typeWeights(tau, cls.life, neutron));
    const [r0, r1] = RADIUS_RANGE[type];
    planets.push(Object.freeze({
      id: `${sys.id}:${i + 1}`,
      type,
      seed: hashU32(sectorSeed, sys.id, i + 1, type),
      orbitAU: Math.round(a * 100) / 100,
      r: Math.round(rng.range(r0, r1))
    }));
    // Odstępy jak Titius–Bode (×1,35–1,8) + przesunięcie; olbrzymy rozpychają orbity dalej.
    a = a * rng.range(1.35, 1.8) + rng.range(1, 4) + (isGiant(type) ? rng.range(4, 10) : 0);
  }
  const belts = [];
  // Pas planetoid: w największej przerwie między ostatnią skalistą a pierwszym olbrzymem (jak pas główny).
  if (rng.chance(neutron ? 0.7 : 0.55)) {
    const gi = planets.findIndex((p) => isGiant(p.type));
    let inner;
    let outer;
    if (gi > 0) {
      inner = planets[gi - 1].orbitAU;
      outer = planets[gi].orbitAU;
    } else if (planets.length) {
      inner = planets[planets.length - 1].orbitAU;
      outer = Math.min(MAX_ORBIT_AU, inner * 1.8 + 6);
    } else {
      inner = rng.range(12, 30);
      outer = inner * 1.6;
    }
    const gap = outer - inner;
    if (gap > 6) {
      const c = inner + gap * rng.range(0.4, 0.6);
      const w = Math.min(gap * 0.35, rng.range(4, 12));
      belts.push(Object.freeze({ id: `${sys.id}:pas1`, kind: 'asteroid', innerAU: round2(c - w / 2), outerAU: round2(c + w / 2) }));
    }
  }
  // Pas lodowy na skraju (jak Kuiper 125–140).
  if (rng.chance(0.6)) {
    const inner = Math.max(MAX_ORBIT_AU + 2, rng.range(118, 128));
    belts.push(Object.freeze({ id: `${sys.id}:pas${belts.length + 1}`, kind: 'ice', innerAU: round2(inner), outerAU: round2(Math.min(140, inner + rng.range(6, 14))) }));
  }
  return { planets: Object.freeze(planets), belts: Object.freeze(belts) };
}

function round2(v) { return Math.round(v * 100) / 100; }

/** Zliczenie rodzajów planet (UI, testy). */
export function countPlanetTypes(planets) {
  const out = {};
  for (const p of planets) out[p.type] = (out[p.type] || 0) + 1;
  return out;
}
