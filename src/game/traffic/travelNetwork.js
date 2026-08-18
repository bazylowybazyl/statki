/**
 * SIEĆ TRAS — węzły układu i wybór drogi.
 *
 * Nie ma tu żadnych pasów ani autostrad w próżni: statek leci prosto tam, gdzie
 * chce. Sieć opisuje wyłącznie te miejsca, w których przestrzeń faktycznie coś
 * wymusza — bramy przy dużych hubach, pola wydobywcze, stacje tankowania — oraz
 * to, ile kosztuje dostanie się między nimi.
 *
 * SEDNO: wybór napędu jest DECYZJĄ EKONOMICZNĄ, nie regułą.
 *
 *     koszt = paliwo × cena + opłata za bramę + wartość czasu + oczekiwana strata
 *
 * Nikt nie wpisuje „komponenty lecą warpem". To wychodzi samo: ładunek drogi za
 * tonę ma wysoką oczekiwaną stratę, więc opłaca mu się kupić nietykalność warpa.
 * Ruda jest tania i ciężka, więc woli zaryzykować i polecieć konwencjonalnie.
 * Stąd bierze się to, na czym stoi piractwo — i zmiana ceny paliwa albo aktywności
 * piratów sama przerysowuje ten podział.
 *
 * Geometria pochodzi z `systemMap.js`, więc przestawienie orbit przelicza tu wszystko.
 */

import { buildSystemMap } from '../../data/systemMap.js';

// ============================================================
// Napędy
// ============================================================

/**
 * Trzy sposoby podróży. Liczby są punktem wyjścia do strojenia suwakami —
 * w prototypie mają być ruchome, bo to one decydują, czy piractwo ma sens.
 *
 * `fuelPerUnit` to zużycie na jednostkę dystansu. Warp pali ~10× więcej na
 * jednostkę drogi I droższy surowiec, więc jest realnie kosztowny, a nie „lepszy".
 */
export const DRIVE_MODES = Object.freeze({
  conventional: Object.freeze({
    id: 'conventional',
    label: 'konwencjonalny',
    speed: 800,
    fuelId: 'hydrogen',
    fuelPerUnit: 1 / 40_000,
    /** Pełna ekspozycja na przechwyt — to jest cała trasa pirata. */
    risk: 1
  }),
  warp: Object.freeze({
    id: 'warp',
    label: 'warp',
    speed: 20_000,
    fuelId: 'fusion_fuel',
    // Skalibrowane wobec ŁADOWNI, nie z sufitu: typowy kurs w rdzeniu (~1 mln j.)
    // to ~17 t paliwa fuzyjnego przy ładowni haulera 160 t. Pierwsza wersja
    // (1/4000) dawała 263 t paliwa na kurs — więcej, niż statek unosi towaru,
    // i 26 tys. CR kosztu, przez co warp był martwą opcją dla każdego ładunku.
    fuelPerUnit: 1 / 60_000,
    /** Nietykalny z założenia. Dopóki nie ma disruptorów, to jest zero. */
    risk: 0
  }),
  gate: Object.freeze({
    id: 'gate',
    label: 'brama',
    /** Sam skok jest natychmiastowy; czas zjada dolot do bramy i od bramy. */
    speed: Infinity,
    fuelId: null,
    fuelPerUnit: 0,
    risk: 0
  })
});

/** Domyślne parametry ekonomiczne. Wszystkie do wystawienia na suwaki. */
export const NETWORK_DEFAULTS = Object.freeze({
  /** CR za jednostkę paliwa — bierze się z `RESOURCES[fuelId].value`, to fallback. */
  fuelPrice: Object.freeze({ hydrogen: 7, fusion_fuel: 100 }),
  /** Opłata za skok: stała plus od tony. Brama ma być TAŃSZA od warpa. */
  gateFeeBase: 250,
  gateFeePerTon: 1.2,
  /** Ile CR jest wart jeden przestój sekundy. Podnosi wagę czasu w rachunku. */
  timeValuePerSecond: 0.08,
  /**
   * Szansa przechwytu rośnie z ekspozycją: `1 - exp(-rate × dystans)`.
   * Domyślnie ~18% na milion jednostek lotu konwencjonalnego, czyli tyle, żeby
   * strata oczekiwana w ogóle liczyła się wobec kosztu paliwa. Przy 1% (pierwsza
   * wersja) ryzyko było szumem i wybór napędu zależał wyłącznie od paliwa —
   * a wtedy nie ma piractwa jako zjawiska ekonomicznego.
   */
  interceptRatePerUnit: 2e-7,
  /** Postój przy stanowisku — wchodzi w plan jako etap, nie jako kara. */
  dockServiceSeconds: 90
});

