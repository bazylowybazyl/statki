// src/3d/fog/fogOfWarPost.js
//
// Mgła wojny w poście „uber” (2026-10-04; logika: src/game/fogOfWar.js). Raz na piksel, przed ACES:
//  - punkt świata piksela (kamera z góry: px od środka / zoom; kamery 3D: promień ∩ płaszczyzna gry z = 0;
//    rulon warpa: odwrotność zgięcia — mgła gnie się ze światem),
//  - koła wzroku strony gracza (≤ 24, j. świata względem kamery) → odległość ze znakiem od brzegu, brzeg
//    poszarpany gęstością mgły (jęzory wpełzają w krąg tam, gdzie mgła gęstsza),
//  - poza kręgiem: obraz przygaszony i odbarwiony, na nim zimna mgła — chmury szumu kafelkowego ZAKOTWICZONE
//    W ŚWIECIE (dryfują wolno, nie jadą z kamerą), lekko podświetlone przez czujniki przy brzegu (bez obrysu —
//    feedback: świecące okręgi czytają się jak celownik),
//  - sygnatury masy (≤ 4): wir zagęszczonej mgły z ciemnym jądrem i przyświetlonym pyłem wokół — „coś ciężkiego
//    tam jest”, bez tożsamości.
// Mgła wyłączona (uFogOn = 0) = gałąź pominięta, obraz bit w bit jak bez niej.
//
// Precyzja: świat leży przy 5–10 mln j. — szum nie dostaje współrzędnych bezwzględnych. Core3D liczy w double
// początek kafla szumu (uFogBaseA / B, zawinięty do [0, 1)), shader dokłada przesunięcie piksela / FOG_TILE_WORLD;
// szum jest okresowy w kaflu (siatka mod okres), więc zawinięcie nie robi szwu.
// Funkcje z `setLayout` są CZYSTE (bez uniformów z domknięcia — pułapka 1); reszta wklejana w graf „uber”.
import { Matrix4, Vector2, Vector4 } from 'three/webgpu';
import {
  Fn, If, Loop, abs, clamp, cos, dot, exp, float, floor, fract, int, ivec2, length, max, mix, select, sin, smoothstep, sqrt,
  uint, uniform, uniformArray, uvec2, vec2, vec3, vec4
} from 'three/tsl';

export const FOG_MAX_CIRCLES = 24;
export const FOG_MAX_MASSES = 4;
/** Blok danych: koła (x, y, r, —) i po dwa wpisy na sygnaturę: (x, y, R, alfa), (skręt, ziarno, —, —). */
export const FOG_DATA_LEN = FOG_MAX_CIRCLES + FOG_MAX_MASSES * 2;
/** Okres szumu mgły (j. świata) — kafel; chmury ~20 tys. j., najdrobniejsze smugi ~1,2 tys. j. */
export const FOG_TILE_WORLD = 200000;
/** Szerokość miękkiego brzegu kręgu wzroku (ułamek promienia). */
export const FOG_EDGE_FRAC = 0.22;

/** Barwy (liniowe HDR przed ACES; 0,03 → ~0,15 sRGB). Strojenie: Core3D.fogOfWar.look. */
export const FOG_POST_LOOK = Object.freeze({
  // przygaszenie i odbarwienie tego, co pod mgłą (rzadka mgła → więcej widać)
  underDense: 0.15,
  underThin: 0.34,
  desaturate: 0.72,
  // mgła: cień i światło chmur (zimny granat ↔ fiolet), pasma smug
  shade: [0.008, 0.013, 0.024],
  lit: [0.040, 0.056, 0.088],
  violet: [0.038, 0.028, 0.064],
  // podświetlenie mgły przez czujniki przy brzegu kręgu
  rim: [0.010, 0.040, 0.058],
  // pył przy sygnaturze masy (ciepły, przyświetlony)
  massDust: [0.090, 0.055, 0.030]
});

