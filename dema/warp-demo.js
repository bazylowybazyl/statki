// Demo WARPU — M1: wyjście z warpa (docs/BRIEF-warp.md §4.2, §6).
// Serwowanie: `npm run dev`, potem /dema/warp-demo.html
//   ?scene=arrival|fleet|ambush  ?hull=terran_battleship  ?shot=1 (bez paneli)
//
// Stos renderu jak w grze: tło z planet3d.assets.js (gwiazdy, mgławica) →
// WarpFx3D.update (zgłasza zgięcie tła i fale do Core3D) → updateHexShips3D →
// drawHexShips3D (Core3D: bloom, ACES) → nakładka 2D (znaczniki zwiastunów).
// Okręt jest w świecie dopiero od wyrzutu (onBurst) — wcześniej nie ma go
// w liście renderu, tak jak NPC w grze.
import { Core3D } from '../src/3d/core3d.js';
import { initHexShips3D, updateHexShips3D, drawHexShips3D, prewarmHexShipVisual, invalidateHexShipEntity3D } from '../src/3d/hexShips3D.js';
import { initHexBody, setHexShips3DActive, disposeHexBody } from '../src/game/destructor.js';
import { getHullRenderSize } from '../src/data/ships.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { WarpFx3D, WARP_FX_LAYERS, WARP_FX_PALETTES } from '../src/3d/warpFx3D.js';
import { planWarpFleetArrival } from '../src/game/warpDrive.js';
import { WarpWorldLens } from '../src/3d/warpWorldLens.js';
import { buildSystemMap } from '../src/data/systemMap.js';
import '../src/3d/planet3d.assets.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';
import terranFrigateUrl from '../src/assets/ships/terranfrigate.png';
import terranDestroyerUrl from '../src/assets/ships/terrandestroyer.png';
import terranBattleshipUrl from '../src/assets/ships/terranbattleship.png';
import terranCarrierUrl from '../src/assets/ships/terrancarrier.png';
import terranSupercapitalUrl from '../src/assets/ships/terransupercapital.png';
import pirateFrigateUrl from '../src/assets/ships/piratefrigate.png';
import pirateDestroyerUrl from '../src/assets/ships/piratedestroyer.png';
import pirateBattleshipUrl from '../src/assets/ships/piratebattleship.png';

