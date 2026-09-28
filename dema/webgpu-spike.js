// Spike Fazy 0 portu WebGPU (docs/webgpu/SPIKE.md, PROMPT-START.md Krok 3).
// Każdy punkt to osobna funkcja: sprawdza zachowanie three r183 na prawdziwym GPU
// i zapisuje wiersz { id, punkt, ok, uwagi, pomiar }. Strona jest warsztatem —
// gry nie dotyka. Uruchomienie headless: node scripts/webgpu/spike.mjs.
//
// Konwencje jak w grze: renderer.outputColorSpace = Linear, NoToneMapping,
// ACES + LinearTosRGB robi „uber” (tu uberNode), alfa premultiplied.
import * as THREE from 'three';
import * as WG from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const {
  Fn, uniform, uniformArray, texture, texture3D, uv, vec2, vec3, vec4, float, pass,
  screenCoordinate, positionLocal, mx_noise_float, mix, clamp, pow, step, select, exp, dot, sin
} = TSL;

const W = 512;
const H = 256;
const results = [];
const logEl = document.getElementById('log');
const log = (...a) => { const s = a.join(' '); logEl.textContent += s + '\n'; console.log('[spike]', s); };
const IS_VITE = !!import.meta.env;
document.getElementById('mode').textContent = IS_VITE ? 'Vite (dev)' : 'import map (statycznie)';

