// Wielka kopalnia ringu — dziura na Saharze, z której wzięto skałę na ring „Halo”.
// JEDNO źródło kształtu: generator map Ziemi (scripts/planety/dziura.py czyta blok JSON
// między znacznikami) i bryła 3D w grze (src/3d/earthPit3D.js, gałąź dziury w grafie planety).
// Zmiana liczb = ponowne wypieczenie map (`scripts/planety/ziemia.py --szer 8192 --do-gry`).
//
// Profil (km pod krawędzią) w punkcie kuli: s = odległość kątowa od środka / promień obrysu
// w danym azymucie (obrys nieregularny: płaty `lobes`); tarasy od krawędzi (s = 1) do dna
// (s = floor), szyb w środku (s < shaftR), wał hałd za krawędzią (1 < s < 1 + rimWidth). Tarasy
// mają nierówne szerokości zmienne wzdłuż obwodu: f' = f + benchWarp · w(φ) · sin(π · waves · f),
// w(φ) = ½ + ½ sin(2φ + 1) — zachowuje krawędź i dno, monotonię dla benchWarp < 1 / (π · waves).
export const EARTH_PIT = Object.freeze(/*EARTH_PIT*/{
  "lon": 13.5,
  "lat": 20.5,
  "radiusKm": 860,
  "lobes": [[2, 0.15, 30], [3, 0.07, 115], [5, 0.035, 10], [7, 0.02, 200]],
  "depthKm": 38,
  "benches": 13,
  "riser": 0.36,
  "benchWarp": 0.045,
  "benchWarpWaves": 5,
  "floor": 0.24,
  "shaftR": 0.13,
  "shaftDepthKm": 45,
  "rimBermKm": 1.6,
  "rimWidth": 0.14,
  "spiralArms": 3,
  "spiralTurns": 1.15,
  "massDrivers": [[62, 1500], [168, 1250], [301, 1700]],
  "exaggeration": 3.0
}/*EARTH_PIT-KONIEC*/);
