// Lakier kadłubów: odbicie kosmosu i odblask słońca na kadłubach heksowych.
//
// Dlaczego tak, a nie envMap z three: kamera gry jest ortogonalna i patrzy
// z góry, a sprite'y nie mają normalnych. Płaska płyta odbijałaby jeden punkt
// nieba (jednolity odcień zamiast połysku), a słońce — leżące praktycznie na
// horyzoncie (uLightDir = (dx, dy, 600)) — nie odbiłoby się nigdy: lustrzany
// odblask wymaga nachylenia ~45° ku słońcu, a „poduszka” z hexShips3D daje
// najwyżej ~25–32°. Stąd trzy elementy:
//  - MAPA KSZTAŁTU z alfy sprite'a, pieczona raz na obraz: duże rozmycie alfy
//    to zaokrąglony przekrój kadłuba, normalne liczone z jego gradientu.
//    Kanał B = waga lakieru, która gaśnie do zera przy sylwetce — jasna
//    obwódka czytała się jak włączona tarcza (tarcze są dziś niewidoczne,
//    a tarcza-obrys świeci właśnie wzdłuż sylwetki);
//  - OTOCZENIE = mgławica gry + rzadkie gwiazdy HDR (kanał alfa) w podwójnej
//    paraboloidzie: zenit w środku tekstury, horyzont na okręgu;
//  - WSPÓLNE UNIFORMY: ten sam obiekt siedzi we wszystkich materiałach
//    kadłubów, więc strojenie to kilka przypisań na klatkę, bez pętli po statkach.
// Shader: HEX_FRAGMENT_SHADER w hexShips3D.js (blok „LAKIER”).
import * as THREE from 'three';

export const HULL_LACQUER_DEFAULTS = Object.freeze({
  enabled: true,
  strength: 1.0,       // mnożnik całej warstwy
  f0: 0.05,            // Fresnel lakieru przy patrzeniu na wprost
  nebGain: 10.0,       // wzmocnienie mgławicy w odbiciu (liniowo)
  nebClamp: 0.9,       // sufit odbicia mgławicy — pod progiem bloomu (0,9)
  starMax: 40.0,       // HDR najjaśniejszej gwiazdy w odbiciu
  sunRadiance: 150.0,  // słońce w odbiciu; × Fresnel ≈ 7 → bloom
  glintExp: 1500.0,    // ostrość odblasku słońca
  sheen: 3.0,          // miękki połysk wokół odblasku
  sheenExp: 60.0,
  metalSheen: 0.6,     // rozmyte odbicie barwione albedo (metal pod lakierem)
  envBlurLod: 3.0,     // poziom mip otoczenia dla odbicia metalicznego
  wreckMul: 0.35,      // wraki i fragmenty — przypalone, prawie matowe
  engineZoneMul: 1.0,  // rozmiar stref silników bez lakieru
  glintMinPx: 12,      // promień kadłuba na ekranie, poniżej którego odblask gaśnie
  glintFullPx: 40      // ... i od którego świeci w pełni (flota = nie brokat)
});

// Parametry mapy kształtu, w ułamkach krótszego boku sprite'a.
export const SHAPE_MAP_DEFAULTS = Object.freeze({
  maxSide: 384,        // mapa jest gładka — więcej nie trzeba
  curveSigma: 0.2,     // promień zaokrąglenia przekroju
  curveTiltDeg: 40,    // nachylenie przekroju przy sylwetce
  edgeFadeSigma: 0.012,
  edgeFadeLo: 0.55,    // waga lakieru = smoothstep(lo, hi, alfa rozmyta)
  edgeFadeHi: 0.92
});

export const ENV_MAP_SIZE = 1024;
export const MAX_ENGINE_ZONES = 20;

const DEG = Math.PI / 180;
// Maksimum gradientu rozmytej krawędzi = 1 / (sigma * sqrt(2π)).
const EDGE_GAIN = 0.3989423;
const NEBULA_PROBE_MS = 1000;

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : (n > max ? max : n);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

