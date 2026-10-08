// src/3d/sideJets3D.js
//
// DYSZE SIDE NA WEBGPU (2026-10-07) — zamiast płomienia z engineExhaustBatch.js (port z czasów WebGL: kwad „łzy”
// z diamentami i trzy duszki poświaty wyrównane do osi ekranu). Dysza manewrowa (RCS) pracuje IMPULSAMI: przy
// niepełnym ciągu zawór otwiera się na ułamek okresu (PWM ~6 Hz), przy pełnym — ciągła struga; każdy impuls zaczyna
// się zapłonem, a po wyłączeniu z dzwonu ucieka resztka gazu. Warstwy:
//   1. STRUGA — analityczny pióropusz próżniowy (TSL): gorący dysk wylotu, rdzeń wzdłuż osi, stożek rozprężający się
//      zaraz za wargą (gęstość ~ wykładniczo z odległością, gauss w poprzek), włókna gazu z szumu (wspólna tekstura
//      fxNoise.tile2D) płynące od wylotu tym szybciej, im większy ciąg; zapłon — rozbłysk i chwilowe poszerzenie.
//      JEDNA partia na wszystkie dysze (Mesh + InstancedBufferGeometry, jeden przepleciony bufor instancji — 3 bufory
//      wierzchołków), JEDEN rysunek, wysyłka zakresem (zakresyWysylki.js), pozycje względem początku przy kamerze.
//   2. GAZ — cząstki w pulach efektów GPU (WeaponFx: gpuFx.js — compute rozwija paczki, liczy ruch i zanik): opar
//      ciągłej strugi, kłąb na początku każdego impulsu, iskry i błysk przy zimnym zapłonie, obłok resztkowy po
//      wyłączeniu. Nośnik = okręt (gaz leci z kadłubem), losowanie z fxRandom.
//   3. ŚWIATŁO — siatka świateł Core3D.fx: blacha przy pracującej dyszy (światło punktowe tej klatki), błysk zapłonu
//      (jak poświata dysz MAIN — tylko w oświetleniu kadłubów v2).
//   4. GORĄCE POWIETRZE — jak dawniej (Core3D.pushHeatHazeWorld, wołający — engineVfxSystem.js).
// Barwy z palety strug MAIN okrętu (engineFx: Atlas plazma, Terra Nova wodór, piraci rakieta) — boczne dysze świecą
// jak silniki swojego okrętu. Płomień SIDE zaczyna się w WYLOCIE dzwonu modelu dyszy (sideNozzleFrame.js).
// A/B ze starym płomieniem: SideJets3D.enabled = false (konsola: window.SideJets3D).

import * as THREE from 'three/webgpu';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, attribute, clamp, exp, float, length, max, min, mix, positionGeometry, pow, select, smoothstep, texture,
  varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { Core3D } from './core3d.js';
import { fxNoise } from './fx/noise.js';
import { fxRandom } from './fx/fxRandom.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { zbierzZakres } from './zakresyWysylki.js';
import { WeaponFx } from './weapons/weaponFx.js';
import { K } from './weapons/gpuFx.js';
import { HullLighting } from './hullLighting.js';
import { ActiveCarrier, createCarrier, writeCarrier } from '../game/carrierVelocity.js';
import { MAIN_EXHAUST_PALETTES, paletteColor } from '../data/engineFx.js';

/** Wysokość strugi nad płaszczyzną gry: nad skórą sprite'a (0) i modelem dyszy (sprite 1,4, model −0,6), pod
 *  efektami (14–15) — gaz z dyszy na krawędzi kadłuba leci nad blachą, nie spod niej. */
export const SIDE_JET_Z = 1.6;

/**
 * Strojenie (konsola: window.SideJetTune — zmiany działają od następnej klatki). Wymiary w promieniach wylotu R.
 */
