// src/3d/spaceGas/spaceGasState.js
//
// Stan gazu w otwartej przestrzeni dla INNYCH modułów renderu (ten sam wątek: strona w trybie off, worker renderu).
// `belt` — pokrycie pasa gazem 0…1 w tej klatce (zanik przy oddaleniu, 0 — gaz wyłączony albo poza pasem). Płytkie
// płaty mgły pasa (src/3d/asteroids/fog.js) gasną o tyle: w pasie JEDNA mgła — gaz zamiast płatów w passie gry
// (decyzja użytkownika 2026-10-22; plan GK-5); bez gazu (opcja wył., preset Niska) zostaje stara mgła. Pisze
// SpaceGas raz na klatkę w swoim kroku Core3D.fx — czytający może dostać wartość z poprzedniej klatki.
export const SpaceGasCover = { belt: 0 };
