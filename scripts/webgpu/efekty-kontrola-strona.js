// Moduł strony dla scripts/webgpu/efekty-kontrola.mjs (zadanie 12-B): kontrole infrastruktury
// efektów GPU w prawdziwej grze, na tym samym GPU. Ładowany przez Vite (`import('/scripts/webgpu/
// efekty-kontrola-strona.js')`) — three/webgpu i moduły gry to te same instancje co w grze.
// Każda kontrola: render Core3D w stojącym świecie (bez kroku gry), zrzut kanwy WebGPU w tym samym
// zadaniu JS (po await kanwa bywa pusta — SPIKE 5) i porównanie pikseli na stronie.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec4, uniform, texture, instancedArray, instanceIndex, sqrt } from 'three/tsl';
import { FX_DISTORT_LAYER } from '/src/3d/fx/fxFrame.js';

const C = window.Core3D;
const W = () => C.canvas.width;
const H = () => C.canvas.height;

// ── zrzut i porównanie ─────────────────────────────────────────────────────────
let _cv = null;
function grab() {
  const src = C.canvas;
  if (!_cv) _cv = document.createElement('canvas');
  _cv.width = src.width; _cv.height = src.height;
  const ctx = _cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, _cv.width, _cv.height);
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, _cv.width, _cv.height).data;
}

/** Render Core3D bez kroku gry (ten sam świat) i zrzut kanwy. */
function renderGrab() {
  C.render();
  return grab();
}

/**
 * Różnice dwóch zrzutów: pikseli > 0 i > 8/255 (maks. kanału RGB), maks., ramka różnic > 8,
 * różnice > 8 poza kołem (cx, cy, r) w px kanwy (r < 0 — bez koła).
 */
function diff(a, b, cx = 0, cy = 0, r = -1) {
  const w = W(); const h = H();
  let n0 = 0; let n8 = 0; let max = 0; let far = 0;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const m = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
      if (m > 0) n0++;
      if (m > max) max = m;
      if (m > 8) {
        n8++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (r >= 0 && (x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) far++;
      }
    }
  }
  return { n0, n8, max, far, ramka: n8 ? [x0, y0, x1, y1] : null };
}

// Świat gry (x, y) → px kanwy (kamera ortho Core3D: pół kadru = bufor / 2 / zoom).
function toPx(x, y) {
  const cam = C.activeCam1;
  const z = Math.max(1e-4, Number(cam.zoom) || 1);
  return [W() * 0.5 + (x - cam.x) * z, H() * 0.5 + (y - cam.y) * z];
}

function addMesh(mesh, layer = 0) {
  mesh.layers.set(layer);
  mesh.frustumCulled = false;
  C.scene.add(mesh);
  mesh.updateMatrixWorld(true);
  return mesh;
}
function removeMesh(mesh) {
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.dispose?.();
}

// ── A. „uber” bez źródeł = „uber” z 02 (moduł referencyjny) co do bitu ────────
let _ref = null;
async function refPost() {
  if (_ref) return _ref;
  const ref = await import('/.tmp/webgpu/efekty-kontrola/postGry-ref.js');
  const cfg = C._getBloomConfig();
  const bloom = new ref.BloomGry(texture(C.composerTarget.texture), cfg.strength, cfg.radius, cfg.threshold);
  bloom.resolutionScale = cfg.resolutionScale;
  const uniforms = ref.createPostUniforms();
  const post = new THREE.RenderPipeline(C.renderer, ref.createUberPost({ sceneTexture: C.composerTarget.texture, bloomTexture: bloom.getTextureNode(), uniforms }));
  post.outputColorTransform = false;
  _ref = { ref, bloom, uniforms, post };
  return _ref;
}

// Uniformy „uber” gry → referencyjne (gorące powietrze tej klatki, zegar, aspekt) i bloom.
function syncRef(r) {
  const src = C._postUniforms;
  for (const k of ['uTime', 'uSourceCount', 'uGlobalStrength', 'uAspect', 'uHeatOn']) r.uniforms[k].value = src[k].value;
  for (const k of ['uHeatSources', 'uHeatDirs']) {
    const a = src[k].value; const b = r.uniforms[k].value;
    for (let i = 0; i < a.length; i++) b[i].copy(a[i]);
  }
  r.bloom.strength.value = C.bloomPass.strength.value;
  r.bloom.radius.value = C.bloomPass.radius.value;
  r.bloom.threshold.value = C.bloomPass.threshold.value;
  r.bloom.resolutionScale = C.bloomPass.resolutionScale;
}

