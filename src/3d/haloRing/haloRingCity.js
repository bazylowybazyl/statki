// Miasta i zieleń z bliska (M4, v2 po uwadze użytkownika: „za mocny LOD,
// chowają się budynki” i „dzielnica fabryczna — same kwadraty”).
//
// Budynki wyrastają z tych samych kwartałów i działek, które shader terenu
// rysuje z daleka (dachy z mapy, pozorny cień). Zamiast okna działek wokół
// kamery (dawało twardą granicę w kadrze) — KAWAŁKI wzdłuż ringu: instancja =
// kawałek (4 kwartały ogrodu / 1 kwartał przemysłu) na całą szerokość
// habitatu; CPU wybiera kawałki w kadrze (frustum + odległość, na której
// budynek ma jeszcze ≥ ~1 px) i przepisuje bufor tylko przy zmianie wyboru.
// Budynek ginie PŁYNNIE: wysokość maleje z rozmiarem w pikselach, a przy
// dalekiej kamerze całe miasto opada wspólnie (bez granicy w kadrze).
//
// Przemysł: zestaw brył działki z haloRingIndustryKit.js (hala szedowa,
// zbiorniki, silosy, kotłownia z kominem, chłodnia, rafineria, kontenery).
//
// Draw calle: 1 (ogrody/szkło) + 1 (przemysł) + 1 (drzewa).
//
// Port WebGPU (zadanie 09): materiały w TSL (NodeMaterial), 1:1 z dawnym GLSL (GARDEN_VERTEX,
// INDUSTRY_VERTEX, TREE_VERTEX / TREE_FRAGMENT). Fragment budynków = fragment brył megastruktury
// (makeHaloPrimFragment, haloRingMegastructure.js; ogrody — wariant ścian z położenia lokalnego,
// dawne PRIM_FACE_FROM_LOCAL). Wczesne wyjścia wierzchołków (dawne collapse(); return;) to
// zagnieżdżone gałęzie — wierzchołek bez bryły zostaje poza bryłą obcinania, a mapy i detal
// czyta tylko ten, który jeszcze żyje (tańszy od liczenia wszystkiego). Zestaw przemysłowy
// z haloIndKitTSL (haloRingIndustryKit.js), mapy i detal z haloRingSurfaceTSL.
import * as THREE from 'three';
import {
  Fn, If, Loop,
  float, int, vec2, vec3, vec4,
  attribute, varyingProperty, uniform, instanceIndex, positionGeometry, normalGeometry,
  abs, clamp, cos, dot, floor, fract, length, max, mix, mod, normalize, sin, smoothstep, step
} from 'three/tsl';
import { HALO_TAU, haloPortSites, haloQualityLod } from './haloRingConfig.js';
import { HALO_MEGA_AIR_STEPS, haloNodeMaterial, haloPrimVaryings, makeHaloPrimFragment } from './haloRingMegastructure.js';
import { IND_PARTS, haloIndKitTSL } from './haloRingIndustryKit.js';
import { haloFma, haloHash12, haloHash22, haloRingSurfaceTSL, haloRingTSL, haloSmooth, haloWrapI } from './haloRingTSL.js';
import { nodeOf } from './haloUniformsAdapter.js';

export const HALO_CITY = Object.freeze({
  gardenChunkBlocks: 4,      // kwartały ogrodu (140 j.) na kawałek
  industryChunkBlocks: 1,    // kwartały przemysłu (336 j.) na kawałek
  gardenBlockT: 118,         // kwartał w poprzek [j.] — jak w terenie
  industryBlockT: 252,
  maxGardenChunks: 96,
  maxIndustryChunks: 128,
  // najwyższa bryła klasy sektora [j.] → zasięg rysowania z rozmiaru piksela
  maxHeight: Object.freeze({ garden: 125, glass: 480, industrial: 125 }),
  // kawałek wchodzi do rysowania, gdy jego najwyższa bryła ma ≥ 1 px (niżej
  // budynki i tak już opadły: płynne znikanie w shaderze między 0,6 a 1,6 px)
  minPixels: 1.0,
  // wspólne opadanie miasta przy dalekiej kamerze (odległość od podłogi) [j.]
  fadeNear: 17000,
  fadeFar: 30000
});

// Podłoga miasta (dawne GLSL_FLOOR_FRAME): punkt (sRel, t, h) względem kamery, baza lokalna
// podłogi, zmienność barw z mipem 2 i numer kwartału względem odniesienia. Wklejane (tekstura
// detalu i tablice uniformów powierzchni). Jeden obiekt na parę (ring, powierzchnia).
const floorCache = new WeakMap();
function cityFloorTSL(u, su) {
  let F = floorCache.get(su);
  if (F && F.u === u) return F;
  const H = haloRingTSL(u);
  const U = H.uniforms;
  const S = haloRingSurfaceTSL(u, su);
  const detail2 = S.textures.detail2;
  const varN = nodeOf(su.uVarN);
  const varOff = nodeOf(su.uVarOff);
  const patI = nodeOf(su.uPatI);
  const patN = nodeOf(su.uPatN);
  const comp = ['x', 'y', 'z', 'w'];
  F = {
    u, H, U, S,
    floorRel(sRel, t, h) {
      const dr = U.uFloorLine.x.sub(U.uFloorDims.z).add(U.uFloorLine.z.mul(t)).add(U.uHabitat.x.mul(h));
      const z = U.uFloorLine.y.add(U.uFloorLine.w.mul(t));
      return H.haloRelFromPolar(float(sRel).div(U.uFloorDims.z), dr, z);
    },
    // baza podłogi: ex wzdłuż, ey w poprzek (styczna podłogi), ez ku powietrzu (σ)
    frame(sRel) {
      const th = U.uRefBasis.z.add(float(sRel).div(U.uFloorDims.z)).toVar();
      const er = vec3(cos(th), sin(th), 0.0).toVar();
      return {
        ex: vec3(sin(th).negate(), cos(th), 0.0).toVar(),
        ey: er.mul(U.uFloorLine.z).add(vec3(0.0, 0.0, U.uFloorLine.w)).toVar(),
        ez: U.uHabitat.x.mul(er.mul(U.uFloorLine.w).sub(vec3(0.0, 0.0, U.uFloorLine.z))).toVar()
      };
    },
    varLod(k, sRel, t) {
      const T = varN[comp[k]];
      return detail2.sample(vec2(float(sRel).div(T).add(varOff[comp[k]]), float(t).div(T))).level(2.0);
    },
    // kwartał bezwzględny → numer względem kwartału odniesienia (−n/2 .. n/2)
    relBlock(blockAbs, bk) {
      const n = patN.element(bk);
      const rel = haloWrapI(float(blockAbs).sub(patI.element(bk)), n).toVar();
      return rel.greaterThanEqual(n.mul(0.5)).select(rel.sub(n), rel);
    }
  };
  floorCache.set(su, F);
  return F;
}

// Wierzchołek poza bryłą obcinania (dawne collapse()): trójkąty zwiniętej bryły nie rysują się.
const COLLAPSED = [2.0, 2.0, 2.0, 1.0];

