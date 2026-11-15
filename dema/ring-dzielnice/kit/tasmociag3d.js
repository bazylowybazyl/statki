// ZESTAW — TAŚMOCIĄG: obraz (TSL). Bryła taśmociągu idąca po torze z `kit/tasmociag.js` — także po łuku i po pochylni.
//
// Jedna siatka (jeden rysunek) na taśmociąg:
//   • nitka górna (niecka: środek płaski, brzegi uniesione) z JODEŁKĄ żeber jadącą z prędkością taśmy — ruch widać
//     także na pustej taśmie; nitka dolna (powrotna) ze szwami jadącymi wstecz; bębny na obu końcach;
//   • krążniki pod nitką górną co `idlerPitch`, podłużnice ramy, burty na słupkach (między ramą a burtą widać krążniki
//     i brzeg taśmy).
// GRAF WĘZŁÓW powstaje RAZ na moduł (`conveyorGraph`), każdy taśmociąg dostaje lekki materiał na wspólnych węzłach
// i wartości w `material.uniforms` (droga taśmy, światło) czytane przez `uniform().onObjectUpdate` — kolejny taśmociąg
// nie buduje nowego programu. Rozgrzewka: siatka idzie do `Core3D.warmup` razem z resztą sceny (zwykły `Mesh`).
// Normalna z pochodnych pozycji widoku (ściany płaskie) — bryłę wolno ścisnąć w pionie (`mapY`, np. `k7HeightToZ`).
// Jasność: guma ~0,04–0,11, farba ~0,5 × światło — pod progiem bloomu.
//
// Atrybut `aS` = (droga po taśmie s, bok w j., rodzaj): 0 nitka górna, 1 nitka dolna i bębny, 2 stal malowana (rama,
// burty), 3 stal goła (krążniki, słupki).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, cross, dFdx, dFdy, dot, float, fract, length, max, mix,
  modelViewMatrix, normalize, sign, smoothstep, step, uniform, varyingProperty, vec3, vec4
} from 'three/tsl';
import { CONVEYOR_FRAME, conveyorSection } from './tasmociag.js';

export { conveyorSection };

/** Okres wzoru taśmy [j.]: jodełka co 36 j., szew nitki dolnej co 108 j. — droga taśmy idzie do shadera modulo OKRES. */
export const CONVEYOR_PATTERN = 36;
const PERIOD = CONVEYOR_PATTERN * 120;

const perBelt = (key, init, type) => uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);

