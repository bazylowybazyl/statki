// src/3d/skybake/styleGalaktyka.js
//
// Styl wypieku nieba „galaktyka”: pas Drogi Mlecznej jak na fotografii z ciemnego miejsca
// (referencje użytkownika 1–3, 2026-10-06). Trzy passy SkyBaker (skyBaker.js):
//
//   pola     — (L, τ, ρ, ciepło): poświata pasa z nierozdzielonych gwiazd (profil w poprzek pasa +
//              zgrubienie + obłoki gwiazd), grubość optyczna pyłu τ (pasma, szczeliny, włókna i odnogi
//              — anizotropowe, wzdłuż pasa), gęstość gwiazd ρ (pas, gromady), ciepło barwy (zgrubienie);
//   gwiazdy  — gwiazdy z komórek czterech siatek (od ziarna po jasne z halo): rozkład jasności potęgowy,
//              barwa z temperatury, gwiazdy TŁA gasną za pyłem z poczerwienieniem, gwiazdy PRZEDNIE nie;
//              profil Gaussa całkowany po tekselu (bez migotania podpikselowego);
//   obraz    — złożenie (niebo, pas × przepuszczalność pyłu, brązowy blask pyłu, obłoki H II, gwiazdy)
//              i wywołanie jak w astrofotografii: ekspozycja, rozciągnięcie asinh po luminancji (barwy
//              gwiazd zostają), nasycenie, uniesienie cieni, ramię do bieli → obraz wyświetlany (Dl).
//
// Układ: nieba współrzędne `p` (skyBaker: x ∈ ±0,8, y ∈ ±0,5, y w dół). W grze kadr widzi tylko środek
// tekstury (~0,35 × 0,19 jednostki przy zoomie 0,45 i 1080p), menu ~0,7 × 0,42, kamery 3D całość —
// kompozycja ma pas przez ŚRODEK. Parametry = uniformy (zmiana bez przebudowy grafu); ziarno przesuwa
// szumy i losuje gromady oraz obłoki H II (CPU).
import * as THREE from 'three/webgpu';
import {
  Fn, Loop, abs, atan, clamp, cos, dot, exp, float, floor, int, length, log, max, min, mix, saturate, sin, smoothstep,
  sqrt, step, texture, uniform, uniformArray, vec2, vec3, vec4
} from 'three/tsl';
import { skyBillow, skyFbm, skyFbm3, skyHashCpu, skyRidged, skyRidged3 } from './skyBakeNoise.js';
import { starFieldNode } from './skyBakeStars.js';
import { SKY_SPHERE_RAD_PER_UNIT } from './skyBaker.js';

const DEG = Math.PI / 180;
const LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * Parametry stylu: [klucz, etykieta, min, max, krok, domyślna, grupa]. Barwy osobno (GALAKTYKA_COLORS).
 * Jednostki geometrii — jednostki nieba (wysokość tekstury = 1).
 */
