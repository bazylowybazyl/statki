// Harness Z4: ShipProxyBatch3D na prawdziwym Core3D (bez gry).
// Sterowany z run.mjs przez CDP: window.__proxyHarness.
import { Core3D } from '/src/3d/core3d.js';
import { ShipProxyBatch3D } from '/src/3d/shipProxyBatch3D.js';
import { EngineVfxSystem } from '/src/3d/engineVfxSystem.js';
import { TRAFFIC_HULLS } from '/src/data/trafficHulls.js';
import { updateHexShips3D } from '/src/3d/hexShips3D.js';
import { HullBodies } from '/src/game/hullBodies.js';
import { HullLacquer } from '/src/3d/hullLacquer.js';
import { getHullRenderSize } from '/src/data/ships.js';

const canvas = document.getElementById('c');
Core3D.init(canvas);
Core3D.resize(window.innerWidth, window.innerHeight);

// Świat gry leży przy 5–10 mln j. — start gracza, jak w grze.
const cam = { x: 7_080_000, y: 6_290_000, zoom: 0.3 };
window.SUN = { x: 6_000_000, y: 6_000_000 };

// Klasy kursów ruchu v2 + kadłuby bez klasy (reda, przyszłe role) — wszystkie sprite'y.
const CLASSES = [
  'freighter-small', 'freighter-small', 'freighter-medium', 'freighter-medium', 'freighter-large',
  'freighter-capital', 'container_ship', 'long_haul_freighter', 'inter_station_shuttle',
  'raider', 'smuggler', 'hunter', 'tug', 'warfleet', 'police', 'rescue',
  'heavy_harvester', 'belter', 'surveyor', 'refinery_tender', 'tanker', 'construction_tug', 'repair_drone'
];

let rng = 1;
function rand() {
  rng = (rng * 1664525 + 1013904223) >>> 0;
  return rng / 4294967296;
}

const actors = [];
let simAcc = 0;
const SIM_DT = 1 / 30;

function makeActors(count, seed = 7, spread = 1) {
  rng = seed;
  actors.length = 0;
  const halfW = (window.innerWidth * 0.5 / cam.zoom) * spread;
  const halfH = (window.innerHeight * 0.5 / cam.zoom) * spread;
  for (let i = 0; i < count; i++) {
    const cls = i === 0 || i === 1 ? 'megafreighter' : CLASSES[i % CLASSES.length];
    const x = cam.x + (rand() * 2 - 1) * halfW;
    const y = cam.y + (rand() * 2 - 1) * halfH;
    const angle = rand() * Math.PI * 2;
    const speed = 60 + rand() * 500;
    const a = {
      courseId: `haul-${String(i).padStart(5, '0')}`,
      unitClass: TRAFFIC_HULLS[cls] ? undefined : cls,
      hullId: TRAFFIC_HULLS[cls] ? cls : undefined,
      x, y, angle, prevX: x, prevY: y, prevAngle: angle,
      speed, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      turn: (rand() * 2 - 1) * 0.25,
      throttle: rand() < 0.5 ? 0.6 : 0,
      mode: 'conventional',
      phase: 'fly'
    };
    actors.push(a);
  }
  return actors.length;
}

function stepActors(dt) {
  const halfW = window.innerWidth * 0.5 / cam.zoom * 1.1;
  const halfH = window.innerHeight * 0.5 / cam.zoom * 1.1;
  for (const a of actors) {
    a.prevX = a.x; a.prevY = a.y; a.prevAngle = a.angle;
    if (a.speed < 1) continue;
    a.angle += a.turn * dt;
    a.vx = Math.cos(a.angle) * a.speed;
    a.vy = Math.sin(a.angle) * a.speed;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    // Zawijanie w pudle widoku (skok = prev na nową pozę, bez smugi interpolacji).
    let wrapped = false;
    if (a.x < cam.x - halfW) { a.x += halfW * 2; wrapped = true; }
    if (a.x > cam.x + halfW) { a.x -= halfW * 2; wrapped = true; }
    if (a.y < cam.y - halfH) { a.y += halfH * 2; wrapped = true; }
    if (a.y > cam.y + halfH) { a.y -= halfH * 2; wrapped = true; }
    if (wrapped) { a.prevX = a.x; a.prevY = a.y; }
  }
}

