// Pył w halach K-7 (src/3d/gasField/, gazy etap 1 — 2026-10-07): domena i rastr hali, przekształcenie
// hala ↔ świat gry, pakowanie wejścia klatki (szew gra ↔ render pod przyszły render w workerze), WGSL kerneli
// i warstw (Node, bez GPU), limity wiązań, wyznacznik macierzy warstw (klucz pipeline'u jak w rozgrzewce).
// Obraz i koszt w prawdziwej grze: node scripts/webgpu/hala-pyl-gra.mjs
// node --test tests/hallDust.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { createK7Layout, k7ForceFieldList, k7HubToWorld } = await import('../src/3d/haloRing/haloPortK7Layout.js');
const {
  HALL_DUST_IN, HALL_DUST_MASK, HALL_DUST_MAX_SHIPS, HALL_DUST_SERVICE, HALL_DUST_SERVICE_BERTHS, HALL_DUST_SHIP,
  hallDustDomain, rasterizeHallCells, hallDomainDistance, hallMaskBit, hallBodySolidCpu, hallBodyFieldSpan
} = await import('../src/3d/gasField/hallDustLayout.js');
const { hallToGameAffine, gameToHall, gameVecToHall, packHallDustFrame, createHallDustInput } =
  await import('../src/game/hallDustInput.js');
const { HaloRingCollider } = await import('../src/game/haloRingCollision.js');
const { haloLocalToGame } = await import('../src/game/haloRingPlanets.js');
const { GasField2D, jetProfileCpu, jetSourceAlongCpu, jetSourceIntegralCpu, jetVisibleCpu, sroundCpu } =
  await import('../src/3d/gasField/gasField2D.js');
const { GasFieldLayer } = await import('../src/3d/gasField/gasFieldLayer.js');
const { fxNoise } = await import('../src/3d/fx/noise.js');
const { LightGrid } = await import('../src/3d/fx/lightGrid.js');

const L = createK7Layout();
const DOM = hallDustDomain(L);
const RASTER = rasterizeHallCells(L, DOM);

test('domena: hala z zapasem i próżnią za bramą, siatka podzielna przez 8 (komórki × 64 = grupy robocze)', () => {
  assert.equal(DOM.nx % 8, 0);
  assert.equal(DOM.ny % 8, 0);
  assert.equal((DOM.nx * DOM.ny) % 64, 0);
  assert.ok(DOM.x0 < -L.halfWidth && DOM.x1 > L.halfWidth, 'ściany boczne w domenie');
  assert.ok(DOM.z0 < L.backZ - L.wallThickness * 0.5, 'ściana tylna w domenie');
  assert.ok(DOM.z1 > L.frontZ + 1000, 'pas próżni za bramą G-01');
  assert.equal(hallDomainDistance(DOM, 0, 3000), 0);
  assert.ok(Math.abs(hallDomainDistance(DOM, DOM.x1 + 300, 3000) - 300) < 1e-9);
});

test('rastr: pola siłowe zamykają otwory bram dla gazu (G-01, G-02, G-03); bez pól — bramy otwarte, kurz ten sam', () => {
  // prośba użytkownika 2026-10-13: dym hali rozbija się o pole siłowe w bramie (statki przelatują — to nie kolizja)
  const OPEN = rasterizeHallCells(L, DOM, { forceFields: false });
  const at = (R, x, z) => R.data[(Math.floor((z - DOM.z0) / DOM.h) * DOM.nx + Math.floor((x - DOM.x0) / DOM.h)) * 4];
  for (const f of k7ForceFieldList(L)) {
    let n = 0, open = 0;
    for (let t = 40; t <= f.length - 40; t += 70) {
      const x = f.ax + f.ux * t, z = f.az + f.uz * t;
      assert.ok(at(RASTER, x, z) > 127, `${f.gateId}: pole t=${t}`);
      n++;
      if (at(OPEN, x, z) === 0) open++;
    }
    // bez pola otwór otwarty (przy G-02 / G-03 w narożniku otworu stoi boja podejścia — przeszkoda kolizji)
    assert.ok(open / n > 0.9, `${f.gateId}: bez pola otwarte ${open} / ${n}`);
    // od strony hali tuż przed polem — gaz (komórka nie jest przeszkodą)
    const x = f.x - f.nx * (f.half + 2 * DOM.h), z = f.z - f.nz * (f.half + 2 * DOM.h);
    assert.equal(at(RASTER, x, z), 0, `${f.gateId}: przed licem pola`);
  }
  assert.ok(RASTER.field > 0 && RASTER.field === RASTER.solid - OPEN.solid, `komórki pól ${RASTER.field}`);
  assert.equal(OPEN.field, 0);
  // kurz na pokładzie liczony od murów — pole w bramie go nie zmienia; odległość od przeszkody (A) zna pola
  let diffG = 0, diffA = 0;
  for (let k = 0; k < DOM.nx * DOM.ny; k++) {
    if (RASTER.data[k * 4] !== OPEN.data[k * 4]) continue;
    if (RASTER.data[k * 4 + 1] !== OPEN.data[k * 4 + 1]) diffG++;
    if (RASTER.data[k * 4 + 3] !== OPEN.data[k * 4 + 3]) diffA++;
  }
  assert.equal(diffG, 0, 'kurz bez zmian');
  assert.ok(diffA > 100, 'odległość od przeszkody z polami (zasłanianie strumieni dysz)');
});

