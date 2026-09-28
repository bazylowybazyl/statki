// Strona do scripts/webgpu/bloom-parzystosc.mjs (zadanie 23): na bieżącym buforze sceny Core3D liczy bloom
// OBIEMA drogami — BloomGry (BloomNode three, 12 renderów, dawna droga gry) i BloomGryCompute (jeden pass
// compute, bloomCompute.js — droga gry od zadania 23) — i porównuje cele bit w bit (HalfFloat: jasne,
// 5 × poziom i pion, kompozyt). Obie drogi w jednym zadaniu JS, bez klatki pomiędzy (bufor sceny ten sam).
import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { BloomGry, hdrBezpieczny } from '/src/3d/tsl/postGry.js';

const half = (u) => {
  const s = (u & 0x8000) ? -1 : 1;
  const e = (u >> 10) & 0x1f;
  const f = u & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
};

function porownajTablice(a, b, w, h) {
  // wiersze wyrównane do 256 B: 4 kanały × 2 B = 8 B na piksel
  const rowElems = Math.ceil((w * 8) / 256) * 256 / 2;
  let rozne = 0; let maks = 0; let suma = 0; let jasnych = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w * 4; x++) {
      const i = y * rowElems + x;
      const va = a[i];
      const vb = b[i];
      if ((x & 3) !== 3 && half(va) > 0.01) jasnych++;
      if (va !== vb) {
        rozne++;
        const d = Math.abs(half(va) - half(vb));
        if (d > maks) maks = d;
        suma += d;
      }
    }
  }
  return { wartosci: w * h * 4, rozne, maksRoznica: +maks.toPrecision(4), sredniaRoznica: rozne ? +(suma / rozne).toPrecision(4) : 0, jasnych };
}

export async function porownajBloom() {
  const C = window.Core3D;
  const R = C.renderer;
  const bc = C.bloomPass;
  if (!bc || !bc.isBloomGryCompute) return { blad: 'Core3D.bloomPass to nie BloomGryCompute' };
  const sceneTex = C.composerTarget.texture;
  const bg = new BloomGry(hdrBezpieczny(texture(sceneTex)), bc.strength.value, bc.radius.value, bc.threshold.value);
  bg.resolutionScale = bc.resolutionScale;
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = bg.getTextureNode();
  const quad = new THREE.QuadMesh(mat);
  const rt = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const prev = R.getRenderTarget();
  // dawna droga: render kwadu z teksturą bloomu wyzwala BloomNode.updateBefore (12 renderów)
  R.setRenderTarget(rt);
  quad.render(R);
  R.setRenderTarget(prev);
  // droga gry: jeden pass compute na tym samym buforze sceny
  bc.render(R);
  const pary = [['jasne', bg._renderTargetBright, bc._bright]];
  for (let i = 0; i < 5; i++) {
    pary.push([`poziom${i}`, bg._renderTargetsHorizontal[i], bc._h[i]]);
    pary.push([`pion${i}`, bg._renderTargetsVertical[i], bc._v[i]]);
  }
  const wynik = {};
  for (const [nazwa, cel, tex] of pary) {
    const w = cel.width;
    const h = cel.height;
    if (w !== tex.image.width || h !== tex.image.height) { wynik[nazwa] = { blad: `rozmiar ${w}x${h} vs ${tex.image.width}x${tex.image.height}` }; continue; }
    const a = await R.readRenderTargetPixelsAsync(cel, 0, 0, w, h);
    const b = await R.backend.copyTextureToBuffer(tex, 0, 0, w, h, 0);
    wynik[nazwa] = { rozmiar: `${w}x${h}`, ...porownajTablice(a, b, w, h) };
  }
  // poziom0 BloomGry = kompozyt (BloomNode pisze go do _renderTargetsHorizontal[0] na końcu), u nas też
  bg.dispose();
  mat.dispose();
  rt.dispose();
  return wynik;
}
