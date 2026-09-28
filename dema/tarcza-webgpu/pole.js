// ============================================================
// Pole tarczy na GPU — siatka kartezjańska w płaszczyźnie kadłuba (klatka
// lokalna 3D: x wzdłuż kadłuba, y w górę), prostokąt obejmujący obrys
// z marginesem. Komórka poza obrysem (r > r(θ)) to brzeg.
//
// Etap 2: układ siatki, maska obrysu (t = r / r(θ)) i tekstura pola
// (rgba16f: h, E, B, W) zapisywana w compute — wejście widoku ?debug=pole.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, int, ivec2, vec2, vec4, instancedArray, instanceIndex, textureStore, texture,
  length, exp, max, min
} from 'three/tsl';
import { sampleShieldProfileRadius } from '../../shieldSystem.js';

const MARGIN_CELLS = 3;

// Układ siatki dla profilu: dłuższy bok = longCells komórek.
export function fieldLayout(profile, longCells) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const S = 1440;
  for (let i = 0; i < S; i++) {
    const a = (i / S) * Math.PI * 2;
    const r = sampleShieldProfileRadius(profile, a);
    const x = Math.cos(a) * r, y = -Math.sin(a) * r;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX, h = maxY - minY;
  const cell = Math.max(w, h) / (longCells - 2 * MARGIN_CELLS);
  const W = Math.ceil(w / cell) + 2 * MARGIN_CELLS;
  const H = Math.ceil(h / cell) + 2 * MARGIN_CELLS;
  const x0 = (minX + maxX) * 0.5 - W * cell * 0.5;
  const y0 = (minY + maxY) * 0.5 - H * cell * 0.5;

  // Maska: t = r / r(θ) w środku komórki (≥ 1 poza obrysem).
  const mask = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const y = y0 + (j + 0.5) * cell;
    for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) * cell;
      const R = sampleShieldProfileRadius(profile, Math.atan2(-y, x));
      mask[j * W + i] = Math.hypot(x, y) / Math.max(R, 1e-3);
    }
  }
  return { W, H, cell, x0, y0, sizeX: W * cell, sizeY: H * cell, mask };
}

// Węzły wspólne dla materiałów — przeżywają przebudowę siatki (suwak jakości):
// materiały próbkują texNode.sample(uv), a przebudowa podmienia texNode.value.
export function createFieldShared() {
  const placeholder = new THREE.StorageTexture(4, 4);
  placeholder.type = THREE.HalfFloatType;
  return {
    texNode: texture(placeholder),
    uOrigin: uniform(new THREE.Vector2()),
    uSize: uniform(new THREE.Vector2(1, 1)),
    uCell: uniform(1),
    uMarker: uniform(new THREE.Vector4(0, 0, 0, 0)) // x, y, promień, siła (widok kontrolny)
  };
}

// Zasoby GPU pola dla danego układu. Tekstura: wiersz j = v j/H (StorageTexture
// nie jest odwracana — §9.5), więc uv = (xy − origin) / size bez odwracania v.
export function createField(renderer, profile, longCells, shared) {
  const L = fieldLayout(profile, longCells);
  const N = L.W * L.H;
  const tex = new THREE.StorageTexture(L.W, L.H);
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const maskBuf = instancedArray(L.mask, 'float');
  const { uOrigin, uCell, uMarker } = shared;
  uOrigin.value.set(L.x0, L.y0);
  uCell.value = L.cell;
  shared.uSize.value.set(L.sizeX, L.sizeY);
  shared.texNode.value = tex;

  // Publikacja do tekstury (etap 2: pole spoczynkowe + plamka kontrolna).
  const publish = Fn(() => {
    const id = int(instanceIndex);
    const i = id.mod(int(L.W));
    const j = id.div(int(L.W));
    const p = uOrigin.add(vec2(float(i).add(0.5), float(j).add(0.5)).mul(uCell));
    const t = maskBuf.element(id);
    const d = length(p.sub(uMarker.xy)).div(max(uMarker.z, 1.0));
    const blob = exp(d.mul(d).negate()).mul(uMarker.w).mul(min(max(float(1.0).sub(t), 0.0).mul(1e4), 1.0));
    textureStore(tex, ivec2(i, j), vec4(0.0, blob, 0.0, t));
  })().compute(N);

  const field = {
    layout: L, tex, maskBuf, shared,
    steps: 0,
    // Dane widoku kontrolnego i statystyki.
    describe() { return `${L.W}×${L.H} (komórka ${L.cell.toFixed(2)} j.)`; },
    step(/* dt */) {
      renderer.compute(publish);
      this.steps++;
    },
    dispose() {
      tex.dispose();
      publish.dispose?.();
    }
  };
  return field;
}
