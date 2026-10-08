// Render portu K-7 (dok gameplayowy) na ringu „Halo”. Dane brył z
// haloPortK7Build.js; tu: instancje (prostopadłościan / walec / torus) w
// zestawach BG (pod statkami) i FG (nad statkami: ramiona paliwowe, złączki,
// dach), płaskie wielokąty pokładu, napisy z atlasu i przewody paliwowe —
// rura z liny haloPortK7Fuel.js (ramiona SCARA, fizyka przewodów, 2026-10-07).
//
// Materiały K-7 (stal, ciemny metal, jasne płyty, żółte, pokład z płyt,
// farba, cyjanowe listwy) oddane w modelu światła ringu: widoczność słońca
// z cieniem planety i ringu, światło planety, dwie lampy hali liczone
// w shaderze (bez PointLight — gra ma enginePointLights: false).
//
// Draw calle: BG ≤ 5, FG ≤ 6 niezależnie od liczby brył. Pozycje przez
// modelViewMatrix (liczone w double po stronie CPU), więc bez drgań.
//
// Port WebGPU (zadanie 10): materiały w TSL (NodeMaterial), 1:1 z dawnym GLSL
// (K7_INSTANCE_*, K7_PLATE_*, K7_LABEL_*, K7_HOSE_*, GLSL_K7_SURFACE). GRAF NA RING,
// WARTOŚCI NA HALĘ (PLAN §3): cztery hale ringu dzielą jeden graf na rodzaj materiału
// (k7Graphs(u) — jeden NodeBuilder na rodzaj i stan, nie na halę), każda hala ma lekkie
// NodeMaterial-e z tymi samymi węzłami, a wartości hali siedzą w `material.uniforms`
// (zwykłe obiekty { value }, kod aktualizacji bez zmian). Węzły czytają je przy rysowaniu
// obiektu: `uniform().onObjectUpdate` (uHub, uHallLights, uRoofOpacity), tablice (macierze
// grup ruchomych, emisja grup, lampy, paleta, emisja, poświata) w dwóch uniformArray
// pakowanych per obiekt (onObjectUpdate — domyślnie tablica pakuje się raz na render(),
// wtedy wszystkie hale passa dostałyby dane jednej), atlas napisów — węzeł tekstury per
// obiekt (`teksturaObiektu`; `texture().onObjectUpdate()` w r183 nie działa).
import * as THREE from 'three';
import {
  Fn, If, Loop, Discard,
  float, int, vec2, vec3, vec4, mat3, mat4,
  attribute, varyingProperty, uniform, uniformArray, positionGeometry, normalGeometry,
  modelViewMatrix, cameraProjectionMatrix,
  abs, clamp, cos, dot, exp, floor, fract, fwidth, length, max, min, mix, normalize, pow, select, sin, smoothstep, step
} from 'three/tsl';
import { teksturaObiektu, teksturaZastepcza } from '../tsl/teksturaObiektu.js';
import { HALO_PI, haloHash12, haloRingTSL } from './haloRingTSL.js';
import { haloNodeMaterial, haloQrot } from './haloRingMegastructure.js';
import { K7_ABOVE_SCALE, K7_FUEL_STATION, K7_STOWED_POSE, k7Frame, k7HeightToZ, k7Phase } from './haloPortK7Layout.js';
import { K7_INSTANCE_STRIDE, K7_MAT, buildK7Scene } from './haloPortK7Build.js';
import { haloFrameToFrame, haloXfPoint } from './haloPortBays.js';
import { resolveHaloProfile } from './haloRingProfiles.js';
import { K7_BEACON, K7_BEACON_LOOK, K7_VENT_DUR, K7_VENT_WARN } from './haloPortK7Lights.js';
import { K7_HOSE_NODES, createK7FuelRig, stepK7FuelRig } from './haloPortK7Fuel.js';
import { zbierzZakres } from '../zakresyWysylki.js';

const MAX_GROUPS = 40;   // 8 słupków paliwowych × 4 grupy (człony ramienia, wysięgnik, złączka) + 4 zamki pola + grupa 0
const MAX_LAMPS = 16;    // lampy hali (8, haloPortK7Lights.js) + po trzy nad każdą z 2 zatok kompleksu (pasy MEGA, grzebień)
const HOSE_RINGS = 72;   // przekrojów rury na przewód (próbkowanie liny po długości łuku)
const HOSE_SIDES = 10;   // wierzchołków w przekroju
const HOSE_RIB = 96;     // uv.y = metry przewodu od złączki / HOSE_RIB (żebro co 6 j. — shader: fract(uv.y · 16))
const MAX_SPOTS = 10;    // reflektory hali (haloPortK7Lights.js) — 3 × vec4: pozycja + zasięg, oś + cos zewn., barwa + cos wewn.
const K7_SPOT_DECK_GAIN = 0.9;    // reflektory na pokładzie (model światła ringu) względem mocy w siatce gry
const r4 = (x) => +x.toFixed(4);   // stałe jak dawne literały GLSL (f3: 4 miejsca)
const srgb = (hex) => {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
};

// Paleta K-7 (materiały K7_MAT 0–13) i emisja (cyjan, ciepła, biel, czerwień,
// zieleń) z profilu planety (port.k7Palette / k7Emit, haloRingProfiles.js):
// sRGB → liniowe, zaokrąglone do 4 miejsc jak dawne literały w shaderze.
// Emisja: pasmo barwne 0,9–1,3 (bloomuje i zostaje barwne), biel ~1,4.
const K7_PAL_SIZE = 14;
const round4 = (x) => Number(x.toFixed(4));
export function k7StylePalette(style) {
  const port = style || resolveHaloProfile('earth').port;
  return {
    pal: port.k7Palette.slice(0, K7_PAL_SIZE).map((hex) => srgb(hex).map(round4)),
    emit: port.k7Emit.map((c) => c.map(round4)),
    glow: port.k7Glow
  };
}

// ---------------------------------------------------------------------------
// Tablice hali w grafie (uniformArray vec4, pakowane przy rysowaniu obiektu):
//  - K7_GROUPS_BLOCK — macierze grup ruchomych (40 × 4 kolumny), tylko wierzchołki instancji;
//  - K7_SURF_BLOCK — emisja grup (40), lampy (16), paleta (14), emisja K-7 (5), poświata szkła (2),
//    reflektory (10 × 3).
// Stałe nazwy buforów: trzy ringi dzielą ten sam WGSL (jeden moduł i pipeline na rodzaj).
export const K7_GROUPS_BLOCK = 'k7Groups';
export const K7_SURF_BLOCK = 'k7Surf';
export const K7_SURF_LAYOUT = Object.freeze({
  emit: 0,
  lamps: MAX_GROUPS,
  pal: MAX_GROUPS + MAX_LAMPS,
  k7Emit: MAX_GROUPS + MAX_LAMPS + K7_PAL_SIZE,
  glow: MAX_GROUPS + MAX_LAMPS + K7_PAL_SIZE + 5,
  spots: MAX_GROUPS + MAX_LAMPS + K7_PAL_SIZE + 5 + 2,
  length: MAX_GROUPS + MAX_LAMPS + K7_PAL_SIZE + 5 + 2 + MAX_SPOTS * 3
});
const S = K7_SURF_LAYOUT;

function packK7Groups(frame, node) {
  const mats = frame?.material?.uniforms?.uGroup?.value;
  const out = node.value;
  if (!mats || !out || typeof out.length !== 'number') return undefined; // budowa (bez klatki)
  for (let i = 0; i < MAX_GROUPS; i++) out.set(mats[i].elements, i * 16);
  return undefined;
}

// wektor (Vector3 / Vector4) do slotu vec4 tablicy (bez domknięć — wołane przy każdym rysowaniu hali)
function putVec(out, v, i) {
  const o = i * 4;
  out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z; out[o + 3] = v.w ?? 0;
}

