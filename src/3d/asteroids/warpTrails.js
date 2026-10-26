// src/3d/asteroids/warpTrails.js
//
// ŚLADY ŚWIATŁA SKAŁ W SKOKU i ŁUKI DEFLEKTORA (DECYZJE-2 S2 / S3, 2026-10-26). Jedna partia kwadów w passie tła pasa
// (warstwa BELT_LAYER_BACK, perspektywa — ślad leży w głębokości swojej skały, więc paralaksa i długość na ekranie
// zgadzają się z bryłą): JEDEN rysunek, mieszanie addytywne premultiplied (`blendAddytywnePremul`: ONE, ONE),
// `forceSinglePass`, bez zapisu głębi, graf węzłów RAZ na moduł (materiały dzielą węzły — jeden program).
//
// Rodzaje instancji (maska 0 / 1, bez `select` — pułapka 39):
//   • ŚLAD (0) — od środka skały (głowa, s = 0) wzdłuż drogi, z której przyleciała, do końca (s = 1): barwa oświetlonej
//     strony skały (CPU: paleta typu × słońce pola, ≤ 0,8), ogon pod progiem bloomu gaśnie (1 − s)²; szerokość ~promienia
//     skały zwęża się do 0,3. Jasność > 1 TYLKO tuż za bryłą: głowa od brzegu skały (s = h = promień / długość) na
//     długości g = min(h / 2, `headGlow`) — ≤ pół promienia i ≤ `headGlow` długości śladu, NIEZALEŻNIE od wielkości skały
//     (recenzja S 2026-10-26: dawny zanik exp(−(s − h) / (1,5 h + 0,04)) rósł z promieniem — duże i dalekie skały, a przy
//     zwolnieniu średnie, świeciły ponad progiem na 50–100% widocznego śladu jak komety) — zanik (1 − x)² do zera
//     (zwarty nośnik: za głową sam ogon). Początek śladu przykrywa bryła (rysowana później — renderOrder skał tła 2,
//     śladów `WARP_TRAIL_RENDER_ORDER`; rozmycie bryły gaśnie ku końcowi, więc głowa prześwituje przez jej tył).
//     Wzór fragmentu ma lustro CPU `warpTrailIntensity` (testy: część śladu ponad progiem bloomu) — zmiana = obie strony.
//   • ŁUK (1) — rozbłysk deflektora: odcinek symetryczny wygięty strzałką `bend` (łuk elipsy pola), szczyt jasności
//     w środku. Cienki, krótki — nie okrąg ani obrys.
// Szerokość na ekranie ≥ `minPx` (cieńsze — szersze z jasnością × szerokość / minimum: bez migotania). Varyingi
// z clampem, bez `pow` (NaN w HalfFloat rozlewa bloom). Instancja (12 liczb, jeden bufor z przeplotem):
//   tA = (x, y, z, długość)    — początek pul pasa, scena (y w górę), z = −głębokość; długość [j.]
//   tB = (dirX, dirY, pół szerokości [j.], głowa | strzałka) — kierunek w scenie (jednostkowy); głowa = promień skały /
//        długość (ślad), strzałka łuku [j., + po lewej kierunku] (łuk)
//   tC = (r, g, b, rodzaj)     — barwa HDR × jasność, rodzaj 0 / 1

import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, attribute, uniform, varyingProperty, positionGeometry, max, min, clamp, abs, mix } from 'three/tsl';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { permanentUpdateRange, markLiveRange } from './tslCommon.js';

export const WARP_TRAIL_FLOATS = 12;
export const WARP_TRAIL_SEGMENTS = 8;
export const WARP_TRAIL_KIND = Object.freeze({ TRAIL: 0, GLINT: 1 });
export const WARP_TRAIL_RENDER_ORDER = 1.5;   // po gwiazdach (−1) i zasłonie (−0,5), przed skałami tła (2)

/**
 * Lustro CPU wzoru jasności śladu z fragmentu (bez barwy i profilu w poprzek): s — miejsce wzdłuż śladu (0 — środek
 * skały, 1 — koniec), head — promień skały / długość śladu, gain — ogon, headGain — głowa, glow — `headGlow`.
 */
export function warpTrailIntensity(s, head, gain, headGain, glow) {
  const ss = s < 0 ? 0 : (s > 1 ? 1 : s);
  const h = head < 0 ? 0 : (head > 1 ? 1 : head);
  const tail = 1 - ss;
  const g = Math.max(Math.min(h * 0.5, glow), 1e-4);
  const x = Math.min(1, Math.max(ss - h, 0) / g);
  const fall = 1 - x;
  return tail * tail * gain + fall * fall * headGain;
}

let _graph = null;