// ---- ogrody i szkło: prostopadłościan 8-wierzchołkowy × (bryła + uskok) — dawny GARDEN_VERTEX.
// cityGrid = (kwartały na kawałek, rzędy kwartałów, —, zanik miasta), bldPx = budynek opada między
// N a M px (LOD jakości). Varyingi z haloPrimVaryings({ faceFromLocal: true }).
export function makeHaloGardenVertex({ u, su, cityGrid, pixelAngle, bldPx, v }) {
  const F = cityFloorTSL(u, su);
  const { H, U, S } = F;
  const { mapA, mapB, mapC } = S.textures;
  const patT = nodeOf(su.uPatT);
  const patF = nodeOf(su.uPatF);
  const patN = nodeOf(su.uPatN);
  const blockT = HALO_CITY.gardenBlockT;
  return Fn(() => {
    const aLot = attribute('aLot', 'vec4');         // kwartał w kawałku, rząd kwartałów, działka (0..5), piętro (0/1)
    const iChunk = attribute('iChunk', 'float');    // pierwszy kwartał (bezwzględny) kawałka
    const out = vec4(...COLLAPSED).toVar();
    const T = patT.element(0).toVar();
    const blockAbs = iChunk.add(aLot.x).toVar();
    If(blockAbs.lessThanEqual(patN.element(0).sub(0.5)).and(cityGrid.w.greaterThanEqual(0.01)), () => {
      const rel = F.relBlock(blockAbs, 0).toVar();
      const lx = aLot.z.sub(float(3.0).mul(floor(aLot.z.add(0.5).div(3.0)))).toVar();
      const ly = floor(aLot.z.add(0.5).div(3.0)).toVar();
      const tier = aLot.w.toVar();
      const cLot = rel.add(lx.add(0.5).div(3.0)).toVar();
      const tbLot = aLot.y.add(ly.add(0.5).div(2.0)).toVar();
      // odwrócenie skrzywienia ulic miasta-ogrodu (dwie iteracje), jak w terenie
      const sRel = cLot.sub(patF.element(0)).mul(T).toVar();
      const t = tbLot.mul(blockT).toVar();
      const Bw = mapB.sample(H.haloMapUV(sRel.add(U.uRefBasis.w), t)).level(0.0).toVar();
      If(Bw.y.greaterThan(0.01), () => {
        Loop(2, () => {
          const warpS = F.varLod(0, sRel, t).z.mul(0.35).mul(Bw.y).toVar();
          const warpT = F.varLod(1, sRel, t).z.mul(0.3).mul(Bw.y).toVar();
          sRel.assign(cLot.sub(patF.element(0)).sub(warpS).mul(T));
          t.assign(tbLot.sub(warpT).mul(blockT));
          Bw.assign(mapB.sample(H.haloMapUV(sRel.add(U.uRefBasis.w), t)).level(0.0));
        });
      });
      const typeInd = Bw.z.toVar();
      const typeGlass = Bw.w.toVar();
      If(typeInd.lessThanEqual(0.5).and(t.greaterThanEqual(30.0)).and(t.lessThanEqual(U.uFloorDims.y.sub(30.0))), () => {
        const uvMap = H.haloMapUV(sRel.add(U.uRefBasis.w), t).toVar();
        const A = mapA.sample(uvMap).level(0.0).toVar();
        const C = mapC.sample(uvMap).level(0.0).toVar();
        const water = float(1.0).sub(smoothstep(-0.6, 0.6, A.x));
        const cityMask = smoothstep(0.25, 0.5, C.y.add(F.varLod(1, sRel, t).z.mul(0.15))).mul(float(1.0).sub(water)).toVar();
        const bid = vec2(blockAbs, aLot.y).toVar();
        const lot = vec2(lx, ly);
        const lotH = haloHash12(bid.mul(7.0).add(lot).add(3.0)).toVar();
        const bh = haloHash12(bid.add(0.5));
        const park = step(bh, 0.24).toVar();
        If(park.lessThanEqual(0.5).and(cityMask.greaterThanEqual(0.5)), () => {
          const lotHt = float(0.35).add(float(0.65).mul(fract(lotH.mul(13.7)))).toVar();
          const height = mix(float(10.0).add(float(60.0).mul(lotHt).mul(lotHt)), float(40.0).add(float(250.0).mul(lotHt).mul(lotHt)), typeGlass).toVar();
          const foot = vec2(T.div(3.0), blockT / 2.0).mul(0.72).toVar();
          const size = vec3(foot, height.add(8.0)).toVar();
          const base = max(A.x, 0.0).sub(8.0).toVar();
          const offT = vec2(0.0).toVar();
          // uskok (piętro 1): tylko na wyższych działkach
          const tall = step(0.55, lotHt).mul(step(fract(lotH.mul(5.3)), mix(0.6, 0.95, typeGlass)));
          If(tier.lessThanEqual(0.5).or(tall.greaterThanEqual(0.5)), () => {
            If(tier.greaterThan(0.5), () => {
              base.addAssign(height.add(8.0));
              size.assign(vec3(foot.mul(mix(0.55, 0.62, fract(lotH.mul(3.7)))), height.mul(mix(0.35, 0.7, fract(lotH.mul(9.1))))));
              offT.assign(vec2(fract(lotH.mul(2.3)), fract(lotH.mul(4.9))).sub(0.5).mul(foot.sub(size.xy)).mul(0.8));
            });
            const anchor = F.floorRel(sRel.add(offT.x), t.add(offT.y), base).toVar();
            // płynne znikanie: wysokość maleje, gdy budynek ma < ~1,5 px (dach z mapy zostaje)
            const px = height.add(8.0).div(max(length(anchor), 1.0)).div(pixelAngle);
            const k = smoothstep(bldPx.x, bldPx.y, px).mul(cityGrid.w).toVar();
            If(k.greaterThanEqual(0.02), () => {
              size.assign(vec3(size.xy, size.z.mul(k)));
              const { ex, ey, ez } = F.frame(sRel);
              const lp = positionGeometry.mul(size).toVar();
              const relP = anchor.add(ex.mul(lp.x)).add(ey.mul(lp.y)).add(ez.mul(lp.z)).toVar();
              v.rel.assign(relP);
              v.local.assign(lp);
              v.size.assign(size);
              v.ex.assign(ex);
              v.ey.assign(ey);
              v.ez.assign(ez);
              const greenRoof = step(0.72, fract(lotH.mul(7.3))).mul(step(lotH, 0.86));
              const pal = typeGlass.greaterThan(0.5).select(float(7.0), lotH.greaterThan(0.86).select(float(15.0),
                greenRoof.greaterThan(0.5).select(float(14.0), lotH.greaterThan(0.5).select(float(3.0), float(0.0))))).toVar();
              If(tier.greaterThan(0.5).and(typeGlass.greaterThan(0.5)), () => { pal.assign(7.0); });
              const emit = typeGlass.greaterThan(0.5).select(float(2.0), float(1.0));
              v.mat.assign(pal.add(float(32.0).mul(emit)));
              v.seed.assign(lotH);
              out.assign(H.haloProjectRel(relP));
            });
          });
        });
      });
    });
    return out;
  })();
}

