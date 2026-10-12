/**
 * RODZINY KOLIZYJNE PASA GŁÓWNEGO (etap A2 planu pasa realistycznego, 2026-10-12 — docs/PLAN-pas-realizm.md
 * § A2). Gęste pole to młoda rodzina kolizyjna (jak Karin, 5,8 mln lat): odłamki jednego ciała macierzystego —
 * stąd gęstość, pył i jednolity skład pola. Pole należy do JEDNEJ rodziny (szczyt pola → najbliższe ziarno
 * rodziny po promieniu, z rozrzutem kątowym), rodzina daje skład rud pola (typ macierzysty dominuje) i nazwę dla
 * gracza. Wybór — src/game/asteroidBeltField.js (`familyAt`, `_composeAt`).
 *
 *   au        półoś w AU MAPY (prawdziwa przeliczona liniowo: mapa = 33 + (a − 1,524) · 4,675 — umowa planu)
 *   sigmaAu   rozrzut promienia rodziny [AU mapy] (waga odległości szczytu pola od `au`) — wg wielkości rodziny:
 *             duże (Flora, Eunomia, Themis) szerzej, młoda Veritas wąsko
 *   spectral  typ macierzysty (do opisu); desc — skład dla gracza („węglowe, lód”)
 *   anchor    id ciała z src/data/smallBodies.js — rodzina siedzi przy ciele (Westa, Hygiea): jedno ziarno
 *             w miejscu ciała (kąt świata — gra podaje pozycje ciał), węższy rozrzut kątowy i STREFA wokół
 *             ciała (skład rodziny także w rzadkim pasie przy ciele)
 *   seeds     ziarna rodziny bez kotwicy: tyle miejsc na okręgu (kąty co 360° / seeds od fazy `phaseDeg`)
 *   ore       wagi rud (klucze ORE_ROCK_TYPES), dark — udział wypełniacza węglowego (rock_c) w polu rodziny
 *
 * Woda w pasie głównym siedzi w minerałach C (carbon_ore — woda związana) i pod skorupą D; odsłonięty biały
 * lód (`ice`) w pasie głównym najwyżej śladowo (≤ 3%) — zostaje dla Kuipera i komet (uwaga orkiestratora
 * 2026-10-12). Themis: C z lodem w rdzeniach (typ carbon_ice, gdy jest w ROCK_TYPES).
 *
 * Bez importów (dane czyta pole pasa, testy i skrypty Node).
 */
export const ASTEROID_FAMILIES = Object.freeze([
  {
    id: 'flora', label: 'Flora', au: 36.2, sigmaAu: 0.4, spectral: 'S', desc: 'krzemowe', seeds: 3, phaseDeg: 11,
    ore: { silicon: 0.5, iron: 0.18, copper: 0.1, titan: 0.08, basalt: 0.05, crystal: 0.05, carbon: 0.04 }, dark: 0
  },
  {
    id: 'vesta', label: 'Westa', au: 36.92, sigmaAu: 0.3, spectral: 'V', desc: 'bazaltowe', anchor: 'vesta',
    ore: { basalt: 0.6, silicon: 0.16, iron: 0.09, titan: 0.08, crystal: 0.05, copper: 0.02 }, dark: 0
  },
  {
    id: 'nysa', label: 'Nysa-Polana', au: 37.2, sigmaAu: 0.3, spectral: 'S / C', desc: 'krzemowe i węglowe', seeds: 3, phaseDeg: 197,
    ore: { silicon: 0.36, carbon: 0.34, iron: 0.1, copper: 0.07, titan: 0.06, crystal: 0.05, metal: 0.02 }, dark: 0.45
  },
  {
    id: 'eunomia', label: 'Eunomia', au: 38.2, sigmaAu: 0.4, spectral: 'S', desc: 'krzemowe', seeds: 3, phaseDeg: 263,
    ore: { silicon: 0.5, iron: 0.16, copper: 0.1, titan: 0.08, metal: 0.06, crystal: 0.05, platinum: 0.02, carbon: 0.03 }, dark: 0.2
  },
  {
    id: 'koronis', label: 'Koronis (Karin)', au: 39.3, sigmaAu: 0.3, spectral: 'S', desc: 'krzemowe, młoda gromada Karin', seeds: 3, phaseDeg: 2,
    ore: { silicon: 0.52, iron: 0.15, copper: 0.1, titan: 0.08, crystal: 0.07, metal: 0.05, carbon: 0.03 }, dark: 0.3
  },
  {
    id: 'eos', label: 'Eos', au: 40.0, sigmaAu: 0.35, spectral: 'K (S / M)', desc: 'krzemowe i metaliczne', seeds: 3, phaseDeg: 126,
    ore: { silicon: 0.34, metal: 0.3, iron: 0.1, carbon: 0.08, titan: 0.06, platinum: 0.05, crystal: 0.05, copper: 0.02 }, dark: 0.55
  },
  {
    id: 'themis', label: 'Themis', au: 40.5, sigmaAu: 0.5, spectral: 'C', desc: 'węglowe, lód', seeds: 3, phaseDeg: 46,
    ore: { carbon: 0.44, carbon_ice: 0.36, silicon: 0.05, metal: 0.04, crystal: 0.06, primitive: 0.03, ice: 0.02 }, dark: 0.95
  },
  {
    id: 'hygiea', label: 'Hygiea', au: 40.55, sigmaAu: 0.3, spectral: 'C', desc: 'węglowe', anchor: 'hygiea',
    ore: { carbon: 0.72, primitive: 0.07, silicon: 0.06, metal: 0.05, crystal: 0.06, ice: 0.02, platinum: 0.02 }, dark: 0.95
  },
  {
    id: 'veritas', label: 'Veritas', au: 40.7, sigmaAu: 0.15, spectral: 'C', desc: 'węglowe, młoda', seeds: 3, phaseDeg: 296,
    ore: { carbon: 0.74, silicon: 0.07, metal: 0.06, crystal: 0.06, primitive: 0.05, ice: 0.01, titan: 0.01 }, dark: 0.95
  }
].map((f) => Object.freeze({ ...f, ore: Object.freeze({ ...f.ore }) })));

