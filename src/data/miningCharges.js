// src/data/miningCharges.js
//
// Ładunki górnicze (wydobycie skał pasa, zadanie 21b portu WebGPU): cztery wielkości
// S / M / L / XL jako PRZEDMIOT gracza — magazynek platformy wydobywczej (PLAYER.miningCharges),
// kupowany w doku stacji (karta „Ładunki górnicze” na rynku). Energia E trafia do
// src/game/asteroidMining.js (detonate): strefa zmiażdżenia i spękań rośnie jak ∛E, więc
// ładunek ×4 sięga ~1,6× dalej. Tabela zasięgów na materiał: chargeReach / chargeForDepth
// (src/game/asteroidMaterials.js).
//
// CENY TYMCZASOWE (do decyzji użytkownika — docs/webgpu/POSTEP.md, zadanie 21b): ~∝ E^0,8,
// skalibrowane pod dawną ładownię Atlasa 20 t (20 t rudy miedzi = 160 CR, tytanu 280, uranu ≈ 350 — ruda uranu
// waży 1,2 t na sztukę: 16 szt. × 22 CR).
// Od 2026-10-27 Atlas ma ATLAS_CARGO_CAP = 400 t (src/data/playerHullCatalog.js; kontenery-łup D1):
// pełna ładownia rudy miedzi to 3200 CR, tytanu 5600, uranu ≈ 7300 (333 szt.) — przy tych samych cenach ładunek
// zwraca się ~7× lepiej na skałę. Cen nie zmieniono (do decyzji: docs/PROPOZYCJA-kontenery-lup.md § 6).
// Mały ładunek na kruchą skałę (lód, kryształ) ma się zwracać, ciężki tylko przy bogatym rdzeniu.
// Ładunki nie liczą się do masy ładowni (osobny magazynek).

export const MINING_CHARGES = Object.freeze([
  Object.freeze({ id: 'S', label: 'mały', energy: 0.5, price: 8 }),
  Object.freeze({ id: 'M', label: 'średni', energy: 2, price: 25 }),
  Object.freeze({ id: 'L', label: 'duży', energy: 8, price: 80 }),
  Object.freeze({ id: 'XL', label: 'ciężki', energy: 32, price: 250 })
]);

export const MINING_CHARGE_IDS = Object.freeze(MINING_CHARGES.map((c) => c.id));

/** Wielkość ładunku po id (S / M / L / XL) albo null. */
export function miningChargeById(id) {
  for (let i = 0; i < MINING_CHARGES.length; i++) if (MINING_CHARGES[i].id === id) return MINING_CHARGES[i];
  return null;
}

/** Zestaw startowy gracza (magazynek platformy na starcie gry). */
export const MINING_STARTER_KIT = Object.freeze({ S: 6, M: 4, L: 3, XL: 1 });

/** Nowy magazynek ładunków { S, M, L, XL } (liczby sztuk). */
export function createMiningChargeStock(kit = MINING_STARTER_KIT) {
  const stock = { S: 0, M: 0, L: 0, XL: 0 };
  for (const id of MINING_CHARGE_IDS) stock[id] = Math.max(0, Math.floor(Number(kit?.[id]) || 0));
  return stock;
}
