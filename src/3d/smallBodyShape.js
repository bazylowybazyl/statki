// src/3d/smallBodyShape.js
//
// Kształt brył MAŁYCH CIAŁ (src/data/smallBodies.js): mapa promienia z generatora (scripts/planety/male_ciala.py,
// `<id>_hf_shape.png`) — d = r / R − 1 w 16 bitach (R starszy bajt, G młodszy) w zakresie SMALL_BODY_SHAPE_RANGE
// (planetMaps.js), równoodległa jak mapy dnia (kolumna 0 = 180° W, wiersz 0 = biegun płn.). Siatka kuli przesuwana
// wzdłuż promienia na CPU raz po wczytaniu: układ atrybutów jak zwykła kula — ten sam pipeline co księżyce.
// Czyste funkcje (bez Core3D) — gra (planet3d.assets.js: DirectSmallBody), demo (dema/planety-webgpu.js) i testy.
import * as THREE from 'three/webgpu';

/** Gęstość siatki ciała (szerokość × wysokość oczek). */
export const SMALL_BODY_SEGMENTS = Object.freeze({ w: 256, h: 128 });

/** Bajty RGBA (getImageData) → { w, h, d: Float32Array, poleN, poleS }. */
export function decodeSmallBodyShape(rgba, w, h, range) {
  const d = new Float32Array(w * h);
  const lo = range[0];
  const k = (range[1] - range[0]) / 65535;
  for (let i = 0; i < w * h; i++) d[i] = lo + (rgba[i * 4] * 256 + rgba[i * 4 + 1]) * k;
  let sn = 0;
  let ss = 0;
  for (let i = 0; i < w; i++) { sn += d[i]; ss += d[(h - 1) * w + i]; }
  return { w, h, d, poleN: sn / w, poleS: ss / w };
}

const _cache = new Map();
/** Mapa kształtu z pliku (Promise, wspólna dla wszystkich ciał z tą samą ścieżką i zakresem). */
export function loadSmallBodyShape(url, range) {
  const key = `${url}|${range[0]}|${range[1]}`;
  let p = _cache.get(key);
  if (p) return p;
  p = new Promise((resolve, reject) => {
    new THREE.ImageLoader().load(url, (img) => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const cv = typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve(decodeSmallBodyShape(ctx.getImageData(0, 0, w, h).data, w, h, range));
      } catch (err) { reject(err); }
    }, undefined, reject);
  });
  _cache.set(key, p);
  return p;
}

/** Promień względny w punkcie mapy (u ∈ [0, 1] zawinięte, v: 1 = biegun płn. = wiersz 0), dwuliniowo. */
export function sampleSmallBodyShape(s, u, v) {
  const fx = (((u % 1) + 1) % 1) * s.w - 0.5;
  const fy = Math.min(s.h - 1, Math.max(0, (1 - v) * s.h - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % s.w) + s.w) % s.w;
  const xb = (xa + 1) % s.w;
  const yb = Math.min(s.h - 1, y0 + 1);
  const a = s.d[y0 * s.w + xa] * (1 - tx) + s.d[y0 * s.w + xb] * tx;
  const b = s.d[yb * s.w + xa] * (1 - tx) + s.d[yb * s.w + xb] * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Siatka kuli (SphereGeometry: wiersze iy = 0 … h od bieguna płn., kolumny ix = 0 … w, szew ix = 0 ≡ ix = w)
 * przesunięta wzdłuż promienia o d(u, v); bieguny — średnia skrajnego wiersza mapy (jeden punkt, bez pęknięcia),
 * normalne z bryły uśrednione na szwie i biegunach. Zwraca promień obwiedni (× promień średni).
 */
export function displaceSmallBodyGeometry(geometry, shape, seg = SMALL_BODY_SEGMENTS) {
  const pos = geometry.attributes.position;
  const uvA = geometry.attributes.uv;
  const W = seg.w;
  const H = seg.h;
  let maxR = 0;
  for (let iy = 0; iy <= H; iy++) {
    for (let ix = 0; ix <= W; ix++) {
      const i = iy * (W + 1) + ix;
      const d = iy === 0 ? shape.poleN : (iy === H ? shape.poleS : sampleSmallBodyShape(shape, uvA.getX(i), uvA.getY(i)));
      const k = 1 + d;
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      pos.setXYZ(i, (x / l) * k, (y / l) * k, (z / l) * k);
      if (k > maxR) maxR = k;
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  const nrm = geometry.attributes.normal;
  let ax;
  let ay;
  let az;
  for (let iy = 0; iy <= H; iy++) {
    const a = iy * (W + 1);
    const b = a + W;
    if (iy === 0 || iy === H) {
      ax = 0; ay = 0; az = 0;
      for (let ix = 0; ix <= W; ix++) { ax += nrm.getX(a + ix); ay += nrm.getY(a + ix); az += nrm.getZ(a + ix); }
    } else {
      ax = nrm.getX(a) + nrm.getX(b); ay = nrm.getY(a) + nrm.getY(b); az = nrm.getZ(a) + nrm.getZ(b);
    }
    const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= l; ay /= l; az /= l;
    if (iy === 0 || iy === H) {
      for (let ix = 0; ix <= W; ix++) nrm.setXYZ(a + ix, ax, ay, az);
    } else {
      nrm.setXYZ(a, ax, ay, az);
      nrm.setXYZ(b, ax, ay, az);
    }
  }
  nrm.needsUpdate = true;
  geometry.computeBoundingSphere();
  return maxR;
}
