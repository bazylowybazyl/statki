// HUTA — fizyczna ruda: OBRAZ ZIAREN (three + TSL; tylko rysuje stan symulacji, niczego nie dolicza).
//
// Każde ziarno w kadrze jest rekordem symulacji:
//   • ziarna W RUCHU (ciała ładowni i zasieku, rura w oknach, taśma) — rekord 12 × f32 z migawki wprost w buforze
//     instancji; pozycja = mieszanka „początek kroku → koniec kroku” w shaderze (obraz 240 Hz przy kroku 60 Hz);
//   • ziarna W SPOCZYNKU — kolumny kraty: trzy wierzchnie ziarna kolumny (cechy, przesunięcie i obrót, z jakimi ciało
//     stanęło), cień własny stosu i otwarcie szczelin policzone przez kratę przy zmianie kolumny;
//   • PODKŁAD — pole wysokości pod wierzchnią warstwą (ciemne wnętrze stosu widziane przez szczeliny) przechodzące
//     w dno zasieku / blachy ładowni tam, gdzie kolumna jest pusta. Podkład też jest stanem kraty (wysokość kolumny),
//     nie bryłą skalowaną zapasem.
//
// Bryłka: wypukły wielościan o płaskich ścianach (otoczka 11 punktów, 18 ścian; z daleka 6 punktów, 8 ścian), cztery
// kroje w jednej geometrii (zwarty, płyta, słupek, klin — cztery atrybuty pozycji, wybór bitami cech), skala z cech
// (0,74…1,2, ok. 6 % ziaren to bryły × 1,5) i z tabeli rudy.
// Normalna ściany z pochodnych pozycji widoku — cieniowanie płaskie po obrocie i skali bez atrybutów normalnych.
// Partie: `Mesh` + `InstancedBufferGeometry`, dane instancji w `InstancedInterleavedBuffer` (pułapki 24 i 42 reguły
// webgpu-tsl), wysyłka zakresami (`src/3d/zakresyWysylki.js`). Układ: „hub” budowli portowych — (x, wysokość po
// `k7HeightToZ`, z); środek ziarna ściskany wysokością, bryłka nie.
// STREFA ŁADOWNI: ładownia sięga od 50 j. pod pokładem (dno) do 50 j. nad nim (zrębnica), a `k7HeightToZ` ściska
// wysokości nad pokładem × 0,42 — lej pod dzwonem byłby spłaszczony. Ziarna ładowni, ciała ssane, pył pod dzwonem,
// zrębnica i dzwon rysują się więc w skali 1:1 względem pokładu (wysokość = y − 116; `scena.js`: `holdZone`).
// Ładownia jest OTWOREM W POKŁADZIE: statek to płaski obraz w płaszczyźnie gry, więc wnętrze pod pokładem dostaje
// wykładzinę ścian (`linerMaterial`), „gumkę głębi” w obrysie luku (kamery z ukosa: głębia obrazu statku nie zasłania
// wnętrza) i znaczek głębi pokładu wokół luku (kamera z góry: ściany zrębnicy pod pokładem nie wychodzą na kadłub).
// CIENIE: ziarno w locie i ziarno toczące się rzuca plamkę cienia na stos pod sobą (`shadowMaterial`: prześwit pod
// ciałem niesie rekord ruchomego ziarna), dzwon — krążek cienia na ładunku; dno pod ziarnami i przy podstawie kopca
// jest ściemnione (cień kontaktowy w podkładzie).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Discard, Fn, If, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cross, dFdx, dFdy, dot, float, floor, fract,
  length, max, min, mix, mod, modelViewMatrix, normalize, pow, sign, sin, smoothstep, step, uniform, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { scalZakresy, zbierzZakres, zbierzZakresy, zbierzZakresyCaly } from '../../../../src/3d/zakresyWysylki.js';
import { PORT_SPACE_LIGHT } from '../../../../src/3d/portBuildings/portBuildings3D.js';
import { GRAIN, GRAIN_DRAW_R, TRAIT_BIG, TRAIT_SCALES } from './rudy.js';
import { SNAP } from './ruda.worker.js';

const MOVING_STRIDE = 12;
const COL_STRIDE = 32;            // instancja kolumny: x, z, y wierzchu, n | otwarcie, cień, nachylenie, wklęsłość | 3 × (przesunięcie, cechy + 256 · głębokość | kwaternion)
const UNDER_DROP = 3.6;           // podkład leży tyle pod środkiem wierzchniego ziarna
const OFF_XZ = 3 / 127;
const OFF_Y = 2.55 / 127;

// ---------------------------------------------------------------------------
// Kształty bryłek

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

/** Ściany otoczki wypukłej (trójkąty, kolejność przeciwna do wskazówek patrząc z zewnątrz) albo null, gdy punkty są zdegenerowane. */
function hullFaces(p) {
  const n = p.length;
  const faces = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const ax = p[j][0] - p[i][0];
        const ay = p[j][1] - p[i][1];
        const az = p[j][2] - p[i][2];
        const bx = p[k][0] - p[i][0];
        const by = p[k][1] - p[i][1];
        const bz = p[k][2] - p[i][2];
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 1e-4) return null;
        let pos = 0;
        let neg = 0;
        for (let m = 0; m < n; m++) {
          if (m === i || m === j || m === k) continue;
          const d = ((p[m][0] - p[i][0]) * nx + (p[m][1] - p[i][1]) * ny + (p[m][2] - p[i][2]) * nz) / nl;
          if (d > 0.012) pos++; else if (d < -0.012) neg++; else return null;       // czwórka prawie w płaszczyźnie: losuj dalej
        }
        if (pos && neg) continue;
        faces.push(pos ? [i, k, j] : [i, j, k]);
      }
    }
  }
  return faces;
}

/** Bryłka: `count` punktów na zniekształconej kuli (osie `anis`), wszystkie na otoczce → 2 · count − 4 ściany. */
function chunkShape(seed, count, anis) {
  const rnd = rng(seed);
  const spread = count > 9 ? 0.72 : 0.62;       // najmniejszy kąt między punktami: więcej punktów = gęściej
  for (let attempt = 0; attempt < 4000; attempt++) {
    const pts = [];
    let guard = 0;
    while (pts.length < count && guard++ < 400) {
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
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
    // środek w początku, największy promień = 1
    const c = [0, 0, 0];
    for (const q of p) { c[0] += q[0] / count; c[1] += q[1] / count; c[2] += q[2] / count; }
    let rmax = 0;
    for (const q of p) { q[0] -= c[0]; q[1] -= c[1]; q[2] -= c[2]; rmax = Math.max(rmax, Math.hypot(q[0], q[1], q[2])); }
    const out = new Float32Array(faces.length * 9);
    let w = 0;
    for (const f of faces) for (const v of f) { out[w++] = p[v][0] / rmax; out[w++] = p[v][1] / rmax; out[w++] = p[v][2] / rmax; }
    return out;
  }
  throw new Error('ruda: nie udało się wylosować bryłki');
}

// cztery kroje: bryła zwarta, płyta (spłaszczona), słupek (wydłużony), klin — żeby stos nie był workiem jednakowych kostek
const ANIS = [[1.0, 0.8, 0.92], [1.16, 0.5, 0.86], [0.8, 1.0, 0.68], [1.22, 0.64, 0.5]];

/** Geometria bazowa: cztery warianty bryłki w jednym buforze z przeplotem (pozycja = wariant 0, aP1…aP3). */
function chunkGeometry(count, seed) {
  const shapes = ANIS.map((a, i) => chunkShape(seed + i * 977, count, a));
  const verts = shapes[0].length / 3;
  const data = new Float32Array(verts * 12);
  for (let v = 0; v < verts; v++) for (let s = 0; s < 4; s++) for (let k = 0; k < 3; k++) data[v * 12 + s * 3 + k] = shapes[s][v * 3 + k];
  const buf = new THREE.InterleavedBuffer(data, 12);
  return {
    verts,
    position: new THREE.InterleavedBufferAttribute(buf, 3, 0),
    p1: new THREE.InterleavedBufferAttribute(buf, 3, 3),
    p2: new THREE.InterleavedBufferAttribute(buf, 3, 6),
    p3: new THREE.InterleavedBufferAttribute(buf, 3, 9)
  };
}

function instancedGeometry(base) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', base.position);
  g.setAttribute('aP1', base.p1);
  g.setAttribute('aP2', base.p2);
  g.setAttribute('aP3', base.p3);
  g.instanceCount = 0;
  return g;
}

// ---------------------------------------------------------------------------
// Węzły wspólne (funkcje wklejane, bez layoutu)

const k7 = (y) => { const d = y.sub(116.0); return max(d, 0.0).mul(0.42).add(min(d, 0.0)); };
/** Wysokość rysunku: strefa ładowni (`zone` = 1) 1:1 nad pokładem, reszta przez `k7HeightToZ`. */
const heightOf = (y, zone) => mix(k7(y), y.sub(116.0), zone);
const qrot = (q, v) => { const t = cross(q.xyz, v).mul(2.0); return v.add(t.mul(q.w)).add(cross(q.xyz, t)); };

/** Bity cech ziarna z liczby 0…255: odcień 0…7, kształt 0…3, skala 0…3, żyłka 0 / 1. */
function decodeTrait(tr) {
  const t = float(0.0).toVar();
  t.assign(floor(tr.add(0.5)));
  const hue = float(0.0).toVar();
  hue.assign(mod(t, 8.0));
  const shape = float(0.0).toVar();
  shape.assign(mod(floor(t.div(8.0)), 4.0));
  const scale = float(0.0).toVar();
  scale.assign(mod(floor(t.div(32.0)), 4.0));
  const vein = float(0.0).toVar();
  vein.assign(step(127.5, t));
  return { hue, shape, scale, vein };
}

