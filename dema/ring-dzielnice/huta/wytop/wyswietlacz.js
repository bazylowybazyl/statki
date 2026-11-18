// HUTA — wytop: WYŚWIETLACZ GRAWITACJI (jedna bryła, jeden materiał TSL).
//
// Decyzja użytkownika (SPEC, wpis 5): „strzałki dałbym na wyświetlacze — na bokach kadzi, na środku, wyświetlacz,
// w którym strzałki by się kręciły, symbolizując, że działa generator. Potem strzałki stają i robią w dół, pokazując,
// że grawitacja idzie w dół.” To JEDYNY sygnał grawitacji w komorze.
//
// BRYŁA: pas ekranów dookoła studni na środku wysokości ściany (`KOMORA.display`), gładka bryła obrotowa (odcinki co
// 1,25° — nie 32-kąt): daszek przy ścianie, LICO pochylone ku górze (35,5° od pionu — czytelne z kamery z góry, jak pas
// ekranów na stadionie), dolna listwa, spód wracający do ściany. Przerwa na zatokę taśmy (czoła zaślepione).
//
// OBRAZ lica liczy shader z funkcji (żadnych osobnych brył strzałek): komórka = jeden podwójny szewron; stan z uniformu
// `U.disp` = (faza obiegu, obrót 0…1, faza spływu, jasność):
//   0 g        szewrony biegną po obwodzie zgodnie z wirem pola (barwa chłodna)
//   zrzut      STAJĄ → każdy obraca się w miejscu grotem w dół → płyną w dół lica (barwa ciepła); z kamery z góry
//              „w dół lica” = ku osi komory
// Wzór szewronu jest ten sam co `geometria.chevronAt` (test w Node). Ekran to matryca diod: z bliska widać piksele
// i szwy modułów, z daleka wzór uśrednia się bez migotania.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, abs, attribute, cameraProjectionMatrix, clamp, cos, dot, exp, float, fract, fwidth, max, min, mix, modelViewMatrix,
  normalize, pow, reflect, sign, sin, smoothstep, step, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { CHEVRON, KOMORA } from './geometria.js';
import { LUMA, ballLight, skyLight, sunVis } from './wspolneTSL.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Przekrój pasa (r, y) i rozmiary lica: szerokość komórki na środku lica i długość tworzącej lica [j.]. */
export function displayProfile() {
  const D = KOMORA.display;
  const yT = D.y + D.half;
  const yB = D.y - D.half;
  const A = [D.rOut - 5, yT];                 // góra lica (pod daszkiem)
  const B = [D.rIn, yB];                      // dół lica
  const slant = Math.hypot(A[0] - B[0], A[1] - B[1]);
  const rMid = (A[0] + B[0]) / 2;
  return {
    A, B, slant, rMid, cellW: TAU * rMid / D.cells,
    // normalna lica (do wnętrza i w górę) w (r, y)
    nr: -(A[1] - B[1]) / slant, ny: (A[0] - B[0]) / slant,
    pts: [
      [KOMORA.pitR + 2, yT + 12], [D.rOut - 10, yT + 12], [D.rOut - 12, yT + 3], A, B,
      [D.rIn - 3.5, yB + 3], [D.rIn - 6, yB - 2.5], [D.rIn - 3, yB - 8], [KOMORA.pitR + 2, yB - 42]
    ]
  };
}

/**
 * Siatka pasa (czyste tablice — test w Node): pozycja, normalna, (azymut [rad], współrzędna w dół lica 0…1), rodzaj
 * (1 — lico ekranu, 0 — obudowa). Zwraca { pos, nor, uv, kind, count }.
 */
