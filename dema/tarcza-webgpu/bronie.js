// ============================================================
// Broń do testów tarczy. Gameplay w płaszczyźnie gry (y w dół) jak w grze:
// pocisk leci odcinkami, tarcza blokuje, gdy punkt wchodzi w obrys
// (getEntityShieldRadiusTowards × postęp aktywacji), trafienie idzie przez
// registerShieldImpact (Tarcza.registerHit) i odejmuje HP. Przebita komórka
// pola (mapa B odczytywana asynchronicznie) przepuszcza pocisk do kadłuba —
// gorący punkt i iskry na pancerzu. Efekty: jedna partia kwadów (pociski,
// wiązka, błyski, żar pancerza) + światła dynamiczne.
//
// Klasy: 1 PD (pd), 2 laser (main), 3 torpeda (special), 4 wiązka (ciągła).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  float, vec3, uv, exp, smoothstep, abs, max, mix, dot, select, instancedBufferAttribute
} from 'three/tsl';
import {
  getEntityShieldRadiusTowards, getEntityShieldBlockingProgress
} from '../../shieldSystem.js';
import { lights } from './wspolne.js';
import { spriteHullHit } from './kadlub.js';
import { barrelTip } from './wrogowie.js';

const MAX_QUADS = 768;
const MAX_BOLTS = 320;
const MAX_FX = 192;
const MAX_HOT = 64;
const BOLT_Z = 55;

export const WEAPONS = {
  1: { name: 'PD', cls: 'pd', dmg: 12, speed: 7200, interval: 0.055, len: 110, width: 7, spread: 0.012, kind: 'tracer' },
  2: { name: 'laser', cls: 'main', dmg: 110, speed: 5200, interval: 0.13, len: 240, width: 15, spread: 0.004, kind: 'bolt' },
  3: { name: 'torpeda', cls: 'special', dmg: 900, speed: 1500, interval: 0.8, len: 320, width: 46, spread: 0.0, kind: 'torpedo' },
  4: { name: 'wiązka', cls: 'main', dps: 560, kind: 'beam' }
};
const PD_COLOR = [1.0, 0.62, 0.22];
const TORP_COLOR = [1.0, 0.55, 0.25];

function createQuads(scene) {
  const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
  tintAttr.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const tint = instancedBufferAttribute(tintAttr);
  const q = uv().sub(0.5).mul(2.0);
  // Pocisk / wiązka: rdzeń rozżarzony do bieli + poświata, zwężone końce (demo lasera).
  const ay = q.y.mul(q.y);
  const core = exp(ay.mul(-45.0));
  const halo = exp(ay.mul(-4.0)).mul(0.32);
  const ends = float(1.0).sub(smoothstep(0.5, 1.0, abs(q.x)));
  const peak = max(tint.x, max(tint.y, tint.z));
  const bolt = mix(tint.xyz, vec3(peak), core.mul(0.7)).mul(core.add(halo)).mul(ends);
  // Błysk / żar: okrągły.
  const r2 = dot(q, q);
  const round = tint.xyz.mul(exp(r2.mul(-7.0)).add(exp(r2.mul(-1.7)).mul(0.28))).mul(float(1.0).sub(smoothstep(0.8, 1.0, r2)));
  m.colorNode = select(tint.w.lessThan(0.5), bolt, round);
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, MAX_QUADS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  scene.add(mesh);
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _z = new THREE.Vector3(0, 0, 1);
  return {
    mesh, count: 0,
    reset() { this.count = 0; },
    // x, y w świecie 3D; kind 0 = smuga, 1 = okrągły.
    push(x, y, z, angle, sx, sy, r, g, b, kind) {
      if (this.count >= MAX_QUADS) return;
      _q.setFromAxisAngle(_z, angle);
      _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, 1));
      mesh.setMatrixAt(this.count, _m);
      tintAttr.setXYZW(this.count, r, g, b, kind);
      this.count++;
    },
    commit() {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      tintAttr.needsUpdate = true;
    }
  };
}

