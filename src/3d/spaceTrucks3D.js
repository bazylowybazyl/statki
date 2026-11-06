// src/3d/spaceTrucks3D.js
//
// CIĄGNIKI KOSMICZNE — obraz (TSL, partie): DWA rysunki na wszystkie zestawy. Kadłuby, ramy i ładunek to jedna partia
// sprite'ów z atlasu (albedo × alfa, normalna + połysk, maski malowania — scripts/ciagniki-sprite.mjs), światła, stożki
// reflektorów i płomienie dysz — druga, addytywna, w HDR (> 1, próg bloomu gry ~0,9). Moduł nie zna Core3D: działa na gołym
// WebGPURenderer tak samo jak w potoku gry (scena i kamera należą do właściciela).
//
//   const trucks = new SpaceTrucks3D({ scene, rigs: 64 });
//   await trucks.ready;                                    // tekstury atlasu; rysunek dopiero po nich
//   // rozgrzewka: renderer.compileAsync(mesh, camera, scene) albo Core3D.warmup.add({ objects: () => trucks.warmupMeshes(),
//   //   phase: 'loading', variant: WARIANT_INSTANCJI })
//   const train = placeTruckTrain(createTruckTrain('heavy', 5), x, y, kąt);   // src/game/spaceTruckTrain.js
//   const rig = trucks.add(train, { livery: 0, trailers: [{ cargo: 'standard' }, { cargo: 'tank' }, …] });
//   rig.throttle = 0.7;                                    // pola rig: throttle, brake, lights, beacon, visible
//   // co klatkę, po stepTruckTrain:
//   trucks.update({ x: cam.x, y: cam.y, ppu: px_na_j, viewW, viewH, time: sekundy, alpha, sun: { x, y } | null });
//   trucks.remove(rig);
//
// Układ: wejście w układzie gry (y w dół obrazka), scena: X = x, Y = −y. Dane instancji względem początku przy kamerze,
// duży offset w mesh.position (highPrecision; świat leży przy 5–10 mln j.). Bez window i DOM (działa w workerze renderu).
import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If,
  attribute, clamp, dot, exp, float, log2, max, min, mix, normalize, positionGeometry, renderGroup, smoothstep, sin, sqrt, step,
  texture, uniform, uv, varying, vec2, vec3, vec4
} from 'three/tsl';
import { loadImageBitmap } from './canvas2d.js';
import { truckTrainPose } from '../game/spaceTruckTrain.js';
import {
  TRUCK_ATLAS, TRUCK_ATLAS_CELLS, TRUCK_CARGO, TRUCK_HAZMAT_PAINT, TRUCK_HOPPER_LOADS, TRUCK_LIGHT_KINDS, TRUCK_LIVERIES,
  TRUCK_SPRITE_BOUNDS, TRUCK_TANK_SHELLS, TRUCK_TRACTORS, TRUCK_TRAILER, truckHexLinear, truckRigLength
} from '../data/spaceTrucks.js';

export const SPACE_TRUCKS_TUNE = Object.freeze({
  /** Zestawy → sprite'ów (ciągnik + 2 × naczepa), emiterów na zestaw (lampy, stożki, płomienie). */
  spritesPerRig: 11,
  emittersPerRig: 72,
  /** Wysokość nad płaszczyzną gry [j.]: nad proxy (z = 0), ten sam test głębi. */
  z: 1.5,
  renderOrder: 12,
  /** Płomień: długość = średnica × (idle + throttle · full), moc HDR, barwa plazmy. */
  flameIdle: 2.6,
  flameFull: 10,
  flamePower: 2.6,
  flameColor: Object.freeze([0.3, 0.62, 1.0]),
  /** Stożek reflektora [j., skala 1] i moc (subtelny: to nie mgła), znika przy dalekim zoomie. */
  coneLength: 34,
  coneWidth: 13,
  conePower: 0.045,
  coneMinPpu: 0.3,
  /** Sygnalizator: błyski na sekundę, ramiona obrotowe. */
  beaconHz: 1.15,
  beamLength: 11,
  beamWidth: 3.2,
  beamPower: 0.28,
  beamMinPpu: 0.3,
  /** Poniżej tego zoomu lampki dachu i środkowe markery wypadają (i tak zlewają się w jeden punkt). */
  detailMinPpu: 0.12,
  /** Tylne lampy pozostałych naczep przygaszone: pełną moc ma koniec zestawu. */
  innerTail: 0.3,
  /** Barwa słońca, otoczenie, podbicie otoczenia przy dalekim zoomie (farba linii czytelna z daleka). */
  sunColor: Object.freeze([1.0, 0.97, 0.92]),
  sunPower: 0.92,
  ambient: 0.2,
  farAmbient: 0.42,
  farPpu: 0.5,
  /** Słońce nad płaszczyzną [°]: wyżej niż dla kadłubów gry (jak łup: kontenery z bliska czytelne). */
  sunElevation: 42,
  /** Blask okien i lamp zgaszonych w sprite'cie [liniowe] (kanał B maski). */
  windowColor: Object.freeze([1.0, 0.74, 0.45]),
  windowPower: 1.4
});

