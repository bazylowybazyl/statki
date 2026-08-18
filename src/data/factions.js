/**
 * FRAKCJE — warstwa własności w układzie.
 *
 * Wszystko w ekonomii wisi na tym, do kogo coś należy: flota miningowa, konwój,
 * baza w pasie, stacja działająca kontra opuszczona. Wcześniej „frakcja" istniała
 * tylko jako `npc.friendly` (boolean) plus roster call-inów — to nie udźwignie
 * świata, w którym trzy strony handlują ze sobą, a czwarta je okrada.
 *
 * Moduł jest czystą logiką bez importów i bez DOM — testowalny w node.
 *
 * Frakcja `null` = brak właściciela. To NIE jest błąd, tylko stan: opuszczona
 * stacja, dryfujący wrak, porzucona baza.
 */

// ============================================================
// Frakcje
// ============================================================

export const FACTION = Object.freeze({
  TERRA_NOVA: 'terra_nova',
  /** Stocznia. Wydzielona z Terra Nova — wojna potrzebuje terytoriów, a jedna
   *  frakcja obejmująca pół układu nie ma się z kim bić o nic. */
  MARS: 'mars_yards',
  /** Wenus i Merkury: rudy, huty, elektronika. Też wydzielone z Terra Nova. */
  INNER_CONSORTIUM: 'inner_consortium',
  BELT_UNION: 'belt_union',
  OUTER_CONSORTIUM: 'outer_consortium',
  PIRATES: 'pirates'
});

export const FACTIONS = Object.freeze({
  [FACTION.TERRA_NOVA]: {
    name: 'Terra Nova',
    short: 'TN',
    // Rdzeń przemysłowy: skupuje surowce, produkuje komponenty i okręty.
    color: '#38bdf8',
    accent: '#0ea5e9',
    homeStations: ['earth'],
    // UWAGA: `demands` i `supplies` NIE SĄ opisem. Czyta je `factionPriceProfile`
    // w stationEconomy.js i ustalają CENY LOKALNE (+15% za to, czego frakcja
    // chce, −15% za to, czego dostarcza). Na tych cenach żyją niezależni kupcy.
    // Ziemia nic nie wydobywa — żyje z przerobu, więc łaknie surowca.
    demands: ['iron_ore', 'copper_ore', 'silicon_ore', 'titanium_ore', 'raw_crystal'],
    supplies: ['copper_wire', 'titan_alloy', 'optic_lens', 'hull_plate', 'life_support'],
    playerStartReputation: 15
  },

  [FACTION.MARS]: {
    name: 'Stocznie Marsjańskie',
    short: 'STM',
    // Stocznia w stałym głodzie: zjada komponenty, oddaje gotowe podzespoły
    // okrętowe. Jedyne miejsce, gdzie przetapia się złom — i jedyne, które
    // ma powód budować okręty wojenne.
    color: '#fb7185',
    accent: '#e11d48',
    homeStations: ['mars'],
    demands: ['scrap', 'hull_plate', 'titan_alloy', 'copper_wire', 'fuel_rods', 'coolant'],
    supplies: ['thruster', 'reactor_core', 'weapon_mount', 'avionics'],
    playerStartReputation: 5
  },

  [FACTION.INNER_CONSORTIUM]: {
    name: 'Konsorcjum Wewnętrzne',
    short: 'KW',
    // Wenus i Merkury: kopalnie, huty, trawienie układów. Rdzeń wydobywczy
    // układu — z niego płynie 58% tonażu na Ziemię.
    color: '#fbbf24',
    accent: '#d97706',
    homeStations: ['mercury', 'venus'],
    demands: ['oxygen', 'polymer', 'fusion_fuel', 'coolant'],
    supplies: ['iron_ore', 'copper_ore', 'silicon_ore', 'titanium_ore', 'raw_crystal', 'steel', 'chips'],
    playerStartReputation: 0
  },
  [FACTION.BELT_UNION]: {
    name: 'Unia Pasa',
    short: 'UP',
    // Górnicy z Main Beltu. Żyją z rud, kupują wszystko przetworzone.
    color: '#fbbf24',
    accent: '#f59e0b',
    homeStations: ['ceres', 'vesta'],
    demands: ['polymer', 'coolant', 'oxygen', 'hull_plate', 'life_support'],
    supplies: ['iron_ore', 'copper_ore', 'silicon_ore', 'titanium_ore', 'raw_crystal', 'ice'],
    playerStartReputation: 0
  },
  [FACTION.OUTER_CONSORTIUM]: {
    name: 'Konsorcjum Zewnętrzne',
    short: 'KZ',
    // Olbrzymy gazowe: hel-3, metan, amoniak. Daleko, więc drogo.
    color: '#a78bfa',
    accent: '#8b5cf6',
    homeStations: ['jupiter', 'saturn', 'uranus'],
    demands: ['steel', 'chips', 'hull_plate', 'fuel_rods', 'life_support'],
    supplies: ['helium3', 'methane', 'ammonia', 'fusion_fuel', 'polymer'],
    playerStartReputation: 0
  },
  [FACTION.PIRATES]: {
    name: 'Piraci',
    short: 'PIR',
    color: '#f87171',
    accent: '#ef4444',
    // Kryjówki, nie porty. Dają wojnie ADRES: żadna para frakcji handlowych
    // nie jest wroga (sprawdzone — zero par), więc bez pirackich baz dyspozytor
    // wojenny nie ma na kogo uderzyć, a wraki nie mają skąd się wziąć.
    homeStations: ['gniazdo-hildy', 'zlomowisko'],
    // Piraci nic nie produkują — biorą. Handlują tylko łupem.
    demands: [],
    supplies: ['scrap'],
    playerStartReputation: -60
  }
});