function record(id, punkt, ok, uwagi = '', pomiar = '') {
  const row = { id, punkt, ok, uwagi, pomiar };
  results.push(row);
  const tr = document.createElement('tr');
  const cls = ok === true ? 'ok' : ok === false ? 'fail' : 'warn';
  const txt = ok === true ? 'tak' : ok === false ? 'NIE' : String(ok);
  tr.innerHTML = `<td>${id}</td><td>${punkt}</td><td class="${cls}">${txt}</td><td>${uwagi}</td><td>${pomiar}</td>`;
  document.getElementById('rows').appendChild(tr);
  log(`${id} ${ok === true ? 'OK ' : ok === false ? 'NIE' : ok} ${punkt} | ${uwagi} | ${pomiar}`);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

// ── Referencje CPU (te same wzory co UberPostShader w core3d.js) ──────────────
const acesCpu = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
const srgbCpu = (x) => (x <= 0.0031308 ? x * 12.92 : Math.pow(x, 0.41666) * 1.055 - 0.055);

// ── TSL: ACES i LinearTosRGB gry (NIE acesFilmicToneMapping z three — inna krzywa) ──
const acesGame = Fn(([c]) => clamp(c.mul(c.mul(2.51).add(0.03)).div(c.mul(c.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0));
const linearToSrgbGame = Fn(([c]) => {
  const hi = pow(c, vec3(0.41666)).mul(1.055).sub(0.055);
  const lo = c.mul(12.92);
  return mix(hi, lo, step(c, vec3(0.0031308)));
});

// ── Pomocniki ────────────────────────────────────────────────────────────────
const WANTED_LIMITS = ['maxTextureDimension2D', 'maxTextureArrayLayers', 'maxSampledTexturesPerShaderStage',
  'maxInterStageShaderVariables', 'maxVertexAttributes', 'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage', 'maxColorAttachmentBytesPerSample', 'maxBufferSize',
  'maxStorageBufferBindingSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupStorageSize',
  'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY'];

async function adapterLimits() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  const requiredLimits = {};
  for (const k of WANTED_LIMITS) if (Number.isFinite(adapter.limits[k])) requiredLimits[k] = adapter.limits[k];
  return { adapter, requiredLimits };
}

async function makeRenderer(canvas, extra = {}) {
  const { requiredLimits } = await adapterLimits();
  const renderer = new WG.WebGPURenderer({
    canvas, alpha: true, antialias: false, powerPreference: 'high-performance',
    trackTimestamp: true, requiredLimits, ...extra
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  await renderer.init();
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

// Odczyt z celu bez paddingu wierszy (WebGPU: wiersz = ceil(w·B/256)·256 bajtów).
async function readTarget(renderer, rt, x, y, w, h, layer = 0) {
  const raw = await renderer.readRenderTargetPixelsAsync(rt, x, y, w, h, 0, layer);
  const comps = 4;
  const elemBytes = raw.BYTES_PER_ELEMENT;
  const rowElems = Math.ceil((w * comps * elemBytes) / 256) * 256 / elemBytes;
  const out = new raw.constructor(w * h * comps);
  for (let r = 0; r < h; r++) out.set(raw.subarray(r * rowElems, r * rowElems + w * comps), r * w * comps);
  return { data: out, rawLength: raw.length, rowElems };
}
const halfToFloat = (arr) => Float32Array.from(arr, (h) => THREE.DataUtils.fromHalfFloat(h));

function quadMat(fragmentNode, opts = {}) {
  const m = new WG.NodeMaterial();
  m.fragmentNode = fragmentNode;
  m.depthTest = false;
  m.depthWrite = false;
  Object.assign(m, opts);
  return m;
}

// Piksel z kanwy WebGPU przez 2D (drawImage w tym samym zadaniu co render).
function sample2D(srcCanvas, px, py) {
  const c = document.createElement('canvas');
  c.width = srcCanvas.width; c.height = srcCanvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(srcCanvas, 0, 0);
  return Array.from(ctx.getImageData(px, py, 1, 1).data);
}

const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

// Wspólny renderer testów (punkt 2 go tworzy).
let R = null;
let canvas3d = null;

// ── 1. Jeden rdzeń klas three ────────────────────────────────────────────────
async function t1() {
  const same = THREE.Mesh === WG.Mesh && THREE.Object3D === WG.Object3D && THREE.Texture === WG.Texture
    && THREE.BufferGeometry === WG.BufferGeometry && THREE.REVISION === WG.REVISION;
  const tslOk = typeof TSL.Fn === 'function' && typeof TSL.pass === 'function';
  const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /three|\.vite\/deps/.test(n))
    .map((n) => n.replace(location.origin, '').replace(/\?.*$/, ''));
  record('1', `three + three/webgpu + three/tsl na jednej stronie (${IS_VITE ? 'Vite' : 'import map'})`, same && tslOk,
    same ? `jeden rdzeń (THREE.Mesh === webgpu.Mesh), r${THREE.REVISION}` : 'DWA RDZENIE — instanceof i ShaderChunk rozjadą się',
    [...new Set(urls)].slice(0, 6).join('<br>'));
}

// ── 2. WebGPURenderer: alfa premultiplied, init, highPrecision, limity ───────
async function t2() {
  canvas3d = document.createElement('canvas');
  canvas3d.width = W; canvas3d.height = H;
  document.getElementById('stage').appendChild(canvas3d);
  const t0 = performance.now();
  R = await makeRenderer(canvas3d);
  const initMs = performance.now() - t0;
  R.highPrecision = true;
  const isGpu = R.backend.isWebGPUBackend === true;
  const lim = R.backend.device.limits;
  // Premultiplied: kwad bez blendingu pisze (0,4; 0,2; 0; 0,5) = kolor (0,8; 0,4; 0) przy alfie 0,5.
  const scene = new THREE.Scene();
  const quad = new WG.QuadMesh(quadMat(vec4(0.4, 0.2, 0.0, 0.5), { blending: THREE.NoBlending, transparent: true }));
  R.setRenderTarget(null);
  R.clear();
  quad.render(R);
  const px = sample2D(canvas3d, W / 2, H / 2);
  const ok = isGpu && lim.maxTextureDimension2D >= 16384 && near(px, [204, 102, 0, 128], 2);
  void scene;
  record('2', 'WebGPURenderer: alpha premultiplied, await init(), highPrecision, requiredLimits', ok,
    `backend ${isGpu ? 'WebGPU' : 'WebGL (zapasowy!)'}; highPrecision=${R.highPrecision}; piksel po drawImage ${px.join(',')} (oczek. 204,102,0,128); limity: tex2D ${lim.maxTextureDimension2D}, warstwy ${lim.maxTextureArrayLayers}, tekstury/etap ${lim.maxSampledTexturesPerShaderStage}, varyingi ${lim.maxInterStageShaderVariables}, atrybuty ${lim.maxVertexAttributes}`,
    `init ${fmt(initMs, 0)} ms`);
}

// ── 3. Adapter uniformów: material.uniforms.X.value co klatkę bez przebudowy ──
function uniformsAdapter(map) {
  const out = {};
  for (const [name, node] of Object.entries(map)) {
    if (node.isArrayBufferNode && Array.isArray(node.array)) {
      // uniformArray: .value to spakowany Float32Array — kod gry pisze do Vector4 z tablicy.
      out[name] = { node, get value() { return node.array; }, set value(v) { node.array = v; } };
    } else {
      out[name] = node; // UniformNode (.value liczba/Vector) i TextureNode (.value tekstura)
    }
  }
  return out;
}

function solidTexture(r, g, b) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

async function t3() {
  const rt = new THREE.RenderTarget(4, 1, { type: THREE.FloatType, depthBuffer: false });
  const vecs = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0.5, 0.6, 0.7, 0.8)];
  const texA = solidTexture(255, 0, 0);
  const texB = solidTexture(0, 0, 255);
  const nodes = {
    uScalar: uniform(0.25),
    uVec2: uniform(new THREE.Vector2(0.1, 0.2)),
    uArr: uniformArray(vecs, 'vec4'),
    uTex: texture(texA, vec2(0.5, 0.5))
  };
  const px = screenCoordinate.x;
  const frag = select(px.lessThan(1.0), vec4(nodes.uScalar, nodes.uVec2, 1.0),
    select(px.lessThan(2.0), nodes.uArr.element(1),
      select(px.lessThan(3.0), nodes.uTex, vec4(nodes.uScalar.mul(2.0), 0.0, 0.0, 1.0))));
  const mat = quadMat(frag, { blending: THREE.NoBlending });
  mat.uniforms = uniformsAdapter(nodes);
  const quad = new WG.QuadMesh(mat);
  const renderOnce = async () => {
    R.setRenderTarget(rt);
    quad.render(R);
    R.setRenderTarget(null);
    return (await readTarget(R, rt, 0, 0, 4, 1)).data;
  };
  const a = await renderOnce();
  const pipes0 = R._pipelines.caches.size;
  const frag0 = R._pipelines.programs.fragment.size;
  const ver0 = mat.version;
  // Kod aktualizacji jak w grze:
  mat.uniforms.uScalar.value = 0.75;
  mat.uniforms.uVec2.value.set(0.3, 0.4);
  mat.uniforms.uArr.value[1].set(1, 2, 3, 4);
  mat.uniforms.uTex.value = texB;
  const t0 = performance.now();
  const b = await renderOnce();
  const dt = performance.now() - t0;
  const pipes1 = R._pipelines.caches.size;
  const frag1 = R._pipelines.programs.fragment.size;
  const okA = near([a[0], a[1], a[2]], [0.25, 0.1, 0.2], 1e-6) && near([a[4], a[5], a[6], a[7]], [0.5, 0.6, 0.7, 0.8], 1e-6) && a[8] > 0.99 && a[10] < 0.01;
  const okB = near([b[0], b[1], b[2]], [0.75, 0.3, 0.4], 1e-6) && near([b[4], b[5], b[6], b[7]], [1, 2, 3, 4], 1e-6) && b[8] < 0.01 && b[10] > 0.99 && Math.abs(b[12] - 1.5) < 1e-6;
  const noRebuild = pipes0 === pipes1 && frag0 === frag1 && mat.version === ver0;
  record('3', 'Adapter uniformów: material.uniforms.X.value (liczba, Vector2.set, uniformArray Vector4 w miejscu, podmiana tekstury)',
    okA && okB && noRebuild,
    `przed ${Array.from(a.slice(0, 11)).map((v) => fmt(v, 2)).join(',')}; po ${Array.from(b.slice(0, 13)).map((v) => fmt(v, 2)).join(',')}; pipeline'y ${pipes0}→${pipes1}, programy frag ${frag0}→${frag1}; uniformArray: adapter musi wystawiać node.array (node.value to spakowany Float32Array)`,
    `render+odczyt po zmianie ${fmt(dt, 2)} ms`);
  rt.dispose();
}

// ── 4a. RenderPipeline: pass() z warstwami, MSAA HalfFloat, BloomNode, uber ──
function layerMask(...ids) { const l = new THREE.Layers(); l.disableAll(); for (const i of ids) l.enable(i); return l; }

function makeLayerScene() {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 1000);
  cam.position.set(0, 0, 100);
  cam.layers.enableAll();
  const add = (w, h, x, y, z, colorNode, layer, opts = {}) => {
    const m = new WG.MeshBasicNodeMaterial(opts);
    m.colorNode = colorNode;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(x, y, z);
    mesh.layers.set(layer);
    scene.add(mesh);
    return mesh;
  };
  // tło (warstwa 1), obiekt HDR (warstwa 0), półprzezroczysty FG (warstwa 2), addytywny (warstwa 0)
  add(W, H, 0, 0, -10, vec4(0.05, 0.05, 0.1, 1.0), 1);
  add(60, 60, -150, 0, 0, vec4(2.0, 0.5, 0.1, 1.0), 0);
  add(80, 80, 120, 0, 5, vec4(0.2, 0.6, 0.2, 0.5), 2, { transparent: true });
  add(60, 60, 0, 60, 1, vec4(0.3, 0.3, 0.3, 1.0), 0, {
    transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthWrite: false
  });
  return { scene, cam };
}

async function t4a() {
  const { scene, cam } = makeLayerScene();
  const pBg = pass(scene, cam, { samples: 4 }); pBg.setLayers(layerMask(1));
  const pOrtho = pass(scene, cam, { samples: 4 }); pOrtho.setLayers(layerMask(0));
  const pFg = pass(scene, cam, { samples: 4 }); pFg.setLayers(layerMask(2));
  const over = (top, bottom) => top.add(bottom.mul(float(1.0).sub(top.a)));
  const comp = over(pFg.getTextureNode('output'), over(pOrtho.getTextureNode('output'), pBg.getTextureNode('output')));
  const bl = bloom(comp, 0.85, 0.4, 0.9);
  const out = Fn(() => {
    const c = comp.add(bl).toVar();
    return vec4(linearToSrgbGame(acesGame(c.rgb)), c.a);
  })();
  const rp = new WG.RenderPipeline(R, out);
  rp.outputColorTransform = false;
  R.setRenderTarget(null);
  const times = [];
  for (let i = 0; i < 30; i++) { const t0 = performance.now(); rp.render(); times.push(performance.now() - t0); }
  await R.resolveTimestampsAsync('render');
  const gpuTimes = [];
  for (let i = 0; i < 10; i++) { rp.render(); gpuTimes.push(await R.resolveTimestampsAsync('render')); }
  // Odczyt kanwy w TYM SAMYM zadaniu co render — po await klatka jest już oddana
  // (pierwszy przebieg spike'u czytał po await i raz dostał zera).
  rp.render();
  const bgPx = sample2D(canvas3d, 8, 8);
  const hdrPx = sample2D(canvas3d, W / 2 - 150, H / 2);
  const expBg = [0.05, 0.05, 0.1].map((v) => Math.round(srgbCpu(acesCpu(v)) * 255));
  const rt = pBg.renderTarget;
  const ok = near(bgPx.slice(0, 3), expBg, 2) && rt.texture.type === THREE.HalfFloatType && rt.samples === 4 && hdrPx[0] > 240;
  record('4a', 'RenderPipeline: 3× pass() z setLayers, cel HalfFloat MSAA 4, BloomNode, własny pass TSL (ACES gry + sRGB), outputColorTransform=false',
    ok,
    `tło ${bgPx.slice(0, 3).join(',')} (CPU: ${expBg.join(',')}) — bez podwójnej transformacji; obiekt HDR ${hdrPx.slice(0, 3).join(',')}; typ celu ${rt.texture.type === THREE.HalfFloatType ? 'HalfFloat' : rt.texture.type}, samples ${rt.samples}. UWAGA: każdy pass() = osobny cel → blending addytywny liczy się na przezroczystym celu, a nie na tle (inaczej niż w Core3D)`,
    `CPU ${fmt(median(times))} ms/kl., GPU ${fmt(median(gpuTimes))} ms/kl.`);
  rp.dispose();
  for (const p of [pBg, pOrtho, pFg]) p.dispose();
}

// ── 4b. Model Core3D: wiele render() do JEDNEGO celu MSAA, czyszczenie głębi ──
async function t4b() {
  const { scene, cam } = makeLayerScene();
  const rt = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
  const renderScenePasses = () => {
    R.autoClear = false;
    R.setRenderTarget(rt);
    R.setClearColor(0x000000, 0);
    R.clear(true, true, true);
    cam.layers.set(1); R.render(scene, cam);
    R.clear(false, true, false);
    cam.layers.set(0); R.render(scene, cam);
    cam.layers.set(2); R.render(scene, cam);
    R.setRenderTarget(null);
    R.autoClear = true;
  };
  renderScenePasses();
  const { data } = await readTarget(R, rt, 0, 0, W, H);
  const f = halfToFloat(data);
  // addytywny kwad 0,3 na tle 0,05 w środku (x = W/2, y = H/2 − 60 w pikselach celu; wiersz 0 = GÓRA)
  const at = (x, y) => { const i = (y * W + x) * 4; return [f[i], f[i + 1], f[i + 2], f[i + 3]]; };
  const addPx = at(W / 2, H / 2 - 60);
  const bgPx = at(8, 8);
  const hdrPx = at(W / 2 - 150, H / 2);
  const additiveOk = near(addPx.slice(0, 3), [0.35, 0.35, 0.4], 0.01);
  // Post jak Core3D: resolve jest w celu, dalej bloom + uber z texture(rt.texture).
  const src = texture(rt.texture);
  const bl = bloom(src, 0.85, 0.4, 0.9);
  const out = Fn(() => { const c = src.add(bl).toVar(); return vec4(linearToSrgbGame(acesGame(c.rgb)), c.a); })();
  const rp = new WG.RenderPipeline(R, out);
  rp.outputColorTransform = false;
  const times = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    renderScenePasses();
    rp.render();
    times.push(performance.now() - t0);
  }
  const gpuTimes = [];
  for (let i = 0; i < 10; i++) { renderScenePasses(); rp.render(); gpuTimes.push(await R.resolveTimestampsAsync('render')); }
  record('4b', 'Model Core3D: kilka render() do jednego celu MSAA HalfFloat, czyszczenie tylko głębi, potem RenderPipeline z texture(rt)',
    additiveOk && bgPx[2] > 0.09 && hdrPx[0] > 1.9,
    `addytywny na tle: ${addPx.slice(0, 3).map((v) => fmt(v, 3)).join(',')} (oczek. 0,35;0,35;0,4) — MSAA trzyma treść między render() (storeOp store), HDR ${fmt(hdrPx[0], 2)}; tło ${bgPx.slice(0, 3).map((v) => fmt(v, 3)).join(',')}; wiersz 0 odczytu = GÓRA kadru`,
    `CPU ${fmt(median(times))} ms/kl. (3 passy + post), GPU ${fmt(median(gpuTimes))} ms/kl.`);
  rp.dispose();
  rt.dispose();
}

