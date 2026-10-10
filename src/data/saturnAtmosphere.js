// Atmosfera Saturna — JEDNO źródło danych dla generatora mapy (scripts/planety/saturn.py czyta blok JSON między
// znacznikami) i żywej atmosfery w grze (src/3d/saturnAtmosphere.js). Zmiana położeń = ponowne wypieczenie mapy
// (`scripts/planety/saturn.py --szer 8192 --do-gry`) — wiry i czapy polarne w grze leżą tam, gdzie je narysowano.
//
// Układ jak mapy gry: u w STOPNIACH od lewej krawędzi tekstury (kolumna 0 = 180° W, u = długość + 180),
// szerokość PLANETOCENTRYCZNA (mapa liniowo w szerokości planetocentrycznej, v = 1 — biegun N).
//
// wind — wiatr strefowy [m/s, System III, + na wschód] co windStepDeg od −90° do 90°: profil Cassini ISS
//   (García-Melendo i in. 2011, Icarus 215, 62–74; filtry continuum CB2/CB3, 2004–2009 — PDS Atmospheres,
//   coiss_zonal_winds/contzonal.csv, doi:10.17189/1518962), wygładzony gaussem σ = 0,7°. Brak danych za 82,9° N —
//   dżet wiru polarnego płn. z literatury (~140 m/s przy ~88° N, Antuñano i in. 2015); przy samym biegunie wiatr
//   maleje liniowo do zera (obrót sztywny jądra wiru).
// hexagon — dżet sześciokątny płn. (78° N planetograficznej = 75,4° planetocentrycznej; stoi w Systemie III):
//   sides, phaseU — u wierzchołka, inner / outer — zasięg kształtu sześciokąta do bieguna / na zewnątrz [° kątowe].
// poles — czapy polarne (ruch po okręgach wokół bieguna; granica cap na minimum profilu), core — jądro wiru
//   obracane sztywnie [° od bieguna], eye / eyewall — oko i ściana oka [° od bieguna].
// storm — pas po Wielkiej Białej Plamie 2010–2011 (głowa wybuchła na 32,6° N, 114,1° E — Sánchez-Lavega i in.;
//   ogon owinął planetę w pasie 25–48° N).
// ribbon — fala wstęgowa w dżecie 42° N (Gunnarson i in. 2018: fale 39–45° N), waves — liczba fal na obwodzie.
// alley — „aleja burz” 35° S (planetocentrycznie; burza „Smok” 2004 — Dyudina i in.).
// vortices — wiry z obrotem w grze (jak JUPITER_VORTICES): sense +1 przeciwnie do wskazówek zegara (anticyklon
//   półkuli płd.), −1 zgodnie (anticyklon półkuli płn.); a — półoś w stopniach u, b — w stopniach szerokości.
export const SATURN_ATMOSPHERE = Object.freeze(/*SATURN_ATM*/{
  "radiusEqKm": 60268,
  "radiusPolarKm": 54364,
  "windStepDeg": 0.5,
  "wind": [0,33.2,96,123,137.9,141.4,139.1,134.4,128.2,120.7,111.5,99.9,86.1,71.9,59.3,48.9,40.4,33.4,27.3,21.9,16.7,11.9,7.9,4.9,2.8,1.3,0.4,0.2,0.6,1.6,3.4,6.2,10.1,15.6,23.3,33.7,46.9,61.6,74.2,79.9,76.1,64.5,48.9,33.6,20.8,10.8,2.9,-3.1,-7.4,-10.4,-12.5,-13.7,-14,-13.4,-12.1,-10.2,-7.8,-4.9,-1.6,2.2,6.1,10.2,15.1,23.1,37.3,58.8,84.3,108.8,126.6,133.9,131.8,124.3,114.7,104.4,93.6,82.3,71.4,61.1,51.4,42.4,34.9,29.1,25.1,23.3,23.9,26.7,32,39.6,49,59.8,72.7,87.5,102.1,114.2,122.7,125.7,121.1,108.2,90,70.6,53.1,38.4,26.4,16.8,9.2,3.3,-1,-4.1,-6.5,-8.6,-10.2,-10.8,-9.4,-5.7,0.7,9.3,19.4,29.9,39.4,47,53.1,58.6,64.9,71.8,77.5,79.5,76.9,71.5,66.4,63.9,64.9,69.2,76,84.6,93.8,102.6,110.4,117.4,124,130.6,138,146.5,156,166.1,177,188.3,199.3,209.9,219.7,228.4,236.3,244.2,253.1,263.9,276.3,289.9,303.8,317.3,329.5,339.7,348,354.7,360.1,364.1,366.6,367.6,367.5,366.2,363.9,360.6,356.9,353.3,350.4,349.1,349.6,351.2,353.2,356.7,362.8,370.1,374.6,373.2,366.6,358.7,353.4,351.8,353.1,356.1,359.8,363.7,368.1,372.7,377.3,381.1,383.1,382.8,379.6,373.7,366.2,358.8,351,341.4,329.5,318.2,309.4,300.7,289.4,275.1,259.9,246,233.9,223.3,214,205.5,197.7,190.2,182.8,175.2,167,158.3,149.1,139.4,129.8,120.8,112.3,104.6,97.8,91.9,86.5,81.6,77.6,75.2,74.1,73.3,71.1,67.3,63.3,60.4,58.1,55.1,49.7,41.1,30.1,18,6.2,-4.3,-12.2,-17,-18.9,-18.4,-16.2,-12.7,-8.1,-2.3,5.1,14.9,27.1,41.2,57,74.2,92.3,109.3,122.6,131.1,133.3,127.7,114.8,97.1,77.3,59.9,47.3,37.6,29,21.5,15.3,10.2,5.8,2.4,-0.1,-1.3,-1.1,0.5,3.6,8.2,14,21,29.5,39.3,49.8,60.5,70.9,79.8,85.4,86.6,83.7,78.2,72.4,67.9,65.6,66.2,69.7,75.8,82.7,87,85.1,76.1,62.3,47.9,35.7,25.6,17.4,10.4,4.5,-0.3,-3.9,-6.5,-8.5,-10,-10.9,-11.2,-10.8,-9.7,-7.8,-5,-1,5,13.5,25.2,40.4,57,70.1,74.1,65.7,50.8,37.4,27.1,19.3,14.1,11.8,11.6,13.1,16.4,21,26.5,32,35.9,38.6,41.6,46.6,53.6,62.4,73.4,85.9,98.8,111.2,121.5,123.5,113.1,96.2,40.1,0],
  "hexagon": { "latC": 75.4, "sides": 6, "phaseU": 32.0, "inner": 10.0, "outer": 3.5 },
  "poles": {
    "north": { "cap": 69.5, "core": 2.6, "eye": 0.85, "eyewall": 1.5 },
    "south": { "cap": 64.5, "core": 3.4, "eye": 1.3, "eyewall": 2.3 }
  },
  "storm": { "headU": 294.1, "headLat": 32.6, "lo": 25.0, "hi": 41.0 },
  "ribbon": { "lat": 42.0, "waves": 56, "amp": 0.45 },
  "alley": { "lat": -35.0 },
  "vortices": [
    { "id": "anticyklon 2011", "u": 236.0, "lat": 35.6, "a": 5.4, "b": 2.9, "sense": -1, "periodDays": 3.2, "core": 0.35, "drift": null, "rigid": true },
    { "id": "owal alei A", "u": 52.0, "lat": -41.2, "a": 1.8, "b": 1.05, "sense": 1, "periodDays": 2.0, "core": 0.5, "drift": null, "rigid": true },
    { "id": "owal alei B", "u": 171.0, "lat": -41.4, "a": 1.5, "b": 0.9, "sense": 1, "periodDays": 1.8, "core": 0.5, "drift": null, "rigid": true },
    { "id": "owal alei C", "u": 318.0, "lat": -40.9, "a": 2.1, "b": 1.15, "sense": 1, "periodDays": 2.2, "core": 0.5, "drift": null, "rigid": true },
    { "id": "owal 60 N", "u": 96.0, "lat": 59.6, "a": 2.6, "b": 1.3, "sense": -1, "periodDays": 2.4, "core": 0.5, "drift": null, "rigid": true },
    { "id": "owal 50 S", "u": 260.0, "lat": -51.8, "a": 2.4, "b": 1.2, "sense": 1, "periodDays": 2.4, "core": 0.5, "drift": null, "rigid": true }
  ]
}/*SATURN_ATM-KONIEC*/);
