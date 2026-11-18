// HUTA — wytop: OBRAZ (three + TSL; tylko rysuje stan symulacji `komora.js`, niczego nie dolicza).
//
// Układ: grupa `root` ma układ komory (początek = środek kuli, y w górę) — strona wstawia ją w „hub” budowli portowych
// z przesunięciem o `KOMORA.deckY` w dół (kula wisi w studni pod pokładem). Rysunki (po jednym na pozycję):
//   kula (siatka z przemieszczeniem — `kulaTSL.js`) · MASA W LEJU od zetknięcia kuli z lejem (siatka na polu grubości
//   z symulacji, ten sam materiał metalu — `kulaTSL.js`) · wyposażenie stałe (z maszynerią jeżdżącą w shaderze
//   i lejem) i ruchome (`wyposazenie.js`) · WYŚWIETLACZ GRAWITACJI (`wyswietlacz.js`: jedna bryła, wzór szewronów
//   z funkcji w shaderze) · taśma (`kit/tasmociag3d.js`)
//   · ziarna na taśmie, w locie i w KUPIE (bryłki — te same kroje i barwy co w demie rudy, z żarem per ziarno; ziarna
//   kupy z cieniem własnym bryły) · NITKA żużla (od czapy do dzwonu ssawy) · granulki żużla w odbieralniku · krople
//   · iskry · błyski wtopień · błona granicy 0 g. Wyspy żużla rysuje materiał kuli (pole z tablicy uniformów).
// Dane instancji: tablice widoku symulacji WPROST jako bufory z przeplotem (bez kopii), wysyłka do liczby żywych.
// Światło wszystkich materiałów w układzie komory (`wspolneTSL.js`). Wszystkie siatki idą do rozgrzewki
// (`warmupMeshes`): partie instancji z wariantem licznika ≥ 2.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, cameraProjectionMatrix, clamp, cos, cross, dFdx, dFdy, dot, exp, float, floor, fract, length, max, min, mix, mod,
  modelViewMatrix, normalize, pow, reflect, sign, sin, smoothstep, sqrt, step, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { zbierzZakres } from '../../../../src/3d/zakresyWysylki.js';
import { PORT_SPACE_LIGHT } from '../../../../src/3d/portBuildings/portBuildings3D.js';
import { GRAIN_DRAW_R, ORES, TRAIT_BIG, TRAIT_SCALES } from '../ruda/rudy.js';
import { createConveyor3D } from '../../kit/tasmociag3d.js';
import { KOMORA } from './geometria.js';
import { MODES } from './kula.js';
import { EVENT_STRIDE, FLOE_STRIDE, GRAIN_STRIDE, GRANULE_STRIDE, LICZNIK, PART_STRIDE, POOL, PROCES, STAN, STAN_N, UNITS_PER_TON } from './komora.js';
import { createBallGeometry, createMassGeometry, createMetalMaterials } from './kulaTSL.js';
import { MASA, MASA_CELLS, MASA_STRIDE } from './masa.js';
import { Budowniczy, buildChamberDynamic, buildChamberStatic, createEquipmentMaterial, meshFromBuilder } from './wyposazenie.js';
import { DISPLAY_COOL, DISPLAY_WARM, createDisplayGeometry, createDisplayMaterial } from './wyswietlacz.js';
import { createOxygenMesh, oxyRouteLength } from './odciag.js';

/** Przepływ odciągu, przy którym wskaźniki tlenu świecą pełną jasnością [t/s] (dokarmianie stali: ~1,2 t/s). */
const OXY_FLOW_REF = 1.2;
import { LUMA, ballLight, createWytopUniforms, heatColor, heatPower, skyLight, sunVis } from './wspolneTSL.js';

const TAU = Math.PI * 2;
/**
 * Skala rysunku bryłek w komorze wytopu względem dema rudy: ziarna kupy stykają się w odległości `PROCES.heapStick`
 * (10,2 j. środek–środek) — bryłka o średnicy 8–10 j. dotyka sąsiadów (kupa zwarta, bez prześwitów).
 */
export const GRAIN_K = 1.5;

// ---------------------------------------------------------------------------
// Bryłki: otoczka wypukła losowych punktów na zniekształconej kuli (ten sam sposób co w demie rudy; tam funkcja nie
// jest eksportowana — własna partia tym samym wzorem)

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hullFaces(p) {
  const n = p.length;
  const faces = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const ax = p[j][0] - p[i][0]; const ay = p[j][1] - p[i][1]; const az = p[j][2] - p[i][2];
    const bx = p[k][0] - p[i][0]; const by = p[k][1] - p[i][1]; const bz = p[k][2] - p[i][2];
    const nx = ay * bz - az * by; const ny = az * bx - ax * bz; const nz = ax * by - ay * bx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-4) return null;
    let pos = 0;
    let neg = 0;
    for (let m = 0; m < n; m++) {
      if (m === i || m === j || m === k) continue;
      const d = ((p[m][0] - p[i][0]) * nx + (p[m][1] - p[i][1]) * ny + (p[m][2] - p[i][2]) * nz) / nl;
      if (d > 0.012) pos++; else if (d < -0.012) neg++; else return null;
    }
    if (pos && neg) continue;
    faces.push(pos ? [i, k, j] : [i, j, k]);
  }
  return faces;
}
/** Bryłka: `count` punktów (osie `anis`), wszystkie na otoczce → 2 · count − 4 ściany; największy promień = 1. */
export function chunkShape(seed, count, anis) {
  const rnd = rng(seed);
  const spread = count > 9 ? 0.72 : 0.62;
  for (let attempt = 0; attempt < 6000; attempt++) {
    const pts = [];
    let guard = 0;
    while (pts.length < count && guard++ < 400) {
      const u = rnd() * 2 - 1;
      const a = rnd() * TAU;
      const s = Math.sqrt(1 - u * u);
      const d = [Math.cos(a) * s, u, Math.sin(a) * s];
      let ok = true;
      for (const q of pts) if (q.d[0] * d[0] + q.d[1] * d[1] + q.d[2] * d[2] > spread) { ok = false; break; }
      if (!ok) continue;
      const r = 0.74 + 0.26 * rnd();
      pts.push({ d, p: [d[0] * r * anis[0], d[1] * r * anis[1], d[2] * r * anis[2]] });
    }
    if (pts.length < count) continue;
    const p = pts.map((q) => q.p);
    const faces = hullFaces(p);
    if (!faces || faces.length !== 2 * count - 4) continue;
    const c = [0, 0, 0];
    for (const q of p) { c[0] += q[0] / count; c[1] += q[1] / count; c[2] += q[2] / count; }
    let rmax = 0;
    for (const q of p) { q[0] -= c[0]; q[1] -= c[1]; q[2] -= c[2]; rmax = Math.max(rmax, Math.hypot(q[0], q[1], q[2])); }
    const out = new Float32Array(faces.length * 9);
    let w = 0;
    for (const f of faces) for (const v of f) { out[w++] = p[v][0] / rmax; out[w++] = p[v][1] / rmax; out[w++] = p[v][2] / rmax; }
    return out;
  }
  throw new Error('wytop: nie udało się wylosować bryłki');
}
const ANIS = [[1.0, 0.8, 0.92], [1.16, 0.5, 0.86], [0.8, 1.0, 0.68], [1.22, 0.64, 0.5]];

function chunkBase(count, seed) {
  const shapes = ANIS.map((a, i) => chunkShape(seed + i * 977, count, a));
  const verts = shapes[0].length / 3;
  const data = new Float32Array(verts * 12);
  for (let v = 0; v < verts; v++) for (let s = 0; s < 4; s++) for (let k = 0; k < 3; k++) data[v * 12 + s * 3 + k] = shapes[s][v * 3 + k];
  const buf = new THREE.InterleavedBuffer(data, 12);
  return {
    position: new THREE.InterleavedBufferAttribute(buf, 3, 0),
    p1: new THREE.InterleavedBufferAttribute(buf, 3, 3),
    p2: new THREE.InterleavedBufferAttribute(buf, 3, 6),
    p3: new THREE.InterleavedBufferAttribute(buf, 3, 9)
  };
}