// ---- przemysł: zestaw działki (2 prostopadłościany + 3 walce) — dawny INDUSTRY_VERTEX.
export function makeHaloIndustryVertex({ u, su, cityGrid, pixelAngle, bldPx, v }) {
  const F = cityFloorTSL(u, su);
  const { H, U, S } = F;
  const K = haloIndKitTSL(u);
  const { mapA, mapB, mapC } = S.textures;
  const patT = nodeOf(su.uPatT);
  const patF = nodeOf(su.uPatF);
  const patN = nodeOf(su.uPatN);
  const blockT = HALO_CITY.industryBlockT;
  return Fn(() => {
    const aLot = attribute('aLot', 'vec4');       // kwartał w kawałku, rząd kwartałów, działka (0..5), część (0..4)
    const aPrim = attribute('aPrim', 'float');    // 0 prostopadłościan, 1 walec
    const iChunk = attribute('iChunk', 'float');
    const out = vec4(...COLLAPSED).toVar();
    const T = patT.element(1).toVar();
    const blockAbs = iChunk.add(aLot.x).toVar();
    If(cityGrid.w.greaterThanEqual(0.01).and(blockAbs.lessThanEqual(patN.element(1).sub(0.5))), () => {
      const lx = aLot.z.sub(float(3.0).mul(floor(aLot.z.add(0.5).div(3.0)))).toVar();
      const ly = floor(aLot.z.add(0.5).div(3.0)).toVar();
      const bid = vec2(blockAbs, aLot.y).toVar();
      const lot = vec2(lx, ly);
      const lotH = haloHash12(bid.mul(7.0).add(lot).add(3.0)).toVar();
      const part = int(aLot.w.add(0.5)).toVar();
      const kit = K.indKitPart(lotH, part).toVar();
      const KA = kit.element(0).toVar();
      const KB = kit.element(1).toVar();
      // część nieużywana w tym rodzaju zakładu albo zły prymityw: tanio do kosza
      const wantCyl = part.greaterThanEqual(int(2));
      If(KB.y.greaterThanEqual(0.01).and(aPrim.greaterThan(0.5).equal(wantCyl)), () => {
        const rel = F.relBlock(blockAbs, 1).toVar();
        const cLot = rel.add(lx.add(0.5).div(3.0));
        const tbLot = aLot.y.add(ly.add(0.5).div(2.0));
        const sRel = cLot.sub(patF.element(1)).mul(T).toVar();
        const t = tbLot.mul(blockT).toVar();
        const uvMap = H.haloMapUV(sRel.add(U.uRefBasis.w), t).toVar();
        const Bw = mapB.sample(uvMap).level(0.0).toVar();
        If(Bw.z.greaterThan(0.5).and(t.greaterThanEqual(40.0)).and(t.lessThanEqual(U.uFloorDims.y.sub(40.0))), () => {
          const A = mapA.sample(uvMap).level(0.0).toVar();
          const C = mapC.sample(uvMap).level(0.0).toVar();
          const water = float(1.0).sub(smoothstep(-0.6, 0.6, A.x));
          const cityMask = smoothstep(0.25, 0.5, C.y.add(F.varLod(1, sRel, t).z.mul(0.15))).mul(float(1.0).sub(water)).toVar();
          If(cityMask.greaterThanEqual(0.5), () => {
            const base = max(A.x, 0.0).sub(2.0).add(KB.x).toVar();
            const anchor = F.floorRel(sRel.add(KA.x), t.add(KA.y), base).toVar();
            const px = KB.y.add(KB.x).div(max(length(anchor), 1.0)).div(pixelAngle);
            const k = smoothstep(bldPx.x, bldPx.y, px).mul(cityGrid.w).toVar();
            If(k.greaterThanEqual(0.02), () => {
              const lp = vec3(0.0).toVar();
              const ln = vec3(0.0).toVar();
              const size = vec3(0.0).toVar();
              If(aPrim.lessThan(0.5), () => {
                size.assign(vec3(KA.z, KA.w, KB.y.mul(k)));
                lp.assign(positionGeometry.mul(size));
                ln.assign(normalGeometry);
              }).Else(() => {
                const tt = positionGeometry.z.toVar();
                const rs = K.indCylRadius(KB.w, tt);
                const h = KB.y.mul(k).toVar();
                lp.assign(vec3(positionGeometry.xy.mul(KA.z).mul(rs), tt.mul(h)));
                ln.assign(normalGeometry);
                If(abs(ln.z).lessThan(0.5), () => {
                  const sl = K.indCylSlope(KB.w, tt).mul(KA.z).div(max(h, 1.0));
                  ln.assign(normalize(vec3(ln.xy, sl.negate())));
                });
                size.assign(vec3(KA.z.mul(2.0), KA.z.mul(2.0), h));
              });
              const { ex, ey, ez } = F.frame(sRel.add(KA.x));
              const relP = anchor.add(ex.mul(lp.x)).add(ey.mul(lp.y)).add(ez.mul(lp.z)).toVar();
              v.rel.assign(relP);
              v.normal.assign(normalize(ex.mul(ln.x).add(ey.mul(ln.y)).add(ez.mul(ln.z))));
              v.local.assign(lp);
              v.localN.assign(ln);
              v.size.assign(size);
              v.mat.assign(KB.z);
              // ziarno części jak mad w bazie: lotH·17 z jednym zaokrągleniem (haloFma; odwrotna kolejność 80,4% bit w bit)
              v.seed.assign(fract(haloFma(lotH, 17.0, float(part).mul(0.31))));
              out.assign(H.haloProjectRel(relP));
            });
          });
        });
      });
    });
    return out;
  })();
}

// Drzewa: slot siatki wokół kamery (co 16 j.), gęstość z mapy lasu (też
// kępy i pojedyncze drzewa parków), nabrzeży i ogrodów miasta. Gatunek z
// klimatu (geometria: makeTreeKit): chłód → iglaste, tropiki i ciepłe plaże
// → palmy, nad rzeką i losowo → topole, reszta liściaste (część w odmianach
// ozdobnych: miedź, złoto — więcej w chłodniejszych sektorach). Dawne TREE_VERTEX /
// TREE_FRAGMENT; treeGrid = (sloty wzdłuż, sloty w poprzek, krok [j.], t środka siatki),
// treePx = drzewo rysowane od N px (LOD jakości).
export function haloTreeVaryings() {
  return {
    rel: varyingProperty('vec3', 'vHaloRel'),
    normal: varyingProperty('vec3', 'vHaloNormal'),
    col: varyingProperty('vec3', 'vHaloCol'),
    part: varyingProperty('float', 'vHaloPart')
  };
}

