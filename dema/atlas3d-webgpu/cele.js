// ============================================================
// Cele dema 3D: skały (pole wokół Atlasa) i drony wroga (podlatują, krążą, strzelają
// iskrami — cele dla obrony punktowej). Trafienia: kule kolizji (pos, r).
// ============================================================
import * as THREE from 'three/webgpu';
import { Fn, vec3, mix, smoothstep, positionLocal, mx_fractal_noise_float, mx_noise_float } from 'three/tsl';
import { MeshBuilder3D, SHIP3D_MAT as M } from '../../src/3d/ships3d/meshBuilder3D.js';

// Losowość powtarzalna (zrzuty testowe).
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function rockGeometry(rand) {
  const g = new THREE.IcosahedronGeometry(1, 5);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const k1 = rand() * 10; const k2 = rand() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.1 + k1) * Math.cos(v.y * 1.7 + k2) * 0.18 + Math.sin(v.z * 3.3 + v.x * 1.2 + k2) * 0.09 + Math.sin(v.y * 5.1 + v.z * 4.2) * 0.015;
    v.multiplyScalar(1 + n).multiply(_squash.set(1, 0.8 + rand() * 0.15, 0.72 + rand() * 0.2));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
const _squash = new THREE.Vector3();

export class Targets {
  constructor(scene, o = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'cele';
    scene.add(this.group);
    const rand = rng(o.seed ?? 7);
    this.rand = rand;

    // Skały: materiał węzłowy z szumem (plamy, żyły).
    const rockMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.05 });
    rockMat.colorNode = Fn(() => {
      const p = positionLocal.mul(3.0);
      const n = mx_fractal_noise_float(p, 4, 2.0, 0.5).mul(0.5).add(0.5);
      const vein = smoothstep(0.46, 0.5, mx_noise_float(p.mul(2.3)).mul(0.5).add(0.5)).mul(0.25);
      return mix(vec3(0.075, 0.068, 0.062), vec3(0.19, 0.17, 0.15), n).add(vec3(0.12, 0.09, 0.05).mul(vein));
    })();
    this.rocks = [];
    const geos = [0, 1, 2, 3, 4].map(() => rockGeometry(rand));
    for (let i = 0; i < (o.rocks ?? 18); i++) {
      const r = 60 + rand() * 190;
      const a = rand() * Math.PI * 2;
      const d = 2400 + rand() * 4200;
      const mesh = new THREE.Mesh(geos[i % geos.length], rockMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.scale.setScalar(r);
      const pos = new THREE.Vector3(Math.cos(a) * d, Math.sin(a) * d, (rand() - 0.5) * 500);
      mesh.position.copy(pos);
      mesh.rotation.set(rand() * 6, rand() * 6, rand() * 6);
      this.group.add(mesh);
      this.rocks.push({ mesh, pos: mesh.position, r: r * 0.95, hp: r * 8, hpMax: r * 8, alive: true, spin: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.3), kind: 'rock', respawn: 0 });
    }

    // Drony: mały klinowy myśliwiec (budowniczy) z czerwonymi światłami.
    const B = new MeshBuilder3D();
    B.prism([[-14, -9], [6, -4], [18, 0], [6, 4], [-14, 9], [-10, 0]], -2.5, 2.5, { bevel: [1, 1], bevelBottom: [1, 1], bottom: true, mat: M.PANEL, capMat: M.STEEL });
    B.mirrorY(() => {
      B.prism([[-12, 4], [0, 4], [-8, 18], [-14, 18]], -1, 1, { bevel: [0.4, 0.4], bottom: true, mat: M.DARK });
      B.box(-7, 17, 0, 6, 1.6, 1.6, { mat: M.E_RED });
    });
    B.box(-14, 0, 0, 3, 8, 3.4, { mat: M.E_RED });
    B.box(4, 0, 2.8, 6, 3, 1.2, { mat: M.GLASS });
    this.droneGeo = B.toGeometry(THREE);
    this.drones = [];
    this.droneMat = null;
  }

  /** Drony (materiał palety z dema). */
  spawnDrones(n, material, center = new THREE.Vector3()) {
    this.droneMat = material;
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.droneGeo, material);
      mesh.castShadow = true;
      mesh.scale.setScalar(1.6);
      this.group.add(mesh);
      const d = { mesh, pos: mesh.position, vel: new THREE.Vector3(), r: 30, hp: 60, hpMax: 60, alive: true, kind: 'drone', respawn: 0, phase: this.rand() * 6.28, orbit: 700 + this.rand() * 900, alt: (this.rand() - 0.5) * 500, speed: 320 + this.rand() * 200, fireCd: 1 + this.rand() * 2 };
      this._place(d, center);
      this.drones.push(d);
    }
  }

  _place(d, center) {
    const a = this.rand() * Math.PI * 2;
    const dist = 5000 + this.rand() * 2500;
    d.pos.set(center.x + Math.cos(a) * dist, center.y + Math.sin(a) * dist, center.z + d.alt);
    d.vel.set(0, 0, 0);
    d.hp = d.hpMax;
    d.alive = true;
    d.mesh.visible = true;
  }

  get all() { return this.rocks.concat(this.drones); }

  /** Najbliższy żywy dron w zasięgu (cel obrony punktowej). */
  nearestDrone(p, range) {
    let best = null;
    let bd = range * range;
    for (const d of this.drones) {
      if (!d.alive) continue;
      const q = d.pos.distanceToSquared(p);
      if (q < bd) { bd = q; best = d; }
    }
    return best;
  }

  update(dt, ship, fx, dronesOn = true) {
    for (const r of this.rocks) {
      if (!r.alive) {
        r.respawn -= dt;
        if (r.respawn <= 0) { r.alive = true; r.hp = r.hpMax; r.mesh.visible = true; r.mesh.scale.setScalar(r.r / 0.95); }
        continue;
      }
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      r.mesh.rotation.z += r.spin.z * dt;
    }
    const c = ship.pos;
    for (const d of this.drones) {
      if (!dronesOn) { d.mesh.visible = false; continue; }
      if (!d.alive) {
        d.respawn -= dt;
        if (d.respawn <= 0) this._place(d, c);
        continue;
      }
      // Krążenie wokół Atlasa na orbicie z falującą wysokością; dziób po prędkości.
      d.phase += dt * (d.speed / d.orbit) * 0.8;
      const want = new THREE.Vector3(c.x + Math.cos(d.phase) * d.orbit, c.y + Math.sin(d.phase) * d.orbit, c.z + d.alt + Math.sin(d.phase * 3) * 120);
      const steer = want.sub(d.pos);
      const L = steer.length();
      if (L > 1e-3) steer.multiplyScalar(Math.min(1, d.speed / L));
      d.vel.lerp(steer.multiplyScalar(1 / Math.max(dt, 1e-3)).clampLength(0, d.speed), Math.min(1, dt * 1.5));
      d.pos.addScaledVector(d.vel, dt);
      if (d.vel.lengthSq() > 1) {
        const dir = d.vel.clone().normalize();
        d.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      }
      // Ogień w stronę Atlasa (tylko wizualnie: iskry o kadłub / tarczę).
      d.fireCd -= dt;
      if (fx && d.fireCd <= 0 && d.pos.distanceTo(c) < 2600) {
        d.fireCd = 1.2 + this.rand() * 1.5;
        const aim = c.clone().add(new THREE.Vector3((this.rand() - 0.5) * 900, (this.rand() - 0.5) * 300, 20)).sub(d.pos).normalize();
        fx.shoot({ pos: d.pos, dir: aim, speed: 2600, color: '#ff5a3c', len: 40, width: 4, life: 1.2, damage: 0, kind: 'enemy', glow: 6 });
      }
    }
  }

  /** Trafienie celu; zwraca true, gdy cel zniszczony. */
  damage(t, dmg, fx) {
    t.hp -= dmg;
    if (t.hp > 0) return false;
    t.alive = false;
    t.mesh.visible = false;
    t.respawn = t.kind === 'drone' ? 4 + this.rand() * 3 : 12;
    if (fx) {
      fx.flash(t.pos, t.kind === 'drone' ? '#ffb070' : '#ffcf9a', t.r * (t.kind === 'drone' ? 3.2 : 1.6), 0.6, 9);
      fx.sparks(t.pos, null, '#ffb070', t.kind === 'drone' ? 30 : 50, 700, t.kind === 'drone' ? 6 : 14);
    }
    return true;
  }
}