test('kadłub w bramie: przecięcie obrysu z polem siłowym (światła pola na kadłubie — hallBodyFieldSpan)', () => {
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 6123456.7, y: 4234567.8 });
  const rings = [{ collider: col }];
  const a = hallToGameAffine(col.place, col.registry.halls[0].frame, {});
  const at = (x, z) => ({ x: a.p0x + x * a.ax + z * a.bx, y: a.p0y + x * a.ay + z * a.by });
  const heading = Math.atan2(a.by, a.bx);   // dziób wzdłuż +z hali (ku bramie G-01)
  const g1 = k7ForceFieldList(L).find((f) => f.gateId === 'G-01');
  const out = createHallDustInput();
  const span = new Float64Array(2);
  const cam = at(0, 5000);
  const pack = (x, z) => packHallDustFrame(out, {
    dt: 1 / 60, camX: cam.x, camY: cam.y, viewHalf: 3000, rings,
    ship: { pos: at(x, z), vel: { x: 0, y: 0 }, angle: heading, w: 1800, h: 806 }, npcs: []
  });
  pack(-810, L.frontZ);   // w bramie, w poprzek pola
  assert.equal(out[HALL_DUST_IN.ships], 1);
  assert.ok(hallBodyFieldSpan(out, 0, DOM, g1, 60, span) > 5);
  const mid = (span[0] + span[1]) / 2;
  assert.ok(Math.abs(g1.ax + g1.ux * mid + 810) < 70, `środek przecięcia ${g1.ax + g1.ux * mid}`);
  const w = span[1] - span[0];
  assert.ok(w > 806 * 0.6 && w < 806 + 130, `szerokość przecięcia ${w.toFixed(0)} (kadłub 806)`);
  pack(-810, L.frontZ - 2500);   // w hali, z dala od bramy
  assert.equal(hallBodyFieldSpan(out, 0, DOM, g1, 60, span), 0);
});

test('rastr: ściany ciągłe, bramy (bez pól siłowych) otwarte, wnętrze i próżnia, kurz tylko we wnętrzu (więcej przy ścianach)', () => {
  const RASTER = rasterizeHallCells(L, DOM, { forceFields: false });
  const cellAt = (x, z) => {
    const o = (Math.floor((z - DOM.z0) / DOM.h) * DOM.nx + Math.floor((x - DOM.x0) / DOM.h)) * 4;
    return { solid: RASTER.data[o] > 127, dirt: RASTER.data[o + 1] / 255, inside: RASTER.data[o + 2] > 127 };
  };
  // ściana tylna (z = backZ) na całej szerokości
  for (let x = -L.halfWidth + 200; x <= L.halfWidth - 200; x += 140) assert.ok(cellAt(x, L.backZ).solid, `tylna ściana x=${x}`);
  // ściany boczne
  for (let z = L.backZ + 200; z <= L.bodyEndZ - 200; z += 140) {
    assert.ok(cellAt(-L.halfWidth, z).solid, `lewa ściana z=${z}`);
    assert.ok(cellAt(L.halfWidth, z).solid, `prawa ściana z=${z}`);
  }
  // brama G-01 (cała krawędź frontu poza ościeżnicami) otwarta
  for (let x = -L.frontHalfWidth + 300; x <= L.frontHalfWidth - 300; x += 140) assert.ok(!cellAt(x, L.frontZ).solid, `brama x=${x}`);
  // wnętrze / próżnia
  const mid = cellAt(0, 3500);
  assert.ok(mid.inside && !mid.solid);
  assert.ok(mid.dirt > 0);
  const vac = cellAt(0, L.frontZ + 800);
  assert.ok(!vac.inside && vac.dirt === 0, 'za bramą próżnia bez kurzu');
  // kurz: średnio więcej przy ścianie tylnej niż na środku hali
  let nearWall = 0, middle = 0, n = 0;
  for (let x = -3000; x <= 3000; x += 100) {
    nearWall += cellAt(x, L.backZ + 220).dirt;
    middle += cellAt(x, 4200).dirt;
    n++;
  }
  assert.ok(nearWall / n > middle / n, `przy ścianie ${nearWall / n} vs środek ${middle / n}`);
  assert.ok(RASTER.solid > 1000 && RASTER.inside > 50000);
});

