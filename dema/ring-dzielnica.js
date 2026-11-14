// Demo: DZIELNICE RINGU ZIEMI (prototypy 2026-11-13) — jedna strona dla całego ringu albo jednej dzielnicy.
//   /dema/ring-dzielnica.html            — CAŁOŚĆ: port ze stocznią w środku, po lewej fabryki, huta, elektronika, po prawej
//                                           zbrojownia, składy, dworzec — obok siebie na jednym łuku ringu (bez szpar)
//   /dema/ring-dzielnica.html?d=huta     — jedna dzielnica; ?d=huta,fabryki — wybrane obok siebie
// Dzielnica to wtyczka `dema/ring-dzielnice/<id>/index.js` (układ + bryły + opcjonalny ruch); gospodarz daje resztę:
// potok renderu gry (Core3D), ścianę ringu i drogę z kratownicą na całym łuku, zatoki ciężarówek i przystanki kolei,
// statki w dokach (proxy ruchu v2), Atlasa 1:1 z kolizjami, kamerę, panel. Złożenie: `kit/zlozenie.js` — każda dzielnica
// dostaje obrót wokół środka ringu, jej budowle własną ramkę. Kontrakt wtyczki: dema/ring-dzielnice/README.md.
// Serwowanie: `npm run dev` (?view=1…9, ?shot=1 — bez panelu, do zrzutów).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import { Discard, Fn, If, cos, dot, max, normalize, pow, sin, smoothstep, texture, uniform, uv, vec3, vec4 } from 'three/tsl';
import { Core3D } from '../src/3d/core3d.js';
import { drawHexShips3D, initHexShips3D, resizeHexShips3D, updateHexShips3D } from '../src/3d/hexShips3D.js';
import { Fx3D } from '../src/3d/fxParticles3D.js';
import { ShipProxyBatch3D } from '../src/3d/shipProxyBatch3D.js';
import { CargoContainers3D } from '../src/3d/cargoContainers3D.js';
import { CargoDrones3D } from '../src/3d/cargoDrones3D.js';
import { CARGO_DRONE, CARGO_DRONE_STRIDE } from '../src/game/cargoPortOps.js';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import { portModuleFrame } from '../src/3d/portBuildings/portModuleTraffic.js';
import { PortBuilding3D } from '../src/3d/portBuildings/portBuildings3D.js';
import { HULL_BUILD_Y, PortHullBuild3D } from '../src/3d/portBuildings/portHullBuild3D.js';
import { hullBuildFront } from '../src/3d/portBuildings/portShipyardLayout.js';
import { trafficHullRenderSize } from '../src/data/trafficHulls.js';
import { K7CollisionWorld, K7FlightModel, K7RoofFade, K7_ATLAS, K7_ATLAS_COLLISION, k7HeightToZ } from '../src/3d/haloRing/haloPortK7Layout.js';
import { yardPoint, yardRadial, yardTangent, yardToArc } from './ring-dzielnice/kit/uklad.js';
import { buildBandScene, buildDistrictRoadScene, buildHangarRoofScene } from './ring-dzielnice/kit/sceny.js';
import { RING_ORDER, chainOffsets, composeRing } from './ring-dzielnice/kit/zlozenie.js';
import { TworzywoRecorder } from './ring-dzielnice/kit/tworzywo.js';
import { Tworzywo3D } from './ring-dzielnice/kit/tworzywo3d.js';
import { createGameRing, thetaToS } from './ring-dzielnice/kit/ringGry.js';
import { buildRingPylonScene, pylonPlan } from './ring-dzielnice/kit/pylonyRingu.js';
import { ringPortElements } from './ring-dzielnice/kit/ringGryUklad.js';
import { buildPassageRoofScene, buildPassageScene, carveScene, carveSolids, passagePlan } from './ring-dzielnice/kit/przejscieTranzytu.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
// Ring Ziemi z gry (kit/ringGry.js) zamiast zastępczego pasu „Ściana ringu”: ?ring=0 — stary pas;
// ?portRingu=1 — zostaw port ringu gry (hale K-7, zatoki) pod dzielnicami (porównanie); ?jakosc=low|medium|high|ultra.
const RING_FROM_URL = params.get('ring') !== '0';
const SHOW_RING_PORT = params.get('portRingu') === '1';
const RING_QUALITY = params.get('jakosc') || 'high';
// Strefa przemysłowa na podłodze habitatu pod łukiem dzielnic (opcja ringu `floorSites`); ?strefa=0 — habitat jak w grze.
const RING_INDUSTRY = params.get('strefa') !== '0';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const wanted = (params.get('d') || 'ring').replace(/[^a-z0-9,-]/gi, '');
const WHOLE = wanted === 'ring';

