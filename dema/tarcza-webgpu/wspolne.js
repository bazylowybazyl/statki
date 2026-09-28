// ============================================================
// Wspólne kawałki dema tarczy: zegar, szumy 2D jako funkcje shadera,
// światła dynamiczne (pętla do 256 świateł jak w dema/laser-webgpu.html),
// barwy tarczy z gry i drobne narzędzia CPU.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, float, vec2, vec3, Loop, If, dot, fract, floor, mix, exp, max,
  saturate, length, normalize, cameraPosition
} from 'three/tsl';

// ---------------------------------------------------------------------------
// Zegar symulacji (sekundy) — wspólny dla shaderów i compute.

export const uTime = uniform(0);
export const uDt = uniform(1 / 60);

// ---------------------------------------------------------------------------
// Barwy tarczy — liczby z src/3d/shield3D.js (uColor, SHIELD_EMPTY_COLOR,
// SHIELD_BREAK_COLOR). Liniowe RGB, tak jak w shaderze gry.

export const SHIELD_FULL_COLOR = new THREE.Color('#5992f7');
export const SHIELD_EMPTY_COLOR = new THREE.Color(1.0, 0.08, 0.04);
export const SHIELD_BREAK_COLOR = new THREE.Color(1.0, 0.35, 0.22);
export const SHIELD_EDGE_COLOR = new THREE.Color('#7faaf5');

// Bloom gry (src/3d/bloomConfig.js, BLOOM_DEFAULTS) — punkt wyjścia.
export const BLOOM_GAME = { strength: 0.85, radius: 0.4, threshold: 0.9 };

// Barwa tarczy przy danym HP (lifeColor z shadera gry): pełne → #5992f7, puste → czerwień.
export function shieldLifeColor(life, out) {
  const k = life < 0 ? 0 : (life > 1 ? 1 : life);
  return out.copy(SHIELD_EMPTY_COLOR).lerp(SHIELD_FULL_COLOR, k);
}

// ---------------------------------------------------------------------------
// Szum 2D jako prawdziwe funkcje WGSL (setLayout) — mały kod, szybka kompilacja
// (pułapka §9.3: szumy MaterialX w wielu miejscach rozdmuchują shader).

export const hash22 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(vec2(p3.x.add(p3.y), p3.x.add(p3.z)).mul(p3.zy)).mul(2.0).sub(1.0);
}).setLayout({ name: 'hash22', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });

export const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const gnoise = Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const a = dot(hash22(i), f);
  const b = dot(hash22(i.add(vec2(1.0, 0.0))), f.sub(vec2(1.0, 0.0)));
  const c = dot(hash22(i.add(vec2(0.0, 1.0))), f.sub(vec2(0.0, 1.0)));
  const d = dot(hash22(i.add(vec2(1.0, 1.0))), f.sub(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.4);
}).setLayout({ name: 'gnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// fbm z obrotem między oktawami; wynik ~[−1, 1].
export const fbm = Fn(([p, oct]) => {
  const sum = float(0).toVar();
  const amp = float(0.5).toVar();
  const q = vec2(p).toVar();
  Loop({ start: 0, end: oct, type: 'int', condition: '<', name: 'o' }, () => {
    sum.addAssign(amp.mul(gnoise(q)));
    q.assign(vec2(q.x.mul(1.6).add(q.y.mul(1.2)), q.y.mul(1.6).sub(q.x.mul(1.2))).add(vec2(1.7, 9.2)));
    amp.mulAssign(0.5);
  });
  return sum;
}).setLayout({ name: 'fbm2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'oct', type: 'int' }] });

// ---------------------------------------------------------------------------
// Światła dynamiczne: trafienia, pociski, wiązka, rozbłyski. Pozycje w świecie 3D
// (x, −y gry, z), promień zasięgu, barwa·moc, skala spadku — jak w demie lasera.

export const MAX_LIGHTS = 256;
const lightPosArr = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4());
const lightColArr = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4());
export const uLightPos = uniformArray(lightPosArr, 'vec4');
export const uLightCol = uniformArray(lightColArr, 'vec4');
export const uLightCount = uniform(0, 'int');
export const uLightGain = uniform(1);     // suwak „moc świateł”
export const uLightsOn = uniform(1);      // przełącznik „światła” i tryb A/B

export const lights = {
  count: 0,
  reset() { this.count = 0; },
  push(x, y, z, radius, falloff, r, g, b) {
    if (this.count >= MAX_LIGHTS) return;
    lightPosArr[this.count].set(x, y, z, radius);
    lightColArr[this.count].set(r, g, b, falloff);
    this.count++;
  },
  commit() { uLightCount.value = this.count; }
};

// Światło na powierzchni: Lambert + połysk Blinna-Phonga, okno zasięgu
// (1 − (d/R)²)² razy 1 / (1 + (d/s)²). Dodawane jako emisja (przechodzi przez
// bloom i tone mapping). Wszystko, czego pętla używa, liczone PRZED nią
// (.toVar()) — pułapka §9.1 (wspólne węzły zbudowane w If → czarne bryły).
export const shotLight = Fn(([albedo, rough, metal, P, N]) => {
  const sum = vec3(0).toVar();
  const Pw = P.toVar();
  const Nw = N.toVar();
  const V = normalize(cameraPosition.sub(Pw)).toVar();
  const shin = exp(rough.oneMinus().mul(5.5)).mul(4.0).toVar();
  const f0 = mix(vec3(0.04), albedo, metal).toVar();
  const kd = albedo.mul(metal.oneMinus()).toVar();
  Loop(uLightCount, ({ i }) => {
    const lp = uLightPos.element(i);
    const lc = uLightCol.element(i);
    const Lv = lp.xyz.sub(Pw);
    const d = length(Lv);
    If(d.lessThan(lp.w), () => {
      const L = Lv.div(max(d, 0.001));
      const x = d.div(lp.w);
      const win = saturate(x.mul(x).oneMinus());
      const ds = d.div(lc.w);
      const att = win.mul(win).div(ds.mul(ds).add(1.0));
      const ndl = saturate(dot(Nw, L));
      const H = normalize(L.add(V));
      const ndh = max(dot(Nw, H), 0.0001);
      const spec = ndh.pow(shin).mul(shin.mul(0.03).add(0.4));
      sum.addAssign(lc.xyz.mul(att.mul(ndl)).mul(kd.add(f0.mul(spec))));
    });
  });
  return sum.mul(uLightGain.mul(uLightsOn));
});

// ---------------------------------------------------------------------------
// Narzędzia CPU

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Nie wczytano obrazu: ${url}`));
    img.src = url;
  });
}
