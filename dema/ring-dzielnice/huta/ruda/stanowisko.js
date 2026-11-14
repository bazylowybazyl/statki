// HUTA — fizyczna ruda: STANOWISKO RUDY (czysta symulacja: bez three i DOM; ziarno losowości → ten sam przebieg bit w bit).
//
// Każde ziarno ma masę 1/128 t i dokładnie jeden stan:
//   ładownia (krata statku) → ssanie (ciało w ładowni: oderwane dzwonem albo osypane) → rura (ruch 1D po łamanej) →
//   lot (ciało w zasieku: struga z wylotu, odbicia, toczenie, osypania) → zasiek (krata kopca) → taśma (ruch 1D) →
//   do pieca (galeria) → wydane (`take`).
// Liczniki stanów to liczby ziaren w pojemnikach (jedno źródło prawdy); każde przejście zdejmuje ziarno z jednego
// pojemnika i wkłada do drugiego, a miejsce w pojemniku docelowym jest sprawdzane PRZED zdjęciem — ziarno nie ginie
// i nie powstaje poza `loadShip()` (i zapasem startowym). `balance()` = weszło − (jest + wydane) = 0 po każdym kroku.
//
// Dwa tryby tej samej symulacji i tej samej księgi: pełny (ciała: lot, odbicia, toczenie, osypania jako ciała) i
// SZYBKI (bez ciał: ziarno z wylotu osiada w miejscu upadku, niestateczne wierzchy przeskakują do sąsiada regułą) —
// do rozbiegu, długich testów i stanowisk poza kadrem.
//
// Sterownik cyklu jest w środku: statek podchodzi z pełną ładownią, suwnica z dzwonem wybiera pola wężykiem, statek
// odpływa, następny podchodzi, gdy w zasieku jest miejsce; piec woła o wsad (zasuwy pod kopcem → krater → taśma →
// galeria). Strona dema woła tylko `step(dt)`.
//
// SSAWA: osiem zagłębień — dzwon staje nad środkiem pola ładowni, opuszcza się w ładunek (14 ziaren) i kopie LEJ:
// odrywa wierzchnie ziarna w promieniu `pickR`, a prąd ciągnie je PO POWIERZCHNI pod krawędź dzwonu (`ciala.js`);
// zbocza leja osypują się ciałami do środka. Potem DOMIATA pole: ściąga po dnie kopczyki z jego naroży (zasięg `restR`),
// i jedzie nad następne; po ostatnim polu zbiera pojedyncze ziarna. Z gardzieli ziarno wpada do rury i CYKLONU ze
// śluzą: z wylotu wychodzi równa struga `spoutRate`, nadmiar z lawin czeka w cyklonie.
//
// MARTWY ZAPAS: zasuwy leżą na jednej linii pod osią kopca, a dno ma spadek 8° — ruda nie zsuwa się po nim. To, co leży
// pod stożkiem kąta usypu wyprowadzonym z zasuw, nie wypłynie (ok. 60 % kopca: jak w prawdziwej pryzmie z odbiorem
// spod spodu). `reachable()` liczy zapas DOSTĘPNY (nad tym stożkiem); piec woła o wsad tylko wtedy, gdy go starcza.
import { GRAIN, grainHalfMax, oreOf, tonsToGrains, traitFromHash } from './rudy.js';
import { PIPE_POINTS, createStationGeometry } from './geometria.js';
import { REC_WORDS, createGrid, hash2 } from './krata.js';
import { FLAG, SUCK, bodyParams, createBodies } from './ciala.js';

export const TUNE = Object.freeze({
  shipLoad: 360,            // t na statek (46 080 ziaren)
  bunkerCap: 900,           // t — statek podchodzi, gdy zasiek + rura + lot ≤ bunkerCap − shipLoad
  hardCap: 940,             // t — sufit przy przylocie wymuszonym głodem pieca: martwy zapas przekracza bunkerCap − shipLoad
                            // (stroma ruda po długim postoju pieca), piec dobrał resztę dostępnego zapasu. Statek zasypuje
                            // wtedy pusty krater; kopiec 940 t zostaje pod y = 116 (test „sufit zasieku”)
  shipArrive: 12, shipLeave: 11, shipGap: 2,
  spoutRate: 850,           // wydatek śluzy cyklonu = strugi z wylotu [ziaren/s] (6,64 t/s) — to on wyznacza czas rozładunku
  vacRate: 1250,            // największy wydatek ODRYWANIA pod dzwonem [ziaren/s]; maleje, gdy w cyklonie przybywa ziaren
  bufferMax: 1500,          // tyle ziaren czekających w cyklonie zatrzymuje odrywanie (lawiny i tak wpadają do gardzieli)
  gantrySpeed: 200, trolleySpeed: 260, bellDown: 150, bellUp: 220, bellClear: 10,
  creepR: 30,               // resztki: dzwon staje, gdy w tym promieniu od osi leży co najmniej creepN ziaren
  creepN: 28,
  pickR: 62,                // promień odrywania: dzwon (r = 30) ciągnie też spod krawędzi — lej rośnie od środka,
                            // sąsiednie leje (pola 126 × 117 j.) zachodzą na siebie
  plungeHold: 0.35,         // s — tyle dzwon stoi jeszcze w wykopanym leju (zbocza się dosypują), zanim ruszy nad następne pole
  fieldLeft: 24,            // domiatanie pola kończy się, gdy w jego kolumnach zostało mniej ziaren
  restR: 95,                // promień odrywania przy domiataniu pola i zbieraniu resztek: ziarna jadą PO DNIE do dzwonu (bez lotu)
  restWait: 0.9,            // s — tyle dzwon czeka przy resztkach na ziarna w drodze, zanim ruszy do następnych
  suckSpeed: 400,           // prędkość prądu ssania przy gardzieli [j./s]
  suckSwirl: 0.75,          // udział wiru w prądzie (ziarna wchodzą pod dzwon spiralą)
  suckGain: 14,             // jak szybko ziarno przejmuje prędkość prądu [1/s]
  suckReach: 50, captureR: 12,
  liftSmooth: 0.3,          // s — wygładzanie tempa odrywania (dzwon nie przechodzi skokiem od pełnego ssania do zera)
  pipeSpeed: 1400,          // prędkość ziarna w rurze [j./s]
  pipeCap: 8192,             // rura + cyklon (zapas przed śluzą)
  takeRate: 1152,           // odbiór zasuwami [ziaren/s] (9 t/s)
  charge: 90,               // t — porcja wsadu pieca
  furnacePeriod: 21,        // s — piec woła o wsad (90 t co 21 s ≈ dopływ statków jeden za drugim)
  furnaceFirst: 14,
  minStock: 90,             // t zapasu DOSTĘPNEGO (nad martwym — `reachable()`), poniżej którego piec nie woła o wsad
                            // (wartość ponad bunkerCap wyłącza piec całkiem — także wsady niepełne)
  deadAngle: 0,             // stożek martwego zapasu: kąt względem kąta reguły rudy [°] i podniesienie nad dno przy zasuwach [j.]
  deadRise: 4,              //   (z pomiaru odbioru do sucha: przewidywanie 2–10 % poniżej tego, co naprawdę wypływa)
  beltSpeed: 320,           // j./s
  bodiesHold: 3072,
  bodiesBunker: 8192,
  jetReserve: 768,          // miejsca puli zasieku zostawione strudze (osypania i wybicia ich nie zajmują)
  toppleBudget: 40,         // osypań na podkrok w zasieku (maleje, gdy pula się zapełnia)
  toppleHold: 10,           // osypań na podkrok w ładowni (zbocza leja sypią się strużkami przez ~2 s, nie jednym zwałem)
  toppleChecks: 3000,       // sprawdzeń stateczności na podkrok
  substep: 1 / 120,
  fastSubstep: 1 / 60,
  maxStep: 0.25             // dłuższy krok jest przycinany (karta w tle)
});

/** Rodzaje zdarzeń pyłu (pole 4 rekordu zdarzenia). */
export const EVENT = Object.freeze({ IMPACT: 0, SPOUT: 1, BELL: 2, GATE: 3, FURNACE: 4, HOLD: 5 });
/** Rekord ruchomego ziarna dla obrazu: 12 liczb f32 (opis w `ciala.js` `write`); rodzaj: 0 lot, 1 styk, 2 ssanie, 3 rura, 4 taśma. */
export const MOVING_STRIDE = 12;
export const EVENT_STRIDE = 5;
export const SHIP_STATES = Object.freeze(['away', 'approach', 'dock', 'depart']);
/**
 * Układ tablicy `state` migawki (Float64Array): czas [s], numer podkroku, tryb szybki (0 / 1), stan statku (indeks
 * SHIP_STATES), przesunięcie statku po z [j.] (krata ładowni i statek rysują się z nim), liczba statków, czas ostatniego
 * rozładunku [s], z suwnicy, x wózka, wysokość krawędzi dzwonu, ssanie włączone, domiatanie, numer pola ładowni,
 * wydatek odrywania [ziaren/s], wychylenie klapy wylotu [rad], wydatek wylotu [ziaren/s], droga taśmy [j.], taśma
 * jedzie, zamówione ziarna wsadu, zegar pieca [s], liczba wsadów, otwarcie pięciu zasuw 0…1, oś strugi (x, y, z).
 */
export const STATE = Object.freeze({
  time: 0, tick: 1, fast: 2, ship: 3, shipOff: 4, trips: 5, unloadTime: 6, gantryZ: 7, trolleyX: 8, bellY: 9, vacOn: 10, sweep: 11,
  field: 12, vacFlow: 13, spoutYaw: 14, spoutFlow: 15, beltTravel: 16, beltRun: 17, want: 18, furnaceTimer: 19, calls: 20,
  gate0: 21, jetX: 26, jetY: 27, jetZ: 28, size: 29
});
/**
 * Układ tablicy `counters` migawki (liczby ziaren): weszło, ładownia, ssanie, rura, lot, zasiek, taśma, do pieca, wydane,
 * wessane narastająco, zasiek DOSTĘPNY (część zasieku nad martwym zapasem — nie wchodzi do bilansu drugi raz).
 */
export const COUNTER = Object.freeze({ loaded: 0, hold: 1, suction: 2, pipe: 3, air: 4, bunker: 5, belt: 6, furnace: 7, taken: 8, delivered: 9, live: 10, size: 11 });