/**
 * Post gry i post referencyjny na TYM SAMYM buforze sceny — ostatniej klatki gry (bez ponownego
 * renderu: uniformy „uber” mają jeszcze źródła gorącego powietrza dysz z tej klatki).
 */
export async function uberIdentycznosc() {
  const r = await refPost();
  syncRef(r);
  const renderer = C.renderer;
  renderer.setRenderTarget(null);
  C._post.render();
  const nowy = grab();
  r.post.render();
  const stary = grab();
  C._post.render();
  const nowy2 = grab();
  const zrodlaCiepla = C._postUniforms.uSourceCount.value;
  return { zrodlaCiepla, nowyVsStary: diff(nowy, stary), powtorzenie: diff(nowy, nowy2) };
}

// ── B. siatka bezpieczeństwa NaN / Inf ─────────────────────────────────────────
export async function nanSiatka({ inf = false } = {}) {
  const cam = C.activeCam1;
  // Kwad w pustym miejscu kadru (statek gracza stoi na środku): 450 px w prawo, 330 px w górę.
  const zz = Math.max(1e-4, cam.zoom);
  const qx = cam.x + 450 / zz; const qy = cam.y - 330 / zz;
  const [cx, cy] = toPx(qx, qy);
  const uMinus = uniform(-1);
  const uZero = uniform(0);
  const bad = inf ? float(1).div(uZero) : sqrt(uMinus);
  const mat = new THREE.NodeMaterial();
  mat.name = 'kontrola:nan';
  mat.fragmentNode = vec4(bad, bad, bad, 1.0);
  mat.depthTest = false; mat.depthWrite = false; mat.lights = false; mat.fog = false;
  mat.transparent = true; mat.blending = THREE.NoBlending;   // po kadłubach, bez mieszania
  const size = 40 / Math.max(1e-4, cam.zoom);   // 40 px
  const mesh = addMesh(new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat));
  mesh.position.set(qx, -qy, 60);
  mesh.renderOrder = 999;
  mesh.updateMatrixWorld(true);
  mesh.visible = false;
  const bez = renderGrab();
  mesh.visible = true;
  const z = renderGrab();
  // w buforze sceny naprawdę jest NaN / Inf (odczyt 4 × 4 wokół środka)
  const rt = C.composerTarget;
  const px = await C.renderer.readRenderTargetPixelsAsync(rt, Math.round(cx * rt.width / W()) - 2, Math.round(cy * rt.height / H()) - 2, 4, 4);
  let zle = 0;
  const half = (hh) => { const e = (hh >> 10) & 0x1f; return e === 31; };
  for (let i = 0; i < px.length; i++) if (px instanceof Uint16Array ? half(px[i]) : !Number.isFinite(px[i])) zle++;
  // ten sam bufor przez post referencyjny (bez siatki bezpieczeństwa)
  const r = await refPost();
  syncRef(r);
  C.renderer.setRenderTarget(null);
  r.post.render();
  const refZ = grab();
  mesh.visible = false;
  removeMesh(mesh);
  const R = 150;   // px — kwad 40 px + promień bloomu wokół niego
  return { wBuforzeNieskonczonych: zle, gra: diff(bez, z, cx, cy, R), referencyjny: diff(bez, refZ, cx, cy, R), promienPx: R };
}

// ── C. źródła zniekształceń ────────────────────────────────────────────────────
export async function zrodlaZnieksztalcen() {
  const cam = C.activeCam1;
  const z = Math.max(1e-4, cam.zoom);
  const out = {};
  const bez = renderGrab();
  // fala: front 200 j., grubość 50 j., 14 px, 300 j. w prawo od środka kadru
  const sx = cam.x + 300; const sy = cam.y;
  C.fxDistortion().shock(sx, sy, 200, 50, 14, 0.35);
  const fala = renderGrab();
  const [fx, fy] = toPx(sx, sy);
  out.fala = diff(bez, fala, fx, fy, (200 + 3.2 * 50) * z + 2);
  out.fala.zrodla = C.fxStats.distortSources;
  // drugi render tej samej klatki (podzielony ekran): kolejka żyje
  out.drugiRender = diff(fala, renderGrab());
  // implozja i gorące powietrze z kierunkiem — pierwsze zgłoszenie po renderze zaczyna nową kolejkę
  C.fxDistortion().implode(cam.x - 350, cam.y + 100, 180, 16);
  C.fxDistortion().heat(cam.x, cam.y - 250, 120, 6, 1, 0.3, 2.5, 0, 3);
  const trzy = renderGrab();
  out.trzyZrodla = { zrodla: C.fxStats.distortSources, ...diff(fala, trzy) };
  // następna klatka bez zgłoszeń: kolejka skasowana
  await window.__harness.frames(1);
  out.nastepnaKlatka = { zrodla: C.fxStats.distortSources, naglowek: C.fx.distortion.array[0].x };
  return out;
}