const params = new URLSearchParams(location.search);
if (params.get('shot') === '1') document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const errorsEl = $('errors');
function reportError(text) {
  errorsEl.style.display = 'block';
  errorsEl.textContent += `${text}\n`;
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// ---------------------------------------------------------------------------
// Kadłuby (sprite'y i profile renderu jak w grze)
const HULLS = {
  atlas: { label: 'Atlas', url: atlasUrl, profile: 'atlas', palette: 'atlas', type: 'atlas', player: true },
  terran_supercapital: { label: 'Colossus (superkapitał)', url: terranSupercapitalUrl, profile: 'terran_supercapital', palette: 'terran', type: 'supercapital' },
  terran_carrier: { label: 'Citadella (lotniskowiec)', url: terranCarrierUrl, profile: 'terran_carrier', palette: 'terran', type: 'carrier' },
  terran_battleship: { label: 'Bellator (pancernik)', url: terranBattleshipUrl, profile: 'terran_battleship', palette: 'terran', type: 'battleship' },
  terran_destroyer: { label: 'Hasta (niszczyciel)', url: terranDestroyerUrl, profile: 'terran_destroyer', palette: 'terran', type: 'destroyer' },
  terran_frigate: { label: 'Custos (fregata)', url: terranFrigateUrl, profile: 'terran_frigate', palette: 'terran', type: 'frigate' },
  pirate_battleship: { label: 'Iron Skull (piraci)', url: pirateBattleshipUrl, profile: 'pirate_battleship', palette: 'pirate', type: 'battleship', pirate: true },
  pirate_destroyer: { label: 'Reaver (piraci)', url: pirateDestroyerUrl, profile: 'pirate_destroyer', palette: 'pirate', type: 'destroyer', pirate: true },
  pirate_frigate: { label: 'Marauder (piraci)', url: pirateFrigateUrl, profile: 'pirate_frigate', palette: 'pirate', type: 'frigate', pirate: true }
};
const assets = new Map();

async function loadHullAssets() {
  await Promise.all(Object.entries(HULLS).map(async ([id, def]) => {
    const img = new Image();
    img.src = def.url;
    await img.decode();
    const size = getHullRenderSize(def.profile, img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const cx = canvas.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    cx.drawImage(img, 0, 0, canvas.width, canvas.height);
    assets.set(id, { img, canvas, size });
  }));
}

// Encja kadłuba jak w grze (ścieżka NPC: sprite → kanwa renderu → initHexBody).
function createShip(hullId, x, y, angle) {
  const def = HULLS[hullId];
  const a = assets.get(hullId);
  const e = def.player
    ? { isPlayer: true, pos: { x, y }, vel: { x: 0, y: 0 }, x, y, vx: 0, vy: 0, angle, angVel: 0,
        hull: { val: 12000, max: 12000 }, shield: { val: 0, max: 1 }, mass: 800000, visual: { spriteScale: 1 },
        w: a.size.w, h: a.size.h }
    : { x, y, vx: 0, vy: 0, angle, angVel: 0, hp: 10000, maxHp: 10000, radius: a.size.w * 0.3,
        shield: { val: 0, max: 1 }, mass: 50000, type: def.type, isPirate: def.pirate === true,
        shipFrame: def.profile };
  initHexBody(e, a.canvas);
  if (!e.hexGrid) throw new Error(`initHexBody bez siatki: ${hullId}`);
  e.hexGrid.visualImage = a.img;
  if (e.isPlayer) {
    e.hexGrid.meshDirty = true;
    e.hexGrid.meshDirtyAll = true;
    e.hexGrid.textureDirty = true;
    e.hexGrid.cacheDirty = true;
    e.hexGrid.gpuTextureNeedsUpdate = true;
  }
  prewarmHexShipVisual(a.img);
  e.__hullId = hullId;
  e.__len = a.size.w;
  e.__wid = a.size.h;
  e.__visible = true;
  return e;
}

function setShipPose(e, x, y, angle) {
  e.x = x; e.y = y; e.angle = angle;
  if (e.pos) { e.pos.x = x; e.pos.y = y; }
}

// ---------------------------------------------------------------------------
// Stan
const S = {
  scene: ['arrival', 'fleet', 'ambush', 'travel'].includes(params.get('scene')) ? params.get('scene') : 'arrival',
  hullId: HULLS[params.get('hull')] && !HULLS[params.get('hull')].player ? params.get('hull') : 'terran_battleship',
  palette: 'auto',
  cam: { x: 0, y: 0, zoom: 0.15 },
  sceneCam: { x: 0, y: 0, zoom: 0.15 },
  paused: false,
  slow: false,
  loop: true,
  ships: [],          // statki sceny (bez Atlasa)
  player: null,
  sceneT0: 0,         // czas WarpFx3D na starcie sceny
  sceneLen: 8,
  loopAt: Infinity,
  shake: 0,
  frame: 0,
  fps: 60,
  dragging: null,
  travel: null,       // scena 4: przelot warpem (soczewka świata)
  lens: { beta: 0, bodyBeta: 0, bodyZoom: 1, velAngle: 0, speedFrac: 0, front: 1000 },
  ready: false
};

const glCanvas = $('webgl-layer');
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
let W = innerWidth;
let H = innerHeight;
function resize() {
  W = innerWidth; H = innerHeight;
  canvas2d.width = W; canvas2d.height = H;
  glCanvas.width = W; glCanvas.height = H;
  Core3D.resize(W, H);
}
canvas2d.width = W; canvas2d.height = H;
glCanvas.width = W; glCanvas.height = H;

initHexShips3D({ canvas: glCanvas });
setHexShips3DActive(true);
window.Core3D = Core3D;
window.WarpFx3D = WarpFx3D;
window.WarpWorldLens = WarpWorldLens;
// Układ słoneczny z mapy gry (src/data/systemMap.js), słońce w środku świata
// jak w grze (6 mln j.) — sceny 1–3 dzieją się przy (0, 0), 5+ mln j. od planet.
// Gwiazdy czytają window.warp: nikt nie leci starym warpem, więc tło się nie
// rozciąga (widok skoku robi WarpWorldLens).
window.SUN = { x: 6000000, y: 6000000, r: 823, r3D: 399 };
window.warp = { state: 'idle', charge: 0, chargeTime: 1, dir: { x: 1, y: 0 } };
const SYSTEM = buildDemoSystem();
window.initPlanets3D(SYSTEM.planets, window.SUN);
WarpFx3D.ensure();
Fx3D.ensure();
WarpFx3D.onShake = (scale) => { S.shake = Math.max(S.shake, 6 + 20 * scale); };
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Układ do sceny przelotu: Ziemia → Jowisz, Mars ~70 tys. j. od kursu.
const PLANET_LABELS = { mercury: 'Merkury', venus: 'Wenus', earth: 'Ziemia', mars: 'Mars', jupiter: 'Jowisz', saturn: 'Saturn', 'słońce': 'Słońce' };
function buildDemoSystem() {
  const ANG = { mercury: 40, venus: 125, earth: 200, mars: 0, jupiter: 250, saturn: 310 };
  const { planets: all } = buildSystemMap(0, { planetScale: 1, sunRadius: 823, angleFor: (def) => (ANG[def.id] ?? 0) * Math.PI / 180 });
  const planets = all.filter((p) => ANG[p.id] !== undefined);
  const S0 = window.SUN;
  for (const p of planets) {
    p.x = S0.x + Math.cos(p.angle) * p.orbitRadius;
    p.y = S0.y + Math.sin(p.angle) * p.orbitRadius;
  }
  const byId = Object.fromEntries(planets.map((p) => [p.id, p]));
  const E = byId.earth;
  const J = byId.jupiter;
  const dx = J.x - E.x;
  const dy = J.y - E.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // Start tuż nad Ziemią, koniec tuż przed Jowiszem — oba widać w zwykłym kadrze.
  const P0 = { x: E.x + ux * 40000, y: E.y + uy * 40000 };
  const P1 = { x: J.x - ux * 16000, y: J.y - uy * 16000 };
  // Mars: punkt kursu na orbicie Marsa (bisekcja), przesunięty 70 tys. j. w bok.
  const M = byId.mars;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) * 0.5;
    const r = Math.hypot(P0.x + (P1.x - P0.x) * mid - S0.x, P0.y + (P1.y - P0.y) * mid - S0.y);
    if (r < M.orbitRadius) lo = mid; else hi = mid;
  }
  const cx = P0.x + (P1.x - P0.x) * lo;
  const cy = P0.y + (P1.y - P0.y) * lo;
  M.x = cx - uy * 70000;
  M.y = cy + ux * 70000;
  M.angle = Math.atan2(M.y - S0.y, M.x - S0.x);
  const dist = Math.hypot(P1.x - P0.x, P1.y - P0.y);
  // sPass — punkt kursu najbliżej Marsa (tam „grawitacja” zwalnia statek).
  return { planets, P0, P1, heading: Math.atan2(uy, ux), dist, sPass: lo * dist };
}

