import test from 'node:test';
import assert from 'node:assert/strict';

// Rozkazy RTS omijają przeszkody (2026-10-08): pilot rozkazów (src/ai/npcCommandPilot.js) dostaje
// z capitalAI.js tę samą drogę co mózgi — ogranicznik przed przeszkodą, objazd po stycznej, wraki jako
// kapsuły (aiWreckIndex.js), sufit całej prędkości — plus separację i unik CPA. Semantyka rozkazów
// zostaje: STÓJ trzyma punkt, orbita krąży w promieniu, taran trafia cel, ruch kończy się w punkcie
// (punkt w wraku — najbliżej, jak się da). W grze: node scripts/webgpu/rozkazy-omijanie-gra.mjs [--omijanie 0].

globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, {
  wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
  queryAIGrid: null,
  ship: null,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: []
});

const { capitalCommandSteer, capitalCommandFreePoint, capitalCommandSeparate } = await import('../src/ai/capitalAI.js');
const Idx = await import('../src/ai/aiWreckIndex.js');
const { applyNpcCommandIntent } = await import('../src/ai/npcCommandPilot.js');
const { stepShipFlight } = await import('../src/game/flight/shipFlightModel.js');
const Grid = await import('../src/ai/aiSpatialGrid.js');
// Siatka AI tylko w testach okręt × okręt (moduł przy imporcie wpina się do window — tu jawnie).
window.queryAIGrid = null;
window.rebuildAIGrid = null;
async function withGrid(fn) {
  window.queryAIGrid = Grid.queryAIGrid;
  window.rebuildAIGrid = Grid.rebuildAIGrid;
  try { return await fn(); } finally {
    window.queryAIGrid = null;
    window.rebuildAIGrid = null;
  }
}

const DT = 1 / 120;
const wreck = (x, y, radius, angle = 0) => ({ x, y, vx: 0, vy: 0, radius, angle, dead: false, isCollidable: true });
const frigate = (x, y, extra = {}) => ({
  x, y, vx: 0, vy: 0, angle: 0, angVel: 0, radius: 111,
  mission: true, friendly: true, type: 'frigate_pd', shipFrame: 'terran_frigate', ...extra
});

function deps(extra = {}) {
  return {
    getTargetPos: (unit, cmd) => {
      const e = cmd.targetEntity;
      if (e && !e.dead) return { x: e.x, y: e.y };
      return cmd.target || null;
    },
    pickTarget: () => null,
    triggerRam: () => {},
    defaultOrbitRadius: 900,
    steer: capitalCommandSteer,
    freePoint: capitalCommandFreePoint,
    separate: capitalCommandSeparate,
    ...extra
  };
}
const plainDeps = (extra = {}) => deps({ steer: undefined, freePoint: undefined, separate: undefined, ...extra });

// Odstęp kadłuba (pół-szerokość jak w considerWreck: 0,4 promienia) od kapsuły wraku
// (pół-szerokość 0,33 promienia, oś ± (promień − pół-szerokości)); < 0 = taran.
function wreckGap(ship, w) {
  const hw = Math.max(50, w.radius * 0.33);
  const h = Math.max(0, w.radius - hw);
  const ux = Math.cos(w.angle);
  const uy = Math.sin(w.angle);
  let s = (ship.x - w.x) * ux + (ship.y - w.y) * uy;
  s = Math.max(-h, Math.min(h, s));
  return Math.hypot(ship.x - (w.x + ux * s), ship.y - (w.y + uy * s)) - hw - ship.radius * 0.4;
}

function run(ships, seconds, d, onTick) {
  const list = Array.isArray(ships) ? ships : [ships];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    window.__frameId++;
    if (window.rebuildAIGrid && i % 6 === 0) window.rebuildAIGrid(list, false);
    for (const s of list) if (s.command) applyNpcCommandIntent(s, s.command, d, DT);
    for (const s of list) stepShipFlight(s, DT);
    if (onTick) onTick(i * DT);
  }
}

function withWrecks(wrecks, fn) {
  Idx.rebuildWreckIndex(wrecks);
  try { return fn(); } finally { Idx.resetWreckIndex(); }
}

