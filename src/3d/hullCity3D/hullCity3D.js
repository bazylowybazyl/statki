// src/3d/hullCity3D/hullCity3D.js
//
// MIASTO 3D na grzbiecie okrętu — obraz (niewpięty do gry; demo dema/miasto-3d.html, opis docs/OPIS-miasto-3d.md).
// Dane liczy czysty generator (src/game/hullDesign/hullDesignCity.js → `buildHullCity`); ten moduł ich nie liczy,
// nie czyta `window`, DOM ani stanu gry — dostaje miasto, pozę kadłuba i słońce od wołającego (gra / worker renderu /
// demo). Rysuje JEDNYM grafem na rodzaj (materiały: hullCity3D.tsl.js), trzy rysunki na miasto:
//   • bryły      — Mesh + InstancedBufferGeometry (graniastosłup ośmiokątny, 48 wierzchołków), bufor instancji
//                  przepleciony (12 floatów na bryłę), renderOrder 12 (po cieniu na kadłubie, jak bryła mostka);
//   • cień       — prostokąt pod kadłubem (z = −0,6, GREATER), renderOrder 11;
//   • światła    — kwady instancji (8 floatów), addytywnie, renderOrder 13.
// Mapa wysokości miasta (r16f) — marsz cienia i AO — to JEDNA tekstura o stałej pojemności (HULL_CITY3D_LIMITS),
// wpisana w graf przy budowie: próbki w grafie to klony węzła tekstury z wartością z chwili budowy (podmiana `value`
// do nich nie dochodzi), a three r183 nie zmienia rozmiaru zwykłej tekstury w miejscu. Nowe miasto pisze dane w tę samą
// teksturę (mapa większa niż pojemność — zmniejszona maksimum z komórek). Pozycje brył względem środka okrętu (małe liczby), poza kadłuba w macierzy grupy (duży offset
// w `group.position` — three składa modelViewMatrix w double). y sceny = −y projektu zapisane w danych (bez odbicia
// w macierzy — pułapka 37).

import * as THREE from 'three/webgpu';
import {
  CITY_BOX_LAYOUT, CITY_LIGHT_LAYOUT, CITY_MAT_PALETTE, createCityNodes, createCityBoxMaterial, createCityReceiverMaterial,
  createCityLightMaterial, setCityInstanceLayout
} from './hullCity3D.tsl.js';

/** Strojenie obrazu (demo: suwaki; gra: stałe). */
export const HULL_CITY3D_TUNE = {
  ambient: 0.38,         // otoczenie (kadłub: 0,24 + poduszkowa normalna)
  diffuse: 1.18,         // = SHIP_LIGHT_DEFAULTS.dayDiffuseMul
  specular: 0.3,
  roofLight: 1.7,        // otoczenie dachów × (ściany × 0,5) — dachy ciemnoszare, ściany ciemne
  sunZ: 600,             // wysokość słońca nad płaszczyzną jak w kadłubie (słońce ~60 000 j. dalej — niemal poziome)
  shadowElevDeg: 26,     // „słońce cieni” (mostek: 30°) — długość cienia = wysokość / tg
  shadowStrength: 0.62,  // przyciemnienie kadłuba w pełnym cieniu miasta
  shadowSoft: 0.07,      // półcień rośnie z odległością
  selfShadowAmbient: 0.6,
  brightness: 1,         // jasność masywu
  heightTone: 0.5,       // jaśniejsze wyższe dachy (z góry: grzbiet jaśniejszy od tarasów)
  windowGlow: 0.05,      // udział tlących się okien na ścianach
  lights: 1,             // jasność świateł (0 — zgaszone)
  lightMinPx: 1.4,       // poniżej — światło słabnie zamiast maleć
  halo: 0.55,            // zasięg poświaty
  lightsTop: 0.22,       // z góry (ortho), tryb punktów: siła świateł szczelin i podstaw (okna pionowych ścian i tak gasną)
  topGlow: 0,            // z góry: 0 — punkty, 1 — miękka poświata kanionów (szerokie słabe plamy zamiast punktów)
  glowSize: 5,           // poświata: mnożnik rozmiaru świateł podstaw (dno kanionów)
  glowGain: 0.28,        // poświata: siła (plamy nakładają się w pas wzdłuż kanionu)
  receiverZ: -0.6
};

