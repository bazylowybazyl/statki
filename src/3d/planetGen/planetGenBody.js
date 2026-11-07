// src/3d/planetGen/planetGenBody.js
//
// Ciało planety z generatora na MATERIAŁACH GRY: powierzchnia (graf 'surface' — dzień, noc, połysk, normalne,
// mgiełka, pas zachodu; olbrzymy — graf 'genGas' na wspólnym silniku żywej atmosfery), chmury (graf 'clouds'),
// poświata limbu (powłoka planet tła — graf 'atmosphere', albo dysk planet przy ringu — 'ringAtmosphere').
// Kształt `uniforms` = DirectPlanet.init (planet3d.assets.js) — to samo, co wpięcie w grze ustawi z opisu planety
// (`planetSurfaceUniforms`, `planetCloudUniforms`, `planetHaloUniforms`); tu też składanie siatek dla dema.
import * as THREE from 'three/webgpu';
import {
  createPlanetSurfaceMaterial, createPlanetCloudMaterial, createPlanetAtmosphereMaterial, createRingAtmosphereMaterial
} from '../planet3d.assets.tsl.js';
import { createGenGasSurfaceMaterial, GenGasAtmosphere } from './planetGenGas.js';
import { createGenRingMesh } from './planetGenRing.js';

// Strojenie poświaty planet tła jak w grze (HALO_DEFAULTS w planet3d.assets.js).
export const GEN_HALO_DEFAULTS = Object.freeze({ sizeMul: 0.985, coefMul: 1.08, coefAdd: 0.12, powerMul: 1.0, powerAdd: 1.5 });

function solidTexture(rgba, colorSpace) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}
// Wspólne zastępcze (bez pamięci na planetę): noc czarna, połysk zero, normalna płaska.
export const GEN_BLACK_NIGHT = solidTexture([0, 0, 0, 255], THREE.SRGBColorSpace);
export const GEN_NO_SPEC = solidTexture([0, 0, 0, 255], THREE.NoColorSpace);
export const GEN_FLAT_NORMAL = solidTexture([128, 128, 255, 255], THREE.NoColorSpace);

/**
 * `material.uniforms` powierzchni z opisu i map (jak DirectPlanet). Mapa normalnych grafu gry działa tylko przy
 * `hasNightTexture = 1` — planeta bez świateł dostaje czarną noc 1 × 1, żeby rzeźba była widoczna.
 */
export function planetSurfaceUniforms(spec, maps, { ringAnchored = false } = {}) {
  const s = spec.surface;
  const hz = spec.haze;
  const gas = spec.kind === 'gas';
  return {
    uPlanetBloom: { value: s.bloom }, dayTexture: { value: maps.day },
    nightTexture: { value: gas ? null : (maps.night || GEN_BLACK_NIGHT) },
    specularTexture: { value: maps.spec || GEN_NO_SPEC }, normalTexture: { value: maps.normal || GEN_FLAT_NORMAL },
    sunPosition: { value: new THREE.Vector3(0, 0, -50000) }, hasNightTexture: { value: gas ? 0.0 : 1.0 },
    uBrightness: { value: s.bright }, uSpecular: { value: maps.spec ? s.specular : 0.0 }, uSunIntensity: { value: s.sunInt },
    uHazeStrength: { value: hz.strength }, uHazeColor: { value: new THREE.Vector3(...hz.color) }, uHazeBeta: { value: new THREE.Vector3(...hz.beta) },
    uRingShadowStrength: { value: 0.0 }, uRingShadowRadius: { value: 0.0 }, uRingShadowReach: { value: 1.0 }, uRingShadowCenter: { value: new THREE.Vector2() },
    uSunShadowRecv: { value: ringAnchored ? 1.0 : 0.0 }, uPitMode: { value: 0.0 }, uBite: { value: new THREE.Vector4(9, 0, 0, 0) }
  };
}

/** `uniforms` chmur (DirectPlanet: cloudUniforms dzielą mgiełkę i cień ringu z powierzchnią). */
export function planetCloudUniforms(spec, maps, U) {
  return {
    cloudTexture: { value: maps.clouds }, sunPosition: U.sunPosition, uOpacity: { value: spec.clouds.opacity },
    uHazeStrength: U.uHazeStrength, uHazeColor: U.uHazeColor, uHazeBeta: U.uHazeBeta,
    uRingShadowStrength: U.uRingShadowStrength, uRingShadowRadius: U.uRingShadowRadius, uRingShadowReach: U.uRingShadowReach,
    uRingShadowCenter: U.uRingShadowCenter, uSunShadowRecv: U.uSunShadowRecv, uPitMode: { value: 0.0 }, uBite: { value: new THREE.Vector4(9, 0, 0, 0) }
  };
}

