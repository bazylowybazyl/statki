// src/3d/sparkSystem3D.js
import * as THREE from 'three';

const sparkVertexShader = /* glsl */`
  uniform float uTime;

  attribute vec3 iPosition;
  attribute vec3 iVelocity;
  attribute float iStartTime;
  attribute float iLifeTime;
  attribute float iSize;

  varying float vAge;
  varying vec2 vUv;
  varying float vSpeed;
  varying float vStartTime;

  void main() {
    vUv = uv;
    vStartTime = iStartTime;

    // Guard: Bezpieczne cull-owanie (unikamy czarnych kwadratow na niektorych sterownikach GPU)
    if (iLifeTime <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // Odcina wierzcholek poza ekranem
      vAge = 2.0;
      vSpeed = 0.0;
      return;
    }

    float age = (uTime - iStartTime) / iLifeTime;
    vAge = age;

    if (age < 0.0 || age > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float timeAlive = uTime - iStartTime;
    float drag = 0.5;
    vec3 currentVel = iVelocity * exp(-drag * timeAlive);
    vec3 currentPos = iPosition + iVelocity * (1.0 - exp(-drag * timeAlive)) / drag;

    // FIZYKA GRY: Y to u nas Z w WebGL! Przelaczamy fizyke na plaszczyzne XZ
    float speed = length(currentVel.xz);
    vSpeed = speed;
    float visualSpeed = min(speed, 1400.0);
    float visualSize = clamp(iSize, 0.12, 0.9);

    vec2 fwd2 = (speed > 0.01) ? normalize(currentVel.xz) : vec2(1.0, 0.0);
    vec2 right2 = vec2(-fwd2.y, fwd2.x);

    float thickness = min(((3.0 + visualSpeed * 0.0012) * (1.0 - age * 0.6)) * visualSize, 9.0);
    float sparkLength = min((visualSpeed * 0.018 + 12.0) * visualSize, 95.0);

    // Offset geometryczny quada
    vec2 offset = fwd2 * (position.x * sparkLength) + right2 * (position.y * thickness);

    // Rzutowanie na plaszczyzne XZ dla kamery Orthographic (patrzacej w dol)
    vec3 worldPos = vec3(currentPos.x + offset.x, currentPos.y, currentPos.z + offset.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

const sparkFragmentShader = /* glsl */`
  uniform float uTime;
  uniform vec3 uSparkColor;

  varying float vAge;
  varying vec2 vUv;
  varying float vSpeed;
  varying float vStartTime;

  void main() {
    if (vAge < 0.0 || vAge > 1.0) discard;

    float intensity = 1.0 - vUv.x;
    float edge = sin(vUv.y * 3.14159);
    intensity *= pow(edge, 1.5);
    intensity *= (1.0 - pow(vAge, 2.0));

    float flicker = 0.6 + 0.4 * sin(uTime * 60.0 + vStartTime * 123.45);
    intensity *= mix(1.0, flicker, smoothstep(0.2, 0.8, vAge));

    vec3 colorWhite = vec3(1.0, 1.0, 1.0);
    vec3 colorCore  = mix(colorWhite, uSparkColor, 0.5);
    vec3 colorMid   = uSparkColor;
    vec3 colorCool  = vec3(0.5, 0.1, 0.0);
    vec3 colorDead  = vec3(0.1, 0.02, 0.0);

    vec3 color;
    if      (vAge < 0.1) color = mix(colorWhite, colorCore, vAge / 0.1);
    else if (vAge < 0.3) color = mix(colorCore, colorMid, (vAge - 0.1) / 0.2);
    else if (vAge < 0.7) color = mix(colorMid, colorCool, (vAge - 0.3) / 0.4);
    else                 color = mix(colorCool, colorDead, (vAge - 0.7) / 0.3);

    float boost = mix(4.0, 0.5, pow(vAge, 0.5));

    gl_FragColor = vec4(color * intensity * boost, intensity);
  }