export const FACTION_IDS = Object.freeze(Object.keys(FACTIONS));

/** Opis stanu bez właściciela — do UI, żeby nie sypać pustymi polami. */
export const DERELICT = Object.freeze({
  name: 'Opuszczona',
  short: '—',
  color: '#94a3b8',
  accent: '#64748b'
});

// ============================================================
// Wrogość między frakcjami
// ============================================================

/**
 * Stosunki NPC↔NPC. Wartości: 'ally' | 'neutral' | 'hostile'.
 *
 * Napięcie Terra Nova ↔ Unia Pasa jest celowe: to partnerzy handlowi, którzy
 * się nie lubią. Daje miejsce na przyszłe konflikty bez otwartej wojny.
 *
 * Pary zapisujemy w dowolnej kolejności — klucze normalizuje `stanceKey`
 * przy budowie mapy. Ręczne sortowanie wpisów było źródłem cichych pudeł:
 * relacja nie trafiała w tabelę i spadała na domyślne 'neutral'.
 */
/**
 * Stosunki na starcie. Wrogość BLOKUJE HANDEL w trzech miejscach warstwy ruchu
 * (`planShipment`, `nextShipment`, `findTradeOpportunities`), więc ta tabela
 * jest wejściem gospodarczym, nie fabularnym.
 *
 * Rdzeń — Konsorcjum Wewnętrzne → Ziemia → Mars — to 78% tonażu całego układu
 * (zmierzone: `node scripts/analiza-ruchu.mjs`). Te trzy MUSZĄ startować
 * pokojowo, inaczej gospodarka staje w miejscu, zanim ktokolwiek wypowie wojnę.
 * Konflikty mają wybuchać później, z rozgrywki — nie być wpisane w stan zerowy.
 */
