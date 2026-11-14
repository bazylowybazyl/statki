// src/3d/hullCity3D/hullCity3D.tsl.js
//
// Materiały MIASTA 3D na grzbiecie okrętu (TSL; opis: docs/OPIS-miasto-3d.md). Wzór: bryła i cień mostka
// (src/3d/bridge3D.tsl.js) — jeden graf na rodzaj rysunku, dane per bryła w przeplecionym buforze instancji.
//
//   createCityBoxMaterial      — BRYŁY: graniastosłup ośmiokątny z instancji (środek, z0 / z1, pół-wymiary, faza,
//                                pochylenie), ciemny masyw z płytami i pasami okien na ścianach, jasna faza krawędzi
//                                dachu (czytelne tarasy z góry), AO kanionów i cień rzucany marszem po MAPIE WYSOKOŚCI
//                                miasta w stronę „słońca cieni”; maska słońca Core3D (sunVisibility / sunFill).
//   createCityReceiverMaterial — CIEŃ MIASTA NA KADŁUBIE: prostokąt POD kadłubem (z < 0, test głębi GREATER — rysuje
//                                się tylko tam, gdzie kadłub zapisał głębię), ten sam marsz.
//   createCityLightMaterial    — ŚWIATŁA: kwady zwrócone do kamery w miejscach z generatora, addytywnie, test głębi;
//                                świecą w stronę normalnej (okno na pionowej ścianie z góry gaśnie), energia zachowana
//                                przy rozmiarze poniżej piksela.
//
// Układ: współrzędne MIASTA = układ okrętu z y sceny (y sceny = −y projektu, zapisane w danych — bez odbicia
// w macierzy, pułapka 37), z w górę; siatka stoi w pozie kadłuba (mesh.position / rotation).
// Pułapki WGSL (reguła webgpu-tsl): próbka mapy wysokości w pętli z przerwaniem — jawny poziom 0; pochodne przed
// gałęziami; smoothstep ze stałymi krawędziami tylko rosnąco; bez pow z ujemną podstawą.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, Discard,
  abs, attribute, cameraProjectionMatrix, ceil, clamp, cos, dot, exp, exp2, float, floor, fract, fwidth, int, length, log2, max, min, mix,
  mod, modelViewMatrix, normalize, positionGeometry, normalGeometry, select, sin, smoothstep, step, texture,
  uniform, uniformArray, varying, varyingProperty, vec2, vec3, vec4, screenSize, renderGroup
} from 'three/tsl';
import { sunFill, sunVisibility } from '../sunShadowMask.js';

/** Przepleciony bufor instancji brył: iA (x, y, z0, z1), iB (hw, hh, faza, pochylenie), iC (materiał, ton, hasz, flagi). */
export const CITY_BOX_LAYOUT = Object.freeze({ stride: 12, iA: 0, iB: 4, iC: 8 });
/** Przepleciony bufor świateł: lA (x, y, z, rozmiar), lB (nx, ny, nz, kod). */
export const CITY_LIGHT_LAYOUT = Object.freeze({ stride: 8, lA: 0, lB: 4 });
export const CITY_SHADOW_STEPS = 48;
export const CITY_MAT_COUNT = 8;

/** Barwy liniowe materiałów (HD_TOWER_MAT): albedo r, g, b + połysk. Ciemny masyw o chłodnym tonie. */
export const CITY_MAT_PALETTE = Object.freeze([
  [0.050, 0.054, 0.062, 0.16],   // 0 cokół
  [0.036, 0.040, 0.050, 0.30],   // 1 ściana wieży
  [0.044, 0.048, 0.058, 0.22],   // 2 płyta tarasu
  [0.010, 0.011, 0.015, 0.10],   // 3 wnęka / szczelina
  [0.070, 0.072, 0.076, 0.20],   // 4 maszyny dachu
  [0.160, 0.165, 0.170, 0.45],   // 5 maszt
  [0.060, 0.066, 0.080, 0.35],   // 6 korona / łącznik
  [0.042, 0.044, 0.050, 0.20]    // 7 hala
]);

