// dema/silniki-marki/struga.js
//
// STRUGA silnika — JEDEN graf TSL i JEDEN rysunek dla wszystkich marek i trybów. Kwad obracany wokół osi dyszy do
// kamery (działa w widoku z góry i w kamerze pochylonej), kształt liczony analitycznie we fragmencie z wektora liczb
// instancji (marki.js: blendPlume) — shader nie zna marek ani trybów:
//   • ciało: profil poprzeczny (gauss / płaski arkusz / pusta powłoka), szerokość z rozprężeniem i zwężeniem do końca,
//     smugi szumu płynące od wylotu, poszarpany koniec;
//   • dyski Macha: przewężenia i jasne węzły co `dSpacing` promieni (dysza płaska — w kształcie litery V);
//   • impulsy: pociąg kłębów (silnik detonacyjny), wiązki siatki (jonowy), włókna śrubowe (warp magnetoplazmy);
//   • rdzeń (jedyne pasmo nad progiem bloomu) i szeroka, słaba otoczka;
//   • `detach` — początek strugi odsuwa się od dyszy (lanca warpa odrywa się przy wyjściu).
// FAZA wzoru jest całkowana na CPU (faza += przepływ / rozciągnięcie · dt), nigdy czas × prędkość w shaderze.
// Port do gry: dane instancji → bufor storage ze slotem dyszy, szum → fxNoise gry, rysunek w passie ortho.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec4, uniform, attribute, positionGeometry, varyingProperty,
  mix, smoothstep, clamp, exp, sin, cos, max, min, abs, pow, fract, cross, normalize, mx_noise_float
} from 'three/tsl';

export const STRUGA_CAP = 64;
const STRIDE = 44;
const PRE = 0.035; // ułamek długości przed wargą (miękki początek)
const TAU = 6.2831853;
// Rdzeń jest jedynym pasmem nad progiem bloomu gry (0,9, bramka pełną wartością): ma być cienki i umiarkowanie jasny.
const CORE_HDR = 0.42;
// Barwa ciała w danych marki to jasność przy pełnym nasyceniu strugi; ciało ma miękki sufit (1 − e^−x),
// więc większa moc wypełnia strugę zamiast przepalać ją do bieli.
const BODY_K = 1.35;
// Sufit luminancji ciała jednej strugi — pod progiem bloomu gry (0,9), z zapasem na otoczkę i sąsiednie dysze.
const BODY_LUM_MAX = 0.72;

/** Mnożnik barwy ciała: BODY_K, ale nie ponad sufit luminancji (barwa zostaje nasycona, bez bloomu z ciała). */
function bodyScale(c) {
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * BODY_K;
  return lum > BODY_LUM_MAX ? BODY_K * BODY_LUM_MAX / lum : BODY_K;
}

