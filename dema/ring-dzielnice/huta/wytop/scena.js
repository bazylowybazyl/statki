// HUTA — wytop: POKŁAD KOMORY (dane instancji zestawu budowli portowych, bez three).
//
// Zestaw portowy rysuje to, co nie świeci żarem i się nie rusza (runda 6: POMOST GÓRNY przy płaszczyźnie gry, x ≤ −420 —
// reszta dawnego pokładu; naczynie z kołnierzem, nośna i hala: `formowanie/otoczenie.js`): płyty pomostu z otworem
// kołnierza i wykopem zatoki taśmy, krawężniki z lampami obrzeża (na kołnierzu naczynia) (te same 32 lampy odbija kula — `kulaTSL.js`; świecą RÓWNO i słabo: sygnał grawitacji
// niesie tylko wyświetlacz na ścianie studni — `wyswietlacz.js`), podstawy i kolektory radiatorów, kabinę wytopu,
// napisy. Wnętrze studni, maszyneria grzewcza, lej i żebra radiatorów są w `wyposazenie.js`.
// Geometria z `geometria.js` (układ komory: x, z w planie; wysokość K-7 = y − (deckY − 116); pokład komory → K-7 116).
import { PB_FX, PB_MAT, newScene, sceneOf, xzTools } from '../../kit/sceny.js';
import { KOMORA } from './geometria.js';

const M = PB_MAT;
const DECK = 116;                 // wysokość K-7 pokładu (płaszczyzna gry)
const TAU = Math.PI * 2;

/** Wierzchołki 32-kąta studni [x, z]. */
export function pitPolygon() {
  const out = [];
  for (let k = 0; k < KOMORA.sides; k++) {
    const a = (k / KOMORA.sides) * TAU;
    out.push([Math.cos(a) * KOMORA.pitR, Math.sin(a) * KOMORA.pitR]);
  }
  return out;
}

/** Zakres x wielokąta wypukłego na prostej z = const (albo null). */
function spanAt(poly, z) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a[1] - z) * (b[1] - z) > 0 || a[1] === b[1]) continue;
    const x = a[0] + (b[0] - a[0]) * ((z - a[1]) / (b[1] - a[1]));
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi >= lo ? [lo, hi] : null;
}

/** Wielokąt krawędzi kołnierza naczynia [x, z] (te same wierzchołki rysuje kołnierz — bez szpary). */
export function flangePolygon() {
  const D = KOMORA.deck;
  const out = [];
  for (let k = 0; k < D.flangeSegs; k++) {
    const a = (k / D.flangeSegs) * TAU;
    out.push([Math.cos(a) * D.flangeR, Math.sin(a) * D.flangeR]);
  }
  return out;
}

/**
 * POMOST GÓRNY (runda 6) jako lista wypukłych czworokątów [[x, z] × 4]: prostokąt pomostu bez kołnierza naczynia
 * (wielokąt `flangePolygon`) i bez zatoki taśmy, pocięty na pasy między kolejnymi wierzchołkami otworu i punktami, w
 * których krawędź kołnierza przecina prawy brzeg pomostu (w pasie brzegi otworu są odcinkami).
 */
export function deckPieces() {
  const D = KOMORA.deck;
  const bay = KOMORA.bay;
  const fl = flangePolygon();
  const bayPoly = [[bay.x0, bay.z0], [bay.xa, bay.z0], [bay.xb, bay.z1], [bay.x0, bay.z1]];
  const zs = new Set([D.z0, D.z1, bay.z0, bay.z1]);
  for (const p of fl) zs.add(Math.round(p[1] * 1e6) / 1e6);
  for (let i = 0; i < fl.length; i++) {
    // przecięcia krawędzi kołnierza z prawym brzegiem pomostu x = x1
    const a = fl[i];
    const b = fl[(i + 1) % fl.length];
    if ((a[0] - D.x1) * (b[0] - D.x1) < 0) zs.add(a[1] + (b[1] - a[1]) * ((D.x1 - a[0]) / (b[0] - a[0])));
  }
  const cut = [...zs].filter((z) => z >= D.z0 && z <= D.z1).sort((a, b) => a - b);
  const pieces = [];
  const E = 1e-4;
  const hole = (z) => {
    const p = spanAt(fl, z);
    const b = spanAt(bayPoly, z);
    if (p && b) return [Math.min(p[0], b[0]), Math.max(p[1], b[1])];
    return p || b;
  };
  for (let i = 0; i + 1 < cut.length; i++) {
    const za = cut[i];
    const zb = cut[i + 1];
    if (zb - za < 1e-3) continue;
    const ha = hole(za + E);
    const hb = hole(zb - E);
    // prawy brzeg pasa: początek otworu, nie dalej niż brzeg pomostu
    const xa = ha ? Math.min(ha[0], D.x1) : D.x1;
    const xb = hb ? Math.min(hb[0], D.x1) : D.x1;
    if (xa > D.x0 + 0.5 || xb > D.x0 + 0.5) pieces.push([[D.x0, za], [Math.max(xa, D.x0), za], [Math.max(xb, D.x0), zb], [D.x0, zb]]);
  }
  return pieces;
}

/**
 * Pokład komory wytopu. `rig.chan` — kanały lamp stanu: 0 taśma jedzie, 1 grzanie, 2 grawitacja włączona (zrzut),
 * 3 generator 0 g pracuje.
 */