test('rastr deterministyczny (szum z haszu, bez Math.random)', () => {
  const a = rasterizeHallCells(L, DOM);
  assert.deepEqual(a.data, RASTER.data);
  const src = readFileSync(new URL('../src/3d/gasField/hallDustLayout.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.random/);
});

test('przekształcenie hala → gra: zgodne z ramką hali i układem ringu we wszystkich 12 halach, sztywne, odwracalne', () => {
  for (const id of ['earth', 'mars', 'jupiter']) {
    const col = new HaloRingCollider({ id, name: id, x: 6123456.7, y: 4234567.8 });
    assert.equal(col.registry.halls.length, 4, id);
    for (const owner of col.registry.halls) {
      const a = hallToGameAffine(col.place, owner.frame, {});
      assert.ok(Math.abs(a.ax * a.by - a.bx * a.ay - 1) < 1e-12, 'obrót właściwy (wyznacznik +1)');
      for (const [x, z] of [[0, 0], [-810, 1900], [5220, 7400], [-3000, 250]]) {
        const l = k7HubToWorld(owner.frame, x, z, {});
        const g = haloLocalToGame(col.place, l.x, l.y, {});
        assert.ok(Math.abs(a.p0x + x * a.ax + z * a.bx - g.x) < 1e-6 && Math.abs(a.p0y + x * a.ay + z * a.by - g.y) < 1e-6, `${id} hala ${owner.index}`);
        const h = gameToHall(a, g.x, g.y, {});
        assert.ok(Math.abs(h.x - x) < 1e-6 && Math.abs(h.z - z) < 1e-6);
      }
      const v = gameVecToHall(a, a.bx, a.by, {});
      assert.ok(Math.abs(v.x) < 1e-12 && Math.abs(v.z - 1) < 1e-12, 'oś z hali');
    }
  }
});

test('wejście klatki: stały układ, hala przy kamerze, okręty w układzie hali, pauza = dt 0, limit 16 okrętów', () => {
  const I = HALL_DUST_IN;
  assert.equal(I.service, I.header + I.stride * HALL_DUST_MAX_SHIPS, 'blok obsługi za okrętami');
  assert.equal(I.size, I.service + HALL_DUST_SERVICE_BERTHS * HALL_DUST_SERVICE.stride);
  const keys = Object.entries(I).filter(([k]) => !['header', 'stride', 'size', 'service'].includes(k)).map(([, v]) => v);
  assert.equal(new Set(keys).size, keys.length, 'pola bez nakładania');
  assert.ok(Math.max(...keys) < I.header);
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 6123456.7, y: 4234567.8 });
  const rings = [{ collider: col }];
  const owner = col.registry.halls[2];
  const a = hallToGameAffine(col.place, owner.frame, {});
  const at = (x, z) => ({ x: a.p0x + x * a.ax + z * a.bx, y: a.p0y + x * a.ay + z * a.by });
  const c = at(0, 3500);
  const heading = Math.atan2(a.by, a.bx);
  const ship = { pos: at(-810, 1900), vel: { x: a.bx * 100, y: a.by * 100 }, angle: heading, w: 1800, h: 806 };
  const far = { pos: at(0, 60000), vel: { x: 0, y: 0 }, angle: 0, w: 400, h: 200 };
  const out = createHallDustInput();
  // pozy obsługi stanowisk (rejestr kolidera — przewody paliwowe C-02 podpięte, upust) i poziom lamp hali
  Object.assign(owner.poses.get('C-02'), { lock: 1, extension: 1, flow: 1, vent: 0.5, clamp: 1 });
  owner.lampLevel = 0.6;
  packHallDustFrame(out, { dt: 1 / 60, camX: c.x, camY: c.y, viewHalf: 3000, rings, ship, npcs: [far], sun: { x: c.x + 1e6, y: c.y }, clock: 123.25 });
  assert.equal(out[I.clock], 123.25, 'zegar migania świateł hali');
  assert.equal(out[I.lamps], 0.6, 'poziom lamp hali');
  const SV = HALL_DUST_SERVICE;
  const c02 = I.service + 1 * SV.stride;
  assert.deepEqual([out[c02 + SV.lock], out[c02 + SV.extension], out[c02 + SV.flow], out[c02 + SV.vent], out[c02 + SV.occupied]], [1, 1, 1, 0.5, 1]);
  assert.equal(out[I.service + SV.occupied], 0, 'C-01 wolne (bez póz obsługi)');
  assert.equal(out[I.active], 1);
  assert.equal(out[I.hall], 16 + 3, 'pierścień 0, hala 2');
  assert.equal(out[I.ships], 1, 'okręt daleko poza domeną pominięty');
  const o = I.header;
  const SH = HALL_DUST_SHIP;
  assert.ok(Math.abs(out[o + SH.cx] + 810) < 1e-6 && Math.abs(out[o + SH.cz] - 1900) < 1e-6, 'kotwica w układzie hali');
  assert.ok(Math.abs(out[o + SH.ex]) < 1e-9 && Math.abs(out[o + SH.ez] - 1) < 1e-9, 'oś X kadłuba (dziób) ku bramie (+z hali)');
  assert.ok(Math.abs(out[o + SH.ex] * out[o + SH.fx] + out[o + SH.ez] * out[o + SH.fz]) < 1e-9, 'osie prostopadłe');
  assert.ok(Math.abs(out[o + SH.vz] - 100) < 1e-6, 'prędkość w układzie hali');
  // bez kadłuba belkowego: fazowany prostokąt z wymiarów sprite'a (1800 × 806)
  assert.ok(Math.abs(out[o + SH.x0] + 900 + out[o + SH.tx]) < 1e-6 && Math.abs(out[o + SH.tx] * (HALL_DUST_MASK.w - 2) - 1800) < 1e-6, 'maska obejmuje sprite');
  assert.equal(hallMaskBit(out, 0, HALL_DUST_MASK.w >> 1, HALL_DUST_MASK.h >> 1), 1, 'środek kadłuba');
  assert.equal(hallMaskBit(out, 0, 1, 1), 0, 'fazowany narożnik');
  for (let i = 0; i < HALL_DUST_MASK.w; i++) assert.equal(hallMaskBit(out, 0, i, 0) + hallMaskBit(out, 0, i, HALL_DUST_MASK.h - 1), 0, 'pusty brzeg maski');
  assert.ok(Math.abs(Math.hypot(out[I.sunX], out[I.sunY]) - 1) < 1e-9, 'kierunek do Słońca jednostkowy');
  const s0 = out[I.serial];
  packHallDustFrame(out, { dt: 0, camX: c.x, camY: c.y, viewHalf: 3000, rings, ship, npcs: [] });
  assert.equal(out[I.dt], 0, 'pauza');
  assert.equal(out[I.serial], s0 + 1, 'numer klatki rośnie');
  // kamera daleko — hala nieaktywna
  const fc = at(0, 90000);
  packHallDustFrame(out, { dt: 1 / 60, camX: fc.x, camY: fc.y, viewHalf: 3000, rings, ship, npcs: [] });
  assert.equal(out[I.active], 0);
  // limit okrętów
  const crowd = Array.from({ length: 40 }, (_, k) => ({ pos: at(-3000 + k * 150, 3000), vel: { x: 0, y: 0 }, angle: 0, w: 300, h: 120 }));
  packHallDustFrame(out, { dt: 1 / 60, camX: c.x, camY: c.y, viewHalf: 3000, rings, ship, npcs: crowd });
  assert.equal(out[I.ships], HALL_DUST_MAX_SHIPS);
});

