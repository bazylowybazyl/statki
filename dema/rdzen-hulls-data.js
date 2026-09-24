// Dane kadłubów dema rdzenia — wspólne dla przeglądarki i node (bez DOM).
// Współrzędne rdzeni: przestrzeń PNG sprite'a, (0,0) = środek, +X = dziób,
// dokładnie jak `cores[]` w src/data/hardpointEditorDefaults.js.
//
// `candidates` = miejsca do wyboru (demo przełącza je klawiszem / listą),
// `cores` = domyślny wybór dema. Uzasadnienie liczbami: docs/PORT-rdzen.md
// (głębokość = odległość od krawędzi maski, odstęp od hardpointów i dysz).

export const HULLS = Object.freeze({
  atlas: Object.freeze({
    id: 'atlas',
    label: 'Atlas',
    editorKey: 'atlas',
    renderProfile: 'atlas',
    spritePath: 'assets/capital_ship_rect_v1.png',
    pngWidth: 3747,
    pngHeight: 1677,
    player: true,
    hull: 12000,
    shield: 18000,
    mass: 800000,
    radius: 500,
    faction: 'player',
    npcType: 'atlas',
    candidates: Object.freeze([
      Object.freeze({ id: 'atlas_A', label: 'A: grzbiet między bankami ogniw (najgłębiej)', x: -830, y: 0, r: 56, armorMul: 3 }),
      Object.freeze({ id: 'atlas_B', label: 'B: grzbiet przed wieżą (bliżej śr. masy)', x: 70, y: 0, r: 52, armorMul: 3 }),
      Object.freeze({ id: 'atlas_C', label: 'C: para w bankach ogniw', x: -830, y: -180, r: 44, armorMul: 3, pair: true })
    ]),
    cores: Object.freeze([
      Object.freeze({ id: 'atlas_A', x: -830, y: 0, r: 56, armorMul: 3 })
    ])
  }),
  battleship: Object.freeze({
    id: 'battleship',
    label: 'Bellator',
    editorKey: 'battleship',
    renderProfile: 'terran_battleship',
    spritePath: 'src/assets/ships/terranbattleship.png',
    pngWidth: 1158,
    pngHeight: 714,
    player: false,
    hull: 12000,
    shield: 7200,
    mass: 50000,
    radius: 140,
    faction: 'terran',
    npcType: 'battleship',
    candidates: Object.freeze([
      Object.freeze({ id: 'bellator_A', label: 'A: blok rufowy (najgłębiej)', x: -320, y: 0, r: 48, armorMul: 3 }),
      Object.freeze({ id: 'bellator_B', label: 'B: właz grzbietu między toroidami', x: -219, y: -5, r: 44, armorMul: 3 }),
      Object.freeze({ id: 'bellator_C', label: 'C: para toroidów (pod wyrzutniami, płytko — odradzane)', x: -192, y: -112, r: 40, armorMul: 3, pair: true })
    ]),
    cores: Object.freeze([
      Object.freeze({ id: 'bellator_A', x: -320, y: 0, r: 48, armorMul: 3 })
    ])
  }),
  pirate_battleship: Object.freeze({
    id: 'pirate_battleship',
    label: 'Iron Skull',
    editorKey: 'pirate_battleship',
    renderProfile: 'pirate_battleship',
    spritePath: 'src/assets/ships/piratebattleship.png',
    pngWidth: 1158,
    pngHeight: 632,
    player: false,
    hull: 12000,
    shield: 7200,
    mass: 50000,
    radius: 140,
    faction: 'pirate',
    npcType: 'battleship',
    pirate: true,
    candidates: Object.freeze([
      Object.freeze({ id: 'skull_A', label: 'A: kopuła i kratka rufowa (najgłębiej)', x: -205, y: 0, r: 42, armorMul: 3 }),
      Object.freeze({ id: 'skull_B', label: 'B: płyta z czaszką (przy śr. masy)', x: -80, y: 0, r: 40, armorMul: 3 }),
      Object.freeze({ id: 'skull_C', label: 'C: śródokręcie pod napisem', x: 40, y: 10, r: 40, armorMul: 3 })
    ]),
    cores: Object.freeze([
      Object.freeze({ id: 'skull_A', x: -205, y: 0, r: 42, armorMul: 3 })
    ])
  })
});

export const HULL_IDS = Object.freeze(['atlas', 'battleship', 'pirate_battleship']);

// Barwa reaktora per frakcja (propozycja). Liniowe RGB „ciała” (pasmo barwy
// 0,4–1,3 przed ACES) — biały rdzeń liczy coreFx3D osobno.
export const REACTOR_COLORS = Object.freeze({
  terran: Object.freeze([0.22, 0.72, 1.0]),
  pirate: Object.freeze([1.0, 0.16, 0.34]),
  player: Object.freeze([0.62, 0.42, 1.0])
});

// Para rdzeni: kandydat z `pair: true` montuje lustrzane odbicie w osi X.
export function expandCandidate(candidate) {
  if (!candidate) return [];
  const base = { id: candidate.id, x: candidate.x, y: candidate.y, r: candidate.r, armorMul: candidate.armorMul };
  if (candidate.profile) base.profile = candidate.profile;
  if (!candidate.pair) return [base];
  return [
    { ...base, id: `${candidate.id}_L` },
    { ...base, id: `${candidate.id}_R`, y: -candidate.y }
  ];
}

// Encja kadłuba przed initHexBody — te same pola, co gra nadaje graczowi
// (pos/vel, hull.val/max, isPlayer, visual.spriteScale 1) i NPC (x/y, hp/maxHp,
// shield, promień szablonu, masa). Wspólne dla node i przeglądarki.
export function makeHullEntity(hullId, options = {}) {
  const def = HULLS[hullId];
  if (!def) throw new Error(`Nieznany kadłub ${hullId}`);
  const asPlayer = options.asPlayer ?? def.player === true;
  const x = Number(options.x) || 0;
  const y = Number(options.y) || 0;
  const angle = Number(options.angle) || 0;
  const shieldMax = def.shield;
  const shield = { val: options.shieldOn ? shieldMax : 0, max: shieldMax, regenRate: 0, regenDelay: 5 };
  const entity = asPlayer
    ? {
      isPlayer: true, pos: { x, y }, vel: { x: 0, y: 0 }, x, y, vx: 0, vy: 0, angle, angVel: 0,
      hull: { val: def.hull, max: def.hull }, shield, mass: def.mass, visual: { spriteScale: 1 },
      noSplit: options.noSplit ?? false
    }
    : {
      x, y, vx: 0, vy: 0, angle, angVel: 0, hp: def.hull, maxHp: def.hull, radius: def.radius,
      shield, mass: def.mass, type: def.npcType, isPirate: def.pirate === true,
      shipFrame: def.renderProfile, noSplit: options.noSplit ?? false
    };
  entity.__hullId = hullId;
  entity.__label = options.label || def.label;
  entity.faction = def.faction;
  return entity;
}