/** Graf węzłów (raz na moduł): wierzchołki, fragment i uniformy wspólne (ogniskowa i camZ passa tła, wygląd śladu). */
function buildGraph() {
  const U = {
    focal: uniform(1),       // [px] ogniskowa kamery passa tła
    camZ: uniform(1),        // [j.] wysokość kamery perspektywy nad płaszczyzną gry
    minPx: uniform(1.1),     // [px] najmniejsza pół szerokość na ekranie
    trailGain: uniform(1),   // ogon śladu (pod progiem bloomu)
    trailHead: uniform(5),   // głowa śladu tuż za bryłą (HDR)
    headGlow: uniform(0.05), // najdłuższa głowa za brzegiem skały [× długość śladu] (krótsza: pół promienia)
    taperEnd: uniform(0.3)   // szerokość końca śladu / głowy
  };
  const tA = attribute('tA', 'vec4');
  const tB = attribute('tB', 'vec4');
  const tC = attribute('tC', 'vec4');
  const vS = varyingProperty('float', 'vTrailS');
  const vSide = varyingProperty('float', 'vTrailSide');
  const vKind = varyingProperty('float', 'vTrailKind');
  const vHead = varyingProperty('float', 'vTrailHead');
  const vCol = varyingProperty('vec3', 'vTrailCol');
  const positionNode = Fn(() => {
    const g = positionGeometry;
    const s = clamp(g.x, 0.0, 1.0).toVar();
    const side = clamp(g.y, -1.0, 1.0).toVar();
    const kind = clamp(tC.w, 0.0, 1.0).toVar();
    const dir = tB.xy.toVar();
    const perp = vec2(dir.y.negate(), dir.x).toVar();
    const len = max(tA.w, 0.0).toVar();
    const m = s.mul(2.0).sub(1.0).toVar();
    const arch = float(1.0).sub(m.mul(m)).toVar();                     // 1 − (2s − 1)²: łuk, szerokość łuku
    const along = mix(s, s.sub(0.5), kind).mul(len).toVar();            // ślad od głowy, łuk wokół środka
    const bend = tB.w.mul(kind).mul(arch).toVar();
    const prof = mix(mix(float(1.0), U.taperEnd, s), arch.mul(0.7).add(0.3), kind).toVar();
    const depth = max(tA.z.negate(), 0.0).toVar();
    const pxu = U.focal.div(max(U.camZ.add(depth), 1.0)).toVar();     // px na j. w głębokości instancji
    const wPx = max(tB.z, 0.0).mul(prof).mul(pxu).toVar();
    const wEff = max(wPx, U.minPx).toVar();
    const halfW = wEff.div(pxu).toVar();
    const xy = tA.xy.add(dir.mul(along)).add(perp.mul(bend.add(side.mul(halfW))));
    vS.assign(s);
    vSide.assign(side);
    vKind.assign(kind);
    vHead.assign(clamp(tB.w, 0.0, 1.0).mul(float(1.0).sub(kind)));
    // Poszerzony do minimum — jasność × (szerokość / minimum): ta sama energia, bez migotania cienkich.
    vCol.assign(clamp(tC.xyz, vec3(0.0), vec3(64.0)).mul(clamp(wPx.div(wEff), 0.0, 1.0)));
    return vec3(xy, tA.z);
  })();
  const fragmentNode = Fn(() => {
    const s = clamp(vS, 0.0, 1.0).toVar();
    const a = clamp(abs(vSide), 0.0, 1.0);
    const kind = clamp(vKind, 0.0, 1.0);
    const h = clamp(vHead, 0.0, 1.0).toVar();
    const across = float(1.0).sub(a.mul(a));
    const cross = across.mul(across);
    // Ślad: ogon (1 − s)² pod progiem bloomu, głowa (HDR) tylko na g = min(h / 2, headGlow) za brzegiem skały (s = h),
    // zanik (1 − x)² do zera — długość głowy nie rośnie z promieniem (lustro CPU: warpTrailIntensity).
    const tail = float(1.0).sub(s);
    const g = max(min(h.mul(0.5), U.headGlow), 1e-4);
    const x = clamp(max(s.sub(h), 0.0).div(g), 0.0, 1.0);
    const fall = float(1.0).sub(x);
    const trailI = tail.mul(tail).mul(U.trailGain).add(fall.mul(fall).mul(U.trailHead));
    // Łuk: szczyt w środku, końce gasną.
    const m = s.mul(2.0).sub(1.0);
    const arc = float(1.0).sub(m.mul(m));
    const glintI = arc.mul(arc);
    const I = mix(trailI, glintI, kind);
    const col = clamp(vCol, vec3(0.0), vec3(64.0)).mul(I).mul(cross);
    return vec4(max(col, vec3(0.0)), 0.0);
  })();
  return { U, positionNode, fragmentNode };
}

/** Wspólne uniformy grafu (ogniskowa, camZ, wygląd) — jeden zestaw na moduł. */
export function warpTrailUniforms() {
  if (!_graph) _graph = buildGraph();
  return _graph.U;
}