/** Barwy świateł (kod barwy z generatora): niebieska, biała, ciepła, czerwona (lampy masztów). */
export const CITY_LIGHT_COLORS = Object.freeze([
  [0.20, 0.52, 1.0], [0.55, 0.78, 1.0], [1.0, 0.70, 0.40], [1.0, 0.16, 0.10]
]);

const SQ2 = Math.SQRT2;

/** Ustawia atrybuty z przeplecionego bufora instancji. */
export function setCityInstanceLayout(geometry, buffer, layout) {
  for (const [name, offset] of Object.entries(layout)) {
    if (name === 'stride') continue;
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
  }
}

const cHash = /*@__PURE__*/ Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)))
  .setLayout({ name: 'cityHash', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * Wspólne węzły modułu: uniformy (grupa render — jeden zapis na klatkę), paleta, mapa wysokości. Mapa to stała tekstura
 * (próbki w grafie są klonami węzła z wartością z chwili budowy) — nowe miasto pisze w nią dane, nie podmienia obiektu.
 */
export function createCityNodes(heightTex) {
  const shared = (v) => uniform(v).setGroup(renderGroup);
  const U = {
    uLight: shared(new THREE.Vector4(0.24, 1.18, 0.3, 2.0)),   // otoczenie, rozproszone, połysk, mnożnik otoczenia dachów
    uSunL: shared(new THREE.Vector3(-0.7, 0.7, 0.01)),         // kierunek do słońca (układ miasta)
    uShadow: shared(new THREE.Vector4(0.58, 0.5, 0.06, 0.55)), // tg wysokości słońca cieni, siła na kadłubie, miękkość, cień w otoczeniu
    uHm: shared(new THREE.Vector4(0, 0, 1, 1)),                // mapa wysokości: x0, y0 (układ miasta), 1 / szer., 1 / wys. [j.]
    uHmTop: shared(new THREE.Vector4(1, 0, 0, 0)),             // szczyt miasta, —, —, —
    uLook: shared(new THREE.Vector4(1, 0.22, 0.05, 1)),        // jasność masywu, ton z wysokością, poświata okien, widoczność
    uLights: shared(new THREE.Vector4(1, 1.4, 0.6, 0.5)),      // jasność świateł, min. rozmiar [px], zasięg poświaty, siła z góry
    uWin: shared(new THREE.Vector4(4, 3.2, 0.05, 0))           // piętro [j.], okno [j.], udział tlących się okien, —
  };
  const pal = [];
  for (const c of CITY_MAT_PALETTE) pal.push(new THREE.Vector4(c[0], c[1], c[2], c[3]));
  const palette = uniformArray(pal, 'vec4').setName('cityPalette');
  const lc = [];
  for (const c of CITY_LIGHT_COLORS) lc.push(new THREE.Vector4(c[0], c[1], c[2], 0));
  const lightColors = uniformArray(lc, 'vec4').setName('cityLightColors');
  const heightNode = texture(heightTex, vec2(0));
  return { U, palette, paletteValues: pal, lightColors, lightColorValues: lc, heightNode, heightTex };
}

/** Biblioteka marszu: wysokość miasta w punkcie, cień w stronę słońca cieni, AO kanionu. */
function cityLib(ctx) {
  const { U, heightNode } = ctx;
  const height = (q) => {
    const t = q.sub(U.uHm.xy).mul(U.uHm.zw).toVar();
    const h = float(0).toVar();
    If(t.x.greaterThan(0.0).and(t.y.greaterThan(0.0)).and(t.x.lessThan(1.0)).and(t.y.lessThan(1.0)), () => {
      h.assign(heightNode.sample(t).level(0).x);
    });
    return h;
  };
  // 1 = w pełni oświetlony. p — punkt (układ miasta), dir — jednostkowy azymut słońca, jit — rozrzut startu.
  const shadow = (p, dir, jit) => {
    const tanE = max(U.uShadow.x, 0.05).toVar();
    const lit = float(1.0).toVar();
    const topK = U.uHmTop.x;
    If(p.z.lessThan(topK), () => {
      const maxT = topK.sub(p.z).div(tanE).toVar();
      // krok rośnie z odległością (~1 j. przy przeszkodzie, ~7,5% drogi dalej): ostry cień u stóp brył bez schodków,
      // daleki koniec cienia wysokiej wieży — rzadziej, tam półcień i tak jest szeroki
      const t = jit.mul(0.8).add(0.35).toVar();
      Loop(CITY_SHADOW_STEPS, () => {
        If(t.greaterThan(maxT), () => { Break(); });
        const rayZ = p.z.add(t.mul(tanE));
        const h = height(p.xy.add(dir.mul(t)));
        // półcień proporcjonalny do drogi (stożek): płaski grunt — (t · tg) / (t · k) > 1, zawsze oświetlony
        lit.assign(min(lit, clamp(rayZ.sub(h).div(t.mul(U.uShadow.z.add(0.12)).add(0.05)), 0.0, 1.0)));
        If(lit.lessThanEqual(0.001), () => { Break(); });
        t.addAssign(max(0.9, t.mul(0.075)).mul(jit.mul(0.3).add(0.85)));
      });
    });
    return lit;
  };
  // AO: ile brył wokół wystaje ponad punkt (kanion między wysokimi ścianami ciemnieje)
  const occlusion = (p, R) => {
    const occ = float(0.0).toVar();
    Loop(8, ({ i }) => {
      const a = float(i).mul(0.7853982).add(0.3927);
      const rr = select(i.bitAnd(1).equal(0), R, R.mul(2.6)).toVar();
      const q = p.xy.add(vec2(cos(a), sin(a)).mul(rr));
      occ.addAssign(clamp(height(q).sub(p.z).div(rr.mul(1.4)), 0.0, 1.0));
    });
    return float(1.0).sub(occ.mul(0.11));
  };
  return { height, shadow, occlusion };
}

// Rozrzut startu marszu przyklejony do świata w komórkach ~1 px ekranu (potęga 2 — stały przy drobnym zoomie; wzór
// b3Dither mostka): szum o częstotliwości piksela zamiast ziarna, nie „gotuje się” z kamerą. Wołać w jednolitym
// przepływie (pochodne), przed gałęziami.
const jitterOf = (p) => {
  const fw = vec3(0).toVar();
  fw.assign(fwidth(p));
  const cell = exp2(ceil(log2(max(max(fw.x, fw.y), max(fw.z, 1e-3))))).toVar();
  const q = floor(p.div(cell)).toVar();
  return fract(float(52.9829189).mul(fract(dot(q.xy, vec2(0.06711056, 0.00583715)).add(q.z.mul(0.0182)))));
};

/** Bryły miasta: jeden materiał na wszystkie (przezroczysty z zapisem głębi, po cieniu na kadłubie — jak mostek). */
export function createCityBoxMaterial(ctx) {
  const { U, palette } = ctx;
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  const top = positionGeometry.z;
  const sxy = positionGeometry.xy;
  const cch = attribute('aCh', 'vec2');
  const fN = normalGeometry;
  // pierścień: dół / wierzch (wierzch wcięty o pochylenie, faza mniejsza o d · (2 − √2))
  const d = iB.w.mul(top);
  const hw = iB.x.sub(d), hh = iB.y.sub(d);
  const ch = max(iB.z.sub(d.mul(2 - SQ2)), 0.0);
  const lx = sxy.x.mul(hw.sub(cch.x.mul(ch)));
  const ly = sxy.y.mul(hh.sub(cch.y.mul(ch)));
  const H = max(iA.w.sub(iA.z), 0.01);
  const z = mix(iA.z, iA.w, top);
  const P = vec3(iA.x.add(lx), iA.y.add(ly), z);
  // normalna: ściana pochylona do środka (wierzch wcięty o bat na wysokości H); wierzch i spód — pionowe
  const side = abs(fN.z).lessThan(0.5);
  const nSide = normalize(vec3(fN.xy.mul(H), iB.w));
  const N = select(side, nSide, fN);
  const vPos = varying(P, 'vCityPos');
  const vN = varying(N, 'vCityN');
  const vLoc = varying(vec3(lx, ly, z.sub(iA.z)), 'vCityLoc');
  const vBoxA = varying(iA, 'vCityA').setInterpolation('flat');
  const vBoxB = varying(iB, 'vCityB').setInterpolation('flat');
  const vBoxC = varying(iC, 'vCityC').setInterpolation('flat');
  const vertexNode = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(P, 1.0));

  const fragmentNode = Fn(() => {
    const L3 = cityLib(ctx);
    const p = vPos.toVar();
    const loc = vLoc.toVar();
    const n = normalize(vN).toVar();
    const A = vBoxA, Bv = vBoxB, C = vBoxC;
    const mi = int(C.x.add(0.5)).toVar();
    const pal = palette.element(mi).toVar();
    const albedo = pal.xyz.mul(C.y).toVar();
    const isTop = n.z.greaterThan(0.85).toVar();
    const isWall = abs(n.z).lessThan(0.85).toVar();
    // ── POCHODNE (jednolity przepływ, przed gałęziami) ──────────────────────────────────────────────────────────
    // wierzch: pół-wymiary rzutu wierzchu, odległość od obrysu (faza krawędzi)
    const tq = Bv.w;
    const thw = Bv.x.sub(tq), thh = Bv.y.sub(tq);
    const tch = max(Bv.z.sub(tq.mul(2 - SQ2)), 0.0);
    const ax = abs(loc.x), ay = abs(loc.y);
    const sdx = ax.sub(thw), sdy = ay.sub(thh), sdc = ax.add(ay).sub(thw.add(thh).sub(tch)).mul(1 / SQ2);
    const sdTop = max(max(sdx, sdy), select(tch.greaterThan(0.01), sdc, float(-1e5))).toVar();
    // ściana: współrzędna wzdłuż ściany (styczna do normalnej rzutu) i wysokość
    const tang = normalize(vec2(n.y.negate(), n.x).add(vec2(1e-5, 0))).toVar();
    const u = dot(loc.xy, tang).toVar();
    const fz = loc.z.toVar();
    // pułapka 29: zmienna TSL powstaje przy pierwszym użyciu — pochodne przypisane jawnie przed gałęziami
    const fwU = float(0).toVar();
    fwU.assign(fwidth(u));
    const fwZ = float(0).toVar();
    fwZ.assign(fwidth(fz));
    const fwP = vec2(0).toVar();
    fwP.assign(fwidth(p.xy));
    // ── WYGLĄD POWIERZCHNI ────────────────────────────────────────────────────────────────────────────────────
    const seam = float(0).toVar();
    const glow = float(0).toVar();
    const edgeN = vec3(0).toVar();
    const rim = float(0).toVar();
    If(isTop, () => {
      // płyty dachu: duże (24 × 16 j.), szwy cieniutkie, ton płyt prawie równy — dach gładki, detal z maszyn na dachu
      const pp = p.xy.div(vec2(24.0, 16.0)).toVar();
      const cell = floor(pp).toVar();
      const fp = fract(pp);
      const dl = min(fp, float(1.0).sub(fp));
      const fw = fwP.div(vec2(24.0, 16.0)).add(vec2(1e-4));
      seam.assign(max(float(1.0).sub(smoothstep(0.006, fw.x.mul(1.5).add(0.006), dl.x)), float(1.0).sub(smoothstep(0.009, fw.y.mul(1.5).add(0.009), dl.y))));
      albedo.mulAssign(cHash(cell.add(C.z.mul(91.0))).mul(0.07).add(0.965).mul(float(1.0).sub(seam.mul(0.18))));
      // faza krawędzi wierzchu (0,9 j.): normalna odchylona na zewnątrz — strona słońca jasna, cienia ciemna
      const bw = float(0.9);
      rim.assign(float(1.0).sub(smoothstep(0.0, bw, sdTop.negate())));
      const dirX = vec2(select(loc.x.greaterThan(0.0), float(1.0), float(-1.0)), 0.0);
      const dirY = vec2(0.0, select(loc.y.greaterThan(0.0), float(1.0), float(-1.0)));
      const dirC = normalize(vec2(select(loc.x.greaterThan(0.0), float(1.0), float(-1.0)), select(loc.y.greaterThan(0.0), float(1.0), float(-1.0))));
      const out = select(sdx.greaterThanEqual(max(sdy, sdc)), dirX, select(sdy.greaterThanEqual(sdc), dirY, dirC));
      edgeN.assign(vec3(out.mul(0.85), 0.53));
      n.assign(normalize(mix(n, edgeN, rim)));
    });
    If(isWall, () => {
      // pasy okien: piętro co uWin.x, pas szyby 0,32–0,74 piętra, słupki co uWin.y; materiały bez okien: wnęka, maszt, maszyny
      const winM = mi.equal(1).or(mi.equal(2)).or(mi.equal(0)).or(mi.equal(6)).or(mi.equal(7)).toVar();
      const fl = fz.div(U.uWin.x).toVar();
      const ff = fract(fl);
      const band = smoothstep(0.30, fwZ.div(U.uWin.x).mul(1.5).add(0.30), ff).mul(float(1.0).sub(smoothstep(0.72, fwZ.div(U.uWin.x).mul(1.5).add(0.72), ff))).toVar();
      const cu = u.div(U.uWin.y).toVar();
      const mull = smoothstep(0.08, fwU.div(U.uWin.y).mul(1.5).add(0.08), min(fract(cu), float(1.0).sub(fract(cu))));
      const glass = band.mul(mull).mul(select(winM, float(1.0), float(0.0))).mul(step(1.2, fz)).mul(step(fz, A.w.sub(A.z).sub(1.0))).toVar();
      albedo.assign(mix(albedo, vec3(0.018, 0.022, 0.03), glass.mul(0.85)));
      // tlące się okna (pod progiem bloomu): rzadko, w grupach po kilka okien
      const wid = vec2(floor(cu), floor(fl));
      const grp = cHash(vec2(floor(wid.x.div(5.0)), wid.y).add(C.z.mul(173.0)));
      const one = cHash(wid.add(C.z.mul(57.0)).add(vec2(n.x.mul(11.0), n.y.mul(7.0))));
      glow.assign(glass.mul(step(grp, U.uWin.z.mul(3.0))).mul(step(one, 0.55)).mul(one.mul(0.6).add(0.4)));
      // poziome szwy płyt elewacji co 2 piętra
      const fs = fract(fl.mul(0.5));
      seam.assign(float(1.0).sub(smoothstep(0.0, fwZ.div(U.uWin.x.mul(2.0)).mul(1.5).add(0.012), min(fs, float(1.0).sub(fs)))).mul(0.5).mul(float(1.0).sub(glass)));
      albedo.mulAssign(float(1.0).sub(seam.mul(0.5)));
    });
    // ton z wysokością (z góry wyższe dachy jaśniejsze — wysokość czytelna bez perspektywy)
    // ton z wysokością: niskie tarasy i kaniony ciemne, grzbiet jaśniejszy (z góry rozpiętość tonów = forma masywu)
    const hk = clamp(p.z.div(max(U.uHmTop.x.mul(0.8), 1.0)), 0.0, 1.0);
    albedo.mulAssign(mix(float(1.0).sub(U.uLook.y.mul(0.35)), float(1.0).add(U.uLook.y.mul(1.4)), hk).mul(U.uLook.x));
    // ── ŚWIATŁO ───────────────────────────────────────────────────────────────────────────────────────────────
    const L = normalize(U.uSunL).toVar();
    const sunDir = L.xy.div(max(length(L.xy), 1e-4)).toVar();
    const jit = jitterOf(p).toVar();
    const sh = L3.shadow(p.add(n.mul(0.35)).add(vec3(0, 0, 0.15)), sunDir, jit).toVar();
    const ao = L3.occlusion(p.add(vec3(0, 0, 0.3)), float(5.0)).toVar();
    // podstawa ścian ciemniej (kanion), wierzch cokołu — pełne otoczenie
    const aoZ = mix(float(0.55), float(1.0), smoothstep(0.0, 26.0, p.z)).toVar();
    const sunVis = sunVisibility().toVar();
    // otoczenie: dachy (n.z → 1) dostają uLight.w × więcej niż ściany — z góry ciemnoszare, ściany ciemne
    const upK = mix(float(0.5), U.uLight.w, max(n.z, 0.0));
    const amb = U.uLight.x.mul(sunFill(sunVis)).mul(upK).mul(ao).mul(aoZ)
      .mul(mix(float(1.0), sh, U.uShadow.w.mul(sunVis)));
    const NdotL = dot(n, L).toVar();
    const dif = max(NdotL, 0.0).mul(U.uLight.y).mul(sh).mul(sunVis);
    const col = albedo.mul(amb.add(dif)).toVar();
    // połysk (Blinn, widok z góry dla ortho — wystarczy przybliżenie)
    const Hh = normalize(L.add(vec3(0.0, 0.0, 1.0)));
    const nh = max(dot(n, Hh), 0.0).toVar();
    const nh4 = nh.mul(nh).mul(nh).mul(nh);
    const nh16 = nh4.mul(nh4).mul(nh4).mul(nh4);
    col.addAssign(vec3(pal.w.mul(U.uLight.z).mul(sh).mul(sunVis).mul(nh16)));
    // chłodne odbicie nieba (słabe — dachy ciemne i gładkie)
    col.addAssign(vec3(0.5, 0.68, 1.0).mul(max(n.z, 0.0).mul(0.004).add(0.0015)).mul(ao));
    // miękkie kolano pod progiem bloomu (0,9): skos w słońcu nie świeci
    const lum = dot(col, vec3(0.2126, 0.7152, 0.0722)).toVar();
    If(lum.greaterThan(0.6), () => {
      col.mulAssign(float(0.6).add(float(0.24).mul(float(1.0).sub(exp(lum.sub(0.6).div(0.24).negate())))).div(lum));
    });
    // tlące się okna (emisja pod progiem)
    col.addAssign(vec3(0.30, 0.55, 0.95).mul(glow.mul(U.uLights.x).mul(0.28)));
    return vec4(col, U.uLook.w);
  })();

  const m = new THREE.NodeMaterial();
  m.name = 'hullCity3D:bryly';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = true;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.vertexNode = vertexNode;
  m.fragmentNode = fragmentNode;
  return m;
}

/**
 * Cień miasta na kadłubie: prostokąt w z = receiverZ (pod kadłubem), test głębi GREATER. Rozmiar i miejsce prostokąta
 * (obrys miasta wydłużony w stronę od słońca) w atrybucie `position` ustawia moduł.
 */
export function createCityReceiverMaterial(ctx, receiverZ) {
  const { U } = ctx;
  const vP = varying(positionGeometry.xy, 'vCityRecv');
  const vertexNode = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionGeometry.xy, receiverZ, 1.0));
  const fragmentNode = Fn(() => {
    const L3 = cityLib(ctx);
    const p = vec3(vP, 0.0).toVar();
    const L = normalize(U.uSunL);
    const sunDir = L.xy.div(max(length(L.xy), 1e-4));
    const sh = L3.shadow(p, sunDir, jitterOf(p)).toVar();
    const ao = L3.occlusion(p, float(4.0)).toVar();
    const dark = float(1.0).sub(sh).mul(U.uShadow.y).mul(sunVisibility()).add(float(1.0).sub(ao).mul(1.4)).toVar();
    dark.assign(min(dark, 0.82).mul(U.uLook.w));
    If(dark.lessThan(0.004), () => { Discard(); });
    return vec4(0.0, 0.0, 0.0, dark);
  })();
  const m = new THREE.NodeMaterial();
  m.name = 'hullCity3D:cien';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.depthFunc = THREE.GreaterDepth;
  m.blending = THREE.NormalBlending;
  m.vertexNode = vertexNode;
  m.fragmentNode = fragmentNode;
  return m;
}

