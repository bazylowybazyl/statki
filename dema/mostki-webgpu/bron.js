// Broń dema mostków: pociski jak w grze (pola fireWeaponCore — WeaponFx.sync rysuje je z
// window.bullets), błysk z szyny strzałów (WeaponShotBus), trafienie = krater jak applyHexImpact
// w grze (HullBodies.impact z kraterem na miarę rany ciężkiej broni i stemplem mapy ran) +
// receptura trafienia (WeaponFx.impact) + noteBridgeHit (kierunek wyrzutu atmosfery — gaz ucieka
// tunelem ostrzału). Hexlance: rzaz z pędem przez kadłub (odcina mostek z kawałkiem kadłuba).
import { HullBodies } from '../../src/game/hullBodies.js';
import { MASTER_WEAPONS } from '../../src/data/weapons.js';
import { WeaponShotBus } from '../../src/game/weaponShotBus.js';
import { WeaponFx } from '../../src/3d/weapons/weaponFx.js';
import { HullDamageMap } from '../../src/3d/hullDamageMap.js';
import { craterOptsFor } from '../../src/game/hullCraters.js';
import { SimClock, CLOCK_SIM } from '../../src/game/simClock.js';
import { noteBridgeHit } from '../../src/game/shipBridgeRuntime.js';

export const DEMO_WEAPONS = ['armata_mk1', 'heavy_autocannon', 'railgun_mk2', 'special_valkyrie_railgun', 'special_yamato_cannon'];

let _serial = 1;