test('move order flies around a long wreck lying across its way (and rams it without avoidance)', () => {
  const w = wreck(0, 0, 391, Math.PI / 2);
  const fly = (d) => withWrecks([w], () => {
    const ff = frigate(-3000, 0);
    ff.command = { type: 'move', target: { x: 4000, y: 0 }, arrival: 136 };
    let minGap = Infinity;
    run(ff, 20, d, () => { minGap = Math.min(minGap, wreckGap(ff, w)); });
    return { ff, minGap };
  });
  const a = fly(deps());
  assert.equal(a.ff.command?.type, 'hold', 'rozkaz nie doleciał');
  assert.ok(Math.hypot(a.ff.x - 4000, a.ff.y) < 136 + 30, `stanęła w ${a.ff.x.toFixed(0)},${a.ff.y.toFixed(0)}`);
  assert.ok(a.minGap > 0, `przeleciała przez wrak: ${a.minGap.toFixed(0)}`);
  const b = fly(plainDeps());
  assert.ok(b.minGap < 0, `bez omijania test nic nie sprawdza: ${b.minGap.toFixed(0)}`);
});

test('move orders through a field of wrecks reach their points without touching any', () => {
  // Pole jak w scripts/webgpu/wraki-omijanie-gra.mjs: 4 kolumny co 1,5 km, rzędy co 550 j., wraki
  // pancerników, niszczycieli i fregat pod różnymi kątami. (Gęstszy stos potrafi zatrzymać okręt
  // w miejscu — tak samo mózgi bojowe: objazd po kole całego wraku, lokalne minimum.)
  const R = [391, 300, 160, 111];
  const field = [];
  for (let k = 0; k < 16; k++) field.push(wreck(-2000 + (k % 4) * 1500, ((k * 5) % 9 - 4) * 550, R[k % 4], k * 0.7));
  withWrecks(field, () => {
    for (const y0 of [-1800, 0, 1600]) {
      for (const [type, shipFrame, radius] of [['frigate_pd', 'terran_frigate', 111], ['destroyer', 'terran_destroyer', 180]]) {
        const ff = frigate(-4500, y0, { type, shipFrame, radius });
        ff.command = { type: 'move', target: { x: 4500, y: -y0 * 0.7 }, arrival: radius + 25 };
        let minGap = Infinity;
        run(ff, 25, deps(), () => { for (const w of field) minGap = Math.min(minGap, wreckGap(ff, w)); });
        assert.equal(ff.command?.type, 'hold', `${type} z y ${y0}: nie doleciał (${ff.x.toFixed(0)}, ${ff.y.toFixed(0)})`);
        assert.ok(minGap > 0, `${type} z y ${y0}: otarł się o wrak (${minGap.toFixed(0)})`);
      }
    }
  });
});

test('move order to a point inside a wreck ends next to the wreck, on the ship side', () => {
  const w = wreck(0, 0, 391, 0); // oś wzdłuż x
  // Wolny punkt przy burcie od strony okrętu: (100, −343) — pół-szerokość korytarza 263 + zapas 80.
  for (const target of [{ x: 100, y: 30, max: 440 }, { x: 100, y: 120, max: 530 }]) {
    withWrecks([w], () => {
      const ff = frigate(0, -2500);
      ff.command = { type: 'move', target, arrival: 136 };
      let minGap = Infinity;
      run(ff, 20, deps(), () => { minGap = Math.min(minGap, wreckGap(ff, w)); });
      assert.equal(ff.command?.type, 'hold', `(${target.x}, ${target.y}): rozkaz nie skończył się`);
      assert.ok(minGap > 0, `(${target.x}, ${target.y}): wjechała we wrak ${minGap.toFixed(0)}`);
      assert.ok(ff.y < 0, `(${target.x}, ${target.y}): objechała wrak na drugą stronę`);
      const d = Math.hypot(ff.x - target.x, ff.y - target.y);
      assert.ok(d < target.max, `(${target.x}, ${target.y}): stanęła ${d.toFixed(0)} j. od punktu`);
    });
  }
});

