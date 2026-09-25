// src/3d/warpFx3D.js
//
// Efekty warpa „Fałda” — docs/BRIEF-warp.md §4. Na razie przylot (wyjście
// z warpa): zwiastun → rozdarcie szwu → wyrzut → zamknięcie → stygnięcie.
// Oś czasu liczy src/game/warpDrive.js; ten moduł tylko ją rysuje.
//
// Warstwy (co klatkę i tylko wtedy, gdy coś trwa):
//  - glify: JEDEN InstancedMesh (szew, poświata, smuga anamorficzna; rodzaje
//    pierścień i półksiężyc zostają w shaderze, ale fale są dziś wyłącznie
//    przezroczyste — bez świecącego obrysu) w passie ortho. Szew leży POD kadłubem (z < 0, test
//    głębi z kadłubem, który pisze głębię na z ≈ 0) — okręt wychodzi z niego;
//    błyski i fale nad kadłubem;
//  - smuga sylwetki: quad z teksturą sprite'a kadłuba rozmytą wzdłuż osi, pod
//    kadłubem (widać ją tylko za rufą). Prawdziwego kadłuba nie skalujemy —
//    mostek, wieżyczki 2D, światła i tarcza by się rozjechały;
//  - zgięcie tła: Core3D.pushWarpSpaceWorld (punkt, szew, fala) — tylko tło;
//  - drganie klatki: Core3D.pushWarpWaveWorld (pierścień, szew, łuk) i plama heat haze;
//  - cząstki: przepisy na pulach Fx3D (poświata, iskry, łuki) — bez własnych pul;
//  - żar kadłuba: kanał żaru heksów (shard.heat + heatStamp), bez nowego shadera.
//
// Pasma HDR (hdr-band-plan): rdzeń szwu i błysk 6–10 (jedyne źródła bloomu),
// barwa frakcji 0,4–1,3, poświata < 0,6; alfa = max(rgb), blend ONE/ONE.
// Shader: clamp varyingów (MSAA ekstrapoluje je poza trójkąt w HalfFloat),
// żadnego pow() z możliwie ujemną podstawą.
import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { Fx3D } from './fxParticles3D.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { WARP_SPACE_TYPE } from './warpLens3D.js';
import { createWarpArrival, sampleWarpArrival, WARP_ARRIVAL_SHAPE } from '../game/warpDrive.js';

// Barwy liniowe. core = rdzeń (HDR mnożony w shaderze), body = barwa frakcji
// w paśmie ciała, rim = obwódka/pierścienie, spark = iskry (HDR), heat = smuga.
export const WARP_FX_PALETTES = Object.freeze({
  atlas: Object.freeze({
    core: [1.0, 0.9, 1.0], body: [0.78, 0.1, 1.0], rim: [0.42, 0.52, 1.0],
    spark: [1.6, 0.8, 2.2], cool: [0.6, 1.0], heat: [1.0, 0.72, 1.0], dirty: false
  }),
  terran: Object.freeze({
    core: [0.92, 0.97, 1.0], body: [0.22, 0.58, 1.0], rim: [0.62, 0.86, 1.0],
    spark: [0.9, 1.5, 2.4], cool: [0.9, 1.0], heat: [0.8, 0.92, 1.0], dirty: false
  }),
  pirate: Object.freeze({
    core: [1.0, 0.88, 0.72], body: [1.0, 0.14, 0.05], rim: [1.0, 0.5, 0.12],
    spark: [2.4, 1.0, 0.35], cool: [0.35, 0.08], heat: [1.0, 0.6, 0.35], dirty: true
  })
});

const GLYPH = Object.freeze({ SEAM: 0, GLOW: 1, RING: 2, BOW: 3, GLARE: 4 });
const GLYPH_CAP = 192;
const SMEAR_POOL_CAP = 12;

// Warstwy do przełączania w demie (i do diagnozy w grze).
export const WARP_FX_LAYERS = {
  glyphs: true, smear: true, lens: true, waves: true, particles: true, heat: true
};

const GLYPH_VERT = /* glsl */`
  attribute vec4 iPos;    // x, y względem mesh.position (scena), z, —
  attribute vec4 iAxis;   // oś (scena), półdługość, półszerokość (świat)
  attribute vec4 iColA;   // rdzeń rgb, siła
  attribute vec4 iColB;   // barwa rgb, parametr (świat)
  attribute vec4 iParm;   // rodzaj, p1, p2, ziarno
  varying vec2 vLocal;
  varying vec2 vHalf;
  varying vec4 vColA;
  varying vec4 vColB;
  varying vec4 vParm;
  void main() {
    vLocal = position.xy * 2.0;
    vec2 ax = iAxis.xy;
    vec2 pp = vec2(-ax.y, ax.x);
    vec2 off = ax * (vLocal.x * iAxis.z) + pp * (vLocal.y * iAxis.w);
    vHalf = iAxis.zw;
    vColA = iColA;
    vColB = iColB;
    vParm = iParm;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos.xy + off, iPos.z, 1.0);
  }`;