// ── 5. Składanie klatki: drawImage z kanwy WebGPU w tym samym zadaniu ─────────
function colorScene(r, g, b) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.z = 5;
  const m = new WG.MeshBasicNodeMaterial();
  m.colorNode = vec4(r, g, b, 1.0);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m));
  return { scene, cam };
}

async function t5() {
  const red = colorScene(1, 0, 0);
  const green = colorScene(0, 1, 0);
  const blue = colorScene(0, 0, 1);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  // (a) jeden render + drawImage
  R.setRenderTarget(null);
  R.render(red.scene, red.cam);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(canvas3d, 0, 0);
  const a = Array.from(ctx.getImageData(W / 2, H / 2, 1, 1).data);
  // (b) dwa rendery w jednym zadaniu, dwie kopie (wzorzec split-screen drawHexShips3D)
  ctx.clearRect(0, 0, W, H);
  R.render(red.scene, red.cam);
  ctx.drawImage(canvas3d, W / 4, 0, W / 2, H, 0, 0, W / 2, H);
  R.render(green.scene, green.cam);
  ctx.drawImage(canvas3d, W / 4, 0, W / 2, H, W / 2, 0, W / 2, H);
  const bl = Array.from(ctx.getImageData(W / 4, H / 2, 1, 1).data);
  const br = Array.from(ctx.getImageData((3 * W) / 4, H / 2, 1, 1).data);
  // (c) CanvasTarget: ten sam renderer rysuje do drugiej kanwy (overlay3D dziś ma własny WebGLRenderer)
  const overlay = document.createElement('canvas');
  overlay.width = W; overlay.height = H;
  const ct = new WG.CanvasTarget(overlay);
  ct.setPixelRatio(1);
  ct.setSize(W, H, false);
  const def = R.getCanvasTarget();
  R.setCanvasTarget(ct);
  R.render(blue.scene, blue.cam);
  R.setCanvasTarget(def);
  R.render(red.scene, red.cam);
  const c1 = sample2D(overlay, W / 2, H / 2);
  const c0 = sample2D(canvas3d, W / 2, H / 2);
  const okA = near(a, [255, 0, 0, 255], 1);
  const okB = near(bl, [255, 0, 0, 255], 1) && near(br, [0, 255, 0, 255], 1);
  const okC = near(c1, [0, 0, 255, 255], 1) && near(c0, [255, 0, 0, 255], 1);
  record('5', 'Składanie klatki: render → ctx2d.drawImage(kanwa WebGPU) w tym samym zadaniu; 2× na zadanie (split); CanvasTarget do drugiej kanwy',
    okA && okB && okC,
    `(a) ${a.join(',')}; (b) lewa ${bl.join(',')}, prawa ${br.join(',')}; (c) overlay ${c1.join(',')}, główna ${c0.join(',')}`, '');
}

