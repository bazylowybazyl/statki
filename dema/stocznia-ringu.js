// Demo: port przy ringu z DROGĄ w środku i STOCZNIĄ (koncept, 2026-11-12) — jeden kompleks portu Ziemi dociśnięty
// do ringu: ściana ringu | rząd doków | droga nad kręgosłupem z rurami | rząd zewnętrzny. Hala K-7 przebudowana na
// WJAZD (dwa pasy, wyspa), okręty wojskowe w ogromnym SUCHYM DOKU FLOTY z wylotem na drogę, na lewym końcu STOCZNIA:
// hala z dokami refitu, a za nią część budowy — Ziemia: ULICA z kratownicą od drogi ringu, obiegająca TRÓJKĄTNY SUCHY
// DOK z pochylniami, zamknięta od zewnątrz budowlami (gotowe kadłuby jadą kratownicą do doków, surowce przywożą
// statki); Jowisz: fabryka taśmowa (krótkie linie taktowe z drukarką-bramownicą). Lot Atlasem 1:1 z kolizjami.
// Serwowanie: `npm run dev`, potem /dema/stocznia-ringu.html (?view=1…9, ?shot=1 — bez panelu, do zrzutów).
//
// Prawdziwy potok renderu gry: Core3D (tło → świat ortho → FG, bloom, ACES) przez initHexShips3D / updateHexShips3D /
// drawHexShips3D; budowle zestawem portowym (PortBuilding3D — te same materiały co doki portów), statki w dokach jako
// proxy ruchu v2 (ShipProxyBatch3D). Geometria i kolizje: dema/stocznia-ringu/layout.js, bryły: scene.js.
// Ściana ringu to bryła zastępcza; statki w dokach stoją, ruch pokazuje tylko stocznia (kadłuby na kratownicy,
// statki dostaw na ulicy).
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
import {
  YARD_PLACE_LABEL, YARD_TODAY, YARD_TRI, buildYardRingLayout, yardLocate, yardPoint, yardRadial, yardTangent
} from './stocznia-ringu/layout.js';
import {
  buildBandScene, buildBasinScene, buildGateScene, buildHangarRoofScene, buildInnerRowScene, buildOuterRowScene, buildRoadScene,
  buildYardLinesScene, buildYardScene
} from './stocznia-ringu/scene.js';
import { buildYardStreetScene, buildYardTriScene } from './stocznia-ringu/sceneTri.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
if (shotMode) document.body.classList.add('shot');
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
// Wariant stoczni: Ziemia — ulica z kratownicą wokół trójkątnego suchego doku (żurawie i drony, zamknięta od
// zewnątrz); Jowisz — fabryka taśmowa (krótkie linie taktowe z drukarką-bramownicą). Przełącznik na panelu
// przeładowuje stronę z ?stocznia=.
const yardKind = params.get('stocznia') === 'jowisz' ? 'jupiter' : 'earth';

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
// Drony przeładunkowe gry (Z5) jako rój stoczni: bryły w passie świata, światła w FG.
CargoContainers3D.attach(Core3D.scene);
CargoDrones3D.attach(Core3D.scene);
addEventListener('resize', () => {
  W = canvas2d.width = innerWidth;
  Hh = canvas2d.height = innerHeight;
  resizeHexShips3D(W, Hh);
});

// Środek kompleksu (krawędź ścian ringu w osi wjazdu) daleko od zera — precyzja float32 jak w grze.
const P0 = Object.freeze({ x: 7_080_000, y: 6_290_000 });
// Słońce gry: w lewo i lekko od strony przestrzeni.
window.SUN = { x: P0.x - 1_150_000, y: P0.y + 420_000, r: 2600 };
const toGame = (x, z, out = {}) => { out.x = P0.x + x; out.y = P0.y + z; return out; };

