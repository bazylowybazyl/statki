// Doba Ziemi w grze: oś obrotu wzdłuż OSI RINGU „Halo” (prostopadła do płaszczyzny gry, ku kamerze). Decyzja
// użytkownika 2026-10-22 („winda ma być do ringu planetarnego”, wariant „Ziemia wokół osi ringu”): ring w układzie
// Ziemi jest równikowy i stoi względem gruntu, więc windy z brzegu gryzu i promień przekaźnikowy elektrowni „KOREK”
// łączą się z ringiem na stałe. Ring rozgrywki stoi (kolizje, hale K-7, tranzyty bez zmian); z Ziemią obraca się tylko
// wewnętrzna szyna ringu z wózkami wind (src/3d/earthBitePlant*.js). Kamera patrzy na biegun obrotu, tarcza obraca się
// jak koło — przeciwnie do wskazówek zegara, jak Ziemia znad bieguna północnego.
//
// Biegun obrotu = punkt powierzchni (poleLat, poleLon); prawdziwa geografia — biegun północny. Gryz (10° N) leży wtedy
// 10° nad płaszczyzną ringu: z kamery gry widać wcięcie w obrysie przy krawędzi tarczy, promień z niego, odbiornik
// i liny wind przez szczelinę do ringu; korek na dnie chowa się pod powierzchnią. Biegun bliżej gryzu (np. 70° N 15° E →
// gryz 30° nad ringiem) odsłania wnętrze z ukosa, ale dalsze kotwice wind (> ~35° nad ringiem) nie sięgają ringu bez
// przejścia liny przez planetę.
//
// Układ obiektu kuli (SphereGeometry, jak earthBiteShape.js): kierunek (lon, lat) = (cos lat cos lon, sin lat,
// −cos lat sin lon). Bez DOM i `window` (render w workerze), bez alokacji w `earthSpinQuaternion`.
import * as THREE from 'three/webgpu';

export const EARTH_SPIN = Object.freeze({
  poleLat: 90,    // biegun obrotu: szerokość [°]
  poleLon: 0,     // biegun obrotu: długość [°]
  rate: 0.02,     // doba [rad/s czasu klatki] (jak dawny obrót wokół osi Y sceny)
  cloudRate: 0.027
});

const DEG = Math.PI / 180;
const _Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

/** Oś obrotu (jednostkowa) w układzie obiektu kuli. */
export function earthSpinAxis(spin = EARTH_SPIN, out = new THREE.Vector3()) {
  const la = spin.poleLat * DEG, lo = spin.poleLon * DEG;
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).normalize();
}

/** Obrót bazowy: oś obrotu obiektu → +Z sceny (ku kamerze gry). */
export function earthSpinBase(spin = EARTH_SPIN, out = new THREE.Quaternion()) {
  return out.setFromUnitVectors(earthSpinAxis(spin), _Z);
}

/**
 * Orientacja kuli dla kąta doby: baza · obrót wokół osi obiektu. `axis` / `base` — z earthSpinAxis / earthSpinBase
 * (policzone raz), `out` — kwaternion siatki.
 */
export function earthSpinQuaternion(angle, axis, base, out) {
  return out.copy(base).multiply(_q.setFromAxisAngle(axis, angle));
}
