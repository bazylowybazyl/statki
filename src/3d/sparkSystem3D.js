// src/3d/sparkSystem3D.js
//
// ISKRY TRAFIEŃ I TARCIA — API gry bez zmian (`init`, `emit(pX, pY, vX, vY, life, size, gain)`,
// `burst`, `update`, `grindingBurst`, `grindingSeam`, `setColor`, `dispose`), od zadania 19
// na puli iskier z dema rakiet (src/3d/rockets/sparks.js) w scenie Core3D — dawniej
// ShaderMaterial w scenie overlaya (osobny WebGLRenderer).
//
// Różnice względem dawnego modułu:
//   • barwa PER ISKRA: `burst(..., kolor)` barwi tylko swoją serię (dawniej przestawiał
//     jedną globalną barwę wszystkich żywych iskier — „wszystkie pomarańczowe” albo
//     wszystkie w barwie ostatniej serii); `emit` bierze barwę domyślną (`setColor`,
//     domyślnie dawna 0xff4d00) albo jawną [r, g, b] liniową jako 8. argument;
//   • losowość z fxRandom (warstwa efektów), nie z Math.random gry;
//   • czas: zegar efektów Core3D (biegnie też w pauzie, jak dawny tick overlaya), początek
//     pul i epoki z Core3D.fx.origin (FxPoolOrigin) — `update(dt)` zostaje dla zgodności
//     (bez Core3D, np. testy w Node: zegar wewnętrzny).
//
// NOŚNIK (src/game/carrierVelocity.js): iskra trafienia rodzi się z prędkością trafionego
// kadłuba i leci z nim (ActiveCarrier przy narodzinach, pozycja z zegara gry SimClock);
// opór działa już tylko na jej ruch własny.

import { SparkPool } from './rockets/sparks.js';
import { SPARK_COLORS } from './rockets/palette.js';
import { Core3D } from './core3d.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';
import { SimClock } from '../game/simClock.js';
import { ActiveCarrier } from '../game/carrierVelocity.js';
import { fxRandom } from './fx/fxRandom.js';

const MIN_SPARK_SIZE = 0.12;
const MAX_SPARK_SIZE = 0.9;
const MIN_SPARK_LIFE = 0.05;
const MAX_SPARK_LIFE = 0.9;
/** Opór ruchu własnego iskier API (dawny shader: drag 0,5). */
const API_SPARK_DRAG = 0.5;
const MAX_GRINDING_VISUAL_ENERGY = 650;
// Energia wyrzutu snopu tarcia z prędkości styku (j./s): sufit 650 przy ~240 j./s.
// Dawniej liczona z IMPULSU (masa × prędkość) — przy masach kadłubów na belkach
// (10⁵–10⁶) sufit był osiągany przy każdym dotyku, więc dosunięcie burtą sypało jak taran.
const GRIND_ENERGY_PER_SPEED = 2.7;

let pool = null;
let step = null;
let ownClock = 0;          // bez Core3D.fx (Node, narzędzia): zegar z update(dt)
const _camOrigin = { x: 0, y: 0 };
// Barwa domyślna (liniowa) i robocza barwa serii burst.
const _defaultColor = [SPARK_COLORS.game[0], SPARK_COLORS.game[1], SPARK_COLORS.game[2]];
const _burstColor = [0, 0, 0];

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' / liczba / THREE.Color → liniowe [r, g, b] w `out`. */
function colorToLinear(hex, out) {
  if (hex && typeof hex === 'object' && Number.isFinite(hex.r)) {
    out[0] = hex.r; out[1] = hex.g; out[2] = hex.b;
    return out;
  }
  const v = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(v)) { out[0] = _defaultColor[0]; out[1] = _defaultColor[1]; out[2] = _defaultColor[2]; return out; }
  out[0] = srgbToLinear(((v >> 16) & 255) / 255);
  out[1] = srgbToLinear(((v >> 8) & 255) / 255);
  out[2] = srgbToLinear((v & 255) / 255);
  return out;
}

// Początek pul Core3D przed pierwszą klatką efektów (iskra wysypana przed pierwszym renderem):
// ustawiamy go od kamery — bez tego dane lokalne liczone od (0, 0) rozjechałyby się przy
// inicjalizacji początku (FxPoolOrigin nie przesuwa danych przy pierwszym ustawieniu).
function ensureOrigin() {
  const o = pool?.origin;
  if (!o || o.initialized) return;
  const c = sceneOriginNearCamera(_camOrigin);
  o.update(c.x, c.y, Number(Core3D.fx?.time) || 0, SimClock.sim, SimClock.render);
  pool.fxTime = o.timeFx.value;
}

