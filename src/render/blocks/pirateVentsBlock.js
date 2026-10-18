// src/render/blocks/pirateVentsBlock.js — blok migawki: WYRWY bazy piratów (dekompresja, pożary) — stan klatki dla obrazu
// (src/3d/pirateBaseVents3D.js). Decyzje (czy i gdzie wieje / płonie, siła strumienia, ogień w wylatującym tlenie,
// żarzenie) zapadają w grze (src/game/story/pirateBaseAtmosphere.js); tu tylko UKŁAD REKORDU (wspólny dla gry i renderu)
// i blok do `packer.addBlock` (tryb worker): gra pisze rekordy wyrw (pozycja świata w czasie renderu, normalna,
// prędkość nośnika), render odtwarza ten sam stan (`applyPirateVentsBlock`). Tryb off / inline — render dostaje obiekt
// gry wprost (ten sam kształt: { has, n, time, dt, rec }).
// Czysty moduł (bez three, DOM i `window`).

/** Najwięcej wyrw w klatce (gra łączy bliskie i wypiera najsłabsze). */
export const VENT_MAX = 32;

/**
 * Rekord wyrwy (Float64, VENT_REC.STRIDE liczb). Świat GRY: x, y (y w dół), z — wysokość świata (pod płaszczyzną gry
 * ujemna); normalna i prędkość w tym samym układzie. Pola:
 *   ID      — stały numer wyrwy (nowy numer = nowa wyrwa; obraz liczy z niego narodziny i ziarno),
 *   R       — promień otworu [j.],
 *   FLOW    — strumień masy względem pełnego modułu (0…~1,3): ρ·√T zbiornika za otworem (w próżni przepływ dławiony),
 *   SPEED   — prędkość wylotu względem zimnego startu (√T — ochładzanie adiabatyczne; ogień podgrzewa),
 *   FIRE    — płomień w wylatującym tlenie (0…1), SMOLDER — żarzenie brzegów i dym po pożarze (0…1),
 *   ICE     — kondensacja (biała para / kryształki lodu, 0…1; gorący gaz z pożaru mniej biały),
 *   AGE     — wiek wyrwy [s] (czas gry), KIND — rodzaj modułu (VENT_KIND), HOST — klucz rodu ciała, do którego przyczepiona
 *             jest wyrwa (gaz pomija jego obrys jako przeszkodę; 0 = brak), SEED — ziarno obrazu, MAIN — 1: wyrwa głównej
 *             objętości modułu (długa dekompresja), 0: kajuta za przegrodami (krótki syk), MODULE — indeks modułu,
 *   BURST   — gwałtowność rozszczelnienia (0…1; obraz: błysk, szczątki, iskry w pierwszych chwilach),
 *   SPARK   — zwarcia (0…1, gaśnie): iskry i błyski elektryczne w wyrwie.
 */
export const VENT_REC = Object.freeze({
  ID: 0, X: 1, Y: 2, Z: 3, NX: 4, NY: 5, NZ: 6, VX: 7, VY: 8, VZ: 9, R: 10, FLOW: 11, SPEED: 12, FIRE: 13, SMOLDER: 14,
  ICE: 15, AGE: 16, KIND: 17, HOST: 18, SEED: 19, MAIN: 20, MODULE: 21, BURST: 22, SPARK: 23, STRIDE: 24
});

/** Rodzaje modułów ciśnieniowych (paleta obrazu: szczątki, barwa dymu, światło wnętrza). */
export const VENT_KIND = Object.freeze({ drum: 0, core: 1, tech: 2, disc: 3, warehouse: 4, annex: 5, tank: 6 });

const HEAD = Object.freeze({ HAS: 0, N: 1, TIME: 2, DT: 3, STRIDE: 4 });
export const PIRATE_VENTS_BLOCK = Object.freeze({ HEAD });

/** Stan klatki wyrw (gra pisze, render czyta) — obiekt do ponownego użycia. */
export function createPirateVentsFrame() {
  return { has: false, n: 0, time: 0, dt: 0, rec: new Float64Array(VENT_MAX * VENT_REC.STRIDE) };
}

/** Blok do `packer.addBlock` (faza begin): `frame.pirateVents` = stan klatki gry (pirateBaseVentFrame()). */
export function createPirateVentsBlock() {
  return {
    name: 'pirateVents', f64: HEAD.STRIDE + VENT_MAX * VENT_REC.STRIDE, phase: 'begin',
    pack(blk, frame) {
      const F = blk.f64;
      const s = frame.pirateVents || null;
      F[HEAD.HAS] = s && s.has ? 1 : 0;
      if (!s || !s.has) { F[HEAD.N] = 0; return; }
      const n = Math.min(VENT_MAX, s.n | 0);
      F[HEAD.N] = n;
      F[HEAD.TIME] = s.time;
      F[HEAD.DT] = s.dt;
      const S = VENT_REC.STRIDE;
      for (let i = 0; i < n * S; i++) F[HEAD.STRIDE + i] = s.rec[i];
    }
  };
}

/** Strona renderu: blok strony → `mirror` (kształt createPirateVentsFrame). */
export function applyPirateVentsBlock(blk, mirror) {
  const F = blk.f64;
  mirror.has = F[HEAD.HAS] === 1;
  if (!mirror.has) { mirror.n = 0; return mirror; }
  const n = Math.min(VENT_MAX, F[HEAD.N] | 0);
  mirror.n = n;
  mirror.time = F[HEAD.TIME];
  mirror.dt = F[HEAD.DT];
  const S = VENT_REC.STRIDE;
  for (let i = 0; i < n * S; i++) mirror.rec[i] = F[HEAD.STRIDE + i];
  return mirror;
}
