// Pasma HDR i puls stanu rdzenia — wspólne dla żaru (coreFx3D) i plazmy
// modelu reaktora (reactor3D). Czysty moduł: bez three i bez DOM (testy node).
import { CORE_STATE } from '../game/shipCore.js';

// UnrealBloomPass BRAMKUJE (memory hdr-band-plan): piksel nad progiem wchodzi
// do bloomu PEŁNĄ wartością, więc łagodna rampa od bieli do ciała (8 → 0,9)
// dawała setki pikseli 2–8 i szeroką białą plamę zjadającą barwę reaktora.
// Biały rdzeń ma dlatego ostrą krawędź (coreEdge) i mały promień, a ciało
// zostaje w całości pod progiem 0,9.
export const CORE_FX_BANDS = Object.freeze({
  bodyL: Object.freeze({ exposed: 0.62, critical: 0.72, meltdown: 0.84 }),
  // Szczyt z pulsem × (0,92–1,0): ODSŁ. 8,3–9, KRYT. 9,2–10, STOP. do 11,5.
  coreL: Object.freeze({ exposed: 9.0, critical: 10.0, meltdown: 11.5 }),
  coreRadius: Object.freeze({ exposed: 0.07, critical: 0.09, meltdownEnd: 0.14 }),
  // Promień żaru × promień komory: w stopieniu światło rośnie ponad komorę
  // i wypełnia całą wyrwę (kanał od strony ognia bywa 2× szerszy od komory).
  glowGrowth: Object.freeze({ nominal: 1.15, meltdownStart: 1.2, meltdownEnd: 2.2 }),
  coreEdge: 0.82,          // krawędź białego rdzenia: smoothstep(R, R·coreEdge)
  // Wyrzuty sumują się addytywnie (w stopieniu kilkadziesiąt naraz nad
  // wyrwą): ciało nisko, żeby 2–3 nałożone zostały pod progiem 0,9. Biała
  // głowica jak rdzeń — ostra krawędź, jasność 8–12, włączona tylko przez
  // początek życia cząstki (gasnąc płynnie przechodziłaby przez 2–8). W
  // stopieniu głowicę dostaje ułamek wyrzutów rosnący z postępem odliczania.
  ventBodyL: 0.32,
  ventCoreL: 9.0,
  // Po detonacji: strumień i kula — ciało w paśmie barwy, biel 8–12 ostro.
  jetBodyL: 1.05,         // barwa tuż nad progiem 0,9: kolorowy bloom, bez bieli ACES
  jetCoreL: 8.0,
  orbBodyL: 1.0,
  orbCoreL: 8.0,
  ringEdgeL: 8.5,
  flashCoreL: 9.0,
  flashBodyL: 0.9,
  ventHotLife: 0.16,       // część życia cząstki z białą głowicą
  ventHotRadius: 0.3,      // promień głowicy × rozmiar cząstki
  // Żar brzegu (0–1, jak shard.heat): pomarańcz pod progiem bloomu do
  // stopienia, dopiero pod koniec odliczania brzeg dochodzi do bieli.
  // Barwa reaktora ma dominować: brzeg zostaje pomarańczowy (≤ 0,45 — pod
  // progiem bloomu) i dochodzi do bieli dopiero w ostatnich 25% odliczania.
  rimHeat: Object.freeze({ exposed: 0.3, critical: 0.38, meltdownStart: 0.42, meltdownEnd: 0.8 })
});

// Warstwa passa tarcz w Core3D (SHIELD_RENDER_LAYER) — nagłówek coreFx3D.js.
export const CORE_FX_LAYER = 7;

/**
 * Pasmo stanu rdzenia do `out` (bez alokacji na klatkę):
 * prog (postęp stopienia 0–1), bodyL / coreL (ciało i biel), coreR (promień
 * bieli × komora), rim (żar brzegu 0–1), pulseHz (bicie serca 0,5 → 7 Hz).
 */
export function coreStateBand(core, out = {}) {
  const B = CORE_FX_BANDS;
  if (core.state === CORE_STATE.MELTDOWN) {
    const prog = core.meltdownDuration > 0 ? Math.max(0, Math.min(1, 1 - core.meltdownRemaining / core.meltdownDuration)) : 1;
    out.prog = prog;
    out.bodyL = B.bodyL.critical + (B.bodyL.meltdown - B.bodyL.critical) * prog;
    out.coreL = B.coreL.critical + (B.coreL.meltdown - B.coreL.critical) * prog;
    out.coreR = B.coreRadius.critical + (B.coreRadius.meltdownEnd - B.coreRadius.critical) * prog * prog;
    const late = Math.max(0, (prog - 0.75) / 0.25);
    out.rim = B.rimHeat.meltdownStart + (B.rimHeat.meltdownEnd - B.rimHeat.meltdownStart) * late * late;
    // bicie serca: 1,2 Hz → 7 Hz pod koniec odliczania
    out.pulseHz = 1.2 + 5.8 * prog * prog;
  } else if (core.state === CORE_STATE.CRITICAL) {
    out.prog = 0; out.bodyL = B.bodyL.critical; out.coreL = B.coreL.critical;
    out.coreR = B.coreRadius.critical; out.rim = B.rimHeat.critical; out.pulseHz = 0.9;
  } else {
    out.prog = 0; out.bodyL = B.bodyL.exposed; out.coreL = B.coreL.exposed;
    out.coreR = B.coreRadius.exposed; out.rim = B.rimHeat.exposed; out.pulseHz = 0.5;
  }
  return out;
}
