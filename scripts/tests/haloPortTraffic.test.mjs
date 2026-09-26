/**
 * Testy portu ringu „Halo” jako układu doków ruchu v2 (haloPortTraffic.js).
 *
 * Pilnują trzech decyzji z planu wdrożenia ruchu v2 (2026-09-26): hale K-7 są
 * wojskowe, zatoki cywilne; przydział rozkłada ruch po całym porcie; port Marsa
 * leży tam, gdzie jego ring (grupa obrócona o −π), a nie 180° obok.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { buildHaloPortTrafficLayout, haloPortRotationFor } from '../../src/3d/haloRing/haloPortTraffic.js';
import { K7_BANK_SLOTS, k7Frame, k7HubToWorld, createK7Layout } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { haloPortComplexAngles } from '../../src/3d/haloRing/haloRingConfig.js';
import {
  haloRingLayoutFor, createHaloRingPlacement, haloLocalToGame, computeHaloPortStation
} from '../../src/game/haloRingPlanets.js';
import {
  BERTH_ROLE, berthFits, hullFitsBerth, findBerth, berthOccupancy
} from '../../src/game/traffic/dockLayout.js';
import {
  createPortControl, registerPort, requestService
} from '../../src/game/traffic/portControl.js';
import { COURSE_KIND } from '../../src/game/traffic/courseRegistry.js';

const angleOf = (p, c) => Math.atan2(p.y - c.y, p.x - c.x);
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function run() {
  const t = createSuite('haloPortTraffic');

  const earthRing = haloRingLayoutFor({ id: 'earth' });
  const marsRing = haloRingLayoutFor({ id: 'mars' });
  const earthSt = { id: 'earth', x: 1000, y: -2000 };
  const marsSt = { id: 'mars', x: -5000, y: 3000 };
  const earth = buildHaloPortTrafficLayout(earthRing, earthSt);
  const mars = buildHaloPortTrafficLayout(marsRing, marsSt);

  // ----------------------------------------------------------
  t.section('Role: hale K-7 = wojsko, zatoki = terminale przeładunkowe');

  const occ = berthOccupancy(earth);
  t.equal('224 stanowiska jak dotąd', earth.berths.length, 224);
  t.equal('112 wojskowych', occ.byRole.military?.total, 112);
  t.equal('112 cywilnych', occ.byRole.civil?.total, 112);
  t.check('każde stanowisko hali K-7 jest wojskowe',
    earth.berths.filter(b => b.hall === 'K-7').every(b => b.role === BERTH_ROLE.MILITARY));
  t.check('każde stanowisko zatoki jest cywilne',
    earth.berths.filter(b => b.hall === 'ZATOKA').every(b => b.role === BERTH_ROLE.CIVIL));
  t.check('doki niosą rolę', earth.docks.every(d => d.role === (d.kind === 'k7' ? BERTH_ROLE.MILITARY : BERTH_ROLE.CIVIL)));
  const odwrotnie = buildHaloPortTrafficLayout(earthRing, earthSt, { roles: { k7: BERTH_ROLE.CIVIL } });
  t.check('rolę hal da się zmienić opcją', odwrotnie.berths.every(b => b.role === BERTH_ROLE.CIVIL));

  // ----------------------------------------------------------
  t.section('Limity padów: okręty w hali, frachtowce w zatokach');

  const military = { role: BERTH_ROLE.MILITARY, freeOnly: true };
  const civil = { role: BERTH_ROLE.CIVIL, freeOnly: true };
  // Fregata nie wchodzi w klasę S ruchu (170 × 140), ale pad S hali ma 300 × 180.
  t.check('fregata za duża na klasę S ruchu', !berthFits('s', 'terran_frigate'));
  const expectMilitary = { terran_frigate: 's', terran_destroyer: 'm', terran_battleship: 'l', terran_carrier: 'capital', atlas: 'capital' };
  for (const [hull, cls] of Object.entries(expectMilitary)) {
    const pick = findBerth(earth, hull, 0, military);
    t.equal(`${hull} → pad ${cls} hali K-7`, pick?.berth.cls, cls);
    t.check(`${hull} fizycznie mieści się na padzie`, pick && hullFitsBerth(pick.berth, hull));
  }
  const expectCivil = { inter_station_shuttle: 's', container_ship: 'm', long_haul_freighter: 'l', heavy_freighter: 'mega', megafreighter: 'mega' };
  for (const [hull, cls] of Object.entries(expectCivil)) {
    t.equal(`${hull} → ${cls} w zatoce`, findBerth(earth, hull, 0, civil)?.berth.cls, cls);
  }
  const s = earth.berths.find(b => b.hall === 'K-7' && b.cls === 's');
  t.equal('pad S niesie limit długości K-7', s.maxLength, K7_BANK_SLOTS.S.maxLength);
  t.equal('pad S niesie limit szerokości K-7', s.maxBeam, K7_BANK_SLOTS.S.maxBeam);
  const cap = earth.berths.find(b => b.hall === 'K-7' && b.cls === 'capital');
  t.equal('stanowisko capital pod Atlasa (2050)', cap.maxLength, createK7Layout().berths[0].maxLength);

  // ----------------------------------------------------------
  t.section('Obrót ringu: port Marsa leży pod kątem swojej stacji');

  t.close('Ziemia bez obrotu', haloPortRotationFor(earthSt), 0);
  t.close('Mars obrócony o −π (jak grupa ringu w grze)', haloPortRotationFor(marsSt), -Math.PI);
  for (const [name, layout, st] of [['Ziemia', earth, earthSt], ['Mars', mars, marsSt]]) {
    const hall = layout.docks.find(d => d.id.endsWith(':K7-1'));
    const want = computeHaloPortStation({ id: st.id }).angle;
    t.check(`${name}: hala K7-1 pod kątem stacji gry`, angleDiff(angleOf(hall, st), want) < 1e-9,
      `(hala ${angleOf(hall, st).toFixed(3)}, stacja ${want.toFixed(3)})`);
  }
  // Ta sama transformacja co render i kolizje ringu (haloLocalToGame).
  const place = createHaloRingPlacement({ id: 'mars', x: marsSt.x, y: marsSt.y });
  const hub = createK7Layout();
  let maxErr = 0;
  haloPortComplexAngles().forEach((angle, c) => {
    const frame = k7Frame(marsRing, angle);
    for (const b of hub.berths) {
      const local = k7HubToWorld(frame, b.x, b.z, {});
      const game = haloLocalToGame(place, local.x, local.y, {});
      const berth = mars.berths.find(v => v.id === `mars:K7-${c + 1}:${b.id}`);
      maxErr = Math.max(maxErr, Math.hypot(game.x - berth.x, game.y - berth.y));
    }
  });
  t.check('stanowiska Marsa = punkty ringu po haloLocalToGame', maxErr < 1e-6, `(błąd ${maxErr})`);

  // Obrót ogólny (ring Jowisza w Z6): wszystko obraca się sztywno wokół planety.
  const rot = 0.7;
  const turned = buildHaloPortTrafficLayout(earthRing, earthSt, { rotation: rot });
  let rigid = 0;
  let heading = 0;
  earth.berths.forEach((b, i) => {
    const r = turned.berths[i];
    const dx = b.x - earthSt.x;
    const dy = b.y - earthSt.y;
    // Obrót grupy +rot w Three (y w górę) = obrót o −rot w grze (y w dół).
    const ex = earthSt.x + dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ey = earthSt.y + dx * Math.sin(-rot) + dy * Math.cos(-rot);
    rigid = Math.max(rigid, Math.hypot(ex - r.x, ey - r.y));
    const ax = earthSt.x + (b.approachX - earthSt.x) * Math.cos(-rot) - (b.approachY - earthSt.y) * Math.sin(-rot);
    rigid = Math.max(rigid, Math.abs(ax - r.approachX));
    heading = Math.max(heading, angleDiff(r.angle, b.angle - rot));
  });
  t.check('obrót sztywny: pozycje i podejścia', rigid < 1e-6, `(błąd ${rigid})`);
  t.check('obrót sztywny: kursy stanowisk', heading < 1e-9, `(błąd ${heading})`);
  t.close('jawny obrót 0 wyłącza domyślny Marsa',
    angleOf(buildHaloPortTrafficLayout(marsRing, marsSt, { rotation: 0 }).docks[0], marsSt), Math.PI / 4, 1e-9);

  // ----------------------------------------------------------
  t.section('Geometria ringu dla redy (układ gry)');

  for (const [name, layout, st] of [['Ziemia', earth, earthSt], ['Mars', mars, marsSt]]) {
    const ring = layout.ring;
    t.check(`${name}: środek ringu = stacja`, ring.x === st.x && ring.y === st.y);
    const halls = layout.docks.filter(d => d.kind === 'k7');
    t.check(`${name}: kąty kompleksów = kąty hal K-7`,
      halls.every((d, c) => angleDiff(angleOf(d, st), ring.complexAngles[c]) < 1e-9));
    t.check(`${name}: tranzyty w połowie między kompleksami`,
      ring.transitAngles.every(a => Math.min(...ring.complexAngles.map(c => angleDiff(a, c))) > Math.PI / 4 - 1e-9));
  }
  t.equal('płyty kompleksu kończą się 13 100 j. łuku od środka', earth.ring.complexHalfArc, 13100);
  t.equal('tranzyt z płytą ±1 360 j.', earth.ring.transitHalfArc, 1360);
  t.close('Mars: podłoga 33 750', mars.ring.floorMid, 33750, 1);

  // ----------------------------------------------------------
  t.section('Równy rozkład na prawdziwym porcie Ziemi');

  const control = createPortControl();
  const layout = buildHaloPortTrafficLayout(earthRing, earthSt);
  registerPort(control, 'earth', layout, { id: 'earth', x: earthSt.x, y: earthSt.y, angle: 0 });
  const hulle = ['inter_station_shuttle', 'container_ship', 'inter_station_shuttle', 'long_haul_freighter', 'container_ship'];
  for (let i = 0; i < 40; i++) {
    requestService(control, 'earth', { id: `k-${i}`, kind: COURSE_KIND.HAUL, unitClass: hulle[i % hulle.length] }, i, 90);
  }
  const byDock = berthOccupancy(layout).byDock;
  const bays = Object.entries(byDock).filter(([id]) => id.includes(':Z-')).map(([, v]) => v.taken);
  const halls = Object.entries(byDock).filter(([id]) => id.includes(':K7-')).map(([, v]) => v.taken);
  t.check('frachtowce nie wchodzą do hal K-7', halls.every(n => n === 0));
  t.check('40 kursów rozkłada się po 8 zatokach po równo (5 ± 1)',
    Math.max(...bays) - Math.min(...bays) <= 1 && bays.reduce((a, b) => a + b, 0) === 40, JSON.stringify(bays));

  return t.results;
}

runIfMain(import.meta.url, run);
