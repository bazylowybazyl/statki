// Habitat = JEDNA ciągła powierzchnia: CDLOD na instancjach (2 draw calle
// niezależnie od zoomu) + mapy z bake'u + detal z kafelkowych tekstur.
//
// Siatka węzła: gridDiv × gridDiv komórek. Współrzędne węzłów liczone
// w całkowitych jednostkach najdrobniejszej siatki (dokładne we float32),
// więc wspólne wierzchołki sąsiadów wychodzą identyczne — bez pęknięć.
// Morphing kaskadowy: węzeł narysowany drobniej niż trzeba (dziecko poza
// zasięgiem swojego LOD) domorfowuje się w shaderze do grubszej siatki, więc
// wybór może zawsze dzielić węzeł na cztery i nie ma twardych cięć LOD.
//
// Wierzchołki liczone względem kamery (RTE): kąt od kąta odniesienia blisko
// kamery, przesunięcie do kamery policzone w double na CPU. Bez tego ring
// o promieniu 43 tys. j. drżałby przy ujęciach z 20 j. nad ziemią.
//
// Port WebGPU (zadanie 07): materiał w TSL (NodeMaterial), 1:1 z dawnym GLSL
// (TERRAIN_VERTEX / TERRAIN_FRAGMENT). Funkcje wspólne z biblioteki ringu
// (haloRingTSL / haloRingSurfaceTSL), zestaw przemysłowy z haloIndKitTSL.
// Uniformy powierzchni (surfaceUniforms: mapy, detal, wzory, CDLOD) leżą w JEDNYM
// bloku `haloSurfU` (createUniformBlock — limit 12 buforów uniformów na etap),
// tekstury to węzły texture() (`.value` podmienia mapę bez przebudowy). Klucze
// i `.value` jak dawniej — materiały struktury, atmosfery, megastruktury i miasta
// (zadania 08–09) biorą te same surfaceUniforms. Jedyny wariant kompilacji to
// liczba kroków powietrza (quality.airSteps) — nowa jakość = nowy materiał
// (ring.setQuality buduje zestaw od nowa).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Break, Continue, Discard,
  float, int, vec2, vec3, vec4,
  attribute, varyingProperty, positionGeometry, texture,
  abs, clamp, dot, exp, exp2, floor, fract, fwidth, inverseSqrt, length, log2, max, min, mix,
  normalize, pow, reflect, sin, sqrt, step, smoothstep
} from 'three/tsl';
import { HALO_ROOF, HALO_TERRAIN } from './haloRingConfig.js';
import { haloDetailScales, haloCloudScales } from './haloRingDetail.js';
import { haloIndKitTSL } from './haloRingIndustryKit.js';
import { HALO_TERRAIN_PALETTE_KEYS } from './haloRingProfiles.js';
import { HALO_PI, haloFusedMulAddInt, haloHash12, haloRingSurfaceTSL, haloRingTSL, haloSmooth, haloWrapI } from './haloRingTSL.js';
import { createUniformBlock, nodeOf } from './haloUniformsAdapter.js';

const MAX_LOD_UNIFORM = 12;
// Nazwa bufora bloku w WGSL (stała — ten sam kod dla każdego egzemplarza terenu).
export const HALO_SURFACE_BLOCK_NAME = 'haloSurfU';
// Blok uniformów powierzchni (węzeł uniformArray) — poza kluczami, dla testów.
export const HALO_SURFACE_BLOCK = Symbol('haloSurfaceBlock');

const nodeOrFloat = (x) => (typeof x === 'number' ? float(x) : x);
// GLSL aaStep: smoothstep(edge − w, edge + w, x)
const aaStep = (edge, x, w) => smoothstep(nodeOrFloat(edge).sub(w), nodeOrFloat(edge).add(w), x);

// Tekstura zastępcza 1×1 tego samego typu co mapa (TSL potrzebuje tekstury już
// przy budowie materiału — typ próbkowania wchodzi do wiązań). Mapy są gotowe
// przed budową terenu (index.js: assemble po maps.init), więc tylko na wszelki wypadek.
function placeholderTexture(type) {
  const data = type === THREE.HalfFloatType ? new Uint16Array(4) : new Uint8Array(4);
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, type);
  t.colorSpace = THREE.NoColorSpace;
  // próbkowanie z filtrem jak mapy (DataTexture z NearestFilter nie dostaje samplera w WGSL)
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Węzeł bazowy tekstury powierzchni. Z uv (atrapą) — bo TextureNode bez uv ma
// updateMatrix = true, a klony z .sample(uv) dziedziczą to i każde próbkowanie
// mnoży uv przez macierz tekstury (osobny uniform mat3 na próbkę, aktualizacja
// co obiekt). Mapy i detal nie mają transformacji uv; baza nie jest próbkowana
// sama — tylko przez .sample(uv) / .level(lod), które podmieniają uv.
function surfaceTextureNode(tex) {
  return texture(tex, vec2(0.0, 0.0));
}