// Oś czasu przelotu (user: Ziemia ogromna maleje powoli, „aż kopniesz”; cel
// trzymany z daleka, na końcu „wjeżdża”; przy mijanej planecie „grawitacja”):
//   postój → ROZPĘD: hipercruise ~9 tys. j/s i ładowanie skoku, lekka soczewka
//     (Ziemię trzyma krawędź kadru, maleje powoli) →
//   KOPNIĘCIE: prędkość i soczewka w ułamku sekundy (Ziemia maleje szybko,
//     dopiero teraz widać ją całą) →
//   przelot: przy Marsie statek na chwilę zwalnia (planeta pokazana dłużej
//     i większa), potem znowu szybko →
//   hamowanie z wyhamowaniem (cel wisi przed dziobem i rośnie) → front wyjścia
//     mija statek, gdy ten staje; cel „wjeżdża” pod statek na samym końcu.
// Front mijający statek w ruchu zostawiał wyrzut za rufą, a przywrócony świat
// wokół niego uciekałby z prędkością skoku — dlatego mija go przy zatrzymaniu.
const TRAVEL = Object.freeze({
  idle: 0.8,
  depart: 2.6,         // rozpęd w hipercruise (ładowanie skoku)
  departSpeed: 4000,   // j/s na końcu rozpędu (Ziemia maleje powoli, ~3× do kopnięcia)
  departBeta: 0.32,    // soczewka na końcu rozpędu (Ziemia przy krawędzi kadru)
  kick: 1.1,           // kopnięcie: rozpęd do prędkości warpa
  lensKick: 0.7,       // … soczewka dochodzi do pełnej
  warp: 11.5,          // od kopnięcia do zatrzymania
  decel: 3.2,          // hamowanie z wyhamowaniem (v ~ (1 − u)²)
  dip: 0.62,           // „grawitacja” mijanej planety: tyle prędkości ubywa …
  dipWidth: 60000,     // … w pasie tej szerokości wokół punktu mijania [j.]
  sweep: 4.2,          // czas przejścia frontu przez kadr
  sweepLead: 2.1,      // front startuje tyle przed zatrzymaniem statku (sweep/2 = mija go przy zatrzymaniu)
  frontReach: 0.25,    // front startuje/kończy tyle promieni kuli za krawędzią kadru
  hold: 3.0
});
const TRAVEL_DT = 1 / 240;
function smooth01(x) { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); }
function travelKickAt() { return TRAVEL.idle + TRAVEL.depart; }
function travelStopAt() { return travelKickAt() + TRAVEL.warp; }

// Prędkość w chwili tau przy położeniu s (zwolnienie przy planecie zależy od
// MIEJSCA na kursie, reszta od czasu); vc — prędkość przelotu.
function travelSpeed(tau, s, vc) {
  const tKick = travelKickAt();
  const tStop = travelStopAt();
  if (tau < TRAVEL.idle || tau >= tStop) return 0;
  if (tau < tKick) return TRAVEL.departSpeed * smooth01((tau - TRAVEL.idle) / TRAVEL.depart);
  let v = TRAVEL.departSpeed + (vc - TRAVEL.departSpeed) * smooth01((tau - tKick) / TRAVEL.kick);
  const tDec = tStop - TRAVEL.decel;
  if (tau > tDec) {
    const rem = 1 - (tau - tDec) / TRAVEL.decel;
    v = Math.min(v, vc * rem * rem);
  }
  const g = (s - SYSTEM.sPass) / TRAVEL.dipWidth;
  return v * (1 - TRAVEL.dip * Math.exp(-g * g));
}

// Tablica położenia i prędkości (całkowanie punktem środkowym); prędkość
// przelotu dobrana siecznymi tak, żeby statek stanął dokładnie w P1.
function buildTravelTable(dist) {
  const n = Math.ceil(travelStopAt() / TRAVEL_DT) + 2;
  const s = new Float64Array(n);
  const v = new Float64Array(n);
  const run = (vc) => {
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const t = i * TRAVEL_DT;
      s[i] = pos;
      v[i] = travelSpeed(t, pos, vc);
      const vm = travelSpeed(t + TRAVEL_DT * 0.5, pos + v[i] * TRAVEL_DT * 0.5, vc);
      pos += vm * TRAVEL_DT;
    }
    return s[n - 1];
  };
  let a = dist / 12;
  let b = dist / 8;
  let fa = run(a) - dist;
  let fb = run(b) - dist;
  for (let k = 0; k < 12 && Math.abs(fb) > 1; k++) {
    const c = b - fb * (b - a) / (fb - fa || 1e-9);
    a = b; fa = fb;
    b = Math.max(c, TRAVEL.departSpeed * 2);
    fb = run(b) - dist;
  }
  return { s, v, vc: b, n };
}

