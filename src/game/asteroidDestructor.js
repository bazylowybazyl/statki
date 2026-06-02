/**
 * Brittle Asteroid Destructor - kruchy destruktor dla asteroid.
 *
 * NIE jest to rozszerzenie ship destructora. Asteroidy są kruche, nie plastyczne -
 * pomijamy GPU softbody, stress field, elasticity, bending, restitution. Trzymamy
 * tylko per-cell HP i prostą propagację pęknięcia po impulsie.
 *
 * Architektura:
 *   - 99%+ asteroid jest nietkniętych - mają damageState=null, ZERO kosztu
 *   - Po trafieniu: lazy acquire BrittleHexBody z puli
 *   - Hex symuluje pęknięcia przez ~6 klatek (burst), potem śpi
 *   - Asteroidy z aktywnym hex'em ale dawno trafione: idle, brak per-frame work
 *   - Zniszczenie: hex wraca do puli, asteroida znika z pola
 *
 * Pamięć: 200 hex bodies × 121 cells (BIG) × 4B (Float32) = ~97 KB. Trywialne.
 */

import {
  HEX_BRITTLE_CONFIG,
  COLLISION_CONFIG,
  getHexGridSize,
  getAsteroidRammingMass,
  getCollisionMass,
  getMass,
  getHardness,
} from '../data/asteroidPhysics.js';

// =============================================================================
// BrittleHexBody - per-asteroid hex grid HP
// =============================================================================

/**
 * Siatka heksów dla jednej asteroidy. Lazy-init, pula współdzielona.
 * Przechowuje tylko HP per cell - bez stress, deformation, velocity.
 */
class BrittleHexBody {
  constructor(maxGridSize = 11) {
    // Pre-allocate dla największego rozmiaru (BIG=11×11=121)
    const maxCells = maxGridSize * maxGridSize;
    this.cells = new Float32Array(maxCells);   // HP per cell
    this.cellsBase = new Float32Array(maxCells); // Początkowe HP per cell
    this.cellEjected = new Uint8Array(maxCells); // 1 = odłamany

    this.asteroid = null;
    this.gridSize = 9;
    this.cellCount = 0;
    this.aliveCount = 0;
    this.coreSize = 0;
    this.coreAlive = 0;
    this.burstFramesLeft = 0;
    this.destroyed = false;
    this.dirty = false;
    /** Lista cell ejected w ostatnim hicie - do generacji debris */
    this.pendingEjections = [];
  }

