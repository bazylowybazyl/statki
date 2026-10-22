// Elektrownia geotermalna „KOREK” w wielkim gryzie Ziemi — materiały TSL brył (geometria: earthBitePlant*.js).
//   • metal — korek, obudowa dziury, kotwice wind, odbiornik, sprzęt promienia: CZARNA MEGASTRUKTURA (albedo 0,03–0,05,
//     anodowana); rodzaj powierzchni z atrybutu `aPart` (PART w earthBitePlantFrame.js: kadłub, stal, okna, listwy,
//     cewki, żar, światła pozycyjne, szkło). Czytelność daje światło: krawędzie płyt łapiące słońce, żar jeziora od dołu
//     i z boków, poświata promienia przy osi, odblask nieba za dnia; emisja wg rodzaju (szwy pod progiem bloomu, światła
//     i cewki — HDR).
//   • przepływ — pancerne przewody energii (opaski, pakiety energii wzdłuż drogi) i liny wind (światła prowadzące).
// Model światła i rzut pudełkowy — earthBitePlantCommon.tsl.js (wspólne z dodatkami komponentów). Mikro-detal w trzech
// skalach (płyty ~0,004 R, podpanele ~0,0012 R, rowki ~0,0004 R) we współrzędnych WALCOWYCH ramy (niezależnie od
// orientacji części), drobniejszy niż piksel gaśnie do średniej — z daleka bez migotania; z daleka zostaje rytm świateł
// (koncentryczne rzędy lamp na pokładach, poziome na ścianach).
// Graf RAZ na rodzaj materiału, wartości per obiekt w `material.uniforms`. Pochodne i maska słońca — na początku Fn
// (jawne przypisanie, pułapki 15, 29); rodzaje mieszane maskami (bez rozgałęzień na rodzaj).
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, varying, positionLocal, normalLocal, uv, modelWorldMatrix,
  abs, atan, clamp, cross, dFdx, dFdy, dot, exp, floor, fract, fwidth, length, max, min, mix, normalize, select, sign, sin,
  smoothstep
} from 'three/tsl';
import { sunVisibility } from './sunShadowMask.js';
import { PART } from './earthBitePlantFrame.js';
import {
  PLANT_COLORS, perObjectUniforms, sdown, step01, aaLine, partVarying, partKind, hash12, lodFade, aaBox, aaDot,
  plantHeat, plantLightContext, plantLighting, plantBoxUv, plantVar
} from './earthBitePlantCommon.tsl.js';

const TAU = Math.PI * 2;

/** 1 dla rodzaju k, 0 dla innych (rodzaj zaokrąglony — stały na trójkącie). */
const kindMask = (kind, k) => max(float(0.0), float(1.0).sub(abs(kind.sub(k))));

/** a2 = α² z chropowatości r (α = r²) + poszerzenie odblasku przy zmiennej normalnej w pikselu (bez iskrzenia z daleka). */
const roughA2 = (r, nPix) => clamp(r.mul(r).mul(r).mul(r).add(nPix.mul(nPix).mul(0.6)), 0.002, 1.0);

