// src/3d/skybake/skyBaker.js
//
// WYPIEKACZ NIEBA: tło gry liczone RAZ (narzędzie / ekran ładowania), nie co klatkę — dlatego
// styl może kosztować setki oktaw szumu na piksel. Styl (np. styleGalaktyka.js, styleMglawica.js)
// podaje passy pełnoekranowe (QuadMesh → cel), każdy pass czyta cele poprzednich przez
// `ctx.load(nazwa, ivec2)` (bez filtrowania) albo `ctx.sample(nazwa, uv)` (dwuliniowo, poziom 0).
// Ostatni pass stylu daje OBRAZ WYŚWIETLANY liniowo (Dl, ≤ SKY_DISPLAY_MAX). Wypiekacz dokłada:
//   • „tekstura” — Dl → wartość tekstury (odwrotność acesGry), liniowo, HalfFloat: to samo, co gra
//     dostaje po sprzętowym dekodowaniu sRGB z PNG (podgląd próbkuje ją jak NebulaSystem);
//   • eksport — tekstura → sRGB 8 bit z ditheringiem trójkątnym (bez pasm w ciemnych gradientach).
//
// Pass może mieć własny rozmiar celu (`size` — ułamek rozmiaru wypieku; atlas objętości światła
// mgławicy) i może iść W PASACH (`strips` — liczba poziomych pasów rysowanych osobnymi
// zgłoszeniami do kolejki GPU: Windows resetuje GPU, gdy jedno zadanie trwa > ~2 s, a marsz
// promienia przez objętość przy 5120 × 3200 potrafi tyle kosztować; między pasami wypiekacz czeka
// na koniec pracy GPU, a cel nie jest czyszczony — `autoClear = false`).
//
// Układ: piksel celu (screenCoordinate, y od GÓRY) = piksel PNG (wiersz 0 = góra) = góra ekranu gry
// (TextureLoader odwraca y, płaszczyzna NebulaSystem ma +Y w górę kadru). Współrzędne nieba
// `ctx.sky` = (piksel − środek) / wysokość: x ∈ ±0,8, y ∈ ±0,5 (y w dół) dla 5120 × 3200.
//
// KAFEL (wycinek nieba w dowolnej gęstości — podgląd A/B 1:1, kafle wysokiej rozdzielczości): cel ma
// rozmiar kafla (`width` × `height`), a niebo — rozmiar PEŁNY (`fullWidth` × `fullHeight` = 5120 × 3200 ×
// gęstość) i początek kafla `origin` w pikselach pełnego nieba (`setRegion`). Passy liczą z pikseli
// pełnego nieba (`ctx.px`, `ctx.sky`), więc sąsiednie kafle są tą samą funkcją. Passy stylu oznaczone
// `shared` (atlas objętości światła mgławicy — własna dziedzina, całe niebo) kafel POŻYCZA od wypiekacza
// bazowego (`shared`) zamiast liczyć je drugi raz. `extraOctaves` — dodatkowe oktawy detalu (styl czyta
// je w `apply`; gęstsze próbkowanie samo nie dorobi struktury pod najwyższą oktawą szumu).
import * as THREE from 'three/webgpu';
import { clamp, float, ivec2, screenCoordinate, texture, textureLoad, uint, uniform, vec3, vec4 } from 'three/tsl';
import { skyHash } from './skyBakeNoise.js';
import { acesGryInv, srgbEncode } from './skyGameColor.js';

/** Rozmiar tekstury tła gry (public/assets/nebula.png — mapowanie płaszczyzny NebulaSystem). */
export const SKY_GAME_SIZE = Object.freeze({ width: 5120, height: 3200 });

const _stripCamera = /*@__PURE__*/ new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

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

