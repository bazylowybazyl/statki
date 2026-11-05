// Obraz dema wiązanych wokseli (docs/SPEC-woksele-zawalenia.md § 4, pakiet P3): kObraz, kGruz, materiał przez positionNode, cień, okluzja, ton.
// Wzorzec wyglądu: film z renderera programowego (.tmp/woksele-proto/proby4/obraz4.mjs + rys4.mjs, opcje mat2, normalSciany, zlom, tonZiarna, svRozerw), a nie opis w spec.
// Oświetlenie z rys4.mjs w jednostkach three: Lambert, słońce (1,05; 1; 0,92) · π, półkula (0,35; 0,375; 0,425) · π / (0,07; 0,075; 0,085) · π, ekspozycja 1,25, ACES Narkowicza, gamma 2,2.
// Pył, błysk i kłąb (§ 4.6, § 4.8, P4): pyl.js, własny cel około 720 wierszy, składa je kwad wyjścia. Żar na węzłach: bufor wZar z kKrater, emisja z wierzchołka.
//
// Układ id instancji (§ 4): id < n to slot 0 (blok) węzła id; id ≥ n: i = (id − n) / 6, s = 1 + (id − n) % 6: 1–5 odłamki, 6 pręt. Slot nieaktywny zapada się do punktu.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, Continue, instanceIndex, storage, uniform, uint, float, vec2, vec3, vec4,
  countOneBits, floatBitsToUint, sqrt, max, min, dot, length, cross, normalize, clamp, smoothstep, sin, cos, abs, step, fract, fwidth, mix, pow,
  atomicAdd, positionGeometry, normalGeometry, varyingProperty, cameraViewMatrix, screenUV, texture, uv, output, positionView, positionWorld, getShadowMaterial,
} from 'three/tsl';
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js';
import { STRONA } from './budowa.js';
import { createWokselePyl } from './pyl.js';

export const L_ODLAMKI = 5;
export const WZORY = 64;
export const CAP_G = 40000;
const SLOTY = 6; // na węzeł poza blokiem: 5 odłamków i pręt
const RODZAJE = 6;
const ZAKLADKA = 0.51;
const ZAKLADKA_DYSK = 0.52; // § 4.2: cztery rogi na pokładzie zostawiają kropki przy 2%
const FAZA_D = 1e-3;
const KD_DYSK = 4;

// Paleta z obraz4.mjs (mat2): strop, kolumna, fasada, rdzeń, dysk, kotwica. Różnice mniejsze niż szum.
const PAL = [[0.2, 0.19, 0.17], [0.17, 0.162, 0.148], [0.105, 0.108, 0.112], [0.14, 0.135, 0.125], [0.17, 0.165, 0.15], [0.09, 0.09, 0.085]];
const PYLK = [0.2, 0.19, 0.175];
const OSI = [[0.25, 0.25, 0.5], [0.45, 0.45, 0.1], [0.45, 0.3, 0.25], [0.33, 0.33, 0.34], [0.25, 0.25, 0.5], [0.33, 0.33, 0.34]];

/** Hasz z obraz4.mjs. Bez Math.random: wzory i ton zależą tylko od numerów. */
function hasz(a) {
  let h = Math.imul(a ^ 0x9E3779B1, 0x85EBCA77);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE3D); h ^= h >>> 16;
  return h >>> 0;
}

/** Wzory k-d (§ 4.2, obraz2.mjs:42–68): `wynik[b]` = środek.xyz + hX, `wynik[b + 4]` = hY, hZ, objętość, 0. */
function zapiszWzory(wy, baza) {
  for (let kd = 0; kd < RODZAJE; kd++) for (let pt = 0; pt < WZORY; pt++) {
    let hh = hasz(kd * 1000 + pt);
    const nast = () => { hh = hasz(hh); return (hh & 0xffff) / 65536; };
    const liscie = [{ c: [0, 0, 0], h: [0.5, 0.5, 0.5] }];
    while (liscie.length < L_ODLAMKI) {
      let suma = 0;
      for (const q of liscie) suma += q.h[0] * q.h[1] * q.h[2];
      let r = nast() * suma, wyb = 0;
      for (let q = 0; q < liscie.length; q++) { r -= liscie[q].h[0] * liscie[q].h[1] * liscie[q].h[2]; if (r <= 0) { wyb = q; break; } }
      const li = liscie[wyb], o = OSI[kd];
      const w0 = o[0] * li.h[0] ** 2, w1 = o[1] * li.h[1] ** 2, w2 = o[2] * li.h[2] ** 2;
      const rr = nast() * (w0 + w1 + w2);
      const os = rr < w0 ? 0 : rr < w0 + w1 ? 1 : 2;
      const f = 0.3 + 0.4 * nast();
      const dl = 2 * li.h[os];
      const a = { c: li.c.slice(), h: li.h.slice() }, b = { c: li.c.slice(), h: li.h.slice() };
      a.h[os] = (dl * f) / 2; b.h[os] = (dl * (1 - f)) / 2;
      a.c[os] = li.c[os] - li.h[os] + a.h[os]; b.c[os] = li.c[os] + li.h[os] - b.h[os];
      liscie[wyb] = a; liscie.push(b);
    }
    for (let l = 0; l < L_ODLAMKI; l++) {
      const q = baza + 8 * ((kd * WZORY + pt) * L_ODLAMKI + l);
      const c = liscie[l].c, h = liscie[l].h;
      wy[q] = c[0]; wy[q + 1] = c[1]; wy[q + 2] = c[2]; wy[q + 3] = h[0];
      wy[q + 4] = h[1]; wy[q + 5] = h[2]; wy[q + 6] = 8 * h[0] * h[1] * h[2]; wy[q + 7] = 0;
    }
  }
}

