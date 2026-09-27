// src/3d/cargoDrones3D.js
//
// DRONY PRZEŁADUNKOWE 3D w porcie ringu (Z5, plan § 3.4). Pozy liczy
// cargoPortOps.js (transferState — bez stanu, z ziarna kursu i czasu postoju);
// tu tylko rysowanie. Port jest w próżni: drony latają na silnikach
// manewrowych (bloki RCS w narożach), nie na wirnikach.
//
// RYSOWANIE (Core3D, bez własnego renderera), 2 wywołania na wszystkie drony:
//   • drony — jedna scalona geometria (korpus, belki, 4 bloki RCS, rama
//     chwytaka o obrysie kontenera, zamki) w instancjach, warstwa 0, pass
//     ortho z tą samą paralaksą, ściskiem głębi i światłem co kontenery
//     (CARGO_VIEW_GLSL / CARGO_LIGHT_GLSL z cargoContainers3D.js);
//   • światła — pozycyjne (czerwone/zielone), kogut na grzbiecie, białe
//     światło rufowe i błyski RCS przy przyspieszaniu: billboardy w FG
//     (warstwa 2, addytywnie, pasma HDR jak światła pozycyjne okrętów),
//     z testem głębi FG (dach hali, suwnice i górna ściana je zasłaniają).
//     Pass FG ma kamerę perspektywiczną: światło nad płaszczyzną lotu
//     przesuwamy odwrotnie do paralaksy, żeby siedziało na dronie z passu ortho.
// Cienie dronów idą do cargoContainers3D (kadłub / pokład portu).
//
// Klej przeładunku: pushCargoScene(state, plan, berthPose) — pokład, niesione,
// plac, włazy wind i drony jednego stanowiska.

import * as THREE from 'three';
import {
  CARGO3D_TUNE,
  CARGO_LIGHT_GLSL,
  CARGO_NOISE_GLSL,
  CARGO_VIEW_GLSL,
  CargoContainers3D
} from './cargoContainers3D.js';
import { SUN_SHADOW_GLSL } from './sunShadowMask.js';
import {
  CARGO_DRONE,
  CARGO_DRONE_STRIDE,
  CARGO_HATCH,
  CARGO_HATCH_STRIDE,
  CARGO_LOOSE,
  CARGO_LOOSE_STRIDE
} from '../game/cargoPortOps.js';
import { cargoHash01 } from '../data/cargoContainers.js';

export const CARGO_DRONE_TUNE = {
  enabled: true,
  minPx: 2.5,          // krótszy bok drona na ekranie: poniżej gaśnie bryła
  fullPx: 5,
  lightMinPx: 0.35,    // ...a światła zostają dłużej (drony z daleka = punkty)
  navCore: 4.5,        // jak światła pozycyjne okrętów (bridge3D beaconCoreGain)
  navHalo: 0.5,
  beaconCore: 3.2,
  rcsCore: 3.0,
  lightPx: 1.6,        // najmniejszy promień światła na ekranie [px]
  drawLights: true
};
if (typeof window !== 'undefined') window.__cargoDroneTune = CARGO_DRONE_TUNE;

export const CARGO_DRONE_LIMITS = Object.freeze({ drones: 256, lights: 256 * 6 });
const DRONE_RENDER_ORDER = 12.5;
const LIGHT_RENDER_ORDER = 53;
const NO_CLIP = -1e9;
const FG_LAYER = 2;