// ---------------------------------------------------------------------------
// Błędy na ekranie (shadery, wyjątki) — demo ma je pokazywać, nie połykać.
const errors = [];
function reportError(text) {
  errors.push(String(text).slice(0, 2000));
  const el = $('errors');
  el.style.display = 'block';
  el.textContent = errors.join('\n\n');
  console.error(text);
}
window.addEventListener('error', (e) => reportError(`JS: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(`Promise: ${e.reason?.stack || e.reason}`));

// ---------------------------------------------------------------------------
// Core3D jak w grze (kanwa WebGPU pod spodem, klatka kopiowana na 2D)
const canvas2d = $('c');
const ctx2d = canvas2d.getContext('2d');
const glCanvas = $('webgl-layer');
let W = canvas2d.width = innerWidth;
let Hh = canvas2d.height = innerHeight;
glCanvas.width = W;
glCanvas.height = Hh;
initHexShips3D({ canvas: glCanvas });
// GŁĘBIA PRZY DALEKIM ODDALENIU: kamera z góry stoi tym dalej, im mniejszy zoom (przy całym ringu ~120 tys. j.), a bliska
// płaszczyzna kamery Core3D jest stała (100 j.). Rozdzielczość głębi spada wtedy do kilku jednostek i dach budowli
// (2,5 j. nad korpusem) na zmianę wygrywa i przegrywa z korpusem — całe płaszczyzny czernieją przy niektórych
// oddaleniach. Demo odsuwa bliską płaszczyznę razem z kamerą (Core3D ustawia ją w syncCamera w każdym passie).
const DEPTH_FIX = new URLSearchParams(location.search).get('glebia') !== '0';      // ?glebia=0 — bez poprawki (A/B)
const syncCamera0 = Core3D.syncCamera.bind(Core3D);
Core3D.syncCamera = (cam, w, h, off = 0) => {
  const out = syncCamera0(cam, w, h, off);
  if (cam && cam.mode !== 'free3d' && DEPTH_FIX) {
    const near = Math.max(100, 0.4 * (Core3D.cameraPersp.position.z - 2500));
    if (near !== Core3D.cameraPersp.near) { Core3D.cameraPersp.near = near; Core3D.cameraPersp.updateProjectionMatrix(); }
  }
  return out;
};
CargoContainers3D.attach(Core3D.scene);
CargoDrones3D.attach(Core3D.scene);
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  Hh = canvas2d.height = innerHeight;
  resizeHexShips3D(W, Hh);
});

// Początek układu (krawędź ścian ringu, s = 0 złożenia) daleko od zera — precyzja float32 jak w grze.
const P0 = Object.freeze({ x: 7_080_000, y: 6_290_000 });
window.SUN = { x: P0.x - 1_150_000, y: P0.y + 420_000, r: 2600 };

(function addStars() {
  const n = 4200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P0.x + (rnd() - 0.5) * 1100000;
    pos[i * 3 + 1] = -P0.y + (rnd() - 0.5) * 760000;
    pos[i * 3 + 2] = -90000 - rnd() * 40000;
    const b = Math.pow(rnd(), 6) * 1.3 + 0.06;
    const tint = rnd();
    col[i * 3] = b * (0.85 + 0.15 * tint);
    col[i * 3 + 1] = b * 0.92;
    col[i * 3 + 2] = b * (1.05 - 0.15 * tint);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  pts.frustumCulled = false;
  pts.layers.set(1);
  Core3D.scene.add(pts);
})();

const host = new THREE.Group();
host.name = 'RingZiemi (gospodarz)';
host.position.set(P0.x, -P0.y, 0);
Core3D.scene.add(host);
const LAYER_BG = 1;
const LAYER_FG = 2;
// Ramka wspólna: x lokalne = +X sceny, z lokalne = −Y sceny (= +y gry, w dół ekranu) — układ lokalny = przesunięcie gry.
const FRAME = portModuleFrame(0, 0, -Math.PI / 2);

const state = {
  showShips: true,
  roofsOff: false,
  cam: { x: P0.x, y: P0.y + 2200, zoom: 0.05 },
  follow: false,
  mode: 'game',               // game | cine
  view: 1,
  fps: 60,
  T: 0,
  speed: 1,
  ringOn: RING_FROM_URL,
  marks: params.get('znaczniki') === '1'     // znaczniki elementów ringu z gry (tranzyty, port ringu) i wycięcia dachu nad tranzytami
};

// Ring z gry: tworzony po Core3D.ready (przed pierwszą klatką), przy ?ring=0 — dopiero po włączeniu w panelu.
let gameRing = null;
let gameRingPending = null;
function ensureGameRing() {
  if (gameRing || gameRingPending) return gameRingPending;
  gameRingPending = createGameRing({
    P0, arcMin: ring.merged.roadMin, arcMax: ring.merged.roadMax, showPort: SHOW_RING_PORT, quality: RING_QUALITY, sun: window.SUN,
    industry: RING_INDUSTRY ? { s0: ring.merged.sMin - 2000, s1: ring.merged.sMax + 2000 } : null
  }).then((g) => { gameRing = g; g.setOn(state.ringOn); return g; })
    .catch((err) => { reportError(`Ring z gry: ${err.stack || err}`); return null; });
  return gameRingPending;
}
function setRingOn(v) {
  state.ringOn = !!v;
  if (state.ringOn) ensureGameRing();
  if (gameRing) gameRing.setOn(state.ringOn);
}
const gameRingShown = () => !!(gameRing && state.ringOn && gameRing.ready);

// Pylony od podłogi habitatu do rzędu przy ringu (decyzja użytkownika 2026-11-13): budowane, gdy ring jest gotowy (wiadomo,
// gdzie stoją kopuły i megabudowle habitatu), widoczne tylko z ringiem z gry.
let pylonBuilding = null;
let pylonList = [];
function buildPylons() {
  const g = gameRing;
  const fm = g.layout.radii.floorMid;
  const k = ring.merged.R0 / fm;
  const skip = g.elements.filter((e) => e.kind === 'tranzyt').map((e) => [e.s0 - 600, e.s1 + 600]);
  for (const pl of PASSAGES) skip.push([pl.rowCut[0] - 200, pl.rowCut[1] + 200]);
  const obstacles = [...(g.ring.domes || []), ...(g.ring.landmarks || [])]
    .map((o) => ({ s: thetaToS(o.theta), halfS: (o.reachA || o.r || 600) * k, z: o.z, halfZ: o.reachQ || o.r || 600 }));
  pylonList = pylonPlan({ sMin: ring.merged.sMin, sMax: ring.merged.sMax, skip, obstacles });
  pylonBuilding = mk(buildRingPylonScene(pylonList), 'Pylony ringu');
  applyLayers();
}
function ringCuts() {
  if (!gameRing) return;
  gameRing.setCuts(state.marks ? gameRing.elements.filter((e) => e.kind === 'tranzyt').map((e) => ({ s: e.s, v: -900, a: 2400, b: 1500 })) : []);
}
function setMarks(v) { state.marks = !!v; ringCuts(); }

// Znaczniki 2D (kamera z góry): zakres elementu ringu wzdłuż łuku po stronie Ziemi i podpis.
const MARK_COLOR = { tranzyt: '#5fe3ff', 'hala K-7': '#ff6a5a', zatoka: '#ffb347' };
function drawRingMarks(cam) {
  if (!state.marks || !gameRing || state.mode !== 'game') return;
  const z = cam.zoom;
  const toS = (s, v) => { const [x, zz] = yardPoint(s, v); return [(P0.x + x - cam.x) * z + W / 2, (P0.y + zz - cam.y) * z + Hh / 2]; };
  ctx2d.save();
  ctx2d.lineWidth = 3;
  ctx2d.font = '600 13px Segoe UI, system-ui, sans-serif';
  ctx2d.textAlign = 'center';
  for (const e of gameRing.elements) {
    const hidden = e.complex >= 0 && gameRing.hiddenComplexes.has(e.complex);
    const col = MARK_COLOR[e.kind] || '#fff';
    const vLine = -2350;
    ctx2d.strokeStyle = col;
    ctx2d.setLineDash(hidden ? [8, 6] : []);
    ctx2d.beginPath();
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const [x, y] = toS(e.s0 + ((e.s1 - e.s0) * i) / n, vLine);
      if (i) ctx2d.lineTo(x, y); else ctx2d.moveTo(x, y);
    }
    for (const sEdge of [e.s0, e.s1]) { const [x0, y0] = toS(sEdge, vLine); const [x1, y1] = toS(sEdge, vLine + 500); ctx2d.moveTo(x0, y0); ctx2d.lineTo(x1, y1); }
    ctx2d.stroke();
    const [lx, ly] = toS(e.s, vLine - 260 - 14 / z);
    if (lx < -200 || lx > W + 200 || ly < -40 || ly > Hh + 40) continue;
    const text = `${e.id}${hidden ? ' (schowana w demie)' : e.kind === 'tranzyt' ? ' — przelot przez ring' : ''}`;
    ctx2d.setLineDash([]);
    ctx2d.lineWidth = 4;
    ctx2d.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx2d.strokeText(text, lx, ly);
    ctx2d.fillStyle = col;
    ctx2d.fillText(text, lx, ly);
    ctx2d.lineWidth = 3;
  }
  ctx2d.restore();
}

// ---------------------------------------------------------------------------
// Wtyczki dzielnic i złożenie na łuku ringu
const style = resolvePortBuildingStyle('earth');
const order = WHOLE ? [...RING_ORDER.left.slice().reverse(), RING_ORDER.center, ...RING_ORDER.right] : wanted.split(',').filter(Boolean);
const loaded = {};
for (const id of order) {
  try {
    const plugin = (await import(/* @vite-ignore */ `./ring-dzielnice/${id}/index.js`)).default;
    loaded[id] = { plugin, built: await plugin.build({ style }) };
  } catch (err) {
    reportError(`Dzielnica „${id}”: ${err.stack || err}`);
  }
}
const ids = order.filter((id) => loaded[id]);
if (!ids.length) throw new Error('brak dzielnic do pokazania');
const layouts = Object.fromEntries(ids.map((id) => [id, loaded[id].built.layout]));
const chain = WHOLE && loaded[RING_ORDER.center]
  ? { center: RING_ORDER.center, left: RING_ORDER.left.filter((id) => loaded[id]), right: RING_ORDER.right.filter((id) => loaded[id]) }
  : { center: ids[0], left: [], right: ids.slice(1) };
const offsets = chainOffsets(layouts, chain);
const ring = composeRing(ids.map((id) => ({ id, name: loaded[id].plugin.name, layout: layouts[id], S: offsets[id] })));
const parts = ring.parts;
for (const p of parts) { p.plugin = loaded[p.id].plugin; p.built = loaded[p.id].built; p.buildings = []; }
const partById = Object.fromEntries(parts.map((p) => [p.id, p]));
const MULTI = parts.length > 1;
const title = MULTI ? 'Ring Ziemi — dzielnice' : parts[0].plugin.name;
document.title = `${title} — prototyp`;
$('title').textContent = MULTI ? 'RING ZIEMI — WSZYSTKIE DZIELNICE' : `DZIELNICA RINGU — ${String(title).toUpperCase()}`;
$('sub').textContent = MULTI
  ? 'Port ze stocznią i dzielnice ringu obok siebie na jednym łuku: fabryki przy stoczni, zbrojownia przy suchym doku floty. Jedna droga z kratownicą przez całość. Klawisze 2–8 — kolejne dzielnice (ponowne naciśnięcie: następne miejsce w tej dzielnicy).'
  : (parts[0].plugin.sub || '');

// Przejścia do tranzytów ringu z gry pod dzielnicami (kit/przejscieTranzytu.js, decyzja użytkownika 2026-11-13: „przejście —
// dodaj drogę, zabudowany skręt do tranzytu”): wycięcie rzędu przy ringu i korytarza w habitacie, ściany, skosy i bloki
// przejścia w kolizjach, bez bramownic nad drogą i bez zatok / przystanków w wycięciu. Tylko z ringiem z gry (?ring=0 — jak dawniej).
const PASSAGES = RING_FROM_URL
  ? ringPortElements().filter((e) => e.kind === 'tranzyt' && e.s > ring.merged.sMin && e.s < ring.merged.sMax)
    .map((e) => ({ ...passagePlan(e.s), name: e.id.split(' ').pop() }))
  : [];
const passageDropped = [];
if (PASSAGES.length) {
  const carved = carveSolids(ring.solids, PASSAGES, ring.merged.v);
  ring.solids.splice(0, ring.solids.length, ...carved);
  // tylko punkty przy licu rzędu przy ringu (side −1); zasięg wzdłuż łuku z długości
  const inCut = (q) => q.side < 0 && PASSAGES.some((pl) => q.s + (q.len || 0) / 2 > pl.rowCut[0] && q.s - (q.len || 0) / 2 < pl.rowCut[1]);
  for (const pl of PASSAGES) ring.merged.openings.push({ s0: pl.rowCut[0], s1: pl.rowCut[1], label: `przejście ${pl.name}`, part: null });
  for (const key of ['truckBays', 'railStops']) {
    const list = ring.merged[key];
    const keep = list.filter((q) => !inCut(q));
    for (const q of list) if (!keep.includes(q)) passageDropped.push(`${key === 'truckBays' ? 'zatoka ciężarówek' : 'przystanek kolei'} ${q.id || q.label || ''} (${q.part}, s ${Math.round(q.s)})`.replace('  ', ' '));
    list.splice(0, list.length, ...keep);
  }
}
const collision = new K7CollisionWorld();
for (const s of ring.solids) collision.addPolygon(s.id, s.points.map(([x, z]) => ({ x, z })), 0, 150);

// Statki w dokach stoją; ziarno z położenia. Wtyczka może podać `hulls(berth)`: id kadłuba, null (puste) albo undefined.
const DEFAULT_HULLS = {
  s: ['inter_station_shuttle', 'belter', 'police_cutter'],
  m: ['container_ship', 'heavy_harvester', 'rescue_ship'],
  l: ['long_haul_freighter', 'tanker', 'refinery_tender'],
  carrier: [],
  capital: ['heavy_freighter'],
  mega: ['megafreighter']
};
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const parked = [];
for (const p of parts) p.occupied = new Set();
const _arcB = {};
for (const b of ring.berths) {
  if (PASSAGES.length) {
    yardToArc(b.x, b.z, _arcB);
    if (_arcB.v < ring.merged.v.inner1 + 100 && PASSAGES.some((pl) => _arcB.s > pl.rowCut[0] && _arcB.s < pl.rowCut[1])) { passageDropped.push(`stanowisko ${b.id} (${b.part})`); continue; }
  }
  const p = partById[b.part];
  let hullId = typeof p.built.hulls === 'function' ? p.built.hulls(b.local) : undefined;
  if (hullId === undefined) {
    const pool = DEFAULT_HULLS[b.cls] || [];
    hullId = pool.length && hash(b.local.s * 0.013 + b.local.v * 0.07) < 0.62 ? pool[Math.floor(hash(b.local.s * 0.031 + 2.5) * pool.length)] : null;
  }
  if (!hullId) continue;
  parked.push({ id: `p-${p.id}-${b.id}`, hullId, x: P0.x + b.x, y: P0.y + b.z, angle: b.heading });
  p.occupied.add(b.id);
}

// ---------------------------------------------------------------------------
// Budowle
const B = { list: [], byName: new Map(), status: [], roofs: [] };
// Tworzywo dzielnic (kit/tworzywo.js): bryły ruchome procesu — powstaje przy pierwszym użyciu `api.tworzywo`.
const tworzywa = [];
function mk(scene, name, frame = FRAME, part = null) {
  const b = new PortBuilding3D({ layout: { id: name }, scene, style, frame, name });
  host.add(b.root);
  B.list.push(b);
  B.byName.set(name, b);
  b.part = part;
  if (scene.rig?.status?.length) B.status.push(b);
  return b;
}
function applyLayers() {
  const fg = state.mode === 'cine' ? LAYER_BG : LAYER_FG;
  for (const b of B.list) b.setLayers(LAYER_BG, fg);
  for (const t of tworzywa) t.view.setLayers(LAYER_BG, fg);
  const cineOn = state.mode === 'cine';
  CargoContainers3D.setLayer(cineOn ? LAYER_BG : 0);
  CargoDrones3D.setLayers(cineOn ? LAYER_BG : 0, cineOn ? LAYER_BG : LAYER_FG);
}

/** Kadłub w budowie (PortHullBuild3D) w ramce `{ at(wzdłuż, w poprzek) → [x, z] }` — dla dzielnic, które coś składają. */
class YardHull extends PortHullBuild3D {
  constructor(building, frame, key, along = 0) {
    super({ slip: { x: 0, z: 0, index: key, id: `kadlub-${key}`, padLength: 100, padBeam: 100 }, building });
    this.line = frame;
    this.along = along;
    this.mesh.frustumCulled = false;
    building.root.add(this.mesh);
    building.meshes.bg.push(this.mesh);
    this._write();
  }
  _placeQuad(len, beam) {
    this.hullLength = len;
    this.hullBeam = beam;
    if (this.line) this._write();
  }
  moveTo(along) {
    if (along === this.along) return;
    this.along = along;
    this._write();
  }
  _write() {
    const L = this.line;
    const y = k7HeightToZ(HULL_BUILD_Y);
    const hl = this.hullLength / 2;
    const hb = this.hullBeam / 2;
    const p = this.pos;
    const put = (i, along, across) => { const q = L.at(along, across); p[i] = q[0]; p[i + 1] = y; p[i + 2] = q[1]; };
    put(0, this.along - hl, -hb);
    put(3, this.along + hl, -hb);
    put(6, this.along + hl, hb);
    put(9, this.along - hl, hb);
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Ruch dzielnic (wtyczki): statki jako proxy, drony z renderera gry. Wtyczka podaje współrzędne SWOJEJ dzielnicy.
const proxies = [];
const droneRec = new Float32Array(CARGO_DRONE_STRIDE);
const dronePose = { x: 0, y: 0, angle: 0 };
const _w = [0, 0];
let droneCount = 0;
function makeApi(p) {
  return {
    THREE, layout: p.layout, style, P0, hash, state, CARGO_DRONE, YardHull, hullBuildFront, trafficHullRenderSize, yardPoint,
    buildings: p.buildings,
    building: (name) => B.byName.get(name) || null,
    occupied: p.occupied,
    get time() { return state.T; },
    /**
     * Rejestrator brył ruchomych procesu (bryłki rudy, kopce, żar, kręgi, pojazdy) w układzie dzielnicy — zapisuj co
     * klatkę we `frame(api)`: `api.tworzywo.box / cyl / roll / cone(zestaw 'bg' | 'fg', …)`; opis: kit/tworzywo.js.
     */
    get tworzywo() {
      if (!p.tworzywo) {
        const recorder = new TworzywoRecorder();
        p.tworzywo = { recorder, view: new Tworzywo3D({ recorder, frame: p.pbFrame, host, sunDir: B.list[0].uniforms.uSunDirW.value }) };
        tworzywa.push(p.tworzywo);
        applyLayers();
      }
      return p.tworzywo.recorder;
    },
    /** Statek w ruchu (proxy ruchu v2): poza w układzie dzielnicy; opts: { opacity, vx, vz, throttle }. */
    proxy(id, hullId, x, z, angle, opts = null) {
      p.toWorld(x, z, _w);
      const a = p.heading(angle);
      const v = opts ? Math.hypot(opts.vx || 0, opts.vz || 0) : 0;
      proxies.push({ id: `${p.id}:${id}`, hullId, x: P0.x + _w[0], y: P0.y + _w[1], angle: a, opacity: opts?.opacity ?? 1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, throttle: opts?.throttle || 0 });
    },
    droneRec,
    /** Dron z renderera gry: `pose` { x, z, angle } w układzie dzielnicy (rama U / V rekordu), rekord z `droneRec`. Tylko w `drones(api)`. */
    drone(pose, size = { L: 46, W: 40, H: 13 }) {
      p.toWorld(pose.x, pose.z, _w);
      dronePose.x = P0.x + _w[0];
      dronePose.y = P0.y + _w[1];
      dronePose.angle = p.heading(pose.angle);
      if (CargoDrones3D.pushDrone(dronePose, droneRec, 0, size, state.T)) droneCount++;
    }
  };
}

let bandBuilding = null;
let passageRemoved = 0;
function buildWorld() {
  for (const pl of PASSAGES) {
    mk(buildPassageScene(pl, pl.name, style), `Przejście do tranzytu ${pl.name}`);
    const roof = mk(buildPassageRoofScene(pl), `Dach przejścia ${pl.name}`);
    roof.roofFadeModel = new K7RoofFade(pl.footprint);
    B.roofs.push(roof);
  }
  bandBuilding = mk(buildBandScene(ring.merged, style), 'Ściana ringu');
  mk(buildDistrictRoadScene(ring.merged, style), 'Droga i kratownica');
  for (const p of parts) {
    const frame = portModuleFrame(p.frame.x, p.frame.y, p.frame.angle);
    p.pbFrame = frame;
    for (const def of p.built.buildings) {
      if (PASSAGES.length) passageRemoved += carveScene(def.scene, p.toWorld, PASSAGES.map((pl) => pl.rowCut), ring.merged.v);
      p.buildings.push(mk(def.scene, def.name, frame, p));
    }
    for (const pit of p.layout.pits) {
      if (pit.kind !== 'hangar' || pit.orient !== 'arc') continue;
      const b = mk(buildHangarRoofScene(p.layout, pit, style), `Dach hangaru ${p.id} ${pit.id}`, frame, p);
      b.roofFadeModel = new K7RoofFade([[pit.s0, pit.v0], [pit.s1, pit.v0], [pit.s1, pit.v1], [pit.s0, pit.v1]].map(([s, v]) => { const q = yardPoint(s + p.S, v); return { x: q[0], z: q[1] }; }));
      B.roofs.push(b);
    }
    p.api = makeApi(p);
  }
  applyLayers();
  for (const p of parts) if (p.built.init) p.built.init(p.api);
}

// ---------------------------------------------------------------------------
// Atlas gracza: model lotu z dema K-7 (stały krok 120 Hz, kolizje z wielokątami układu), sprite i płomienie dysz
const FLIGHT_TUNE = { acc: 210, speed: 980, speedIn: 300, turn: 0.52, turnIn: 0.36, torque: 1.1 };
const player = new K7FlightModel(collision, { x: 0, z: 14000, angle: -Math.PI / 2 }, K7_ATLAS, K7_ATLAS_COLLISION, FLIGHT_TUNE);
player.locked = false;
player.fuel = 1e9;
const STEP = 1 / 120;
let accumulator = 0;
let inside = 0;
const where = {};
const keys = new Set();

const atlasTex = new THREE.TextureLoader().load('assets/capital_ship_rect_v1.png');
atlasTex.colorSpace = THREE.SRGBColorSpace;
atlasTex.anisotropy = 8;
const atlasU = { uLight: uniform(new THREE.Vector3(0, 0, 1)), uRot: uniform(0) };
const atlasMat = new NodeMaterial();
atlasMat.name = 'AtlasDemoSprite';
atlasMat.lights = false;
atlasMat.fog = false;
atlasMat.uniforms = atlasU;
atlasMat.fragmentNode = Fn(() => {
  const vUv = uv();
  const t = texture(atlasTex, vUv).toVar();
  If(t.a.lessThan(0.45), () => { Discard(); });
  const p = vUv.mul(2.0).sub(1.0);
  const n0 = normalize(vec3(p.x.mul(0.45), p.y.mul(0.45), 1.0));
  const c = cos(atlasU.uRot);
  const s = sin(atlasU.uRot);
  const n = normalize(vec3(n0.x.mul(c).sub(n0.y.mul(s)), n0.x.mul(s).add(n0.y.mul(c)), n0.z));
  const NdL = dot(n, atlasU.uLight);
  const d = max(0.0, NdL);
  const h = normalize(atlasU.uLight.add(vec3(0.0, 0.0, 1.0)));
  const spec = pow(max(dot(n, h), 0.0), 32.0).mul(0.3).mul(smoothstep(-0.02, 0.08, NdL));
  const col = t.rgb.mul(d.mul(1.18).add(0.24)).add(vec3(spec));
  return vec4(col, 1.0);
})();
const atlas = new THREE.Mesh(new THREE.PlaneGeometry(K7_ATLAS.w, K7_ATLAS.h), atlasMat);
atlas.name = 'Atlas (demo)';
atlas.layers.set(0);
atlas.renderOrder = 10;
atlas.frustumCulled = false;
Core3D.scene.add(atlas);

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(123,207,255,0)');
  grad.addColorStop(0.32, 'rgba(66,154,213,0.1)');
  grad.addColorStop(0.8, 'rgba(145,235,255,0.6)');
  grad.addColorStop(1, 'rgba(237,254,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 32);
  g.quadraticCurveTo(100, 28, 256, 8);
  g.lineTo(256, 56);
  g.quadraticCurveTo(100, 36, 0, 32);
  g.fill();
  return new THREE.CanvasTexture(c);
}
const flameTex = flameTexture();
const NOZZLES = [
  [-0.47, -0.2, -1], [-0.47, -0.07, -1], [-0.47, 0.07, -1], [-0.47, 0.2, -1],
  [0.3, -0.24, 1], [0.3, 0.24, 1]
];
const flames = NOZZLES.map(() => {
  const mat = new THREE.MeshBasicMaterial({ map: flameTex, color: new THREE.Color(1.6, 2.6, 3.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.layers.set(0);
  mesh.renderOrder = 9;
  mesh.frustumCulled = false;
  mesh.visible = false;
  Core3D.scene.add(mesh);
  return mesh;
});
let thrustMain = 0;
let thrustRetro = 0;

function teleport(x, z, angle) {
  player.x = x;
  player.z = z;
  player.angle = angle;
  player.vx = player.vz = player.angVel = 0;
  accumulator = 0;
}
function stepPlayer(dt) {
  const inp = player.input;
  inp.main = keys.has('KeyW') ? 1 : 0;
  inp.retro = keys.has('KeyS') ? 1 : 0;
  inp.torque = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  inp.brake = keys.has('Space') ? 1 : 0;
  inp.boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
  accumulator = Math.min(accumulator + dt, 0.25);
  while (accumulator >= STEP) {
    ring.locate(player.x, player.z, where);
    inside += (where.inside - inside) * (1 - Math.exp(-3 * STEP));
    player.step(STEP, inside);
    accumulator -= STEP;
  }
  ring.locate(player.x, player.z, where);
  const k = 1 - Math.exp(-7 * dt);
  thrustMain += ((inp.main ? (inp.boost && inside < 0.2 ? 1.5 : 1) : 0) - thrustMain) * k;
  thrustRetro += ((inp.retro ? 1 : 0) - thrustRetro) * k;
}
function placePlayer() {
  const gx = P0.x + player.x;
  const gy = P0.y + player.z;
  atlas.position.set(gx, -gy, 0);
  atlas.rotation.set(0, 0, -player.angle);
  atlas.material.uniforms.uLight.value.set(window.SUN.x - gx, -(window.SUN.y - gy), 600000).normalize();
  atlas.material.uniforms.uRot.value = -player.angle;
  const c = Math.cos(player.angle);
  const s = Math.sin(player.angle);
  NOZZLES.forEach(([u, v, dir], i) => {
    const power = dir < 0 ? thrustMain : thrustRetro;
    const mesh = flames[i];
    mesh.visible = power > 0.02;
    if (!mesh.visible) return;
    const len = (dir < 0 ? 520 : 260) * power * (0.92 + 0.08 * Math.sin(state.T * 47 + i * 1.7));
    const wid = dir < 0 ? 86 : 54;
    const lx = u * K7_ATLAS.w + dir * len * 0.5;
    const ly = v * K7_ATLAS.h;
    mesh.position.set(gx + lx * c - ly * s, -(gy + lx * s + ly * c), 1);
    mesh.rotation.set(0, 0, -player.angle + (dir < 0 ? 0 : Math.PI));
    mesh.scale.set(len, wid, 1);
  });
}

// ---------------------------------------------------------------------------
// Miejsca (widoki): kadr albo teleport Atlasa (współrzędne wspólne)
const V = ring.merged.v;
function gotoXZ(x, z, heading, zoom) {
  teleport(x, z, heading);
  state.mode = 'game';
  state.follow = true;
  state.cam.zoom = zoom;
  state.cam.x = P0.x + x;
  state.cam.y = P0.y + z;
  applyLayers();
}
function goto(s, v, heading, zoom) {
  const [x, z] = yardPoint(s, v);
  gotoXZ(x, z, heading, zoom);
}
function centerXZ(x, z, zoom) {
  state.mode = 'game';
  state.follow = false;
  state.cam.x = P0.x + x;
  state.cam.y = P0.y + z;
  state.cam.zoom = zoom;
  applyLayers();
}
/** Kadr swobodny obejmujący punkty (układ wspólny), obok panelu. */
function frameBox(pts, k = 1.08) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const panel = shotMode ? 0 : 350;
  const zoom = Math.max(0.004, Math.min((Math.max(W, 640) - panel) / ((x1 - x0) * k), Math.max(Hh, 360) / ((z1 - z0) * k)));
  state.mode = 'game';
  state.follow = false;
  state.cam.zoom = zoom;
  state.cam.x = P0.x + (x0 + x1) / 2 + panel / 2 / zoom;
  state.cam.y = P0.y + (z0 + z1) / 2;
  applyLayers();
}
const partPoints = (p) => {
  const pts = [];
  for (const q of ring.solids) if (q.part === p.id) for (const pt of q.points) pts.push(pt);
  pts.push(yardPoint(p.sMin, -200), yardPoint(p.sMax, -200));
  return pts;
};
/** Widok wtyczki przeniesiony do układu wspólnego. */
function applyPluginView(p, v) {
  if (v.frame) { frameBox(v.frame.map(([x, z]) => p.toWorld(x, z)), v.margin || 1.08); return; }
  const [s, vv] = v.at;
  if (Number.isFinite(v.heading)) { goto(s + p.S, vv, p.heading(v.heading), v.zoom || 0.2); return; }
  const [x, z] = yardPoint(s + p.S, vv);
  centerXZ(x, z, v.zoom || 0.12);
}
function startPose() {
  const port = partById.port;
  if (port) { const lane = port.layout.gate.laneIn; return { s: lane.s + port.S, v: V.outer1 + 4200, heading: yardRadial(lane.s + port.S) + Math.PI }; }
  const s = parts[0].sMin + 900;
  return { s, v: V.road + 650, heading: yardTangent(s) };
}
const VIEWS = [];
VIEWS.push({ name: MULTI ? 'Cały ring' : 'Cała dzielnica', sub: MULTI ? 'wszystkie dzielnice obok siebie na łuku ringu' : 'ring, rząd przy ringu, droga, rząd zewnętrzny i to, co odstaje', caption: MULTI ? 'Od lewej: elektronika, huta, fabryki, port ze stocznią, zbrojownia, składy, dworzec — jedna droga z kratownicą przez całość' : (parts[0].plugin.sub || ''),
  apply: () => { const pts = []; for (const p of parts) pts.push(...partPoints(p)); frameBox(pts, 1.06); } });
if (MULTI) {
  for (const p of parts) {
    const own = p.built.views || [];
    const v = { name: p.plugin.name, sub: p.plugin.sub || '', caption: p.plugin.sub || '', step: -1 };
    v.apply = () => {
      // kolejne naciśnięcie tego samego klawisza: następne miejsce w dzielnicy
      v.step = state.view === v.key ? (v.step + 1) % (own.length + 1) : 0;
      if (v.step === 0) { frameBox(partPoints(p), 1.08); v.caption = p.plugin.sub || ''; return; }
      const pv = own[v.step - 1];
      applyPluginView(p, pv);
      v.caption = `${pv.name}${pv.caption ? ' — ' + pv.caption : ''}`;
    };
    VIEWS.push(v);
  }
} else {
  const p = parts[0];
  VIEWS.push({ name: 'Droga', sub: 'Atlas na pasie od strony przestrzeni, kurs wzdłuż ringu', caption: 'Droga 2600 j. nad kratownicą: środkiem pasy statków, poboczami ciężarówki, pod spodem kolej',
    apply: () => { const s = p.sMin + 900; goto(s, V.road + 650, yardTangent(s), 0.2); } });
  for (const pv of p.built.views || []) VIEWS.push({ name: pv.name, sub: pv.sub || '', caption: pv.caption || '', apply: () => applyPluginView(p, pv) });
}
while (VIEWS.length > 8) VIEWS.pop();
VIEWS.push({ name: 'Kino: z ukosa', sub: 'wolna kamera wokół Atlasa (lot działa dalej)', caption: 'Kamera z ukosa wokół Atlasa: przeciąganie = orbita, kółko = odległość', cine: true, apply: () => setCine() });
VIEWS.forEach((v, i) => { v.key = v.cine ? 9 : i + 1; });
// 0 · Styk z ringiem: rząd przy ringu i krawędź ścian prawdziwego ringu z bliska (kolejne naciśnięcia — kolejne ujęcia)
{
  const portPart = partById.port || parts[Math.floor(parts.length / 2)];
  const sPort = portPart.S + 3200;
  const transit = () => {
    const el = gameRing?.elements?.find((e) => e.kind === 'tranzyt' && e.s > ring.merged.sMin && e.s < ring.merged.sMax);
    return el ? el.s : parts[0].sMin + 2000;
  };
  const cineAt = (s, v, turn) => {
    const [x, z] = yardPoint(s, v);
    setCine([x, z]);
    cine.az = -Math.PI / 2 + s / ring.merged.R0 + turn;
    cine.el = 0.3;
    cine.dist = 9000;
  };
  const shots = [
    { caption: 'z góry: rząd przy ringu przy krawędzi ścian, za nią habitat ringu (płaszczyzna gry w połowie wysokości wstęgi)', apply: () => { const [x, z] = yardPoint(sPort, -700); centerXZ(x, z, 0.14); } },
    { caption: 'z ukosa od strony przestrzeni: rząd przy ringu w wylocie habitatu, nad nim i pod nim ściany ringu', apply: () => cineAt(sPort, 300, 0.75) },
    { caption: 'z ukosa wzdłuż ringu: ściany ringu (±2 700…2 950) nad i pod rzędami dzielnic', apply: () => cineAt(sPort - 6000, 500, 1.25) },
    { caption: 'od strony Ziemi: tranzyt ringu (przelot przez płytę) pod dzielnicą — po wylocie z habitatu statek trafia w rząd przy ringu', apply: () => cineAt(transit(), -1900, Math.PI + 0.35) }
  ];
  const v = { key: 0, name: 'Styk z ringiem', sub: 'rząd przy ringu i ściany prawdziwego ringu z bliska', caption: '', step: -1 };
  v.apply = () => {
    v.step = state.view === 0 ? (v.step + 1) % shots.length : 0;
    shots[v.step].apply();
    v.caption = `ujęcie ${v.step + 1}/${shots.length} — ${shots[v.step].caption}`;
  };
  VIEWS.push(v);
}

// anchor: punkt (układ wspólny x, z), wokół którego krąży kino zamiast Atlasa (widok „Styk z ringiem”); null — Atlas
const cine = { cam: null, persp: new THREE.PerspectiveCamera(42, 1, 20, 600000), target: new THREE.Vector3(), dist: 7600, az: -1.05, el: 0.52, anchor: null };
cine.persp.up.set(0, 0, 1);
function setCine(anchor = null) {
  cine.anchor = anchor;
  state.mode = 'cine';
  applyLayers();
}
function cineCamera() {
  const p = cine.persp;
  const ce = Math.cos(cine.el);
  const ax = cine.anchor ? cine.anchor[0] : player.x;
  const az = cine.anchor ? cine.anchor[1] : player.z;
  cine.target.set(P0.x + ax, -(P0.y + az), 0);
  p.aspect = W / Math.max(1, Hh);
  p.updateProjectionMatrix();
  p.position.set(cine.target.x + Math.cos(cine.az) * ce * cine.dist, cine.target.y + Math.sin(cine.az) * ce * cine.dist, cine.target.z + Math.sin(cine.el) * cine.dist);
  p.lookAt(cine.target);
  p.updateMatrixWorld();
  if (!cine.cam) cine.cam = { mode: 'free3d', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 42, near: 20, far: 600000, zoom: 1 };
  // kino: bliska płaszczyzna rośnie z odległością kamery (rozdzielczość głębi z daleka)
  cine.cam.near = Math.max(20, cine.dist * 0.08);
  cine.cam.position.copy(p.position);
  cine.cam.quaternion.copy(p.quaternion);
  cine.cam.x = p.position.x;
  cine.cam.y = -p.position.y;
  return cine.cam;
}
function applyView(key) {
  const v = VIEWS.find((q) => q.key === key) || VIEWS[0];
  if (!v.cine) cine.anchor = null;
  v.apply();
  state.view = v.key;
  for (const b of viewButtons) b.classList.toggle('on', Number(b.dataset.view) === v.key);
  $('caption').textContent = `${v.key} · ${v.name}${v.caption ? ' — ' + v.caption : ''}`;
}

// ---------------------------------------------------------------------------
// UI
const viewButtons = VIEWS.map((v) => {
  const b = document.createElement('button');
  b.dataset.view = String(v.key);
  b.innerHTML = `${v.key} · ${v.name}<small>${v.sub}</small>`;
  b.addEventListener('click', () => { applyView(v.key); canvas2d.focus(); });
  $('views').appendChild(b);
  return b;
});
const TOGGLES = [
  ['ring z gry (Ziemia) — R', () => state.ringOn, (v) => setRingOn(v)],
  ['znaczniki ringu: tranzyty, port gry — M', () => state.marks, (v) => setMarks(v)],
  ['statki w dokach', () => state.showShips, (v) => { state.showShips = v; }],
  ['dachy hangarów zdjęte', () => state.roofsOff, (v) => { state.roofsOff = v; }]
];
const toggleInputs = [];
function syncToggles() { for (const [c, get] of toggleInputs) c.checked = get(); }
for (const [label, get, set] of TOGGLES) {
  const l = document.createElement('label');
  const c = document.createElement('input');
  toggleInputs.push([c, get]);
  c.type = 'checkbox';
  c.checked = get();
  c.addEventListener('change', () => { set(c.checked); canvas2d.focus(); });
  l.append(c, label);
  $('toggles').appendChild(l);
}
const SPEEDS = [1, 4, 12];
const speedButtons = SPEEDS.map((k) => {
  const b = document.createElement('button');
  b.textContent = `×${k}`;
  b.addEventListener('click', () => { setSpeed(k); canvas2d.focus(); });
  $('speed').appendChild(b);
  return b;
});
function setSpeed(k) {
  state.speed = k;
  speedButtons.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === k));
}
(function infoTable() {
  const c = { s: 0, m: 0, l: 0, carrier: 0, capital: 0, mega: 0 };
  for (const b of ring.berths) c[b.cls]++;
  const arc = ring.merged.sMax - ring.merged.sMin;
  const rows = [['dzielnice', parts.length], ['długość łuku [tys. j.]', (arc / 1000).toFixed(1)], ['doki S', c.s], ['doki M', c.m], ['doki L', c.l], ['nosiciel', c.carrier], ['capital', c.capital],
    ['pasy MEGA (z zewnątrz)', c.mega], ['zatoki ciężarówek', ring.merged.truckBays.length], ['przystanki kolei', ring.merged.railStops.length]];
  $('info').innerHTML = rows.filter(([, n]) => n > 0).map(([k, n]) => `<tr><td>${k}</td><td>${n}</td></tr>`).join('');
  $('note').textContent = MULTI ? `Łuk ${(arc / 1000).toFixed(0)} tys. j. to ${Math.round((arc / (2 * Math.PI * ring.merged.R0)) * 360)}° ringu. Jedna dzielnica osobno: ?d=nazwa (${ids.join(', ')}).` : (parts[0].built.note || parts[0].plugin.note || '');
})();

let dragging = 0;
let lastX = 0;
let lastY = 0;
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
canvas2d.addEventListener('pointerdown', (e) => { dragging = 1; lastX = e.clientX; lastY = e.clientY; canvas2d.setPointerCapture(e.pointerId); canvas2d.focus(); });
canvas2d.addEventListener('pointerup', () => { dragging = 0; });
canvas2d.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (state.mode === 'cine') {
    cine.az -= dx * 0.005;
    cine.el = Math.max(0.12, Math.min(1.45, cine.el + dy * 0.004));
    return;
  }
  if (Math.abs(dx) + Math.abs(dy) > 0) state.follow = false;
  state.cam.x -= dx / state.cam.zoom;
  state.cam.y -= dy / state.cam.zoom;
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.mode === 'cine') {
    cine.dist = Math.max(1200, Math.min(90000, cine.dist * Math.exp(e.deltaY * 0.001)));
    return;
  }
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = Math.max(0.004, Math.min(1.6, z0 * k));
  if (!state.follow) {
    const mx = e.clientX - W / 2;
    const my = e.clientY - Hh / 2;
    state.cam.x += mx / z0 - mx / z1;
    state.cam.y += my / z0 - my / z1;
  }
  state.cam.zoom = z1;
}, { passive: false });
const FLIGHT_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (FLIGHT_KEYS.has(e.code)) {
    keys.add(e.code);
    if (state.mode === 'game' && !state.follow && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') { state.follow = true; if (state.cam.zoom < 0.1) state.cam.zoom = 0.2; }
    e.preventDefault();
    return;
  }
  if (/^Digit[0-9]$/.test(e.code)) applyView(Number(e.code.slice(5)));
  if (e.code === 'KeyF') { state.mode = 'game'; state.follow = true; applyLayers(); }
  if (e.code === 'KeyC') { if (state.mode === 'cine') { state.mode = 'game'; state.follow = true; applyLayers(); } else setCine(); }
  if (e.code === 'KeyR') { setRingOn(!state.ringOn); syncToggles(); }
  if (e.code === 'KeyM') { setMarks(!state.marks); syncToggles(); }
});
addEventListener('keyup', (e) => { keys.delete(e.code); });
addEventListener('blur', () => keys.clear());

// ---------------------------------------------------------------------------
// Klatka
const cullInfo = { x: 0, y: 0, drawHalfW: 0, drawHalfH: 0, halfW: 0, halfH: 0 };
const TICK = { daylight: 0.35, lampPower: 1.15 };
const SUN_OPTS = { sun: window.SUN, at: P0 };
let lastInfo = { calls: 0, triangles: 0 };

function simulate(dt) {
  state.T += dt;
  stepPlayer(dt);
  for (const p of parts) if (p.built.step) p.built.step(dt * state.speed, p.api);
  if (state.mode === 'game' && state.follow) {
    const tx = P0.x + player.x + player.vx * 0.55;
    const ty = P0.y + player.z + player.vz * 0.55;
    const k = 1 - Math.exp(-4.5 * dt);
    state.cam.x += (tx - state.cam.x) * k;
    state.cam.y += (ty - state.cam.y) * k;
  }
}

const portSun = { dir: null, daylight: 1 };
function pushDrones(cam) {
  portSun.dir = B.list[0].uniforms.uSunDirW.value;
  if (state.mode === 'cine') {
    const p = cine.persp.position;
    const d = p.distanceTo(cine.target);
    CargoContainers3D.begin({
      camera: { x: p.x, y: -p.y, zoom: 1 }, origin: { x: p.x, y: p.y }, perspective: true,
      pxPerUnit: (Hh * 0.5) / Math.tan(21 * DEG) / Math.max(1, d), sun: window.SUN, portSun, time: state.T
    });
  } else {
    CargoContainers3D.begin({
      camera: cam, cameraHeight: (Hh / 2) / Math.tan(Core3D.cameraPersp.fov * 0.5 * DEG) / cam.zoom, pxPerUnit: cam.zoom,
      viewHalfW: (W / 2) / cam.zoom, viewHalfH: (Hh / 2) / cam.zoom, sun: window.SUN, portSun, time: state.T
    });
  }
  CargoDrones3D.begin({ camera3: state.mode === 'cine' ? cine.persp : Core3D.cameraPersp });
  droneCount = 0;
  for (const p of parts) if (p.built.drones) p.built.drones(p.api);
  CargoContainers3D.end();
  CargoDrones3D.end();
}

function render(realDt, simDt) {
  const cam = state.mode === 'cine' ? cineCamera() : state.cam;
  for (const b of B.list) {
    b.setSun(SUN_OPTS);
    b.tick(simDt, TICK);
  }
  // lampy stanu doków: zielona = wolne (statek w doku albo Atlas na polu → czerwona)
  for (const b of B.status) {
    const occ = b.part ? b.part.occupied : null;
    for (const st of b.scene.rig.status) {
      const mine = where.part === b.part && where.pit && where.pit.berth && where.pit.berth.id === st.berthId;
      b._setChan(st.ch, (occ && occ.has(st.berthId)) || mine ? 0 : 1);
    }
  }
  const hull = player.polygon();
  for (const b of B.roofs) {
    const fade = b.roofFadeModel.update(hull, realDt, realDt <= 0);
    b._applyRoofFade(state.roofsOff ? 1 : fade);
  }

  proxies.length = 0;
  for (const t of tworzywa) t.recorder.begin();
  for (const p of parts) if (p.built.frame) p.built.frame(p.api);
  for (const t of tworzywa) t.view.commit();
  ShipProxyBatch3D.begin(cam);
  if (state.showShips) for (const p of parked) ShipProxyBatch3D.push(p.id, p.hullId, p.x, p.y, p.angle);
  for (const p of proxies) ShipProxyBatch3D.push(p.id, p.hullId, p.x, p.y, p.angle, p);
  ShipProxyBatch3D.end();
  placePlayer();
  pushDrones(cam);

  const zoom = state.mode === 'cine' ? 1 : cam.zoom;
  cullInfo.x = cam.x;
  cullInfo.y = cam.y;
  cullInfo.drawHalfW = W * 0.5 / zoom + 600;
  cullInfo.drawHalfH = Hh * 0.5 / zoom + 600;
  cullInfo.halfW = cullInfo.drawHalfW * 3;
  cullInfo.halfH = cullInfo.drawHalfH * 3;
  // ring z gry (Ziemia, ring, hale) z kamerą TEJ klatki; zastępczy pas ściany tylko, gdy prawdziwego ringu nie widać
  if (gameRing) gameRing.frame(realDt, cam, simDt);
  if (bandBuilding) bandBuilding.root.visible = !gameRingShown();
  if (gameRingShown() && !pylonBuilding) { buildPylons(); ringCuts(); }
  if (pylonBuilding) pylonBuilding.root.visible = gameRingShown();
  Fx3D.update(simDt);
  updateHexShips3D(cam, ShipProxyBatch3D.engineEntities, cullInfo);
  drawHexShips3D(ctx2d, W, Hh);
  drawRingMarks(cam);
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  lastInfo = { calls: r.calls || 0, triangles: r.triangles || 0 };
}

let lastMs = performance.now();
let hudAt = 0;
function frame(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
  lastMs = now;
  state.fps = state.fps * 0.93 + (realDt > 0 ? 1 / realDt : 60) * 0.07;
  simulate(realDt);
  render(realDt, realDt);
  if (now - hudAt > 120) { hudAt = now; updateHud(); }
}
function loop(now) {
  try { frame(now); } catch (err) { reportError(err.stack || String(err)); }
  if (!shotMode) requestAnimationFrame(loop);
}

const PLACE = { space: 'PRZESTRZEŃ', ring: 'RING', road: 'DROGA', pit: 'DOK', drydock: 'SUCHY DOK', hangar: 'HANGAR' };
function updateHud() {
  const speed = Math.hypot(player.vx, player.vz);
  const p = where.part;
  const labels = p ? { ...PLACE, district: String(p.plugin.name).toUpperCase(), ...(p.layout.placeLabels || {}) } : PLACE;
  let place = labels[where.place] || String(where.place || '').toUpperCase();
  if (where.pit) place += ` ${where.pit.id.split('-').pop()}`;
  if (MULTI && p && where.place !== 'space') place = `${String(p.plugin.name).toUpperCase()} · ${place}`;
  const camLine = state.mode === 'cine' ? 'kino z ukosa (C — wróć)' : state.follow ? 'za statkiem' : 'swobodna (F — za statkiem)';
  const lines = [
    `<span class="place">${place}</span>`,
    `<b>prędkość</b> ${speed.toFixed(0).padStart(4)} j./s   <b>kamera</b> ${camLine}`,
    `<b>FPS</b> ${state.fps.toFixed(0).padStart(3)}   <b>rysunki</b> ${lastInfo.calls}   <b>zoom</b> ${state.cam.zoom.toFixed(3)}   <b>tempo</b> ×${state.speed}`
  ];
  // wiersz dzielnicy, w której jest Atlas (albo jedynej)
  if (state.ringOn) lines.push(`<b>ring z gry</b> ${!gameRing ? 'ładowanie…' : gameRing.ready ? `gotowy, ${gameRing.rings.stats.updateMs.toFixed(1)} ms CPU` : 'budowa (mapy, bryły)…'}`);
  const q = p || (MULTI ? null : parts[0]);
  const extra = q && q.built.hud ? q.built.hud(q.api) : '';
  if (extra) lines.push(extra);
  $('hud').innerHTML = lines.join('\n');
}

// ---------------------------------------------------------------------------
// API zrzutów i narzędzi
window.__dzielnica = {
  ready: false,
  id: wanted,
  get errors() { return errors.slice(); },
  view(i) { applyView(i); const v = VIEWS.find((q) => q.key === i); return v ? `${v.name}${v.caption ? ' — ' + v.caption : ''}` : undefined; },
  views: () => VIEWS.map((v) => `${v.key} · ${v.name}`),
  districts: () => parts.map((p) => ({ id: p.id, name: p.plugin.name, sMin: Math.round(p.sMin), sMax: Math.round(p.sMax) })),
  roofs(off) { state.roofsOff = !!off; },
  /** Ring z gry: włącz / wyłącz (bez argumentu — stan), raport dopasowania i elementów pod dzielnicami. */
  ringOn(v) { if (v !== undefined) { setRingOn(v); syncToggles(); } return { on: state.ringOn, ready: !!gameRing?.ready }; },
  ringReport: () => (gameRing ? {
    ...gameRing.report(parts.map((p) => ({ id: p.id, sMin: p.sMin, sMax: p.sMax }))), pylons: pylonList.map(Math.round),
    passages: PASSAGES.map((pl) => ({ name: pl.name, s: Math.round(pl.sT), rowCut: pl.rowCut.map(Math.round), under: parts.filter((p) => pl.sT > p.sMin && pl.sT < p.sMax).map((p) => p.id) })),
    passageDropped: passageDropped.slice(), passageRemovedInstances: passageRemoved
  } : null),
  /** Teleport Atlasa do przejścia tranzytu (i = 0, 1): na drodze przed wylotem, dziobem ku tranzytowi. */
  passage(i = 0, zoom = 0.16) { const pl = PASSAGES[i]; if (!pl) return null; goto(pl.sT, ring.merged.v.road - 650, yardRadial(pl.sT) + Math.PI, zoom); return pl.name; },
  marks(on) { setMarks(on); syncToggles(); },
  get gameRing() { return gameRing; },
  speed(k) { setSpeed(k); },
  ships(on) { state.showShips = !!on; },
  teleport(s, v, heading, zoom = state.cam.zoom) { goto(s, v, heading, zoom); },
  center(s, v, zoom) { const [x, z] = yardPoint(s, v); centerXZ(x, z, zoom); },
  centerXZ,
  /** Kino; s, v — punkt łuku, wokół którego krąży kamera (bez nich — Atlas). */
  cine(az, el, dist, s, v = 0) { setCine(Number.isFinite(s) ? yardPoint(s, v) : null); if (Number.isFinite(az)) cine.az = az; if (Number.isFinite(el)) cine.el = el; if (Number.isFinite(dist)) cine.dist = dist; },
  key(code, down) { if (down) keys.add(code); else keys.delete(code); },
  simulate(seconds, step = 1 / 60) { const n = Math.round(seconds / step); for (let i = 0; i < n; i++) simulate(step); },
  renderFrames(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { simulate(dt); render(dt, dt); } updateHud(); return { ...lastInfo }; },
  /** Zapis kanwy jako obraz (data URL) — do zrzutów bez widocznego panelu przeglądarki. */
  snapshot(type = 'image/jpeg', quality = 0.9) { render(1 / 60, 0); return canvas2d.toDataURL(type, quality); },
  stats() {
    return {
      ...lastInfo,
      place: where.place, part: where.part?.id || null, pit: where.pit?.id || null, inside,
      player: { x: player.x, z: player.z, angle: player.angle, speed: Math.hypot(player.vx, player.vz) },
      proxies: { ...ShipProxyBatch3D.stats }, moving: proxies.length, drones: droneCount,
      buildings: B.list.map((b) => ({ name: b.root.name, drawCalls: b.drawCalls, instances: b.scene.instances })),
      parked: parked.length, solids: ring.solids.length,
      district: Object.fromEntries(parts.filter((p) => p.built.stats).map((p) => [p.id, p.built.stats(p.api)])),
      errors: errors.slice()
    };
  },
  ring, parts, B, player, state,
  get layout() { return parts[0].layout; },
  get api() { return parts[0].api; }
};

// ---------------------------------------------------------------------------
// Start
if (!(await Core3D.ready)) {
  reportError(`WebGPU: ${Core3D.gpuError || 'brak urządzenia — demo wymaga przeglądarki z WebGPU'}`);
  throw new Error('WebGPU niedostępne');
}
if (state.ringOn) await ensureGameRing();
buildWorld();
setSpeed(1);
{ const p = startPose(); const [x, z] = yardPoint(p.s, p.v); teleport(x, z, p.heading); }
applyView(Math.max(1, Math.min(9, Number(params.get('view')) || 1)));
if (params.has('zoom')) state.cam.zoom = Number(params.get('zoom'));
function texturesReady() {
  return !!atlasTex.image && atlasTex.image.complete !== false && (atlasTex.image.width || atlasTex.image.naturalWidth);
}
if (shotMode) {
  const wait = () => {
    render(1 / 60, 0);
    if (texturesReady() && ShipProxyBatch3D.stats.waitingImage === 0 && (!state.ringOn || gameRing?.ready || errors.length)) {
      window.__dzielnica.renderFrames(3);
      window.__dzielnica.ready = true;
    } else setTimeout(wait, 60);
  };
  wait();
} else {
  window.__dzielnica.ready = true;
  requestAnimationFrame(loop);
}
