// Kanoniczna konfiguracja bloomu gry — JEDYNE źródło prawdy.
// Core3D bierze stąd wartości bazowe, bloomTunerPanel domyślne pozycje
// suwaków. Zmiany wyglądu bloomu robi się TUTAJ, nie w localStorage ani
// w rozjechanych stałych. Bloom jest jeden — w poście Core3D (od zadania 20
// portu WebGPU nie ma overlaya efektów z własnym bloomem; parametry overlay*
// usunięte, wybuch reaktora świeci przez bloom gry).
//
// Pipeline jest HDR-first: emitery (pociski, beamy, dysze, okna budynków,
// planety) wypychają luminancję > 1.0, a próg ~0.9 odcina zwykłe oświetlone
// kadłuby i tło. Dzięki zapasowi HDR poświata gaśnie płynnie przy
// subpikselowym rozcieńczeniu MSAA (daleki zoom) zamiast binarnie migotać.
export const BLOOM_DEFAULTS = Object.freeze({
  // Główna scena (Core3D): statki, pociski, budynki, planety.
  strength: 0.85,
  radius: 0.4,
  threshold: 0.9,
  resolutionScale: 1.0,
  // Mnożnik HDR planet (uPlanetBloom w shaderach planet).
  planetBloomMultiplier: 1.0
});
