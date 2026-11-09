// Powierzchnia planety z atmosferą pod bazą w demie wokseli (?planeta=ziemia|mars): krzywa tarcza aż za horyzont, teren z szumu, mgiełka z góry,
// uderzenia pokazują błyski i pył z puli smug spalania. Skala rzeczywista: Ziemia R 6371 km, baza 110 km nad gruntem (atmosfera.js).
// Do wpięcia w planetaDema.js (opis planety: środek, promień, kształt powierzchni, grawitacja, atmosfera): tu tylko obraz.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uint, float, vec2, vec3, vec4, dot, length, normalize, clamp, smoothstep, mix, exp, floor, fract, max, min, pow,
  positionGeometry, cameraPosition, varyingProperty, modelViewMatrix, cameraProjectionMatrix,
} from 'three/tsl';

const PIERSCIENIE = 110, SEKTORY = 192;

/** Tarcza biegunowa o promieniu 1, pierścienie zagęszczone ku środkowi (pod bazą gęsto, przy horyzoncie rzadko). */
function geometriaTarczy() {
  const poz = [];
  const ind = [];
  poz.push(0, 0, 0);
  for (let k = 1; k <= PIERSCIENIE; k++) {
    const r = Math.pow(k / PIERSCIENIE, 2.4);
    for (let s = 0; s < SEKTORY; s++) {
      const a = (s / SEKTORY) * Math.PI * 2;
      poz.push(r * Math.cos(a), r * Math.sin(a), 0);
    }
  }
  for (let s = 0; s < SEKTORY; s++) ind.push(0, 1 + s, 1 + ((s + 1) % SEKTORY));
  for (let k = 1; k < PIERSCIENIE; k++) {
    const a0 = 1 + (k - 1) * SEKTORY, a1 = 1 + k * SEKTORY;
    for (let s = 0; s < SEKTORY; s++) {
      const s1 = (s + 1) % SEKTORY;
      ind.push(a0 + s, a1 + s, a1 + s1, a0 + s, a1 + s1, a0 + s1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(poz, 3));
  g.setIndex(ind);
  return g;
}

/** Szum wartości 2D z hasza na liczbach całkowitych (bez sin, bez Math.random). Wklejane. */
const haszF = (p) => {
  const h = uint(0).toVar();
  h.assign(uint(p.x.add(32768)).mul(uint(0x8da6b343)).bitXor(uint(p.y.add(32768)).mul(uint(0xd8163841))));
  h.assign(h.bitXor(h.shiftRight(uint(15))).mul(uint(0x2c1b3c6d)));
  h.assign(h.bitXor(h.shiftRight(uint(12))));
  return float(h.bitAnd(uint(0xffff))).div(65535);
};
const szum = (p) => {
  const i = vec2(0).toVar();
  i.assign(floor(p));
  const f = vec2(0).toVar();
  f.assign(fract(p));
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = haszF(i), b = haszF(i.add(vec2(1, 0))), c = haszF(i.add(vec2(0, 1))), d = haszF(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};
const fbm = (p, okt) => {
  const s = float(0).toVar();
  const q = vec2(0).toVar();
  q.assign(p);
  let w = 0.5, suma = 0;
  for (let k = 0; k < okt; k++) {
    s.addAssign(szum(q).mul(w));
    suma += w;
    q.assign(vec2(q.x.mul(1.6).sub(q.y.mul(1.2)), q.x.mul(1.2).add(q.y.mul(1.6))).add(17.3));
    w *= 0.5;
  }
  return s.div(suma);
};

/**
 * planeta: wpis PLANETY_ATM z atmosferą. spalanie: moduł spalania (wspólne uniformy: z powierzchni, słońce). Siatka w scenie obrazu przed rozgrzewką.
 */
export function createPowierzchniaAtm({ planeta, obraz, spalanie }) {
  const atm = planeta.atmosfera;
  const R = planeta.R;
  // Horyzont z wysokości kamery około 1,1 · wysokości bazy: √(2 R h), z zapasem.
  const rMax = 1.25 * Math.sqrt(2 * R * planeta.wysBazy * 1.2);
  const uPowZ = spalanie.uniformy.uPowZ;
  const uInv2R = uniform(1 / (2 * R)).setName('uPowInv2R');
  const uRMax = uniform(rMax).setName('uPowRMax');
  const uInvH = uniform(1 / atm.H).setName('uPowInvH');
  const uTauZen = uniform(new THREE.Vector3(...atm.tauZenit)).setName('uPowTauZen');
  const uMgla = uniform(new THREE.Vector3(...atm.mgla)).setName('uPowMgla');
  const uSlonce = spalanie.uniformy.uSlonce;
  const ZIEMIA = planeta.grunt === 'ziemia';

  const vPos = varyingProperty('vec3', 'vPowP');
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = 'WokPowierzchniaAtm';
  mat.map = null;
  mat.vertexNode = Fn(() => {
    const xy = vec2(positionGeometry.x, positionGeometry.y).mul(uRMax);
    const r2 = dot(xy, xy);
    // Kula: z = −h0 − r²/2R − r⁴/8R³ (do horyzontu błąd poniżej metra).
    const z = uPowZ.sub(r2.mul(uInv2R)).sub(r2.mul(r2).mul(uInv2R).mul(uInv2R).mul(uInv2R));
    const P = vec3(xy, z);
    vPos.assign(P);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(P, 1)));
  })();

  mat.colorNode = Fn(() => {
    const P = vec3(0).toVar();
    P.assign(vPos);
    const km = P.xy.div(1000);
    const n = vec3(0).toVar();
    n.assign(normalize(vec3(P.xy.mul(uInv2R.mul(2)), 1)));
    const kol = vec3(0).toVar();
    if (ZIEMIA) {
      // Ląd i ocean (fbm 90 km), w lądzie lasy, stepy i góry, na wierzchu chmury (fbm 30 km) z cieniem przesuniętym od słońca.
      const lad = float(0).toVar();
      lad.assign(fbm(km.div(90), 5));
      const mieso = float(0).toVar();
      mieso.assign(fbm(km.div(14).add(40), 4));
      const ocean = vec3(0.008, 0.03, 0.075).mul(mix(1, 1.35, fbm(km.div(30).add(9), 2)));
      const plycizna = vec3(0.02, 0.09, 0.12);
      const las = vec3(0.035, 0.07, 0.025);
      const step_ = vec3(0.16, 0.13, 0.07);
      const gory = vec3(0.13, 0.12, 0.11);
      const kolLad = mix(mix(las, step_, smoothstep(0.35, 0.7, mieso)), gory, smoothstep(0.62, 0.78, fbm(km.div(6).add(3), 3)));
      kol.assign(mix(mix(ocean, plycizna, smoothstep(0.47, 0.5, lad)), kolLad, smoothstep(0.5, 0.515, lad)));
      const chm = float(0).toVar();
      chm.assign(smoothstep(0.52, 0.72, fbm(km.div(32).add(vec2(5, 2)), 5)));
      const cien = smoothstep(0.52, 0.72, fbm(km.sub(uSlonce.xy.div(max(uSlonce.z, 0.2)).mul(1.5)).div(32).add(vec2(5, 2)), 5));
      kol.mulAssign(float(1).sub(cien.mul(0.55)));
      kol.assign(mix(kol, vec3(0.72, 0.74, 0.78), chm.mul(0.92)));
    } else {
      // Mars: rdza i ochra, ciemne bazalty, kratery (komórki 25 km i 7 km: misa ciemniejsza, jasny wał).
      const t = float(0).toVar();
      t.assign(fbm(km.div(60), 5));
      kol.assign(mix(vec3(0.3, 0.13, 0.06), vec3(0.5, 0.27, 0.13), smoothstep(0.3, 0.7, t)));
      kol.assign(mix(kol, vec3(0.13, 0.09, 0.07), smoothstep(0.58, 0.68, fbm(km.div(25).add(11), 4)).mul(0.7)));
      for (const [skala, moc] of [[25, 1], [7, 0.7]]) {
        const c = km.div(skala);
        const ic = vec2(0).toVar();
        ic.assign(floor(c));
        const o = vec2(haszF(ic.add(91)), haszF(ic.add(37))).mul(0.6).add(0.2);
        const d = length(fract(c).sub(o));
        const rk = haszF(ic.add(5)).mul(0.25).add(0.08);
        const jest = smoothstep(0.55, 0.62, haszF(ic.add(13)));
        const misa = float(1).sub(smoothstep(rk.mul(0.7), rk, d));
        const wal = smoothstep(rk.mul(0.75), rk, d).mul(float(1).sub(smoothstep(rk, rk.mul(1.35), d)));
        kol.mulAssign(float(1).sub(misa.mul(jest).mul(0.3 * moc)).add(wal.mul(jest).mul(0.35 * moc)));
      }
    }
    // Światło słońca z krzywizną (Lambert) i mgiełka z góry: kamera nad atmosferą, masa powietrza ~ 1 / cos kąta do kamery.
    const swiatlo = clamp(dot(n, uSlonce), 0, 1).mul(1.0).add(0.03);
    const doKam = normalize(cameraPosition.sub(P));
    const mu = max(dot(doKam, n), 0);
    const masa = min(float(1).div(mu.add(0.035)), 30);
    const t = exp(uTauZen.mul(masa).negate());
    const wsp = mix(0.55, 1.0, pow(clamp(dot(doKam.negate(), uSlonce).mul(0.5).add(0.5), 0, 1), 3));
    return kol.mul(swiatlo).mul(t).add(uMgla.mul(float(1).sub(t)).mul(0.32).mul(wsp).mul(clamp(uSlonce.z.mul(2).add(0.3), 0, 1)));
  })();
  mat.lights = false;
  const mesh = new THREE.Mesh(geometriaTarczy(), mat);
  mesh.name = 'WokPowierzchniaAtm';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  obraz.scene.add(mesh);
  return { mesh };
}
