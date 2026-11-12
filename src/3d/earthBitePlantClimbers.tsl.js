// Elektrownia „KOREK” — KABINY WIND NA GPU (dodatek komponentu wind, earthBitePlantElevators.js). JEDEN rysunek: Mesh
// z InstancedBufferGeometry (nie InstancedMesh — pułapka 24), dane kabin w jednym przeplecionym buforze instancji
// (aCabA: S.xyz + faza, aCabB: E.xyz + okres, aCabC: bok U.xyz + odsunięcie pasa, aCabD: ziarno, schowanie w doku).
// Położenie liczy etap wierzchołków z czasu `uPlantTime` (pętla jak paternoster): jazda pasem +1 od doku kotwicy
// do doku wózka (0,4 okresu, profil prędkości kosinusowy — rusza i hamuje płynnie), postój w doku (0,1 — kabina schowana
// w doku przechodzi na pas −1), jazda w dół (0,4), postój (0,1). Kabiny jadą po ZEWNĘTRZNEJ stronie liny pasa (ramki
// rozporowe są między linami), obrócone o 180° wokół liny na pasie −1 (bez odbicia — strona przednia bez zmian).
// LOD rozstawu pasów: gdy odsunięcie kabiny od osi wiązki ma mniej niż LANE_PX.lo px (kadr gry), kabina jedzie po OSI —
// na linii energii, którą z daleka widać zamiast lin pasów; od LANE_PX.hi px — po swoim pasie (płynnie między nimi).
// Kabina: kapsuła (walec, nosy, kołnierze, stopki chwytaka, kontener na grzbiecie); fragment — panele, pas okien
// (od strony bez liny), kołnierze z chłodną listwą, światło przednie białe HDR (w kierunku jazdy) i tylne czerwone,
// oświetlenie tym samym modelem co metal (plantLightContext / plantLighting). Z daleka kabina rośnie do ≥ 1,6 px
// (piksel na R w środku kabiny z macierzy rzutu) i świeci ciepło — w kadrze gry iskry jadące po linach.
// Graf RAZ na moduł; obiekt w układzie OBIEKTU kuli (dziecko grupy elektrowni, macierz jednostkowa).
//
// LINIE ENERGII (drugi rysunek dodatku, `createTetherGlow`): przewód środkowy każdej wiązki i pion energii wieży jako
// wstęga zwrócona do kamery (etap wierzchołków liczy kierunek osi na ekranie i odsuwa krawędzie o pół-szerokość
// w pikselach: ≥ 1,6 px albo promień przewodu × 2,4), addytywnie, bez zapisu głębi, lekko przed przewodem (ku kamerze).
// Fragment: nasycona cyjanowa linia ~1 px z poświatą (pod progiem bloomu), PAKIETY HDR zgodne z przewodem PIPE
// materiału przepływu (odstęp 0,03 R, 0,018 R/s ku ringowi — z bliska pakiety przewodu i wstęgi się pokrywają; gdy
// gęstsze niż ~11 px, co drugi, co czwarty… płynnie; czoło pakietu bieleje). Na wstędze NIE MA świateł pozycyjnych
// (czerwień na cyjanie zlewała się w różowe paciorki) — czerwone światła tylko na bryłach kotwic i doków. Wstęga gaśnie,
// gdy przewód ma ≥ ~1,5–3 px promienia (z bliska rysuje go materiał przepływu). Hierarchia jasności w kadrze gry: promień > LINY (ta wstęga) > korona > cięciwy pola.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn, float, vec2, vec3, vec4, attribute, positionGeometry, normalGeometry, varyingProperty, modelWorldMatrix,
  modelViewMatrix, cameraProjectionMatrix, viewportSize,
  abs, atan, clamp, cross, exp, exp2, floor, fract, fwidth, length, log2, max, mix, normalize, select, sin, smoothstep
} from 'three/tsl';
import { sunVisibility } from './sunShadowMask.js';
import {
  PLANT_COLORS, perObjectUniforms, sdown, aaLine, aaBox, aaDot, lodFade, hash12, plantLightContext, plantLighting,
  plantVar, windowPane
} from './earthBitePlantCommon.tsl.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';

