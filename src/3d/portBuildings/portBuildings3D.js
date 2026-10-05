// Render budowli portowych (Z7): stocznia (pochylnie, dźwigi, piasta z placami
// postoju i refitu) i hangar postojowy. Dane brył z portBuildingScene.js (bez
// Three), tu: instancje (prostopadłościan, walec, torus) w zestawach BG / FG /
// dach, płyty, napisy, grupy ruchome (macierze co klatkę), kanały efektów,
// kadłuby w budowie (portHullBuild3D.js) i rój dronów z taśmą
// (portShipyardSwarm.js — rysują je renderery Z5, pushCargo).
//
// Zasady (AGENTS.md): bez własnego renderera — obiekty trafiają do sceny
// gospodarza (Core3D.scene albo grupa ringu), warstwy ustawia gospodarz
// (setLayers: BG = 1 pod statkami, FG = 2 nad nimi, jak hale K-7). Dane instancji
// liczone względem korzenia budowli (małe liczby), a korzeń stoi w
// `root.matrix` = układ budowli → scena gospodarza; three składa
// modelViewMatrix w double, więc bez drgań przy 5–10 mln j. (wzór hal K-7 i
// Bridge3D._setOrigin — dane względem pobliskiego początku, duży offset w macierzy).
//
// Dwa modele światła (osobne grafy TSL, portBuildings3D.tsl.js):
//  - 'halo' — na ringu: model ringu jak hala K-7 (haloSunVisibility: cień
//    planety z czerwonym brzegiem i bryły ringu, światło planety), uniformy ringu
//    (createHaloUniforms) + uHub = macierz budowli → układ ringu;
//  - przestrzeń (megadok, stacja bez ringu, demo): słońce gry z wysokością 49°
//    (jak DirectionalLight i ring), widoczność od gospodarza (uSunVisS: cień
//    planety) × maska cieni słońca Core3D (sunVisibility/sunFill, sunShadowMask.js).
// Emisja w paśmie HDR 0,9–1,4 (bloom przy progu 0,9), iskry spawania i błyski
// drobne (≤ kilka px) do ~6 — AGENTS.md: emitery HDR > 1.
import * as THREE from 'three';
import { K7_ABOVE_SCALE, k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { sunShadowUniforms } from '../sunShadowMask.js';
import { pbNodeMaterial, portBuildingGraphs } from './portBuildings3D.tsl.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { portHubMatrixElements } from './portModuleTraffic.js';
import {
  HANGAR_CH,
  PB_CHANNELS,
  PB_MAX_GROUPS,
  PB_MAX_LAMPS,
  PB_STRIDE,
  YARD_CH,
  buildHangarScene,
  buildShipyardScene
} from './portBuildingScene.js';
import { HULL_BUILD_STAGES, shipyardPads } from './portShipyardLayout.js';
import { createShipyardSwarm, pushShipyardSwarm, stepShipyardSwarm } from './portShipyardSwarm.js';
import { PortHullBuild3D } from './portHullBuild3D.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// stan „bez zmian” (update bez argumentu) — bez literału obiektu co klatkę
const NO_STATE = Object.freeze({});
const smooth = (t) => t * t * (3 - 2 * t);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

// Shadery: grafy TSL w portBuildings3D.tsl.js (graf raz na tryb światła, wartości
// budowli w material.uniforms — port WebGPU, dawne GLSL PB_GLSL_* / INSTANCE_* / PLATE_* / LABEL_*).

// ---------------------------------------------------------------------------
// Geometrie

function makeInstanced(base, data, sphere) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const arr = new Float32Array(data);
  const buf = new THREE.InstancedInterleavedBuffer(arr, PB_STRIDE);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iQ', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 12));
  geo.setAttribute('iD', new THREE.InterleavedBufferAttribute(buf, 4, 16));
  geo.instanceCount = arr.length / PB_STRIDE;
  geo.boundingSphere = sphere.clone();
  return { geo, arr, buf };
}

// Obwiednia budowli w jej układzie (środki instancji + zapas).
function sceneSphere(sets, plates) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  const take = (x, z) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  };
  for (const set of Object.values(sets)) {
    for (const data of Object.values(set)) for (let i = 0; i < data.length; i += PB_STRIDE) take(data[i], data[i + 2]);
  }
  for (const p of plates) for (const [x, z] of p.points) take(x, z);
  if (!Number.isFinite(x0)) { x0 = z0 = -1; x1 = z1 = 1; }
  const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 1200;
  return new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), r);
}

