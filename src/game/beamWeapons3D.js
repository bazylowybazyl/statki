// Demo weapons: bounded pools and swept collision against the deforming lattice.
// No rigid body per bullet, and no temporary objects in projectile updates.
export const LASER = 0, MISSILE = 1;
export const LASER_RATE = 18, MISSILE_RATE = 1.5;
export const BLAST_DURATION = 0.22;
const pressureProgress = age => {
  const t = Math.min(1, Math.max(0, age / BLAST_DURATION));
  return t * t * (3 - 2 * t);
};

export function traceBeamShot(system, bodies, owner, ox, oy, oz, dx, dy, dz, distance, out) {
  out.body = null; out.t = distance;
  for (const body of bodies) {
    if (body === owner || body.dead) continue;
    const px = body.pos.x - ox, py = body.pos.y - oy, pz = body.pos.z - oz;
    const along = Math.max(0, Math.min(out.t, px * dx + py * dy + pz * dz));
    const sx = px - dx * along, sy = py - dy * along, sz = pz - dz * along;
    const radius = body.radius + body.cellSize;
    if (sx * sx + sy * sy + sz * sz > radius * radius) continue;
    const m = system._refreshRot(body);
    const lx = -m[0] * px - m[3] * py - m[6] * pz;
    const ly = -m[1] * px - m[4] * py - m[7] * pz;
    const lz = -m[2] * px - m[5] * py - m[8] * pz;
    const vx = m[0] * dx + m[3] * dy + m[6] * dz;
    const vy = m[1] * dx + m[4] * dy + m[7] * dz;
    const vz = m[2] * dx + m[5] * dy + m[8] * dz;
    const nr = body.cellSize * 0.72, bounds = body._localBounds;
    let near = 0, far = out.t;
    if (bounds) for (let axis = 0; axis < 3; axis++) {
      const p = axis === 0 ? lx : axis === 1 ? ly : lz;
      const d = axis === 0 ? vx : axis === 1 ? vy : vz;
      const lo = bounds[axis] - bounds[axis + 3] - nr;
      const hi = bounds[axis] + bounds[axis + 3] + nr;
      if (Math.abs(d) < 1e-10) { if (p < lo || p > hi) { far = -1; break; } }
      else {
        const a = (lo - p) / d, b = (hi - p) / d;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      }
    }
    if (near > far) continue;
    const s = body.nodeStore, nx = s.x, ny = s.y, nz = s.z, active = s.active;
    let best = -1;
    for (let i = 0; i < s.count; i++) {
      if (!active[i]) continue;
      const x = nx[i] - lx, y = ny[i] - ly, z = nz[i] - lz;
      const t = x * vx + y * vy + z * vz;
      const perpendicular = Math.max(0, x * x + y * y + z * z - t * t);
      if (perpendicular > nr * nr) continue;
      const half = Math.sqrt(nr * nr - perpendicular);
      if (t + half < 0) continue;
      const entry = Math.max(0, t - half);
      if (entry > out.t) continue;
      out.t = entry; out.body = body; best = i;
    }
    if (best < 0) continue;
    const entry = out.t;
    // Indeks w body.nodeStore (widok: body.nodes[i]) — bez tymczasowych obiektów na trafienie.
    out.nodeIndex = best;
    out.x = ox + dx * entry; out.y = oy + dy * entry; out.z = oz + dz * entry;
    out.cx = body.pos.x + m[0] * nx[best] + m[1] * ny[best] + m[2] * nz[best];
    out.cy = body.pos.y + m[3] * nx[best] + m[4] * ny[best] + m[5] * nz[best];
    out.cz = body.pos.z + m[6] * nx[best] + m[7] * ny[best] + m[8] * nz[best];
  }
  return out.body !== null;
}

export class BeamWeapons3D {
  // opts: prędkości pocisków, odległość zbieżności luf i oś rozstawu luf
  // (2 = lokalne Z kadłuba 3D, 1 = lokalne Y kadłuba 2D w płaszczyźnie gry).
  constructor(system, capacity = 256, opts = {}) {
    this.system = system;
    this.laserSpeed = opts.laserSpeed ?? 620;
    this.missileSpeed = opts.missileSpeed ?? 165;
    this.convergence = opts.convergence ?? 450;
    this.sideAxis = opts.sideAxis === 1 ? 1 : 2;
    this.projectiles = Array.from({ length: capacity }, () => ({ active: false, owner: null,
      kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 0, damage: 0, radius: 0 }));
    this.effects = Array.from({ length: 64 }, () => ({ active: false, x: 0, y: 0, z: 0, age: 0, life: 0, radius: 0, kind: 0 }));
    this.blasts = Array.from({ length: 32 }, () => ({ active: false, owner: null, x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0, age: 0, damage: 0, radius: 0 }));
    this.hit = {}; this.impulse = { x: 0, y: 0, z: 0 };
    this.impact = { radius: 0, breakRadius: 0, damageFraction: 1, breakProgress: 1, impulseTime: 0 };
    this.stats = { lasers: 0, missiles: 0, hits: 0, laserHits: 0, missileHits: 0, active: 0 };
    this.reset();
  }

  reset() {
    for (const p of this.projectiles) { p.active = false; p.owner = null; }
    for (const e of this.effects) e.active = false;
    for (const blast of this.blasts) { blast.active = false; blast.owner = null; }
    this.cursor = this.effectCursor = this.laserWait = this.missileWait = this.barrel = 0;
    for (const k in this.stats) this.stats[k] = 0;
  }

