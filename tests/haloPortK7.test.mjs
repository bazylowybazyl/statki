// Port K-7 (dok gameplayowy z dema ECUMENE) na ringu „Halo”: układ, kolizje,
// automat dokowania i model lotu — czysta logika, bez GPU.
// node --test tests/haloPortK7.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { buildHaloRoofPlan } from '../src/3d/haloRing/haloRingRoofPlan.js';
import { HALO_PORT, HALO_STATION_ANGLE, HALO_TRANSIT, haloPortSites, haloTransitAngles } from '../src/3d/haloRing/haloRingConfig.js';
import {
  K7_ATLAS,
  K7_PLACEMENT,
  K7Docking,
  K7FlightModel,
  K7RoofFade,
  buildK7Collision,
  createK7Layout,
  k7BoxPoly,
  k7CollarPosts,
  k7Frame,
  k7HeightToZ,
  k7HubToWorld,
  k7WorldToHub
} from '../src/3d/haloRing/haloPortK7Layout.js';
import { buildK7Scene } from '../src/3d/haloRing/haloPortK7Build.js';

test('układ K-7: 28 stanowisk (4 capital jak dok stacji z ringiem w ruchu v2), 3 bramy', () => {
  const l = createK7Layout();
  assert.equal(l.berths.length, 28);
  assert.deepEqual(l.capacity, { CAPITAL: 4, L: 4, M: 8, S: 12, total: 28 });
  assert.equal(l.gates.length, 3);
  const g1 = l.gates.find((g) => g.id === 'G-01');
  assert.ok(g1.clearWidth > K7_ATLAS.h + 1000, `brama główna ${g1.clearWidth} j.`);
  // każde stanowisko capital ma własny pas, który mieści się w bramie G-01
  const caps = l.berths.filter((b) => b.size === 'CAPITAL');
  assert.equal(l.lanes.length, caps.length);
  for (const lane of l.lanes) {
    assert.ok(Math.abs(lane.x) + lane.width / 2 <= g1.clearWidth / 2, `pas ${lane.id} poza bramą G-01`);
  }
  // stanowiska capital nie zachodzą na siebie ani na aleje grzebieni bocznych
  const pads = caps.map((b) => [b.x - b.width / 2, b.x + b.width / 2]).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i + 1 < pads.length; i++) assert.ok(pads[i][1] < pads[i + 1][0], 'stanowiska capital zachodzą na siebie');
  for (const bank of l.sideBanks) {
    const aisle = [bank.aisleX - bank.aisleWidth / 2, bank.aisleX + bank.aisleWidth / 2];
    for (const p of pads) assert.ok(p[1] < aisle[0] || p[0] > aisle[1], `aleja ${bank.id} na stanowisku capital`);
  }
  const c01 = l.berths[0];
  assert.equal(c01.id, 'C-01');
  assert.ok(c01.maxLength >= K7_ATLAS.w && c01.maxBeam >= K7_ATLAS.h, 'Atlas mieści się na C-01');
  // węże paliwowe od rufy: wlew po stronie bramy (z większe niż środek stanowiska)
  for (const a of c01.serviceAnchors) assert.ok(a.target.z > c01.z, 'tankowanie od rufy');
});

test('start zadokowany bez kolizji; wycofanie po pasie przez bramę G-01 bez kolizji', () => {
  const l = createK7Layout();
  const col = buildK7Collision(l);
  const ship = new K7FlightModel(col, l.spawnPoint);
  assert.equal(col.test(ship.polygon()), null, 'pozycja startowa na C-01');
  // Atlas cofa się (dziób do wnętrza) wzdłuż x stanowiska aż za fartuch bramy
  for (let z = l.spawnPoint.z; z <= l.frontZ + l.apronDepth + 1200; z += 20) {
    const hit = col.test(ship.polygon(l.spawnPoint.x, z, l.spawnPoint.angle));
    assert.equal(hit, null, `kolizja na z = ${z}: ${hit}`);
  }
  // ściana z tyłu hali blokuje (kolizje w ogóle działają)
  assert.notEqual(col.test(ship.polygon(l.spawnPoint.x, l.backZ, l.spawnPoint.angle)), null);
});