// ============================================================
// Węzły
// ============================================================

export const NODE_KIND = Object.freeze({
  STATION: 'station',
  GATE: 'gate',
  FIELD: 'field',
  DEPOT: 'depot'
});

/**
 * Bramy stoją TYLKO przy największych hubach — to była decyzja projektowa,
 * nie optymalizacja. Pomiar (`scripts/analiza-ruchu.mjs`) mówi, że Ziemia odbiera
 * 55% importu, a Ziemia z Marsem 82%, więc te dwie plus jeden przyczółek
 * w układzie zewnętrznym obsługują praktycznie cały ruch dalekobieżny.
 */
export const DEFAULT_GATE_HUBS = Object.freeze(['earth', 'mars', 'jupiter']);

/**
 * Jak daleko od macierzystej stacji wisi brama.
 *
 * To NIE jest detal kosmetyczny, tylko liczba, która decyduje o całym sensie bram.
 * Brama ma być tańsza od warpa, ale NIE szybsza — a jedyne, co ją spowalnia, to
 * dolot do niej i od niej na napędzie konwencjonalnym. Przy bramie tuż przy stacji
 * skok byłby jednocześnie tańszy i szybszy od warpa, więc warp stałby się martwy.
 *
 * 150 tys. j. to ~3 minuty dolotu z każdej strony.
 */
const DEFAULT_GATE_OFFSET_UNITS = 150_000;

function positionOnOrbit(orbitRadius, angle, centerX = 0, centerY = 0) {
  return { x: centerX + Math.cos(angle) * orbitRadius, y: centerY + Math.sin(angle) * orbitRadius };
}

export function distanceBetween(a, b) {
  return Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0));
}

/**
 * Buduje węzły układu na podstawie mapy z `systemMap.js`.
 *
 * `fields` to pola wydobywcze podawane w AU mapy — pas główny i Kuiper. Nie
 * bierzemy ich z `BELT_DEFINITIONS`, żeby ten moduł nie ciągnął za sobą
 * półmilionowej definicji asteroid; wystarczy promień i nazwa.
 */
