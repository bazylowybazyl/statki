// Wspólne uniformy ringu. Wszystkie materiały trzymają REFERENCJE do tych
// samych obiektów { value }, więc jedna aktualizacja na klatkę obsługuje
// teren, chmury, konstrukcję i powłokę powietrza.
import * as THREE from 'three';
import { HALO_ATMOSPHERE, HALO_LIGHT, HALO_ROOF, HALO_TRANSIT, haloPortTemplate, haloTransitAngles } from './haloRingConfig.js';

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

export function createHaloUniforms(layout) {
  const u = {
    uTime: { value: 0 },
    // geometria (lokalny układ ringu, oś = Z)
    uRing: { value: new THREE.Vector4() },       // rim, floorMid, hull, dr/dz podłogi
    uRingZ: { value: new THREE.Vector4() },      // roof, topIn, botIn, bottom
    uFloorLine: { value: new THREE.Vector4() },  // r(t=0), z(t=0), tangent.r, tangent.z
    uFloorDims: { value: new THREE.Vector4() },  // L (obwód na floorMid), Wf, floorMid, wallHeight
    uPlanet: { value: new THREE.Vector4() },     // środek xyz, promień
    uHabitat: { value: new THREE.Vector4(1, 0, 0, 0) }, // σ, promień kadłuba, bryła r min, r max
    uPlanetAtmoH: { value: HALO_LIGHT.planetAtmosphereHeight },
    // słońce ringu (kierunek w układzie lokalnym ringu)
    uSunDir: { value: new THREE.Vector3(0.6, 0, 0.75).normalize() },
    uSunColor: { value: new THREE.Vector3(...HALO_LIGHT.sunColor).multiplyScalar(HALO_LIGHT.sunIntensity) },
    uSunAngular: { value: HALO_LIGHT.sunAngularRadius },
    uPlanetshine: { value: new THREE.Vector4(...HALO_LIGHT.planetshineColor, HALO_LIGHT.planetshineGain) },
    uPlanetAlbedo: { value: HALO_LIGHT.planetAlbedo },
    uSkyAmbient: { value: HALO_LIGHT.skyAmbient },
    uNightAmbient: { value: HALO_LIGHT.nightAmbient },
    // powietrze habitatu
    uAirRayleigh: { value: new THREE.Vector3(...HALO_ATMOSPHERE.rayleigh) },
    uAirMie: { value: new THREE.Vector3(HALO_ATMOSPHERE.mie, HALO_ATMOSPHERE.mieG, HALO_ATMOSPHERE.multiScatter) },
    uAirScaleH: { value: HALO_ATMOSPHERE.scaleHeight },
    uSkyBoost: { value: HALO_ATMOSPHERE.skyBoost },
    uAirOn: { value: 1 },
    // kamera (lokalny układ ringu): pozycja do oświetlenia + punkt odniesienia RTE
    uCamLocal: { value: new THREE.Vector3() },
    uRefRel: { value: new THREE.Vector3() },     // P_ref − C (liczone w double na CPU)
    uRefBasis: { value: new THREE.Vector4(1, 0, 0, 0) }, // cos θ_ref, sin θ_ref, θ_ref, s_ref
    // warstwy
    uLayers: { value: new THREE.Vector4(1, 1, 1, 1) },   // chmury, światła miast, statki, drzewa
    uCloudParams: { value: new THREE.Vector4(820, 520, 6.0, 0.05) }, // wysokość, grubość, wiatr (j./s), więcej chmur (+)
    uNightLights: { value: 1 },
    uDetailScale: { value: 1 },   // z HALO_QUALITY[q].lod.detailScale (ultra > 1)
    // dach (M3) — ustawia applyRoofPlanUniforms po zbudowaniu planu
    uRoofLanes0: { value: new THREE.Vector4() },   // koniec kratownicy krawędzi, rząd A od-do, rząd B od
    uRoofLanes1: { value: new THREE.Vector4() },   // rząd B do, kolej od-do, kratownica kadłuba od
    uRoofLanes2: { value: new THREE.Vector4() },   // przemysł od, komórek w poprzek, szerokość dachu, komórka w poprzek
    uRoofCells: { value: new THREE.Vector4() },    // komórka wzdłuż, działka wzdłuż, komórek na obwód, komórek na działkę
    uRoofSector: { value: new THREE.Vector4() },   // komórka startu sektora 0, komórek na sektor, sektorów, —
    uSectorClass: { value: new Array(32).fill(0) }, // 0 krajobraz, 1 miasto, 2 przemysł, 3 port
    uPortDocks: { value: new THREE.Vector4() },    // kąt doku 0, krok, liczba, pół-rozpiętość [rad]
    uPortTile: { value: new THREE.Vector4() },
    uPortRects: { value: Array.from({ length: HALO_PORT_RECTS }, () => new THREE.Vector4()) },
    uPortZones: { value: Array.from({ length: HALO_PORT_RECTS }, () => new THREE.Vector4()) },
    uTransit: { value: new THREE.Vector4(0, 1, 0, 0) },
    uTransitZ: { value: new THREE.Vector4() },
    // górna połowa wstęgi w FG (HALO_FG): x widoczność od powiększenia,
    // y = 1 kamera gry (wycięcia liczone w rzucie na z = 0), z, w —
    uFgFade: { value: new THREE.Vector4(1, 0, 1e6, 0) },
    // wycięcia nad graczem: A = (środek x, y, oś cos, sin), B = (pół a, pół b, miękkość, siła)
    uCutA: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uCutB: { value: [new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 1, 0)] }
  };
  applyLayoutToUniforms(u, layout);
  return u;
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
