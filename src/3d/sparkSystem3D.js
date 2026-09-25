// src/3d/sparkSystem3D.js
import * as THREE from 'three';
import { sceneOriginNearCamera } from './sceneOrigin.js';

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

    // Rzutowanie na plaszczyzne XZ dla kamery Orthographic (patrzacej w dol).
    // Pozycje sa wzgledem mesh.position (poczatek puli, patrz emit) - duzy
    // kawalek skladany w modelViewMatrix na CPU w double, float32 tu dostaje
    // male liczby (swiat lezy przy 5-10 mln j.).
    vec3 localPos = vec3(currentPos.x + offset.x, currentPos.y, currentPos.z + offset.y);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(localPos, 1.0);
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
// Pula 20 000 iskier wisiala w scenie od startu gry z `frustumCulled = false`,
// wiec karta liczyla vertex shader dla wszystkich slotow na kazda klatke, nawet
// gdy nikt nie strzelal. Trzymamy high-water uzytych slotow, moment wygasniecia
// najdluzszej iskry i zakres dotknietych indeksow — dzieki temu instanceCount
// spada do 0, siatka znika ze sceny, a upload obejmuje tylko zapisany wycinek.
let highWater = 0;
let liveUntil = -Infinity;
let dirtyLo = -1;
let dirtyHi = -1;
// Poczatek ukladu puli przy kamerze gry (x, z sceny overlay = x, y swiata).
// Swiat lezy przy 5-10 mln j., gdzie float32 ma krok 0,5 j.: bezwzgledne
// iPosition drgaly na GPU ~1 px x zoom, a ruch iskry szedl skokami po 0,5 j.
// Poczatek jest "lepki": pusta pula bierze go od kamery przy pierwszej iskrze,
// zywa trzyma go, az kamera odjedzie o SPARK_REBASE_DIST (rebaseSparks w
// update), wiec zapisanych danych zwykle nie trzeba przesuwac (iskra zyje
// <= 0,9 s). Iskry daleko od kamery maja wieksze liczby — i tak ich nie widac.
const SPARK_REBASE_DIST = 100000;
let originX = 0;
let originZ = 0;
const _camOrigin = { x: 0, y: 0 };

function cameraOrigin() {
  const o = sceneOriginNearCamera(_camOrigin);
  // Scena Core3D ma (x, -y) swiata; overlay: x = x, z = y swiata.
  o.y = -o.y;
  return o;
}

function setSparkOrigin(x, z) {
  originX = x;
  originZ = z;
  mesh.position.set(x, 0, z);
}

// Przesuwa zywe iskry do nowego poczatku (caly uzyty zakres na GPU).
function rebaseSparks(x, z) {
  const dx = originX - x;
  const dz = originZ - z;
  for (let i = 0; i < highWater; i++) {
    iPositions[i * 3] += dx;
    iPositions[i * 3 + 2] += dz;
  }
  if (highWater > 0) {
    dirtyLo = 0;
    if (dirtyHi < highWater - 1) dirtyHi = highWater - 1;
    isDirty = true;
  }
  setSparkOrigin(x, z);
}

// Aproksymacja krzywej Gaussa (od -1.0 do 1.0)
function randomGaussian() {
  return ((Math.random() + Math.random() + Math.random()) / 1.5) - 1.0;
}

// Kierunek glowny snopu: normalna + znos z poslizgu.
const _mainDir = { x: 0, y: 0 };
function grindMainDir(normalX, normalY, tangentX, tangentY, bounceRatio) {
  let mDx = normalX * (bounceRatio + 0.1) + tangentX * (1.0 - bounceRatio);
  let mDy = normalY * (bounceRatio + 0.1) + tangentY * (1.0 - bounceRatio);
  const mLen = Math.hypot(mDx, mDy) || 1;
  _mainDir.x = mDx / mLen;
  _mainDir.y = mDy / mLen;
  return _mainDir;
}