/** Pole rodzaju rekordu ruchomego ziarna: rodzaj (0 lot, 1 styk, 2 ssanie, 3 rura, 4 taśma) + 8 × strefa ładowni + 16 × prześwit. */
function decodeKind(v) {
  const t = float(0.0).toVar();
  t.assign(floor(v.add(0.5)));
  const gap = float(0.0).toVar();
  gap.assign(floor(t.div(16.0)));
  const rest = float(0.0).toVar();
  rest.assign(t.sub(gap.mul(16.0)));
  const zone = float(0.0).toVar();
  zone.assign(step(7.5, rest));
  const kind = float(0.0).toVar();
  kind.assign(rest.sub(zone.mul(8.0)));
  return { gap, zone, kind };
}

const SCALE0 = TRAIT_SCALES[0];
const SCALE_STEP = (TRAIT_SCALES[3] - TRAIT_SCALES[0]) / 3;
const BIG_K = TRAIT_BIG / TRAIT_SCALES[3] - 1;
/** Promień bryłki z cech: skala 0…3 (0,74…1,2) × promień rudy; kształt 3 ze skalą 3 to BRYŁA × 1,5 (ok. 6 % ziaren). */
function sizeOf(U, tr) {
  const big = step(2.5, tr.scale).mul(step(2.5, tr.shape));
  return U.grain.x.mul(tr.scale.mul(SCALE_STEP).add(SCALE0)).mul(big.mul(BIG_K).add(1.0));
}

/** Wierzchołek bryłki wariantu `shape` (wagi 0 / 1 z odległości od numeru wariantu). */
function shapeVertex(shape) {
  const p0 = attribute('position', 'vec3');
  const p1 = attribute('aP1', 'vec3');
  const p2 = attribute('aP2', 'vec3');
  const p3 = attribute('aP3', 'vec3');
  const w = (k) => float(1.0).sub(min(abs(shape.sub(k)), 1.0));
  return p0.mul(w(0.0)).add(p1.mul(w(1.0))).add(p2.mul(w(2.0))).add(p3.mul(w(3.0)));
}

/** Barwa ziarna: trzy odcienie rudy po 8 poziomach, żyłka — własna barwa. */
function grainColor(U, tr) {
  const t = tr.hue.div(7.0);
  const base = mix(mix(U.shade0, U.shade1, clamp(t.mul(2.0), 0.0, 1.0)), U.shade2, clamp(t.mul(2.0).sub(1.0), 0.0, 1.0));
  // rozrzut jasności z bitów kształtu i skali (ziarno niesie go od ładowni do kopca)
  const jit = fract(tr.shape.mul(0.37).add(tr.scale.mul(0.61)).add(tr.hue.mul(0.23))).mul(0.34).add(0.8);
  return mix(base.mul(jit), U.vein, tr.vein.mul(0.36)).mul(U.grain.z);
}

/**
 * Światło ziarna (fragment): ściana płaska z pochodnych pozycji widoku, słońce z cieniem stosu, otoczenie z półkuli
 * przyciemnione w szczelinach, połysk żyłek. `par` = (słońce 0…1,3: cień × nachylenie stosu, otwarcie 0…1, żyłka, 0).
 */
function grainLight(U, vP, col, par) {
  const dx = vec3(0.0).toVar();
  dx.assign(dFdx(vP));
  const dy = vec3(0.0).toVar();
  dy.assign(dFdy(vP));
  const V = vec3(0.0).toVar();
  V.assign(normalize(vP.negate()));
  const N0 = vec3(0.0).toVar();
  const cr = vec3(0.0).toVar();
  cr.assign(cross(dx, dy));
  N0.assign(cr.div(max(length(cr), 1e-9)));
  const N = vec3(0.0).toVar();
  N.assign(N0.mul(sign(dot(N0, V).add(1e-5))));
  const L = vec3(0.0).toVar();
  L.assign(normalize(cameraViewMatrix.mul(vec4(U.sunDir, 0.0)).xyz));
  const up = vec3(0.0).toVar();
  up.assign(normalize(cameraViewMatrix.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz));
  const ndl = float(0.0).toVar();
  ndl.assign(max(dot(N, L), 0.0));
  const hemi = float(0.0).toVar();
  hemi.assign(dot(N, up).mul(0.5).add(0.5));
  const lit = par.x;
  const ao = par.y;
  const veinK = par.z;
  // słońce: ściana płaska (lambert) × cień stosu × nachylenie stosu w skali kilku ziaren (w `par.x` dla ziaren stosu)
  const sun = U.sunColor.mul(ndl.mul(0.94).add(0.03)).mul(lit).mul(U.light.x);
  const sky = U.ambient.mul(mix(float(0.22), float(1.0), hemi)).mul(ao).mul(U.light.y).mul(clamp(lit.mul(0.5).add(0.5), 0.0, 1.0));
  // odbicie od sąsiednich ziaren: w cieniu i w szczelinach ruda świeci własną barwą, nie szarością
  const bounce = col.mul(U.sunColor).mul(float(1.0).sub(hemi).mul(0.3).add(0.06)).mul(ao).mul(U.light.z).mul(clamp(lit.mul(0.7).add(0.3), 0.0, 1.0));
  const H = vec3(0.0).toVar();
  H.assign(L.add(V).div(max(length(L.add(V)), 1e-6)));
  const ndh = float(0.0).toVar();
  ndh.assign(max(dot(N, H), 0.0));
  // połysk: z daleka (ziarno kilka pikseli) wygaszany — inaczej ciemna ruda z góry to czarna plama z białym szumem
  const spec = pow(ndh, 28.0).mul(lit).mul(float(0.022).add(veinK.mul(U.sheen))).mul(U.frame.w);
  const outc = vec3(0.0).toVar();
  outc.assign(col.mul(sun.add(sky)).add(col.mul(bounce)).add(U.sunColor.mul(spec)));
  // pod progiem bloomu: jasność ograniczona z zachowaniem barwy
  const lum = dot(outc, vec3(0.2126, 0.7152, 0.0722));
  outc.mulAssign(min(float(1.0), float(0.84).div(max(lum, 1e-3))));
  return max(outc, vec3(0.0));
}

function nodeMaterial(name, vertex, fragment) {
  const m = new NodeMaterial();
  m.name = name;
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = THREE.FrontSide;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  return m;
}

/** Ziarna w ruchu: iCur / iPrev (pozycje stanowiska), iQ (kwaternion), iM (cechy, rodzaj). */
function movingMaterial(U) {
  const vP = varyingProperty('vec3', 'vRuP');
  const vC = varyingProperty('vec3', 'vRuC');
  const vL = varyingProperty('vec4', 'vRuL');
  const vertex = Fn(() => {
    const iCur = attribute('iCur', 'vec3');
    const iPrev = attribute('iPrev', 'vec3');
    const iQ = attribute('iQ', 'vec4');
    const iM = attribute('iM', 'vec2');
    const c = vec3(0.0).toVar();
    c.assign(mix(iPrev, iCur, U.frame.x));
    // rodzaj + 8 = ciało ładowni (strefa ładowni: wysokość 1:1 względem pokładu), + 16 × prześwit pod ciałem
    const K = decodeKind(iM.y);
    const zone = K.zone;
    const kind = K.kind;
    const tr = decodeTrait(iM.x);
    const lp = vec3(0.0).toVar();
    lp.assign(shapeVertex(tr.shape));
    const q = vec4(0.0).toVar();
    q.assign(iQ.div(max(length(iQ), 1e-4)));
    const r = vec3(0.0).toVar();
    r.assign(qrot(q, lp));
    // ziarno w rurze (rodzaj 3) lekko wydłużone wzdłuż ruchu (najwyżej × 1,3) — w oknie rury widać strugę, ale ziarno
    // zostaje ziarnem (mocne rozciąganie dawało płaskie „płatki”, inne niż ziarna ładowni i kopca)
    const d = vec3(0.0).toVar();
    d.assign(iCur.sub(iPrev));
    const dl = float(0.0).toVar();
    dl.assign(length(d));
    const dir = vec3(0.0).toVar();
    dir.assign(d.div(max(dl, 1e-3)));
    const inPipe = float(0.0).toVar();
    inPipe.assign(step(2.5, kind).mul(float(1.0).sub(step(3.5, kind))));
    const flying = float(0.0).toVar();
    flying.assign(float(1.0).sub(step(0.5, kind)));
    r.addAssign(dir.mul(dot(r, dir)).mul(inPipe.mul(clamp(dl.mul(0.013), 0.0, 0.3))));
    const sc = float(0.0).toVar();
    sc.assign(sizeOf(U, tr));
    const ch = vec3(0.0).toVar();
    ch.assign(vec3(c.x, heightOf(c.y, zone), c.z));
    const mvC = vec4(0.0).toVar();
    mvC.assign(modelViewMatrix.mul(vec4(ch, 1.0)));
    const ppu = float(0.0).toVar();
    ppu.assign(U.frame.y.div(max(mvC.z.negate(), 1.0)));
    const boost = float(0.0).toVar();
    boost.assign(max(float(1.0), U.frame.z.div(max(sc.mul(1.7).mul(ppu), 1e-4))));
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(ch.add(r.mul(sc).mul(boost)), 1.0)));
    vP.assign(mv.xyz);
    vC.assign(grainColor(U, tr));
    // w locie ziarno łapie pełne słońce i nieco pyłu wokół — odcina się od stosu
    vL.assign(vec4(flying.mul(U.grain.y).add(1.0), mix(float(1.0), float(0.8), step(3.5, kind)), tr.vein, 0.0));
    return cameraProjectionMatrix.mul(mv);
  })();
  const fragment = Fn(() => vec4(grainLight(U, vP, vC, vL), 1.0))();
  return nodeMaterial('RudaZiarnoRuch', vertex, fragment);
}

