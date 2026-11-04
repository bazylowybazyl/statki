// SCENY dema D20 „Zawalenia budowli na szarych blokach” (docs/PLAN-zawalenia-budowli-3d.md, synteza dema § 4) jako CZYSTE
// DANE i sterownik salw / ładunków — bez three i DOM. Importuje je demo (obraz) i Node (scripts/zawalenia-sym.mjs,
// tests/structureCollapse.test.mjs), więc liczby z Node = to, co widzi użytkownik.
//
// Sterownik podaje trafienia w UKŁADZIE ARCHETYPU wieży (x wzdłuż pomostu, y w poprzek, z świata); świat i broń liczy
// gospodarz (collapseLocalToWorld + collapseWeaponHit, J × g/400). Rozrzut trafień z PRNG ziarna salwy (structureRng —
// bez Math.random), ta sama salwa dla każdej wieży sceny (A/B tempa: identyczne strzały w obie).
import { structureRng } from '../../src/game/structureGraph.js';

// Grunt: kula R 10⁶ (płasko — na 1,5 km od środka 1,1 j. niżej), powierzchnia z = 0 nad (0, 0). Teren silnika —
// collapseGroundTerrain; wieża stoi pokładem (A.groundZ, kotwice SECTION) na powierzchni pod swoim początkiem.
export const PODLOZE = Object.freeze({ kind: 'kula', cx: 0, cy: 0, cz: -1e6, R: 1e6, friction: 0.6, armorMul: 3 });

// Strony ostrzału: normalna ściany w układzie archetypu; trafienie na ścianie ±pol, kierunek lotu przeciwny do normalnej.
export const STRONY = Object.freeze({ '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] });

// Rzut W-1 / W-2 (PIRATE_BASE_SPEC.highrise 380 × 420): półosie ścian pasa broni.
const POL_W = Object.freeze([190, 210]);

export const SCENY = Object.freeze({
  1: Object.freeze({
    nr: 1, nazwa: 'A/B tempa',
    opis: 'Dwie identyczne wieże W-1 3 km od siebie — lewa g 400, prawa wolniej. Bateria z +x podcina obie w tych samych chwilach.',
    przewin: 1.5,        // [s] ostrzał pod kurtyną (smugi, odpryski i przechył widać od pierwszej klatki)
    czas: 25,            // [s] pętla pokazu
    podloze: PODLOZE,
    wieze: Object.freeze([
      Object.freeze({ id: 'lewa', ziarno: 5, g: 400, x: -1500, y: 0, yaw: 0 }),
      Object.freeze({ id: 'prawa', ziarno: 5, g: 80, x: 1500, y: 0, yaw: 0, gPanel: Object.freeze([60, 80, 100]) })
    ]),
    // bateria dema (COLLAPSE_WEAPONS.bateria — mocniejsza niż broń gry: test mechaniki, nie balansu)
    bateria: Object.freeze({ strona: '+x', co: 0.2, od: 0, do: 6, bron: 'bateria', ziarno: 11, pas: 70, auto: true })
  }),
  2: Object.freeze({
    nr: 2, nazwa: 'Ostrzał ręczny',
    opis: 'Wieża W-2 i okręt 1,5 km obok. LPM — strzał w kursor (pas ±70), Shift+1/2/3 — broń, strzałki — strona, P — pomost.',
    przewin: 0, czas: 40, podloze: PODLOZE,
    wieze: Object.freeze([Object.freeze({ id: 'w2', ziarno: 2, g: 400, x: 0, y: 0, yaw: 0 })]),
    okret: Object.freeze({ odleglosc: 1500 }),
    bronie: Object.freeze(['dzialo', 'torpeda', 'reaktor']),
    // auto-salwa okrętu (w Node — zastępstwo ręcznego ognia)
    bateria: Object.freeze({ strona: '+x', co: 0.25, od: 0, do: 20, bron: 'dzialo', ziarno: 3, pas: 70, auto: true }),
    pomost: Object.freeze({ strona: '-y' })   // P — zniszcz pomost od −y (D13)
  }),
  3: Object.freeze({
    nr: 3, nazwa: 'Front zgniotu',
    opis: 'Ładunek osłabia kondygnację 13 — góra siada pionowo i zgniata piętra pod sobą do ziemi.',
    przewin: 0.5, czas: 20, podloze: PODLOZE,
    wieze: Object.freeze([Object.freeze({ id: 'w1', ziarno: 5, g: 400, x: 0, y: 0, yaw: 0 })]),
    ladunek: Object.freeze({ kondygnacja: 13, co: 0.25, ile: 0.12, od: 0, do: 4 }),
    kappa: 0.2,
    kappy: Object.freeze([0.1, 0.2, 0.3, 1])
  })
});

export const SCENA_DOMYSLNA = 1;

/**
 * Konfiguracja sceny z nadpisaniami panelu / adresu / narzędzia: { g (prawej wieży w scenie 1, jedynej w 2–3), strona,
 * kappa, bron, ziarno (salwy) }. Zwraca nowy obiekt (wieże z g po nadpisaniu).
 */
export function scenaUstaw(nr, nad = {}) {
  const sc = SCENY[nr];
  if (!sc) throw new RangeError(`scena ${nr}: brak`);
  const wieze = sc.wieze.map((w, i) => {
    const last = i === sc.wieze.length - 1;
    return { ...w, g: Number.isFinite(nad.g) && last ? nad.g : w.g };
  });
  const bateria = sc.bateria ? { ...sc.bateria, strona: nad.strona || sc.bateria.strona, bron: nad.bron || sc.bateria.bron,
    ziarno: Number.isFinite(nad.ziarno) ? nad.ziarno : sc.bateria.ziarno } : null;
  return { ...sc, wieze, bateria, kappa: Number.isFinite(nad.kappa) ? nad.kappa : (sc.kappa ?? null) };
}

/**
 * Sterownik sceny: krok(t, dt, act) — salwy baterii i ładunki w przedziale [t, t + dt) (t = tick · dt, licznik całkowity).
 * act.hit(lx, ly, lz, dx, dy, dz, bron) — trafienie w układzie archetypu (jedno wywołanie na strzał, wołający rozdaje je
 * wieżom), act.charge(kondygnacja, ile) — ładunek. Strzał k w chwili od + k·co (≤ do), ten sam ciąg punktów przy 60 i 120 Hz.
 */
export function createScenaDriver(cfg) {
  const bat = cfg.bateria && cfg.bateria.auto !== false ? cfg.bateria : null;
  const lad = cfg.ladunek || null;
  const rnd = bat ? structureRng(bat.ziarno) : null;
  const st = bat ? STRONY[bat.strona] : null;
  if (bat && !st) throw new RangeError(`strona ${bat.strona}: +x, -x, +y, -y`);
  let k = 0, c = 0;
  return {
    krok(t, dt, act) {
      const t1 = t + dt - 1e-9;
      while (bat && bat.od + k * bat.co < t1 && bat.od + k * bat.co <= bat.do + 1e-9) {
        const u = rnd() * 2 - 1, z = (rnd() * 2 - 1) * bat.pas;
        const lx = st[0] ? st[0] * POL_W[0] : u * (POL_W[0] - 10), ly = st[1] ? st[1] * POL_W[1] : u * (POL_W[1] - 10);
        act.hit(lx, ly, z, -st[0], -st[1], 0, bat.bron);
        k++;
      }
      while (lad && lad.od + c * lad.co < t1 && lad.od + c * lad.co < lad.do - 1e-9) {
        act.charge(lad.kondygnacja, lad.ile);
        c++;
      }
    },
    strzaly() { return k; }
  };
}