// JEDEN snop iskier w JEDNYM punkcie styku — wspolny trzon grindingBurst
// (snop w centroidzie) i grindingSeam (snopy wzdluz szwu). Dobor predkosci,
// zycia i rozmiaru czastki siedzi tylko tutaj, zeby obie sciezki nie rozjechaly
// sie przy pierwszym strojeniu.
function emitGrindCluster(x, y, normalX, normalY, tangentX, tangentY, count, visualEnergy, spreadRadius, baseVx, baseVy, bounceRatio) {
  const mainDir = grindMainDir(normalX, normalY, tangentX, tangentY, bounceRatio);
  const mDx = mainDir.x;
  const mDy = mainDir.y;

  for (let i = 0; i < count; i++) {
    const weight = Math.pow(Math.random(), 2.0);
    const scatterAmount = (1.0 - weight) * 2.0;

    // Rozrzut na plaszczyznie 2D (Y w WebGL to tutaj fizycznie Z)
    const pX = x + tangentX * randomGaussian() * spreadRadius + normalX * Math.random() * 20;
    const pY = y + tangentY * randomGaussian() * spreadRadius + normalY * Math.random() * 20;

    const dX = mDx + tangentX * randomGaussian() * scatterAmount + normalX * Math.abs(randomGaussian()) * scatterAmount;
    const dY = mDy + tangentY * randomGaussian() * scatterAmount + normalY * Math.abs(randomGaussian()) * scatterAmount;
    const dLen = Math.hypot(dX, dY) || 1;

    const speed = 180 + (visualEnergy * 0.18) + (weight * visualEnergy * 0.28) + Math.random() * 260;

    const vX = (dX / dLen) * speed + baseVx;
    const vY = (dY / dLen) * speed + baseVy;

    const lifeTime = 0.1 + (weight * 0.5) + Math.random() * 0.2;
    const size = 0.18 + weight * 0.42;

    SparkSystem3D.emit(pX, pY, vX, vY, lifeTime, size);
  }
}

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
    geometry.instanceCount = 0;

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
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 900;
    mesh.layers.set(0);
    scene.add(mesh);

    this.isInitialized = true;
  },

  emit(gameX, gameY, vx, vy, life, size) {
    if (!this.isInitialized) return;
    if (highWater === 0) {
      const o = cameraOrigin();
      setSparkOrigin(o.x, o.y);
    }
    const i = idx;
    const i3 = i * 3;

    // Przerzucenie osi z 2D na 3D, wzgledem poczatku puli (originX/Z)
    iPositions[i3]     = gameX - originX;
    iPositions[i3 + 1] = 0.5; // Wysokosc (leciutko nad podloga by nie klipowac)
    iPositions[i3 + 2] = gameY - originZ;

    iVelocities[i3]     = vx;
    iVelocities[i3 + 1] = 0;
    iVelocities[i3 + 2] = vy;

    const clampedLife = THREE.MathUtils.clamp(Number.isFinite(life) ? life : 0.25, MIN_SPARK_LIFE, MAX_SPARK_LIFE);
    iStartTimes[i] = globalTime;
    iLifeTimes[i]  = clampedLife;
    iSizes[i]      = THREE.MathUtils.clamp(size !== undefined ? size : 0.5, MIN_SPARK_SIZE, MAX_SPARK_SIZE);

    if (i + 1 > highWater) highWater = i + 1;
    if (dirtyLo < 0 || i < dirtyLo) dirtyLo = i;
    if (i > dirtyHi) dirtyHi = i;
    const diesAt = globalTime + clampedLife;
    if (diesAt > liveUntil) liveUntil = diesAt;

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

    // Kamera odjechala od poczatku zywej puli — przesuniecie danych (rzadkie).
    if (highWater > 0) {
      const o = cameraOrigin();
      if (Math.abs(o.x - originX) > SPARK_REBASE_DIST || Math.abs(o.y - originZ) > SPARK_REBASE_DIST) rebaseSparks(o.x, o.y);
    }

    if (isDirty) {
      const attrs = geometry.attributes;
      const lo = dirtyLo;
      const count = dirtyHi - lo + 1;
      const list = [attrs.iPosition, attrs.iVelocity, attrs.iStartTime, attrs.iLifeTime, attrs.iSize];
      for (const attr of list) {
        const items = attr.itemSize || 1;
        // Zakresy z klatek bez uploadu kumuluja sie (three czysci je dopiero po
        // wgraniu) — po progu wracamy do pelnego bufora.
        if (attr.updateRanges && attr.updateRanges.length >= 8) attr.clearUpdateRanges();
        else if (attr.addUpdateRange) attr.addUpdateRange(lo * items, count * items);
        attr.needsUpdate = true;
      }
      dirtyLo = -1;
      dirtyHi = -1;
      isDirty = false;
    }

    const live = globalTime < liveUntil;
    if (mesh.visible !== live) mesh.visible = live;
    if (live) {
      if (geometry.instanceCount !== highWater) geometry.instanceCount = highWater;
    } else if (highWater !== 0) {
      // Pusta pula wraca na start — kolejna seria zajmie tylko tyle slotow, ile
      // naprawde potrzebuje, zamiast ciagnac stary high-water do konca sesji.
      highWater = 0;
      idx = 0;
      geometry.instanceCount = 0;
    }
  },

  // Nowa funkcja dla tarcia i zderzen statkow.
  // Jeden snop w jednym punkcie — zostaje jako fallback dla par, ktore nie
  // niosa probek szwu (pointCount <= 1).
  grindingBurst(gameX, gameY, normalX, normalY, tangentX, tangentY, bounceForce, slideSpeed, baseVx, baseVy) {
    if (!this.isInitialized) return;

    // Calkowita energia decyduje o sile wyrzutu i progu minimalnym
    const totalEnergy = bounceForce + Math.abs(slideSpeed) * 3.0;
    if (totalEnergy < 15) return;
    const visualEnergy = Math.min(totalEnergy, MAX_GRINDING_VISUAL_ENERGY);

    const count = Math.min(120, Math.floor(5 + totalEnergy * 0.15));
    const bounceRatio = Math.min(1.0, bounceForce / (totalEnergy + 0.001));
    // Snop z jednego punktu musi udawac caly szew, stad rozrzut z ENERGII.
    const spreadRadius = Math.min(180, visualEnergy * 0.28);

    emitGrindCluster(
      gameX, gameY,
      normalX, normalY,
      tangentX, tangentY,
      count, visualEnergy, spreadRadius,
      baseVx, baseVy, bounceRatio
    );
  },

  // Iskry wzdluz CALEGO szwu. `points` to Float32Array [x, y, nx, ny] x N —
  // probki kontaktow rozlozone po plamie styku, kazda z wlasna normalna
  // (na zakrzywionej burcie rozni sie od usrednionej).
  //
  // Budzet iskier jest TEN SAM co w grindingBurst — dzielimy go miedzy punkty,
  // nie mnozymy przez ich liczbe. Otarcie burta w burte ma wygladac na dluzsze,
  // nie na jasniejsze.
  grindingSeam(points, pointCount, tangentX, tangentY, bounceForce, slideSpeed, baseVx, baseVy) {
    if (!this.isInitialized) return;

    const available = points ? (points.length >> 2) : 0;
    const n = Math.min(Math.max(0, pointCount | 0), available);
    if (n <= 0) return;
    if (n === 1) {
      // Normalna kontaktu idzie z B do A; grindingBurst dostaje ja odwrocona
      // (patrz wywolanie sprzed rozbicia na szew) — zachowujemy ten sam zwrot.
      this.grindingBurst(
        points[0], points[1],
        -points[2], -points[3],
        tangentX, tangentY,
        bounceForce, slideSpeed, baseVx, baseVy
      );
      return;
    }

    const totalEnergy = bounceForce + Math.abs(slideSpeed) * 3.0;
    if (totalEnergy < 15) return;
    const visualEnergy = Math.min(totalEnergy, MAX_GRINDING_VISUAL_ENERGY);

    const count = Math.min(120, Math.floor(5 + totalEnergy * 0.15));
    if (count <= 0) return;
    const bounceRatio = Math.min(1.0, bounceForce / (totalEnergy + 0.001));

    // Rozrzut wzdluz stycznej = POLOWA odstepu miedzy sasiednimi punktami.
    // Szew jest juz pokryty probkami, wiec kazdy snop ma tylko domknac luke do
    // sasiada — rozrzut z energii (grindingBurst) rozmazalby je jeden na drugim.
    const lastBase = (n - 1) * 4;
    const seamLength = Math.hypot(points[lastBase] - points[0], points[lastBase + 1] - points[1]);
    const spreadRadius = Math.max(4, (seamLength / (n - 1)) * 0.5);

    let emitted = 0;
    for (let p = 0; p < n; p++) {
      const base = p * 4;
      // Podzial przez skumulowany prog: suma udzialow to DOKLADNIE `count`,
      // niezaleznie od reszty z dzielenia.
      const share = Math.floor((count * (p + 1)) / n) - emitted;
      if (share <= 0) continue;
      emitted += share;

      emitGrindCluster(
        points[base], points[base + 1],
        -points[base + 2], -points[base + 3],
        tangentX, tangentY,
        share, visualEnergy, spreadRadius,
        baseVx, baseVy, bounceRatio
      );
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
    highWater = 0;
    liveUntil = -Infinity;
    dirtyLo = -1;
    dirtyHi = -1;
    originX = 0;
    originZ = 0;
    this.isInitialized = false;
  }
};