test('hold keeps its point: a pushed ship comes back around a wreck that drifted in between', () => {
  // Bez przeszkód — jak dawniej.
  const solo = frigate(0, 0);
  solo.command = { type: 'hold' };
  applyNpcCommandIntent(solo, solo.command, deps(), DT);
  solo.vx = 600;
  run(solo, 15, deps());
  assert.ok(Math.hypot(solo.x, solo.y) < 30, `odpłynęła o ${Math.hypot(solo.x, solo.y).toFixed(0)} j.`);
  // Odepchnięta za wrak: wraca do punktu, objeżdżając go.
  const w = wreck(700, 0, 391, Math.PI / 2);
  withWrecks([w], () => {
    const ff = frigate(0, 0);
    ff.command = { type: 'hold' };
    applyNpcCommandIntent(ff, ff.command, deps(), DT);
    ff.x = 1500;
    let minGap = Infinity;
    run(ff, 30, deps(), () => { minGap = Math.min(minGap, wreckGap(ff, w)); });
    assert.equal(ff.command?.type, 'hold');
    assert.ok(Math.hypot(ff.x, ff.y) < 60, `nie wróciła: ${ff.x.toFixed(0)},${ff.y.toFixed(0)}`);
    assert.ok(minGap > 0, `wróciła przez wrak: ${minGap.toFixed(0)}`);
  });
});