const GLYPH_FRAG = /* glsl */`
  uniform float uTime;
  varying vec2 vLocal;
  varying vec2 vHalf;
  varying vec4 vColA;
  varying vec4 vColB;
  varying vec4 vParm;

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    // MSAA ekstrapoluje varyingi poza trójkąt — clamp, zanim cokolwiek policzymy.
    vec2 L = clamp(vLocal, -1.0, 1.0);
    vec2 H = max(vHalf, vec2(1e-3));
    float kind = vParm.x;
    float I = max(vColA.w, 0.0);
    vec3 col = vec3(0.0);

    if (kind < 0.5) {
      // SZEW: soczewkowata szczelina wzdłuż osi. p1 = półdługość szwu / półdługość
      // quada, p2 = otwarcie (0..1+), iColB.w = maks. połowa szerokości (świat).
      float hl = clamp(vParm.y, 1e-3, 1.0);
      float open = max(vParm.z, 0.0);
      float maxHW = max(vColB.w, 1e-3);
      float xs = L.x / hl;
      float yW = L.y * H.y;
      float prof = max(1.0 - xs * xs, 0.0);
      float hw = open * maxHW * pow(prof, 0.7);
      float d = abs(yW) - hw;
      float px = max(fwidth(yW), 1e-3);
      float inside = 1.0 - smoothstep(-px, px, d);
      // Wnętrze = „druga strona”: przygaszona barwa frakcji, przez którą płyną
      // jasne włókna WZDŁUŻ szwu (anizotropowy szum — smugi, nie dym).
      float yn = yW / max(hw, px);
      float fn = vnoise(vec2(xs * 9.0 - uTime * 7.0 + vParm.w, yn * 2.5));
      float fn2 = vnoise(vec2(xs * 23.0 - uTime * 11.0 + vParm.w * 1.7, yn * 6.0));
      float fil = smoothstep(0.55, 0.95, fn * 0.65 + fn2 * 0.35);
      // Rdzeń: cienka biała linia na osi — jedyne źródło bloomu szwu.
      float coreW = max(hw * 0.09, px * 0.75);
      float core = inside * exp(-(yW * yW) / (coreW * coreW)) * prof;
      // Brzeg rozcięcia: jasna, cienka krawędź.
      float rimW = max(maxHW * 0.16, px * 1.2);
      float rim = exp(-(d * d) / (rimW * rimW)) * step(0.001, open);
      // Poświata na zewnątrz: słaba, z aberracją (czerwień dalej, błękit bliżej)
      // i wygaszona przed brzegiem quada — inaczej widać prostokąt.
      float gd = max(d, 0.0);
      float glowW = maxHW * 1.1 + px;
      vec3 halo = vec3(exp(-gd / (glowW * 1.3)), exp(-gd / glowW), exp(-gd / (glowW * 0.8)));
      float edge = (1.0 - smoothstep(0.55, 1.0, abs(L.y))) * (1.0 - smoothstep(0.8, 1.0, abs(L.x)));
      float tip = sqrt(prof);
      float o1 = min(open, 1.0);
      // Pasma (próg bloomu gry 0,9): nad progiem TYLKO cienka linia rdzenia;
      // wnętrze, włókna i brzeg pod progiem — duża jasna powierzchnia rozlewa
      // bloom w białą plamę na pół ekranu.
      col = vColA.rgb * core * 2.2 * o1
          + vColB.rgb * inside * (0.22 + 0.75 * fil)
          + vColA.rgb * inside * fil * 0.22
          + mix(vColB.rgb, vColA.rgb, 0.15) * rim * 0.85 * tip
          + vColB.rgb * halo * 0.16 * tip;
      col *= I * edge;
    } else if (kind < 1.5) {
      // POŚWIATA: wąski rdzeń HDR (p1) + halo w barwie (p2).
      float r2 = dot(L, L);
      float core = exp(-r2 * 55.0);
      float halo = exp(-r2 * 5.5) * (1.0 - smoothstep(0.6, 1.0, sqrt(r2)));
      col = (vColA.rgb * core * vParm.y + vColB.rgb * halo * vParm.z) * I;
    } else if (kind < 2.5) {
      // PIERŚCIEŃ: promień iColB.w, szerokość p1 (świat), rozszczep barw.
      vec2 P = L * H;
      float r = length(P);
      float R = vColB.w;
      float w = max(vParm.y, 1e-3);
      float k = (r - R) / w;
      float kr = (r - R - w * 0.4) / w;
      float kb = (r - R + w * 0.4) / w;
      float band = exp(-k * k);
      // Delikatny rozszczep barw (pełny czytał się jak flara obiektywu).
      vec3 tri = mix(vec3(band), vec3(exp(-kr * kr), band, exp(-kb * kb)), 0.5);
      col = (vColB.rgb * tri + vColA.rgb * band * band * vParm.z) * I;
    } else if (kind < 3.5) {
      // FALA DZIOBOWA: półksiężyc przed okrętem (lokalne +x = kierunek lotu).
      vec2 P = L * H;
      float r = length(P);
      float cosA = P.x / max(r, 1e-3);
      float win = smoothstep(0.1, 0.7, cosA);
      float w = max(vParm.y, 1e-3) * (0.3 + 0.7 * win);
      float k = (r - vColB.w) / w;
      float band = exp(-k * k) * win;
      col = (vColB.rgb * band * 1.1 + vColA.rgb * band * band * vParm.z) * I;
    } else {
      // SMUGA ANAMORFICZNA wzdłuż osi + punktowy rdzeń.
      float s = exp(-L.x * L.x * 2.2) * exp(-L.y * L.y * 45.0);
      float c = exp(-dot(L, L) * 28.0);
      col = (vColA.rgb * (s * vParm.y + c * vParm.z) + vColB.rgb * s * 0.5) * I;
    }

    col = max(col, vec3(0.0));
    float a = max(col.r, max(col.g, col.b));
    if (a < 1e-4) discard;
    gl_FragColor = vec4(col, a);
  }`;

