// src/3d/skySphere.tsl.js
//
// NIEBO-SFERA (DECYZJE-2 N1–N3, 2026-10-26): materiały TSL nieba w nieskończoności, obracanego z drogi statku
// (src/3d/skyScroll.js). Obiekty i stan — src/3d/sky3D.js (`SkySphere`), wpięcie — NebulaSystem w planet3d.assets.js.
//
//   • KAMERA Z GÓRY — czworokąt pełnoekranowy w passie tła (warstwa 1, przed płaszczyzną mgławicy): piksel → kierunek
//     rzutem RÓWNOODLEGŁYM wokół środka kadru (r / f = kąt od osi widoku; tempo i smugi równe w całym kadrze także na
//     32:9), kierunek widoku → nieba macierzą `viewMat` (obrót z drogi statku × obrót kadru). Soczewka bańki warpa
//     (skyBend.js) przesuwa piksel PRZED wyznaczeniem kierunku, jak na dawnej płaszczyźnie. Bez rulonu: czworokąt
//     ma `rulonBend = false`, a materiał nie liczy odwrotności walca (rulon nie jest używany w grze — reguła `warp`).
//   • TREŚĆ — tekstura equirect z wypiekacza (public/assets/sky-equirect.webp: galaktyka na wielkim kole + łaty mgławic,
//     bez gwiazd; wartości tekstury po odwróceniu ACES gry jak nebula.webp) + gwiazdy drobne (siatki 1–2) na piksel w
//     przestrzeni kierunków (skyStars.tsl.js: skyStarFieldDir), gasnące przy szybkim niebie (`fineGain`). Jasność strefy
//     gry i smuga cienia słońca — jak w materiale płaszczyzny (createNebulaMaterial).
//   • PAMIĘĆ NIEBA — jak NebulaSystem: materiał zapisu (`cacheWrite`) liczy niebo do celu w rozmiarze bufora sceny,
//     materiał passa czyta go teksel w teksel (`cacheMode` 2), póki obraz nie obróci się o ≥ 0,25 px (sky3D.js).
//   • JASNE GWIAZDY (siatki 3–4 z halo) — kwady instancjonowane na sferze (≤ ~15 tys., katalog z haszu — te same
//     gwiazdy co siatki 3–4 liczone na piksel w kamerach 3D): gęstość i odcień z tekstury w miejscu gwiazdy (próbka w
//     wierzchołku), w skoku smuga wzdłuż KURSU na ekranie (WARP_STARS.heading — jeden wektor, nie wachlarz; długość
//     warstwy deep GameStars) i front wyjścia od dziobu (WARP_STARS.frontPx), światło dokładane tak, jak na pikselu
//     płaszczyzny: acesGryInv((gładkie + gwiazda) · jasność) − acesGryInv(gładkie · jasność).
//   • KAMERY 3D — sfera wokół oka (sky3D.js: Sky3D) z tą samą treścią, kierunek ze sceny macierzą `worldMat`; siatki
//     3–4 na piksel (3 × 3), bo kwadów tam nie ma.
import * as THREE from 'three/webgpu';
import {
  Fn, If, asin, atan, attribute, clamp, cos, dot, exp, float, fwidth, length, log, max, mix, normalize, positionGeometry,
  positionLocal, pow, screenCoordinate, screenSize, sin, smoothstep, sqrt, texture, uint, uniform, varyingProperty,
  viewportSize, vec2, vec3, vec4
} from 'three/tsl';
import { acesGry } from './tsl/kolorGry.js';
import { acesGryInv } from './skybake/skyGameColor.js';
import { skyHashCpu } from './skybake/skyBakeNoise.js';
import { SKY_STARS_TUNE, SKY_SPHERE_STARS, SKY_SPHERE_TEX_PER_RAD, skyStarFieldDir, skyCubeFaceCpu, skyCubeCellSolidAngleCpu } from './skyStars.tsl.js';
import { WARP_SKY_BEND, warpSkyBendOffset } from './warp/skyBend.js';
import { WARP_STARS } from './warp/stars.js';
import { sunShaftBackdrop } from './sunShadowMask.js';

const LUMA = [0.2126, 0.7152, 0.0722];
const TAU = Math.PI * 2;

export const SKY_SPHERE_MATERIAL_NAMES = Object.freeze({
  flat: 'SkySphere', flatWrite: 'SkySphere:zapisPamieci', stars: 'SkySphere:gwiazdy', mesh: 'Sky3D:sfera'
});

