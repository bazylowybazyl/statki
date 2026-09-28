// src/3d/asteroids/beltMedium.js
//
// OŚRODEK ŚWIATŁA WOLUMETRYCZNEGO pola asteroid — część czytana przez materiały
// (zadanie 21; liczenie: volumetrics.js, port dema/asteroidy-webgpu/volumetrics.js).
//
// Ośrodek to płyta pyłu wokół płaszczyzny gry (z od zBot do zTop). Compute
// (VolumeLight) co klatkę całkuje w kolumnach froxeli (siatka wyrównana do kamery
// ortho, zakotwiczona w świecie) rozproszenie świateł siatki od stropu w dół:
// rgb = światło rozproszone od kamery do wysokości z, a = transmitancja. Każda
// powierzchnia passa gry z zapisem głębi składa `kolor · a + rgb` na swojej
// wysokości (kadłuby, olbrzymy; skały i minerały — do stropu warstwy skał), a kwad
// dna (volumetrics.js) kładzie pełną kolumnę na tło.
//
// Ten moduł jest singletonem bez renderera i bez Core3D: materiał kadłuba
// (hexShips3D.tsl.js, hak `hullVolume`) buduje swój graf zanim pas wystartuje, więc
// tekstura i uniformy muszą istnieć od pierwszego wywołania. Uniformy odczytu są
// w grupie `render` (jeden bufor, świeży w każdym render() — nie kopia w buforze
// każdego kadłuba). Poza polem `on = 0`: `sample()` nie próbkuje nic (gałąź na
// uniformie) i oddaje (0, 0, 0, 1) — obraz kadłuba bit w bit jak bez ośrodka.
//
// UKŁAD: pozycje LOKALNE względem początku pola (scena − początek, początek =
// Core3D.fx.origin — ten sam co siatki świateł). Punkt powierzchni materiału:
// `localPosition()` = obrót kamery · positionView + (kamera − początek) liczone
// w double na CPU (jak LightGrid.localPosition — dokładne przy 6–10 mln j.).

import * as THREE from 'three/webgpu';
import {
  If, vec2, vec3, vec4, uniform, texture3D, floor, renderGroup,
  positionView, cameraWorldMatrix
} from 'three/tsl';

export const VOLUME_DEFAULTS = Object.freeze({
  cellPx: 4,          // kolumna froxeli na tyle pikseli ekranu (co najmniej)
  maxColumns: 420,    // …ale nie więcej kolumn w poprzek kadru (koszt nie rośnie z rozdzielczością)
  nz: 40,
  zTop: 380,          // [j.] strop ośrodka (reflektory dziobu świecą z z = 140)
  zBot: -760,         // [j.] dno ośrodka (pod nim skały tła i mgła głęboka)
  fadeTop: 300,
  fadeBot: 320,
  density: 1.0,       // mnożnik gęstości
  base: 0.1,          // pył poza gęstymi polami (rzadki pas) — dodawany do mapy pola
  gain: 0.0014,       // jasność smug (skala: j. drogi × moc świateł)
  extinction: 1.6e-4, // [1/j.] przy gęstości 1
  phaseG: 0.3,        // rozpraszanie w przód (patrząc pod światło jaśniej)
  near: 380,          // [j.] bliskie pole lampy: smuga najjaśniejsza tuż przy lampie
  noiseScale: 5200,   // [j.] okres szumu kłębów (5 oktaw: 1300 … 80 j.)
  detailScale: 2600,  // [j.] okres włókien (szum grzbietowy, 3 oktawy: 650 … 160 j.)
  drift: [16, 7, 2]   // [j./s] dryf faktury pyłu
});

