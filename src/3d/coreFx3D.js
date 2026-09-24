// Efekty rdzenia (reaktora) w scenie Core3D — bez własnego renderera.
// Stan i geometrię komory daje src/game/shipCore.js; tu jest tylko wygląd:
//
//   * ŻAR REAKTORA: kwad pod płaszczyzną kadłuba (z = -3). Kadłub heksowy
//     pisze głębię (hexShips3D: depthWrite, z = 0), więc żar przechodzi test
//     głębi TYLKO tam, gdzie heksu nie ma — prześwieca dokładnie przez dziurę,
//     bez żadnej maski z CPU. Dopóki komora jest cała (NOMINALNY), instancji
//     nie ma wcale.
//   * WARSTWA 7 (pass tarcz Core3D): ortho, PO shadowShaftsPass i bez
//     czyszczenia głębi. Na warstwie 0 (pass ortho) cień własnego kadłuba
//     mnożył żar w wyrwie o ~0,5 — emisja nie może dostać cienia, z tego
//     samego powodu tarcze mają ten pass. Głębia kadłuba z passa ortho zostaje
//     (shafts to quad bez testu i zapisu głębi), więc maskowanie działa dalej.
//     Kontrakt AGENTS.md: pass jest pomijany, gdy nikt nie zgłosi zawartości —
//     sync() woła options.markLayerActive(), gdy coś widać (patrz PORT).
//   * WYRZUTY PLAZMY: pula cząstek nad kadłubem (z = +3) z pozycji martwych
//     heksów komory — od KRYTYCZNEGO rzadko, w STOPIENIU coraz gęściej.
//   * BRZEG RANY: żar heksów przy martwych heksach komory idzie tym samym
//     kanałem co _heatWoundRim w destruktorze (shard.heat + heatStamp,
//     rampa w HEX_FRAGMENT_SHADER), więc współgra z nim zamiast go zagłuszać.
//
// Pasma HDR (przed ACES; próg bloomu gry 0,9 — bloomConfig.js): ciało żaru
// i dymy plazmy w paśmie barwy L 0,45–0,85 (bez bloomu), jedynym źródłem
// bloomu jest biały rdzeń L 8–12 (mały, rośnie w stopieniu). Zakaz poświaty
// wzdłuż sylwetki (memory hull-lacquer) spełniony z definicji: nic nie świeci
// poza komorą i jej wyrwami.
//
// Konwencja gry: świat (x, y) → scena (x, -y), kamera ortho z góry (+Z).
import * as THREE from 'three';
import { getCoreWorld, getEntityHexAngle, CORE_STATE, coreStateRank } from '../game/shipCore.js';
import { shardHeatNow, isHexShips3DActive } from '../game/destructor.js';

// UnrealBloomPass BRAMKUJE (memory hdr-band-plan): piksel nad progiem wchodzi
// do bloomu PEŁNĄ wartością, więc łagodna rampa od bieli do ciała (8 → 0,9)
// dawała setki pikseli 2–8 i szeroką białą plamę zjadającą barwę reaktora.
// Biały rdzeń ma dlatego ostrą krawędź (coreEdge) i mały promień, a ciało
// zostaje w całości pod progiem 0,9.
export const CORE_FX_BANDS = Object.freeze({
  bodyL: Object.freeze({ exposed: 0.62, critical: 0.72, meltdown: 0.84 }),
  // Szczyt z pulsem × (0,92–1,0): ODSŁ. 8,3–9, KRYT. 9,2–10, STOP. do 11,5.
  coreL: Object.freeze({ exposed: 9.0, critical: 10.0, meltdown: 11.5 }),
  coreRadius: Object.freeze({ exposed: 0.07, critical: 0.09, meltdownEnd: 0.14 }),
  // Promień żaru × promień komory: w stopieniu światło rośnie ponad komorę
  // i wypełnia całą wyrwę (kanał od strony ognia bywa 2× szerszy od komory).
  glowGrowth: Object.freeze({ nominal: 1.15, meltdownStart: 1.2, meltdownEnd: 2.2 }),
  coreEdge: 0.82,          // krawędź białego rdzenia: smoothstep(R, R·coreEdge)
  // Wyrzuty sumują się addytywnie (w stopieniu kilkadziesiąt naraz nad
  // wyrwą): ciało nisko, żeby 2–3 nałożone zostały pod progiem 0,9. Biała
  // głowica jak rdzeń — ostra krawędź, jasność 8–12, włączona tylko przez
  // początek życia cząstki (gasnąc płynnie przechodziłaby przez 2–8). W
  // stopieniu głowicę dostaje ułamek wyrzutów rosnący z postępem odliczania.
  ventBodyL: 0.32,
  ventCoreL: 9.0,
  ventHotLife: 0.16,       // część życia cząstki z białą głowicą
  ventHotRadius: 0.3,      // promień głowicy × rozmiar cząstki
  // Żar brzegu (0–1, jak shard.heat): pomarańcz pod progiem bloomu do
  // stopienia, dopiero pod koniec odliczania brzeg dochodzi do bieli.
  // Barwa reaktora ma dominować: brzeg zostaje pomarańczowy (≤ 0,45 — pod
  // progiem bloomu) i dochodzi do bieli dopiero w ostatnich 25% odliczania.
  rimHeat: Object.freeze({ exposed: 0.3, critical: 0.38, meltdownStart: 0.42, meltdownEnd: 0.8 })
});

