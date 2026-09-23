// Ruch statków (M5): instancje animowane w wierzchołku z czasu — zero pracy
// CPU na klatkę. Dwa rodzaje pasów:
//  - ruch wokół ringu na zewnątrz krawędzi habitatu (frachtowce, promy,
//    kilka dużych transportowców), oba kierunki, lekkie falowanie toru;
//  - okręty liniowe w portach: podejście z przestrzeni po łuku do zatoki doku,
//    postój, odlot (cykl z przesunięciem fazy na każdy dok). Doki wpięte
//    w podłogę na środku wstęgi (2026-09-23): stanowisko w płaszczyźnie gry.
// Dysze świecą białym rdzeniem w paśmie 8–12 (brief §9), kadłub oświetlony
// analitycznie jak reszta ringu. 1 draw call.
import * as THREE from 'three';
import {
  HALO_GLSL_AIR,
  HALO_GLSL_COMMON,
  HALO_GLSL_LIGHT,
  HALO_GLSL_NOISE,
  HALO_GLSL_RTE
} from './haloRingGLSL.js';
import { HALO_HDR, HALO_PORT } from './haloRingConfig.js';
import { haloHashI } from './haloRingRoofPlan.js';

const STRIDE = 8;
const f3 = (a) => a.map((x) => x.toFixed(3)).join(', ');

const SHIP_VERTEX = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_RTE}
attribute float aPart;         // 0 kadlub, 1 dysza (tyl), 2 mostek, 3 dziob
attribute vec4 iA;             // rodzaj (0 wokol ringu, 1 dok), s0 | kat doku, predkosc | okres, promien od krawedzi | faza
attribute vec4 iB;             // z, dlugosc, wariant barwy, falowanie
uniform vec4 uTraffic;         // krawedz scian (rim), sigma, obwod L, kat stacji
uniform vec4 uTrafficDock;     // podloga doku (r), glebokosc zatoki, stanowisko: y od podlogi, z
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vPart;
varying float vVar;
varying float vThrust;

