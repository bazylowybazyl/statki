// src/3d/shipProxyBatch3D.tsl.js
//
// Materiał statków-proxy ruchu v2 (Z4, shipProxyBatch3D.js) w TSL.
//
// Graf RAZ na moduł (docs/webgpu/PLAN.md §3): każdy rodzaj (tekstura kadłuba) dostaje lekki
// ShipProxyNodeMaterial na tych samych węzłach — jeden klucz programu, jeden NodeBuilder.
// Tekstury rodzaju w `material.uniforms` (uSprite, uSurfaceMap, uShapeMap, uNormalMap — czyta je węzeł
// tekstury per obiekt fragmentu kadłuba). Wartości wspólne (słońce względem początku) — uniformy grupy
// renderu, jeden zapis na klatkę (shipProxyBatch3D.js → begin).
//
// Instancja = 20 liczb w JEDNYM przeplecionym buforze (InstancedInterleavedBuffer): [0..1] oś x × szerokość,
// [2..3] (u0, v0) luku, [4..5] oś y × wysokość, [6..7] (u1, v1) luku, [8..11] (cos, sin, krycie, skóra luku),
// [12..13] środek względem początku przy kamerze, [14] lampy w shaderze, [15] odblask lakieru, [16] slot lamp
// i stref (HullLightStore, vec4), [17] liczba stref dysz, [18] waga lakieru. Siatka to Mesh +
// InstancedBufferGeometry, nie InstancedMesh (jego uuid wchodzi do klucza programu — NodeBuilder na każdy rodzaj).
// Pozycja: positionNode w układzie lokalnym, resztę robi modelViewMatrix three (highPrecision — początek
// w mesh.position, AGENTS.md: precyzja float32 przy 7 mln j.).
//
// Fragment = fragment PEŁNEGO kadłuba (E17, hullProxyFragmentNode z hexShips3D.tsl.js): oświetlenie v2 z mapą
// powierzchni, lakier, glow, lampy statku i strefy dysz — bez mapy ran, maskowania, warpa i żaru. Wartości per
// instancja idą do fragmentu w kilku vec4 (varyingi: limit międzyetapowy), liczby całkowite z zaokrągleniem.
import * as THREE from 'three/webgpu';
import {
  Discard, If,
  float, vec2, vec3, vec4,
  uniform, attribute, varying, uv, positionGeometry,
  clamp, dot, fract, length, normalize, round, screenCoordinate, select, step,
  renderGroup
} from 'three/tsl';
import { hullProxyFragmentNode } from './hexShips3D.tsl.js';

const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

/** Wartości wspólne wszystkich rodzajów (`.value` jak dawne obiekty `{ value }`). */
export const PROXY_SHARED = {
  uSunRel: shared(new THREE.Vector2()),
  uHasSun: shared(0)
};

/** Liczby na instancję w buforze z przeplotem. */
export const PROXY_INSTANCE_STRIDE = 20;

let graph = null;