function packK7Surf(frame, node) {
  const U = frame?.material?.uniforms;
  const out = node.value;
  if (!U?.uGroupEmit || !out || typeof out.length !== 'number') return undefined;
  const emit = U.uGroupEmit.value;
  for (let i = 0; i < MAX_GROUPS; i++) putVec(out, emit[i], S.emit + i);
  const lamps = U.uLamps.value;
  for (let i = 0; i < MAX_LAMPS; i++) putVec(out, lamps[i], S.lamps + i);
  const pal = U.uK7Pal.value;
  for (let i = 0; i < K7_PAL_SIZE; i++) putVec(out, pal[i], S.pal + i);
  const k7e = U.uK7Emit.value;
  for (let i = 0; i < 5; i++) putVec(out, k7e[i], S.k7Emit + i);
  const glow = U.uK7Glow.value;
  for (let i = 0; i < 2; i++) putVec(out, glow[i], S.glow + i);
  const spots = U.uK7Spots?.value;
  if (spots) for (let i = 0; i < MAX_SPOTS * 3; i++) putVec(out, spots[i], S.spots + i);
  return undefined;
}

// Miganie soczewki (haloPortK7Lights.js — lustro CPU `k7BeaconLevel`, te same wzory i stałe): kind ≥ 1,
// t — zegar migania hali (uHallLights.w), phase / period z instancji [s].
const TWO_PI = 6.2831853;
function k7BeaconLevelTSL(kind, t, phase, period) {
  const lvl = float(0.0).toVar();
  If(kind.lessThan(K7_BEACON.OBSTRUCTION + 0.5), () => {
    const f = fract(t.add(phase).div(1.5)).toVar();
    lvl.assign(smoothstep(0.0, 0.05, f).mul(float(1.0).sub(smoothstep(0.28, 0.46, f))));
  }).ElseIf(kind.lessThan(K7_BEACON.CLEAR + 0.5), () => {
    const s = fract(t.add(phase).div(2.4)).mul(2.4).toVar();
    const pulse = (a) => smoothstep(a, a + 0.03, s).mul(float(1.0).sub(smoothstep(a + 0.1, a + 0.15, s)));
    lvl.assign(pulse(0.0).add(pulse(0.3)));
  }).ElseIf(kind.lessThan(K7_BEACON.RABBIT + 0.5), () => {
    const s = fract(t.sub(phase).div(1.8)).mul(1.8);
    lvl.assign(exp(s.mul(-18.0)));
  }).ElseIf(kind.lessThan(K7_BEACON.EDGE + 0.5), () => {
    lvl.assign(float(0.6).add(float(0.4).mul(sin(t.add(phase).mul(TWO_PI / 3.2)))));
  }).ElseIf(kind.lessThan(K7_BEACON.STROBE + 0.5), () => {
    const s = fract(t.add(phase).div(1.4)).mul(1.4).toVar();
    lvl.assign(exp(s.mul(-45.0)).add(step(0.18, s).mul(exp(s.sub(0.18).mul(-45.0)))));
  }).ElseIf(kind.lessThan(K7_BEACON.VENT + 0.5), () => {
    const p = max(period, 1.0).toVar();
    const u = fract(t.add(phase).div(p)).mul(p).toVar();
    const end = K7_VENT_WARN + K7_VENT_DUR;
    const warn = smoothstep(0.0, 0.1, u).mul(float(1.0).sub(smoothstep(end - 0.2, end + 0.1, u)));
    const c = float(0.5).add(float(0.5).mul(cos(u.mul(TWO_PI * 2.4)))).toVar();
    lvl.assign(warn.mul(float(0.2).add(c.mul(c).mul(0.8))));
  }).Else(() => {
    lvl.assign(0.55);
  });
  return lvl;
}

// Barwa soczewki × szczyt HDR (K7_BEACON_LOOK) według rodzaju.
function k7BeaconColorTSL(kind) {
  const look = (k) => vec3(...K7_BEACON_LOOK[k].color.map((c) => r4(c * K7_BEACON_LOOK[k].hdr)));
  let col = look(K7_BEACON.HOLD);
  for (let k = K7_BEACON.VENT; k >= K7_BEACON.OBSTRUCTION; k--) col = select(kind.lessThan(k + 0.5), look(k), col);
  return col;
}

// Wartość per obiekt z material.uniforms[klucz].value rysowanego obiektu.
const perObject = (init, key) => uniform(init).onObjectUpdate(({ material }) => material?.uniforms?.[key]?.value);

// Atlas napisów per obiekt (każda hala ma swój): `teksturaObiektu` (src/3d/tsl/teksturaObiektu.js —
// `texture().onObjectUpdate()` w three r183 NIE działa). Zastępcza przy budowie: filtr liniowy (TSL
// wybiera ścieżkę próbkowania z tekstury obecnej przy BUDOWIE), (0, 0, 0, 0) = brak napisu.

// x⁵ mnożeniem (baza WebGL: FXC rozwijał pow(x, 5.0) w mnożenia — dla podstawy tuż poniżej
// zera bez NaN; pow w WGSL to exp2(n·log2 x) = NaN dla x < 0).
const pow5 = (x) => {
  const x2 = x.mul(x).toVar();
  return x2.mul(x2).mul(x);
};
const inRange = (x, lo, hi) => x.greaterThan(lo).and(x.lessThan(hi));

// ---------------------------------------------------------------------------
// Grafy K-7 ringu (dawne GLSL_K7_SURFACE + K7_INSTANCE_* / K7_PLATE_* / K7_LABEL_* / K7_HOSE_*),
// budowane RAZ na uniformy ringu (cache po obiekcie uniformów — przebudowa ringu przy zmianie
// jakości trzyma te same uniformy, więc i grafy). Każda hala dostaje materiały z tymi węzłami.
const K7_GRAPHS = new WeakMap();

