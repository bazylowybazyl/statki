import * as THREE from 'three';
import { refreshHexBodyCache, DestructorSystem, isPackedShardBoundary, DESTRUCTOR_CONFIG, shardHeatNow } from '../game/destructor.js';
import { Core3D } from './core3d.js';
import { EngineVfxSystem } from './engineVfxSystem.js';
import { Weapon3DSystem } from './weapon3DSystem.js';
import { Fx3D } from './fxParticles3D.js';
import { RailgunFX3D } from './railgunFx3D.js';
import { BulletTrails } from './slugTrail3D.js';
import { Turret2D } from '../vfx/turret2D.js';
import {
  MAX_SHADER_SHIP_LIGHTS,
  NAV_LIGHT_CHASE,
  buildCombinedShipLightShaderPayload,
  buildPositionLightWorldSprites,
  buildRoadLightWorldEmitters,
  buildShipLightShaderPayload,
  computeRoadEmitterReach,
  createRoadEmitterReach,
  glslFloat,
  hasEntityLightSource,
  roadEmittersMayReach
} from '../game/shipLightRuntime.js';
import { ShipLights3D } from './shipLights3D.js';
import { allowsSolidArmorLod } from './hexLodPolicy.js';
import { DrawCallStats } from './drawCallStats.js';
import { HexBodyImpostorBatch, computeAverageBodyColor } from './hexBodyImpostorBatch.js';
import { prepareColdWreckImpostor, pushColdWreckImpostors } from './coldWreckImpostors.js';
import { COLD_WRECK_CONFIG } from '../game/coldWrecks.js';
import { HullLacquer, MAX_ENGINE_ZONES, computeEngineZones } from './hullLacquer.js';
import { HULL_SDF_OCCLUDER_FLOATS, HullShadowSdf, packHullShaftOccluder } from './hullShadowSdf.js';

const HEX_VERTEX_SHADER = `
attribute vec2 aGridPos;
attribute float aStress;
// aHeat = (szczyt żaru 0-1, znacznik czasu w sekundach). Zanik liczy fragment
// z uTime — CPU nie chodzi po shardach, żeby wygaszać rozżarzenie.
attribute vec2 aHeat;

uniform vec2 uSpriteSize;

varying vec2 vSpriteUV;
varying float vStress;
varying vec2 vHeat;
varying vec2 vWorldXY;
varying vec2 vOriginXY;

void main() {
  vStress = aStress;
  vHeat = aHeat;
  vSpriteUV = (aGridPos + position.xy) / uSpriteSize;
  vec4 localPos = instanceMatrix * vec4(position.xy, 0.0, 1.0);
  // Pozycja w świecie dla lakieru (kierunek do oka pseudo-perspektywy)
  // i środek statku (obłoki odbić przesuwają się z pozycją statku).
  vWorldXY = (modelMatrix * localPos).xy;
  vOriginXY = modelMatrix[3].xy;
  vec4 mvPosition = modelViewMatrix * localPos;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const ARMOR_VERTEX_SHADER = `
varying vec2 vSpriteUV;
varying float vStress;
varying vec2 vHeat;
varying vec2 vWorldXY;
varying vec2 vOriginXY;