export const SIDE_JET_TUNE = {
  // praca impulsowa (PWM): poniżej `min` — zamknięta, od `full` — ciągła struga
  min: 0.03,
  full: 0.8,
  period: 0.16,        // [s] okres impulsów
  minDuty: 0.22,       // najkrótszy impuls (część okresu)
  pulseFloor: 0.6,     // moc otwartego zaworu w trybie impulsowym (impuls krótki, ale pełny)
  attack: 34,          // [1/s] otwarcie zaworu
  release: 20,         // [1/s] zamknięcie
  coldOff: 0.45,       // [s] przerwa, po której impuls to zimny zapłon (błysk, iskry, światło)
  chuffMin: 0.12,      // [s] najkrótsza praca, po której wyłączenie zostawia obłok
  igniteDecay: 11,     // [1/s] zanik rozbłysku zapłonu
  // struga [R]
  len0: 3.2, len1: 7.2, lenIgn: 2.0,
  w0: 1.15, w1: 1.25, wIgn: 0.9,
  gain: 1.0,           // jasność strugi
  pilotBase: 0.18,     // płomyk dyżurny (praca na jałowym)
  pilotMove: 0.8,      // + szybki lot (dawny moveGlow)
  // gaz (cząstki w pulach GPU)
  vaporRate: 22,       // [1/s] przy pełnym ciągu
  pulsePuff: 2.4,      // cząstek na początku impulsu
  chuff: 3,            // cząstek obłoku po wyłączeniu
  sparks: 5,           // iskier przy zimnym zapłonie
  // LOD: promień wylotu na ekranie [px]
  minJetPx: 0.35,
  minGasPx: 1.1,
  minSparkPx: 2.2,
  minLightPx: 0.6,
  maxLights: 48,       // świateł punktowych SIDE na klatkę
  lightGain: 0.24,     // × HullLighting.engineGain() (poświata MAIN na blasze)
  flashGain: 0.5
};
if (typeof window !== 'undefined') window.SideJetTune = SIDE_JET_TUNE;
const T = SIDE_JET_TUNE;

export const SIDE_JET_CAP = 4096;
const STRIDE = 24; // 6 × vec4
const ATTRS = Object.freeze([
  ['iJetA', 0],   // x, y (względem początku), z, długość
  ['iJetB', 4],   // kierunek (scena), pół szerokości na końcu, promień wylotu
  ['iJetC', 8],   // moc, zapłon, ziarno, zegar przepływu
  ['iJetD', 12],  // rdzeń (rgb HDR), jasność (maskowanie, suwak gracza)
  ['iJetE', 16],  // ciało (rgb), płomyk dyżurny
  ['iJetF', 20]   // brzeg (rgb), —
]);

/* ============================================================================
   PALETY — z palet strug MAIN (engineFx.js): rdzeń nad progiem bloomu, ciało ~1, brzeg ciemny.
   ========================================================================== */
function buildPalettes() {
  const c = [0, 0, 0];
  const mul = (k) => [c[0] * k, c[1] * k, c[2] * k];
  return MAIN_EXHAUST_PALETTES.map((pal) => {
    paletteColor(pal, 1.0, 0.0, c); const core = mul(0.75);
    paletteColor(pal, 0.62, 0.18, c); const body = mul(0.55);
    paletteColor(pal, 0.22, 0.6, c); const edge = mul(0.6);
    const light = (pal.light || [0.5, 0.7, 1.0]).slice();
    const spark = (pal.spark || [1.5, 1.8, 2.4]).slice();
    return Object.freeze({
      core, body, edge, light, spark,
      vapor0: body.map((v) => v * 0.5), vapor1: edge.map((v) => v * 0.35),
      puff0: body.map((v) => v * 0.8), flash0: core.map((v) => v * 0.9), flash1: body.map((v) => v * 0.6)
    });
  });
}
export const SIDE_JET_PALETTES = Object.freeze(buildPalettes());

