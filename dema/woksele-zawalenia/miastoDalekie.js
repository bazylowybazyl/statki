// Miasto dalekie, tier 0 (docs/PLAN-zawalenia-lod-miasto.md § 3, metoda B, § 4): tysiące budynków bez węzłów solvera. Jedna partia instancji i bufor storage „zniszczony w chwili t”.
// Plan sceny i dane instancji: planM3 w scenaMiasta.js (moduł czysty). Tu tylko obraz: Mesh z InstancedBufferGeometry (pułapka 24), materiał, kernel emisji do pul pyłu, gruzu i błysków obrazu. Bez nowych świateł i celów.
//
// Zawalenie (bez fizyki, kształt z pomiaru solvera, plan LOD § 5 „Rama”, dach / h przy t* = t / √(h / 1340)): 0,96 przy t* = 1, 0,79 przy 2, 0,42 przy 3, 0,20 przy 4, dalej kopiec. u = smoothstep(1; 4,2; t*) trzyma tę krzywą w granicach 0,03.
// Odwzorowanie wysokości Z budynku: Z ≤ H·u to kopiec, Z' = Hm·Z / H; Z > H·u to sztywna góra, Z' = Z − (H − Hm)·u. Obie gałęzie spotykają się przy Z = H·u, więc nic się nie rozrywa. Kopiec ma wysokość Hm = 14 + 0,085·H, jak hałda solvera przy dx = 10.
// Rozrzut, pochylenie i szum tylko na wierzchołkach siatki 4 × 4 × 6, szum z numeru wierzchołka w siatce, więc ściany dzielą róg i bryła zostaje zamknięta.
//
// AGENT: geometria nie ma dna, a normalna idzie z pochodnych (normalFlat): skręcone trójkąty zgniotu zostają widoczne (DoubleSide) i oświetlone, a kopiec jest fasetowany. Pętli w materiale nie ma.
// AGENT: rekord błysku wchodzi do tego samego pierścienia co kratery solvera, numerem z własnego licznika. Kolizja z kraterem zabiera najwyżej jeden błysk, a światło na bryłach (blyskiCpu) może na 0,25 s przeskoczyć. Bez blokady.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, Loop, instanceIndex, storage, uniform, uint, float, vec3, vec4, sqrt, max, min, abs, floor, round, fract, normalize, smoothstep, step, mix, fwidth, cos, sin,
  atomicAdd, positionGeometry, normalGeometry, varyingProperty, positionWorld, normalFlat, screenUV, texture,
} from 'three/tsl';
import { BLYSKI } from '../../src/3d/woksele/solver.js';
import { INST_DALEKIE } from '../../src/3d/woksele/scenaMiasta.js';

const SIATKA = 4, WARSTWY = 8; // podział jednego pudła: wierzchołków 205, trójkątów 288
const REK = INST_DALEKIE / 4;
const CAP_G = 40000; // pierścień gruzu, obraz.js
const ILE_KLAB = 8;
const ILE_KLAB_PELNY = 24; // co czwarty budynek, jak rodzaj „glowna” w M2: pełny kłąb i dłuższy błysk (próg 20 w pyl.js)
const ILE_PYL = 4; // cząstek na jedną z czterech fal pyłu
const ILE_GRUZ = 3; // kawałków na falę
const MIN_SK = 0.12;

/** Pudło z podstawą z = 0, x, y w [−1, 1], z w [0, 1], bez dna. Ściany mają własne normalne, a pozycje siatki są wspólne, stąd numer wierzchołka w shaderze z pozycji, nie z indeksu. */
function geometriaPudla() {
  const poz = [], nor = [], ind = [];
  const dodajSciane = (nu, nv, f, n) => {
    const b = poz.length / 3;
    for (let v = 0; v <= nv; v++) for (let u = 0; u <= nu; u++) { poz.push(...f(u / nu, v / nv)); nor.push(...n); }
    for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
      const a = b + v * (nu + 1) + u, c = a + 1, d = a + nu + 1, e = d + 1;
      ind.push(a, c, e, a, e, d);
    }
  };
  const S = SIATKA, W = WARSTWY;
  const w = (t) => 2 * t - 1;
  dodajSciane(S, W, (u, v) => [w(u), -1, v], [0, -1, 0]);
  dodajSciane(S, W, (u, v) => [1, w(u), v], [1, 0, 0]);
  dodajSciane(S, W, (u, v) => [-w(u), 1, v], [0, 1, 0]);
  dodajSciane(S, W, (u, v) => [-1, -w(u), v], [-1, 0, 0]);
  dodajSciane(S, S, (u, v) => [w(u), w(v), 1], [0, 0, 1]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(poz), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(ind);
  g.instanceCount = 2;
  return g;
}