const smooth01 = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / ((e1 - e0) || 1e-6)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Geometria drona (układ jednostkowy: x, y ∈ [−½, ½] = rama chwytaka o obrysie
// kontenera, z ∈ [0, 1] = wysokość drona; hak — spód ramy — w z = 0).
// ---------------------------------------------------------------------------

// Materiały: 0 żółty korpus, 1 grafit, 2 czerń (dysze), 3 pasy ostrzegawcze
// (zamki chwytaka), 4 stal (zastrzały, rama), 5 szkło czujnika.
// Części: 0 korpus, 1 rama chwytaka (opuszcza się o DROP), 2 zastrzały (rozciągają
// się), 3 bloki RCS.
// Z góry dron ma czytać się jak maszyna, nie jak obwódka kontenera: żółty
// korpus pośrodku, cztery ukośne ramiona do bloków RCS poza narożnikami
// ładunku, cienka ciemna rama chwytaka z żółto-czarnymi zamkami.
// Pudło: [x0, x1, y0, y1, z0, z1, część, materiał, (obrót wokół z)].
const POD = 0.64;                       // środek bloku RCS (ułamek ramy, x i y)
const ARM_YAW = Math.atan2(1, 1);
const DRONE_BOXES = [
  // rama chwytaka (cienka) i zamki w narożach
  [-0.5, 0.5, 0.46, 0.5, 0, 0.06, 1, 4],
  [-0.5, 0.5, -0.5, -0.46, 0, 0.06, 1, 4],
  [0.46, 0.5, -0.46, 0.46, 0, 0.06, 1, 4],
  [-0.5, -0.46, -0.46, 0.46, 0, 0.06, 1, 4],
  [0.41, 0.52, 0.41, 0.52, -0.05, 0.1, 1, 3],
  [-0.52, -0.41, 0.41, 0.52, -0.05, 0.1, 1, 3],
  [0.41, 0.52, -0.52, -0.41, -0.05, 0.1, 1, 3],
  [-0.52, -0.41, -0.52, -0.41, -0.05, 0.1, 1, 3],
  // zastrzały rama → korpus
  [0.33, 0.37, 0.33, 0.37, 0.06, 0.48, 2, 4],
  [-0.37, -0.33, 0.33, 0.37, 0.06, 0.48, 2, 4],
  [0.33, 0.37, -0.37, -0.33, 0.06, 0.48, 2, 4],
  [-0.37, -0.33, -0.37, -0.33, 0.06, 0.48, 2, 4],
  // korpus, grzbiet, czujnik z przodu, podstawa koguta
  [-0.36, 0.3, -0.27, 0.27, 0.44, 0.78, 0, 0],
  [-0.3, 0.14, -0.16, 0.16, 0.78, 0.87, 0, 1],
  [0.3, 0.42, -0.13, 0.13, 0.56, 0.74, 0, 5],
  [-0.05, 0.03, -0.04, 0.04, 0.87, 0.93, 0, 1],
  // ukośne ramiona do bloków RCS (obrócone pudła od narożników korpusu)
  ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const cx = sx * (0.3 + POD) * 0.5;
    const cy = sy * (0.25 + POD) * 0.5;
    const len = Math.hypot(POD - 0.3, POD - 0.25) * 0.5 + 0.05;
    return [cx - len, cx + len, cy - 0.035, cy + 0.035, 0.6, 0.69, 0, 1, sx * sy * ARM_YAW];
  }),
  // bloki RCS, żółte kołpaki, dysze
  ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].flatMap(([sx, sy]) => {
    const x = sx * POD;
    const y = sy * POD;
    return [
      [x - 0.11, x + 0.11, y - 0.11, y + 0.11, 0.5, 0.78, 3, 1],
      [x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0.78, 0.83, 3, 0],
      [x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0.43, 0.5, 3, 2]
    ];
  })
];

// Punkty świateł w układzie jednostkowym drona.
const NAV_LEFT = [POD, POD, 0.86];      // przedni lewy blok (+y bryły) — czerwone
const NAV_RIGHT = [POD, -POD, 0.86];    // przedni prawy — zielone
const TAIL = [-0.36, 0, 0.74];          // rufa korpusu — białe
const BEACON = [-0.01, 0, 0.96];        // kogut
const PODS = [[POD, POD], [-POD, POD], [POD, -POD], [-POD, -POD]];