// Rozmycie pudełkowe w dwóch osiach, poza obrazem zera. Trzy przejścia dają
// prawie-gaussa o zadanej sigmie przy koszcie niezależnym od promienia —
// przy sigmie ~60 tekseli splot bezpośredni kosztowałby setki próbek na teksel.
function boxBlurPass(src, dst, w, h, r, stride, lineCount, lineStep, length) {
  const norm = 1 / (2 * r + 1);
  for (let line = 0; line < lineCount; line++) {
    const base = line * lineStep;
    let acc = 0;
    for (let k = 0; k <= r && k < length; k++) acc += src[base + k * stride];
    for (let k = 0; k < length; k++) {
      dst[base + k * stride] = acc * norm;
      const add = k + r + 1;
      const sub = k - r;
      if (add < length) acc += src[base + add * stride];
      if (sub >= 0) acc -= src[base + sub * stride];
    }
  }
}

export function boxBlur3(src, w, h, sigma) {
  const out = Float32Array.from(src);
  if (!(sigma > 0)) return out;
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) * 0.5));
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurPass(out, tmp, w, h, r, 1, h, w, w);   // wiersze
    boxBlurPass(tmp, out, w, h, r, w, w, 1, h);   // kolumny
  }
  return out;
}

// Mapa kształtu z alfy sprite'a. Wynik: RGBA float na teksel —
// R,G = normalna XY w układzie sprite'a (x = dziób, y W GÓRĘ obrazu, tak jak
// „poduszka” w shaderze), B = waga lakieru (0 przy sylwetce), A = 1.
export function bakeHullShapeField(alpha, w, h, options = {}) {
  const o = { ...SHAPE_MAP_DEFAULTS, ...options };
  const ref = Math.max(1, Math.min(w, h));
  const curveSigma = Math.max(1, o.curveSigma * ref);
  const edgeSigma = Math.max(0.5, o.edgeFadeSigma * ref);
  const curved = boxBlur3(alpha, w, h, curveSigma);
  const edge = boxBlur3(alpha, w, h, edgeSigma);
  const heightScale = Math.tan(o.curveTiltDeg * DEG) * curveSigma / EDGE_GAIN;
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : y;
    const yd = y < h - 1 ? y + 1 : y;
    const dy = Math.max(1, yd - yu);
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      const dx = Math.max(1, xr - xl);
      const row = y * w;
      const dhdx = (curved[row + xr] - curved[row + xl]) / dx * heightScale;
      const dhdyImg = (curved[yd * w + x] - curved[yu * w + x]) / dy * heightScale;
      let nx = -dhdx;
      let ny = dhdyImg; // obraz rośnie w dół, normalna ma y w górę
      const inv = 1 / Math.hypot(nx, ny, 1);
      nx *= inv;
      ny *= inv;
      const i = (row + x) * 4;
      out[i] = nx;
      out[i + 1] = ny;
      out[i + 2] = smoothstep(o.edgeFadeLo, o.edgeFadeHi, edge[row + x]);
      out[i + 3] = 1;
    }
  }
  return out;
}

