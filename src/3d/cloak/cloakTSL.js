// src/3d/cloak/cloakTSL.js
//
// Maskowanie okrętu w TSL (2026-10-04, efekt jak w Crysis; 2026-10-05 — spójne ukrycie, ekrany tylko przy awarii).
// Logika i parametry: src/game/cloakLook.js (`entity.__cloakLook` → slot kadłuba uCloakA..E w HullObjectStore,
// hexShips3D.tsl.js).
//
//  • MOZAIKA HEKSÓW na kadłubie (układ kanoniczny: px sprite'a od środka, x ku dziobowi, y w dół obrazu): przy
//    włączaniu i wyłączaniu komórki przełączają się w LOSOWEJ kolejności na całym kadłubie naraz (próg komórki
//    z haszu — bez fali biegnącej po heksach, decyzja użytkownika 2026-10-05), krawędź przełączanej komórki
//    rozbłyskuje (HDR nad progiem bloomu), cała siatka zapala się impulsem na starcie;
//  • UKRYTY kadłub — spójny, bez migotania: alfa → 0, nieruchoma słaba poświata brzegu i refleks „szkła”, a w
//    warstwie DIST JEDNA soczewka na cały okręt (tło powiększone ku środkowi kadłuba po gładkiej kopule z rozmytej
//    alfy sprite'a, brzeg sylwetki zgina światło);
//  • HEKSY-EKRANY tylko przy awarii maskowania: komórka-„telewizorek” pokazuje INNY wycinek kadru (DIST: kanał —
//    miejsce i zoom z haszu, ramka bez przesunięcia; maska i śnieg w B / A celu DIST → „uber”, cloakView.js) —
//    tuż przed powrotem komórki (wyłączanie), przy końcówce energii i przy zerwaniu (strzał, trafienie, taran:
//    komórki wypadają, błyski magenty, rozdarcie obrazu w pasach).
//
// Funkcje z `setLayout` są CZYSTE (dane slotu idą parametrami — PLAN §3, pułapka 1). Hasz na u32
// (lowbias32) z 24 bitów na float — bit w bit z lustrem CPU (cloakHashCpu), więc wieżyczki, dysze
// i lampy gasną dokładnie z komórką pod sobą. Pochodne (fwidth) liczone PRZED gałęziami (pułapki 15, 29),
// odczyty tekstur w gałęziach z jawnym poziomem mip.
import {
  Fn, If, Discard, float, uint, vec2, vec3, vec4, uniform, renderGroup, screenCoordinate, screenSize,
  abs, clamp, cos, dot, exp2, floor, fract, fwidth, log2, max, min, mix, normalize, round, select, sin,
  smoothstep, sqrt, step
} from 'three/tsl';
import {
  CLOAK_BAND, CLOAK_GLITCH_DROP, CLOAK_HEX_RY, CLOAK_ID_OFFSET, CLOAK_TV_LOCK0, CLOAK_TV_LOCK1, CLOAK_TV_SHARE,
  CLOAK_TV_U0
} from '../../game/cloakLook.js';

/** Wartości wspólne (jeden zapis na klatkę): px bufora rysowania na jednostkę świata (siła refrakcji). */
export const CLOAK_SHARED = {
  uZoomPx: uniform(1).setGroup(renderGroup)
};