export const GALAKTYKA_PARAMS = Object.freeze([
  ['kat', 'kąt pasa [°]', -90, 90, 1, 27, 'pas'],
  ['srodekX', 'pas: przesunięcie x', -0.3, 0.3, 0.005, 0.0, 'pas'],
  ['srodekY', 'pas: przesunięcie y', -0.3, 0.3, 0.005, 0.045, 'pas'],
  ['krzywizna', 'krzywizna', -1, 1, 0.01, 0.12, 'pas'],
  ['falowanie', 'falowanie', 0, 0.08, 0.002, 0.018, 'pas'],
  ['szerokosc', 'szerokość rdzenia', 0.01, 0.15, 0.002, 0.032, 'pas'],
  ['halo', 'szerokość poświaty', 0.03, 0.4, 0.005, 0.11, 'pas'],
  ['haloAmp', 'siła poświaty', 0, 1.5, 0.01, 0.6, 'pas'],
  ['ogon', 'zasięg ogona', 0.05, 0.8, 0.01, 0.32, 'pas'],
  ['ogonAmp', 'siła ogona', 0, 0.5, 0.005, 0.07, 'pas'],
  ['zgrubienieS', 'zgrubienie: położenie', -0.6, 0.6, 0.005, 0.21, 'pas'],
  ['zgrubienieDl', 'zgrubienie: długość', 0.03, 0.5, 0.005, 0.15, 'pas'],
  ['zgrubienieGr', 'zgrubienie: grubość', 0.02, 0.3, 0.005, 0.075, 'pas'],
  ['zgrubienieAmp', 'zgrubienie: jasność', 0, 6, 0.05, 2.6, 'pas'],
  ['chmury', 'obłoki gwiazd: kontrast', 0, 2, 0.02, 0.85, 'pas'],
  ['chmuryCz', 'obłoki gwiazd: skala', 1, 14, 0.1, 4.2, 'pas'],
  ['cieploDysku', 'ciepło: udział dysku', 0.05, 3, 0.05, 0.55, 'pas'],
  ['poswiata', 'poświata (nierozdzielone gwiazdy)', 0, 2, 0.01, 0.75, 'pas'],
  ['ziarno', 'grudkowatość poświaty', 0, 1.5, 0.01, 0.45, 'pas'],
  ['ziarnoCz', 'grudkowatość: skala', 5, 200, 1, 45, 'pas'],
  ['pyl', 'pył: grubość', 0, 8, 0.05, 3.0, 'pył'],
  ['pylSzer', 'pył: szerokość pasma', 0.005, 0.2, 0.002, 0.034, 'pył'],
  ['pylPrzes', 'pył: meandry', 0, 0.06, 0.001, 0.016, 'pył'],
  ['pylSzeroki', 'pył: szerokie zasnucie', 0, 1, 0.01, 0.15, 'pył'],
  ['pylCz', 'pył: skala', 1, 30, 0.1, 9.5, 'pył'],
  ['pylAniz', 'pył: wydłużenie', 1, 6, 0.05, 1.6, 'pył'],
  ['szczelinyOd', 'szczeliny: próg', 0.2, 0.8, 0.005, 0.5, 'pył'],
  ['szczelinyMiekk', 'szczeliny: miękkość', 0.02, 0.5, 0.005, 0.13, 'pył'],
  ['porowatosc', 'porowatość pyłu', 0, 1, 0.01, 0.6, 'pył'],
  ['grudki', 'grudki pyłu', 0, 2, 0.02, 0.8, 'pył'],
  ['pylOkna', 'prześwity w pyle', 0, 1, 0.01, 0.6, 'pył'],
  ['wlokna', 'włókna', 0, 2, 0.02, 0.85, 'pył'],
  ['wloknaOd', 'włókna: próg', 0.2, 0.95, 0.005, 0.6, 'pył'],
  ['zawirowanie', 'zawirowanie', 0, 2, 0.02, 0.65, 'pył'],
  ['odnogi', 'odnogi pyłu', 0, 3, 0.02, 1.2, 'pył'],
  ['odnogiKat', 'odnogi: kąt [°]', -90, 90, 1, 38, 'pył'],
  ['odnogiS', 'odnogi: położenie', -0.6, 0.6, 0.005, 0.05, 'pył'],
  ['odnogiStrona', 'odnogi: strona (±1)', -1, 1, 2, 1, 'pył'],
  ['gwiazdy', 'gwiazdy: jasność', 0, 4, 0.02, 1.0, 'gwiazdy'],
  ['gwiazdyGestosc', 'gwiazdy: gęstość', 0, 3, 0.02, 1.0, 'gwiazdy'],
  ['gwiazdyTlo', 'gwiazdy poza pasem', 0, 1, 0.01, 0.14, 'gwiazdy'],
  ['gwiazdyJasne', 'jasne gwiazdy', 0, 4, 0.02, 1.0, 'gwiazdy'],
  ['gwiazdyPrzod', 'gwiazdy przed pyłem', 0, 1, 0.01, 0.28, 'gwiazdy'],
  ['gwiazdyPyl', 'gwiazdy: udział pyłu (głębia)', 0, 1, 0.01, 0.55, 'gwiazdy'],
  ['gromady', 'gromady (liczba)', 0, 8, 1, 4, 'gwiazdy'],
  ['hii', 'obłoki H II: jasność', 0, 4, 0.02, 1.0, 'barwa'],
  ['hiiLiczba', 'obłoki H II (liczba)', 0, 8, 1, 4, 'barwa'],
  ['przodPasma', 'poświata przed pyłem', 0, 1, 0.01, 0.15, 'barwa'],
  ['pylBlask', 'blask pyłu', 0, 1.5, 0.01, 0.2, 'barwa'],
  ['cirrus', 'mgiełka tła', 0, 1, 0.01, 0.25, 'barwa'],
  ['ekspozycja', 'ekspozycja', 0.003, 0.3, 0.001, 0.026, 'wywołanie'],
  ['rozciagniecie', 'rozciągnięcie (asinh)', 0.5, 40, 0.1, 8.0, 'wywołanie'],
  ['nasycenie', 'nasycenie', 0, 2.5, 0.02, 1.15, 'wywołanie'],
  ['czern', 'punkt czerni', 0, 0.05, 0.0005, 0.0, 'wywołanie'],
  ['kolano', 'kolano ramienia', 0.1, 0.78, 0.01, 0.5, 'wywołanie'],
  ['biel', 'biel (≤ 0,80)', 0.2, 0.8, 0.01, 0.8, 'wywołanie']
]);

/** Barwy (liniowo): [klucz, etykieta, domyślna]. */
export const GALAKTYKA_COLORS = Object.freeze([
  ['barwaDysku', 'dysk', [0.8, 0.86, 1.0]],
  ['barwaJadra', 'zgrubienie', [1.0, 0.8, 0.56]],
  ['barwaBrzegu', 'brzeg pasa', [0.52, 0.66, 1.0]],
  ['barwaPylu', 'pył (blask)', [0.38, 0.28, 0.22]],
  ['barwaCirrus', 'mgiełka tła', [0.5, 0.55, 0.75]],
  ['uniesienie', 'cienie (uniesienie, obraz)', [0.0016, 0.0024, 0.0066]],
  ['poczerwienienie', 'pył: pochłanianie R G B', [0.8, 1.0, 1.25]]
]);