// ── Obrys kadłuba (src/game/hullFootprint.js): gaz rozcina sylwetkę okrętu, nie pudło ─────────────────────
window.wrecks = window.wrecks || [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { makeBridgeShip } = await import('./helpers/bridgeHulls.mjs');
const { hullFootprint } = await import('../src/game/hullFootprint.js');

test('obrys kadłuba: komórki stałe pola gazu = sylwetka Atlasa z siatki belek (zwężony dziób), obrót kadłuba, rzaz zmienia obrys', () => {
  const I = HALL_DUST_IN;
  const SH = HALL_DUST_SHIP;
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 6123456.7, y: 4234567.8 });
  const rings = [{ collider: col }];
  const a = hallToGameAffine(col.place, col.registry.halls[1].frame, {});
  const at = (x, z) => ({ x: a.p0x + x * a.ax + z * a.bx, y: a.p0y + x * a.ay + z * a.by });
  const cam = at(0, 3500);
  const p = at(400, 3300);
  const e = makeBridgeShip(HullBodies, 'atlas', p.x, p.y, 0.7);
  e.isPlayer = true;   // obrót sprite'a 0 (jak gracz)
  e.angVel = 0.2;
  const out = createHallDustInput();
  const pack = () => packHallDustFrame(out, { dt: 1 / 60, camX: cam.x, camY: cam.y, viewHalf: 3000, rings, ship: e, npcs: [] });
  pack();
  assert.equal(out[I.ships], 1);
  assert.ok(Math.abs(out[I.header + SH.w] - 0.2) < 1e-12, 'prędkość kątowa w orientacji hali (wyznacznik +1)');
  const cellOf = (gx, gy) => {
    const h = gameToHall(a, gx, gy, {});
    return [(h.x - DOM.x0) / DOM.h, (h.z - DOM.z0) / DOM.h];
  };
  const solidAt = (gx, gy) => {
    const [cx, cy] = cellOf(gx, gy);
    return hallBodySolidCpu(out, 0, DOM, cx, cy);
  };
  const hull = e.beamHull;
  const nodes = [];
  const s = hull.body.nodeStore;
  for (let i = 0; i < s.count; i++) if (s.active[i]) nodes.push(HullBodies.nodeWorld(hull, i, {}));
  // węzły kadłuba leżą w komórkach stałych
  const inside = nodes.filter((w) => solidAt(w.x, w.y)).length;
  assert.ok(inside / nodes.length > 0.95, `węzły w obrysie: ${inside} / ${nodes.length}`);
  // punkty dawnego pudła (0,94 w × 0,78 h sprite'a) daleko od kadłuba NIE są stałe — pudło było za duże
  const W = hull.srcWidth, H = hull.srcHeight, cs = hull.body.cellSize;
  const c = Math.cos(e.angle), sn = Math.sin(e.angle);
  let boxN = 0, boxSolid = 0, farN = 0, farSolid = 0;
  const far2 = (2.5 * cs) ** 2;
  for (let u = -0.47 * W; u <= 0.47 * W; u += 20) {
    for (let v = -0.39 * H; v <= 0.39 * H; v += 20) {
      const gx = e.x + u * c - v * sn, gy = e.y + u * sn + v * c;
      const sol = solidAt(gx, gy);
      boxN++;
      if (sol) boxSolid++;
      let near = false;
      for (const w of nodes) {
        const dx = w.x - gx, dy = w.y - gy;
        if (dx * dx + dy * dy < far2) { near = true; break; }
      }
      if (!near) { farN++; if (sol) farSolid++; }
    }
  }
  assert.ok(farN > boxN * 0.15, `dawne pudło zawierało pustkę: ${farN} / ${boxN}`);
  assert.equal(farSolid, 0, 'pustka daleko od kadłuba nie jest przeszkodą');
  assert.ok(boxSolid < boxN * 0.8, `obrys mniejszy od pudła: ${boxSolid} / ${boxN}`);
  // dziób zwężony (dawne pudło: stała szerokość 0,78 h = 629 j. na całej długości)
  const width = (u) => {
    let n = 0;
    for (let v = -H * 0.5; v <= H * 0.5; v += 4) if (solidAt(e.x + u * c - v * sn, e.y + u * sn + v * c)) n++;
    return n * 4;
  };
  const mid = width(0), bow = width(0.95 * W * 0.5), stern = width(-0.9 * W * 0.5);
  assert.ok(mid > 380 && mid < 0.78 * H, `śródokręcie ${mid} j.`);
  assert.ok(bow < mid * 0.35, `dziób ${bow} j. przy śródokręciu ${mid} j.`);
  assert.ok(stern < mid, `rufa ${stern} j.`);
  // rzaz w poprzek rufy: odcięta część (wrak) wypada z obrysu okrętu
  const fp0 = hullFootprint(e, HALL_DUST_MASK.w, HALL_DUST_MASK.h).version;
  const cut = -0.25 * W;
  const ca = { x: e.x + cut * c + H * sn, y: e.y + cut * sn - H * c };
  const cb = { x: e.x + cut * c - H * sn, y: e.y + cut * sn + H * c };
  const before = window.wrecks.length;
  HullBodies.cutSegment(e, ca.x, ca.y, cb.x, cb.y, cs * 1.2, { push: true });
  for (let i = 0; i < 30; i++) HullBodies.step(1 / 120, [e, ...window.wrecks]);
  const wreck = window.wrecks.slice(before).find((w) => w.beamHull);
  assert.ok(wreck, 'rufa odcięta jako wrak');
  pack();
  assert.ok(hullFootprint(e, HALL_DUST_MASK.w, HALL_DUST_MASK.h).version > fp0, 'obrys przebudowany po zmianie ciała');
  const wh = wreck.beamHull, ws = wh.body.nodeStore;
  let wn = 0, wSolid = 0;
  for (let i = 0; i < ws.count; i++) {
    if (!ws.active[i]) continue;
    const w = HullBodies.nodeWorld(wh, i, {});
    wn++;
    if (solidAt(w.x, w.y)) wSolid++;
  }
  assert.ok(wn > 100 && wSolid / wn < 0.05, `węzły odciętej rufy w obrysie okrętu: ${wSolid} / ${wn}`);
});

