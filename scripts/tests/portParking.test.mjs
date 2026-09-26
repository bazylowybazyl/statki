/**
 * Testy postoju w porcie (portParking.js): reda, hangar postojowy, zapas okrętów.
 *
 * Pilnują tego, co widać dopiero na ekranie: reda nie wchodzi na ring, tranzyty
 * ani podejścia do zatok, statki nie stoją jeden na drugim, rozkładają się po
 * całym porcie, a statek raz postawiony zostaje na swoim miejscu, dopóki nie
 * odleci (inaczej flota przestawiałaby się na oczach gracza).
 */

import { createSuite, runIfMain } from './harness.mjs';
import { buildHaloPortTrafficLayout } from '../../src/3d/haloRing/haloPortTraffic.js';
import { K7_BANK_SLOTS, K7_CAPITAL_X, createK7Layout } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { HALO_BAY, createBayLayout } from '../../src/3d/haloRing/haloPortBays.js';
import { haloRingLayoutFor } from '../../src/game/haloRingPlanets.js';
import { buildStationDocks, hullFootprint, BERTH_ROLE, reserveBerth } from '../../src/game/traffic/dockLayout.js';
import {
  PARKING_SLOT_CLASSES, PORT_PARKING_DEFAULTS, parkingClassForHull, buildPortParking,
  createParkingRegistry, syncParking, parkingSpot, summarizeParking, collectParkedShips,
  fleetStockShips, placeFleetStock
} from '../../src/game/traffic/portParking.js';
import { SHIP_STATE } from '../../src/game/traffic/transportCompanies.js';

const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Rozkład z pomiaru ×60 (Ziemia, maksima wg klasy — `.tmp/pomiar-portu-x60.mjs`). */
const EARTH_PEAK = { inter_station_shuttle: 305, container_ship: 288, long_haul_freighter: 69, heavy_freighter: 18, megafreighter: 15 };

function makeShips(counts, prefix = '') {
  const ships = [];
  let k = 0;
  for (const [hullId, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) ships.push({ id: `${prefix}${hullId}-${i}`, hullId, idleSince: k++ });
  }
  return ships;
}

/** Każde miejsce redy (strefa, klasa, indeks) zajmuje najwyżej jeden statek. */
function uniqueSpots(spots) {
  const keys = spots.filter(s => s.kind === 'reda').map(s => `${s.zoneId}/${s.cls}/${s.index}`);
  return new Set(keys).size === keys.length;
}