  init(asteroid) {
    const gs = getHexGridSize(asteroid.size);
    const total = gs * gs;
    this.gridSize = gs;
    this.cellCount = total;
    this.asteroid = asteroid;
    this.destroyed = false;
    this.burstFramesLeft = 0;
    this.dirty = false;
    this.pendingEjections.length = 0;

    const baseHP = asteroid.hpMax / total;
    for (let i = 0; i < total; i++) {
      this.cells[i] = baseHP;
      this.cellsBase[i] = baseHP;
      this.cellEjected[i] = 0;
    }
    this.aliveCount = total;

    // Policz rdzeniowe cells (środkowy block o promieniu coreRadius)
    const cr = HEX_BRITTLE_CONFIG.coreRadius;
    const center = (gs - 1) / 2;
    let coreCount = 0;
    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < gs; x++) {
        if (Math.abs(x - center) <= cr && Math.abs(y - center) <= cr) {
          coreCount++;
        }
      }
    }
    this.coreSize = coreCount;
    this.coreAlive = coreCount;
  }

  reset() {
    this.asteroid = null;
    this.aliveCount = 0;
    this.coreAlive = 0;
    this.coreSize = 0;
    this.burstFramesLeft = 0;
    this.destroyed = false;
    this.dirty = false;
    this.pendingEjections.length = 0;
  }

  /**
   * Trafienie w punkcie powierzchni asteroidy.
   * @param {number} localX [-1..+1] - X względem centrum asteroidy (znormalizowane)
   * @param {number} localY [-1..+1] - Y względem centrum
   * @param {number} damage - ilość HP do odjęcia w punkcie
   */
  hitAt(localX, localY, damage) {
    const gs = this.gridSize;
    const cx = Math.max(0, Math.min(gs - 1, Math.floor((localX * 0.5 + 0.5) * gs)));
    const cy = Math.max(0, Math.min(gs - 1, Math.floor((localY * 0.5 + 0.5) * gs)));
    return this.hitCell(cx, cy, damage);
  }

  /**
   * Trafienie w konkretną cell, propaguje na sąsiednie.
   * Zwraca liczbę cells które właśnie odłamały się tym hitem.
   */
  hitCell(cx, cy, damage) {
    const gs = this.gridSize;
    const radius = HEX_BRITTLE_CONFIG.impactRadius;
    const propFactor = HEX_BRITTLE_CONFIG.propagationFactor;
    let ejectedNow = 0;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= gs || ny < 0 || ny >= gs) continue;
        const idx = ny * gs + nx;
        if (this.cellEjected[idx]) continue;

        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        const falloff = cheb === 0 ? 1.0 : propFactor / cheb;
        const cellDamage = damage * falloff;

        this.cells[idx] -= cellDamage;
        if (this.cells[idx] <= HEX_BRITTLE_CONFIG.cellEjectThreshold) {
          this.cells[idx] = 0;
          this.cellEjected[idx] = 1;
          this.aliveCount--;
          ejectedNow++;
          // Track for debris/visual
          this.pendingEjections.push({ cx: nx, cy: ny, idx });
          if (this._isCore(nx, ny)) this.coreAlive--;
        }
      }
    }

    this.dirty = true;
    this.burstFramesLeft = HEX_BRITTLE_CONFIG.burstSimFrames;

    // Sprawdź czy rdzeń jest dostatecznie rozkruszony -> totalna destrukcja
    if (this.coreSize > 0) {
      const coreFracLost = 1 - (this.coreAlive / this.coreSize);
      if (coreFracLost >= HEX_BRITTLE_CONFIG.coreEjectFraction) {
        this.destroyed = true;
      }
    }
    // Albo gdy wszystkie cells odpadły
    if (this.aliveCount <= 0) this.destroyed = true;

    return ejectedNow;
  }

  /** Centrum bloku rdzeniowego? */
  _isCore(cx, cy) {
    const gs = this.gridSize;
    const center = (gs - 1) / 2;
    const cr = HEX_BRITTLE_CONFIG.coreRadius;
    return Math.abs(cx - center) <= cr && Math.abs(cy - center) <= cr;
  }

  /** Pobierz i wyczyść listę cells odłamanych w ostatnim hicie. */
  consumeEjections() {
    if (this.pendingEjections.length === 0) return null;
    const list = this.pendingEjections.slice();
    this.pendingEjections.length = 0;
    return list;
  }

  /** Frakcja żywych cells [0..1]. Używane do skalowania wizualnego. */
  livenessFraction() {
    if (this.cellCount === 0) return 1.0;
    return this.aliveCount / this.cellCount;
  }

  /** Per-frame update - dekrementuje burstFramesLeft. */
  update(_dt) {
    if (this.burstFramesLeft > 0) this.burstFramesLeft--;
  }

  /** Czy body nadal aktywny (potrzeba per-frame update)? */
  isActive() {
    return this.burstFramesLeft > 0 || this.destroyed;
  }

  /** Czy może iść do puli (poza grą)? */
  isDisposable() {
    return this.destroyed || (this.burstFramesLeft <= 0 && this.aliveCount === this.cellCount);
  }
}

// =============================================================================
// HexPool - pre-alokowana pula
// =============================================================================

class HexPool {
  constructor(size = HEX_BRITTLE_CONFIG.hexPoolSize) {
    this.size = size;
    this.free = [];
    for (let i = 0; i < size; i++) {
      this.free.push(new BrittleHexBody(11));
    }
    this.overflow = 0;
  }

  acquire() {
    if (this.free.length === 0) {
      this.overflow++;
      // Ad-hoc allocate when pool exhausted (will be GC'd, not pooled)
      return new BrittleHexBody(11);
    }
    return this.free.pop();
  }

  release(body) {
    if (!body) return;
    body.reset();
    if (this.free.length < this.size) {
      this.free.push(body);
    }
    // else: ad-hoc, let GC handle
  }