// ── Model strumienia MAIN i bilans pyłu (audyt 2026-10-12, docs/AUDYT-pyl-hali-2026-10-12.md § 6) ─────────
// Atlas: 5 dysz MAIN r = 34 j., w poprzek osi gromady 0, ±106, ±193 j.; EngineFrame.spread = 227 j. (oś → brzeg skrajnej
// dyszy), √Σr² = 76 j. Strojenie jak HALL_DUST_TUNE (hallDust.js — moduł renderu, tu bez Core3D): jetWidth 1,35,
// jetWiden 0,16, jetSourceLen 600 j., jetFlow 260, jetFlat 0,69.
const ATLAS = { spread: 227, rEq: Math.sqrt(5 * 34 * 34), across: [0, 106, 193], jetWidth: 1.35, widen: 0.16, srcLen: 600, flow: 260, k: 0.69 };

test('strumień MAIN: profil PŁASKI na szerokość gromady — skrajne dysze dmuchają prawie jak środkowa (dawny Gauss: ~połowa)', () => {
  const h = DOM.h;
  const w0 = ATLAS.spread * ATLAS.jetWidth / h;
  const len = 2800 / h;
  for (const along of [2, 6, 12]) {
    const mid = jetProfileCpu(along, 0, len, w0, ATLAS.widen, 1, ATLAS.k);
    const edge = jetProfileCpu(along, ATLAS.across[2] / h, len, w0, ATLAS.widen, 1, ATLAS.k);
    assert.ok(edge / mid > 0.85, `d=${along}: skrajna ${edge.toFixed(3)} / środek ${mid.toFixed(3)}`);
  }
  // dawny jeden stożek Gaussa (szerokość (spread + √Σr²)·1,15, exp(−2,2·x²)) — skrajna dysza dostawała ~połowę
  const wOld = (ATLAS.spread + ATLAS.rEq) * 1.15 / h;
  const old = jetProfileCpu(2, ATLAS.across[2] / h, len, wOld, ATLAS.widen, 0) / jetProfileCpu(2, 0, len, wOld, ATLAS.widen, 0);
  assert.ok(old < 0.6, `Gauss: ${old.toFixed(3)}`);
  // źródła gazu hali (D.z = 0) dalej Gauss
  assert.ok(Math.abs(jetProfileCpu(3, 2, 40, 4, 0.1, 0) - Math.exp(-2.2 * (2 / 4.3) ** 2) * jetProfileCpu(3, 0, 40, 4, 0.1, 0)) < 1e-12);
});

