// dema/bronie-webgpu/gunnery.js
//
// Sterowanie ogniem dema: gniazda Atlasa (ATLAS_EDITOR_DEFAULTS), celowanie
// wieżyczek z ograniczoną prędkością obrotu, kadencja i rozrzut z MASTER_WEAPONS,
// wzorce strzału (lufa po lufie, obie lufy, salwa Yamato, ładowanie, wiązki,
// salwy flak z zapalnikiem czasowym i zbliżeniowym), trafienia, przebicia,
// ogień w wyrwach i zegar opóźnionych zdarzeń. Wszystko w świecie gry.

import { ATLAS_EDITOR_DEFAULTS } from '../../src/data/atlasHardpointDefaults.js';
import { RECIPES, burnStep, droneBlast } from './recipes.js';
import { SIZE_POWER } from './arsenal.js';
import { BEAM } from './beams.js';

const BEAM_ON = 2.6;      // cykl wiązki ciągłej w trybie auto: włączona / przerwa [s]
const BEAM_OFF = 1.1;
const PULSE_SPEED = 42000;

export class Gunnery {
  constructor({ fx, lights, trails, projectiles, beams, turrets, atlas, target, drones }) {
    this.fx = fx;
    this.lights = lights;
    this.trails = trails;
    this.projectiles = projectiles;
    this.beams = beams;
    this.turrets = turrets;
    this.atlas = atlas;
    this.target = target;
    this.drones = drones;
    this.time = 0;
    this.events = [];
    this.burners = [];
    this.pulses = [];
    this.weapon = null;
    this.recipe = null;
    this.mountsAll = false;
    this.mountMode = 'pair';   // one | pair | all
    this.damageOn = true;
    this.shakeReq = { mag: 0, dur: 0 };
    this.lastImpact = null;
    this.lastProjectile = null;
    this.beamCycle = 0;
    this.stats = { shots: 0, hits: 0, pre: 0 };
    const self = this;
    this.ctx = {
      fx, lights, trails,
      get time() { return self.time; },
      after: (delay, fn) => self.events.push({ t: self.time + delay, fn }),
      shake: (mag, dur) => { if (mag > self.shakeReq.mag) { self.shakeReq.mag = mag; self.shakeReq.dur = dur; } },
      stamp: (hull, x, y, r, heat, scorch, hole, ion, dx = 0, dy = 0, elong = 1) => { if (hull && self.damageOn) hull.stamp(x, y, r, heat, scorch, hole, ion, dx, dy, elong); },
      burn: (hull, x, y, dur, power, pal) => self._burn(hull, x, y, dur, power, pal),
      spawnProjectile: (o) => self.projectiles.spawn({ owner: self.atlas, ...o })
    };
    this._cb = {
      impact: (p, hull) => this._impact(p, hull),
      kerf: (p, hull, x0, y0) => { if (p.recipe?.kerf) p.recipe.kerf(this.ctx, p, hull, x0, y0); },
      exit: (p, hull) => { if (p.recipe?.exit) p.recipe.exit(this.ctx, p, hull); },
      stuck: (p, hull) => { if (p.recipe?.stuck) p.recipe.stuck(this.ctx, p, hull); },
      fuse: (p) => this._flakBurst(p),
      expire: (p) => { if (p.flakR) this._flakBurst(p); },
      targetHit: (p, d) => this._targetHit(p, d),
      fly: (p, x0, y0, x1, y1, dt) => {
        if (p.recipe?.fly) p.recipe.fly(this.ctx, p, x0, y0, x1, y1, dt);
        if (p.light) this.lights.point(x1, y1, p.light[0], p.light[1], p.light[2], p.light[3], p.light[4], 30);
        this.lastProjectile = p;
      }
    };
  }