/** Pojemność mapy wysokości (teksele): 2048 × 1024 r16f = 4 MB; drednot 8 km mieści się przy ~2,6 j./teksel. */
export const HULL_CITY3D_LIMITS = Object.freeze({ hmW: 2048, hmH: 1024 });

const BOX_ORDER = 12;
const RECV_ORDER = 11;
const LIGHT_ORDER = 13;
const SQ2 = Math.SQRT2;

/**
 * Graniastosłup ośmiokątny „jednostkowy”: position = (sx, sy, wierzch 0 / 1), normal = normalna ściany w rzucie
 * (wierzch (0, 0, 1), spód (0, 0, −1)), aCh = które współrzędne narożnika skraca faza (cx, cy). Kształt instancji liczy
 * vertexNode (pół-wymiary, faza, pochylenie).
 */
export function cityPrismGeometry() {
  // narożniki od ściany +x przeciwnie do zegara: (sx, sy, cx, cy)
  const C = [[1, -1, 0, 1], [1, 1, 0, 1], [1, 1, 1, 0], [-1, 1, 1, 0], [-1, 1, 0, 1], [-1, -1, 0, 1], [-1, -1, 1, 0], [1, -1, 1, 0]];
  const FN = [[1, 0], [1 / SQ2, 1 / SQ2], [0, 1], [-1 / SQ2, 1 / SQ2], [-1, 0], [-1 / SQ2, -1 / SQ2], [0, -1], [1 / SQ2, -1 / SQ2]];
  const pos = [], nrm = [], ch = [], idx = [];
  const v = (c, top, n) => { pos.push(c[0], c[1], top); nrm.push(n[0], n[1], n[2]); ch.push(c[2], c[3]); return pos.length / 3 - 1; };
  // ściany boczne: czworokąt (dół a, dół b, wierzch b, wierzch a) — na zewnątrz przeciwnie do zegara
  for (let f = 0; f < 8; f++) {
    const a = C[f], b = C[(f + 1) % 8], n = [FN[f][0], FN[f][1], 0];
    const i0 = v(a, 0, n), i1 = v(b, 0, n), i2 = v(b, 1, n), i3 = v(a, 1, n);
    idx.push(i0, i1, i2, i0, i2, i3);
  }
  // wierzch (wachlarz) i spód (odwrotnie)
  const t0 = pos.length / 3;
  for (let k = 0; k < 8; k++) v(C[k], 1, [0, 0, 1]);
  for (let k = 1; k < 7; k++) idx.push(t0, t0 + k, t0 + k + 1);
  const b0 = pos.length / 3;
  for (let k = 0; k < 8; k++) v(C[k], 0, [0, 0, -1]);
  for (let k = 1; k < 7; k++) idx.push(b0, b0 + k + 1, b0 + k);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aCh', new THREE.Float32BufferAttribute(ch, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

/** Pusta mapa wysokości (r16f; filtr liniowy, bez mipmap — próbka z jawnym poziomem 0). */
function makeHeightTexture(w, h, data) {
  const tex = new THREE.DataTexture(data || new Uint16Array(Math.max(1, w * h)), Math.max(1, w), Math.max(1, h), THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Miasto 3D jednego okrętu. `opts`: { scene } — scena Core3D (warstwa 0, pass ortho). Zwraca obiekt z metodami
 * setCity(miasto z buildHullCity), setPose(x, y, kąt) [świat gry], setSun(x, y) [świat gry], update(), warmupMeshes(),
 * dispose(); `stats` (bryły, światła, pamięć, czas przygotowania).
 */
export function createHullCity3D({ scene } = {}) {
  const T = HULL_CITY3D_TUNE;
  const LIM = HULL_CITY3D_LIMITS;
  const heightTex = makeHeightTexture(LIM.hmW, LIM.hmH);
  const nodes = createCityNodes(heightTex);
  const group = new THREE.Group();
  group.name = 'HullCity3D';
  group.matrixAutoUpdate = true;

  // bryły
  const boxGeo = cityPrismGeometry();
  let boxCap = 0, boxBuf = null;
  const boxMat = createCityBoxMaterial(nodes);
  const boxMesh = new THREE.Mesh(boxGeo, boxMat);
  boxMesh.name = 'HullCity3D:bryly';
  boxMesh.frustumCulled = false;
  boxMesh.renderOrder = BOX_ORDER;
  // cień na kadłubie
  const recvGeo = new THREE.BufferGeometry();
  const recvPos = new THREE.Float32BufferAttribute(new Float32Array(12), 3);
  recvGeo.setAttribute('position', recvPos);
  recvGeo.setIndex([0, 1, 2, 0, 2, 3]);
  recvGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const recvMesh = new THREE.Mesh(recvGeo, createCityReceiverMaterial(nodes, T.receiverZ));
  recvMesh.name = 'HullCity3D:cien';
  recvMesh.frustumCulled = false;
  recvMesh.renderOrder = RECV_ORDER;
  // światła
  const lightGeo = quadGeometry();
  let lightCap = 0, lightBuf = null;
  const lightMesh = new THREE.Mesh(lightGeo, createCityLightMaterial(nodes));
  lightMesh.name = 'HullCity3D:swiatla';
  lightMesh.frustumCulled = false;
  lightMesh.renderOrder = LIGHT_ORDER;
  group.add(recvMesh, boxMesh, lightMesh);
  if (scene) scene.add(group);

  const pose = { x: 0, y: 0, angle: 0 };
  const sun = { x: -60000, y: -40000 };
  const stats = { boxes: 0, lights: 0, heightTexels: 0, gpuBytes: 0, setMs: 0, top: 0 };
  let bounds = null;
  let top = 1;

  function ensureBoxes(n) {
    if (n <= boxCap) return;
    boxCap = Math.max(256, 1 << Math.ceil(Math.log2(n)));
    boxBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(boxCap * CITY_BOX_LAYOUT.stride), CITY_BOX_LAYOUT.stride, 1);
    setCityInstanceLayout(boxGeo, boxBuf, CITY_BOX_LAYOUT);
  }
  function ensureLights(n) {
    if (n <= lightCap) return;
    lightCap = Math.max(256, 1 << Math.ceil(Math.log2(n)));
    lightBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(lightCap * CITY_LIGHT_LAYOUT.stride), CITY_LIGHT_LAYOUT.stride, 1);
    setCityInstanceLayout(lightGeo, lightBuf, CITY_LIGHT_LAYOUT);
  }

  /** Nowe miasto (wynik buildHullCity albo jego tablice z workera: boxes, nBoxes, lights, nLights, height, bounds). */
  function setCity(city) {
    const t0 = performance.now();
    const nb = city?.nBoxes | 0, nl = city?.nLights | 0;
    ensureBoxes(Math.max(1, nb));
    const A = boxBuf.array, S = CITY_BOX_LAYOUT.stride;
    const src = city?.boxes;
    for (let i = 0; i < nb; i++) {
      const o = i * S;
      // [x, y, z0, z1, hw, hh, ch, bat, mat, ton, hasz, flagi] → iA (x, −y, z0, z1), iB, iC (mat, ton, hasz, flagi)
      A[o] = src[o]; A[o + 1] = -src[o + 1]; A[o + 2] = src[o + 2]; A[o + 3] = src[o + 3];
      A[o + 4] = src[o + 4]; A[o + 5] = src[o + 5]; A[o + 6] = src[o + 6]; A[o + 7] = src[o + 7];
      A[o + 8] = src[o + 8]; A[o + 9] = src[o + 9]; A[o + 10] = src[o + 10]; A[o + 11] = src[o + 11];
    }
    boxBuf.needsUpdate = true;
    boxGeo.instanceCount = nb;
    ensureLights(Math.max(1, nl));
    const L = lightBuf.array, SL = CITY_LIGHT_LAYOUT.stride, ls = city?.lights;
    for (let i = 0; i < nl; i++) {
      const o = i * SL;
      L[o] = ls[o]; L[o + 1] = -ls[o + 1]; L[o + 2] = ls[o + 2]; L[o + 3] = ls[o + 3];
      L[o + 4] = ls[o + 4]; L[o + 5] = -ls[o + 5]; L[o + 6] = ls[o + 6]; L[o + 7] = ls[o + 7];
    }
    lightBuf.needsUpdate = true;
    lightGeo.instanceCount = nl;
    // mapa wysokości → stała tekstura: krok k (≥ 1) tak, żeby mapa się zmieściła (maksimum z k × k komórek);
    // wiersz tekstury = scena (y sceny = −y projektu): wiersze odwrócone
    const hm = city?.height;
    let texels = 0;
    const D = heightTex.image.data;
    D.fill(0);
    if (hm && hm.w > 0 && hm.h > 0) {
      const k = Math.max(1, Math.ceil(hm.w / LIM.hmW), Math.ceil(hm.h / LIM.hmH));
      const w = Math.ceil(hm.w / k), h = Math.ceil(hm.h / k);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let m = 0;
          for (let jj = j * k; jj < Math.min(hm.h, (j + 1) * k); jj++) {
            const row = (hm.h - 1 - jj) * hm.w;
            for (let ii = i * k; ii < Math.min(hm.w, (i + 1) * k); ii++) { const v = hm.data[row + ii]; if (v > m) m = v; }
          }
          D[j * LIM.hmW + i] = THREE.DataUtils.toHalfFloat(m);
        }
      }
      const cell = hm.cell * k;
      // scena: dół mapy y0' = −(y0 + h · cell projektu); teksel (0, 0) = lewy dolny róg mapy w scenie
      const sy0 = -(hm.y0 + hm.h * hm.cell);
      nodes.U.uHm.value.set(hm.x0, sy0, 1 / (LIM.hmW * cell), 1 / (LIM.hmH * cell));
      top = Math.max(1, hm.top || city.bounds?.top || 1);
      nodes.U.uHmTop.value.set(top, 0, 0, 0);
      texels = w * h;
      stats.hmStep = k;
    }
    heightTex.needsUpdate = true;
    bounds = city?.bounds || null;
    updateReceiver();
    group.visible = nb > 0;
    stats.boxes = nb; stats.lights = nl; stats.heightTexels = texels; stats.top = Math.round(top);
    stats.gpuBytes = boxCap * S * 4 + lightCap * SL * 4 + LIM.hmW * LIM.hmH * 2 + 48 * 4 * (3 + 3 + 2) + 84 * 4;
    stats.setMs = Math.round((performance.now() - t0) * 10) / 10;
  }

  /** Prostokąt cienia: obrys miasta wydłużony od słońca o zasięg cienia (szczyt / tg wysokości). */
  function updateReceiver() {
    const a = recvPos.array;
    if (!bounds) { a.fill(0); recvPos.needsUpdate = true; return; }
    const tanE = Math.tan(Math.max(5, Math.min(85, T.shadowElevDeg)) * Math.PI / 180);
    const reach = top / tanE + 8;
    const L = localSun();
    const lx = -L[0], ly = -L[1];                       // od słońca (scena, lokalnie)
    const ll = Math.hypot(lx, ly) || 1;
    const ox = lx / ll * reach, oy = ly / ll * reach;
    // obrys w scenie: y sceny = −y
    let x0 = bounds.x0 - 8, x1 = bounds.x1 + 8, y0 = -bounds.y1 - 8, y1 = -bounds.y0 + 8;
    x0 = Math.min(x0, x0 + ox); x1 = Math.max(x1, x1 + ox); y0 = Math.min(y0, y0 + oy); y1 = Math.max(y1, y1 + oy);
    a.set([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0]);
    recvPos.needsUpdate = true;
  }

  // kierunek do słońca w układzie miasta (scena: y = −y świata; obrót grupy −kąt)
  const _L = [0, 0, 1];
  function localSun() {
    const wx = sun.x - pose.x, wy = -(sun.y - pose.y);
    const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
    // scena → lokalnie: obrót o +kąt (grupa ma rotation.z = −kąt)
    _L[0] = wx * c - wy * s; _L[1] = wx * s + wy * c; _L[2] = T.sunZ;
    const l = Math.hypot(_L[0], _L[1], _L[2]) || 1;
    _L[0] /= l; _L[1] /= l; _L[2] /= l;
    return _L;
  }

  let lastRecvKey = '';
  /** Poza kadłuba [świat gry]: środek okrętu (układ projektu = środek obrazu kadłuba) i kąt. */
  function setPose(x, y, angle = 0) {
    pose.x = x; pose.y = y; pose.angle = angle;
    group.position.set(x, -y, 0);
    group.rotation.set(0, 0, -angle);
    group.updateMatrixWorld(true);
  }
  function setSun(x, y) { sun.x = x; sun.y = y; }

  /**
   * Raz na klatkę: uniformy ze strojenia i słońca; widoczność 0–1 (maskowanie, „Statki 3D”); `opts.topView` 0–1 — kamera
   * perspektywy patrzy z góry (poświata i przygaszanie świateł jak w kamerze ortho; ortho shader rozpoznaje sam).
   */
  function update(visibility = 1, opts = null) {
    const U = nodes.U;
    const L = localSun();
    U.uSunL.value.set(L[0], L[1], L[2]);
    U.uLight.value.set(T.ambient, T.diffuse, T.specular, T.roofLight);
    const tanE = Math.tan(Math.max(5, Math.min(85, T.shadowElevDeg)) * Math.PI / 180);
    U.uShadow.value.set(tanE, T.shadowStrength, T.shadowSoft, T.selfShadowAmbient);
    U.uLook.value.set(T.brightness, T.heightTone, T.windowGlow, Math.max(0, Math.min(1, visibility)));
    U.uLights.value.set(T.lights, T.lightMinPx, T.halo, T.lightsTop);
    U.uGlow.value.set(T.topGlow ? 1 : 0, T.glowSize, T.glowGain, Math.max(0, Math.min(1, opts?.topView ?? 0)));
    U.uWin.value.set(4, 3.2, T.windowGlow, 0);
    group.visible = visibility > 0.01 && stats.boxes > 0;
    lightMesh.visible = T.lights > 0.001 && stats.lights > 0;
    const key = `${Math.round(L[0] * 200)}|${Math.round(L[1] * 200)}|${T.shadowElevDeg}|${top}`;
    if (key !== lastRecvKey) { lastRecvKey = key; updateReceiver(); }
  }

  /** Siatki do rozgrzewki (Core3D.warmup): z jedną instancją, gdy miasta jeszcze nie ma. */
  function warmupMeshes() {
    if (!stats.boxes) {
      ensureBoxes(1); ensureLights(1);
      boxBuf.array.set([0, 0, 0, 10, 5, 5, 1, 0.5, 1, 1, 0.5, 0]);
      boxBuf.needsUpdate = true;
      lightBuf.array.set([0, 0, 5, 1, 1, 0, 0, 1 + 16 * 63]);
      lightBuf.needsUpdate = true;
    }
    boxGeo.instanceCount = Math.max(1, stats.boxes);
    lightGeo.instanceCount = Math.max(1, stats.lights);
    return [recvMesh, boxMesh, lightMesh];
  }
  /** Po rozgrzewce — właściwe liczniki. */
  function afterWarmup() {
    boxGeo.instanceCount = stats.boxes;
    lightGeo.instanceCount = stats.lights;
  }

  function dispose() {
    group.removeFromParent();
    boxGeo.dispose(); lightGeo.dispose(); recvGeo.dispose();
    boxMat.dispose(); recvMesh.material.dispose(); lightMesh.material.dispose();
    heightTex.dispose();
  }

  return {
    group, nodes, stats, tune: T, palette: CITY_MAT_PALETTE,
    setCity, setPose, setSun, update, warmupMeshes, afterWarmup, dispose,
    get meshes() { return { boxes: boxMesh, receiver: recvMesh, lights: lightMesh }; }
  };
}
