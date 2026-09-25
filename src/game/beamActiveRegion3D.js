// Obszar aktywny ciała belkowego dla solvera lokalnego (cfg.localSolver).
//
// Aktywny jest węzeł, który dostał trafienie, zgniot, utratę sąsiada albo wciąż
// się rusza; po `activeSettleFrames` krokach spokoju wypada z obszaru. Solver liczy
// tylko ten obszar z pierścieniem sąsiadów, więc ostrzeliwany kadłub nie przelicza
// co krok wszystkich belek. Stan „aktywny” siedzi w magazynie węzłów (`act`,
// `quiet`), więc przeżywa rozpad — lista indeksów odbudowuje się po podmianie magazynu.

export function activeRegion(body) {
  let region = body._region;
  if (region && region.store === body.nodeStore && region.beamStore === body.beamStore) return region;
  const s = body.nodeStore, count = s.count;
  region = body._region = {
    store: s, beamStore: body.beamStore,       // renderer porównuje tożsamość magazynów
    list: [],                                  // indeksy aktywnych węzłów
    solve: new Int32Array(count),              // A ∪ F bieżącego kroku
    outer: new Int32Array(count),              // pierścień O: końce belek poza A ∪ F
    constraints: new Int32Array(Math.max(1, body.beamStore.count)), // belki bieżącego kroku
    constraintCount: 0,
    frontier: new Int32Array(count),           // sąsiedzi F poprzedniego kroku (do zapieczenia)
    frontierCount: 0,
    drift: 0,                                  // |Σ m·Δx| od ostatniego wyrównania środka
    mountLive: -1,                             // stan struktury przy ostatnim przeliczeniu mocowań
    mountActive: -1,
    // Węzły zmienione od ostatniego rysowania (renderer przepisuje tylko ich skórę).
    dirty: new Int32Array(count),
    dirtyCount: 0,
    dirtyAll: true                             // nowy obszar / wyrównany środek: cała skóra
  };
  const active = s.active, act = s.act;
  for (let i = 0; i < count; i++) {
    if (active[i] && act[i]) region.list.push(i);
    else act[i] = 0;
  }
  return region;
}

// Węzeł jako indeks w magazynie ciała; przyjmuje też widok (testy, kod spoza pętli).
const indexOf = (node) => (typeof node === 'number' ? node : node ? node._i : -1);

export function markSkinDirty(body, node) {
  const i = indexOf(node), s = body.nodeStore;
  if (i < 0 || s.skinDirty[i]) return;
  const region = activeRegion(body);
  s.skinDirty[i] = 1;
  region.dirty[region.dirtyCount++] = i;
}

export function activateNode(body, node) {
  const i = indexOf(node), s = body.nodeStore;
  if (i < 0 || !s.active[i]) return;
  const region = activeRegion(body);
  s.quiet[i] = 0;
  body.isSleeping = false;
  // Aktywacja = coś zmieniło węzeł (trafienie, zgniot, utrata sąsiada): skóra do przepisania.
  if (!s.skinDirty[i]) { s.skinDirty[i] = 1; region.dirty[region.dirtyCount++] = i; }
  if (s.act[i]) return;
  s.act[i] = 1;
  region.list.push(i);
}

// Sąsiedzi węzła przez całe belki — tracą oparcie, gdy węzeł ginie lub belka pęka.
export function activateNeighbors(body, node) {
  const i = indexOf(node);
  if (i < 0) return;
  const s = body.nodeStore, e = body.beamStore, adj = s.adj;
  for (let k = s.adjStart[i]; k < s.adjStart[i + 1]; k++) {
    const bi = adj[k];
    if (e.broken[bi]) continue;
    activateNode(body, e.a[bi] === i ? e.b[bi] : e.a[bi]);
  }
}
