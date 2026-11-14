// dema/rakiety-webgpu/missileBodies.js
//
// Kadłubki rakiet: jedna siatka instancjonowana (korpus, ostrołuk, 4
// stateczniki, dysza) wzdłuż +X, oświetlana słońcem i siatką świateł
// (MeshStandardNodeMaterial przez GridLighting dema asteroid) — przelatując
// przez błysk wybuchu albo reflektor statku, rakieta łapie światło.
// Barwa instancji = barwa kadłubka, pas i żar dyszy w emisji z atrybutu.
// Rakieta „Niszczyciel” ma własne siatki (buildHeavyGeometry: oba człony, sam
// penetrator, sam człon startowy) — każda to osobna instancja MissileBodies.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, vec3, mix, min, smoothstep, positionLocal, float } from 'three/tsl';

export const BODY_CAP = 4096;

function buildGeometry() {
  // Długość 1 (x od −0,5 do +0,5), średnica ~0,16 — skala z długości rakiety.
  const parts = [];
  const body = new THREE.CylinderGeometry(0.075, 0.08, 0.72, 10, 1, false);
  body.rotateZ(-Math.PI / 2);
  body.translate(-0.08, 0, 0);
  parts.push(body);
  const nose = new THREE.ConeGeometry(0.075, 0.2, 10, 1, false);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(0.38, 0, 0);
  parts.push(nose);
  const nozzle = new THREE.CylinderGeometry(0.05, 0.068, 0.06, 10, 1, true);
  nozzle.rotateZ(-Math.PI / 2);
  nozzle.translate(-0.47, 0, 0);
  parts.push(nozzle);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.BoxGeometry(0.16, 0.012, 0.13);
    fin.translate(-0.36, 0, 0.1);
    fin.rotateX(k * Math.PI / 2 + Math.PI / 4);
    parts.push(fin);
  }
  return mergeParts(parts);
}

function mergeParts(parts) {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    return n;
  });
  const merged = mergeGeometries(clean, false);
  merged.computeBoundingSphere();
  return merged;
}

// Walec / stożek ścięty wzdłuż +X: promień z tyłu r0, z przodu r1, środek w x.
function tube(r0, r1, len, x, open = false, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  g.rotateZ(-Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
}

// Cztery płetwy wokół osi: długość wzdłuż X, wysokość od powierzchni kadłubka o promieniu r, obrót o `phase`.
function fins(parts, len, height, x, r, phase) {
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.BoxGeometry(len, 0.013, height);
    fin.translate(x, 0, r + height * 0.5 - 0.012);
    fin.rotateX(k * Math.PI / 2 + phase);
    parts.push(fin);
  }
}

/**
 * Kadłubek ciężkiej rakiety „Niszczyciel” (długość 1, oś +X, środek w zerze) — dwa człony:
 *   • startowy: gruby korpus z czterema dużymi statecznikami i dyszą (x od −0,5 do −0,06),
 *   • bojowy (penetrator): smukły korpus z długim ostrołukiem, wąskimi skrzydełkami wzdłuż korpusu i małymi
 *     sterami (x od −0,06 do +0,5).
 * part: 'full' — oba człony (lot członem startowym), 'dart' — sam penetrator z własną dyszą (sprint; ten sam
 * układ współrzędnych, więc nos zostaje w miejscu), 'booster' — sam człon startowy WYŚRODKOWANY w zerze
 * (odrzucony, koziołkuje wokół własnego środka; przesunięcie HEAVY_BOOSTER_SHIFT).
 */
export const HEAVY_BOOSTER_SHIFT = 0.28;
export function buildHeavyGeometry(part = 'full') {
  const booster = [];
  booster.push(tube(0.074, 0.054, 0.045, -0.4775, true));
  booster.push(tube(0.086, 0.086, 0.335, -0.2875));
  booster.push(tube(0.086, 0.06, 0.06, -0.09));
  fins(booster, 0.17, 0.11, -0.37, 0.086, Math.PI / 4);
  const dart = [];
  dart.push(tube(0.06, 0.06, 0.28, 0.08));
  dart.push(tube(0.06, 0.034, 0.14, 0.29));
  const tip = new THREE.ConeGeometry(0.034, 0.14, 12, 1, false);
  tip.rotateZ(-Math.PI / 2);
  tip.translate(0.43, 0, 0);
  dart.push(tip);
  fins(dart, 0.2, 0.045, 0.07, 0.06, 0);
  fins(dart, 0.07, 0.07, -0.015, 0.06, Math.PI / 4);
  if (part === 'booster') {
    const g = mergeParts(booster);
    g.translate(HEAVY_BOOSTER_SHIFT, 0, 0);
    g.computeBoundingSphere();
    return g;
  }
  if (part === 'dart') {
    dart.push(tube(0.05, 0.046, 0.04, -0.08, true));
    return mergeParts(dart);
  }
  return mergeParts([...booster, ...dart]);
}

