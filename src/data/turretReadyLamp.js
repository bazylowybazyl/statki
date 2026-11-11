// src/data/turretReadyLamp.js
//
// LAMPKI GOTOWOŚCI PRZY WIEŻACH BRONI (decyzja użytkownika 2026-11-11: „lampki gotowości przy wieżach: zielona gotowa,
// bursztynowa przy przeładowaniu, czerwona pusta — z góry dobrze widoczne”). Wieże gracza i NPC (okręty z wieżami 3D).
//
//   ZIELONA     — gotowa do strzału (naładowana);
//   BURSZTYNOWA — przeładowanie albo ładowanie strzału (Valkyrie, Mjolnir, promień śmierci);
//   CZERWONA    — magazynek pusty albo gniazdo zniszczone;
//   BEZ LAMPKI  — okręt bez zasilania (`shipPowerOn` false — wyłączony okręt jest ciemny; kod DARK gasi też świecące
//                 akcenty wieży) albo wieża niewidoczna (mgła wojny, maskowanie, LOD — tych rekord nie dochodzi do obrazu).
//
// Kod liczy GRA (Turret2D.sync — rekord wieży tej klatki, pole `ready`), render tylko go rysuje (rekord TURRET migawki,
// pole READY — oba tryby renderu ten sam kod). Moduł czysty: bez three, DOM i stanu gry (gra i render importują go).

export const TURRET_LAMP = Object.freeze({
  NONE: 0,   // brak stanu (wieże proxy statków ruchu, rekord bez pola) — bez lampki, akcenty świecą
  READY: 1,  // zielona
  BUSY: 2,   // bursztynowa
  EMPTY: 3,  // czerwona
  DARK: 4    // okręt bez zasilania — bez lampki, akcenty przygaszone
});

/** Strojenie (`rapidCooldown` — kod lampki po stronie gry, reszta — obraz). */
export const TURRET_LAMP_TUNE = {
  // Broń szybkostrzelna (pełne przeładowanie krótsze niż tyle [s]: CIWS, działka) w ogniu ciągłym nie mruga
  // bursztynem co strzał — lampka zostaje zielona, dopóki broń ma amunicję.
  rapidCooldown: 0.5,
  // Barwy liniowe × moc HDR: rdzeń > progu bloomu ~0,9 (świeci), halo pod progiem — nie oślepia i nie zalewa wieży
  // (A/B w grze 2026-11-11: moc 4,2 i lampka ∝ wieży — plamy bloomu większe od wież). Czerwień ma mniejszą luminancję
  // przy tej samej mocy kanału — jaśniejsza, żeby z góry czytała się jak zieleń i bursztyn.
  colors: Object.freeze({
    1: Object.freeze([0.16, 1.0, 0.32]),
    2: Object.freeze([1.0, 0.5, 0.06]),
    3: Object.freeze([1.35, 0.09, 0.06])
  }),
  power: 2.4,
  // Lampka (billboard CargoLights, kształt „punkt”: jasny rdzeń ≈ 0,34 promienia + halo do 2 promieni) rośnie i maleje
  // RAZEM Z WIEŻĄ: promień [px] = promień wieży na ekranie × frac, w granicach [minPx, maxPx]; z daleka gaśnie (jasność
  // od 0 przy wieży o promieniu minTurretPx do pełnej przy fullTurretPx), poniżej minTurretPx — bez lampki.
  // Zgłoszenie użytkownika 2026-11-11: „zielone światła — jak oddalę kamerę, mocno się powiększają; są za duże” —
  // dawne stałe minimum 4,4 px robiło z lampki przy oddaleniu plamę większą od wieży.
  minPx: 1.2,
  maxPx: 6,
  frac: 0.14,
  minTurretPx: 10,
  fullTurretPx: 18,
  // Miejsce: za czopem, na tyle obudowy (ułamek promienia sylwetki wieży Turret2D wstecz od kursu lufy) i nad nią.
  back: 0.32,
  lift: 0.6,
  // Świecące akcenty wieży (pasy E_* modelu): przy wyłączonym okręcie gasną do `darkGlow`, zmiana ze stałą czasu `glowTau` [s].
  darkGlow: 0.06,
  glowTau: 0.22
};

/**
 * Kod lampki (TURRET_LAMP) z prostych pól stanu broni — gra (gracz i NPC), test.
 *   powered   — okręt w PRACY (`shipPowerOn`)
 *   destroyed — gniazdo zniszczone
 *   ammo      — amunicja (null / undefined — bez limitu; liczba ≤ 0 — pusty magazynek)
 *   left      — sekundy do końca przeładowania (≤ 0 — naładowana)
 *   cooldown  — pełne przeładowanie broni [s] (szybkostrzelne poniżej `rapidCooldown` — bez bursztynu przy przeładowaniu)
 *   charging  — trwa ładowanie strzału
 */
export function turretLampCode(powered, destroyed, ammo, left, cooldown, charging, T = TURRET_LAMP_TUNE) {
  if (!powered) return TURRET_LAMP.DARK;
  if (destroyed) return TURRET_LAMP.EMPTY;
  if (typeof ammo === 'number' && ammo <= 0) return TURRET_LAMP.EMPTY;
  if (charging) return TURRET_LAMP.BUSY;
  if (left > 0 && !(cooldown > 0 && cooldown < T.rapidCooldown)) return TURRET_LAMP.BUSY;
  return TURRET_LAMP.READY;
}

/** Barwa HDR lampki kodu do `out` ([r, g, b]); kod bez lampki → zera. Zwraca true, gdy lampka świeci. */
export function turretLampColor(code, out, T = TURRET_LAMP_TUNE) {
  const c = T.colors[code];
  if (!c) { out[0] = 0; out[1] = 0; out[2] = 0; return false; }
  const k = T.power;
  out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  return true;
}