/** Materiał partii (lekki — wspólne węzły grafu). */
export function createWarpTrailMaterial() {
  if (!_graph) _graph = buildGraph();
  const m = new THREE.NodeMaterial();
  m.name = 'AsteroidBelt:warpTrails';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  blendAddytywnePremul(m);
  m.positionNode = _graph.positionNode;
  m.fragmentNode = _graph.fragmentNode;
  return m;
}

/** Pasek (s 0..1 wzdłuż, strona −1 / +1) z `segments` odcinkami — łuk gnie wierzchołki. */
export function createWarpTrailGeometry(segments = WARP_TRAIL_SEGMENTS) {
  const n = Math.max(1, segments | 0);
  const pos = new Float32Array((n + 1) * 2 * 3);
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pos[k++] = s; pos[k++] = -1; pos[k++] = 0;
    pos[k++] = s; pos[k++] = 1; pos[k++] = 0;
  }
  const idx = new Uint16Array(n * 6);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx[t++] = a; idx[t++] = a + 2; idx[t++] = a + 1;
    idx[t++] = a + 1; idx[t++] = a + 2; idx[t++] = a + 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/**
 * Partia śladów i łuków: `begin()`, `addTrail(…)` / `addGlint(…)` (współrzędne LOKALNE względem początku pul pasa,
 * scena — y w górę), `commit(focal, camZ)`. Bez alokacji na klatkę (stały bufor, zakres wysyłki z liczby instancji).
 */
export class WarpTrailBatch {
  constructor({ parent = null, layer = 0, capacity = 320, renderOrder = WARP_TRAIL_RENDER_ORDER, material = null } = {}) {
    this.capacity = capacity;
    this.count = 0;
    this.data = new Float32Array(capacity * WARP_TRAIL_FLOATS);
    const buffer = new THREE.InstancedInterleavedBuffer(this.data, WARP_TRAIL_FLOATS, 1);
    this.buffer = buffer;
    this._range = permanentUpdateRange(buffer);
    const base = createWarpTrailGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('tA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geo.setAttribute('tB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geo.setAttribute('tC', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    this.material = material || createWarpTrailMaterial();
    this.U = warpTrailUniforms();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = 'AsteroidBelt:warpTrails';
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.layers.set(layer);
    mesh.visible = false;
    this.mesh = mesh;
    if (parent) parent.add(mesh);
    this.stats = { trails: 0, glints: 0, dropped: 0 };
  }

  begin() {
    this.count = 0;
    this.stats.trails = 0;
    this.stats.glints = 0;
    this.stats.dropped = 0;
  }

  _slot() {
    if (this.count >= this.capacity) { this.stats.dropped++; return -1; }
    return (this.count++) * WARP_TRAIL_FLOATS;
  }

  /** Ślad: głowa (x, y, z), kierunek do tyłu drogi (dx, dy — scena, jednostkowy), długość i pół szerokości [j.],
   *  głowa = promień skały / długość, barwa HDR (r, g, b). */
  addTrail(x, y, z, dx, dy, len, halfW, head, r, g, b) {
    if (!(len > 0) || !(halfW > 0)) return false;
    const o = this._slot();
    if (o < 0) return false;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = len;
    d[o + 4] = dx; d[o + 5] = dy; d[o + 6] = halfW; d[o + 7] = head > 0 ? (head < 1 ? head : 1) : 0;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = WARP_TRAIL_KIND.TRAIL;
    this.stats.trails++;
    return true;
  }

  /** Łuk: środek cięciwy (x, y, z), styczna (dx, dy — scena), długość cięciwy, pół grubości, strzałka [j., + po lewej
   *  stycznej], barwa HDR × jasność. */
  addGlint(x, y, z, dx, dy, len, halfW, bend, r, g, b) {
    if (!(len > 0) || !(halfW > 0)) return false;
    const o = this._slot();
    if (o < 0) return false;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = len;
    d[o + 4] = dx; d[o + 5] = dy; d[o + 6] = halfW; d[o + 7] = bend;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = WARP_TRAIL_KIND.GLINT;
    this.stats.glints++;
    return true;
  }

  /** Koniec klatki: ogniskowa [px] i camZ [j.] passa tła, liczba instancji, wysyłka zakresu. */
  commit(focal, camZ) {
    const n = this.count;
    this.U.focal.value = focal > 0 ? focal : 1;
    this.U.camZ.value = camZ > 0 ? camZ : 1;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) markLiveRange(this.buffer, this._range, n * WARP_TRAIL_FLOATS);
  }

  hide() {
    this.count = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  /** Wygląd śladu (uniformy wspólne — bez nowych pipeline'ów): ogon, głowa, zwężenie końca, długość głowy. */
  setLook(gain, head, taperEnd, glow) {
    const U = this.U;
    if (Number.isFinite(gain)) U.trailGain.value = gain;
    if (Number.isFinite(head)) U.trailHead.value = head;
    if (Number.isFinite(taperEnd)) U.taperEnd.value = taperEnd;
    if (Number.isFinite(glow)) U.headGlow.value = glow;
  }
}
