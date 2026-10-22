// src/3d/reactor3D.tsl.js
//
// Materiały modelu reaktora w TSL (port WebGPU, zadanie 15; docs/webgpu/PLAN.md §3).
// Odpowiednik dawnego GLSL z reactor3D.js: STRUCT_* (konstrukcja oświetlana
// plazmą) i PLASMA_* (plazma w torusie / kula rdzenia Atlasa). Wzory 1:1 z WebGL,
// w tej samej kolejności.
//
// GRAF NA RODZAJ: reactor3D ma 3 rodzaje × 2 meshe (konstrukcja + plazma), każdy
// ze swoimi stałymi (paleta, pierścienie, cewki) — graf budowany raz na rodzaj
// przy createReactor3D (6 materiałów, 6 NodeBuilderów; kod WGSL rodzajów jest
// taki sam, więc moduł i pipeline GPU biorą się z cache). Meshe to zwykłe Mesh
// z InstancedBufferGeometry (bez uuid obiektu w kluczu), instancje czyta shader
// z atrybutów iBasis / iPos / iState / iState2 / iColor / iBreak.
//
// Limit 8 buforów wierzchołków na pipeline (także adapter RTX 5080): atrybuty
// wierzchołka modelu (pozycja, normalna, materiał, cewka, …) idą w jednym
// przeplecionym buforze (reactor3D.js — interleaveGeometry), instancji — osobno.
//
// Pułapki WGSL: pow z ujemną podstawą = NaN (potęgi całkowite mnożeniem),
// uniformy per rodzaj w materiale rodzaju (uniformArray w grafie wspólnym
// pakowałaby się raz na render — wszystkie rodzaje dostałyby dane pierwszego).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, Continue, Discard,
  abs, atan, attribute, cameraProjectionMatrix, clamp, cos, dot, exp, float, floor, fract, int, inverseSqrt, length,
  max, min, mix, mod, modelViewMatrix, normalize, pow, select, sin, smoothstep, step, uniform, uniformArray,
  varying, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { uniformsAdapter } from './tsl/uniformy.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { sunFill, sunVisibility } from './sunShadowMask.js';

// Sektor pokrywy obudowy (reactor3DShapes.js: REACTOR3D_HOUSING_SECTORS = 8, kąt k·π/4 ± π/8).
const SECTOR_RAD = Math.PI / 4;

const PI = 3.14159265;
const TWO_PI = 6.2831853;

// r3Hash / r3Noise — lustro HASH_GLSL (hasz z sin, szum wartości 1D).
const r3Hash = /*@__PURE__*/ Fn(([n]) => fract(sin(n.mul(127.1).add(311.7)).mul(43758.5453)))
  .setLayout({ name: 'r3Hash', type: 'float', inputs: [{ name: 'n', type: 'float' }] });
const r3Noise = /*@__PURE__*/ Fn(([x]) => {
  const i = floor(x).toVar();
  const f = fract(x).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  return mix(r3Hash(i), r3Hash(i.add(1.0)), u);
}).setLayout({ name: 'r3Noise', type: 'float', inputs: [{ name: 'x', type: 'float' }] });

// Ciemna czerwień → pomarańcz → żółć, w paśmie barwy (≤ ~1,2).
const r3HeatColor = /*@__PURE__*/ Fn(([h]) => {
  const c = mix(vec3(0.30, 0.02, 0.0), vec3(1.0, 0.34, 0.05), smoothstep(0.0, 0.65, h));
  return c.mul(h).add(vec3(0.22, 0.18, 0.08).mul(smoothstep(0.75, 1.0, h)));
}).setLayout({ name: 'r3HeatColor', type: 'vec3', inputs: [{ name: 'h', type: 'float' }] });