`;

const MAX_SPARKS = 20000;
const DEFAULT_COLOR = new THREE.Color(0xff4d00);
const MIN_SPARK_SIZE = 0.12;
const MAX_SPARK_SIZE = 0.9;
const MIN_SPARK_LIFE = 0.05;
const MAX_SPARK_LIFE = 0.9;
const MAX_GRINDING_VISUAL_ENERGY = 650;

let mesh = null;
let material = null;
let geometry = null;
let iPositions, iVelocities, iStartTimes, iLifeTimes, iSizes;
let idx = 0;
let isDirty = false;
let globalTime = 0;

export const SparkSystem3D = {
  isInitialized: false,

  init(scene) {
    if (this.isInitialized) return;

    const baseGeo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0, -0.5, 0,  1, -0.5, 0,  1, 0.5, 0,
      0, -0.5, 0,  1, 0.5, 0,   0, 0.5, 0
    ]);
    const uvs = new Float32Array([
      0, 0,  1, 0,  1, 1,
      0, 0,  1, 1,  0, 1
    ]);
    baseGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    baseGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', baseGeo.getAttribute('position'));
    geometry.setAttribute('uv', baseGeo.getAttribute('uv'));
    geometry.instanceCount = MAX_SPARKS;

    iPositions  = new Float32Array(MAX_SPARKS * 3);
    iVelocities = new Float32Array(MAX_SPARKS * 3);
    iStartTimes = new Float32Array(MAX_SPARKS).fill(-999.0);
    iLifeTimes  = new Float32Array(MAX_SPARKS);
    iSizes      = new Float32Array(MAX_SPARKS);

    geometry.setAttribute('iPosition',  new THREE.InstancedBufferAttribute(iPositions, 3));
    geometry.setAttribute('iVelocity',  new THREE.InstancedBufferAttribute(iVelocities, 3));
    geometry.setAttribute('iStartTime', new THREE.InstancedBufferAttribute(iStartTimes, 1));
    geometry.setAttribute('iLifeTime',  new THREE.InstancedBufferAttribute(iLifeTimes, 1));
    geometry.setAttribute('iSize',      new THREE.InstancedBufferAttribute(iSizes, 1));

    material = new THREE.ShaderMaterial({
      vertexShader: sparkVertexShader,
      fragmentShader: sparkFragmentShader,
      uniforms: {
        uTime:       { value: 0.0 },
        uSparkColor: { value: DEFAULT_COLOR.clone() }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 900;
    mesh.layers.set(0);
    scene.add(mesh);

    this.isInitialized = true;
  },

  emit(gameX, gameY, vx, vy, life, size) {
    if (!this.isInitialized) return;
    const i = idx;
    const i3 = i * 3;

    // Przerzucenie osi z 2D na 3D
    iPositions[i3]     = gameX;
    iPositions[i3 + 1] = 0.5; // Wysokosc (leciutko nad podloga by nie klipowac)
    iPositions[i3 + 2] = gameY;

    iVelocities[i3]     = vx;
    iVelocities[i3 + 1] = 0;
    iVelocities[i3 + 2] = vy;

    iStartTimes[i] = globalTime;
    iLifeTimes[i]  = THREE.MathUtils.clamp(Number.isFinite(life) ? life : 0.25, MIN_SPARK_LIFE, MAX_SPARK_LIFE);
    iSizes[i]      = THREE.MathUtils.clamp(size !== undefined ? size : 0.5, MIN_SPARK_SIZE, MAX_SPARK_SIZE);

    idx = (idx + 1) % MAX_SPARKS;
    isDirty = true;
  },

  burst(gameX, gameY, count, speed, life, size, colorHex) {
    if(colorHex) this.setColor(colorHex);
    for (let n = 0; n < count; n++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = speed * (0.4 + Math.random() * 0.6);
      const vx = Math.cos(angle) * spd;
      const vy = Math.sin(angle) * spd;
      const l = life * (0.6 + Math.random() * 0.4);
      const s = size * (0.6 + Math.random() * 0.4);
      this.emit(gameX, gameY, vx, vy, l, s);
    }
  },

  update(dt) {
    if (!this.isInitialized) return;
    globalTime += dt;
    material.uniforms.uTime.value = globalTime;

    if (isDirty) {
      const attrs = geometry.attributes;
      attrs.iPosition.needsUpdate  = true;
      attrs.iVelocity.needsUpdate  = true;
      attrs.iStartTime.needsUpdate = true;
      attrs.iLifeTime.needsUpdate  = true;
      attrs.iSize.needsUpdate      = true;
      isDirty = false;
    }
  },

  // Nowa funkcja dla tarcia i zderzen statkow
  grindingBurst(gameX, gameY, normalX, normalY, tangentX, tangentY, bounceForce, slideSpeed, baseVx, baseVy) {
    if (!this.isInitialized) return;

    // Calkowita energia decyduje o sile wyrzutu i progu minimalnym
    const totalEnergy = bounceForce + Math.abs(slideSpeed) * 3.0;
    if (totalEnergy < 15) return;
    const visualEnergy = Math.min(totalEnergy, MAX_GRINDING_VISUAL_ENERGY);

    const count = Math.min(120, Math.floor(5 + totalEnergy * 0.15));
    const bounceRatio = Math.min(1.0, bounceForce / (totalEnergy + 0.001));

    // Dynamiczny wektor glowny (normalna + lekki znos z poslizgu)
    let mDx = normalX * (bounceRatio + 0.1) + tangentX * (1.0 - bounceRatio);
    let mDy = normalY * (bounceRatio + 0.1) + tangentY * (1.0 - bounceRatio);
    const mLen = Math.hypot(mDx, mDy) || 1;
    mDx /= mLen;
    mDy /= mLen;

    // Aproksymacja krzywej Gaussa (od -1.0 do 1.0)
    const randomGaussian = () => ((Math.random() + Math.random() + Math.random()) / 1.5) - 1.0;

    for (let i = 0; i < count; i++) {
      const spreadRadius = Math.min(180, visualEnergy * 0.28);
      const weight = Math.pow(Math.random(), 2.0);
      const scatterAmount = (1.0 - weight) * 2.0;

      // Rozrzut na plaszczyznie 2D (Y w WebGL to tutaj fizycznie Z)
      const pX = gameX + tangentX * randomGaussian() * spreadRadius + normalX * Math.random() * 20;
      const pY = gameY + tangentY * randomGaussian() * spreadRadius + normalY * Math.random() * 20;

      let dX = mDx + tangentX * randomGaussian() * scatterAmount + normalX * Math.abs(randomGaussian()) * scatterAmount;
      let dY = mDy + tangentY * randomGaussian() * scatterAmount + normalY * Math.abs(randomGaussian()) * scatterAmount;
      const dLen = Math.hypot(dX, dY) || 1;

      const speed = 180 + (visualEnergy * 0.18) + (weight * visualEnergy * 0.28) + Math.random() * 260;

      const vX = (dX / dLen) * speed + baseVx;
      const vY = (dY / dLen) * speed + baseVy;

      const lifeTime = 0.1 + (weight * 0.5) + Math.random() * 0.2;
      const size = 0.18 + weight * 0.42;

      this.emit(pX, pY, vX, vY, lifeTime, size);
    }
  },

  setColor(hex) {
    if (!material) return;
    material.uniforms.uSparkColor.value.set(hex);
  },

  dispose() {
    if (mesh && mesh.parent) mesh.parent.remove(mesh);
    if (geometry) geometry.dispose();
    if (material) material.dispose();
    mesh = null; geometry = null; material = null;
    iPositions = null; iVelocities = null; iStartTimes = null; iLifeTimes = null; iSizes = null;
    idx = 0;
    isDirty = false;
    globalTime = 0;
    this.isInitialized = false;
  }
};