  stats() {
    return {
      capacity: this.size,
      free: this.free.length,
      inUse: this.size - this.free.length,
      overflow: this.overflow,
    };
  }
}

// =============================================================================
// AsteroidDestructor - manager spinający wszystko razem
// =============================================================================

export class AsteroidDestructor {
  constructor() {
    this.pool = new HexPool();
    /** Mapa asteroid.id → BrittleHexBody (tylko uszkodzone) */
    this.damaged = new Map();
  }

  /**
   * Aplikuje damage w punkcie świata (worldX, worldY) na asteroidę.
   * Lazy alokuje hex body jeśli to pierwsze trafienie.
   * @returns {{destroyed: boolean, ejectedCells: number, hexBody: BrittleHexBody|null}}
   */
  applyDamage(asteroid, worldX, worldY, damage) {
    if (!asteroid || !asteroid.alive) return { destroyed: false, ejectedCells: 0, hexBody: null };

    // Lazy alloc
    let hex = this.damaged.get(asteroid.id);
    if (!hex) {
      hex = this.pool.acquire();
      hex.init(asteroid);
      this.damaged.set(asteroid.id, hex);
    }

    // Lokalna pozycja [-1..+1] na powierzchni
    // Normalizujemy po realnym hitbox (collisionRadiusFactor), nie po pełnym sprite,
    // żeby trafienia w widoczną krawędź mapowały się na cells brzegowe.
    const halfScale = asteroid.scale * COLLISION_CONFIG.collisionRadiusFactor;
    const lx = halfScale > 0 ? (worldX - asteroid.worldX) / halfScale : 0;
    const ly = halfScale > 0 ? (worldY - asteroid.worldY) / halfScale : 0;
    const ejectedCells = hex.hitAt(lx, ly, damage);

    return {
      destroyed: hex.destroyed,
      ejectedCells,
      hexBody: hex,
    };
  }

  /** Per-frame: update wszystkich aktywnych destruktorów. */
  update(dt) {
    if (this.damaged.size === 0) return;
    for (const hex of this.damaged.values()) {
      hex.update(dt);
    }
  }

  /** Czy ta asteroida ma już aktywny destruktor? */
  hasDamage(asteroidId) {
    return this.damaged.has(asteroidId);
  }

  getHex(asteroidId) {
    return this.damaged.get(asteroidId) || null;
  }

  /** Zwalnia hex body i usuwa z mapy. Wywoływane gdy asteroida zniszczona. */
  release(asteroidId) {
    const hex = this.damaged.get(asteroidId);
    if (!hex) return;
    this.damaged.delete(asteroidId);
    this.pool.release(hex);
  }

  stats() {
    return {
      damagedAsteroids: this.damaged.size,
      pool: this.pool.stats(),
    };
  }
}

// =============================================================================
// COLLISION RESOLUTION - statek ↔ asteroida
// =============================================================================

/**
 * Próbuje rozstrzygnąć kolizję między statkiem a asteroidą używając PROPER
 * conservation of momentum (impulse along normal). Asteroidy mogą mieć vel != 0
 * (po wcześniejszym pchnięciu).
 *
 * Wzór impulse (collision normal n):
 *   relV = ship.vel - asteroid.vel
 *   j = -(1+e) * (relV . n) / (1/m_ship + 1/m_asteroid)
 *   Δv_ship = -j * n / m_ship   (wstecz)
 *   Δv_asteroid = +j * n / m_asteroid   (w przód kolizji)
 *
 * Skutek:
 *   - Lekka asteroida bumpnięta atlasem: asteroida przyspiesza dużo, ship traci mało
 *   - Równa masa: ship ~zatrzymuje się, asteroida przejmuje vel
 *   - BIG asteroida: ship odbija się jak od ściany, asteroida ledwo drgnie
 *
 * Zwraca null jeśli kolizji nie ma, inaczej:
 *   { collided, shipDamage, asteroidDamage, separationDx/Dy,
 *     shipVx/Vy (nowe), asteroidDvx/Dvy (delta velocity dla asteroidy) }
 */
