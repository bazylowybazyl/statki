// HUTA — wytop: GAZ KOMORY — SIATKA GPU (tekstury 3D i kernele compute w TSL). Bez window / DOM.
//
// Gaz komory jako symulowany ośrodek (runda 5, decyzja użytkownika „Tak, symulowany”): ośrodek nieściśliwy na siatce
// kartezjańskiej 3D w układzie komory + trzy skalary (`dym`, `opar`, `T`). Technika jak gaz wybuchów gry
// (`src/3d/gas/gasGrid.js`: tekstury `Storage3DTexture` RGBA16F, kolejność kerneli, flaga komórki stałej w kanale,
// Neumann w Jacobim, prędkość bryły w dywergencji, Jacobi rozgrzany poprzednim krokiem, zapis f16 z zaokrągleniem
// stochastycznym), ale solver jest własny: domena 1 : 1, wir pola 0 g, wypór włączany grawitacją, wentylacja
// (pierścień górny + cztery okapy), bryły analitycznie z uniformów, źródła z rekordów symulacji. WYGLĄD gazu nie
// pochodzi z efektów gry (kernel obrazu niżej: gaz nie świeci — rozprasza światło kuli i wyświetlacza).
//
// TEKSTURY (RGBA16F): `velA`, `velB` (prędkość xyz [j./s], flaga komórki stałej), `denA`, `denB`, `denC` (dym, opar,
// T; w: flaga stałej / udział stałych w próbce / źródło objętości), `prsA`, `prsB` (ciśnienie, prawa strona, flaga),
// `wir` (rotacja prędkości, jej długość), `obrA`, `obrB` (obraz: rgb rozproszenia na jednostkę drogi, tłumienie),
// `kol` (2D: mapa kolumn — ciepło, grubość optyczna, masy). Żaden kernel nie czyta tekstury, którą pisze; każdy pisze
// JEDNĄ teksturę i czyta najwyżej trzy (strażnik w teście).
//
// KROK (1/60 s, jeden na krok fizyki), kernele w jednym `renderer.compute(lista)`:
//   gazWiry → gazPredkosc (adwekcja RK2, wzmacnianie wirów, wir pola, wypór, cewki, wentylacja, impulsy źródeł, opór;
//   bryły) → gazSkalaryPrzod → gazSkalaryKorekta (MacCormack z obcięciem, źródła, stygnięcie, zanik, upusty) →
//   gazDywergencja → gazJacobiAB / BA × K → gazRzut → gazPrzepisz → gazObrazA / B (na zmianę) → gazKolumny.
// Lustra CPU wzorów i mały krok CPU: `gaz.js`. Wejście kroku: tablica `GAZ_IN` (`gazWejscie.js`).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, abs, clamp, cross, dot, exp, float, floor, instanceIndex, instancedArray, int, length, max, min, mix, normalize, pow,
  select, sin, cos, smoothstep, step, texture, texture3D, textureStore, uint, uniform, uniformArray, uvec2, uvec3, vec2, vec3, vec4
} from 'three/tsl';
import { ensureHalfRoundingProbe, rndF16, rndF16Next, sroundF16 } from '../../../../src/3d/tsl/zapisF16.js';
import { KOMORA } from './geometria.js';
import {
  GAZ, GAZ_DISP, GAZ_FIZ, GAZ_FLOOR_SLOPE, GAZ_HOOD_COS, GAZ_HOOD_DIR, GAZ_IN, GAZ_LAKE_N, GAZ_MASA, GAZ_OKAP, GAZ_SLOTS,
  GAZ_RODZAJ, GAZ_SLOT, GAZ_SRC, GAZ_STRIDE, GAZ_WENT, gazHoodR, gazRingHalf, gazSourceCenterCpu, gazSourceStretch, gazZoneCells, GAZ_SRC_SPEED, gazPulseOf, GAZ_HOOD_LAMP, GAZ_HOOD_LIGHT
} from './gaz.js';

const FUN = KOMORA.funnel;
const v4 = () => new THREE.Vector4(0, 0, 0, 0);
const v3 = () => new THREE.Vector3(0, 0, 0);
const v4Array = (n, name) => uniformArray(Array.from({ length: n }, v4), 'vec4').setName(name);

