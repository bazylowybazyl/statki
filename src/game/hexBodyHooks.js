// Haki ciał heksowych dla modułów wspólnych z demami (renderer heksów, statystyki areny).
//
// Od etapu 8 portu silnika belek (docs/PORT-silnik-belek.md) gra nie ładuje destructor.js —
// żaden byt w grze nie ma `hexGrid`. Dema heksowe (mostki, rdzeń, asteroidy) ładują go
// i destructor.js wpisuje tu swoje funkcje przy imporcie, więc hexShips3D.js i perfHud.js
// obsługują heksy bez importu silnika. Bez destruktora haki zostają null — a bez niego
// nie ma też ani jednego `hexGrid`, więc ścieżka heksowa i tak się nie wykonuje.
export const HexBodyHooks = {
  /** (entity) => void — przebudowa pamięci podręcznej siatki (destructor.refreshHexBodyCache). */
  refreshHexBodyCache: null,
  /** (shard) => boolean — heks na brzegu siatki (arena heksów). */
  isPackedShardBoundary: null,
  /** () => object — liczniki areny heksów (PerfHUD). */
  getHexArenaStats: null
};