// Koszt składania w 1920×1080: kopia (dzisiejsza gra) vs sama kanwa 3D pod 2D.
async function t5cost() {
  const BW = 1920;
  const BH = 1080;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:${BW}px;height:${BH}px;pointer-events:none;opacity:0.01`;
  document.body.appendChild(host);
  const c3 = document.createElement('canvas');
  c3.width = BW; c3.height = BH;
  c3.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
  const c2 = document.createElement('canvas');
  c2.width = BW; c2.height = BH;
  c2.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
  host.append(c3, c2);
  const ctx = c2.getContext('2d');
  const r = await makeRenderer(c3);
  // scena „jak gra”: 400 kwadów z blendingiem na HDR-owym tle
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-BW / 2, BW / 2, BH / 2, -BH / 2, 0.1, 1000);
  cam.position.z = 100;
  const bg = new WG.MeshBasicNodeMaterial(); bg.colorNode = vec4(0.05, 0.06, 0.1, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), bg));
  const g = new THREE.PlaneGeometry(40, 40);
  const m = new WG.MeshBasicNodeMaterial({ transparent: true }); m.colorNode = vec4(0.8, 0.5, 0.2, 0.6);
  const inst = new THREE.InstancedMesh(g, m, 400);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 400; i++) { mtx.makeTranslation((i % 40) * 46 - BW / 2 + 30, Math.floor(i / 40) * 90 - BH / 2 + 60, 1); inst.setMatrixAt(i, mtx); }
  scene.add(inst);
  const run = async (mode, frames = 90) => {
    const frameMs = [];
    const blitMs = [];
    let last = 0;
    for (let i = 0; i < frames + 10; i++) {
      await nextFrame();
      const t0 = performance.now();
      r.render(scene, cam);
      if (mode === 'kopia') {
        const tb = performance.now();
        ctx.clearRect(0, 0, BW, BH);
        ctx.drawImage(c3, 0, 0, BW, BH);
        blitMs.push(performance.now() - tb);
      } else if (i === 0) ctx.clearRect(0, 0, BW, BH);
      if (i >= 10) frameMs.push(t0 - last);
      last = t0;
    }
    return { klatka: median(frameMs), blit: median(blitMs) };
  };
  const copy = await run('kopia');
  const layer = await run('warstwa');
  const copy2 = await run('kopia');
  // To samo na WebGLRenderer (dzisiejsza ścieżka gry) — punkt odniesienia.
  const cg = document.createElement('canvas');
  cg.width = BW; cg.height = BH;
  cg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
  host.insertBefore(cg, c2);
  const gl = new THREE.WebGLRenderer({ canvas: cg, alpha: true, antialias: false, premultipliedAlpha: true });
  gl.setPixelRatio(1);
  gl.setSize(BW, BH, false);
  const glScene = new THREE.Scene();
  glScene.add(new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ color: 0x0d0f1a })));
  const glInst = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xcc8033, transparent: true, opacity: 0.6 }), 400);
  for (let i = 0; i < 400; i++) { inst.getMatrixAt(i, mtx); glInst.setMatrixAt(i, mtx); }
  glScene.add(glInst);
  const runGl = async (frames = 90) => {
    const frameMs = [];
    const blitMs = [];
    let last = 0;
    for (let i = 0; i < frames + 10; i++) {
      await nextFrame();
      const t0 = performance.now();
      gl.render(glScene, cam);
      const tb = performance.now();
      ctx.clearRect(0, 0, BW, BH);
      ctx.drawImage(cg, 0, 0, BW, BH);
      blitMs.push(performance.now() - tb);
      if (i >= 10) frameMs.push(t0 - last);
      last = t0;
    }
    return { klatka: median(frameMs), blit: median(blitMs) };
  };
  const glCopy = await runGl();
  gl.dispose();
  r.dispose();
  host.remove();
  record('5k', 'Koszt składania 1920×1080 (mediana, headless bez vsync)', true,
    'kopia = render + clearRect + drawImage co klatkę (dzisiejsza gra); warstwa = kanwa 3D pod przezroczystą 2D, bez kopii',
    `WebGPU kopia: klatka ${fmt(copy.klatka)} / ${fmt(copy2.klatka)} ms, drawImage ${fmt(copy.blit)} / ${fmt(copy2.blit)} ms; WebGPU warstwa: klatka ${fmt(layer.klatka)} ms; WebGL kopia: klatka ${fmt(glCopy.klatka)} ms, drawImage ${fmt(glCopy.blit)} ms`);
}

// ── 6. readRenderTargetPixelsAsync z RGBA32F (wzorzec wysokości ringu) ───────
async function t6() {
  const w = 50;
  const h = 20;
  const rt = new THREE.RenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false });
  const sc = screenCoordinate;
  const quad = new WG.QuadMesh(quadMat(vec4(sc.x, sc.y, sc.x.mul(sc.y).mul(0.01).sub(5.0), -1.5), { blending: THREE.NoBlending }));
  R.setRenderTarget(rt); quad.render(R); R.setRenderTarget(null);
  const t0 = performance.now();
  const raw = await R.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
  const ms = performance.now() - t0;
  const rowElems = Math.ceil((w * 16) / 256) * 256 / 4;
  const i = 5 * rowElems + 10 * 4;
  const v = [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
  const okVals = near(v, [10.5, 5.5, 10.5 * 5.5 * 0.01 - 5, -1.5], 1e-4);
  // Wymiar ringu: 2048 × 96 RGBA32F (haloRingWorldGen._readbackCpu).
  const big = new THREE.RenderTarget(2048, 96, { type: THREE.FloatType, depthBuffer: false });
  R.setRenderTarget(big); quad.render(R); R.setRenderTarget(null);
  const lat = [];
  for (let k = 0; k < 5; k++) {
    const tb = performance.now();
    await R.readRenderTargetPixelsAsync(big, 0, 0, 2048, 96);
    lat.push(performance.now() - tb);
  }
  record('6', 'readRenderTargetPixelsAsync z RGBA32F (wzorzec wysokości ringu)', okVals,
    `wartości ${v.map((x) => fmt(x, 3)).join(', ')}; długość wyniku ${raw.length} (bez paddingu byłoby ${w * h * 4}) — wiersze wyrównane do 256 B, wynik NIE jest przycinany; wiersz 0 = GÓRA celu (WebGL readPixels: dół) — odwrócona oś Y względem dzisiejszego kodu`,
    `50×20: ${fmt(ms)} ms; 2048×96 (3 MB): mediana ${fmt(median(lat))} ms`);
  rt.dispose(); big.dispose();
}

// ── 7. RenderTarget3D i cel z depth > 1 (tablica): render do warstwy ─────────
async function t7() {
  const n = 4;
  const rt3 = new THREE.RenderTarget3D(16, 16, n, { type: THREE.HalfFloatType, depthBuffer: false });
  const rtA = new THREE.RenderTarget(16, 16, { depth: n, type: THREE.HalfFloatType, depthBuffer: false });
  const uL = uniform(0);
  const quad = new WG.QuadMesh(quadMat(vec4(uL.div(n), uL.mul(0.1), 0.5, 1.0), { blending: THREE.NoBlending }));
  for (let l = 0; l < n; l++) {
    uL.value = l;
    R.setRenderTarget(rt3, l); quad.render(R);
    R.setRenderTarget(rtA, l); quad.render(R);
  }
  R.setRenderTarget(null);
  // odczyt przez próbkowanie w TSL do celu float
  const probe = new THREE.RenderTarget(n, 2, { type: THREE.FloatType, depthBuffer: false });
  const sc = screenCoordinate;
  const layerF = sc.x.floor();
  const s3 = texture3D(rt3.texture, vec3(0.5, 0.5, layerF.add(0.5).div(n)));
  const sA = texture(rtA.texture, vec2(0.5, 0.5)).depth(layerF);
  const pq = new WG.QuadMesh(quadMat(select(sc.y.lessThan(1.0), s3, sA), { blending: THREE.NoBlending }));
  R.setRenderTarget(probe); pq.render(R); R.setRenderTarget(null);
  const { data } = await readTarget(R, probe, 0, 0, n, 2);
  let ok = true;
  const got = [];
  for (let row = 0; row < 2; row++) for (let l = 0; l < n; l++) {
    const i = (row * n + l) * 4;
    got.push(fmt(data[i], 2));
    if (Math.abs(data[i] - l / n) > 0.01) ok = false;
  }
  // bezpośredni odczyt warstwy tablicy (faceIndex = warstwa)
  const direct = await R.readRenderTargetPixelsAsync(rtA, 0, 0, 16, 16, 0, 2);
  const d0 = THREE.DataUtils.fromHalfFloat(direct[0]);
  record('7', 'Render do warstwy RenderTarget3D i celu z depth > 1 (setRenderTarget(rt, warstwa))', ok && Math.abs(d0 - 0.5) < 0.01,
    `próbki warstw (3D | tablica): ${got.join(' ')} (oczek. 0,00 0,25 0,50 0,75); odczyt warstwy 2 tablicy wprost: ${fmt(d0, 3)}`, '');
  rt3.dispose(); rtA.dispose(); probe.dispose();
}

// ── 8. Znaczniki czasu GPU ───────────────────────────────────────────────────
async function t8() {
  const s = colorScene(0.2, 0.3, 0.4);
  const vals = [];
  for (let i = 0; i < 8; i++) {
    R.render(s.scene, s.cam);
    vals.push(await R.resolveTimestampsAsync('render'));
  }
  const ok = R.backend.trackTimestamp === true && vals.every((v) => Number.isFinite(v)) && median(vals) > 0;
  record('8', 'Znaczniki czasu GPU: trackTimestamp + resolveTimestampsAsync', ok,
    `trackTimestamp=${R.backend.trackTimestamp}; info.render.timestamp=${fmt(R.info.render.timestamp, 4)}; wynik = ms ostatnich renderów (kumuluje zapytania do rozwiązania — rozwiązywać co klatkę)`,
    `mediana ${fmt(median(vals), 4)} ms (1 prosty render)`);
}

// ── 9. Cień DirectionalLight: autoUpdate = false + needsUpdate przed render() ──
async function t9() {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-100, 100, 50, -50, 0.1, 1000);
  cam.position.set(0, 0, 200);
  // Światło skośne (kierunek (−2, 0, −1)): kaseta na wysokości 30 kładzie cień 60 j. w −x
  // od siebie, więc kamera z góry widzi osobno kasetę i jej cień.
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(100, 0, 50);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 500 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.autoUpdate = false;
  scene.add(light, light.target);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  const recv = new THREE.Mesh(new THREE.PlaneGeometry(200, 100), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
  recv.receiveShadow = true;
  scene.add(recv);
  const caster = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
  caster.castShadow = true;
  caster.position.set(-20, 0, 30);
  scene.add(caster);
  scene.updateMatrixWorld(true);
  R.shadowMap.enabled = true;
  R.shadowMap.type = THREE.PCFShadowMap;
  const rt = new THREE.RenderTarget(200, 100, { type: THREE.HalfFloatType });
  // piksel x = świat x + 100; cień kasety z x = −20 → x ≈ −80 (px 20), z x = +80 → x ≈ +20 (px 120)
  const lum = async (x) => { const { data } = await readTarget(R, rt, x, 50, 1, 1); return THREE.DataUtils.fromHalfFloat(data[1]); };
  const trace = [];
  const draw = async () => {
    const v0 = light.shadow.map?.depthTexture?.version;
    const n0 = light.shadow.needsUpdate;
    R.setRenderTarget(rt); R.render(scene, cam); R.setRenderTarget(null);
    trace.push(`[f${R.info.frame} nu ${n0 ? 1 : 0}→${light.shadow.needsUpdate ? 1 : 0} v ${v0}→${light.shadow.map?.depthTexture?.version}]`);
    await nextFrame();
  };
  // Rozbieg: przy pierwszej aktualizacji mapa powstaje (wersja głębi się zmienia), więc
  // ShadowNode nie kasuje needsUpdate i odświeża też w NASTĘPNYM renderze. Dalej już tylko na żądanie.
  light.shadow.needsUpdate = true;
  await draw();
  const warmFlag = light.shadow.needsUpdate;
  await draw();
  light.shadow.needsUpdate = true;
  await draw();
  const a1 = await lum(20); const b1 = await lum(120);
  caster.position.set(80, 0, 30); caster.updateMatrixWorld();
  await draw(); // bez needsUpdate — cień ma zostać w starym miejscu
  const a2 = await lum(20); const b2 = await lum(120);
  light.shadow.needsUpdate = true;
  await draw();
  const a3 = await lum(20); const b3 = await lum(120);
  const flagAfter = light.shadow.needsUpdate;
  const ok = a1 < b1 * 0.7 && a2 < b2 * 0.7 && b3 < a3 * 0.7 && flagAfter === false;
  record('9', 'Cień DirectionalLight: shadow.autoUpdate = false, shadow.needsUpdate = true tuż przed render()', ok,
    `jasność zielonego [cień A x=−80, B x=+20]: po needsUpdate ${fmt(a1, 3)} / ${fmt(b1, 3)} → kaseta przesunięta bez needsUpdate ${fmt(a2, 3)} / ${fmt(b2, 3)} (cień został w A) → needsUpdate ${fmt(a3, 3)} / ${fmt(b3, 3)} (cień w B); needsUpdate po renderze = ${flagAfter}, po PIERWSZYM renderze mapy = ${warmFlag} (pierwsza aktualizacja trwa dwa rendery). Kamera cienia z samą warstwą 0 bierze maskę kamery renderu (ShadowNode.js:691), inaczej swoją — gra ustawia słońcu shadow.camera.layers.enableAll() (planet3d.assets.js:1011), więc jak w WebGL`, trace.join(' '));
  R.shadowMap.enabled = false;
  rt.dispose();
}

// ── 10. Koszt kompilacji: ten sam szum w TSL (WebGPU) i GLSL (WebGL, dziś) ───
// Szum wartości 3D z haszem — identyczna arytmetyka w obu językach. „Rozwinięty” =
// N wywołań wygenerowanych pętlą JS (tak powstają dziś shadery z ${…} w szablonach),
// „pętla” = Loop w TSL / for w GLSL. N ciężkie tylko z ?ciezkie=1 (minuty kompilacji).
const QS = new URLSearchParams(location.search);
const HEAVY = QS.get('ciezkie') === '1';

const h13 = Fn(([p0]) => {
  const p = TSL.fract(p0.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.zyx.add(31.32)));
  return TSL.fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: 'h13', type: 'float', inputs: [{ name: 'p0', type: 'vec3' }] });

const vnoise = Fn(([p]) => {
  const i = TSL.floor(p).toVar();
  const f = TSL.fract(p).toVar();
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0)).toVar();
  const c = (x, y, z) => h13(i.add(vec3(x, y, z)));
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u.x);
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u.x);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u.x);
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}).setLayout({ name: 'vnoise', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

function tslNoiseMaterial(n, salt, { loop = false, mx = false } = {}) {
  const noise = mx ? mx_noise_float : vnoise;
  const f = Fn(() => {
    const p = positionLocal;
    const acc = float(0).toVar();
    if (loop) {
      TSL.Loop(n, ({ i }) => {
        const fi = float(i);
        const q = p.mul(fi.mul(0.137).add(1.0 + salt)).add(vec3(fi.mul(1.3), fi.mul(2.1).add(salt), fi.mul(0.7)));
        acc.addAssign(noise(q).mul(sin(dot(q, vec3(0.3, 0.5, 0.7)).add(fi))));
      });
    } else {
      for (let i = 0; i < n; i++) {
        const q = p.mul(1.0 + i * 0.137 + salt).add(vec3(i * 1.3, i * 2.1 + salt, i * 0.7));
        acc.addAssign(noise(q).mul(sin(dot(q, vec3(0.3, 0.5, 0.7)).add(i))));
      }
    }
    return vec4(acc.mul(0.01).add(0.5), 0.2, 0.3, 1.0);
  });
  const m = new WG.MeshBasicNodeMaterial();
  m.colorNode = f();
  return m;
}

const GLSL_NOISE = `
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float x00 = mix(h13(i), h13(i + vec3(1,0,0)), u.x);
  float x10 = mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), u.x);
  float x01 = mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), u.x);
  float x11 = mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}`;

function glslNoiseMaterial(n, salt, { loop = false } = {}) {
  const lit = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
  let body = '';
  if (loop) {
    body = `for (int k = 0; k < ${n}; k++) { float fi = float(k);
      vec3 q = vPos * (fi * 0.137 + ${lit(1 + salt)}) + vec3(fi * 1.3, fi * 2.1 + ${lit(salt)}, fi * 0.7);
      acc += vnoise(q) * sin(dot(q, vec3(0.3, 0.5, 0.7)) + fi); }`;
  } else {
    for (let i = 0; i < n; i++) {
      body += `{ vec3 q = vPos * ${lit(1 + i * 0.137 + salt)} + vec3(${lit(i * 1.3)}, ${lit(i * 2.1 + salt)}, ${lit(i * 0.7)});
        acc += vnoise(q) * sin(dot(q, vec3(0.3, 0.5, 0.7)) + ${lit(i)}); }\n`;
    }
  }
  return new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vPos; ${GLSL_NOISE}\nvoid main() { float acc = 0.0;\n${body}\n gl_FragColor = vec4(acc * 0.01 + 0.5, 0.2, 0.3, 1.0); }`
  });
}

