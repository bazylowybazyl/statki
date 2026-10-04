// Broń strzelnicy dema rdzenia: pociski jak w grze (pola fireWeaponCore — WeaponFx.sync rysuje
// je z window.bullets), błysk z szyny strzałów (WeaponShotBus), trafienie = krater jak
// applyHexImpact w grze (HullBodies.impact z kraterem na miarę rany ciężkiej broni i stemplem
// mapy ran) + receptura trafienia (WeaponFx.impact). Bez przebić i tarcz — strzelnica ma tylko
// odsłonić komorę reaktora.
import { HullBodies } from '../../src/game/hullBodies.js';
import { MASTER_WEAPONS } from '../../src/data/weapons.js';
import { WeaponShotBus } from '../../src/game/weaponShotBus.js';
import { WeaponFx } from '../../src/3d/weapons/weaponFx.js';
import { HullDamageMap } from '../../src/3d/hullDamageMap.js';
import { craterOptsFor } from '../../src/game/hullCraters.js';
import { SimClock, CLOCK_SIM } from '../../src/game/simClock.js';

export const DEMO_WEAPONS = ['armata_mk1', 'special_yamato_cannon', 'special_valkyrie_railgun', 'heavy_autocannon', 'railgun_mk2'];

let _serial = 1;

export class Gun {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.weaponId = DEMO_WEAPONS[0];
    this.cooldown = 0;
    // strzelec bez wieżyczki: WeaponFx bierze kierunek lufy z pól szyny (jak myśliwiec)
    this.shooter = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, isWreck: false, __demoGun: true };
    if (!Array.isArray(window.bullets)) window.bullets = [];
    this.bullets = window.bullets;
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
    const spread = Number(w.spread) || 0;
    const a = base + (rng() - 0.5) * 2 * spread;
    const speed = Number(w.baseSpeed) || 3000;
    const range = Number(w.baseRange) || 8000;
    const dist = Math.hypot(dx, dy);
    const b = {
      x: this.x, y: this.y, px: this.x, py: this.y,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      ivx: 0, ivy: 0, clock: CLOCK_SIM, bornSim: SimClock.sim,
      life: Math.min(range, dist + 1200) / speed,
      r: w.size === 'L' ? 6 : (w.size === 'M' ? 4 : 2),
      owner: 'player', damage: Number(w.baseDamage) || 10, type: w.category, weaponSize: w.size || 'M',
      color: w.vfxColor, source: this.shooter, penetration: 0, explodeRadius: 0, target: null,
      vfxKey: w.id, serial: _serial++, mech: null, pen: null, dead: false
    };
    this.bullets.push(b);
    WeaponShotBus.emit(w.id, this.shooter, this.x, this.y, false, null, null, Math.cos(base), Math.sin(base));
    this.cooldown = Math.max(0.12, Number(w.cooldown) || 0.5) * 0.35;
    return this.cooldown;
  }

  /** Krok pocisków: ruch, zamiatanie kadłubów, krater + receptura trafienia. */
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
    const h = this._hit;
    h.x = x; h.y = y; h.nx = nnx; h.ny = nny; h.relVx = relVx; h.relVy = relVy; h.entity = e; h.through = false; h.ric = false;
    if (WeaponFx.available) WeaponFx.impact(b, x, y, 1, h);
  }
}