// Szum wartości 2D (pęknięcia i poszarpany brzeg obudowy). Funkcja z layoutem PŁASKA — hasz wklejony, bez
// wołania r3Hash (pułapka 35: zależności między funkcjami z layoutem zmieniają kolejność kodu WGSL).
const r3Noise2 = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0))).toVar();
  const h = (q) => fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453));
  const a = h(i), b = h(i.add(vec2(1.0, 0.0))), c = h(i.add(vec2(0.0, 1.0))), d = h(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'r3Noise2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// Układ danych instancji: JEDEN przepleciony bufor (InstancedInterleavedBuffer, reactor3D.js) — 8 × vec4.
// Konstrukcja ma 1 bufor wierzchołków modelu + 1 instancji (limit 8 buforów na pipeline).
export const R3_INSTANCE_LAYOUT = Object.freeze({
  iBasis: 0, iPos: 4, iState: 8, iState2: 12, iColor: 16, iBreak: 20, iHouse: 24, iHouse2: 28, stride: 32
});

// Atrybuty instancji (wspólne węzły — każdy materiał buduje je u siebie).
function instanceAttributes() {
  return {
    iBasis: attribute('iBasis', 'vec4'),   // oś x modelu → scena (x, y), oś y modelu → scena (z, w)
    iPos: attribute('iPos', 'vec4'),       // środek WZGLĘDEM mesh.position (x, y), z dachu wnętrza (z modelu 0), z na jednostkę
    iState: attribute('iState', 'vec4'),   // ciało plazmy, biel nici, faza obrotu, niestabilność
    iState2: attribute('iState2', 'vec4'), // żar cewek, pęknięte (0–1), puls (0–1), obecność plazmy
    iColor: attribute('iColor', 'vec4'),   // barwa plazmy (L = 1), ziarno
    iBreak: attribute('iBreak', 'vec4'),   // kierunek rozerwania (x, y modelu), półszerokość łuku, żar wraku (< 0 = żywy)
    iHouse: attribute('iHouse', 'vec4'),   // maska zdjętych sektorów pokrywy (bity 0–8), obudowa (0/1), słońce (x, y modelu, jednostkowe)
    iHouse2: attribute('iHouse2', 'vec4')  // żar brzegu wyrwy, żar pęknięć, długość cienia i obrys obudowy (j. modelu)
  };
}

// Pozycja modelu → scena (instancja względem mesh.position; modelViewMatrix
// w double — renderer.highPrecision). Jak w GLSL: projection · modelView · p.
function instanceClip(I, p) {
  const xy = I.iPos.xy.add(I.iBasis.xy.mul(p.x)).add(I.iBasis.zw.mul(p.y));
  const z = I.iPos.z.add(p.z.mul(I.iPos.w));
  return cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(xy, z, 1.0));
}

// Bit `i` (0–8) maski sektorów (liczba całkowita w float — dokładna do 2^24).
function maskBit(mask, i) {
  return mod(floor(mask.div(pow(2.0, i))), 2.0);
}

/**
 * Konstrukcja reaktora (nieprzezroczysta, zapis głębi, dwustronna): wnętrze oświetlane plazmą, obudowa
 * (materiały ≥ 8) słońcem jak kadłub — człon słońca × sunVisibility(), otoczenie × sunFill.
 * @param {object} v — wartości rodzaju: albedo (Vector3[13]), spec (Vector2[13]),
 *   ring (Vector4[2]), ringCount, coreLight (Vector3), accent (Vector3),
 *   accentL, ambient, lightGain, falloff, houseLight (Vector3: otoczenie, rozproszone, połysk),
 *   houseGlow (Vector4: plazma na obudowie, żar pęknięć, przypalenie brzegu, —).
 */