void main() {
  float rim = uTraffic.x;
  float L = uTraffic.z;
  float len = iB.y;
  vec3 pos;      // w ukladzie (s wzgledem odniesienia, r, z)
  vec3 fwdL;     // kierunek lotu w bazie (wzdluz, promien, z)
  float thrust = 1.0;
  float sRel;
  float r;
  float z;
  if (iA.x < 0.5) {
    float dir = sign(iA.z);
    float sAbs = iA.y + mod(iA.z * uTime, L);
    sRel = mod(sAbs - uRefBasis.w + 0.5 * L, L) - 0.5 * L;
    float wob = sin(uTime * 0.05 * (1.0 + iB.w) + iA.w * 6.2831);
    r = rim + iA.w * 0.0 + (800.0 + 2600.0 * fract(iA.w * 7.13)) + wob * 160.0 * iB.w;
    z = iB.x + cos(uTime * 0.04 + iA.w * 4.0) * 90.0 * iB.w;
    fwdL = vec3(dir, 0.0, 0.0);
  } else {
    // dok: podejscie po krzywej Beziera w ukladzie doku (x wzdluz, y od krawedzi, z)
    float th0 = iA.y;
    float period = iA.z;
    float u = fract(uTime / period + iA.w);
    float side = fract(iA.w * 3.7) > 0.5 ? 1.0 : -1.0;
    // okret stoi w zatoce wzdluz ringu (zatoka 3200 x 1300 j. miesci Atlasa
    // dlugoscia wzdluz); podchodzi dziobem naprzod, przy doku obraca sie
    // rownolegle do sciany tylnej i wsuwa bokiem (jak strafe Q/E w grze)
    vec3 P0 = vec3(side * 2500.0, uTrafficDock.y + 5500.0, -900.0);
    vec3 Pc = vec3(side * 400.0, uTrafficDock.y + 1500.0, uTrafficDock.w - 180.0);
    vec3 P2 = vec3(0.0, uTrafficDock.z, uTrafficDock.w);
    float tau;
    float leaving = 0.0;
    if (u < 0.42) { tau = smoothstep(0.0, 0.42, u); thrust = 1.0 - 0.8 * tau; }
    else if (u < 0.62) { tau = 1.0; thrust = 0.0; }
    else { tau = 1.0 - smoothstep(0.62, 1.0, u); leaving = 1.0; thrust = 1.0; P0.x = -P0.x; Pc.x = -Pc.x; }
    vec3 B = (1.0 - tau) * (1.0 - tau) * P0 + 2.0 * (1.0 - tau) * tau * Pc + tau * tau * P2;
    vec3 dB = 2.0 * (1.0 - tau) * (Pc - P0) + 2.0 * tau * (P2 - Pc);
    if (length(dB) < 1e-3) dB = vec3(0.0, -1.0, 0.0);
    vec3 tangent = normalize(dB) * (leaving > 0.5 ? -1.0 : 1.0);
    vec3 berth = vec3(-side, 0.0, 0.0);
    fwdL = normalize(mix(tangent, berth, smoothstep(0.45, 0.9, tau)));
    float rr = uTrafficDock.x + B.y;
    r = sqrt(rr * rr + B.x * B.x);
    float dth = atan(B.x, rr);
    float th = th0 + dth;
    float sAbs = th * uFloorDims.z;
    sRel = mod(sAbs - uRefBasis.w + 0.5 * L, L) - 0.5 * L;
    z = B.z;
    // baza doku obrocona do bazy kotwicy statku
    float c = cos(dth);
    float s = sin(dth);
    fwdL = vec3(c * fwdL.x - s * fwdL.y, s * fwdL.x + c * fwdL.y, fwdL.z);
  }
  float dTheta = sRel / uFloorDims.z;
  vec3 anchor = haloRelFromPolar(dTheta, r - uFloorDims.z, z);
  float th = uRefBasis.z + dTheta;
  vec3 et = vec3(-sin(th), cos(th), 0.0);
  vec3 er = vec3(cos(th), sin(th), 0.0);
  vec3 fw = normalize(et * fwdL.x + er * fwdL.y + vec3(0.0, 0.0, fwdL.z));
  vec3 upV = abs(fw.z) > 0.95 ? er : vec3(0.0, 0.0, 1.0);
  vec3 side2 = normalize(cross(upV, fw));
  vec3 up2 = cross(fw, side2);
  vec3 lp = position * vec3(len, len * 0.24, len * 0.16);
  vec3 rel = anchor + fw * lp.x + side2 * lp.y + up2 * lp.z;
  vRel = rel;
  vNormal = fw * normal.x + side2 * normal.y + up2 * normal.z;
  vLocal = position;
  vPart = aPart;
  vVar = iB.z;
  vThrust = thrust;
  gl_Position = haloProjectRel(rel);
}
`;

const SHIP_FRAGMENT = /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${HALO_GLSL_LIGHT}
${HALO_GLSL_AIR}
varying vec3 vRel;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vPart;
varying float vVar;
varying float vThrust;
void main() {
  vec3 rel = vRel;
  vec3 p = uCamLocal + rel;
  vec3 N = normalize(vNormal);
  vec3 V = -normalize(rel);
  vec3 L = uSunDir;
  vec3 hull = vVar < 0.33 ? vec3(0.22, 0.225, 0.23) : (vVar < 0.66 ? vec3(0.08, 0.085, 0.095) : vec3(0.16, 0.12, 0.08));
  // panele wzdluz kadluba
  float band = step(0.5, fract(vLocal.x * 14.0 + vVar * 3.0));
  vec3 albedo = hull * (0.85 + 0.15 * band);
  vec3 emit = vec3(0.0);
  if (vPart > 0.5 && vPart < 1.5) {
    // dysza: bialy rdzen z niebieska otoczka, tylko sciana tylna
    // tylna sciana bloku dysz (x = -0,5); dwa rdzenie
    float rear = step(vLocal.x, -0.495);
    vec2 q = vec2(abs(vLocal.y) - 0.16, vLocal.z);
    float core = 1.0 - smoothstep(0.03, 0.09, length(q));
    emit += (vec3(${f3(HALO_HDR.stripBlue)}) * 1.2 + vec3(${f3([HALO_HDR.navWhite * 0.9, HALO_HDR.navWhite * 0.95, HALO_HDR.navWhite])}) * core) * rear * vThrust;
    albedo *= 0.3;
  }
  if (vPart > 1.5 && vPart < 2.5) {
    float win = step(0.5, fract(vLocal.x * 60.0)) * step(abs(vLocal.z - 0.12), 0.012);
    emit += vec3(${f3(HALO_HDR.windowCool)}) * win * 0.8;
  }
  vec3 sunVis = haloSunVisibility(p + N * 3.0, L);
  float NdL = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 60.0) * 0.6;
  vec3 amb = haloPlanetshine(p, N) + vec3(uNightAmbient) + vec3(0.004, 0.005, 0.007);
  vec3 color = albedo * (uSunColor * sunVis * NdL + amb) + uSunColor * sunVis * spec * 0.15 + emit;
  color = haloApplyAir(color, rel, haloIGN(gl_FragCoord.xy));
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

// Kadłub: bryły złożone w jednostkach długości (x ∈ [−0,5; 0,5]).
function makeShip() {
  const parts = [
    { part: 0, box: [-0.42, 0.35, -0.5, 0.5, -0.5, 0.5] },
    { part: 3, box: [0.35, 0.5, -0.28, 0.28, -0.35, 0.3] },
    { part: 2, box: [-0.12, 0.12, -0.22, 0.22, 0.4, 0.9] },
    { part: 1, box: [-0.5, -0.42, -0.62, 0.62, -0.6, 0.6] }
  ];
  const pos = [];
  const nor = [];
  const prt = [];
  for (const { part, box } of parts) {
    const [x0, x1, y0, y1, z0, z1] = box;
    const g = new THREE.BoxGeometry(x1 - x0, (y1 - y0), (z1 - z0)).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i) * 0.5, p.getZ(i) * 0.5);
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      prt.push(part);
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(prt, 1));
  return g;
}

// Plan ruchu (czysta matematyka, deterministyczny).
export function buildHaloTraffic(layout, plan, count = 64) {
  const data = [];
  const L = layout.circumference;
  for (let k = 0; k < count; k++) {
    const big = haloHashI(k, 1, 61) < 0.12;
    const dir = haloHashI(k, 2, 61) < 0.5 ? 1 : -1;
    const speed = dir * (big ? 180 + 120 * haloHashI(k, 3, 61) : 320 + 520 * haloHashI(k, 3, 61));
    const s0 = haloHashI(k, 4, 61) * L;
    const lane = haloHashI(k, 5, 61);
    // pod dokami (pokład −190, klin do −1250 przy podłodze), nad dolną
    // krawędzią wstęgi; płaszczyzna gry (z = 0) zostaje dla statków gry
    const zSpan = Math.max(600, -layout.z.botIn - 900);
    const z = -650 - zSpan * haloHashI(k, 6, 61);
    const len = big ? 900 + 700 * haloHashI(k, 7, 61) : 120 + 380 * haloHashI(k, 7, 61);
    data.push(0, s0, speed, lane, z, len, haloHashI(k, 8, 61), 0.4 + 0.6 * haloHashI(k, 9, 61));
  }
  for (const dock of plan.docks) {
    // okręt liniowy w każdym doku; cykl 150 s, fazy rozłożone
    data.push(1, dock.theta, 150, 0.23 + dock.index * 0.31, 0, 1650, 0.5, 0);
  }
  return new Float32Array(data);
}

export class HaloTraffic {
  constructor({ layout, uniforms, plan }) {
    this.base = makeShip();
    const data = buildHaloTraffic(layout, plan);
    const geo = new THREE.InstancedBufferGeometry();
    for (const [name, attr] of Object.entries(this.base.attributes)) geo.setAttribute(name, attr);
    const buf = new THREE.InstancedInterleavedBuffer(data, STRIDE);
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.instanceCount = data.length / STRIDE;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.material = new THREE.ShaderMaterial({
      name: 'HaloTraffic',
      uniforms: {
        ...uniforms,
        uTraffic: { value: new THREE.Vector4(layout.radii.rim, layout.sigma, layout.circumference, 0) },
        uTrafficDock: { value: new THREE.Vector4(plan.docks[0]?.frameR ?? layout.radii.rim, plan.docks[0]?.depth ?? HALO_PORT.reach,
          plan.docks[0]?.berthY ?? HALO_PORT.reach * 0.5, plan.docks[0]?.berthZ ?? -330) }
      },
      vertexShader: SHIP_VERTEX,
      fragmentShader: SHIP_FRAGMENT,
      defines: { AIR_STEPS: 3 }
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'HaloTraffic';
    this.mesh.frustumCulled = false;
    this.count = geo.instanceCount;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.base.dispose();
    this.material.dispose();
  }
}
