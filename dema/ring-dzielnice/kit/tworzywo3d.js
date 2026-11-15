// DZIELNICE RINGU — zestaw wspólny, TWORZYWO w 3D: partia brył ruchomych procesu (three + TSL, tylko demo).
//
// Sześć siatek instancji (zestaw bg / fg × pudło / walec / stożek) na jednym materiale węzłowym; dane z rejestratora
// (kit/tworzywo.js) idą na GPU raz na klatkę zakresem zajętych instancji. Układ i ramka jak budowle portowe dzielnicy
// (korzeń z macierzą `portHubMatrixElements(frame)` pod gospodarzem), światło słońca z budowli (ten sam kierunek).
// Żar: barwa ciała czarnego w HDR — bloom gry robi resztę (powierzchnie zwykłe zostają pod progiem).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cross, dot, float, max, mix, modelViewMatrix, normalGeometry,
  normalize, positionGeometry, pow, smoothstep, step, uniform, varyingProperty, vec3, vec4
} from 'three/tsl';
import { portHubMatrixElements } from '../../../src/3d/portBuildings/portModuleTraffic.js';
import { PORT_SPACE_LIGHT } from '../../../src/3d/portBuildings/portBuildings3D.js';
import { TW_SETS, TW_SHAPES, TW_STRIDE } from './tworzywo.js';