export function makeHaloTreeVertex({ u, su, treeGrid, pixelAngle, treePx, v }) {
  const F = cityFloorTSL(u, su);
  const { H, U, S } = F;
  const { mapA, mapB, mapC } = S.textures;
  // gatunek z klimatu (A: h, odległość od rzeki, wilgoć, temperatura) i losu slotu
  const treeSpecies = (A, r3, r4) => {
    const coldK = float(1.0).sub(smoothstep(0.36, 0.48, A.w));
    const palmK = max(smoothstep(0.68, 0.8, A.w).mul(smoothstep(0.45, 0.6, A.z)),
      smoothstep(0.6, 0.66, A.w).mul(haloSmooth(14.0, 5.0, A.x)).mul(smoothstep(0.55, 0.7, A.z)));
    const poplarK = float(0.1).add(float(0.35).mul(haloSmooth(60.0, 15.0, A.y)));
    return r3.lessThan(coldK).select(float(1.0),
      r4.lessThan(palmK).select(float(3.0), r4.greaterThan(float(1.0).sub(poplarK)).select(float(2.0), float(0.0))));
  };
  return Fn(() => {
    const aSpecies = attribute('aSpecies', 'float');   // −1 pień (wspólny), 0 liściaste, 1 iglaste, 2 topola, 3 palma
    const out = vec4(...COLLAPSED).toVar();
    const NS = treeGrid.x;
    const NT = treeGrid.y;
    const step0 = treeGrid.z;
    const id = float(instanceIndex).toVar();
    const iT = floor(id.add(0.5).div(NS)).toVar();
    const iS = id.sub(NS.mul(iT)).toVar();
    // siatka zakotwiczona w świecie: indeks względem punktu odniesienia
    const cellS = floor(U.uRefBasis.w.div(step0)).sub(floor(NS.mul(0.5))).add(iS).toVar();
    const cellT = floor(treeGrid.w.div(step0)).sub(floor(NT.mul(0.5))).add(iT).toVar();
    const cid = vec2(mod(cellS, 65536.0), cellT).toVar();
    const j = haloHash22(cid.add(0.37)).toVar();
    const sAbsCell = cellS.add(j.x).mul(step0);
    const sRel = sAbsCell.sub(U.uRefBasis.w).toVar();
    const t = cellT.add(j.y).mul(step0).toVar();
    const uvMap = H.haloMapUV(sRel.add(U.uRefBasis.w), t).toVar();
    const A = mapA.sample(uvMap).level(0.0).toVar();
    const r3 = haloHash12(cid.add(13.3)).toVar();
    const r4 = haloHash12(cid.add(17.9)).toVar();
    const species = treeSpecies(A, r3, r4).toVar();
    // wierzchołki innych gatunków do kosza zaraz po mapie A (tanio)
    If(aSpecies.lessThanEqual(-0.5).or(abs(aSpecies.sub(species)).lessThanEqual(0.5)), () => {
      const B = mapB.sample(uvMap).level(0.0).toVar();
      const C = mapC.sample(uvMap).level(0.0).toVar();
      const h = A.x.toVar();
      const water = float(1.0).sub(smoothstep(0.2, 1.5, h)).toVar();
      const snowy = haloSmooth(0.12, 0.04, A.w).add(smoothstep(700.0, 900.0, h));
      const forest = C.x;
      const urban = C.y;
      const riverBank = haloSmooth(40.0, 10.0, A.y).mul(float(1.0).sub(water));
      const density = max(forest.mul(0.9), max(riverBank.mul(0.35), float(1.0).sub(urban).mul(0.12).mul(B.y))).toVar();
      density.mulAssign(float(1.0).sub(water).mul(float(1.0).sub(clamp(snowy, 0.0, 1.0))).mul(float(1.0).sub(C.z))
        .mul(step(8.0, t)).mul(step(t, U.uFloorDims.y.sub(8.0))));
      const r1 = haloHash12(cid.add(5.1)).toVar();
      const r2 = haloHash12(cid.add(9.7)).toVar();
      If(r1.lessThan(density), () => {
        // wymiary gatunku: wysokość [j.], pień (promień, wysokość) w ułamkach wysokości
        const height = mix(7.0, 15.0, r2).toVar();
        const trunk = vec2(0.05, 0.5).toVar();
        If(species.greaterThan(2.5), () => {
          height.assign(mix(9.0, 17.0, r2));
          trunk.assign(vec2(0.024, 0.93));
        }).ElseIf(species.greaterThan(1.5), () => {
          height.assign(mix(12.0, 22.0, r2));
          trunk.assign(vec2(0.03, 0.2));
        }).ElseIf(species.greaterThan(0.5), () => {
          height.assign(mix(9.5, 20.0, r2));
          trunk.assign(vec2(0.035, 0.3));
        });
        const anchor = F.floorRel(sRel, t, max(h, 0.0).sub(1.0)).toVar();
        If(height.div(max(length(anchor), 1.0)).greaterThan(treePx.mul(pixelAngle)), () => {
          const { ex, ey, ez } = F.frame(sRel);
          const lp = vec3(positionGeometry).toVar();
          const nl = vec3(normalGeometry).toVar();
          If(aSpecies.lessThan(-0.5), () => {
            lp.assign(vec3(lp.xy.mul(trunk.x), lp.z.mul(trunk.y)).mul(height));
          }).Else(() => {
            const wj = mix(0.85, 1.2, fract(r2.mul(7.7).add(r3))).toVar();
            lp.assign(vec3(lp.xy.mul(wj), lp.z).mul(height));
            nl.assign(normalize(vec3(nl.xy.div(wj), nl.z)));
          });
          // palma: pień lekko wygięty, pióropusz na jego szczycie
          If(species.greaterThan(2.5), () => {
            const zc = aSpecies.lessThan(-0.5).select(positionGeometry.z, float(1.0)).toVar();
            const ang = r4.mul(97.0).toVar();
            lp.assign(vec3(lp.xy.add(vec2(cos(ang), sin(ang)).mul(float(0.04).add(float(0.1).mul(r3))).mul(height).mul(zc).mul(zc)), lp.z));
          });
          const yaw = fract(r1.mul(13.7).add(r3)).mul(6.2831).toVar();
          const cs = vec2(cos(yaw), sin(yaw)).toVar();
          lp.assign(vec3(cs.x.mul(lp.x).sub(cs.y.mul(lp.y)), cs.y.mul(lp.x).add(cs.x.mul(lp.y)), lp.z));
          nl.assign(vec3(cs.x.mul(nl.x).sub(cs.y.mul(nl.y)), cs.y.mul(nl.x).add(cs.x.mul(nl.y)), nl.z));
          const relP = anchor.add(ex.mul(lp.x)).add(ey.mul(lp.y)).add(ez.mul(lp.z)).toVar();
          v.rel.assign(relP);
          v.normal.assign(ex.mul(nl.x).add(ey.mul(nl.y)).add(ez.mul(nl.z)));
          // barwy (albedo liniowe): liściaste wg wilgoci i suszy, część w odmianach
          // ozdobnych; iglaste sine, topola jaśniejsza, palma żółto-zielona na jasnym pniu
          const leaf = mix(vec3(0.030, 0.052, 0.018), vec3(0.020, 0.040, 0.016), A.z).toVar();
          leaf.assign(mix(leaf, vec3(0.055, 0.050, 0.020), smoothstep(0.7, 0.9, A.w).mul(float(1.0).sub(A.z))));
          const bark = vec3(0.035, 0.025, 0.016).toVar();
          If(species.lessThan(0.5), () => {
            const orn = float(0.06).add(float(0.2).mul(haloSmooth(0.56, 0.44, A.w))).toVar();
            const ro = fract(r2.mul(13.1).add(r4.mul(3.7))).toVar();
            If(ro.lessThan(orn), () => {
              leaf.assign(ro.lessThan(orn.mul(0.5)).select(vec3(0.072, 0.028, 0.014), vec3(0.080, 0.062, 0.016)));
            });
          }).ElseIf(species.lessThan(1.5), () => {
            leaf.assign(vec3(0.012, 0.028, 0.018));
            bark.assign(vec3(0.028, 0.019, 0.013));
          }).ElseIf(species.lessThan(2.5), () => {
            leaf.assign(mix(leaf, vec3(0.040, 0.064, 0.020), 0.5));
          }).Else(() => {
            leaf.assign(vec3(0.038, 0.064, 0.020));
            bark.assign(vec3(0.075, 0.062, 0.044));
          });
          v.col.assign(aSpecies.lessThan(-0.5).select(bark, leaf.mul(U.uLeafTint).mul(float(0.75).add(float(0.5).mul(r2)))));
          v.part.assign(aSpecies.lessThan(-0.5).select(float(0.0), float(1.0)));
          out.assign(H.haloProjectRel(relP));
        });
      });
    });
    return out;
  })();
}

