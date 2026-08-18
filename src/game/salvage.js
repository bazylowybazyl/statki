/**
 * SALVAGE — łup z wraków.
 *
 * Problem, który ten moduł rozwiązuje: `spawnWreckEntity` kopiuje do wraku
 * hexGrid i fizykę, ale nie wie NIC o tym, czym statek był uzbrojony. Uzbrojenie
 * znikało w momencie śmierci. Tutaj powstaje "manifest łupu" — spis broni
 * i materiałów — który wędruje z rodzica na fragmenty przy każdym rozpadzie.
 *
 * Dwie ścieżki odzysku:
 *   CIĘCIE W POLU — szybkie, daje złom i część materiałów, broń przepada
 *                   (nie da się wyciąć działa bez doku).
 *   HOLOWANIE     — wrak przywleczony do stoczni oddaje wszystko, z bronią
 *                   w całości.
 *
 * Broń zapamiętuje komórkę kadłuba (`c,r`), do której była przykręcona, więc
 * odlatuje z TYM fragmentem, który odstrzelisz — nie losowym.
 */

import { RESOURCES } from '../data/resources.js';

// ============================================================
// Strojenie
// ============================================================

/** Materiały na jedną komórkę strukturalną kadłuba. */
const SALVAGE_PER_SHARD = Object.freeze({
  scrap: 0.14,
  steel: 0.022
});

/**
 * Komponenty odzyskiwane w całości — jeden na N komórek. Progi rosną z rangą
 * podzespołu, więc myśliwiec da tylko złom, a okręt liniowy realny rdzeń reaktora.
 */
const SALVAGE_COMPONENTS = Object.freeze([
  { id: 'hull_plate', perShards: 210 },
  { id: 'thruster', perShards: 680 },
  { id: 'avionics', perShards: 820 },
  { id: 'life_support', perShards: 1150 },
  { id: 'reactor_core', perShards: 1500 },
  { id: 'weapon_mount', perShards: 1900 }
]);

/** Ile materiałów oddaje cięcie w polu. Reszta zostaje w konstrukcji. */
const FIELD_CUT_MATERIAL_RATIO = 0.4;

/** Złom jest lekki do wycięcia — wychodzi w całości niezależnie od reszty. */
const FIELD_CUT_SCRAP_RATIO = 1.0;

/** Ile komórek strukturalnych zjada sekunda cięcia. */
export const FIELD_CUT_SHARDS_PER_SECOND = 34;

/** Zasięg, w którym da się ciąć wrak. */
export const FIELD_CUT_RANGE = 900;

/** Odległość od stacji, przy której holowany wrak trafia na rozbiórkę. */
export const DOCK_DELIVERY_RANGE = 1400;

// ============================================================
// Budowa manifestu
// ============================================================

function shardCount(entity) {
  const grid = entity?.hexGrid;
  if (!grid) return 0;
  return Math.max(
    0,
    Number(grid.baseStructuralCount) || Number(grid.activeStructuralCount) || grid.shards?.length || 0
  );
}

/** Zbiera zamontowaną broń — działa tak samo dla gracza i NPC. */
function collectMountedWeapons(entity) {
  const out = [];
  const seen = new Set();

  const pushHardpoint = (hp) => {
    if (!hp || hp.destroyed) return;
    const weaponId = hp.mount;
    if (!weaponId || seen.has(hp)) return;
    seen.add(hp);
    out.push({
      weaponId: String(weaponId),
      type: String(hp.type || 'main'),
      x: Number(hp.x) || 0,
      y: Number(hp.y) || 0
    });
  };

  const editorHardpoints = entity?.editorHardpoints;
  if (Array.isArray(editorHardpoints)) {
    for (const hp of editorHardpoints) pushHardpoint(hp);
  }

  // Dla gracza `hardpoints` jest tablicą mountów. Część NPC przechowuje pod
  // tą samą nazwą wyłącznie liczebność slotów, np. `{ large: 4, medium: 4 }`.
  // Taki rekord jest metadanymi kadłuba, a nie kolekcją, po której można
  // iterować; fizyczne mounty NPC są już wyżej w `editorHardpoints`.
  const hardpoints = entity?.hardpoints;
  if (Array.isArray(hardpoints)) {
    for (const hp of hardpoints) pushHardpoint(hp);
  }

  return out;
}

/**
 * Przelicza pozycję hardpointu (piksele sprite'a źródłowego, środek w zerze)
 * na komórkę kratownicy heksów i zapamiętuje jej klucz `c,r`.
 * Bez tego nie wiadomo, z którym fragmentem ma odlecieć działo.
 */