// ---------------------------------------------------------------------------
// Węzły materiału terenu: wierzchołki CDLOD + fragment (materiały, woda, miasto,
// światło, powietrze). u = uniformy ringu, su = uniformy powierzchni tego terenu.
export function makeHaloTerrainNodes({ u, su, airSteps = 8 }) {
  const H = haloRingTSL(u);
  const S = haloRingSurfaceTSL(u, su);
  const K = haloIndKitTSL(u);
  const U = H.uniforms;
  const { mapA, mapB, mapC, detail1, detail2 } = S.textures;
  const gridInfo = nodeOf(su.uGridInfo);
  const mapSize = nodeOf(su.uMapSize);
  const lodMorph = nodeOf(su.uLodMorph);
  const exposedLines = nodeOf(su.uExposedLines);
  const detailN = nodeOf(su.uDetailN);
  const detailOff = nodeOf(su.uDetailOff);
  const varN = nodeOf(su.uVarN);
  const varOff = nodeOf(su.uVarOff);
  const patT = nodeOf(su.uPatT);
  const patF = nodeOf(su.uPatF);
  const patI = nodeOf(su.uPatI);
  const patN = nodeOf(su.uPatN);
  // paleta terenu z profilu planety (uTerPal, kolejność HALO_TERRAIN_PALETTE_KEYS)
  const palNode = nodeOf(u.uTerPal);
  const P = Object.fromEntries(HALO_TERRAIN_PALETTE_KEYS.map((k, i) => [k, palNode.element(i)]));

  const vRel = varyingProperty('vec3', 'vHaloRel');
  const vST = varyingProperty('vec2', 'vHaloST');        // sRel [j.], t [j.]
  const vUvMap = varyingProperty('vec2', 'vHaloUvMap');

  // ---- wierzchołki
  // wysokość z mapy (mip z odstępu siatki) i uv mapy w punkcie siatki gp
  const macroHeightAt = (gp, spacingWorld) => {
    const sAbs = gp.x.add(gridInfo.w).mul(gridInfo.x);
    const t = gp.y.mul(gridInfo.y);
    const uvMap = H.haloMapUV(sAbs, t).toVar();
    const texel = U.uFloorDims.x.mul(mapSize.z);
    const lod = max(0.0, log2(max(spacingWorld.div(texel), 1.0)));
    return { h: mapA.sample(uvMap).level(lod).x, uvMap };
  };
  const relAt = (gp, h) => {
    const sRel = gp.x.mul(gridInfo.x);
    const t = gp.y.mul(gridInfo.y).toVar();
    const dTheta = sRel.div(U.uFloorDims.z);
    const dr = U.uFloorLine.x.sub(U.uFloorDims.z).add(U.uFloorLine.z.mul(t)).add(U.uHabitat.x.mul(h));
    const z = U.uFloorLine.y.add(U.uFloorLine.w.mul(t));
    return H.haloRelFromPolar(dTheta, dr, z);
  };

  const vertexNode = Fn(() => {
    const iNode = attribute('iNode', 'vec4');          // s0 (wzgl. refS), t0, 0, lod — w komórkach najdrobniejszej siatki
    const k = iNode.w.toVar();
    const spacing = exp2(k);
    const gp = iNode.xy.add(positionGeometry.xy.mul(spacing)).toVar();
    const cellWorld = max(gridInfo.x, gridInfo.y).toVar();
    // wysokość do dystansu: stały gruby mip (zależy tylko od pozycji), żeby
    // wspólne wierzchołki sąsiadów o różnym LOD liczyły ten sam morph
    const h0 = max(macroHeightAt(gp, cellWorld.mul(64.0)).h, 0.0);
    const d = length(relAt(gp, h0)).toVar();
    // kaskadowy morph CDLOD: nieparzyste wierzchołki suną do parzystych
    const m = float(0.0).toVar();
    const kFinal = float(k).toVar();
    Loop(4, ({ i }) => {
      const kk = int(k).add(i).toVar();
      If(kk.greaterThanEqual(MAX_LOD_UNIFORM), () => { Break(); });
      const range = lodMorph.element(kk).toVar();
      m.assign(clamp(d.sub(range.x).div(max(range.y.sub(range.x), 1.0)), 0.0, 1.0));
      const cell = exp2(float(kk)).toVar();
      // parzystość z indeksu BEZWZGLĘDNEGO (gp jest względem refS; suma
      // dwóch liczb całkowitych < 2^24 jest we float dokładna)
      const idx = gp.add(vec2(gridInfo.w, 0.0)).div(cell).toVar();
      const odd = idx.sub(float(2.0).mul(floor(idx.mul(0.5).add(0.25))));
      gp.subAssign(odd.mul(m).mul(cell));
      kFinal.assign(float(kk));
      If(m.lessThan(1.0), () => { Break(); });
    });
    // mip i detal z POZIOMU KOŃCOWEGO (identyczny po obu stronach granicy LOD)
    const effSpacing = exp2(kFinal).mul(float(1.0).add(m)).mul(cellWorld).toVar();
    const macro = macroHeightAt(gp, effSpacing);
    const hm = macro.h.toVar();
    const C = mapC.sample(macro.uvMap).level(2.0).toVar();
    const mountain = smoothstep(60.0, 380.0, hm).mul(float(1.0).sub(C.y));
    const flatten = clamp(C.y.mul(0.92).add(C.z), 0.0, 1.0);
    const sRel = gp.x.mul(gridInfo.x).toVar();
    const t = gp.y.mul(gridInfo.y).toVar();
    const det = S.haloDetailHeight(sRel, t, mountain, flatten, effSpacing.mul(2.0)).toVar();
    const h = hm.add(det.x.mul(smoothstep(-2.0, 3.0, hm)));
    const rel = relAt(gp, max(h, 0.0)).toVar();
    vRel.assign(rel);
    vST.assign(vec2(sRel, t));
    vUvMap.assign(macro.uvMap);
    return H.haloProjectRel(rel);
  })();

  // ---- cień terenu z mapy wysokości: marsz wzdłuż rzutu słońca na płaszczyznę
  // styczną (kroki rosną geometrycznie do ~3 tys. j.) — góry rzucają cień bez
  // map cieni, ta sama analityka co reszta modelu światła. Wklejany (tekstura).
  const terrainShadow = (sRel, t, h, L, up, eTh, Tz) => {
    const vis = float(1.0).toVar();
    const cz = dot(L, up).toVar();
    If(cz.lessThanEqual(0.0), () => {
      vis.assign(0.0);
    }).Else(() => {
      const Lt = L.sub(up.mul(cz)).toVar();
      const lt = length(Lt).toVar();
      If(lt.greaterThanEqual(1e-4), () => {
        const dir = vec2(dot(Lt, eTh), Lt.z.div(max(Tz, 0.2))).div(lt).toVar();
        const rise = cz.div(lt).toVar();
        const stepLen = float(28.0).toVar();
        const x = float(0.0).toVar();
        const texel = U.uFloorDims.x.mul(mapSize.z).toVar();
        Loop(7, () => {
          x.addAssign(stepLen);
          const st = vec2(sRel, t).add(dir.mul(x)).toVar();
          If(st.y.lessThan(0.0).or(st.y.greaterThan(U.uFloorDims.y)), () => { Break(); });
          const lod = max(0.0, log2(max(stepLen.mul(0.5).div(texel), 1.0)));
          const hs = max(mapA.sample(H.haloMapUV(st.x.add(U.uRefBasis.w), st.y)).level(lod).x, 0.0);
          const rayH = h.add(x.mul(rise));
          vis.assign(min(vis, smoothstep(float(-12.0).sub(x.mul(0.015)), float(10.0).add(x.mul(0.02)), rayH.sub(hs))));
          stepLen.mulAssign(1.9);
        });
      });
    });
    return vis;
  };

  // ---- fragment
  const fragmentNode = Fn(() => {
    const rel = vec3(vRel).toVar();
    const dist = length(rel).toVar();
    const V = rel.negate().div(max(dist, 1e-3)).toVar();
    const p = U.uCamLocal.add(rel).toVar();
    const sRel = vST.x.toVar();
    const t = vST.y.toVar();
    // wylot tranzytu przez ring (tunel w płycie podłogi — bryły w megastrukturze)
    If(H.haloInTransitCut(sRel.add(U.uRefBasis.w), p.z), () => { Discard(); });
    const uv = vec2(vUvMap).toVar();
    const A = mapA.sample(uv).toVar();
    const Bw = mapB.sample(uv).toVar();
    const C = mapC.sample(uv).toVar();
    const hMap = A.x;
    const moist = A.z.toVar();
    const temp = A.w.toVar();
    const forest = C.x.toVar();
    const urban = C.y.toVar();
    const exposed = C.z.toVar();
    const rockMap = C.w;

    // makro-normalna z mapy (różnice centralne na tekselu bazowym)
    const du = mapSize.z;
    const dv = mapSize.w;
    const hE = mapA.sample(uv.add(vec2(du, 0.0))).x;
    const hW = mapA.sample(uv.sub(vec2(du, 0.0))).x;
    const hN = mapA.sample(uv.add(vec2(0.0, dv))).x;
    const hS = mapA.sample(uv.sub(vec2(0.0, dv))).x;
    const dhs = max(hE, 0.0).sub(max(hW, 0.0)).div(float(2.0).mul(du).mul(U.uFloorDims.x)).toVar();
    const dht = max(hN, 0.0).sub(max(hS, 0.0)).div(float(2.0).mul(dv).mul(U.uFloorDims.y)).toVar();

    const mountain = smoothstep(60.0, 380.0, hMap).mul(float(1.0).sub(urban));
    const flatten = clamp(urban.mul(0.92).add(exposed), 0.0, 1.0).toVar();
    const pix = max(dist.mul(0.0012), 0.02);
    const det = S.haloDetailHeight(sRel, t, mountain, flatten, pix).toVar();
    const h = hMap.add(det.x.mul(smoothstep(-2.0, 3.0, hMap))).toVar();
    const water = float(1.0).sub(smoothstep(-0.6, 0.6, h)).toVar();
    const gs = dhs.add(det.y).mul(float(1.0).sub(water));
    const gt = dht.add(det.z).mul(float(1.0).sub(water));

    const up = H.haloUp(p).toVar();
    const lxy = max(length(p.xy), 1.0).toVar();
    const eR = vec3(p.xy.div(lxy), 0.0).toVar();
    const sg = U.uHabitat.x;
    const eTh = vec3(p.y.negate(), p.x, 0.0).div(lxy).toVar();
    const eZ = vec3(0.0, 0.0, 1.0);
    const Tr = U.uFloorLine.z;
    const Tz = U.uFloorLine.w;
    // n = σ·Tz·r − Tz·h_s·θ − (σ·Tr + h_t)·z  (iloczyn stycznych, zwrot ku powietrzu)
    const N = normalize(sg.mul(Tz).mul(eR).sub(Tz.mul(gs).mul(eTh)).sub(sg.mul(Tr).add(gt).mul(eZ))).toVar();
    const Nflat = normalize(sg.mul(Tz).mul(eR).sub(sg.mul(Tr).mul(eZ))).toVar();
    const slope = float(1.0).sub(clamp(dot(N, Nflat), 0.0, 1.0));
    // do decyzji o materiale: nachylenie z makro-mapy + część detalu (bez szumu „moro”)
    const slopeMacro = float(1.0).sub(inverseSqrt(float(1.0).add(dhs.mul(dhs)).add(dht.mul(dht))));
    const slopeMat = mix(slopeMacro, slope, 0.3).toVar();

    // ---- materiały (albedo liniowe; zieleń ciemniej — waga luminancji 0,7152)
    const var0 = S.haloVar(0, sRel, t).toVar();
    const var1 = S.haloVar(1, sRel, t).toVar();
    const var2 = S.haloVar(2, sRel, t).toVar();
    const d1c = detail1.sample(vec2(sRel.div(detailN.x).add(detailOff.x), t.div(detailN.x))).toVar();
    const varA = var0.z.toVar();
    const grass = mix(P.grassDry, P.grassLush, smoothstep(0.25, 0.75, moist.add(varA.mul(0.3)))).toVar();
    grass.assign(mix(grass, grass.mul(vec3(1.25, 1.05, 0.7)), smoothstep(0.1, 0.6, var2.z).mul(0.5)));
    grass.assign(mix(grass, grass.mul(vec3(0.8, 0.95, 1.05)), haloSmooth(0.0, -0.5, var1.z).mul(0.4)));
    grass.mulAssign(float(0.86).add(float(0.28).mul(var1.z.mul(0.5).add(0.5))));
    const crowns = haloSmooth(0.34, 0.05, var2.x).toVar();
    const forestCol = mix(P.forestDark, P.forestLight, crowns.mul(float(0.6).add(float(0.4).mul(var2.y)))).toVar();
    forestCol.assign(mix(forestCol, P.forestCold, haloSmooth(0.35, 0.1, temp)));
    const strata = sin(h.mul(0.045).add(varA.mul(3.0))).mul(0.5).add(0.5).toVar();
    const rockCol = mix(P.rockA, P.rockB, strata.mul(0.5).add(d1c.w.add(0.5).mul(0.25))).toVar();
    rockCol.assign(mix(rockCol, P.rockDesert.mul(float(0.85).add(float(0.3).mul(strata))),
      smoothstep(0.55, 0.8, temp).mul(haloSmooth(0.35, 0.15, moist))));
    const sandCol = mix(P.sandA, P.sandB, var1.z.mul(0.5).add(0.5)).toVar();
    // siarka (profil: Jowisz, jak Io): plamy żółte i pomarańczowe, białe osady,
    // czarne potoki lawy; ta sama paleta z inną proporcją plam
    If(U.uProfFrag.x.greaterThan(0.001), () => {
      const sul = mix(P.sandA, P.sandB, smoothstep(-0.25, 0.35, var0.z.mul(0.7).add(var1.z.mul(0.3)))).toVar();
      sul.assign(mix(sul, P.sulfurWhite, smoothstep(0.3, 0.55, var2.z).mul(0.75)));
      sul.assign(mix(sul, P.lava, smoothstep(0.22, 0.45, var1.z.negate()).mul(0.85)));
      sandCol.assign(mix(sandCol, sul, U.uProfFrag.x));
    });
    const beachCol = P.beach;

    const desert = haloSmooth(0.32, 0.14, moist).mul(smoothstep(0.55, 0.8, temp)).toVar();
    const ground = mix(grass, sandCol, desert).toVar();
    // (w parku bez podłogi lasu 0.08 = pojedyncze drzewa 3D na trawniku)
    const fEdge = forest.sub(float(0.08).mul(Bw.x)).add(var1.z.mul(0.22)).add(var2.x.sub(0.3).mul(0.25));
    const fMask = smoothstep(0.42, 0.56, fEdge).mul(float(1.0).sub(desert)).mul(float(1.0).sub(smoothstep(0.3, 0.5, slopeMat))).toVar();
    ground.assign(mix(ground, forestCol, fMask));
    // pojedyncze drzewa i kępy na łąkach (komórki ~13 j.), z daleka średnia
    const treeTex = detail2.sample(vec2(sRel.div(detailN.x).add(detailOff.x), t.div(detailN.x))).toVar();
    const treeDens = clamp(float(0.06).add(forest.mul(0.5)).add(moist.mul(0.12)), 0.0, 0.6)
      .mul(float(1.0).sub(desert)).mul(float(1.0).sub(smoothstep(0.35, 0.55, slopeMat))).mul(smoothstep(0.12, 0.3, temp)).toVar();
    const canopy = haloSmooth(0.3, 0.12, treeTex.x).mul(step(treeTex.y, treeDens.mul(1.6))).toVar();
    const treeFar = smoothstep(0.25, 0.9, fwidth(sRel).div(detailN.x.div(32.0))).toVar();
    canopy.assign(mix(canopy, treeDens.mul(0.35), treeFar));
    ground.assign(mix(ground, forestCol.mul(float(1.3).add(float(0.8).mul(treeTex.y))), canopy.mul(float(1.0).sub(fMask))));
    const rockAmt = clamp(max(rockMap, smoothstep(0.2, 0.42, slopeMat)), 0.0, 1.0);
    ground.assign(mix(ground, rockCol, rockAmt.mul(float(1.0).sub(flatten))));
    const beach = haloSmooth(4.5, 0.8, h).mul(float(1.0).sub(water)).mul(float(1.0).sub(urban)).mul(float(1.0).sub(fMask.mul(0.6)));
    ground.assign(mix(ground, beachCol, beach.mul(float(1.0).sub(desert.mul(0.5)))));
    const snowLine = mix(110.0, 800.0, clamp(temp.mul(1.5), 0.0, 1.0)).toVar();
    const snow = smoothstep(snowLine.sub(40.0), snowLine.add(60.0), h.add(varA.mul(60.0)).add(var2.z.mul(18.0)))
      .mul(float(1.0).sub(smoothstep(0.22, 0.42, slopeMat.add(d1c.w.mul(0.18)).add(var1.z.mul(0.06))))).toVar();
    snow.assign(max(snow, haloSmooth(0.14, 0.04, temp).mul(float(1.0).sub(water)).mul(float(1.0).sub(smoothstep(0.4, 0.65, slopeMat)))));
    ground.assign(mix(ground, P.snow, snow));
    // linie na lodzie (profil: Jowisz, jak Europa): dwie rodziny długich,
    // falistych pęknięć (izolinie pola z gradientem liniowym) i brązowe plamy
    // chaosu; z daleka (linia < ~1 px) średnia zamiast migotania
    If(U.uProfFrag.y.greaterThan(0.001), () => {
      const sA = sRel.add(U.uRefBasis.w).toVar();
      const f1 = sA.mul(0.8).add(t.mul(0.6)).div(620.0).add(var0.z.mul(2.4)).toVar();
      const f2 = sA.mul(0.3).sub(t.mul(0.95)).div(980.0).add(var1.z.mul(1.8)).toVar();
      const w1 = fwidth(f1).toVar();
      const w2 = fwidth(f2).toVar();
      const l1 = float(1.0).sub(smoothstep(0.02, float(0.02).add(w1.mul(1.5)), float(0.5).sub(abs(fract(f1).sub(0.5)))));
      const l2 = float(1.0).sub(smoothstep(0.015, float(0.015).add(w2.mul(1.5)), float(0.5).sub(abs(fract(f2).sub(0.5)))));
      const lin = max(mix(l1, 0.08, smoothstep(0.08, 0.3, w1)), mix(l2, 0.06, smoothstep(0.08, 0.3, w2)).mul(0.8));
      const chaos = smoothstep(0.42, 0.7, var2.z).mul(0.35);
      ground.assign(mix(ground, P.lineae, clamp(lin.add(chaos), 0.0, 1.0).mul(snow).mul(U.uProfFrag.y).mul(0.85)));
    });

    // ---- parki (megabudowle, kopuły; kanał R mapy B): trawnik strzyżony,
    // żwirowe ścieżki — siatka zakrzywiona łagodnym szumem (jak strefa PARK
    // w orbital_ring_demo_2), w części komórek ścieżka na skos albo kwietnik
    // z obwódką żywopłotu, korony pojedynczych drzew z daleka; nocą latarnie
    // na części skrzyżowań. Komórka ~140 × 104 j. zakotwiczona w świecie (wzór 0)
    const parkW = Bw.x.mul(float(1.0).sub(water)).mul(float(1.0).sub(snow)).toVar();
    const parkLamp = float(0.0).toVar();
    If(parkW.greaterThan(0.01), () => {
      const cellU = vec2(patT.element(0), 104.0).toVar();
      // zakrzywienie z niskich oktaw szumu (mip 4 kafla 3300 j.: łuki ~200–400 j.,
      // bez drobnych zmarszczek, które dają wzór pęknięć)
      const wuv = vec2(sRel.div(varN.x).add(varOff.x), t.div(varN.x)).toVar();
      const wp = vec2(detail2.sample(wuv).level(4.0).z, detail2.sample(wuv.add(vec2(0.37, 0.61))).level(4.0).z).toVar();
      const pS = sRel.div(patT.element(0)).add(patF.element(0)).add(wp.x.mul(0.9)).toVar();
      const pT = t.div(104.0).add(wp.y.mul(0.8)).toVar();
      const pf = vec2(fract(pS), fract(pT)).toVar();
      const pid = vec2(haloWrapI(floor(pS).add(patI.element(0)), patN.element(0)), floor(pT)).toVar();
      const fwu = max(fwidth(pS).mul(cellU.x), fwidth(pT).mul(cellU.y)).toVar();
      const ed = min(pf, vec2(1.0).sub(pf)).mul(cellU).toVar();
      const pathK = float(1.0).sub(smoothstep(1.6, float(1.6).add(fwu), min(ed.x, ed.y))).toVar();
      const dq = pf.sub(0.5).mul(cellU).toVar();
      const hd = haloHash12(pid.add(17.0)).toVar();
      const sgn = hd.greaterThan(0.82).select(-1.0, 1.0);
      const diag = abs(dq.x.mul(cellU.y).sub(sgn.mul(dq.y).mul(cellU.x))).div(length(cellU));
      pathK.assign(max(pathK, float(1.0).sub(smoothstep(1.2, float(1.2).add(fwu), diag)).mul(step(0.64, hd))));
      // kwietnik (co ~4. komórka bez skosu): koło albo elipsa wzdłuż, obwódka żywopłotu
      const hb = haloHash12(pid.add(5.0)).toVar();
      const bq = dq.div(vec2(hb.greaterThan(0.86).select(1.6, 1.0), 1.0));
      const bedR = float(6.0).add(float(4.0).mul(fract(hb.mul(7.3)))).toVar();
      const bl = length(bq).toVar();
      const bed = float(1.0).sub(smoothstep(bedR.sub(fwu), bedR.add(fwu), bl)).mul(step(0.72, hb)).mul(float(1.0).sub(step(0.64, hd)));
      const hedge = smoothstep(bedR.sub(2.2).sub(fwu), bedR.sub(1.2), bl);
      const hc = fract(hb.mul(13.1)).toVar();
      const bedCol = hc.lessThan(0.4).select(vec3(0.20, 0.045, 0.035),
        hc.lessThan(0.6).select(vec3(0.22, 0.17, 0.035), hc.lessThan(0.8).select(vec3(0.11, 0.05, 0.15), vec3(0.24, 0.24, 0.22)))).toVar();
      // pasy koszenia z bliska (wzór 2: ~7 j. zakotwiczony w świecie)
      const mowFar = float(1.0).sub(smoothstep(0.3, 1.0, fwidth(sRel).div(patT.element(2))));
      const mow = step(0.5, S.haloPat(2, sRel).y).sub(0.5).mul(0.1).mul(mowFar);
      const lawnC = mix(grass, vec3(0.050, 0.118, 0.030), 0.45).mul(float(1.0).add(mow)).toVar();
      bedCol.assign(mix(mix(bedCol, lawnC, 0.3), vec3(0.018, 0.045, 0.014), hedge));
      const pathC = vec3(0.17, 0.16, 0.135).mul(float(0.9).add(float(0.2).mul(var2.y)));
      const parkCol = mix(lawnC, bedCol, bed).toVar();
      // z daleka (ścieżka < ~1 px) średnia pokrycia zamiast migotania
      const pathFar = float(1.0).sub(smoothstep(0.5, 1.0, fwu.div(6.0))).toVar();
      parkCol.assign(mix(parkCol, pathC, mix(0.05, pathK, pathFar)));
      // korony pojedynczych drzew (jak na łąkach, gęstość z lasu parku): z daleka,
      // gdzie siatka drzew 3D już nie sięga, park nie jest gołym trawnikiem
      const pDens = forest.mul(0.9).toVar();
      const pCan = haloSmooth(0.3, 0.12, treeTex.x).mul(step(treeTex.y, pDens.mul(1.6))).toVar();
      pCan.assign(mix(pCan, pDens.mul(0.35), treeFar));
      parkCol.assign(mix(parkCol, forestCol.mul(float(1.3).add(float(0.8).mul(treeTex.y))), pCan));
      // pod koronami kęp drzew zostaje las
      ground.assign(mix(ground, parkCol, parkW.mul(float(1.0).sub(fMask.mul(0.85)))));
      const lampD = length(min(pf, vec2(1.0).sub(pf)).mul(cellU));
      const lampOn = step(0.45, haloHash12(vec2(haloWrapI(floor(pS.add(0.5)).add(patI.element(0)), patN.element(0)), floor(pT.add(0.5))).add(23.0)));
      parkLamp.assign(exp(lampD.negate().mul(lampD).div(18.0)).mul(lampOn).mul(pathFar).mul(parkW).mul(float(1.0).sub(fMask)));
    });

    // ---- zabudowa z mapy (daleki LOD miasta): kwartały, ulice, dachy, parki
    const emit = vec3(0.0).toVar();
    const typeInd = Bw.z.toVar();
    const typeGlass = Bw.w.toVar();
    const typeGarden = Bw.y.toVar();
    const indBlocks = typeInd.greaterThan(0.5).toVar();
    const bk = indBlocks.select(int(1), int(0)).toVar();
    // miasto-ogród: ulice lekko wygięte (warp z szumu zakotwiczonego w świecie)
    const warpS = var0.z.mul(0.35).mul(typeGarden);
    const warpT = var1.z.mul(0.3).mul(typeGarden);
    const cS = sRel.div(patT.element(bk)).add(patF.element(bk)).add(warpS).toVar();
    const flS = floor(cS).toVar();
    const ps = vec2(haloWrapI(flS.add(patI.element(bk)), patN.element(bk)), cS.sub(flS)).toVar();
    const blockT = indBlocks.select(252.0, 118.0).toVar();
    const tb = t.div(blockT).add(warpT).toVar();
    const bid = vec2(ps.x, floor(tb)).toVar();
    const bf = vec2(ps.y, fract(tb)).toVar();
    const fw = vec2(fwidth(cS), fwidth(tb)).toVar();
    const edgeD = min(min(bf.x, float(1.0).sub(bf.x)), min(bf.y, float(1.0).sub(bf.y)));
    const street = float(1.0).sub(aaStep(indBlocks.select(0.035, 0.045), edgeD, max(fw.x, fw.y).mul(0.7))).toVar();
    const lot = floor(bf.mul(vec2(3.0, 2.0))).toVar();
    const lotH = haloHash12(bid.mul(7.0).add(lot).add(3.0)).toVar();
    const bh = haloHash12(bid.add(0.5)).toVar();
    const lotF = fract(bf.mul(vec2(3.0, 2.0))).toVar();
    const lotEdge = min(min(lotF.x, float(1.0).sub(lotF.x)), min(lotF.y, float(1.0).sub(lotF.y))).toVar();
    const fwLot = max(fw.x.mul(3.0), fw.y.mul(2.0));
    const footprint = aaStep(0.14, lotEdge, fwLot);
    const roofA = P.cityRoof.mul(float(0.78).add(float(0.44).mul(lotH))).toVar();
    roofA.assign(mix(roofA, vec3(0.16, 0.115, 0.095), step(0.86, lotH).mul(typeGarden)));
    roofA.assign(mix(roofA, grass.mul(0.8), step(0.72, fract(lotH.mul(7.3))).mul(step(lotH, 0.86)).mul(typeGarden).mul(0.9)));
    roofA.assign(mix(roofA, vec3(0.12, 0.112, 0.10).add(vec3(0.04, 0.012, 0.0).mul(lotH)), typeInd));
    roofA.assign(mix(roofA, vec3(0.20, 0.23, 0.25).add(vec3(0.0, 0.02, 0.05).mul(lotH)).mul(U.uDomeTint), typeGlass.mul(0.8)));
    const yard = mix(grass.mul(0.75), vec3(0.11, 0.11, 0.105), float(0.45).add(float(0.4).mul(typeInd)));
    const park = step(bh, 0.24).mul(float(1.0).sub(typeInd)).toVar();
    // pozorny cień budynku po stronie odwrotnej do słońca (wysokość losowa per działka)
    const sunT = U.uSunDir.sub(up.mul(dot(U.uSunDir, up))).toVar();
    const sunST = normalize(vec2(dot(sunT, eTh), sunT.z).add(1e-5));
    const lotC = lotF.sub(0.5).mul(vec2(patT.element(bk).div(3.0), blockT.div(2.0)));
    const lotHt = float(0.35).add(float(0.65).mul(fract(lotH.mul(13.7)))).toVar();
    const shadowSide = smoothstep(0.0, 0.5, dot(normalize(lotC.add(1e-4)), sunST).negate())
      .mul(float(1.0).sub(smoothstep(0.1, 0.42, lotEdge))).mul(lotHt);
    const blockCol = mix(yard.mul(float(1.0).sub(shadowSide.mul(0.55))), roofA.mul(float(1.0).add(float(0.15).mul(lotHt))), footprint).toVar();
    blockCol.assign(mix(blockCol, grass.mul(0.9).mul(float(0.85).add(float(0.3).mul(crowns))), park));
    If(indBlocks, () => {
      // przemysł (M4 v2): odcisk zestawu brył działki — te same bryły, które
      // haloRingCity.js stawia z bliska (hala szedowa, zbiorniki, silosy, komin,
      // chłodnia, rafineria, kontenery), z pozornym cieniem od słońca
      const lotSz = vec2(patT.element(1).div(3.0), blockT.div(2.0)).toVar();
      const q = lotF.sub(0.5).mul(lotSz).toVar();
      const fwq = max(fw.x.mul(patT.element(1)), fw.y.mul(blockT)).mul(0.5).toVar();
      const ic = vec3(0.075, 0.076, 0.074).mul(U.uIndTopTint).mul(float(0.9).add(float(0.2).mul(fract(lotH.mul(29.0))))).toVar();
      // oznakowanie placu: linie co 12 j. (z daleka średnia)
      const mk = float(1.0).sub(smoothstep(0.3, float(0.3).add(fwq), abs(fract(q.x.div(12.0)).sub(0.5)).mul(12.0).sub(5.6)))
        .mul(float(1.0).sub(smoothstep(1.0, 3.0, fwq)));
      ic.assign(mix(ic, vec3(0.16, 0.15, 0.11), mk.mul(0.35)));
      const czI = max(dot(U.uSunDir, up), 0.06);
      const sdirI = vec2(dot(sunT, eTh), sunT.z.div(max(U.uFloorLine.w, 0.2))).div(czI).toVar();
      const shI = float(0.0).toVar();
      Loop(5, ({ i }) => {
        const part = K.indKitPart(lotH, i).toVar();
        const KA = part.element(0).toVar();
        const KB = part.element(1).toVar();
        If(KB.y.lessThan(0.01), () => { Continue(); });
        const d = q.sub(KA.xy).toVar();
        const isBox = i.lessThan(2);
        const sd = isBox.select(max(abs(d.x).sub(KA.z.mul(0.5)), abs(d.y).sub(KA.w.mul(0.5))), length(d).sub(KA.z));
        const inside = float(1.0).sub(smoothstep(float(-0.5).sub(fwq), float(0.5).add(fwq), sd)).toVar();
        ic.assign(mix(ic, K.indTopColor(KB.z, lotH, d, KA), inside));
        const hTop = KB.x.add(KB.y);
        const sh = isBox.select(K.indSegBox(d, sdirI.mul(hTop), KA.zw.mul(0.5)), K.indSegCircle(d, sdirI.mul(hTop), KA.z));
        shI.assign(max(shI, sh.mul(float(1.0).sub(inside))));
      });
      ic.mulAssign(float(1.0).sub(shI.mul(0.55)));
      blockCol.assign(ic);
    });
    const cityCol = mix(blockCol, P.street, street).toVar();
    const farCity = smoothstep(0.22, 0.6, max(fw.x, fw.y).div(U.uDetailScale)).toVar();
    const cityAvg = mix(P.cityAvg, vec3(0.11, 0.105, 0.095).mul(U.uIndTopTint), typeInd).toVar();
    cityAvg.assign(mix(cityAvg, grass, float(0.25).mul(float(1.0).sub(typeInd))));
    cityCol.assign(mix(cityCol, cityAvg, farCity));
    const cityMask = smoothstep(0.25, 0.5, urban.add(var1.z.mul(0.15))).mul(float(1.0).sub(water)).toVar();
    ground.assign(mix(ground, cityCol, cityMask));

    // odsłonięta konstrukcja: goły metal z niebieskimi liniami (ref. 2)
    const L = U.uSunDir;
    const sunVis = H.haloSunVisibility(p, L).toVar();
    const pp = S.haloPat(3, sRel).toVar();
    const pt = t.div(96.0).toVar();
    const pf2 = vec2(pp.y, fract(pt)).toVar();
    const pw = vec2(fwidth(sRel).div(patT.element(3)), fwidth(pt)).toVar();
    const seam = float(1.0).sub(aaStep(0.03, min(min(pf2.x, float(1.0).sub(pf2.x)), min(pf2.y, float(1.0).sub(pf2.y))), max(pw.x, pw.y)));
    const metal = mix(P.metalA, P.metalB, haloHash12(vec2(pp.x, floor(pt)).add(9.0))).toVar();
    metal.mulAssign(float(1.0).sub(seam.mul(0.5).mul(float(1.0).sub(smoothstep(0.2, 0.6, max(pw.x, pw.y))))));
    const exMask = smoothstep(0.35, 0.6, exposed).mul(float(1.0).sub(water)).toVar();
    ground.assign(mix(ground, metal, exMask));
    const lp = S.haloPat(4, sRel).toVar();
    const lt = t.div(540.0).toVar();
    const lf = abs(vec2(lp.y, fract(lt)).sub(0.5)).toVar();
    const lw = vec2(fwidth(sRel).div(patT.element(4)), fwidth(lt)).toVar();
    const line = float(1.0).sub(aaStep(0.012, lf.y, lw.y)).mul(step(0.5, haloHash12(vec2(floor(lt), 5.0)))).toVar();
    line.assign(max(line, float(1.0).sub(aaStep(0.008, lf.x, lw.x)).mul(0.6)));
    const lineFar = float(1.0).sub(smoothstep(0.08, 0.3, max(lw.x, lw.y)));
    const exDark = float(1.0).sub(smoothstep(0.05, 0.4, H.haloLuma(sunVis).mul(max(dot(Nflat, L), 0.0))));
    emit.addAssign(U.uHdrStrip.mul(line).mul(exMask).mul(mix(0.12, 1.0, lineFar)).mul(exposedLines).mul(mix(0.25, 1.0, exDark)));

    // ---- oświetlenie
    const cz = dot(L, up).toVar();
    const cloudShadow = float(0.0).toVar();
    If(U.uLayers.x.greaterThan(0.5).and(cz.greaterThan(0.02)), () => {
      const hc = U.uCloudParams.x.sub(max(h, 0.0));
      const travel = hc.div(cz).toVar();
      const Lt = L.sub(up.mul(cz)).toVar();
      const dss = dot(Lt, eTh).mul(travel);
      const dtt = Lt.z.mul(travel).div(max(Tz, 0.2));
      const cov = S.haloCloudCover(sRel.add(dss), t.add(dtt), moist, 3);
      cloudShadow.assign(cov.mul(0.72));
    });
    const terrSh = terrainShadow(sRel, t, max(h, 0.0), L, up, eTh, Tz);
    const sunLight = U.uSunColor.mul(sunVis).mul(float(1.0).sub(cloudShadow)).mul(terrSh).toVar();
    const NdL = max(dot(N, L), 0.0);
    const psh = H.haloPlanetshine(p, N);
    const amb = H.haloSkyAmbient(p, N).mul(float(1.0).sub(cloudShadow.mul(0.35))).add(psh).add(vec3(U.uNightAmbient)).toVar();
    // błyski burz (profil: Jowisz): poświata pod błyskającą chmurą
    If(U.uStorm.x.greaterThan(0.001).and(U.uLayers.x.greaterThan(0.5)), () => {
      const flash = H.haloStormFlash(sRel.add(U.uRefBasis.w), t).mul(S.haloCloudCover(sRel, t, moist, 2));
      amb.addAssign(vec3(0.55, 0.62, 0.9).mul(flash).mul(U.uStorm.w).mul(0.15));
    });

    const color = ground.mul(sunLight.mul(NdL).add(amb)).toVar();
    If(water.greaterThan(0.001), () => {
      // ---- woda: Fresnel, odbicie nieba/planety, odblask słońca, głębia, piana
      const depth = max(h.negate(), 0.0).toVar();
      const wuv1 = vec2(sRel.add(U.uTime.mul(3.0)).div(detailN.z).add(detailOff.z), t.add(U.uTime.mul(1.3)).div(detailN.z)).toVar();
      const wuv2 = vec2(sRel.sub(U.uTime.mul(2.1)).div(detailN.y).add(detailOff.y), t.sub(U.uTime.mul(1.7)).div(detailN.y)).toVar();
      const w1 = detail1.sample(wuv1).toVar();
      const w2 = detail1.sample(wuv2).toVar();
      const waveFade = float(1.0).sub(smoothstep(400.0, 6000.0, dist)).toVar();
      const wg = w1.yz.div(detailN.z).mul(0.35).add(w2.yz.div(detailN.y).mul(1.1)).mul(waveFade).toVar();
      const Nw = normalize(Nflat.sub(wg.x.mul(eTh).add(wg.y.mul(eZ)).mul(0.6))).toVar();
      const NdV = clamp(dot(Nw, V), 0.0, 1.0).toVar();
      const fres = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(NdV), 5.0))).toVar();
      const R = reflect(V.negate(), Nw).toVar();
      const oc = U.uPlanet.xyz.sub(p).toVar();
      const tbp = dot(oc, R).toVar();
      const dperp2 = dot(oc, oc).sub(tbp.mul(tbp)).toVar();
      const skyUp = clamp(dot(R, up), 0.0, 1.0);
      const skyCol = mix(P.skyHorizon, P.skyZenith, skyUp).mul(H.haloLuma(sunVis)).mul(0.9).add(vec3(0.004, 0.006, 0.01));
      const refl = vec3(skyCol).toVar();
      If(tbp.greaterThan(0.0).and(dperp2.lessThan(U.uPlanet.w.mul(U.uPlanet.w))), () => {
        const hitN = normalize(p.add(R.mul(tbp.sub(sqrt(U.uPlanet.w.mul(U.uPlanet.w).sub(dperp2))))).sub(U.uPlanet.xyz));
        const pl = dot(hitN, L);
        refl.assign(mix(vec3(0.004, 0.006, 0.012), P.planetLit.mul(U.uSunColor), smoothstep(-0.05, 0.3, pl)));
      });
      const Hs = normalize(L.add(V));
      const rough = mix(0.035, 0.16, float(1.0).sub(waveFade));
      const a2 = rough.mul(rough).toVar();
      const NdH = max(dot(Nw, Hs), 0.0);
      const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
      const Dg = a2.div(float(HALO_PI).mul(dd).mul(dd));
      const spec = min(Dg.mul(fres).mul(0.25).mul(max(dot(Nw, L), 0.0)), 40.0).toVar();
      const absorb = exp(depth.negate().mul(vec3(0.09, 0.035, 0.028))).toVar();
      const bed = mix(beachCol.mul(0.6), rockCol, 0.3);
      const body = mix(P.waterDeep, mix(P.waterShallow, bed, absorb.y.mul(0.7)), absorb).toVar();
      const frozen = haloSmooth(0.1, 0.03, temp).toVar();
      body.assign(mix(body, P.ice, frozen));
      const lit = body.mul(sunLight.mul(max(dot(Nflat, L), 0.0)).mul(0.9).add(amb)).toVar();
      const foamN = detail2.sample(wuv1.mul(2.0)).x;
      const foam = haloSmooth(2.4, 0.2, depth).mul(haloSmooth(0.55, 0.2, foamN)).mul(0.6).mul(waveFade);
      lit.assign(mix(lit, vec3(0.6).mul(sunLight.mul(0.7).add(amb)), foam));
      const wcol = mix(lit, refl, fres.mul(float(1.0).sub(frozen))).add(sunLight.mul(spec).mul(float(1.0).sub(frozen)));
      color.assign(mix(color, wcol, water));
    });

    // ---- światła miast: zapalają się z lokalnego oświetlenia, losowo per działkę
    // (jasne niebo w cieniu ściany to wciąż dzień — liczy się całe otoczenie)
    const dayLight = H.haloLuma(sunVis).mul(max(dot(Nflat, L), 0.0)).mul(float(1.0).sub(cloudShadow.mul(0.6))).add(H.haloLuma(amb).mul(1.5));
    const dark = float(1.0).sub(smoothstep(0.03, 0.28, dayLight)).toVar();
    const thr = float(0.15).add(float(0.7).mul(haloHash12(bid.mul(3.0).add(lot).add(11.0)))).toVar();
    const on = smoothstep(thr.sub(0.12), thr.add(0.12), dark).toVar();
    // dzień (słońce nad horyzontem i poza cieniem planety): cień ściany czy góry
    // to tylko cień pod jasnym niebem, miasto nie przechodzi w tryb nocny
    const dayG = H.haloLuma(H.haloPlanetTransmit(p, L)).mul(smoothstep(-0.02, 0.12, dot(up, L))).toVar();
    on.mulAssign(float(1.0).sub(dayG.mul(0.9)));
    const lampCol = mix(mix(U.uHdrWarm, U.uHdrSodium, typeInd), U.uHdrCool, typeGlass);
    const wpat = S.haloPat(2, sRel).toVar();
    const wt = t.div(7.0);
    const win = step(0.62, haloHash12(vec2(wpat.x, floor(wt)).add(0.37))).mul(float(1.0).sub(park));
    const winAA = smoothstep(0.35, 0.9, fwidth(sRel).div(patT.element(2).mul(U.uDetailScale)));
    // kwartały różnią się jasnością (nieliczne jasne centra, reszta przygaszona),
    // parki ciemne — z daleka miasto to sieć ulic i plam, nie jednolita tafla
    const blockB = float(0.3).add(float(0.7).mul(haloHash12(haloFusedMulAddInt(bid, 3.1, 5.0)))).toVar();
    blockB.mulAssign(blockB);
    const lotDensity = mix(win, 0.3, max(winAA, farCity)).mul(blockB).mul(float(1.0).sub(park));
    // główne ulice jaśniejsze od bocznych (latarnie, bez ruchu — światła aut
    // usunięte 2026-09-24: ruch wdrażany osobno)
    const artery = float(1.0).sub(aaStep(0.018, abs(fract(bid.y.mul(0.3334).add(bf.y.mul(0.3334)).add(0.02)).sub(0.5)), fw.y.mul(0.34)));
    const cityLight = lampCol.mul(lotDensity.mul(float(1.0).sub(street)).mul(0.32).add(street.mul(0.2)).add(artery.mul(0.12)));
    emit.addAssign(cityLight.mul(cityMask).mul(on).mul(U.uLayers.y).mul(U.uNightLights));
    // latarnie parku (stałe, nie ruch): ciepłe punkty na skrzyżowaniach ścieżek
    emit.addAssign(U.uHdrWarm.mul(parkLamp).mul(0.9).mul(smoothstep(0.35, 0.7, dark)).mul(float(1.0).sub(dayG.mul(0.9))).mul(U.uLayers.y).mul(U.uNightLights));
    color.addAssign(emit);

    color.assign(H.haloApplyAir(color, rel, H.haloIGN(H.haloFragCoordGL()), airSteps));
    return vec4(max(color, vec3(0.0)), 1.0);
  })();

  return { vertexNode, fragmentNode };
}