// ── Szum kafelkowy (okresowy w kaflu; hasz całkowity — wynik nie zależy od kompilatora) ─────────
const fowHashU = /*@__PURE__*/ Fn(([p]) => {
  const q = p.mul(uvec2(1597334673, 3812015801)).toVar();
  const h = q.x.bitXor(q.y).mul(uint(1597334673)).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(2246822519)));
  h.assign(h.bitXor(h.shiftRight(uint(13))));
  return h;
}).setLayout({ name: 'fowHashU', type: 'uint', inputs: [{ name: 'p', type: 'uvec2' }] });

const fowHash01 = /*@__PURE__*/ Fn(([c, period, salt]) => {
  const w = c.mod(period).add(period).mod(period);
  const h = fowHashU(uvec2(w).add(uvec2(salt, salt.mul(uint(7)))));
  return float(h.bitAnd(uint(0xFFFFFF))).div(16777215.0);
}).setLayout({ name: 'fowHash01', type: 'float', inputs: [{ name: 'c', type: 'ivec2' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

const fowTile = /*@__PURE__*/ Fn(([p, period, salt]) => {
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const c = ivec2(floor(p)).toVar();
  const a = fowHash01(c, period, salt);
  const b = fowHash01(c.add(ivec2(1, 0)), period, salt);
  const d = fowHash01(c.add(ivec2(0, 1)), period, salt);
  const e = fowHash01(c.add(ivec2(1, 1)), period, salt);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}).setLayout({ name: 'fowTile', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

function makeFowFbm(basePeriod, salt, octaves, name) {
  return Fn(([p]) => {
    const s = float(0).toVar();
    let amp = 0.5;
    let n = 0;
    let period = basePeriod;
    for (let o = 0; o < octaves; o++) {
      s.addAssign(fowTile(p.mul(period), int(period), uint(salt + o * 131)).mul(amp));
      n += amp;
      amp *= 0.5;
      period *= 2;
    }
    return s.div(n);
  }).setLayout({ name, type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
}

// Chmury: okres 10 na kafel = ~20 tys. j., 5 oktaw do ~1,2 tys. j. Zawirowanie: 4 → ~50 tys. j.
const fowCloud = /*@__PURE__*/ makeFowFbm(10, 17, 5, 'fowCloud');
const fowWarp = /*@__PURE__*/ makeFowFbm(4, 911, 3, 'fowWarp');
const fowVeil = /*@__PURE__*/ makeFowFbm(3, 4421, 2, 'fowVeil');
// Smugi i jęzory brzegu: okres 36 = ~5,5 tys. j., 3 oktawy do ~1,4 tys. j.
const fowWisp = /*@__PURE__*/ makeFowFbm(36, 2741, 3, 'fowWisp');

/**
 * Uniformy mgły (dokładane do createPostUniforms). Zwykłe `uniform()` dzielą bufor grupy obiektu; blok danych
 * kół i sygnatur to JEDEN uniformArray (stała nazwa — wspólny WGSL dla obu pipeline'ów postu).
 */
export function createFogPostUniforms() {
  return {
    uFogOn: uniform(0.0),
    uFogCount: uniform(0, 'int'),
    uFogMassCount: uniform(0, 'int'),
    uFogZoom: uniform(1.0),
    uFogBuf: uniform(new Vector2(1920, 1080)),
    uFogPersp: uniform(0.0),
    uFogInv: uniform(new Matrix4()),
    uFogCamZ: uniform(1.0),
    uFogBaseA: uniform(new Vector2(0, 0)),
    uFogBaseB: uniform(new Vector2(0, 0)),
    uFogTime: uniform(0.0),
    // x — gęstość mgły, y — podświetlenie brzegu, z — przygaszenie pod mgłą, w — siła sygnatur
    uFogLook: uniform(new Vector4(1, 1, 1, 1)),
    uFogData: uniformArray(Array.from({ length: FOG_DATA_LEN }, () => new Vector4(0, 0, 0, 0)), 'vec4').setName('fogOfWar')
  };
}

const c3 = (a) => vec3(a[0], a[1], a[2]);

/**
 * Mgła na `sceneColor` (vec4 var, liniowy HDR) — wklejana w graf „uber” (Fn postu). `U` — węzły uniformów
 * (createFogPostUniforms po uniformNode), `uvTex` — UV kwadu (v od góry), `flatPx` — piksel w px bufora od
 * środka ekranu, oś y w górę, PO odwrotności rulonu.
 */
export function applyFogOfWar(U, sceneColor, uvTex, flatPx, look = FOG_POST_LOOK) {
  If(U.uFogOn.greaterThan(0.5), () => {
    // Punkt świata piksela względem kamery (osie sceny: x w prawo, y w górę), j. świata.
    const rel = flatPx.div(max(U.uFogZoom, 1.0e-6)).toVar('fogRel');
    const seen = float(1.0).toVar('fogSeen');
    If(U.uFogPersp.greaterThan(0.5), () => {
      const ndc = vec2(uvTex.x.mul(2.0).sub(1.0), float(1.0).sub(uvTex.y.mul(2.0)));
      const p = U.uFogInv.mul(vec4(ndc, 1.0, 1.0)).toVar('fogRay');
      const dir = p.xyz.div(p.w).toVar('fogDir');
      If(dir.z.lessThan(-1.0e-6), () => {
        rel.assign(dir.xy.mul(U.uFogCamZ.div(dir.z.negate())));
      }).Else(() => {
        // nad horyzontem: płaszczyzna gry nieosiągalna — pełna mgła nieba
        seen.assign(0.0);
        rel.assign(vec2(1.0e6, 1.0e6));
      });
    });
    rel.assign(clamp(rel, vec2(-2.0e6), vec2(2.0e6)));

    // Najgłębsze wejście w któryś krąg wzroku: s = (r − d) / brzeg (0 = granica, ≥ 1 = czysto).
    const sMax = float(-1.0e9).toVar('fogS');
    Loop({ start: 0, end: U.uFogCount, type: 'int', condition: '<', name: 'fogI' }, ({ fogI }) => {
      const c = U.uFogData.element(fogI);
      const w = max(c.z.mul(FOG_EDGE_FRAC), 1.0);
      sMax.assign(max(sMax, c.z.sub(length(rel.sub(c.xy))).div(w)));
    });
    // select, nie mix: mix(−1e9, s, 1) = −1e9 + (s + 1e9)·1 w float32 gubi s (ulp przy 1e9 = 64)
    sMax.assign(select(seen.greaterThan(0.5), sMax, float(-1.0e9)));

    If(sMax.lessThan(1.75), () => {
      // Sygnatury masy: wir — skręt współrzędnych szumu wokół środka (spirala), zagęszczenie, jądro.
      const relN = rel.toVar('fogRelN');
      const massDense = float(0.0).toVar('fogMassD');
      const massCore = float(0.0).toVar('fogMassC');
      const massRing = float(0.0).toVar('fogMassR');
      Loop({ start: 0, end: U.uFogMassCount, type: 'int', condition: '<', name: 'fogM' }, ({ fogM }) => {
        const a = U.uFogData.element(int(FOG_MAX_CIRCLES).add(fogM.mul(2)));
        const b = U.uFogData.element(int(FOG_MAX_CIRCLES).add(fogM.mul(2)).add(1));
        const dm = relN.sub(a.xy).toVar('fogDm');
        const R = max(a.z, 1.0);
        const r2 = dot(dm, dm).div(R.mul(R)).toVar('fogR2');
        const fall = exp(r2.negate()).toVar('fogFall');
        const pulse = sin(U.uFogTime.mul(1.1).add(b.y)).mul(0.12).add(0.88);
        const ang = b.x.mul(fall).add(U.uFogTime.mul(0.04).mul(fall));
        const cs = cos(ang), sn = sin(ang);
        relN.assign(a.xy.add(vec2(dm.x.mul(cs).sub(dm.y.mul(sn)), dm.x.mul(sn).add(dm.y.mul(cs)))));
        const al = a.w.mul(U.uFogLook.w);
        massDense.addAssign(al.mul(fall).mul(0.42).mul(pulse));
        massCore.addAssign(al.mul(exp(r2.mul(-7.0))).mul(pulse));
        const rr = sqrt(r2).sub(0.55).div(0.16);
        massRing.addAssign(al.mul(exp(rr.mul(rr).negate())).mul(pulse));
      });

      // Szum zakotwiczony w świecie: początki kafli (Core3D, double) + piksel / kafel.
      const pA = U.uFogBaseA.add(relN.div(FOG_TILE_WORLD)).toVar('fogPA');
      const pB = U.uFogBaseB.add(relN.div(FOG_TILE_WORLD)).toVar('fogPB');
      const warp = vec2(fowWarp(pB), fowWarp(pB.add(vec2(0.37, 0.71)))).sub(0.5).toVar('fogWarp');
      const cloud = fowCloud(pA.add(warp.mul(0.07))).toVar('fogCloud');
      const veil = fowVeil(pB.add(vec2(0.13, 0.29))).toVar('fogVeil');
      // smugi: drobny szum (~5 tys. → 1,4 tys. j.) zawirowany razem z chmurami; grzbiety = włókna mgły
      const detail = fowWisp(pB.add(warp.mul(0.05))).toVar('fogDetail');
      const ridge = float(1.0).sub(abs(detail.mul(2.0).sub(1.0))).toVar('fogRidge');
      const body = smoothstep(0.38, 0.66, cloud).toVar('fogBody');
      const dense = clamp(body.mul(0.72).add(ridge.mul(ridge).mul(ridge).mul(0.45).mul(body.mul(0.7).add(0.3)))
        .add(veil.mul(0.18)).add(massDense), 0.0, 1.0)
        .mul(U.uFogLook.x).toVar('fogDense');

      // Brzeg poszarpany: chmury przesuwają granicę o ~pół pasma, smugi wpuszczają w krąg jęzory.
      const vis = smoothstep(0.0, 1.0, sMax.add(cloud.sub(0.5).mul(1.1)).add(detail.sub(0.5).mul(1.6))).toVar('fogVis');
      const f = float(1.0).sub(vis).toVar('fogAmt');

      If(f.greaterThan(0.0005), () => {
        const col = sceneColor.rgb;
        const lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        const under = mix(col, vec3(lum), float(look.desaturate))
          .mul(mix(float(look.underThin), float(look.underDense), dense).mul(U.uFogLook.z));
        // chmura: cień → światło z gęstością, granat ↔ fiolet z drugą warstwą
        const tint = mix(c3(look.lit), c3(look.violet), smoothstep(0.35, 0.85, veil));
        const fogCol = mix(c3(look.shade), tint, dense.mul(dense)).mul(dense.mul(0.8).add(0.35));
        // czujniki podświetlają mgłę przy brzegu kręgu (pasmo f ≈ 0,15…0,7) — tylko gęste smugi, bez równej
        // obręczy (feedback: świecące okręgi czytają się jak celownik)
        const band = smoothstep(0.0, 0.3, f).mul(float(1.0).sub(smoothstep(0.45, 0.95, f)));
        const rimCol = c3(look.rim).mul(band.mul(dense.mul(dense).mul(dense).mul(2.2)).mul(U.uFogLook.y));
        // sygnatury: ciemne jądro, przyświetlony pył na pierścieniu ~0,55 R (szarpany szumem — bez obrysu)
        const dust = c3(look.massDust).mul(massRing.mul(smoothstep(0.35, 0.8, cloud)));
        const fogged = under.add(fogCol).add(rimCol).add(dust)
          .mul(float(1.0).sub(clamp(massCore, 0.0, 1.0).mul(0.75)));
        sceneColor.assign(vec4(mix(col, fogged, f), mix(sceneColor.a, 1.0, f)));
      });
    });
  });
}