// Warstwa passa tarcz w Core3D (SHIELD_RENDER_LAYER) — patrz nagłówek.
export const CORE_FX_LAYER = 7;
const GLOW_Z = -3;
const VENT_Z = 3;
const GLOW_RENDER_ORDER = 11;   // kadłuby heksowe: 10, pancerz LOD: 9
const VENT_RENDER_ORDER = 12;

const NOISE_GLSL = `
float cfxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cfxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cfxHash(i);
  float b = cfxHash(i + vec2(1.0, 0.0));
  float c = cfxHash(i + vec2(0.0, 1.0));
  float d = cfxHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cfxFbm(vec2 p) {
  float v = 0.0;
  v += 0.55 * cfxNoise(p); p *= 2.03;
  v += 0.28 * cfxNoise(p); p *= 2.01;
  v += 0.17 * cfxNoise(p);
  return v;
}
`;

const GLOW_VERTEX = `
attribute vec4 aCore;    // x, y (scena), promień (świat), obrót
attribute vec4 aColor;   // barwa ciała (znormalizowana do pasma), ziarno
attribute vec4 aState;   // jasność ciała L, jasność rdzenia L, promień rdzenia (0-1), puls 0-1
uniform float uZ;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vState;
void main() {
  vUv = position.xy;
  vColor = aColor;
  vState = aState;
  float c = cos(aCore.w);
  float s = sin(aCore.w);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aCore.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(aCore.x + p.x, aCore.y + p.y, uZ, 1.0);
}
`;

const GLOW_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vState;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float seed = vColor.w;
  float pulse = vState.w;
  // Wir plazmy we współrzędnych biegunowych: kąt obraca się, promień płynie do środka.
  float ang = atan(vUv.y, vUv.x);
  vec2 q = vec2(ang * 1.2 + uTime * 0.35 + seed * 13.0, r * 3.2 - uTime * (0.7 + pulse * 1.6));
  float n = cfxFbm(q * 1.7 + seed * 7.0);
  float bodyProfile = smoothstep(1.0, 0.1, r);
  float body = bodyProfile * (0.35 + 0.65 * n) * (0.86 + 0.14 * pulse);
  float coreR = max(0.02, vState.z) * (1.0 + 0.18 * pulse);
  // Ostra krawędź: mało pikseli w paśmie 0,9–8, które bloom brałby w całości.
  float core = smoothstep(coreR, coreR * CORE_EDGE, r);
  // Ciało pod progiem bloomu także przy rdzeniu (bez sumy ciało + rdzeń > 0,9 wokół).
  body *= smoothstep(coreR * 0.6, coreR * 1.6, r) * 0.35 + 0.65;
  vec3 col = vColor.rgb * (vState.x * body) + vec3(1.0, 0.97, 0.92) * (vState.y * core);
  gl_FragColor = vec4(col, 1.0);
}
`;

const VENT_VERTEX = `
attribute vec4 aStart;   // x, y (scena), vx, vy
attribute vec4 aLife;    // t0, życie, rozmiar startowy, rozmiar końcowy
attribute vec4 aColor;   // barwa ciała (pasmo), jasność białego rdzenia
uniform float uTime;
uniform float uZ;
varying vec2 vUv;
varying vec4 vColor;
varying float vAge;
void main() {
  float age = uTime - aLife.x;
  if (age < 0.0 || age > aLife.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float t = age / aLife.y;
  float drag = 2.4;
  vec2 pos = aStart.xy + aStart.zw * ((1.0 - exp(-drag * age)) / drag);
  float size = mix(aLife.z, aLife.w, sqrt(t));
  vUv = position.xy;
  vColor = aColor;
  vAge = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos + position.xy * size, uZ, 1.0);
}
`;

const VENT_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
#define VENT_HOT_LIFE ${CORE_FX_BANDS.ventHotLife.toFixed(3)}
#define VENT_HOT_R ${CORE_FX_BANDS.ventHotRadius.toFixed(3)}
varying vec2 vUv;
varying vec4 vColor;
varying float vAge;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float soft = pow(1.0 - r, 1.7);
  float fade = (1.0 - vAge) * (1.0 - vAge);
  // Głowica: ostra w przestrzeni i w czasie — piksele w paśmie 8–12 albo 0.
  float hot = step(vAge, VENT_HOT_LIFE) * (1.0 - smoothstep(VENT_HOT_R * CORE_EDGE, VENT_HOT_R, r));
  vec3 col = vColor.rgb * (soft * fade) + vec3(1.0, 0.96, 0.9) * (vColor.a * hot);
  gl_FragColor = vec4(col, 1.0);
}
`;