const T = SPACE_TRUCKS_TUNE;
const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

/** Wartości wspólne obu partii (jeden zapis na klatkę). Uniformy zwykłe — graf RAZ na moduł. */
export const SPACE_TRUCKS_SHARED = {
  uPpu: shared(1),
  uLight: shared(new THREE.Vector3(-0.5, -0.45, 0.74)),
  uAmbient: shared(T.ambient),
  uTime: shared(0)
};

const SPRITE_STRIDE = 20;
const EMIT_STRIDE = 12;

// ---------------------------------------------------------------------------
// Tekstury atlasu: jeden komplet na moduł

let atlas = null;
function atlasTextures() {
  if (atlas) return atlas;
  const make = (srgbFlag) => {
    const t = new THREE.Texture();
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = srgbFlag ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  atlas = { albedo: make(true), normal: make(false), mask: make(false), loading: null };
  atlas.albedo.name = 'ciągniki: albedo';
  atlas.normal.name = 'ciągniki: normalne';
  atlas.mask.name = 'ciągniki: maski';
  return atlas;
}
function loadAtlas() {
  const a = atlasTextures();
  if (a.loading) return a.loading;
  const u = TRUCK_ATLAS.urls;
  a.loading = Promise.all([loadImageBitmap(u.albedo), loadImageBitmap(u.normal), loadImageBitmap(u.mask)]).then(([x, n, m]) => {
    a.albedo.image = x;
    a.normal.image = n;
    a.mask.image = m;
    a.albedo.needsUpdate = a.normal.needsUpdate = a.mask.needsUpdate = true;
  });
  return a.loading;
}

// ---------------------------------------------------------------------------
// Grafy (raz na moduł)

let spriteMaterial = null;
let emitMaterial = null;

function getSpriteMaterial() {
  if (spriteMaterial) return spriteMaterial;
  const U = SPACE_TRUCKS_SHARED;
  const tex = atlasTextures();
  const iPose = attribute('iPose', 'vec4'); // x, y względem początku (scena), cos a, sin a (kąt gry)
  const iSize = attribute('iSize', 'vec4'); // szer., wys. [j.], skala zestawu, krycie
  const iCell = attribute('iCell', 'vec4'); // u0, v0, du, dv
  const iPaint = attribute('iPaint', 'vec4'); // farba (rgb liniowe), w: moc okien
  const iAccent = attribute('iAccent', 'vec4'); // akcent (rgb), w: wolne

  const X = positionGeometry.x.mul(iSize.x);
  const Y = positionGeometry.y.mul(iSize.y);
  // Gra → scena: y sceny = −y gry; kwad: lokalne +y = −y obrazka. Obrót o kąt gry bez odbicia.
  const positionNode = vec3(iPose.x.add(X.mul(iPose.z)).add(Y.mul(iPose.w)), iPose.y.sub(X.mul(iPose.w)).add(Y.mul(iPose.z)), T.z);

  const vUv = varying(vec2(iCell.x.add(uv().x.mul(iCell.z)), iCell.y.add(float(1).sub(uv().y).mul(iCell.w))), 'vTruckUv');
  const vRot = varying(vec4(iPose.z, iPose.w, iSize.w, iSize.z), 'vTruckRot');
  const vPaint = varying(iPaint, 'vTruckPaint');
  const vAccent = varying(iAccent, 'vTruckAccent');

  const fragmentNode = Fn(() => {
    // Poziom mipmapy z zoomu: jeden na instancję (bez pochodnych), z sufitem — atlas ma margines `pad`.
    const lod = clamp(log2(float(TRUCK_ATLAS.pxPerUnit).div(max(U.uPpu.mul(vRot.w), 1e-4))), 0, TRUCK_ATLAS.maxLod);
    const alb = texture(tex.albedo, vUv).level(lod);
    const a = alb.a.mul(vRot.z);
    If(a.lessThan(0.004), () => { Discard(); });
    const nm = texture(tex.normal, vUv).level(lod);
    const mk = texture(tex.mask, vUv).level(lod);
    const n2 = nm.xy.mul(2).sub(1);
    const nz = sqrt(max(float(1).sub(dot(n2, n2)), 0.05));
    // Normalna w układzie gry (+y w dół obrazka), tam też światło.
    const N = normalize(vec3(n2.x.mul(vRot.x).sub(n2.y.mul(vRot.y)), n2.x.mul(vRot.y).add(n2.y.mul(vRot.x)), nz));
    const L = U.uLight;
    const diff = max(dot(N, L), 0);
    const Hv = normalize(L.add(vec3(0, 0, 1)));
    const nh = max(dot(N, Hv), 0);
    const gl = nm.z;
    // Połysk: potęga z połysku (podstawa nieujemna, bez pow z ujemną), kilkukrotne mnożenie.
    const n4 = nh.mul(nh).mul(nh).mul(nh);
    const n16 = n4.mul(n4).mul(n4).mul(n4);
    const spec = mix(n16, n16.mul(n16).mul(n16), gl).mul(gl).mul(1.1);
    const paint = mix(vec3(1), vPaint.xyz, mk.x).mul(mix(vec3(1), vAccent.xyz, mk.y));
    const sun = vec3(T.sunColor[0], T.sunColor[1], T.sunColor[2]).mul(T.sunPower);
    const lit = alb.xyz.mul(paint).mul(sun.mul(diff).add(U.uAmbient));
    const win = vec3(T.windowColor[0], T.windowColor[1], T.windowColor[2]).mul(T.windowPower).mul(mk.z).mul(vPaint.w);
    const rgb = lit.add(sun.mul(spec).add(win).mul(alb.a)).mul(vRot.z);
    return vec4(rgb, a);
  })();

  const m = new THREE.NodeMaterial();
  m.name = 'ciągniki: sprite';
  m.positionNode = positionNode;
  m.fragmentNode = fragmentNode;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.toneMapped = false;
  // Atlas jest mnożony przez alfę w liniowym: (ONE, 1 − alfa), NodeMaterial nie mnoży drugi raz.
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.premultipliedAlpha = false;
  spriteMaterial = m;
  return m;
}

function getEmitMaterial() {
  if (emitMaterial) return emitMaterial;
  const U = SPACE_TRUCKS_SHARED;
  const iPose = attribute('iPose', 'vec4'); // x, y, cos, sin (kierunek kwadu: +x = z dyszy ku końcowi płomienia)
  const iSize = attribute('iSize', 'vec4'); // długość, szerokość [j.], rodzaj (0 lampa, 1 płomień, 2 stożek), ziarno
  const iColor = attribute('iColor', 'vec4'); // rgb HDR, w: wolne

  const X = positionGeometry.x.mul(iSize.x);
  const Y = positionGeometry.y.mul(iSize.y);
  const positionNode = vec3(iPose.x.add(X.mul(iPose.z)).add(Y.mul(iPose.w)), iPose.y.sub(X.mul(iPose.w)).add(Y.mul(iPose.z)), T.z + 0.2);

  const vKind = varying(iSize.zw, 'vEmitKind');
  const vColor = varying(iColor.xyz, 'vEmitColor');
  const vUv = varying(uv(), 'vEmitUv');

  const fragmentNode = Fn(() => {
    const u = vUv.x;
    const p = vUv.sub(0.5).mul(2);
    const lat = p.y.abs();
    const r2 = dot(p, p);
    const kind = vKind.x;
    const seed = vKind.y;
    const isLamp = step(kind, 0.5);
    const isFlame = step(0.5, kind).mul(step(kind, 1.5));
    const isCone = step(1.5, kind);
    const fade = clamp(float(1).sub(r2), 0, 1);
    // Lampa: rdzeń + poświata do krawędzi kwadu.
    const lamp = exp(r2.mul(-30)).add(exp(r2.mul(-7)).mul(0.14)).mul(fade);
    // Płomień: u = 0 przy dyszy, zwęża się ku końcowi; biały rdzeń, migotanie.
    const rest = clamp(float(1).sub(u), 0, 1);
    const wid = sqrt(rest).mul(min(u.mul(10).add(0.55), 1)).mul(0.7).add(0.02);
    const q = lat.div(wid);
    const flick = sin(U.uTime.mul(41).add(seed.mul(17)).add(u.mul(9))).mul(0.1).add(sin(U.uTime.mul(97).add(seed.mul(31))).mul(0.06)).add(0.92);
    const body = exp(q.mul(q).mul(-3.2)).mul(rest).mul(rest).mul(flick);
    const coreF = exp(q.mul(q).mul(-14)).mul(rest).mul(rest).mul(rest).mul(rest).mul(0.9);
    const flame = body.add(coreF);
    // Stożek: od reflektora, miękkie brzegi.
    const spread = u.mul(0.88).add(0.12);
    const cone = smoothstep(1, 0.2, lat.div(spread)).mul(rest).mul(rest).mul(smoothstep(0, 0.1, u));
    const f = lamp.mul(isLamp).add(flame.mul(isFlame)).add(cone.mul(isCone));
    const white = coreF.mul(isFlame).mul(1.1);
    const rgb = vColor.mul(f).add(white);
    return vec4(rgb, min(max(max(rgb.x, rgb.y), rgb.z), 1));
  })();

  const m = new THREE.NodeMaterial();
  m.name = 'ciągniki: emitery';
  m.positionNode = positionNode;
  m.fragmentNode = fragmentNode;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.toneMapped = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.premultipliedAlpha = false;
  emitMaterial = m;
  return m;
}

function batchGeometry(capacity, stride, attrs) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(quad.index);
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * stride), stride, 1);
  attrs.forEach((name, i) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4)));
  geometry.instanceCount = 0;
  return { geometry, buffer };
}

