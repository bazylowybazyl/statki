/**
 * STOCZNIE I ZAPAS OKRĘTÓW.
 *
 * Domyka dziurę, która istnieje w gospodarce od początku: **komponenty T2 nie
 * mają odbiorcy**. Pomiar bilansu (`node scripts/analiza-ruchu.mjs`) pokazuje
 * nadmiar 52 silników, 44 rdzeni reaktorów i 41 podstaw uzbrojenia na godzinę —
 * cały układ pracuje na podzespoły okrętowe, których nikt nie zużywa.
 *
 * Stocznia je zjada i wypuszcza gotowe okręty. Okręt nie jest kursem ani encją,
 * tylko POZYCJĄ W ZAPASIE frakcji — dokładnie jak surowiec w magazynie. Ile
 * frakcja ma gotowych jednostek, tyle może wysłać na wojnę.
 *
 * Stocznię ma KAŻDA frakcja, nie tylko Mars. To ma konsekwencję ekonomiczną
 * większą niż sama wojna: Konsorcjum Zewnętrzne i Wewnętrzne nie produkują
 * podzespołów, więc żeby się zbroić, muszą je SPROWADZIĆ. Zbrojenie tworzy
 * popyt płynący przez cały układ, a odbudowa floty po przegranej bitwie —
 * konwoje z komponentami na trasach, na których czyhają piraci.
 */

import { RESOURCES } from '../../data/resources.js';
import { resourcePrice, scarcityMultiplier, PRICE_MODEL } from '../stationEconomy.js';
import { restockTarget } from './tradeMarket.js';
import { areFactionsHostile } from '../../data/factions.js';

/**
 * Klasy okrętów i ich koszt w podzespołach.
 *
 * `power` to siła bojowa w umownych punktach — używa jej dyspozytor wojskowy
 * do porównywania flot. Rośnie wolniej niż koszt, więc masa tanich jednostek
 * bije jeden drogi okręt, ale zajmuje więcej stanowisk i ginie szybciej.
 *
 * `hull` odsyła do istniejących profili kadłubów z `ships.js` — nie wymyślamy
 * nowych sylwetek.
 */
/**
 * `build` zawiera PODSTAWY uzbrojenia (`weapon_mount`) ORAZ to, co się na nich
 * montuje. Do 2026-08-20 był tam wyłącznie uchwyt — okręt schodził z pochylni
 * bez ani jednej lufy, a cała gospodarka produkowała miejsca do wkręcania
 * czegoś, czego nikt nie robił.
 *
 * Dobór dział mówi, do czego klasa służy: fregata ma jedno działo i wieżyczkę
 * OP, krążownik pełny miks z wyrzutnią, a nosiciel prawie same wieżyczki —
 * broni się myśliwcami, nie burtą.
 */
export const WARSHIP_CLASSES = Object.freeze({
  frigate: {
    id: 'frigate', label: 'fregata', hull: 'terran_frigate', power: 1, seconds: 600,
    build: {
      hull_plate: 4, avionics: 1, thruster: 1, weapon_mount: 1,
      gun_ballistic: 1, pd_turret: 1
    }
  },
  destroyer: {
    id: 'destroyer', label: 'niszczyciel', hull: 'terran_destroyer', power: 2.4, seconds: 1700,
    build: {
      hull_plate: 12, avionics: 2, thruster: 2, weapon_mount: 3, reactor_core: 1,
      gun_ballistic: 2, gun_energy: 1, pd_turret: 2
    }
  },
  cruiser: {
    id: 'cruiser', label: 'krążownik', hull: 'terran_battleship', power: 5.5, seconds: 4600,
    build: {
      hull_plate: 30, avionics: 6, thruster: 5, weapon_mount: 7, reactor_core: 3, life_support: 2,
      gun_ballistic: 4, gun_energy: 2, launcher_ordnance: 1, pd_turret: 4
    }
  },
  // Nosiciel schodzi z pochylni Z GRUPĄ LOTNICZĄ: dwie eskadry po dziewięć
  // maszyn. To one są jego bronią — dział ma mniej niż krążownik. Bez tej
  // pozycji nosiciel był najdroższym okrętem w grze, który nie miał czym
  // walczyć, a myśliwce brały się znikąd.
  carrier: {
    id: 'carrier', label: 'nosiciel', hull: 'terran_carrier', power: 9, seconds: 8800,
    build: {
      hull_plate: 60, avionics: 16, thruster: 9, weapon_mount: 7, reactor_core: 7, life_support: 14,
      gun_ballistic: 2, gun_energy: 1, launcher_ordnance: 2, pd_turret: 6,
      fighter_craft: 18
    }
  }
});