function nodeMaterial(name, vertex, fragment, opts = {}) {
  const m = new NodeMaterial();
  m.name = name;
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = opts.side ?? THREE.FrontSide;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  if (opts.additive) {
    // emiter addytywny: czynniki (jeden, jeden), alfa = 1 (pułapka 43); bez zapisu głębi
    m.transparent = true;
    m.blending = THREE.AdditiveBlending;
    m.premultipliedAlpha = false;
    m.depthWrite = false;
    m.forceSinglePass = true;
  }
  return m;
}

const SCALE0 = TRAIT_SCALES[0];
const SCALE_STEP = (TRAIT_SCALES[3] - TRAIT_SCALES[0]) / 3;
const BIG_K = TRAIT_BIG / TRAIT_SCALES[3] - 1;
const qrot = (q, v) => { const t = cross(q.xyz, v).mul(2.0); return v.add(t.mul(q.w)).add(cross(q.xyz, t)); };

/** Ściana płaska: normalna z pochodnych pozycji komory, zwrócona do kamery. */
function flatNormal(U, vPc) {
  const dx = vec3(0.0).toVar();
  dx.assign(dFdx(vPc));
  const dy = vec3(0.0).toVar();
  dy.assign(dFdy(vPc));
  const cr = vec3(0.0).toVar();
  cr.assign(cross(dx, dy));
  const N0 = vec3(0.0).toVar();
  N0.assign(cr.div(max(length(cr), 1e-9)));
  const V = normalize(U.cam.sub(vPc));
  const N = vec3(0.0).toVar();
  N.assign(N0.mul(sign(dot(N0, V).add(1e-5))));
  return N;
}

/** Ziarna: iCur / iPrev (komora), iA (kąt, cechy, żar, rodzaj: 0 taśma, 1 lot, 2 kupa), iB (ziarno osi obrotu, głębokość w kupie). */
function grainMaterial(U) {
  const vPc = varyingProperty('vec3', 'vWzP');
  const vC = varyingProperty('vec3', 'vWzC');
  const vH = varyingProperty('vec4', 'vWzH');
  const vertex = Fn(() => {
    const iCur = attribute('iCur', 'vec3');
    const iPrev = attribute('iPrev', 'vec3');
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec2');
    const c = vec3(0.0).toVar();
    c.assign(mix(iPrev, iCur, U.frame.x));
    // cechy ziarna (bajt jak w demie rudy): odcień 0…7, kształt 0…3, skala 0…3, żyłka
    const t = float(0.0).toVar();
    t.assign(floor(iA.y.add(0.5)));
    const hue = float(0.0).toVar();
    hue.assign(mod(t, 8.0));
    const shape = float(0.0).toVar();
    shape.assign(mod(floor(t.div(8.0)), 4.0));
    const scale = float(0.0).toVar();
    scale.assign(mod(floor(t.div(32.0)), 4.0));
    const vein = float(0.0).toVar();
    vein.assign(step(127.5, t));
    const w = (k) => float(1.0).sub(min(abs(shape.sub(k)), 1.0));
    const lp = vec3(0.0).toVar();
    lp.assign(attribute('position', 'vec3').mul(w(0.0)).add(attribute('aP1', 'vec3').mul(w(1.0))).add(attribute('aP2', 'vec3').mul(w(2.0))).add(attribute('aP3', 'vec3').mul(w(3.0))));
    // obrót wokół osi z ziarna o kąt z symulacji
    const az = float(0.0).toVar();
    az.assign(fract(iB.x.mul(13.37)).mul(2.0).sub(1.0));
    const ar = sqrt(max(float(1.0).sub(az.mul(az)), 0.0));
    const axis = vec3(0.0).toVar();
    axis.assign(vec3(ar.mul(cos(iB.x.mul(40.0))), az, ar.mul(sin(iB.x.mul(40.0)))));
    const ca = cos(iA.x);
    const sa = sin(iA.x);
    const r = vec3(0.0).toVar();
    r.assign(lp.mul(ca).add(cross(axis, lp).mul(sa)).add(axis.mul(dot(axis, lp)).mul(float(1.0).sub(ca))));
    const big = step(2.5, scale).mul(step(2.5, shape));
    const sc = float(0.0).toVar();
    sc.assign(U.grain.x.mul(scale.mul(SCALE_STEP).add(SCALE0)).mul(big.mul(BIG_K).add(1.0)));
    const mvC = vec4(0.0).toVar();
    mvC.assign(modelViewMatrix.mul(vec4(c, 1.0)));
    const ppu = U.frame.y.div(max(mvC.z.negate(), 1.0));
    const boost = max(float(1.0), U.frame.z.div(max(sc.mul(1.7).mul(ppu), 1e-4)));
    const pc = vec3(0.0).toVar();
    pc.assign(c.add(r.mul(sc).mul(boost)));
    vPc.assign(pc);
    const tt = hue.div(7.0);
    const base = mix(mix(U.shade0, U.shade1, clamp(tt.mul(2.0), 0.0, 1.0)), U.shade2, clamp(tt.mul(2.0).sub(1.0), 0.0, 1.0));
    const jit = fract(shape.mul(0.37).add(scale.mul(0.61)).add(hue.mul(0.23))).mul(0.34).add(0.8);
    vC.assign(mix(base.mul(jit), U.vein, vein.mul(0.36)).mul(U.grain.z));
    vH.assign(vec4(iA.z, vein, iA.w, iB.y));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(pc, 1.0)));
  })();
  const fragment = Fn(() => {
    const N = flatNormal(U, vPc);
    const P = vec3(0.0).toVar();
    P.assign(vPc);
    const sv = sunVis(U, P);
    const ndl = max(dot(N, U.sunDir), 0.0);
    // KUPA: cień własny bryły — ziarna w głębi zasłaniają sąsiedzi (głębokość z symulacji), strona odwrócona od
    // słońca leży w cieniu bryły (miękki terminator); szczeliny między ziarnami są ciemne
    const isHeap = step(1.5, vH.z);
    const rel = vec3(0.0).toVar();
    rel.assign(P.sub(U.off));
    const term = smoothstep(-0.45, 0.4, dot(rel.div(max(length(rel), 1.0)), U.sunDir));
    const occl = float(1.0).sub(vH.w.mul(0.82).mul(isHeap));
    const sunK = mix(float(1.0), term.mul(occl), isHeap);
    const skyK = mix(float(1.0), occl.mul(term.mul(0.4).add(0.6)).mul(2.3), isHeap);
    const lightv = vec3(0.0).toVar();
    // światło robocze komory (poświata wyświetlacza grawitacji na ścianach i w leju): dochodzi z boków i od dołu — spód kupy
    // nie ginie w czerni; ziarna w głębi kupy dostają go mniej
    const workK = float(0.9).sub(N.y.mul(0.3)).mul(mix(float(1.0), float(1.55).sub(vH.w.mul(0.75)), isHeap));
    lightv.assign(U.sunColor.mul(ndl.mul(0.94).add(0.03)).mul(sv).mul(sunK).add(skyLight(U, P, N).mul(skyK)).add(ballLight(U, P, N))
      .add(U.dcol.mul(U.work.x.mul(workK))));
    // żar ziarna: od ciemnej wiśni do jasnego pomarańczu tuż przed wtopieniem. Emisja jest mnożona przez cieniowanie
    // ścianek (każda ścianka bryłki ma inną jasność — bryłka zostaje bryłką, nie płaską plamą), ścianki widziane pod
    // kątem (krawędzie sylwetki) są jaśniejsze; rozżarzone ziarno gasi swoją barwę
    const h = vH.x;
    const e = float(0.0).toVar();
    e.assign(smoothstep(0.12, 0.88, h));
    const glowT = h.mul(0.56).add(0.3);
    const Vg = normalize(U.cam.sub(P));
    const facet = float(0.0).toVar();
    facet.assign(clamp(dot(N, vec3(0.35, 0.8, 0.48)).mul(0.5).add(0.5), 0.0, 1.0));
    const rimG = float(1.0).sub(clamp(dot(N, Vg), 0.0, 1.0));
    const ember = heatColor(U, glowT.sub(float(1.0).sub(facet).mul(0.18))).mul(e.mul(e).mul(1.2).mul(U.t3.w)).mul(facet.mul(facet).mul(0.85).add(0.22).add(rimG.mul(rimG).mul(0.55)));
    const cold = float(1.0).sub(e.mul(0.9));
    const lit = vec3(0.0).toVar();
    lit.assign(vC.mul(lightv).mul(cold));
    const lum = dot(lit, LUMA);
    lit.mulAssign(min(float(1.0), float(0.84).div(max(lum, 1e-3))));
    return vec4(max(lit.add(ember), vec3(0.0)), 1.0);
  })();
  return nodeMaterial('WytopZiarno', vertex, fragment);
}