function travelProfile(tau, table) {
  const f = Math.min(Math.max(tau / TRAVEL_DT, 0), table.n - 1);
  const i = Math.min(Math.floor(f), table.n - 2);
  const k = f - i;
  const s = table.s[i] + (table.s[i + 1] - table.s[i]) * k;
  const v = table.v[i] + (table.v[i + 1] - table.v[i]) * k;
  // Soczewka: lekka w rozpędzie, pełna po kopnięciu; trzyma się do końca
  // frontu — front prostuje ją od dziobu.
  const tKick = travelKickAt();
  const sweepStart = travelStopAt() - TRAVEL.sweepLead;
  const e = (tau - sweepStart) / TRAVEL.sweep;
  // Zasięg frontu: krawędź kadru wzdłuż osi lotu (w promieniach kuli) + pas.
  const R = WarpWorldLens.horizonFor(W, H, SYSTEM.heading);
  const extent = (Math.abs(Math.cos(SYSTEM.heading)) * W * 0.5 + Math.abs(Math.sin(SYSTEM.heading)) * H * 0.5) / R;
  const f0 = extent + WarpWorldLens.view.frontBand + TRAVEL.frontReach;
  const front = e <= 0 ? 1000 : f0 - 2 * f0 * smooth01(e);
  // Tło zaczyna się zginać już w rozpędzie; ciała wchodzą w soczewkę dopiero
  // przy kopnięciu (wcześniej planeta startu jest „oddalana”, patrz bodyZoom).
  let beta = 0;
  let bodyBeta = 0;
  if (e < 1 && tau >= TRAVEL.idle) {
    const k = smooth01((tau - tKick) / TRAVEL.lensKick);
    beta = tau < tKick
      ? TRAVEL.departBeta * smooth01((tau - TRAVEL.idle) / TRAVEL.depart)
      : TRAVEL.departBeta + (1 - TRAVEL.departBeta) * k;
    bodyBeta = tau < tKick ? 0 : k;
  }
  return { s, v, vmax: table.vc, beta, bodyBeta, front, sweepE: e };
}

// Odległość statku od powierzchni planety startu (świat) — do oddalenia widoku
// ciał w rozpędzie: Ziemia ma stać przy krawędzi kadru i maleć, a nie uciekać
// z niego (w zwykłym widoku ~9 tys. j/s to przy tym zoomie ponad 1000 px/s).
function originSurfaceDist() {
  const ent = (window._entities || []).find((en) => /earth|ziemia/i.test(en?.name || en?.data?.name || ''));
  const g = ent?.group;
  if (!g || !S.player || !(g.scale.x > 0)) return null;
  return Math.hypot(g.position.x - S.player.x, -g.position.y - S.player.y) - g.scale.x;
}

function stepTravel() {
  const tr = S.travel;
  if (!tr || !S.player) return;
  const tau = WarpFx3D.time - S.sceneT0;
  const pr = travelProfile(tau, tr.table);
  const ux = Math.cos(SYSTEM.heading);
  const uy = Math.sin(SYSTEM.heading);
  const x = SYSTEM.P0.x + ux * pr.s;
  const y = SYSTEM.P0.y + uy * pr.s;
  setShipPose(S.player, x, y, SYSTEM.heading);
  S.player.vel.x = ux * pr.v;
  S.player.vel.y = uy * pr.v;
  S.cam.x = x;
  S.cam.y = y;
  S.lens.beta = pr.beta;
  S.lens.bodyBeta = pr.bodyBeta;
  S.lens.front = pr.front;
  S.lens.velAngle = SYSTEM.heading;
  S.lens.speedFrac = pr.vmax > 0 ? pr.v / pr.vmax : 0;
  // Rozpęd i kopnięcie: widok ciał oddalany tak, że krawędź planety startu stoi
  // w miejscu (dolly zoom). Po wejściu ciał w soczewkę już zwykły.
  S.lens.bodyZoom = 1;
  if (tau < travelKickAt() + TRAVEL.lensKick && tr.ds0 > 0) {
    const ds = tr.ds0 + pr.s;
    S.lens.bodyZoom = Math.min(1, tr.ds0 / Math.max(ds, 1));
  }
  tr.speed = pr.v;
  // Gra rozciąga swoje gwiazdy w warpie (StarSystem czyta window.warp): w rozpędzie
  // ładowanie (gwiazdy przygasają, ledwie się rozciągają — hipercruise ich nie
  // rozciąga), od kopnięcia skok, aż front wyjścia minie statek — wtedy „trzask”.
  const crossed = pr.front <= 0;
  const tKick = travelKickAt();
  const charging = tau >= TRAVEL.idle && tau < tKick;
  window.warp.state = charging ? 'charging' : (tau >= tKick && !crossed && pr.beta > 0.01 ? 'active' : 'idle');
  window.warp.charge = charging ? tau - TRAVEL.idle : 0;
  window.warp.chargeTime = TRAVEL.depart;
  window.warp.dir.x = ux;
  window.warp.dir.y = uy;
  // Kopnięcie: przestrzeń „trzaska” za rufą (M2 da tu pełne ładowanie i skok).
  if (!tr.jumped && tau >= tKick) {
    tr.jumped = true;
    WarpFx3D.spawnArrival({ x, y, angle: SYSTEM.heading, hullLength: S.player.__len, hullWidth: S.player.__wid, palette: 'atlas', burstOnly: true, heatHull: false });
  }
  // Front wyjścia mija statek: wyrzut, żar kadłuba, fala zgięcia.
  if (!tr.exited && crossed) {
    tr.exited = true;
    WarpFx3D.spawnArrival({ x, y, angle: SYSTEM.heading, hullLength: S.player.__len, hullWidth: S.player.__wid, palette: 'atlas', burstOnly: true, entity: S.player });
  }
}

