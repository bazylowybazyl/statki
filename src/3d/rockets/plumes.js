// src/3d/rockets/plumes.js
//
// Płomień silnika rakiety (port z dema dema/rakiety-webgpu/plumes.js, zadanie 19) — kwad
// wzdłuż osi dyszy, kształt liczony analitycznie (widok z góry, ortho). Dwa rodzaje:
//   • rakieta chemiczna (kind 0/1): biały rdzeń tuż za dyszą, ciało żółte → pomarańczowe
//     → czerwone, DYSKI MACHA (jasne węzły i przewężenia w pierwszej połowie strumienia),
//     migotanie;
//   • napęd plazmowy supernowej (kind 2): cienka biała linia rdzenia, ciało magenta,
//     fioletowa otoczka, spiralna niestabilność (kink) i smugi płynące w dół strugi.
// Plan pasm HDR: nad progiem bloomu tylko rdzeń (≤ ~3 px przy zoomie 1), ciało ≤ ~1.
// Addytywnie, alfa celu bez zmian. Instancje przepisywane co klatkę (po origin.update) —
// pozycje lokalne względem początku pul Core3D, siatka na `mesh.position = początek`.
// Bufory wierzchołków: pozycja, uv + 6 atrybutów instancji = 8 (limit — PLAN §3).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, varyingProperty, positionGeometry,
  mix, smoothstep, clamp, exp, sin, cos, max, pow
} from 'three/tsl';

export const PLUME_CAP = 2048;

function liveAttr(capacity) {
  const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  at.setUsage(THREE.DynamicDrawUsage);
  const range = { start: 0, count: 4 };
  at.updateRanges.length = 0;
  at.updateRanges.push(range);
  at.clearUpdateRanges = () => {};
  at.__range = range;
  return at;
}