/**
 * Siatka nitki żużla: rura parametryczna — `position` = (u wzdłuż 0…1, cos φ, sin φ); kształt liczy shader z łuku
 * korzeń → dzwon (uniformy `thr0…thr2`).
 */
export function threadGeometry(along = 56, around = 10) {
  const pos = new Float32Array((along + 1) * around * 3);
  const idx = new Uint16Array(along * around * 6);
  let w = 0;
  for (let i = 0; i <= along; i++) {
    for (let k = 0; k < around; k++) {
      const a = (k / around) * TAU;
      pos[w++] = i / along; pos[w++] = Math.cos(a); pos[w++] = Math.sin(a);
    }
  }
  let q = 0;
  for (let i = 0; i < along; i++) {
    for (let k = 0; k < around; k++) {
      const a = i * around + k;
      const b = i * around + (k + 1) % around;
      const c = a + around;
      const d = b + around;
      idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 600);
  return g;
}

/**
 * NITKA żużla: lepka struga gęstej cieczy ciągnięta z czapy do dzwonu ssawy (jak ciągnione szkło). Łuk: z wierzchołka
 * stożka czapy pionowo w górę, potem prosto ku dzwonowi (ciecz pod naciągiem). Rysowany jest odcinek [thr0.w, thr1.w]
 * drogi: nitka wyciąga się od korzenia (zaokrąglony czubek) i rwie od korzenia (ogon znika w dzwonie). U korzenia
 * szersza i ciemniejsza jak czapa, dalej cienka i gorąca; zgrubienia płyną ku dzwonowi (widać kierunek przepływu),
 * całość lekko się kołysze. Grubość z przepływu.
 */
function threadMaterial(U) {
  const vP = varyingProperty('vec3', 'vWnP');
  const vN = varyingProperty('vec3', 'vWnN');
  const vS = varyingProperty('vec2', 'vWnS');
  const vertex = Fn(() => {
    const a = attribute('position', 'vec3');
    const s0 = U.thr0.w;
    const s1 = U.thr1.w;
    const on = step(0.004, s1.sub(s0));
    const u = a.x;
    const s = float(0.0).toVar();
    s.assign(mix(s0, s1, u));
    const om = float(0.0).toVar();
    om.assign(float(1.0).sub(s));
    const P0 = U.thr0.xyz;
    const P1 = U.thr2.xyz;
    const P2 = U.thr1.xyz;
    const c = vec3(0.0).toVar();
    c.assign(P0.mul(om.mul(om)).add(P1.mul(om.mul(s).mul(2.0))).add(P2.mul(s.mul(s))));
    const tg = vec3(0.0).toVar();
    tg.assign(normalize(P1.sub(P0).mul(om).add(P2.sub(P1).mul(s)).add(vec3(0.0, 1e-4, 0.0))));
    const bn = vec3(0.0).toVar();
    bn.assign(normalize(cross(tg, vec3(0.0, 0.0, 1.0)).add(vec3(1e-4, 0.0, 0.0))));
    const zn = vec3(0.0).toVar();
    zn.assign(cross(bn, tg));
    const time = U.ball.w;
    // kołysanie lepkiej nitki (końce stoją)
    const mid = float(0.0).toVar();
    mid.assign(sin(s.mul(3.14159265)));
    c.addAssign(zn.mul(mid.mul(sin(time.mul(2.3).add(s.mul(5.0)))).mul(3.0)).add(bn.mul(mid.mul(sin(time.mul(1.7).add(s.mul(4.0)).add(1.0))).mul(2.0))));
    // grubość: z przepływu; u korzenia szeroki lejek przechodzący w stożek czapy, dalej struga zwęża się jak
    // ciągnione szkło; po strudze płyną ku dzwonowi zgrubienia-krople (widać kierunek i lepkość)
    const bead = float(0.0).toVar();
    bead.assign(sin(s.mul(3.1).sub(time.mul(1.25)).mul(6.2831853)).mul(0.5).add(0.5));
    bead.assign(bead.mul(bead).mul(bead).mul(smoothstep(0.08, 0.3, s)));
    const r = float(0.0).toVar();
    r.assign(U.thr2.w.mul(5.0).add(5.2).mul(exp(s.div(-0.11)).mul(2.3).add(1.0)).mul(float(1.0).sub(smoothstep(0.15, 0.95, s).mul(0.36))));
    r.mulAssign(bead.mul(0.34).add(1.0));
    // końce narysowanego odcinka: rosnąca nitka ma zaokrąglony czubek, zerwana — zwężający się ogon
    const hi = clamp(u.sub(0.7).div(0.3), 0.0, 1.0);
    const tipHi = mix(float(1.0), sqrt(max(float(1.0).sub(hi.mul(hi)), 0.0)), step(s1, 0.995));
    const tipLo = mix(float(1.0), smoothstep(0.0, 0.35, u), step(0.005, s0));
    r.mulAssign(tipHi.mul(tipLo).mul(on));
    const nr = vec3(0.0).toVar();
    nr.assign(bn.mul(a.y).add(zn.mul(a.z)));
    const pc = vec3(0.0).toVar();
    pc.assign(c.add(nr.mul(r)));
    vP.assign(pc);
    vN.assign(nr);
    vS.assign(vec2(s, bead));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(pc, 1.0)));
  })();
  const fragment = Fn(() => {
    const P = vec3(0.0).toVar();
    P.assign(vP);
    const V = normalize(U.cam.sub(P));
    const N0 = normalize(vN);
    const mu = float(0.0).toVar();
    mu.assign(abs(dot(N0, V)));
    const s = vS.x;
    // NIEPRZEZROCZYSTA, błyszcząca rura gęstej cieczy w barwie żużla: u korzenia ciemny pomarańcz (ciągły z rozgrzanym
    // żużlem wokół stożka czapy), dalej żar czerwienieje i gaśnie ku dzwonowi (struga stygnie w locie). Pod progiem
    // poświaty — ponad próg wychodzi tylko rdzeń przy samym korzeniu. Bryłę rury daje ciemniejszy brzeg sylwetki
    // i połysk wzdłuż (odbicie otwartej góry, lamp i żaru kuli), nie rozmyta poświata.
    const bead = vS.y;
    const T = U.ball.z;
    const Tt = float(0.0).toVar();
    Tt.assign(T.mul(mix(float(0.83), float(0.6), smoothstep(0.0, 0.85, s))).add(bead.mul(0.035)));
    const Nn = vec3(0.0).toVar();
    Nn.assign(N0.mul(sign(dot(N0, V).add(1e-5))));
    const round = float(0.0).toVar();
    round.assign(mu.mul(0.55).add(0.45));
    const col = vec3(0.0).toVar();
    col.assign(heatColor(U, Tt).mul(heatPower(Tt).mul(U.t1.x).mul(U.t5.z).mul(round).mul(1.15)));
    // rdzeń przy korzeniu: świeży żużel prosto z czapy
    col.addAssign(heatColor(U, T.mul(0.92)).mul(exp(s.div(-0.07)).mul(mu.mul(mu)).mul(0.5).mul(U.t5.z)));
    // połysk: szeroki od otwartej góry, wąski od słońca, ciepły od rozżarzonej kuli pod spodem (Fresnel)
    const r = vec3(0.0).toVar();
    r.assign(reflect(V.negate(), Nn));
    const om = float(1.0).sub(mu);
    const fres = om.mul(om).mul(om).mul(0.85).add(0.15);
    const up = max(r.y, 0.0);
    col.addAssign(vec3(0.6, 0.55, 0.5).mul(up.mul(up).mul(up).mul(0.2).add(pow(up, 16.0).mul(0.22))));
    col.addAssign(U.sunColor.mul(pow(max(dot(r, U.sunDir), 0.0), 28.0).mul(0.3).mul(sunVis(U, P))));
    col.addAssign(U.light.xyz.mul(min(U.light.w.mul(0.035), 0.3)).mul(max(r.y.negate(), 0.0)).mul(fres));
    // zimna skóra żużla w świetle otoczenia (ku dzwonowi struga ciemnieje do barwy żużla, nie do czerni)
    col.addAssign(U.slag.mul(skyLight(U, P, Nn).mul(1.4).add(vec3(0.05, 0.035, 0.025))).mul(smoothstep(0.1, 0.9, s)));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return nodeMaterial('WytopNitka', vertex, fragment, { side: THREE.DoubleSide });
}

/**
 * Granulki żużla w odbieralniku: iCur (xyz, promień), iPrev (xyz, żar 0…1), iS (numer, w locie). Spadająca kropla
 * żarzy się jak świeży żużel; w korycie stygnie w ciemną, szklistą granulkę.
 */
function granuleMaterial(U) {
  const vPc = varyingProperty('vec3', 'vWgP');
  const vS = varyingProperty('vec3', 'vWgS');
  const vertex = Fn(() => {
    const iCur = attribute('iCur', 'vec4');
    const iPrev = attribute('iPrev', 'vec4');
    const iS = attribute('iS', 'vec2');
    const lp0 = attribute('position', 'vec3');
    const id = iS.x;
    const q = vec4(0.0).toVar();
    q.assign(normalize(vec4(sin(id.mul(1.7).add(0.3)), sin(id.mul(2.3).add(1.1)), sin(id.mul(3.1).add(2.0)), cos(id.mul(0.9)).add(1.3))));
    const c = mix(iPrev.xyz, iCur.xyz, U.frame.x);
    // kropla w locie jest okrągła i wydłużona w kierunku spadania; granulka w korycie — spłaszczona bryłka
    const fly = iS.y;
    const shape = mix(vec3(1.0, 0.78, 1.0), vec3(0.8, 1.25, 0.8), fly);
    const pc = vec3(0.0).toVar();
    pc.assign(c.add(qrot(q, lp0).mul(shape).mul(iCur.w)));
    vPc.assign(pc);
    vS.assign(vec3(iPrev.w, fract(id.mul(0.618034)), fly));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(pc, 1.0)));
  })();
  const fragment = Fn(() => {
    const N = flatNormal(U, vPc);
    const P = vec3(0.0).toVar();
    P.assign(vPc);
    const heat = vS.x;
    const sv = sunVis(U, P);
    const V = normalize(U.cam.sub(P));
    const ndl = max(dot(N, U.sunDir), 0.0);
    const lightv = vec3(0.0).toVar();
    lightv.assign(U.sunColor.mul(ndl).mul(sv).add(skyLight(U, P, N)).add(ballLight(U, P, N).mul(0.5)));
    const T = U.ball.z;
    const Tg = float(0.0).toVar();
    Tg.assign(T.mul(heat.mul(heat).mul(0.72).add(0.2)));
    const em = heatColor(U, Tg).mul(heatPower(Tg).mul(U.t1.x).mul(U.t5.w).mul(2.2)).mul(dot(N, V).mul(0.4).add(0.6));
    // szklisty, ciemny żużel: słaby połysk na ściankach
    const spec = pow(max(dot(reflect(V.negate(), N), U.sunDir), 0.0), 30.0).mul(0.35).mul(sv);
    const lit = vec3(0.0).toVar();
    lit.assign(U.slag.mul(vS.y.mul(0.35).add(0.25)).mul(lightv).add(U.sunColor.mul(spec)));
    const lum = dot(lit, LUMA);
    lit.mulAssign(min(float(1.0), float(0.22).div(max(lum, 1e-3))));
    return vec4(max(lit.add(em), vec3(0.0)), 1.0);
  })();
  return nodeMaterial('WytopGranulka', vertex, fragment);
}

