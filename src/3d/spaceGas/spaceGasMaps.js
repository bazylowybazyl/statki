// src/3d/spaceGas/spaceGasMaps.js
//
// MAPY GAZU W PRZESTRZENI (docs/PLAN-gazy-kosmos.md GK-3): compute do tekstur storage o STAŁYM rozmiarze (z presetu —
// bez zmiany rozmiaru przy zmianie okna, omija pułapkę resize celów), raz na klatkę w kroku Core3D.fx:
//   • MAPA GAZU (kadr z zapasem): gęstość kolumny × albedo gazów sceny (rgb) i gęstość całkowita (a) — z pola
//     (dwie tekstury kroków, przenikanie wg ułamka kroku, każda z własnym rogiem okna; próbka dwusześcienna — siatka 64 j.
//     w próbce dwuliniowej dawała schodki na brzegach ławic), kolumna nad bryłą z gazu otoczenia (okręt nie „wybija”
//     mgły nad sobą), poza oknem i przy jego brzegu — pole dalekie; × faktura detalu na pozycjach spoczynkowych
//     (jedzie z gazem), wygaszana, gdy teksel mapy przerasta jej skalę;
//   • MAPA ŚWIATŁA: przepuszczalność ku Słońcu — marsz po mapie gazu odcinkami (każdy odcinek uśredniony dwiema
//     próbkami — bez schodków cienia), samocień: gaz od strony Słońca jasny, w głębi ciemny.
// Mapy czyta warstwa (spaceGasLayer.js) — w kamerze z góry jedna próbka na teksel.

import * as THREE from 'three/webgpu';
import { Fn, If, Loop, Return, float, int, ivec2, vec2, vec4, uniform, instanceIndex, textureStore, texture, mix, smoothstep, min, max, floor, exp } from 'three/tsl';
import { SPACE_GAS_MAP_MARGIN, SPACE_GAS_WINDOW_EDGE } from './spaceGasLayout.js';
import { SPACE_GAS_DETAIL_LOD_OLD } from './spaceGasBelt.js';

/**
 * PRÓBKI NA TEKSEL MAPY GAZU (2026-10-29, „przy oddaleniu gazy drżą”, „drżą przy zoomie”): mapa ma stałą liczbę tekseli,
 * więc przy oddaleniu teksel (76 / 117 / 215 j. w osi x przy zoomie 0,1 / 0,0667 / 0,035 na 5120 × 1440 z mapą 768 × 432;
 * mapa w proporcjach kadru 1086 × 306 — 54 / 83 / 152 j.) dorasta do komórki pola (64 j.) i ją przerasta, a progi pola
 * dalekiego (smoothstep na fbm do 250–325 j.) i grzbiety faktury (110–160 j.) mają ledwie kilka tekseli — jedna próbka
 * w środku teksla to aliasing: gaz płynący przez siatkę tekseli „gotuje się”, brzegi przeskakują od teksla do teksla, a każdy
 * stopień drabiny przestawia cały wzór. Kilka próbek w tekslu (średnia — filtr pudełkowy teksla) daje obraz, do którego
 * dąży gęstsza mapa: ta sama średnia jasność, bez wzoru aliasingu. Teksel ≤ `taps[0]` — jedna próbka (zbliżenie bit w bit
 * jak dawniej), do `taps[1]` — 2 próbki wzdłuż dłuższego boku, dalej 4 (siatka obrócona). Przesunięcia [teksle]:
 * lustro wzoru kernela (testy, sonda). DOMYŚLNIE JEDNA PRÓBKA (SpaceGas.tune.mapTaps 1, pomiar w grze 2026-10-30: drżenie
 * przy zoomie i oddaleniu zbija odświeżanie macierzy w kroku, próbki go nie zmieniają — 4 kosztowały +0,48 ms compute przy
 * największym oddaleniu); 2 / 4 — A/B na żywo.
 */
export function spaceGasMapTapOffsets(taps) {
  if (taps >= 4) return [[-0.375, -0.125], [0.125, -0.375], [-0.125, 0.375], [0.375, 0.125]];
  if (taps >= 2) return [[-0.25, -0.125], [0.25, 0.125]];
  return [[0, 0]];
}
/** Liczba próbek na teksel z boku teksla [j.] (największy z osi) — progi [2 próbki od, 4 od], najwięcej `max`. */
export function spaceGasMapTaps(texel, max, at) {
  if (max >= 4 && texel > at[1]) return 4;
  if (max >= 2 && texel > at[0]) return 2;
  return 1;
}