// Strefy bez lakieru wokół dysz, w pikselach siatki (ta sama przestrzeń co
// `fragPx` w shaderze i pozycje świateł w shipLightRuntime: offset z edytora
// × __hardpointScale + środek + pivot). Promień = połowa odstępu do najbliższej
// dyszy, przycięta do 2–9% krótszego boku; środek wsunięty w kadłub wzdłuż
// `forward` (dla dysz edytora wskazuje w głąb kadłuba).
export function computeEngineZones(mainThrusters, sideThrusters, grid, options = {}) {
  const zoneMul = clampNum(options.engineZoneMul, 0, 4, 1);
  const width = Math.max(1, Number(grid?.srcWidth) || 1);
  const height = Math.max(1, Number(grid?.srcHeight) || 1);
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  const ref = Math.min(width, height);
  const zones = [];
  if (!(zoneMul > 0)) return zones;
  const lists = [mainThrusters, sideThrusters];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (zones.length >= MAX_ENGINE_ZONES) break;
      const ox = Number(t?.offset?.x);
      const oy = Number(t?.offset?.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const fx = Number(t?.forward?.x) || 0;
      const fy = Number(t?.forward?.y) || 0;
      const fl = Math.hypot(fx, fy);
      zones.push({
        x: ox + width * 0.5 + pivotX,
        y: oy + height * 0.5 + pivotY,
        fx: fl > 1e-6 ? fx / fl : 0,
        fy: fl > 1e-6 ? fy / fl : 0,
        r: 0
      });
    }
  }
  const rMin = ref * 0.02;
  const rMax = ref * 0.09;
  for (let i = 0; i < zones.length; i++) {
    let nearest = Infinity;
    for (let j = 0; j < zones.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(zones[i].x - zones[j].x, zones[i].y - zones[j].y);
      if (d > 1e-3 && d < nearest) nearest = d;
    }
    const base = Number.isFinite(nearest) ? nearest * 0.5 : ref * 0.05;
    const r = Math.min(rMax, Math.max(rMin, base)) * zoneMul;
    zones[i].r = r;
    zones[i].x += zones[i].fx * r * 0.4;
    zones[i].y += zones[i].fy * r * 0.4;
  }
  return zones;
}

// Piksele otoczenia (RGBA8): RGB = bajty sRGB mgławicy (albo proceduralne
// tło, dopóki mgławica się nie wczyta), A = gwiazdy (HDR = A × starMax
// w shaderze). Gwiazdy deterministyczne — ta sama mapa przy każdym starcie.
export function buildLacquerEnvPixels(srcRGBA, size, options = {}) {
  const starCount = Math.max(0, Math.round(clampNum(options.starCount, 0, 5000, 450)));
  const starMin = clampNum(options.starMin, 0, 100, 1.0);
  const starSlope = clampNum(options.starSlope, 0.2, 10, 1.3);
  const starMax = clampNum(options.starMax, 1, 1000, HULL_LACQUER_DEFAULTS.starMax);
  const sigma = clampNum(options.starSigmaPx, 0.3, 4, 0.8);
  const px = new Uint8Array(size * size * 4);
  const half = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (srcRGBA) {
        px[i] = srcRGBA[i];
        px[i + 1] = srcRGBA[i + 1];
        px[i + 2] = srcRGBA[i + 2];
      } else {
        // Ciemny granat, przy horyzoncie odrobinę turkusu — paleta mgławicy.
        const r = Math.min(1, Math.hypot(x - half, y - half) / half);
        const t = r * r;
        px[i] = Math.round(7 + 7 * t);
        px[i + 1] = Math.round(14 + 20 * t);
        px[i + 2] = Math.round(24 + 24 * t);
      }
      px[i + 3] = 0;
    }
  }
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const reach = Math.ceil(sigma * 3);
  const radius = half * 0.98;
  for (let s = 0; s < starCount; s++) {
    const ang = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd()) * radius;
    const cx = half + Math.cos(ang) * rad;
    const cy = half + Math.sin(ang) * rad;
    const amp = Math.min(starMax, starMin * Math.pow(1 - rnd(), -1 / starSlope));
    const a = amp / starMax;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(size - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(size - 1, Math.ceil(cy + reach));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const g = Math.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma * sigma));
        const i = (yy * size + xx) * 4 + 3;
        px[i] = Math.min(255, px[i] + Math.round(g * a * 255));
      }
    }
  }
  return px;
}

// ── Runtime (przeglądarka) ─────────────────────────────────────────────────

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function imageSize(image) {
  const w = Number(image?.naturalWidth || image?.videoWidth || image?.width) || 0;
  const h = Number(image?.naturalHeight || image?.videoHeight || image?.height) || 0;
  return { w, h };
}