// ---------------------------------------------------------------------------
// Wygląd zestawu

const LIVERY_LIN = TRUCK_LIVERIES.map((l) => ({ paint: truckHexLinear(l.paint), accent: truckHexLinear(l.accent) }));
const HAZMAT_LIN = { paint: truckHexLinear(TRUCK_HAZMAT_PAINT.paint), accent: truckHexLinear(TRUCK_HAZMAT_PAINT.accent) };
const TANK_LIN = TRUCK_TANK_SHELLS.map((h) => truckHexLinear(h));
const LOAD_LIN = Object.fromEntries(Object.entries(TRUCK_HOPPER_LOADS).map(([k, h]) => [k, truckHexLinear(h)]));

/** Farby ładunku rodziny: { paint, accent } liniowe; `liveryIndex` — linia, `variant` — zmienny płaszcz / materiał. */
export function truckCargoPaints(cargo, liveryIndex, variant = 0, load = 'ore') {
  const liv = LIVERY_LIN[((liveryIndex % LIVERY_LIN.length) + LIVERY_LIN.length) % LIVERY_LIN.length];
  if (cargo === 'hazmat') return HAZMAT_LIN;
  if (cargo === 'tank') return { paint: TANK_LIN[(variant | 0) % TANK_LIN.length], accent: liv.paint };
  if (cargo === 'hopper') return { paint: liv.paint, accent: LOAD_LIN[load] || LOAD_LIN.ore };
  return liv;
}

