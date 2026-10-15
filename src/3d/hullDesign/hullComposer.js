// src/3d/hullDesign/hullComposer.js
//
// KREATOR KADŁUBÓW — kompozytor w TSL: z projektu (pola poziomów z src/game/hullDesign/hullDesignGeometry.js,
// moduły, naklejki, paleta frakcji) liczy pakiet jak sprite okrętu. Jeden kod do podglądu i do wypieku: passy
// pełnoekranowe (QuadMesh → cel) na rendererze Core3D, wynik odczytywany do kanw / tablic (gra bierze je jak
// obraz sprite'a). Bez własnego renderera; materiały rozgrzewa prewarm() (compileAsyncNaCelu na prawdziwych celach).
//
// WYGLĄD (v2, 2026-10-14 — wzór: sprite'y Terra Novy): białe PŁYTY PANCERZA (poziom 1) i nadbudówki nad ciemną
// MASZYNOWNIĄ ramy (poziom 0). Płyty: stroma ściana + faza, linia paneli równoległa do krawędzi, nity, podział na
// panele (cegiełki o losowych granicach), kratki, luki, skrzynki, płyty na płytach. Maszynownia: wiązki RUR wzdłuż
// krawędzi pancerza (izolinie pola odległości — same zakręcają po fazach 45°, jak w sprite'ach), obejmy, a dalej od
// pancerza skrzynki, żebrowane walce i kraty. Moduły: ośmiokątne obudowy wież, pierścienie, gondole-walce z żebrami,
// wrota hangarów, kratki, luki, reaktor, mostek. Wszystkie wymiary detalu w JEDNOSTKACH DETALU (jd = design.detail j.),
// więc mała fregata ma tyle detalu na długość co lotniskowiec (jak sprite'y).
//
//   GEO   (RGBA16F) wysokość reliefu [j.], alfa, szwy, KOPUŁA [j.] (sylwetka rozmyta jak w HullSurface sprite'ów)
//   BASE  (RGBA16F) albedo bazowe (liniowo): farba, panele, rury, sprzęt, NAKLEJKI, moduły
//   EMIS  (RGBA16F) emisja (liniowo, HDR): okna tarasów, mostek, wentyle reaktora, światła wrót
//   SURF  (RGBA8)   mapa powierzchni w formacie HullSurface — RG normalne z (relief + kopuła) (x w prawo, y w GÓRĘ
//                   obrazu), B AO z próbek reliefu wokół, A relief: 0,5 + (h·tpu − 12) / 24 [px obrazu; ±12 jak
//                   heightRange gry] — PRAWDZIWA wysokość tarasów (samocień w grze)
//   ALB   (RGBA8)   albedo końcowe sRGB + alfa — szwy, brud z AO, rdza przy krawędziach płyt, piegi, otarcia faz;
//                   opcjonalnie emisja jako niebieska poświata (gra dziś świeci tylko z albedo: hullGlowMask)
//   EOUT  (RGBA8)   emisja do podglądu (sRGB, /3)
//
// Obraz ma `tpu` tekseli na j.: dłuższy bok ~HD_TEX.targetSide (fregata 150 j. → ~16 tek./j., lotniskowiec → ~2,4).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, uniform, uniformArray, texture, textureLoad, uv, ivec2,
  clamp, mix, smoothstep, step, abs, max, min, floor, fract, sin, cos, dot, length, normalize, sqrt, atan, select
} from 'three/tsl';
import { compileAsyncNaCelu } from '../rozgrzewka.js';
import { srgbEncode } from '../skybake/skyGameColor.js';
import { HD_MODULES, HD_PALETTE_ROWS, hullDesignPalette } from '../../game/hullDesign/hullDesignSchema.js';

export const HD_COMPOSER_LIMITS = Object.freeze({ modules: 96, decals: 48, maxSide: 4096, pipeRuns: 256, pipeFits: 256 });
/** Gęstość obrazu: dłuższy bok ~targetSide tekseli, w granicach [min, max] tekseli na j. */
export const HD_TEX = Object.freeze({ targetSide: 2560, min: 1.2, max: 16 });

/** Wygląd. Wymiary w jd (jednostkach detalu), chyba że opisano inaczej. */
export const HD_LOOK = {
  heights: [1.0, 7.5, 12.0, 15.0],   // rama, pancerz, nadbudówka, mostek
  wall: 0.55,                         // stroma ściana stopnia …
  wallShare: 0.6,                     // … i jej udział w wysokości stopnia (reszta — faza)
  bevel: [1.0, 2.0, 1.8, 1.6],        // faza nad ścianą
  pipe: { r: 2.2, gap: 0.6, start: 0.8, count: 4, clampStep: 26, clampW: 1.8 },
  machine: 18.0,                      // komórka sprzętu maszynowni
  // sieć rur (src/game/hullDesign/hullDesignPipes.js): przy włączonej sieci izolinie rur maszynowni cieńsze, rzadsze
  // i przerywane (sieć prowadzi wiązki), rowy w cieplejszym tonie
  net: { isoCount: 2, isoR: 1.45, isoSkip: 0.42, rowWarm: 0.55, bandLo: 0.9715, bandHi: 0.986, bracket: 4.5 },
  panel: {
    // rozmiary z sprite'ów TN (~1 px sprite'a = 1 jd): płyty burt lotniskowca ~80 × 36 px, szwy ~1,5 px, nity ~2 px
    // co ~11 px, linia przy krawędzi ~7 px od brzegu
    // segmenty w poprzek kadłuba (jak pasy płyt w sprite'ach TN), cięcia podłużne rzadkie
    col: 76, row: 150, colUpper: 50, rowUpper: 96, jitter: 0.9, seam: 1.5, inset: 5.0, insetW: 1.25,
    rivetLine: 3.6, rivetStep: 11.0, rivetR: 1.05,
    bevel: 2.4, pillow: 0.85, raised: 0.55,    // zaokrąglona faza brzegu panelu (jak sprite'y), podniesione panele
    slab: 1.6, slabBevel: 1.8,                 // gruba płyta: wnętrze szerokiej płyty wyżej o slab jd
    cushW: 9.0, cushH: 2.2                     // PODUSZKA: wierzch płyty / panelu wznosi się łukiem od krawędzi przez cushW
  },
  detail: { vent: 0.22, hatch: 0.1, box: 0.08, sub: 0.22, slit: 0.08 },
  ao: [[1.5, 1.0], [4.0, 0.8], [9.0, 0.6]],
  seamDark: 0.72,
  grime: 1.0,
  wear: 0.55,
  speck: 0.05,
  // ZADRAPANIA / WGNIOTKI (sprite'y TN): nieregularne ciemne plamki ~0,5–1,4 jd z jasnym brzegiem od światła,
  // rzadko na płycie, gęściej przy szwach i krawędziach — „zużyta” blacha zamiast piasku drobnych kropek
  dent: { cell: 7.0, p: 0.2, pEdge: 0.45, rMin: 0.5, rMax: 1.4, dark: 0.5 },
  rust: 1.0,                          // rdzawe kropki (sprite'y TN: dużo drobnych, przy szwach i krawędziach gęściej)
  rustColor: [0.25, 0.12, 0.05],      // liniowo
  // MALOWANE ŚWIATŁO: sprite'y TN mają wmalowane światło z lewej-góry obrazu (faza od światła biała, od cienia
  // ciemna i chłodna — odbicie nieba), gra dokłada swoje; bez niego płyty projektu wyglądają jak płaski papier.
  // Liczone z reliefu BEZ kopuły (sylwetka nie ciemnieje od dołu). dir — kierunek w normalnej (x w prawo, y w górę obrazu).
  paint: { k: 0.8, bright: 0.45, dark: 0.55, dir: [-0.6, 0.8], cool: 0.6, coolTint: [0.78, 0.86, 1.0] },
  windowGlow: 2.2,
  glowCyan: [0.07, 0.62, 0.95],       // barwa emisji wpisanej w albedo (hullGlowMask gry: z > 0,55, x < 0,15)
  domeTiltDeg: 36                     // nachylenie kopuły przy sylwetce (jak HULL_SURFACE_DEFAULTS.domeTiltDeg)
};

const TYPE_CODE = Object.fromEntries(Object.entries(HD_MODULES).map(([k, v]) => [k, v.code]));
const EDGE_GAIN = 0.3989423;

function srgbToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/**
 * Barwa bezpieczna dla skóry gry: hullGlowMask (hullLighting.tsl.js) zapala albedo z niebieskim > 0,42 i
 * czerwonym < 0,15 (liniowo) — niebieski pas wyglądałby jak świecąca tarcza. Taki kolor ściszony do b = 0,38.
 */
export function glowSafeLinear(c) {
  if (c[2] > 0.38 && c[0] < 0.2) { const k = 0.38 / c[2]; return [c[0] * k, c[1] * k, 0.38]; }
  return c;
}

/** Tekseli na j. dla pudła obrazu (w × h j.). */
export function hullComposerTexPerUnit(w, h, wanted = 0) {
  const side = Math.max(1, w, h);
  const t = wanted > 0 ? wanted : Math.min(HD_TEX.max, Math.max(HD_TEX.min, HD_TEX.targetSide / side));
  return Math.min(t, HD_COMPOSER_LIMITS.maxSide / side);
}

function makeMaterial(name, node) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.fragmentNode = node;
  m.blending = THREE.NoBlending;
  m.transparent = false;
  m.depthTest = false;
  m.depthWrite = false;
  m.fog = false;
  m.lights = false;
  return m;
}

