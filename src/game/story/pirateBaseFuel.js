// ============================================================
// Reakcja łańcuchowa w sieci paliwowej bazy piratów (misja 1; decyzje użytkownika z 2026-10-11): wysadzony zbiornik
// paliwa (P) zapala rurociąg — front ognia biegnie rurami wzdłuż pomostów, każdy okręt podpięty w stanowisku wybucha
// z własnego zbiornika paliwa, rury pękają lokalnie („tylko trochę wszerz”), rozgałęzienia i magazyn mocniej; przez
// habitat do ramion Y. ŚLUZY habitatu (`sluices`) zatrzymują front na wejściach do habitatu w obie strony —
// użytkownik: „realnie byłyby zabezpieczenia … ale możesz zrobić całą reakcję, zatrzymać ją można jednym patchem”
// (domyślnie bez śluz: pełna reakcja). Habitat zniszczony zapala sieć od środka (ta sama reguła).
// Czysty planista: harmonogram zdarzeń w czasie; wykonanie — src/game/story/storyGame.js (_fuelChain).
// ============================================================

export const FUEL_CHAIN_TUNE = {
  speed: 1100,       // [j/s] front ognia w rurach (cała baza ~12–20 s)
  burstStep: 520,    // [j.] odstęp pęknięć rury wzdłuż pomostu
  sluices: false,    // śluzy habitatu: front staje na wejściach do habitatu
  tapDelay: 0.18     // [s] okręt w stanowisku wybucha chwilę po dojściu frontu do jego zaworu
};
if (typeof window !== 'undefined') window.FuelChainTune = FUEL_CHAIN_TUNE;

/**
 * Harmonogram reakcji z węzła `start` ('P' — zbiorniki, 'H' — habitat). layout — createPirateBaseLayout().
 * opts: { speed, burstStep, sluices, done: Set(id węzłów już wypalonych — pomijane) }.
 * Zwraca { events: [{ t, kind, node, x, z, berth? }] (rosnąco po t), reach: Map(węzeł → czas) }.
 * kind: 'tank' (zbiorniki), 'habitat', 'warehouse', 'junction', 'sluice', 'tap' (zawór stanowiska — okręt), 'burst'
 * (pęknięcie rury).
 */
export function planFuelChain(layout, start = 'P', opts = {}) {
  const T = { ...FUEL_CHAIN_TUNE, ...opts };
  const net = layout.fuel;
  const nodes = net.nodes;
  const done = opts.done || null;
  const sluice = new Set(T.sluices ? net.sluices : []);
  const adj = new Map();
  for (const e of net.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push({ to: e.b, e });
    adj.get(e.b).push({ to: e.a, e });
  }
  // Dijkstra (sieć ma ~60 węzłów — tablica wystarczy)
  const reach = new Map();
  if (!nodes.has(start)) return { events: [], reach };
  const dist = new Map([[start, 0]]);
  const open = [start];
  const stopAt = (id) => sluice.has(id) && id !== start;
  // z habitatu przy śluzach: ogień zostaje w habitacie (śluzy zamknięte od środka)
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const id = open.splice(bi, 1)[0];
    if (reach.has(id)) continue;
    reach.set(id, dist.get(id) / T.speed);
    if (stopAt(id) || (done && done.has(id) && id !== start)) continue;
    if (start === 'H' && id === 'H' && T.sluices) continue;
    for (const { to, e } of adj.get(id) || []) {
      if (reach.has(to)) continue;
      // przez habitat (He — H — Hw) tylko bez śluz
      if (T.sluices && (to === 'H' || id === 'H')) continue;
      const d = dist.get(id) + e.len;
      if (!dist.has(to) || d < dist.get(to)) {
        dist.set(to, d);
        open.push(to);
      }
    }
  }
  const events = [];
  for (const [id, t] of reach) {
    const n = nodes.get(id);
    if (!n) continue;
    if (done && done.has(id) && id !== start) continue;
    const kind = n.kind === 'tap' ? 'tap' : n.kind === 'tank' ? 'tank' : n.kind === 'habitat' ? 'habitat'
      : n.kind === 'warehouse' ? 'warehouse' : n.kind === 'sluice' ? 'sluice' : 'junction';
    const ev = { t: kind === 'tap' ? t + T.tapDelay : t, kind, node: id, x: n.x, z: n.z };
    if (n.berth) ev.berth = n.berth;
    events.push(ev);
  }
  // pęknięcia rur wzdłuż krawędzi (front z obu końców — spotkanie w środku); krawędzie habitatu i krótkie odcinki
  // do zaworów bez pęknięć pośrednich
  for (const e of net.edges) {
    if (!e.pier) continue;
    const ta = reach.get(e.a);
    const tb = reach.get(e.b);
    if (ta === undefined && tb === undefined) continue;
    const A = nodes.get(e.a);
    const B = nodes.get(e.b);
    const n = Math.floor(e.len / T.burstStep);
    for (let k = 0; k < n; k++) {
      const d = (k + 0.5) * (e.len / n);
      const t1 = ta === undefined ? Infinity : ta + d / T.speed;
      const t2 = tb === undefined ? Infinity : tb + (e.len - d) / T.speed;
      // krawędź za zamkniętą śluzą (oba końce poza zasięgiem frontu z tej strony) — bez pęknięć
      const t = Math.min(t1, t2);
      if (!Number.isFinite(t)) continue;
      // odcinek przerwany śluzą: front doszedł tylko do śluzy, nie dalej
      const f = d / e.len;
      events.push({ t, kind: 'burst', node: null, x: A.x + (B.x - A.x) * f, z: A.z + (B.z - A.z) * f });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { events, reach };
}