function isImageReady(image) {
  if (!image) return false;
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && !image.complete) return false;
  const { w, h } = imageSize(image);
  return w > 0 && h > 0;
}

function toHalfFloatData(floats) {
  const out = new Uint16Array(floats.length);
  for (let i = 0; i < floats.length; i++) out[i] = THREE.DataUtils.toHalfFloat(floats[i]);
  return out;
}

function createShapeTexture(data, w, h) {
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter; // treść gładka — mipmapy zbędne
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function bakeShapeTextureFromImage(image) {
  const { w: iw, h: ih } = imageSize(image);
  const scale = Math.min(1, SHAPE_MAP_DEFAULTS.maxSide / Math.max(iw, ih));
  const w = Math.max(2, Math.round(iw * scale));
  const h = Math.max(2, Math.round(ih * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3] / 255;
  return createShapeTexture(toHalfFloatData(bakeHullShapeField(alpha, w, h)), w, h);
}

function createEnvTexture(pixels, size) {
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace; // RGB = bajty sRGB, alfa liniowa
  texture.needsUpdate = true;
  return texture;
}

// Obraz tła z NebulaSystem (planet3d.assets.js). Szukamy tylko wśród dzieci
// sceny, bez pełnego trawersu.
function findNebulaImage(scene) {
  const children = scene?.children;
  if (!Array.isArray(children)) return null;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child?.name !== 'Nebula') continue;
    const image = child.material?.uniforms?.map?.value?.image || null;
    return isImageReady(image) ? image : null;
  }
  return null;
}