// Strojenie obrazu (nie rozgrywki) — liczby w shaderze, w jednym miejscu.
export const CLOAK_SHADER = Object.freeze({
  edgeFlash: 1.9,       // krawędzie przełączanej komórki (× barwa, HDR)
  fillFlash: 0.16,      // wypełnienie przełączanej komórki (rośnie ku krawędziom, środek ciemny)
  pulseLine: 1.0,       // impuls siatki — krawędzie
  pulseFill: 0.03,      //               — wypełnienie
  glassSpec: 0.35,      // ukryty kadłub: refleks słońca na panelach (mapa normalnych, wykładnik 16)
  glassEdge: 0.07,      //               krawędzie paneli (nachylenie normalnej)
  // Soczewka globalna ukrytego okrętu (warstwa DIST, × D.z — postęp ukrycia, impuls, ruch)
  lensMag: 0.06,        // powiększenie tła ku środkowi kadłuba (część odległości od środka sprite'a)
  lensDome: 0.35,       // kopuła soczewki: rozmycie alfy sprite'a (część krótszego boku) — gładka na całym kadłubie
  edgeLensK: 1.4,       // zgięcie tła na brzegu sylwetki (gradient rozmytej alfy × siła brzegu w px)
  minPx: 3.0,           // siła brzegu [px bufora]: dolna i górna granica
  maxPx: 30.0,
  tearPx: 26.0,         // rozdarcie pasów przy zerwaniu [px]
  tearBand: 9.0,        // wysokość pasa rozdarcia [px ekranu]
  // Heksy-ekrany (kanał komórki: wycinek kadru i zoom z haszu) — tylko przy awarii maskowania
  tvFrame: 0.8,         // ramka ekranu (linia siatki × barwa)
  tvBezelPx: 1.6,       // ramka bez przesunięcia [px ekranu]
  tvMargin: 0.1,        // środek wycinka nie bliżej brzegu kadru (część boku)
  tvZoomLog2: [-0.4, 2.6],      // zoom kanału (log2: 0,76× … 6×) — większy = szerszy kawałek kadru
  tvZapSec: [0.18, 0.45],       // okres przełączania kanału [s]
  tvDesyncSec: [0.9, 2.2],      // końcówka energii: okres losowania utraty obrazu [s]
  tvDesyncLen: [0.3, 0.65],     //                   jaka część okresu bez obrazu
  tvGlitchHz: 14.0,             // zerwanie: tempo skoków kanałów
  tvGlitchShare: 0.85           //           udział ukrytych komórek gubiących obraz (× zakłócenie)
});

/** Znacznik pikseli refrakcji maskowania (bez ekranu) w B warstwy DIST: −CLOAK_DIST_MARK × pokrycie. */
export const CLOAK_DIST_MARK = 0.001;

// ── Hasz i siatka (czyste) ──────────────────────────────────────────────────────

/** Hasz komórki (lowbias32): u32 × 3 → [0, 1) z 24 bitów (lustro: cloakHashCpu). */
export const cloakHash = /*@__PURE__*/ Fn(([ix, iy, seed]) => {
  const h = ix.mul(uint(0x8da6b343)).bitXor(iy.mul(uint(0xd8163841))).bitXor(seed.mul(uint(0xcb1ab31f))).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(0x7feb352d)));
  h.assign(h.bitXor(h.shiftRight(uint(15))));
  h.assign(h.mul(uint(0x846ca68b)));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  return float(h.shiftRight(uint(8))).mul(1.0 / 16777216.0);
}).setLayout({
  name: 'cloakHash', type: 'float',
  inputs: [{ name: 'ix', type: 'uint' }, { name: 'iy', type: 'uint' }, { name: 'seed', type: 'uint' }]
});

/**
 * Komórka heksa punktu `p` (jednostki komórki: bok między ścianami = 1): vec4(położenie w komórce xy,
 * środek komórki zw). Dwie przesunięte siatki prostokątne (1 × √3), bliższy środek wygrywa
 * (lustro: cloakHexCellCpu). mod liczony przez floor (WGSL `%` na f32 to reszta z obcięcia).
 */