let graph = null;
/** Graf węzłów taśmociągu — jeden na moduł (klucz programu = id węzłów). */
function conveyorGraph() {
  if (graph) return graph;
  // wektory od zer (pułapka 46 reguły `webgpu-tsl`): wartości przychodzą z `material.uniforms` przy rysunku
  const uTravel = perBelt('travel', new THREE.Vector4(0, 0, 0, 0), 'vec4');       // x — droga taśmy modulo okres
  const uSunDir = perBelt('sunDir', new THREE.Vector3(0, 0, 0), 'vec3');
  const uSunColor = perBelt('sunColor', new THREE.Vector3(0, 0, 0), 'vec3');
  const uAmbient = perBelt('ambient', new THREE.Vector3(0, 0, 0), 'vec3');
  const uLight = perBelt('light', new THREE.Vector4(0, 0, 0, 0), 'vec4');         // mnożniki: słońce, niebo
  const vP = varyingProperty('vec3', 'vTsmP');
  const vS = varyingProperty('vec3', 'vTsmS');
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    const mv = vec4(0.0).toVar();
    mv.assign(modelViewMatrix.mul(vec4(p, 1.0)));
    vP.assign(mv.xyz);
    vS.assign(attribute('aS', 'vec3'));
    return cameraProjectionMatrix.mul(mv);
  })();
  const fragment = Fn(() => {
    // pochodne przed wszystkim innym (pułapki 15 / 29)
    const dx = vec3(0.0).toVar();
    dx.assign(dFdx(vP));
    const dy = vec3(0.0).toVar();
    dy.assign(dFdy(vP));
    const fw = float(0.0).toVar();
    fw.assign(max(abs(dFdx(vS.x)), abs(dFdy(vS.x))).add(max(abs(dFdx(vS.y)), abs(dFdy(vS.y))).mul(0.55)));
    const V = vec3(0.0).toVar();
    V.assign(normalize(vP.negate()));
    const cr = vec3(0.0).toVar();
    cr.assign(cross(dx, dy));
    const N0 = vec3(0.0).toVar();
    N0.assign(cr.div(max(length(cr), 1e-9)));
    const N = vec3(0.0).toVar();
    N.assign(N0.mul(sign(dot(N0, V).add(1e-5))));
    const L = vec3(0.0).toVar();
    L.assign(normalize(cameraViewMatrix.mul(vec4(uSunDir, 0.0)).xyz));
    const ndl = float(0.0).toVar();
    ndl.assign(max(dot(N, L), 0.0));
    // rodzaj powierzchni: maski 0 / 1 (bez zagnieżdżonych wyborów — pułapka 39)
    const kind = float(0.0).toVar();
    kind.assign(vS.z);
    const isTop = float(0.0).toVar();
    isTop.assign(float(1.0).sub(step(0.5, kind)));
    const isRet = float(0.0).toVar();
    isRet.assign(step(0.5, kind).mul(float(1.0).sub(step(1.5, kind))));
    const isPaint = float(0.0).toVar();
    isPaint.assign(step(1.5, kind).mul(float(1.0).sub(step(2.5, kind))));
    const isSteel = float(0.0).toVar();
    isSteel.assign(step(2.5, kind));
    // nitka górna: jodełka żeber co 36 j. (ostrze ku kierunkowi jazdy), żebro 5 j.; jedzie z taśmą
    const al = float(0.0).toVar();
    al.assign(abs(vS.y));
    const ph = float(0.0).toVar();
    ph.assign(fract(vS.x.sub(uTravel.x).add(al.mul(0.55)).div(CONVEYOR_PATTERN)).mul(CONVEYOR_PATTERN));
    const rib = float(0.0).toVar();
    rib.assign(float(1.0).sub(smoothstep(2.5, fw.mul(1.5).add(3.2), abs(ph.sub(CONVEYOR_PATTERN / 2)))));
    // żebra kończą się przed brzegiem (gładki pas boczny), środek taśmy lekko wytarty
    const ribZone = float(0.0).toVar();
    ribZone.assign(float(1.0).sub(smoothstep(21.0, 23.5, al)));
    const wear = float(0.0).toVar();
    wear.assign(float(1.0).sub(smoothstep(6.0, 20.0, al)));
    const colTop = vec3(0.0).toVar();
    colTop.assign(mix(vec3(0.034, 0.036, 0.041), vec3(0.052, 0.05, 0.05), wear.mul(0.6)));
    colTop.assign(mix(colTop, vec3(0.118, 0.122, 0.132), rib.mul(ribZone)));
    // nitka dolna i bębny: gładka guma, jasny szew co 108 j. jedzie wstecz
    const ph2 = float(0.0).toVar();
    ph2.assign(fract(vS.x.add(uTravel.x).div(CONVEYOR_PATTERN * 3)).mul(CONVEYOR_PATTERN * 3));
    const seam = float(0.0).toVar();
    seam.assign(float(1.0).sub(smoothstep(1.2, fw.mul(1.5).add(1.8), abs(ph2.sub(CONVEYOR_PATTERN * 1.5)))));
    const colRet = vec3(0.0).toVar();
    colRet.assign(mix(vec3(0.03, 0.031, 0.035), vec3(0.1, 0.1, 0.105), seam));
    const col = vec3(0.0).toVar();
    col.assign(colTop.mul(isTop).add(colRet.mul(isRet)).add(vec3(0.5, 0.33, 0.05).mul(isPaint)).add(vec3(0.2, 0.21, 0.23).mul(isSteel)));
    const lightv = vec3(0.0).toVar();
    lightv.assign(uSunColor.mul(ndl).mul(uLight.x).mul(0.8).add(uAmbient.mul(uLight.y)));
    return vec4(max(col.mul(lightv), vec3(0.0)), 1.0);
  })();
  graph = { vertex, fragment };
  return graph;
}

/**
 * @param {object} o
 * @param {ReturnType<import('./tasmociag.js').createConveyorTrack>} o.track
 * @param {object} o.light       { sunDir, sunColor, ambient, light } — obiekty z polem `.value` (np. węzły `uniform()`
 *                               sceny): kierunek ku słońcu (świat), barwa słońca, niebo, mnożniki (x słońce, y niebo)
 * @param {(y: number) => number} [o.mapY]   przeliczenie wysokości na oś pionową rysunku
 * @param {number} [o.step]        krok bryły po długości [j.]
 * @param {number} [o.idlerPitch]  rozstaw krążników i słupków burt [j.]
 * @param {string} [o.name]
 * @returns {{ mesh: THREE.Mesh, material: NodeMaterial, uniforms: object, setTravel(d: number): void, triangles: number }}
 */