// ── Mikro-detal kadłuba: płyty (S1), podpanele (S2), rowki (S3), skosy krawędzi, rzędy świateł ───────────────────────
function hullPlates(q, pix, seed, time) {
  // płyty prostokątne, rzędy przesunięte (cegiełka); połowa części — płyty „obrócone” (pion ↔ poziom)
  const flip = step01(fract(seed.mul(7.31)), 0.5);
  const S = plantVar(mix(vec2(0.0048, 0.0032), vec2(0.0032, 0.0048), flip), 'vec2');
  const sv = plantVar(vec2(seed.mul(131.0), seed.mul(57.0)), 'vec2');
  const row = plantVar(floor(q.y.div(S.y)));
  const qx = plantVar(q.x.add(hash12(vec2(row, sv.x)).mul(S.x)));
  const c1 = plantVar(vec2(qx, q.y).div(S), 'vec2');
  const id1 = plantVar(floor(c1), 'vec2');
  const f1 = plantVar(fract(c1), 'vec2');
  const h1 = plantVar(hash12(id1.add(sv)));
  const h1b = plantVar(hash12(id1.add(sv).add(vec2(41.3, 17.9))));
  // podpanele: płyta dzielona na 1–3 × 1–2 (szwy wyrównane z płytą)
  const nSub = plantVar(vec2(floor(h1b.mul(2.99)).add(1.0), floor(fract(h1b.mul(7.3)).mul(1.99)).add(1.0)), 'vec2');
  const c2 = plantVar(f1.mul(nSub), 'vec2');
  const f2 = plantVar(fract(c2), 'vec2');
  const h2 = plantVar(hash12(id1.mul(3.0).add(floor(c2)).add(sv).add(19.7)));
  const sub = plantVar(S.div(nSub), 'vec2');
  // odległości od krawędzi [R]
  const e1v = plantVar(min(f1, float(1.0).sub(f1)).mul(S), 'vec2');
  const e1 = plantVar(min(e1v.x, e1v.y));
  const e2v = plantVar(min(f2, float(1.0).sub(f2)).mul(sub), 'vec2');
  const e2 = min(e2v.x, e2v.y);
  const lod1 = plantVar(lodFade(pix, min(S.x, S.y)));
  const lod2 = plantVar(lodFade(pix, min(sub.x, sub.y)));
  const lod3 = plantVar(lodFade(pix, 0.0004));
  // szwy wklęsłe (ciemne, matowe): płyty i podpanele
  const seam1 = plantVar(aaLine(e1, float(0.00009), pix).mul(lod1));
  const seam2 = plantVar(aaLine(e2, float(0.00005), pix).mul(lod2));
  // skos krawędzi płyty: normalna odchyla się ku najbliższej krawędzi (łapie słońce) + lekkie przekoszenie płyt
  const dir = select(e1v.x.lessThan(e1v.y), vec2(sign(f1.x.sub(0.5)), 0.0), vec2(0.0, sign(f1.y.sub(0.5))));
  const bevel = sdown(0.0, 0.00026, e1).mul(lodFade(pix, 0.0007));
  const tilt = plantVar(dir.mul(bevel.mul(0.5)).add(vec2(h1.sub(0.5), h1b.sub(0.5)).mul(lod1.mul(0.045))), 'vec2');
  // rowki (S3) na części podpaneli — wzdłuż u albo v; luki serwisowe ciemniejsze
  const gAxis = step01(h2, 0.84);
  const gc = mix(q.y, qx, gAxis).div(0.0004);
  const groove = plantVar(aaLine(abs(fract(gc).sub(0.5)).mul(0.0004), float(0.00005), pix).mul(lod3).mul(step01(h2, 0.62)));
  const hatch = plantVar(step01(h2, 0.46).mul(float(1.0).sub(step01(h2, 0.53))).mul(lod2));
  // pasy anodowania co ~0,012 R (z daleka: koncentryczne pierścienie tonu na pokładach)
  const macro = hash12(vec2(floor(q.y.div(0.012)), sv.y.add(5.0)));
  const tone = plantVar(mix(1.0, float(0.86).add(h1.mul(0.28)), lod1).mul(float(0.92).add(hash12(vec2(sv.x, 9.1)).mul(0.16)))
    .mul(float(1.0).add(h2.sub(0.5).mul(0.12).mul(lod2)))
    .mul(float(1.0).sub(hatch.mul(0.25)))
    .mul(mix(1.0, float(0.9).add(macro.mul(0.2)), lodFade(pix, 0.012)))
    .mul(float(1.0).sub(seam1.mul(0.75)).sub(seam2.mul(0.5)).sub(groove.mul(0.3))));
  const rough = plantVar(mix(0.54, float(0.46).add(h1.mul(0.16)), lod1).add(h2.sub(0.5).mul(0.12).mul(lod2))
    .add(seam1.mul(0.25)).add(groove.mul(0.15)));
  // rzadkie płyty bez powłoki (mocniejszy odblask)
  const f0 = plantVar(float(0.045).add(step01(h1, 0.93).mul(lod1).mul(0.05)));
  // RZĘDY ŚWIATEŁ: szew co 6 rzędów płyt (część pominięta) — świeci pod progiem, lampy co 0,0055 R (HDR)
  const seamI = plantVar(floor(q.y.div(S.y).add(0.5)));
  const dv = plantVar(q.y.sub(seamI.mul(S.y)));
  const rowOn = plantVar(float(1.0).sub(step01(fract(seamI.add(floor(seed.mul(6.0))).div(6.0)), 0.08))
    .mul(step01(hash12(vec2(seamI, sv.y.add(3.3))), 0.22)));
  const glowSeam = plantVar(aaLine(abs(dv), float(0.00007), pix).mul(rowOn));
  const lampI = floor(q.x.div(0.0055));
  const lu = fract(q.x.div(0.0055)).sub(0.5).mul(0.0055);
  const hl = plantVar(hash12(vec2(lampI, seamI.add(7.0))));
  const red = plantVar(step01(hl, 0.82));
  const bx = plantVar(fract(time.mul(0.35).add(hl.mul(5.0))));
  const blink = mix(1.0, smoothstep(0.0, 0.04, bx).mul(sdown(0.3, 0.42, bx)).mul(0.9).add(0.1), red);
  const lamp = plantVar(aaDot(length(vec2(lu, dv)), 0.0002, pix).mul(rowOn).mul(blink));
  const lampCol = plantVar(mix(vec3(3.6, 3.0, 2.2), vec3(4.0, 0.4, 0.16), red), 'vec3');
  const hv = plantVar(mix(0.5, h1, lod1));
  return { tone, rough, f0, tilt, occ: plantVar(float(1.0).sub(seam1.mul(0.8))), glowSeam, lamp, lampCol, hv, seam: seam1 };
}