// Wypukłe wielokąty wytłoczone w pionie (pokład, dach) — jedna geometria na zestaw.
function makePlates(plates) {
  const pos = [];
  const nor = [];
  const mat = [];
  const tri = (a, b, c, n, m) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) { nor.push(...n); mat.push(m); }
  };
  for (const p of plates) {
    const pts = p.points;
    const n = pts.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const ordered = area < 0 ? pts : pts.slice().reverse();
    const top = ordered.map(([x, z]) => [x, p.z1, z]);
    const bot = ordered.map(([x, z]) => [x, p.z0, z]);
    for (let i = 1; i + 1 < n; i++) {
      tri(top[0], top[i], top[i + 1], [0, 1, 0], p.mat);
      tri(bot[0], bot[i + 1], bot[i], [0, -1, 0], p.mat);
    }
    for (let i = 0; i < n; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % n];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const len = Math.hypot(ex, ez) || 1;
      const nrm = [-ez / len, 0, ex / len];
      const sideMat = p.mat === 6 ? 1 : p.mat;
      tri([a[0], p.z0, a[1]], [b[0], p.z0, b[1]], [b[0], p.z1, b[1]], nrm, sideMat);
      tri([a[0], p.z0, a[1]], [b[0], p.z1, b[1]], [a[0], p.z1, a[1]], nrm, sideMat);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  g.computeBoundingSphere();
  return g;
}

const srgbTriple = (hex) => {
  const h = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  const c = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255)];
};

// Atlas napisów (jak groundText K-7: pogrubiony Arial + opis mono).
function makeLabelAtlas(labels) {
  if (typeof document === 'undefined' || !labels.length) return null;
  const unique = new Map();
  for (const l of labels) {
    const key = l.text + '|' + l.small;
    if (!unique.has(key)) unique.set(key, { text: l.text, small: l.small, cell: unique.size });
  }
  const cellW = 512;
  const cellH = 116;
  const cols = 4;
  const rows = Math.ceil(unique.size / cols);
  const H = Math.max(128, 2 ** Math.ceil(Math.log2(rows * cellH)));
  const canvas = document.createElement('canvas');
  canvas.width = cellW * cols;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const u of unique.values()) {
    const cx = (u.cell % cols) * cellW;
    const cy = Math.floor(u.cell / cols) * cellH;
    const hasSmall = !!u.small;
    const h = hasSmall ? cellH : cellH * 140 / 230;
    const scale = cellW / 1024;
    g.save();
    g.translate(cx, cy);
    g.font = `700 ${Math.round(102 * scale)}px Arial`;
    g.fillText(u.text, cellW / 2, 66 * scale, 970 * scale);
    if (hasSmall) {
      g.font = `${Math.round(27 * scale)}px monospace`;
      g.fillText(u.small, cellW / 2, 177 * scale, 960 * scale);
    }
    g.restore();
    u.uv = [cx / canvas.width, 1 - (cy + h) / canvas.height, (cx + cellW) / canvas.width, 1 - cy / canvas.height];
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, unique };
}

function makeLabelMesh(labels, atlas) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  for (const l of labels) {
    const u = atlas.unique.get(l.text + '|' + l.small);
    const [u0, v0, u1, v1] = u.uv;
    const c = srgbTriple(l.color);
    const base = pos.length / 3;
    const r = l.rotation || 0;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    for (const [a, b, uu, vv] of [[-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0], [0.5, 0.5, u1, v1], [-0.5, 0.5, u0, v1]]) {
      const px = a * l.width;
      const py = b * l.depth;
      const x = px * cr - py * sr;
      const y = px * sr + py * cr;
      pos.push(l.x + x, l.y, l.z - y);
      nor.push(0, 1, 0);
      uv.push(uu, vv);
      col.push(...c);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Światło w trybie przestrzeni: słońce gry (azymut z Słońca gry, wysokość 49°
// jak DirectionalLight i ring), otoczenie jak obiekty 3D gry.
export const PORT_SPACE_LIGHT = Object.freeze({
  sunElevationDeg: 49,
  sunColor: Object.freeze([1.02, 0.984, 0.933]),
  ambient: Object.freeze([0.050, 0.056, 0.066])
});

// Geometrie bazowe instancji — osobne na budowlę (jak _box / _cyl hali K-7):
// dispose() jednej budowli zwalnia bufory atrybutów, które dzieli tylko ze sobą.
function baseGeometries() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1, false),
    torus: new THREE.TorusGeometry(1, 0.13, 6, 24),
    cone: new THREE.ConeGeometry(1, 1, 8, 1)
  };
}