export function makeHaloTreeFragment({ u, v, airSteps = HALO_MEGA_AIR_STEPS }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  return Fn(() => {
    const rel = vec3(v.rel).toVar();
    const p = U.uCamLocal.add(rel).toVar();
    const N = normalize(v.normal).toVar();
    const V = normalize(rel).negate().toVar();
    const L = U.uSunDir;
    const up = H.haloUp(p).toVar();
    const sunVis = H.haloSunVisibility(p.add(up.mul(2.0)), L).toVar();
    const leafy = float(v.part).greaterThan(0.5).toVar();
    const wrap = leafy.select(float(0.35), float(0.0)).toVar();
    const NdL = max(dot(N, L).add(wrap).div(float(1.0).add(wrap)), 0.0);
    // prześwit liści: pow(max(dot(−V, L), 0), 4) mnożeniem (jak FXC w bazie)
    const back = max(dot(V.negate(), L), 0.0).toVar();
    const back2 = back.mul(back);
    const trans = leafy.select(back2.mul(back2).mul(0.25), float(0.0));
    const ao = leafy.select(float(0.7).add(float(0.3).mul(max(dot(N, up), 0.0))), float(0.6));
    const amb = H.haloSkyAmbient(p, N).add(vec3(U.uNightAmbient)).toVar();
    const color = vec3(v.col).mul(ao).mul(U.uSunColor.mul(sunVis).mul(NdL.add(trans)).add(amb)).toVar();
    color.assign(H.haloApplyAir(color, rel, H.haloIGN(H.haloFragCoordGL()), airSteps));
    return vec4(max(color, vec3(0.0)), 1.0);
  })();
}

// Prostopadłościan 8-wierzchołkowy (ściana w shaderze z położenia lokalnego):
// x, y ∈ [−0,5; 0,5], z ∈ [0; 1].
const BOX8_POS = [
  [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0],
  [-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]
];
// ściany z nawinięciem przeciwnym do wskazówek zegara patrząc z zewnątrz
const BOX8_IDX = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