export const ASTEROID_FAMILY_BY_ID = Object.freeze(Object.fromEntries(ASTEROID_FAMILIES.map((f) => [f.id, f])));

/**
 * Regiony, które same są „rodziną” (jeden skład, nazwa dla gracza): rezonansowe roje przy Jowiszu.
 * Klucz — `beltId` regionu (src/data/asteroidTypes.js).
 */
export const REGION_FAMILIES = Object.freeze({
  hildas: Object.freeze({ id: 'hildas', label: 'Hildy', title: 'Hildy', spectral: 'D / P', desc: 'prymitywne, ciemne' }),
  greeks: Object.freeze({ id: 'greeks', label: 'Trojańczycy L4', title: 'Trojańczycy L4 (Grecy)', spectral: 'D / P', desc: 'prymitywne' }),
  trojans: Object.freeze({ id: 'trojans', label: 'Trojańczycy L5', title: 'Trojańczycy L5', spectral: 'D / P', desc: 'prymitywne' })
});

/**
 * Strojenie przypisania (asteroidBeltField.js).
 *   cellSize      bok komórki pamięci przypisań [j. świata]: rodzina liczona raz na komórkę (wejście pod górę
 *                 szumu pól od jej środka), skład między komórkami — dwuliniowo (miękkie granice na siodłach)
 *   climbOctaves  oktawy szumu pól przy wchodzeniu na szczyt (2 — kształt pola bez drobnych garbów)
 *   sigmaArcAu    rozrzut kątowy ziarna rodziny bez kotwicy [AU mapy wzdłuż łuku]; anchorArcAu — z kotwicą
 *   depth         pole (głębokość 0 … 1) → udział składu rodziny: smoothstep(depth[0], depth[1], głębokość)
 *   anchorZone    strefa rodziny przy ciele poza polami: rozrzut [promień AU, łuk AU] i najwyższy udział
 *   peakScan*     lista szczytów pól (familyPeaks): krok siatki startów [j.], zapas pierścienia [AU], scalanie
 *                 szczytów bliżej niż peakDedupe [j.]; komórka pamięci trafia w szczyt listy w promieniu peakMatch
 *   anchorClaim   rodzina z kotwicą bierze szczyt najbliższy ciału: wagi Δr [AU] i łuku [AU], granice
 */
export const BELT_FAMILY_CONFIG = Object.freeze({
  cellSize: 15000,
  climbOctaves: 2,
  sigmaArcAu: 30,
  anchorArcAu: 8,
  depth: Object.freeze([0.05, 0.35]),
  anchorZone: Object.freeze({ radiusAu: 0.35, arcAu: 3.5, share: 0.85 }),
  peakScanStep: 60000,
  peakScanPadAu: 2,
  peakDedupe: 3000,
  peakMatch: 6000,
  anchorClaim: Object.freeze({ dr: 1, arc: 20, maxDr: 2, maxArcDeg: 75 })
});

/** Napis dla gracza: „Rodzina Themis · węglowe, lód”. */
export function familyTitle(f) {
  if (!f) return '';
  return `${f.title || `Rodzina ${f.label}`} · ${f.desc}`;
}
