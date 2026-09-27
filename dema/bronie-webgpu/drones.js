// dema/bronie-webgpu/drones.js
//
// Cele dla obrony punktowej: myśliwce gry (assets/fighter-combat-v1.png,
// promień ~12 j. jak w weapons.js) latające po krzywych Lissajous między
// Atlasem a celem. PD i flak strzelają do nich z wyprzedzeniem; zestrzelony
// dron wybucha i po chwili wraca na skraju strefy.

import { LitQuadBatch } from './turrets.js';

export class DroneField {
  constructor({ scene, shared, image, count = 7 }) {
    this.batch = new LitQuadBatch({ scene, shared, renderOrder: 9, max: 32, name: 'drones' });
    this.image = image;
    this.active = false;
    this.zone = { x: 1480, y: 0, rx: 430, ry: 430 };
    this.targets = Array.from({ length: count }, (_, i) => this._make(i));
    this.time = 0;
  }

  _make(i) {
    return {
      i, x: 0, y: 0, vx: 0, vy: 0, r: 13, hp: 3, alive: true, respawn: 0, angle: 0,
      fx: 0.18 + Math.random() * 0.22, fy: 0.25 + Math.random() * 0.25,
      px: Math.random() * 6.28, py: Math.random() * 6.28, ax: 0.6 + Math.random() * 0.4, ay: 0.5 + Math.random() * 0.5
    };
  }

  setZone(x, y, rx, ry) { this.zone = { x, y, rx, ry }; }

  _pos(d, t, out) {
    const z = this.zone;
    out.x = z.x + Math.sin(t * d.fx * 2 + d.px) * z.rx * d.ax;
    out.y = z.y + Math.sin(t * d.fy * 2 + d.py) * z.ry * d.ay;
    return out;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const p = { x: 0, y: 0 };
    for (const d of this.targets) {
      if (!d.alive) {
        d.respawn -= dt;
        if (d.respawn <= 0) {
          d.alive = true;
          d.hp = 3;
          d.px = Math.random() * 6.28;
          d.py = Math.random() * 6.28;
        }
        continue;
      }
      this._pos(d, t, p);
      const nx = p.x; const ny = p.y;
      if (dt > 0) {
        d.vx = (nx - d.x) / dt;
        d.vy = (ny - d.y) / dt;
      }
      d.x = nx; d.y = ny;
      if (Math.hypot(d.vx, d.vy) > 1) d.angle = Math.atan2(d.vy, d.vx);
    }
  }

  /** Trafienie: zwraca true, gdy dron zginął. */
  damage(d, amount) {
    if (!d.alive) return false;
    d.hp -= amount;
    if (d.hp <= 0) {
      d.alive = false;
      d.respawn = 1.4 + Math.random();
      return true;
    }
    return false;
  }

  /** Wyprzedzenie celu (świat gry): punkt spotkania dla pocisku o prędkości speed. */
  lead(d, sx, sy, speed, out) {
    let tx = d.x; let ty = d.y;
    for (let k = 0; k < 3; k++) {
      const t = Math.hypot(tx - sx, ty - sy) / Math.max(1, speed);
      tx = d.x + d.vx * t;
      ty = d.y + d.vy * t;
    }
    out.x = tx; out.y = ty;
    return out;
  }

  nearest(x, y, range) {
    let best = null;
    let bd = range * range;
    for (const d of this.targets) {
      if (!d.alive) continue;
      const q = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (q < bd) { bd = q; best = d; }
    }
    return best;
  }

  commit() {
    const B = this.batch;
    B.begin();
    if (this.active && this.image) {
      B.setImage(this.image);
      for (const d of this.targets) {
        if (!d.alive) continue;
        B.quad(d.x, d.y, d.angle, 19, 19, 0, 1, 1, 0, 9);
      }
    }
    B.commit();
  }
}
