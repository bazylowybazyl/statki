// Miejsce na planecie → ustawienia mapy terenu (src/3d/planetGen/planetGenPlace.js): odczyt danych planety
// (drzewo rzek, morze, klimat), wybór stylu rzeki i roślinności, kierunek spływu, powtarzalność.
// node --test tests/planetGenPlace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDrainage, drainReceiver, drainFlowDecode } from '../src/3d/planetGen/planetGenDrainage.js';
import { describePlace, dirToUv, uvToDir, encodeClimate, decodeClimate, PLACE_T, PLACE_M } from '../src/3d/planetGen/planetGenPlace.js';
import { generateTerrainMap, TERRAIN_RIVERS, TERRAIN_VEGETATION } from '../src/3d/planetGen/planetGenTerrainMap.js';

// planeta próbna: teren z sumy sinusów, spływ policzony naprawdę, klimat stały (ustawiany w testach)
const W = 256;
const H = 128;
function fakeBaked({ temp = 0.4, moist = 0.7, vegetation = 'zielona', rKm = 200, seed = 5 } = {}) {
  const h = new Float32Array(W * H);
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const waves = [];
  for (let k = 0; k < 24; k++) waves.push([1 + Math.floor(rnd() * (2 + k)), 1 + Math.floor(rnd() * (1 + k)), rnd() * 6.283, rnd() * 6.283, 1 / (1 + k * 0.6)]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = -0.15;
      for (const [fx, fy, p1, p2, amp] of waves) v += Math.sin(x / W * 2 * Math.PI * fx + p1) * Math.sin(y / H * Math.PI * fy + p2) * amp;
      h[y * W + x] = v * 0.8;
    }
  }
  const d = computeDrainage(h, null, W, H);
  const n = W * H;
  const heightM = new Int16Array(n);
  for (let i = 0; i < n; i++) heightM[i] = Math.round(h[i] * 1000);
  return {
    spec: { rKm, seedInt: 12345, look: { vegetation, palette: { taiga: [0.012, 0.028, 0.01], forest: [0.024, 0.068, 0.012], rain: [0.012, 0.042, 0.006] } } },
    drainage: { ...d, heightM, temp: new Uint8Array(n).fill(encodeClimate(temp, PLACE_T)), moist: new Uint8Array(n).fill(encodeClimate(moist, PLACE_M)) },
    h
  };
}
const cellDir = (x, y) => uvToDir((x + 0.5) / W, (y + 0.5) / H);
// komórka o największym przepływie spełniająca warunek
function bestCell(b, pred) {
  let best = -1;
  let bg = -1;
  for (let y = 12; y < H - 12; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const g = b.drainage.data[i * 4 + 1];
      if (g > bg && b.h[i] > 0 && pred(x, y, i)) { bg = g; best = i; }
    }
  }
  return { x: best % W, y: Math.floor(best / W), flow: drainFlowDecode(bg) };
}

test('kierunek ↔ (u, v): zgodne z układem wypieku, klimat koduje się odwracalnie', () => {
  for (const [u, v] of [[0.1, 0.3], [0.5, 0.5], [0.93, 0.8], [0.25, 0.12]]) {
    const dir = uvToDir(u, v);
    assert.ok(Math.abs(Math.hypot(...dir) - 1) < 1e-9);
    const r = dirToUv(dir);
    assert.ok(Math.abs(r.u - u) < 1e-9 && Math.abs(r.v - v) < 1e-9, `${u}, ${v} → ${r.u}, ${r.v}`);
  }
  // biegun N = +Y (v = 1), u = 0 → kierunek −X
  assert.ok(uvToDir(0.3, 1)[1] > 0.999);
  assert.ok(uvToDir(0, 0.5)[0] < -0.999);
  for (const t of [-0.6, 0, 0.33, 0.9, 1.5]) assert.ok(Math.abs(decodeClimate(encodeClimate(t, PLACE_T), PLACE_T) - t) < 0.007);
  for (const m of [-0.2, 0.2, 0.75, 1.4]) assert.ok(Math.abs(decodeClimate(encodeClimate(m, PLACE_M), PLACE_M) - m) < 0.006);
});

test('miejsce: morze odrzucone, ląd opisany; to samo miejsce = to samo ziarno mapy', () => {
  const b = fakeBaked();
  assert.equal(describePlace({ spec: b.spec, drainage: null }, [1, 0, 0]).ok, false);
  // punkt w morzu daleko od lądu
  let sea = null;
  for (let y = 20; y < H - 20 && !sea; y++) {
    for (let x = 0; x < W && !sea; x++) {
      let land = false;
      for (let dy = -8; dy <= 8 && !land; dy++) for (let dx = -8; dx <= 8; dx++) if (b.h[(y + dy) * W + ((x + dx + W) % W)] > 0) { land = true; break; }
      if (!land) sea = [x, y];
    }
  }
  assert.ok(sea, 'teren próbny ma otwarte morze');
  const ps = describePlace(b, cellDir(...sea));
  assert.equal(ps.ok, false);
  assert.equal(ps.reason, 'morze');
  const c = bestCell(b, () => true);
  const p1 = describePlace(b, cellDir(c.x, c.y));
  const p2 = describePlace(b, cellDir(c.x, c.y));
  assert.equal(p1.ok, true);
  assert.deepEqual(p1.map, p2.map);
  assert.ok(TERRAIN_RIVERS.includes(p1.map.river) && TERRAIN_VEGETATION.includes(p1.map.veg));
  assert.ok(p1.map.extentKm >= 16 && p1.map.extentKm <= 40 && p1.map.riverWidthM >= 60);
  assert.ok(b.h[p1.cell.y * W + p1.cell.x] > 0, 'mapa stoi na lądzie');
  // inne miejsce → inne ziarno
  const o = bestCell(b, (x, y) => Math.abs(x - c.x) > 40 || Math.abs(y - c.y) > 25);
  assert.notEqual(describePlace(b, cellDir(o.x, o.y)).map.seed, p1.map.seed);
});

