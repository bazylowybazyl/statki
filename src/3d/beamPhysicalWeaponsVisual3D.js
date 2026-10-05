import * as THREE from 'three';
import { PW } from '../game/beamPhysicalWeapons3D.js';

// Obraz fizycznych broni dema destruktor3d.html (WebGL dema — przy wejściu do gry: TSL, plan F2).
// Pręt Hexlance to ciało silnika — rysuje go BeamShips3D; tu tylko jego smuga.
// Pociski, fronty fal, wiązka i błyski — instancje; żar węzłów (temp) — punkty z barwą ciała czarnego.
const HOT_CAPACITY = 12000;

function glowTexture() {
  const size = 64, canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) return null;
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Barwa żaru: ciemna czerwień → pomarańcz → żółć → biel (t = temp / topnienie).
function heatColor(t, out) {
  const c = Math.max(0, Math.min(1.2, t));
  out.r = Math.min(1, c * 2.2);
  out.g = Math.max(0, Math.min(1, (c - 0.35) * 1.7));
  out.b = Math.max(0, Math.min(1, (c - 0.8) * 2.5));
  const k = 0.15 + c * 0.7;
  out.r *= k; out.g *= k; out.b *= k;
  return out;
}

export class BeamPhysicalWeaponsVisual3D {
  constructor(scene, weapons, opts = {}) {
    this.weapons = weapons;
    this.scene = scene;
    const s = this.scale = opts.scale > 0 ? opts.scale : 1;
    this.transform = new THREE.Object3D(); this.direction = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0); this.color = new THREE.Color(); this._c = { r: 0, g: 0, b: 0 };
    const make = (geo, color, count, additive = false, opacity = 0.75) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: additive, opacity: additive ? opacity : 1,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive, toneMapped: false });
      if (additive) mat.color.multiplyScalar(2);
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
      scene.add(mesh); return mesh;
    };
    const n = weapons.shells.length;
    this.shells = make(new THREE.CylinderGeometry(0.11 * s, 0.11 * s, 1, 5), 0xffd27a, n, true);
    this.legacyShells = make(new THREE.CylinderGeometry(0.10 * s, 0.10 * s, 1, 5), 0x62efff, n, true);
    this.rockets = make(new THREE.ConeGeometry(0.23 * s, 1.8 * s, 6), 0xd7e2ee, n);
    this.trails = make(new THREE.CylinderGeometry(0.12 * s, 0.03 * s, 1, 5), 0xff8d36, n + 32, true);
    // Front fali: cienka poświata na promieniu frontu (przezroczysta, żeby było widać, co rozrywa).
    this.fronts = make(new THREE.IcosahedronGeometry(1, 2), 0xff6a1a, weapons.blasts.length, true, 0.07);
    this.flashes = make(new THREE.IcosahedronGeometry(1, 1), 0xffffff, weapons.effects.length, true);
    this.flashes.setColorAt(0, this.color.set(0xffffff));
    this.beamCore = make(new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 1, 6), 0xfff2d0, 1, true, 0.95);
    this.beamGlow = make(new THREE.CylinderGeometry(0.42 * s, 0.42 * s, 1, 8), 0xff7a1e, 1, true, 0.35);
    this.meshes = [this.shells, this.legacyShells, this.rockets, this.trails, this.fronts, this.flashes, this.beamCore, this.beamGlow];

    // Żar węzłów: punkty z barwą (temperatura z magazynu ciała).
    const geo = new THREE.BufferGeometry();
    this.hotPos = new Float32Array(HOT_CAPACITY * 3);
    this.hotCol = new Float32Array(HOT_CAPACITY * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.hotPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.hotCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.hotMaterial = new THREE.PointsMaterial({
      size: 3 * s, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, map: glowTexture()
    });
    this.hot = new THREE.Points(geo, this.hotMaterial);
    this.hot.frustumCulled = false;
    scene.add(this.hot);
  }

  _streak(mesh, x0, y0, z0, x1, y1, z1, width = 1) {
    const o = this.transform, d = this.direction;
    d.set(x1 - x0, y1 - y0, z1 - z0);
    const len = d.length();
    if (len < 1e-6) return;
    d.multiplyScalar(1 / len);
    o.quaternion.setFromUnitVectors(this.axis, d);
    o.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
    o.scale.set(width, len, width);
    o.updateMatrix();
    mesh.setMatrixAt(mesh.count++, o.matrix);
  }

  sync() {
    const w = this.weapons, o = this.transform, d = this.direction, s = this.scale;
    for (const mesh of this.meshes) mesh.count = 0;
    for (const p of w.shells) {
      if (!p.active) continue;
      const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
      d.set(p.vx / speed, p.vy / speed, p.vz / speed);
      if (p.kind === PW.ROCKET) {
        o.quaternion.setFromUnitVectors(this.axis, d);
        o.position.set(p.x, p.y, p.z); o.scale.setScalar(1); o.updateMatrix();
        this.rockets.setMatrixAt(this.rockets.count++, o.matrix);
        this._streak(this.trails, p.x - d.x * 4.6 * s, p.y - d.y * 4.6 * s, p.z - d.z * 4.6 * s,
          p.x - d.x * 0.6 * s, p.y - d.y * 0.6 * s, p.z - d.z * 0.6 * s);
      } else {
        // Smuga pocisku: długość z prędkości (stare trafienia — błękit jak laser dema; Hexlance stary — szeroki).
        const len = Math.min(8 * s, Math.max(0.6 * s, Math.min(p.age, 0.012) * speed));
        const mesh = p.legacy ? this.legacyShells : this.shells;
        this._streak(mesh, p.x - d.x * len, p.y - d.y * len, p.z - d.z * len, p.x, p.y, p.z, p.kind === PW.LANCE ? 4 : 1);
      }
    }
    // Smugi szybkich prętów Hexlance (pręt rysuje BeamShips3D).
    for (const rod of w.rods) {
      const B = rod.body;
      if (!B || B.dead || !B._rodFast) continue;
      const speed = Math.hypot(B.vel.x, B.vel.y, B.vel.z);
      if (speed < 1) continue;
      d.set(B.vel.x / speed, B.vel.y / speed, B.vel.z / speed);
      const len = Math.min(40 * s, speed * 0.05);
      this._streak(this.trails, B.pos.x - d.x * len, B.pos.y - d.y * len, B.pos.z - d.z * len, B.pos.x, B.pos.y, B.pos.z, 3);
    }
    // Fronty fal: kula na promieniu frontu (stare: rosnący krater dema).
    o.quaternion.identity();
    for (const b of w.blasts) {
      if (!b.active) continue;
      const r = b.legacy ? b.radius * Math.min(1, b.age / 0.22) : b.frontR;
      if (!(r > 0)) continue;
      o.position.set(b.x, b.y, b.z); o.scale.setScalar(r); o.updateMatrix();
      this.fronts.setMatrixAt(this.fronts.count++, o.matrix);
    }
    for (const e of w.effects) {
      if (!e.active) continue;
      const t = e.age / e.life;
      // Rakieta: kula ognia ~połowa promienia fali, krótko — rozdarcie ma być widoczne pod spodem.
      const size = e.kind === PW.ROCKET ? 0.5 : e.kind === PW.LANCE ? 0.7 : 1;
      o.position.set(e.x, e.y, e.z); o.scale.setScalar(e.radius * size * (0.25 + 0.75 * t)); o.updateMatrix();
      const i = this.flashes.count++;
      this.flashes.setMatrixAt(i, o.matrix);
      const fade = (1 - t) * (1 - t);
      const k = fade * (e.kind === PW.LANCE ? 0.7 : e.kind === PW.ROCKET ? 1.1 : 1.3);
      if (e.kind === PW.CANNON) this.color.setRGB(1, 0.85, 0.55);
      else if (e.kind === PW.ROCKET) this.color.setRGB(1, 0.45, 0.08);
      else if (e.kind === PW.BEAM) this.color.setRGB(1, 0.55, 0.2);
      else this.color.setRGB(0.75, 0.9, 1);
      this.flashes.setColorAt(i, this.color.multiplyScalar(k));
    }
    const beam = w.beam;
    if (beam.active) {
      const col = beam.legacy ? 0x62efff : 0xfff2d0;
      this.beamCore.material.color.set(col).multiplyScalar(2);
      this.beamGlow.material.color.set(beam.legacy ? 0x1f8cff : 0xff7a1e).multiplyScalar(2);
      this._streak(this.beamCore, beam.x0, beam.y0, beam.z0, beam.x1, beam.y1, beam.z1);
      this._streak(this.beamGlow, beam.x0, beam.y0, beam.z0, beam.x1, beam.y1, beam.z1);
    }
    for (const mesh of this.meshes) {
      mesh.visible = mesh.count > 0;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.flashes.count) this.flashes.instanceColor.needsUpdate = true;
    this._syncHot();
  }

  _syncHot() {
    const w = this.weapons, sys = w.system, melt = w.tune.melt, c = this._c;
    const pos = this.hotPos, col = this.hotCol;
    let n = 0;
    let size = 0;
    for (const B of w.hot) {
      if (!B || B.dead) continue;
      const s = B.nodeStore, m = sys._refreshRot(B), T = s.temp;
      size = Math.max(size, B.cellSize);
      for (let i = 0; i < s.count && n < HOT_CAPACITY; i++) {
        if (!s.active[i]) continue;
        const t = T[i] / melt;
        if (t < 0.08) continue;
        const x = s.x[i], y = s.y[i], z = s.z[i], j = n * 3;
        pos[j] = B.pos.x + m[0] * x + m[1] * y + m[2] * z;
        pos[j + 1] = B.pos.y + m[3] * x + m[4] * y + m[5] * z;
        pos[j + 2] = B.pos.z + m[6] * x + m[7] * y + m[8] * z;
        heatColor(t, c);
        col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
        n++;
      }
    }
    const geo = this.hot.geometry;
    geo.setDrawRange(0, n);
    this.hot.visible = n > 0;
    if (n > 0) {
      // Punkty na komórkę z zakładką — plama żaru zamiast kropkowanej kratki.
      if (size > 0) this.hotMaterial.size = size * 2.2;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
  }

  dispose(scene) {
    for (const m of this.meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose(); }
    scene.remove(this.hot); this.hot.geometry.dispose(); this.hotMaterial.map?.dispose(); this.hotMaterial.dispose();
  }
}
