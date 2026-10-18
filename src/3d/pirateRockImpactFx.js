// src/3d/pirateRockImpactFx.js
//
// UDERZENIA W PLANETOIDĘ pod bazą piratów (misja 1) — obraz. Prośba użytkownika 2026-10-19: przy zniszczeniu habitatu
// wieża przebija dysk mieszkalny i spada na planetoidę, za nią dysk i reszta bazy — „brak dymu / efektu upadku, uderzenia
// w planetę przez większe / mniejsze rzeczy”. Fizykę upadku liczy gra (sesja orkiestratora); tu — efekt UDERZEŃ
// z rekordów ROCK_IMPACT (src/render/rockImpactRecord.js; pisze src/game/story/pirateRockImpacts.js).
//
// Skała to lodowy centaur (ciemny regolit z lodem): szybkie uderzenie odparowuje lód — para + pył. Warstwy:
//   • GAZ (siatka 3D w compute — src/3d/gas/, „fajne efekty dymu” wybuchów) w GŁĘBOKIEJ domenie (GasSlot.deep — pass TŁA,
//     kamera perspektywy jak skała; ExplosionFx.deepDomain): kula-przeszkoda = skała (gaz rozlewa się po niej — pierścień
//     pyłu „base surge” liczy sam płyn), pióropusz pary wzdłuż normalnej, stożek wyrzutu, strumienie styczne (pierścień),
//     kłąb w miejscu; bliskie uderzenia dokładają się do żywej domeny (scalanie), sufit domen uderzeń, zapas wolnych domen
//     dla wybuchów w płaszczyźnie gry;
//   • CZĄSTKI (dwie partie TSL, JEDEN rysunek na rodzaj mieszania, pass tła): KURTYNA WYRZUTU — odłamki skały po łukach
//     balistycznych ku środkowi skały (grawitacja z PIRATE_ROCK_SPEC.gravity — próżnia, bez oporu: wolno, bez „wiszenia”),
//     czas lądowania na kuli liczony na CPU przy wyrzucie (Newton), po lądowaniu odłamek zamienia się w mały kłąb pyłu
//     (promienie wtórnych kłębów); pył kurtyny; PIERŚCIEŃ PYŁU ślizgający się po powierzchni (rzut na kulę w shaderze);
//     kłęby; ISKRY (metal o skałę), BŁYSK i ŻAR KRATERU (szybkie uderzenia, addytywnie, HDR — bloom); małe uderzenia —
//     same cząstki (krótkie kłęby i iskry); szorowanie — ciągły ślad pyłu za ciałem.
// Cząstki oświetla słońce skały (kierunek z płaszczyzny gry — jak materiał skały) z cieniem kuli liczonym w shaderze
// (pył nad terminatorem łapie światło, pył w cieniu skały gaśnie do otoczenia).
//
// Układ: siatki cząstek siedzą w ŚRODKU SKAŁY (scena, double — modelViewMatrix na CPU), pozycje cząstek względem niego —
// test kuli w shaderze to length(p). Scena Core3D: x = x gry, y = −y gry, z = wysokość. Czas = czas gry (update(dt) —
// pauza stoi). Losowanie tylko fxRandom.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, attribute, positionGeometry, varyingProperty, vec2, vec3, vec4, float, uniform, clamp, max, min, mix,
  smoothstep, length, normalize, dot, exp, select, texture, modelViewMatrix, cameraProjectionMatrix, sqrt, abs, pow
} from 'three/tsl';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { fxNoise } from './fx/noise.js';
import { fxRandom } from './fx/fxRandom.js';
import { ROCK_IMPACT_CODE, ROCK_IMPACT_REC, ROCK_EVENT, ROCK_BODY_KINDS } from '../render/rockImpactRecord.js';
import { PIRATE_ROCK_SPEC } from './portBuildings/pirateRockLayout.js';
import { zbierzZakres } from './zakresyWysylki.js';

const TAU = Math.PI * 2;

/** Rodzaje cząstek (kod w rekordzie instancji). */
export const RIP = Object.freeze({ CHUNK: 0, SURF: 1, PUFF: 2, SPARK: 3, FLASH: 4, GLOW: 5, DUST: 6 });

/** Pojemności pierścieni (rekordy cząstek): partia pyłu i odłamków (mieszanie zwykłe) i partia świecąca (addytywna). */
export const ROCK_FX_CAP_ALPHA = 8192;
export const ROCK_FX_CAP_ADD = 2048;
const STRIDE = 20;   // p0 xyz, t0 | v0 xyz, tLand | life, kind, size0, size1 | drag, seed, lift, grav | rgb, a

/** Strojenie (konsola, tryb off: window.PirateRock.state().impact.tune). */
export const ROCK_IMPACT_FX_TUNE = {
  enabled: true,
  gas: true,              // domeny gazu (false — same cząstki)
  particles: true,
  gravity: PIRATE_ROCK_SPEC.gravity,   // [j/s²] ku środkowi skały
  // skala uderzenia: q = (v − speed0) / speedK (0 … qMax) — prędkość wzdłuż normalnej rozstrzyga o parze, błysku, żarze
  speed0: 150,
  speedK: 1800,
  qMax: 1.6,
  // obłok gazu: promień = size × (cloudBase + cloudQ · q), w [cloudMin, cloudMax]; bok domeny = promień × domainScale
  cloudBase: 0.8,
  cloudQ: 0.55,
  cloudMin: 140,
  cloudMax: 3400,
  // domena uderzenia: szerokość = domainScale × promień obłoku, wysokość = NZ / N szerokości (płaska); środek przesunięty
  // wzdłuż normalnej o gasUpShift × wysokość — punkt uderzenia blisko środka wysokości, gdzie elipsoida domeny jest
  // najszersza (pierścień pyłu po skale), pióropusz w górnej połowie (dopasowany prędkością — _fitSpeed)
  domainScale: 5.6,
  gasUpShift: 0.12,
  gasCoast: 0.6,          // [s] droga gazu po wygaśnięciu strumienia ≈ prędkość × gasCoast (dopasowanie zasięgu do domeny)
  gasMinPx: 9,            // promień obłoku na ekranie [px], od którego uderzenie dostaje własną domenę gazu
  // atlas domeny wg promienia obłoku na ekranie [px]: „fine” (128² × 48, 41 iteracji Jacobiego — najdroższy) dopiero przy
  // zbliżeniu (kamery 3D), poniżej gasCoarseMaxPx — „coarse”, pomiędzy — podstawowy (pomiar 2026-10-19: demo upadku z dwiema
  // domenami „fine” — compute p95 +1,5 ms na klatkach kroku gazu)
  gasFineMinPx: 150,
  gasCoarseMaxPx: 55,
  gasMinSize: 120,        // [j.] ciało mniejsze (odłamy) — bez gazu, same cząstki
  scarMinSize: 90,        // [j.] ciało mniejsze — bez trwałego śladu na skale
  gasDomains: 6,          // sufit domen uderzeń naraz
  gasReserve: 2,          // wolnych domen zostawionych wybuchom w płaszczyźnie gry
  gasLife: 7.5,           // [s] życie domeny po ostatnim zasileniu (potem wygaszanie gasFade)
  gasFade: 3.0,
  gasDecay: -0.38,        // stały zanik dymu domeny [1/s] (ujemny = pył trzyma się dłużej niż dym wybuchów — 0,545/s globalnie)
  gasTint: [1.75, 1.66, 1.56],   // barwa pyłu (× albedo sadzy gry 0,15 — szary regolit z lodem)
  gasSmoke: 0.6,
  // otoczenie domeny gazu uderzenia (światło odbite od oświetlonej skały pod obłokiem — cień kłębów nie jest czarny):
  // gasAmbient0 + gasAmbientSun × max(0, n · słońce) w punkcie uderzenia; jednostka — światło przed albedo (jak słońce)
  gasAmbient0: 0.2,
  gasAmbientSun: 0.45,
  // wybuch w głębi (deepBlast — przebicie dysku mieszkalnego): domena, życie, barwa (pył, szron, dym), otoczenie,
  // nośnik (× prędkość z rekordu), odłamki konstrukcji
  blastDomainScale: 5.0,
  blastLife: 6.0,
  blastTint: [1.5, 1.46, 1.42],
  blastAmbient: 0.3,
  blastCarrier: 1.0,
  blastChunkMax: 420,
  blastChunkK: 0.32,
  // budżet cząstek: ułamek pojemności pierścienia zużyty w ostatnich ~2 s, ponad który liczby cząstek nowych uderzeń maleją
  budgetSoft: 0.55,
  // cząstki
  chunkMax: 700,          // odłamków na jedno uderzenie (sufit)
  chunkK: 0.34,           // odłamków na j. promienia ciała × (0,4 + q)
  dustK: 0.07,            // pyłu kurtyny na j. promienia
  surfK: 0.05,            // pyłu pierścienia na j. promienia
  sparkMax: 90,
  minPxChunk: 1.6,        // najmniejszy promień na ekranie [px]
  minPxDust: 2.2,
  minPxSpark: 0.9,
  albedoDust: [0.21, 0.185, 0.16],
  albedoChunk: [0.075, 0.07, 0.068],
  sunGain: 1.35,
  ambient: 0.05,
  scrapeDust: 3,          // kłębów pyłu na zdarzenie szorowania
  flashGain: 1.0,
  glowGain: 1.0
};

function makePool(kind, U, cap, layer) {
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const arr = new Float32Array(cap * STRIDE);
  for (let i = 0; i < cap; i++) { arr[i * STRIDE + 3] = 1e9; arr[i * STRIDE + 8] = 0; }
  const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.setAttribute('iD', new THREE.InterleavedBufferAttribute(buf, 4, 12));
  geo.setAttribute('iE', new THREE.InterleavedBufferAttribute(buf, 4, 16));
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const mat = new THREE.NodeMaterial();
  const add = kind === 'add';
  mat.name = add ? 'RockImpactGlow' : 'RockImpactDust';
  mat.lights = false;
  mat.fog = false;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  if (add) blendAddytywnePremul(mat);
  const g = buildGraph(add, U);
  mat.vertexNode = g.vertexNode;
  mat.fragmentNode = g.fragmentNode;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = mat.name;
  mesh.frustumCulled = false;
  // pył i odłamki przed gazem (gaz zasłania to, co w obłoku), świecące po nim (błysk widać przez rodzący się obłok)
  mesh.renderOrder = add ? 13 : 9;
  mesh.layers.set(layer);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  return { mesh, geo, arr, buf, cap, head: 0, hi: 0, lo: Infinity, used: 0, lastT: -1e9 };
}

/**
 * Graf cząstek (raz na rodzaj mieszania). Instancja = rekord pierścienia (STRIDE liczb). Pozycja względem środka skały:
 * CHUNK / SPARK / DUST — łuk balistyczny ze stałą grawitacją ku środkowi (kierunek z punktu wyrzutu), do lądowania
 * (tLand — CPU); SURF — ruch styczny z oporem i rzut na kulę (promień w punkcie wyrzutu + uniesienie); PUFF — ruch
 * z oporem; FLASH / GLOW — w miejscu.
 * Wierzchołki w PRZESTRZENI WIDOKU (vertexNode): kwad zawsze do kamery (z góry i w kamerach 3D), przesunięty ku kamerze
 * wzdłuż promienia widzenia o swój promień × shiftK z zachowaniem rozmiaru na ekranie — pochyła powierzchnia skały nie
 * tnie kwadu przy pyle leżącym na niej (płaski kwad w płaszczyźnie sceny wchodził połową w teren — twarda linia cięcia).
 * Smugi (iskry, szybkie odłamki) — oś wzdłuż rzutu prędkości na płaszczyznę kadru.
 */
