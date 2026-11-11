// src/3d/planetGen/planetGenFiles.js
//
// PLANETA JAKO PLIKI MAP — planety przygotowane (kampania): wypiek robi się raz, u nas, w dowolnie dużej
// rozdzielczości, a gra wczytuje gotowe mapy. Każdy gracz widzi dokładnie tę samą planetę (bez różnic kart
// i sterowników w układzie rzek i brzegów) i nie czeka na generowanie. Planety trybu „sandbox” idą dalej z ziarna.
//
// Katalog planety:
//   meta.json          — format, opis planety (`spec` w całości — wczytanie nie zależy od `describePlanet`), poziomy
//                        z próby (`levels`), rozmiary, lista plików
//   day.webp           — mapa dnia (RGB, bajty sRGB jak w celu wypieku), day.a.png — jej alfa (lód morski)
//   night.webp, clouds.webp, spec.png, mask.png (+ *.a.png, gdy mapa ma alfę inną niż 1)
//   height.i16.bin     — wysokość: Int16, krok `HEIGHT_STEP_KM`, różnice w wierszu, osobno bajty młodsze i starsze,
//                        gzip. Nachylenia i szorstkość mapy rzeźby liczy przy wczytaniu ten sam graf co w wypieku.
//   drain.*.bin        — siatka spływu: tekstura rzek (RGBA8), wysokość [m], temperatura, wilgotność (dane miejsc)
// Pliki .bin mają w środku gzip, ale NIE rozszerzenie .gz: serwery (także Vite w dev) podają pliki .gz z nagłówkiem
// `Content-Encoding: gzip` i przeglądarka rozpakowuje je sama — wczytanie i tak rozpoznaje gzip po pierwszych bajtach.
// Wiersz 0 każdej mapy = wiersz 0 celu wypieku (biegun S) — obrazy są „do góry nogami” względem mapy z północą u góry.
//
// Najgłębsze zbliżenia (okno pod kamerą) liczą się nadal na karcie gracza — z tych samych poziomów i tej samej
// siatki rzek, więc układ zostaje ten sam; różnice kart dotyczą tam tylko drobnego detalu.
//
// Część czysta (kodeki, opis plików) działa w Node; zapis i wczytanie — w przeglądarce (kanwa, createImageBitmap).
import * as THREE from 'three/webgpu';

export const PLANET_FILES_FORMAT = 1;
/** Krok wysokości w pliku [km] (0,5 m; zakres ±16 km). */
export const HEIGHT_STEP_KM = 0.0005;

