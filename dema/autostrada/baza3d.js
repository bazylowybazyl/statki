// dema/autostrada/baza3d.js
//
// Wspólna baza obrazu — ta sama we wszystkich stylach (style różnią się samą drogą):
//  - pole gęstości ruchu: tekstura 2048 × 6 (pasy główne; r — gęstość, g — średnia prędkość, b — udział stojących), wspólna dla stylów;
//  - podkład: droga przyciemnia niebo pod sobą (mnożenie; prawdziwe niebo gry jest jasne, a linie muszą mieć z czym kontrastować);
//  - lampy stałe i sygnałowe (bar stopu, boje, kocie oczy, tory K-7), lampy nad bramownicami (FG), światła pojazdów (nad kadłubami);
//  - ciemne bryły: bramownice i wieże węzłów, belka nad statkiem (pass FG, z > 0 — statek przelatuje pod nią, paralaksa).
// Kod barw jednostek (ten sam w każdym stylu): policja — niebieski błysk ≤ 2 Hz, ciężarówka — biała głowica + bursztynowa kropka na
// kontener, frachtowiec — dwa białe światła masztowe, workforce — ciepłe okna, turystyka — złota girlanda.
import * as THREE from 'three/webgpu';
import {
  attribute, float, int, vec2, vec3, vec4, max, min, abs, mix, exp, clamp, smoothstep, varying, positionGeometry, step, sin, fract, floor, length, select, positionLocal, normalLocal, dot, normalize, mod, modelViewMatrix
} from 'three/tsl';
import { U, sladPikselaW, materialAddytywny, zaKula } from './wspolne.tsl.js';
import { zbudujInfrastrukture, TRYB_LAMPY } from './infrastruktura.js';
import { zbudujWstegi, RODZAJ } from './wstegi.js';
import { HW } from './siec.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Pole gęstości

export const POLE = Object.freeze({ N: 2048, PASY: 6, wiersz: (cw, pas) => (cw === 0 ? pas : 3 + pas) });

function utworzPole(ruch) {
  const { N, PASY } = POLE;
  const dane = new Float32Array(N * PASY * 4);
  const pomoc = new Float32Array(N * PASY * 3);
  const tekstura = new THREE.DataTexture(new Uint16Array(N * PASY * 4), N, PASY, THREE.RGBAFormat, THREE.HalfFloatType);
  tekstura.minFilter = THREE.LinearFilter;
  tekstura.magFilter = THREE.LinearFilter;
  tekstura.wrapS = THREE.RepeatWrapping;
  tekstura.wrapT = THREE.ClampToEdgeWrapping;
  tekstura.generateMipmaps = false;
  tekstura.colorSpace = THREE.NoColorSpace;
  tekstura.needsUpdate = true;
  let doKroku = 0;
  const h = THREE.DataUtils.toHalfFloat;
  function odswiez(dt) {
    doKroku -= dt;
    if (doKroku > 0) return;
    const krok = 0.2;
    doKroku = krok;
    pomoc.fill(0);
    const lista = ruch.pojazdy;
    for (let i = 0; i < lista.length; i++) {
      const v = lista[i];
      if (v.tryb !== 0) continue;
      const th = ruch.thetaOf(v.cw, v.s);
      const u = (th / TAU) % 1;
      const k = Math.floor((u < 0 ? u + 1 : u) * N) % N;
      const o = (POLE.wiersz(v.cw, v.pas) * N + k) * 3;
      pomoc[o] += 1;
      pomoc[o + 1] += v.vel;
      if (v.vel < 60) pomoc[o + 2] += 1;
    }
    // Rozmycie wzdłuż (okno ~5 komórek ≈ 950 j.) i pamięć w czasie: droga gaśnie po przejeździe, a nie znika.
    const zanik = Math.exp(-krok / 1.2);
    const tex = tekstura.image.data;
    for (let w = 0; w < PASY; w++) {
      for (let i = 0; i < N; i++) {
        let d = 0; let v = 0; let s = 0;
        for (let q = -2; q <= 2; q++) {
          const o = (w * N + ((i + q + N) % N)) * 3;
          const g = 3 - Math.abs(q);
          d += pomoc[o] * g; v += pomoc[o + 1] * g; s += pomoc[o + 2] * g;
        }
        d /= 9; s /= 9;
        const vs = d > 1e-4 ? v / 9 / d : 0;
        const o4 = (w * N + i) * 4;
        dane[o4] = dane[o4] * zanik + d * (1 - zanik);
        dane[o4 + 1] = d > 1e-4 ? dane[o4 + 1] * zanik + vs * (1 - zanik) : dane[o4 + 1];
        dane[o4 + 2] = dane[o4 + 2] * zanik + s * (1 - zanik);
        tex[o4] = h(dane[o4]); tex[o4 + 1] = h(dane[o4 + 1] / 1000); tex[o4 + 2] = h(dane[o4 + 2]); tex[o4 + 3] = 0x3C00;
      }
    }
    tekstura.needsUpdate = true;
  }
  return { tekstura, odswiez };
}

