// src/3d/mainExhaust3D.js
//
// Silniki MAIN — port `dema/silniki/silnik-wydech.html` (EngineExhaust /
// JetSystem). Struga to krótko żyjące kwady „doklejone” do dyszy: co klatkę
// biorą pozycję i kierunek właściciela, więc nie odklejają się od lecącego
// statku, a szum płynie w shaderze. Iskry lecą do wspólnego banku Fx3D.spark
// (te same smugi co z broni) — własnej puli iskier tu nie ma.
//
// Jeden draw call na CAŁĄ flotę: wszystkie strugi siedzą w jednej instancjonowanej
// puli (pass Ortho jest związany submisją, patrz engineExhaustBatch.js).
//
// Różnice względem dema:
//   - płaszczyzna XY, +Z ku kamerze ortho: kwad leży w XY (bok = prostopadła
//     do osi w płaszczyźnie), spłaszczenie iskier w Z, oś pomocnicza bazy +Z;
//   - pozycje WZGLĘDEM początku przy kamerze (mesh.position), a nie w świecie —
//     świat leży przy 5–10 mln j. i float32 na GPU drżałby ~1 px (wzór
//     Bridge3D._setOrigin, AGENTS.md);
//   - skala per dysza: S = promień dyszy / promień dyszy dema, a długość
//     gradientu palety jedzie atrybutem instancji (dema miały jedno S);
//   - bez PointLightów (gra trzyma enginePointLights: false);
//   - alfa = max(rgb) przy mieszaniu (ONE, ONE) — alfa 1 na całym kwadzie
//     wycina w poświacie bloomu ciemny prostokąt (kanwa Core3D jest premultiplied);
//   - faza szumu całkowana na CPU (uFlowPh), nie uTime·flow.
//
// Port WebGPU (zadanie 13): materiał węzłowy TSL 1:1 z dawnym GLSL. Mieszanie
// jak WebGL z premultipliedAlpha (ONE, ONE — tsl/mieszanie.js): NodeMaterial
// z premultipliedAlpha: true mnożyłby wyjście przez alfę, czego ShaderMaterial
// w WebGL nie robił — struga by ściemniała.

import * as THREE from 'three';
import { NodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import {
  Fn, attribute, clamp, dot, exp, float, floor, fract, int, inverseSqrt, max, min, mix, pow,
  positionGeometry, select, smoothstep, storage, texture, uniform, uv, varying, vec2, vec3, vec4
} from 'three/tsl';
import { zbierzZakres, zbierzZakresy, zbierzZakresyCaly } from './zakresyWysylki.js';
import { WARIANT_INSTANCJI } from './rozgrzewka.js';
import { Core3D } from './core3d.js';
import { Fx3D, makeBasis, coneDir } from './fxParticles3D.js';
// Losowość warstwy efektów (zadanie 23): Math.random gry przesuwał się o iskry dysz, a ich liczba zależy od
// kadru i zajętości banku Fx3D — przebieg bitwy zależał od obrazu.
import { fxRandom } from './fx/fxRandom.js';
import { uniformsAdapter } from './tsl/uniformy.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import {
  MAIN_EXHAUST_PALETTES,
  MAIN_EXHAUST_TUNE as T,
  DEMO_NOZZLE_RADIUS,
  paletteColor,
  paletteSparkCool
} from '../data/engineFx.js';

// Atlas palet — tekstura HalfFloat: oś x to temperatura strugi (0 = chłodny
// brzeg, 1 = rdzeń), oś y to odległość od dyszy; paleta = PAL_L wierszy.
const PAL_MAX = 32;
const PAL_T = 64;
const PAL_L = 16;

// Pod kadłubem, jak dawny płomień (grupa dyszy siedziała na z = −5): kadłub
// pisze głębię na z ≈ 0, więc struga wychodzi spod rufy, a nie maluje się po niej.
export const MAIN_EXHAUST_Z = -5.0;
// Skok pozycji dyszy ponad tę prędkość to teleport / podmiana kadłuba, nie lot
// (warp w najwyższym biegu to 80 000 j./s) — iskry nie dziedziczą wtedy „prędkości”.
const TELEPORT_SPEED = 250000;
// Faza szumu rośnie bez końca, a szum strugi (hash) nie jest okresowy — zawijamy
// ją rzadko; skok wzoru w krótkich, migoczących strugach jest niewidoczny.
const FLOW_PHASE_WRAP = 1024;
// Wspólny bank iskier dzielą bronie — silniki biorą najwyżej tyle jego pojemności.
const SPARK_BUDGET_SHARE = 0.55;