/** Najwięcej kabin (jeden rysunek, ≤ 400 wierzchołków na kabinę). */
export const CLIMBER_MAX = 48;

/** Kabina (R Ziemi): promień, pół-długość walca, koniec nosa. Lina pasa po stronie −x lokalnej. */
const CAB = Object.freeze({ r: 0.0012, body: 0.0016, tip: 0.0022, nose: 0.0006 });
/** LOD rozstawu pasów: odsunięcie kabiny od osi wiązki [px], poniżej którego kabina jedzie po osi / od którego — po pasie. */
const LANE_PX = Object.freeze({ lo: 6, hi: 16 });
const FLOATS = 16;
const TAU = Math.PI * 2;

// ── Bryła kabiny (lokalnie: y — wzdłuż liny ku ringowi, x — od liny na zewnątrz, z = x × y) ─────────────────────────
function cabinGeometry() {
  const parts = [];
  const cyl = (rTop, rBot, h, y, n = 12, open = true) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, n, 1, open);
    g.translate(0, y, 0);
    parts.push(g);
  };
  const { r, body, tip, nose } = CAB;
  cyl(r, r, body * 2, 0);                                    // walec
  cyl(nose, r, tip - body, (tip + body) / 2);                // nos górny (ku ringowi)
  cyl(r, nose, tip - body, -(tip + body) / 2);               // nos dolny
  for (const y of [tip, -tip]) {                             // denka nosów
    const g = new THREE.CircleGeometry(nose, 12);
    g.rotateX(y > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, y, 0);
    parts.push(g);
  }
  for (const y of [0.00125, -0.00125]) cyl(r * 1.08, r * 1.08, 0.00024, y);   // kołnierze (pierścienie listew)
  const box = (x0, x1, y0, y1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parts.push(g);
  };
  // stopki chwytaka (ku linie pasa) i kontener serwisowy na grzbiecie
  for (const y of [-0.001, 0.001]) box(-0.0017, -0.00105, y - 0.00035, y + 0.00035, -0.0003, 0.0003);
  box(-0.0004, 0.0004, -0.0009, 0.0009, 0.00105, 0.00148);
  for (const g of parts) {
    g.deleteAttribute('uv');
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  }
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return geo;
}