export function createReactorStructMaterial(v) {
  const U = uniformsAdapter({
    uAlbedo: uniformArray(v.albedo, 'vec3'),
    uSpec: uniformArray(v.spec, 'vec2'),
    uRing: uniformArray(v.ring, 'vec4'),
    uRingCount: uniform(v.ringCount),
    uCoreLight: uniform(v.coreLight),
    uAccent: uniform(v.accent),
    uAccentL: uniform(v.accentL),
    uAmbient: uniform(v.ambient),
    uLightGain: uniform(v.lightGain),
    uFalloff: uniform(v.falloff),
    uHouseLight: uniform(v.houseLight || new THREE.Vector3(0.24, 1.18, 0.3)),
    uHouseGlow: uniform(v.houseGlow || new THREE.Vector4(0.35, 1.0, 0.7, 0)),
    uTime: uniform(0),
    uXray: uniform(0)
  });
  const albedoArr = U.uAlbedo.node;
  const specArr = U.uSpec.node;
  const ringArr = U.uRing.node;
  const I = instanceAttributes();
  const vP = varying(attribute('position', 'vec3'), 'vR3P');
  const vN = varying(attribute('normal', 'vec3'), 'vR3N');
  const vMat = varying(attribute('aMat', 'float'), 'vR3Mat');
  const vCoil = varying(attribute('aCoil', 'float'), 'vR3Coil');
  const vState = varying(I.iState, 'vR3State');
  const vState2 = varying(I.iState2, 'vR3State2');
  const vColor = varying(I.iColor, 'vR3Color');
  const vBreak = varying(I.iBreak, 'vR3Break');
  const vHouse = varying(I.iHouse, 'vR3House');
  const vHouse2 = varying(I.iHouse2, 'vR3House2');

  const fragmentNode = Fn(() => {
    const mat = int(vMat.add(0.5)).toVar();
    const burnt = vBreak.w.toVar();
    const dead = burnt.greaterThanEqual(0.0).toVar();
    const r = length(vP.xy).toVar();
    const edgeGlow = float(0.0).toVar();
    // OBUDOWA: wariant bez obudowy (i prześwietlenie) — znika; zdjęty sektor pokrywy — znika, przy ścianie
    // zostaje poszarpany brzeg płyty. Czapa (sektor 8) znika cała.
    const house = mat.greaterThanEqual(8).toVar();
    const mask = vHouse.x.toVar();
    const torn = float(0.0).toVar();
    If(house, () => {
      If(vHouse.y.lessThan(0.5).or(U.uXray.greaterThan(0.5)), () => {
        Discard();
      });
      If(vCoil.greaterThan(-0.5), () => {
        If(maskBit(mask, floor(vCoil.add(0.5))).greaterThan(0.5), () => {
          const lip = float(0.9).add(r3Noise2(vP.xy.mul(16.0).add(vColor.a.mul(37.0))).mul(0.09));
          If(r.lessThan(lip).or(vCoil.greaterThan(7.5)), () => {
            Discard();
          });
          torn.assign(1.0);
        });
      });
    });
    If(dead.and(vBreak.z.greaterThan(0.0)), () => {
      const a = atan(vP.y, vP.x);
      const ad = atan(vBreak.y, vBreak.x);
      const d = abs(mod(a.sub(ad).add(PI), TWO_PI).sub(PI)).toVar();
      If(d.lessThan(vBreak.z).and(r.greaterThan(0.22)).and(r.lessThan(0.84)), () => {
        Discard();
      });
      edgeGlow.assign(float(1.0).sub(smoothstep(0.0, 0.14, d.sub(vBreak.z))).mul(step(0.22, r)).mul(step(r, 0.86)));
    });
    const N = normalize(vN).toVar();
    const albedo = albedoArr.element(mat).toVar();
    const specK = specArr.element(mat).toVar();
    const presence = vState2.w;
    const pulse = vState2.z;
    const I0 = vState.x.mul(presence).mul(U.uLightGain).mul(pulse.mul(0.2).add(0.8)).toVar();
    const V = vec3(0.0, 0.0, 1.0);
    const diff = float(0.0).toVar();
    const spec = float(0.0).toVar();
    // Pierścienie plazmy jako źródła liniowe (najwyżej 2; pętla GLSL z break).
    for (let i = 0; i < 2; i++) {
      If(float(i).lessThan(U.uRingCount), () => {
        const ring = ringArr.element(i).toVar();
        const a = atan(vP.y.div(ring.w), vP.x.div(ring.z)).toVar();
        const Q = vec3(cos(a).mul(ring.x).mul(ring.z), sin(a).mul(ring.x).mul(ring.w), ring.y);
        const L = Q.sub(vP).toVar();
        const d2 = dot(L, L).toVar();
        L.mulAssign(inverseSqrt(max(d2, 1e-5)));
        const att = float(1.0).div(d2.mul(U.uFalloff).add(1.0)).toVar();
        diff.addAssign(max(0.0, dot(N, L).mul(0.8).add(0.2)).mul(att));
        spec.addAssign(pow(max(0.0, dot(N, normalize(L.add(V)))), specK.x).mul(specK.y).mul(att));
      });
    }
    If(U.uCoreLight.z.greaterThan(0.5), () => {
      const L = vec3(0.0, 0.0, U.uCoreLight.x).sub(vP).toVar();
      const d2 = dot(L, L).toVar();
      L.mulAssign(inverseSqrt(max(d2, 1e-5)));
      const att = U.uCoreLight.y.div(d2.mul(U.uFalloff).mul(2.0).add(1.0)).toVar();
      diff.addAssign(max(0.0, dot(N, L).mul(0.8).add(0.2)).mul(att));
      spec.addAssign(pow(max(0.0, dot(N, normalize(L.add(V)))), specK.x).mul(specK.y).mul(att));
    });
    const pc = vColor.rgb.toVar();
    const col = albedo.mul(pc.mul(diff).mul(I0).add(U.uAmbient)).add(pc.mul(spec).mul(I0).mul(0.6)).toVar();
    If(mat.equal(2), () => {
      const broken = step(r3Hash(vCoil.add(vColor.a.mul(17.0))), vState2.y).toVar();
      col.mulAssign(mix(1.0, 0.35, broken));
      col.addAssign(r3HeatColor(clamp(vState2.x.add(broken.mul(0.25)), 0.0, 1.0)).mul(pulse.mul(0.35).add(0.65)).mul(presence));
      const sparkT = floor(U.uTime.mul(24.0)).add(vCoil.mul(7.0)).add(vColor.a.mul(3.0));
      col.addAssign(vec3(1.0, 0.6, 0.25).mul(broken.mul(step(0.93, r3Hash(sparkT))).mul(0.8).mul(presence)));
    });
    If(mat.equal(7), () => {
      const acc = select(U.uAccent.x.add(U.uAccent.y).add(U.uAccent.z).greaterThan(0.0), U.uAccent, pc);
      col.assign(albedo.mul(0.2).add(acc.mul(U.uAccentL).mul(select(dead, float(0.0), float(1.0)))));
    });
    If(house, () => {
      // Słońce jak na kadłubie (kierunek w układzie modelu z instancji, lekko z góry): otoczenie × sunFill,
      // rozproszone i połysk × sunVisibility; plazma prześwituje przez kratę na brzegi prętów i płyt.
      const Ls = normalize(vec3(vHouse.z, vHouse.w, 0.18)).toVar();
      const sunVis = sunVisibility().toVar();
      const amb = U.uHouseLight.x.mul(sunFill(sunVis)).mul(max(N.z, 0.0).mul(0.45).add(0.55));
      const dif = max(0.0, dot(N, Ls)).mul(U.uHouseLight.y).mul(sunVis);
      const sp = pow(max(dot(N, normalize(Ls.add(V))), 0.0), specK.x).mul(specK.y).mul(U.uHouseLight.z).mul(sunVis);
      const hc = albedo.mul(amb.add(dif)).add(vec3(sp)).toVar();
      hc.addAssign(albedo.mul(pc).mul(diff).mul(I0).mul(U.uHouseGlow.x));
      // pod progiem bloomu (miękkie kolano jak bryła mostka): świeci tylko wskaźnik, żar i plazma
      const lum = dot(hc, vec3(0.2126, 0.7152, 0.0722)).toVar();
      If(lum.greaterThan(0.62), () => {
        hc.mulAssign(float(0.62).add(float(0.24).mul(float(1.0).sub(exp(lum.sub(0.62).div(0.24).negate())))).div(lum));
      });
      // Przypalony brzeg przy zdjętym sektorze (sąsiednim albo tym, nad którym stoi ściana) i żar brzegu wyrwy.
      const sf = atan(vP.y, vP.x).div(SECTOR_RAD).toVar();
      const si = floor(sf.add(0.5)).toVar();
      const fr = sf.sub(si).toVar();
      const here = maskBit(mask, mod(si.add(8.0), 8.0));
      const next = maskBit(mask, mod(si.add(select(fr.greaterThanEqual(0.0), float(1.0), float(-1.0))).add(8.0), 8.0));
      const edge = float(0.5).sub(abs(fr));
      const wall = step(vCoil, -0.5);
      const scorch = max(max(here.mul(wall).mul(step(r, 1.03)), torn), next.mul(float(1.0).sub(smoothstep(0.0, 0.22, edge)))).toVar();
      hc.mulAssign(float(1.0).sub(scorch.mul(U.uHouseGlow.z)));
      hc.addAssign(r3HeatColor(vHouse2.x).mul(scorch.mul(scorch)).mul(0.5).mul(presence));
      // Pęknięcia (KRYTYCZNY, STOPIENIE): żarzące się szczeliny w pancerzu, krata grzeje się cała.
      const heat = vHouse2.y.toVar();
      If(heat.greaterThan(0.01), () => {
        const n = r3Noise2(vP.xy.mul(7.0).add(vColor.a.mul(13.0)));
        const ridge = float(1.0).sub(smoothstep(0.0, 0.035, abs(n.sub(0.5)))).mul(select(mat.equal(8), float(1.0), float(0.0)));
        const grill = select(mat.equal(10), float(0.6), float(0.0));
        const hk = clamp(heat.mul(1.1).add(0.1), 0.0, 1.0);
        hc.addAssign(r3HeatColor(hk).mul(max(ridge, grill.mul(heat))).mul(smoothstep(0.05, 0.2, heat))
          .mul(pulse.mul(0.4).add(0.6)).mul(U.uHouseGlow.y).mul(presence));
      });
      // wskaźnik na czapie / listwy: barwa akcentu rodzaju albo plazmy (pod progiem bloomu)
      If(mat.equal(12), () => {
        const acc = select(U.uAccent.x.add(U.uAccent.y).add(U.uAccent.z).greaterThan(0.0), U.uAccent, pc);
        hc.assign(albedo.mul(0.2).add(acc.mul(U.uAccentL).mul(select(dead, float(0.0), float(1.0)))));
      });
      col.assign(hc);
    });
    If(dead, () => {
      col.mulAssign(0.55);
      col.addAssign(r3HeatColor(burnt).mul(select(mat.equal(2), float(0.9), float(0.35))));
      col.addAssign(vec3(1.0, 0.45, 0.12).mul(edgeGlow.mul(burnt.mul(0.9).add(0.25))));
    });
    If(U.uXray.greaterThan(0.5), () => {
      col.assign(col.mul(0.85).add(vec3(0.03, 0.05, 0.07)));
    });
    return vec4(col, 1.0);
  })();

  const material = new THREE.NodeMaterial();
  material.name = 'reactor3D:structure';
  material.uniforms = U;
  material.lights = false;
  material.fog = false;
  material.side = THREE.DoubleSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.vertexNode = instanceClip(I, attribute('position', 'vec3'));
  material.fragmentNode = fragmentNode;
  return material;
}