export class PlumeSystem {
  constructor({ scene, capacity = PLUME_CAP, renderOrder = 70 }) {
    this.capacity = capacity;
    this.count = 0;
    // Wpis roboczy dla push(): wołający wypełnia pola i woła push() — w pętlach klatki bez
    // przekazywania liczb zmiennoprzecinkowych przez argumenty (V8 opakowuje je w obiekty
    // przy wywołaniu, którego nie wklei; add(...) zostaje dla wywołań rzadkich).
    this.s = { x: 0, y: 0, z: 0, dx: 1, dy: 0, len: 0, width: 0, throttle: 0, kind: 0, seed: 0, intensity: 1 };
    this.U = { time: uniform(0), zoom: uniform(1), gain: uniform(1) };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.p0 = liveAttr(capacity); this.p1 = liveAttr(capacity); this.p2 = liveAttr(capacity);
    this.p3 = liveAttr(capacity); this.p4 = liveAttr(capacity); this.p5 = liveAttr(capacity);
    this._attrs = [this.p0, this.p1, this.p2, this.p3, this.p4, this.p5];
    geo.setAttribute('pl0', this.p0); // xyz dysza (lokalnie), długość
    geo.setAttribute('pl1', this.p1); // kierunek strugi (xy scena), szerokość, ciąg
    geo.setAttribute('pl2', this.p2); // rodzaj, ziarno, jasność, —
    geo.setAttribute('pl3', this.p3); // rdzeń (rgb HDR)
    geo.setAttribute('pl4', this.p4); // gorąca barwa (rgb)
    geo.setAttribute('pl5', this.p5); // środek (rgb)
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vA = varyingProperty('vec4', 'vRkPlA'); // s, t, rodzaj, ziarno
    const vB = varyingProperty('vec4', 'vRkPlB'); // jasność, ciąg, długość w px, —
    const vCore = varyingProperty('vec3', 'vRkPlCore');
    const vHot = varyingProperty('vec3', 'vRkPlHot');
    const vMid = varyingProperty('vec3', 'vRkPlMid');
    const mat = new THREE.NodeMaterial();
    mat.name = 'RocketPlume';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;
    mat.positionNode = Fn(() => {
      const A = attribute('pl0', 'vec4');
      const B = attribute('pl1', 'vec4');
      const C = attribute('pl2', 'vec4');
      const q = positionGeometry.xy;
      // s ∈ [−0,08; 1] (lekko przed dyszą — rdzeń obejmuje wylot), t ∈ [−1; 1].
      const s = q.x.add(0.5).mul(1.08).sub(0.08);
      const t = q.y.mul(2.0);
      const dir = B.xy;
      const perp = vec2(dir.y.negate(), dir.x);
      // Szerokość kwadu z minimum ~6 px, żeby rdzeń nie znikał przy oddaleniu.
      const halfW = max(B.z.mul(0.8), float(3.0).div(U.zoom));
      const p = A.xy.add(dir.mul(s.mul(A.w))).add(perp.mul(t.mul(halfW)));
      vA.assign(vec4(s, t.mul(halfW).div(max(B.z.mul(0.5), 1e-3)), C.x, C.y));
      vB.assign(vec4(C.z, B.w, A.w.mul(U.zoom), halfW.div(max(B.z.mul(0.5), 1e-3))));
      vCore.assign(attribute('pl3', 'vec4').xyz);
      vHot.assign(attribute('pl4', 'vec4').xyz);
      vMid.assign(attribute('pl5', 'vec4').xyz);
      return vec3(p, A.z);
    })();
    mat.fragmentNode = Fn(() => {
      const s = vA.x.toVar();
      const t = vA.y.toVar(); // w jednostkach nominalnej pół-szerokości strugi
      const kind = vA.z;
      const seed = vA.w;
      const inten = vB.x;
      const thr = vB.y;
      const time = U.time;
      const sPos = clamp(s, 0.0, 1.0).toVar();
      const inFront = smoothstep(-0.08, 0.0, s);
      // Potęgi tylko z nieujemną podstawą (clamp przed pow — MSAA ekstrapoluje varyingi).
      const tailFade = pow(float(1.0).sub(sPos), 1.35).toVar();
      const flick = sin(time.mul(37.0).add(seed.mul(50.0))).mul(sin(time.mul(23.0).add(seed.mul(13.0)))).mul(0.12).add(0.88);
      const out = vec3(0.0).toVar();

      // --- Chemiczna: dyski Macha ---
      const N = float(4.2);
      const phase = sPos.mul(N).mul(6.2831853);
      const w = mix(float(0.18), float(0.64), pow(sPos, 0.7));
      const pinch = float(1.0).sub(exp(sPos.mul(-2.6)).mul(0.5).mul(cos(phase).mul(0.5).add(0.5)));
      const wE = max(w.mul(pinch), 0.04);
      const g = exp(t.div(wE).mul(t.div(wE)).mul(-2.0));
      const nodeC = max(cos(phase.add(3.14159)), 0.0);
      const node2 = nodeC.mul(nodeC);
      const node4 = node2.mul(node2);
      const nodes = exp(sPos.mul(-2.6)).mul(node4.mul(node4));
      const body = g.mul(tailFade).mul(inFront).mul(nodes.mul(2.8).add(0.6)).mul(flick);
      const colA = mix(vHot, vMid, smoothstep(0.02, 0.42, sPos));
      const tail = vMid.mul(vec3(0.62, 0.34, 0.2));
      const col = mix(colA, tail, smoothstep(0.38, 1.0, sPos));
      const coreW = sPos.mul(0.05).add(0.07);
      const core = exp(t.div(coreW).mul(t.div(coreW)).mul(-2.5)).mul(exp(sPos.div(-0.08))).mul(inFront);
      const chem = col.mul(body).mul(inten).add(vCore.mul(core));

      // --- Plazma: spiralna niestabilność, smugi ---
      const wob = sPos.mul(0.24).mul(sin(sPos.mul(3.2).sub(time.mul(4.0)).mul(6.2831853).add(seed.mul(6.0))));
      const tt = t.sub(wob);
      const lineW = sPos.mul(0.04).add(0.05);
      const oneMinus = float(1.0).sub(sPos).toVar();
      const line = exp(tt.div(lineW).mul(tt.div(lineW)).mul(-2.5)).mul(pow(oneMinus, 0.6)).mul(inFront);
      const bw = sPos.mul(0.3).add(0.12);
      const pbody = exp(tt.div(bw).mul(tt.div(bw)).mul(-2.0)).mul(pow(oneMinus, 1.1));
      const sw = sPos.mul(0.5).add(0.25);
      const sheath = exp(t.div(sw).mul(t.div(sw)).mul(-1.5)).mul(pow(oneMinus, 1.8));
      const streak = sin(sPos.mul(60.0).sub(time.mul(50.0)).add(seed.mul(20.0))).mul(0.25).add(0.75);
      const violet = vMid.mul(vec3(0.45, 0.35, 1.0));
      const plasma = vCore.mul(line.mul(0.9)).add(vMid.mul(pbody.mul(streak).mul(inten))).add(violet.mul(sheath.mul(0.55).mul(inten))).mul(flick.mul(0.5).add(0.5)).mul(inFront);

      out.assign(mix(chem, plasma, smoothstep(1.5, 2.0, kind)));
      // Zgaszony silnik (ciąg 0) nie świeci; minimalny ciąg = mały płomyk.
      const thrK = smoothstep(0.0, 0.12, thr);
      // Poniżej ~6 px długości kwad zamienia się w punkt — przygaszenie.
      const pxK = smoothstep(2.0, 10.0, vB.z);
      return vec4(max(out.mul(thrK).mul(pxK.mul(0.7).add(0.3)).mul(U.gain), vec3(0.0)), 0.0);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'RocketPlumes';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /**
   * Płomień (LOKALNIE): dysza (x, y, z), kierunek strugi (dx, dy) — OD dyszy do tyłu (scena),
   * długość i szerokość [j.], ciąg 0..1, profil barw z palette.js.
   */
  add(x, y, z, dx, dy, len, width, throttle, kind, seed, intensity, core, hot, mid) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const o = i * 4;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    const P0 = this.p0.array; const P1 = this.p1.array; const P2 = this.p2.array;
    const P3 = this.p3.array; const P4 = this.p4.array; const P5 = this.p5.array;
    P0[o] = x; P0[o + 1] = y; P0[o + 2] = z; P0[o + 3] = len;
    P1[o] = dx / l; P1[o + 1] = dy / l; P1[o + 2] = width; P1[o + 3] = throttle;
    P2[o] = kind; P2[o + 1] = seed; P2[o + 2] = intensity; P2[o + 3] = 0;
    P3[o] = core[0]; P3[o + 1] = core[1]; P3[o + 2] = core[2]; P3[o + 3] = 0;
    P4[o] = hot[0]; P4[o + 1] = hot[1]; P4[o + 2] = hot[2]; P4[o + 3] = 0;
    P5[o] = mid[0]; P5[o + 1] = mid[1]; P5[o + 2] = mid[2]; P5[o + 3] = 0;
  }

  /** Płomień z wpisu roboczego `s` (pola jak argumenty add) i profil barw. */
  push(core, hot, mid) {
    if (this.count >= this.capacity) return;
    const s = this.s;
    const i = this.count++;
    const o = i * 4;
    const l = Math.sqrt(s.dx * s.dx + s.dy * s.dy) || 1;
    const P0 = this.p0.array; const P1 = this.p1.array; const P2 = this.p2.array;
    const P3 = this.p3.array; const P4 = this.p4.array; const P5 = this.p5.array;
    P0[o] = s.x; P0[o + 1] = s.y; P0[o + 2] = s.z; P0[o + 3] = s.len;
    P1[o] = s.dx / l; P1[o + 1] = s.dy / l; P1[o + 2] = s.width; P1[o + 3] = s.throttle;
    P2[o] = s.kind; P2[o + 1] = s.seed; P2[o + 2] = s.intensity; P2[o + 3] = 0;
    P3[o] = core[0]; P3[o + 1] = core[1]; P3[o + 2] = core[2]; P3[o + 3] = 0;
    P4[o] = hot[0]; P4[o + 1] = hot[1]; P4[o + 2] = hot[2]; P4[o + 3] = 0;
    P5[o] = mid[0]; P5[o + 1] = mid[1]; P5[o + 2] = mid[2]; P5[o + 3] = 0;
  }

  commit(time, zoom, ox, oy) {
    this.U.time.value = time;
    this.U.zoom.value = zoom;
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const m = this.mesh;
    m.position.set(ox, oy, 0);
    m.updateMatrix();
    m.matrixWorld.copy(m.matrix);
    for (let k = 0; k < this._attrs.length; k++) {
      const at = this._attrs[k];
      at.__range.start = 0;
      at.__range.count = n * 4;
      at.needsUpdate = true;
    }
  }
}