export class StrugaBatch {
  constructor({ scene, capacity = STRUGA_CAP, renderOrder = 60 }) {
    this.capacity = capacity;
    this.count = 0;
    this.U = { view: uniform(new THREE.Vector3(0, 0, -1)), gain: uniform(1) };
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.data = new Float32Array(capacity * STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < STRIDE / 4; i++) geo.setAttribute(`sg${i}`, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const U = this.U;
    const vS = varyingProperty('vec4', 'vSg'); // s, t (w półszerokościach wylotu), brzeg kwadu −1…1, —
    const mat = new THREE.NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    mat.blendEquation = THREE.AddEquation;
    mat.blendEquationAlpha = THREE.AddEquation;

    mat.positionNode = Fn(() => {
      const A = attribute('sg0', 'vec4');
      const B = attribute('sg1', 'vec4');
      const C = attribute('sg2', 'vec4');
      const q = positionGeometry.xy;
      const s = q.x.add(0.5).mul(1 + PRE).sub(PRE);
      const lat = q.y.mul(2.0);
      const axis = vec3(B.xy, 0.0);
      const perp = normalize(cross(axis, U.view));
      vS.assign(vec4(s, lat.mul(C.x).div(max(B.z, 1e-3)), lat, 0.0));
      return A.xyz.add(axis.mul(s.mul(A.w))).add(perp.mul(lat.mul(C.x)));
    })();

    mat.fragmentNode = Fn(() => {
      const A = attribute('sg0', 'vec4');   // x, y, z, długość L
      const B = attribute('sg1', 'vec4');   // kierunek xy, półszerokość Rw, moc
      const C = attribute('sg2', 'vec4');   // półszerokość kwadu, faza wzoru, rozciągnięcie, ziarno
      const D = attribute('sg3', 'vec4');   // flare, taper, turb, streak
      const E = attribute('sg4', 'vec4');   // diamonds, dSpacing, dDecay, flat
      const F = attribute('sg5', 'vec4');   // pulse, pSpacing, faza impulsów, twist
      const G = attribute('sg6', 'vec4');   // grid, shell, coreLen, coreW
      const cCore = attribute('sg7', 'vec4');   // rdzeń rgb (× wzmocnienie), sheathW
      const cBody = attribute('sg8', 'vec4');   // ciało rgb, detach
      const cTip = attribute('sg9', 'vec4');    // koniec rgb, jednostka osiowa Ru
      const cSheath = attribute('sg10', 'vec4'); // otoczka rgb (× wzmocnienie), —

      const sRaw = clamp(vS.x, -PRE, 1.0).toVar();
      const t = vS.y.toVar();
      const edge = clamp(vS.z, -1.0, 1.0);
      const sP = max(sRaw, 0.0).toVar();
      const phase = C.y;
      const stretch = max(C.z, 1.0);
      const seed = C.w;
      const flare = D.x;
      const flat = E.w;

      const xr = sP.mul(A.w).div(max(cTip.w, 1e-3)).toVar();        // odległość od wargi w promieniach
      const X = xr.div(stretch).sub(phase).toVar();                 // współrzędna wzoru (płynie od dyszy)

      // Wężowanie całej strugi — rośnie z odległością.
      const kink = mx_noise_float(vec3(X.mul(0.13), seed.mul(7.13), phase.mul(0.07)));
      const tt = t.sub(kink.mul(D.z).mul(sP.mul(1.6).add(0.1)).mul(flare.add(1.0))).toVar();

      // Poszarpany koniec: długość zależy od miejsca w poprzek i płynie w czasie.
      const tipN = mx_noise_float(vec3(tt.mul(1.4).add(seed.mul(3.1)), phase.mul(0.9), 2.7)).mul(0.5).add(0.5);
      const tipLen = float(1.0).sub(tipN.mul(0.2).mul(min(D.z.mul(6.0).add(0.3), 1.0)));
      const sT = clamp(sP.div(tipLen), 0.0, 1.0).toVar();
      const rem = max(float(1.0).sub(sT), 1e-4).toVar();

      // Dyski Macha: przewężenie i jasny węzeł; dysza płaska przesuwa fazę z odległością od osi (kształt V).
      const dph = xr.div(max(E.y, 0.2)).add(abs(tt).mul(flat).mul(0.22));
      const dWave = cos(dph.mul(TAU)).toVar();
      const dEnv = E.x.mul(exp(sP.mul(E.z).negate())).toVar();
      const nodeC = float(0.5).sub(dWave.mul(0.5)).toVar();
      const node2 = nodeC.mul(nodeC);
      const node = node2.mul(node2).toVar();
      const pinch = float(1.0).sub(dEnv.mul(nodeC).mul(0.26));

      // Impulsy: kłąb w każdej komórce pociągu.
      const pp = fract(xr.div(max(F.y, 0.2)).sub(F.z));
      const pc = pp.sub(0.5).div(0.3);
      const puff = exp(pc.mul(pc).negate()).toVar();
      const pulseW = mix(float(1.0), puff.mul(0.3).add(0.85), F.x);
      const puffB = mix(float(1.0), puff.mul(1.9).add(0.06), F.x).toVar();

      const grow = float(1.0).add(flare.mul(float(1.0).sub(exp(sP.mul(-7.0)))));
      const w = max(grow.mul(pow(rem, D.y)).mul(pinch).mul(pulseW), 0.02).toVar();
      const u = tt.div(w).toVar();
      const u2 = u.mul(u).toVar();

      // Profil poprzeczny: gauss → płaski arkusz → powłoka z jasnymi brzegami.
      const gauss = exp(u2.mul(-1.8)).toVar();
      const flatTop = exp(u2.mul(u2).mul(u2).mul(-1.3));
      const solid = mix(gauss, flatTop, flat);
      const sh = abs(u).sub(0.72).div(0.24);
      const prof = mix(solid, solid.mul(0.4).add(exp(sh.mul(sh).negate()).mul(0.85)), G.y);

      // Smugi płynące od wylotu (długie wzdłuż osi, wąskie w poprzek).
      const n1 = mx_noise_float(vec3(X.mul(0.22), tt.mul(2.1).add(seed.mul(3.7)), phase.mul(0.11))).toVar();
      const n2 = mx_noise_float(vec3(X.mul(0.7).sub(phase.mul(0.18)), tt.mul(5.3).sub(seed.mul(1.9)), phase.mul(0.17)));
      const streakMod = max(float(1.0).add(D.w.mul(n1.mul(0.6).add(n2.mul(0.4)))), 0.05);

      // Wiązki siatki jonowej: prążki przy panelu, dalej zlewają się w kurtynę.
      const lines = cos(u.mul(G.x).mul(3.14159265)).mul(0.5).add(0.5);
      const lineMask = min(G.x, 1.0).mul(exp(sP.mul(-5.0)));
      const beam = mix(float(1.0), lines.mul(lines).mul(1.5).add(0.3), lineMask);

      const ax = pow(rem, 0.7).toVar();
      const bodyRaw = prof.mul(ax).mul(streakMod).mul(beam).mul(node.mul(dEnv).mul(1.1).add(1.0)).mul(puffB);
      const bodyCol = mix(cBody.rgb, cTip.rgb, smoothstep(0.08, 0.8, sT));

      // Włókna śrubowe (tylko gdy twist > 0).
      const th = X.mul(0.28).mul(TAU);
      const sn = sin(th).mul(0.6);
      const a1 = u.sub(sn).div(0.2);
      const a2 = u.add(sn).div(0.2);
      const strands = exp(a1.mul(a1).negate()).mul(cos(th).mul(0.35).add(0.65)).add(exp(a2.mul(a2).negate()).mul(float(0.65).sub(cos(th).mul(0.35))));
      const twistL = F.w.mul(strands).mul(ax);
      // Miękki sufit ciała: moc wypełnia strugę, barwa zostaje barwą (bez bloomu z samego ciała).
      const bodyL = float(1.0).sub(exp(bodyRaw.add(twistL).mul(B.w).mul(-1.25)));

      // Rdzeń: cienki, gaśnie wykładniczo; węzły Macha go rozjaśniają.
      const cw = max(G.w.mul(float(1.0).sub(sP.mul(0.45))).mul(pinch), 0.03);
      const cu = tt.div(cw);
      const coreL = exp(cu.mul(cu).mul(-2.5)).mul(exp(sP.div(max(G.z, 0.01)).negate())).mul(node.mul(dEnv).mul(2.2).add(1.0)).mul(mix(float(1.0), puff.add(0.2), F.x));

      // Otoczka: szeroka i słaba.
      const ws = w.mul(cCore.w).add(sP.mul(0.4));
      const su = tt.div(ws);
      // Otoczka żyje na bokach ciała (w środku ciało już świeci) — suma w osi nie przekracza progu bloomu.
      const sheathL = exp(su.mul(su).mul(-1.7)).mul(float(1.0).sub(gauss.mul(0.7))).mul(pow(rem, 1.5)).mul(n1.mul(0.2).add(0.8)).mul(puffB);

      // Maski: miękki początek przed wargą, oderwanie od dyszy, brzeg kwadu.
      const inFront = smoothstep(-PRE, 0.004, vS.x);
      const detach = cBody.w;
      const detLin = clamp(sP.sub(detach).div(0.14).add(float(1.0).sub(min(detach.mul(40.0), 1.0))), 0.0, 1.0);
      const det = detLin.mul(detLin).mul(float(3.0).sub(detLin.mul(2.0)));
      const edgeFade = float(1.0).sub(smoothstep(0.8, 1.0, abs(edge)));

      const rgb = cCore.rgb.mul(coreL).add(cSheath.rgb.mul(sheathL)).mul(B.w).add(bodyCol.mul(bodyL));
      return vec4(max(rgb.mul(inFront).mul(det).mul(edgeFade).mul(U.gain), vec3(0.0)), 0.0);
    })();

    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'strugi';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  /**
   * Struga jednej dyszy. (x, y, z) — warga w scenie, (dx, dy) — kierunek wydechu, ru — promień wylotu (jednostka
   * długości), rw — półszerokość wylotu, P — nastawy z blendPlume, power — moc tej dyszy (jasność), phase / pPhase —
   * fazy całkowane na CPU, detach 0…1 — początek strugi odsunięty od dyszy.
   */
  add(x, y, z, dx, dy, ru, rw, P, power, phase, pPhase, seed, detach = 0, kLen = 1) {
    if (this.count >= this.capacity || !(power > 0.002)) return;
    const L = P.len * ru * kLen;
    const Rw = P.wid * rw;
    if (!(L > 0.5) || !(Rw > 0.05)) return;
    const o = this.count++ * STRIDE;
    const d = this.data;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    const pulseMax = 1 + 0.37 * P.pulse;
    const half = Rw * ((1 + P.flare) * Math.max(1.25, P.sheathW * 1.6) * pulseMax + P.turb * 1.8 * (1 + P.flare)) + 0.45 * L * 0.05 + 0.7 * Rw;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = L;
    d[o + 4] = dx / l; d[o + 5] = dy / l; d[o + 6] = Rw; d[o + 7] = power;
    d[o + 8] = half; d[o + 9] = phase; d[o + 10] = P.stretch; d[o + 11] = seed;
    d[o + 12] = P.flare; d[o + 13] = P.taper; d[o + 14] = P.turb; d[o + 15] = P.streak;
    d[o + 16] = P.diamonds; d[o + 17] = P.dSpacing; d[o + 18] = P.dDecay; d[o + 19] = P.flat;
    d[o + 20] = P.pulse; d[o + 21] = P.pSpacing; d[o + 22] = pPhase - Math.floor(pPhase); d[o + 23] = P.twist;
    d[o + 24] = P.grid; d[o + 25] = P.shell; d[o + 26] = P.coreLen; d[o + 27] = P.coreW;
    const cg = P.coreGain * CORE_HDR;
    d[o + 28] = P.core[0] * cg; d[o + 29] = P.core[1] * cg; d[o + 30] = P.core[2] * cg; d[o + 31] = P.sheathW;
    const kb = bodyScale(P.body);
    const kt = bodyScale(P.tip);
    d[o + 32] = P.body[0] * kb; d[o + 33] = P.body[1] * kb; d[o + 34] = P.body[2] * kb; d[o + 35] = detach;
    d[o + 36] = P.tip[0] * kt; d[o + 37] = P.tip[1] * kt; d[o + 38] = P.tip[2] * kt; d[o + 39] = ru;
    const sg = P.sheathGain;
    d[o + 40] = P.sheath[0] * sg; d[o + 41] = P.sheath[1] * sg; d[o + 42] = P.sheath[2] * sg; d[o + 43] = 0;
  }

  commit(viewDir) {
    this.U.view.value.copy(viewDir);
    const n = this.count;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, n * STRIDE);
    this.buffer.needsUpdate = true;
  }
}
