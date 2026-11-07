// Benchmark silnika belek (tryb płaski) na flocie ze sprite'ów gry.
//
//   node scripts/bench-belki-flota.mjs                pełny i lokalny solver, siatka 15 j.
//   node scripts/bench-belki-flota.mjs --cs=7.5       siatka jak heksy gry
//   node scripts/bench-belki-flota.mjs --tylko=lokalny
//
// Skład jak duża bitwa z audytu (bez myśliwców, które nie mają kadłubów heksowych):
// 2 Atlasy, 4 lotniskowce, 10 pancerników, 20 niszczycieli, 30 fregat, 6 frachtowców.
// Scenariusze: lot bez styku, ostrzał (300 trafień laserem/s + 20 rakiet/s w losowe
// kadłuby), 3 tarany pancerników przy reszcie floty. Mierzy fizykę na krok 120 Hz
// i przepisanie skóry sprite'ów na klatkę (klatka co 2 kroki).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSpriteBeamStructure } from '../src/game/beamSprite2D.js';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { cloneBeamStructure } from '../src/game/beamStructureClone.js';
import { setPlanarHeading } from '../src/game/beamFlightControls2D.js';
import { buildSpriteSkinTopology, writeSpriteSkinGeometry, writeSpriteSkinQuads } from '../src/3d/beamSpriteSkin2D.js';
import { getHullRenderSize } from '../src/data/ships.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const CS = Number(arg('cs', 15));
const ONLY = arg('tylko', '');