// ── Stal konstrukcyjna: szczotkowanie (smugi wzdłuż u), drobne żebrowanie, bez szwów i okien ─────────────────────────
function structDetail(q, pix, seed) {
  const streak = (scale, k) => {
    const sv = plantVar(q.y.div(scale).add(seed.mul(53.0 * k)));
    const i = plantVar(floor(sv));
    const fr = plantVar(fract(sv));
    const sm = fr.mul(fr).mul(float(3.0).sub(fr.mul(2.0)));
    return mix(0.5, mix(hash12(vec2(i, k)), hash12(vec2(i.add(1.0), k)), sm), lodFade(pix, scale * 2.5));
  };
  const st = plantVar(streak(0.00011, 3.1).mul(0.5).add(streak(0.00037, 7.7).mul(0.5)));
  const rx = plantVar(fract(q.x.div(0.0009).add(seed.mul(3.7))));
  const lodR = plantVar(lodFade(pix, 0.0009));
  const valley = plantVar(aaLine(min(rx, float(1.0).sub(rx)).mul(0.0009), float(0.00006), pix).mul(lodR));
  const part = float(0.5).add(hash12(vec2(seed.mul(71.0), 2.2)).mul(0.25));
  const tone = part.mul(float(0.8).add(st.mul(0.4))).mul(float(1.0).sub(valley.mul(0.45)));
  const rough = float(0.34).add(st.mul(0.3)).add(valley.mul(0.15));
  return { tone: plantVar(tone), rough: plantVar(rough), tilt: plantVar(vec2(sin(rx.mul(TAU)).mul(0.22).mul(lodR), 0.0), 'vec2') };
}