export class HaloTerrain {
  constructor({ layout, uniforms, maps, detail, quality }) {
    this.layout = layout;
    this.uniforms = uniforms;
    this.maps = maps;
    this.detail = detail;
    this.quality = quality;
    this.gridDiv = quality.gridDiv;
    this._placeholders = [];
    this._setupDomain();
    this.surfaceUniforms = this._makeSurfaceUniforms();
    this.material = this._makeMaterial();
    this.geometry = this._makeGeometry(this.gridDiv, quality.maxNodes * 4);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'HaloTerrain';
    this.mesh.frustumCulled = false;
    this.activeNodes = 0;
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this._tmp = new THREE.Vector3();
    this._rangeCache = new Map();
    this.syncMaps();
  }

  _setupDomain() {
    const L = this.layout.circumference;
    const Wf = this.layout.floor.length;
    this.maxLod = HALO_TERRAIN.maxLod;
    const rootCells = this.gridDiv << this.maxLod;           // najdrobniejsze komórki na bok korzenia
    this.rootCount = Math.max(8, Math.round(L / Wf));
    this.Ns = this.rootCount * rootCells;
    this.Nt = rootCells;
    this.ds = L / this.Ns;
    this.dt = Wf / this.Nt;
    this.rootCells = rootCells;
    // zasięgi LOD w świecie: range[k] = lodFactor × rozmiar węzła LOD k
    const nodeWorld0 = this.gridDiv * Math.max(this.ds, this.dt);
    this.ranges = [];
    for (let k = 0; k <= this.maxLod; k++) this.ranges.push(this.quality.lodFactor * nodeWorld0 * (1 << k));
  }