// Rekord sprite'a wyglądu zestawu: część (indeks w pociągu), środek lokalny, wymiary, komórka, farby.
const CELL_REC = 15;
function cellRecord(out, o, part, name, scale, paints) {
  const b = TRUCK_SPRITE_BOUNDS[name];
  const c = TRUCK_ATLAS_CELLS[name];
  const [AW, AH] = TRUCK_ATLAS.size;
  out[o] = part;
  out[o + 1] = (b[0] + b[1]) * 0.5 * scale;
  out[o + 2] = (b[2] + b[3]) * 0.5 * scale;
  out[o + 3] = (b[1] - b[0]) * scale;
  out[o + 4] = (b[3] - b[2]) * scale;
  out[o + 5] = c.x / AW;
  out[o + 6] = c.y / AH;
  out[o + 7] = c.w / AW;
  out[o + 8] = c.h / AH;
  out.set(paints.paint, o + 9);
  out.set(paints.accent, o + 12);
  return o + CELL_REC;
}

/** Lista emiterów części: [x, y, numer rodzaju] (skala 1), bez alokacji w klatce. */
function lightsRecord(list) {
  const out = new Float32Array(list.length * 3);
  list.forEach((p, i) => {
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = Object.keys(TRUCK_LIGHT_KINDS).indexOf(p[2]);
  });
  return out;
}
const KIND_LIST = Object.keys(TRUCK_LIGHT_KINDS).map((k) => TRUCK_LIGHT_KINDS[k]);
const KIND_INDEX = Object.fromEntries(Object.keys(TRUCK_LIGHT_KINDS).map((k, i) => [k, i]));
const TRACTOR_LIGHTS = Object.fromEntries(Object.values(TRUCK_TRACTORS).map((t) => [t.id, lightsRecord(t.lights)]));
const TRAILER_LIGHTS = lightsRecord(TRUCK_TRAILER.lights);