/**
 * Wspólna podstawa budowli: korzeń (układ budowli → scena gospodarza), zestawy
 * siatek BG / FG / dach, uniformy (paleta ze stylu, kanały, grupy, lampy, światło).
 */
export class PortBuilding3D {
  /**
   * @param {object} o
   *   layout      układ (createShipyardLayout / createHangarLayout)
   *   scene       dane sceny (buildShipyardScene / buildHangarScene)
   *   style       styl (resolvePortBuildingStyle albo klucz / profil / styl megadoku)
   *   frame       ramka (portModuleFrame / portRingModuleFrame) w układzie gospodarza
   *   light       'space' (domyślnie) albo 'halo'
   *   haloUniforms  uniformy ringu (createHaloUniforms) — wymagane dla 'halo'
   */
  constructor({ layout, scene, style = 'earth', frame, light = 'space', haloUniforms = null, name = 'PortBuilding' }) {
    this.layout = layout;
    this.scene = scene;
    this.style = style && style.palette ? style : resolvePortBuildingStyle(style);
    this.frame = frame;
    this.lightMode = light === 'halo' && haloUniforms ? 'halo' : 'space';
    this.root = new THREE.Group();
    this.root.name = name;
    this.root.matrixAutoUpdate = false;
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    this.meshes = { bg: [], fg: [], roof: [] };
    this.materials = [];
    this.time = 0;
    this.roofFade = 0;
    const groups = Array.from({ length: PB_MAX_GROUPS }, () => new THREE.Matrix4());
    const lamps = Array.from({ length: PB_MAX_LAMPS }, (_, i) => {
      const l = scene.lamps[i];
      return l ? new THREE.Vector4(l[0], l[1], l[2], l[3]) : new THREE.Vector4(0, 0, 0, 0);
    });
    this.uniforms = {
      uGroup: { value: groups },
      uChan: { value: Array.from({ length: PB_CHANNELS / 4 }, () => new THREE.Vector4()) },
      uPbTime: { value: new THREE.Vector4(0, 1, 1, 0.3) },
      uPbPal: { value: this.style.palette.map((c) => new THREE.Vector3(...c)) },
      uPbEmit: { value: this.style.emit.map((c) => new THREE.Vector3(...c)) },
      uPbGlow: { value: this.style.glow.map((c) => new THREE.Vector3(...c)) },
      uPbWeld: { value: new THREE.Vector3(...this.style.weld) },
      uLamps: { value: lamps },
      uHub: { value: this.root.matrix },
      uSunDirW: { value: new THREE.Vector3(0.4, 0.3, 0.87).normalize() },
      uSunColorS: { value: new THREE.Vector3(...PORT_SPACE_LIGHT.sunColor) },
      uAmbientS: { value: new THREE.Vector3(...PORT_SPACE_LIGHT.ambient) },
      uSunVisS: { value: 1 }
    };
    // dach: osobny obiekt krycia (reszta zawsze 1)
    this.roofTime = { value: new THREE.Vector4(0, 1, 1, 0.3) };
    const hostUniforms = this.lightMode === 'halo' ? haloUniforms : sunShadowUniforms;
    this._common = { ...hostUniforms, ...this.uniforms };
    this._commonRoof = { ...hostUniforms, ...this.uniforms, uPbTime: this.roofTime };
    // grafy TSL raz na tryb światła (ring: na obiekt uniformów ringu)
    this.haloUniforms = this.lightMode === 'halo' ? haloUniforms : null;
    this.graphs = portBuildingGraphs(this.haloUniforms);
    this.sphere = sceneSphere(scene.sets, scene.plates);
    this._build();
  }

  _material(name, graph, uniforms, opts = {}) {
    const m = pbNodeMaterial(name, graph, uniforms, opts);
    this.materials.push(m);
    return m;
  }

