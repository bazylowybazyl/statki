// dema/autostrada/styl-rama.js
//
// STYL „RAMA” — piąta propozycja (2026-11-12). Inna zasada niż cztery poprzednie: droga nie jest rysunkiem ze światła na przyciemnionym
// niebie, tylko CIEMNĄ TAFLĄ — płytą ze szczotkowanej stali o ostrych krawędziach, która zasłania jasne niebo gry. Kontrast niesie
// ciemność płyty, a światło pojawia się tam, gdzie pada naprawdę:
//   - połysk szczotkowanej płyty zależy od kąta jezdni do Słońca (jezdnia w poprzek kierunku do Słońca błyszczy; na łuku naroża
//     połysk wędruje),
//   - każdy pojazd oświetla taflę przed dziobem (stożek reflektorów jak na mokrym asfalcie), hamowanie daje czerwone odbicie za rufą,
//     policja — niebieski i czerwony rozbłysk na płycie; kolejka przed czerwonym to łańcuch czerwonych odbić,
//   - czerwone i żółte baru stopu odbija się w płycie przed linią; pasy stoczni zapalają krawędzie tylko w fazie przejazdu.
// Układ: sieć „Rama” (siec-rama.js) — kwadrat czterech prostych, naroża opływają stocznie. Makieta stoczni to obrys i zasięg, nie projekt.
// Linie cieńsze niż ~3 px trzymają szczyt ≤ 0,85 (próg bloomu); nad progiem świeci tylko sygnał z bazy.
import * as THREE from 'three/webgpu';
import {
  attribute, float, vec2, vec3, vec4, max, min, abs, mix, exp, clamp, smoothstep, varying, positionGeometry, positionLocal, step, sin, cos,
  fract, floor, dot, fwidth, modelViewMatrix
} from 'three/tsl';
import { U, sladPikselaW, materialAddytywny, zaKula, linia, przerywana } from './wspolne.tsl.js';
import { bryla, polacz, zbudujBryly } from './baza3d.js';
import { RODZAJ } from './wstegi.js';
import { HW, R0, DEG, complexes, hubToWorld } from './siec.js';
import { RAMA } from './siec-rama.js';
import { resolveRingPlanetWorldRadius } from '../../src/3d/ringScale.js';

const CAP_KALUZ = 6144;
const KA_STRIDE = 12;
const BLOB = 0;      // plama Gaussa (rozbłysk, odbicie sygnału)
const STOZEK = 1;    // stożek reflektorów: od dziobu w przód, rozszerza się i gaśnie

const jest = (rodzaj, k) => float(1).sub(step(0.5, abs(rodzaj.sub(k))));
// Przesłona tarczą Ziemi w kamerze kinowej (pass płaszczyzny gry nie ma głębi planet).
const zaZiemia = (nazwa) => varying(mix(float(1), zaKula(modelViewMatrix.mul(vec4(positionLocal, 1)).xyz, modelViewMatrix.mul(vec4(0, 0, 0, 1)).xyz, max(U.rZiemi, 1)), step(1, U.rZiemi)), nazwa);
const los2 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

function materialMnozacy(alfa, nazwa) {
  const m = new THREE.NodeMaterial();
  m.name = nazwa;
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
  return m;
}

// ---------------------------------------------------------------------------
// Tafla: mnożenie nieba pod płytą, ostra krawędź (filtr na śladzie piksela)