/**
 * DOKTRYNA FLOTY — jaki udział KADŁUBÓW ma mieć każda klasa.
 *
 * Zastępuje regułę „buduj największy okręt, na jaki cię stać". Tamta nie była
 * błędem AI, tylko poprawną odpowiedzią na złe liczby: przy poprzednim cenniku
 * nosiciel kosztował 6,5 fregaty, a dawał 9 punktów siły, więc każda inna
 * decyzja byłaby gorsza. Zmierzone: 98 zwodowanych okrętów, 98 nosicieli.
 *
 * Teraz koszt rośnie szybciej niż siła (patrz `node scripts/koszt-okretow.mjs`),
 * więc masa tanich kadłubów bije koncentrację na czystej wydajności. Duży okręt
 * kupuje się za coś innego niż punkty: za obecność, zasięg i to, że jednego
 * trudniej stracić naraz niż dwudziestu.
 *
 * Udziały liczone po sztukach, nie po sile — inaczej „25% niszczycieli"
 * oznaczałoby ich dziesięć razy mniej, niż sugeruje liczba.
 */
export const FLEET_DOCTRINE = Object.freeze({
  frigate: 0.60,
  destroyer: 0.24,
  cruiser: 0.13,
  carrier: 0.03
});

export const WARSHIP_ORDER = Object.freeze(
  Object.values(WARSHIP_CLASSES).sort((a, b) => b.power - a.power)
);

export const SHIPYARD_MODEL = Object.freeze({
  /**
   * Ile podzespołów wolno zabrać z magazynu stacji.
   *
   * Stocznia NIE MOŻE ogołocić portu — reszta przemysłu też potrzebuje płyt
   * i awioniki. Poniżej tego zapełnienia budowa się wstrzymuje, nawet jeśli
   * teoretycznie starczyłoby sztuk.
   */
  reserveFill: 0.2,
  /** Ile razy więcej niż koszt budowy port musi zatrzymać. Alternatywny,
   *  niezależny od skali magazynu próg — patrz . */
  keepMultiple: 3,
  /** Ile okrętów naraz może stać w budowie w jednej stoczni. */
  slots: 2,
  /**
   * LICYTACJA: o ile skup u innej stacji musi przebić cenę żądania portu,
   * żeby miejscowa stocznia odłożyła dla niej podzespół (`reservedForMarket`).
   *
   * Własna stocznia nie ma bezwzględnego pierwszeństwa — towar idzie do tego,
   * kto płaci więcej. 1,3 to marża kupca (12%) z rozstępem obu portów i zapasem
   * na koszt trasy: stocznia ustępuje dopiero wtedy, gdy kupcom NAPRAWDĘ opłaca
   * się ten podzespół wywieźć. W praktyce dzieje się to przy przyduszeniu
   * odbiorcy (stocznia bez podzespołów płaci do 2,6× więcej) albo gdy port
   * producenta jest pełniejszy od odbiorcy o kilkadziesiąt punktów procentowych.
   */
  outbidRatio: 1.3,
  /**
   * Powyżej tego zapełnienia stocznia buduje mimo przebicia. Towar, który
   * leży, choć ktoś go chce, znaczy, że nikt nie ma czym go zabrać — wtedy
   * stanie pochylni nikomu nie pomaga.
   */
  holdCeilingFill: 0.6
});

export function createShipyardRegistry() {
  return {
    yards: [],
    /** `frakcja` → { frigate: n, destroyer: n, ... } — gotowe do wysłania. */
    fleets: new Map(),
    stats: { built: 0, spent: 0, blocked: 0, byClass: {} }
  };
}

/** Wszystkie podzespoły, jakich potrzebuje jakakolwiek klasa okrętu. */
export const WARSHIP_COMPONENTS = Object.freeze([...new Set(
  Object.values(WARSHIP_CLASSES).flatMap(cls => Object.keys(cls.build))
)]);

/**
 * Stocznia stoi przy konkretnej stacji i buduje dla jej frakcji.
 *
 * `spec.station` jest opcjonalne, ale WARTO je podać: stocznia dopisuje wtedy
 * swoje zapotrzebowanie do `station.extraDemand`, dzięki czemu dyspozytor
 * transportu w ogóle wie, że tu trzeba wozić podzespoły. Bez tego buduje tylko
 * ta frakcja, która produkuje komponenty u siebie (zmierzone: 7 stoczni,
 * budował wyłącznie Mars).
 */