test('miejsce: mapa staje na największej rzece okolicy, kierunek spływu jak na planecie, ujście do morza → delta', () => {
  const b = fakeBaked();
  const d = b.drainage;
  // ujście: komórka o największym przepływie z odbiorcą w morzu
  const mouth = bestCell(b, (x, y) => { const r = drainReceiver(d, x, y); return r && !(b.h[r.y * W + r.x] > 0); });
  assert.ok(mouth.flow >= 14, `ujście o przepływie ${mouth.flow}`);
  const pm = describePlace(b, cellDir(mouth.x, mouth.y));
  assert.equal(pm.ok, true);
  assert.equal(pm.river, true);
  assert.equal(pm.map.river, 'delta');
  assert.ok(pm.seaKm != null && pm.seaKm < 20);
  // rzeka w głębi lądu: kierunek z pierwszych kroków w dół rzeki
  const inland = bestCell(b, (x, y, i) => d.data[i * 4 + 2] >= 6 * 32);
  assert.ok(inland.flow >= 14, `rzeka w głębi lądu o przepływie ${inland.flow}`);
  const p = describePlace(b, cellDir(inland.x, inland.y));
  assert.equal(p.ok, true);
  assert.deepEqual(p.cell, { x: inland.x, y: inland.y });
  assert.notEqual(p.map.river, 'delta');
  let east = 0;
  let north = 0;
  let cx = inland.x;
  let cy = inland.y;
  for (let s = 0; s < 5; s++) {
    const r = drainReceiver(d, cx, cy);
    let dx = r.x - cx;
    if (dx > 1) dx -= W; else if (dx < -1) dx += W;
    east += dx * Math.max(0.05, Math.cos(((cy + 0.5) / H - 0.5) * Math.PI));
    north += r.y - cy;
    cx = r.x; cy = r.y;
  }
  // układ mapy: x — wschód, y — południe
  assert.ok(Math.abs(p.map.flowAngle - Math.atan2(-north, east)) < 1e-9);
  // punkt obok rzeki (2 komórki dalej) trafia na tę samą rzekę
  const near = describePlace(b, cellDir(inland.x + 2, inland.y));
  assert.ok(near.flow >= p.flow * 0.95, 'okolica: ta sama albo większa rzeka');
});

test('miejsce: klimat i paleta planety wybierają roślinność; odcień z barwy lasu planety', () => {
  const c = (o) => { const b = fakeBaked(o); const k = bestCell(b, () => true); return describePlace(b, cellDir(k.x, k.y)); };
  const cold = c({ temp: 0.35 });
  const hot = c({ temp: 0.85 });
  assert.equal(cold.map.veg, 'tajga');
  assert.equal(hot.map.veg, 'tropik');
  assert.equal(c({ temp: 0.5, vegetation: 'rdzawa' }).map.veg, 'czerwona');
  assert.equal(cold.biome, 'las');
  assert.equal(cold.supported, true);
  assert.equal(c({ temp: 0.4, moist: 0.1 }).biome, 'pustynia');
  assert.equal(c({ temp: 0.4, moist: 0.1 }).supported, false);
  assert.equal(c({ temp: 0.0 }).biome, 'lód i śnieg');
  for (const p of [cold, hot]) {
    assert.equal(p.map.vegTint.length, 3);
    for (const t of p.map.vegTint) assert.ok(t > 0.7 && t < 1.61, `odcień ${p.map.vegTint}`);
  }
  // las planety próbnej jest żółtozielony (mało błękitu) — odcień zmniejsza błękit palety mapy
  assert.ok(cold.map.vegTint[2] < cold.map.vegTint[1]);
});

test('miejsce → mapa terenu: opcje przechodzą wprost, rzeka płynie w zadanym kierunku', () => {
  const b = fakeBaked({ temp: 0.4 });
  const d = b.drainage;
  const k = bestCell(b, (x, y, i) => d.data[i * 4 + 2] >= 6 * 32);
  const p = describePlace(b, cellDir(k.x, k.y));
  for (const ang of [p.map.flowAngle, 2.2, -1.0]) {
    const m = generateTerrainMap({ ...p.map, flowAngle: ang, river: 'meandry', riverWidthM: 120, extentKm: 5, size: 128, now: () => 0 });
    const n = m.river.xs.length;
    const a = Math.atan2(m.river.ys[n - 1] - m.river.ys[0], m.river.xs[n - 1] - m.river.xs[0]);
    let diff = Math.abs(a - ang);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    assert.ok(diff < 0.5, `kierunek rzeki ${a.toFixed(2)} wobec zadanego ${ang.toFixed(2)}`);
  }
  // odcień z planety zmienia barwy roślinności, nie zmienia układu mapy
  const base = generateTerrainMap({ seed: 9, size: 128, extentKm: 5, now: () => 0 });
  const tinted = generateTerrainMap({ seed: 9, size: 128, extentKm: 5, vegTint: [1.3, 1.0, 0.7], now: () => 0 });
  assert.deepEqual(base.cover, tinted.cover);
  let dr = 0;
  let db = 0;
  for (let i = 0; i < base.albedo.length; i += 4) { dr += tinted.albedo[i] - base.albedo[i]; db += tinted.albedo[i + 2] - base.albedo[i + 2]; }
  assert.ok(dr > 0 && db < 0, 'więcej czerwieni, mniej błękitu');
});