// ---------------------------------------------------------------------------

export class SpaceTrucks3D {
  /**
   * @param {object} o
   * @param {object} [o.scene]  scena three (właściciel woła `render`); bez sceny — siatki do dodania ręcznie (`warmupMeshes`).
   * @param {number} [o.rigs]   zestawów naraz (pojemność partii).
   * @param {number} [o.layer]  warstwa three (domyślnie 0 — płaszczyzna gry).
   * @param {boolean} [o.loadTextures]  false — bez wczytywania atlasu (testy w Node).
   */
  constructor({ scene = null, rigs = 64, layer = 0, loadTextures = true } = {}) {
    this.capacityRigs = rigs;
    this.rigs = [];
    this.origin = { x: 0, y: 0 };
    this.stats = { rigs: 0, drawn: 0, sprites: 0, emitters: 0, ms: 0 };
    const spriteCap = rigs * T.spritesPerRig;
    const emitCap = rigs * T.emittersPerRig;
    this.spriteCap = spriteCap;
    this.emitCap = emitCap;
    const a = batchGeometry(spriteCap, SPRITE_STRIDE, ['iPose', 'iSize', 'iCell', 'iPaint', 'iAccent']);
    const b = batchGeometry(emitCap, EMIT_STRIDE, ['iPose', 'iSize', 'iColor']);
    this.spriteBuffer = a.buffer;
    this.emitBuffer = b.buffer;
    this.spriteMesh = new THREE.Mesh(a.geometry, getSpriteMaterial());
    this.emitMesh = new THREE.Mesh(b.geometry, getEmitMaterial());
    this.spriteMesh.name = 'Ciągniki: sprite';
    this.emitMesh.name = 'Ciągniki: emitery';
    for (const m of [this.spriteMesh, this.emitMesh]) {
      m.frustumCulled = false;
      m.layers.set(layer);
      m.visible = false;
      if (scene) scene.add(m);
    }
    this.spriteMesh.renderOrder = T.renderOrder;
    this.emitMesh.renderOrder = T.renderOrder + 1;
    this.textured = !loadTextures;
    this.ready = loadTextures
      ? loadAtlas().then(() => { this.textured = true; return this; })
      : Promise.resolve(this);
    this._pose = { x: 0, y: 0, a: 0 };
    this._nextId = 1;
  }

