// src/3d/tsl/bloomCompute.js
//
// Bloom gry w JEDNYM passie compute (port WebGPU, zadanie 23 — wydajność CPU).
//
// Dotąd bloom = BloomGry (BloomNode three r183, postGry.js): 12 osobnych renderer.render() na klatkę
// (próg, 5 mipów × rozmycie poziome i pionowe, kompozyt) — każdy render to pełna maszyneria three
// (lista, kontekst, klucze, pass, zgłoszenie do kolejki): ~40 µs CPU na pass, ~0,5 ms na klatkę, 40%
// CPU renderu sceny statycznej (hud 1,3 ms). Baza WebGL: 0,08 ms. Tu te same 12 kroków jako 12 kerneli
// w JEDNYM renderer.compute(lista) — jeden pass compute i jedno zgłoszenie; dispatch w passie to osobny
// zakres użycia zasobów (WebGPU wstawia bariery), więc kolejność i zależności jak w passach renderu.
//
// Obraz 1:1 z BloomNode (ten sam algorytm co dawny UnrealBloomPass WebGL i bloom dem WebGPU; „uber” dodaje go
// bez mnożnika od zadania 25b — postGry.js): te same węzły TSL w tej samej kolejności działań — próg smoothstep(threshold, threshold +
// 0,01, luminancja) po siatce bezpieczeństwa HDR, jądra 6…22 z tymi samymi współczynnikami (0,39894 ·
// e^(−i²/2σ²) / σ, σ = r / 3), przesunięcie direction · invSize · i, bloomFactors / lerpBloomFactor,
// wyjście × strength; cele HalfFloat (rgba16float), rozmiary jak BloomNode.setSize (połowa bufora ×
// resolutionScale, mipy Math.round(/2)), próbkowanie liniowe z obcięciem krawędzi, poziom 0 (cele bez
// mipmap — fragmentowy textureSample dawał ten sam poziom). UV piksela = (x + 0,5) / rozmiar (dawniej:
// interpolacja UV trójkąta QuadMesh — ta sama wartość z dokładnością do ULP, filtr tekstury kwantuje wagi
// do 1/256 teksela). Kontrola: scripts/webgpu/bloom-parzystosc.mjs (wyjście compute vs BloomGry bit w bit).
//
// Wyjście (kompozyt) w celu mipu 0 poziomu, jak BloomNode (_renderTargetsHorizontal[0]); „uber” próbkuje
// go przez getTextureNode(). Raz na RENDER (podzielony ekran = dwa rendery w klatce) — Core3D._renderPost
// woła render(renderer) przed postem.
import { StorageTexture, HalfFloatType, RGBAFormat, LinearFilter, ClampToEdgeWrapping, Vector2, Vector3 } from 'three/webgpu';
import {
  Fn, If, Return, Loop, add, float, int, uint, uv, vec2, vec4, uvec2, uniform, uniformArray, texture, textureStore,
  instanceIndex, luminance, smoothstep, mix
} from 'three/tsl';
import { hdrBezpieczny } from './postGry.js';

export const BLOOM_MIPY = 5;
const JADRA = [6, 10, 14, 18, 22];

/** Współczynniki Gaussa jądra — jak BloomNode._getSeparableBlurMaterial (three r183). */
export function wspolczynnikiJadra(kernelRadius) {
  const c = [];
  const sigma = kernelRadius / 3;
  for (let i = 0; i < kernelRadius; i++) c.push(0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma);
  return c;
}

/** Rozmiary celów jak BloomGry.setSize + BloomNode.setSize: [jasne/mip 0, mip 1, …]. */
export function rozmiaryBloomu(width, height, resolutionScale = 1) {
  const s = Math.max(0.1, Math.min(1, Number(resolutionScale) || 1));
  const w = Math.max(1, Math.floor(width * s));
  const h = Math.max(1, Math.floor(height * s));
  let resx = Math.round(w / 2);
  let resy = Math.round(h / 2);
  const out = [];
  for (let i = 0; i < BLOOM_MIPY; i++) {
    out.push([resx, resy]);
    resx = Math.round(resx / 2);
    resy = Math.round(resy / 2);
  }
  return out;
}

function celBloomu(nazwa) {
  const t = new StorageTexture(1, 1);
  t.type = HalfFloatType;
  t.format = RGBAFormat;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.mipmapsAutoUpdate = false;
  t.name = nazwa;
  return t;
}

