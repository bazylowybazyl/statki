// src/3d/gas/destructionGasFx.js
//
// ZNISZCZENIA → WYBUCHY I DYM (demo destruktor3d-webgpu.html; plan docs/PLAN-zniszczenia-swiata-3d.md § 12).
// Zdarzenia silnika belek (destructorBeams3D) i broni fizycznych (beamPhysicalWeapons3D) zamienione na
// efekty gazu (GasSceneFx): solver liczy zniszczenie, tu tylko OBRAZ — nic nie zmienia fizyki.
//   • trafienia broni (pierścień efektów broni): działo — mały wybuch (seria: co ~0,09 s, między nimi
//     iskry), rakieta — wybuch budowli w miejscu frontu, Hexlance — wybuch wejścia + dogasające
//     ognisko w otworze, wiązka cieplna — ogień i dym topionego metalu;
//   • taran (styk z zgniotem): iskry tarcia wzdłuż normalnej styku, kłęby pyłu i dymu z gniecionego
//     metalu, przy dużej prędkości czasem zapłon (rozdarty zbiornik);
//   • odłam (nowy wrak): płonący kawałek — ognisko przypięte do węzła wraku, domena gazu jedzie z nim
//     (nośnik = prędkość wraku), dym ciągnie się za obrotem;
//   • ginący węzeł: czasem iskra;
//   • wybuch reaktora (reactor): kula ognia w środku bryły + front ciśnienia przez solver (weapons.detonate).
// Skala efektów z rozmiaru komórki silnika (cellSize). Losowanie z rng efektów (nie Math.random rozgrywki).

import { PW } from '../../game/beamPhysicalWeapons3D.js';

export class DestructionGasFx {
  /**
   * @param {object} o
   * @param {import('./gasSceneFx.js').GasSceneFx} o.fx
   * @param {object} o.system DestructorBeams3D
   * @param {import('../../game/beamPhysicalWeapons3D.js').PhysicalWeapons3D} [o.weapons]
   */
  constructor({ fx, system, weapons = null }) {
    this.fx = fx;
    this.system = system;
    this.weapons = weapons;
    this.rng = fx.rng;
    this.enabled = true;
    this.time = 0;
    this.bodies = [];
    this._last = { cannon: -1, lance: -1, beam: -1, contact: -1, debris: -1 };
    this._contactTimes = new WeakMap();
    this._contactBudget = 0;
    this.followers = [];
    this.stats = { weapon: 0, contact: 0, wreckFires: 0, sparks: 0 };
    this._n = [0, 1, 0];
  }

  _r(a = 0, b = 1) { return a + (b - a) * this.rng.next(); }

  get cs() { return this.system.config?.cellSize || 1; }

  /** Haki silnika i broni (łańcuchowo — poprzednie haki zostają). Wołać PO ustawieniu haków dema. */
  attach() {
    const sys = this.system;
    const prevContact = sys.onContact, prevWreck = sys.onWreck, prevDebris = sys.onDebris;
    sys.onContact = (A, B, info) => { if (prevContact) prevContact(A, B, info); if (this.enabled) this._contact(A, B, info); };
    sys.onWreck = (parent, wreck) => { if (prevWreck) prevWreck(parent, wreck); if (this.enabled) this._wreck(parent, wreck); };
    sys.onDebris = (body, node, wx, wy, wz, vx, vy, vz) => {
      if (prevDebris) prevDebris(body, node, wx, wy, wz, vx, vy, vz);
      if (this.enabled) this._debris(body, wx, wy, wz, vx, vy, vz);
    };
    const w = this.weapons;
    if (w) {
      const orig = w._effect.bind(w);
      w._effect = (kind, x, y, z, radius, life) => { orig(kind, x, y, z, radius, life); if (this.enabled) this._weapon(kind, x, y, z, radius); };
    }
    return this;
  }

  /** Normalna „na zewnątrz” w punkcie: od środka najbliższego ciała (bez normalnej z silnika). */
  _outward(x, y, z) {
    let best = null, bestD = Infinity;
    for (const B of this.bodies) {
      if (!B || B.dead || B.isProjectile) continue;
      const dx = x - B.pos.x, dy = y - B.pos.y, dz = z - B.pos.z;
      const d = dx * dx + dy * dy + dz * dz - (B.radius || 0) ** 2;
      if (d < bestD) { bestD = d; best = B; }
    }
    const n = this._n;
    if (!best) { n[0] = 0; n[1] = 1; n[2] = 0; return n; }
    let dx = x - best.pos.x, dy = y - best.pos.y, dz = z - best.pos.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    n[0] = dx / l; n[1] = dy / l; n[2] = dz / l;
    return n;
  }