export const cloakHexCell = /*@__PURE__*/ Fn(([p]) => {
  const r = vec2(1.0, CLOAK_HEX_RY);
  const h = vec2(0.5, CLOAK_HEX_RY * 0.5);
  const a = p.sub(r.mul(floor(p.div(r)))).sub(h).toVar();
  const q = p.sub(h).toVar();
  const b = q.sub(r.mul(floor(q.div(r)))).sub(h).toVar();
  const gv = select(dot(a, a).lessThan(dot(b, b)), a, b).toVar();
  return vec4(gv, p.sub(gv));
}).setLayout({ name: 'cloakHexCell', type: 'vec4', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * Stan komórki: vec4(widoczność 0..1, błysk przełączania 0..1, hasz 1, hasz 2). id — środek komórki
 * (jednostki komórki), A / D — slot (cloakLook.js), t — zegar [s]. Próg komórki = (hasz 1 − ½) · rozrzut (D.w):
 * kolejność przełączania losowa na całym kadłubie. Lustro CPU: cloakVisLocal.
 */
export const cloakCellVis = /*@__PURE__*/ Fn(([id, A, D, t]) => {
  const ix = uint(round(id.x.mul(2.0)).add(CLOAK_ID_OFFSET)).toVar();
  const iy = uint(round(id.y.div(CLOAK_HEX_RY * 0.5)).add(CLOAK_ID_OFFSET)).toVar();
  const seed = uint(D.x).toVar();
  const h1 = cloakHash(ix, iy, seed).toVar();
  const k = clamp(A.x.sub(h1.sub(0.5).mul(D.w)).div(CLOAK_BAND), 0.0, 1.0).toVar();
  const s = smoothstep(0.35, 0.75, k);
  const vis = select(A.y.greaterThan(0.0), float(1.0).sub(s), s).toVar();
  const flash = k.mul(float(1.0).sub(k)).mul(4.0).toVar();
  // Zerwanie: komórki wypadają losowo (heksy-ekrany albo tło) i błyskają.
  If(A.z.greaterThan(0.001), () => {
    const g = cloakHash(ix, iy, seed.add(uint(977)).add(uint(floor(t.mul(22.0)))));
    const off = step(float(1.0).sub(A.z.mul(CLOAK_GLITCH_DROP)), g);
    vis.assign(vis.mul(float(1.0).sub(off)));
    flash.assign(max(flash, off.mul(A.z).mul(0.3)));
  });
  const h2 = cloakHash(iy, ix, seed.add(uint(7)));
  return vec4(vis, flash, h1, h2);
});
// Bez setLayout (wklejana): funkcja z layoutem wołająca inną funkcję z layoutem (cloakHash) dawała w kolejnych
// budowach grafu inną kolejność funkcji w WGSL (kod w cache three) — inny moduł GPU dla tego samego grafu.

/** Szum wartości (siatka całkowita, hasz u32) — nieruchomy wzór poświaty brzegu ukrytego kadłuba. */
export const cloakNoise = /*@__PURE__*/ Fn(([p, seed]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const ix = uint(i.x.add(65536.0)).toVar();
  const iy = uint(i.y.add(65536.0)).toVar();
  const a = cloakHash(ix, iy, seed);
  const b = cloakHash(ix.add(uint(1)), iy, seed);
  const c = cloakHash(ix, iy.add(uint(1)), seed);
  const d = cloakHash(ix.add(uint(1)), iy.add(uint(1)), seed);
  const u = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0))).toVar();
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});   // wklejana (jak cloakCellVis — woła cloakHash)

// Wspólny początek obu shaderów: piksel kanoniczny, komórka, stan komórki, próg komórki (rcj).
function cellAt(lpx, P, uTime) {
  const cellPx = max(P.uCloakB.z, 4.0).toVar();
  const hc = cloakHexCell(lpx.div(cellPx)).toVar();
  const st = cloakCellVis(hc.zw, P.uCloakA, P.uCloakD, uTime).toVar();
  const rcj = st.z.sub(0.5).mul(P.uCloakD.w);
  return { cellPx, hc, st, rcj };
}

/**
 * Heksy-ekrany (tylko przy awarii maskowania): komórka ukrytego kadłuba jako „telewizorek” z innym wycinkiem
 * kadru. Węzły: tv (ekran 0..1 — tylko ukryta komórka), lock (dostrojenie: 1 — pokazuje tło za sobą, przy 1 → 0
 * obraz odjeżdża w kanał), chan (numer kanału), snow (śnieg 0..1) i id komórki (ix, iy, seed). Źródła: pas po
 * stronie ukrytej frontu przy wyłączaniu (E.x — front, E.y — strona; ekranem staje się część komórek tuż przed
 * swoim progiem), losowa utrata obrazu przy końcówce energii (E.z — udział komórek na okres), zerwanie (A.z).
 * rcj — próg komórki, hidden — 1 − widoczność komórki. Widoczności komórki nie zmienia (lustro CPU bez zmian).
 * Wklejana (woła cloakHash — pułapka 35).
 */