class BeltMedium {
  constructor() {
    const cfg = VOLUME_DEFAULTS;
    this.cfg = cfg;
    // Rozmiar tekstury: największy kadr (ekran), kolumna ≥ cellPx; przy dużym kadrze
    // kolumna rośnie ponad cellPx (2560 px → ~6 px), najwyżej maxColumns w poprzek.
    const w = typeof window !== 'undefined' ? Math.max(window.innerWidth || 0, window.screen?.width || 0, 640) : 1920;
    const h = typeof window !== 'undefined' ? Math.max(window.innerHeight || 0, window.screen?.height || 0, 360) : 1080;
    const cellPx = Math.max(cfg.cellPx, w / cfg.maxColumns);
    this.NX = Math.ceil((w / cellPx) * 1.2) + 4;
    this.NY = Math.ceil((h / cellPx) * 1.2) + 4;
    this.NZ = cfg.nz;
    this.dz = (cfg.zTop - cfg.zBot) / this.NZ;
    const tex = new THREE.Storage3DTexture(this.NX, this.NY, this.NZ);
    tex.name = 'AsteroidBelt:volumeLight';
    tex.type = THREE.HalfFloatType;
    tex.format = THREE.RGBAFormat;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    this.texture = tex;
    // Początek pola (scena, double) — ustawia pas co klatkę (Core3D.fx.origin).
    this.originX = 0;
    this.originY = 0;
    // Uniformy odczytu (grupa `render`): róg siatki kolumn (lokalnie), 1 / rozmiar tekstury
    // w j. (xy) i w z, strop, włącznik.
    this.U = {
      origin: uniform(new THREE.Vector2()).setName('beltVolOrigin').setGroup(renderGroup),
      invTex: uniform(new THREE.Vector3(1, 1, 1)).setName('beltVolInvTex').setGroup(renderGroup),
      zTop: uniform(cfg.zTop).setName('beltVolZTop').setGroup(renderGroup),
      zBot: uniform(cfg.zBot).setName('beltVolZBot').setGroup(renderGroup),
      on: uniform(0).setName('beltVolOn').setGroup(renderGroup)
    };
    // Kamera passa względem początku pola (double na CPU), raz na render().
    this.camLocal = uniform(new THREE.Vector3()).setName('beltCamLocal').setGroup(renderGroup)
      .onRenderUpdate(({ camera }) => {
        if (!camera) return;
        const e = camera.matrixWorld.elements;
        this.camLocal.value.set(e[12] - this.originX, e[13] - this.originY, e[14]);
      });
  }

  /** Początek pola w układzie SCENY (x, −y świata gry). */
  setOrigin(x, y) {
    this.originX = x;
    this.originY = y;
  }

  /** TSL: punkt powierzchni materiału lokalnie (scena − początek pola), dokładny w double. */
  localPosition() {
    return cameraWorldMatrix.mul(vec4(positionView, 0.0)).xyz.add(this.camLocal);
  }

  /**
   * TSL (w funkcji / setupie materiału — używa `If`): światło rozproszone od kamery do
   * wysokości P.z (rgb) i transmitancja (a) w punkcie P (lokalnie). Pod dnem ośrodka
   * pełna kolumna (odczyt tekstury obcięty do brzegu). Poza polem (on = 0) bez odczytu:
   * (0, 0, 0, 1).
   */
  sample(P) {
    const out = vec4(0.0, 0.0, 0.0, 1.0).toVar();
    If(this.U.on.greaterThan(0.5), () => {
      out.assign(this._column(P));
    });
    return out;
  }

  /**
   * Całka kolumny do wysokości P.z. W XY filtr B-spline z 4 próbek trójliniowych
   * (trójliniowy sam robił schodki na wąskich smugach przy lampach), w z liniowo.
   */
  _column(P) {
    const U = this.U;
    const size = vec2(this.NX, this.NY);
    const t = vec2(P.x.sub(U.origin.x).mul(U.invTex.x), P.y.sub(U.origin.y).mul(U.invTex.y)).mul(size).sub(0.5).toVar();
    const i = floor(t);
    const f = t.sub(i).toVar();
    const f2 = f.mul(f);
    const f3 = f2.mul(f);
    const w0 = f3.negate().add(f2.mul(3.0)).sub(f.mul(3.0)).add(1.0).div(6.0);
    const w1 = f3.mul(3.0).sub(f2.mul(6.0)).add(4.0).div(6.0);
    const w2 = f3.mul(-3.0).add(f2.mul(3.0)).add(f.mul(3.0)).add(1.0).div(6.0);
    const w3 = f3.div(6.0);
    const g0 = w0.add(w1).toVar();
    const g1 = w2.add(w3).toVar();
    const h0 = i.sub(0.5).add(w1.div(g0)).div(size).toVar();
    const h1 = i.add(1.5).add(w3.div(g1)).div(size).toVar();
    const wz = U.zTop.sub(P.z).mul(U.invTex.z).toVar();
    const tap = (u, v) => texture3D(this.texture, vec3(u, v, wz)).level(0);
    return tap(h0.x, h0.y).mul(g0.x).add(tap(h1.x, h0.y).mul(g1.x)).mul(g0.y)
      .add(tap(h0.x, h1.y).mul(g0.x).add(tap(h1.x, h1.y).mul(g1.x)).mul(g1.y));
  }

  /**
   * Hak materiału kadłuba (hexShips3D.tsl.js `hullVolume`): pył w kolumnie nad
   * pancerzem na wysokości fragmentu → { a, rgb } (`kolor · a + rgb`).
   */
  hullVolume() {
    const v = this.sample(this.localPosition()).toVar();
    return { a: v.a, rgb: v.rgb };
  }
}

let _medium = null;

/** Wspólny ośrodek pola (tworzony przy pierwszym użyciu — materiał kadłuba albo pas). */
export function getBeltMedium() {
  if (!_medium) _medium = new BeltMedium();
  return _medium;
}

/** Czy ośrodek już istnieje (bez tworzenia) — testy, spis. */
export function hasBeltMedium() {
  return !!_medium;
}