const SMEAR_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Quad zaczepiony w dziobie, sięga `uTotal` kadłubów w tył. Piksel w miejscu
// h (0 = rufa, 1 = dziób, w długościach kadłuba) zbiera sylwetkę z miejsc
// h + s, s ∈ [0, trail] — tam, gdzie kadłub BYŁ chwilę wcześniej.
const SMEAR_FRAG = /* glsl */`
  uniform sampler2D tSprite;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTotal;
  uniform float uTrail;
  varying vec2 vUv;
  void main() {
    vec2 uv = clamp(vUv, 0.0, 1.0);
    float h = 1.0 - (1.0 - uv.x) * uTotal;
    float acc = 0.0;
    float wsum = 0.0;
    // Roztrząsanie próbek per piksel — bez niego smuga to schodki kopii sylwetki.
    float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    for (int k = 0; k < 24; k++) {
      float f = (float(k) + jit) / 24.0;
      float w = (1.0 - f) * (1.0 - f) + 0.08;
      float hu = h + f * uTrail;
      float inside = step(0.0, hu) * step(hu, 1.0);
      float a = texture2D(tSprite, vec2(clamp(hu, 0.0, 1.0), uv.y)).a * inside;
      acc += a * w;
      wsum += w;
    }
    float m = acc / max(wsum, 1e-4);
    // Jaśniej tuż za rufą, gaśnie ku końcowi smugi.
    float tail = clamp((h + uTrail) / max(uTrail, 1e-3), 0.0, 1.0);
    vec3 col = uColor * (m * uIntensity * (0.35 + 0.65 * tail));
    float a2 = max(col.r, max(col.g, col.b));
    if (a2 < 1e-4) discard;
    gl_FragColor = vec4(col, a2);
  }`;

const _origin = { x: 0, y: 0 };
const _sample = {};
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _sparkCol = [1, 1, 1];
const _spriteTextures = new WeakMap();

function frand(a, b) { return a + Math.random() * (b - a); }
function clamp01(v) { return v <= 0 ? 0 : (v >= 1 ? 1 : v); }
function easeOutCubic(v) { const t = 1 - clamp01(v); return 1 - t * t * t; }

function spriteTexture(img) {
  if (!img) return null;
  let tex = _spriteTextures.get(img);
  if (!tex) {
    tex = new THREE.Texture(img);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    _spriteTextures.set(img, tex);
  }
  return tex;
}