function buildGraph(add, U) {
  const A = attribute('iA', 'vec4');
  const B = attribute('iB', 'vec4');
  const C = attribute('iC', 'vec4');
  const D = attribute('iD', 'vec4');
  const E = attribute('iE', 'vec4');
  const vLocal = varyingProperty('vec2', add ? 'vRiaL' : 'vRipL');
  const vInfo = varyingProperty('vec4', add ? 'vRiaI' : 'vRipI');   // rodzaj, wiek 0..1, lądowanie 0..1, ziarno
  const vCol = varyingProperty('vec4', add ? 'vRiaC' : 'vRipC');    // barwa (oświetlona), alfa / moc
  const vertexNode = Fn(() => {
    const local = positionGeometry.xy;
    const t0 = A.w;
    const age = U.uTime.sub(t0).toVar();
    const life = max(C.x, 1e-3);
    const u = clamp(age.div(life), 0.0, 1.0).toVar();
    const alive = age.greaterThanEqual(0.0).and(age.lessThan(life));
    const kind = C.y.toVar();
    const p0 = A.xyz;
    const v0 = B.xyz;
    const tLand = B.w;
    const r0 = length(p0).toVar();
    const lift = D.z;
    const rs = r0.sub(lift).toVar();                 // promień powierzchni w punkcie wyrzutu
    const pos = vec3(p0).toVar();
    const vel = vec3(0.0).toVar();
    const land = float(0.0).toVar();
    const isBal = kind.lessThan(0.5).or(abs(kind.sub(3.0)).lessThan(0.5)).or(abs(kind.sub(6.0)).lessThan(0.5));
    If(isBal, () => {
      const tl = min(max(age, 0.0), tLand);
      const gdir = p0.negate().div(max(r0, 1.0));
      const pb = p0.add(v0.mul(tl)).add(gdir.mul(D.w.mul(0.5).mul(tl).mul(tl))).toVar();
      vel.assign(v0.add(gdir.mul(D.w.mul(tl))));
      If(age.greaterThan(tLand), () => {
        // na powierzchni (kula w punkcie wyrzutu): odłamek leży, kłąb lądowania rośnie
        pos.assign(normalize(pb).mul(rs.add(lift.mul(0.15))));
        land.assign(clamp(age.sub(tLand).div(0.95), 0.0, 1.0));
        vel.assign(vec3(0.0));
      }).Else(() => { pos.assign(pb); });
    }).ElseIf(kind.lessThan(2.5), () => {
      const dk = max(D.x, 1e-3);
      const sd = float(1.0).sub(exp(dk.mul(age).negate())).div(dk);
      const pd = p0.add(v0.mul(sd)).toVar();
      vel.assign(v0.mul(exp(dk.mul(age).negate())));
      If(kind.lessThan(1.5), () => {
        // SURF: rzut na kulę, uniesienie rośnie (D.w — tempo [j/s], tylko dla SURF)
        pos.assign(normalize(pd).mul(rs.add(lift).add(D.w.mul(age))));
      }).Else(() => { pos.assign(pd); });
    });
    // rozmiar i moc w czasie
    const s0 = C.z, s1 = C.w;
    const grow = float(1.0).sub(float(1.0).sub(u).mul(float(1.0).sub(u)));
    const size = s0.toVar();
    const alpha = E.w.toVar();
    const fadeIn = smoothstep(0.0, 0.07, age);
    If(kind.lessThan(0.5), () => {                                  // CHUNK
      size.assign(mix(s0, s1, sqrt(land)));
      alpha.assign(E.w.mul(fadeIn).mul(select(land.greaterThan(0.0), float(1.0).sub(land).mul(float(1.0).sub(land)).mul(0.5), float(1.0)))
        .mul(float(1.0).sub(smoothstep(0.85, 1.0, u))));
    }).ElseIf(kind.lessThan(2.5), () => {                           // SURF, PUFF
      size.assign(mix(s0, s1, grow));
      alpha.assign(E.w.mul(fadeIn).mul(pow(float(1.0).sub(u), 1.3)));
    }).ElseIf(kind.lessThan(3.5), () => {                           // SPARK
      alpha.assign(E.w.mul(float(1.0).sub(u).mul(float(1.0).sub(u))).mul(select(age.greaterThan(tLand), float(0.0), float(1.0))));
    }).ElseIf(kind.lessThan(4.5), () => {                           // FLASH
      size.assign(s0.mul(float(0.55).add(sqrt(u).mul(0.75))));
      alpha.assign(E.w.mul(exp(age.div(life.mul(0.22)).negate())).mul(U.uFlash));
    }).ElseIf(kind.lessThan(5.5), () => {                           // GLOW
      size.assign(s0.mul(float(1.0).add(u.mul(0.25))));
      alpha.assign(E.w.mul(pow(float(1.0).sub(u), 1.6)).mul(smoothstep(0.0, 0.05, age)).mul(U.uGlow));
    }).Else(() => {                                                 // DUST (kurtyna)
      size.assign(mix(s0, s1, grow));
      alpha.assign(E.w.mul(fadeIn).mul(pow(float(1.0).sub(u), 1.6)).mul(select(age.greaterThan(tLand), float(1.0).sub(smoothstep(0.0, 0.4, age.sub(tLand))), float(1.0))));
    });
    alpha.assign(select(alive, alpha, float(0.0)));
    // środek w przestrzeni widoku (modelViewMatrix — CPU w double), dno rozmiaru na ekranie [px]: j. świata na px
    const mvC = modelViewMatrix.mul(vec4(pos, 1.0)).toVar();
    const depth = max(mvC.z.negate(), 1.0).toVar();
    const p11 = cameraProjectionMatrix.element(1).y;
    const wpp = depth.mul(2.0).div(max(p11.mul(U.uViewH), 1.0));
    const minPx = select(kind.lessThan(0.5), U.uMinChunk, select(abs(kind.sub(3.0)).lessThan(0.5), U.uMinSpark, U.uMinDust));
    const sizeF = max(size, minPx.mul(wpp)).toVar();
    // pył: wkład zachowany (mniejsza alfa przy podniesionym rozmiarze)
    const ratio = clamp(size.div(max(sizeF, 1e-3)), 0.0, 1.0);
    If(kind.greaterThan(0.5).and(kind.lessThan(2.5)).or(kind.greaterThan(5.5)), () => {
      alpha.mulAssign(ratio.mul(ratio));
    });
    alpha.assign(select(size.greaterThan(0.0), alpha, float(0.0)));
    // oświetlenie (pył, odłamki): słońce skały z cieniem kuli (promień uRockR — lustro gasGroundLitCpu), otoczenie
    const b = dot(pos, U.uSunDir);
    const dperp = length(pos.sub(U.uSunDir.mul(b)));
    // półcień 300 j. (jak gaz domen głębokich — 450 j.: ostra linia cienia skały w chmurze pyłu wyglądała jak cięcie)
    const lit = max(smoothstep(-300.0, 300.0, b), smoothstep(U.uRockR.sub(300.0), U.uRockR.add(300.0), dperp));
    const light = U.uAmbient.add(lit.mul(U.uSunGain));
    // świecące: barwa z rekordu (HDR) bez oświetlenia
    const col = select(kind.greaterThan(2.5).and(kind.lessThan(5.5)), E.xyz, E.xyz.mul(light));
    // przesunięcie ku kamerze wzdłuż promienia widzenia (rozmiar na ekranie bez zmian): pył kurtyny mniej, reszta o promień
    const shiftK = select(kind.greaterThan(5.5), float(0.7), float(1.15));
    const shift = min(sizeF.mul(shiftK), depth.mul(0.5));
    const ks = depth.sub(shift).div(depth).toVar();
    // osie kwadu w kadrze: smuga (iskry, szybkie odłamki) — wzdłuż rzutu prędkości, reszta — osie widoku
    const ax = vec2(1.0, 0.0).toVar();
    const halfX = sizeF.toVar();
    const sp = length(vel);
    const isStreak = abs(kind.sub(3.0)).lessThan(0.5).or(kind.lessThan(0.5).and(sp.greaterThan(sizeF.mul(14.0))));
    If(isStreak, () => {
      const vv = modelViewMatrix.mul(vec4(vel, 0.0)).xyz;
      const l2 = length(vv.xy);
      If(l2.greaterThan(1e-3), () => {
        ax.assign(vv.xy.div(l2));
        halfX.assign(max(sizeF, l2.mul(select(kind.lessThan(0.5), float(0.018), float(0.045)))).add(sizeF));
      });
    });
    const ay = vec2(ax.y.negate(), ax.x);
    const vis = select(alpha.greaterThan(0.0), float(1.0), float(0.0));
    const off = ax.mul(local.x.mul(halfX)).add(ay.mul(local.y.mul(sizeF))).mul(ks.mul(vis));
    const pv = vec3(mvC.xy.mul(ks).add(off), mvC.z.mul(ks));
    vLocal.assign(local);
    vInfo.assign(vec4(kind, u, land, D.y));
    vCol.assign(vec4(col, alpha));
    return cameraProjectionMatrix.mul(vec4(pv, 1.0));
  })();
  const noiseTex = fxNoise.tile2D();
  const fragmentNode = Fn(() => {
    const L = vLocal;
    const kind = vInfo.x;
    const u = vInfo.y;
    const land = vInfo.z;
    const seed = vInfo.w;
    const r = length(L).toVar();
    If(r.greaterThanEqual(1.0), () => { Discard(); });
    const n = texture(noiseTex, L.mul(0.38).add(vec2(seed, seed.mul(1.37))).add(u.mul(0.09))).level(0).toVar();
    const out = vec4(0.0).toVar();
    if (add) {
      If(kind.lessThan(3.5), () => {
        // SPARK: rdzeń smugi (biały → pomarańcz → czerwień z wiekiem), poprzek — gauss
        const across = L.y;
        const along = L.x.mul(0.5).add(0.5);          // 0 ogon … 1 głowa
        const k = exp(across.mul(across).mul(-6.0)).mul(smoothstep(0.0, 0.85, along));
        const heat = float(1.0).sub(u);
        const c = mix(vec3(2.4, 0.55, 0.12), vec3(6.0, 4.6, 2.6), heat.mul(heat));
        const col = c.mul(k).mul(vCol.w);
        out.assign(vec4(col, max(col.x, max(col.y, col.z))));
      }).ElseIf(kind.lessThan(4.5), () => {
        // FLASH: biały rdzeń + ciepła poświata
        const core = pow(max(float(1.0).sub(r), 0.0), 3.0);
        const glow = pow(max(float(1.0).sub(r), 0.0), 1.3).mul(0.22);
        const col = vCol.xyz.mul(core.add(glow)).mul(vCol.w);
        out.assign(vec4(col, max(col.x, max(col.y, col.z))));
      }).Else(() => {
        // GLOW: żar krateru — plamisty, stygnie z wiekiem (pomarańcz → czerwień)
        const edge = float(1.0).sub(smoothstep(n.r.mul(0.35).add(0.2), 1.0, r));
        const heat = pow(float(1.0).sub(u), 1.5);
        const c = mix(vec3(0.7, 0.09, 0.015), vec3(2.6, 1.0, 0.24), heat);
        const col = c.mul(edge).mul(edge).mul(n.g.mul(0.8).add(0.45)).mul(vCol.w);
        out.assign(vec4(col, max(col.x, max(col.y, col.z))));
      });
    } else {
      If(kind.lessThan(0.5).and(land.lessThan(0.02)), () => {
        // odłamek w locie: nieregularna, ostra bryłka (smuga — pas wzdłuż osi)
        const sh = float(1.0).sub(smoothstep(n.r.mul(0.3).add(0.42), n.r.mul(0.3).add(0.62), r));
        const shade = float(0.78).add(L.x.mul(0.18)).add(n.b.mul(0.14));
        out.assign(vec4(vCol.xyz.mul(shade), sh.mul(vCol.w)));
      }).Else(() => {
        // pył: poszarpany kłąb z szumem (rzadkie brzegi — strzępy), odłamek po lądowaniu — kłąb jaśniejszy
        const n2 = texture(noiseTex, L.mul(0.9).add(vec2(seed.mul(2.1), seed)).sub(u.mul(0.05))).level(0);
        const edge = float(1.0).sub(smoothstep(n.r.mul(0.45).add(0.12), 1.0, r));
        const dens = clamp(n.b.mul(0.8).add(n2.g.mul(0.6)).sub(0.35), 0.0, 1.0);
        const lift = select(kind.lessThan(0.5), vec3(2.6, 2.3, 1.95), vec3(1.0));
        out.assign(vec4(vCol.xyz.mul(lift).mul(float(0.85).add(n2.r.mul(0.3))), clamp(edge.mul(dens).mul(vCol.w).mul(1.6), 0.0, 1.0)));
      });
    }
    return out;
  })();
  return { vertexNode, fragmentNode };
}