export function createMiastoDalekie({ solver, obraz, pojemnosc = 12000 }) {
  const aInst = new THREE.StorageInstancedBufferAttribute(new Float32Array(INST_DALEKIE * pojemnosc), 4);
  const wInst = storage(aInst, 'vec4', REK * pojemnosc).setName('dalInst').toReadOnly();
  const uCzas = uniform(0).setName('dalCzas');
  const uLiczba = uniform(0, 'uint').setName('dalLiczba');
  const uDxSiatki = uniform(10).setName('dalDx');
  const uPietroCo = uniform(3).setName('dalPietroCo'); // komórek na piętro, ukladMiasta(dx)
  const { uTau, uDt, uKlatka } = obraz.uniformy;
  const { uKapP, uZ0, uZd } = obraz.pyl.uniformy;

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
  const czesc = (h, s) => float(h.shiftRight(uint(s)).bitAnd(uint(255))).div(255);
  // Skala czasu budynku i rozmiar kopca: jedna definicja dla wierzchołka i kernela emisji, inaczej pył wychodzi obok budynku.
  const skalaCzasu = (H, h1) => fv(max(sqrt(H.div(1340)), MIN_SK).mul(czesc(h1, 0).mul(0.3).add(0.85)));
  const wysKopca = (H, h1) => fv(min(H.mul(0.085).add(14).mul(czesc(h1, 8).mul(0.4).add(0.8)), H.mul(0.7)));

  const vL = varyingProperty('vec3', 'vDalL');
  const vNg = varyingProperty('vec3', 'vDalNg');
  const vTon = varyingProperty('vec3', 'vDalTon');
  const vDl = varyingProperty('vec3', 'vDalDl'); // długość ściany w x, w y, rama (1) albo kostka (0)
  const vKr = varyingProperty('float', 'vDalKr');
  const vZar = varyingProperty('float', 'vDalZar');

  // Zmienne przypisane przed rozgałęzieniem, varyingi na końcu (pułapka 39). Wierzchołek ukryty i stojący mają krótką ścieżkę: odczyt trzech rekordów i jedno If.
  const budujPozycje = ({ varyingi }) => Fn(() => {
    const id = uv_(instanceIndex);
    const i4 = uv_(uint(REK).mul(id));
    const A = v4(wInst.element(i4));
    const B = v4(wInst.element(i4.add(uint(1))));
    const C = v4(wInst.element(i4.add(uint(2))));
    const g = v3(positionGeometry);
    const Z = fv(B.x.add(g.z.mul(B.y)));
    const P = v3(vec3(A.x.add(g.x.mul(A.z)), A.y.add(g.y.mul(A.w)), Z));
    const Kr = fv(0);
    const Zar = fv(0);
    If(C.w.lessThan(0), () => {
      P.assign(vec3(A.x, A.y, -1000)); // gaśnie: solver liczy ten budynek, wszystkie wierzchołki w jednym punkcie
    }).Else(() => {
      const wiek = fv(uCzas.add(uTau).sub(B.w));
      If(wiek.greaterThan(0), () => {
        const hq = uv_(uint(C.z));
        const h1 = haszT(hq);
        const H = fv(B.z);
        const sk = skalaCzasu(H, h1);
        const ts = fv(wiek.div(sk));
        const Hm = wysKopca(H, h1);
        const u = fv(smoothstep(1, 4.2, ts));
        const front = fv(H.mul(u));
        const cr = fv(float(1).sub(smoothstep(front.sub(6), front.add(6), Z)));
        // Numer wierzchołka z pozycji: ten sam róg w dwóch ścianach ma ten sam szum.
        const gi = uv_(uint(round(g.x.add(1).mul(SIATKA / 2))));
        const gj = uv_(uint(round(g.y.add(1).mul(SIATKA / 2))));
        const gk = uv_(uint(round(g.z.mul(WARSTWY))));
        const hv = haszT(hq.add(gi).add(gj.mul(uint(7))).add(gk.mul(uint(61))).add(C.w.greaterThan(0.5).select(uint(977), uint(0))));
        const n = v3(vec3(u1(hv, 0), u1(hv, 10), u1(hv, 20)));
        // Góra: spadek, pochylenie, zniesienie w bok, drobne przesunięcia rosnące z czasem (fasada się kruszy, a sylwetka zostaje). Pochylenie 2–11°, ścinaniem, bo kąt mały.
        const te = fv(smoothstep(1, 3.4, ts));
        const dirX = fv(u1(h1, 16));
        const dirY = fv(u1(h1, 22));
        const kat = fv(czesc(h1, 4).mul(0.16).add(0.03).mul(te));
        const zRig = fv(Z.sub(H.sub(Hm).mul(u)));
        const zOdFrontu = fv(max(zRig.sub(Hm.mul(u)), 0));
        const ampG = fv(te.mul(min(H.mul(0.03).add(2), 7)));
        const rx = fv(P.x.add(dirX.mul(zOdFrontu.mul(kat).add(te.mul(H.mul(0.06))))).add(n.x.mul(ampG)));
        const ry = fv(P.y.add(dirY.mul(zOdFrontu.mul(kat).add(te.mul(H.mul(0.06))))).add(n.y.mul(ampG)));
        const rz = fv(zRig.add(n.z.mul(ampG)));
        // Kopiec: wysokość w kopuły, szum, podstawa szersza niż budynek. Środek rozrzutu to środek budynku, także dla uskoku.
        const rPrz = fv(max(abs(g.x), abs(g.y)));
        const kop = fv(float(1).sub(rPrz.mul(rPrz).mul(0.5)).mul(czesc(hv, 2).mul(0.75).add(0.55)));
        const kz = fv(max(Hm.mul(Z).div(H).mul(kop).add(n.z.mul(Hm.mul(0.1)).mul(g.z)), 0.3));
        const wzgl = fv(clamp01(kz.div(max(Hm.mul(u), 1))));
        const roz = fv(float(1).add(u.mul(float(1).sub(wzgl)).mul(czesc(h1, 12).mul(0.5).add(0.8))));
        const bx = fv(A.x.sub(C.x));
        const by = fv(A.y.sub(C.y));
        const kx = fv(bx.add(P.x.sub(bx).mul(roz)).add(n.x.mul(A.z).mul(0.22).mul(u)));
        const ky = fv(by.add(P.y.sub(by).mul(roz)).add(n.y.mul(A.w).mul(0.22).mul(u)));
        P.assign(vec3(mix(rx, kx, cr), mix(ry, ky, cr), mix(rz, kz, cr)));
        Kr.assign(max(cr.mul(smoothstep(0, 0.2, u)), te.mul(0.35)));
        // Żar przy przecięciu w 0,2 H, gaśnie w około 0,6 s. We fragmencie tylko część komórek: jednolity pas to świecąca płyta na całej ścianie.
        const pasZ = fv(float(1).sub(smoothstep(0, H.mul(0.08).add(5), abs(Z.sub(H.mul(0.2))))));
        Zar.assign(pasZ.mul(max(float(1).sub(wiek.div(0.6)), 0)));
      });
    });
    if (varyingi) {
      vL.assign(vec3(g.x.add(1).mul(A.z), g.y.add(1).mul(A.w), Z));
      vNg.assign(normalGeometry);
      const D = v4(wInst.element(i4.add(uint(3))));
      vTon.assign(D.xyz);
      vDl.assign(vec3(A.z.mul(2), A.w.mul(2), D.w));
      vKr.assign(Kr);
      vZar.assign(Zar);
    }
    return P;
  })();
  function clamp01(x) { return min(max(x, 0), 1); }

  // Barwa jak rama solvera przy dx = 10: dwie warstwy stropu (jasne), warstwa okien (ciemna) ze słupkami co trzy komórki, dach jak strop. Daleko wzór gaśnie do średniej, żeby nie migotał.
  // Komórki w układzie obróconym względem osi, inaczej gruz wychodzi jak kamuflaż z pikseli (.tmp/woksele-demo/LOD/dalekie/b/crop_t12_prawy.png).
  const cegielka = (p, s) => {
    const ix = uv_(uint(floor(p.x.mul(0.8).add(p.y.mul(0.48)).add(p.z.mul(0.36)).div(s)).add(32768)));
    const iy = uv_(uint(floor(p.y.mul(0.8).sub(p.x.mul(0.6)).div(s)).add(32768)));
    const iz = uv_(uint(floor(p.z.mul(0.8).sub(p.x.mul(0.216)).sub(p.y.mul(0.288)).sub(p.y.mul(0.27)).div(s)).add(32768)));
    return haszT(ix.mul(uint(73856093)).bitXor(iy.mul(uint(19349663))).bitXor(iz.mul(uint(83492791))));
  };
  const barwa = Fn(() => {
    const L = v3(vL);
    const ng = v3(vNg);
    const dl = v3(vDl);
    const naX = ng.x.abs().greaterThan(0.5);
    const s = fv(naX.select(L.y, L.x));
    const dlug = fv(naX.select(dl.y, dl.x));
    const szer = fv(max(fwidth(L.z), fwidth(s)));
    const fade = fv(smoothstep(uDxSiatki.mul(0.45), uDxSiatki.mul(1.3), szer));
    const kz = fv(floor(L.z.div(uDxSiatki)));
    const warstwa = fv(kz.sub(uPietroCo.mul(floor(kz.div(uPietroCo)))));
    const okno = fv(step(2, warstwa));
    const ci = fv(floor(s.div(uDxSiatki)));
    // Rama solvera: pas pod stropem to fasada z dziurą między słupkami co trzy komórki, narożniki pełne (klasa w wieza(), fasada co 3).
    const slupek = fv(step(ci.sub(floor(ci.div(3)).mul(3)), 0.5));
    const krawedz = fv(step(dlug.sub(uDxSiatki), s));
    const dziura = fv(float(1).sub(slupek).mul(float(1).sub(krawedz)));
    const bok = fv(step(abs(ng.z), 0.5));
    const fas = v3(mix(vec3(0.105, 0.108, 0.112), vec3(0.03, 0.03, 0.032), dziura));
    const rama = v3(mix(vec3(0.2, 0.19, 0.17), fas, okno.mul(bok)));
    const ramaSr = v3(mix(vec3(0.2, 0.19, 0.17), vec3(0.158, 0.153, 0.144), bok));
    const kostka = v3(mix(vec3(0.2, 0.19, 0.17), vec3(0.17, 0.162, 0.148), bok));
    const czysta = v3(mix(kostka, mix(rama, ramaSr, fade), dl.z).mul(vTon));
    // Gruz: kawałki z komórek świata, z ciemnymi szczelinami jak między blokami hałdy.
    const hc = cegielka(positionWorld, 6.5);
    const jasn = fv(czesc(hc, 3));
    const gruz = v3(vec3(0.14, 0.133, 0.123).mul(vTon).mul(smoothstep(0.1, 0.42, jasn).mul(0.85).add(0.2)).mul(czesc(hc, 11).mul(0.45).add(0.8)));
    return mix(czysta, gruz, min(vKr.mul(1.5), 1));
  });
  // Normalna kopca rozmyta z komórek świata: z daleka czyta się jak drobne kostki, bez geometrii.
  const normalna = Fn(() => {
    const hc = cegielka(positionWorld, 6.5);
    const jit = v3(vec3(u1(hc, 0), u1(hc, 10), u1(hc, 20)).mul(vKr.mul(1.1)));
    return normalize(normalFlat.add(jit));
  });

  const aoM = Fn(() => texture(obraz.rtSsao.texture, screenUV).r)().toVar('dalAo');

  const mat = new THREE.MeshLambertNodeMaterial();
  mat.name = 'DalBudynki';
  mat.map = null;
  mat.side = THREE.DoubleSide;
  mat.positionNode = budujPozycje({ varyingi: true });
  mat.castShadowPositionNode = budujPozycje({ varyingi: false });
  mat.normalNode = normalna();
  mat.colorNode = barwa().mul(aoM.mul(0.5).add(0.5));
  mat.aoNode = aoM.div(aoM.mul(0.5).add(0.5));
  mat.emissiveNode = Fn(() => vec3(1.5, 0.55, 0.12).mul(vZar).mul(step(0.55, czesc(cegielka(positionWorld, 5), 7))))();

  const geo = geometriaPudla();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'DalBudynki';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  obraz.scene.add(mesh);
  obraz.cienieDodatkowe.push(mesh);

  const matGleb = new THREE.NodeMaterial();
  matGleb.name = 'DalGleb';
  matGleb.map = null;
  matGleb.side = THREE.DoubleSide;
  matGleb.positionNode = budujPozycje({ varyingi: false });
  matGleb.colorNode = vec3(0);
  matGleb.lights = false;
  const meshGleb = new THREE.Mesh(geo, matGleb);
  meshGleb.name = 'DalGleb';
  meshGleb.frustumCulled = false;
  obraz.sceneGleb.add(meshGleb);

  // ── Kernel emisji, raz na krok ── Korpusy z trafieniem w oknie czasu: w chwili trafienia błysk z kłębem, potem cztery fale pyłu i gruzu od frontu zgniotu. Czas z uCzas, los z ziarna i numeru fali.
  const A = solver.atrybuty;
  const aLiczB = new THREE.StorageInstancedBufferAttribute(new Uint32Array(1), 1);
  const wLiczB = storage(aLiczB, 'uint', 1).setName('dalLiczBlysk').toAtomic();
  const wBlysk = storage(A.blysk, 'vec4', 3 * BLYSKI).setName('wokBlysk');
  const wPyl = storage(obraz.pyl.aPyl, 'vec4', obraz.pyl.aPyl.count).setName('wokPyl');
  const wLiczP = storage(obraz.pyl.aLicz, 'uint', 1).setName('wokLiczPyl').toAtomic();
  const wGruz = storage(obraz.atrybuty.czastki, 'vec4', 2 * CAP_G).setName('wokCzastki');
  const wLiczG = storage(obraz.atrybuty.liczGruzu, 'uint', 1).setName('wokLiczObraz').toAtomic();

  const kEmisja = Fn(() => {
    const id = uv_(instanceIndex);
    If(id.greaterThanEqual(uLiczba), () => { Return(); });
    const i4 = uv_(uint(REK).mul(id));
    const C = v4(wInst.element(i4.add(uint(2))));
    If(C.w.notEqual(0), () => { Return(); });
    const B = v4(wInst.element(i4.add(uint(1))));
    const wiek = fv(uCzas.sub(B.w));
    If(wiek.lessThan(0).or(wiek.greaterThan(6)), () => { Return(); });
    const a = v4(wInst.element(i4));
    const hq = uv_(uint(C.z));
    const h1 = haszT(hq);
    const H = fv(B.z);
    const sk = skalaCzasu(H, h1);
    const ts = fv(wiek.div(sk));
    const Hm = wysKopca(H, h1);
    If(wiek.lessThan(uDt), () => {
      // Dwa rekordy, jak dwa kratery budynku w M1: głowica na dachu i główny w 0,2 wysokości. Co czwarty budynek ma pełny kłąb. Czoło pasa przechodzi jedno miejsce naraz, więc pierścień 64 rekordów starcza (133 budynki / s · 2 · 0,25 s życia, a stare i tak gasną).
      const hb = haszT(hq.add(uint(5)));
      const pelny = hb.bitAnd(uint(3)).equal(uint(0));
      const nr = uv_(atomicAdd(wLiczB.element(uint(0)), uint(2)).mod(uint(BLYSKI)));
      const s3 = uv_(uint(3).mul(nr));
      wBlysk.element(s3).assign(vec4(a.x, a.y, H.mul(0.2).add(5), uKlatka));
      wBlysk.element(s3.add(uint(1))).assign(vec4(0, 0, 0, pelny.select(float(3.2), float(1.8))));
      wBlysk.element(s3.add(uint(2))).assign(vec4(float(20).add(H.mul(0.06)), uKlatka.mul(7).add(float(nr)), pelny.select(float(ILE_KLAB_PELNY), float(ILE_KLAB)), 1));
      const nr2 = uv_(nr.add(uint(1)).mod(uint(BLYSKI)));
      const s4 = uv_(uint(3).mul(nr2));
      wBlysk.element(s4).assign(vec4(a.x, a.y, H, uKlatka));
      wBlysk.element(s4.add(uint(1))).assign(vec4(0, 0, 0, 1.8));
      wBlysk.element(s4.add(uint(2))).assign(vec4(13, uKlatka.mul(7).add(float(nr2)), 0, 1));
    });
    Loop({ start: uint(0), end: uint(4), type: 'uint', condition: '<', name: 'fala' }, ({ fala }) => {
      const ti = fv(float(fala).mul(0.75).add(1.4));
      If(ts.greaterThanEqual(ti).and(ts.lessThan(ti.add(uDt.div(sk)))), () => {
        const u = fv(smoothstep(1, 4.2, ti));
        const zF = fv(max(Hm.mul(u), 4));
        const hf = haszT(hq.add(fala.mul(uint(131))).add(uint(77)));
        Loop({ start: uint(0), end: uint(ILE_PYL), type: 'uint', condition: '<', name: 'kp' }, ({ kp }) => {
          const hp = haszT(hf.add(kp.mul(uint(101))));
          const fi = fv(czesc(hp, 0).mul(6.283));
          const cx = fv(cos(fi));
          const sy = fv(sin(fi));
          const q = uv_(atomicAdd(wLiczP.element(uint(0)), uint(1)).mod(uKapP));
          const q3 = uv_(uint(3).mul(q));
          wPyl.element(q3).assign(vec4(a.x.add(cx.mul(a.z)), a.y.add(sy.mul(a.w)), zF.add(czesc(hp, 8).mul(6)), 0));
          wPyl.element(q3.add(uint(1))).assign(vec4(cx.mul(czesc(hp, 16).mul(30).add(14)), sy.mul(czesc(hp, 16).mul(30).add(14)), czesc(hp, 24).mul(14).add(4), czesc(hp, 4).mul(20).add(24)));
          wPyl.element(q3.add(uint(2))).assign(vec4(1.1, 0.42, uZ0.add(uZd.mul(czesc(hp, 12))), 0));
        });
        Loop({ start: uint(0), end: uint(ILE_GRUZ), type: 'uint', condition: '<', name: 'kg' }, ({ kg }) => {
          const hg = haszT(hf.add(kg.mul(uint(211))).add(uint(3)));
          const q = uv_(atomicAdd(wLiczG.element(uint(0)), uint(1)).mod(uint(CAP_G)));
          const zR = fv(H.sub(H.sub(Hm).mul(u)).mul(czesc(hg, 0)));
          wGruz.element(uint(2).mul(q)).assign(vec4(a.x.add(u1(hg, 2).mul(a.z)), a.y.add(u1(hg, 12).mul(a.w)), zR, czesc(hg, 8).mul(4).add(3)));
          wGruz.element(uint(2).mul(q).add(uint(1))).assign(vec4(u1(hg, 3).mul(55), u1(hg, 13).mul(55), u1(hg, 22).mul(20).add(10), 0));
        });
      });
    });
  })().compute(pojemnosc).setName('dalEmisja');
  obraz.listaObrazu.push(kEmisja);

  let liczba = 0;
  function pokaz(wid) {
    mesh.visible = wid;
    meshGleb.visible = wid;
  }
  pokaz(true);
  return {
    mesh, meshGleb, aInst, kEmisja, uniformy: { uCzas, uLiczba, uDxSiatki, uPietroCo },
    /** Dane sceny albo null (scena bez miasta dalekiego): partia znika, kernel od razu kończy. Bez nowego pipeline'u. */
    wczytaj(d) {
      liczba = d ? Math.min(d.n, pojemnosc) : 0;
      uLiczba.value = liczba;
      uCzas.value = 0;
      geo.instanceCount = Math.max(liczba, 2);
      kEmisja.setCount(Math.max(liczba, 1));
      pokaz(!!d);
      if (!d) return;
      aInst.array.set(d.inst.subarray(0, liczba * INST_DALEKIE));
      aInst.needsUpdate = true;
      // Gruz bierze barwę z wDane węzła 0. Scena bez węzłów (A/B: wszystko w tierze 0) nie ma go wypełnionego.
      if (obraz.n === 0) { obraz.atrybuty.dane.array.set([0.2, 0.19, 0.17], 4); obraz.atrybuty.dane.needsUpdate = true; }
      uDxSiatki.value = d.dx;
      uPietroCo.value = d.pietroCo;
      aLiczB.array[0] = 0;
      aLiczB.needsUpdate = true;
    },
    /** Czas sceny po tym kroku. Woła się przed obraz.krok, bo emisja jest w tej samej liście. */
    krok(k) { uCzas.value = k / 60; },
    /** Pomiar A/B: partia wył., kernel dalej liczy, gdy `iKernel` nie jest false. */
    pokaz(wid, iKernel = true) {
      pokaz(wid);
      uLiczba.value = wid || iKernel ? liczba : 0;
    },
    /** Zapis „zniszczony w chwili t” dla instancji: bufor idzie cały, wołać najwyżej raz na klatkę. W scenie M3 chwile są w planie. */
    zniszcz(slot, t) {
      aInst.array[INST_DALEKIE * slot + 7] = t;
      aInst.needsUpdate = true;
    },
    get liczba() { return liczba; },
    get wierzcholki() { return liczba * geo.attributes.position.count; },
  };
}