export function k7Graphs(u) {
  let G = K7_GRAPHS.get(u);
  if (G) return G;
  const H = haloRingTSL(u);
  const U = H.uniforms;
  // wartości hali (per obiekt)
  const hub = perObject(new THREE.Matrix4(), 'uHub');
  const hallLights = perObject(new THREE.Vector4(), 'uHallLights');
  const roofOpacity = perObject(1, 'uRoofOpacity');
  const groups = uniformArray(Array.from({ length: MAX_GROUPS * 4 }, () => new THREE.Vector4()), 'vec4').setName(K7_GROUPS_BLOCK);
  groups.onObjectUpdate(packK7Groups);
  const surf = uniformArray(Array.from({ length: S.length }, () => new THREE.Vector4()), 'vec4').setName(K7_SURF_BLOCK);
  surf.onObjectUpdate(packK7Surf);
  const hub3 = mat3(hub);

  // Paleta hali (dawne k7Palette / k7Emit): kody 0–13 z palety, dalej stała ciemna barwa.
  const k7Palette = (m) => {
    const i = int(clamp(floor(m.add(0.5)), 0.0, float(K7_PAL_SIZE))).toVar();
    return i.lessThan(K7_PAL_SIZE).select(surf.element(int(S.pal).add(min(i, int(K7_PAL_SIZE - 1)))).xyz, vec3(0.02, 0.022, 0.025));
  };
  const k7Emit = (m) => surf.element(int(S.k7Emit).add(int(clamp(floor(m.add(0.5)).sub(14.0), 0.0, 4.0)))).xyz;

  // Płyty jak tekstura K-7: 3 × 4 płyty na kafel 260 j. (pokład 4 × 4), jaśniejsza
  // krawędź od góry-lewej, ciemna spoina, śruby w narożnikach, zacieki (dawne k7Plates;
  // parametr out highlight → pole `hl` wyniku).
  const k7Plates = (uv, deck, fw) => {
    const cells = deck.select(vec2(4.0, 4.0), vec2(3.0, 4.0)).toVar();
    const g = uv.div(260.0).mul(cells).toVar();
    const id = floor(g).toVar();
    const fcell = fract(g).toVar();
    const psz = vec2(260.0).div(cells).toVar();
    const d = min(fcell, vec2(1.0).sub(fcell)).mul(psz).toVar();   // odległość od krawędzi płyty [j.]
    const aa = fw.mul(1.2).add(0.2).toVar();
    const seam = float(1.0).sub(smoothstep(0.35, float(0.35).add(aa), min(d.x, d.y))).toVar();
    const hl = float(1.0).sub(smoothstep(0.7, float(0.7).add(aa), fcell.x.mul(psz.x)))
      .add(float(1.0).sub(smoothstep(0.7, float(0.7).add(aa), float(1.0).sub(fcell.y).mul(psz.y)))).toVar();
    hl.mulAssign(float(1.0).sub(seam));
    const v = haloHash12(id.add(deck.select(float(17.0), float(3.0)))).toVar();
    const b = abs(fcell.mul(psz).sub(4.4)).toVar();
    const b2 = abs(vec2(1.0).sub(fcell).mul(psz).sub(4.4)).toVar();
    const bolt = float(1.0).sub(smoothstep(0.7, float(0.7).add(aa),
      min(min(length(b), length(b2)), min(length(vec2(b.x, b2.y)), length(vec2(b2.x, b.y)))))).toVar();
    const sc = fcell.sub(vec2(0.8, 0.7)).toVar();
    const stain = exp(dot(sc, sc).negate().mul(9.0)).mul(haloHash12(id.add(5.0))).toVar();
    const detail = float(1.0).sub(smoothstep(0.8, 3.0, fw)).toVar();
    // jasność płyt jak w teksturze K-7 (sRGB → liniowo): ściany 167–195/255,
    // pokład 66–85/255 na ciemnym tle — pokład ciemny, oznakowanie jasne
    const base = deck.select(mix(0.11, 0.17, v), mix(0.42, 0.56, v));
    const value = base.mul(float(1.0).sub(seam.mul(0.55).mul(detail))).mul(float(1.0).sub(bolt.mul(0.5).mul(detail)))
      .mul(float(1.0).sub(stain.mul(0.25))).toVar();
    return { value, hl };
  };

  // Lampy hali nad stanowiskami kapitalnymi (K-7 miało PointLighty; 4 stanowiska
  // od 2026-09-23), na zewnątrz od osi stanowiska o 310 j. jak w K-7, i po trzy
  // nad każdą otwartą zatoką kompleksu (dwa pasy MEGA, grzebień).
  const k7HallLight = (hubP, N) => {
    const acc = vec3(0.0).toVar();
    Loop({ start: 0, end: MAX_LAMPS, type: 'int', condition: '<', name: 'k7Lamp' }, ({ k7Lamp }) => {
      const Lp = surf.element(int(S.lamps).add(k7Lamp)).toVar();
      const dv = Lp.xyz.sub(hubP).toVar();
      const d = length(dv).toVar();
      const fall = float(1.0).div(float(1.0).add(d.div(520.0).mul(d.div(520.0))));
      const win = float(1.0).sub(smoothstep(1500.0, 2450.0, d)).mul(step(0.5, Lp.w));
      const col = Lp.w.lessThan(1.5).select(vec3(1.0, 0.78, 0.55), vec3(0.66, 0.85, 0.92));
      // N w układzie huba: y = góra
      acc.addAssign(col.mul(fall).mul(win).mul(max(dot(N, dv.div(max(d, 1.0))), 0.0)));
    });
    // Reflektory hali (haloPortK7Lights.js): zanik i stożek jak w siatce świateł gry (te same reflektory oświetlają
    // tam pył, parę i kadłuby) — okno do zera na zasięgu × 1 / (1 + 4x²), stożek smoothstep².
    Loop({ start: 0, end: MAX_SPOTS, type: 'int', condition: '<', name: 'k7Spot' }, ({ k7Spot }) => {
      const o = int(S.spots).add(k7Spot.mul(3)).toVar();
      const A = surf.element(o).toVar();
      const C = surf.element(o.add(2)).toVar();
      const dv = A.xyz.sub(hubP).toVar();
      const d = length(dv).toVar();
      const x = d.div(max(A.w, 1.0)).toVar();
      If(x.lessThan(1.0).and(C.x.add(C.y).add(C.z).greaterThan(0.0)), () => {
        const B = surf.element(o.add(1)).toVar();
        const Ld = dv.div(max(d, 1.0)).toVar();
        const win = float(1.0).sub(x.mul(x));
        const att = win.mul(win).div(x.mul(x).mul(4.0).add(1.0));
        const cone = smoothstep(B.w, C.w, dot(Ld.negate(), B.xyz)).toVar();
        acc.addAssign(C.xyz.mul(att).mul(cone).mul(cone).mul(max(dot(N, Ld), 0.0)));
      });
    });
    return acc;
  };

  // Cieniowanie (dawne k7Shade): v — varyingi materiału (ring, n, hub), group — indeks emisji grupy.
  const k7Shade = (v, albedo0, m, hubN, fuv, fw, group) => {
    const N = normalize(v.n).toVar();
    const p = vec3(v.ring).toVar();
    const V = normalize(U.uCamLocal.sub(p)).toVar();
    const L = U.uSunDir;
    const plated = m.lessThan(5.5).toVar();
    const deck = inRange(m, 5.5, 6.5).or(m.greaterThan(19.5)).toVar();
    const plates = k7Plates(fuv, deck, fw);
    const hl = float(0.0).toVar();
    const albedo = vec3(albedo0).toVar();
    If(plated.or(deck), () => {
      albedo.mulAssign(plates.value);
      hl.assign(plates.hl);
    });
    If(m.greaterThan(19.5), () => { albedo.assign(vec3(0.012, 0.017, 0.021).mul(plates.value)); });   // pole stanowiska
    const rough = inRange(m, 6.5, 7.5).select(float(0.38), inRange(m, 9.5, 10.5).select(float(0.45),
      inRange(m, 10.5, 11.5).select(float(0.2), float(0.72)))).toVar();
    const metal = inRange(m, 6.5, 7.5).select(float(0.86), plated.select(float(0.5), float(0.1))).toVar();
    const sunVis = H.haloSunVisibility(p.add(N.mul(2.0)), L).toVar();
    const NdL = max(dot(N, L), 0.0).toVar();
    const NdV = max(dot(N, V), 1e-3).toVar();
    const Hv = normalize(L.add(V)).toVar();
    const a2 = rough.mul(rough).toVar();
    const NdH = max(dot(N, Hv), 0.0).toVar();
    const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
    const F0 = mix(vec3(0.04), albedo, metal).toVar();
    const Fs = F0.add(vec3(1.0).sub(F0).mul(pow5(float(1.0).sub(max(dot(Hv, V), 0.0))))).toVar();
    const spec = Fs.mul(min(a2.div(float(HALO_PI).mul(dd).mul(dd)).mul(0.25).div(NdV), 6.0)).mul(NdL).toVar();
    // wypełnienie jak AmbientLight obiektów 3D gry + światło planety + lampy hali
    const amb = vec3(0.050, 0.056, 0.066).mul(float(0.55).add(float(0.45).mul(max(hubN.y, 0.0))))
      .add(H.haloPlanetshine(p, N)).add(vec3(U.uNightAmbient)).toVar();
    amb.addAssign(k7HallLight(v.hub, hubN).mul(hallLights.x));
    const diffuse = albedo.mul(float(1.0).sub(metal.mul(0.7)));
    const color = diffuse.mul(U.uSunColor.mul(sunVis).mul(NdL).add(amb)).add(U.uSunColor.mul(sunVis).mul(spec).mul(0.8)).toVar();
    // krawędź płyt łapie światło (jasna faza z tekstury K-7)
    color.addAssign(albedo.mul(hl).mul(0.25).mul(H.haloLuma(sunVis).mul(NdL).add(0.2)));
    // odbicie otoczenia: kosmos czarny, planeta poniżej
    color.addAssign(F0.mul(float(0.02).add(float(0.05).mul(float(1.0).sub(max(N.z, 0.0))))).mul(float(1.0).sub(rough)));
    If(inRange(m, 13.5, 18.5), () => {
      color.assign(k7Emit(m).mul(float(0.85).add(float(0.15).mul(sin(hallLights.z.mul(2.0).add(v.hub.x.mul(0.01)))))));
    });
    If(inRange(m, 18.5, 19.5), () => { color.assign(surf.element(int(S.emit).add(int(group.add(0.5)))).xyz); });
    If(inRange(m, 10.5, 11.5), () => {
      color.addAssign(surf.element(S.glow).xyz.add(surf.element(S.glow + 1).xyz.mul(float(0.3).add(float(0.7).mul(float(1.0).sub(hallLights.y))))));
    });
    return max(color, vec3(0.0));
  };

  const k7Varyings = () => ({
    ring: varyingProperty('vec3', 'vK7Ring'),
    hub: varyingProperty('vec3', 'vK7Hub'),
    hubN: varyingProperty('vec3', 'vK7HubN'),
    n: varyingProperty('vec3', 'vK7N'),
    local: varyingProperty('vec3', 'vK7Local'),
    localN: varyingProperty('vec3', 'vK7LocalN'),
    mat: varyingProperty('float', 'vK7Mat'),
    group: varyingProperty('float', 'vK7Group'),
    blink: varyingProperty('vec3', 'vK7Blink')
  });

  // ---- instancje (dawne K7_INSTANCE_VERTEX / _FRAGMENT)
  const vi = k7Varyings();
  const instanceVertex = Fn(() => {
    const iA = attribute('iA', 'vec4');     // środek xyz, skala pionowa
    const iB = attribute('iB', 'vec4');     // rozmiar xyz, materiał
    const iQ = attribute('iQ', 'vec4');     // kwaternion
    const iC = attribute('iC', 'vec4');     // grupa
    const lp = positionGeometry.mul(iB.xyz).toVar();
    const r = haloQrot(iQ, lp).toVar();
    const hubP = iA.xyz.add(vec3(r.x, r.y.mul(iA.w), r.z)).toVar();
    const nl = normalize(normalGeometry.div(max(iB.xyz, vec3(1e-3)))).toVar();
    const nr0 = haloQrot(iQ, nl).toVar();
    const nr = vec3(nr0.x, nr0.y.div(max(iA.w, 1e-3)), nr0.z).toVar();
    const g4 = int(iC.x.add(0.5)).mul(4).toVar();
    const c0 = groups.element(g4).toVar();
    const c1 = groups.element(g4.add(1)).toVar();
    const c2 = groups.element(g4.add(2)).toVar();
    const c3 = groups.element(g4.add(3)).toVar();
    const gp = mat4(c0, c1, c2, c3).mul(vec4(hubP, 1.0)).toVar();
    const gn = normalize(mat3(c0.xyz, c1.xyz, c2.xyz).mul(nr)).toVar();
    vi.hub.assign(gp.xyz);
    vi.hubN.assign(gn);
    vi.ring.assign(hub.mul(gp).xyz);
    vi.n.assign(normalize(hub3.mul(gn)));
    vi.local.assign(lp);
    vi.localN.assign(normalGeometry);
    vi.mat.assign(iB.w);
    vi.group.assign(iC.x);
    vi.blink.assign(iC.yzw);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(gp));
  })();
  const instanceFragment = Fn(() => {
    const m = floor(vi.mat.add(0.5)).toVar();
    const localN = vec3(vi.localN).toVar();
    const local = vec3(vi.local).toVar();
    const kn = abs(localN).toVar();
    const fuv = kn.y.greaterThan(0.55).select(local.xz, kn.x.greaterThan(0.55).select(local.zy, local.xy)).toVar();
    const fw = fwidth(fuv.x).add(fwidth(fuv.y)).toVar();
    const c = k7Shade(vi, k7Palette(m), m, normalize(vi.hubN), fuv, fw, vi.group).toVar();
    // soczewka światła hali: emisja z kodu migania (haloPortK7Lights.js), zgaszona — ciemne szkło w barwie światła
    const blink = vec3(vi.blink).toVar();
    If(blink.x.greaterThan(0.5), () => {
      const lvl = k7BeaconLevelTSL(blink.x, hallLights.w, blink.y, blink.z);
      c.assign(k7BeaconColorTSL(blink.x).mul(float(0.012).add(lvl)));
    });
    return vec4(c, roofOpacity);
  })();

  // ---- pokład, fartuchy, dach (dawne K7_PLATE_VERTEX / _FRAGMENT)
  const vp = k7Varyings();
  const plateVertex = Fn(() => {
    const aMat = attribute('aMat', 'float');
    const position = positionGeometry;
    const normal = normalGeometry;
    vp.hub.assign(position);
    vp.hubN.assign(normal);
    vp.ring.assign(hub.mul(vec4(position, 1.0)).xyz);
    vp.n.assign(normalize(hub3.mul(normal)));
    vp.local.assign(position);
    vp.localN.assign(normal);
    vp.mat.assign(aMat);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1.0)));
  })();
  const plateFragment = Fn(() => {
    const m = floor(vp.mat.add(0.5)).toVar();
    const localN = vec3(vp.localN).toVar();
    const local = vec3(vp.local).toVar();
    const fuv = abs(localN.y).greaterThan(0.5).select(local.xz, abs(localN.x).greaterThan(0.5).select(local.zy, local.xy)).toVar();
    const fw = fwidth(fuv.x).add(fwidth(fuv.y)).toVar();
    const c = k7Shade(vp, k7Palette(m), m, localN, fuv, fw, float(0.0));
    return vec4(c, roofOpacity);
  })();

  // ---- napisy na pokładzie (dawne K7_LABEL_*): atlas (biały tekst w alfie), kolor per czworokąt
  const vUv = varyingProperty('vec2', 'vK7Uv');
  const vColor = varyingProperty('vec3', 'vK7Color');
  const vl = { ring: varyingProperty('vec3', 'vK7Ring'), n: varyingProperty('vec3', 'vK7N') };
  const atlas = teksturaObiektu('uAtlas', teksturaZastepcza(0, 0, 0, 0), vUv);
  const labelVertex = Fn(() => {
    const position = positionGeometry;
    vUv.assign(attribute('uv', 'vec2'));
    vColor.assign(attribute('aColor', 'vec3'));
    vl.ring.assign(hub.mul(vec4(position, 1.0)).xyz);
    vl.n.assign(normalize(hub3.mul(normalGeometry)));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1.0)));
  })();
  const labelFragment = Fn(() => {
    const a = atlas.a.toVar();
    If(a.lessThan(0.02), () => { Discard(); });
    const N = normalize(vl.n).toVar();
    const ring = vec3(vl.ring).toVar();
    const sunVis = H.haloSunVisibility(ring.add(N.mul(2.0)), U.uSunDir).toVar();
    const NdL = max(dot(N, U.uSunDir), 0.0);
    const amb = vec3(0.05, 0.056, 0.066).add(H.haloPlanetshine(ring, N));
    const col = vec3(vColor).mul(U.uSunColor.mul(sunVis).mul(NdL).add(amb)).mul(0.9).toVar();
    return vec4(col.mul(a), a);
  })();

  // ---- węże paliwowe (dawne K7_HOSE_*): rura z żebrami gumy (tekstura K-7: pierścienie co 1/16)
  const vhUv = varyingProperty('vec2', 'vK7Uv');
  const vh = { ring: varyingProperty('vec3', 'vK7Ring'), n: varyingProperty('vec3', 'vK7N') };
  const hoseVertex = Fn(() => {
    const position = positionGeometry;
    vhUv.assign(attribute('uv', 'vec2'));
    vh.ring.assign(hub.mul(vec4(position, 1.0)).xyz);
    vh.n.assign(normalize(hub3.mul(normalGeometry)));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1.0)));
  })();
  const hoseColor = srgb(0x565b58).map(r4);
  const hoseFragment = Fn(() => {
    const N = normalize(vh.n).toVar();
    const ring = vec3(vh.ring).toVar();
    const V = normalize(U.uCamLocal.sub(ring)).toVar();
    const uvh = vec2(vhUv).toVar();
    const rib = step(0.75, fract(uvh.y.mul(16.0)));
    const braid = step(0.9, fract(uvh.x.add(uvh.y.mul(2.0)).mul(16.0)));
    const albedo = vec3(...hoseColor).mul(mix(1.0, 0.45, rib)).mul(mix(1.0, 1.2, braid)).mul(0.8).toVar();
    const sunVis = H.haloSunVisibility(ring.add(N.mul(2.0)), U.uSunDir).toVar();
    const NdL = max(dot(N, U.uSunDir), 0.0);
    const Hv = normalize(U.uSunDir.add(V));
    const spec = pow(max(dot(N, Hv), 0.0), 24.0).mul(0.08).toVar();
    const amb = vec3(0.05, 0.056, 0.066).add(H.haloPlanetshine(ring, N));
    const col = albedo.mul(U.uSunColor.mul(sunVis).mul(NdL).add(amb)).add(U.uSunColor.mul(sunVis).mul(spec));
    return vec4(col, 1.0);
  })();

  G = {
    instance: { vertexNode: instanceVertex, fragmentNode: instanceFragment },
    plate: { vertexNode: plateVertex, fragmentNode: plateFragment },
    label: { vertexNode: labelVertex, fragmentNode: labelFragment },
    hose: { vertexNode: hoseVertex, fragmentNode: hoseFragment },
    nodes: { hub, hallLights, roofOpacity, groups, surf, atlas }
  };
  K7_GRAPHS.set(u, G);
  return G;
}