/** Ziarna stosu: iCol (x, z, y wierzchu, n), iSh (otwarcie szczelin, cień, nachylenie ku słońcu, wklęsłość), iSlot (przesunięcie, cechy + 256 · głębokość), iQ. */
function pileMaterial(U) {
  const vP = varyingProperty('vec3', 'vRsP');
  const vC = varyingProperty('vec3', 'vRsC');
  const vL = varyingProperty('vec4', 'vRsL');
  const vertex = Fn(() => {
    const iCol = attribute('iCol', 'vec4');
    const iSh = attribute('iSh', 'vec4');
    const iSlot = attribute('iSlot', 'vec4');
    const iQ = attribute('iQ', 'vec4');
    const depth = float(0.0).toVar();
    depth.assign(floor(iSlot.w.add(0.5).div(256.0)));
    const tr = decodeTrait(iSlot.w.sub(depth.mul(256.0)));
    // liczba ziaren kolumny + 1024 = krata ładowni (strefa ładowni: wysokość 1:1 nad pokładem)
    const zone = float(0.0).toVar();
    zone.assign(step(512.0, iCol.w));
    const present = float(0.0).toVar();
    present.assign(step(depth.add(0.5), iCol.w.sub(zone.mul(1024.0))));
    const lp = vec3(0.0).toVar();
    lp.assign(shapeVertex(tr.shape));
    const q = vec4(0.0).toVar();
    q.assign(iQ.div(max(length(iQ), 1e-4)));
    const r = vec3(0.0).toVar();
    r.assign(qrot(q, lp));
    const sc = float(0.0).toVar();
    sc.assign(sizeOf(U, tr));
    const ch = vec3(0.0).toVar();
    ch.assign(vec3(iCol.x.add(iSlot.x), heightOf(iCol.z.add(iSlot.y), zone), iCol.y.add(iSlot.z)));
    const mvC = vec4(0.0).toVar();
    mvC.assign(modelViewMatrix.mul(vec4(ch, 1.0)));
    const ppu = float(0.0).toVar();
    ppu.assign(U.frame.y.div(max(mvC.z.negate(), 1.0)));
    const boost = float(0.0).toVar();
    boost.assign(max(float(1.0), U.frame.z.div(max(sc.mul(1.7).mul(ppu), 1e-4))));
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(ch.add(r.mul(sc).mul(boost)), 1.0)));
    vP.assign(mv.xyz);
    vC.assign(grainColor(U, tr));
    // głębsze ziarno kolumny: mniej słońca i mniej nieba (widać je tylko przez szczeliny)
    const deep = float(0.0).toVar();
    deep.assign(float(1.0).div(depth.mul(1.1).add(1.0)));
    vL.assign(vec4(iSh.y.mul(deep).mul(clamp(iSh.z.sub(1.0).mul(U.grain.w).add(1.0), 0.1, 1.45)).mul(mix(float(1.0), iSh.w, 0.6)), iSh.x.mul(mix(float(0.55), float(1.0), deep)).mul(iSh.w), tr.vein, 0.0));
    const clip = vec4(0.0).toVar();
    clip.assign(cameraProjectionMatrix.mul(mv));
    If(present.lessThan(0.5), () => { clip.assign(vec4(2.0, 2.0, 2.0, 1.0)); });
    return clip;
  })();
  const fragment = Fn(() => vec4(grainLight(U, vP, vC, vL), 1.0))();
  return nodeMaterial('RudaZiarnoStos', vertex, fragment);
}

/**
 * Podkład: pole wysokości kraty (wierzchołek = kolumna). Pod ziarnami — ciemne wnętrze stosu, w pustych kolumnach —
 * dno (płyty z fugami, rdzawy nalot rudy). `F`: barwy dna, podziałka płyt, wycięcia (koryto taśmy pod kratą).
 */
function underlayMaterial(U, F, name) {
  const vP = varyingProperty('vec3', 'vRpP');
  const vD = varyingProperty('vec4', 'vRpD');       // słońce, otwarcie, ruda 0…1, wysokość
  const vX = varyingProperty('vec2', 'vRpX');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    const a = attribute('aU', 'vec4');
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(p.x, heightOf(a.x, F.zone), p.z, 1.0)));
    vP.assign(mv.xyz);
    vD.assign(vec4(a.y, a.z, a.w, a.x));
    vX.assign(p.xz);
    return cameraProjectionMatrix.mul(mv);
  })();
  const fragment = Fn(() => {
    const dx = vec3(0.0).toVar();
    dx.assign(dFdx(vP));
    const dy = vec3(0.0).toVar();
    dy.assign(dFdy(vP));
    const fw = float(0.0).toVar();
    fw.assign(max(length(dFdx(vX)), length(dFdy(vX))));
    const ore = float(0.0).toVar();
    ore.assign(smoothstep(0.4, 0.95, vD.z));
    // wycięcia dna (koryto taśmy, szyb pochylni) — tylko tam, gdzie nie leży ruda
    const inCut = (r) => step(r.x, vX.x).mul(step(vX.x, r.z)).mul(step(r.y, vX.y)).mul(step(vX.y, r.w));
    const cut = float(0.0).toVar();
    cut.assign(max(inCut(F.cut0), inCut(F.cut1)));
    If(cut.mul(float(1.0).sub(step(0.5, vD.z))).greaterThan(0.5), () => { Discard(); });
    const V = vec3(0.0).toVar();
    V.assign(normalize(vP.negate()));
    const N0 = vec3(0.0).toVar();
    const cr = vec3(0.0).toVar();
    cr.assign(cross(dx, dy));
    N0.assign(cr.div(max(length(cr), 1e-9)));
    const N = vec3(0.0).toVar();
    N.assign(N0.mul(sign(dot(N0, V).add(1e-5))));
    const L = vec3(0.0).toVar();
    L.assign(normalize(cameraViewMatrix.mul(vec4(U.sunDir, 0.0)).xyz));
    const up = vec3(0.0).toVar();
    up.assign(normalize(cameraViewMatrix.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz));
    const ndl = float(0.0).toVar();
    ndl.assign(max(dot(N, L), 0.0));
    // dno liczy słońce głównie jak płaszczyzna pozioma: płytki lej dna (8°) nie rysuje się jaśniejszym krążkiem wokół kopca
    const ndlFloor = float(0.0).toVar();
    ndlFloor.assign(mix(ndl, max(dot(up, L), 0.0), 0.8));
    // cień kontaktowy: dno pod pojedynczym ziarnem i przy podstawie stosu (wierzchołki sąsiadujące z rudą) ciemnieje
    const contact = float(0.0).toVar();
    contact.assign(float(1.0).sub(smoothstep(0.04, 0.5, vD.z).mul(0.58)));
    // dno: płyty co `pitch` z fugą, drobna różnica jasności płyt, nalot rudy w zagłębieniach leja
    const g = vec2(0.0).toVar();
    g.assign(vX.div(F.pitch.x));
    const cell = vec2(0.0).toVar();
    cell.assign(floor(g));
    const f = vec2(0.0).toVar();
    f.assign(fract(g));
    const edge = float(0.0).toVar();
    edge.assign(min(min(f.x, float(1.0).sub(f.x)), min(f.y, float(1.0).sub(f.y))).mul(F.pitch.x));
    const seam = float(0.0).toVar();
    seam.assign(float(1.0).sub(smoothstep(F.pitch.y, F.pitch.y.add(fw.mul(1.5)).add(0.6), edge)));
    const hsh = float(0.0).toVar();
    hsh.assign(fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453)));
    const blotch = float(0.0).toVar();
    blotch.assign(sin(vX.x.mul(0.013).add(sin(vX.y.mul(0.011)).mul(2.3))).mul(sin(vX.y.mul(0.017).add(1.7))).mul(0.5).add(0.5));
    const floorCol = vec3(0.0).toVar();
    floorCol.assign(mix(F.colA, F.colB, hsh.mul(0.6).add(blotch.mul(0.4))));
    floorCol.assign(mix(floorCol, U.dust.mul(0.5), F.pitch.z.mul(blotch.mul(0.7).add(0.3))));
    // nalot rudy wokół miejsca, gdzie pada struga (pył osiada na posadzce): gęsty przy kopcu, rzednie z odległością
    const stainD = float(0.0).toVar();
    stainD.assign(length(vX.sub(F.stain.xy)));
    const stain = float(0.0).toVar();
    stain.assign(float(1.0).sub(smoothstep(F.stain.z, F.stain.w, stainD)).mul(blotch.mul(0.55).add(0.45)).mul(step(1.0, F.stain.w)));
    floorCol.assign(mix(floorCol, U.dust.mul(0.42), stain.mul(0.5)));
    floorCol.mulAssign(float(1.0).sub(seam.mul(0.34)));
    // wnętrze stosu: najciemniejszy odcień rudy, prawie bez słońca
    const oreCol = vec3(0.0).toVar();
    oreCol.assign(mix(U.shade0, U.shade1, 0.3));
    const lightFloor = U.sunColor.mul(ndlFloor).mul(vD.x).mul(contact).mul(U.light.x).add(U.ambient.mul(vD.y.mul(0.6).add(0.4)).mul(U.light.y).mul(1.7).mul(mix(float(1.0), contact, 0.7)));
    const lightOre = U.sunColor.mul(ndl.mul(0.55).add(0.05)).mul(vD.x).mul(U.light.x).add(U.ambient.mul(vD.y).mul(0.6).mul(U.light.y)).add(oreCol.mul(0.1));
    const outc = vec3(0.0).toVar();
    outc.assign(mix(floorCol.mul(lightFloor), oreCol.mul(lightOre).mul(F.pitch.w), ore));
    return vec4(max(outc, vec3(0.0)), 1.0);
  })();
  const m = nodeMaterial(name, vertex, fragment);
  m.side = THREE.DoubleSide;
  return m;
}