export function buildDroneGeometry() {
  const pos = [];
  const nrm = [];
  const part = [];
  const mat = [];
  const idx = [];
  const face = (a, b, c, d, n, p, m) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nrm.push(n[0], n[1], n[2]); part.push(p); mat.push(m); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [x0, x1, y0, y1, z0, z1, p, m, yaw = 0] of DRONE_BOXES) {
    // Obrót pudła wokół jego środka (ramiona ukośne).
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const R = (v) => [cx + (v[0] - cx) * c - (v[1] - cy) * s, cy + (v[0] - cx) * s + (v[1] - cy) * c, v[2]];
    const N = (n) => [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
    const F = (a, b, cc, d, n) => face(R(a), R(b), R(cc), R(d), N(n), p, m);
    F([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
    F([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);
    F([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]);
    F([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    F([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    F([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]);
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    part: new Float32Array(part),
    mat: new Float32Array(mat),
    index: new Uint16Array(idx)
  };
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const DRONE_VERT = `
attribute float aPart;
attribute float aMat;
attribute vec4 iPos;
attribute vec4 iSize;
attribute vec4 iState;
${CARGO_VIEW_GLSL}
uniform vec3 uCgSunRel;
uniform vec3 uCgPortSun;
varying vec3 vUnit;
varying vec3 vObjN;
varying vec3 vObjL;
flat varying float vMat;
flat varying vec4 vSize;
flat varying vec4 vState;

void main() {
  vSize = iSize;
  vState = iState;
  vMat = aMat;
  vec3 lp = position * iSize.xyz;
  // Rama chwytaka opada o DROP, zastrzały sięgają za nią.
  float drop = iState.z;
  if (aPart > 0.5 && aPart < 1.5) lp.z -= drop;
  if (aPart > 1.5 && aPart < 2.5 && position.z < 0.3) lp.z -= drop;
  vUnit = position;
  float c = cos(iPos.w);
  float s = sin(iPos.w);
  vec3 wp = vec3(iPos.x + c * lp.x - s * lp.y, iPos.y + s * lp.x + c * lp.y, iPos.z + lp.z);
  wp.z = max(wp.z, iState.y);
  vObjN = normal;
  vec3 ls = normalize(vec3(uCgSunRel.xy - wp.xy, 600.0));
  vec3 L = normalize(mix(ls, uCgPortSun, clamp(iState.x, 0.0, 1.0)));
  vObjL = vec3(c * L.x + s * L.y, -s * L.x + c * L.y, L.z);
  gl_Position = cgProject(wp);
}
`;

const DRONE_FRAG = `
uniform vec3 uDronePaint[6];
${SUN_SHADOW_GLSL}
${CARGO_LIGHT_GLSL}
${CARGO_NOISE_GLSL}
varying vec3 vUnit;
varying vec3 vObjN;
varying vec3 vObjL;
flat varying float vMat;
flat varying vec4 vSize;
flat varying vec4 vState;

void main() {
  if (cgDitherOut(vSize.w)) discard;
  int m = int(vMat + 0.5);
  vec3 albedo = uDronePaint[m];
  float specK = 0.5;
  float specPow = 24.0;
  vec3 N = normalize(vObjN);
  vec3 wl = vUnit * vSize.xyz;
  if (m == 3) {
    // Zamki chwytaka: pasy ostrzegawcze.
    float st = step(0.5, fract((wl.x + wl.y) / max(0.035 * min(vSize.x, vSize.y), 0.12)));
    albedo = mix(albedo, vec3(0.02), st);
  } else if (m == 0) {
    // Panele korpusu i lekkie zabrudzenie.
    albedo *= 0.88 + 0.2 * cgNoise(wl.xy * (3.0 / max(vSize.y, 1.0)) + vState.w * 13.0);
    specK = 0.7;
  } else if (m == 5) {
    specK = 2.0; specPow = 64.0;
  } else if (m == 4) {
    specK = 1.1; specPow = 40.0;
  }
  vec3 col = cgShade(albedo, N, normalize(vObjL), vState.x, uCgShip.x, specK, specPow);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Światła: billboard w FG. iLight: środek (względem origin, prawdziwe z) i promień,
// iColor: barwa × moc, kształt (0 punkt z poświatą, 1 błysk RCS).
const LIGHT_VERT = `
attribute vec4 iLight;
attribute vec4 iColor;
uniform vec4 uFgParallax;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uBillboard;
varying vec2 vQ;
flat varying vec4 vColor;

void main() {
  vQ = position.xy * 2.0;
  vColor = iColor;
  vec3 p = iLight.xyz;
  float r = iLight.w;
  // Pass FG ma kamerę perspektywiczną nad z = 0: nad płaszczyzną lotu dron jest
  // w passie ortho bez paralaksy, więc światło cofamy o nią (pozycja i skala).
  if (uFgParallax.w > 0.5 && p.z > 0.0) {
    float k = (uFgParallax.z - p.z) / uFgParallax.z;
    p.xy = uFgParallax.xy + (p.xy - uFgParallax.xy) * k;
    r *= k;
  }
  vec3 right = uBillboard > 0.5 ? uCamRight : vec3(1.0, 0.0, 0.0);
  vec3 up = uBillboard > 0.5 ? uCamUp : vec3(0.0, 1.0, 0.0);
  vec3 wp = p + (right * position.x + up * position.y) * 2.0 * r;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
}
`;

const LIGHT_FRAG = `
uniform vec2 uLightGain;
varying vec2 vQ;
flat varying vec4 vColor;

void main() {
  float d = length(vQ);
  if (d > 1.0) discard;
  float core;
  float halo;
  if (vColor.w > 0.5) {
    // Błysk RCS: miękki obłok bez twardego rdzenia.
    core = exp(-d * d * 9.0);
    halo = exp(-d * d * 3.0) * 0.25;
  } else {
    core = 1.0 - smoothstep(0.12, 0.22, d);
    halo = pow(max(0.0, 1.0 - d), 2.4) * (1.0 - core);
  }
  vec3 col = vColor.rgb * (core + halo * uLightGain.x);
  float a = clamp(core + halo * 0.5, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
}
`;

// ---------------------------------------------------------------------------
// Zasoby
// ---------------------------------------------------------------------------

function makeInstanceAttr(geometry, name, itemSize, capacity) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attr);
  return attr;
}

function commitAttr(attr, count) {
  if (count <= 0) return;
  const ranges = attr.updateRanges;
  if (Array.isArray(ranges)) {
    const r = attr.__cgRange || (attr.__cgRange = { start: 0, count: 0 });
    r.start = 0;
    r.count = count * attr.itemSize;
    ranges.length = 0;
    ranges.push(r);
  }
  attr.needsUpdate = true;
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex) {
  const raw = String(hex || '').replace(/^#/, '');
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(raw.slice(i, i + 2), 16) / 255));
}

// Farby: przemysłowy żółty, grafit, czerń, żółć pasów, stal, szkło czujnika.
export const CARGO_DRONE_PAINT = Object.freeze(['#d99a2b', '#2b2f33', '#101214', '#e0b025', '#8a9097', '#1c3848']);
const NAV_RED = [1.0, 0.13, 0.08];
const NAV_GREEN = [0.12, 1.0, 0.35];
const NAV_WHITE = [0.95, 0.97, 1.0];
const BEACON_AMBER = [1.0, 0.55, 0.12];
const RCS_BLUE = [0.55, 0.78, 1.0];

const _cr = new THREE.Vector3();
const _cu = new THREE.Vector3();

// Punkt układu jednostkowego drona → scena (w: środek, kurs i wymiary drona).
function placeOnDrone(p, w) {
  const lx = p[0] * w.L;
  const ly = p[1] * w.W;
  w.x = w.sx + w.c * lx - w.s * ly;
  w.y = w.sy + w.s * lx + w.c * ly;
  w.z = w.sz + p[2] * w.H;
  return w;
}

export const CargoDrones3D = {
  scene: null,
  ready: false,
  mesh: null,
  attrs: null,
  lights: null,
  count: 0,
  stats: { drones: 0, lights: 0, drawCalls: 0, faded: 0 },

  attach(scene) {
    if (this.scene === scene && this.ready) return true;
    this.dispose();
    if (!scene) return false;
    if (!CargoContainers3D.ready) CargoContainers3D.attach(scene);
    this.scene = scene;
    const U = CargoContainers3D.uniforms;
    {
      const g = buildDroneGeometry();
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
      geo.setAttribute('aPart', new THREE.BufferAttribute(g.part, 1));
      geo.setAttribute('aMat', new THREE.BufferAttribute(g.mat, 1));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      const attrs = {
        pos: makeInstanceAttr(geo, 'iPos', 4, CARGO_DRONE_LIMITS.drones),
        size: makeInstanceAttr(geo, 'iSize', 4, CARGO_DRONE_LIMITS.drones),
        state: makeInstanceAttr(geo, 'iState', 4, CARGO_DRONE_LIMITS.drones)
      };
      geo.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, uDronePaint: { value: CARGO_DRONE_PAINT.map((h) => new THREE.Vector3(...hexToLinear(h))) } },
        vertexShader: DRONE_VERT,
        fragmentShader: DRONE_FRAG,
        transparent: true,
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
        forceSinglePass: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'CARGO3D_DRONES';
      mesh.frustumCulled = false;
      mesh.renderOrder = DRONE_RENDER_ORDER;
      mesh.visible = false;
      scene.add(mesh);
      this.mesh = mesh;
      this.attrs = attrs;
    }
    {
      const plane = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', plane.getAttribute('position'));
      geo.setIndex(plane.getIndex());
      const attrs = {
        light: makeInstanceAttr(geo, 'iLight', 4, CARGO_DRONE_LIMITS.lights),
        color: makeInstanceAttr(geo, 'iColor', 4, CARGO_DRONE_LIMITS.lights)
      };
      geo.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uFgParallax: { value: new THREE.Vector4() },
          uCamRight: { value: new THREE.Vector3(1, 0, 0) },
          uCamUp: { value: new THREE.Vector3(0, 1, 0) },
          uBillboard: { value: 0 },
          uLightGain: { value: new THREE.Vector2(CARGO_DRONE_TUNE.navHalo, 0) }
        },
        vertexShader: LIGHT_VERT,
        fragmentShader: LIGHT_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'CARGO3D_DRONE_LIGHTS';
      mesh.frustumCulled = false;
      mesh.renderOrder = LIGHT_RENDER_ORDER;
      mesh.layers.set(FG_LAYER);
      mesh.visible = false;
      scene.add(mesh);
      this.lights = { mesh, geometry: geo, material: mat, attrs, count: 0, capacity: CARGO_DRONE_LIMITS.lights };
    }
    this.ready = true;
    return true;
  },

  /** Warstwy: bryły (domyślnie 0) i światła (domyślnie FG = 2). */
  setLayers(body = 0, lights = FG_LAYER) {
    if (this.mesh) this.mesh.layers.set(body);
    if (this.lights) this.lights.mesh.layers.set(lights);
  },

  /**
   * Początek klatki — po CargoContainers3D.begin (wspólny początek, kamera,
   * światło). camera3 — kamera perspektywiczna (billboardy w wolnej kamerze).
   */
  begin(opts = {}) {
    if (!this.ready) return;
    const F = CargoContainers3D.frame;
    this.mesh.position.set(F.originX, F.originY, 0);
    this.lights.mesh.position.set(F.originX, F.originY, 0);
    const u = this.lights.material.uniforms;
    u.uFgParallax.value.set(F.camX - F.originX, F.camY - F.originY, F.H, F.parallax ? 1 : 0);
    u.uBillboard.value = F.perspective ? 1 : 0;
    u.uLightGain.value.set(CARGO_DRONE_TUNE.navHalo, 0);
    const cam = opts.camera3;
    if (F.perspective && cam?.matrixWorld) {
      const e = cam.matrixWorld.elements;
      _cr.set(e[0], e[1], e[2]).normalize();
      _cu.set(e[4], e[5], e[6]).normalize();
      u.uCamRight.value.copy(_cr);
      u.uCamUp.value.copy(_cu);
    }
    this.count = 0;
    this.lights.count = 0;
    this.stats.faded = 0;
  },

  _light(x, y, z, r, rgb, gain, shape) {
    const Lt = this.lights;
    if (Lt.count >= Lt.capacity || gain <= 0.003) return;
    const F = CargoContainers3D.frame;
    const n = Lt.count++;
    const o = n * 4;
    const P = Lt.attrs.light.array;
    P[o] = x - F.originX; P[o + 1] = y - F.originY; P[o + 2] = z; P[o + 3] = r;
    const C = Lt.attrs.color.array;
    C[o] = rgb[0] * gain; C[o + 1] = rgb[1] * gain; C[o + 2] = rgb[2] * gain; C[o + 3] = shape;
  },

  /**
   * Dron w układzie stanowiska. berthPose — { x, y, angle } świata gry, d —
   * rekord transferState (Float32Array) i jego przesunięcie, size — { L, W, H }
   * drona z planu, time — czas animacji świateł.
   */
  pushDrone(berthPose, d, o, size, time = 0) {
    if (!this.ready || !CARGO_DRONE_TUNE.enabled) return false;
    const F = CargoContainers3D.frame;
    const T = CARGO_DRONE_TUNE;
    const ang = Number(berthPose.angle) || 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const u = d[o + CARGO_DRONE.U];
    const v = d[o + CARGO_DRONE.V];
    const z = d[o + CARGO_DRONE.Z];
    const gx = berthPose.x + u * c - v * s;
    const gy = berthPose.y + u * s + v * c;
    const sx = gx;
    const sy = -gy;
    const yaw = -(ang + d[o + CARGO_DRONE.YAW]);
    const k = CargoContainers3D._k(z);
    const px = Math.min(size.L, size.W) * F.pxPerUnit * k;
    const reach = Math.max(size.L, size.W) * 1.5;
    if (!CargoContainers3D._inView(sx, sy, reach)) return false;
    const light = Math.max(0, Math.min(1, -z / 60));
    const clip = d[o + CARGO_DRONE.CLIP];
    const seed = d[o + CARGO_DRONE.SEED];
    const fade = smooth01(T.minPx, T.fullPx, px);
    if (fade > 0.01 && this.count < CARGO_DRONE_LIMITS.drones) {
      const n = this.count++;
      const q = n * 4;
      const P = this.attrs.pos.array;
      P[q] = sx - F.originX; P[q + 1] = sy - F.originY; P[q + 2] = z; P[q + 3] = yaw;
      const S = this.attrs.size.array;
      S[q] = size.L; S[q + 1] = size.W; S[q + 2] = size.H; S[q + 3] = fade;
      const St = this.attrs.state.array;
      St[q] = light; St[q + 1] = clip > -1e8 ? clip : NO_CLIP; St[q + 2] = d[o + CARGO_DRONE.DROP]; St[q + 3] = seed;
      // Cień drona (korpus z ramionami, bez ramy chwytaka): na kadłub pod nim
      // i na pokład portu.
      if (CARGO3D_TUNE.drawShadows && px >= CARGO3D_TUNE.shadowMinPx) {
        const sf = smooth01(CARGO3D_TUNE.shadowMinPx, CARGO3D_TUNE.shadowFullPx, px) * fade * 0.8;
        const z0 = z + size.H * 0.44;
        const z1 = z + size.H * 0.87;
        if (z1 > 0) CargoContainers3D.pushHullShadow(sx, sy, yaw, size.L * 0.95, size.W * 0.8, Math.max(0, z0), z1, CARGO3D_TUNE.shadowStrength * sf);
        CargoContainers3D.pushDeckShadow(sx, sy, yaw, size.L * 0.95, size.W * 0.8, z0, z1, CARGO3D_TUNE.deckShadowStrength * sf);
      }
    } else if (fade <= 0.01) {
      this.stats.faded++;
    }
    // Światła: pozycyjne, rufowe, kogut, błyski RCS.
    if (!T.drawLights || px < T.lightMinPx) return true;
    if (clip > -1e8 && z < clip + size.H * 0.5) return true;   // jeszcze w wyłazie gniazda
    const pxu = 1 / (F.pxPerUnit * k);
    const rNav = Math.max(0.07 * Math.min(size.L, size.W), T.lightPx * pxu);
    const w = this._w || (this._w = { x: 0, y: 0, z: 0, sx: 0, sy: 0, sz: 0, c: 1, s: 0, L: 1, W: 1, H: 1 });
    w.sx = sx; w.sy = sy; w.sz = z; w.c = Math.cos(yaw); w.s = Math.sin(yaw); w.L = size.L; w.W = size.W; w.H = size.H;
    const place = placeOnDrone;
    const litK = smooth01(T.lightMinPx, T.lightMinPx * 4, px);
    place(NAV_LEFT, w); this._light(w.x, w.y, w.z, rNav, NAV_RED, T.navCore * litK, 0);
    place(NAV_RIGHT, w); this._light(w.x, w.y, w.z, rNav, NAV_GREEN, T.navCore * litK, 0);
    // Rufa: krótki biały błysk co ~1,6 s (faza z ziarna).
    const ph = (time / 1.6 + seed) % 1;
    if (ph < 0.08) { place(TAIL, w); this._light(w.x, w.y, w.z, rNav * 1.2, NAV_WHITE, T.navCore * 1.4 * litK, 0); }
    // Kogut: bursztynowy, pulsuje szybciej, gdy niesie ładunek.
    const carrying = d[o + CARGO_DRONE.CARRY] > 0.5;
    const bp = (time * (carrying ? 1.8 : 0.9) + seed * 3.1) % 1;
    const beacon = Math.max(0, Math.sin(bp * Math.PI * 2)) ** 3;
    place(BEACON, w); this._light(w.x, w.y, w.z, rNav * 1.3, BEACON_AMBER, T.beaconCore * beacon * litK, 0);
    // RCS: bloki po stronie przeciwnej do przyspieszenia (wydmuch = −a) i dysze
    // w dół, gdy przyspiesza w górę (start wznoszenia, hamowanie opadania).
    const thrust = d[o + CARGO_DRONE.THRUST];
    if (thrust > 0.25) {
      const au = d[o + CARGO_DRONE.AU];
      const av = d[o + CARGO_DRONE.AV];
      const az = d[o + CARGO_DRONE.AZ];
      // Stanowisko (u, v) → świat gry → scena (lustro y) → układ bryły drona.
      const gxA = au * c - av * s;
      const gyA = au * s + av * c;
      const cy = Math.cos(yaw);
      const sy2 = Math.sin(yaw);
      const ax = gxA * cy + (-gyA) * sy2;
      const ay = -gxA * sy2 + (-gyA) * cy;
      const rPuff = Math.max(0.1 * Math.min(size.L, size.W), T.lightPx * 1.2 * pxu);
      const g = T.rcsCore * (thrust - 0.25) / 0.75 * litK;
      const pl = this._pl || (this._pl = [0, 0, 0]);
      for (let i = 0; i < PODS.length; i++) {
        const p = PODS[i];
        const side = -(p[0] / POD * ax + p[1] / POD * ay) * 0.5;
        const k2 = Math.max(0, side) + (az > 0.2 ? az * 0.6 : 0);
        if (k2 < 0.15) continue;
        const flick = 0.75 + 0.25 * Math.sin(time * 47 + i * 1.7 + seed * 11);
        pl[0] = p[0] - ax * 0.14;
        pl[1] = p[1] - ay * 0.14;
        pl[2] = az > 0.2 ? 0.42 : 0.62;
        place(pl, w);
        this._light(w.x, w.y, w.z, rPuff, RCS_BLUE, g * k2 * flick, 1);
      }
    }
    return true;
  },

  end() {
    if (!this.ready) return;
    const n = this.count;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    let draws = 0;
    if (n) {
      draws++;
      for (const a of Object.values(this.attrs)) commitAttr(a, n);
    }
    const Lt = this.lights;
    Lt.geometry.instanceCount = Lt.count;
    Lt.mesh.visible = Lt.count > 0;
    if (Lt.count) {
      draws++;
      for (const a of Object.values(Lt.attrs)) commitAttr(a, Lt.count);
    }
    this.stats.drones = n;
    this.stats.lights = Lt.count;
    this.stats.drawCalls = draws;
  },

  dispose() {
    const scene = this.scene;
    for (const part of [this.mesh ? { mesh: this.mesh } : null, this.lights]) {
      if (!part?.mesh) continue;
      if (scene) scene.remove(part.mesh);
      part.mesh.geometry?.dispose?.();
      part.mesh.material?.dispose?.();
    }
    this.mesh = null;
    this.attrs = null;
    this.lights = null;
    this.scene = null;
    this.ready = false;
  }
};

/**
 * Jedno stanowisko z przeładunkiem: pokład statku, kontenery niesione i na
 * placu, włazy wind, drony (ze światłami i cieniami). state — transferState,
 * plan — planCargoTransfer, berthPose — { x, y, angle } świata gry (statek
 * zadokowany), opts.shipPose — poza statku, gdy już odlatuje (pokład jedzie
 * z nim), opts.deckMode, opts.mask, opts.time.
 */
export function pushCargoScene(state, plan, berthPose, opts = {}) {
  const C = CargoContainers3D;
  if (!state || !plan || !berthPose) return;
  const lay = plan.layout;
  const grid = lay.unit.nx + 8 * lay.unit.ny + 64 * lay.unit.tiers;
  const ship = opts.shipPose || berthPose;
  if (opts.deck !== false) C.pushShipDeck(ship, lay.hullId, state.slotRes, plan.seed, { scale: plan.scale, deckMode: opts.deckMode, mask: opts.mask, spriteRotation: opts.spriteRotation });
  C.setDeckZ(plan.deckZ);
  const unit = plan.unit;
  const L = state.carried;
  for (let i = 0; i < state.carriedCount; i++) {
    const o = i * CARGO_LOOSE_STRIDE;
    C.pushBerthContainer(berthPose, L[o + CARGO_LOOSE.U], L[o + CARGO_LOOSE.V], L[o + CARGO_LOOSE.Z], L[o + CARGO_LOOSE.YAW],
      unit, grid, L[o + CARGO_LOOSE.RES], cargoHash01(plan.seed, L[o + CARGO_LOOSE.UNIT], 5), NO_CLIP, L[o + CARGO_LOOSE.LIGHT], 'loose');
  }
  const Y = state.yard;
  for (let i = 0; i < state.yardCount; i++) {
    const o = i * CARGO_LOOSE_STRIDE;
    C.pushBerthContainer(berthPose, Y[o + CARGO_LOOSE.U], Y[o + CARGO_LOOSE.V], Y[o + CARGO_LOOSE.Z], Y[o + CARGO_LOOSE.YAW],
      unit, grid, Y[o + CARGO_LOOSE.RES], cargoHash01(plan.seed, Y[o + CARGO_LOOSE.UNIT], 5), Y[o + CARGO_LOOSE.CLIP], 1, 'yard');
  }
  const Hh = state.hatches;
  for (let i = 0; i < state.hatchCount; i++) {
    const o = i * CARGO_HATCH_STRIDE;
    C.pushBerthHatch(berthPose, Hh[o + CARGO_HATCH.U], Hh[o + CARGO_HATCH.V], Hh[o + CARGO_HATCH.YAW], Hh[o + CARGO_HATCH.L], Hh[o + CARGO_HATCH.W], Hh[o + CARGO_HATCH.OPEN], plan.deckZ);
  }
  const D = state.drones;
  for (let i = 0; i < state.droneCount; i++) CargoDrones3D.pushDrone(berthPose, D, i * CARGO_DRONE_STRIDE, plan.drone, opts.time || 0);
}

if (typeof window !== 'undefined') window.CargoDrones3D = CargoDrones3D;
