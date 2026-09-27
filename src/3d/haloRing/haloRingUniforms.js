// Wspólne uniformy ringu. Wszystkie materiały trzymają REFERENCJE do tych
// samych obiektów { value }, więc jedna aktualizacja na klatkę obsługuje
// teren, chmury, konstrukcję i powłokę powietrza.
//
// Port WebGPU (zadanie 06): wszystkie uniformy ringu leżą w JEDNYM bloku
// (createUniformBlock — jeden bufor uniformów zamiast ~12: WebGPU daje najwyżej
// 12 buforów na etap, a każda tablica uniformów to osobny bufor). Adapter
// zostawia klucze i kod aktualizacji (`u.uX.value = …`, `u.uV.value.set(...)`,
// `u.uArr.value[i].set(...)`) bez zmian; `.node` wpisu to węzeł TSL (element
// bloku), biblioteka TSL (haloRingTSL.js) bierze go przez nodeOf().
import * as THREE from 'three';
import { createUniformBlock } from './haloUniformsAdapter.js';
import { HALO_ATMOSPHERE, HALO_LIGHT, HALO_ROOF, HALO_TRANSIT, haloPortTemplate, haloTransitAngles } from './haloRingConfig.js';
import {
  HALO_MEGA_PALETTE_SIZE,
  HALO_STRUCTURE_PALETTE_KEYS,
  HALO_TERRAIN_PALETTE_KEYS,
  resolveHaloProfile
} from './haloRingProfiles.js';

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function linearColor(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return new THREE.Vector3(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

// Miejsca na podłodze jako szablon jednego okresu (haloPortTemplate): kafel
// (s środka kompleksu 0, okres, liczba) + 5 slotów prostokątów (przesunięcie od środka
// kompleksu, pół-rozpiętość s, t0, t1) i ich strefy (zasięg przemysłu, osad, osłona nad płytą).
// Zajęte 4 (K-7, 2 zatoki, tranzyt); pusty slot ma pół-rozpiętość 0 i shader go pomija.
// Tylko habitat na zewnątrz z płaszczyzną gry na podłodze (flightLevel liczbowy).
export const HALO_PORT_RECTS = 5;
export function portSitesActive(layout) {
  return layout.sigma > 0 && layout.flightLevel !== 'roof';
}
export function haloPortTileUniforms(layout, out = null) {
  const o = out || {
    tile: new THREE.Vector4(),
    rects: Array.from({ length: HALO_PORT_RECTS }, () => new THREE.Vector4()),
    zones: Array.from({ length: HALO_PORT_RECTS }, () => new THREE.Vector4())
  };
  o.tile.set(0, 1, 0, 0);
  for (const v of o.rects) v.set(0, 0, 1, 0);
  for (const v of o.zones) v.set(0, 0, 0, 0);
  if (!portSitesActive(layout)) return o;
  const fm = layout.radii.floorMid;
  const tz = layout.floor.tangent.z;
  const tAt = (z) => (z - layout.z.botIn) / tz;
  const tpl = haloPortTemplate(fm);
  o.tile.set(tpl.theta0 * fm, tpl.period, tpl.count, 0);
  tpl.rects.slice(0, HALO_PORT_RECTS).forEach((r, i) => {
    o.rects[i].set(r.ds, r.halfS, tAt(r.zMin) - 150, tAt(r.zMax) + 250);
    // w = 1: osłona nad płytą (teren niski od płyty do górnej ściany)
    o.zones[i].set(r.zoneInd || 0, r.zoneRes || 0, 0, 1);
  });
  return o;
}
// Tranzyty: (kąt pierwszej osi, krok, liczba, pół-szerokość wycięcia) i z wycięcia.
export function haloTransitUniforms(layout, outA = new THREE.Vector4(), outZ = new THREE.Vector4()) {
  const T = HALO_TRANSIT;
  if (!portSitesActive(layout)) {
    outA.set(0, 1, 0, 0);
    outZ.set(0, 0, 0, 0);
    return { transit: outA, transitZ: outZ };
  }
  outA.set(haloTransitAngles()[0], Math.PI * 2 / T.count, T.count, T.halfWidth + T.wall);
  outZ.set(T.cutZ[0], T.cutZ[1], 0, 0);
  return { transit: outA, transitZ: outZ };
}

const v4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const v4Array = (n, make = () => new THREE.Vector4()) => ({ array: Array.from({ length: n }, make) });
const v3Array = (n) => ({ array: Array.from({ length: n }, () => new THREE.Vector3()) });
const num = (x) => Number(x) || 0;   // float bloku
// blok TSL ringu (węzeł uniformArray) — dla materiałów i testów; poza kluczami
export const HALO_UNIFORM_BLOCK = Symbol('haloUniformBlock');

export function createHaloUniforms(layout) {
  const block = createUniformBlock({
    uTime: num(0),
    // geometria (lokalny układ ringu, oś = Z)
    uRing: v4(),       // rim, floorMid, hull, dr/dz podłogi
    uRingZ: v4(),      // roof, topIn, botIn, bottom
    uFloorLine: v4(),  // r(t=0), z(t=0), tangent.r, tangent.z
    uFloorDims: v4(),  // L (obwód na floorMid), Wf, floorMid, wallHeight
    uPlanet: v4(),     // środek xyz, promień
    uHabitat: v4(1, 0, 0, 0), // σ, promień kadłuba, bryła r min, r max
    uPlanetAtmoH: num(HALO_LIGHT.planetAtmosphereHeight),
    // słońce ringu (kierunek w układzie lokalnym ringu)
    uSunDir: new THREE.Vector3(0.6, 0, 0.75).normalize(),
    uSunColor: new THREE.Vector3(...HALO_LIGHT.sunColor).multiplyScalar(HALO_LIGHT.sunIntensity),
    uSunAngular: num(HALO_LIGHT.sunAngularRadius),
    uPlanetshine: v4(...HALO_LIGHT.planetshineColor, HALO_LIGHT.planetshineGain),
    uPlanetAlbedo: num(HALO_LIGHT.planetAlbedo),
    uSkyAmbient: num(HALO_LIGHT.skyAmbient),
    uNightAmbient: num(HALO_LIGHT.nightAmbient),
    // powietrze habitatu
    uAirRayleigh: v3(...HALO_ATMOSPHERE.rayleigh),
    uAirMie: v3(HALO_ATMOSPHERE.mie, HALO_ATMOSPHERE.mieG, HALO_ATMOSPHERE.multiScatter),
    uAirScaleH: num(HALO_ATMOSPHERE.scaleHeight),
    uSkyBoost: num(HALO_ATMOSPHERE.skyBoost),
    uAirOn: num(1),
    // kamera (lokalny układ ringu): pozycja do oświetlenia + punkt odniesienia RTE
    uCamLocal: v3(),
    uRefRel: v3(),     // P_ref − C (liczone w double na CPU)
    uRefBasis: v4(1, 0, 0, 0), // cos θ_ref, sin θ_ref, θ_ref, s_ref
    // warstwy
    uLayers: v4(1, 1, 1, 1),   // chmury, światła miast, statki, drzewa
    uCloudParams: v4(820, 520, 6.0, 0.05), // wysokość, grubość, wiatr (j./s), więcej chmur (+)
    uNightLights: num(1),
    uDetailScale: num(1),   // z HALO_QUALITY[q].lod.detailScale (ultra > 1)
    // dach (M3) — ustawia applyRoofPlanUniforms po zbudowaniu planu
    uRoofLanes0: v4(),   // koniec kratownicy krawędzi, rząd A od-do, rząd B od
    uRoofLanes1: v4(),   // rząd B do, kolej od-do, kratownica kadłuba od
    uRoofLanes2: v4(),   // przemysł od, komórek w poprzek, szerokość dachu, komórka w poprzek
    uRoofCells: v4(),    // komórka wzdłuż, działka wzdłuż, komórek na obwód, komórek na działkę
    uRoofSector: v4(),   // komórka startu sektora 0, komórek na sektor, sektorów, —
    uSectorClass: { array: new Array(32).fill(0), type: 'float' }, // 0 krajobraz, 1 miasto, 2 przemysł, 3 port
    uPortDocks: v4(),    // kąt doku 0, krok, liczba, pół-rozpiętość [rad]
    uPortTile: v4(),
    uPortRects: v4Array(HALO_PORT_RECTS),
    uPortZones: v4Array(HALO_PORT_RECTS),
    uTransit: v4(0, 1, 0, 0),
    uTransitZ: v4(),
    // górna połowa wstęgi w FG (HALO_FG): x widoczność od powiększenia,
    // y = 1 kamera gry (wycięcia liczone w rzucie na z = 0), z, w —
    uFgFade: v4(1, 0, 1e6, 0),
    // wycięcia nad graczem: A = (środek x, y, oś cos, sin), B = (pół a, pół b, miękkość, siła)
    uCutA: v4Array(2),
    uCutB: v4Array(2, () => new THREE.Vector4(0, 0, 1, 0)),
    // ---- profil planety (haloRingProfiles.js): wartości, nie źródła shaderów —
    // trzy ringi dzielą funkcje biblioteki TSL (haloRingTSL.js)
    uSkyTint: v3(),       // barwa światła nieba habitatu
    uPlanetNight: v3(),   // nocna strona planety w jej świetle
    uAirMieTint: v3(1, 1, 1),
    uCloudTint: v3(),
    uHdrWarm: v3(),
    uHdrSodium: v3(),
    uHdrCool: v3(),
    uHdrStrip: v3(),
    uTerPal: v3Array(HALO_TERRAIN_PALETTE_KEYS.length),
    uStructPal: v3Array(HALO_STRUCTURE_PALETTE_KEYS.length),
    uMegaPal: v3Array(HALO_MEGA_PALETTE_SIZE),
    uMegaSky: v3Array(2),
    uDomeTint: v3(1, 1, 1),
    uLeafTint: v3(1, 1, 1),
    uIndTopTint: v3(1, 1, 1),
    uProfFrag: v4(),      // siarka (Io), linie na lodzie (Europa), —, —
    uStorm: v4(),         // siła, błysków/s na komórkę, komórka [j.], jasność HDR
    uRoofOcc: v4(),       // reguły dachu (lustro haloRingRoofPlan.js)
    uRoofKinds: v4(),
    uRoofPlotEmpty: v4(),
    uIndKitCdf0: v4(),    // progi zakładów działki (haloRingIndustryKit.js)
    uIndKitCdf1: v4()
  }, 'haloRingU');
  const u = block.uniforms;
  Object.defineProperty(u, HALO_UNIFORM_BLOCK, { value: block, enumerable: false });
  applyLayoutToUniforms(u, layout);
  return u;
}

const setV3 = (v, a) => v.set(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0);

// Profil planety → uniformy (także przy przebudowie ringu z innym profilem).
export function applyProfileUniforms(u, profileKey, facing = 'outward') {
  const p = resolveHaloProfile(profileKey);
  const L = p.light;
  const A = p.air;
  u.uSunColor.value.set(...L.sunColor).multiplyScalar(L.sunIntensity);
  u.uPlanetshine.value.set(...L.planetshineColor, L.planetshineGain);
  u.uPlanetAlbedo.value = L.planetAlbedo;
  u.uPlanetAtmoH.value = L.planetAtmosphereHeight;
  u.uSkyAmbient.value = L.skyAmbient;
  u.uNightAmbient.value = L.nightAmbient;
  setV3(u.uPlanetNight.value, L.planetNight);
  u.uAirRayleigh.value.set(...A.rayleigh);
  u.uAirMie.value.set(A.mie, A.mieG, A.multiScatter);
  u.uAirScaleH.value = A.scaleHeight;
  u.uSkyBoost.value = A.skyBoost;
  setV3(u.uAirMieTint.value, A.mieTint);
  u.uCloudParams.value.w = A.cloudCoverBias[facing] ?? 0;
  setV3(u.uSkyTint.value, p.sky.tint);
  setV3(u.uCloudTint.value, p.sky.cloudTint);
  setV3(u.uHdrWarm.value, p.hdr.windowWarm);
  setV3(u.uHdrSodium.value, p.hdr.windowSodium);
  setV3(u.uHdrCool.value, p.hdr.windowCool);
  setV3(u.uHdrStrip.value, p.hdr.strip);
  HALO_TERRAIN_PALETTE_KEYS.forEach((k, i) => setV3(u.uTerPal.value[i], p.terrainPalette[k]));
  HALO_STRUCTURE_PALETTE_KEYS.forEach((k, i) => setV3(u.uStructPal.value[i], p.structurePalette[k]));
  u.uMegaPal.value.forEach((v, i) => setV3(v, p.megaPalette[i] || p.megaPalette[p.megaPalette.length - 1]));
  setV3(u.uMegaSky.value[0], p.megaSky[0]);
  setV3(u.uMegaSky.value[1], p.megaSky[1]);
  setV3(u.uDomeTint.value, p.domeTint);
  setV3(u.uLeafTint.value, p.leafTint);
  setV3(u.uIndTopTint.value, p.indTopTint);
  u.uProfFrag.value.set(p.frag.sulfur || 0, p.frag.lineae || 0, 0, 0);
  u.uStorm.value.set(p.storm.strength, p.storm.rate, p.storm.cell, p.storm.brightness);
  u.uRoofOcc.value.set(...p.roofRules.occupancy);
  u.uRoofKinds.value.set(...p.roofRules.kinds);
  u.uRoofPlotEmpty.value.set(...p.roofRules.plotEmpty);
  const cdf = p.industryKit.cdf;
  u.uIndKitCdf0.value.set(cdf[0], cdf[1], cdf[2], cdf[3]);
  u.uIndKitCdf1.value.set(cdf[4], cdf[5], cdf[6], cdf[7]);
}

export function applyLayoutToUniforms(u, layout) {
  const r = layout.radii;
  const z = layout.z;
  u.uRing.value.set(r.rim, r.floorMid, r.hull, layout.floor.slope);
  u.uRingZ.value.set(z.roof, z.topIn, z.botIn, z.bottom);
  u.uFloorLine.value.set(r.floorBottom, z.botIn, layout.floor.tangent.r, layout.floor.tangent.z);
  u.uFloorDims.value.set(layout.circumference, layout.floor.length, r.floorMid, layout.wallHeight);
  u.uPlanet.value.set(0, 0, layout.planetCenterZ, layout.planetRadius);
  if (u.uPortTile) haloPortTileUniforms(layout, { tile: u.uPortTile.value, rects: u.uPortRects.value, zones: u.uPortZones.value });
  if (u.uTransit) haloTransitUniforms(layout, u.uTransit.value, u.uTransitZ.value);
  u.uHabitat.value.set(layout.sigma, r.back, r.min, r.max);
  u.uCloudParams.value.w = HALO_ATMOSPHERE.cloudCoverBias[layout.facing] ?? 0;
  if (u.uTerPal) applyProfileUniforms(u, layout.planetProfile, layout.facing);
}

export function applyRoofPlanUniforms(u, plan) {
  const l = plan.lanes;
  u.uRoofLanes0.value.set(l.rimEnd, l.rowA[0], l.rowA[1], l.rowB[0]);
  u.uRoofLanes1.value.set(l.rowB[1], l.maglev[0], l.maglev[1], l.hull0);
  u.uRoofLanes2.value.set(l.industrial[0], l.crossCells, l.width, HALO_ROOF.crossCell);
  u.uRoofCells.value.set(plan.cellS, plan.lotS, plan.totalCells, HALO_ROOF.cellsPerSegment / HALO_ROOF.lotsPerSegment);
  u.uRoofSector.value.set(plan.cell0, plan.cellsPerSector, plan.classes.length, 0);
  const arr = u.uSectorClass.value;
  for (let i = 0; i < arr.length; i++) arr[i] = i < plan.classes.length ? plan.classes[i] : 0;
  // Doki wpięte w podłogę (2026-09-23) nie dotykają dachu: rząd działek przy
  // krawędzi zostaje wszędzie (dawniej ustępował chwytakom doków).
  u.uPortDocks.value.set(0, 0, 0, 0);
}