// Tło: gwiazdy na warstwie 1 (pass tła).
(function addStars() {
  const n = 3200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P0.x + (rnd() - 0.5) * 700000;
    pos[i * 3 + 1] = -P0.y + (rnd() - 0.5) * 460000;
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
host.name = 'PortPrzyRingu (gospodarz)';
host.position.set(P0.x, -P0.y, 0);
Core3D.scene.add(host);
const LAYER_BG = 1;
const LAYER_FG = 2;
// Ramka budowli: x lokalne = +X sceny, z lokalne = −Y sceny (= +y gry, w dół ekranu) — układ lokalny = przesunięcie gry.
const FRAME = portModuleFrame(0, 0, -Math.PI / 2);

const state = {
  showShips: true,
  roofsOff: false,
  cam: { x: P0.x, y: P0.y + 2200, zoom: 0.05 },
  follow: false,
  mode: 'game',               // game | cine
  view: 1,
  fps: 60,
  T: 0
};

// ---------------------------------------------------------------------------
// Układ, kolizje, statki w dokach
const style = resolvePortBuildingStyle('earth');
const layout = buildYardRingLayout({ yard: yardKind });
const collision = new K7CollisionWorld();
for (const s of layout.solids) collision.addPolygon(s.id, s.points.map(([x, z]) => ({ x, z })), 0, 150);

// Statki stoją; ziarno z położenia — ten sam obraz przy każdym otwarciu. Suchy dok floty: okręty Terra Novy.
const CIVIL = {
  s: ['inter_station_shuttle', 'belter', 'police_cutter', 'crew_shuttle'],
  m: ['container_ship', 'heavy_harvester', 'rescue_ship', 'crew_liner'],
  l: ['long_haul_freighter', 'tanker', 'refinery_tender', 'colony_liner']
};
const NAVY = { s: 'terran_frigate', m: 'terran_destroyer', l: 'terran_battleship', carrier: 'terran_carrier' };
const FIXED = {
  'OR-D1': 'heavy_freighter', 'OL-MG1': 'megafreighter', 'OR-MG1': 'megafreighter', 'B-MG1': 'megafreighter',
  'B-C1': 'terran_carrier', 'YH-R1': 'heavy_freighter', 'YH-R3': 'terran_carrier'
};
// doki refitu stoczni: okręty floty i statki cywilne na zmianę
const REFIT = {
  s: ['terran_frigate', 'inter_station_shuttle', 'police_cutter'],
  m: ['terran_destroyer', 'container_ship', 'heavy_harvester'],
  l: ['terran_battleship', 'long_haul_freighter', 'tanker']
};
// doki dostaw przy ulicy stoczni: frachtowce z surowcami (bez taśm — surowce przywożą statki)
const SUPPLY = {
  m: ['container_ship', 'heavy_harvester', 'container_ship'],
  l: ['long_haul_freighter', 'tanker', 'refinery_tender']
};
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const parked = [];
const occupied = new Set();
for (const b of layout.berths) {
  let hullId = FIXED[b.id] || null;
  if (!hullId && b.navy && b.cls !== 'capital') hullId = hash(b.s * 0.017 + b.v * 0.05) < 0.86 ? NAVY[b.cls] : null;
  const yardPool = b.zone === 'YT' ? SUPPLY : REFIT;
  if (!hullId && b.yard && yardPool[b.cls]) hullId = hash(b.s * 0.019 + b.v * 0.03) < 0.6 ? yardPool[b.cls][Math.floor(hash(b.s * 0.037 + 1.5) * yardPool[b.cls].length)] : null;
  if (!hullId && !b.navy && !b.yard && CIVIL[b.cls]) hullId = hash(b.s * 0.013 + b.v * 0.07) < 0.62 ? CIVIL[b.cls][Math.floor(hash(b.s * 0.031 + 2.5) * CIVIL[b.cls].length)] : null;
  if (!hullId) continue;
  const g = toGame(b.x, b.z);
  parked.push({ id: `p-${b.id}`, hullId, x: g.x, y: g.y, angle: b.heading, berth: b });
  occupied.add(b.id);
}

// ---------------------------------------------------------------------------
// Budowle
const B = { list: [], status: [], roofs: [] };
function mk(scene, name) {
  const b = new PortBuilding3D({ layout: { id: name }, scene, style, frame: FRAME, name });
  host.add(b.root);
  B.list.push(b);
  if (scene.rig?.status?.length) B.status.push(b);
  return b;
}
function buildWorld() {
  mk(buildBandScene(layout, style), 'Ściana ringu');
  mk(buildInnerRowScene(layout, style, { occupied }), 'Rząd przy ringu');
  mk(buildOuterRowScene(layout, 'OL', style, { occupied }), 'Doki cywilne (lewe)');
  mk(buildOuterRowScene(layout, 'OR', style, { occupied }), 'Doki cywilne (prawe)');
  mk(buildGateScene(layout, style), 'Wjazd K-7');
  mk(buildBasinScene(layout, style, { occupied }), 'Suchy dok floty');
  mk(buildRoadScene(layout, style), 'Droga i kręgosłup');
  mk(buildYardScene(layout, style, { occupied }), 'Hala stoczni');
  if (layout.yard.tri) initTri(mk(buildYardTriScene(layout, style, { occupied }), 'Stocznia: suchy dok'), mk(buildYardStreetScene(layout, style), 'Stocznia: ulica i kratownica'));
  else initYard(mk(buildYardLinesScene(layout, style), 'Linie budowy'));
  for (const pit of layout.pits) {
    if (pit.kind !== 'hangar') continue;
    const b = mk(buildHangarRoofScene(layout, pit, style), `Dach hangaru ${pit.id}`);
    b.roofFadeModel = new K7RoofFade([[pit.s0, pit.v0], [pit.s1, pit.v0], [pit.s1, pit.v1], [pit.s0, pit.v1]].map(([s, v]) => { const p = yardPoint(s, v); return { x: p[0], z: p[1] }; }));
    B.roofs.push(b);
  }
  applyLayers();
}
function applyLayers() {
  const fg = state.mode === 'cine' ? LAYER_BG : LAYER_FG;
  for (const b of B.list) b.setLayers(LAYER_BG, fg);
  // wolna kamera: drony z budowlami na jednej warstwie (wspólna głębia)
  const cineOn = state.mode === 'cine';
  CargoContainers3D.setLayer(cineOn ? LAYER_BG : 0);
  CargoDrones3D.setLayers(cineOn ? LAYER_BG : 0, cineOn ? LAYER_BG : LAYER_FG);
}

// ---------------------------------------------------------------------------
// Stocznia: linia taktowa. Na stanowisku przy hali drukarka-bramownica stawia szkielet, potem co takt kadłub przesuwa
// się o stanowisko dalej (poszycie, wyposażenie); z ostatniego stanowiska gotowy okręt odlatuje w przestrzeń.
// Kadłuby w budowie rysuje moduł zestawu portowego (PortHullBuild3D: stępka → wręgi → poszycie → malowanie, iskry
// przy czole budowy), gotowe okręty — proxy ruchu.

/** Kadłub w budowie na linii: czworokąt wzdłuż osi linii (dziób w przestrzeń), środek przesuwany co klatkę. */
class YardHull extends PortHullBuild3D {
  /** `frame` — { at(wzdłuż, w poprzek) → [x, z] } (linia budowy albo pochylnia doku), `key` — ziarno. */
  constructor(building, frame, key, along = 0) {
    super({ slip: { x: 0, z: 0, index: key, id: `kadlub-${key}`, padLength: 100, padBeam: 100 }, building });
    this.line = frame;
    this.along = along;
    this.mesh.frustumCulled = false;
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
    // (u, v): (0,0) rufa-prawa burta, (1,0) dziób-prawa, (1,1) dziób-lewa, (0,1) rufa-lewa — jak w module bazowym
    const put = (i, along, across) => { const q = L.at(along, across); p[i] = q[0]; p[i + 1] = y; p[i + 2] = q[1]; };
    put(0, this.along - hl, -hb);
    put(3, this.along + hl, -hb);
    put(6, this.along + hl, hb);
    put(9, this.along - hl, hb);
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

const YARD = { speed: 1, building: null, lines: [], launched: [], proxies: [], building3d: null };

// --- Stocznia Ziemi „zamknięta”: kadłuby rosną na pochylniach przy bokach trójkątnego suchego doku; budują je żurawie
// na pomostach (obrót: nad skład części ↔ nad kadłub) i rój dronów (renderer dronów gry — CargoDrones3D). Gotowy
// kadłub dostaje wózek, wyjeżdża dziobem na kratownicę ulicy i jedzie nią przez skrzyżowanie na drogę ringu, ku dokom
// (jedna prędkość, wyjazd tylko w wolne okno — kadłuby nie spotykają się na skrzyżowaniu); pochylnia dostaje nową
// stępkę. Surowców nie wozi taśma: statki dostaw wlatują z drogi ringu, objeżdżają dok pasem zewnętrznym i wracają.
const TRI = { dock: null, street: null, slips: [], cranes: [], transports: [], sledFree: [], sledAll: [], supply: [], t: 0, drones: 0, cranesBusy: 0, ready: 0, done: 0 };
const READY_S = 10;                // gotowy kadłub stoi na pochylni co najmniej tyle [s przy tempie ×1]
const GAP_S = 8;                   // pusta pochylnia przed położeniem następnej stępki
const DRONE_SIZE = { L: 46, W: 40, H: 13 };
const SUPPLY_HULLS = ['container_ship', 'long_haul_freighter', 'tanker', 'heavy_harvester', 'refinery_tender', 'container_ship', 'long_haul_freighter'];
const droneRec = new Float32Array(CARGO_DRONE_STRIDE);
const dronePose = { x: 0, y: 0, angle: 0 };
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _o = {};
function initTri(dock, street) {
  const Tr = layout.yard.tri;
  TRI.dock = dock;
  TRI.street = street;
  // wózki jadą także drogą ringu, poza bryłami ulicy — budowla ulicy bez odcinania po kuli
  for (const list of Object.values(street.meshes)) for (const m of list) m.frustumCulled = false;
  TRI.sledAll = street.scene.rig.sleds.slice();
  TRI.sledFree = TRI.sledAll.slice();
  const rig = dock.scene.rig;
  for (const sl of Tr.slips) {
    const hull = new YardHull(dock, sl, 300 + sl.index, 0);
    dock.root.add(hull.mesh);
    dock.meshes.bg.push(hull.mesh);
    const drones = [];
    for (let j = 0; j < sl.def.drones; j++) {
      drones.push({ seed: hash(sl.index * 7.3 + j * 2.1), period: 5 + 3 * hash(sl.index * 1.3 + j * 5.7), u: hash(j * 3.3 + sl.index), v: hash(j * 9.1 + sl.index * 0.7) });
    }
    // skład części w układzie pochylni (wzdłuż osi, w poprzek) — stamtąd przylatują drony
    const dx = sl.crane.pickX - sl.cx;
    const dz = sl.crane.pickZ - sl.cz;
    const rec = {
      sl, hull, drones, phase: 'build', t: sl.def.build * hash(sl.index * 2.9 + 0.4), n: 0, hullId: null, len: 0, beam: 0, progress: 0, sled: -1,
      pickAl: dx * sl.ax + dz * sl.az, pickAc: dx * sl.az - dz * sl.ax,
      ch: rig.slipStatus.find((r) => r.index === sl.index).ch
    };
    TRI.slips.push(rec);
    TRI.cranes.push({
      c: sl.crane, rec, group: rig.cranes.find((r) => r.index === sl.index).group, theta: Math.PI / 2,
      period: 8 + 4 * hash(sl.index * 4.1), phase: hash(sl.index * 6.7)
    });
  }
  const n = SUPPLY_HULLS.length;
  const span = Tr.supply.len + 6000;
  for (let i = 0; i < n; i++) TRI.supply.push({ id: `dostawa-${i}`, hullId: SUPPLY_HULLS[i], off: (span * i) / n + 900 * hash(i * 3.1) });
}
function triHullOf(rec) {
  const def = rec.sl.def;
  return def.hulls[mod(rec.n + rec.sl.k, def.hulls.length)];
}
/** Wolne okno na kratownicy: nikt nie dojedzie do skrzyżowania w tym samym czasie co kadłub z tej pochylni. */
function trussFree(rec, len) {
  for (const tr of TRI.transports) {
    const rem = tr.rec.sl.toJunction - tr.d;
    if (Math.abs(rem - rec.sl.toJunction) < (tr.len + len) / 2 + 700) return false;
  }
  return true;
}
function stepTri(k) {
  if (!TRI.dock) return;
  TRI.t += k;
  for (const rec of TRI.slips) {
    const def = rec.sl.def;
    rec.t += k;
    if (rec.phase === 'build') {
      if (rec.t >= def.build) { rec.phase = 'ready'; rec.t = 0; }
    } else if (rec.phase === 'ready') {
      if (rec.sled < 0 && TRI.sledFree.length) rec.sled = TRI.sledFree.pop();
      const hullId = triHullOf(rec);
      const size = trafficHullRenderSize(hullId);
      const len = size?.w || def.len * 0.8;
      if (rec.t >= READY_S && rec.sled >= 0 && trussFree(rec, len)) {
        TRI.transports.push({ id: `yt-${rec.sl.index}-${rec.n}`, hullId, rec, d: 0, v: 0, len, beam: size?.h || def.w * 0.6, sled: rec.sled });
        rec.sled = -1;
        rec.phase = 'gap';
        rec.t = 0;
      }
    } else if (rec.t >= GAP_S) {
      rec.phase = 'build';
      rec.t = 0;
      rec.n++;
    }
  }
  for (const tr of TRI.transports) {
    tr.v = Math.min(YARD_TRI.speed, tr.v + 50 * k);
    tr.d += tr.v * k;
  }
  for (let i = TRI.transports.length - 1; i >= 0; i--) {
    const tr = TRI.transports[i];
    if (tr.d < tr.rec.sl.route.len) continue;
    TRI.sledFree.push(tr.sled);
    TRI.transports.splice(i, 1);
    TRI.done++;
  }
}
/** Wózek pod kadłubem: przesunięcie · obrót (kurs) · skala (długość, 1, szerokość). */
function placeSled(Mx, x, z, heading, len, beam) {
  Mx.makeRotationY(-heading);
  Mx.scale(_v3.set(len + 140, 1, beam + 110));
  Mx.setPosition(x, 0, z);
}
/** Stan stoczni tej klatki: kadłuby na pochylniach, żurawie, wózki, kadłuby na kratownicy i statki dostaw jako proxy. */
function renderTri() {
  const Gd = TRI.dock.uniforms.uGroup.value;
  const Gs = TRI.street.uniforms.uGroup.value;
  for (const g of TRI.sledAll) Gs[g].elements[15] = 0;
  let building = 0;
  let ready = 0;
  for (const rec of TRI.slips) {
    const sl = rec.sl;
    const def = sl.def;
    const hullId = triHullOf(rec);
    const size = trafficHullRenderSize(hullId);
    rec.hullId = hullId;
    rec.len = size?.w || def.len * 0.8;
    rec.beam = size?.h || def.w * 0.6;
    if (rec.phase === 'build') {
      rec.progress = Math.min(1, rec.t / def.build);
      rec.hull.setState({ hullId, progress: rec.progress, seed: mod(rec.n, 89) * 3.7 + sl.index }, state.T);
      building++;
    } else {
      rec.hull.setState(null);
      if (rec.phase === 'ready') {
        ready++;
        YARD.proxies.push({ id: `yt-${sl.index}-${rec.n}`, hullId, x: P0.x + sl.cx, y: P0.y + sl.cz, angle: sl.heading, vx: 0, vy: 0, throttle: 0, opacity: 1 });
        if (rec.sled >= 0) placeSled(Gs[rec.sled], sl.cx, sl.cz, sl.heading, rec.len, rec.beam);
      }
    }
    TRI.dock._setChan(rec.ch, rec.phase === 'ready' ? 1 : 0);
  }
  // kadłuby na kratownicy: pochylnia → obwodnica → skrzyżowanie → droga ringu ku dokom (na końcu trasy znikają)
  for (const tr of TRI.transports) {
    const R = tr.rec.sl.route;
    R.at(tr.d, _o);
    const fade = Math.max(0, Math.min(1, (R.len - tr.d) / 1500));
    YARD.proxies.push({ id: tr.id, hullId: tr.hullId, x: P0.x + _o.x, y: P0.y + _o.z, angle: _o.h, vx: 0, vy: 0, throttle: 0, opacity: fade });
    if (fade > 0.03) placeSled(Gs[tr.sled], _o.x, _o.z, _o.h, tr.len, tr.beam);
  }
  // statki dostaw: droga ringu → ulica → pas zewnętrzny dookoła doku → ulica → droga ringu
  const S = layout.yard.tri.supply;
  const span = S.len + 6000;
  for (const sh of TRI.supply) {
    const d = mod(TRI.t * YARD_TRI.supplySpeed + sh.off, span);
    if (d >= S.len) continue;
    S.at(d, _o);
    const fade = Math.max(0, Math.min(1, d / 1500, (S.len - d) / 1500));
    YARD.proxies.push({
      id: sh.id, hullId: sh.hullId, x: P0.x + _o.x, y: P0.y + _o.z, angle: _o.h,
      vx: Math.cos(_o.h) * YARD_TRI.supplySpeed, vy: Math.sin(_o.h) * YARD_TRI.supplySpeed, throttle: 0.5, opacity: fade
    });
  }
  // żurawie: pracują, gdy ich pochylnia buduje; inaczej stoją nad składem części
  let busy = 0;
  for (const cr of TRI.cranes) {
    const active = cr.rec.phase === 'build' && cr.rec.progress < 0.985;
    if (active) {
      busy++;
      const u = (TRI.t / cr.period + cr.phase) % 1;
      cr.theta = u < 0.15 ? Math.PI / 2 : u < 0.45 ? (Math.PI / 2) * (1 - smooth((u - 0.15) / 0.3)) : u < 0.65 ? 0 : (Math.PI / 2) * smooth((u - 0.65) / 0.35);
    } else {
      cr.theta += (Math.PI / 2 - cr.theta) * 0.08;
    }
    _m4.makeRotationY(cr.theta * cr.c.pickSign);
    const e = _m4.elements;
    const px = cr.c.px;
    const pz = cr.c.pz;
    _m4.setPosition(px - (e[0] * px + e[8] * pz), 0, pz - (e[2] * px + e[10] * pz));
    Gd[cr.group].copy(_m4);
  }
  YARD.inBuild = building;
  TRI.ready = ready;
  TRI.cranesBusy = busy;
}
/** Rój dronów przy budowanych kadłubach: skład części → czoło budowy → powrót (po CargoDrones3D.begin). */
function pushTriDrones() {
  let n = 0;
  const R = droneRec;
  for (const rec of TRI.slips) {
    if (rec.phase !== 'build' || rec.progress > 0.99) continue;
    const sl = rec.sl;
    dronePose.x = P0.x + sl.cx;
    dronePose.y = P0.y + sl.cz;
    dronePose.angle = sl.heading;
    const front = hullBuildFront(Math.min(0.999, rec.progress));
    for (const d of rec.drones) {
      const u = (TRI.t / d.period + d.seed) % 1;
      const alS = rec.pickAl + (d.u - 0.5) * 70;
      const acS = rec.pickAc + (d.v - 0.5) * 70;
      const alW = (front - 0.5) * rec.len + (d.u - 0.5) * Math.min(rec.len * 0.3, 160);
      const acW = (d.v - 0.5) * rec.beam * 0.8;
      let k = 1;
      let out = true;
      if (u < 0.28) k = smooth(u / 0.28);
      else if (u >= 0.72) { k = 1 - smooth((u - 0.72) / 0.28); out = false; }
      const moving = k > 0.001 && k < 0.999;
      const dAl = (alW - alS) * (out ? 1 : -1);
      const dAc = (acW - acS) * (out ? 1 : -1);
      const dl = Math.sqrt(dAl * dAl + dAc * dAc) || 1;
      R[CARGO_DRONE.U] = alS + (alW - alS) * k;
      R[CARGO_DRONE.V] = -(acS + (acW - acS) * k);
      R[CARGO_DRONE.Z] = 26 + 34 * (1 - k) + 46 * Math.sin(Math.PI * k) * (moving ? 1 : 0);
      R[CARGO_DRONE.YAW] = Math.atan2(-dAc, dAl);
      R[CARGO_DRONE.CARRY] = out && u < 0.28 ? 1 : 0;
      R[CARGO_DRONE.THRUST] = moving ? 0.75 : 0.32;
      R[CARGO_DRONE.AU] = dAl / dl;
      R[CARGO_DRONE.AV] = -dAc / dl;
      R[CARGO_DRONE.AZ] = 0;
      R[CARGO_DRONE.CLIP] = -1e9;
      R[CARGO_DRONE.DROP] = 0;
      R[CARGO_DRONE.SEED] = d.seed;
      if (CargoDrones3D.pushDrone(dronePose, R, 0, DRONE_SIZE, state.T)) n++;
    }
  }
  TRI.drones = n;
}
const SHIFT_PART = 0.22;           // część taktu na przesuw kadłubów
const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;
function initYard(building) {
  YARD.building = building;
  for (const line of layout.yard.lines) {
    const hulls = [];
    for (let j = 0; j < line.stations - 1; j++) {
      const h = new YardHull(building, line, line.index * 8 + j, line.stationAt(j));
      building.root.add(h.mesh);
      building.meshes.bg.push(h.mesh);
      hulls.push(h);
    }
    const gantries = building.scene.rig.gantries.filter((g) => g.line === line.index);
    YARD.lines.push({ line, hulls, gantries, t: line.takt * (2 + hash(line.index * 3.7)), handed: -1 });
  }
}
function stepYard(dt) {
  const k = dt * YARD.speed;
  stepTri(k);
  for (const rec of YARD.lines) rec.t += k;
  for (const s of YARD.launched) {
    s.v = Math.min(s.vMax, s.v + s.acc * k);
    s.along += s.v * k;
  }
  for (let i = YARD.launched.length - 1; i >= 0; i--) if (YARD.launched[i].along > YARD.launched[i].end) YARD.launched.splice(i, 1);
}
/** Stan linii tej klatki: kadłuby na stanowiskach, bramownice za czołem budowy, gotowe okręty jako proxy. */
function renderYard() {
  YARD.proxies.length = 0;
  if (TRI.dock) { renderTri(); return; }
  const G = YARD.building.uniforms.uGroup.value;
  let building = 0;
  for (const rec of YARD.lines) {
    const L = rec.line;
    const n = L.stations;
    const c = Math.floor(rec.t / L.takt);
    const tau = rec.t - c * L.takt;
    const work = L.takt * (1 - SHIFT_PART);
    const w = Math.min(1, tau / work);
    const sh = tau > work ? smooth((tau - work) / (L.takt - work)) : 0;
    const hullOf = (m) => L.hulls[mod(m, L.hulls.length)];
    for (let j = 0; j < n - 1; j++) {
      const m = c - j;
      const hullId = hullOf(m);
      const progress = (j + w) / (n - 1);
      const hull = rec.hulls[j];
      hull.setState({ hullId, progress, seed: mod(m, 89) * 3.7 }, state.T);
      hull.moveTo(L.stationAt(j) + L.pitch * sh);
      if (progress > 0.002) building++;
      // bramownica: nad czołem budowy; w czasie przesuwu wraca nad rufę następnego kadłuba
      const len = trafficHullRenderSize(hullId)?.w || L.pitch * 0.7;
      const front = sh > 0 ? hullBuildFront(Math.min(0.999, progress)) * (1 - sh) : hullBuildFront(Math.min(0.999, progress));
      const d = (front - 0.5) * len;
      G[rec.gantries[j].group].makeTranslation(L.rx * d, 0, L.rz * d);
    }
    // ostatnie stanowisko: gotowy okręt czeka na odbiór; z początkiem przesuwu odlatuje w przestrzeń
    const mLast = c - (n - 1);
    if (sh > 0 && rec.handed !== c) {
      rec.handed = c;
      const big = L.cls === 'capital' || L.cls === 'carrier';
      YARD.launched.push({ id: `yl-${L.index}-${mLast}`, hullId: hullOf(mLast), line: L, along: L.stationAt(n - 1), v: 0, acc: big ? 70 : 110, vMax: big ? 420 : 620, end: L.len + 9000 });
    }
    if (sh === 0 || rec.handed !== c) {
      const q = L.at(L.stationAt(n - 1), 0);
      YARD.proxies.push({ id: `yl-${L.index}-${mLast}`, hullId: hullOf(mLast), x: P0.x + q[0], y: P0.y + q[1], angle: L.heading, vx: 0, vy: 0, throttle: 0, opacity: 1 });
    }
  }
  for (const s of YARD.launched) {
    const L = s.line;
    const q = L.at(s.along, 0);
    const fade = Math.max(0, Math.min(1, (s.end - s.along) / 2500));
    YARD.proxies.push({ id: s.id, hullId: s.hullId, x: P0.x + q[0], y: P0.y + q[1], angle: L.heading, vx: L.rx * s.v, vy: L.rz * s.v, throttle: s.v < s.vMax ? 0.9 : 0.5, opacity: fade });
  }
  YARD.inBuild = building;
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
// dysze MAIN na rufie (4) i dysze wsteczne przy dziobie (2): [x, y] w ułamkach kadłuba, kierunek płomienia
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
    yardLocate(layout, player.x, player.z, where);
    inside += (where.inside - inside) * (1 - Math.exp(-3 * STEP));
    player.step(STEP, inside);
    accumulator -= STEP;
  }
  yardLocate(layout, player.x, player.z, where);
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
    // środek płomienia: od dyszy w stronę `dir` wzdłuż osi kadłuba
    const lx = u * K7_ATLAS.w + dir * len * 0.5;
    const ly = v * K7_ATLAS.h;
    mesh.position.set(gx + lx * c - ly * s, -(gy + lx * s + ly * c), 1);
    // tekstura: jasny koniec przy +x płaszczyzny — przy dyszy
    mesh.rotation.set(0, 0, -player.angle + (dir < 0 ? 0 : Math.PI));
    mesh.scale.set(len, wid, 1);
  });
}

// ---------------------------------------------------------------------------
// Miejsca (widoki): teleport Atlasa i kadr
const V = layout.v;
const pitById = (id) => layout.pits.find((p) => p.id === id);
function goto(s, v, heading, zoom) {
  const [x, z] = yardPoint(s, v);
  gotoXZ(x, z, heading, zoom);
}
/** Kadr swobodny obejmujący punkty (układ lokalny kompleksu), obok panelu. */
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
  // panel 320 px z prawej; przy zrzutach panelu nie ma
  const panel = shotMode ? 0 : 350;
  const zoom = Math.max(0.006, Math.min((Math.max(W, 640) - panel) / ((x1 - x0) * k), Math.max(Hh, 360) / ((z1 - z0) * k)));
  state.mode = 'game';
  state.follow = false;
  state.cam.zoom = zoom;
  state.cam.x = P0.x + (x0 + x1) / 2 + panel / 2 / zoom;
  state.cam.y = P0.y + (z0 + z1) / 2;
  applyLayers();
}
function gotoXZ(x, z, heading, zoom) {
  teleport(x, z, heading);
  state.mode = 'game';
  state.follow = true;
  state.cam.zoom = zoom;
  state.cam.x = P0.x + x;
  state.cam.y = P0.y + z;
  applyLayers();
}
const startPose = () => ({ s: layout.gate.laneIn.s, v: V.outer1 + 4200 });
const VIEWS = [
  { key: 1, name: 'Cały kompleks', sub: 'ring, rząd doków, droga, wjazd K-7, suchy dok floty', caption: 'Wszystko dociśnięte do ringu, bez szpar: do drogi wchodzi się wjazdem K-7 w środku, wyloty są na końcach',
    apply: () => {
      const pts = [];
      for (const q of layout.solids) if (q.zone !== 'RING') for (const pt of q.points) pts.push(pt);
      frameBox(pts, 1.06);
    } },
  { key: 2, name: 'Wjazd K-7', sub: 'brama z dwoma pasami i wyspą — wlot do drogi', caption: 'Wjazd K-7: prawy pas WJAZD (zielony), lewy WYJAZD (bursztynowy), wyspa ze sterownią, za bramą droga w lewo i w prawo',
    apply: () => { const p = startPose(); goto(p.s, p.v, yardRadial(p.s) + Math.PI, 0.17); } },
  { key: 3, name: 'Droga', sub: 'środek nad kręgosłupem z rurami, doki po obu stronach', caption: 'Droga 2600 j. (dwa pasy): przy ringu wnęki S / M / L, po stronie przestrzeni doki L, suche doki i hangary',
    apply: () => { goto(-2600, V.road - 650, yardTangent(-2600) + Math.PI, 0.2); } },
  { key: 4, name: 'Suchy dok floty', sub: 'basen wojskowy: capital, nosiciele, krążowniki, niszczyciele, fregaty', caption: 'Suchy dok floty: wylot z drogi, plac manewrowy, przy ścianie tylnej stanowiska capital (domowe Atlasa w osi) i nosicieli',
    apply: () => { const b = layout.basin; goto(b.mouthC, b.front1 + 500, yardRadial(b.mouthC), 0.115); } },
  yardKind === 'earth'
    ? { key: 5, name: 'Stocznia: suchy dok', sub: 'ulica z kratownicą od drogi ringu obiega trójkątny dok; z zewnątrz zamknięta', caption: 'Stocznia Ziemi: kadłuby rosną na pochylniach przy bokach trójkątnego doku (żurawie i drony), gotowy wyjeżdża na kratownicę ulicy i jedzie nią do doków; surowce przywożą statki ulicą',
      apply: () => {
        const Tr = layout.yard.tri;
        const pts = Tr.outline(Tr.Dwall + 200).map(([a, c]) => Tr.at(a, c));
        pts.push(Tr.at(Tr.aRoad - 1500, -3000), Tr.at(Tr.aRoad - 1500, 3000));
        frameBox(pts, 1.05);
      } }
    : { key: 5, name: 'Stocznia: linie budowy', sub: 'fabryka taśmowa (Jowisz) — krótkie linie, kadłuby rosną od hali ku przestrzeni', caption: 'Linia taktowa: przy hali drukarka-bramownica stawia szkielet, co takt kadłub przesuwa się o stanowisko (poszycie, wyposażenie), z końca linii gotowy okręt odlatuje',
      apply: () => {
        const L = layout.yard.lines[4];
        const [x, z] = L.at(2600, 0);
        const panel = shotMode ? 0 : 350;
        const zoom = Math.max(0.02, Math.min((Math.max(W, 640) - panel) / 21500, Math.max(Hh, 360) / 12500));
        state.mode = 'game';
        state.follow = false;
        state.cam.zoom = zoom;
        state.cam.x = P0.x + x + panel / 2 / zoom;
        state.cam.y = P0.y + z;
        applyLayers();
      } },
  yardKind === 'earth'
    ? { key: 6, name: 'Stocznia: ulica wokół doku', sub: 'Atlas na ulicy stoczni — dwa pasy nad kratownicą, jak droga przy ringu', caption: 'Ulica stoczni: prosto do doku, przy nim w prawo i dookoła pasem zewnętrznym (po lewej pochylnie, po prawej doki dostaw); środkiem jadą kadłuby na wózkach',
      apply: () => {
        const Tr = layout.yard.tri;
        const [x, z] = Tr.at(1100, -650);
        gotoXZ(x, z, yardRadial(Tr.sc), 0.17);
      } }
    : { key: 6, name: 'Stocznia: alejka', sub: 'przelot między linią capital a linią nosicieli', caption: 'Alejka między liniami: wlot od strony przestrzeni, na końcu lico hali; po bokach kadłuby na kolejnych stanowiskach',
      apply: () => {
        const a = layout.yard.lines[3];
        const b = layout.yard.lines[4];
        const d = b.len + 1800;
        const p = a.at(d, a.width / 2);
        const q = b.at(d, -b.width / 2);
        gotoXZ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (a.heading + b.heading) / 2 + Math.PI, 0.17);
      } },
  { key: 7, name: 'Stocznia: dok refitu', sub: 'dok capital w hali stoczni — wjazd z drogi', caption: 'Dok refitu: wjazd z drogi jak do zwykłego doku; po bokach zasobniki części i stojaki dronów',
    apply: () => { const p = pitById('YH-R2'); goto(p.sc, V.road + 250, yardRadial(p.sc), 0.3); } },
  { key: 8, name: 'Hangar z polem siłowym', sub: 'dok capital pod dachem — dach znika przy wlocie', caption: 'Hangar: pole siłowe w wylocie, dach zanika, gdy Atlas się zbliża (jak dach hali K-7)',
    apply: () => { const p = pitById('OL-H1'); goto(p.sc, V.road + 250, yardRadial(p.sc), 0.3); } },
  { key: 9, name: 'Kino: z ukosa', sub: 'wolna kamera wokół Atlasa (lot działa dalej)', caption: 'Kamera z ukosa wokół Atlasa: przeciąganie = orbita, kółko = odległość',
    apply: () => setCine() }
];
const cine = { cam: null, persp: new THREE.PerspectiveCamera(42, 1, 20, 400000), target: new THREE.Vector3(), dist: 7600, az: -1.05, el: 0.52 };
cine.persp.up.set(0, 0, 1);
function setCine() {
  state.mode = 'cine';
  applyLayers();
}
function cineCamera() {
  const p = cine.persp;
  const ce = Math.cos(cine.el);
  cine.target.set(P0.x + player.x, -(P0.y + player.z), 0);
  p.aspect = W / Math.max(1, Hh);
  p.updateProjectionMatrix();
  p.position.set(cine.target.x + Math.cos(cine.az) * ce * cine.dist, cine.target.y + Math.sin(cine.az) * ce * cine.dist, cine.target.z + Math.sin(cine.el) * cine.dist);
  p.lookAt(cine.target);
  p.updateMatrixWorld();
  if (!cine.cam) cine.cam = { mode: 'free3d', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 42, near: 20, far: 400000, zoom: 1 };
  // kino: bliska płaszczyzna rośnie z odległością kamery (rozdzielczość głębi z daleka)
  cine.cam.near = Math.max(20, cine.dist * 0.08);
  cine.cam.position.copy(p.position);
  cine.cam.quaternion.copy(p.quaternion);
  cine.cam.x = p.position.x;
  cine.cam.y = -p.position.y;
  return cine.cam;
}
function applyView(i) {
  const v = VIEWS[Math.max(0, Math.min(VIEWS.length - 1, i - 1))];
  state.view = v.key;
  v.apply();
  for (const b of viewButtons) b.classList.toggle('on', Number(b.dataset.view) === v.key);
  $('caption').textContent = `${v.key} · ${v.name} — ${v.caption}`;
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
  ['statki w dokach', () => state.showShips, (v) => { state.showShips = v; }],
  ['dachy hangarów zdjęte', () => state.roofsOff, (v) => { state.roofsOff = v; }]
];
for (const [label, get, set] of TOGGLES) {
  const l = document.createElement('label');
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = get();
  c.addEventListener('change', () => { set(c.checked); canvas2d.focus(); });
  l.append(c, label);
  $('toggles').appendChild(l);
}
const KINDS = [['earth', 'ziemia', 'Ziemia: suchy dok z ulicą'], ['jupiter', 'jowisz', 'Jowisz: fabryka taśmowa']];
for (const [kind, query, text] of KINDS) {
  const b = document.createElement('button');
  b.textContent = text;
  b.classList.toggle('on', kind === yardKind);
  b.addEventListener('click', () => {
    if (kind === yardKind) return;
    const q = new URLSearchParams(location.search);
    q.set('stocznia', query);
    q.set('view', '5');
    location.search = q.toString();
  });
  $('yardKind').appendChild(b);
}
const SPEEDS = [1, 4, 12];
const speedButtons = SPEEDS.map((k) => {
  const b = document.createElement('button');
  b.textContent = `×${k}`;
  b.addEventListener('click', () => { setYardSpeed(k); canvas2d.focus(); });
  $('yardSpeed').appendChild(b);
  return b;
});
function setYardSpeed(k) {
  YARD.speed = k;
  speedButtons.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === k));
}
(function berthTable() {
  const rows = [['S', 's'], ['M', 'm'], ['L', 'l'], ['nosiciel', 'carrier'], ['capital', 'capital'], ['MEGA', 'mega']];
  const c = layout.counts;
  let html = '<tr><th>klasa</th><th>cywilne dziś</th><th>cywilne</th><th>flota dziś</th><th>flota</th><th>refit</th></tr>';
  const sum = [0, 0, 0, 0, 0];
  for (const [label, k] of rows) {
    const v = [YARD_TODAY.civil[k], c.civil[k], YARD_TODAY.navy[k], c.navy[k], c.yard[k]];
    v.forEach((x, i) => { sum[i] += x; });
    html += `<tr><td>${label}</td>${v.map((x) => `<td>${x || '—'}</td>`).join('')}</tr>`;
  }
  html += `<tr><td>razem</td>${sum.map((x) => `<td>${x}</td>`).join('')}</tr>`;
  $('berths').innerHTML = html;
  $('yardInfo').textContent = layout.yard.tri
    ? `Stocznia Ziemi: ulica ${YARD_TRI.streetW} j. z kratownicą wokół trójkątnego doku (bok ${Math.round(layout.yard.tri.sides[0].len)} j.), ${c.build} pochylni z żurawiami, ${layout.yard.tri.pits.length} doków dostaw; zamknięta od zewnątrz, bez taśm.`
    : `Fabryka taśmowa (Jowisz): ${layout.yard.lines.length} krótkich linii, ${c.build} stanowisk (na każdej linii ostatnie to odbiór gotowego okrętu).`;
})();