function readNebulaPixels(image, size) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { w, h } = imageSize(image);
  // Środkowy kwadrat obrazu — bez spłaszczania proporcji.
  const side = Math.min(w, h);
  ctx.drawImage(image, (w - side) * 0.5, (h - side) * 0.5, side, side, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

const flatShapeTexture = createShapeTexture(
  toHalfFloatData(new Float32Array([0, 0, 0, 1])), 1, 1
);

export const HullLacquer = {
  // Wspólne obiekty uniformów — hexShips3D wkłada TE SAME obiekty do każdego
  // materiału kadłuba (i płyty pancerza).
  uniforms: {
    uLacquerEnv: { value: null },
    uLacquerEye: { value: new THREE.Vector3(0, 0, 1000) },
    uLacquerA: { value: new THREE.Vector4(0, 0.05, 10, 0.9) },   // siła, F0, zysk mgławicy, sufit mgławicy
    uLacquerB: { value: new THREE.Vector4(40, 150, 1500, 3) },   // gwiazdy HDR, słońce, ostrość odblasku, połysk
    uLacquerC: { value: new THREE.Vector4(60, 0.6, 3, 0) }       // ostrość połysku, metal, mip rozmycia, -
  },
  // Mapa „bez lakieru” (waga 0) dla kadłubów bez sprite'a i do czasu wypieczenia.
  flatShapeUniform: { value: flatShapeTexture },

  _entries: new WeakMap(),
  _pending: [],
  _envTexture: null,
  _envFromNebula: false,
  _nextNebulaProbe: 0,

  getTuning() {
    if (typeof window === 'undefined') return HULL_LACQUER_DEFAULTS;
    if (!window.__hullLacquerTune) window.__hullLacquerTune = { ...HULL_LACQUER_DEFAULTS };
    return window.__hullLacquerTune;
  },

  setEnabled(enabled) {
    this.getTuning().enabled = enabled !== false;
    return this.isEnabled();
  },

  isEnabled() {
    return this.getTuning().enabled !== false;
  },

  // Obiekt uniformu mapy kształtu wspólny dla wszystkich kadłubów z tym samym
  // obrazem. Pieczenie leci w kolejce (jeden obraz na klatkę), a do tego czasu
  // uniform wskazuje mapę płaską z wagą 0 — statek przez chwilę jest matowy.
  acquireShapeUniform(image) {
    if (!image) return this.flatShapeUniform;
    let entry = this._entries.get(image);
    if (!entry) {
      entry = { image, refs: 0, texture: null, uniform: { value: flatShapeTexture } };
      this._entries.set(image, entry);
      this._pending.push(entry);
    }
    entry.refs++;
    return entry.uniform;
  },

  releaseShapeUniform(image) {
    if (!image) return;
    const entry = this._entries.get(image);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    entry.texture?.dispose?.();
    entry.texture = null;
    entry.uniform.value = flatShapeTexture;
    this._entries.delete(image);
    const idx = this._pending.indexOf(entry);
    if (idx >= 0) this._pending.splice(idx, 1);
  },

  // Raz na klatkę, przed renderem. `eyePosition` = pozycja Core3D.cameraPersp:
  // oko pseudo-perspektywy nad środkiem kadru (fov gry), dzięki któremu płaskie
  // płyty odbijają różne kierunki nieba zamiast jednego punktu. Trzymamy
  // referencję do wektora kamery, bo syncCamera przestawia go w każdym passie.
  update(scene, eyePosition) {
    const t = this.getTuning();
    const u = this.uniforms;
    if (eyePosition && u.uLacquerEye.value !== eyePosition) u.uLacquerEye.value = eyePosition;
    u.uLacquerA.value.set(
      t.enabled !== false ? clampNum(t.strength, 0, 4, 1) : 0,
      clampNum(t.f0, 0, 1, 0.05),
      clampNum(t.nebGain, 0, 100, 10),
      clampNum(t.nebClamp, 0, 10, 0.9)
    );
    u.uLacquerB.value.set(
      clampNum(t.starMax, 0, 1000, 40),
      clampNum(t.sunRadiance, 0, 10000, 150),
      clampNum(t.glintExp, 1, 100000, 1500),
      clampNum(t.sheen, 0, 100, 3)
    );
    u.uLacquerC.value.set(
      clampNum(t.sheenExp, 1, 10000, 60),
      clampNum(t.metalSheen, 0, 4, 0.6),
      clampNum(t.envBlurLod, 0, 10, 3),
      0
    );
    if (!(u.uLacquerA.value.x > 0)) return; // wyłączony: nic nie pieczemy
    this._ensureEnv(scene);
    this._pumpBake();
  },

  _ensureEnv(scene) {
    if (!this._envTexture) {
      this._setEnv(buildLacquerEnvPixels(null, ENV_MAP_SIZE, { starMax: HULL_LACQUER_DEFAULTS.starMax }));
    }
    if (this._envFromNebula) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now < this._nextNebulaProbe) return;
    this._nextNebulaProbe = now + NEBULA_PROBE_MS;
    const image = findNebulaImage(scene);
    if (!image) return;
    const src = readNebulaPixels(image, ENV_MAP_SIZE);
    if (!src) return;
    this._setEnv(buildLacquerEnvPixels(src, ENV_MAP_SIZE, { starMax: HULL_LACQUER_DEFAULTS.starMax }));
    this._envFromNebula = true;
  },

  _setEnv(pixels) {
    const texture = createEnvTexture(pixels, ENV_MAP_SIZE);
    this._envTexture?.dispose?.();
    this._envTexture = texture;
    this.uniforms.uLacquerEnv.value = texture;
  },

  _pumpBake() {
    // Jeden obraz na klatkę (~10 ms przy 384 px). Obraz, który się jeszcze nie
    // wczytał, idzie na koniec kolejki — nie blokuje pozostałych.
    for (let n = this._pending.length; n > 0; n--) {
      const entry = this._pending.shift();
      if (entry.refs <= 0) continue;
      if (!isImageReady(entry.image)) {
        this._pending.push(entry);
        continue;
      }
      try {
        entry.texture = bakeShapeTextureFromImage(entry.image);
      } catch (err) {
        console.warn('[HullLacquer] Nie udało się wypiec mapy kształtu:', err);
        entry.texture = null;
      }
      if (entry.texture) entry.uniform.value = entry.texture;
      return;
    }
  }
};