/* ============================================================================
   MATERIAŁ (TSL) — kwad strugi na instancję: s wzdłuż osi (0 — wylot, ujemne — warga w kwadzie), t w poprzek
   (względem pół szerokości końca). Bez pow() z ujemną podstawą, varyingi przycięte (MSAA ekstrapoluje je poza
   trójkąt — NaN w buforze HalfFloat bloom rozlewa na cały ekran).
   ========================================================================== */
function makeJetMaterial(noiseTex) {
  const A = attribute('iJetA', 'vec4');
  const B = attribute('iJetB', 'vec4');
  const vST = varyingProperty('vec4', 'vSjST');     // s, t, stosunek wylotu do pół szerokości, —
  const vC = varyingProperty('vec4', 'vSjC');       // moc, zapłon, ziarno, zegar
  const vCore = varyingProperty('vec4', 'vSjCore'); // rdzeń, jasność
  const vBody = varyingProperty('vec4', 'vSjBody'); // ciało, płomyk
  const vEdge = varyingProperty('vec3', 'vSjEdge'); // brzeg

  const m = new NodeMaterial();
  m.name = 'SideJets';
  m.positionNode = Fn(() => {
    const q = positionGeometry.xy;
    const s = q.y.add(0.5).mul(1.12).sub(0.12);               // −0,12 … 1
    const t = q.x.mul(2.0);                                     // −1 … 1
    const dl = length(B.xy);
    const dir = select(dl.greaterThan(1e-5), B.xy.div(max(dl, 1e-5)), vec2(1.0, 0.0)).toVar();
    const perp = vec2(dir.y.negate(), dir.x);
    const p = A.xy.add(dir.mul(s.mul(A.w))).add(perp.mul(t.mul(B.z)));
    vST.assign(vec4(s, t, B.w.div(max(B.z, 1e-3)), 0.0));
    vC.assign(attribute('iJetC', 'vec4'));
    vCore.assign(attribute('iJetD', 'vec4'));
    vBody.assign(attribute('iJetE', 'vec4'));
    vEdge.assign(attribute('iJetF', 'vec4').xyz);
    return vec3(p, A.z);
  })();
  m.fragmentNode = Fn(() => {
    const s = clamp(vST.x, -0.12, 1.0).toVar();
    const t = clamp(vST.y, -1.0, 1.0).toVar();
    const m0 = clamp(vST.z, 0.05, 1.0).toVar();
    const power = vC.x;
    const ign = vC.y;
    const seed = vC.z;
    const time = vC.w;
    const gainK = vCore.w;
    const sp = max(s, 0.0).toVar();
    // pół szerokości pióropusza: wylot → szybkie rozprężenie za wargą → stożek (sp ≥ 0 — pow bez ujemnej podstawy)
    const w = mix(m0, float(1.0), pow(sp, 0.6)).toVar();
    const r = t.div(w).toVar();
    const r2 = r.mul(r).toVar();
    const fadeIn = smoothstep(-0.06, 0.02, s);
    const along = exp(sp.mul(-2.4)).mul(float(1.0).sub(smoothstep(0.6, 1.0, sp)));
    const across = exp(r2.mul(-2.6));
    // włókna gazu: szum w (kąt, odległość − czas) — płyną od wylotu
    const n1 = texture(noiseTex, vec2(r.mul(0.55).add(seed.mul(0.37)), sp.mul(0.42).sub(time.mul(1.15)))).r;
    const n2 = texture(noiseTex, vec2(r.mul(1.4).add(seed.mul(0.71)), sp.mul(0.9).sub(time.mul(1.9)))).b;
    const flow = n1.mul(0.75).add(n2.mul(0.45)).add(0.25);
    const dens = along.mul(across).mul(fadeIn).mul(flow).toVar();
    // dysk wylotu i gorący rdzeń wzdłuż osi
    const tx = t.div(m0.mul(0.85));
    const exitDisk = exp(sp.div(-0.045)).mul(exp(tx.mul(tx).mul(-2.4))).mul(smoothstep(-0.12, -0.03, s));
    const inner = exp(r2.mul(-14.0)).mul(exp(sp.mul(-5.5))).mul(fadeIn);
    const body = mix(vEdge, vBody.xyz, clamp(dens.mul(1.6), 0.0, 1.0));
    const k = power.mul(gainK);
    const ki = ign.mul(gainK);
    const rgb = body.mul(dens.mul(k)).add(vCore.xyz.mul(exitDisk.mul(k.mul(0.9).add(ki.mul(2.2))).add(inner.mul(k.mul(0.55)))));
    // płomyk dyżurny: mała poświata w wylocie
    const tp = t.div(m0.mul(0.7));
    const pilot = exp(sp.div(-0.03)).mul(exp(tp.mul(tp).mul(-3.0))).mul(smoothstep(-0.12, -0.05, s)).mul(vBody.w).mul(gainK);
    const out = max(rgb.add(vBody.xyz.mul(pilot.mul(0.35))), vec3(0.0)).toVar();
    return vec4(out, min(1.0, max(out.x, max(out.y, out.z))));
  })();
  m.transparent = true;
  m.depthTest = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  blendAddytywnePremul(m);
  return m;
}

