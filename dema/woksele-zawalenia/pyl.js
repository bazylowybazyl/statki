// Pył, błysk i kłąb dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 4.6, § 4.8, pakiet P4). Wzorzec: film, .tmp/woksele-proto/proby4/obraz4.mjs + rys4.mjs, opcje z bieg-film.sh; przyczyna z proby5/final/obraz5.mjs + rys5.mjs.
// Jeden rysunek i jeden pipeline: kwady pyłu i błysku w celu około 720 wierszy, HDR, mieszanie (1, 1 − a) z premultiplikacją. Pył pisze (kolor · a, a), błysk (ogień, 0), czyli addytywnie, a składa je kwad wyjścia. Bez drugiego renderera i bez bloomu.
// Bufory: wPyl [3q]: pozycja + wiek, prędkość + r0, (alfa, jasność, życie, 0). wBlysk [3s] w solverze: pozycja + klatka, prędkość nosiciela + moc, r + ziarno + ile kłębu + świeży.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, Discard, instanceIndex, storage, uniform, uint, float, vec2, vec3, vec4, dot, sqrt, min, max, clamp, smoothstep, sin, atan, exp, select,
  atomicAdd, positionGeometry, varyingProperty, cameraViewMatrix, cameraProjectionMatrix, screenUV,
} from 'three/tsl';

export const CAP_P = 16000;
export const KW_BLYSK = 3; // kwady na rekord błysku: 2–3 plamy ognia z tego samego rekordu
const ZYCIE_BLYSK = 0.25;
const KD_DYSK = 4;
const BIT_PYL = 64; // w wRama [3i + 2].w: węzeł już raz emitował pył

// LOD i sufit (§ 4.6, R20): w pikselach celu pyłu, a ten ma około 720 wierszy niezależnie od okna. Kwad duży rysuje co czwarty z alfą × 4, tak samo pył daleki i mikry, a przy kamerze gaśnie.
const LOD_DUZE = [34, 58];
const LOD_MALE = 3;
const SUFIT_PX = 150;
const SUFIT_BLYSK_PX = 220;

/** Opcje filmu (bieg-film.sh) i wyjątki scen. Bez powietrza pyłu kontaktowego nie ma: kont i pod przechodzą na 0 przez uniform, bez nowego pipeline'u. */
const OPCJE_FILMU = { kont: 5, pod: 90, grunt: 70, alfa: 0.7, dysk: 0.25, dziedz: 0.6, zycie: [6, 6] };
export const OPCJE_PYLU = {
  // AGENT: S5 i S5v to wyjątek od filmu: przy 0,6 i 6 s chmura wisiała na wysokości dysku po jego odejściu i gasła równo (proby5/final/SPEC-S5-propozycja.md § 4). Scena wchodzi tu pod swoim id.
  // zar: moc żaru. S5 oglądamy z 3500–7200 j., 0,7 jak w filmie. Reszta to zbliżenia z krateru: 0,7 z 750 j. to jaskrawopomarańczowe kartki (.tmp/woksele-demo/P4/b/krater_t1.40.png).
  S5: { dziedz: 0.85, zycie: [1.5, 3.5], zar: 0.7 },
  S5v: { dziedz: 0.85, zycie: [1.5, 3.5], zar: 0.7 },
  S5p: { dziedz: 0.85, zycie: [1.5, 3.5], zar: 0.7, powietrze: true }, // planeta z pola punktowego: gruntu w płaszczyźnie nie ma, a powietrze jest
  // Wiele ognisk (plan LOD, metoda G). kwady: sufit pierścienia (do CAP_P), emisja: ułamek węzłów, które w ogóle emitują, rozmiar: mnożnik promienia kwadu, sufitPx: sufit promienia w px celu, lodDuze: próg „co czwarty”.
  // AGENT: pod i grunt pchają pył promieniowo od początku układu (x, y) = 0, czyli od osi jednej wieży. W scenie z wieloma budynkami całą chmurę pchałyby w jedną stronę, stąd 0. Rozlew od środka własnego budynku to osobna praca.
  LOD60: { kwady: 6000, emisja: 0.35, rozmiar: 1.5, sufitPx: 90, lodDuze: [24, 42], pod: 0, grunt: 0 },
  // Dzielnica (plan LOD § 5): budynek jest około 10 razy mniejszy niż wieża, więc kwady i kłąb mniejsze, a żar jak z daleka w S5. klab, klabV: mnożniki rozmiaru i prędkości kłębu przy kuli.
  M1: { kwady: 10000, emisja: 0.6, rozmiar: 0.42, sufitPx: 90, lodDuze: [24, 42], pod: 0, grunt: 0, kont: 3, zar: 0.7, zycie: [4.5, 7], klab: 0.55, klabV: 0.45 },
  M2: { kwady: 14000, emisja: 0.45, rozmiar: 0.42, sufitPx: 90, lodDuze: [24, 42], pod: 0, grunt: 0, kont: 3, zar: 0.7, zycie: [4.5, 7], klab: 0.55, klabV: 0.45 },
  // Miasto dalekie: wspólny pierścień solvera (około 300 budynków) i tieru 0 (miastoDalekie.js, kilkanaście cząstek na budynek).
  M3: { kwady: 16000, emisja: 0.45, rozmiar: 0.42, sufitPx: 90, lodDuze: [24, 42], pod: 0, grunt: 0, kont: 3, zar: 0.7, zycie: [4.5, 7], klab: 0.55, klabV: 0.45 },
  // Baza piratów (plan LOD § 5c): rozmiary wieży przy dx = 40, kadr około 9000 j., wiele ognisk, próżnia z podłogą planetoidy.
  B1: { kwady: 14000, emisja: 0.4, rozmiar: 1.7, sufitPx: 110, lodDuze: [24, 42], pod: 0, grunt: 0, kont: 3, zar: 0.7, zycie: [2.5, 5], klab: 1.6, klabV: 1.1 },
};