// PNG 8-bit RGB/RGBA bez przeplotu — tyle mają sprite'y kadłubów.
function decodePng(path) {
  const buf = readFileSync(path);
  let pos = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), tag = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (tag === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9];
      if (body[8] !== 8 || (type !== 2 && type !== 6) || body[12] !== 0) throw new Error(`${path}: nieobsługiwany PNG`);
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    pos += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y > 0 ? px[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[row - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = px[i * bpp]; data[i * 4 + 1] = px[i * bpp + 1]; data[i * 4 + 2] = px[i * bpp + 2];
    data[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return { width, height, data };
}

const FLEET = [
  ['atlas', 'assets/capital_ship_rect_v1.png', 2],
  ['terran_carrier', 'src/assets/ships/terrancarrier.png', 4],
  ['terran_battleship', 'src/assets/ships/terranbattleship.png', 5],
  ['pirate_battleship', 'src/assets/ships/piratebattleship.png', 5],
  ['terran_destroyer', 'src/assets/ships/terrandestroyer.png', 10],
  ['pirate_destroyer', 'src/assets/ships/piratedestroyer.png', 10],
  ['terran_frigate', 'src/assets/ships/terranfrigate.png', 15],
  ['pirate_frigate', 'src/assets/ships/piratefrigate.png', 15],
  ['long_haul_freighter', 'assets/long_haul_freighter.png', 6]
];
const SHIPS = FLEET.reduce((sum, [, , count]) => sum + count, 0);

const structures = new Map();
for (const [id, file] of FLEET) {
  const img = decodePng(join(repo, file));
  const size = getHullRenderSize(id, img.width, img.height);
  // Siatka w skali gry (size.w j.); próbkujemy pełny obraz — UV są znormalizowane.
  structures.set(id, buildSpriteBeamStructure(img, { worldLength: size.w, cellsAlong: Math.max(4, Math.round(size.w / CS)) }));
}
const density = 800000 / structures.get('atlas').mass;

function makeFleet(local, ramPairs = 0) {
  const cfg = createBeamConfig(CS);
  Object.assign(cfg, { planar: true, maxContacts: 384, crushStrength: 300000, globalBreakMul: 0.6, localSolver: local });
  D.init(cfg);
  D.onDebris = null;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bodies = [];
  let slot = 0;
  for (const [id, , count] of FLEET) {
    for (let i = 0; i < count; i++, slot++) {
      const b = D.createBody(cloneBeamStructure(structures.get(id)), { name: id, massMultiplier: density });
      b.pos.x = (slot % 9) * 4200; b.pos.y = Math.floor(slot / 9) * 4200;
      const heading = rnd() * Math.PI * 2, speed = 150 + rnd() * 250;
      setPlanarHeading(b, heading);
      b.vel.x = Math.cos(heading) * speed; b.vel.y = Math.sin(heading) * speed;
      bodies.push(b);
    }
  }
  for (let p = 0; p < ramPairs; p++) {
    const s = structures.get(p % 2 ? 'pirate_battleship' : 'terran_battleship');
    const a = D.createBody(cloneBeamStructure(s), { massMultiplier: density });
    const b = D.createBody(cloneBeamStructure(s), { massMultiplier: density });
    a.pos.x = -20000; a.pos.y = p * 3000;
    b.pos.x = -19100; b.pos.y = p * 3000;
    setPlanarHeading(b, Math.PI / 2);
    a.vel.x = 900;
    bodies.push(a, b);
  }
  return { bodies, rnd };
}

// Przepisanie skóry (bez three): przyrostowo z listy regionu albo całość.
function skinFrame(bodies, state, range) {
  for (const body of bodies) {
    if (body.dead || !body.meshDirty) continue;
    body.meshDirty = false;
    let st = state.get(body);
    const region = body._region;
    if (!st || st.topo.store !== body.nodeStore || st.topo.beamStore !== body.beamStore) {
      const topo = buildSpriteSkinTopology(body);
      st = { topo, pos: new Float32Array(topo.count * 12), col: new Float32Array(topo.count * 12) };
      state.set(body, st);
      writeSpriteSkinGeometry(body, topo, st.pos, st.col);
    } else if (region && region.store === body.nodeStore && !region.dirtyAll) {
      if (region.dirtyCount) writeSpriteSkinQuads(body, st.topo, st.pos, st.col, region.dirty, region.dirtyCount, range);
    } else writeSpriteSkinGeometry(body, st.topo, st.pos, st.col);
    if (region && region.store === body.nodeStore) {
      const skinDirty = body.nodeStore.skinDirty;
      if (region.dirtyAll) { skinDirty.fill(0); region.dirtyAll = false; }
      else for (let k = 0; k < region.dirtyCount; k++) skinDirty[region.dirty[k]] = 0;
      region.dirtyCount = 0;
    }
  }
}

// Fala ciśnienia rakiety: dawka rozłożona na BLAST_S (krzywa smoothstep), obecna lista ciał — także odłamy.
const BLAST_S = 0.22;
const blastProgress = (age) => { const t = Math.min(1, Math.max(0, age / BLAST_S)); return t * t * (3 - 2 * t); };
const blastImpact = { radius: 0, breakRadius: 0, damageFraction: 1, breakProgress: 1, impulseTime: 0.12 };
const blastImpulse = { x: 0, y: 0, z: 0 };
function updateBlasts(blasts, dt, bodies) {
  for (const blast of blasts) {
    if (!blast.active) continue;
    const before = blastProgress(blast.age);
    blast.age = Math.min(BLAST_S, blast.age + dt);
    const after = blastProgress(blast.age);
    blastImpact.damageFraction = after - before;
    blastImpact.breakProgress = after;
    blastImpact.radius = blast.radius; blastImpact.breakRadius = blast.radius * 0.7;
    blastImpulse.x = blast.vx; blastImpulse.y = blast.vy; blastImpulse.z = 0;
    for (const body of bodies) {
      if (body.dead || body.static) continue;
      if (Math.hypot(body.pos.x - blast.x, body.pos.y - blast.y, body.pos.z) > body.radius + blast.radius) continue;
      D.applyImpact(body, blast.x, blast.y, 0, blast.damage, blastImpulse, blastImpact);
    }
    if (blast.age >= BLAST_S) blast.active = false;
  }
}

function run(local, scenario) {
  const { bodies, rnd } = makeFleet(local, scenario === 'ram' ? 3 : 0);
  const steps = scenario === 'ram' ? 360 : 600, warm = 60;
  const hits = scenario === 'fire' ? 300 : 0, missiles = scenario === 'fire' ? 20 : 0;
  const blasts = Array.from({ length: 32 }, () => ({ active: false, age: 0, x: 0, y: 0, vx: 0, vy: 0, damage: 0, radius: 0 }));
  const opts = { radius: CS * 1.15, breakRadius: CS * 1.15 * 0.45, damageFraction: 1, breakProgress: 1, impulseTime: 0 };
  const vel = { x: 0, y: 0, z: 0 };
  const skin = new Map(), range = { min: 0, max: -1 };
  let physics = 0, solver = 0, collisions = 0, skinMs = 0, frames = 0, worst = 0, hitAcc = 0, missileAcc = 0;
  // Cel = k-ty żywy węzeł poszycia, prosto z magazynu: losowanie nie zależy od dziur
  // w tablicach po rozpadzie w miejscu i nie buduje widoków węzłów.
  const target = () => {
    const b = bodies[(rnd() * SHIPS) | 0];
    if (!b || b.dead) return null;
    const st = b.nodeStore;
    let alive = 0;
    for (let i = 0; i < st.count; i++) if (st.active[i] && st.surface[i]) alive++;
    if (!alive) return null;
    let pick = (rnd() * alive) | 0, k = -1;
    for (let i = 0; i < st.count; i++) if (st.active[i] && st.surface[i] && pick-- === 0) { k = i; break; }
    const m = D._refreshRot(b);
    return { b, x: b.pos.x + m[0] * st.x[k] + m[1] * st.y[k], y: b.pos.y + m[3] * st.x[k] + m[4] * st.y[k] };
  };
  for (let i = 0; i < steps + warm; i++) {
    const t0 = performance.now();
    D.integrate(1 / 120, bodies);
    hitAcc += hits / 120; missileAcc += missiles / 120;
    for (; hitAcc >= 1; hitAcc--) {
      const t = target(); if (!t) continue;
      vel.x = t.b.pos.x - t.x; vel.y = t.b.pos.y - t.y;
      D.applyImpact(t.b, t.x, t.y, 0, 135, vel, opts);
    }
    for (; missileAcc >= 1; missileAcc--) {
      const t = target(), blast = blasts.find((x) => !x.active);
      if (!t || !blast) continue;
      Object.assign(blast, { active: true, age: 0, x: t.x, y: t.y,
        vx: t.b.pos.x - t.x, vy: t.b.pos.y - t.y, damage: 900, radius: CS * 3 });
    }
    updateBlasts(blasts, 1 / 120, bodies);
    D.update(1 / 120, bodies);
    const ms = performance.now() - t0;
    for (let j = bodies.length - 1; j >= 0; j--) if (bodies[j].dead || bodies[j].activeNodes <= 0) bodies.splice(j, 1);
    let skinFrameMs = 0;
    if (i % 2 === 1) { const s0 = performance.now(); skinFrame(bodies, skin, range); skinFrameMs = performance.now() - s0; }
    if (i < warm) continue;
    physics += ms; worst = Math.max(worst, ms);
    solver += D.perf.lastSolverMs; collisions += D.perf.lastCollisionMs;
    if (i % 2 === 1) { skinMs += skinFrameMs; frames++; }
  }
  return { physics: physics / steps, solver: solver / steps, collisions: collisions / steps, worst, skin: skinMs / frames };
}

let nodes = 0, beams = 0;
for (const [id, , count] of FLEET) { nodes += structures.get(id).stats.nodes * count; beams += structures.get(id).stats.beams * count; }
console.log(`Siatka ${CS} j.: ${SHIPS} kadłubów, ${nodes} węzłów, ${beams} belek\n`);
const modes = ONLY === 'pelny' ? [false] : ONLY === 'lokalny' ? [true] : [false, true];
for (const [scenario, label] of [['cruise', 'lot bez styku'], ['fire', 'ostrzał 300/s + 20 rakiet/s'], ['ram', '3 tarany + flota']]) {
  for (const local of modes) {
    const r = run(local, scenario);
    console.log(`${label.padEnd(30)} ${(local ? 'lokalny' : 'pełny').padEnd(8)} fizyka ${r.physics.toFixed(2).padStart(6)} ms/krok (max ${r.worst.toFixed(1).padStart(5)})  solver ${r.solver.toFixed(2)}  kolizje ${r.collisions.toFixed(2)}  skóra ${r.skin.toFixed(2)} ms/klatkę`);
  }
}