// Sterowanie kamerą i statkiem
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
    cine.dist = Math.max(1200, Math.min(60000, cine.dist * Math.exp(e.deltaY * 0.001)));
    return;
  }
  const k = Math.exp(-e.deltaY * 0.0012);
  const z0 = state.cam.zoom;
  const z1 = Math.max(0.02, Math.min(1.6, z0 * k));
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
    // pierwszy ruch statku w kadrze swobodnym przywraca kamerę za statkiem
    if (state.mode === 'game' && !state.follow && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') { state.follow = true; if (state.cam.zoom < 0.1) state.cam.zoom = 0.2; }
    e.preventDefault();
    return;
  }
  if (/^Digit[1-9]$/.test(e.code)) applyView(Number(e.code.slice(5)));
  if (e.code === 'KeyF') { state.mode = 'game'; state.follow = true; applyLayers(); }
  if (e.code === 'KeyC') { if (state.mode === 'cine') { state.mode = 'game'; state.follow = true; applyLayers(); } else setCine(); }
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
  stepYard(dt);
  if (state.mode === 'game' && state.follow) {
    const tx = P0.x + player.x + player.vx * 0.55;
    const ty = P0.y + player.z + player.vz * 0.55;
    const k = 1 - Math.exp(-4.5 * dt);
    state.cam.x += (tx - state.cam.x) * k;
    state.cam.y += (ty - state.cam.y) * k;
  }
}