function tvStateAt(id, rcj, hidden, A, E, seedF, t) {
  const S = CLOAK_SHADER;
  const ix = uint(round(id.x.mul(2.0)).add(CLOAK_ID_OFFSET)).toVar();
  const iy = uint(round(id.y.div(CLOAK_HEX_RY * 0.5)).add(CLOAK_ID_OFFSET)).toVar();
  const seed = uint(seedF).toVar();
  const hA = cloakHash(ix, iy, seed.add(uint(31))).toVar();
  const hB = cloakHash(iy, ix, seed.add(uint(37))).toVar();
  // Przełączanie kanałów: okres z haszu komórki, śnieg na początku każdego kanału.
  const zap = t.div(mix(S.tvZapSec[0], S.tvZapSec[1], hA)).add(hB.mul(7.0)).toVar();
  const burst = float(1.0).sub(smoothstep(0.0, 0.14, fract(zap))).toVar();
  const tv = float(0.0).toVar();
  const lock = float(1.0).toVar();
  const chan = floor(zap).toVar();
  const snow = float(0.0).toVar();
  // Wyłączanie: komórki przed swoim progiem (strona ukryta frontu) — w głębi obraz odjeżdża w kanał, tuż przed
  // powrotem komórki śnieg. Tylko część komórek (pojedyncze ekrany, nie lita plama).
  If(abs(E.y).greaterThan(0.5), () => {
    const dh = select(E.y.greaterThan(0.0), E.x.sub(rcj), rcj.sub(E.x));
    const bt = dh.sub(CLOAK_TV_U0).div(mix(CLOAK_TV_LOCK0, CLOAK_TV_LOCK1, hB)).toVar();
    const share = cloakHash(ix, iy, seed.add(uint(41)));
    If(bt.greaterThanEqual(0.0).and(bt.lessThanEqual(1.0)).and(share.lessThan(CLOAK_TV_SHARE)), () => {
      tv.assign(1.0);
      lock.assign(smoothstep(0.55, 1.0, bt));
      snow.assign(max(float(1.0).sub(smoothstep(0.0, 0.12, bt)), burst.mul(0.8)));
    });
  });
  // Końcówka energii: w każdym okresie część komórek na chwilę gubi obraz (start — śnieg, koniec — obraz wraca).
  If(E.z.greaterThan(0.0005).and(tv.lessThan(0.5)), () => {
    const sl = t.div(mix(S.tvDesyncSec[0], S.tvDesyncSec[1], hB)).add(hA.mul(13.0)).toVar();
    const n = uint(floor(sl)).toVar();
    const r = cloakHash(ix, iy, seed.add(uint(211)).add(n));
    const w = mix(S.tvDesyncLen[0], S.tvDesyncLen[1], cloakHash(iy, ix, seed.add(uint(223)).add(n)));
    const tau = fract(sl).div(w).toVar();
    If(r.lessThan(E.z).and(tau.lessThan(1.0)), () => {
      tv.assign(1.0);
      lock.assign(smoothstep(0.7, 1.0, tau));
      snow.assign(max(float(1.0).sub(smoothstep(0.0, 0.1, tau)), burst.mul(0.6)));
      chan.addAssign(float(n).mul(17.0));
    });
  });
  // Zerwanie: większość ukrytych (wypadających) komórek gubi obraz, kanały skaczą szybko.
  If(A.z.greaterThan(0.001), () => {
    const gq = floor(t.mul(S.tvGlitchHz)).toVar();
    const g = cloakHash(ix, iy, seed.add(uint(331)).add(uint(gq)));
    If(g.lessThan(A.z.mul(S.tvGlitchShare)), () => {
      tv.assign(1.0);
      lock.assign(0.0);
      chan.assign(gq.mul(5.0).add(hA.mul(97.0)));
      // śnieg: większość ekranów z obrazem, część mocno zaszumiona (kwadrat haszu)
      const hs = cloakHash(iy, ix, seed.add(uint(337)).add(uint(gq)));
      snow.assign(max(snow, hs.mul(hs).mul(0.75).add(0.04)));
    });
  });
  tv.mulAssign(hidden.mul(clamp(E.w, 0.0, 1.0)));
  return { tv, lock, chan, snow, ix, iy, seed };
}