function buildGraph() {
  const U = PROXY_SHARED;
  const iAxisX = attribute('iAxisX', 'vec4');
  const iAxisY = attribute('iAxisY', 'vec4');
  const iRot = attribute('iRot', 'vec4');
  const iCenter = attribute('iCenter', 'vec4');
  const iHull = attribute('iHull', 'vec4');

  // Kwad 1×1 → osie × wymiary sprite'a + środek (z = 0, płaszczyzna gry).
  const local = iAxisX.xy.mul(positionGeometry.x).add(iAxisY.xy.mul(positionGeometry.y)).add(iCenter.xy);
  const positionNode = vec3(local, 0.0);

  // Tekstury kadłubów mają flipY = false: v = 0 to górny wiersz PNG, a górę kwadu
  // (lokalne +y) obraca się razem z dziobem w +x. (u, v, cos, sin) obrotu.
  const vA = varying(vec4(uv().x, float(1.0).sub(uv().y), iRot.x, iRot.y), 'vProxyA');
  // Otwarty luk ładowni (E12, przeładunek w bańce — src/3d/cargo/portCargo3D.js): prostokąt otworu w uv sprite'a
  // (u0, v0) w iAxisX.zw, (u1, v1) w iAxisY.zw; pusty (u1 ≤ u0) — skóra cała. Pod otworem wnętrze ładowni.
  const vCut = varying(vec4(iAxisX.zw, iAxisY.zw), 'vProxyCut');
  // (krycie, skóra luku 0…1 przy domykaniu wrót, lampy w shaderze, odblask lakieru).
  const vB = varying(vec4(iRot.z, iRot.w, iCenter.z, iCenter.w), 'vProxyB');
  // Słońce jak u kadłubów (hexShips3D.js: normalize(słońce − statek, 600)) w układzie sceny, oba punkty względem
  // tego samego początku przy kamerze; w.: waga lakieru.
  const lightDir = select(U.uHasSun.greaterThan(0.5), normalize(vec3(U.uSunRel.sub(iCenter.xy), 600.0)), vec3(0.0, 0.0, 1.0));
  const vC = varying(vec4(lightDir, iHull.z), 'vProxyC');
  // (wymiary sprite'a w j. świata = px siatki kadłuba NPC, slot lamp, liczba stref dysz).
  const vD = varying(vec4(length(iAxisX.xy), length(iAxisY.xy), iHull.x, iHull.y), 'vProxyD');
  // Offset fragmentu od początku siatki w kierunkach świata (lakier: obłoki zakotwiczone w świecie).
  const vLocal = varying(local, 'vProxyLocalWorld');

  const perObject = {
    uRotCS: vA.zw,
    uRotation: float(0.0),
    uHasNormalMap: float(0.0),
    uBillboardLighting: float(0.0),
    uSpriteSize: vD.xy,
    uDmgWorld: vD.xy,
    uLightDir: normalize(vC.xyz),
    uLacquerWeight: vC.w,
    // Stała instancji po interpolacji może wyjść o ułamek ULP obok — liczby całkowite zaokrąglone.
    uShipLightCount: round(vB.z),
    uEngineZoneCount: round(vD.w),
    uLightBase: round(vD.z),
    uLacquerGlint: vB.w
  };

  const cutDiscard = (spriteUV) => {
    const inCut = step(vCut.x, spriteUV.x).mul(step(spriteUV.x, vCut.z)).mul(step(vCut.y, spriteUV.y)).mul(step(spriteUV.y, vCut.w));
    // Szum przeplotu (IGN) w pikselach ekranu: piksel otworu pokazuje skórę, gdy szum < skóra luku.
    const ign = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
    If(inCut.greaterThan(0.5).and(vCut.z.greaterThan(vCut.x)).and(ign.greaterThanEqual(vB.y)), () => {
      Discard();
    });
  };

  const fragmentNode = hullProxyFragmentNode({
    perObject,
    spriteUV: vA.xy,
    localWorld: vLocal,
    lodOpacity: clamp(vB.x, 0.0, 1.0),
    cutDiscard
  });

  return { positionNode, fragmentNode };
}

function getGraph() {
  if (!graph) graph = buildGraph();
  return graph;
}

/**
 * Materiał rodzaju: wspólny graf, tekstury kadłuba w `uniforms` (uSprite, uSurfaceMap, uShapeMap, uNormalMap —
 * obiekty `{ value }`, mapy powierzchni i kształtu lakieru wspólne z kadłubem NPC tego obrazu).
 * W `uniforms` tylko obiekty (klucz materiału three bierze liczby z pól jako 0/1).
 */
export class ShipProxyNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'ShipProxyNodeMaterial';
  }

  constructor(uniforms) {
    super();
    const g = getGraph();
    this.isShipProxyNodeMaterial = true;
    this.name = 'shipProxy';
    this.uniforms = uniforms;
    this.lights = false;
    this.fog = false;
    this.transparent = true;
    this.depthWrite = true;
    this.depthTest = true;
    this.side = THREE.DoubleSide;
    // Przezroczysty DoubleSide WebGPU rysowałby dwa razy (tył, przód) — ShaderMaterial raz.
    this.forceSinglePass = true;
    this.positionNode = g.positionNode;
    this.fragmentNode = g.fragmentNode;
  }
}

/**
 * Geometria rodzaju: kwad 1×1 (pozycja, uv, indeks) + bufor instancji z przeplotem.
 * Zwraca { geometry, buffer } — `buffer.array` to Float32Array(capacity × PROXY_INSTANCE_STRIDE).
 */
export function createProxyGeometry(quad, capacity) {
  const geometry = new THREE.InstancedBufferGeometry();
  // Własne kopie (kilkanaście liczb): dispose() geometrii w WebGPU niszczy bufory jej atrybutów —
  // wspólne z innymi rodzajami zniknęłyby im spod rysunku.
  geometry.setIndex(quad.index.clone());
  geometry.setAttribute('position', quad.getAttribute('position').clone());
  geometry.setAttribute('uv', quad.getAttribute('uv').clone());
  const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * PROXY_INSTANCE_STRIDE), PROXY_INSTANCE_STRIDE, 1);
  geometry.setAttribute('iAxisX', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute('iAxisY', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
  geometry.setAttribute('iRot', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
  geometry.setAttribute('iCenter', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
  geometry.setAttribute('iHull', new THREE.InterleavedBufferAttribute(buffer, 4, 16));
  geometry.instanceCount = 0;
  return { geometry, buffer };
}