  /** Wybór broni i gniazd. */
  select(weapon, mode = this.mountMode) {
    this.weapon = weapon;
    this.mountMode = mode;
    const mountsAll = mode === 'all';
    this.recipe = RECIPES[weapon.fx];
    const hps = ATLAS_EDITOR_DEFAULTS.hardpoints.filter((h) => h.type === weapon.mount);
    const k = this.atlas.hpScale;
    let list = hps.map((h) => ({ lx: h.x * k, ly: h.y * k, rot: h.rot }));
    if (!mountsAll && list.length > 2) {
      // Para najbliżej celu (największe x = dziób): po jednym z każdej burty.
      list.sort((a, b) => b.lx - a.lx);
      const port = list.find((h) => h.ly < 0);
      const star = list.find((h) => h.ly > 0 && Math.abs(h.lx - (port ? port.lx : h.lx)) < 400);
      list = [port, star].filter(Boolean);
      if (!list.length) list = [hps[0]].map((h) => ({ lx: h.x * k, ly: h.y * k }));
    }
    if (mode === 'one' && list.length > 1) list = [list.sort((a, b) => a.ly - b.ly)[0]];
    for (const m of list) m.angle = this.atlas.angle;
    this.turrets.setWeapon(weapon.def, this.atlas, list);
    this.turrets.visible = weapon.mount !== 'builtin';
    for (const t of this.turrets.turrets) {
      t.cooldown = Math.random() * 0.4;
      t.aimAge = 99;
      t.charge = -1;
      t.beamOn = 0;
    }
    this.beamCycle = 0;
    this.drones.active = !!weapon.pd;
    this.pulses.length = 0;
  }

  _burn(hull, x, y, dur, power, pal) {
    if (this.burners.length > 24) this.burners.shift();
    const n = hull ? hull.normalAt(x, y, { x: 0, y: 0 }) : { x: 1, y: 0 };
    this.burners.push({ x, y, dur, age: 0, power, pal, seed: Math.random() * 100, N: { x: n.x, y: -n.y } });
  }

  /** Punkt celowania na kadłubie celu: losowy punkt wzdłuż jego osi. */
  _pickHullAim(t) {
    const h = this.target;
    const along = (Math.random() - 0.5) * h.w * 0.75;
    const across = (Math.random() - 0.5) * h.h * 0.35;
    const c = Math.cos(h.angle); const s = Math.sin(h.angle);
    t.aimX = h.x + along * c - across * s;
    t.aimY = h.y + along * s + across * c;
    t.aimAge = 0;
    t.aimLife = 0.9 + Math.random() * 1.2;
  }