// ── Powierzchnia kadłuba ────────────────────────────────────────────────────────

/**
 * Hak fragmentu kadłuba (hexShips3D.tsl.js, po warpie): ctx.uv (uv sprite'a), ctx.sprite (węzeł tekstury
 * per obiekt), ctx.P (węzły slotu: uSpriteSize, uCloakA..E); out — barwa kadłuba (nie premultiplied), alpha —
 * pokrycie sprite'a. Wyłączone maskowanie (A.y = 0) = gałąź pominięta, obraz bez zmian.
 * Skład: kadłub × widoczność komórki + emisja E nad sylwetką; nad ukrytą komórką alfa tylko „nośna”
 * (4% przy jasnej emisji — tło przyciemnione niezauważalnie, E dodane addytywnie).
 */
export function hullCloakSurface(ctx, out, alpha, uTime, normalMap = null) {
  const P = ctx.P;
  const A = P.uCloakA;
  const B = P.uCloakB;
  const C = P.uCloakC;
  const D = P.uCloakD;
  const size = P.uSpriteSize;
  // PRZED gałęzią (pułapki 15 i 29): piksel kanoniczny i px sprite'a na piksel ekranu.
  const lpx = ctx.uv.sub(0.5).mul(size).toVar();
  const spritePerScreen = float(1.0).toVar();
  spritePerScreen.assign(max(fwidth(lpx.x), 1e-4));
  If(abs(A.y).greaterThan(0.5), () => {
    const { cellPx, hc, st, rcj } = cellAt(lpx, P, uTime);
    const seed = uint(D.x).toVar();
    const q = abs(hc.xy);
    const edge = float(0.5).sub(max(dot(q, vec2(0.5, 0.8660254)), q.x)).toVar();
    // Linia siatki ~1,2 px ekranu; drobniejsza niż 3 px komórka — siatka gaśnie (bez szumu na dalekim zoomie).
    const cellScreen = cellPx.div(spritePerScreen).toVar();
    const lineW = clamp(float(1.2).div(cellScreen), 0.012, 0.2);
    const line = float(1.0).sub(smoothstep(0.0, lineW, edge)).mul(smoothstep(3.0, 9.0, cellScreen)).toVar();
    const vis = st.x;
    const hidden = float(1.0).sub(vis).toVar();
    const motion = B.y;
    // Nieruchomy wzór w układzie kadłuba: łamie poświatę brzegu i refleks (ukryty kadłub spójny — nic nie płynie).
    const shimmer = smoothstep(0.32, 0.82, cloakNoise(lpx.div(cellPx.mul(1.8)), seed.add(uint(11)))).toVar();
    // Poświata brzegu: rozmyta alfa sprite'a (poziom mip z B.w — szerokość pasa w świecie).
    const blur = ctx.sprite.level(B.w).a;
    const rimRaw = clamp(float(1.0).sub(blur).mul(2.2), 0.0, 1.0).toVar();
    const rim = rimRaw.mul(rimRaw).mul(shimmer.mul(0.6).add(0.4)).toVar();
    // Szkło: refleks słońca na panelach (mapa normalnych) i krawędziach — ukryty kadłub czyta się jak
    // przezroczysta bryła, nie jak obrys (także na czarnym tle, gdzie soczewki nie widać).
    const nLocal = vec3(0.0, 0.0, 1.0).toVar();
    if (normalMap) {
      If(P.uHasNormalMap.greaterThan(0.5), () => {
        nLocal.assign(normalize(normalMap.level(0.0).xyz.mul(2.0).sub(1.0)));
      });
    }
    const c = cos(P.uRotation);
    const s = sin(P.uRotation);
    const N = vec3(nLocal.x.mul(c).sub(nLocal.y.mul(s)), nLocal.x.mul(s).add(nLocal.y.mul(c)), nLocal.z).toVar();
    const Hv = normalize(P.uLightDir.add(vec3(0.0, 0.0, 1.0)));
    const spec = max(dot(N, Hv), 0.0);
    const spec2 = spec.mul(spec);
    const spec8 = spec2.mul(spec2).mul(spec2.mul(spec2));
    const tilt = clamp(float(1.0).sub(N.z).mul(3.0), 0.0, 1.0);
    const glass = spec8.mul(spec8).mul(CLOAK_SHADER.glassSpec).add(tilt.mul(tilt).mul(CLOAK_SHADER.glassEdge))
      .mul(shimmer.mul(0.4).add(0.6)).toVar();
    const moveK = motion.mul(0.8).add(1.0);
    // Poświata brzegu w spoczynku ledwie widoczna — wyraźna dopiero w ruchu (ruch zdradza okręt, jak w Crysis).
    rim.mulAssign(motion.mul(motion).mul(1.6).add(0.35));
    // Wypełnienie przełączanej komórki rośnie ku krawędziom (środek ciemny) — energia na granicach komórek.
    const toEdge = float(1.0).sub(edge.mul(2.0)).toVar();
    const fill = toEdge.mul(toEdge).mul(CLOAK_SHADER.fillFlash);
    const glow = st.y.mul(line.mul(CLOAK_SHADER.edgeFlash).add(fill))
      .add(C.w.mul(line.mul(CLOAK_SHADER.pulseLine).add(CLOAK_SHADER.pulseFill)).mul(st.z.mul(0.5).add(0.5)))
      .add(hidden.mul(rim.mul(B.x)).mul(moveK))
      .toVar();
    // Heksy-ekrany: ramka ekranu = linia siatki (w ramce warstwa DIST nie przesuwa obrazu — widać ją na
    // miejscu; wnętrze pokazuje inny wycinek kadru), gaśnie, gdy obraz wraca na tło.
    If(P.uCloakE.w.greaterThan(0.001), () => {
      const tvs = tvStateAt(hc.zw, rcj, hidden, A, P.uCloakE, D.x, uTime);
      glow.addAssign(line.mul(tvs.tv).mul(float(1.0).sub(tvs.lock.mul(0.8))).mul(CLOAK_SHADER.tvFrame));
    });
    const E = C.xyz.mul(glow).add(vec3(0.62, 0.8, 1.0).mul(glass.mul(hidden).mul(moveK))).toVar();
    // Zerwanie: awaria — biało-błękitne krawędzie wypadających komórek, rzadkie błyski magenty, drganie
    // jasności całego kadłuba (z czasu, nie z komórki).
    If(A.z.greaterThan(0.001), () => {
      const flick = cloakHash(uint(floor(uTime.mul(30.0))), seed, uint(3));
      const hot = step(0.55, st.w).mul(st.y);
      E.addAssign(vec3(0.42, 0.66, 1.0).mul(hot.mul(line).mul(A.z)));
      E.addAssign(vec3(0.9, 0.2, 1.1).mul(step(0.96, st.w).mul(A.z).mul(line.mul(1.2).add(0.08))));
      out.mulAssign(float(1.0).add(A.z.mul(flick.sub(0.5)).mul(0.9)));
    });
    const eL = max(E.x, max(E.y, E.z));
    const carry = clamp(eL.mul(8.0), 0.0, 1.0).mul(0.04);
    const a2 = alpha.mul(vis.add(carry.mul(hidden))).toVar();
    out.assign(out.mul(vis).add(E).mul(alpha).div(max(a2, 1e-4)));
    alpha.assign(a2);
    Discard(alpha.lessThan(0.004));
  });
}