/** Poświata planet tła (powłoka, graf 'atmosphere'): uniformy i promień powłoki. */
export function planetHaloUniforms(spec, U) {
  const h = spec.halo;
  const H = GEN_HALO_DEFAULTS;
  return {
    size: 1.10 * H.sizeMul,
    uniforms: {
      coef: { value: h.coef * H.coefMul + H.coefAdd }, power: { value: h.power * H.powerMul + H.powerAdd },
      glowColor: { value: new THREE.Vector3(...h.color) }, sunsetTint: { value: new THREE.Vector3(...h.sunset) },
      uSunIntensity: { value: spec.surface.sunInt }, sunPosition: U.sunPosition, uSunShadowRecv: U.uSunShadowRecv
    }
  };
}

/** Poświata limbu planet przy ringu (dysk, graf 'ringAtmosphere'): uniformy, promień dysku; `worldR` — promień planety w grze. */
export function planetRingAtmUniforms(spec, worldR) {
  const t = spec.ringAtm;
  const ra = 1 + t.height / worldR;
  return {
    size: ra,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uRa: { value: ra }, uHs: { value: t.height * 0.22 / worldR },
      uDayColor: { value: new THREE.Vector3(...t.day) }, uSunsetColor: { value: new THREE.Vector3(...t.sunset) },
      uGain: { value: new THREE.Vector3(1.02, 0.985, 0.933).multiplyScalar(t.gain) }, uSunShadowRecv: { value: 0 },
      uPitMode: { value: 0 }, uBite: { value: new THREE.Vector4(9, 0, 0, 0) }, uBiteEast: { value: new THREE.Vector3(1, 0, 0) }
    }
  };
}

/**
 * Siatki ciała do sceny (demo; w grze — DirectPlanet z tymi samymi uniformami). Kula promienia 1, biegun N = +Y,
 * doba — obrót wokół Y. Wynik: { group, mesh, clouds, atm, ring, uniforms, atmosphere (zegar olbrzyma), setSun(dir),
 * step(dt, rate), dispose() }.
 */
export function createGenPlanetBody(spec, baked, { segments = 160, halo = true } = {}) {
  const group = new THREE.Group();
  const maps = baked.maps;
  const U = planetSurfaceUniforms(spec, maps);
  const geo = new THREE.SphereGeometry(1, segments, Math.round(segments / 2));
  let atmosphere = null;
  let material;
  if (spec.kind === 'gas') {
    // GasGiantAtmosphere czyta planet.uniforms, isRingAnchored (false — bez kamery gry: tempo 1) i promień grupy.
    // Mapa dnia BEZ podania: konstruktor silnika ustawia zawijanie i `needsUpdate` — na teksturze celu renderu to
    // gubi próbnik w grupie wiązań; cel wypieku ma już RepeatWrapping w u (planetGenBaker.js).
    atmosphere = new GenGasAtmosphere(baked.gas, { uniforms: U, isRingAnchored: false, group: { scale: { x: 60000 } } }, null);
    material = createGenGasSurfaceMaterial(U);
  } else {
    material = createPlanetSurfaceMaterial(U);
  }
  const mesh = new THREE.Mesh(geo, material);
  group.add(mesh);
  let clouds = null;
  let cloudUniforms = null;
  if (maps.clouds) {
    cloudUniforms = planetCloudUniforms(spec, maps, U);
    clouds = new THREE.Mesh(new THREE.SphereGeometry(1.005, segments, Math.round(segments / 2)), createPlanetCloudMaterial(cloudUniforms));
    group.add(clouds);
  }
  let atm = null;
  if (halo && (spec.halo.coef > 0.2 || spec.haze.strength > 0.05)) {
    const hu = planetHaloUniforms(spec, U);
    atm = new THREE.Mesh(new THREE.SphereGeometry(hu.size, 96, 48), createPlanetAtmosphereMaterial(hu.uniforms));
    group.add(atm);
  }
  let ring = null;
  if (spec.kind === 'gas' && spec.look.ring) {
    ring = createGenRingMesh(spec, U.sunPosition);
    group.add(ring.mesh);
  }
  const _sun = new THREE.Vector3();
  return {
    spec, group, mesh, clouds, atm, ring, uniforms: U, cloudUniforms, atmosphere,
    /** Kierunek słońca w układzie sceny (pozycja słońca daleko w tym kierunku od środka grupy). */
    setSun(dir) {
      _sun.copy(dir).normalize().multiplyScalar(1e4).add(group.position);
      U.sunPosition.value.copy(_sun);
    },
    /** Krok czasu (doba, chmury, atmosfera olbrzyma): dt [s], `rate` — tempo atmosfery. */
    step(dt, { spin = 0, cloudSpin = 0, rate = 1 } = {}) {
      mesh.rotation.y += spin * dt;
      if (clouds) clouds.rotation.y += (spin + cloudSpin) * dt;
      if (atmosphere) atmosphere.sync(dt * rate, dt);
    },
    dispose() {
      geo.dispose();
      material.dispose();
      if (clouds) { clouds.geometry.dispose(); clouds.material.dispose(); }
      if (atm) { atm.geometry.dispose(); atm.material.dispose(); }
      if (ring) ring.dispose();
    }
  };
}