/** Czworokąt pasa i (z n) w NDC: y ∈ [−1 + 2i/n, −1 + 2(i + 1)/n] (kolejność pasów bez znaczenia). */
function stripGeometry(i, n) {
  const y0 = -1 + 2 * i / n;
  const y1 = -1 + 2 * (i + 1) / n;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, y0, 0, 1, y0, 0, 1, y1, 0, -1, y1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export class SkyBaker {
  /**
   * @param {THREE.WebGPURenderer} renderer
   * @param {{ width?: number, height?: number, fullWidth?: number, fullHeight?: number,
   *   shared?: SkyBaker, extraOctaves?: number }} [o] — `width` × `height` = cel (kafel), `fullWidth` ×
   *   `fullHeight` = całe niebo w gęstości kafla (domyślnie cel = całe niebo), `shared` — wypiekacz bazowy
   *   z passami `shared` stylu, `extraOctaves` — dodatkowe oktawy detalu.
   */
  constructor(renderer, o = {}) {
    this.renderer = renderer;
    this.width = o.width || SKY_GAME_SIZE.width;
    this.height = o.height || SKY_GAME_SIZE.height;
    this.fullWidth = o.fullWidth || this.width;
    this.fullHeight = o.fullHeight || this.height;
    this.size = uniform(new THREE.Vector2(this.fullWidth, this.fullHeight));
    this.origin = uniform(new THREE.Vector2(0, 0));
    this.shared = o.shared || null;
    this.extraOctaves = o.extraOctaves | 0;
    this.ditherSeed = uniform(1, 'int');
    this.style = null;
    /** Licznik przebudów passów (kafel z `shared` przebudowuje się, gdy bazowy zmienił cele). */
    this.version = 0;
    this._sharedVersion = -1;
    this.targets = new Map();
    this.passes = [];
    this.textureTarget = null;
    this.exportTarget = null;
    this._texQuad = null;
    this._expQuad = null;
    this.lastBakeMs = 0;
    /** Czas [ms] ostatniego wypieku per pass (nazwa → ms) — strojenie budżetu. */
    this.passMs = {};
  }

  /** Teksele pełnego nieba na teksel tła gry 5120 × 3200 (gęstość; style skalują nią rozmiary w tekselach). */
  get resScale() { return this.fullWidth / SKY_GAME_SIZE.width; }

  _makeTarget(type, width = this.width, height = this.height) {
    const rt = new THREE.RenderTarget(width, height, { type, depthBuffer: false, stencilBuffer: false });
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  /** Rozmiar celu passu o ułamku `size` (zaokrąglony do całości, ≥ 1). */
  passSize(size) {
    const s = size || 1;
    return { width: Math.max(1, Math.round(this.width * s)), height: Math.max(1, Math.round(this.height * s)) };
  }

  /**
   * Kontekst budowy passu stylu. `px` / `sky` — piksel PEŁNEGO nieba (środek piksela celu przeliczony
   * z ułamka rozmiaru passu i przesunięty o początek kafla); pass `shared` (własna dziedzina, np. atlas)
   * dostaje piksel swojego celu.
   */
  _ctx(pass = null) {
    const size = this.size;
    const origin = this.origin;
    const targetOf = (name) => {
      const rt = this.targets.get(name);
      if (!rt) throw new Error(`SkyBaker: brak celu „${name}” (kolejność passów stylu)`);
      return rt;
    };
    const scaleOf = (name) => this.passes.find((p) => p.name === name)?.scale ?? 1;
    const local = screenCoordinate.xy;
    const s = pass?.size || 1;
    const px = pass?.shared ? local : (s === 1 ? local : local.div(s)).add(origin);
    return {
      size,
      /** Piksel pełnego nieba (środek piksela = całość + 0,5; y od góry). */
      px,
      /** Współrzędne nieba: (piksel − środek) / wysokość. */
      sky: () => px.sub(size.mul(0.5)).div(size.y),
      /** Odczyt celu poprzedniego passu (indeks piksela TEGO celu, bez filtrowania). */
      load: (name, ip) => textureLoad(targetOf(name).texture, ip),
      /**
       * Odczyt celu poprzedniego passu w pikselu PEŁNEGO nieba `gp` (+ przesunięcie `off` w tekselach celu),
       * obcięty do celu (kafel: poza kaflem — brzeg).
       */
      loadAt: (name, gp, off = null) => {
        const rt = targetOf(name);
        const sc = scaleOf(name);
        const rel = gp.sub(origin);
        let ip = ivec2(sc === 1 ? rel : rel.mul(sc));
        if (off) ip = ip.add(off);
        return textureLoad(rt.texture, clamp(ip, ivec2(0), ivec2(rt.width - 1, rt.height - 1)));
      },
      /** Próbka celu poprzedniego passu: uv ∈ [0, 1]², filtr dwuliniowy, poziom 0 (wolno w pętlach). */
      sample: (name, uv) => texture(targetOf(name).texture, uv, float(0)),
      /** Indeks piksela celu (ivec2). */
      pixel: () => ivec2(screenCoordinate.xy)
    };
  }

  _disposeStyle() {
    for (const p of this.passes) {
      if (p.borrowed) continue;
      p.material.dispose();
      p.target.dispose();
      for (const m of p.strips || []) m.geometry.dispose();
    }
    this.passes = [];
    this.targets.clear();
    this._texQuad?.material.dispose();
    this._expQuad?.material.dispose();
    this.textureTarget?.dispose();
    this.exportTarget?.dispose();
    this._texQuad = this._expQuad = this.textureTarget = this.exportTarget = null;
  }

  /**
   * Styl: { name, passes: [{ name, type?, size?, strips?, shared?, node(ctx) → vec4 }] }. Graf budowany
   * raz; parametry to uniformy stylu. `size` — ułamek rozmiaru wypieku (cel pomocniczy), `strips` — liczba
   * pasów (osobne zgłoszenia GPU; ciężki marsz promienia), `shared` — pass z własną dziedziną (całe niebo
   * niezależnie od kafla): kafel z wypiekaczem `shared` pożycza jego cel i go nie liczy.
   */
  setStyle(style) {
    this._disposeStyle();
    this.style = style;
    this.version++;
    if (this.shared) {
      if (this.shared.style !== style) throw new Error('SkyBaker: kafel i wypiekacz bazowy (shared) muszą mieć ten sam styl');
      this._sharedVersion = this.shared.version;
    }
    for (const pass of style.passes) {
      if (pass.shared && this.shared) {
        const target = this.shared.target(pass.name);
        if (!target) throw new Error(`SkyBaker: wypiekacz bazowy nie ma celu „${pass.name}”`);
        this.targets.set(pass.name, target);
        this.passes.push({ name: pass.name, target, scale: pass.size || 1, borrowed: true });
        continue;
      }
      const { width, height } = this.passSize(pass.size);
      const target = this._makeTarget(pass.type ?? THREE.HalfFloatType, width, height);
      this.targets.set(pass.name, target);
      const material = makeMaterial(`SkyBake:${style.name}:${pass.name}`, pass.node(this._ctx(pass)));
      const n = Math.max(1, pass.strips | 0);
      // sync — po passie poczekaj na GPU (osobne zgłoszenie dla ciężkiego passu bez pasów).
      const entry = {
        name: pass.name, target, material, quad: new THREE.QuadMesh(material), strips: null, sync: !!pass.sync,
        scale: pass.size || 1, borrowed: false
      };
      if (n > 1) {
        entry.strips = Array.from({ length: n }, (_, i) => {
          const mesh = new THREE.Mesh(stripGeometry(i, n), material);
          mesh.frustumCulled = false;
          return mesh;
        });
      }
      this.passes.push(entry);
    }
    const ctx = this._ctx();
    const last = style.passes[style.passes.length - 1].name;
    // Obraz wyświetlany → wartość tekstury (liniowo).
    this.textureTarget = this._makeTarget(THREE.HalfFloatType);
    const dl = ctx.load(last, ctx.pixel());
    this._texQuad = new THREE.QuadMesh(makeMaterial('SkyBake:tekstura', vec4(acesGryInv(dl.rgb), 1.0)));
    // Eksport: sRGB 8 bit + dither trójkątny (±1 LSB).
    this.exportTarget = this._makeTarget(THREE.UnsignedByteType);
    const tex = textureLoad(this.textureTarget.texture, ctx.pixel());
    const ip = ctx.pixel();
    const ix = uint(ip.x);
    const iy = uint(ip.y);
    const salt = uint(this.ditherSeed);
    const n = skyHash(ix, iy, salt).add(skyHash(iy, ix, salt.add(uint(7919)))).sub(1.0).div(255.0);
    const enc = srgbEncode(tex.rgb).add(vec3(n));
    this._expQuad = new THREE.QuadMesh(makeMaterial('SkyBake:eksport', vec4(enc, float(1.0))));
  }

  /** Zmiana rozdzielczości całego nieba (cel = całe niebo): cele i grafy od nowa (rzadkie — podgląd ½ / eksport). */
  setSize(width, height) {
    this.fullWidth = width;
    this.fullHeight = height;
    this.size.value.set(width, height);
    this.origin.value.set(0, 0);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    if (this.style) this.setStyle(this.style);
  }

  /**
   * Kafel: całe niebo `fullWidth` × `fullHeight` (gęstość = fullWidth / 5120), początek kafla (x, y) w
   * pikselach całego nieba (ułamki dozwolone — podgląd ustawia kafel dokładnie na pikselach ekranu),
   * cel `width` × `height`. Zmiana samego położenia / gęstości to uniformy (bez przebudowy grafów).
   */
  setRegion({ fullWidth, fullHeight, x = 0, y = 0, width = this.width, height = this.height }) {
    this.fullWidth = fullWidth;
    this.fullHeight = fullHeight;
    this.size.value.set(fullWidth, fullHeight);
    this.origin.value.set(x, y);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const style = this.shared?.style || this.style;
    if (style) this.setStyle(style);
  }

  async _gpuIdle() {
    const q = this.renderer.backend?.device?.queue;
    if (q?.onSubmittedWorkDone) await q.onSubmittedWorkDone();
  }

  /** Wypiek wszystkich passów stylu + tekstury. Zwraca czas [ms] (do końca pracy GPU). */
  async bake() {
    if (!this.style) throw new Error('SkyBaker: brak stylu');
    // Kafel: wypiekacz bazowy zmienił styl albo cele (rozdzielczość) — pożyczone cele są nieaktualne.
    if (this.shared && (this.shared.style !== this.style || this.shared.version !== this._sharedVersion)) {
      this.setStyle(this.shared.style);
    }
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const t0 = performance.now();
    this.passMs = {};
    for (const p of this.passes) {
      if (p.borrowed) continue;
      const tp = performance.now();
      r.setRenderTarget(p.target);
      if (p.strips) {
        // Pasy: osobne zgłoszenia, cel bez czyszczenia między nimi (loadOp „load”), GPU dokańcza każdy.
        const auto = r.autoClear;
        r.autoClear = false;
        for (const mesh of p.strips) {
          r.render(mesh, _stripCamera);
          await this._gpuIdle();
        }
        r.autoClear = auto;
      } else {
        p.quad.render(r);
        if (p.sync) await this._gpuIdle();
      }
      this.passMs[p.name] = performance.now() - tp;
    }
    r.setRenderTarget(this.textureTarget);
    this._texQuad.render(r);
    r.setRenderTarget(prev);
    await this._gpuIdle();
    this.lastBakeMs = performance.now() - t0;
    return this.lastBakeMs;
  }

  /** Tekstura tak, jak gra ją widzi po dekodowaniu sRGB (liniowo, filtr dwuliniowy). */
  get texture() { return this.textureTarget?.texture || null; }

  /** Cel passu stylu (podgląd pól). */
  target(name) { return this.targets.get(name) || null; }

  /** Piksele eksportu RGBA8 (wiersz 0 = góra), dither z `seed`. */
  async exportPixels(seed = 1) {
    const r = this.renderer;
    this.ditherSeed.value = seed | 0;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.exportTarget);
    this._expQuad.render(r);
    r.setRenderTarget(prev);
    const w = this.width;
    const h = this.height;
    const raw = await r.readRenderTargetPixelsAsync(this.exportTarget, 0, 0, w, h);
    // WebGPU zwraca wiersze wyrównane do 256 B (5120 × 4 B już jest wyrównane — przepisanie na wszelki wypadek).
    const stride = Math.ceil(w * 4 / 256) * 256;
    if (stride === w * 4 && raw.length >= w * h * 4) return new Uint8ClampedArray(raw.buffer, raw.byteOffset, w * h * 4);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
    return out;
  }

  /**
   * Eksport (Blob): PNG (bezstratnie) albo 'image/webp' / 'image/jpeg' z jakością (ziarno gwiazd
   * kompresuje się słabo — PNG 5120 × 3200 to ~35 MB). Alfa = 255.
   */
  async exportBlob(seed = 1, type = 'image/png', quality = 0.92) {
    const px = await this.exportPixels(seed);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d').putImageData(new ImageData(px, this.width, this.height), 0, 0);
    return new Promise((ok) => canvas.toBlob(ok, type, quality));
  }

  exportPngBlob(seed = 1) { return this.exportBlob(seed, 'image/png'); }

  dispose() { this._disposeStyle(); }
}