const AWAY = 0;
const APPROACH = 1;
const DOCK = 2;
const DEPART = 3;
const TAU = 6.283185307179586;
const PREWARM_SLACK = 3;      // o tyle stopni łagodniejsza reguła w rozbiegu trybem szybkim
// rejestry zmiennoprzecinkowe stanowiska (indeksy tablicy `reg`)
const TIME = 0;          // czas symulacji [s]
const ACC = 1;           // reszta czasu do następnego podkroku
const PTRAVEL = 2;       // droga „taśmy czasu” rury (ziarno wychodzi, gdy droga osiągnie jego znacznik)
const PTRAVEL0 = 3;      // ta droga na początku kroku (pozycja poprzednia dla obrazu)
const PLAST = 4;         // znacznik ostatnio wessanego ziarna
const PIPELEN = 5;       // bieżąca długość rury
const YAW = 6;           // wychylenie klapy wylotu [rad]
const FLOW = 7;          // wydatek wylotu [ziaren/s], wygładzony
const GATEACC = 8;       // żetony odbioru zasuwami
const GATEDRY = 9;       // od ilu sekund zasuwy nie mają czego wypuścić mimo zamówienia
const BTRAVEL = 10;      // droga taśmy
const BTRAVEL0 = 11;     // droga taśmy na początku kroku
const FTIMER = 12;       // do następnego wołania pieca [s]
const JX = 13;           // ziarno u wylotu: pozycja i prędkość (wspólne dla trybu pełnego i szybkiego)
const JY = 14;
const JZ = 15;
const JUX = 16;
const JUY = 17;
const JUZ = 18;
const TAUREG = 19;       // wyprzedzenie ziarna u wylotu [s]
const SMX = 20;          // punkt pomiaru powierzchni pod dzwonem
const SMZ = 21;
const EVX = 22;          // zdarzenie pyłu do zgłoszenia: miejsce i siła
const EVY = 23;
const EVZ = 24;
const EVS = 25;
const VGZ = 26;          // odkurzacz: z suwnicy, x wózka, wysokość krawędzi dzwonu
const VTX = 27;
const VBELL = 28;
const VLIFT = 29;        // żetony odrywania (wydatek ssawy)
const VFLOW = 30;        // wydatek odrywania [ziaren/s], wygładzony
const VMVX = 31;         // prędkość wózka i suwnicy [j./s]
const VMVZ = 32;
const SHT = 33;          // statek: czas w stanie, przesunięcie po z, zegar do przylotu
const SHOFF = 34;
const SHTIMER = 35;
const SHUSTART = 36;     // chwila początku rozładunku (−1 po zakończeniu)
const SHUTIME = 37;      // czas ostatniego rozładunku [s]
const VBUD = 38;         // tempo odrywania [ziaren/s], wygładzone (regulacja poziomem cyklonu)
const VWAIT = 39;        // od ilu sekund dzwon stoi w wykopanym leju (nic już nie sięga) / czeka przy resztkach
const VRX = 40;          // resztki: miejsce, nad które jedzie dzwon (x, z)
const VRZ = 41;
const REG_COUNT = 42;
const INV30 = 1 / 1073741824;

/**
 * @param {object} opts
 *   ore — indeks 0…4, id albo obiekt rudy (rudy.js); seed — ziarno losowości
 *   fast — tryb szybki od startu; auto — sterownik statków i pieca (false: tylko `loadShip` / `order` z zewnątrz)
 *   prewarm — rozbieg: zapas startowy w zasieku (trybem szybkim) z kraterem po jednym wsadzie
 *   initialStock — zapas startowy [t] (domyślnie z tabeli rudy)
 *   start — 'dock' (statek pełny stoi przy pirsie; domyślnie) albo 'away'
 *   geometry, tune, body — nadpisania geometrii, `TUNE` i parametrów ciał
 */
