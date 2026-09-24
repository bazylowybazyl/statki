// Render portu K-7 (dok gameplayowy) na ringu „Halo”. Dane brył z
// haloPortK7Build.js; tu: instancje (prostopadłościan / walec / torus) w
// zestawach BG (pod statkami) i FG (nad statkami: suwnice, węże, dach),
// płaskie wielokąty pokładu, napisy z atlasu i dynamiczne węże paliwowe.
//
// Materiały K-7 (stal, ciemny metal, jasne płyty, żółte, pokład z płyt,
// farba, cyjanowe listwy) oddane w modelu światła ringu: widoczność słońca
// z cieniem planety i ringu, światło planety, dwie lampy hali liczone
// w shaderze (bez PointLight — gra ma enginePointLights: false).
//
// Draw calle: BG ≤ 5, FG ≤ 6 niezależnie od liczby brył. Pozycje przez
// modelViewMatrix (liczone w double po stronie CPU), więc bez drgań.
import * as THREE from 'three';
import { HALO_GLSL_COMMON, HALO_GLSL_LIGHT, HALO_GLSL_NOISE } from './haloRingGLSL.js';
import { K7_ABOVE_SCALE, K7_HEIGHTS, k7Frame, k7HeightToZ, k7Phase } from './haloPortK7Layout.js';
import { K7_INSTANCE_STRIDE, K7_MAT, buildK7Scene } from './haloPortK7Build.js';
import { haloFrameToFrame, haloXfPoint } from './haloPortBays.js';

const MAX_GROUPS = 40;   // 4 suwnice × 6 grup + 8 złączek + grupa 0
const MAX_LAMPS = 10;    // lampy hali (4) + po trzy nad każdą z 2 zatok kompleksu (pasy MEGA, grzebień)
const f3 = (a) => a.map((x) => x.toFixed(4)).join(', ');
const srgb = (hex) => {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
};

// Paleta K-7 (kolory z DockMaterials, sRGB → liniowe).
const K7_PALETTE = [
  srgb(0x81909a), srgb(0x27323c), srgb(0xd1d0bf), srgb(0xd4a44f), srgb(0xaf693b), srgb(0x38777d),
  srgb(0x8c9ba3), srgb(0x879797), srgb(0x101920), srgb(0x343b3d), srgb(0x987955), srgb(0x153d4a),
  srgb(0xc9b587), srgb(0x84c1c6)
];
// Emisja: pasmo barwne 0,9–1,3 (bloomuje i zostaje barwne), biel ~1,4.
const K7_EMIT = [
  [0.30, 1.12, 1.28],   // cyan
  [1.28, 0.78, 0.30],   // warm
  [1.40, 1.36, 1.14],   // white
  [1.28, 0.16, 0.08],   // red
  [0.40, 1.15, 0.66]    // green
];