export function buildDisplayArrays(stepDeg = 1.25) {
  const D = KOMORA.display;
  const P = displayProfile();
  const a0 = D.gap1 * DEG;
  const a1 = (D.gap0 + 360) * DEG;
  const n = Math.round((a1 - a0) / (stepDeg * DEG));
  const strips = P.pts.length - 1;
  const cap = (P.pts.length - 2) * 3 * 2;
  const count = n * strips * 6 + cap;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const kind = new Float32Array(count);
  let w = 0;
  const put = (r, y, az, nr, ny, v, k) => {
    const c = Math.cos(az);
    const s = Math.sin(az);
    pos[w * 3] = c * r; pos[w * 3 + 1] = y; pos[w * 3 + 2] = s * r;
    nor[w * 3] = c * nr; nor[w * 3 + 1] = ny; nor[w * 3 + 2] = s * nr;
    uv[w * 2] = az; uv[w * 2 + 1] = v;
    kind[w] = k;
    w++;
  };
  for (let q = 0; q < strips; q++) {
    const p = P.pts[q];
    const p2 = P.pts[q + 1];
    // normalna odcinka przekroju: w prawo od kierunku p → p2 w płaszczyźnie (r, y), zwrócona od bryły
    const dr = p2[0] - p[0];
    const dy = p2[1] - p[1];
    const l = Math.hypot(dr, dy) || 1;
    const nr = dy / l;
    const ny = -dr / l;
    const face = q === 3 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const b0 = a0 + (a1 - a0) * i / n;
      const b1 = a0 + (a1 - a0) * (i + 1) / n;
      put(p[0], p[1], b0, nr, ny, 0, face); put(p[0], p[1], b1, nr, ny, 0, face); put(p2[0], p2[1], b1, nr, ny, 1, face);
      put(p[0], p[1], b0, nr, ny, 0, face); put(p2[0], p2[1], b1, nr, ny, 1, face); put(p2[0], p2[1], b0, nr, ny, 1, face);
    }
  }
  // czoła przy zatoce taśmy: wachlarz przekroju (normalna styczna do obwodu, na zewnątrz pasa)
  for (const [az, sgn] of [[a0, -1], [a1, 1]]) {
    const c = Math.cos(az);
    const s = Math.sin(az);
    const o = P.pts[0];
    for (let q = 1; q + 1 < P.pts.length; q++) {
      const tri = sgn > 0 ? [o, P.pts[q], P.pts[q + 1]] : [o, P.pts[q + 1], P.pts[q]];
      for (const p of tri) {
        pos[w * 3] = c * p[0]; pos[w * 3 + 1] = p[1]; pos[w * 3 + 2] = s * p[0];
        nor[w * 3] = -s * sgn; nor[w * 3 + 1] = 0; nor[w * 3 + 2] = c * sgn;
        uv[w * 2] = az; uv[w * 2 + 1] = 0;
        kind[w] = 0;
        w++;
      }
    }
  }
  return { pos, nor, uv, kind, count: w };
}

export function createDisplayGeometry() {
  const a = buildDisplayArrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos.subarray(0, a.count * 3), 3));
  g.setAttribute('aN', new THREE.BufferAttribute(a.nor.subarray(0, a.count * 3), 3));
  g.setAttribute('aU', new THREE.BufferAttribute(a.uv.subarray(0, a.count * 2), 2));
  g.setAttribute('aK', new THREE.BufferAttribute(a.kind.subarray(0, a.count), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 700);
  return g;
}

/** Barwy ekranu: 0 g — chłodna, grawitacja — ciepła (te same podaje `obraz.js` jako światło robocze komory). */
export const DISPLAY_COOL = [0.14, 0.82, 1.0];
export const DISPLAY_WARM = [1.0, 0.56, 0.12];

/**
 * Podwójny szewron w komórce: (x, y) w szerokościach komórki, grot ku +x; `turn` 0…1 obraca go o 90° (grot ku +y —
 * w dół lica). Dwa szewrony jeden za drugim; maska 0…1 z miękkim brzegiem `soft`.
 */
function chevronPair(x, y, ca, sa, soft) {
  const px = x.mul(ca).add(y.mul(sa));
  const py = y.mul(ca).sub(x.mul(sa));
  const ay = abs(py);
  const inArm = float(1.0).sub(smoothstep(float(CHEVRON.arm).sub(soft), float(CHEVRON.arm).add(soft), ay));
  const base = px.add(ay.mul(CHEVRON.slope)).sub(CHEVRON.tip);
  const one = (off) => float(1.0).sub(smoothstep(float(CHEVRON.thick).sub(soft), float(CHEVRON.thick).add(soft), abs(base.add(off))));
  return max(one(CHEVRON.off[0]), one(CHEVRON.off[1])).mul(inArm);
}