// Aproksymacja krzywej Gaussa (od -1.0 do 1.0)
function randomGaussian() {
  return ((fxRandom.next() + fxRandom.next() + fxRandom.next()) / 1.5) - 1.0;
}

// Kształt snopu tarcia z prędkości styku: energia wyrzutu i udział normalnej
// (zbliżanie) względem stycznej (poślizg) w kierunku snopu.
const _grindShape = { visualEnergy: 0, bounceRatio: 0 };
function grindShape(approachSpeed, slideSpeed) {
  const approach = Math.max(0, Number(approachSpeed) || 0);
  const slide = Math.abs(Number(slideSpeed) || 0);
  const speed = approach + slide;
  _grindShape.visualEnergy = Math.min(MAX_GRINDING_VISUAL_ENERGY, speed * GRIND_ENERGY_PER_SPEED);
  _grindShape.bounceRatio = speed > 1e-6 ? approach / speed : 0;
  return _grindShape;
}

// Kierunek glowny snopu: normalna + znos z poslizgu.
const _mainDir = { x: 0, y: 0 };
function grindMainDir(normalX, normalY, tangentX, tangentY, bounceRatio) {
  const mDx = normalX * (bounceRatio + 0.1) + tangentX * (1.0 - bounceRatio);
  const mDy = normalY * (bounceRatio + 0.1) + tangentY * (1.0 - bounceRatio);
  const mLen = Math.sqrt(mDx * mDx + mDy * mDy) || 1;
  _mainDir.x = mDx / mLen;
  _mainDir.y = mDy / mLen;
  return _mainDir;
}

// JEDEN snop iskier w JEDNYM punkcie styku — wspolny trzon grindingBurst
// (snop w centroidzie) i grindingSeam (snopy wzdluz szwu). Dobor predkosci,
// zycia i rozmiaru czastki siedzi tylko tutaj, zeby obie sciezki nie rozjechaly
// sie przy pierwszym strojeniu.
function emitGrindCluster(x, y, normalX, normalY, tangentX, tangentY, count, visualEnergy, spreadRadius, baseVx, baseVy, bounceRatio, gain) {
  const mainDir = grindMainDir(normalX, normalY, tangentX, tangentY, bounceRatio);
  const mDx = mainDir.x;
  const mDy = mainDir.y;

  for (let i = 0; i < count; i++) {
    const r = fxRandom.next();
    const weight = r * r;
    const scatterAmount = (1.0 - weight) * 2.0;

    // Rozrzut na plaszczyznie 2D
    const pX = x + tangentX * randomGaussian() * spreadRadius + normalX * fxRandom.next() * 20;
    const pY = y + tangentY * randomGaussian() * spreadRadius + normalY * fxRandom.next() * 20;

    const dX = mDx + tangentX * randomGaussian() * scatterAmount + normalX * Math.abs(randomGaussian()) * scatterAmount;
    const dY = mDy + tangentY * randomGaussian() * scatterAmount + normalY * Math.abs(randomGaussian()) * scatterAmount;
    const dLen = Math.sqrt(dX * dX + dY * dY) || 1;

    const speed = 180 + (visualEnergy * 0.18) + (weight * visualEnergy * 0.28) + fxRandom.next() * 260;

    const vX = (dX / dLen) * speed + baseVx;
    const vY = (dY / dLen) * speed + baseVy;

    const lifeTime = 0.1 + (weight * 0.5) + fxRandom.next() * 0.2;
    const size = 0.18 + weight * 0.42;

    SparkSystem3D.emit(pX, pY, vX, vY, lifeTime, size, gain);
  }
}