// ── kodeki (czyste) ───────────────────────────────────────────────────────────────────────────────────────────────
/** Wysokość [km] → Int16 w krokach `HEIGHT_STEP_KM` (przycięta do zakresu). */
export function quantizeHeight(km) {
  const v = Math.round(km / HEIGHT_STEP_KM);
  return v > 32767 ? 32767 : (v < -32768 ? -32768 : v);
}
/** Połówka (IEEE 754 binary16) → liczba. */
export function halfToFloat(x) {
  const s = (x & 0x8000) ? -1 : 1;
  const e = (x & 0x7C00) >> 10;
  const f = x & 0x3FF;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
/**
 * Int16 (W × H) → bajty: różnica względem lewego sąsiada w wierszu (mod 2^16), najpierw wszystkie bajty młodsze, potem
 * starsze — teren zmienia się łagodnie, więc starsze bajty to prawie same zera (gzip zwija je do niczego).
 */
export function deltaEncode16(src, W, H) {
  const n = W * H;
  const out = new Uint8Array(n * 2);
  for (let y = 0; y < H; y++) {
    let prev = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const v = src[row + x];
      const d = (v - prev) & 0xFFFF;
      prev = v;
      out[row + x] = d & 0xFF;
      out[n + row + x] = d >> 8;
    }
  }
  return out;
}
export function deltaDecode16(bytes, W, H) {
  const n = W * H;
  if (bytes.length !== n * 2) throw new Error(`planetGenFiles: wysokość ma ${bytes.length} B, oczekiwano ${n * 2}`);
  const out = new Int16Array(n);
  for (let y = 0; y < H; y++) {
    let prev = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      prev = (prev + (bytes[row + x] | (bytes[n + row + x] << 8))) & 0xFFFF;
      out[row + x] = prev;      // (zapis do Int16Array zawija 0…65535 do −32768…32767)
    }
  }
  return out;
}
async function pipeBytes(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export const gzipBytes = (bytes) => pipeBytes(bytes, new CompressionStream('gzip'));
export const gunzipBytes = (bytes) => pipeBytes(bytes, new DecompressionStream('gzip'));
/** Dane pliku .bin: gzip (pierwsze bajty 1F 8B) → rozpakowane; już rozpakowane przez serwer / przeglądarkę → bez zmian. */
export const maybeGunzip = async (bytes) => (bytes.length > 2 && bytes[0] === 0x1F && bytes[1] === 0x8B ? gunzipBytes(bytes) : bytes);

/** Mapy 8-bitowe: plik, rodzaj celu, kodowanie obrazu (stratne tam, gdzie mapa jest obrazem; bezstratne dla masek). */
export const PLANET_FILE_MAPS = Object.freeze({
  day: { srgb: true, type: 'image/webp', quality: 0.95, ext: 'webp' },
  night: { srgb: true, type: 'image/webp', quality: 0.92, ext: 'webp', half: true },
  clouds: { srgb: true, type: 'image/webp', quality: 0.92, ext: 'webp' },
  spec: { srgb: false, type: 'image/png', ext: 'png', half: true, red: true },
  mask: { srgb: false, type: 'image/png', ext: 'png' }
});

/** Sprawdzenie opisu plików (meta.json) — rzuca przy nieznanym formacie albo brakach. */
export function checkPlanetMeta(meta) {
  if (!meta || meta.format !== PLANET_FILES_FORMAT) throw new Error(`planetGenFiles: nieznany format plików planety (${meta && meta.format})`);
  if (!meta.spec || !meta.spec.type || !(meta.size > 0) || !meta.levels || !meta.maps || !meta.maps.day || !meta.height) {
    throw new Error('planetGenFiles: niepełny opis planety (meta.json)');
  }
  return meta;
}

// ── zapis (przeglądarka) ──────────────────────────────────────────────────────────────────────────────────────────
async function encodeImage(rgba, w, h, type, quality) {
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  return c.convertToBlob({ type, quality });
}
/**
 * Wypieczona planeta → pliki. `baked` — wynik `PlanetGenBaker.bakeSystem` (planeta z powierzchnią). Zwraca
 * { meta, files: [{ name, blob }] } — `meta` jest też pierwszym plikiem (meta.json).
 */
export async function exportPlanet(renderer, baked, { name = '' } = {}) {
  if (!baked || !baked.rt || !baked.rt.relief) throw new Error('planetGenFiles: zapis tylko planet z powierzchnią (mapa rzeźby)');
  const t0 = performance.now();
  const files = [];
  const meta = {
    format: PLANET_FILES_FORMAT, name, size: baked.size, rows: 'south-first', heightStepKm: HEIGHT_STEP_KM,
    spec: JSON.parse(JSON.stringify(baked.spec)), levels: JSON.parse(JSON.stringify(baked.levels)), maps: {}, height: null, drainage: null
  };
  const read = async (rt) => {
    const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, rt.width, rt.height);
    return { px, w: rt.width, h: rt.height, row: px.length / rt.height };
  };
  for (const [key, def] of Object.entries(PLANET_FILE_MAPS)) {
    const rt = baked.rt[key];
    if (!rt) continue;
    const { px, w, h, row } = await read(rt);
    const ch = Math.round(row / w) >= 4 ? 4 : 1;
    const rgb = new Uint8ClampedArray(w * h * 4);
    let alpha = null;
    for (let y = 0; y < h; y++) {
      const s = y * row;
      const o = y * w * 4;
      if (ch === 1) {
        for (let x = 0; x < w; x++) { const v = px[s + x]; rgb[o + x * 4] = v; rgb[o + x * 4 + 1] = v; rgb[o + x * 4 + 2] = v; rgb[o + x * 4 + 3] = 255; }
      } else {
        for (let x = 0; x < w; x++) {
          const i = s + x * 4;
          const j = o + x * 4;
          rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; rgb[j + 3] = 255;
          const a = px[i + 3];
          if (a !== 255) {
            if (!alpha) { alpha = new Uint8ClampedArray(w * h * 4); for (let k = 0; k < w * h; k++) { alpha[k * 4] = 255; alpha[k * 4 + 1] = 255; alpha[k * 4 + 2] = 255; alpha[k * 4 + 3] = 255; } }
            const q = (y * w + x) * 4;
            alpha[q] = a; alpha[q + 1] = a; alpha[q + 2] = a;
          }
        }
      }
    }
    const file = `${key}.${def.ext}`;
    files.push({ name: file, blob: await encodeImage(rgb, w, h, def.type, def.quality) });
    const m = { file, w, h, srgb: !!def.srgb, red: ch === 1, alpha: null };
    if (alpha) { m.alpha = `${key}.a.png`; files.push({ name: m.alpha, blob: await encodeImage(alpha, w, h, 'image/png') }); }
    meta.maps[key] = m;
  }
  // wysokość z mapy rzeźby (kanał x; połówki albo float)
  {
    const { px, w, h, row } = await read(baked.rt.relief);
    const isHalf = !(px instanceof Float32Array);
    let lut = null;
    if (isHalf) { lut = new Float32Array(65536); for (let i = 0; i < 65536; i++) lut[i] = halfToFloat(i); }
    const q = new Int16Array(w * h);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = isHalf ? lut[px[y * row + x * 4]] : px[y * row + x * 4];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        q[y * w + x] = quantizeHeight(v);
      }
    }
    files.push({ name: 'height.i16.bin', blob: new Blob([await gzipBytes(deltaEncode16(q, w, h))]) });
    meta.height = { file: 'height.i16.bin', w, h, minKm: lo, maxKm: hi };
  }
  if (baked.drainage) {
    const d = baked.drainage;
    const raw = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const put = async (file, arr) => { files.push({ name: file, blob: new Blob([await gzipBytes(raw(arr))]) }); return file; };
    meta.drainage = {
      width: d.width, height: d.height, uniforms: [...d.uniforms], stats: d.stats,
      // (wysokość siatki spływu — ten sam kodek różnicowy co mapa wysokości)
      data: await put('drain.data.bin', d.data), heightM: await put('drain.height.bin', deltaEncode16(d.heightM, d.width, d.height)),
      temp: await put('drain.temp.bin', d.temp), moist: await put('drain.moist.bin', d.moist)
    };
  }
  meta.bytes = files.reduce((s, f) => s + f.blob.size, 0);
  meta.exportMs = Math.round(performance.now() - t0);
  files.unshift({ name: 'meta.json', blob: new Blob([JSON.stringify(meta, null, 1)], { type: 'application/json' }) });
  return { meta, files };
}