test('źródło objętości: cel dywergencji zsumowany po komórkach siatki = wydatek strumienia (Atlas: 5 dysz = 5 × jedna)', () => {
  const h = DOM.h;
  const w0 = ATLAS.spread * ATLAS.jetWidth / h;
  const len = 2800 / h;
  const ls = ATLAS.srcLen / h;
  const area = jetSourceIntegralCpu(len, w0, ATLAS.widen, ls, ATLAS.k);
  const Q = ATLAS.flow * (ATLAS.rEq / h) ** 2;   // [komórki²/s] — wydatek ∝ Σ r² dysz
  const q = Q / area;                            // jetD.x — wydatek na komórkę [1/s]
  // nasada i kierunek dowolne (ukośnie) — suma po środkach komórek jak w kernelu adwekcji
  const ax = 203.37, ay = 141.81, dx = 0.6, dy = 0.8;
  let sum = 0;
  for (let j = 0; j < DOM.ny; j++) {
    for (let i = 0; i < DOM.nx; i++) {
      const rx = i + 0.5 - ax, ry = j + 0.5 - ay;
      const along = rx * dx + ry * dy;
      const across = -rx * dy + ry * dx;
      sum += q * jetProfileCpu(along, across, len, w0, ATLAS.widen, 1, ATLAS.k) * jetSourceAlongCpu(along, ls);
    }
  }
  assert.ok(Math.abs(sum / Q - 1) < 0.02, `Σ celu ${sum.toFixed(1)} vs wydatek ${Q.toFixed(1)} komórek²/s`);
  // jedna dysza: 5 × mniej
  const Q1 = ATLAS.flow * (34 / h) ** 2;
  assert.ok(Math.abs(Q / Q1 - 5) < 1e-9);
});