/**
 * Wygląd kadłubków „Niszczyciela” (opcje MissileBodies): pasy barwy [x0, x1] w układzie siatki i miejsce żaru dyszy.
 * Pas na korpusie penetratora, ostrzegawczy czubek głowicy, wąski pas przy złączu członu startowego.
 */
export const HEAVY_BODY_LOOK = Object.freeze({
  full: { bands: [[0.03, 0.1], [0.4, 0.6], [-0.2, -0.165]], nozzle: -0.44 },
  dart: { bands: [[0.03, 0.1], [0.4, 0.6]], nozzle: -0.07, nozzleColor: [0.7, 1.15, 2.1] },
  booster: { bands: [[HEAVY_BOOSTER_SHIFT - 0.2, HEAVY_BOOSTER_SHIFT - 0.165]], nozzle: HEAVY_BOOSTER_SHIFT - 0.44 }
});

export class MissileBodies {
  /**
   * geometry — siatka kadłubka (domyślnie rakieta standardowa), bands — pasy barwy strony [x0, x1] (układ siatki),
   * nozzle — x, za którym świeci żar dyszy, nozzleColor — jego barwa HDR.
   */
  constructor({ scene, capacity = BODY_CAP, renderOrder = 50, geometry = null, bands = [[0.04, 0.15]], nozzle = -0.44, nozzleColor = [1.6, 0.8, 0.35], name = 'missileBodies' }) {
    this.capacity = capacity;
    const geo = geometry || buildGeometry();
    this.band = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.band.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('mBand', this.band);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0.55 });
    // Pasy barwy strony na korpusie (domyślnie x ∈ [0,04; 0,15] z miękkim brzegiem ±0,01) i żar dyszy (x < nozzle).
    const band = attribute('mBand', 'vec4');
    const x = positionLocal.x;
    let inBand = null;
    for (const [a, b] of bands) {
      const one = smoothstep(a - 0.01, a + 0.01, x).mul(float(1.0).sub(smoothstep(b - 0.01, b + 0.01, x)));
      inBand = inBand ? inBand.add(one) : one;
    }
    mat.colorNode = mix(vec3(1.0), band.xyz, bands.length > 1 ? min(inBand, 1.0) : inBand);
    mat.emissiveNode = vec3(nozzleColor[0], nozzleColor[1], nozzleColor[2]).mul(band.w).mul(float(1.0).sub(smoothstep(nozzle - 0.03, nozzle + 0.01, x)));
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.name = name;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 0, 1);
    this._roll = new THREE.Quaternion();
    this._x = new THREE.Vector3(1, 0, 0);
    this._y = new THREE.Vector3(0, 1, 0);
    this._pitch = new THREE.Quaternion();
  }

  begin() {
    this.count = 0;
  }

  /**
   * Rakieta w SCENIE: środek, kąt (scena), długość [j.], barwy, żar dyszy 0..1, obrót wokół osi,
   * wzniesienie nosa [rad] (jak w grze: nos ku +z sceny — ku kamerze z góry; w pionie krążek).
   */
  add(x, y, z, angle, length, hull, band, glow, roll = 0, pitch = 0) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this._q.setFromAxisAngle(this._axis, angle);
    if (pitch) {
      this._pitch.setFromAxisAngle(this._y, -pitch);
      this._q.multiply(this._pitch);
    }
    this._roll.setFromAxisAngle(this._x, roll);
    this._q.multiply(this._roll);
    this._p.set(x, y, z);
    this._s.set(length, length, length);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    const c = this.mesh.instanceColor.array;
    c[i * 3] = hull[0]; c[i * 3 + 1] = hull[1]; c[i * 3 + 2] = hull[2];
    const b = this.band.array;
    b[i * 4] = band[0]; b[i * 4 + 1] = band[1]; b[i * 4 + 2] = band[2]; b[i * 4 + 3] = glow;
  }

  commit() {
    const n = this.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor;
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, n * 3);
    ic.needsUpdate = true;
    this.band.clearUpdateRanges();
    this.band.addUpdateRange(0, n * 4);
    this.band.needsUpdate = true;
  }
}