// ── wczytanie (przeglądarka) ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Pliki planety → wynik o kształcie `bakeSystem` (mapy, poziomy, siatka spływu) — przez `baker.importPlanet`.
 * `baseUrl` — katalog planety (z ukośnikiem na końcu). Zwraca `baked` z `ms` = { fetch, decode, gpu, total } i `files`.
 */
export async function loadPlanet(baker, baseUrl) {
  const t0 = performance.now();
  const get = async (file) => {
    const res = await fetch(baseUrl + file);
    if (!res.ok) throw new Error(`planetGenFiles: brak pliku ${baseUrl}${file} (${res.status})`);
    return res;
  };
  const meta = checkPlanetMeta(await (await get('meta.json')).json());
  const sources = [];
  const image = async (file) => {
    const bmp = await createImageBitmap(await (await get(file)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = new THREE.Texture(bmp);
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    sources.push({ t, bmp });
    return t;
  };
  const bytes = async (file) => maybeGunzip(new Uint8Array(await (await get(file)).arrayBuffer()));
  const jobs = [];
  const images = {};
  for (const [key, m] of Object.entries(meta.maps)) {
    jobs.push(image(m.file).then((t) => { images[key] = t; }));
    if (m.alpha) jobs.push(image(m.alpha).then((t) => { images[`${key}A`] = t; }));
  }
  let height = null;
  jobs.push(bytes(meta.height.file).then((b) => {
    const q = deltaDecode16(b, meta.height.w, meta.height.h);
    height = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) height[i] = q[i] * meta.heightStepKm;
  }));
  let drainage = null;
  if (meta.drainage) {
    const d = meta.drainage;
    drainage = { width: d.width, height: d.height, uniforms: d.uniforms, stats: d.stats };
    jobs.push(bytes(d.data).then((b) => { drainage.data = b; }));
    jobs.push(bytes(d.heightM).then((b) => { drainage.heightM = deltaDecode16(b, d.width, d.height); }));
    jobs.push(bytes(d.temp).then((b) => { drainage.temp = b; }));
    jobs.push(bytes(d.moist).then((b) => { drainage.moist = b; }));
  }
  await Promise.all(jobs);
  const tDecode = performance.now();
  const baked = baker.importPlanet({ spec: meta.spec, size: meta.size, levels: meta.levels, drainage, images, height, maps: meta.maps });
  const device = baker.renderer.backend?.device;
  if (device?.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
  for (const s of sources) { s.t.dispose(); if (s.bmp.close) s.bmp.close(); }
  const t1 = performance.now();
  baked.ms = { decode: tDecode - t0, gpu: t1 - tDecode, total: t1 - t0 };
  baked.files = { name: meta.name, bytes: meta.bytes, url: baseUrl };
  return baked;
}