// ---------------------------------------------------------------------------
// Sceny
function paletteFor(hullId) {
  if (S.palette !== 'auto') return S.palette;
  return HULLS[hullId]?.palette || 'terran';
}

// Kadłuby sceny wracają do areny heksów (pętla sceny 1 tworzy nowy co kilka
// sekund — bez zwalniania arena zapchałaby się po kilku minutach).
function clearScene() {
  WarpFx3D.clear();
  for (const ship of S.ships) {
    try { invalidateHexShipEntity3D(ship); } catch { /* */ }
    try { disposeHexBody(ship); } catch { /* */ }
  }
  S.ships.length = 0;
}

// Przylot jednego okrętu; zwraca obiekt przylotu.
function arrive(hullId, x, y, angle, o = {}) {
  const ship = createShip(hullId, x, y, angle);
  ship.__visible = false;
  S.ships.push(ship);
  const a = WarpFx3D.spawnArrival({
    x, y, angle,
    hullLength: ship.__len,
    hullWidth: ship.__wid,
    palette: o.palette || paletteFor(hullId),
    entity: ship,
    sprite: assets.get(hullId).img,
    delay: o.delay || 0,
    heraldExtra: o.heraldExtra || 0,
    onBurst: () => { ship.__visible = true; }
  });
  ship.__arrival = a;
  return a;
}

function startScene(id, opts = {}) {
  S.scene = id;
  for (const b of document.querySelectorAll('.scenes button')) b.classList.toggle('on', b.dataset.scene === id);
  clearScene();
  S.sceneT0 = WarpFx3D.time;
  S.travel = null;
  S.lens.beta = 0;
  S.lens.bodyBeta = 0;
  S.lens.bodyZoom = 1;
  S.lens.speedFrac = 0;
  S.lens.front = 1000;
  window.warp.state = 'idle';
  if (S.player) {
    setShipPose(S.player, 0, 0, 0);
    S.player.vel.x = 0;
    S.player.vel.y = 0;
  }
  let last = null;
  if (id === 'travel') {
    S.travel = { jumped: false, exited: false, speed: 0, table: buildTravelTable(SYSTEM.dist), ds0: null };
    S.sceneCam = { x: SYSTEM.P0.x, y: SYSTEM.P0.y, zoom: Math.min(W, H * 1.6) / 11000 };
    if (S.player) setShipPose(S.player, SYSTEM.P0.x, SYSTEM.P0.y, SYSTEM.heading);
  } else if (id === 'arrival') {
    S.sceneCam = { x: 350, y: -760, zoom: Math.min(W / 5400, H / 3100) };
    last = arrive(S.hullId, 700, -1500, 0);
  } else if (id === 'fleet') {
    S.sceneCam = { x: 1800, y: -1900, zoom: Math.min(W, H * 1.6) / 14000 };
    last = summonFleet(opts.x ?? 2600, opts.y ?? -3000, 0);
  } else if (id === 'ambush') {
    S.sceneCam = { x: 0, y: 0, zoom: Math.min(W, H * 1.6) / 11500 };
    last = ambush();
  }
  if (!opts.keepCamera || id === 'travel') Object.assign(S.cam, S.sceneCam);
  const end = Math.max(...WarpFx3D.arrivals.map((a) => a.tSettled), S.sceneT0 + 1);
  S.sceneLen = id === 'travel' ? travelStopAt() - TRAVEL.sweepLead + TRAVEL.sweep + TRAVEL.hold : end - S.sceneT0 + 2.2;
  S.loopAt = S.loop && id !== 'fleet' ? S.sceneT0 + S.sceneLen + (id === 'travel' ? 0 : 1.2) : Infinity;
  $('scrub').max = S.sceneLen.toFixed(2);
  return last;
}

// Wezwanie jak w Empire at War: klin Terra Nova z okrętem flagowym na czele.
const FLEET_FORMATION = [
  { hull: 'terran_supercapital', ax: 0, ay: 0 },
  { hull: 'terran_battleship', ax: -900, ay: -1250 },
  { hull: 'terran_battleship', ax: -900, ay: 1250 },
  { hull: 'terran_destroyer', ax: -1500, ay: -2150 },
  { hull: 'terran_destroyer', ax: -1500, ay: 2150 },
  { hull: 'terran_frigate', ax: -2050, ay: -2900 },
  { hull: 'terran_frigate', ax: -2050, ay: 2900 },
  { hull: 'terran_frigate', ax: -2300, ay: 0 }
];

function summonFleet(cx, cy, heading) {
  const lens = FLEET_FORMATION.map((f) => ({ hullLength: assets.get(f.hull).size.w }));
  const plan = planWarpFleetArrival(lens, { gap: 0.2, flagshipPause: 0.5, jitter: 0.3 });
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  let last = null;
  plan.forEach((p) => {
    const f = FLEET_FORMATION[p.index];
    const x = cx + f.ax * c - f.ay * s;
    const y = cy + f.ax * s + f.ay * c;
    last = arrive(f.hull, x, y, heading, { palette: S.palette === 'auto' ? 'terran' : S.palette, delay: p.startTime, heraldExtra: p.heraldExtra });
  });
  return last;
}