// ── Graf (raz na moduł) ────────────────────────────────────────────────────────────────────────────────────────────
function buildGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  const V = {
    local: varyingProperty('vec3', 'vCabLocal'),
    obj: varyingProperty('vec3', 'vCabObj'),
    nrm: varyingProperty('vec3', 'vCabNormal'),
    world: varyingProperty('vec3', 'vCabWorld'),
    info: varyingProperty('vec4', 'vCabInfo')
  };
  const positionNode = Fn(() => {
    const iA = attribute('aCabA', 'vec4');
    const iB = attribute('aCabB', 'vec4');
    const iC = attribute('aCabC', 'vec4');
    const iD = attribute('aCabD', 'vec4');
    const seg = plantVar(iB.xyz.sub(iA.xyz), 'vec3');
    const len = plantVar(length(seg));
    const d = plantVar(seg.div(max(len, 1e-6)), 'vec3');
    const side = plantVar(normalize(iC.xyz), 'vec3');
    const up = plantVar(cross(side, d), 'vec3');
    // cykl: q ∈ [0, 1): 0–0,4 w górę, 0,4–0,5 postój u ringu, 0,5–0,9 w dół, 0,9–1 postój u kotwicy
    const q = plantVar(fract(U.uPlantTime.div(max(iB.w, 1.0)).add(iA.w)));
    const t1 = plantVar(clamp(q.mul(2.5), 0.0, 1.0));
    const t2 = plantVar(clamp(q.sub(0.5).mul(2.5), 0.0, 1.0));
    const ease = (t) => t.sub(sin(t.mul(TAU)).mul(1 / TAU));
    const s = plantVar(ease(t1).sub(ease(t2)));
    // pas: +1 w górę, −1 w dół; zmiana w postoju (kabina w doku)
    const lat = plantVar(float(1.0).sub(smoothstep(0.4, 0.5, q).sub(smoothstep(0.9, 1.0, q)).mul(2.0)));
    const sg = plantVar(select(lat.greaterThanEqual(0.0), float(1.0), float(-1.0)));
    const dir = select(q.lessThan(0.45).or(q.greaterThanEqual(0.95)), float(1.0), float(-1.0));
    const along = mix(iD.y.negate(), len.add(iD.y), s);
    const axisPt = plantVar(iA.xyz.add(d.mul(along)), 'vec3');
    // piksele na R w punkcie osi wiązki: P₁₁ · skala obiektu · pół wysokości celu / w
    const cc = plantVar(cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(axisPt, 1.0))), 'vec4');
    const pxPerR = plantVar(cameraProjectionMatrix.element(1).y.mul(length(modelViewMatrix.element(0).xyz))
      .mul(viewportSize.y.mul(0.5)).div(max(cc.w, 1e-6)));
    // LOD ROZSTAWU PASÓW: z daleka (odsunięcie kabiny od osi < LANE_PX.lo px) kabina jedzie PO OSI wiązki — tam, gdzie
    // z daleka rysuje się linia energii (wstęga przewodu środkowego); od LANE_PX.hi px — po zewnętrznej stronie liny pasa
    const laneK = plantVar(smoothstep(LANE_PX.lo, LANE_PX.hi, iC.w.mul(pxPerR)));
    const center = plantVar(axisPt.add(side.mul(lat.mul(iC.w).mul(laneK))), 'vec3');
    // z daleka kabina rośnie do ≥ 1,6 px średnicy
    const grow = plantVar(clamp(float(1.6 / (2 * CAB.r)).div(max(pxPerR, 1e-6)), 1.0, 6.0));
    const X = plantVar(side.mul(sg), 'vec3');
    const Z = plantVar(up.mul(sg), 'vec3');
    const pl = positionGeometry;
    const nl = normalGeometry;
    const obj = plantVar(center.add(X.mul(pl.x).add(d.mul(pl.y)).add(Z.mul(pl.z)).mul(grow)), 'vec3');
    V.local.assign(pl);
    V.obj.assign(obj);
    V.nrm.assign(X.mul(nl.x).add(d.mul(nl.y)).add(Z.mul(nl.z)));
    V.world.assign(modelWorldMatrix.mul(vec4(obj, 1.0)).xyz);
    V.info.assign(vec4(dir, iD.x, sg, grow));
    return obj;
  })();

  const fragmentNode = Fn(() => {
    // pochodne i maska słońca PRZED gałęziami (pułapki 15, 29)
    const pix = float(0.0).toVar();
    pix.assign(max(length(fwidth(V.local)), 1e-7));
    const nPix = float(0.0).toVar();
    nPix.assign(length(fwidth(V.nrm)));
    const sunVisP = float(1.0).toVar();
    sunVisP.assign(mix(1.0, sunVisibility(), U.uSunShadowRecv));
    // piksel w R (kabina powiększona z daleka — `grow`): poświata ciepła, gdy kabina ma kilka pikseli
    const farK = plantVar(smoothstep(0.0005, 0.0016, pix.mul(V.info.w)));
    const p = plantVar(V.obj, 'vec3');
    const n = plantVar(V.nrm.div(max(length(V.nrm), 1e-6)), 'vec3');
    const C = plantLightContext(U, p, V.world, sunVisP);
    const loc = plantVar(V.local, 'vec3');
    const dir = V.info.x;
    const seed = plantVar(V.info.y);
    const rr = plantVar(length(vec3(loc.x, 0.0, loc.z)));
    const ang = plantVar(atan(loc.z, loc.x));
    const arc = plantVar(ang.mul(CAB.r));
    // PANELE: pierścienie co 0,0008 R, szwy wzdłuż co 30°; odcień płyty z haszu
    const ry = plantVar(loc.y.div(0.0008));
    const ri = floor(ry);
    const ca = plantVar(ang.mul(6.0 / Math.PI));
    const ci = floor(ca);
    const seamY = aaLine(abs(fract(ry).sub(0.5)).sub(0.5).abs().mul(0.0008), float(0.00004), pix);
    const seamA = aaLine(abs(fract(ca).sub(0.5)).sub(0.5).abs().mul(CAB.r * Math.PI / 6), float(0.00004), pix);
    const seam = plantVar(max(seamY, seamA).mul(lodFade(pix, 0.0008)));
    const plate = hash12(vec2(ri, ci).add(seed.mul(13.0)));
    const tone = plantVar(mix(1.0, float(0.85).add(plate.mul(0.3)), lodFade(pix, 0.0008)).mul(float(1.0).sub(seam.mul(0.6))));
    // OKNA: rząd szczelin w pasie |y| < 0,00042, od strony bez liny (cos kąta > −0,35), ziarno — gęstość zapalonych
    const onBody = plantVar(sdown(CAB.body - 0.0001, CAB.body, abs(loc.y)).mul(float(1.0).sub(step(CAB.r * 1.02, rr))));
    const away = smoothstep(-0.45, -0.25, loc.x.div(max(rr, 1e-6)));
    const wy = aaBox(abs(loc.y), 0.00042, pix);
    const wu = fract(arc.div(0.00034));
    const wx = aaBox(abs(wu.sub(0.5)).mul(0.00034), 0.00011, pix);
    const lodW = plantVar(lodFade(pix, 0.0003));
    const wi = floor(arc.div(0.00034));
    const lit = select(hash12(vec2(wi, seed.mul(31.0))).lessThan(mix(0.55, 0.95, seed)), float(1.0), float(0.25));
    // z bliska rama, ślemię i głębia wnęki (windowPane) — nie płaski kremowy prostokąt; szyba bez ramy
    const pane = windowPane(wu.sub(0.5).mul(0.00034 / 0.00011), loc.y.div(0.00042), pix.div(0.00011), pix.div(0.00042),
      { gain: 0.5 });
    const win = plantVar(mix(wy.mul(0.33), wy.mul(wx).mul(pane.glass), lodW).mul(onBody).mul(away));
    const winE = plantVar(win.mul(mix(1.0, lit.mul(pane.lum), lodW)));
    const winTint = mix(vec3(1.0, 0.36, 0.1), vec3(1.0, 0.62, 0.3), pane.warm);
    // KOŁNIERZE: pierścienie listew (r > 1,04 r) — chłodna energia pod progiem bloomu
    const collar = plantVar(step(CAB.r * 1.04, rr).mul(sdown(0.00110, 0.00140, abs(loc.y))).mul(step(0.0011, abs(loc.y))));
    // materiał: ciemny anodowany kadłub (trochę jaśniejszy od megastruktury — kabina czyta się na tle), szyby gładkie
    const albedo = vec3(...T.metal).mul(tone.mul(1.6)).mul(float(1.0).sub(win.mul(0.6)));
    const rough = mix(float(0.42).add(seam.mul(0.2)), 0.12, win);
    const a2 = clamp(rough.mul(rough).mul(rough).mul(rough).add(nPix.mul(nPix).mul(0.6)), 0.002, 1.0);
    const col = plantVar(plantLighting(C, n, albedo, a2, float(0.05), float(1.0).sub(seam.mul(0.5))), 'vec3');
    col.addAssign(winTint.mul(winE.mul(1.7)).mul(float(1.0).sub(C.lit.mul(0.5))));
    col.addAssign(vec3(0.35, 0.7, 1.0).mul(collar.mul(0.55)));
    // ŚWIATŁA: nos w kierunku jazdy — biały HDR, tylny — czerwony; drobniejsze niż piksel rosną do piksela
    const tipF = vec3(0.0, dir.mul(CAB.tip), 0.0);
    const dF = length(loc.sub(tipF));
    const dB = length(loc.add(tipF));
    col.addAssign(vec3(5.0, 4.7, 4.2).mul(aaDot(dF, 0.00045, pix)));
    col.addAssign(vec3(4.4, 0.35, 0.11).mul(aaDot(dB, 0.0004, pix)));
    // z daleka: ciepła iskra (średnia okien i świateł kabiny — w kadrze gry kabiny jadą po liniach energii)
    col.addAssign(vec3(1.0, 0.56, 0.24).mul(farK.mul(1.2)));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { positionNode, fragmentNode };
}

// ── Linie energii wiązek (wstęgi zwrócone do kamery) ───────────────────────────────────────────────────────────────

/** Najwięcej wstęg (6 wiązek + 6 pionów, zapas na widełki). */
const GLOW_MAX = 24;
const GLOW_SEG = 24;
const GLOW_FLOATS = 16;
const GLOW = Object.freeze({
  minHalf: 1.6,               // pół-szerokość wstęgi ≥ tyle px
  widen: 2.4,                 // pół-szerokość z bliska = promień przewodu × widen
  fadeLo: 1.4, fadeHi: 3.2,   // wstęga gaśnie, gdy promień przewodu ma 1,4–3,2 px
  bias: 0.0012,               // przesunięcie ku kamerze [R] (przed pancerzem przewodu)
  period: 0.03, speed: 0.018, // pakiety jak w przewodzie PIPE (earthBitePlant.tsl.js: fract(s / 0,03 − 0,6 t))
  minGap: 11,                 // pakiety nie gęściej niż co tyle px (dalej co 2., 4., …)
  tail: 0.2,                  // długość ogona pakietu (część odstępu; ≥ 2 px)
  base: 0.3, peak: 3.0,       // jasność linii (nasycony cyjan pod progiem bloomu) i czoła pakietu (HDR, barwa promienia)
  endFade: 0.004              // wygaszenie przy czołach doków [R]
});
const C_LINE = [0.08, 0.5, 1.0];
/** Dopełnienie barwy promienia do bieli w czole pakietu (beam + to ≈ 0,85 / 0,95 / 1,0 przy pk = 1). */
const PACKET_WHITE = [0.5, 0.17, 0.0];

/** Wstęga: x — t wzdłuż 0…1, y — bok ±1 (szerokość i kierunek liczy etap wierzchołków). */
function glowGeometry() {
  const n = GLOW_SEG;
  const pos = new Float32Array((n + 1) * 6);
  const idx = [];
  for (let i = 0; i <= n; i++) {
    pos.set([i / n, -1, 0, i / n, 1, 0], i * 6);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function buildGlowGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  const V = {
    s: varyingProperty('float', 'vGlwS'),
    x: varyingProperty('float', 'vGlwX'),
    k: varyingProperty('vec4', 'vGlwK'),   // pół-szerokość [px], wygaszenie LOD, długość, przesunięcie drogi s0
    m: varyingProperty('vec4', 'vGlwM')    // ziarno, odstęp ramek, koniec ramek, promień przewodu [px]
  };
  const vertexNode = Fn(() => {
    const iA = attribute('aGlwA', 'vec4');
    const iB = attribute('aGlwB', 'vec4');
    const iC = attribute('aGlwC', 'vec4');
    const iD = attribute('aGlwD', 'vec4');
    const g = positionGeometry;
    const seg = plantVar(iB.xyz.sub(iA.xyz), 'vec3');
    const P = plantVar(iA.xyz.add(seg.mul(g.x)), 'vec3');
    const dn = plantVar(seg.div(max(length(seg), 1e-9)), 'vec3');
    const su = plantVar(normalize(iC.xyz), 'vec3');
    const sv = plantVar(normalize(cross(su, dn)), 'vec3');
    const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
    const scale = plantVar(length(modelViewMatrix.element(0).xyz));
    const pv = plantVar(modelViewMatrix.mul(vec4(P, 1.0)).xyz, 'vec3');
    const toCam = plantVar(select(ortho, vec3(0.0, 0.0, 1.0), pv.negate().div(max(length(pv), 1e-9))), 'vec3');
    const clip = plantVar(cameraProjectionMatrix.mul(vec4(pv.add(toCam.mul(scale.mul(GLOW.bias))), 1.0)), 'vec4');
    const half = plantVar(viewportSize.mul(0.5), 'vec2');
    const w = plantVar(max(clip.w, 1e-6));
    // piksele na jednostkę wektora v (układ obiektu) w punkcie P: pochodna rzutu perspektywicznego / ortogonalnego
    const der = (v) => {
      const c = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(v, 0.0)));
      return c.xy.mul(w).sub(clip.xy.mul(c.w)).div(w.mul(w)).mul(half);
    };
    const tPx = plantVar(der(seg), 'vec2');
    const tl = plantVar(length(tPx));
    const dir = plantVar(select(tl.greaterThan(1e-6), tPx.div(max(tl, 1e-6)), vec2(1.0, 0.0)), 'vec2');
    const radPx = plantVar(iC.w.mul(max(length(der(su)), length(der(sv)))));
    const halfPx = plantVar(max(radPx.mul(GLOW.widen), GLOW.minHalf));
    const fade = plantVar(sdown(GLOW.fadeLo, GLOW.fadeHi, radPx).mul(step(1e-6, clip.w)));
    const off = vec2(dir.y.negate(), dir.x).mul(g.y.mul(halfPx)).div(half).mul(clip.w);
    V.s.assign(g.x.mul(iA.w));
    V.x.assign(g.y);
    V.k.assign(vec4(halfPx, fade, iA.w, iB.w));
    V.m.assign(vec4(iD.x, iD.y, iD.z, radPx));
    return vec4(clip.xy.add(off), clip.zw);
  })();

  const fragmentNode = Fn(() => {
    // pochodna drogi PRZED gałęziami: R wzdłuż na piksel
    const ps = float(0.0).toVar();
    ps.assign(max(fwidth(V.s), 1e-7));
    const time = U.uPlantTime;
    const s = plantVar(V.s);
    const len = plantVar(V.k.z);
    const sp = plantVar(s.add(V.k.w));
    const ax = plantVar(abs(V.x));
    const dpx = plantVar(ax.mul(V.k.x));
    // profil w poprzek: rdzeń ~1 px (albo grubość przewodu) i miękka poświata do krawędzi wstęgi
    const cq = dpx.div(max(V.m.w, 0.6));
    const ex = float(1.0).sub(ax);
    const prof = plantVar(exp(cq.mul(cq).negate()).add(ex.mul(ex).mul(0.22)));
    // PAKIETY: ostre czoło ku ringowi, ogon ku kotwicy; gęstsze niż ~11 px — co 2^n (przejście płynne między oktawami)
    const oct = plantVar(log2(max(ps.mul(GLOW.minGap / GLOW.period), 1.0)));
    const of = plantVar(fract(oct));
    const Pa = plantVar(exp2(floor(oct)).mul(GLOW.period));
    const packet = (Pp) => {
      const q = fract(sp.sub(time.mul(GLOW.speed)).div(Pp));
      const wq = max(float(GLOW.tail), ps.mul(2.2).div(Pp));
      const aa = max(ps.div(Pp), 0.002);
      return exp(float(1.0).sub(q).div(wq).mul(-1.6)).mul(sdown(float(1.0).sub(aa), 1.0, q));
    };
    const pk = plantVar(mix(packet(Pa), packet(Pa.mul(2.0)), of));
    // Bez świateł pozycyjnych na wstędze (czerwień na cyjanie dawała różowe paciorki): światła ramek z daleka są poniżej
    // piksela, czerwone tylko na bryłach doków i wież. Pakiet: barwa promienia, czoło bieleje (cyjan → biel)
    const endK = smoothstep(0.0, GLOW.endFade, s).mul(smoothstep(0.0, GLOW.endFade, len.sub(s)));
    const pkCol = vec3(...T.beam).mul(pk).add(vec3(...PACKET_WHITE).mul(pk.mul(pk)));
    const energy = vec3(...C_LINE).mul(GLOW.base).add(pkCol.mul(GLOW.peak)).mul(prof).mul(U.uPlantBeam.x);
    const col = plantVar(max(energy.mul(V.k.y.mul(endK)), vec3(0.0)), 'vec3');
    return vec4(col, max(col.x, max(col.y, col.z)));
  })();
  return { vertexNode, fragmentNode };
}

