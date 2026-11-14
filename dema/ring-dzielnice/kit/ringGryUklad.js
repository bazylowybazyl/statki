// DZIELNICE RINGU — RING Z GRY w demie: dopasowanie (czysta matematyka, bez three i DOM).
//
// Demo dzielnic liczy w układzie łuku: s — długość wzdłuż ringu na promieniu R0 (s = 0 — oś wjazdu K-7 portu dema,
// +s w prawo na ekranie), v — odległość promieniowa od krawędzi ścian ringu. R0 = YARD_R0 = 43 752 = promień krawędzi
// ścian ringu Ziemi w grze (`createHaloRingLayout().radii.rim`). Ten moduł przekłada układ prawdziwego ringu Ziemi
// (kąty lokalne θ grupy ringu, three: x w prawo, y w górę, przed obrotem grupy) na s dema i odwrotnie, wybiera
// obrót grupy ringu (kompleks portu 0 — hala K-7 gracza — w osi wjazdu dema) i listuje stałe elementy ringu (hale K-7,
// zatoki, tranzyty), które wypadają pod łukiem dzielnic.
import { HALO_STATION_ANGLE, haloPortSites } from '../../../src/3d/haloRing/haloRingConfig.js';
import { haloRingLayoutFor } from '../../../src/game/haloRingPlanets.js';
import { YARD_R0 } from './uklad.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => a - TAU * Math.round(a / TAU);

/** Układ ringu Ziemi z gry (ten sam, który budują obraz i kolizje: promień planety i ziarno z profilu). */
export function earthRingLayout() {
  return haloRingLayoutFor({ id: 'earth', name: 'Earth' });
}

/**
 * Obrót grupy ringu (three, wokół +Z): kompleks 0 (w grze kąt stacji Ziemi, three −π/4) w osi wjazdu dema — prosto
 * w dół ekranu (three −π/2). W grze ring Ziemi ma obrót 0 (port na π/4 gry, w prawo w dół od planety).
 */
export const RING_ROT = -Math.PI / 2 - HALO_STATION_ANGLE;

/** Środek ringu w świecie gry dema: początek układu P0 leży na krawędzi ścian, środek R0 nad nim (−y gry). */
export function ringCenter(P0, R0 = YARD_R0) {
  return { x: P0.x, y: P0.y - R0 };
}

/** Kąt lokalny ringu θ (three, przed obrotem grupy) → s dema (łuk na promieniu R0 od osi wjazdu). */
export function thetaToS(theta, rot = RING_ROT, R0 = YARD_R0) {
  return wrapPi(theta + rot + Math.PI / 2) * R0;
}

/** s dema → kąt lokalny ringu θ w [0, 2π). */
export function sToTheta(s, rot = RING_ROT, R0 = YARD_R0) {
  const a = s / R0 - Math.PI / 2 - rot;
  return ((a % TAU) + TAU) % TAU;
}

/** Przekrój ringu Ziemi wobec przekroju dema (v = r − R0): krawędź ścian, podłoga, kadłub, ściany w z. */
export function ringFit(layout = earthRingLayout(), R0 = YARD_R0) {
  const r = layout.radii;
  return {
    R0,
    rim: r.rim,
    gap: R0 - r.rim,                 // > 0 — szpara między krawędzią ścian a rzędem przy ringu, < 0 — zachodzenie
    vFloor: r.floorMid - R0,         // podłoga habitatu (płaszczyzna gry przecina ją w połowie wstęgi)
    vBack: r.back - R0,              // spód kadłuba ringu (strona planety)
    wallHeight: layout.wallHeight,   // ściany od podłogi do krawędzi
    wallZ: [layout.z.topIn, layout.z.roof],   // górna ściana: lico od habitatu … dach (dolna — lustrzanie)
    width: layout.width,
    planetRadius: layout.planetRadius
  };
}

/**
 * Stałe elementy ringu Ziemi w s dema: hale K-7 i zatoki czterech kompleksów portu (co 90°) i cztery tranzyty
 * (w połowie między kompleksami). `s` — środek, `s0…s1` — zasięg na promieniu R0 (szerokość z układu gry na podłodze).
 */
export function ringPortElements(layout = earthRingLayout(), rot = RING_ROT, R0 = YARD_R0) {
  const fm = layout.radii.floorMid;
  const out = [];
  // haloPortSites: hale K-7 i zatoki czterech kompleksów, potem cztery portale tranzytów (complex −1)
  const KIND = { k7: 'hala K-7', dock: 'zatoka', transit: 'tranzyt' };
  for (const site of haloPortSites(fm)) {
    const s = thetaToS(site.theta, rot, R0);
    const half = (site.halfS / fm) * R0;
    const id = site.kind === 'k7' ? `K-7 #${site.complex}` : site.kind === 'dock' ? `zatoka Z-0${site.index + 1}` : `tranzyt T-0${site.index + 1}`;
    out.push({ kind: KIND[site.kind] || site.kind, complex: site.complex, id, theta: site.theta, s, s0: s - half, s1: s + half });
  }
  return out.sort((a, b) => a.s - b.s);
}

/** Kompleksy portu ringu (hala + jej zatoki), których którykolwiek element zachodzi na łuk [a, b] dema. */
export function complexesInArc(elements, a, b) {
  const set = new Set();
  for (const e of elements) if (e.complex >= 0 && e.s1 > a && e.s0 < b) set.add(e.complex);
  return set;
}

/** Element pod łukiem dzielnic: nazwa dzielnicy (parts: [{ id, sMin, sMax }]) albo null. */
export function partAtS(parts, s) {
  for (const p of parts) if (s >= p.sMin && s <= p.sMax) return p;
  return null;
}