test('automat dokowania: oddokowanie 9,5 s → lot, dokowanie 9,3 s → obsługa', () => {
  const l = createK7Layout();
  const col = buildK7Collision(l);
  const ship = new K7FlightModel(col, l.spawnPoint);
  const dock = new K7Docking(l, ship);
  assert.equal(dock.state, 'DOCKED');
  assert.equal(ship.locked, true);
  assert.equal(dock.poses.get('C-01').lock, 1);
  assert.ok(dock.requestUndock());
  for (let i = 0; i < 1200; i++) dock.update(1 / 120);
  assert.equal(dock.state, 'FREE');
  assert.equal(ship.locked, false);
  const pose = dock.poses.get('C-01');
  assert.equal(pose.bridge + pose.lower + pose.extension, 0, 'obsługa schowana');
  // wycofanie tyłem ~600 j. (S), potem powrót na pole STOP i dokowanie
  ship.input.retro = 1;
  for (let i = 0; i < 480; i++) { ship.step(1 / 120, 1); dock.update(1 / 120); }
  assert.ok(ship.z > l.spawnPoint.z + 150, `statek wycofał się: z = ${ship.z.toFixed(0)}`);
  assert.equal(col.hits, 0, 'wycofanie bez kolizji');
  ship.input.retro = 0;
  ship.x = l.spawnPoint.x + 40;
  ship.z = l.spawnPoint.z + 60;
  ship.vx = ship.vz = ship.angVel = 0;
  assert.equal(dock.candidate().ok, true, dock.candidate().reason);
  assert.ok(dock.requestDock());
  for (let i = 0; i < 1200; i++) dock.update(1 / 120);
  assert.equal(dock.state, 'DOCKED');
  assert.equal(dock.poses.get('C-01').lock, 1);
  assert.ok(Math.abs(ship.x - l.spawnPoint.x) < 1e-6 && Math.abs(ship.z - l.spawnPoint.z) < 1e-6, 'precyzyjne ustawienie na stanowisku');
});

test('model lotu: limity prędkości w hali i poza nią', () => {
  const l = createK7Layout();
  const col = buildK7Collision(l);
  const ship = new K7FlightModel(col, { x: 0, z: l.frontZ + 6000, angle: Math.PI / 2 });
  ship.locked = false;
  ship.input.main = 1;
  for (let i = 0; i < 1200; i++) ship.step(1 / 120, 1);
  assert.ok(Math.hypot(ship.vx, ship.vz) <= 210 + 1e-6, 'w hali ≤ 210');
  ship.input.boost = 1;
  for (let i = 0; i < 2400; i++) ship.step(1 / 120, 0);
  assert.ok(Math.hypot(ship.vx, ship.vz) <= 660 * 2.35 + 1e-6, 'poza halą z dopalaczem ≤ 1551');
  assert.ok(Math.hypot(ship.vx, ship.vz) > 660, 'dopalacz działa poza halą');
});

test('dach znika, gdy kadłub wchodzi do hali', () => {
  const l = createK7Layout();
  const col = buildK7Collision(l);
  const fp = l.footprint.map(([x, z]) => ({ x, z }));
  const roof = new K7RoofFade(fp);
  const ship = new K7FlightModel(col, { x: 0, z: l.frontZ + 5000, angle: -Math.PI / 2 });
  assert.ok(roof.update(ship.polygon(), 0, true) < 0.01, 'daleko: dach widoczny');
  ship.z = 3000;
  assert.equal(roof.update(ship.polygon(), 0, true), 1, 'w hali: dach zniknął');
});

