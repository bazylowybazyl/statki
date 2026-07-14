import * as THREE from 'three';
import { Core3D } from './core3d.js';

const TAU = Math.PI * 2;
const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 512;
const ATLAS_REPEATS = 16;

export const RING_CITY_RENDER_MODE = Object.freeze({
    BAKED: 'baked',
    THREE_D: '3d'
});

export function resolveRingCityRenderMode() {
    if (typeof window === 'undefined') return RING_CITY_RENDER_MODE.THREE_D;
    const devMode = String(window.Dev?.ringCityMode || '').trim().toLowerCase();
    const queryMode = new URLSearchParams(window.location?.search || '').get('ringCity');
    const requested = String(queryMode || devMode || '').trim().toLowerCase();
    return requested === 'baked' ? RING_CITY_RENDER_MODE.BAKED : RING_CITY_RENDER_MODE.THREE_D;
}

function seededRandom(seed) {
    let state = (Number(seed) >>> 0) || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createCanvas(width, height) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function fillRect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function drawBakedCity(seed, width = ATLAS_WIDTH, height = ATLAS_HEIGHT) {
    const albedo = createCanvas(width, height);
    const emissive = createCanvas(width, height);
    const heightMap = createCanvas(width, height);
    if (!albedo || !emissive || !heightMap) return null;

    const a = albedo.getContext('2d', { alpha: false });
    const e = emissive.getContext('2d', { alpha: false });
    const h = heightMap.getContext('2d', { alpha: false });
    const rand = seededRandom(seed);

    const ground = a.createLinearGradient(0, 0, 0, height);
    ground.addColorStop(0, '#07111a');
    ground.addColorStop(0.5, '#101823');
    ground.addColorStop(1, '#050b12');
    a.fillStyle = ground;
    a.fillRect(0, 0, width, height);
    fillRect(e, 0, 0, width, height, '#000000');
    fillRect(h, 0, 0, width, height, '#050505');

    const cols = 16;
    const rows = 4;
    const roadX = 18;
    const roadY = 24;
    const cellW = width / cols;
    const cellH = height / rows;
    const roofColors = ['#263746', '#303842', '#26313c', '#3d3347', '#273d42', '#45412f'];
    const roofHighlights = ['#3f5f72', '#52606c', '#485867', '#624b6e', '#3e676b', '#6e6641'];
    const glowColors = ['#00d9ff', '#3aa7ff', '#d743ff', '#ffca3a', '#6dffda'];

    // Continuous streets make the rectangular texture tile seamlessly.
    for (let col = 0; col < cols; col++) {
        const x = col * cellW;
        fillRect(a, x - roadX * 0.5, 0, roadX, height, '#02070c');
        fillRect(e, x - 1, 0, 2, height, col % 2 ? '#003c59' : '#604400');
        for (let y = 8; y < height; y += 34) {
            fillRect(e, x - 5, y, 2, 9, '#00a7d7');
            fillRect(e, x + 3, y + 15, 2, 9, '#efad27');
        }
    }
    for (let row = 0; row <= rows; row++) {
        const y = row * cellH;
        fillRect(a, 0, y - roadY * 0.5, width, roadY, '#03080d');
        fillRect(e, 0, y - 1, width, 2, row % 2 ? '#09374a' : '#493709');
        for (let x = 12; x < width; x += 44) fillRect(e, x, y - 4, 16, 2, '#466a72');
    }

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const left = col * cellW + roadX * 0.65;
            const top = row * cellH + roadY * 0.65;
            const usableW = cellW - roadX * 1.3;
            const usableH = cellH - roadY * 1.3;
            const buildingCount = 3 + Math.floor(rand() * 4);

            for (let index = 0; index < buildingCount; index++) {
                const bw = usableW * (0.22 + rand() * 0.38);
                const bh = usableH * (0.24 + rand() * 0.42);
                const bx = left + rand() * Math.max(1, usableW - bw);
                const by = top + rand() * Math.max(1, usableH - bh);
                const colorIndex = Math.floor(rand() * roofColors.length);
                const heightValue = 80 + Math.floor(rand() * 165);
                const heightColor = `rgb(${heightValue},${heightValue},${heightValue})`;
                const glow = glowColors[Math.floor(rand() * glowColors.length)];

                fillRect(a, bx - 3, by - 3, bw + 6, bh + 6, '#020407');
                fillRect(a, bx, by, bw, bh, roofColors[colorIndex]);
                fillRect(a, bx + 4, by + 4, Math.max(2, bw - 8), Math.max(2, bh * 0.16), roofHighlights[colorIndex]);
                fillRect(h, bx, by, bw, bh, heightColor);

                if (bw > 22 && bh > 18) {
                    const inset = 5 + rand() * 5;
                    fillRect(a, bx + inset, by + inset, Math.max(3, bw - inset * 2), Math.max(3, bh - inset * 2), roofColors[(colorIndex + 1) % roofColors.length]);
                    const upper = Math.min(255, heightValue + 24);
                    fillRect(h, bx + inset, by + inset, Math.max(3, bw - inset * 2), Math.max(3, bh - inset * 2), `rgb(${upper},${upper},${upper})`);
                }

                const lightStep = 9 + Math.floor(rand() * 8);
                for (let x = bx + 5; x < bx + bw - 3; x += lightStep) {
                    fillRect(e, x, by + 2, 3, 2, glow);
                    fillRect(e, x + 3, by + bh - 4, 2, 2, glow);
                }
                for (let y = by + 8; y < by + bh - 4; y += lightStep) {
                    fillRect(e, bx + 2, y, 2, 3, glow);
                    fillRect(e, bx + bw - 4, y + 2, 2, 2, glow);
                }
                if (rand() > 0.72) {
                    fillRect(e, bx + bw * 0.25, by + bh * 0.42, Math.max(5, bw * 0.5), 3, glow);
                }
            }
        }
    }

    // Seam guard: copy a narrow strip so bilinear filtering sees identical ends.
    a.drawImage(albedo, 0, 0, 2, height, width - 2, 0, 2, height);
    e.drawImage(emissive, 0, 0, 2, height, width - 2, 0, 2, height);
    h.drawImage(heightMap, 0, 0, 2, height, width - 2, 0, 2, height);
    return { albedo, emissive, heightMap };
}

