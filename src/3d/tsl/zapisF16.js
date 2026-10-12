// src/3d/tsl/zapisF16.js
//
// ZAPIS DO TEKSTUR STORAGE RGBA16F z ZAOKRĄGLENIEM STOCHASTYCZNYM (2026-10-12). Zapis f32 → f16 przez textureStore
// zaokrągla w sposób zależny od sprzętu: na RTX (Dawn / D3D12) OBCINA ku zeru (pomiar: 1,00073 → 1,0), inne karty mogą
// zaokrąglać do najbliższej. Pole zmieniane w każdym kroku małymi przyrostami (opadanie pyłu, zanik dymu, opór, relaksacja)
// traci wtedy każdy przyrost mniejszy od odstępu liczb, a każdy ubytek zaokrągla w dół o cały odstęp — systematyczny
// ubytek masy i energii (pył hal K-7: −1300 jednostek w 24 s spoczynku; audyt docs/AUDYT-pyl-hali-2026-10-12.md § 6).
//
// x + znak(x)·(r − bias)·ulp(|x|), r ∈ [0, 1): wartość oczekiwana zapisu = x przy obcięciu (bias 0) i przy zaokrągleniu do
// najbliższej (bias 0,5). Bias = wspólny uniform F16_ROUND_BIAS — ustawia go raz probeHalfRounding na urządzeniu
// (wołają go kroki pól: gasField2D, gasGrid). Do wyniku testu — obcięcie (jak na RTX). Bez window / DOM (render w workerze).
import { uniform, hash, uint, float, abs, sign, max, floor, log2, exp2, fract } from 'three/tsl';

/** 0 — zapis f16 obcina (RTX / D3D12), 0,5 — zaokrągla do najbliższej. Wspólny dla wszystkich kerneli. */
export const F16_ROUND_BIAS = uniform(0).setName('f16RoundBias');

/** Wynik testu urządzenia: 'trunc' / 'nearest' / null (brak testu albo błąd). */
export const F16_ROUNDING = { mode: null, probing: null };

/**
 * TSL: x (float albo wektor, f32) przygotowany do zapisu f16 — dodaje szum stochastyczny o amplitudzie odstępu liczb
 * połówkowych przy |x| (podnormalne: 2⁻²⁴). r — liczba losowa [0, 1) (ta sama wymiarowość co x albo skalar).
 */
export function sroundF16(x, r) {
  const e = max(floor(log2(max(abs(x), 1e-30))), -14.0);
  return x.add(sign(x).mul(r.sub(F16_ROUND_BIAS)).mul(exp2(e.sub(10.0))));
}

/** TSL: liczba losowa [0, 1) z haszu PCG (indeks wątku, ziarno klatki — uint, sól kernela). */
export function rndF16(index, seed, salt) {
  return hash(index.add(seed.mul(uint(2654435761))).add(uint(((salt + 1) * 0x68e31da4) >>> 0)));
}

/** TSL: kolejne niezależne-ish liczby z jednej (złoty podział) — składowe wektora. */
export function rndF16Next(r, k) {
  return fract(r.add(float(0.6180339887 * k)));
}

/** LUSTRO CPU sroundF16 (testy): r ∈ [0, 1), bias — 0 obcięcie, 0,5 do najbliższej. */
export function sroundF16Cpu(x, r, bias = 0) {
  const e = Math.max(Math.floor(Math.log2(Math.max(Math.abs(x), 1e-30))), -14);
  return x + Math.sign(x) * (r - bias) * 2 ** (e - 10);
}

/**
 * TEST ZAOKRĄGLANIA zapisu f32 → f16 do tekstury storage na urządzeniu (raw WebGPU, poza grafem three): zapis
 * 1 + 0,75·2⁻¹⁰ do rgba16float i odczyt. 'trunc' (obcięcie ku zeru) albo 'nearest'. null — bez urządzenia / błąd.
 */
export async function probeHalfRounding(device) {
  if (!device || typeof device.createComputePipeline !== 'function' || typeof GPUBufferUsage === 'undefined') return null;
  try {
    const tex = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    const code = '@group(0) @binding(0) var t: texture_storage_2d<rgba16float, write>;\n' +
      '@compute @workgroup_size(1) fn main() { textureStore(t, vec2<u32>(0u, 0u), vec4<f32>(1.000732421875)); }';
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }] });
    const buf = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: 256 }, [1, 1]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const h = new Uint16Array(buf.getMappedRange().slice(0, 2))[0];
    buf.unmap(); buf.destroy(); tex.destroy();
    return h === 0x3c00 ? 'trunc' : 'nearest';   // 0x3c00 = 1,0 (obcięte); 0x3c01 = 1 + 2⁻¹⁰ (do najbliższej)
  } catch (e) {
    return null;
  }
}

/** Test urządzenia renderera raz na grę (w tle) → F16_ROUND_BIAS. Bez urządzenia — nic (zostaje obcięcie). */
export function ensureHalfRoundingProbe(renderer) {
  if (F16_ROUNDING.probing) return;
  const dev = renderer && renderer.backend && renderer.backend.device;
  if (!dev) return;
  F16_ROUNDING.probing = probeHalfRounding(dev).then((mode) => {
    F16_ROUNDING.mode = mode;
    F16_ROUND_BIAS.value = mode === 'nearest' ? 0.5 : 0;
    return mode;
  });
}