function makeGardenChunk(blocks, rows) {
  const count = blocks * rows * 6 * 2;
  const pos = new Float32Array(count * 8 * 3);
  const lot = new Float32Array(count * 8 * 4);
  const idx = new Uint32Array(count * 36);
  let b = 0;
  for (let blk = 0; blk < blocks; blk++) {
    for (let r = 0; r < rows; r++) {
      for (let l = 0; l < 6; l++) {
        for (let tier = 0; tier < 2; tier++) {
          for (let v = 0; v < 8; v++) {
            const k = b * 8 + v;
            pos.set(BOX8_POS[v], k * 3);
            lot[k * 4] = blk;
            lot[k * 4 + 1] = r;
            lot[k * 4 + 2] = l;
            lot[k * 4 + 3] = tier;
          }
          for (let i = 0; i < 36; i++) idx[b * 36 + i] = b * 8 + BOX8_IDX[i];
          b++;
        }
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aLot', new THREE.BufferAttribute(lot, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Walec jednostkowy: promień 1, z ∈ [0, 1], pierścienie pod kształty
// (chłodnia = hiperboloida, komin zwężany), pokrywa u góry.
function makeUnitCylinder(sides = 10, rings = [0, 0.3, 0.6, 0.78, 1.0]) {
  const pos = [];
  const nor = [];
  const idx = [];
  for (let r = 0; r < rings.length; r++) {
    for (let s = 0; s <= sides; s++) {
      const a = s / sides * Math.PI * 2;
      pos.push(Math.cos(a), Math.sin(a), rings[r]);
      nor.push(Math.cos(a), Math.sin(a), 0);
    }
  }
  const row = sides + 1;
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * row + s;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const capStart = pos.length / 3;
  for (let s = 0; s <= sides; s++) {
    const a = s / sides * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 1);
    nor.push(0, 0, 1);
  }
  const center = pos.length / 3;
  pos.push(0, 0, 1);
  nor.push(0, 0, 1);
  for (let s = 0; s < sides; s++) idx.push(capStart + s, capStart + s + 1, center);
  return { pos, nor, idx };
}
function makeUnitBox24() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0, 0.5);
  const pos = Array.from(g.getAttribute('position').array);
  const nor = Array.from(g.getAttribute('normal').array);
  const idx = Array.from(g.index.array);
  g.dispose();
  return { pos, nor, idx };
}

function makeIndustryChunk(blocks, rows) {
  const box = makeUnitBox24();
  const cyl = makeUnitCylinder();
  const lots = blocks * rows * 6;
  const perLot = 2 * box.pos.length / 3 + 3 * cyl.pos.length / 3;
  const idxPerLot = 2 * box.idx.length + 3 * cyl.idx.length;
  const pos = new Float32Array(lots * perLot * 3);
  const nor = new Float32Array(lots * perLot * 3);
  const lot = new Float32Array(lots * perLot * 4);
  const prim = new Float32Array(lots * perLot);
  const idx = new Uint32Array(lots * idxPerLot);
  let v = 0;
  let ii = 0;
  for (let blk = 0; blk < blocks; blk++) {
    for (let r = 0; r < rows; r++) {
      for (let l = 0; l < 6; l++) {
        for (let part = 0; part < IND_PARTS; part++) {
          const src = part < 2 ? box : cyl;
          const base = v;
          const n = src.pos.length / 3;
          for (let k = 0; k < n; k++) {
            pos[v * 3] = src.pos[k * 3]; pos[v * 3 + 1] = src.pos[k * 3 + 1]; pos[v * 3 + 2] = src.pos[k * 3 + 2];
            nor[v * 3] = src.nor[k * 3]; nor[v * 3 + 1] = src.nor[k * 3 + 1]; nor[v * 3 + 2] = src.nor[k * 3 + 2];
            lot[v * 4] = blk; lot[v * 4 + 1] = r; lot[v * 4 + 2] = l; lot[v * 4 + 3] = part;
            prim[v] = part < 2 ? 0 : 1;
            v++;
          }
          for (let k = 0; k < src.idx.length; k++) idx[ii++] = base + src.idx[k];
        }
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aLot', new THREE.BufferAttribute(lot, 4));
  g.setAttribute('aPrim', new THREE.BufferAttribute(prim, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Gatunki drzew: jedna geometria indeksowana (~190 wierzchołków — mniej niż
// dawna korona z ikosaedru bez indeksów). Shader zostawia pień i koronę
// gatunku wylosowanego w slocie, wierzchołki pozostałych zapadają się zaraz
// po odczycie mapy A. Pień (−1) = walec o promieniu i wysokości 1 (skala z
// gatunku w shaderze); korony w ułamkach wysokości drzewa (z: 0 podłoga, 1 czubek).
export const HALO_TREE_SPECIES = Object.freeze(['broadleaf', 'conifer', 'poplar', 'palm']);

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_POS = [
  [-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0],
  [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T],
  [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1]
];
const ICO_IDX = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
  1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
  4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
];
// stały „szum” wierzchołków (nieregularne korony; obrót instancji ukrywa powtórzenie)
const treeJit = (k) => {
  const x = Math.sin(k * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
};

export function makeTreeKit() {
  const pos = [];
  const nor = [];
  const spc = [];
  const idx = [];
  const vert = (species, p, n) => {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0] / l, n[1] / l, n[2] / l);
    spc.push(species);
    return spc.length - 1;
  };
  const tri = (a, b, c) => idx.push(a, b, c);
  // pierścienie wokół osi z: [z, promień, składowa pionowa normalnej, rozrzut promienia]
  const lathe = (species, sides, rings, rot = 0) => {
    const start = spc.length;
    rings.forEach(([z, r, nz, jit = 0], k) => {
      for (let s = 0; s < sides; s++) {
        const a = rot + s / sides * Math.PI * 2;
        const rr = r * (1 + jit * (treeJit(start + k * 17 + s) - 0.5));
        vert(species, [Math.cos(a) * rr, Math.sin(a) * rr, z], [Math.cos(a), Math.sin(a), nz]);
      }
    });
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let s = 0; s < sides; s++) {
        const a = start + k * sides + s;
        const b = start + k * sides + (s + 1) % sides;
        tri(a, b, b + sides);
        tri(a, b + sides, a + sides);
      }
    }
    return start;
  };
  const capTop = (species, ring, sides, apex) => {
    const c = vert(species, apex, [0, 0, 1]);
    for (let s = 0; s < sides; s++) tri(ring + s, ring + (s + 1) % sides, c);
  };
  const capBottom = (species, ring, sides, center) => {
    const c = vert(species, center, [0, 0, -1]);
    for (let s = 0; s < sides; s++) tri(c, ring + (s + 1) % sides, ring + s);
  };

  // pień: graniastosłup 5-boczny zwężany ku górze (3 pierścienie: palma się gnie)
  lathe(-1, 5, [[0, 1, 0], [0.5, 0.85, 0], [1, 0.7, 0]]);

  // 0 liściaste: cztery nieregularne kule (ikosaedr) — szczyt + trzy niżej wokół
  const lobes = [[0, 0, 0.7, 0.3, 0.27]];
  for (let k = 0; k < 3; k++) {
    const a = 0.35 + k * Math.PI * 2 / 3;
    lobes.push([Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.5 + 0.03 * k, 0.215 - 0.008 * k, 0.185]);
  }
  lobes.forEach(([cx, cy, cz, rh, rv], li) => {
    const start = spc.length;
    ICO_POS.forEach((v, k) => {
      const l = Math.hypot(v[0], v[1], v[2]);
      const u = [v[0] / l, v[1] / l, v[2] / l];
      const j = 0.9 + 0.2 * treeJit(li * 31 + k);
      vert(0, [cx + u[0] * rh * j, cy + u[1] * rh * j, cz + u[2] * rv * j], [u[0] / rh, u[1] / rh, u[2] / rv]);
    });
    for (let i = 0; i < ICO_IDX.length; i += 3) tri(start + ICO_IDX[i], start + ICO_IDX[i + 1], start + ICO_IDX[i + 2]);
  });

  // 1 iglaste: trzy piętra stożków (spód lekko wklęsły), piętra obrócone
  [[0.12, 0.62, 0.3], [0.36, 0.84, 0.23], [0.6, 1.0, 0.15]].forEach(([zb, zt, r], k) => {
    const rot = k * 0.45;
    const side = lathe(1, 7, [[zb, r, r / (zt - zb), 0.22]], rot);
    capTop(1, side, 7, [0, 0, zt]);
    const under = spc.length;
    for (let s = 0; s < 7; s++) {
      const p = [pos[(side + s) * 3], pos[(side + s) * 3 + 1], zb];
      vert(1, p, [p[0] * 0.3, p[1] * 0.3, -1]);
    }
    capBottom(1, under, 7, [0, 0, zb + 0.05]);
  });

  // 2 topola: wrzeciono (profil jak topola włoska), wąska i wysoka
  const prof = [[0.1, 0.03], [0.22, 0.1], [0.4, 0.13], [0.62, 0.11], [0.82, 0.065]];
  const pz = [...prof.map((p) => p[0]), 1];
  const pr = [...prof.map((p) => p[1]), 0];
  const ring0 = lathe(2, 6, prof.map(([z, r], k) => {
    const a = Math.max(k - 1, 0);
    const b = k + 1;
    return [z, r, -(pr[b] - pr[a]) / (pz[b] - pz[a]), 0.12];
  }), 0.3);
  capTop(2, ring0 + (prof.length - 1) * 6, 6, [0, 0, 1]);
  capBottom(2, ring0, 6, [0, 0, 0.08]);

  // 3 palma: 7 liści-pióropuszy z czubka pnia (z = 0,93), łuk w górę i opadanie;
  // przekrój Λ (nerw wyżej niż brzegi listków) zamknięty spodem — widać z obu stron
  const nF = 7;
  for (let f = 0; f < nF; f++) {
    const a = f / nF * Math.PI * 2 + (f % 2) * 0.2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const S = [-dy, dx, 0];
    const Lf = 0.42 * (0.85 + 0.3 * treeJit(f * 7 + 3));
    const at = (u) => [dx * Lf * u, dy * Lf * u, 0.935 + Lf * (0.55 * u - 0.95 * u * u)];
    const frame = (u) => {
      const p0 = at(u - 0.02);
      const p1 = at(u + 0.02);
      const T = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const l = Math.hypot(T[0], T[1], T[2]);
      const t = [T[0] / l, T[1] / l, T[2] / l];
      // góra liścia = T × S
      const N = [t[1] * S[2] - t[2] * S[1], t[2] * S[0] - t[0] * S[2], t[0] * S[1] - t[1] * S[0]];
      return { P: at(u), N };
    };
    const sec = [];
    for (const u of [0.12, 0.55]) {
      const { P, N } = frame(u);
      const w = 0.07 * Math.sin(Math.PI * Math.min(u * 1.1, 1));
      const drop = w * 0.35;
      const M = vert(3, P, N);
      const Lv = vert(3, [P[0] + S[0] * w - N[0] * drop, P[1] + S[1] * w - N[1] * drop, P[2] - N[2] * drop], [N[0] + S[0] * 0.35, N[1] + S[1] * 0.35, N[2]]);
      const Rv = vert(3, [P[0] - S[0] * w - N[0] * drop, P[1] - S[1] * w - N[1] * drop, P[2] - N[2] * drop], [N[0] - S[0] * 0.35, N[1] - S[1] * 0.35, N[2]]);
      sec.push({ M, L: Lv, R: Rv });
    }
    const tip = frame(0.98);
    const Tp = vert(3, at(1), tip.N);
    const [i, j] = sec;
    tri(i.M, j.M, j.L); tri(i.M, j.L, i.L);
    tri(i.R, j.R, j.M); tri(i.R, j.M, i.M);
    tri(i.L, j.L, j.R); tri(i.L, j.R, i.R);
    tri(j.M, Tp, j.L); tri(j.R, Tp, j.M); tri(j.L, Tp, j.R);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aSpecies', new THREE.Float32BufferAttribute(spc, 1));
  g.setIndex(idx);
  return g;
}

function instancedTrees(base, count) {
  const geo = new THREE.InstancedBufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
  geo.setIndex(base.index);
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

// Klasa sektora dla kawałków: czy w sektorze stoją budynki danej klasy.
function sectorHas(sector, cls) {
  if (cls === 'industrial') return sector.type === 'industrial';
  return sector.type === 'garden' || sector.type === 'glass';
}

// Wybór kawałków jednej klasy (bez alokacji: bufory stałe).
export class HaloCityChunkSet {
  constructor({ layout, cls, blocksPerChunk, blocks, maxChunks, mesh = null, minPixels = HALO_CITY.minPixels, domes = [] }) {
    this.layout = layout;
    this.cls = cls;
    this.blocksPerChunk = blocksPerChunk;
    this.maxChunks = maxChunks;
    this.minPixels = minPixels;
    this.mesh = mesh;
    this.blocks = blocks;
    this.count = Math.ceil(blocks / blocksPerChunk);
    this.blockLen = layout.circumference / blocks;
    this.chunkAngle = this.blockLen * blocksPerChunk / layout.radii.floorMid;
    // maks. wysokość kawałka z planu sektorów (+ margines przenikania typów ~⅓ sektora)
    this.chunkMaxH = new Float32Array(this.count);
    const H = HALO_CITY.maxHeight;
    const secs = layout.sectors;
    const margin = secs[0].span * 0.34;
    for (let c = 0; c < this.count; c++) {
      const th = (c + 0.5) * this.chunkAngle;
      let h = 0;
      for (const d of [-margin, 0, margin]) {
        const s = secs[layout.sectorIndexAt(th + d)];
        if (!sectorHas(s, cls)) continue;
        h = Math.max(h, cls === 'industrial' ? H.industrial : (s.type === 'glass' ? H.glass : H.garden));
      }
      this.chunkMaxH[c] = h;
    }
    // strefy wokół doków i tranzytów (mapy terenu: pas fabryczny → domy) —
    // budynki stoją tam niezależnie od typu sektora (+ zapas na zafalowanie 700 j.)
    if (layout.sigma > 0 && layout.flightLevel !== 'roof') {
      const R = layout.radii.floorMid;
      for (const site of haloPortSites(R)) {
        const zone = cls === 'industrial' ? site.zoneInd : Math.max(site.zoneRes, site.zoneInd);
        if (!(zone > 0)) continue;
        const halfA = (site.halfS + zone * 1.2 + 700) / R + this.chunkAngle;
        for (let c = 0; c < this.count; c++) {
          let d = (c + 0.5) * this.chunkAngle - site.theta;
          d -= HALO_TAU * Math.round(d / HALO_TAU);
          if (Math.abs(d) <= halfA) this.chunkMaxH[c] = Math.max(this.chunkMaxH[c], cls === 'industrial' ? H.industrial : H.garden);
        }
      }
    }
    // miasta pod kopułami (profil: Mars) — zabudowa ogrodowa pod szkłem
    if (cls !== 'industrial') {
      const R = layout.radii.floorMid;
      for (const dome of domes || []) {
        if (!dome?.city) continue;
        const halfA = (dome.r + 60) / R + this.chunkAngle;
        for (let c = 0; c < this.count; c++) {
          let d = (c + 0.5) * this.chunkAngle - dome.theta;
          d -= HALO_TAU * Math.round(d / HALO_TAU);
          if (Math.abs(d) <= halfA) this.chunkMaxH[c] = Math.max(this.chunkMaxH[c], H.garden);
        }
      }
    }
    this.data = new Float32Array(maxChunks);
    this.attr = typeof THREE.InstancedBufferAttribute === 'function' ? new THREE.InstancedBufferAttribute(this.data, 1) : null;
    this.attr?.setUsage(THREE.DynamicDrawUsage);
    this.sel = new Int32Array(maxChunks);
    this.selN = 0;
    this.next = new Int32Array(maxChunks);
    this._sphere = new THREE.Sphere();
    this._c = new THREE.Vector3();
  }

  // Od kawałka kamery na zewnątrz w obie strony — najbliższe pierwsze.
  select(frustum, camLocal, pixelAngle, fade) {
    const L = this.layout;
    let n = 0;
    if (fade > 0.01) {
      const rMid = L.radii.floorMid;
      const zMid = (L.z.topIn + L.z.botIn) * 0.5;
      let th = Math.atan2(camLocal.y, camLocal.x);
      if (th < 0) th += HALO_TAU;
      const c0 = Math.floor(th / this.chunkAngle);
      const half = Math.hypot(this.chunkAngle * rMid * 0.5, L.floor.length * 0.5);
      const minPx = this.minPixels * Math.max(pixelAngle, 1e-6);
      // Horyzont wypukłej podłogi (habitat na zewnątrz): punkt podłogi dalej
      // kątowo niż acos(Rf/Rc) jest za krzywizną — plus zapas na wysokość brył
      // i pół kawałka. Dla Halo (podłoga wklęsła) bez ograniczenia.
      let horizon = Math.PI;
      if (L.sigma > 0) {
        const Rf = Math.min(L.radii.floorBottom, L.radii.floorTop);
        const Rc = Math.max(Math.hypot(camLocal.x, camLocal.y), Rf + 1);
        horizon = Math.acos(Math.min(1, Rf / Rc)) + Math.acos(Rf / (Rf + HALO_CITY.maxHeight.glass)) + this.chunkAngle * 0.5;
      }
      let stopA = false;
      let stopB = false;
      for (let i = 0; i < this.count && n < this.maxChunks && !(stopA && stopB); i++) {
        for (let side = 0; side < 2; side++) {
          if (i === 0 && side === 1) continue;
          if (side === 0 ? stopA : stopB) continue;
          if (i * this.chunkAngle - this.chunkAngle > horizon) {
            if (side === 0) stopA = true; else stopB = true;
            continue;
          }
          const c = ((c0 + (side === 0 ? i : -i)) % this.count + this.count) % this.count;
          const h = this.chunkMaxH[c];
          const cth = (c + 0.5) * this.chunkAngle;
          this._c.set(Math.cos(cth) * rMid, Math.sin(cth) * rMid, zMid);
          const d = Math.max(0, this._c.distanceTo(camLocal) - half);
          // dalej niż zasięg najwyższej bryły w ogóle — koniec w tę stronę
          if (d * minPx > HALO_CITY.maxHeight.glass) {
            if (side === 0) stopA = true; else stopB = true;
            continue;
          }
          if (h <= 0 || d * minPx > h) continue;
          this._sphere.center.copy(this._c);
          this._sphere.radius = half + h + 50;
          if (frustum && !frustum.intersectsSphere(this._sphere)) continue;
          if (n < this.maxChunks) this.next[n++] = c;
        }
      }
    }
    let changed = n !== this.selN;
    if (!changed) for (let i = 0; i < n; i++) if (this.next[i] !== this.sel[i]) { changed = true; break; }
    if (changed) {
      for (let i = 0; i < n; i++) {
        this.sel[i] = this.next[i];
        this.data[i] = this.next[i] * this.blocksPerChunk;
      }
      this.selN = n;
      if (this.attr) {
        this.attr.needsUpdate = true;
        this.attr.clearUpdateRanges();
        this.attr.addUpdateRange(0, Math.max(1, n));
      }
    }
    if (this.mesh) this.mesh.geometry.instanceCount = n;
    return n;
  }
}

export class HaloCity {
  constructor({ layout, uniforms, surfaceUniforms, quality, domes = [] }) {
    this.layout = layout;
    this.group = new THREE.Group();
    this.group.name = 'HaloCity';
    const common = { ...uniforms, ...surfaceUniforms };
    const u = uniforms;
    const su = surfaceUniforms;
    const side = layout.sigma > 0 ? THREE.FrontSide : THREE.BackSide;
    // uniformy obiektu (TSL): `.value` jak dawne { value } — ten sam kod aktualizacji
    this.pixelAngle = uniform(2 * Math.tan(17.5 * Math.PI / 180) / 1080);
    const Wf = layout.floor.length;
    const C = HALO_CITY;
    // progi LOD z jakości (tryb ultra: dalej, więcej kawałków i drzew)
    const lod = haloQualityLod(quality);
    this.lod = lod;
    this.bldPx = uniform(new THREE.Vector2(lod.buildingPixels[0], lod.buildingPixels[1]));
    this.treePx = uniform(lod.treePixels);
    const gRows = Math.ceil(Wf / C.gardenBlockT);
    const iRows = Math.ceil(Wf / C.industryBlockT);
    // wektory siatek zmieniane w miejscu (zanik miasta, t środka siatki drzew) — węzły je czytają
    this.gardenGrid = new THREE.Vector4(C.gardenChunkBlocks, gRows, 0, 1);
    this.industryGrid = new THREE.Vector4(C.industryChunkBlocks, iRows, 1, 1);
    const gardenGridU = uniform(this.gardenGrid);
    const industryGridU = uniform(this.industryGrid);

    const gv = haloPrimVaryings({ faceFromLocal: true });
    const gardenMat = haloNodeMaterial('HaloCity_garden', {
      vertexNode: makeHaloGardenVertex({ u, su, cityGrid: gardenGridU, pixelAngle: this.pixelAngle, bldPx: this.bldPx, v: gv }),
      fragmentNode: makeHaloPrimFragment({ u, v: gv, faceFromLocal: true })
    }, { side }, { ...common, uCityGrid: gardenGridU, uPixelAngle: this.pixelAngle, uBldPx: this.bldPx });
    const gardenGeo = makeGardenChunk(C.gardenChunkBlocks, gRows);
    const iv = haloPrimVaryings();
    const industryMat = haloNodeMaterial('HaloCity_industry', {
      vertexNode: makeHaloIndustryVertex({ u, su, cityGrid: industryGridU, pixelAngle: this.pixelAngle, bldPx: this.bldPx, v: iv }),
      fragmentNode: makeHaloPrimFragment({ u, v: iv })
    }, { side }, { ...common, uCityGrid: industryGridU, uPixelAngle: this.pixelAngle, uBldPx: this.bldPx });
    const industryGeo = makeIndustryChunk(C.industryChunkBlocks, iRows);
    this.materials = [gardenMat, industryMat];
    this.buildings = [];
    const mk = (geo, mat, name) => {
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.buildings.push(mesh);
      return mesh;
    };
    const gardenMesh = mk(gardenGeo, gardenMat, 'HaloCity_garden');
    const industryMesh = mk(industryGeo, industryMat, 'HaloCity_industry');
    const pn = surfaceUniforms.uPatN.value;
    this.garden = new HaloCityChunkSet({ layout, cls: 'garden', blocksPerChunk: C.gardenChunkBlocks, blocks: pn[0], maxChunks: lod.cityChunks[0], mesh: gardenMesh, minPixels: lod.cityMinPixels, domes });
    this.industry = new HaloCityChunkSet({ layout, cls: 'industrial', blocksPerChunk: C.industryChunkBlocks, blocks: pn[1], maxChunks: lod.cityChunks[1], mesh: industryMesh, minPixels: lod.cityMinPixels });
    gardenGeo.setAttribute('iChunk', this.garden.attr);
    industryGeo.setAttribute('iChunk', this.industry.attr);
    gardenGeo.instanceCount = 0;
    industryGeo.instanceCount = 0;
    this.gardenVerts = gardenGeo.getAttribute('position').count;
    this.industryVerts = industryGeo.getAttribute('position').count;

    // drzewa
    this._tree = makeTreeKit();
    const tns = lod.treeGrid;
    this.treeGrid = new THREE.Vector4(tns, tns, 16, 0);
    const treeGridU = uniform(this.treeGrid);
    const tv = haloTreeVaryings();
    this.treeMaterial = haloNodeMaterial('HaloTrees', {
      vertexNode: makeHaloTreeVertex({ u, su, treeGrid: treeGridU, pixelAngle: this.pixelAngle, treePx: this.treePx, v: tv }),
      fragmentNode: makeHaloTreeFragment({ u, v: tv })
    }, { side }, { ...common, uTreeGrid: treeGridU, uPixelAngle: this.pixelAngle, uTreePx: this.treePx });
    this.trees = new THREE.Mesh(instancedTrees(this._tree, tns * tns), this.treeMaterial);
    this.trees.name = 'HaloTrees';
    this.trees.frustumCulled = false;
    this.treeCount = tns * tns;
    this.group.add(this.trees);
    this._floor = {};
    this.stats = { gardenChunks: 0, industryChunks: 0, fade: 1 };
  }

  update(camLocal, pixelAngle, frustum) {
    const L = this.layout;
    if (pixelAngle > 0) this.pixelAngle.value = pixelAngle;
    const f = L.worldToFloor(camLocal.x, camLocal.y, camLocal.z, this._floor);
    // odległość kamery od podłogi (z boku wstęgi: od najbliższego brzegu)
    const dz = Math.max(L.z.botIn - camLocal.z, 0, camLocal.z - L.z.topIn);
    const camFloor = Math.hypot(Math.abs(f.alt), dz);
    const fadeNear = this.lod.cityFade[0];
    const fadeFar = this.lod.cityFade[1];
    const t = Math.min(1, Math.max(0, (camFloor - fadeNear) / (fadeFar - fadeNear)));
    const fade = 1 - t * t * (3 - 2 * t);
    this.gardenGrid.w = fade;
    this.industryGrid.w = fade;
    this.stats.fade = fade;
    this.stats.gardenChunks = this.garden.select(frustum, camLocal, this.pixelAngle.value, fade);
    this.stats.industryChunks = this.industry.select(frustum, camLocal, this.pixelAngle.value, fade);
    const near = L.isInsideAir(camLocal.x, camLocal.y, camLocal.z) || Math.abs(f.alt) < this.lod.treeAltitude;
    this.trees.geometry.instanceCount = near ? this.treeCount : 0;
    this.treeGrid.w = Math.min(Math.max(f.t, 0), L.floor.length);
  }

  get meshes() {
    return [...this.buildings, this.trees];
  }

  dispose() {
    for (const b of this.buildings) b.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.trees.geometry.dispose();
    this.treeMaterial.dispose();
    this._tree.dispose();
  }
}
