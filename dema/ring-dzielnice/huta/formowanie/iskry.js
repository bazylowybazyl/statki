// HUTA — formowanie, etapy „Pasmo w polu” i „Kropla”: ISKRY LINII (czysty JS, bez three; krok bez alokacji, losowość
// mulberry32).
//
// Struga wchodzi w błonę z góry, PROWADZONA polem (zahamowana przed wejściem — bez rozbryzgu): przy wejściu sypie się
// tylko garść iskier — ciągle 18 · (dopływ / 36 t/s) na sekundę i salwa przy pierwszym zetknięciu spływu z błoną. Iskry
// pryskają po powierzchni błony (na boki i wstecz, lekko w górę). Linia stoi w nieważkości (jak komora): iskra leci
// prosto, hamowana oporem atmosfery hali, stygnie i gaśnie w 0,4–0,8 s. Rekord rysunku — ten sam co iskry wytopu
// (`PART_STRIDE` 8: iCur = xyz + życie 0…1, iPrev = xyz + żar), rysuje go ten sam materiał (`WytopIskra` — bez nowego
// programu).
// (Zgorzelina i iskry przy chwycie walców F1–F3 — od rundy 7 osobna pula i materiał: `zgorzelina.js`, `zgorzelinaTSL.js`.)
import { HALA } from './geometria.js';
import { LIN_STAN } from './linia.js';

export const ISKRA_STRIDE = 8;
export const ISKRY_CAP = 1280;
export function createLineSparks(seed = 23) {
  const N = ISKRY_CAP;
  const pos = new Float64Array(N * 3);
  const vel = new Float64Array(N * 3);
  const life = new Float64Array(N * 2);           // pozostało [s], całość [s]
  const heat = new Float64Array(N).fill(1);       // żar cząstki
  const data = new Float32Array(N * ISKRA_STRIDE);
  const st = new Float64Array(4);                 // [0] ułamek iskier do wypuszczenia, [1] poprzedni dopływ, [2] liczba żywych
  const rs = new Uint32Array(1);
  rs[0] = (seed >>> 0) ^ 0x9E3779B9;
  const R = new Float64Array(1);
  function rnd() {
    rs[0] += 0x6D2B79F5;
    let t = rs[0];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    R[0] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  let n = 0;
  function spawn(x, y, z, jv, jr) {
    if (n >= N) return;
    const i = n++;
    // rozprysk przy wejściu w błonę: po powierzchni (na boki, wstecz, lekko w górę), prędkość 0,1–0,3 strugi
    rnd(); const a = R[0] * Math.PI * 2;
    rnd(); const sp = jv * (0.1 + 0.2 * R[0]);
    rnd(); const up = 0.15 + 0.35 * R[0];
    const ca = Math.cos(a); const sa = Math.sin(a);
    pos[i * 3] = x + ca * jr * 0.9; pos[i * 3 + 1] = y + 2; pos[i * 3 + 2] = z + sa * jr * 0.9;
    vel[i * 3] = ca * sp * 0.8 - 0.25 * sp; vel[i * 3 + 1] = up * sp; vel[i * 3 + 2] = sa * sp;
    rnd(); life[i * 2] = life[i * 2 + 1] = 0.4 + 0.4 * R[0];
    heat[i] = 1;
    const o = i * ISKRA_STRIDE;
    data[o] = data[o + 4] = pos[i * 3]; data[o + 1] = data[o + 5] = pos[i * 3 + 1]; data[o + 2] = data[o + 6] = pos[i * 3 + 2];
  }
  return {
    data,
    get count() { return n; },
    /** Krok strony (dt): wypuszcza iskry przy wlocie strugi do zasobnika i przesuwa żywe. */
    step(dt, line) {
      const L = line.stan;
      const inR = L[LIN_STAN.splash] > 0 ? L[LIN_STAN.inRate] : 0;
      // (etap „Struga”: promień strugi przy wejściu z wypływu przez wargę i prędkości wejścia)
      const jv = Math.max(L[LIN_STAN.lipV], 120);
      const jr = Math.sqrt(Math.max(L[LIN_STAN.lipQ], 1) * 229847 / Math.max(L[LIN_STAN.vIn], 300) / Math.PI);
      const x = L[LIN_STAN.hitX];
      const y = L[LIN_STAN.hitY];
      const vIn = L[LIN_STAN.vIn] > 0 ? L[LIN_STAN.vIn] : jv * 0.42;
      if (L[LIN_STAN.landed] > 0 && L[LIN_STAN.jetHead] >= 0) {
        // salwa przy pierwszym zetknięciu (dopływ do błony rusza od zera)
        if (st[1] < 0.5 && inR >= 0.5) for (let k = 0; k < 40; k++) spawn(x, y, 0, vIn, jr);
        st[0] += 18 * Math.min(1.5, inR / 36) * dt;
        while (st[0] >= 1) { st[0] -= 1; spawn(x, y, 0, vIn, jr); }
      }
      st[1] = inR;
      const drag = Math.exp(-0.6 * dt);
      for (let i = 0; i < n;) {
        life[i * 2] -= dt;
        if (life[i * 2] <= 0) {
          // usunięcie: ostatnia na jej miejsce
          const j = --n;
          if (i !== j) {
            for (let k = 0; k < 3; k++) { pos[i * 3 + k] = pos[j * 3 + k]; vel[i * 3 + k] = vel[j * 3 + k]; }
            life[i * 2] = life[j * 2]; life[i * 2 + 1] = life[j * 2 + 1];
            heat[i] = heat[j];
            for (let k = 0; k < ISKRA_STRIDE; k++) data[i * ISKRA_STRIDE + k] = data[j * ISKRA_STRIDE + k];
          }
          continue;
        }
        const o = i * ISKRA_STRIDE;
        data[o + 4] = pos[i * 3]; data[o + 5] = pos[i * 3 + 1]; data[o + 6] = pos[i * 3 + 2];
        for (let k = 0; k < 3; k++) { vel[i * 3 + k] *= drag; pos[i * 3 + k] += vel[i * 3 + k] * dt; }
        // pokład hali: iskra gaśnie na płycie
        if (pos[i * 3 + 1] < HALA.deckY + 2) life[i * 2] = Math.min(life[i * 2], 0.05);
        const lf = life[i * 2] / life[i * 2 + 1];
        const g = lf * heat[i];
        data[o] = pos[i * 3]; data[o + 1] = pos[i * 3 + 1]; data[o + 2] = pos[i * 3 + 2]; data[o + 3] = g;
        data[o + 7] = g;
        i++;
      }
      st[2] = n;
    }
  };
}