// ── D. warstwa DIST ────────────────────────────────────────────────────────────
export async function warstwaDist() {
  const cam = C.activeCam1;
  const z = Math.max(1e-4, cam.zoom);
  const uOff = uniform(new THREE.Vector2(8, 0));
  const mat = new THREE.NodeMaterial();
  mat.name = 'kontrola:dist';
  mat.fragmentNode = vec4(uOff.x, uOff.y, 0.0, 0.0);
  mat.transparent = true; mat.depthTest = false; mat.depthWrite = false; mat.lights = false; mat.fog = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneFactor;
  const size = 260 / z;   // 260 px
  const mesh = addMesh(new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat), FX_DISTORT_LAYER);
  mesh.position.set(cam.x, -cam.y, 0);
  mesh.updateMatrixWorld(true);
  const bez = renderGrab();
  C.setDistortLayerActive(true);
  const przesX = renderGrab();
  uOff.value.set(0, 8);
  const przesY = renderGrab();
  C.setDistortLayerActive(false);
  const wyl = renderGrab();
  removeMesh(mesh);
  // najlepsze przesunięcie kanału G w środku obszaru (±12 px): B(x, y) ≈ A(x + dx, y + dy)
  const w = W(); const [cx, cy] = [Math.round(w / 2), Math.round(H() / 2)];
  const best = (B, axis) => {
    let bd = 0; let be = Infinity;
    for (let d = -12; d <= 12; d++) {
      let e = 0;
      for (let y = cy - 80; y < cy + 80; y += 2) {
        for (let x = cx - 80; x < cx + 80; x += 2) {
          const xa = axis === 'x' ? x + d : x; const ya = axis === 'y' ? y + d : y;
          e += Math.abs(B[(y * w + x) * 4 + 1] - bez[(ya * w + xa) * 4 + 1]);
        }
      }
      if (e < be) { be = e; bd = d; }
    }
    return bd;
  };
  return {
    przesuniecieX: { najlepszeDx: best(przesX, 'x'), ...diff(bez, przesX) },
    przesuniecieY: { najlepszeDy: best(przesY, 'y'), ...diff(bez, przesY) },
    wylaczona: diff(bez, wyl),
    obszarPx: 260
  };
}

// ── E. siatka świateł „optIn” na materiale wbudowanym ──────────────────────────
export async function siatkaSwiatel() {
  const cam = C.activeCam1;
  const params = { color: 0x9aa4b0, roughness: 0.45, metalness: 0.3 };
  // Kula w pustym miejscu kadru (lewa góra; statek gracza stoi na środku).
  const wz = Math.max(1e-4, cam.zoom);
  const wx = cam.x - 450 / wz; const wy = cam.y - 330 / wz;
  const mesh = addMesh(new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), new THREE.MeshStandardMaterial(params)));
  mesh.position.set(wx, -wy, 20);
  mesh.updateMatrixWorld(true);
  const bez = renderGrab();
  const flagged = new THREE.MeshStandardMaterial(params);
  flagged.gridLights = true;
  const plain = mesh.material;
  mesh.material = flagged;
  const pusta = renderGrab();
  // światło efektu obok kuli — commit w klatce efektów: wymuszamy ją ponownie (dt = 0)
  C.fx.lights.point(wx + 120, wy - 60, 1.0, 0.55, 0.25, 6, 700, 120);
  C.fx.frameId = -1;
  const swiatlo = renderGrab();
  const [px, py] = toPx(wx, wy);
  const r = 150 * Math.max(1e-4, cam.zoom) + 3;
  // luminancja kuli (suma RGB w kole)
  const lum = (img) => {
    let s = 0; const w = W();
    for (let y = Math.floor(py - r); y <= py + r; y++) for (let x = Math.floor(px - r); x <= px + r; x++) {
      if ((x - px) ** 2 + (y - py) ** 2 > r * r) continue;
      const o = (y * w + x) * 4; s += bez.length > o ? img[o] + img[o + 1] + img[o + 2] : 0;
    }
    return s;
  };
  mesh.material = plain;
  flagged.dispose();
  removeMesh(mesh);
  C.fx.frameId = -1;
  C.render();
  return {
    pustaSiatka: diff(bez, pusta),
    zeSwiatlem: { ...diff(pusta, swiatlo, px, py, r + 150), jasnoscKuli: +(lum(swiatlo) / Math.max(1, lum(pusta))).toFixed(3), swiatla: C.fxStats.lights }
  };
}

