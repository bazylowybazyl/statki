// ============================================================
// Kadłub Atlasa: kwad z tekstury sprite'a (alfa), oświetlony tym samym
// światłem co reszta sceny (normalna z luminancji, liczona raz na CPU),
// plus dane dla tarczy i trafień:
//  • hexGrid.shards — komórki co 12 px sprite'a tam, gdzie alfa > 0,5
//    (origLx/origLy względem środka, y w dół, radius = pół odstępu), czyli
//    wejście getEntityShieldProfile → ten sam obrys co w grze;
//  • maska komórek do testu „pocisk w pancerzu” (przebicie tarczy).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  texture, uv, float, vec2, normalize, positionWorld, normalWorld, transformNormalToView
} from 'three/tsl';
import { loadImage, shotLight } from './wspolne.js';

export const ATLAS_SPRITE_URL = '/assets/capital_ship_rect_v1.png';
// Rozmiar kadłuba w grze: HULL_RENDER_PROFILES.atlas.length (3000) ×
// HULL_RENDER_WORLD_SCALE (0,6) = 1800 j. na dłuższy bok, jak
// getHullRenderSize('atlas', 3747, 1677) w src/data/ships.js.
export const ATLAS_LENGTH = 3000 * 0.6;
export const SHARD_STEP = 12;

export async function loadAtlasSprite(url = ATLAS_SPRITE_URL) {
  const img = await loadImage(url);
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;

  // Komórki kadłuba (siatka co SHARD_STEP px, próbka w środku komórki).
  const nx = Math.floor(W / SHARD_STEP), ny = Math.floor(H / SHARD_STEP);
  const mask = new Uint8Array(nx * ny);
  const shards = [];
  const half = SHARD_STEP / 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const sx = i * SHARD_STEP + half, sy = j * SHARD_STEP + half;
      if (px[(sy * W + sx) * 4 + 3] > 127) {
        mask[j * nx + i] = 1;
        const lx = sx - W / 2, ly = sy - H / 2;
        shards.push({ origLx: lx, origLy: ly, lx, ly, radius: half });
      }
    }
  }

  // Mapa normalnych z luminancji (pół rozdzielczości): wysokość = jasność × alfa,
  // Sobel, n = (−dH/dx, +dH/dy_obrazu, 1) — oś y obrazu w dół, w 3D w górę.
  const W2 = Math.ceil(W / 2), H2 = Math.ceil(H / 2);
  const cv2 = document.createElement('canvas');
  cv2.width = W2; cv2.height = H2;
  const c2 = cv2.getContext('2d', { willReadFrequently: true });
  c2.drawImage(img, 0, 0, W2, H2);
  const src = c2.getImageData(0, 0, W2, H2);
  const d = src.data;
  const h = new Float32Array(W2 * H2);
  for (let i = 0, n = W2 * H2; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    const lum = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    h[i] = lum * a + a * 0.35;
  }
  const at = (x, y) => h[(y < 0 ? 0 : (y >= H2 ? H2 - 1 : y)) * W2 + (x < 0 ? 0 : (x >= W2 ? W2 - 1 : x))];
  const S = 2.6;
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nxv = -gx * S, nyv = gy * S, nzv = 1;
      const l = Math.hypot(nxv, nyv, nzv);
      nxv /= l; nyv /= l; nzv /= l;
      const o = (y * W2 + x) * 4;
      d[o] = (nxv * 0.5 + 0.5) * 255;
      d[o + 1] = (nyv * 0.5 + 0.5) * 255;
      d[o + 2] = (nzv * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  c2.putImageData(src, 0, 0);

  return {
    img, W, H, shards,
    mask, maskNx: nx, maskNy: ny,
    normalCanvas: cv2,
    // Skala sprite'a → świat (spriteScale encji).
    scale: ATLAS_LENGTH / Math.max(W, H)
  };
}

// Czy punkt kadłuba (piksele sprite'a względem środka, y w dół) leży w pancerzu.
export function spriteHullHit(sprite, lx, ly) {
  const i = Math.floor((lx + sprite.W / 2) / SHARD_STEP);
  const j = Math.floor((ly + sprite.H / 2) / SHARD_STEP);
  if (i < 0 || j < 0 || i >= sprite.maskNx || j >= sprite.maskNy) return false;
  return sprite.mask[j * sprite.maskNx + i] === 1;
}

// Kwad kadłuba. extraEmissive(localXY) — dodatkowa emisja (poświata pola),
// localXY w klatce lokalnej 3D kadłuba (x wzdłuż kadłuba, y w górę).
export function createAtlasHullMesh(sprite, extraEmissive = null) {
  const w = sprite.W * sprite.scale, h = sprite.H * sprite.scale;
  const colorTex = new THREE.Texture(sprite.img);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.anisotropy = 8;
  colorTex.needsUpdate = true;
  const normalTex = new THREE.CanvasTexture(sprite.normalCanvas);
  normalTex.colorSpace = THREE.NoColorSpace;
  normalTex.anisotropy = 8;

  const m = new THREE.MeshStandardNodeMaterial();
  const map = texture(colorTex, uv());
  const albedo = map.rgb;
  const rough = float(0.56);
  const metal = float(0.22);
  m.colorNode = albedo;
  m.opacityNode = map.a;
  m.alphaTest = 0.5;
  m.roughnessNode = rough;
  m.metalnessNode = metal;
  const nLocal = normalize(texture(normalTex, uv()).xyz.mul(2.0).sub(1.0));
  m.normalNode = transformNormalToView(nLocal);
  let emissive = shotLight(albedo, rough, metal, positionWorld, normalize(normalWorld));
  if (extraEmissive) {
    // Pozycja lokalna kwadu (PlaneGeometry w XY): uv → współrzędne lokalne.
    const local = uv().sub(0.5).mul(vec2(w, h));
    emissive = emissive.add(extraEmissive(local, albedo));
  }
  m.emissiveNode = emissive;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.renderOrder = 0;
  return { mesh, material: m, width: w, height: h, colorTex, normalTex };
}