  _build() {
    const sc = this.scene;
    const bases = baseGeometries();
    this._bases = bases;
    this.instances = {};
    const mats = {
      bg: this._material('PortBuildingBG', this.graphs.instance, this._common),
      fg: this._material('PortBuildingFG', this.graphs.instance, this._common),
      roof: this._material('PortBuildingRoof', this.graphs.instance, this._commonRoof, { transparent: true })
    };
    this.roofMaterials = [mats.roof];
    for (const set of ['bg', 'fg', 'roof']) {
      for (const kind of ['box', 'cyl', 'torus', 'cone']) {
        const data = sc.sets[set][kind];
        if (!data || !data.length) continue;
        const inst = makeInstanced(bases[kind], data, this.sphere);
        const mesh = new THREE.Mesh(inst.geo, mats[set]);
        mesh.name = `${this.root.name}_${set}_${kind}`;
        mesh.frustumCulled = true;
        if (set === 'roof') mesh.renderOrder = 20;
        this.root.add(mesh);
        this.meshes[set].push(mesh);
        this.instances[set + '_' + kind] = inst;
      }
    }
    for (const set of ['bg', 'fg', 'roof']) {
      const list = sc.plates.filter((p) => (p.set || 'bg') === set);
      if (!list.length) continue;
      const uni = set === 'roof' ? this._commonRoof : this._common;
      const mat = this._material(`PortBuildingPlates_${set}`, this.graphs.plate, uni, set === 'roof' ? { transparent: true } : {});
      if (set === 'roof') this.roofMaterials.push(mat);
      const mesh = new THREE.Mesh(makePlates(list), mat);
      mesh.name = `${this.root.name}_plates_${set}`;
      mesh.frustumCulled = true;
      if (set === 'roof') mesh.renderOrder = 20;
      this.root.add(mesh);
      this.meshes[set].push(mesh);
    }
    this.atlas = makeLabelAtlas(sc.labels);
    if (this.atlas) {
      for (const set of ['bg', 'fg', 'roof']) {
        const list = sc.labels.filter((l) => (l.set || 'bg') === set);
        if (!list.length) continue;
        const uni = { ...(set === 'roof' ? this._commonRoof : this._common), uAtlas: { value: this.atlas.tex } };
        const mat = this._material(`PortBuildingLabels_${set}`, this.graphs.label, uni, {
          transparent: true,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });
        const mesh = new THREE.Mesh(makeLabelMesh(list, this.atlas), mat);
        mesh.name = `${this.root.name}_labels_${set}`;
        mesh.frustumCulled = true;
        mesh.renderOrder = set === 'roof' ? 21 : 5;
        this.root.add(mesh);
        this.meshes[set].push(mesh);
        if (set === 'roof') this.roofMaterials.push(mat);
      }
    }
  }

  /**
   * Materiał SKÓRY CIAŁA ŚWIATA (wariant „skin” grafu — portBuildings3D.tsl.js; src/3d/worldBodies3D.js): kawałek
   * budowli, który stał się ciałem silnika belek, rysuje się tym samym cieniowaniem co jego bryły (zestaw bg / fg,
   * te same uniformy budowli: kanały, lampy, paleta, słońce). Jeden na zestaw — wartości ciała w userData siatki.
   */
  skinMaterial(set = 'bg') {
    if (!this._skinMats) this._skinMats = {};
    if (!this._skinMats[set]) this._skinMats[set] = this._material(`PortBuildingSkin_${set}`, this.graphs.skin, this._common);
    return this._skinMats[set];
  }

  /** Warstwy gospodarza: BG pod statkami, FG nad nimi (dach też w FG). */
  setLayers(bgLayer = 1, fgLayer = 2) {
    for (const m of this.meshes.bg) m.layers.set(bgLayer);
    for (const m of this.meshes.fg) m.layers.set(fgLayer);
    for (const m of this.meshes.roof) m.layers.set(fgLayer);
    this._layers = { bg: bgLayer, fg: fgLayer };
  }

  setVisible(v) { this.root.visible = !!v; }