/**
 * DRABINA TEKSLA map (2026-10-29, „gazy i mgła mocno drżą”): bok teksla = 2^(j / STEPS) [j.], stopień j z histerezą.
 * Teksel liczony wprost z kadru zmieniał się przy KAŻDEJ zmianie zoomu (kółko, sprężyna zoomu, reżyser kadru, kop
 * hipercruise'u, obrót kadru), a siatka tekseli jest liczona od kotwicy (pas: Słońce, ~76 tys. tekseli od kamery) —
 * |Δzoom / zoom| ≈ 7·10⁻⁶ na klatkę przesuwało próbkowanie o pół teksla (100% klatek z ruchem zoomu), gaz „gotował się”
 * o ±½ teksla (±3,6 px na 5120 px). Na drabinie siatka stoi w świecie przez cały stopień (~9% zoomu), przeskok tylko
 * na stopniu; mapa pokrywa kadr × 1,08…1,21 (teksel najwyżej ~12% grubszy niż wprost z kadru).
 */
export const SPACE_GAS_TEXEL_STEPS = 8;
/** Histereza zejścia stopień niżej (mniejszy teksel dopiero, gdy potrzebny jest o tyle mniejszy). */
export const SPACE_GAS_TEXEL_HYST = 1.03;

/** Stopień drabiny dla potrzebnego teksla `need` przy obecnym `j` (NaN — start): w górę od razu, w dół z histerezą. */
export function spaceGasTexelLevel(j, need) {
  const S = SPACE_GAS_TEXEL_STEPS;
  const up = Math.ceil(Math.log2(need) * S - 1e-9);
  if (!(j >= up)) return up;
  if (need * SPACE_GAS_TEXEL_HYST < 2 ** ((j - 1) / S)) return Math.ceil(Math.log2(need * SPACE_GAS_TEXEL_HYST) * S - 1e-9);
  return j;
}

/** Odcinki marszu ku Słońcu [j.] (dema: SHADOW_STEPS). */
const SHADOW_STEPS = [60, 140, 250, 400, 600, 860, 1200, 1650, 2200];
/** Grubość warstwy gazu [j.] (dema: SLAB — z ∈ [−SLAB, SLAB]). */
export const SPACE_GAS_SLAB = 420;

function mapTexture(w, h, name) {
  const t = new THREE.StorageTexture(w, h);
  t.type = THREE.HalfFloatType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.name = name;
  return t;
}

// Próbka dwusześcienna (B-spline) tekstury N × N z 4 odczytów z filtrem liniowym (Sigg i Hadwiger) — dema: cubicTex.
function cubicTex(tex, uv, N) {
  const st = uv.mul(N).sub(0.5).toVar();
  const i = floor(st).toVar();
  const f = st.sub(i).toVar();
  const f2 = f.mul(f);
  const f3 = f2.mul(f);
  const w0 = f3.negate().add(f2.mul(3.0)).sub(f.mul(3.0)).add(1.0).div(6.0).toVar();
  const w1 = f3.mul(3.0).sub(f2.mul(6.0)).add(4.0).div(6.0).toVar();
  const w2 = f3.mul(-3.0).add(f2.mul(3.0)).add(f.mul(3.0)).add(1.0).div(6.0).toVar();
  const w3 = f3.div(6.0).toVar();
  const g0 = w0.add(w1).toVar();
  const g1 = w2.add(w3).toVar();
  const h0 = i.sub(0.5).add(w1.div(g0)).div(N).toVar();
  const h1 = i.add(1.5).add(w3.div(g1)).div(N).toVar();
  const a = texture(tex, vec2(h0.x, h0.y)).level(0);
  const b = texture(tex, vec2(h1.x, h0.y)).level(0);
  const c = texture(tex, vec2(h0.x, h1.y)).level(0);
  const d = texture(tex, vec2(h1.x, h1.y)).level(0);
  return mix(mix(a, b, g1.x), mix(c, d, g1.x), g1.y);
}