let glRef = null;
function glRenderer() {
  if (glRef) return glRef;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  glRef = new THREE.WebGLRenderer({ canvas: c, antialias: false });
  return glRef;
}

async function compileWebGPU(mat) {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.z = 3;
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), mat);
  scene.add(mesh);
  const t0 = performance.now();
  await R.compileAsync(scene, cam);
  const ms = performance.now() - t0;
  let lines = 0;
  try { const sh = await R.debug.getShaderAsync(scene, cam, mesh); lines = (sh.fragmentShader.match(/\n/g) || []).length; } catch { /* brak */ }
  return { ms, lines };
}

async function compileWebGL(mat) {
  const gl = glRenderer();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.z = 3;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), mat));
  const t0 = performance.now();
  await gl.compileAsync(scene, cam);
  const asyncMs = performance.now() - t0;
  const t1 = performance.now();
  gl.render(scene, cam);
  gl.getContext().finish();
  return { ms: asyncMs + (performance.now() - t1) };
}

async function t10() {
  const cases = [
    { id: 'rozwinięty 20', n: 20, loop: false },
    { id: 'rozwinięty 40', n: 40, loop: false },
    { id: 'pętla 160', n: 160, loop: true },
    ...(HEAVY ? [{ id: 'rozwinięty 160', n: 160, loop: false }] : [])
  ];
  const parts = [];
  let salt = 0.11;
  for (const c of cases) {
    salt += 0.07;
    const g = await compileWebGPU(tslNoiseMaterial(c.n, salt, c));
    salt += 0.07;
    const w = await compileWebGL(glslNoiseMaterial(c.n, salt, c));
    parts.push(`${c.id}: WebGPU ${fmt(g.ms, 0)} ms (WGSL frag ${g.lines} l.) / WebGL ${fmt(w.ms, 0)} ms`);
  }
  // mx_noise_float (MaterialX, three) — cięższa funkcja; pierwszy przebieg spike'u: 160 rozwiniętych = 44 s.
  const mx = await compileWebGPU(tslNoiseMaterial(20, 0.9, { mx: true }));
  parts.push(`mx_noise_float ×20 rozwinięty: WebGPU ${fmt(mx.ms, 0)} ms`);
  // Synchroniczna ścieżka: render() nowego materiału bez compileAsync (CPU + czekanie na GPU).
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.z = 3;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), tslNoiseMaterial(40, 3.3)));
  const t2 = performance.now();
  R.render(scene, cam);
  const syncCpu = performance.now() - t2;
  await R.backend.device.queue.onSubmittedWorkDone();
  const syncAll = performance.now() - t2;
  parts.push(`bez compileAsync (rozwinięty 40): render() ${fmt(syncCpu, 0)} ms CPU, do końca GPU ${fmt(syncAll, 0)} ms`);
  glRef?.dispose();
  glRef = null;
  record('10', `Koszt kompilacji: szum 3D w TSL/WGSL vs ten sam w GLSL (WebGL, ANGLE D3D11)${HEAVY ? ' + wariant ciężki' : ''}`, true,
    'compileAsync = createRenderPipelineAsync (wątek główny wolny); render() bez niej tworzy pipeline synchronicznie — przestój klatki. Rozwijanie pętlą JS mnoży koszt kompilacji sterownika',
    parts.join('<br>'));
}