// ── E2. koszt pętli siatki w passie ortho (GPU, pełny kadr materiałem z siatką) ──
// Tryb: 'bez' — płaszczyzna bez flagi, 'pusta' — z flagą i pustą siatką, 'n' — z flagą i N świateł.
let _costPlane = null;
let _costStep = null;
export function kosztSiatki(tryb, n = 256) {
  const cam = C.activeCam1;
  const z = Math.max(1e-4, cam.zoom);
  if (!_costPlane) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x404850, roughness: 0.6, metalness: 0.2 });
    _costPlane = addMesh(new THREE.Mesh(new THREE.PlaneGeometry(W() / z * 1.2, H() / z * 1.2), mat));
    _costPlane.renderOrder = -10;
    _costPlane.userData.plain = mat;
    const flagged = new THREE.MeshStandardMaterial({ color: 0x404850, roughness: 0.6, metalness: 0.2 });
    flagged.gridLights = true;
    _costPlane.userData.flagged = flagged;
  }
  _costPlane.position.set(cam.x, -cam.y, 5);
  _costPlane.updateMatrixWorld(true);
  _costPlane.visible = tryb !== 'off';
  _costPlane.material = tryb === 'bez' ? _costPlane.userData.plain : _costPlane.userData.flagged;
  if (_costStep) { C.removeFxStep(_costStep); _costStep = null; }
  if (tryb === 'n') {
    const hw = W() / z * 0.5; const hh = H() / z * 0.5;
    _costStep = C.addFxStep({
      name: 'kontrola:swiatla',
      lights(ctx) {
        // N świateł rozłożonych po kadrze (zasięg 800 j.), co klatkę od nowa
        const c = C.activeCam1;
        for (let i = 0; i < n; i++) {
          const u = ((i * 0.618034) % 1) * 2 - 1; const v = ((i * 0.381966 + 0.5) % 1) * 2 - 1;
          ctx.grid.addWorld(c.x + u * hw, c.y + v * hh, 80, 800, 0.6, 0.45, 0.3, 0.5);
        }
      }
    });
  }
  if (tryb === 'off' && _costPlane) {
    removeMesh(_costPlane);
    _costPlane.userData.flagged.dispose();
    _costPlane = null;
  }
  return { tryb, swiatla: n };
}

// ── F. krok compute ────────────────────────────────────────────────────────────
export async function krokCompute() {
  const buf = instancedArray(64, 'float');
  const uT = uniform(0);
  const kernel = Fn(() => {
    buf.element(instanceIndex).assign(uT.add(float(instanceIndex)));
  })().compute(64).setName('kontrola:kernel');
  let warm = 0; let upd = 0; let order = [];
  const step = {
    name: 'kontrola:compute',
    warm(ctx) { warm++; ctx.renderer.compute(kernel); },
    spawn() { order.push('spawn'); },
    lights() { order.push('lights'); },
    update(ctx) { order.push('update'); upd++; uT.value = ctx.time; ctx.renderer.compute(kernel); }
  };
  C.addFxStep(step);
  const warmNaRejestracji = warm;
  order = [];
  await window.__harness.frames(3);
  const dispatche = C.fxStats.dispatches;
  const t = C.fx.time;
  const data = new Float32Array(await C.renderer.getArrayBufferAsync(buf.value));
  C.removeFxStep(step);
  return { warmNaRejestracji, update: upd, kolejnosc: order.slice(0, 3).join(' → '), dispatcheWKlatce: dispatche, zegar: +t.toFixed(4), dane: [data[0], data[5]].map((v) => +v.toFixed(4)), oczekiwane: [+t.toFixed(4), +(t + 5).toFixed(4)] };
}

/** Stan klatki efektów (pomiar kosztu pustej infrastruktury). */
export function fxStan() {
  const s = C.fxStats;
  return { ...s, gpuComputeMs: C.gpuComputeMs, gpuFrameMs: C.gpuFrameMs, kroki: C.fx.steps.length, poczatek: [C.fx.origin.x, C.fx.origin.y], zegar: C.fx.time };
}