// ---------------------------------------------------------------------------
function makeUnitCylinder() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false);
  return g;
}

function makeInstanced(base, data, sphere) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const arr = new Float32Array(data);
  const buf = new THREE.InstancedInterleavedBuffer(arr, K7_INSTANCE_STRIDE);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iQ', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 12));
  geo.instanceCount = arr.length / K7_INSTANCE_STRIDE;
  // cały kompleks (hala z pylonami i terminalem, zatoki; układ huba): obcinanie
  // przez three, gdy jest poza kadrem
  geo.boundingSphere = sphere.clone();
  return { geo, arr, buf };
}

// Obwiednia kompleksu w układzie huba z nagranych instancji (środki + zapas na bryły).
function complexSphere(sets) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const set of Object.values(sets)) {
    for (const data of Object.values(set)) {
      for (let i = 0; i < data.length; i += K7_INSTANCE_STRIDE) {
        const x = data[i];
        const z = data[i + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 1400;
  return new THREE.Sphere(new THREE.Vector3(cx, -450, cz), r);
}

// Wypukłe wielokąty wytłoczone w pionie (y = z świata), jedna geometria na zestaw.
// axis 'x': wielokąt w (z huba, y) wytłoczony wzdłuż x (np. dawny klin pod halą) — ta
// sama budowa w osiach przestawionych cyklicznie (obrót, nawinięcie zostaje).
function makePlates(plates) {
  const pos = [];
  const nor = [];
  const mat = [];
  let cyc = false;
  const perm = (v) => (cyc ? [v[1], v[2], v[0]] : v);
  const tri = (a, b, c, n, m) => {
    pos.push(...perm(a), ...perm(b), ...perm(c));
    const nn = perm(n);
    for (let i = 0; i < 3; i++) { nor.push(...nn); mat.push(m); }
  };
  for (const p of plates) {
    cyc = p.axis === 'x';
    const pts = p.points;
    const n = pts.length;
    // orientacja wielokąta w (x, z): chcemy normalne górne +y
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const ordered = area < 0 ? pts : pts.slice().reverse();
    const top = ordered.map(([x, z]) => [x, p.z1, z]);
    const bot = ordered.map(([x, z]) => [x, p.z0, z]);
    for (let i = 1; i + 1 < n; i++) {
      tri(top[0], top[i], top[i + 1], [0, 1, 0], p.mat);
      tri(bot[0], bot[i + 1], bot[i], [0, -1, 0], p.mat);
    }
    for (let i = 0; i < n; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % n];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const len = Math.hypot(ex, ez) || 1;
      const nrm = [-ez / len, 0, ex / len];
      const sideMat = p.mat === K7_MAT.floor ? K7_MAT.dark : p.mat;
      tri([a[0], p.z0, a[1]], [b[0], p.z0, b[1]], [b[0], p.z1, b[1]], nrm, sideMat);
      tri([a[0], p.z0, a[1]], [b[0], p.z1, b[1]], [a[0], p.z1, a[1]], nrm, sideMat);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  g.computeBoundingSphere();
  return g;
}

// Atlas napisów (groundText z K-7: 1024 × 140/230, pogrubiony Arial + opis mono).
function makeLabelAtlas(labels) {
  const unique = new Map();
  for (const l of labels) {
    const key = l.text + '|' + l.small;
    if (!unique.has(key)) unique.set(key, { text: l.text, small: l.small, cell: unique.size });
  }
  const cellW = 512;
  const cellH = 116;
  const cols = 4;
  const rows = Math.ceil(unique.size / cols);
  const H = Math.max(128, 2 ** Math.ceil(Math.log2(rows * cellH)));
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) return null;
  canvas.width = cellW * cols;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const u of unique.values()) {
    const cx = (u.cell % cols) * cellW;
    const cy = Math.floor(u.cell / cols) * cellH;
    const hasSmall = !!u.small;
    const h = hasSmall ? cellH : cellH * 140 / 230;
    const scale = cellW / 1024;
    g.save();
    g.translate(cx, cy);
    g.font = `700 ${Math.round(102 * scale)}px Arial`;
    g.fillText(u.text, cellW / 2, 66 * scale, 970 * scale);
    if (hasSmall) {
      g.font = `${Math.round(27 * scale)}px monospace`;
      g.fillText(u.small, cellW / 2, 177 * scale, 960 * scale);
    }
    g.restore();
    u.uv = [cx / canvas.width, 1 - (cy + h) / canvas.height, (cx + cellW) / canvas.width, 1 - cy / canvas.height];
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, unique };
}

function makeLabelMesh(labels, atlas) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  const hex = (h) => srgb(parseInt(h.replace('#', '').slice(0, 6), 16));
  for (const l of labels) {
    const u = atlas.unique.get(l.text + '|' + l.small);
    const [u0, v0, u1, v1] = u.uv;
    const c = hex(l.color);
    const base = pos.length / 3;
    const r = l.rotation || 0;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const corners = [[-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0], [0.5, 0.5, u1, v1], [-0.5, 0.5, u0, v1]];
    for (const [a, b, uu, vv] of corners) {
      const px = a * l.width;
      const py = b * l.depth;
      if (l.vertical) {
        // na dachu terminalu w habitacie: płaszczyzna (x, y świata), normalna +z huba
        pos.push(l.x + px, l.y + py, l.z);
        nor.push(0, 0, 1);
      } else {
        // PlaneGeometry: rotation.x = −π/2, potem rotation.z = r (jak w K-7)
        const x = px * cr - py * sr;
        const y = px * sr + py * cr;
        pos.push(l.x + x, l.y, l.z - y);
        nor.push(0, 1, 0);
      }
      uv.push(uu, vv);
      col.push(...c);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
export class HaloPortK7 {
  // angle — kąt kompleksu (hala K-7 w środku); index 0 = hala gracza przy kącie
  // stacji; bays — otwarte zatoki kompleksu (haloBayLayouts z ramkami)
  // style — styl doków z profilu planety (port: dach, ściany, paleta, napisy)
  constructor({ ringLayout, uniforms, layout, angle, index = 0, bays = [], style = null }) {
    this.style = style || resolveHaloProfile(ringLayout?.planetProfile).port;
    this.layout = layout;
    this.index = index;
    this.frame = k7Frame(ringLayout, angle);
    const fr = this.frame;
    // zatoki w układzie huba hali (przejście ramek) i indeks stanowisk (lampki)
    this.bays = bays.map((b) => ({ layout: b, xf: haloFrameToFrame(b.frame, fr) }));
    this.berthMap = new Map();
    for (const b of layout.berths) this.berthMap.set(b.id, b);
    for (const bay of this.bays) for (const b of bay.layout.berths) this.berthMap.set(b.id, b);
    this.root = new THREE.Group();
    this.root.name = `K-7 / Central Hub (kompleks ${index + 1})`;
    // hub (x wzdłuż, y = z świata, z promieniowo na zewnątrz) → układ ringu
    const hubM = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(fr.tx, fr.ty, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(fr.rx, fr.ry, 0)
    ).setPosition(fr.origin.x, fr.origin.y, 0);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(hubM);
    this.hubMatrix = hubM;

    const scene = buildK7Scene(layout, { floorZ: fr.floorZ, rimZ: fr.rimZ, floorR: fr.floorR, bays: this.bays, style: this.style });
    this.scene = scene;
    this.groups = scene.groups;
    this.sphere = complexSphere(scene.sets);
    // obwiednia w układzie ringu (obcinanie całego kompleksu w index.js)
    const sc = this.sphere.center;
    this.bounds = { x: fr.origin.x + sc.x * fr.tx + sc.z * fr.rx, y: fr.origin.y + sc.x * fr.ty + sc.z * fr.ry, z: sc.y, r: this.sphere.radius };
    // lampy: hali (haloPortK7Lights.js — te same oświetlają w grze pył i kadłuby) + po trzy nad każdą zatoką
    const lamps = Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, 0, 0, 0));
    const ly = k7HeightToZ(390);
    const rig = scene.rig;
    let li = 0;
    for (const L of rig.lamps) if (li < MAX_LAMPS) lamps[li++].set(L.x, k7HeightToZ(L.y), L.z, L.k7Type);
    // reflektory: pozycja + zasięg, oś + cos zewn., barwa × moc + cos wewn. (moc na pokładzie jak w siatce gry)
    const spots = Array.from({ length: MAX_SPOTS * 3 }, () => new THREE.Vector4(0, 0, 0, 0));
    rig.spots.slice(0, MAX_SPOTS).forEach((sp, i) => {
      spots[i * 3].set(sp.x, k7HeightToZ(sp.y), sp.z, sp.range);
      spots[i * 3 + 1].set(sp.dir[0], sp.dir[1], sp.dir[2], sp.cosOuter);
      spots[i * 3 + 2].set(sp.color[0] * sp.intensity * K7_SPOT_DECK_GAIN, sp.color[1] * sp.intensity * K7_SPOT_DECK_GAIN,
        sp.color[2] * sp.intensity * K7_SPOT_DECK_GAIN, sp.cosInner);
    });
    const q = {};
    for (const { layout: bl, xf } of this.bays) {
      const zc = (bl.backZ + bl.openZ) * 0.5;
      for (const lane of bl.lanes) {
        if (li >= MAX_LAMPS) break;
        haloXfPoint(xf, lane.x, zc, q);
        lamps[li++].set(q.x, ly, q.z, 1);
      }
      if (li >= MAX_LAMPS) break;
      haloXfPoint(xf, bl.aisle.x, zc + 200, q);
      lamps[li++].set(q.x, ly, q.z, 2);
    }
    const groupMats = Array.from({ length: MAX_GROUPS }, () => new THREE.Matrix4());
    const groupEmit = Array.from({ length: MAX_GROUPS }, () => new THREE.Vector3(1.2, 0.7, 0.28));
    this.k7Uniforms = {
      uHub: { value: hubM },
      uGroup: { value: groupMats },
      uGroupEmit: { value: groupEmit },
      uRoofOpacity: { value: 1 },
      uHallLights: { value: new THREE.Vector4(0.22, 1, 0, 0) },
      uLamps: { value: lamps },
      uK7Spots: { value: spots },
      uK7Pal: { value: [] },
      uK7Emit: { value: [] },
      uK7Glow: { value: [] }
    };
    const kp = k7StylePalette(this.style);
    this.k7Uniforms.uK7Pal.value = kp.pal.map((c) => new THREE.Vector3(...c));
    this.k7Uniforms.uK7Emit.value = kp.emit.map((c) => new THREE.Vector3(...c));
    this.k7Uniforms.uK7Glow.value = kp.glow.map((c) => new THREE.Vector3(...c));
    this.roofUniforms = { ...this.k7Uniforms, uRoofOpacity: { value: 1 } };
    const common = { ...uniforms, ...this.k7Uniforms };
    const commonRoof = { ...uniforms, ...this.roofUniforms };

    this._box = new THREE.BoxGeometry(1, 1, 1);
    this._cyl = makeUnitCylinder();
    this._torus = new THREE.TorusGeometry(1, 0.13, 6, 24);
    const bases = { box: this._box, cyl: this._cyl, torus: this._torus };

    // materiały hali: lekkie NodeMaterial-e na wspólnych grafach ringu (k7Graphs), wartości
    // hali w material.uniforms (podgląd jak dawniej: uniformy ringu + hali)
    const graphs = k7Graphs(uniforms);
    this._graphs = graphs;
    this.materials = [];
    const nodeMat = (name, graph, uni, state = {}) => {
      const m = haloNodeMaterial(name, graph, state, uni);
      this.materials.push(m);
      return m;
    };
    const instMat = (uni, opts = {}) => nodeMat('K7Instances', graphs.instance, uni, opts);
    this.matBg = instMat(common);
    this.matFg = instMat(common);
    this.matRoof = instMat(commonRoof, { transparent: true });
    this.meshes = { bg: [], fg: [] };
    this.instances = {};
    for (const setName of ['bg', 'fg', 'roof']) {
      for (const kind of ['box', 'cyl', 'torus']) {
        const data = scene.sets[setName][kind];
        if (!data.length) continue;
        const inst = makeInstanced(bases[kind], data, this.sphere);
        const material = setName === 'bg' ? this.matBg : setName === 'fg' ? this.matFg : this.matRoof;
        const mesh = new THREE.Mesh(inst.geo, material);
        mesh.name = `K7_${setName}_${kind}`;
        mesh.frustumCulled = true;
        this.root.add(mesh);
        this.meshes[setName === 'bg' ? 'bg' : 'fg'].push(mesh);
        this.instances[setName + '_' + kind] = inst;
        if (setName === 'roof') mesh.renderOrder = 20;
      }
    }
    // pokład, fartuchy, most / dach
    const plateMat = (uni, opts = {}) => nodeMat('K7Plates', graphs.plate, uni, opts);
    const bgPlates = scene.plates.filter((p) => p.set !== 'roof');
    const roofPlates = scene.plates.filter((p) => p.set === 'roof');
    this.platesBg = new THREE.Mesh(makePlates(bgPlates), plateMat(common));
    this.platesBg.name = 'K7_plates';
    this.platesBg.frustumCulled = true;
    this.root.add(this.platesBg);
    this.meshes.bg.push(this.platesBg);
    this.platesRoof = new THREE.Mesh(makePlates(roofPlates), plateMat(commonRoof, { transparent: true }));
    this.platesRoof.name = 'K7_roof_slab';
    this.platesRoof.frustumCulled = true;
    this.platesRoof.renderOrder = 20;
    this.root.add(this.platesRoof);
    this.meshes.fg.push(this.platesRoof);
    this.roofMaterials = [this.matRoof, this.platesRoof.material];
    // napisy
    const atlas = makeLabelAtlas(scene.labels);
    if (atlas) {
      this.atlas = atlas;
      // mieszanie (ONE, ONE_MINUS_SRC_ALPHA) z kolorem · alfa w shaderze; alfa celu tak samo
      const lm = nodeMat('K7Labels', graphs.label, { ...uniforms, ...this.k7Uniforms, uAtlas: { value: atlas.tex } }, {
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      });
      this.labels = new THREE.Mesh(makeLabelMesh(scene.labels, atlas), lm);
      this.labels.name = 'K7_labels';
      this.labels.frustumCulled = true;
      this.labels.renderOrder = 5;
      this.root.add(this.labels);
      this.meshes.bg.push(this.labels);
    }
    // obsługa paliwowa: ramiona SCARA i przewody z fizyką liny (haloPortK7Fuel.js); rura przewodów — jedna
    // geometria na wszystkie, odświeżana tylko dla przewodów w ruchu
    this.fuelRig = createK7FuelRig(layout);
    this._fuelHose = this.scene.fuel.map((st) => this.fuelRig.hoses.find((h) => h.berthId === st.berthId && h.side === st.side) || null);
    this._buildHoses();

    // stan animacji
    this._pose = new Map();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._lampState = new Map();
    this.time = 0;
    this.roofFade = 0;
    this.setServicePoses(null);
  }

  // Rura przewodów: na przewód HOSE_RINGS + 1 przekrojów po HOSE_SIDES + 1 wierzchołków (szew uv), indeksy stałe;
  // pozycje, normalne i uv (żebra jadą z materiałem przewodu — wyjeżdżają z bębna) liczone z liny co klatkę ruchu.
  _buildHoses() {
    const n = this.scene.fuel.length;
    const R = HOSE_RINGS;
    const S = HOSE_SIDES;
    const perHose = (R + 1) * (S + 1);
    this.hosePerHose = perHose;
    const count = perHose * n;
    this.hosePos = new Float32Array(count * 3);
    this.hoseNor = new Float32Array(count * 3);
    this.hoseUv = new Float32Array(count * 2);
    const idx = [];
    for (let h = 0; h < n; h++) {
      const base = h * perHose;
      for (let i = 0; i <= R; i++) {
        for (let j = 0; j <= S; j++) {
          const k = base + i * (S + 1) + j;
          if (i < R && j < S) {
            const l = k + S + 1;
            idx.push(k, k + 1, l, l, k + 1, l + 1);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.hosePos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.hoseNor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.hoseUv, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 2000), 4000);
    const m = haloNodeMaterial('K7Hoses', this._graphs.hose, {}, this.matFg.uniforms);
    this.materials.push(m);
    this.hoseMesh = new THREE.Mesh(g, m);
    this.hoseMesh.name = 'K7_hoses';
    this.hoseMesh.frustumCulled = true;
    this.root.add(this.hoseMesh);
    this.meshes.fg.push(this.hoseMesh);
    // bufory próbkowania (bez alokacji przy aktualizacji): punkty przekrojów w scenie, długości łuku węzłów
    this._hs = new Float64Array((R + 1) * 3);
    this._hl = new Float64Array(K7_HOSE_NODES);
    this._hoseVer = new Float64Array(n).fill(-1);
    this._tA = new THREE.Vector3();
    this._tN = new THREE.Vector3();
    this._tB = new THREE.Vector3();
    for (let h = 0; h < n; h++) this._writeHose(h);
    this._uploadHoses(0, n);
  }

  setLayers(bgLayer, fgLayer) {
    for (const m of this.meshes.bg) m.layers.set(bgLayer);
    for (const m of this.meshes.fg) m.layers.set(fgLayer);
  }

  setVisible(v) { this.root.visible = !!v; }

  // Rozgrzewka (zadanie 11, Core3D.warmup): dach w stanie „statek w hali” — przezroczysty, bez zapisu
  // głębi (update() przełącza go przy roofFade) — ten sam graf, drugi pipeline. { meshes, apply → przywróć }.
  roofWarmVariant() {
    const meshes = this.meshes.fg.filter((m) => m.material === this.matRoof || m === this.platesRoof);
    return {
      meshes,
      apply(mesh) {
        const m = mesh.material;
        const transparent = m.transparent;
        const depthWrite = m.depthWrite;
        m.transparent = true;
        m.depthWrite = false;
        return () => { m.transparent = transparent; m.depthWrite = depthWrite; };
      }
    };
  }

  // pozy obsługi stanowisk capital: Map berthId → { clamp, extension, seat, lock, flow, vent } (stan gry — rejestr
  // hali, fabuła, automaty); brak pozy = obsługa złożona
  setServicePoses(poses) {
    const P = this._pose;
    for (const st of this.scene.fuel) {
      const pose = poses?.get(st.berthId) ?? null;
      P.set(st.berthId, pose || K7_STOWED_POSE);
    }
  }

  // Grupy ruchome z obsługi paliwowej: człony ramienia SCARA (bark, łokieć — obrót w poziomie), trzon wysięgnika
  // (przegub złączki), złączka (położenie i oś z liny); zamki pola — emisja listew. Grupy w układzie (x, wysokość
  // sceny, z) huba: obrót wokół pionu = makeRotationY(−kąt) (kąt od +x ku +z huba).
  _updateGroups() {
    const mats = this.k7Uniforms.uGroup.value;
    const emit = this.k7Uniforms.uGroupEmit.value;
    mats[0].identity();
    const F = K7_FUEL_STATION;
    const stations = this.scene.fuel;
    for (let k = 0; k < stations.length; k++) {
      const st = stations[k];
      const h = this._fuelHose[k];
      if (!h) continue;
      const g = h.g;
      mats[st.link1].makeRotationY(-h.q1).setPosition(g.sx, 0, g.sz);
      mats[st.link2].copy(mats[st.link1]).multiply(this._m.makeTranslation(F.link1.len, 0, 0)).multiply(this._m2.makeRotationY(-h.q2));
      mats[st.rod].makeTranslation(h.wrist.x, k7HeightToZ(h.wrist.y), h.wrist.z);
      // złączka: oś Y = oś z fizyki w scenie (nad płaszczyzną lotu wysokość × K7_ABOVE_SCALE)
      const c = (K7_HOSE_NODES - 1) * 3;
      const P = h.pos;
      this._v.set(P[c], k7HeightToZ(P[c + 1]), P[c + 2]);
      this._v2.set(h.up.x, h.up.y * K7_ABOVE_SCALE, h.up.z).normalize();
      this._q.setFromUnitVectors(this._yAxis, this._v2);
      mats[st.coupler].compose(this._v, this._q, this._s);
      // barwa złączki: ciepła = luźna, cyjan = zaryglowana, zielona = przepływ, pomarańcz pulsuje przy upuście
      const pose = this._pose.get(st.berthId) || K7_STOWED_POSE;
      const e = emit[st.coupler];
      if (h.latched) {
        if ((Number(pose.vent) || 0) > 0.05) {
          const p = 0.55 + 0.45 * Math.sin(this.time * 18);
          e.set(1.3 * p, 0.42 * p, 0.06 * p);
        } else if ((Number(pose.flow) || 0) > 0.1) e.set(0.4, 1.15, 0.66);
        else e.set(0.3, 1.12, 1.28);
      } else e.set(1.28, 0.78, 0.3);
    }
    // zamki pola: listwy gasną (ciemny turkus) albo świecą, gdy zamki trzymają statek
    for (const cl of this.scene.clamps) {
      const pose = this._pose.get(cl.berthId) || K7_STOWED_POSE;
      const c = Math.min(1, Math.max(0, Number(pose.clamp) || 0));
      emit[cl.group].set(0.015 + 0.16 * c, 0.05 + 0.85 * c, 0.07 + 1.2 * c);
    }
  }

  // Rura przewodu `k` z liny (węzły k0 … złączka): długość łuku, próbki Catmull-Rom w równych odstępach, koniec
  // przycięty do lica złączki, ramki transportem równoległym (bez skręcania), wysokości → scena (k7HeightToZ).
  _writeHose(k) {
    const h = this._fuelHose[k];
    if (!h) return;
    const M = K7_HOSE_NODES;
    const P = h.pos;
    const k0 = h.k0;
    const n = M - k0;
    const Lc = this._hl;
    // długości łuku węzłów (fizyka: wysokości K-7)
    Lc[0] = 0;
    for (let i = 1; i < n; i++) {
      const a = (k0 + i - 1) * 3;
      const b = a + 3;
      Lc[i] = Lc[i - 1] + Math.sqrt((P[b] - P[a]) ** 2 + (P[b + 1] - P[a + 1]) ** 2 + (P[b + 2] - P[a + 2]) ** 2);
    }
    const trim = K7_FUEL_STATION.coupler.r * 0.9;
    const total = Math.max(1, Lc[n - 1] - trim);
    const R = HOSE_RINGS;
    const S = HOSE_SIDES;
    const Sx = this._hs;
    let seg = 0;
    for (let i = 0; i <= R; i++) {
      const s = total * i / R;
      while (seg < n - 2 && Lc[seg + 1] < s) seg++;
      const l0 = Lc[seg];
      const l1 = Lc[seg + 1];
      const t = l1 > l0 ? Math.min(1, Math.max(0, (s - l0) / (l1 - l0))) : 0;
      const i0 = k0 + Math.max(0, seg - 1);
      const i1 = k0 + seg;
      const i2 = k0 + Math.min(n - 1, seg + 1);
      const i3 = k0 + Math.min(n - 1, seg + 2);
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom (jednorodny): ogniwa mają stałą długość
      const w0 = -0.5 * t3 + t2 - 0.5 * t;
      const w1 = 1.5 * t3 - 2.5 * t2 + 1;
      const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
      const w3 = 0.5 * t3 - 0.5 * t2;
      const o = i * 3;
      for (let d = 0; d < 3; d++) {
        Sx[o + d] = w0 * P[i0 * 3 + d] + w1 * P[i1 * 3 + d] + w2 * P[i2 * 3 + d] + w3 * P[i3 * 3 + d];
      }
      Sx[o + 1] = k7HeightToZ(Sx[o + 1]);
    }
    const A = this._tA;
    const N = this._tN;
    const B = this._tB;
    const base = k * this.hosePerHose;
    const pos = this.hosePos;
    const nor = this.hoseNor;
    const uv = this.hoseUv;
    const rEnd = K7_FUEL_STATION.hoseR;
    for (let i = 0; i <= R; i++) {
      const a = Math.max(0, i - 1) * 3;
      const b = Math.min(R, i + 1) * 3;
      A.set(Sx[b] - Sx[a], Sx[b + 1] - Sx[a + 1], Sx[b + 2] - Sx[a + 2]);
      if (A.lengthSq() < 1e-8) A.set(0, 0, 1);
      A.normalize();
      if (i === 0) {
        // ramka początkowa: normalna możliwie pozioma
        N.set(-A.z, 0, A.x);
        if (N.lengthSq() < 1e-4) N.set(1, 0, 0);
      } else {
        N.addScaledVector(A, -N.dot(A));
        if (N.lengthSq() < 1e-8) N.set(-A.z, 0, A.x);
      }
      N.normalize();
      B.crossVectors(A, N).normalize();
      const o = i * 3;
      // okucia na końcach przewodu (wylot bębna, złączka)
      const rad = rEnd + (i < 3 || i > R - 3 ? 2.4 : 0);
      const v = (total - total * i / R) / HOSE_RIB;
      for (let j = 0; j <= S; j++) {
        const q = base + i * (S + 1) + j;
        const an = j / S * Math.PI * 2;
        const cc = Math.cos(an);
        const ss = Math.sin(an);
        const nx = N.x * cc + B.x * ss;
        const ny = N.y * cc + B.y * ss;
        const nz = N.z * cc + B.z * ss;
        pos[q * 3] = Sx[o] + nx * rad;
        pos[q * 3 + 1] = Sx[o + 1] + ny * rad;
        pos[q * 3 + 2] = Sx[o + 2] + nz * rad;
        nor[q * 3] = nx;
        nor[q * 3 + 1] = ny;
        nor[q * 3 + 2] = nz;
        uv[q * 2] = j / S;
        uv[q * 2 + 1] = v;
      }
    }
  }

  // Wysyłka rury przewodów [h0, h1) (zakres zbierany — bez DynamicDrawUsage).
  _uploadHoses(h0, h1) {
    if (!(h1 > h0)) return;
    const g = this.hoseMesh.geometry;
    const v0 = h0 * this.hosePerHose;
    const nv = (h1 - h0) * this.hosePerHose;
    zbierzZakres(g.attributes.position, v0 * 3, nv * 3);
    zbierzZakres(g.attributes.normal, v0 * 3, nv * 3);
    zbierzZakres(g.attributes.uv, v0 * 2, nv * 2);
  }

  // Przewody w ruchu (wersja liny zmieniona) → rura i wysyłka zmienionego wycinka.
  _updateHoses() {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < this._fuelHose.length; k++) {
      const h = this._fuelHose[k];
      if (!h || h.version === this._hoseVer[k]) continue;
      this._hoseVer[k] = h.version;
      this._writeHose(k);
      if (k < lo) lo = k;
      if (k > hi) hi = k;
    }
    if (hi >= lo) this._uploadHoses(lo, hi + 1);
  }

  // lampki stanowisk hali i zatok: stan z automatu dokowania (occupied /
  // reserved / free) — obiekty stanowisk są wspólne z logiką lotu
  setBerthLamps() {
    const inst = this.instances.bg_box;
    if (!inst) return;
    let changed = false;
    for (const lamp of this.scene.lamps) {
      const b = this.berthMap.get(lamp.berthId);
      if (!b) continue;
      const state = b.occupied ? 'o' : b.reserved ? 'r' : 'f';
      if (this._lampState.get(lamp.berthId) === state) continue;
      this._lampState.set(lamp.berthId, state);
      inst.arr[lamp.index * K7_INSTANCE_STRIDE + 7] = state === 'o' ? K7_MAT.warm : state === 'r' ? K7_MAT.cyan : K7_MAT.green;
      changed = true;
      // soczewki w narożnikach pola stanowiska: wolne — zielone mignięcia, zajęte / zarezerwowane — czerwone ciągłe
      for (const slot of this.scene.beaconSlots) {
        if (slot.berthId !== lamp.berthId) continue;
        const si = this.instances[slot.set + '_cyl'];
        if (!si) continue;
        si.arr[slot.index * K7_INSTANCE_STRIDE + 13] = state === 'f' ? K7_BEACON.CLEAR : K7_BEACON.HOLD;
        si.buf.needsUpdate = true;
      }
    }
    if (changed) inst.buf.needsUpdate = true;
  }

  // roofFade: 0 = dach nieprzezroczysty, 1 = statek w hali (dach znika)
  // clock — zegar migania świateł hali (k7BeaconClock; ten sam dostaje siatka świateł pyłu hali)
  // gameDt — czas gry klatki dla obsługi paliwowej (ramiona, przewody; pauza i sceny = 0; domyślnie dt),
  // hull — obrys kadłuba statku w hubie TEJ hali (punkty { x, z }; przewody kładą się na nim) albo null
  update(dt, { poses = null, roofFade = 0, daylight = 1, clock = null, gameDt = null, hull = null } = {}) {
    this.time += dt;
    if (poses) this.setServicePoses(poses);
    stepK7FuelRig(this.fuelRig, Number.isFinite(gameDt) ? Math.max(0, gameDt) : dt, this._pose, hull);
    this._updateGroups();
    this._updateHoses();
    const opacity = 1 - roofFade;
    this.roofUniforms.uRoofOpacity.value = opacity;
    const opaque = opacity > 0.97;
    for (const m of this.roofMaterials) {
      m.depthWrite = opaque;
      m.transparent = !opaque;
    }
    const roofVisible = opacity > 0.003;
    for (const mesh of this.meshes.fg) if (mesh.material === this.matRoof || mesh === this.platesRoof) mesh.visible = roofVisible;
    const hl = this.k7Uniforms.uHallLights.value;
    hl.x = 0.22 + 0.5 * (1 - daylight);
    hl.y = daylight;
    hl.z = this.time;
    hl.w = Number.isFinite(clock) ? clock : this.time % 3600;
  }

  get drawCalls() {
    return this.meshes.bg.length + this.meshes.fg.length;
  }

  dispose() {
    for (const m of [...this.meshes.bg, ...this.meshes.fg]) m.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this._box.dispose();
    this._cyl.dispose();
    this._torus.dispose();
    this.atlas?.tex.dispose();
  }
}

export { k7Phase };