test('zasłanianie stożka: za ścianą tylną hali i za zbiornikami paliwa poza strumieniem, przed nimi — w strumieniu', () => {
  const h = DOM.h;
  const cx = (-810 - DOM.x0) / h;          // oś stanowiska C-01
  const noz = (L.backZ + 650 - DOM.z0) / h; // wylot ~650 j. przed ścianą, strumień w ścianę (−z)
  const solid = (x, y) => RASTER.data[(Math.floor(y) * DOM.nx + Math.floor(x)) * 4] > 127;
  // pierwsza przeszkoda na osi (zbiorniki przy ścianie tylnej) i ściana tylna (ostatni pas stałych przed brzegiem domeny)
  const firstAt = (x) => { let y = noz; while (y > 0 && !solid(x, y)) y--; return y; };
  const first = Math.max(firstAt(cx - 6), firstAt(cx), firstAt(cx + 5));   // (oś stanowiska trafia w przerwę między zbiornikami)
  const wallRow = Math.floor((L.backZ - DOM.z0) / h);
  assert.ok(solid(cx, wallRow) && first > wallRow, `przeszkoda ${first} przed ścianą ${wallRow}`);
  let behindWall = wallRow;
  while (behindWall > 0 && solid(cx, behindWall)) behindWall--;
  const vis = (x, y) => jetVisibleCpu(RASTER.data, DOM.nx, DOM.ny, x, y, cx, noz);
  for (const dxc of [-6, 0, 5]) {
    assert.equal(vis(cx + dxc, first + 2.5), 1, `przed przeszkodą (Δx ${dxc})`);
    assert.equal(vis(cx + dxc, behindWall + 0.5), 0, `tuż za ścianą tylną (Δx ${dxc})`);
    assert.equal(vis(cx + dxc, 2.5), 0, `daleko za ścianą (Δx ${dxc})`);
  }
  // cień zbiorników: komórka między zbiornikiem a ścianą, gdzie oś przecina zbiornik
  let shadowed = 0, n = 0;
  for (let dxc = -12; dxc <= 12; dxc++) {
    if (!solid(cx + dxc, first - 0.5)) continue;   // kolumna za zbiornikiem
    let y = first - 0.5;
    while (y > wallRow && solid(cx + dxc, y)) y--;
    if (y <= wallRow + 1) continue;
    n++;
    if (!vis(cx + dxc + 0.5, y - 0.5)) shadowed++;
  }
  assert.ok(n > 5 && shadowed / n > 0.8, `cień zbiorników ${shadowed} / ${n}`);
  // otwarta hala — wszystko widoczne
  assert.equal(vis(cx + 3, noz + 60), 1);
});

test('zaokrąglanie stochastyczne zapisu RGBA16F: drobne przyrosty pyłu nie giną przy obcięciu ku zeru (RTX) ani przy do najbliższej', () => {
  // zapis f32 → f16 do tekstury storage: obcięcie (pomiar na RTX / D3D12, 2026-10-12) albo do najbliższej
  const ulp = (x) => 2 ** (Math.max(Math.floor(Math.log2(Math.max(Math.abs(x), 1e-30))), -14) - 10);
  const trunc = (x) => Math.sign(x) * Math.floor(Math.abs(x) / ulp(x)) * ulp(x);
  const nearest = (x) => Math.sign(x) * Math.round(Math.abs(x) / ulp(x)) * ulp(x);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  // pokład 0,7 dostaje z opadania 4·10⁻⁵ na podkrok (pół odstępu liczb połówkowych to 2,4·10⁻⁴): 2000 podkroków
  // (z szumem odchylenie losowe ~0,006 — próg 3σ; bez szumu ginie całe 0,08)
  const v0 = trunc(0.7);   // wartość połówkowa
  const dv = 4e-5, n = 2000, want = v0 + dv * n;
  let naiveT = v0, naiveN = v0, sT = v0, sN = v0;
  for (let i = 0; i < n; i++) {
    naiveT = trunc(naiveT + dv);
    naiveN = nearest(naiveN + dv);
    sT = trunc(sroundCpu(sT + dv, rnd(), 0));
    sN = nearest(sroundCpu(sN + dv, rnd(), 0.5));
  }
  assert.equal(naiveT, v0, 'zwykłe obcięcie zjada przyrost');
  assert.equal(naiveN, v0, 'zwykłe zaokrąglenie też');
  assert.ok(Math.abs(sT - want) < 0.02, `obcięcie + szum: ${sT} vs ${want}`);
  assert.ok(Math.abs(sN - want) < 0.02, `do najbliższej + szum: ${sN} vs ${want}`);
  // ubytek (pył w powietrzu 0,3 traci 2·10⁻⁵ na podkrok): obcięcie bez szumu zaokrągla w dół o cały odstęp
  const a0 = trunc(0.3);
  let a = a0, b = a0;
  for (let i = 0; i < n; i++) { a = trunc(a - 2e-5); b = trunc(sroundCpu(b - 2e-5, rnd(), 0)); }
  assert.ok(Math.abs(b - (a0 - 0.04)) < 0.015 && a < a0 - 0.1, `z szumem ${b}, bez ${a}`);
});

// ── WGSL (Node, bez GPU) ──────────────────────────────────────────────────────
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const sim = new GasField2D({ nx: DOM.nx, ny: DOM.ny, h: DOM.h, cellData: RASTER.data, noise3D: fxNoise.noise3D() });