export function buildTravelNetwork(options = {}) {
  const beltEdgeAu = Number(options.beltEdgeAu) || 140;
  const { auInWorldUnits, planets } = buildSystemMap(beltEdgeAu, {
    angleFor: options.angleFor || (() => 0),
    planetScale: options.planetScale
  });
  const gateHubs = new Set(options.gateHubs || DEFAULT_GATE_HUBS);
  const derelict = new Set(options.derelict || ['neptune']);
  const nodes = new Map();

  const add = node => { nodes.set(node.id, node); return node; };

  for (const planet of planets) {
    const pos = positionOnOrbit(planet.orbitRadius, planet.angle);
    add({
      id: planet.id,
      kind: NODE_KIND.STATION,
      label: planet.name,
      x: pos.x,
      y: pos.y,
      orbitRadius: planet.orbitRadius,
      angle: planet.angle,
      derelict: derelict.has(planet.id),
      /** Ile stanowisk — wejście dla kolejkowania slotowego. */
      berths: derelict.has(planet.id) ? 0 : (options.berthsPerStation ?? 6),
      hasGate: gateHubs.has(planet.id) && !derelict.has(planet.id)
    });

    if (gateHubs.has(planet.id) && !derelict.has(planet.id)) {
      // Brama siedzi na tej samej orbicie, kawałek dalej po kącie — żeby dolot
      // do niej był realnym odcinkiem, a nie zerem.
      const gateOffset = Number(options.gateOffsetUnits) || DEFAULT_GATE_OFFSET_UNITS;
      const gateAngle = planet.angle + gateOffset / Math.max(1, planet.orbitRadius);
      const gatePos = positionOnOrbit(planet.orbitRadius, gateAngle);
      add({
        id: `gate:${planet.id}`,
        kind: NODE_KIND.GATE,
        label: `Brama ${planet.name}`,
        x: gatePos.x,
        y: gatePos.y,
        stationId: planet.id,
        /** Przepustowość skoków na godzinę — wejście dla slotów. */
        throughputPerHour: options.gateThroughputPerHour ?? 90
      });
    }
  }

  // Stacje spoza tabeli planet: osady w asteroidach, przyczółki pirackie,
  // wszystko, co ma magazyn i cenę, ale nie krąży wokół planety. Dla warstwy
  // ruchu są nieodróżnialne od stacji planetarnych — mają pozycję, stanowiska
  // i frakcję, więc handel, doki, patrole i agenci obsługują je bez zmian.
  for (const outpost of options.outposts || []) {
    const radius = Number(outpost.orbitAU) * auInWorldUnits;
    const angle = Number(outpost.angle) || 0;
    const pos = positionOnOrbit(radius, angle);
    add({
      id: String(outpost.id),
      kind: NODE_KIND.STATION,
      label: outpost.label || outpost.id,
      x: Number.isFinite(outpost.x) ? outpost.x : pos.x,
      y: Number.isFinite(outpost.y) ? outpost.y : pos.y,
      orbitRadius: radius,
      angle,
      derelict: false,
      // Przyczółek jest mniejszy od portu planetarnego — mniej stanowisk,
      // brak pierścienia, ale to nadal pełnoprawny rynek.
      berths: outpost.berths ?? 4,
      hasGate: false,
      outpost: true
    });
  }

  for (const field of options.fields || []) {
    const radius = Number(field.orbitAU) * auInWorldUnits;
    const angle = Number(field.angle) || 0;
    const pos = positionOnOrbit(radius, angle);
    // Pole wydobywcze NIE JEST punktem — to wycinek pasa o szerokości setek
    // tysięcy jednostek. Trzymanie samego środka sprawiało, że wszyscy górnicy
    // lecieli dokładnie w to samo miejsce, jeden za drugim.
    const innerAu = Number(field.innerAU);
    const outerAu = Number(field.outerAU);
    add({
      id: field.id,
      kind: NODE_KIND.FIELD,
      label: field.label || field.id,
      x: pos.x,
      y: pos.y,
      orbitRadius: radius,
      angle,
      innerRadius: Number.isFinite(innerAu) ? innerAu * auInWorldUnits : radius * 0.88,
      outerRadius: Number.isFinite(outerAu) ? outerAu * auInWorldUnits : radius * 1.12,
      /** Połowa łuku, na którym rozstawiają się wyprawy. */
      arcSpread: Number(field.arcSpread) || 0.55,
      yields: field.yields || {},
      /** Ile ton na godzinę da się stąd wyciągnąć jedną wyprawą. */
      extractionSeconds: field.extractionSeconds ?? 600
    });
  }

  for (const depot of options.depots || []) {
    const host = nodes.get(depot.nearNodeId);
    if (!host) continue;
    add({
      id: depot.id,
      kind: NODE_KIND.DEPOT,
      label: depot.label || depot.id,
      x: host.x + (depot.offsetX || 0),
      y: host.y + (depot.offsetY || 0),
      nearNodeId: depot.nearNodeId,
      fuelId: depot.fuelId || 'hydrogen'
    });
  }

  return {
    auInWorldUnits,
    nodes,
    list: [...nodes.values()],
    gates: [...nodes.values()].filter(node => node.kind === NODE_KIND.GATE),
    stations: [...nodes.values()].filter(node => node.kind === NODE_KIND.STATION),
    fields: [...nodes.values()].filter(node => node.kind === NODE_KIND.FIELD),
    config: { ...NETWORK_DEFAULTS, ...(options.config || {}) }
  };
}

/**
 * Dokłada stację do GOTOWEJ sieci — w trakcie biegu, nie przy budowie.
 *
 * Istnieje dla stacji gracza. `buildTravelNetwork` zwraca `list`, `stations`
 * i `gates` jako migawki zrobione raz, więc samo dopisanie węzła do mapy jest
 * niewidoczne dla wszystkiego, co po nich iteruje: dyspozytor nie zna nowego
 * rynku, trasowanie go nie znajduje, a stacja stoi pusta i nikt do niej nie
 * leci. Ta funkcja aktualizuje mapę I tablice pochodne.
 *
 * Zwraca węzeł albo `null`, jeśli identyfikator jest już zajęty — cicha
 * podmiana istniejącej stacji byłaby gorsza niż odmowa.
 */
