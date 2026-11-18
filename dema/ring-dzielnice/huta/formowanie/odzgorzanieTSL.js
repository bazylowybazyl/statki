// HUTA — runda 9, etap „Czysta stal”: WARSTWA PLAZMY STACJI ODZGORZANIA (TSL, jeden graf, jeden rysunek, addytywnie, bez
// zapisu głębi). Język pól linii: przezroczysta skóra pola, jasny brzeg, linie sił; plazma świeci tylko tam, gdzie pracuje.
//
// Siatka (stała, układ komory): trzy płaty — [0] warstwa górna: od lica emitera belki górnej do linii styku na licu taśmy,
// pochylona pod prąd (jak dysze zbijaczy zgorzeliny), [1] warstwa dolna (belka dolna → spód taśmy), [2] pas STYKU na
// wierzchu taśmy (strefa czyszczenia). Atrybut `aQ` = (u — w poprzek −1…1, v — 0 przy licu taśmy … 1 przy emiterze /
// w pasie styku: x względem linii styku [j.], rodzaj płata).
// Wygląd z liczonego stanu (`OZ`): moc stacji U (jasność warstwy), ŁADUNEK TLENKU ξ przed stacją (iskrzenie dopalającego
// się tlenku w pasie styku — ciepła barwa, gaśnie, gdy taśma czysta), przepływ ku ssawom (wzór płynie od osi ku brzegom —
// gaz plazmy niesie zgorzelinę do odciągu: prędkość z pola odciągu, nie zapętlona animacja w miejscu), czas linii.
// HDR tylko w wąskiej linii styku (≤ ~1,2); warstwa i pas poniżej progu poświaty (~0,9) — bez cyjanowej mgły bloomu.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, cameraProjectionMatrix, clamp, exp, float, floor, fract, max, min, mix, modelViewMatrix, sin,
  smoothstep, uniform, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { blendAddytywnePremul } from '../../../../src/3d/tsl/mieszanie.js';
import { hash21, noise3 } from '../wytop/wspolneTSL.js';
import { HALA } from './geometria.js';
import { ODZG, OZ_X0, OZ_X1 } from './odzgorzanie.js';

const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
/** Znak bez zera (u ≥ 0 → 1, u < 0 → −1). */
const sign1 = (u) => clamp(u.mul(1e6), -1.0, 1.0);

/** Uniformy (od zer — pułapka 46): A = (moc U, ładunek tlenku 0…1, czas linii [s], udział miedzi), B = (T̃ lica przy stacji, 0, 0, 0). */
export function createDescaleUniforms() {
  return { A: uniform(new THREE.Vector4(0, 0, 0, 0)), B: uniform(new THREE.Vector4(0, 0, 0, 0)) };
}

/** Siatka trzech płatów (16 × 6 odcinków każdy — wystarczy na wzór we fragmencie). */
export function createDescaleGeometry() {
  const PY = HALA.passY;
  const O = ODZG;
  const pos = [];
  const q = [];
  const idx = [];
  const NU = 16;
  const NV = 6;
  const patch = (kind, P) => {
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i <= NU; i++) {
        const u = i / NU * 2 - 1;
        const v = j / NV;
        const p = P(u, v);
        pos.push(p[0], p[1], p[2]);
        q.push(u, kind === 2 ? p[0] - O.xf : v, kind, 0);
      }
    }
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i;
        const b = a + 1;
        const c = a + NU + 2;
        const d = a + NU + 1;
        idx.push(a, b, c, a, c, d);
      }
    }
  };
  const ZW = O.sheetZ;
  const T = O.sheetTop;
  const Bt = O.sheetBot;
  patch(0, (u, v) => [O.xf + (T.xTop - O.xf) * v, PY + T.foot + (T.yTop - T.foot) * v, u * ZW]);
  patch(1, (u, v) => [O.xf + (Bt.xTop - O.xf) * v, PY + Bt.foot + (Bt.yTop - Bt.foot) * v, u * ZW]);
  patch(2, (u, v) => [OZ_X0 - 6 + (OZ_X1 + 4 - (OZ_X0 - 6)) * v, PY + 4.75, u * ZW]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aQ', new THREE.BufferAttribute(new Float32Array(q), 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(O.xf, PY, 0), 160);
  return g;
}