function normalCanvasFromHeight(heightCanvas, strength = 3.2) {
    const width = heightCanvas.width;
    const height = heightCanvas.height;
    const sourceCtx = heightCanvas.getContext('2d');
    const source = sourceCtx.getImageData(0, 0, width, height).data;
    const normal = createCanvas(width, height);
    if (!normal) return null;
    const targetCtx = normal.getContext('2d');
    const image = targetCtx.createImageData(width, height);
    const out = image.data;
    const sample = (x, y) => source[((y * width + x) * 4)];

    for (let y = 0; y < height; y++) {
        const ym = Math.max(0, y - 1);
        const yp = Math.min(height - 1, y + 1);
        for (let x = 0; x < width; x++) {
            const xm = x > 0 ? x - 1 : width - 1;
            const xp = x + 1 < width ? x + 1 : 0;
            let nx = -(sample(xp, y) - sample(xm, y)) * strength / 255;
            let ny = -(sample(x, yp) - sample(x, ym)) * strength / 255;
            let nz = 1;
            const invLen = 1 / Math.max(0.0001, Math.hypot(nx, ny, nz));
            nx *= invLen;
            ny *= invLen;
            nz *= invLen;
            const offset = (y * width + x) * 4;
            out[offset] = Math.round((nx * 0.5 + 0.5) * 255);
            out[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            out[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            out[offset + 3] = 255;
        }
    }
    targetCtx.putImageData(image, 0, 0);
    return normal;
}

export function createPolarRectGeometry(innerRadius, outerRadius, steps = 768, z = 7) {
    const inner = Math.max(1, Math.min(innerRadius, outerRadius));
    const outer = Math.max(inner + 1, Math.max(innerRadius, outerRadius));
    const count = Math.max(32, Math.floor(Number(steps) || 768));
    const positions = [];
    const uvs = [];
    for (let i = 0; i < count; i++) {
        const u0 = i / count;
        const u1 = (i + 1) / count;
        const a0 = u0 * TAU;
        const a1 = u1 * TAU;
        const p00 = [Math.cos(a0) * inner, Math.sin(a0) * inner, z];
        const p10 = [Math.cos(a0) * outer, Math.sin(a0) * outer, z];
        const p11 = [Math.cos(a1) * outer, Math.sin(a1) * outer, z];
        const p01 = [Math.cos(a1) * inner, Math.sin(a1) * inner, z];
        positions.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
        uvs.push(u0, 0, u0, 1, u1, 1, u0, 0, u1, 1, u1, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

export function resolveBakedCityBand(layout) {
    if (!layout?.inner) return null;
    return {
        innerRadius: layout.inner.innerR,
        outerRadius: layout.industrial?.outerR || layout.inner.outerR
    };
}

function configureAtlasTexture(texture, isColor = false) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(ATLAS_REPEATS, 1);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(8, Core3D.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

let sharedAtlasTextures = null;

function getSharedAtlasTextures(seed) {
    if (sharedAtlasTextures) return sharedAtlasTextures;
    const canvases = drawBakedCity(seed);
    if (!canvases) return null;
    const normalCanvas = normalCanvasFromHeight(canvases.heightMap);
    if (!normalCanvas) return null;
    sharedAtlasTextures = Object.freeze({
        map: configureAtlasTexture(new THREE.CanvasTexture(canvases.albedo), true),
        emissiveMap: configureAtlasTexture(new THREE.CanvasTexture(canvases.emissive), true),
        normalMap: configureAtlasTexture(new THREE.CanvasTexture(normalCanvas), false)
    });
    return sharedAtlasTextures;
}

export class RingCityBakedSurface {
    constructor(layout, key = 'ring', options = {}) {
        this.layout = layout;
        this.key = key;
        this.options = options;
        this.mesh = null;
        this.material = null;
        this.geometry = null;
    }

    build(damageTexture = null) {
        const cityBand = resolveBakedCityBand(this.layout);
        if (!cityBand) return null;
        const seed = ((this.layout.planetR || 1) * 2654435761 + this.key.length * 97) >>> 0;
        const atlas = getSharedAtlasTextures(seed);
        if (!atlas) return null;
        const { map, emissiveMap, normalMap } = atlas;

        this.geometry = createPolarRectGeometry(cityBand.innerRadius, cityBand.outerRadius, 768, 7);
        this.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map,
            normalMap,
            normalScale: new THREE.Vector2(0.9, 0.9),
            emissive: 0xffffff,
            emissiveMap,
            emissiveIntensity: 1.05,
            roughness: 0.7,
            metalness: 0.16,
            alphaMap: damageTexture || null,
            transparent: !!damageTexture,
            alphaTest: damageTexture ? 0.015 : 0,
            depthWrite: true,
            depthTest: true,
            side: THREE.FrontSide,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = `RingCityBakedSurface:${this.key}`;
        this.mesh.renderOrder = -1;
        this.mesh.userData.fgCategory = 'buildings';
        this.mesh.userData.isRingCityBakedSurface = true;
        this.mesh.userData.lodLevel = 'CORE';
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        if (Core3D?.enableForeground3D) Core3D.enableForeground3D(this.mesh);
        return this.mesh;
    }

    dispose() {
        if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
        this.geometry?.dispose?.();
        this.material?.dispose?.();
        // Atlas textures are intentionally shared by Earth/Mars and remain
        // warm across ring rebuilds. The module lifetime matches the renderer.
        this.mesh = null;
        this.geometry = null;
        this.material = null;
    }
}