export function addStationNode(network, spec = {}) {
  if (!network?.nodes) return null;
  const id = String(spec.id || '');
  if (!id || network.nodes.has(id)) return null;

  const auInWorldUnits = network.auInWorldUnits || 1;
  const radius = Number.isFinite(spec.orbitAU) ? Number(spec.orbitAU) * auInWorldUnits : 0;
  const angle = Number(spec.angle) || 0;

  const node = {
    id,
    kind: NODE_KIND.STATION,
    label: spec.label || id,
    x: Number.isFinite(spec.x) ? spec.x : Math.cos(angle) * radius,
    y: Number.isFinite(spec.y) ? spec.y : Math.sin(angle) * radius,
    orbitRadius: radius,
    angle,
    derelict: false,
    berths: spec.berths ?? 4,
    // Brama to inwestycja największych hubów, nie przyczółka. Gracz dorabia
    // ją osobno, gdy stacja urośnie.
    hasGate: Boolean(spec.hasGate),
    outpost: spec.outpost !== false,
    factionId: spec.factionId || null
  };

  network.nodes.set(id, node);
  network.list.push(node);
  network.stations.push(node);
  if (node.hasGate) network.gates.push(node);
  return node;
}

export function getNode(network, nodeId) {
  return network?.nodes?.get(String(nodeId || '')) || null;
}

/**
 * Losuje własne miejsce wydobycia w obrębie pola.
 *
 * Każda wyprawa dostaje inny punkt, więc górnicy rozkładają się po pasie
 * zamiast ustawiać się w kolejkę do jednej współrzędnej. Losujemy pierwiastek
 * z promienia, żeby rozkład był równomierny po POWIERZCHNI, a nie zagęszczony
 * przy krawędzi wewnętrznej.
 */
