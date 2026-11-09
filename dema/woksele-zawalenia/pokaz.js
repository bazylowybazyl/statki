// Strona na żywo dema wiązanych wokseli: pętla rAF, kamera orbitalna, panel (docs/SPEC-woksele-zawalenia.md § 5.2–5.4). Efekt od razu po wejściu, bez nakładek w kadrze.
// Zegar stały 1/60 s na krok, najwyżej 2 kroki na klatkę, po przekroczeniu progu 1 krok, reszta przepada: spowolnienie zamiast spirali. Numer kroku z licznika całkowitego.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWokseleObraz } from '../../src/3d/woksele/obraz.js';
import { OPCJE_PYLU } from '../../src/3d/woksele/pyl.js';
import { DX_MIASTA, POJEMNOSC_MIASTA } from '../../src/3d/woksele/scenaMiasta.js';
import { DX_BAZY, POJEMNOSC_BAZY } from '../../src/3d/woksele/scenaBazy.js';
import { wypiekZeZbrojeniem, statystykaKawalkow, KRUCHOSC } from '../../src/3d/woksele/kawalki.js';
import { createNarzedzia, NARZEDZIA } from './narzedzia.js';

const H = 1 / 60;
const STANIE_POMIJANE = 60; // § 5.2: stanie przed zdarzeniem skrócone o sekundę; stojąca wieża się nie rusza (W1), więc kroki idą od razu przy resecie
const PROG_DRUGIEGO_KROKU_MS = 14;
const DROGA_MIGAWEK = '/.tmp/woksele-demo/migawki/';