export function createWokselePyl({ solver, A, MAX, wWezR, wRamaW, wDaneR, uTau, uDt, uKlatka, glebNode, liniowa, uFp }) {
  const { uN, uGruntZ } = solver.uniformy;
  const BLYSKI = solver.blyski;
  const REK_LISTY = A.lista.count / MAX;
  const aPyl = new THREE.StorageInstancedBufferAttribute(new Float32Array(4 * 3 * CAP_P), 4);
  const aLicz = new THREE.StorageInstancedBufferAttribute(new Uint32Array(1), 1);
  const wPylW = storage(aPyl, 'vec4', 3 * CAP_P).setName('wokPyl');
  const wPylR = storage(aPyl, 'vec4', 3 * CAP_P).setName('wokPyl').toReadOnly();
  const wLiczA = storage(aLicz, 'uint', 1).setName('wokLiczPyl').toAtomic();
  const wListaR = storage(A.lista, 'uint', A.lista.count).setName('wokLista').toReadOnly();
  const wBlyskW = storage(A.blysk, 'vec4', 3 * BLYSKI).setName('wokBlysk');
  const wBlyskR = storage(A.blysk, 'vec4', 3 * BLYSKI).setName('wokBlysk').toReadOnly();

  const uPow = uniform(1).setName('uPylPow');
  const uDrag = uniform(0.985).setName('uPylDrag');
  const uWypor = uniform(3.5).setName('uPylWypor');
  const uKont = uniform(5).setName('uPylKont');
  const uPod = uniform(90).setName('uPylPod');
  const uGruntA = uniform(70).setName('uPylGruntA');
  const uAlfa = uniform(0.7).setName('uPylAlfa');
  const uDysk = uniform(0.25).setName('uPylDysk');
  const uDziedz = uniform(0.6).setName('uPylDziedz');
  const uZ0 = uniform(6).setName('uPylZ0');
  const uZd = uniform(0).setName('uPylZd');
  const uR0 = uniform(1).setName('uPylR0');
  const uRt = uniform(38).setName('uPylRt');
  // Kłąb przy kuli (§ 4 propozycji S5): z powietrzem i bez.
  const uKlA = uniform(1.25).setName('uKlabA');
  const uKlJ = uniform(0.3).setName('uKlabJ');
  const uKlZ0 = uniform(1.2).setName('uKlabZ0');
  const uKlZd = uniform(1.6).setName('uKlabZd');
  const uKlV = uniform(180).setName('uKlabV');
  const uKlR0 = uniform(18).setName('uKlabR0');
  const uKlRd = uniform(18).setName('uKlabRd');
  const uBlysk = uniform(1).setName('uBlyskMoc');
  const uLodA = uniform(LOD_DUZE[0]).setName('uPylLodA');
  const uLodB = uniform(LOD_DUZE[1]).setName('uPylLodB');
  const uLodM = uniform(LOD_MALE).setName('uPylLodM');
  const uSufit = uniform(SUFIT_PX).setName('uPylSufit');
  const uSufitB = uniform(SUFIT_BLYSK_PX).setName('uBlyskSufit');
  const uSklad = uniform(1).setName('uPylSklad');
  // Sufit kwadów i rzadsza emisja z parametru sceny (plan LOD, metoda G): pierścień krótszy niż CAP_P, a gęstość ognisk nie mnoży przerysu. Przy kwady = CAP_P i emisja = 1 to dokładnie to samo co dotąd.
  const uKapP = uniform(CAP_P, 'uint').setName('uPylKap');
  const uEmisja = uniform(1).setName('uPylEmisja');

  const fv =(e) => { const v = float(0).toVar(); v.assign(e); return v; };
  const uv_ = (e) => { const v = uint(0).toVar(); v.assign(e); return v; };
  const v3 = (e) => { const v = vec3(0).toVar(); v.assign(e); return v; };
  const v4 = (e) => { const v = vec4(0).toVar(); v.assign(e); return v; };
  const haszT = (a) => {
    const h = uv_(a.bitXor(uint(0x9E3779B1)).mul(uint(0x85EBCA77)));
    h.assign(h.bitXor(h.shiftRight(uint(13))).mul(uint(0xC2B2AE3D)));
    return uv_(h.bitXor(h.shiftRight(uint(16))));
  };
  const u1 = (h, s) => float(h.shiftRight(uint(s)).bitAnd(uint(1023))).div(511.5).sub(1);
  const bajt = (h, s) => float(h.shiftRight(uint(s)).bitAnd(uint(255))).div(255);

  // ── kPylEmisja, § 4.6 ── Reguła jak w filmie: pierwszy raz przy lost > 0,5 i co najmniej `kont` kontaktach, dysk z losem `dysk`, potem los 1/3 na jedną cząstkę.
  // AGENT: kObraz ma już 8 buforów storage, więc emisja to osobny kernel. Bit emisji w wRama: dispatche idą po kolei, kObraz przepisuje go przy zapisie bitów.
  const kPylEmisja = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const i3 = uv_(uint(3).mul(i));
    const p = v4(wWezR.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    const lost = fv(wRamaW.element(i3.add(uint(1))).w);
    If(lost.lessThanEqual(0.5), () => { Return(); });
    const bity = uv_(uint(wRamaW.element(i3.add(uint(2))).w));
    If(bity.bitAnd(uint(BIT_PYL)).notEqual(uint(0)), () => { Return(); });
    If(float(wListaR.element(uint(REK_LISTY).mul(i))).lessThan(uKont), () => { Return(); });
    const kd = uv_(uint(wDaneR.element(uint(2).mul(i).add(uint(1))).w).shiftRight(uint(2)).bitAnd(uint(7)));
    If(kd.equal(uint(KD_DYSK)).and(float(haszT(i.add(uint(9))).bitAnd(uint(1023))).div(1023).greaterThan(uDysk)), () => { Return(); });
    wRamaW.element(i3.add(uint(2))).w.assign(float(bity.bitOr(uint(BIT_PYL))));
    const h = haszT(i.add(uint(31337)));
    const t3 = uv_(h.shiftRight(uint(3)));
    If(t3.sub(t3.div(uint(3)).mul(uint(3))).notEqual(uint(0)), () => { Return(); });
    const hq = haszT(h);
    If(float(haszT(hq.add(uint(77))).bitAnd(uint(1023))).div(1023).greaterThan(uEmisja), () => { Return(); });
    const vi = v3(wWezR.element(i3.add(uint(1))).xyz);
    const dz = fv(select(uPow.greaterThan(0), uDziedz, float(1)));
    const v = v3(vi.mul(dz).add(vec3(u1(hq, 3).mul(30), u1(hq, 13).mul(30), 0)));
    If(uPow.greaterThan(0), () => { v.z.addAssign(u1(hq, 23).add(1).mul(18)); }).Else(() => { v.z.addAssign(u1(hq, 23).mul(30)); });
    If(uPod.greaterThan(0), () => {
      const rr = fv(sqrt(p.x.mul(p.x).add(p.y.mul(p.y))).add(1));
      const uu = fv(bajt(hq, 9).mul(0.5).add(0.5));
      const pr = fv(uPod.mul(uu).div(rr));
      v.assign(vec3(v.x.add(pr.mul(p.x)), v.y.add(pr.mul(p.y)), u1(hq, 23).mul(6)));
    });
    const q = uv_(atomicAdd(wLiczA.element(uint(0)), uint(1)).mod(uKapP));
    const q3 = uv_(uint(3).mul(q));
    wPylW.element(q3).assign(vec4(p.xyz.add(vec3(u1(hq, 0), u1(hq, 10), u1(hq, 20)).mul(10)), 0));
    wPylW.element(q3.add(uint(1))).assign(vec4(v, bajt(hq, 7).mul(18).add(16)));
    wPylW.element(q3.add(uint(2))).assign(vec4(1, 0.42, uZ0.add(uZd.mul(bajt(hq, 19))), 0));
  })().compute(MAX).setName('wokPylEmisja');

  // ── kPrzyczyna, § 4.8 ── 64 rekordy: przesuwa z nosicielem, gasi po 0,25 s, raz wyrzuca kłąb pyłu przy kuli. Zapis rekordu: kKraterCel w solverze.
  const kPrzyczyna = Fn(() => {
    const s3 = uv_(uint(3).mul(instanceIndex));
    const b = v4(wBlyskW.element(s3.add(uint(1))));
    If(b.w.lessThanEqual(0), () => { Return(); });
    const a = v4(wBlyskW.element(s3));
    If(uKlatka.sub(a.w).div(60).greaterThan(ZYCIE_BLYSK), () => { wBlyskW.element(s3.add(uint(1))).w.assign(0); Return(); });
    wBlyskW.element(s3).assign(vec4(a.xyz.add(b.xyz.mul(uDt)), a.w));
    const c = v4(wBlyskW.element(s3.add(uint(2))));
    If(c.w.lessThanEqual(0), () => { Return(); });
    wBlyskW.element(s3.add(uint(2))).w.assign(0);
    const hE = haszT(uint(c.y));
    const dz = fv(select(uPow.greaterThan(0), uDziedz, float(1)));
    Loop({ start: uint(0), end: uint(c.z), type: 'uint', condition: '<', name: 'kk' }, ({ kk }) => {
      const hq = haszT(hE.add(kk.mul(uint(101))));
      const ax = fv(u1(hq, 0));
      const ay = fv(u1(hq, 10));
      const az = fv(u1(hq, 20).mul(0.7));
      const li = fv(float(1).div(sqrt(ax.mul(ax).add(ay.mul(ay)).add(az.mul(az))).add(1e-3)));
      const os = v3(vec3(ax, ay, az).mul(li));
      const q = uv_(atomicAdd(wLiczA.element(uint(0)), uint(1)).mod(uKapP));
      const q3 = uv_(uint(3).mul(q));
      wPylW.element(q3).assign(vec4(a.xyz.add(os.mul(c.x.mul(0.5))), 0));
      wPylW.element(q3.add(uint(1))).assign(vec4(b.xyz.mul(dz).add(os.mul(uKlV.mul(bajt(hq, 5)))), uKlR0.add(uKlRd.mul(bajt(hq, 13)))));
      wPylW.element(q3.add(uint(2))).assign(vec4(uKlA, uKlJ, uKlZ0.add(uKlZd.mul(bajt(hq, 21))), 0));
    });
  })().compute(BLYSKI).setName('wokPrzyczyna');

  // ── kPylKrok, § 4.6 ── Opór i wypór to skutek powietrza, nie grawitacji. Chmura przy gruncie jak `pylGrunt` w obraz4.mjs.
  const kPylKrok = Fn(() => {
    const q3 = uv_(uint(3).mul(instanceIndex));
    const b = v4(wPylW.element(q3.add(uint(1))));
    If(b.w.lessThanEqual(0), () => { Return(); });
    const a = v4(wPylW.element(q3));
    If(a.w.greaterThan(wPylW.element(q3.add(uint(2))).z), () => { wPylW.element(q3.add(uint(1))).w.assign(0); Return(); });
    const v = v3(b.xyz.mul(uDrag));
    v.z.addAssign(uWypor.mul(uDt));
    const r0 = fv(b.w);
    If(uPow.greaterThan(0).and(a.z.lessThan(uGruntZ.add(170))), () => {
      const rr = fv(sqrt(a.x.mul(a.x).add(a.y.mul(a.y))).add(30));
      const ak = fv(uGruntA.mul(uDt).mul(max(float(1).sub(a.w.div(7)), 0)).div(rr));
      v.assign(vec3(v.x.add(ak.mul(a.x)), v.y.add(ak.mul(a.y)), min(v.z, 3)));
      r0.addAssign(uDt.mul(16));
    });
    const x = v3(a.xyz.add(v.mul(uDt)));
    If(x.z.lessThan(uGruntZ.add(8)), () => {
      x.z.assign(uGruntZ.add(8));
      v.assign(vec3(v.x.mul(1.002), v.y.mul(1.002), 8));
    });
    wPylW.element(q3).assign(vec4(x, a.w.add(uDt)));
    wPylW.element(q3.add(uint(1))).assign(vec4(v, r0));
  })().compute(CAP_P).setName('wokPylKrok');

  const kernele = { kPylEmisja, kPrzyczyna, kPylKrok };
  const lista = [kPylEmisja, kPrzyczyna, kPylKrok];

  // ── Rysunek ── Kwady w płaszczyźnie widoku. Bez testu głębi sprzętowego: cel nie ma głębi, miękkość jak w rys4.mjs z tekstury przebiegu głębi tych samych rozmiarów.
  const plaski = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plaski.index;
  geo.setAttribute('position', plaski.attributes.position);
  geo.instanceCount = CAP_P + KW_BLYSK * BLYSKI;

  const vUv = varyingProperty('vec2', 'vPylUv');
  const vFaz = varyingProperty('vec2', 'vPylFaz');
  const vKol = varyingProperty('vec3', 'vPylKol');
  const vA = varyingProperty('float', 'vPylA');
  const vZc = varyingProperty('float', 'vPylZc');
  const vR = varyingProperty('float', 'vPylR');
  const vRodz = varyingProperty('float', 'vPylRodz');

  const mat = new THREE.NodeMaterial();
  mat.name = 'WokPyl';
  mat.map = null;
  mat.lights = false;
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

  // Zmienne przypisane przed rozgałęzieniami, varyingi na końcu (pułapka 39).
  mat.vertexNode = Fn(() => {
    const id = uv_(instanceIndex);
    const C = vec2(0).toVar();
    C.assign(positionGeometry.xy);
    const W = v3(vec3(0));
    const R = fv(0);
    const Al = fv(0);
    const Kol = v3(vec3(0));
    const Faz = vec2(0).toVar();
    Faz.assign(vec2(0));
    const Rodz = fv(0);
    If(id.lessThan(uKapP), () => {
      const q3 = uv_(uint(3).mul(id));
      const b = v4(wPylR.element(q3.add(uint(1))));
      If(b.w.greaterThan(0), () => {
        const a = v4(wPylR.element(q3));
        const c = v4(wPylR.element(q3.add(uint(2))));
        const wiek = fv(a.w.add(uTau));
        W.assign(a.xyz.add(b.xyz.mul(uTau)));
        R.assign(b.w.mul(uR0).add(uRt.mul(sqrt(wiek))));
        Al.assign(c.x.mul(uAlfa).mul(0.075).mul(min(wiek.mul(4), 1)).mul(max(float(1).sub(wiek.div(c.z)), 0)));
        Kol.assign(vec3(0.62, 0.58, 0.52).mul(c.y));
      });
    }).Else(() => {
      const r = uv_(id.sub(uKapP));
      const s = uv_(r.div(uint(KW_BLYSK)));
      const k = uv_(r.sub(s.mul(uint(KW_BLYSK))));
      const s3 = uv_(uint(3).mul(s));
      const b = v4(wBlyskR.element(s3.add(uint(1))));
      If(b.w.greaterThan(0), () => {
        const a = v4(wBlyskR.element(s3));
        const c = v4(wBlyskR.element(s3.add(uint(2))));
        const wiek = fv(uKlatka.sub(a.w).div(60).add(uTau));
        const hE = haszT(uint(c.y));
        const hp = haszT(hE.add(k.mul(uint(211))));
        // Trzecia plama co drugi błysk. Narastanie przez 3 klatki, potem wykładniczo: główna 0,075 s, reszta 0,05 s (obraz5.mjs).
        If(k.lessThan(uint(2)).or(hE.shiftRight(uint(3)).bitAnd(uint(1)).equal(uint(1))), () => {
          const pl = fv(select(k.equal(uint(0)), float(0), float(1)));
          const tauZ = fv(select(c.z.greaterThanEqual(20), float(0.075), float(0.05)));
          const I = fv(b.w.mul(uBlysk).mul(min(wiek.add(1 / 60).mul(20), 1)).mul(exp(max(wiek.sub(2 / 60), 0).div(tauZ).negate())).mul(float(1).sub(pl.mul(0.25))));
          const of = v3(vec3(u1(hp, 0).mul(0.6), u1(hp, 10).mul(0.6), u1(hp, 20).mul(0.4)).mul(c.x).mul(pl));
          W.assign(a.xyz.add(b.xyz.mul(uTau)).add(of));
          R.assign(c.x.mul(select(pl.lessThan(0.5), float(0.9), bajt(hp, 4).mul(0.35).add(0.55))).mul(wiek.mul(3.2).add(1)));
          Al.assign(I);
          Faz.assign(vec2(bajt(hp, 8).mul(6.283), bajt(hp, 16).mul(6.283)));
          Rodz.assign(1);
        });
      });
    });
    const pv = v4(cameraViewMatrix.mul(vec4(W, 1)));
    const zc = fv(pv.z.negate());
    const Rw = fv(R);
    const A2 = fv(Al);
    const zakres = fv(1);
    const clip = v4(vec4(2, 2, 2, 1));
    If(Al.greaterThan(0).and(zc.greaterThan(5)), () => {
      const rp = fv(R.mul(uFp).div(zc));
      If(Rodz.lessThan(0.5), () => {
        // Przy kamerze gaśnie, sufit promienia w pikselach, a duży albo mikry kwad rysuje co czwarty z alfą × 4 (§ 4.6, R20).
        A2.mulAssign(smoothstep(R.mul(1.5), R.mul(3), zc));
        If(rp.greaterThan(uSufit), () => { Rw.assign(uSufit.mul(zc).div(uFp)); });
        const fD = fv(smoothstep(uLodA, uLodB, rp));
        const fM = fv(float(1).sub(smoothstep(uLodM, uLodM.mul(2), rp)));
        const f = fv(max(fD, fM));
        A2.mulAssign(select(id.bitAnd(uint(3)).equal(uint(0)), f.mul(3).add(1), float(1).sub(f)));
        If(A2.greaterThan(0.002), () => { clip.assign(cameraProjectionMatrix.mul(vec4(pv.xy.add(C.mul(Rw)), pv.z, 1))); });
      }).Else(() => {
        If(rp.greaterThan(uSufitB), () => { Rw.assign(uSufitB.mul(zc).div(uFp)); });
        zakres.assign(1.55); // obrys z sinusów sięga 1,52 promienia
        If(A2.greaterThan(0.02), () => { clip.assign(cameraProjectionMatrix.mul(vec4(pv.xy.add(C.mul(Rw).mul(1.55)), pv.z, 1))); });
      });
    });
    vUv.assign(C.mul(zakres));
    vFaz.assign(Faz);
    vKol.assign(Kol);
    vA.assign(A2);
    vZc.assign(zc);
    vR.assign(Rw);
    vRodz.assign(Rodz);
    return clip;
  })();

  mat.fragmentNode = Fn(() => {
    const zSc = fv(liniowa(glebNode.sample(screenUV).x));
    const d2 = fv(dot(vUv, vUv));
    const wyj = v4(vec4(0));
    If(vRodz.lessThan(0.5), () => {
      If(d2.lessThan(1), () => {
        const q = fv(float(1).sub(d2));
        const a = fv(vA.mul(q).mul(q).mul(clamp(zSc.sub(vZc).div(vR.mul(0.8).add(1)), 0, 1)));
        wyj.assign(vec4(vKol.mul(a), a));
      });
    }).Else(() => {
      // Ogień, rys5.mjs: obrys nieokrągły z 3 sinusów kąta, kwad wysunięty ku kamerze o 0,7 r, środek biało-żółty, brzeg pomarańczowy, im słabiej, tym czerwieniej. Alfa 0, więc addytywnie.
      const an = fv(atan(vUv.y, vUv.x));
      const ks = fv(sin(an.mul(3).add(vFaz.x)).mul(0.28).add(sin(an.mul(5).add(vFaz.y)).mul(0.16)).add(sin(an.mul(9).add(vFaz.x).add(vFaz.y)).mul(0.08)).add(1));
      const dk = fv(d2.div(ks.mul(ks)));
      If(dk.lessThan(1), () => {
        const q = fv(float(1).sub(dk));
        const a = fv(vA.mul(q).mul(q).mul(clamp(zSc.sub(vZc.sub(vR.mul(0.7))).div(vR.mul(0.8).add(1)), 0, 1)));
        const go = fv(min(a, 1));
        wyj.assign(vec4(a, a.mul(go.mul(0.4).add(0.32)), a.mul(go.mul(go).mul(0.3).add(0.05)), 0));
      });
    });
    Discard(wyj.r.add(wyj.a).lessThan(4e-4));
    return wyj;
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'WokPyl';
  mesh.frustumCulled = false;
  const scena = new THREE.Scene();
  scena.add(mesh);

  const rt = new THREE.RenderTarget(2, 2, { depthBuffer: false, type: THREE.HalfFloatType });
  rt.texture.generateMipmaps = false;

  /** Parametry miejsca i sceny: bez nowego pipeline'u. Bez powietrza pył to prawie niewidoczna mgiełka, a kłąb to krótki rozbłysk (§ 4.6, § 4.8). */
  function wczytaj(w, opcje = null) {
    const o = { ...OPCJE_FILMU, ...opcje };
    const pow = o.powietrze ?? w.gruntZ > -1e20;
    uPow.value = pow ? 1 : 0;
    uDrag.value = pow ? 0.985 : 1;
    uWypor.value = pow ? 3.5 : 0;
    uKont.value = pow ? o.kont : 0;
    uPod.value = pow ? o.pod : 0;
    uGruntA.value = pow ? o.grunt : 0;
    uAlfa.value = o.alfa;
    uDysk.value = o.dysk;
    uDziedz.value = o.dziedz;
    uZ0.value = o.zycie[0];
    uZd.value = o.zycie[1] - o.zycie[0];
    const rozm = o.rozmiar ?? 1;
    uR0.value = (pow ? 1 : 0.5) * rozm;
    uRt.value = (pow ? 38 : 9) * rozm;
    const kwady = Math.min(o.kwady ?? CAP_P, CAP_P);
    uKapP.value = kwady;
    uEmisja.value = o.emisja ?? 1;
    uSufit.value = o.sufitPx ?? SUFIT_PX;
    uLodA.value = o.lodDuze?.[0] ?? LOD_DUZE[0];
    uLodB.value = o.lodDuze?.[1] ?? LOD_DUZE[1];
    geo.instanceCount = kwady + KW_BLYSK * BLYSKI;
    kPylKrok.setCount(kwady);
    uKlA.value = pow ? 1.25 : 2.2;
    uKlJ.value = pow ? 0.3 : 0.26;
    uKlZ0.value = pow ? 1.2 : 0.7;
    uKlZd.value = pow ? 1.6 : 0.7;
    uKlV.value = (pow ? 180 : 120) * (o.klabV ?? 1);
    uKlR0.value = (pow ? 18 : 30) * (o.klab ?? 1);
    uKlRd.value = (pow ? 18 : 26) * (o.klab ?? 1);
    aPyl.array.fill(0);
    aPyl.needsUpdate = true;
    aLicz.array[0] = 0;
    aLicz.needsUpdate = true;
    kPylEmisja.setCount(w.n);
  }

  function ustawRozmiar(renderer, hw, hh) {
    rt.setSize(hw, hh);
    rt.texture.needsUpdate = true;
    if (renderer.initRenderTarget) renderer.initRenderTarget(rt);
  }

  let wlaczony = true;
  const _kolor = new THREE.Color(0, 0, 0);
  /** Klatka: cel pyłu czyszczony do (0, 0, 0, 0). Stan clear ustawia i przywraca wołający. Bez alokacji. */
  function rysuj(renderer, cam) {
    if (!wlaczony) return;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(_kolor, 0);
    renderer.render(scena, cam);
  }

  return {
    kernele, lista, scena, mesh, rt, uSklad, aPyl, aLicz, uBlysk,
    uniformy: { uPow, uDrag, uWypor, uKont, uPod, uGruntA, uAlfa, uDysk, uDziedz, uZ0, uZd, uR0, uRt, uLodA, uLodB, uLodM, uSufit, uSufitB, uKapP },
    wczytaj, ustawRozmiar, rysuj,
    /** Pomiar: pył włączony i wyłączony na tej samej klatce. Wyłączenie zdejmuje rysunek i skład, kernele liczą dalej. */
    wlacz(b) { wlaczony = b; uSklad.value = b ? 1 : 0; },
  };
}