class GlyphBatch {
  constructor(scene) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    this.bufs = {};
    for (const name of ['iPos', 'iAxis', 'iColA', 'iColB', 'iParm']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(GLYPH_CAP * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      this.bufs[name] = a;
    }
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: GLYPH_VERT,
      fragmentShader: GLYPH_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
    this.mesh.name = 'WARP_FX_GLYPHS';
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;
  }

  begin(time) {
    this.count = 0;
    sceneOriginNearCamera(_origin);
    this.mesh.position.set(_origin.x, _origin.y, 0);
    this.mat.uniforms.uTime.value = time % 600;
  }

  // (gx, gy) i kąt w świecie gry (y w dół); długości w jednostkach świata.
  push(kind, gx, gy, z, angle, halfAlong, halfAcross, core, I, body, param, p1, p2, seed) {
    if (this.count >= GLYPH_CAP || !(I > 1e-4)) return;
    const o = this.count * 4;
    const b = this.bufs;
    b.iPos.array[o] = gx - _origin.x;
    b.iPos.array[o + 1] = -gy - _origin.y;
    b.iPos.array[o + 2] = z;
    b.iPos.array[o + 3] = 0;
    b.iAxis.array[o] = Math.cos(angle);
    b.iAxis.array[o + 1] = -Math.sin(angle);
    b.iAxis.array[o + 2] = halfAlong;
    b.iAxis.array[o + 3] = halfAcross;
    b.iColA.array[o] = core[0]; b.iColA.array[o + 1] = core[1]; b.iColA.array[o + 2] = core[2];
    b.iColA.array[o + 3] = I;
    b.iColB.array[o] = body[0]; b.iColB.array[o + 1] = body[1]; b.iColB.array[o + 2] = body[2];
    b.iColB.array[o + 3] = param;
    b.iParm.array[o] = kind; b.iParm.array[o + 1] = p1; b.iParm.array[o + 2] = p2; b.iParm.array[o + 3] = seed;
    this.count++;
  }

  end() {
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0 && WARP_FX_LAYERS.glyphs !== false;
    if (n > 0) for (const k in this.bufs) this.bufs[k].needsUpdate = true;
  }
}

class SmearMesh {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(-0.5, 0, 0);   // x ∈ [−1, 0]: zaczep w dziobie, smuga w tył
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tSprite: { value: null },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 0 },
        uTotal: { value: 1 },
        uTrail: { value: 0.5 }
      },
      vertexShader: SMEAR_VERT,
      fragmentShader: SMEAR_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 59;
    this.mesh.name = 'WARP_FX_SMEAR';
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.busy = false;
  }
}