export function buildMeltDeckScene(style) {
  const { f, plates, labels, lamps } = newScene();
  const Q = xzTools(f, plates, labels);
  const K = KOMORA;
  const D = K.deck;
  const bay = K.bay;
  // płyty pokładu (grubość 46 j.)
  for (const p of deckPieces()) Q.plate(p, DECK - 46, 46, M.floor);
  // krawężnik studni i lampy obrzeża (32 — na wierzchołkach wielokąta)
  const pit = pitPolygon();
  for (let k = 0; k < pit.length; k++) {
    if (bay.sides.includes(k)) continue;
    const a = pit[k];
    const b = pit[(k + 1) % pit.length];
    const out = 1 + 9 / K.pitR;
    f.beam([a[0] * out, DECK + 7, a[1] * out], [b[0] * out, DECK + 7, b[1] * out], 16, M.yellow, 14);
  }
  for (let k = 0; k < pit.length; k++) {
    // wierzchołki w świetle wykopu zatoki taśmy nie mają krawężnika — bez lampy
    if (bay.sides.includes(k) && bay.sides.includes(k - 1)) continue;
    const a = pit[k];
    const out = 1 + 26 / K.pitR;
    // lampy obrzeża świecą równo (nie krążą: drugi ruchomy sygnał obok wyświetlacza grawitacji myliłby)
    Q.lamp([a[0] * out, a[1] * out], DECK + 9, 13, M.cyan, 0.85);
  }
  // krawężniki wykopu zatoki
  f.beam([bay.x0, DECK + 7, bay.z0 - 9], [bay.xa, DECK + 7, bay.z0 - 9], 16, M.yellow, 14);
  f.beam([bay.x0, DECK + 7, bay.z1 + 9], [bay.xb, DECK + 7, bay.z1 + 9], 16, M.yellow, 14);
  for (let x = bay.x0 + 90; x < bay.xa - 40; x += 180) {
    Q.lamp([x, bay.z0 - 26], DECK + 8, 11, M.warm, 1.15, PB_FX.chase, (x - bay.x0) / 1100, 0.7);
    Q.lamp([x, bay.z1 + 26], DECK + 8, 11, M.warm, 1.15, PB_FX.chase, (x - bay.x0) / 1100, 0.7);
  }
  // radiatory: ciemna wanna pod żebrami; kolektory do rury zbiorczej wzdłuż z (most nad zatoką taśmy), z niej rura
  // do kołnierza naczynia
  const hx = K.radHeaderX;
  let hz0 = Infinity;
  let hz1 = -Infinity;
  for (const [x0, z0, x1, z1] of K.radiators) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    Q.box([cx, cz], DECK + 2.5, x1 - x0, 5, z1 - z0, M.dark);
    Q.box([cx, cz], DECK + 4, x1 - x0 + 14, 3, z1 - z0 + 14, M.rail);
    Q.pipe([x1 + 4, cz], [hx, cz], DECK + 16, 11, M.copper);
    Q.box([hx, cz], DECK + 14, 34, 26, 34, M.steel);
    hz0 = Math.min(hz0, cz);
    hz1 = Math.max(hz1, cz);
  }
  Q.pipe([hx, hz0], [hx, hz1], DECK + 18, 14, M.copper);
  // podpory mostu nad zatoką taśmy
  for (const z of [bay.z0 - 24, bay.z1 + 24]) Q.box([hx, z], DECK + 10, 30, 20, 30, M.steel);
  const fx = -Math.sqrt((K.pitR + 44) ** 2 - K.radHeaderZ ** 2);
  Q.pipe([hx, K.radHeaderZ], [fx, K.radHeaderZ], DECK + 18, 14, M.copper);
  Q.box([fx, K.radHeaderZ], DECK + 14, 40, 28, 40, M.steel);
  // kabina wytopu na pomoście, szyba od strony naczynia
  const cb = K.cabin;
  Q.box([cb.x, cb.z], DECK + 40, cb.w, 80, cb.d, M.steel);
  Q.box([cb.x, cb.z], DECK + 86, cb.w + 12, 12, cb.d + 12, M.pale);
  Q.box([cb.x + cb.w / 2 + 1, cb.z], DECK + 52, 8, 36, cb.d - 40, M.glass);
  f.fx(1.0, PB_FX.steady);
  Q.box([cb.x, cb.z + cb.d / 2 + 1], DECK + 60, cb.w - 60, 6, 5, M.cyan);
  f.nofx();
  Q.lamp([cb.x - 80, cb.z - cb.d / 2 - 10], DECK + 96, 12, M.green, 1.3, PB_FX.fill, 0.5, 1);
  Q.lamp([cb.x - 40, cb.z - cb.d / 2 - 10], DECK + 96, 12, M.warm, 1.3, PB_FX.fill, 0.5, 2);
  // szafy zasilania cewek przy studni (lewa górna ćwiartka)
  for (let k = 0; k < 4; k++) {
    Q.box([-640 - k * 96, -330], DECK + 34, 78, 68, 120, k % 2 ? M.steel : M.dark);
    f.fx(1.1, PB_FX.fill, 0.2 + k * 0.2, 1);
    Q.box([-640 - k * 96, -266], DECK + 46, 50, 8, 4, M.warm);
    f.nofx();
  }
  Q.pipe([-600, -330], [-520, -216], DECK + 20, 13, M.copper);
  Q.pipe([-600, -300], [-540, -180], DECK + 14, 9, M.hose);
  // napisy (pomost górny)
  Q.label('WYTOP · KULA 0 g', [-780, 790], 560, 96, style.labels.clear, 'KOMORA 02');
  Q.label('WSAD', [-880, 410], 260, 70, style.labels.clear, 'RUDA');
  // lampy pomostu (światło zestawu: ciepłe) — przy kabinie i szafach
  lamps.push([cb.x, 70, cb.z + 120, 1]);
  lamps.push([-700, 70, -480, 1]);
  void D;
  return sceneOf(f, plates, labels, lamps, { chan: { belt: 0, heat: 1, grav: 2, zeroG: 3 } });
}