const GLSL_K7_SURFACE = /* glsl */`
uniform mat4 uHub;                 // hub (z odwzorowaną wysokością) → układ ringu
uniform vec3 uGroupEmit[${MAX_GROUPS}];
uniform float uRoofOpacity;
uniform vec4 uHallLights;          // x: moc lamp hali, y: moc dnia (0..1), z: czas
uniform vec4 uLamps[${MAX_LAMPS}];        // lampy hali i zatok: xyz w hubie, w: 0 brak, 1 ciepla, 2 zimna
varying vec3 vRing;
varying vec3 vHub;
varying vec3 vHubN;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vGroup;

vec3 k7Palette(float m) {
  ${K7_PALETTE.map((c, i) => `if (m < ${i}.5) return vec3(${f3(c)});`).join('\n  ')}
  return vec3(0.02, 0.022, 0.025);
}
vec3 k7Emit(float m) {
  if (m < 14.5) return vec3(${f3(K7_EMIT[0])});
  if (m < 15.5) return vec3(${f3(K7_EMIT[1])});
  if (m < 16.5) return vec3(${f3(K7_EMIT[2])});
  if (m < 17.5) return vec3(${f3(K7_EMIT[3])});
  return vec3(${f3(K7_EMIT[4])});
}
// Płyty jak tekstura K-7: 3 × 4 płyty na kafel 260 j. (pokład 4 × 4), jaśniejsza
// krawędź od góry-lewej, ciemna spoina, śruby w narożnikach, zacieki.
float k7Plates(vec2 uv, bool deck, float fw, out float highlight) {
  vec2 cells = deck ? vec2(4.0, 4.0) : vec2(3.0, 4.0);
  vec2 g = uv / 260.0 * cells;
  vec2 id = floor(g);
  vec2 fcell = fract(g);
  vec2 psz = 260.0 / cells;
  vec2 d = min(fcell, 1.0 - fcell) * psz;           // odleglosc od krawedzi plyty [j.]
  float aa = fw * 1.2 + 0.2;
  float seam = 1.0 - smoothstep(0.35, 0.35 + aa, min(d.x, d.y));
  highlight = (1.0 - smoothstep(0.7, 0.7 + aa, fcell.x * psz.x)) + (1.0 - smoothstep(0.7, 0.7 + aa, (1.0 - fcell.y) * psz.y));
  highlight *= 1.0 - seam;
  float v = haloHash12(id + (deck ? 17.0 : 3.0));
  vec2 b = abs(fcell * psz - 4.4);
  vec2 b2 = abs((1.0 - fcell) * psz - 4.4);
  float bolt = 1.0 - smoothstep(0.7, 0.7 + aa, min(min(length(b), length(b2)), min(length(vec2(b.x, b2.y)), length(vec2(b2.x, b.y)))));
  vec2 sc = fcell - vec2(0.8, 0.7);
  float stain = exp(-dot(sc, sc) * 9.0) * haloHash12(id + 5.0);
  float detail = 1.0 - smoothstep(0.8, 3.0, fw);
  // jasność płyt jak w teksturze K-7 (sRGB → liniowo): ściany 167–195/255,
  // pokład 66–85/255 na ciemnym tle — pokład ciemny, oznakowanie jasne
  float base = deck ? mix(0.11, 0.17, v) : mix(0.42, 0.56, v);
  return base * (1.0 - seam * 0.55 * detail) * (1.0 - bolt * 0.5 * detail) * (1.0 - stain * 0.25);
}
// Lampy hali nad stanowiskami kapitalnymi (K-7 miało PointLighty; 4 stanowiska
// od 2026-09-23), na zewnątrz od osi stanowiska o 310 j. jak w K-7, i po trzy
// nad każdą otwartą zatoką kompleksu (dwa pasy MEGA, grzebień).
vec3 k7HallLight(vec3 hubP, vec3 N) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    vec4 Lp = uLamps[i];
    vec3 dv = Lp.xyz - hubP;
    float d = length(dv);
    float fall = 1.0 / (1.0 + (d / 520.0) * (d / 520.0));
    float win = (1.0 - smoothstep(1500.0, 2450.0, d)) * step(0.5, Lp.w);
    vec3 col = Lp.w < 1.5 ? vec3(1.0, 0.78, 0.55) : vec3(0.66, 0.85, 0.92);
    // N w ukladzie huba: y = gora
    acc += col * fall * win * max(dot(N, dv / max(d, 1.0)), 0.0);
  }
  return acc;
}

vec4 k7Shade(vec3 albedo0, float m, vec3 hubN, bool top, vec2 fuv, float fw, float matEmitGroup) {
  vec3 N = normalize(vN);
  vec3 p = vRing;
  vec3 V = normalize(uCamLocal - p);
  vec3 L = uSunDir;
  bool plated = m < 5.5;
  bool deck = (m > 5.5 && m < 6.5) || m > 19.5;
  float hl = 0.0;
  vec3 albedo = albedo0;
  if (plated || deck) albedo *= k7Plates(fuv, deck, fw, hl);
  if (m > 19.5) albedo = vec3(0.012, 0.017, 0.021) * k7Plates(fuv, true, fw, hl);   // pole stanowiska
  float rough = m > 6.5 && m < 7.5 ? 0.38 : (m > 9.5 && m < 10.5 ? 0.45 : (m > 10.5 && m < 11.5 ? 0.2 : 0.72));
  float metal = m > 6.5 && m < 7.5 ? 0.86 : (plated ? 0.5 : 0.1);
  vec3 sunVis = haloSunVisibility(p + N * 2.0, L);
  float NdL = max(dot(N, L), 0.0);
  float NdV = max(dot(N, V), 1e-3);
  vec3 H = normalize(L + V);
  float a2 = rough * rough;
  float NdH = max(dot(N, H), 0.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 Fs = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 spec = Fs * min(a2 / (HALO_PI * dd * dd) * 0.25 / NdV, 6.0) * NdL;
  // wypelnienie jak AmbientLight obiektow 3D gry + swiatlo planety + lampy hali
  vec3 amb = vec3(0.050, 0.056, 0.066) * (0.55 + 0.45 * max(hubN.y, 0.0)) + haloPlanetshine(p, N) + vec3(uNightAmbient);
  amb += k7HallLight(vHub, hubN) * uHallLights.x;
  vec3 diffuse = albedo * (1.0 - metal * 0.7);
  vec3 color = diffuse * (uSunColor * sunVis * NdL + amb) + uSunColor * sunVis * spec * 0.8;
  // krawedz plyt lapie swiatlo (jasna faza z tekstury K-7)
  color += albedo * hl * 0.25 * (haloLuma(sunVis) * NdL + 0.2);
  // odbicie otoczenia: kosmos czarny, planeta ponizej
  color += F0 * (0.02 + 0.05 * (1.0 - max(N.z, 0.0))) * (1.0 - rough);
  if (m > 13.5 && m < 18.5) color = k7Emit(m) * (0.85 + 0.15 * sin(uHallLights.z * 2.0 + vHub.x * 0.01));
  if (m > 18.5 && m < 19.5) color = uGroupEmit[int(matEmitGroup + 0.5)];
  if (m > 10.5 && m < 11.5) color += vec3(0.0423, 0.1470, 0.1651) * 0.35 + vec3(0.06, 0.10, 0.11) * (0.3 + 0.7 * (1.0 - uHallLights.y));
  return vec4(max(color, vec3(0.0)), 1.0);
}
`;