/**
 * Krople metalu: kwad wzdłuż promienia kuli (iCur: xyz, promień; iPrev: xyz, wiek). Emisyjne w barwie kuli (bez
 * połysku kulki), rozciągane wzdłuż ruchu; blisko powierzchni łączy je z kulą nitka-szyjka.
 */
function dropMaterial(U) {
  const vUv = varyingProperty('vec4', 'vWdU');
  const vUp = varyingProperty('float', 'vWdUp');
  const vertex = Fn(() => {
    const iCur = attribute('iCur', 'vec4');
    const iPrev = attribute('iPrev', 'vec4');
    const corner = attribute('position', 'vec3');
    const c = vec3(0.0).toVar();
    c.assign(mix(iPrev.xyz, iCur.xyz, U.frame.x));
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(c, 1.0)));
    const bc = vec4(0.0).toVar();
    bc.assign(modelViewMatrix.mul(vec4(U.off, 1.0)));
    // oś kwadu: od środka kuli na zewnątrz (na ekranie)
    const ax = vec2(0.0).toVar();
    ax.assign(mv.xy.sub(bc.xy));
    const al = float(0.0).toVar();
    al.assign(max(length(ax), 1e-3));
    ax.assign(ax.div(al));
    const ppu = U.frame.y.div(max(mv.z.negate(), 1.0));
    const rad = float(0.0).toVar();
    rad.assign(max(iCur.w, float(1.3).div(max(ppu, 1e-4))));
    // rozciągnięcie z prędkości wzdłuż promienia; szyjka, gdy kropla jest bliżej niż 15 j. od powierzchni
    const rel = c.sub(U.off);
    const dist = float(0.0).toVar();
    dist.assign(length(rel));
    const vr = dot(iCur.xyz.sub(iPrev.xyz), rel.div(max(dist, 1.0))).mul(60.0);
    const stretch = float(0.0).toVar();
    stretch.assign(clamp(abs(vr).div(260.0), 0.0, 1.4));
    const gap = float(0.0).toVar();
    gap.assign(dist.sub(U.ball.x));
    // (przy zrzucie — grawitacja włączona — krople lecą balistycznie: bez szyjki)
    const neck = float(0.0).toVar();
    neck.assign(clamp(gap.add(2.0), 0.0, 24.0).mul(float(1.0).sub(smoothstep(17.0, 23.0, gap))).mul(float(1.0).sub(step(0.5, U.grav.z))));
    // długość szyjki na ekranie: skrócona rzutem (kropla nad środkiem tarczy — szyjka idzie ku kamerze)
    const proj = clamp(al.div(max(dist, 1.0)), 0.0, 1.0);
    const up = rad.mul(stretch.add(1.0));
    const down = rad.add(neck.mul(proj));
    const along = mix(down.negate(), up, corner.y.mul(0.5).add(0.5));
    vUv.assign(vec4(corner.x.mul(rad), along, rad, neck.mul(proj)));
    vUp.assign(up);
    const off = ax.mul(along).add(vec2(ax.y.negate(), ax.x).mul(corner.x.mul(rad)));
    return cameraProjectionMatrix.mul(vec4(mv.xy.add(off), mv.z, 1.0));
  })();
  const fragment = Fn(() => {
    const x = vUv.x;
    const y = vUv.y;
    const rad = vUv.z;
    const neck = vUv.w;
    // głowa: od spodu półkole, od czoła półelipsa o długości kwadu (kropla wolna jest okrągła, szybka — wydłużona)
    const ry = max(y, 0.0);
    const head = float(1.0).sub(smoothstep(0.75, 1.0, x.mul(x).add(min(y, 0.0).mul(min(y, 0.0))).div(rad.mul(rad)).add(ry.mul(ry).div(max(vUp.mul(vUp), 1e-4)))));
    // szyjka: przewężenie w połowie, rozszerzenie przy powierzchni kuli
    const t = clamp(y.negate().div(max(neck, 1e-3)), 0.0, 1.0);
    const wn = rad.mul(float(0.2).add(t.mul(2.0).sub(1.0).mul(t.mul(2.0).sub(1.0)).mul(0.42)));
    const thread = float(1.0).sub(smoothstep(wn.mul(0.6), wn, abs(x))).mul(step(y, 0.0)).mul(step(1e-3, neck)).mul(float(1.0).sub(smoothstep(neck, neck.add(rad.mul(0.6)), y.negate())));
    const mask = max(head, thread);
    const core = float(1.0).sub(clamp(x.mul(x).div(rad.mul(rad)), 0.0, 1.0));
    const T = U.ball.z.add(0.1);
    const col = heatColor(U, T.sub(float(1.0).sub(core).mul(0.2))).mul(heatPower(T).mul(U.t1.x).mul(core.mul(0.6).add(0.75)).mul(1.5));
    return vec4(col.mul(mask), mask);
  })();
  const m = nodeMaterial('WytopKropla', vertex, fragment, { side: THREE.DoubleSide });
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.forceSinglePass = true;
  return m;
}

