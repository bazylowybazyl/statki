// src/3d/planetGen/planetGenNear.js
//
// PLANETA Z BLISKA: ciało planety generatora na materiale zbliżenia (graf 'genSolidNear' — planetGenSurfaceNear.tsl.js)
// z wycinkami mapy pod kamerą (planetGenPatch.js), żarem lawy i erupcją z pióropuszem (planetGenPlume.tsl.js).
// Składanie siatek i uniformów jak `createGenPlanetBody` (planetGenBody.js); w grze te same uniformy dostanie
// DirectPlanet planety, przy której jest gracz (dalsze planety zostają na 'genSolid').
import * as THREE from 'three/webgpu';
import { planetSurfaceUniforms, planetCloudUniforms } from './planetGenBody.js';
import { createGenCloudVolumeMaterial, cloudVolumeUniforms } from './planetGenCloudVolume.tsl.js';
import { createGenAtmosphereMaterial, atmosphereUniforms, createGenAuroraMaterial, auroraUniforms } from './planetGenShell.tsl.js';
import { rngFor } from './planetGenRng.js';
import { createGenCloudNearMaterial, GEN_CLOUD_NEAR_DATA_KEYS } from './planetGenCloudsNear.tsl.js';
import { createGenNearSurfaceMaterial, GEN_NEAR_DATA_KEYS } from './planetGenSurfaceNear.tsl.js';
import { createPlumeMaterial, plumeUniforms } from './planetGenPlume.tsl.js';
import { PlanetGenPatches } from './planetGenPatch.js';

/** Wygląd lawy wg rodzaju i stylu: częstość płyt skorupy [1/promień], szerokość szwu [komórki], albedo skorupy, połysk. */
export function lavaLookFor(spec) {
  const style = spec.look?.style;
  if (spec.type !== 'volcanic') return { plates: 700, seam: 0.07, crust: 0.03, gloss: 0.0, glow: 0 };
  if (style === 'lawa') return { plates: 620, seam: 0.075, crust: 0.022, gloss: 0.55, glow: 1.0 };
  if (style === 'siarka') return { plates: 820, seam: 0.065, crust: 0.03, gloss: 0.35, glow: 0.9 };
  return { plates: 760, seam: 0.07, crust: 0.026, gloss: 0.4, glow: 1.0 };
}

/**
 * `material.uniforms` materiału zbliżenia: uniformy 'genSolid' (planetSurfaceUniforms) + wycinki (puste), lawa,
 * pióropusz. `maps.mask` — mapa masek planety (wypiek z `mask: true`). `lava` — siła żaru (opis.night.lava planety
 * sprzed wyzerowania nocy — noc piecze się wtedy bez lawy: żar daje materiał, w dzień i w nocy).
 */