/* ============================================================================
   STAN DYSZY
   ========================================================================== */
export function createSideJetState() {
  return {
    seed: fxRandom.next(),
    time: fxRandom.next() * 100,
    phase: 0,
    on: false,
    onT: 0,
    offT: 1,       // dysza „zimna” na starcie — pierwszy impuls to zimny zapłon
    power: 0,
    ignite: 0,
    heat: 0,
    accVapor: fxRandom.next()
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Jeden krok automatu dyszy (czysty — testy): impulsy PWM, moc zaworu, zbocza, rozbłysk, żar, zegar przepływu.
 * Zwraca flagi zdarzeń tej klatki: 1 — początek impulsu, 2 — zimny zapłon, 4 — wyłączenie z obłokiem.
 */
export function stepSideJet(state, fire, dt) {
  const f = clamp01(fire);
  let gate = 0;
  if (f >= T.full) {
    gate = 1;
  } else if (f > T.min) {
    state.phase += dt / T.period;
    if (state.phase >= 1) state.phase -= Math.floor(state.phase);
    const duty = T.minDuty + (1 - T.minDuty) * (f - T.min) / (T.full - T.min);
    gate = state.phase < duty ? 1 : 0;
  } else {
    state.phase = 0; // następny impuls rusza od razu
  }
  const target = gate ? Math.max(f, T.pulseFloor) : 0;
  const rate = target > state.power ? T.attack : T.release;
  state.power += (target - state.power) * (1 - Math.exp(-rate * dt));
  if (target === 0 && state.power < 1e-3) state.power = 0;
  let events = 0;
  const on = gate === 1;
  if (on && !state.on) {
    events |= 1;
    if (state.offT >= T.coldOff) events |= 2;
    state.ignite = Math.max(state.ignite, (events & 2) ? 1 : 0.4);
    state.onT = 0;
  } else if (!on && state.on) {
    if (state.onT >= T.chuffMin) events |= 4;
    state.offT = 0;
  }
  state.on = on;
  if (on) state.onT += dt; else state.offT += dt;
  state.ignite *= Math.exp(-T.igniteDecay * dt);
  if (state.ignite < 1e-3) state.ignite = 0;
  const hot = state.power > 0.08;
  const hTarget = hot ? Math.min(1, 0.35 + state.power) : 0;
  state.heat += (hTarget - state.heat) * (1 - Math.exp(-(hot ? 0.9 : 0.28) * dt));
  state.time = (state.time + dt * (0.8 + 0.9 * state.power)) % 100;
  return events;
}

/* ============================================================================
   PARTIA
   ========================================================================== */
let mesh = null;
let geo = null;
let mat = null;
let data = null;
let buffer = null;
let count = 0;
let nozzles = 0;
let lightsThisFrame = 0;
let originX = 0;
let originY = 0;
let frameZoom = 1;
let frameDt = 1 / 60;
const _carrier = createCarrier();

let _base = null;
/** Geometria partii (kwad + przepleciony bufor instancji na `capacity` dysz) — też trzymacz rozgrzewki. */
function createJetGeometry(capacity) {
  if (!_base) _base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(_base.index);
  g.setAttribute('position', _base.getAttribute('position'));
  g.setAttribute('uv', _base.getAttribute('uv'));
  const arr = new Float32Array(Math.max(1, capacity) * STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1);
  for (const [name, offset] of ATTRS) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, offset));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { geometry: g, data: arr, buffer: buf };
}