function anchorWeaponsToCells(entity, weapons) {
  const grid = entity?.hexGrid;
  const shards = grid?.shards;
  if (!Array.isArray(shards) || !shards.length) return;

  const scaleX = Number(entity.__hardpointScaleX) || Number(entity.__hardpointScale) || 1;
  const scaleY = Number(entity.__hardpointScaleY) || Number(entity.__hardpointScale) || 1;
  const cx = (Number(grid.srcWidth) || 0) * 0.5;
  const cy = (Number(grid.srcHeight) || 0) * 0.5;

  for (const weapon of weapons) {
    const gx = cx + weapon.x * scaleX;
    const gy = cy + weapon.y * scaleY;
    let best = null;
    let bestD2 = Infinity;
    for (const shard of shards) {
      const dx = (Number(shard.gridX) || 0) - gx;
      const dy = (Number(shard.gridY) || 0) - gy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = shard;
      }
    }
    if (best) weapon.cell = `${best.c},${best.r}`;
  }
}

function buildMaterials(entity, shards) {
  const materials = {};
  if (shards <= 0) return materials;

  // Wrak asteroidy oddaje rudę swojego typu, nie złom po statku.
  // To ta sama ścieżka, którą później wykorzysta wydobycie w pasach.
  const asteroidResource = entity?.asteroidRef?.resource;
  if (entity?.isAsteroidHex) {
    if (asteroidResource && RESOURCES[asteroidResource]) {
      materials[asteroidResource] = Math.max(1, Math.round(shards * 0.22));
    }
    return materials;
  }

  for (const [id, perShard] of Object.entries(SALVAGE_PER_SHARD)) {
    const amount = Math.round(shards * perShard);
    if (amount > 0) materials[id] = amount;
  }
  for (const { id, perShards } of SALVAGE_COMPONENTS) {
    const amount = Math.floor(shards / perShards);
    if (amount > 0) materials[id] = amount;
  }

  // Ładunek, który jednostka wiozła w chwili śmierci — tak zestrzelony
  // frachtowiec zostawia we wraku to, co faktycznie miał w ładowni.
  // To jest cały sens piractwa: łup jest tym, co ktoś naprawdę wiózł.
  for (const [id, amount] of Object.entries(entity?._extraSalvage || {})) {
    const whole = Math.round(Number(amount) || 0);
    if (RESOURCES[id] && whole > 0) materials[id] = (materials[id] || 0) + whole;
  }
  return materials;
}

/**
 * Buduje manifest raz, dopóki kadłub jest jeszcze w całości. Wołane leniwie
 * przy pierwszym rozpadzie — wcześniej nie ma po co zajmować pamięci.
 */
export function ensureSalvageManifest(entity) {
  if (!entity || entity.isWreck) return entity?._salvage || null;
  if (entity._salvage) return entity._salvage;

  const shards = shardCount(entity);
  if (shards <= 0) return null;

  const weapons = collectMountedWeapons(entity);
  anchorWeaponsToCells(entity, weapons);

  entity._salvage = {
    weapons,
    materials: buildMaterials(entity, shards),
    sourceShards: shards,
    // Maleje z każdym odrywanym fragmentem — to mianownik przy dzieleniu łupu.
    remainingShards: shards,
    label: entity.displayName || entity.shipFrame || (entity.isAsteroidHex ? 'Asteroida' : 'Wrak')
  };
  return entity._salvage;
}

// ============================================================
// Podział przy rozpadzie
// ============================================================

function takeMaterialShare(source, ratio) {
  const taken = {};
  if (!source || ratio <= 0) return taken;
  for (const [id, amount] of Object.entries(source)) {
    const available = Number(amount) || 0;
    if (available <= 0) continue;
    // Ostatni fragment zabiera resztę — inaczej zaokrąglenia gubiłyby materiał.
    const want = ratio >= 1 ? available : Math.min(available, Math.round(available * ratio));
    if (want <= 0) continue;
    taken[id] = want;
    source[id] = available - want;
  }
  return taken;
}

/**
 * Przenosi udział łupu z rodzica na świeżo powstały wrak.
 * Materiały idą proporcjonalnie do liczby komórek, broń — za swoim kawałkiem
 * kadłuba. `hasCell(key)` odpowiada, czy komórka `c,r` odleciała z tym fragmentem;
 * predykat zamiast kolekcji, żeby rozpad nie alokował zbioru na każdy fragment.
 *
 * Udział liczony jest względem tego, co rodzicowi ZOSTAŁO, nie względem stanu
 * początkowego — inaczej przy rozpadzie na kilka fragmentów każdy kolejny
 * dostawałby coraz mniejszy ułamek tego samego łupu.
 */
export function transferSalvageToWreck(parent, wreck, hasCell, departingShards) {
  const manifest = ensureSalvageManifest(parent) || parent?._salvage;
  if (!manifest || !wreck) return null;

  const departing = Math.max(0, Number(departingShards) || 0);
  const remaining = Math.max(1, Number(manifest.remainingShards) || departing || 1);
  const ratio = Math.max(0, Math.min(1, departing / remaining));
  manifest.remainingShards = Math.max(0, remaining - departing);

  const claimed = [];
  if (Array.isArray(manifest.weapons) && manifest.weapons.length && typeof hasCell === 'function') {
    for (let i = manifest.weapons.length - 1; i >= 0; i--) {
      const weapon = manifest.weapons[i];
      if (!weapon.cell || !hasCell(weapon.cell)) continue;
      claimed.push(weapon);
      manifest.weapons.splice(i, 1);
    }
  }

  const materials = takeMaterialShare(manifest.materials, ratio);
  wreck._salvage = {
    weapons: claimed,
    materials,
    // Migawka stanu wyjściowego. Cięcie odmierza porcje WZGLĘDEM NIEJ, nie
    // względem reszty — inaczej każda porcja zabierałaby ułamek coraz
    // mniejszej kwoty i złom nigdy nie zszedłby do zera.
    materialsTotal: { ...materials },
    sourceShards: manifest.sourceShards,
    remainingShards: departing,
    label: manifest.label
  };
  return wreck._salvage;
}

