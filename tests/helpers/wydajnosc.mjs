// Asercje WYDAJNOŚCI — progi czasu ściany („plan < 25 ms”, „krok bańki < 50 ms”) — to osobne testy z opcją
// `WYDAJNOSC`: w zwykłym zestawie pominięte (widać je jako „skipped” z powodem), bo pod obciążeniem (równoległe
// sesje, harnessy Chrome, gra użytkownika) czas ściany mówi o maszynie, nie o kodzie. Na spokojnej maszynie:
//   HULLFALL_TESTY_WYDAJNOSC=1 node --test "tests/*.test.mjs"
// Testy funkcjonalne nie mierzą czasu ściany: budżet czasu sprawdzają wstrzykniętym zegarem albo liczbą kroków.
export const TESTY_WYDAJNOSCI = process.env.HULLFALL_TESTY_WYDAJNOSC === '1';
export const WYDAJNOSC = Object.freeze({
  skip: TESTY_WYDAJNOSCI ? false : 'próg czasu ściany — tylko z HULLFALL_TESTY_WYDAJNOSC=1 (tests/helpers/wydajnosc.mjs)'
});