export function registerShipyard(registry, spec = {}) {
  if (spec.station) {
    const juz = new Set(spec.station.extraDemand || []);
    for (const id of WARSHIP_COMPONENTS) juz.add(id);
    spec.station.extraDemand = [...juz];
  }
  const yard = {
    id: String(spec.id || `stocznia-${registry.yards.length + 1}`),
    stationId: String(spec.stationId || ''),
    factionId: String(spec.factionId || ''),
    /** Mnożnik tempa — stocznia Marsa jest większa niż przyczółek. */
    weight: Math.max(0.1, Number(spec.weight) || 1),
    slots: Math.max(1, Math.floor(spec.slots ?? SHIPYARD_MODEL.slots)),
    /** Pochylnie: { classId, remaining }. */
    building: []
  };
  registry.yards.push(yard);
  return yard;
}

// ============================================================
// Zapas okrętów
// ============================================================

function fleetOf(registry, factionId) {
  const id = String(factionId || '');
  let fleet = registry.fleets.get(id);
  if (!fleet) registry.fleets.set(id, fleet = {});
  return fleet;
}

export function readyShips(registry, factionId, classId = null) {
  const fleet = registry.fleets.get(String(factionId || ''));
  if (!fleet) return 0;
  if (classId) return fleet[classId] || 0;
  return Object.values(fleet).reduce((sum, value) => sum + value, 0);
}

/** Siła bojowa całego zapasu frakcji — wejście dla dyspozytora wojskowego. */
export function fleetPower(registry, factionId) {
  const fleet = registry.fleets.get(String(factionId || ''));
  if (!fleet) return 0;
  let power = 0;
  for (const [classId, count] of Object.entries(fleet)) {
    power += (WARSHIP_CLASSES[classId]?.power || 0) * count;
  }
  return power;
}

export function addShips(registry, factionId, classId, count = 1) {
  const fleet = fleetOf(registry, factionId);
  fleet[classId] = (fleet[classId] || 0) + Math.max(0, Math.floor(count));
  return fleet[classId];
}

/**
 * Wydaje okręty na wyprawę — od najsilniejszych, do wyczerpania żądanej siły.
 * Zwraca to, co faktycznie udało się zebrać; frakcja bez floty zwraca pustkę.
 */
export function takeShips(registry, factionId, wantedPower) {
  const fleet = fleetOf(registry, factionId);
  const taken = {};
  let power = 0;
  let left = Math.max(0, Number(wantedPower) || 0);

  for (const cls of WARSHIP_ORDER) {
    const dostepne = fleet[cls.id] || 0;
    if (dostepne <= 0 || left <= 0) continue;
    const ile = Math.min(dostepne, Math.ceil(left / cls.power));
    if (ile <= 0) continue;
    fleet[cls.id] = dostepne - ile;
    taken[cls.id] = ile;
    power += cls.power * ile;
    left -= cls.power * ile;
  }
  return { ships: taken, power };
}

/** Ocalali wracają do zapasu. */
export function returnShips(registry, factionId, ships) {
  for (const [classId, count] of Object.entries(ships || {})) {
    if (count > 0) addShips(registry, factionId, classId, count);
  }
}

// ============================================================
// Budowa
// ============================================================

/** Czy stację stać na ten okręt, nie ogałacając własnego przemysłu. */
export function canAfford(econ, cls, options = {}) {
  if (!econ?.resources) return false;
  const reserved = options.reserved;
  const reserve = Number(options.reserveFill ?? SHIPYARD_MODEL.reserveFill);
  const keepRatio = Number(options.keepMultiple ?? SHIPYARD_MODEL.keepMultiple);

  for (const [id, need] of Object.entries(cls.build)) {
    const cap = Number(econ.capacity?.[id]) || 0;
    const stan = Number(econ.resources[id]) || 0;
    // Zapas roboczy portu jest nietykalny, ale liczony jako MNIEJSZA z dwóch
    // wartości: ułamek pojemności albo kilkukrotność tego, co pochłania budowa.
    //
    // Sam ułamek pojemności nie działa, bo magazyny skalują się z gospodarką:
    // przy skali ×60 próg wychodził 2880 sztuk KAŻDEGO podzespołu, więc budować
    // mogła wyłącznie stacja produkująca je u siebie. Zmierzone: siedem stoczni,
    // zwodował wyłącznie Mars.
    // Do tego zapas odłożony dla rynku: tyle, ile brakuje stoczniom, które
    // przelicytowały tę — patrz `reservedForMarket`.
    const keep = Math.max(Math.min(cap * reserve, need * keepRatio), reserved?.get(id) || 0);
    if (stan - need < keep) return false;
  }
  return true;
}

