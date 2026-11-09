// Obraz kawałków wiązanych wokseli (demo A/B, docs/RAPORT-kawalki-zawalen.md): kawałki z prefraktury (kawalki.js) jadą za swoimi węzłami, a pręty zbrojenia
// rysują się jako druty między nimi. Fizyka bez zmian: to tylko inny rysunek tych samych węzłów. Moduł tworzy obraz.js z opcją `kawalki`, gra go nie dostaje.
//
// Raz na krok fizyki (po kObraz): kKawalki, wątek na kawałek poziomu 0 i 1. Środek i prędkość z węzłów, obrót z dopasowania sztywnego (macierz A = Σ (x − c)(p0 − c0)ᵀ,
// kwaternion z iteracji Müllera i in. 2016, start z poprzedniej klatki). Kawałek PĘKA na stałe, gdy: zniknął jego węzeł, pękło wiązanie między jego węzłami
// albo węzły odeszły od dopasowania sztywnego dalej niż próg (zgniot, zginanie). Pęknięty kawałek oddaje rysunek częściom poziomu 1, a te bryłkom poziomu 2
// (węzeł z własną ramą z kObraz, jak dzisiejszy blok). kKawPoziom: na węzeł numer poziomu, który go rysuje. Wierzchołek rysuje się tylko na tym poziomie.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, instanceIndex, storage, uniform, uint, float, vec3, vec4, attribute, select, countOneBits, smoothstep,
  max, min, mix, dot, length, cross, normalize, sin, cos, abs, positionGeometry, normalGeometry, varyingProperty, cameraViewMatrix,
} from 'three/tsl';
import { BRAK } from './kawalki.js';

export const SEG_DRUTU = 6;
const PYLK = [0.2, 0.19, 0.175];

/** Obrót wektora kwaternionem (xyz, w). Wklejane, tylko w Fn. */
const obrocQ = (q, v) => {
  const t = vec3(0).toVar();
  t.assign(cross(q.xyz, v).mul(2));
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};
const mnozQ = (a, b) => vec4(b.xyz.mul(a.w).add(a.xyz.mul(b.w)).add(cross(a.xyz, b.xyz)), a.w.mul(b.w).sub(dot(a.xyz, b.xyz)));