// lerpBloomFactor z BloomNode.setup — czysta funkcja z layoutem (bez uniformów z domknięcia, PLAN §3).
const lerpBloomFactor = /*@__PURE__*/ Fn(([factor, radius]) => {
  const mirrorFactor = float(1.2).sub(factor);
  return mix(factor, mirrorFactor, radius);
}).setLayout({
  name: 'lerpBloomFactor',
  type: 'float',
  inputs: [
    { name: 'factor', type: 'float' },
    { name: 'radius', type: 'float' }
  ]
});

// Piksel wątku w celu o rozmiarze `size` (uniform vec2 — liczby całkowite): wątki poza celem wychodzą;
// UV środka piksela jak UV kwadu WebGPU (v = 0 u góry, jak wiersz 0 tekstury).
function pikselWatku(size) {
  const w = uint(size.x);
  const h = uint(size.y);
  If(instanceIndex.greaterThanEqual(w.mul(h)), () => { Return(); });
  const x = instanceIndex.mod(w).toVar();
  const y = instanceIndex.div(w).toVar();
  const uvNode = vec2(float(x).add(0.5), float(y).add(0.5)).div(size).toVar();
  return { x, y, uvNode };
}

export class BloomGryCompute {
  /**
   * @param {THREE.Texture} sceneTexture bufor sceny (rozwiązany MSAA, HalfFloat)
   */
  constructor(sceneTexture, strength = 1, radius = 0, threshold = 0) {
    this.isBloomGryCompute = true;
    this.strength = uniform(strength);
    this.radius = uniform(radius);
    this.threshold = uniform(threshold);
    this.smoothWidth = uniform(0.01);
    /** Skala rozdzielczości bloomu (0,1…1) względem bufora rysowania (bloomConfig.js / tuner). */
    this.resolutionScale = 1;
    /** Haki pomiaru (kubełek 'bloom' w Core3D) — przed i po passie compute. */
    this.onRenderBegin = null;
    this.onRenderEnd = null;
    this._bright = celBloomu('bloom.bright');
    this._h = [];
    this._v = [];
    for (let i = 0; i < BLOOM_MIPY; i++) {
      this._h.push(celBloomu('bloom.h' + i));
      this._v.push(celBloomu('bloom.v' + i));
    }
    this._rozmiar = [];
    this._invSize = [];
    for (let i = 0; i < BLOOM_MIPY; i++) {
      this._rozmiar.push(uniform(new Vector2(1, 1)));
      this._invSize.push(uniform(new Vector2(1, 1)));
    }
    this._klucz = '';
    this._size = new Vector2();
    this._kernels = this._build(sceneTexture);
    // Wyjście dla „uber”: węzeł z jawnym UV (klony texture(baza, uv, poziom) bez macierzy tekstury).
    this._output = texture(this._h[0], uv());
  }

  getTextureNode() {
    return this._output;
  }