export function createOreStation(opts = {}) {
  const ore = oreOf(opts.ore);
  const T = Object.freeze({ ...TUNE, ...(opts.tune || {}) });
  const geo = opts.geometry || createStationGeometry();
  const seed0 = (opts.seed === undefined ? 7 : opts.seed) >>> 0;
  const auto = opts.auto !== false;
  let fast = !!opts.fast;
  const G = 400;
  const hL = GRAIN.layer;
  const a = GRAIN.cell;

  // ------------------------------------------------------------------ losowość
  // Stan zmiennoprzecinkowy symulacji trzymany w tablicach typowanych, nie w zmiennych domknięcia: przypisanie liczby
  // niecałkowitej do zmiennej domknięcia alokuje ją na stercie przy każdym kroku (test „krok nie alokuje”).
  const rng = new Uint32Array(1);
  rng[0] = seed0;
  const reg = new Float64Array(REG_COUNT);   // rejestry: czas, drogi rury i taśmy, wylot, zasuwy, piec, ziarno u wylotu
  /** Losowa liczba całkowita 0 … 2³⁰ − 1 (mała liczba całkowita — zwrot nie alokuje); ułamek: × INV30. */
  const rnd30 = () => {
    const r = (rng[0] + 0x6D2B79F5) >>> 0;
    rng[0] = r;
    let t = r;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 2;
  };

  // ------------------------------------------------------------------ kraty i ciała
  const tanRule = Math.tan(ore.ruleAngle * Math.PI / 180);
  const holdGrid = createGrid({ nx: geo.hold.nx, nz: geo.hold.nz, x0: geo.hold.x0, z0: geo.hold.z0, floor: geo.hold.floorY, wallY: geo.hold.coamingY, maxLayers: 32, salt: 1, tan: tanRule });
  const bunkerGrid = createGrid({ nx: geo.bunker.nx, nz: geo.bunker.nz, x0: geo.bunker.x0, z0: geo.bunker.z0, floor: geo.bunker.floor, wallY: geo.bunker.wallTop, maxLayers: 64, salt: 2, tan: tanRule });

  const EV_CAP = 256;
  const evBuf = new Float32Array(EV_CAP * EVENT_STRIDE);
  // bufor zdarzeń pyłu: ciała piszą uderzenia wprost (siła = prędkość normalna / 500, obcięta do 1)
  const ev = { buf: evBuf, n: 0, cap: EV_CAP, dropped: 0 };
  /** Zgłasza zdarzenie pyłu rodzaju `kind` z rejestrów EVX, EVY, EVZ (miejsce) i EVS (siła 0…1). */
  function pushEvent(kind) {
    if (ev.n >= EV_CAP) { ev.dropped++; return; }
    const o = ev.n * EVENT_STRIDE;
    evBuf[o] = reg[EVX]; evBuf[o + 1] = reg[EVY]; evBuf[o + 2] = reg[EVZ]; evBuf[o + 3] = reg[EVS]; evBuf[o + 4] = kind;
    ev.n++;
  }

  const oreBody = { rest: ore.rest, fric: ore.fric, fricHit: ore.fricHit, settleSpeed: ore.settleSpeed, nudge: ore.nudge, knockSpeed: ore.knockSpeed };
  const parBunker = bodyParams({ ...oreBody, reserve: T.jetReserve, ...(opts.body || {}) });
  const parHold = bodyParams({ ...oreBody, knockSpeed: 1e9, reserve: 16, ...(opts.body || {}) });
  const suck = new Float64Array(SUCK.size);
  suck[SUCK.dInf] = T.pickR + T.suckReach;
  suck[SUCK.speed] = T.suckSpeed;
  suck[SUCK.swirl] = T.suckSwirl;
  suck[SUCK.gain] = T.suckGain;
  suck[SUCK.rCap] = T.captureR;
  suck[SUCK.rNeck] = geo.bell.throatR;
  suck[SUCK.rBell] = geo.bell.r;
  suck[SUCK.hBell] = geo.bell.throatH;
  const holdBodies = createBodies({ cap: T.bodiesHold, grid: holdGrid, par: parHold, events: ev, eventKind: EVENT.HOLD, suck, onCapture });
  const bunkerBodies = createBodies({ cap: T.bodiesBunker, grid: bunkerGrid, par: parBunker, events: ev, eventKind: EVENT.IMPACT });

  // ------------------------------------------------------------------ księga
  const loadG = tonsToGrains(T.shipLoad);
  const capG = tonsToGrains(T.bunkerCap);
  const hardCapG = tonsToGrains(T.hardCap);
  const minStockG = tonsToGrains(T.minStock);
  const partialG = tonsToGrains(4);          // najmniejszy wsad niepełny
  let loaded = 0;           // weszło: zapas startowy + ładunki statków
  let delivered = 0;        // wessane do rury (narastająco)
  let furnace = 0;          // w galerii pieca (czeka na `take`)
  let taken = 0;            // wydane z elementu
  let tick = 0;
  const stats = { lifted: 0, emitted: 0, released: 0, arrived: 0, droppedTime: 0, pipeWait: 0, liftBlocked: 0, substeps: 0 };

  // ------------------------------------------------------------------ rura (ruch 1D, kolejka FIFO)
  const PCAP = T.pipeCap;
  const PMASK = PCAP - 1;
  if (PCAP & PMASK) throw new Error('stanowisko: pipeCap musi być potęgą dwójki');
  const pR = new Float64Array(PCAP);         // droga taśmy czasu, przy której ziarno wyjdzie z wylotu
  const pTrait = new Uint8Array(PCAP);
  const pSeed = new Uint8Array(PCAP);
  let pHead = 0;
  let pCount = 0;
  const pipePts = new Float64Array(PIPE_POINTS * 3);
  const pipeCum = new Float64Array(PIPE_POINTS);
  const pipeIn = new Float64Array(3);
  const pipeGap = T.pipeSpeed / T.spoutRate;   // odstęp ziaren u wylotu w drodze „taśmy czasu” rury
  function updatePipe() {
    pipeIn[0] = reg[VTX]; pipeIn[1] = reg[VBELL]; pipeIn[2] = reg[VGZ];
    geo.pipePath(pipeIn, pipePts, pipeCum);
    reg[PIPELEN] = pipeCum[PIPE_POINTS - 1];
  }
  function pipeAdd(tr) {
    if (pCount >= PCAP) return false;
    const k = (pHead + pCount) & PMASK;
    // CYKLON ze śluzą: ziarna wychodzą w kolejności wejścia i nie gęściej niż `spoutRate` — lawina w ładowni (skok
    // dopływu) czeka w cyklonie, a struga z wylotu zostaje równa; zapas w cyklonie wypełnia przerwy na przejazd dzwonu
    let r = reg[PTRAVEL] + reg[PIPELEN];
    const next = reg[PLAST] + pipeGap;
    if (r < next) r = next;
    reg[PLAST] = r;
    pR[k] = r;
    pTrait[k] = tr;
    pSeed[k] = hash2(delivered, seed0) & 255;
    pCount++;
    delivered++;
    return true;
  }
  /** Ziarno weszło w gardziel (oderwane dzwonem albo z osypiska): do rury; false = rura pełna, ciało zostaje. */
  function onCapture(tr) { return pipeAdd(tr); }

  // ------------------------------------------------------------------ wylot
  const sp0 = ore.spoutSpeed;
  const spreadRad = ore.spoutSpread * Math.PI / 180;
  const swingRad = ore.spoutSwing * Math.PI / 180;
  const tdx = geo.spout.target.x - geo.spout.x;
  const tdz = geo.spout.target.z - geo.spout.z;
  const tDist = Math.sqrt(tdx * tdx + tdz * tdz);
  const hx0 = tdx / tDist;
  const hz0 = tdz / tDist;
  // kąt wyrzutu: struga o prędkości rudy ma spaść w celu (połowienie po kącie)
  const jetRange = (el) => {
    const vh = sp0 * Math.cos(el);
    const v0 = sp0 * Math.sin(el);
    return vh * (v0 + Math.sqrt(v0 * v0 + 2 * G * (geo.spout.y - geo.spout.landY))) / G;
  };
  let elLo = -0.5;
  let elHi = 0.7;
  for (let it = 0; it < 48; it++) { const m = (elLo + elHi) / 2; if (jetRange(m) < tDist) elLo = m; else elHi = m; }
  const jetEl = (elLo + elHi) / 2;
  const cosEl = Math.cos(jetEl);
  const sinEl = Math.sin(jetEl);
  const jd = new Float64Array(3);            // oś strugi
  const je1 = new Float64Array(3);           // poziomo w poprzek
  const je2 = new Float64Array(3);           // w poprzek, w płaszczyźnie pionowej
  function updateSpout() {
    reg[YAW] = swingRad * Math.sin(reg[TIME] * TAU / geo.spout.swingPeriod);
    const c = Math.cos(reg[YAW]);
    const s = Math.sin(reg[YAW]);
    const dx = hx0 * c - hz0 * s;
    const dz = hx0 * s + hz0 * c;
    jd[0] = dx * cosEl; jd[1] = sinEl; jd[2] = dz * cosEl;
    je1[0] = -dz; je1[1] = 0; je1[2] = dx;
    je2[0] = jd[1] * je1[2] - jd[2] * je1[1];
    je2[1] = jd[2] * je1[0] - jd[0] * je1[2];
    je2[2] = jd[0] * je1[1] - jd[1] * je1[0];
  }
  // stan ziarna u wylotu (wspólny dla trybu pełnego i szybkiego — te same losowania)
  function jetState() {
    const sp = sp0 * (0.85 + 0.3 * rnd30() * INV30);
    const ang = spreadRad * Math.sqrt(rnd30() * INV30);
    const az = TAU * rnd30() * INV30;
    const sa = Math.sin(ang);
    const ca = Math.cos(ang);
    const c1 = Math.cos(az) * sa;
    const c2 = Math.sin(az) * sa;
    reg[JUX] = (jd[0] * ca + je1[0] * c1 + je2[0] * c2) * sp;
    reg[JUY] = (jd[1] * ca + je1[1] * c1 + je2[1] * c2) * sp;
    reg[JUZ] = (jd[2] * ca + je1[2] * c1 + je2[2] * c2) * sp;
    const mr = geo.spout.mouthR * Math.sqrt(rnd30() * INV30);
    const ma = TAU * rnd30() * INV30;
    const m1 = Math.cos(ma) * mr;
    const m2 = Math.sin(ma) * mr;
    reg[JX] = geo.spout.x + je1[0] * m1 + je2[0] * m2;
    reg[JY] = geo.spout.y + je1[1] * m1 + je2[1] * m2;
    reg[JZ] = geo.spout.z + je1[2] * m1 + je2[2] * m2;
  }
  const bxmin = bunkerGrid.x0 + 3;
  const bxmax = bunkerGrid.x1 - 3;
  const bzmin = bunkerGrid.z0 + 3;
  const bzmax = bunkerGrid.z1 - 3;
  /** Tryb szybki: ziarno staje w kolumnie c (pełna po sufit → najbliższa z miejscem); stateczność rozlicza `relax`. */
  function depositFast(grid, c, tr) {
    c = grid.findRoom(c);
    if (c < 0) throw new Error('stanowisko: krata pełna po sufit');
    grid.pushHashed(c, tr);
    grid.markNear(c);
  }
  function emitFast(tr) {
    jetState();
    const hm = 1 / 60;
    let x = reg[JX], y = reg[JY], z = reg[JZ];
    const bn = bunkerGrid.n;
    const bl = bunkerGrid.lvl;
    const bf = bunkerGrid.floorY;
    let c = bunkerGrid.colAt(x, z);
    for (let it = 0; it < 900; it++) {
      reg[JUY] -= G * hm;
      x += reg[JUX] * hm; y += reg[JUY] * hm; z += reg[JUZ] * hm;
      if (x < bxmin) x = bxmin; else if (x > bxmax) x = bxmax;
      if (z < bzmin) z = bzmin; else if (z > bzmax) z = bzmax;
      c = bunkerGrid.colAt(x, z);
      if (y <= (bn[c] > 0 ? bl[c] * hL : bf[c]) + 3) break;
    }
    depositFast(bunkerGrid, c, tr);
  }
  /** Ziarno wychodzi z wylotu jako ciało; wyprzedzenie w rejestrze TAUREG (ziarna jednego podkroku nie startują w jednym punkcie). */
  function emitBody(tr) {
    jetState();
    const tau = reg[TAUREG];
    const h = hash2(stats.emitted, seed0 ^ 0x51ED);
    const qa = (h & 255) - 127.5;
    const qb = ((h >>> 8) & 255) - 127.5;
    const qc = ((h >>> 16) & 255) - 127.5;
    const qd = (h >>> 24) - 127.5;
    const k = 1 / Math.sqrt(qa * qa + qb * qb + qc * qc + qd * qd);
    const a = bunkerBodies.arg;
    a[0] = reg[JX] + reg[JUX] * tau;
    a[1] = reg[JY] + reg[JUY] * tau - 0.5 * G * tau * tau;
    a[2] = reg[JZ] + reg[JUZ] * tau;
    a[3] = reg[JUX]; a[4] = reg[JUY] - G * tau; a[5] = reg[JUZ];
    a[6] = qa * k; a[7] = qb * k; a[8] = qc * k; a[9] = qd * k;
    const p = bunkerBodies.spawn(tr, FLAG.FREE);
    if (p >= 0) {
      // koziołkowanie w locie
      bunkerBodies.wx[p] = qa * 0.09;
      bunkerBodies.wy[p] = qb * 0.09;
      bunkerBodies.wz[p] = qc * 0.09;
    }
  }
  function stepPipe(h) {
    reg[PTRAVEL] += T.pipeSpeed * h;
    let out = 0;
    const lim = bunkerBodies.cap - 8;
    while (pCount > 0 && pR[pHead] <= reg[PTRAVEL]) {
      const tr = pTrait[pHead];
      if (fast) emitFast(tr);
      else {
        if (bunkerBodies.count >= lim) { stats.pipeWait++; break; }     // pula pełna: ziarno czeka u wylotu (nadal „rura”)
        reg[TAUREG] = (reg[PTRAVEL] - pR[pHead]) / T.pipeSpeed;
        if (reg[TAUREG] > h) reg[TAUREG] = h;
        emitBody(tr);
      }
      pHead = (pHead + 1) & PMASK;
      pCount--;
      out++;
      stats.emitted++;
      if ((stats.emitted & 31) === 0) { reg[EVX] = geo.spout.x; reg[EVY] = geo.spout.y; reg[EVZ] = geo.spout.z; reg[EVS] = ore.dust; pushEvent(EVENT.SPOUT); }
    }
    if (fast && out > 0) bunkerGrid.relax(1e9);
    reg[FLOW] += (out / h - reg[FLOW]) * Math.min(1, h * 6);
  }

  // ------------------------------------------------------------------ zasuwy i taśma (ruch 1D, komórki jadące z taśmą)
  const NG = geo.gates.count;
  const gateCols = [];
  for (let k = 0; k < NG; k++) {
    const cols = new Int32Array(geo.gates.cells * geo.gates.cells);
    let q = 0;
    for (let dj = 0; dj < geo.gates.cells; dj++) for (let di = 0; di < geo.gates.cells; di++) cols[q++] = (geo.gates.j0 + dj) * bunkerGrid.nx + geo.gates.i0[k] + di;
    gateCols.push(cols);
  }
  const gateOpen = new Float32Array(NG);
  const gateS = Float64Array.from(geo.belt.gateS);
  let want = 0;             // zamówione, jeszcze niewypuszczone ziarna
  let gateTurn = 0;
  const BELT_M = 512;
  const BELT_MASK = BELT_M - 1;
  const SLOTS = geo.belt.slots;
  const beltCell = geo.belt.cell;
  const beltLen = geo.belt.length;
  if (beltLen / beltCell + 4 > BELT_M) throw new Error('stanowisko: taśma dłuższa niż pierścień komórek');
  const bCount = new Uint8Array(BELT_M);
  const bTrait = new Uint8Array(BELT_M * SLOTS);
  let beltCount = 0;
  let beltHead = Math.floor(beltLen / beltCell);     // najdalsza komórka jeszcze na taśmie (indeks w układzie taśmy)
  let beltRun = false;
  // miejsca przekroju taśmy: 9 + 8 + 7 + 6 ziaren w czterech warstwach, od środka na boki
  const slotLat = new Float32Array(SLOTS);
  const slotLay = new Uint8Array(SLOTS);
  {
    let s = 0;
    for (let lay = 0; lay < 6 && s < SLOTS; lay++) {
      const w = 9 - lay;
      for (let q = 0; q < w && s < SLOTS; q++) {
        const off = ((q + 1) >> 1) * (q & 1 ? 1 : -1);          // 0, +1, −1, +2, −2…
        slotLat[s] = off + (w % 2 === 0 ? 0.5 : 0);
        slotLay[s] = lay;
        s++;
      }
    }
  }
  function stepGates(h) {
    const tgt = want > 0 ? 1 : 0;
    const dv = h / 0.4;
    for (let k = 0; k < NG; k++) {
      const d = tgt - gateOpen[k];
      gateOpen[k] += d > dv ? dv : d < -dv ? -dv : d;
    }
    if (want <= 0) { reg[GATEACC] = 0; reg[GATEDRY] = 0; return; }
    reg[GATEACC] += T.takeRate * h;
    const accMax = T.takeRate * h * 2 + 1;
    if (reg[GATEACC] > accMax) reg[GATEACC] = accMax;
    const bn = bunkerGrid.n;
    let any = false;
    while (want > 0 && reg[GATEACC] >= 1) {
      let done = false;
      for (let t = 0; t < NG && !done; t++) {
        const k = gateTurn;
        gateTurn = gateTurn + 1 === NG ? 0 : gateTurn + 1;
        if (gateOpen[k] < 0.9) continue;
        const m = Math.floor((gateS[k] - reg[BTRAVEL]) / beltCell) & BELT_MASK;
        if (bCount[m] >= SLOTS) continue;                       // komórka taśmy pod zasuwą pełna
        const cols = gateCols[k];
        let best = -1;
        let bnn = 0;
        for (let q = 0; q < cols.length; q++) { const c = cols[q]; if (bn[c] > bnn) { bnn = bn[c]; best = c; } }
        if (best < 0) continue;                                 // nad zasuwą pusto
        const tr = bunkerGrid.popBottom(best);
        bTrait[m * SLOTS + bCount[m]] = tr;
        bCount[m]++;
        beltCount++;
        bunkerGrid.markDirty(best);
        want--;
        reg[GATEACC] -= 1;
        stats.released++;
        if ((stats.released & 63) === 0) { reg[EVX] = geo.gates.xs[k]; reg[EVY] = bunkerGrid.lvl[best] * hL; reg[EVZ] = geo.gates.z; reg[EVS] = ore.dust * 0.6; pushEvent(EVENT.GATE); }
        done = true;
        any = true;
      }
      if (!done) break;
    }
    if (any) reg[GATEDRY] = 0; else if (gateOpen[0] >= 0.9) reg[GATEDRY] += h;
    if (fast && any) bunkerGrid.relax(1e9);
  }
  function stepBelt(h) {
    // taśma jedzie, gdy coś wiezie albo zasuwy sypią; przy zamówieniu nad pustym kraterem (zasuwy suche ponad 1 s) staje
    beltRun = beltCount > 0 || (want > 0 && reg[GATEDRY] < 1);
    if (!beltRun) return;
    reg[BTRAVEL] += T.beltSpeed * h;
    while (beltHead * beltCell + reg[BTRAVEL] >= beltLen) {
      const m = beltHead & BELT_MASK;
      const k = bCount[m];
      if (k > 0) {
        furnace += k;
        beltCount -= k;
        bCount[m] = 0;
        stats.arrived += k;
        const g = geo.furnace.gallery;
        reg[EVX] = g[0]; reg[EVY] = g[1]; reg[EVZ] = g[2]; reg[EVS] = ore.dust * 0.5;
        pushEvent(EVENT.FURNACE);
      }
      beltHead--;
    }
    if (beltCount === 0 && !(want > 0 && reg[GATEDRY] < 1)) beltRun = false;      // ostatnie ziarna zjechały: taśma staje
  }

  // ------------------------------------------------------------------ zapas dostępny i piec
  // MARTWY ZAPAS: poziom [warstwy], poniżej którego ziarno kolumny nie wypłynie zasuwami — stożek kąta granicznego
  // reguły wyprowadzony z obrysu zasuw (ściany krateru stoją pod kątem reguły; `deadTan` z pomiaru: odbiór do sucha).
  const deadLvl = new Int16Array(bunkerGrid.N);
  {
    const deadTan = Math.tan((ore.ruleAngle + T.deadAngle) * Math.PI / 180);
    const gh = geo.gates.half;
    for (let c = 0; c < bunkerGrid.N; c++) {
      const i = c % bunkerGrid.nx;
      const x = bunkerGrid.x0 + (i + 0.5) * a;
      const z = bunkerGrid.z0 + ((c - i) / bunkerGrid.nx + 0.5) * a;
      let d = 1e9;
      for (let k = 0; k < geo.gates.count; k++) {
        const ex = Math.abs(x - geo.gates.xs[k]) - gh;
        const ez = Math.abs(z - geo.gates.z) - gh;
        const dx = ex > 0 ? ex : 0;
        const dz = ez > 0 ? ez : 0;
        const q = Math.sqrt(dx * dx + dz * dz);
        if (q < d) d = q;
      }
      const lv = Math.ceil((geo.bunker.floorGate + T.deadRise + deadTan * d) / hL);
      deadLvl[c] = lv > bunkerGrid.base[c] ? lv : bunkerGrid.base[c];
    }
  }
  let liveG = 0;            // zapas dostępny z ostatniego przeliczenia (odświeżany co 1/4 s i przed decyzją pieca)
  /** Zapas DOSTĘPNY zasuwom [ziarna]: część kopca nad stożkiem martwego zapasu (pełny przegląd kraty). */
  function reachable() {
    const bl = bunkerGrid.lvl;
    let sum = 0;
    for (let c = 0; c < deadLvl.length; c++) { const d = bl[c] - deadLvl[c]; if (d > 0) sum += d; }
    liveG = sum;
    return sum;
  }
  reg[FTIMER] = T.furnaceFirst;
  let fCalls = 0;
  function stepFurnace(h) {
    if ((tick & 31) === 0) reachable();
    if (!auto) return;
    reg[FTIMER] -= h;
    // piec woła o wsad tylko wtedy, gdy zasuwy mają skąd brać: zapas DOSTĘPNY, nie cały (martwy nie wypłynie)
    if (reg[FTIMER] <= 0 && want === 0) {
      const live = reachable();
      if (live >= minStockG) {
        want += tonsToGrains(T.charge);
        fCalls++;
        reg[FTIMER] = T.furnacePeriod;
      } else if (live >= partialG && minStockG <= capG && bunkerGrid.count + bunkerBodies.count + pCount > capG - loadG) {
        // zasiek za pełny na statek, a dostępnego zapasu mniej niż wsad: piec dobiera resztę (wsad niepełny) —
        // potem zostaje sam martwy zapas i statek może zasypać pusty krater (`roomForShip`)
        want += live;
        fCalls++;
        reg[FTIMER] = T.furnacePeriod;
      }
    }
  }
  /** Zamówienie wsadu: zasuwy wypuszczą `tons` ton na taśmę. Zwraca liczbę zamówionych ziaren (0 dla liczby niedodatniej albo NaN). */
  function order(tons) {
    if (!(tons > 0)) return 0;
    const k = tonsToGrains(tons);
    if (k > 0) want += k;
    return k > 0 ? k : 0;
  }
  /** Zabiera z galerii pieca do `tons` ton (całe ziarna); zwraca zabraną masę [t] (0 dla liczby niedodatniej albo NaN). */
  function take(tons) {
    if (!(tons > 0)) return 0;
    let k = Math.floor(tons * GRAIN.perTon + 1e-9);
    if (k > furnace) k = furnace;
    if (k <= 0) return 0;
    furnace -= k;
    taken += k;
    return k / GRAIN.perTon;
  }

  // ------------------------------------------------------------------ statek
  const ship = { state: AWAY, trips: 0 };
  reg[SHOFF] = geo.ship.reach;
  let shipSerial = 0;
  const heights = new Uint8Array(holdGrid.N);
  /**
   * Czy zasiek przyjmie statek: zasiek + rura + lot ≤ bunkerCap − ładunek; albo — gdy piec nie ma skąd brać (zapas
   * dostępny poniżej wsadu, nic nie zamówione albo zasuwy suche: w zasieku został martwy zapas) — do `hardCap`: statek
   * zasypuje pusty krater.
   */
  function roomForShip() {
    const inBunker = bunkerGrid.count + bunkerBodies.count + pCount;
    if (inBunker <= capG - loadG) return true;
    return minStockG <= capG && liveG < minStockG && (want === 0 || reg[GATEDRY] > 3) && inBunker + loadG <= hardCapG;
  }
  /**
   * Nowy ładunek w ładowni: 46 080 ziaren w kracie (łagodne pryzmy pól, drobna nierówność, dokładna suma).
   * Zwraca false, gdy ładownia nie jest pusta. Ładunek leży w kracie od razu — w czasie dojazdu rysunek dodaje
   * przesunięcie statku `reg[SHOFF]`.
   */
  function loadShip() {
    if (holdGrid.count !== 0 || holdBodies.count !== 0) return false;
    shipSerial++;
    const N = holdGrid.N;
    const nx = holdGrid.nx;
    const mean = loadG / N;
    const A = 2.6;                                             // garb pola [warstwy]
    const pX = geo.hold.pitchX;
    const pZ = geo.hold.pitchZ;
    const fx0 = geo.hold.x0;
    const fz0 = geo.hold.z0;
    let sum = 0;
    for (let c = 0; c < N; c++) {
      const i = c % nx;
      const j = (c - i) / nx;
      const x = holdGrid.x0 + (i + 0.5) * a;
      const z = holdGrid.z0 + (j + 0.5) * a;
      let u = (x - fx0) / pX;
      let v = (z - fz0) / pZ;
      u = (u - Math.floor(u)) * 2 - 1;
      v = (v - Math.floor(v)) * 2 - 1;
      const bump = Math.cos(u * 1.5707963267948966) * Math.cos(v * 1.5707963267948966);
      const noise = (hash2(c, shipSerial * 31 + seed0) & 1023) / 1023 - 0.5;
      let hgt = Math.round(mean + A * (bump - 0.4053) + noise * 1.2);
      if (hgt < 1) hgt = 1; else if (hgt > holdGrid.LMAX - 4) hgt = holdGrid.LMAX - 4;
      heights[c] = hgt;
      sum += hgt;
    }
    // korekta do dokładnej liczby ziaren: po jednym ziarnie w kolumnach wybieranych krokiem względnie pierwszym z N
    let diff = loadG - sum;
    let c = (hash2(shipSerial, seed0) >>> 0) % N;
    const stride = 2731;
    for (let guard = 0; diff !== 0 && guard < N * 40; guard++) {
      c = (c + stride) % N;
      if (diff > 0) { if (heights[c] < holdGrid.LMAX - 4) { heights[c]++; diff--; } } else if (heights[c] > 1) { heights[c]--; diff++; }
    }
    const tint = ((hash2(shipSerial * 7 + 3, seed0) >>> 0) % 5) - 2;
    for (c = 0; c < N; c++) {
      const hgt = heights[c];
      for (let k = 0; k < hgt; k++) holdGrid.pushHashed(c, traitFromHash(hash2(c * 64 + k, shipSerial * 977 + seed0), tint));
    }
    holdGrid.markAll();
    holdGrid.relax(1e9);                                       // gwarancja: ładunek spełnia regułę stateczności
    loaded += holdGrid.count;
    vac.field = 0;
    vac.wide = false;
    vac.go = false;
    vac.resCol = -1;
    reg[VWAIT] = 0;
    return true;
  }
  /**
   * Wezwanie statku z zewnątrz (sterownik `auto: false`): pełny statek zaczyna podejście, o ile poprzedni odpłynął.
   * Ładownia załadowana wcześniej przez `loadShip()` jest przyjmowana, pusta — ładowana tutaj. Rozładunek i odjazd idą
   * dalej same. Zwraca, czy statek wyruszył.
   */
  function callShip() {
    if (ship.state !== AWAY) return false;
    if (holdGrid.count === 0 && !loadShip()) return false;
    ship.state = APPROACH;
    reg[SHT] = 0;
    ship.trips++;
    return true;
  }
  function stepShip(h) {
    if (ship.state === AWAY) {
      if (!auto) return;
      reg[SHTIMER] -= h;
      if (reg[SHTIMER] <= 0 && roomForShip()) callShip();
    } else if (ship.state === APPROACH) {
      reg[SHT] += h;
      const k = Math.min(1, reg[SHT] / T.shipArrive);
      reg[SHOFF] = geo.ship.reach * (1 - k) * (1 - k);          // wyhamowanie przy pirsie
      if (k >= 1) { ship.state = DOCK; reg[SHOFF] = 0; reg[SHT] = 0; reg[SHUSTART] = reg[TIME]; }
    } else if (ship.state === DOCK) {
      reg[SHT] += h;
      if (holdGrid.count + holdBodies.count === 0) {
        if (reg[SHUSTART] >= 0) { reg[SHUTIME] = reg[TIME] - reg[SHUSTART]; reg[SHUSTART] = -1; }
        if (reg[VBELL] >= geo.bell.parkY - 6) { ship.state = DEPART; reg[SHT] = 0; }
      }
    } else {
      reg[SHT] += h;
      const k = Math.min(1, reg[SHT] / T.shipLeave);
      reg[SHOFF] = geo.ship.reach * k * k;                      // rozpęd od pirsu
      if (k >= 1) { ship.state = AWAY; reg[SHTIMER] = T.shipGap; }
    }
  }

  // ------------------------------------------------------------------ odkurzacz: suwnica, wózek, dzwon
  const fields = geo.hold.fields;
  const NF = fields.length;
  // Praca ssawy: ZAGŁĘBIENIA — dzwon staje nad środkiem kolejnego pola (wężykiem), opuszcza się w ładunek i kopie LEJ
  // (odrywa wierzch w promieniu `pickR`, zbocza osypują się ciałami do środka). Gdy ze środka nic już nie sięga,
  // DOMIATA pole (`vac.wide`): ściąga po dnie kopczyki z naroży TEGO pola (zasięg `restR`, tylko kolumny pola — świeży
  // ładunek sąsiednich pól zostaje na następne zagłębienia), potem jedzie nad następne pole. Po ostatnim polu RESZTKI
  // (`vac.sweep`): pojedyncze ziarna, które odtoczyły się po dnie — dzwon staje przy najbliższym, ciągnie wszystko
  // w promieniu `restR` (ziarna jadą do niego PO DNIE) i czeka na ziarna w drodze, zanim ruszy dalej.
  const vac = { on: false, sweep: false, wide: false, go: false, field: 0, resCol: -1 };
  reg[VGZ] = geo.gantry.park;
  reg[VTX] = geo.trolley.park;
  reg[VBELL] = geo.bell.parkY;
  const selC = new Int32Array(16);
  const selK = new Float64Array(16);
  const hn = holdGrid.n;
  const hl = holdGrid.lvl;
  function fieldEmpty(f) {
    const F = fields[f];
    const nx = holdGrid.nx;
    for (let j = F.j0; j <= F.j1; j++) for (let i = F.i0; i <= F.i1; i++) if (hn[j * nx + i] !== 0) return false;
    return true;
  }
  /** Liczba ziaren w kolumnach pola `f` (najwyżej `stop` — dalej nie liczy). */
  function fieldGrains(f, stop) {
    const F = fields[f];
    const nx = holdGrid.nx;
    let sum = 0;
    for (let j = F.j0; j <= F.j1 && sum < stop; j++) for (let i = F.i0; i <= F.i1; i++) sum += hn[j * nx + i];
    return sum;
  }
  /** Najwyższy poziom wierzchu w promieniu `r` od punktu z rejestrów SMX, SMZ — dzwon trzyma się nad nim. */
  function surfaceMax(r) {
    const x = reg[SMX];
    const z = reg[SMZ];
    const nx = holdGrid.nx;
    const nz = holdGrid.nz;
    let i0 = Math.floor((x - r - holdGrid.x0) / a);
    let i1 = Math.floor((x + r - holdGrid.x0) / a);
    let j0 = Math.floor((z - r - holdGrid.z0) / a);
    let j1 = Math.floor((z + r - holdGrid.z0) / a);
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 >= nx) i1 = nx - 1;
    if (j1 >= nz) j1 = nz - 1;
    const r2 = r * r;
    let best = geo.hold.base;
    for (let j = j0; j <= j1; j++) {
      const dz = holdGrid.z0 + (j + 0.5) * a - z;
      for (let i = i0; i <= i1; i++) {
        const dx = holdGrid.x0 + (i + 0.5) * a - x;
        if (dx * dx + dz * dz > r2) continue;
        const l = hl[j * nx + i];
        if (l > best) best = l;
      }
    }
    return best;
  }
  /** Liczba ziaren w kolumnach w promieniu `r` od punktu z rejestrów SMX, SMZ (najwyżej `stop` — dalej nie liczy). */
  function grainsNear(r, stop) {
    const x = reg[SMX];
    const z = reg[SMZ];
    const nx = holdGrid.nx;
    const nz = holdGrid.nz;
    let i0 = Math.floor((x - r - holdGrid.x0) / a);
    let i1 = Math.floor((x + r - holdGrid.x0) / a);
    let j0 = Math.floor((z - r - holdGrid.z0) / a);
    let j1 = Math.floor((z + r - holdGrid.z0) / a);
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 >= nx) i1 = nx - 1;
    if (j1 >= nz) j1 = nz - 1;
    const r2 = r * r;
    let sum = 0;
    for (let j = j0; j <= j1 && sum < stop; j++) {
      const dz = holdGrid.z0 + (j + 0.5) * a - z;
      for (let i = i0; i <= i1; i++) {
        const dx = holdGrid.x0 + (i + 0.5) * a - x;
        if (dx * dx + dz * dz <= r2) sum += hn[j * nx + i];
      }
    }
    return sum;
  }
  /** Najbliższa niepusta kolumna ładowni (domiatanie resztek); −1, gdy krata pusta. */
  function nearestGrain(x, z) {
    const nx = holdGrid.nx;
    const N = holdGrid.N;
    let best = -1;
    let bd = 1e30;
    for (let c = 0; c < N; c++) {
      if (hn[c] === 0) continue;
      const i = c % nx;
      const dx = holdGrid.x0 + (i + 0.5) * a - x;
      const dz = holdGrid.z0 + ((c - i) / nx + 0.5) * a - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  /**
   * Odrywa do `wantN` wierzchnich ziaren w promieniu `Rp` od osi dzwonu: najbliższe wlotu dzwonu (odległość w trzech
   * wymiarach od środka wlotu). Nad ładunkiem to wierzch pod dzwonem — rośnie lej; gdy pod osią jest już gołe dno,
   * to lico otaczającego zbocza na całej wysokości — zbocze cofa się i osypuje ciałami ku dzwonowi.
   */
  function lift(Rp, wantN, onlyField) {
    const bx = reg[VTX];
    const bz = reg[VGZ];
    const my = reg[VBELL] + 4;               // środek wlotu dzwonu
    if (wantN > 16) wantN = 16;
    const nx = holdGrid.nx;
    const nz = holdGrid.nz;
    let i0 = Math.floor((bx - Rp - holdGrid.x0) / a);
    let i1 = Math.floor((bx + Rp - holdGrid.x0) / a);
    let j0 = Math.floor((bz - Rp - holdGrid.z0) / a);
    let j1 = Math.floor((bz + Rp - holdGrid.z0) / a);
    if (i0 < 0) i0 = 0;
    if (j0 < 0) j0 = 0;
    if (i1 >= nx) i1 = nx - 1;
    if (j1 >= nz) j1 = nz - 1;
    if (onlyField >= 0) {
      // domiatanie: tylko kolumny tego pola
      const F = fields[onlyField];
      if (i0 < F.i0) i0 = F.i0;
      if (i1 > F.i1) i1 = F.i1;
      if (j0 < F.j0) j0 = F.j0;
      if (j1 > F.j1) j1 = F.j1;
    }
    const r2 = Rp * Rp;
    let m = 0;
    for (let j = j0; j <= j1; j++) {
      const dz = holdGrid.z0 + (j + 0.5) * a - bz;
      for (let i = i0; i <= i1; i++) {
        const c = j * nx + i;
        if (hn[c] === 0) continue;
        const dx = holdGrid.x0 + (i + 0.5) * a - bx;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const dy = (hl[c] - 0.5) * hL - my;
        const key = -(d2 + dy * dy);
        if (m === wantN && key <= selK[m - 1]) continue;
        let q = m < wantN ? m++ : m - 1;
        while (q > 0 && selK[q - 1] < key) { selK[q] = selK[q - 1]; selC[q] = selC[q - 1]; q--; }
        selK[q] = key;
        selC[q] = c;
      }
    }
    let got = 0;
    for (let q = 0; q < m; q++) {
      const c = selC[q];
      if (hn[c] === 0) continue;
      if (fast) {
        if (pCount >= PCAP) { stats.liftBlocked++; break; }
        pipeAdd(holdGrid.popTop(c));
        holdGrid.markDirty(c);
      } else {
        if (holdBodies.count >= holdBodies.cap - 4) { stats.liftBlocked++; break; }
        const i = c % nx;
        const cx = holdGrid.x0 + (i + 0.5) * a;
        const cz = holdGrid.z0 + ((c - i) / nx + 0.5) * a;
        const yt = (hl[c] - 0.5) * hL;
        const tr = holdGrid.popTop(c);
        const qv = holdGrid.popQuat;
        const hsh = hash2(stats.lifted, c);
        // start: ku osi dzwonu i lekko po stycznej (zalążek wiru), z małym podskokiem — dalej ziarno sunie po
        // powierzchni w prądzie ssawy i unosi się dopiero pod dzwonem
        const rx = bx - cx;
        const rz = bz - cz;
        const v0 = (70 + (hsh & 63)) / (Math.sqrt(rx * rx + rz * rz) + 6);
        const ha = holdBodies.arg;
        ha[0] = cx; ha[1] = yt + 2; ha[2] = cz;
        ha[3] = (rx * 0.9 - rz * 0.4) * v0; ha[4] = 16 + ((hsh >>> 6) & 15); ha[5] = (rz * 0.9 + rx * 0.4) * v0;
        ha[6] = qv[0]; ha[7] = qv[1]; ha[8] = qv[2]; ha[9] = qv[3];
        holdBodies.spawn(tr, FLAG.FREE | FLAG.LIFT);
        holdGrid.markDirty(c);
      }
      reg[VLIFT] -= 1;
      stats.lifted++;
      got++;
      if ((stats.lifted & 31) === 0) { reg[EVX] = bx; reg[EVY] = reg[VBELL] - 6; reg[EVZ] = bz; reg[EVS] = ore.dust * 0.7; pushEvent(EVENT.BELL); }
    }
    if (fast && got > 0) holdGrid.relax(1e9);
    return got;
  }
  function stepVac(h) {
    const left = holdGrid.count + holdBodies.count;
    const docked = ship.state === DOCK;
    const work = (docked || ship.state === APPROACH) && left > 0;
    // --- cel suwnicy i wózka
    let tz = geo.gantry.park;
    let txv = geo.trolley.park;
    if (work) {
      while (vac.field < NF && docked && fieldEmpty(vac.field)) { vac.field++; vac.wide = false; reg[VWAIT] = 0; }
      if (vac.field < NF) {
        txv = fields[vac.field].x; tz = fields[vac.field].z;
        if (docked) {
          const ex = txv - reg[VTX];
          const ez = tz - reg[VGZ];
          if (ex * ex + ez * ez < 16) {
            reg[SMX] = reg[VTX]; reg[SMZ] = reg[VGZ];
            if (!vac.wide) {
              // nad środkiem pola: dzwon kopie lej, póki z miejsca coś sięga; potem domiata naroża pola
              if (grainsNear(T.pickR - 8, 1) === 0) vac.wide = true;
            } else if (fieldGrains(vac.field, T.fieldLeft) < T.fieldLeft) {
              // pole domiecione (zostały pojedyncze ziarna — zbierze je przejazd po resztki): chwila na ziarna w drodze
              reg[VWAIT] += h;
              if (reg[VWAIT] >= T.plungeHold || holdBodies.count < 24) { vac.field++; vac.wide = false; reg[VWAIT] = 0; }
            } else reg[VWAIT] = 0;
          }
        }
      } else {
        txv = reg[VTX]; tz = reg[VGZ];
        // resztki: dzwon stoi i ściąga po dnie wszystko w zasięgu `restR`, czeka na ziarna w drodze (najwyżej `restWait` s),
        // potem jedzie NAD najbliższe ziarno spoza zasięgu (cel jest miejscem — nie znika, gdy ziarno zostanie zabrane
        // po drodze) i tam staje
        if (vac.go) {
          const ex = reg[VRX] - reg[VTX];
          const ez = reg[VRZ] - reg[VGZ];
          if (ex * ex + ez * ez > 144 && holdGrid.count > 0) { txv = reg[VRX]; tz = reg[VRZ]; } else vac.go = false;
          reg[VWAIT] = 0;
        } else if (holdBodies.count > 6 && reg[VWAIT] < T.restWait) reg[VWAIT] += h;
        else if (holdGrid.count > 0) {
          vac.resCol = nearestGrain(reg[VTX], reg[VGZ]);
          const i = vac.resCol % holdGrid.nx;
          const gx = holdGrid.x0 + (i + 0.5) * a;
          const gz = holdGrid.z0 + ((vac.resCol - i) / holdGrid.nx + 0.5) * a;
          const ex = gx - reg[VTX];
          const ez = gz - reg[VGZ];
          const reach = T.restR - 6;
          if (ex * ex + ez * ez > reach * reach) { vac.go = true; reg[VRX] = gx; reg[VRZ] = gz; }
        }
      }
    }
    const dz = tz - reg[VGZ];
    const dx = txv - reg[VTX];
    // Zbieranie RESZTEK jest jazdą PEŁZAJĄCĄ: dopóki pod dzwonem jest co zbierać, suwnica stoi albo sunie powoli.
    // Przejazd nad środek następnego pola idzie pełną prędkością, ze ssaniem po drodze (dzwon trzyma się nad ładunkiem).
    let creep = 1;
    if (docked && vac.on && vac.field >= NF) {
      reg[SMX] = reg[VTX]; reg[SMZ] = reg[VGZ];
      const near = grainsNear(T.creepR, T.creepN);
      creep = near >= T.creepN ? 0 : 1 - near / T.creepN;
    }
    const mz = T.gantrySpeed * h * creep;
    const mx = T.trolleySpeed * h * creep;
    const sz = Math.abs(dz) <= mz ? dz : dz > 0 ? mz : -mz;
    const sx = Math.abs(dx) <= mx ? dx : dx > 0 ? mx : -mx;
    reg[VGZ] += sz;
    reg[VTX] += sx;
    reg[VMVX] = sx / h;
    reg[VMVZ] = sz / h;
    const bx = reg[VTX];
    const bz = reg[VGZ];
    // --- dzwon: nad powierzchnią pod sobą (i tuż przed sobą w kierunku jazdy)
    let bellTarget = geo.bell.parkY;
    let lowEnough = false;
    const over = bx > holdGrid.x0 - 20 && bx < holdGrid.x1 + 20 && bz > holdGrid.z0 - 20 && bz < holdGrid.z1 + 20;
    if (docked && left > 0 && over) {
      reg[SMX] = bx; reg[SMZ] = bz;
      let top = surfaceMax(geo.bell.r + 3);
      if (reg[VMVX] !== 0 || reg[VMVZ] !== 0) {
        reg[SMX] = bx + reg[VMVX] * 0.15; reg[SMZ] = bz + reg[VMVZ] * 0.15;
        const t2 = surfaceMax(geo.bell.r + 3);
        if (t2 > top) top = t2;
      }
      bellTarget = top * hL + T.bellClear;
      lowEnough = reg[VBELL] <= bellTarget + 14;
    }
    const dy = bellTarget - reg[VBELL];
    const up = T.bellUp * h;
    const dn = T.bellDown * h;
    reg[VBELL] += dy > up ? up : dy < -dn ? -dn : dy;
    updatePipe();
    // --- ssanie
    vac.on = lowEnough;
    suck[SUCK.on] = lowEnough && !fast ? 1 : 0;
    suck[SUCK.x] = bx; suck[SUCK.y] = reg[VBELL] + geo.bell.throatH; suck[SUCK.z] = bz;
    let got = 0;
    if (lowEnough) {
      vac.sweep = vac.field >= NF;
      const Rp = vac.sweep || vac.wide ? T.restR : T.pickR;
      suck[SUCK.dInf] = Rp + T.suckReach;
      // odrywanie reguluje poziom cyklonu: im więcej ziaren czeka na śluzę (także z lawin, które wpadają do gardzieli
      // same), tym mniej dzwon odrywa; w równowadze oderwane + lawiny = wydatek śluzy. Tempo zmienia się płynnie.
      let budget = T.vacRate * (1 - (reg[PLAST] - reg[PTRAVEL] - reg[PIPELEN]) / (pipeGap * T.bufferMax));
      if (budget < 0) budget = 0; else if (budget > T.vacRate) budget = T.vacRate;
      reg[VBUD] += (budget - reg[VBUD]) * Math.min(1, h / T.liftSmooth);
      reg[VLIFT] += reg[VBUD] * h;
      const accMax = T.vacRate * h * 2 + 2;
      if (reg[VLIFT] > accMax) reg[VLIFT] = accMax;
      const wantN = Math.floor(reg[VLIFT]);
      if (wantN > 0) got = lift(Rp, wantN, vac.wide && !vac.sweep ? vac.field : -1);
    } else {
      vac.sweep = false;
      reg[VLIFT] = 0;
      reg[VBUD] = 0;
    }
    reg[VFLOW] += (got / h - reg[VFLOW]) * Math.min(1, h * 6);
  }

  // ------------------------------------------------------------------ krok
  function substep(h) {
    reg[TIME] += h;
    tick++;
    updateSpout();
    stepShip(h);
    stepVac(h);
    if (!fast) {
      holdBodies.substep(h);
      holdBodies.topple(T.toppleHold, 800);
    }
    stepPipe(h);
    stepGates(h);
    if (!fast) {
      bunkerBodies.substep(h);
      let budget = (bunkerBodies.cap - T.jetReserve - bunkerBodies.count) >> 3;
      if (budget > T.toppleBudget) budget = T.toppleBudget;
      if (budget > 0) bunkerBodies.topple(budget, T.toppleChecks);
    }
    stepBelt(h);
    stepFurnace(h);
  }
  /**
   * Krok symulacji o `dt` sekund (dzielony na podkroki 1/120 s, w trybie szybkim 1/60 s; reszta czasu przechodzi
   * do następnego wywołania). Zwraca liczbę wykonanych podkroków.
   */
  function step(dt) {
    if (!(dt > 0)) return 0;
    if (dt > T.maxStep) { stats.droppedTime += dt - T.maxStep; dt = T.maxStep; }
    holdBodies.beginStep();
    bunkerBodies.beginStep();
    reg[PTRAVEL0] = reg[PTRAVEL];
    reg[BTRAVEL0] = reg[BTRAVEL];
    const h = fast ? T.fastSubstep : T.substep;
    reg[ACC] += dt;
    const k = Math.floor(reg[ACC] / h + 1e-7);
    reg[ACC] -= k * h;
    if (reg[ACC] < 0) reg[ACC] = 0;
    for (let s = 0; s < k; s++) substep(h);
    stats.substeps += k;
    return k;
  }
  /** Przełącza tryb szybki; przy wejściu wszystkie ciała osiadają od razu (bilans bez zmian). */
  function setFast(on) {
    on = !!on;
    if (on === fast) return;
    fast = on;
    reg[ACC] = 0;
    if (fast) {
      holdBodies.settleAll();
      holdGrid.relax(1e9);
      bunkerBodies.settleAll();
      bunkerGrid.relax(1e9);
      suck[SUCK.on] = 0;
    }
  }

  // ------------------------------------------------------------------ liczniki
  const C = { loaded: 0, hold: 0, suction: 0, pipe: 0, air: 0, bunker: 0, belt: 0, furnace: 0, taken: 0, delivered: 0, live: 0 };
  /**
   * Liczniki całkowite (ziarna) na stan; ten sam obiekt przy każdym wywołaniu. `live` — zapas DOSTĘPNY zasuwom (część
   * `bunker` nad martwym zapasem; wartość z ostatniego przeliczenia, najwyżej 1/4 s wstecz).
   */
  function counters() {
    C.live = liveG;
    C.loaded = loaded;
    C.hold = holdGrid.count;
    C.suction = holdBodies.count;
    C.pipe = pCount;
    C.air = bunkerBodies.count;
    C.bunker = bunkerGrid.count;
    C.belt = beltCount;
    C.furnace = furnace;
    C.taken = taken;
    C.delivered = delivered;
    return C;
  }
  /** Bilans: weszło − (ładownia + ssanie + rura + lot + zasiek + taśma + do pieca + wydane). Ma być 0. */
  function balance() {
    return loaded - (holdGrid.count + holdBodies.count + pCount + bunkerBodies.count + bunkerGrid.count + beltCount + furnace + taken);
  }
  /** Masa zasieku [t] (krata; odpowiednik `stock[i]` procesu huty) — razem z martwym zapasem. */
  const stock = () => bunkerGrid.count / GRAIN.perTon;
  /** Masa zasieku DOSTĘPNA piecowi [t]: tyle wypłynie zasuwami bez dosypywania (pełny przegląd kraty). */
  const liveStock = () => reachable() / GRAIN.perTon;
  /** Masa w rurze, locie i zasieku [t] (odpowiednik `stock + pipeMass + airMass` w `audit()` huty). */
  const massInside = () => (pCount + bunkerBodies.count + bunkerGrid.count) / GRAIN.perTon;
  const moving = () => holdBodies.count + bunkerBodies.count;

  // ------------------------------------------------------------------ dane dla obrazu
  const segBasis = new Float64Array((PIPE_POINTS - 1) * 9);
  function pipeBasis() {
    for (let s = 0; s < PIPE_POINTS - 1; s++) {
      let tx = pipePts[s * 3 + 3] - pipePts[s * 3];
      let ty = pipePts[s * 3 + 4] - pipePts[s * 3 + 1];
      let tz = pipePts[s * 3 + 5] - pipePts[s * 3 + 2];
      const l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= l; ty /= l; tz /= l;
      // n1 = t × Y (odcinek pionowy: X), n2 = t × n1
      let n1x = -tz;
      let n1y = 0;
      let n1z = tx;
      const nl = Math.sqrt(n1x * n1x + n1z * n1z);
      if (nl < 1e-4) { n1x = 1; n1z = 0; } else { n1x /= nl; n1z /= nl; }
      const o = s * 9;
      segBasis[o] = tx; segBasis[o + 1] = ty; segBasis[o + 2] = tz;
      segBasis[o + 3] = n1x; segBasis[o + 4] = n1y; segBasis[o + 5] = n1z;
      segBasis[o + 6] = ty * n1z - tz * n1y; segBasis[o + 7] = tz * n1x - tx * n1z; segBasis[o + 8] = tx * n1y - ty * n1x;
    }
  }
  const windows = geo.pipe.windows;
  function inWindow(seg, dist) {
    for (let w = 0; w < windows.length; w++) { const W = windows[w]; if (W.seg === seg && dist >= W.from && dist <= W.to) return true; }
    return false;
  }
  // STRUGA W ŚWIETLE RURY: promień strugi na odcinku = światło narysowanej rury − największa bryłka rudy − 1 j.
  // (ziarno w oknie nie wychodzi poza rurę ani poza pręty klatki). Odcinki nad pokładem (y > 116) rysunek ściska
  // w pionie × 0,42 razem ze środkiem ziarna, ale bryłki nie — składowa pionowa przesunięcia ma tam własną granicę.
  const pipeLat = new Float64Array(PIPE_POINTS - 1);
  const pipeVk = new Float64Array(PIPE_POINTS - 1);
  {
    const gmax = grainHalfMax(ore);
    for (let s = 0; s < PIPE_POINTS - 1; s++) {
      const light = geo.pipe.light[s];
      let lat = light - gmax - 1;
      if (lat > 24) lat = 24; else if (lat < 1) lat = 1;
      let vert = (0.42 * light - 1.6 - gmax) / 0.42;
      if (vert > lat) vert = lat; else if (vert < 1) vert = 1;
      pipeLat[s] = lat;
      pipeVk[s] = vert / lat;
    }
  }
  const pipeP = new Float64Array(4);         // punkt ziarna (0–2) i droga od wylotu na wejściu (3)
  /**
   * Punkt ziarna o ziarnie przekroju `sd` na drodze `pipeP[3]` od wylotu → `pipeP[0…2]`; zwraca numer odcinka.
   * `seg` ≥ 0 wymusza odcinek (punkt na przedłużeniu jego osi — pozycja z początku kroku nie skacze na kolanie rury).
   * Droga wchodzi przez tablicę: argument ułamkowy niewklejonej funkcji alokuje liczbę na stercie.
   */
  function pipePoint(sd, seg) {
    const r = pipeP[3];
    let s = seg;
    if (s < 0) { s = 0; while (s < PIPE_POINTS - 2 && pipeCum[s + 1] < r) s++; }
    const along = r - pipeCum[s];
    const rad = (0.25 + 0.75 * (sd & 15) / 15) * pipeLat[s];
    const ph = (sd >>> 4) * 0.39269908169872414 + r * 0.021;
    const cp = Math.cos(ph) * rad;
    const sp = Math.sin(ph) * rad;
    const o = s * 9;
    pipeP[0] = pipePts[s * 3] + segBasis[o] * along + segBasis[o + 3] * cp + segBasis[o + 6] * sp;
    pipeP[1] = pipePts[s * 3 + 1] + segBasis[o + 1] * along + (segBasis[o + 4] * cp + segBasis[o + 7] * sp) * pipeVk[s];
    pipeP[2] = pipePts[s * 3 + 2] + segBasis[o + 2] * along + segBasis[o + 5] * cp + segBasis[o + 8] * sp;
    return s;
  }
  /**
   * Ziarna w rurze: rekordy 12 × f32 jak ciała (rodzaj 3). `onlyWindows` — tylko ziarna w odcinkach oszklonych /
   * klatkowych. Pozycja „z początku kroku” to ten sam punkt przekroju cofnięty o drogę kroku po osi tego samego
   * odcinka, z fazą wiru dla tamtej drogi — przy obrazie szybszym niż krok ziarno jedzie spiralą płynnie, bez skoku
   * w poprzek na granicy kroków.
   * Zwraca liczbę zapisanych ziaren.
   */
  function writePipe(out, at, onlyWindows) {
    pipeBasis();
    let w = at * MOVING_STRIDE;
    const lim = out.length - MOVING_STRIDE;
    const back = reg[PTRAVEL] - reg[PTRAVEL0];
    const len = reg[PIPELEN];
    let k = 0;
    for (let q = 0; q < pCount && w <= lim; q++) {
      const idx = (pHead + q) & PMASK;
      let r = pR[idx] - reg[PTRAVEL];
      if (r < 0) r = 0; else if (r > len) r = len;
      const sd = pSeed[idx];
      pipeP[3] = r;
      const s = pipePoint(sd, -1);
      if (onlyWindows && !inWindow(s, r - pipeCum[s])) continue;
      out[w] = pipeP[0]; out[w + 1] = pipeP[1]; out[w + 2] = pipeP[2];
      pipeP[3] = r + back;
      pipePoint(sd, s);
      out[w + 3] = pipeP[0]; out[w + 4] = pipeP[1]; out[w + 5] = pipeP[2];
      const ang = r * 0.07 + sd;
      const sn = Math.sin(ang);
      const ax = ((sd * 37) & 255) / 127.5 - 1;
      const ay = ((sd * 91) & 255) / 127.5 - 1;
      const az = ((sd * 173) & 255) / 127.5 - 1;
      const al = sn / (Math.sqrt(ax * ax + ay * ay + az * az) || 1);
      out[w + 6] = ax * al; out[w + 7] = ay * al; out[w + 8] = az * al; out[w + 9] = Math.cos(ang);
      out[w + 10] = pTrait[idx];
      out[w + 11] = 3;
      w += MOVING_STRIDE;
      k++;
    }
    return k;
  }
  // taśma: punkt i osie odcinka
  const bp = geo.belt.pts;
  const incLen = geo.belt.len1;
  const incTy = (bp[2][1] - bp[1][1]) / incLen;
  const incTz = (bp[2][2] - bp[1][2]) / incLen;
  /**
   * Ziarna na taśmie: rekordy 12 × f32 (rodzaj 4). Ziarno leży w przekroju taśmy (do 9 w rzędzie, 4 warstwy) i jedzie
   * z komórką taśmy. Zwraca liczbę zapisanych ziaren.
   */
  function writeBelt(out, at) {
    let w = at * MOVING_STRIDE;
    const lim = out.length - MOVING_STRIDE;
    const back = reg[BTRAVEL] - reg[BTRAVEL0];
    const len0 = geo.belt.len0;
    let k = 0;
    const jLow = Math.ceil(-reg[BTRAVEL] / beltCell);
    for (let J = beltHead; J >= jLow; J--) {
      const m = J & BELT_MASK;
      const cnt = bCount[m];
      if (cnt === 0) continue;
      const sBase = J * beltCell + reg[BTRAVEL] + beltCell * 0.5;
      for (let i = 0; i < cnt && w <= lim; i++) {
        const tr = bTrait[m * SLOTS + i];
        const hsh = hash2(J * 32 + i, tr);
        const s = sBase + ((hsh & 255) / 255 - 0.5) * 2.4;
        const lat = slotLat[i] * a + (((hsh >>> 8) & 255) / 255 - 0.5) * 1.6;
        const hgt = 3 + slotLay[i] * hL;
        // pozycja poprzednia: wstecz po osi TEGO SAMEGO odcinka (na przesypie ziarno nie rysuje smugi przez róg)
        if (s <= len0) {
          const x = bp[0][0] - (s < 0 ? 0 : s);
          out[w] = x; out[w + 1] = bp[0][1] + hgt; out[w + 2] = bp[0][2] + lat;
          out[w + 3] = x + back; out[w + 4] = out[w + 1]; out[w + 5] = out[w + 2];
        } else {
          const d = s - len0 > incLen ? incLen : s - len0;
          // normalna pochylni: (0, −tz, ty) (w górę i ku zasiekowi)
          out[w] = bp[1][0] + lat; out[w + 1] = bp[1][1] + incTy * d - incTz * hgt; out[w + 2] = bp[1][2] + incTz * d + incTy * hgt;
          out[w + 3] = out[w]; out[w + 4] = out[w + 1] - incTy * back; out[w + 5] = out[w + 2] - incTz * back;
        }
        const qa = ((hsh >>> 16) & 255) - 127.5;
        const qb = (hsh >>> 24) - 127.5;
        const qc = ((hsh >>> 4) & 255) - 127.5;
        const qd = ((hsh >>> 12) & 255) - 127.5;
        const ql = 1 / Math.sqrt(qa * qa + qb * qb + qc * qc + qd * qd);
        out[w + 6] = qa * ql; out[w + 7] = qb * ql; out[w + 8] = qc * ql; out[w + 9] = qd * ql;
        out[w + 10] = tr;
        out[w + 11] = 4;
        w += MOVING_STRIDE;
        k++;
      }
    }
    return k;
  }
  /** Zdarzenia pyłu od ostatniego wywołania: 5 × f32 (x, y, z, siła 0…1, rodzaj EVENT). Zwraca ich liczbę i czyści bufor. */
  function drainEvents(out) {
    const k = Math.min(ev.n, Math.floor(out.length / EVENT_STRIDE));
    for (let i = 0; i < k * EVENT_STRIDE; i++) out[i] = evBuf[i];
    ev.n = 0;
    return k;
  }
  /**
   * Pusta migawka do wielokrotnego użycia (bufory na największy możliwy stan):
   *   moving — rekordy 12 × f32 ruchomych ziaren po kolei: ciała ładowni (nHold), ciała zasieku (nBunker), ziarna
   *            w rurze (nPipe), ziarna na taśmie (nBelt);
   *   events / nEvents — zdarzenia pyłu (5 × f32); state, counters — układ STATE i COUNTER;
   *   hold, bunker — zmiany krat: `all` = cała krata (wtedy `rec` to rekordy wszystkich kolumn po kolei), inaczej
   *            `count` kolumn o indeksach `cols[i]` i rekordach `rec[i × 8 … i × 8 + 7]`.
   */
  function createSnapshot() {
    const beltCap = (Math.ceil(beltLen / beltCell) + 2) * SLOTS;
    const gridPart = (g) => ({ all: false, count: 0, cols: new Int32Array(g.N), rec: new Uint32Array(g.N * REC_WORDS) });
    return {
      moving: new Float32Array((T.bodiesHold + T.bodiesBunker + PCAP + beltCap) * MOVING_STRIDE),
      nHold: 0, nBunker: 0, nPipe: 0, nBelt: 0,
      events: new Float32Array(EV_CAP * EVENT_STRIDE), nEvents: 0,
      state: new Float64Array(STATE.size), counters: new Float64Array(COUNTER.size),
      hold: gridPart(holdGrid), bunker: gridPart(bunkerGrid)
    };
  }
  function snapGrid(g, part) {
    const k = g.flushRender();
    if (k < 0) { part.all = true; part.count = g.N; part.rec.set(g.rec); return; }
    part.all = false;
    part.count = k;
    const list = g.packList;
    const src = g.rec;
    const dst = part.rec;
    for (let q = 0; q < k; q++) {
      const c = list[q];
      part.cols[q] = c;
      const so = c * REC_WORDS;
      const dq = q * REC_WORDS;
      dst[dq] = src[so]; dst[dq + 1] = src[so + 1]; dst[dq + 2] = src[so + 2]; dst[dq + 3] = src[so + 3];
      dst[dq + 4] = src[so + 4]; dst[dq + 5] = src[so + 5]; dst[dq + 6] = src[so + 6]; dst[dq + 7] = src[so + 7];
    }
  }
  /**
   * MIGAWKA dla obrazu: wypełnia `snap` (z `createSnapshot()`) całym stanem do narysowania klatki — ruchome ziarna
   * (ciała z pozycją bieżącą i z początku kroku, rura, taśma), zmienione kolumny obu krat (z cieniowaniem), zdarzenia
   * pyłu od poprzedniej migawki, stan maszyn i liczniki. `pipeWindows` — z rury tylko ziarna w oknach. Zwraca `snap`.
   */
  function snapshot(snap, pipeWindows) {
    const m = snap.moving;
    snap.nHold = holdBodies.write(m, 0);
    snap.nBunker = bunkerBodies.write(m, snap.nHold);
    snap.nPipe = writePipe(m, snap.nHold + snap.nBunker, pipeWindows !== false);
    snap.nBelt = writeBelt(m, snap.nHold + snap.nBunker + snap.nPipe);
    snap.nEvents = drainEvents(snap.events);
    snapGrid(holdGrid, snap.hold);
    snapGrid(bunkerGrid, snap.bunker);
    const st = snap.state;
    st[STATE.time] = reg[TIME]; st[STATE.tick] = tick; st[STATE.fast] = fast ? 1 : 0;
    st[STATE.ship] = ship.state; st[STATE.shipOff] = reg[SHOFF]; st[STATE.trips] = ship.trips; st[STATE.unloadTime] = reg[SHUTIME];
    st[STATE.gantryZ] = reg[VGZ]; st[STATE.trolleyX] = reg[VTX]; st[STATE.bellY] = reg[VBELL];
    st[STATE.vacOn] = vac.on ? 1 : 0; st[STATE.sweep] = vac.sweep ? 1 : 0; st[STATE.field] = vac.field; st[STATE.vacFlow] = reg[VFLOW];
    st[STATE.spoutYaw] = reg[YAW]; st[STATE.spoutFlow] = reg[FLOW];
    st[STATE.beltTravel] = reg[BTRAVEL]; st[STATE.beltRun] = beltRun ? 1 : 0;
    st[STATE.want] = want; st[STATE.furnaceTimer] = reg[FTIMER]; st[STATE.calls] = fCalls;
    for (let k = 0; k < NG; k++) st[STATE.gate0 + k] = gateOpen[k];
    st[STATE.jetX] = jd[0]; st[STATE.jetY] = jd[1]; st[STATE.jetZ] = jd[2];
    const cn = snap.counters;
    cn[COUNTER.loaded] = loaded; cn[COUNTER.hold] = holdGrid.count; cn[COUNTER.suction] = holdBodies.count; cn[COUNTER.pipe] = pCount;
    cn[COUNTER.air] = bunkerBodies.count; cn[COUNTER.bunker] = bunkerGrid.count; cn[COUNTER.belt] = beltCount;
    cn[COUNTER.furnace] = furnace; cn[COUNTER.taken] = taken; cn[COUNTER.delivered] = delivered; cn[COUNTER.live] = liveG;
    return snap;
  }
  /** Kierunek ku słońcu (układ stanowiska) dla cienia własnego obu krat. */
  function setSun(x, y, z) { holdGrid.setSun(x, y, z); bunkerGrid.setSun(x, y, z); }

  const S = {
    time: 0, tick: 0, fast: false, ore: ore.index,
    ship: { state: 'away', code: 0, off: 0, t: 0, trips: 0, unloadTime: 0 },
    vac: { gz: 0, tx: 0, bellY: 0, on: false, sweep: false, field: 0, flow: 0, throatY: 0 },
    spout: { yaw: 0, flow: 0, dir: jd },
    gates: gateOpen,
    belt: { travel: 0, run: false },
    furnace: { want: 0, timer: 0, calls: 0, dry: 0, live: 0 }
  };
  /**
   * Stan maszyn dla obrazu (ten sam obiekt przy każdym wywołaniu): statek (`off` — przesunięcie po z; krata ładowni
   * i statek rysują się z tym przesunięciem), suwnica `gz`, wózek `tx`, krawędź dzwonu `bellY`, zasuwy 0…1, wylot.
   */
  function state() {
    S.time = reg[TIME]; S.tick = tick; S.fast = fast;
    S.ship.state = SHIP_STATES[ship.state]; S.ship.code = ship.state; S.ship.off = reg[SHOFF]; S.ship.t = reg[SHT]; S.ship.trips = ship.trips; S.ship.unloadTime = reg[SHUTIME];
    S.vac.gz = reg[VGZ]; S.vac.tx = reg[VTX]; S.vac.bellY = reg[VBELL]; S.vac.on = vac.on; S.vac.sweep = vac.sweep; S.vac.field = vac.field; S.vac.flow = reg[VFLOW]; S.vac.throatY = reg[VBELL] + geo.bell.throatH;
    S.spout.yaw = reg[YAW]; S.spout.flow = reg[FLOW];
    S.belt.travel = reg[BTRAVEL]; S.belt.run = beltRun;
    S.furnace.want = want; S.furnace.timer = reg[FTIMER]; S.furnace.calls = fCalls; S.furnace.dry = reg[GATEDRY]; S.furnace.live = liveG;
    return S;
  }

  // ------------------------------------------------------------------ skrót stanu (powtarzalność)
  const u32 = (fa) => new Uint32Array(fa.buffer, fa.byteOffset, fa.byteLength >> 2);
  const viewsOf = (b) => [b.px, b.py, b.pz, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz, b.q0, b.q1, b.q2, b.q3].map(u32);
  const hv = viewsOf(holdBodies);
  const bv = viewsOf(bunkerBodies);
  const regBits = u32(reg);
  const gateBits = u32(gateOpen);
  const pipeBits = u32(pR);
  /**
   * Skrót stanu symulacji (FNV-1a, 32 bity): liczniki, losowość, WSZYSTKIE rejestry zmiennoprzecinkowe (bit w bit),
   * statek, ssawa, zasuwy, obie kraty (wysokości, cechy ziaren w stosach, zdjęte z dołu, przesunięcia i obroty
   * wierzchnich ziaren), ciała (pozycje, prędkości, obroty, cechy, flagi, wiek), rura (cechy, ziarna przekroju, drogi),
   * taśma (komórki z cechami). Poza skrótem zostają tylko pola pomocnicze ciał bez wpływu na obraz w tej chwili
   * (liczniki spoczynku i rozpędu) — wpływają na dalszy przebieg, więc rozjazd wychodzi w kolejnym skrócie.
   */
  function hash() {
    let h = 2166136261;
    const mix = (v) => { h = Math.imul(h ^ (v >>> 0), 16777619); };
    mix(tick); mix(rng[0]); mix(loaded); mix(delivered); mix(furnace); mix(taken); mix(pCount); mix(pHead); mix(beltCount); mix(beltHead); mix(want);
    mix(ship.state); mix(ship.trips); mix(shipSerial); mix(gateTurn); mix(fCalls);
    mix(vac.field); mix(vac.resCol); mix((vac.on ? 1 : 0) | (vac.sweep ? 2 : 0) | (beltRun ? 4 : 0) | (fast ? 8 : 0) | (vac.wide ? 16 : 0) | (vac.go ? 32 : 0));
    for (let q = 0; q < regBits.length; q++) mix(regBits[q]);
    for (let q = 0; q < gateBits.length; q++) mix(gateBits[q]);
    for (const g of [holdGrid, bunkerGrid]) {
      mix(g.count);
      const nn = g.n;
      const LM = g.LMAX;
      for (let c = 0; c < g.N; c++) {
        const k = nn[c];
        if (k === 0) continue;
        mix(c * 131 + k);
        mix(g.drop[c]);
        const b0 = g.bot[c];
        for (let q = 0; q < k; q++) mix(g.stack[c * LM + ((b0 + q) & (LM - 1))]);
        for (let q = 0; q < 9; q++) mix(g.topOff[c * 9 + q]);
        for (let q = 0; q < 12; q++) mix(g.topQuat[c * 12 + q]);
      }
    }
    const bodies = [holdBodies, bunkerBodies];
    const views = [hv, bv];
    for (let s = 0; s < 2; s++) {
      const B = bodies[s];
      const cnt = B.count;
      mix(cnt);
      for (let p = 0; p < cnt; p++) {
        for (let q = 0; q < 13; q++) mix(views[s][q][p]);
        mix(B.trait[p] | (B.flags[p] << 8) | (B.age[p] << 16));
      }
    }
    for (let q = 0; q < pCount; q++) { const idx = (pHead + q) & PMASK; mix(pTrait[idx] | (pSeed[idx] << 8)); mix(pipeBits[idx * 2]); mix(pipeBits[idx * 2 + 1]); }
    for (let m = 0; m < BELT_M; m++) {
      const k = bCount[m];
      if (k === 0) continue;
      mix(m * 37 + k);
      for (let q = 0; q < k; q++) mix(bTrait[m * SLOTS + q]);
    }
    return h >>> 0;
  }

  // ------------------------------------------------------------------ rozbieg i stan startowy
  function prewarm(stockT) {
    const stockG = tonsToGrains(stockT);
    if (stockG <= 0) return;
    const wasFast = fast;
    fast = true;
    // kopiec z rozbiegu ma kąt jak usypany ciałami (nieco poniżej granicy reguły) — inaczej pierwsza struga
    // zaczynałaby od lawiny na całym stoku
    bunkerGrid.setRule(Math.tan((ore.ruleAngle - PREWARM_SLACK) * Math.PI / 180));
    const chargeG = Math.min(tonsToGrains(T.charge), stockG >> 1);
    const total = stockG + chargeG;
    // zasyp przez wylot w tempie ssawy (klapa wylotu waha się jak w pracy); odcień zmienia się co „statek”
    for (let i = 0; i < total; i++) {
      reg[TIME] += 1 / T.spoutRate;
      if ((i & 15) === 0) updateSpout();
      const batch = (i / loadG) | 0;
      const tint = ((hash2(batch * 7 + 11, seed0) >>> 0) % 5) - 2;
      emitFast(traitFromHash(hash2(i, seed0 ^ 0xA5A5), tint));
      if ((i & 63) === 63) bunkerGrid.relax(1e9);
    }
    bunkerGrid.relax(1e9);
    loaded += total;
    // jeden wsad pieca: krater nad zasuwami (to, co dojechało do galerii, jest od razu wydane)
    want += chargeG;
    const h = T.fastSubstep;
    for (let s = 0; s < 3600 && (want > 0 || beltCount > 0); s++) {
      stepGates(h);
      stepBelt(h);
      if (reg[GATEDRY] > 2) { want = 0; }
    }
    want = 0;
    for (let k = 0; k < NG; k++) gateOpen[k] = 0;
    bunkerGrid.setRule(tanRule);
    taken += furnace;
    furnace = 0;
    reg[TIME] = 0;
    reg[GATEDRY] = 0;
    reg[GATEACC] = 0;
    stats.released = 0; stats.arrived = 0; stats.emitted = 0;
    ev.n = 0; ev.dropped = 0;
    fast = wasFast;
  }

  updateSpout();
  updatePipe();
  if (opts.prewarm !== false) prewarm(opts.initialStock === undefined ? ore.initialStock : opts.initialStock);
  if ((opts.start || 'dock') === 'dock') {
    loadShip();
    ship.state = DOCK;
    reg[SHOFF] = 0;
    ship.trips = 1;
    reg[SHUSTART] = 0;
    reg[VGZ] = fields[0].z;
    reg[VTX] = fields[0].x;
  } else {
    reg[SHTIMER] = opts.shipDelay === undefined ? 0 : opts.shipDelay;
  }
  updateSpout();
  updatePipe();
  reachable();                       // licznik zapasu dostępnego od pierwszej migawki

  return {
    ore, geo, TUNE: T, seed: seed0,
    grids: { hold: holdGrid, bunker: bunkerGrid },
    bodies: { hold: holdBodies, bunker: bunkerBodies },
    stats,
    get fast() { return fast; },
    get time() { return reg[TIME]; },
    get tick() { return tick; },
    get shipState() { return SHIP_STATES[ship.state]; },
    get unloadTime() { return reg[SHUTIME]; },
    get eventsDropped() { return ev.dropped; },
    loadShip, callShip, roomForShip, step, setFast, order, take,
    counters, balance, stock, liveStock, reachable, massInside, moving,
    state, setSun, writePipe, writeBelt, drainEvents, createSnapshot, snapshot, hash,
    /** Punkty rury (9 × xyz od wylotu do gardzieli) i droga od wylotu do punktu k — dla rysunku rury ruchomej. */
    pipe: { pts: pipePts, cum: pipeCum, get length() { return reg[PIPELEN]; }, get count() { return pCount; } },
    belt: { get count() { return beltCount; }, get travel() { return reg[BTRAVEL]; } }
  };
}