function zbudujTafle(geom) {
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const vV = varying(aSV.y, 'vTaV');
  const vM = varying(aMeta, 'vTaM');
  const rodzaj = vM.x;
  const pol = vM.y;
  const fw = max(fwidth(vV), 1e-3);
  const wPlycie = float(1).sub(smoothstep(pol.sub(fw), pol.add(fw), abs(vV)));
  const glowna = float(1).sub(step(1.5, rodzaj));
  const rampy = step(2.5, rodzaj).mul(float(1).sub(step(7.5, rodzaj)));
  const fazaK7 = U.sygnaly.element(aMeta.w.max(0).toInt()).w;
  const vBox = varying(step(1.5, fazaK7).mul(float(1).sub(step(3.5, fazaK7))), 'vTaBox');
  // Jezdnie: prawie czerń. Pas rozdziału: przydymiona szczelina (widać przez nią niebo — dwie osobne płyty). Rampy jak jezdnia.
  // Pasy stoczni i drogi ciężkich to nie płyta: ledwie cień korytarza, pasy stoczni ciemnieją dopiero w fazie przejazdu.
  const sila = glowna.mul(0.9)
    .add(jest(rodzaj, RODZAJ.ROZDZIAL).mul(0.34))
    .add(rampy.mul(0.84))
    .add(jest(rodzaj, RODZAJ.PUDLO).mul(mix(float(0.1), float(0.34), vBox)))
    .add(jest(rodzaj, RODZAJ.CIEZKI).mul(0.2));
  const mesh = new THREE.Mesh(geom, materialMnozacy(wPlycie.mul(sila).mul(zaZiemia('vTaZ')), 'rama-tafla'));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = 'RamaTafla';
  return mesh;
}

// ---------------------------------------------------------------------------
// Połysk i ryty: krawężniki, linie pasów, połysk szczotkowanej płyty wg kąta do Słońca, pasy stoczni w fazie przejazdu