function luminance(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function parseColor(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) {
    const v = value.replace('#', '');
    // sRGB → liniowe (barwy z edytora są w hex sRGB)
    const lin = (x) => { const c = parseInt(x, 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return [lin(v.slice(0, 2)), lin(v.slice(2, 4)), lin(v.slice(4, 6))];
  }
  return fallback;
}

function makeRng(seed) {
  let s = (Number(seed) >>> 0) || 0x2545f491;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Kopia markGridHeatDirtyRange z destructor.js (nieeksportowana): żar to tylko
// atrybut renderu — rozszerzamy zakres uploadu instancji, bez rewizji siatki.
function markHeatDirty(grid, index) {
  if (!grid || !isHexShips3DActive()) return;
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  if (count <= 0 || index < 0 || index >= count) return;
  grid.meshDirty = true;
  if (grid.meshDirtyAll) return;
  const s = Number(grid.meshDirtyStart);
  const e = Number(grid.meshDirtyEnd);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) {
    grid.meshDirtyStart = index;
    grid.meshDirtyEnd = index;
    return;
  }
  if (index < s) grid.meshDirtyStart = index;
  if (index > e) grid.meshDirtyEnd = index;
}

function raiseHeat(shard, value, nowSec) {
  if (!shard || !(value > 0)) return false;
  if (shardHeatNow(shard, nowSec) >= value) return false;
  shard.heat = Math.min(1, value);
  shard.heatStamp = nowSec;
  return true;
}

/**
 * @param {object} options
 *   scene     — THREE.Scene (Core3D.scene)
 *   layer     — warstwa (0 = ortho, jak kadłuby)
 *   colorFor  — (core) => [r, g, b] liniowe, barwa frakcji
 *   ventCapacity — sloty puli wyrzutów
 */
export function createCoreFx3D(options = {}) {
  const scene = options.scene;
  if (!scene) throw new Error('createCoreFx3D: wymagana scena');
  const layer = Number.isFinite(options.layer) ? options.layer : CORE_FX_LAYER;
  // Zgłoszenie widocznej zawartości warstwy (Core3D.setShieldLayerActive(true)).
  // Tylko podnosi flagę — gasi ją ten, kto zaczyna klatkę (shield3D / demo).
  const markLayerActive = typeof options.markLayerActive === 'function' ? options.markLayerActive : null;
  // Przełączniki diagnostyczne (pomiar udziału w histogramie HDR).
  const debug = { glow: true, vents: true, rim: true };
  const colorFor = typeof options.colorFor === 'function' ? options.colorFor : () => [0.3, 0.7, 1.0];
  const maxGlows = Math.max(1, options.maxGlows | 0 || 64);
  const ventCap = Math.max(64, options.ventCapacity | 0 || 2048);
  const rng = makeRng(options.seed || 0x5eed);

  // --- żar (jedno wywołanie na wszystkie odsłonięte rdzenie) ---
  const glowBase = new THREE.PlaneGeometry(2, 2);
  const glowGeo = new THREE.InstancedBufferGeometry();
  glowGeo.index = glowBase.index;
  glowGeo.setAttribute('position', glowBase.attributes.position);
  const glowCore = new Float32Array(maxGlows * 4);
  const glowColor = new Float32Array(maxGlows * 4);
  const glowState = new Float32Array(maxGlows * 4);
  const aCore = new THREE.InstancedBufferAttribute(glowCore, 4).setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(glowColor, 4).setUsage(THREE.DynamicDrawUsage);
  const aState = new THREE.InstancedBufferAttribute(glowState, 4).setUsage(THREE.DynamicDrawUsage);
  glowGeo.setAttribute('aCore', aCore);
  glowGeo.setAttribute('aColor', aColor);
  glowGeo.setAttribute('aState', aState);
  glowGeo.instanceCount = 0;
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uZ: { value: GLOW_Z } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = GLOW_RENDER_ORDER;
  glowMesh.visible = false;
  glowMesh.layers.set(layer);
  glowMesh.matrixAutoUpdate = false;
  glowMesh.name = 'coreFx3D:glow';
  scene.add(glowMesh);

  // --- wyrzuty plazmy (ring bufor, upload tylko dotkniętego wycinka) ---
  const ventBase = new THREE.PlaneGeometry(2, 2);
  const ventGeo = new THREE.InstancedBufferGeometry();
  ventGeo.index = ventBase.index;
  ventGeo.setAttribute('position', ventBase.attributes.position);
  const ventStart = new Float32Array(ventCap * 4);
  const ventLife = new Float32Array(ventCap * 4);
  const ventColor = new Float32Array(ventCap * 4);
  const vStart = new THREE.InstancedBufferAttribute(ventStart, 4).setUsage(THREE.DynamicDrawUsage);
  const vLife = new THREE.InstancedBufferAttribute(ventLife, 4).setUsage(THREE.DynamicDrawUsage);
  const vColor = new THREE.InstancedBufferAttribute(ventColor, 4).setUsage(THREE.DynamicDrawUsage);
  ventGeo.setAttribute('aStart', vStart);
  ventGeo.setAttribute('aLife', vLife);
  ventGeo.setAttribute('aColor', vColor);
  ventGeo.instanceCount = 0;
  const ventMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uZ: { value: VENT_Z } },
    vertexShader: VENT_VERTEX,
    fragmentShader: VENT_FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const ventMesh = new THREE.Mesh(ventGeo, ventMat);
  ventMesh.frustumCulled = false;
  ventMesh.renderOrder = VENT_RENDER_ORDER;
  ventMesh.visible = false;
  ventMesh.layers.set(layer);
  ventMesh.matrixAutoUpdate = false;
  ventMesh.name = 'coreFx3D:vents';
  scene.add(ventMesh);

  const pool = { cursor: 0, highWater: 0, liveUntil: -Infinity, lo: -1, hi: -1 };
  // Zegar efektów = czas SYMULACJI (pauza zatrzymuje wyrzuty i puls, zwolnienie
  // czasu je zwalnia). Żar brzegu idzie osobno, na bazie czasu shadera kadłubów.
  let clock = 0;
  const perCore = new WeakMap();
  const stats = { glows: 0, vents: 0, drawCalls: 0, rimHeated: 0 };
  const scratch = { x: 0, y: 0 };
  const ventCenter = { x: 0, y: 0 };
  const ventPoint = { x: 0, y: 0 };
  const band = { prog: 0, bodyL: 0, coreL: 0, coreR: 0, rim: 0, pulseHz: 0 };
  const colorCache = new WeakMap();

  function coreColor(core) {
    let c = colorCache.get(core);
    if (!c) {
      c = parseColor(core.color, null) || parseColor(colorFor(core), [0.3, 0.7, 1.0]);
      colorCache.set(core, c);
    }
    return c;
  }

  function spawnVent(t0, x, y, vx, vy, size0, size1, life, col, coreL) {
    const i = pool.cursor;
    pool.cursor = (pool.cursor + 1) % ventCap;
    if (i + 1 > pool.highWater) pool.highWater = i + 1;
    if (pool.lo < 0 || i < pool.lo) pool.lo = i;
    if (i > pool.hi) pool.hi = i;
    const b = i * 4;
    ventStart[b] = x; ventStart[b + 1] = -y; ventStart[b + 2] = vx; ventStart[b + 3] = -vy;
    ventLife[b] = t0; ventLife[b + 1] = life; ventLife[b + 2] = size0; ventLife[b + 3] = size1;
    const norm = CORE_FX_BANDS.ventBodyL / Math.max(1e-3, luminance(col));
    ventColor[b] = col[0] * norm; ventColor[b + 1] = col[1] * norm; ventColor[b + 2] = col[2] * norm; ventColor[b + 3] = coreL;
    if (t0 + life > pool.liveUntil) pool.liveUntil = t0 + life;
  }

  // Punkt martwego heksa komory w świecie (pozycja spoczynkowa + bieżący gospodarz).
  function deadChamberPoint(core, out) {
    const n = core.chamber.length;
    if (n === 0) return false;
    for (let tries = 0; tries < 6; tries++) {
      const i = Math.floor(rng() * n);
      if (core.chamberAlive[i]) continue;
      const host = core.host;
      const grid = host.hexGrid;
      const lx = core.chamberGridX[i] - grid.srcWidth * 0.5 - (grid.pivot?.x || 0);
      const ly = core.chamberGridY[i] - grid.srcHeight * 0.5 - (grid.pivot?.y || 0);
      const ang = getEntityHexAngle(host);
      const c = Math.cos(ang), s = Math.sin(ang);
      const sx = host.visual?.spriteScaleX ?? host.visual?.spriteScale ?? 1;
      const sy = host.visual?.spriteScaleY ?? host.visual?.spriteScale ?? 1;
      const px = host.pos ? host.pos.x : host.x;
      const py = host.pos ? host.pos.y : host.y;
      out.x = px + lx * sx * c - ly * sy * s;
      out.y = py + lx * sx * s + ly * sy * c;
      return true;
    }
    return false;
  }

  // hotFrac: część wyrzutów z białą głowicą (jasność coreL), reszta sam dym barwy.
  function emitVents(core, count, speedMul, sizeMul, lifeMul, coreL, hotFrac = 1) {
    const host = core.host;
    const center = getCoreWorld(core, ventCenter);
    const col = coreColor(core);
    const hvx = host.vel ? host.vel.x : (host.vx || 0);
    const hvy = host.vel ? host.vel.y : (host.vy || 0);
    const hexR = 5 * Math.max(host.visual?.spriteScale ?? 1, 0.1);
    const p = ventPoint;
    // Wyrzut tylko z prawdziwej wyrwy komory — bez dziury plazma nie ma którędy wyjść.
    if (core.deadCount <= 0) return;
    for (let k = 0; k < count; k++) {
      if (!deadChamberPoint(core, p)) continue;
      let dx = p.x - center.x;
      let dy = p.y - center.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) { const a = rng() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= d; dy /= d; }
      // rozrzut ±40° od kierunku promieniowego
      const jitter = (rng() - 0.5) * 1.4;
      const cj = Math.cos(jitter), sj = Math.sin(jitter);
      const ux = dx * cj - dy * sj;
      const uy = dx * sj + dy * cj;
      const speed = (40 + rng() * 110) * speedMul;
      spawnVent(clock, p.x, p.y, hvx + ux * speed, hvy + uy * speed,
        hexR * (1.2 + rng() * 0.8) * sizeMul, hexR * (3.5 + rng() * 3.0) * sizeMul,
        (0.35 + rng() * 0.5) * lifeMul, col, (coreL > 0 && rng() < hotFrac) ? coreL : 0);
    }
  }

  function heatRim(core, nowSec, value) {
    const host = core.host;
    const grid = host?.hexGrid;
    if (!grid) return;
    const shards = grid.shards;
    // Komora osłabiona BEZ wyrwy (fala z sąsiedniego wybuchu): żaru nie ma
    // którędy zobaczyć, więc grzeje się sama płyta nad reaktorem — jedyny
    // widomy znak KRYTYCZNEGO / STOPIENIA, zanim coś pęknie. Tylko heksy komory
    // (plama wielkości komory), nie sylwetka.
    if (core.deadCount === 0 && (core.state === CORE_STATE.CRITICAL || core.state === CORE_STATE.MELTDOWN)) {
      const v = value * (core.state === CORE_STATE.MELTDOWN ? 1 : 0.7);
      for (let i = 0; i < core.chamber.length; i++) {
        const s = core.chamber[i];
        if (!s || !s.active || s.isDebris) continue;
        const idx = s.__meshIndex;
        if (shards[idx] !== s) continue;
        if (raiseHeat(s, v, nowSec)) {
          markHeatDirty(grid, idx);
          stats.rimHeated++;
        }
      }
      return;
    }
    for (let i = 0; i < core.chamber.length; i++) {
      if (core.chamberAlive[i]) continue;
      const dead = core.chamber[i];
      const nbs = dead.neighbors;
      if (!nbs) continue;
      for (let k = 0; k < nbs.length; k++) {
        const n = nbs[k];
        if (!n || !n.active || n.isDebris) continue;
        const idx = n.__meshIndex;
        if (shards[idx] !== n) continue;
        if (raiseHeat(n, value, nowSec)) {
          markHeatDirty(grid, idx);
          stats.rimHeated++;
        }
      }
    }
  }

  // Pasmo stanu do współdzielonego obiektu `band` (bez alokacji na klatkę).
  function stateBand(core) {
    const B = CORE_FX_BANDS;
    if (core.state === CORE_STATE.MELTDOWN) {
      const prog = core.meltdownDuration > 0 ? Math.max(0, Math.min(1, 1 - core.meltdownRemaining / core.meltdownDuration)) : 1;
      band.prog = prog;
      band.bodyL = B.bodyL.critical + (B.bodyL.meltdown - B.bodyL.critical) * prog;
      band.coreL = B.coreL.critical + (B.coreL.meltdown - B.coreL.critical) * prog;
      band.coreR = B.coreRadius.critical + (B.coreRadius.meltdownEnd - B.coreRadius.critical) * prog * prog;
      const late = Math.max(0, (prog - 0.75) / 0.25);
      band.rim = B.rimHeat.meltdownStart + (B.rimHeat.meltdownEnd - B.rimHeat.meltdownStart) * late * late;
      // bicie serca: 1,2 Hz → 7 Hz pod koniec odliczania
      band.pulseHz = 1.2 + 5.8 * prog * prog;
    } else if (core.state === CORE_STATE.CRITICAL) {
      band.prog = 0; band.bodyL = B.bodyL.critical; band.coreL = B.coreL.critical;
      band.coreR = B.coreRadius.critical; band.rim = B.rimHeat.critical; band.pulseHz = 0.9;
    } else {
      band.prog = 0; band.bodyL = B.bodyL.exposed; band.coreL = B.coreL.exposed;
      band.coreR = B.coreRadius.exposed; band.rim = B.rimHeat.exposed; band.pulseHz = 0.5;
    }
    return band;
  }

  /**
   * Raz na klatkę renderu, przed Core3D.render().
   * @param {Array} cores  runtime rdzeni (shipCore) do pokazania
   * @param {number} nowSec  performance.now()/1000 — baza uTime kadłubów (żar brzegu)
   * @param {number} simDt   krok symulacji tej klatki (0 = pauza: wyrzuty i puls stoją)
   */
  function sync(cores, nowSec, simDt = 1 / 60) {
    clock += Math.max(0, simDt);
    let n = 0;
    const list = Array.isArray(cores) ? cores : [];
    for (const core of list) {
      if (!core || core.invalid || !core.host?.hexGrid || core.host.dead) continue;
      const rank = coreStateRank(core.state);
      if (rank < coreStateRank(CORE_STATE.EXPOSED) || core.state === CORE_STATE.DETONATED) continue;
      if (n >= maxGlows) break;
      stateBand(core);
      let st = perCore.get(core);
      if (!st) { st = { phase: rng() * Math.PI * 2, ventAcc: 0, rimAt: -1, seed: rng() }; perCore.set(core, st); }
      st.phase += Math.PI * 2 * band.pulseHz * Math.max(0, simDt);
      const pulse = 0.5 + 0.5 * Math.sin(st.phase);
      const host = core.host;
      getCoreWorld(core, scratch);
      const scale = Math.max(host.visual?.spriteScaleX ?? host.visual?.spriteScale ?? 1, host.visual?.spriteScaleY ?? host.visual?.spriteScale ?? 1);
      const G = CORE_FX_BANDS.glowGrowth;
      const growth = core.state === CORE_STATE.MELTDOWN
        ? G.meltdownStart + (G.meltdownEnd - G.meltdownStart) * band.prog
        : G.nominal;
      const col = coreColor(core);
      const norm = 1 / Math.max(1e-3, luminance(col));
      const b = n * 4;
      glowCore[b] = scratch.x;
      glowCore[b + 1] = -scratch.y;
      glowCore[b + 2] = core.gridR * scale * growth;
      glowCore[b + 3] = -getEntityHexAngle(host);
      glowColor[b] = col[0] * norm;
      glowColor[b + 1] = col[1] * norm;
      glowColor[b + 2] = col[2] * norm;
      glowColor[b + 3] = st.seed;
      glowState[b] = band.bodyL;
      glowState[b + 1] = band.coreL * (0.92 + 0.08 * pulse);
      glowState[b + 2] = band.coreR;
      glowState[b + 3] = pulse;
      n++;

      if (simDt > 0) {
        // wyrzuty: KRYTYCZNY rzadko, STOPIENIE 8 → 60 na sekundę
        const rate = core.state === CORE_STATE.MELTDOWN ? 8 + 52 * band.prog * band.prog
          : core.state === CORE_STATE.CRITICAL ? 3 : 0;
        st.ventAcc += rate * simDt;
        const count = Math.min(24, Math.floor(st.ventAcc));
        if (count > 0) {
          st.ventAcc -= count;
          const meltdown = core.state === CORE_STATE.MELTDOWN;
          emitVents(core, count, meltdown ? 1 + band.prog : 0.6, meltdown ? 1 + band.prog * 0.8 : 0.7, 1,
            meltdown ? CORE_FX_BANDS.ventCoreL : 0, 0.15 + 0.6 * band.prog);
        }
        if (debug.rim && nowSec - st.rimAt >= 0.1) {
          st.rimAt = nowSec;
          heatRim(core, nowSec, band.rim);
        }
      }
    }
    stats.glows = n;
    glowGeo.instanceCount = n;
    glowMesh.visible = n > 0 && debug.glow;
    if (n > 0) {
      aCore.clearUpdateRanges(); aCore.addUpdateRange(0, n * 4); aCore.needsUpdate = true;
      aColor.clearUpdateRanges(); aColor.addUpdateRange(0, n * 4); aColor.needsUpdate = true;
      aState.clearUpdateRanges(); aState.addUpdateRange(0, n * 4); aState.needsUpdate = true;
    }
    glowMat.uniforms.uTime.value = clock;
    flushVents(clock);
    stats.drawCalls = (glowMesh.visible ? 1 : 0) + (ventMesh.visible ? 1 : 0);
    if (markLayerActive && stats.drawCalls > 0) markLayerActive();
  }

  function flushVents(t) {
    if (pool.lo >= 0) {
      const lo = pool.lo;
      const count = pool.hi - lo + 1;
      for (const attr of [vStart, vLife, vColor]) {
        if (attr.updateRanges.length >= 8) attr.clearUpdateRanges();
        else attr.addUpdateRange(lo * 4, count * 4);
        attr.needsUpdate = true;
      }
      pool.lo = -1;
      pool.hi = -1;
    }
    const live = t < pool.liveUntil;
    ventMesh.visible = live && debug.vents;
    if (live) {
      ventMat.uniforms.uTime.value = t;
      ventGeo.instanceCount = pool.highWater;
    } else if (pool.highWater !== 0) {
      pool.highWater = 0;
      pool.cursor = 0;
      ventGeo.instanceCount = 0;
    }
    stats.vents = live ? pool.highWater : 0;
  }

  // Zdarzenia z updateShipCores: pierwsze przebicie, początek stopienia, detonacja.
  function onEvent(ev) {
    const core = ev?.core;
    if (!core || !core.host?.hexGrid) return;
    if (ev.type === 'state' && ev.to === CORE_STATE.EXPOSED) {
      emitVents(core, 6, 0.8, 0.8, 0.8, 0);
    } else if (ev.type === 'state' && ev.to === CORE_STATE.MELTDOWN) {
      emitVents(core, 14, 1.3, 1.1, 1.1, CORE_FX_BANDS.ventCoreL, 0.5);
    } else if (ev.type === 'detonate') {
      emitVents(core, 40, 3.2, 2.2, 1.4, CORE_FX_BANDS.ventCoreL * 1.2, 0.6);
    }
  }

  function dispose() {
    scene.remove(glowMesh);
    scene.remove(ventMesh);
    glowGeo.dispose(); glowBase.dispose(); glowMat.dispose();
    ventGeo.dispose(); ventBase.dispose(); ventMat.dispose();
  }

  return { sync, onEvent, dispose, stats, debug, layer, meshes: { glow: glowMesh, vents: ventMesh }, bands: CORE_FX_BANDS };
}