function orbitStats(ship, center, seconds, d, onTick) {
  let minR = Infinity;
  let maxR = 0;
  let unwrapped = 0;
  let last = Math.atan2(ship.y - center.y, ship.x - center.x);
  run(ship, seconds, d, (t) => {
    const b = Math.atan2(ship.y - center.y, ship.x - center.x);
    unwrapped += Math.atan2(Math.sin(b - last), Math.cos(b - last));
    last = b;
    if (t > 8) {
      const r = Math.hypot(ship.x - center.x, ship.y - center.y);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    if (onTick) onTick(t);
  });
  return { minR, maxR, unwrapped };
}

test('orbit around a wreck circles at the ordered radius (the orbited wreck is not an obstacle)', () => {
  const w = wreck(0, 0, 391, 0.3);
  withWrecks([w], () => {
    const ff = frigate(900, 0);
    ff.command = { type: 'orbit', targetEntity: w, target: { x: 0, y: 0 }, orbitRadius: 900, orbitDir: 1 };
    const o = orbitStats(ff, w, 30, deps());
    assert.ok(o.minR > 650 && o.maxR < 1200, `promień ${o.minR.toFixed(0)}..${o.maxR.toFixed(0)}`);
    assert.ok(o.unwrapped > Math.PI * 2, 'nie okrąża wraku');
  });
});

test('orbit goes around a wreck lying on the circle and keeps circling', () => {
  const center = { x: 0, y: 0, vx: 0, vy: 0 };
  const w = wreck(0, 1200, 260, 0);
  withWrecks([w], () => {
    const ff = frigate(1200, 0);
    ff.command = { type: 'orbit', targetEntity: center, target: { x: 0, y: 0 }, orbitRadius: 1200, orbitDir: 1 };
    let minGap = Infinity;
    const o = orbitStats(ff, center, 45, deps(), () => { minGap = Math.min(minGap, wreckGap(ff, w)); });
    assert.ok(o.unwrapped > Math.PI * 4, `stanęła na okręgu: ${(o.unwrapped / (2 * Math.PI)).toFixed(2)} okrążenia`);
    assert.ok(minGap > 0, `wjechała we wrak na okręgu: ${minGap.toFixed(0)}`);
    assert.ok(o.minR > 450 && o.maxR < 1900, `promień ${o.minR.toFixed(0)}..${o.maxR.toFixed(0)}`);
  });
});

test('ram order still hits its target at speed (the rammed wreck is not an obstacle)', () => {
  const w = wreck(3000, 0, 300, Math.PI / 2);
  withWrecks([w], () => {
    const ff = frigate(0, 0);
    const rams = [];
    let speedAtRam = 0;
    ff.command = { type: 'ram', targetEntity: w, target: { x: w.x, y: w.y }, arrival: 671, ramImpulse: 3400 };
    run(ff, 15, deps({ triggerRam: (unit, impulse) => { rams.push(impulse); speedAtRam = Math.hypot(unit.vx, unit.vy); } }));
    assert.equal(rams.length, 1, 'taran nie odpalił');
    assert.ok(speedAtRam > 300, `ominęła cel taranu zamiast w niego lecieć: ${speedAtRam.toFixed(0)} j/s`);
  });
});

test('approach order to a wreck flies exactly as before (the approached wreck is not an obstacle)', () => {
  const w = wreck(2500, 400, 391, 0);
  const arrival = 111 + 391;
  const fly = (d) => withWrecks([w], () => {
    const ff = frigate(-1500, 0);
    ff.command = { type: 'approach', targetEntity: w, target: { x: w.x, y: w.y }, arrival };
    let minD = Infinity;
    run(ff, 20, d, () => { minD = Math.min(minD, Math.hypot(ff.x - w.x, ff.y - w.y)); });
    return { ff, minD };
  });
  const on = fly(deps());
  const off = fly(plainDeps());
  assert.equal(on.ff.command?.type, 'hold');
  assert.ok(Math.hypot(on.ff.x - w.x, on.ff.y - w.y) < arrival + 40, 'nie podeszła');
  // Promień przybycia = suma promieni (styk dziobem); przestrzał przy hamowaniu to pilot lotu (bez zmian).
  assert.ok(Math.abs(on.minD - off.minD) < 5, `podejście inne niż bez omijania: ${on.minD.toFixed(0)} vs ${off.minD.toFixed(0)}`);
});

test('two ships ordered through each other pass without touching (real AI grid)', () => withGrid(() => {
  const fly = (d) => {
    const a = frigate(-2500, 0, { id: 'a' });
    const b = frigate(2500, 40, { id: 'b' });
    a.command = { type: 'move', target: { x: 2500, y: 0 }, arrival: 136 };
    b.command = { type: 'move', target: { x: -2500, y: 40 }, arrival: 136 };
    let minD = Infinity;
    run([a, b], 25, d, () => { minD = Math.min(minD, Math.hypot(a.x - b.x, a.y - b.y)); });
    return { a, b, minD };
  };
  {
    const on = fly(deps());
    // Kadłub fregaty to ~2 × 111 j. długości i ~0,8 × 111 szerokości: mijanie burtami > 2 × 0,4 × 111.
    assert.ok(on.minD > 220, `otarły się: ${on.minD.toFixed(0)}`);
    assert.equal(on.a.command?.type, 'hold');
    assert.equal(on.b.command?.type, 'hold');
    const off = fly(plainDeps());
    assert.ok(off.minD < 180, `bez omijania test nic nie sprawdza: ${off.minD.toFixed(0)}`);
  }
}));

test('move order to a point taken by a holding ship stops short of it and ends as hold (real AI grid)', () => withGrid(() => {
  {
    const keeper = frigate(0, 0, { id: 'k' });
    keeper.command = { type: 'hold' };
    const mover = frigate(-3000, 300, { id: 'm' });
    mover.command = { type: 'move', target: { x: 60, y: 20 }, arrival: 136 };
    let minD = Infinity;
    run([keeper, mover], 20, deps(), () => { minD = Math.min(minD, Math.hypot(keeper.x - mover.x, keeper.y - mover.y)); });
    assert.equal(mover.command?.type, 'hold', 'rozkaz nie skończył się przy zajętym punkcie');
    assert.ok(minD > 230, `wjechał w stojący okręt: ${minD.toFixed(0)}`);
    // Stojący ustępuje z kursu (unik CPA), ale nie odlatuje.
    assert.ok(Math.hypot(keeper.x, keeper.y) < 250, `zepchnięty: ${Math.hypot(keeper.x, keeper.y).toFixed(0)}`);
  }
}));

test('move order goes around the player ship standing on its way', () => {
  window.ship = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: 400, destroyed: false };
  try {
    const fly = (d) => {
      const ff = frigate(-3500, 30);
      ff.command = { type: 'move', target: { x: 3500, y: 0 }, arrival: 136 };
      let minD = Infinity;
      run(ff, 20, d, () => { minD = Math.min(minD, Math.hypot(ff.x, ff.y)); });
      return { ff, minD };
    };
    const on = fly(deps());
    assert.equal(on.ff.command?.type, 'hold', 'nie doleciała');
    assert.ok(on.minD > 400 + 111, `otarła się o gracza: ${on.minD.toFixed(0)}`);
    assert.ok(fly(plainDeps()).minD < 200, 'bez omijania test nic nie sprawdza');
  } finally {
    window.ship = null;
  }
});

