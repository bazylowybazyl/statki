// src/3d/bridge3D.tsl.js
//
// Materiały modelu 3D mostka w TSL (port WebGPU, zadanie 15; docs/webgpu/PLAN.md §3,
// docs/PORT-mostki.md §8). Odpowiednik dawnego GLSL z bridge3D.js:
//   MODEL_VERT / MODEL_FRAG — bryła (światło kadłuba, panele, brud, nity, łatanina
//     piratów, odbicie nieba, wyrwy i przypalony brzeg z obrażeń heksów);
//   B3_FUNC_GLSL — przestrzeń modelu → siatka heksów, komórka, obrażenia, mapa
//     wysokości, marsz cienia w stronę „słońca cieni”, AO;
//   RECEIVER_* — cień modelu na kadłubie (prostokąt POD kadłubem, depthFunc
//     GREATER: rysuje się tylko tam, gdzie kadłub zapisał głębię);
//   EMIT_* — okna, lampy i listwy (warstwa FG, addytywnie, bez maski cieni).
// Wzory 1:1 z WebGL, w tej samej kolejności.
//
// JEDEN GRAF, JEDEN MATERIAŁ na wszystkie rodzaje: stałe rodzaju (obrys i region
// mapy wysokości, szczyt, detal, styl, paleta, połysk) leżą we WSPÓLNEJ tablicy
// uniformów (B3_KIND_STRIDE vec4 na rodzaj), indeksowanej rodzajem z danych
// instancji (aB3State.z) — tak jak dawne tablice uB3HmBounds[B3_KINDS]. Meshe
// rodzajów to zwykłe Mesh z InstancedBufferGeometry (bez uuid obiektu w kluczu
// programu three r183): wszystkie rodzaje dzielą jeden NodeBuilder i pipeline.
// Transformację instancji (baza osi modelu, początek względem mesh.position,
// skala wysokości) niosą atrybuty iBasis / iOrg — shader składa z nich macierz
// instancji jak dawne instanceMatrix (światło i kierunek widoku potrzebują jej
// w wierzchołku). Wszystkie dane instancji w JEDNYM przeplecionym buforze (limit
// 8 buforów wierzchołków na pipeline — model miał ich 11).
//
// OBRAŻENIA: bufor storage u32 (RGBA8 w słowie: R — HP, G — żar, B — maska
// martwych sąsiadów, A — świeże cięcie), wiersz DAMAGE_W komórek na rekord.
// Tekstura obrażeń w WebGPU wysyłała się CAŁA (1,5 MB) przy każdej zmianie —
// backend ignoruje zakresy tekstur; zakresy bufora działają (writeBuffer tylko
// zmienionych komórek rekordu).
//
// Pułapki WGSL: próbkowanie mapy wysokości w pętli marszu z przerwaniem
// (niejednolity przepływ) — jawny poziom 0 (textureSampleLevel; atlas bez mipów,
// ten sam wynik); pochodne (fwidth) tylko w jednolitym przepływie — przed
// warunkami; smoothstep ze stałymi krawędziami tylko rosnąco.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, Discard,
  abs, attribute, cameraProjectionMatrix, ceil, clamp, cos, dot, exp, exp2, float, floor, fract, frontFacing, fwidth,
  int, length, log2, mat3, mat4, max, min, mix, mod, modelViewMatrix, modelWorldMatrix, normalize, positionGeometry,
  pow, select, sin, smoothstep, step, storage, texture, transpose, uint, uniform, uniformArray, varying, vec2, vec3,
  vec4, renderGroup
} from 'three/tsl';
import { heatRamp } from './hexShips3D.tsl.js';
// ── Maska słońca ─────────────────────────────────────────────────────────────
// Funkcje TSL z sunShadowMask.js (zadanie 03): próbka maski Core3D po screenUV na
// wspólnych węzłach uniformów i tekstury — tylko we fragmentach. Model mnoży przez
// sunVisibility() człon słońca (rozproszone, połysk, własny cień), otoczenie przez
// sunFill(); cień modelu na kadłubie gaśnie bez słońca (AO zostaje). Okna, lampy
// i listwy (emitery) maski nie czytają.
import { sunFill, sunVisibility } from './sunShadowMask.js';

// ── Układ danych ─────────────────────────────────────────────────────────────

/** Komórek w wierszu bufora obrażeń (rekord: ceil(komórki / DAMAGE_W) wierszy). */
export const B3_DAMAGE_W = 768;
export const B3_SHADOW_STEPS = 32;

/**
 * Tablica stałych rodzajów: B3_KIND_STRIDE vec4 na rodzaj.
 *  [0] obrys mapy wysokości (x0, y0, 1/szer., 1/wys.) — dawne uB3HmBounds,
 *  [1] region w atlasie (u0, v0, du, dv) — uB3HmRegion,
 *  [2] (szczyt modelu, detal, rdza, niebo) — uB3HmTop, uB3Detail, uB3Coat,
 *  [3] (0, szwy, brud, nity) — uB3Surface,
 *  [4] (wnętrze r, g, b, 0) — uB3Interior,
 *  [5..12] paleta 8 materiałów (r, g, b, wykładnik połysku) — uB3Palette, uB3Spec.x,
 *  [13..20] (mnożnik połysku, 0, 0, 0) — uB3Spec.y.
 */