// Zasadzka: piraci w pierścieniu wokół Atlasa, dziobami do niego.
const AMBUSH = ['pirate_frigate', 'pirate_destroyer', 'pirate_battleship', 'pirate_frigate', 'pirate_destroyer', 'pirate_battleship'];
function ambush() {
  const lens = AMBUSH.map((h) => ({ hullLength: assets.get(h).size.w }));
  const plan = planWarpFleetArrival(lens, { gap: 0.16, flagshipPause: 0.35, jitter: 0.5 });
  let last = null;
  plan.forEach((p) => {
    const hull = AMBUSH[p.index];
    const ang = (p.index / AMBUSH.length) * Math.PI * 2 + 0.35;
    const r = hull === 'pirate_battleship' ? 3300 : 2700;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    last = arrive(hull, x, y, Math.atan2(-y, -x), { palette: S.palette === 'auto' ? 'pirate' : S.palette, delay: p.startTime, heraldExtra: p.heraldExtra });
  });
  return last;
}

// ---------------------------------------------------------------------------
// Pętla
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
const _renderList = [];
let lastT = performance.now();

function simulate(dt) {
  WarpFx3D.update(dt);
  if (S.scene === 'travel') stepTravel();
  // Okręty jadą po osi przylotu (wysuwają się z szwu i hamują).
  for (const ship of S.ships) {
    const a = ship.__arrival;
    const s = a?.sample;
    if (!s || !s.phase) continue;
    // Widoczność z osi (a nie z onBurst) — przewijanie wstecz znów go chowa.
    ship.__visible = s.shipVisible === true || s.phase === 'cool' || s.phase === 'done';
    if (s.phase === 'done' || s.phase === 'cool') { setShipPose(ship, a.x, a.y, a.angle); continue; }
    const off = Number(s.shipOffset) || 0;
    setShipPose(ship, a.x + a.dirX * off, a.y + a.dirY * off, a.angle);
  }
  if (S.loopAt < Infinity && WarpFx3D.time >= S.loopAt) startScene(S.scene, { keepCamera: true });
}

function render(realDt, simDt) {
  window.updatePlanets3D?.(Math.max(simDt, 1e-4), S.cam);
  if (S.travel && S.travel.ds0 == null) S.travel.ds0 = originSurfaceDist();
  // Widok skoku: soczewka świata na planetach, tło (mgławica i gwiazdy gry)
  // zwinięte w kroplę w passie soczewki Core3D; ciała trzymają odstęp od kadłuba.
  WarpWorldLens.update({
    ship: S.player ? { x: S.player.x, y: S.player.y } : S.cam,
    hullHalfLen: S.player ? S.player.__len * S.cam.zoom * 0.5 : 0,
    hullHalfWid: S.player ? S.player.__wid * S.cam.zoom * 0.5 : 0,
    dt: simDt,
    front: S.lens.front,
    velAngle: S.lens.velAngle,
    speedFrac: S.lens.speedFrac,
    beta: S.lens.beta,
    bodyBeta: S.scene === 'travel' ? S.lens.bodyBeta : S.lens.beta,
    bodyZoom: S.scene === 'travel' ? S.lens.bodyZoom : 1,
    cam: S.cam,
    width: W,
    height: H,
    bodies: window._entities
  });
  S.shake *= Math.exp(-5 * realDt);
  const sx = (Math.random() - 0.5) * S.shake;
  const sy = (Math.random() - 0.5) * S.shake;
  const cam = { x: S.cam.x + sx / S.cam.zoom, y: S.cam.y + sy / S.cam.zoom, zoom: S.cam.zoom };
  cullInfo.x = cam.x; cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / cam.zoom + 600; cullInfo.drawHalfH = H * 0.5 / cam.zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3; cullInfo.halfH = cullInfo.drawHalfH * 3;
  _renderList.length = 0;
  if (S.player) _renderList.push(S.player);
  for (const s of S.ships) if (s.__visible) _renderList.push(s);
  Fx3D.update(simDt);
  updateHexShips3D(cam, _renderList, cullInfo);
  drawHexShips3D(ctx2d, W, H);
  drawOverlay(cam);
  updateHud();
}

function frame(nowMs) {
  const realDt = Math.min(0.1, Math.max(0, (nowMs - lastT) / 1000));
  lastT = nowMs;
  S.frame++;
  S.fps = S.fps * 0.95 + (realDt > 0 ? 1 / realDt : 60) * 0.05;
  const simDt = S.paused ? 0 : realDt * (S.slow ? 0.25 : 1);
  simulate(simDt);
  render(realDt, simDt);
  syncScrub();
}