function zbudujPolysk(geom) {
  const aSV = attribute('aSV', 'vec2');
  const aMeta = attribute('aMeta', 'vec4');
  const aTan = attribute('aTan', 'vec2');
  const vV = varying(aSV.y, 'vPoV');
  const vS = varying(aSV.x, 'vPoS');
  const vM = varying(aMeta, 'vPoM');
  const vT = varying(aTan, 'vPoT');
  const rodzaj = vM.x;
  const pol = vM.y;
  const fw = max(fwidth(vV), 1e-3);
  const fwS = max(fwidth(vS), 1e-3);
  const wPlycie = float(1).sub(smoothstep(pol.sub(fw), pol.add(fw), abs(vV)));
  const glowna = float(1).sub(step(1.5, rodzaj));
  const zewn = step(0.5, rodzaj).mul(glowna);
  const rampy = step(2.5, rodzaj).mul(float(1).sub(step(7.5, rodzaj)));
  // w: +pol = krawędź płyty od strony pobocza, −pol = od strony pasa rozdziału (jezdnia zewnętrzna jest lustrem wewnętrznej).
  const w = mix(vV, vV.negate(), zewn);
  // Drobne ryty (linie pasów) gasną w dalekim kadrze: zostaje obrys płyt.
  const blisko = smoothstep(0.012, 0.035, U.zoom);

  // Połysk: szczotkowanie wzdłuż jezdni rozprasza światło w poprzek — płyta błyszczy, gdy jezdnia stoi w poprzek kierunku do Słońca.
  const wzdluzSlonca = dot(vT, U.slonce.xy);
  const g1 = float(1).sub(wzdluzSlonca.mul(wzdluzSlonca)).clamp(0, 1);
  const g2 = g1.mul(g1);
  const blysk = g2.mul(g2).mul(g1);
  // Pasma szczotkowania: stałe wzdłuż jezdni, losowe w poprzek; z daleka (pasmo < 1 px) średnia.
  const pasmo = los2(vec2(floor(vV.div(11)), rodzaj.add(3)));
  const pasmoWidac = float(1).sub(smoothstep(5, 16, fw));
  const szczotka = mix(float(1), pasmo.mul(1.2).add(0.4), pasmoWidac);
  const polysk = vec3(0.5, 0.63, 0.88).mul(blysk.mul(0.05).add(0.007)).mul(szczotka);

  // Jezdnia główna: krawężniki (jaśniejszy od strony pobocza), linia pobocza, przerywane linie pasów.
  const kraw = linia(abs(vV).sub(pol.sub(9)), float(7), fw).mul(mix(float(0.3), float(0.56), step(0, w)));
  const pobocze = linia(w.sub(320), float(3.5), fw).mul(0.16);
  const kreski = przerywana(vS, float(1100), float(0.38), fwS);
  const pasy = linia(w.sub(80), float(3.5), fw).add(linia(w.add(320), float(3.5), fw)).mul(kreski).mul(0.26);
  const rytGlowny = vec3(0.6, 0.72, 0.88).mul(kraw.add(pobocze.add(pasy).mul(blisko)));

  // Rampy, zawrotki, wrota: same krawędzie, cieńsze i słabsze.
  const rytRamp = vec3(0.6, 0.72, 0.88).mul(linia(abs(vV).sub(pol.sub(6)), float(4.5), fw).mul(0.28));

  // Pas rozdziału: grzbiet — długa przerywana linia w osi szczeliny.
  const rytRozdz = vec3(0.5, 0.62, 0.8).mul(linia(vV, float(5), fw).mul(przerywana(vS, float(2600), float(0.72), fwS)).mul(0.15).mul(blisko));

  // Pasy stoczni: krawędzie zielono-białe tylko w fazie przejazdu (i tuż przed), poza nią ledwie zarys koryta.
  const fazaK7 = U.sygnaly.element(aMeta.w.max(0).toInt()).w;
  const vBox = varying(step(1.5, fazaK7).mul(float(1).sub(step(3.5, fazaK7))), 'vPoBox');
  // Pochylnie (wylot ze stoczni) świecą pełnią; pasy ciężkich wzdłuż burt tylko zaznaczone — inaczej naroże to dwanaście zielonych linii.
  const krawPudla = linia(abs(vV).sub(pol.sub(8)), float(6), fw);
  const pochylnia = step(1.5, vM.z);
  const rytPudla = mix(vec3(0.3, 0.36, 0.44).mul(0.14), vec3(0.4, 0.8, 0.58).mul(mix(float(0.22), float(0.72), pochylnia)), vBox).mul(krawPudla);
  const rytCiezki = vec3(0.4, 0.48, 0.58).mul(linia(abs(vV).sub(pol.sub(8)), float(5), fw)).mul(0.07);

  const wyj = polysk.mul(glowna.add(rampy.mul(0.7)))
    .add(rytGlowny.mul(glowna))
    .add(rytRamp.mul(rampy))
    .add(rytRozdz.mul(jest(rodzaj, RODZAJ.ROZDZIAL)))
    .add(rytPudla.mul(jest(rodzaj, RODZAJ.PUDLO)))
    .add(rytCiezki.mul(jest(rodzaj, RODZAJ.CIEZKI)))
    .mul(wPlycie).mul(zaZiemia('vPoZ'));
  const m = materialAddytywny(vec4(clamp(wyj, vec3(0), vec3(0.85)), 1), null, 'rama-polysk');
  const mesh = new THREE.Mesh(geom, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'RamaPolysk';
  return mesh;
}

// ---------------------------------------------------------------------------
// Odbicia świateł w tafli: stożki reflektorów i plamy (instancje, przepisywane co klatkę)

function zbudujKaluze() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const bufor = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP_KALUZ * KA_STRIDE), KA_STRIDE, 1);
  bufor.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));   // x, y (środek kwadu), kurs, rodzaj (BLOB / STOZEK)
  g.setAttribute('iB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));   // σ wzdłuż, σ w poprzek, najmniejszy udział z daleka, —
  g.setAttribute('iC', new THREE.InterleavedBufferAttribute(bufor, 4, 8));   // r, g, b, —
  g.instanceCount = 0;
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  const typ = iA.w;
  const slad = sladPikselaW(vec3(iA.x, iA.y, 0));
  const sL = max(iB.x, slad.mul(0.9));
  const sW = max(iB.y, slad.mul(0.9));
  // Plama mniejsza niż piksel rośnie do piksela z zachowaną energią; `iB.z` trzyma ślad ruchu z dalekiego kadru.
  const zach = max(iB.x.div(sL).mul(iB.y.div(sW)), iB.z);
  // Zasięg kwadu: plama 2,7 σ w obie strony; stożek — długość 2 σ (od dziobu), pół szerokości 2,2 σ.
  const kx = mix(float(2.7), float(1), typ);
  const ky = mix(float(2.7), float(2.2), typ);
  const c = cos(iA.z);
  const s = sin(iA.z);
  const lx = positionGeometry.x.mul(sL).mul(kx);
  const ly = positionGeometry.y.mul(sW).mul(ky);
  const swiat = vec2(iA.x.add(lx.mul(c)).sub(ly.mul(s)), iA.y.add(lx.mul(s)).add(ly.mul(c)));
  const vP = varying(positionGeometry.xy, 'vKaP');
  const vK = varying(iC.rgb.mul(zach), 'vKaK');
  const vTyp = varying(typ, 'vKaT');
  // Plama: Gauss. Stożek: t = 0 przy dziobie … 1 na końcu zasięgu; gaśnie wykładniczo i rozszerza się (całka w poprzek stała).
  const pb = vP.mul(2.7);
  const plama = exp(dot(pb, pb).mul(-0.5));
  const t = vP.x.mul(0.5).add(0.5);
  const szer = t.mul(0.75).add(0.3);
  const q = vP.y.mul(2.2).div(szer);
  const stozek = smoothstep(0, 0.07, t).mul(exp(t.mul(-3.3))).mul(float(1).sub(smoothstep(0.8, 1, t)))
    .mul(exp(q.mul(q).mul(-0.5))).mul(float(0.3).div(szer));
  const blask = mix(plama, stozek, vTyp);
  const m = materialAddytywny(vec4(clamp(vK.mul(blask), vec3(0), vec3(4)), 1), vec3(swiat, 0), 'rama-odbicia');
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'RamaOdbicia';
  return { mesh, bufor, g };
}