export class RockImpactFx {
  /**
   * @param {object} o
   * @param {number} [o.layer] warstwa passa tła (1)
   * @param {object} [o.core] Core3D (wysokość bufora — dno rozmiaru w px)
   */
  constructor({ layer = 1, core = null } = {}) {
    this.core = core;
    this.layer = layer;
    this.tune = ROCK_IMPACT_FX_TUNE;
    this.U = {
      uTime: uniform(0),
      uSunDir: uniform(new THREE.Vector3(1, 0, 0)),
      uSunGain: uniform(ROCK_IMPACT_FX_TUNE.sunGain),
      uAmbient: uniform(ROCK_IMPACT_FX_TUNE.ambient),
      uRockR: uniform(PIRATE_ROCK_SPEC.radius),
      uViewH: uniform(900),
      uMinChunk: uniform(ROCK_IMPACT_FX_TUNE.minPxChunk),
      uMinDust: uniform(ROCK_IMPACT_FX_TUNE.minPxDust),
      uMinSpark: uniform(ROCK_IMPACT_FX_TUNE.minPxSpark),
      uFlash: uniform(1),
      uGlow: uniform(1)
    };
    this.root = new THREE.Group();
    this.root.name = 'RockImpactFx';
    this.root.matrixAutoUpdate = false;
    this.alpha = makePool('alpha', this.U, ROCK_FX_CAP_ALPHA, layer);
    this.add = makePool('add', this.U, ROCK_FX_CAP_ADD, layer);
    this.root.add(this.alpha.mesh, this.add.mesh);
    this.time = 0;
    // środek skały (scena, double) — początek siatek; promień nominalny
    this.center = new THREE.Vector3();
    this.R = PIRATE_ROCK_SPEC.radius;
    this.placed = false;
    // gaz (ExplosionFx — głębokie domeny): ustawia dekoder / klej (getExplosionFx)
    this.getGas = null;
    // trwały ślad uderzenia na skale (x, y, z sceny, promień krateru, siła) — klej: PirateRock3D.addScar
    this.onScar = null;
    this._gasSlots = [];          // domeny uderzeń (indeksy globalne) — scalanie
    this.stats = { impacts: 0, scrapes: 0, settles: 0, blasts: 0, gasNew: 0, gasMerged: 0, gasNone: 0, particles: 0, dropped: 0 };
    this._tmp = new THREE.Vector3();
  }

  /** Środek skały (scena) i promień nominalny; kierunek słońca ustawia update. */
  setRock(cx, cy, cz, R = PIRATE_ROCK_SPEC.radius) {
    this.center.set(cx, cy, cz);
    this.R = R;
    this.U.uRockR.value = R;
    this.root.position.copy(this.center);
    this.root.updateMatrix();
    this.root.updateMatrixWorld(true);
    for (const p of [this.alpha, this.add]) {
      p.mesh.updateMatrix();
      p.mesh.updateMatrixWorld(true);
    }
    this.placed = true;
  }

  // ------------------------------------------------------------------------------------------------ emisja

  _emit(pool, kind, x, y, z, vx, vy, vz, tLand, life, s0, s1, drag, lift, grav, r, g, b, a, delay = 0) {
    const i = pool.head;
    pool.head = (pool.head + 1) % pool.cap;
    const o = i * STRIDE;
    const A = pool.arr;
    A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = this.time + delay;
    A[o + 4] = vx; A[o + 5] = vy; A[o + 6] = vz; A[o + 7] = tLand;
    A[o + 8] = life; A[o + 9] = kind; A[o + 10] = s0; A[o + 11] = s1;
    A[o + 12] = drag; A[o + 13] = fxRandom.next() * 7.3; A[o + 14] = lift; A[o + 15] = grav;
    A[o + 16] = r; A[o + 17] = g; A[o + 18] = b; A[o + 19] = a;
    if (i < pool.lo) pool.lo = i;
    if (i + 1 > pool.hi) pool.hi = i + 1;
    if (i + 1 > pool.used) pool.used = i + 1;
    if (pool === this.alpha) this._bud = (this._bud || 0) + 1;
    const end = this.time + delay + life;
    if (end > pool.lastT) pool.lastT = end;
    this.stats.particles++;
    return i;
  }

  /**
   * Czas lądowania [s] łuku balistycznego p(t) = p0 + v0·t + ½·g·t²·ĝ (ĝ — ku środkowi skały z punktu wyrzutu) na kuli
   * promienia rs (środek skały = 0). Newton na |p(t)|² − rs² od oszacowania płaskiego; bez trafienia — `cap`.
   * LUSTRO arytmetyki łuku w shaderze (pozycja) — testy.
   */
  static landTime(px, py, pz, vx, vy, vz, g, rs, cap = 30) {
    const r0 = Math.sqrt(px * px + py * py + pz * pz) || 1;
    const gx = -px / r0, gy = -py / r0, gz = -pz / r0;
    const vn = -(vx * gx + vy * gy + vz * gz);   // prędkość od środka
    if (!(g > 0)) return cap;
    let t = vn > 0 ? Math.max(0.02, (2 * vn) / g) : 0.02;
    for (let k = 0; k < 8; k++) {
      const hx = 0.5 * g * t * t;
      const x = px + vx * t + gx * hx, y = py + vy * t + gy * hx, z = pz + vz * t + gz * hx;
      const ux = vx + gx * g * t, uy = vy + gy * g * t, uz = vz + gz * g * t;
      const f = x * x + y * y + z * z - rs * rs;
      const df = 2 * (x * ux + y * uy + z * uz);
      if (Math.abs(df) < 1e-6) break;
      const dt = f / df;
      t -= dt;
      if (!(t > 0)) { t = 0.02; break; }
      if (Math.abs(dt) < 1e-4) break;
    }
    return Math.min(cap, Math.max(0.02, t));
  }

  /** Kierunek w półkuli wokół n: kąt od normalnej θ, azymut φ (baza styczna t1, t2). out[0..2]. */
  _dirFrom(nx, ny, nz, t1, t2, theta, phi, out) {
    const st = Math.sin(theta), ct = Math.cos(theta), cp = Math.cos(phi), sp = Math.sin(phi);
    out[0] = nx * ct + (t1[0] * cp + t2[0] * sp) * st;
    out[1] = ny * ct + (t1[1] * cp + t2[1] * sp) * st;
    out[2] = nz * ct + (t1[2] * cp + t2[2] * sp) * st;
    return out;
  }

  _basis(nx, ny, nz, t1, t2) {
    // styczna 1: prostopadła do n (oś o najmniejszej składowej), styczna 2 = n × t1
    let ax = 0, ay = 0, az = 0;
    if (Math.abs(nx) < 0.6) ax = 1; else if (Math.abs(ny) < 0.6) ay = 1; else az = 1;
    let x = ay * nz - az * ny, y = az * nx - ax * nz, z = ax * ny - ay * nx;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    t1[0] = x / l; t1[1] = y / l; t1[2] = z / l;
    t2[0] = ny * t1[2] - nz * t1[1];
    t2[1] = nz * t1[0] - nx * t1[2];
    t2[2] = nx * t1[1] - ny * t1[0];
  }

  // ------------------------------------------------------------------------------------------------ zdarzenia