export const B3_KIND_STRIDE = 21;
export const B3_KIND_SLOT = Object.freeze({
  bounds: 0, region: 1, topDetailCoat: 2, surface: 3, interior: 4, palette: 5, specMul: 13
});

/** Przepleciony bufor instancji bryły (floaty na instancję i przesunięcia). */
export const B3_MODEL_LAYOUT = Object.freeze({
  stride: 30,
  iBasis: 0,     // (ax, ay, bx, by) — osie X / Y modelu → scena
  iOrg: 4,       // (x, y względem mesh.position, skala wysokości, uniesienie z)
  aB3GridA: 8,   // (zgx, zgy, m00, m01) — model → siatka heksów
  aB3GridB: 12,  // (m10, m11, c0, r0) — … i początek bloku komórek
  aB3Dmg: 16,    // (wiersz, szer. bloku, wys. bloku, są wyrwy)
  aB3State: 20,  // (zanik, żar od zapisu, rodzaj, promień heksa > 0 | −komórka belek [px obrazu])
  aB3Hull: 24,   // (światło kadłuba pod środkiem, LOD, 0, 0)
  aB3Mask: 28    // (maska modułów 0–23, 24–47)
});

/** Przepleciony bufor instancji cienia na kadłubie. */
export const B3_RECEIVER_LAYOUT = Object.freeze({
  stride: 24,
  iBasis: 0,
  iOrg: 4,
  aB3GridA: 8,
  aB3GridB: 12,
  aB3Dmg: 16,
  aB3State: 20
});

/** Ustawia atrybuty z przeplecionego bufora instancji na geometrii. */
export function setInstanceLayout(geometry, buffer, layout) {
  for (const [name, offset] of Object.entries(layout)) {
    if (name === 'stride') continue;
    const size = name === 'aB3Mask' ? 2 : 4;
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
  }
}

// ── Pomocniki (czyste funkcje WGSL) ──────────────────────────────────────────

