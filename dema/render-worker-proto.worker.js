// dema/render-worker-proto.worker.js — prototyp RW-02 (docs/PLAN-render-worker.md § 3.8, § 4, etap 0):
// render three r183 (WebGPU, TSL) w dedykowanym workerze i kompozycja z kanwą 2D wątku głównego.
//
// Plik ma dwie role:
//   1. moduł sceny (`Proto3D`) i układ migawki (`SNAP`, `RET`, `WREC`) — importuje go też wątek główny
//      (wariant 0: ta sama scena na wątku głównym, kopia kanwy WebGPU na kanwę 2D — jak dziś w grze);
//   2. skrypt dedykowanego workera (warianty A, B*, B3; próba prawdziwego Core3D — `core3dProbe`) — część na dole
//      pliku, tylko w WorkerGlobalScope.
//
// Scena o koszcie zbliżonym do gry: kadłuby (4 obrysy, 64 partie InstancedMesh, MeshStandardNodeMaterial z emisją
// dysz i okien), płomienie dysz (addytywne, HDR), pociski i odłamki liczone w wierzchołkach, tarcze, tło z szumem
// (pętla oktaw stroi koszt GPU), passy jak Core3D do celu HalfFloat MSAA 4 (`composerTarget`), bloom gry
// (`BloomGryCompute` — 12 kerneli w jednym compute), „uber” z ACES gry i sRGB. Numer klatki migawki w lewym górnym
// rogu obrazu 3D: kod paskowy (24 bity, wiersz 0–11 px) i cyfry siedmiosegmentowe — odczytuje je skrypt pomiaru ze
// zrzutu CDP.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, uniform, uniformArray, texture, uv, float, int, vec2, vec3, vec4, attribute, positionLocal, positionGeometry,
  positionWorld, normalLocal, screenCoordinate, floor, fract, mod, exp2, step, mix, clamp, length, normalize, sin, dot,
  smoothstep, max, min, abs, select, mx_noise_float
} from 'three/tsl';
import { BloomGryCompute } from '../src/3d/tsl/bloomCompute.js';
import { hdrBezpieczny } from '../src/3d/tsl/postGry.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';

// ── Układ migawki (strona = Float64Array) ─────────────────────────────────────────────────────────────────────
// Nagłówek: numer klatki k, czas publikacji (ms od wspólnej bazy, liczonej z performance.timeOrigin + now() po obu
// stronach), czas symulacji, kamera (oko w świecie gry: ex, ey, zoom px/j.), rozmiar, liczby bloków, suma kontrolna
// bloku węzłów (test rozdartej strony). Statki: x, y (świat gry, y w dół), kąt, długość, rodzina, jasność dysz.
// Węzły: sztuczny blok o rozmiarze bloku NODES gry (§ 3.2: x, y aktywnych węzłów) — koszt kopii po obu stronach.
export const SNAP = Object.freeze({
  K: 0, TPUB: 1, SIM: 2, EX: 3, EY: 4, ZOOM: 5, W: 6, H: 7, N: 8, VFX: 9, SUM: 10, NODES: 11,
  HEAD: 16, SHIP: 6
});
export const SHIP_F = Object.freeze({ X: 0, Y: 1, A: 2, L: 3, KIND: 4, GLOW: 5 });
export function snapPageDoubles(N, nodes) {
  return SNAP.HEAD + N * SNAP.SHIP + nodes;
}
// Bufor potrójny (§ 3.2, wzór klasyczny): MID = indeks strony wspólnej | bit NOWA. Nagłówek SAB: 8 × Int32.
export const TB = Object.freeze({ MID: 0, NEW: 4, HEADER_BYTES: 32 });

// Kanał zwrotny (pisze worker, czyta wątek główny) + dziennik klatek workera (pierścień rekordów Float64).
export const RET = Object.freeze({
  COUNT: 0,            // liczba zapisanych rekordów dziennika
  LAST_CONSUMED: 1,    // k ostatnio odebranej strony
  LAST_PRESENTED: 2,   // k ostatnio pokazanej / wysłanej klatki (koniec zadania rAF workera)
  MODE_ACK: 3,         // numer potwierdzonego rozkazu trybu
  MAIN_OVK: 4,         // (pisze wątek główny) k ostatniej narysowanej nakładki — para A z perspektywy workera
  TORN: 5,             // strony z niezgodną sumą kontrolną (powinno być 0)
  READY: 6,
  CONS0: 8,            // pierścień 4 ostatnio odebranych k (B2cr / B2cp: kanwy klatek w drodze są nietykalne)
  CONSN: 12,
  HEADER_INTS: 16,
  LOG_CAP: 16384
});
export const WREC = Object.freeze({
  K: 0, TPUB: 1, TRAF: 2, TCONS: 3, TD: 4, TUPD: 5, TREND: 6, TPRES: 7, TTIB: 8, SKIP: 9, OVK: 10, MODE: 11,
  GPU: 12, OVUSED: 13, TPOST: 14, DC: 15, SIZE: 16
});
export function retBytes() {
  return RET.HEADER_INTS * 4 + RET.LOG_CAP * WREC.SIZE * 8;
}

// Kod paskowy numeru klatki: 24 komórki po 6 × 12 px od x = 8; obraz 3D w wierszu y 0–11, nakładka w 14–25.
export const BARCODE = Object.freeze({ X0: 8, CELL_W: 6, CELL_H: 12, BITS: 24, Y_3D: 0, Y_OV: 14 });

// Czas względny wspólny dla wątków: (timeOrigin − baza) + now(); baza = timeOrigin wątku głównego.
export function makeClock(baseOrigin) {
  const off = performance.timeOrigin - baseOrigin;
  return () => off + performance.now();
}

// Zajęcie CPU na `ms` (sztuczne obciążenie: krok fizyki S, aktualizacja modułów 3D D).
let __burnSink = 0;
export function burn(ms) {
  if (!(ms > 0)) return 0;
  const end = performance.now() + ms;
  let x = __burnSink || 1.0001;
  while (performance.now() < end) {
    for (let i = 0; i < 64; i++) x = x * 1.0000001 + 1e-9;
  }
  __burnSink = x;
  return x;
}