  // Uniformy powierzchni: jeden blok (bufor `haloSurfU`) + węzły tekstur.
  _makeSurfaceUniforms() {
    const L = this.layout.circumference;
    const periodic = (want) => {
      const count = Math.max(1, Math.round(L / want));
      return { count, size: L / count };
    };
    // wzory miasta zakotwiczone w świecie: kwartał ogrodu, kwartał przemysłu,
    // okna, panele metalu, linie świetlne, ruch na arteriach
    this.patterns = [140, 336, 7, 96, 480, 56].map(periodic);
    // dach (M3): drobna komórka i działka dzielą segment konstrukcji bez reszty
    // (segment = korzeń / 8), więc shader i plan brył liczą te same indeksy
    const segCount = this.rootCount * 8;
    this.patterns.push({ count: segCount * HALO_ROOF.cellsPerSegment, size: L / (segCount * HALO_ROOF.cellsPerSegment) });
    this.patterns.push({ count: segCount * HALO_ROOF.lotsPerSegment, size: L / (segCount * HALO_ROOF.lotsPerSegment) });
    this.varPeriods = [3300, 1100, 210, 52].map((w) => periodic(w).size);
    const scales = haloDetailScales(this.layout.circumference);
    const clouds = haloCloudScales(this.layout.circumference);
    const lod = [];
    for (let k = 0; k < MAX_LOD_UNIFORM; k++) {
      const end = k < this.ranges.length ? this.ranges[k] : 1e9;
      const start = k < this.ranges.length ? end * HALO_TERRAIN.morphStart : 1e9;
      lod.push(new THREE.Vector2(start, k >= this.maxLod ? 1e9 : end));
    }
    const block = createUniformBlock({
      uMapSize: new THREE.Vector4(1, 1, 1, 1),        // w, h, 1/w, 1/h
      uDetailN: new THREE.Vector4(scales[0].size, scales[1].size, scales[2].size, scales[3].size),   // okresy kafli detalu [j.]
      uDetailOff: new THREE.Vector4(),                 // fract(s_ref / okres) dla każdej skali
      uCloudS0: new THREE.Vector4(clouds[0].sizeS, clouds[1].sizeS, clouds[2].sizeS, clouds[3].sizeS),
      uCloudT0: new THREE.Vector4(clouds[0].sizeT, clouds[1].sizeT, clouds[2].sizeT, clouds[3].sizeT),
      uCloudOff0: new THREE.Vector4(),                 // fract(s_ref / okres_s)
      uGridInfo: new THREE.Vector4(this.ds, this.dt, this.Ns, 0),   // ds, dt, Ns, refS
      uLodMorph: { array: lod },                       // początek i koniec morphu LOD k [j.]
      uExposedLines: 1,
      uVarN: new THREE.Vector4(...this.varPeriods),    // okresy tekstur zmienności barw [j.]
      uVarOff: new THREE.Vector4(),
      uPatT: { array: this.patterns.map((p) => p.size), type: 'float' },   // wzory: okres L/n
      uPatF: { array: this.patterns.map(() => 0), type: 'float' },        // fract(s_ref / okres)
      uPatI: { array: this.patterns.map(() => 0), type: 'float' },        // floor(s_ref / okres) mod n
      uPatN: { array: this.patterns.map((p) => p.count), type: 'float' }  // n (okresy na obwód)
    }, HALO_SURFACE_BLOCK_NAME);
    const su = block.uniforms;
    Object.defineProperty(su, HALO_SURFACE_BLOCK, { value: block, enumerable: false });
    // tekstury: węzły texture() z teksturą od razu (typ próbkowania wchodzi do wiązań)
    const set = this.maps.current;
    const tex = (t, type) => {
      if (t) return t;
      const ph = placeholderTexture(type);
      this._placeholders.push(ph);
      return ph;
    };
    su.uMapA = surfaceTextureNode(tex(set?.A.texture, THREE.HalfFloatType));
    su.uMapB = surfaceTextureNode(tex(set?.B.texture, THREE.UnsignedByteType));
    su.uMapC = surfaceTextureNode(tex(set?.C.texture, THREE.UnsignedByteType));
    su.uDetail1 = surfaceTextureNode(this.detail.tex1);
    su.uDetail2 = surfaceTextureNode(this.detail.tex2);
    return su;
  }