function render(realDt, simDt) {
  const cam = state.mode === 'cine' ? cineCamera() : state.cam;
  for (const b of B.list) {
    b.setSun(SUN_OPTS);
    b.tick(simDt, TICK);
  }
  // lampy stanu: zielona = wolne (statek w doku albo Atlas na polu → czerwona)
  for (const b of B.status) {
    for (const st of b.scene.rig.status) {
      const mine = where.pit && where.pit.berth.id === st.berthId;
      b._setChan(st.ch, occupied.has(st.berthId) || mine ? 0 : 1);
    }
  }
  const hull = player.polygon();
  for (const b of B.roofs) {
    const fade = b.roofFadeModel.update(hull, realDt, realDt <= 0);
    b._applyRoofFade(state.roofsOff ? 1 : fade);
  }

  renderYard();
  ShipProxyBatch3D.begin(cam);
  if (state.showShips) for (const p of parked) ShipProxyBatch3D.push(p.id, p.hullId, p.x, p.y, p.angle);
  for (const p of YARD.proxies) ShipProxyBatch3D.push(p.id, p.hullId, p.x, p.y, p.angle, p);
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
  Fx3D.update(simDt);
  updateHexShips3D(cam, ShipProxyBatch3D.engineEntities, cullInfo);
  drawHexShips3D(ctx2d, W, Hh);
  const r = Core3D.lastFrameRenderInfo?.total || Core3D.renderer?.info?.render || {};
  lastInfo = { calls: r.calls || 0, triangles: r.triangles || 0 };
}