/**
 * Plazma (addytywna ONE/ONE, test głębi bez zapisu, dwustronna — stronę wybiera
 * normalna modelu, nie nawinięcie).
 * @param {object} v — coilAng (number[MAX_COILS]), coilCode (number[MAX_COILS]),
 *   coilCount, ringDir ([3]), streaks, filament, packet, flicker, coreEdge, maxCoils.
 */
export function createReactorPlasmaMaterial(v) {
  const U = uniformsAdapter({
    uCoilAng: uniformArray(v.coilAng, 'float'),
    uCoilCode: uniformArray(v.coilCode, 'float'),
    uCoilCount: uniform(v.coilCount),
    uRingDir: uniformArray(v.ringDir, 'float'),
    uStreaks: uniform(v.streaks),
    uFilament: uniform(v.filament),
    uPacket: uniform(v.packet),
    uFlicker: uniform(v.flicker),
    uTime: uniform(0)
  });
  const coilAng = U.uCoilAng.node;
  const coilCode = U.uCoilCode.node;
  const ringDirArr = U.uRingDir.node;
  const maxCoils = v.maxCoils;
  const coreEdge = v.coreEdge;
  const I = instanceAttributes();
  const aCenter = attribute('aCenter', 'vec3');
  const aTube = attribute('aTube', 'float');
  const aRing = attribute('aRing', 'float');
  const aUV = attribute('aUV', 'vec2');
  const nrm = attribute('normal', 'vec3');
  const vUV = varying(aUV, 'vR3UV');
  const vRing = varying(aRing, 'vR3Ring');
  const vFace = varying(nrm.z, 'vR3Face');
  const vState = varying(I.iState, 'vR3PState');
  const vState2 = varying(I.iState2, 'vR3PState2');
  const vColor = varying(I.iColor, 'vR3PColor');
  const vLeak = varyingProperty('float', 'vR3Leak');

  const vertexNode = Fn(() => {
    const ang = aUV.x.mul(TWO_PI).toVar();
    const leak = float(0.0).toVar();
    If(aRing.lessThan(1.5), () => {
      Loop(maxCoils, ({ i }) => {
        If(i.greaterThanEqual(int(U.uCoilCount)), () => {
          Break();
        });
        const code = coilCode.element(i).toVar();
        If(abs(mod(code, 10.0).sub(aRing)).greaterThan(0.5), () => {
          Continue();
        });
        const broken = code.greaterThanEqual(9.5).or(r3Hash(float(i).add(I.iColor.a.mul(17.0))).lessThan(I.iState2.y));
        If(broken.not(), () => {
          Continue();
        });
        const d = abs(mod(ang.sub(coilAng.element(i)).add(PI), TWO_PI).sub(PI)).toVar();
        leak.addAssign(exp(d.mul(d).negate().div(0.018)));
      });
    });
    const inst = I.iState.w;
    const wob = r3Noise(aUV.x.mul(14.0).add(U.uTime.mul(2.3)).add(aRing.mul(5.0)).add(I.iColor.a.mul(9.0))).sub(0.5).mul(inst);
    const tube = aTube.mul(float(1.0).add(wob.mul(0.8)).add(min(leak, 1.5).mul(0.7).mul(I.iState2.z.mul(0.4).add(0.6))));
    const p = aCenter.add(nrm.mul(tube)).toVar();
    vLeak.assign(min(leak, 1.0));
    return instanceClip(I, p);
  })();

  const fragmentNode = Fn(() => {
    const presence = vState2.w.toVar();
    If(presence.lessThanEqual(0.001), () => {
      Discard();
    });
    // Tylko górna połowa rury (ku kamerze, +z modelu). Baza instancji odbija
    // oś y (scena ma odwrócone y), więc kolejność wierzchołków się odwraca —
    // materiał jest dwustronny, a stronę wybiera normalna modelu, nie nawinięcie.
    If(vFace.lessThan(-0.02), () => {
      Discard();
    });
    const ri = int(vRing.add(0.5)).toVar();
    const dir = select(ri.equal(0), ringDirArr.element(0), select(ri.equal(1), ringDirArr.element(1), ringDirArr.element(2))).toVar();
    const u = vUV.x.toVar();
    const phase = vState.z;
    const inst = vState.w;
    const pulse = vState2.z;
    const face = clamp(vFace, 0.0, 1.0);
    const fl = float(1.0).sub(U.uFlicker.mul(step(0.86, r3Hash(floor(U.uTime.mul(18.0)).add(vColor.a.mul(31.0)))))).toVar();
    // pasma plazmy krążące w pierścieniu (u kuli — falowanie powierzchni)
    const s1 = sin(u.mul(U.uStreaks).sub(phase.mul(dir)).mul(TWO_PI)).mul(0.5).add(0.5).toVar();
    const s2 = sin(u.mul(U.uStreaks.mul(2.0).add(1.0)).sub(phase.mul(dir).mul(1.7)).mul(TWO_PI).add(1.3)).mul(0.5).add(0.5).toVar();
    // s1, s2 ∈ [0, 1] — potęgi całkowite mnożeniem (jak GLSL pow z podstawą ≥ 0).
    const s1c = s1.mul(s1).mul(s1);
    const s2q = s2.mul(s2).mul(s2).mul(s2);
    const flow = select(ri.equal(2), sin(U.uTime.mul(9.0).add(vUV.y.mul(12.0))).mul(0.3).add(0.7), s1c.mul(0.7).add(s2q.mul(0.3))).toVar();
    // ciało w paśmie barwy (pod progiem bloomu)
    const body = vState.x.mul(presence).mul(fl).mul(flow.mul(0.55).add(0.45)).mul(face.mul(0.45).add(0.55)).mul(pulse.mul(0.15).add(0.85)).toVar();
    body.mulAssign(vLeak.mul(0.35).add(1.0));
    // BIEL (8–12, ostro): tylko w pakietach plazmy na szczycie rury — linia z
    // parametru v (góra rury: v = 0,25; kuli: v = 1), pakiet z fazy pasma.
    // Ciągła nić przez cały obwód zalewała model bloomem.
    const dv = select(ri.equal(2), float(1.0).sub(vUV.y), abs(vUV.y.sub(0.25)));
    const wv = U.uFilament.mul(inst.mul(0.6).add(1.0)).mul(select(ri.equal(2), float(5.0), float(1.0))).toVar();
    const line = float(1.0).sub(smoothstep(wv.mul(coreEdge), wv, dv));
    // w stopieniu pakietów przybywa, ale wolno — pełna biel na pierścieniu
    // z bloomem zakrywała cały model
    const pw = U.uPacket.mul(float(1.0).sub(inst.mul(0.12))).toVar();
    const packet = select(ri.equal(2), float(1.0), smoothstep(pw, pw.add(0.035), s1));
    const white = line.mul(packet).mul(vState.y).mul(presence).mul(fl);
    const col = vColor.rgb.mul(body).add(vec3(1.0, 0.97, 0.93).mul(white)).toVar();
    return vec4(col, min(1.0, max(col.x, max(col.y, col.z))));
  })();

  const material = new THREE.NodeMaterial();
  material.name = 'reactor3D:plasma';
  material.uniforms = U;
  material.lights = false;
  material.fog = false;
  // Kolor i alfa ONE/ONE jak blend bloomu w three (dawne AdditiveBlending +
  // premultipliedAlpha). Bez premultipliedAlpha: NodeMaterial mnożyłby rgb przez
  // alfę w shaderze (ShaderMaterial w WebGL tego nie robił) — tsl/mieszanie.js.
  blendAddytywnePremul(material);
  material.side = THREE.DoubleSide;
  // Przezroczysty DoubleSide WebGPU rysowałby dwa razy — WebGL (ShaderMaterial) raz.
  material.forceSinglePass = true;
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  return material;
}