export function createKawalkiObraz(ctx) {
  const { MAX, uN, uTau, uDx, uKlatka, uZarMoc, wWezR, wMaskaR, wRamaR, wDaneR, wZarR, haszT, czesc, u1, naRame, fv, uv_, v3, v4, vK, vP, vE, mat, aoM, spalanie = null } = ctx;
  const MAXK = MAX; // kawałek ma co najmniej 2 węzły na poziom, więc kawałków obu poziomów jest najwyżej n
  const MAXD = MAX; // prętów na wiązania osiowe granic, zwykle około n / 10

  const aWez = new THREE.StorageInstancedBufferAttribute(new Uint32Array(4 * MAX), 4);
  const aInfo = new THREE.StorageInstancedBufferAttribute(new Uint32Array(4 * MAXK), 4);
  const aCzl = new THREE.StorageInstancedBufferAttribute(new Uint32Array(2 * MAX), 1);
  // Stan kawałka, 4 × vec4: środek + pęknięty, kwaternion, prędkość + średni kwadrat odchyłki, środek w spoczynku (stały). Spoczynek tutaj, bo druty mają już 8 buforów storage.
  const aStan = new THREE.StorageInstancedBufferAttribute(new Float32Array(4 * 4 * MAXK), 4);
  const aPoziom = new THREE.StorageInstancedBufferAttribute(new Uint32Array(MAX), 1);
  const aDruty = new THREE.StorageInstancedBufferAttribute(new Uint32Array(4 * MAXD), 4);
  const wWezK = storage(aWez, 'uvec4', MAX).setName('kawWez').toReadOnly();
  const wInfo = storage(aInfo, 'uvec4', MAXK).setName('kawInfo').toReadOnly();
  const wCzl = storage(aCzl, 'uint', 2 * MAX).setName('kawCzl').toReadOnly();
  const wStanW = storage(aStan, 'vec4', 4 * MAXK).setName('kawStan');
  const wStanR = storage(aStan, 'vec4', 4 * MAXK).setName('kawStan').toReadOnly();
  const wPoziomW = storage(aPoziom, 'uint', MAX).setName('kawPoziom');
  const wPoziomR = storage(aPoziom, 'uint', MAX).setName('kawPoziom').toReadOnly();
  const wDruty = storage(aDruty, 'uvec4', MAXD).setName('kawDruty').toReadOnly();

  const uKawN = uniform(0, 'uint').setName('uKawN');
  // Progi pęknięcia z dopasowania [j.²]: średni kwadrat odchyłki i największy kwadrat. Ustawiane z dx przy wczytaniu.
  const uProgSr2 = uniform(16).setName('uKawProgSr2');
  const uProgMax2 = uniform(64).setName('uKawProgMax2');
  const uDrutGrub = uniform(1.6).setName('uKawDrutGrub');
  const uProgWiaz = uniform(0.2).setName('uKawProgWiaz'); // ułamek pękniętych wiązań wewnętrznych, przy którym kawałek się rozpada
  const uOdlup = uniform(0.22).setName('uKawOdlup'); // odłupanie brzegu oderwanego kawałka, ułamek dx

  // ── kKawalki: dopasowanie sztywne i pęknięcie, wątek na kawałek ──
  const kKawalki = Fn(() => {
    const k = instanceIndex;
    If(k.greaterThanEqual(uKawN), () => { Return(); });
    const k3 = uv_(uint(4).mul(k));
    const s0 = v4(wStanW.element(k3));
    If(s0.w.greaterThan(0.5), () => { Return(); });
    const inf = wInfo.element(k);
    const start = uv_(inf.x);
    const ile = uv_(inf.y);
    const poz = uv_(inf.w.bitAnd(uint(3)));
    const c = v3(vec3(0));
    const vs = v3(vec3(0));
    const zl = fv(0);
    const pekniete = uv_(uint(0));
    const zew = uv_(uint(0)), zewZerw = uv_(uint(0));
    Loop({ start: uint(0), end: ile, type: 'uint', condition: '<', name: 'm' }, ({ m }) => {
      const i = uv_(wCzl.element(start.add(m)));
      const i3 = uv_(uint(3).mul(i));
      const p = v4(wWezR.element(i3));
      If(p.w.lessThan(0), () => { zl.assign(1); });
      c.addAssign(p.xyz);
      vs.addAssign(wWezR.element(i3.add(uint(1))).xyz);
      const kw = wWezK.element(i);
      const mInt = uv_(select(poz.equal(uint(0)), kw.z, kw.w));
      const mI = uv_(wMaskaR.element(i));
      pekniete.addAssign(countOneBits(mInt.bitAnd(mI.bitNot())));
      // Wiązania osiowe na zewnątrz kawałka z maski początkowej (flagi obrazu, bity 5–10): ile ich już puściło.
      const m0 = uv_(uint(wDaneR.element(uint(2).mul(i).add(uint(1))).w).shiftRight(uint(5)).bitAnd(uint(63)).bitAnd(mInt.bitNot()));
      zew.addAssign(countOneBits(m0));
      zewZerw.addAssign(countOneBits(m0.bitAnd(mI.bitNot())));
    });
    // Pęknięte wiązania wewnętrzne: fizyka miażdży też wnętrze ziarna, a pojedyncze pęknięcie nie dzieli kawałka. Próg to ułamek wszystkich, resztę łapie odkształcenie.
    If(float(pekniete).greaterThan(float(inf.w.shiftRight(uint(2))).mul(uProgWiaz)).and(zl.equal(0)), () => { zl.assign(2); });
    const fN = fv(float(ile));
    c.divAssign(fN);
    vs.divAssign(fN);
    const c0 = v3(wStanW.element(k3.add(uint(3))).xyz);
    const a0 = v3(vec3(0)), a1 = v3(vec3(0)), a2 = v3(vec3(0));
    Loop({ start: uint(0), end: ile, type: 'uint', condition: '<', name: 'm2' }, ({ m2 }) => {
      const i = uv_(wCzl.element(start.add(m2)));
      const d = v3(wWezR.element(uint(3).mul(i)).xyz.sub(c));
      const e = v3(wDaneR.element(uint(2).mul(i)).xyz.sub(c0));
      a0.addAssign(d.mul(e.x));
      a1.addAssign(d.mul(e.y));
      a2.addAssign(d.mul(e.z));
    });
    const q = v4(wStanW.element(k3.add(uint(1))));
    Loop({ start: uint(0), end: uint(6), type: 'uint', condition: '<', name: 'it' }, () => {
      const r0 = v3(obrocQ(q, vec3(1, 0, 0)));
      const r1 = v3(obrocQ(q, vec3(0, 1, 0)));
      const r2 = v3(obrocQ(q, vec3(0, 0, 1)));
      const om = v3(cross(r0, a0).add(cross(r1, a1)).add(cross(r2, a2)).div(abs(dot(r0, a0).add(dot(r1, a1)).add(dot(r2, a2))).add(1e-9)));
      const wl = fv(length(om));
      If(wl.greaterThan(1e-9), () => {
        const h = fv(wl.mul(0.5));
        const dq = v4(vec4(om.div(wl).mul(sin(h)), cos(h)));
        q.assign(normalize(mnozQ(dq, q)));
      });
    });
    const sr = fv(0), mx = fv(0);
    Loop({ start: uint(0), end: ile, type: 'uint', condition: '<', name: 'm3' }, ({ m3 }) => {
      const i = uv_(wCzl.element(start.add(m3)));
      const r = v3(wWezR.element(uint(3).mul(i)).xyz.sub(c).sub(obrocQ(q, wDaneR.element(uint(2).mul(i)).xyz.sub(c0))));
      const e2 = fv(dot(r, r));
      sr.addAssign(e2);
      mx.assign(max(mx, e2));
    });
    sr.divAssign(fN);
    // Przyczyna w .w (do pomiaru): 1 zniknął węzeł, 2 pękło wiązanie, 3 odkształcenie ponad próg.
    If(sr.greaterThan(uProgSr2).or(mx.greaterThan(uProgMax2)).and(zl.equal(0)), () => { zl.assign(3); });
    wStanW.element(k3).assign(vec4(c, zl));
    wStanW.element(k3.add(uint(1))).assign(q);
    wStanW.element(k3.add(uint(2))).assign(vec4(vs, sr));
    wStanW.element(k3.add(uint(3))).w.assign(smoothstep(0.05, 0.5, float(zewZerw).div(max(float(zew), 1))));
  })().compute(MAXK).setName('kawKawalki');

  // ── kKawPoziom: który poziom rysuje węzeł ── 0: kawałek poziomu 0 cały, 1: część, 2: bryłka węzła.
  const kKawPoziom = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const kw = wWezK.element(i);
    const p = uv_(uint(2));
    If(kw.y.notEqual(uint(BRAK)), () => { If(wStanR.element(uint(4).mul(kw.y)).w.lessThan(0.5), () => { p.assign(uint(1)); }); });
    If(kw.x.notEqual(uint(BRAK)), () => { If(wStanR.element(uint(4).mul(kw.x)).w.lessThan(0.5), () => { p.assign(uint(0)); }); });
    wPoziomW.element(i).assign(p);
  })().compute(MAX).setName('kawPoziom');

  // Żar węzła jak w bryłach obraz.js (§ 4.8): 1 s gaśnięcia, emisja > 1 przez 0,3 s, rozrzut z hasza.
  const zarWezla = (i, eE) => {
    const zf = fv(wZarR.element(i));
    If(zf.greaterThan(0), () => {
      const wz = fv(uKlatka.sub(zf).div(60).add(uTau));
      If(wz.lessThan(1), () => {
        const qz = fv(float(1).sub(wz));
        const zolty = fv(max(float(1).sub(wz.div(0.3)), 0));
        const mocZ = fv(float(0.45).mul(qz).mul(qz).div(0.49));
        If(wz.lessThan(0.3), () => { mocZ.assign(zolty.mul(1.1).add(0.45)); });
        const hZ = haszT(i.add(uint(2024)));
        const rz = fv(czesc(hZ, 3, 255).mul(0.75).add(0.25));
        If(hZ.bitAnd(uint(7)).equal(uint(0)), () => { rz.assign(1.5); });
        const m = fv(uZarMoc.mul(mocZ).mul(rz));
        eE.assign(vec3(m, m.mul(qz.mul(0.32).add(0.1).add(zolty.mul(0.2))), m.mul(zolty.mul(0.09).add(0.01))));
      });
    });
  };

  // ── Wierzchołek kawałka ── positionGeometry: świat w spoczynku (poziom 0–1) albo przesunięcie od środka węzła w komórkach (poziom 2). kawId: węzeł · 8 + poziom · 2 + przełom.
  // Wierzchołek poza swoim poziomem zapada się w punkt (0, 0, 0): trójkąt bez pola nic nie rysuje. Bez varyingów: głębia i mapa cienia.
  const budujPozycje = ({ varyingi }) => Fn(() => {
    const p0 = v3(positionGeometry);
    const id = uv_(attribute('kawId', 'uint'));
    const v = uv_(id.shiftRight(uint(4)));
    const poz = uv_(id.shiftRight(uint(1)).bitAnd(uint(3)));
    const P = v3(vec3(0));
    const P0 = v3(vec3(0));
    const Kol = v3(vec3(0));
    const v3i = uv_(uint(3).mul(v));
    const pw = v4(wWezR.element(v3i));
    If(wPoziomR.element(v).equal(poz).and(pw.w.greaterThanEqual(0).or(poz.lessThan(uint(2)))), () => {
      If(poz.lessThan(uint(2)), () => {
        const kw = wWezK.element(v);
        const k = uv_(select(poz.equal(uint(0)), kw.x, kw.y));
        const k3 = uv_(uint(4).mul(k));
        const s0 = v4(wStanR.element(k3));
        const q = v4(wStanR.element(k3.add(uint(1))));
        const s2 = v4(wStanR.element(k3.add(uint(2))));
        const s3 = v4(wStanR.element(k3.add(uint(3))));
        // Odłupanie: narożnik na brzegu kawałka po oderwaniu (s3.w: ułamek zerwanych wiązań osiowych na zewnątrz) idzie wzdłuż kawOdlup (pole spójne z wypieku),
        // więc ten sam narożnik na ścianie i na przełomie idzie tak samo, a ścianki odłupań są duże. Przed oderwaniem ściany zostają płaskie.
        const pR = v3(p0.add(attribute('kawOdlup', 'vec4').xyz.mul(s3.w.mul(uDx).mul(uOdlup))));
        P.assign(s0.xyz.add(s2.xyz.mul(uTau)).add(obrocQ(q, pR.sub(s3.xyz))));
        P0.assign(pR);
      }).Else(() => {
        // Bryłka węzła: rama z kObraz (kolumny osi siatki, z rozciągnięciem). Z uszkodzeniem narożniki cofają się do środka, każdy o inny los
        // (hasz z położenia narożnika, więc ściany zewnętrzne i przełomy tej samej bryłki dzielą narożnik): odłupany kamień zamiast kostki.
        const f0 = v4(wRamaR.element(v3i));
        const x = v3(pw.xyz.add(wWezR.element(v3i.add(uint(1))).xyz.mul(uTau)));
        const hc = haszT(v.mul(uint(97)).add(uint(p0.x.mul(8).add(16))).add(uint(p0.y.mul(8).add(16)).mul(uint(41))).add(uint(p0.z.mul(8).add(16)).mul(uint(1681))));
        const sk = fv(float(1.004).sub(f0.w.mul(float(0.08).add(czesc(hc, 5, 255).mul(0.42)))));
        P.assign(x.add(naRame(f0.xyz, wRamaR.element(v3i.add(uint(1))).xyz, wRamaR.element(v3i.add(uint(2))).xyz, p0.mul(uDx.mul(sk)))));
        P0.assign(wDaneR.element(uint(2).mul(v)).xyz.add(p0.mul(uDx)));
      });
      if (varyingi) {
        const d0 = v4(wDaneR.element(uint(2).mul(v)));
        const d1 = v3(wDaneR.element(uint(2).mul(v).add(uint(1))).xyz);
        const lost = fv(wRamaR.element(v3i.add(uint(1))).w);
        const ton = fv(float(1).add(d0.w.sub(1).mul(max(float(id.bitAnd(uint(1))), min(lost.mul(3), 1)))));
        const hv = haszT(v.add(uint(31337)));
        // Przełom: świeży beton, jaśniejszy i z pyłem, z tonem ziarna. Ściana zewnętrzna jak blok.
        const przel = fv(float(id.bitAnd(uint(1))));
        const kolP = v3(mix(d1, vec3(PYLK[0], PYLK[1], PYLK[2]), 0.28).mul(czesc(hv, 4, 63).mul(0.16).add(1.0)));
        Kol.assign(mix(d1, kolP, przel).mul(ton));
      }
      // AGENT: hak spalania (spalanie.js): narożniki węzła cofają się do jego środka z ubytkiem czoła.
      if (spalanie) P.assign(spalanie.pozycja(P, pw.xyz.add(wWezR.element(v3i.add(uint(1))).xyz.mul(uTau)), wZarR.element(v)));
    });
    if (varyingi) {
      const eE = v3(vec3(0));
      zarWezla(v, eE);
      if (spalanie) eE.addAssign(spalanie.emisja(wZarR.element(v))); // AGENT: hak spalania
      vK.assign(Kol);
      vP.assign(P0);
      vE.assign(eE);
    }
    return P;
  })();

  const pusta = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('kawId', new THREE.BufferAttribute(new Uint32Array(3), 1));
    g.setAttribute('kawOdlup', new THREE.BufferAttribute(new Int8Array(12), 4, true));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
    return g;
  };
  const matK = new THREE.MeshLambertNodeMaterial();
  matK.name = 'WokKawalki';
  matK.map = null;
  matK.flatShading = true; // ściana płaska na trójkąt: normalna z pochodnych, a cień bierze ją do przesunięcia wzdłuż normalnej
  matK.positionNode = budujPozycje({ varyingi: true });
  matK.castShadowPositionNode = budujPozycje({ varyingi: false });
  matK.colorNode = mat.colorNode;
  matK.aoNode = mat.aoNode;
  matK.emissiveNode = mat.emissiveNode;
  const mesh = new THREE.Mesh(pusta(), matK);
  mesh.name = 'WokKawalki';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const matKG = new THREE.NodeMaterial();
  matKG.name = 'WokKawalkiGleb';
  matKG.map = null;
  matKG.positionNode = budujPozycje({ varyingi: false });
  matKG.colorNode = vec3(0);
  matKG.lights = false;
  const meshGleb = new THREE.Mesh(mesh.geometry, matKG);
  meshGleb.name = 'WokKawalkiGleb';
  meshGleb.frustumCulled = false;

  // ── Druty zbrojenia ── Instancja: odcinek drutu (pręt · SEG_DRUTU + odcinek), sześcian 2 × 2 × 2 rozciągnięty wzdłuż odcinka.
  // Koniec drutu: środek węzła tak, jak go rysuje jego poziom (kawałek: obrót kawałka, bryłka: pozycja węzła), styczna to kierunek wiązania w tym samym obrocie.
  // Żywe wiązanie: krzywa Hermite'a między końcami (wygina się, gdy kawałki się obracają), schowana, dopóki pręt się nie rozciągnął. Zerwane: dwa kikuty z przełomów.
  const vNd = varyingProperty('vec3', 'vKawDrutN');
  const vKd = varyingProperty('vec3', 'vKawDrutK');
  const koniec = (i, nR) => {
    const lv = uv_(wPoziomR.element(i));
    const i3 = uv_(uint(3).mul(i));
    const pos = v3(wWezR.element(i3).xyz.add(wWezR.element(i3.add(uint(1))).xyz.mul(uTau)));
    const t = v3(nR);
    If(lv.lessThan(uint(2)), () => {
      const kw = wWezK.element(i);
      const k = uv_(select(lv.equal(uint(0)), kw.x, kw.y));
      const k3 = uv_(uint(4).mul(k));
      const q = v4(wStanR.element(k3.add(uint(1))));
      pos.assign(wStanR.element(k3).xyz.add(wStanR.element(k3.add(uint(2))).xyz.mul(uTau)).add(obrocQ(q, wDaneR.element(uint(2).mul(i)).xyz.sub(wStanR.element(k3.add(uint(3))).xyz))));
      t.assign(obrocQ(q, nR));
    }).Else(() => {
      // Rama węzła: kolumna osi wiązania z jego znakiem (w spoczynku to kierunek nR).
      const f0 = v3(wRamaR.element(i3).xyz), f1 = v3(wRamaR.element(i3.add(uint(1))).xyz), f2 = v3(wRamaR.element(i3.add(uint(2))).xyz);
      t.assign(normalize(f0.mul(dot(f0, nR)).add(f1.mul(dot(f1, nR))).add(f2.mul(dot(f2, nR))).add(vec3(1e-6, 2e-6, 3e-6))));
    });
    return { pos, t };
  };
  const budujDrut = ({ varyingi }) => Fn(() => {
    const id = uv_(instanceIndex);
    const nd = uv_(id.div(uint(SEG_DRUTU)));
    const s = uv_(id.sub(nd.mul(uint(SEG_DRUTU))));
    const dr = wDruty.element(nd);
    const i = uv_(dr.x), j = uv_(dr.y), d = uv_(dr.z), h = uv_(dr.w);
    const C = v3(positionGeometry);
    const nf = v3(normalGeometry);
    const P = v3(vec3(0));
    const Nw = v3(vec3(0, 0, 1));
    const zyjeI = wWezR.element(uint(3).mul(i)).w.greaterThanEqual(0);
    const zyjeJ = wWezR.element(uint(3).mul(j)).w.greaterThanEqual(0);
    const nR = v3(normalize(wDaneR.element(uint(2).mul(j)).xyz.sub(wDaneR.element(uint(2).mul(i)).xyz)));
    const A = koniec(i, nR);
    const B = koniec(j, nR);
    const L = fv(length(B.pos.sub(A.pos)));
    const wiaz = uv_(wMaskaR.element(i).shiftRight(d).bitAnd(uint(1)));
    const p0 = v3(vec3(0)), p1 = v3(vec3(0));
    const widac = fv(0);
    const polS = SEG_DRUTU / 2;
    If(wiaz.equal(uint(1)).and(zyjeI).and(zyjeJ), () => {
      If(L.greaterThan(uDx.mul(1.05)), () => {
        widac.assign(1);
        const herm = (t) => {
          const t2 = t * t, t3 = t2 * t;
          return A.pos.mul(2 * t3 - 3 * t2 + 1).add(A.t.mul(L.mul(t3 - 2 * t2 + t))).add(B.pos.mul(-2 * t3 + 3 * t2)).add(B.t.mul(L.mul(t3 - t2)));
        };
        for (let q = 0; q < SEG_DRUTU; q++) {
          If(s.equal(uint(q)), () => { p0.assign(herm(q / SEG_DRUTU)); p1.assign(herm((q + 1) / SEG_DRUTU)); });
        }
      });
    }).Else(() => {
      // Kikut: z węzła wzdłuż pręta, długość z hasza, lekko zagięty.
      const zI = s.lessThan(uint(polS));
      const E = { pos: v3(B.pos), t: v3(B.t.negate()) };
      If(zI, () => { E.pos.assign(A.pos); E.t.assign(A.t); });
      If(zI.and(zyjeI).or(zI.not().and(zyjeJ)), () => {
        widac.assign(1);
        const sl = uv_(select(zI, s, s.sub(uint(polS))));
        const dl = fv(uDx.mul(float(0.6).add(czesc(h, select(zI, uint(3), uint(11)), 255).mul(0.55))));
        const zag = v3(normalize(cross(E.t, vec3(u1(h, 1), u1(h, 9), u1(h, 17).add(0.01)))).mul(dl.mul(0.35)));
        const t0 = fv(float(sl).div(polS)), t1 = fv(float(sl.add(uint(1))).div(polS));
        p0.assign(E.pos.add(E.t.mul(dl.mul(t0))).add(zag.mul(t0.mul(t0))));
        p1.assign(E.pos.add(E.t.mul(dl.mul(t1))).add(zag.mul(t1.mul(t1))));
      });
    });
    If(widac.greaterThan(0.5), () => {
      const e = v3(p1.sub(p0));
      const l = fv(max(length(e), 1e-3));
      const en = v3(e.div(l));
      const g = v3(select(abs(en.z).lessThan(0.9), vec3(0, 0, 1), vec3(1, 0, 0)));
      const b = v3(normalize(cross(en, g)));
      const c = v3(cross(en, b));
      const th = fv(uDrutGrub.mul(czesc(h, 21, 31).mul(0.5).add(0.75)));
      P.assign(p0.add(p1).mul(0.5).add(en.mul(C.x.mul(l.mul(0.5).add(th.mul(0.6))))).add(b.mul(C.y.mul(th))).add(c.mul(C.z.mul(th))));
      Nw.assign(en.mul(nf.x).add(b.mul(nf.y)).add(c.mul(nf.z)));
    });
    if (varyingi) {
      vNd.assign(cameraViewMatrix.mul(vec4(Nw, 0)).xyz);
      // Stal z rdzą, rozrzut z hasza pręta.
      vKd.assign(vec3(0.075, 0.052, 0.04).mul(czesc(h, 25, 63).mul(0.5).add(0.8)));
    }
    return P;
  })();
  const box = new THREE.BoxGeometry(2, 2, 2);
  const geoD = new THREE.InstancedBufferGeometry();
  geoD.index = box.index;
  geoD.setAttribute('position', box.attributes.position);
  geoD.setAttribute('normal', box.attributes.normal);
  geoD.instanceCount = 2;
  const matD = new THREE.MeshLambertNodeMaterial();
  matD.name = 'WokDruty';
  matD.map = null;
  matD.positionNode = budujDrut({ varyingi: true });
  matD.castShadowPositionNode = budujDrut({ varyingi: false });
  matD.normalNode = normalize(vNd);
  matD.colorNode = vKd.mul(aoM.mul(0.5).add(0.5));
  matD.aoNode = mat.aoNode;
  const meshDruty = new THREE.Mesh(geoD, matD);
  meshDruty.name = 'WokDruty';
  meshDruty.frustumCulled = false;
  meshDruty.castShadow = true;
  meshDruty.receiveShadow = true;
  const matDG = new THREE.NodeMaterial();
  matDG.name = 'WokDrutyGleb';
  matDG.map = null;
  matDG.positionNode = budujDrut({ varyingi: false });
  matDG.colorNode = vec3(0);
  matDG.lights = false;
  const meshDrutyGleb = new THREE.Mesh(geoD, matDG);
  meshDrutyGleb.name = 'WokDrutyGleb';
  meshDrutyGleb.frustumCulled = false;

  let K = 0, nW = 0, dane = null;

  /** Dane prefraktury sceny (kawalki.js: zbudujKawalki) i pręty (wybierzZbrojenie albo null). Nowa geometria tego samego układu: bez nowego pipeline'u. */
  function wczytaj(kaw, zbr, n, dx) {
    if (kaw.K > MAXK || kaw.kawCzl.length > 2 * MAX || n > MAX) throw new Error(`kawałki: ${kaw.K} kawałków, ${kaw.kawCzl.length} członków, ${n} węzłów ponad pojemność ${MAX}`);
    dane = kaw;
    K = kaw.K;
    nW = n;
    aWez.array.set(kaw.kawWez);
    aInfo.array.set(kaw.kawInfo);
    aCzl.array.set(kaw.kawCzl);
    for (const a of [aWez, aInfo, aCzl]) a.needsUpdate = true;
    const ileD = zbr ? Math.min(zbr.ile, MAXD) : 0;
    if (ileD) aDruty.array.set(zbr.druty.subarray(0, 4 * ileD));
    aDruty.needsUpdate = true;
    geoD.instanceCount = Math.max(2, ileD * SEG_DRUTU);
    meshDruty.userData.ile = ileD;
    const g = kaw.geometria;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.pozycja, 3));
    geo.setAttribute('kawId', new THREE.BufferAttribute(g.id, 1));
    geo.setAttribute('kawOdlup', new THREE.BufferAttribute(g.odlup, 4, true));
    geo.setIndex(new THREE.BufferAttribute(g.indeksy, 1));
    const stara = mesh.geometry;
    mesh.geometry = geo;
    meshGleb.geometry = geo;
    stara.dispose();
    uKawN.value = K;
    kKawalki.setCount(Math.max(1, K));
    kKawPoziom.setCount(Math.max(1, n));
    // Próg pęknięcia: średnia odchyłka 0,14 dx, największa 0,4 dx. Mniej: kawałki pękają od drgań sprężystych, więcej: sztywny kawałek chowa zgniot.
    uProgSr2.value = (0.14 * dx) ** 2;
    uProgMax2.value = (0.4 * dx) ** 2;
    uDrutGrub.value = 0.08 * dx;
    reset();
  }

  /** Stan kawałków od zera (reset sceny): spoczynek, obrót jednostkowy, cały. */
  function reset() {
    if (!dane) return;
    const st = aStan.array;
    for (let k = 0; k < K; k++) {
      const b = 16 * k;
      st[b] = dane.kawRest[4 * k]; st[b + 1] = dane.kawRest[4 * k + 1]; st[b + 2] = dane.kawRest[4 * k + 2]; st[b + 3] = 0;
      st[b + 4] = 0; st[b + 5] = 0; st[b + 6] = 0; st[b + 7] = 1;
      st[b + 8] = 0; st[b + 9] = 0; st[b + 10] = 0; st[b + 11] = 0;
      st[b + 12] = dane.kawRest[4 * k]; st[b + 13] = dane.kawRest[4 * k + 1]; st[b + 14] = dane.kawRest[4 * k + 2]; st[b + 15] = 0;
    }
    aStan.needsUpdate = true;
    aPoziom.array.fill(0, 0, nW);
    for (let i = 0; i < nW; i++) if (dane.kawWez[4 * i] === BRAK) aPoziom.array[i] = dane.kawWez[4 * i + 1] === BRAK ? 2 : 1;
    aPoziom.needsUpdate = true;
  }

  return {
    mesh, meshGleb, meshDruty, meshDrutyGleb,
    kernele: { kKawalki, kKawPoziom }, lista: [kKawalki, kKawPoziom],
    atrybuty: { wez: aWez, info: aInfo, czl: aCzl, stan: aStan, poziom: aPoziom, druty: aDruty },
    uniformy: { uKawN, uProgSr2, uProgMax2, uDrutGrub, uProgWiaz, uOdlup },
    wczytaj, reset,
    get K() { return K; },
  };
}