/**
 * Cień ziarna w ruchu: miękka plamka na stosie pod ciałem (ten sam bufor instancji co ziarna w ruchu). Punkt cienia
 * leży pod ziarnem na wysokości powierzchni (prześwit z rekordu), przesunięty od słońca; im wyżej ziarno, tym plamka
 * większa i słabsza. Ziarna rury i taśmy cienia nie rzucają (jadą w rurze / po taśmie).
 */
function shadowMaterial(U) {
  const vUv = varyingProperty('vec2', 'vRcU');
  const vA = varyingProperty('float', 'vRcA');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    const iCur = attribute('iCur', 'vec3');
    const iPrev = attribute('iPrev', 'vec3');
    const iM = attribute('iM', 'vec2');
    const c = vec3(0.0).toVar();
    c.assign(mix(iPrev, iCur, U.frame.x));
    const K = decodeKind(iM.y);
    const tr = decodeTrait(iM.x);
    const sc = float(0.0).toVar();
    sc.assign(sizeOf(U, tr));
    const on = float(0.0).toVar();
    on.assign(float(1.0).sub(step(2.5, K.kind)));
    const h = float(0.0).toVar();
    h.assign(K.gap);
    const reach = float(0.0).toVar();
    reach.assign(min(h, 80.0));
    const r = float(0.0).toVar();
    r.assign(sc.mul(1.25).add(h.mul(0.045)));
    const g = vec3(0.0).toVar();
    g.assign(vec3(c.x.add(U.shadow.x.mul(reach)).add(p.x.mul(r)), heightOf(c.y.sub(3.0).sub(h).add(U.shadow.z), K.zone), c.z.add(U.shadow.y.mul(reach)).add(p.z.mul(r))));
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(g, 1.0)));
    vUv.assign(p.xz);
    // wysoko nad stosem (struga tuż za wylotem) cienia nie ma: plamka pojawia się, gdy ziarno schodzi ku powierzchni
    vA.assign(on.mul(U.shadow.w).div(h.mul(0.022).add(1.0)).mul(float(1.0).sub(smoothstep(110.0, 200.0, h))));
    const clip = vec4(0.0).toVar();
    clip.assign(cameraProjectionMatrix.mul(mv));
    If(on.lessThan(0.5), () => { clip.assign(vec4(2.0, 2.0, 2.0, 1.0)); });
    return clip;
  })();
  const fragment = Fn(() => {
    const d = float(0.0).toVar();
    d.assign(length(vUv));
    return vec4(0.0, 0.0, 0.0, clamp(float(1.0).sub(smoothstep(0.25, 1.0, d)).mul(vA), 0.0, 1.0));
  })();
  const m = nodeMaterial('RudaCienZiarna', vertex, fragment);
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  return m;
}

/** Krążek cienia dzwonu na ładunku: `U.bell` = (x, wysokość powierzchni pod dzwonem, z, promień), `U.bellA.x` — krycie. */
function bellShadowMaterial(U) {
  const vUv = varyingProperty('vec2', 'vRdU');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(U.bell.x.add(p.x.mul(U.bell.w)), U.bell.y.sub(116.0), U.bell.z.add(p.z.mul(U.bell.w)), 1.0)));
    vUv.assign(p.xz);
    return cameraProjectionMatrix.mul(mv);
  })();
  const fragment = Fn(() => {
    const d = float(0.0).toVar();
    d.assign(length(vUv));
    // pełny cień pod obręczą, miękki brzeg; środek (wlot) nieco jaśniejszy — przez klatkę dzwonu wpada światło
    const ring = float(0.0).toVar();
    ring.assign(float(1.0).sub(smoothstep(0.62, 1.0, d)).mul(mix(float(0.7), float(1.0), smoothstep(0.1, 0.55, d))));
    return vec4(0.0, 0.0, 0.0, clamp(ring.mul(U.bellA.x), 0.0, 1.0));
  })();
  const m = nodeMaterial('RudaCienDzwonu', vertex, fragment);
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  return m;
}

/**
 * Wykładzina ścian ładowni (od dna do korony zrębnicy, od środka): blachy z fugami i wręgami, słońce z cieniem
 * przeciwległej burty (promień ku słońcu musi wyjść górą luku), otoczenie słabnące ku dnu, odbita barwa rudy
 * i nalot pyłu przy dnie. Pozycje w układzie stanowiska; `aN` — normalna ku wnętrzu, `aUv` — (wzdłuż ściany, nad dnem).
 */
function linerMaterial(U, H) {
  const vW = varyingProperty('vec3', 'vRlW');
  const vN = varyingProperty('vec3', 'vRlN');
  const vU = varyingProperty('vec2', 'vRlU');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(p.x, p.y.sub(116.0), p.z, 1.0)));
    vW.assign(p);
    vN.assign(attribute('aN', 'vec3'));
    vU.assign(attribute('aUv', 'vec2'));
    return cameraProjectionMatrix.mul(mv);
  })();
  const fragment = Fn(() => {
    const fw = float(0.0).toVar();
    fw.assign(max(length(dFdx(vU)), length(dFdy(vU))));
    const ndl = float(0.0).toVar();
    ndl.assign(max(dot(normalize(vN), U.sunSt), 0.0));
    // cień burt: punkt, w którym promień ku słońcu przecina płaszczyznę korony zrębnicy, musi leżeć w obrysie luku
    const tt = float(0.0).toVar();
    tt.assign(H.y.y.sub(vW.y).div(max(U.sunSt.y, 0.08)));
    const q = vec2(0.0).toVar();
    q.assign(vW.xz.add(U.sunSt.xz.mul(tt)));
    const din = float(0.0).toVar();
    din.assign(min(min(q.x.sub(H.box.x), H.box.z.sub(q.x)), min(q.y.sub(H.box.y), H.box.w.sub(q.y))));
    const vis = float(0.0).toVar();
    vis.assign(smoothstep(-5.0, 9.0, din));
    const hN = float(0.0).toVar();
    hN.assign(clamp(vU.y.div(H.y.y.sub(H.y.x)), 0.0, 1.0));
    // blachy 39 × 25 j. z fugą, wręga co drugą blachę
    const g = vec2(0.0).toVar();
    g.assign(vU.div(vec2(39.0, 25.0)));
    const cell = vec2(0.0).toVar();
    cell.assign(floor(g));
    const fr = vec2(0.0).toVar();
    fr.assign(fract(g));
    const edge = float(0.0).toVar();
    edge.assign(min(min(fr.x, float(1.0).sub(fr.x)).mul(39.0), min(fr.y, float(1.0).sub(fr.y)).mul(25.0)));
    const seam = float(0.0).toVar();
    seam.assign(float(1.0).sub(smoothstep(0.7, fw.mul(1.5).add(1.3), edge)));
    const rib = float(0.0).toVar();
    rib.assign(float(1.0).sub(smoothstep(2.2, fw.mul(1.5).add(3.0), abs(fract(g.x.mul(0.5)).sub(0.5)).mul(78.0))));
    const hsh = float(0.0).toVar();
    hsh.assign(fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453)));
    const base = vec3(0.0).toVar();
    base.assign(mix(H.colA, H.colB, hsh.mul(0.7).add(rib.mul(0.3))));
    base.mulAssign(float(1.0).sub(seam.mul(0.3)));
    // nalot pyłu rudy: gęsty przy dnie, zacieki wyżej
    const streak = float(0.0).toVar();
    streak.assign(sin(vU.x.mul(0.083).add(sin(vU.x.mul(0.031)).mul(2.1))).mul(0.32).add(sin(vU.x.mul(0.27).add(1.3)).mul(0.14)).add(0.5));
    const stain = float(0.0).toVar();
    stain.assign(float(1.0).sub(smoothstep(0.0, streak.mul(0.45).add(0.4), hN)));
    base.assign(mix(base, U.dust.mul(0.55), stain.mul(0.6)));
    const ao = float(0.0).toVar();
    ao.assign(mix(float(0.42), float(1.0), smoothstep(0.0, 0.7, hN)));
    const lightv = vec3(0.0).toVar();
    lightv.assign(U.sunColor.mul(ndl.mul(0.9).add(0.02)).mul(vis).mul(U.light.x).add(U.ambient.mul(ao).mul(U.light.y).mul(1.9)));
    // odbicie od ładunku: ściana przy dnie łapie barwę rudy
    const bounce = vec3(0.0).toVar();
    bounce.assign(mix(U.shade1, U.shade2, 0.4).mul(U.sunColor).mul(float(1.0).sub(hN).mul(0.085).add(0.012)).mul(U.light.z));
    return vec4(max(base.mul(lightv).add(base.mul(bounce)), vec3(0.0)), 1.0);
  })();
  const m = nodeMaterial('RudaWykladzinaLadowni', vertex, fragment);
  m.side = THREE.DoubleSide;
  return m;
}