// ---------------------------------------------------------------------------
// Makieta stoczni: obrys i zasięg (burty, grzbiet, suwnice bramowe nad pochylniami, portal głowicy) — nie projekt bryły

function geometriaStoczni(zasieg) {
  // Lokalnie: X = promieniowo od początku huba (R0), Y = wzdłuż ringu. Kratownica nad statkami (pass FG).
  const z0 = RAMA.zBramyK7;
  const dl = zasieg - z0;
  const sr = (z0 + zasieg) * 0.5;
  const pol = RAMA.stoczniaPol;
  const czesci = [
    bryla(dl, 200, 110, sr, pol - 100, 150),
    bryla(dl, 200, 110, sr, -(pol - 100), 150),
    bryla(dl, 240, 90, sr, 0, 160),
    // korzeń przy bramie dawnej hali i portal głowicy
    bryla(520, pol * 2 + 240, 60, z0 + 260, 0, 205),
    bryla(170, pol * 2 + 280, 44, zasieg - 85, 0, 224)
  ];
  for (const y of [-pol, 0, pol]) czesci.push(bryla(300, 320, 190, zasieg - 150, y, 120));
  const n = Math.max(2, Math.round(dl / 2400));
  for (let i = 1; i < n; i++) {
    const x = z0 + (dl * i) / n;
    czesci.push(bryla(26, pol * 2 + 160, 12, x - 40, 0, 226), bryla(26, pol * 2 + 160, 12, x + 40, 0, 226));
    for (let y = -pol; y <= pol; y += 500) czesci.push(bryla(106, 16, 8, x, y, 226));
    // wózki suwnic nad pochylniami, przesunięte co bramę
    const przes = ((i * 37) % 5 - 2) * 110;
    for (const yp of [-810, 810]) czesci.push(bryla(130, 180, 30, x, yp + przes, 208));
  }
  return polacz(czesci);
}