function ensureBuilt() {
  if (mesh) return true;
  if (!Core3D.isInitialized || !Core3D.scene) return false;
  ({ geometry: geo, data, buffer } = createJetGeometry(SIDE_JET_CAP));
  mat = makeJetMaterial(fxNoise.tile2D());
  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'SideJets';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  mesh.visible = false;
  Core3D.scene.add(mesh);
  return true;
}

// Paczka cząstek (jak `E()` receptur broni): pula, rodzaj, liczba (ułamek losowo), punkt i kierunek w SCENIE.
function E(pool, kind, n, x, y, dx, dy) {
  return pool.begin(kind, fxRandom.round(n)).at(x, y).dir(dx, dy);
}

function emitGas(state, p, pal, events, R, dt) {
  const fx = WeaponFx.ctx?.fx;
  if (!fx) return;
  const x = p.x, y = p.y, dx = p.dirX, dy = p.dirY;
  const pw = state.power;
  const k = p.gain;
  // opar ciągłej strugi
  let acc = state.accVapor + T.vaporRate * pw * dt;
  if (acc >= 1) {
    const n = Math.floor(acc);
    acc -= n;
    E(fx.add, K.VAPOR, n, x, y, dx, dy).cone(0.26, 0.18).speed(22 * R, 40 * R).life(0.3, 0.55).drag(3.6, 5.0)
      .s0(0.7 * R, 1.0 * R).s1(2.4 * R, 3.6 * R).colors(pal.vapor0, pal.vapor1).mix(3).alpha(0.35 * k, 0.55 * k)
      .fade(0.05, 1.6).grow(0.5).spin(1).emit();
  }
  state.accVapor = acc;
  // kłąb na początku impulsu
  if (events & 1) {
    E(fx.add, K.VAPOR, T.pulsePuff * (0.5 + 0.5 * pw), x, y, dx, dy).cone(0.22, 0.18).speed(26 * R, 48 * R).life(0.35, 0.6)
      .drag(3.2, 4.4).s0(0.8 * R, 1.1 * R).s1(3.0 * R, 4.5 * R).colors(pal.puff0, pal.vapor1).mix(3).alpha(0.5 * k, 0.7 * k)
      .fade(0.04, 1.5).grow(0.5).spin(1.2).emit();
  }
  // zimny zapłon: błysk w wylocie i iskry
  if ((events & 2) && p.sparks) {
    E(fx.add, K.GLOW, 1, x, y, dx, dy).life(0.08, 0.1).s0(1.4 * R, 1.6 * R).s1(3.0 * R, 3.4 * R).colors(pal.flash0, pal.flash1)
      .mix(14).alpha(0.9 * k, 0.9 * k).fade(0.005, 2.0).grow(0.4).emit();
    E(fx.spark, K.SPARK, T.sparks, x, y, dx, dy).cone(0.35, 0.18).speed(90 * R, 170 * R).life(0.12, 0.3).drag(0.6, 1.4)
      .colors(pal.spark).x01(4 * R, 0.32).x23(0.06, 1.5).emit();
  }
  // obłok resztkowy po wyłączeniu
  if (events & 4) {
    E(fx.add, K.VAPOR, T.chuff, x, y, dx, dy).cone(0.6, 0.18).speed(8 * R, 20 * R).life(0.5, 0.9).drag(1.8, 2.6)
      .s0(1.0 * R, 1.4 * R).s1(4.0 * R, 6.0 * R).colors(pal.vapor0, pal.vapor1).mix(2.4).alpha(0.3 * k, 0.45 * k)
      .fade(0.06, 1.4).grow(0.5).spin(0.8).emit();
  }
}

