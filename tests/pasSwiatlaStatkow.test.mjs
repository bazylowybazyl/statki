// ŚWIATŁA STATKÓW W POLU ASTEROID BEZ DRŻENIA (2026-10-29, zgłoszenie użytkownika przy 5120 × 1440 @ 240 Hz: „drżące
// światła statków — snopy front i pomocnicze drżą”). Pas wkłada do siatki świateł gry (Core3D.fx.grid) reflektory dalekie
// gracza („snopy front”), reflektory otoczenia z obrysu („pomocnicze”), światło dookoła i poświatę lamp pozycyjnych —
// czyta je ośrodek (smugi), skały, gaz, pył i kadłuby. Kadłub gracza rysuje się w pozie RENDERU (interpolacja między
// krokami fizyki — RenderWorld.playerPose), a światła stały w pozie końca kroku: przy 240 Hz obrazu i 60 Hz fizyki
// wyprzedzały kadłub o (1 − α) · v / 60 i wracały co krok (piła 2,5 px przy 600 j/s, 12,9 px przy 3000 — zoom 0,34).
// Tu: prawdziwe AsteroidBelt._addShipLights na atrapie pasa (bez GPU), prawdziwa siatka i lampy Atlasa, pętla jak loop()
// w index.html (akumulator, α = 0,25 / 0,5 / 0,75 / 0). Pomiar w grze: scripts/webgpu/gpu-pas-gra.mjs --drzenie.
// node --test tests/pasSwiatlaStatkow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AsteroidBelt, ASTEROID_BELT_CONFIG, beltShipRenderPose } from '../src/3d/asteroids/asteroidBelt.js';
import { LightGrid, LIGHT_FLOATS, FIELD_SHIP_LIGHTS } from '../src/3d/fx/lightGrid.js';
import { RenderWorld } from '../src/render/renderWorld.js';
import { Core3D } from '../src/3d/core3d.js';
import { SHIP_LIGHT_DIR_TUNE } from '../src/game/shipLightRuntime.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const HP = 0.833;
const PHYS = 60;
const RENDER = 240;

function atlasShip() {
  return {
    pos: { x: 1.6e6 + 1234.5, y: 345.25 }, angle: 0.2, vel: { x: 0, y: 0 },
    editorLights: ATLAS_EDITOR_DEFAULTS.lights,
    __hardpointScale: HP, __hardpointScaleX: HP, __hardpointScaleY: HP,
    visual: { spriteScale: 1 }, capitalProfile: { spriteRotation: 0 }
  };
}

// Atrapa pasa: prawdziwe _addShipLights / _considerShip / _ownerOf, pola jak w konstruktorze.
function fakeBelt(ship, extra = {}) {
  const b = Object.create(AsteroidBelt.prototype);
  Object.assign(b, {
    cfg: { ...ASTEROID_BELT_CONFIG },
    _in: { ship, player2: null, npcs: null },
    _view: { x: ship.pos.x, y: ship.pos.y, zoom: 0.45 },
    _frame: { viewW: 5120, viewH: 1440 },
    _litShips: [], _litDist: [], _owners: new WeakMap(), _nextOwner: 1,
    _shipLightOpts: { time: 0, owner: 0, shadows: null, spotShadows: true, floods: true, nav: true, profile: FIELD_SHIP_LIGHTS, strength: 1, pose: null },
    lightsRenderPose: true, navClock: 'frame', lightDirTune: SHIP_LIGHT_DIR_TUNE,
    time: 0, atlas: null, _fade: 1,
    world: { roofAbove: () => false }
  }, extra);
  return b;
}

// Światła siatki w układzie kadłuba pozy (wzdłuż, w poprzek [j.], oś stożka − kąt pozy [rad]); kolejność = kolejność siatki.
function hullFrame(g, pose) {
  const out = [];
  const L = g.lights;
  const ca = Math.cos(pose.angle);
  const sa = Math.sin(pose.angle);
  for (let i = 0; i < g.count; i++) {
    const o = i * LIGHT_FLOATS;
    const dx = L[o] + g.originX - pose.x;
    const dy = -(L[o + 1] + g.originY) - pose.y;
    const cone = L[o + 11] > -1.5;
    const ax = cone ? Math.atan2(-L[o + 9], L[o + 8]) - pose.angle : 0;
    out.push([dx * ca + dy * sa, -dx * sa + dy * ca, Math.atan2(Math.sin(ax), Math.cos(ax)), L[o + 2]]);
  }
  return out;
}