/**
 * Sama głębia (bez koloru). `erase` = „gumka”: w obrysie luku wpisuje głębię dalekiej płaszczyzny bez testu — kamera
 * z ukosa ma wspólną głębię passów, a płaski obraz statku (z = 0) zasłoniłby wnętrze ładowni pod pokładem. Bez `erase`:
 * znaczek pokładu wokół luku — to, co leży pod pokładem poza lukiem (ściany zrębnicy od zewnątrz), odpada w teście głębi.
 */
function depthOnlyMaterial(name, erase) {
  const vertex = Fn(() => cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(attribute('position', 'vec3'), 1.0))))();
  const fragment = Fn(() => vec4(0.0, 0.0, 0.0, 0.0))();
  const m = nodeMaterial(name, vertex, fragment);
  m.colorWrite = false;
  m.depthWrite = true;
  m.side = THREE.DoubleSide;
  if (erase) {
    m.depthNode = float(1.0);
    m.depthFunc = THREE.AlwaysDepth;
  }
  return m;
}

/** Taśma: guma z progami jadącymi z taśmą (`U.belt.x` — droga taśmy), żółte krawędzie; aS = (droga, bok −1…1). */
function beltMaterial(U) {
  const vP = varyingProperty('vec3', 'vRbP');
  const vS = varyingProperty('vec2', 'vRbS');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(p, 1.0)));
    vP.assign(mv.xyz);
    vS.assign(attribute('aS', 'vec2'));
    return cameraProjectionMatrix.mul(mv);
  })();
  const fragment = Fn(() => {
    const dx = vec3(0.0).toVar();
    dx.assign(dFdx(vP));
    const dy = vec3(0.0).toVar();
    dy.assign(dFdy(vP));
    const fw = float(0.0).toVar();
    fw.assign(max(abs(dFdx(vS.x)), abs(dFdy(vS.x))));
    const V = vec3(0.0).toVar();
    V.assign(normalize(vP.negate()));
    const N0 = vec3(0.0).toVar();
    const cr = vec3(0.0).toVar();
    cr.assign(cross(dx, dy));
    N0.assign(cr.div(max(length(cr), 1e-9)));
    const N = vec3(0.0).toVar();
    N.assign(N0.mul(sign(dot(N0, V).add(1e-5))));
    const L = vec3(0.0).toVar();
    L.assign(normalize(cameraViewMatrix.mul(vec4(U.sunDir, 0.0)).xyz));
    const ndl = float(0.0).toVar();
    ndl.assign(max(dot(N, L), 0.0));
    // próg co 36 j. (zabierak ziaren na pochylni), szerokość 5 j.
    const ph = float(0.0).toVar();
    ph.assign(fract(vS.x.sub(U.belt.x).div(36.0)).mul(36.0));
    const cleat = float(0.0).toVar();
    cleat.assign(float(1.0).sub(smoothstep(2.5, fw.mul(1.5).add(3.2), abs(ph.sub(18.0)))));
    const rim = float(0.0).toVar();
    rim.assign(step(0.86, abs(vS.y)));
    const col = vec3(0.0).toVar();
    col.assign(mix(vec3(0.035, 0.037, 0.042), vec3(0.11, 0.115, 0.125), cleat));
    col.assign(mix(col, vec3(0.5, 0.33, 0.05), rim));
    const lightv = U.sunColor.mul(ndl).mul(U.light.x).mul(0.8).add(U.ambient.mul(U.light.y));
    return vec4(max(col.mul(lightv), vec3(0.0)), 1.0);
  })();
  const m = nodeMaterial('RudaTasma', vertex, fragment);
  m.side = THREE.DoubleSide;
  return m;
}

// ---------------------------------------------------------------------------
// Krata w obrazie: bufor instancji kolumn + podkład

class GridView {
  constructor({ nx, nz, x0, z0, floorY, group, mats, bases, name, underMat, zone = 0 }) {
    this.sun = [-0.6, 0.75, 0.25];
    this.zoneAdd = zone ? 1024 : 0;       // znacznik strefy ładowni w liczbie ziaren kolumny (shader: wysokość 1:1)
    this.nx = nx;
    this.nz = nz;
    this.N = nx * nz;
    this.name = name;
    const N = this.N;
    const a = GRAIN.cell;
    this.inst = new Float32Array(N * COL_STRIDE);
    this.floor = new Float32Array(N);
    this.cnt = new Uint8Array(N);          // liczba ziaren kolumny (bez znacznika strefy)
    for (let c = 0; c < N; c++) {
      const i = c % nx;
      const j = (c - i) / nx;
      const o = c * COL_STRIDE;
      this.inst[o] = x0 + (i + 0.5) * a;
      this.inst[o + 1] = z0 + (j + 0.5) * a;
      this.inst[o + 2] = typeof floorY === 'function' ? floorY(this.inst[o], this.inst[o + 1]) : floorY;
      this.floor[c] = this.inst[o + 2];
      this.inst[o + 3] = this.zoneAdd;
      this.inst[o + 5] = 1;
      this.inst[o + 6] = 1;
      this.inst[o + 7] = 1;
    }
    this.buf = new THREE.InstancedInterleavedBuffer(this.inst, COL_STRIDE);
    this.slots = [];
    this.meshes = [];
    // trzy głębokości × dwie szczegółowości bryłki (z bliska 14 ścian, z daleka 8)
    for (const lod of ['near', 'far']) {
      for (let s = 0; s < 3; s++) {
        if (lod === 'far' && s === 2) continue;
        const g = instancedGeometry(bases[lod]);
        g.setAttribute('iCol', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
        g.setAttribute('iSh', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
        g.setAttribute('iSlot', new THREE.InterleavedBufferAttribute(this.buf, 4, 8 + s * 8));
        g.setAttribute('iQ', new THREE.InterleavedBufferAttribute(this.buf, 4, 12 + s * 8));
        g.instanceCount = N;
        const mesh = new THREE.Mesh(g, mats.pile);
        mesh.name = `Ruda_${name}_stos_${lod}_${s}`;
        mesh.frustumCulled = false;
        mesh.visible = false;
        group.add(mesh);
        this.slots.push({ mesh, lod, s });
        this.meshes.push(mesh);
      }
    }
    // podkład: siatka wierzchołków w środkach kolumn rozciągnięta do pełnego obrysu kraty
    const pos = new Float32Array(N * 3);
    const W = nx * a;
    const D = nz * a;
    for (let c = 0; c < N; c++) {
      const i = c % nx;
      const j = (c - i) / nx;
      pos[c * 3] = x0 + (i / (nx - 1)) * W;
      pos[c * 3 + 2] = z0 + (j / (nz - 1)) * D;
    }
    this.under = new Float32Array(N * 4);
    for (let c = 0; c < N; c++) { this.under[c * 4] = this.inst[c * COL_STRIDE + 2]; this.under[c * 4 + 1] = 1; this.under[c * 4 + 2] = 1; }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let w = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const c = j * nx + i;
        // przekątna na przemian: bez kierunkowych pręg na stokach
        if ((i + j) & 1) { idx[w++] = c; idx[w++] = c + nx; idx[w++] = c + 1; idx[w++] = c + 1; idx[w++] = c + nx; idx[w++] = c + nx + 1; } else { idx[w++] = c; idx[w++] = c + nx; idx[w++] = c + nx + 1; idx[w++] = c; idx[w++] = c + nx + 1; idx[w++] = c + 1; }
      }
    }
    const ug = new THREE.BufferGeometry();
    ug.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.underAttr = new THREE.BufferAttribute(this.under, 4);
    ug.setAttribute('aU', this.underAttr);
    ug.setIndex(new THREE.BufferAttribute(idx, 1));
    this.underMesh = new THREE.Mesh(ug, underMat);
    this.underMesh.name = `Ruda_${name}_podklad`;
    this.underMesh.frustumCulled = false;
    group.add(this.underMesh);
    this.meshes.push(this.underMesh);
    this.grains = 0;
    this.dirtyAll = true;
  }

  /** Rekord kolumny `c` z `rec[ro … ro + 8)` (słowa u32; `recF` — te same bajty jako f32). */
  _column(c, rec, recF, ro) {
    const inst = this.inst;
    const o = c * COL_STRIDE;
    const w0 = rec[ro];
    const n = w0 & 255;
    const y = recF[ro + 7];
    inst[o + 2] = y;
    inst[o + 3] = n + this.zoneAdd;
    this.cnt[c] = n;
    inst[o + 4] = ((w0 >>> 8) & 255) / 255;
    inst[o + 5] = ((w0 >>> 16) & 255) / 255;
    for (let s = 0; s < 3; s++) {
      const a = rec[ro + 1 + s * 2];
      const q = rec[ro + 2 + s * 2];
      const b = o + 8 + s * 8;
      inst[b] = ((a << 16) >> 24) * OFF_XZ;
      inst[b + 1] = ((a << 8) >> 24) * OFF_Y - s * GRAIN.layer;
      inst[b + 2] = (a >> 24) * OFF_XZ;
      inst[b + 3] = (a & 255) + 256 * s;
      inst[b + 4] = ((q << 24) >> 24) / 127;
      inst[b + 5] = ((q << 16) >> 24) / 127;
      inst[b + 6] = ((q << 8) >> 24) / 127;
      inst[b + 7] = (q >> 24) / 127;
    }
    const u = c * 4;
    const under = this.under;
    under[u + 1] = inst[o + 5];
    // otwarcie szczelin × wklęsłość w skali ~50 j. (dno przy podstawie kopca i w kraterze ma mniej nieba)
    under[u + 2] = inst[o + 4] * (inst[o + 7] < 1 ? inst[o + 7] : 1);
    // pojedyncze ziarno na dnie nie ma pod sobą „wnętrza stosu” — podkład zostaje dnem z lekkim nalotem
    under[u + 3] = n > 1 ? 1 : n === 1 ? 0.5 : 0;
  }