  /**
   * Słońce w trybie przestrzeni: `sun` — punkt Słońca w UKŁADZIE GRY (y w dół)
   * albo { azimuth } (radiany, scena), `at` — punkt budowli w grze, `visibility`
   * — cień planety 0..1 (gospodarz: planeta między budowlą a Słońcem).
   */
  setSun({ sun = null, at = null, azimuth = null, elevationDeg = PORT_SPACE_LIGHT.sunElevationDeg, visibility = 1 } = {}) {
    let az = Number(azimuth);
    if (!Number.isFinite(az) && sun) {
      const ax = Number(at?.x) || 0;
      const ay = Number(at?.y) || 0;
      az = Math.atan2(-(Number(sun.y) - ay), Number(sun.x) - ax);
    }
    if (!Number.isFinite(az)) az = 0;
    const el = elevationDeg * Math.PI / 180;
    this.uniforms.uSunDirW.value.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).normalize();
    this.uniforms.uSunVisS.value = clamp01(Number(visibility));
    this.sunAzimuth = az;
  }

  _setChan(i, v) {
    const vec = this.uniforms.uChan.value[i >> 2];
    const k = i & 3;
    if (k === 0) vec.x = v; else if (k === 1) vec.y = v; else if (k === 2) vec.z = v; else vec.w = v;
  }

  /** Zegar efektów i pora dnia (lampy hal mocniejsze nocą) — woła update podklas. */
  tick(dt, { daylight = 1, lampPower = null } = {}) {
    this.time += Math.max(0, Number(dt) || 0);
    const t = this.uniforms.uPbTime.value;
    t.x = this.time;
    t.y = 1;
    t.z = clamp01(daylight);
    t.w = lampPower ?? (0.22 + 0.55 * (1 - clamp01(daylight)));
    const rt = this.roofTime.value;
    rt.x = t.x; rt.z = t.z; rt.w = t.w;
  }

  // Zanik dachu (0 = nieprzezroczysty, 1 = statek w środku — dach znika) jak K-7.
  _applyRoofFade(fade) {
    this.roofFade = clamp01(fade);
    const opacity = 1 - this.roofFade;
    this.roofTime.value.y = opacity;
    const opaque = opacity > 0.97;
    for (const m of this.roofMaterials) {
      // napisy (mieszanie własne) zawsze przezroczyste i bez zapisu głębi
      if (m.blending === THREE.CustomBlending) continue;
      m.depthWrite = opaque;
      m.transparent = !opaque;
    }
    const vis = opacity > 0.003;
    for (const mesh of this.meshes.roof) mesh.visible = vis;
  }

  get drawCalls() {
    return this.meshes.bg.length + this.meshes.fg.length + this.meshes.roof.length;
  }

  dispose() {
    for (const set of Object.values(this.meshes)) for (const m of set) m.geometry.dispose();
    for (const g of Object.values(this._bases || {})) g.dispose();
    for (const m of this.materials) m.dispose();
    this.atlas?.tex.dispose();
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Stocznia: pochylnie z kadłubami w budowie, jeden dźwig na pochylnię, rój
// dronów i taśma (portShipyardSwarm.js — rysowane przez Z5), place postoju / refitu

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Stan stoczni na klatkę (update):
 *   slips     [{ hullId, classId, progress } | null] — slipStatesFromYard(yard)
 *   launch    [0..1] — światła zejścia pochylni (opcjonalnie; domyślnie przy progress ≥ 1)
 *   pads      { [id placu]: 1 zajęty | 2 refit } — lampy placów (brak = bez zmian)
 *   refit     [{ pad (plac albo id), length, beam, work 0..1 }] — refit okrętu na
 *             placu: drony ze składu przy rdzeniu (brak = bez zmian)
 *   belt      false — taśma stoi
 *   daylight  0 noc .. 1 dzień (lampy)
 * Rój i taśmę rysuje gospodarz przez Z5: pushCargo(CargoContainers3D, CargoDrones3D, pose).
 */
export class PortShipyard3D extends PortBuilding3D {
  constructor(opts) {
    const style = opts.style && opts.style.palette ? opts.style : resolvePortBuildingStyle(opts.style || 'earth');
    super({ ...opts, style, scene: buildShipyardScene(opts.layout, style), name: opts.name || `Stocznia ${opts.layout.id}` });
    this.rig = this.scene.rig;
    this.hulls = this.layout.slips.map((s) => new PortHullBuild3D({ slip: s, building: this }));
    for (const h of this.hulls) {
      this.root.add(h.mesh);
      this.meshes.bg.push(h.mesh);
    }
    this.slipState = this.layout.slips.map(() => null);
    this.swarm = createShipyardSwarm(this.layout, { seed: opts.seed });
    this.pads = shipyardPads(this.layout);
    this._padById = new Map(this.pads.map((p) => [p.id, p]));
    this._padBits = { busy: 0, refit: 0 };
    this._refit = [];
    this._refitPool = [];
    this._belt = true;
    this.update(0, {});
  }

  /** Plac piasty po id (albo sam plac). */
  pad(idOrPad) {
    if (!idOrPad) return null;
    return typeof idOrPad === 'string' ? this._padById.get(idOrPad) || null : idOrPad;
  }

  _slipChannels(i) {
    const s = this.layout.slips[i];
    const st = this.slipState[i];
    const job = this.swarm.slips[i];
    const base = YARD_CH.slipBase(i);
    const p = st ? clamp01(st.progress) : 0;
    const building = !!st && p < 0.999;
    const stage = !building ? 'idle' : p < HULL_BUILD_STAGES.keel[1] ? 'keel' : p < HULL_BUILD_STAGES.frames[1] ? 'frames' : p < HULL_BUILD_STAGES.plating[1] ? 'plating' : 'outfit';
    const work = !building ? 0 : stage === 'keel' ? 0.6 : stage === 'outfit' ? 0.35 : 1;
    this._setChan(base, work);
    this._setChan(base + 1, clamp01((job.front - s.z0) / s.length));
    const launch = Number.isFinite(this._launch?.[i]) ? this._launch[i] : (st && p >= 0.999 ? 1 : 0);
    this._setChan(base + 2, launch);
  }

  // Dźwigi z pozy roju (portShipyardSwarm: kursy stacja taśmy ↔ czoło budowy).
  _cranes() {
    const G = this.uniforms.uGroup.value;
    for (let i = 0; i < this.layout.slips.length; i++) {
      const s = this.layout.slips[i];
      const r = this.rig.slips[i].crane;
      const cr = this.swarm.cranes[i];
      G[r.bridge].makeTranslation(s.x, 0, cr.z);
      G[r.trolley].copy(G[r.bridge]).multiply(_m.makeTranslation(cr.x - s.x, 0, 0));
      G[r.hoist].copy(G[r.trolley]).multiply(_m.makeTranslation(0, k7HeightToZ(cr.hookY), 0));
      const z0 = k7HeightToZ(cr.hookY + 14);
      const z1 = k7HeightToZ(r.top + 34);
      const cl = Math.max(1, z1 - z0);
      _m2.makeScale(1, cl / K7_ABOVE_SCALE, 1);
      G[r.cables].copy(G[r.trolley]).multiply(_m.makeTranslation(0, (z0 + z1) / 2, 0)).multiply(_m2);
    }
  }

  _refitState(list) {
    const out = this._refit;
    out.length = 0;
    if (!list) return out;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      const pad = this.pad(e?.pad);
      if (!pad) continue;
      const o = this._refitPool[out.length] || (this._refitPool[out.length] = { pad: null, length: 0, beam: 0, work: 1 });
      o.pad = pad;
      o.length = Number(e.length) || pad.maxLength;
      o.beam = Number(e.beam) || pad.maxBeam;
      o.work = e.work ?? 1;
      out.push(o);
    }
    return out;
  }

  /** Stan klatki (patrz opis klasy). */
  update(dt, state = NO_STATE) {
    this.tick(dt, state);
    if (Array.isArray(state.slips)) {
      for (let i = 0; i < this.layout.slips.length; i++) {
        const st = state.slips[i] || null;
        this.slipState[i] = st;
        this.hulls[i].setState(st, this.time);
      }
    } else {
      for (const h of this.hulls) h.setState(h.state, this.time);
    }
    this._launch = state.launch || null;
    if (state.belt !== undefined) this._belt = state.belt !== false;
    if (state.refit !== undefined) this._refitState(state.refit);
    if (state.pads) {
      let busy = 0;
      let refit = 0;
      for (let i = 0; i < this.pads.length; i++) {
        const v = state.pads[this.pads[i].id];
        if (v === 1 || v === 2) busy += 2 ** i;
        if (v === 2) refit += 2 ** i;
      }
      this._padBits.busy = busy;
      this._padBits.refit = refit;
    }
    stepShipyardSwarm(this.swarm, this.time, { slips: this.slipState, refit: this._refit, belt: this._belt });
    this.uniforms.uGroup.value[0].identity();
    for (let i = 0; i < this.layout.slips.length; i++) this._slipChannels(i);
    this._cranes();
    let depots = 0;
    for (let i = 0; i < this.swarm.depots.length; i++) if (this.swarm.depots[i].pad) depots += 2 ** i;
    this._setChan(YARD_CH.refitOn, depots);
    this._setChan(YARD_CH.padsBusy, this._padBits.busy);
    this._setChan(YARD_CH.belt, this._belt ? 1 : 0);
    this._setChan(YARD_CH.padsRefit, this._padBits.refit);
  }

  /**
   * Rój dronów, taśma, stacje i ładunek dźwigów przez renderery Z5 (po ich
   * begin(), przed end()). pose — portModuleCargoPose(ramka ruchu, stacja).
   */
  pushCargo(containers, drones, pose) {
    return pushShipyardSwarm(this.swarm, containers, drones, pose, this.time);
  }

  dispose() {
    for (const h of this.hulls) h.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Hangar postojowy

/**
 * Stan hangaru na klatkę (update):
 *   fill     [0..1] zajętość każdego bębna (kolejność layout.drums) albo
 *            occupancy (liczba statków) — rozkładana po bębnach klasami
 *   heavy    0..1 zajętość zatoki ciężkiej
 *   queue    liczba statków w kolejce przed bramą IN
 *   gateIn   0 czerwone / 1 zielone, gateOut 0/1
 *   events   [{ drum, dir: +1 (przyjęcie) | −1 (wydanie) }] — obrót bębna o gniazdo
 *   daylight 0..1
 */
export class PortHangar3D extends PortBuilding3D {
  constructor(opts) {
    const style = opts.style && opts.style.palette ? opts.style : resolvePortBuildingStyle(opts.style || 'earth');
    super({ ...opts, style, scene: buildHangarScene(opts.layout, style), name: opts.name || `Hangar ${opts.layout.id}` });
    this.rig = this.scene.rig;
    this._drumAngle = this.layout.drums.map((d, i) => (i * 0.37) % (TAU / d.slots));
    this._drumTarget = this._drumAngle.slice();
    this._fill = new Float32Array(this.layout.drums.length);
    this.update(0, {});
  }

  /** Obrót bębna o jedno gniazdo (przyjęcie +1, wydanie −1). */
  rotateDrum(i, dir = 1) {
    const d = this.layout.drums[i];
    if (!d) return;
    this._drumTarget[i] += (dir < 0 ? -1 : 1) * TAU / d.slots;
  }

  update(dt, state = NO_STATE) {
    this.tick(dt, state);
    const events = state.events;
    if (events) for (let k = 0; k < events.length; k++) this.rotateDrum(events[k].drum, events[k].dir);
    const G = this.uniforms.uGroup.value;
    G[0].identity();
    const roofY = this.layout.roofBase + 60;
    const fill = Array.isArray(state.fill) || ArrayBuffer.isView(state.fill) ? state.fill : null;
    for (let i = 0; i < this.layout.drums.length; i++) {
      const d = this.layout.drums[i];
      this._drumAngle[i] = dt > 0 ? approach(this._drumAngle[i], this._drumTarget[i], 1.4, dt) : this._drumTarget[i];
      _q.setFromAxisAngle(_yAxis, this._drumAngle[i]);
      _v.set(d.x, k7HeightToZ(roofY), d.z);
      G[this.rig.drums[i]].compose(_v, _q, _one);
      if (fill) this._fill[i] = clamp01(Number(fill[i]) || 0);
      this._setChan(HANGAR_CH.drum(i), this._fill[i]);
    }
    if (state.gateIn !== undefined) this._setChan(HANGAR_CH.gateIn, clamp01(Number(state.gateIn)));
    if (state.queue !== undefined) this._setChan(HANGAR_CH.queue, Math.max(0, Number(state.queue) || 0));
    if (state.gateOut !== undefined) this._setChan(HANGAR_CH.gateOut, clamp01(Number(state.gateOut)));
    if (state.heavy !== undefined) this._setChan(HANGAR_CH.heavy, clamp01(Number(state.heavy)));
  }
}