test('kernele pola gazu: WGSL buduje się, ≤ 4 tekstury storage i ≤ 12 buforów uniformów na kernel, wczesne wyjście', () => {
  for (const k of sim.kernels()) {
    const b = renderer.backend.createNodeBuilder(k, renderer);
    b.build();
    const w = b.computeShader;
    assert.ok((w.match(/texture_storage_2d/g) || []).length <= 4, `${k.name}: tekstury storage`);
    assert.ok((w.match(/var<uniform>/g) || []).length <= 12, `${k.name}: bufory uniformów`);
    assert.match(w, /if \( \( object\.nodeUniform\d+ < 0\.5 \) \) \{\s*return;/, `${k.name}: wyjście bez aktywności (rozgrzewka)`);
    assert.doesNotMatch(w, /textureSample\(/, `${k.name}: próbki z poziomu 0 (compute)`);
  }
  assert.equal(sim.jacobi % 2, 1, 'nieparzyste iteracje — wynik w prsB');
  const wgsl = Object.fromEntries(sim.kernels().map((k) => {
    const b = renderer.backend.createNodeBuilder(k, renderer);
    b.build();
    return [k.name, b.computeShader];
  }));
  // miękki rzut: Jacobi dzieli przez (soft + 4) — (∇² − soft)·p = div − cel
  assert.match(wgsl.gasFieldJacobiAB, /\/ \( object\.nodeUniform\d+ \+ 4\.0 \)/, 'Jacobi z miękkim rzutem');
  // zaokrąglanie stochastyczne zapisu (pył, pokład, para, prędkość)
  for (const n of ['gasFieldAdvect', 'gasFieldDust', 'gasFieldProject']) assert.match(wgsl[n], /exp2\(/, `${n}: zaokrąglanie stochastyczne`);
  // zasłanianie stożka: marsz z przerwaniem
  assert.match(wgsl.gasFieldAdvect, /break;/, 'marsz zasłaniania');
});

test('warstwy pyłu: WGSL buduje się, macierz hala → scena ma wyznacznik +1 (klucz pipeline\'u = rozgrzewka)', () => {
  const layer = new GasFieldLayer(sim, {
    domain: DOM, detailTex: fxNoise.cloud2D(), grid: new LightGrid({ name: 'fxGrid' }), fields: k7ForceFieldList(L)
  });
  assert.equal(layer.fields.length, 3, 'pola siłowe trzech bram w grafie warstw');
  for (const mesh of [layer.back, layer.front]) {
    const b = renderer.backend.createNodeBuilder(mesh, renderer);
    b.material = mesh.material;
    b.scene = new THREE.Scene();
    b.camera = new THREE.OrthographicCamera();
    b.context.material = mesh.material;
    b.build();
    assert.ok(b.fragmentShader.length > 1000, mesh.name);
    assert.equal(mesh.material.forceSinglePass, true);
  }
  const col = new HaloRingCollider({ id: 'earth', name: 'earth', x: 7123456.7, y: 6234567.8 });
  const a = hallToGameAffine(col.place, col.registry.halls[1].frame, {});
  layer.place(a, -26, 9);
  assert.ok(layer.back.matrixWorld.determinant() > 0.999, 'wyznacznik +1');
  // róg (x0, z0) domeny trafia w świat gry przez uv (0, 0)
  const geo = layer.geometry;
  const uvA = geo.getAttribute('uv');
  const pos = geo.getAttribute('position');
  for (let i = 0; i < uvA.count; i++) {
    const p = new THREE.Vector3(pos.getX(i), pos.getY(i), 0).applyMatrix4(layer.back.matrixWorld);
    const hx = DOM.x0 + uvA.getX(i) * DOM.w;
    const hz = DOM.z0 + uvA.getY(i) * DOM.d;
    const gx = a.p0x + hx * a.ax + hz * a.bx;
    const gy = a.p0y + hx * a.ay + hz * a.by;
    assert.ok(Math.abs(p.x - gx) < 1e-3 && Math.abs(p.y + gy) < 1e-3, `wierzchołek ${i}: scena = (x, −y) gry`);
  }
});

test('szew gra ↔ render: src/3d/gasField bez window / DOM / requestIdleCallback (render w workerze)', () => {
  const dir = new URL('../src/3d/gasField/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const code = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bwindow\b|\bdocument\b|requestIdleCallback|localStorage/, f);
  }
  // klej renderu czyta tylko tablicę wejścia i EngineFrame — bez encji gry
  const glue = readFileSync(new URL('../src/3d/gasField/hallDust.js', import.meta.url), 'utf8');
  assert.doesNotMatch(glue, /\bnpcs\b|\.pos\.x|haloRings/);
});