  fire(kind, owner, damage = 450, blastCells = 3) {
    if (!owner || owner.dead || owner.static) return false;
    let p = null;
    for (let j = 0; j < this.projectiles.length; j++) {
      const index = (this.cursor + j) % this.projectiles.length;
      if (!this.projectiles[index].active) { p = this.projectiles[index]; this.cursor = (index + 1) % this.projectiles.length; break; }
    }
    if (!p) return false;
    const m = this.system._refreshRot(owner), b = owner._localBounds, ax = this.sideAxis;
    const nose = b ? b[0] + b[3] + owner.cellSize : owner.radius;
    const side = (this.barrel++ % 2 ? 1 : -1) * (b ? b[3 + ax] * 0.6 : owner.radius * 0.25);
    p.x = owner.pos.x + m[0] * nose + m[ax] * side;
    p.y = owner.pos.y + m[3] * nose + m[3 + ax] * side;
    p.z = owner.pos.z + m[6] * nose + m[6 + ax] * side;
    // Fixed forward guns converge slightly; both weapons inherit ship velocity.
    const conv = this.convergence;
    let dx = m[0] * conv - m[ax] * side, dy = m[3] * conv - m[3 + ax] * side, dz = m[6] * conv - m[6 + ax] * side;
    const speed = kind === LASER ? this.laserSpeed : this.missileSpeed, factor = speed / Math.hypot(dx, dy, dz);
    p.vx = dx * factor + owner.vel.x; p.vy = dy * factor + owner.vel.y; p.vz = dz * factor + owner.vel.z;
    p.kind = kind; p.owner = owner; p.age = 0; p.life = kind === LASER ? 2.4 : 6;
    p.damage = damage * (kind === LASER ? 0.3 : 2);
    p.radius = this.system.config.cellSize * (kind === LASER ? 1.15 : blastCells);
    p.active = true;
    this.stats[kind === LASER ? 'lasers' : 'missiles']++;
    return true;
  }

  triggers(dt, owner, laser, missile, damage = 450, blastCells = 3) {
    this.laserWait = Math.max(-dt, this.laserWait - dt);
    this.missileWait = Math.max(-dt, this.missileWait - dt);
    if (laser && this.laserWait <= 1e-8 && this.fire(LASER, owner, damage, blastCells)) this.laserWait += 1 / LASER_RATE;
    if (missile && this.missileWait <= 1e-8 && this.fire(MISSILE, owner, damage, blastCells)) this.missileWait += 1 / MISSILE_RATE;
  }

  detonate(p, bodies) {
    const h = this.hit;
    this.impulse.x = p.vx; this.impulse.y = p.vy; this.impulse.z = p.vz;
    this.impact.radius = p.radius;
    this.impact.breakRadius = p.radius * (p.kind === LASER ? 0.45 : 0.7);
    this.impact.damageFraction = this.impact.breakProgress = 1; this.impact.impulseTime = 0;
    if (p.kind === LASER) this.system.applyImpact(h.body, h.cx, h.cy, h.cz, p.damage, this.impulse, this.impact);
    else {
      const blast = this.blasts.find(b => !b.active);
      if (blast) {
        blast.active = true; blast.owner = p.owner; blast.age = 0;
        blast.x = h.cx; blast.y = h.cy; blast.z = h.cz;
        blast.vx = p.vx; blast.vy = p.vy; blast.vz = p.vz;
        blast.damage = p.damage; blast.radius = p.radius;
      }
    }
    const e = this.effects[this.effectCursor++ % this.effects.length];
    e.active = true; e.x = h.x; e.y = h.y; e.z = h.z; e.kind = p.kind;
    e.radius = p.kind === LASER ? this.system.config.cellSize * 0.6 : p.radius;
    e.age = 0; e.life = p.kind === LASER ? 0.16 : 0.7;
    this.stats.hits++; this.stats[p.kind === LASER ? 'laserHits' : 'missileHits']++;
    p.active = false;
  }

  updateBlasts(dt, bodies) {
    for (const blast of this.blasts) {
      if (!blast.active) continue;
      const before = pressureProgress(blast.age);
      blast.age = Math.min(BLAST_DURATION, blast.age + dt);
      const after = pressureProgress(blast.age);
      this.impact.damageFraction = after - before;
      this.impact.breakProgress = after;
      this.impact.impulseTime = 0.12;
      this.impact.radius = blast.radius; this.impact.breakRadius = blast.radius * 0.7;
      this.impulse.x = blast.vx; this.impulse.y = blast.vy; this.impulse.z = blast.vz;
      // Revisit the current body list: already detached sections must receive
      // the remaining impulse as well, without retaining obsolete parent ids.
      for (const body of bodies) {
        if (body.dead || body.static || body === blast.owner) continue;
        if (Math.hypot(body.pos.x - blast.x, body.pos.y - blast.y, body.pos.z - blast.z) > body.radius + blast.radius) continue;
        this.system.applyImpact(body, blast.x, blast.y, blast.z, blast.damage, this.impulse, this.impact);
      }
      if (blast.age >= BLAST_DURATION) { blast.active = false; blast.owner = null; }
    }
  }

  update(dt, bodies) {
    if (dt <= 0) return;
    this.stats.active = 0;
    this.updateBlasts(dt, bodies);
    for (const e of this.effects) if (e.active) { e.age += dt; if (e.age >= e.life) e.active = false; }
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const step = Math.min(dt, p.life - p.age);
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      if (speed > 1e-8 && traceBeamShot(this.system, bodies, p.owner, p.x, p.y, p.z,
        p.vx / speed, p.vy / speed, p.vz / speed, speed * step, this.hit)) this.detonate(p, bodies);
      else { p.x += p.vx * step; p.y += p.vy * step; p.z += p.vz * step; }
      p.age += step;
      if (p.age >= p.life - 1e-9) { p.active = false; p.owner = null; }
      if (p.active) this.stats.active++;
    }
  }
}