const FACTION_STANCE_PAIRS = [
  // Rdzeń przemysłowy: sojusz, bo na nim stoi cały bilans.
  [FACTION.TERRA_NOVA, FACTION.MARS, 'ally'],
  [FACTION.TERRA_NOVA, FACTION.INNER_CONSORTIUM, 'ally'],
  [FACTION.MARS, FACTION.INNER_CONSORTIUM, 'ally'],
  // Reszta układu: handluje, ale bez zobowiązań.
  [FACTION.TERRA_NOVA, FACTION.OUTER_CONSORTIUM, 'ally'],
  [FACTION.MARS, FACTION.OUTER_CONSORTIUM, 'neutral'],
  [FACTION.INNER_CONSORTIUM, FACTION.OUTER_CONSORTIUM, 'neutral'],
  [FACTION.TERRA_NOVA, FACTION.BELT_UNION, 'neutral'],
  [FACTION.MARS, FACTION.BELT_UNION, 'neutral'],
  [FACTION.INNER_CONSORTIUM, FACTION.BELT_UNION, 'neutral'],
  [FACTION.BELT_UNION, FACTION.OUTER_CONSORTIUM, 'neutral'],
  // Piraci są wrodzy wszystkim.
  [FACTION.PIRATES, FACTION.TERRA_NOVA, 'hostile'],
  [FACTION.PIRATES, FACTION.MARS, 'hostile'],
  [FACTION.PIRATES, FACTION.INNER_CONSORTIUM, 'hostile'],
  [FACTION.PIRATES, FACTION.BELT_UNION, 'hostile'],
  [FACTION.PIRATES, FACTION.OUTER_CONSORTIUM, 'hostile']
];

function stanceKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const FACTION_STANCE = Object.freeze(
  FACTION_STANCE_PAIRS.reduce((map, [a, b, stance]) => {
    map[stanceKey(a, b)] = stance;
    return map;
  }, {})
);

/** Stosunek dwóch frakcji NPC. Ta sama frakcja = sojusz; brak właściciela = neutralnie. */
export function getFactionStance(a, b) {
  const idA = normalizeFaction(a);
  const idB = normalizeFaction(b);
  if (!idA || !idB) return 'neutral';
  if (idA === idB) return 'ally';
  return FACTION_STANCE[stanceKey(idA, idB)] || 'neutral';
}

export function areFactionsHostile(a, b) {
  return getFactionStance(a, b) === 'hostile';
}

// ============================================================
// Reputacja gracza
// ============================================================

export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;

/**
 * Progi nastawienia. Kolejność od najgorszego — `resolveStanding` bierze
 * pierwszy pasujący od góry.
 *
 * `priceMul` mnoży cenę ZAKUPU przez gracza (i odwrotnie premiuje sprzedaż),
 * `canDock` zamyka doki wrogom, `patrolsAttack` puszcza na gracza patrole.
 */
export const REPUTATION_TIERS = Object.freeze([
  { id: 'hostile', min: -100, label: 'Wrogi', priceMul: 1.0, canDock: false, patrolsAttack: true, color: '#ef4444' },
  { id: 'unfriendly', min: -49, label: 'Nieprzychylny', priceMul: 1.12, canDock: true, patrolsAttack: false, color: '#fb923c' },
  { id: 'neutral', min: -14, label: 'Neutralny', priceMul: 1.0, canDock: true, patrolsAttack: false, color: '#94a3b8' },
  { id: 'friendly', min: 15, label: 'Życzliwy', priceMul: 0.95, canDock: true, patrolsAttack: false, color: '#4ade80' },
  { id: 'allied', min: 50, label: 'Sojusznik', priceMul: 0.9, canDock: true, patrolsAttack: false, color: '#38bdf8' }
]);

export function clampReputation(value) {
  const n = Number(value) || 0;
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, n));
}

export function resolveStanding(reputation) {
  const value = clampReputation(reputation);
  let tier = REPUTATION_TIERS[0];
  for (const candidate of REPUTATION_TIERS) {
    if (value >= candidate.min) tier = candidate;
  }
  return tier;
}