export function nearSurfaceUniforms(spec, maps, { lava = 0, size = 0 } = {}) {
  const U = planetSurfaceUniforms(spec, maps, { size });
  const look = lavaLookFor(spec);
  // odcień żaru z palety planety — słaby (potęga 0,12): barwę niesie temperatura (czerwień → pomarańcz → żółtobiały),
  // pełna barwa palety (liniowo ~(1; 0,15; 0,01)) zostawiała samą czerwień
  const lc = (spec.look?.palette?.lava || [1.0, 0.42, 0.08]).map((v) => Math.pow(Math.max(v, 1e-4), 0.12));
  const lm = Math.max(lc[0], lc[1], lc[2], 1e-3);
  const slot = (s) => ({
    [`uGn${s}X`]: { value: new THREE.Vector3(1, 0, 0) }, [`uGn${s}Y`]: { value: new THREE.Vector3(0, 1, 0) },
    [`uGn${s}Z`]: { value: new THREE.Vector3(0, 0, 1) },
    [`uGn${s}W`]: { value: new THREE.Vector4(0, 0, 1, 1) }, [`uGn${s}T`]: { value: new THREE.Vector4(1, 0, 0, 0) }
  });
  Object.assign(U, slot('A'), slot('B'), {
    uGnLava: { value: new THREE.Vector4(lava * look.glow, 0, 1, look.gloss) },
    uGnLavaCol: { value: new THREE.Vector3(lc[0] / lm, lc[1] / lm, lc[2] / lm) },
    uGnLava2: { value: new THREE.Vector4(look.plates, look.seam, look.crust, look.detail ?? 2.2) },
    // cień chmur na gruncie: kąt kuli chmur względem gruntu, wysokość chmur [R], siła (ustawia ciało co klatkę)
    uGnCloud: { value: new THREE.Vector4(0, 0.0035, 0, 0) },
    uGnCloudVol: { value: new THREE.Vector4(0.003, 0.017, 1.15, 23) },
    uGnCloudVol2: { value: new THREE.Vector4(0, 0, 0, 0) },
    // sieci świateł miast (planety z miastami): siła, częstość arterii, pół szerokości nitki [rad]
    uGnCity: { value: new THREE.Vector4(spec.night?.cities > 0 ? 1.1 + 1.3 * spec.night.cities : 0, 34, 0, 0) },
    [GEN_NEAR_DATA_KEYS.cloudShadow]: { value: maps.clouds || null },
    [GEN_NEAR_DATA_KEYS.mask]: { value: maps.mask || null },
    [GEN_NEAR_DATA_KEYS.dayA]: { value: null }, [GEN_NEAR_DATA_KEYS.reliefA]: { value: null }, [GEN_NEAR_DATA_KEYS.maskA]: { value: null },
    [GEN_NEAR_DATA_KEYS.dayB]: { value: null }, [GEN_NEAR_DATA_KEYS.reliefB]: { value: null }, [GEN_NEAR_DATA_KEYS.maskB]: { value: null }
  }, plumeUniforms());
  // połysk lawy liczy materiał z maski cieczy — z mapy połysku planety zostaje reszta (lód, solanka)
  if (look.gloss > 0) U.uSpecular.value = Math.max(U.uSpecular.value, 0.35);
  return U;
}

/** Przepisuje stan wycinków (PlanetGenPatches) do uniformów materiału zbliżenia — co klatkę po `patches.update`. */
export function bindPatches(U, patches) {
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 'A' : 'B';
    const slot = patches.slots[i];
    const w = slot.win;
    U[GEN_NEAR_DATA_KEYS[`day${s}`]].value = slot.set.day.texture;
    U[GEN_NEAR_DATA_KEYS[`relief${s}`]].value = slot.set.relief.texture;
    U[GEN_NEAR_DATA_KEYS[`mask${s}`]].value = slot.set.mask.texture;
    if (!w) { U[`uGn${s}T`].value.set(1, 0, 0, 0); continue; }
    U[`uGn${s}X`].value.fromArray(w.axes.x);
    U[`uGn${s}Y`].value.fromArray(w.axes.y);
    U[`uGn${s}Z`].value.fromArray(w.axes.z);
    U[`uGn${s}W`].value.set(w.a0, w.b0, 1 / (patches.width * w.st), 1 / (patches.height * w.st));
    U[`uGn${s}T`].value.set(w.st, slot.mix, 0, 0);
  }
}

/** Uniformy chmur z bliska: chmury generatora (planetCloudUniforms) + wycinki (puste) + światło z grubości. */
export function nearCloudUniforms(spec, maps, U) {
  const CU = planetCloudUniforms(spec, maps, U);
  const W = maps.clouds?.image?.width || 2048;
  const slot = (s) => ({
    [`uGc${s}X`]: { value: new THREE.Vector3(1, 0, 0) }, [`uGc${s}Y`]: { value: new THREE.Vector3(0, 1, 0) },
    [`uGc${s}Z`]: { value: new THREE.Vector3(0, 0, 1) },
    [`uGc${s}W`]: { value: new THREE.Vector4(0, 0, 1, 1) }, [`uGc${s}T`]: { value: new THREE.Vector4(1, 0, 0, 0) }
  });
  const deck = spec.clouds?.style === 1;
  Object.assign(CU, slot('A'), slot('B'), {
    // kąt teksela mapy chmur planety, wysokość chmur [R], siła cienia własnego, jasność krawędzi od słońca
    uGcNear: { value: new THREE.Vector4(2 * Math.PI / W, 0.0035, deck ? 1.6 : 3.2, deck ? 0.25 : 0.55) },
    [GEN_CLOUD_NEAR_DATA_KEYS.A]: { value: null }, [GEN_CLOUD_NEAR_DATA_KEYS.B]: { value: null }
  });
  return CU;
}