function loop(nowMs) {
  try { frame(nowMs); } catch (err) { reportError(err.stack || String(err)); }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Nakładka 2D: znaczniki zwiastunów (w grze — radar / ostrzeżenie)
function worldToScreen(cam, x, y) {
  return { x: (x - cam.x) * cam.zoom + W * 0.5, y: (y - cam.y) * cam.zoom + H * 0.5 };
}

function formatDist(d) {
  if (d >= 1e6) return `${(d / 1e6).toFixed(2).replace('.', ',')} mln j.`;
  return `${Math.round(d / 1000)} tys. j.`;
}

function drawBodyLabels() {
  const beta = WarpWorldLens.beta;
  if (beta < 0.35) return;
  ctx2d.save();
  ctx2d.globalAlpha = Math.min(1, (beta - 0.35) / 0.4);
  ctx2d.font = '600 11px ui-monospace, Consolas, monospace';
  ctx2d.textAlign = 'center';
  // Najpierw największe ciała; etykieta nachodząca na już postawioną — pomijana.
  const list = WarpWorldLens.bodies.filter((b) => !b.isMoon && b.name).sort((a, b) => b.size - a.size);
  const placed = [];
  for (const b of list) {
    const x = W * 0.5 + b.x;
    const y = H * 0.5 + b.y + Math.max(8, b.size) + 14;
    if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
    const text = `${PLANET_LABELS[b.name] || b.name} · ${formatDist(b.d)}`;
    const w = ctx2d.measureText(text).width;
    if (placed.some((r) => Math.abs(r.x - x) < (r.w + w) * 0.5 + 6 && Math.abs(r.y - y) < 14)) continue;
    placed.push({ x, y, w });
    ctx2d.fillStyle = b.isSun ? 'rgba(255,214,150,0.85)' : 'rgba(190,225,255,0.85)';
    ctx2d.fillText(text, x, y);
  }
  ctx2d.restore();
}

function drawOverlay(cam) {
  drawBodyLabels();
  ctx2d.save();
  for (const a of WarpFx3D.arrivals) {
    const s = a.sample;
    if (!s || (s.phase !== 'herald' && s.phase !== 'tear')) continue;
    const pal = WARP_FX_PALETTES[a.palette] || WARP_FX_PALETTES.terran;
    const hostile = a.palette === 'pirate';
    const p = worldToScreen(cam, a.x, a.y);
    const len = a.hullLength * cam.zoom;
    const wid = a.hullWidth * cam.zoom;
    const k = Math.min(1, s.herald * 1.4);
    const col = hostile ? `rgba(255,90,80,${0.35 + 0.5 * k})` : `rgba(150,215,255,${0.3 + 0.45 * k})`;
    ctx2d.translate(p.x, p.y);
    ctx2d.rotate(a.angle);
    ctx2d.strokeStyle = col;
    ctx2d.lineWidth = 1.5;
    // narożniki obrysu kadłuba (gdzie stanie okręt)
    const hx = len * 0.5 + 6;
    const hy = wid * 0.5 + 6;
    const c = Math.max(6, Math.min(hx, hy) * 0.35);
    ctx2d.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx2d.moveTo(sx * hx, sy * hy + -sy * c);
      ctx2d.lineTo(sx * hx, sy * hy);
      ctx2d.lineTo(sx * hx + -sx * c, sy * hy);
    }
    // grot kursu
    ctx2d.moveTo(hx + 8, -6); ctx2d.lineTo(hx + 16, 0); ctx2d.lineTo(hx + 8, 6);
    ctx2d.stroke();
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    const eta = Math.max(0, a.tBurst - WarpFx3D.time);
    const name = HULLS[a.entity?.__hullId]?.label || '';
    ctx2d.font = '600 11px ui-monospace, Consolas, monospace';
    ctx2d.fillStyle = col;
    ctx2d.fillText(`${hostile ? 'WRÓG · ' : ''}SKOK ${eta.toFixed(1)} s`, p.x - len * 0.5, p.y - wid * 0.5 - 14);
    if (name && len > 60) {
      ctx2d.font = '10px ui-monospace, Consolas, monospace';
      ctx2d.fillText(name, p.x - len * 0.5, p.y + wid * 0.5 + 16);
    }
    void pal;
  }
  ctx2d.restore();
}