/** uv equirect kierunku nieba (u = λ / 2π + 0,5, v = 0,5 − φ / π; tekstura z flipY = false — wiersz 0 = biegun N). */
export function skyEquirectUv(d) {
  return vec2(atan(d.y, d.x).div(TAU).add(0.5), float(0.5).sub(asin(clamp(d.z, -1.0, 1.0)).div(Math.PI)));
}

/** Gładkie niebo (obraz wyświetlany, liniowo) w kierunku d — próbka poziomu 0 (bez mipmap, bez pochodnych). */
function skySmooth(U, d) {
  return acesGry(texture(U.equirect.value, skyEquirectUv(d)).level(0).rgb);
}

/** Gęstość gwiazd z gładkiego nieba (jak skyStarField płaszczyzny). */
function starDensity(smooth, tune = SKY_STARS_TUNE) {
  const lum = max(dot(smooth, vec3(...LUMA)), 1e-5);
  return clamp(float(tune.densBg).add(float(1.0 - tune.densBg).mul(smoothstep(tune.lumSky, tune.lumCore, lum))), 0.0, tune.densMax);
}

/**
 * Uniformy wspólne (jeden zestaw na niebo): equirect (TextureNode), viewMat (widok → niebo), skyToView (niebo → widok),
 * worldMat (scena → niebo), focal [px bufora / rad], fineGain, brightness, cacheMode + cache (pamięć nieba).
 */
export function createSkySphereUniforms(equirectTexture, cacheTexture) {
  return {
    equirect: texture(equirectTexture, vec2(0.5)),
    cache: texture(cacheTexture, vec2(0.5)),
    viewMat: uniform(new THREE.Matrix3()),
    skyToView: uniform(new THREE.Matrix3()),
    worldMat: uniform(new THREE.Matrix3()),
    focal: uniform(1712.7),
    fineGain: uniform(1.0),
    brightness: uniform(1.0),
    cacheMode: uniform(0.0),
    starGain: uniform(1.0)
  };
}

function baseMaterial(name) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.lights = false;
  m.fog = false;
  m.depthWrite = false;
  m.depthTest = false;
  // Czworokąt pełnoekranowy / sfera wokół oka: hak rulonu (rulon.js) ich nie zgina; materiał nie liczy odwrotności walca.
  m.rulonBend = false;
  return m;
}

// ── kamera z góry: czworokąt pełnoekranowy ─────────────────────────────────────────────────────────────────

/** Kierunek widoku piksela (rzut równoodległy): p — px od środka kadru (y w górę), f — px / rad. */
function equidistantViewDir(p, f) {
  const r = length(p).toVar();
  const th = r.div(f);
  const k = sin(th).div(max(r, 1e-4)).toVar();
  return vec3(p.x.mul(k), p.y.mul(k), cos(th).negate());
}

/**
 * Materiał nieba kamery z góry (czworokąt 2 × 2 w NDC). `cacheWrite` — materiał zapisu pamięci nieba (gładkie niebo
 * z gwiazdami, bez jasności strefy i smugi cienia).
 */
export function createSkySphereFlatMaterial(U, { cacheWrite = false } = {}) {
  const m = baseMaterial(cacheWrite ? SKY_SPHERE_MATERIAL_NAMES.flatWrite : SKY_SPHERE_MATERIAL_NAMES.flat);
  m.vertexNode = vec4(positionGeometry.xy, 0.5, 1.0);
  m.fragmentNode = Fn(() => {
    const sc = screenCoordinate.xy.toVar();
    const head = WARP_SKY_BEND.element(0);
    If(head.x.add(head.y).greaterThan(0.5), () => {
      sc.addAssign(warpSkyBendOffset(screenCoordinate.xy));   // px celu, y w dół — jak próbka dawnej płaszczyzny
    });
    const skyNode = () => {
      const p = vec2(sc.x.sub(screenSize.x.mul(0.5)), screenSize.y.mul(0.5).sub(sc.y));
      const d = normalize(U.viewMat.mul(equidistantViewDir(p, U.focal))).toVar();
      const smooth = skySmooth(U, d).toVar();
      const stars = skyStarFieldDir(d, float(1.0).div(U.focal), smooth, uint(1));
      return smooth.add(stars.mul(U.fineGain).mul(U.starGain));
    };
    if (cacheWrite) return vec4(skyNode(), 1.0);
    const sum = vec3(0.0).toVar();
    If(U.cacheMode.greaterThan(1.5), () => {
      sum.assign(texture(U.cache.value, screenCoordinate.xy.div(screenSize)).level(0).rgb);
    }).Else(() => {
      sum.assign(skyNode());
    });
    const color = acesGryInv(sum.mul(U.brightness));
    return vec4(sunShaftBackdrop(color), 1.0);
  })();
  return m;
}