/** Startowa mapa reputacji — nowa gra. */
export function createInitialReputation() {
  const out = {};
  for (const id of FACTION_IDS) {
    out[id] = clampReputation(FACTIONS[id].playerStartReputation);
  }
  return out;
}

/**
 * Kary i nagrody reputacyjne. Trzymane jako dane, żeby strojenie nie wymagało
 * grzebania w logice bojowej.
 */
export const REPUTATION_EVENTS = Object.freeze({
  killedShip: -6,
  killedCapital: -14,
  killedStation: -35,
  lootedDerelict: 0,      // porzucone jest niczyje — nikt się nie obraża
  tradedGoods: 0.4,       // regularny handel powoli ociepla stosunki
  killedTheirEnemy: 2     // wróg mojego wroga
});

/**
 * Zmiana reputacji rozlewa się na inne frakcje wg ich stosunku do poszkodowanej:
 * sojusznik też się obraża (w połowie), a jej wróg cieszy się (w ćwierci).
 */
export function applyReputationChange(reputation, factionId, delta) {
  const target = normalizeFaction(factionId);
  if (!target || !reputation) return reputation;
  const amount = Number(delta) || 0;
  if (amount === 0) return reputation;

  reputation[target] = clampReputation((Number(reputation[target]) || 0) + amount);

  for (const other of FACTION_IDS) {
    if (other === target) continue;
    const stance = getFactionStance(target, other);
    let spill = 0;
    if (stance === 'ally') spill = amount * 0.5;
    else if (stance === 'hostile') spill = -amount * 0.25;
    if (spill === 0) continue;
    reputation[other] = clampReputation((Number(reputation[other]) || 0) + spill);
  }
  return reputation;
}

// ============================================================
// Helpery
// ============================================================

export function normalizeFaction(source) {
  if (!source) return null;
  const id = typeof source === 'string' ? source : (source.factionId || source.faction);
  const key = String(id || '').trim().toLowerCase();
  return FACTIONS[key] ? key : null;
}

export function getFaction(factionId) {
  return FACTIONS[normalizeFaction(factionId)] || null;
}

export function getFactionName(factionId) {
  return getFaction(factionId)?.name || DERELICT.name;
}

export function getFactionColor(factionId) {
  return getFaction(factionId)?.color || DERELICT.color;
}

export function getFactionShort(factionId) {
  return getFaction(factionId)?.short || DERELICT.short;
}

/** Czy obiekt jest niczyj — opuszczona stacja, porzucona baza, dryfujący wrak. */
export function isDerelict(entity) {
  return !normalizeFaction(entity?.factionId ?? entity?.faction);
}

/**
 * Czy frakcja jest wroga graczowi. Piraci są wrodzy z definicji dopóki gracz
 * sobie u nich nie zasłuży; reszta zależy wyłącznie od reputacji.
 */
export function isFactionHostileToPlayer(factionId, reputation) {
  const id = normalizeFaction(factionId);
  if (!id) return false;
  return resolveStanding(reputation?.[id]).patrolsAttack;
}

/** Mnożnik ceny zakupu u danej frakcji. Sprzedaż dostaje odwrotność. */
export function getFactionPriceMultiplier(factionId, reputation) {
  const id = normalizeFaction(factionId);
  if (!id) return 1;
  return resolveStanding(reputation?.[id]).priceMul;
}

export function canDockWithFaction(factionId, reputation) {
  const id = normalizeFaction(factionId);
  if (!id) return true; // opuszczone doki nikogo nie odprawiają
  return resolveStanding(reputation?.[id]).canDock;
}

/** Domyślny właściciel stacji przy danej planecie. Null = opuszczona. */
export function getDefaultStationFaction(stationId) {
  const key = String(stationId || '').trim().toLowerCase();
  for (const id of FACTION_IDS) {
    if (FACTIONS[id].homeStations.includes(key)) return id;
  }
  return null;
}