// Lot: fizyka 60 Hz, obraz 240 Hz (akumulator jak loop()); poza renderu = interpolacja kroku poprzedniego i bieżącego
// (window.__interpShipPose / HEAD.INTERP). Zwraca rozpiętość (maks − min po klatkach) położenia każdego światła
// w układzie kadłuba (pozy renderu) — największą po światłach; pierwsze klatki (przed pierwszym krokiem) pominięte.
function fly(belt, ship, v, omega, frames = 96, skip = 8) {
  let x = ship.pos.x; let y = ship.pos.y; let a = ship.angle;
  let px = x; let py = y; let pa = a; let acc = 0;
  const pose = { x, y, angle: a };
  RenderWorld.setSource({ ship, playerPose: pose });
  let lo = null;
  let hi = null;
  let zs = null;
  let ref = null;
  try {
    for (let f = 0; f < frames; f++) {
      acc += 1 / RENDER;
      while (acc >= 1 / PHYS - 1e-12) {
        px = x; py = y; pa = a;
        a += omega / PHYS;
        x += Math.cos(a) * v / PHYS;
        y += Math.sin(a) * v / PHYS;
        acc -= 1 / PHYS;
      }
      const alpha = acc * PHYS;
      ship.pos.x = x; ship.pos.y = y; ship.angle = a;
      pose.x = px + (x - px) * alpha; pose.y = py + (y - py) * alpha; pose.angle = pa + (a - pa) * alpha;
      belt._view.x = pose.x; belt._view.y = pose.y;
      const g = new LightGrid();
      g.begin(Math.round(pose.x), -Math.round(pose.y));
      assert.equal(belt._addShipLights(g), 1);
      if (f < skip) continue;
      const rows = hullFrame(g, pose);
      if (!lo) {
        // oś względem pierwszej klatki (zawinięta) — reflektor rufy leży przy ±π
        zs = rows.map((r) => r[3]);
        ref = rows.map((r) => r[2]);
        for (const r of rows) r[2] = 0;
        lo = rows.map((r) => r.slice(0, 3));
        hi = rows.map((r) => r.slice(0, 3));
        continue;
      }
      assert.equal(rows.length, lo.length);
      for (let i = 0; i < rows.length; i++) {
        rows[i][2] = Math.atan2(Math.sin(rows[i][2] - ref[i]), Math.cos(rows[i][2] - ref[i]));
        for (let c = 0; c < 3; c++) {
          lo[i][c] = Math.min(lo[i][c], rows[i][c]);
          hi[i][c] = Math.max(hi[i][c], rows[i][c]);
        }
      }
    }
  } finally {
    RenderWorld.setSource(null);
  }
  const spread = { along: 0, across: 0, axis: 0, n: lo.length, byZ: new Map() };
  for (let i = 0; i < lo.length; i++) {
    const da = hi[i][0] - lo[i][0];
    const dc = hi[i][1] - lo[i][1];
    spread.along = Math.max(spread.along, da);
    spread.across = Math.max(spread.across, dc);
    spread.axis = Math.max(spread.axis, hi[i][2] - lo[i][2]);
    spread.byZ.set(zs[i], Math.max(spread.byZ.get(zs[i]) || 0, da, dc));
  }
  return spread;
}