// ── Refrakcja (warstwa DIST) ────────────────────────────────────────────────────

/**
 * Wartość fragmentu kadłuba w warstwie DIST (Core3D.distortionTarget → „uber”): vec4(przesunięcie tła [px bufora,
 * osie sceny: x w prawo, y w górę], B: maska ekranu 0..1 albo znacznik refrakcji (−CLOAK_DIST_MARK), A: śnieg 0..1)
 * × pokrycie. o: { uv (sprite), P (węzły slotu), sprite (węzeł tekstury per obiekt), uTime, coverage (alfa
 * sprite'a), jx / jy (pochodne piksela kanonicznego po x i y ekranu — y w górę, liczone PRZED odrzuceniem
 * i gałęziami) }.
 * Soczewka GLOBALNA (× D.z — postęp ukrycia całego okrętu, nie komórki): tło powiększone ku środkowi sprite'a po
 * gładkiej kopule (alfa sprite'a mocno rozmyta), brzeg sylwetki zgina światło (gradient alfy w pasie brzegu);
 * nieruchoma względem kadłuba. Zerwanie: rozdarcie pasów i skoki komórek. Heksy-ekrany: komórka pokazuje wycinek
 * kadru wokół środka kanału (zoom kanału, obraz prosto na ekranie), w ramce bez przesunięcia.
 */