// ── kamery 3D: sfera wokół oka ─────────────────────────────────────────────────────────────────────────────

/** Materiał sfery nieba kamer 3D (BackSide, siatka w oku kamery — sky3D.js). */
export function createSkySphereMeshMaterial(U) {
  const m = baseMaterial(SKY_SPHERE_MATERIAL_NAMES.mesh);
  m.side = THREE.BackSide;
  m.fragmentNode = Fn(() => {
    const dw = normalize(positionLocal).toVar();
    // radiany na piksel z pochodnych — przed gałęziami (pułapki 15, 29)
    const g = vec3(0.0).toVar();
    g.assign(fwidth(dw));
    const radPx = length(g).mul(0.7071).toVar();
    const d = normalize(U.worldMat.mul(dw)).toVar();
    const smooth = skySmooth(U, d).toVar();
    const grids = SKY_SPHERE_STARS.grids.map((_, i) => ({ i, near: i < SKY_SPHERE_STARS.fine ? 2 : 3 }));
    const stars = skyStarFieldDir(d, radPx, smooth, uint(1), { grids });
    const color = acesGryInv(smooth.add(stars.mul(U.starGain)).mul(U.brightness));
    return vec4(color, 1.0);
  })();
  return m;
}

// ── jasne gwiazdy: kwady na sferze ─────────────────────────────────────────────────────────────────────────

/** Rekord gwiazdy w buforze instancji (przeplot, 8 liczb): kierunek nieba (3), próg gęstości, strumień, temperatura, siatka (0 / 1), —. */
export const SKY_STAR_STRIDE = 8;

/**
 * Katalog jasnych gwiazd (siatki ≥ SKY_SPHERE_STARS.fine) — TEN SAM hasz i układ komórek co skyStarFieldDir na GPU
 * (lowbias32, ściany równokątne, sól ściany), więc kwady kamery z góry i siatki 3–4 na piksel kamer 3D to te same
 * gwiazdy. Zostają kandydaci z h0 < prob · densMax · kąt bryłowy; o reszcie decyduje gęstość z tekstury w wierzchołku
 * (próg t = h0 / (prob · kąt bryłowy) < gęstość). Zwraca { data: Float32Array, count }.
 */
export function buildSkyStarCatalog(seed = 1, tune = SKY_STARS_TUNE, sph = SKY_SPHERE_STARS) {
  const rec = [];
  const basis = new Float64Array(9);
  const dir = [0, 0, 0];
  const lim = Math.PI / 4;
  for (let gi = sph.fine; gi < sph.grids.length; gi++) {
    const G = sph.grids[gi];
    const cs = G.cell / SKY_SPHERE_TEX_PER_RAD;
    const i0 = Math.floor(-lim / cs) - 1;
    const i1 = Math.floor(lim / cs) + 1;
    for (let face = 0; face < 6; face++) {
      // oś ściany i osie u, v (jak skyCubeFace): kierunek próbny w środku ściany
      dir[0] = face === 0 ? 1 : face === 1 ? -1 : 0;
      dir[1] = face === 2 ? 1 : face === 3 ? -1 : 0;
      dir[2] = face === 4 ? 1 : face === 5 ? -1 : 0;
      skyCubeFaceCpu(dir, basis);
      const salt = (Math.imul(seed >>> 0, 97) + G.salt + Math.imul(face, 7919)) >>> 0;
      for (let iy = i0; iy <= i1; iy++) {
        for (let ix = i0; ix <= i1; ix++) {
          const ux = (ix + 65536) >>> 0, uy = (iy + 65536) >>> 0;
          const h0 = skyHashCpu(ux, uy, salt);
          if (h0 >= G.prob * tune.densMax) continue;
          const a = (ix + 0.15 + 0.7 * skyHashCpu(ux, uy, salt + 1)) * cs;
          const b = (iy + 0.15 + 0.7 * skyHashCpu(ux, uy, salt + 2)) * cs;
          if (Math.abs(a) > lim || Math.abs(b) > lim) continue;
          const sa = skyCubeCellSolidAngleCpu(a, b);
          const t = h0 / (G.prob * sa);
          if (t >= tune.densMax) continue;
          const ta = Math.tan(a), tb = Math.tan(b);
          let x = basis[0] + basis[3] * ta + basis[6] * tb;
          let y = basis[1] + basis[4] * ta + basis[7] * tb;
          let z = basis[2] + basis[5] * ta + basis[8] * tb;
          const n = Math.sqrt(x * x + y * y + z * z);
          x /= n; y /= n; z /= n;
          const h3 = skyHashCpu(ux, uy, salt + 3);
          const h4 = skyHashCpu(ux, uy, salt + 4);
          const flux = G.fmin * Math.pow(G.fmax / G.fmin, Math.pow(h3, G.gamma));
          rec.push(x, y, z, t, flux, h4, gi - sph.fine, 0);
        }
      }
    }
  }
  return { data: new Float32Array(rec), count: rec.length / SKY_STAR_STRIDE };
}