  /**
   * Nowy zestaw: `train` z createTruckTrain, `look`: { livery (indeks linii ciągnika), trailers: [{ cargo: 'standard' | 'hazmat'
   * | 'tank' | 'hopper' | null (pusta rama), livery, variant, load }], windows }. Zwraca rekord z polami sterowania obrazem.
   */
  add(train, look = {}) {
    if (this.rigs.length >= this.capacityRigs) return null;
    const tractor = TRUCK_TRACTORS[train.tractorId];
    const scale = train.scale;
    const liv = ((look.livery ?? 0) % LIVERY_LIN.length + LIVERY_LIN.length) % LIVERY_LIN.length;
    const n = train.count - 1;
    const trailers = look.trailers || [];
    const cells = new Float32Array((1 + 2 * Math.max(n, 0)) * CELL_REC);
    let o = 0;
    o = cellRecord(cells, o, 0, `tractor_${train.tractorId}`, scale, LIVERY_LIN[liv]);
    for (let i = 0; i < n; i++) {
      const t = trailers[i] || {};
      const lv = t.livery ?? liv;
      o = cellRecord(cells, o, i + 1, 'trailer_chassis', scale, LIVERY_LIN[((lv % LIVERY_LIN.length) + LIVERY_LIN.length) % LIVERY_LIN.length]);
      const cargo = t.cargo === undefined ? 'standard' : t.cargo;
      if (cargo && TRUCK_CARGO[cargo]) {
        const sprites = TRUCK_CARGO[cargo].sprites;
        const name = sprites[((t.variant ?? 0) % sprites.length + sprites.length) % sprites.length];
        o = cellRecord(cells, o, i + 1, name, scale, truckCargoPaints(cargo, lv, t.variant ?? i, t.load));
      }
    }
    const rig = {
      id: this._nextId++,
      train,
      cells,
      cellCount: o / CELL_REC,
      radius: truckRigLength(train.tractorId, n) * scale + 40 * scale,
      phase: (this._nextId * 0.37) % 1,
      nozzles: tractor.nozzles,
      /** Sterowanie obrazem: ciąg dysz 0–1, światło stopu, lampy, sygnalizator, widoczność, siła okien. */
      throttle: 0.6,
      brake: false,
      lights: true,
      beacon: true,
      visible: true,
      windows: look.windows ?? 1
    };
    this.rigs.push(rig);
    return rig;
  }

  remove(rig) {
    const i = this.rigs.indexOf(rig);
    if (i >= 0) { this.rigs[i] = this.rigs[this.rigs.length - 1]; this.rigs.pop(); }
  }

  clear() {
    this.rigs.length = 0;
  }