function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
}
function p95(list) {
  if (!list.length) return 0;
  const s = [...list].sort((p, q) => p - q);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

// Jedna klatka gry: bańka (30 Hz) → proxy (interpolacja) → dysze → Core3D.
function frame(dt, opts) {
  simAcc += dt;
  while (simAcc >= SIM_DT) { stepActors(SIM_DT); simAcc -= SIM_DT; }
  const alpha = simAcc / SIM_DT;
  const t0 = performance.now();
  ShipProxyBatch3D.update(opts.proxies === false ? null : actors, alpha, cam, { engines: opts.engines !== false });
  const t1 = performance.now();
  if (opts.engines !== false) EngineVfxSystem.update(ShipProxyBatch3D.engineEntities);
  else EngineVfxSystem.update([]);
  const t2 = performance.now();
  Core3D.renderSingle(cam);
  const t3 = performance.now();
  const info = Core3D.lastFrameRenderInfo;
  return {
    batchMs: t1 - t0,
    engineMs: t2 - t1,
    renderMs: t3 - t2,
    ortho: info?.ortho?.calls ?? -1,
    total: info?.total?.calls ?? -1
  };
}

async function waitImages(maxFrames = 400) {
  for (let i = 0; i < maxFrames; i++) {
    frame(1 / 60, { engines: false });
    if (ShipProxyBatch3D.stats.waitingImage === 0 && ShipProxyBatch3D.stats.drawn > 0) return i;
    await new Promise((r) => setTimeout(r, 20));
  }
  return -1;
}

async function run(n, opts = {}) {
  const batch = [];
  const engine = [];
  const render = [];
  const ortho = [];
  const total = [];
  const drawn = [];
  const engines = [];
  for (let i = 0; i < n; i++) {
    const r = frame(1 / 60, opts);
    batch.push(r.batchMs);
    engine.push(r.engineMs);
    render.push(r.renderMs);
    ortho.push(r.ortho);
    total.push(r.total);
    drawn.push(ShipProxyBatch3D.stats.drawn);
    engines.push(ShipProxyBatch3D.stats.nozzles);
    // Oddaj wątek co kilka klatek, żeby GPU nie spiętrzał kolejki.
    if (i % 4 === 3) await new Promise((r2) => setTimeout(r2, 0));
  }
  const s = ShipProxyBatch3D.stats;
  return {
    frames: n,
    actors: opts.proxies === false ? 0 : actors.length,
    drawnMedian: median(drawn),
    kindsDrawCalls: s.drawCalls,
    kindsAttached: s.kinds,
    engineProxies: s.engines,
    nozzlesMedian: median(engines),
    batchMsMedian: +median(batch).toFixed(4),
    batchMsP95: +p95(batch).toFixed(4),
    engineMsMedian: +median(engine).toFixed(4),
    renderSubmitMsMedian: +median(render).toFixed(3),
    orthoCallsMedian: median(ortho),
    totalCallsMedian: median(total),
    usPerProxy: actors.length ? +(median(batch) * 1000 / actors.length).toFixed(3) : 0
  };
}

// Klatki w tempie rzeczywistym (~60 Hz) — strugi dysz liczą czas z performance.now.
async function runRealtime(ms, opts = {}) {
  const tEnd = performance.now() + ms;
  let n = 0;
  while (performance.now() < tEnd) {
    frame(1 / 60, opts);
    n++;
    await new Promise((r) => setTimeout(r, 16));
  }
  return n;
}

window.__proxyHarness = {
  ready: true,
  runRealtime,
  cam,
  setup(count, seed = 7, spread = 1) { return makeActors(count, seed, spread); },
  setCamera(x, y, zoom) { cam.x = x; cam.y = y; cam.zoom = zoom; },
  waitImages,
  run,
  frame(opts = {}) { return frame(1 / 60, opts); },
  stats() { return { ...ShipProxyBatch3D.stats }; },
  // Precyzja: jedna nieruchoma instancja przy kamerze; kamera i statek o to samo przesunięte.
  precisionPose(offset, zoom = 2) {
    cam.x = 7_080_000 + offset;
    cam.y = 6_290_000 + offset * 0.7;
    cam.zoom = zoom;
    actors.length = 0;
    actors.push({
      courseId: 'haul-99999', hullId: 'container_ship',
      x: cam.x + 40.25, y: cam.y - 12.5, angle: 0.4, prevX: cam.x + 40.25, prevY: cam.y - 12.5, prevAngle: 0.4,
      speed: 0, vx: 0, vy: 0, throttle: 0
    });
    ShipProxyBatch3D.update(actors, 1, cam, { engines: false });
    EngineVfxSystem.update([]);
    Core3D.renderSingle(cam);
    return ShipProxyBatch3D.stats.drawn;
  },
  // Galeria: każdy kadłub raz w siatce; kurs 0 (dziób w prawo) albo π/2 (w dół).
  gallery(hulls, zoom, cols, cellW, cellH, heading = 0) {
    cam.x = 7_080_000; cam.y = 6_290_000; cam.zoom = zoom;
    actors.length = 0;
    const rows = Math.ceil(hulls.length / cols);
    hulls.forEach((id, i) => {
      const cx = cam.x + ((i % cols) - (cols - 1) / 2) * cellW;
      const cy = cam.y + (Math.floor(i / cols) - (rows - 1) / 2) * cellH;
      const angle = heading;
      actors.push({
        courseId: `gal-${id}`, hullId: TRAFFIC_HULLS[id] ? id : undefined, unitClass: TRAFFIC_HULLS[id] ? undefined : id,
        x: cx, y: cy, angle, prevX: cx, prevY: cy, prevAngle: angle,
        speed: 0.01, vx: 0, vy: 0, turn: 0, throttle: 1, mode: 'conventional'
      });
    });
    return actors.length;
  },
  // Światło: kadłub belkowy pełnego NPC (hexShips3D, ten sam sprite) po lewej,
  // proxy po prawej — ten sam kąt i słońce, bez lakieru (proxy go nie ma).
  async lightingCompare(hullId = 'container_ship', angle = 0.3, zoom = 1.6, gap = 420, sun = null) {
    const def = TRAFFIC_HULLS[hullId];
    const img = new Image();
    img.src = def.sprite;
    await img.decode();
    const size = getHullRenderSize(hullId, img.naturalWidth, img.naturalHeight);
    const hexCanvas = document.createElement('canvas');
    hexCanvas.width = size.w;
    hexCanvas.height = size.h;
    hexCanvas.getContext('2d').drawImage(img, 0, 0, size.w, size.h);
    cam.x = 7_080_000; cam.y = 6_290_000; cam.zoom = zoom;
    if (sun) window.SUN = sun;
    const npc = { type: 'freighter-medium', x: cam.x - gap / 2, y: cam.y, angle, vx: 0, vy: 0, visual: {}, radius: 120, mass: 1000 };
    const hull = HullBodies.createHull(npc, hexCanvas, { visualImage: img });
    ShipProxyBatch3D.setImageResolver((id, url) => (id === hullId ? img : null));
    HullLacquer.setEnabled(false);
    actors.length = 0;
    actors.push({ courseId: 'cmp', hullId, x: cam.x + gap / 2, y: cam.y, angle, prevX: cam.x + gap / 2, prevY: cam.y, prevAngle: angle, speed: 0, vx: 0, vy: 0, throttle: 0 });
    for (let i = 0; i < 6; i++) {
      ShipProxyBatch3D.update(actors, 1, cam, { engines: false });
      updateHexShips3D(cam, [npc], null);
      Core3D.renderSingle(cam);
      await new Promise((r) => setTimeout(r, 30));
    }
    // Środki obu kadłubów na ekranie (px CSS) — do wycinków w run.
    const toScreen = (x, y) => ({ x: (x - cam.x) * zoom + window.innerWidth / 2, y: (y - cam.y) * zoom + window.innerHeight / 2 });
    return { built: !!hull, nodes: hull?.body?.activeNodes ?? 0, npc: toScreen(npc.x, npc.y), proxy: toScreen(cam.x + gap / 2, cam.y), size, zoom };
  },
  pickTest() {
    const a = actors[5];
    const hit = ShipProxyBatch3D.pickAt(a.x, a.y, 2);
    const miss = ShipProxyBatch3D.pickAt(cam.x + 1e6, cam.y, 2);
    return { hit: hit === a, miss: miss === null };
  }
};