export class SpaceGasMaps {
  /**
   * @param {import('./spaceGasSim.js').SpaceGasSim} sim
   * @param {object} scene scena (farEnv, detail, U)
   * @param {object} o w, h — rozmiar map [teksle]; lodW, lodH — mapa BAZOWA do zaniku faktury (domyślnie w × h)
   */
  constructor(sim, scene, { w = 768, h = 432, name = 'spaceGasMap', lodW = w, lodH = h } = {}) {
    this.sim = sim;
    this.scene = scene;
    this.w = w;
    this.h = h;
    // ZANIK FAKTURY Z MAPY BAZOWEJ (przegląd 2026-10-30): teksel zaniku (`U.lodTexel`) z geometrii mapy bazowej
    // (SpaceGas.tune.mapW × mapH, 768 × 432) przy każdym rozmiarze mapy — mapa w proporcjach kadru (1086 × 306 na 32:9)
    // liczona z własnego rozmiaru przesuwała zanik (lod przy minZoom 0,819 → 0,392: przy oddaleniu więcej włókien faktury),
    // a połowa podzielonego ekranu 16:9 z mapą z kadru 32:9 — w drugą stronę. Rozmiar mapy zmienia tylko teksel obrazu.
    this.lodW = lodW > 0 ? lodW : w;
    this.lodH = lodH > 0 ? lodH : h;
    this.gasTex = mapTexture(w, h, `${name}Gas`);
    this.lightTex = mapTexture(w, h, `${name}Light`);
    // A/B: ladder = false — teksel wprost z kadru (dawniej: przepróbkowanie przy każdej zmianie zoomu)
    this.ladder = true;
    this._lvl = [NaN, NaN];
    // hak pomiarowy (?dev, narzędzia): stopień drabiny + levelBias — wymusza przeskok teksla przy stałym zoomie (+1:
    // teksel o 9% większy, mapa dalej pokrywa kadr; ujemny może odsłonić brzeg kadru)
    this.levelBias = 0;
    // próbki na teksel (spaceGasMapTaps): najwięcej `taps` (1 — dawniej: jedna próbka w środku teksla), progi boku
    // teksla [j.] dla 2 i 4 próbek
    this.taps = 1;
    this.tapsAt = [64, 150];
    this.U = {
      live: uniform(1),
      min: uniform(new THREE.Vector2()),       // róg mapy [j., względem kotwicy]
      texel: uniform(new THREE.Vector2(1, 1)), // bok teksla [j.]
      imgO0: uniform(new THREE.Vector2()),     // róg okna tekstury kroku 0 / 1
      imgO1: uniform(new THREE.Vector2()),
      w1: uniform(0),                          // waga tekstury 1 w przenikaniu
      simOn: uniform(1),                       // 0 — samo pole dalekie (A/B: ruch gazu wył.)
      amount: uniform(1),                      // gęstość gazu (strojenie)
      sunDir: uniform(new THREE.Vector2(1, 0)),// ku Słońcu (świat gry)
      lodLo: uniform(60),                      // teksel mapy [j.], od którego faktura gaśnie …
      lodHi: uniform(260),                     // … do zera
      lodTexel: uniform(1),                    // teksel do zaniku faktury: wprost z kadru (ciągły — bez skoku na stopniu drabiny)
                                               // przy mapie bazowej lodW × lodH (ten sam zanik przy każdym rozmiarze mapy)
      // wygaszona faktura → te wartości: domyślnie dawne cele (SPACE_GAS_DETAIL_LOD_OLD — barwa „oddycha” przy zoomie
      // w zakresie zaniku), SpaceGas.tune.lodMean — średnie kanałów faktury (spaceGasBelt.js SPACE_GAS_DETAIL_LOD_MEAN;
      // zmienia barwę gazu przy oddaleniu — czeka na decyzję użytkownika)
      lodTarget: uniform(new THREE.Vector4(...SPACE_GAS_DETAIL_LOD_OLD)),
      taps: uniform(1, 'int'),                 // próbki na teksel (1 / 2 / 4)
      tap4: uniform(0),                        // 1 — wzór 4 próbek
      tapOn: uniform(0),                       // 0 — jedna próbka w środku teksla
      alb1: uniform(new THREE.Vector3(1, 1, 1)),
      alb2: uniform(new THREE.Vector3(1, 1, 1)),
      alb3: uniform(new THREE.Vector3(1, 1, 1)),
      ejecta: uniform(new THREE.Vector3(0.5, 0.45, 0.4))
    };
    this._build();
  }