  /** Klatka: kamera { x, y } w układzie gry, ppu — px bufora na j., viewW / viewH [px], time [s], alpha — interpolacja poz. */
  update(view) {
    const t0 = performance.now();
    const S = SPACE_TRUCKS_SHARED;
    const ppu = Math.max(1e-4, Number(view.ppu) || 1);
    const camX = Number(view.x) || 0;
    const camY = Number(view.y) || 0;
    const time = Number(view.time) || 0;
    const alpha = view.alpha === undefined ? 1 : view.alpha;
    const hw = (view.viewW || 1920) * 0.5 / ppu;
    const hh = (view.viewH || 1080) * 0.5 / ppu;
    const ox = camX;
    const oy = -camY;
    this.origin.x = ox;
    this.origin.y = oy;
    S.uPpu.value = ppu;
    S.uTime.value = time;
    const far = 1 - Math.min(1, ppu / T.farPpu);
    S.uAmbient.value = T.ambient + (T.farAmbient - T.ambient) * far;
    if (view.sunDir) {
      S.uLight.value.copy(view.sunDir);
    } else if (view.sun) {
      const dx = view.sun.x - camX;
      const dy = view.sun.y - camY;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const el = (view.sunElevation ?? T.sunElevation) * Math.PI / 180;
      S.uLight.value.set(dx / d * Math.cos(el), dy / d * Math.cos(el), Math.sin(el));
    }
    const sb = this.spriteBuffer.array;
    const eb = this.emitBuffer.array;
    const sCap = this.spriteCap;
    const eCap = this.emitCap;
    let sn = 0;
    let en = 0;
    let drawn = 0;
    const pose = this._pose;
    const list = this.rigs;
    for (let r = 0; r < list.length; r++) {
      const rig = list[r];
      if (!rig.visible) continue;
      const tr = rig.train;
      if (Math.abs(tr.x[0] - camX) > hw + rig.radius || Math.abs(tr.y[0] - camY) > hh + rig.radius) continue;
      drawn++;
      const scale = tr.scale;
      const winK = rig.lights ? rig.windows : 0;
      // Sprite'y: wg listy (część pociągu → poza z interpolacją).
      let lastPart = -1;
      let c = 1;
      let s = 0;
      let wx = 0;
      let wy = 0;
      const cells = rig.cells;
      for (let k = 0; k < rig.cellCount && sn < sCap; k++) {
        const o = k * CELL_REC;
        const part = cells[o];
        if (part !== lastPart) {
          truckTrainPose(tr, part, alpha, pose);
          c = Math.cos(pose.a);
          s = Math.sin(pose.a);
          wx = pose.x;
          wy = pose.y;
          lastPart = part;
        }
        const lx = cells[o + 1];
        const ly = cells[o + 2];
        const p = sn * SPRITE_STRIDE;
        sb[p] = wx + lx * c - ly * s - ox;
        sb[p + 1] = -(wy + lx * s + ly * c) - oy;
        sb[p + 2] = c;
        sb[p + 3] = s;
        sb[p + 4] = cells[o + 3];
        sb[p + 5] = cells[o + 4];
        sb[p + 6] = scale;
        sb[p + 7] = 1;
        sb[p + 8] = cells[o + 5];
        sb[p + 9] = cells[o + 6];
        sb[p + 10] = cells[o + 7];
        sb[p + 11] = cells[o + 8];
        sb[p + 12] = cells[o + 9];
        sb[p + 13] = cells[o + 10];
        sb[p + 14] = cells[o + 11];
        sb[p + 15] = winK;
        sb[p + 16] = cells[o + 12];
        sb[p + 17] = cells[o + 13];
        sb[p + 18] = cells[o + 14];
        sb[p + 19] = 0;
        sn++;
      }
      // Dysze i światła ciągnika.
      truckTrainPose(tr, 0, alpha, pose);
      c = Math.cos(pose.a);
      s = Math.sin(pose.a);
      wx = pose.x;
      wy = pose.y;
      const noz = rig.nozzles;
      const thr = rig.throttle;
      for (let i = 0; i < noz.length && en < eCap; i++) {
        const nx = noz[i][0] * scale;
        const ny = noz[i][1] * scale;
        const d = noz[i][2] * scale;
        const len = d * (T.flameIdle + T.flameFull * thr);
        const wid = d * 1.15;
        // Kwad wzdłuż kursu do tyłu: środek = wylot − kurs · (długość / 2).
        const px = wx + (nx - len * 0.5) * c - ny * s;
        const py = wy + (nx - len * 0.5) * s + ny * c;
        const q = en * EMIT_STRIDE;
        const pw = T.flamePower * (0.5 + 0.8 * thr);
        eb[q] = px - ox;
        eb[q + 1] = -py - oy;
        eb[q + 2] = -c;
        eb[q + 3] = -s;
        eb[q + 4] = len;
        eb[q + 5] = wid;
        eb[q + 6] = 1;
        eb[q + 7] = rig.phase + i * 0.31;
        eb[q + 8] = T.flameColor[0] * pw;
        eb[q + 9] = T.flameColor[1] * pw;
        eb[q + 10] = T.flameColor[2] * pw;
        eb[q + 11] = 0;
        en++;
      }
      if (rig.lights) {
        en = this._pushLights(eb, en, eCap, TRACTOR_LIGHTS[tr.tractorId], wx, wy, c, s, scale, ppu, ox, oy, rig, time, true, false);
        const parts = tr.count;
        for (let i = 1; i < parts; i++) {
          truckTrainPose(tr, i, alpha, pose);
          const ci = Math.cos(pose.a);
          const si = Math.sin(pose.a);
          en = this._pushLights(eb, en, eCap, TRAILER_LIGHTS, pose.x, pose.y, ci, si, scale, ppu, ox, oy, rig, time, false, i === parts - 1);
        }
      }
    }
    const sg = this.spriteMesh.geometry;
    const eg = this.emitMesh.geometry;
    sg.instanceCount = sn;
    eg.instanceCount = en;
    const sbuf = this.spriteBuffer;
    const ebuf = this.emitBuffer;
    sbuf.clearUpdateRanges();
    ebuf.clearUpdateRanges();
    if (sn) { sbuf.addUpdateRange(0, sn * SPRITE_STRIDE); sbuf.needsUpdate = true; }
    if (en) { ebuf.addUpdateRange(0, en * EMIT_STRIDE); ebuf.needsUpdate = true; }
    const vis = this.textured && (sn > 0 || en > 0);
    this.spriteMesh.visible = vis && sn > 0;
    this.emitMesh.visible = vis && en > 0;
    this.spriteMesh.position.set(ox, oy, 0);
    this.emitMesh.position.set(ox, oy, 0);
    this.spriteMesh.updateMatrixWorld();
    this.emitMesh.updateMatrixWorld();
    const st = this.stats;
    st.rigs = list.length;
    st.drawn = drawn;
    st.sprites = sn;
    st.emitters = en;
    st.ms = performance.now() - t0;
  }