// ZASIĘG STRUGI I ISKIER od wylotu (LOD dysz za kadrem — engineVfxSystem.js, audyt FPS 2026-10-11 § 6.2 pkt 2) —
// sufity z tych samych liczb co push / kick niżej, w jednostkach dema (× S = promień / DEMO_NOZZLE_RADIUS):
// moc strugi najwyżej T.boost (dopalacz), migotanie rdzenia g ≤ 1 / 0,55, kwad strugi [0, długość] × [±szerokość / 2].
const PW_MAX = T.boost * T.power;
const GL_MAX = 1 + 0.15 * (1 / 0.55 - 1) * T.rough;
const PS_MAX = 0.6 + 0.4 * Math.min(T.boost, 1.5);
//   [długość × L, pół szerokości × W, życie s]: rdzeń, ogon, uderzenie dopalacza (kick)
const JET_REACH = Object.freeze([
  (18 + 55 * PW_MAX) * GL_MAX * 1.15, (9 + 14 * PW_MAX) * 0.5, 0.09,
  (40 + 75 * PW_MAX) * 1.1, (9 + 10 * PW_MAX) * 0.5, 0.32,
  112, 18, 0.55
]);
// Iskry: prędkość własna ≤ 220 (kick, ps = 1) / 200 · PS_MAX, życie ≤ 1,1 / 0,85 s, odsunięcie od wylotu ≤ 3; smuga
// iskry ciągnie się ZA nią (fxParticles3D.js), więc nie sięga dalej niż głowa.
const SPARK_SELF = Math.max(220 * 1.1, 200 * PS_MAX * 0.85) + 3;
const SPARK_LIFE = 1.1;
// Iskra dziedziczy prędkość dyszy (T.inherit), a opór (drag ≤ 1,5/s) ją wytraca — iskra zostaje w tyle za lecącą
// kamerą najwyżej o |v dyszy| × (t − (1 − e^(−1,5 t)) / 1,5) przy t = SPARK_LIFE.
const SPARK_LAG = SPARK_LIFE - (1 - Math.exp(-1.5 * SPARK_LIFE)) / 1.5;

/**
 * Jak daleko od wylotu dyszy MAIN może sięgnąć obraz strug i iskier wypuszczonych W TEJ klatce, w ich życiu —
 * względem kadru, który jedzie z prędkością `relSpeed` względem dyszy [j. świata].
 * @param {number} radius    promień wylotu [j. świata]
 * @param {number} lengthMul mnożnik długości strugi statku (engineFx.mainLength)
 * @param {number} widthMul  mnożnik szerokości (engineFx.mainWidth)
 * @param {number} relSpeed  |v dyszy − v kadru| (+ prędkość brzegu kadru przy oddalaniu) [j/s]
 * @param {number} speed     |v dyszy| w świecie [j/s] — iskry z oporem zostają w tyle za lecącym kadrem
 * @param {boolean} sparks   czy dysza w tej klatce sypie iskrami
 */
export function mainExhaustReach(radius, lengthMul, widthMul, relSpeed, speed, sparks) {
  const S = Math.max(0, Number(radius) || 0) / DEMO_NOZZLE_RADIUS;
  const L = Math.max(0, Number(lengthMul) || 0);
  const W = Math.max(0, Number(widthMul) || 0);
  const v = Math.max(0, Number(relSpeed) || 0);
  let r = 0;
  for (let k = 0; k < 9; k += 3) {
    const d = (JET_REACH[k] * L + JET_REACH[k + 1] * W) * S + v * JET_REACH[k + 2];
    if (d > r) r = d;
  }
  if (sparks) {
    const d = SPARK_SELF * S + v * SPARK_LIFE + Math.max(0, Number(speed) || 0) * SPARK_LAG;
    if (d > r) r = d;
  }
  return r;
}

// Dla testów i strojenia: sufity zasięgu w jednostkach dema.
export const MAIN_EXHAUST_REACH = Object.freeze({ JET_REACH, SPARK_SELF, SPARK_LIFE, SPARK_LAG, PW_MAX, PS_MAX, GL_MAX });

/* ============================================================================
   MATERIAŁ (TSL) — kwady strug na instancjach
   Atrybuty instancji (jeden bufor z przeplotem, rekord stały od narodzin strugi):
     iA     l0, l1 (długość na początku / końcu życia), w0, w1 (szerokość)
     iB     narodziny (zegar strug, zawinięty), życie [s], alfa, ziarno szumu
     iC     indeks palety w atlasie, długość gradientu [j.], właściciel (wiersz bufora właścicieli)
   Bufor właścicieli (storage, vec4 na wiersz): wylot dyszy względem mesh.position (początek przy kamerze),
   kierunek wydechu w płaszczyźnie gry.
   ========================================================================== */