/**
 * Iskry: cienka smuga wzdłuż prędkości (iCur: xyz, życie 0…1; iPrev: xyz, żar) — głowa w położeniu iskry, ogon
 * za nią (długość z prędkości, proporcja co najmniej 1 : 9), ogon gaśnie; barwa stygnie z życiem.
 */
function sparkMaterial(U) {
  const vUv = varyingProperty('vec3', 'vWiU');
  const vertex = Fn(() => {
    const iCur = attribute('iCur', 'vec4');
    const iPrev = attribute('iPrev', 'vec4');
    const corner = attribute('position', 'vec3');
    const c = mix(iPrev.xyz, iCur.xyz, U.frame.x);
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(c, 1.0)));
    const dv = vec3(0.0).toVar();
    dv.assign(modelViewMatrix.mul(vec4(iCur.xyz.sub(iPrev.xyz), 0.0)).xyz);
    const dl = float(0.0).toVar();
    dl.assign(length(dv.xy));
    const dir = vec2(0.0).toVar();
    dir.assign(dv.xy.div(max(dl, 1e-3)));
    const ppu = U.frame.y.div(max(mv.z.negate(), 1.0));
    const wid = max(float(0.55), float(0.85).div(max(ppu, 1e-4)));
    // ogon = droga z ostatnich ok. 0,06 s (krok symulacji 1/60 s), nie krótszy niż 9 szerokości
    const len = max(dl.mul(3.6), wid.mul(9.0));
    // głowa w położeniu iskry: kwad sięga od −len (ogon) do +wid (czoło)
    const along = mix(len.negate(), wid, corner.x.mul(0.5).add(0.5));
    const off = dir.mul(along).add(vec2(dir.y.negate(), dir.x).mul(corner.y.mul(wid)));
    vUv.assign(vec3(corner.x.mul(0.5).add(0.5), corner.y, iCur.w));
    return cameraProjectionMatrix.mul(vec4(mv.xy.add(off), mv.z, 1.0));
  })();
  const fragment = Fn(() => {
    const across = float(1.0).sub(smoothstep(0.15, 1.0, abs(vUv.y)));
    // wzdłuż: 0 = koniec ogona, 1 = czoło; ogon gaśnie kwadratowo
    const t = clamp(vUv.x, 0.0, 1.0);
    const along = t.mul(t).mul(float(1.0).sub(smoothstep(0.93, 1.0, t)));
    const life = clamp(vUv.z, 0.0, 1.0);
    const col = mix(U.spark.mul(0.5), mix(U.spark, vec3(1.0, 0.9, 0.7), life), smoothstep(0.15, 0.6, life)).mul(across.mul(along).mul(life.mul(0.8).add(0.2)).mul(3.4).mul(U.t4.w));
    return vec4(col, 1.0);
  })();
  return nodeMaterial('WytopIskra', vertex, fragment, { additive: true, side: THREE.DoubleSide });
}

/** Błyski wtopień: krótki rozbłysk w punkcie styku (iA: xyz, czas narodzin; iB: wielkość, 0, 0, 0). */
function flashMaterial(U) {
  const vUv = varyingProperty('vec3', 'vWbU');
  const vertex = Fn(() => {
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec4');
    const corner = attribute('position', 'vec3');
    const age = float(0.0).toVar();
    age.assign(U.ball.w.sub(iA.w));
    const k = float(0.0).toVar();
    k.assign(clamp(age.div(0.14), 0.0, 1.0));
    const alive = step(0.0, age).mul(step(age, 0.14));
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(iA.xyz, 1.0)));
    const size = iB.x.mul(k.mul(0.9).add(0.4)).mul(alive);
    vUv.assign(vec3(corner.x, corner.y, float(1.0).sub(k)));
    // odsunięcie ku kamerze: błysk nie tonie w powierzchni kuli
    return cameraProjectionMatrix.mul(vec4(mv.xy.add(corner.xy.mul(size)), mv.z.add(size.mul(0.8)), 1.0));
  })();
  const fragment = Fn(() => {
    const r2 = dot(vUv.xy, vUv.xy);
    const core = exp(r2.mul(-7.0));
    const fade = vUv.z.mul(vUv.z);
    const col = heatColor(U, float(1.25)).mul(core.mul(fade).mul(1.4).mul(U.t4.w)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
    return vec4(col, 1.0);
  })();
  return nodeMaterial('WytopBlysk', vertex, fragment, { additive: true, side: THREE.DoubleSide });
}

/** Błona granicy 0 g: cienki, addytywny krążek w pierścieniu — widać ją, gdy przechodzą ziarna. */
function membraneMaterial(U) {
  const vUv = varyingProperty('vec2', 'vWmU');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    vUv.assign(attribute('uv', 'vec2'));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1.0)));
  })();
  const fragment = Fn(() => {
    const r = length(vUv);
    const rim = exp(float(1.0).sub(r).div(0.07).mul(float(1.0).sub(r).div(0.07)).negate());
    const t = U.ball.w;
    // fale rozchodzące się od środka z przepływem ziaren, delikatna siatka pola
    const wave = sin(r.mul(26.0).sub(t.mul(7.0))).mul(0.5).add(0.5);
    const grid = smoothstep(0.86, 1.0, abs(sin(vUv.x.mul(21.0)))).add(smoothstep(0.86, 1.0, abs(sin(vUv.y.mul(21.0))))).mul(0.5);
    const flux = U.grain.w;
    const a = rim.mul(0.16).add(grid.mul(0.035)).add(wave.mul(wave).mul(0.07).mul(flux)).mul(float(1.0).sub(smoothstep(0.97, 1.0, r)));
    // błona gaśnie, gdy generator 0 g stoi (grawitacja włączona)
    return vec4(vec3(0.22, 0.85, 1.0).mul(a).mul(flux.mul(0.6).add(0.55)).mul(U.grav.y), 1.0);
  })();
  return nodeMaterial('WytopBlona', vertex, fragment, { additive: true, side: THREE.DoubleSide });
}

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);