function updateHud() {
  if (S.frame % 6) return;
  const st = WarpFx3D.stats;
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  const lead = WarpFx3D.arrivals[WarpFx3D.arrivals.length - 1];
  const phase = lead?.sample?.phase || '—';
  const t = WarpFx3D.time - S.sceneT0;
  const lines = [];
  lines.push(`<b>WARP · WYJŚCIE</b>  ${S.fps.toFixed(0)} FPS · draw calle ${r.calls || 0}`);
  lines.push(`scena: ${S.scene} · t ${t.toFixed(2)} s${S.paused ? ' · PAUZA' : ''}${S.slow ? ' · ×0,25' : ''}`);
  lines.push(`przyloty ${st.arrivals} · faza ostatniego: ${phase}`);
  lines.push(`glify ${st.glyphs} · smugi ${st.smears} · zgięcia tła ${st.lens} · fale ${st.waves}`);
  if (S.travel) lines.push(`przelot: ${Math.round(S.travel.speed).toLocaleString('pl-PL')} j/s · soczewka β ${S.lens.beta.toFixed(2)}`);
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// Oś sceny (przewijanie)
let scrubbing = false;
function syncScrub() {
  if (scrubbing) return;
  const t = Math.max(0, WarpFx3D.time - S.sceneT0);
  $('scrub').value = Math.min(t, S.sceneLen).toFixed(2);
  $('scrub-out').textContent = `${t.toFixed(2).replace('.', ',')} s`;
}
function scrubTo(t) {
  setPaused(true);
  WarpFx3D.time = S.sceneT0 + t;
  simulate(0);
  $('scrub-out').textContent = `${t.toFixed(2).replace('.', ',')} s`;
}
$('scrub').addEventListener('pointerdown', () => { scrubbing = true; });
$('scrub').addEventListener('pointerup', () => { scrubbing = false; });
$('scrub').addEventListener('input', (e) => scrubTo(Number(e.target.value) || 0));

function setPaused(v) {
  S.paused = !!v;
  $('pause').classList.toggle('on', S.paused);
}
function setSlow(v) {
  S.slow = !!v;
  $('slow').classList.toggle('on', S.slow);
}

// ---------------------------------------------------------------------------
// UI
const hullSel = $('hull');
for (const [id, def] of Object.entries(HULLS)) {
  if (def.player) continue;
  const o = document.createElement('option');
  o.value = id;
  o.textContent = def.label;
  hullSel.appendChild(o);
}
hullSel.value = S.hullId;
hullSel.addEventListener('change', () => { S.hullId = hullSel.value; startScene('arrival'); });
$('palette').addEventListener('change', (e) => { S.palette = e.target.value; startScene(S.scene, { keepCamera: true }); });
for (const b of document.querySelectorAll('.scenes button')) b.addEventListener('click', () => startScene(b.dataset.scene));
$('replay').addEventListener('click', () => startScene(S.scene, { keepCamera: true }));
$('pause').addEventListener('click', () => setPaused(!S.paused));
$('slow').addEventListener('click', () => setSlow(!S.slow));
$('loop').addEventListener('click', () => {
  S.loop = !S.loop;
  $('loop').classList.toggle('on', S.loop);
  S.loopAt = S.loop && S.scene !== 'fleet' ? S.sceneT0 + S.sceneLen + 1.2 : Infinity;
});
for (const key of Object.keys(WARP_FX_LAYERS)) {
  const el = $(`ly-${key}`);
  if (!el) continue;
  el.checked = WARP_FX_LAYERS[key] !== false;
  el.addEventListener('change', () => { WARP_FX_LAYERS[key] = el.checked; });
}
function zoomBy(k, sx = W * 0.5, sy = H * 0.5) {
  const before = { x: (sx - W * 0.5) / S.cam.zoom + S.cam.x, y: (sy - H * 0.5) / S.cam.zoom + S.cam.y };
  S.cam.zoom = Math.min(1.6, Math.max(0.02, S.cam.zoom * k));
  S.cam.x = before.x - (sx - W * 0.5) / S.cam.zoom;
  S.cam.y = before.y - (sy - H * 0.5) / S.cam.zoom;
}
$('zoom-in').addEventListener('click', () => zoomBy(1.5));
$('zoom-out').addEventListener('click', () => zoomBy(1 / 1.5));
$('zoom-reset').addEventListener('click', () => Object.assign(S.cam, S.sceneCam));
canvas2d.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => {
  if (e.button === 2 || e.button === 1) {
    S.dragging = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y };
    canvas2d.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button === 0 && S.scene === 'fleet') {
    const wx = (e.clientX - W * 0.5) / S.cam.zoom + S.cam.x;
    const wy = (e.clientY - H * 0.5) / S.cam.zoom + S.cam.y;
    if (WarpFx3D.arrivals.length > 24) clearScene();
    const before = WarpFx3D.arrivals.length;
    summonFleet(wx, wy, 0);
    if (before === 0) S.sceneT0 = WarpFx3D.time;
  }
});
canvas2d.addEventListener('pointermove', (e) => {
  if (!S.dragging) return;
  S.cam.x = S.dragging.cx - (e.clientX - S.dragging.x) / S.cam.zoom;
  S.cam.y = S.dragging.cy - (e.clientY - S.dragging.y) / S.cam.zoom;
});
canvas2d.addEventListener('pointerup', () => { S.dragging = null; });
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
  if (e.code === 'Digit1') startScene('arrival');
  else if (e.code === 'Digit2') startScene('fleet');
  else if (e.code === 'Digit3') startScene('ambush');
  else if (e.code === 'Digit4') startScene('travel');
  else if (e.code === 'KeyR') startScene(S.scene, { keepCamera: true });
  else if (e.code === 'Space') { e.preventDefault(); setPaused(!S.paused); }
  else if (e.code === 'KeyS') setSlow(!S.slow);
});

// ---------------------------------------------------------------------------
// Start
(async () => {
  try {
    await loadHullAssets();
    S.player = createShip('atlas', 0, 0, 0);
    window.ship = S.player;
    $('loading').style.display = 'none';
    startScene(S.scene);
    S.ready = true;
    requestAnimationFrame(loop);
  } catch (err) {
    reportError(err.stack || String(err));
  }
})();

// Sterowanie z CDP (zrzuty, pomiary): stały krok zamiast rAF.
window.__warpDemo = {
  get ready() { return S.ready; },
  S,
  startScene,
  setPaused,
  scrubTo,
  summonFleet,
  advance(seconds, fps = 60) {
    const dt = 1 / fps;
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) { simulate(dt); render(dt, dt); }
    return WarpFx3D.time - S.sceneT0;
  },
  stats: () => ({ ...WarpFx3D.stats, t: WarpFx3D.time - S.sceneT0, calls: Core3D.lastFrameRenderInfo?.total?.calls ?? null })
};