void main() {
  vStress = 0.0;
  // Płyta pancerza to jeden quad na cały kadłub — nie ma na niej pojedynczego
  // heksa, któremu można by przypisać żar. Rozżarzone heksy wnętrza renderują
  // się nad nią osobno (patrz shouldRenderHybridShard).
  vHeat = vec2(0.0);
  vSpriteUV = uv;
  vWorldXY = (modelMatrix * vec4(position, 1.0)).xy;
  vOriginXY = modelMatrix[3].xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Rampa temperatury żaru (ciało doskonale czarne w skrócie): wiśnia →
// pomarańcz → żółć → biel. Wspólna dla kadłuba i odłamków, żeby ten sam metal
// miał tę samą barwę w obu miejscach. Barwa jest znormalizowana (kanał ≤ 1) —
// jasność dokłada wywołujący, bo kadłub i odłamki leżą w innych pasmach HDR.
const HEAT_RAMP_GLSL = `
vec3 heatRamp(float h) {
  vec3 c = mix(vec3(0.55, 0.04, 0.01), vec3(1.0, 0.30, 0.04), smoothstep(0.0, 0.45, h));
  c = mix(c, vec3(1.0, 0.70, 0.22), smoothstep(0.45, 0.75, h));
  return mix(c, vec3(1.0, 0.93, 0.80), smoothstep(0.75, 1.0, h));
}
`;

const HEX_FRAGMENT_SHADER = `
#define MAX_SHIP_LIGHTS ${MAX_SHADER_SHIP_LIGHTS}
#define MAX_ENGINE_ZONES ${MAX_ENGINE_ZONES}
uniform sampler2D uSprite;
uniform sampler2D uNormalMap;
uniform int uHasNormalMap;
uniform float uStressTint;
uniform float uHeatDecay;
uniform float uHeatPeak;
uniform vec3 uLightDir;
uniform float uRotation;
uniform float uTerminatorStart;
uniform float uTerminatorEnd;
uniform float uNightMin;
uniform float uNightBandStart;
uniform float uNightBandEnd;
uniform vec3 uNightTint;
uniform float uDayAmbient;
uniform float uDayDiffuseMul;
uniform float uSpecularMul;
uniform int uIsOcclusion;
uniform int uBillboardLighting;
uniform float uLodOpacity;
uniform vec2 uSpriteSize;
uniform float uTime;
uniform int uShipLightCount;
uniform vec4 uShipLightData[MAX_SHIP_LIGHTS];
uniform vec4 uShipLightColor[MAX_SHIP_LIGHTS];
uniform vec4 uShipLightExtra[MAX_SHIP_LIGHTS];
// Lakier (hullLacquer.js). uShapeMap: RG = normalna XY sprite'a, B = waga.
uniform sampler2D uShapeMap;
uniform sampler2D uLacquerEnv;
uniform sampler2D uLacquerSky;
uniform float uLacquerWeight;
uniform float uLacquerGlint;
uniform vec3 uLacquerEye;
uniform vec4 uLacquerA;
uniform vec4 uLacquerB;
uniform vec4 uLacquerC;
uniform vec4 uLacquerD;
uniform vec4 uLacquerE;
uniform int uEngineZoneCount;
uniform vec4 uEngineZones[MAX_ENGINE_ZONES];

varying vec2 vSpriteUV;
varying float vStress;
varying vec2 vHeat;
varying vec2 vWorldXY;
varying vec2 vOriginXY;
${HEAT_RAMP_GLSL}
void main() {
  if (vSpriteUV.x < -0.01 || vSpriteUV.x > 1.01 ||
      vSpriteUV.y < -0.01 || vSpriteUV.y > 1.01) discard;

  vec4 armor = texture2D(uSprite, vSpriteUV);
  vec3 color = armor.rgb;
  float alpha = armor.a * uLodOpacity;

  if (alpha < 0.01) discard;

  // --- MASKA OKLUZJI: Sylwetki zgĹ‚aszajÄ… siÄ™ jako BIAĹE (1.0), czyli blokery Ĺ›wiatĹ‚a ---
  if (uIsOcclusion == 1) {
      gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      return;
  }

  if (uBillboardLighting == 1) {
      gl_FragColor = vec4(color, alpha);
      return;
  }

  vec3 localNormal;
  if (uHasNormalMap == 1) {
    vec4 nTex = texture2D(uNormalMap, vSpriteUV);
    localNormal = normalize(nTex.rgb * 2.0 - 1.0);
  } else {
    vec2 p = vSpriteUV * 2.0 - 1.0;
    localNormal = normalize(vec3(p.x * 0.45, -p.y * 0.45, 1.0));
  }

  float c = cos(uRotation);
  float s = sin(uRotation);
  vec3 worldNormal = normalize(vec3(
      localNormal.x * c - localNormal.y * s,
      localNormal.x * s + localNormal.y * c,
      localNormal.z
  ));

  float NdotL = dot(worldNormal, uLightDir);
  float dayDiffuse = max(0.0, NdotL);
  float lightMul = uDayAmbient + dayDiffuse * uDayDiffuseMul;
  color *= lightMul;

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVector = normalize(uLightDir + viewDir);
  float spec = pow(max(dot(worldNormal, halfVector), 0.0), 32.0);
  float litMask = smoothstep(-0.02, 0.08, NdotL);
  color += vec3(spec * uSpecularMul * litMask);

  float isGlowing = step(0.6, color.b) * step(color.r, 0.5);
  vec3 finalColor = color + (color * isGlowing * 1.5);

  vec2 fragPx = vSpriteUV * uSpriteSize;

  // --- LAKIER: odbicie kosmosu + odblask słońca (hullLacquer.js) ---
  // Stoi PO isGlowing: niebieskawe odbicie policzone przed nim podbiłoby cały
  // kadłub ×2,5. Waga gaśnie przy sylwetce (jasna obwódka czytała się jak
  // tarcza) i w strefach dysz — silniki zostają matowe.
  float lacquerW = uLacquerWeight * uLacquerA.x;
  if (lacquerW > 0.001) {
    vec4 shape = texture2D(uShapeMap, vSpriteUV);
    lacquerW *= shape.b;
    for (int i = 0; i < MAX_ENGINE_ZONES; i++) {
      if (i >= uEngineZoneCount) break;
      vec4 zone = uEngineZones[i];
      lacquerW *= smoothstep(zone.z, zone.z * 1.5, length(fragPx - zone.xy));
    }
    if (lacquerW > 0.001) {
      vec3 coatN = uHasNormalMap == 1
        ? localNormal
        : vec3(shape.rg, sqrt(max(0.0, 1.0 - dot(shape.rg, shape.rg))));
      vec3 N = normalize(vec3(coatN.x * c - coatN.y * s, coatN.x * s + coatN.y * c, coatN.z));
      // Oko pseudo-perspektywy (Core3D.cameraPersp) zamiast stałego (0,0,1):
      // płaska płyta odbija wtedy różne kierunki nieba, a nie jeden punkt.
      vec3 V = normalize(uLacquerEye - vec3(vWorldXY, 0.0));
      float NdotV = max(dot(N, V), 0.001);
      vec3 R = 2.0 * NdotV * N - V;
      float fresnel = uLacquerA.y + (1.0 - uLacquerA.y) * pow(1.0 - NdotV, 5.0);
      // Podwójna paraboloida: zenit w środku tekstury, horyzont na okręgu.
      // Dolna półkula (tło pod statkiem) gaśnie — z niej brała się obwódka.
      vec2 envUV = 0.5 + 0.5 * R.xy / (1.0 + abs(R.z));
      float hemi = smoothstep(-0.35, 0.15, R.z);
      vec4 envTex = texture2D(uLacquerEnv, envUV);
      vec3 env = (min(envTex.rgb * uLacquerA.z, vec3(uLacquerA.w)) + envTex.a * uLacquerB.x) * hemi;
      vec3 envBlur = min(textureLod(uLacquerEnv, envUV, uLacquerC.z).rgb * uLacquerA.z, vec3(uLacquerA.w)) * hemi;
      // Bliskie obłoki zakotwiczone w świecie. Kamera jedzie za statkiem, więc
      // daleki kosmos stoi w miejscu — ruch daje dopiero ta warstwa: pozycja
      // statku × drift przesuwa odbicie po kadłubie przy locie, offset w kadłubie
      // trzyma skalę 1:1, a R.xy/R.z wygina je na krzywiznach.
      vec2 skyP = vOriginXY * uLacquerD.y + (vWorldXY - vOriginXY)
        + R.xy * (uLacquerD.z / max(R.z, 0.05));
      vec2 skyUV = skyP * uLacquerD.x;
      float skyW = smoothstep(0.02, 0.3, R.z) * uLacquerE.z * uLacquerD.w;
      vec3 skyTex = texture2D(uLacquerSky, skyUV).rgb;
      float skyLum = dot(skyTex, vec3(0.2126, 0.7152, 0.0722));
      env += skyTex * (skyW * (1.0 + uLacquerE.x * smoothstep(0.35, 0.8, skyLum)));
      envBlur += textureLod(uLacquerSky, skyUV, uLacquerE.y).rgb * skyW;
      // Specular AA: gdzie normalna szybko zmienia się na ekranie, płat się
      // poszerza i ciemnieje (energia ~stała), zamiast migotać iskrami.
      vec3 dN = fwidth(N);
      float nVar = dot(dN, dN);
      float glintExp = uLacquerB.z / (1.0 + uLacquerB.z * nVar);
      float sheenExp = uLacquerC.x / (1.0 + uLacquerC.x * nVar);
      float RdotL = max(dot(R, uLightDir), 0.0);
      float lobe = pow(RdotL, glintExp) * uLacquerB.y * (glintExp / uLacquerB.z) * uLacquerGlint
        + pow(RdotL, sheenExp) * uLacquerB.w * (sheenExp / uLacquerC.x);
      vec3 coat = fresnel * (env + lobe) + armor.rgb * envBlur * uLacquerC.y;
      finalColor = finalColor * (1.0 - fresnel * lacquerW) + coat * lacquerW;
    }
  }

  for (int i = 0; i < MAX_SHIP_LIGHTS; i++) {
    if (i >= uShipLightCount) break;
    vec4 lightData = uShipLightData[i];
    vec4 lightColor = uShipLightColor[i];
    vec4 lightExtra = uShipLightExtra[i];

    vec2 toFrag = fragPx - lightData.xy;
    float distPx = length(toFrag);
    float radiusPx = max(0.5, lightData.z);
    float power = max(0.0, lightData.w);
    vec3 lampColor = lightColor.rgb;
    float lightType = lightColor.a;

    // Sekwencja "pasa startowego": ta sama formuła co billboardy blasku
    // (shipLights3D) — stałe wstrzyknięte z NAV_LIGHT_CHASE, znak "+" daje
    // przebieg od dziobu (+X sprite'a) ku rufie.
    float localPhase = clamp(lightData.x / max(1.0, uSpriteSize.x), 0.0, 1.0);
    float chase = fract(uTime * ${glslFloat(NAV_LIGHT_CHASE.speed)} + localPhase * ${glslFloat(NAV_LIGHT_CHASE.phaseGain)});
    float chasePulse = smoothstep(0.0, ${glslFloat(NAV_LIGHT_CHASE.attack)}, chase)
      * (1.0 - smoothstep(${glslFloat(NAV_LIGHT_CHASE.hold)}, ${glslFloat(NAV_LIGHT_CHASE.release)}, chase));
    float sequenceMul = mix(${glslFloat(NAV_LIGHT_CHASE.rest)}, 1.35, chasePulse);
    if (lightType > 0.5) sequenceMul = 1.0;

    float core = smoothstep(radiusPx, 0.0, distPx);
    float glow = smoothstep(radiusPx * 7.0, 0.0, distPx);
    finalColor += lampColor * power * sequenceMul * (core * 1.15 + glow * 0.50);

    if (lightType > 0.5) {
      vec2 dir = normalize(lightExtra.xy);
      float along = dot(toFrag, dir);
      float coneCos = clamp(lightExtra.w, -0.98, 0.999);
      float rangePx = max(radiusPx * 2.0, lightExtra.z);
      float frontMask = step(0.0, along);
      float rangeMask = 1.0 - smoothstep(rangePx * 0.18, rangePx, along);
      float angleCos = dot(normalize(toFrag + dir * 0.001), dir);
      float coneMask = smoothstep(coneCos, min(0.999, coneCos + 0.16), angleCos);
      float nearMask = 1.0 - smoothstep(radiusPx * 0.8, radiusPx * 2.2, distPx);
      float beam = frontMask * rangeMask * coneMask * (1.0 - nearMask);
      finalColor += lampColor * power * beam * 0.16;
    }
  }

  float stress = clamp(vStress / 20.0, 0.0, 1.0);
  vec3 stressGlow = vec3(1.0, 0.25, 0.05) * stress * uStressTint * 3.5;
  finalColor += stressGlow;

  // ŻAR brzegu rany i powierzchni tarcia. Kanał niezależny od stresu: gaśnie
  // z własnym zegarem, więc blacha stygnie także wtedy, gdy siatka już śpi
  // i po wypaleniu plastycznym (aStress jest wtedy zerowy).
  // Jasność ~ 0.26h + 0.74h^4 (Stefan-Boltzmann w skrócie): świeży żar sięga
  // uHeatPeak (8-12, przepalona biel z bloomem), h = 0.45 daje ~1.3 — nasycony
  // pomarańcz tuż pod progiem bloomu — a wiśnia tli się długo nisko.
  float heat = vHeat.x * exp(-max(0.0, uTime - vHeat.y) * uHeatDecay);
  float heat2 = heat * heat;
  finalColor += heatRamp(heat) * (uHeatPeak * (0.26 * heat + 0.74 * heat2 * heat2));

  gl_FragColor = vec4(finalColor, alpha);
}
`;

const DEBRIS_VERTEX_SHADER = `
attribute vec2 aGridPos;
attribute vec2 aStartPos;
attribute vec2 aStartVel;
attribute vec3 aRotationData;
attribute vec2 aTimeData;
// Żar w chwili oderwania. Odłamek stygnie od SWOJEGO wieku — jest już poza
// siatką, więc nie ma skąd wziąć znacznika czasu kadłuba.
attribute float aHeat;

uniform vec2 uSpriteSize;
uniform float uTime;

varying vec2 vSpriteUV;
varying float vAlpha;
varying float vAge;
varying float vEdge;
varying float vHeat;

void main() {
  float age = uTime - aTimeData.x;
  vAge = age;
  vHeat = aHeat;
  // Geometria odłamka to CircleGeometry(25, 6) — promień znormalizowany daje
  // maskę urwanej krawędzi, na której zbiera się żar.
  vEdge = length(position.xy) / 25.0;

  float lifetime = aTimeData.y;
  if (age < 0.0 || lifetime <= 0.0 || age > lifetime) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float k = 0.16;
  float distMul = (1.0 - exp(-k * age)) / k;

  vec2 currentPos = aStartPos + aStartVel * distMul;
  float currentAngle = aRotationData.x + aRotationData.y * age;
  float currentScale = aRotationData.z;

  // Keep the torn metal readable, then fade smoothly near the end of its life.
  vAlpha = 1.0 - smoothstep(lifetime * 0.72, lifetime, age);
  if (vAlpha <= 0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vSpriteUV = (aGridPos + position.xy) / uSpriteSize;

  float c = cos(currentAngle);
  float s = sin(currentAngle);
  vec2 scaledPos = position.xy * currentScale;
  vec2 rotatedPos = vec2(
    scaledPos.x * c - scaledPos.y * s,
    scaledPos.x * s + scaledPos.y * c
  );

  vec3 worldPosition = vec3(currentPos.x + rotatedPos.x, -(currentPos.y + rotatedPos.y), 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const DEBRIS_FRAGMENT_SHADER = `
uniform sampler2D uSprite;
uniform vec3 uLightDir;
uniform float uDayAmbient;
uniform float uDayDiffuseMul;
uniform float uHeatDecay;
uniform float uHeatTint;

varying vec2 vSpriteUV;
varying float vAlpha;
varying float vAge;
varying float vEdge;
varying float vHeat;
${HEAT_RAMP_GLSL}
void main() {
  if (vSpriteUV.x < -0.01 || vSpriteUV.x > 1.01 || vSpriteUV.y < -0.01 || vSpriteUV.y > 1.01) discard;

  vec4 color = texture2D(uSprite, vSpriteUV);
  if (color.a < 0.01) discard;

  vec2 p = vSpriteUV * 2.0 - 1.0;
  vec3 normal = normalize(vec3(p.x * 0.45, -p.y * 0.45, 1.0));
  float NdotL = max(0.0, dot(normal, uLightDir));
  float lightMul = uDayAmbient + NdotL * uDayDiffuseMul;

  gl_FragColor = vec4(color.rgb * lightMul, color.a * vAlpha);

  // Żar siedzi na URWANYCH KRAWĘDZIACH — środek płata zdążył oddać ciepło
  // w blachę, brzeg nie miał komu. Jasność LINIOWA i niska (debrisHeatGlow ~1):
  // odłamki zostają w paśmie barwy, bez białego szczytu — główny żar ma być
  // na kadłubie, na brzegu wyrwy.
  float edge = smoothstep(0.5, 1.0, vEdge);
  float heat = vHeat * exp(-vAge * uHeatDecay);
  gl_FragColor.rgb += heatRamp(heat) * heat * uHeatTint * (0.35 + 0.65 * edge);
}
`;

const state = {
  entityMeshes: new Map(),
  // Pudło kadru i zoom z ostatniego updateHexShips3D — pytanie „czy zamrożenie
  // wraku będzie widać” (isColdFreezeVisuallySafe) pada między klatkami.
  lastCull: null,
  lastCameraZoom: 1,
  dummy: new THREE.Object3D(),
  maxVisibleEntities: 18,
  midDistanceWorld: 2400,
  farDistanceWorld: 5200,
  lastTime: typeof performance !== 'undefined' ? performance.now() : 0,
  frameId: 0,
  hadRenderableLastFrame: false,
  validEntities: [],
  vfxEntities: [],
  visibleHexEntities: [],
  visibleVfxEntities: [],
  // Podzbiory visible* w PUDLE RYSOWANIA (kadr + margines) — patrz isEntityInDrawBox.
  drawHexEntities: [],
  drawVfxEntities: [],
  roadLightEmitters: [],
  // Pudło zasięgu emiterów drogowych klatki (computeRoadEmitterReach).
  roadLightReach: createRoadEmitterReach(),
  navLightSprites: [],
  staleEntities: [],
  validEntitySet: new Set(),
  damageTintEnabled: true
};

const HEX_LOD = Object.freeze({ FULL: 0, HYBRID: 1, IMPOSTOR: 2 });
// Poniżej tego promienia ekranowego CIAŁA (nie heksa) wrak przestaje być
// rysowany własnym wywołaniem i wpada do wspólnego batcha smug. Dotyczy tylko
// wraków i fragmentów — żywe kadłuby mają swoją ścieżkę LOD. Histereza trzyma
// przełączenie z dala od progu, żeby nie migotało przy powolnym zoomie.
const WRECK_IMPOSTOR_PX = 15;
const WRECK_IMPOSTOR_EXIT_MUL = 1.35;
const HEX_LOD_FULL_PX = 1.25;
const HEX_LOD_IMPOSTOR_PX = 0.45;
const HEX_LOD_HYSTERESIS = 0.20;
const HEX_LOD_FADE_MS = 150;

const lodFrameStats = {
  fullBodies: 0,
  hybridBodies: 0,
  impostorBodies: 0,
  fullHexes: 0,
  hybridHexes: 0,
  totalStructuralHexes: 0,
  // Bilans cullingu. Bez tego nie da sie odpowiedziec na pytanie „czy odwrocenie
  // kamery cokolwiek zdejmuje" — reszta licznikow patrzy dopiero NA TO, co juz
  // przeszlo przez bramke. `entitiesIn` to wejscie, `culled` to odrzuty pudlem
  // widoku, `shaftCands` to kandydaci na okludery cieni (ta petla NIE uzywa
  // pudla widoku, tylko wlasnego zasiegu, wiec kamera jej nie zmniejsza).
  entitiesIn: 0,
  culled: 0,
  // W pudle rozgrzania, ale poza pudlem rysowania: mesh istnieje, nic sie nie
  // liczy i nie rysuje (patrz isEntityInDrawBox).
  warmOnly: 0,
  shaftCands: 0,
  // Kadłuby zgłoszone do passa cieni i pieczenia ich SDF w tej klatce.
  shaftHulls: 0,
  shaftBakes: 0,
  // Smugi zimnych wraków w batchu (bez meshy, patrz coldWreckImpostors.js).
  coldImpostors: 0
};

// Bufor okludera jednego kadłuba (packHullShaftOccluder -> pushShaftHullSdf).
const shaftOccluderScratch = new Float32Array(HULL_SDF_OCCLUDER_FLOATS);

const drawPerfScratch = {
  coreCallMs: 0,
  coreRenderMs: 0,
  composerMs: 0,
  blitMs: 0
};

const SHIP_LIGHT_DEFAULTS = Object.freeze({
  terminatorStart: -0.08,
  terminatorEnd: 0.20,
  nightMin: 0.10,
  nightBandStart: -0.25,
  nightBandEnd: 0.02,
  nightTintR: 0.015,
  nightTintG: 0.025,
  nightTintB: 0.045,
  dayAmbient: 0.24,
  dayDiffuseMul: 1.18,
  specularMul: 0.30
});

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function getShipLightTuning() {
  if (typeof window === 'undefined') return SHIP_LIGHT_DEFAULTS;
  if (!window.__shipLightTune) window.__shipLightTune = { ...SHIP_LIGHT_DEFAULTS };
  return window.__shipLightTune;
}

// Tune-epoch: globalne wartości tuningu zmieniają się rzadko (panel debug),
// więc zamiast pisać 9 uniformów per statek per klatkę, sprawdzamy raz
// na klatkę czy się zmieniły i propagujemy do meshy tylko gdy trzeba.
let _tuneEpoch = 0;
const _tuneSnapshot = {
  terminatorStart: NaN,
  terminatorEnd: NaN,
  nightMin: NaN,
  nightBandStart: NaN,
  nightBandEnd: NaN,
  nightTintR: NaN,
  nightTintG: NaN,
  nightTintB: NaN,
  dayAmbient: NaN,
  dayDiffuseMul: NaN,
  specularMul: NaN
};
function refreshTuneEpoch() {
  const t = getShipLightTuning();
  if (
    t.terminatorStart !== _tuneSnapshot.terminatorStart ||
    t.terminatorEnd !== _tuneSnapshot.terminatorEnd ||
    t.nightMin !== _tuneSnapshot.nightMin ||
    t.nightBandStart !== _tuneSnapshot.nightBandStart ||
    t.nightBandEnd !== _tuneSnapshot.nightBandEnd ||
    t.nightTintR !== _tuneSnapshot.nightTintR ||
    t.nightTintG !== _tuneSnapshot.nightTintG ||
    t.nightTintB !== _tuneSnapshot.nightTintB ||
    t.dayAmbient !== _tuneSnapshot.dayAmbient ||
    t.dayDiffuseMul !== _tuneSnapshot.dayDiffuseMul ||
    t.specularMul !== _tuneSnapshot.specularMul
  ) {
    _tuneSnapshot.terminatorStart = t.terminatorStart;
    _tuneSnapshot.terminatorEnd = t.terminatorEnd;
    _tuneSnapshot.nightMin = t.nightMin;
    _tuneSnapshot.nightBandStart = t.nightBandStart;
    _tuneSnapshot.nightBandEnd = t.nightBandEnd;
    _tuneSnapshot.nightTintR = t.nightTintR;
    _tuneSnapshot.nightTintG = t.nightTintG;
    _tuneSnapshot.nightTintB = t.nightTintB;
    _tuneSnapshot.dayAmbient = t.dayAmbient;
    _tuneSnapshot.dayDiffuseMul = t.dayDiffuseMul;
    _tuneSnapshot.specularMul = t.specularMul;
    _tuneEpoch++;
  }
  return t;
}

function ensureShipLightPanelApi() { }

function getEntityPosX(entity) { return entity?.pos ? entity.pos.x : entity?.x || 0; }
function getEntityPosY(entity) { return entity?.pos ? entity.pos.y : entity?.y || 0; }
function getEntityScaleX(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleX === 'number') return entity.visual.spriteScaleX;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getEntityScaleY(entity) {
  if (entity?.visual && typeof entity.visual.spriteScaleY === 'number') return entity.visual.spriteScaleY;
  if (entity?.visual && typeof entity.visual.spriteScale === 'number') return entity.visual.spriteScale;
  return 1.0;
}

function getEntityScale(entity) {
  return Math.max(getEntityScaleX(entity), getEntityScaleY(entity));
}

function usesBillboardLighting(entity) {
  return entity?.isAsteroidHex === true || entity?.visual?.preserveBillboardLighting === true;
}

function usesBillboardOrientation(entity) {
  return entity?.isAsteroidHex === true || entity?.visual?.preserveBillboardOrientation === true;
}

function isEntityInCull(entity, cull) {
  if (!cull) return true;
  const x = getEntityPosX(entity);
  const y = getEntityPosY(entity);
  const r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  return (
    Math.abs(x - cull.x) <= cull.halfW + r &&
    Math.abs(y - cull.y) <= cull.halfH + r
  );
}

// Pudło RYSOWANIA. Pudło z index.html (cull.halfW/halfH = 3× połowa widoku,
// czyli 9 ekranów) zostaje pudłem ROZGRZANIA: mesh powstaje zawczasu, emitery
// świateł drogowych i dysze trzymają ciągłość. Pełna aktualizacja mesha
// (instancje, LOD, lampy, uniformy), draw call, billboardy świateł i wieżyczki
// 2D idą tylko dla encji, które mogą być na ekranie — meshe kadłubów mają
// frustumCulled=false, więc bez tego ~8/9 wywołań trafiało poza kadr.
// Promień z wymiarów sprite'a × skala (entity.radius wraków jest w jednostkach
// siatki), plus pivot i stały margines ekranowy na dryf/deformację.
// Bez cull.drawHalfW (np. lot po mieście) — dawne zachowanie: rysuj całe pudło.
const DRAW_BOX_MARGIN_PX = 96;

function isEntityInDrawBox(entity, cull, cameraZoom) {
  if (!cull || !Number.isFinite(cull.drawHalfW) || !Number.isFinite(cull.drawHalfH)) return true;
  const x = getEntityPosX(entity);
  const y = getEntityPosY(entity);
  const grid = entity?.hexGrid;
  let r;
  if (grid) {
    const sx = Math.abs(getEntityScaleX(entity)) || 1;
    const sy = Math.abs(getEntityScaleY(entity)) || 1;
    const pivotX = (Number(grid.pivot?.x) || 0) * sx;
    const pivotY = (Number(grid.pivot?.y) || 0) * sy;
    r = Math.hypot((Number(grid.srcWidth) || 0) * sx, (Number(grid.srcHeight) || 0) * sy) * 0.5
      + Math.hypot(pivotX, pivotY);
  } else {
    r = Math.max(140, Number(entity?.radius) || Number(entity?.r) || 140);
  }
  r += DRAW_BOX_MARGIN_PX / Math.max(0.0001, cameraZoom);
  return (
    Math.abs(x - cull.x) <= cull.drawHalfW + r &&
    Math.abs(y - cull.y) <= cull.drawHalfH + r
  );
}

function getInterpolatedRenderPose(entity) {
  if (typeof window === 'undefined') return null;
  if (!window.ship || entity !== window.ship) return null;
  const pose = window.__interpShipPose;
  if (!pose) return null;
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.angle)) return null;
  return pose;
}

// Rzeczywisty zasięg AKTYWNYCH heksów w układzie lokalnym mesha (piksele
// sprite'a, względem pivota — jak translacje instancji). Fragment dziedziczy
// srcWidth/srcHeight rodzica (musi: próbkuje jego teksturę), więc rozmiar
// liczony z src dawał promień CAŁEGO kadłuba: fragmenty dużych okrętów nigdy
// nie wchodziły do batcha smug, te z małych rysowały smugę wielkości statku,
// a przy selekcji cieni drobnica wypychała żywe okręty z 12 slotów.
// Cache na siatce: po meshRevision, a przy deformacji najwyżej co 250 ms.
const ACTIVE_EXTENT_REFRESH_MS = 250;

function getGridActiveExtent(grid, nowMs) {
  const shards = grid?.shards;
  let ext = grid.__activeExtent;
  if (!ext) {
    ext = grid.__activeExtent = { rev: -1, shardsRef: null, at: -Infinity, halfW: 0, halfH: 0, cx: 0, cy: 0 };
  }
  const rev = Number(grid.meshRevision) || 0;
  if (ext.shardsRef === shards && (ext.rev === rev || nowMs - ext.at < ACTIVE_EXTENT_REFRESH_MS)) return ext;

  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  const offX = (Number(grid.srcWidth) || 0) * 0.5 + pivotX;
  const offY = (Number(grid.srcHeight) || 0) * 0.5 + pivotY;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (Array.isArray(shards)) {
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (!s || !s.active || s.isDebris) continue;
      const x = (Number(s.gridX) || 0) - offX;
      const y = (Number(s.gridY) || 0) - offY;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) {
    // Brak aktywnych heksów — zachowawczo cały sprite (środek = -pivot).
    ext.halfW = (Number(grid.srcWidth) || 0) * 0.5;
    ext.halfH = (Number(grid.srcHeight) || 0) * 0.5;
    ext.cx = -pivotX;
    ext.cy = -pivotY;
  } else {
    const pad = Math.max(2, Number(shards[0]?.radius) || 20);
    ext.halfW = (maxX - minX) * 0.5 + pad;
    ext.halfH = (maxY - minY) * 0.5 + pad;
    ext.cx = (minX + maxX) * 0.5;
    ext.cy = (minY + maxY) * 0.5;
  }
  ext.rev = rev;
  ext.shardsRef = shards;
  ext.at = nowMs;
  return ext;
}

function getEntityLightPosition(entity) {
  const interpPose = getInterpolatedRenderPose(entity);
  return {
    x: interpPose ? interpPose.x : getEntityPosX(entity),
    y: interpPose ? interpPose.y : getEntityPosY(entity)
  };
}

function getEntityLightAngle(entity) {
  const interpPose = getInterpolatedRenderPose(entity);
  const baseAngle = interpPose ? interpPose.angle : (Number(entity?.angle) || 0);
  return baseAngle + (Number(entity?.capitalProfile?.spriteRotation) || 0);
}

const SHIP_LIGHT_TRANSFORM_OPTIONS = {
  getPosition: getEntityLightPosition,
  getAngle: getEntityLightAngle,
  getSpriteScaleX: getEntityScaleX,
  getSpriteScaleY: getEntityScaleY
};

const SHIP_LIGHT_EMITTER_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  maxEmitters: 64,
  out: null
};

const NAV_LIGHT_SPRITE_OPTIONS = {
  ...SHIP_LIGHT_TRANSFORM_OPTIONS,
  getGrid: (entity) => entity?.hexGrid,
  out: null,
  zoom: 1,
  minHaloWorld: 0
};

function computeShardStress(shard) {
  if (shard && shard.deformation) {
    const def = shard.deformation;
    const target = shard.targetDeformation || def;
    const sx = (Number(target.x) || 0) - (Number(def.x) || 0);
    const sy = (Number(target.y) || 0) - (Number(def.y) || 0);
    const absX = sx < 0 ? -sx : sx;
    const absY = sy < 0 ? -sy : sy;
    const defStress = absX > absY ? absX + absY * 0.4 : absY + absX * 0.4;
    const velX = Math.abs(Number(shard.__velX) || 0) + Math.abs(Number(shard.__collVelX) || 0);
    const velY = Math.abs(Number(shard.__velY) || 0) + Math.abs(Number(shard.__collVelY) || 0);
    const velStress = (velX > velY ? velX + velY * 0.4 : velY + velX * 0.4) * 0.18;
    return defStress > velStress ? defStress : velStress;
  }
  return 0;
}

function isLegacyBoundaryShard(shard) {
  const neighbors = shard?.neighbors;
  if (!Array.isArray(neighbors) || neighbors.length < 6) return true;
  for (let index = 0; index < 6; index++) {
    const neighbor = neighbors[index];
    if (!neighbor || !neighbor.active || neighbor.isDebris || neighbor.hp <= 0) return true;
  }
  return false;
}

function shouldRenderHybridShard(shard, nowSec = 0) {
  if (!shard?.active || shard.isDebris || shard.hp <= 0) return false;
  if (isPackedShardBoundary(shard) || isLegacyBoundaryShard(shard)) return true;
  if (Number(shard.hp) < (Number(shard.maxHp) || Number(shard.hp)) * 0.995) return true;
  const deform = shard.deformation;
  const target = shard.targetDeformation;
  if (Math.abs(Number(deform?.x) || 0) + Math.abs(Number(deform?.y) || 0) > 0.08) return true;
  if (Math.abs(Number(target?.x) || 0) + Math.abs(Number(target?.y) || 0) > 0.08) return true;
  // Rozżarzony heks WNĘTRZA musi zostać w instancjach, inaczej w trybie HYBRID
  // żar znika pod płytą pancerza — a płyta nie ma jak go pokazać (vHeat = 0).
  if (shardHeatNow(shard, nowSec) > 0.03) return true;
  return computeShardStress(shard) > 0.08;
}

function resolveHexLod(data, screenRadiusPx, now, solidArmorAllowed = true) {
  // A split body still samples the original sprite in each individual hex.
  // Its solid armor plane, however, contains the entire parent sprite. Never
  // let that plane fade in for wrecks/fragments: it produced the visible loop
  // "whole ship -> fragments -> whole ship" around the LOD thresholds.
  if (!solidArmorAllowed) {
    if (data.lodMode !== HEX_LOD.FULL || data.instanceLodMode !== HEX_LOD.FULL) {
      data.needsInstanceRefresh = true;
    }
    data.lodMode = HEX_LOD.FULL;
    data.instanceLodMode = HEX_LOD.FULL;
    data.lodFadeStart = now;
    data.lodFromHexOpacity = 1;
    data.lodFromArmorOpacity = 0;
    data.hexOpacity = 1;
    data.armorOpacity = 0;
    data.mesh.material.uniforms.uLodOpacity.value = 1;
    data.armorMesh.material.uniforms.uLodOpacity.value = 0;
    data.mesh.visible = true;
    data.armorMesh.visible = false;
    return;
  }

  const current = data.lodMode;
  let desired = current;
  const h = HEX_LOD_HYSTERESIS;

  if (current === HEX_LOD.FULL) {
    if (screenRadiusPx < HEX_LOD_FULL_PX * (1 - h)) desired = HEX_LOD.HYBRID;
  } else if (current === HEX_LOD.HYBRID) {
    if (screenRadiusPx > HEX_LOD_FULL_PX * (1 + h)) desired = HEX_LOD.FULL;
    else if (screenRadiusPx < HEX_LOD_IMPOSTOR_PX * (1 - h)) desired = HEX_LOD.IMPOSTOR;
  } else if (screenRadiusPx > HEX_LOD_IMPOSTOR_PX * (1 + h)) {
    desired = HEX_LOD.HYBRID;
  }

  if (desired !== current) {
    data.lodMode = desired;
    data.lodFadeStart = now;
    data.lodFromHexOpacity = data.hexOpacity;
    data.lodFromArmorOpacity = data.armorOpacity;
    // Upgrades may reveal detailed geometry immediately at zero opacity.  During
    // downgrades keep the old geometry until the armor has faded in, avoiding a
    // one-frame hole where the interior disappears.
    if (desired < current || current === HEX_LOD.IMPOSTOR) {
      data.instanceLodMode = desired;
      data.needsInstanceRefresh = true;
    }
  }

  const elapsed = Math.max(0, now - data.lodFadeStart);
  const t = Math.min(1, elapsed / HEX_LOD_FADE_MS);
  const smooth = t * t * (3 - 2 * t);
  const targetHex = data.lodMode === HEX_LOD.IMPOSTOR ? 0 : 1;
  const targetArmor = data.lodMode === HEX_LOD.FULL ? 0 : 1;
  data.hexOpacity = data.lodFromHexOpacity + (targetHex - data.lodFromHexOpacity) * smooth;
  data.armorOpacity = data.lodFromArmorOpacity + (targetArmor - data.lodFromArmorOpacity) * smooth;
  if (t >= 1 && data.instanceLodMode !== data.lodMode) {
    data.instanceLodMode = data.lodMode;
    data.needsInstanceRefresh = true;
  }
  data.mesh.material.uniforms.uLodOpacity.value = data.hexOpacity;
  data.armorMesh.material.uniforms.uLodOpacity.value = data.armorOpacity;
  data.mesh.visible = data.lodMode !== HEX_LOD.IMPOSTOR || data.hexOpacity > 0.001;
  data.armorMesh.visible = data.armorOpacity > 0.001;
}

function setAttrUpdateRange(attr, start, count) {
  if (!attr) return;
  if (typeof attr.clearUpdateRanges === 'function') {
    attr.clearUpdateRanges();
    if (typeof attr.addUpdateRange === 'function' && Number.isFinite(count) && count > 0) {
      attr.addUpdateRange(start, count);
    }
    return;
  }
  if (!attr.updateRange) attr.updateRange = { offset: 0, count: -1 };
  attr.updateRange.offset = start;
  attr.updateRange.count = count;
}

function createManagedTexture(source, isLinearData = false) {
  if (!source) return null;
  const isCanvas =
    (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas);
  const texture = isCanvas ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  const width = Number(source?.width ?? source?.naturalWidth ?? 0) || 0;
  const height = Number(source?.height ?? source?.naturalHeight ?? 0) || 0;
  const isPowerOfTwo = width > 0 && height > 0 && THREE.MathUtils.isPowerOfTwo(width) && THREE.MathUtils.isPowerOfTwo(height);
  const isWebGL2 = !!Core3D?.renderer?.capabilities?.isWebGL2;
  const canUseMipmaps = isWebGL2 || isPowerOfTwo;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = canUseMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = canUseMipmaps;
  if (canUseMipmaps && Core3D?.renderer?.capabilities?.getMaxAnisotropy) {
    const maxAnisotropy = Core3D.renderer.capabilities.getMaxAnisotropy();
    texture.anisotropy = Math.max(1, Math.min(4, maxAnisotropy || 1));
  } else {
    texture.anisotropy = 1;
  }
  texture.colorSpace = isLinearData ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const sharedVisualTextures = new WeakMap();

function acquireSharedVisualTexture(source) {
  let entry = sharedVisualTextures.get(source);
  if (!entry) {
    entry = { texture: createManagedTexture(source), refs: 0 };
    sharedVisualTextures.set(source, entry);
  }
  entry.refs++;
  return entry.texture;
}

function releaseSharedVisualTexture(source) {
  if (!source) return;
  const entry = sharedVisualTextures.get(source);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.texture?.dispose?.();
    sharedVisualTextures.delete(source);
  }
}

function createLightUniformArray() {
  return Array.from({ length: MAX_SHADER_SHIP_LIGHTS }, () => new THREE.Vector4());
}

function createEngineZoneArray() {
  return Array.from({ length: MAX_ENGINE_ZONES }, () => new THREE.Vector4());
}

// Lakier nie dotyczy pierścienia ani asteroid (te wychodzą z shadera wcześniej).
function allowsHullLacquer(entity) {
  return entity?.isRingSegment !== true && !usesBillboardLighting(entity);
}

// Lakier per encja: waga, wygaszanie odblasku po rozmiarze kadłuba na ekranie
// (flota z daleka to nie brokat) i strefy dysz. Strefy przeliczamy tylko przy
// zmianie układu silników albo wymiarów siatki — jak sygnatura świateł.
function syncEntityLacquer(entity, data, grid, entityScale, zoomPx) {
  const uniforms = data.mesh.material.uniforms;
  if (!uniforms.uLacquerWeight) return;
  const tune = HullLacquer.getTuning();

  let weight = allowsHullLacquer(entity) ? 1 : 0;
  if (weight > 0 && (entity.isWreck === true || grid.isFragment === true)) {
    weight = clamp(tune.wreckMul, 0, 1);
  }
  uniforms.uLacquerWeight.value = weight;

  const bodyRadiusPx = Math.max(data.srcWidth, data.srcHeight) * 0.5 * entityScale * zoomPx;
  const glintMin = clamp(tune.glintMinPx, 0, 10000);
  const glintFull = Math.max(glintMin + 1, clamp(tune.glintFullPx, 0, 10000));
  const g = clamp((bodyRadiusPx - glintMin) / (glintFull - glintMin), 0, 1);
  uniforms.uLacquerGlint.value = g * g * (3 - 2 * g);

  const main = entity.visual?.mainThrusters || null;
  const side = entity.visual?.torqueThrusters || null;
  // NaN z ręcznie podmienionego tuningu nie może psuć porównania (przeliczanie co klatkę).
  const zoneMulRaw = Number(tune.engineZoneMul);
  const zoneMul = Number.isFinite(zoneMulRaw) ? zoneMulRaw : 1;
  if (
    data.zoneMainRef === main && data.zoneSideRef === side &&
    data.zoneSrcW === data.srcWidth && data.zoneSrcH === data.srcHeight &&
    data.zonePivotX === data.pivotX && data.zonePivotY === data.pivotY &&
    data.zoneMul === zoneMul
  ) return;
  const zones = computeEngineZones(main, side, grid, tune);
  const out = uniforms.uEngineZones.value;
  for (let i = 0; i < MAX_ENGINE_ZONES; i++) {
    const zone = zones[i];
    if (zone) out[i].set(zone.x, zone.y, zone.r, 0);
    else out[i].set(0, 0, 0, 0);
  }
  uniforms.uEngineZoneCount.value = zones.length;
  // Tablica 20 vec4 nie ma cache w setterze three — przy zerze stref shader jej
  // nie czyta (pętla kończy się na uEngineZoneCount), więc nie wysyłamy jej co draw.
  uniforms.uEngineZones.needsUpdate = zones.length > 0;
  data.zoneMainRef = main;
  data.zoneSideRef = side;
  data.zoneSrcW = data.srcWidth;
  data.zoneSrcH = data.srcHeight;
  data.zonePivotX = data.pivotX;
  data.zonePivotY = data.pivotY;
  data.zoneMul = zoneMul;
}

// Lampy w shaderze kadłuba: poniżej tego promienia kadłuba na ekranie są
// niewidoczne (billboardy ShipLights3D gasną już przy ~2,5 px), a payload —
// normalizacja bloku lamp, tablice i podpis-string — szedł co klatkę dla
// każdej encji w pudle cullingu.
const SHIP_LIGHT_SHADER_MIN_PX = 4;
const SHIP_LIGHTS_OFF_SIGNATURE = '__lights_off__';

// Tablice lamp (3 × 32 vec4) wysyłane są przy KAŻDYM drawie kadłuba (materiał
// per encja, setter tablic three nie ma cache). Przy zerze lamp shader ich nie
// czyta — pętla kończy się na uShipLightCount — więc upload pomijamy.
function setShipLightArraysUpload(uniforms, enabled) {
  uniforms.uShipLightData.needsUpdate = enabled;
  uniforms.uShipLightColor.needsUpdate = enabled;
  uniforms.uShipLightExtra.needsUpdate = enabled;
}

function syncEntityLightUniforms(entity, data, grid, externalRoadLights = null, bodyRadiusPx = Infinity) {
  const uniforms = data?.mesh?.material?.uniforms;
  if (!uniforms?.uShipLightCount) return;
  uniforms.uTime.value = state.lastTime * 0.001;

  // Emitery drogowe liczą się tylko, gdy któryś może sięgnąć pudła encji —
  // dawniej jeden emiter gdziekolwiek w pudle rozgrzania (np. reflektory gracza)
  // wymuszał pełny payload z pętlą po emiterach dla KAŻDEGO kadłuba i wraku.
  const hasExternalRoadLights = Array.isArray(externalRoadLights) && externalRoadLights.length > 0
    && bodyRadiusPx >= SHIP_LIGHT_SHADER_MIN_PX
    && roadEmittersMayReach(state.roadLightReach, entity, grid, SHIP_LIGHT_TRANSFORM_OPTIONS);
  if (bodyRadiusPx < SHIP_LIGHT_SHADER_MIN_PX || (!hasExternalRoadLights && !hasEntityLightSource(entity))) {
    if (data.lightSignature !== SHIP_LIGHTS_OFF_SIGNATURE) {
      uniforms.uShipLightCount.value = 0;
      setShipLightArraysUpload(uniforms, false);
      data.lightSignature = SHIP_LIGHTS_OFF_SIGNATURE;
    }
    return;
  }

  const payload = hasExternalRoadLights
    ? buildCombinedShipLightShaderPayload(entity, grid, externalRoadLights, SHIP_LIGHT_TRANSFORM_OPTIONS)
    : buildShipLightShaderPayload(entity, grid, MAX_SHADER_SHIP_LIGHTS);
  if (payload.signature === data.lightSignature) return;

  uniforms.uShipLightCount.value = payload.count;
  setShipLightArraysUpload(uniforms, payload.count > 0);
  const dataUniforms = uniforms.uShipLightData.value;
  const colorUniforms = uniforms.uShipLightColor.value;
  const extraUniforms = uniforms.uShipLightExtra.value;

  for (let i = 0; i < MAX_SHADER_SHIP_LIGHTS; i++) {
    const light = payload.lights[i];
    if (!light) {
      dataUniforms[i].set(0, 0, 0, 0);
      colorUniforms[i].set(0, 0, 0, 0);
      extraUniforms[i].set(0, -1, 0, 0);
      continue;
    }
    const coneRad = Math.max(1, Math.min(179, Number(light.coneDeg) || 40)) * Math.PI / 360;
    dataUniforms[i].set(light.pos.x, light.pos.y, light.radiusPx, light.power);
    colorUniforms[i].set(
      light.color.r,
      light.color.g,
      light.color.b,
      light.kind === 'road' ? 1 : 0
    );
    extraUniforms[i].set(
      Number(light.dir?.x) || 0,
      Number(light.dir?.y) || -1,
      Number(light.rangePx) || 0,
      Math.cos(coneRad)
    );
  }

  data.lightSignature = payload.signature;
}

function disposeMeshData(data) {
  if (!data) return;
  if (Core3D.scene && data.mesh) {
    Core3D.scene.remove(data.mesh);
  }
  if (Core3D.scene && data.armorMesh) {
    Core3D.scene.remove(data.armorMesh);
  }
  data.mesh?.geometry?.dispose?.();
  data.mesh?.material?.dispose?.();
  data.armorMesh?.geometry?.dispose?.();
  data.armorMesh?.material?.dispose?.();
  if (data.visualImageRef) releaseSharedVisualTexture(data.visualImageRef);
  else data.texture?.dispose?.();
  data.normalTexture?.dispose?.();
  if (data.shapeImageRef) HullLacquer.releaseShapeUniform(data.shapeImageRef);
}

const GPU_DEBRIS_MAX = 10000;

class GpuDebrisPool {
  constructor(gridRef) {
    this.textureKey = gridRef.armorImage;
    this.currentIndex = 0;
    // Dirty-span spawnów między klatkami. Poprzednio każdy spawn robił
    // clearUpdateRanges() — przy wielu odłamkach w jednej klatce na GPU
    // trafiał tylko zakres OSTATNIEGO spawnu (reszta miała stare atrybuty).
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._dirtyWrapped = false;
    this.lastExpiryTime = -Infinity;
    this.geometry = new THREE.CircleGeometry(25, 6);

    this.startPosArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.startVelArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.rotationArray = new Float32Array(GPU_DEBRIS_MAX * 3);
    this.timeArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.gridPosArray = new Float32Array(GPU_DEBRIS_MAX * 2);
    this.heatArray = new Float32Array(GPU_DEBRIS_MAX);

    this.geometry.setAttribute('aStartPos', new THREE.InstancedBufferAttribute(this.startPosArray, 2));
    this.geometry.setAttribute('aStartVel', new THREE.InstancedBufferAttribute(this.startVelArray, 2));
    this.geometry.setAttribute('aRotationData', new THREE.InstancedBufferAttribute(this.rotationArray, 3));
    this.geometry.setAttribute('aTimeData', new THREE.InstancedBufferAttribute(this.timeArray, 2));
    this.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(this.gridPosArray, 2));
    this.geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(this.heatArray, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSprite: { value: createManagedTexture(gridRef.armorImage) },
        uSpriteSize: { value: new THREE.Vector2(gridRef.srcWidth || 1, gridRef.srcHeight || 1) },
        uTime: { value: 0 },
        uLightDir: { value: new THREE.Vector3(0, 0, 1) },
        uDayAmbient: { value: SHIP_LIGHT_DEFAULTS.dayAmbient },
        uDayDiffuseMul: { value: SHIP_LIGHT_DEFAULTS.dayDiffuseMul },
        uHeatDecay: { value: DESTRUCTOR_CONFIG.heatDecay },
        uHeatTint: { value: DESTRUCTOR_CONFIG.debrisHeatGlow }
      },
      vertexShader: DEBRIS_VERTEX_SHADER,
      fragmentShader: DEBRIS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, GPU_DEBRIS_MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    Core3D.scene.add(this.mesh);
  }

  spawn(shard, worldX, worldY, vx, vy, angVel, startAngle, scale, globalTime) {
    const i = this.currentIndex;

    this.startPosArray[i * 2] = worldX;
    this.startPosArray[i * 2 + 1] = worldY;
    this.startVelArray[i * 2] = vx;
    this.startVelArray[i * 2 + 1] = vy;

    this.rotationArray[i * 3] = startAngle;
    this.rotationArray[i * 3 + 1] = angVel;
    this.rotationArray[i * 3 + 2] = scale * ((shard.radius || 20) / 25.0);

    const worldRadius = Math.max(0, (shard.radius || 5) * scale);
    const lifetime = 5 + 7 * Math.min(1, Math.max(0, (worldRadius - 5) / 15));
    this.timeArray[i * 2] = globalTime;
    this.timeArray[i * 2 + 1] = lifetime;

    // UV odłamka z pozycji siatki bez deformacji — poza spritem shader go odrzuci.
    this.gridPosArray[i * 2] = shard.origGridX ?? shard.gridX ?? 0;
    this.gridPosArray[i * 2 + 1] = shard.origGridY ?? shard.gridY ?? 0;

    // Żar zabrany z kadłuba, wyliczony na moment oderwania (ta sama formuła co
    // shardHeatNow w destructorze). PODŁOGA: metal urwany rozciąganiem przez
    // solver GPU nie przeszedł przez strefę zgniotu i miałby zerowy żar — ma
    // się świecić słabo, ale nie wcale.
    const heatPeak = Number(shard.heat) || 0;
    const heatAge = globalTime - (Number(shard.heatStamp) || 0);
    const heatNow = heatPeak > 0 && heatAge > 0
      ? heatPeak * Math.exp(-heatAge * (Number(DESTRUCTOR_CONFIG.heatDecay) || 0.45))
      : heatPeak;
    this.heatArray[i] = Math.max(Number(DESTRUCTOR_CONFIG.debrisHeatFloor) || 0, heatNow);

    if (i < this._dirtyMin) this._dirtyMin = i;
    if (i > this._dirtyMax) this._dirtyMax = i;
    this.lastExpiryTime = Math.max(this.lastExpiryTime, globalTime + lifetime);

    this.currentIndex = (this.currentIndex + 1) % GPU_DEBRIS_MAX;
    if (this.currentIndex === 0) this._dirtyWrapped = true;
    if (this.mesh.count < GPU_DEBRIS_MAX) this.mesh.count++;
  }

  // Jeden upload zakresu na klatkę (wołany z GpuDebrisManager.updateTime).
  commit() {
    if (this._dirtyMax < this._dirtyMin && !this._dirtyWrapped) return;
    const start = this._dirtyWrapped ? 0 : this._dirtyMin;
    const count = this._dirtyWrapped ? GPU_DEBRIS_MAX : (this._dirtyMax - this._dirtyMin + 1);
    const apply = (name, stride) => {
      const attr = this.geometry.getAttribute(name);
      setAttrUpdateRange(attr, start * stride, count * stride);
      attr.needsUpdate = true;
    };
    apply('aStartPos', 2);
    apply('aStartVel', 2);
    apply('aRotationData', 3);
    apply('aTimeData', 2);
    apply('aGridPos', 2);
    apply('aHeat', 1);
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._dirtyWrapped = false;
  }

  dispose() {
    if (Core3D.scene && this.mesh) Core3D.scene.remove(this.mesh);
    this.geometry?.dispose?.();
    this.material?.uniforms?.uSprite?.value?.dispose?.();
    this.material?.dispose?.();
  }
}

const GpuDebrisManager = {
  pools: new Map(),
  globalTime: 0,
  // Ustawiane z updateHexShips3D razem z uStressTint kadłubów (state.damageTintEnabled).
  heatTintEnabled: true,

  spawn(shard, gridRef, wx, wy, vx, vy, drot, angle, scale) {
    const texKey = shard.img;
    if (!texKey) return;

    let pool = this.pools.get(texKey);
    if (!pool) {
      pool = new GpuDebrisPool({
        armorImage: texKey,
        srcWidth: texKey.width || gridRef.srcWidth,
        srcHeight: texKey.height || gridRef.srcHeight
      });
      this.pools.set(texKey, pool);
    }
    pool.spawn(shard, wx, wy, vx, vy, drot, angle, scale, this.globalTime);
  },

  updateTime(time) {
    this.globalTime = time;
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    const camera = typeof window !== 'undefined' ? window.camera : null;
    for (const pool of this.pools.values()) {
      pool.commit();
      // All sizes have expired; a later small chip must not truncate a big one.
      // żeby pula po długiej bitwie nie mieliła na stałe 10k martwych slotów.
      if (pool.mesh.count > 0 && time > pool.lastExpiryTime) {
        pool.mesh.count = 0;
        pool.currentIndex = 0;
      }
      pool.material.uniforms.uTime.value = time;
      // Żar odłamków respektuje ten sam przełącznik co żar kadłuba.
      pool.material.uniforms.uHeatDecay.value = Math.max(0, Number(DESTRUCTOR_CONFIG.heatDecay) || 0);
      pool.material.uniforms.uHeatTint.value = this.heatTintEnabled
        ? Math.max(0, Number(DESTRUCTOR_CONFIG.debrisHeatGlow) || 0)
        : 0;
      if (sun && camera && pool.mesh.count > 0) {
        const dx = sun.x - camera.x;
        const dy = -(sun.y - camera.y);
        // In-place: bez alokacji Vector3 per pool per klatkę
        pool.material.uniforms.uLightDir.value.set(dx, dy, 600).normalize();
      }
    }
  },

  dispose() {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.globalTime = 0;
  }
};

if (typeof window !== 'undefined') {
  window.spawnGpuDebris = (shard, grid, wx, wy, vx, vy, drot, ang, scale) => {
    GpuDebrisManager.spawn(shard, grid, wx, wy, vx, vy, drot, ang, scale);
  };
}

function updateDebrisRendering() { }

function createEntityMesh(entity) {
  if (!entity?.hexGrid || !Array.isArray(entity.hexGrid.shards)) return null;

  refreshHexBodyCache(entity);

  const grid = entity.hexGrid;
  const shards = grid.shards;
  const count = shards.length;
  if (count <= 0) return null;

  const baseRadius = Math.max(2, Number(shards[0]?.radius) || 20);
  const geometry = new THREE.CircleGeometry(baseRadius * 1.04, 6);

  // Geometria/destrukcja może pracować na lekkiej, zmniejszonej masce, ale
  // render powinien próbkować oryginalny sprite, żeby małe klasy nie pikselowały
  // po przybliżeniu kamery.
  const visualImage = grid.visualImage || null;
  const armorSource = visualImage || grid.armorImage || grid.cacheCanvas;
  const texture = visualImage
    ? acquireSharedVisualTexture(visualImage)
    : createManagedTexture(armorSource);

  let normalTexture = null;
  if (grid.normalMapImage) {
    normalTexture = createManagedTexture(grid.normalMapImage, true);
  }

  // Mapa kształtu lakieru jest wspólna dla wszystkich kadłubów z tym samym
  // sprite'em (pieczona z jego alfy). Bez sprite'a albo bez lakieru — płaska.
  const shapeImageRef = (visualImage && allowsHullLacquer(entity)) ? visualImage : null;
  const shapeUniform = shapeImageRef
    ? HullLacquer.acquireShapeUniform(shapeImageRef)
    : HullLacquer.flatShapeUniform;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSprite: { value: texture },
      uNormalMap: { value: normalTexture },
      uHasNormalMap: { value: normalTexture ? 1 : 0 },
      uStressTint: { value: 0.30 },
      uHeatDecay: { value: DESTRUCTOR_CONFIG.heatDecay },
      uHeatPeak: { value: DESTRUCTOR_CONFIG.heatGlowPeak },
      uLightDir: { value: new THREE.Vector3(0, 0, 1) },
      uRotation: { value: 0.0 },
      uSpriteSize: { value: new THREE.Vector2(grid.srcWidth || 1, grid.srcHeight || 1) },
      uTerminatorStart: { value: SHIP_LIGHT_DEFAULTS.terminatorStart },
      uTerminatorEnd: { value: SHIP_LIGHT_DEFAULTS.terminatorEnd },
      uNightMin: { value: SHIP_LIGHT_DEFAULTS.nightMin },
      uNightBandStart: { value: SHIP_LIGHT_DEFAULTS.nightBandStart },
      uNightBandEnd: { value: SHIP_LIGHT_DEFAULTS.nightBandEnd },
      uNightTint: { value: new THREE.Vector3(SHIP_LIGHT_DEFAULTS.nightTintR, SHIP_LIGHT_DEFAULTS.nightTintG, SHIP_LIGHT_DEFAULTS.nightTintB) },
      uDayAmbient: { value: SHIP_LIGHT_DEFAULTS.dayAmbient },
      uDayDiffuseMul: { value: SHIP_LIGHT_DEFAULTS.dayDiffuseMul },
      uSpecularMul: { value: SHIP_LIGHT_DEFAULTS.specularMul },
      uIsOcclusion: { value: 0 },
      uBillboardLighting: { value: usesBillboardLighting(entity) ? 1 : 0 },
      uLodOpacity: { value: 1 },
      uTime: { value: 0 },
      // needsUpdate:false = bez uploadu, dopóki count = 0 (patrz setShipLightArraysUpload).
      uShipLightCount: { value: 0 },
      uShipLightData: { value: createLightUniformArray(), needsUpdate: false },
      uShipLightColor: { value: createLightUniformArray(), needsUpdate: false },
      uShipLightExtra: { value: createLightUniformArray(), needsUpdate: false },
      uShapeMap: shapeUniform,
      uLacquerWeight: { value: 0 },
      uLacquerGlint: { value: 1 },
      uEngineZoneCount: { value: 0 },
      uEngineZones: { value: createEngineZoneArray(), needsUpdate: false },
      // Wspólne obiekty — strojenie lakieru to jeden zapis na klatkę dla wszystkich.
      uLacquerEnv: HullLacquer.uniforms.uLacquerEnv,
      uLacquerSky: HullLacquer.uniforms.uLacquerSky,
      uLacquerEye: HullLacquer.uniforms.uLacquerEye,
      uLacquerA: HullLacquer.uniforms.uLacquerA,
      uLacquerB: HullLacquer.uniforms.uLacquerB,
      uLacquerC: HullLacquer.uniforms.uLacquerC,
      uLacquerD: HullLacquer.uniforms.uLacquerD,
      uLacquerE: HullLacquer.uniforms.uLacquerE
    },
    vertexShader: HEX_VERTEX_SHADER,
    fragmentShader: HEX_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const enableShadowCast = !entity?.isRingSegment;
  mesh.renderOrder = entity?.isRingSegment ? 0 : 10;
  mesh.castShadow = false;           // <-- CAŁKOWICIE WYŁĄCZONE RZUCANIE CIENIA
  mesh.customDepthMaterial = null;   // <-- CAŁKOWICIE WYŁĄCZONY MATERIAŁ DLA CIENI

  const initialArray = mesh.instanceMatrix.array;
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    initialArray[offset + 0] = 1.0;
    initialArray[offset + 5] = 1.0;
    initialArray[offset + 10] = 1.0;
    initialArray[offset + 15] = 1.0;
  }

  const gridPosArray = new Float32Array(count * 2);
  const stressArray = new Float32Array(count);
  // Żar startuje z POLA SHARDA, nie z zera: wrak odłączony w spawnWreckEntity
  // dostaje te same obiekty shardów i nowy mesh, więc rozgrzana blacha nie może
  // ostygnąć tylko dlatego, że zmieniła właściciela.
  const heatArray = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const shard = shards[i];
    if (typeof shard?.gridX === 'number' && typeof shard?.gridY === 'number') {
      // aGridPos = kotwica UV pancerza. Shader odrzuca UV poza [0,1], więc czyta się
      // ją z pozycji siatki BEZ deformacji — ekranową pozycję daje instance matrix
      // (gridX + deformation) liczony w updateEntityMesh.
      gridPosArray[i * 2] = shard.gridX;
      gridPosArray[i * 2 + 1] = shard.gridY;
    } else {
      const cx = (grid.srcWidth || 0) * 0.5;
      const cy = (grid.srcHeight || 0) * 0.5;
      gridPosArray[i * 2] = (shard?.lx || 0) + cx;
      gridPosArray[i * 2 + 1] = (shard?.ly || 0) + cy;
    }
    stressArray[i] = computeShardStress(shard);
    heatArray[i * 2] = Number(shard?.heat) || 0;
    heatArray[i * 2 + 1] = Number(shard?.heatStamp) || 0;
  }

  mesh.geometry.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(gridPosArray, 2));
  mesh.geometry.setAttribute('aStress', new THREE.InstancedBufferAttribute(stressArray, 1));
  mesh.geometry.getAttribute('aStress').setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aHeat', new THREE.InstancedBufferAttribute(heatArray, 2));
  mesh.geometry.getAttribute('aHeat').setUsage(THREE.DynamicDrawUsage);

  // The armor layer reuses the exact same texture and lighting uniforms.  At
  // distance it replaces thousands of interior hex instances, while boundary,
  // damaged and deforming hexes remain individually rendered above it.
  const armorGeometry = new THREE.PlaneGeometry(grid.srcWidth || 1, grid.srcHeight || 1);
  armorGeometry.translate(-(Number(grid?.pivot?.x) || 0), -(Number(grid?.pivot?.y) || 0), 0);
  const armorUniforms = { ...material.uniforms, uLodOpacity: { value: 0 } };
  const armorMaterial = new THREE.ShaderMaterial({
    uniforms: armorUniforms,
    vertexShader: ARMOR_VERTEX_SHADER,
    fragmentShader: HEX_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide
  });
  const armorMesh = new THREE.Mesh(armorGeometry, armorMaterial);
  armorMesh.frustumCulled = false;
  armorMesh.renderOrder = entity?.isRingSegment ? -1 : 9;
  armorMesh.visible = false;
  armorMesh.position.z = -0.25;

  Core3D.scene.add(armorMesh);
  Core3D.scene.add(mesh);

  const data = {
    mesh,
    armorMesh,
    texture,
    visualImageRef: visualImage,
    // Źródło tekstury, gdy sprite'a brak (fragmenty asteroid) — patrz needsRebuild.
    armorImageRef: visualImage ? null : (grid.armorImage || null),
    shapeImageRef,
    normalTexture,
    normalMapRef: grid.normalMapImage || null,
    gridPosAttr: mesh.geometry.getAttribute('aGridPos'),
    stressAttr: mesh.geometry.getAttribute('aStress'),
    heatAttr: mesh.geometry.getAttribute('aHeat'),
    shardsRef: shards,
    shardCount: count,
    srcWidth: grid.srcWidth || 1,
    srcHeight: grid.srcHeight || 1,
    pivotX: Number(grid?.pivot?.x) || 0,
    pivotY: Number(grid?.pivot?.y) || 0,
    baseRadius,
    lodMode: HEX_LOD.FULL,
    instanceLodMode: HEX_LOD.FULL,
    lodFadeStart: state.lastTime,
    lodFromHexOpacity: 1,
    lodFromArmorOpacity: 0,
    hexOpacity: 1,
    armorOpacity: 0,
    renderedHexCount: count,
    needsInstanceRefresh: true
  };
  state.entityMeshes.set(entity, data);
  return data;
}

function updateEntityMesh(entity, data, camX, camY, cameraZoom) {
  if (!entity?.hexGrid || !data?.mesh) return;
  const grid = entity.hexGrid;
  const shards = grid.shards;
  // `let`: po przebudowie niżej mesh MUSI wskazywać nowy obiekt. Dawniej reszta
  // funkcji pisała do starego, już zwolnionego mesha (count, uniformy, pozycja),
  // a flagi czyściła w nowych danych — nowy kadłub zostawał z macierzami
  // jednostkowymi (wszystkie heksy w środku) aż do pełnego odświeżenia.
  let mesh = data.mesh;
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;

  const needsRebuild =
    data.shardCount < shards.length ||
    data.srcWidth !== (grid.srcWidth || 1) ||
    data.srcHeight !== (grid.srcHeight || 1) ||
    data.visualImageRef !== (grid.visualImage || null) ||
    // Bez sprite'a tekstura idzie z armorImage — wrak z puli dostający siatkę
    // innego typu (fragment innej asteroidy) zachowywał starą teksturę.
    (!grid.visualImage && data.armorImageRef !== (grid.armorImage || null)) ||
    data.normalMapRef !== (grid.normalMapImage || null);

  if (needsRebuild) {
    // Najpierw nowe dane, dopiero potem zwolnienie starych: przy tym samym
    // sprite'cie współdzielona tekstura i mapa kształtu lakieru nie spadają do
    // zera referencji (inaczej ponowny upload tekstury z mipmapami i pieczenie).
    const previous = data;
    state.entityMeshes.delete(entity);
    data = createEntityMesh(entity);
    disposeMeshData(previous);
    if (!data) return;
    mesh = data.mesh;
  } else if (data.shardsRef !== shards) {
    const gridPosAttr = data.mesh.geometry.getAttribute('aGridPos');
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;

    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i];
      // UV z pozycji siatki bez deformacji — patrz komentarz w createEntityMesh.
      const baseX = shard.gridX;
      const baseY = shard.gridY;
      gridPosAttr.array[i * 2] = (typeof baseX === 'number') ? baseX : ((shard.lx || 0) + cx);
      gridPosAttr.array[i * 2 + 1] = (typeof baseY === 'number') ? baseY : ((shard.ly || 0) + cy);
    }
    gridPosAttr.needsUpdate = true;
    data.shardsRef = shards;
    data.needsInstanceRefresh = true;
  }

  if (pivotX !== data.pivotX || pivotY !== data.pivotY) {
    data.armorMesh.geometry.translate(data.pivotX - pivotX, data.pivotY - pivotY, 0);
    data.pivotX = pivotX;
    data.pivotY = pivotY;
    data.needsInstanceRefresh = true;
  }

  const interpPose = getInterpolatedRenderPose(entity);
  const ex = interpPose ? interpPose.x : getEntityPosX(entity);
  const ey = interpPose ? interpPose.y : getEntityPosY(entity);
  const entityAngle = interpPose ? interpPose.angle : (entity.angle || 0);
  const entityScale = getEntityScale(entity);
  const zoomPx = Math.max(0.0001, cameraZoom) * (Core3D.pixelRatio || 1);
  const screenRadiusPx = data.baseRadius * entityScale * zoomPx;
  const solidArmorAllowed = allowsSolidArmorLod(entity);

  // Wrak z oddali: jedna smuga we wspólnym batchu zamiast własnego wywołania
  // i zamiast pełnego przeliczenia macierzy wszystkich heksów.
  if (!solidArmorAllowed) {
    // Zasięg AKTYWNYCH heksów, nie sprite'a (fragment ma src rodzica).
    const lodScaleX = getEntityScaleX(entity);
    const lodScaleY = getEntityScaleY(entity);
    const extent = getGridActiveExtent(grid, state.lastTime);
    const bodyRadiusPx = Math.max(extent.halfW * Math.abs(lodScaleX), extent.halfH * Math.abs(lodScaleY)) * zoomPx;
    const tuning = (typeof window !== 'undefined' && window.DevTuning) ? window.DevTuning : null;
    const enterPx = Number.isFinite(Number(tuning?.wreckImpostorPx)) ? Number(tuning.wreckImpostorPx) : WRECK_IMPOSTOR_PX;
    const exitPx = enterPx * WRECK_IMPOSTOR_EXIT_MUL;
    const wasImpostor = data.batchedImpostor === true;
    const isImpostor = wasImpostor ? (bodyRadiusPx < exitPx) : (bodyRadiusPx < enterPx);

    if (isImpostor) {
      if (data.impostorColor === undefined) {
        data.impostorColor = computeAverageBodyColor(grid.visualImage || grid.armorImage || grid.cacheCanvas) || null;
      }
      if (data.impostorColor) {
        if (data.mesh.visible) data.mesh.visible = false;
        if (data.armorMesh.visible) data.armorMesh.visible = false;
        // Powrót do pełnego detalu musi przeliczyć wszystko od zera — przez czas
        // w batchu nie śledziliśmy meshDirty.
        data.needsInstanceRefresh = true;
        data.batchedImpostor = true;
        const halfW = extent.halfW * lodScaleX;
        const halfH = extent.halfH * lodScaleY;
        // Środek smugi = środek aktywnych heksów, przeniesiony tym samym
        // przekształceniem co mesh: T(ex, -ey) · Rz(rot) · S(sx, -sy).
        const rot = usesBillboardOrientation(entity) ? entityAngle : -entityAngle;
        const offX = extent.cx * lodScaleX;
        const offY = -extent.cy * lodScaleY;
        const cosRot = Math.cos(rot);
        const sinRot = Math.sin(rot);
        // Skalary zamiast obiektu per wrak per klatkę.
        const impostorColor = data.impostorColor;
        HexBodyImpostorBatch.pushRaw(
          ex + offX * cosRot - offY * sinRot,
          -ey + offX * sinRot + offY * cosRot,
          rot,
          halfW,
          halfH,
          impostorColor.r,
          impostorColor.g,
          impostorColor.b,
          1
        );
        DrawCallStats.addImpostor(1);
        lodFrameStats.impostorBodies++;
        lodFrameStats.totalStructuralHexes += shards.length;
        return;
      }
    }
    data.batchedImpostor = false;
  }

  resolveHexLod(data, screenRadiusPx, state.lastTime, solidArmorAllowed);

  // Upload tekstury pancerza = pełny texImage2D + regeneracja mipmap. W ostrzale
  // destroyShard ustawiał gpuTextureNeedsUpdate przy KAŻDYM heksie → kilka pełnych
  // uploadów na klatkę. Throttle per statek; flagi zostają ustawione, więc upload
  // dogania w pierwszej klatce po oknie (przy 100 ms wizualnie niezauważalne).
  const TEX_UPLOAD_MIN_MS = 100;
  if (!!grid.cacheDirty || !!grid.textureDirty || !!grid.gpuTextureNeedsUpdate) {
    const lastUpload = Number(data._lastTexUploadMs) || 0;
    if (lastUpload === 0 || (state.lastTime - lastUpload) >= TEX_UPLOAD_MIN_MS) {
      if (grid.cacheDirty) refreshHexBodyCache(entity);
      data.texture.needsUpdate = true;
      grid.textureDirty = false;
      grid.cacheDirty = false;
      grid.gpuTextureNeedsUpdate = false;
      data._lastTexUploadMs = state.lastTime;
    }
  }

  // Zegar kadłuba. Zanik żaru i sekwencja świateł pozycyjnych liczą się w
  // shaderze z uTime, więc musi jechać KAŻDEJ klatki i dla każdego mesha —
  // syncEntityLightUniforms potrafi wyjść wcześniej. Płyta pancerza dzieli te
  // same obiekty uniformów (spread w createEntityMesh kopiuje referencje), więc
  // jeden zapis wystarczy na obie siatki.
  const nowSec = state.lastTime * 0.001;
  mesh.material.uniforms.uTime.value = nowSec;

  if (!!grid.meshDirty || data.needsInstanceRefresh) {
    const stressAttr = data.stressAttr;
    const gridPosAttr = data.gridPosAttr;
    const heatAttr = data.heatAttr;

    const instanceArray = mesh.instanceMatrix.array;
    const cx = (grid.srcWidth || 0) * 0.5;
    const cy = (grid.srcHeight || 0) * 0.5;

    const hasRange =
      Number.isFinite(grid.meshDirtyStart) &&
      Number.isFinite(grid.meshDirtyEnd) &&
      grid.meshDirtyStart >= 0 &&
      grid.meshDirtyEnd >= grid.meshDirtyStart;

    const fullLod = data.instanceLodMode === HEX_LOD.FULL;
    const fullRefresh = !fullLod || data.needsInstanceRefresh || !!grid.meshDirtyAll || !hasRange;

    let start = 0;
    let end = shards.length - 1;

    if (!fullRefresh) {
      start = Math.max(0, grid.meshDirtyStart | 0);
      end = Math.min(shards.length - 1, grid.meshDirtyEnd | 0);
      if (end < start) {
        start = 0;
        end = shards.length - 1;
      }
    }

    if (fullLod) {
      mesh.count = shards.length;
      for (let i = start; i <= end; i++) {
        const shard = shards[i];
        const offset = i * 16;

        if (shard && shard.active && !shard.isDebris) {
          const deform = shard.deformation;
          const gx = shard.gridX + (deform ? deform.x : 0);
          const gy = shard.gridY + (deform ? deform.y : 0);

          instanceArray[offset + 12] = gx - cx - data.pivotX;
          instanceArray[offset + 13] = gy - cy - data.pivotY;
          instanceArray[offset + 0] = 1.0;
          instanceArray[offset + 5] = 1.0;

          const baseX = shard.gridX;
          const baseY = shard.gridY;
          gridPosAttr.array[i * 2] = Number(baseX) || 0;
          gridPosAttr.array[i * 2 + 1] = Number(baseY) || 0;
          stressAttr.array[i] = computeShardStress(shard);
          heatAttr.array[i * 2] = Number(shard.heat) || 0;
          heatAttr.array[i * 2 + 1] = Number(shard.heatStamp) || 0;
        } else {
          instanceArray[offset + 0] = 0.0;
          instanceArray[offset + 5] = 0.0;
          instanceArray[offset + 12] = 0.0;
          instanceArray[offset + 13] = 0.0;
          stressAttr.array[i] = 0;
          heatAttr.array[i * 2] = 0;
          heatAttr.array[i * 2 + 1] = 0;
        }
      }
    } else {
      // Compact selected instances into the leading span.  InstancedMesh.count
      // then actually lowers GPU vertex work; merely setting scale to zero would
      // still submit every interior hex.
      let writeIndex = 0;
      if (data.instanceLodMode === HEX_LOD.HYBRID) {
        for (let shardIndex = 0; shardIndex < shards.length; shardIndex++) {
          const shard = shards[shardIndex];
          if (!shouldRenderHybridShard(shard, nowSec)) continue;
          const offset = writeIndex * 16;
          const deform = shard.deformation;
          const gx = shard.gridX + (deform ? deform.x : 0);
          const gy = shard.gridY + (deform ? deform.y : 0);
          instanceArray[offset + 0] = 1.0;
          instanceArray[offset + 5] = 1.0;
          instanceArray[offset + 10] = 1.0;
          instanceArray[offset + 15] = 1.0;
          instanceArray[offset + 12] = gx - cx - data.pivotX;
          instanceArray[offset + 13] = gy - cy - data.pivotY;
          const baseX = shard.gridX;
          const baseY = shard.gridY;
          gridPosAttr.array[writeIndex * 2] = Number(baseX) || 0;
          gridPosAttr.array[writeIndex * 2 + 1] = Number(baseY) || 0;
          stressAttr.array[writeIndex] = computeShardStress(shard);
          heatAttr.array[writeIndex * 2] = Number(shard.heat) || 0;
          heatAttr.array[writeIndex * 2 + 1] = Number(shard.heatStamp) || 0;
          writeIndex++;
        }
      }
      mesh.count = writeIndex;
      data.renderedHexCount = writeIndex;
    }

    if (fullRefresh) {
      setAttrUpdateRange(mesh.instanceMatrix, 0, -1);
      setAttrUpdateRange(stressAttr, 0, -1);
      setAttrUpdateRange(gridPosAttr, 0, -1);
      setAttrUpdateRange(heatAttr, 0, -1);
    } else {
      const count = Math.max(0, end - start + 1);
      setAttrUpdateRange(mesh.instanceMatrix, start * 16, count * 16);
      setAttrUpdateRange(stressAttr, start, count);
      setAttrUpdateRange(gridPosAttr, start * 2, count * 2);
      setAttrUpdateRange(heatAttr, start * 2, count * 2);
    }

    mesh.instanceMatrix.needsUpdate = true;
    stressAttr.needsUpdate = true;
    gridPosAttr.needsUpdate = true;
    heatAttr.needsUpdate = true;
    if (fullLod) data.renderedHexCount = mesh.count;
    data.needsInstanceRefresh = false;
    grid.meshDirty = false;
    grid.meshDirtyAll = false;
    grid.meshDirtyStart = -1;
    grid.meshDirtyEnd = -1;
  }

  // Tuning uniformy: aplikuj tylko gdy epoka tuningu się zmieniła dla tego mesha.
  // _tuneEpoch jest odświeżany raz na klatkę w updateHexShips3D (refreshTuneEpoch()).
  if (data._tuneEpoch !== _tuneEpoch) {
    const tune = _tuneSnapshot;
    mesh.material.uniforms.uTerminatorStart.value = clamp(tune.terminatorStart, -1.0, 0.9);
    mesh.material.uniforms.uTerminatorEnd.value = clamp(tune.terminatorEnd, -0.8, 1.0);
    mesh.material.uniforms.uNightMin.value = clamp(tune.nightMin, 0.0, 0.8);
    mesh.material.uniforms.uNightBandStart.value = clamp(tune.nightBandStart, -1.0, 0.8);
    mesh.material.uniforms.uNightBandEnd.value = clamp(tune.nightBandEnd, -0.8, 1.0);
    mesh.material.uniforms.uNightTint.value.set(
      clamp(tune.nightTintR, 0.0, 0.3),
      clamp(tune.nightTintG, 0.0, 0.3),
      clamp(tune.nightTintB, 0.0, 0.3)
    );
    mesh.material.uniforms.uDayAmbient.value = clamp(tune.dayAmbient, 0.0, 1.0);
    mesh.material.uniforms.uDayDiffuseMul.value = clamp(tune.dayDiffuseMul, 0.0, 3.0);
    mesh.material.uniforms.uSpecularMul.value = clamp(tune.specularMul, 0.0, 1.5);
    data._tuneEpoch = _tuneEpoch;
  }

  const sun = typeof window !== 'undefined' ? window.SUN : null;
  if (sun) {
    const dx = sun.x - ex;
    const dy = -(sun.y - ey);
    // In-place: bez alokacji Vector3 per klatkę per statek
    mesh.material.uniforms.uLightDir.value.set(dx, dy, 600).normalize();
  }

  mesh.material.uniforms.uStressTint.value = state.damageTintEnabled ? 0.30 : 0.0;
  // Żar chodzi pod tym samym przełącznikiem co glow stresu, ale jasność bierze
  // z configu (suwak "heat glow peak" w panelu destruktora).
  mesh.material.uniforms.uHeatDecay.value = Math.max(0, Number(DESTRUCTOR_CONFIG.heatDecay) || 0);
  mesh.material.uniforms.uHeatPeak.value = state.damageTintEnabled
    ? Math.max(0, Number(DESTRUCTOR_CONFIG.heatGlowPeak) || 0)
    : 0.0;
  if (mesh.material.uniforms.uBillboardLighting) {
    mesh.material.uniforms.uBillboardLighting.value = usesBillboardLighting(entity) ? 1 : 0;
  }
  const bodyRadiusPx = Math.max(data.srcWidth, data.srcHeight) * 0.5 * entityScale * zoomPx;
  syncEntityLightUniforms(entity, data, grid, state.roadLightEmitters, bodyRadiusPx);
  syncEntityLacquer(entity, data, grid, entityScale, zoomPx);
  const renderRotation = usesBillboardOrientation(entity) ? entityAngle : -entityAngle;
  mesh.material.uniforms.uRotation.value = renderRotation;

  mesh.position.set(ex, -ey, 0);
  mesh.rotation.set(0, 0, renderRotation);
  const scaleX = getEntityScaleX(entity);
  const scaleY = getEntityScaleY(entity);
  mesh.scale.set(scaleX, -scaleY, 1);
  data.armorMesh.position.set(ex, -ey, -0.25);
  data.armorMesh.rotation.set(0, 0, renderRotation);
  data.armorMesh.scale.set(scaleX, -scaleY, 1);

  // Jedno ciało = jedno wywolanie na siatke heksow i jedno na plyte pancerza —
  // w praktyce widoczna jest jedna z nich naraz, ale w oknie przenikania LOD-u
  // obie. Wraki liczymy osobno, bo to one narastaja przez cala bitwe.
  const bodyDraws = (data.mesh.visible ? 1 : 0) + (data.armorMesh.visible ? 1 : 0);
  if (bodyDraws > 0) DrawCallStats.addHexBody(bodyDraws, !allowsSolidArmorLod(entity));

  lodFrameStats.totalStructuralHexes += shards.length;
  if (data.lodMode === HEX_LOD.FULL) {
    lodFrameStats.fullBodies++;
    lodFrameStats.fullHexes += data.renderedHexCount;
  } else if (data.lodMode === HEX_LOD.HYBRID) {
    lodFrameStats.hybridBodies++;
    lodFrameStats.hybridHexes += data.renderedHexCount;
  } else {
    lodFrameStats.impostorBodies++;
  }
}

export function initHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  ensureShipLightPanelApi();
  return true;
}

// Bank cząstek dem (błyski wylotowe armat i dział jonowych + Hexlance) ma
// dziesięć własnych programów shaderowych. Bez kompilacji na ekranie
// ładowania pierwszy strzał każdej rodziny broni gubi klatkę.
function prewarmFx3D() {
  if (!Fx3D.ensure() || !Core3D.renderer || !Core3D.cameraOrtho) return false;
  const meshes = Fx3D.meshes;
  for (const trail of [RailgunFX3D.prewarm(), BulletTrails.prewarm()]) {
    if (trail) meshes.push(trail);
  }
  const prev = meshes.map((m) => m.visible);
  for (const m of meshes) m.visible = true;
  Core3D.renderer.compile(Core3D.scene, Core3D.cameraOrtho);
  meshes.forEach((m, i) => { m.visible = prev[i]; });
  return true;
}

export function prewarmHexShips3D({ canvas = null } = {}) {
  if (!Core3D.isInitialized) Core3D.init(canvas);
  Weapon3DSystem.prewarmShaders();
  prewarmFx3D();
  return true;
}

export function resizeHexShips3D(width, height) {
  if (Core3D.isInitialized) Core3D.resize(width, height);
}

export function setHexDamageTintEnabled(enabled) {
  state.damageTintEnabled = enabled !== false;
  GpuDebrisManager.heatTintEnabled = state.damageTintEnabled;
  for (const [, data] of state.entityMeshes) {
    const uniforms = data?.mesh?.material?.uniforms;
    if (uniforms?.uStressTint) {
      uniforms.uStressTint.value = state.damageTintEnabled ? 0.30 : 0.0;
    }
    if (uniforms?.uHeatPeak) {
      uniforms.uHeatPeak.value = state.damageTintEnabled
        ? Math.max(0, Number(DESTRUCTOR_CONFIG.heatGlowPeak) || 0)
        : 0.0;
    }
  }
  return state.damageTintEnabled;
}

export function isHexDamageTintEnabled() {
  return state.damageTintEnabled !== false;
}

// coldWrecks: zimne wraki (src/game/coldWrecks.js) — tylko smugi z batcha.
export function updateHexShips3D(viewCamera, entities = [], cullInfo = null, coldWrecks = null) {
  if (!Core3D.isInitialized) return;

  const now = performance.now();
  state.lastTime = now;
  state.frameId++;

  Core3D.syncCamera(viewCamera);

  // Raz na klatkę: aktualizujemy migawkę globalnego tuningu, by per-mesh
  // updateEntityMesh mogło pominąć 9 zapisów uniformów gdy nic się nie zmieniło.
  refreshTuneEpoch();

  // Lakier: wspólne uniformy, tekstury odbić i kolejka pieczenia map
  // kształtu (jeden sprite na klatkę). Oko = cameraPersp, którą syncCamera
  // ustawia w każdym passie — trzymamy referencję do jej wektora pozycji.
  HullLacquer.update(Core3D.cameraPersp?.position);

  const camX = Number(viewCamera?.x) || 0;
  const camY = Number(viewCamera?.y) || 0;
  const cameraZoom = Math.max(0.0001, Number(viewCamera?.zoom) || 1);
  state.lastCull = cullInfo;
  state.lastCameraZoom = cameraZoom;
  DrawCallStats.begin();
  HexBodyImpostorBatch.begin();
  lodFrameStats.fullBodies = 0;
  lodFrameStats.hybridBodies = 0;
  lodFrameStats.impostorBodies = 0;
  lodFrameStats.fullHexes = 0;
  lodFrameStats.hybridHexes = 0;
  lodFrameStats.totalStructuralHexes = 0;
  lodFrameStats.entitiesIn = 0;
  lodFrameStats.culled = 0;
  lodFrameStats.warmOnly = 0;
  lodFrameStats.shaftCands = 0;
  lodFrameStats.shaftHulls = 0;
  lodFrameStats.shaftBakes = 0;
  lodFrameStats.coldImpostors = 0;

  const valid = state.validEntities;
  const vfxEntities = state.vfxEntities;
  const visibleHex = state.visibleHexEntities;
  const visibleVfx = state.visibleVfxEntities;
  const drawHex = state.drawHexEntities;
  const drawVfx = state.drawVfxEntities;
  const stale = state.staleEntities;
  const validSet = state.validEntitySet;
  valid.length = 0;
  vfxEntities.length = 0;
  visibleHex.length = 0;
  visibleVfx.length = 0;
  drawHex.length = 0;
  drawVfx.length = 0;
  stale.length = 0;
  validSet.clear();
  for (const entity of entities) {
    if (!entity || entity.dead) continue;
    lodFrameStats.entitiesIn++;
    valid.push(entity);
    const hideHexVisual = entity.hideHexVisual === true || entity.visual?.hideHexMesh === true;
    if (hideHexVisual) {
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      if (data?.armorMesh) data.armorMesh.visible = false;
      continue;
    }
    if (entity.hexGrid) validSet.add(entity);

    const visible = isEntityInCull(entity, cullInfo);
    if (!visible) {
      lodFrameStats.culled++;
      const data = state.entityMeshes.get(entity);
      if (data?.mesh) data.mesh.visible = false;
      if (data?.armorMesh) data.armorMesh.visible = false;
      continue;
    }

    visibleVfx.push(entity);
    const inDrawBox = isEntityInDrawBox(entity, cullInfo, cameraZoom);
    if (inDrawBox) drawVfx.push(entity);
    else lodFrameStats.warmOnly++;
    if (!entity.hexGrid) continue;
    visibleHex.push(entity);
    if (inDrawBox) drawHex.push(entity);
  }

  // Emitery świateł drogowych z CAŁEGO pudła rozgrzania: statek tuż poza
  // kadrem może oświetlać kadłub, który w kadrze jest.
  SHIP_LIGHT_EMITTER_OPTIONS.out = state.roadLightEmitters;
  buildRoadLightWorldEmitters(visibleHex, SHIP_LIGHT_EMITTER_OPTIONS);
  computeRoadEmitterReach(state.roadLightEmitters, state.roadLightReach);

  // Światła pozycyjne jako addytywne billboardy na warstwie FG (po
  // shadowShaftsPass): świecą HDR-owo pod bloom i przebijają cień planety.
  const navBuild = ShipLights3D.getSpriteBuildParams(cameraZoom);
  NAV_LIGHT_SPRITE_OPTIONS.out = state.navLightSprites;
  NAV_LIGHT_SPRITE_OPTIONS.zoom = cameraZoom;
  NAV_LIGHT_SPRITE_OPTIONS.haloScale = navBuild.haloScale;
  NAV_LIGHT_SPRITE_OPTIONS.minHaloWorld = navBuild.minHaloWorld;
  buildPositionLightWorldSprites(drawHex, NAV_LIGHT_SPRITE_OPTIONS);
  ShipLights3D.sync(state.navLightSprites, now * 0.001);

  let hasRenderable = false;
  const frameId = state.frameId;
  for (const entity of drawHex) {
    let data = state.entityMeshes.get(entity);
    if (!data) data = createEntityMesh(entity);
    if (!data) continue;

    // Powrót do pudła rysowania po przerwie: przez ten czas nie liczyliśmy
    // instancji ani LOD-u, więc jedno pełne odświeżenie.
    if (data.lastDrawFrame !== frameId - 1) data.needsInstanceRefresh = true;
    updateEntityMesh(entity, data, camX, camY, cameraZoom);
    // updateEntityMesh potrafi przebudować dane encji — znacznik na aktualnych.
    (state.entityMeshes.get(entity) || data).lastDrawFrame = frameId;
    hasRenderable = true;
  }

  // Pudło rozgrzania: mesh ma istnieć, zanim encja wejdzie w kadr (bez
  // przycięcia na tworzeniu), ale nic tu nie liczymy i nie rysujemy.
  for (const entity of visibleHex) {
    let data = state.entityMeshes.get(entity);
    if (data && data.lastDrawFrame === frameId) continue;
    if (!data) data = createEntityMesh(entity);
    if (!data) continue;
    if (data.mesh?.visible) data.mesh.visible = false;
    if (data.armorMesh?.visible) data.armorMesh.visible = false;
  }

  // Okludery shadow shafts: sylwetka kadłuba jako pole odległości
  // (hullShadowSdf.js). Shader passa idzie po nim promieniem do słońca, więc
  // smuga zaczyna się na burcie, obejmuje kolce i rozwidlenia, a kadłub nie
  // rzuca cienia sam na siebie. Działa na każdym zoomie, także dla statków
  // tuż poza kadrem. Selekcja od największych — dostają warstwę i pieczenie
  // pierwsze; ring-segmenty pomijamy, pierścień ma własny okluder
  // (setShaftRingOccluder).
  if (typeof Core3D.beginShaftHullFrame === 'function') Core3D.beginShaftHullFrame();
  const shaftHullBudget = typeof Core3D.getShaftHullBudget === 'function' ? Core3D.getShaftHullBudget() : 0;
  if (shaftHullBudget > 0) {
    HullShadowSdf.beginFrame(frameId);
    Core3D.setShaftHullSdfTexture(HullShadowSdf.ensureTexture());
    const halfView = Math.max(window.innerWidth || 1920, window.innerHeight || 1080) * 0.5 / cameraZoom;
    const occluderReach = halfView + 30000;
    const cands = state.shaftHullCandidates || (state.shaftHullCandidates = []);
    cands.length = 0;
    for (const entity of valid) {
      if (!entity.hexGrid || entity.isRingSegment) continue;
      if (entity.hideHexVisual === true || entity.visual?.hideHexMesh === true) continue;
      const grid = entity.hexGrid;
      const scaleX = Math.abs(getEntityScaleX(entity)) || 1;
      const scaleY = Math.abs(getEntityScaleY(entity)) || 1;
      let w = (Number(grid.srcWidth) || 0) * scaleX;
      let h = (Number(grid.srcHeight) || 0) * scaleY;
      if (entity.isWreck === true || grid.isFragment === true) {
        // Wrak/fragment: rozmiar z aktywnych heksów — src to sprite rodzica,
        // więc drobnica sortowała się jak cały okręt i zabierała mu slot cienia.
        const ext = getGridActiveExtent(grid, now);
        w = ext.halfW * 2 * scaleX;
        h = ext.halfH * 2 * scaleY;
      }
      const size = Math.max(w, h);
      if (size < 40) continue; // drobnica nie rzuca sensownego cienia
      const ex = getEntityPosX(entity);
      const ey = getEntityPosY(entity);
      if (Math.abs(ex - camX) > occluderReach || Math.abs(ey - camY) > occluderReach) continue;
      cands.push({ entity, grid, size, ex, ey, scaleX, scaleY });
    }
    lodFrameStats.shaftCands = cands.length;
    if (cands.length > 1) cands.sort((a, b) => b.size - a.size);
    let pushed = 0;
    for (let i = 0; i < cands.length && pushed < shaftHullBudget; i++) {
      const c = cands[i];
      // null = sylwetka czeka na pieczenie (budżet klatki) — cień od następnej.
      const occ = HullShadowSdf.acquire(c.grid, now);
      if (!occ) continue;
      const interpPose = getInterpolatedRenderPose(c.entity);
      const px = interpPose ? interpPose.x : c.ex;
      const py = interpPose ? interpPose.y : c.ey;
      const rawAng = interpPose ? interpPose.angle : (c.entity.angle || 0);
      // rotation.z mesha kadłuba (updateEntityMesh): -kąt, billboard +kąt.
      const rot = usesBillboardOrientation(c.entity) ? rawAng : -rawAng;
      packHullShaftOccluder(shaftOccluderScratch, 0, px, py, rot,
        getEntityScaleX(c.entity), getEntityScaleY(c.entity), occ.layout, occ.layer);
      // pushShaftHullSdf zwraca false po zapełnieniu rejestru — koniec.
      if (!Core3D.pushShaftHullSdf(shaftOccluderScratch, 0)) break;
      pushed++;
    }
    lodFrameStats.shaftHulls = pushed;
    lodFrameStats.shaftBakes = HullShadowSdf.stats.bakes;
  }

  // Wieżyczki: zbieramy je do bufora 2D, rysuje je pętla renderu w index.html.
  // Bufor MUSI powstać przed syncProjectiles — błyski wylotowe i początki
  // wiązek szukają w nim lufy, z której padł strzał.
  // Przelacznik "Bronie" w perf HUD gasi teraz wiezyczki 2D (wczesniej chowal
  // kontenery siatek) — zostaje dzwignia do porownania kosztu w locie.
  Turret2D.enabled = Core3D.perfToggles?.fgWeapons !== false;
  Turret2D.beginFrame();
  // Tylko pudło rysowania — Turret2D.draw i tak odrzuca wieżyczki spoza kadru,
  // a sync liczył je dla całych 9 ekranów.
  for (const entity of drawVfx) {
    const interpPose = getInterpolatedRenderPose(entity);
    const ex = interpPose ? interpPose.x : getEntityPosX(entity);
    const ey = interpPose ? interpPose.y : getEntityPosY(entity);
    const eAngle = interpPose ? interpPose.angle : (entity.angle || 0);
    const scale = getEntityScale(entity);
    Turret2D.sync(entity, ex, ey, eAngle, scale);
  }
  DrawCallStats.setTurrets2D(Turret2D.frameCount);
  // Wygaszanie odrzutu — raz na klatke, niezaleznie od liczby passow 2D
  // (split-screen rysuje ten sam bufor dwa razy).
  Turret2D.update();
  Weapon3DSystem.syncProjectiles((typeof window !== 'undefined' && Array.isArray(window.bullets)) ? window.bullets : []);

  GpuDebrisManager.heatTintEnabled = state.damageTintEnabled;
  GpuDebrisManager.updateTime(now * 0.001);
  updateDebrisRendering();

  for (const [entity] of state.entityMeshes) {
    if (!validSet.has(entity)) stale.push(entity);
  }
  for (const entity of stale) {
    const data = state.entityMeshes.get(entity);
    disposeMeshData(data);
    state.entityMeshes.delete(entity);
  }

  // Zimne wraki: sama smuga, po gorących (te mają pierwszeństwo w batchu).
  // Nie są okluderami cieni, źródłami świateł, rekordami Turret2D ani encjami
  // VFX — dlatego nie idą przez listę `entities`.
  if (Array.isArray(coldWrecks) && coldWrecks.length > 0) {
    const pushed = pushColdWreckImpostors(HexBodyImpostorBatch, coldWrecks, cullInfo, COLD_WRECK_CONFIG.impostorOpacity);
    if (pushed > 0) DrawCallStats.addImpostor(pushed);
    lodFrameStats.coldImpostors = pushed;
  }

  HexBodyImpostorBatch.flush();

  vfxEntities.push(...visibleVfx);
  EngineVfxSystem.update(visibleVfx);

  state.hadRenderableLastFrame = hasRenderable || visibleHex.length > 0;
  if (typeof window !== 'undefined') window.__hexLodStats = lodFrameStats;
}

function resetDrawPerfScratch() {
  drawPerfScratch.coreCallMs = 0;
  drawPerfScratch.coreRenderMs = 0;
  drawPerfScratch.composerMs = 0;
  drawPerfScratch.blitMs = 0;
}

function addCoreDrawPerf(coreCallMs) {
  drawPerfScratch.coreCallMs += coreCallMs;
  const corePerf = Core3D.lastFramePerf;
  if (!corePerf) return;
  drawPerfScratch.coreRenderMs += Number(corePerf.renderTotalMs) || 0;
  drawPerfScratch.composerMs += Number(corePerf.composerMs) || 0;
}

function publishDrawPerfScratch() {
  if (typeof window !== 'undefined') {
    window.__hexShips3DLastDrawPerf = drawPerfScratch;
  }
}

export function drawHexShips3D(ctx, width, height) {
  resetDrawPerfScratch();
  if (!ctx || !Core3D.isInitialized) {
    publishDrawPerfScratch();
    return;
  }
  const src = Core3D.canvas;
  if (!src) {
    publishDrawPerfScratch();
    return;
  }

  const w = Math.max(1, Number(width) || ctx.canvas?.width || 1);
  const h = Math.max(1, Number(height) || ctx.canvas?.height || 1);
  const isSplit = typeof window !== 'undefined'
    && window.splitScreenMode && Core3D.activeCam2;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (isSplit) {
    const halfW = Math.floor(w / 2);
    const srcW = src.width;
    const srcH = src.height;
    // Crop center 50% of the full render — correct perspective for half-screen
    const srcCropX = Math.floor(srcW / 4);
    const srcCropW = Math.floor(srcW / 2);

    // P1 (left half)
    let tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam1);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    tDrawPerf0 = performance.now();
    ctx.drawImage(src, srcCropX, 0, srcCropW, srcH, 0, 0, halfW, h);
    drawPerfScratch.blitMs += performance.now() - tDrawPerf0;

    // P2 (right half)
    tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam2);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    tDrawPerf0 = performance.now();
    ctx.drawImage(src, srcCropX, 0, srcCropW, srcH, halfW, 0, w - halfW, h);
    drawPerfScratch.blitMs += performance.now() - tDrawPerf0;
  } else {
    const tDrawPerf0 = performance.now();
    Core3D.renderSingle(Core3D.activeCam1);
    addCoreDrawPerf(performance.now() - tDrawPerf0);
    const tBlit0 = performance.now();
    ctx.drawImage(src, 0, 0, w, h);
    drawPerfScratch.blitMs += performance.now() - tBlit0;
  }

  ctx.restore();
  publishDrawPerfScratch();
}

// Kadłuby NPC: tekstura sprite'a i mapa kształtu lakieru powstawały przy
// pierwszym meshu danego typu w kadrze (upload + ~10 ms pieczenia w tej
// klatce), a po śmierci ostatniego statku typu były zwalniane — następna
// flota płaciła znowu. Rozgrzanie przy inicjalizacji ciała heksowego (NPC
// dostają je przy spawnie, także poza kadrem) trzyma stałą referencję: upload
// idzie w wolnej chwili z kolejki Core3D, lakier w kolejce pieczenia, oba
// zostają na resztę sesji (jeden egzemplarz na typ kadłuba).
const prewarmedHullImages = new WeakSet();
export function prewarmHexShipVisual(image) {
  if (!image || prewarmedHullImages.has(image) || !Core3D.isInitialized) return false;
  prewarmedHullImages.add(image);
  Core3D.queueTextureUpload(acquireSharedVisualTexture(image));
  HullLacquer.acquireShapeUniform(image);
  return true;
}

export function invalidateHexShipEntity3D(entity) {
  if (!entity) return false;
  const data = state.entityMeshes.get(entity);
  if (!data) return false;
  disposeMeshData(data);
  state.entityMeshes.delete(entity);
  return true;
}

// === ZIMNE WRAKI (src/game/coldWrecks.js) ===

function getWreckImpostorEnterPx() {
  const tuning = (typeof window !== 'undefined' && window.DevTuning) ? window.DevTuning : null;
  return Number.isFinite(Number(tuning?.wreckImpostorPx)) ? Number(tuning.wreckImpostorPx) : WRECK_IMPOSTOR_PX;
}

/**
 * Czy zamrożenie wraku przejdzie niezauważone: wrak jest poza pudłem
 * rysowania ostatniej klatki albo już leży w batchu smug (to samo kryterium
 * co updateEntityMesh), więc zamiana heksów na smugę nie przeskoczy obrazem.
 */
export function isColdFreezeVisuallySafe(entity) {
  const cull = state.lastCull;
  if (!entity || !cull) return true;
  if (!isEntityInDrawBox(entity, cull, state.lastCameraZoom)) return true;
  const data = state.entityMeshes.get(entity);
  if (data) return data.batchedImpostor === true;
  // W kadrze, ale bez meshu (dopiero wszedł): policz jak updateEntityMesh.
  const grid = entity.hexGrid;
  if (!grid) return true;
  const ext = getGridActiveExtent(grid, state.lastTime);
  const zoomPx = Math.max(0.0001, state.lastCameraZoom) * (Core3D.pixelRatio || 1);
  const bodyRadiusPx = Math.max(ext.halfW * Math.abs(getEntityScaleX(entity)), ext.halfH * Math.abs(getEntityScaleY(entity))) * zoomPx;
  return bodyRadiusPx < getWreckImpostorEnterPx();
}

// Kolor smugi per obraz kadłuba — ta sama średnia co data.impostorColor
// gorącego wraku (computeAverageBodyColor na visualImage/armorImage).
const coldImpostorColorBySource = new WeakMap();

/**
 * Przy zamrażaniu, PRZED invalidateHexShipEntity3D: kolor (z meshu, póki
 * istnieje) i gotowa smuga na zrzucie (`snapshot.color`, `snapshot.impostor`).
 */
export function captureColdWreckImpostor(entity, snapshot) {
  if (!entity || !snapshot?.extent) return false;
  let color = state.entityMeshes.get(entity)?.impostorColor || null;
  if (!color) {
    const source = snapshot.visualImage || snapshot.armorImage || entity.hexGrid?.cacheCanvas || null;
    if (source) {
      color = coldImpostorColorBySource.get(source);
      if (color === undefined) {
        color = computeAverageBodyColor(source) || null;
        coldImpostorColorBySource.set(source, color);
      }
    }
  }
  if (color) snapshot.color = { r: color.r, g: color.g, b: color.b };
  const angle = Number(entity.angle) || 0;
  const rot = usesBillboardOrientation(entity) ? angle : -angle;
  return !!prepareColdWreckImpostor(
    snapshot,
    getEntityPosX(entity),
    getEntityPosY(entity),
    rot,
    getEntityScaleX(entity),
    getEntityScaleY(entity)
  );
}

export function disposeHexShips3D() {
  for (const [, data] of state.entityMeshes) disposeMeshData(data);
  state.entityMeshes.clear();
  GpuDebrisManager.dispose();
  EngineVfxSystem.disposeAll();
  Weapon3DSystem.disposeAll();
  Turret2D.clear();
  ShipLights3D.dispose();
  HullShadowSdf.reset();
  state.navLightSprites.length = 0;
  state.frameId = 0;
  state.hadRenderableLastFrame = false;
}