export const SideJets3D = {
  /** Nowe dysze SIDE (false — dawny płomień engineExhaustBatch.js, A/B). */
  enabled: true,
  /** Gaz w pulach GPU efektów broni (false — sama struga). */
  gas: true,
  /** Światła na blasze (siatka świateł Core3D.fx). */
  lights: true,

  /** Początek klatki: początek układu przy kamerze (scena), krok czasu, zoom (LOD). */
  begin(orgX, orgY, dt, zoom) {
    originX = Number.isFinite(orgX) ? orgX : 0;
    originY = Number.isFinite(orgY) ? orgY : 0;
    frameDt = Math.max(0, Math.min(0.1, Number(dt) || 0));
    frameZoom = zoom > 0 ? zoom : 1;
    count = 0;
    nozzles = 0;
    lightsThisFrame = 0;
  },

  /**
   * Jedna dysza tej klatki. state — createSideJetState (mutowany). p (obiekt wielokrotnego użytku):
   *   x, y          wylot (scena; świat gry = x, −y)
   *   dirX, dirY    kierunek wydechu (scena, jednostkowy)
   *   radius        promień wylotu [j. świata]
   *   fire          ciąg manewrowy 0..1 (strafe, obrót, wymuszony __throttle)
   *   idle          jałowy połysk (szybki lot) 0..1; dead — dysza martwa (hulk): bez płomyka
   *   palette       indeks palety MAIN okrętu
   *   gain          jasność (widoczność maskowania × suwak gracza)
   *   entity, fromRender — nośnik gazu (writeCarrier)
   * Zwraca stan (moc, żar — dla modelu dyszy i gorącego powietrza).
   */
  push(state, p) {
    nozzles++;
    const dt = frameDt;
    const events = stepSideJet(state, p.fire, dt);
    const R = p.radius > 0 ? p.radius : 0;
    const px = R * frameZoom;
    const palIdx = p.palette >= 0 && p.palette < SIDE_JET_PALETTES.length ? p.palette | 0 : 0;
    const pal = SIDE_JET_PALETTES[palIdx];
    const pilot = p.dead ? 0 : Math.min(1, T.pilotBase + T.pilotMove * clamp01(p.idle));
    const gain = clamp01(p.gain) * T.gain;
    const wx = p.x;
    const wy = -p.y;

    // 1. struga
    if (gain > 0.004 && px >= T.minJetPx && (state.power > 0.003 || state.ignite > 0.01 || pilot > 0.01) && ensureBuilt() && count < SIDE_JET_CAP) {
      const o = (count++) * STRIDE;
      const d = data;
      const len = R * (T.len0 + T.len1 * state.power + T.lenIgn * state.ignite);
      const halfW = R * (T.w0 + T.w1 * state.power + T.wIgn * state.ignite);
      d[o] = p.x - originX; d[o + 1] = p.y - originY; d[o + 2] = SIDE_JET_Z; d[o + 3] = len;
      d[o + 4] = p.dirX; d[o + 5] = p.dirY; d[o + 6] = halfW; d[o + 7] = R;
      d[o + 8] = state.power; d[o + 9] = state.ignite; d[o + 10] = state.seed; d[o + 11] = state.time;
      d[o + 12] = pal.core[0]; d[o + 13] = pal.core[1]; d[o + 14] = pal.core[2]; d[o + 15] = gain;
      d[o + 16] = pal.body[0]; d[o + 17] = pal.body[1]; d[o + 18] = pal.body[2]; d[o + 19] = pilot;
      d[o + 20] = pal.edge[0]; d[o + 21] = pal.edge[1]; d[o + 22] = pal.edge[2]; d[o + 23] = 0;
    }

    // 2. gaz (cząstki GPU) — tylko w kadrze i gdy dysza ma kilka pikseli
    const wantGas = this.gas && gain >= 0.5 && px >= T.minGasPx && (events !== 0 || state.power > 0.02);
    if (wantGas && WeaponFx.available && WeaponFx._inView(wx, wy, R * 12)) {
      ActiveCarrier.set(writeCarrier(p.entity, wx, wy, !!p.fromRender, _carrier));
      try {
        p.sparks = px >= T.minSparkPx;
        emitGas(state, p, pal, events, R, dt);
      } finally {
        ActiveCarrier.clear();
      }
    }

    // 3. światło na blasze (oświetlenie kadłubów v2 — jak poświata dysz MAIN)
    if (this.lights && gain >= 0.5 && px >= T.minLightPx && (state.power > 0.06 || (events & 2))) {
      const lights = Core3D.fx ? Core3D.fx.lights : null;
      if (lights && HullLighting.isPbr()) {
        const lg = HullLighting.engineGain();
        if (lg > 0) {
          const c = pal.light;
          if (state.power > 0.06 && lightsThisFrame < T.maxLights) {
            const len = R * (T.len0 + T.len1 * state.power);
            lights.point(wx + p.dirX * len * 0.3, wy - p.dirY * len * 0.3, c[0], c[1], c[2],
              lg * T.lightGain * state.power * gain, R * 7, R * 1.2, 0);
            lightsThisFrame++;
          }
          if (events & 2) {
            ActiveCarrier.set(writeCarrier(p.entity, wx, wy, !!p.fromRender, _carrier));
            lights.flash(wx, wy, c[0], c[1], c[2], lg * T.lightGain * T.flashGain * 4 * gain, R * 9, 0.12, 2, 0.3, R * 1.5);
            ActiveCarrier.clear();
          }
        }
      }
    }
    return state;
  },

  /** Koniec klatki: liczba instancji, widoczność, wysyłka zapisanego zakresu. */
  flush() {
    if (!mesh) return;
    mesh.position.set(originX, originY, 0);
    if (geo.instanceCount !== count) geo.instanceCount = count;
    const visible = count > 0;
    if (mesh.visible !== visible) mesh.visible = visible;
    if (visible) zbierzZakres(buffer, 0, count * STRIDE);
  },

  getStats() {
    return { nozzles, jets: count, draws: count > 0 ? 1 : 0, lights: lightsThisFrame };
  },

  /** Rozgrzewka (Core3D.warmup, ekran ładowania): trzymacz z układem atrybutów partii i jedną instancją. */
  warmupMeshes() {
    if (!ensureBuilt()) return null;
    if (!this._warm) {
      const { geometry } = createJetGeometry(1);
      geometry.instanceCount = 1;
      this._warm = new THREE.Mesh(geometry, mat);
      this._warm.name = 'SideJets (rozgrzewka)';
      this._warm.frustumCulled = false;
      this._warm.renderOrder = 0;
    }
    return [this._warm];
  },

  dispose() {
    if (mesh?.parent) mesh.parent.remove(mesh);
    geo?.dispose();
    this._warm?.geometry.dispose();
    mat?.dispose();
    mesh = geo = mat = null;
    this._warm = null;
    data = buffer = null;
    count = 0;
  },

  _warm: null
};

// Dla testów: materiał i układ rekordu (bez Core3D).
export const SideJetInternals = Object.freeze({ makeJetMaterial, STRIDE, ATTRS });

if (typeof window !== 'undefined') window.SideJets3D = SideJets3D;

// Pipeline strugi na ekranie ładowania (phase 'loading' — partia powstaje wtedy, jak przy pierwszej dyszy gry).
Core3D.warmup?.add({ name: 'dysze SIDE (WebGPU)', objects: () => SideJets3D.warmupMeshes(), phase: 'loading' });
