// src/game/weaponFeel.js
//
// Odrzut, wstrząs i skala trafienia broni — JEDNO źródło: dane broni (MASTER_WEAPONS,
// src/data/weapons.js, pola `recoil`, `shake`, `impactScale`; zadanie 18-D, decyzje
// docs/webgpu/PROJEKT-BRONI.md §2.6 i §5 p. 5–6). Dawniej odrzut i wstrząs strzału brał
// Turret2D z własnej tabeli FX_PROFILE (src/vfx/turret2D.js — dziś zostały w niej tylko
// klucze wieżyczek), a pola danych broni nikt nie czytał (inne liczby: Armata 15 / 8,
// Valkyrie 60 / 45, Yamato 90 / 65 — 18-A przepisało do danych wartości FX_PROFILE).
//
// Czytają: Turret2D (odrzut lufy i wstrząs strzału z rekordu wieżyczki → WeaponFx,
// window.__weapon3dCameraShake), superweapon.js (Hexlance — bez wieżyczki), bramka efektu
// trafienia spawnBulletImpactEffect w index.html (rozmiar × impactScale) i WeaponFx.impact
// (wstrząs trafienia × impactScale; obrazu receptur nie mnożymy — jak w demie).

/** Broń bez pola `recoil` / `shake` (dziś każda broń z efektem ma oba) — dawny fallback FX_PROFILE. */
export const WEAPON_RECOIL_FALLBACK = 3.0;
export const WEAPON_SHAKE_FALLBACK = 1.8;

/** Odrzut lufy wieżyczki (Turret2D: kopnięcie korpusu i lufy). */
export function weaponRecoil(def) {
  const v = Number(def?.recoil);
  return Number.isFinite(v) && v >= 0 ? v : WEAPON_RECOIL_FALLBACK;
}

/** Wstrząs kamery od strzału (kanał strzałów WeaponFx; Hexlance — camera.addShake). */
export function weaponShake(def) {
  const v = Number(def?.shake);
  return Number.isFinite(v) && v >= 0 ? v : WEAPON_SHAKE_FALLBACK;
}

/**
 * Skala trafienia: mnożnik rozmiaru efektu w bramce LOD trafienia i wstrząsu przy
 * trafieniu (1 = broń bez pola). Receptur (liczby i rozmiar cząstek) nie mnoży.
 */
export function weaponImpactScale(def) {
  const v = Number(def?.impactScale);
  return Number.isFinite(v) && v > 0 ? v : 1;
}