const K7_INSTANCE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
uniform mat4 uHub;
uniform mat4 uGroup[${MAX_GROUPS}];
attribute vec4 iA;     // srodek xyz, skala pionowa
attribute vec4 iB;     // rozmiar xyz, material
attribute vec4 iQ;     // kwaternion
attribute vec4 iC;     // grupa
varying vec3 vRing;
varying vec3 vHub;
varying vec3 vHubN;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vGroup;
vec3 qrot(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
void main() {
  vec3 lp = position * iB.xyz;
  vec3 r = qrot(iQ, lp);
  r.y *= iA.w;
  vec3 hubP = iA.xyz + r;
  vec3 nl = normalize(normal / max(iB.xyz, vec3(1e-3)));
  vec3 nr = qrot(iQ, nl);
  nr.y /= max(iA.w, 1e-3);
  int g = int(iC.x + 0.5);
  mat4 G = uGroup[g];
  vec4 gp = G * vec4(hubP, 1.0);
  vec3 gn = normalize(mat3(G) * nr);
  vHub = gp.xyz;
  vHubN = gn;
  vRing = (uHub * gp).xyz;
  vN = normalize(mat3(uHub) * gn);
  vLocal = lp;
  vLocalN = normal;
  vSize = iB.xyz;
  vMat = iB.w;
  vGroup = iC.x;
  gl_Position = projectionMatrix * modelViewMatrix * gp;
}
`;

const K7_INSTANCE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${GLSL_K7_SURFACE}
void main() {
  float m = floor(vMat + 0.5);
  bool top = vLocalN.y > 0.5;
  vec3 kn = abs(vLocalN);
  vec2 fuv = kn.y > 0.55 ? vLocal.xz : (kn.x > 0.55 ? vLocal.zy : vLocal.xy);
  float fw = fwidth(fuv.x) + fwidth(fuv.y);
  vec4 c = k7Shade(k7Palette(m), m, normalize(vHubN), top, fuv, fw, vGroup);
  gl_FragColor = vec4(c.rgb, uRoofOpacity);
}
`;

const K7_PLATE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
uniform mat4 uHub;
attribute float aMat;
varying vec3 vRing;
varying vec3 vHub;
varying vec3 vHubN;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vSize;
varying float vMat;
varying float vGroup;
void main() {
  vHub = position;
  vHubN = normal;
  vRing = (uHub * vec4(position, 1.0)).xyz;
  vN = normalize(mat3(uHub) * normal);
  vLocal = position;
  vLocalN = normal;
  vSize = vec3(1.0);
  vMat = aMat;
  vGroup = 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const K7_PLATE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${GLSL_K7_SURFACE}
void main() {
  float m = floor(vMat + 0.5);
  vec2 fuv = abs(vLocalN.y) > 0.5 ? vLocal.xz : (abs(vLocalN.x) > 0.5 ? vLocal.zy : vLocal.xy);
  float fw = fwidth(fuv.x) + fwidth(fuv.y);
  vec4 c = k7Shade(k7Palette(m), m, vLocalN, vLocalN.y > 0.5, fuv, fw, 0.0);
  gl_FragColor = vec4(c.rgb, uRoofOpacity);
}
`;

// Napisy na pokładzie: atlas (biały tekst w alfie), kolor per czworokąt.
const K7_LABEL_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
uniform mat4 uHub;
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vRing;
varying vec3 vN;
void main() {
  vUv = uv;
  vColor = aColor;
  vRing = (uHub * vec4(position, 1.0)).xyz;
  vN = normalize(mat3(uHub) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const K7_LABEL_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
uniform sampler2D uAtlas;
uniform vec4 uHallLights;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vRing;
varying vec3 vN;
void main() {
  float a = texture(uAtlas, vUv).a;
  if (a < 0.02) discard;
  vec3 N = normalize(vN);
  vec3 sunVis = haloSunVisibility(vRing + N * 2.0, uSunDir);
  float NdL = max(dot(N, uSunDir), 0.0);
  vec3 amb = vec3(0.05, 0.056, 0.066) + haloPlanetshine(vRing, N);
  vec3 col = vColor * (uSunColor * sunVis * NdL + amb) * 0.9;
  gl_FragColor = vec4(col * a, a);
}
`;

// Węże paliwowe: rura z żebrami gumy (tekstura K-7: pierścienie co 1/16).
const K7_HOSE_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
uniform mat4 uHub;
varying vec2 vUv;
varying vec3 vRing;
varying vec3 vN;
void main() {
  vUv = uv;
  vRing = (uHub * vec4(position, 1.0)).xyz;
  vN = normalize(mat3(uHub) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const K7_HOSE_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
varying vec2 vUv;
varying vec3 vRing;
varying vec3 vN;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamLocal - vRing);
  float rib = step(0.75, fract(vUv.y * 16.0));
  float braid = step(0.9, fract((vUv.x + vUv.y * 2.0) * 16.0));
  vec3 albedo = vec3(${f3(srgb(0x565b58))}) * mix(1.0, 0.45, rib) * mix(1.0, 1.2, braid) * 0.8;
  vec3 sunVis = haloSunVisibility(vRing + N * 2.0, uSunDir);
  float NdL = max(dot(N, uSunDir), 0.0);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 24.0) * 0.08;
  vec3 amb = vec3(0.05, 0.056, 0.066) + haloPlanetshine(vRing, N);
  vec3 col = albedo * (uSunColor * sunVis * NdL + amb) + uSunColor * sunVis * spec;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
function makeUnitCylinder() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false);
  return g;
}