/** Partia instancji na buforze z przeplotem (pułapki 24 i 42): `Mesh` + `InstancedBufferGeometry`. */
function batch(name, base, data, stride, attrs, material) {
  const buf = new THREE.InstancedInterleavedBuffer(data, stride);
  const g = new THREE.InstancedBufferGeometry();
  for (const [key, attr] of Object.entries(base)) g.setAttribute(key, attr);
  for (const [key, size, off] of attrs) g.setAttribute(key, new THREE.InterleavedBufferAttribute(buf, size, off));
  g.instanceCount = 0;
  const mesh = new THREE.Mesh(g, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  return { mesh, buf, g, stride };
}

const lerp = (a, b, t) => a + (b - a) * t;
const heatPowerJs = (T) => {
  const t = Math.max(0, Math.min(1.5, T));
  const s = Math.max(0, Math.min(1, (t - 0.12) / 0.24));
  return (Math.pow(t, 3.5) * 0.97 + 0.03) * s * s * (3 - 2 * s);
};

export class WytopObraz {
  /**
   * @param {object} o
   * @param {THREE.Group} o.root   grupa w układzie komory
   * @param {object} o.sim         komora (`createMeltChamber`)
   */
  constructor({ root, sim }) {
    this.root = root;
    this.U = createWytopUniforms();
    const U = this.U;
    U.sunColor.value.set(...PORT_SPACE_LIGHT.sunColor);
    U.ambient.value.set(0.1, 0.12, 0.165);
    U.sunDir.value.set(-0.6, 0.6, 0.3).normalize();
    this.S = new Float64Array(STAN_N);          // stan wymieszany prev → cur
    this.meshes = [];
    this.instanced = [];
    const add = (mesh, order = 0, instanced = false) => {
      mesh.renderOrder = order;
      root.add(mesh);
      this.meshes.push(mesh);
      if (instanced) this.instanced.push(mesh);
      return mesh;
    };
    // wyposażenie: część stała i ruchoma na jednym materiale
    this.eqMaterial = createEquipmentMaterial(U);
    const st = new Budowniczy(260000);
    buildChamberStatic(st);
    if (st.over) throw new Error(`wytop: za mała pojemność siatki stałej (brakuje ${st.over} wierzchołków)`);
    this.staticVerts = st.n;
    this.static = add(meshFromBuilder(st, this.eqMaterial, 'Wytop_komora'));
    this.dyn = new Budowniczy(24000);
    this.dynamic = add(meshFromBuilder(this.dyn, this.eqMaterial, 'Wytop_maszyny', true));
    // wyświetlacz grawitacji: jedna bryła (pas ekranów na ścianie), jeden materiał
    this.display = add(new THREE.Mesh(createDisplayGeometry(), createDisplayMaterial(U)));
    this.display.name = 'Wytop_wyswietlacz';
    this.display.frustumCulled = false;
    // wskaźniki tlenu (odciąg gazu): jedna siatka pasów, jeden materiał
    this.oxygen = add(createOxygenMesh(U));
    this.oxyLen = KOMORA.gaz.tanks.z.map((_, k) => oxyRouteLength(k));
    // taśma
    this.beltLight = {
      sunDir: { value: new THREE.Vector3(0.4, 0.3, 0.87).normalize() }, sunColor: { value: new THREE.Vector3(...PORT_SPACE_LIGHT.sunColor) },
      ambient: { value: new THREE.Vector3(0.05, 0.056, 0.07) }, light: { value: new THREE.Vector4(0.5, 1, 0, 0) }
    };
    this.belt = createConveyor3D({ track: sim.track, light: this.beltLight, name: 'Wytop_tasma' });
    add(this.belt.mesh);
    // kula i masa w leju: ten sam metal (wspólny fragment), dwie siatki — nigdy obie naraz
    const metal = createMetalMaterials(U);
    this.ball = add(new THREE.Mesh(createBallGeometry(88), metal.ball));
    this.ball.name = 'Wytop_kula';
    this.ball.frustumCulled = false;
    this.mass = add(new THREE.Mesh(createMassGeometry(), metal.mass));
    this.mass.name = 'Wytop_masa';
    this.mass.frustumCulled = false;
    this.mass.visible = false;
    // ziarna: bufor = tablica widoku symulacji
    const V = sim.view;
    const chunk = chunkBase(11, 4242);
    this.grains = batch('Wytop_ziarna', { position: chunk.position, aP1: chunk.p1, aP2: chunk.p2, aP3: chunk.p3 }, V.ziarna, GRAIN_STRIDE,
      [['iCur', 3, 0], ['iPrev', 3, 3], ['iA', 4, 6], ['iB', 2, 10]], grainMaterial(U));
    add(this.grains.mesh, 0, true);
    // nitka żużla (czapa → dzwon ssawy) i granulki żużla w odbieralniku
    this.thread = add(new THREE.Mesh(threadGeometry(), threadMaterial(U)));
    this.thread.name = 'Wytop_nitka';
    this.thread.frustumCulled = false;
    const pebble = chunkShape(5151, 10, [1.0, 0.86, 0.94]);
    this.granules = batch('Wytop_granulki', { position: new THREE.BufferAttribute(pebble, 3) }, V.granulki, GRANULE_STRIDE,
      [['iCur', 4, 0], ['iPrev', 4, 4], ['iS', 2, 8]], granuleMaterial(U));
    add(this.granules.mesh, 0, true);
    const quad = () => ({ position: new THREE.BufferAttribute(QUAD, 3) });
    this.drops = batch('Wytop_krople', quad(), V.krople, PART_STRIDE, [['iCur', 4, 0], ['iPrev', 4, 4]], dropMaterial(U));
    add(this.drops.mesh, 30, true);
    this.sparks = batch('Wytop_iskry', quad(), V.iskry, PART_STRIDE, [['iCur', 4, 0], ['iPrev', 4, 4]], sparkMaterial(U));
    add(this.sparks.mesh, 32, true);
    this.flashes = batch('Wytop_blyski', quad(), V.blyski, EVENT_STRIDE, [['iA', 4, 0], ['iB', 4, 4]], flashMaterial(U));
    this.flashes.g.instanceCount = POOL.flashes;
    add(this.flashes.mesh, 31, true);
    // błona granicy 0 g
    const B = KOMORA.belt;
    const mg = new THREE.BufferGeometry();
    const mp = [];
    const mu = [];
    const zc = B.pts[B.pts.length - 1][2];
    for (let k = 0; k < 40; k++) {
      const a0 = (k / 40) * TAU;
      const a1 = ((k + 1) / 40) * TAU;
      mp.push(B.boundaryX, B.ringY, zc, B.boundaryX, B.ringY + Math.sin(a0) * B.ringR, zc + Math.cos(a0) * B.ringR, B.boundaryX, B.ringY + Math.sin(a1) * B.ringR, zc + Math.cos(a1) * B.ringR);
      mu.push(0, 0, Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1));
    }
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mp), 3));
    mg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(mu), 2));
    this.membrane = add(new THREE.Mesh(mg, membraneMaterial(U)), 28);
    this.membrane.name = 'Wytop_blona';
    this.membrane.frustumCulled = false;
    this.counts = { grains: 0, heap: 0, granules: 0, drops: 0, sparks: 0, floes: 0 };
    this.setMetal(sim.metal);
    this.apply(V);
  }

  setLayers(layer) { for (const m of this.meshes) m.layers.set(layer); }

  /** Siatki do rozgrzewki: [zwykłe, instancjonowane]. */
  warmupMeshes() {
    return { plain: this.meshes.filter((m) => !this.instanced.includes(m)), instanced: this.instanced.slice() };
  }

  /** Barwy metalu i jego rudy. */
  setMetal(M) {
    const U = this.U;
    this.metal = M;
    U.ramp0.value.set(...M.ramp[0]);
    U.ramp1.value.set(...M.ramp[1]);
    U.ramp2.value.set(...M.ramp[2]);
    U.ramp3.value.set(...M.ramp[3]);
    U.slag.value.set(...M.slag);
    U.slagHot.value.set(...M.slagHot);
    U.spark.value.set(...M.spark);
    U.light.value.set(M.light[0], M.light[1], M.light[2], 0);
    U.limb.value.set(M.limb[0], M.limb[1], M.limb[2], M.limbGain);
    const ore = ORES[M.ore] || ORES[0];
    U.shade0.value.set(...ore.shades[0]);
    U.shade1.value.set(...ore.shades[1]);
    U.shade2.value.set(...ore.shades[2]);
    U.vein.value.set(...ore.vein);
    U.grain.value.set(GRAIN_DRAW_R * ore.grainScale * GRAIN_K, ore.sheen, 1.0, 0);
  }

  /** Kierunek ku słońcu w układzie komory (x, y w górę, z) i w układzie sceny (dla taśmy zestawu). */
  setSun(cx, cy, cz, scene) {
    this.U.sunDir.value.set(cx, cy, cz).normalize();
    if (scene) this.beltLight.sunDir.value.copy(scene);
  }

  /** Po kroku symulacji: wysyłka rekordów instancji (tablice widoku są buforami — bez kopii). */
  apply(V) {
    const up = (b, n, stride) => {
      b.g.instanceCount = n;
      if (n > 0) zbierzZakres(b.buf, 0, n * stride);
    };
    up(this.grains, V.nZiarna, GRAIN_STRIDE);
    up(this.granules, V.nGranulki, GRANULE_STRIDE);
    up(this.drops, V.nKrople, PART_STRIDE);
    up(this.sparks, V.nIskry, PART_STRIDE);
    zbierzZakres(this.flashes.buf, 0, POOL.flashes * EVENT_STRIDE);
    this.counts.grains = V.nZiarna;
    this.counts.heap = V.nKupa;
    this.counts.granules = V.nGranulki;
    this.counts.drops = V.nKrople;
    this.counts.sparks = V.nIskry;
    this.counts.floes = V.nKry;
    this.view = V;
  }

  /**
   * Klatka obrazu.
   * @param {object} a  alpha (postęp kroku 0…1), cam [x, y, z] (kamera w układzie komory), pxK (px na jednostkę ×
   *                    odległość), ppuBall (px na jednostkę przy kuli), minPx, viewW, viewH
   */
  frame(a) {
    const V = this.view;
    const U = this.U;
    const S = this.S;
    const al = a.alpha;
    const cur = V.stan;
    const prev = V.stanPrev;
    for (let i = 0; i < STAN_N; i++) S[i] = lerp(prev[i], cur[i], al);
    // wielkości nieciągłe z bieżącego kroku
    S[STAN.phase] = cur[STAN.phase];
    S[STAN.suck] = cur[STAN.suck];
    S[STAN.grav] = cur[STAN.grav];
    S[STAN.gate] = cur[STAN.gate];
    S[STAN.dsp] = cur[STAN.dsp];
    S[STAN.impactT] = cur[STAN.impactT] >= 0 ? Math.max(0, S[STAN.impactT]) : -1;
    const R = S[STAN.radius];
    const T = S[STAN.temp];
    const time = S[STAN.time];
    // kula jest rysowana, gdy istnieje: od jądra w topionej kupie do zetknięcia z lejem; od zetknięcia metal rysuje
    // siatka MASY na polu grubości z symulacji (kula i masa to w kadrze jedna bryła — nigdy obie naraz)
    const funnelUnits = V.counters[LICZNIK.funnel] + (cur[STAN.impactT] >= 0 ? V.counters[LICZNIK.metal] : 0);
    const pooling = cur[STAN.impactT] >= 0;
    const ballOn = R > 0.5 && !pooling;
    const massOn = pooling && V.masaOn === 1 && funnelUnits > 0;
    // `forceBall` — klatki rozruchu strony: kula i masa rysowane także bez metalu (kula o promieniu 0,5 j., masa
    // schowana pod wykładziną), żeby ich pipeline'y były gotowe przed pierwszym użyciem
    this.ball.visible = ballOn || this.forceBall === true;
    this.mass.visible = massOn || this.forceBall === true;
    // pole grubości: komórki wymieszane między początkiem a końcem kroku (bez masy — zera: siatka pod wykładziną)
    {
      const ma = U.masa.array;
      if (massOn) {
        const m1 = V.masa;
        const m0 = V.masaPrev;
        const fresh = prev[STAN.impactT] < 0;                  // pierwszy krok po zetknięciu: bez mieszania z pustym polem
        for (let i = 0; i < MASA_CELLS; i++) {
          const o = i * MASA_STRIDE;
          if (fresh) ma[i].set(m1[o], m1[o + 1], 0, 0);
          else ma[i].set(m0[o] + (m1[o] - m0[o]) * al, m0[o + 1] + (m1[o + 1] - m0[o + 1]) * al, 0, 0);
        }
        // średnia grubość w pierwszym pierścieniu (wspólna część przejścia od komórki środkowej do pierścienia)
        let ring0 = 0;
        for (let i = 0; i < MASA.na; i++) ring0 += ma[i].x;
        U.mass2.value.x = ring0 / MASA.na;
        this.massZero = false;
      } else if (!this.massZero) {
        for (let i = 0; i < MASA_CELLS; i++) ma[i].set(0, 0, 0, 0);
        U.mass2.value.x = 0;
        this.massZero = true;
      }
    }
    U.ball.value.set(Math.max(R, 0.5), S[STAN.rot] % TAU, T, time);
    const ripSpeed = Math.min(3.4, 1.7 * Math.pow(177 / Math.max(R, 60), 1.5));
    const SS = KOMORA.ssawa;
    U.ball2.value.set(ripSpeed, Math.min(1, S[STAN.meltRate] / 900), SS.coneH * S[STAN.coneK] / Math.max(R, 20), SS.coneW);
    U.slag2.value.set(ballOn ? V.nKry : 0, S[STAN.coneK], S[STAN.tail], 0);
    U.cam.value.set(a.cam[0], a.cam[1], a.cam[2]);
    U.frame.value.set(al, a.pxK, a.minPx, 1 / Math.max(1e-3, R * a.ppuBall));
    U.glow.value.set(S[STAN.coilGlow], S[STAN.radGlow], Math.min(1, S[STAN.trayGlow]), S[STAN.clean]);
    // maszyneria, sygnalizacja grawitacji, lej, zrzut
    const MACH = KOMORA.mach;
    U.mach.value.set(MACH.rOut - S[STAN.mach], S[STAN.mach], MACH.padY - S[STAN.machY], S[STAN.machY]);
    U.cage.value.set(S[STAN.cageX], S[STAN.cageY], S[STAN.cageZ]);
    // sygnalizacja grawitacji: wyświetlacz (fazy szewronów jako ułamki komórki — bez utraty precyzji), pierścień bramy
    // 0 g w tym samym takcie; barwa wyświetlacza = światło robocze komory (lekko odbarwione — rozproszone na ścianach)
    const DSPK = KOMORA.display;
    const turns = S[STAN.spin] * DSPK.speed * 2;
    const turn = S[STAN.dspTurn];
    U.grav.value.set(turns - Math.floor(turns), S[STAN.dspSpeed], turn, S[STAN.gate]);
    const du = S[STAN.dspU];
    const dv = S[STAN.dspV];
    U.disp.value.set(du - Math.floor(du), turn, dv - Math.floor(dv), 1);
    {
      let k = (turn - 0.35) / 0.6;
      k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
      const r = DISPLAY_COOL[0] + (DISPLAY_WARM[0] - DISPLAY_COOL[0]) * k;
      const g = DISPLAY_COOL[1] + (DISPLAY_WARM[1] - DISPLAY_COOL[1]) * k;
      const b = DISPLAY_COOL[2] + (DISPLAY_WARM[2] - DISPLAY_COOL[2]) * k;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const gain = 0.46;
      U.dcol.value.set((r + (lum - r) * 0.4) * gain, (g + (lum - g) * 0.4) * gain, (b + (lum - b) * 0.4) * gain);
    }
    // ODCIĄG I TLEN: impulsy w rurze (faza w przedziałach rury), napełniany zbiornik, przepływ odciągu, żaluzje;
    // napełnienie zbiorników i opróżniany (wartości nieciągłe — z bieżącego kroku); droga do napełnianego zbiornika
    {
      const tf = cur[STAN.tankFill] | 0;
      U.oxy.value.set(S[STAN.pipeU] % 4096, tf, Math.min(1, S[STAN.gasFlow] / OXY_FLOW_REF), S[STAN.hood]);
      U.oxy2.value.set(S[STAN.tank0], S[STAN.tank1], S[STAN.tank2], cur[STAN.tankDrain]);
      U.oxy3.value.set(this.oxyLen[tf] || this.oxyLen[0], KOMORA.gaz.tanks.z[tf] ?? 0, Math.max(0, S[STAN.wentyl]), Math.min(1, S[STAN.ductFlow] / OXY_FLOW_REF));
      const da = U.duct.array;
      const G = V.gazRura;
      for (let i = 0; i < da.length; i++) da[i].set(G[i * 4], G[i * 4 + 1], G[i * 4 + 2], G[i * 4 + 3]);
    }
    // (siła zasysania dla rysunku fal i smug: pełna, gdy ciecz przy gardzieli wiruje z połową prędkości nadawanej
    // przez łopatki — tyle ma w ustalonym spływie)
    U.vor.value.set(pooling ? Math.min(1, S[STAN.vortex] / 0.45) : 0, S[STAN.twist], pooling ? S[STAN.dimple] : 0, S[STAN.lakeR]);
    U.fun.value.set(S[STAN.level], S[STAN.levelMax], S[STAN.funHeat], S[STAN.throat]);
    U.fall.value.set(S[STAN.squash], S[STAN.wide], S[STAN.pool], S[STAN.impactT]);
    // masa w leju: wzór powierzchni odwzorowany jak na kuli w chwili zetknięcia, w ok. 0,35 s przechodzi płynnie
    // w odwzorowanie płaskie w jednostkach świata (komórki tej samej wielkości co na kuli — `U.mass2.y`); „płaskość”
    // (kula → jezioro: bez pasów grzania cewek) narasta w pierwszych 0,6 s; oś kuli z chwili zetknięcia stoi;
    // `U.mass2.z` — kołysanie masy 0…1 (żywość drobnej fali), `U.mass2.w` — jezioro ustalone 0…1 (jasny pas żaru
    // wykładziny tuż nad lustrem pojawia się dopiero, gdy masa leży na poziomie spoczynkowym)
    {
      const ti = pooling ? Math.max(0, S[STAN.impactT]) : 0;
      let k = (ti - 0.03) / 0.35;
      k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
      let fk = (ti - 0.04) / 0.6;
      fk = fk <= 0 ? 0 : fk >= 1 ? 1 : fk * fk * (3 - 2 * fk);
      if (pooling && !this.wasPooling) { this.axisX = S[STAN.offX]; this.axisZ = S[STAN.offZ]; this.axisR = Math.max(R * S[STAN.wide], 60); }
      this.wasPooling = pooling;
      U.mass.value.set(pooling ? this.axisR : 700, pooling ? fk : 1, pooling ? this.axisX : 0, pooling ? this.axisZ : 0);
      U.mass2.value.y = pooling ? k : 1;
      U.mass2.value.z = pooling ? Math.min(1, S[STAN.slosh] / 220) : 0;
      let st = (ti - 1.5) / 1.5;
      st = st <= 0 ? 0 : st >= 1 ? 1 : st * st * (3 - 2 * st);
      U.mass2.value.w = pooling ? st : 1;
    }
    // ŚWIATŁO na komorze: jedno źródło w środku bryły — kula (z dolnym progiem mocy: plama żaru na dnie i maszyneria
    // są ciepłe także przy najchłodniejszej kuli obiegu), rozżarzona kupa przy topieniu albo metal w leju po zrzucie.
    // Strumień = moc × promień²; bierze się większy z dwóch (kupa → kula bez skoku), promień źródła ten sam.
    const heapR = cur[STAN.heapN] > 0 ? S[STAN.heapR] : 0;
    const heapHeat = S[STAN.heapHeat];
    // (po zetknięciu źródłem jest masa w leju: promień rośnie z kuli do ok. połowy promienia lustra)
    const pool = pooling ? Math.min(1, Math.max(0, S[STAN.impactT]) / 0.8) : 0;
    const rBall = ballOn ? R : massOn ? R + (Math.max(40, 0.55 * S[STAN.lakeR]) - R) * pool : 0;
    const fade = pooling ? Math.min(1, funnelUnits / (2 * UNITS_PER_TON)) : 1;
    const eBall = (3.4 + 5.2 * heatPowerJs(T)) * rBall * rBall * fade;
    const rHeap = 0.7 * heapR * heapHeat;
    const eHeap = 3.0 * rHeap * rHeap;
    const lightR = Math.max(1, rBall, rHeap);
    U.light.value.w = Math.max(eBall, eHeap) / (lightR * lightR);
    // światło robocze komory: pełne w fazach bez żaru (pusta, zbieranie, docisk), gaśnie płynnie, gdy rośnie żar bryły
    {
      const flux = Math.max(eBall, eHeap) / 56000;
      const k = Math.max(0, Math.min(1, (flux - 0.15) / 2.6));
      U.work.value.x = 1 - k * k * (3 - 2 * k);
    }
    U.heap.value.set(heapR, heapHeat, lightR, pooling ? 0 : Math.max(ballOn ? R : 0, 0.72 * heapR));
    this.mass.updateMatrixWorld();
    U.off.value.set(S[STAN.offX], S[STAN.offY], S[STAN.offZ]);
    this.ball.position.set(S[STAN.offX], S[STAN.offY], S[STAN.offZ]);
    this.ball.updateMatrixWorld();
    U.port.value.set(0, 0, S[STAN.pipeGlow], S[STAN.chill]);
    // nitka żużla: z wierzchołka stożka czapy pionowo w górę, potem prosto w dzwon (koniec łuku 9 j. w głębi dzwonu)
    {
      const kx = S[STAN.headX];
      const ky = SS.boomY - SS.kneeDrop;
      const mx = S[STAN.mouthX];
      const my = S[STAN.mouthY];
      const dl = Math.hypot(kx - mx, ky - my) || 1;
      const lo = S[STAN.thrLo];
      const hi = S[STAN.thrHi];
      const ay = S[STAN.apexY];
      const live = hi > lo + 0.004 && cur[STAN.apexY] > 0 && ballOn;
      U.thr0.value.set(S[STAN.offX], ay - 7, S[STAN.offZ], live ? lo : 0);
      U.thr1.value.set(mx + (kx - mx) / dl * 13, my + (ky - my) / dl * 13, 0, live ? hi : 0);
      U.thr2.value.set(S[STAN.offX] + 2, ay + 0.5 * Math.max(my - ay, 8) + 7, S[STAN.offZ] * 0.6, Math.min(1, Math.sqrt(Math.max(0, S[STAN.suckFlow]) / PROCES.suckRate)));
      this.thread.visible = live;
      // żar strugi na dzwonie i końcu szyi ssawy (czytelne ściąganie z kamery z góry)
      U.work.value.y = live && hi > 0.92 ? Math.min(1, 0.35 + 0.65 * Math.sqrt(Math.max(0, S[STAN.suckFlow]) / PROCES.suckRate)) : 0;
    }
    U.grain.value.w = Math.min(1, S[STAN.boundaryFlux] / 900);
    // jasność kuli maleje, gdy kula zajmuje dużą część kadru (duża jasna powierzchnia zalewa kadr poświatą)
    const Rv = pooling ? R + (Math.max(R, S[STAN.frontR]) - R) * pool : R;
    const cover = Math.PI * Rv * Rv * a.ppuBall * a.ppuBall / Math.max(1, a.viewW * a.viewH);
    this.cover = cover;
    // (jezioro w leju jest płaską taflą na pół kadru: przyciemnienie mocniejsze niż dla kuli)
    U.t4.value.x = this.coverK ?? (1 - (0.3 + 0.04 * pool) * Math.max(0, Math.min(1, (cover - 0.06) / (0.4 - 0.12 * pool))));
    // mody: amplitudy wymieszane
    const md = V.mody;
    const mv = U.modes.array;
    for (let i = 0; i < MODES; i++) {
      const v = lerp(md[MODES + i], md[i], al);
      const q = mv[i >> 2];
      const k = i & 3;
      if (k === 0) q.x = v; else if (k === 1) q.y = v; else if (k === 2) q.z = v; else q.w = v;
    }
    // zmarszczki: kierunek × siła, wiek
    const rp = V.zmarszczki;
    const ra = U.ripples.array;
    for (let i = 0; i < POOL.ripples; i++) {
      const o = i * EVENT_STRIDE;
      const age = time - rp[o + 3];
      const amp = age >= 0 && age < 1.6 ? rp[o + 4] : 0;
      ra[i].set(rp[o] * amp, rp[o + 1] * amp, rp[o + 2] * amp, Math.max(0, age));
    }
    // wyspy żużla: kierunek, promień rysowany jako cięciwa | żar kożucha, numer, wiek, masa. Kierunek z bieżącego
    // kroku cofnięty o obrót kuli do chwili klatki (wyspy płyną z powierzchnią — bez szarpania względem wzoru konwekcji)
    const kr = V.kry;
    const fa = U.floes.array;
    const back = cur[STAN.rot] - S[STAN.rot];
    const cb = Math.cos(back);
    const sb = Math.sin(back);
    for (let i = 0; i < POOL.floes; i++) {
      const o = i * FLOE_STRIDE;
      if (i < V.nKry) {
        fa[i * 2].set(kr[o] * cb - kr[o + 2] * sb, kr[o + 1], kr[o] * sb + kr[o + 2] * cb, 2 * Math.sin(kr[o + 3] * 0.5));
        fa[i * 2 + 1].set(kr[o + 5], kr[o + 4], kr[o + 7], kr[o + 6]);
      } else if (fa[i * 2].w !== 0) fa[i * 2].set(0, 1, 0, 0);
    }
    // maszyny ze stanu
    buildChamberDynamic(this.dyn, S);
    const g = this.dynamic.geometry;
    g.setDrawRange(0, this.dyn.n);
    g.attributes.position.needsUpdate = true;
    g.attributes.aN.needsUpdate = true;
    g.attributes.aC.needsUpdate = true;
    g.attributes.aK.needsUpdate = true;
    this.belt.setTravel(S[STAN.beltTravel]);
    this.lightR = lightR;
  }
}

export { heatPowerJs };