  _build() {
    const sim = this.sim, scene = this.scene, U = this.U, W = this.w, H = this.h;
    const N = sim.N, C = sim.cell, SW = N * C;
    const SU = sim.U;
    const sum4 = (v) => v.x.add(v.y).add(v.z).add(v.w);
    const texel = () => {
      If(U.live.lessThan(0.5), () => { Return(); });
      const id = int(instanceIndex).toVar();
      // KONIEC SIATKI WĄTKÓW: three r183 puszcza ceil(W · H / 64) grup po 64 wątki, a WGSL nie sprawdza liczby — mapa,
      // której W · H nie dzieli się przez 64 (w proporcjach kadru: 32:9 — 1086 × 306 = 332 316, 36 wątków ponad), pisałaby
      // nadmiarowymi wątkami wiersz j = H (poza teksturą: WGSL pozwala zapis odrzucić albo oddać innemu tekselowi, np.
      // przyciąć na ostatni wiersz — wyścig z jego właściwym wątkiem)
      If(id.greaterThanEqual(int(W * H)), () => { Return(); });
      const i = id.mod(int(W)).toVar();
      const j = id.div(int(W)).toVar();
      const p = U.min.add(vec2(float(i).add(0.5), float(j).add(0.5)).mul(U.texel)).toVar();
      return { i, j, p };
    };
    // pole w punkcie p z tekstury kroku k: gęstość (dwusześciennie), faktura / stała, waga okna (brzeg łagodnie — pas
    // SPACE_GAS_WINDOW_EDGE boku okna; gra trzyma go poza mapą kadru, gdy wnętrze okna ją obejmuje: placeGasWindow)
    const fieldAt = (k, p) => {
      const suv = p.sub(k ? U.imgO1 : U.imgO0).div(SW).toVar();
      const edge = min(min(suv.x, suv.y), min(suv.x.oneMinus(), suv.y.oneMinus()));
      const kw = smoothstep(0.0, SPACE_GAS_WINDOW_EDGE, edge).toVar();
      const rt = texture(sim.restTex[k], suv).level(0).toVar();
      const dn = cubicTex(sim.denTex[k], suv, N).toVar();
      // kolumna nad bryłą: gaz otoczenia (średnia 8 próbek na promieniu 5 komórek, tylko z komórek gazu)
      If(rt.z.greaterThan(0.02), () => {
        const s = vec4(0).toVar();
        const ws = float(0).toVar();
        for (let a = 0; a < 8; a++) {
          const o = vec2(Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)).mul(5 / N);
          const w = float(1.0).sub(texture(sim.restTex[k], suv.add(o)).level(0).z);
          s.addAssign(texture(sim.denTex[k], suv.add(o)).level(0).mul(w));
          ws.addAssign(w);
        }
        dn.assign(mix(dn, s.div(max(ws, 1e-3)), rt.z.min(1.0)));
      });
      return { dn, off: rt.xy, kw };
    };

    // Próbki w tekslu (spaceGasMapTapOffsets — lustro): pętla do U.taps, przesunięcie z numeru próbki k — 2 próbki:
    // ±(¼, ⅛) teksla, 4: siatka obrócona (±⅜, ±⅛); jedna próbka (U.tapOn 0) — środek teksla, dawny wynik.
    this.kGas = Fn(() => {
      const t = texel();
      const lod = smoothstep(U.lodLo, U.lodHi, U.lodTexel).toVar();
      const acc = vec4(0).toVar();
      Loop({ start: int(0), end: U.taps, type: 'int', condition: '<', name: 'sgTap' }, ({ sgTap }) => {
        const a = float(sgTap.mod(int(2))).mul(2.0).sub(1.0);
        const b = float(sgTap.div(int(2))).mul(2.0).sub(1.0);
        const o4 = vec2(a.mul(0.25).add(b.mul(0.125)), b.mul(0.25).sub(a.mul(0.125)));
        const o2 = vec2(0.25, 0.125).mul(a);
        const p = t.p.add(mix(o2, o4, U.tap4).mul(U.tapOn).mul(U.texel)).toVar();
        const A = fieldAt(0, p);
        const B = fieldAt(1, p);
        const kw = mix(A.kw, B.kw, U.w1).mul(U.simOn).toVar();
        const den = mix(A.dn, B.dn, U.w1).mul(kw).toVar();
        const off = mix(A.off, B.off, U.w1).mul(kw).mul(C).toVar();
        If(kw.lessThan(0.999), () => { den.addAssign(scene.farEnv(p, SU).mul(kw.oneMinus())); });
        acc.addAssign(den.mul(scene.detail(p.add(off).sub(SU.windOff), lod, U.lodTarget)));
      });
      const s = acc.mul(U.amount.div(float(U.taps))).toVar();
      const rgb = U.alb1.mul(s.x).add(U.alb2.mul(s.y)).add(U.alb3.mul(s.z)).add(U.ejecta.mul(s.w));
      textureStore(this.gasTex, ivec2(t.i, t.j), vec4(rgb, sum4(s)));
    })().compute(W * H).setName('spaceGasMapGas');