/** 1 dla x ≥ krawędź, 0 inaczej (bez smoothstep o stałych krawędziach). */
function step(edge, x) {
  return select(x.greaterThanEqual(edge), float(1.0), float(0.0));
}

let GRAPH = null;
const graph = () => (GRAPH ??= buildGraph());
let GLOW_GRAPH = null;
const glowGraph = () => (GLOW_GRAPH ??= buildGlowGraph());

/**
 * Linie energii wiązek: fabryka dodatku elektrowni (uniforms) → { object, applyLook, update, meshes, dispose }.
 * `instancesOf(L, b)` → rekordy { S, E, U, r, s0, seed, step, end } w układzie obiektu kuli. Jeden rysunek (Mesh
 * z InstancedBufferGeometry, jeden przepleciony bufor instancji), addytywnie, bez zapisu głębi, forceSinglePass.
 */
export function createTetherGlow(uniforms, instancesOf) {
  const G = glowGraph();
  const material = new THREE.NodeMaterial();
  material.name = 'EarthBitePlantTetherGlow';
  material.uniforms = uniforms;
  material.vertexNode = G.vertexNode;
  material.fragmentNode = G.fragmentNode;
  material.lights = false;
  material.fog = false;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  blendAddytywnePremul(material);
  const geo = glowGeometry();
  const data = new Float32Array(GLOW_MAX * GLOW_FLOATS);
  const buffer = new THREE.InstancedInterleavedBuffer(data, GLOW_FLOATS, 1);
  ['aGlwA', 'aGlwB', 'aGlwC', 'aGlwD'].forEach((name, k) => geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'EarthBitePlantTetherGlow';
  return {
    object: mesh,
    applyLook(L, b) {
      const list = instancesOf(L, b).slice(0, GLOW_MAX);
      const bs = new THREE.Box3();
      list.forEach((c, i) => {
        data.set([c.S.x, c.S.y, c.S.z, c.S.distanceTo(c.E), c.E.x, c.E.y, c.E.z, c.s0, c.U.x, c.U.y, c.U.z, c.r, c.seed, c.step, c.end, 0], i * GLOW_FLOATS);
        bs.expandByPoint(c.S);
        bs.expandByPoint(c.E);
      });
      data.fill(0, list.length * GLOW_FLOATS);
      buffer.needsUpdate = true;
      geo.instanceCount = list.length;
      if (list.length) {
        bs.getBoundingSphere(geo.boundingSphere);
        geo.boundingSphere.radius += 0.01;
      }
    },
    update() {},
    meshes: () => [mesh],
    dispose() {
      mesh.parent?.remove(mesh);
      geo.dispose();
      material.dispose();
    }
  };
}

/**
 * Kabiny wind: fabryka dodatku elektrowni (uniforms) → { object, applyLook, update, meshes, dispose }.
 * `instancesOf(L, b)` → rekordy { S, E, U, lane, dockIn, phase, period, seed } w układzie obiektu kuli.
 */
export function createClimbers(uniforms, instancesOf) {
  const G = graph();
  const material = new THREE.NodeMaterial();
  material.name = 'EarthBitePlantClimbers';
  material.uniforms = uniforms;
  material.positionNode = G.positionNode;
  material.fragmentNode = G.fragmentNode;
  material.lights = false;
  material.fog = false;
  const base = cabinGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.index);
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const data = new Float32Array(CLIMBER_MAX * FLOATS);
  const buffer = new THREE.InstancedInterleavedBuffer(data, FLOATS, 1);
  ['aCabA', 'aCabB', 'aCabC', 'aCabD'].forEach((name, k) => geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'EarthBitePlantClimbers';
  return {
    object: mesh,
    applyLook(L, b) {
      const list = instancesOf(L, b).slice(0, CLIMBER_MAX);
      const bs = new THREE.Box3();
      list.forEach((c, i) => {
        const o = i * FLOATS;
        data.set([c.S.x, c.S.y, c.S.z, c.phase, c.E.x, c.E.y, c.E.z, c.period, c.U.x, c.U.y, c.U.z, c.lane, c.seed, c.dockIn, 0, 0], o);
        bs.expandByPoint(c.S);
        bs.expandByPoint(c.E);
      });
      data.fill(0, list.length * FLOATS);
      buffer.needsUpdate = true;
      geo.instanceCount = list.length;
      if (list.length) {
        bs.getBoundingSphere(geo.boundingSphere);
        geo.boundingSphere.radius += 0.01;
      }
    },
    update() {},
    meshes: () => [mesh],
    dispose() {
      mesh.parent?.remove(mesh);
      geo.dispose();
      base.dispose();
      material.dispose();
    }
  };
}