/** Geometria kwadów: czworokąt (±0,5) × katalog w JEDNYM przeplecionym buforze instancji. */
export function createSkyStarGeometry(catalog) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0
  ]), 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const buf = new THREE.InstancedInterleavedBuffer(catalog.data, SKY_STAR_STRIDE, 1);
  geometry.setAttribute('skyStarDir', new THREE.InterleavedBufferAttribute(buf, 3, 0));
  geometry.setAttribute('skyStarParams', new THREE.InterleavedBufferAttribute(buf, 4, 3));
  geometry.setAttribute('skyStarGrid', new THREE.InterleavedBufferAttribute(buf, 1, 7));
  geometry.instanceCount = catalog.count;
  return geometry;
}

/** Smuga jasnej gwiazdy nieba przy WARP_STARS.stretch = 1 [× stretchPx] (warstwa deep GameStars). */
export const SKY_STAR_STREAK_MUL = 0.22;

/** Materiał kwadów jasnych gwiazd (kamera z góry, rzut równoodległy jak czworokąt nieba). */
export function createSkyStarQuadsMaterial(U, tune = SKY_STARS_TUNE, sph = SKY_SPHERE_STARS) {
  const G3 = sph.grids[sph.fine];
  const G4 = sph.grids[sph.fine + 1];
  const aDir = attribute('skyStarDir', 'vec3');
  const aPar = attribute('skyStarParams', 'vec4');   // t, strumień, temperatura, siatka
  const aGrid = attribute('skyStarGrid', 'float');
  const W = WARP_STARS;
  const vAlong = varyingProperty('float', 'vSkyStarAlong');
  const vSide = varyingProperty('float', 'vSkyStarSide');
  const vLen = varyingProperty('float', 'vSkyStarLen');
  const vSmooth = varyingProperty('vec3', 'vSkyStarSmooth');
  const vColor = varyingProperty('vec3', 'vSkyStarColor');
  const vShape = varyingProperty('vec4', 'vSkyStarShape');   // σ_eff, halo, R halo, norma

  const vertexNode = Fn(() => {
    const out = vec4(2.0, 2.0, 2.0, 1.0).toVar();   // domyślnie poza bryłą obcinania (pułapka 16)
    const half = viewportSize.mul(0.5).toVar();
    // kierunek gwiazdy w osiach widoku i środek w px od środka kadru (y w górę) — rzut równoodległy
    const v = U.skyToView.mul(aDir).toVar();
    const rxy = length(v.xy).toVar();
    const th = atan(rxy, v.z.negate());
    const c = v.xy.mul(th.mul(U.focal).div(max(rxy, 1e-9))).toVar();
    // gładkie niebo w miejscu gwiazdy (gęstość, odcień) — próbka w wierzchołku, poziom 0
    const smooth = skySmooth(U, aDir).toVar();
    const keep = aPar.x.lessThan(starDensity(smooth, tune));
    const g4 = aGrid.toVar();
    const sigma = mix(float(G3.sigma), float(G4.sigma), g4);
    const sigEff = sqrt(sigma.mul(sigma).add(1 / 12)).toVar();
    const halo = mix(float(G3.halo), float(G4.halo), g4).toVar();
    const R = mix(float(G3.haloPx), float(G4.haloPx), g4).toVar();
    const pxT = float(SKY_SPHERE_TEX_PER_RAD).div(U.focal);
    const fluxScale = clamp(float(tune.pxRef).div(pxT), tune.fluxScaleMin, tune.fluxScaleMax).mul(tune.gain).mul(U.starGain);
    const flux = aPar.y.mul(fluxScale).toVar();
    const norm = float(1.0).div(sigEff.mul(sigEff).mul(TAU)).toVar();
    // zasięg kwadu: profil i halo poniżej ~1e-4 obrazu
    const rCore = sigEff.mul(sqrt(max(float(2.0).mul(log(max(flux.mul(norm).div(1e-4), 1.0))), 1.0)));
    const rHalo = R.mul(sqrt(max(sqrt(flux.mul(halo).div(1e-4)).sub(1.0), 0.0)));
    const rMax = max(rCore, rHalo).add(1.0).toVar();
    // smuga w skoku: wzdłuż KURSU na ekranie (jeden wektor), front wyjścia prostuje gwiazdy przed nim (od dziobu)
    const sAlong = dot(c.sub(W.shipPx), W.heading);
    const real = W.frontOn.mul(smoothstep(W.frontPx.sub(60.0), W.frontPx.add(60.0), sAlong));
    const st = W.stretch.mul(float(1.0).sub(real)).toVar();
    const L = st.mul(W.stretchPx).mul(SKY_STAR_STREAK_MUL).toVar();
    const dirT = W.heading.negate().toVar();   // ogon wstecz kursu
    const perp = vec2(dirT.y.negate(), dirT.x);
    const gq = positionGeometry.xy;
    const alongPx = gq.x.add(0.5).mul(L.add(rMax.mul(2.0))).sub(rMax);
    const side = gq.y.mul(2.0).mul(rMax);
    const pix = c.add(dirT.mul(alongPx)).add(perp.mul(side));
    vAlong.assign(alongPx);
    vSide.assign(side);
    vLen.assign(L);
    vSmooth.assign(smooth);
    // barwa: temperatura z odcieniem miejsca (jak płaszczyzna)
    const lum = max(dot(smooth, vec3(...LUMA)), 1e-5);
    const tint = mix(vec3(1.0), clamp(smooth.div(lum), vec3(0.4), vec3(1.8)), tune.tintMix);
    const t = aPar.z;
    const warm = mix(vec3(1.0, 0.68, 0.45), vec3(1.0, 0.9, 0.78), smoothstep(0.0, 0.18, t));
    const white = mix(warm, vec3(0.98, 0.98, 1.0), smoothstep(0.18, 0.4, t));
    const temp = mix(white, vec3(0.7, 0.8, 1.0), smoothstep(0.62, 1.0, t));
    vColor.assign(temp.mul(tint).mul(flux));
    vShape.assign(vec4(sigEff, halo, R, norm));
    // na ekranie i przed kamerą (tył sfery — poza kadrem); gwiazda poza gęstością — zwinięta
    const onScreen = keep.and(th.lessThan(3.0)).and(c.x.abs().lessThan(half.x.add(rMax).add(L)))
      .and(c.y.abs().lessThan(half.y.add(rMax).add(L)));
    If(onScreen, () => {
      out.assign(vec4(pix.div(half), 0.5, 1.0));
    });
    return out;
  })();

  const fragmentNode = Fn(() => {
    const sh = vShape;
    const da = max(max(vAlong.negate(), vAlong.sub(vLen)), 0.0);
    const r2 = da.mul(da).add(vSide.mul(vSide)).toVar();
    // smuga: energia rozłożona na długość (gwiazda w ruchu przez migawkę), punkt (L = 0) — profil jak na pikselu
    const spread = float(1.0).add(vLen.div(sh.x.mul(2.5066)));
    const core = exp(r2.div(sh.x.mul(sh.x)).mul(-0.5)).mul(sh.w).div(spread);
    const haloV = pow(r2.div(sh.z.mul(sh.z)).add(1.0), float(-2.0)).mul(sh.y).div(float(1.0).add(vLen.div(sh.z.mul(2.0))));
    const star = vColor.mul(core.add(haloV));
    const k = U.brightness;
    const add = acesGryInv(vSmooth.add(star).mul(k)).sub(acesGryInv(vSmooth.mul(k)));
    return vec4(sunShaftBackdrop(max(add, vec3(0.0))), 1.0);
  })();

  const m = baseMaterial(SKY_SPHERE_MATERIAL_NAMES.stars);
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.forceSinglePass = true;
  m.vertexNode = vertexNode;
  m.fragmentNode = fragmentNode;
  return m;
}

// ── lustra CPU (testy) ─────────────────────────────────────────────────────────────────────────────────────

/** Gęstość gwiazd z gładkiego obrazu wyświetlanego (lustro starDensity). */
export function skyStarDensityFromSmoothCpu(rgb, tune = SKY_STARS_TUNE) {
  const lum = Math.max(rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2], 1e-5);
  const t = Math.min(1, Math.max(0, (lum - tune.lumSky) / (tune.lumCore - tune.lumSky)));
  return Math.min(tune.densMax, Math.max(0, tune.densBg + (1 - tune.densBg) * t * t * (3 - 2 * t)));
}

