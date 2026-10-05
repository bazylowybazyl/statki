// Żar węzłów broni cieplnej w demie destruktor3d-webgpu.html: WebGPU rysuje THREE.Points zawsze po 1 px,
// więc punkty BeamPhysicalWeaponsVisual3D (pozycje i barwy żaru z magazynu ciała) idą tu jako kwady
// zwrócone do kamery (instancje na tych samych tablicach), addytywnie, z miękkim spadkiem.
import * as THREE from 'three/webgpu';
import { Fn, float, vec4, uniform, attribute, positionGeometry, varyingProperty, dot, exp } from 'three/tsl';

export class HotGlowBillboards {
  /** @param {THREE.Scene} scene @param {import('./beamPhysicalWeaponsVisual3D.js').BeamPhysicalWeaponsVisual3D} visual */
  constructor(scene, visual) {
    this.visual = visual;
    const cap = visual.hotPos.length / 3;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(visual.hotPos, 3);
    this.aCol = new THREE.InstancedBufferAttribute(visual.hotCol, 3);
    geo.setAttribute('hotP', this.aPos);
    geo.setAttribute('hotC', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    this.U = { right: uniform(new THREE.Vector3(1, 0, 0)), up: uniform(new THREE.Vector3(0, 1, 0)), size: uniform(1), gain: uniform(1.6) };
    const U = this.U;
    const vQ = varyingProperty('vec2', 'vHotQ');
    const vC = varyingProperty('vec3', 'vHotC');
    const mat = new THREE.NodeMaterial();
    mat.name = 'BeamHotGlow';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.AdditiveBlending;
    mat.positionNode = Fn(() => {
      const q = positionGeometry.xy.mul(2.0);
      vQ.assign(q);
      vC.assign(attribute('hotC', 'vec3'));
      return attribute('hotP', 'vec3').add(U.right.mul(q.x.mul(U.size))).add(U.up.mul(q.y.mul(U.size)));
    })();
    mat.fragmentNode = Fn(() => {
      const r2 = dot(vQ, vQ);
      const k = exp(r2.mul(-3.2)).mul(float(1.0).sub(r2.clamp(0.0, 1.0)));
      return vec4(vC.mul(k).mul(U.gain), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.capacity = cap;
  }

  sync(camera) {
    const v = this.visual;
    v.hot.visible = false;
    const n = v.hot.geometry.drawRange.count;
    const count = Number.isFinite(n) ? Math.min(n, this.capacity) : 0;
    this.geo.instanceCount = count;
    this.mesh.visible = count > 0;
    if (!count) return;
    const e = camera.matrixWorld.elements;
    this.U.right.value.set(e[0], e[1], e[2]).normalize();
    this.U.up.value.set(e[4], e[5], e[6]).normalize();
    // Rozmiar punktu PointsMaterial (z tłumieniem odległością) ≈ bok kwadu · tan(fov/2).
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) * 0.5);
    this.U.size.value = (v.hotMaterial.size || 1) * tanH * 0.5;
    for (const a of [this.aPos, this.aCol]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * 3);
      a.needsUpdate = true;
    }
  }
}