/** Światła miasta: kwady zwrócone do kamery (instancje lA, lB), addytywnie, test głębi bez zapisu. */
export function createCityLightMaterial(ctx) {
  const { U, lightColors } = ctx;
  const vUv = varyingProperty('vec2', 'vCityLUv');
  const vI = varyingProperty('float', 'vCityLI');
  const vCol = varyingProperty('vec3', 'vCityLCol');
  const vKind = varyingProperty('float', 'vCityLKind');
  // Wierzchołek jako Fn z jawnymi zmiennymi (pułapka 39 — bez `select` poza Fn ze wspólnymi węzłami w gałęziach).
  const vertexNode = Fn(() => {
    const lA = attribute('lA', 'vec4');
    const lB = attribute('lB', 'vec4');
    const corner = positionGeometry.xy;
    const mvc = vec4(0).toVar();
    mvc.assign(modelViewMatrix.mul(vec4(lA.xyz, 1.0)));
    const ortho = float(0).toVar();
    ortho.assign(step(0.5, cameraProjectionMatrix.element(3).w));
    // j. świata na piksel w miejscu światła: ortho — stałe, perspektywa — rośnie z głębią
    const pxW = float(0).toVar();
    pxW.assign(float(2.0).mul(mix(mvc.z.negate(), float(1.0), ortho)).div(max(cameraProjectionMatrix.element(0).x.mul(screenSize.x), 1e-6)));
    const minPx = U.uLights.y;
    const sizeEff = float(0).toVar();
    sizeEff.assign(max(lA.w, pxW.mul(minPx)));
    // energia zachowana: mniejsze niż minPx — słabsze, nie większe
    const energy = float(0).toVar();
    energy.assign(clamp(lA.w.div(pxW.mul(minPx)), 0.0, 1.0));
    // kierunek świecenia: normalna w widoku vs kierunek do kamery; (0, 0, 0) — we wszystkie strony
    const nl = float(0).toVar();
    nl.assign(length(lB.xyz));
    const nView = vec3(0).toVar();
    nView.assign(modelViewMatrix.mul(vec4(lB.xyz, 0.0)).xyz.div(max(nl, 1e-4)));
    const toCam = vec3(0).toVar();
    toCam.assign(mix(normalize(mvc.xyz).negate(), vec3(0.0, 0.0, 1.0), ortho));
    const dir = float(0).toVar();
    dir.assign(mix(smoothstep(-0.05, 0.45, dot(nView, toCam)), float(1.0), step(nl, 0.1)));
    const code = lB.w;
    const colI = mod(floor(code.div(4.0)), 4.0);
    const I = float(0).toVar();
    // z góry (ortho) szczeliny, podstawy i lampy przygaszone (uLights.w) — miasto z góry ma być ciemne, nie kropkowane
    const isWin = step(mod(code, 4.0), 0.5);
    const topK = mix(float(1.0), U.uLights.w, ortho.mul(float(1.0).sub(isWin)));
    I.assign(floor(code.div(16.0)).div(63.0).mul(dir).mul(energy).mul(energy).mul(U.uLights.x).mul(U.uLook.w).mul(topK));
    const spread = float(1.0).add(U.uLights.z.mul(3.0));
    vUv.assign(corner.mul(2.0).mul(spread));
    vI.assign(I);
    vCol.assign(lightColors.element(int(colI.add(0.5))).xyz);
    vKind.assign(mod(code, 4.0));
    const out = vec4(2.0, 2.0, 2.0, 1.0).toVar();
    If(I.greaterThanEqual(0.002), () => {
      out.assign(cameraProjectionMatrix.mul(vec4(mvc.xy.add(corner.mul(sizeEff).mul(spread).mul(2.0)), mvc.z, 1.0)));
    });
    return out;
  })();
  const fragmentNode = Fn(() => {
    const r = length(vUv).toVar();
    const core = exp(r.mul(r).mul(-3.2));
    const glowK = exp(r.mul(-1.6)).mul(U.uLights.z).mul(0.16);
    // szczelina i podstawa — rdzeń słabszy; okno i lampa — punkt
    const kSeam = select(vKind.greaterThan(0.5).and(vKind.lessThan(2.5)), float(0.75), float(1.0));
    const e = core.mul(1.25).mul(kSeam).add(glowK).mul(vI).toVar();
    If(e.lessThan(0.003), () => { Discard(); });
    return vec4(vCol.mul(e), 1.0);
  })();
  const m = new THREE.NodeMaterial();
  m.name = 'hullCity3D:swiatla';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.vertexNode = vertexNode;
  m.fragmentNode = fragmentNode;
  return m;
}