// ── Scena ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Obrysy rodzin kadłubów (długość 1 wzdłuż +x, dziób przy +0,5).
const HULL_OUTLINES = [
  [[0.5, 0], [0.3, 0.1], [-0.1, 0.13], [-0.5, 0.11], [-0.5, -0.11], [-0.1, -0.13], [0.3, -0.1]],
  [[0.5, 0], [0.18, 0.06], [0.05, 0.16], [-0.35, 0.16], [-0.5, 0.08], [-0.5, -0.08], [-0.35, -0.16], [0.05, -0.16], [0.18, -0.06]],
  [[0.5, 0.02], [0.4, 0.09], [-0.2, 0.09], [-0.32, 0.17], [-0.5, 0.15], [-0.5, -0.15], [-0.32, -0.17], [-0.2, -0.09], [0.4, -0.09], [0.5, -0.02]],
  [[0.5, 0], [0.1, 0.12], [-0.3, 0.12], [-0.5, 0.05], [-0.5, -0.05], [-0.3, -0.12], [0.1, -0.12]]
];
export const HULL_KINDS = HULL_OUTLINES.length;
// Warstwy passów po tle (warstwa 1): świat, efekty addytywne, tarcze, FG.
const PASS_LAYERS = [0, 3, 7, 2];
// Gniazda wieżyczek 2D (nakładka): (x, y) w długościach kadłuba; statek i ma 2 + (i % 3) gniazd.
export const HARDPOINTS = Object.freeze([[0.22, 0], [-0.08, 0.075], [-0.08, -0.075], [-0.3, 0]]);
export const hardpointCount = (i) => 2 + (i % 3);

function hullGeometry(kind) {
  const pts = HULL_OUTLINES[kind];
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, steps: 1, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.018, bevelSegments: 2 });
  g.translate(0, 0, -0.05);
  g.computeVertexNormals();
  return g;
}

// Hasz 2D → [0, 1) (bez pow z ujemną podstawą — pułapka 3).
const hash12 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

// Siedmiosegmentowe cyfry (maski bitów a–g = bity 0–6).
const SEG_MASKS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

