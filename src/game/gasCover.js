// src/game/gasCover.js
//
// OSŁONA GAZU DLA CZUJNIKÓW (2026-11-11, scenariusz użytkownika: „ktoś cię goni, wchodzisz w chmurę gazową, wyłączasz
// i jest cisza”). Rozgrywka liczy gęstość gazu na CPU z POLA DALEKIEGO — tej samej obwiedni, którą gra pakuje do obrazu
// gazu (`sampleEnv` w src/game/spaceGasInput.js; decyzja D7 `docs/PLAN-gazy-kosmos.md`: kanały wyżłobione przez okręty
// są tylko w obrazie). Wynik nie zależy od kamery, opcji grafiki ani tego, czy obraz gazu jest włączony.
//
// Źródła: pole pasa (`beltWorld.field.sampleMacro` — mgła pasa × wyrwy + źródła gazu pola) i pole ringu w budowie
// (`createRingGasField(...).sampleMacro` — to samo API). Wołający podaje pole, które dotyka punktu.
// Czysty moduł: bez three, DOM i `window`.

/** Strojenie (konsola: window.GasCoverTune). */
export const GAS_COVER_TUNE = {
  lo: 0.3,        // obwiednia, od której gaz zaczyna osłaniać (cienka mgła pasa ~0,22 — prawie nic)
  hi: 0.75,       // pełna osłona (gęste skupisko pasa, środek pasa pyłu ringu)
  sigMul: 0.4,    // sygnatura okrętu w pełnej osłonie (× stan zasilania × klasa)
  visionFloor: 0.5 // wzrok (mgła gracza) nie spada poniżej tego ułamka — gaz i ciemny kadłub skracają, nie oślepiają
};

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Obwiednia gazu pola w punkcie świata gry (ten sam wzór co wejście obrazu gazu). Pole bez `sampleMacro` — 0. */
export function gasEnvAt(field, x, y) {
  if (!field || typeof field.sampleMacro !== 'function') return 0;
  const m = field.sampleMacro(x, y);
  if (!m) return 0;
  const w = m.weight > 0 ? m.weight : 0;
  const hole = m.hole === undefined ? 1 : m.hole;
  const gas = m.gas > 0 ? m.gas : 0;
  const cl = m.cluster > 0 ? m.cluster : 0;
  return w * (0.22 + 0.78 * Math.min(1, cl * 1.15)) * hole + gas;
}

/** Osłona 0..1 z obwiedni. */
export function gasCoverFromEnv(env, T = GAS_COVER_TUNE) {
  return smooth((env - T.lo) / Math.max(1e-4, T.hi - T.lo));
}

/** Osłona 0..1 w punkcie z pola (pas albo ring). */
export function gasCoverAt(field, x, y, T = GAS_COVER_TUNE) {
  return gasCoverFromEnv(gasEnvAt(field, x, y), T);
}

/** Mnożnik sygnatury z osłony: 1 bez gazu, `sigMul` w pełnej osłonie. */
export function gasSignatureMul(cover, T = GAS_COVER_TUNE) {
  const c = cover > 0 ? (cover < 1 ? cover : 1) : 0;
  return 1 + (T.sigMul - 1) * c;
}

/** Mnożnik zasięgu wzroku z łącznego mnożnika sygnatury (podłoga `visionFloor`). */
export function visionMulFromSignature(sigMul, T = GAS_COVER_TUNE) {
  const m = sigMul > 0 ? sigMul : 0;
  return m > T.visionFloor ? (m < 1 ? m : 1) : T.visionFloor;
}

if (typeof window !== 'undefined') window.GasCoverTune = GAS_COVER_TUNE;