  _build(sceneTexture) {
    const kernels = [];
    // 1. Próg (jak luminosityHighPass BloomNode, wejście przez siatkę bezpieczeństwa HDR jak dotąd)
    {
      const size = this._rozmiar[0];
      const bright = this._bright;
      const threshold = this.threshold;
      const smoothWidth = this.smoothWidth;
      const node = Fn(() => {
        const { x, y, uvNode } = pikselWatku(size);
        const texel = hdrBezpieczny(texture(sceneTexture, uvNode)).toVar();
        const v = luminance(texel.rgb);
        const alpha = smoothstep(threshold, threshold.add(smoothWidth), v);
        textureStore(bright, uvec2(x, y), mix(vec4(0), texel, alpha));
      })().compute(1).setName('bloomProg');
      kernels.push(node);
    }
    // 2. Mipy: rozmycie poziome (wejście: jasne albo pion poprzedniego mipu — zmniejszenie próbkowaniem
    //    liniowym w środkach pikseli mniejszego celu), potem pionowe (ten sam mip).
    for (let i = 0; i < BLOOM_MIPY; i++) {
      const wejscie = i === 0 ? this._bright : this._v[i - 1];
      kernels.push(this._blurKernel(wejscie, this._h[i], new Vector2(1.0, 0.0), i, `bloomPoziom${i}`));
      kernels.push(this._blurKernel(this._h[i], this._v[i], new Vector2(0.0, 1.0), i, `bloomPion${i}`));
    }
    // 3. Kompozyt mipów (BloomNode.compositePass) do celu poziomego mipu 0
    {
      const size = this._rozmiar[0];
      const out = this._h[0];
      const bloomFactors = uniformArray([1.0, 0.8, 0.6, 0.4, 0.2]);
      const bloomTintColors = uniformArray([new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1)]);
      const radius = this.radius;
      const strength = this.strength;
      const blur = this._v.map((t) => texture(t, vec2(0)));
      const node = Fn(() => {
        const { x, y, uvNode } = pikselWatku(size);
        const color0 = lerpBloomFactor(bloomFactors.element(0), radius).mul(vec4(bloomTintColors.element(0), 1.0)).mul(texture(blur[0], uvNode));
        const color1 = lerpBloomFactor(bloomFactors.element(1), radius).mul(vec4(bloomTintColors.element(1), 1.0)).mul(texture(blur[1], uvNode));
        const color2 = lerpBloomFactor(bloomFactors.element(2), radius).mul(vec4(bloomTintColors.element(2), 1.0)).mul(texture(blur[2], uvNode));
        const color3 = lerpBloomFactor(bloomFactors.element(3), radius).mul(vec4(bloomTintColors.element(3), 1.0)).mul(texture(blur[3], uvNode));
        const color4 = lerpBloomFactor(bloomFactors.element(4), radius).mul(vec4(bloomTintColors.element(4), 1.0)).mul(texture(blur[4], uvNode));
        const sum = color0.add(color1).add(color2).add(color3).add(color4);
        textureStore(out, uvec2(x, y), sum.mul(strength));
      })().compute(1).setName('bloomKompozyt');
      kernels.push(node);
    }
    return kernels;
  }

  // Rozmycie jak BloomNode._getSeparableBlurMaterial: próbka środka × c₀ + Σ (lewo + prawo) × cᵢ.
  _blurKernel(src, dst, dirValue, mip, name) {
    const kernelRadius = JADRA[mip];
    const size = this._rozmiar[mip];
    const invSize = this._invSize[mip];
    const gaussianCoefficients = uniformArray(wspolczynnikiJadra(kernelRadius));
    const direction = uniform(dirValue);
    const colorTexture = texture(src, vec2(0));
    const sampleTexel = (uvN) => texture(colorTexture, uvN);
    return Fn(() => {
      const { x, y, uvNode } = pikselWatku(size);
      const diffuseSum = sampleTexel(uvNode).rgb.mul(gaussianCoefficients.element(0)).toVar();
      Loop({ start: int(1), end: int(kernelRadius), type: 'int', condition: '<' }, ({ i }) => {
        const xf = float(i);
        const w = gaussianCoefficients.element(i);
        const uvOffset = direction.mul(invSize).mul(xf);
        const sample1 = sampleTexel(uvNode.add(uvOffset)).rgb;
        const sample2 = sampleTexel(uvNode.sub(uvOffset)).rgb;
        diffuseSum.addAssign(add(sample1, sample2).mul(w));
      });
      textureStore(dst, uvec2(x, y), vec4(diffuseSum, 1.0));
    })().compute(1).setName(name);
  }

  /** Rozmiary celów z bufora rysowania × resolutionScale; zmiana = nowe tekstury GPU (setSize). */
  _resize(renderer) {
    const size = renderer.getDrawingBufferSize(this._size);
    const R = rozmiaryBloomu(size.width, size.height, this.resolutionScale);
    const klucz = R.map((r) => r.join('x')).join(',');
    if (klucz === this._klucz) return R;
    this._klucz = klucz;
    this._bright.setSize(R[0][0], R[0][1]);
    for (let i = 0; i < BLOOM_MIPY; i++) {
      const [w, h] = R[i];
      this._h[i].setSize(w, h);
      this._v[i].setSize(w, h);
      this._rozmiar[i].value.set(w, h);
      this._invSize[i].value.set(1 / w, 1 / h);
    }
    // wątki kerneli = piksele celu wyjścia
    const k = this._kernels;
    k[0].count = R[0][0] * R[0][1];
    for (let i = 0; i < BLOOM_MIPY; i++) {
      k[1 + i * 2].count = R[i][0] * R[i][1];
      k[2 + i * 2].count = R[i][0] * R[i][1];
    }
    k[k.length - 1].count = R[0][0] * R[0][1];
    return R;
  }

  /** Bloom tego renderu: 12 kerneli w jednym passie compute. */
  render(renderer) {
    if (this.onRenderBegin) this.onRenderBegin();
    this._resize(renderer);
    renderer.compute(this._kernels);
    if (this.onRenderEnd) this.onRenderEnd();
  }

  dispose() {
    this._bright.dispose();
    for (const t of this._h) t.dispose();
    for (const t of this._v) t.dispose();
    for (const k of this._kernels) k.dispose?.();
  }
}