const qrot = (q, v) => {
  const t = cross(q.xyz, v).mul(2.0);
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

function buildMaterial(U) {
  const vN = varyingProperty('vec3', 'vTwN');
  const vP = varyingProperty('vec3', 'vTwP');
  const vCol = varyingProperty('vec4', 'vTwCol');
  const vHeat = varyingProperty('float', 'vTwHeat');
  const vertex = Fn(() => {
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec4');
    const iQ = attribute('iQ', 'vec4');
    const iC = attribute('iC', 'vec4');
    const lp = positionGeometry.mul(iB.xyz).toVar();
    const r = qrot(iQ, lp).toVar();
    const hubP = vec4(iA.xyz.add(vec3(r.x, r.y.mul(iA.w), r.z)), 1.0).toVar();
    const nl = normalize(normalGeometry.div(max(iB.xyz, vec3(1e-3)))).toVar();
    const nr0 = qrot(iQ, nl).toVar();
    const nr = normalize(vec3(nr0.x, nr0.y.div(max(iA.w, 1e-3)), nr0.z)).toVar();
    const mv = modelViewMatrix.mul(hubP).toVar();
    vN.assign(normalize(modelViewMatrix.mul(vec4(nr, 0.0)).xyz));
    vP.assign(mv.xyz);
    vCol.assign(iC);
    vHeat.assign(iB.w);
    return cameraProjectionMatrix.mul(mv);
  })();
  const fragment = Fn(() => {
    const N = normalize(vN).toVar();
    const L = normalize(cameraViewMatrix.mul(vec4(U.sunDir, 0.0)).xyz).toVar();
    const V = normalize(vP.negate()).toVar();
    const ndl = max(dot(N, L), 0.0).toVar();
    const mode = vCol.w.toVar();
    const metal = step(0.5, mode).mul(float(1.0).sub(step(1.5, mode))).toVar();
    const lamp = step(1.5, mode).toVar();
    // barwy tworzywa podaje się „naturalne”; potok gry jest jasny (płyty zestawu mnożą albedo przez ~0,3–0,5)
    const alb = vCol.xyz.mul(mix(float(0.45), float(1.0), lamp)).toVar();
    const h = clamp(vHeat, 0.0, 1.3).toVar();
    const Hv = normalize(L.add(V)).toVar();
    const spec = pow(max(dot(N, Hv), 0.0), mix(float(14.0), float(42.0), metal)).mul(ndl).mul(mix(float(0.05), float(0.5), metal)).toVar();
    // otoczenie: z góry jaśniej (odbicie od pokładów), boki ciemniej
    const up = max(dot(N, normalize(cameraViewMatrix.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz)), 0.0);
    const amb = U.ambient.mul(float(0.6).add(up.mul(0.9))).toVar();
    const lit = alb.mul(U.sunColor.mul(ndl).mul(mix(float(1.0), float(0.75), metal)).add(amb)).add(U.sunColor.mul(spec)).toVar();
    // żar ciała: ciemna czerwień → pomarańcz → biało-żółty; jasność rośnie stromo (HDR)
    // żar 1,0 = ciekły metal (pomarańczowo-żółty, HDR jak lampy gry ~1,4); powyżej 1 — rdzeń kąpieli, biało-żółty
    // (zielony kanał trzymany nisko: po ACES ciekły metal ma być pomarańczowy, nie żółto-biały)
    const c1 = mix(vec3(0.8, 0.02, 0.0), vec3(1.0, 0.115, 0.008), smoothstep(0.14, 0.5, h));
    const c2 = mix(c1, vec3(1.0, 0.215, 0.02), smoothstep(0.5, 0.95, h));
    const c3 = mix(c2, vec3(1.0, 0.5, 0.14), smoothstep(1.0, 1.3, h));
    const glow = c3.mul(h.mul(h).mul(float(0.45).add(h.mul(1.05)))).toVar();
    // rozżarzone ciało nie pokazuje barwy zimnego metalu (odbite światło ginie w żarze)
    const cold = float(1.0).sub(clamp(h.mul(1.25), 0.0, 1.0)).toVar();
    const body = lit.mul(cold.mul(cold)).add(glow);
    const bulb = alb.mul(vHeat.mul(3.2)).add(lit.mul(0.15));
    return vec4(max(mix(body, bulb, lamp), vec3(0.0)), 1.0);
  })();
  const m = new NodeMaterial();
  m.name = 'TworzywoDzielnicy';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = THREE.DoubleSide;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  return m;
}

export class Tworzywo3D {
  /**
   * @param {object} o   recorder — TworzywoRecorder; frame — ramka budowli dzielnicy (portModuleFrame); host — grupa
   *                     gospodarza; sunDir — THREE.Vector3 kierunku słońca w scenie (wspólny z budowlami, żywy obiekt)
   */
  constructor({ recorder, frame, host, sunDir }) {
    this.recorder = recorder;
    this.root = new THREE.Group();
    this.root.name = 'Tworzywo';
    this.root.matrixAutoUpdate = false;
    this.root.matrix.fromArray(portHubMatrixElements(frame));
    host.add(this.root);
    this.root.updateMatrixWorld(true);
    this.uniforms = {
      sunDir: uniform(sunDir || new THREE.Vector3(0.4, 0.3, 0.87).normalize()),
      sunColor: uniform(new THREE.Vector3(...PORT_SPACE_LIGHT.sunColor)),
      ambient: uniform(new THREE.Vector3(0.085, 0.092, 0.105))
    };
    this.material = buildMaterial(this.uniforms);
    const bases = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 20, 1, false), cone: new THREE.ConeGeometry(1, 1, 18, 1) };
    this.meshes = {};
    for (const set of TW_SETS) {
      for (const shape of TW_SHAPES) {
        const key = `${set}_${shape}`;
        const base = bases[shape];
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.setAttribute('position', base.getAttribute('position'));
        geo.setAttribute('normal', base.getAttribute('normal'));
        const buf = new THREE.InstancedInterleavedBuffer(recorder.data[key], TW_STRIDE);
        geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
        geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
        geo.setAttribute('iQ', new THREE.InterleavedBufferAttribute(buf, 4, 8));
        geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 12));
        geo.instanceCount = 0;
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.name = `Tworzywo_${key}`;
        mesh.frustumCulled = false;
        mesh.visible = false;
        this.root.add(mesh);
        this.meshes[key] = { mesh, geo, buf, set };
      }
    }
    this.setLayers(1, 2);
  }

  setLayers(bg, fg) { for (const m of Object.values(this.meshes)) m.mesh.layers.set(m.set === 'fg' ? fg : bg); }

  /** Wyślij zapisane instancje (po `frame(api)` wtyczek). */
  commit() {
    const rec = this.recorder;
    for (const key in this.meshes) {
      const m = this.meshes[key];
      const n = rec.count[key];
      m.geo.instanceCount = n;
      m.mesh.visible = n > 0;
      if (!n) continue;
      m.buf.clearUpdateRanges();
      m.buf.addUpdateRange(0, n * TW_STRIDE);
      m.buf.needsUpdate = true;
    }
  }
}