export const WarpFx3D = {
  time: 0,
  arrivals: [],
  glyphs: null,
  smears: [],
  stats: { arrivals: 0, glyphs: 0, smears: 0, lens: 0, waves: 0 },
  // Wstrząs kamery (mag, czas) — ustawia gra/demo.
  onShake: null,

  ensure() {
    if (this.glyphs) return true;
    if (!Core3D.isInitialized || !Core3D.scene) return false;
    this.glyphs = new GlyphBatch(Core3D.scene);
    return true;
  },

  /**
   * Przylot okrętu. (x, y, angle) = miejsce i kurs w świecie gry, w którym
   * okręt STANIE; wyłania się za tym miejscem i wysuwa do przodu.
   * o: { x, y, angle, hullLength, hullWidth, palette, entity, sprite, delay,
   *      heraldExtra, onBurst(arrival), onSettled(arrival), heatHull }
   */
  spawnArrival(o = {}) {
    if (!this.ensure()) return null;
    const startTime = this.time + Math.max(0, Number(o.delay) || 0);
    // burstOnly: sam wyrzut (błysk, fale, iskry, żar) w chwili startTime —
    // okręt już jest w świecie (wyjście gracza z lotu-ducha, skok w warp).
    const burstOnly = o.burstOnly === true;
    let a = createWarpArrival({ ...o, startTime });
    if (burstOnly) {
      const lead = a.tBurst - a.t0;
      a = createWarpArrival({ ...o, startTime: startTime - lead });
      a.emergeDist = 0;
    }
    a.burstOnly = burstOnly;
    a.pal = WARP_FX_PALETTES[a.palette] || WARP_FX_PALETTES.terran;
    a.sprite = o.sprite || null;
    a.onBurst = typeof o.onBurst === 'function' ? o.onBurst : null;
    a.onSettled = typeof o.onSettled === 'function' ? o.onSettled : null;
    a.heatHull = o.heatHull !== false;
    a.seed = Math.random() * 100;
    a.sample = {};
    a.smear = null;
    a.moteAcc = 0;
    a.arcAcc = 0;
    // Miejsce szwu: okręt wyłania się emergeDist za pozycją końcową, szew
    // sięga odrobinę dalej w tył (za rufę zostaje jego zasklepiająca się część).
    const back = a.emergeDist + a.hullLength * 0.1;
    a.sx = a.x - a.dirX * back;
    a.sy = a.y - a.dirY * back;
    // Ujście: dziób okrętu w chwili wyrzutu — tu błysk, iskry, fala.
    const mouth = burstOnly ? 0 : a.hullLength * 0.5 - a.emergeDist;
    a.mx = a.x + a.dirX * mouth;
    a.my = a.y + a.dirY * mouth;
    this.arrivals.push(a);
    return a;
  },

  clear() {
    for (const a of this.arrivals) this._releaseSmear(a);
    this.arrivals.length = 0;
  },

  _acquireSmear() {
    for (const s of this.smears) if (!s.busy) { s.busy = true; return s; }
    if (this.smears.length >= SMEAR_POOL_CAP || !Core3D.scene) return null;
    const s = new SmearMesh(Core3D.scene);
    s.busy = true;
    this.smears.push(s);
    return s;
  },

  _releaseSmear(a) {
    if (!a.smear) return;
    a.smear.busy = false;
    a.smear.mesh.visible = false;
    a.smear = null;
  },

  /** Co klatkę PRZED Core3D.render (drawHexShips3D). dt w sekundach gry. */
  update(dt) {
    if (!this.glyphs) return;
    const step = Math.min(Math.max(0, Number(dt) || 0), 0.1);
    this.time += step;
    const t = this.time;
    const g = this.glyphs;
    g.begin(t);
    let lens = 0;
    let waves = 0;
    let smears = 0;
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      const a = this.arrivals[i];
      const s = sampleWarpArrival(a, t, a.sample);
      if (s.phase === 'done') {
        this._releaseSmear(a);
        this.arrivals.splice(i, 1);
        continue;
      }
      if (s.phase === 'wait') continue;
      const r = this._drawArrival(a, s, t, step);
      lens += r.lens;
      waves += r.waves;
      if (a.smear?.mesh.visible) smears++;
    }
    g.end();
    this.stats.arrivals = this.arrivals.length;
    this.stats.glyphs = g.count;
    this.stats.smears = smears;
    this.stats.lens = lens;
    this.stats.waves = waves;
  },

  _drawArrival(a, s, t, dt) {
    const g = this.glyphs;
    const pal = a.pal;
    const H = a.hullLength;
    const ang = a.angle;
    const out = { lens: 0, waves: 0 };
    // Tani napęd piratów: szew migocze.
    const dirty = pal.dirty ? (0.72 + 0.28 * Math.sin(t * 37 + a.seed) * Math.sin(t * 13.3 + a.seed * 2.1)) : 1;

    // --- zwiastun: przestrzeń drga w punkcie wyjścia -----------------------
    if (s.herald > 0.001 && !a.burstOnly) {
      const hR = H * WARP_ARRIVAL_SHAPE.heraldRadius * (0.45 + 0.55 * s.herald);
      const pulse = 0.85 + 0.15 * Math.sin(t * 9 + a.seed);
      // Punkt, w którym przestrzeń się zbiera: mały rdzeń HDR, wąskie halo —
      // nie „gwiazda”. Świecących okręgów NIE ma (user: za dużo, psuły efekt).
      const pR = H * 0.24;
      g.push(GLYPH.GLOW, a.sx, a.sy, 6, ang, pR, pR, pal.core, 0.8 * s.herald * pulse * dirty, pal.body, 0, 3.2 * s.herald, 0.3, a.seed);
      // Jedna przezroczysta fala zgięcia zaciska się na punkcie wyjścia
      // („przestrzeń jest zbierana”) — samo zakrzywienie, bez obrysu. Tylko
      // większe okręty: przy flocie slotów fal jest mało, a przy fregacie i tak
      // jej nie widać.
      if (WARP_FX_LAYERS.waves && a.sizeScale >= 0.6) {
        const period = 0.7 - 0.2 * s.herald;
        const ph = ((t - a.t0) / period) % 1;
        const ringR = H * (1.6 - 1.3 * ph * ph);
        const env = Math.min(1, ph * 4) * (1 - ph);
        if (Core3D.pushWarpWaveWorld(0, a.sx, a.sy, ringR, H * 0.09, H * 0.02 * s.herald * env, 0)) out.waves++;
      }
      if (WARP_FX_LAYERS.lens) {
        if (Core3D.pushWarpSpaceWorld(WARP_SPACE_TYPE.POINT, a.sx, a.sy, ang, hR * 1.6, hR * 1.3, 0.42 * s.herald)) out.lens++;
      }
      if (WARP_FX_LAYERS.waves) {
        Core3D.pushHeatHazeWorld?.(a.sx, -a.sy, -4, H * 0.45, 0.9 * s.herald);
      }
      if (WARP_FX_LAYERS.particles && Fx3D.ensure()) this._heraldMotes(a, s, dt);
    }

    // --- szew -------------------------------------------------------------
    if (!a.burstOnly && s.seamLen > 0.002 && (s.seamOpen > 0.001 || s.phase === 'herald')) {
      const halfLen = a.seamLength * 0.5 * s.seamLen;
      const quadAlong = halfLen * 1.12 + a.seamHalfWidth * 2.0;
      const quadAcross = a.seamHalfWidth * (1.2 + 3.5 * Math.max(s.seamOpen, 0.15)) + H * 0.02;
      const hlFrac = Math.min(1, halfLen / quadAlong);
      // W zwiastunie szew to jeszcze jasna kreska: minimalne otwarcie.
      const open = Math.max(s.seamOpen, s.phase === 'herald' ? 0.06 : 0);
      g.push(GLYPH.SEAM, a.sx, a.sy, -4, ang, quadAlong, quadAcross, pal.core, dirty, pal.body, a.seamHalfWidth, hlFrac, open, a.seed);
      if (WARP_FX_LAYERS.lens && open > 0.01) {
        const width = Math.max(a.seamHalfWidth * 5.5, H * 0.08) * Math.min(1, open);
        if (Core3D.pushWarpSpaceWorld(WARP_SPACE_TYPE.SEAM, a.sx, a.sy, ang, halfLen * 1.05, width, 0.55 * Math.min(1, open))) out.lens++;
      }
      if (WARP_FX_LAYERS.waves && open > 0.05) {
        if (Core3D.pushWarpWaveWorld(1, a.sx, a.sy, halfLen, a.seamHalfWidth * 2.5 + H * 0.02, H * 0.005 * Math.min(1, open), ang)) out.waves++;
      }
      if (WARP_FX_LAYERS.particles && open > 0.25 && Fx3D.ensure()) this._seamArcs(a, s, halfLen, dt);
    }

    // --- wyrzut: zdarzenie jednorazowe -------------------------------------
    if (s.shipVisible && !a.fired.burst) {
      a.fired.burst = true;
      this._onBurst(a);
    }
    if (s.phase === 'cool' && !a.fired.settled) {
      a.fired.settled = true;
      if (a.onSettled) a.onSettled(a);
    }

    // --- błysk w ujściu -----------------------------------------------------
    if (s.flash > 0.004) {
      // Błysk POD kadłubem (z < 0): okręt wychodzi podświetlony od tyłu —
      // sylwetka na tle rozbłysku zamiast białej kropki na poszyciu.
      const fR = H * 0.62;
      g.push(GLYPH.GLOW, a.mx, a.my, -2, ang, fR, fR, pal.core, s.flash, pal.body, 0, 7.0, 0.55, a.seed);
      g.push(GLYPH.GLARE, a.mx, a.my, 31, ang, H * 1.4, H * 0.05, pal.core, s.flash, pal.rim, 0, 2.5, 2.5, a.seed);
    }

    // --- fala pierścieniowa ---------------------------------------------------
    if (s.ringT >= 0 && s.ringT < 1) {
      // Sama przezroczysta fala zakrzywienia — bez świecącego obramowania
      // (user: „wystarczy środek efektu”). Tło i kadłuby w paśmie fali drgają.
      const fade = (1 - s.ringT) * (1 - s.ringT);
      const R = H * (0.2 + WARP_ARRIVAL_SHAPE.ringRadius * easeOutCubic(s.ringT));
      if (WARP_FX_LAYERS.lens) {
        if (Core3D.pushWarpSpaceWorld(WARP_SPACE_TYPE.RING, a.mx, a.my, 0, R, H * 0.18, H * 0.11 * fade)) out.lens++;
      }
      if (WARP_FX_LAYERS.waves) {
        if (Core3D.pushWarpWaveWorld(0, a.mx, a.my, R, H * 0.13, H * 0.06 * fade, 0)) out.waves++;
      }
    }

    // --- fala dziobowa: odrywa się od hamującego okrętu i biegnie przodem ----
    if (s.bowT >= 0 && s.bowT < 1) {
      const fade = Math.pow(1 - s.bowT, 1.5);
      const lead = H * (0.5 + WARP_ARRIVAL_SHAPE.bowReach * easeOutCubic(s.bowT));
      const cx = a.x + a.dirX * (s.shipOffset + lead - H * 0.35);
      const cy = a.y + a.dirY * (s.shipOffset + lead - H * 0.35);
      const R = H * (0.35 + 0.45 * s.bowT);
      // Też bez obrysu: przezroczysty łuk zgięcia przed dziobem (fala typu 2).
      if (WARP_FX_LAYERS.waves) {
        if (Core3D.pushWarpWaveWorld(2, cx, cy, R, H * 0.07, H * 0.035 * fade, ang)) out.waves++;
      }
    }

    // --- smuga sylwetki -------------------------------------------------------
    this._drawSmear(a, s);
    return out;
  },

  _heraldMotes(a, s, dt) {
    const H = a.hullLength;
    a.moteAcc += dt * (18 + 30 * a.sizeScale) * s.herald;
    const col = a.pal.body;
    const rim = a.pal.rim;
    while (a.moteAcc >= 1) {
      a.moteAcc -= 1;
      // Światło ściągane do punktu wyjścia: krótkie smugi lecące DO środka.
      {
        const ang = Math.random() * Math.PI * 2;
        const r = H * frand(0.7, 1.8);
        const life = frand(0.3, 0.55);
        const sp = r / life;
        _v1.set(a.sx + Math.cos(ang) * r, -(a.sy + Math.sin(ang) * r), 9);
        _v2.set(-Math.cos(ang) * sp, Math.sin(ang) * sp, 0);
        _sparkCol[0] = rim[0] * 1.8; _sparkCol[1] = rim[1] * 1.8; _sparkCol[2] = rim[2] * 1.8;
        Fx3D.spark.spawn(_v1, _v2, life, 0, H * frand(0.06, 0.16), _sparkCol, 1, 1);
      }
      const ang = Math.random() * Math.PI * 2;
      const r = H * frand(0.6, 1.5);
      const life = frand(0.45, 0.85);
      const px = a.sx + Math.cos(ang) * r;
      const py = a.sy + Math.sin(ang) * r;
      const sp = r / life * 0.95;
      const size = H * frand(0.01, 0.026);
      // Pył pod progiem bloomu: dużo drobinek zbiega się w jeden punkt, a suma
      // addytywna w środku i tak przekroczy próg.
      const k = frand(0.45, 0.9);
      Fx3D.glow.spawn({
        x: px, y: -py, z: 8,
        vx: -Math.cos(ang) * sp, vy: Math.sin(ang) * sp, vz: 0,
        life, drag: 0.4,
        s0: size, s1: size * 0.35, rot: 0, vrot: 0,
        r0: col[0] * k, g0: col[1] * k, b0: col[2] * k,
        r1: 1.2, g1: 1.2, b1: 1.2, mix: 1.2,
        alpha: 0.6, fadeIn: 0.25, fadeOut: 1.0, grow: 1.0
      });
    }
  },

  _seamArcs(a, s, halfLen, dt) {
    a.arcAcc += dt * (a.pal.dirty ? 55 : 28) * s.seamOpen;
    const c = a.pal.spark;
    const ax = a.dirX;
    const ay = a.dirY;
    const hw = a.seamHalfWidth * Math.min(1, s.seamOpen);
    while (a.arcAcc >= 1) {
      a.arcAcc -= 1;
      const along = frand(-0.8, 0.8) * halfLen;
      const across = hw * frand(1.1, 2.4);
      const bx = a.sx + ax * along;
      const by = a.sy + ay * along;
      const skew = frand(-0.3, 0.3) * hw;
      _v1.set(bx - ay * across + ax * skew, -(by + ax * across + ay * skew), 12);
      _v2.set(bx + ay * across - ax * skew, -(by - ax * across - ay * skew), 12);
      Fx3D.arcs.spawn(_v1, _v2, frand(0.06, 0.16), hw * frand(0.4, 0.9), c);
    }
  },

  _onBurst(a) {
    const H = a.hullLength;
    if (this.onShake) this.onShake(a.sizeScale, a.hullLength);
    if (WARP_FX_LAYERS.heat && a.heatHull) heatHullForWarp(a.entity);
    if (WARP_FX_LAYERS.particles && Fx3D.ensure()) {
      const pal = a.pal;
      const n = Math.round((pal.dirty ? 90 : 55) * (0.4 + 0.6 * a.sizeScale));
      for (let i = 0; i < n; i++) {
        const spread = frand(-0.6, 0.6) * (Math.random() < 0.25 ? 2.2 : 1);
        const ca = Math.cos(a.angle + spread);
        const sa = Math.sin(a.angle + spread);
        const sp = H * frand(0.8, 2.6);
        _v1.set(a.mx + a.dirX * H * frand(0, 0.1), -(a.my + a.dirY * H * frand(0, 0.1)), 14);
        _v2.set(ca * sp, -sa * sp, 0);
        Fx3D.spark.spawn(_v1, _v2, frand(0.45, 1.1), frand(1.2, 2.4), H * frand(0.05, 0.14), pal.spark, pal.cool[0], pal.cool[1]);
      }
      // Kłąb zjonizowanej poświaty wyrzucony do przodu.
      for (let i = 0; i < 10; i++) {
        const sp = H * frand(0.3, 1.1);
        const spread = frand(-0.45, 0.45);
        const ca = Math.cos(a.angle + spread);
        const sa = Math.sin(a.angle + spread);
        const size = H * frand(0.25, 0.5);
        const b = pal.body;
        Fx3D.glow.spawn({
          x: a.mx, y: -a.my, z: 16,
          vx: ca * sp, vy: -sa * sp, vz: 0,
          life: frand(0.5, 0.9), drag: 2.2,
          s0: size * 0.4, s1: size, rot: 0, vrot: 0,
          r0: b[0] * 1.3, g0: b[1] * 1.3, b0: b[2] * 1.3,
          r1: b[0] * 0.4, g1: b[1] * 0.4, b1: b[2] * 0.4, mix: 2.0,
          alpha: 0.7, fadeIn: 0.05, fadeOut: 1.4, grow: 0.6
        });
      }
    }
    if (a.onBurst) a.onBurst(a);
  },

  _drawSmear(a, s) {
    if (!(s.smear > 0.01) || !a.sprite || WARP_FX_LAYERS.smear === false) {
      if (a.smear) this._releaseSmear(a);
      return;
    }
    if (!a.smear) {
      a.smear = this._acquireSmear();
      if (!a.smear) return;
      a.smear.mat.uniforms.tSprite.value = spriteTexture(a.sprite);
      const c = a.pal.heat;
      a.smear.mat.uniforms.uColor.value.setRGB(c[0], c[1], c[2]);
    }
    const H = a.hullLength;
    // Długość smugi: droga z ostatnich ~0,14 s + ogon do szwu przy wyrzucie.
    const trail = Math.min(2.5, (s.shipSpeed * 0.14) / H + 0.45 * s.smear);
    const total = 1 + trail;
    const u = a.smear.mat.uniforms;
    u.uTrail.value = trail;
    u.uTotal.value = total;
    u.uIntensity.value = 1.5 * s.smear;
    const bx = a.x + a.dirX * (s.shipOffset + H * 0.5);
    const by = a.y + a.dirY * (s.shipOffset + H * 0.5);
    const m = a.smear.mesh;
    m.position.set(bx, -by, -3);
    m.rotation.set(0, 0, -a.angle);
    m.scale.set(H * total, a.hullWidth, 1);
    m.visible = true;
  }
};