const portSun = { dir: null, daylight: 1 };
/** Drony tej klatki (renderery Z5): paralaksa jak pass ortho gry; w kinie — kamera perspektywiczna. */
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
  if (TRI.dock) pushTriDrones();
  CargoContainers3D.end();
  CargoDrones3D.end();
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

function updateHud() {
  const speed = Math.hypot(player.vx, player.vz);
  let place = YARD_PLACE_LABEL[where.place] || '';
  if (where.pit) place += ` ${where.pit.id.split('-').pop()}${where.pit.home ? ' (domowe)' : ''}`;
  const camLine = state.mode === 'cine' ? 'kino z ukosa (C — wróć)' : state.follow ? 'za statkiem' : 'swobodna (F — za statkiem)';
  $('hud').innerHTML = [
    `<span class="place">${place}</span>`,
    `<b>prędkość</b> ${speed.toFixed(0).padStart(4)} j./s   <b>kamera</b> ${camLine}`,
    `<b>FPS</b> ${state.fps.toFixed(0).padStart(3)}   <b>rysunki</b> ${lastInfo.calls}   <b>zoom</b> ${state.cam.zoom.toFixed(3)}`,
    TRI.dock
      ? `<b>stocznia</b> w budowie ${YARD.inBuild || 0} · gotowe ${TRI.ready} · na kratownicy ${TRI.transports.length} · żurawie ${TRI.cranesBusy} · drony ${TRI.drones} · tempo ×${YARD.speed}`
      : `<b>stocznia</b> w budowie ${YARD.inBuild || 0} kadłubów · odlatuje ${YARD.launched.length} · tempo ×${YARD.speed}`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// API zrzutów i narzędzi
window.__stocznia = {
  ready: false,
  get errors() { return errors.slice(); },
  view(i) { applyView(i); return VIEWS[i - 1]?.name; },
  roofs(off) { state.roofsOff = !!off; },
  yardSpeed(k) { setYardSpeed(k); },
  centerXZ(x, z, zoom) { state.mode = 'game'; state.follow = false; state.cam.x = P0.x + x; state.cam.y = P0.y + z; state.cam.zoom = zoom; applyLayers(); },
  ships(on) { state.showShips = !!on; },
  teleport(s, v, heading, zoom = state.cam.zoom) { goto(s, v, heading, zoom); },
  center(s, v, zoom) { const [x, z] = yardPoint(s, v); state.mode = 'game'; state.follow = false; state.cam.x = P0.x + x; state.cam.y = P0.y + z; state.cam.zoom = zoom; applyLayers(); },
  cine(az, el, dist) { setCine(); if (Number.isFinite(az)) cine.az = az; if (Number.isFinite(el)) cine.el = el; if (Number.isFinite(dist)) cine.dist = dist; },
  key(code, down) { if (down) keys.add(code); else keys.delete(code); },
  simulate(seconds, step = 1 / 60) { const n = Math.round(seconds / step); for (let i = 0; i < n; i++) simulate(step); },
  renderFrames(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { simulate(dt); render(dt, dt); } updateHud(); return { ...lastInfo }; },
  stats() {
    return {
      ...lastInfo,
      place: where.place, pit: where.pit?.id || null, inside,
      player: { x: player.x, z: player.z, angle: player.angle, speed: Math.hypot(player.vx, player.vz) },
      proxies: { ...ShipProxyBatch3D.stats },
      buildings: B.list.map((b) => ({ name: b.root.name, drawCalls: b.drawCalls, instances: b.scene.instances })),
      roof: B.roofs.map((b) => b.roofFade),
      parked: parked.length,
      yard: {
        kind: yardKind, inBuild: YARD.inBuild || 0, launched: YARD.launched.length, proxies: YARD.proxies.length, speed: YARD.speed,
        ready: TRI.ready, onTruss: TRI.transports.length, delivered: TRI.done, sledsFree: TRI.sledFree.length, cranesBusy: TRI.cranesBusy, drones: TRI.drones
      },
      errors: errors.slice()
    };
  },
  layout, B, player, state
};

// ---------------------------------------------------------------------------
// Start
if (!(await Core3D.ready)) {
  reportError(`WebGPU: ${Core3D.gpuError || 'brak urządzenia — demo wymaga przeglądarki z WebGPU'}`);
  throw new Error('WebGPU niedostępne');
}
buildWorld();
setYardSpeed(1);
// Atlas czeka w przestrzeni przed pasem WJAZD; pierwszy kadr pokazuje cały kompleks.
{ const p = startPose(); const [x, z] = yardPoint(p.s, p.v); teleport(x, z, yardRadial(p.s) + Math.PI); }
applyView(Math.max(1, Math.min(VIEWS.length, Number(params.get('view')) || 1)));
if (params.has('zoom')) state.cam.zoom = Number(params.get('zoom'));
function texturesReady() {
  return !!atlasTex.image && atlasTex.image.complete !== false && (atlasTex.image.width || atlasTex.image.naturalWidth);
}
if (shotMode) {
  const wait = () => {
    render(1 / 60, 0);
    if (texturesReady() && ShipProxyBatch3D.stats.waitingImage === 0) {
      window.__stocznia.renderFrames(3);
      window.__stocznia.ready = true;
    } else setTimeout(wait, 60);
  };
  wait();
} else {
  window.__stocznia.ready = true;
  requestAnimationFrame(loop);
}