export function createWokseleObraz({ solver, camera, aoTryb = 'film' }) {
  const MAX = solver.maxNodes;
  const A = solver.atrybuty;
  const { uN, uGStala, uSkG, uGruntZ } = solver.uniformy;

  // ── Bufory ── wRama [3i]: F0 + d, F1 + lost, F2 + bity odłamków, które poszły do puli gruzu. wDane [2i]: pozycja początkowa + ton ziarna, [2i + 1]: barwa + flagi, od BAZA_WZ wzory.
  const BAZA_WZ = 2 * MAX;
  const ILE_WZ = 2 * RODZAJE * WZORY * L_ODLAMKI;
  const aRama = new THREE.StorageInstancedBufferAttribute(new Float32Array(4 * 3 * MAX), 4);
  const aDane = new THREE.StorageInstancedBufferAttribute(new Float32Array(4 * (BAZA_WZ + ILE_WZ)), 4);
  const aCzastki = new THREE.StorageInstancedBufferAttribute(new Float32Array(4 * 2 * CAP_G), 4);
  const aLicz = new THREE.StorageInstancedBufferAttribute(new Uint32Array(1), 1);
  zapiszWzory(aDane.array, 4 * BAZA_WZ);

  const wWezR = storage(A.wez, 'vec4', 3 * MAX).setName('wokWez').toReadOnly();
  const wStanR = storage(A.stan, 'vec4', 4 * MAX).setName('wokStan').toReadOnly();
  const wMaskaR = storage(A.maska, 'uint', 2 * MAX).setName('wokMaska').toReadOnly();
  const wWiazR = storage(A.wiaz, 'vec4', STRONA * 2 * MAX).setName('wokWiaz').toReadOnly();
  const wRamaW = storage(aRama, 'vec4', 3 * MAX).setName('wokRama');
  const wRamaR = storage(aRama, 'vec4', 3 * MAX).setName('wokRama').toReadOnly();
  const wDaneR = storage(aDane, 'vec4', BAZA_WZ + ILE_WZ).setName('wokDane').toReadOnly();
  const wCzastkiW = storage(aCzastki, 'vec4', 2 * CAP_G).setName('wokCzastki');
  const wCzastkiR = storage(aCzastki, 'vec4', 2 * CAP_G).setName('wokCzastki').toReadOnly();
  const wLiczA = storage(aLicz, 'uint', 1).setName('wokLiczObraz').toAtomic();
  const wZarR = storage(A.zar, 'float', MAX).setName('wokZar').toReadOnly();

  const uKlatka = uniform(0).setName('uObrKlatka'); // numer następnej klatki fizyki: wiek żaru i błysku
  const uZarMoc = uniform(0.7).setName('uZarMoc');
  const uTau = uniform(0).setName('uTau');
  const uDx = uniform(20).setName('uObrDx');
  const uLimD = uniform(4 / 60).setName('uLimD');
  const uDt = uniform(1 / 60).setName('uObrDt');
  const uRDysk = uniform(0).setName('uRDysk');
  const uPokladZ = uniform(-1e30).setName('uPokladZ');
  const uOtworR2 = uniform(0).setName('uOtworR2');
  const uDyskR2 = uniform(0).setName('uDyskR2');
  // LOD obrazu (docs/PLAN-zawalenia-lod-miasto.md, metoda G). Sloty na węzeł z parametru sceny: 7 (blok, 5 odłamków, pręt), 2 (dwa kawałki po uszkodzeniu), 1 (sam blok, po uszkodzeniu kurczący się kawałek). Osobno dla rysunku i głębi oraz dla mapy cienia, bez nowego pipeline'u.
  const uSloty = uniform(7, 'uint').setName('uObrSloty');
  const uSlotyCien = uniform(7, 'uint').setName('uObrSlotyCien');

  const fv = (e) => { const v = float(0).toVar(); v.assign(e); return v; };
  const uv_ = (e) => { const v = uint(0).toVar(); v.assign(e); return v; };
  const v3 = (e) => { const v = vec3(0).toVar(); v.assign(e); return v; };
  const v4 = (e) => { const v = vec4(0).toVar(); v.assign(e); return v; };

  const haszT = (a) => {
    const h = uv_(a.bitXor(uint(0x9E3779B1)).mul(uint(0x85EBCA77)));
    h.assign(h.bitXor(h.shiftRight(uint(13))).mul(uint(0xC2B2AE3D)));
    return uv_(h.bitXor(h.shiftRight(uint(16))));
  };
  const u1 = (h, s) => float(h.shiftRight(uint(s)).bitAnd(uint(1023))).div(511.5).sub(1);
  const czesc = (h, s, maska) => float(h.shiftRight(uint(s)).bitAnd(uint(maska))).div(maska);
  const naRame = (Fx, Fy, Fz, w) => Fx.mul(w.x).add(Fy.mul(w.y)).add(Fz.mul(w.z));
  const flagi = (i) => uv_(uint(wDaneR.element(uint(2).mul(i).add(uint(1))).w));
  const sasiad = (i, d) => uv_(floatBitsToUint(wWiazR.element(uint(36).mul(i).add(uint(2 * d + 1))).z).bitAnd(uint(0xffffff)));

  // ── kObraz, § 4.1, raz na krok fizyki ── Rama z żywych wiązań osiowych, dObraz z limitem wzrostu, odłamki odpadające do puli gruzu (§ 4.5).
  const kObraz = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uN), () => { Return(); });
    const i3 = uv_(uint(3).mul(i));
    const p = v4(wWezR.element(i3));
    If(p.w.lessThan(0), () => { Return(); });
    const xi = v3(p.xyz);
    const vi = v3(wWezR.element(i3.add(uint(1))).xyz);
    const mI = uv_(wMaskaR.element(i));
    const fl = flagi(i);
    const kd = uv_(fl.shiftRight(uint(2)).bitAnd(uint(7)));
    const m0 = uv_(fl.shiftRight(uint(5)).bitAnd(uint(63)));
    const sz = fv(wStanR.element(i).x);
    const iN0 = fv(wStanR.element(uN.mul(uint(2)).add(uint(2).mul(i))).w);
    const lost = fv(float(1).sub(float(countOneBits(mI)).mul(iN0)));
    const axL = fv(float(1).sub(float(countOneBits(mI.bitAnd(uint(63)))).div(max(float(countOneBits(m0)), 1))));
    const kS = fv(0.35);
    If(kd.equal(uint(KD_DYSK)), () => { kS.assign(0.9); });
    const sv = fv(max(max(lost.mul(0.8), axL), kS.mul(sz)));
    If(sz.greaterThan(0.99), () => { sv.assign(max(sv, 0.75)); });
    If(axL.greaterThan(0), () => { sv.assign(max(sv, 0.5)); });

    const f0 = v4(wRamaW.element(i3));
    const f1 = v4(wRamaW.element(i3.add(uint(1))));
    const f2 = v4(wRamaW.element(i3.add(uint(2))));
    const dN = fv(f0.w.add(clamp(smoothstep(0.3, 0.95, sv).sub(f0.w), 0, uLimD)));

    // Kolumny ramy z żywych wiązań osiowych. Oś bez wiązań: iloczyn wektorowy dwóch pozostałych albo dopełnienie prostopadłe do jedynej znanej, zaczęte od starej kolumny, więc bez przeskoku.
    const F = [v3(f0.xyz), v3(f1.xyz), v3(f2.xyz)];
    const ma = [uv_(uint(0)), uv_(uint(0)), uv_(uint(0))];
    for (let a = 0; a < 3; a++) {
      const bp = uv_(mI.shiftRight(uint(2 * a)).bitAnd(uint(1)));
      const bm = uv_(mI.shiftRight(uint(2 * a + 1)).bitAnd(uint(1)));
      If(bp.add(bm).greaterThan(uint(0)), () => {
        const xp = v3(xi);
        const xm = v3(xi);
        If(bp.equal(uint(1)), () => { xp.assign(wWezR.element(uint(3).mul(sasiad(i, 2 * a))).xyz); });
        If(bm.equal(uint(1)), () => { xm.assign(wWezR.element(uint(3).mul(sasiad(i, 2 * a + 1))).xyz); });
        const f = v3(xp.sub(xm).div(float(bp.add(bm)).mul(uDx)));
        const dl = fv(max(length(f), 1e-6));
        If(dl.greaterThan(1.25), () => { f.mulAssign(float(1.25).div(dl)); }).ElseIf(dl.lessThan(0.55), () => { f.mulAssign(float(0.55).div(dl)); });
        F[a].assign(f);
        ma[a].assign(uint(1));
      });
    }
    If(ma[0].add(ma[1]).add(ma[2]).equal(uint(0)), () => {
      // Samotny: obrót starej ramy wokół osi z hasza o |v|·dt / (0,9·dx), kąt rośnie tylko, gdy węzeł się rusza, więc hałda stoi. Potem ortogonalizacja.
      const h = haszT(i.add(uint(12345)));
      const os = v3(normalize(vec3(u1(h, 0), u1(h, 10), u1(h, 20).add(1e-3))));
      const ka = fv(length(vi).mul(uDt).div(uDx.mul(0.9)));
      const c = fv(cos(ka));
      const s = fv(sin(ka));
      const obroc = (w) => w.mul(c).add(cross(os, w).mul(s)).add(os.mul(dot(os, w).mul(float(1).sub(c))));
      const nx = v3(normalize(obroc(F[0])));
      const ny0 = v3(obroc(F[1]));
      const ny = v3(normalize(ny0.sub(nx.mul(dot(nx, ny0)))));
      F[0].assign(nx);
      F[1].assign(ny);
      F[2].assign(cross(nx, ny));
    }).Else(() => {
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3, c = (a + 2) % 3;
        If(ma[a].equal(uint(0)), () => {
          If(ma[b].add(ma[c]).equal(uint(2)), () => {
            F[a].assign(cross(F[b], F[c]));
          }).Else(() => {
            const e = v3(F[b]);
            If(ma[b].equal(uint(0)), () => { e.assign(F[c]); });
            const eN = v3(normalize(e));
            const q = v3(F[a].sub(eN.mul(dot(F[a], eN))));
            F[a].assign(normalize(q.add(vec3(1e-5, 2e-5, 3e-5))));
          });
          ma[a].assign(uint(1));
        });
      }
    });

    // Drobne odłamki odpadają do puli gruzu (§ 4.5). Los z hasza i progu Sv: stały na odłamek, więc emisja najwyżej raz.
    const bity = uv_(uint(f2.w));
    If(sv.greaterThan(0.5), () => {
      const hN = haszT(i);
      const bazaWz = uv_(kd.mul(uint(WZORY)).add(hN.bitAnd(uint(WZORY - 1))).mul(uint(L_ODLAMKI)));
      Loop({ start: uint(0), end: uint(L_ODLAMKI), type: 'uint', condition: '<', name: 'lz' }, ({ lz }) => {
        If(bity.shiftRight(lz).bitAnd(uint(1)).equal(uint(1)), () => { Continue(); });
        const qw = uv_(uint(BAZA_WZ).add(uint(2).mul(bazaWz.add(lz))));
        const w2 = v4(wDaneR.element(qw.add(uint(1))));
        If(w2.z.greaterThan(0.1), () => { Continue(); });
        const hId = haszT(uint(L_ODLAMKI).mul(i).add(lz).add(uint(555)));
        If(float(hId.bitAnd(uint(1023))).div(1023).greaterThanEqual(sv.sub(0.5).mul(0.05)), () => { Continue(); });
        bity.assign(bity.bitOr(uint(1).shiftLeft(lz)));
        const w1 = v4(wDaneR.element(qw));
        const h2 = haszT(uint(L_ODLAMKI).mul(i).add(lz).add(uint(777)));
        const q = uv_(atomicAdd(wLiczA.element(uint(0)), uint(1)).mod(uint(CAP_G)));
        const poz = v3(xi.add(naRame(F[0], F[1], F[2], w1.xyz).mul(uDx)));
        const rozm = fv(w1.w.add(w2.x).add(w2.y).div(3).mul(uDx).mul(0.9));
        wCzastkiW.element(uint(2).mul(q)).assign(vec4(poz, rozm));
        wCzastkiW.element(uint(2).mul(q).add(uint(1))).assign(vec4(vi.add(vec3(u1(h2, 0).mul(80), u1(h2, 10).mul(80), u1(h2, 20).mul(60))), float(i)));
      });
    });

    // Brzeg otworu dysku (§ 4.5): węzeł pokładu przy pierwszej utracie wiązania wyrzuca 1–3 kawałki w górę i na zewnątrz, 40–120 j./s. Cel: pas gruzu szerszy niż pas kruszenia.
    // AGENT: tylko górna warstwa, co czwarty węzeł i blisko otworu: z każdego węzła dysku pod dyskiem sypał się deszcz równych kostek (.tmp/woksele-demo/P3/j_S3_t3.00.png).
    If(kd.equal(uint(KD_DYSK)).and(lost.greaterThan(0)).and(bity.bitAnd(uint(32)).equal(uint(0))), () => {
      bity.assign(bity.bitOr(uint(32)));
      const h3 = haszT(i.add(uint(4242)));
      const ile = uv_(min(h3.bitAnd(uint(3)).add(uint(1)), uint(3)));
      If(xi.z.lessThan(uPokladZ.sub(30)).or(h3.shiftRight(uint(4)).bitAnd(uint(3)).notEqual(uint(0))).or(dot(xi.xy, xi.xy).greaterThan(uOtworR2.mul(9))), () => { ile.assign(uint(0)); });
      const rd = v3(vec3(xi.x, xi.y, 0));
      rd.assign(rd.div(max(length(rd), 1)));
      Loop({ start: uint(0), end: ile, type: 'uint', condition: '<', name: 'kd2' }, ({ kd2 }) => {
        const hk = haszT(h3.add(kd2));
        const sila = fv(float(40).add(czesc(hk, 2, 255).mul(80)));
        const q = uv_(atomicAdd(wLiczA.element(uint(0)), uint(1)).mod(uint(CAP_G)));
        const poz = v3(xi.add(vec3(u1(hk, 4).mul(8), u1(hk, 14).mul(8), uDx.mul(0.6))));
        const v = v3(vi.add(rd.mul(sila.mul(float(0.4).add(czesc(hk, 10, 63).mul(0.8))))).add(vec3(u1(hk, 16).mul(25), u1(hk, 20).mul(25), sila.mul(float(0.5).add(czesc(hk, 24, 63).mul(0.5))))));
        wCzastkiW.element(uint(2).mul(q)).assign(vec4(poz, float(2.5).add(czesc(hk, 26, 31).mul(5.5))));
        wCzastkiW.element(uint(2).mul(q).add(uint(1))).assign(vec4(v, float(i)));
      });
    });

    wRamaW.element(i3).assign(vec4(F[0], dN));
    wRamaW.element(i3.add(uint(1))).assign(vec4(F[1], lost));
    wRamaW.element(i3.add(uint(2))).assign(vec4(F[2], float(bity)));
  })().compute(MAX).setName('wokObraz');

  // ── kGruz, § 4.5 ── Balistyka w polu sceny, grunt z tłumieniem 0,75, bez kontaktu z hałdą. Stałe pole wystarcza w scenach dema: gałęzi punktu i obrotu tu nie ma (AGENT: planetoida z § 10.4 doda je przez uGPunktG).
  const kGruz = Fn(() => {
    const q2 = uv_(uint(2).mul(instanceIndex));
    const a = v4(wCzastkiW.element(q2));
    If(a.w.lessThanEqual(0), () => { Return(); });
    const b = v4(wCzastkiW.element(q2.add(uint(1))));
    const v = v3(b.xyz.add(uGStala.mul(uSkG).mul(uDt)));
    const x = v3(a.xyz.add(v.mul(uDt)));
    const zG = fv(uGruntZ.add(2));
    If(x.z.lessThan(zG), () => {
      x.z.assign(zG);
      v.assign(vec3(v.x.mul(0.75), v.y.mul(0.75), 0));
    });
    // Płaszczyzna pokładu (§ 4.5): gruz leży na dysku poza kołem otworu, reszta leci przez otwór. Bez kontaktu z bryłami.
    const r2 = fv(dot(x.xy, x.xy));
    If(a.z.greaterThanEqual(uPokladZ).and(x.z.lessThan(uPokladZ)).and(r2.lessThan(uDyskR2)).and(r2.greaterThan(uOtworR2)), () => {
      x.z.assign(uPokladZ);
      v.assign(vec3(v.x.mul(0.75), v.y.mul(0.75), 0));
    });
    wCzastkiW.element(q2).assign(vec4(x, a.w));
    wCzastkiW.element(q2.add(uint(1))).assign(vec4(v, b.w));
  })().compute(CAP_G).setName('wokGruz');

  const kernele = { kObraz, kGruz };
  const listaObrazu = [kObraz, kGruz];

  // ── Geometria ── Sześcian o 24 wierzchołkach z indeksem, każda ściana z własną normalną (§ 4). InstancedBufferGeometry, nie InstancedMesh (pułapka 24).
  const box = new THREE.BoxGeometry(2, 2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = box.index;
  geo.setAttribute('position', box.attributes.position);
  geo.setAttribute('normal', box.attributes.normal);
  geo.instanceCount = 2;
  const geoGruz = new THREE.InstancedBufferGeometry();
  geoGruz.index = box.index;
  geoGruz.setAttribute('position', box.attributes.position);
  geoGruz.setAttribute('normal', box.attributes.normal);
  geoGruz.instanceCount = CAP_G;
  const geoGleb = new THREE.InstancedBufferGeometry();
  geoGleb.index = box.index;
  geoGleb.setAttribute('position', box.attributes.position);
  geoGleb.setAttribute('normal', box.attributes.normal);
  geoGleb.instanceCount = 2;

  // Szum rogu z hasza odłamka i numeru rogu: róg dzielony przez trzy ściany ma ten sam szum, więc bryła jest zamknięta. Wklejane, woła się tylko w Fn.
  const numerRogu = (k) => uv_(uint(step(0, k.x)).add(uint(step(0, k.y)).mul(uint(2))).add(uint(step(0, k.z)).mul(uint(4))));
  const szumRogu = (hl, k, jit) => {
    const hc = uv_(hl.bitXor(numerRogu(k).mul(uint(2654435761)).add(uint(97))).mul(uint(0x5bd1e995)));
    hc.assign(hc.bitXor(hc.shiftRight(uint(15))));
    return vec3(
      float(hc.bitAnd(uint(255))).div(127.5).sub(1),
      float(hc.shiftRight(uint(8)).bitAnd(uint(255))).div(127.5).sub(1),
      float(hc.shiftRight(uint(16)).bitAnd(uint(255))).div(127.5).sub(1),
    ).mul(jit);
  };

  const vN = varyingProperty('vec3', 'vWokN');
  const vK = varyingProperty('vec3', 'vWokK');
  const vP = varyingProperty('vec3', 'vWokP');
  const vE = varyingProperty('vec3', 'vWokE');

  // ── Wierzchołek, § 4.2 ── Najpierw odczyt d, maski i flag, reszta w gałęzi aktywnego slotu. Zmienne przypisane przed rozgałęzieniem (pułapka 39), varyingi na końcu.
  // uK: sloty na węzeł tego przebiegu. Układ id z § 4 przy każdym K: id < n to slot 0 węzła id, dalej i = (id − n) / (K − 1), s = 1 + (id − n) % (K − 1). Przy K = 7 to SLOTY = 6 jak dotąd.
  const budujPozycje = ({ varyingi, prety, uK = uSloty }) => Fn(() => {
    const id = uv_(instanceIndex);
    const i = uv_(id);
    const s = uv_(uint(0));
    If(id.greaterThanEqual(uN), () => {
      const r = uv_(id.sub(uN));
      const kPoza = uv_(max(uK, uint(2)).sub(uint(1))); // przy K = 1 tu nie wchodzi: instancji jest n
      i.assign(r.div(kPoza));
      s.assign(uint(1).add(r.sub(i.mul(kPoza))));
    });
    const C = v3(positionGeometry);
    const nf = v3(normalGeometry);
    const i3 = uv_(uint(3).mul(i));
    const pw = v4(wWezR.element(i3));
    const P = v3(pw.xyz);
    const Nw = v3(vec3(0, 0, 1));
    const Kol = v3(vec3(0));
    const P0 = v3(vec3(0));

    If(pw.w.greaterThanEqual(0), () => {
      const f0 = v4(wRamaR.element(i3));
      const d = fv(f0.w);
      const mI = uv_(wMaskaR.element(i));
      const mA = uv_(mI.bitAnd(uint(63)));
      const x = v3(pw.xyz.add(wWezR.element(i3.add(uint(1))).xyz.mul(uTau)));
      const Fx = v3(f0.xyz);

      // Wspólny koniec kawałka: środek z rozjazdem, obrót, szum rogów, a w rysunku normalna ściany z przekątnych (§ 4.2, nie normalFlat: każdy trójkąt inną dałby „złożoną kartkę”) i barwa. O0 i h w komórkach, hl: hasz kawałka.
      const zlozKawalek = (O0, h, rozj, katK, hl, Fy, Fz, f1, d0, d1) => {
        const O = v3(O0.mul(uDx).mul(rozj).add(vec3(u1(hl, 0), u1(hl, 10), u1(hl, 20)).mul(d.mul(uDx).mul(0.08))));
        const os = v3(normalize(vec3(u1(hl, 1), u1(hl, 11), u1(hl, 21).add(1e-3))));
        const c = fv(cos(katK));
        const sn = fv(sin(katK));
        const obroc = (w) => w.mul(c).add(cross(os, w).mul(sn)).add(os.mul(dot(os, w).mul(float(1).sub(c))));
        const sc2 = fv(uDx.mul(float(1).sub(d.mul(0.1))));
        const jit = fv(d.mul(0.4));
        const rog = (k) => k.add(szumRogu(hl, k, jit)).mul(h).mul(sc2);
        const q = v3(obroc(rog(C)));
        P.assign(x.add(naRame(Fx, Fy, Fz, O.add(q))));
        if (varyingi) {
          const t = v3(abs(nf.zxy));
          const b = v3(abs(nf.yzx));
          const r0 = v3(rog(nf.sub(t).sub(b)));
          const r1 = v3(rog(nf.add(t).sub(b)));
          const r2 = v3(rog(nf.add(t).add(b)));
          const r3 = v3(rog(nf.sub(t).add(b)));
          const n = v3(cross(r2.sub(r0), r3.sub(r1)).mul(nf.x.add(nf.y).add(nf.z)));
          Nw.assign(naRame(Fx, Fy, Fz, obroc(n)));
          const pylM = fv(d.mul(0.15));
          const lq = fv(min(f1.w.mul(3), 1));
          const tonZ = fv(float(1).add(d0.w.sub(1).mul(lq)));
          const r = fv(tonZ.mul(float(0.94).add(czesc(hl, 3, 63).mul(0.12))).mul(float(1).sub(d.mul(0.14))));
          Kol.assign(mix(d1.xyz, vec3(PYLK[0], PYLK[1], PYLK[2]), pylM).mul(r));
          P0.assign(d0.xyz.add(O).add(rog(C)));
        }
      };

      // LOD (K < 7): uszkodzony węzeł to kawałek zamiast pięciu odłamków z wzoru. K = 1: cała komórka. K = 2: komórka przecięta raz, w osi i miejscu z hasza węzła.
      // Przy d = 0 kawałki dają dokładnie blok z zakładką, więc wejście w uszkodzenie nie skacze. Dalej kurczą się z d (materiał poszedł w pył i do puli gruzu), rozjeżdżają i obracają.
      const kawalekLod = (nr) => {
        const f1 = v4(wRamaR.element(i3.add(uint(1))));
        const Fy = v3(f1.xyz);
        const Fz = v3(wRamaR.element(i3.add(uint(2))).xyz);
        const d0 = v4(wDaneR.element(uint(2).mul(i)));
        const d1 = v4(wDaneR.element(uint(2).mul(i).add(uint(1))));
        const hN = haszT(i);
        const hl = haszT(uint(L_ODLAMKI).mul(i).add(uint(nr)).add(uint(991)));
        const h = v3(vec3(ZAKLADKA));
        const O0 = v3(vec3(0));
        If(uK.greaterThan(uint(1)), () => {
          const t5 = uv_(hN.shiftRight(uint(5)));
          const osC = uv_(t5.sub(t5.div(uint(3)).mul(uint(3))));
          const fr = fv(float(0.35).add(czesc(hN, 8, 255).mul(0.3)));
          const pol = fv(nr === 0 ? fr.mul(0.5) : float(1).sub(fr).mul(0.5));
          const sr = fv(nr === 0 ? fr.sub(1).mul(0.5) : fr.mul(0.5));
          If(osC.equal(uint(0)), () => { h.x.assign(pol.add(0.01)); O0.x.assign(sr); })
            .ElseIf(osC.equal(uint(1)), () => { h.y.assign(pol.add(0.01)); O0.y.assign(sr); })
            .Else(() => { h.z.assign(pol.add(0.01)); O0.z.assign(sr); });
        });
        h.mulAssign(float(1).sub(d.mul(vec3(float(0.1).add(czesc(hl, 2, 63).mul(0.2)), float(0.1).add(czesc(hl, 8, 63).mul(0.2)), float(0.1).add(czesc(hl, 14, 63).mul(0.2))))));
        const rozj = fv(float(1).add(d.mul(0.5)));
        const katK = fv(d.mul(float(0.12).add(czesc(hl, 20, 255).mul(0.55))));
        zlozKawalek(O0, h, rozj, katK, hl, Fy, Fz, f1, d0, d1);
      };

      If(s.equal(uint(0)), () => {
        If(d.lessThanEqual(FAZA_D).and(mA.notEqual(uint(63))), () => {
          const f1 = v4(wRamaR.element(i3.add(uint(1))));
          const Fy = v3(f1.xyz);
          const Fz = v3(wRamaR.element(i3.add(uint(2))).xyz);
          const d0 = v4(wDaneR.element(uint(2).mul(i)));
          const d1 = v4(wDaneR.element(uint(2).mul(i).add(uint(1))));
          const fl = uv_(uint(d1.w));
          const zak = fv(ZAKLADKA);
          If(fl.shiftRight(uint(2)).bitAnd(uint(7)).equal(uint(KD_DYSK)), () => { zak.assign(ZAKLADKA_DYSK); });
          const off = v3(C.mul(zak).mul(uDx));
          const nL = v3(nf);
          // Wieniec dysku (§ 4.2): rogi przy brzegu dociągnięte do promienia R, ściany boczne z normalną promieniową. Rogi liczone z pozycji, więc sąsiednie bloki dzielą ten sam punkt.
          If(uRDysk.lessThan(1e8), () => {
            const pr = vec2(0).toVar();
            pr.assign(d0.xy.add(off.xy));
            const rr = fv(max(length(pr), 1));
            If(rr.greaterThan(uRDysk.sub(uDx.mul(0.5))), () => {
              const skK = fv(uRDysk.div(rr).sub(1));
              off.assign(vec3(off.x.add(pr.x.mul(skK)), off.y.add(pr.y.mul(skK)), off.z));
              If(abs(nf.z).lessThan(0.5), () => { nL.assign(vec3(pr.div(rr), 0)); });
            });
          });
          P.assign(x.add(naRame(Fx, Fy, Fz, off)));
          // Normalna z osi w płaszczyźnie ściany, nie z osi prostopadłej: ta na powierzchni jest różnicą jednostronną i jej szum daje kratkę na nienaruszonym pokładzie (§ 7).
          Nw.assign(cross(Fy, Fz).mul(nL.x).add(cross(Fz, Fx).mul(nL.y)).add(cross(Fx, Fy).mul(nL.z)));
          const ton = fv(float(1).add(d0.w.sub(1).mul(min(f1.w.mul(3), 1))));
          Kol.assign(d1.xyz.mul(ton));
          P0.assign(d0.xyz.add(off));
        }).ElseIf(d.greaterThan(FAZA_D).and(uK.lessThan(uint(7))), () => { kawalekLod(0); });
      }).ElseIf(s.equal(uint(6)), () => {
        if (prety) {
          // Pręt, § 4.2: tylko węzeł z wiązaniami, kolumna z, strop i dysk x albo y.
          If(d.greaterThan(0.3).and(mA.notEqual(uint(0))), () => {
            const d1 = v4(wDaneR.element(uint(2).mul(i).add(uint(1))));
            const kd = uv_(uint(d1.w).shiftRight(uint(2)).bitAnd(uint(7)));
            const hN = haszT(i);
            const tr = uv_(hN.shiftRight(uint(9)));
            If(tr.sub(tr.div(uint(3)).mul(uint(3))).equal(uint(0)).and(kd.notEqual(uint(2))).and(kd.notEqual(uint(5))), () => {
              const f = [Fx, v3(wRamaR.element(i3.add(uint(1))).xyz), v3(wRamaR.element(i3.add(uint(2))).xyz)];
              const e0 = v3(f[0]);
              const b0 = v3(f[1]);
              const c0 = v3(f[2]);
              If(kd.equal(uint(1)), () => { e0.assign(f[2]); b0.assign(f[0]); c0.assign(f[1]); })
                .ElseIf(hN.shiftRight(uint(13)).bitAnd(uint(1)).equal(uint(1)), () => { e0.assign(f[1]); b0.assign(f[2]); c0.assign(f[0]); });
              const rl = fv(uDx.mul(float(0.7).add(czesc(hN, 15, 63).mul(0.9))).mul(float(0.6).add(d.mul(0.4))));
              const th = fv(uDx.mul(0.07));
              const e = v3(e0.add(b0.mul(d.mul(0.5).mul(u1(hN, 5)))));
              P.assign(x.add(e.mul(C.x.mul(rl))).add(b0.mul(C.y.mul(th))).add(c0.mul(C.z.mul(th))));
              Nw.assign(normalize(e).mul(nf.x).add(b0.mul(nf.y)).add(c0.mul(nf.z)));
              Kol.assign(vec3(0.085, 0.06, 0.048)); // ciemniej niż w spec (0,2; 0,15; 0,12): na Zbliżeniu tamta barwa świeci łososiowo, zm. .tmp/woksele-demo/P3/zb_S1_t7.00.png
              P0.assign(wDaneR.element(uint(2).mul(i)).xyz);
            });
          });
        }
      }).ElseIf(uK.lessThan(uint(7)), () => {
        If(d.greaterThan(FAZA_D), () => { kawalekLod(1); });
      }).Else(() => {
        If(d.greaterThan(FAZA_D), () => {
          const l = uv_(s.sub(uint(1)));
          const hN = haszT(i);
          const samB = mA.equal(uint(0));
          const typS = uv_(uint(9));
          If(samB, () => {
            const t5 = uv_(hN.shiftRight(uint(5)));
            typS.assign(t5.sub(t5.div(uint(10)).mul(uint(10))));
          });
          const f2 = v4(wRamaR.element(i3.add(uint(2))));
          const widac = uv_(uint(1));
          If(typS.lessThan(uint(4)).and(l.greaterThan(uint(0))), () => { widac.assign(uint(0)); })
            .ElseIf(typS.lessThan(uint(8)).and(l.greaterThan(uint(1))), () => { widac.assign(uint(0)); });
          If(uint(f2.w).shiftRight(l).bitAnd(uint(1)).equal(uint(1)), () => { widac.assign(uint(0)); });
          If(widac.equal(uint(1)), () => {
            const f1 = v4(wRamaR.element(i3.add(uint(1))));
            const Fy = v3(f1.xyz);
            const Fz = v3(f2.xyz);
            const d0 = v4(wDaneR.element(uint(2).mul(i)));
            const d1 = v4(wDaneR.element(uint(2).mul(i).add(uint(1))));
            const kd = uv_(uint(d1.w).shiftRight(uint(2)).bitAnd(uint(7)));
            const qw = uv_(uint(BAZA_WZ).add(uint(2).mul(kd.mul(uint(WZORY)).add(hN.bitAnd(uint(WZORY - 1))).mul(uint(L_ODLAMKI)).add(l))));
            const w1 = v4(wDaneR.element(qw));
            const w2 = v4(wDaneR.element(qw.add(uint(1))));
            const hl = haszT(uint(L_ODLAMKI).mul(i).add(l).add(uint(991)));
            const h = v3(vec3(w1.w, w2.x, w2.y));
            const rozj = fv(float(1).add(d.mul(d).mul(0.18)));
            const katK = fv(d.mul(d).mul(float(0.12).add(czesc(hl, 12, 255).mul(0.4))));
            If(samB, () => {
              rozj.assign(float(1).add(d.mul(0.3)));
              katK.assign(d.mul(float(0.12).add(czesc(hl, 12, 255).mul(0.55))));
            });
            If(typS.lessThan(uint(4)), () => {
              // Bryła: pierwszy odłamek rośnie do całej komórki, reszta znika.
              const skB = fv(float(0.72).add(czesc(hN, 17, 63).mul(0.5)));
              h.assign(vec3(float(0.32).add(czesc(hl, 2, 31).mul(0.2)), float(0.32).add(czesc(hl, 7, 31).mul(0.2)), float(0.28).add(czesc(hl, 12, 31).mul(0.2))).mul(skB));
              rozj.assign(0);
            }).ElseIf(typS.greaterThanEqual(uint(8)).and(samB), () => { rozj.assign(1.7); });
            zlozKawalek(w1.xyz, h, rozj, katK, hl, Fy, Fz, f1, d0, d1);
          });
        });
      });
    });
    if (varyingi) {
      // Żar (§ 4.8, obraz5.mjs): 1 s gaśnięcia od pomarańczu do ciemnej czerwieni, emisja > 1 tylko przez 0,3 s, rozrzut z hasza: żarzą się krawędzie i odłamki, a nie jednolita łata.
      const eE = v3(vec3(0));
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
      vN.assign(cameraViewMatrix.mul(vec4(Nw, 0)).xyz);
      vK.assign(Kol);
      vP.assign(P0);
      vE.assign(eE);
    }
    return P;
  })();

  // Szum wartości 3D z hasza, na liczbach całkowitych, bez sin (stabilny także dla pozycji około 1000 j.). Wklejane, tylko w Fn.
  const szum3 = (p) => {
    const i = vec3(0).toVar();
    i.assign(p.floor());
    const f = vec3(0).toVar();
    f.assign(p.sub(i));
    const u = vec3(0).toVar();
    u.assign(f.mul(f).mul(f.mul(-2).add(3)));
    const baza = uv_(uint(i.x.add(4096)).mul(uint(73856093)).bitXor(uint(i.y.add(4096)).mul(uint(19349663))).bitXor(uint(i.z.add(4096)).mul(uint(83492791))));
    const rog = (a, b, c) => {
      const h = uv_(baza.add(uint(a * 73856093 + b * 19349663 + c * 83492791 >>> 0)).mul(uint(0x5bd1e995)));
      return float(h.bitXor(h.shiftRight(uint(15))).bitAnd(uint(1023))).div(1023);
    };
    const x00 = fv(mix(rog(0, 0, 0), rog(1, 0, 0), u.x));
    const x10 = fv(mix(rog(0, 1, 0), rog(1, 1, 0), u.x));
    const x01 = fv(mix(rog(0, 0, 1), rog(1, 0, 1), u.x));
    const x11 = fv(mix(rog(0, 1, 1), rog(1, 1, 1), u.x));
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
  };

  // Jasność z ciągłej pozycji początkowej (§ 4.2, obraz4.mjs:330), w fragmencie: bez mozaiki co 20 j. Do tego plamy i drobne ziarno betonu z tej samej pozycji: z bliska płyta inaczej jest plastikowa.
  // AGENT: rysy z izolinii szumu (warunek pokazu § 4.2) wyszły jak robaki na całym pokładzie i dawały kreski na szwach bloków, patrz .tmp/woksele-demo/P3/f_S3_t3.00.png. Rysy to przebieg do osobnej próby, nie izolinia.
  const barwaZP0 = Fn(() => {
    const p = v3(vP);
    const nz = fv(sin(p.x.mul(0.013).add(sin(p.y.mul(0.011)).mul(1.3))).mul(sin(p.z.mul(0.017).add(0.7))).mul(0.5).add(0.5));
    const plamy = fv(szum3(p.mul(0.045)));
    const drobne = fv(szum3(p.mul(0.34)));
    return vK.mul(nz.mul(0.16).add(0.92)).mul(plamy.sub(0.5).mul(0.16).add(1)).mul(drobne.sub(0.5).mul(0.08).add(1));
  });

  // ── Okluzja ── Przebieg głębi około 720 wierszy (najwyżej 2560 szerokości), tylko bryły, jak w rysunku wzorcowym: grunt nie zaciemnia i nie jest zaciemniany.
  // Domyślnie okluzja jak w filmie (rys4.mjs:201–221): 16 próbek w dwóch promieniach, promień z 14 j. w px, okno głębi 2–60 j. Bez szumu, więc bez odszumiania. ?ao=gtao: GTAONode z § 4.3.
  const rtGleb = new THREE.RenderTarget(2, 2, { depthBuffer: true, format: THREE.RedFormat, type: THREE.UnsignedByteType, depthTexture: new THREE.DepthTexture(2, 2) });
  rtGleb.texture.generateMipmaps = false;
  const glebNode = texture(rtGleb.depthTexture, vec2(0));
  const uAoTexel = uniform(new THREE.Vector2(1 / 960, 1 / 540)).setName('uAoTexel');
  const uAoFp = uniform(1).setName('uAoFp');
  const uAoMin = uniform(2).setName('uAoMin');
  const uAoMax = uniform(24).setName('uAoMax');
  const uNear = uniform(camera.near).setName('uObrNear');
  const uFar = uniform(camera.far).setName('uObrFar');
  const liniowa = (d) => uNear.mul(uFar).div(uFar.sub(d.mul(uFar.sub(uNear))));
  const pyl = createWokselePyl({ solver, A, MAX, wWezR, wRamaW, wDaneR, uTau, uDt, uKlatka, glebNode, liniowa, uFp: uAoFp });
  Object.assign(kernele, pyl.kernele);
  listaObrazu.push(...pyl.lista);
  let aoN = null;
  let aoTex = null;
  const rtSsao = new THREE.RenderTarget(2, 2, { depthBuffer: false, format: THREE.RedFormat, type: THREE.UnsignedByteType });
  rtSsao.texture.generateMipmaps = false;
  const matSsao = new THREE.NodeMaterial();
  matSsao.name = 'WokSsao';
  matSsao.fragmentNode = Fn(() => {
    const u = vec2(0).toVar();
    u.assign(uv());
    const zc = fv(liniowa(glebNode.sample(u).x));
    const rp = fv(clamp(uAoFp.mul(14).div(zc), uAoMin, uAoMax));
    const okl = fv(0);
    const K = 0.7071;
    for (const [px, py] of [[1, 0], [K, K], [0, 1], [-K, K], [-1, 0], [-K, -K], [0, -1], [K, -K]]) for (const sk of [0.45, 1]) {
      const s = vec2(0).toVar();
      s.assign(u.add(vec2(px * sk, py * sk).mul(rp).mul(uAoTexel)));
      const dz = fv(zc.sub(liniowa(glebNode.sample(s).x)));
      okl.addAssign(step(2, dz).mul(step(dz, 60)));
    }
    const a = fv(float(1).sub(min(okl.div(11), 1).mul(0.6)));
    return vec4(a, a, a, 1);
  })();
  const kwadSsao = new THREE.QuadMesh(matSsao);
  if (aoTryb === 'gtao') {
    aoN = gtao(glebNode, null, camera);
    aoN.resolutionScale = 0.5;
    aoN.radius.value = 26;
    aoN.thickness.value = 70;
    aoN.distanceExponent.value = 1.3;
    aoN.scale.value = 1.25;
    aoN.samples.value = 16;
    aoTex = aoN.getTextureNode();
  }

  // Sześć próbek krzyżem wygładza wzór szumu GTAO (kwadrat magiczny 5 × 5) bez osobnego przebiegu. Rozmiar tekstury AO w uniformie: zmiana okna nie zmienia grafu.
  const aoCzytaj = aoTryb !== 'gtao' ? Fn(() => texture(rtSsao.texture, screenUV).r) : Fn(() => {
    const u = vec2(screenUV).toVar();
    const a = float(0).toVar();
    a.addAssign(texture(aoTex, u).r.mul(2));
    a.addAssign(texture(aoTex, u.add(uAoTexel.mul(vec2(1.5, 0.5)))).r);
    a.addAssign(texture(aoTex, u.add(uAoTexel.mul(vec2(-1.5, -0.5)))).r);
    a.addAssign(texture(aoTex, u.add(uAoTexel.mul(vec2(0.5, -1.5)))).r);
    a.addAssign(texture(aoTex, u.add(uAoTexel.mul(vec2(-0.5, 1.5)))).r);
    return a.div(6);
  });

  // ── Materiał brył ── Lambert jak w rysunku wzorcowym: spec chciał Standard z metalem, ale bez mapy otoczenia metal jest czarny, a film go nie zna.
  const mat = new THREE.MeshLambertNodeMaterial();
  mat.name = 'WokBryly';
  mat.map = null;
  mat.positionNode = budujPozycje({ varyingi: true, prety: true });
  mat.castShadowPositionNode = budujPozycje({ varyingi: false, prety: false, uK: uSlotyCien });
  mat.normalNode = normalize(vN);
  const aoM = aoCzytaj().toVar('wokAo');
  // Film: otoczenie × a, słońce × (0,5 + 0,5·a). Stąd barwa × (0,5 + 0,5·a), a w aoNode reszta dla otoczenia.
  mat.colorNode = barwaZP0().mul(aoM.mul(0.5).add(0.5));
  mat.aoNode = aoM.div(aoM.mul(0.5).add(0.5));
  // Żar z wierzchołka + światło błysku na bryłach: najwyżej 4 najmocniejsze błyski, numery slotów i moc liczy CPU raz na klatkę, pozycje z wBlysk (nosiciel jedzie, CPU go nie zna). Bez błysku koszt to 4 porównania uniformów.
  // AGENT: poświata mała (2 r zamiast 3,5 r z obraz5.mjs) i nieokrągła: z góry dwa błyski na płaskim pokładzie wyglądały przez 0,1 s jak lampy, a duże światło przez okna jak plama (SPEC-S5-propozycja.md § 4, uwaga ze strojenia).
  const swiatla = Array.from({ length: 4 }, (_, k) => ({ s: uniform(0).setName(`uSwS${k}`), i: uniform(0).setName(`uSwI${k}`), r: uniform(1).setName(`uSwR${k}`) }));
  const wBlyskF = storage(A.blysk, 'vec4', 3 * solver.blyski).setName('wokBlysk').toReadOnly();
  mat.emissiveNode = Fn(() => {
    const e = v3(vE);
    const pw = v3(positionWorld);
    for (const { s, i: moc, r } of swiatla) {
      If(moc.greaterThan(0), () => {
        const s3 = uv_(uint(3).mul(uint(s)));
        const a = v4(wBlyskF.element(s3));
        const o = v3(pw.sub(a.xyz).div(r));
        // Mnożnik obrysu 0,55–1,65: przy niższym dolina sinusów sięgała daleko i zapalała pojedyncze plamy na kolumnach (.tmp/woksele-demo/P4/b/krater_t1.05.png).
        const q = fv(float(1).sub(dot(o, o).mul(sin(o.x.mul(4.3).add(a.w)).mul(sin(o.y.mul(3.7).sub(a.w))).mul(0.35).add(sin(o.z.mul(5.1).add(a.w.mul(2))).mul(0.2)).add(1.1))));
        If(q.greaterThan(0).and(wBlyskF.element(s3.add(uint(1))).w.greaterThan(0)), () => {
          e.addAssign(vec3(1, 0.5, 0.16).mul(moc.mul(0.14).mul(q).mul(q)));
        });
      });
    }
    return e;
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'WokBryly';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Pass cienia ma własny licznik instancji: three woła te haki tuż wokół rysunku w mapie cienia, a licznik czyta przy rysunku (RenderObject.getDrawParameters). Bez nowego pipeline'u.
  let instRysunek = 2, instCien = 2;
  mesh.onBeforeShadow = () => { geo.instanceCount = instCien; };
  mesh.onAfterShadow = () => { geo.instanceCount = instRysunek; };

  // ── Gruz, § 4.5 ── Osobny rysunek, bez cienia. Kąt zależy od drogi, więc staje razem z bryłą.
  const vKG = varyingProperty('vec3', 'vWokGK');
  const vNG = varyingProperty('vec3', 'vWokGN');
  const matGruz = new THREE.MeshLambertNodeMaterial();
  matGruz.name = 'WokGruz';
  matGruz.map = null;
  matGruz.positionNode = Fn(() => {
    const q = uv_(instanceIndex);
    const a = v4(wCzastkiR.element(uint(2).mul(q)));
    const b = v4(wCzastkiR.element(uint(2).mul(q).add(uint(1))));
    const hq = haszT(q);
    const C = v3(positionGeometry);
    const nf = v3(normalGeometry);
    const x = v3(a.xyz.add(b.xyz.mul(uTau)));
    const sk = v3(vec3(float(0.7).add(czesc(hq, 2, 63).mul(0.6)), float(0.7).add(czesc(hq, 8, 63).mul(0.6)), float(0.5).add(czesc(hq, 14, 63).mul(0.6))));
    const kat = fv(x.x.add(x.y).add(x.z).mul(0.02).mul(float(1).add(u1(hq, 20))));
    const os = v3(normalize(vec3(u1(hq, 1), u1(hq, 11), u1(hq, 21).add(1e-3))));
    const c = fv(cos(kat));
    const s = fv(sin(kat));
    const obroc = (w) => w.mul(c).add(cross(os, w).mul(s)).add(os.mul(dot(os, w).mul(float(1).sub(c))));
    const P = v3(a.xyz);
    If(a.w.greaterThan(0), () => { P.assign(x.add(obroc(C.mul(sk).mul(a.w)))); });
    const d1 = v4(wDaneR.element(uint(2).mul(uint(b.w)).add(uint(1))));
    vKG.assign(d1.xyz.mul(float(0.75).add(czesc(hq, 26, 31).mul(0.4))));
    vNG.assign(cameraViewMatrix.mul(vec4(obroc(nf), 0)).xyz);
    return P;
  })();
  matGruz.normalNode = normalize(vNG);
  matGruz.colorNode = vKG;
  const meshGruz = new THREE.Mesh(geoGruz, matGruz);
  meshGruz.name = 'WokGruz';
  meshGruz.frustumCulled = false;
  meshGruz.receiveShadow = true;

  // ── Grunt ── Baza z rys4.mjs: 0,17 · siatka · 0,96, cień 0,32 + 0,68 · światło. Lambert na płaszczyźnie daje to samo przy barwie / 1,087 (słońce 1,05 · 0,702 + otoczenie 0,35). Zanik w barwę dali jak na filmie.
  const uGruntWid = uniform(1).setName('uGruntWid');
  const matGrunt = new THREE.MeshLambertNodeMaterial();
  matGrunt.name = 'WokGrunt';
  matGrunt.map = null;
  const vPG = positionWorld;
  const siatkaOs = (x, okres, sz) => {
    const w = fv(max(fwidth(x), 1e-3));
    const d = fv(abs(fract(x.div(okres)).sub(0.5)).mul(okres));
    return smoothstep(okres * 0.5 - sz - 0.5, okres * 0.5 - sz + 0.5, d.add(w.mul(0.5))).mul(min(float(sz * 2).div(w), 1));
  };
  matGrunt.colorNode = Fn(() => {
    const px = fv(vPG.x);
    const py = fv(vPG.y);
    const lin = fv(max(siatkaOs(px, 100, 1), siatkaOs(py, 100, 1)));
    return vec3(0.17, 0.1734, 0.1802).mul(0.96 / 1.087).mul(lin.mul(0.08).add(1));
  })();
  matGrunt.outputNode = Fn(() => {
    const zan = fv(clamp(positionView.z.negate().sub(500).div(6000), 0, 1));
    return vec4(mix(output.rgb, vec3(0.03, 0.035, 0.045), zan), 1);
  })();
  const grunt = new THREE.Mesh(new THREE.PlaneGeometry(600000, 600000), matGrunt);
  grunt.name = 'WokGrunt';
  grunt.frustumCulled = false;
  grunt.receiveShadow = true;

  // ── Scena i światła § 4.3 ── Stały zestaw od startu (pułapka 34), gaszenie tylko natężeniem.
  const scene = new THREE.Scene();
  const SLONCE = new THREE.Vector3(0.55, -0.45, 0.7).normalize();
  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.05, 1.0, 0.92, THREE.LinearSRGBColorSpace), Math.PI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 2.0;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 16000;
  // Własny węzeł cienia, żeby rozgrzewka znała cel mapy (rozgrzej niżej). Domyślny three robi to samo, tylko niedostępny.
  const wezelCienia = new THREE.ShadowNode(sun);
  sun.shadow.shadowNode = wezelCienia;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(
    new THREE.Color().setRGB(0.35, 0.375, 0.425, THREE.LinearSRGBColorSpace),
    new THREE.Color().setRGB(0.07, 0.075, 0.085, THREE.LinearSRGBColorSpace),
    Math.PI,
  );
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  scene.add(grunt, mesh, meshGruz);

  // Przebieg głębi: te same pozycje (bez prętów, bez varyingów), bez świateł.
  const matGleb = new THREE.NodeMaterial();
  matGleb.name = 'WokGleb';
  matGleb.map = null;
  matGleb.positionNode = budujPozycje({ varyingi: false, prety: false });
  matGleb.colorNode = vec3(0);
  matGleb.lights = false;
  const meshGleb = new THREE.Mesh(geoGleb, matGleb);
  meshGleb.name = 'WokGleb';
  meshGleb.frustumCulled = false;
  const sceneGleb = new THREE.Scene();
  sceneGleb.add(meshGleb);

  // ── Cel HDR, MSAA 4 (§ 4.3) i wyjście: ekspozycja 1,25, ACES Narkowicza, gamma 2,2 jak w rys4.mjs. Bez posta gry: demo nie ma bloomu (§ 9). ──
  const rtHdr = new THREE.RenderTarget(2, 2, { depthBuffer: true, samples: 4, type: THREE.HalfFloatType });
  rtHdr.texture.generateMipmaps = false;
  const matWyj = new THREE.NodeMaterial();
  matWyj.name = 'WokWyjscie';
  matWyj.fragmentNode = Fn(() => {
    // Skład pyłu: (kolor · a, a) po kolei to to samo co mieszanie cząstka po cząstce w rys4.mjs, a błysk ma a = 0, więc dodaje się bez ściemniania tła.
    const pk = v4(texture(pyl.rt.texture, uv()));
    const v = v3(texture(rtHdr.texture, uv()).rgb.mul(float(1).sub(pk.a.mul(pyl.uSklad))).add(pk.rgb.mul(pyl.uSklad)).mul(1.25));
    const c = v3(clamp(v.mul(v.mul(2.51).add(0.03)).div(v.mul(v.mul(2.43).add(0.59)).add(0.14)), 0, 1));
    return vec4(pow(c, vec3(1 / 2.2)), 1);
  })();
  const wyj = new THREE.QuadMesh(matWyj);

  const TLO = new THREE.Color().setRGB(0.018, 0.022, 0.032, THREE.LinearSRGBColorSpace);

  let szer = 2, wys = 2;
  let n = 0;
  let slotyWez = 7, slotyCien = 7, jestPelny = false;

  /** Rozmiar celów. AO i głębia: połowa, najwyżej 2560 szerokości, żeby koszt nie rósł z pikselami bez limitu (§ 6.1). */
  function ustawRozmiar(renderer, w, h) {
    if (w === szer && h === wys) return;
    szer = w; wys = h;
    const skala = Math.min(1, 720 / h, 2560 / w);
    const hw = Math.max(2, Math.round(w * skala)), hh = Math.max(2, Math.round(h * skala));
    if (aoN) aoN.resolutionScale = skala;
    uAoTexel.value.set(1 / hw, 1 / hh);
    uAoFp.value = (hh / 2) / Math.tan((camera.fov * Math.PI) / 360);
    uAoMin.value = (2 * hh) / 720;
    uAoMax.value = (24 * hh) / 720;
    rtSsao.setSize(hw, hh);
    rtSsao.texture.needsUpdate = true;
    rtHdr.setSize(w, h);
    rtGleb.setSize(hw, hh);
    pyl.ustawRozmiar(renderer, hw, hh);
    rtHdr.texture.needsUpdate = true;
    rtGleb.texture.needsUpdate = true;
    rtGleb.depthTexture.needsUpdate = true;
    if (renderer.initRenderTarget) { renderer.initRenderTarget(rtHdr); renderer.initRenderTarget(rtGleb); renderer.initRenderTarget(rtSsao); }
  }

  /** Dane statyczne sceny i stan obrazu od zera: bez nowych pipeline'ów. */
  function wczytaj(w, { rDysk = 0, poklad = null, pyl: opcjePylu = null, lod = null } = {}) {
    pyl.wczytaj(w, opcjePylu);
    slotyWez = lod?.sloty ?? 7;
    slotyCien = lod?.cien ?? slotyWez;
    uKlatka.value = 0;
    uZarMoc.value = opcjePylu?.zar ?? 0.35;
    uPokladZ.value = poklad ? poklad.z : -1e30;
    uOtworR2.value = poklad ? poklad.rOtwor * poklad.rOtwor : 0;
    uDyskR2.value = poklad ? rDysk * rDysk : 0;
    n = w.n;
    uRDysk.value = rDysk > 0 ? rDysk : 1e9;
    const dane = aDane.array, rama = aRama.array;
    const m0 = w.flagi;
    for (let i = 0; i < n; i++) {
      const kd = (m0[i] >>> 2) & 7;
      const zi = w.ziarnoW[i];
      const hz = hasz((zi >>> 0) + 991);
      const b = 8 * i;
      dane[b] = w.pos[3 * i]; dane[b + 1] = w.pos[3 * i + 1]; dane[b + 2] = w.pos[3 * i + 2];
      dane[b + 3] = zi >= 0 ? 0.7 + (0.55 * (hz & 255)) / 255 : 1;
      // Wieniec dysku jest kotwicą, ale ciemna kotwica rysowałaby na pokładzie zygzak po komórkach.
      const kb = rDysk > 0 && kd === 5 ? 4 : kd;
      dane[b + 4] = PAL[kb][0]; dane[b + 5] = PAL[kb][1]; dane[b + 6] = PAL[kb][2]; dane[b + 7] = m0[i];
      const q = 12 * i;
      rama[q] = 1; rama[q + 1] = 0; rama[q + 2] = 0; rama[q + 3] = 0;
      rama[q + 4] = 0; rama[q + 5] = 1; rama[q + 6] = 0; rama[q + 7] = 0;
      rama[q + 8] = 0; rama[q + 9] = 0; rama[q + 10] = 1; rama[q + 11] = 0;
    }
    aDane.needsUpdate = true;
    aRama.needsUpdate = true;
    aCzastki.array.fill(0);
    aCzastki.needsUpdate = true;
    aLicz.array[0] = 0;
    aLicz.needsUpdate = true;
    kObraz.setCount(n);
    uDx.value = w.dx;
    pelnyObraz(false);
    const maGrunt = w.gruntZ > -1e20;
    grunt.visible = maGrunt;
    grunt.position.z = maGrunt ? w.gruntZ : 0;
    grunt.updateMatrixWorld();
    uGruntWid.value = maGrunt ? 1 : 0;
  }

  /** Stojąca wieża rysuje tylko sloty bloków: n wywołań zamiast 7n, bez nowego rysunku i pipeline'u (§ 4). */
  function pelnyObraz(pelny) {
    jestPelny = pelny;
    uSloty.value = slotyWez;
    // Mapa cienia najwyżej tyle slotów, co rysunek. 0: bryły w ogóle nie rzucają cienia, pass cienia je pomija (castShadow nie wchodzi do klucza pipeline'u).
    const kCien = Math.min(slotyCien, slotyWez);
    uSlotyCien.value = Math.max(1, kCien);
    mesh.castShadow = kCien > 0;
    const m = Math.max(n, 2);
    instRysunek = (pelny ? slotyWez : 1) * m;
    instCien = (pelny ? Math.max(1, kCien) : 1) * m;
    geo.instanceCount = instRysunek;
    geoGleb.instanceCount = instRysunek;
  }

  /** LOD obrazu w biegu (metoda G planu): { sloty: 1 | 2 | 7, cien: 0 | 1 | 2 | 7 }. Zmiana wartości i liczników, bez nowego pipeline'u. */
  function ustawLod({ sloty = slotyWez, cien = slotyCien } = {}) {
    slotyWez = sloty;
    slotyCien = cien;
    pelnyObraz(jestPelny);
  }

  /** Cień: środek i zakres na scenę (§ 4.3). Zmiana wartości, bez nowego pipeline'u. Przy odl = 7000 i zakresie do 3500 mapa jest dokładnie ta sama co dotąd (S1–S5). */
  function ustawCien(srodek, zakres, odl = 7000) {
    sun.target.position.set(srodek[0], srodek[1], srodek[2]);
    sun.position.set(srodek[0], srodek[1], srodek[2]).addScaledVector(SLONCE, odl);
    const c = sun.shadow.camera;
    c.left = -zakres; c.right = zakres; c.top = zakres; c.bottom = -zakres;
    const far = Math.max(16000, odl + 2 * zakres);
    if (c.far !== far) {
      c.far = far;
      // Bias w jednostkach świata ma zostać: 9,6 j. głębi przy far = 16000. Normalny rośnie z rozmiarem teksla.
      sun.shadow.bias = far === 16000 ? -0.0006 : -9.6 / far;
    }
    sun.shadow.normalBias = 2.0 * Math.max(1, zakres / 3500);
    c.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  ustawCien([0, 0, 500], 1700);

  /** Kamera cienia z rozmiaru sceny: kula wokół węzłów (z zapasem na hałdę, domyślnie × 1,25), a nie stała z tabeli. Liczone raz, przy wejściu w scenę. Stare sceny mają własne stałe i tego nie wołają. */
  function ustawCienZSceny(w, zapas = 1.25) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const p = w.pos;
    for (let i = 0; i < w.n; i++) {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const R = Math.max(300, 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz) * zapas);
    ustawCien([0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1)], R, Math.max(7000, 2 * R));
    return R;
  }

  /** Obraz po kroku fizyki. Pierwszy krok po wgraniu migawki: bez limitu wzrostu d, żeby stan pojawił się od razu. */
  function krok(renderer) {
    uKlatka.value = solver.fKlatka;
    renderer.compute(listaObrazu);
  }
  function krokBezLimitu(renderer) {
    const l = uLimD.value;
    uKlatka.value = solver.fKlatka;
    uLimD.value = 1;
    renderer.compute(listaObrazu);
    uLimD.value = l;
  }

  /** Samo rozgrzanie kerneli (test i tryb pomiarowy nie rysują). */
  async function rozgrzejKernele(renderer) {
    for (const k of listaObrazu) await renderer.computeAsync(k, [0, 1, 1]);
  }

  /** Rozgrzewka: kernele, pass sceny, pass cienia, głębia, GTAO, wyjście. Przed pierwszą klatką, 0 pipeline'ów synchronicznych (zasada 5, pułapki 20, 30, 31, 32). */
  async function rozgrzej(renderer) {
    await rozgrzejKernele(renderer);
    camera.updateMatrixWorld();
    const cel = async (rt, co, kam, scenaCel = null) => {
      const depth = renderer.depth, stencil = renderer.stencil;
      renderer.setRenderTarget(rt);
      renderer.depth = rt ? rt.depthBuffer !== false : depth;
      renderer.stencil = rt ? rt.stencilBuffer === true : stencil;
      try {
        await renderer.compileAsync(co, kam, scenaCel);
      } finally {
        renderer.depth = depth;
        renderer.stencil = stencil;
        renderer.setRenderTarget(null);
      }
    };
    // AGENT: compileAsync woła też updateBefore węzła cienia, a to rysuje mapę synchronicznie. Przy autoUpdate = false cel powstaje, a rysunku nie ma; pass cienia kompiluje się osobno, wzór Core3D.prewarmShadowPass (pułapki 20, 32).
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = false;
    // AGENT: compileAsync woła updateBefore węzłów materiału (pułapka 31). GTAO renderowałby wtedy swój kwad synchronicznie, więc na czas kompilacji updateBefore jest wyłączone metodą, nie typem: typ zostaje w stanie budowy.
    const ubAo = aoN ? aoN.updateBefore : null;
    if (aoN) aoN.updateBefore = () => {};
    try {
      await cel(rtGleb, sceneGleb, camera);
      await cel(rtSsao, kwadSsao, kwadSsao.camera);
      await cel(pyl.rt, pyl.scena, camera);
      await cel(rtHdr, scene, camera);
      if (aoN?._material) {
        const kwad = new THREE.QuadMesh(aoN._material);
        await cel(aoN._aoRenderTarget, kwad, kwad.camera);
      }
    } finally {
      if (aoN) aoN.updateBefore = ubAo;
    }
    await cel(null, wyj, wyj.camera);
    const mapa = wezelCienia.shadowMap;
    if (mapa && renderer._renderContexts?.get) {
      const scenaCien = new THREE.Scene();
      scenaCien.overrideMaterial = getShadowMaterial(sun);
      scenaCien.children.push(mesh);
      const konteksty = renderer._renderContexts;
      const get = konteksty.get;
      konteksty.get = function (rt, mrt) { delete konteksty.get; return get.call(this, rt, mrt, 1); }; // mapa cienia rysuje się zagnieżdżona w passie sceny, głębokość 1, pułapka 32
      try {
        await cel(mapa, scenaCien, sun.shadow.camera);
      } finally {
        delete konteksty.get;
        scenaCien.children.length = 0;
        scenaCien.overrideMaterial = null;
      }
    }
    sun.shadow.autoUpdate = true;
  }

  /** Cztery najmocniejsze błyski tej chwili do uniformów światła brył. Tabela z solvera, bo moc i czas zna CPU. Bez alokacji. */
  let swiatlaZapalone = false;
  let swiatlaWl = true;
  function ustawSwiatla(tau) {
    if (!swiatlaWl) { for (let k = 0; k < 4; k++) swiatla[k].i.value = 0; swiatlaZapalone = false; return; }
    if (!solver.blyskiCzynne() && !swiatlaZapalone) return;
    const t = solver.blyskiCpu;
    const f = solver.fKlatka;
    let zaj = 0;
    for (let s = 0; s < solver.blyski; s++) {
      const b = 4 * s;
      if (t[b + 1] <= 0) continue;
      const wiek = (f - t[b]) / 60 + tau;
      if (wiek > 0.25) { t[b + 1] = 0; continue; }
      const I = t[b + 1] * Math.min(1, (wiek + 1 / 60) * 20) * Math.exp(-Math.max(0, wiek - 2 / 60) / t[b + 2]);
      // Wstawianie do czwórki po mocy malejąco.
      let k = Math.min(zaj, 3);
      if (zaj === 4 && I <= swiatla[3].i.value) continue;
      while (k > 0 && swiatla[k - 1].i.value < I) {
        swiatla[k].i.value = swiatla[k - 1].i.value; swiatla[k].s.value = swiatla[k - 1].s.value; swiatla[k].r.value = swiatla[k - 1].r.value;
        k--;
      }
      swiatla[k].i.value = I; swiatla[k].s.value = s; swiatla[k].r.value = 2 * t[b + 3];
      if (zaj < 4) zaj++;
    }
    for (let k = zaj; k < 4; k++) swiatla[k].i.value = 0;
    swiatlaZapalone = zaj > 0;
  }

  /** Klatka: głębia, scena (GTAO i mapa cienia idą w updateBefore), wyjście na kanwę. Bez alokacji. */
  function rysuj(renderer, cam, tau) {
    uTau.value = tau;
    ustawSwiatla(tau);
    const clearC = renderer.getClearColor(_kolor), clearA = renderer.getClearAlpha();
    renderer.setRenderTarget(rtGleb);
    renderer.render(sceneGleb, cam);
    if (!aoN) {
      renderer.setRenderTarget(rtSsao);
      kwadSsao.render(renderer);
    }
    pyl.rysuj(renderer, cam);
    renderer.setRenderTarget(rtHdr);
    renderer.setClearColor(TLO, 1);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clearC, clearA);
    wyj.render(renderer);
  }

  return {
    kernele, listaObrazu, scene, sun, hemi, grunt, mesh, meshGruz, rtHdr, rtGleb, aoN, pyl, atrybuty: { rama: aRama, dane: aDane, czastki: aCzastki },
    uniformy: { uTau, uDx, uLimD, uDt, uKlatka, uZarMoc },
    wczytaj, pelnyObraz, ustawLod, ustawCien, ustawCienZSceny, ustawRozmiar, krok, krokBezLimitu, rozgrzej, rozgrzejKernele, rysuj,
    get lod() { return { sloty: slotyWez, cien: slotyCien, instRysunek, instCien }; },
    /** Pomiar: światło błysku na bryłach wł./wył. na tej samej klatce. */
    swiatlaWlacz(b) { swiatlaWl = b; },
    get n() { return n; },
  };
}

const _kolor = new THREE.Color();
