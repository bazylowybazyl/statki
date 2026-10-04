// src/3d/shipProxyBatch3D.tsl.js
//
// Materiał statków-proxy ruchu v2 (Z4, shipProxyBatch3D.js) w TSL — port z dawnego GLSL
// (ShaderMaterial „uSprite+uSunRel+uHasSun”, na WebGPU rysował się magentowym zamiennikiem).
//
// Graf RAZ na moduł (docs/webgpu/PLAN.md §3): każdy rodzaj (tekstura kadłuba) dostaje lekki
// ShipProxyNodeMaterial na tych samych węzłach — jeden klucz programu, jeden NodeBuilder.
// Tekstura rodzaju w `material.uniforms.uSprite.value` (teksturaObiektu, src/3d/tsl/).
// Wartości wspólne (słońce względem początku, strojenie światła) — uniformy grupy renderu,
// jeden zapis na klatkę (shipProxyBatch3D.js → begin).
//
// Instancja = 16 liczb w JEDNYM przeplecionym buforze (InstancedInterleavedBuffer, układ dawnej
// instanceMatrix): [0..3] oś x × szerokość, [4..7] oś y × wysokość, [8..10] (cos, sin, krycie),
// [12..13] środek względem początku przy kamerze. Siatka to Mesh + InstancedBufferGeometry,
// nie InstancedMesh (jego uuid wchodzi do klucza programu — NodeBuilder na każdy rodzaj).
// Pozycja: positionNode w układzie lokalnym, resztę robi modelViewMatrix three (highPrecision —
// początek w mesh.position, AGENTS.md: precyzja float32 przy 7 mln j.).
//
// Fragment = rdzeń światła kadłubów (hullFragmentNode w hexShips3D.tsl.js) bez mapy normalnych,
// lakieru, świateł statku, żaru i ran — zmieniając model światła kadłubów, zmień i ten.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard,
  float, vec2, vec3, vec4,
  uniform, attribute, varying, uv, positionGeometry,
  clamp, dot, max, normalize, pow, select, smoothstep, step,
  renderGroup
} from 'three/tsl';
import { fieldDarkness, sunFill, sunVisibility } from './sunShadowMask.js';
import { teksturaObiektu, teksturaZastepcza } from './tsl/teksturaObiektu.js';

const shared = (value, type) => uniform(value, type).setGroup(renderGroup);

/** Wartości wspólne wszystkich rodzajów (`.value` jak dawne obiekty `{ value }`). */
export const PROXY_SHARED = {
  uSunRel: shared(new THREE.Vector2()),
  uHasSun: shared(0),
  uDayAmbient: shared(0.24),
  uDayDiffuseMul: shared(1.18),
  uSpecularMul: shared(0.30)
};

/** Liczby na instancję w buforze z przeplotem. */
export const PROXY_INSTANCE_STRIDE = 16;

const PLACEHOLDER_SPRITE = teksturaZastepcza(0, 0, 0, 0, THREE.SRGBColorSpace);

let graph = null;