  _makeMaterial() {
    const { vertexNode, fragmentNode } = makeHaloTerrainNodes({
      u: this.uniforms,
      su: this.surfaceUniforms,
      airSteps: this.quality.airSteps
    });
    const m = new NodeMaterial();
    m.name = 'HaloTerrain';
    m.vertexNode = vertexNode;
    m.fragmentNode = fragmentNode;
    // Siatka węzła ma przód zwrócony ku osi ringu (σ = −1). Dla habitatu
    // w stronę kosmosu powietrze jest po drugiej stronie — rysujemy tył.
    m.side = this.layout.sigma > 0 ? THREE.BackSide : THREE.FrontSide;
    // jak ShaderMaterial w bazie WebGL: bez mgły sceny i bez tone mappingu materiału
    m.fog = false;
    m.toneMapped = false;
    // podgląd wartości jak dawniej (adapter: `.value` wspólne z ringiem i blokiem powierzchni)
    m.uniforms = { ...this.uniforms, ...this.surfaceUniforms };
    return m;
  }

  _makeGeometry(div, capacity) {
    const verts = (div + 1) * (div + 1);
    const pos = new Float32Array(verts * 3);
    let o = 0;
    for (let y = 0; y <= div; y++) {
      for (let x = 0; x <= div; x++) {
        pos[o++] = x; pos[o++] = y; pos[o++] = 0;
      }
    }
    const idx = [];
    for (let y = 0; y < div; y++) {
      for (let x = 0; x < div; x++) {
        const a = y * (div + 1) + x;
        const b = a + 1;
        const c = a + div + 1;
        const d = c + 1;
        // przekątna naprzemiennie — mniej widoczny kierunek siatki
        if ((x + y) & 1) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.nodeData = new Float32Array(capacity * 4);
    this.nodeAttr = new THREE.InstancedBufferAttribute(this.nodeData, 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iNode', this.nodeAttr);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.capacity = capacity;
    return g;
  }

  syncMaps() {
    const set = this.maps.current;
    if (!set) return;
    const su = this.surfaceUniforms;
    su.uMapA.value = set.A.texture;
    su.uMapB.value = set.B.texture;
    su.uMapC.value = set.C.texture;
    su.uMapSize.value.set(set.size.w, set.size.h, 1 / set.size.w, 1 / set.size.h);
    this._mapVersion = this.maps.version;
    this._rangeCache.clear();
  }

  // min/max wysokości węzła z mapy CPU (cache po id węzła)
  _heightRange(s0, t0, cells) {
    const key = `${s0}|${t0}|${cells}`;
    let r = this._rangeCache.get(key);
    if (r) return r;
    let lo = 1e9;
    let hi = -1e9;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const s = ((s0 + cells * i / steps) % this.Ns + this.Ns) % this.Ns;
        const t = t0 + cells * j / steps;
        const h = this.maps.heightAtUV(s / this.Ns, t / this.Nt);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    r = [Math.max(0, lo) - 60, Math.max(0, hi) + 70];
    if (this._rangeCache.size > 20000) this._rangeCache.clear();
    this._rangeCache.set(key, r);
    return r;
  }

  _nodeSphere(sAbs0, t0, cells, out) {
    const layout = this.layout;
    const sMid = (sAbs0 + cells * 0.5) * this.ds;
    const tMid = (t0 + cells * 0.5) * this.dt;
    const range = this._heightRange(sAbs0, t0, cells);
    const hMid = (range[0] + range[1]) * 0.5;
    layout.floorPoint(sMid, tMid, hMid, this._pt || (this._pt = {}));
    const sLen = cells * this.ds;
    const tLen = cells * this.dt;
    const sag = sLen * sLen / (8 * layout.radii.floorMid);
    const radius = 0.5 * Math.hypot(sLen, tLen) + (range[1] - range[0]) * 0.5 + sag;
    out.center.set(this._pt.x, this._pt.y, this._pt.z);
    out.radius = radius;
    return out;
  }

  // Wybór węzłów CDLOD dla kamery (pozycja w układzie lokalnym ringu).
  update(view) {
    if (this._mapVersion !== this.maps.version) this.syncMaps();
    const cam = view.camLocal;
    const refS = view.refS;          // w komórkach najdrobniejszej siatki (całkowite)
    this.surfaceUniforms.uGridInfo.value.w = refS;
    this._projScreen.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse);
    this._projScreen.multiply(view.ringMatrixWorld);
    this._frustum.setFromProjectionMatrix(this._projScreen);
    this._count = 0;
    this._cam = cam;
    this._refS = refS;
    const rc = this.rootCells;
    for (let i = 0; i < this.rootCount; i++) {
      const s0 = i * rc;
      if (!this._select(s0, 0, this.maxLod)) this._emit(s0, 0, this.maxLod);
    }
    this.geometry.instanceCount = this._count;
    this.nodeAttr.needsUpdate = true;
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, this._count * 4);
    this.activeNodes = this._count;
  }

  _select(sAbs0, t0, k) {
    const cells = this.gridDiv << k;
    const sphere = this._nodeSphere(sAbs0, t0, cells, this._sphere);
    if (!this._frustum.intersectsSphere(sphere)) return true; // poza kadrem: nic nie kosztuje
    const dist = Math.max(0, sphere.center.distanceTo(this._cam) - sphere.radius);
    if (k < this.maxLod && dist > this.ranges[k]) return false;
    if (k === 0 || dist > this.ranges[k - 1]) {
      this._emit(sAbs0, t0, k);
      return true;
    }
    const half = cells >> 1;
    for (let c = 0; c < 4; c++) {
      const cs = sAbs0 + (c & 1) * half;
      const ct = t0 + (c >> 1) * half;
      if (!this._select(cs, ct, k - 1)) this._emit(cs, ct, k - 1);
    }
    return true;
  }

  _emit(sAbs0, t0, k) {
    if (this._count >= this.capacity) return;
    // s względem refS, zawinięte per węzeł (spójne wewnątrz węzła)
    let rel = sAbs0 - this._refS;
    const Ns = this.Ns;
    rel -= Ns * Math.round(rel / Ns);
    const o = this._count * 4;
    this.nodeData[o] = rel;
    this.nodeData[o + 1] = t0;
    this.nodeData[o + 2] = 0;
    this.nodeData[o + 3] = k;
    this._count++;
  }

  // Przesunięcia wzorów i tekstur względem punktu odniesienia RTE — liczone
  // w double, żeby wzory były przyklejone do świata, a nie do kamery.
  setReference(refSWorld) {
    const su = this.surfaceUniforms;
    const f = (period) => {
      const x = refSWorld / period;
      return x - Math.floor(x);
    };
    const N = su.uDetailN.value;
    su.uDetailOff.value.set(f(N.x), f(N.y), f(N.z), f(N.w));
    const S = su.uCloudS0.value;
    su.uCloudOff0.value.set(f(S.x), f(S.y), f(S.z), f(S.w));
    const V = su.uVarN.value;
    su.uVarOff.value.set(f(V.x), f(V.y), f(V.z), f(V.w));
    for (let i = 0; i < this.patterns.length; i++) {
      const { size, count } = this.patterns[i];
      const x = refSWorld / size;
      const fl = Math.floor(x);
      su.uPatF.value[i] = x - fl;
      su.uPatI.value[i] = ((fl % count) + count) % count;
    }
  }

  get triangleEstimate() {
    return this.activeNodes * this.gridDiv * this.gridDiv * 2;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    for (const t of this._placeholders) t.dispose();
    this._placeholders.length = 0;
  }
}