  /**
   * Klatka: dt — czas symulacji (po zwolnieniu), input: { aim: {x, y} | null,
   * fire: bool (auto albo przycisk) }.
   */
  update(dt, input) {
    this.time += dt;
    // zdarzenia opóźnione
    if (this.events.length) {
      const now = this.time;
      for (let i = this.events.length - 1; i >= 0; i--) {
        const e = this.events[i];
        if (e.t <= now) {
          this.events[i] = this.events[this.events.length - 1];
          this.events.pop();
          e.fn();
        }
      }
    }
    const w = this.weapon;
    const T = this.turrets;
    const def = w.def;
    const R = this.recipe;
    const beamsNow = this.beams;
    beamsNow.begin();
    if (w.pattern === 'beam') {
      this.beamCycle += dt;
      if (this.beamCycle > BEAM_ON + BEAM_OFF) this.beamCycle = 0;
    }
    for (const t of T.turrets) {
      t.aimAge += dt;
      // cel: kursor > dron (PD) > punkt na kadłubie celu
      let ax; let ay;
      const muzzle0 = T.muzzle(t, 0, _m);
      if (input.aim) {
        ax = input.aim.x; ay = input.aim.y;
      } else if (w.pd && this.drones.active) {
        const d = this.drones.nearest(muzzle0.x, muzzle0.y, Math.max(1600, def.baseRange * 1.2));
        if (d) {
          const sp = Number.isFinite(def.baseSpeed) ? def.baseSpeed : 1e9;
          this.drones.lead(d, muzzle0.x, muzzle0.y, sp, _a);
          ax = _a.x; ay = _a.y;
          t.lock = d;
        } else {
          ax = this.drones.zone.x; ay = this.drones.zone.y;
          t.lock = null;
        }
      } else {
        if (t.aimAge > (t.aimLife || 1)) this._pickHullAim(t);
        ax = t.aimX; ay = t.aimY;
        if (w.pattern === 'beam') {
          // wiązka ciągła: powolne przeciągnięcie po burcie (tnie linię)
          const h = this.target;
          const sweep = Math.sin(this.time * 0.55 + t.index * 1.7) * h.w * 0.32;
          ax = h.x + Math.cos(h.angle) * sweep;
          ay = h.y + Math.sin(h.angle) * sweep;
        }
      }
      const turn = w.mount === 'builtin' ? 0 : (w.pattern === 'beam' ? 1.2 : 3.2);
      let err = 0;
      if (w.mount === 'builtin') {
        t.angle = this.atlas.angle;
      } else {
        err = T.aim(t, ax, ay, dt, turn);
      }
      t.cooldown -= dt;
      const wantFire = input.fire;
      if (w.pattern === 'beam') {
        this._beamContinuous(t, dt, wantFire && this.beamCycle < BEAM_ON, err);
        continue;
      }
      if (w.pattern === 'charge') {
        this._chargeStep(t, dt, wantFire, err);
        continue;
      }
      if (!wantFire || t.cooldown > 0 || err > 0.05) continue;
      if (w.pd && !input.aim && !t.lock && w.pattern !== 'salvo') continue;
      t.cooldown = def.cooldown * (0.92 + Math.random() * 0.16);
      this._shoot(t, ax, ay);
    }
    // impulsy wiązek (puls, PD): rysunek i trafienie, gdy front dojdzie do celu
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pu = this.pulses[i];
      pu.age += dt;
      const style = pu.style;
      if (!pu.hitDone && pu.age >= pu.hitAt) {
        pu.hitDone = true;
        if (pu.hit) {
          if (pu.drone) {
            this._droneDamage(pu.drone, 1, pu.hit.x, pu.hit.y);
            R.impact?.(this.ctx, null, pu.hit);
          } else {
            R.impact?.(this.ctx, pu.hull, pu.hit);
          }
        }
      }
      if (pu.age >= pu.life) { this.pulses[i] = this.pulses[this.pulses.length - 1]; this.pulses.pop(); continue; }
      const u = pu.age / pu.life;
      const power = Math.pow(1 - u, 1.2) * (style === BEAM.PULSE ? 1 : 1);
      const wdt = pu.width * (0.45 + 0.75 * (1 - u));
      beamsNow.add(pu.x0, pu.y0, pu.x1, pu.y1, style, wdt, pu.col, power, pu.seed, pu.age);
      if (pu.hit && style === BEAM.PULSE) this.lights.point(pu.hit.x, pu.hit.y, 1.0, 0.3, 0.3, 2 * power, 180, 30);
    }
    // ogień w wyrwach
    for (let i = this.burners.length - 1; i >= 0; i--) {
      const b = this.burners[i];
      b.age += dt;
      if (b.age >= b.dur) { this.burners.splice(i, 1); continue; }
      if (dt > 0) burnStep(this.ctx, b, dt);
    }
    // pociski
    this.projectiles.step(dt, [this.target], this.drones.active ? this.drones.targets : null, this._cb);
  }

  /** Jeden strzał wieżyczki wg wzorca broni. */
  _shoot(t, ax, ay) {
    const w = this.weapon;
    const T = this.turrets;
    const R = this.recipe;
    const pattern = w.pattern;
    if (pattern === 'twin') {
      const fireAll = () => { for (let b = 0; b < T.barrelCount; b++) this._fireBarrel(t, b, ax, ay, true); };
      if (R.leadIn) {
        for (let b = 0; b < T.barrelCount; b++) R.preFire?.(this.ctx, { ...T.muzzle(t, b, _m) }, w);
        this.stats.pre++;
        this.ctx.after(R.leadIn, fireAll);
      } else fireAll();
      return;
    }
    if (pattern === 'yamato') {
      const order = [1, 0, 2];
      const delays = [0, 0.085 + Math.random() * 0.035, 0.17 + Math.random() * 0.035];
      for (let k = 0; k < 3; k++) {
        const b = order[k] % T.barrelCount;
        this.ctx.after(delays[k], () => this._fireBarrel(t, b, ax, ay, true));
      }
      return;
    }
    if (pattern === 'salvo') {
      const n = Math.max(1, w.def.burstCount || 1);
      for (let k = 0; k < n; k++) this._fireBarrel(t, k % T.barrelCount, ax, ay, k === 0, k);
      return;
    }
    if (pattern === 'alt' && (w.fx === 'beamP')) {
      this._firePulseBeam(t, ax, ay);
      return;
    }
    if (pattern === 'pdbeam') {
      this._firePulseBeam(t, ax, ay);
      return;
    }
    if (R.leadIn) {
      const b = pattern === 'alt' ? -1 : 0;
      const m = T.muzzle(t, b < 0 ? t.nextBarrel % T.barrelCount : 0, _m);
      R.preFire?.(this.ctx, { ...m }, w);
      this.stats.pre++;
      this.ctx.after(R.leadIn, () => this._fireBarrel(t, b, ax, ay, true));
      return;
    }
    this._fireBarrel(t, pattern === 'alt' ? -1 : 0, ax, ay, true);
  }

  _fireBarrel(t, barrel, ax, ay, withMuzzle = true, salvoIndex = 0) {
    const w = this.weapon;
    const def = w.def;
    const R = this.recipe;
    const m = this.turrets.fire(t, w.recoil, { x: 0, y: 0, angle: 0, scale: 1, barrel: 0 }, barrel);
    if (w.mount === 'builtin') this._builtinMuzzle(m);
    if (withMuzzle || w.pattern === 'twin') R.muzzle?.(this.ctx, m, w);
    this.stats.shots++;
    const conf = R.projectile ? R.projectile(w, m) : null;
    if (!conf) return;
    const spread = (Math.random() - 0.5) * (def.spread || 0) * (w.pattern === 'salvo' ? 2.2 : 1);
    const a = m.angle + spread;
    const speed = def.baseSpeed;
    const range = def.baseRange;
    const p = this.projectiles.spawn({
      x: m.x, y: m.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      life: range / speed, recipe: R, weapon: w, power: SIZE_POWER[def.size] || 1, owner: this.atlas,
      ...conf
    });
    if (def.category === 'flak') {
      const dist = Math.hypot(ax - m.x, ay - m.y);
      p.flakR = def.flakBurstRadius;
      p.fuseRadius = def.flakFuseRadius;
      p.hitsTargets = true;
      p.fuse = Math.min(p.life, dist / speed * (0.94 + Math.random() * 0.12) + salvoIndex * 0.02);
    }
    this.lastProjectile = p;
  }

  /** Hexlance: wylot z gniazda wbudowanego, kierunek dziobu (jak superweapon.js). */
  _builtinMuzzle(m) {
    const hp = ATLAS_EDITOR_DEFAULTS.hardpoints.find((h) => h.type === 'builtin');
    const k = this.atlas.hpScale;
    const c = Math.cos(this.atlas.angle); const s = Math.sin(this.atlas.angle);
    const lx = hp.x * k + 30; const ly = hp.y * k;
    m.x = this.atlas.x + lx * c - ly * s;
    m.y = this.atlas.y + lx * s + ly * c;
    m.angle = this.atlas.angle;
    m.scale = 1;
  }

  /** Broń z ładowaniem (Hexlance, Mjolnir, Valkyrie). */
  _chargeStep(t, dt, wantFire, err) {
    const w = this.weapon;
    const R = this.recipe;
    const T = this.turrets;
    if (t.charge < 0) {
      if (!wantFire || t.cooldown > 0 || err > 0.08) return;
      t.charge = 0;
    }
    t.charge += dt;
    const u = Math.min(1, t.charge / w.charge);
    const m = w.mount === 'builtin' ? this._builtinMuzzleOnly() : T.muzzle(t, t.nextBarrel % T.barrelCount, _m);
    if (dt > 0) R.charge?.(this.ctx, m, u, dt);
    if (t.charge >= w.charge && err < 0.03) {
      t.charge = -1;
      t.cooldown = w.def.cooldown;
      this._fireBarrel(t, w.alt ? -1 : 0, t.aimX, t.aimY, true);
    }
  }

  _builtinMuzzleOnly() {
    const m = { x: 0, y: 0, angle: 0, scale: 1 };
    this._builtinMuzzle(m);
    return m;
  }

  /** Wiązka ciągła: ładunek rośnie +8/s, gaśnie −3,2/s (jak w grze). */
  _beamContinuous(t, dt, on, err) {
    const R = this.recipe;
    const cfg = R.beam;
    const was = t.beamOn;
    t.beamOn = on && err < 0.2 ? Math.min(1, t.beamOn + dt * cfg.rampUp) : Math.max(0, t.beamOn - dt * cfg.rampDown);
    if (was <= 0.001 && t.beamOn > 0.001) this.stats.shots++;
    if (t.beamOn <= 0.001) return;
    const m = this.turrets.muzzle(t, 0, _m);
    const reach = this.weapon.def.baseRange;
    const ex = m.x + Math.cos(m.angle) * reach;
    const ey = m.y + Math.sin(m.angle) * reach;
    const f = this.target.raycast(m.x, m.y, ex, ey, 6);
    let hit = null;
    let x1 = ex; let y1 = ey;
    if (f >= 0) {
      x1 = m.x + (ex - m.x) * f;
      y1 = m.y + (ey - m.y) * f;
      const n = this.target.normalAt(x1, y1, { x: 0, y: 0 });
      hit = { x: x1, y: y1, nx: n.x, ny: n.y };
      this.lastImpact = hit;
    }
    const c = t.beamOn;
    const width = cfg.width * (0.3 + 0.7 * Math.sqrt(c));
    this.beams.add(m.x, m.y, x1, y1, cfg.style, width, cfg.col, c, t.index * 0.37, this.time);
    if (dt > 0) R.emit(this.ctx, m, hit, c, dt, hit ? this.target : null);
    this.turrets.turrets[t.index].housing = Math.max(t.housing, 0.4 * c);
  }

  /** Impuls wiązki (puls, laser PD): front leci do celu, trafienie po dojściu. */
  _firePulseBeam(t, ax, ay) {
    const w = this.weapon;
    const R = this.recipe;
    const cfg = R.beam;
    const m = this.turrets.fire(t, w.recoil, { x: 0, y: 0, angle: 0, scale: 1 }, -1);
    R.muzzle?.(this.ctx, m, w);
    this.stats.shots++;
    const reach = Math.min(w.def.baseRange, w.pd ? 1000 : w.def.baseRange);
    let x1 = m.x + Math.cos(m.angle) * reach;
    let y1 = m.y + Math.sin(m.angle) * reach;
    let hit = null; let hull = null; let drone = null;
    if (w.pd) {
      const d = t.lock;
      if (d && d.alive && Math.hypot(d.x - m.x, d.y - m.y) < reach + 60) {
        x1 = d.x; y1 = d.y;
        hit = { x: d.x, y: d.y, nx: -Math.cos(m.angle), ny: -Math.sin(m.angle) };
        drone = d;
      }
    }
    if (!hit) {
      const f = this.target.raycast(m.x, m.y, x1, y1, 6);
      if (f >= 0) {
        x1 = m.x + (x1 - m.x) * f;
        y1 = m.y + (y1 - m.y) * f;
        const n = this.target.normalAt(x1, y1, { x: 0, y: 0 });
        hit = { x: x1, y: y1, nx: n.x, ny: n.y };
        hull = this.target;
        this.lastImpact = hit;
      }
    }
    const dist = Math.hypot(x1 - m.x, y1 - m.y);
    this.pulses.push({
      x0: m.x, y0: m.y, x1, y1, style: cfg.style, width: cfg.width, col: cfg.col, life: cfg.life,
      age: 0, hit, hull, drone, hitAt: cfg.style === BEAM.PULSE ? dist / PULSE_SPEED : 0.01, hitDone: false, seed: Math.random() * 10
    });
  }

  _impact(p, hull) {
    const n = hull.normalAt(p.x, p.y, { x: 0, y: 0 });
    const hit = { x: p.x, y: p.y, nx: n.x, ny: n.y };
    this.lastImpact = hit;
    this.stats.hits++;
    if (p.recipe?.impact) return p.recipe.impact(this.ctx, p, hull, hit);
    return undefined;
  }

  _flakBurst(p) {
    const R = this.recipe;
    const r = p.flakR || 150;
    if (R.burst) R.burst(this.ctx, p.x, p.y, r);
    this.lastImpact = { x: p.x, y: p.y, nx: 1, ny: 0 };
    // odłamki: drony w kuli rażenia (pełne obrażenia w środku, 35% na brzegu)
    for (const d of this.drones.targets) {
      if (!d.alive) continue;
      const q = Math.hypot(d.x - p.x, d.y - p.y);
      if (q < r) this._droneDamage(d, q < r * 0.45 ? 3 : 1.2, d.x, d.y);
    }
  }

  _targetHit(p, d) {
    if (p.flakR) { this._flakBurst(p); return; }
    const R = p.recipe;
    const hit = { x: p.x, y: p.y, nx: -p.vx / (Math.hypot(p.vx, p.vy) || 1), ny: -p.vy / (Math.hypot(p.vx, p.vy) || 1) };
    if (R?.impact) R.impact(this.ctx, p, null, hit);
    this._droneDamage(d, 1, p.x, p.y);
  }

  _droneDamage(d, amount, x, y) {
    if (this.drones.damage(d, amount)) {
      droneBlast(this.ctx, d.x, d.y, 42);
      this.lastImpact = { x: d.x, y: d.y, nx: 1, ny: 0 };
    }
  }

  /** Wstrząs zgłoszony w tej klatce (mag, dur) — kamera czyta i zeruje. */
  takeShake() {
    const r = { mag: this.shakeReq.mag, dur: this.shakeReq.dur };
    this.shakeReq.mag = 0;
    return r;
  }

  clear() {
    this.projectiles.clear();
    this.events.length = 0;
    this.burners.length = 0;
    this.pulses.length = 0;
  }
}

const _m = { x: 0, y: 0, angle: 0, scale: 1, barrel: 0 };
const _a = { x: 0, y: 0 };