test('osadzenie na ringu: K-7 wpięty w podłogę na środku wstęgi, przed orbitą spawnu', () => {
  const ring = createHaloRingLayout({});
  const f = k7Frame(ring);
  const l = createK7Layout();
  assert.equal(l.backZ, K7_PLACEMENT.backZ, 'K7_PLACEMENT.backZ = createK7Layout().backZ');
  assert.equal(l.halfWidth, HALO_PORT.k7HalfWidth, 'HALO_PORT.k7HalfWidth = createK7Layout().halfWidth');
  // ściana tylna hali na płycie portu (podłoga + 7), płaszczyzna lotu = środek podłogi
  const back = k7HubToWorld(f, 0, l.backZ);
  assert.ok(Math.abs(Math.hypot(back.x, back.y) - (ring.radii.floorMid + 7)) < 1e-6, 'tył hali na podłodze');
  assert.equal(ring.z.floorMid, 0, 'płaszczyzna lotu na środku szerokości wstęgi');
  assert.ok(f.rimZ > l.backZ + 1400 && f.rimZ < l.backZ + 1600, 'krawędź ścian ~1500 j. przed tyłem hali');
  let rMax = 0;
  for (const [x, z] of l.footprint) {
    const p = k7HubToWorld(f, x, z + (z === l.frontZ ? l.apronDepth : 0));
    rMax = Math.max(rMax, Math.hypot(p.x, p.y));
  }
  assert.ok(rMax < 57252 - 3000, `front K-7 ${rMax.toFixed(0)} przed orbitą spawnu`);
  // środek hali pod kątem stacji
  const mid = k7HubToWorld(f, 0, 3000);
  let dd = Math.atan2(mid.y, mid.x) - HALO_STATION_ANGLE;
  dd -= 2 * Math.PI * Math.round(dd / (2 * Math.PI));
  assert.ok(Math.abs(dd) < 1e-9);
  const back2 = k7WorldToHub(f, mid.x, mid.y);
  assert.ok(Math.abs(back2.x) < 1e-6 && Math.abs(back2.z - 3000) < 1e-6, 'przeliczenie hub ↔ świat odwracalne');
  // doki transportowe po bokach, kołnierze nie zachodzą na kołnierz K-7
  const plan = buildHaloRoofPlan(ring, { segCount: Math.round(ring.circumference / ring.floor.length) * 8 });
  for (const d of plan.docks) {
    let a = d.theta - HALO_STATION_ANGLE;
    a -= 2 * Math.PI * Math.round(a / (2 * Math.PI));
    assert.ok(Math.abs(a) * ring.radii.floorMid > l.halfWidth + HALO_PORT.collar + 100 + d.length / 2 + HALO_PORT.collar, `dok transportowy ${d.index} koliduje z K-7`);
  }
  // płyty w mapach terenu: 4 kompleksy (K-7 + 3 zatoki) i 4 portale tranzytów, rozłączne
  const sites = haloPortSites(ring.radii.floorMid);
  assert.equal(sites.length, HALO_PORT.complexes * (1 + HALO_PORT.docks) + HALO_TRANSIT.count);
  assert.equal(sites.filter((s) => s.kind === 'k7').length, HALO_PORT.complexes);
  // kompleksy co 90°, pierwszy przy kącie stacji (hala gracza)
  const k7s = sites.filter((s) => s.kind === 'k7');
  for (let i = 0; i < k7s.length; i++) {
    let d = k7s[i].theta - HALO_STATION_ANGLE - i * Math.PI / 2;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    assert.ok(Math.abs(d) < 1e-9, `kompleks ${i}`);
  }
  // tranzyty jak w ECUMENE: 4 osie co 90°, K-7 w połowie między parą
  const ta = haloTransitAngles();
  for (let i = 0; i < ta.length; i++) {
    let d = ta[i] - HALO_STATION_ANGLE - Math.PI / 4 - i * Math.PI / 2;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    assert.ok(Math.abs(d) < 1e-9, `oś tranzytu ${i}`);
  }
  // pas fabryczny i domy wokół doków: strefa domów szersza niż fabryk
  for (const s of sites) assert.ok(s.zoneRes === 0 || s.zoneRes > s.zoneInd, `strefy ${s.kind}`);
  assert.ok(sites[0].halfS >= l.halfWidth + HALO_PORT.collar + 100, 'płyta pod całym kołnierzem K-7');
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      let d = sites[i].theta - sites[j].theta;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      assert.ok(Math.abs(d) * ring.radii.floorMid > sites[i].halfS + sites[j].halfS, `miejsca portu ${i} i ${j} zachodzą na siebie`);
    }
  }
  // słupy kołnierza są przeszkodami lotu (poza halą), wejście do hali zostaje wolne
  const posts = k7CollarPosts(l);
  const world = buildK7Collision(l);
  for (const p of posts) assert.ok(world.test(k7BoxPoly(p.x, p.z, 50, 50)), 'słup kołnierza w świecie kolizji');
  assert.equal(world.test(k7BoxPoly(0, l.frontZ + 400, 200, 200)), null, 'przed bramą G-01 wolne');
});

test('scena K-7: nic nad kamerą gry przy zoomie 3,2, pokład pod płaszczyzną lotu', () => {
  const l = createK7Layout();
  const f = k7Frame(createHaloRingLayout({}));
  const s = buildK7Scene(l, { floorZ: f.floorZ, rimZ: f.rimZ });
  // narożniki brył po obrocie (kwaternion) i skali pionowej — jak w shaderze
  const rot = (q, v) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  let top = -Infinity;
  let where = '';
  for (const [setName, set] of Object.entries(s.sets)) {
    for (const [kind, data] of Object.entries(set)) {
      const ext = kind === 'box' ? 0.5 : 1;
      for (let i = 0; i < data.length; i += 16) {
        // grupy ruchome: pozycja zależy od pozy (suwnica nad statkiem ≤ wysokość mostu)
        const q = [data[i + 8], data[i + 9], data[i + 10], data[i + 11]];
        for (const cx of [-ext, ext]) for (const cy of [kind === 'box' ? -0.5 : -0.5, 0.5]) for (const cz of [-ext, ext]) {
          const v = rot(q, [cx * data[i + 4], cy * data[i + 5], cz * data[i + 6]]);
          const zTop = data[i + 1] + v[1] * data[i + 3];
          if (zTop > top) { top = zTop; where = `${setName}/${kind}#${i / 16} grupa ${data[i + 12]}`; }
        }
      }
    }
  }
  // grupa chwytaka: środek lokalny 0 + przesunięcie maks. przy pozie 0 (y = 550)
  top = Math.max(top, k7HeightToZ(550) + 30);
  // kamera persp gry przy zoomie 3,2 wisi ~535 j. nad z = 0 (near 100)
  assert.ok(top < 435, `najwyższy punkt K-7 z = ${top.toFixed(0)} (${where})`);
  assert.ok(k7HeightToZ(0) < -100, 'pokład hali pod płaszczyzną lotu');
  assert.ok(s.labels.length > 50 && s.hoses.length === 8 && s.cranes.length === 4);
  assert.ok(s.groups.length + 1 <= 40, `grupy ruchome ${s.groups.length} (MAX_GROUPS 40)`);
});