  _pushLights(eb, en, eCap, rec, wx, wy, c, s, scale, ppu, ox, oy, rig, time, isTractor, isLast) {
    const detail = ppu >= T.detailMinPpu;
    const n = rec.length / 3;
    for (let i = 0; i < n && en < eCap; i++) {
      const lx = rec[i * 3] * scale;
      const ly = rec[i * 3 + 1] * scale;
      const kindId = rec[i * 3 + 2];
      const kind = KIND_LIST[kindId];
      let power = kind.power;
      let cr = kind.color[0];
      let cg = kind.color[1];
      let cb = kind.color[2];
      if (kindId === KIND_INDEX.roof && !detail) continue;
      if (kindId === KIND_INDEX.marker && !detail && Math.abs(rec[i * 3]) < 1) continue;
      if (kindId === KIND_INDEX.tail) {
        if (isTractor || !isLast) power *= T.innerTail;
        if (isLast || isTractor) power *= rig.brake ? 2.4 : 1;
        if (rig.train.reverse && isLast) { cr = 1; cg = 0.92; cb = 0.8; }
      }
      const px = wx + lx * c - ly * s;
      const py = wy + lx * s + ly * c;
      if (kindId === KIND_INDEX.beacon) {
        if (!rig.beacon) continue;
        // Obrotowy błysk: dwa ramiona, puls gdy ramię patrzy „ku kamerze”.
        const ph = (time * T.beaconHz + rig.phase) % 1;
        const a = ph * Math.PI * 2;
        const pulse = Math.abs(Math.cos(a));
        const p2 = pulse * pulse;
        power *= 0.12 + 0.88 * p2 * p2 * p2;
        if (ppu >= T.beamMinPpu) {
          for (let b = 0; b < 2 && en < eCap; b++) {
            const dir = a + b * Math.PI;
            const dc = Math.cos(dir);
            const ds = Math.sin(dir);
            const len = T.beamLength * scale;
            const q = en * EMIT_STRIDE;
            eb[q] = px + dc * len * 0.5 - ox;
            eb[q + 1] = -(py + ds * len * 0.5) - oy;
            eb[q + 2] = dc;
            eb[q + 3] = ds;
            eb[q + 4] = len;
            eb[q + 5] = T.beamWidth * scale;
            eb[q + 6] = 2;
            eb[q + 7] = 0;
            eb[q + 8] = cr * T.beamPower;
            eb[q + 9] = cg * T.beamPower;
            eb[q + 10] = cb * T.beamPower;
            eb[q + 11] = 0;
            en++;
          }
        }
      }
      if (kindId === KIND_INDEX.head && ppu >= T.coneMinPpu && en < eCap) {
        const len = T.coneLength * scale;
        const q = en * EMIT_STRIDE;
        eb[q] = px + c * len * 0.5 - ox;
        eb[q + 1] = -(py + s * len * 0.5) - oy;
        eb[q + 2] = c;
        eb[q + 3] = s;
        eb[q + 4] = len;
        eb[q + 5] = T.coneWidth * scale;
        eb[q + 6] = 2;
        eb[q + 7] = 0;
        eb[q + 8] = cr * T.conePower;
        eb[q + 9] = cg * T.conePower;
        eb[q + 10] = cb * T.conePower;
        eb[q + 11] = 0;
        en++;
        if (en >= eCap) break;
      }
      // Lampa: promień w j., najmniej `minPx` px (HDR czytelny z daleka).
      const r = Math.max(kind.radius * scale, kind.minPx / ppu);
      const size = r * 4.4;
      const q = en * EMIT_STRIDE;
      eb[q] = px - ox;
      eb[q + 1] = -py - oy;
      eb[q + 2] = 1;
      eb[q + 3] = 0;
      eb[q + 4] = size;
      eb[q + 5] = size;
      eb[q + 6] = 0;
      eb[q + 7] = 0;
      eb[q + 8] = cr * power;
      eb[q + 9] = cg * power;
      eb[q + 10] = cb * power;
      eb[q + 11] = 0;
      en++;
    }
    return en;
  }

  /**
   * Siatki do rozgrzewki (dwa materiały, stan z `instanceCount ≥ 2` — na Core3D wpis z `WARIANT_INSTANCJI`, na gołym renderze:
   * ustaw instanceCount przed compileAsync). Bez tekstur też wolno: klucz pipeline'u ich nie zawiera.
   */
  warmupMeshes() {
    return [this.spriteMesh, this.emitMesh];
  }

  dispose() {
    for (const m of [this.spriteMesh, this.emitMesh]) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
  }
}