  /**
   * Zdarzenie z rekordu (dekoder): type — ROCK_EVENT, ev — pola rekordu w GRZE (x, y, z, nx, ny, nz, speed, slide, mass,
   * size, energy, vx, vy, vz, id, kind — napis).
   */
  onEvent(type, ev) {
    const T = this.tune;
    if (!T.enabled || !this.placed) { this.stats.dropped++; return false; }
    // gra → scena (y odbite), względem środka skały
    const px = ev.x - this.center.x, py = -ev.y - this.center.y, pz = ev.z - this.center.z;
    let nx = ev.nx, ny = -ev.ny, nz = ev.nz;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl > 1e-6) { nx /= nl; ny /= nl; nz /= nl; } else if (type === ROCK_EVENT.BLAST) {
      nx = 0; ny = 0; nz = 0;   // wybuch w głębi bez kierunku — kulisty
    } else {
      const l = Math.sqrt(px * px + py * py + pz * pz) || 1;
      nx = px / l; ny = py / l; nz = pz / l;
    }
    const e = this._e || (this._e = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 1, speed: 0, slide: 0, size: 0, energy: 0, vx: 0, vy: 0, vz: 0, kind: 'other', id: 0, rs: 0 });
    e.px = px; e.py = py; e.pz = pz; e.nx = nx; e.ny = ny; e.nz = nz;
    e.speed = ev.speed; e.slide = ev.slide; e.size = ev.size; e.energy = ev.energy;
    e.vx = ev.vx; e.vy = -ev.vy; e.vz = ev.vz;
    e.kind = ev.kind; e.id = ev.id;
    e.rs = Math.sqrt(px * px + py * py + pz * pz);
    if (type === ROCK_EVENT.IMPACT) { this.stats.impacts++; this._impact(e); }
    else if (type === ROCK_EVENT.SCRAPE) { this.stats.scrapes++; this._scrape(e); }
    else if (type === ROCK_EVENT.BLAST) { this.stats.blasts++; this._blast(e); }
    else { this.stats.settles++; this._settle(e); }
    return true;
  }

  /**
   * Wybuch / kłąb w GŁĘBI bez skały (deepBlast — wieża przebija dysk mieszkalny): gaz w głębokiej domenie (gorąca kula,
   * kłąb pyłu i powietrza, strumienie we wszystkich kierunkach i wzdłuż ruchu ciała; obłok jedzie z nośnikiem) i cząstki
   * (błysk z poświatą, iskry, odłamki konstrukcji spadające ku skale, kłęby). e.nx..nz — kierunek ruchu ciała (zera —
   * kulisty), e.size — promień kuli wybuchu.
   */
  _blast(e) {
    const T = this.tune;
    const R = Math.max(60, e.size);
    const hasGas = T.gas ? this._gasBlast(e, R) >= 0 : false;
    if (!T.particles) return;
    const bk = this._budgetK();
    const g = T.gravity;
    const dir = this._d || (this._d = [0, 0, 0]);
    const ac = T.albedoChunk, ad = T.albedoDust;
    const hasDir = e.nx * e.nx + e.ny * e.ny + e.nz * e.nz > 0.5;
    const cvx = e.vx, cvy = e.vy, cvz = e.vz;
    const rand3 = (out) => {   // kierunek losowy na kuli (z przewagą kierunku ruchu ciała)
      const u = 2 * fxRandom.next() - 1, a = fxRandom.next() * TAU, s = Math.sqrt(1 - u * u);
      out[0] = s * Math.cos(a); out[1] = s * Math.sin(a); out[2] = u;
      if (hasDir && fxRandom.next() < 0.35) {
        out[0] += e.nx * 1.4; out[1] += e.ny * 1.4; out[2] += e.nz * 1.4;
        const l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]) || 1;
        out[0] /= l; out[1] /= l; out[2] /= l;
      }
      return out;
    };
    // odłamki konstrukcji: lecą z nośnikiem i spadają ku skale (lądowanie na kuli skały)
    const nChunk = Math.min(T.blastChunkMax, Math.round(R * T.blastChunkK * bk));
    for (let k = 0; k < nChunk; k++) {
      rand3(dir);
      const sp = R * (0.25 + 0.9 * fxRandom.next() * fxRandom.next()) + 60;
      const r0 = R * 0.35 * Math.sqrt(fxRandom.next());
      const x = e.px + dir[0] * r0, y = e.py + dir[1] * r0, z = e.pz + dir[2] * r0;
      const vx = cvx + dir[0] * sp, vy = cvy + dir[1] * sp, vz = cvz + dir[2] * sp;
      const tl = RockImpactFx.landTime(x, y, z, vx, vy, vz, g, this.R, 9);
      const s = (7 + 32 * fxRandom.next() * fxRandom.next()) * Math.min(2, 0.5 + R / 700);
      this._emit(this.alpha, RIP.CHUNK, x, y, z, vx, vy, vz, tl, Math.min(tl + 1.2, 9), s, s * (4 + 4 * fxRandom.next()), 0, 0, g,
        ac[0], ac[1], ac[2], 1, 0.04 * fxRandom.next());
    }
    // kłęby pyłu i powietrza (bez gazu — główny obłok; z gazem — kilka na brzegu)
    const nPuff = hasGas ? 4 : Math.min(18, Math.round(6 + R / 120));
    for (let k = 0; k < nPuff; k++) {
      rand3(dir);
      const sp = R * (0.35 + 0.55 * fxRandom.next());
      const r0 = R * (0.12 + 0.12 * fxRandom.next());
      const off = R * 0.3 * Math.sqrt(fxRandom.next());
      this._emit(this.alpha, RIP.PUFF, e.px + dir[0] * off, e.py + dir[1] * off, e.pz + dir[2] * off,
        cvx + dir[0] * sp, cvy + dir[1] * sp, cvz + dir[2] * sp, 1e9, 2.5 + 2.5 * fxRandom.next(), r0, R * (0.45 + 0.5 * fxRandom.next()),
        0.8 + 0.4 * fxRandom.next(), 0, 0, ad[0] * 1.1, ad[1] * 1.1, ad[2] * 1.1, (hasGas ? 0.22 : 0.38) * (0.7 + 0.5 * fxRandom.next()), 0.03 * k);
    }
    // iskry (pękające kratownice, przewody)
    const ns = Math.min(T.sparkMax * 2, Math.round((40 + R / 8) * Math.max(0.4, bk)));
    for (let k = 0; k < ns; k++) {
      rand3(dir);
      const sp = 300 + R * (0.6 + 1.4 * fxRandom.next());
      const x = e.px + dir[0] * R * 0.15, y = e.py + dir[1] * R * 0.15, z = e.pz + dir[2] * R * 0.15;
      const vx = cvx + dir[0] * sp, vy = cvy + dir[1] * sp, vz = cvz + dir[2] * sp;
      this._emit(this.add, RIP.SPARK, x, y, z, vx, vy, vz, 1e9, 0.35 + 0.8 * fxRandom.next(),
        3 + 4 * fxRandom.next() * Math.min(2, R / 500), 0, 0, 0, g, 1, 1, 1, 0.8 + 0.9 * fxRandom.next(), 0.05 * fxRandom.next());
    }
    // błysk z poświatą (gorące powietrze i przewody zasilania) — ślad świeci krótko
    const k = T.flashGain;
    this._emit(this.add, RIP.FLASH, e.px, e.py, e.pz, 0, 0, 0, 1e9, 0.3, R * 0.7, R * 0.7, 0, 0, 0, 6.0, 5.0, 3.8, 1.0 * k);
    this._emit(this.add, RIP.FLASH, e.px, e.py, e.pz, 0, 0, 0, 1e9, 0.9, R * 1.8, R * 1.8, 0, 0, 0, 1.0, 0.55, 0.26, 0.5 * k);
  }

  /** Gaz wybuchu w głębi: głęboka domena (skała jako kula-przeszkoda — poza zasięgiem nic nie zmienia) i źródła. */
  _gasBlast(e, R) {
    const fx = this.getGas ? this.getGas() : null;
    if (!fx || typeof fx.deepDomain !== 'function') { this.stats.gasNone++; return -1; }
    const T = this.tune;
    const gx = e.px + this.center.x, gy = -(e.py + this.center.y), gz = e.pz + this.center.z;   // świat gry
    const slot = fx.deepDomain(gx, gy, gz, R, {
      ground: { x: this.center.x, y: -this.center.y, z: this.center.z, r: this.R },
      carrier: [e.vx * T.blastCarrier, -e.vy * T.blastCarrier, e.vz * T.blastCarrier],
      life: T.blastLife, fadeTime: T.gasFade, baseDecay: T.gasDecay, tint: T.blastTint, fire: 0, tag: ROCK_IMPACT_TAG,
      ambient: T.blastAmbient, minPx: T.gasMinPx, reserve: 1, domainScale: T.blastDomainScale, priority: 1,
      fineMinPx: T.gasFineMinPx, coarseMaxPx: T.gasCoarseMaxPx
    });
    if (slot < 0) { this.stats.gasNone++; return -1; }
    this._gasSlots.push(slot);
    this.stats.gasNew++;
    const d = fx.director;
    const s = fx.grid.slots[slot];
    if (!d || !s) return slot;
    const rmin = 3.2 * s.h;
    const k = T.gasSmoke;
    const X = e.px + this.center.x, Y = e.py + this.center.y, Z = e.pz + this.center.z;
    const po = this._po || (this._po = { temp: 0, smoke: 0, grow: 1.5, velBlend: 30, noise: 0.6, tau: 0, dir: [0, 0, 0] });
    const jo = this._jo || (this._jo = { delay: 0, fuel: 0, temp: 0, smoke: 0, radial: 0, velBlend: 30, noise: 0.4, tau: 0.3, flicker: 0.2, grow: 1.4, rampIn: 0.02, rampOut: 0.2, velTau: 0.3 });
    const hasDir = e.nx * e.nx + e.ny * e.ny + e.nz * e.nz > 0.5;
    // gorąca kula (powietrze habitatu, przewody, paliwo w rurach — świeci krótko)
    po.temp = 5.5; po.smoke = 1.6 * k; po.grow = 1.8; po.velBlend = 40; po.noise = 0.5; po.tau = 0;
    po.dir[0] = hasDir ? e.nx * R * 0.5 : 0; po.dir[1] = hasDir ? e.ny * R * 0.5 : 0; po.dir[2] = hasDir ? e.nz * R * 0.5 : 0;
    d.puff(slot, X, Y, Z, Math.max(rmin, R * 0.3), 0, 0.12, 0, R * 1.1, po);
    // kłąb pyłu, szronu i dymu
    po.temp = 0.35; po.smoke = 6 * k; po.grow = 1.7; po.velBlend = 24; po.noise = 0.65;
    po.dir[0] = hasDir ? e.nx * R * 0.3 : 0; po.dir[1] = hasDir ? e.ny * R * 0.3 : 0; po.dir[2] = hasDir ? e.nz * R * 0.3 : 0;
    d.puff(slot, X, Y, Z, Math.max(rmin, R * 0.36), 0.04, 0.4, 0, R * 0.75, po);
    // strumienie: na wszystkie strony (pękające sekcje) i wzdłuż ruchu ciała (przebicie)
    const dir = this._d || (this._d = [0, 0, 0]);
    const nJ = 7 + Math.floor(fxRandom.next() * 4);
    for (let i = 0; i < nJ; i++) {
      const u = 2 * fxRandom.next() - 1, a = fxRandom.next() * TAU, sq = Math.sqrt(1 - u * u);
      dir[0] = sq * Math.cos(a); dir[1] = sq * Math.sin(a); dir[2] = u;
      const r = Math.max(rmin, R * 0.12);
      const avail = this._fitAlong(s, X + dir[0] * r, Y + dir[1] * r, Z + dir[2] * r, dir[0], dir[1], dir[2], 0.78);
      jo.delay = 0.02 * fxRandom.next(); jo.fuel = 0; jo.temp = 0.4 + 1.4 * fxRandom.next(); jo.smoke = 6 * k; jo.radial = R * 0.18;
      jo.velBlend = 30; jo.noise = 0.4; jo.tau = 0.4; jo.flicker = 0.25; jo.grow = 1.5; jo.rampIn = 0.02; jo.rampOut = 0.25; jo.velTau = 0.3;
      const dur = 0.25 + 0.2 * fxRandom.next();
      const sp = this._fitSpeed(R * (1.3 + 0.9 * fxRandom.next()), dur, R * 0.22, avail);
      d.jet(slot, X + dir[0] * r, Y + dir[1] * r, Z + dir[2] * r, dir[0], dir[1], dir[2], r, R * 0.22, sp, dur, jo);
    }
    if (hasDir) {
      const r = Math.max(rmin, R * 0.16);
      const avail = this._fitAlong(s, X + e.nx * r, Y + e.ny * r, Z + e.nz * r, e.nx, e.ny, e.nz, 0.8);
      jo.delay = 0; jo.temp = 0.8; jo.smoke = 7 * k; jo.radial = R * 0.25; jo.tau = 0.45; jo.grow = 1.6; jo.velTau = 0.35;
      const sp = this._fitSpeed(R * 2.0, 0.45, R * 0.3, avail);
      d.jet(slot, X + e.nx * r, Y + e.ny * r, Z + e.nz * r, e.nx, e.ny, e.nz, r, R * 0.3, sp, 0.45, jo);
    }
    return slot;
  }

  /**
   * Odległość [j.] od punktu (X, Y, Z — scena) wzdłuż kierunku (dx, dy, dz) do elipsoidy ułamka f pudła domeny `s`
   * (elipsoida wpisana w pudło — za ~0,9 obraz i symulacja gaszą gaz; płaskie pudło: półoś z = NZ / N półosi x).
   * Punkt poza elipsoidą — 0.
   */
  _fitAlong(s, X, Y, Z, dx, dy, dz, f) {
    const ax = s.h * s.n * 0.5, az = s.h * s.nz * 0.5;
    const ux = (X - s.cx) / ax, uy = (Y - s.cy) / ax, uz = (Z - s.cz) / az;
    const vx = dx / ax, vy = dy / ax, vz = dz / az;
    const a = vx * vx + vy * vy + vz * vz;
    const b = ux * vx + uy * vy + uz * vz;
    const c = ux * ux + uy * uy + uz * uz - f * f;
    if (!(a > 0) || c >= 0) return 0;
    return (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a;
  }

  /**
   * Prędkość strumienia dopasowana do miejsca w domenie: zasięg ≈ len + v · (czas + coast) ≤ 0,8 · avail (gaz nie dochodzi
   * do brzegu elipsoidy domeny, gdzie obraz i symulacja go gaszą — płaskie ścięcie obłoku); najmniej 0,12 × v (punkt tuż
   * przy brzegu — strumień tylko „pyknie”).
   */
  _fitSpeed(v, dur, len, avail) {
    const fit = (0.8 * avail - len) / (dur + this.tune.gasCoast);
    return Math.max(0.12 * v, Math.min(v, fit));
  }

  /** Skala uderzenia q (prędkość wzdłuż normalnej) — 0 … qMax. */
  _q(e) {
    const T = this.tune;
    return Math.max(0, Math.min(T.qMax, (e.speed - T.speed0) / T.speedK));
  }

  _impact(e) {
    const T = this.tune;
    const q = this._q(e);
    const metal = e.kind !== 'other';
    const size = Math.max(8, e.size);
    // obłok gazu (głęboka domena) — duże uderzenia; reszta (i fallback bez domeny) — cząstki
    let gasSlot = -1;
    if (T.gas) gasSlot = this._gasImpact(e, q, size);
    if (T.particles) this._particlesImpact(e, q, size, metal, gasSlot >= 0);
    // trwały ślad na skale (jasny lód krateru i promieni, ciemniejszy wał) — obraz skały (pirateRock3D.addScar)
    if (this.onScar && size >= T.scarMinSize) {
      this.onScar(e.px + this.center.x, e.py + this.center.y, e.pz + this.center.z, size * (0.35 + 0.25 * q), Math.min(1.4, 0.35 + q));
    }
  }

  _scrape(e) {
    const T = this.tune;
    if (!T.particles) return;
    const t1 = this._t1 || (this._t1 = [0, 0, 0]), t2 = this._t2 || (this._t2 = [0, 0, 0]);
    this._basis(e.nx, e.ny, e.nz, t1, t2);
    const size = Math.max(8, e.size);
    // kierunek poślizgu: składowa styczna prędkości ciała (albo losowy)
    let sx = e.vx, sy = e.vy, sz = e.vz;
    const vn = sx * e.nx + sy * e.ny + sz * e.nz;
    sx -= vn * e.nx; sy -= vn * e.ny; sz -= vn * e.nz;
    let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (!(sl > 1)) {
      const a = fxRandom.next() * TAU;
      sx = t1[0] * Math.cos(a) + t2[0] * Math.sin(a); sy = t1[1] * Math.cos(a) + t2[1] * Math.sin(a); sz = t1[2] * Math.cos(a) + t2[2] * Math.sin(a);
      sl = 1;
    } else { sx /= sl; sy /= sl; sz /= sl; }
    const slide = Math.max(e.slide, 1);
    const ad = T.albedoDust;
    const n = Math.max(1, Math.round(T.scrapeDust * Math.min(2.5, 0.6 + size / 500)));
    for (let k = 0; k < n; k++) {
      const a = fxRandom.next() * TAU;
      const sp = slide * (0.18 + 0.25 * fxRandom.next());
      // pył rzucany do przodu i na boki (bruzda), wolno się unosi
      const vx = sx * sp + (t1[0] * Math.cos(a) + t2[0] * Math.sin(a)) * sp * 0.6;
      const vy = sy * sp + (t1[1] * Math.cos(a) + t2[1] * Math.sin(a)) * sp * 0.6;
      const vz = sz * sp + (t1[2] * Math.cos(a) + t2[2] * Math.sin(a)) * sp * 0.6;
      const r0 = size * (0.25 + 0.2 * fxRandom.next());
      const lift = r0 * 0.4;
      this._emit(this.alpha, RIP.SURF, e.px + e.nx * lift, e.py + e.ny * lift, e.pz + e.nz * lift, vx, vy, vz, 1e9,
        2.4 + 2.2 * fxRandom.next(), r0, size * (0.9 + 0.7 * fxRandom.next()), 0.9 + 0.6 * fxRandom.next(), lift,
        size * 0.04 * fxRandom.next(), ad[0], ad[1], ad[2], 0.5 + 0.25 * fxRandom.next(), 0.03 * k);
    }
    // odłamki z bruzdy: kilka małych, nisko do przodu
    const nc = Math.min(12, Math.round(2 + size / 160));
    const g = T.gravity;
    const ac = T.albedoChunk;
    const dir = this._d || (this._d = [0, 0, 0]);
    for (let k = 0; k < nc; k++) {
      const th = 1.0 + 0.35 * fxRandom.next();
      const phi = Math.atan2(sx * t2[0] + sy * t2[1] + sz * t2[2], sx * t1[0] + sy * t1[1] + sz * t1[2]) + (fxRandom.next() - 0.5) * 1.6;
      this._dirFrom(e.nx, e.ny, e.nz, t1, t2, th, phi, dir);
      const sp = slide * (0.25 + 0.5 * fxRandom.next()) + 40;
      const x = e.px + e.nx * 6, y = e.py + e.ny * 6, z = e.pz + e.nz * 6;
      const vx = dir[0] * sp, vy = dir[1] * sp, vz = dir[2] * sp;
      const tl = RockImpactFx.landTime(x, y, z, vx, vy, vz, g, e.rs, 20);
      const s = 6 + 18 * fxRandom.next() * fxRandom.next();
      this._emit(this.alpha, RIP.CHUNK, x, y, z, vx, vy, vz, tl, tl + 1.3, s, s * 6, 0, 6, g, ac[0], ac[1], ac[2], 1);
    }
    // iskry (metal o skałę)
    if (e.slide > 140 && e.kind !== 'other') {
      const ns = Math.min(14, Math.round(e.slide / 70));
      for (let k = 0; k < ns; k++) {
        const th = 1.15 + 0.3 * fxRandom.next();
        const phi = Math.atan2(sx * t2[0] + sy * t2[1] + sz * t2[2], sx * t1[0] + sy * t1[1] + sz * t1[2]) + (fxRandom.next() - 0.5) * 1.2;
        this._dirFrom(e.nx, e.ny, e.nz, t1, t2, th, phi, dir);
        const sp = e.slide * (0.6 + 0.8 * fxRandom.next());
        const x = e.px + e.nx * 4, y = e.py + e.ny * 4, z = e.pz + e.nz * 4;
        const tl = RockImpactFx.landTime(x, y, z, dir[0] * sp, dir[1] * sp, dir[2] * sp, g, e.rs, 3);
        this._emit(this.add, RIP.SPARK, x, y, z, dir[0] * sp, dir[1] * sp, dir[2] * sp, tl, Math.min(tl, 0.35 + 0.5 * fxRandom.next()),
          2.2 + 2 * fxRandom.next(), 0, 0, 4, g, 1, 1, 1, 1.0 + fxRandom.next());
      }
    }
    // pył szorowania także w gazie (żywa domena uderzeń w pobliżu)
    if (T.gas) this._gasScrape(e, size, sx, sy, sz, slide);
  }

  _settle(e) {
    const T = this.tune;
    if (!T.particles) return;
    const t1 = this._t1 || (this._t1 = [0, 0, 0]), t2 = this._t2 || (this._t2 = [0, 0, 0]);
    this._basis(e.nx, e.ny, e.nz, t1, t2);
    const size = Math.max(8, e.size);
    const ad = T.albedoDust;
    const n = Math.min(16, Math.round(5 + size / 120));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + fxRandom.next() * 0.5;
      const sp = size * (0.25 + 0.2 * fxRandom.next());
      const c = Math.cos(a), s = Math.sin(a);
      const r0 = size * 0.3;
      this._emit(this.alpha, RIP.SURF, e.px + e.nx * r0 * 0.3, e.py + e.ny * r0 * 0.3, e.pz + e.nz * r0 * 0.3,
        (t1[0] * c + t2[0] * s) * sp, (t1[1] * c + t2[1] * s) * sp, (t1[2] * c + t2[2] * s) * sp, 1e9,
        3.0 + 2.0 * fxRandom.next(), r0, size * (0.9 + 0.5 * fxRandom.next()), 0.8, r0 * 0.3, size * 0.03,
        ad[0], ad[1], ad[2], 0.4 + 0.2 * fxRandom.next());
    }
    if (T.gas) this._gasSettle(e, size);
  }

  /**
   * Mnożnik liczby cząstek nowego uderzenia z zajętości pierścienia pyłu: cząstki wyemitowane w ostatnich ~2 s (wykładniczo
   * zanikający licznik) ponad budgetSoft pojemności — liczby maleją (seria uderzeń nie nadpisuje żywych cząstek w pierścieniu).
   */
  _budgetK() {
    const dt = Math.max(0, this.time - (this._budT ?? this.time));
    this._budT = this.time;
    this._bud = (this._bud || 0) * Math.exp(-dt / 2);
    const used = this._bud / this.alpha.cap;
    const soft = this.tune.budgetSoft;
    return used <= soft ? 1 : Math.max(0.15, soft / used);
  }

  /**
   * Cząstki uderzenia: kurtyna wyrzutu (odłamki i pył po łukach balistycznych — stożek 30–60° od normalnej, wcześniejsze
   * szybsze, krater rośnie: punkt wyrzutu przesuwa się na zewnątrz), promienie (azymuty z większą gęstością), pierścień
   * pyłu po powierzchni, kłęby, iskry (metal o skałę), błysk i żar krateru (szybkie). `hasGas` — obłok z gazu (mniej
   * kłębów cząstkowych).
   */
  _particlesImpact(e, q, size, metal, hasGas) {
    const T = this.tune;
    const bk = this._budgetK();
    const g = T.gravity;
    const t1 = this._t1 || (this._t1 = [0, 0, 0]), t2 = this._t2 || (this._t2 = [0, 0, 0]);
    this._basis(e.nx, e.ny, e.nz, t1, t2);
    const dir = this._d || (this._d = [0, 0, 0]);
    const ac = T.albedoChunk, ad = T.albedoDust;
    const rCrater = size * (0.35 + 0.25 * q);
    // prędkość wyrzutu: ułamek prędkości uderzenia (szybkie — więcej), z dolnym progiem (bryła i tak rozbija skałę)
    const vMax = Math.max(140, (e.speed * 0.38 + e.slide * 0.2) * (0.6 + 0.4 * q)) + size * 0.25;
    // promienie: kilka azymutów z większą gęstością odłamków
    const nRays = 7 + Math.floor(fxRandom.next() * 6);
    const rays = this._rays || (this._rays = new Float64Array(16));
    for (let k = 0; k < nRays; k++) rays[k] = fxRandom.next() * TAU;
    // kierunek poślizgu (uderzenie skośne: wyrzut przesunięty z prądem)
    let skew = 0, skewPhi = 0;
    if (e.slide > 30) {
      let sx = e.vx, sy = e.vy, sz = e.vz;
      const vn = sx * e.nx + sy * e.ny + sz * e.nz;
      sx -= vn * e.nx; sy -= vn * e.ny; sz -= vn * e.nz;
      skewPhi = Math.atan2(sx * t2[0] + sy * t2[1] + sz * t2[2], sx * t1[0] + sy * t1[1] + sz * t1[2]);
      skew = Math.min(0.6, e.slide / Math.max(80, e.speed + e.slide));
    }
    const nChunk = Math.min(T.chunkMax, Math.round(size * T.chunkK * (0.4 + q) * bk));
    for (let k = 0; k < nChunk; k++) {
      const u = fxRandom.next();                                 // postęp krateru (0 — wcześnie, szybko)
      let phi = fxRandom.next() < 0.55 ? rays[Math.floor(fxRandom.next() * nRays)] + (fxRandom.next() - 0.5) * 0.18 : fxRandom.next() * TAU;
      if (skew > 0 && fxRandom.next() < skew) phi = skewPhi + (fxRandom.next() - 0.5) * 1.4;
      const th = (0.52 + 0.42 * fxRandom.next()) + (fxRandom.next() < 0.12 ? 0.25 : 0);   // ~30–55° (część niżej)
      this._dirFrom(e.nx, e.ny, e.nz, t1, t2, th, phi, dir);
      const sp = vMax * Math.pow(1 - 0.72 * u, 1.6) * (0.75 + 0.5 * fxRandom.next());
      const rl = rCrater * u;
      const c = Math.cos(phi), s = Math.sin(phi);
      const x = e.px + (t1[0] * c + t2[0] * s) * rl + e.nx * 8;
      const y = e.py + (t1[1] * c + t2[1] * s) * rl + e.ny * 8;
      const z = e.pz + (t1[2] * c + t2[2] * s) * rl + e.nz * 8;
      const vx = dir[0] * sp, vy = dir[1] * sp, vz = dir[2] * sp;
      const tl = RockImpactFx.landTime(x, y, z, vx, vy, vz, g, e.rs, 25);
      const sz = (8 + 46 * fxRandom.next() * fxRandom.next()) * Math.min(2.2, 0.5 + size / 600);
      const delay = u * (0.25 + 0.15 * q);
      this._emit(this.alpha, RIP.CHUNK, x, y, z, vx, vy, vz, tl, tl + 1.2, sz, sz * (5 + 4 * fxRandom.next()), 0, 8, g,
        ac[0], ac[1], ac[2], 1, delay);
    }
    // pył kurtyny (miękkie kłęby po tych samych łukach — mgiełka stożka)
    const nDust = Math.min(260, Math.round(size * T.dustK * (0.6 + q) * (hasGas ? 0.6 : 1) * bk));
    for (let k = 0; k < nDust; k++) {
      const u = fxRandom.next();
      const phi = fxRandom.next() < 0.4 ? rays[Math.floor(fxRandom.next() * nRays)] + (fxRandom.next() - 0.5) * 0.3 : fxRandom.next() * TAU;
      const th = 0.45 + 0.5 * fxRandom.next();
      this._dirFrom(e.nx, e.ny, e.nz, t1, t2, th, phi, dir);
      const sp = vMax * Math.pow(1 - 0.7 * u, 1.4) * (0.55 + 0.45 * fxRandom.next());
      const x = e.px + e.nx * 20, y = e.py + e.ny * 20, z = e.pz + e.nz * 20;
      const vx = dir[0] * sp, vy = dir[1] * sp, vz = dir[2] * sp;
      const tl = RockImpactFx.landTime(x, y, z, vx, vy, vz, g, e.rs, 25);
      const s0 = size * (0.04 + 0.05 * fxRandom.next());
      this._emit(this.alpha, RIP.DUST, x, y, z, vx, vy, vz, tl, Math.min(tl + 0.5, 2.0 + 3 * fxRandom.next()), s0, s0 * (3 + 2 * fxRandom.next()),
        0, 20, g, ad[0], ad[1], ad[2], 0.2 + 0.12 * fxRandom.next(), u * 0.3);
    }
    // pierścień pyłu po powierzchni (base surge — szybki front zwalnia, pył lekko się unosi)
    const nSurf = Math.min(110, Math.round((16 + size * T.surfK * (0.6 + q)) * Math.max(0.4, bk)));
    const vSurf = size * (1.0 + 0.9 * q) + 60;
    for (let k = 0; k < nSurf; k++) {
      const a = (k / nSurf) * TAU + (fxRandom.next() - 0.5) * 0.35;
      const c = Math.cos(a), s = Math.sin(a);
      const sp = vSurf * (0.6 + 0.6 * fxRandom.next());
      const r0 = size * (0.1 + 0.08 * fxRandom.next());
      const lift = r0 * 0.5;
      this._emit(this.alpha, RIP.SURF, e.px + e.nx * lift, e.py + e.ny * lift, e.pz + e.nz * lift,
        (t1[0] * c + t2[0] * s) * sp, (t1[1] * c + t2[1] * s) * sp, (t1[2] * c + t2[2] * s) * sp, 1e9,
        3.5 + 3.0 * fxRandom.next(), r0, size * (0.4 + 0.35 * fxRandom.next()) * (1 + 0.4 * q), 0.75 + 0.45 * fxRandom.next(), lift,
        size * (0.03 + 0.05 * fxRandom.next()), ad[0], ad[1], ad[2], (hasGas ? 0.28 : 0.45) * (0.7 + 0.5 * fxRandom.next()),
        0.04 + 0.12 * fxRandom.next());
    }
    // kłęby w miejscu (bez gazu — główny obłok; z gazem — kilka u podstawy)
    const nPuff = hasGas ? 3 : Math.min(12, Math.round(4 + size / 220));
    for (let k = 0; k < nPuff; k++) {
      const phi = fxRandom.next() * TAU;
      this._dirFrom(e.nx, e.ny, e.nz, t1, t2, 0.5 + 0.7 * fxRandom.next(), phi, dir);
      const sp = size * (0.25 + 0.45 * fxRandom.next()) * (0.6 + 0.5 * q);
      const r0 = size * (0.1 + 0.12 * fxRandom.next());
      // przesunięcie styczne (kłąb nieregularny), nisko nad skałą
      const off = size * 0.45 * Math.sqrt(fxRandom.next());
      const c = Math.cos(phi), sn = Math.sin(phi);
      const ox = (t1[0] * c + t2[0] * sn) * off, oy = (t1[1] * c + t2[1] * sn) * off, oz = (t1[2] * c + t2[2] * sn) * off;
      this._emit(this.alpha, RIP.PUFF, e.px + ox + e.nx * r0 * 0.6, e.py + oy + e.ny * r0 * 0.6, e.pz + oz + e.nz * r0 * 0.6,
        dir[0] * sp, dir[1] * sp, dir[2] * sp, 1e9, 2.5 + 3.0 * fxRandom.next(), r0, size * (0.35 + 0.6 * fxRandom.next() * fxRandom.next()) * (1 + 0.3 * q),
        0.7 + 0.5 * fxRandom.next(), 0, 0, ad[0], ad[1], ad[2], (hasGas ? 0.2 : 0.34) * (0.7 + 0.5 * fxRandom.next()), 0.04 * k);
    }
    // iskry (metal o skałę): szybkie, nisko nad powierzchnią, krótkie
    if (metal && e.speed + e.slide > 260) {
      const ns = Math.min(T.sparkMax, Math.round(10 + (e.speed + e.slide) / 40 * Math.min(1.6, size / 400)));
      for (let k = 0; k < ns; k++) {
        const th = 0.9 + 0.55 * fxRandom.next();
        const phi = skew > 0 && fxRandom.next() < 0.6 ? skewPhi + (fxRandom.next() - 0.5) * 1.0 : fxRandom.next() * TAU;
        this._dirFrom(e.nx, e.ny, e.nz, t1, t2, th, phi, dir);
        const sp = (e.speed * 0.5 + e.slide * 0.7) * (0.4 + 0.9 * fxRandom.next()) + 120;
        const x = e.px + e.nx * 10, y = e.py + e.ny * 10, z = e.pz + e.nz * 10;
        const tl = RockImpactFx.landTime(x, y, z, dir[0] * sp, dir[1] * sp, dir[2] * sp, g, e.rs, 3);
        this._emit(this.add, RIP.SPARK, x, y, z, dir[0] * sp, dir[1] * sp, dir[2] * sp, tl, Math.min(tl, 0.3 + 0.7 * fxRandom.next()),
          2.5 + 3.5 * fxRandom.next() * Math.min(2, size / 400), 0, 0, 10, g, 1, 1, 1, 0.8 + 0.9 * fxRandom.next());
      }
    }
    // błysk (szybkie uderzenie — odparowanie lodu i skały) i żar krateru
    if (q > 0.25) {
      const k = Math.min(1.4, q) * T.flashGain;
      const fs = size * (0.3 + 0.2 * q);
      this._emit(this.add, RIP.FLASH, e.px + e.nx * fs * 0.25, e.py + e.ny * fs * 0.25, e.pz + e.nz * fs * 0.25, 0, 0, 0, 1e9,
        0.22 + 0.08 * q, fs, fs, 0, 0, 0, 6.0, 5.2, 4.2, 1.1 * k);
      this._emit(this.add, RIP.FLASH, e.px + e.nx * fs * 0.4, e.py + e.ny * fs * 0.4, e.pz + e.nz * fs * 0.4, 0, 0, 0, 1e9,
        0.6 + 0.2 * q, fs * 2.2, fs * 2.2, 0, 0, 0, 0.9, 0.55, 0.28, 0.45 * k);
    }
    if (q > 0.45) {
      const gs = size * (0.16 + 0.12 * q);
      this._emit(this.add, RIP.GLOW, e.px + e.nx * 6, e.py + e.ny * 6, e.pz + e.nz * 6, 0, 0, 0, 1e9,
        1.6 + 1.6 * q, gs, gs, 0, 0, 0, 1, 1, 1, Math.min(1, q) * 0.8 * T.glowGain);
    }
  }

  // ------------------------------------------------------------------------------------------------ gaz

  /**
   * Obłok gazu uderzenia: żywa domena uderzeń, w której obłok się mieści — dokłada źródła (scalanie); inaczej nowa głęboka
   * domena (ExplosionFx.deepDomain), gdy obłok jest dość duży na ekranie, domen uderzeń < sufit i zostaje zapas wolnych
   * domen dla wybuchów. Zwraca indeks domeny albo −1 (same cząstki). Wypełnia emitery (gasRecipe).
   */
  _gasImpact(e, q, size) {
    const fx = this.getGas ? this.getGas() : null;
    if (!fx || typeof fx.deepDomain !== 'function') { this.stats.gasNone++; return -1; }
    const T = this.tune;
    if (size < T.gasMinSize) return -1;   // drobne ciała — same cząstki
    const Rc = Math.max(T.cloudMin, Math.min(T.cloudMax, size * (T.cloudBase + T.cloudQ * q)));
    const gx = e.px + this.center.x, gy = -(e.py + this.center.y), gz = e.pz + this.center.z;   // świat gry
    let slot = this._mergeGas(fx, e, Rc);
    if (slot >= 0) this.stats.gasMerged++;
    else {
      // w żywym obłoku uderzeń (za mały, żeby się w nim liczyć) — bez nowej domeny: obłok już tam jest, kłąb dadzą cząstki
      if (this._insideGas(fx, e)) { this.stats.gasNone++; return -1; }
      const live = this._liveGas(fx);
      if (live >= T.gasDomains) { this.stats.gasNone++; return -1; }
      slot = fx.deepDomain(gx, gy, gz, Rc, {
        up: [e.nx, -e.ny, e.nz], ground: { x: this.center.x, y: -this.center.y, z: this.center.z, r: e.rs },
        life: T.gasLife, fadeTime: T.gasFade, baseDecay: T.gasDecay, tint: T.gasTint, fire: 0, tag: ROCK_IMPACT_TAG,
        ambient: T.gasAmbient0 + T.gasAmbientSun * Math.max(0, e.nx * this.U.uSunDir.value.x + e.ny * this.U.uSunDir.value.y + e.nz * this.U.uSunDir.value.z),
        minPx: T.gasMinPx, reserve: T.gasReserve, domainScale: T.domainScale, upShift: T.gasUpShift, priority: 1,
        fineMinPx: T.gasFineMinPx, coarseMaxPx: T.gasCoarseMaxPx
      });
      if (slot < 0) { this.stats.gasNone++; return -1; }
      this._gasSlots.push(slot);
      this.stats.gasNew++;
    }
    this._gasRecipe(fx, slot, e, Rc, q);
    return slot;
  }

  // kierunek poślizgu w scenie (składowa styczna prędkości ciała) — [x, y, z] albo null
  _slideDir(e) {
    let sx = e.vx, sy = e.vy, sz = e.vz;
    const vn = sx * e.nx + sy * e.ny + sz * e.nz;
    sx -= vn * e.nx; sy -= vn * e.ny; sz -= vn * e.nz;
    const l = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (!(l > 1)) return null;
    const out = this._sd || (this._sd = [0, 0, 0]);
    out[0] = sx / l; out[1] = sy / l; out[2] = sz / l;
    return out;
  }

  /**
   * Źródła gazu uderzenia (scena; prymitywy reżysera wybuchów — GasExplosions.jet / puff): pióropusz pary i pyłu wzdłuż
   * normalnej (przy poślizgu pochylony z prądem; gorący — świeci krótko — przy szybkim uderzeniu), stożek wyrzutu (35–55°
   * od normalnej), pierścień przy ziemi (strumienie prawie styczne — po kuli-przeszkodzie rozlewają się w „base surge”),
   * kłąb w miejscu i pył osiadający później. Źródła ≥ 3,2 komórki promienia (mniejsze giną w siatce).
   */
  _gasRecipe(fx, slot, e, Rc, q) {
    const T = this.tune;
    const d = fx.director;
    const s = fx.grid.slots[slot];
    if (!d || !s) return;
    const h = s.h;
    const rmin = 3.2 * h;
    const k = T.gasSmoke;
    const X = e.px + this.center.x, Y = e.py + this.center.y, Z = e.pz + this.center.z;
    const nx = e.nx, ny = e.ny, nz = e.nz;
    const t1 = this._t1 || (this._t1 = [0, 0, 0]), t2 = this._t2 || (this._t2 = [0, 0, 0]);
    this._basis(nx, ny, nz, t1, t2);
    const dir = this._d || (this._d = [0, 0, 0]);
    const jo = this._jo || (this._jo = { delay: 0, fuel: 0, temp: 0, smoke: 0, radial: 0, velBlend: 30, noise: 0.4, tau: 0.3, flicker: 0.2, grow: 1.4, rampIn: 0.02, rampOut: 0.2, velTau: 0.3 });
    const po = this._po || (this._po = { temp: 0, smoke: 0, grow: 1.5, velBlend: 30, noise: 0.6, tau: 0, dir: [0, 0, 0] });
    const sd = e.slide > 30 ? this._slideDir(e) : null;
    // Zasięgi dopasowane do miejsca w domenie (_fitAlong / _fitSpeed): pudło domeny jest płaskie (wysokość = NZ / N
    // szerokości), a symulacja i obraz gaszą gaz za ~0,9 elipsoidy wpisanej w pudło — pióropusz wzdłuż normalnej
    // (przy szczycie skały ≈ +z) bez dopasowania wbijał się w sufit domeny: gorący słup ucięty płasko, ciemna płyta dymu
    // pod sufitem (zgłoszenie sesji upadku 2026-10-19, kamera 3D).
    // 1. oś pióropusza: normalna (skośna z poślizgiem)
    let ax = nx, ay = ny, az = nz;
    if (sd) {
      const w = Math.min(0.6, e.slide / Math.max(100, e.speed + e.slide));
      ax += sd[0] * w; ay += sd[1] * w; az += sd[2] * w;
      const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      ax /= l; ay /= l; az /= l;
    }
    const availN = this._fitAlong(s, X, Y, Z, ax, ay, az, 0.8);
    // 1a. gorąca półkula pary (krótka — świeci barwą ciała czarnego i stygnie; rozlewa się, zamiast iść słupem)
    const rh = Math.max(rmin, Rc * 0.2);
    const vh = this._fitSpeed(Rc * (0.7 + 0.5 * q), 0.12, rh, availN);
    po.temp = 0.4 + 3.2 * q; po.smoke = 2.2 * k; po.grow = 1.9; po.velBlend = 36; po.noise = 0.55; po.tau = 0;
    po.dir[0] = ax * vh; po.dir[1] = ay * vh; po.dir[2] = az * vh;
    // rozprężanie na boki też w granicach domeny (w pionie jest najmniej miejsca)
    const vr = this._fitSpeed(Rc * (0.8 + 0.6 * q), 0.15, rh, availN);
    d.puff(slot, X + nx * rh * 0.5, Y + ny * rh * 0.5, Z + nz * rh * 0.5, rh, 0, 0.1 + 0.05 * q, 0, vr, po);
    // 1b. pióropusz pary i pyłu wzdłuż osi (chłodniejszy, w granicach domeny)
    jo.delay = 0.02; jo.fuel = 0; jo.temp = 0.25 + 1.3 * q; jo.smoke = 4.5 * k; jo.radial = Rc * 0.35; jo.velBlend = 32; jo.noise = 0.45;
    jo.tau = 0.35; jo.flicker = 0.15; jo.grow = 1.7; jo.rampIn = 0.02; jo.rampOut = 0.25; jo.velTau = 0.3;
    const r1 = Math.max(rmin, Rc * 0.16);
    const dur1 = 0.3 + 0.15 * q;
    const availP = this._fitAlong(s, X + nx * r1, Y + ny * r1, Z + nz * r1, ax, ay, az, 0.8);
    d.jet(slot, X + nx * r1, Y + ny * r1, Z + nz * r1, ax, ay, az, r1, Rc * 0.2,
      this._fitSpeed(Rc * (1.2 + 0.8 * q), dur1, Rc * 0.2, availP), dur1, jo);
    // 2. stożek wyrzutu
    const nCone = 5 + Math.floor(fxRandom.next() * 3);
    const c0 = fxRandom.next() * TAU;
    for (let i = 0; i < nCone; i++) {
      const phi = c0 + (i + (fxRandom.next() - 0.5) * 0.6) / nCone * TAU;
      this._dirFrom(nx, ny, nz, t1, t2, 0.6 + 0.35 * fxRandom.next(), phi, dir);
      jo.delay = 0.02 * fxRandom.next(); jo.fuel = 0; jo.temp = 0.15 + 1.1 * q; jo.smoke = 6 * k; jo.radial = Rc * 0.15; jo.velBlend = 30;
      jo.noise = 0.35; jo.tau = 0.4; jo.flicker = 0.25; jo.grow = 1.4; jo.rampIn = 0.02; jo.rampOut = 0.25; jo.velTau = 0.3;
      const r = Math.max(rmin, Rc * 0.1);
      const dur = 0.45 + 0.2 * fxRandom.next();
      const avail = this._fitAlong(s, X + nx * r * 1.2, Y + ny * r * 1.2, Z + nz * r * 1.2, dir[0], dir[1], dir[2], 0.8);
      d.jet(slot, X + nx * r * 1.2, Y + ny * r * 1.2, Z + nz * r * 1.2, dir[0], dir[1], dir[2], r, Rc * 0.18,
        this._fitSpeed(Rc * (1.25 + 0.8 * q) * (0.8 + 0.4 * fxRandom.next()), dur, Rc * 0.18, avail), dur, jo);
    }
    // 3. pierścień przy ziemi (base surge): prawie styczne, nisko nad powierzchnią — kula-przeszkoda rozkłada je po skale
    const nRing = 8 + Math.floor(fxRandom.next() * 5);
    const g0 = fxRandom.next() * TAU;
    for (let i = 0; i < nRing; i++) {
      const phi = g0 + (i + (fxRandom.next() - 0.5) * 0.5) / nRing * TAU;
      this._dirFrom(nx, ny, nz, t1, t2, 1.36 + 0.1 * fxRandom.next(), phi, dir);
      jo.delay = 0.04 + 0.06 * fxRandom.next(); jo.fuel = 0; jo.temp = 0.08 + 0.35 * q; jo.smoke = 10 * k; jo.radial = Rc * 0.2;
      jo.velBlend = 28; jo.noise = 0.4; jo.tau = 0.6; jo.flicker = 0.3; jo.grow = 1.6; jo.rampIn = 0.03; jo.rampOut = 0.35; jo.velTau = 0.45;
      const r = Math.max(rmin, Rc * 0.12);
      const dur = 0.8 + 0.4 * fxRandom.next();
      const avail = this._fitAlong(s, X + nx * r * 1.1, Y + ny * r * 1.1, Z + nz * r * 1.1, dir[0], dir[1], dir[2], 0.85);
      d.jet(slot, X + nx * r * 1.1, Y + ny * r * 1.1, Z + nz * r * 1.1, dir[0], dir[1], dir[2], r, Rc * 0.2,
        this._fitSpeed(Rc * (1.15 + 0.6 * q) * (0.8 + 0.4 * fxRandom.next()), dur, Rc * 0.2, avail), dur, jo);
    }
    // 4. kłąb w miejscu (gorący przy szybkim uderzeniu — odparowany lód i skała)
    const rp = Math.max(rmin, Rc * 0.22);
    const vp = this._fitSpeed(Rc * 0.9, 0.22, rp, availN);
    po.temp = 0.3 + 1.8 * q; po.smoke = 3.5 * k; po.grow = 1.5; po.velBlend = 32; po.noise = 0.6; po.tau = 0;
    po.dir[0] = nx * vp; po.dir[1] = ny * vp; po.dir[2] = nz * vp;
    d.puff(slot, X + nx * rp * 0.6, Y + ny * rp * 0.6, Z + nz * rp * 0.6, rp, 0, 0.22, 0, Rc * 0.8, po);
    // 5. pył osiadający (wolny, później — obłok nie znika od razu)
    po.temp = 0; po.smoke = 3 * k; po.grow = 1.8; po.velBlend = 12; po.noise = 0.7;
    po.dir[0] = nx * Rc * 0.3; po.dir[1] = ny * Rc * 0.3; po.dir[2] = nz * Rc * 0.3;
    const rq = Math.max(rmin, Rc * 0.35);
    d.puff(slot, X + nx * rq * 0.7, Y + ny * rq * 0.7, Z + nz * rq * 0.7, rq, 0.45, 0.6, 0, Rc * 0.4, po);
  }

  /** Źródło pyłu szorowania / osiadania w żywej domenie uderzeń (scena): kłąb z prądem poślizgu, nisko nad skałą. */
  _gasDust(fx, slot, e, Rc, sx, sy, sz, slide) {
    const d = fx.director;
    const s = fx.grid.slots[slot];
    if (!d || !s) return;
    const rmin = 3.2 * s.h;
    const k = this.tune.gasSmoke;
    const po = this._po || (this._po = { temp: 0, smoke: 0, grow: 1.5, velBlend: 30, noise: 0.6, tau: 0, dir: [0, 0, 0] });
    const r = Math.max(rmin, Rc * 0.3);
    const X = e.px + this.center.x + e.nx * r, Y = e.py + this.center.y + e.ny * r, Z = e.pz + this.center.z + e.nz * r;
    po.temp = 0; po.smoke = (slide > 0 ? 5 : 3.5) * k; po.grow = 1.7; po.velBlend = 18; po.noise = 0.65; po.tau = 0;
    const vs = slide * 0.35, vu = Math.max(Rc * 0.25, slide * 0.12);
    po.dir[0] = sx * vs + e.nx * vu; po.dir[1] = sy * vs + e.ny * vu; po.dir[2] = sz * vs + e.nz * vu;
    d.puff(slot, X, Y, Z, r, 0, 0.26, 0, Rc * 0.35, po);
  }

  // żywe domeny uderzeń (porządki listy)
  _liveGas(fx) {
    const L = this._gasSlots;
    let n = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const s = fx.grid.slots[L[i]];
      if (!s || !s.active || !s.deep || s.tag !== ROCK_IMPACT_TAG) { L.splice(i, 1); continue; }
      n++;
    }
    return n;
  }

  // punkt uderzenia w kole życia gazu żywej domeny uderzeń (bez warunku rozmiaru)
  _insideGas(fx, e) {
    const L = this._gasSlots;
    const sx = e.px + this.center.x, sy = e.py + this.center.y, sz = e.pz + this.center.z;
    for (let i = 0; i < L.length; i++) {
      const s = fx.grid.slots[L[i]];
      if (!s || !s.active) continue;
      const half = s.h * s.n * 0.5;
      const dx = sx - s.cx, dy = sy - s.cy;
      if (Math.sqrt(dx * dx + dy * dy) < 0.68 * half && Math.abs(sz - s.cz) < s.h * s.nz * 0.5) return true;
    }
    return false;
  }

  _mergeGas(fx, e, Rc) {
    const L = this._gasSlots;
    this._liveGas(fx);
    const sx = e.px + this.center.x, sy = e.py + this.center.y, sz = e.pz + this.center.z;   // scena
    let best = -1, bestD = Infinity;
    for (let i = 0; i < L.length; i++) {
      const s = fx.grid.slots[L[i]];
      const half = s.h * s.n * 0.5;
      const dx = sx - s.cx, dy = sy - s.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      // obłok w kole życia gazu domeny (jak scalanie wybuchów) i w paśmie wysokości domeny
      if (d + Rc * 0.75 > 0.68 * half - 2 * s.h) continue;
      if (Rc < 3 * s.h) continue;
      if (Math.abs(sz - s.cz) > s.h * s.nz * 0.45) continue;
      if (d < bestD) { bestD = d; best = L[i]; }
    }
    if (best >= 0) fx.grid.feed(best, fx.grid.time + this.tune.gasLife);
    return best;
  }

  _gasScrape(e, size, sx, sy, sz, slide) {
    const fx = this.getGas ? this.getGas() : null;
    if (!fx || !fx.director || size < 160) return;
    const Rc = size * 0.6;
    const slot = this._mergeGas(fx, e, Rc);
    if (slot < 0) return;
    this._gasDust(fx, slot, e, Rc, sx, sy, sz, slide);
  }

  _gasSettle(e, size) {
    const fx = this.getGas ? this.getGas() : null;
    if (!fx || !fx.director || size < 200) return;
    const Rc = size * 0.5;
    const slot = this._mergeGas(fx, e, Rc);
    if (slot < 0) return;
    this._gasDust(fx, slot, e, Rc, 0, 0, 0, 0);
  }

  // ------------------------------------------------------------------------------------------------ klatka

  /**
   * Klatka: dt — czas gry [s] (0 w pauzie), sun — kierunek do Słońca w scenie (x, y; z = 0 — słońce z płaszczyzny gry)
   * albo null.
   */
  update(dt, sunX = null, sunY = null) {
    this.time += Math.max(0, Number(dt) || 0);
    const U = this.U;
    const T = this.tune;
    U.uTime.value = this.time;
    if (Number.isFinite(sunX) && Number.isFinite(sunY)) {
      const l = Math.sqrt(sunX * sunX + sunY * sunY);
      if (l > 1e-6) U.uSunDir.value.set(sunX / l, sunY / l, 0);
    }
    U.uSunGain.value = T.sunGain;
    U.uAmbient.value = T.ambient;
    U.uMinChunk.value = T.minPxChunk;
    U.uMinDust.value = T.minPxDust;
    U.uMinSpark.value = T.minPxSpark;
    U.uFlash.value = T.flashGain;
    U.uGlow.value = T.glowGain;
    const H = Number(this.core?.composerTarget?.height) || 900;
    U.uViewH.value = H;
    // słońce cienia kuli w gazie domen głębokich (reżyser wybuchów) — to samo co cząstek i materiału skały
    const gas = this.getGas ? this.getGas() : null;
    if (gas && typeof gas.setDeepSun === 'function') {
      const sd = U.uSunDir.value;
      gas.setDeepSun(sd.x, sd.y, sd.z);
    }
    for (const p of [this.alpha, this.add]) {
      if (p.hi > p.lo) {
        zbierzZakresPool(p);
        p.lo = Infinity; p.hi = 0;
      }
      // liczba instancji: najwyższy użyty rekord (pierścień po zawinięciu — cały); bez żywych cząstek — siatka schowana
      const live = this.time < p.lastT;
      p.geo.instanceCount = live ? p.used : 0;
      p.mesh.visible = live && p.used > 0;
    }
  }

  /** Wszystko gaśnie (nowa gra / nowa baza). */
  reset() {
    for (const p of [this.alpha, this.add]) {
      for (let i = 0; i < p.cap; i++) p.arr[i * STRIDE + 3] = 1e9;
      p.head = 0; p.lo = 0; p.hi = p.cap; p.lastT = -1e9; p.used = 0;
      p.geo.instanceCount = 0;
      p.mesh.visible = false;
    }
    this._gasSlots.length = 0;
  }

  /** Siatki do rozgrzewki (Core3D.warmup — warstwa tła, licznik instancji ≥ 2: WARIANT_INSTANCJI). */
  warmupMeshes() { return [this.alpha.mesh, this.add.mesh]; }

  dispose() {
    this.root.removeFromParent();
    for (const p of [this.alpha, this.add]) { p.geo.dispose(); p.mesh.material.dispose(); }
  }
}

