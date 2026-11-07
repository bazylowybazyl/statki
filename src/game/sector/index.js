// src/game/sector/index.js
//
// MAPA GWIEZDNA — strefa międzygwiezdna między układami (jak nadprzestrzeń w Starsectorze). Moduł czysty
// (bez three i DOM): sektor z ziarna (`sectorGen.js`), warunki strefy i punkty skoku (`sectorZone.js`),
// lot statku (`sectorFlight.js`), mgła eksploracji (`sectorExploration.js`), floty między układami
// (`sectorFleets.js`). Opis, liczby i plan wpięcia w grę: `docs/PLAN-mapa-gwiezdna.md`, reguła
// `.claude/rules/mapa-gwiezdna.md`; demo `dema/mapa-gwiezdna.html`.

export * from './sectorRandom.js';
export * from './sectorStars.js';
export * from './sectorBodies.js';
export * from './sectorGen.js';
export * from './sectorZone.js';
export * from './sectorFlight.js';
export * from './sectorExploration.js';
export * from './sectorFleets.js';