function tex3(nx, ny, nz, name) {
  const t = new THREE.Storage3DTexture(nx, ny, nz);
  t.name = name;
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function tex2(w, h, name) {
  const t = new THREE.StorageTexture(w, h);
  t.name = name;
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Kłąb uderzenia: najwięcej plam na jeden rekord linii styku (odcinek 1/5 obwodu). */
export const GAZ_IMPACT_SUB = 5;
/** Skrót liczby całkowitej → [0, 1) (powtarzalny; bez `Math.random`). */
function hash01(i) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Wygląd gazu — liczby kernela obrazu i marszu (wspólne dla presetów; `look` siatki jest kopią do strojenia na żywo).
 *   scatter     jasność rozproszenia (skala całego obrazu gazu)
 *   lightGain   udział światła kuli / masy w leju; `lightSoft` — promień źródła w spadku z odległością [× promień]
 *   dispGain    udział światła wyświetlacza (rośnie ku ścianie i ku wysokości pasa); `ambient` — otoczenie z otwartej góry
 *   shadowK     siła cienia własnego (promienistego, ku światłu kuli); `shadowRange` — zasięg marszu cienia [j.]
 *   smokeAlb, fumeAlb   albedo dymu i oparów (mnoży barwy metalu `gasSmoke`, `gasFume`)
 *   knee        luminancja nasycenia obrazu gazu (pod progiem bloomu 0,9)
 *   amb*        barwa otoczenia (światło robocze i niebo z otwartej góry — neutralne, chłodne)
 *   rhoRef, sigma, contrast   KONTRAST GĘSTOŚCI: tłumienie σ = `sigma` · (kDym · dym + kOpar · opar) · (ρ / (ρ + `rhoRef`))^`contrast`, ρ = dym + opar
 *               [t / 10⁶ j.³] — rzadka mgiełka tła (ρ ≪ rhoRef) prawie znika, gęste strugi i kłęby zostają: gaz czyta
 *               się jako smugi z przepływu, nie jako jednolita zasłona, a środek kadru zostaje czysty
 *   heat*       drganie powietrza nad gorącym gazem: przesunięcie [px] na jednostkę gradientu ciepła, amplituda fali [px]
 *   phaseG, phaseMix   funkcja fazowa światła kuli: Henyey-Greenstein (g) zmieszany z równomiernym w udziale `phaseMix`
 *   hoodGain, hoodR   ŚWIATŁO PASÓW W GARDŁACH OKAPÓW na gazie (runda 6): udział (× jasność pasa `hoodGlow`) i promień
 *               źródła w spadku (R² / (d² + R²))² [j.] — gaz wciągany do wlotu jaśnieje chłodno w świetle pasa
 *   ringRef, ringSigma, ringR0, ringR1   PIERŚCIEŃ PRZY ŚCIANIE (ρ od `ringR0` do `ringR1` i dalej): próg kontrastu
 *               × `ringRef`, tłumienie × `ringSigma` — tam gaz ma być widać z kamery gry (K4); środek kadru bez zmian
 */
export const GAZ_LOOK = Object.freeze({
  scatter: 1.0, lightGain: 0.95, lightSoft: 1.0, dispGain: 1.2, ambient: 0.3, shadowK: 1.4, shadowRange: 260,
  smokeAlb: 2.1, fumeAlb: 0.9, knee: 0.8, heatGrad: 5, heatWave: 1.5, rhoRef: 0.045, sigma: 2.9, contrast: 1.6,
  ambR: 0.8, ambG: 0.88, ambB: 1.0,
  phaseG: 0.5, phaseMix: 0.6,
  ringRef: 0.28, ringSigma: 2.6, ringR0: 395, ringR1: 455,
  hoodGain: 3.0, hoodR: 95
});

/**
 * Siatka gazu jednej komory.
 * @param {object} o
 * @param {number} [o.preset=1]  numer presetu `GAZ.presets`
 */
export class GazSiatka {
  constructor({ preset = 1, fiz = null } = {}) {
    /** liczby fizyki tej siatki: `GAZ_FIZ` z nadpisaniami (strojenie w harnessie: `?gazFiz=klucz:wartość,…`) */
    this.F = Object.freeze({ ...GAZ_FIZ, ...(fiz || {}) });
    const P = GAZ.presets[Math.max(0, Math.min(GAZ.presets.length - 1, preset | 0))];
    this.preset = P;
    this.nx = P.nx;
    this.ny = P.ny;
    this.nz = P.nz;
    this.cell = P.cell;
    this.cells = P.nx * P.ny * P.nz;
    // siatka skalarów (dym, opar, T, obraz) — gęstsza niż siatka prędkości, ta sama domena
    this.snx = P.snx;
    this.sny = P.sny;
    this.snz = P.snz;
    this.scell = P.scell;
    this.scells = P.snx * P.sny * P.snz;
    this.cols = P.snx * P.snz;
    /** komórka, od której liczy się najmniejszy promień plamy źródła (gęstość na siatce skalarów, impuls na siatce prędkości) */
    this.srcCell = Math.max(P.scell, 0.55 * P.cell);
    this.zones = gazZoneCells(P);
    this.look = { ...GAZ_LOOK };
    const t = (name) => tex3(P.nx, P.ny, P.nz, `gaz_${name}`);
    const ts = (name) => tex3(P.snx, P.sny, P.snz, `gaz_${name}`);
    this.velA = t('velA'); this.velB = t('velB');
    this.denA = ts('denA'); this.denB = ts('denB'); this.denC = ts('denC');
    this.prsA = t('prsA'); this.prsB = t('prsB');
    this.wir = t('wir');
    this.obrA = ts('obrA');
    this.obrB = P.blend ? ts('obrB') : null;
    this.kol = tex2(P.snx, P.snz, 'gaz_kol');
    this.U = {
      seed: uniform(0, 'uint'),
      k2: uniform(v4()),            // obmywanie bryły: dociąganie na krok (0 — brak bryły albo tryb grawitacji), mnożnik skalarów na krok w strefie; mnożnik zaniku dymu i oparów na krok; 0
      bell: uniform(v4()),          // dzwon ssawy: wylot x, y, dociąganie na krok, mnożnik skalarów na krok
      k: uniform(v4()),             // współczynniki kroku: wir pola (1 − e^(−tempo · pole · dt)), grawitacja 0…1, dt, liczba źródeł
      body: uniform(v4()),          // bryła: środek xyz, półoś pozioma (0 — brak)
      body2: uniform(v4()),         // półoś pionowa, prędkość xyz
      body3: uniform(v4()),         // prędkość kątowa bryły wokół osi pionowej [rad/s], czas symulacji [s], temperatura bryły 0…1, 0
      coil: uniform(v4()),          // cewki: środek klatki xyz, promień pierścienia
      coil2: uniform(v4()),         // wysokość osi segmentów (±), tłumienie na krok (mnożnik), 0, 0
      vent: uniform(v4()),          // źródło objętości × komórka [j./s]: pierścień, okapy | prędkość promieniowa w pasie pierścienia [j./s] | wydatek jednego okapu [j.³/s]
      vent2: uniform(v4()),         // dociąganie do pola upustu okapu (na krok), narzucenie strugi nawiewu okapu (na krok), prędkość strugi [j./s], narzucenie prędkości w pasie pierścienia (na krok)
      vent3: uniform(v4()),         // mnożnik skalarów na krok w strefie: pierścień, okapy | 0 | 0
      light: uniform(v4()),         // światło bryły: środek xyz, promień źródła
      lightC: uniform(v3()),        // … barwa × moc
      disp: uniform(v3()),          // barwa × jasność wyświetlacza
      smoke: uniform(v3()),         // barwa × albedo dymu
      fume: uniform(v3()),          // barwa × albedo oparów
      look: uniform(v4()),          // jasność rozproszenia, udział światła kuli, udział wyświetlacza, otoczenie
      look2: uniform(v4()),         // siła cienia, zasięg cienia [j.], miękkość źródła, gęstość odniesienia kontrastu
      look3: uniform(v4()),         // skala tłumienia, wykładnik kontrastu gęstości, funkcja fazowa: g Henyeya-Greensteina, udział
      look4: uniform(v4()),         // pierścień przy ścianie: udział progu kontrastu, mnożnik σ, promień początku i pełni strefy [j.]
      hoodL: uniform(v4()),         // światło pasów okapów: barwa × jasność × udział (rgb), promień źródła [j.]
      eye: uniform(v3()),           // kamera w układzie komory (funkcja fazowa rozpraszania światła kuli)
      amb: uniform(v3()),           // barwa otoczenia
      lake: v4Array(GAZ_LAKE_N, 'GazMasa'),          // masa w leju: grubość nad wykładziną [j.], prędkość lustra [j./s]
      srcA: v4Array(GAZ_SLOTS, 'GazZrodlaA'),        // środek plamy xyz, promień
      srcB: v4Array(GAZ_SLOTS, 'GazZrodlaB'),        // kierunek xyz, prędkość wypływu
      srcC: v4Array(GAZ_SLOTS, 'GazZrodlaC')         // gęstość dymu i oparów w środku plamy na krok, T, źródło objętości × komórka w środku plamy
    };
    this.flip = 0;                  // który stan obrazu jest bieżący: 0 — obrA, 1 — obrB
    /** dodatkowy zanik dymu i oparów [1/s] ponad `F.decay` — ustawia regulator masy kroku (`gazKrok.js`) */
    this.extraDecay = 0;
    /** wydajność zaniku podstawowego 0…1 — regulator masy przymyka go, gdy pole ma mniej gazu niż symulacja */
    this.removalK = 1;
    this.steps = 0;
    this._seed = 1;
    this._srcP = new Float64Array(3);
    this._w = new Float64Array(GAZ_IMPACT_SUB);
    this._pulse = new Float64Array(2);
    this._env = 0;
    this._impactSeed = 0;
    this._probeBuf = instancedArray(this.cols, 'vec4').setName('gazSondaKolumny');
    this._build();
    this.setLook();
  }

  /** Bajty tekstur siatki (RGBA16F). */
  get bytes() {
    return this.cells * 8 * 5 + this.scells * 8 * (4 + (this.obrB ? 1 : 0)) + this.cols * 8;
  }

  setLook(o = null) {
    if (o) Object.assign(this.look, o);
    const L = this.look;
    this.U.look.value.set(L.scatter, L.lightGain, L.dispGain, L.ambient);
    this.U.look2.value.set(L.shadowK, L.shadowRange, L.lightSoft, L.rhoRef);
    this.U.look3.value.set(L.sigma, L.contrast, L.phaseG, L.phaseMix);
    this.U.look4.value.set(L.ringRef, L.ringSigma, L.ringR0, L.ringR1);
    this.U.amb.value.set(L.ambR, L.ambG, L.ambB);
    if (this._smokeRaw) this.setColors(this._smokeRaw, this._fumeRaw);
  }

  /** Barwy składników (metal: `gasSmoke`, `gasFume`). */
  setColors(smoke, fume) {
    this._smokeRaw = smoke;
    this._fumeRaw = fume;
    const L = this.look;
    this.U.smoke.value.set(smoke[0] * L.smokeAlb, smoke[1] * L.smokeAlb, smoke[2] * L.smokeAlb);
    this.U.fume.value.set(fume[0] * L.fumeAlb, fume[1] * L.fumeAlb, fume[2] * L.fumeAlb);
  }

  // --- TSL ---------------------------------------------------------------------

  _build() {
    const U = this.U;
    const NX = this.nx;
    const NY = this.ny;
    const NZ = this.nz;
    const H = this.cell;
    const F = this.F;
    const ORG = vec3(GAZ.x0, GAZ.y0, GAZ.z0);
    const INV = vec3(1 / (NX * H), 1 / (NY * H), 1 / (NZ * H));
    const TOPY = Math.min(GAZ.ceilY, GAZ.y0 + (NY - 1) * H);
    const RING_HALF = gazRingHalf(H);
    const HOOD_R = gazHoodR(H);
    const WT = GAZ_WENT;
    const dt = U.k.z;

    /** Próbka trójliniowa w punkcie komory (w środku komórki = wartość komórki). */
    const samp = (tex, P) => texture3D(tex, P.sub(ORG).mul(INV)).level(0);
    /** Komórka wątku: współrzędne, środek w układzie komory, adres zapisu. */
    const cellOf = () => {
      const xi = int(instanceIndex.mod(uint(NX))).toVar();
      const yi = int(instanceIndex.div(uint(NX)).mod(uint(NY))).toVar();
      const zi = int(instanceIndex.div(uint(NX * NY))).toVar();
      const P = vec3(float(xi), float(yi), float(zi)).add(0.5).mul(H).add(ORG).toVar();
      return { xi, yi, zi, P, store: uvec3(uint(xi), uint(yi), uint(zi)) };
    };
    // siatka skalarów (gęstsza): ta sama domena, więc te same współrzędne tekstur (`samp`)
    const SNX = this.snx;
    const SNY = this.sny;
    const SNZ = this.snz;
    const SH = this.scell;
    /** Komórka wątku na siatce skalarów. */
    const cellOfS = () => {
      const xi = int(instanceIndex.mod(uint(SNX))).toVar();
      const yi = int(instanceIndex.div(uint(SNX)).mod(uint(SNY))).toVar();
      const zi = int(instanceIndex.div(uint(SNX * SNY))).toVar();
      const P = vec3(float(xi), float(yi), float(zi)).add(0.5).mul(SH).add(ORG).toVar();
      return { xi, yi, zi, P, store: uvec3(uint(xi), uint(yi), uint(zi)) };
    };
    const w16 = (x, salt, n) => {
      const r0 = rndF16(instanceIndex, U.seed, salt).toVar();
      const r = n === 4 ? vec4(r0, rndF16Next(r0, 1), rndF16Next(r0, 2), rndF16Next(r0, 3)) : vec3(r0, rndF16Next(r0, 1), rndF16Next(r0, 2));
      return sroundF16(x, r);
    };
    /**
     * Tłumienie obrazu [1/j.] z gęstości (dym, opar) — z kontrastem gęstości (`GAZ_LOOK.rhoRef`): vec2(dym, opar).
     * Wspólne dla kernela obrazu, cienia i mapy kolumn (sonda mierzy to, co widać).
     */
    const sigmaOf = (dym, opar, rho, y) => {
      const rt = dym.add(opar);
      // PIERŚCIEŃ PRZY ŚCIANIE (runda 5, poprawki — K4): tam gaz MA być widać — próg kontrastu niższy i tłumienie
      // większe (`look4`: udział progu, mnożnik σ; strefa od `look4.z` do `look4.w` po promieniu). Strefy chronione
      // (słup nad kulą, tarcza leja ρ < 330) bez zmian.
      // (tylko pod pasem wyświetlacza — nad nim, przy licu ekranów, gaz ma zostać rzadki: K2)
      // — przy grawitacji (`U.k.y`) także wyżej: gaz idący w górę po ścianach to drugi znak grawitacji)
      const ring = smoothstep(U.look4.z, U.look4.w, rho).mul(max(float(1.0).sub(smoothstep(KOMORA.display.y - KOMORA.display.half - 20, KOMORA.display.y + KOMORA.display.half, y)), U.k.y.mul(0.85)));
      const ref = U.look2.w.mul(mix(float(1.0), U.look4.x, ring));
      const k = pow(max(rt.div(rt.add(ref)), 1e-6), U.look3.y).mul(U.look3.x).mul(mix(float(1.0), U.look4.y, ring));
      return vec2(dym.mul(F.kDym), opar.mul(F.kOpar)).mul(k);
    };
    /** Dno komory: stożek leja, nad gardzielą poziom gardzieli (lustro `gazFloorCpu`). */
    const floorAt = (rho) => max(float(FUN.throatY), rho.sub(FUN.throatR).mul(GAZ_FLOOR_SLOPE).add(FUN.throatY));
    /** Promień wewnętrzny bryły okapu na wysokości y (lustro `gazHoodRhoCpu`). */
    const hoodRho = (y) => {
      const O = GAZ_OKAP;
      const a = y.sub(O.yRoof).mul((O.rWall - O.rRoof) / (O.yTop - O.yRoof)).add(O.rRoof);
      const b = y.sub(O.yMouth).mul((O.rRoof - O.rMouth) / (O.yRoof - O.yMouth)).add(O.rMouth);
      const c = y.sub(O.yLip).mul((O.rMouth - O.rLip) / (O.yMouth - O.yLip)).add(O.rLip);
      const d = float(O.yLip).sub(y).mul((O.rWall - O.rLip) / (O.yLip - O.yBottom)).add(O.rLip);
      // odcinki łamanej: maski 0 / 1 zamiast zagnieżdżonych rozgałęzień
      const m0 = step(O.yRoof, y);
      const m1 = step(O.yMouth, y).mul(float(1.0).sub(m0));
      const m2 = step(O.yLip, y).mul(float(1.0).sub(step(O.yMouth, y)));
      const m3 = float(1.0).sub(step(O.yLip, y));
      return a.mul(m0).add(b.mul(m1)).add(c.mul(m2)).add(d.mul(m3));
    };
    /** Największy rzut punktu (x, z) na kierunki okapów (okap k: rzut > cos połowy łuku × ρ). */
    const hoodDot = (P) => {
      let m = null;
      for (const [cx, cz] of GAZ_HOOD_DIR) {
        const d = P.x.mul(cx).add(P.z.mul(cz));
        m = m ? max(m, d) : d;
      }
      return m;
    };
    /** Strefa pierścienia górnego 0 / 1 (lustro `gazRingZoneCpu`). */
    const ringZone = (P, rho) => step(GAZ.wallR - WT.ring.thick * H, rho).mul(step(rho, GAZ.wallR)).mul(step(abs(P.y.sub(WT.ring.y)), RING_HALF));
    /** Strefa wlotów okapów 0 / 1 (lustro `gazHoodZoneCpu`). */
    const hoodZone = (P) => {
      let m = null;
      for (const [cx, cz] of GAZ_HOOD_DIR) {
        const d = P.sub(vec3(WT.hood.rho * cx, WT.hood.y, WT.hood.rho * cz));
        const z = step(dot(d, d), HOOD_R * HOOD_R);
        m = m ? max(m, z) : z;
      }
      return m;
    };
    /** Strefa obmywania bryły 0…1 (lustro wagi `gazWashCpu`): nad górną połową bryły, do `washR` od jej powierzchni. */
    const washMask = (P) => {
      const Rb = max(U.body.w, 1.0);
      const wd = P.sub(U.body.xyz).mul(vec3(1.0, Rb.div(max(U.body2.x, 1.0)), 1.0));
      return smoothstep(Rb.mul(-0.2), Rb.mul(0.2), wd.y)
        .mul(float(1.0).sub(smoothstep(Rb.add(U.k2.w.mul(0.5)), Rb.add(U.k2.w), length(wd.xz))))
        .mul(step(Rb, length(wd)));
    };
    /**
     * KOMÓRKA STAŁA w punkcie komory (lustro `gazSolidCpu`): zwraca zmienne `solid` (0 / 1) i `sv` (prędkość bryły).
     * Wszystkie wielkości wspólne przypisane przed rozgałęzieniami (pułapki 36 / 39).
     */
    const solidOf = (P) => {
      const solid = float(0.0).toVar();
      const sv = vec3(0.0).toVar();
      const rho = float(0.0).toVar();
      rho.assign(length(P.xz));
      const floorY = float(0.0).toVar();
      floorY.assign(floorAt(rho));
      // ściana, błona (i górna warstwa siatki), dno-lej
      solid.assign(max(max(step(GAZ.wallR, rho), step(TOPY, P.y)), step(P.y, floorY)));
      // wyświetlacz: klin między ścianą a pochylonym licem
      const D = GAZ_DISP;
      const inDisp = step(D.y0, P.y).mul(step(P.y, D.y1)).mul(step(P.y.sub(D.y0).mul(D.slope).add(D.r0), rho));
      solid.assign(max(solid, inDisp));
      // okapy
      const O = GAZ_OKAP;
      const inHood = step(O.yBottom, P.y).mul(step(P.y, O.yTop)).mul(step(hoodRho(P.y), rho)).mul(step(rho.mul(GAZ_HOOD_COS), hoodDot(P)));
      solid.assign(max(solid, inHood));
      // masa w leju: lustro z pierścieni pola masy (liniowo między pierścieniami)
      const a = float(0.0).toVar();
      a.assign(clamp(rho.sub(GAZ_MASA.r0).div(GAZ_MASA.dr).add(0.5), 0.0, GAZ_LAKE_N - 1.001));
      const i0 = int(0).toVar();
      i0.assign(int(floor(a)));
      const lk = vec2(0.0).toVar();
      lk.assign(mix(U.lake.element(i0).xy, U.lake.element(i0.add(int(1))).xy, a.sub(float(i0))));
      If(lk.x.greaterThan(0.5).and(P.y.lessThan(floorY.add(lk.x))), () => {
        solid.assign(1.0);
        sv.assign(vec3(0.0, lk.y, 0.0));
      });
      // bryła w środku (kupa / kula): elipsoida
      const q = vec3(0.0).toVar();
      q.assign(P.sub(U.body.xyz).div(vec3(max(U.body.w, 1.0), max(U.body2.x, 1.0), max(U.body.w, 1.0))));
      If(U.body.w.greaterThan(0.5).and(dot(q, q).lessThan(1.0)), () => {
        solid.assign(1.0);
        // prędkość bryły: ruch środka + obrót wokół osi pionowej (powierzchnia ω · (z, 0, −x))
        sv.assign(U.body2.yzw.add(vec3(P.z.sub(U.body.z), 0.0, U.body.x.sub(P.x)).mul(U.body3.x)));
      });
      return { solid, sv, rho };
    };

    // 0. Rotacja pola prędkości (do wzmacniania wirów).
    this.kWiry = Fn(() => {
      const c = cellOf();
      const V = (dx, dy, dz) => samp(this.velA, c.P.add(vec3(dx * H, dy * H, dz * H)));
      const xp = V(1, 0, 0).toVar(); const xm = V(-1, 0, 0).toVar();
      const yp = V(0, 1, 0).toVar(); const ym = V(0, -1, 0).toVar();
      const zp = V(0, 0, 1).toVar(); const zm = V(0, 0, -1).toVar();
      const w = vec3(
        yp.z.sub(ym.z).sub(zp.y.sub(zm.y)),
        zp.x.sub(zm.x).sub(xp.z.sub(xm.z)),
        xp.y.sub(xm.y).sub(yp.x.sub(ym.x))
      ).mul(0.5 / H).toVar();
      textureStore(this.wir, c.store, vec4(w, length(w)));
    })().compute(this.cells).setName('gazWiry');

    // 1. Prędkość: bryły, adwekcja RK2 wstecz, wzmacnianie wirów, wir pola, wypór, cewki, wentylacja, impulsy źródeł, opór.
    this.kPredkosc = Fn(() => {
      const c = cellOf();
      const P = c.P;
      const S = solidOf(P);
      const out = vec4(0.0).toVar();
      out.assign(vec4(S.sv, 1.0));
      If(S.solid.lessThan(0.5), () => {
        const v0 = vec4(0.0).toVar();
        v0.assign(samp(this.velA, P));
        const vm = vec4(0.0).toVar();
        vm.assign(samp(this.velA, P.sub(v0.xyz.mul(dt.mul(0.5)))));
        const sb = vec4(0.0).toVar();
        sb.assign(samp(this.velA, P.sub(vm.xyz.mul(dt))));
        const v = vec3(0.0).toVar();
        // próbka z pominięciem komórek stałych: udział stałych < 1/2 — zdjęcie rozcieńczenia, inaczej prędkość komórki
        v.assign(mix(v0.xyz, sb.xyz.div(max(float(1.0).sub(sb.w), 0.5)), step(sb.w, 0.5)));
        const D = vec4(0.0).toVar();
        D.assign(samp(this.denA, P));
        // wzmacnianie wirów: siła ε · h · (N × ω), N — kierunek wzrostu |ω|
        const wC = vec4(0.0).toVar();
        wC.assign(samp(this.wir, P));
        const W = (dx, dy, dz) => samp(this.wir, P.add(vec3(dx * H, dy * H, dz * H))).w;
        const eta = vec3(0.0).toVar();
        eta.assign(vec3(W(1, 0, 0).sub(W(-1, 0, 0)), W(0, 1, 0).sub(W(0, -1, 0)), W(0, 0, 1).sub(W(0, 0, -1))));
        v.addAssign(cross(eta.div(length(eta).add(1e-3)), wC.xyz).mul(dt.mul(F.vort * H)));
        // mieszanie ośrodka: pole sił o zerowej dywergencji (każda składowa nie zależy od własnej współrzędnej),
        // trzy skale z fazami płynącymi w czasie; mocniejsze w gorącym gazie
        if (F.turb > 0) {
          const tt = U.body3.y;
          let acc = null;
          for (const [L, amp, w] of [[340, 1.0, 0.61], [160, 0.75, 1.17], [78, 0.5, 1.93]]) {
            const k = 2 * Math.PI / L;
            const ax = P.x.mul(k).add(tt.mul(w * 1.3));
            const ay = P.y.mul(k).sub(tt.mul(w * 0.7));
            const az = P.z.mul(k).add(tt.mul(w));
            const u = vec3(sin(az).add(cos(ay)), sin(ax).add(cos(az)), sin(ay).add(cos(ax))).mul(amp);
            acc = acc ? acc.add(u) : u;
          }
          v.addAssign(acc.mul(dt.mul(F.turb).mul(D.z.mul(F.turbT).add(1.0)).mul(float(1.0).sub(smoothstep(F.turbY0, F.turbY1, P.y)))));
        }
        // wir pola 0 g: relaksacja składowej obwodowej (styczna (z, −x) / ρ — zwrot jak ziarna i szewrony)
        const rr = float(0.0).toVar();
        rr.assign(max(S.rho, 1e-3));
        const tx = float(0.0).toVar();
        tx.assign(P.z.div(rr));
        const tz = float(0.0).toVar();
        tz.assign(P.x.negate().div(rr));
        const vTarget = min(S.rho.div(F.swirlR), 1.0).mul(pow(float(F.swirlR).div(max(S.rho, F.swirlR)), F.swirlPow)).mul(F.swirlV);
        const dv = float(0.0).toVar();
        dv.assign(vTarget.sub(v.x.mul(tx).add(v.z.mul(tz))).mul(U.k.x));
        v.addAssign(vec3(tx.mul(dv), 0.0, tz.mul(dv)));
        // wypór (tylko przy grawitacji): gorący gaz w górę, ciężki dym w dół
        v.y.addAssign(dt.mul(U.k.y).mul(D.z.mul(F.buoyT).sub(D.x.mul(F.buoyDym))));
        // cewki: strefa porowata (dwa pierścienie segmentów nad i pod równikiem)
        const cq = vec2(0.0).toVar();
        cq.assign(vec2(length(P.xz.sub(U.coil.xz)).sub(U.coil.w), abs(P.y.sub(U.coil.y)).sub(U.coil2.x)));
        v.mulAssign(mix(float(1.0), U.coil2.y, step(length(cq), Math.max(F.coilThick * H, KOMORA.coilTube))));
        // obmywanie bryły nawiewem (0 g): dociąganie do opływu kuli strumieniem z góry (lustro `gazWashCpu`)
        {
          const Rb = float(0.0).toVar();
          Rb.assign(max(U.body.w, 1.0));
          const wd = vec3(0.0).toVar();
          wd.assign(P.sub(U.body.xyz).mul(vec3(1.0, Rb.div(max(U.body2.x, 1.0)), 1.0)));
          const wr = float(0.0).toVar();
          wr.assign(max(length(wd), 1.0));
          const wk = float(0.0).toVar();
          wk.assign(Rb.mul(Rb).mul(Rb).div(wr.mul(wr).mul(wr).mul(2.0)));
          const vr3 = float(0.0).toVar();
          vr3.assign(wd.y.div(wr).mul(-3.0 * F.washU));
          const wt = vec3(0.0).toVar();
          wt.assign(vec3(vr3.mul(wd.x).div(wr).mul(wk).negate(), vr3.mul(wd.y).div(wr).add(F.washU).mul(wk).negate().sub(F.washU), vr3.mul(wd.z).div(wr).mul(wk).negate()));
          const wm = smoothstep(Rb.mul(-0.2), Rb.mul(0.2), wd.y)
            .mul(float(1.0).sub(smoothstep(Rb.add(U.k2.w.mul(0.5)), Rb.add(U.k2.w), length(wd.xz))))
            .mul(step(Rb, wr)).mul(U.k2.x);
          v.assign(mix(v, wt, wm));
        }
        // dzwon ssawy: dociąganie ku wylotowi (lokalny upust oparów)
        {
          const bd = vec3(0.0).toVar();
          bd.assign(vec3(U.bell.x, U.bell.y, 0.0).sub(P));
          const bl = float(0.0).toVar();
          bl.assign(max(length(bd), 1.0));
          const bu = float(F.bellU * F.bellR * F.bellR).div(max(bl, F.bellR).mul(max(bl, F.bellR)));
          v.assign(mix(v, bd.div(bl).mul(bu), clamp(float(1.0).sub(bl.div(F.bellPull)), 0.0, 1.0).mul(U.bell.z)));
        }
        // pierścień górny: prędkość nawiewu / ssania w pasie przy ścianie
        const ur = float(0.0).toVar();
        ur.assign(U.vent.z);
        v.assign(mix(v, vec3(P.x.div(rr).mul(ur), 0.0, P.z.div(rr).mul(ur)), ringZone(P, S.rho).mul(U.vent2.w)));
        // okapy: przy ssaniu dociąganie do pola upustu (prędkość ∝ 1 / d², ku wlotowi), przy nawiewie struga wzdłuż normalnej wlotu
        for (const [cx, cz] of GAZ_HOOD_DIR) {
          const d = vec3(0.0).toVar();
          d.assign(P.sub(vec3(WT.hood.rho * cx, WT.hood.y, WT.hood.rho * cz)));
          const dist = float(0.0).toVar();
          dist.assign(max(length(d), 1.0));
          // prędkość ku wlotowi: ujście punktowe (∝ 1 / d²) przy wlocie, dalej ujście w warstwie grubości `vent3.w`
          // (∝ 1 / d; poza cyklem odciągu warstwa jest nieskończona — profil jak w rundzie 5); zasięg `vent3.z`
          const dd = max(dist, HOOD_R * 0.5);
          const us = U.vent.w.div(dd.mul(min(dd, U.vent3.w)).mul(2 * Math.PI));
          v.assign(mix(v, d.div(dist).mul(us), clamp(float(1.0).sub(dist.div(U.vent3.z)), 0.0, 1.0).mul(U.vent2.x)));
          v.assign(mix(v, vec3(WT.hood.nr * cx, WT.hood.ny, WT.hood.nr * cz).mul(U.vent2.z), step(dist, HOOD_R).mul(U.vent2.y)));
        }
        // źródła: narzucenie prędkości wypływu w plamie
        Loop({ start: int(0), end: int(U.k.w.add(0.5)), type: 'int', condition: '<', name: 'gs' }, ({ gs }) => {
          const A = U.srcA.element(gs).toVar();
          const B = U.srcB.element(gs).toVar();
          const sd = vec3(0.0).toVar();
          sd.assign(P.sub(A.xyz));
          // plama wydłużona wzdłuż wypływu: B.xyz = kierunek × wydłużenie s (lustro `gazSourceStreakCpu`)
          const s2 = float(0.0).toVar();
          s2.assign(max(dot(B.xyz, B.xyz), 1.0));
          const al = float(0.0).toVar();
          al.assign(dot(sd, B.xyz));
          const qq = float(0.0).toVar();
          qq.assign(clamp(float(1.0).sub(dot(sd, sd).sub(al.mul(al).mul(s2.sub(1.0)).div(s2.mul(s2))).div(max(A.w.mul(A.w), 1.0))), 0.0, 1.0));
          v.assign(mix(v, B.xyz.mul(B.w.div(s2.sqrt())), qq.mul(qq).mul(F.impulse).mul(step(0.5, B.w))));
        });
        // opór i sufit prędkości
        const sp = float(0.0).toVar();
        sp.assign(length(v));
        v.mulAssign(min(float(1.0).div(dt.mul(sp.mul(F.dragQ).add(F.drag)).add(1.0)), float(F.vMax).div(max(sp, 1e-3))));
        out.assign(vec4(w16(v, 1, 3), 0.0));
      });
      textureStore(this.velB, c.store, out);
    })().compute(this.cells).setName('gazPredkosc');

    // 2. Skalary w przód (półlagranżowsko, RK2 wstecz); dym z dryfem odśrodkowym — osobna próbka przesunięta ku osi.
    this.kPrzod = Fn(() => {
      const c = cellOfS();
      const P = c.P;
      const v0 = vec4(0.0).toVar();
      v0.assign(samp(this.velA, P));
      const out = vec4(0.0).toVar();
      If(v0.w.lessThan(0.5), () => {
        const vm = vec4(0.0).toVar();
        vm.assign(samp(this.velA, P.sub(v0.xyz.mul(dt.mul(0.5)))));
        const pb = vec3(0.0).toVar();
        pb.assign(P.sub(vm.xyz.mul(dt)));
        const sA = vec4(0.0).toVar();
        sA.assign(samp(this.denA, pb));
        const rho = float(0.0).toVar();
        rho.assign(max(length(P.xz), 1e-3));
        const vth = float(0.0).toVar();
        vth.assign(vm.x.mul(P.z).sub(vm.z.mul(P.x)).div(rho));
        const ud = min(float(F.driftMax), vth.mul(vth).mul(F.tauDym).div(max(rho, 20.0)));
        const sD = vec4(0.0).toVar();
        sD.assign(samp(this.denA, pb.sub(vec3(P.x.div(rho), 0.0, P.z.div(rho)).mul(ud.mul(dt)))));
        const UND = F.undil > 0.5 ? 0.5 : 1.0;
        const q = float(1.0).div(max(float(1.0).sub(sA.w), UND));
        out.assign(vec4(sD.x.div(max(float(1.0).sub(sD.w), UND)), sA.y.mul(q), sA.z.mul(q), sA.w));
      });
      const o3 = vec3(0.0).toVar();
      o3.assign(out.xyz);
      textureStore(this.denB, c.store, vec4(w16(o3, 2, 3), out.w));
    })().compute(this.scells).setName('gazSkalaryPrzod');

    // 3. Korekta MacCormacka z obcięciem do sąsiadów, źródła, stygnięcie, zanik awaryjny, strefy wentylacji.
    //    Kanał w wyniku: źródło objętości × komórka [j./s] (dla dywergencji).
    this.kKorekta = Fn(() => {
      const c = cellOfS();
      const P = c.P;
      const v0 = vec4(0.0).toVar();
      v0.assign(samp(this.velA, P));
      const out = vec4(0.0).toVar();
      If(v0.w.lessThan(0.5), () => {
        const fwd = vec4(0.0).toVar();
        fwd.assign(samp(this.denB, P));
        const a = vec3(0.0).toVar();
        a.assign(fwd.xyz);
        const vmF = vec4(0.0).toVar();
        vmF.assign(samp(this.velA, P.add(v0.xyz.mul(dt.mul(0.5)))));
        // rozbieżność prędkości, która niosła gaz (× dt): do zachowania masy i do bramki korekty MacCormacka
        const VA = (dx, dy, dz) => samp(this.velA, P.add(vec3(dx * H, dy * H, dz * H)));
        const dvt = float(0.0).toVar();
        dvt.assign(VA(1, 0, 0).x.sub(VA(-1, 0, 0).x).add(VA(0, 1, 0).y.sub(VA(0, -1, 0).y)).add(VA(0, 0, 1).z.sub(VA(0, 0, -1).z)).mul(dt.mul(0.5 / H)));
        // korekta MacCormacka tylko z dala od brył i tam, gdzie przepływ jest prawie bezrozbieżny: w polu rozbieżnym
        // (strugi nawiewu, upusty, rozprężający się kłąb) korekta dorabiała masę — tam zostaje adwekcja półlagranżowska
        If(fwd.w.lessThan(0.01).and(vmF.w.lessThan(0.01)).and(abs(dvt).lessThan(F.macDiv)).and(float(F.mac).greaterThan(0.5)), () => {
          const back = vec4(0.0).toVar();
          back.assign(samp(this.denB, P.add(vmF.xyz.mul(dt))));
          const orig = vec4(0.0).toVar();
          orig.assign(samp(this.denA, P));
          const N = (dx, dy, dz) => samp(this.denA, P.add(vec3(dx * SH, dy * SH, dz * SH))).xyz;
          const n0 = vec3(0.0).toVar(); n0.assign(N(1, 0, 0));
          const n1 = vec3(0.0).toVar(); n1.assign(N(-1, 0, 0));
          const n2 = vec3(0.0).toVar(); n2.assign(N(0, 1, 0));
          const n3 = vec3(0.0).toVar(); n3.assign(N(0, -1, 0));
          const n4 = vec3(0.0).toVar(); n4.assign(N(0, 0, 1));
          const n5 = vec3(0.0).toVar(); n5.assign(N(0, 0, -1));
          const lo = min(min(min(orig.xyz, n0), min(n1, n2)), min(min(n3, n4), n5));
          const hi = max(max(max(orig.xyz, n0), max(n1, n2)), max(max(n3, n4), n5));
          a.assign(clamp(fwd.xyz.add(orig.xyz.sub(back.xyz).mul(0.5)), lo, hi));
        });
        const vol = float(0.0).toVar();
        const src = vec2(0.0).toVar();
        // źródła: plama (1 − d² / r²)² unormowana na CPU do masy rekordu
        Loop({ start: int(0), end: int(U.k.w.add(0.5)), type: 'int', condition: '<', name: 'gz' }, ({ gz }) => {
          const A = U.srcA.element(gz).toVar();
          const Bz = U.srcB.element(gz).toVar();
          const C = U.srcC.element(gz).toVar();
          const sd = vec3(0.0).toVar();
          sd.assign(P.sub(A.xyz));
          // plama wydłużona wzdłuż wypływu (gęstość w `C` już podzielona przez wydłużenie — masa = rekord)
          const s2 = float(0.0).toVar();
          s2.assign(max(dot(Bz.xyz, Bz.xyz), 1.0));
          const al = float(0.0).toVar();
          al.assign(dot(sd, Bz.xyz));
          const qq = float(0.0).toVar();
          qq.assign(clamp(float(1.0).sub(dot(sd, sd).sub(al.mul(al).mul(s2.sub(1.0)).div(s2.mul(s2))).div(max(A.w.mul(A.w), 1.0))), 0.0, 1.0));
          const sh = float(0.0).toVar();
          sh.assign(qq.mul(qq));
          const add = float(0.0).toVar();
          add.assign(C.x.add(C.y).mul(sh));
          a.z.addAssign(C.z.sub(a.z).mul(add.div(add.add(a.x).add(a.y).add(src.x).add(src.y).add(0.004))));
          src.addAssign(C.xy.mul(sh));
          vol.addAssign(C.w.mul(sh));
        });
        // zachowanie masy: adwekcja półlagranżowska nie rozrzedza gazu w polu rozbieżnym (źródła objętości, niedomknięty
        // rzut — bez tego rozprężanie mnożyło masę) — gęstość × 1 / (1 + dt · div v) z prędkości, która niosła gaz
        // (tylko rozrzedzanie: w polu zbieżnym — przy upustach i ścianach — gęstości nie zagęszczamy, tam gaz wychodzi)
        const thin = float(1.0).div(clamp(dvt, F.thinLo, 1.0).mul(F.thinOn).add(1.0));
        a.x.assign(a.x.mul(thin).add(src.x));
        a.y.assign(a.y.mul(thin).add(src.y));
        // stygnięcie (szybsze przy ścianie), zanik awaryjny
        const rho = float(0.0).toVar();
        rho.assign(length(P.xz));
        a.z.mulAssign(mix(exp(dt.negate().div(F.coolTau)), exp(dt.negate().div(F.coolWall)), step(GAZ.wallR - F.wallBand, rho)));
        // kąpiel grzeje gaz przy powierzchni bryły (lustro `gazBodyHeatCpu`)
        const hq = P.sub(U.body.xyz).div(vec3(max(U.body.w, 1.0), max(U.body2.x, 1.0), max(U.body.w, 1.0)));
        a.z.assign(max(a.z, float(1.0).sub(smoothstep(1.0, 1.0 + F.heatShell, length(hq))).mul(U.body3.z).mul(step(0.5, U.body.w))));
        // zanik: podstawowy + regulator masy (pole trzymane przy liczbie gazu z symulacji — `gazKrok.js`)
        a.x.mulAssign(U.k2.z);
        a.y.mulAssign(U.k2.z);
        // obmywanie bryły (czysty nawiew rozcieńcza gaz nad górną połową bryły) i dzwon ssawy (lokalny upust)
        const cl = vec2(0.0).toVar();
        cl.assign(vec2(mix(float(1.0), U.k2.y, washMask(P)), mix(float(1.0), U.bell.w, step(length(P.sub(vec3(U.bell.x, U.bell.y, 0.0))), F.bellR))));
        a.x.mulAssign(cl.x.mul(cl.y));
        a.y.mulAssign(cl.x.mul(cl.y));
        // strefy wentylacji: gaz wychodzi (ssanie) albo jest czysty (nawiew)
        a.mulAssign(mix(float(1.0), U.vent3.x, ringZone(P, rho)));
        a.mulAssign(mix(float(1.0), U.vent3.y, hoodZone(P)));
        out.assign(vec4(max(a, vec3(0.0)), vol));
      });
      const o3 = vec3(0.0).toVar();
      o3.assign(out.xyz);
      textureStore(this.denC, c.store, vec4(w16(o3, 3, 3), out.w));
    })().compute(this.scells).setName('gazSkalaryKorekta');

    // 4. Dywergencja × komórka z celem: źródła objętości (rozprężanie świeżego gazu), nawiew i odciąg. Sąsiad stały
    //    oddaje prędkość bryły (spadająca kula i rosnące lustro w leju wypychają gaz). Komórka stała: p = 0, flaga.
    this.kDyw = Fn(() => {
      const c = cellOf();
      const P = c.P;
      const vb = vec4(0.0).toVar();
      vb.assign(samp(this.velB, P));
      const V = (dx, dy, dz) => samp(this.velB, P.add(vec3(dx * H, dy * H, dz * H)));
      const div = V(1, 0, 0).x.sub(V(-1, 0, 0).x).add(V(0, 1, 0).y.sub(V(0, -1, 0).y)).add(V(0, 0, 1).z.sub(V(0, 0, -1).z)).mul(0.5);
      const rho = float(0.0).toVar();
      rho.assign(length(P.xz));
      const zone = ringZone(P, rho).mul(U.vent.x).add(hoodZone(P).mul(float(1.0).sub(ringZone(P, rho))).mul(U.vent.y));
      const rhs = div.sub(samp(this.denC, P).w).sub(zone);
      const q0 = samp(this.prsB, P).x;
      const gasK = float(1.0).sub(step(0.5, vb.w));
      textureStore(this.prsA, c.store, vec4(q0.mul(gasK), rhs.mul(gasK), float(1.0).sub(gasK), 0.0));
    })().compute(this.cells).setName('gazDywergencja');

    // 5. Jacobi: q = (Σ sąsiadów − prawa strona) / (6 + miękkość); sąsiad stały — NEUMANN (ciśnienie komórki).
    const jacobi = (src, dst, name) => Fn(() => {
      const c = cellOf();
      const P = c.P;
      const C0 = vec4(0.0).toVar();
      C0.assign(samp(src, P));
      const nb = (dx, dy, dz) => {
        const s = samp(src, P.add(vec3(dx * H, dy * H, dz * H)));
        return mix(s.x, C0.x, step(0.5, s.z));
      };
      const q = nb(1, 0, 0).add(nb(-1, 0, 0)).add(nb(0, 1, 0)).add(nb(0, -1, 0)).add(nb(0, 0, 1)).add(nb(0, 0, -1)).sub(C0.y).div(6 + F.soft);
      textureStore(dst, c.store, vec4(q.mul(float(1.0).sub(step(0.5, C0.z))), C0.y, C0.z, 0.0));
    })().compute(this.cells).setName(name);
    this.kJacAB = jacobi(this.prsA, this.prsB, 'gazJacobiAB');
    this.kJacBA = jacobi(this.prsB, this.prsA, 'gazJacobiBA');

    // 6. Rzut: v −= ∇q; komórka stała — prędkość bryły; przy ścianie bez wnikania (składowa ku bryle nie większa niż jej prędkość).
    this.kRzut = Fn(() => {
      const c = cellOf();
      const P = c.P;
      const vb = vec4(0.0).toVar();
      vb.assign(samp(this.velB, P));
      const C0 = vec4(0.0).toVar();
      C0.assign(samp(this.prsB, P));
      const S = (dx, dy, dz) => samp(this.prsB, P.add(vec3(dx * H, dy * H, dz * H)));
      const xp = vec4(0.0).toVar(); xp.assign(S(1, 0, 0));
      const xm = vec4(0.0).toVar(); xm.assign(S(-1, 0, 0));
      const yp = vec4(0.0).toVar(); yp.assign(S(0, 1, 0));
      const ym = vec4(0.0).toVar(); ym.assign(S(0, -1, 0));
      const zp = vec4(0.0).toVar(); zp.assign(S(0, 0, 1));
      const zm = vec4(0.0).toVar(); zm.assign(S(0, 0, -1));
      const nb = (s) => mix(s.x, C0.x, step(0.5, s.z));
      const v = vec3(0.0).toVar();
      v.assign(vb.xyz.sub(vec3(nb(xp).sub(nb(xm)), nb(yp).sub(nb(ym)), nb(zp).sub(nb(zm))).mul(0.5)));
      const walls = xp.z.add(xm.z).add(yp.z).add(ym.z).add(zp.z).add(zm.z);
      If(vb.w.lessThan(0.5).and(walls.greaterThan(0.5)), () => {
        const W = (dx, dy, dz) => samp(this.velB, P.add(vec3(dx * H, dy * H, dz * H)));
        const BIG = 1e5;
        v.x.assign(min(v.x, mix(float(BIG), W(1, 0, 0).x, step(0.5, xp.z))));
        v.x.assign(max(v.x, mix(float(-BIG), W(-1, 0, 0).x, step(0.5, xm.z))));
        v.y.assign(min(v.y, mix(float(BIG), W(0, 1, 0).y, step(0.5, yp.z))));
        v.y.assign(max(v.y, mix(float(-BIG), W(0, -1, 0).y, step(0.5, ym.z))));
        v.z.assign(min(v.z, mix(float(BIG), W(0, 0, 1).z, step(0.5, zp.z))));
        v.z.assign(max(v.z, mix(float(-BIG), W(0, 0, -1).z, step(0.5, zm.z))));
      });
      const gasK = float(1.0).sub(step(0.5, vb.w));
      textureStore(this.velA, c.store, vec4(mix(vb.xyz, w16(v, 4, 3), gasK), vb.w));
    })().compute(this.cells).setName('gazRzut');

    // 6b. Skalary do tekstury startowej następnego kroku; w komórce stałej zera; flaga stałej do kanału w.
    this.kPrzepisz = Fn(() => {
      const c = cellOfS();
      const fl = samp(this.velB, c.P).w;
      const gasK = float(1.0).sub(step(0.5, fl));
      textureStore(this.denA, c.store, vec4(samp(this.denC, c.P).xyz.mul(gasK), float(1.0).sub(gasK)));
    })().compute(this.scells).setName('gazPrzepisz');

    // 7. OBRAZ (raz na krok, per komórka): gaz NIE świeci — rozprasza światło kuli (albo masy w leju) i pasa
    //    wyświetlacza, i pochłania. Wynik: rgb = rozproszenie na jednostkę drogi, a = tłumienie [1/j.].
    const shadowN = this.preset.shadow | 0;
    const obraz = (dst, name) => Fn(() => {
      const c = cellOfS();
      const P = c.P;
      const D = vec4(0.0).toVar();
      D.assign(samp(this.denA, P));
      const rho = float(0.0).toVar();
      rho.assign(length(P.xz));
      const sg = vec2(0.0).toVar();
      sg.assign(sigmaOf(max(D.x, 0.0), max(D.y, 0.0), rho, P.y));
      const sd = float(0.0).toVar();
      sd.assign(sg.x);
      const so = float(0.0).toVar();
      so.assign(sg.y);
      const out = vec4(0.0).toVar();
      If(D.w.lessThan(0.5).and(sd.add(so).greaterThan(1e-6)), () => {
        // światło kuli / masy w leju: spadek R² / (d² + R²)
        const toL = vec3(0.0).toVar();
        toL.assign(U.light.xyz.sub(P));
        const d2 = float(0.0).toVar();
        d2.assign(dot(toL, toL));
        const R = float(0.0).toVar();
        R.assign(max(U.light.w.mul(U.look2.z), 1.0));
        const geo = R.mul(R).div(d2.add(R.mul(R)));
        const shade = float(1.0).toVar();
        if (shadowN > 0) {
          // cień własny promienisty: grubość optyczna gazu na drodze ku światłu (do powierzchni źródła)
          const dist = float(0.0).toVar();
          dist.assign(max(d2, 1.0).sqrt());
          const reach = float(0.0).toVar();
          reach.assign(clamp(dist.sub(U.light.w), 0.0, U.look2.y));
          const dir = vec3(0.0).toVar();
          dir.assign(toL.div(dist));
          const tau = float(0.0).toVar();
          Loop({ start: int(0), end: int(shadowN), type: 'int', condition: '<', name: 'gc' }, ({ gc }) => {
            const q = vec3(0.0).toVar();
            q.assign(P.add(dir.mul(reach.mul(float(gc).add(0.5).div(shadowN)))));
            const s = vec4(0.0).toVar();
            s.assign(samp(this.denA, q));
            const ss = sigmaOf(max(s.x, 0.0), max(s.y, 0.0), length(q.xz), q.y);
            tau.addAssign(ss.x.add(ss.y));
          });
          shade.assign(exp(tau.mul(reach.div(shadowN)).mul(U.look2.x).negate()));
        }
        // FUNKCJA FAZOWA światła kuli (Henyey-Greenstein, g = `look3.z`, zmieszana z rozpraszaniem równomiernym w
        // udziale `look3.w`; unormowana do 1 dla rozpraszania równomiernego): brzeg kłębu pod światło kuli jaśnieje
        // ciepło, kłąb oświetlony „od kamery” jest matowy
        const lp = vec3(0.0).toVar();
        lp.assign(P.sub(U.light.xyz).div(max(d2, 1.0).sqrt()));
        const ve = vec3(0.0).toVar();
        ve.assign(normalize(U.eye.sub(P)));
        const g = U.look3.z;
        const den = float(0.0).toVar();
        den.assign(max(g.mul(g).add(1.0).sub(g.mul(2.0).mul(dot(lp, ve))), 1e-3));
        const hg = float(1.0).sub(g.mul(g)).div(den.mul(den.sqrt()));
        const phase = mix(float(1.0), hg, U.look3.w);
        // wyświetlacz: światło robocze rosnące ku ścianie, najmocniejsze na wysokości pasa — chłodna barwa tylko
        // w pierścieniu przy ścianie; przy kuli gaz bierze barwę jej żaru (otoczenie przygaszone)
        const dy = float(0.0).toVar();
        dy.assign(P.y.sub(KOMORA.display.y).div(300.0));
        const wall = float(0.0).toVar();
        wall.assign(smoothstep(330.0, 440.0, rho));
        const dispF = rho.div(GAZ.wallR).mul(rho.div(GAZ.wallR)).div(dy.mul(dy).add(1.0)).mul(wall);
        // otoczenie z otwartej góry
        const sky = clamp(P.y.sub(FUN.throatY).div(GAZ.ceilY - FUN.throatY), 0.0, 1.0);
        // pasy światła w gardłach okapów (runda 6): cztery źródła na wlotach, spadek (R² / (d² + R²))² — światło zostaje
        // przy wlocie (pas jest wąski i świeci w głąb okapu), barwa żaru gazu w komorze bez zmian; gaz wciągany do
        // okapu jaśnieje w ich świetle (strugi do wlotów widać z kamery gry)
        const hoodLit = float(0.0).toVar();
        {
          const R2 = U.hoodL.w.mul(U.hoodL.w);
          let acc = null;
          for (const [cx, cz] of GAZ_HOOD_DIR) {
            const hd = P.sub(vec3(GAZ_HOOD_LAMP.rho * cx, GAZ_HOOD_LAMP.y, GAZ_HOOD_LAMP.rho * cz));
            const gq = R2.div(dot(hd, hd).add(R2));
            const gh = gq.mul(gq);
            acc = acc ? acc.add(gh) : gh;
          }
          hoodLit.assign(acc);
        }
        const Lin = vec3(0.0).toVar();
        Lin.assign(U.lightC.mul(geo.mul(shade).mul(phase).mul(U.look.y)).add(U.disp.mul(dispF.mul(U.look.z))).add(U.amb.mul(sky.mul(0.6).add(0.4).mul(U.look.w).mul(wall.mul(0.7).add(0.3)))).add(U.hoodL.xyz.mul(hoodLit)));
        out.assign(vec4(U.smoke.mul(sd).add(U.fume.mul(so)).mul(Lin).mul(U.look.x), sd.add(so)));
      });
      textureStore(dst, c.store, out);
    })().compute(this.scells).setName(name);
    this.kObrazA = obraz(this.obrA, 'gazObrazA');
    this.kObrazB = this.obrB ? obraz(this.obrB, 'gazObrazB') : null;

    // 8. MAPA KOLUMN (2D, x × z): ciepło (∫ T dy / 400 — drganie powietrza), grubość optyczna od błony do pierwszej
    //    bryły (przesłona z kamery z góry), masa dymu i oparów w kolumnie [t / 10⁶ j.² · j.].
    this.kKolumny = Fn(() => {
      const xi = int(instanceIndex.mod(uint(SNX))).toVar();
      const zi = int(instanceIndex.div(uint(SNX))).toVar();
      const heat = float(0.0).toVar();
      const tau = float(0.0).toVar();
      const md = float(0.0).toVar();
      const mo = float(0.0).toVar();
      const state = float(0.0).toVar();       // 0 — nad gazem (błona), 1 — w gazie, 2 — za pierwszą bryłą
      Loop({ start: int(0), end: int(SNY), type: 'int', condition: '<', name: 'gk' }, ({ gk }) => {
        const yi = int(SNY - 1).sub(gk);
        const D = vec4(0.0).toVar();
        D.assign(texture3D(this.denA, vec3(float(xi).add(0.5).div(SNX), float(yi).add(0.5).div(SNY), float(zi).add(0.5).div(SNZ))).level(0));
        const gas = float(1.0).sub(step(0.5, D.w));
        // pierwsza komórka gazu otwiera kolumnę, pierwsza stała po niej ją zamyka
        state.assign(max(state, gas.mul(step(state, 0.5))));
        state.assign(max(state, float(1.0).sub(gas).mul(step(0.5, state)).mul(2.0)));
        const open = step(0.5, state).mul(step(state, 1.5)).mul(gas);
        const sk = sigmaOf(max(D.x, 0.0), max(D.y, 0.0), length(vec2(float(xi).add(0.5).mul(SH).add(GAZ.x0), float(zi).add(0.5).mul(SH).add(GAZ.z0))), float(yi).add(0.5).mul(SH).add(GAZ.y0));
        tau.addAssign(sk.x.add(sk.y).mul(SH).mul(open));
        heat.addAssign(D.z.mul(SH / 400).mul(open));
        md.addAssign(max(D.x, 0.0).mul(gas));
        mo.addAssign(max(D.y, 0.0).mul(gas));
      });
      textureStore(this.kol, uvec2(uint(xi), uint(zi)), vec4(heat, tau, md, mo));
    })().compute(this.cols).setName('gazKolumny');

    // SONDA (harness): mapa kolumn do bufora (odczyt na CPU).
    this.kSonda = Fn(() => {
      const xi = float(instanceIndex.mod(uint(SNX))).add(0.5).div(SNX);
      const zi = float(instanceIndex.div(uint(SNX))).add(0.5).div(SNZ);
      this._probeBuf.element(instanceIndex).assign(texture(this.kol, vec2(xi, zi)).level(0));
    })().compute(this.cols).setName('gazSonda');

    // ZEROWANIE (start, uśpienie): osobny kernel na teksturę.
    const zero3 = (tex, name, fine) => Fn(() => {
      const c = fine ? cellOfS() : cellOf();
      textureStore(tex, c.store, vec4(0.0));
    })().compute(fine ? this.scells : this.cells).setName(name);
    this.kZero = [zero3(this.velA, 'gazZerujVelA', false), zero3(this.denA, 'gazZerujDenA', true), zero3(this.prsB, 'gazZerujPrsB', false), zero3(this.obrA, 'gazZerujObrA', true)];
    if (this.obrB) this.kZero.push(zero3(this.obrB, 'gazZerujObrB', true));

    /** Wszystkie kernele z teksturą pisaną i czytanymi (strażnik w teście, rozgrzewka). */
    this.kernels = [
      { node: this.kWiry, writes: this.wir, reads: [this.velA] },
      { node: this.kPredkosc, writes: this.velB, reads: [this.velA, this.denA, this.wir] },
      { node: this.kPrzod, writes: this.denB, reads: [this.velA, this.denA] },
      { node: this.kKorekta, writes: this.denC, reads: [this.velA, this.denA, this.denB] },
      { node: this.kDyw, writes: this.prsA, reads: [this.velB, this.denC, this.prsB] },
      { node: this.kJacAB, writes: this.prsB, reads: [this.prsA] },
      { node: this.kJacBA, writes: this.prsA, reads: [this.prsB] },
      { node: this.kRzut, writes: this.velA, reads: [this.velB, this.prsB] },
      { node: this.kPrzepisz, writes: this.denA, reads: [this.denC, this.velB] },
      { node: this.kObrazA, writes: this.obrA, reads: [this.denA] },
      ...(this.kObrazB ? [{ node: this.kObrazB, writes: this.obrB, reads: [this.denA] }] : []),
      { node: this.kKolumny, writes: this.kol, reads: [this.denA] },
      { node: this.kSonda, writes: null, reads: [this.kol] },
      ...this.kZero.map((node, i) => ({ node, writes: [this.velA, this.denA, this.prsB, this.obrA, this.obrB][i], reads: [] }))
    ];
    // lista kroku: stała tablica (bez alokacji w biegu); miejsce kernela obrazu podmieniane na zmianę
    const L = [this.kWiry, this.kPredkosc, this.kPrzod, this.kKorekta, this.kDyw];
    for (let i = 0; i < this.preset.jacobi; i++) L.push(i % 2 === 0 ? this.kJacAB : this.kJacBA);
    L.push(this.kRzut, this.kPrzepisz);
    this._imageAt = L.length;
    L.push(this.kObrazA, this.kKolumny);
    this._list = L;
    this._listImage = [this.kObrazA, this.kKolumny];
  }

  // --- krok ----------------------------------------------------------------------

  /**
   * Uniformy kroku z wejścia `inp` (`GAZ_IN`): współczynniki na krok, bryły, wentylacja, światło, masa w leju, źródła
   * (plamy przesunięte wzdłuż kierunku wypływu poza bryłę i nie mniejsze niż `srcMinCells` komórek; gęstość
   * unormowana do masy rekordu).
   */
  setInput(inp) {
    const U = this.U;
    const F = this.F;
    const I = GAZ_IN;
    const H = this.cell;
    const dt = inp[I.dt] > 0 ? inp[I.dt] : 1 / 60;
    let n = 0;
    const A = U.srcA.array;
    const B = U.srcB.array;
    const C = U.srcC.array;
    let nImpact = 0;
    for (let q = 0; q < GAZ_SLOTS; q++) {
      const o = I.src + q * GAZ_STRIDE;
      const td = inp[o + GAZ_SRC.dym];
      const to = inp[o + GAZ_SRC.opar];
      if (!(td + to > 0) || !(inp[o + GAZ_SRC.radius] > 0)) continue;
      if (inp[o + GAZ_SRC.kind] === GAZ_RODZAJ.UDERZENIE) { nImpact++; continue; }
      // środek plamy wysunięty wzdłuż wypływu i wypchnięty z bryły środkowej: plama leży w gazie
      const r = gazSourceCenterCpu(inp, o, this.srcCell, this._srcP);
      const st = gazSourceStretch(inp[o + GAZ_SRC.kind]);
      A[n].set(this._srcP[0], this._srcP[1], this._srcP[2], r);
      B[n].set(inp[o + GAZ_SRC.dx] * st, inp[o + GAZ_SRC.dy] * st, inp[o + GAZ_SRC.dz] * st, inp[o + GAZ_SRC.speed] * (GAZ_SRC_SPEED[inp[o + GAZ_SRC.kind] | 0] || 1));
      const norm = 1e6 * 105 / (32 * Math.PI * r * r * r) / st;
      C[n].set(td * norm, to * norm, inp[o + GAZ_SRC.temp], (td + to) * F.volPerTon * norm / dt * H);
      n++;
    }
    // KŁĄB UDERZENIA (runda 5, poprawki): rekordy linii styku masy ze stożkiem rozkładane CIĄGLE wzdłuż tej linii —
    // każdy rekord (odcinek 1/5 obwodu) na kilka plam w równych odstępach z przesunięciem kąta i wagami ±40 %
    // (skrót z numeru kroku — powtarzalnie, bez `Math.random`); kierunek każdej plamy po stożku w górę i na zewnątrz
    // w jej azymucie. Masa = rekord. Powstaje poszarpany wał pary pchany przez masę, nie punktowe kłęby.
    if (nImpact > 0) {
      const sub = Math.max(1, Math.min(GAZ_IMPACT_SUB, Math.floor((GAZ_SLOTS - n) / nImpact)));
      const seed = this._impactSeed = (this._impactSeed + 1) >>> 0;
      const st = gazSourceStretch(GAZ_RODZAJ.UDERZENIE);
      for (let q = 0; q < GAZ_SLOTS && n + sub <= GAZ_SLOTS; q++) {
        const o = I.src + q * GAZ_STRIDE;
        const td = inp[o + GAZ_SRC.dym];
        const to = inp[o + GAZ_SRC.opar];
        if (!(td + to > 0) || !(inp[o + GAZ_SRC.radius] > 0) || inp[o + GAZ_SRC.kind] !== GAZ_RODZAJ.UDERZENIE) continue;
        const x0 = inp[o + GAZ_SRC.x];
        const z0 = inp[o + GAZ_SRC.z];
        const rr = Math.sqrt(x0 * x0 + z0 * z0);
        const a0 = Math.atan2(z0, x0);
        const dh = Math.sqrt(inp[o + GAZ_SRC.dx] * inp[o + GAZ_SRC.dx] + inp[o + GAZ_SRC.dz] * inp[o + GAZ_SRC.dz]);
        const dyv = inp[o + GAZ_SRC.dy];
        const span = 2 * Math.PI / GAZ_SLOT.impactN;
        const r = Math.max(inp[o + GAZ_SRC.radius] * 0.8, GAZ_FIZ.srcMinCells * this.srcCell);
        let wsum = 0;
        for (let k = 0; k < sub; k++) wsum += (this._w[k] = 0.6 + 0.8 * hash01(seed * 31 + q * 7 + k));
        for (let k = 0; k < sub; k++) {
          // kąt losowany w każdym kroku w swojej części odcinka: przez 0,5 s wypływu plamy wypełniają całą linię styku
          const a = a0 + span * ((k + hash01(seed * 17 + q * 11 + k * 3 + 1)) / sub - 0.5);
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const ux = ca * dh;
          const uz = sa * dh;
          const L = 0.55 * r * st;
          A[n].set(ca * rr + ux * L, inp[o + GAZ_SRC.y] + dyv * L, sa * rr + uz * L, r);
          B[n].set(ux * st, dyv * st, uz * st, inp[o + GAZ_SRC.speed] * (0.85 + 0.3 * this._w[k] / (wsum / sub) * 0.5));
          const f = this._w[k] / wsum;
          const norm = 1e6 * 105 / (32 * Math.PI * r * r * r) / st;
          C[n].set(td * f * norm, to * f * norm, inp[o + GAZ_SRC.temp], (td + to) * f * F.volPerTon * norm / dt * H);
          n++;
        }
      }
    }
    U.k.value.set(1 - Math.exp(-F.swirlRate * inp[I.pole] * dt), inp[I.grav], dt, n);
    U.body.value.set(inp[I.bodyX], inp[I.bodyY], inp[I.bodyZ], inp[I.bodyRx]);
    U.body2.value.set(inp[I.bodyRy], inp[I.bodyVx], inp[I.bodyVy], inp[I.bodyVz]);
    U.body3.value.set(inp[I.bodyOm], inp[I.time] % 4096, inp[I.bodyT], 0);
    const washOn = inp[I.bodyRx] > 0.5 ? Math.max(0, Math.min(1, inp[I.wentyl])) : 0;
    // CYKL ODCIĄGU (runda 6): narastanie / ciąg 0…1 z siły ciągu (`draw`); w narastaniu obmywanie bryły sięga tylko
    // `pulseWash` poza kulę — gaz wolno zajść na brzeg kuli, środek tarczy dalej obmywa nawiew
    gazPulseOf(inp[I.draw], this._pulse);
    const nar = this._pulse[0];
    const ciag = this._pulse[1];
    const washR = F.washR + (F.pulseWash - F.washR) * nar;
    U.k2.value.set((1 - Math.exp(-F.washRate * dt)) * washOn, Math.exp(-F.washClear * washOn * dt), Math.exp(-(F.decay * this.removalK + this.extraDecay) * dt), washR);
    const bellOn = Math.max(0, Math.min(1, inp[I.bellOn]));
    U.bell.value.set(inp[I.bellX], inp[I.bellY], (1 - Math.exp(-F.bellRate * dt)) * bellOn, Math.exp(-F.bellFlush * bellOn * dt));
    U.coil.value.set(inp[I.cageX], inp[I.cageY], inp[I.cageZ], inp[I.coilR]);
    U.coil2.value.set(inp[I.coilY], Math.exp(-F.coilDamp * dt), 0, 0);
    // wentylacja: źródło objętości na komórkę strefy (× komórka), prędkości i współczynniki na krok
    const qRing = inp[I.qRing];
    // drożność okapów (żaluzje przymknięte przed zrzutem): upust skalarów przy ssaniu dławiony
    const hoodK = inp[I.hood] > 0 ? Math.min(1, inp[I.hood]) : 1;      // 0 — wejście bez pola (testy): okapy drożne
    const qHood = inp[I.qHood];
    const cv = H * H * H;
    const ringS = this.zones.ring > 0 ? qRing / (this.zones.ring * cv) * H : 0;
    const hoodS = this.zones.hood > 0 ? qHood / (this.zones.hood * cv) * H : 0;
    const ringU = -qRing / (2 * Math.PI * GAZ.wallR * 2 * gazRingHalf(H));
    const q1 = qHood / GAZ_HOOD_DIR.length;
    U.vent.value.set(ringS, hoodS, Math.max(-F.vMax, Math.min(F.vMax, ringU)), q1);
    const kq = 1 - Math.exp(-F.ventFlush * dt);
    const hr = gazHoodR(H);
    const uBlow = Math.min(0.75 * F.vMax, Math.abs(q1) / (2 * Math.PI * hr * hr));
    // ciąg: zasięg i tempo dociągania do okapów rosną, profil ujścia w warstwie (strugi zbiegające się do wlotów)
    const pullRate = GAZ_WENT.hood.pullRate * (1 + (F.pulseRate - 1) * ciag);
    U.vent2.value.set(q1 < 0 ? 1 - Math.exp(-pullRate * dt) : 0, q1 > 0 ? kq : 0, uBlow, kq * Math.min(1, Math.abs(qRing) / (0.25 * F.q0)));
    U.vent3.value.set(
      Math.exp(-F.ventFlush * Math.min(1, Math.abs(qRing) / (0.25 * F.q0)) * dt),
      Math.exp(-F.ventFlush * Math.min(1, Math.abs(qHood) / (0.25 * F.q0)) * (qHood < 0 ? hoodK : 1) * dt),
      GAZ_WENT.hood.pull + (F.pulsePull - GAZ_WENT.hood.pull) * ciag,
      ciag > 0 ? F.pulseLayer / ciag : 1e7
    );
    // w cyklu odciągu pierścień widocznego gazu (look4) zaczyna się tuż za kulą, nie przy ścianie: gaz narastający
    // wokół kuli i strugi do okapów mają kontrast pierścienia; poza cyklem — jak w rundzie 5
    {
      const L = this.look;
      // obwiednia cyklu z pamięcią (przejście narastanie → ciąg mija siłę ciągu 1 — strefa nie może wtedy mrugnąć)
      this._env = Math.max(nar, ciag, this._env * Math.exp(-dt / 0.8));
      const env = this._env;
      // (półoś bryły pola jest o 4 % mniejsza od rysowanej — `GAZ_BODY_SHRINK`; zapas wchodzi w `pulseLook`)
      const R = inp[I.bodyRx] > 0.5 ? inp[I.bodyRx] : 0;
      const r0 = R > 0 ? Math.min(L.ringR0, R + F.pulseLook) : L.ringR0;
      const a = L.ringR0 + (r0 - L.ringR0) * env;
      const b = L.ringR1 + (Math.min(L.ringR1, a + 80) - L.ringR1) * env;
      U.look4.value.set(L.ringRef, L.ringSigma, a, Math.max(a + 20, b));
    }
    U.light.value.set(inp[I.lightX], inp[I.lightY], inp[I.lightZ], inp[I.lightR]);
    U.lightC.value.set(inp[I.lightCr], inp[I.lightCg], inp[I.lightCb]);
    U.disp.value.set(inp[I.dispR], inp[I.dispG], inp[I.dispB]);
    {
      const g = Math.max(0, Math.min(1, inp[I.hoodGlow] || 0)) * this.look.hoodGain;
      U.hoodL.value.set(GAZ_HOOD_LIGHT[0] * g, GAZ_HOOD_LIGHT[1] * g, GAZ_HOOD_LIGHT[2] * g, this.look.hoodR);
    }
    const lk = U.lake.array;
    for (let j = 0; j < GAZ_LAKE_N; j++) lk[j].set(inp[I.lake + j * 2], inp[I.lake + j * 2 + 1], 0, 0);
  }

  /** Jeden krok pola z wejścia (kernele w jednym `renderer.compute`). Zwraca liczbę dispatchy. */
  step(renderer, inp) {
    this.setInput(inp);
    this._seed = (this._seed + 1) >>> 0;
    this.U.seed.value = this._seed;
    ensureHalfRoundingProbe(renderer);
    if (this.kObrazB) {
      this.flip ^= 1;
      this._list[this._imageAt] = this.flip ? this.kObrazB : this.kObrazA;
    }
    renderer.compute(this._list);
    this.steps++;
    return this._list.length;
  }

  /** Sam obraz i mapa kolumn z bieżącego stanu (po zmianie światła albo wyglądu — bez kroku fizyki). */
  relight(renderer, inp = null) {
    if (inp) this.setInput(inp);
    this._listImage[0] = this.kObrazB && this.flip ? this.kObrazB : this.kObrazA;
    renderer.compute(this._listImage);
  }

  /** Pole wyzerowane (start, uśpienie). */
  clear(renderer) {
    renderer.compute(this.kZero);
  }

  /**
   * Rozgrzewka: puste dispatche WSZYSTKICH kerneli (obie odmiany Jacobiego i obrazu, mapa kolumn, sonda, zerowanie) —
   * pipeline compute three r183 powstaje synchronicznie przy pierwszym dispatchu. Stan po rozgrzewce: zera.
   */
  warm(renderer) {
    ensureHalfRoundingProbe(renderer);
    renderer.compute(this.kZero);
    const all = [this.kWiry, this.kPredkosc, this.kPrzod, this.kKorekta, this.kDyw, this.kJacAB, this.kJacBA, this.kRzut, this.kPrzepisz, this.kObrazA];
    if (this.kObrazB) all.push(this.kObrazB);
    all.push(this.kKolumny, this.kSonda);
    renderer.compute(all);
    renderer.compute(this.kZero);
    this.flip = 0;
  }

  /**
   * SONDA (harness): mapa kolumn z GPU → { nx, nz, cell, data: Float32Array(nx · nz · 4) } — na komórkę planu: ciepło,
   * grubość optyczna od błony do pierwszej bryły, suma gęstości dymu i oparów po wysokości.
   */
  async probe(renderer) {
    renderer.compute(this.kSonda);
    const data = new Float32Array(await renderer.getArrayBufferAsync(this._probeBuf.value));
    return { nx: this.snx, nz: this.snz, cell: this.scell, data };
  }

  /** Masa pola [t] z odczytu sondy (dym + opar). */
  massOf(data) {
    let s = 0;
    for (let i = 0; i < this.cols; i++) s += data[i * 4 + 2] + data[i * 4 + 3];
    return s * this.scell * this.scell * this.scell / 1e6;
  }

  dispose() {
    for (const t of [this.velA, this.velB, this.denA, this.denB, this.denC, this.prsA, this.prsB, this.wir, this.obrA, this.obrB, this.kol]) if (t) t.dispose();
  }
}