  /**
   * Wysokość podkładu w kolumnie `c`: najniższy wierzch w sąsiedztwie 3 × 3 minus zagłębienie — podkład nigdy nie
   * wystaje między ziarnami (pojedyncza wyższa kolumna to ziarna na widoku, nie ciemny „namiot” z trójkątów).
   */
  _under(c) {
    const nx = this.nx;
    const nz = this.nz;
    const inst = this.inst;
    const i = c % nx;
    const j = (c - i) / nx;
    const cnt = this.cnt;
    if (cnt[c] === 0) { this.under[c * 4] = this.floor[c]; return; }
    let m = Infinity;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= nz) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        if (ii < 0 || ii >= nx) continue;
        const o = (jj * nx + ii) * COL_STRIDE;
        const h = cnt[jj * nx + ii] > 0 ? inst[o + 2] : inst[o + 2] + UNDER_DROP;
        if (h < m) m = h;
      }
    }
    const f = this.floor[c];
    this.under[c * 4] = m - UNDER_DROP > f ? m - UNDER_DROP : f;
  }

  /**
   * Nachylenie stosu w kolumnie `c` względem słońca: normalna pola wysokości z różnic ±2 kolumny (trzy rzędy) · kierunek
   * ku słońcu, podzielone przez wartość dla płaskiego (1 = płasko, > 1 stok ku słońcu, → 0 stok odwrócony). Pojedyncze
   * ziarna mają ściany we wszystkie strony — bez tego stok zawietrzny świeciłby jak nawietrzny.
   */
  _slope(c) {
    const nx = this.nx;
    const nz = this.nz;
    const inst = this.inst;
    const i = c % nx;
    const j = (c - i) / nx;
    const i0 = i > 1 ? i - 2 : 0;
    const i1 = i < nx - 2 ? i + 2 : nx - 1;
    const j0 = j > 1 ? j - 2 : 0;
    const j1 = j < nz - 2 ? j + 2 : nz - 1;
    let gx = 0;
    let gz = 0;
    for (let d = -1; d <= 1; d++) {
      const jj = j + d < 0 ? 0 : j + d >= nz ? nz - 1 : j + d;
      const ii = i + d < 0 ? 0 : i + d >= nx ? nx - 1 : i + d;
      gx += inst[(jj * nx + i1) * COL_STRIDE + 2] - inst[(jj * nx + i0) * COL_STRIDE + 2];
      gz += inst[(j1 * nx + ii) * COL_STRIDE + 2] - inst[(j0 * nx + ii) * COL_STRIDE + 2];
    }
    gx /= 3 * (i1 - i0) * GRAIN.cell;
    gz /= 3 * (j1 - j0) * GRAIN.cell;
    const S = this.sun;
    const k = (-gx * S[0] + S[1] - gz * S[2]) / (Math.sqrt(gx * gx + 1 + gz * gz) * S[1]);
    inst[c * COL_STRIDE + 6] = k > 0 ? k : 0;
    // wklęsłość w skali ~50 j. (krater, podnóże kopca, lej w ładowni): średnia z ośmiu punktów pierścienia − wysokość
    // kolumny; dodatnia = zagłębienie (mniej nieba), ujemna = grzbiet. Zapis: 1 = płasko, < 1 zagłębienie, > 1 wypukłość.
    const R = 8;
    const D = 6;
    const ia = i > R ? i - R : 0;
    const ib = i < nx - R ? i + R : nx - 1;
    const ja = j > R ? j - R : 0;
    const jb = j < nz - R ? j + R : nz - 1;
    const ic = i > D ? i - D : 0;
    const id = i < nx - D ? i + D : nx - 1;
    const jc = j > D ? j - D : 0;
    const jd = j < nz - D ? j + D : nz - 1;
    const h = inst[c * COL_STRIDE + 2];
    const ring = (inst[(j * nx + ia) * COL_STRIDE + 2] + inst[(j * nx + ib) * COL_STRIDE + 2] + inst[(ja * nx + i) * COL_STRIDE + 2] + inst[(jb * nx + i) * COL_STRIDE + 2]
      + inst[(jc * nx + ic) * COL_STRIDE + 2] + inst[(jc * nx + id) * COL_STRIDE + 2] + inst[(jd * nx + ic) * COL_STRIDE + 2] + inst[(jd * nx + id) * COL_STRIDE + 2]) * 0.125;
    let cav = 1 - (ring - h) * 0.016;
    if (cav < 0.5) cav = 0.5; else if (cav > 1.18) cav = 1.18;
    inst[c * COL_STRIDE + 7] = cav;
  }

  /** `recF` — te same bajty co `rec` jako f32 (widok z migawki, bez tworzenia tablicy przy każdym wpisie). */
  apply(all, count, cols, rec, recF) {
    if (all) {
      const N = this.N;
      for (let c = 0; c < N; c++) this._column(c, rec, recF, c * 8);
      for (let c = 0; c < N; c++) { this._slope(c); this._under(c); this.under[c * 4 + 2] = this.inst[c * COL_STRIDE + 4] * Math.min(1, this.inst[c * COL_STRIDE + 7]); }
      zbierzZakresyCaly(this.buf);
      zbierzZakresyCaly(this.underAttr);
      return N;
    }
    for (let q = 0; q < count; q++) {
      const c = cols[q];
      this._column(c, rec, recF, q * 8);
      zbierzZakresy(this.buf, c * COL_STRIDE, COL_STRIDE);
      zbierzZakresy(this.underAttr, c * 4, 4);
    }
    for (let q = 0; q < count; q++) {
      const c = cols[q];
      this._slope(c);
      this._under(c);
      this.under[c * 4 + 2] = this.inst[c * COL_STRIDE + 4] * Math.min(1, this.inst[c * COL_STRIDE + 7]);
    }
    return count;
  }

  /** Scal zakresy przed rysunkiem (raz na klatkę po zapisach). */
  flush() {
    scalZakresy(this.buf, COL_STRIDE * 24);
    scalZakresy(this.underAttr, 4 * 48);
  }

  setLod(far, deep) {
    for (const sl of this.slots) sl.mesh.visible = (sl.lod === 'far') === far && sl.s < deep;
  }
}