// ── 11. Precyzja przy 7 mln j.: highPrecision, Mesh i InstancedMesh ──────────
async function t11() {
  const X0 = 7075238.77;
  const Y0 = 6289731.51;
  const S = 128;
  const zoom = 1.8;
  const rt = new THREE.RenderTarget(S, S, { type: THREE.FloatType, depthBuffer: false });
  const blob = Fn(() => { const d = uv().sub(0.5).mul(2.0); const k = exp(dot(d, d).mul(-6.0)); return vec4(k, 0, 0, 1); });
  // Materiał NA PRZYPADEK: highPrecision wchodzi w program przy budowie węzłów — wspólny
  // materiał zbudowany z HP dawałby „bez HP” te same (dokładne) wyniki.
  const makeMat = () => {
    const m = new WG.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false });
    m.colorNode = blob();
    return m;
  };
  const geo = new THREE.PlaneGeometry(16, 16);
  const cases = {
    mesh: () => { const m = new THREE.Mesh(geo, makeMat()); m.position.set(X0, Y0, 0); return m; },
    instancedWzgledne: () => { const m = new THREE.InstancedMesh(geo, makeMat(), 1); m.position.set(X0 - 3.3, Y0, 0); m.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3.3, 0, 0)); return m; },
    instancedBezwzgledne: () => { const m = new THREE.InstancedMesh(geo, makeMat(), 1); m.setMatrixAt(0, new THREE.Matrix4().makeTranslation(X0, Y0, 0)); return m; }
  };
  const cam = new THREE.OrthographicCamera(-S / 2 / zoom, S / 2 / zoom, S / 2 / zoom, -S / 2 / zoom, 1, 1000);
  const out = {};
  for (const hp of [true, false]) {
    R.highPrecision = hp;
    for (const [name, make] of Object.entries(cases)) {
      const scene = new THREE.Scene();
      const obj = make();
      scene.add(obj);
      scene.updateMatrixWorld(true);
      const errs = [];
      let c0 = null;
      const step = 0.137;
      for (let k = 0; k < 16; k++) {
        cam.position.set(X0 + k * step, Y0, 100);
        cam.updateMatrixWorld(true);
        R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, cam); R.setRenderTarget(null);
        const { data } = await readTarget(R, rt, 0, 0, S, S);
        let sx = 0; let sw = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = data[(y * S + x) * 4]; sx += v * (x + 0.5); sw += v; }
        const cx = sx / Math.max(sw, 1e-9);
        if (c0 === null) c0 = cx;
        errs.push(cx - (c0 - k * step * zoom));
      }
      const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
      const mx = Math.max(...errs.map(Math.abs));
      out[`${name}${hp ? '' : '_bezHP'}`] = `${fmt(rms, 3)}/${fmt(mx, 3)}`;
    }
  }
  R.highPrecision = true;
  R.setClearColor(0x000000, 0);
  const good = parseFloat(out.mesh) < 0.05 && parseFloat(out.instancedWzgledne) < 0.05;
  record('11', 'Precyzja przy 7,08 mln j. (kamera co 0,137 j., zoom 1,8): drżenie środka plamki w px, RMS/max', good,
    Object.entries(out).map(([k, v]) => `${k}: ${v}`).join('; ') + ' — „instancedWzgledne” = duży offset w mesh.position, instancja względem niego (reguła agents.md)', '');
  rt.dispose();
}