// ---------------------------------------------------------------------------
// Podkład

function utworzPodklad(geometria, sila) {
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const vV = varying(aSV.y, 'vPodV');
  const vM = varying(aMeta, 'vPodM');
  const rodzaj = vM.x;
  const pol = vM.y;
  const brzeg = max(pol.mul(0.5), 120);
  const zanik = float(1).sub(smoothstep(pol, pol.add(brzeg), abs(vV)));
  const waga = select(rodzaj.lessThan(2.5), float(1), select(rodzaj.lessThan(7.5), U.podkladRamp, float(0.0))).mul(mix(float(1), U.podkladRozdzial, step(1.5, rodzaj).mul(step(rodzaj, float(2.5)))));
  // Przesłona tarczą Ziemi w kamerze kinowej: tylko styl, który ją zamówił (U.rZiemi > 0); inaczej stałe 1.
  const vZaZ = varying(mix(float(1), zaKula(modelViewMatrix.mul(vec4(positionLocal, 1)).xyz, modelViewMatrix.mul(vec4(0, 0, 0, 1)).xyz, max(U.rZiemi, 1)), step(1, U.rZiemi)), 'vPodZ');
  const alfa = zanik.mul(waga).mul(sila).mul(vZaZ);
  const m = new THREE.NodeMaterial();
  m.name = 'autostrada-podklad';
  m.lights = false;
  m.fog = false;
  m.transparent = false;
  m.depthWrite = false;
  m.depthTest = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.ZeroFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.fragmentNode = vec4(0, 0, 0, alfa);
  const mesh = new THREE.Mesh(geometria, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'AutostradaPodklad';
  return mesh;
}

// ---------------------------------------------------------------------------
// Lampy: instancje kwadów, stan z K-7 w wierzchołku

function zbudujGrafLampy({ dynamiczne = false } = {}) {
  const iA = attribute('iA', 'vec4');   // x, y, rozmiar, grupa (K-7)
  const iB = attribute('iB', 'vec4');   // r, g, b, tryb
  const iC = attribute('iC', 'float');  // faza
  const k = iA.w.toInt();
  const sygnal = U.sygnaly.element(k);
  const stan = sygnal.x;
  const faza = sygnal.w;
  const tryb = iB.w;

  const trybIs = (t) => float(1).sub(step(0.5, abs(tryb.sub(t))));
  const stala = trybIs(TRYB_LAMPY.STALA);
  const bar = trybIs(TRYB_LAMPY.BAR_STOPU);
  const glow = trybIs(TRYB_LAMPY.GLOWICA);
  const krolik = trybIs(TRYB_LAMPY.KROLIK);
  const tor = trybIs(TRYB_LAMPY.TOR_K7);
  const wieza = trybIs(TRYB_LAMPY.WIEZA);
  const uprz = trybIs(TRYB_LAMPY.UPRZEDZENIE);

  const czerw = step(1.5, stan);
  const zolt = step(0.5, stan).mul(float(1).sub(czerw));
  const ziel = float(1).sub(step(0.5, stan));
  // Bar stopu: zapala się przy żółtym słabiej, przy czerwonym pełnia. Na zielonym zgaszony.
  const barJ = czerw.mul(1).add(zolt.mul(0.5)).mul(U.barBazy);
  // Głowica: zielona, żółta, czerwona (ta sama lampa).
  const glowKolor = mix(mix(vec3(0.08, 1.4, 0.55), vec3(3.2, 1.45, 0.1), zolt), vec3(6, 0.07, 0.02), czerw);
  // Królik boi: bursztyn biegnący ku linii stopu, 1,5 Hz, tylko poza zielonym.
  const biegF = fract(U.czas.mul(1.5).add(iC));
  const krolikJ = float(1).sub(ziel).mul(smoothstep(0.75, 1, biegF)).mul(1.2);
  // Tor K-7: tylko w fazie BOX (i tuż przed), królik „do mnie” — fala od bramy w głąb kosmosu.
  const boxOn = step(1.5, faza).mul(float(1).sub(step(3.5, faza)));
  const torF = fract(U.czas.mul(0.9).sub(iC));
  const torJ = boxOn.mul(float(0.28).add(smoothstep(0.8, 1, torF).mul(2.4))).mul(U.tory);
  // Wieża: czerwona tylko przy czerwonym, spokojny oddech; poza tym biała kropka nawigacyjna.
  const wiezaJ = czerw.mul(float(1).add(sin(U.czas.mul(3)).mul(0.25)));
  const uprzJ = float(1).sub(ziel).mul(smoothstep(0.35, 0.65, fract(U.czas.mul(1).add(iC))));

  const jasnoscStat = stala.add(bar.mul(barJ)).add(krolik.mul(krolikJ)).add(tor.mul(torJ)).add(wieza.mul(wiezaJ)).add(uprz.mul(uprzJ)).add(glow);
  const kolorStat = mix(iB.rgb, glowKolor, glow);

  // Lampa sygnałowa utrzymuje widoczność z daleka; stała gaśnie z zachowaną energią.
  const srodek = vec3(iA.x, iA.y, 0);
  const slad = sladPikselaW(srodek);
  const sygnalowa = bar.add(glow).add(wieza).add(krolik).add(tor).add(uprz);
  const sigma0 = iA.z.mul(0.5);
  const sigmaMin = mix(slad.mul(0.9), slad.mul(1.5), sygnalowa);
  const sigma = max(sigma0, sigmaMin);
  const energia = sigma0.div(sigma).toVar();
  const zachowanie = mix(energia.mul(energia), max(energia, 0.35), sygnalowa);
  const pol = sigma.mul(3.2);
  const pozycja = vec3(iA.x.add(positionGeometry.x.mul(pol)), iA.y.add(positionGeometry.y.mul(pol)), 0);

  const vP = varying(positionGeometry.xy.mul(3.2), 'vLampaP');
  const vKolor = varying(kolorStat.mul(jasnoscStat).mul(zachowanie), 'vLampaK');
  const r2 = dot(vP, vP);
  const blask = exp(r2.mul(-0.5));
  return { pozycja, fragment: vec4(clamp(vKolor.mul(blask), vec3(0), vec3(10)), 1) };
}

function zbudujLampy(lista, { warstwa = 0, renderOrder = 3, z = 0 } = {}) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const STRIDE = 9;
  const dane = new Float32Array(lista.length * STRIDE);
  lista.forEach((l, i) => {
    const o = i * STRIDE;
    dane[o] = l.x; dane[o + 1] = l.y; dane[o + 2] = l.rozm; dane[o + 3] = l.grupa;
    dane[o + 4] = l.r; dane[o + 5] = l.g; dane[o + 6] = l.b; dane[o + 7] = l.tryb;
    dane[o + 8] = l.faza;
  });
  const bufor = new THREE.InstancedInterleavedBuffer(dane, STRIDE, 1);
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));
  g.setAttribute('iB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));
  g.setAttribute('iC', new THREE.InterleavedBufferAttribute(bufor, 1, 8));
  g.instanceCount = lista.length;
  const graf = zbudujGrafLampy();
  const mat = materialAddytywny(graf.fragment, graf.pozycja, warstwa === 2 ? 'lampy-fg' : 'lampy');
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.position.z = z;
  mesh.layers.set(warstwa);
  mesh.name = warstwa === 2 ? 'AutostradaLampyFG' : 'AutostradaLampy';
  return mesh;
}

