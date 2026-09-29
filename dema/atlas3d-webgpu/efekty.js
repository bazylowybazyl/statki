// ============================================================
// Efekty rozgrywki dema 3D: pociski (pule instancji, addytywne, HDR → bloom gry), rakiety
// (samonaprowadzanie, ślad), błyski wylotów i trafień, iskry. Jeden materiał na pulę,
// barwa i jasność w instanceColor — bez grafu na efekt.
// ============================================================
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const X = new THREE.Vector3(1, 0, 0);

// Barwa z danych broni: część ma `rgba(…)` — THREE.Color ignoruje alfę (z ostrzeżeniem), więc bez niej.
export function fxColor(c, out = new THREE.Color()) {
  if (c && typeof c === 'object' && c.isColor) return out.copy(c);
  const str = String(c || '#9fe8ff');
  const m = str.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const [r, g, b] = m[1].split(',').map((v) => Number(v.trim()));
    return out.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }
  return out.set(str);
}

function additivePool(geo, cap, name) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.colorNode = vec3(1);
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 30;
  mesh.setColorAt(0, _c.setRGB(0, 0, 0));
  return mesh;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // Pocisk: wydłużony ośmiościan (przód ostry), oś X.
    const bolt = new THREE.OctahedronGeometry(0.5, 0);
    this.boltMesh = additivePool(bolt, 4096, 'pociski');
    this.flashMesh = additivePool(new THREE.IcosahedronGeometry(1, 1), 2048, 'błyski');
    scene.add(this.boltMesh, this.flashMesh);
    this.bolts = [];
    this.flashes = [];
    this.stats = { shots: 0, hits: 0 };
  }

  /**
   * Pocisk. o: { pos, dir, speed, color, len, width, life, damage, kind ('bolt'|'missile'|'lance'),
   * target (obiekt z .pos Vector3 i .alive), inherit (Vector3 prędkości nośnika) }.
   */
  shoot(o) {
    const b = {
      pos: o.pos.clone(),
      prev: o.pos.clone(),
      vel: o.dir.clone().multiplyScalar(o.speed),
      dir: o.dir.clone(),
      speed: o.speed,
      color: fxColor(o.color),
      glow: o.glow ?? 5,
      len: o.len ?? 60,
      width: o.width ?? 6,
      life: o.life ?? 2,
      age: 0,
      damage: o.damage ?? 1,
      kind: o.kind || 'bolt',
      target: o.target || null,
      turn: o.turn ?? 1.8,
      trail: 0
    };
    if (o.inherit) b.vel.add(o.inherit);
    this.bolts.push(b);
    this.stats.shots++;
    return b;
  }

  /** Błysk (kula HDR, znika wykładniczo). */
  flash(pos, color, size, life = 0.12, glow = 6) {
    if (this.flashes.length > 1900) return;
    this.flashes.push({ pos: pos.clone(), color: fxColor(color), size, life, age: 0, glow, vel: null });
  }

  /** Iskry: małe szybkie pociski bez obrażeń. */
  sparks(pos, dir, color, n, speed, size) {
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      if (dir) _v.addScaledVector(dir, 0.8).normalize();
      this.bolts.push({
        pos: pos.clone(), prev: pos.clone(), vel: _v.clone().multiplyScalar(speed * (0.4 + Math.random())), dir: _v.clone(), speed,
        color: fxColor(color), glow: 4, len: size * 3, width: size * 0.5, life: 0.25 + Math.random() * 0.35, age: 0,
        damage: 0, kind: 'spark', target: null, turn: 0, trail: 0
      });
    }
  }

  /**
   * Krok: ruch, samonaprowadzanie, kolizje (hitTest(b) → trafiony obiekt | null), wygaszanie.
   */
  update(dt, hitTest) {
    const keep = [];
    for (const b of this.bolts) {
      b.age += dt;
      if (b.age >= b.life) continue;
      if (b.kind === 'missile') {
        // Rakieta: rozpędza się, skręca do celu (prędkość kątowa `turn`), zostawia ślad.
        const sp = Math.min(b.speed, b.vel.length() + b.speed * 1.2 * dt);
        b.dir.copy(b.vel).normalize();
        if (b.target && b.target.alive && b.age > 0.25) {
          _v.copy(b.target.pos).sub(b.pos).normalize();
          const ang = b.dir.angleTo(_v);
          const k = Math.min(1, (b.turn * dt) / Math.max(ang, 1e-4));
          b.dir.lerp(_v, k).normalize();
        }
        b.vel.copy(b.dir).multiplyScalar(sp);
        b.trail += dt;
        if (b.trail > 0.035) {
          b.trail = 0;
          this.flashes.push({ pos: b.pos.clone(), color: new THREE.Color('#8d96a6'), size: b.width * 0.45, life: 0.55, age: 0, glow: 0.22, vel: null, smoke: true });
          this.flashes.push({ pos: b.pos.clone(), color: b.color, size: b.width * 0.35, life: 0.06, age: 0, glow: 3, vel: null });
        }
      } else if (b.kind === 'spark') {
        b.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
      }
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      if (b.kind !== 'spark' && hitTest) {
        const hit = hitTest(b);
        if (hit) {
          this.stats.hits++;
          this.flash(b.pos, b.color, b.kind === 'missile' ? b.width * 9 : b.kind === 'lance' ? b.width * 6 : b.width * 3.2, b.kind === 'missile' ? 0.45 : 0.16, b.kind === 'missile' ? 8 : 6);
          this.sparks(b.pos, b.dir.clone().negate(), b.color, b.kind === 'missile' ? 18 : 6, b.speed * 0.08 + 200, b.width * 0.5);
          if (b.kind !== 'lance') continue;
        }
      }
      keep.push(b);
    }
    this.bolts = keep;
    const f2 = [];
    for (const f of this.flashes) {
      f.age += dt;
      if (f.age < f.life) f2.push(f);
    }
    this.flashes = f2;
    this._write();
  }

  _write() {
    const bm = this.boltMesh;
    let n = 0;
    for (const b of this.bolts) {
      if (n >= bm.instanceMatrix.count) break;
      const fade = b.kind === 'spark' ? 1 - b.age / b.life : Math.min(1, (b.life - b.age) * 6);
      _q.setFromUnitVectors(X, _v.copy(b.vel).normalize());
      _s.set(b.len, b.width, b.width);
      _m.compose(b.pos, _q, _s);
      bm.setMatrixAt(n, _m);
      bm.setColorAt(n, _c.copy(b.color).multiplyScalar(b.glow * fade));
      n++;
    }
    bm.count = n;
    bm.instanceMatrix.needsUpdate = true;
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true;

    const fm = this.flashMesh;
    let k = 0;
    for (const f of this.flashes) {
      if (k >= fm.instanceMatrix.count) break;
      const t = f.age / f.life;
      const s = f.smoke ? f.size * (1 + t * 2.5) : f.size * (0.6 + 0.8 * t);
      _m.makeScale(s, s, s).setPosition(f.pos);
      fm.setMatrixAt(k, _m);
      const e = f.smoke ? (1 - t) * (1 - t) : Math.exp(-t * 4.5);
      fm.setColorAt(k, _c.copy(f.color).multiplyScalar(f.glow * e));
      k++;
    }
    fm.count = k;
    fm.instanceMatrix.needsUpdate = true;
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
  }

  clear() { this.bolts.length = 0; this.flashes.length = 0; this._write(); }
}