// Szum strugi z dema: hash21 na węzłach siatki (floor) — wejście całkowite.
// Funkcje z layoutem są CZYSTE (PLAN §3 — błąd r183 z uniformem w domknięciu).
const jetHash21 = /*@__PURE__*/ Fn(([p0]) => {
  const p = fract(p0.mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
}).setLayout({ name: 'mainJetHash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const jetNoise2 = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p).toVar();
  const f0 = fract(p).toVar();
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar();
  return mix(
    mix(jetHash21(i), jetHash21(i.add(vec2(1.0, 0.0))), f.x),
    mix(jetHash21(i.add(vec2(0.0, 1.0))), jetHash21(i.add(vec2(1.0, 1.0))), f.x),
    f.y
  );
}).setLayout({ name: 'mainJetNoise2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const jetCloud = /*@__PURE__*/ Fn(([p]) =>
  float(0.68).mul(jetNoise2(p)).add(float(0.32).mul(jetNoise2(p.mul(2.07).add(17.3))))
).setLayout({ name: 'mainJetCloud', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// Pula strug na GPU (2026-10-17, klatka workera pod 240 Hz): struga to STAŁY rekord instancji pisany raz przy narodzinach
// (pierścień slotów — jets niżej), a wiek, długość, szerokość, alfa i położenie liczy shader: wiek z zegara strug
// (uClock − narodziny, oba zawinięte co JET_CLOCK_WRAP s — float32 bez utraty dokładności), położenie i kierunek
// z bufora właścicieli (dysza, do której struga jest doklejona; storage, wiersz na właściciela, pisany co klatkę).
// Dawniej CPU co klatkę przeliczał i wysyłał ~3,8 tys. strug w bitwie 166 okrętów (0,2 ms pętli + ~200 KB).
// Rekord instancji: iA = (l0, l1, w0, w1), iB = (narodziny, życie, alfa, ziarno),
// iC = (paleta, gradient, właściciel, —). Martwa struga (wiek ≥ życie) zwija kwad do zera — bez fragmentów.
const JET_CLOCK_WRAP = 256;

function makeJetMaterial(atlasTex, ownerNode) {
  const U = uniformsAdapter({
    uZ: uniform(MAIN_EXHAUST_Z),
    // faza płynięcia szumu — ∫flow·dt liczone na CPU
    uFlowPh: uniform(0),
    // zegar strug (zawinięty co JET_CLOCK_WRAP s) — wiek strugi = uClock − narodziny
    uClock: uniform(0),
    uPal: texture(atlasTex)
  });
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  // odległość od dyszy wzdłuż strugi (0 u wylotu)
  const alongLocal = positionGeometry.y.add(0.5);
  // wiek (narodziny w przyszłości tej klatki: ujemny — u = 0, jak dawne max(0, wiek))
  const age = U.uClock.sub(iB.x).toVar();
  const ageW = age.add(select(age.lessThan(-JET_CLOCK_WRAP * 0.5), float(JET_CLOCK_WRAP), float(0)));
  const life = max(iB.y, 1e-4);
  const alive = ageW.lessThan(life);
  const u = clamp(max(ageW, 0.0).div(life), 0.0, 1.0);
  const om = float(1.0).sub(u);
  const ease = float(1.0).sub(pow(om, 2.6));
  const len = select(alive, mix(iA.x, iA.y, ease), float(0));
  const wid = select(alive, mix(iA.z, iA.w, ease), float(0));
  const own = ownerNode.element(int(iC.z));

  const m = new NodeMaterial();
  m.name = 'MainExhaustJets';
  m.positionNode = Fn(() => {
    const dir = own.zw;
    const axis = dir.mul(inverseSqrt(max(dot(dir, dir), 1e-12))).toVar();
    const side = vec2(axis.y.negate(), axis.x);              // kwad leży w płaszczyźnie XY
    const p = own.xy.add(axis.mul(alongLocal.mul(len))).add(side.mul(positionGeometry.x.mul(wid)));
    return vec3(p, U.uZ);
  })();
  const vDist = varying(alongLocal.mul(len), 'vDist');
  // alfa: zanik z wiekiem i miękkie wejście w pierwszych 5% życia (dawny CPU: (u / 0,05)² · (3 − 2 u / 0,05))
  const vAlpha = varying(iB.z.mul(pow(om, 1.4)).mul(smoothstep(0.0, 0.05, u)), 'vJetA');
  const vSeedV = varying(iB.w, 'vJetSeed');
  const vPalG = varying(iC.xy, 'vJetPalG');
  m.fragmentNode = Fn(() => {
    const vUv = uv();
    // Clamp: MSAA ekstrapoluje varyingi do próbek POZA trójkątem, a pow() z ujemną
    // podstawą to NaN — w buforze HalfFloat bloom rozlewał go na cały ekran.
    const along = clamp(vUv.y, 0.0, 1.0).toVar();                    // 0 = dysza, 1 = koniec
    const x = clamp(vUv.x, 0.0, 1.0).mul(2.0).sub(1.0).toVar();
    const vA = vAlpha;
    const vSeed = vSeedV;
    const iPalG = vPalG;
    const n = jetCloud(vec2(along.mul(5.5).sub(U.uFlowPh), x.mul(1.4).add(vSeed.mul(9.0))));
    const n2 = jetCloud(vec2(along.mul(2.2).sub(U.uFlowPh.mul(0.55)).add(vSeed.mul(5.0)), 0.3));
    const w = mix(0.30, 1.0, along);                                 // stożek się rozszerza
    // NIE pow(x / w, 2.0): x < 0 to w HLSL NaN, a NaN w buforze HalfFloat
    // bloom rozlewa na cały ekran (tak było w pierwszym porcie z dema).
    const xw = x.div(w).toVar();
    const across = exp(xw.negate().mul(xw).mul(3.2)).mul(float(0.55).add(float(0.7).mul(n)));
    const base = smoothstep(0.0, 0.06, along).mul(pow(float(1.0).sub(along), 0.85)).mul(float(0.65).add(float(0.55).mul(n2)));
    const a = across.mul(base).mul(vA).toVar();
    const t = clamp(a.mul(1.5).add(exp(x.negate().mul(x).mul(30.0)).mul(float(1.0).sub(along)).mul(0.55)), 0.0, 1.0);
    const g = clamp(vDist.div(max(iPalG.y, 1e-3)), 0.0, 1.0);       // gradient liczony od dyszy
    // palColor: wiersz palety = indeks · PAL_L + gradient, kolumna = temperatura
    const row = iPalG.x.mul(PAL_L).add(0.5).add(g.mul(PAL_L - 1));
    const pal = U.uPal.sample(vec2(t.mul(PAL_T - 1).add(0.5).div(PAL_T), row.div(PAL_MAX * PAL_L))).rgb;
    const c = pal.mul(a).toVar();
    return vec4(c, min(1.0, max(c.r, max(c.g, c.b))));
  })();
  m.transparent = true;
  m.depthTest = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  // Jak ShaderMaterial w WebGL: jeden draw, nie dwa (tył + przód).
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  blendAddytywnePremul(m);
  m.uniforms = U;
  return m;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + fxRandom.next() * (b - a);
// migotanie ognia — dwa niewspółmierne sinusy czytają się jak szum, a kosztują nic
const flicker = (t, seed) => 0.55 + 0.45 * Math.sin(t * 13.7 + seed) * Math.sin(t * 7.31 + seed * 2.13);

/* ============================================================================
   PULA STRUG — pierścień slotów na GPU (2026-10-17). Struga dostaje slot przy narodzinach (rekord instancji pisany
   RAZ — wysyłka tylko nowych rekordów, zwykle jeden ciągły wycinek na klatkę), umiera sama w shaderze (wiek ≥ życie),
   a slot wraca do obiegu, gdy pierścień go dogoni. Żywa struga w slocie pod głowicą jest przeskakiwana (rzadkie
   długie uderzenia dopalacza); pełny przegląd bez wolnego slotu = struga odrzucona (jetsDropped).
   Zero alokacji w klatce; pozycje właścicieli w double (świat 5–10 mln j.), na GPU idą już względem początku.
   ========================================================================== */
const MAX_JETS = 16384;
// Najdłuższe życie strugi (uderzenie dopalacza, kick) — po tylu sekundach od zwolnienia wiersz właściciela jest wolny.
const JET_MAX_LIFE = 0.55;
const jets = {
  // CPU: narodziny (zegar strug, double) i życie — żywotność slotu przy przydziale i liczniki
  born: new Float64Array(MAX_JETS),
  life: new Float32Array(MAX_JETS),
  head: 0,          // następny slot do przydziału
  hi: 0,            // najwyższy użyty slot + 1 (licznik instancji rysunku)
  lastBorn: -1e9    // narodziny najmłodszej strugi (siatka niewidoczna, gdy wszystkie już nie żyją)
};
// rekordy instancji: trzy atrybuty vec4 (bez przeplotu — wysyłka kilku wycinków naraz, zbierzZakresy)
const jetA = new Float32Array(MAX_JETS * 4);
const jetB = new Float32Array(MAX_JETS * 4);
const jetC = new Float32Array(MAX_JETS * 4);
// zegar strug: wiek strugi = jetClock − narodziny; rośnie we flush (krok klatki), jak dawny wiek strugi
let jetClock = 0;
// wycinki slotów zapisanych od ostatniej wysyłki (pierścień: najwyżej dwa — przed i po zawinięciu)
let dirtyFrom = -1;
let dirtyTo = -1;

// Strugi i iskry odrzucone przy pełnej puli / wyczerpanym udziale w banku iskier (liczniki narastające — pomiar).
let jetsDropped = 0;
let sparksDropped = 0;

function sendDirty() {
  if (dirtyFrom < 0) return;
  if (jetAttrs) {
    const s = dirtyFrom * 4, n = (dirtyTo - dirtyFrom) * 4;
    for (let k = 0; k < 3; k++) zbierzZakresy(jetAttrs[k], s, n);
  }
  dirtyFrom = -1;
}

// Zegar w shaderze jest zawinięty co JET_CLOCK_WRAP s: struga martwa od ~JET_CLOCK_WRAP s w slocie, którego pierścień
// dawno nie dogonił (po bitwie hi zostaje wysokie), wyglądałaby na żywą. Co JET_SWEEP_EVERY s martwe sloty dostają
// zerowe wymiary (kwad zwinięty przy każdym wieku) — jeden przegląd i jedna wysyłka iA na kilkadziesiąt sekund.
const JET_SWEEP_EVERY = 32;
let lastSweep = 0;
function sweepDeadJets() {
  lastSweep = jetClock;
  let lo = -1, hi = -1;
  for (let i = 0; i < jets.hi; i++) {
    if (jetClock - jets.born[i] < jets.life[i] || jets.life[i] === 0) continue;
    jets.life[i] = 0;
    const o = i * 4;
    jetA[o] = 0; jetA[o + 1] = 0; jetA[o + 2] = 0; jetA[o + 3] = 0;
    if (lo < 0) lo = i;
    hi = i + 1;
  }
  if (lo >= 0 && jetAttrs) zbierzZakresy(jetAttrs[0], lo * 4, (hi - lo) * 4);
}

function markDirty(i) {
  if (dirtyFrom >= 0 && i === dirtyTo) { dirtyTo = i + 1; return; }
  sendDirty();
  dirtyFrom = i; dirtyTo = i + 1;
}

// age = dawny wiek strugi w chwili narodzin (≤ 0: narodziny „w przyszłości” tej klatki — część klatki po wylocie)
function spawnJet(life, l0, l1, w0, w1, pal, grad, alpha, seed, age, owner) {
  if (owner < 0) { jetsDropped++; return; }
  let i = jets.head;
  let tries = 0;
  // slot żywy (długa struga) — następny; pierścień pełny żywych — odrzut
  while (jetClock - jets.born[i] < jets.life[i]) {
    if (++tries >= 64) { jetsDropped++; return; }
    i = i + 1 < MAX_JETS ? i + 1 : 0;
  }
  jets.head = i + 1 < MAX_JETS ? i + 1 : 0;
  if (i + 1 > jets.hi) jets.hi = i + 1;
  const born = jetClock - age;
  jets.born[i] = born;
  jets.life[i] = life;
  if (born > jets.lastBorn) jets.lastBorn = born;
  const o = i * 4;
  jetA[o] = l0; jetA[o + 1] = l1; jetA[o + 2] = w0; jetA[o + 3] = w1;
  jetB[o] = born - Math.floor(born / JET_CLOCK_WRAP) * JET_CLOCK_WRAP; jetB[o + 1] = life; jetB[o + 2] = alpha; jetB[o + 3] = seed;
  jetC[o] = pal; jetC[o + 1] = grad; jetC[o + 2] = owner; jetC[o + 3] = 0;
  markDirty(i);
}

/* --- właściciele: dysze, do których strugi są doklejone ------------------ */
const MAX_OWNERS = 2048;
const owners = {
  x: new Float64Array(MAX_OWNERS),
  y: new Float64Array(MAX_OWNERS),
  dx: new Float32Array(MAX_OWNERS),
  dy: new Float32Array(MAX_OWNERS),
  free: new Int32Array(MAX_OWNERS),
  freeCount: 0,
  used: 0,
  // zwolnione, ale ich strugi jeszcze mogą żyć (wiersz stoi w miejscu, aż minie JET_MAX_LIFE)
  pend: new Int32Array(MAX_OWNERS),
  pendAt: new Float64Array(MAX_OWNERS),
  pendCount: 0
};
// wiersze bufora właścicieli na GPU: (x − początek, y − początek, dx, dy), pisane we flush dla [0, used)
const ownerRows = new Float32Array(MAX_OWNERS * 4);

function allocOwner() {
  if (owners.freeCount > 0) return owners.free[--owners.freeCount];
  if (owners.used < MAX_OWNERS) return owners.used++;
  return -1;
}

// Dysza znika (statek poza kadrem, zniszczony, nowy układ): jej strugi zostają
// tam, gdzie były (wiersz właściciela przestaje się ruszać), i dogasają same.
function freeOwner(k) {
  if (k < 0 || k >= MAX_OWNERS) return;
  owners.pend[owners.pendCount] = k;
  owners.pendAt[owners.pendCount] = jetClock;
  owners.pendCount++;
}

function releasePendingOwners() {
  let w = 0;
  for (let r = 0; r < owners.pendCount; r++) {
    const k = owners.pend[r];
    const at = owners.pendAt[r];
    if (jetClock - at > JET_MAX_LIFE) { owners.free[owners.freeCount++] = k; continue; }
    owners.pend[w] = k; owners.pendAt[w] = at; w++;
  }
  owners.pendCount = w;
}

/* ============================================================================
   RENDER
   ========================================================================== */
let mesh = null;
let geo = null;
let mat = null;
let atlas = null;
let jetAttrs = null;    // atrybuty instancji iA, iB, iC (rekordy strug)
let ownerAttr = null;   // StorageBufferAttribute wierszy właścicieli
let originX = 0;
let originY = 0;
let clock = 0;
let flowPhase = 0;
let frameNozzles = 0;

function buildAtlas() {
  const H = THREE.DataUtils.toHalfFloat;
  const data = new Uint16Array(PAL_T * PAL_MAX * PAL_L * 4);
  const one = H(1);
  const c = [0, 0, 0];
  MAIN_EXHAUST_PALETTES.slice(0, PAL_MAX).forEach((pal, k) => {
    for (let r = 0; r < PAL_L; r++) {
      const g = r / (PAL_L - 1);
      for (let x = 0; x < PAL_T; x++) {
        paletteColor(pal, x / (PAL_T - 1), g, c);
        const o = ((k * PAL_L + r) * PAL_T + x) * 4;
        data[o] = H(c[0]); data[o + 1] = H(c[1]); data[o + 2] = H(c[2]); data[o + 3] = one;
      }
    }
  });
  const tex = new THREE.DataTexture(data, PAL_T, PAL_MAX * PAL_L, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Siatka strug: kwad + trzy atrybuty instancji (iA, iB, iC) i bufor właścicieli. Wspólna dla gry i testów.
function makeJetGeometry(jetArrays, ownerArray) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const names = ['iA', 'iB', 'iC'];
  const attrs = names.map((name, k) => {
    const attr = new THREE.InstancedBufferAttribute(jetArrays[k], 4);
    g.setAttribute(name, attr);
    return attr;
  });
  const owner = new StorageBufferAttribute(ownerArray, 4);
  const ownerNode = storage(owner, 'vec4', ownerArray.length / 4).toReadOnly().setName('mainExhaustOwners');
  g.instanceCount = 0;
  return { geo: g, attrs, owner, ownerNode };
}

function ensureBuilt() {
  if (mesh) return true;
  if (!Core3D.isInitialized || !Core3D.scene) return false;
  const built = makeJetGeometry([jetA, jetB, jetC], ownerRows);
  geo = built.geo;
  jetAttrs = built.attrs;
  ownerAttr = built.owner;
  // rekordy zapisane przed budową siatki (narodziny bez Core3D — testy) idą w pierwszej wysyłce
  for (const a of jetAttrs) zbierzZakresyCaly(a);
  dirtyFrom = -1;
  atlas = buildAtlas();
  mat = makeJetMaterial(atlas, built.ownerNode);
  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'MainExhaustJets';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  mesh.visible = false;
  Core3D.scene.add(mesh);
  return true;
}

/* ============================================================================
   STAN DYSZY
   ========================================================================== */
export function createMainExhaustState(opts = {}) {
  const throttle = clamp01(Number(opts.throttle) || 0);
  return {
    owner: -1,
    seed: Number.isFinite(opts.seed) ? opts.seed : fxRandom.next() * 100,
    running: true,
    boosting: false,
    // Statek wchodzący w kadr ma już rozgrzany silnik — bez rozruchu od zera.
    power: throttle,
    heat: Math.min(1, throttle),
    fl: 0.55,
    fresh: true,
    prevX: 0, prevY: 0,
    velX: 0, velY: 0,
    accJet: fxRandom.next(),
    accTail: fxRandom.next(),
    accSpark: fxRandom.next()
  };
}

export function releaseMainExhaustState(state) {
  if (!state) return;
  if (state.owner >= 0) freeOwner(state.owner);
  state.owner = -1;
  state.fresh = true;
}

const _dir3 = new THREE.Vector3();
const _cone = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _sparkCol = MAIN_EXHAUST_PALETTES.map((pal) => pal.spark.slice());
const _sparkCool = MAIN_EXHAUST_PALETTES.map((pal) => paletteSparkCool(pal));

function sparkBudgetLeft() {
  const pool = Fx3D.spark;
  if (!pool) return 0;
  return Math.max(0, Math.floor(pool.cap * SPARK_BUDGET_SHARE) - pool.p.count);
}

// Iskra z wylotu: stożek wokół osi wydechu, prędkość dyszy dziedziczona,
// pozycja przesunięta na koniec klatki (bank przesunie ją dopiero w następnej).
function spawnSpark(state, x, y, dirX, dirY, S, ps, palIdx, ago, dt, vMin, vMax, life) {
  _dir3.set(dirX, dirY, 0);
  makeBasis(_dir3);
  coneDir(_cone, _dir3, 0.3, T.flatten);
  const speed = rand(vMin, vMax) * S * ps;
  _vel.set(_cone.x * speed + state.velX * T.inherit, _cone.y * speed + state.velY * T.inherit, _cone.z * speed);
  const k = dt > 0 ? 1 - ago / dt : 1;
  const ox = lerp(state.prevX, x, k);
  const oy = lerp(state.prevY, y, k);
  const off = rand(0, 3) * S;
  _pos.set(
    ox + _cone.x * off + _vel.x * ago,
    oy + _cone.y * off + _vel.y * ago,
    MAIN_EXHAUST_Z
  );
  const cool = _sparkCool[palIdx];
  Fx3D.spark.spawn(_pos, _vel, life, rand(0.5, 1.5), rand(2.5, 7) * S, _sparkCol[palIdx], cool[1], cool[2]);
}

// Uderzenie strugi przy wejściu dopalacza — dwie długie strugi i wiązka iskier.
function kick(state, p, S, palIdx, grad, str) {
  const L = p.lengthMul;
  const W = p.widthMul;
  const J = p.jetGain;
  spawnJet(0.55, 12 * S, (72 + 40 * str) * S * L, 9 * S * W, 20 * S * W, palIdx, grad, 1.0 * str * J, fxRandom.next(), 0, state.owner);
  spawnJet(0.40, 8 * S, (46 + 26 * str) * S * L, 16 * S * W, 36 * S * W, palIdx, grad, 0.55 * str * J, fxRandom.next(), 0, state.owner);
  if (!(p.sparkMul > 0) || !Fx3D.spark) return;
  const want = Math.round(40 * str * p.sparkMul);
  const n = Math.min(sparkBudgetLeft(), want);
  sparksDropped += want - n;
  for (let i = 0; i < n; i++) spawnSpark(state, p.x, p.y, p.dirX, p.dirY, S, 1, palIdx, 0, 0, 50, 220, rand(0.3, 1.1));
}

// Dla testów: materiał strugi i atlas palet (bez Core3D).
export const MainExhaustInternals = Object.freeze({ makeJetMaterial, makeJetGeometry, buildAtlas, MAX_OWNERS });

/* ============================================================================
   API
   ========================================================================== */
export const MainExhaust3D = {
  MAX_JETS,

  // żywe strugi (przegląd slotów — pomiar i testy, nie w klatce)
  get jetCount() {
    let c = 0;
    for (let i = 0; i < jets.hi; i++) if (jetClock - jets.born[i] < jets.life[i]) c++;
    return c;
  },
  // narastające liczniki odrzuconych strug (pełna pula) i iskier (udział silników w banku Fx3D.spark wyczerpany)
  get jetsDropped() { return jetsDropped; },
  get sparksDropped() { return sparksDropped; },

  // LOD dysz MAIN za kadrem (engineVfxSystem.js: dysza, której strugi i iskry nie sięgną kadru, dostaje
  // pixelRadius = 0 — sama moc i żar). A/B: false = dawna ścieżka (strugi i iskry każdej dyszy w pudle rozgrzania).
  offscreenLod: true,

  /**
   * Początek klatki: początek układu przy kamerze (współrzędne sceny) i zegar.
   */
  begin(orgX, orgY, dt) {
    originX = Number.isFinite(orgX) ? orgX : 0;
    originY = Number.isFinite(orgY) ? orgY : 0;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    clock += step;
    frameNozzles = 0;
  },

  /**
   * Jedna dysza MAIN tej klatki.
   * @param {object} state stan z createMainExhaustState (mutowany)
   * @param {object} p
   *   x, y          wylot dyszy (scena)
   *   dirX, dirY    kierunek wydechu (scena, jednostkowy)
   *   radius        promień wylotu w jednostkach świata
   *   throttle      ciąg 0..1
   *   boost         dopalacz (bool)
   *   lengthMul, widthMul  mnożniki statku
   *   palette       indeks palety MAIN
   *   jetGain       jasność strug (suwak „VFX: bloom” gracza)
   *   sparkMul      mnożnik iskier (0 = bez iskier)
   *   pixelRadius   promień dyszy w pikselach ekranu (LOD; 0 — bez strug i iskier, sama moc i żar: dysza za
   *                 kadrem, engineVfxSystem.js)
   *   dt            krok czasu [s]
   */
  push(state, p) {
    if (!ensureBuilt()) return;
    frameNozzles++;
    const dt = Math.max(0, Math.min(0.1, Number(p.dt) || 0));
    const x = p.x;
    const y = p.y;

    if (state.owner < 0) state.owner = allocOwner();
    if (state.fresh) {
      state.prevX = x; state.prevY = y;
      state.velX = 0; state.velY = 0;
      state.fresh = false;
    } else if (dt > 1e-6) {
      const vx = (x - state.prevX) / dt;
      const vy = (y - state.prevY) / dt;
      if (vx * vx + vy * vy > TELEPORT_SPEED * TELEPORT_SPEED) {
        state.prevX = x; state.prevY = y;
        state.velX = 0; state.velY = 0;
      } else {
        state.velX = vx; state.velY = vy;
      }
    }
    const own = state.owner;
    if (own >= 0) {
      owners.x[own] = x; owners.y[own] = y;
      owners.dx[own] = p.dirX; owners.dy[own] = p.dirY;
    }

    const R = Math.max(0, Number(p.radius) || 0);
    const S = R / DEMO_NOZZLE_RADIUS;
    const palIdx = Math.max(0, Math.min(MAIN_EXHAUST_PALETTES.length - 1, p.palette | 0));
    const L = p.lengthMul;
    const W = p.widthMul;
    const J = p.jetGain;
    const grad = T.gradLen * S * L;
    const pixelR = Number.isFinite(p.pixelRadius) ? p.pixelRadius : 99;
    const drawJets = S > 0 && pixelR >= 0.35;
    const drawSparks = drawJets && p.sparkMul > 0 && pixelR >= 1.2 && !!Fx3D.spark;

    // Dopalacz: wejście z uderzeniem strugi.
    const boost = !!p.boost && state.running;
    if (boost && !state.boosting && drawJets) kick(state, p, S, palIdx, grad, 1.0);
    state.boosting = boost;

    // Ciąg: szybkie rozkręcenie, wolniejsze wygaszenie; dysza grzeje się szybciej niż stygnie.
    const throttle = clamp01(Number(p.throttle) || 0);
    const target = !state.running ? 0 : (state.boosting ? Math.max(throttle, 1) * T.boost : throttle);
    state.power += (target - state.power) * (1 - Math.exp(-(target > state.power ? 4.5 : 3.2) * dt));
    if (target === 0 && state.power < 0.004) state.power = 0;
    const hTarget = Math.min(1.2, state.power);
    state.heat += (hTarget - state.heat) * (1 - Math.exp(-(hTarget > state.heat ? 0.7 : 0.22) * dt));

    const k = state.power;
    const pw = k * T.power;
    const fl = lerp(0.55, flicker(clock, state.seed), T.rough);
    state.fl = fl;
    const g = fl / 0.55;
    const ps = 0.6 + 0.4 * Math.min(k, 1.5);

    if (pw > 0.01 && drawJets) {
      const ga = lerp(1, g, 0.35);
      const gl = lerp(1, g, 0.15);
      const dirX = p.dirX;
      const dirY = p.dirY;

      // 1) rdzeń strugi — krótko żyjące kwady doklejone do dyszy, nakładające się na siebie
      let a = state.accJet + T.jetRate * dt;
      while (a >= 1) {
        a -= 1;
        const ago = a / T.jetRate;
        spawnJet(0.09, 6 * S, (18 + 55 * pw) * S * L * gl * rand(0.85, 1.15),
          (4 + 6 * pw) * S * W, (9 + 14 * pw) * S * W, palIdx, grad,
          T.jetAlpha * clamp01(pw) * ga * J, fxRandom.next(), ago - dt, own);
      }
      state.accJet = a;

      // 2) ogon — długa, cienka, przygaszona struga
      a = state.accTail + T.tailRate * dt;
      while (a >= 1) {
        a -= 1;
        const ago = a / T.tailRate;
        spawnJet(0.32, 12 * S, (40 + 75 * pw) * S * L * rand(0.9, 1.1),
          (5 + 4 * pw) * S * W, (9 + 10 * pw) * S * W, palIdx, grad,
          T.tailAlpha * clamp01(pw) * J, fxRandom.next(), ago - dt, own);
      }
      state.accTail = a;

      // 3) iskry wzdłuż osi — nierówna praca sypie nimi zrywami
      if (drawSparks) {
        const rate = T.sparkRate * k * lerp(1, g, 0.8) * p.sparkMul;
        a = state.accSpark + rate * dt;
        let budget = sparkBudgetLeft();
        while (a >= 1) {
          a -= 1;
          if (budget-- <= 0) { sparksDropped++; continue; }
          spawnSpark(state, x, y, dirX, dirY, S, ps, palIdx, a / rate, dt, 50, 200, rand(0.3, 0.85));
        }
        state.accSpark = a;
      }
    }
    state.prevX = x;
    state.prevY = y;
  },

  /** Koniec klatki: zegar strug, wiersze właścicieli względem początku, wysyłka nowych rekordów strug. */
  flush(dt) {
    if (!mesh) return;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    flowPhase = (flowPhase + T.flowSpeed * step) % FLOW_PHASE_WRAP;
    jetClock += step;
    const U = mat.uniforms;
    U.uFlowPh.value = flowPhase;
    U.uClock.value = jetClock - Math.floor(jetClock / JET_CLOCK_WRAP) * JET_CLOCK_WRAP;
    if (owners.pendCount > 0) releasePendingOwners();
    if (jetClock - lastSweep > JET_SWEEP_EVERY) sweepDeadJets();

    // wiersze właścicieli (dysze tej klatki i zwolnione, których strugi jeszcze żyją) względem początku przy kamerze
    const n = owners.used;
    const R = ownerRows;
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      R[o] = owners.x[k] - originX;
      R[o + 1] = owners.y[k] - originY;
      R[o + 2] = owners.dx[k];
      R[o + 3] = owners.dy[k];
    }
    sendDirty();

    mesh.position.set(originX, originY, 0);
    const visible = jets.hi > 0 && jetClock - jets.lastBorn < JET_MAX_LIFE;
    if (mesh.visible !== visible) mesh.visible = visible;
    if (geo.instanceCount !== jets.hi) geo.instanceCount = jets.hi;
    if (visible && n > 0) zbierzZakres(ownerAttr, 0, n * 4);
  },

  /**
   * Lustro CPU shadera strugi (testy): slot i → false, gdy struga nie żyje; inaczej out = { x, y } wylotu (scena),
   * len, wid (długość i szerokość kwadu), alpha, u (część życia) — w chwili ostatniego flush.
   */
  jetAt(i, out) {
    if (!(i >= 0 && i < jets.hi)) return false;
    const age = jetClock - jets.born[i];
    const life = Math.max(jets.life[i], 1e-4);
    if (!(age < life)) return false;
    const u = Math.min(1, Math.max(0, age) / life);
    const om = 1 - u;
    const ease = 1 - Math.pow(om, 2.6);
    const o = i * 4;
    const k = jetC[o + 2];
    out.x = owners.x[k]; out.y = owners.y[k];
    out.len = lerp(jetA[o], jetA[o + 1], ease);
    out.wid = lerp(jetA[o + 2], jetA[o + 3], ease);
    const s = Math.min(1, u / 0.05);
    out.alpha = jetB[o + 2] * Math.pow(om, 1.4) * s * s * (3 - 2 * s);
    out.u = u;
    return true;
  },

  /** Sloty do przejrzenia w jetAt (licznik instancji rysunku). */
  get slotCount() { return jets.hi; },

  getStats() {
    const live = this.jetCount;
    return { nozzles: frameNozzles, jets: live, draws: live > 0 ? 1 : 0 };
  },

  /** Siatka do kompilacji shadera na ekranie ładowania. */
  prewarm() {
    return ensureBuilt() ? mesh : null;
  },

  dispose() {
    if (mesh?.parent) mesh.parent.remove(mesh);
    geo?.dispose();
    mat?.dispose();
    atlas?.dispose();
    mesh = geo = mat = atlas = null;
    jetAttrs = null;
    ownerAttr = null;
    jets.head = 0;
    jets.hi = 0;
    jets.lastBorn = -1e9;
    jets.born.fill(0);
    jets.life.fill(0);
    dirtyFrom = -1;
    lastSweep = jetClock;
    owners.freeCount = 0;
    owners.used = 0;
    owners.pendCount = 0;
  }
};

// Rozgrzewka (2026-10-17): sam prewarmPass z prewarmFx3D (licznik instancji 0) nie trafiał w klucz prawdziwego rysunku —
// pierwsza struga w workerze kompilowała pipeline w klatce (`pipeline sync … MainExhaustJets`). Rejestr z licznikiem ≥ 2.
if (Core3D.warmup) {
  const strugi = () => (ensureBuilt() ? [mesh] : []);
  Core3D.warmup.add({ name: 'struga MAIN', objects: strugi, phase: 'loading', variant: WARIANT_INSTANCJI });
  Core3D.warmup.add({ name: 'struga MAIN (kamery 3D)', objects: strugi, phase: 'loading', ortho: false, variant: WARIANT_INSTANCJI });
}

// A/B i pomiary z konsoli (MainExhaust3D.offscreenLod, jetCount, jetsDropped, sparksDropped).
if (typeof window !== 'undefined') window.MainExhaust3D = MainExhaust3D;