export const GALAKTYKA_DEFAULTS = Object.freeze(Object.fromEntries([
  ...GALAKTYKA_PARAMS.map((p) => [p[0], p[5]]),
  ...GALAKTYKA_COLORS.map((c) => [c[0], [...c[2]]])
]));

/** Gotowe nastawy (nadpisują domyślne). „gra” — jasność pod rozgrywkę; reszta — jak referencje. */
export const GALAKTYKA_PRESETS = Object.freeze({
  // Pod rozgrywkę: ciemniej i spokojniej niż zdjęcia — kadłuby muszą się odcinać (zrzuty w grze 2026-10-06).
  gra: { ekspozycja: 0.016, rozciagniecie: 6, gwiazdy: 0.8, uniesienie: [0.0012, 0.0017, 0.0045] },
  jasna: {},
  nasycona: {
    ekspozycja: 0.06, nasycenie: 1.55, rozciagniecie: 10, zgrubienieAmp: 1.9, pyl: 3.4,
    barwaJadra: [1.0, 0.62, 0.3], barwaBrzegu: [0.45, 0.62, 1.0], barwaDysku: [0.95, 0.88, 0.85],
    uniesienie: [0.002, 0.003, 0.012], gwiazdyTlo: 0.35, gwiazdy: 1.2
  },
  naturalna: {
    ekspozycja: 0.05, nasycenie: 0.8, barwaJadra: [1.0, 0.86, 0.68], barwaDysku: [0.92, 0.92, 0.95],
    barwaBrzegu: [0.8, 0.84, 0.95], uniesienie: [0.003, 0.003, 0.0035], hii: 1.4
  },
  fioletowa: {
    ekspozycja: 0.045, nasycenie: 1.2, kat: 72, zgrubienieAmp: 0.8, barwaDysku: [0.78, 0.7, 1.0],
    barwaJadra: [1.0, 0.72, 0.8], barwaBrzegu: [0.5, 0.45, 1.0], uniesienie: [0.006, 0.004, 0.022],
    pyl: 2.2, gwiazdyTlo: 0.45, gwiazdy: 1.3
  }
});

// Siatki gwiazd (komórki, rozkład jasności, halo) — wspólne: skyBakeStars.js (STAR_GRIDS).
const MAX_CLUSTERS = 8;
const MAX_HII = 8;

/** RNG CPU z ziarna (lowbias32 po liczniku). */
export function cpuRand(seed, salt) {
  let n = 0;
  return () => skyHashCpu(seed >>> 0, salt >>> 0, (n++) >>> 0);
}

// ── TRYB SFERY (DECYZJE-2 N2): pas na WIELKIM KOLE (równik equirect, φ = 0) ──────────────────────────────────────
// Wzdłuż pasa s = λ / K, w poprzek d = φ / K [jednostki nieba; K = SKY_SPHERE_RAD_PER_UNIT ≈ 3,27 rad — gęstość jak
// płaszczyzna gry]. Szumy pasa (anizotropowe, wzdłuż s) są WALCOWE: punkt 2D q = (k·s + c, …) idzie na walec o obwodzie
// k · P (P = 2π / K — okres s), więc pas zamyka się na 2π bez szwu, a częstotliwość wzdłuż pasa jest ta sama co na
// płaszczyźnie. Szumy izotropowe (grudkowatość, mgiełka tła) — szum 3D kierunku. Rzeczy lokalne (zgrubienie, odnogi,
// gromady, obłoki H II) — różnica s zawinięta do ±P/2. Kąt pasa i krzywizna nie mają sensu na wielkim kole (orientację
// nieba w kadrze daje SKY_START w src/3d/skyScroll.js); `srodekX` przesuwa pas wzdłuż, `srodekY` kładzie go na małym
// kole (eksport sfery: 0 — dema/niebo-webgpu.js SFERA_DEFAULTS).
// ŁATY MGŁAWIC: obraz z wypiekacza płaskiego (styl „mgławica”, pass „obraz” — obraz wyświetlany) kładziony na sferę
// rzutem równoodległym wokół kierunku łaty (szerokość 2 · span, proporcje 1,6 : 1, miękki brzeg), składany „ekranem”
// 1 − (1 − niebo)(1 − mgławica · gain) w passie „laty”.
const SPHERE_K = SKY_SPHERE_RAD_PER_UNIT;
const SPHERE_P = 2 * Math.PI / SPHERE_K;
const MAX_PATCHES = 3;

/** Baza łaty na sferze: środek c (λ, φ), wschód e i północ n obrócone o roll wokół c. */
export function sphereFrameCpu(lonDeg, latDeg, rollDeg) {
  const D = Math.PI / 180;
  const lon = lonDeg * D, lat = latDeg * D, r = (rollDeg || 0) * D;
  const c = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const e0 = [-Math.sin(lon), Math.cos(lon), 0];
  const n0 = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const e = e0.map((v, i) => v * Math.cos(r) + n0[i] * Math.sin(r));
  const n = n0.map((v, i) => -e0[i] * Math.sin(r) + v * Math.cos(r));
  return { c, e, n };
}

