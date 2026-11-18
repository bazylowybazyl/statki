// HUTA — element 4 (dzielenie, runda 9): POLE RUCHOME — partia pudeł pola (1 rysunek, addytywnie, bez zapisu głębi).
// Tylko TSL, graf raz na moduł; uniformy od zer (pułapka 46); bez pochodnych ekranu.
//
// Język pól linii (powłoka rękawa, bramy, ostrze): przezroczysta skóra, jasny brzeg (kreska rozciągnięta do piksela z
// zachowaniem energii — bez migotania), linie sił; jasność z LICZONEJ siły (model), pod progiem poświaty poza liniami.
// Rodzaje instancji (iA.w):
//   0  POKRYWA POLA kasety — zamyka się w `lid` s wzdłuż x (front zamykania jasny), potem trzyma argon nad wyrobem;
//   1  CHWYT — pas pola wzdłuż chwyconej krawędzi arkusza od lica listwy do krawędzi; linie sił co odcinek emitera listwy
//      (stoją z listwą), jasność = siła chwytu / F_REF — z kamery gry zapalony kawałek jedzie z arkuszem i hamuje z nim;
//   2  WYRZUT — pasy pola wzdłuż obu krawędzi w wyrzucie (jasność = siła wyrzutu / F_REF).
// Rekord instancji (`POLE_STRIDE` f32): iA = (środek x, y, z, rodzaj), iB = (półosie x, y, z, jasność 0…), iC = (postęp
// 0…1, x0 linii sił, podziałka linii sił, 0).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import { Fn, abs, attribute, cameraProjectionMatrix, clamp, exp, float, floor, max, min, mix, modelViewMatrix, smoothstep, varyingProperty, vec3, vec4 } from 'three/tsl';
import { blendAddytywnePremul } from '../../../../src/3d/tsl/mieszanie.js';
import { pxWorld } from './krawedzTSL.js';

export const POLE_STRIDE = 12;
export const POLE_CAP = 16;
export const POLE_RODZAJ = Object.freeze({ POKRYWA: 0, CHWYT: 1, WYRZUT: 2 });

const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
const V3 = (e) => { const v = vec3(0.0).toVar(); v.assign(e); return v; };
const V4 = (e) => { const v = vec4(0.0).toVar(); v.assign(e); return v; };
/** 1 dla x > 0. */
const step01 = (x) => clamp(x.mul(1e6), 0.0, 1.0);