export function createConveyor3D({ track, light, mapY = (y) => y, step = 6, idlerPitch = 30, name = 'Tasmociag' }) {
  const X = conveyorSection(track.width / 2);
  const F = new Float64Array(CONVEYOR_FRAME);
  const P = [];
  const S = [];
  const I = [];
  let nv = 0;
  const vert = (s, lat, h, kind, along = 0) => {
    P.push(F[0] + F[3] * along + F[6] * lat + F[9] * h, mapY(F[1] + F[4] * along + F[10] * h), F[2] + F[5] * along + F[8] * lat + F[11] * h);
    S.push(s + along, lat, kind);
    return nv++;
  };
  const rows = Math.max(2, Math.ceil(track.length / step));
  /** Wstęga wzdłuż całego toru po łamanej przekroju `prof` = [[bok, wysokość], …]. */
  const ribbon = (prof, kind) => {
    const base = nv;
    const m = prof.length;
    for (let r = 0; r <= rows; r++) {
      const s = track.length * r / rows;
      track.frame(s, F);
      for (let q = 0; q < m; q++) vert(s, prof[q][0], prof[q][1], kind);
    }
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < m - 1; q++) {
        const a = base + r * m + q;
        I.push(a, a + m, a + 1, a + 1, a + m, a + m + 1);
      }
    }
  };
  /** Pudło w ramce toru: środek (s, bok, wysokość), połówki (wzdłuż, w poprzek, w pionie). */
  const box = (s, lat, h, ha, hl, hh, kind) => {
    track.frame(s, F);
    const b = nv;
    for (let k = 0; k < 8; k++) vert(s, lat + (k & 1 ? hl : -hl), h + (k & 2 ? hh : -hh), kind, k & 4 ? ha : -ha);
    for (const [a, c, d, e] of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) I.push(b + a, b + c, b + d, b + a, b + d, b + e);
  };
  // nitka górna (niecka) i dolna
  ribbon([[-X.edge, X.lip], [-X.flat, 0], [X.flat, 0], [X.edge, X.lip]], 0);
  ribbon([[-X.returnHalf, X.returnY], [X.returnHalf, X.returnY]], 1);
  // podłużnice ramy i burty (lewa, prawa)
  for (const sd of [-1, 1]) {
    ribbon([[sd * X.frame0, X.frameBottom], [sd * X.frame0, X.frameTop], [sd * X.frame1, X.frameTop], [sd * X.frame1, X.frameBottom], [sd * X.frame0, X.frameBottom]], 2);
    ribbon([[sd * X.skirt0, X.skirtBottom], [sd * X.skirt0, X.skirtTop], [sd * X.skirt1, X.skirtTop], [sd * X.skirt1, X.skirtBottom], [sd * X.skirt0, X.skirtBottom]], 2);
  }
  // krążniki pod nitką górną i słupki burt (na podłużnicy), co `idlerPitch`
  const ni = Math.max(1, Math.round(track.length / idlerPitch));
  for (let k = 0; k <= ni; k++) {
    const s = Math.min(track.length - X.idlerLength / 2, Math.max(X.idlerLength / 2, track.length * k / ni));
    box(s, 0, (X.idlerTop + X.idlerBottom) / 2, X.idlerLength / 2, X.idlerHalf, (X.idlerTop - X.idlerBottom) / 2, 3);
    for (const sd of [-1, 1]) box(s, sd * (X.skirt0 + X.skirt1) / 2, (X.frameTop + X.skirtBottom) / 2, X.postHalf, X.postHalf, (X.skirtBottom - X.frameTop) / 2, 3);
  }
  // bębny na końcach: półwalec łączący nitkę górną z dolną (na zewnątrz toru)
  const R = -X.returnY / 2;
  for (const end of [0, 1]) {
    const s = end ? track.length : 0;
    const dir = end ? 1 : -1;
    track.frame(s, F);
    const base = nv;
    const SEG = 8;
    for (let k = 0; k <= SEG; k++) {
      const a = Math.PI * k / SEG;
      for (const sd of [-1, 1]) vert(s, sd * X.returnHalf, -R + Math.cos(a) * R, 1, dir * Math.sin(a) * R);
    }
    for (let k = 0; k < SEG; k++) { const a = base + k * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(S), 3));
  g.setIndex(nv > 65535 ? new THREE.BufferAttribute(new Uint32Array(I), 1) : new THREE.BufferAttribute(new Uint16Array(I), 1));
  g.computeBoundingSphere();

  const G = conveyorGraph();
  const material = new NodeMaterial();
  material.name = 'Tasmociag';
  material.vertexNode = G.vertex;
  material.fragmentNode = G.fragment;
  material.side = THREE.DoubleSide;
  material.fog = false;
  material.lights = false;
  material.toneMapped = false;
  const uniforms = {
    travel: { value: new THREE.Vector4(0, 0, 0, 0) },
    sunDir: light.sunDir, sunColor: light.sunColor, ambient: light.ambient, light: light.light
  };
  material.uniforms = uniforms;
  const mesh = new THREE.Mesh(g, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  return {
    mesh, material, uniforms, section: X, triangles: I.length / 3,
    /** Droga taśmy [j.] (rośnie z jazdą) — wzór przesuwa się o tyle samo co ładunek. */
    setTravel(d) { uniforms.travel.value.x = d - Math.floor(d / PERIOD) * PERIOD; }
  };
}