// ── 12. overrideMaterial z colorWrite = false (pre-pass głębi halo planet) ───
async function t12() {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 1000);
  cam.position.z = 100;
  const sphere = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new WG.MeshBasicNodeMaterial({ color: 0x00ff00 }));
  sphere.position.z = 10;
  sphere.layers.set(3);
  const haloMat = new WG.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  haloMat.colorNode = vec4(0.0, 0.0, 1.0, 1.0);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(300, 200), haloMat);
  halo.layers.set(5);
  scene.add(sphere, halo);
  const depthOnly = new WG.MeshBasicNodeMaterial({ color: 0x000000 });
  depthOnly.colorWrite = false;
  depthOnly.depthWrite = true;
  const rt = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  R.autoClear = false;
  R.setRenderTarget(rt);
  R.setClearColor(0x000000, 0);
  R.clear(true, true, true);
  scene.overrideMaterial = depthOnly;
  cam.layers.set(3); R.render(scene, cam);
  scene.overrideMaterial = null;
  cam.layers.set(5); R.render(scene, cam);
  R.setRenderTarget(null);
  R.autoClear = true;
  const { data } = await readTarget(R, rt, 0, 0, W, H);
  const f = (x, y) => { const i = (y * W + x) * 4; return [THREE.DataUtils.fromHalfFloat(data[i]), THREE.DataUtils.fromHalfFloat(data[i + 1]), THREE.DataUtils.fromHalfFloat(data[i + 2])]; };
  const centre = f(W / 2, H / 2);
  const edge = f(W / 2 + 120, H / 2);
  const ok = centre[2] < 0.01 && centre[1] < 0.01 && edge[2] > 0.99;
  record('12', 'overrideMaterial z colorWrite = false (pre-pass głębi halo) i warstwy kamery', ok,
    `środek tarczy ${centre.map((v) => fmt(v, 2)).join(',')} (halo zasłonięte, zielony nie zapisany), poza tarczą ${edge.map((v) => fmt(v, 2)).join(',')}`, '');
  rt.dispose();
}

// ── 13. Viewport / nożyczki na celu i semantyka clear (podzielony ekran) ─────
async function t13() {
  const rt = new THREE.RenderTarget(64, 32, { type: THREE.FloatType });
  const red = colorScene(1, 0, 0);
  R.autoClear = false;
  R.setRenderTarget(rt);
  R.setClearColor(0x00ff00, 1);
  R.clear(true, true, true);
  // lewa połowa: czerwony
  rt.viewport.set(0, 0, 32, 32); rt.scissor.set(0, 0, 32, 32); rt.scissorTest = true;
  R.setScissorTest(true);
  R.render(red.scene, red.cam);
  // „clear” przy nożyczkach na prawej połowie (tak robi dziś split w Core3D)
  rt.viewport.set(32, 0, 32, 32); rt.scissor.set(32, 0, 32, 32);
  R.setClearColor(0x0000ff, 1);
  R.clear(true, false, false);
  rt.viewport.set(0, 0, 64, 32); rt.scissor.set(0, 0, 64, 32); rt.scissorTest = false;
  R.setScissorTest(false);
  R.setRenderTarget(null);
  R.autoClear = true;
  R.setClearColor(0x000000, 0);
  const { data } = await readTarget(R, rt, 0, 0, 64, 32);
  const left = [data[(16 * 64 + 8) * 4], data[(16 * 64 + 8) * 4 + 1], data[(16 * 64 + 8) * 4 + 2]];
  const right = [data[(16 * 64 + 56) * 4], data[(16 * 64 + 56) * 4 + 1], data[(16 * 64 + 56) * 4 + 2]];
  const clearWipesAll = left[2] > 0.99;
  record('13', 'Viewport/nożyczki na celu (rt.viewport/scissor) i clear przy nożyczkach', 'uwaga',
    `lewa ${left.map((v) => fmt(v, 1)).join(',')}, prawa ${right.map((v) => fmt(v, 1)).join(',')} — ${clearWipesAll ? 'clear() czyści CAŁY cel (loadOp), nożyczek nie respektuje' : 'clear() respektuje nożyczki'}; viewport celu ustawia się na rt.viewport (setViewport działa tylko na kanwę)`, '');
  rt.dispose();
}