export class Proto3D {
  /**
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas
   * @param {{ W: number, H: number, N: number, bullets?: number }} o
   */
  static async create(canvas, o) {
    const gpu = navigator.gpu;
    if (!gpu) throw new Error('brak navigator.gpu');
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error('brak adaptera WebGPU');
    const renderer = new THREE.WebGPURenderer({ canvas, alpha: false, antialias: false, trackTimestamp: true });
    renderer._getFallback = null; // jak Core3D: bez zapasowego WebGL2
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) throw new Error('backend nie jest WebGPU');
    renderer.highPrecision = true;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = false;
    renderer.setPixelRatio(1);
    renderer.setSize(o.W, o.H, false);
    const info = adapter.info || {};
    return new Proto3D(renderer, o, { vendor: info.vendor || '', architecture: info.architecture || '' });
  }

  constructor(renderer, o, adapterInfo) {
    this.renderer = renderer;
    this.adapterInfo = adapterInfo;
    this.W = o.W;
    this.H = o.H;
    this.N = o.N;
    const scene = new THREE.Scene();
    scene.background = null;
    this.scene = scene;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
    cam.position.set(0, 0, 3000);
    this.camera = cam;

    // Światła na wszystkich warstwach (pułapka 34: ten sam zestaw świateł w każdym passie): słońce, otoczenie,
    // 3 punktowe (jak światła efektów nad polem bitwy).
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(0.45, 0.65, 1.0);
    sun.layers.enableAll();
    scene.add(sun);
    const amb = new THREE.AmbientLight(0x4060a0, 0.35);
    amb.layers.enableAll();
    scene.add(amb);
    this.points = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.PointLight([0xff8a40, 0x60c0ff, 0xff60c0][i], 3.0, 9000, 1.2);
      p.position.set(0, 0, 600);
      p.layers.enableAll();
      scene.add(p);
      this.points.push(p);
    }

    // Kadłuby w PARTIACH (jak skóry i wieże gry — jeden rysunek na partię): statek i → partia i % P, miejsce
    // floor(i / P); geometria partii = rodzina (partia % HULL_KINDS). Liczba partii stroi koszt CPU renderu
    // (three r183 na WebGPU: ~15–25 µs na rysunek, ~40 µs na render()).
    const P = Math.max(HULL_KINDS, o.partie ?? 64);
    this.P = P;
    const hullMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.55 });
    const lp = positionLocal;
    // dysze na rufie (x < −0,44) i rzędy okien na górnej powierzchni — emisja HDR > 1 (bloom)
    const rear = float(1).sub(smoothstep(-0.47, -0.42, lp.x));
    const top = smoothstep(0.4, 0.8, normalLocal.z);
    const cell = floor(vec2(lp.x.mul(46), lp.y.mul(26)));
    const win = step(0.9, hash12(cell)).mul(top).mul(step(abs(lp.y), float(0.1)));
    hullMat.emissiveNode = vec3(1.0, 0.55, 0.22).mul(rear.mul(7.0)).add(vec3(1.0, 0.86, 0.6).mul(win.mul(2.4)));
    this.hullMat = hullMat;
    const geoms = Array.from({ length: HULL_KINDS }, (_, k) => hullGeometry(k));
    this.hulls = [];
    const perBatch = Math.ceil(this.N / P);
    const tint = new THREE.Color();
    for (let b = 0; b < P; b++) {
      const m = new THREE.InstancedMesh(geoms[b % HULL_KINDS], hullMat, perBatch);
      m.frustumCulled = false;
      for (let j = 0; j < perBatch; j++) {
        const h = (b * 97 + j * 31) % 100 / 100;
        tint.setHSL(0.55 + h * 0.12, 0.12 + h * 0.15, 0.55 + 0.2 * ((j * 7) % 5) / 5);
        m.setColorAt(j, tint);
      }
      m.count = 0;
      m.layers.set(0);
      scene.add(m);
      this.hulls.push(m);
    }

    // Płomienie dysz: addytywne kwady za rufą (8 partii), barwa HDR przez instanceColor.
    const flareMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    flareMat.forceSinglePass = true;
    const fuv = uv().sub(0.5).mul(vec2(2.0, 2.0));
    const fall = clamp(float(1).sub(length(vec2(fuv.x.mul(0.8), fuv.y.mul(1.6)))), 0, 1);
    flareMat.colorNode = vec3(1.0, 0.62, 0.3).mul(3.2);
    flareMat.opacityNode = fall.mul(fall);
    this.FB = 8;
    this.flares = [];
    const flareGeo = new THREE.PlaneGeometry(1, 1);
    const perFlare = Math.ceil(this.N / this.FB);
    for (let f = 0; f < this.FB; f++) {
      const m = new THREE.InstancedMesh(flareGeo, flareMat, perFlare);
      m.frustumCulled = false;
      for (let j = 0; j < perFlare; j++) {
        tint.setRGB(0.7 + 0.3 * ((j * 13 + f) % 7) / 7, 0.7 + 0.3 * ((j * 5 + f) % 3) / 3, 1.0);
        m.setColorAt(j, tint);
      }
      m.count = 0;
      m.layers.set(3);
      scene.add(m);
      this.flares.push(m);
    }

    // Pociski i odłamki: tor liczony w wierzchołkach z czasu (bez danych na klatkę), względem środka kadru.
    this.uVfx = uniform(0);
    this.uFleet = uniform(new THREE.Vector2(0, 0));
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const instGeo = (src, M, fill) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = src.index;
      for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.getAttribute(name));
      const aB = new Float32Array(M * 4);
      const aC = new Float32Array(M * 4);
      for (let i = 0; i < M; i++) fill(aB, aC, i * 4);
      g.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
      g.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4));
      g.instanceCount = M;
      return g;
    };
    const B = attribute('aB', 'vec4');
    const C = attribute('aC', 'vec4');
    const bMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    bMat.forceSinglePass = true;
    bMat.positionNode = Fn(() => {
      const age = fract(this.uVfx.add(C.x).div(C.y)).mul(C.y);
      const p0 = B.xy.add(B.zw.mul(age)).add(this.uFleet);
      const dir = normalize(B.zw);
      const loc = positionGeometry;
      const p = p0.add(dir.mul(loc.x.mul(C.z))).add(vec2(dir.y.negate(), dir.x).mul(loc.y.mul(C.w)));
      return vec3(p.x, p.y, 40);
    })();
    const buv = uv();
    bMat.colorNode = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.95, 0.75), buv.x).mul(3.5);
    bMat.opacityNode = buv.x.mul(float(1).sub(abs(buv.y.sub(0.5)).mul(2)));
    const plane = new THREE.PlaneGeometry(1, 1);
    const MB = o.bullets ?? 3000;
    this.bullets = [];
    for (let q = 0; q < 4; q++) {
      const g = instGeo(plane, Math.ceil(MB / 4), (aB, aC, o4) => {
        const ang = rnd() * Math.PI * 2;
        const sp = 1800 + rnd() * 2600;
        aB[o4] = (rnd() - 0.5) * 16000; aB[o4 + 1] = (rnd() - 0.5) * 9000; aB[o4 + 2] = Math.cos(ang) * sp; aB[o4 + 3] = Math.sin(ang) * sp;
        aC[o4] = rnd() * 10; aC[o4 + 1] = 0.8 + rnd() * 1.4; aC[o4 + 2] = 60 + rnd() * 160; aC[o4 + 3] = 5 + rnd() * 7;
      });
      const m = new THREE.Mesh(g, bMat);
      m.frustumCulled = false;
      m.layers.set(3);
      scene.add(m);
      this.bullets.push(m);
    }
    // odłamki (warstwa FG jak pass 2 Core3D): oświetlone czworościany dryfujące z prędkością własną
    const dMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.4, color: 0x8a8f96 });
    dMat.positionNode = Fn(() => {
      const t = this.uVfx.add(C.x);
      const p0 = B.xy.add(B.zw.mul(fract(t.div(C.y)).mul(C.y))).add(this.uFleet);
      return vec3(positionGeometry.xy.mul(C.z).add(p0), positionGeometry.z.mul(C.z).add(60));
    })();
    const tet = new THREE.TetrahedronGeometry(1, 0);
    this.debris = [];
    for (let q = 0; q < 8; q++) {
      const g = instGeo(tet, 300, (aB, aC, o4) => {
        const ang = rnd() * Math.PI * 2;
        const sp = 40 + rnd() * 220;
        aB[o4] = (rnd() - 0.5) * 15000; aB[o4 + 1] = (rnd() - 0.5) * 8500; aB[o4 + 2] = Math.cos(ang) * sp; aB[o4 + 3] = Math.sin(ang) * sp;
        aC[o4] = rnd() * 50; aC[o4 + 1] = 20 + rnd() * 30; aC[o4 + 2] = 10 + rnd() * 30; aC[o4 + 3] = 0;
      });
      const m = new THREE.Mesh(g, dMat);
      m.frustumCulled = false;
      m.layers.set(2);
      scene.add(m);
      this.debris.push(m);
    }
    // tarcze (warstwa jak pass tarcz Core3D): addytywne bańki wokół co 15. statku
    const shMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    shMat.forceSinglePass = true;
    const rim = float(1).sub(abs(normalLocal.z));
    shMat.colorNode = vec3(0.35, 0.75, 1.0).mul(rim.mul(rim).mul(1.4));
    this.shieldStride = 15;
    this.shields = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), shMat, Math.ceil(this.N / this.shieldStride));
    this.shields.frustumCulled = false;
    this.shields.count = 0;
    this.shields.layers.set(7);
    scene.add(this.shields);

    // Tło: kwad za polem z szumem (3 oktawy) i gwiazdami; jedzie z kamerą.
    const bgMat = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
    const wp = positionWorld.xy.mul(0.00018);
    const n = mx_noise_float(vec3(wp, 0.3)).mul(0.5).add(mx_noise_float(vec3(wp.mul(2.1), 1.7)).mul(0.3))
      .add(mx_noise_float(vec3(wp.mul(4.3), 2.9)).mul(0.2));
    const neb = clamp(n.mul(0.5).add(0.5), 0, 1);
    const star = step(0.9975, hash12(floor(positionWorld.xy.mul(0.05))));
    // obciążenie GPU (pokrętło `gpu`): dodatkowe oktawy szumu na piksel tła — gra w bitwie ~1,6 ms GPU na klatkę
    this.uGpuIters = uniform(o.gpuIters ?? 0, 'int');
    const extra = Fn(() => {
      const acc = float(0).toVar();
      Loop({ start: int(0), end: this.uGpuIters, type: 'int', condition: '<' }, ({ i }) => {
        const fi = float(i);
        acc.addAssign(mx_noise_float(vec3(wp.mul(fi.mul(0.37).add(1.0)), fi.mul(1.3))));
      });
      return acc;
    })();
    bgMat.colorNode = mix(vec3(0.004, 0.006, 0.02), vec3(0.05, 0.03, 0.09), neb.mul(neb)).add(vec3(1.6, 1.7, 2.0).mul(star))
      .add(vec3(0.0004).mul(extra));
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    this.bg.layers.set(1);
    scene.add(this.bg);

    // Cel sceny jak composerTarget gry: HalfFloat, MSAA 4, głębia.
    this.composer = new THREE.RenderTarget(this.W, this.H, {
      format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 4
    });
    this.bloom = new BloomGryCompute(this.composer.texture, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);

    // Nakładka B3 (bitmapa z wątku głównego, kopiowana na GPU) — wiązanie zawsze w grafie, gałąź za uniformem.
    this.uOvOn = uniform(0);
    this.ovTex = new THREE.Texture();
    this.ovTex.colorSpace = THREE.NoColorSpace;
    this.ovTex.flipY = false;
    this.ovTex.premultiplyAlpha = true;
    this.ovTex.generateMipmaps = false;
    this.ovTex.minFilter = THREE.NearestFilter;
    this.ovTex.magFilter = THREE.NearestFilter;
    this.uFrame = uniform(0);
    const segMasks = uniformArray(SEG_MASKS.map((v) => v), 'float');
    const sceneBase = texture(this.composer.texture, uv());
    const bloomNode = this.bloom.getTextureNode();
    const ovBase = texture(this.ovTex, uv());
    const uFrame = this.uFrame;
    const uOvOn = this.uOvOn;
    const outNode = Fn(() => {
      const uvT = uv().toVar();
      const sc = hdrBezpieczny(texture(sceneBase, uvT, float(0)));
      const b = texture(bloomNode, uvT, float(0)).rgb;
      const col = linearDoSrgb(acesGry(sc.rgb.add(b))).toVar();
      If(uOvOn.greaterThan(0.5), () => {
        const ov = texture(ovBase, uvT, float(0));
        col.assign(ov.rgb.add(col.mul(float(1).sub(ov.a))));
      });
      // numer klatki migawki: kod paskowy (wiersz 0–11 px) i cyfry (od x = 168)
      const px = screenCoordinate.x;
      const py = screenCoordinate.y;
      If(py.lessThan(float(BARCODE.Y_3D + BARCODE.CELL_H)).and(px.greaterThanEqual(float(BARCODE.X0)))
        .and(px.lessThan(float(BARCODE.X0 + BARCODE.BITS * BARCODE.CELL_W))), () => {
        const bitI = floor(px.sub(float(BARCODE.X0)).div(float(BARCODE.CELL_W)));
        const bit = mod(floor(uFrame.div(exp2(bitI))), 2.0);
        // ramka 1 px między komórkami w kolorze środkowym (odczyt bierze środek komórki)
        const edge = step(float(BARCODE.CELL_W - 1), mod(px.sub(float(BARCODE.X0)), float(BARCODE.CELL_W)));
        col.assign(vec3(mix(bit, 0.5, edge)));
      });
      const DX = 168; const CW = 11; const CH = 18; const ND = 7;
      If(py.lessThan(float(CH + 2)).and(px.greaterThanEqual(float(DX))).and(px.lessThan(float(DX + ND * CW))), () => {
        const ci = floor(px.sub(float(DX)).div(float(CW)));
        const lx = px.sub(float(DX)).sub(ci.mul(float(CW)));
        const ly = py.sub(1.0);
        // miejsce dziesiętne cyfry ci: 10^(ND−1−ci)
        const pow10 = select(ci.lessThan(1.0), float(1e6), select(ci.lessThan(2.0), float(1e5), select(ci.lessThan(3.0), float(1e4),
          select(ci.lessThan(4.0), float(1e3), select(ci.lessThan(5.0), float(100), select(ci.lessThan(6.0), float(10), float(1)))))));
        const d = mod(floor(uFrame.div(pow10)), 10.0);
        const mask = segMasks.element(int(d));
        const segOn = (bitIndex) => mod(floor(mask.div(float(1 << bitIndex))), 2.0);
        const h = (x0, x1, y0, y1) => step(float(x0), lx).mul(step(lx, float(x1))).mul(step(float(y0), ly)).mul(step(ly, float(y1)));
        const lit = max(max(max(h(2, 8, 0, 1.6).mul(segOn(0)), h(7.4, 9, 1, 8).mul(segOn(1))),
          max(h(7.4, 9, 9, 16).mul(segOn(2)), h(2, 8, 15.4, 17).mul(segOn(3)))),
          max(max(h(1, 2.6, 9, 16).mul(segOn(4)), h(1, 2.6, 1, 8).mul(segOn(5))), h(2, 8, 7.7, 9.3).mul(segOn(6))));
        col.assign(mix(vec3(0.0), vec3(1.0, 0.85, 0.2), lit));
      });
      return vec4(col, 1.0);
    })();
    this.post = new THREE.RenderPipeline(renderer, outNode);
    this.post.outputColorTransform = false;
    // czas GPU: znaczniki three (cecha timestamp-query) co 16. klatkę, jedno rozwiązanie w locie
    this.tsFeature = renderer.backend.trackTimestamp === true;
    renderer.backend.trackTimestamp = false;
    this.tsPending = false;
    this.tsFrame = 0;
    this.gpuRenderMs = -1;
    this.gpuComputeMs = -1;
    this._mat = new Float32Array(16);
  }

  /** Wymiana kanwy wyjścia (CanvasTarget three r183 — jedno urządzenie, dwie kanwy). */
  setCanvasTarget(target) {
    if (this.renderer.getCanvasTarget() === target) return;
    this.renderer.setCanvasTarget(target);
  }

  /**
   * Stan klatki ze strony migawki (te same dane co nakładka 2D tej klatki).
   * @param {Float64Array} p strona
   */
  update(p) {
    const S = SNAP;
    const W = this.W;
    const H = this.H;
    const zoom = p[S.ZOOM];
    const ex = p[S.EX];
    const ey = p[S.EY];
    const cam = this.camera;
    const hw = W / 2 / zoom;
    const hh = H / 2 / zoom;
    if (cam.right !== hw || cam.top !== hh) {
      cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
      cam.updateProjectionMatrix();
    }
    // świat gry (y w dół) → scena (Y = −y)
    cam.position.set(ex, -ey, 3000);
    cam.updateMatrixWorld();
    this.bg.position.set(ex, -ey, -900);
    this.bg.scale.set(hw * 2.1, hh * 2.1, 1);
    this.bg.updateMatrixWorld();
    const vfx = p[S.VFX];
    this.uVfx.value = vfx;
    this.uFleet.value.set(ex, -ey);
    for (let i = 0; i < this.points.length; i++) {
      const a = vfx * (0.4 + i * 0.17) + i * 2.1;
      this.points[i].position.set(ex + Math.cos(a) * hw * 0.6, -ey + Math.sin(a * 1.3) * hh * 0.6, 500);
    }
    const N = p[S.N] | 0;
    const P = this.P;
    const FB = this.FB;
    const shArr = this.shields.instanceMatrix.array;
    let off = S.HEAD;
    for (let i = 0; i < N; i++, off += S.SHIP) {
      const x = p[off + SHIP_F.X];
      const y = p[off + SHIP_F.Y];
      const a = p[off + SHIP_F.A];
      const L = p[off + SHIP_F.L];
      const arr = this.hulls[i % P].instanceMatrix.array;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // obrót o −a w scenie (y odwrócone): kolumny (c, −s) / (s, c) — wyznacznik +1
      let o = Math.floor(i / P) * 16;
      arr[o] = c * L; arr[o + 1] = -s * L; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = s * L; arr[o + 5] = c * L; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = L; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = -y; arr[o + 14] = 0; arr[o + 15] = 1;
      // płomień za rufą
      const g = p[off + SHIP_F.GLOW];
      const fl = L * (0.45 + 0.35 * g);
      const fw = L * 0.16;
      const rx = x - c * (0.5 * L + 0.45 * fl);
      const ry = y - s * (0.5 * L + 0.45 * fl);
      const fa = this.flares[i % FB].instanceMatrix.array;
      o = Math.floor(i / FB) * 16;
      fa[o] = c * fl; fa[o + 1] = -s * fl; fa[o + 2] = 0; fa[o + 3] = 0;
      fa[o + 4] = s * fw; fa[o + 5] = c * fw; fa[o + 6] = 0; fa[o + 7] = 0;
      fa[o + 8] = 0; fa[o + 9] = 0; fa[o + 10] = 1; fa[o + 11] = 0;
      fa[o + 12] = rx; fa[o + 13] = -ry; fa[o + 14] = 30; fa[o + 15] = 1;
      if (i % this.shieldStride === 0) {
        const r = L * 0.62;
        o = (i / this.shieldStride) * 16;
        shArr[o] = r; shArr[o + 1] = 0; shArr[o + 2] = 0; shArr[o + 3] = 0;
        shArr[o + 4] = 0; shArr[o + 5] = r; shArr[o + 6] = 0; shArr[o + 7] = 0;
        shArr[o + 8] = 0; shArr[o + 9] = 0; shArr[o + 10] = r * 0.4; shArr[o + 11] = 0;
        shArr[o + 12] = x; shArr[o + 13] = -y; shArr[o + 14] = 20; shArr[o + 15] = 1;
      }
    }
    const markAll = (m, n) => {
      m.count = n;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, n * 16);
      m.instanceMatrix.needsUpdate = true;
    };
    for (let b = 0; b < P; b++) markAll(this.hulls[b], Math.max(0, Math.ceil((N - b) / P)));
    for (let f = 0; f < FB; f++) markAll(this.flares[f], Math.max(0, Math.ceil((N - f) / FB)));
    markAll(this.shields, Math.ceil(N / this.shieldStride));
  }

  /** Scena → cel HalfFloat MSAA → bloom compute → „uber” na kanwę (bieżący CanvasTarget). */
  render(k) {
    const r = this.renderer;
    const be = r.backend;
    const sample = this.tsFeature && !this.tsPending && (this.tsFrame++ % 16) === 0;
    be.trackTimestamp = sample;
    this.uFrame.value = k % 16777216;
    r.info.reset();
    r.setRenderTarget(this.composer);
    // passy jak Core3D (_runScenePass): tło → świat (kadłuby) → efekty → tarcze → FG, do jednego celu HalfFloat MSAA
    const cam = this.camera;
    const ac = r.autoClear;
    r.autoClear = true;
    cam.layers.set(1);
    r.render(this.scene, cam);
    r.autoClear = false;
    for (const layer of PASS_LAYERS) {
      cam.layers.set(layer);
      r.render(this.scene, cam);
    }
    r.autoClear = ac;
    r.setRenderTarget(null);
    this.bloom.render(r);
    this.post.render();
    this.drawCalls = r.info.render.drawCalls;
    if (sample) {
      this.tsPending = true;
      const pr = r.resolveTimestampsAsync('render');
      const pc = r.resolveTimestampsAsync('compute');
      be.trackTimestamp = false;
      Promise.all([pr, pc]).then(([a, b]) => {
        this.gpuRenderMs = Number(a) || 0;
        this.gpuComputeMs = Number(b) || 0;
        be.timestampQueryPool?.render?.timestamps?.clear?.();
        be.timestampQueryPool?.compute?.timestamps?.clear?.();
        this.tsPending = false;
      }, () => { this.tsPending = false; });
    }
  }

  /** B3: nowa bitmapa nakładki (ImageBitmap z wątku głównego) — copyExternalImageToTexture w three. */
  setOverlayBitmap(bmp) {
    const old = this.ovTex.image;
    this.ovTex.image = bmp;
    this.ovTex.needsUpdate = true;
    return old;
  }
}