export class Gun {
  constructor(world) {
    this.world = world;
    this.x = 0;
    this.y = 0;
    this.weaponId = DEMO_WEAPONS[0];
    this.cooldown = 0;
    this.rateMul = 0.35;   // demo strzela szybciej niż karta broni (tunel w kilka sekund)
    this.spreadMul = 1;    // 0 — bez rozrzutu (zbliżenie: pociski idą kanałem do mostka)
    this.shooter = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, isWreck: false, __demoGun: true };
    if (!Array.isArray(window.bullets)) window.bullets = [];
    this.bullets = window.bullets;
    this.lances = [];
    this.shots = 0;
    this._hit = { x: 0, y: 0, nx: 0, ny: 0, relVx: 0, relVy: 0, entity: null, through: false, ric: false };
  }

  get weapon() { return MASTER_WEAPONS[this.weaponId]; }

  place(x, y) {
    this.x = x; this.y = y;
    this.shooter.x = x; this.shooter.y = y;
  }

  /** Strzał w punkt (świat gry). Zwraca czas przeładowania albo 0 (jeszcze się ładuje). */
  fire(tx, ty, rng = Math.random) {
    const w = this.weapon;
    if (!w || this.cooldown > 0) return 0;
    const dx = tx - this.x, dy = ty - this.y;
    const base = Math.atan2(dy, dx);
    const spread = (Number(w.spread) || 0) * this.spreadMul;
    const a = base + (rng() - 0.5) * 2 * spread;
    const speed = Number(w.baseSpeed) || 3000;
    const range = Number(w.baseRange) || 8000;
    const dist = Math.hypot(dx, dy);
    const b = {
      x: this.x, y: this.y, px: this.x, py: this.y,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      ivx: 0, ivy: 0, clock: CLOCK_SIM, bornSim: SimClock.sim,
      life: Math.min(range, dist + 1600) / speed,
      r: w.size === 'L' ? 6 : (w.size === 'M' ? 4 : 2),
      owner: 'player', damage: Number(w.baseDamage) || 10, type: w.category, weaponSize: w.size || 'M',
      color: w.vfxColor, source: this.shooter, penetration: 0, explodeRadius: 0, target: null,
      vfxKey: w.id, serial: _serial++, mech: null, pen: null, dead: false
    };
    this.bullets.push(b);
    this.shots++;
    WeaponShotBus.emit(w.id, this.shooter, this.x, this.y, false, null, null, Math.cos(base), Math.sin(base));
    this.cooldown = Math.max(0.1, Number(w.cooldown) || 0.5) * this.rateMul;
    return this.cooldown;
  }

  /**
   * Hexlance (uproszczony superweapon.js): igła leci od (x0, y0) do (x1, y1) z prędkością `speed`,
   * w każdym kroku rzaz z pędem w trafionych kadłubach (pas `halfWidth`), receptury wejścia, rzazu
   * i wyjścia z puli WeaponFx.
   */
  lance(x0, y0, x1, y1, speed = 9000, halfWidth = 26) {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    const h = WeaponFx.available ? WeaponFx.hexlanceBegin(x0, y0, ux * speed, uy * speed) : null;
    if (WeaponFx.available) WeaponFx.hexlanceFire(x0, y0, ux, uy, null);
    this.lances.push({ x: x0, y: y0, ux, uy, speed, left: L, halfWidth, h, inside: new Set(), kerfAcc: 0 });
  }

  /** Krok pocisków: ruch, zamiatanie kadłubów, krater + receptura trafienia; igły Hexlance'a. */
  step(dt, entities) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const B = this.bullets;
    for (let i = B.length - 1; i >= 0; i--) {
      const b = B[i];
      if (b.dead) { B.splice(i, 1); continue; }
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      let best = null, bestT = 2, hx = 0, hy = 0;
      for (let k = 0; k < entities.length; k++) {
        const e = entities[k];
        const r = (Number(e.radius) || 200) + 40;
        const ex = e.x - b.x, ey = e.y - b.y;
        const segL = Math.hypot(b.x - b.px, b.y - b.py);
        if (ex * ex + ey * ey > (r + segL) * (r + segL)) continue;
        const hit = HullBodies.sweep(e, b.px, b.py, b.x, b.y, b.r);
        if (hit && hit.t < bestT) { bestT = hit.t; best = e; hx = hit.worldX; hy = hit.worldY; }
      }
      if (best) {
        this._impact(b, best, hx, hy);
        b.dead = true;
        B.splice(i, 1);
        continue;
      }
      if (b.life <= 0) { b.dead = true; B.splice(i, 1); }
    }
    for (let i = this.lances.length - 1; i >= 0; i--) {
      const n = this.lances[i];
      const step = Math.min(n.left, n.speed * dt);
      const x0 = n.x, y0 = n.y;
      const x1 = x0 + n.ux * step, y1 = y0 + n.uy * step;
      for (let k = 0; k < entities.length; k++) {
        const e = entities[k];
        const r = (Number(e.radius) || 200) + n.halfWidth;
        const cx = e.x - (x0 + x1) * 0.5, cy = e.y - (y0 + y1) * 0.5;
        if (cx * cx + cy * cy > (r + step) * (r + step)) continue;
        const hit = HullBodies.sweep(e, x0, y0, x1, y1, n.halfWidth * 0.5);
        if (hit && !n.inside.has(e)) {
          n.inside.add(e);
          noteBridgeHit(e, hit.worldX, hit.worldY, n.ux * n.speed, n.uy * n.speed, this.world.time);
          if (WeaponFx.available) WeaponFx.hexlanceImpact(hit.worldX, hit.worldY, n.ux * n.speed, n.uy * n.speed, null, 1, true);
        }
        if (n.inside.has(e)) {
          HullBodies.cutSegment(e, x0, y0, x1, y1, n.halfWidth, { push: true });
          n.kerfAcc += step;
          if (n.kerfAcc > 60 && WeaponFx.available) {
            n.kerfAcc = 0;
            WeaponFx.hexlanceKerf(x1, y1, n.ux * n.speed, n.uy * n.speed, null, 1);
          }
        }
      }
      if (n.h) WeaponFx.hexlanceStep(n.h, x0, y0, x1, y1, n.ux * n.speed, n.uy * n.speed);
      n.x = x1; n.y = y1; n.left -= step;
      if (n.left <= 1e-3) {
        if (n.h) WeaponFx.hexlanceEnd(n.h, x1, y1);
        this.lances.splice(i, 1);
      }
    }
  }

  /**
   * Precyzyjne trafienie (zbliżenie): pierwszy węzeł kadłuba na linii działo → (tx, ty) dostaje krater
   * o promieniu `radius` (bez budżetu HP) i lekką recepturę trafienia `vfxKey` — wyrwy bez błysków
   * ciężkiej broni zasłaniających model.
   */
  drill(e, tx, ty, radius, vfxKey = 'heavy_autocannon') {
    const dx = tx - this.x, dy = ty - this.y;
    const L = Math.hypot(dx, dy) || 1;
    const hit = HullBodies.sweep(e, this.x, this.y, tx + dx / L * 40, ty + dy / L * 40, 2);
    if (!hit) return false;
    const w = MASTER_WEAPONS[vfxKey] || this.weapon;
    const speed = Number(w?.baseSpeed) || 3000;
    const b = {
      x: hit.worldX, y: hit.worldY, px: this.x, py: this.y, vx: dx / L * speed, vy: dy / L * speed, ivx: 0, ivy: 0,
      clock: CLOCK_SIM, bornSim: SimClock.sim, life: 0, r: 4, owner: 'player', damage: Number(w?.baseDamage) || 10,
      type: w?.category, weaponSize: w?.size || 'M', color: w?.vfxColor, source: this.shooter, penetration: 0,
      explodeRadius: 0, target: null, vfxKey, serial: _serial++, mech: null, pen: null, dead: true
    };
    const x = hit.worldX, y = hit.worldY;
    const relVx = b.vx - (e.vx || 0), relVy = b.vy - (e.vy || 0);
    const vl = Math.hypot(relVx, relVy) || 1;
    const n = HullBodies.surfaceNormal(e, x, y, relVx / vl, relVy / vl);
    const nnx = n.nx, nny = n.ny;
    HullDamageMap.setSource(b, 'impact');
    try {
      HullBodies.impact(e, x, y, b.damage, { x: relVx, y: relVy }, { craterRadius: radius });
    } finally {
      HullDamageMap.clearSource();
    }
    noteBridgeHit(e, x, y, b.vx, b.vy, this.world.time);
    this.shots++;
    const h = this._hit;
    h.x = x; h.y = y; h.nx = nnx; h.ny = nny; h.relVx = relVx; h.relVy = relVy; h.entity = e; h.through = false; h.ric = false;
    if (WeaponFx.available) WeaponFx.impact(b, x, y, 0.6, h);
    return true;
  }

  _impact(b, e, x, y) {
    const relVx = b.vx - (e.vx || 0), relVy = b.vy - (e.vy || 0);
    const vl = Math.hypot(relVx, relVy) || 1;
    // normalna PRZED kraterem (krater zabija węzły)
    const n = HullBodies.surfaceNormal(e, x, y, relVx / vl, relVy / vl);
    const nnx = n.nx, nny = n.ny;
    const opts = craterOptsFor(b, 'impact', b.damage);
    HullDamageMap.setSource(b, 'impact');
    try {
      HullBodies.impact(e, x, y, b.damage, { x: relVx, y: relVy }, opts);
    } finally {
      HullDamageMap.clearSource();
    }
    noteBridgeHit(e, x, y, b.vx, b.vy, this.world.time);
    const h = this._hit;
    h.x = x; h.y = y; h.nx = nnx; h.ny = nny; h.relVx = relVx; h.relVy = relVy; h.entity = e; h.through = false; h.ric = false;
    if (WeaponFx.available) WeaponFx.impact(b, x, y, 1, h);
  }
}