// ── 14. renderer.info: draw calle i trójkąty ─────────────────────────────────
async function t14() {
  const { scene, cam } = makeLayerScene();
  R.info.autoReset = false;
  R.info.reset();
  const rt = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType });
  R.setRenderTarget(rt);
  cam.layers.enableAll();
  R.render(scene, cam);
  R.render(scene, cam);
  R.setRenderTarget(null);
  const i = R.info.render;
  const ok = i.drawCalls === 8 && i.triangles === 16;
  record('14', 'renderer.info przy autoReset = false (liczniki per klatka)', ok,
    `drawCalls ${i.drawCalls} (oczek. 8), triangles ${i.triangles}, frameCalls ${i.frameCalls}, calls ${i.calls} — w WebGPU draw calle to render.drawCalls, a render.calls liczy wywołania render() i NIE jest zerowane przez reset()`, '');
  R.info.autoReset = true;
  rt.dispose();
}

// ── 15. ShaderMaterial na WebGPU: zamiennik z biblioteki materiałów ──────────
async function t15() {
  let built = 0;
  class PlaceholderMaterial extends WG.NodeMaterial {
    static get type() { return 'PlaceholderMaterial'; }
    constructor() { super(); this.isPlaceholder = true; }
    setup(builder) {
      built++;
      this.colorNode = vec4(1.0, 0.0, 1.0, 1.0);
      this.fragmentNode = null;
      return super.setup(builder);
    }
  }
  R.library.addMaterial(PlaceholderMaterial, 'ShaderMaterial');
  R.library.addMaterial(PlaceholderMaterial, 'RawShaderMaterial');
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.z = 5;
  const sm = new THREE.ShaderMaterial({
    uniforms: { uFoo: { value: 1 } },
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uFoo; void main(){ gl_FragColor = vec4(uFoo); }'
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sm));
  const rt = new THREE.RenderTarget(8, 8, { type: THREE.FloatType });
  R.setRenderTarget(rt); R.render(scene, cam); R.setRenderTarget(null);
  const { data } = await readTarget(R, rt, 0, 0, 8, 8);
  const px = [data[0], data[1], data[2]];
  const ok = near(px, [1, 0, 1], 1e-3) && built > 0;
  record('15', 'Nieprzeniesiony ShaderMaterial na WebGPU: zamiennik przez renderer.library.addMaterial(…, "ShaderMaterial")', ok,
    `piksel ${px.map((v) => fmt(v, 2)).join(',')} (magenta), budowy zamiennika: ${built}; bez tego three loguje błąd „Material ShaderMaterial is not compatible” i rysuje pusty NodeMaterial; stan renderu (blending, depth) kopiuje się z materiału`, '');
  rt.dispose();
}

// ── 16. Blending One/One i depthFunc GREATER (trik cienia mostka) ────────────
async function t16() {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.z = 5;
  const base = new WG.MeshBasicNodeMaterial(); base.colorNode = vec4(0.2, 0.2, 0.2, 1);
  const baseMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), base); // lewa połowa pisze głębię z = 0
  baseMesh.position.set(-0.5, 0, 0);
  const add = new WG.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
  add.colorNode = vec4(0.5, 0.0, 0.0, 0.0);
  const addMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), add);
  addMesh.position.z = 1;
  const under = new WG.MeshBasicNodeMaterial({ depthWrite: false, depthFunc: THREE.GreaterDepth });
  under.colorNode = vec4(0.0, 0.0, 0.7, 1.0);
  const underMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), under); // POD kadłubem (z = −1): widać tylko tam, gdzie kadłub
  underMesh.position.z = -1;
  underMesh.renderOrder = 20;
  scene.add(baseMesh, addMesh, underMesh);
  const rt = new THREE.RenderTarget(16, 8, { type: THREE.FloatType });
  R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, cam); R.setRenderTarget(null);
  const { data } = await readTarget(R, rt, 0, 0, 16, 8);
  const L = [data[(4 * 16 + 3) * 4], data[(4 * 16 + 3) * 4 + 1], data[(4 * 16 + 3) * 4 + 2]];
  const Rr = [data[(4 * 16 + 12) * 4], data[(4 * 16 + 12) * 4 + 1], data[(4 * 16 + 12) * 4 + 2]];
  // Kolejność: nieprzezroczyste (kadłub, potem kwad GREATER z renderOrder 20 — zastępuje kolor
  // tylko nad kadłubem), na końcu przezroczysty addytywny (+0,5 R wszędzie).
  const ok = near(L, [0.5, 0.0, 0.7], 0.02) && near(Rr, [0.5, 0, 0], 0.02);
  record('16', 'Blending One/One (addytywny HDR) i depthFunc GREATER pod kadłubem (cień mostka)', ok,
    `nad kadłubem ${L.map((v) => fmt(v, 2)).join(',')} (oczek. 0,5;0;0,7: kwad GREATER przeszedł tylko tam, gdzie kadłub zapisał głębię), obok ${Rr.map((v) => fmt(v, 2)).join(',')} (oczek. 0,5;0;0)`, '');
  rt.dispose();
}

// ── 17. MSAA w locie (setMsaaEnabled): zmiana samples + dispose ──────────────
async function t17() {
  const s = colorScene(0.1, 0.9, 0.1);
  const rt = new THREE.RenderTarget(32, 32, { type: THREE.HalfFloatType, samples: 4 });
  R.setRenderTarget(rt); R.render(s.scene, s.cam); R.setRenderTarget(null);
  rt.samples = 0; rt.dispose();
  R.setRenderTarget(rt); R.render(s.scene, s.cam); R.setRenderTarget(null);
  const a = THREE.DataUtils.fromHalfFloat((await readTarget(R, rt, 0, 0, 1, 1)).data[1]);
  rt.samples = 4; rt.dispose();
  R.setRenderTarget(rt); R.render(s.scene, s.cam); R.setRenderTarget(null);
  const b = THREE.DataUtils.fromHalfFloat((await readTarget(R, rt, 0, 0, 1, 1)).data[1]);
  record('17', 'MSAA w locie: rt.samples = n + rt.dispose() (Core3D.setMsaaEnabled)', Math.abs(a - 0.9) < 0.01 && Math.abs(b - 0.9) < 0.01,
    `samples 0: ${fmt(a, 3)}, samples 4: ${fmt(b, 3)}`, '');
  rt.dispose();
}

// ── Przebieg ─────────────────────────────────────────────────────────────────
const TESTS = [t1, t2, t3, t4a, t4b, t5, t5cost, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15, t16, t17];
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message || e.reason)));

window.__spike = { done: false, results, errors, mode: IS_VITE ? 'vite' : 'importmap' };
(async () => {
  if (!navigator.gpu) {
    record('0', 'navigator.gpu', false, 'brak WebGPU w tej przeglądarce');
    window.__spike.done = true;
    return;
  }
  for (const t of TESTS) {
    try {
      await t();
    } catch (err) {
      record(t.name.replace(/^t/, ''), `${t.name} — wyjątek`, false, String(err?.stack || err).slice(0, 600));
    }
    await nextFrame();
  }
  window.__spike.done = true;
  log('KONIEC');
})();