// ---------------------------------------------------------------------------

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class RudaObraz {
  /**
   * @param {object} o  root — grupa w układzie „hub” (macierz jak budowle portowe), geo — geometria stanowiska,
   *                    tune — TUNE stanowiska (pojemności pul), sunDir — THREE.Vector3 kierunku słońca w scenie
   *                    (żywy obiekt budowli), layout — układ migawki (`snapLayout`)
   */
  constructor({ root, geo, tune, sunDir, layout }) {
    this.geo = geo;
    this.root = root;
    this.U = {
      sunDir: uniform(sunDir),
      sunColor: uniform(v3(PORT_SPACE_LIGHT.sunColor)),
      ambient: uniform(new THREE.Vector3(0.11, 0.118, 0.14)),
      light: uniform(new THREE.Vector4(1.0, 1.0, 1.0, 0.0)),            // mnożniki: słońce, niebo, odbicie
      shade0: uniform(new THREE.Vector3(0.3, 0.1, 0.05)),
      shade1: uniform(new THREE.Vector3(0.5, 0.18, 0.1)),
      shade2: uniform(new THREE.Vector3(0.66, 0.3, 0.17)),
      vein: uniform(new THREE.Vector3(0.6, 0.6, 0.6)),
      dust: uniform(new THREE.Vector3(0.5, 0.3, 0.2)),
      sheen: uniform(0.5),
      grain: uniform(new THREE.Vector4(3.5, 0.1, 0.86, 0.9)),           // promień bryłki, rozjaśnienie w locie, jasność barwy, siła nachylenia stosu
      frame: uniform(new THREE.Vector4(1, 1000, 1.5, 1)),               // alfa kroku, px na j. × odległość, min px, siła połysku
      belt: uniform(new THREE.Vector4(0, 0, 0, 0)),
      sunSt: uniform(new THREE.Vector3(-0.6, 0.75, 0.25)),              // kierunek ku słońcu w układzie stanowiska (x, y w górę, z)
      shadow: uniform(new THREE.Vector4(0.8, -0.3, 3.2, 0.34)),         // cień ziarna: przesunięcie x, z na jednostkę prześwitu, uniesienie nad stos, krycie
      bell: uniform(new THREE.Vector4(0, 0, 0, 34)),                    // cień dzwonu: x, wysokość powierzchni, z, promień
      bellA: uniform(new THREE.Vector4(0, 0, 0, 0))                     // krycie cienia dzwonu
    };
    const U = this.U;
    this.bases = { near: chunkGeometry(11, 20261114), far: chunkGeometry(6, 20261115) };
    this.mats = { moving: movingMaterial(U), pile: pileMaterial(U), belt: beltMaterial(U), shadow: shadowMaterial(U), bellShadow: bellShadowMaterial(U) };
    const B = geo.bunker;
    const Bt = geo.belt;
    const trough = Bt.sections.find((s) => s.name === 'koryto');
    const pitTop = Bt.sections.find((s) => s.name === 'pochylnia');
    const bx = Bt.pts[1][0];
    const bz = Bt.pts[1][2];
    const zPit = bz - (pitTop.s0 - Bt.len0) * Math.cos(Bt.incline);
    this.F = {
      bunker: {
        colA: uniform(new THREE.Vector3(0.04, 0.043, 0.05)), colB: uniform(new THREE.Vector3(0.062, 0.065, 0.072)),
        pitch: uniform(new THREE.Vector4(142, 1.1, 0.12, 0.5)),
        cut0: uniform(new THREE.Vector4(Bt.pts[0][0] - trough.s1, bz - 30, Bt.pts[0][0] - trough.s0, bz + 30)),
        cut1: uniform(new THREE.Vector4(bx - 30, zPit - 6, bx + 30, bz + 30)),
        // nalot rudy na posadzce: środek (cel strugi), promień pełnego nalotu, promień zaniku
        stain: uniform(new THREE.Vector4(geo.spout.target.x, geo.spout.target.z, 260, 760)),
        zone: uniform(0)
      },
      hold: {
        colA: uniform(new THREE.Vector3(0.075, 0.083, 0.098)), colB: uniform(new THREE.Vector3(0.105, 0.114, 0.13)),
        pitch: uniform(new THREE.Vector4(63, 0.9, 0.16, 0.5)),
        cut0: uniform(new THREE.Vector4(1, 1, -1, -1)), cut1: uniform(new THREE.Vector4(1, 1, -1, -1)),
        stain: uniform(new THREE.Vector4(0, 0, 0, 0)),
        zone: uniform(1)
      }
    };
    this.underMats = { bunker: underlayMaterial(U, this.F.bunker, 'RudaPodkladZasiek'), hold: underlayMaterial(U, this.F.hold, 'RudaPodkladLadownia') };

    this.bgGroup = new THREE.Group();
    this.bgGroup.name = 'Ruda zasiek';
    this.holdGroup = new THREE.Group();
    this.holdGroup.name = 'Ruda ładownia';
    this.fgGroup = new THREE.Group();
    this.fgGroup.name = 'Ruda FG';
    root.add(this.bgGroup, this.holdGroup, this.fgGroup);

    this.bunker = new GridView({ nx: B.nx, nz: B.nz, x0: B.x0, z0: B.z0, floorY: B.floor, group: this.bgGroup, mats: this.mats, bases: this.bases, name: 'zasiek', underMat: this.underMats.bunker });
    const Hd = geo.hold;
    this.hold = new GridView({ nx: Hd.nx, nz: Hd.nz, x0: Hd.x0, z0: Hd.z0, floorY: Hd.floorY, group: this.holdGroup, mats: this.mats, bases: this.bases, name: 'ladownia', underMat: this.underMats.hold, zone: 1 });

    // ziarna w ruchu: FG = ciała ładowni + rura w oknach, BG = ciała zasieku + taśma
    const total = layout.movingLen / MOVING_STRIDE;
    const capFg = tune.bodiesHold + tune.pipeCap;
    const capBg = total - capFg;
    this.moving = {};
    for (const [key, cap, group] of [['fg', capFg, this.fgGroup], ['bg', capBg, this.bgGroup]]) {
      const data = new Float32Array(cap * MOVING_STRIDE);
      const buf = new THREE.InstancedInterleavedBuffer(data, MOVING_STRIDE);
      const meshes = {};
      for (const lod of ['near', 'far']) {
        const g = instancedGeometry(this.bases[lod]);
        g.setAttribute('iCur', new THREE.InterleavedBufferAttribute(buf, 3, 0));
        g.setAttribute('iPrev', new THREE.InterleavedBufferAttribute(buf, 3, 3));
        g.setAttribute('iQ', new THREE.InterleavedBufferAttribute(buf, 4, 6));
        g.setAttribute('iM', new THREE.InterleavedBufferAttribute(buf, 2, 10));
        const mesh = new THREE.Mesh(g, this.mats.moving);
        mesh.name = `Ruda_ruch_${key}_${lod}`;
        mesh.frustumCulled = false;
        mesh.visible = false;
        group.add(mesh);
        meshes[lod] = mesh;
      }
      // cień ziaren w ruchu: kwadrat w płaszczyźnie poziomej na tym samym buforze instancji
      const sg = new THREE.InstancedBufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]), 3));
      sg.setAttribute('iCur', new THREE.InterleavedBufferAttribute(buf, 3, 0));
      sg.setAttribute('iPrev', new THREE.InterleavedBufferAttribute(buf, 3, 3));
      sg.setAttribute('iM', new THREE.InterleavedBufferAttribute(buf, 2, 10));
      sg.instanceCount = 0;
      const shadow = new THREE.Mesh(sg, this.mats.shadow);
      shadow.name = `Ruda_cien_${key}`;
      shadow.frustumCulled = false;
      shadow.visible = false;
      shadow.renderOrder = 20;
      group.add(shadow);
      this.moving[key] = { data, buf, meshes, shadow, count: 0, cap };
    }

    // ładownia: wykładzina ścian, gumka głębi w obrysie luku, znaczek głębi pokładu wokół luku (jadą ze statkiem)
    this._holdPit();
    // cień dzwonu na ładunku (stoi w układzie stanowiska — dzwon pracuje tylko przy zacumowanym statku)
    {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]), 3));
      this.bellShadow = new THREE.Mesh(g, this.mats.bellShadow);
      this.bellShadow.name = 'Ruda_cien_dzwonu';
      this.bellShadow.frustumCulled = false;
      this.bellShadow.renderOrder = 19;
      this.fgGroup.add(this.bellShadow);
    }

    // taśma: zbiorcza pod dnem (widać ją w korycie pod kratą) i pochyła do galerii (załamanie skali wysokości na y = 116)
    this.beltMesh = this._beltMesh();
    this.bgGroup.add(this.beltMesh);

    this.lodFar = false;
    this.deep = 3;
    this.counts = { fg: 0, bg: 0, hold: 0, bunker: 0, uploads: 0 };
    this.setLayers(1, 2);
    this.setLod(false);
  }

  /** Ładownia jako otwór w pokładzie: wykładzina ścian (od środka), gumka głębi w luku, znaczek głębi pokładu. */
  _holdPit() {
    const Hd = this.geo.hold;
    const U = this.U;
    const deck = this.geo.ship.deck;
    this.H = {
      box: uniform(new THREE.Vector4(Hd.x0, Hd.z0, Hd.x1, Hd.z1)),
      y: uniform(new THREE.Vector4(Hd.floorY, Hd.coamingY, deck, 0)),
      colA: uniform(new THREE.Vector3(0.085, 0.095, 0.112)), colB: uniform(new THREE.Vector3(0.125, 0.136, 0.155))
    };
    this.mats.liner = linerMaterial(U, this.H);
    this.mats.erase = depthOnlyMaterial('RudaLukGlebia', true);
    this.mats.deck = depthOnlyMaterial('RudaPokladGlebia', false);
    // wykładzina: cztery ściany 0,5 j. przed blachą zrębnicy
    const e = 0.5;
    const P = [];
    const Nn = [];
    const Uv = [];
    const I = [];
    const wall = (ax, az, bx, bz, nx, nz) => {
      const base = P.length / 3;
      const len = Math.hypot(bx - ax, bz - az);
      for (const [x, z, u] of [[ax, az, 0], [bx, bz, len]]) for (const [y, v] of [[Hd.floorY - 1, 0], [Hd.coamingY, Hd.coamingY - Hd.floorY]]) { P.push(x, y, z); Nn.push(nx, 0, nz); Uv.push(u, v); }
      I.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    };
    wall(Hd.x0 + e, Hd.z0, Hd.x0 + e, Hd.z1, 1, 0);
    wall(Hd.x1 - e, Hd.z1, Hd.x1 - e, Hd.z0, -1, 0);
    wall(Hd.x1, Hd.z0 + e, Hd.x0, Hd.z0 + e, 0, 1);
    wall(Hd.x0, Hd.z1 - e, Hd.x1, Hd.z1 - e, 0, -1);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    lg.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(Nn), 3));
    lg.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(Uv), 2));
    lg.setIndex(I);
    this.liner = new THREE.Mesh(lg, this.mats.liner);
    this.liner.name = 'Ruda_ladownia_wykladzina';
    // prostokąty w płaszczyźnie pokładu (układ „hub”: wysokość 0 = pokład)
    const rects = (list, y) => {
      const p = [];
      const idx = [];
      for (const [x0, z0, x1, z1] of list) {
        const b = p.length / 3;
        p.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
      g.setIndex(idx);
      return g;
    };
    this.eraser = new THREE.Mesh(rects([[Hd.x0, Hd.z0, Hd.x1, Hd.z1]], 0), this.mats.erase);
    this.eraser.name = 'Ruda_luk_glebia';
    this.eraser.renderOrder = -60;
    // pokład wokół luku: od zewnętrznego lica zrębnicy (12 j. blachy) po obrys kadłuba
    const w = 12.4;
    const X = this.geo.ship.width / 2 - 20;
    const Z0 = Hd.z0 - 330;
    const Z1 = Hd.z1 + 330;
    this.deckStamp = new THREE.Mesh(rects([
      [-X, Z0, X, Hd.z0 - w], [-X, Hd.z1 + w, X, Z1], [-X, Hd.z0 - w, Hd.x0 - w, Hd.z1 + w], [Hd.x1 + w, Hd.z0 - w, X, Hd.z1 + w]
    ], -0.6), this.mats.deck);
    this.deckStamp.name = 'Ruda_poklad_glebia';
    this.deckStamp.renderOrder = -59;
    for (const m of [this.liner, this.eraser, this.deckStamp]) { m.frustumCulled = false; this.holdGroup.add(m); }
  }

  _beltMesh() {
    const Bt = this.geo.belt;
    const hw = Bt.width / 2;
    const kz = (y) => (y > 116 ? (y - 116) * 0.42 : y - 116);
    const P = [];
    const S = [];
    const I = [];
    const row = (x, y, z, ax, az, s) => {
      P.push(x - ax * hw, kz(y), z - az * hw, x + ax * hw, kz(y), z + az * hw);
      S.push(s, -1, s, 1);
    };
    // zbiorcza: wzdłuż −x, szerokość po z; odrobinę pod ziarnami (ziarno leży 3 j. nad taśmą)
    row(Bt.pts[0][0] + 40, Bt.pts[0][1], Bt.pts[0][2], 0, 1, -40);
    row(Bt.pts[1][0] - 26, Bt.pts[1][1], Bt.pts[1][2], 0, 1, Bt.len0 + 26);
    // pochyła: wzdłuż −z w górę, szerokość po x; punkt załamania na y = 116
    const a = Bt.pts[1];
    const b = Bt.pts[2];
    const t116 = (116 - a[1]) / (b[1] - a[1]);
    const at = (t) => [a[0], a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const t0 = -30 / Bt.len1;
    for (const t of [t0, t116, 1 + 20 / Bt.len1]) { const q = at(t); row(q[0], q[1], q[2], 1, 0, Bt.len0 + Bt.len1 * t); }
    for (const base of [0, 4, 6]) I.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(S), 2));
    g.setIndex(I);
    const m = new THREE.Mesh(g, this.mats.belt);
    m.name = 'Ruda_tasma';
    m.frustumCulled = false;
    return m;
  }

  /** Kierunek ku słońcu w układzie stanowiska (x, y w górę, z) — do nachylenia stosu; przed pierwszą migawką. */
  setSun(x, y, z) {
    this.bunker.sun = [x, y, z];
    this.hold.sun = [x, y, z];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    this.U.sunSt.value.set(x / l, y / l, z / l);
    // cień ziarna pada OD słońca: przesunięcie poziome na jednostkę wysokości = ctg kąta słońca
    const k = l / Math.max(0.2 * l, y);
    this.U.shadow.value.x = -x / l * k;
    this.U.shadow.value.y = -z / l * k;
  }

  /** Barwy i wielkość ziarna rudy z tabeli. */
  setOre(ore) {
    const U = this.U;
    U.shade0.value.set(...ore.shades[0]);
    U.shade1.value.set(...ore.shades[1]);
    U.shade2.value.set(...ore.shades[2]);
    U.vein.value.set(...ore.vein);
    U.dust.value.set(...ore.dustColor);
    U.sheen.value = ore.sheen;
    U.grain.value.x = 3.55 * ore.grainScale;
  }

  setLayers(bg, fg) {
    for (const m of this.bunker.meshes) m.layers.set(bg);
    for (const m of this.hold.meshes) m.layers.set(fg);
    for (const m of Object.values(this.moving.bg.meshes)) m.layers.set(bg);
    for (const m of Object.values(this.moving.fg.meshes)) m.layers.set(fg);
    this.moving.bg.shadow.layers.set(bg);
    this.moving.fg.shadow.layers.set(fg);
    this.beltMesh.layers.set(bg);
    for (const m of [this.liner, this.eraser, this.deckStamp, this.bellShadow]) m.layers.set(fg);
  }

  /** Szczegółowość: `far` — bryłka 8 ścian i dwie głębokości kolumny (ziarno ma na ekranie kilka pikseli). */
  setLod(far) {
    this.lodFar = !!far;
    this.bunker.setLod(this.lodFar, this.lodFar ? 2 : 3);
    this.hold.setLod(this.lodFar, this.lodFar ? 2 : 3);
    for (const key of ['fg', 'bg']) {
      const M = this.moving[key];
      M.meshes.near.visible = !this.lodFar && M.count > 0;
      M.meshes.far.visible = this.lodFar && M.count > 0;
    }
  }

  /** Siatki do rozgrzewki (wszystkie warianty szczegółowości; `WARIANT_INSTANCJI` daje licznik ≥ 2). */
  warmupMeshes() {
    const out = [...this.bunker.meshes, ...this.hold.meshes, this.beltMesh, this.liner, this.eraser, this.deckStamp, this.bellShadow];
    for (const key of ['fg', 'bg']) out.push(this.moving[key].meshes.near, this.moving[key].meshes.far, this.moving[key].shadow);
    return out;
  }

  _count(M, n, S) {
    M.count = n;
    M.meshes.near.geometry.instanceCount = n;
    M.meshes.far.geometry.instanceCount = n;
    M.shadow.geometry.instanceCount = n;
    M.meshes.near.visible = !this.lodFar && n > 0;
    M.meshes.far.visible = this.lodFar && n > 0;
    M.shadow.visible = n > 0;
    if (n) zbierzZakres(M.buf, 0, n * S);
  }

  /** Migawka symulacji (`snapViews`) → bufory instancji. */
  applySnapshot(snap) {
    const x = snap.extra;
    const nHold = x[SNAP.nHold];
    const nBunker = x[SNAP.nBunker];
    const nPipe = x[SNAP.nPipe];
    const nBelt = x[SNAP.nBelt];
    const mv = snap.moving;
    const S = MOVING_STRIDE;
    const fg = this.moving.fg;
    const bg = this.moving.bg;
    let fgN = Math.min(fg.cap, nHold);
    let bgN = Math.min(bg.cap, nBunker + nBelt);
    if (nHold) {
      fg.data.set(mv.subarray(0, nHold * S), 0);
      // ciała ładowni: rodzaj + 8 = strefa ładowni (wysokość 1:1 nad pokładem); ziarna rury w oknach zostają bez znacznika
      const d = fg.data;
      const end = Math.min(nHold, fg.cap) * S;
      for (let o = 11; o < end; o += S) d[o] += 8;
    }
    if (nBunker) bg.data.set(mv.subarray(nHold * S, (nHold + nBunker) * S), 0);
    if (nBelt) bg.data.set(mv.subarray((nHold + nBunker + nPipe) * S, (nHold + nBunker + nPipe + nBelt) * S), nBunker * S);
    // ziarna rury w oknach: okno na wysięgniku suwnicy (y > 400, zestaw FG nad statkiem) → partia FG; okna rury pirsu
    // i klatka kanału zrzutowego (budowle BG) → partia BG, żeby ziarna miały wspólną głębię z klatką (pręty zasłaniają
    // ziarna za sobą, rura pełna chowa ziarno, które wyjechało z okna)
    const p0 = (nHold + nBunker) * S;
    for (let q = 0; q < nPipe; q++) {
      const src = p0 + q * S;
      const M = mv[src + 1] > 400 ? fg : bg;
      const n = M === fg ? fgN : bgN;
      if (n >= M.cap) continue;
      const d = M.data;
      const dst = n * S;
      for (let k = 0; k < S; k++) d[dst + k] = mv[src + k];
      if (M === fg) fgN++; else bgN++;
    }
    this._count(fg, fgN, S);
    this._count(bg, bgN, S);
    const h = this.hold.apply(x[SNAP.holdAll] > 0.5, x[SNAP.holdCount], snap.hold.cols, snap.hold.rec, snap.hold.recF);
    const b = this.bunker.apply(x[SNAP.bunkerAll] > 0.5, x[SNAP.bunkerCount], snap.bunker.cols, snap.bunker.rec, snap.bunker.recF);
    this.counts.fg = fgN;
    this.counts.bg = bgN;
    this.counts.hold = h;
    this.counts.bunker = b;
    this.counts.uploads++;
  }

  /**
   * Wartości klatki: `alpha` — postęp między początkiem a końcem kroku symulacji (0…1), `pxK` — piksele na jednostkę
   * × odległość od kamery (perspektywa: (wys. / 2) / tg(fov / 2)), `shipOff` — przesunięcie statku (ładownia jedzie
   * z nim), `beltTravel` — droga taśmy, `minPx` — najmniejsza średnica ziarna na ekranie, `shipVisible` — statek jest
   * w kadrze świata (bez statku ładownia się nie rysuje), `bellX / bellSurf / bellZ / bellOn` — oś dzwonu, wysokość
   * powierzchni ładunku pod nim i krycie cienia dzwonu 0…1.
   */
  frame({ alpha, pxK, shipOff, beltTravel, minPx = 1.5, shipVisible = true, bellX = 0, bellSurf = 0, bellZ = 0, bellOn = 0 }) {
    const f = this.U.frame.value;
    f.x = alpha;
    f.y = pxK;
    f.z = minPx;
    f.w = this.lodFar ? 0.3 : 1;
    this.U.belt.value.x = beltTravel;
    this.holdGroup.visible = shipVisible;
    const sh = this.U.shadow.value;
    this.U.bell.value.set(bellX + sh.x * 10, bellSurf + sh.z, bellZ + sh.y * 10, this.geo.bell.r + 5);
    this.U.bellA.value.x = bellOn * 0.5;
    this.bellShadow.visible = bellOn > 0.01;
    this.holdGroup.position.set(0, 0, shipOff);
    this.hold.flush();
    this.bunker.flush();
  }
}