// Dno doku: ciemna płyta pod pochylniami (pod statkami) w obrysie bryły + cienki obrys i osie pochylni.
function zbudujDnoDoku(zasieg) {
  const pol = RAMA.stoczniaPol + 90;
  const z0 = RAMA.zBramyK7 - 60;
  const z1 = zasieg + 60;
  const dl = (z1 - z0) * 0.5;
  const pos = [];
  const lok = [];
  const idx = [];
  complexes().forEach((c, k) => {
    const o = k * 4;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = hubToWorld(c, sx * pol, sz > 0 ? z1 : z0);
      pos.push(p.x, p.y, 0);
      lok.push(sx * pol, sz * dl, pol, dl);
    }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aLok', new THREE.BufferAttribute(new Float32Array(lok), 4));   // x w poprzek, z wzdłuż (od środka), pół szerokości, pół długości
  g.setIndex(idx);
  const aLok = attribute('aLok', 'vec4');
  const vL = varying(aLok, 'vDoL');
  const odKrawedzi = min(vL.z.sub(abs(vL.x)), vL.w.sub(abs(vL.y)));
  const fw = max(fwidth(odKrawedzi), 1e-3);
  const wSrodku = smoothstep(fw.negate(), fw, odKrawedzi);
  const dno = new THREE.Mesh(g, materialMnozacy(wSrodku.mul(0.66).mul(zaZiemia('vDoZ')), 'rama-dno-doku'));
  dno.frustumCulled = false;
  dno.renderOrder = 1;
  dno.name = 'RamaDnoDoku';
  // Obrys w barwie lamp roboczych i przerywane osie obu pochylni.
  const fwX = max(fwidth(vL.x), 1e-3);
  const fwY = max(fwidth(vL.y), 1e-3);
  const obrys = linia(odKrawedzi.sub(14), float(8), fw).mul(0.3);
  const osie = linia(abs(vL.x).sub(810), float(5), fwX).mul(przerywana(vL.y, float(900), float(0.5), fwY)).mul(0.16);
  const ryt = vec3(1.0, 0.72, 0.36).mul(obrys).add(vec3(0.55, 0.68, 0.85).mul(osie)).mul(wSrodku).mul(zaZiemia('vDoZ2'));
  const rysunek = new THREE.Mesh(g, materialAddytywny(vec4(clamp(ryt, vec3(0), vec3(0.85)), 1), null, 'rama-dno-ryt'));
  rysunek.frustumCulled = false;
  rysunek.renderOrder = 2;
  rysunek.name = 'RamaDnoRyt';
  return [dno, rysunek];
}

// ---------------------------------------------------------------------------

const KRAWEDZIE = Object.freeze([
  Object.freeze({ cw: 0, r: (HW.edgeIn + HW.iL1 + HW.widths.L1 * 0.5) * 0.5 }),
  Object.freeze({ cw: 1, r: (HW.edgeOut + HW.oL1 - HW.widths.L1 * 0.5) * 0.5 })
]);

export function utworzRame(ctx) {
  const { grupa, siec } = ctx;
  const geo = siec.geo;
  const tafla = zbudujTafle(ctx.geomWstegi);
  const polysk = zbudujPolysk(ctx.geomWstegi);
  const ka = zbudujKaluze();
  const [dno, dnoRyt] = zbudujDnoDoku(siec.rama.zasieg);
  const stocznia = zbudujBryly(
    complexes().map((c) => ({ x: R0 * Math.cos(c * DEG), y: R0 * Math.sin(c * DEG), kat: c, skala: 1 })),
    geometriaStoczni(siec.rama.zasieg), 'RamaStocznia', [0.3, 0.32, 0.35]
  );
  const siatki = [tafla, polysk, dno, dnoRyt, ka.mesh, stocznia];
  for (const m of siatki) grupa.add(m);

  const dane = ka.bufor.array;
  const _p = { x: 0, y: 0, h: 0, kr: 0 };
  let n = 0;
  const pisz = (typ, x, y, kurs, sL, sW, r, g, b, zDaleka = 0.04) => {
    if (n >= CAP_KALUZ) return;
    const o = n * KA_STRIDE;
    dane[o] = x; dane[o + 1] = y; dane[o + 2] = kurs; dane[o + 3] = typ;
    dane[o + 4] = sL; dane[o + 5] = sW; dane[o + 6] = zDaleka; dane[o + 7] = 0;
    dane[o + 8] = r; dane[o + 9] = g; dane[o + 10] = b; dane[o + 11] = 0;
    n++;
  };

  return {
    id: 'rama',
    nazwa: 'Rama',
    opis: 'inny układ i inna zasada: kwadrat czterech prostych opływa stocznie, a droga to ciemna tafla, w której odbijają się światła',
    siatki,
    podklad: 0,
    podkladRamp: 0,
    podkladRozdzial: 0,
    tory: 1,
    barBazy: 1,
    promienZiemi: resolveRingPlanetWorldRadius(ctx.ziemia),
    aktualizuj(kl) {
      const ruch = ctx.ruch;
      const lista = ruch.pojazdy;
      const blysk = ctx.baza ? ctx.baza.blysk : 0;
      // Z daleka stożki reflektorów rosną (do 3×): ruch ma być czytelny w kadrze węzła i całej ramy, a z bliska zostaje skala 1:1.
      const kz = Math.min(2.6, Math.max(1, Math.pow(0.13 / Math.max(kl.zoom, 1e-3), 0.55)));
      n = 0;
      for (let i = 0; i < lista.length; i++) {
        const v = lista[i];
        const a = v.alfa;
        if (a < 0.05) continue;
        const cx = Math.cos(v.h);
        const cy = Math.sin(v.h);
        const pol = v.L * 0.5;
        const szer = Math.max(20, v.k.W * 0.42 + 12);
        if (v.kod === 3) {
          // Turystyka: złota poświata pod całym kadłubem zamiast reflektorów.
          pisz(BLOB, v.x, v.y, v.h, v.L * 0.55, v.k.W * 0.7, 0.3 * a, 0.21 * a, 0.085 * a);
        } else {
          // Reflektory: stożek od dziobu, dłuższy z prędkością; stojący świeci słabiej (światła postojowe).
          const sL = (60 + v.L * 0.3 + v.vel * 0.08) * kz;
          const moc = (0.55 + 0.6 * Math.min(1, v.vel / 400)) * a;
          const dx = pol + sL;
          pisz(STOZEK, v.x + cx * dx, v.y + cy * dx, v.h, sL, szer * (0.6 + 0.4 * kz), 1.0 * moc, 0.92 * moc, 0.78 * moc, 0.1);
        }
        if (v.hamuje) {
          // Światła stopu: krótkie czerwone odbicie tuż za rufą.
          const sH = (26 + v.L * 0.1) * (0.5 + 0.5 * kz);
          const dh = pol + sH * 1.2;
          pisz(BLOB, v.x - cx * dh, v.y - cy * dh, v.h, sH, szer * 0.8, 0.62 * a, 0.022 * a, 0.01 * a, 0.08);
        }
        if (v.kod === 2) {
          // Policja: rozbłysk na płycie zgrany z lampą na kadłubie (ten sam zegar co baza).
          const f = (blysk * 1.8 + v.hash) % 1;
          if (f < 0.14) pisz(BLOB, v.x, v.y, v.h, 170, 170, 0.14 * a, 0.32 * a, 1.3 * a, 0.1);
          else if (f > 0.5 && f < 0.64) pisz(BLOB, v.x, v.y, v.h, 170, 170, 1.2 * a, 0.04 * a, 0.026 * a, 0.1);
        }
      }
      // Sygnał w tafli: czerwone albo żółte baru stopu odbija się przed linią na całą szerokość jezdni (widać z dalekiego kadru).
      for (const w of ruch.K7) {
        if (w.stan === 0) continue;
        for (const j of KRAWEDZIE) {
          // Plama wyciągnięta pod prąd od linii stopu, w poprzek mieści się w płycie (bar z lamp zostaje ostrą kreską na jej końcu).
          geo.poza(j.cw, w.sStop[j.cw] - 900, j.r, _p);
          if (w.stan === 2) pisz(BLOB, _p.x, _p.y, _p.h, 620, 310, 0.85, 0.02, 0.008, 0.3);
          else pisz(BLOB, _p.x, _p.y, _p.h, 620, 310, 0.6, 0.27, 0.02, 0.3);
        }
      }
      // Atlas nad jezdnią: chłodna łuna dysz przesuwa się po płycie razem z okrętem (tylko nad taflą).
      const at = ruch.atlas;
      if (at.stan === 'lot') {
        const r = geo.rPunktu(at.xs, at.ys);
        const nad = Math.max(0, Math.min(1, (r - (HW.edgeIn - 700)) / 700)) * Math.max(0, Math.min(1, (HW.edgeOut + 700 - r) / 700));
        if (nad > 0.01) pisz(BLOB, at.xs - Math.cos(at.kat) * 700, at.ys - Math.sin(at.kat) * 700, at.kat, 850, 380, 0.2 * nad, 0.26 * nad, 0.36 * nad, 0.2);
      }
      ka.g.instanceCount = n;
      ka.bufor.needsUpdate = true;
    }
  };
}
utworzRame.swiat = 'rama';