function makeInstanced(base, data, sphere) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const arr = new Float32Array(data);
  const buf = new THREE.InstancedInterleavedBuffer(arr, K7_INSTANCE_STRIDE);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iQ', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 12));
  geo.instanceCount = arr.length / K7_INSTANCE_STRIDE;
  // cały kompleks (hala z kołnierzem i klinem, zatoki; układ huba): obcinanie
  // przez three, gdy jest poza kadrem
  geo.boundingSphere = sphere.clone();
  return { geo, arr, buf };
}

// Obwiednia kompleksu w układzie huba z nagranych instancji (środki + zapas na bryły).
function complexSphere(sets) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const set of Object.values(sets)) {
    for (const data of Object.values(set)) {
      for (let i = 0; i < data.length; i += K7_INSTANCE_STRIDE) {
        const x = data[i];
        const z = data[i + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 1400;
  return new THREE.Sphere(new THREE.Vector3(cx, -450, cz), r);
}

// Wypukłe wielokąty wytłoczone w pionie (y = z świata), jedna geometria na zestaw.
// axis 'x': wielokąt w (z huba, y) wytłoczony wzdłuż x (klin pod halą) — ta
// sama budowa w osiach przestawionych cyklicznie (obrót, nawinięcie zostaje).
function makePlates(plates) {
  const pos = [];
  const nor = [];
  const mat = [];
  let cyc = false;
  const perm = (v) => (cyc ? [v[1], v[2], v[0]] : v);
  const tri = (a, b, c, n, m) => {
    pos.push(...perm(a), ...perm(b), ...perm(c));
    const nn = perm(n);
    for (let i = 0; i < 3; i++) { nor.push(...nn); mat.push(m); }
  };
  for (const p of plates) {
    cyc = p.axis === 'x';
    const pts = p.points;
    const n = pts.length;
    // orientacja wielokąta w (x, z): chcemy normalne górne +y
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
      const sideMat = p.mat === K7_MAT.floor ? K7_MAT.dark : p.mat;
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

// Atlas napisów (groundText z K-7: 1024 × 140/230, pogrubiony Arial + opis mono).
function makeLabelAtlas(labels) {
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
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) return null;
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
  const hex = (h) => srgb(parseInt(h.replace('#', '').slice(0, 6), 16));
  for (const l of labels) {
    const u = atlas.unique.get(l.text + '|' + l.small);
    const [u0, v0, u1, v1] = u.uv;
    const c = hex(l.color);
    const base = pos.length / 3;
    const r = l.rotation || 0;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const corners = [[-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0], [0.5, 0.5, u1, v1], [-0.5, 0.5, u0, v1]];
    for (const [a, b, uu, vv] of corners) {
      const px = a * l.width;
      const py = b * l.depth;
      if (l.vertical) {
        // na dachu terminalu w habitacie: płaszczyzna (x, y świata), normalna +z huba
        pos.push(l.x + px, l.y + py, l.z);
        nor.push(0, 0, 1);
      } else {
        // PlaneGeometry: rotation.x = −π/2, potem rotation.z = r (jak w K-7)
        const x = px * cr - py * sr;
        const y = px * sr + py * cr;
        pos.push(l.x + x, l.y, l.z - y);
        nor.push(0, 1, 0);
      }
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
export class HaloPortK7 {
  // angle — kąt kompleksu (hala K-7 w środku); index 0 = hala gracza przy kącie
  // stacji; bays — otwarte zatoki kompleksu (haloBayLayouts z ramkami)
  constructor({ ringLayout, uniforms, layout, angle, index = 0, bays = [] }) {
    this.layout = layout;
    this.index = index;
    this.frame = k7Frame(ringLayout, angle);
    const fr = this.frame;
    // zatoki w układzie huba hali (przejście ramek) i indeks stanowisk (lampki)
    this.bays = bays.map((b) => ({ layout: b, xf: haloFrameToFrame(b.frame, fr) }));
    this.berthMap = new Map();
    for (const b of layout.berths) this.berthMap.set(b.id, b);
    for (const bay of this.bays) for (const b of bay.layout.berths) this.berthMap.set(b.id, b);
    this.root = new THREE.Group();
    this.root.name = `K-7 / Central Hub (kompleks ${index + 1})`;
    // hub (x wzdłuż, y = z świata, z promieniowo na zewnątrz) → układ ringu
    const hubM = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(fr.tx, fr.ty, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(fr.rx, fr.ry, 0)
    ).setPosition(fr.origin.x, fr.origin.y, 0);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(hubM);
    this.hubMatrix = hubM;

    const scene = buildK7Scene(layout, { floorZ: fr.floorZ, rimZ: fr.rimZ, floorR: fr.floorR, bays: this.bays });
    this.scene = scene;
    this.groups = scene.groups;
    this.sphere = complexSphere(scene.sets);
    // obwiednia w układzie ringu (obcinanie całego kompleksu w index.js)
    const sc = this.sphere.center;
    this.bounds = { x: fr.origin.x + sc.x * fr.tx + sc.z * fr.rx, y: fr.origin.y + sc.x * fr.ty + sc.z * fr.ry, z: sc.y, r: this.sphere.radius };
    // lampy: 4 nad stanowiskami capital hali + po trzy nad każdą zatoką
    const lamps = Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, 0, 0, 0));
    const ly = k7HeightToZ(390);
    [-1120, 1120, -2740, 2740].forEach((x, i) => lamps[i].set(x, ly, 1930, i === 0 || i === 3 ? 1 : 2));
    const q = {};
    let li = 4;
    for (const { layout: bl, xf } of this.bays) {
      const zc = (bl.backZ + bl.openZ) * 0.5;
      for (const lane of bl.lanes) {
        if (li >= MAX_LAMPS) break;
        haloXfPoint(xf, lane.x, zc, q);
        lamps[li++].set(q.x, ly, q.z, 1);
      }
      if (li >= MAX_LAMPS) break;
      haloXfPoint(xf, bl.aisle.x, zc + 200, q);
      lamps[li++].set(q.x, ly, q.z, 2);
    }
    const groupMats = Array.from({ length: MAX_GROUPS }, () => new THREE.Matrix4());
    const groupEmit = Array.from({ length: MAX_GROUPS }, () => new THREE.Vector3(1.2, 0.7, 0.28));
    this.k7Uniforms = {
      uHub: { value: hubM },
      uGroup: { value: groupMats },
      uGroupEmit: { value: groupEmit },
      uRoofOpacity: { value: 1 },
      uHallLights: { value: new THREE.Vector4(0.22, 1, 0, 0) },
      uLamps: { value: lamps }
    };
    this.roofUniforms = { ...this.k7Uniforms, uRoofOpacity: { value: 1 } };
    const common = { ...uniforms, ...this.k7Uniforms };
    const commonRoof = { ...uniforms, ...this.roofUniforms };

    this._box = new THREE.BoxGeometry(1, 1, 1);
    this._cyl = makeUnitCylinder();
    this._torus = new THREE.TorusGeometry(1, 0.13, 6, 24);
    const bases = { box: this._box, cyl: this._cyl, torus: this._torus };

    this.materials = [];
    const instMat = (uni, opts = {}) => {
      const m = new THREE.ShaderMaterial({
        name: 'K7Instances',
        uniforms: uni,
        vertexShader: K7_INSTANCE_VERTEX,
        fragmentShader: K7_INSTANCE_FRAGMENT,
        ...opts
      });
      this.materials.push(m);
      return m;
    };
    this.matBg = instMat(common);
    this.matFg = instMat(common);
    this.matRoof = instMat(commonRoof, { transparent: true });
    this.meshes = { bg: [], fg: [] };
    this.instances = {};
    for (const setName of ['bg', 'fg', 'roof']) {
      for (const kind of ['box', 'cyl', 'torus']) {
        const data = scene.sets[setName][kind];
        if (!data.length) continue;
        const inst = makeInstanced(bases[kind], data, this.sphere);
        const material = setName === 'bg' ? this.matBg : setName === 'fg' ? this.matFg : this.matRoof;
        const mesh = new THREE.Mesh(inst.geo, material);
        mesh.name = `K7_${setName}_${kind}`;
        mesh.frustumCulled = true;
        this.root.add(mesh);
        this.meshes[setName === 'bg' ? 'bg' : 'fg'].push(mesh);
        this.instances[setName + '_' + kind] = inst;
        if (setName === 'roof') mesh.renderOrder = 20;
      }
    }
    // pokład, fartuchy, most / dach
    const plateMat = (uni, opts = {}) => {
      const m = new THREE.ShaderMaterial({ name: 'K7Plates', uniforms: uni, vertexShader: K7_PLATE_VERTEX, fragmentShader: K7_PLATE_FRAGMENT, ...opts });
      this.materials.push(m);
      return m;
    };
    const bgPlates = scene.plates.filter((p) => p.set !== 'roof');
    const roofPlates = scene.plates.filter((p) => p.set === 'roof');
    this.platesBg = new THREE.Mesh(makePlates(bgPlates), plateMat(common));
    this.platesBg.name = 'K7_plates';
    this.platesBg.frustumCulled = true;
    this.root.add(this.platesBg);
    this.meshes.bg.push(this.platesBg);
    this.platesRoof = new THREE.Mesh(makePlates(roofPlates), plateMat(commonRoof, { transparent: true }));
    this.platesRoof.name = 'K7_roof_slab';
    this.platesRoof.frustumCulled = true;
    this.platesRoof.renderOrder = 20;
    this.root.add(this.platesRoof);
    this.meshes.fg.push(this.platesRoof);
    this.roofMaterials = [this.matRoof, this.platesRoof.material];
    // napisy
    const atlas = makeLabelAtlas(scene.labels);
    if (atlas) {
      this.atlas = atlas;
      const lm = new THREE.ShaderMaterial({
        name: 'K7Labels',
        uniforms: { ...uniforms, ...this.k7Uniforms, uAtlas: { value: atlas.tex } },
        vertexShader: K7_LABEL_VERTEX,
        fragmentShader: K7_LABEL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      });
      this.materials.push(lm);
      this.labels = new THREE.Mesh(makeLabelMesh(scene.labels, atlas), lm);
      this.labels.name = 'K7_labels';
      this.labels.frustumCulled = true;
      this.labels.renderOrder = 5;
      this.root.add(this.labels);
      this.meshes.bg.push(this.labels);
    }
    // węże paliwowe (dynamiczne, jedna geometria na wszystkie)
    this._buildHoses();

    // stan animacji
    this._pose = new Map();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._lampState = new Map();
    this.time = 0;
    this.roofFade = 0;
    this.setServicePoses(null);
  }

  _buildHoses() {
    const hoses = this.scene.hoses;
    this.hoseN = 48;
    this.hoseRings = 10;
    const perHose = (this.hoseN + 1) * (this.hoseRings + 1);
    const count = perHose * hoses.length;
    this.hosePos = new Float32Array(count * 3);
    this.hoseNor = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const idx = [];
    for (let h = 0; h < hoses.length; h++) {
      const base = h * perHose;
      for (let i = 0; i <= this.hoseN; i++) {
        for (let j = 0; j <= this.hoseRings; j++) {
          const k = base + i * (this.hoseRings + 1) + j;
          uvs[2 * k] = j / this.hoseRings;
          uvs[2 * k + 1] = i / this.hoseN * 6;
          if (i < this.hoseN && j < this.hoseRings) {
            const l = k + this.hoseRings + 1;
            idx.push(k, k + 1, l, l, k + 1, l + 1);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.hosePos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.hoseNor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 2000), 4000);
    const m = new THREE.ShaderMaterial({ name: 'K7Hoses', uniforms: this.matFg.uniforms, vertexShader: K7_HOSE_VERTEX, fragmentShader: K7_HOSE_FRAGMENT });
    this.materials.push(m);
    this.hoseMesh = new THREE.Mesh(g, m);
    this.hoseMesh.name = 'K7_hoses';
    this.hoseMesh.frustumCulled = true;
    this.root.add(this.hoseMesh);
    this.meshes.fg.push(this.hoseMesh);
    // bufory punktów środkowych (bez alokacji przy aktualizacji)
    this._hosePts = hoses.map(() => Array.from({ length: this.hoseN + 1 }, () => new THREE.Vector3()));
    this._hoseKey = new Float32Array(hoses.length * 3).fill(-1);
    this._tA = new THREE.Vector3();
    this._tN = new THREE.Vector3();
    this._tB = new THREE.Vector3();
  }

  setLayers(bgLayer, fgLayer) {
    for (const m of this.meshes.bg) m.layers.set(bgLayer);
    for (const m of this.meshes.fg) m.layers.set(fgLayer);
  }

  setVisible(v) { this.root.visible = !!v; }

  // pozy obsługi stanowisk: Map berthId → {bridge, trolley, lower, clamp, extension, lock, flow, vent}
  setServicePoses(poses) {
    const P = this._pose;
    for (const c of this.scene.cranes) {
      const pose = poses?.get(c.berthId) ?? null;
      P.set(c.berthId, pose || { bridge: 0, trolley: 0, lower: 0, clamp: 0, extension: 0, lock: 0, flow: 0, vent: 0 });
    }
  }

  // Grupy ruchome: most (z), wózek (x), chwytak (wysokość), szczęki, liny, złączki.
  _updateGroups() {
    const mats = this.k7Uniforms.uGroup.value;
    mats[0].identity();
    const hullTop = K7_HEIGHTS.hullTop;
    for (const c of this.scene.cranes) {
      const s = this._pose.get(c.berthId);
      const berth = this.layout.berths.find((b) => b.id === c.berthId);
      const bridgeZ = c.homeZ + (c.workZ - c.homeZ) * s.bridge;
      mats[c.bridge].makeTranslation(berth.x, 0, bridgeZ);
      const trolleyX = 420 + (0 - 420) * s.trolley;
      mats[c.trolley].copy(mats[c.bridge]).multiply(this._m.makeTranslation(trolleyX, 0, 0));
      const spreaderY = 550 + (hullTop + 46 - 550) * s.lower;
      mats[c.spreader].copy(mats[c.trolley]).multiply(this._m.makeTranslation(0, k7HeightToZ(spreaderY), 0));
      c.jaws.forEach((g, i) => {
        const side = i === 0 ? -1 : 1;
        mats[g].copy(mats[c.spreader]).multiply(this._m.makeTranslation(-side * 18 * s.clamp, 0, 0));
      });
      // liny: od szczytu chwytaka (y + 18) do wózka (638)
      const z0 = k7HeightToZ(spreaderY + 18);
      const z1 = k7HeightToZ(638);
      const len = Math.max(1, z1 - z0);
      this._m2.makeScale(1, len / K7_ABOVE_SCALE, 1);
      mats[c.cables].copy(mats[c.trolley]).multiply(this._m.makeTranslation(0, (z0 + z1) / 2, 0)).multiply(this._m2);
    }
  }

  // Węże: krzywa Béziera z luzem (K-7 FuelHoseSystem.setPose), przeliczana
  // tylko przy zmianie pozy; złączka na końcu jako grupa.
  _updateHoses() {
    const hoses = this.scene.hoses;
    const emit = this.k7Uniforms.uGroupEmit.value;
    let dirty = false;
    const A = this._tA;
    const Nn = this._tN;
    const B = this._tB;
    for (let h = 0; h < hoses.length; h++) {
      const hose = hoses[h];
      const s = this._pose.get(hose.berthId);
      // barwa złączki: ciepła = luźna, cyjan = zablokowana, zielona = przepływ
      if (s.lock > 0.98) {
        if (s.flow > 0.1) emit[hose.group].set(0.4, 1.15, 0.66); else emit[hose.group].set(0.3, 1.12, 1.28);
      } else emit[hose.group].set(1.28, 0.78, 0.3);
      const kk = this._hoseKey;
      if (Math.abs(kk[h * 3] - s.extension) < 1e-4 && Math.abs(kk[h * 3 + 1] - s.lock) < 1e-4 && kk[h * 3 + 2] === s.flow) continue;
      kk[h * 3] = s.extension;
      kk[h * 3 + 1] = s.lock;
      kk[h * 3 + 2] = s.flow;
      dirty = true;
      const a = hose.anchor;
      const side = a.side;
      const ext = Math.min(1, Math.max(0, s.extension));
      // punkty w wysokościach K-7 (y), potem odwzorowanie na z świata
      const sx = a.x - side * 34;
      const sy = 224;
      const sz = a.z;
      const hx = a.x - side * 75;
      const hy = 171;
      const hz = a.z + 26;
      const ex = hx + (a.target.x - hx) * ext;
      const ey = hy + (a.target.y - hy) * ext;
      const ez = hz + (a.target.z - hz) * ext;
      const p1x = sx - side * (40 + 120 * ext);
      const p1y = sy - 35 * ext;
      const p1z = sz + 145 * ext;
      const p2x = ex + side * 20 * (1 - ext);
      const p2y = ey + 86 * ext;
      const p2z = ez + 30 * (1 - ext);
      const pts = this._hosePts[h];
      const n = this.hoseN;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const w0 = u * u * u;
        const w1 = 3 * u * u * t;
        const w2 = 3 * u * t * t;
        const w3 = t * t * t;
        const y = Math.max(54, w0 * sy + w1 * p1y + w2 * p2y + w3 * ey);
        pts[i].set(w0 * sx + w1 * p1x + w2 * p2x + w3 * ex, k7HeightToZ(y), w0 * sz + w1 * p1z + w2 * p2z + w3 * ez);
      }
      const rings = this.hoseRings;
      const base = h * (n + 1) * (rings + 1);
      for (let i = 0; i <= n; i++) {
        const v = pts[i];
        A.subVectors(pts[Math.min(i + 1, n)], pts[Math.max(0, i - 1)]).normalize();
        Nn.set(A.z, 0, -A.x);
        if (Nn.lengthSq() < 0.01) Nn.set(1, 0, 0);
        Nn.normalize();
        B.crossVectors(A, Nn).normalize();
        const rad = 11.5 + (i < 4 || i > n - 5 ? 2.2 : 0) + ((i % 7) === 0 ? 1.4 : 0);
        for (let j = 0; j <= rings; j++) {
          const k = (base + i * (rings + 1) + j) * 3;
          const an = j / rings * Math.PI * 2;
          const cc = Math.cos(an);
          const ss = Math.sin(an);
          const nx = Nn.x * cc + B.x * ss;
          const ny = Nn.y * cc + B.y * ss;
          const nz = Nn.z * cc + B.z * ss;
          this.hosePos[k] = v.x + nx * rad;
          this.hosePos[k + 1] = v.y + ny * rad;
          this.hosePos[k + 2] = v.z + nz * rad;
          this.hoseNor[k] = nx;
          this.hoseNor[k + 1] = ny;
          this.hoseNor[k + 2] = nz;
        }
      }
      // złączka: oś Y wzdłuż węża (ku gniazdu), przy ryglowaniu prostuje się do pionu
      const end = pts[n];
      A.subVectors(end, pts[n - 1]).normalize().negate();
      this._q.setFromUnitVectors(this._yAxis, A);
      if (s.lock > 0.001) this._q.slerp(this._q2.identity(), Math.min(1, s.lock));
      this.k7Uniforms.uGroup.value[hose.group].compose(end, this._q, this._s);
    }
    if (dirty) {
      this.hoseMesh.geometry.attributes.position.needsUpdate = true;
      this.hoseMesh.geometry.attributes.normal.needsUpdate = true;
    }
  }

  // lampki stanowisk hali i zatok: stan z automatu dokowania (occupied /
  // reserved / free) — obiekty stanowisk są wspólne z logiką lotu
  setBerthLamps() {
    const inst = this.instances.bg_box;
    if (!inst) return;
    let changed = false;
    for (const lamp of this.scene.lamps) {
      const b = this.berthMap.get(lamp.berthId);
      if (!b) continue;
      const state = b.occupied ? 'o' : b.reserved ? 'r' : 'f';
      if (this._lampState.get(lamp.berthId) === state) continue;
      this._lampState.set(lamp.berthId, state);
      inst.arr[lamp.index * K7_INSTANCE_STRIDE + 7] = state === 'o' ? K7_MAT.warm : state === 'r' ? K7_MAT.cyan : K7_MAT.green;
      changed = true;
    }
    if (changed) inst.buf.needsUpdate = true;
  }

  // roofFade: 0 = dach nieprzezroczysty, 1 = statek w hali (dach znika)
  update(dt, { poses = null, roofFade = 0, daylight = 1 } = {}) {
    this.time += dt;
    if (poses) this.setServicePoses(poses);
    this._updateGroups();
    this._updateHoses();
    const opacity = 1 - roofFade;
    this.roofUniforms.uRoofOpacity.value = opacity;
    const opaque = opacity > 0.97;
    for (const m of this.roofMaterials) {
      m.depthWrite = opaque;
      m.transparent = !opaque;
    }
    const roofVisible = opacity > 0.003;
    for (const mesh of this.meshes.fg) if (mesh.material === this.matRoof || mesh === this.platesRoof) mesh.visible = roofVisible;
    const hl = this.k7Uniforms.uHallLights.value;
    hl.x = 0.22 + 0.5 * (1 - daylight);
    hl.y = daylight;
    hl.z = this.time;
  }

  get drawCalls() {
    return this.meshes.bg.length + this.meshes.fg.length;
  }

  dispose() {
    for (const m of [...this.meshes.bg, ...this.meshes.fg]) m.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this._box.dispose();
    this._cyl.dispose();
    this._torus.dispose();
    this.atlas?.tex.dispose();
  }
}

export { k7Phase };