// ── Worker ────────────────────────────────────────────────────────────────────────────────────────────────────
const IS_WORKER = typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope; // eslint-disable-line no-undef
if (IS_WORKER) {
  const W_STATE = {
    proto: null, mode: 'idle', D: 0, hz: 0, now: null,
    snapI32: null, pages: [], front: 1, lastK: -1,
    retI32: null, log: null, logN: 0,
    targetA: null, targetB: null, offB: null,
    ovMap: new Map(), lastOvUsed: -1,
    nextSlot: 0, frames: 0, idleRaf: 0, rafN: 0, errors: [], consN: 0
  };
  globalThis.__rwWorker = W_STATE;

  const report = (type, extra) => postMessage({ type, ...extra });
  const fail = (err) => {
    const msg = String(err?.stack || err?.message || err);
    W_STATE.errors.push(msg);
    report('error', { msg });
  };

  // odbiór najnowszej strony: Atomics.exchange (mid ↔ front) tylko przy bicie NOWA
  function consume() {
    const H = W_STATE.snapI32;
    if (!(Atomics.load(H, TB.MID) & TB.NEW)) return null;
    const prev = Atomics.exchange(H, TB.MID, W_STATE.front);
    W_STATE.front = prev & 3;
    return W_STATE.pages[W_STATE.front];
  }

  function writeLog(rec) {
    const i = W_STATE.logN % RET.LOG_CAP;
    W_STATE.log.set(rec, i * WREC.SIZE);
    W_STATE.logN++;
    Atomics.store(W_STATE.retI32, RET.COUNT, W_STATE.logN);
  }

  const rec = new Float64Array(WREC.SIZE);

  function frame() {
    requestAnimationFrame(frame);
    W_STATE.rafN++;
    const st = W_STATE;
    if (!st.proto || st.mode === 'idle') return;
    const now = st.now;
    const tRaf = now();
    // sloty jak vsync (te same granice co pętla wątku głównego, wspólny zegar): najwyżej jedna klatka na slot
    if (st.hz > 0 && tRaf < st.nextSlot - 0.05) { st.idleRaf++; return; }
    const page = consume();
    if (!page) { st.idleRaf++; return; }
    if (st.hz > 0) {
      const P = 1000 / st.hz;
      st.nextSlot = (Math.floor(tRaf / P) + 1) * P;
    }
    const tCons = now();
    const k = page[SNAP.K];
    // suma kontrolna bloku węzłów — rozdarta strona = błąd potrójnego bufora
    const nodesOff = SNAP.HEAD + (page[SNAP.N] | 0) * SNAP.SHIP;
    const nn = page[SNAP.NODES] | 0;
    let sum = 0;
    for (let i = 0; i < nn; i += 97) sum += page[nodesOff + i];
    if (nn > 0 && sum !== page[SNAP.SUM]) Atomics.add(st.retI32, RET.TORN, 1);
    const skip = st.lastK >= 0 ? Math.max(0, k - st.lastK - 1) : 0;
    st.lastK = k;
    Atomics.store(st.retI32, RET.CONS0 + (st.consN++ & 3), k);
    Atomics.store(st.retI32, RET.CONSN, st.consN);
    Atomics.store(st.retI32, RET.LAST_CONSUMED, k);
    burn(st.D);
    const tD = now();
    const proto = st.proto;
    let ovUsed = -1;
    if (st.mode === 'B3') {
      // nakładka tej samej klatki: czekamy najwyżej do jej przyjścia — gdy brak, najnowsza starsza
      let best = -1;
      for (const key of st.ovMap.keys()) if (key <= k && key > best) best = key;
      if (best >= 0 && best !== st.lastOvUsed) {
        const bmp = st.ovMap.get(best);
        st.ovMap.delete(best);
        const old = proto.setOverlayBitmap(bmp);
        if (old && old !== bmp && typeof old.close === 'function') old.close();
        st.lastOvUsed = best;
      }
      for (const key of [...st.ovMap.keys()]) if (key < best) { st.ovMap.get(key).close(); st.ovMap.delete(key); }
      ovUsed = st.lastOvUsed;
    }
    proto.update(page);
    const tUpd = now();
    proto.render(k);
    const tRend = now();
    let ttib = 0;
    let tPost = tRend;
    if (st.mode === 'B') {
      const t0 = now();
      const bmp = st.offB.transferToImageBitmap();
      ttib = now() - t0;
      postMessage({ type: 'frame', k, bmp, tPub: page[SNAP.TPUB], tReady: now() }, [bmp]);
      tPost = now();
    }
    st.frames++;
    Atomics.store(st.retI32, RET.LAST_PRESENTED, k);
    const tEnd = now();
    rec.fill(0);
    rec[WREC.K] = k; rec[WREC.TPUB] = page[SNAP.TPUB]; rec[WREC.TRAF] = tRaf; rec[WREC.TCONS] = tCons; rec[WREC.TD] = tD;
    rec[WREC.TUPD] = tUpd; rec[WREC.TREND] = tRend; rec[WREC.TPRES] = tEnd; rec[WREC.TTIB] = ttib; rec[WREC.SKIP] = skip;
    rec[WREC.OVK] = Atomics.load(st.retI32, RET.MAIN_OVK); rec[WREC.MODE] = { A: 1, B: 2, B3: 3 }[st.mode] || 0;
    rec[WREC.GPU] = proto.gpuRenderMs >= 0 ? proto.gpuRenderMs + proto.gpuComputeMs : -1; rec[WREC.OVUSED] = ovUsed; rec[WREC.TPOST] = tPost; rec[WREC.DC] = proto.drawCalls || 0;
    writeLog(rec);
  }


  // ── Próba: prawdziwy Core3D (src/3d/core3d.js) w workerze z podkładkami (RW-02, ostatni punkt) ─────────────
  // Podkładki z zadania: window = globalThis, innerWidth / innerHeight / devicePixelRatio z wiadomości,
  // requestIdleCallback → setTimeout, kanwa podana w init. Każdy krok zapisuje, czy przeszedł i co rzuciło.
  const CORE3D_MODULES = [
    '../src/3d/hexShips3D.js', '../src/3d/planet3d.assets.js', '../src/3d/stations3D.js', '../src/3d/world3d.js',
    '../src/3d/haloRing/haloRingGame.js', '../src/3d/asteroids/asteroidBelt.js', '../src/3d/weapons/weaponFx.js',
    '../src/3d/rockets/effects.js', '../src/effects3d/rocketSystem3D.js', '../src/3d/shield3D.js',
    '../src/3d/explosions/explosionFx.js', '../src/3d/warp/warpNurt.js', '../src/3d/dust/spaceDust3D.js',
    '../src/3d/ships3d/shipModels3DGame.js', '../src/3d/bridge3D.js', '../src/3d/menuBackdrop3D.js',
    '../src/vfx/destruction3D.js', '../src/3d/pirateDryDockGame.js', '../src/3d/worldBodies3D.js',
    '../src/3d/reactor3D.js', '../src/3d/gasField/hallDust.js'
  ];
  const errText = (e) => String(e?.stack || e?.message || e).split('\n').slice(0, 4).join(' | ');
  async function core3dProbe(m) {
    const rep = { steps: [], modules: [], shims: [] };
    const step = (name, ok, extra = {}) => { rep.steps.push({ name, ok, ...extra }); };
    const t = () => performance.now();
    globalThis.window = globalThis;
    globalThis.innerWidth = m.W;
    globalThis.innerHeight = m.H;
    globalThis.devicePixelRatio = m.dpr || 1;
    rep.shims.push('window = globalThis', 'innerWidth / innerHeight / devicePixelRatio z wiadomości');
    if (typeof globalThis.requestIdleCallback !== 'function') {
      globalThis.requestIdleCallback = (fn, opt) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 8 }), Math.min(50, opt?.timeout ?? 1));
      globalThis.cancelIdleCallback = (id) => clearTimeout(id);
      rep.shims.push('requestIdleCallback → setTimeout');
    }
    const canvasOnly = (tag) => {
      if (String(tag).toLowerCase() === 'canvas') return new OffscreenCanvas(300, 150);
      throw new Error(`document.createElement('${tag}') w workerze`);
    };
    if (m.docShim) {
      globalThis.document = { createElement: canvasOnly, createElementNS: (ns, tag) => canvasOnly(tag) };
      rep.shims.push("od startu: document.createElement('canvas') → OffscreenCanvas (?dok=1)");
    }
    let Core3D = null;
    let t0 = t();
    try {
      const mod = await import('../src/3d/core3d.js');
      Core3D = mod.Core3D;
      step('import src/3d/core3d.js', true, { ms: t() - t0 });
    } catch (e) {
      step('import src/3d/core3d.js', false, { err: errText(e) });
      return rep;
    }
    t0 = t();
    try {
      Core3D.init(m.canvas);
      step('Core3D.init(OffscreenCanvas)', true, { ms: t() - t0, w: Core3D.width, h: Core3D.height, isInitialized: Core3D.isInitialized });
    } catch (e) {
      step('Core3D.init(OffscreenCanvas)', false, { err: errText(e) });
      return rep;
    }
    t0 = t();
    const ok = await Promise.race([Core3D.ready, new Promise((r) => setTimeout(() => r('timeout'), 30000))]);
    step('Core3D.ready (urządzenie, post, rozgrzewka postu)', ok === true, { ms: t() - t0, gpuError: Core3D.gpuError, gpuUnsupported: Core3D.gpuUnsupported, ret: String(ok) });
    if (ok !== true) return rep;
    const box = new THREE.Mesh(new THREE.BoxGeometry(600, 260, 120), new THREE.MeshStandardNodeMaterial({ color: 0x8aa8c8, roughness: 0.5, metalness: 0.4 }));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(220, 80), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(6, 2.6, 0.8) }));
    glow.position.set(-380, 0, 70);
    Core3D.scene.add(box);
    Core3D.scene.add(glow);
    box.updateMatrixWorld();
    glow.updateMatrixWorld();
    const cam = { x: 0, y: 0, zoom: 0.5 };
    t0 = t();
    try {
      Core3D.syncCamera(cam);
      Core3D.renderSingle(cam);
      step('syncCamera + renderSingle (pierwsza klatka)', true, { ms: t() - t0, drawCalls: Core3D.renderer?.info?.render?.drawCalls });
    } catch (e) {
      step('syncCamera + renderSingle (pierwsza klatka)', false, { err: errText(e) });
    }
    const times = [];
    let frameErr = null;
    await new Promise((done) => {
      let n = 0;
      const f = () => {
        if (n++ >= 60) { done(); return; }
        const t1 = t();
        try {
          cam.x = 120 * Math.sin(n * 0.1);
          box.rotation.z = n * 0.03;
          box.updateMatrixWorld();
          Core3D.syncCamera(cam);
          Core3D.renderSingle(cam);
        } catch (e) { frameErr = frameErr || errText(e); }
        times.push(t() - t1);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    times.sort((a, b) => a - b);
    step('60 klatek w rAF workera', !frameErr, { err: frameErr, msP50: times[times.length >> 1], msMax: times[times.length - 1], gpuFrameMs: Core3D.gpuFrameMs, fx: Core3D.fxStats ? { ...Core3D.fxStats } : null });
    t0 = t();
    try {
      const fl = await Promise.race([Core3D.warmup.flush(), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
      step('Core3D.warmup.flush()', fl !== 'timeout', { ms: t() - t0, stats: Core3D.warmup.stats ? JSON.parse(JSON.stringify(Core3D.warmup.stats)) : null });
    } catch (e) {
      step('Core3D.warmup.flush()', false, { err: errText(e) });
    }
    // moduły renderu gry: sam import w workerze (z podkładkami) — co pęka już przy ładowaniu
    for (const path of CORE3D_MODULES) {
      const tm = t();
      try {
        await import(/* @vite-ignore */ path);
        rep.modules.push({ path, ok: true, ms: t() - tm });
      } catch (e) {
        rep.modules.push({ path, ok: false, err: errText(e) });
      }
    }
    // po imporcie: render dalej działa (moduły dopisują kroki efektów / rozgrzewki)
    try {
      Core3D.syncCamera(cam);
      Core3D.renderSingle(cam);
      step('renderSingle po imporcie modułów gry', true, { drawCalls: Core3D.renderer?.info?.render?.drawCalls });
    } catch (e) {
      step('renderSingle po imporcie modułów gry', false, { err: errText(e) });
    }
    // faza 2 (poza podkładkami z zadania): document.createElement('canvas') → OffscreenCanvas — czy to wystarcza
    // kanwom tekstur (§ 2.9 planu), i ładowanie obrazów
    if (!m.docShim) {
      globalThis.document = { createElement: canvasOnly, createElementNS: (ns, tag) => canvasOnly(tag) };
      rep.shims.push("faza 2: document.createElement('canvas') → OffscreenCanvas");
    }
    try {
      const { EngineExhaustBatch } = await import('../src/3d/engineExhaustBatch.js');
      const meshes = EngineExhaustBatch.warmupMeshes();
      step('faza 2: dysze SIDE warmupMeshes() (tekstury z kanwy)', true, { n: Array.isArray(meshes) ? meshes.length : (meshes ? 1 : 0) });
    } catch (e) {
      step('faza 2: dysze SIDE warmupMeshes() (tekstury z kanwy)', false, { err: errText(e) });
    }
    try {
      const fl = await Promise.race([Core3D.warmup.flush(), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
      step('faza 2: Core3D.warmup.flush()', fl !== 'timeout', { stats: { wpisy: Core3D.warmup.stats?.wpisy, bledy: Core3D.warmup.stats?.bledy } });
    } catch (e) {
      step('faza 2: Core3D.warmup.flush()', false, { err: errText(e) });
    }
    const url = '/assets/capital_ship_rect_v1.png';
    try {
      const tex = await Promise.race([new THREE.TextureLoader().loadAsync(url), new Promise((_, no) => setTimeout(() => no(new Error('limit czasu')), 8000))]);
      step('faza 2: THREE.TextureLoader (obrazy planet, stacji, sprite’y)', true, { w: tex.image?.width });
    } catch (e) {
      step('faza 2: THREE.TextureLoader (obrazy planet, stacji, sprite’y)', false, { err: errText(e) });
    }
    try {
      const bmp = await new THREE.ImageBitmapLoader().loadAsync(url);
      step('faza 2: THREE.ImageBitmapLoader (zamiennik w workerze)', true, { w: bmp.width, h: bmp.height });
    } catch (e) {
      step('faza 2: THREE.ImageBitmapLoader (zamiennik w workerze)', false, { err: errText(e) });
    }
    try {
      const t0i = t();
      const img = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(img);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, Math.min(64, bmp.width), Math.min(64, bmp.height));
      step('faza 2: fetch → createImageBitmap → OffscreenCanvas 2D getImageData (alfa sprite’a, kratownica belek)', true, { ms: t() - t0i, w: bmp.width, n: px.data.length });
    } catch (e) {
      step('faza 2: fetch → createImageBitmap → OffscreenCanvas 2D getImageData', false, { err: errText(e) });
    }
    return rep;
  }

  self.onmessage = async (e) => {
    const m = e.data;
    try {
      if (m.type === 'core3d') {
        const r = await core3dProbe(m);
        report('core3d', { report: r });
        return;
      }
      if (m.type === 'init') {
        const st = W_STATE;
        st.now = makeClock(m.baseOrigin);
        st.hz = m.hz || 0;
        st.snapI32 = new Int32Array(m.snapSab, 0, TB.HEADER_BYTES / 4);
        const pageD = snapPageDoubles(m.N, m.nodes);
        for (let p = 0; p < 3; p++) st.pages.push(new Float64Array(m.snapSab, TB.HEADER_BYTES + p * pageD * 8, pageD));
        st.retI32 = new Int32Array(m.retSab, 0, RET.HEADER_INTS);
        st.log = new Float64Array(m.retSab, RET.HEADER_INTS * 4, RET.LOG_CAP * WREC.SIZE);
        const caps = {
          gpu: !!self.navigator.gpu, raf: typeof self.requestAnimationFrame === 'function',
          offscreen: typeof OffscreenCanvas === 'function', crossOriginIsolated: self.crossOriginIsolated === true
        };
        const proto = await Proto3D.create(m.canvas, { W: m.W, H: m.H, N: m.N, bullets: m.bullets, partie: m.partie, gpuIters: m.gpuIters });
        st.proto = proto;
        st.targetA = proto.renderer.getCanvasTarget();
        st.offB = new OffscreenCanvas(m.W, m.H);
        st.targetB = new THREE.CanvasTarget(st.offB);
        st.targetB.setPixelRatio(1);
        st.targetB.setSize(m.W, m.H, false);
        // pusta bitmapa nakładki (B3) — tekstura dostaje rozmiar kanwy
        const ovc = new OffscreenCanvas(m.W, m.H);
        ovc.getContext('2d');
        proto.setOverlayBitmap(ovc.transferToImageBitmap());
        // pierwsza klatka obu kanw (pipeline'y przed pomiarem)
        const warm = new Float64Array(pageD);
        warm[SNAP.ZOOM] = 0.2; warm[SNAP.W] = m.W; warm[SNAP.H] = m.H; warm[SNAP.N] = 0;
        proto.update(warm);
        proto.setCanvasTarget(st.targetB);
        proto.render(0);
        st.offB.transferToImageBitmap().close();
        proto.setCanvasTarget(st.targetA);
        proto.uOvOn.value = 1;
        proto.render(0);
        proto.uOvOn.value = 0;
        proto.render(0);
        caps.adapter = proto.adapterInfo;
        Atomics.store(st.retI32, RET.READY, 1);
        requestAnimationFrame(frame);
        report('ready', { caps });
      } else if (m.type === 'mode') {
        const st = W_STATE;
        st.mode = m.mode;
        if (m.D != null) st.D = m.D;
        if (m.hz != null) { st.hz = m.hz; st.nextSlot = 0; }
        if (st.proto) {
          st.proto.setCanvasTarget(st.mode === 'B' ? st.targetB : st.targetA);
          st.proto.uOvOn.value = st.mode === 'B3' ? 1 : 0;
        }
        for (const b of st.ovMap.values()) b.close();
        st.ovMap.clear();
        st.lastOvUsed = -1;
        st.lastK = -1;
        Atomics.store(st.retI32, RET.MODE_ACK, m.seq | 0);
      } else if (m.type === 'load') {
        W_STATE.D = m.D;
      } else if (m.type === 'ov') {
        const st = W_STATE;
        if (st.mode !== 'B3') { m.bmp.close(); return; }
        st.ovMap.set(m.k, m.bmp);
        // nadmiar (worker wolniejszy od wątku głównego): najstarsze precz
        if (st.ovMap.size > 12) {
          let oldest = Infinity;
          for (const key of st.ovMap.keys()) if (key < oldest) oldest = key;
          st.ovMap.get(oldest).close();
          st.ovMap.delete(oldest);
        }
      } else if (m.type === 'stats') {
        report('stats', { rafN: W_STATE.rafN, frames: W_STATE.frames, idleRaf: W_STATE.idleRaf, errors: W_STATE.errors.slice(-5) });
      }
    } catch (err) {
      fail(err);
    }
  };
  self.addEventListener('error', (e) => fail(e.message || e));
  self.addEventListener('unhandledrejection', (e) => fail(e.reason));
}