export function run() {
  const t = createSuite('portParking');

  // ----------------------------------------------------------
  t.section('Sloty w standardzie padów K-7');

  for (const size of ['S', 'M', 'L']) {
    const slot = PARKING_SLOT_CLASSES[size.toLowerCase()];
    const pad = K7_BANK_SLOTS[size];
    t.check(`slot ${size} = pad ${size} hali (pole, rozstaw, limity)`,
      slot.depth === pad.padLength && slot.pitch === pad.pitch
      && slot.maxLength === pad.maxLength && slot.maxBeam === pad.maxBeam);
  }
  const capital = createK7Layout().berths.find(b => b.size === 'CAPITAL');
  const capSlot = PARKING_SLOT_CLASSES.capital;
  t.check('slot capital = stanowisko capital K-7 (pod Atlasa)',
    capSlot.depth === capital.padLength && capSlot.maxLength === capital.maxLength
    && capSlot.maxBeam === capital.maxBeam && capSlot.pitch === K7_CAPITAL_X[1] - K7_CAPITAL_X[0]);
  const megaLane = createBayLayout().lanes[0];
  const megaSlot = PARKING_SLOT_CLASSES.mega;
  t.check('slot mega = pas MEGA zatoki',
    megaSlot.depth === HALO_BAY.mega.padLength && megaSlot.maxLength === HALO_BAY.mega.maxLength
    && megaSlot.maxBeam === HALO_BAY.mega.maxBeam && megaSlot.pitch === megaLane.width);

  const expectClass = {
    inter_station_shuttle: 's', container_ship: 'm', long_haul_freighter: 'l', heavy_freighter: 'capital',
    megafreighter: 'mega', terran_frigate: 's', terran_destroyer: 'm', terran_battleship: 'l', terran_carrier: 'capital', atlas: 'capital'
  };
  for (const [hull, cls] of Object.entries(expectClass)) {
    t.equal(`${hull} → slot ${cls}`, parkingClassForHull(hull)?.id, cls);
  }

  // ----------------------------------------------------------
  t.section('Reda Ziemi: poza ringiem, między kompleksem a tranzytem');

  const earthRing = haloRingLayoutFor({ id: 'earth' });
  const earthSt = { id: 'earth', x: 2000, y: -1000 };
  const earth = buildHaloPortTrafficLayout(earthRing, earthSt);
  const plan = buildPortParking(earth, earthSt);
  const ring = earth.ring;
  const R = ring.floorMid;
  t.equal('port z dużym ruchem ma redę', plan.mode, 'reda');
  t.equal('8 stref cywilnych (po dwie na kompleks)', plan.zones.filter(z => z.role === BERTH_ROLE.CIVIL).length, 8);
  t.equal('8 stref wojskowych', plan.zones.filter(z => z.role === BERTH_ROLE.MILITARY).length, 8);

  const slots = plan.zones.flatMap(z => z.bands.flatMap(b => b.slots.map(s => ({ ...s, zone: z, cls: b.cls }))));
  const ringClear = ring.rim + 4000;
  t.check('każdy slot poza ringiem (z korytarzem ≥ 4 tys. j.)',
    slots.every(s => Math.hypot(s.x - ring.x, s.y - ring.y) - PARKING_SLOT_CLASSES[s.cls].depth / 2 > ringClear));
  t.check('reda Ziemi zaczyna się ok. 48 tys. j.',
    plan.zones.every(z => Math.abs(z.r0 - 48000) < 100));
  t.check('reda cywilna kończy się przed łukami kolejki portu',
    plan.zones.every(z => z.r1 < earth.parkingRadius * 1.12 - 3000));

  // Każdy slot w sektorze ±18°…±43° od środka swojego kompleksu (plan § 3.3).
  const sectorMin = ring.complexHalfArc / R;
  const sectorMax = Math.PI / 4 - ring.transitHalfArc / R;
  let wSektorze = true;
  for (const s of slots) {
    const d = angleDiff(s.theta, ring.complexAngles[s.zone.complex]);
    const halfArc = PARKING_SLOT_CLASSES[s.cls].pitch / 2 / s.r;
    if (d - halfArc < sectorMin - 1e-9 || d + halfArc > sectorMax + 1e-9) wSektorze = false;
  }
  t.check('sloty w sektorze między płytami kompleksu a tranzytem', wSektorze,
    `(${(sectorMin * 180 / Math.PI).toFixed(1)}°…${(sectorMax * 180 / Math.PI).toFixed(1)}°)`);
  t.check('żaden slot nie leży na osi tranzytu (±płyta)',
    slots.every(s => ring.transitAngles.every(a => angleDiff(s.theta, a) > ring.transitHalfArc / R)));
  t.check('żaden slot nie leży na płytach kompleksów',
    slots.every(s => ring.complexAngles.every(a => angleDiff(s.theta, a) >= sectorMin)));
  const cywilneBliżej = plan.zones.filter(z => z.role === BERTH_ROLE.CIVIL).every(z => {
    const woj = plan.zones.find(w => w.role === BERTH_ROLE.MILITARY && w.complex === z.complex && w.side === z.side);
    const c = ring.complexAngles[z.complex];
    return angleDiff((z.a0 + z.a1) / 2, c) < angleDiff((woj.a0 + woj.a1) / 2, c);
  });
  t.check('część cywilna od strony kompleksu, wojskowa od strony tranzytu', cywilneBliżej);

  // Nic na siebie nie nachodzi: strefy rozłączne, pasma rozłączne, sloty w rzędzie co rozstaw.
  let rozlaczne = true;
  for (let i = 0; i < plan.zones.length; i++) {
    for (let j = i + 1; j < plan.zones.length; j++) {
      const a = plan.zones[i];
      const b = plan.zones[j];
      const mid = (z) => (z.a0 + z.a1) / 2;
      if (angleDiff(mid(a), mid(b)) < (a.a1 - a.a0) / 2 + (b.a1 - b.a0) / 2) rozlaczne = false;
    }
  }
  t.check('strefy nie nachodzą na siebie', rozlaczne);
  let pasma = true;
  let rzedy = true;
  let wStrefie = true;
  for (const zone of plan.zones) {
    zone.bands.forEach((band, i) => { if (i && band.r0 < zone.bands[i - 1].r1) pasma = false; });
    for (const band of zone.bands) {
      const cls = PARKING_SLOT_CLASSES[band.cls];
      const byRow = new Map();
      for (const s of band.slots) {
        if (!byRow.has(s.row)) byRow.set(s.row, []);
        byRow.get(s.row).push(s);
        if (s.theta - cls.pitch / 2 / s.r < zone.a0 - 1e-9 || s.theta + cls.pitch / 2 / s.r > zone.a1 + 1e-9) wStrefie = false;
      }
      for (const row of byRow.values()) {
        row.sort((p, q) => p.theta - q.theta);
        for (let k = 1; k < row.length; k++) {
          if (Math.hypot(row[k].x - row[k - 1].x, row[k].y - row[k - 1].y) < cls.pitch * 0.999) rzedy = false;
        }
      }
      const rowR = [...byRow.values()].map(row => row[0].r).sort((a, b) => a - b);
      for (let k = 1; k < rowR.length; k++) if (rowR[k] - rowR[k - 1] < cls.depth) rzedy = false;
    }
  }
  t.check('pasma klas nie nachodzą na siebie', pasma);
  t.check('sloty w rzędzie co rozstaw padu, rzędy co długość pola', rzedy);
  t.check('skrajne sloty mieszczą się w strefie', wStrefie);
  t.check('dziób od planety', slots.every(s => angleDiff(s.angle, Math.atan2(s.y - ring.y, s.x - ring.x)) < 1e-9));
  t.check('strefa ma narożniki dla boi 3D', plan.zones.every(z => z.corners.length === 4 && z.corners.every(p => Number.isFinite(p.x))));

  // ----------------------------------------------------------
  t.section('Pojemność: szczyt z pomiaru ×60 mieści się z zapasem');

  const civ = plan.capacity.civil;
  t.check('reda cywilna Ziemi ≥ 400 statków', civ.total >= 400, `(${civ.total})`);
  for (const [hull, peak] of Object.entries(EARTH_PEAK)) {
    const cls = parkingClassForHull(hull).id;
    t.check(`slotów ${cls} ≥ szczyt ${hull} (${peak})`, civ[cls] >= peak, `(${civ[cls]})`);
  }
  t.check('reda wojskowa mieści nadmiar Marsa (~190 ponad hale)', plan.capacity.military.total >= 190);

  const reg = createParkingRegistry(plan);
  const statki = makeShips(EARTH_PEAK);
  syncParking(reg, statki);
  const sum = summarizeParking(reg);
  t.equal('szczyt Ziemi (695) cały na redzie', sum.reda, statki.length);
  t.equal('nic się nie przelewa', sum.overflow, 0);
  t.check('każdy statek na własnym slocie', uniqueSpots([...reg.byShip.values()]));
  t.check('slot pasuje do kadłuba', statki.every(ship => {
    const spot = parkingSpot(reg, ship.id);
    const cls = PARKING_SLOT_CLASSES[spot.cls];
    const size = hullFootprint(ship.hullId);
    return size.length <= cls.maxLength && size.width <= cls.maxBeam;
  }));
  const naStrefe = Object.values(sum.byZone).map(z => z.taken);
  t.check('rozkład po 8 strefach równy (±1)', Math.max(...naStrefe) - Math.min(...naStrefe) <= 1, JSON.stringify(naStrefe));
  t.check('cywile tylko w strefach cywilnych',
    [...reg.byShip.values()].every(s => plan.zones.find(z => z.id === s.zoneId).role === BERTH_ROLE.CIVIL));

  // ----------------------------------------------------------
  t.section('Stabilność: statek stoi tam, gdzie stanął');

  const przed = new Map([...reg.byShip].map(([id, s]) => [id, `${s.zoneId}/${s.cls}/${s.index}`]));
  const zostaja = statki.filter((_, i) => i % 3 !== 0);
  syncParking(reg, zostaja);
  t.equal('odlatujący zwalniają miejsca', reg.byShip.size, zostaja.length);
  t.check('reszta nie drgnęła', zostaja.every(s => {
    const spot = parkingSpot(reg, s.id);
    return `${spot.zoneId}/${spot.cls}/${spot.index}` === przed.get(s.id);
  }));
  const nowi = makeShips({ container_ship: 40, inter_station_shuttle: 40 }, 'nowy-');
  syncParking(reg, [...zostaja, ...nowi]);
  t.check('starzy dalej na swoich miejscach po przylocie nowych', zostaja.every(s => {
    const spot = parkingSpot(reg, s.id);
    return `${spot.zoneId}/${spot.cls}/${spot.index}` === przed.get(s.id);
  }));
  t.check('nowi dostali wolne sloty', nowi.every(s => parkingSpot(reg, s.id)?.kind === 'reda')
    && uniqueSpots([...reg.byShip.values()]));
  syncParking(reg, [...zostaja.slice(1), { ...zostaja[0], hullId: 'megafreighter' }]);
  t.equal('zmiana kadłuba = nowe miejsce w pasującej klasie', parkingSpot(reg, zostaja[0].id).cls, 'mega');

  // Kolejność zapełniania: zwarty blok w środku sektora (przy granicy części
  // cywilnej i wojskowej), a brzegi sektora — podejścia do zatok i wylot
  // tranzytu — wolne, dopóki reda nie jest prawie pełna.
  const regMaly = createParkingRegistry(plan);
  syncParking(regMaly, makeShips({ inter_station_shuttle: 24 }));
  const strefa = plan.zones.find(z => z.id === parkingSpot(regMaly, 'inter_station_shuttle-0').zoneId);
  const wStrefieMalej = [...regMaly.byShip.values()].filter(s => s.zoneId === strefa.id);
  const c = ring.complexAngles[strefa.complex];
  const katy = wStrefieMalej.map(s => angleDiff(Math.atan2(s.y - ring.y, s.x - ring.x), c));
  const brzegKompleksu = Math.min(angleDiff(strefa.a0, c), angleDiff(strefa.a1, c));
  const granica = Math.max(angleDiff(strefa.a0, c), angleDiff(strefa.a1, c));
  t.check('pierwsze statki stoją przy granicy z redą wojskową, nie przy zatokach',
    Math.min(...katy) - brzegKompleksu > (granica - brzegKompleksu) / 2,
    `(najbliżej kompleksu ${(Math.min(...katy) * 180 / Math.PI).toFixed(1)}°, brzeg ${(brzegKompleksu * 180 / Math.PI).toFixed(1)}°)`);
  const regWMaly = createParkingRegistry(plan, { role: BERTH_ROLE.MILITARY });
  syncParking(regWMaly, makeShips({ terran_frigate: 40 }));
  const najblizejTranzytu = Math.min(...[...regWMaly.byShip.values()].map(s =>
    Math.min(...ring.transitAngles.map(a => angleDiff(Math.atan2(s.y - ring.y, s.x - ring.x), a)))));
  t.check('okręty z nadmiaru nie stoją przy wylocie tranzytu (≥ 3° od osi)', najblizejTranzytu > 3 * Math.PI / 180,
    `(${(najblizejTranzytu * 180 / Math.PI).toFixed(1)}°)`);

  // ----------------------------------------------------------
  t.section('Mars: reda idzie za obróconym ringiem');

  const marsRing = haloRingLayoutFor({ id: 'mars' });
  const marsSt = { id: 'mars', x: -4000, y: 7000 };
  const mars = buildHaloPortTrafficLayout(marsRing, marsSt);
  const planM = buildPortParking(mars, marsSt);
  const hallM = mars.docks.find(d => d.id.endsWith(':K7-1'));
  const hallAngle = Math.atan2(hallM.y - marsSt.y, hallM.x - marsSt.x);
  const przyHali = planM.zones.filter(z => z.complex === 0);
  t.check('strefy kompleksu 0 leżą obok hali K7-1 Marsa (225°)', przyHali.length === 4
    && przyHali.every(z => {
      const d = angleDiff((z.a0 + z.a1) / 2, hallAngle);
      return d > marsRing.radii.floorMid && false || (d > 0.3 && d < Math.PI / 4);
    }));
  t.check('reda Marsa poza jego ringiem', planM.zones.every(z => z.r0 > marsRing.radii.rim + 4000));
  const marsPeak = { inter_station_shuttle: 253, container_ship: 126, long_haul_freighter: 69, heavy_freighter: 16, megafreighter: 5 };
  const regM = createParkingRegistry(planM);
  syncParking(regM, makeShips(marsPeak));
  t.equal('szczyt Marsa (469) na redzie', summarizeParking(regM).reda, 469);

  // ----------------------------------------------------------
  t.section('Hangar postojowy: mały ruch i porty bez ringu');

  const merkury = buildStationDocks({ id: 'mercury', x: 0, y: 0, r: 120 }, { berthMultiplier: 4 });
  const planH = buildPortParking(merkury, { id: 'mercury', x: 0, y: 0 });
  t.equal('port bez ringu = hangar', planH.mode, 'hangar');
  const regH = createParkingRegistry(planH);
  syncParking(regH, makeShips({ container_ship: 30 }));
  t.check('statki w hangarze (znikają z renderu)', [...regH.byShip.values()].every(s => s.kind === 'hangar'));
  t.equal('hangar bez limitu mieści wszystkich', regH.hangar.size, 30);
  const regH10 = createParkingRegistry(planH, { hangarCapacity: 10 });
  syncParking(regH10, makeShips({ container_ship: 30 }));
  const s10 = summarizeParking(regH10);
  t.check('pełny hangar przelewa się na redę wokół stacji', s10.hangar === 10 && s10.reda === 20, JSON.stringify(s10));
  const extent = Math.max(...merkury.berths.map(b => Math.hypot(b.x, b.y)));
  t.check('reda portu bez ringu leży za pomostami',
    [...regH10.byShip.values()].filter(s => s.kind === 'reda').every(s => Math.hypot(s.x, s.y) > extent + 1000));
  t.equal('ring z małym ruchem też idzie do hangaru', buildPortParking(earth, earthSt, { expectedParked: 30 }).mode, 'hangar');
  t.equal('ring z dużym ruchem — reda', buildPortParking(earth, earthSt, { expectedParked: 385 }).mode, 'reda');
  t.check('próg jest pokrętłem', PORT_PARKING_DEFAULTS.hangarThreshold > 0);

  const ciasny = buildPortParking(earth, earthSt, { civilRows: { s: 1 } });
  const regC = createParkingRegistry(ciasny, { hangarCapacity: 0 });
  syncParking(regC, makeShips({ container_ship: 5 }));
  t.check('gdy nie ma gdzie stanąć — przelew z pozycją, nie zniknięcie',
    [...regC.byShip.values()].every(s => s.kind === 'overflow' && Number.isFinite(s.x)
      && Math.hypot(s.x - ring.x, s.y - ring.y) >= ciasny.overflowRadius - 1));

  // Wejście z floty przewoźników.
  const flota = { companies: [{ ships: [
    { id: 'a', hullId: 'container_ship', state: SHIP_STATE.PARKED, stationId: 'earth' },
    { id: 'b', hullId: 'container_ship', state: SHIP_STATE.BUSY, stationId: 'earth' },
    { id: 'c', hullId: 'container_ship', state: SHIP_STATE.PARKED, stationId: 'mars' }
  ] }] };
  t.equal('collectParkedShips bierze tylko stojących w tym porcie', collectParkedShips(flota, 'earth').map(s => s.id).join(), 'a');

  // ----------------------------------------------------------
  t.section('Zapas okrętów: hale K-7, nadmiar na redzie wojskowej');

  const zapasMarsa = { mars_yards: { frigate: 180, destroyer: 72, cruiser: 39, carrier: 9 } };
  t.equal('zapas jako lista okrętów o stałych id', fleetStockShips(zapasMarsa).length, 300);
  const regW = createParkingRegistry(planM, { role: BERTH_ROLE.MILITARY });
  const wynik = placeFleetStock(mars, regW, zapasMarsa);
  // 4 hale × (12 S + 8 M + 4 L + 4 capital) = 112, z czego po 1 capital wolnym na przylot.
  t.equal('w halach 108 okrętów (4 × 27)', wynik.berthed, 108);
  t.equal('192 na redzie wojskowej', wynik.reda, 192);
  const miejsca = [...wynik.placements.values()];
  const wHalach = miejsca.filter(p => p.kind === 'berth');
  const perHala = {};
  for (const p of wHalach) perHala[p.dockId] = (perHala[p.dockId] || 0) + 1;
  t.check('hale zapełnione równo', Object.values(perHala).every(n => n === 27), JSON.stringify(perHala));
  const byId = new Map(mars.berths.map(b => [b.id, b]));
  t.check('okręty tylko na stanowiskach wojskowych', wHalach.every(p => byId.get(p.berthId).role === BERTH_ROLE.MILITARY));
  t.check('jeden okręt na pad', new Set(wHalach.map(p => p.berthId)).size === wHalach.length);
  t.check('fregaty na padach S hali', wHalach.filter(p => p.classId === 'frigate').every(p => p.cls === 's'));
  t.check('nosiciele na capital', wHalach.filter(p => p.classId === 'carrier').every(p => p.cls === 'capital'));
  t.check('w każdej hali zostaje wolne stanowisko capital', mars.docks.filter(d => d.kind === 'k7').every(d =>
    d.berths.filter(b => b.cls === 'capital').some(b => !wHalach.some(p => p.berthId === b.id))));
  t.check('nadmiar w strefach wojskowych',
    miejsca.filter(p => p.kind === 'reda').every(p => planM.zones.find(z => z.id === p.zoneId).role === BERTH_ROLE.MILITARY));

  const pierwsze = new Map(miejsca.map(p => [p.shipId, p.berthId || `${p.zoneId}/${p.index}`]));
  const znowu = placeFleetStock(mars, regW, zapasMarsa);
  t.check('to samo wywołanie = te same miejsca', [...znowu.placements.values()]
    .every(p => (p.berthId || `${p.zoneId}/${p.index}`) === pierwsze.get(p.shipId)));
  const mniej = { mars_yards: { ...zapasMarsa.mars_yards, frigate: 170 } };
  const poWyprawie = placeFleetStock(mars, regW, mniej, { promote: 0 });
  t.equal('wyprawa zabiera najwyższe numery', poWyprawie.placements.has('mars_yards:frigate:171'), false);
  t.check('reszta zostaje na miejscach', [...poWyprawie.placements.values()]
    .every(p => (p.berthId || `${p.zoneId}/${p.index}`) === pierwsze.get(p.shipId)));

  // Kurs wojskowy ma pierwszeństwo: pad zajęty przez kurs wypycha okręt z zapasu.
  const ofiara = [...poWyprawie.placements.values()].find(p => p.kind === 'berth' && p.classId === 'destroyer');
  reserveBerth(byId.get(ofiara.berthId), 'dostawa-1', 1e9);
  const poKursie = placeFleetStock(mars, regW, mniej, { promote: 0 });
  const przeniesiony = poKursie.placements.get(ofiara.shipId);
  t.check('okręt zwalnia pad zajęty przez kurs', przeniesiony && przeniesiony.berthId !== ofiara.berthId);
  byId.get(ofiara.berthId).occupantId = null;

  // Zwolnione pady zapełniają się z redy stopniowo.
  const bezNiszczycieli = { mars_yards: { ...mniej.mars_yards, destroyer: 20 } };
  const krok1 = placeFleetStock(mars, regW, bezNiszczycieli, { promote: 2 });
  const krok2 = placeFleetStock(mars, regW, bezNiszczycieli, { promote: 2 });
  t.equal('z redy do hali najwyżej 2 na wywołanie', krok2.berthed - krok1.berthed, 2);

  const terraNova = { terra_nova: { frigate: 46, destroyer: 11, cruiser: 1 } };
  const regT = createParkingRegistry(plan, { role: BERTH_ROLE.MILITARY });
  const tn = placeFleetStock(earth, regT, terraNova);
  t.check('Terra Nova (58) mieści się w halach Ziemi', tn.berthed === 58 && tn.reda === 0);

  return t.results;
}

runIfMain(import.meta.url, run);