/** Tag domeny gazu uderzeń w skałę (GasSlot.tag; VENT_TAG = 9 — sesja pożarów, MUZZLE 7, ENGINE 8). */
export const ROCK_IMPACT_TAG = 10;

// wysyłka zmienionego wycinka pierścienia (zakresy zbierane do wysyłki — zakresyWysylki.js)
function zbierzZakresPool(p) {
  const lo = Math.max(0, p.lo), hi = Math.min(p.cap, p.hi);
  if (hi <= lo) return;
  zbierzZakres(p.buf, lo * STRIDE, (hi - lo) * STRIDE);
}

// ---------------------------------------------------------------------------------------------------------------
// Dekoder rekordu ROCK_IMPACT i cel (obraz planetoidy — pirateBaseGame.js rejestruje swoją instancję).

let _host = null;
/** Cel zdarzeń uderzeń (RockImpactFx planetoidy) — null: zdarzenia przepadają (baza bez skały w scenie). */
export function setRockImpactHost(host) { _host = host || null; }
export function rockImpactHost() { return _host; }

const _ev = { type: 0, id: 0, kind: 'other', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, speed: 0, slide: 0, mass: 0, size: 0, energy: 0, vx: 0, vy: 0, vz: 0 };
export const rockImpactCommandStats = { n: 0, ok: 0 };