test('group move into the tight default RTS formation: everyone ends the order, nobody rams (real AI grid)', () => withGrid(() => {
  const K = { f: ['frigate_pd', 'terran_frigate', 111], d: ['destroyer', 'terran_destroyer', 180], b: ['battleship', 'terran_battleship', 400] };
  const fly = (d) => {
    const L = [];
    const comp = 'ffffffffdddb';
    for (let i = 0; i < comp.length; i++) {
      const [type, shipFrame, radius] = K[comp[i]];
      L.push(frigate(-6000 - (i % 4) * 1100, (Math.floor(i / 4) - 1) * 1300, { id: 'u' + i, cat: comp[i], type, shipFrame, radius }));
    }
    // formationTargets z index.html (PPM bez przeciągania): rzędy co 150 / 200 / 230 j. — punkty leżą
    // w strefach bezpieczeństwa sąsiadów, więc część okrętów kończy rozkaz przed swoim punktem.
    let depth = 0;
    for (const [k, sp] of [['f', 150], ['d', 200], ['b', 230]]) {
      const R = L.filter((u) => u.cat === k);
      const w = (R.length - 1) * sp;
      R.forEach((u, i) => { u.command = { type: 'move', target: { x: depth, y: -w / 2 + i * sp }, arrival: u.radius + 25 }; });
      depth += sp * 0.9;
    }
    let minK = Infinity;
    run(L, 30, d, (t) => {
      if (t < 1) return;
      for (let a = 0; a < L.length; a++) {
        for (let b = a + 1; b < L.length; b++) {
          minK = Math.min(minK, Math.hypot(L[a].x - L[b].x, L[a].y - L[b].y) / (L[a].radius + L[b].radius));
        }
      }
    });
    return { L, minK };
  };
  const on = fly(deps());
  assert.equal(on.L.filter((s) => s.command?.type === 'hold').length, on.L.length, 'część rozkazów nie skończyła się');
  assert.ok(on.minK > 0.8, `okręty wjechały w siebie: odległość / suma promieni ${on.minK.toFixed(2)}`);
  assert.ok(Math.max(...on.L.map((s) => Math.hypot(s.x, s.y))) < 2500, 'grupa rozjechała się daleko od punktu');
  const off = fly(plainDeps());
  assert.ok(off.minK < 0.3, `bez omijania test nic nie sprawdza: ${off.minK.toFixed(2)}`);
}));

test('a ship that cannot get through a block of holding ships ends the order instead of hanging (real AI grid)', () => withGrid(() => {
  // Krata stojących pancerników co 1200 j. (szyk RTS z przeciągnięciem: 3 × największy promień): strefy
  // bezpieczeństwa (suma promieni + 150 j.) nie zostawiają przejścia — niszczyciel staje przed kratą.
  const keepers = [];
  for (let i = 0; i < 9; i++) {
    const b = frigate(1200 * (i % 3), 1200 * (Math.floor(i / 3) - 1), { id: 'b' + i, type: 'battleship', shipFrame: 'terran_battleship', radius: 400 });
    b.command = { type: 'hold' };
    keepers.push(b);
  }
  const d0 = frigate(-5000, 150, { id: 'd', type: 'destroyer', shipFrame: 'terran_destroyer', radius: 180 });
  d0.command = { type: 'move', target: { x: 1800, y: 600 }, arrival: 205 };
  const L = keepers.concat([d0]);
  let minK = Infinity;
  run(L, 30, deps(), () => {
    for (const k of keepers) minK = Math.min(minK, Math.hypot(k.x - d0.x, k.y - d0.y) / (k.radius + d0.radius));
  });
  assert.equal(d0.command?.type, 'hold', `rozkaz wisi: ${d0.x.toFixed(0)},${d0.y.toFixed(0)} v ${Math.hypot(d0.vx, d0.vy).toFixed(0)}`);
  assert.ok(minK > 0.8, `wjechał w pancernik: ${minK.toFixed(2)}`);
}));

test('a group starting from a tight parked block flies off and arrives (nobody gives up at the start)', () => withGrid(() => {
  const L = [];
  for (let i = 0; i < 8; i++) {
    const big = i >= 6;
    L.push(frigate(-(i % 4) * 330, (Math.floor(i / 4) - 0.5) * (big ? 900 : 330), big
      ? { id: 'p' + i, type: 'battleship', shipFrame: 'terran_battleship', radius: 400, angle: Math.PI }
      : { id: 'p' + i, angle: Math.PI }));
  }
  L.forEach((s, i) => { s.command = { type: 'move', target: { x: 8000, y: (i - 3.5) * 1300 }, arrival: s.radius + 25 }; });
  run(L, 35, deps());
  for (const s of L) {
    assert.equal(s.command?.type, 'hold', `${s.id}: rozkaz nie skończył się`);
    assert.ok(s.x > 6000, `${s.id}: stanął w ${s.x.toFixed(0)},${s.y.toFixed(0)} zamiast dolecieć`);
  }
}));