/**
 * Styl „galaktyka”. opts.sphere — tryb sfery (wypiekacz equirect, SkyBaker({ sphere: true })), opts.patches — łaty
 * mgławic: [{ texture (obraz wyświetlany), lonDeg, latDeg, rollDeg, spanDeg (pół szerokości), gain }].
 */
export function createGalaktykaStyle(opts = {}) {
  const sphere = !!opts.sphere;
  const patchDefs = sphere ? (opts.patches || []).slice(0, MAX_PATCHES) : [];
  const U = {};
  for (const [k, , , , , def] of GALAKTYKA_PARAMS) U[k] = uniform(def);
  for (const [k, , def] of GALAKTYKA_COLORS) U[k] = uniform(new THREE.Vector3(...def));
  U.axis = uniform(new THREE.Vector2(1, 0));
  U.strAxis = uniform(new THREE.Vector2(1, 0));
  for (let i = 1; i <= 8; i++) U[`o${i}`] = uniform(new THREE.Vector2());
  U.seed = uniform(1, 'int');
  U.resScale = uniform(1);
  // Dodatkowe oktawy drobnych szumów (pył, grudki, włókna, odnogi) — kafle w gęstości > 1 (`extraOctaves`).
  U.dodOkt = uniform(0, 'int');
  U.clusters = uniformArray(Array.from({ length: MAX_CLUSTERS }, () => new THREE.Vector4()), 'vec4');
  U.clusterCount = uniform(0, 'int');
  U.hiiPos = uniformArray(Array.from({ length: MAX_HII }, () => new THREE.Vector4()), 'vec4');
  U.hiiCol = uniformArray(Array.from({ length: MAX_HII }, () => new THREE.Vector4()), 'vec4');
  U.hiiCount = uniform(0, 'int');
  // łaty mgławic (tryb sfery): środek, wschód, północ (vec3), pół szerokości [rad], siła
  const patches = patchDefs.map((P, i) => ({
    tex: P.texture,
    c: uniform(new THREE.Vector3(1, 0, 0)), e: uniform(new THREE.Vector3(0, 1, 0)), n: uniform(new THREE.Vector3(0, 0, 1)),
    span: uniform(1.0), gain: uniform(1.0), def: P, i
  }));

  // ── szumy: płaszczyzna / sfera (walec wzdłuż pasa, izotropowe z kierunku) ──
  // N2(q, k, …): fbm 2D punktu q; w trybie sfery fbm 3D punktu na walcu, gdzie q.x ma okres k · P (R2 — grzbietowy).
  const cylOf = (q, kper) => {
    const a = q.x.mul(2 * Math.PI).div(kper);
    const R = kper.div(2 * Math.PI);
    return vec3(cos(a).mul(R), sin(a).mul(R), q.y);
  };
  const KP = (k) => (typeof k === 'number' ? float(k * SPHERE_P) : k.mul(SPHERE_P));
  const N2 = (q, k, oct, lac, gain) => (sphere ? skyFbm3(cylOf(q, KP(k)), oct, lac, gain) : skyFbm(q, oct, lac, gain));
  const R2 = (q, k, oct, lac, gain) => (sphere ? skyRidged3(cylOf(q, KP(k)), oct, lac, gain) : skyRidged(q, oct, lac, gain));
  // izotropowy: płaszczyzna — fbm(p · freq + off), sfera — fbm 3D kierunku (freq / K na radian)
  const ISO = (F, freq, off, oct, lac, gain) => (sphere
    ? skyFbm3(F.dir.mul(freq.div(SPHERE_K)).add(vec3(off, 0.0)), oct, lac, gain)
    : skyFbm(F.p.mul(freq).add(off), oct, lac, gain));
  // różnica wzdłuż pasa zawinięta do ±P/2 (sfera); płaszczyzna — bez zmian
  const wrapS = (x) => (sphere ? x.sub(floor(x.div(SPHERE_P).add(0.5)).mul(SPHERE_P)) : x);

  // ── pas: układ (wzdłuż s, w poprzek d) ──────────────────────────────────────
  // F = { p (płaszczyzna: współrzędne nieba), dir (sfera: kierunek), s, d (z falowaniem), d0 (bez — gromady, H II) }
  const bandFrame = (ctx) => {
    if (sphere) {
      const ll = ctx.lonLat();
      const s = wrapS(ll.x.div(SPHERE_K).sub(U.srodekX)).toVar();
      const d0 = ll.y.div(SPHERE_K).sub(U.srodekY).toVar();
      const wob = N2(vec2(s.mul(2.2), 0.37).add(U.o1), 2.2, int(3), 2.0, 0.5).mul(U.falowanie);
      return { p: null, dir: ctx.dir().toVar(), s, d0, d: d0.sub(wob).toVar() };
    }
    const p = ctx.sky().toVar();
    const q = p.sub(vec2(U.srodekX, U.srodekY)).toVar();
    const s = dot(q, U.axis).toVar();
    const d0 = dot(q, vec2(U.axis.y.negate(), U.axis.x));
    const wob = skyFbm(vec2(s.mul(2.2), 0.37).add(U.o1), int(3), 2.0, 0.5).mul(U.falowanie)
      .add(s.mul(s).mul(U.krzywizna));
    return { p, dir: null, s, d0, d: d0.sub(wob).toVar() };
  };
  // położenie względem punktu (s, d) pasa — płaszczyzna: punkt nieba p − c.xy; sfera: (Δs zawinięte, d0 − c.y)
  const relTo = (F, c) => (sphere ? vec2(wrapS(F.s.sub(c.x)), F.d0.sub(c.y)) : F.p.sub(c.xy));

  // ── pass 1: pola ────────────────────────────────────────────────────────────
  const polaNode = (ctx) => Fn(() => {
    const F = bandFrame(ctx);
    const { s, d } = F;
    const thick = float(1.0).add(N2(vec2(s.mul(3.1), 1.7).add(U.o2), 3.1, int(3), 2.0, 0.5).mul(0.28));
    const z1 = d.div(U.szerokosc.mul(thick)).toVar();
    const z2 = d.div(U.halo).toVar();
    const disk = exp(z1.mul(z1).mul(-0.5))
      .add(exp(z2.mul(z2).mul(-0.5)).mul(U.haloAmp))
      .add(exp(abs(d).div(U.ogon).negate()).mul(U.ogonAmp)).toVar();
    const bs = wrapS(s.sub(U.zgrubienieS)).div(U.zgrubienieDl);
    const bd = d.div(U.zgrubienieGr);
    const bulge = exp(bs.mul(bs).add(bd.mul(bd)).mul(-0.5)).mul(U.zgrubienieAmp).toVar();

    // Obłoki gwiazd: anizotropowy fbm z zawinięciem — jasne płaty wzdłuż pasa.
    const qc = vec2(s.mul(U.chmuryCz), d.mul(U.chmuryCz).mul(2.4)).add(U.o3).toVar();
    const kc = U.chmuryCz;
    const wc = vec2(
      N2(qc.mul(0.6).add(vec2(4.1, 9.3)), kc.mul(0.6), int(4), 2.0, 0.5),
      N2(qc.mul(0.6).add(vec2(7.7, 1.2)), kc.mul(0.6), int(4), 2.0, 0.5)
    );
    const cl = N2(qc.add(wc.mul(0.9)), kc, int(5), 2.05, 0.55);
    const clouds = clamp(float(1.0).add(cl.mul(U.chmury)), 0.2, 2.4).toVar();
    // Grudkowatość: wahania liczby nierozdzielonych gwiazd w drobnej skali (pas „ziarnisty”, nie gładki).
    const mt = ISO(F, U.ziarnoCz, U.o2.mul(1.7), int(4).add(U.dodOkt), 2.1, 0.6);
    const clumpy = clamp(float(1.0).add(mt.mul(U.ziarno)), 0.3, 1.9).toVar();
    const starLight = disk.mul(clouds).mul(clumpy).add(bulge.mul(mix(float(1.0), clouds, 0.5)).mul(mix(float(1.0), clumpy, 0.6))).toVar();
    const L = starLight.mul(U.poswiata).toVar();

    // Pył: pasmo przy płaszczyźnie (z meandrami) + szerokie zasnucie, struktura wzdłuż pasa.
    const laneOff = N2(vec2(s.mul(1.6), 5.5).add(U.o4), 1.6, int(3), 2.0, 0.5).mul(U.pylPrzes);
    const lz = d.sub(laneOff).div(U.pylSzer);
    const mask = exp(lz.mul(lz).mul(-0.5)).add(exp(z2.mul(z2).mul(-0.5)).mul(U.pylSzeroki)).toVar();
    const qd = vec2(s, d.mul(U.pylAniz)).mul(U.pylCz).add(U.o5).toVar();
    const kd = U.pylCz;
    const wd = vec2(
      N2(qd.mul(0.55).add(vec2(1.3, 8.8)), kd.mul(0.55), int(4), 2.0, 0.5),
      N2(qd.mul(0.55).add(vec2(9.1, 3.4)), kd.mul(0.55), int(4), 2.0, 0.5)
    ).mul(U.zawirowanie);
    const qw = qd.add(wd).toVar();
    // Szczeliny (duże ciemne płaty), grudki (drobne obłoki pyłu — częściej przy szczelinach), włókna
    // (grzbiety), prześwity (odcinki pasa z mniejszą ilością pyłu) i drobne cętkowanie.
    const big = N2(qw, kd, int(7).add(U.dodOkt), 2.03, 0.52).mul(0.5).add(0.5).toVar();
    const rift = smoothstep(U.szczelinyOd, U.szczelinyOd.add(U.szczelinyMiekk), big).toVar();
    const small = N2(qw.mul(3.1).add(vec2(41.0, 7.0)), kd.mul(3.1), int(5).add(U.dodOkt), 2.1, 0.55).mul(0.5).add(0.5);
    const clumps = smoothstep(0.5, 0.64, small).mul(smoothstep(U.szczelinyOd.sub(0.13), U.szczelinyOd.add(0.04), big));
    const fil = smoothstep(U.wloknaOd, U.wloknaOd.add(0.22), R2(qw.mul(2.1).add(vec2(17.0, 3.0)), kd.mul(2.1), int(6).add(U.dodOkt), 2.07, 0.55));
    const mott = N2(qw.mul(6.0).add(vec2(2.0, 29.0)), kd.mul(6.0), int(4).add(U.dodOkt), 2.0, 0.5).mul(0.5).add(0.5);
    const winN = N2(qd.mul(0.28).add(vec2(5.0, 5.0)), kd.mul(0.28), int(3), 2.0, 0.5).mul(0.5).add(0.5);
    const win = mix(float(1.0), smoothstep(0.2, 0.75, winN).mul(1.5).add(0.15), U.pylOkna);
    const tauBand = mask.mul(rift.add(clumps.mul(U.grudki)).add(fil.mul(U.wlokna).mul(rift.mul(0.7).add(0.3))).add(mott.mul(0.05)))
      .mul(U.pyl).mul(win).toVar();
    // Porowatość: gęstość wewnątrz pasm się waha (półprzezroczyste plamy zamiast jednolitej wycinanki).
    const poro = N2(qw.mul(8.0).add(vec2(13.0, 61.0)), kd.mul(8.0), int(4).add(U.dodOkt), 2.0, 0.55).mul(0.5).add(0.5);
    tauBand.mulAssign(mix(float(1.0), poro.mul(1.1).add(0.45), U.porowatosc));

    // Odnogi: ciemne smugi wychodzące z pasa pod kątem (jak pył przy Wężowniku na fot. 2).
    const rel = vec2(wrapS(s.sub(U.odnogiS)), d).toVar();
    const su = dot(rel, U.strAxis);
    const sv = dot(rel, vec2(U.strAxis.y.negate(), U.strAxis.x));
    const side = d.mul(U.odnogiStrona);
    // Zasięg: od brzegu rdzenia na zewnątrz (~0,15), wzdłuż pasa ±~0,15 od położenia odnóg.
    const reach = smoothstep(0.0, 0.03, side).mul(exp(side.div(0.13).negate()))
      .mul(exp(rel.x.mul(rel.x).div(0.022).negate()));
    // Palce: wydłużone wzdłuż osi odnóg, szerokość ~0,01–0,02; brzegi poszarpane zawinięciem 2D.
    const sw = vec2(
      skyFbm(vec2(su, sv).mul(14.0).add(vec2(3.0, 1.0)), int(4), 2.0, 0.55),
      skyFbm(vec2(su, sv).mul(14.0).add(vec2(8.0, 6.0)), int(4), 2.0, 0.55)
    ).mul(0.012);
    const sq = vec2(su.add(sw.x).mul(3.2), sv.add(sw.y).mul(13.0)).add(U.o6).toVar();
    const streak = smoothstep(0.02, 0.38, skyFbm(sq, int(6).add(U.dodOkt), 2.0, 0.55));
    // Palce cienieją ku końcom (dłuższe tam, gdzie fbm wzdłuż v jest wysoki).
    const len = mix(float(0.06), float(0.16), skyFbm(vec2(sv.mul(9.0), 2.0).add(U.o6), int(3), 2.0, 0.5).mul(0.5).add(0.5));
    const taper = smoothstep(len, len.mul(0.25), side);
    const streamers = streak.mul(reach).mul(taper).mul(U.odnogi).mul(U.pyl).mul(0.8);
    const tau = tauBand.add(streamers).toVar();

    // Gęstość gwiazd: pas i zgrubienie (nasycone), tło, gromady.
    const rho = U.gwiazdyTlo.add(float(1.0).sub(U.gwiazdyTlo).mul(saturate(starLight.mul(0.8)))).toVar();
    Loop({ start: 0, end: U.clusterCount, type: 'int', condition: '<', name: 'ck' }, ({ ck }) => {
      const c = U.clusters.element(ck);
      const r = relTo(F, c).div(c.z);
      const g = exp(dot(r, r).mul(-0.5));
      rho.addAssign(g.mul(c.w));
      L.addAssign(g.mul(c.w).mul(0.06));
    });
    const warm = bulge.div(bulge.add(disk.mul(U.cieploDysku)).add(0.03));
    return vec4(L, tau, rho, warm);
  })();

  // ── pass 2: gwiazdy (pole gwiazd wspólne — skyBakeStars.js) ────────────────
  const gwiazdyNode = (ctx) => Fn(() => {
    const acc = starFieldNode({
      px: ctx.px.toVar(), size: ctx.size, resScale: U.resScale, seed: U.seed,
      brightness: U.gwiazdy, density: U.gwiazdyGestosc, brightMul: U.gwiazdyJasne, front: U.gwiazdyPrzod,
      // W punkcie gwiazdy: gęstość ρ (pola.z), ciepło (pola.w), pył przed gwiazdą tła (pola.y × udział głębi).
      sampleAt: (sp) => {
        const f = ctx.loadAt('pola', sp).toVar();
        return { prob: f.z, warm: f.w, trans: exp(U.poczerwienienie.mul(f.y.mul(U.gwiazdyPyl)).negate()) };
      }
    });
    return vec4(acc, 1.0);
  })();

  // ── pass 3: obraz (wyświetlany, liniowo) ─────────────────────────────────────
  const obrazNode = (ctx) => Fn(() => {
    const F = bandFrame(ctx);
    const ip = ctx.pixel();
    const f = ctx.load('pola', ip).toVar();
    const stars = ctx.load('gwiazdy', ip).rgb;
    const L = f.x;
    const tau = f.y;
    const warm = f.w;
    const Tb = exp(U.poczerwienienie.mul(tau).negate()).toVar();
    const edge = smoothstep(0.04, 0.7, L);
    const bandCol = mix(mix(U.barwaBrzegu, U.barwaDysku, edge), U.barwaJadra, saturate(warm));
    const band = bandCol.mul(L).mul(Tb.mul(float(1.0).sub(U.przodPasma)).add(U.przodPasma));
    const dustGlow = U.barwaPylu.mul(L).mul(float(1.0).sub(Tb.y)).mul(U.pylBlask);
    // Obłoki H II (Hα): kłębiaste plamy przy płaszczyźnie pasa, częściowo za pyłem.
    const em = vec3(0).toVar();
    Loop({ start: 0, end: U.hiiCount, type: 'int', condition: '<', name: 'hk' }, ({ hk }) => {
      const P = U.hiiPos.element(hk);
      const C = U.hiiCol.element(hk);
      const r = relTo(F, P).div(P.z).toVar();
      const g = exp(dot(r, r).mul(-1.4));
      const n = skyBillow(r.mul(1.3).add(vec2(float(hk).mul(17.3), float(hk).mul(-9.1))).add(U.o8), int(5), 2.1, 0.55);
      em.addAssign(C.xyz.mul(P.w).mul(g).mul(n.mul(1.1).add(0.15)));
    });
    const emT = em.mul(Tb.mul(0.65).add(0.35)).mul(U.hii);
    // Mgiełka tła (galaktyczne cirrusy daleko od pasa).
    const cir = smoothstep(0.42, 0.95, ISO(F, float(2.4), U.o7, int(6), 2.0, 0.55).mul(0.5).add(0.5));
    const cirrus = U.barwaCirrus.mul(cir).mul(U.cirrus).mul(0.08);
    const C0 = band.add(dustGlow).add(emT).add(cirrus).add(stars);

    // Wywołanie: ekspozycja → asinh po luminancji (barwa zostaje) → nasycenie → czerń, cienie → ramię.
    const x = C0.mul(U.ekspozycja).toVar();
    const lum = max(dot(x, LUMA), 1e-7).toVar();
    const bl = U.rozciagniecie.mul(lum);
    const asinhB = log(U.rozciagniecie.add(sqrt(U.rozciagniecie.mul(U.rozciagniecie).add(1.0))));
    const st = log(bl.add(sqrt(bl.mul(bl).add(1.0)))).div(asinhB);
    const col = x.mul(st.div(lum)).toVar();
    const l2 = dot(col, LUMA);
    col.assign(max(mix(vec3(l2), col, U.nasycenie), vec3(0.0)));
    col.assign(max(col.sub(U.czern), vec3(0.0)).div(float(1.0).sub(U.czern)));
    col.addAssign(U.uniesienie);
    // Ramię: tożsamość do kolana, wyżej miękko do bieli (≤ acesGry(1) — patrz skyGameColor.js).
    const k = U.kolano.min(U.biel.sub(0.01));
    const span = U.biel.sub(k);
    const over = max(col.sub(k), vec3(0.0));
    const soft = vec3(k).add(vec3(1.0).sub(exp(over.div(span).negate())).mul(span));
    col.assign(mix(col, soft, step(vec3(k), col)));
    return vec4(col, 1.0);
  })();

  /** Nastawy + ziarno → uniformy (i gromady / obłoki H II z ziarna). */
  function apply(params, seed, baker) {
    const P = { ...GALAKTYKA_DEFAULTS, ...params };
    for (const [k] of GALAKTYKA_PARAMS) U[k].value = Number(P[k]);
    for (const [k] of GALAKTYKA_COLORS) U[k].value.set(...P[k]);
    const a = P.kat * DEG;
    U.axis.value.set(Math.cos(a), Math.sin(a));
    const sa = P.odnogiKat * DEG;
    U.strAxis.value.set(Math.cos(sa), Math.sin(sa));
    const sd = (Number(seed) | 0) >>> 0;
    U.seed.value = sd & 0x7fffffff;
    // Gęstość nieba (kafel: pełne niebo / 5120) i dodatkowe oktawy detalu kafla.
    U.resScale.value = baker ? (baker.resScale ?? baker.width / 5120) : 1;
    U.dodOkt.value = Math.max(0, baker?.extraOctaves | 0);
    const rnd = cpuRand(sd, 0x51ab);
    for (let i = 1; i <= 8; i++) U[`o${i}`].value.set(rnd() * 240 - 120, rnd() * 240 - 120);
    // Punkt pasa (s wzdłuż, d w poprzek od osi z krzywizną; bez falowania — gromady i H II leżą przy płaszczyźnie).
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    // sfera: punkt pasa wprost w układzie (s, d) względem środka pasa (relTo w passach)
    const at = sphere ? (s, d) => [s, d] : (s, d) => {
      const dd = d + P.krzywizna * s * s;
      return [P.srodekX + ax * s - ay * dd, P.srodekY + ay * s + ax * dd];
    };
    const nc = Math.max(0, Math.min(MAX_CLUSTERS, Math.round(P.gromady)));
    const rc = cpuRand(sd, 0xc1c1);
    for (let i = 0; i < MAX_CLUSTERS; i++) {
      const s = (rc() * 2 - 1) * 0.55;
      const d = (rc() + rc() - 1) * 0.07;
      const [x, y] = at(s, d);
      U.clusters.array[i].set(x, y, 0.0025 + rc() * 0.007, 1.2 + rc() * 3.5);
    }
    U.clusterCount.value = nc;
    const nh = Math.max(0, Math.min(MAX_HII, Math.round(P.hiiLiczba)));
    const rh = cpuRand(sd, 0x4a11);
    const HII_COLORS = [[1.0, 0.24, 0.34], [1.0, 0.36, 0.5], [0.95, 0.3, 0.42], [1.0, 0.5, 0.6]];
    for (let i = 0; i < MAX_HII; i++) {
      const s = P.zgrubienieS + (rh() * 2 - 1) * 0.28;
      const d = (rh() * 2 - 1) * 0.025;
      const [x, y] = at(s, d);
      U.hiiPos.array[i].set(x, y, 0.004 + rh() * 0.014, 0.5 + rh() * 1.6);
      const c = HII_COLORS[Math.floor(rh() * HII_COLORS.length)];
      U.hiiCol.array[i].set(c[0], c[1], c[2], 0);
    }
    U.hiiCount.value = nh;
    for (const pt of patches) {
      const f = sphereFrameCpu(pt.def.lonDeg || 0, pt.def.latDeg || 0, pt.def.rollDeg || 0);
      pt.c.value.set(...f.c);
      pt.e.value.set(...f.e);
      pt.n.value.set(...f.n);
      pt.span.value = (pt.def.spanDeg || 40) * DEG;
      pt.gain.value = pt.def.gain ?? 1;
    }
  }

  // ── pass 4 (sfera z łatami): łaty mgławic na niebie, złożenie „ekranem” ──────────
  const PATCH_ASPECT = 1.6;
  const latyNode = (ctx) => Fn(() => {
    const col = ctx.load('obraz', ctx.pixel()).rgb.toVar();
    const dir = ctx.dir().toVar();
    for (const pt of patches) {
      const cz = dot(dir, pt.c);
      const cx = dot(dir, pt.e);
      const cy = dot(dir, pt.n);
      const rxy = length(vec2(cx, cy)).toVar();
      const th = atan(rxy, cz).toVar();
      const k = th.div(max(rxy, 1e-6));
      // rzut równoodległy wokół środka łaty [rad] → uv obrazu (y obrazu w dół, proporcje 1,6 : 1)
      const uvP = vec2(cx.mul(k).div(pt.span.mul(2.0)).add(0.5),
        float(0.5).sub(cy.mul(k).mul(PATCH_ASPECT).div(pt.span.mul(2.0)))).toVar();
      const ex = min(uvP.x, float(1.0).sub(uvP.x));
      const ey = min(uvP.y, float(1.0).sub(uvP.y));
      const mask = smoothstep(0.0, 0.14, ex).mul(smoothstep(0.0, 0.14, ey)).mul(step(th, Math.PI / 2)).toVar();
      const neb = texture(pt.tex, clamp(uvP, vec2(0.0), vec2(1.0)), float(0)).rgb.mul(mask).mul(pt.gain);
      col.assign(vec3(1.0).sub(vec3(1.0).sub(col).mul(vec3(1.0).sub(neb))));
    }
    return vec4(col, 1.0);
  })();

  return {
    name: 'galaktyka',
    U,
    params: GALAKTYKA_PARAMS,
    colors: GALAKTYKA_COLORS,
    defaults: GALAKTYKA_DEFAULTS,
    presets: GALAKTYKA_PRESETS,
    apply,
    sphere,
    passes: [
      { name: 'pola', node: polaNode },
      { name: 'gwiazdy', node: gwiazdyNode },
      { name: 'obraz', node: obrazNode },
      ...(patches.length ? [{ name: 'laty', node: latyNode }] : [])
    ]
  };
}