/**
 * Ile podzespołu miejscowa stocznia odkłada w tym kroku dla rynku.
 *
 * Stocznia płaci za podzespół tyle, ile jest wart w JEJ porcie. Jeśli gdzie
 * indziej stacja, która go zużywa, płaci wyraźnie więcej (`outbidRatio`),
 * miejscowa stocznia nie kładzie stępki z zapasu, który tamta chce kupić —
 * do jej potrzeby (`restockTarget`), licząc z tym, co już leci, i dzieląc ją
 * między wszystkie stacje, które mają podzespół na zbyciu. Resztą buduje
 * normalnie. Gdy głodna stocznia dostanie swoje, jej cena spada i rezerwa
 * znika.
 *
 * Skup liczony przy zapasie z towarem w drodze; przyduszenie wchodzi tylko
 * wtedy, gdy nawet z nim stacja zostaje w głodzie. Liczy się tylko stacja
 * niewroga — tylko tam kupiec może podzespół zawieźć.
 *
 * `quotes` to notowania dyspozytora z tego ticku (`snapshotMarket`).
 */
export function reservedForMarket(quotes, stationId, econ, options = {}) {
  const reserved = new Map();
  const local = quotes?.get(stationId);
  if (!local || !econ?.resources) return reserved;
  const ratio = Number(options.outbidRatio ?? SHIPYARD_MODEL.outbidRatio);
  const ceiling = Number(options.holdCeilingFill ?? SHIPYARD_MODEL.holdCeilingFill);
  const half = PRICE_MODEL.spread / 2;
  for (const id of WARSHIP_COMPONENTS) {
    const own = resourcePrice(local.station, econ, id);
    if (!own || !(own.capacity > 0) || own.fill >= ceiling) continue;
    // Brak głodnego dzieli się między wszystkich, którzy mają podzespół na
    // zbyciu — inaczej cztery ośrodki producenckie odkładałyby każdy całość.
    let sellers = 0;
    for (const [, quote] of quotes) {
      const price = quote.prices.get(id);
      if (!price || !(price.capacity > 0)) continue;
      if (price.stored > restockTarget(price) + price.capacity * PRICE_MODEL.offerFloorFill) sellers++;
    }
    let units = 0;
    for (const [otherId, quote] of quotes) {
      if (otherId === stationId) continue;
      const price = quote.prices.get(id);
      if (!price || !price.wanted || !(price.capacity > 0)) continue;
      if (areFactionsHostile(local.station.factionId, quote.station.factionId)) continue;
      const position = price.stored + (price.inbound || 0);
      const missing = (restockTarget(price) - position) / Math.max(1, sellers);
      if (!(missing > 0)) continue;
      const fill = Math.min(1, position / price.capacity);
      const duress = fill < PRICE_MODEL.duressFill ? Math.max(1, price.duress || 1) : 1;
      const bid = price.unitMarket / Math.max(1, price.duress || 1) * duress
        * scarcityMultiplier(fill) * (1 - half);
      if (bid >= own.ask * ratio) units += missing;
    }
    if (units > 0) reserved.set(id, units);
  }
  return reserved;
}

function consume(econ, cls) {
  let value = 0;
  for (const [id, need] of Object.entries(cls.build)) {
    econ.resources[id] = (Number(econ.resources[id]) || 0) - need;
    value += (RESOURCES[id]?.value || 0) * need;
  }
  return value;
}

/**
 * Którą klasę położyć na pochylni.
 *
 * Bierze tę, której frakcji brakuje najbardziej względem doktryny — licząc
 * razem okręty gotowe i te już budowane we WSZYSTKICH jej stoczniach. Bez tego
 * drugiego składnika cztery stocznie jednocześnie kładłyby ten sam brakujący
 * kadłub i flota skakałaby wokół udziału zamiast do niego dążyć.
 *
 * Gdy na nic z doktryny nie starcza, ale stać na cokolwiek — kładzie to,
 * co się da. Pusta pochylnia nie jest oszczędnością.
 */