/** Czyszczone przy zwrocie wraku do puli — inaczej łup wyciekłby do następnego. */
export function clearSalvage(entity) {
  if (!entity) return;
  entity._salvage = null;
  entity._cargoManifest = null;
}

// ============================================================
// Odczyt
// ============================================================

export function getSalvage(wreck) {
  return wreck?._salvage || null;
}

export function hasSalvage(wreck) {
  const salvage = wreck?._salvage;
  for (const amount of Object.values(wreck?._cargoManifest || {})) {
    if ((Number(amount) || 0) >= 1) return true;
  }
  if (!salvage) return false;
  if (salvage.weapons?.length) return true;
  // Próg to pełna sztuka, nie zero: po cięciu zostają ułamki, z których nic
  // już nie wypadnie, a wrak dalej kusiłby jako cel odzysku.
  for (const amount of Object.values(salvage.materials || {})) {
    if ((Number(amount) || 0) >= 1) return true;
  }
  return false;
}

/** Zwięzły opis do HUD-u i menu kontekstowego. */
export function describeSalvage(wreck) {
  const salvage = wreck?._salvage;
  const cargo = wreck?._cargoManifest || {};
  if (!salvage && !Object.keys(cargo).length) return null;
  const combinedMaterials = { ...(salvage?.materials || {}) };
  for (const [id, amount] of Object.entries(cargo)) {
    combinedMaterials[id] = (Number(combinedMaterials[id]) || 0) + (Number(amount) || 0);
  }
  const materials = Object.entries(combinedMaterials)
    .filter(([, amount]) => (Number(amount) || 0) > 0)
    .map(([id, amount]) => ({
      id,
      amount: Math.round(amount),
      label: RESOURCES[id]?.label || id
    }));
  return {
    label: salvage?.label || 'Wrak transportu',
    materials,
    weaponCount: salvage?.weapons?.length || 0,
    weapons: (salvage?.weapons || []).map(w => w.weaponId)
  };
}

// ============================================================
// Wydobycie
// ============================================================

/**
 * Cięcie w polu. Zwraca to, co faktycznie udało się wyciągnąć w tej porcji.
 * `portion` to ułamek wraku przerobiony w tym ticku (0..1).
 * Broń NIE wychodzi — do jej odzyskania trzeba doku.
 */
export function takeFieldCut(wreck, portion) {
  const salvage = wreck?._salvage;
  if (!salvage) return {};
  const share = Math.max(0, Math.min(1, Number(portion) || 0));
  if (share <= 0) return {};

  const yielded = {};
  for (const [id, amount] of Object.entries(salvage.materials || {})) {
    const available = Number(amount) || 0;
    if (available <= 0) continue;
    const ratio = id === 'scrap' ? FIELD_CUT_SCRAP_RATIO : FIELD_CUT_MATERIAL_RATIO;
    const base = Number(salvage.materialsTotal?.[id]) || available;
    const want = Math.min(available, base * share * ratio);
    const left = available - want;
    // Stan magazynu wraku zostaje ułamkowy, a wydajemy tylko PEŁNE sztuki, które
    // porcja przekroczyła. Reszta przechodzi na następny tick zamiast wyparować
    // przy zaokrągleniu — inaczej cięcie gubiłoby kilka procent łupu.
    const whole = Math.floor(available) - Math.floor(left);
    salvage.materials[id] = left;
    if (whole > 0) yielded[id] = whole;
  }
  return yielded;
}

/**
 * Rozbiórka w doku — wszystko, łącznie z bronią. Manifest zostaje opróżniony.
 */
export function takeDockSalvage(wreck) {
  const salvage = wreck?._salvage;
  if (!salvage) return { materials: {}, weapons: [] };

  const materials = {};
  for (const [id, amount] of Object.entries(salvage.materials || {})) {
    // ŚCINAMY w dół, nie zaokrąglamy. Po cięciu w polu zapas jest ułamkowy
    // (takeFieldCut wydaje tylko pełne przekroczone sztuki), a zaokrąglenie
    // w górę tworzyłoby materiał z niczego: wrak z 0.6 stali oddawałby 1 sztukę.
    const whole = Math.floor(Number(amount) || 0);
    if (whole > 0) materials[id] = whole;
  }
  const weapons = (salvage.weapons || []).map(w => w.weaponId);

  salvage.materials = {};
  salvage.weapons = [];
  return { materials, weapons };
}