/** Materiał warstwy plazmy (`OZ` — uniformy `createDescaleUniforms`). */
export function createDescaleMaterial(OZ) {
  const vQ = varyingProperty('vec4', 'vOzQ');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    vQ.assign(attribute('aQ', 'vec4'));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1.0)));
  })();
  const fragment = Fn(() => {
    const u = F1(vQ.x);
    const v = F1(vQ.y);
    const kind = F1(vQ.z);
    const U = F1(clamp(OZ.A.x, 0.0, 1.2));
    const load = F1(clamp(OZ.A.y, 0.0, 1.5));
    const t = F1(OZ.A.z);
    const isSheet = F1(float(1.0).sub(smoothstep(1.5, 1.6, kind)));
    const isCont = F1(float(1.0).sub(isSheet));
    const au = F1(abs(u));
    // brzegi płata w poprzek (lica emiterów kończą się przy krawędziach taśmy)
    const edgeU = F1(float(1.0).sub(smoothstep(0.88, 1.0, au)));
    // PRZEPŁYW ku ssawom: wzór płynie od osi taśmy ku brzegom (|u| rośnie z czasem) — gaz plazmy z płatkami do odciągu
    const flow = F1(au.mul(5.0).sub(t.mul(2.6)));
    // --- WARSTWA (płaty 0, 1): włókna od emitera do lica (płyną w dół), jaśniej przy licu ---
    const fib = F1(noise3(vec3(u.mul(26.0), v.mul(2.2).add(t.mul(7.0)), t.mul(0.9))));
    const str = F1(smoothstep(0.42, 0.85, fib));
    const footK = F1(exp(v.mul(-3.2)));
    const wave = F1(sin(flow.mul(6.2832)).mul(0.5).add(0.5));
    const Is = F1(U.mul(edgeU).mul(str.mul(0.6).add(0.16)).mul(footK.mul(0.9).add(0.22)).mul(wave.mul(0.35).add(0.65)).mul(0.6));
    const colS = vec3(0.32, 0.78, 1.0).mul(Is).add(vec3(0.62, 0.55, 1.0).mul(Is.mul(Is).mul(0.5)));
    // --- PAS STYKU (płat 2): linia styku plazmy z licem (wąska, jasna — jedyne HDR), za nią poświata gasnąca; przed nią
    // ISKRZENIE dopalającego się tlenku (ciepłe drobiny z ładunku tlenku: znikają, gdy na taśmie nie ma czego zdejmować) ---
    const dx = F1(v);
    const line = F1(exp(dx.div(1.6).mul(dx.div(1.6)).negate()));
    const glowB = F1(exp(max(dx, 0.0).div(-5.0)).mul(smoothstep(-1.0, 1.5, dx)).mul(0.25));
    // (żar dopalającego się tlenku przed linią styku: gładki pas, jaśniejszy tam, gdzie tlenku więcej — wzór płynie ku
    // brzegom z przepływem plazmy; pojedyncze iskry i płatki to cząstki z liczonej masy, `zgorzelina.js`)
    const zone = F1(exp(dx.add(3.5).div(3.2).mul(dx.add(3.5).div(3.2)).negate()));
    const burn = F1(noise3(vec3(u.mul(9.0).sub(sign1(u).mul(t.mul(2.6))), dx.mul(0.3), t.mul(1.7))));
    const spark = F1(zone.mul(load).mul(burn.mul(0.7).add(0.3)).mul(0.55));
    const Ic = F1(U.mul(edgeU).mul(line.mul(0.95).add(glowB)));
    const colC = vec3(0.3, 0.8, 1.0).mul(Ic).add(vec3(0.85, 0.95, 1.0).mul(line.mul(line).mul(U).mul(0.12).mul(edgeU)))
      .add(vec3(1.0, 0.36, 0.06).mul(spark.mul(U)));
    const c = vec3(0.0).toVar();
    c.assign(colS.mul(isSheet).add(colC.mul(isCont)));
    // (bez NaN; najjaśniej ~1,3 w samej linii styku)
    c.assign(min(max(c, vec3(0.0)), vec3(1.4)));
    void fract;
    return vec4(c, max(max(c.x, c.y), c.z));
  })();
  const m = new NodeMaterial();
  m.name = 'OdzgorzaniePlazma';
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
  return m;
}

void mix;
