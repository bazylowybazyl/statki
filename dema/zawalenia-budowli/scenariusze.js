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
  }),
  // HABITAT (dema/zawalenia-budowli/habitat.js): dysk mieszkalny = graf E1 (buildDiscArchetype) + pole płyty silnika
  // (src/game/structurePlate.js), wieża H-T = PRAWDZIWA bryła belek z gry (pirateBaseSolidOf 'H-T'; ?ht=klaster — klaster
  // z prostopadłościanów towerPointCloud). Bez bębna i szybu H-C (D14 — ich archetypów jeszcze nie ma), skała = kula-teren
  // `skala.pod` j. pod spodem dysku (w grze ~23 km — tu widać kolejność lądowania, nie czasy E7).
  4: Object.freeze({
    nr: 4, nazwa: 'Habitat: wieża przez dysk',
    opis: 'HP 0: zegar utrzymania 2,5 s, wieża H-T spada (g 260) i przebija dysk otworem w kształcie talerza; wycinki dysku lecą wyraźnie później.',
    habitat: 'upadek', przewin: 0, czas: 18,
    hp0: 0.5,             // [s] HP 0 habitatu — zegar D8 rusza, wieża puszcza
    d8: 2.5,              // [s] utrzymanie 1 → 0 (D8)
    gFall: 260,           // [j/s²] wieża do minięcia dysku (PLATE_TUNE.gFall), potem gPassed
    gPassed: 400,
    kick: 300,            // [j/s] zapadnięcie wieży przy HP 0 (PIRATE_FALL_TUNE.towerKick)
    tumble: 0.006,        // [rad/s] lekki obrót wieży przy puszczeniu (oś x)
    passMargin: 150,      // [j.] wierzch wieży tyle pod spodem dysku = wieża minęła dysk → klaster (D6 zastępczo)
    skala: Object.freeze({ pod: 5000, R: 12000 }),
    podpory: 0.5,         // supportHoldFloor archetypu dysku (podpory SUPPORT przy utrzymaniu 0)
    podporyPanel: Object.freeze([0.5, 0.25, 0]),
    ht: 'belki',
    // D17: kotwica liny windy na bloku pierścienia zewnętrznego (kąt [rad] w układzie dysku) — lina do skały pod nim
    winda: Object.freeze({ kat: -1.2 })
  }),
  5: Object.freeze({
    nr: 5, nazwa: 'Habitat: szyja',
    opis: 'Habitat żyje (utrzymanie 1): wieża przewraca się na przegubie w nasadzie szyi i kładzie bokiem na koronie bębna i dysku — rów bez otworu.',
    habitat: 'szyja', przewin: 0, czas: 18,
    strona: '+x',         // kierunek upadku wieży (świat silnika)
    g: 400,               // grawitacja habitatu (PIRATE_BASE_SOLID.gravity)
    mocniej: 1,           // mnożnik przechyłu startowego (NECK_TUNE.tipSpeed) — „Mocniej ×3” sprawdza R3
    mocniejPanel: Object.freeze([1, 3]),
    korona: true,         // korona bębna — drugie pole płyty bez grafu (pierścień drumR − wall … drumR, floorY … rimTop)
    skala: Object.freeze({ pod: 5000, R: 12000 }),
    podpory: 0.5,
    ht: 'belki',
    winda: Object.freeze({ kat: -1.2 })
  })
});

export const SCENA_DOMYSLNA = 1;

/**
 * Konfiguracja sceny z nadpisaniami panelu / adresu / narzędzia: { g (prawej wieży w scenie 1, jedynej w 2–3), strona,
 * kappa, bron, ziarno (salwy); habitat (4–5): podpory, ht ('belki' | 'klaster'), mocniej }. Zwraca nowy obiekt (wieże z g
 * po nadpisaniu).
 */
export function scenaUstaw(nr, nad = {}) {
  const sc = SCENY[nr];
  if (!sc) throw new RangeError(`scena ${nr}: brak`);
  if (sc.habitat) {
    return {
      ...sc, wieze: [], bateria: null, kappa: null,
      podpory: Number.isFinite(nad.podpory) ? nad.podpory : sc.podpory,
      ht: nad.ht === 'klaster' || nad.ht === 'belki' ? nad.ht : sc.ht,
      mocniej: Number.isFinite(nad.mocniej) ? nad.mocniej : (sc.mocniej ?? 1)
    };
  }
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