// Kamery startowe jak w filmie (bieg-film.sh, § 4.7): az, el, cel, odl. Cień: środek i zakres z rys4.mjs.
const K_WIEZA = { az: 32, el: 8, cel: [0, 0, 620], odl: 3300 };
// S5 (§ 5.5): kamery jak w filmie. Zakres cienia w Node 7000 to cała szerokość mapy, tu połowa. zaSrodkiem: kamera i cień jadą stałą prędkością ze środkiem masy z chwili t = 0, cel kamery względem niego.
const K_S5 = { az: 32, el: 15, cel: [0, 0, -650], odl: 7200 };
const SCENY = {
  S5: { nazwa: 'S5 pochylona wieża', kamera: K_S5, cien: [[0, 0, -900], 3500], pomin: 0 },
  S5v: { nazwa: 'S5 próżnia', kamera: { az: 32, el: 20, cel: [0, 0, 0], odl: 7600 }, cien: [[0, 0, 0], 3500], pomin: 0, zaSrodkiem: true },
  S5p: { nazwa: 'S5 planeta', kamera: K_S5, cien: [[0, 0, -900], 3500], pomin: 0 },
  S1: { nazwa: 'S1 podcięcie', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  S2: { nazwa: 'S2 własny ciężar', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  S3: { nazwa: 'S3 przebicie dysku', kamera: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, cien: [[0, 0, -300], 2300], pomin: 0 },
  S4: { nazwa: 'S4 próżnia', kamera: { az: 32, el: 8, cel: [0, 0, 650], odl: 6200 }, cien: [[0, 0, 650], 3500], pomin: STANIE_POMIJANE },
  S4grunt: { nazwa: 'S4 przy g = 400', kamera: K_WIEZA, cien: [[0, 0, 650], 3500], pomin: STANIE_POMIJANE },
  krater: { nazwa: 'Krater', kamera: { az: 60, el: 6, cel: [190, 0, 600], odl: 750 }, cien: [[0, 0, 500], 1700], pomin: 0 },
  odpornosc: { nazwa: 'Odporność', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  kolumna: { nazwa: 'Kolumna', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  naroznik: { nazwa: 'Narożnik', kamera: K_WIEZA, cien: [[0, 0, 500], 1700], pomin: STANIE_POMIJANE },
  krater90: { nazwa: 'Krater r = 90, próżnia', kamera: { az: 60, el: 6, cel: [190, 0, 650], odl: 1500 }, cien: [[0, 0, 650], 3500], pomin: 0 },
  S3poza: { nazwa: 'S3 poza środkiem', kamera: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, cien: [[0, 0, -300], 2300], pomin: 0 },
  S3osm: { nazwa: 'S3 ośmiokąt', kamera: { az: 35, el: 22, cel: [0, 0, -250], odl: 3400 }, cien: [[0, 0, -300], 2300], pomin: 0 },
  // Pomiar LOD obrazu: cztery wieże S1, około 60 tys. węzłów, wymaga ?maxWez=61000. Bez `cien`: kamera cienia z rozmiaru sceny. ukryta: bez przycisku i bez budowy w tle (bez ?maxWez solver jej nie pomieści).
  LOD60: { nazwa: 'LOD 60 tys. węzłów', kamera: { az: 32, el: 14, cel: [0, 0, 500], odl: 5200 }, pomin: 0, lod: { sloty: 2, cien: 1 }, ukryta: true },
  // Miasto (plan LOD § 5): kamera i LOD z przycisku kamery, cień z rozmiaru sceny. Pojemność z POJEMNOSC_MIASTA, strona bez niej przeładowuje się przy wejściu.
  M1: { nazwa: 'Miasto: ostrzał z góry', miasto: true, pomin: 0 },
  M2: { nazwa: 'Miasto: wszystko naraz', miasto: true, pomin: 0 },
  // Tysiące budynków, tier 0 (miastoDalekie.js). Cień ma objąć całe miasto, a nie same węzły solvera. Moduł obrazu powstaje tylko na stronie z ?scena=M3 albo ?dalekie, reszta stron go nie ładuje.
  M3: { nazwa: 'Miasto: tysiące', miasto: true, pomin: 0, dalekie: true, cien: [[0, 900, 100], 3700] },
  // Baza piratów (plan LOD § 5c): kamery przez KAM_MIASTA z polem baza, pojemność z POJEMNOSC_BAZY, kamera cienia z rozmiaru sceny.
  B1: { nazwa: 'Baza piratów', miasto: true, baza: true, pomin: 0, cienZapas: 1.05 },
  // Baza bez skryptu: niszczy użytkownik (?kawalki=1, narzędzia). Start z kamery z góry jak w misji 1, pył jak B1.
  // jakWGrze: fala łamiąca z prędkości względnej w bryle oderwanej od kotwic i tłumienie stojącej konstrukcji do progu fali, jak wGrze.zaladuj (?jakWGrze=0: dawne demo).
  B1R: { nazwa: 'Baza piratów: ręcznie', miasto: true, baza: true, pomin: 0, cienZapas: 1.05, kamStart: 'bGra', pylJak: 'B1', sztywnosc: 2, kruchosc: 1, jakWGrze: true },
};
const TEMPA = [[1, '1×'], [0.5, '½×'], [0.25, '¼×'], [0.125, '⅛×']];
// Demo kawałków (?kawalki=1): tryb obrazu. 0 i 1 to ta sama fizyka (przełączenie w biegu, ten sam stan), 2 ma pręty w fizyce, więc przełączenie do niego i z niego resetuje scenę.
const TRYBY = [[0, 'Woksele'], [1, 'Kawałki'], [2, 'Kawałki + zbrojenie']];
// Kamery miasta: skala w px na j., więc budynek ma na ekranie tyle pikseli, co w grze przy tym zoomie, a mniejsze okno pokazuje tylko wycinek kadru. Plan LOD § 1: Atlas 0,569 (kadr 9000 j. przy 5120 px), limit gry 3,2 (1600 j.), mały statek 7,88 (650 j.).
// Kierunek jak w grze: góra budynku leży w płaszczyźnie gry, więc kamera patrzy w poprzek ringu (wzdłuż y dzielnicy) i widzi fasady. Niskie el zamiast przesunięcia kadru, cel bliskich kamer z planu sceny. LOD: tier 1 i tier 2 z § 4.
const KAM_MIASTA = {
  atlas: { nazwa: 'Atlas', pxNaJ: 0.569, az: 10, el: 17, cel: [0, -60, 30], lod: { sloty: 2, cien: 1 } },
  daleko: { nazwa: 'Atlas daleko', pxNaJ: 0.171, az: 10, el: 24, cel: [0, 500, 60], lod: { sloty: 2, cien: 1 } }, // reżyser × 0,3, plan LOD § 1
  bliska: { nazwa: 'Atlas z bliska', pxNaJ: 3.2, az: 22, el: 12, zCelu: true, lod: { sloty: 7, cien: 2 } },
  maly: { nazwa: 'Mały statek', pxNaJ: 7.88, az: 28, el: 8, zCelu: true, lod: { sloty: 7, cien: 7 } },
  // Baza piratów: Atlas 0,14 px / j. wg gry (cała baza w 5120 px, a mniejsze okno pokazuje wycinek wokół habitatu), z bliska W-1.
  bAtlas: { nazwa: 'Atlas', pxNaJ: 0.14, az: 12, el: 24, cel: [1700, 0, -500], lod: { sloty: 2, cien: 1 }, baza: true },
  bCala: { nazwa: 'Cała baza', pxNaJ: 0.085, az: 12, el: 24, cel: [1700, 0, -900], lod: { sloty: 2, cien: 1 }, baza: true }, // okno 1280 × 720: cała baza i podłoga, węzeł 3,4 px
  bBliska: { nazwa: 'Z bliska', pxNaJ: 0.5, az: 28, el: 10, zCelu: true, lod: { sloty: 7, cien: 2 }, baza: true },
  // Kamera misji 1: prawie pionowo z góry (płaszczyzna gry to XY). Atlas przy oddaleniu (0,14 px/j.) i przybliżona (0,4 px/j.) nad habitatem.
  bGra: { nazwa: 'Z góry (gra)', pxNaJ: 0.14, az: 0, el: 88, cel: [1800, 200, 0], lod: { sloty: 2, cien: 1 }, baza: true },
  bGraBlisko: { nazwa: 'Z góry, bliżej', pxNaJ: 0.4, az: 0, el: 88, cel: [600, 0, 200], lod: { sloty: 7, cien: 2 }, baza: true },
};
const CIEN_MIASTA = { bias: -2.5 / 16000, normalBias: 0.7 }; // stałe wieży (9,6 j. głębi, 2 j. wzdłuż normalnej) to jedna czwarta budynku

function ustawKamere(camera, sterowanie, k) {
  const a = (k.az * Math.PI) / 180, e = (k.el * Math.PI) / 180;
  camera.position.set(
    k.cel[0] + Math.sin(a) * Math.cos(e) * k.odl,
    k.cel[1] - Math.cos(a) * Math.cos(e) * k.odl,
    k.cel[2] + Math.sin(e) * k.odl,
  );
  if (sterowanie) { sterowanie.target.set(k.cel[0], k.cel[1], k.cel[2]); sterowanie.update(); } else camera.lookAt(k.cel[0], k.cel[1], k.cel[2]);
  camera.updateMatrixWorld();
}

export async function startPokaz({ renderer, solver, wok, device, adres }) {
  const kanwa = renderer.domElement;
  kanwa.id = 'kanwa';
  document.body.appendChild(kanwa);
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 20, 700000);
  camera.up.set(0, 0, 1);

  const KAWALKI = adres.get('kawalki') === '1';
  const obraz = createWokseleObraz({ solver, camera, aoTryb: adres.get('ao') || 'film', kawalki: KAWALKI });
  // ?kawOp={...}: opcje prefraktury (OPCJE_KAWALKOW), ?zbrojenie={"gestosc":0.4,"ciagl":4,"sila":3}: pręty (OPCJE_ZBROJENIA). Idą do wątku budowy.
  // Narzędzia niszczenia (klik, działa, taran, upadek): siatki w scenie obrazu przed rozgrzewką.
  const narz = KAWALKI ? createNarzedzia({ solver, obraz, camera, kanwa, budynki: () => stan.miasto?.budynki ?? null }) : null;
  // ?kruchosc=1|2: beton kruchszy w wypieku (granice gięcia, kawalki.js KRUCHOSC). Zmiana przeładowuje stronę, bo wypiek idzie od nowa.
  // Bez parametru: kruchość sceny z adresu (B1R: 1, propozycja użytkownika 2026-11-09 „beton kruchy, sztywność ×2 lub ×3”), reszta 0.
  const KRUCH = KAWALKI ? Math.max(0, Math.min(KRUCHOSC.length - 1, adres.has('kruchosc') ? Number(adres.get('kruchosc')) || 0 : SCENY[adres.get('scena')]?.kruchosc ?? 0)) : 0;
  // ?sztywnosc=2|3: sztywniejszy beton (K × s², podkroki solvera × s, wytrzymałość bez zmian). Też przeładowanie.
  // Bez parametru: sztywność sceny z adresu (B1R: 2, reszta 1).
  const SZTYW = KAWALKI ? Math.max(1, Math.min(4, Number(adres.get('sztywnosc')) || SCENY[adres.get('scena')]?.sztywnosc || 1)) : 1;
  const opcjeKawalkow = KAWALKI ? { kawalki: adres.has('kawOp') ? JSON.parse(adres.get('kawOp')) : {}, zbrojenie: adres.has('zbrojenie') ? JSON.parse(adres.get('zbrojenie')) : {} } : null;
  // AGENT: miasto dalekie tylko na stronie, która je pokazuje: nowy materiał i kernel, a stare sceny mają zostać bez zmian co do pipeline'u.
  const dalekie = adres.get('scena') === 'M3' ? (await import('./miastoDalekie.js')).createMiastoDalekie({ solver, obraz }) : null;
  const sterowanie = new OrbitControls(camera, kanwa);
  sterowanie.enableDamping = true;
  sterowanie.dampingFactor = 0.12;
  sterowanie.maxDistance = 30000;
  sterowanie.minDistance = 60;
  sterowanie.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  sterowanie.zoomToCursor = true;

  const stan = { tryb: KAWALKI ? Number(adres.get('tryb') ?? 1) : 0, scena: null, krok: 0, pauza: false, tempo: 1, akum: 0, kroczyc: true, msKlatki: 0, ostatnia: 0, licznik: false, pierwszyKrok: false, jedzie: false, c0x: 0, c0y: 0, c0z: 0, vcx: 0, vcy: 0, vcz: 0, ocx: 0, ocy: 0, ocz: 0 };

  function krokSceny() {
    if (stan.krok >= stan.pelnyOd) { obraz.pelnyObraz(true); stan.pelnyOd = Infinity; }
    narz?.krok(renderer);
    solver.krok(renderer);
    dalekie?.krok(stan.krok + 1);
    if (stan.pierwszyKrok) { obraz.krokBezLimitu(renderer); stan.pierwszyKrok = false; } else obraz.krok(renderer);
    stan.krok++;
  }

  // Budowa raz na scenę w wątku roboczym (§ 2.3), reset to tylko wgranie buforów. Sceny budują się w tle po starcie, więc przełączenie ich nie czeka.
  const ziarnoAdresu = adres.has('ziarno') ? Number(adres.get('ziarno')) : undefined;
  // ?sloty=1|2|7&cienSloty=0|1|2|7: LOD obrazu dla każdej sceny, do oglądania i pomiaru. Bez tego wartość ze sceny, a domyślnie 7 jak dotąd.
  const lodAdresu = adres.has('sloty') || adres.has('cienSloty') ? { sloty: Number(adres.get('sloty') ?? 7), cien: Number(adres.get('cienSloty') ?? adres.get('sloty') ?? 7) } : null;
  // ?lodS1={"dx":40,"mat":"staly"}: S1 przy innym dx (próba 1 planu LOD). Tylko do zrzutów: bez budowy pozostałych scen w tle, cień z rozmiaru sceny.
  const lodS1Adresu = adres.has('lodS1') ? JSON.parse(adres.get('lodS1')) : null;
  // ?miasto={"dx":10}: opcje dzielnicy (scenaMiasta.js). Przyciski gęstości i wejście w miasto przeładowują stronę z ?maxWez i ?nKom: bufory solvera powstają raz, przy starcie.
  const miastoAdresu = adres.has('miasto') ? JSON.parse(adres.get('miasto')) : {};
  const dxMiasta = miastoAdresu.dx ?? DX_MIASTA;
  const miastoSieMiesci = solver.maxNodes >= (POJEMNOSC_MIASTA[dxMiasta]?.maxWez ?? 0);
  // ?baza={"dx":80}: opcje sceny B1 (scenaBazy.js), wchodzą do wątku budowy tym samym polem co opcje miasta.
  const bazaAdresu = adres.has('baza') ? JSON.parse(adres.get('baza')) : {};
  const dxBazy = bazaAdresu.dx ?? DX_BAZY;
  const bazaSieMiesci = solver.maxNodes >= POJEMNOSC_BAZY[dxBazy].maxWez;
  const watek = new Worker(new URL('../../src/3d/woksele/budowa.worker.js', import.meta.url), { type: 'module' });
  const wypieki = new Map();
  const czekajace = new Map();
  watek.onmessage = ({ data }) => {
    const c = czekajace.get(data.id);
    if (data.blad) { console.error('woksele: budowa sceny', data.id, data.blad); c?.nie(new Error(data.blad)); return; }
    wypieki.set(data.id, data);
    c?.ok(data);
  };
  function wypiek(id) {
    if (wypieki.has(id)) return Promise.resolve(wypieki.get(id));
    if (!czekajace.has(id)) {
      const c = {};
      c.obietnica = new Promise((ok, nie) => { c.ok = ok; c.nie = nie; });
      czekajace.set(id, c);
      watek.postMessage({ id, ziarno: ziarnoAdresu, lodS1: lodS1Adresu, miasto: SCENY[id]?.baza ? bazaAdresu : miastoAdresu, ...(opcjeKawalkow && (!SCENY[id]?.miasto || SCENY[id]?.baza) ? { kawalki: opcjeKawalkow } : {}), ...(KRUCH ? { kruchosc: KRUCH } : {}), ...(SZTYW > 1 ? { sztywnosc: SZTYW } : {}) });
    }
    return czekajace.get(id).obietnica;
  }
  /** Wejście w scenę z panelu: czeka na budowę, ostatni klik wygrywa. */
  async function wejdz(id, opcje) {
    stan.celScena = id;
    await wypiek(id);
    if (stan.celScena === id) ustawScene(id, opcje);
  }

  /** Kamera miasta z przycisku: skala w px na j. z wysokości okna, LOD obrazu tieru. Reset jej nie rusza. */
  function kameraMiasta(nazwa) {
    const k = KAM_MIASTA[nazwa];
    if (!k) throw new Error(`Nieznana kamera ${nazwa}`);
    stan.kamMiasta = nazwa;
    const odl = window.innerHeight / (2 * k.pxNaJ * Math.tan((camera.fov * Math.PI) / 360));
    ustawKamere(camera, sterowanie, { az: k.az, el: k.el, cel: k.zCelu ? (stan.miasto?.celBliska ?? [0, 0, 60]) : k.cel, odl });
    if (!lodAdresu) obraz.ustawLod(k.lod);
    zaznacz();
  }

  /** Scena przez reset: wgranie buforów, bez nowych pipeline'ów. Kamera tylko przy zmianie sceny, R zostawia ją tam, gdzie jest. */
  function ustawScene(id, { kamera = true, pomin = true } = {}) {
    const opis = SCENY[id];
    if (!opis) throw new Error(`Nieznana scena ${id}`);
    const { w: w0, g, zdarzeniaOd, rDysk, poklad, miasto, kaw, zbr } = wypieki.get(id);
    // Tryb ze zbrojeniem: ten sam wypiek z prętami w tablicach wiązań. Scena bez prefraktury (miasto, baza) zostaje przy wokselach.
    const trybSceny = kaw ? stan.tryb : 0;
    const w = trybSceny === 2 ? (wypieki.get(id).wZbr ??= wypiekZeZbrojeniem(w0, zbr)) : w0;
    // Kamery baza / miasto to osobne zestawy na jednym panelu.
    if (opis.miasto && !!KAM_MIASTA[stan.kamMiasta].baza !== !!opis.baza) stan.kamMiasta = opis.baza ? (opis.kamStart ?? 'bAtlas') : 'atlas';
    if (opis.kamStart && kamera) stan.kamMiasta = opis.kamStart;
    narz?.reset();
    const bU = przyciski.get('n:upadek');
    if (bU) bU.style.display = opis.baza ? '' : 'none';
    for (const n of Object.keys(KAM_MIASTA)) przyciski.get(`k:${n}`).style.display = !!KAM_MIASTA[n].baza === !!opis.baza ? '' : 'none';
    solver.wczytaj(w);
    // Baza jak w grze (wGrze.zaladuj): w locie nic się nie łamie od samej prędkości, a ruch połączony z kotwicami wolniejszy niż próg fali gaśnie (stoi albo pęka).
    const jakWGrze = !!opis.jakWGrze && adres.get('jakWGrze') !== '0';
    const uS = solver.uniformy;
    uS.uFalaWzgl.value = jakWGrze ? 1 : 0;
    // ?tlumienie=0: bez tłumienia „stoi albo pęka” (fala względna zostaje). Tłumienie gasi też powolny początek przewracania: wieża z klinem przy mocniejszej
    // szyi (mocSzyi 3) stoi pod nim, a bez niego przechyla się ku klinowi (pomiar 2026-11-09, docs/RAPORT-kawalki-zawalen.md).
    if (jakWGrze && adres.get('tlumienie') !== '0' && uS.uFalaV2.value < 1e29) uS.uLepV2.value = Math.max(uS.uLepV2.value, uS.uFalaV2.value);
    solver.ustawPlan(g);
    obraz.wczytaj(w, { rDysk, poklad, pyl: adres.get('pyl') === 'film' ? null : OPCJE_PYLU[opis.pylJak ?? id], lod: lodAdresu ?? (opis.miasto ? KAM_MIASTA[stan.kamMiasta].lod : opis.lod), budynki: miasto?.budynki ?? null, piraci: !!opis.baza && KAWALKI }); // ?pyl=film: A/B parametrów pyłu sceny kontra opcje filmu
    if (obraz.kawalki) {
      if (kaw && stan.kawScena !== `${id}:${trybSceny === 2}`) { obraz.kawalki.wczytaj(kaw, trybSceny === 2 ? zbr : null, w.n, w.dx); stan.kawScena = `${id}:${trybSceny === 2}`; } else if (kaw) obraz.kawalki.reset();
      if (stan.rozgrzane) obraz.ustawTryb(trybSceny);
      stan.trybSceny = trybSceny;
    }
    dalekie?.wczytaj(miasto?.dalekie ?? null);
    if (opis.cien && !lodS1Adresu) obraz.ustawCien(opis.cien[0], opis.cien[1]);
    else obraz.ustawCienZSceny(w, opis.cienZapas);
    stan.miasto = miasto;
    if (opis.miasto) { obraz.sun.shadow.bias = CIEN_MIASTA.bias; obraz.sun.shadow.normalBias = CIEN_MIASTA.normalBias; }
    stan.scena = id;
    stan.krok = 0;
    stan.akum = 0;
    stan.pelnyOd = Number.isFinite(zdarzeniaOd) ? Math.max(0, Math.floor(zdarzeniaOd * 60) - 1) : 0;
    if (pomin) for (let k = 0; k < opis.pomin; k++) krokSceny();
    stan.jedzie = false;
    if (opis.zaSrodkiem) {
      // Środek masy i jego prędkość z chwili t = 0, raz na wejście w scenę.
      let sx = 0, sy = 0, sz = 0, vx = 0, vy = 0, vz = 0;
      const v0 = w.vel0;
      for (let i = 0; i < w.n; i++) {
        sx += w.pos[3 * i]; sy += w.pos[3 * i + 1]; sz += w.pos[3 * i + 2];
        if (v0) { vx += v0[3 * i]; vy += v0[3 * i + 1]; vz += v0[3 * i + 2]; }
      }
      stan.jedzie = true;
      stan.c0x = sx / w.n; stan.c0y = sy / w.n; stan.c0z = sz / w.n;
      stan.vcx = vx / w.n; stan.vcy = vy / w.n; stan.vcz = vz / w.n;
      if (kamera) { stan.ocx = 0; stan.ocy = 0; stan.ocz = 0; }
    }
    if (kamera && opis.miasto) kameraMiasta(stan.kamMiasta);
    else if (kamera) {
      const k = opis.kamera;
      ustawKamere(camera, sterowanie, opis.zaSrodkiem ? { ...k, cel: [k.cel[0] + stan.c0x, k.cel[1] + stan.c0y, k.cel[2] + stan.c0z] } : k);
    }
    panelKamer.hidden = !opis.miasto;
    panelGestosci.hidden = !opis.miasto || !!opis.baza;
    zaznacz();
    return w;
  }

  /** Kamera i cień za środkiem masy (S5 próżnia): przesunięcie względem poprzedniej klatki, więc orbita i przybliżenie użytkownika zostają. Reset wraca na początek toru. Bez alokacji. */
  const srodekCienia = [0, 0, 0];
  function sledzSrodek() {
    if (!stan.jedzie) return;
    const t = stan.krok * H + stan.akum;
    const ox = stan.vcx * t, oy = stan.vcy * t, oz = stan.vcz * t;
    const dx = ox - stan.ocx, dy = oy - stan.ocy, dz = oz - stan.ocz;
    stan.ocx = ox; stan.ocy = oy; stan.ocz = oz;
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
    sterowanie.target.x += dx; sterowanie.target.y += dy; sterowanie.target.z += dz;
    const c = SCENY[stan.scena].cien;
    srodekCienia[0] = c[0][0] + stan.c0x + ox; srodekCienia[1] = c[0][1] + stan.c0y + oy; srodekCienia[2] = c[0][2] + stan.c0z + oz;
    obraz.ustawCien(srodekCienia, c[1]);
  }

  /** Migawka Node (S1_t3.50), dopóki pakiet P2 nie ma zdarzeń: stan z chwili t, dalej swobodny bieg. */
  async function wgrajMigawke(nazwa) {
    const { rozpakujMigawke } = await import('./wzorzec-cpu.js');
    const [rj, rb] = await Promise.all([fetch(`${DROGA_MIGAWEK}${nazwa}.json`), fetch(`${DROGA_MIGAWEK}${nazwa}.bin`)]);
    if (!rj.ok || !rb.ok) throw new Error(`Brak migawki ${nazwa}`);
    const m = rozpakujMigawke(await rj.json(), await rb.arrayBuffer());
    await wypiek(nazwa.split('_')[0]);
    ustawScene(nazwa.split('_')[0]);
    solver.wgraj({ ...m.przed, skG: m.skG, sFr: m.sFr, kotwiceWiezy: m.kotwiceWiezy, budowa: m.budowa });
    obraz.krokBezLimitu(renderer);
    obraz.pelnyObraz(true);
    stan.pelnyOd = Infinity;
    stan.krok = Math.round(Number(nazwa.split('_t')[1]) * 60);
  }

  function zmienRozmiar() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    obraz.ustawRozmiar(renderer, w, h);
  }

  // ── Panel ──
  const panel = document.getElementById('panel');
  const przyciski = new Map();
  const dodaj = (rodzic, tekst, akcja, klucz) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tekst;
    b.addEventListener('click', () => { akcja(); b.blur(); });
    rodzic.appendChild(b);
    if (klucz) przyciski.set(klucz, b);
    return b;
  };
  const gr1 = document.getElementById('panelSceny');
  const gr2 = document.getElementById('panelTempo');
  const gr3 = document.getElementById('panelSter');
  /** Miasto na stronie bez pojemności albo inna gęstość: przeładowanie z parametrami, bo bufory solvera powstają raz, przy starcie. */
  function przeladujMiasto(id, dx) {
    const p = POJEMNOSC_MIASTA[dx];
    const q = new URLSearchParams(location.search);
    q.set('scena', id);
    q.set('maxWez', String(p.maxWez));
    q.set('nKom', String(p.nKom));
    q.set('miasto', JSON.stringify({ ...miastoAdresu, dx }));
    location.search = q.toString();
  }
  /** Baza piratów na stronie bez pojemności: to samo przeładowanie co miasto, przycisk od razu daje ?scena=B1&maxWez=…&nKom=…. */
  function przeladujBaze(id = 'B1') {
    const p = POJEMNOSC_BAZY[dxBazy];
    const q = new URLSearchParams(location.search);
    q.set('scena', id);
    q.set('maxWez', String(p.maxWez));
    q.set('nKom', String(p.nKom));
    location.search = q.toString();
  }
  for (const id of Object.keys(SCENY)) {
    if (SCENY[id].ukryta) continue;
    const akcja = SCENY[id].baza ? () => { if (bazaSieMiesci) wejdz(id); else przeladujBaze(id); } : SCENY[id].miasto ?() => { if (miastoSieMiesci && (dalekie || !SCENY[id].dalekie)) wejdz(id); else przeladujMiasto(id, dxMiasta); } : () => { wejdz(id); };
    const b = dodaj(gr1, SCENY[id].nazwa, akcja, `s:${id}`);
    b.disabled = !zdarzeniaDostepne(id);
  }
  for (const [t, opis] of TEMPA) dodaj(gr2, opis, () => { stan.tempo = t; zaznacz(); }, `t:${t}`);
  dodaj(gr3, 'Reset (R)', () => ustawScene(stan.scena, { kamera: false }));
  const bPauza = dodaj(gr3, 'Pauza (spacja)', () => { stan.pauza = !stan.pauza; zaznacz(); });
  const nowaGrupa = (id) => { const d = document.createElement('div'); d.className = 'grupa'; d.id = id; d.hidden = true; panel.insertBefore(d, gr2); return d; };
  const panelKamer = nowaGrupa('panelKamery');
  const panelObrazu = nowaGrupa('panelObraz');
  /** Tryb obrazu z panelu: 0 ↔ 1 w biegu, przy tym samym stanie fizyki. Do zbrojenia i z niego reset sceny (inna fizyka), kamera zostaje. */
  function ustawTrybObrazu(t) {
    if (!KAWALKI) return;
    const reset = (t === 2) !== (stan.tryb === 2);
    stan.tryb = t;
    if (reset) ustawScene(stan.scena, { kamera: false });
    else { const kaw = wypieki.get(stan.scena)?.kaw; obraz.ustawTryb(kaw ? t : 0); stan.trybSceny = kaw ? t : 0; }
    zaznacz();
  }
  if (KAWALKI) {
    for (const [t, opis] of TRYBY) dodaj(panelObrazu, opis, () => ustawTrybObrazu(t), `o:${t}`);
    panelObrazu.hidden = false;
  }
  // Beton: przełącznik kruchości (przeładowanie z ?kruchosc, scena zostaje).
  const panelBetonu = nowaGrupa('panelBeton');
  if (KAWALKI) {
    for (const [k, opis] of [[0, 'Beton: dziś'], [1, 'Kruchy'], [2, 'Bardzo kruchy']]) {
      dodaj(panelBetonu, opis, () => {
        if (k === KRUCH) return;
        const q = new URLSearchParams(location.search);
        q.set('kruchosc', String(k));
        q.set('scena', stan.scena);
        location.search = q.toString();
      }, `b:${k}`);
    }
    for (const [s, opis] of [[1, 'Sztywność ×1'], [2, '×2'], [3, '×3']]) {
      dodaj(panelBetonu, opis, () => {
        if (s === SZTYW) return;
        const q = new URLSearchParams(location.search);
        q.set('sztywnosc', String(s));
        q.set('scena', stan.scena);
        location.search = q.toString();
      }, `z:${s}`);
    }
    panelBetonu.hidden = false;
  }
  // Narzędzia: klik w kadr bez przeciągania używa wybranego (klawisze 1–5), F trzymane strzela seriami w kursor, U: upadek jak przy HP 0 (tylko baza).
  const panelNarzedzi = nowaGrupa('panelNarzedzia');
  const ustawNarzedzie = (n) => { narz?.ustaw(n); zaznacz(); };
  if (narz) {
    for (const [n, opis] of NARZEDZIA) dodaj(panelNarzedzi, opis, () => ustawNarzedzie(n), `n:${n}`);
    dodaj(panelNarzedzi, 'Upadek (HP 0)', () => narz.uzyj('upadek'), 'n:upadek');
    panelNarzedzi.hidden = false;
  }
  const panelGestosci = nowaGrupa('panelGestosc');
  for (const n of Object.keys(KAM_MIASTA)) dodaj(panelKamer, KAM_MIASTA[n].nazwa, () => kameraMiasta(n), `k:${n}`);
  for (const dx of Object.keys(POJEMNOSC_MIASTA).map(Number).sort((a, b) => b - a)) dodaj(panelGestosci, `dx ${dx}`, () => { if (dx !== dxMiasta) przeladujMiasto(stan.scena, dx); }, `d:${dx}`);
  stan.kamMiasta = 'atlas';
  function zaznacz() {
    for (const [k, b] of przyciski) {
      const wl = k === `s:${stan.scena}` || k === `t:${stan.tempo}` || k === `k:${stan.kamMiasta}` || k === `d:${dxMiasta}` || k === `o:${stan.tryb}` || k === `n:${narz?.narzedzie}` || k === `b:${KRUCH}` || k === `z:${SZTYW}`;
      b.classList.toggle('wl', wl);
    }
    bPauza.classList.toggle('wl', stan.pauza);
  }
  /** Sceny ze zdarzeniami potrzebują kerneli pakietu P2, S3 zdarzeń nie ma. */
  function zdarzeniaDostepne(id) { return id === 'S3' || !!solver.kernele.kCzas; }
  panel.hidden = false;

  const licznik = document.getElementById('licznik');
  window.addEventListener('resize', zmienRozmiar);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') { stan.pauza = !stan.pauza; zaznacz(); e.preventDefault(); }
    else if (e.code === 'KeyR') ustawScene(stan.scena, { kamera: false });
    else if (e.code === 'KeyP') { stan.licznik = !stan.licznik; licznik.hidden = !stan.licznik; }
    else if (e.code === 'KeyH') panel.hidden = !panel.hidden;
    else if (e.code === 'KeyK' && KAWALKI) ustawTrybObrazu((stan.tryb + 1) % 3);
    else if (narz && /^Digit[1-5]$/.test(e.code)) ustawNarzedzie(NARZEDZIA[Number(e.code.slice(5)) - 1][0]);
    else if (narz && e.code === 'KeyU' && SCENY[stan.scena]?.baza) narz.uzyj('upadek');
  });

  // ── Start ── Rozgrzewka przed pierwszą klatką, potem efekt od razu.
  const mig = adres.get('migawka');
  const start = adres.get('scena') || (solver.kernele.kCzas ? 'S5' : 'S3');
  const scenaStartu = mig ? mig.split('_')[0] : start;
  await wypiek(scenaStartu);
  ustawScene(scenaStartu, { pomin: false });
  zmienRozmiar();
  await obraz.rozgrzej(renderer);
  // Rozgrzewka szła z widocznymi wszystkimi siatkami (bryły, kawałki, druty, narzędzia), dopiero teraz tryb obrazu.
  stan.rozgrzane = true;
  obraz.ustawTryb(stan.trybSceny ?? 0);
  narz?.schowaj();
  // Rozgrzewka szła na scenie bez kroków, pomijane kroki stania idą już po niej. Harness liczy czas sceny od zera.
  if (mig) await wgrajMigawke(mig);
  else if (!adres.has('bezPominiecia')) for (let k = 0; k < SCENY[stan.scena].pomin; k++) krokSceny();

  let srednia = 0, klatek = 0, tLicznika = 0;
  // AGENT: ?maksKl=N: sufit klatek pętli rAF. Harness podaje 60: bez niego headless z --disable-frame-rate-limit rysuje około 600 kl/s także w bezruchu, GPU 99%, a komputer stoi tam, gdzie ktoś śpi.
  const minMsKlatki = Number(adres.get('maksKl')) > 0 ? 1000 / Number(adres.get('maksKl')) : 0;
  function petla(teraz) {
    requestAnimationFrame(petla);
    if (minMsKlatki && !stan.wymusKlatke && stan.ostatnia && teraz - stan.ostatnia < minMsKlatki - 0.5) return;
    stan.wymusKlatke = false;
    stan.klatek = (stan.klatek | 0) + 1;
    const dtMs = stan.ostatnia ? teraz - stan.ostatnia : 16.7;
    stan.ostatnia = teraz;
    if (!stan.pauza && stan.kroczyc) {
      stan.akum += Math.min(dtMs, 100) * 0.001 * stan.tempo;
      const maksKrokow = stan.msKlatki > PROG_DRUGIEGO_KROKU_MS ? 1 : 2;
      let k = 0;
      while (stan.akum >= H && k < maksKrokow) { krokSceny(); stan.akum -= H; k++; }
      if (stan.akum >= H) stan.akum = H * 0.999; // reszta przepada
    }
    sledzSrodek();
    sterowanie.update();
    if (narz) { narz.serie(teraz); narz.klatka(stan.akum); }
    if (stan.rysowac !== false) obraz.rysuj(renderer, camera, stan.akum);
    stan.msKlatki = dtMs;
    if (stan.licznik) {
      srednia += dtMs; klatek++;
      if (teraz - tLicznika > 250) {
        licznik.textContent = `${(srednia / klatek).toFixed(1)} ms`;
        srednia = 0; klatek = 0; tLicznika = teraz;
      }
    }
  }
  requestAnimationFrame(petla);
  // Budowa w tle: pod harnessem miasta tylko scena z adresu (dx = 5 to około minuta CPU na scenę), a miasto tylko na stronie, która je pomieści.
  // Strona z bazą na starcie (B1, B1R): bez budowy pozostałych scen w tle, sama baza to 85 tys. węzłów i jej kawałki.
  if (!lodS1Adresu && !SCENY[scenaStartu]?.baza && !(window.__harness && (adres.has('miasto') || adres.get('scena') === 'B1'))) for (const id of Object.keys(SCENY)) if (zdarzeniaDostepne(id) && !SCENY[id].ukryta && (SCENY[id].baza ? bazaSieMiesci : !SCENY[id].miasto || miastoSieMiesci)) wypiek(id);
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  Object.assign(wok, {
    obraz,
    camera,
    dalekie,
    pokaz: {
      stan,
      ustawScene,
      wejdz,
      wgrajMigawke,
      /** Harness: scena stoi w chwili t. Kroki bez czekania na rAF, kolejka GPU trzymana krótko. */
      async doChwili(t) {
        stan.kroczyc = false;
        const cel = Math.round(t * 60);
        if (stan.krok > cel) ustawScene(stan.scena, { kamera: false, pomin: false });
        let n = 0;
        while (stan.krok < cel) {
          krokSceny();
          if (++n % 8 === 0) await device.queue.onSubmittedWorkDone();
        }
        stan.akum = 0;
        await device.queue.onSubmittedWorkDone();
        stan.wymusKlatke = true; // pierwszy rAF ma narysować stan po krokach także przy ?maksKl
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        await device.queue.onSubmittedWorkDone();
        return { krok: stan.krok };
      },
      kamera(k) { ustawKamere(camera, sterowanie, k); },
      /** Harness, demo kawałków: tryb obrazu (jak przycisk) i stan kawałków z GPU. */
      tryb(t) { ustawTrybObrazu(t); return { tryb: stan.tryb, trybSceny: stan.trybSceny }; },
      narzedzia: narz,
      solver, // harness: wypiek i odczyt stanu (analiza wiązań, woksele-baza-narzedzia.mjs --scenariusz szyja)
      async statKawalki() {
        const kw = obraz.kawalki, wy = wypieki.get(stan.scena);
        if (!kw || !wy?.kaw) return null;
        // Odczyt z GPU tu, na stronie dema: moduły renderu w src/3d go nie mają (strażnik szwu renderu).
        const [bS, bP] = await Promise.all([renderer.getArrayBufferAsync(kw.atrybuty.stan), renderer.getArrayBufferAsync(kw.atrybuty.poziom)]);
        return { ...statystykaKawalkow(wy.kaw, new Float32Array(bS), new Uint32Array(bP), solver.wypiek.n), stat: wy.kaw.stat, prety: stan.trybSceny === 2 ? wy.zbr?.ile ?? 0 : 0 };
      },
      kameraMiasta,
      /** Harness: klatka po zmianie kamery albo LOD, przy zatrzymanym zegarze. */
      async przerysuj() {
        stan.wymusKlatke = true;
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        await device.queue.onSubmittedWorkDone();
      },
      /**
       * Harness: ile budynków stoi. Wysokość środka masy węzłów budynku względem początkowej (usunięte liczą się jak na ziemi): stoi ≥ 0,9, leży < 0,55, reszta to częściowo.
       * Osobno trafione i nietrafione, a do tego węzły żywe, NaN i pominięte zdarzenia solvera.
       */
      async statMiasta() {
        const m = stan.miasto;
        if (!m) return null;
        if (m.baza) return wok.pokaz.statBazy();
        const r = await solver.odczytLekki(renderer);
        const p0 = solver.wypiek.pos;
        const wy = { t: { stoi: 0, czesc: 0, lezy: 0 }, n: { stoi: 0, czesc: 0, lezy: 0 }, zywych: 0, nan: 0, krok: stan.krok, liczniki: { ...solver.liczniki } };
        for (let q = 0; q < m.budynki.length; q++) {
          const b = m.budynki[q];
          let z = 0, z0 = 0;
          for (let i = b.start; i < b.start + b.n; i++) {
            z0 += p0[3 * i + 2];
            if (r.pos[3 * i + 2] !== r.pos[3 * i + 2]) wy.nan++;
            if (r.aktywny[i]) { z += r.pos[3 * i + 2]; wy.zywych++; }
          }
          const u = z / Math.max(1e-6, z0);
          wy[m.trafione[q] ? 't' : 'n'][u >= 0.9 ? 'stoi' : u < 0.55 ? 'lezy' : 'czesc']++;
        }
        return wy;
      },
      /** Harness, B1: na część węzły żywe, średnie z i zmiana względem startu, największe przemieszczenie; do tego zerwane bity, NaN i pominięte zdarzenia (W1: 0 zerwanych, 0 NaN). */
      async statBazy() {
        const w = solver.wypiek;
        const r = await solver.odczyt(renderer);
        const wy = { krok: stan.krok, nan: 0, zerwaneBity: 0, wezlyZInnaMaska: 0, maxPrzem: 0, vMax: 0, liczniki: { ...solver.liczniki }, czesci: [] };
        const pc = (x) => { let c = 0; for (x &= 0x3ffff; x; x &= x - 1) c++; return c; };
        for (const b of stan.miasto.budynki) {
          let z = 0, z0 = 0, ile = 0, mx = 0;
          for (let i = b.start; i < b.start + b.n; i++) {
            const a = r.poz[3 * i] - w.pos[3 * i], c = r.poz[3 * i + 1] - w.pos[3 * i + 1], e = r.poz[3 * i + 2] - w.pos[3 * i + 2];
            if (a !== a || c !== c || e !== e) { wy.nan++; continue; }
            if (r.maskaW[i] !== w.maska[i]) { wy.wezlyZInnaMaska++; wy.zerwaneBity += pc(w.maska[i]) - pc(r.maskaW[i]); }
            if (r.aktywny && !r.aktywny[i]) continue;
            ile++; z += r.poz[3 * i + 2]; z0 += w.pos[3 * i + 2];
            mx = Math.max(mx, a * a + c * c + e * e);
            wy.vMax = Math.max(wy.vMax, r.vel[3 * i] ** 2 + r.vel[3 * i + 1] ** 2 + r.vel[3 * i + 2] ** 2);
          }
          wy.maxPrzem = Math.max(wy.maxPrzem, mx);
          wy.czesci.push(`${b.nazwa}: ${ile}/${b.n} dz ${ile ? Math.round((z - z0) / ile) : 0} maks ${Math.round(Math.sqrt(mx))}`);
        }
        wy.maxPrzem = Math.sqrt(wy.maxPrzem);
        wy.vMax = Math.sqrt(wy.vMax);
        return wy;
      },
      panel(wid) { panel.hidden = !wid; },
      /** Harness: czas pełnej klatki w ściśle zamkniętej pętli (krok, obraz, rysunek, czekanie na GPU), n klatek od stanu bieżącego. */
      async diag() {
        stan.kroczyc = false;
        stan.rysowac = false;
        const czekaj = () => new Promise((ok) => setTimeout(ok, 400));
        await czekaj();
        await device.queue.onSubmittedWorkDone();
        const wy = {};
        wy.pusto = await wok.pokaz.zmierzKlatki(10, false, false);
        wy.krok = await wok.pokaz.zmierzKlatki(10, true, false);
        wy.rysunek = await wok.pokaz.zmierzKlatki(10, false, true);
        const sc = obraz.mesh.geometry.instanceCount;
        obraz.mesh.geometry.instanceCount = 2;
        wy.bezBrylGlownych = await wok.pokaz.zmierzKlatki(10, false, true);
        obraz.mesh.geometry.instanceCount = sc;
        const au = obraz.sun.shadow.autoUpdate;
        obraz.sun.shadow.autoUpdate = false;
        wy.bezOdswCienia = await wok.pokaz.zmierzKlatki(10, false, true);
        obraz.sun.shadow.autoUpdate = au;
        // Znaczniki czasu: kObraz + kGruz i wszystkie passy rysunku z zegara GPU, bez podłogi około 3 ms z onSubmittedWorkDone.
        const pr = [];
        for (let k = 0; k < 7; k++) pr.push(await wok.zmierzListe(obraz.listaObrazu));
        pr.sort((a, b) => a - b);
        wy.kObrazKGruzMs = pr[3];
        const backend = renderer.backend;
        const rys = [];
        for (let k = 0; k < 7; k++) {
          backend.trackTimestamp = true;
          obraz.rysuj(renderer, camera, 0);
          const ms = await renderer.resolveTimestampsAsync('render');
          backend.trackTimestamp = false;
          backend.timestampQueryPool?.render?.timestamps?.clear?.();
          rys.push(ms);
          await device.queue.onSubmittedWorkDone();
        }
        rys.sort((a, b) => a - b);
        wy.rysunekGpuMs = rys[3];
        stan.rysowac = true;
        return wy;
      },
      async zmierzKlatki(n = 60, zKrokiem = true, rysunek = true) {
        stan.kroczyc = false;
        const t = [], c = [];
        for (let k = 0; k < n; k++) {
          const t0 = performance.now();
          if (zKrokiem) krokSceny();
          if (rysunek) obraz.rysuj(renderer, camera, 0);
          c.push(performance.now() - t0);
          await device.queue.onSubmittedWorkDone();
          t.push(performance.now() - t0);
        }
        t.sort((a, b) => a - b);
        c.sort((a, b) => a - b);
        return { n, p50: t[n >> 1], p95: t[Math.floor(n * 0.95)], maks: t[n - 1], cpuP50: c[n >> 1], w: renderer.domElement.width, h: renderer.domElement.height, rysunki: renderer.info.render.drawCalls };
      },
      /** Harness: koszt całej klatki (zdarzenia, krok, obraz, rysunek). Ściana z n klatek w porcjach po 8, żeby czekanie na GPU nie dodawało swojej podłogi około 3 ms do każdej. GPU z sumy znaczników jednej klatki, compute i render osobno. */
      async kosztKlatki(n = 32, probek = 15) {
        stan.kroczyc = false;
        stan.rysowac = false;
        await new Promise((ok) => setTimeout(ok, 300));
        await device.queue.onSubmittedWorkDone();
        const krok0 = stan.krok;
        const t0 = performance.now();
        for (let k = 0; k < n; k++) {
          krokSceny();
          obraz.rysuj(renderer, camera, 0);
          if ((k + 1) % 8 === 0) await device.queue.onSubmittedWorkDone();
        }
        await device.queue.onSubmittedWorkDone();
        const scianaMs = (performance.now() - t0) / n;
        const backend = renderer.backend;
        const comp = [], rys = [];
        for (let k = 0; k < probek; k++) {
          backend.trackTimestamp = true;
          krokSceny();
          obraz.rysuj(renderer, camera, 0);
          comp.push(await renderer.resolveTimestampsAsync('compute'));
          rys.push(await renderer.resolveTimestampsAsync('render'));
          backend.trackTimestamp = false;
          backend.timestampQueryPool?.compute?.timestamps?.clear?.();
          backend.timestampQueryPool?.render?.timestamps?.clear?.();
          await device.queue.onSubmittedWorkDone();
        }
        comp.sort((a, b) => a - b);
        rys.sort((a, b) => a - b);
        const m = probek >> 1;
        stan.rysowac = true;
        return { scianaMs, computeGpuMs: comp[m], renderGpuMs: rys[m], gpuMs: comp[m] + rys[m], kroki: [krok0, stan.krok], w: renderer.domElement.width, h: renderer.domElement.height, rysunki: renderer.info.render.drawCalls };
      },
      /** Harness: koszt pyłu na zamrożonej klatce (P4): sam pass pyłu ze znaczników, cała klatka rysunku ze znaczników i ze ściany, włączony i wyłączony. Bez kroków. */
      async kosztPylu(probek = 15, sciana = 48) {
        stan.kroczyc = false;
        stan.rysowac = false;
        await new Promise((ok) => setTimeout(ok, 300));
        await device.queue.onSubmittedWorkDone();
        const backend = renderer.backend;
        const mediana = (l) => { l.sort((a, b) => a - b); return l[l.length >> 1]; };
        const raz = async (wl) => {
          obraz.pyl.wlacz(wl);
          const rys = [];
          for (let k = 0; k < probek; k++) {
            backend.trackTimestamp = true;
            obraz.rysuj(renderer, camera, 0);
            rys.push(await renderer.resolveTimestampsAsync('render'));
            backend.trackTimestamp = false;
            backend.timestampQueryPool?.render?.timestamps?.clear?.();
            await device.queue.onSubmittedWorkDone();
          }
          const t0 = performance.now();
          for (let k = 0; k < sciana; k++) {
            obraz.rysuj(renderer, camera, 0);
            if ((k + 1) % 8 === 0) await device.queue.onSubmittedWorkDone();
          }
          await device.queue.onSubmittedWorkDone();
          return { rysunekGpuMs: mediana(rys), scianaMs: (performance.now() - t0) / sciana };
        };
        const wl1 = await raz(true);
        const wyl = await raz(false);
        const wl2 = await raz(true);
        obraz.swiatlaWlacz(false);
        const bezSwiatla = await raz(true);
        obraz.swiatlaWlacz(true);
        const samPass = [];
        for (let k = 0; k < probek; k++) {
          backend.trackTimestamp = true;
          obraz.pyl.rysuj(renderer, camera);
          renderer.setRenderTarget(null);
          samPass.push(await renderer.resolveTimestampsAsync('render'));
          backend.trackTimestamp = false;
          backend.timestampQueryPool?.render?.timestamps?.clear?.();
          await device.queue.onSubmittedWorkDone();
        }
        stan.rysowac = true;
        return { wl1, wyl, wl2, bezSwiatla, samPassMs: mediana(samPass), w: renderer.domElement.width, h: renderer.domElement.height, cel: [obraz.pyl.rt.width, obraz.pyl.rt.height] };
      },
      /** Harness, LOD obrazu (metoda G planu): koszt GPU każdego passa ze znaczników, na zamrożonej klatce, warianty [sloty, cień]. Bez kroków, najwyżej 60 kl/s. */
      async kosztLod(warianty = [[7, 7], [2, 2], [2, 1], [2, 0], [1, 1], [1, 0]], probek = 15) {
        stan.kroczyc = false;
        const rysowal = stan.rysowac;
        stan.rysowac = false;
        await new Promise((ok) => setTimeout(ok, 300));
        await device.queue.onSubmittedWorkDone();
        const backend = renderer.backend;
        const mediana = (l) => { l.sort((a, b) => a - b); return l[l.length >> 1]; };
        // AGENT: mapa cienia odświeża się najwyżej raz na klatkę rAF (ShadowNode.updateBefore po frameId), więc pętla bez czekania na rAF mierzy głównie klatki BEZ passa cienia, a mediana nie widzi go wcale. Także dlatego rysunekGpuMs z diag i renderGpuMs z kosztKlatki są zaniżone o cień.
        const zmierz = async () => {
          const pasy = { gleb: [], ssao: [], pyl: [], hdr: [], cien: [], wyj: [], razem: [] };
          for (let k = 0; k < probek; k++) {
            await new Promise((ok) => requestAnimationFrame(ok));
            backend.trackTimestamp = true;
            obraz.rysuj(renderer, camera, 0);
            await renderer.resolveTimestampsAsync('render');
            backend.trackTimestamp = false;
            // Kolejność w mapie to kolejność otwierania passów. Pass cienia otwiera się w środku rysunku sceny, zaraz po nim.
            const t = [...backend.timestampQueryPool.render.timestamps.values()];
            backend.timestampQueryPool.render.timestamps.clear();
            pasy.gleb.push(t[0]); pasy.ssao.push(t[1]); pasy.pyl.push(t[2]); pasy.hdr.push(t[3]);
            pasy.cien.push(t.length > 5 ? t[4] : 0);
            pasy.wyj.push(t[t.length - 1]);
            pasy.razem.push(t.reduce((a, b) => a + b, 0));
            await device.queue.onSubmittedWorkDone();
          }
          for (const q in pasy) pasy[q] = mediana(pasy[q]);
          return pasy;
        };
        const { sloty: s0, cien: c0 } = obraz.lod;
        const wy = [];
        for (const [sloty, cien] of warianty) {
          obraz.ustawLod({ sloty, cien });
          const p = await zmierz();
          const l = obraz.lod;
          wy.push({ sloty, cienSloty: cien, instRysunek: l.instRysunek, instCien: l.instCien, wierzcholkiMln: (24 * (2 * l.instRysunek + (cien > 0 ? l.instCien : 0))) / 1e6, ...p });
        }
        obraz.ustawLod({ sloty: s0, cien: c0 });
        // Kernele obrazu (kObraz, kGruz, pył) nie zależą od slotów. Na końcu, bo ruszają stan.
        const komp = [];
        for (let k = 0; k < 7; k++) komp.push(await wok.zmierzListe(obraz.listaObrazu));
        stan.rysowac = rysowal;
        return { n: obraz.n, krok: stan.krok, w: renderer.domElement.width, h: renderer.domElement.height, kerneleObrazuMs: mediana(komp), wy };
      },
      /** Harness, górna granica kosztu obrazu: każdy węzeł uszkodzony (d = 1), wszystkie sloty czynne. Ramy i bity wracają do stanu początkowego, więc potem tylko pomiar albo reset, bez kroków. */
      uszkodzWszystko() {
        const r = obraz.atrybuty.rama;
        for (let i = 0; i < obraz.n; i++) r.array[12 * i + 3] = 1;
        r.needsUpdate = true;
        obraz.pelnyObraz(true);
        stan.pelnyOd = Infinity;
      },
      bezZegara(b = true) { stan.kroczyc = !b; },
    },
  });
}