/**
 * Żar kadłuba po wyjściu z warpa: brzeg (heks z brakującym sąsiadem) biały,
 * wnętrze ciepłe. Kanał żaru heksów gaśnie sam (heatDecay): biel ~1 s,
 * pomarańcz ~2,3 s, wiśnia ~5 s. Baza czasu = performance.now() (jak renderer).
 */
export function heatHullForWarp(entity, edge = 0.85, interior = 0) {
  const grid = entity?.hexGrid;
  const shards = grid?.shards;
  if (!Array.isArray(shards) || shards.length === 0) return 0;
  const nowSec = performance.now() * 0.001;
  let n = 0;
  for (let i = 0; i < shards.length; i++) {
    const sh = shards[i];
    if (!sh || !sh.active || sh.isDebris) continue;
    let live = 0;
    const nb = sh.neighbors;
    if (Array.isArray(nb)) for (let k = 0; k < nb.length; k++) if (nb[k]?.active) live++;
    const v = live < 6 ? edge : interior;
    if (v > 0 && (Number(sh.heat) || 0) < v) {
      sh.heat = v > 1 ? 1 : v;
      sh.heatStamp = nowSec;
      n++;
    }
  }
  if (n > 0) {
    grid.meshDirty = true;
    grid.meshDirtyAll = true;
  }
  return n;
}