export function resolveShipAsteroidCollision(ship, asteroid) {
  if (!ship || !asteroid || !asteroid.alive) return null;

  // Statek to wydłużony prostokąt obracający się. Atlas 3000×1000 (radius 500),
  // Battleship 1040×440. Circle hitbox jest niedokładny - używamy ORIENTED ELLIPSE
  // względem ship.angle. Dla NPC bez w/h (np. fighter z samym radius) fallback do circle.
  const tight = COLLISION_CONFIG.shipCollisionTighten;
  const astR = asteroid.scale * COLLISION_CONFIG.collisionRadiusFactor;

  // Pozycja asteroidy względem statku (world frame)
  const dx = ship.pos.x - asteroid.worldX;   // n będzie wzdłuż tego (z asteroidy na statek)
  const dy = ship.pos.y - asteroid.worldY;
  const dist2 = dx * dx + dy * dy;
  const dist = Math.sqrt(dist2) || 0.0001;

  let shipRdir;     // ellipse radius statku w kierunku asteroidy
  let halfL, halfH; // half-axes ellipse (do wykrywania + penetracji)

  if (ship.w && (ship.radius || ship.h)) {
    // ORIENTED ELLIPSE
    halfL = ship.w * 0.5 * tight;
    halfH = (ship.radius || ship.h * 0.5) * tight;
    const angle = ship.angle || 0;
    const cosA = Math.cos(-angle);
    const sinA = Math.sin(-angle);
    // Asteroida w lokalnym frame statku (-dx,-dy = asteroid - ship)
    const dxW = -dx;
    const dyW = -dy;
    const localX = dxW * cosA - dyW * sinA;
    const localY = dxW * sinA + dyW * cosA;
    // Ellipse test: (lx/a)² + (ly/b)² ≤ 1 (po dodaniu astR do osi)
    const aEff = halfL + astR;
    const bEff = halfH + astR;
    const ellipseTest = (localX * localX) / (aEff * aEff) + (localY * localY) / (bEff * bEff);
    if (ellipseTest > 1) return null;
    // Ellipse radius statku w kierunku asteroidy (analitycznie) - do penetracji
    const nLocalX = localX / dist;
    const nLocalY = localY / dist;
    const denom = (nLocalX * nLocalX) / (halfL * halfL) + (nLocalY * nLocalY) / (halfH * halfH);
    shipRdir = denom > 0 ? 1 / Math.sqrt(denom) : Math.min(halfL, halfH);
  } else {
    // CIRCLE fallback (NPCs bez w/h)
    shipRdir = (ship.radius || 30) * tight;
    if (dist >= shipRdir + astR) return null;
  }

  const sumR = shipRdir + astR;
  if (dist >= sumR) return null;

  const nx = dx / dist;
  const ny = dy / dist;
  const penetration = sumR - dist;

  const sv = ship.vel || { x: 0, y: 0 };
  const avx = asteroid.vx || 0;
  const avy = asteroid.vy || 0;

  // Relative velocity (ship względem asteroidy)
  const relVx = sv.x - avx;
  const relVy = sv.y - avy;
  const relVAlongN = relVx * nx + relVy * ny;
  const relSpeed = Math.hypot(relVx, relVy);

  // Jeśli się rozjeżdżają (relVAlongN > 0) - tylko separuj, brak transferu pędu
  if (relVAlongN >= 0) {
    return {
      collided: true,
      shipDamage: 0,
      asteroidDamage: 0,
      separationDx: nx * penetration * COLLISION_CONFIG.separationPadding,
      separationDy: ny * penetration * COLLISION_CONFIG.separationPadding,
      shipVx: sv.x,
      shipVy: sv.y,
      asteroidDvx: 0,
      asteroidDvy: 0,
      relSpeed,
      massRatio: 0,
    };
  }

  const asteroidCollisionMass = Number(asteroid.mass) > 0
    ? Number(asteroid.mass)
    : getCollisionMass(asteroid.type, asteroid.size);
  const asteroidRammingMass = Number(asteroid.rammingMass) > 0
    ? Number(asteroid.rammingMass)
    : getAsteroidRammingMass(asteroid.type, asteroid.size);
  const shipBaseMass = Number(ship.mass) > 0 ? Number(ship.mass) : 800000;
  const shipRammingMass = Number(ship.rammingMass) > 0 ? Number(ship.rammingMass) : shipBaseMass;
  const aMass = Math.max(1, asteroidCollisionMass, asteroidRammingMass);
  const sMass = Math.max(1, shipBaseMass, shipRammingMass);
  const massRatio = aMass / sMass;
  const closingSpeed = -relVAlongN;
  const hardWallCrash = (
    massRatio >= Math.max(1, Number(COLLISION_CONFIG.heavyRatio) || 5.0) &&
    closingSpeed >= Math.max(120, (Number(COLLISION_CONFIG.minImpactVelocity) || 30) * 4)
  );
  const e = hardWallCrash ? 0 : COLLISION_CONFIG.bounceCoeff;

  // Impulse magnitude wzdłuż normalnej (proper 2-body collision).
  // n = (ship - asteroid) / dist, czyli WSKAZUJE OD ASTEROIDY NA STATEK.
  // Z 3 zasady Newtona: A (ship) dostaje +j·n, B (asteroid) dostaje -j·n.
  // Tak samo jak ship-ship collision w destructor.js linia 2594-2595.
  const j = -(1 + e) * relVAlongN / (1 / sMass + 1 / aMass);
  const impulseX = j * nx;
  const impulseY = j * ny;

  // Nowe prędkości - SHIP dostaje +impulse (odpychany OD asteroidy w kierunku n).
  let newShipVx = sv.x + impulseX / sMass;
  let newShipVy = sv.y + impulseY / sMass;
  // Asteroid dostaje -impulse (Newton 3rd - reakcja przeciwna, w kierunku -n,
  // czyli w stronę ruchu statku - jest pchana przez statek).
  const asteroidDvx = -impulseX / aMass;
  const asteroidDvy = -impulseY / aMass;

  if (hardWallCrash) {
    const shipNormalAfter = newShipVx * nx + newShipVy * ny;
    const asteroidNormal = avx * nx + avy * ny;
    const relNormalAfter = shipNormalAfter - asteroidNormal;
    if (relNormalAfter < 0) {
      const keep = 0.04;
      const deltaN = (relNormalAfter * keep) - relNormalAfter;
      newShipVx += deltaN * nx;
      newShipVy += deltaN * ny;
    }
  }

  // Damage - jeśli kolizja była dostatecznie szybka
  let shipDamage = 0;
  let asteroidDamage = 0;
  if (relSpeed >= COLLISION_CONFIG.minImpactVelocity) {
    // KE absorbed = (1-e²) × 0.5 × reducedMass × relV².
    // Damage keeps the old legacy asteroid mass curve; full collision/ramming
    // mass is much higher and would make this fallback path one-shot capitals.
    const damageAsteroidMass = Number(asteroid.legacyMass) > 0
      ? Number(asteroid.legacyMass)
      : getMass(asteroid.type, asteroid.size);
    const reducedMass = (shipBaseMass * damageAsteroidMass) / (shipBaseMass + damageAsteroidMass);
    const ke = 0.5 * reducedMass * relSpeed * relSpeed;

    shipDamage = ke * COLLISION_CONFIG.shipDamageScale;
    asteroidDamage = ke * COLLISION_CONFIG.asteroidDamageScale;

    // Hardness: twardsza asteroida = mniej damage do siebie, więcej do statku
    const hardness = asteroid.hardness ?? getHardness(asteroid.type);
    asteroidDamage *= (1.0 - hardness * 0.7);
    shipDamage *= (1.0 + hardness * 0.5);
    if (hardWallCrash) {
      shipDamage *= Math.max(1, Number(COLLISION_CONFIG.crushDamageMultiplier) || 3.0);
    }

    // UWAGA: Mass-ratio modifiers wyłączone. Z ship_mass=800k każda asteroida
    // ma ratio <0.01 więc zawsze trafiałaby w "light" - statek nie dostawał damage.
    // KE samodzielnie ma odpowiednią skalę: BIG = duży damage, S = mały.
  }

  return {
    collided: true,
    shipDamage,
    asteroidDamage,
    separationDx: nx * penetration * COLLISION_CONFIG.separationPadding,
    separationDy: ny * penetration * COLLISION_CONFIG.separationPadding,
    shipVx: newShipVx,
    shipVy: newShipVy,
    asteroidDvx,
    asteroidDvy,
    relSpeed,
    massRatio,
  };
}