  _weapon(kind, x, y, z, radius) {
    const cs = this.cs, fx = this.fx, d = fx.director, now = this.time;
    const n = this._outward(x, y, z);
    this.stats.weapon++;
    if (kind === PW.CANNON) {
      if (now - this._last.cannon > 0.09) {
        this._last.cannon = now;
        d.blast(x, y, z, cs * 2.2, n, { power: 0.5, puffs: 1, trails: this.rng.next() < 0.35 ? 1 : 0, life: 8 });
      } else {
        fx.sparks(x, y, z, n[0], n[1], n[2], cs * 2, 140, cs * 45, -1);
      }
    } else if (kind === PW.ROCKET) {
      d.building(x, y, z, Math.max(radius * 0.5, cs * 3.2), n, { power: 0.85, fires: 1, secondaries: this.rng.next() < 0.5 ? 1 : 0, trails: 4, life: 14 });
    } else if (kind === PW.LANCE) {
      if (now - this._last.lance > 0.35) {
        this._last.lance = now;
        const slot = d.blast(x, y, z, cs * 3.6, n, { power: 1.1, trails: 3, life: 14 });
        if (slot >= 0) d.fire(slot, x, y, z, cs * 1.3, 8, { up: n, fuel: 3.4, smoke: 1.8, lift: cs * 6, delay: 0.3 });
      } else {
        fx.sparks(x, y, z, n[0], n[1], n[2], cs * 2, 80, cs * 40, -1);
      }
    } else if (kind === PW.BEAM) {
      if (now - this._last.beam > 0.08) {
        this._last.beam = now;
        const g = fx.grid;
        const slot = g.acquire(x, y, z, cs * 2.2, { size: cs * 18, life: 9, now: g.time });
        if (slot >= 0) d.fire(slot, x, y, z, cs * 0.9, 1.3, { up: n, fuel: 2.6, temp: 4, smoke: 1.6, lift: cs * 5, flicker: 0.4 });
        // Krople stopionego metalu: wolne, długie, porywane przez gaz.
        if (fx.on.sparks) fx.embers.burst(x, y, z, n[0], n[1], n[2], 1.0, 24, cs * 4, cs * 18, 0.8, 2.2, cs * 0.12, 1.9, slot);
      }
    }
  }

  _contact(A, B, info) {
    const v = info.relSpeed || 0;
    if (!info.crushing || v < 25) return;
    const now = this.time;
    const last = this._contactTimes.get(A) ?? -1;
    if (now - last < 0.05 || this._contactBudget <= 0) return;
    this._contactTimes.set(A, now);
    this._contactBudget--;
    this.stats.contact++;
    const cs = this.cs, fx = this.fx, d = fx.director;
    const x = info.x, y = info.y, z = info.z;
    // Iskry tarcia: wzdłuż normalnej (obie strony styku) i na boki.
    const cnt = Math.min(700, Math.round(v * 1.6));
    fx.sparks(x, y, z, info.nx, info.ny, info.nz, cs * 3, cnt, v * 0.7 + cs * 25, -1);
    fx.sparks(x, y, z, -info.nx, -info.ny, -info.nz, cs * 3, Math.round(cnt * 0.4), v * 0.5 + cs * 20, -1);
    // Pył i dym gniecionego metalu; przy dużej prędkości czasem zapłon (rozdarty zbiornik, kable).
    const g = fx.grid;
    const slot = g.acquire(x, y, z, cs * 6, { size: cs * 30, life: 14, now: g.time });
    if (slot < 0) return;
    const ignite = v > 140 && this.rng.next() < 0.12;
    d.puff(slot, x, y, z, cs * (1.1 + Math.min(2.5, v / 120)), 0, 0.07, ignite ? 12 : 0, cs * Math.min(40, v * 0.06),
      { temp: ignite ? 6 : 0.25, smoke: 5 + Math.min(18, v * 0.04), velBlend: 18, noise: 0.6 });
    if (ignite) fx.addLight(x, y, z, 6, 0.5);
  }