// ---------------------------------------------------------------------------
// Światła pojazdów: nad kadłubami, przepisywane co klatkę

const CAP_SWIATEL = 9000;
const SW_STRIDE = 8;

function zbudujSwiatlaPojazdow() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const bufor = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP_SWIATEL * SW_STRIDE), SW_STRIDE, 1);
  bufor.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));   // x, y, rozmiar, zachowanie (0…1: min. udział z daleka)
  g.setAttribute('iB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));   // r, g, b, —
  g.instanceCount = 0;
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const srodek = vec3(iA.x, iA.y, 0);
  const slad = sladPikselaW(srodek);
  const sigma0 = iA.z.mul(0.5);
  const sigma = max(sigma0, slad.mul(0.9));
  const e = sigma0.div(sigma).toVar();
  const zach = max(e.mul(e), iA.w);
  const pol = sigma.mul(3.2);
  const pozycja = vec3(iA.x.add(positionGeometry.x.mul(pol)), iA.y.add(positionGeometry.y.mul(pol)), 0);
  const vP = varying(positionGeometry.xy.mul(3.2), 'vSwP');
  const vK = varying(iB.rgb.mul(zach), 'vSwK');
  const blask = exp(dot(vP, vP).mul(-0.5));
  const m = materialAddytywny(vec4(clamp(vK.mul(blask), vec3(0), vec3(12)), 1), pozycja, 'swiatla-pojazdow');
  // Nad kadłubami: lista przezroczystych, po proxy (kolejka 10).
  m.transparent = true;
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 14;
  mesh.name = 'AutostradaSwiatla';
  return { mesh, bufor, g };
}