function placeholder(type) {
  const data = type === THREE.HalfFloatType ? new Uint16Array(4) : new Uint8Array(4);
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, type);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeTarget(w, h, type) {
  const rt = new THREE.RenderTarget(w, h, { type, depthBuffer: false, stencilBuffer: false });
  rt.texture.minFilter = THREE.NearestFilter;
  rt.texture.magFilter = THREE.NearestFilter;
  rt.texture.generateMipmaps = false;
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

function halfTexture(fill, w, h) {
  const t = new THREE.DataTexture(fill, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ── pomocnicze TSL (wklejane — bez setLayout, pułapki 1 i 35) ──────────────────────────────────────────────
const hash12 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const hash11 = (x) => fract(sin(x.mul(91.3458).add(17.13)).mul(47453.5453));
function vnoise(p) {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  const a = hash12(i), b = hash12(i.add(vec2(1, 0))), c = hash12(i.add(vec2(0, 1))), d = hash12(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const sdBox = (q, b) => {
  const d = abs(q).sub(b);
  return length(max(d, vec2(0.0))).add(min(max(d.x, d.y), 0.0));
};
const sdRoundBox = (q, b, r) => sdBox(q, b.sub(vec2(r))).sub(r);
/** Ośmiokąt foremny o apotemie a (krawędzie osiowe i ukośne). */
const sdOct = (q, a) => {
  const k = abs(q);
  return max(max(k.x, k.y), k.x.add(k.y).mul(0.70710678)).sub(a);
};
const rot2 = (q, a) => vec2(q.x.mul(cos(a)).add(q.y.mul(sin(a))), q.x.mul(sin(a)).negate().add(q.y.mul(cos(a))));
const line = (d, w) => float(1.0).sub(smoothstep(w * 0.4, w, abs(d)));   // linia szerokości ~w
const lineN = (d, w) => float(1.0).sub(smoothstep(w.mul(0.4), w, abs(d)));
const segDist = (p, a, b) => {
  const pa = p.sub(a), ba = b.sub(a);
  const t = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0.0, 1.0);
  return length(pa.sub(ba.mul(t)));
};
const lum = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * Podział 1D na odcinki o losowych granicach: granica k w (k + (hash − ½)·J)·S. Zwraca { k, lo, hi } odcinka
 * zawierającego x (J < 1 — granice rosną).
 */
function part1(x, S, J, seed) {
  const k0 = floor(x.div(S));
  const bnd = (k) => k.add(hash11(k.add(seed)).sub(0.5).mul(J)).mul(S);
  const b0 = bnd(k0).toVar(), b1 = bnd(k0.add(1.0)).toVar();
  const below = x.lessThan(b0), above = x.greaterThanEqual(b1);
  const k = select(below, k0.sub(1.0), select(above, k0.add(1.0), k0));
  const lo = select(below, bnd(k0.sub(1.0)), select(above, b1, b0));
  const hi = select(below, b0, select(above, bnd(k0.add(2.0)), b1));
  return { k, lo, hi };
}

export class HullComposer {
  constructor(renderer) {
    this.renderer = renderer;
    this.look = HD_LOOK;
    this.lastMs = 0;
    const U = this.U = {
      img: uniform(new THREE.Vector4(0, 0, 1, 1)),       // minX, minY, w, h [j.]
      tex: uniform(new THREE.Vector4(1, 1, 2, 7)),       // szer., wys. [teksele], teksele/j., ziarno
      field: uniform(new THREE.Vector4(0, 0, 0.5, 48)),  // x0, y0, teksele pola/j., pasmo [j.]
      fieldSize: uniform(new THREE.Vector2(1, 1)),
      det: uniform(new THREE.Vector4(0.6, 1 / 0.6, 1, 1)),  // jd [j.], 1/jd, okna tarasów, nity
      style: uniform(new THREE.Vector4(0, 1, 1, 1)),     // profil fazy (0 prosty … 1 zaokrąglony), emisja → albedo, brud, otarcia
      bev: uniform(1.0),                                 // skala fazy krawędzi płyt (design.bevel)
      grv: uniform(new THREE.Vector4(1, 0, 0, 0)),       // widoczność losowych paneli (design.panels)
      dome: uniform(new THREE.Vector4(0, 0, 0, 0)),      // skala kopuły [j. na 1 rozmytej sylwetki]
      pal: uniformArray(Array.from({ length: 12 }, () => new THREE.Vector4()), 'vec4').setName('hullDesignPalette'),
      mods: uniformArray(Array.from({ length: HD_COMPOSER_LIMITS.modules * 2 }, () => new THREE.Vector4()), 'vec4').setName('hullDesignModules'),
      modCount: uniform(0, 'int'),
      decals: uniformArray(Array.from({ length: HD_COMPOSER_LIMITS.decals * 4 }, () => new THREE.Vector4()), 'vec4').setName('hullDesignDecals'),
      decalCount: uniform(0, 'int'),
      // sieć rur: x — włączona (0 / 1), y — okres obejm [jd]; biegi (3 × vec4: promienie rur 0–3, 4–7 [jd],
      // pół-szerokość, odstęp, najgrubsza, materiał + 4 · na płytach), osprzęt (2 × vec4: x, y, rodzaj + 8 · na płytach, obrót;
      // pół-wymiary [jd], p1, p2)
      pnet: uniform(new THREE.Vector4(0, 26, 0, 0)),
      pruns: uniformArray(Array.from({ length: HD_COMPOSER_LIMITS.pipeRuns * 3 }, () => new THREE.Vector4()), 'vec4').setName('hullDesignPipeRuns'),
      pfits: uniformArray(Array.from({ length: HD_COMPOSER_LIMITS.pipeFits * 2 }, () => new THREE.Vector4()), 'vec4').setName('hullDesignPipeFits')
    };
    // Tekstury: węzły bazowe z uv-atrapą (pułapka 7), wartości podmieniane przy każdym projekcie / rozmiarze.
    this.T = {
      field: texture(placeholder(THREE.HalfFloatType), vec2(0)),
      aux: texture(placeholder(THREE.HalfFloatType), vec2(0)),     // kopuła, pola ośmiokątne poziomów 1–3
      grooves: texture(placeholder(THREE.HalfFloatType), vec2(0)), // odległość od rowków [j.]
      pipeA: texture(placeholder(THREE.HalfFloatType), vec2(0)),   // sieć rur: przesunięcie w poprzek [j.], cos φ, sin φ, odcinek
      pipeB: texture(placeholder(THREE.UnsignedByteType), vec2(0)), // sieć rur: numer biegu, numer osprzętu (textureLoad)
      atlas: texture(placeholder(THREE.UnsignedByteType), vec2(0)),
      geo: texture(placeholder(THREE.HalfFloatType), vec2(0)),
      base: texture(placeholder(THREE.HalfFloatType), vec2(0)),
      emis: texture(placeholder(THREE.HalfFloatType), vec2(0)),
      surf: texture(placeholder(THREE.UnsignedByteType), vec2(0))
    };
    this.targets = null;
    this._fieldTex = null;
    this._auxTex = null;
    this._grooveTex = null;
    this._pipeATex = null;
    this._pipeBTex = null;
    this._atlasTex = null;
    this._build();
  }

  // ── graf ──────────────────────────────────────────────────────────────────────────────────────────────────
  _pal(k) { return this.U.pal.element(int(k)).xyz; }

  _fuv(p) {
    const U = this.U;
    return p.sub(U.field.xy).mul(U.field.z).div(U.fieldSize);
  }

  /** Pola poziomów w punkcie [j.] (vec4: rama, pancerz, nadbudówka, mostek). */
  _fieldAt(p) {
    return this.T.field.sample(this._fuv(p)).level(0);
  }

  /** Kopuła [0..1] i pola OŚMIOKĄTNE poziomów 1–3 [j.] (vec4) — offsety z fazą zamiast łuku. */
  _auxAt(p) {
    return this.T.aux.sample(this._fuv(p)).level(0);
  }

  /** Marsz wzdłuż kierunku `dir` od p (krok stepDu jd, n kroków): największa wartość `pick(aux)` [jd] przed jej
   *  spadkiem — połowa szczeliny maszynowni / głębokość płyty do osi środkowej. */
  _march(p, dir, pick, start, stepDu, n, name) {
    const U = this.U;
    const best = start.toVar();
    const q = p.toVar();
    const stepJ = U.det.x.mul(stepDu);
    Loop({ start: 0, end: n, type: 'int', condition: '<', name }, () => {
      q.addAssign(dir.mul(stepJ));
      const v = pick(this._auxAt(q)).mul(U.det.y);
      If(v.lessThan(best.add(0.04)), () => { Break(); });
      best.assign(v);
    });
    return best;
  }

  /**
   * SIEĆ RUR w punkcie (src/game/hullDesign/hullDesignPipes.js → tekstury pipeA / pipeB, tablice pruns / pfits):
   * wiązka (rury o promieniach biegu, obejmy z fazy długości łuku, kołnierze rur w odcinkach między obejmami) i osprzęt.
   * Zwraca węzły { K, H [jd nad dnem rowu], C, over, t [jd], halfW, band, fK, fH, fC, fOver } — K / fK: maski.
   */
  _pipeNet(p, iD) {
    const U = this.U, T = this.T, L = this.look;
    const fuv = this._fuv(p);
    const pa = T.pipeA.sample(fuv).level(0).toVar();
    const ip = ivec2(floor(fuv.mul(U.fieldSize)));
    const ipc = ivec2(clamp(ip.x, int(0), int(U.fieldSize.x).sub(1)), clamp(ip.y, int(0), int(U.fieldSize.y).sub(1)));
    const pb = textureLoad(T.pipeB, ipc).toVar();
    const runId = int(floor(pb.x.mul(255.0).add(0.5))).toVar();
    const fitId = int(floor(pb.y.mul(255.0).add(0.5))).toVar();
    const o = {
      K: float(0.0).toVar(), H: float(0.0).toVar(), C: vec3(0.0).toVar(), over: float(0.0).toVar(),
      t: float(1e3).toVar(), halfW: float(0.0).toVar(), band: float(0.0).toVar(),
      fK: float(0.0).toVar(), fH: float(0.0).toVar(), fC: vec3(0.0).toVar(), fOver: float(0.0).toVar()
    };
    const steel = this._pal(11), copper = this._pal(7), engC = this._pal(8), grime = this._pal(10), hullC = this._pal(0), hazard = this._pal(5);
    const on = U.pnet.x.greaterThan(0.5);
    If(runId.greaterThan(0).and(on), () => {
      const R0 = U.pruns.element(runId.mul(3)).toVar();
      const R1 = U.pruns.element(runId.mul(3).add(1)).toVar();
      const R2 = U.pruns.element(runId.mul(3).add(2)).toVar();
      const tU = pa.x.mul(iD).toVar();
      const halfW = R2.x, gap = R2.y, rMax = R2.z;
      const overF = step(3.5, R2.w);
      const mat = R2.w.sub(overF.mul(4.0));
      o.t.assign(tU);
      o.halfW.assign(halfW);
      o.over.assign(overF);
      o.band.assign(smoothstep(L.net.bandLo, L.net.bandHi, pa.y));
      If(abs(tU).lessThan(halfW.add(1.0)), () => {
        // rura pod punktem: promienie biegu od brzegu wiązki (sumy — bez zmiennych zmienianych w miejscu)
        const rs = [R0.x, R0.y, R0.z, R0.w, R1.x, R1.y, R1.z, R1.w];
        let off = halfW.negate();
        let pk = float(0.0), pr = float(0.0), pc = float(0.0), hit = float(0.0);
        rs.forEach((r, k) => {
          const c = off.add(r);
          const tn = tU.sub(c).div(max(r, 0.01));
          const ins = step(abs(tn), 1.0).mul(step(0.05, r));
          const cyl = sqrt(max(float(0.0), float(1.0).sub(tn.mul(tn))));
          pk = pk.add(ins.mul(k)); pr = pr.add(ins.mul(r)); pc = pc.add(ins.mul(cyl)); hit = hit.add(ins);
          off = off.add(select(r.greaterThan(0.05), r.mul(2.0).add(gap), float(0.0)));
        });
        const pkV = pk.toVar(), prV = pr.toVar(), pcV = pc.toVar(), inPipe = min(hit, 1.0).toVar();
        const inB = step(abs(tU), halfW).toVar();
        const band = o.band.mul(step(abs(tU), halfW.add(0.7))).toVar();
        // kołnierze rur w odcinkach między obejmami (numer odcinka pewny w połowie odcinka)
        const P = U.pnet.y;
        const seg = floor(pa.w), fr = fract(pa.w);
        const rid = float(runId);
        const hf = hash11(rid.mul(13.7).add(pkV.mul(5.3)).add(seg.mul(1.91)));
        const flange = step(hf, 0.2).mul(float(1.0).sub(smoothstep(0.32, 0.55, abs(fr.sub(0.5)).mul(P)))).mul(inPipe);
        // materiał: 0 jasna stal, 1 miedź, 2 rdza, 3 ciemna stal (grube rury zwykle stalowe)
        const hm = hash11(rid.mul(7.31).add(pkV.mul(3.17)).add(0.5));
        const thick = step(2.05, prV);
        const mixM = select(thick.greaterThan(0.5), select(hm.lessThan(0.72), float(0.0), float(3.0)),
          select(hm.lessThan(0.3), float(0.0), select(hm.lessThan(0.7), float(1.0), select(hm.lessThan(0.85), float(2.0), float(3.0)))));
        const mSteel = select(hm.lessThan(0.8), float(0.0), float(3.0)), mCop = select(hm.lessThan(0.75), float(1.0), float(2.0));
        const m = select(mat.lessThan(0.5), mixM, select(mat.lessThan(1.5), mSteel, mCop));
        const rust = mix(copper, grime, 0.45).mul(0.72);
        const baseC = select(m.lessThan(0.5), steel.mul(1.12), select(m.lessThan(1.5), copper.mul(1.6), select(m.lessThan(2.5), rust, engC.mul(0.95))));
        const segT = float(0.9).add(hash11(rid.mul(3.3).add(pkV.mul(11.1)).add(seg.mul(7.7))).mul(0.18));
        const shade = float(0.5).add(pcV.mul(0.55)).add(smoothstep(0.88, 1.0, pcV).mul(0.12));
        const pipeC = baseC.mul(segT).mul(shade).mul(float(1.0).sub(flange.mul(0.25)));
        const pipeH = prV.mul(pcV).mul(0.95).add(flange.mul(0.35));
        const floorC = vec3(0.016, 0.013, 0.010);
        // obejma: płaska taśma nad rurami
        const bandC = engC.mul(1.2).mul(float(0.85).add(step(0.5, fract(tU.div(1.6))).mul(0.15)));
        o.K.assign(max(inB, band));
        o.H.assign(mix(pipeH.mul(inPipe), rMax.add(0.45), band));
        o.C.assign(mix(mix(floorC, pipeC, inPipe), bandC, band));
      });
    });
    If(fitId.greaterThan(0).and(on), () => {
      const F0 = U.pfits.element(fitId.mul(2)).toVar();
      const F1 = U.pfits.element(fitId.mul(2).add(1)).toVar();
      const fOv = step(7.5, F0.z);
      const ft = F0.z.sub(fOv.mul(8.0)).toVar();
      const lf = rot2(p.sub(F0.xy), F0.w).mul(iD).toVar();     // [jd]
      const hw = F1.x, hh = F1.y, p1 = F1.z, p2 = F1.w;
      const al = abs(lf).toVar();
      o.fOver.assign(fOv);
      const bodyC = mix(engC.mul(1.25), hullC.mul(0.5), 0.35);
      If(ft.lessThan(1.5), () => {
        // skrzynka rozdzielcza: korpus z fazą, wewnętrzna pokrywa, śruby w rogach (p1 > 0,5 — uchwyt na pokrywie)
        const sd = sdRoundBox(lf, vec2(hw, hh), float(0.7)).toVar();
        const up = clamp(sd.negate().div(0.5), 0.0, 1.0);
        const tb = clamp(sd.negate().div(1.1), 0.0, 1.0);
        const bolt = float(1.0).sub(smoothstep(0.22, 0.42, length(al.sub(vec2(hw.sub(0.95), hh.sub(0.95))))));
        const lid = sdRoundBox(lf, vec2(hw.sub(1.6), hh.sub(1.6)), float(0.5));
        const lidUp = clamp(lid.negate().div(0.35), 0.0, 1.0).mul(step(2.2, min(hw, hh)));
        const seamL = max(lineN(sd.add(1.0), float(0.3)), lineN(lid, float(0.3)).mul(step(2.2, min(hw, hh))));
        const handle = step(al.x, hw.mul(0.35)).mul(step(abs(lf.y.sub(hh.mul(0.45))), 0.3)).mul(step(0.5, p1)).mul(lidUp);
        o.fH.assign(up.mul(p2.mul(float(0.8).add(tb.mul(0.2)))).add(lidUp.mul(0.3)).sub(seamL.mul(0.22)).add(bolt.mul(0.2)).add(handle.mul(0.4)));
        o.fK.assign(up);
        o.fC.assign(mix(mix(bodyC.mul(float(1.0).add(lidUp.mul(0.08))), bodyC.mul(0.5), max(bolt, seamL.mul(0.6))), engC.mul(0.6), handle));
      }).ElseIf(ft.lessThan(2.5), () => {
        // kołnierz / tuleja na wejściu pod płytę (p1 > 0,5 — para kołnierzy)
        const sd = sdBox(lf, vec2(hw, hh));
        const up = clamp(sd.negate().div(0.3), 0.0, 1.0).mul(select(p1.greaterThan(0.5), step(hw.mul(0.3), al.x), float(1.0)));
        const yn = lf.y.div(max(hh, 0.5));
        const roundY = sqrt(max(float(0.0), float(1.0).sub(yn.mul(yn).mul(0.6))));
        const bq = vec2(lf.x, fract(lf.y.div(1.5)).sub(0.5).mul(1.5));
        const bolt = float(1.0).sub(smoothstep(0.16, 0.32, length(bq))).mul(step(p1, 0.5)).mul(up);
        o.fH.assign(up.mul(p2.mul(roundY)).add(bolt.mul(0.15)));
        o.fK.assign(up);
        o.fC.assign(mix(engC.mul(1.3), engC.mul(0.6), bolt));
      }).ElseIf(ft.lessThan(3.5), () => {
        // zawór: korpus na wiązce, siłownik (walec o promieniu p1) z dźwignią
        const sd = sdRoundBox(lf, vec2(hw, hh), float(0.5));
        const up = clamp(sd.negate().div(0.4), 0.0, 1.0);
        const rr = length(lf);
        const act = clamp(p1.sub(rr).div(0.35), 0.0, 1.0);
        const actH = sqrt(max(float(0.0), float(1.0).sub(rr.div(max(p1, 0.3)).mul(rr.div(max(p1, 0.3))))));
        const lever = step(abs(lf.x), 0.3).mul(step(lf.y, p1.mul(1.9))).mul(step(0.0, lf.y));
        const rim = lineN(rr.sub(p1), float(0.25));
        o.fH.assign(up.mul(p2).add(act.mul(actH).mul(0.9)).add(lever.mul(0.7)).sub(rim.mul(0.2)));
        o.fK.assign(max(up, max(act, lever)));
        o.fC.assign(mix(mix(bodyC.mul(0.9), mix(copper.mul(1.25), hazard.mul(0.7), 0.35).mul(float(0.7).add(actH.mul(0.4))), act), engC.mul(0.7), lever));
      }).ElseIf(ft.lessThan(4.5), () => {
        // pompa: walec w poprzek wiązki, żebra, kołnierze na końcach
        const up = step(al.x, hw).mul(step(al.y, hh));
        const xn = clamp(lf.x.div(max(hw, 0.5)), -1.0, 1.0);
        const cyl = sqrt(max(float(0.0), float(1.0).sub(xn.mul(xn))));
        const endF = step(hh.sub(0.9), al.y);
        const rib = smoothstep(0.3, 0.45, abs(fract(lf.y.div(1.1)).sub(0.5))).mul(float(1.0).sub(endF));
        o.fH.assign(up.mul(p2.mul(mix(cyl, float(0.9), endF)).sub(rib.mul(0.3))));
        o.fK.assign(up);
        o.fC.assign(mix(engC.mul(1.05), engC.mul(1.35), endF).mul(float(0.65).add(cyl.mul(0.45))).mul(float(1.0).sub(rib.mul(0.3))));
      }).ElseIf(ft.lessThan(5.5), () => {
        // kolektor: płyta ze stosem krótkich rur wzdłuż osi gondoli, kołnierze na końcach
        const sd = sdBox(lf, vec2(hw, hh));
        const up = clamp(sd.negate().div(0.4), 0.0, 1.0);
        const lane = hh.mul(2.0).div(max(p1, 1.0));
        const ly = lf.y.add(hh);
        const li = floor(ly.div(lane));
        const lyl = ly.sub(li.add(0.5).mul(lane));
        const rr = lane.mul(0.42);
        const tn = clamp(lyl.div(rr), -1.0, 1.0);
        const inP = step(abs(lyl), rr);
        const cyl = sqrt(max(float(0.0), float(1.0).sub(tn.mul(tn))));
        const endF = step(hw.sub(1.1), al.x);
        const pcC = select(hash11(li.add(F0.x)).lessThan(0.55), steel, copper.mul(1.4));
        o.fH.assign(up.mul(mix(float(0.4).add(inP.mul(cyl).mul(rr).mul(1.6)), p2, endF)));
        o.fK.assign(up);
        o.fC.assign(mix(mix(vec3(0.02, 0.017, 0.013), pcC.mul(float(0.55).add(cyl.mul(0.5))), inP), engC.mul(1.2), endF));
      }).Else(() => {
        // zaślepka: płyta kołnierza z dwoma rzędami śrub
        const sd = sdRoundBox(lf, vec2(hw, hh), float(0.4));
        const up = clamp(sd.negate().div(0.3), 0.0, 1.0);
        const bq = vec2(al.x.sub(hw.mul(0.45)), fract(lf.y.div(1.4)).sub(0.5).mul(1.4));
        const bolt = float(1.0).sub(smoothstep(0.14, 0.28, length(bq))).mul(up);
        o.fH.assign(up.mul(p2).add(bolt.mul(0.12)));
        o.fK.assign(up);
        o.fC.assign(mix(engC.mul(1.15), engC.mul(0.55), bolt));
      });
    });
    return o;
  }

  /** Punkt kadłuba: wysokość [j.], alfa, szwy, kopuła [j.], farba (opcjonalnie), emisja (opcjonalnie). */
  _point(p, want) {
    const U = this.U, L = this.look;
    const tpu = U.tex.z;
    const D = U.det.x, iD = U.det.y;
    const seedV = vec2(U.tex.w, U.tex.w.mul(0.37));
    const f = this._fieldAt(p).toVar();
    const d0 = f.x, d1 = f.y, d2 = f.z, d3 = f.w;
    const P = p.mul(iD).toVar();                       // [jd]
    const du = f.mul(iD).toVar();                      // pola [jd]
    const rounded = U.style.x;
    const bevS = U.bev;
    const alpha = clamp(float(0.5).sub(d0.mul(tpu)), 0.0, 1.0).toVar();
    const s1 = clamp(float(0.5).sub(d1.mul(tpu)), 0.0, 1.0).toVar();
    const s2 = clamp(float(0.5).sub(d2.mul(tpu)), 0.0, 1.0).toVar();
    const s3 = clamp(float(0.5).sub(d3.mul(tpu)), 0.0, 1.0).toVar();
    // gradient pól (różnice centralne, ±0,8 jd)
    const e = D.mul(0.8);
    const fxp = this._fieldAt(p.add(vec2(e, 0.0))), fxm = this._fieldAt(p.sub(vec2(e, 0.0)));
    const fyp = this._fieldAt(p.add(vec2(0.0, e))), fym = this._fieldAt(p.sub(vec2(0.0, e)));
    const gx = fxp.sub(fxm).div(e.mul(2.0)).toVar(), gy = fyp.sub(fym).div(e.mul(2.0)).toVar();
    const nrm = (g) => select(length(g).greaterThan(0.25), normalize(g), vec2(1.0, 0.0));
    // pola ośmiokątne (rury, linie przy krawędzi, nity, grube płyty) i ich gradient
    const ax = this._auxAt(p).toVar();
    const oU = ax.yzw.mul(iD).toVar();                 // [jd]: pancerz (ze znakiem), nadbudówka, mostek
    const axp = this._auxAt(p.add(vec2(e, 0.0))), axm = this._auxAt(p.sub(vec2(e, 0.0)));
    const ayp = this._auxAt(p.add(vec2(0.0, e))), aym = this._auxAt(p.sub(vec2(0.0, e)));
    const ogx = axp.sub(axm).div(e.mul(2.0)).toVar(), ogy = ayp.sub(aym).div(e.mul(2.0)).toVar();

    // ── profil stopni: stroma ściana + faza (styl zaokrąglony: łuk) ──
    const H = L.heights;
    const prof = (dd, bev) => {
      const t1 = clamp(dd.div(L.wall), 0.0, 1.0).mul(L.wallShare);
      const t2 = clamp(dd.sub(L.wall).div(bev), 0.0, 1.0);
      const t2r = sqrt(max(float(0.0), float(1.0).sub(float(1.0).sub(t2).mul(float(1.0).sub(t2)))));
      return t1.add(mix(t2, t2r, rounded).mul(1.0 - L.wallShare));
    };
    const p0 = prof(du.x.negate(), bevS.mul(L.bevel[0])), p1 = prof(du.y.negate(), bevS.mul(L.bevel[1]));
    const p2 = prof(du.z.negate(), bevS.mul(L.bevel[2])), p3 = prof(du.w.negate(), bevS.mul(L.bevel[3]));
    const hU = p0.mul(H[0]).add(p1.mul(H[1] - H[0])).add(p2.mul(H[2] - H[1])).add(p3.mul(H[3] - H[2])).toVar();   // [jd]
    const upperK = max(s2, s3).toVar();

    // ── poziom wierzchni: odległość od krawędzi płyty i jej normalna ──
    // metryka ośmiokątna: izolinie z fazą 45° w narożnikach wklęsłych (jak linie paneli w sprite'ach TN)
    const topD = select(s3.greaterThan(0.5), oU.z, select(s2.greaterThan(0.5), oU.y, oU.x)).toVar();
    const topG = nrm(select(s3.greaterThan(0.5), vec2(ogx.w, ogy.w), select(s2.greaterThan(0.5), vec2(ogx.z, ogy.z), vec2(ogx.y, ogy.y)))).toVar();
    const topComp = select(s3.greaterThan(0.5), int(3), select(s2.greaterThan(0.5), int(2), int(1)));
    const flatTop = smoothstep(bevS.mul(L.bevel[1]).add(L.wall - 0.4), bevS.mul(L.bevel[1]).add(L.wall + 0.6), topD.negate()).mul(s1).toVar();   // płaski wierzch płyty

    // ── MODUŁY (najpierw: maskują panele i sprzęt pod sobą) ──
    const modH = float(0.0).toVar();      // [jd]
    const modCol = vec3(0.0).toVar();
    const modK = float(0.0).toVar();
    const modSeam = float(0.0).toVar();
    const engK = float(0.0).toVar();      // gondola MAIN (poziom ramy): pod nią wysokość samej ramy, bez okruchów płyt
    const emis = vec3(0.0).toVar();
    const hullC = this._pal(0), upperC = this._pal(1), trimC = this._pal(2), accent = this._pal(3), metal = this._pal(4);
    const hazard = this._pal(5), winC = this._pal(6), pipeC = this._pal(7), engC = this._pal(8), doorC = this._pal(9);
    const plateC = mix(hullC, upperC, upperK).toVar();
    Loop({ start: 0, end: HD_COMPOSER_LIMITS.modules, type: 'int', condition: '<', name: 'mi' }, ({ mi }) => {
      If(mi.greaterThanEqual(U.modCount), () => { Break(); });
      const A = U.mods.element(mi.mul(2)).toVar();
      const B = U.mods.element(mi.mul(2).add(1)).toVar();
      const lq = rot2(p.sub(A.xy), A.w).toVar();      // [j.]
      const lu = lq.mul(iD).toVar();                   // [jd]
      const type = A.z;
      const rr = length(lu).toVar();
      If(type.lessThan(3.5), () => {
        // gniazda wież S / M / L: v = 0 — KAPSUŁA Terra Novy (sprite'y Colossusa i Bellatora): ośmiokątna rama z podwójną
        // linią i nitami, płyta, zaokrąglony kwadratowy pierścień włazu, ciemne okno z płytą w środku, zaczepy na osi y;
        // v = 1 — płyta z rowkiem obrotnicy
        const R = B.z.mul(iD);
        If(rr.lessThan(R.mul(1.3).add(1.0)), () => {
          If(B.w.lessThan(0.5), () => {
            const outer = sdOct(lu, R.mul(1.16)).toVar();
            const frameIn = sdOct(lu, R.mul(0.98)).toVar();
            const inFrame = clamp(outer.negate().mul(2.0), 0.0, 1.0);
            const frameUp = clamp(outer.negate().div(0.7), 0.0, 1.0).mul(clamp(frameIn.div(0.5), 0.0, 1.0));
            const plate = clamp(frameIn.negate().div(0.4), 0.0, 1.0);
            const qa = R.mul(0.6), qt = R.mul(0.12).max(0.8), qr = R.mul(0.17);
            const sqO = sdRoundBox(lu, vec2(qa, qa), qr).toVar();
            const ring = clamp(sqO.negate().div(0.4), 0.0, 1.0).mul(clamp(sqO.add(qt).div(0.4), 0.0, 1.0)).toVar();
            const win = clamp(sqO.add(qt).negate().div(0.4), 0.0, 1.0).toVar();
            const qi = qa.sub(qt).mul(0.74);
            const sqI = sdRoundBox(lu, vec2(qi, qi), qr.mul(0.55));
            const inner = clamp(sqI.negate().div(0.4), 0.0, 1.0).toVar();
            const dbl = lineN(frameIn.add(R.mul(0.075)), float(0.3)).mul(plate);
            const clampK = step(abs(lu.x), R.mul(0.075)).mul(step(abs(abs(lu.y).sub(qa.add(R.mul(0.1)))), R.mul(0.07))).mul(plate).toVar();
            const a = atan(lu.y, lu.x);
            const nb = floor(R.mul(1.4)).max(8.0);
            const ang = fract(a.div(6.28318).mul(nb));
            const midR = R.mul(1.07);
            const boltD = length(vec2(ang.sub(0.5).mul(6.28318).mul(midR).div(nb), rr.sub(midR)));
            const bolt = float(1.0).sub(smoothstep(0.25, 0.45, boltD)).mul(frameUp);
            modH.addAssign(frameUp.mul(1.3).add(plate.mul(0.45)).add(ring.mul(1.1)).sub(win.mul(2.4)).add(inner.mul(1.2))
              .add(clampK.mul(0.6)).add(bolt.mul(0.25)).sub(dbl.mul(0.3)));
            modK.assign(max(modK, inFrame));
            modSeam.assign(max(modSeam, max(max(lineN(frameIn, float(0.35)), lineN(outer, float(0.35))).mul(0.6),
              max(lineN(sqO, float(0.3)), lineN(sqO.add(qt), float(0.3))).mul(0.55))));
            const frameC = plateC.mul(1.02).mul(float(1.0).sub(bolt.mul(0.45)));
            const winC = mix(vec3(0.03, 0.03, 0.028), metal.mul(0.95), inner);
            const col = mix(frameC, plateC.mul(0.97), plate).toVar();
            col.assign(mix(col, plateC.mul(1.05), ring));
            col.assign(mix(col, winC, win));
            col.assign(mix(col, trimC.mul(0.75), clampK));
            modCol.assign(col);
          }).Else(() => {
            const plate = clamp(R.sub(rr), 0.0, 1.0);
            const groove = lineN(rr.sub(R.mul(0.8)), float(0.7));
            const a = atan(lu.y, lu.x);
            const n = float(16.0);
            const ang = fract(a.div(6.28318).mul(n));
            const boltD = length(vec2(ang.sub(0.5).mul(6.28318).mul(R).mul(0.9).div(n), rr.sub(R.mul(0.9))));
            const bolt = float(1.0).sub(smoothstep(0.35, 0.6, boltD));
            modH.addAssign(plate.mul(1.4).sub(groove.mul(0.5)).add(bolt.mul(0.4)));
            modK.assign(max(modK, plate));
            modCol.assign(select(rr.lessThan(R.mul(0.8)), metal.mul(0.75), metal.mul(1.25)).mul(float(1.0).sub(groove.mul(0.5))));
          });
        });
      }).ElseIf(type.lessThan(4.5), () => {
        // gondola MAIN (v = 0): walec wzdłuż osi gondoli — bęben z żebrami i kołnierzami, szyjka przy kadłubie (+x),
        // ciemna gardziel dyszy na rufie (−x); v = 1: kanciasty blok z kratą (silniki Colossusa)
        const w = B.x.mul(iD), hh = B.y.mul(iD);
        const sd = sdRoundBox(lq, B.xy, min(B.y.mul(0.35), 16.0)).mul(iD).toVar();
        If(sd.lessThan(1.0), () => {
          const inside = clamp(sd.negate().div(0.5), 0.0, 1.0);
          engK.assign(max(engK, inside));
          If(B.w.lessThan(0.5), () => {
            // BECZKA jak sprite'y TN: gęste żebra (pierścienie co P jd, ciemne szczeliny), 2–3 grube kołnierze z nitami,
            // szyjka przy kadłubie (+x), dzwon dyszy na rufie (−x) z drobnymi pierścieniami i ciemną gardzielą
            const neckLen = min(hh.mul(0.5), w.mul(0.24));
            const inNeck = step(w.sub(neckLen), lu.x).toVar();
            const bellLen = min(hh.mul(0.6), w.mul(0.3));
            const bx = lu.x.add(w).toVar();                                        // od rufy gondoli [jd]
            const inBell = float(1.0).sub(step(bellLen, bx)).toVar();
            const bellT = clamp(bx.div(max(bellLen, 0.5)), 0.0, 1.0);
            const rad = mix(mix(hh, hh.mul(0.78), inNeck), hh.mul(mix(float(0.86), float(1.0), bellT)), inBell).toVar();
            const yN = clamp(lu.y.div(max(rad, 0.5)), -1.0, 1.0);
            const cyl = sqrt(max(float(0.0), float(1.0).sub(yN.mul(yN)))).toVar();
            const capH = min(rad, 9.0);
            const inRad = step(abs(lu.y), rad).toVar();
            const drumL = w.mul(2.0).sub(neckLen).sub(bellLen).max(1.0);
            const dx = bx.sub(bellLen);                                            // od początku bębna
            const inDrum = float(1.0).sub(inNeck).sub(inBell).max(0.0).toVar();
            const P = clamp(drumL.div(10.0), 2.4, 4.2);
            const rf = fract(dx.div(P));
            const rib = smoothstep(0.08, 0.22, rf).mul(float(1.0).sub(smoothstep(0.62, 0.78, rf))).toVar();
            const nF = select(drumL.greaterThan(30.0), float(3.0), float(2.0));
            const fP = drumL.div(nF);
            const fDist = abs(fract(dx.div(fP).add(0.5)).sub(0.5)).mul(fP).toVar();
            const flW = clamp(P.mul(0.75), 1.4, 2.6);
            const flange = float(1.0).sub(smoothstep(flW.mul(0.45), flW.mul(0.6), fDist)).mul(inDrum).toVar();
            const rivY = fract(lu.y.div(1.6)).sub(0.5).mul(1.6);
            const rivet = float(1.0).sub(smoothstep(0.16, 0.3, length(vec2(fDist, rivY)))).mul(flange).mul(step(0.25, cyl));
            const bellRing = smoothstep(0.15, 0.35, abs(fract(bx.div(1.6)).sub(0.5))).mul(inBell);
            const neckEdge = line(lu.x.sub(w).add(neckLen), 0.9);
            const ribH = rib.mul(0.55).mul(inDrum).mul(float(1.0).sub(flange));
            // para rur wzdłuż bębna (jak osprzęt gondol w sprite'ach): miedź na ±0,62 promienia, obejmy na kołnierzach
            const pr = clamp(rad.mul(0.075), 0.5, 1.4);
            const pyD = abs(abs(lu.y).sub(rad.mul(0.62)));
            const pipeT = clamp(pyD.div(pr), 0.0, 1.0);
            const sidePipe = step(pyD, pr).mul(inDrum).toVar();
            const pipeCyl = sqrt(max(float(0.0), float(1.0).sub(pipeT.mul(pipeT))));
            modH.addAssign(capH.mul(cyl).mul(inRad).mul(inside).add(ribH.mul(float(1.0).sub(sidePipe))).add(flange.mul(0.9)).add(rivet.mul(0.15))
              .sub(bellRing.mul(0.35)).sub(neckEdge.mul(0.8)).add(sidePipe.mul(pipeCyl.mul(pr).add(0.6))));
            modK.assign(max(modK, inside));
            const gap = float(1.0).sub(rib).mul(inDrum).mul(float(1.0).sub(flange));
            modSeam.assign(max(modSeam, max(max(neckEdge.mul(0.6), lineN(fDist.sub(flW.mul(0.52)), float(0.3)).mul(inDrum).mul(0.6)), gap.mul(0.35))));
            // barwa: żebra jaśniejsze, szczeliny ciemne, kołnierze najjaśniejsze, dzwon ciemniejszy; rdza w szczelinach
            const shade = float(0.72).add(cyl.mul(0.38));
            const ribC = mix(engC.mul(0.36), engC.mul(1.05), rib);
            const bellC = engC.mul(mix(float(0.45), float(0.75), bellRing));
            const bodyC = mix(mix(ribC, pipeC.mul(0.95), inNeck), bellC, inBell).mul(shade).toVar();
            // kołnierze w odcieniu brązu (sprite'y: mosiężne obręcze), rury miedziane
            bodyC.assign(mix(bodyC, mix(engC.mul(1.35), pipeC.mul(1.45), 0.45).mul(shade), flange));
            bodyC.assign(mix(bodyC, pipeC.mul(float(0.85).add(pipeCyl.mul(0.65))), sidePipe.mul(float(1.0).sub(flange.mul(0.6)))));
            const rn = vnoise(lu.mul(vec2(0.35, 0.9)).add(A.xy.mul(0.013)));
            const rust = smoothstep(0.55, 0.85, rn).mul(gap).mul(0.5);
            modCol.assign(mix(bodyC, pipeC.mul(0.75), rust));
            modCol.assign(mix(modCol, trimC.mul(0.45), rivet));
            // wylot dyszy (ciemna gardziel na rufie)
            const throat = smoothstep(0.0, 1.4, bx.negate().add(1.4)).mul(inRad);
            modCol.assign(mix(modCol, vec3(0.02, 0.02, 0.022), throat.mul(0.85)));
            emis.addAssign(vec3(1.0, 0.42, 0.12).mul(throat).mul(0.6));
          }).Else(() => {
            const rim = clamp(sd.negate().sub(1.4).div(0.4), 0.0, 1.0);
            const g = vec2(fract(lu.x.div(3.1)).sub(0.5), fract(lu.y.div(3.1)).sub(0.5)).abs();
            const bars = max(smoothstep(0.32, 0.42, g.x), smoothstep(0.32, 0.42, g.y));
            modH.addAssign(inside.mul(1.4).sub(rim.mul(float(2.4).sub(bars.mul(1.6)))));
            modK.assign(max(modK, inside));
            modSeam.assign(max(modSeam, line(sd.add(1.4), 0.6).mul(0.8)));
            modCol.assign(mix(plateC.mul(0.97), mix(vec3(0.03, 0.03, 0.028), engC.mul(1.1), bars), rim));
          });
        });
      }).ElseIf(type.lessThan(5.5), () => {
        // luk (v = 0): wnęka, obramowanie w pasy ostrzegawcze, podział w połowie;
        // klapa TN (v = 1): podniesiona płytka z rowkiem obrysu, śrubami w rogach i uchwytem
        const hbL = B.xy.mul(iD);
        If(B.w.lessThan(0.5), () => {
          const sd = sdRoundBox(lu, hbL, float(1.6)).toVar();
          If(sd.lessThan(1.0), () => {
            const inside = float(1.0).sub(smoothstep(-0.4, 0.4, sd));
            const border = inside.mul(float(1.0).sub(smoothstep(1.8, 2.3, sd.negate())));
            const recess = clamp(sd.negate().sub(2.1).div(0.6), 0.0, 1.0);
            modH.subAssign(recess.mul(1.4).add(line(sd, 0.6).mul(0.3)).add(line(lu.x, 0.5).mul(recess).mul(0.3)));
            const stripe = step(0.5, fract(lu.x.add(lu.y).div(3.4)));
            modK.assign(max(modK, inside));
            modSeam.assign(max(modSeam, line(sd, 0.6).mul(inside)));
            modCol.assign(mix(doorC.mul(1.1), mix(vec3(0.02), hazard, stripe), border));
          });
        }).Else(() => {
          const mn = min(hbL.x, hbL.y);
          const sd = sdRoundBox(lu, hbL, min(mn.mul(0.3), 1.0)).toVar();
          If(sd.lessThan(0.8), () => {
            const up = clamp(sd.negate().div(0.45), 0.0, 1.0);
            const inside = clamp(sd.negate().mul(2.0), 0.0, 1.0);
            const groove = lineN(sd.add(min(mn.mul(0.35), 0.9)), float(0.3)).mul(step(1.6, mn));
            const al = abs(lu);
            const bc = hbL.sub(vec2(min(mn.mul(0.35), 0.75)));
            const bolt = float(1.0).sub(smoothstep(0.17, 0.32, length(al.sub(bc)))).mul(step(1.4, mn));
            const handle = step(abs(lu.x), hbL.x.mul(0.38)).mul(step(abs(lu.y.sub(hbL.y.mul(0.45))), 0.22)).mul(step(1.8, hbL.y));
            modH.addAssign(up.mul(0.55).sub(groove.mul(0.25)).add(bolt.mul(0.15)).add(handle.mul(0.35)));
            modK.assign(max(modK, inside));
            modSeam.assign(max(modSeam, max(lineN(sd, float(0.35)), groove).mul(0.7)));
            modCol.assign(mix(mix(plateC.mul(0.985), trimC.mul(0.55), bolt), metal.mul(1.7), handle));
          });
        });
      }).ElseIf(type.lessThan(6.5), () => {
        // reaktor: pancerna pokrywa, wentyle promieniste ze światłem, pierścień ostrzegawczy (v = 1 — wewnątrz kadłuba)
        const R = B.z.mul(iD);
        If(rr.lessThan(R.add(1.0)).and(B.w.lessThan(0.5)), () => {
          const a = atan(lu.y, lu.x);
          const cap = clamp(R.mul(0.92).sub(rr), 0.0, 1.0);
          const ventR = step(R.mul(0.48), rr).mul(step(rr, R.mul(0.82)));
          const va = fract(a.div(6.28318).mul(10.0));
          const vent = ventR.mul(step(0.35, va)).mul(step(va, 0.65));
          const center = clamp(R.mul(0.3).sub(rr), 0.0, 1.0);
          const ringBand = step(R.mul(0.92), rr).mul(step(rr, R));
          const ringStripe = step(0.5, fract(a.div(6.28318).mul(18.0)));
          modH.addAssign(cap.mul(1.0).sub(vent.mul(1.0)).add(center.mul(0.8)).sub(line(rr.sub(R.mul(0.4)), 0.6).mul(0.3)));
          modK.assign(max(modK, step(rr, R)));
          modCol.assign(select(ringBand.greaterThan(0.5), mix(vec3(0.02), hazard, ringStripe), mix(plateC.mul(0.9), vec3(0.04), vent)));
          emis.addAssign(accent.mul(vent).mul(1.4));
        });
      }).ElseIf(type.lessThan(7.5), () => {
        // mostek: pas szyb z przodu, okna burtowe, talerz radaru (szyby ciemne, świecą wg „okien” projektu)
        const w = B.x.mul(iD), hh = B.y.mul(iD);
        const sd = sdRoundBox(lu, vec2(w, hh), min(hh.mul(0.55), 9.0));
        If(sd.lessThan(1.0), () => {
          const front = step(w.sub(4.2), lu.x).mul(step(lu.x, w.sub(1.8))).mul(step(abs(lu.y), hh.sub(2.2)));
          const mull = step(0.2, fract(lu.y.div(2.0)));
          const side = step(hh.sub(3.6), abs(lu.y)).mul(step(abs(lu.y), hh.sub(2.0))).mul(step(w.negate().add(5.0), lu.x)).mul(step(lu.x, w.sub(6.5)));
          const sideM = step(0.35, fract(lu.x.div(2.4)));
          const glass = max(front.mul(mull), side.mul(sideM));
          const dr = min(hh.mul(0.5), 7.0);
          const dd = length(lu.sub(vec2(w.mul(-0.45), 0.0)));
          const dish = float(1.0).sub(smoothstep(dr.sub(0.4), dr.add(0.4), dd));
          modH.addAssign(dish.mul(clamp(dd.div(dr), 0.0, 1.0).mul(1.2).add(0.3)).sub(glass.mul(0.5)));
          modK.assign(max(modK, max(glass, dish)));
          modCol.assign(mix(mix(plateC.mul(1.02), engC.mul(1.3), dish), vec3(0.03, 0.04, 0.05), glass));
          emis.addAssign(winC.mul(glass).mul(L.windowGlow * 1.2).mul(U.det.z.mul(0.85).add(0.15)));
        });
      }).ElseIf(type.lessThan(8.5), () => {
        // kratka (v = 0): biała ramka, ciemna wnęka, żebra w poprzek dłuższej osi; RADIATOR TN (v = 1): gruba rama,
        // głęboka wnęka, zaokrąglone listwy w poprzek dłuższej osi (przegroda w środku dużych); v = 2: krata (Colossus)
        const hb = B.xy.mul(iD);
        const sd = sdBox(lu, hb).toVar();
        If(sd.lessThan(0.8), () => {
          const inside = clamp(sd.negate().mul(2.0), 0.0, 1.0);
          If(B.w.lessThan(0.5), () => {
            const recess = clamp(sd.negate().sub(0.7).div(0.3), 0.0, 1.0);
            const along = select(hb.x.greaterThan(hb.y), lu.x, lu.y);
            const slat = smoothstep(0.18, 0.32, abs(fract(along.div(1.25)).sub(0.5)));
            modH.addAssign(inside.mul(0.3).sub(recess.mul(float(1.6).sub(slat.mul(0.9)))));
            modK.assign(max(modK, inside));
            modSeam.assign(max(modSeam, line(sd.add(0.7), 0.5).mul(0.7)));
            modCol.assign(mix(plateC.mul(1.03), vec3(0.028, 0.026, 0.024).add(metal.mul(slat.mul(0.6))), recess));
          }).Else(() => {
            const fw = clamp(min(hb.x, hb.y).mul(0.2), 0.7, 2.2).toVar();
            const ring = clamp(sd.negate().div(0.45), 0.0, 1.0).mul(clamp(sd.add(fw).div(0.35), 0.0, 1.0));
            const rec = clamp(sd.negate().sub(fw).div(0.35), 0.0, 1.0).toVar();
            const longY = hb.y.greaterThan(hb.x);
            const along = select(longY, lu.y, lu.x);
            const across = select(longY, lu.x, lu.y);
            const grid = step(1.5, B.w);
            const per = mix(float(1.55), float(1.9), grid);
            const t1 = abs(fract(along.div(per)).sub(0.5)).div(mix(float(0.34), float(0.2), grid));
            const bar = float(1.0).sub(smoothstep(0.75, 1.0, t1)).toVar();
            const barH = sqrt(max(float(0.0), float(1.0).sub(min(t1, 1.0).mul(min(t1, 1.0)))));
            const t2 = abs(fract(across.div(per)).sub(0.5)).div(0.2);
            const bar2 = float(1.0).sub(smoothstep(0.75, 1.0, t2)).mul(grid);
            const half = select(longY, hb.x, hb.y);
            const div = lineN(across, float(0.7)).mul(step(3.2, half)).mul(float(1.0).sub(grid));
            const solid = max(max(bar, bar2), div).toVar();
            modH.addAssign(ring.mul(0.9).add(rec.mul(float(-2.6).add(solid.mul(1.7)).add(barH.mul(bar).mul(0.3)))));
            modK.assign(max(modK, inside));
            modSeam.assign(max(modSeam, max(lineN(sd.add(fw), float(0.35)), lineN(sd, float(0.35))).mul(0.8)));
            const barC = metal.mul(float(1.15).add(barH.mul(0.75)));
            modCol.assign(mix(plateC.mul(1.02), mix(vec3(0.016, 0.014, 0.012), barC, solid), rec));
          });
        });
      }).ElseIf(type.lessThan(9.5), () => {
        // wrota hangaru (jak sprite'y TN): skrzydła we wnęce — każde z 5 wypukłymi pasami płyt, listwami bocznymi
        // (bursztynowe lampki, śruby), białymi rombami z krzyżem; między skrzydłami szczelina z mechanizmem, przy brzegu
        // +y zawiasy-trapezy na ramie
        const hb = B.xy.mul(iD);
        const sd = sdBox(lu, hb).toVar();
        If(sd.lessThan(1.0), () => {
          const inside = clamp(sd.negate().mul(2.0), 0.0, 1.0);
          const nd = max(B.w, 1.0);
          const lw = hb.x.mul(2.0).div(nd);
          const lx = lu.x.add(hb.x);
          const li = floor(lx.div(lw)).toVar();
          const fx = lx.sub(li.mul(lw)).sub(lw.mul(0.5)).toVar();               // od środka skrzydła [jd]
          const gapW = max(lw.mul(0.075), 0.9);
          const sHX = lw.mul(0.5).sub(gapW).toVar(), sHY = hb.y.sub(1.2).toVar();
          const sdS = sdBox(vec2(fx, lu.y), vec2(sHX, sHY)).toVar();
          const slab = clamp(sdS.negate().div(0.35), 0.0, 1.0).toVar();
          const railW = sHX.mul(0.23);
          const railIn = step(sHX.sub(railW), abs(fx)).toVar();
          const rail = railIn.mul(slab).toVar();
          const core = slab.mul(float(1.0).sub(railIn)).toVar();
          // 5 pasów (wzdłuż x), każdy wypukły; szwy między pasami
          const bh = sHY.mul(2.0).div(5.0);
          const by = lu.y.add(sHY);
          const bi = floor(by.div(bh)).toVar();
          const bfy = by.div(bh).sub(bi).toVar();
          const seamB = float(1.0).sub(smoothstep(0.03, 0.08, min(bfy, float(1.0).sub(bfy)))).mul(core).toVar();
          const bn = abs(bfy.sub(0.5)).mul(2.0);
          const convex = sqrt(max(float(0.0), float(1.0).sub(bn.mul(bn).mul(0.8))));
          // znaczniki: romb z krzyżem w pasach 1 i 3, mały romb w pasie 4
          const cyB = bi.add(0.5).mul(bh).sub(sHY);
          const am = abs(vec2(fx, lu.y.sub(cyB)));
          const ms = min(sHX.mul(0.17), bh.mul(0.28)).toVar();
          const dm = am.x.add(am.y);
          const isMark = step(abs(bi.sub(1.0)), 0.5).add(step(abs(bi.sub(3.0)), 0.5));
          const isSmall = step(abs(bi.sub(4.0)), 0.5);
          const diamond = lineN(dm.sub(ms), float(0.45));
          const cross = max(step(am.x, 0.24).mul(step(am.y, ms.mul(0.72))), step(am.y, 0.24).mul(step(am.x, ms.mul(0.72))));
          const markBig = max(diamond, cross).mul(isMark);
          const markSm = float(1.0).sub(smoothstep(ms.mul(0.22), ms.mul(0.4), dm)).mul(isSmall);
          const mark = max(markBig, markSm).mul(core).toVar();
          // listwy: lampki (3 na listwę) i śruby
          const rx = abs(fx).sub(sHX.sub(railW.mul(0.5)));
          const ly3 = clamp(floor(lu.y.div(sHY.mul(0.4)).add(0.5)), -2.0, 2.0);
          const lampD = length(vec2(rx, lu.y.sub(ly3.mul(sHY).mul(0.4))));
          const lamp = float(1.0).sub(smoothstep(min(railW.mul(0.3), 0.5), min(railW.mul(0.45), 0.75), lampD)).mul(rail).toVar();
          const boltD = length(vec2(rx, fract(lu.y.div(2.2)).sub(0.5).mul(2.2)));
          const bolt = float(1.0).sub(smoothstep(0.15, 0.28, boltD)).mul(rail).mul(float(1.0).sub(lamp));
          // zawiasy-trapezy przy brzegu +y, na styku skrzydeł
          const toB = lw.mul(0.5).sub(abs(fx));
          const tabY = lu.y.sub(hb.y.sub(1.6));
          const tab = step(toB, max(lw.mul(0.07), 1.2).sub(max(tabY, 0.0).mul(0.6))).mul(step(0.0, tabY)).mul(step(1.0, li.add(0.5)).add(0.0)).mul(inside);
          const recH = float(-3.0);
          const slabH = float(-1.6).add(core.mul(convex).mul(0.55)).add(rail.mul(0.95)).sub(seamB.mul(0.35)).add(mark.mul(0.06)).add(bolt.mul(0.12));
          modH.addAssign(inside.mul(mix(recH, slabH, slab)).add(tab.mul(3.6)));
          modK.assign(max(modK, inside));
          modSeam.assign(max(modSeam, max(seamB.mul(0.8), max(lineN(sdS, float(0.4)).mul(0.6), lineN(abs(fx).sub(sHX.sub(railW)), float(0.3)).mul(slab).mul(0.6)))));
          const slabC = doorC.mul(float(1.0).add(hash11(li.add(A.x)).sub(0.5).mul(0.08))).toVar();
          // pasy wypukłe: środek pasa jaśniej, przy szwach ciemniej (jak sprite'y — wyraźny poziomy rytm)
          const coreC = slabC.mul(float(0.74).add(convex.mul(0.34))).mul(float(1.0).sub(seamB.mul(0.55)));
          // listwy boczne skrzydła: jaśniejsza rama z rowkiem w środku (bursztynowe lampki na niej)
          const railGroove = lineN(rx, float(0.35)).mul(rail);
          const railC = slabC.mul(1.22).mul(float(1.0).sub(railGroove.mul(0.45)));
          // szczelina między skrzydłami: ciemny kanał z jaśniejszym tłokiem pośrodku (żebra co 1,3 jd)
          const gx = abs(fx).sub(lw.mul(0.5)).abs();
          const piston = step(gx, gapW.mul(0.32)).mul(step(1.0, li.add(0.5)));
          const recC = mix(vec3(0.02, 0.019, 0.018), metal.mul(float(0.75).add(step(0.5, fract(lu.y.div(1.3))).mul(0.35))), piston.mul(0.85));
          const col = mix(recC, mix(coreC, railC, rail), slab).toVar();
          col.assign(mix(col, vec3(0.8, 0.8, 0.77), mark.mul(0.9)));
          col.assign(mix(col, trimC.mul(0.45), bolt));
          col.assign(mix(col, vec3(0.9, 0.5, 0.09), lamp));
          col.assign(mix(col, plateC, tab));
          modCol.assign(col);
          emis.addAssign(vec3(1.0, 0.55, 0.12).mul(lamp).mul(1.2));
        });
      }).Else(() => {
        // pierścień (v = 0, gniazdo okrągłe): obręcz-torus, głęboka ciemna studnia, pierścień dna;
        // ILUMINATOR (v = 1): gruba obręcz ze śrubami, ciemna wypukła szyba z blikiem; v = 2 — iluminator w ośmiokątnej
        // ramie (Colossus): rama z płytą, iluminator o promieniu 0,62 R
        const oct = step(1.5, B.w).toVar();
        const R = B.z.mul(iD).mul(mix(float(1.0), float(0.62), oct)).toVar();
        const Ro = B.z.mul(iD);
        If(oct.greaterThan(0.5).and(rr.lessThan(Ro.mul(1.12).add(1.0))), () => {
          const outerO = sdOct(lu, Ro).toVar();
          const inO = sdOct(lu, Ro.mul(0.84));
          const frO = clamp(outerO.negate().div(0.6), 0.0, 1.0).mul(clamp(inO.div(0.45), 0.0, 1.0));
          const plO = clamp(inO.negate().div(0.4), 0.0, 1.0).mul(step(R.add(0.2), rr));
          modH.addAssign(frO.mul(1.2).add(plO.mul(0.4)).sub(lineN(inO.add(Ro.mul(0.06)), float(0.3)).mul(plO).mul(0.3)));
          modK.assign(max(modK, clamp(outerO.negate().mul(2.0), 0.0, 1.0)));
          modSeam.assign(max(modSeam, max(lineN(outerO, float(0.35)), lineN(inO, float(0.35))).mul(0.6)));
          modCol.assign(mix(plateC.mul(1.02), plateC.mul(0.96), plO));
        });
        If(rr.lessThan(R.add(1.2)), () => {
          const t = rr.sub(R.mul(0.8)).div(R.mul(0.2));
          const torus = sqrt(max(float(0.0), float(1.0).sub(t.mul(t))));
          const outerG = line(rr.sub(R), 0.6);
          If(B.w.lessThan(0.5), () => {
            const well = clamp(R.mul(0.62).sub(rr).div(0.6), 0.0, 1.0);
            const floorRing = lineN(rr.sub(R.mul(0.36)), float(0.5)).mul(well);
            modH.addAssign(torus.mul(1.6).sub(well.mul(4.5)).sub(outerG.mul(0.5)).add(floorRing.mul(0.6)));
            modK.assign(max(modK, step(rr, R.add(0.3))));
            modSeam.assign(max(modSeam, outerG.mul(0.8)));
            const ringC = plateC.mul(mix(float(0.92), float(1.04), torus));
            modCol.assign(mix(ringC, metal.mul(0.35).add(floorRing.mul(0.05)), well));
          }).Else(() => {
            const gR = R.mul(0.6);
            const glass = clamp(gR.sub(rr).div(0.4), 0.0, 1.0).toVar();
            const gn = clamp(rr.div(max(gR, 0.5)), 0.0, 1.0);
            const dome = sqrt(max(float(0.0), float(1.0).sub(gn.mul(gn))));
            const tor = torus.mul(step(gR, rr)).toVar();
            const a = atan(lu.y, lu.x);
            const nb = float(10.0);
            const ang = fract(a.div(6.28318).mul(nb));
            const mid = R.mul(0.8);
            const bolt = float(1.0).sub(smoothstep(0.2, 0.38, length(vec2(ang.sub(0.5).mul(6.28318).mul(mid).div(nb), rr.sub(mid))))).mul(step(2.5, R));
            const hl = float(1.0).sub(smoothstep(gR.mul(0.08), gR.mul(0.34), length(lu.add(gR.mul(0.3)))));
            modH.addAssign(tor.mul(1.5).add(glass.mul(dome.mul(0.6).sub(0.7))).sub(outerG.mul(0.4)).add(bolt.mul(0.15)));
            modK.assign(max(modK, step(rr, R.add(0.3))));
            modSeam.assign(max(modSeam, max(outerG, lineN(rr.sub(gR), float(0.35))).mul(0.8)));
            const ringC = mix(plateC, engC, 0.4).mul(float(0.8).add(tor.mul(0.3)));
            const glassC = mix(vec3(0.03, 0.045, 0.06), vec3(0.6, 0.64, 0.66), hl.mul(glass));
            modCol.assign(mix(mix(ringC, trimC.mul(0.5), bolt), glassC, glass));
          });
        });
      });
    });
    const freeK = float(1.0).sub(modK).toVar();
    // sieć rur (generowana + ręczne): wiązki i osprzęt — w maszynowni, ręczne także na płytach
    const net = this._pipeNet(p, iD);
    const netOn = U.pnet.x;

    // ── MASZYNOWNIA (rama bez pancerza): wiązki rur wzdłuż krawędzi pancerza, dalej sprzęt ──
    const mach = alpha.mul(float(1.0).sub(s1)).mul(freeK).toVar();
    const machH = float(0.0).toVar();
    const machC = metal.toVar();
    const machSeam = float(0.0).toVar();
    If(mach.greaterThan(0.001), () => {
      const n1 = nrm(vec2(ogx.y, ogy.y)).toVar();
      const PP = L.pipe;
      // przy sieci rur izolinie cieńsze, rzadsze i przerywane (wiązki prowadzi sieć)
      const pR = mix(float(PP.r), float(L.net.isoR), netOn);
      const spacing = pR.mul(2.0).add(PP.gap);
      const gapU = this._march(p, n1, (a) => a.y, oU.x, 1.4, 12, 'mgap');     // połowa szczeliny (oś środkowa) [jd]
      const room = du.x.negate();                                  // do sylwetki [jd]
      const u = oU.x.sub(PP.start).toVar();
      const k = floor(u.div(spacing)).toVar();
      const tl = u.sub(k.mul(spacing)).sub(pR);
      const ck = k.mul(spacing).add(pR).add(PP.start);
      const fit = floor(gapU.sub(PP.start + 0.4).div(spacing)).min(mix(float(PP.count), float(L.net.isoCount), netOn)).toVar();   // ile rur się mieści
      const skip = step(hash11(k.add(U.tex.w.mul(0.13)).add(floor(P.x.div(160.0)).mul(3.7))), mix(float(0.12), float(L.net.isoSkip), netOn));
      const inPipe = step(0.0, k).mul(step(k, fit.sub(1.0))).mul(step(abs(tl), pR)).mul(float(1.0).sub(skip))
        .mul(step(ck.add(pR).add(0.6), room)).toVar();
      const tN = clamp(tl.div(pR), -1.0, 1.0);
      const cyl = sqrt(max(float(0.0), float(1.0).sub(tN.mul(tN))));
      // obejmy co clampStep wzdłuż wiązki
      const tan1 = vec2(n1.y.negate(), n1.x);
      const sAlong = dot(P, tan1);
      const band = step(abs(fract(sAlong.div(PP.clampStep)).sub(0.5)), PP.clampW / PP.clampStep * 0.5).mul(step(0.0, k)).mul(step(k, fit.sub(1.0)))
        .mul(step(PP.start, oU.x)).mul(step(oU.x, fit.mul(spacing).add(PP.start)));
      const pipeZone = step(oU.x, fit.mul(spacing).add(PP.start + 0.2)).toVar();
      const pk = hash11(k.add(U.tex.w));
      const pcol = select(pk.lessThan(0.45), pipeC.mul(float(0.8).add(pk.mul(0.4))), select(pk.lessThan(0.8), engC.mul(0.95), metal.mul(1.8)));
      machH.assign(inPipe.mul(cyl).mul(pR.mul(0.95)).add(band.mul(0.4).mul(pipeZone)));
      // dno rowu: przy sieci cieplejszy brąz-szary (jak sprite'y TN)
      const rowC = mix(metal.mul(0.55), mix(metal.mul(0.9), this._pal(10).mul(0.5), 0.5), netOn.mul(L.net.rowWarm));
      machC.assign(mix(rowC, pcol.mul(float(0.7).add(cyl.mul(0.45))), inPipe));
      machC.assign(mix(machC, engC.mul(1.2), band.mul(pipeZone).mul(0.8)));
      // dalej od pancerza: sprzęt w komórkach (skrzynki, żebrowane walce, kraty)
      const G = float(L.machine);
      const cell = floor(P.div(G));
      const lc = P.sub(cell.add(0.5).mul(G)).toVar();
      const r1 = hash12(cell.add(seedV).add(3.3)), r2 = hash12(cell.add(seedV).mul(1.7).add(5.1)), r3 = hash12(cell.add(seedV).mul(2.3).add(8.9));
      const r4 = hash12(cell.add(seedV).mul(0.7).add(13.7));
      const away = float(1.0).sub(pipeZone).mul(step(1.2, room)).toVar();
      const boxH = vec2(r2.mul(3.2).add(2.4), r3.mul(3.0).add(2.2));
      const boxSd = sdBox(lc.sub(vec2(r4.sub(0.5).mul(G.sub(boxH.x.mul(2.0)).sub(1.0)), 0.0)), boxH);
      const isBox = step(r1, 0.24);
      const box = clamp(boxSd.negate().div(0.5), 0.0, 1.0).mul(isBox);
      const isCyl = step(0.24, r1).mul(step(r1, 0.46));
      const rc = r2.mul(1.6).add(2.4);
      const cy = clamp(lc.y.div(rc), -1.0, 1.0);
      const cylM = step(abs(lc.y), rc).mul(isCyl);
      const ribs = smoothstep(0.3, 0.45, abs(fract(P.x.div(1.8)).sub(0.5)));
      const cylH = sqrt(max(float(0.0), float(1.0).sub(cy.mul(cy)))).mul(rc).mul(0.8).sub(ribs.mul(0.3));
      const isTwin = step(0.46, r1).mul(step(r1, 0.56));
      const tw = vec2(abs(lc.x).sub(G.mul(0.24)), lc.y);
      const twin = clamp(sdBox(tw, vec2(2.4, 3.4)).negate().div(0.4), 0.0, 1.0).mul(isTwin);
      const grate = float(1.0).sub(isBox).sub(isCyl).sub(isTwin).max(0.0).mul(step(0.5, abs(fract(P.y.div(1.6)).sub(0.5)).add(0.3)));
      const gH = box.mul(r4.mul(1.8).add(1.4)).add(cylM.mul(cylH)).add(twin.mul(1.8)).sub(grate.mul(0.25));
      machH.addAssign(gH.mul(away));
      const gC = select(isBox.greaterThan(0.5), mix(engC.mul(0.85), engC.mul(1.25), r3), select(isCyl.greaterThan(0.5), mix(engC.mul(1.1), pipeC, r4.mul(0.5)).mul(float(1.0).sub(ribs.mul(0.35))), mix(metal, engC, 0.5)));
      machC.assign(mix(machC, gC, away.mul(max(box, max(cylM, twin)))));
      machSeam.assign(max(line(boxSd, 0.4).mul(isBox), ribs.mul(cylM).mul(0.3)).mul(away));
      // SIEĆ RUR nad maszynownią: wiązki, wspornik obejmy do bliskiej ściany płyty, osprzęt
      const bracket = net.band.mul(step(net.halfW, abs(net.t))).mul(step(oU.x, L.net.bracket))
        .mul(step(abs(net.t).sub(net.halfW), L.net.bracket)).mul(step(0.05, net.halfW));
      machH.assign(mix(machH, net.H, net.K));
      machC.assign(mix(machC, net.C, net.K));
      machH.assign(mix(machH, float(1.1), bracket));
      machC.assign(mix(machC, engC.mul(1.1), bracket));
      machH.assign(mix(machH, net.fH, net.fK));
      machC.assign(mix(machC, net.fC, net.fK));
      machSeam.assign(max(machSeam, lineN(abs(net.t).sub(net.halfW), float(0.45)).mul(net.K).mul(0.5)));
    });

    // ── PANCERZ: panele, linia przy krawędzi, nity, sprzęt na panelach ──
    const PN = L.panel;
    const q = vec2(P.x, abs(P.y)).toVar();
    const seedL = U.tex.w.mul(0.731).add(upperK.mul(13.7)).add(s3.mul(5.1)).toVar();
    const colS = mix(float(PN.col), float(PN.colUpper), upperK), rowS = mix(float(PN.row), float(PN.rowUpper), upperK);
    const C = part1(q.x, colS, PN.jitter, seedL);
    const R = part1(q.y, rowS, PN.jitter, seedL.add(C.k.mul(3.17)));
    const pw = C.hi.sub(C.lo).toVar(), ph = R.hi.sub(R.lo).toVar();
    const lx = q.x.sub(C.lo).toVar(), ly = q.y.sub(R.lo).toVar();
    const pid = vec2(C.k, R.k.add(upperK.mul(41.0)).add(s3.mul(17.0))).toVar();
    const ph1 = hash12(pid.add(seedV)).toVar(), ph2 = hash12(pid.add(seedV).add(7.7)).toVar(), ph3 = hash12(pid.add(seedV).add(19.1)).toVar();
    // podział panelu na pół (dłuższa oś) w części paneli
    const split = step(0.62, ph2);
    const splitPos = float(0.5).add(ph3.sub(0.5).mul(0.3));
    const splitD = select(pw.greaterThan(ph), lx.sub(pw.mul(splitPos)), ly.sub(ph.mul(splitPos)));
    const edgeIn = min(min(min(lx, pw.sub(lx)), min(ly, ph.sub(ly))), select(split.greaterThan(0.5), abs(splitD), float(1e4))).toVar();
    const panVis = U.grv.x;
    const seamPanel = float(1.0).sub(smoothstep(PN.seam * 0.35, PN.seam * 0.75, edgeIn)).mul(panVis).toVar();
    // ROWKI projektu (linie podziału płyt): rowek jak szew, a płyta między rowkami ma własną fazę
    const gs = this.T.grooves.sample(this._fuv(p)).level(0);
    const gd = gs.x.mul(iD).toVar();     // [jd]
    const gw = gs.y;
    const grooveLine = float(1.0).sub(smoothstep(gw.mul(0.3), gw.mul(0.62), gd)).toVar();
    const gEdge = max(gd.sub(gw.mul(0.45)), float(0.0));
    // „poduszka”: brzeg panelu (losowego — wg widoczności — i płyty przy rowku) zaokrąglony w dół do szwu
    const pEdge = min(mix(float(1e3), edgeIn.sub(PN.seam * 0.4), panVis), gEdge);
    const pb = clamp(pEdge.div(PN.bevel), 0.0, 1.0);
    const pillow = sqrt(max(float(0.0), float(1.0).sub(float(1.0).sub(pb).mul(float(1.0).sub(pb)))));
    const raisedP = step(0.72, ph1);
    const panelRelief = pillow.mul(float(PN.pillow).add(raisedP.mul(PN.raised).mul(panVis))).toVar();
    // poduszka (sprite'y TN są „napompowane”): od krawędzi płyty (za fazą) i od szwu panelu wierzch wznosi się łukiem —
    // najstromiej przy krawędzi; z malowanym światłem (ALB) i światłem gry daje szeroki gradient przy brzegach
    const cushEdge = min(topD.negate().sub(bevS.mul(L.bevel[1]).add(L.wall)), pEdge);
    // linia przy krawędzi płyty (gdy płyta dość głęboka) i nity
    const depth = this._march(p, topG.negate(), (a) => select(topComp.equal(int(3)), a.w, select(topComp.equal(int(2)), a.z, a.y)).negate(),
      topD.negate(), 2.2, 9, 'mdep');
    const deep = smoothstep(13.0, 16.0, depth).toVar();
    const cushT = clamp(cushEdge.div(clamp(depth.mul(0.42), 2.0, PN.cushW)), 0.0, 1.0);
    const cushion = float(1.0).sub(float(1.0).sub(cushT).mul(float(1.0).sub(cushT))).mul(PN.cushH).toVar();
    const insetLine = lineN(topD.add(PN.inset), float(PN.insetW)).mul(deep);
    // gruba płyta: wnętrze szerokiej płyty o stopień wyżej (faza na linii przy krawędzi) — jak sprite'y TN
    const slabT = clamp(topD.negate().sub(PN.inset).div(PN.slabBevel), 0.0, 1.0);
    const slab = sqrt(max(float(0.0), float(1.0).sub(float(1.0).sub(slabT).mul(float(1.0).sub(slabT))))).mul(smoothstep(16.0, 20.0, depth)).toVar();
    const tanT = vec2(topG.y.negate(), topG.x);
    const sT = dot(P, tanT);
    const rivOn = U.det.w.mul(smoothstep(5.5, 7.0, depth));
    const rivD = length(vec2(fract(sT.div(PN.rivetStep)).sub(0.5).mul(PN.rivetStep), topD.add(PN.rivetLine)));
    const rivet = float(1.0).sub(smoothstep(PN.rivetR * 0.6, PN.rivetR, rivD)).mul(rivOn).toVar();
    // nity wzdłuż szwów paneli (część paneli)
    const sRiv = step(0.55, ph1).mul(U.det.w);
    const seamAlong = select(min(lx, pw.sub(lx)).lessThan(min(ly, ph.sub(ly))), ly, lx);
    const seamAcross = min(min(lx, pw.sub(lx)), min(ly, ph.sub(ly)));
    const rivD2 = length(vec2(fract(seamAlong.div(PN.rivetStep)).sub(0.5).mul(PN.rivetStep), seamAcross.sub(2.6)));
    const rivet2 = float(1.0).sub(smoothstep(PN.rivetR * 0.5, PN.rivetR * 0.9, rivD2)).mul(sRiv);
    rivet.assign(max(rivet, rivet2.mul(smoothstep(4.0, 6.0, topD.negate()))));
    // sprzęt na panelu: jeden element na panel, gdy panel leży cały na płycie
    const pc = vec2(C.lo.add(C.hi).mul(0.5), R.lo.add(R.hi).mul(0.5).mul(select(P.y.lessThan(0.0), float(-1.0), float(1.0))));
    const fc = this._auxAt(pc.mul(D)).mul(iD);
    const fcTop = select(topComp.equal(int(3)), fc.w, select(topComp.equal(int(2)), fc.z, fc.y));
    const roomP = fcTop.negate().sub(max(pw, ph).mul(0.5)).toVar();          // > 0: panel w całości na płycie
    const pl = vec2(lx.sub(pw.mul(0.5)), ly.sub(ph.mul(0.5))).toVar();      // od środka panelu [jd]
    const DC = L.detail;
    const pick = hash12(pid.add(seedV).add(31.3)).toVar();
    const okP = step(0.5, roomP).mul(flatTop).toVar();
    const detH = float(0.0).toVar();
    const detC = float(1.0).toVar();       // mnożnik barwy płyty (1 — bez zmian)
    const detDark = float(0.0).toVar();    // udział barwy ciemnej wnęki
    const detSeam = float(0.0).toVar();
    // kratka
    If(pick.lessThan(DC.vent), () => {
      const hb = vec2(min(pw.mul(0.5).sub(2.6), ph1.mul(5.0).add(3.0)), min(ph.mul(0.5).sub(2.4), ph2.mul(1.4).add(1.5)));
      const off = vec2(ph3.sub(0.5).mul(max(pw.sub(hb.x.mul(2.0)).sub(5.0), 0.0)), 0.0);
      const vq = pl.sub(off);
      const sd = sdBox(vq, hb);
      const inV = clamp(sd.negate().mul(2.0), 0.0, 1.0).mul(step(1.0, hb.x)).mul(step(0.8, hb.y));
      const slat = smoothstep(0.18, 0.32, abs(fract(vq.x.div(1.15)).sub(0.5)));
      detH.assign(inV.mul(float(-1.3).add(slat.mul(0.8))));
      detDark.assign(inV.mul(float(0.92).sub(slat.mul(0.35))));
      detSeam.assign(line(sd, 0.5).mul(step(1.0, hb.x)));
    }).ElseIf(pick.lessThan(DC.vent + DC.hatch), () => {
      // luk serwisowy: rowek obrysu i uchwyt
      const hb = vec2(min(pw.mul(0.5).sub(2.0), ph1.mul(4.0).add(3.0)), min(ph.mul(0.5).sub(2.0), ph2.mul(2.0).add(2.2)));
      const sd = sdRoundBox(pl, hb, float(0.6));
      const handle = step(abs(pl.x), 1.0).mul(step(abs(pl.y.sub(hb.y.mul(0.55))), 0.25));
      detH.assign(lineN(sd, float(0.45)).mul(-0.35).sub(handle.mul(0.3)));
      detSeam.assign(max(lineN(sd, float(0.45)), handle).mul(step(1.5, hb.x)));
    }).ElseIf(pick.lessThan(DC.vent + DC.hatch + DC.box), () => {
      // skrzynka na płycie
      const hb = vec2(ph1.mul(2.4).add(1.4), ph2.mul(1.6).add(1.2)).min(vec2(pw.mul(0.5).sub(1.5), ph.mul(0.5).sub(1.5)));
      const off = vec2(ph3.sub(0.5), ph1.sub(0.5)).mul(vec2(pw, ph).mul(0.5).sub(hb).sub(1.5).max(vec2(0.0)));
      const sd = sdBox(pl.sub(off), hb);
      const up = clamp(sd.negate().div(0.5), 0.0, 1.0);
      detH.assign(up.mul(1.1));
      detC.assign(mix(float(1.0), float(0.9).add(ph3.mul(0.12)), up));
      detSeam.assign(line(sd, 0.4).mul(0.6));
    }).ElseIf(pick.lessThan(DC.vent + DC.hatch + DC.box + DC.sub), () => {
      // płyta na płycie: wewnętrzny panel podniesiony
      const hb = vec2(pw, ph).mul(0.5).sub(1.7);
      const sd = sdBox(pl, hb);
      const up = clamp(sd.negate().div(0.45), 0.0, 1.0);
      detH.assign(up.mul(0.55));
      detC.assign(mix(float(1.0), float(1.025), up));
      detSeam.assign(line(sd, 0.45).mul(0.75));
    }).ElseIf(pick.lessThan(DC.vent + DC.hatch + DC.box + DC.sub + DC.slit), () => {
      // szczeliny
      const sx = fract(pl.x.div(2.2).add(0.5)).sub(0.5).mul(2.2);
      const slit = step(abs(sx), 0.35).mul(step(abs(pl.y), min(ph.mul(0.3), 2.2))).mul(step(abs(pl.x), min(pw.mul(0.3), 4.5)));
      detH.assign(slit.mul(-0.6));
      detDark.assign(slit.mul(0.8));
    });
    const panelK = okP.mul(freeK).toVar();
    // ton panelu: rozrzut i rzadkie ciemniejsze / jaśniejsze
    const tone = float(1.0).add(ph1.sub(0.5).mul(0.06)).mul(select(ph2.lessThan(0.08), float(0.9), select(ph2.greaterThan(0.95), float(1.04), float(1.0))));
    const seamTop = seamPanel.mul(smoothstep(1.6, 3.2, topD.negate())).mul(s1).mul(freeK);
    const grooveOn = grooveLine.mul(s1).mul(freeK).mul(smoothstep(0.6, 1.6, topD.negate())).toVar();
    const seam = max(max(max(seamTop.mul(0.62), grooveOn), insetLine.mul(s1).mul(freeK).mul(0.95)), max(detSeam.mul(panelK), modSeam)).toVar();
    seam.assign(max(seam, machSeam.mul(mach).mul(0.6)));

    // ── wysokość ──
    const panelOn = s1.mul(freeK).mul(smoothstep(1.2, 2.6, topD.negate()));
    const hTot = mix(hU, p0.mul(H[0]), engK).add(machH.mul(mach)).add(detH.mul(panelK).mul(s1)).add(panelRelief.add(cushion).mul(panelOn)).add(slab.mul(PN.slab).mul(s1).mul(freeK)).sub(seamTop.mul(0.25)).sub(grooveOn.mul(0.6))
      .sub(insetLine.mul(s1).mul(freeK).mul(0.45)).add(rivet.mul(s1).mul(freeK).mul(0.4)).add(modH.mul(alpha)).toVar();
    // rury ręczne „na płytach”: wiązka i osprzęt leżą na płycie
    const onPl = net.over.mul(net.K).mul(s1).mul(freeK).toVar();
    const onPlF = net.fOver.mul(net.fK).mul(s1).mul(freeK).toVar();
    hTot.addAssign(max(onPl.mul(net.H.add(0.2)), onPlF.mul(net.fH.add(0.2))));
    // okna tarasów (rząd świateł za krawędzią nadbudówki) — tylko gdy projekt ma okna
    const WG = float(4.2);
    const wc = floor(P.div(WG));
    const wctr = wc.add(0.5).mul(WG);
    const fw = this._fieldAt(wctr.mul(D)).mul(iD);
    const wOn = step(abs(fw.y.add(2.6)), 1.05).mul(step(2.5, fw.z)).mul(step(0.5, U.det.z));
    const wMask = wOn.mul(float(1.0).sub(smoothstep(0.55, 0.85, length(P.sub(wctr))))).mul(freeK).toVar();

    const out = { h: hTot.mul(D), alpha, seam, dome: ax.x.mul(U.dome.x), d0, d1, d2, d3, s1, s2, s3 };
    if (want.emis) {
      emis.addAssign(winC.mul(wMask).mul(L.windowGlow).mul(U.det.z));
      out.emis = emis.mul(alpha);
    }
    if (want.base) {
      const col = plateC.mul(tone).toVar();
      col.assign(col.mul(mix(float(1.0), detC, panelK)));
      col.assign(mix(col, vec3(0.03, 0.028, 0.025), detDark.mul(panelK)));
      // faza i ściana płyty: goła blacha nieco ciemniej
      const slope = float(1.0).sub(flatTop).mul(s1);
      col.assign(mix(col, col.mul(0.86), slope.mul(0.5)));
      // nity — ciemne punkty
      col.assign(mix(col, trimC.mul(0.55), rivet.mul(s1).mul(freeK).mul(0.85)));
      // maszynownia pod spodem
      col.assign(mix(col, machC, mach));
      col.assign(mix(col, net.C, onPl));
      col.assign(mix(col, net.fC, onPlF));
      this._decals(p, col, out);
      col.assign(mix(col, modCol, modK));
      col.assign(mix(col, vec3(0.04, 0.05, 0.06), wMask));
      out.base = col;
    }
    return out;
  }

  /** Naklejki: pasy (odcinek), pasy wzdłuż konturu poziomu, emblematy i napisy z atlasu. Kolor `col` (var). */
  _decals(p, col, pt) {
    const U = this.U;
    const aa = float(0.5).div(U.tex.z);
    Loop({ start: 0, end: HD_COMPOSER_LIMITS.decals, type: 'int', condition: '<', name: 'di' }, ({ di }) => {
      If(di.greaterThanEqual(U.decalCount), () => { Break(); });
      const A = U.decals.element(di.mul(4)).toVar();
      const B = U.decals.element(di.mul(4).add(1)).toVar();
      const C = U.decals.element(di.mul(4).add(2)).toVar();
      const D = U.decals.element(di.mul(4).add(3)).toVar();
      const m = float(0.0).toVar();
      If(A.x.lessThan(1.5), () => {
        const d = segDist(p, A.yz, B.xy);
        m.assign(float(1.0).sub(smoothstep(B.z.mul(0.5).sub(aa), B.z.mul(0.5).add(aa), d)));
      }).ElseIf(A.x.lessThan(2.5), () => {
        const dl = select(B.x.lessThan(0.5), pt.d0, select(B.x.lessThan(1.5), pt.d1, select(B.x.lessThan(2.5), pt.d2, pt.d3)));
        const band = float(1.0).sub(smoothstep(B.z.mul(0.5).sub(aa), B.z.mul(0.5).add(aa), abs(dl.add(B.y))));
        const xr = step(C.x, p.x).mul(step(p.x, C.y));
        const side = select(C.z.lessThan(0.5), float(1.0), select(C.z.lessThan(1.5), step(p.y, 0.0), step(0.0, p.y)));
        m.assign(band.mul(xr).mul(side));
      }).Else(() => {
        const lq = rot2(p.sub(A.yz), A.w).div(B.xy);
        const qy = select(B.z.greaterThan(0.5), lq.y.negate(), lq.y);
        const inside = step(abs(lq.x), 1.0).mul(step(abs(qy), 1.0));
        const auv = vec2(mix(C.x, C.z, lq.x.mul(0.5).add(0.5)), mix(C.y, C.w, qy.mul(0.5).add(0.5)));
        m.assign(this.T.atlas.sample(auv).level(0).w.mul(inside));
      });
      col.assign(mix(col, D.xyz, m.mul(B.w).mul(pt.alpha)));
    });
  }

  _pix() {
    return uv().mul(this.U.tex.xy);
  }

  _worldOf(pxy) {
    return this.U.img.xy.add(pxy.div(this.U.tex.z));
  }

  _load(base, ip) {
    const U = this.U;
    const c = ivec2(clamp(ip.x, int(0), int(U.tex.x).sub(1)), clamp(ip.y, int(0), int(U.tex.y).sub(1)));
    return textureLoad(base, c);
  }

  _build() {
    const U = this.U, L = this.look, T = this.T;
    const geoNode = Fn(() => {
      const p = this._worldOf(this._pix());
      const pt = this._point(p, {});
      return vec4(pt.h, pt.alpha, pt.seam, pt.dome);
    })();
    const baseNode = Fn(() => {
      const p = this._worldOf(this._pix());
      const pt = this._point(p, { base: true });
      return vec4(pt.base, 1.0);
    })();
    const emisNode = Fn(() => {
      const p = this._worldOf(this._pix());
      const pt = this._point(p, { emis: true });
      return vec4(pt.emis, 1.0);
    })();
    // SURF: normalne (Sobel na reliefie + kopule), AO (próbki reliefu wokół), relief
    const surfNode = Fn(() => {
      const ip = ivec2(floor(this._pix()));
      const g = this._load(T.geo, ip).toVar();
      const Hn = (dx, dy) => { const s = this._load(T.geo, ip.add(ivec2(dx, dy))); return s.x.add(s.w); };
      const h0 = g.x.toVar();
      const tpu = U.tex.z;
      const gx = Hn(1, -1).add(Hn(1, 0).mul(2.0)).add(Hn(1, 1)).sub(Hn(-1, -1)).sub(Hn(-1, 0).mul(2.0)).sub(Hn(-1, 1)).div(8.0).mul(tpu);
      const gy = Hn(-1, 1).add(Hn(0, 1).mul(2.0)).add(Hn(1, 1)).sub(Hn(-1, -1)).sub(Hn(0, -1).mul(2.0)).sub(Hn(1, -1)).div(8.0).mul(tpu);
      const n = normalize(vec3(gx.negate(), gy, 1.0));
      const occ = float(0.0).toVar();
      const dirs = 8;
      const px = U.det.x.mul(tpu);                                   // teksele na jd
      for (const [rad, wgt] of L.ao) {
        for (let k = 0; k < dirs; k++) {
          const a = (k + (rad > 3 ? 0.5 : 0)) / dirs * Math.PI * 2;
          const o = ivec2(floor(vec2(Math.cos(a) * rad, Math.sin(a) * rad).mul(px).add(0.5)));
          const hs = this._load(T.geo, ip.add(o)).x;
          occ.addAssign(clamp(hs.sub(h0).div(U.det.x).sub(0.15).div(rad).mul(1.6), 0.0, 1.0).mul(wgt));
        }
      }
      const ao = clamp(float(1.0).sub(occ.div(dirs * 2.4).mul(1.7)), 0.3, 1.0);
      const relief = clamp(float(0.5).add(h0.mul(tpu).sub(12.0).div(24.0)), 0.0, 1.0);
      const inside = step(0.004, g.y);
      return mix(vec4(0.5, 0.5, 1.0, 0.0), vec4(n.x.mul(0.5).add(0.5), n.y.mul(0.5).add(0.5), ao, relief), inside);
    })();
    // ALB: albedo końcowe (szwy, brud z AO, rdza przy krawędziach płyt, piegi, otarcia faz), sRGB + alfa
    const albNode = Fn(() => {
      const pxy = this._pix();
      const ip = ivec2(floor(pxy));
      const p = this._worldOf(pxy);
      const P = p.mul(U.det.y);
      const g = this._load(T.geo, ip).toVar();
      const s = this._load(T.surf, ip).toVar();
      const col = this._load(T.base, ip).xyz.toVar();
      const bright = smoothstep(0.08, 0.3, lum(col)).toVar();       // płyty (nie maszynownia)
      col.mulAssign(float(1.0).sub(g.z.mul(L.seamDark).mul(mix(float(0.5), float(1.0), bright))));
      const ao = s.z;
      const grimeK = U.style.z.mul(L.grime);
      const blotch = smoothstep(0.42, 0.9, vnoise(P.mul(0.035).add(U.tex.w.mul(0.13))).mul(0.6).add(vnoise(P.mul(0.11)).mul(0.4)));
      const streak = vnoise(P.mul(vec2(0.05, 0.9)).add(U.tex.w)).mul(0.5).add(0.5);
      const grimeC = this._pal(10);
      const cav = float(1.0).sub(ao).toVar();
      // rdza / brud przy krawędziach płyt (stopa ściany, wnęki)
      const f = this._fieldAt(p).mul(U.det.y);
      const edge = float(1.0).sub(smoothstep(0.6, 4.5, f.y.negate())).mul(step(f.y, 0.0));   // stałe krawędzie rosnąco (pułapka 6)
      const dirt = clamp(cav.mul(1.6).add(blotch.mul(0.3)).add(edge.mul(0.35).mul(streak)), 0.0, 1.0).mul(grimeK).toVar();
      col.assign(mix(col, col.mul(grimeC).mul(1.6), dirt.mul(bright).mul(0.55)));
      col.mulAssign(mix(float(1.0), ao, 0.45));
      // malowane światło (HD_LOOK.paint): normalna z samego reliefu (Sobel jak w SURF, bez kopuły)
      const PT = L.paint;
      const Hr = (dx, dy) => this._load(T.geo, ip.add(ivec2(dx, dy))).x;
      const tpuA = U.tex.z;
      const rgx = Hr(1, -1).add(Hr(1, 0).mul(2.0)).add(Hr(1, 1)).sub(Hr(-1, -1)).sub(Hr(-1, 0).mul(2.0)).sub(Hr(-1, 1)).div(8.0).mul(tpuA);
      const rgy = Hr(-1, 1).add(Hr(0, 1).mul(2.0)).add(Hr(1, 1)).sub(Hr(-1, -1)).sub(Hr(0, -1).mul(2.0)).sub(Hr(1, -1)).div(8.0).mul(tpuA);
      const nR = normalize(vec3(rgx.negate(), rgy, 1.0));
      const litP = dot(nR.xy, vec2(PT.dir[0], PT.dir[1])).toVar();
      col.mulAssign(float(1.0).add(clamp(litP.mul(PT.k), -PT.dark, PT.bright)));
      col.assign(mix(col, col.mul(vec3(...PT.coolTint)), clamp(litP.negate().mul(PT.cool), 0.0, 1.0)));
      // piegi: drobne ciemne kropki brudu na płytach
      const sc = floor(P.mul(1.25));
      const sp = step(hash12(sc.add(U.tex.w.mul(0.17))), float(L.speck).mul(grimeK));
      const spD = length(fract(P.mul(1.25)).sub(0.5));
      col.mulAssign(float(1.0).sub(sp.mul(float(1.0).sub(smoothstep(0.18, 0.42, spD))).mul(0.4).mul(bright)));
      // wgniotki / zadrapania (HD_LOOK.dent): komórka cell jd, plamka w losowym miejscu komórki, brzeg z szumu
      const DT = L.dent;
      const dq = P.div(DT.cell);
      const dc = floor(dq);
      const dhash = hash12(dc.add(U.tex.w.mul(0.37)).add(5.3));
      const dOff = vec2(hash12(dc.add(1.7)), hash12(dc.add(8.9))).mul(0.7).add(0.15);
      const dR = mix(float(DT.rMin), float(DT.rMax), hash12(dc.add(3.3))).div(DT.cell);
      const dv = fract(dq).sub(dOff).toVar();
      const dWob = vnoise(P.mul(1.7).add(dc.mul(13.1))).sub(0.5).mul(0.55);
      const dd = length(dv).div(dR).add(dWob);
      const nearSD = clamp(g.z.mul(1.6).add(edge.mul(0.8)), 0.0, 1.0);
      const dOn = step(dhash, mix(float(DT.p), float(DT.pEdge), nearSD)).mul(bright).mul(grimeK).toVar();
      const dCore = float(1.0).sub(smoothstep(0.55, 1.0, dd)).mul(dOn);
      // jasny brzeg od światła (lewa-góra obrazu = −x, −y świata): ta sama plamka przesunięta
      const dd2 = length(dv.add(dR.mul(0.45))).div(dR).add(dWob);
      const dLip = float(1.0).sub(smoothstep(0.7, 1.15, dd2)).mul(float(1.0).sub(dCore)).mul(dOn);
      col.mulAssign(float(1.0).sub(dCore.mul(DT.dark)).add(dLip.mul(0.12)));
      // rdza: drobne rdzawe kropki, gęściej przy szwach i krawędziach płyt; większe plamy z szumu
      const rcI = floor(P.mul(0.85));
      const rh = hash12(rcI.add(U.tex.w.mul(0.29)).add(3.7));
      const nearS = clamp(g.z.mul(1.6).add(edge.mul(0.8)), 0.0, 1.0);
      const rp = mix(float(0.03), float(0.16), nearS).mul(grimeK).mul(L.rust);
      const rOff = vec2(hash12(rcI.add(9.1)), hash12(rcI.add(4.4))).mul(0.5).add(0.25);
      const rd = length(fract(P.mul(0.85)).sub(rOff));
      const rSz = hash12(rcI.add(2.2)).mul(0.14).add(0.1);
      const rspot = step(rh, rp).mul(float(1.0).sub(smoothstep(rSz, rSz.add(0.12), rd))).mul(bright);
      const rblot = smoothstep(0.62, 0.82, vnoise(P.mul(0.09).add(U.tex.w.mul(0.41)))).mul(nearS).mul(0.35).mul(bright).mul(grimeK).mul(L.rust);
      col.assign(mix(col, vec3(...L.rustColor).mul(float(0.8).add(rh.mul(0.5))), clamp(rspot.mul(0.75).add(rblot), 0.0, 0.85)));
      // otarcia faz (ciemna blacha)
      const nxy = s.xy.mul(2.0).sub(1.0);
      const nz = sqrt(max(float(0.0), float(1.0).sub(dot(nxy, nxy))));
      const slope = float(1.0).sub(nz);
      const chip = smoothstep(0.62, 0.8, vnoise(P.mul(0.9).add(13.0))).mul(smoothstep(0.08, 0.35, slope)).mul(U.style.w).mul(bright);
      col.assign(mix(col, this._pal(4).mul(1.6), chip.mul(L.wear)));
      // emisja jako niebieska poświata w albedo (gra: hullGlowMask) — tylko chłodna (okna, wentyle)
      const e = this._load(T.emis, ip).xyz;
      const cool = clamp(e.z.sub(e.x.mul(0.5)).mul(0.8), 0.0, 1.0);
      col.assign(mix(col, vec3(...L.glowCyan), cool.mul(U.style.y)));
      return vec4(srgbEncode(clamp(col, vec3(0.0), vec3(1.0))), g.y);
    })();
    const eoutNode = Fn(() => {
      const ip = ivec2(floor(this._pix()));
      const e = this._load(T.emis, ip).xyz;
      return vec4(srgbEncode(clamp(e.div(3.0), vec3(0.0), vec3(1.0))), 1.0);
    })();
    this.passes = [
      { name: 'geo', type: THREE.HalfFloatType, quad: new THREE.QuadMesh(makeMaterial('HullDesign:geo', geoNode)) },
      { name: 'base', type: THREE.HalfFloatType, quad: new THREE.QuadMesh(makeMaterial('HullDesign:base', baseNode)) },
      { name: 'emis', type: THREE.HalfFloatType, quad: new THREE.QuadMesh(makeMaterial('HullDesign:emis', emisNode)) },
      { name: 'surf', type: THREE.UnsignedByteType, quad: new THREE.QuadMesh(makeMaterial('HullDesign:surf', surfNode)) },
      { name: 'alb', type: THREE.UnsignedByteType, quad: new THREE.QuadMesh(makeMaterial('HullDesign:alb', albNode)) },
      { name: 'eout', type: THREE.UnsignedByteType, quad: new THREE.QuadMesh(makeMaterial('HullDesign:eout', eoutNode)) }
    ];
  }

  _ensureTargets(w, h) {
    if (this.targets && this.targets.w === w && this.targets.h === h) return;
    if (this.targets) for (const p of this.passes) this.targets[p.name].dispose();
    const t = { w, h };
    for (const p of this.passes) t[p.name] = makeTarget(w, h, p.type);
    this.targets = t;
    this.T.geo.value = t.geo.texture;
    this.T.base.value = t.base.texture;
    this.T.emis.value = t.emis.texture;
    this.T.surf.value = t.surf.texture;
  }

  /** Rozgrzewka: pipeline'y passów na celach tych samych formatów (compileAsync w tle). */
  async prewarm() {
    this._ensureTargets(64, 32);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const jobs = [];
    try {
      for (const p of this.passes) {
        r.setRenderTarget(this.targets[p.name]);
        jobs.push(compileAsyncNaCelu(r, p.quad, p.quad.camera));
      }
    } finally {
      r.setRenderTarget(prev);
    }
    await Promise.all(jobs);
  }

  /**
   * Projekt do uniformów: pole (buildHullField), atlas naklejek ({ data, width, height, rects: Map decal → uv }),
   * opcje { texPerUnit (0 — z rozmiaru), glowToAlbedo, grime, wear }.
   */
  setDesign(field, atlas, opts = {}) {
    const U = this.U, L = this.look;
    const { design, modules, decals } = field.expanded;
    const im = field.image;
    const tpu = hullComposerTexPerUnit(im.w, im.h, Number(opts.texPerUnit) || 0);
    const W = Math.max(8, Math.round(im.w * tpu)), H = Math.max(8, Math.round(im.h * tpu));
    this.size = { w: W, h: H, tpu: W / im.w };
    U.img.value.set(im.minX, im.minY, im.w, im.h);
    U.tex.value.set(W, H, W / im.w, design.seed % 1000);
    // pole: RGBA16F (d0, d1, d2, d3), kopuła: RGBA16F (rozmyta sylwetka 0..1)
    const g = field.grid;
    const n = g.w * g.h;
    const half = new Uint16Array(n * 4);
    const aux = new Uint16Array(n * 4);
    const toHalf = THREE.DataUtils.toHalfFloat;
    const oct = field.oct || [null, field.levels[1], field.levels[2], field.levels[3]];
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 4; c++) half[i * 4 + c] = toHalf(field.levels[c][i]);
      aux[i * 4] = toHalf(field.dome[i]);
      for (let c = 1; c < 4; c++) aux[i * 4 + c] = toHalf(oct[c][i]);
    }
    const gr = new Uint16Array(n * 4);
    const gf = field.groove;
    const gcap = toHalf(field.grooveBand || 1e3);
    const g14 = toHalf(1.4);
    for (let i = 0; i < n; i++) { gr[i * 4] = gf ? toHalf(gf[i]) : gcap; gr[i * 4 + 1] = gf?.width ? toHalf(gf.width[i]) : g14; }
    this._fieldTex?.dispose();
    this._auxTex?.dispose();
    this._grooveTex?.dispose();
    this._fieldTex = halfTexture(half, g.w, g.h);
    this._auxTex = halfTexture(aux, g.w, g.h);
    this._grooveTex = halfTexture(gr, g.w, g.h);
    this.T.field.value = this._fieldTex;
    this.T.aux.value = this._auxTex;
    this.T.grooves.value = this._grooveTex;
    this._setPipes(field, n, toHalf);
    U.field.value.set(g.x0, g.y0, g.res, field.band);
    U.fieldSize.value.set(g.w, g.h);
    U.det.value.set(design.detail, 1 / design.detail, design.windows ?? 1, opts.rivets ?? 1);
    U.dome.value.set(Math.tan(L.domeTiltDeg * Math.PI / 180) * field.domeSigma / EDGE_GAIN, 0, 0, 0);
    U.style.value.set(design.round ?? (design.style === 'rounded' ? 1 : 0), opts.glowToAlbedo === false ? 0 : 1, opts.grime ?? 1, opts.wear ?? 1);
    U.bev.value = design.bevel ?? 1;
    U.grv.value.set(design.panels ?? 1, 0, 0, 0);
    // paleta (liniowo)
    const pal = hullDesignPalette(design);
    HD_PALETTE_ROWS.forEach((k, i) => {
      const c = k === 'window' ? srgbToLinear(pal[k]) : glowSafeLinear(srgbToLinear(pal[k]));
      U.pal.array[i].set(c[0], c[1], c[2], 1);
    });
    // moduły
    let mi = 0;
    for (const m of modules) {
      if (mi >= HD_COMPOSER_LIMITS.modules) break;
      const A = U.mods.array[mi * 2], B = U.mods.array[mi * 2 + 1];
      A.set(m.x, m.y, TYPE_CODE[m.type], m.rot || 0);
      const extra = m.type === 'hangar' ? (m.doors || 1) : (m.v || 0);
      B.set(m.w || 0, m.h || 0, m.r || 0, extra);
      mi++;
    }
    U.modCount.value = mi;
    // naklejki
    let di = 0;
    for (const d of decals) {
      if (di >= HD_COMPOSER_LIMITS.decals) break;
      const A = U.decals.array[di * 4], B = U.decals.array[di * 4 + 1], C = U.decals.array[di * 4 + 2], D = U.decals.array[di * 4 + 3];
      const c = glowSafeLinear(srgbToLinear(d.color));
      D.set(c[0], c[1], c[2], 1);
      if (d.kind === 'stripe') {
        A.set(1, d.x0, d.y0, 0); B.set(d.x1, d.y1, d.w, d.opacity); C.set(0, 0, 0, 0);
      } else if (d.kind === 'contour') {
        A.set(2, 0, 0, 0); B.set(d.level, d.inset, d.w, d.opacity);
        C.set(d.xMin, d.xMax, d.side === 'port' ? 1 : (d.side === 'stbd' ? 2 : 0), 0);
      } else {
        const rect = atlas?.rects?.get(d);
        if (!rect) continue;
        A.set(3, d.x, d.y, d.rot || 0); B.set(d.w * 0.5, d.h * 0.5, d.flip ? 1 : 0, d.opacity);
        C.set(rect[0], rect[1], rect[2], rect[3]);
      }
      di++;
    }
    U.decalCount.value = di;
    if (atlas?.data) {
      const at = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      at.magFilter = THREE.LinearFilter;
      at.minFilter = THREE.LinearFilter;
      at.generateMipmaps = false;
      at.colorSpace = THREE.NoColorSpace;
      at.needsUpdate = true;
      this._atlasTex?.dispose();
      this._atlasTex = at;
      this.T.atlas.value = at;
    }
    this._ensureTargets(W, H);
  }

  /**
   * Sieć rur do tekstur i uniformów: pipeA (RGBA16F na siatce pola, dwuliniowo) — przesunięcie w poprzek od osi biegu
   * [j.], cos φ, sin φ, numer odcinka; pipeB (RGBA8, textureLoad) — numer biegu, numer osprzętu; biegi (promienie rur,
   * pół-szerokość, odstęp, najgrubsza, materiał + 4 · na płytach) i osprzęt (miejsce, rodzaj + 8 · na płytach, obrót,
   * wymiary). Bez sieci — tekstury 1 × 1 i wyłącznik w uniformie.
   */
  _setPipes(field, n, toHalf) {
    const U = this.U, g = field.grid;
    const net = field.pipeNet, pt = field.pipeTex;
    this._pipeATex?.dispose();
    this._pipeBTex?.dispose();
    let aTex, bTex;
    if (net && pt && net.runs.length + net.fits.length > 0) {
      const pa = new Uint16Array(n * 4);
      const hT = toHalf(1000), h1 = toHalf(1);
      for (let i = 0; i < n; i++) { pa[i * 4] = hT; pa[i * 4 + 1] = h1; }
      const A = pt.a, M = pt.mask;
      for (let i = 0; i < n; i++) {
        if (!M[i]) continue;
        const o = i * 4;
        pa[o] = toHalf(A[o]); pa[o + 1] = toHalf(A[o + 1]); pa[o + 2] = toHalf(A[o + 2]); pa[o + 3] = toHalf(A[o + 3]);
      }
      aTex = halfTexture(pa, g.w, g.h);
      bTex = new THREE.DataTexture(pt.b, g.w, g.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    } else {
      aTex = halfTexture(new Uint16Array([toHalf(1000), toHalf(1), 0, 0]), 1, 1);
      bTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    }
    bTex.magFilter = THREE.NearestFilter;
    bTex.minFilter = THREE.NearestFilter;
    bTex.generateMipmaps = false;
    bTex.colorSpace = THREE.NoColorSpace;
    bTex.needsUpdate = true;
    this._pipeATex = aTex;
    this._pipeBTex = bTex;
    this.T.pipeA.value = aTex;
    this.T.pipeB.value = bTex;
    const on = !!(net && net.runs.length + net.fits.length > 0);
    U.pnet.value.set(on ? 1 : 0, net ? net.clampJ / net.detail : 26, 0, 0);
    if (!on) return;
    const R = U.pruns.array;
    net.runs.forEach((r, i) => {
      if (i + 1 >= HD_COMPOSER_LIMITS.pipeRuns) return;
      const q = r.radii;
      R[(i + 1) * 3].set(q[0] || 0, q[1] || 0, q[2] || 0, q[3] || 0);
      R[(i + 1) * 3 + 1].set(q[4] || 0, q[5] || 0, q[6] || 0, q[7] || 0);
      R[(i + 1) * 3 + 2].set(r.halfW, r.gap, r.rMax, (r.mat || 0) + (r.over ? 4 : 0));
    });
    const F = U.pfits.array;
    net.fits.forEach((f, i) => {
      if (i + 1 >= HD_COMPOSER_LIMITS.pipeFits) return;
      F[(i + 1) * 2].set(f.x, f.y, f.type + (f.over ? 8 : 0), f.rot || 0);
      F[(i + 1) * 2 + 1].set(f.hw, f.hh, f.p1 || 0, f.p2 || 0);
    });
  }

  /** Wypiek (passy w kolejności) i odczyt: { width, height, tpu, albedo, surface, emission (RGBA8, wiersz 0 = góra), ms }. */
  async bake() {
    const r = this.renderer;
    const t0 = performance.now();
    const prev = r.getRenderTarget();
    try {
      for (const p of this.passes) {
        r.setRenderTarget(this.targets[p.name]);
        p.quad.render(r);
      }
    } finally {
      r.setRenderTarget(prev);
    }
    const { w, h } = this.targets;
    const [albedo, surface, emission] = await Promise.all([
      this._read(this.targets.alb, w, h), this._read(this.targets.surf, w, h), this._read(this.targets.eout, w, h)
    ]);
    this.lastMs = performance.now() - t0;
    return { width: w, height: h, tpu: this.size.tpu, albedo, surface, emission, ms: this.lastMs };
  }

  async _read(rt, w, h) {
    const raw = await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
    const stride = Math.ceil(w * 4 / 256) * 256;
    const out = new Uint8ClampedArray(w * h * 4);
    if (stride === w * 4) out.set(raw.subarray(0, w * h * 4));
    else for (let y = 0; y < h; y++) out.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
    return out;
  }
}