    this.kLight = Fn(() => {
      const t = texel();
      const inv = vec2(1.0).div(U.texel.mul(vec2(W, H)));
      const uvOf = (q) => q.sub(U.min).mul(inv);
      const tau = float(0).toVar();
      let prev = 0;
      for (const s of SHADOW_STEPS) {
        const ds = s - prev;
        const a = prev + ds * 0.25, b = prev + ds * 0.75;
        prev = s;
        const ga = texture(this.gasTex, uvOf(t.p.add(U.sunDir.mul(a)))).level(0).a;
        const gb = texture(this.gasTex, uvOf(t.p.add(U.sunDir.mul(b)))).level(0).a;
        tau.addAssign(ga.add(gb).mul(ds * 0.5 / (2 * SPACE_GAS_SLAB)));
      }
      const tsun = exp(tau.mul(-0.32)).mul(0.85).add(0.15);
      textureStore(this.lightTex, ivec2(t.i, t.j), vec4(tsun, tau, 0.0, 1.0));
    })().compute(W * H).setName('spaceGasMapLight');
  }

  kernels() { return [this.kGas, this.kLight]; }

  warm(renderer) {
    if (!renderer) return;
    const live = this.U.live.value;
    this.U.live.value = 0;
    try { renderer.compute(this.kernels()); } finally { this.U.live.value = live; }
  }

  /** Wygląd sceny → uniformy (albedo gazów, wyrzut). */
  syncLook(look) {
    const a = look.albedo, U = this.U;
    U.alb1.value.set(a[0][0], a[0][1], a[0][2]);
    U.alb2.value.set(a[1][0], a[1][1], a[1][2]);
    U.alb3.value.set(a[2][0], a[2][1], a[2][2]);
    U.ejecta.value.set(look.ejecta[0], look.ejecta[1], look.ejecta[2]);
  }

  /**
   * Prostokąt mapy wokół kamery (względem kotwicy): pół kadru × zapas, teksel z drabiny (`ladder`), środek na siatce
   * tekseli (wzór nie „pływa” przy ruchu kamery). Zwraca środek mapy i jej bok w świecie przez `out` (cx, cy, w, h).
   */
  place(camX, camY, halfW, halfH, out) {
    const needX = halfW * SPACE_GAS_MAP_MARGIN * 2 / this.w, needY = halfH * SPACE_GAS_MAP_MARGIN * 2 / this.h;
    let tx = needX, ty = needY;
    if (this.ladder && needX > 0 && needY > 0) {
      const L = this._lvl, bias = this.levelBias | 0;
      L[0] = spaceGasTexelLevel(L[0], needX);
      L[1] = spaceGasTexelLevel(L[1], needY);
      tx = 2 ** ((L[0] + bias) / SPACE_GAS_TEXEL_STEPS);
      ty = 2 ** ((L[1] + bias) / SPACE_GAS_TEXEL_STEPS);
    }
    // próbki na teksel z boku teksla z drabiny (zmienia się tylko na stopniu — razem z przeskokiem siatki tekseli)
    const taps = spaceGasMapTaps(Math.max(tx, ty), this.taps, this.tapsAt);
    this.U.taps.value = taps;
    this.U.tap4.value = taps >= 4 ? 1 : 0;
    this.U.tapOn.value = taps > 1 ? 1 : 0;
    const hw = tx * this.w * 0.5, hh = ty * this.h * 0.5;
    const mx = Math.round(camX / tx) * tx, my = Math.round(camY / ty) * ty;
    this.U.min.value.set(mx - hw, my - hh);
    this.U.texel.value.set(tx, ty);
    // zanik faktury z mapy bazowej (lodW × lodH) — przy mapie bazowej = max(needX, needY) bit w bit
    this.U.lodTexel.value = Math.max(halfW * SPACE_GAS_MAP_MARGIN * 2 / this.lodW, halfH * SPACE_GAS_MAP_MARGIN * 2 / this.lodH);
    const img = this.sim.image;
    this.U.imgO0.value.copy(img.origin[0]);
    this.U.imgO1.value.copy(img.origin[1]);
    this.U.w1.value = img.w1;
    out.cx = mx; out.cy = my; out.w = hw * 2; out.h = hh * 2;
    return out;
  }
}