export function createWeapons({ scene, atlas, shield, sprite, enemies }) {
  const quads = createQuads(scene);
  const bolts = Array.from({ length: MAX_BOLTS }, () => ({
    on: false, x: 0, y: 0, dx: 1, dy: 0, speed: 0, cls: 'main', dmg: 0, r: 1, g: 1, b: 1,
    len: 100, width: 10, kind: 'bolt', traveled: 0, range: 9000, age: 0, passed: false
  }));
  const fx = Array.from({ length: MAX_FX }, () => ({ on: false, x: 0, y: 0, z: 0, age: 0, life: 1, size: 1, r: 1, g: 1, b: 1, light: 0, radius: 0, falloff: 0 }));
  const hot = Array.from({ length: MAX_HOT }, () => ({ on: false, x: 0, y: 0, heat: 0 }));
  const salvoQ = Array.from({ length: 96 }, () => ({ on: false, t: 0, enemy: 0, tx: 0, ty: 0 }));
  // Wektory robocze — osobne dla wylotu i dla przeliczeń do klatki lokalnej
  // (wspólny wektor nadpisywał się w środku marszu promienia wiązki).
  const _v = new THREE.Vector3();
  const _mz = new THREE.Vector2();
  const _loc = new THREE.Vector2();
  const hit = { x: 0, y: 0 };

  const W = {
    weapon: 2,
    enemyFire: true,
    fireCd: 0,
    autoCd: [1.2, 2.0, 1.6],
    torpCd: 6,
    beam: {
      on: false, api: false, tx: 0, ty: 0, enemy: -1, len: 0, ox: 0, oy: 0, dx: 0, dy: 0,
      hitKind: 0, prevKind: 0, passedBreach: false, hx: 0, hy: 0, impactCd: 0
    },
    shots: 0,
    stats: { bolts: 0, shieldHits: 0, hullHits: 0, passed: 0 }
  };

  // ── Pomocnicze: najbliższy wróg do punktu gry, wylot lufy w układzie gry ─────
  function nearestEnemy(x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const s = enemies[i].ship;
      const d = Math.hypot(s.x - x, -s.y - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function muzzle(i, tx, ty, out) {
    const s = enemies[i].ship;
    s.turret.rotation.z = Math.atan2(-ty - s.y, tx - s.x) - s.angle;
    s.turret.updateMatrixWorld(true);
    s.barrel = s.barrel ? 0 : 1;
    barrelTip(s, s.barrel ? 1 : -1, _v);
    return out.set(_v.x, -_v.y);
  }
  function laserColor(i) { return enemies[i].def.laser; }

  function addFx(x, y, z, life, size, r, g, b, light, radius, falloff) {
    let f = null, oldest = -1;
    for (let i = 0; i < MAX_FX; i++) {
      const c = fx[i];
      if (!c.on) { f = c; break; }
      if (c.age / c.life > oldest) { oldest = c.age / c.life; f = c; }
    }
    f.on = true; f.x = x; f.y = y; f.z = z; f.age = 0; f.life = life; f.size = size;
    f.r = r; f.g = g; f.b = b; f.light = light; f.radius = radius; f.falloff = falloff;
  }
  function addHot(x, y, heat) {
    let free = null, weakest = null;
    for (let i = 0; i < MAX_HOT; i++) {
      const h = hot[i];
      if (!h.on) { if (!free) free = h; continue; }
      if (Math.hypot(h.x - x, h.y - y) < 30) { h.heat = Math.min(1.8, h.heat + heat); return; }
      if (!weakest || h.heat < weakest.heat) weakest = h;
    }
    const h = free || weakest;
    h.on = true; h.x = x; h.y = y; h.heat = Math.min(1.8, heat);
  }

  // ── Strzał z wroga i w punkt gry (tx, ty) ──────────────────────────────────
  function fire(enemyIdx, tx, ty, wid) {
    const w = WEAPONS[wid];
    if (!w || w.kind === 'beam') return false;
    let b = null;
    for (let i = 0; i < MAX_BOLTS; i++) if (!bolts[i].on) { b = bolts[i]; break; }
    if (!b) return false;
    const m = muzzle(enemyIdx, tx, ty, _mz);
    let dx = tx - m.x, dy = ty - m.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    if (w.spread > 0) {
      const a = (Math.random() - 0.5) * 2 * w.spread;
      const c = Math.cos(a), s = Math.sin(a);
      const ndx = dx * c - dy * s, ndy = dx * s + dy * c;
      dx = ndx; dy = ndy;
    }
    const col = w.kind === 'tracer' ? PD_COLOR : (w.kind === 'torpedo' ? TORP_COLOR : laserColor(enemyIdx));
    b.on = true; b.x = m.x; b.y = m.y; b.dx = dx; b.dy = dy; b.speed = w.speed; b.cls = w.cls; b.dmg = w.dmg;
    b.r = col[0]; b.g = col[1]; b.b = col[2]; b.len = w.len; b.width = w.width; b.kind = w.kind;
    b.traveled = 0; b.range = l + 2500; b.age = 0; b.passed = false;
    // Błysk wylotu.
    const k = w.kind === 'torpedo' ? 2.2 : (w.kind === 'tracer' ? 0.5 : 1);
    addFx(m.x, m.y, BOLT_Z, 0.09 * Math.sqrt(k), 110 * k, col[0] * 0.75 + 0.25, col[1] * 0.75 + 0.25, col[2] * 0.75 + 0.25, 7 * k, 520 * k, 110 * k);
    W.shots++;
    return true;
  }

  // Salwa: każdy wróg 4 pociski lasera w punkt (z lekkim rozrzutem), odstęp ~50 ms.
  function salvo(tx, ty) {
    let q = 0;
    for (let e = 0; e < enemies.length; e++) {
      for (let k = 0; k < 4; k++) {
        while (q < salvoQ.length && salvoQ[q].on) q++;
        if (q >= salvoQ.length) return;
        const s = salvoQ[q];
        s.on = true; s.t = k * 0.05 + e * 0.02 + Math.random() * 0.02; s.enemy = e;
        s.tx = tx + (Math.random() - 0.5) * 40; s.ty = ty + (Math.random() - 0.5) * 40;
      }
    }
  }

  // ── Kolizje w płaszczyźnie gry ────────────────────────────────────────────
  function insideShield(x, y, prog) {
    const d = Math.hypot(x - atlas.x, y - atlas.y);
    return d < getEntityShieldRadiusTowards(atlas, x, y) * prog;
  }
  // Pierwszy punkt odcinka w obrysie tarczy (bisekcja), albo null.
  function shieldCrossing(x0, y0, x1, y1) {
    const prog = getEntityShieldBlockingProgress(atlas);
    if (prog <= 0) return null;
    const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
    let inX = x1, inY = y1;
    if (!insideShield(x1, y1, prog)) {
      if (!insideShield(mx, my, prog)) return null;
      inX = mx; inY = my;
    }
    if (insideShield(x0, y0, prog)) { hit.x = x0; hit.y = y0; return hit; }
    let ax = x0, ay = y0, bx = inX, by = inY;
    for (let i = 0; i < 14; i++) {
      const cx = (ax + bx) * 0.5, cy = (ay + by) * 0.5;
      if (insideShield(cx, cy, prog)) { bx = cx; by = cy; } else { ax = cx; ay = cy; }
    }
    hit.x = bx; hit.y = by;
    return hit;
  }
  // Pancerz: marsz co 6 j. po odcinku, maska komórek sprite'a.
  function hullCrossing(x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / 6));
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * (i / n), y = y0 + (y1 - y0) * (i / n);
      shield.worldToLocal(x, y, _loc);
      if (spriteHullHit(sprite, _loc.x / sprite.scale, -_loc.y / sprite.scale)) { hit.x = x; hit.y = y; return hit; }
    }
    return null;
  }
  function shieldBreachedAt(x, y) {
    shield.worldToLocal(x, y, _loc);
    return shield.breachAt(_loc.x, _loc.y);
  }

  // Trafienie w pancerz: żar, iskry z pancerza, błysk.
  function hullImpact(x, y, cls, dmg, fromBreach) {
    const k = cls === 'special' ? 2.4 : (cls === 'pd' ? 0.35 : 1);
    addHot(x, y, 0.55 * k);
    addFx(x, y, 20, 0.35 * Math.sqrt(k), 180 * k, 1.0, 0.72, 0.42, 6 * k, 700 * k, 150 * k);
    if (shield.mode !== 'ref') {
      shield.worldToLocal(x, y, _loc);
      shield.hullSparks(_loc.x, _loc.y, cls, dmg);
    }
    W.stats.hullHits++;
    if (fromBreach) W.stats.passed++;
  }
  // Trafienie w tarczę (gameplay jak w grze) + mały błysk w miejscu trafienia.
  function shieldImpact(x, y, cls, dmg) {
    shield.registerHit(x, y, dmg, cls);
    W.stats.shieldHits++;
  }

  // ── Wiązka: z najbliższego wroga do punktu, pierwszy styk: tarcza / pancerz ──
  function updateBeam(dt, time) {
    const B = W.beam;
    B.prevKind = B.hitKind;
    if (!B.on) { B.hitKind = 0; return; }
    if (B.enemy < 0) B.enemy = nearestEnemy(B.tx, B.ty);
    const m = muzzle(B.enemy, B.tx, B.ty, _mz);
    B.ox = m.x; B.oy = m.y;
    const ox = m.x, oy = m.y;
    let dx = B.tx - m.x, dy = B.ty - m.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    B.dx = dx; B.dy = dy;
    const maxLen = l + 1500;
    B.len = maxLen;
    B.hitKind = 0;
    // Marsz promienia co 24 j. — potem bisekcja w shieldCrossing. Tarcza to błona na
    // obrysie: po przejściu przez przebicie promień sprawdza już tylko pancerz.
    const stepL = 24;
    let px = ox, py = oy;
    let passed = false;
    for (let s = stepL; s <= maxLen; s += stepL) {
      const nx = ox + dx * s, ny = oy + dy * s;
      if (!passed) {
        const h = shieldCrossing(px, py, nx, ny);
        if (h) {
          if (!shieldBreachedAt(h.x, h.y)) {
            B.hitKind = 1; B.hx = h.x; B.hy = h.y; B.len = Math.hypot(h.x - ox, h.y - oy);
            break;
          }
          passed = true;
        }
      }
      const hh = hullCrossing(px, py, nx, ny);
      if (hh) {
        B.hitKind = 2; B.hx = hh.x; B.hy = hh.y; B.len = Math.hypot(hh.x - ox, hh.y - oy);
        break;
      }
      px = nx; py = ny;
    }
    const w = WEAPONS[4];
    B.passedBreach = passed;
    if (B.hitKind === 1) {
      // Źródło ciągłe w polu (co podkrok) + energia, iskry, trafienia co 0,1 s (HP, stan).
      shield.worldToLocal(B.hx, B.hy, _loc);
      shield.beamOnShield(_loc.x, _loc.y, dt);
      B.impactCd -= dt;
      if (B.impactCd <= 0) {
        shield.registerHit(B.hx, B.hy, w.dps * 0.1, 'main', { beam: true });
        B.impactCd += 0.1;
        W.stats.shieldHits++;
      }
    } else if (B.hitKind === 2) {
      if (B.prevKind !== 2) { W.stats.hullHits++; if (passed) W.stats.passed++; }
      addHot(B.hx, B.hy, dt * 1.6);
      if (shield.mode !== 'ref') {
        shield.worldToLocal(B.hx, B.hy, _loc);
        shield.hullSparks(_loc.x, _loc.y, 'beam', w.dps * dt);
      }
    }
  }

  // ── Ogień wrogów (E): lasery w losowe punkty Atlasa, czasem PD, rzadko torpeda ──
  function autoFire(dt) {
    for (let i = 0; i < enemies.length; i++) {
      W.autoCd[i] -= dt;
      if (W.autoCd[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const r = 300 + Math.random() * 500;
      const tx = atlas.x + Math.cos(a) * r * 1.6, ty = atlas.y + Math.sin(a) * r * 0.6;
      if (Math.random() < 0.25) {
        for (let k = 0; k < 6; k++) fire(i, tx + (Math.random() - 0.5) * 60, ty + (Math.random() - 0.5) * 60, 1);
        W.autoCd[i] = 0.8 + Math.random() * 1.2;
      } else {
        fire(i, tx, ty, 2);
        W.autoCd[i] = 0.5 + Math.random() * 1.1;
      }
    }
    W.torpCd -= dt;
    if (W.torpCd <= 0) {
      const i = Math.floor(Math.random() * enemies.length);
      fire(i, atlas.x + (Math.random() - 0.5) * 900, atlas.y + (Math.random() - 0.5) * 300, 3);
      W.torpCd = 7 + Math.random() * 6;
    }
  }

  // ── Klatka ────────────────────────────────────────────────────────────────
  function update(dt, time, input) {
    // Ogień z myszy: wybrana broń z najbliższego wroga w kursor.
    W.fireCd -= dt;
    const wsel = WEAPONS[W.weapon];
    if (input.fire && wsel.kind !== 'beam' && W.fireCd <= 0) {
      fire(nearestEnemy(input.x, input.y), input.x, input.y, W.weapon);
      W.fireCd = wsel.interval;
    }
    const beamWanted = input.beam || (input.fire && wsel.kind === 'beam') || W.beam.api;
    if (beamWanted) {
      if (!W.beam.on) { W.beam.enemy = -1; W.beam.impactCd = 0; }
      W.beam.on = true;
      if (!W.beam.api) { W.beam.tx = input.x; W.beam.ty = input.y; }
    } else {
      W.beam.on = false;
    }
    for (let i = 0; i < salvoQ.length; i++) {
      const s = salvoQ[i];
      if (!s.on) continue;
      s.t -= dt;
      if (s.t <= 0) { fire(s.enemy, s.tx, s.ty, 2); s.on = false; }
    }
    if (W.enemyFire) autoFire(dt);
    updateBeam(dt, time);

    // Pociski: odcinek na klatkę, tarcza → (przebicie?) → pancerz.
    let alive = 0;
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = bolts[i];
      if (!b.on) continue;
      const stepL = b.speed * dt;
      const x1 = b.x + b.dx * stepL, y1 = b.y + b.dy * stepL;
      let done = false;
      if (!b.passed) {
        const h = shieldCrossing(b.x, b.y, x1, y1);
        if (h) {
          if (shieldBreachedAt(h.x, h.y)) {
            b.passed = true;   // przez dziurę w polu — leci dalej, do pancerza
          } else {
            shieldImpact(h.x, h.y, b.cls, b.dmg);
            done = true;
          }
        }
      }
      if (!done) {
        const hh = hullCrossing(b.x, b.y, x1, y1);
        if (hh) { hullImpact(hh.x, hh.y, b.cls, b.dmg, b.passed); done = true; }
      }
      if (done) { b.on = false; continue; }
      b.x = x1; b.y = y1; b.traveled += stepL; b.age += dt;
      if (b.traveled > b.range) { b.on = false; continue; }
      alive++;
    }
    W.stats.bolts = alive;
  }

  // Kwady i światła efektów (świat 3D: y = −y gry).
  function emit(dt, time) {
    quads.reset();
    const flick = 0.85 + 0.15 * Math.sin(time * 83) * Math.sin(time * 37);
    for (let i = 0; i < MAX_FX; i++) {
      const f = fx[i];
      if (!f.on) continue;
      f.age += dt;
      if (f.age >= f.life) { f.on = false; continue; }
      const k = 1 - f.age / f.life;
      quads.push(f.x, -f.y, f.z + 8, 0, f.size * (0.7 + 0.5 * (1 - k)), f.size * (0.7 + 0.5 * (1 - k)), f.r * 4 * k, f.g * 4 * k, f.b * 4 * k, 1);
      if (f.light > 0) lights.push(f.x, -f.y, f.z + 30, f.radius, f.falloff, f.r * f.light * k, f.g * f.light * k, f.b * f.light * k);
    }
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = bolts[i];
      if (!b.on) continue;
      const ang = Math.atan2(-b.dy, b.dx);
      if (b.kind === 'torpedo') {
        const pulse = 0.85 + 0.15 * Math.sin(time * 40 + i);
        quads.push(b.x - b.dx * b.len * 0.5, -(b.y - b.dy * b.len * 0.5), BOLT_Z, ang, b.len, b.width, b.r * 3, b.g * 3, b.b * 3, 0);
        quads.push(b.x, -b.y, BOLT_Z + 4, 0, 120 * pulse, 120 * pulse, 6.5, 4.2, 2.6, 1);
        lights.push(b.x, -b.y, BOLT_Z + 40, 1500, 300, 5.5 * pulse, 2.8 * pulse, 1.2 * pulse);
      } else {
        const hdr = b.kind === 'tracer' ? 6 : 8;
        quads.push(b.x - b.dx * b.len * 0.5, -(b.y - b.dy * b.len * 0.5), BOLT_Z, ang, b.len, b.width, b.r * hdr, b.g * hdr, b.b * hdr, 0);
        if (b.kind === 'bolt') lights.push(b.x, -b.y, BOLT_Z + 25, 700, 160, b.r * 2.4, b.g * 2.4, b.b * 2.4);
        else if ((i & 3) === 0) lights.push(b.x, -b.y, BOLT_Z + 20, 380, 90, b.r * 1.2, b.g * 1.2, b.b * 1.2);
      }
    }
    const B = W.beam;
    if (B.on) {
      const col = laserColor(B.enemy < 0 ? 0 : B.enemy);
      const r = col[0], g = col[1], bl = col[2];
      const w = 24 + 8 * flick;
      const ang = Math.atan2(-B.dy, B.dx);
      quads.push(B.ox + B.dx * B.len * 0.5, -(B.oy + B.dy * B.len * 0.5), BOLT_Z + 2, ang, B.len, w, r * 9 * flick, g * 9 * flick, bl * 9 * flick, 0);
      quads.push(B.ox, -B.oy, BOLT_Z + 14, 0, 110, 110, r * 6, g * 6, bl * 6, 1);
      const n = Math.min(14, Math.max(2, Math.floor(B.len / 380)));
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * B.len;
        lights.push(B.ox + B.dx * t, -(B.oy + B.dy * t), BOLT_Z + 20, 460, 110, r * 2.0 * flick, g * 2.0 * flick, bl * 2.0 * flick);
      }
      if (B.hitKind) {
        // Gorący punkt wiązki: mocne, stałe światło.
        const z = B.hitKind === 1 ? 40 + shield.domeHeight * 0.3 : 30;
        lights.push(B.hx, -B.hy, z, 1100, 210, (r * 0.6 + 0.4) * 9 * flick, (g * 0.6 + 0.4) * 9 * flick, (bl * 0.6 + 0.4) * 9 * flick);
        quads.push(B.hx, -B.hy, z, 0, 190 * flick, 190 * flick, (r * 0.6 + 0.4) * 5, (g * 0.6 + 0.4) * 5, (bl * 0.6 + 0.4) * 5, 1);
      }
    }
    for (let i = 0; i < MAX_HOT; i++) {
      const h = hot[i];
      if (!h.on) continue;
      h.heat -= dt * 0.3;
      if (h.heat <= 0.02) { h.on = false; continue; }
      const t = Math.min(1, h.heat / 1.2);
      const r = 0.9 + 5.5 * t * t, g = 0.12 + 3.2 * t * t * t, b = 0.02 + 1.6 * Math.pow(t, 4);
      const k = Math.min(1, h.heat);
      quads.push(h.x, -h.y, 14, 0, 40 + 60 * k, 40 + 60 * k, r * 1.4, g * 1.4, b * 1.4, 1);
      lights.push(h.x, -h.y, 40, 320, 75, r * 0.6 * k, g * 0.6 * k, b * 0.6 * k);
    }
    quads.commit();
  }

  return {
    W, quads, fire, salvo, update, emit, nearestEnemy,
    setBeam(on, tx, ty) {
      W.beam.api = !!on;
      if (on) { W.beam.tx = tx; W.beam.ty = ty; W.beam.enemy = -1; }
    },
    liveBolts() { return W.stats.bolts; }
  };
}