export function cloakDistOffset(o) {
  const P = o.P;
  const A = P.uCloakA;
  const B = P.uCloakB;
  const D = P.uCloakD;
  const S = CLOAK_SHADER;
  const size = P.uSpriteSize;
  const uTime = o.uTime;
  const lpx = o.uv.sub(0.5).mul(size).toVar();
  const { cellPx, hc, st, rcj } = cellAt(lpx, P, uTime);
  const hidden = float(1.0).sub(st.x).toVar();
  // Piksel kanoniczny → ekran (osie sceny, y w górę): odwrotność macierzy pochodnych (kolumny jx, jy).
  const jx = o.jx;
  const jy = o.jy;
  const det = jx.x.mul(jy.y).sub(jy.x.mul(jx.y)).toVar();
  const detS = select(abs(det).lessThan(1e-9), float(1e-9), det).toVar();
  const toScreen = (v) => vec2(jy.y.mul(v.x).sub(jy.x.mul(v.y)), jx.x.mul(v.y).sub(jx.y.mul(v.x))).div(detS);
  const seed = uint(D.x).toVar();
  const px = clamp(D.y.mul(CLOAK_SHARED.uZoomPx), S.minPx, S.maxPx).toVar();
  const off = vec2(0.0).toVar();
  // Soczewka globalna.
  If(D.z.greaterThan(0.001), () => {
    const mip = B.w;
    const step2 = exp2(mip).div(size).toVar();
    const ax = o.sprite.sample(o.uv.add(vec2(step2.x, 0.0))).level(mip).a.sub(o.sprite.sample(o.uv.sub(vec2(step2.x, 0.0))).level(mip).a);
    const ay = o.sprite.sample(o.uv.add(vec2(0.0, step2.y))).level(mip).a.sub(o.sprite.sample(o.uv.sub(vec2(0.0, step2.y))).level(mip).a);
    // brzeg: normalna lokalna (y w górę, jak skóra: v obrazu w dół → −y) obrócona do sceny (uRotation)
    const e = vec2(ax.negate(), ay).mul(S.edgeLensK).mul(px).toVar();
    const c = cos(P.uRotation).toVar();
    const s = sin(P.uRotation).toVar();
    const edgeOff = vec2(e.x.mul(c).sub(e.y.mul(s)), e.x.mul(s).add(e.y.mul(c)));
    // powiększenie ku środkowi: kopuła z mocno rozmytej alfy, wygaszona w pasie brzegu (bez ostrego cięcia)
    const domeMip = log2(max(min(size.x, size.y).mul(S.lensDome), 1.0));
    const dome = o.sprite.sample(o.uv).level(domeMip).a;
    const soft = o.sprite.sample(o.uv).level(mip).a;
    const mag = toScreen(lpx).mul(dome.mul(soft).mul(S.lensMag));
    off.assign(edgeOff.add(mag).mul(D.z));
  });
  // Zerwanie: pasy ekranu przesunięte w poziomie (część pasów) + skoki komórek.
  If(A.z.greaterThan(0.001), () => {
    const tq = uint(floor(uTime.mul(24.0))).toVar();
    const bandId = uint(floor(screenCoordinate.y.div(S.tearBand)).add(4096.0));
    const hb = cloakHash(bandId, tq, seed.add(uint(55)));
    const hb2 = cloakHash(tq, bandId, seed.add(uint(56)));
    const tear = hb.sub(0.5).mul(2.0).mul(step(0.55, hb2)).mul(S.tearPx).mul(A.z);
    const jump = vec2(st.w.sub(0.5), st.z.sub(0.5)).mul(A.z).mul(px).mul(1.6);
    off.addAssign(vec2(tear, 0.0).add(jump));
  });
  // Heksy-ekrany: próbka sceny T = środek kanału + zoom · (piksel − środek komórki) (px bufora, y w dół), przy
  // dostrojeniu zjeżdża na piksel (obraz tła za kadłubem). Przesunięcie warstwy o = P − T (osie sceny).
  const tvOut = vec2(0.0).toVar();
  If(P.uCloakE.w.greaterThan(0.001), () => {
    const tvs = tvStateAt(hc.zw, rcj, hidden, A, P.uCloakE, D.x, uTime);
    If(tvs.tv.greaterThan(0.001), () => {
      const dUp = toScreen(hc.xy.mul(cellPx)).toVar();
      const scr = max(screenSize, vec2(1.0)).toVar();
      const pd = screenCoordinate.xy.toVar();
      const ch = uint(tvs.chan).toVar();
      const c1 = cloakHash(tvs.ix.add(ch), tvs.iy, tvs.seed.add(uint(401)));
      const c2 = cloakHash(tvs.ix, tvs.iy.add(ch), tvs.seed.add(uint(409)));
      const c3 = cloakHash(tvs.iy.add(ch), tvs.ix, tvs.seed.add(uint(419)));
      const centre = vec2(c1, c2).mul(1.0 - 2.0 * S.tvMargin).add(S.tvMargin).mul(scr);
      const zoom = exp2(mix(S.tvZoomLog2[0], S.tvZoomLog2[1], c3));
      const T = clamp(centre.add(vec2(dUp.x, dUp.y.negate()).mul(zoom)), vec2(1.0), scr.sub(1.0));
      const oDown = pd.sub(mix(T, pd, tvs.lock)).toVar();
      // Ramka: bez przesunięcia (ostra krawędź — bez smug), maska ekranu miękka, winieta ku ramce.
      const q = abs(hc.xy);
      const edge = float(0.5).sub(max(dot(q, vec2(0.5, 0.8660254)), q.x)).toVar();
      const cellScreen = cellPx.div(max(sqrt(abs(det)), 1e-4));
      const bw = clamp(float(S.tvBezelPx).div(cellScreen), 0.02, 0.16).toVar();
      const inner = step(bw, edge).toVar();
      off.addAssign(vec2(oDown.x, oDown.y.negate()).mul(tvs.tv.mul(inner)));
      const rr = float(1.0).sub(edge.mul(2.0));
      const vign = float(1.0).sub(rr.mul(rr).mul(0.55));
      tvOut.assign(vec2(
        tvs.tv.mul(float(1.0).sub(tvs.lock)).mul(vign).mul(smoothstep(bw, bw.mul(1.8), edge)),
        tvs.snow.mul(tvs.tv).mul(inner)
      ));
    });
  });
  // B < 0 — znacznik refrakcji maskowania bez ekranu: „uber” nie rozszczepia barw (cienka poświata brzegu kadłuba
  // w soczewce rozpadała się na tęczę); pule broni piszą B = 0 i zostają z aberracją.
  const b = select(tvOut.x.greaterThan(0.0), tvOut.x, float(-CLOAK_DIST_MARK));
  return vec4(off, b, tvOut.y).mul(o.coverage);
}