  _wreck(parent, wreck) {
    if (!wreck || wreck.activeNodes < 40) return;
    let live = 0;
    for (const f of this.followers) if (f.alive) live++;
    if (live >= 3) return;
    const s = wreck.nodeStore;
    // Węzeł do przypięcia ogniska: losowy aktywny (zwykle na brzegu odłamu — rozerwana powierzchnia).
    let node = -1;
    for (let k = 0; k < 12 && node < 0; k++) {
      const i = Math.floor(this.rng.next() * s.count);
      if (s.active[i]) node = i;
    }
    if (node < 0) return;
    const p = this._nodeWorld(wreck, node, [0, 0, 0]);
    const cs = this.cs, fx = this.fx, g = fx.grid;
    const life = this._r(3.5, 8);
    const R = Math.max(cs * 3, Math.min(wreck.radius || cs * 6, cs * 12));
    const slot = g.acquire(p[0], p[1], p[2], R, {
      size: R * 6, life: life + 8, now: g.time, reuse: false,
      carrier: [wreck.vel.x, wreck.vel.y, wreck.vel.z]
    });
    if (slot < 0) return;
    const e = fx.director.fire(slot, p[0], p[1], p[2], R * 0.35, life, { fuel: 3.6, smoke: 2.2, lift: R * 1.5, flicker: 0.5, delay: 0.05 });
    if (!e) return;
    this.followers.push({ alive: true, body: wreck, node, emitter: e, end: this.time + life });
    this.stats.wreckFires++;
  }

  _debris(body, wx, wy, wz, vx, vy, vz) {
    if (this.rng.next() > 0.22) return;
    const fx = this.fx;
    if (!fx.on.sparks) return;
    const sp = Math.hypot(vx, vy, vz);
    const cs = this.cs;
    if (sp < 1e-3) return;
    fx.embers.burst(wx, wy, wz, vx / sp, vy / sp, vz / sp, 0.6, 5, sp * 0.6, sp * 1.4, 0.4, 1.1, cs * 0.12, 2.3, -1);
    this.stats.sparks++;
  }

  _nodeWorld(B, i, out) {
    const m = this.system._refreshRot(B), s = B.nodeStore;
    const x = s.x[i], y = s.y[i], z = s.z[i];
    out[0] = B.pos.x + m[0] * x + m[1] * y + m[2] * z;
    out[1] = B.pos.y + m[3] * x + m[4] * y + m[5] * z;
    out[2] = B.pos.z + m[6] * x + m[7] * y + m[8] * z;
    return out;
  }

  /**
   * WYBUCH REAKTORA ciała (np. stacji): kula ognia budowli w środku masy + front ciśnienia przez solver
   * (prędkość węzłów od środka — bryła pęka od wewnątrz). power — mnożnik (1 = moduł, 2 = reaktor).
   */
  reactor(body, power = 2) {
    if (!body || body.dead) return;
    const cs = this.cs;
    const R = Math.max(cs * 6, (body.radius || cs * 20) * 0.22);
    const x = body.pos.x, y = body.pos.y, z = body.pos.z;
    this.fx.director.building(x, y, z, R, [0, 1, 0], {
      power: 0.85 * power, trails: 14, secondaries: 3, fires: 4, fireTime: 6, domainScale: 5.8, life: 18
    });
    this.weapons?.detonate(x, y, z, (body.radius || R * 2) * 0.95, 2.2 * power, null);
  }

  /** Krok klatki (zegar dema): budżet styków, ogniska przypięte do wraków. Przed fx.update(). */
  update(dt, bodies) {
    this.time += dt;
    this.bodies = bodies;
    this._contactBudget = Math.min(30, this._contactBudget + dt * 60);
    const p = [0, 0, 0];
    for (const f of this.followers) {
      if (!f.alive) continue;
      const e = f.emitter;
      if (this.time > f.end || !f.body || f.body.dead || !f.body.nodeStore.active[f.node] || !e.alive) {
        f.alive = false;
        continue;
      }
      this._nodeWorld(f.body, f.node, p);
      e.x = p[0]; e.y = p[1]; e.z = p[2];
    }
    if (this.followers.length > 16) this.followers = this.followers.filter((f) => f.alive);
  }

  clear() {
    for (const f of this.followers) f.alive = false;
    this.followers.length = 0;
  }
}