/**
 * Dekoder ROCK_IMPACT (inline: RenderCommands.reader w index.html; worker: czytelnik workera) → RockImpactFx.onEvent.
 * getExplosionFx — () → reżyser wybuchów (ExplosionFx; głębokie domeny gazu) albo null.
 */
export function installRockImpactCommands(reader, getExplosionFx = null) {
  const R = ROCK_IMPACT_REC;
  const gas = typeof getExplosionFx === 'function' ? getExplosionFx : null;
  reader.on(ROCK_IMPACT_CODE, (rd, d, o) => {
    rockImpactCommandStats.n++;
    const h = _host;
    if (!h) return;
    if (gas && !h.getGas) h.getGas = gas;
    const e = _ev;
    e.type = d[o + R.TYPE]; e.id = d[o + R.ID]; e.kind = ROCK_BODY_KINDS[d[o + R.KIND] | 0] || 'other';
    e.x = d[o + R.X]; e.y = d[o + R.Y]; e.z = d[o + R.Z];
    e.nx = d[o + R.NX]; e.ny = d[o + R.NY]; e.nz = d[o + R.NZ];
    e.speed = d[o + R.SPEED]; e.slide = d[o + R.SLIDE]; e.mass = d[o + R.MASS]; e.size = d[o + R.SIZE]; e.energy = d[o + R.ENERGY];
    e.vx = d[o + R.VX]; e.vy = d[o + R.VY]; e.vz = d[o + R.VZ];
    if (h.onEvent(e.type | 0, e)) rockImpactCommandStats.ok++;
  });
  return rockImpactCommandStats;
}