// ---------------------------------------------------------------------------
// Bryły: bramownice i wieże, ciemne, matowe, pass FG (z > 0)

function bryla(lx, ly, lz, ox = 0, oy = 0, oz = 0) {
  const b = new THREE.BoxGeometry(lx, ly, lz);
  b.translate(ox, oy, oz);
  return b;
}
function polacz(geo) {
  let nVert = 0;
  let nIdx = 0;
  for (const g of geo) { nVert += g.getAttribute('position').count; nIdx += g.index.count; }
  const pos = new Float32Array(nVert * 3);
  const nor = new Float32Array(nVert * 3);
  const idx = new Uint32Array(nIdx);
  let v = 0;
  let i = 0;
  for (const g of geo) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    pos.set(p.array, v * 3);
    nor.set(n.array, v * 3);
    for (let q = 0; q < g.index.count; q++) idx[i + q] = g.index.array[q] + v;
    v += p.count;
    i += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function zbudujBryly(lista, geometria, nazwa) {
  // Instancja: x, y, kąt, skala X (promieniowo), z.
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', geometria.getAttribute('position'));
  g.setAttribute('normal', geometria.getAttribute('normal'));
  g.setIndex(geometria.index);
  const dane = new Float32Array(lista.length * 4);
  lista.forEach((b, i) => { dane[i * 4] = b.x; dane[i * 4 + 1] = b.y; dane[i * 4 + 2] = b.kat * Math.PI / 180; dane[i * 4 + 3] = b.skala ?? 1; });
  const bufor = new THREE.InstancedInterleavedBuffer(dane, 4, 1);
  g.setAttribute('iB', new THREE.InterleavedBufferAttribute(bufor, 4, 0));
  g.instanceCount = lista.length;
  const iB = attribute('iB', 'vec4');
  const c = iB.z.cos();
  const s = iB.z.sin();
  const lok = positionLocal.mul(vec3(iB.w, iB.w, 1));
  const lx = lok.x;
  const ly = lok.y;
  const pozycja = vec3(iB.x.add(lx.mul(c)).sub(ly.mul(s)), iB.y.add(lx.mul(s)).add(ly.mul(c)), lok.z);
  const nx = normalLocal.x.mul(c).sub(normalLocal.y.mul(s));
  const ny = normalLocal.x.mul(s).add(normalLocal.y.mul(c));
  const n = vec3(nx, ny, normalLocal.z);
  const vN = varying(n, 'vBrN');
  const wiatlo = max(dot(normalize(vN), normalize(U.slonce)), 0).mul(0.7).add(0.3);
  const m = new THREE.NodeMaterial();
  m.name = nazwa;
  m.lights = false;
  m.fog = false;
  m.positionNode = pozycja;
  // Bez fazek i połysku: tylko sylwetka; światło niosą lampy (L ≤ 0,08).
  m.fragmentNode = vec4(vec3(0.05, 0.056, 0.064).mul(wiatlo), 1);
  m.depthTest = true;
  m.depthWrite = true;
  m.side = THREE.FrontSide;
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.layers.set(2);
  mesh.renderOrder = 5;
  mesh.name = nazwa;
  return mesh;
}

function geometriaBramownicy() {
  // Belka promieniowo (oś X), jednostkowa długość 1700 (skala instancji dopasowuje do jezdni); gondole z silniczkami na końcach,
  // kratownica z dwóch pasów, przekładki co 280 j.: z góry czyta się jak latająca konstrukcja, nie kreska.
  const czesci = [
    bryla(1700, 16, 10, 0, -18, 190),
    bryla(1700, 16, 10, 0, 18, 190),
    bryla(1700, 6, 6, 0, 0, 198)
  ];
  for (let x = -840; x <= 840; x += 280) czesci.push(bryla(14, 52, 8, x, 0, 190));
  for (const bok of [-1, 1]) {
    czesci.push(bryla(90, 96, 40, bok * 880, 0, 186));
    czesci.push(bryla(26, 26, 18, bok * 880, -60, 186));
    czesci.push(bryla(26, 26, 18, bok * 880, 60, 186));
  }
  return polacz(czesci);
}
function geometriaWiezy() {
  const R = 210;
  const czesci = [bryla(R * 2, R * 0.9, 60, 0, 0, 130), bryla(R * 0.9, R * 2, 60, 0, 0, 130), bryla(R * 1.4, R * 1.4, 40, 0, 0, 170), bryla(120, 120, 50, 0, 0, 210)];
  for (const k of [-1, 1]) czesci.push(bryla(R * 1.3, 18, 14, 0, k * R * 0.86, 150), bryla(18, R * 1.3, 14, k * R * 0.86, 0, 150));
  return polacz(czesci);
}

// ---------------------------------------------------------------------------

export function utworzBaze(ctx) {
  const { ruch, siec, grupa } = ctx;
  const inf = zbudujInfrastrukture();
  const pole = utworzPole(ruch);
  ctx.pole = pole;
  const dane = zbudujWstegi(siec);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(dane.pozycje, 3));
  geom.setAttribute('aSV', new THREE.BufferAttribute(dane.sv, 2));
  geom.setAttribute('aMeta', new THREE.BufferAttribute(dane.meta, 4));
  geom.setIndex(new THREE.BufferAttribute(dane.indeksy, 1));
  ctx.geomWstegi = geom;
  ctx.RODZAJ = RODZAJ;

  const podklad = utworzPodklad(geom, U.podklad);
  const lampy = zbudujLampy(inf.lampy);
  const lampyFG = zbudujLampy(inf.lampyFG, { warstwa: 2, renderOrder: 7, z: 240 });
  const sw = zbudujSwiatlaPojazdow();
  // Rozmiar belki: skala instancji = długość jezdni / 1700.
  const bram = zbudujBryly(inf.bramownice.map((b) => ({ ...b, skala: 1 })), geometriaBramownicy(), 'AutostradaBramownice');
  const wieze = zbudujBryly(inf.wieze.map((b) => ({ ...b, skala: b.rozm / 420 })), geometriaWiezy(), 'AutostradaWieze');
  for (const m of [podklad, lampy, lampyFG, sw.mesh, bram, wieze]) grupa.add(m);

  const dan = sw.bufor.array;
  let bBlysk = 0;
  function pisz(n, x, y, rozm, zach, r, g, b) {
    if (n >= CAP_SWIATEL) return n;
    const o = n * SW_STRIDE;
    dan[o] = x; dan[o + 1] = y; dan[o + 2] = rozm; dan[o + 3] = zach;
    dan[o + 4] = r; dan[o + 5] = g; dan[o + 6] = b; dan[o + 7] = 0;
    return n + 1;
  }
  return {
    siatki: [podklad, lampy, lampyFG, sw.mesh, bram, wieze],
    infrastruktura: inf,
    aktualizuj(kl) {
      pole.odswiez(kl.dt);
      U.podklad.value = (ctx.silaPodkladu ?? 0.55);
      U.podkladRamp.value = (ctx.silaRamp ?? 0.75);
      U.podkladRozdzial.value = (ctx.silaRozdzial ?? 1);
      U.tory.value = (ctx.silaTorow ?? 1);
      U.barBazy.value = (ctx.silaBaru ?? 1);
      U.rZiemi.value = (ctx.promienZiemi ?? 0);
      bBlysk += kl.dt;
      // Światła pojazdów: kod klas. Przy dalekim zoomie zostaje drobny ślad głowy (zachowanie), resztę niesie styl.
      const lista = ruch.pojazdy;
      let n = 0;
      for (let i = 0; i < lista.length; i++) {
        const v = lista[i];
        if (v.alfa < 0.05) continue;
        const a = v.alfa;
        const cx = Math.cos(v.h);
        const cy = Math.sin(v.h);
        const hx = v.L * 0.5;
        const stop = v.hamuje ? 1 : 0;
        switch (v.kod) {
          case 0: { // ciężarówka: biała głowica; bursztynowe kropki kontenerów rysuje ciagniki3d
            n = pisz(n, v.x + cx * 14, v.y + cy * 14, 3.2, 0.05, 1.5 * a, 1.6 * a, 1.7 * a);
            if (stop) n = pisz(n, v.x - cx * 30, v.y - cy * 30, 3.2, 0.05, 3.0 * a, 0.05, 0.02);
            break;
          }
          case 1: { // workforce: ciepły rząd okien
            for (const d of [-0.28, -0.1, 0.08, 0.26]) n = pisz(n, v.x + cx * v.L * d, v.y + cy * v.L * d, 6, 0.04, 1.5 * a, 0.95 * a, 0.45 * a);
            if (stop) n = pisz(n, v.x - cx * hx * 0.5, v.y - cy * hx * 0.5, 7, 0.04, 3.2 * a, 0.05, 0.02);
            break;
          }
          case 2: { // policja: błysk ≤ 2 Hz, niebieski / czerwony na zmianę
            const f = (bBlysk * 1.8 + v.hash) % 1;
            const on = f < 0.14 ? 1 : (f > 0.5 && f < 0.64) ? 2 : 0;
            if (on) {
              const kol = on === 1 ? [0.5, 1.0, 4.2] : [3.8, 0.1, 0.08];
              n = pisz(n, v.x, v.y, 26, 0.16, kol[0] * a, kol[1] * a, kol[2] * a);
            }
            n = pisz(n, v.x + cx * hx * 0.8, v.y + cy * hx * 0.8, 6, 0.04, 1.8 * a, 1.9 * a, 2.0 * a);
            break;
          }
          case 3: { // turystyka: złota girlanda wzdłuż burt
            for (const d of [-0.32, -0.16, 0, 0.16, 0.32]) {
              const bx = -cy * 30;
              const by = cx * 30;
              n = pisz(n, v.x + cx * v.L * d + bx, v.y + cy * v.L * d + by, 5, 0.03, 1.5 * a, 1.05 * a, 0.42 * a);
              n = pisz(n, v.x + cx * v.L * d - bx, v.y + cy * v.L * d - by, 5, 0.03, 1.5 * a, 1.05 * a, 0.42 * a);
            }
            break;
          }
          default: { // frachtowce: dwa białe światła masztowe, odstęp mówi o wielkości; czerwone przy hamowaniu
            const k = v.kod >= 7 ? 16 : 11;
            n = pisz(n, v.x + cx * hx * 0.72, v.y + cy * hx * 0.72, k, 0.07, 1.9 * a, 2.0 * a, 2.1 * a);
            n = pisz(n, v.x - cx * hx * 0.5, v.y - cy * hx * 0.5, k, 0.07, stop ? 3.6 * a : 1.9 * a, stop ? 0.06 : 2.0 * a, stop ? 0.03 : 2.1 * a);
            break;
          }
        }
      }
      sw.g.instanceCount = n;
      sw.bufor.needsUpdate = true;
    }
  };
}
void int; void vec2; void min; void floor; void length; void mod; void HW; void TAU;
