// src/game/sector/sectorRegistry.js
//
// OPIS UKŁADU Z SEKTORA → WPIS REJESTRU UKŁADÓW (`STAR_SYSTEMS`, `src/data/starSystems.js`). Funkcja czysta: ten sam
// sektor i id → ten sam wpis (zamrożony). Rejestr wpina orkiestrator; ten moduł NIE importuje `starSystems.js`
// (rejestr może budować się z sektora — import w drugą stronę byłby cyklem), a układy ręczne (Słońce:
// `SOL_SYSTEM`, `handmade: true`) podaje wołający w `handmade`.
//
// Wpis (pola jak `SOL_SYSTEM`):
//   { id, name, label,
//     star: { id: 'sun', spectral, r, color: { core, mid, rim } },
//     planets: [{ id, name, baseR, orbitAU, type, seed }],   // format `systemMap.js` + ziarno generatora planet
//     moons: [], home: null, handmade: false,
//     // dodatki mapy gwiezdnej (gra może je pominąć):
//     companion: { spectral, r, color } | null, belts: [{ id, kind, innerAU, outerAU }],
//     sector: { seed, version, x, y, zone, faction, catalog, nebula, pirateBase, gate } }
// Id planet i pasów są LOKALNE dla układu (`p3`, `pas1`); globalny id na mapie = `globalBodyId(id układu, id lokalny)`
// = id z opisu sektora (`hf-0042:p3`). `type` — rodzaj z listy wspólnej z generatorem planet (`PLANET_TYPES`; lista
// obejmuje dawne rodzaje `systemMap.js` 'rocky' / 'terran' / 'gas'). `name` planety = nazwa układu + litera jak w
// katalogach planet pozasłonecznych ('Tau Ceti b') — bez fragmentów 'earth' / 'mars' / 'jupiter', po których gra
// dopasowuje ring „Halo” (`normalizeRingPlanetKey`, test). Gwiazda ma lokalne id 'sun' (rola słońca układu w grze).
// Orbity w AU MAPY w skali Słońca; pierwsza orbita za studnią gwiazdy (`minOrbitAu`, `sectorBodies.js`).
// Księżyców generator sektora nie robi (`moons: []`) — do decyzji (generator planet albo kolejny krok sektora).

import { STAR_CLASSES } from './sectorStars.js';

const LETTERS = 'bcdefghijklmnopqrstuvwxyz';

/** Lokalny id ciała z id sektora: 'hf-0042:p3' → 'p3', 'sol:earth' → 'earth'. */
export function localBodyId(sectorBodyId) {
  const s = String(sectorBodyId || '');
  const i = s.indexOf(':');
  return i < 0 ? s : s.slice(i + 1);
}

/** Krótki podpis gwiazdy na radarze i w CIC (jak 'SOL'): nazwa wielkimi literami, długa — katalog / pierwsze słowo. */
export function systemLabel(sys) {
  const name = String(sys.name || sys.id).toUpperCase();
  if (name.length <= 14) return name;
  if (sys.catalog && sys.catalog !== sys.name && sys.catalog.length <= 14) return sys.catalog.toUpperCase();
  return name.split(/\s+/)[0].slice(0, 14);
}

function starEntry(classId, spectral, id = 'sun') {
  const cls = STAR_CLASSES[classId] || STAR_CLASSES.G;
  return Object.freeze({
    id,
    spectral,
    r: cls.sunRadius,
    color: Object.freeze({ core: cls.disk.core, mid: cls.disk.mid, rim: cls.disk.rim })
  });
}

/**
 * Wpis rejestru dla układu `systemId` z sektora (`generateSector`). Układ ręczny (`handmade[systemId]`) — zwraca go
 * bez zmian; Słońce bez wpisu ręcznego → null (jego treść jest ręczna: `SOL_SYSTEM`). Nieznany id → null.
 */
export function systemRegistryEntry(sector, systemId, { handmade = null } = {}) {
  const id = String(systemId || '').trim().toLowerCase();
  if (handmade && Object.prototype.hasOwnProperty.call(handmade, id)) return handmade[id];
  const sys = sector.byId.get(id);
  if (!sys || id === 'sol') return null;
  const planets = sys.planets.map((p, i) => Object.freeze({
    id: localBodyId(p.id),
    name: `${sys.name} ${LETTERS[i] || String(i + 1)}`,
    baseR: p.r,
    orbitAU: p.orbitAU,
    type: p.type,
    seed: p.seed
  }));
  const belts = sys.belts.map((b) => Object.freeze({ id: localBodyId(b.id), kind: b.kind, innerAU: b.innerAU, outerAU: b.outerAU }));
  return Object.freeze({
    id: sys.id,
    name: sys.name,
    label: systemLabel(sys),
    star: starEntry(sys.star, sys.spectral),
    planets: Object.freeze(planets),
    moons: Object.freeze([]),
    home: null,
    handmade: false,
    companion: sys.companion ? starEntry(sys.companion, null, 'sun-b') : null,
    belts: Object.freeze(belts),
    sector: Object.freeze({
      seed: sector.seed,
      version: sector.version,
      x: sys.x,
      y: sys.y,
      zone: sys.zone,
      faction: sys.faction,
      catalog: sys.catalog,
      nebula: sys.nebula,
      pirateBase: sys.pirateBase,
      gate: sys.gate
    })
  });
}

/**
 * Wszystkie układy sektora jako rejestr { id: wpis } (kolejność układów sektora). `handmade` — wpisy ręczne
 * (np. { sol: SOL_SYSTEM }) wchodzą w swoje miejsca; bez nich Słońca w wyniku nie ma.
 */
export function sectorRegistryEntries(sector, { handmade = null } = {}) {
  const out = {};
  for (const s of sector.systems) {
    const e = systemRegistryEntry(sector, s.id, { handmade });
    if (e) out[s.id] = e;
  }
  return Object.freeze(out);
}