function buildGraph() {
  const U = PROXY_SHARED;
  const iAxisX = attribute('iAxisX', 'vec4');
  const iAxisY = attribute('iAxisY', 'vec4');
  const iRot = attribute('iRot', 'vec4');
  const iCenter = attribute('iCenter', 'vec4');

  // Kwad 1×1 → osie × wymiary sprite'a + środek (z = 0, płaszczyzna gry).
  const positionNode = vec3(
    iAxisX.xy.mul(positionGeometry.x).add(iAxisY.xy.mul(positionGeometry.y)).add(iCenter.xy),
    0.0
  );

  // Tekstury kadłubów mają flipY = false: v = 0 to górny wiersz PNG, a górę kwadu
  // (lokalne +y) obraca się razem z dziobem w +x.
  const vUv = varying(vec2(uv().x, float(1.0).sub(uv().y)), 'vProxyUv');
  const vRot = varying(iRot.xy, 'vProxyRot');
  const vOpacity = varying(iRot.z, 'vProxyOpacity');
  // Słońce jak u kadłubów: (słońce − statek, 600) w układzie sceny, oba punkty względem
  // tego samego początku przy kamerze.
  const vLightDir = varying(
    select(U.uHasSun.greaterThan(0.5), vec3(U.uSunRel.sub(iCenter.xy), 600.0), vec3(0.0, 0.0, 1.0)),
    'vProxyLightDir'
  );

  const fragmentNode = Fn(() => {
    const spriteUV = vUv.toVar();
    const armor = teksturaObiektu('uSprite', PLACEHOLDER_SPRITE, spriteUV);
    const alpha = armor.a.mul(clamp(vOpacity, 0.0, 1.0)).toVar();
    If(alpha.lessThan(0.01), () => {
      Discard();
    });
    const armorRgb = armor.rgb.toVar();

    // Poduszkowa normalna z UV sprite'a, obrócona z kadłubem. Clamp: MSAA ekstrapoluje
    // varyingi poza trójkąt.
    const p = clamp(spriteUV, 0.0, 1.0).mul(2.0).sub(1.0);
    const localNormal = normalize(vec3(p.x.mul(0.45), p.y.mul(-0.45), 1.0)).toVar();
    const c = vRot.x;
    const s = vRot.y;
    const worldNormal = normalize(vec3(
      localNormal.x.mul(c).sub(localNormal.y.mul(s)),
      localNormal.x.mul(s).add(localNormal.y.mul(c)),
      localNormal.z
    )).toVar();

    const lightDir = normalize(vLightDir).toVar();
    const NdotL = dot(worldNormal, lightDir).toVar();
    const dayDiffuse = max(0.0, NdotL).toVar();
    const sunVis = sunVisibility().toVar();
    const sunlitColor = armorRgb.mul(U.uDayAmbient.add(dayDiffuse.mul(U.uDayDiffuseMul))).toVar();
    const lightMul = U.uDayAmbient.mul(sunFill(sunVis)).add(dayDiffuse.mul(U.uDayDiffuseMul).mul(sunVis));
    const color = armorRgb.mul(lightMul).toVar();

    const halfVector = normalize(lightDir.add(vec3(0.0, 0.0, 1.0)));
    const spec = pow(max(dot(worldNormal, halfVector), 0.0), 32.0);
    const litMask = smoothstep(-0.02, 0.08, NdotL);
    color.addAssign(vec3(spec.mul(U.uSpecularMul).mul(litMask).mul(sunVis)));
    sunlitColor.addAssign(vec3(spec.mul(U.uSpecularMul).mul(litMask)));

    const isGlowing = step(0.6, sunlitColor.z).mul(step(sunlitColor.x, 0.5));
    const fieldLit = float(1.0).sub(fieldDarkness());
    const finalColor = color.add(sunlitColor.mul(isGlowing).mul(1.5).mul(fieldLit.mul(0.7).add(0.3)));
    return vec4(finalColor, alpha);
  })();

  return { positionNode, fragmentNode };
}

function getGraph() {
  if (!graph) graph = buildGraph();
  return graph;
}

/**
 * Materiał rodzaju: wspólny graf, tekstura kadłuba w `uniforms.uSprite.value`.
 * W `uniforms` tylko obiekty (klucz materiału three bierze liczby z pól jako 0/1).
 */
export class ShipProxyNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'ShipProxyNodeMaterial';
  }

  constructor(spriteTexture) {
    super();
    const g = getGraph();
    this.isShipProxyNodeMaterial = true;
    this.name = 'shipProxy';
    this.uniforms = { uSprite: { value: spriteTexture || null } };
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
 * Zwraca { geometry, buffer } — `buffer.array` to Float32Array(capacity × 16).
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
  geometry.instanceCount = 0;
  return { geometry, buffer };
}
