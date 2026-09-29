// dema/asteroidy-webgpu/coreLook.js
//
// Wygląd RDZENI skał (src/game/asteroidMaterials.js: CORE_MATERIAL) — wspólny dla
// odłamków (fragments.js) i wnętrza skał w wydobyciu (minedRocks.js), żeby bryłka
// miedzi w otworze i ta sama bryłka po wybuchu wyglądały tak samo:
//   metal    — miedź, żelazo, tytan: lity metal (połysk w barwie metalu, kute
//              garby), naloty w zagłębieniach (patyna miedzi, rdza żelaza, nalot
//              tytanu w barwach nalotowych);
//   crystal  — zbite kryształy: szkło w barwie kryształu, świeci od środka, iskry ścian;
//   ice      — czysty lód: jasny, szklisty, słaby prześwit;
//   mineral  — smółka uranowa: czarna, żyłki świecą zielenią;
//   metalloid — kryształ krzemu: ciemny, metaliczny, lustrzane ściany.
// Tabela per typ (kolejność ROCK_TYPES) w JEDNEJ tablicy uniformów (limit 12
// buforów uniform na etap), 3 wiersze na typ.

import * as THREE from 'three/webgpu';
import { float, int, vec3, uniformArray, mix, smoothstep, clamp, abs, normalize, select } from 'three/tsl';
import { hexToLinear } from './rockMaterial.js';
import { ROCK_TYPES } from '../../src/game/asteroidRockKinds.js';

export const CORE_KIND = Object.freeze({ metal: 0, crystal: 1, ice: 2, mineral: 3, metalloid: 4 });

// color: barwa (metal: barwa odbicia), color2: nalot / żyłki / poświata,
// metal 0…1, gloss (wykładnik połysku), emit (emisja HDR), patina (udział nalotu).
export const CORE_LOOK = Object.freeze({
  iron: Object.freeze({ kind: 'metal', color: '#9a958e', color2: '#6b3518', metal: 1, gloss: 70, emit: 0, patina: 0.32 }),
  copper: Object.freeze({ kind: 'metal', color: '#e8955c', color2: '#2f9a72', metal: 1, gloss: 85, emit: 0, patina: 0.42 }),
  silicon: Object.freeze({ kind: 'metalloid', color: '#5c6a7c', color2: '#b4ccee', metal: 0.8, gloss: 130, emit: 0.04, patina: 0 }),
  titan: Object.freeze({ kind: 'metal', color: '#c4cad2', color2: '#6a5fc0', metal: 1, gloss: 110, emit: 0, patina: 0.22 }),
  crystal: Object.freeze({ kind: 'crystal', color: '#86e8ff', color2: '#46cfff', metal: 0, gloss: 140, emit: 0.7, patina: 0 }),
  ice: Object.freeze({ kind: 'ice', color: '#86aecd', color2: '#7cc4ff', metal: 0, gloss: 150, emit: 0.05, patina: 0 }),
  uran: Object.freeze({ kind: 'mineral', color: '#25271e', color2: '#6ef04e', metal: 0.25, gloss: 45, emit: 1.3, patina: 0 }),
  rock: Object.freeze({ kind: 'mineral', color: '#77716a', color2: '#77716a', metal: 0, gloss: 20, emit: 0, patina: 0 }),
  energy: Object.freeze({ kind: 'crystal', color: '#b7a2ff', color2: '#8a3cff', metal: 0, gloss: 120, emit: 1.0, patina: 0 })
});

/** Tablica uniformów wyglądu rdzeni: typ t → wiersze t·3 + (0: barwa, metal; 1: gloss, emit, rodzaj, nalot; 2: barwa 2). */
export function createCoreLookArray() {
  const rows = [];
  const lin = new THREE.Vector3();
  for (const id of ROCK_TYPES) {
    const L = CORE_LOOK[id] || CORE_LOOK.rock;
    hexToLinear(L.color, lin);
    rows.push(new THREE.Vector4(lin.x, lin.y, lin.z, L.metal));
    rows.push(new THREE.Vector4(L.gloss, L.emit, CORE_KIND[L.kind] ?? 3, L.patina));
    hexToLinear(L.color2, lin);
    rows.push(new THREE.Vector4(lin.x, lin.y, lin.z, 1));
  }
  return uniformArray(rows, 'vec4');
}

/**
 * TSL (wklejane, bez setLayout): powierzchnia rdzenia typu `type` (węzeł int).
 * n1, n2 — próbki objętości szumu (vec4, 0…1) w dwóch skalach, N — normalna
 * (jednostkowa, świat), cav — zagłębienie 0…1 (naloty), facet — 0…1 siła iskier
 * ścian kryształu. Zwraca { albedo, metal, gloss, emit, N, specK }.
 */
export function coreSurface(look, type, n1, n2, N, cav = float(0.5)) {
  const row0 = look.element(type.mul(3)).toVar();
  const row1 = look.element(type.mul(3).add(1)).toVar();
  const row2 = look.element(type.mul(3).add(2)).rgb.toVar();
  const kind = int(row1.z.add(0.5)).toVar();
  const isMetal = kind.equal(int(CORE_KIND.metal));
  const isCrystal = kind.equal(int(CORE_KIND.crystal));
  const isIce = kind.equal(int(CORE_KIND.ice));
  const isMineral = kind.equal(int(CORE_KIND.mineral));
  // Metal: kute garby (drobny relief normalnej z gładkich pól — bez komórek Worleya, które
  // robiły „kropki”), nalot plamami w zagłębieniach.
  const hammer = select(isMetal, float(0.3), select(isCrystal.or(kind.equal(int(CORE_KIND.metalloid))), float(0.5), float(0.18)));
  const Nn = normalize(N.add(vec3(n2.r, n2.g, n2.a).sub(0.5).mul(hammer))).toVar();
  const patinaMask = smoothstep(0.56, 0.7, n1.g.mul(0.45).add(n1.a.mul(0.3)).add(cav.mul(0.35))).mul(row1.w).toVar();
  const albedo = row0.rgb.mul(n1.r.mul(0.3).add(0.85)).toVar();
  albedo.assign(mix(albedo, row2.mul(0.8), patinaMask));
  const metal = row0.w.mul(float(1.0).sub(patinaMask)).toVar();
  const gloss = mix(row1.x, float(24.0), patinaMask).toVar();
  // Emisja: kryształ świeci od środka (mocniej ze ścian odwróconych od kamery), smółka
  // uranu — żyłkami, lód — słaby prześwit.
  const inner = clamp(float(1.0).sub(abs(Nn.z)).mul(0.6).add(0.4), 0.0, 1.0);
  // Żyłki smółki: rzadkie, cienkie (poziomica grubszego pola) — bryła ma być czarna.
  const vein = float(1.0).sub(smoothstep(0.0, 0.035, abs(n1.r.sub(0.5)))).toVar();
  const emitK = select(isCrystal, inner.mul(n1.r.mul(0.5).add(0.6)),
    select(isMineral, vein.mul(1.3).add(0.02), select(isIce, float(0.35), float(0.0))));
  const emit = row2.mul(row1.y).mul(emitK).toVar();
  // Połysk szkła (kryształ, lód) mocniejszy niż skały — iskry ścian.
  const specK = select(isCrystal.or(isIce), float(0.6), select(isMetal, float(0.0), float(0.35)));
  return { albedo, metal, gloss, emit, N: Nn, specK, kind };
}

/** Rodzaj wyglądu rdzenia rudy (kształt odłamka w fragments.js). */
export function coreLookKind(oreTypeId) {
  return (CORE_LOOK[oreTypeId] || CORE_LOOK.rock).kind;
}