/** Przepisuje stan wycinków chmur do uniformów materiału chmur z bliska. */
export function bindCloudPatches(CU, patches) {
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 'A' : 'B';
    const slot = patches.slots[i];
    const w = slot.win;
    CU[GEN_CLOUD_NEAR_DATA_KEYS[s]].value = slot.set.clouds.texture;
    if (!w) { CU[`uGc${s}T`].value.set(1, 0, 0, 0); continue; }
    CU[`uGc${s}X`].value.fromArray(w.axes.x);
    CU[`uGc${s}Y`].value.fromArray(w.axes.y);
    CU[`uGc${s}Z`].value.fromArray(w.axes.z);
    CU[`uGc${s}W`].value.set(w.a0, w.b0, 1 / (patches.width * w.st), 1 / (patches.height * w.st));
    CU[`uGc${s}T`].value.set(w.st, slot.mix, 0, 0);
  }
}

/** Wygląd pióropusza wg stylu planety. */
export function plumeLookFor(spec) {
  const style = spec.look?.style;
  if (style === 'siarka') return { ash: [0.5, 0.46, 0.33], H: 0.034, Rc: 0.0052, Ru: 0.05, th: 0.0042, sigma: 420 };
  if (style === 'lawa') return { ash: [0.15, 0.125, 0.115], H: 0.026, Rc: 0.0058, Ru: 0.034, th: 0.0046, sigma: 620 };
  return { ash: [0.21, 0.19, 0.175], H: 0.03, Rc: 0.006, Ru: 0.04, th: 0.0048, sigma: 560 };
}

/**
 * Ciało planety z bliska (demo; w grze — DirectPlanet z tymi samymi uniformami). Kula promienia 1, biegun N = +Y.
 * `baked` — wynik `bakeSystem(…, { mask: true })`. Wynik: { group, mesh, clouds, atm, plume (siatka), uniforms,
 * patches, eruption, setSun(dir), setView(dirScene), updatePatches(dirsObject, dt), erupt(dirObject) / stopEruption(),
 * step(dt, { spin }), dispose() }.
 */
