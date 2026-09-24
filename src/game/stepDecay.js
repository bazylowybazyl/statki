// Stałe „na krok fizyki” strojone przy kroku 1/120 s (PHYS_HZ = 120).
//
// Część tłumień (tarcie NPC, wraków, odłamków) i liczników destruktora działa
// na krok, a nie na sekundę. Przy innej częstotliwości kroku (?physHz=60)
// hamowałyby dwa razy słabiej, a liczniki trwały dwa razy dłużej. Te helpery
// przeliczają je na ten sam przebieg w czasie rzeczywistym. Przy kroku
// 1/120 s zwracają dokładnie wartość wejściową — domyślna gra jest bit w bit
// taka jak przed ich wprowadzeniem.

export const REF_STEP_DT = 1 / 120;

// Mnożnik k stosowany co krok 1/120 s → mnożnik dla kroku dt o tym samym
// zaniku na sekundę.
export function stepDecay120(k, dt) {
  if (dt === REF_STEP_DT) return k;
  return Math.pow(k, dt * 120);
}

// Liczba kroków 1/120 s → liczba kroków długości dt obejmująca ten sam czas
// (co najmniej 1).
export function ticksAt120(ticks, dt) {
  if (dt === REF_STEP_DT) return ticks;
  return Math.max(1, Math.round(ticks / (dt * 120)));
}
