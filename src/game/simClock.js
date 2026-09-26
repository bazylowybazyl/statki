// src/game/simClock.js
//
// Zegar symulacji dla efektów i śladów NIESIONYCH prędkością nośnika (strzelca,
// celu, pocisku). Efekt dziedziczy prędkość nośnika w chwili narodzin i leci
// z nią dalej jak gaz w próżni: rysuje się w  pos + v · (T − t0), gdzie T to
// czas pokazywany w klatce, a t0 to czas pozy, z której efekt wystartował.
// Przesunięcie liczone z czasu GRY, nie z zegara klatki: w pauzie stoi razem
// ze statkiem, a przy interpolacji renderu trzyma się kadłuba co do klatki.
//
//   sim       — czas pozy fizycznej. Rośnie w physicsStep zaraz po całkowaniu
//               pozycji gracza: broń gracza strzela PRZED tym miejscem (poza
//               sprzed kroku), CIWS, NPC i trafienia PO nim (poza po kroku) —
//               każdy spawn ma więc pod ręką czas swojej pozy jako `sim`.
//   render    — czas, który pokazuje bieżąca klatka dla encji interpolowanych
//               (gracz, P2, kamera za nimi): sim − (1 − alpha) · krok; w pauzie = sim.
//   renderSim — `sim` z chwili ostatniego renderu: pozy NPC w rekordach Turret2D.
//
// Zegary (CLOCK_*) rozróżniają, na czym efekt jest rysowany: gracza rysujemy
// w pozie interpolowanej, NPC i wraki w pozie fizycznej. Efekt NPC liczony
// zegarem renderu drgałby względem kadłuba o v · krok.

export const CLOCK_RENDER = 1;
export const CLOCK_SIM = 0;

export const SimClock = {
  sim: 0,
  render: 0,
  renderSim: 0,

  /** Krok fizyki: wołane raz na krok, po całkowaniu pozycji gracza. */
  advance(dt) {
    const step = Number(dt);
    if (step > 0) this.sim += step;
  },

  /**
   * Przed renderem klatki. `alpha` = acc / krok (interpolacja gracza),
   * `paused` — w pauzie poza gracza = poza fizyczna (saveState tuż przed renderem).
   */
  beginRender(alpha, stepDt, paused = false) {
    const a = Number(alpha);
    const dt = Number(stepDt) || 0;
    this.render = (paused || !Number.isFinite(a)) ? this.sim : this.sim - (1 - a) * dt;
    this.renderSim = this.sim;
  },

  /** Czas pokazywany w tej klatce dla danego zegara. */
  now(clock) {
    return clock === CLOCK_RENDER ? this.render : this.sim;
  },

  reset() {
    this.sim = 0;
    this.render = 0;
    this.renderSim = 0;
  }
};

if (typeof window !== 'undefined') window.SimClock = SimClock;
