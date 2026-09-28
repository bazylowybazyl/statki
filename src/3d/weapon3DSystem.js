// src/3d/weapon3DSystem.js — ŁĄCZNIK (zadanie 17 portu WebGPU).
//
// Dawny system broni 3D (pociski, smugi, błyski wylotowe, wiązki) zastąpiły pule i receptury
// dema bronie-webgpu: src/3d/weapons/ (fasada WeaponFx). Moduł zostaje tylko jako łącznik
// wstrząsu strzałów dla src/effects3d/supernovaMissileBlow.js (plik zadania 19 — dokłada
// wstrząs przez Weapon3DSystem._cameraShakeMag; tu przekierowany do WeaponFx.weaponShake).
//
// AGENT: usunąć razem z supernovaMissileBlow.js — zadanie 19 kasuje ten plik (rakiety z dema
// rakiety-webgpu); po scaleniu 17 i 19 łącznik nie ma już importów.
import { WeaponFx } from './weapons/weaponFx.js';

export const Weapon3DSystem = {
  /** Wstrząs strzałów (window.__weapon3dCameraShake.mag) — w WeaponFx. */
  get _cameraShakeMag() { return WeaponFx.weaponShake; },
  set _cameraShakeMag(v) { WeaponFx.weaponShake = v; }
};
