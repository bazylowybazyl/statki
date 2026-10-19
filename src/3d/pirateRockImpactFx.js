// src/3d/pirateRockImpactFx.js
//
// UDERZENIA W PLANETOIDĘ pod bazą piratów (misja 1) — obraz. Prośba użytkownika 2026-10-19: przy zniszczeniu habitatu
// wieża przebija dysk mieszkalny i spada na planetoidę, za nią dysk i reszta bazy — „brak dymu / efektu upadku, uderzenia
// w planetę przez większe / mniejsze rzeczy”. Fizykę upadku liczy gra (sesja orkiestratora); tu — efekt UDERZEŃ
// z rekordów ROCK_IMPACT (src/render/rockImpactRecord.js; pisze src/game/story/pirateRockImpacts.js).
//
// Skała to lodowy centaur (ciemny regolit z lodem): szybkie uderzenie odparowuje lód — para + pył. PYŁ NA BOKI
// (2026-10-19, prośba użytkownika: „pył od uderzeń przykrywa też budowle — budowla spada, a od uderzenia pył leci na
// boki”): rekord niesie OBRYS bryły z góry (fx … fb — pirateBaseFall.js bodyFootprint), a wszystkie źródła (gaz, odłamki,
// pył, kłęby, iskry) rodzą się na jego obwodzie (gęściej przy punkcie styku — _rim) i lecą na zewnątrz, nisko nad skałą
// (kąty 56–85° od normalnej); błysk i żar krateru leżą pod bryłą (zasłania je). Marsz gazu domen głębokich nie zna
// głębi brył (kończy się na kuli skały) — gaz w obrysie bryły rysowałby się na niej, stąd źródła poza obrysem. Warstwy:
//   • GAZ (siatka 3D w compute — src/3d/gas/, „fajne efekty dymu” wybuchów) w GŁĘBOKIEJ domenie (GasSlot.deep — pass TŁA,
//     kamera perspektywy jak skała; ExplosionFx.deepDomain) na środku obrysu: kula-przeszkoda = skała (gaz rozlewa się po
//     niej), pierścień strumieni prawie stycznych z krawędzi („base surge”), kłęby u podstawy, niski wyrzut przy punkcie
//     styku, pył osiadający; bliskie uderzenia dokładają się do żywej domeny (scalanie), sufit domen uderzeń, zapas
//     wolnych domen dla wybuchów w płaszczyźnie gry;
//   • CZĄSTKI (dwie partie TSL, JEDEN rysunek na rodzaj mieszania, pass tła): KURTYNA WYRZUTU — odłamki skały po niskich
//     łukach balistycznych ku środkowi skały (grawitacja z PIRATE_ROCK_SPEC.gravity — próżnia, bez oporu: wolno, bez
//     „wiszenia”), czas lądowania na kuli liczony na CPU przy wyrzucie (Newton), po lądowaniu odłamek zamienia się w mały
//     kłąb pyłu; pył kurtyny; PIERŚCIEŃ PYŁU ślizgający się po powierzchni (rzut na kulę w shaderze); kłęby u podstawy;
//     ISKRY (metal o skałę), BŁYSK i ŻAR KRATERU (szybkie uderzenia, addytywnie, HDR — bloom); małe uderzenia — same
//     cząstki; szorowanie — ślad pyłu spod krawędzi z prądem poślizgu.
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
import { ROCK_IMPACT_CODE, ROCK_IMPACT_REC, ROCK_EVENT, ROCK_BODY_KINDS, ROCK_FOOT_BINS } from '../render/rockImpactRecord.js';
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
  cloudFootK: 1.05,       // promień obłoku ≥ półprzekątna obrysu bryły × tyle (pierścień od krawędzi mieści się w domenie)
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
  // życie i zanik pyłu: w próżni pył nie wisi (leci po łukach i opada) — obłok po wieży nie może zakrywać sektorów
  // dysku lądujących 2–3 s później (dawniej 7,5 s + 3 s, zanik −0,38)
  gasLife: 3.0,           // [s] życie domeny po ostatnim zasileniu (potem wygaszanie gasFade)
  gasFade: 2.5,
  gasDecay: 0.1,          // stały zanik dymu domeny [1/s] ponad dym wybuchów (0,545/s globalnie; ujemny — wolniej)
  // uderzenie dołączone do żywej domeny: pył × mergeMax × (rozmiar / mergeSize)² (najwyżej mergeMax), poniżej mergeMin —
  // bez gazu (drobnica w środku pola upadku: same cząstki); szorowanie dokłada gaz od rozmiaru ciała scrapeGasMinSize, bez
  // przedłużania życia domeny; osiadanie — bez gazu
  mergeSize: 900,
  mergeMax: 0.5,
  mergeMin: 0.12,
  scrapeGasMinSize: 600,
  gasTint: [1.75, 1.66, 1.56],   // barwa pyłu (× albedo sadzy gry 0,15 — szary regolit z lodem)
  gasSmoke: 0.5,
  // pierścień gazu z krawędzi: prędkość (× promień obłoku: base + q · k) i rozchylenie strumienia — wolniej i węziej niż
  // dawny pierścień spod środka (pierścienie sąsiednich brył nie zachodzą na siebie na całą szerokość)
  rimJetSpeed: [0.95, 0.5],
  rimJetRadial: 0.12,
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
  // OBRYS bryły (2026-10-19, prośba użytkownika: „pył od uderzeń przykrywa budowle — budowla spada, a pył od uderzenia
  // leci NA BOKI”): pył, odłamki, iskry i gaz rodzą się na obwodzie obrysu bryły z góry (rekord: fx … fr — rzut węzłów,
  // profil biegunowy), lecą na zewnątrz nisko nad skałą; margines za krawędzią i skala bliskości punktu styku (× 2 ×
  // średni promień obrysu), kąty od normalnej skały
  rimMargin: 0.06,
  rimNear: 0.35,
  rimChunkTh: [0.98, 0.36],   // [rad] odłamki: od, rozrzut (~56–77° od normalnej)
  rimDustTh: [1.05, 0.33],    // pył kurtyny (~60–79°)
  rimJetTh: [1.45, 0.1],      // strumienie gazu przy ziemi (~83–89° — kula skały rozkłada je po powierzchni)
  rimConeTh: [1.13, 0.18],    // niski wyrzut gazu przy punkcie styku (~65–75°)
  surfRise: [0.01, 0.025],    // [× rozmiar ciała / s] unoszenie się pierścienia pyłu (dawniej 0,03–0,08 — wyrastał nad bryłę)
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
    // przesunięcie ku kamerze wzdłuż promienia widzenia (rozmiar na ekranie bez zmian): pył kurtyny mniej, reszta o promień;
    // błysk i żar krateru mniej — leżą pod bryłą, która je zasłania (światło wychodzi spod krawędzi)
    const shiftK = select(kind.greaterThan(5.5), float(0.7), select(kind.greaterThan(3.5), float(0.4), float(1.15)));
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

  /**
   * OBRYS bryły w płaszczyźnie stycznej (rekord: fx, fy, fz, ux, uy, uz, fn, fr — gra; src/game/story/pirateBaseFall.js
   * bodyFootprint — RZUT WĘZŁÓW, profil biegunowy ROCK_FOOT_BINS promieni) → e.F (scena, względem środka skały): środek,
   * osie u, v = n × u, promienie r[k] (wycinek k — kąt (k + ½) · 2π / K od u ku v), margines m (pył rodzi się tuż za
   * krawędzią), skala bliskości `near` (źródła gęściej przy punkcie styku), rmax, lmax (największa długość łuku na
   * radian — rozkład po obwodzie). Bez obrysu (testy, stare zdarzenia) — koło z rozmiaru ciała wokół punktu styku.
   */
  _footprint(e, ev) {
    const F = e.F;
    const K = ROCK_FOOT_BINS;
    if (!F.r) F.r = new Float64Array(K);
    const R = F.r;
    const size = Math.max(8, e.size);
    let ux = Number(ev.ux) || 0, uy = -(Number(ev.uy) || 0), uz = Number(ev.uz) || 0;
    // oś u ⊥ n (float32 rekordu — dorównanie)
    const un = ux * e.nx + uy * e.ny + uz * e.nz;
    ux -= un * e.nx; uy -= un * e.ny; uz -= un * e.nz;
    let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    let has = (ev.fn | 0) === K && !!ev.fr && ul > 1e-3 && Number.isFinite(ev.fx) && Number.isFinite(ev.fy) && Number.isFinite(ev.fz);
    let rsum = 0, rmax = 0;
    if (has) {
      // rozpad i zgniot nie mogą rozdąć obrysu ponad ~promień ciała
      for (let k = 0; k < K; k++) {
        const r = Math.min(Math.max(0, Number(ev.fr[k]) || 0), size * 1.25);
        R[k] = r; rsum += r;
        if (r > rmax) rmax = r;
      }
      if (!(rmax > 0)) has = false;
    }
    if (has) {
      F.cx = ev.fx - this.center.x; F.cy = -ev.fy - this.center.y; F.cz = ev.fz - this.center.z;
      // środek na płaszczyźnie stycznej przez punkt styku
      const dn = (F.cx - e.px) * e.nx + (F.cy - e.py) * e.ny + (F.cz - e.pz) * e.nz;
      F.cx -= dn * e.nx; F.cy -= dn * e.ny; F.cz -= dn * e.nz;
    } else {
      const t1 = this._t1 || (this._t1 = [0, 0, 0]), t2 = this._t2 || (this._t2 = [0, 0, 0]);
      this._basis(e.nx, e.ny, e.nz, t1, t2);
      F.cx = e.px; F.cy = e.py; F.cz = e.pz;
      ux = t1[0]; uy = t1[1]; uz = t1[2]; ul = 1;
      rmax = size * 0.55;
      R.fill(rmax);
      rsum = rmax * K;
    }
    ux /= ul; uy /= ul; uz /= ul;
    F.ux = ux; F.uy = uy; F.uz = uz;
    F.vx = e.ny * uz - e.nz * uy; F.vy = e.nz * ux - e.nx * uz; F.vz = e.nx * uy - e.ny * ux;
    const rmean = rsum / K;
    F.K = K; F.rmax = rmax;
    F.m = Math.max(12, this.tune.rimMargin * 2 * rmean);
    F.near = Math.max(60, this.tune.rimNear * 2 * rmean);
    // długość łuku na radian (√(r² + r′²)) — górna granica do rozkładu źródeł równo po obwodzie
    const kd = K / TAU;
    let lmax = 1e-6;
    for (let k = 0; k < K; k++) {
      const r0 = R[k], r1 = R[(k + 1) % K], dr = (r1 - r0) * kd, rr = Math.max(r0, r1);
      const l = Math.sqrt(rr * rr + dr * dr);
      if (l > lmax) lmax = l;
    }
    F.lmax = lmax;
    return F;
  }

  /**
   * Punkt na obwodzie obrysu i normalna na zewnątrz w płaszczyźnie stycznej: profil biegunowy r(θ) — liniowo między
   * środkami wycinków, odsunięty wzdłuż normalnej krzywej (N ∝ r·e_r − r′·e_θ) o margines m, a przy skoku promienia
   * między wycinkami o połowę skoku więcej (prosta między maksimami wycinków może ściąć róg bryły). out = [x, y, z
   * (scena wzgl. środka skały), ox, oy, oz]. Rozkład: równo po długości obwodu z akceptacją wNear + (1 − wNear) ·
   * exp(−d / near), d — odległość od punktu styku (pył bucha spod bryły najmocniej tam, gdzie uderzyła, ale wychodzi
   * spod całej krawędzi). Bez alokacji.
   */
  _rim(e, out, wNear = 0.3) {
    const F = e.F;
    const R = F.r, K = F.K;
    const kd = K / TAU;
    let nu = 1, nv = 0;
    for (let tries = 0; tries < 12; tries++) {
      const th = fxRandom.next() * TAU;
      const x = th * kd - 0.5;
      let k0 = Math.floor(x);
      const t = x - k0;
      k0 = ((k0 % K) + K) % K;
      const k1 = (k0 + 1) % K;
      const jump = R[k1] - R[k0];
      const r = R[k0] + jump * t;
      const dr = jump * kd;
      const c = Math.cos(th), s = Math.sin(th);
      // normalna krzywej biegunowej r·e_r − r′·e_θ (e_r = (c, s), e_θ = (−s, c)) w osiach (u, v)
      nu = r * c + dr * s; nv = r * s - dr * c;
      const nl = Math.sqrt(nu * nu + nv * nv);
      if (nl > 1e-6) { nu /= nl; nv /= nl; } else { nu = c; nv = s; }
      const m = F.m + 0.5 * Math.abs(jump);
      const lu = c * r + nu * m, lv = s * r + nv * m;
      out[0] = F.cx + F.ux * lu + F.vx * lv; out[1] = F.cy + F.uy * lu + F.vy * lv; out[2] = F.cz + F.uz * lu + F.vz * lv;
      const dx = out[0] - e.px, dy = out[1] - e.py, dz = out[2] - e.pz;
      const wl = Math.sqrt(r * r + dr * dr) / F.lmax;
      if (fxRandom.next() < wl * (wNear + (1 - wNear) * Math.exp(-Math.sqrt(dx * dx + dy * dy + dz * dz) / F.near))) break;
    }
    out[3] = F.ux * nu + F.vx * nv; out[4] = F.uy * nu + F.vy * nv; out[5] = F.uz * nu + F.vz * nv;
    return out;
  }

  /**
   * Kierunek wylotu z krawędzi obrysu: normalna krawędzi (rim[3..5]) obrócona w płaszczyźnie stycznej o losowy kąt
   * ±spread, z prądem poślizgu (sd — styczny, z prawdopodobieństwem skew), pochylona od normalnej skały o th
   * (th ≈ π/2 — po skale; mniej — w górę). Pył i odłamki lecą NA BOKI od bryły, nie nad nią. out[0..2].
   */
  _outDir(e, rim, th, spread, sd, skew, out) {
    const nx = e.nx, ny = e.ny, nz = e.nz;
    const ox = rim[3], oy = rim[4], oz = rim[5];
    const a = (fxRandom.next() - 0.5) * 2 * spread;
    const ca = Math.cos(a), sa = Math.sin(a);
    const wx = ny * oz - nz * oy, wy = nz * ox - nx * oz, wz = nx * oy - ny * ox;
    let tx = ox * ca + wx * sa, ty = oy * ca + wy * sa, tz = oz * ca + wz * sa;
    if (sd && skew > 0 && fxRandom.next() < skew) {
      tx += sd[0] * 1.2; ty += sd[1] * 1.2; tz += sd[2] * 1.2;
      // nigdy pod bryłę: składowa na zewnątrz krawędzi ≥ 0,2
      const to = tx * ox + ty * oy + tz * oz;
      if (to < 0.2) { const c = 0.2 - to; tx += ox * c; ty += oy * c; tz += oz * c; }
      const l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= l; ty /= l; tz /= l;
    }
    const st = Math.sin(th), ct = Math.cos(th);
    out[0] = tx * st + nx * ct; out[1] = ty * st + ny * ct; out[2] = tz * st + nz * ct;
    return out;
  }

  // ------------------------------------------------------------------------------------------------ zdarzenia

  /**
   * Zdarzenie z rekordu (dekoder): type — ROCK_EVENT, ev — pola rekordu w GRZE (x, y, z, nx, ny, nz, speed, slide, mass,
   * size, energy, vx, vy, vz, id, kind — napis, obrys: fx, fy, fz, ux, uy, uz, fa, fb).
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
    const e = this._e || (this._e = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 1, speed: 0, slide: 0, size: 0, energy: 0, vx: 0, vy: 0, vz: 0, kind: 'other', id: 0, rs: 0,
      F: { cx: 0, cy: 0, cz: 0, ux: 1, uy: 0, uz: 0, vx: 0, vy: 1, vz: 0, K: 0, r: null, rmax: 0, m: 0, near: 1, lmax: 1 } });
    e.px = px; e.py = py; e.pz = pz; e.nx = nx; e.ny = ny; e.nz = nz;
    e.speed = ev.speed; e.slide = ev.slide; e.size = ev.size; e.energy = ev.energy;
    e.vx = ev.vx; e.vy = -ev.vy; e.vz = ev.vz;
    e.kind = ev.kind; e.id = ev.id;
    e.rs = Math.sqrt(px * px + py * py + pz * pz);
    if (type !== ROCK_EVENT.BLAST) this._footprint(e, ev);
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
    const rim = this._rimA || (this._rimA = new Float64Array(6));
    const sdir = this._sdA || (this._sdA = [0, 0, 0]);
    sdir[0] = sx; sdir[1] = sy; sdir[2] = sz;
    const n = Math.max(1, Math.round(T.scrapeDust * Math.min(2.5, 0.6 + size / 500)));
    for (let k = 0; k < n; k++) {
      // pył spod krawędzi przy punkcie styku: do przodu z prądem i na boki (bruzda), wolno się unosi
      this._rim(e, rim, 0.2);
      const sp = slide * (0.18 + 0.25 * fxRandom.next());
      const vx = sx * sp + rim[3] * sp * 0.6, vy = sy * sp + rim[4] * sp * 0.6, vz = sz * sp + rim[5] * sp * 0.6;
      const r0 = size * (0.12 + 0.12 * fxRandom.next());
      const lift = r0 * 0.4;
      this._emit(this.alpha, RIP.SURF, rim[0] + rim[3] * r0 * 0.5 + e.nx * lift, rim[1] + rim[4] * r0 * 0.5 + e.ny * lift, rim[2] + rim[5] * r0 * 0.5 + e.nz * lift,
        vx, vy, vz, 1e9, 2.4 + 2.2 * fxRandom.next(), r0, size * (0.5 + 0.4 * fxRandom.next()), 0.9 + 0.6 * fxRandom.next(), lift,
        size * 0.015 * fxRandom.next(), ad[0], ad[1], ad[2], 0.5 + 0.25 * fxRandom.next(), 0.03 * k);
    }
    // odłamki z bruzdy: kilka małych, nisko na boki i z prądem
    const nc = Math.min(12, Math.round(2 + size / 160));
    const g = T.gravity;
    const ac = T.albedoChunk;
    const dir = this._d || (this._d = [0, 0, 0]);
    for (let k = 0; k < nc; k++) {
      this._rim(e, rim, 0.2);
      this._outDir(e, rim, 1.0 + 0.35 * fxRandom.next(), 0.8, sdir, 0.6, dir);
      const sp = slide * (0.25 + 0.5 * fxRandom.next()) + 40;
      const x = rim[0] + e.nx * 6, y = rim[1] + e.ny * 6, z = rim[2] + e.nz * 6;
      const vx = dir[0] * sp, vy = dir[1] * sp, vz = dir[2] * sp;
      const tl = RockImpactFx.landTime(x, y, z, vx, vy, vz, g, e.rs, 20);
      const s = 6 + 18 * fxRandom.next() * fxRandom.next();
      this._emit(this.alpha, RIP.CHUNK, x, y, z, vx, vy, vz, tl, tl + 1.3, s, s * 6, 0, 6, g, ac[0], ac[1], ac[2], 1);
    }
    // iskry (metal o skałę) spod krawędzi przy punkcie styku
    if (e.slide > 140 && e.kind !== 'other') {
      const ns = Math.min(14, Math.round(e.slide / 70));
      for (let k = 0; k < ns; k++) {
        this._rim(e, rim, 0.1);
        this._outDir(e, rim, 1.15 + 0.3 * fxRandom.next(), 0.6, sdir, 0.6, dir);
        const sp = e.slide * (0.6 + 0.8 * fxRandom.next());
        const x = rim[0] + e.nx * 4, y = rim[1] + e.ny * 4, z = rim[2] + e.nz * 4;
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
    const size = Math.max(8, e.size);
    const ad = T.albedoDust;
    const rim = this._rimA || (this._rimA = new Float64Array(6));
    const n = Math.min(16, Math.round(5 + size / 120));
    for (let k = 0; k < n; k++) {
      // ostatni kłąb spod krawędzi bryły, po skale na zewnątrz
      this._rim(e, rim, 0.6);
      const sp = size * (0.25 + 0.2 * fxRandom.next());
      const r0 = size * 0.18;
      const x = rim[0] + rim[3] * r0 * 0.5 + e.nx * r0 * 0.3, y = rim[1] + rim[4] * r0 * 0.5 + e.ny * r0 * 0.3, z = rim[2] + rim[5] * r0 * 0.5 + e.nz * r0 * 0.3;
      this._emit(this.alpha, RIP.SURF, x, y, z, rim[3] * sp, rim[4] * sp, rim[5] * sp, 1e9,
        3.0 + 2.0 * fxRandom.next(), r0, size * (0.5 + 0.3 * fxRandom.next()), 0.8, r0 * 0.3, size * 0.012,
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
   * Cząstki uderzenia — z KRAWĘDZI OBRYSU bryły na zewnątrz, nisko nad skałą (prośba użytkownika 2026-10-19: budowla
   * spada, a pył od uderzenia leci na boki — nie nad nią): kurtyna wyrzutu (odłamki i pył po łukach balistycznych,
   * 56–79° od normalnej, wcześniejsze szybsze), pierścień pyłu po powierzchni, kłęby u podstawy, iskry (metal o skałę),
   * błysk i żar krateru pod bryłą (zasłania je bryła — wychodzą spod krawędzi). Źródła gęściej przy punkcie styku
   * (_rim). `hasGas` — obłok z gazu (mniej kłębów cząstkowych).
   */
  _particlesImpact(e, q, size, metal, hasGas) {
    const T = this.tune;
    const bk = this._budgetK();
    const g = T.gravity;
    const nx = e.nx, ny = e.ny, nz = e.nz;
    const rim = this._rimA || (this._rimA = new Float64Array(6));
    const dir = this._d || (this._d = [0, 0, 0]);
    const ac = T.albedoChunk, ad = T.albedoDust;
    // prędkość wyrzutu: ułamek prędkości uderzenia (szybkie — więcej), z dolnym progiem (bryła i tak rozbija skałę)
    const vMax = Math.max(140, (e.speed * 0.38 + e.slide * 0.2) * (0.6 + 0.4 * q)) + size * 0.25;
    // poślizg (uderzenie skośne): część wyrzutu z prądem
    const sd = e.slide > 30 ? this._slideDir(e) : null;
    const skew = sd ? Math.min(0.6, e.slide / Math.max(80, e.speed + e.slide)) : 0;
    const thC = T.rimChunkTh, thD = T.rimDustTh;
    const nChunk = Math.min(T.chunkMax, Math.round(size * T.chunkK * (0.4 + q) * bk));
    for (let k = 0; k < nChunk; k++) {
      const u = fxRandom.next();                                 // 0 — wcześnie, szybko
      this._rim(e, rim, 0.25);
      this._outDir(e, rim, thC[0] + thC[1] * fxRandom.next(), 0.55, sd, skew, dir);
      const sp = vMax * Math.pow(1 - 0.72 * u, 1.6) * (0.75 + 0.5 * fxRandom.next());
      const x = rim[0] + nx * 8, y = rim[1] + ny * 8, z = rim[2] + nz * 8;
      const vx = dir[0] * sp, vy = dir[1] * sp, vz = dir[2] * sp;
      const tl = RockImpactFx.landTime(x, y, z, vx, vy, vz, g, e.rs, 25);
      const sz = (8 + 46 * fxRandom.next() * fxRandom.next()) * Math.min(2.2, 0.5 + size / 600);
      const delay = u * (0.25 + 0.15 * q);
      this._emit(this.alpha, RIP.CHUNK, x, y, z, vx, vy, vz, tl, tl + 1.2, sz, sz * (5 + 4 * fxRandom.next()), 0, 8, g,
        ac[0], ac[1], ac[2], 1, delay);
    }
    // pył kurtyny (miękkie kłęby po niskich łukach z krawędzi — mgiełka wyrzutu na boki)
    const nDust = Math.min(260, Math.round(size * T.dustK * (0.6 + q) * (hasGas ? 0.6 : 1) * bk));
    for (let k = 0; k < nDust; k++) {
      const u = fxRandom.next();
      this._rim(e, rim, 0.3);
      this._outDir(e, rim, thD[0] + thD[1] * fxRandom.next(), 0.5, sd, skew, dir);
      const sp = vMax * Math.pow(1 - 0.7 * u, 1.4) * (0.55 + 0.45 * fxRandom.next());
      const x = rim[0] + nx * 20, y = rim[1] + ny * 20, z = rim[2] + nz * 20;
      const vx = dir[0] * sp, vy = dir[1] * sp, vz = dir[2] * sp;
      const tl = RockImpactFx.landTime(x, y, z, vx, vy, vz, g, e.rs, 25);
      const s0 = size * (0.04 + 0.05 * fxRandom.next());
      this._emit(this.alpha, RIP.DUST, x, y, z, vx, vy, vz, tl, Math.min(tl + 0.5, 2.0 + 3 * fxRandom.next()), s0, s0 * (3 + 2 * fxRandom.next()),
        0, 20, g, ad[0], ad[1], ad[2], 0.2 + 0.12 * fxRandom.next(), u * 0.3);
    }
    // pierścień pyłu po powierzchni (base surge — pył wypchnięty spod bryły, szybki front zwalnia, ledwo się unosi)
    const nSurf = Math.min(140, Math.round((20 + size * T.surfK * (0.6 + q)) * Math.max(0.4, bk)));
    const vSurf = size * (1.0 + 0.9 * q) + 60;
    const rise = T.surfRise;
    for (let k = 0; k < nSurf; k++) {
      this._rim(e, rim, 0.45);
      this._outDir(e, rim, Math.PI * 0.5, 0.4, sd, skew * 0.6, dir);
      const sp = vSurf * (0.6 + 0.6 * fxRandom.next());
      const r0 = size * (0.08 + 0.07 * fxRandom.next());
      const lift = r0 * 0.5;
      this._emit(this.alpha, RIP.SURF, rim[0] + nx * lift, rim[1] + ny * lift, rim[2] + nz * lift,
        dir[0] * sp, dir[1] * sp, dir[2] * sp, 1e9,
        3.5 + 3.0 * fxRandom.next(), r0, size * (0.28 + 0.22 * fxRandom.next()) * (1 + 0.3 * q), 0.75 + 0.45 * fxRandom.next(), lift,
        size * (rise[0] + rise[1] * fxRandom.next()), ad[0], ad[1], ad[2], (hasGas ? 0.28 : 0.45) * (0.7 + 0.5 * fxRandom.next()),
        0.04 + 0.12 * fxRandom.next());
    }
    // kłęby u podstawy (krawędź, na zewnątrz, nisko; bez gazu — główny obłok; z gazem — kilka)
    const nPuff = hasGas ? 3 : Math.min(12, Math.round(4 + size / 220));
    for (let k = 0; k < nPuff; k++) {
      this._rim(e, rim, 0.35);
      this._outDir(e, rim, 1.2 + 0.3 * fxRandom.next(), 0.5, sd, skew, dir);
      const sp = size * (0.25 + 0.45 * fxRandom.next()) * (0.6 + 0.5 * q);
      const r0 = size * (0.08 + 0.1 * fxRandom.next());
      // środek kłębu za krawędzią o pół promienia (nie wchodzi pod bryłę), nisko nad skałą
      const x = rim[0] + rim[3] * r0 * 0.5 + nx * r0 * 0.6, y = rim[1] + rim[4] * r0 * 0.5 + ny * r0 * 0.6, z = rim[2] + rim[5] * r0 * 0.5 + nz * r0 * 0.6;
      this._emit(this.alpha, RIP.PUFF, x, y, z,
        dir[0] * sp, dir[1] * sp, dir[2] * sp, 1e9, 2.5 + 3.0 * fxRandom.next(), r0, size * (0.22 + 0.3 * fxRandom.next() * fxRandom.next()) * (1 + 0.25 * q),
        0.7 + 0.5 * fxRandom.next(), 0, 0, ad[0], ad[1], ad[2], (hasGas ? 0.2 : 0.34) * (0.7 + 0.5 * fxRandom.next()), 0.04 * k);
    }
    // iskry (metal o skałę): spod krawędzi przy punkcie styku, płasko po skale, krótkie; mniej i wolniej niż dawniej —
    // płaskie smugi z góry wyglądają na dłuższe (gwiazdy „fajerwerków” przy odłamach z 2,5 km/s)
    if (metal && e.speed + e.slide > 260) {
      const ns = Math.min(T.sparkMax, Math.round(6 + (e.speed + e.slide) / 70 * Math.min(1.4, size / 500)));
      for (let k = 0; k < ns; k++) {
        this._rim(e, rim, 0.15);
        this._outDir(e, rim, 1.2 + 0.3 * fxRandom.next(), 0.6, sd, skew, dir);
        const sp = (e.speed * 0.32 + e.slide * 0.6) * (0.4 + 0.8 * fxRandom.next()) + 100;
        const x = rim[0] + nx * 10, y = rim[1] + ny * 10, z = rim[2] + nz * 10;
        const tl = RockImpactFx.landTime(x, y, z, dir[0] * sp, dir[1] * sp, dir[2] * sp, g, e.rs, 3);
        this._emit(this.add, RIP.SPARK, x, y, z, dir[0] * sp, dir[1] * sp, dir[2] * sp, tl, Math.min(tl, 0.3 + 0.7 * fxRandom.next()),
          2.5 + 3.5 * fxRandom.next() * Math.min(2, size / 400), 0, 0, 10, g, 1, 1, 1, 0.8 + 0.9 * fxRandom.next());
      }
    }
    // błysk (szybkie uderzenie — odparowanie lodu i skały) i żar krateru; drobnica błyska słabiej (seria odłamów to nie
    // pokaz fajerwerków)
    if (q > 0.25) {
      const k = Math.min(1.4, q) * T.flashGain * Math.min(1, 0.4 + size / 1000);
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
    // obłok obejmuje obrys bryły i pierścień pyłu za jego krawędzią (koło życia gazu w domenie ~1,9 Rc)
    const F = e.F;
    const diag = F.rmax + F.m;
    const Rc = Math.max(T.cloudMin, Math.min(T.cloudMax, Math.max(size * (T.cloudBase + T.cloudQ * q), diag * T.cloudFootK)));
    const gx = F.cx + this.center.x, gy = -(F.cy + this.center.y), gz = F.cz + this.center.z;   // świat gry — środek obrysu
    let slot = this._mergeGas(fx, e, Rc);
    // uderzenie dołączone do żywej domeny dokłada pył w proporcji do rozmiaru ciała (setki odłamów w środku pola
    // upadku dawały z pełnych receptur jednolitą kulę waty nad wszystkimi bryłami)
    let mk = 1;
    if (slot >= 0) {
      // drobnica w żywym obłoku — same cząstki; duża bryła — najwyżej pół receptury
      const m = (size / T.mergeSize) * (size / T.mergeSize) * T.mergeMax;
      if (m < T.mergeMin) { this.stats.gasNone++; return -1; }
      this.stats.gasMerged++;
      mk = Math.min(T.mergeMax, m);
    } else {
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
    this._gasRecipe(fx, slot, e, Rc, q, mk);
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
   * Źródła gazu uderzenia (scena; prymitywy reżysera wybuchów — GasExplosions.jet / puff) — wszystkie na KRAWĘDZI OBRYSU
   * bryły i na zewnątrz, nisko nad skałą (prośba użytkownika 2026-10-19: budowla spada, a pył od uderzenia leci na boki;
   * dawny pióropusz wzdłuż normalnej, gorąca półkula i kłąb w punkcie styku przykrywały bryłę): pierścień strumieni
   * prawie stycznych („base surge” — pył wypchnięty spod bryły; kula-przeszkoda rozkłada je po skale; przy szybkim
   * uderzeniu pierwsze gorące — para z lodu), kłęby u podstawy krawędzi, niski wyrzut przy punkcie styku (65–75° od
   * normalnej) i pył osiadający później. Gęściej przy punkcie styku (_rim). Źródła ≥ 3,2 komórki promienia (mniejsze
   * giną w siatce); zasięgi dopasowane do miejsca w płaskiej domenie (_fitAlong / _fitSpeed — gaz za ~0,9 elipsoidy
   * domeny gaśnie płasko).
   */
  _gasRecipe(fx, slot, e, Rc, q, mk = 1) {
    const T = this.tune;
    const d = fx.director;
    const s = fx.grid.slots[slot];
    if (!d || !s) return;
    const rmin = 3.2 * s.h;
    // mk < 1 — uderzenie dołączone do żywej domeny (_gasImpact): mniej źródeł i mniej pyłu
    const k = T.gasSmoke * mk;
    const nk = Math.max(0.3, mk);
    const cx = this.center.x, cy = this.center.y, cz = this.center.z;
    const nx = e.nx, ny = e.ny, nz = e.nz;
    const rim = this._rimA || (this._rimA = new Float64Array(6));
    const dir = this._d || (this._d = [0, 0, 0]);
    const jo = this._jo || (this._jo = { delay: 0, fuel: 0, temp: 0, smoke: 0, radial: 0, velBlend: 30, noise: 0.4, tau: 0.3, flicker: 0.2, grow: 1.4, rampIn: 0.02, rampOut: 0.2, velTau: 0.3 });
    const po = this._po || (this._po = { temp: 0, smoke: 0, grow: 1.5, velBlend: 30, noise: 0.6, tau: 0, dir: [0, 0, 0] });
    const sd = e.slide > 30 ? this._slideDir(e) : null;
    const skew = sd ? Math.min(0.6, e.slide / Math.max(100, e.speed + e.slide)) : 0;
    // 1. pierścień przy ziemi: strumienie z krawędzi na zewnątrz (~80–85° od normalnej), źródło tuż za krawędzią
    const thJ = T.rimJetTh, vJ = T.rimJetSpeed;
    const nRing = Math.max(3, Math.round((10 + Math.floor(fxRandom.next() * 5)) * nk));
    for (let i = 0; i < nRing; i++) {
      this._rim(e, rim, 0.3);
      this._outDir(e, rim, thJ[0] + thJ[1] * fxRandom.next(), 0.35, sd, skew, dir);
      const r = Math.max(rmin, Rc * 0.1);
      const X = rim[0] + cx + rim[3] * r + nx * r, Y = rim[1] + cy + rim[4] * r + ny * r, Z = rim[2] + cz + rim[5] * r + nz * r;
      jo.delay = 0.02 + 0.08 * fxRandom.next(); jo.fuel = 0; jo.temp = i < 3 ? 0.2 + 1.6 * q : 0.08 + 0.35 * q; jo.smoke = 7 * k;
      jo.radial = Rc * T.rimJetRadial; jo.velBlend = 28; jo.noise = 0.4; jo.tau = 0.6; jo.flicker = 0.3; jo.grow = 1.4; jo.rampIn = 0.03;
      jo.rampOut = 0.35; jo.velTau = 0.45;
      const dur = 0.7 + 0.35 * fxRandom.next();
      const avail = this._fitAlong(s, X, Y, Z, dir[0], dir[1], dir[2], 0.85);
      d.jet(slot, X, Y, Z, dir[0], dir[1], dir[2], r, Rc * 0.18,
        this._fitSpeed(Rc * (vJ[0] + vJ[1] * q) * (0.8 + 0.4 * fxRandom.next()), dur, Rc * 0.18, avail), dur, jo);
    }
    // 2. kłęby u podstawy krawędzi: nisko, na zewnątrz (przy szybkim uderzeniu pierwsze gorące — para spod bryły)
    const nPuff = Math.max(1, Math.round(4 * nk));
    for (let i = 0; i < nPuff; i++) {
      this._rim(e, rim, 0.25);
      const rp = Math.max(rmin, Rc * 0.13);
      const X = rim[0] + cx + rim[3] * rp * 0.7 + nx * rp * 0.6, Y = rim[1] + cy + rim[4] * rp * 0.7 + ny * rp * 0.6, Z = rim[2] + cz + rim[5] * rp * 0.7 + nz * rp * 0.6;
      const avail = this._fitAlong(s, X, Y, Z, rim[3], rim[4], rim[5], 0.8);
      const vp = this._fitSpeed(Rc * (0.5 + 0.3 * q), 0.2, rp, avail);
      po.temp = i < 2 ? 0.3 + 1.8 * q : 0.1; po.smoke = 2.5 * k; po.grow = 1.4; po.velBlend = 30; po.noise = 0.6; po.tau = 0;
      po.dir[0] = rim[3] * vp + nx * vp * 0.05; po.dir[1] = rim[4] * vp + ny * vp * 0.05; po.dir[2] = rim[5] * vp + nz * vp * 0.05;
      d.puff(slot, X, Y, Z, rp, 0.02 * i, 0.2, 0, Rc * 0.1, po);
    }
    // 3. niski wyrzut przy punkcie styku (pył i lód rzucone na boki — nie nad bryłę)
    const thC = T.rimConeTh;
    const nCone = Math.max(1, Math.round((3 + Math.floor(fxRandom.next() * 2)) * nk));
    for (let i = 0; i < nCone; i++) {
      this._rim(e, rim, 0.12);
      this._outDir(e, rim, thC[0] + thC[1] * fxRandom.next(), 0.5, sd, skew, dir);
      const r = Math.max(rmin, Rc * 0.09);
      const X = rim[0] + cx + rim[3] * r + nx * r, Y = rim[1] + cy + rim[4] * r + ny * r, Z = rim[2] + cz + rim[5] * r + nz * r;
      jo.delay = 0.02 * fxRandom.next(); jo.fuel = 0; jo.temp = 0.12 + 0.9 * q; jo.smoke = 4 * k; jo.radial = Rc * 0.1; jo.velBlend = 30;
      jo.noise = 0.35; jo.tau = 0.4; jo.flicker = 0.25; jo.grow = 1.3; jo.rampIn = 0.02; jo.rampOut = 0.25; jo.velTau = 0.3;
      const dur = 0.4 + 0.2 * fxRandom.next();
      const avail = this._fitAlong(s, X, Y, Z, dir[0], dir[1], dir[2], 0.8);
      d.jet(slot, X, Y, Z, dir[0], dir[1], dir[2], r, Rc * 0.14,
        this._fitSpeed(Rc * (0.9 + 0.5 * q) * (0.8 + 0.4 * fxRandom.next()), dur, Rc * 0.14, avail), dur, jo);
    }
    // 4. pył osiadający (później, wolno, nisko po skale — obłok wokół bryły nie znika od razu; tylko nowa domena)
    for (let i = 0; i < (mk >= 1 ? 2 : 0); i++) {
      this._rim(e, rim, 0.5);
      const rq = Math.max(rmin, Rc * 0.18);
      const X = rim[0] + cx + rim[3] * rq + nx * rq * 0.5, Y = rim[1] + cy + rim[4] * rq + ny * rq * 0.5, Z = rim[2] + cz + rim[5] * rq + nz * rq * 0.5;
      po.temp = 0; po.smoke = 3 * k; po.grow = 1.8; po.velBlend = 12; po.noise = 0.7; po.tau = 0;
      po.dir[0] = rim[3] * Rc * 0.25 + nx * Rc * 0.04; po.dir[1] = rim[4] * Rc * 0.25 + ny * Rc * 0.04; po.dir[2] = rim[5] * Rc * 0.25 + nz * Rc * 0.04;
      d.puff(slot, X, Y, Z, rq, 0.45 + 0.1 * i, 0.6, 0, Rc * 0.2, po);
    }
  }

  /**
   * Źródło pyłu szorowania / osiadania w żywej domenie uderzeń (scena): kłąb z krawędzi obrysu przy punkcie styku,
   * z prądem poślizgu i na zewnątrz, nisko nad skałą (nie unosi się nad bryłę).
   */
  _gasDust(fx, slot, e, Rc, sx, sy, sz, slide) {
    const d = fx.director;
    const s = fx.grid.slots[slot];
    if (!d || !s) return;
    const rmin = 3.2 * s.h;
    const k = this.tune.gasSmoke;
    const po = this._po || (this._po = { temp: 0, smoke: 0, grow: 1.5, velBlend: 30, noise: 0.6, tau: 0, dir: [0, 0, 0] });
    const rim = this._rimA || (this._rimA = new Float64Array(6));
    this._rim(e, rim, 0.2);
    const r = Math.max(rmin, Rc * 0.3);
    const X = rim[0] + this.center.x + rim[3] * r * 0.6 + e.nx * r * 0.5;
    const Y = rim[1] + this.center.y + rim[4] * r * 0.6 + e.ny * r * 0.5;
    const Z = rim[2] + this.center.z + rim[5] * r * 0.6 + e.nz * r * 0.5;
    po.temp = 0; po.smoke = (slide > 0 ? 2.5 : 1.5) * k; po.grow = 1.5; po.velBlend = 18; po.noise = 0.65; po.tau = 0;
    const vs = slide * 0.35, vo = Math.max(Rc * 0.25, slide * 0.12);
    po.dir[0] = sx * vs + rim[3] * vo + e.nx * vo * 0.1; po.dir[1] = sy * vs + rim[4] * vo + e.ny * vo * 0.1; po.dir[2] = sz * vs + rim[5] * vo + e.nz * vo * 0.1;
    d.puff(slot, X, Y, Z, r, 0, 0.26, 0, Rc * 0.2, po);
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

  // środek obrysu uderzenia w kole życia gazu żywej domeny uderzeń (bez warunku rozmiaru)
  _insideGas(fx, e) {
    const L = this._gasSlots;
    const sx = e.F.cx + this.center.x, sy = e.F.cy + this.center.y, sz = e.F.cz + this.center.z;
    for (let i = 0; i < L.length; i++) {
      const s = fx.grid.slots[L[i]];
      if (!s || !s.active) continue;
      const half = s.h * s.n * 0.5;
      const dx = sx - s.cx, dy = sy - s.cy;
      if (Math.sqrt(dx * dx + dy * dy) < 0.68 * half && Math.abs(sz - s.cz) < s.h * s.nz * 0.5) return true;
    }
    return false;
  }

  // feed = false — szorowanie: dokłada pył do żywej domeny, ale nie przedłuża jej życia
  _mergeGas(fx, e, Rc, feed = true) {
    const L = this._gasSlots;
    this._liveGas(fx);
    const sx = e.F.cx + this.center.x, sy = e.F.cy + this.center.y, sz = e.F.cz + this.center.z;   // scena — środek obrysu
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
    if (best >= 0 && feed) fx.grid.feed(best, fx.grid.time + this.tune.gasLife);
    return best;
  }

  // szorowanie dużej bryły: słaby kłąb w żywej domenie uderzeń (bez przedłużania jej życia — dziesiątki szorujących
  // odłamów trzymały domenę przy życiu i zagęszczały ją w kulę waty nad polem upadku)
  _gasScrape(e, size, sx, sy, sz, slide) {
    const fx = this.getGas ? this.getGas() : null;
    if (!fx || !fx.director || size < this.tune.scrapeGasMinSize) return;
    const Rc = size * 0.6;
    const slot = this._mergeGas(fx, e, Rc, false);
    if (slot < 0) return;
    this._gasDust(fx, slot, e, Rc, sx, sy, sz, slide);
  }

  // osiadanie: same cząstki (ostatni kłąb pyłu — _settle); w próżni pył nie wisi nad leżącą bryłą
  _gasSettle() {}

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

const _ev = { type: 0, id: 0, kind: 'other', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, speed: 0, slide: 0, mass: 0, size: 0, energy: 0, vx: 0, vy: 0, vz: 0,
  fx: 0, fy: 0, fz: 0, ux: 1, uy: 0, uz: 0, fn: 0, fr: new Float64Array(ROCK_FOOT_BINS) };
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
    e.fx = d[o + R.FX]; e.fy = d[o + R.FY]; e.fz = d[o + R.FZ];
    e.ux = d[o + R.UX]; e.uy = d[o + R.UY]; e.uz = d[o + R.UZ];
    e.fn = d[o + R.FN];
    for (let k = 0; k < ROCK_FOOT_BINS; k++) e.fr[k] = d[o + R.FR + k];
    if (h.onEvent(e.type | 0, e)) rockImpactCommandStats.ok++;
  });
  return rockImpactCommandStats;
}