// ── Okna-szczeliny: rzędy ~0,0005 R w blokach (4 rzędy × 4 okna = pomieszczenie, zapalone wg gęstości z), przeważnie
// bursztynowe, co ósmy blok chłodny. Każdy czynnik (wiersz, kolumna, okno, blok) gaśnie do swojej średniej osobno, gdy
// jest drobniejszy niż ~2 px — z bliska szczeliny, dalej rzędy i bloki, z daleka równa poświata pasa.
function windowSlots(q, pix, seed, dens) {
  const rowH = 0.0005;
  const colW = 0.0011;
  const wv = plantVar(q.y.div(rowH));
  const row = plantVar(floor(wv));
  const blockRow = plantVar(floor(row.mul(0.25)));
  const wu = plantVar(q.x.div(colW).add(hash12(vec2(blockRow, seed.mul(41.0))).mul(8.0)));
  const col = plantVar(floor(wu));
  const lodV = plantVar(sdown(0.25, 0.5, pix.div(rowH)));
  const lodU = plantVar(sdown(0.25, 0.5, pix.div(colW)));
  const lodB = plantVar(sdown(0.25, 0.5, pix.div(rowH * 4.0)));
  const lodW = min(lodU, lodV);
  const slotV = mix(0.26, aaBox(abs(fract(wv).sub(0.5)).mul(rowH), rowH * 0.13, pix), lodV);
  const slotU = mix(0.6, aaBox(abs(fract(wu).sub(0.5)).mul(colW), colW * 0.3, pix), lodU);
  const slot = plantVar(slotV.mul(slotU));
  const hb = plantVar(hash12(vec2(blockRow.add(seed.mul(17.0)), floor(col.mul(0.25)))));
  const blockLit = mix(dens, step01(dens, hb), lodB);
  // okno w zapalonym bloku: 85% zapalonych, jasność 0,65–1,35
  const hw = plantVar(hash12(vec2(row.mul(1.7), col.add(seed.mul(23.0)))));
  const winLit = mix(0.85, float(1.0).sub(step01(hw, 0.85)).mul(float(0.65).add(fract(hw.mul(13.7)).mul(0.7))), lodW);
  const amber = vec3(1.0, 0.5, 0.2);
  const cool = vec3(0.62, 0.8, 1.0);
  const tint = mix(mix(amber, cool, 0.125), mix(amber, cool, step01(fract(hb.mul(7.9)), 0.875)), lodB);
  return { slot, emit: plantVar(tint.mul(slot.mul(blockLit).mul(winLit)), 'vec3') };
}