/** Siatka: pudło jednostkowe (−1…1)³ — 6 ścian po 2 trójkąty; atrybut `aF` — normalna ściany (lokalna). */
export function createFieldGeometry() {
  const pos = [];
  const nor = [];
  const face = (n, u, v) => {
    const c = (a, b) => [n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { pos.push(...c(a, b)); nor.push(...n); }
  };
  face([1, 0, 0], [0, 1, 0], [0, 0, 1]); face([-1, 0, 0], [0, 0, 1], [0, 1, 0]);
  face([0, 1, 0], [0, 0, 1], [1, 0, 0]); face([0, -1, 0], [1, 0, 0], [0, 0, 1]);
  face([0, 0, 1], [1, 0, 0], [0, 1, 0]); face([0, 0, -1], [0, 1, 0], [1, 0, 0]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aF', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.instanceCount = 0;
  return g;
}

/** Materiał pola ruchomego. `U` — uniformy wytopu (`U.cam`), `buf` — `InstancedInterleavedBuffer` (krok `POLE_STRIDE`). */
export function createFieldMaterial(U, buf) {
  const iA = new THREE.InterleavedBufferAttribute(buf, 4, 0);
  const iB = new THREE.InterleavedBufferAttribute(buf, 4, 4);
  const iC = new THREE.InterleavedBufferAttribute(buf, 4, 8);
  const vP = varyingProperty('vec3', 'vPoP');
  const vL = varyingProperty('vec3', 'vPoL');
  const vF = varyingProperty('vec3', 'vPoF');
  const vA = varyingProperty('vec4', 'vPoA');
  const vB = varyingProperty('vec4', 'vPoB');
  const vC = varyingProperty('vec4', 'vPoC');
  const vertex = Fn(() => {
    const p0 = attribute('position', 'vec3');
    const A = V4(attribute('iA', 'vec4'));
    const Bq = V4(attribute('iB', 'vec4'));
    const P = V3(A.xyz.add(p0.mul(Bq.xyz)));
    vP.assign(P);
    vL.assign(p0);
    vF.assign(attribute('aF', 'vec3'));
    vA.assign(A);
    vB.assign(Bq);
    vC.assign(attribute('iC', 'vec4'));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(P, 1.0)));
  })();
  const fragment = Fn(() => {
    const P = V3(vP);
    const L = V3(vL);
    const Fn0 = V3(vF);
    const H = V3(vB.xyz);
    const kind = F1(floor(vA.w.add(0.5)));
    const isLid = F1(float(1.0).sub(min(kind, 1.0)));
    const isGrip = F1(float(1.0).sub(min(abs(kind.sub(1.0)), 1.0)));
    const F = F1(max(vB.w, 0.0));
    const prog = F1(clamp(vC.x, 0.0, 1.0));
    const px = F1(pxWorld(U.cam, P));
    // kreska o szerokości w [j.] w odległości d — rozciągnięta do piksela z zachowaniem energii
    const kreska = (d, w) => {
      const wv = F1(max(w, px.mul(0.85)));
      const a = F1(d.div(wv));
      return exp(a.mul(a).negate()).mul(w.div(wv));
    };
    // odległość do krawędzi ściany [j.] — dwie osie ściany (te, wzdłuż których normalna jest zerowa)
    const ax = F1(float(1.0).sub(abs(Fn0.x)));
    const ay = F1(float(1.0).sub(abs(Fn0.y)));
    const az = F1(float(1.0).sub(abs(Fn0.z)));
    const dX = F1(H.x.sub(abs(L.x).mul(H.x)));
    const dY = F1(H.y.sub(abs(L.y).mul(H.y)));
    const dZ = F1(H.z.sub(abs(L.z).mul(H.z)));
    const BIG = 1e6;
    const dEdge = F1(min(min(mix(float(BIG), dX, ax), mix(float(BIG), dY, ay)), mix(float(BIG), dZ, az)));
    const rim = F1(kreska(dEdge, float(0.8)));
    // POKRYWA: zamknięta część od −x do frontu zamykania (postęp), front zamykania — jasna kreska
    const xLoc = F1(L.x.mul(0.5).add(0.5));
    const closed = F1(mix(float(1.0), float(1.0).sub(smoothstep(prog.sub(0.004), prog.add(0.004), xLoc)), isLid));
    const front = F1(kreska(xLoc.sub(prog).mul(H.x.mul(2.0)), float(1.2)).mul(step01(float(0.999).sub(prog))).mul(isLid).mul(step01(prog.sub(0.001))));
    // LINIE SIŁ chwytu / wyrzutu: co odcinek emitera listwy (stoją z listwą), wzdłuż pasa w poprzek (z) — z góry krótkie
    // kreski pod krawędzią, zapalone tylko tam, gdzie pole trzyma arkusz
    const pitch = F1(max(vC.z, 1.0));
    const q = F1(P.x.sub(vC.y).div(pitch));
    const qf = F1(q.sub(floor(q)).sub(0.5).mul(pitch));
    const lines = F1(kreska(qf, float(0.6)).mul(float(1.0).sub(isLid)).mul(smoothstep(0.2, 0.8, abs(Fn0.y))));
    const skin = F1(mix(float(0.05), float(0.03), isLid));
    const k = F1(skin.add(rim.mul(0.55)).add(lines.mul(0.45)).mul(closed).add(front.mul(1.4)));
    const cyan = vec3(0.16, 0.72, 1.0);
    // jasność: chwyt i wyrzut — siła (czuwanie przy krawędzi bez siły: przygaszone), pokrywa — moc zamykania i trzymania
    const gain = F1(mix(F.mul(0.9).add(0.06), F, isLid).mul(mix(float(1.0), float(0.9), isGrip)));
    const c = V3(cyan.mul(k.mul(gain)));
    return vec4(c, max(max(c.x, c.y), c.z));
  })();
  const m = new NodeMaterial();
  m.name = 'DzieleniePoleRuchome';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  blendAddytywnePremul(m);
  return { material: m, attrs: { iA, iB, iC } };
}