export function createDisplayMaterial(U) {
  const P = displayProfile();
  const D = KOMORA.display;
  const vP = varyingProperty('vec3', 'vWsP');
  const vN = varyingProperty('vec3', 'vWsN');
  const vU = varyingProperty('vec3', 'vWsU');
  const F1 = (e) => { const v = float(0.0).toVar(); v.assign(e); return v; };
  const V3 = (e) => { const v = vec3(0.0).toVar(); v.assign(e); return v; };
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    vP.assign(p);
    vN.assign(attribute('aN', 'vec3'));
    const uvq = attribute('aU', 'vec2');
    vU.assign(vec3(uvq.x, uvq.y, attribute('aK', 'float')));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1.0)));
  })();
  const fragment = Fn(() => {
    const Pc = V3(vP);
    const V = V3(normalize(U.cam.sub(Pc)));
    const N0 = V3(normalize(vN));
    const N = V3(N0.mul(sign(dot(N0, V).add(1e-5))));
    const isFace = F1(step(0.5, vU.z));
    const turn = U.disp.y;
    // współrzędne lica w szerokościach komórki: s — po obwodzie w kierunku obiegu (wir pola: malejący azymut),
    // t — w dół lica (0 — pod daszkiem)
    const ratio = P.slant / P.cellW;
    const s = F1(vU.x.mul(-D.cells / TAU));
    const t = F1(vU.y.mul(ratio));
    // pochodne przed gałęziami (pułapka 15): rozmiar piksela ekranu w komórkach
    const fw = F1(max(fwidth(s), fwidth(t)));
    const soft = F1(clamp(fw.mul(0.9), CHEVRON.soft, 0.2));
    const ang = turn.mul(Math.PI / 2);
    const ca = F1(cos(ang));
    const sa = F1(sin(ang));
    // komórka własna i dwie sąsiednie po obwodzie (szewron w obrocie wystaje poza swoją komórkę); w dół lica kafel
    // powtarza się co wysokość lica — szewron spływający dołem wchodzi z powrotem górą
    const cx = F1(fract(s.sub(U.disp.x)).sub(0.5));
    const cy = F1(fract(vU.y.sub(U.disp.z)).sub(0.5).mul(ratio));
    const chev = F1(max(max(chevronPair(cx, cy, ca, sa, soft), chevronPair(cx.add(1.0), cy, ca, sa, soft)), chevronPair(cx.sub(1.0), cy, ca, sa, soft)));
    // matryca diod: punkty co `PITCH` j. (z daleka uśrednione), szwy modułów co komórkę obwodu (nieruchome), ramka
    const PITCH = 3.6;
    const gu = vec2(s.mul(P.cellW / PITCH), t.mul(P.cellW / PITCH));
    const gf = fract(gu).sub(0.5);
    const dotM = float(1.0).sub(smoothstep(0.28, 0.46, max(abs(gf.x), abs(gf.y))));
    const lodPx = F1(clamp(float(1.6).sub(fw.mul(P.cellW / PITCH).mul(1.7)), 0.0, 1.0));
    const led = F1(mix(float(0.52), dotM, lodPx));
    const seamW = F1(max(fw.mul(1.2), 0.012));
    const seam = F1(smoothstep(seamW, seamW.mul(2.2), abs(fract(s).sub(0.5)).sub(0.5).abs()));
    const frame = F1(smoothstep(0.0, 0.035, vU.y).mul(float(1.0).sub(smoothstep(0.965, 1.0, vU.y))));
    const rails = F1(exp(vU.y.sub(0.07).div(0.012).mul(vU.y.sub(0.07).div(0.012)).negate()).add(exp(vU.y.sub(0.93).div(0.012).mul(vU.y.sub(0.93).div(0.012)).negate())));
    const col = V3(mix(vec3(...DISPLAY_COOL), vec3(...DISPLAY_WARM), smoothstep(0.35, 0.95, turn)));
    const time = U.ball.w;
    const shimmer = sin(time.mul(37.0).add(s.mul(9.0))).mul(0.025).add(1.0);
    const bright = U.disp.w;
    const emit = V3(col.mul(chev.mul(2.3).add(rails.mul(0.22)).add(0.03)).mul(led).mul(seam).mul(frame).mul(shimmer).mul(bright));
    // szkło ekranu: prawie czarne, odbija żar bryły (szeroki połysk) i niebo
    const r = V3(reflect(V.negate(), N));
    const Pb = V3(Pc.sub(U.off));
    const toBall = V3(normalize(Pb.negate()));
    const om = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
    const fres = om.mul(om).mul(om).mul(0.8).add(0.06);
    const glassSpec = V3(U.light.xyz.mul(min(U.light.w.mul(0.04), 0.5)).mul(pow(max(dot(r, toBall), 0.0), 6.0)).mul(fres.mul(2.4))
      .add(vec3(0.02, 0.03, 0.05).mul(max(r.y, 0.0)).mul(fres)));
    const faceCol = V3(emit.add(glassSpec));
    // obudowa: ciemna stal w świetle komory + poświata własnego ekranu na daszku i dolnej listwie
    const sv = F1(sunVis(U, Pc));
    const ndl = max(dot(N, U.sunDir), 0.0);
    const lightv = V3(U.sunColor.mul(ndl.mul(sv)).add(skyLight(U, Pc, N)).add(ballLight(U, Pc, N)));
    const spill = F1(exp(abs(Pc.y.sub(D.y)).div(-60.0)).mul(clamp(dot(N, vec3(0.0, -0.3, 0.0)).add(0.75), 0.0, 1.0)));
    const body = V3(vec3(0.055, 0.058, 0.066).mul(lightv.add(U.dcol.mul(spill.mul(0.9)))));
    const lum = dot(body, LUMA);
    body.mulAssign(float(1.0).div(lum.mul(1.5).add(1.0)));
    const outc = vec3(0.0).toVar();
    outc.assign(mix(body, faceCol, isFace));
    return vec4(max(outc, vec3(0.0)), 1.0);
  })();
  const m = new NodeMaterial();
  m.name = 'WytopWyswietlacz';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.side = THREE.DoubleSide;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  return m;
}