const b3Hash = /*@__PURE__*/ Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)))
  .setLayout({ name: 'b3Hash', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const b3Noise = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));
  return mix(mix(b3Hash(i), b3Hash(i.add(vec2(1.0, 0.0))), f.x),
    mix(b3Hash(i.add(vec2(0.0, 1.0))), b3Hash(i.add(vec2(1.0, 1.0))), f.x), f.y);
}).setLayout({ name: 'b3Noise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// Rozrzut startu marszu cienia (zamiast pasków): szum przyklejony do modelu
// w komórkach ~1 px ekranu (potęga 2 — stały przy drobnym zoomie). Szum
// z gl_FragCoord stał w ekranie i „gotował się” na modelu przy ruchu kamery.
// Wołać w jednolitym przepływie (pochodne), przed discard.
const b3Dither = (p) => {
  const fw = fwidth(p).toVar();
  const cell = exp2(ceil(log2(max(max(fw.x, fw.y), max(fw.z, 1e-3))))).toVar();
  const q = floor(p.div(cell)).toVar();
  return fract(float(52.9829189).mul(fract(dot(q.xy, vec2(0.06711056, 0.00583715)).add(q.z.mul(0.0182)))));
};

// Kierunki sąsiadów (lustro HEX_NEIGHBOR_DIRS w bridge3DShapes.js).
const B3_HEX_DIRS = [
  [0.8660254, 0.5], [0.8660254, -0.5], [0.0, -1.0],
  [-0.8660254, -0.5], [-0.8660254, 0.5], [0.0, 1.0]
];

// Siatka belek (kadłuby gry od zadania 21 — docs/PORT-mostki.md § 9): komórki kwadratowe, maska
// martwych sąsiadów w 8 bitach (lustro BRIDGE3D_SQUARE_NEIGHBORS w bridge3D.js) — boki: +x, +y, −x, −y
// (bity 0–3), narożniki: (+,+), (−,+), (−,−), (+,−) (bity 4–7). Układ siatki: Y w górę.
export const B3_SQUARE_DIRS = Object.freeze([
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1]
]);
// Poszarpany brzeg wyrwy w siatce belek (jak rozdarcia skóry kadłuba — hullTearFray): przy martwym
// sąsiedzie komórka traci pas o szerokości do `frayMax` komórki wg szumu przyklejonego do siatki
// rodu (wyrwa nie „pływa” przy obrocie i jest ta sama na kadłubie, wraku i odłamach).
export const B3_SQUARE_FRAY = Object.freeze({ frayMax: 0.34, period: 0.62, rimMul: 1.7 });

/**
 * Wspólne klocki modelu i cienia: dane instancji jako varyingi (V), tablica
 * rodzajów, bufor obrażeń, atlas wysokości, uniformy (U).
 */
function b3Library(ctx, V) {
  const { kindTable, damage, heightTex, U } = ctx;
  const kindBase = int(V.state.z.add(0.5)).mul(B3_KIND_STRIDE).toVar();
  const kindVec = (slot) => kindTable.element(kindBase.add(slot));
  // Siatka belek: state.w < 0 (−bok komórki w px obrazu); heksy: state.w = promień heksa.
  const square = V.state.w.lessThan(0.0).toVar();
  const cellPx = abs(V.state.w).toVar();
  const hexR = select(V.state.w.greaterThan(0.0), V.state.w, float(5.0)).toVar();

  const grid = (m) => V.gridA.xy.add(vec2(dot(V.gridA.zw, m), dot(V.gridB.xy, m)));

  const hexCell = (g) => {
    const q = g.x.mul(2.0 / 3.0).div(hexR).toVar();
    const r = g.y.mul(0.5773502692).sub(g.x.div(3.0)).div(hexR).toVar();
    const sc = q.negate().sub(r).toVar();
    const rq = floor(q.add(0.5)).toVar();
    const rr = floor(r.add(0.5)).toVar();
    const rs = floor(sc.add(0.5)).toVar();
    const dq = abs(rq.sub(q)).toVar();
    const dr = abs(rr.sub(r)).toVar();
    const ds = abs(rs.sub(sc)).toVar();
    If(dq.greaterThan(dr).and(dq.greaterThan(ds)), () => {
      rq.assign(rr.negate().sub(rs));
    }).ElseIf(dr.greaterThan(ds), () => {
      rr.assign(rq.negate().sub(rs));
    });
    return vec2(rq, rr.add(rq.sub(mod(rq, 2.0)).mul(0.5)));
  };

  const hexCenter = (cr) => vec2(cr.x.mul(1.5).mul(hexR), cr.y.add(mod(cr.x, 2.0).mul(0.5)).mul(1.7320508076).mul(hexR));

  // Komórka pod punktem siatki: belki — floor (grid() daje wtedy współrzędne w komórkach),
  // heksy — zaokrąglenie heksowe.
  const cellCoord = (g) => {
    const cr = vec2(0.0).toVar();
    If(square, () => {
      cr.assign(floor(g));
    }).Else(() => {
      cr.assign(hexCell(g));
    });
    return cr;
  };

  // Komórka bloku rekordu (RGBA8 → 0..1 jak texelFetch z tekstury RGBA8).
  const cell = (cr) => {
    const lc = cr.sub(V.gridB.zw).toVar();
    const out = vec4(0.0).toVar();
    If(lc.x.greaterThanEqual(0.0).and(lc.y.greaterThanEqual(0.0)).and(lc.x.lessThan(V.dmg.y)).and(lc.y.lessThan(V.dmg.z)), () => {
      // Blok leży liniowo od wiersza V.dmg.x (duży mostek — kilka wierszy).
      const idx = int(lc.x.add(lc.y.mul(V.dmg.y)).add(0.5));
      const w = damage.element(int(V.dmg.x.add(0.5)).mul(B3_DAMAGE_W).add(idx)).toVar();
      out.assign(vec4(
        float(w.bitAnd(uint(255))),
        float(w.shiftRight(uint(8)).bitAnd(uint(255))),
        float(w.shiftRight(uint(16)).bitAnd(uint(255))),
        float(w.shiftRight(uint(24)))
      ).div(255.0));
    });
    return out;
  };

  // Skala detalu rodzaju (panele, brud, AO) względem Bellatora.
  const detail = () => kindVec(B3_KIND_SLOT.topDetailCoat).y;
  const top = () => kindVec(B3_KIND_SLOT.topDetailCoat).x;

  const height = (m) => {
    const bb = kindVec(B3_KIND_SLOT.bounds);
    const t = m.sub(bb.xy).mul(bb.zw).toVar();
    const h = float(0.0).toVar();
    If(t.x.greaterThan(0.0).and(t.y.greaterThan(0.0)).and(t.x.lessThan(1.0)).and(t.y.lessThan(1.0)), () => {
      const rg = kindVec(B3_KIND_SLOT.region);
      // Wysokość w atlasie normalizowana do szczytu rodzaju (8 bitów na model).
      h.assign(texture(heightTex, rg.xy.add(t.mul(rg.zw))).level(0.0).x.mul(top()));
      // Bez uszkodzeń nie szukamy heksa (typowy przypadek: 1 odczyt na krok).
      If(h.greaterThan(0.02).and(V.dmg.w.greaterThanEqual(0.5)), () => {
        If(cell(cellCoord(grid(m))).x.lessThanEqual(0.2), () => {
          h.assign(0.0);
        });
      });
    });
    return h;
  };

  // Marsz w stronę słońca cieni po mapie wysokości. p — punkt (przestrzeń M),
  // dir — jednostkowy azymut słońca (M, XY), jit — b3Dither. 1 = w pełni oświetlony.
  const shadow = (p, dir, jit) => {
    const topK = top().toVar();
    const tanE = max(U.uB3Shadow.x, 0.05).toVar();
    const lit = float(1.0).toVar();
    If(p.z.lessThan(topK), () => {
      const maxT = topK.sub(p.z).div(tanE).toVar();
      const stepT = max(0.45, maxT.div(B3_SHADOW_STEPS)).toVar();
      const t = stepT.mul(jit.mul(0.7).add(0.3)).toVar();
      Loop(B3_SHADOW_STEPS, () => {
        If(t.greaterThan(maxT), () => {
          Break();
        });
        const rayZ = p.z.add(t.mul(tanE));
        const h = height(p.xy.add(dir.mul(t)));
        lit.assign(min(lit, clamp(rayZ.sub(h).div(U.uB3Shadow.z.mul(t).add(detail().mul(0.3))), 0.0, 1.0)));
        If(lit.lessThanEqual(0.001), () => {
          Break();
        });
        t.addAssign(stepT);
      });
    });
    return lit;
  };

  // Kontaktowe przyciemnienie: ile brył wokół punktu wystaje ponad niego.
  const occlusion = (p) => {
    const R = U.uB3Ao.x.mul(detail()).toVar();
    const occ = float(0.0).toVar();
    Loop(8, ({ i }) => {
      const a = float(i).mul(0.7853982).add(0.3927);
      const rr = select(i.bitAnd(1).equal(0), R, R.mul(2.2)).toVar();
      const q = p.xy.add(vec2(cos(a), sin(a)).mul(rr));
      occ.addAssign(clamp(height(q).sub(p.z).div(rr.mul(1.2)), 0.0, 1.0));
    });
    return float(1.0).sub(U.uB3Ao.y.mul(occ).mul(0.125));
  };

  return { kindVec, square, cellPx, hexR, grid, hexCell, hexCenter, cellCoord, cell, detail, top, height, shadow, occlusion };
}

// Dane instancji jako varyingi płaskie (stałe na instancję — jak flat w GLSL).
function instanceVaryings(prefix) {
  const flat = (name, type) => varying(attribute(name, type), `${prefix}${name}`).setInterpolation('flat');
  return {
    gridA: flat('aB3GridA', 'vec4'),
    gridB: flat('aB3GridB', 'vec4'),
    dmg: flat('aB3Dmg', 'vec4'),
    state: flat('aB3State', 'vec4')
  };
}

// Macierz instancji (jak dawne instanceMatrix: kolumny osi X, Y, Z modelu
// i przesunięcie względem mesh.position — małe liczby dla float32).
function instanceMatrix() {
  const iBasis = attribute('iBasis', 'vec4');
  const iOrg = attribute('iOrg', 'vec4');
  return mat4(
    vec4(iBasis.x, iBasis.y, 0.0, 0.0),
    vec4(iBasis.z, iBasis.w, 0.0, 0.0),
    vec4(0.0, 0.0, iOrg.z, 0.0),
    vec4(iOrg.x, iOrg.y, iOrg.w, 1.0)
  );
}

const mat3Of = (m) => mat3(m.element(0).xyz, m.element(1).xyz, m.element(2).xyz);

// Kierunek do słońca w przestrzeni modelu: jak kadłub, wysokość 600 (scena:
// y = −y świata). Słońce jest daleko — pozycja instancji w float32 wystarcza.
function sunInModel(inst, U) {
  return normalize(transpose(mat3Of(inst)).mul(normalize(vec3(U.uB3Sun.sub(inst.element(3).xy), 600.0))));
}

/**
 * Wspólne węzły modułu (tworzy Bridge3D.attach): uniformy (grupa render — jeden
 * zapis na klatkę dla wszystkich rodzajów), tablica rodzajów, bufor obrażeń.
 */
export function createBridge3DNodes({ kindCount, damageAttribute, damageCount, heightTex }) {
  const shared = (value) => uniform(value).setGroup(renderGroup);
  const U = {
    uB3Shadow: shared(new THREE.Vector4()),
    uB3Ao: shared(new THREE.Vector4()),
    uB3Sun: shared(new THREE.Vector2()),
    uB3Light: shared(new THREE.Vector3()),
    uB3Wound: shared(new THREE.Vector4())
  };
  const kindValues = [];
  for (let i = 0; i < kindCount * B3_KIND_STRIDE; i++) kindValues.push(new THREE.Vector4());
  const kindTable = uniformArray(kindValues, 'vec4');
  const damage = storage(damageAttribute, 'uint', damageCount).toReadOnly().setName('bridgeDamage');
  return { U, kindTable, kindValues, damage, heightTex };
}

/** Bryła mostka: wspólny materiał wszystkich rodzajów (transparent, zapis głębi). */
export function createBridgeModelMaterial(ctx) {
  const { U } = ctx;
  const V = instanceVaryings('vB3Model');
  const aB3Hull = attribute('aB3Hull', 'vec4');
  const aB3Mask = attribute('aB3Mask', 'vec2');
  const aMat = attribute('aMat', 'float');
  const aModule = attribute('aModule', 'float');
  const instM = instanceMatrix();
  const inst = modelWorldMatrix.mul(instM);
  const mvI = modelViewMatrix.mul(instM);
  const mv = mvI.mul(vec4(positionGeometry, 1.0));
  // Widok w przestrzeni kamery: ortho — prosto z góry (jak kadłub). Kamera
  // ortho ma P[3][3] = 1, perspektywa 0 (dawne isOrthographic).
  const isOrtho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
  const viewV = select(isOrtho, vec3(0.0, 0.0, 1.0), normalize(mv.xyz).negate());

  const vLight = varying(sunInModel(inst, U), 'vB3Light').setInterpolation('flat');
  const vHull = varying(aB3Hull, 'vB3Hull').setInterpolation('flat');
  const vPos = varying(positionGeometry, 'vB3Pos');
  const vNormal = varying(attribute('normal', 'vec3'), 'vB3Normal');
  const vView = varying(transpose(mat3Of(mvI)).mul(viewV), 'vB3View');
  const vMat = varying(aMat, 'vB3Mat');

  const vertexNode = Fn(() => {
    // Maska modułów (przyszły wizualny silnik destrukcji 3D): ukryty moduł znika.
    const word = select(aModule.lessThan(24.0), aB3Mask.x, aB3Mask.y);
    const hidden = mod(floor(word.div(exp2(mod(aModule, 24.0)))), 2.0).greaterThan(0.5);
    return select(hidden, vec4(0.0, 0.0, -2.0, 1.0), cameraProjectionMatrix.mul(mv));
  })();

  const fragmentNode = Fn(() => {
    const L3 = b3Library(ctx, V);
    const kind = (slot) => L3.kindVec(slot);
    const P = vPos.toVar();
    const jit = b3Dither(P).toVar();
    // Wyrwa: komórka siatki pod fragmentem zginęła (albo należy już do innej encji).
    const g = L3.grid(P.xy).toVar();
    const cr = L3.cellCoord(g).toVar();
    const cell = L3.cell(cr).toVar();
    If(cell.x.lessThan(0.2), () => {
      Discard();
    });
    const hpFrac = clamp(cell.x.mul(255.0).sub(64.0).div(191.0), 0.0, 1.0).toVar();

    // Brzeg rany: odległość do krawędzi komórki, za którą leży martwy sąsiad.
    const rim = float(0.0).toVar();
    const nmask = int(cell.z.mul(255.0).add(0.5)).toVar();
    If(nmask.greaterThan(int(0)), () => {
      If(L3.square, () => {
        // Belki: boki i narożniki kwadratu (px obrazu = komórki × bok komórki), poszarpany brzeg.
        const F = B3_SQUARE_FRAY;
        const off = g.sub(cr).sub(0.5).toVar();
        const edge = float(1e4).toVar();
        for (let i = 0; i < 8; i++) {
          If(nmask.shiftRight(uint(i)).bitAnd(int(1)).equal(int(1)), () => {
            const dir = vec2(B3_SQUARE_DIRS[i][0], B3_SQUARE_DIRS[i][1]);
            const d = i < 4
              ? float(0.5).sub(dot(off, dir)).mul(L3.cellPx)
              : length(off.sub(dir.mul(0.5))).mul(L3.cellPx);
            edge.assign(min(edge, d));
          });
        }
        // Szum przyklejony do siatki rodu: dwie oktawy, kęs do frayMax komórki.
        const n = b3Noise(g.div(F.period)).mul(0.65).add(b3Noise(g.div(F.period * 0.37).add(vec2(7.3, 1.9))).mul(0.35));
        const bite = n.mul(F.frayMax).mul(L3.cellPx).toVar();
        If(edge.lessThan(bite), () => {
          Discard();
        });
        rim.assign(float(1.0).sub(smoothstep(0.0, U.uB3Wound.x.mul(F.rimMul), edge.sub(bite))));
      }).Else(() => {
        const off = g.sub(L3.hexCenter(cr)).toVar();
        const ap = L3.hexR.mul(0.8660254).toVar();
        for (let i = 0; i < 6; i++) {
          // WGSL: przesunięcie o u32.
          If(nmask.shiftRight(uint(i)).bitAnd(int(1)).equal(int(1)), () => {
            const d = ap.sub(dot(off, vec2(B3_HEX_DIRS[i][0], B3_HEX_DIRS[i][1])));
            rim.assign(max(rim, float(1.0).sub(smoothstep(0.0, U.uB3Wound.x, d))));
          });
        }
      });
    });

    const front = frontFacing;
    const N = normalize(select(front, vNormal, vNormal.negate())).toVar();
    const mi = int(vMat.add(0.5)).toVar();
    const pal = (i) => kind(int(B3_KIND_SLOT.palette).add(i));
    const albedo = pal(mi).xyz.toVar();
    const surface = kind(B3_KIND_SLOT.surface).toVar();
    const tdc = kind(B3_KIND_SLOT.topDetailCoat).toVar();
    const coatRust = tdc.z;
    const coatSky = tdc.w;

    // Panele: szwy cegiełkowo na płaszczyźnie najbliższej ścianie, zmienność
    // jasności paneli, brud nisko w zagłębieniach, nity (piraci).
    const an = abs(N).toVar();
    const suv = select(an.z.greaterThan(max(an.x, an.y)), P.xy, select(an.x.greaterThan(an.y), P.yz, P.xz)).toVar();
    const det = tdc.y.toVar();
    // Panele w dwóch skalach: duże płyty (9 × 6 × detal) dzielone losowo na pół.
    const pp = suv.div(vec2(9.0, 6.0).mul(det)).toVar();
    pp.x.addAssign(floor(pp.y).mul(0.37));
    const cell0 = floor(pp).toVar();
    const split = b3Hash(cell0.add(17.0)).toVar();
    const fp = fract(pp).toVar();
    // Pochodne w jednolitym przepływie (przed warunkami niżej).
    const fwPP = fwidth(pp).toVar();
    const halves = split.greaterThan(0.55).toVar();
    If(halves, () => {
      fp.x.assign(fract(fp.x.mul(2.0)));
      cell0.x.addAssign(step(0.5, fract(pp.x)).mul(0.5));
    });
    const dl = min(fp, float(1.0).sub(fp)).toVar();
    const fw = fwPP.mul(vec2(select(halves, float(2.0), float(1.0)), 1.0)).add(vec2(1e-4)).toVar();
    const seam = max(
      float(1.0).sub(smoothstep(0.018, fw.x.mul(1.5).add(0.018), dl.x)),
      float(1.0).sub(smoothstep(0.025, fw.y.mul(1.5).add(0.025), dl.y))
    ).toVar();
    const panel = b3Hash(cell0).toVar();
    albedo.mulAssign(panel.mul(0.14).add(0.93).mul(float(1.0).sub(surface.y.mul(seam))));
    const grime = smoothstep(0.45, 0.9, b3Noise(P.xy.mul(float(0.19).div(det)).add(vec2(3.1, 7.7))));
    const glassM = select(mi.equal(4), float(0.0), float(1.0)).toVar();
    albedo.assign(mix(albedo, pal(7).xyz, surface.z.mul(grime).mul(glassM)));
    // Piraci: łatanina płyt jak na sprite'cie — stal, ciemna stal albo rdza
    // (per płyta), zacieki rdzy przy szwach, duże nity w narożnikach części płyt.
    const plateM = select(mi.equal(0).or(mi.equal(1)), float(1.0), float(0.0)).toVar();
    If(coatRust.greaterThan(0.0), () => {
      const pick = b3Hash(cell0.add(3.7)).toVar();
      const plate = select(pick.lessThan(0.56), albedo, select(pick.lessThan(0.8), albedo.mul(0.7), pal(3).xyz.mul(panel.mul(0.45).add(0.7))));
      albedo.assign(mix(albedo, plate, coatRust.mul(plateM)));
      const streak = smoothstep(0.6, 0.82, b3Noise(vec2(P.x.mul(0.9), P.y.mul(0.18)).div(det).add(cell0.mul(3.1))).add(seam.mul(0.25)));
      albedo.assign(mix(albedo, pal(7).xyz, streak.mul(0.55).mul(coatRust).mul(glassM)));
    });
    If(surface.w.greaterThan(0.5).and(halves.not()).and(b3Hash(cell0.add(9.1)).greaterThan(0.45)), () => {
      const cq = fp.sub(0.5).mul(vec2(9.0, 6.0));
      const rd = length(abs(cq).sub(vec2(3.5, 2.2))).toVar();
      const head = float(1.0).sub(smoothstep(0.36, 0.5, rd));
      const ring = smoothstep(0.36, 0.5, rd).mul(float(1.0).sub(smoothstep(0.52, 0.7, rd)));
      const onTop = step(0.5, an.z).mul(plateM).toVar();
      albedo.assign(mix(albedo, pal(6).xyz.mul(0.62), head.mul(0.6).mul(onTop)));
      albedo.mulAssign(float(1.0).sub(ring.mul(0.45).mul(onTop)));
    });

    // Światło kadłuba (hexShips3D): otoczenie + rozproszone + połysk Blinna.
    const L = normalize(vLight).toVar();
    const Vv = normalize(vView).toVar();
    const NdotL = dot(N, L).toVar();
    const sunDir = L.xy.div(max(length(L.xy), 1e-4)).toVar();
    // LOD (vHull.y = 1): mała instancja — bez marszu cienia i AO.
    const full = vHull.y.lessThan(0.5).toVar();
    const sh = float(1.0).toVar();
    const ao = float(1.0).toVar();
    If(full, () => {
      sh.assign(L3.shadow(P.add(N.mul(0.35).add(vec3(0.0, 0.0, 0.2)).mul(det)), sunDir, jit));
      ao.assign(L3.occlusion(P.add(vec3(0.0, 0.0, det.mul(0.05)))));
    });
    // Dach świeci jak kadłub w tym miejscu (vHull.x = lightMul kadłuba pod
    // środkiem strefy: otoczenie + poduszkowa normalna kadłuba), ściany
    // odchylone od pionu trochę mniej; słońce dokłada się na skosach.
    // W cieniu planety/innego kadłuba (maska Core3D) zostaje przygaszone
    // otoczenie — tak jak na kadłubie pod mostkiem; własny cień modelu gaśnie.
    const sunVis = sunVisibility().toVar();
    const hullLight = U.uB3Light.x.mul(sunFill(sunVis)).add(vHull.x.sub(U.uB3Light.x).mul(sunVis));
    const amb = hullLight.mul(max(N.z, 0.0).mul(0.45).add(0.55)).mul(ao).mul(mix(1.0, sh, U.uB3Shadow.w.mul(sunVis)));
    const dif = max(0.0, NdotL).mul(U.uB3Light.y).mul(sh).mul(sunVis);
    const col = albedo.mul(amb.add(dif)).toVar();
    const H = normalize(L.add(Vv));
    const spExp = pal(mi).w;
    const spMul = kind(int(B3_KIND_SLOT.specMul).add(mi)).x;
    col.addAssign(vec3(pow(max(dot(N, H), 0.0), spExp).mul(spMul).mul(U.uB3Light.z).mul(smoothstep(-0.02, 0.08, NdotL)).mul(sh).mul(sunVis)));
    // Chłodne odbicie nieba (kadłuby mają lakier z odbiciem kosmosu — bez tego
    // model wyglądał na matowy i cieplejszy od kadłuba). Szyby mocniej.
    const fres = pow(float(1.0).sub(max(dot(N, Vv), 0.0)), 5.0);
    const skyK = coatSky.mul(select(mi.equal(4), float(0.09), fres.mul(0.05).add(0.022))).mul(max(N.z, 0.0).mul(0.65).add(0.35)).mul(ao);
    col.addAssign(vec3(0.55, 0.75, 1.0).mul(skyK));

    // Powierzchnia nie świeci: jasne skosy od słońca łagodnie dochodzą do
    // ~0,86 (pod progiem bloomu 0,9 — bez poświaty wzdłuż sylwetki). Ponad
    // próg wychodzi tylko żar brzegu wyrwy.
    const lum = dot(col, vec3(0.2126, 0.7152, 0.0722)).toVar();
    If(lum.greaterThan(0.62), () => {
      col.mulAssign(float(0.62).add(float(0.24).mul(float(1.0).sub(exp(lum.sub(0.62).div(0.24).negate())))).div(lum));
    });

    // Brzeg wyrwy: przypalony; żar kadłuba (G, cały heks jak na kadłubie)
    // i żar świeżego cięcia (A, cienka krawędź przy martwym sąsiedzie).
    col.mulAssign(float(1.0).sub(max(rim.mul(U.uB3Wound.y), float(1.0).sub(hpFrac).mul(0.3))));
    const hHull = cell.y.mul(V.state.y);
    const hCut = cell.w.mul(U.uB3Wound.z).mul(V.state.y).mul(rim).mul(rim);
    const heat = max(hHull.mul(rim.mul(0.7).add(0.3)), hCut).toVar();
    const glowK = U.uB3Wound.w.mul(heat.mul(0.26).add(heat.mul(heat).mul(heat).mul(heat).mul(0.74))).toVar();
    const heatCol = heatRamp(heat).toVar();
    col.addAssign(heatCol.mul(glowK));

    // Tył ścian widoczny przez wyrwę (wolna kamera): ciemne wnętrze.
    If(front.not(), () => {
      col.assign(kind(B3_KIND_SLOT.interior).xyz.mul(ao.mul(0.65).add(0.35)).add(heatCol.mul(glowK).mul(0.6)));
    });

    return vec4(col, V.state.x);
  })();

  const material = new THREE.NodeMaterial();
  material.name = 'bridge3D:model';
  material.lights = false;
  material.fog = false;
  material.transparent = true;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  // Przezroczysty DoubleSide WebGPU rysowałby dwa razy — WebGL (ShaderMaterial) raz.
  material.forceSinglePass = true;
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  return material;
}

/**
 * Cień modelu na kadłubie: prostokąt POD kadłubem (z = RECEIVER_Z), test głębi
 * GREATER — przechodzi tylko tam, gdzie kadłub zapisał głębię (z ≈ 0, bliżej
 * kamery), więc jest przycięty do sylwetki i nie wpada w wyrwy.
 */
export function createBridgeReceiverMaterial(ctx, receiverZ) {
  const { U } = ctx;
  const V = instanceVaryings('vB3Recv');
  const aState = attribute('aB3State', 'vec4');
  const instM = instanceMatrix();
  const inst = modelWorldMatrix.mul(instM);
  // Rodzaj z atrybutu (wierzchołek) — obrys i szczyt mapy wysokości.
  const kb = int(aState.z.add(0.5)).mul(B3_KIND_STRIDE);
  const bb = ctx.kindTable.element(kb.add(B3_KIND_SLOT.bounds));
  const tdc = ctx.kindTable.element(kb.add(B3_KIND_SLOT.topDetailCoat));
  const Lm = sunInModel(inst, U);
  const dir = Lm.xy.div(max(length(Lm.xy), 1e-4));
  // Prostokąt: obrys modelu wydłużony w stronę od słońca o zasięg cienia.
  const lo = bb.xy;
  const hi = bb.xy.add(vec2(1.0).div(bb.zw));
  const off = dir.negate().mul(tdc.x.div(max(U.uB3Shadow.x, 0.05)));
  const pad = U.uB3Ao.x.mul(2.5).mul(tdc.y);
  const qlo = min(lo, lo.add(off)).sub(vec2(pad));
  const qhi = max(hi, hi.add(off)).add(vec2(pad));
  const m = mix(qlo, qhi, positionGeometry.xy.add(0.5));
  const vSunDir = varying(dir, 'vB3SunDir').setInterpolation('flat');
  const vPos2 = varying(m, 'vB3Pos2');
  const vertexNode = cameraProjectionMatrix.mul(modelViewMatrix.mul(instM)).mul(vec4(m, receiverZ, 1.0));

  const fragmentNode = Fn(() => {
    const L3 = b3Library(ctx, V);
    const p = vec3(vPos2, 0.0).toVar();
    const jit = b3Dither(p).toVar();
    const sh = L3.shadow(p, vSunDir, jit).toVar();
    const ao = L3.occlusion(p).toVar();
    // Bez słońca (cień planety — maska Core3D) mostek nie rzuca cienia, AO zostaje.
    const dark = float(1.0).sub(sh).mul(U.uB3Shadow.y).mul(sunVisibility()).add(float(1.0).sub(ao)).toVar();
    dark.assign(min(dark, 0.8).mul(V.state.x));
    If(dark.lessThan(0.003), () => {
      Discard();
    });
    return vec4(0.0, 0.0, 0.0, dark);
  })();

  const material = new THREE.NodeMaterial();
  material.name = 'bridge3D:shadow';
  material.lights = false;
  material.fog = false;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.depthFunc = THREE.GreaterDepth;
  material.blending = THREE.NormalBlending;
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  return material;
}

/**
 * Okna, lampy i listwy modelu: warstwa FG, addytywnie, bez maski cieni.
 * Rdzeń okna tuż nad progiem bloomu (0,9), poświata pod nim — świecą drobne
 * punkty, nie sylwetka (zakaz obwódki). Lampa: jak światła pozycyjne.
 * InstancedMesh (macierz instancji mnoży three), aParams (jasność, pół-szer.,
 * pół-wys., zasięg poświaty), aColor, aShape (0 okno, 1 lampa, 2 listwa).
 */
export function createBridgeEmitterMaterial() {
  const U = {
    uCore: uniform(new THREE.Vector3()),
    uHalo: uniform(new THREE.Vector3())
  };
  const aParams = attribute('aParams', 'vec4');
  const vLocal = varying(positionGeometry.xy.mul(vec2(aParams.y.add(aParams.w).mul(2.0), aParams.z.add(aParams.w).mul(2.0))), 'vB3EmLocal');
  const vParams = varying(aParams, 'vB3EmParams').setInterpolation('flat');
  const vColor = varying(attribute('aColor', 'vec3'), 'vB3EmColor').setInterpolation('flat');
  const vShape = varying(attribute('aShape', 'float'), 'vB3EmShape').setInterpolation('flat');

  const fragmentNode = Fn(() => {
    const shape = int(vShape.add(0.5)).toVar();
    const isBeacon = shape.equal(1).toVar();
    // Oba kształty liczone zawsze (jednolity przepływ dla fwidth), wybór na końcu.
    const dCircle = length(vLocal).sub(vParams.y);
    const q = abs(vLocal).sub(vParams.yz).add(vec2(0.16)).toVar();
    const dRect = length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0)).sub(0.16);
    const d = select(isBeacon, dCircle, dRect).toVar();
    const aa = max(fwidth(d), 1e-4).toVar();
    const core = float(1.0).sub(smoothstep(aa.negate(), aa, d)).toVar();
    const dPos = max(d, 0.0).toVar();
    const haloBeacon = pow(max(0.0, float(1.0).sub(dPos.div(max(vParams.w, 1e-3)))), 2.4);
    const haloRect = exp(dPos.negate().div(max(vParams.w.mul(0.45), 1e-3)));
    const halo = select(isBeacon, haloBeacon, haloRect).mul(float(1.0).sub(core)).toVar();
    const cg = select(shape.equal(0), U.uCore.x, select(isBeacon, U.uCore.y, U.uCore.z));
    const hg = select(shape.equal(0), U.uHalo.x, select(isBeacon, U.uHalo.y, U.uHalo.z));
    const I = vParams.x;
    const col = vColor.mul(I).mul(core.mul(cg).add(halo.mul(hg)));
    const a = clamp(I.mul(core.add(halo.mul(0.5))), 0.0, 1.0).toVar();
    If(a.lessThan(0.002), () => {
      Discard();
    });
    return vec4(col, a);
  })();

  const material = new THREE.NodeMaterial();
  material.name = 'bridge3D:windows';
  // Adapter jak w ShaderMaterial: material.uniforms.uCore.value.set(…).
  material.uniforms = U;
  material.lights = false;
  material.fog = false;
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.FrontSide;
  material.fragmentNode = fragmentNode;
  return { material, uniforms: U };
}

// Eksport węzłów do testów struktury grafu (bez GPU).
export const BRIDGE3D_TSL_INTERNALS = Object.freeze({ b3Hash, b3Noise, B3_HEX_DIRS, B3_SQUARE_DIRS });