export function randomFieldSpot(field, rng = Math.random) {
  if (!field) return null;
  const inner = Number(field.innerRadius) || field.orbitRadius * 0.9;
  const outer = Number(field.outerRadius) || field.orbitRadius * 1.1;
  const spread = Number(field.arcSpread) || 0.5;
  const radius = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
  const angle = field.angle + (rng() * 2 - 1) * spread;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Punkt manewrowy przy porcie: miejsce, z którego statek faktycznie rusza
 * w trasę i do którego wraca. Bez niego jednostki pojawiały się i znikały
 * skokiem na orbicie postojowej.
 */
export function approachPoint(node, layout, angle, radiusMultiplier = 1.15) {
  const radius = (layout?.parkingRadius || 40_000) * radiusMultiplier;
  return { x: node.x + Math.cos(angle) * radius, y: node.y + Math.sin(angle) * radius };
}

// ============================================================
// Wycena wariantu
// ============================================================

function fuelPriceOf(config, fuelId) {
  if (!fuelId) return 0;
  return Number(config?.fuelPrice?.[fuelId]) || 0;
}

/** Szansa, że kurs zostanie przechwycony na zadanej ekspozycji. */
export function interceptChance(exposedDistance, config = NETWORK_DEFAULTS, pressure = 1) {
  const rate = Math.max(0, Number(config.interceptRatePerUnit) || 0) * Math.max(0, pressure);
  return 1 - Math.exp(-rate * Math.max(0, exposedDistance));
}

/**
 * Wycenia gotowy wariant trasy. `legs` to odcinki `{ from, to, mode }`.
 *
 * Zwraca komplet składników, a nie samą liczbę — panel prototypu ma pokazywać,
 * DLACZEGO wygrał dany napęd. Bez tego strojenie jest zgadywaniem.
 */
export function priceRoute(network, legs, cargo = {}) {
  const config = network?.config || NETWORK_DEFAULTS;
  const mass = Math.max(0, Number(cargo.mass) || 0);
  const value = Math.max(0, Number(cargo.value) || 0);
  const pressure = Math.max(0, Number(cargo.piracyPressure ?? 1));

  let seconds = 0;
  let distance = 0;
  let exposed = 0;
  let fuelCost = 0;
  let gateFee = 0;
  const fuelUsed = {};
  const stages = [];

  for (const leg of legs) {
    const from = getNode(network, leg.from);
    const to = getNode(network, leg.to);
    const mode = DRIVE_MODES[leg.mode];
    if (!from || !to || !mode) return null;

    if (mode.id === 'gate') {
      // Skok jest natychmiastowy, ale kosztuje opłatę zależną od tonażu.
      gateFee += Number(config.gateFeeBase || 0) + Number(config.gateFeePerTon || 0) * mass;
      stages.push({ from: from.id, to: to.id, mode: mode.id, distance: 0, seconds: 0, fuel: 0, risk: 0 });
      continue;
    }

    const legDistance = distanceBetween(from, to);
    const legSeconds = legDistance / mode.speed;
    const legFuel = legDistance * mode.fuelPerUnit;

    distance += legDistance;
    seconds += legSeconds;
    exposed += legDistance * mode.risk;
    if (mode.fuelId) {
      fuelUsed[mode.fuelId] = (fuelUsed[mode.fuelId] || 0) + legFuel;
      fuelCost += legFuel * fuelPriceOf(config, mode.fuelId);
    }
    stages.push({
      from: from.id, to: to.id, mode: mode.id,
      distance: legDistance, seconds: legSeconds, fuel: legFuel, risk: mode.risk
    });
  }

  const risk = interceptChance(exposed, config, pressure);
  const expectedLoss = risk * value;
  const timeCost = seconds * Number(config.timeValuePerSecond || 0);

  return {
    legs: stages,
    distance,
    seconds,
    exposedDistance: exposed,
    interceptChance: risk,
    fuelUsed,
    cost: {
      fuel: fuelCost,
      gate: gateFee,
      time: timeCost,
      expectedLoss,
      total: fuelCost + gateFee + timeCost + expectedLoss
    }
  };
}

// ============================================================
// Wybór trasy
// ============================================================

/**
 * Buduje warianty dojazdu z A do B i zwraca je posortowane po koszcie.
 *
 * Warianty są trzy, bo tyle jest napędów:
 *   1. prosto konwencjonalnie — najtaniej w paliwie, najdłużej, pełne ryzyko
 *   2. przez bramy — dolot do bramy, skok, dolot od bramy; ryzyko tylko na dolotach
 *   3. warpem — natychmiast i bezpiecznie, ale paliwo fuzyjne kosztuje
 *
 * Brama bywa wolniejsza od warpa od drzwi do drzwi i to jest zamierzone:
 * ma być TAŃSZA, nie szybsza.
 */
export function planRouteOptions(network, fromId, toId, cargo = {}) {
  const from = getNode(network, fromId);
  const to = getNode(network, toId);
  if (!from || !to || from.id === to.id) return [];

  const options = [];

  const direct = priceRoute(network, [{ from: from.id, to: to.id, mode: 'conventional' }], cargo);
  if (direct) options.push({ id: 'conventional', label: 'konwencjonalnie', ...direct });

  if (!cargo.noWarp) {
    const warp = priceRoute(network, [{ from: from.id, to: to.id, mode: 'warp' }], cargo);
    if (warp) options.push({ id: 'warp', label: 'warpem', ...warp });
  }

  // Bramy działają tylko wtedy, gdy OBA końce mają swoją. Inaczej trzeba by
  // dolecieć konwencjonalnie przez pół układu i skok nic nie daje.
  const fromGate = getNode(network, `gate:${from.id}`);
  const toGate = getNode(network, `gate:${to.id}`);
  if (fromGate && toGate) {
    const viaGate = priceRoute(network, [
      { from: from.id, to: fromGate.id, mode: 'conventional' },
      { from: fromGate.id, to: toGate.id, mode: 'gate' },
      { from: toGate.id, to: to.id, mode: 'conventional' }
    ], cargo);
    if (viaGate) options.push({ id: 'gate', label: 'przez bramę', ...viaGate });
  }

  options.sort((a, b) => a.cost.total - b.cost.total);
  return options;
}

/** Najtańszy wariant. `null`, gdy pary nie da się obsłużyć. */
export function chooseRoute(network, fromId, toId, cargo = {}) {
  return planRouteOptions(network, fromId, toId, cargo)[0] || null;
}