// ── Metal: korek, obudowa, kotwice, odbiornik ──────────────────────────────────────────────────────────────────────
function buildMetalGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  const vLocal = varying(positionLocal, 'vPlantLocal');
  const vNormal = varying(normalLocal, 'vPlantNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vPlantWorld');
  const vPart = partVarying();
  const fragmentNode = Fn(() => {
    // pochodne i maska słońca PRZED gałęziami (jawne przypisanie)
    const pix = float(0.0).toVar();
    pix.assign(max(length(fwidth(vLocal)), 1e-7));
    const nPix = float(0.0).toVar();
    nPix.assign(length(fwidth(vNormal)));
    const sunVisP = float(1.0).toVar();
    sunVisP.assign(mix(1.0, sunVisibility(), U.uSunShadowRecv));
    const p = plantVar(vLocal, 'vec3');
    const n0 = plantVar(vNormal.div(max(length(vNormal), 1e-6)), 'vec3');
    const C = plantLightContext(U, p, vWorld, sunVisP);
    const time = U.uPlantTime;
    const kind = plantVar(partKind(vPart));
    const seed = plantVar(vPart.y);
    const kHull = plantVar(kindMask(kind, PART.HULL));
    const kStruct = plantVar(kindMask(kind, PART.STRUCT));
    const kWin = plantVar(kindMask(kind, PART.WINDOW));
    const kGlass = plantVar(kindMask(kind, PART.GLASS));
    const kHot = plantVar(kindMask(kind, PART.HOT));
    const kPlate = plantVar(kHull.add(kWin).add(kHot));
    const zOr = (d) => select(vPart.z.greaterThan(0.0), vPart.z, float(d));
    const wOr = (d) => select(vPart.w.greaterThan(0.0), vPart.w, float(d));

    // rzut pudełkowy (walcowy) i detal
    const B = plantBoxUv(C, n0, seed);
    const H = hullPlates(B.uv, pix, seed, time);
    const S = structDetail(B.uv, pix, seed);
    const W = windowSlots(B.uv, pix, seed, zOr(0.5));
    const kOther = plantVar(float(1.0).sub(kPlate).sub(kStruct).sub(kGlass));
    const winGlass = plantVar(W.slot.mul(kWin));
    // brud i sadza (~0,011 R, plamy szumu wartości; przy jeziorze ciemniej) — kadłub i stal, z daleka zostaje
    const gq = B.uv.div(0.011).add(seed.mul(5.3));
    const gi = plantVar(floor(gq), 'vec2');
    const gf = fract(gq);
    const gs = plantVar(gf.mul(gf).mul(float(3.0).sub(gf.mul(2.0))), 'vec2');
    const vn = mix(mix(hash12(gi), hash12(gi.add(vec2(1.0, 0.0))), gs.x),
      mix(hash12(gi.add(vec2(0.0, 1.0))), hash12(gi.add(vec2(1.0, 1.0))), gs.x), gs.y);
    const grime = plantVar(smoothstep(0.45, 0.9, vn).mul(0.14).mul(lodFade(pix, 0.011))
      .add(clamp(C.lakeE.mul(0.06), 0.0, 0.22)).mul(kPlate.add(kStruct)));
    const tone = plantVar(H.tone.mul(kPlate.mul(0.85)).add(S.tone.mul(kStruct)).add(kOther.mul(0.8)).add(kGlass.mul(0.3))
      .mul(float(1.0).sub(winGlass.mul(0.7))).mul(float(1.0).sub(grime)));
    const rough = H.rough.mul(kPlate).add(S.rough.mul(kStruct)).add(kOther.mul(0.45)).add(kGlass.mul(0.07)).add(grime.mul(0.5));
    const roughW = plantVar(mix(rough, 0.1, winGlass));
    const f0 = plantVar(H.f0.mul(kPlate).add(kStruct.mul(0.05)).add(kOther.mul(0.045)).add(kGlass.mul(0.06)));
    const tilt = plantVar(H.tilt.mul(kPlate).add(S.tilt.mul(kStruct)), 'vec2');
    const n = plantVar(normalize(n0.add(B.tu.mul(tilt.x)).add(B.tv.mul(tilt.y))), 'vec3');
    const albedo = vec3(...T.metal).mul(tone);
    const specOcc = mix(1.0, H.occ, kPlate);
    const col = plantVar(plantLighting(C, n, albedo, roughA2(roughW, nPix), f0, specOcc), 'vec3');

    // szkło (i szyby okien): odbicie nieba, żaru i promienia z Fresnelem
    const R = C.V.negate().sub(n.mul(dot(n, C.V.negate()).mul(2.0)));
    const fc = float(1.0).sub(max(dot(n, C.V), 0.0));
    const fc2 = fc.mul(fc);
    const fr = float(0.05).add(fc2.mul(fc2).mul(fc).mul(0.95));
    const rb = max(dot(R, C.beamDir), 0.0);
    const rb4 = rb.mul(rb).mul(rb).mul(rb);
    const rb16 = rb4.mul(rb4).mul(rb4).mul(rb4);
    const glassEnv = vec3(...T.sky).mul(C.day.mul(mix(1.0, 0.15, C.bowl)).mul(smoothstep(-0.1, 0.5, dot(R, C.up))).mul(0.7))
      .add(vec3(...T.lava).mul(C.lakeE.mul(max(dot(R, C.lakeDir), 0.0)).mul(0.12)))
      .add(vec3(...T.beam).mul(C.beamE.mul(rb16).mul(0.08)));
    col.addAssign(glassEnv.mul(fr).mul(kGlass.add(winGlass)));

    // KADŁUB: świecące szwy rzędów świateł (pod progiem bloomu; ciepłe w gryzie, chłodne na orbicie) i lampy
    const seamCol = mix(vec3(0.42, 0.75, 1.0).mul(0.36), vec3(1.0, 0.5, 0.17).mul(0.42), C.bowl);
    col.addAssign(seamCol.mul(H.glowSeam).add(H.lampCol.mul(H.lamp)).mul(kHull));
    // OKNA: nocą świecą, w pełnym słońcu przygasają (dominuje odblask szyby)
    col.addAssign(W.emit.mul(float(1.0).sub(C.lit.mul(0.6))).mul(1.5).mul(kWin));
    // LISTWA: z — jasność, w — 0 ciepła / 1 chłodna (chłodna z wolnym przepływem); segmenty co 0,0025 R
    const su = fract(B.uv.x.div(0.0025));
    const seg = aaLine(min(su, float(1.0).sub(su)).mul(0.0025), float(0.00008), pix).mul(lodFade(pix, 0.0025));
    const coolF = step01(vPart.w, 0.5);
    const flowS = mix(1.0, sin(B.uv.x.div(0.012).sub(time.mul(0.35)).mul(TAU)).mul(0.22).add(0.82), coolF);
    const strip = mix(vec3(2.2, 1.2, 0.45), vec3(0.9, 1.9, 3.0), coolF).mul(zOr(1.0)).mul(flowS).mul(float(1.0).sub(seg.mul(0.75)));
    col.addAssign(strip.mul(kindMask(kind, PART.STRIP)));
    // CEWKA: puls z fazą z, uzwojenia (jaśniejsze linie w poprzek); w = −1 — wskaźnik magazynu (jasność wg naładowania,
    // szybszy puls przy przekazie)
    const store = vPart.w.lessThan(-0.5);
    const coilRate = select(store, mix(1.2, 6.0, U.uPlantState.x), float(3.0));
    const coilPulse = float(0.75).add(sin(time.mul(coilRate).sub(vPart.z.mul(TAU))).mul(0.25));
    const coilGain = select(store, U.uPlantState.y.mul(U.uPlantState.y).mul(1.6).add(0.08), wOr(1.0));
    const cu = fract(B.uv.x.div(0.0007));
    const wind = mix(0.34, aaLine(min(cu, float(1.0).sub(cu)).mul(0.0007), float(0.00012), pix), lodFade(pix, 0.0007));
    // ciało cewki — cyjan energii, uzwojenia — biel rdzenia (HDR)
    const coil = mix(vec3(...T.beam).mul(0.6), vec3(...T.beamCore).mul(4.5), wind).mul(coilPulse.mul(coilGain).mul(U.uPlantBeam.x));
    col.addAssign(coil.mul(kindMask(kind, PART.COIL)));
    // ŻAR: rampa ciała doskonale czarnego wg z (per wierzchołek), lekkie falowanie
    // (płyty żaru: każda trochę inna temperatura, szwy chłodniejsze)
    const wave = sin(B.uv.x.mul(900.0).add(time.mul(0.8))).mul(sin(B.uv.y.mul(700.0).sub(time.mul(0.6))));
    const heatT = vPart.z.mul(float(0.92).add(H.hv.mul(0.16)).add(wave.mul(0.05)));
    col.addAssign(plantHeat(heatT).mul(float(1.0).sub(H.seam.mul(0.6))).mul(kHot));
    // ŚWIATŁO POZYCYJNE: ostre mrugnięcie (z — częstotliwość, faza z ziarna), w — 0 czerwone / 1 białe
    const bx = fract(time.mul(zOr(0.5)).add(seed.mul(7.7)));
    const flash = smoothstep(0.0, 0.01, bx).mul(exp(bx.mul(-28.0))).mul(6.0).add(0.06);
    const beacon = mix(vec3(1.0, 0.09, 0.04), vec3(1.0, 0.96, 0.88), step01(vPart.w, 0.5)).mul(flash);
    col.addAssign(beacon.mul(kindMask(kind, PART.BEACON)));
    // GARDZIEL wylotu: ściany zwrócone ku osi świecą barwą promienia — cyjan przy krawędzi, biel w głębi
    const apR = U.uPlantCork.w;
    const apH = U.uPlantCork.z;
    const throat = sdown(apR.mul(1.02), apR.mul(1.7), C.rho).mul(sdown(apH.sub(0.004), apH.add(0.002), C.y)).mul(C.bowl)
      .mul(max(dot(n, C.out.negate()), 0.0).mul(0.7).add(0.3));
    const deep = sdown(0.0, apH, C.y);
    col.addAssign(mix(vec3(...T.beam).mul(0.6), vec3(...T.beamCore).mul(2.2), deep.mul(deep)).mul(throat.mul(U.uPlantBeam.x)));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { fragmentNode };
}

// ── Przepływ: pancerne przewody energii i liny wind ────────────────────────────────────────────────────────────────
function buildFlowGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  const vLocal = varying(positionLocal, 'vFlowLocal');
  const vNormal = varying(normalLocal, 'vFlowNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vFlowWorld');
  const vPart = partVarying('vFlowPart');
  const vUv = uv();
  const fragmentNode = Fn(() => {
    const pix = float(0.0).toVar();
    pix.assign(max(length(fwidth(vLocal)), 1e-7));
    const nPix = float(0.0).toVar();
    nPix.assign(length(fwidth(vNormal)));
    const sunVisP = float(1.0).toVar();
    sunVisP.assign(mix(1.0, sunVisibility(), U.uSunShadowRecv));
    // kierunek osi przewodu: gradient uv.y na powierzchni z pochodnych ekranowych (też przed gałęziami)
    const dpx = plantVar(dFdx(vLocal), 'vec3');
    const dpy = plantVar(dFdy(vLocal), 'vec3');
    const dvx = plantVar(dFdx(vUv.y));
    const dvy = plantVar(dFdy(vUv.y));
    const p = plantVar(vLocal, 'vec3');
    const n = plantVar(vNormal.div(max(length(vNormal), 1e-6)), 'vec3');
    const C = plantLightContext(U, p, vWorld, sunVisP);
    const time = U.uPlantTime;
    const kTether = plantVar(kindMask(partKind(vPart), PART.TETHER));
    const s = plantVar(vUv.y.mul(max(vPart.z, 1e-4)));
    const dirW = select(vPart.w.lessThan(0.0), float(-1.0), float(1.0));
    // PRZEWÓD: pancerne opaski co 0,01 R (z daleka — średnia), pakiety energii z ostrym czołem i miękkim ogonem
    const bs = fract(s.div(0.01));
    const collar = mix(0.14, aaBox(min(bs, float(1.0).sub(bs)).mul(0.01), 0.0007, pix), lodFade(pix, 0.0014));
    const pq = fract(s.mul(dirW).div(0.03).sub(time.mul(0.6)));
    const front = sdown(float(1.0).sub(max(pix.div(0.03).mul(1.5), 0.004)), 1.0, pq);
    const pq2 = pq.mul(pq);
    const pq4 = pq2.mul(pq2);
    const pq16 = pq4.mul(pq4).mul(pq4).mul(pq4);
    const packet = pq16.mul(3.0).add(pq2.mul(pq).mul(0.16)).mul(front);
    // pancerz: trzy szczeliny wzdłuż osi (co 120°, pierwsza od strony osi gryzu), energia widoczna w szczelinach,
    // pakiet prześwieca słabo przez pancerz; kąt wokół osi z normalnej, piksel kątowy = |fwidth(n)|
    const xx = dot(dpx, dpx);
    const yy = dot(dpy, dpy);
    const xy = dot(dpx, dpy);
    const det = max(xx.mul(yy).sub(xy.mul(xy)), xx.mul(yy).mul(1e-4).add(1e-30));
    const g = dpx.mul(dvx.mul(yy).sub(dvy.mul(xy))).add(dpy.mul(dvy.mul(xx).sub(dvx.mul(xy)))).div(det);
    const tAx = plantVar(g.div(max(length(g), 1e-12)), 'vec3');
    const r0a = C.A.sub(tAx.mul(dot(C.A, tAx)));
    const r0b = C.out.sub(tAx.mul(dot(C.out, tAx)));
    const r0 = plantVar(select(length(r0a).greaterThan(0.3), r0a, r0b), 'vec3');
    const r0n = plantVar(r0.div(max(length(r0), 1e-4)), 'vec3');
    const th = atan(dot(n, cross(tAx, r0n)), dot(n, r0n).add(1e-6));
    const dth = abs(fract(th.mul(3.0 / TAU).add(0.5)).sub(0.5)).mul(TAU / 3.0);
    const slit = plantVar(mix(3.0 * 0.4 / TAU, aaBox(dth, 0.2, max(nPix, 1e-4)), sdown(0.25, 0.5, nPix.div(0.4))));
    const pipeEmit = vec3(...T.beam).mul(slit.mul(packet.add(0.45)).add(packet.mul(0.12)).mul(float(1.0).sub(collar.mul(0.9)))
      .mul(U.uPlantBeam.x));
    // LINA: światła prowadzące co 0,03 R (co czwarte czerwone), fala jasności w górę; kabiny — subtelny wskaźnik
    // (fizyczne kabiny dokłada komponent wind)
    const gs = s.div(0.03);
    const gi = floor(gs.add(0.5));
    const guide = aaDot(abs(gs.sub(gi)).mul(0.03), 0.0006, pix);
    const chase = sdown(0.0, 0.18, fract(gi.mul(0.05).sub(time.mul(0.15))));
    const red = step01(fract(gi.mul(0.25)), 0.7);
    const guideCol = mix(vec3(2.6, 2.4, 2.1), vec3(3.0, 0.3, 0.12), red).mul(guide.mul(chase.mul(0.75).add(0.25)));
    const pos = fract(s.div(0.06).sub(time.mul(0.05).mul(vPart.w)));
    const cab = aaDot(abs(pos.sub(0.5)).mul(0.06), 0.0008, pix).mul(0.45);
    const tetherEmit = guideCol.add(mix(vec3(2.4, 2.0, 1.4), vec3(0.7, 1.5, 2.6), step01(vPart.w.negate(), 0.0)).mul(cab));
    // światło: ciemna stal (opaski polerowane), lina gładsza
    const tone = mix(mix(1.1, 1.5, collar).mul(float(1.0).sub(slit.mul(0.6))), 1.3, kTether);
    const rough = mix(mix(0.5, 0.3, collar), 0.33, kTether);
    const col = plantVar(plantLighting(C, n, vec3(...T.metal).mul(tone), roughA2(rough, nPix), float(0.05), float(1.0)), 'vec3');
    col.addAssign(mix(pipeEmit, tetherEmit, kTether));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { fragmentNode };
}

const GRAPHS = {};
function graph(kind) {
  GRAPHS[kind] ??= kind === 'metal' ? buildMetalGraph() : buildFlowGraph();
  return GRAPHS[kind];
}

function opaque(name, kind, uniforms) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.uniforms = uniforms;
  m.fragmentNode = graph(kind).fragmentNode;
  m.lights = false;
  m.fog = false;
  return m;
}

export const createPlantMetalMaterial = (uniforms) => opaque('EarthBitePlantMetal', 'metal', uniforms);
export const createPlantFlowMaterial = (uniforms) => opaque('EarthBitePlantFlow', 'flow', uniforms);