test('światła gracza w polu stoją na kadłubie: poza renderu, nie piła kroku fizyki (A/B lightsRenderPose)', (t) => {
  // prosto 600 j/s (W), 1500 (dopalacz), 3000 (PRZELOT)
  for (const v of [600, 1500, 3000]) {
    const ship = atlasShip();
    const on = fly(fakeBelt(ship), ship, v, 0);
    assert.ok(on.n >= 10, `światła gracza w siatce: ${on.n}`);
    // reflektory dalekie (z 140), otoczenia (70), poświata lamp (40), światło dookoła (320) — wszystkie przypięte
    for (const z of [140, 70, 40, 320]) assert.ok(on.byZ.has(z), `z = ${z}`);
    // pozycje emiterów w round2 (0,01 j.) — reszta to zaokrąglenie, nie ruch
    assert.ok(on.along < 0.02 && on.across < 0.02, `v ${v}: rozrzut ${on.along.toFixed(4)} × ${on.across.toFixed(4)} j.`);
    assert.ok(on.axis < 1e-5, `v ${v}: oś ${on.axis}`);
    // dawniej (poza kroku fizyki): piła (1 − α) · v / 60 wzdłuż kadłuba — rozpiętość 0,75 · v / 60
    const ship2 = atlasShip();
    const off = fly(fakeBelt(ship2, { lightsRenderPose: false }), ship2, v, 0);
    const saw = 0.75 * v / PHYS;
    assert.ok(Math.abs(off.along - saw) < 0.05, `v ${v}: dawna piła ${off.along.toFixed(3)} j. (oczekiwana ${saw})`);
    for (const z of [140, 70, 40, 320]) assert.ok(off.byZ.get(z) > saw * 0.95, `dawniej piła też z = ${z}`);
    t.diagnostic(`v ${v} j/s: rozpiętość świateł wobec kadłuba ${Math.max(on.along, on.across).toFixed(4)} j. (dawniej ${off.along.toFixed(2)} j. = ${(off.along * 0.45).toFixed(2)} px przy zoomie 0,45)`);
  }
  // zakręt (A / D): oś i położenie świateł w układzie kadłuba stałe — kąt pozy renderu i osie bez zaokrąglenia
  const ship = atlasShip();
  const turn = fly(fakeBelt(ship), ship, 500, 0.3);
  assert.ok(turn.along < 0.02 && turn.across < 0.02 && turn.axis < 1e-5, `zakręt: ${turn.along} × ${turn.across}, oś ${turn.axis}`);
  const ship3 = atlasShip();
  const turnOff = fly(fakeBelt(ship3, { lightsRenderPose: false }), ship3, 500, 0.3);
  assert.ok(turnOff.axis > 0.3 / PHYS * 0.7, `dawniej oś za kadłubem: ${turnOff.axis}`);
  t.diagnostic(`zakręt 0,3 rad/s: oś wobec kadłuba ${(turn.axis * 180 / Math.PI).toExponential(2)}° (dawniej ${(turnOff.axis * 180 / Math.PI).toFixed(3)}°)`);
});

test('poza świateł: tylko gracz z pełną pozą renderu; gracz 2, NPC i brak pozy — poza encji', () => {
  const ship = atlasShip();
  const other = atlasShip();
  const pose = { x: 1, y: 2, angle: 0.5 };
  try {
    RenderWorld.setSource({ ship, playerPose: pose });
    assert.equal(beltShipRenderPose(ship), pose);
    assert.equal(beltShipRenderPose(other), null);
    assert.equal(beltShipRenderPose(null), null);
    for (const bad of [null, { x: NaN, y: 2, angle: 0 }, { x: 1, y: 2 }]) {
      RenderWorld.setSource({ ship, playerPose: bad });
      assert.equal(beltShipRenderPose(ship), null);
    }
  } finally {
    RenderWorld.setSource(null);
  }
  // wiązka ściągająca platformy wydobywczej: początek przy kadłubie gracza (poza renderu), A/B jak światła
  const belt = fakeBelt(ship);
  const out = { x: 0, y: 0 };
  try {
    RenderWorld.setSource({ ship, playerPose: pose });
    assert.deepEqual(belt._shipRenderPoint(ship, out), { x: 1, y: 2 });
    assert.deepEqual(belt._shipRenderPoint(other, out), { x: other.pos.x, y: other.pos.y });
    belt.lightsRenderPose = false;
    assert.deepEqual(belt._shipRenderPoint(ship, out), { x: ship.pos.x, y: ship.pos.y });
  } finally {
    RenderWorld.setSource(null);
  }
  // pas: domyślnie poza renderu i zegar klatki poświaty (konstruktor)
  const src = read('src/3d/asteroids/asteroidBelt.js');
  assert.match(src, /mv\.ship = ship && ship\.pos \? this\._shipRenderPoint\(ship, this\._miningShip\) : null;/);
  assert.match(src, /this\.lightsRenderPose = true;/);
  assert.match(src, /this\.navClock = 'frame';/);
  assert.match(src, /opts\.pose = pose;/);
});

test('poświata lamp pozycyjnych w pyle: zegar klatki efektów jak billboardy i lampy kadłuba (A/B navClock)', () => {
  const keep = Core3D.fxNowMs;
  const ship = atlasShip();
  try {
    Core3D.fxNowMs = 123456.5;
    const b = fakeBelt(ship, { time: 42.25 });
    b._addShipLights(new LightGrid().begin(Math.round(ship.pos.x), -Math.round(ship.pos.y)));
    assert.equal(b._shipLightOpts.time, 123.4565, 'Core3D.frameNowMs() · 0,001');
    assert.equal(b._shipLightOpts.pose, null, 'poza nie zostaje w opcjach');
    b.navClock = 'belt';
    b._addShipLights(new LightGrid().begin(Math.round(ship.pos.x), -Math.round(ship.pos.y)));
    assert.equal(b._shipLightOpts.time, 42.25, 'dawny zegar skał');
  } finally {
    Core3D.fxNowMs = keep;
  }
});