/**
 * Cień obudowy na kadłubie (wzór: cień mostka — bridge3D.tsl.js): czworokąt POD kadłubem (z = receiverZ),
 * test głębi GREATER — przechodzi tylko tam, gdzie kadłub (albo coś nad nim) zapisał głębię, więc cień jest
 * przycięty do sylwetki i nie wpada w wyrwy. Cień = obrys obudowy (koło o promieniu obrysu) przesunięty od
 * słońca o długość cienia (wysokość / tan wysokości „słońca cieni”), półcień rośnie z odległością; u stóp
 * obudowy kontaktowe przyciemnienie. Wewnątrz obrysu nic (obudowa nie przyciemnia sama siebie). Jeden graf
 * na wszystkie rodzaje — obrys i długość cienia w danych instancji.
 * @param {object} v — receiverZ (z świata pod kadłubem), strength (przyciemnienie w pełnym cieniu), ao.
 */
export function createReactorShadowMaterial(v) {
  const U = uniformsAdapter({
    uShadow: uniform(new THREE.Vector3(v.strength ?? 0.45, v.ao ?? 0.3, 0))
  });
  const I = instanceAttributes();
  const outer = I.iHouse2.w;
  const len = I.iHouse2.z;
  const sun = I.iHouse.zw;
  const dir = sun.negate().div(max(length(sun), 1e-4));
  const pad = outer.mul(0.2).add(0.05);
  const off = dir.mul(len);
  const lo = min(vec2(outer.negate()), vec2(outer.negate()).add(off)).sub(vec2(pad));
  const hi = max(vec2(outer), vec2(outer).add(off)).add(vec2(pad));
  const g = attribute('position', 'vec3');
  const m = mix(lo, hi, g.xy.add(0.5));
  const vPos2 = varying(m, 'vR3RecvP');
  const vDir = varying(dir, 'vR3RecvDir').setInterpolation('flat');
  const vRecv = varying(vec4(outer, len, I.iHouse.y, 0.0), 'vR3Recv').setInterpolation('flat');
  const xy = I.iPos.xy.add(I.iBasis.xy.mul(m.x)).add(I.iBasis.zw.mul(m.y));
  const vertexNode = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(xy, float(v.receiverZ), 1.0));

  const fragmentNode = Fn(() => {
    const F = vRecv.x;
    const L = vRecv.y;
    const p = vPos2.toVar();
    const r = length(p).toVar();
    // obrys obudowy (ośmiokąt kołnierza — boki na osiach i przekątnych; koło Atlasa mieści się w nim)
    const oct = max(max(abs(p.x), abs(p.y)), abs(p.x).add(abs(p.y)).mul(0.70710678));
    If(oct.lessThan(F).or(vRecv.z.lessThan(0.5)), () => {
      Discard();
    });
    const t = clamp(dot(p, vDir), 0.0, L).toVar();
    const d = length(p.sub(vDir.mul(t)));
    const soft = F.mul(float(0.03).add(t.div(max(L, 1e-3)).mul(0.12))).add(0.01);
    const sh = float(1.0).sub(smoothstep(F.mul(1.02).sub(soft), F.mul(1.02).add(soft), d));
    const ao = float(1.0).sub(smoothstep(F, F.mul(1.14), r)).mul(U.uShadow.y);
    // bez słońca (cień planety — maska Core3D) obudowa nie rzuca cienia, kontaktowe przyciemnienie zostaje
    const dark = min(sh.mul(U.uShadow.x).mul(sunVisibility()).add(ao), 0.8).toVar();
    If(dark.lessThan(0.003), () => {
      Discard();
    });
    return vec4(0.0, 0.0, 0.0, dark);
  })();

  const material = new THREE.NodeMaterial();
  material.name = 'reactor3D:shadow';
  material.uniforms = U;
  material.lights = false;
  material.fog = false;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.depthFunc = THREE.GreaterDepth;
  material.blending = THREE.NormalBlending;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  return material;
}

// Lustra CPU (testy): hasz i barwa żaru jak w shaderze.
export function r3HashCpu(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export const REACTOR3D_TSL_INTERNALS = Object.freeze({ r3Hash, r3Noise, r3HeatColor });