export function pickWarshipClass(registry, factionId, econ, options = {}) {
  const doctrine = options.doctrine || FLEET_DOCTRINE;
  const counts = { ...(registry.fleets.get(String(factionId || '')) || {}) };
  let total = Object.values(counts).reduce((a, b) => a + b, 0);

  for (const yard of registry.yards) {
    if (yard.factionId !== factionId) continue;
    for (const slip of yard.building) {
      counts[slip.classId] = (counts[slip.classId] || 0) + 1;
      total++;
    }
  }

  let best = null;
  let bestGap = -Infinity;
  for (const [classId, share] of Object.entries(doctrine)) {
    const cls = WARSHIP_CLASSES[classId];
    if (!cls || !canAfford(econ, cls, options)) continue;
    const gap = share - (counts[classId] || 0) / Math.max(1, total);
    if (gap > bestGap) { bestGap = gap; best = cls; }
  }
  return best;
}

/**
 * Jeden krok wszystkich stoczni.
 *
 * Stocznia buduje to, czego flocie brakuje wg doktryny — a nie największy
 * okręt, na jaki ją stać. Ta druga reguła wyglądała na emergentną („bogata
 * frakcja stawia krążowniki"), ale przy koszcie rosnącym wolniej niż siła
 * degenerowała się do jednej klasy: 98 zwodowanych okrętów, 98 nosicieli.
 *
 * Bogactwo nadal ma znaczenie, tylko inaczej: biedna frakcja nie ma z czego
 * położyć kadłuba wyższej klasy, więc jej doktryna sama spłaszcza się do
 * fregat, mimo że plan mówi co innego.
 */
export function tickShipyards(registry, dt, options = {}) {
  const getEconomy = options.getEconomy;
  if (typeof getEconomy !== 'function') return [];
  const step = Math.max(0, Number(dt) || 0);
  const events = [];
  const quotes = typeof options.quotes === 'function' ? options.quotes() : options.quotes;

  for (const yard of registry.yards) {
    const econ = getEconomy(yard.stationId);
    if (!econ) continue;

    // 1. Postęp na pochylniach.
    for (let i = yard.building.length - 1; i >= 0; i--) {
      const slip = yard.building[i];
      slip.remaining -= step * yard.weight;
      if (slip.remaining > 0) continue;
      yard.building.splice(i, 1);
      addShips(registry, yard.factionId, slip.classId, 1);
      registry.stats.built++;
      registry.stats.byClass[slip.classId] = (registry.stats.byClass[slip.classId] || 0) + 1;
      events.push({ type: 'built', yardId: yard.id, factionId: yard.factionId, classId: slip.classId });
    }

    // 2. Wolne pochylnie biorą to, czego brakuje flocie — z podzespołów,
    //    których nie przelicytowała stocznia głodniejsza od tej.
    if (yard.building.length >= yard.slots) continue;
    const reserved = quotes ? reservedForMarket(quotes, yard.stationId, econ, options) : null;
    const yardOptions = reserved?.size ? { ...options, reserved } : options;
    while (yard.building.length < yard.slots) {
      const cls = pickWarshipClass(registry, yard.factionId, econ, yardOptions)
        || WARSHIP_ORDER.find(candidate => canAfford(econ, candidate, yardOptions));
      if (!cls) {
        registry.stats.blocked++;
        if (reserved?.size) registry.stats.yielded = (registry.stats.yielded || 0) + 1;
        break;
      }
      registry.stats.spent += consume(econ, cls);
      yard.building.push({ classId: cls.id, remaining: cls.seconds });
      events.push({ type: 'laid', yardId: yard.id, factionId: yard.factionId, classId: cls.id });
    }
  }
  return events;
}

/** Migawka do panelu: kto ile ma i co buduje. */
export function summarizeShipyards(registry) {
  const factions = [...registry.fleets.keys()].map(factionId => ({
    factionId,
    ready: readyShips(registry, factionId),
    power: Math.round(fleetPower(registry, factionId) * 10) / 10,
    byClass: { ...registry.fleets.get(factionId) }
  })).sort((a, b) => b.power - a.power);

  return {
    yards: registry.yards.length,
    building: registry.yards.reduce((sum, yard) => sum + yard.building.length, 0),
    factions,
    stats: { ...registry.stats, byClass: { ...registry.stats.byClass } }
  };
}