export const SparkSystem3D = {
  isInitialized: false,

  /** Pula (src/3d/rockets/sparks.js) — iskry rakiet wysypuje ją reżyser efektów. */
  get pool() { return pool; },

  /**
   * Pula w scenie Core3D (warstwa 0, pass ortho). `scene` — dawniej scena overlaya; gdy
   * Core3D jest zainicjowany, iskry idą zawsze do jego sceny (overlay i jego renderer
   * odchodzą — zadanie 20), inaczej do podanej (testy w Node).
   */
  init(scene) {
    if (this.isInitialized) return;
    const useCore = !!(Core3D.isInitialized && Core3D.scene && Core3D.fx);
    const target = useCore ? Core3D.scene : scene;
    if (!target) return;
    pool = new SparkPool({ scene: target, origin: useCore ? Core3D.fx.origin : null });
    ownClock = 0;
    if (useCore) {
      step = {
        name: 'iskry',
        update(ctx) {
          const cam = ctx.core?.activeCam1;
          const zoom = Math.max(1e-4, Number(cam?.zoom) || 1);
          pool.update(ctx.origin.timeFx.value, zoom, ctx.origin.x, ctx.origin.y);
        },
        warm(ctx) {
          const m = pool.mesh;
          const vis = m.visible;
          const ic = m.geometry.instanceCount;
          m.visible = true;
          m.geometry.instanceCount = 2;
          try { ctx.core.prewarmPass(m, 0); } finally { m.visible = vis; m.geometry.instanceCount = ic; }
        }
      };
      Core3D.addFxStep(step);
    }
    this.isInitialized = true;
  },

  // vx, vy = ruch WŁASNY iskry; prędkość kadłuba dokłada ActiveCarrier (nośnik
  // ustawiony przez wołającego wokół serii, np. trafienia w pędzący okręt).
  // gain = jasność iskry (1 = iskra trafienia; tarcie kadłubów podaje mniej).
  // color — opcjonalnie [r, g, b] liniowe (inaczej barwa domyślna, setColor).
  emit(gameX, gameY, vx, vy, life, size, gain = 1, color = null) {
    if (!this.isInitialized || !pool) return;
    ensureOrigin();
    const c = color || _defaultColor;
    const clampedLife = clamp(Number.isFinite(life) ? life : 0.25, MIN_SPARK_LIFE, MAX_SPARK_LIFE);
    const clampedSize = clamp(size !== undefined && Number.isFinite(size) ? size : 0.5, MIN_SPARK_SIZE, MAX_SPARK_SIZE);
    const g = Number.isFinite(gain) ? Math.max(0, gain) : 1;
    const cvx = ActiveCarrier.vx;
    const cvy = ActiveCarrier.vy;
    pool.emit(gameX, gameY, vx, vy, clampedLife, clampedSize, API_SPARK_DRAG, c[0], c[1], c[2], g,
      cvx, cvy, ActiveCarrier.t0, ActiveCarrier.clock);
  },

  /**
   * Iskra efektów rakiet (bez przycięcia życia i rozmiaru z API, własny opór i barwa):
   * ŚWIAT gry, nośnik (cvx, cvy) z czasem pozy t0 w zegarze `clock` (CLOCK_*).
   */
  emitRaw(x, y, vx, vy, life, size, drag, r, g, b, gain = 1, cvx = 0, cvy = 0, t0 = 0, clock = 0) {
    if (!this.isInitialized || !pool) return;
    ensureOrigin();
    pool.emit(x, y, vx, vy, life, size, drag, r, g, b, gain, cvx, cvy, t0, clock);
  },

  /**
   * Wpis roboczy puli (pola jak argumenty emitRaw, ŚWIAT gry) dla pętli klatki efektów
   * rakiet — zapis bez przekazywania liczb przez argumenty; potem pushStaged(). null, gdy
   * pula nie istnieje.
   */
  stage() {
    if (!this.isInitialized || !pool) return null;
    ensureOrigin();
    return pool.s;
  },

  pushStaged() {
    if (pool) pool.push();
  },

  burst(gameX, gameY, count, speed, life, size, colorHex) {
    const color = colorHex ? colorToLinear(colorHex, _burstColor) : null;
    for (let n = 0; n < count; n++) {
      const angle = fxRandom.next() * Math.PI * 2;
      const spd = speed * (0.4 + fxRandom.next() * 0.6);
      const vx = Math.cos(angle) * spd;
      const vy = Math.sin(angle) * spd;
      const l = life * (0.6 + fxRandom.next() * 0.4);
      const s = size * (0.6 + fxRandom.next() * 0.4);
      this.emit(gameX, gameY, vx, vy, l, s, 1, color);
    }
  },

  /**
   * Zgodność: dawniej krok zegara iskier (tick overlaya). W grze czas i wysyłkę prowadzi
   * krok efektów Core3D; bez niego (Node, narzędzia) — zegar wewnętrzny.
   */
  update(dt) {
    if (!this.isInitialized || !pool || step) return;
    ownClock += Number(dt) > 0 ? Number(dt) : 0;
    pool.update(ownClock, 1);
  },

  // Tarcie i zderzenia kadłubów. `count` = ile iskier wysypać TERAZ: budżet
  // (tempo × czas styku) liczy subskrybent (src/vfx/collisionSparks.js), tu
  // zostaje kształt snopu. Prędkości styku w j./s — zbliżanie po normalnej
  // i poślizg — dają prędkość wyrzutu i kierunek (normalna vs styczna).
  // Jeden snop w jednym punkcie — fallback dla par bez próbek szwu (pointCount <= 1).
  grindingBurst(gameX, gameY, normalX, normalY, tangentX, tangentY, approachSpeed, slideSpeed, baseVx, baseVy, count, gain = 1) {
    if (!this.isInitialized) return;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 0) return;
    const shape = grindShape(approachSpeed, slideSpeed);
    // Snop z jednego punktu musi udawac caly szew, stad rozrzut z ENERGII.
    const spreadRadius = Math.min(180, shape.visualEnergy * 0.28);

    emitGrindCluster(
      gameX, gameY,
      normalX, normalY,
      tangentX, tangentY,
      n, shape.visualEnergy, spreadRadius,
      baseVx, baseVy, shape.bounceRatio, gain
    );
  },

  // Iskry wzdluz CALEGO szwu. `points` to Float32Array [x, y, nx, ny] x N —
  // probki kontaktow rozlozone po plamie styku, kazda z wlasna normalna
  // (na zakrzywionej burcie rozni sie od usrednionej).
  //
  // Budzet iskier jest TEN SAM co w grindingBurst — dzielimy go miedzy punkty,
  // nie mnozymy przez ich liczbe. Otarcie burta w burte ma wygladac na dluzsze,
  // nie na jasniejsze.
  grindingSeam(points, pointCount, tangentX, tangentY, approachSpeed, slideSpeed, baseVx, baseVy, count, gain = 1) {
    if (!this.isInitialized) return;

    const available = points ? (points.length >> 2) : 0;
    const n = Math.min(Math.max(0, pointCount | 0), available);
    if (n <= 0) return;
    const total = Math.max(0, Math.floor(Number(count) || 0));
    if (total <= 0) return;
    if (n === 1) {
      // Normalna kontaktu idzie z B do A; grindingBurst dostaje ja odwrocona
      // (patrz wywolanie sprzed rozbicia na szew) — zachowujemy ten sam zwrot.
      this.grindingBurst(
        points[0], points[1],
        -points[2], -points[3],
        tangentX, tangentY,
        approachSpeed, slideSpeed, baseVx, baseVy, total, gain
      );
      return;
    }

    const shape = grindShape(approachSpeed, slideSpeed);

    // Rozrzut wzdluz stycznej = POLOWA odstepu miedzy sasiednimi punktami.
    // Szew jest juz pokryty probkami, wiec kazdy snop ma tylko domknac luke do
    // sasiada — rozrzut z energii (grindingBurst) rozmazalby je jeden na drugim.
    const lastBase = (n - 1) * 4;
    const sdx = points[lastBase] - points[0];
    const sdy = points[lastBase + 1] - points[1];
    const seamLength = Math.sqrt(sdx * sdx + sdy * sdy);
    const spreadRadius = Math.max(4, (seamLength / (n - 1)) * 0.5);

    // Podział przez skumulowany próg z losowym przesunięciem: suma udziałów to
    // DOKŁADNIE `total`, a przy budżecie mniejszym niż liczba punktów iskry nie
    // lecą co krok z tych samych punktów szwu (stały próg faworyzował końce).
    const offset = fxRandom.next();
    let emitted = 0;
    for (let p = 0; p < n; p++) {
      const base = p * 4;
      const share = Math.floor((total * (p + 1)) / n + offset) - emitted;
      if (share <= 0) continue;
      emitted += share;

      emitGrindCluster(
        points[base], points[base + 1],
        -points[base + 2], -points[base + 3],
        tangentX, tangentY,
        share, shape.visualEnergy, spreadRadius,
        baseVx, baseVy, shape.bounceRatio, gain
      );
    }
  },

  /** Barwa domyślna kolejnych iskier `emit` bez jawnej barwy (żywe iskry jej nie zmieniają). */
  setColor(hex) {
    colorToLinear(hex, _defaultColor);
  },

  dispose() {
    if (step) { Core3D.removeFxStep(step); step = null; }
    if (pool) pool.dispose();
    pool = null;
    ownClock = 0;
    _defaultColor[0] = SPARK_COLORS.game[0]; _defaultColor[1] = SPARK_COLORS.game[1]; _defaultColor[2] = SPARK_COLORS.game[2];
    this.isInitialized = false;
  }
};