export function createGenNearBody(spec, baked, baker, { segments = 384, halo = true, lava = 0, patch = {} } = {}) {
  const group = new THREE.Group();
  const maps = baked.maps;
  const U = nearSurfaceUniforms(spec, maps, { lava });
  const geo = new THREE.SphereGeometry(1, segments, Math.round(segments / 2));
  const material = createGenNearSurfaceMaterial(U);
  const mesh = new THREE.Mesh(geo, material);
  group.add(mesh);
  let clouds = null;
  let cloudUniforms = null;
  let cloudPatches = null;
  if (maps.clouds) {
    cloudUniforms = nearCloudUniforms(spec, maps, U);
    clouds = new THREE.Mesh(new THREE.SphereGeometry(1.005, 256, 128), createGenCloudNearMaterial(cloudUniforms));
    mesh.add(clouds);
    // chmury są miękkie — okno o połowę mniejsze niż wycinek powierzchni i najwyżej poziom 5
    cloudPatches = new PlanetGenPatches(baker, baked, { ...patch, kind: 'clouds', maxLevel: 5 });
    bindCloudPatches(cloudUniforms, cloudPatches);
  }
  // powłoki liczone po promieniu widzenia: siatki = kule jednostkowe (promień daje graf), bez odcinania kadrem
  const shells = [];
  const shell = (parent, mat, order) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), mat);
    m.frustumCulled = false;
    m.renderOrder = order;
    parent.add(m);
    shells.push(m);
    return m;
  };
  // chmury jako bryła (zamiast płaskiej maski — `setCloudMode`); obracają się jak warstwa chmur
  let cloudVol = null;
  if (maps.clouds) {
    cloudVol = shell(mesh, createGenCloudVolumeMaterial(cloudVolumeUniforms(spec, maps)), 5);
    cloudVol.visible = false;
  }
  // atmosfera: rozpraszanie po promieniu (krawędź tarczy, mgiełka pod kątem, czerwień terminatora)
  let atm = null;
  if (halo && (spec.halo.coef > 0.2 || spec.haze.strength > 0.05)) atm = shell(group, createGenAtmosphereMaterial(atmosphereUniforms(spec)), 6);
  // zorza: planety z powietrzem i wodą albo lodem (pole magnetyczne — oś z ziarna)
  let aurora = null;
  if (halo && (spec.type === 'terran' || spec.type === 'ocean' || spec.type === 'ice')) {
    const rg = rngFor(spec.seed, `${spec.type}:zorza`);
    aurora = shell(mesh, createGenAuroraMaterial(auroraUniforms(spec, [rg.next(), rg.next()])), 7);
  }
  let cloudMode = clouds ? 'flat' : 'off';
  // barwa mgiełki grafu gry (rozpraszanie nad tarczą): przy włączonej powłoce atmosfery część rozpraszania liczy
  // powłoka — graf gry dostaje barwę mgiełki × HAZE_WITH_SHELL (pełna barwa + powłoka = mgiełka policzona dwa razy,
  // wyblakły ląd; zero = granatowe, ciemne morze bez „powietrza” nad tarczą)
  const hazeBase = U.uHazeColor.value.clone();
  const HAZE_WITH_SHELL = 0.6;
  const patches = new PlanetGenPatches(baker, baked, patch);
  bindPatches(U, patches);

  // ── pióropusz: kula jednostkowa w układzie planety (środek i promień daje graf), dziecko kuli planety ──
  const PL = plumeLookFor(spec);
  const plumeU = {};
  for (const k of Object.keys(plumeUniforms())) plumeU[k] = U[k];     // te same obiekty co w materiale powierzchni
  U.uPlShape.value.set(PL.H, PL.Rc, PL.Ru, PL.th);
  // kula otaczająca: kolumna (środek na 0,55 H) i parasol ze znosem
  U.uPlAsh.value.set(PL.ash[0], PL.ash[1], PL.ash[2], 1.08 * Math.hypot(0.6 * PL.H, 1.5 * PL.Ru + PL.Rc));
  U.uPlGlowCol.value.copy(U.uGnLavaCol.value).multiply(new THREE.Vector3(1.0, 0.5, 0.17));
  const plume = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), createPlumeMaterial(plumeU));
  plume.frustumCulled = false;
  plume.renderOrder = 10;
  plume.visible = false;
  mesh.add(plume);

  const eruption = { on: false, t: 0, off: -1, dir: new THREE.Vector3(1, 0, 0), wind: new THREE.Vector3(0, 0, 1), flashAt: 0, flashT: 9, rng: 1 };
  // losowanie wyładowań: własny ciąg (obraz — nie Math.random, zasada żelazna 9)
  const rnd = () => { eruption.rng = (Math.imul(eruption.rng, 1664525) + 1013904223) >>> 0; return eruption.rng / 4294967296; };
  const _sun = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const ease = (x) => { const c = Math.min(1, Math.max(0, x)); return 1 - (1 - c) * (1 - c) * (1 - c); };
  return {
    spec, group, mesh, clouds, cloudVol, atm, aurora, plume, uniforms: U, cloudUniforms, patches, cloudPatches, eruption,
    /** Kierunek słońca w układzie sceny. */
    setSun(dir, intensity = spec.surface.sunInt) {
      _sun.copy(dir).normalize();
      U.sunPosition.value.copy(_sun).multiplyScalar(1e4).add(group.position);
      // ku słońcu w układzie planety (bryła pióropusza) i w układach powłok
      _v.copy(_sun).applyQuaternion(_q.copy(mesh.quaternion).invert());
      U.uPlSun.value.set(_v.x, _v.y, _v.z, intensity);
      for (const s of shells) {
        s.updateWorldMatrix(true, false);
        _d.copy(_sun).transformDirection(_m.copy(s.matrixWorld).invert());
        s.material.uniforms.uShSun.value.set(_d.x, _d.y, _d.z, intensity);
      }
    },
    /**
     * Kamera (three: ortho albo perspektywiczna) — promień widzenia dla brył liczonych marszem (pióropusz, chmury,
     * atmosfera, zorza): pozycja i kierunek w układzie każdej siatki. Wołać co klatkę po ustawieniu kamery i obrotów.
     */
    setCamera(camera) {
      camera.updateMatrixWorld();
      const ortho = camera.isOrthographicCamera === true;
      mesh.updateWorldMatrix(true, false);
      _m.copy(mesh.matrixWorld).invert();
      camera.getWorldDirection(_d).transformDirection(_m);
      U.uPlView.value.set(_d.x, _d.y, _d.z, 1);
      _p.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_m);
      U.uPlCam.value.set(_p.x, _p.y, _p.z, ortho ? 0 : 1);
      for (const s of shells) {
        s.updateWorldMatrix(true, false);
        _m.copy(s.matrixWorld).invert();
        camera.getWorldDirection(_d).transformDirection(_m);
        _p.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_m);
        const u = s.material.uniforms;
        u.uShCam.value.set(_p.x, _p.y, _p.z, ortho ? 1 : 0);
        u.uShDir.value.copy(_d);
      }
    },
    /** Chmury: 'volume' — bryła (marsz promienia), 'flat' — maska na kuli z cieniem własnym, 'off'. */
    setCloudMode(mode) {
      cloudMode = clouds ? mode : 'off';
      if (clouds) clouds.visible = cloudMode === 'flat';
      if (cloudVol) cloudVol.visible = cloudMode === 'volume';
      // wysokość chmur dla cienia na gruncie: środek powłoki bryły albo płaska warstwa
      U.uGnCloud.value.y = cloudMode === 'volume' ? 0.0095 : 0.0035;
      U.uGnCloud.value.w = cloudMode === 'volume' ? 1 : 0;
      if (cloudVol) {
        // te same liczby co bryła: cień na gruncie liczy jej kłęby (planetGenSurfaceNear.tsl.js)
        const cs = cloudVol.material.uniforms.uCvShape.value;
        U.uGnCloudVol.value.set(cs.x - 1, cs.y - 1, cs.w, cloudVol.material.uniforms.uCvNoise.value.x);
      }
    },
    get cloudMode() { return cloudMode; },
    /** Powłoka atmosfery włączona / wyłączona (wyłączona: mgiełkę nad tarczą liczy sam graf gry, bez krawędzi). */
    setAtmosphere(on) {
      if (!atm) return;
      atm.visible = !!on;
      U.uHazeColor.value.copy(hazeBase).multiplyScalar(on ? HAZE_WITH_SHELL : 1.0);
    },
    /** Wycinki: `dirs` — kierunki planety (układ obiektu) widoczne w kadrze. Zwraca true przy wypieku w tej klatce. */
    updatePatches(dirs, dt, force = false) {
      let baked2 = patches.update(dirs, dt, force);
      bindPatches(U, patches);
      if (cloudPatches) {
        // te same kierunki w układzie kuli chmur (obrót wokół osi Y względem gruntu)
        const on = clouds.visible && patches.enabled;
        cloudPatches.enabled = on;
        const c = Math.cos(clouds.rotation.y);
        const s = Math.sin(clouds.rotation.y);
        const cd = on ? dirs.map((d) => [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c]) : [];
        baked2 = cloudPatches.update(cd, dt, force) || baked2;
        bindCloudPatches(cloudUniforms, cloudPatches);
        U.uGnCloud.value.x = clouds.rotation.y;
        U.uGnCloud.value.z = cloudMode !== 'off' ? Math.min(0.85, spec.clouds.opacity * 1.05) : 0;
      }
      return baked2;
    },
    /** Erupcja w kierunku `dir` (układ obiektu planety, jednostkowy); wiatr styczny z ziarna kierunku. */
    erupt(dir) {
      eruption.dir.copy(dir).normalize();
      // wiatr: na wschód (obrót planety) z lekkim skrętem
      eruption.wind.set(0, 1, 0).cross(eruption.dir);
      if (eruption.wind.lengthSq() < 1e-6) eruption.wind.set(1, 0, 0);
      eruption.wind.normalize().addScaledVector(_v.copy(eruption.dir).cross(eruption.wind), 0.35).normalize();
      eruption.on = true;
      eruption.t = 0;
      eruption.off = -1;
      plume.visible = true;
    },
    stopEruption() { if (eruption.on && eruption.off < 0) eruption.off = eruption.t; },
    /** Krok czasu (doba, chmury, lawa, erupcja): dt [s]. */
    step(dt, { spin = 0, cloudSpin = 0, lavaRate = 1 } = {}) {
      U.uGsMisc.value.x = (U.uGsMisc.value.x + dt) % 4096;
      U.uGnLava.value.y = (U.uGnLava.value.y + dt * lavaRate) % 4096;
      mesh.rotation.y += spin * dt;
      if (clouds) clouds.rotation.y += cloudSpin * dt;
      if (cloudVol) {
        cloudVol.rotation.y = clouds.rotation.y;
        const cu = cloudVol.material.uniforms.uCvNoise.value;
        cu.w = (cu.w + dt) % 4096;
        U.uGnCloudVol2.value.x = cu.w;
      }
      if (aurora) aurora.material.uniforms.uAuTime.value.x = (aurora.material.uniforms.uAuTime.value.x + dt) % 4096;
      if (eruption.on) {
        eruption.t += dt;
        const t = eruption.t;
        const dying = eruption.off >= 0 ? Math.max(0, 1 - (t - eruption.off) / 14) : 1;
        const g = ease(t / 7);
        const gu = ease((t - 4.5) / 22);
        // fontanna: szybki zapłon, potem pulsowanie
        const glow = Math.min(1, t / 1.2) * (0.82 + 0.18 * Math.sin(t * 5.3) * Math.sin(t * 1.7)) * (eruption.off >= 0 ? Math.max(0, 1 - (t - eruption.off) / 5) : 1);
        U.uPlVent.value.set(eruption.dir.x, eruption.dir.y, eruption.dir.z, glow);
        U.uPlState.value.set(t, g, gu, PL.sigma * dying * dying);
        const drift = PL.Ru * (0.25 + 0.55 * gu) + (eruption.off >= 0 ? (t - eruption.off) * 0.0012 : 0);
        U.uPlWind.value.set(eruption.wind.x, eruption.wind.y, eruption.wind.z, drift);
        // wyładowania w parasolu: co 0,6–3 s, 2–3 szybkie błyski w ~0,2 s, miejsce losowe w parasolu
        eruption.flashT += dt;
        if (gu > 0.15 && dying > 0.5 && t >= eruption.flashAt) {
          eruption.flashAt = t + 0.6 + rnd() * 2.4;
          eruption.flashT = 0;
          const ang = rnd() * Math.PI * 2;
          const rr = Math.sqrt(rnd()) * PL.Ru * gu * 0.75;
          _v.copy(eruption.dir).cross(eruption.wind).normalize();
          U.uPlFlash.value.set(0, 0, 0, 0);
          const px = eruption.dir.clone().multiplyScalar(1 + PL.H * 0.84)
            .addScaledVector(eruption.wind, drift * 0.75 + Math.cos(ang) * rr).addScaledVector(_v, Math.sin(ang) * rr);
          U.uPlFlash.value.set(px.x, px.y, px.z, 0);
        }
        const ft = eruption.flashT;
        U.uPlFlash.value.w = ft < 0.24 ? Math.max(0, Math.sin(ft * 52) * 0.6 + 0.5) * (1 - ft / 0.24) * 2.2 : 0;
        if (dying <= 0) {
          eruption.on = false;
          plume.visible = false;
          U.uPlState.value.set(0, 0, 0, 0);
          U.uPlVent.value.w = 0;
          U.uPlFlash.value.w = 0;
        }
      }
    },
    dispose() {
      geo.dispose();
      material.dispose();
      if (clouds) { clouds.geometry.dispose(); clouds.material.dispose(); }
      for (const s of shells) { s.geometry.dispose(); s.material.dispose(); }
      plume.geometry.dispose();
      plume.material.dispose();
      patches.dispose();
      if (cloudPatches) cloudPatches.dispose();
    }
  };
}
