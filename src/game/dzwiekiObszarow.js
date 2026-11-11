// Reżyser dźwięków obszarów gry, które były nieme (reguła `dzwiek`, tabela src/audio/dzwiekiSwiata.js). Czysty:
// bez Web Audio, DOM i `window` — klej w index.html podaje stan gry (raz na klatkę albo z gotowych haków) i ujście
// `{ graj(id, x, y, głos), petla(klucz, id, głos, x, y) }` (warstwa `utworzDzwiekiGry`). Zdarzenia z RÓŻNICY STANU:
// pierwszy odczyt tylko zapamiętuje (gra zastana w warpie / w maskowaniu nie daje dźwięku startu).
// Bez alokacji na klatkę: klucze pętli policzone z góry, sloty stopienia w stałej tablicy; WeakSet osi warpa NPC
// dostaje wpis tylko przy zdarzeniu (jak `stepWarpBurstShakes`).
//
// Obszary (etap 1):
//   warp gracza  — `warp.state`: idle → charging (`warpLadowanie`, ładowanie 0,8 s), charging → active (`warpKop`),
//                  active → pętla `warpTunel`, active → idle (`warpZejscie`); przerwane ładowanie nie gra nic.
//                  TRAVEL TO i POWRÓT idą tym samym automatem.
//   warp NPC     — rekordy `warpTraffic.records` (oś `rec.fx`, zegar `warpTraffic.time`): przylot — zwiastun od
//                  `fx.t0` (`warpZwiastun`), wyrzut przy `fx.tBrake` (`przylotWyrzut`); odlot — ładowanie od `fx.t0`
//                  (`warpZwiastun`), skok przy `fx.tDive` (`warpKop`, w punkcie skoku `fx.cx/cy`). Zdarzenie zastane
//                  później niż `SPOZNIENIE_S` po swojej chwili nie gra (wczytanie zapisu, skok kamery).
//   maskowanie   — `cloak.state` gracza: off → engaging (`maskaWl`), on/engaging → revealing (`maskaWyl`), nowe
//                  `cloak.lastBreak` z `forced` (ogień, taran, trafienie, energia) → `maskaZerwanie` zamiast wyłączenia.
//   rdzeń        — hak `onState` (`to === 'meltdown'`, `duration`) otwiera slot pętli `reaktorStopienie` (głośność
//                  rośnie z postępem stopienia), `onDetonate` zamyka sloty gospodarza i gra `reaktorWybuch`.
//   tło mostka   — pętla `mostek` bez położenia, gdy klej uzna lot za „na pokładzie” (`tloMostka(obecność)`).
//   klik         — `klik()` z delegacji kliknięć przycisków interfejsu.
//
// Obszary (etap 2):
//   rakiety      — `ostrzezenieRakiet(n)`: pętla `rakietyOstrzezenie`, dopóki n > 0 wrogich rakiet / torped z celem =
//                  gracz (licznik `liczRakietyNaGracza` po buforze zagrożeń obrony punktowej, bez alokacji).
//   hipercruise  — `hypercruise.state`: idle → spool (`hcRozruch`), spool → active (`hcKop`), active → pętla `hcLot`,
//                  active → drop / idle (`hcWyjscie`); przerwany rozruch nie gra nic.
//   silniki obcych — `silnikiObcych(npcs, …)`: do `maks` najbliższych kamerze okrętów z ciągiem MAIN > próg, w zasięgu
//                  kadru; ujście `silnik(npc, ciąg, dopalacz, x, y)` (warstwa: `silnikObcy`, synteza MAIN).
//
// Obszary (etap 3, myśliwce): wyrzut (`ejectFighterFromTube`), zrzut i wybuch bomby (`FighterBombs`), lądowanie
// (`landFighter`) i działko (strzelec `fighter` / `interceptor` na szynie strzałów) — klej woła `zdarzenie` warstwy
// wprost; tu tylko PRZELOT: `przelotyMysliwcow(lista, …)` — najbliższe podejście myśliwca do środka kadru (odległość
// przestaje maleć) bliżej niż `przelotPromien` × półprzekątna, z prędkością ≥ `przelotMinV`, raz na `przelotOdstep`
// na myśliwca i raz na `przelotGlobalny` w ogóle. Stan per myśliwiec w WeakMap (wpis raz na życie myśliwca, nie na klatkę).
//
// Obszary (etap 4, praca w przestrzeni): pierścienie zdarzeń czytane własnym kursorem (WeakMap pierścień → indeks;
// pierwsze spotkanie pomija stare zdarzenia, przepełnienie — najnowsze), jak `repairFxEvents.js`:
//   kopalnia     — `kopalnia(rig, x, y)`: pętle `kopalniaLaser` (strzał LPM i dron z laserem), `kopalniaPila` (piła
//                  w ruchu), `wiazkaZbiorki` (wiązka T); pierścień `rig.fx` (układ skał: świat = (x, −y)): BLAST →
//                  `skalaWybuch`, CONTAINED → `skalaWybuch` ciszej, SPLIT → `skalaPekniecie`, COLLECT → `urobekZbior`.
//   zbiórka łupu — `zbiorka(liczbaCelow, x, y)`: pętla `wiazkaZbiorki`, dopóki wiązka ma cele (`targetCount`).
//   drony        — `dronyNaprawcze(rigs)`: pierścień `rig.fx` (LAUNCH `dronWylot`, DOCK `dronDok`, REGROWN `dronLata`,
//                  DRONE_LOST `wybuchMaly`), pętla `dronSpaw` na rig przy pierwszym dronie w stanie WORK.
//   alarmy okrętu — `alarmOkretu(id, aktywny, głośność)` z szyny `ShipAlarm` (jeden alarm naraz, głośność opada po
//                  4 s): MISSILE → pętla `rakietyOstrzezenie` (ten sam klucz co ostrzeżenie z bufora zagrożeń — jeden głos),
//                  HULL i REACTOR → pętla `alarm`, BRIDGE / SHIELD / DETECTED → jednorazowo `komunikat` przy włączeniu.
//   kapsuły      — `kapsuly(st)`: z liczności stanów (PENDING maleje → wyrzut, COAST → FLY → zapłon; indeksy puli
//                  przestawiają się przy usuwaniu, więc różnica liczności, nie indeksów), położenie — kapsuła w stanie.

export const DZWIEKI_OBSZAROW_DOMYSLNE = Object.freeze({
  silnikProg: 0.06,          // ciąg MAIN okrętu, od którego jest słyszalny
  silnikZasieg: 1.6,         // okręt najdalej tyle półprzekątnych kadru od środka (dalej `polozenie` i tak wycisza)
  silnikMaks: 3,             // tyle najbliższych okrętów naraz (głosy syntezy)
  przelotPromien: 0.4,       // przelot myśliwca: najbliższe podejście bliżej niż tyle półprzekątnych kadru
  przelotMinV: 150,          // … z prędkością co najmniej [j/s]
  przelotOdstep: 3,          // … i najwyżej raz na tyle sekund na myśliwca
  przelotGlobalny: 0.6,      // … i najwyżej jeden przelot na tyle sekund w ogóle (rój 50 myśliwców to nie 50 świstów)
  spoznienieS: 0.6,          // zdarzenie osi warpa NPC zastane później — bez dźwięku
  stopienieMin: 0.45,        // głośność pętli stopienia na starcie (rośnie do 1 przy detonacji)
  stopienieZapas: 0.35,      // pętla gra jeszcze tyle po planowanym końcu stopienia (detonacja w następnym kroku)
  tunelGlos: 1,
  mostekGlos: 1
});

const SLOTY_RDZENIA = 8;
/** Kopie stałych gry (strażnik równości w teście): `MINING_FX` (asteroidMiningRig.js), `REPAIR_FX` / `DRONE_STATE`
 * (repairRig.js), `POD_STATE` (escapePods.js) — reżyser nie importuje modułów gry. */
export const FX_KOPALNI = Object.freeze({ BLAST: 1, CONTAINED: 2, SPLIT: 3, COLLECT: 4, ACTIVATE: 5 });
export const FX_DRONOW = Object.freeze({ REGROWN: 1, DRONE_LOST: 2, LAUNCH: 3, DOCK: 4, SOCKET: 5, WELD_START: 6 });
export const DRON_PRACA = 2;
export const KAPSULA = Object.freeze({ PENDING: 0, COAST: 1, FLY: 2 });
/** Kopia `SHIP_ALARM` (src/game/shipAlarms.js; strażnik równości w teście). */
export const ALARM = Object.freeze({ NONE: 0, REACTOR: 1, HULL: 2, MISSILE: 3, BRIDGE: 4, SHIELD: 5, DETECTED: 6 });
const KLUCZE_RDZENIA = Object.freeze(Array.from({ length: SLOTY_RDZENIA }, (_, i) => `rdzen:${i}`));

/**
 * @param {{ graj(id: string, x: number, y: number, glos?: number): boolean,
 *           petla(klucz: string, id: string, glos: number, x: number, y: number): void }} ujscie
 * @param {{ pozycja?: (host: object, out: {x:number,y:number}) => boolean, ustawienia?: object }} [opts]
 *   `pozycja` — położenie gospodarza rdzenia w świecie gry (domyślnie `host.pos` albo `host.x/y`); false — zniknął.
 */
export function utworzRezyserObszarow(ujscie, opts = {}) {
  const U = { ...DZWIEKI_OBSZAROW_DOMYSLNE, ...(opts.ustawienia || {}) };
  const pozycja = opts.pozycja || ((h, out) => {
    if (!h || h.dead) return false;
    const p = h.pos || h;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    out.x = p.x;
    out.y = p.y;
    return true;
  });
  const stats = {
    warpLadowanie: 0, warpSkok: 0, warpZejscie: 0, warpPrzerwane: 0,
    przylotZwiastun: 0, przylotWyrzut: 0, odlotLadowanie: 0, odlotSkok: 0, spoznione: 0,
    maskowanieWl: 0, maskowanieWyl: 0, maskowanieZerwane: 0,
    rdzenStopienie: 0, rdzenDetonacja: 0, klik: 0,
    hcRozruch: 0, hcWejscie: 0, hcWyjscie: 0, hcPrzerwany: 0, rakietyKlatki: 0, mysliwiecPrzelot: 0,
    skalaWybuch: 0, skalaPekniecie: 0, urobekZbior: 0, dronWylot: 0, dronDok: 0, dronLata: 0, dronUtracony: 0,
    kapsulaWyrzut: 0, kapsulaSilnik: 0, alarmKomunikat: 0, alarmKlatki: 0
  };

  // --- warp gracza
  let warpPoprz = null;
  function warpGracza(stan, x, y) {
    const s = stan || 'idle';
    const p = warpPoprz;
    warpPoprz = s;
    if (s === 'active') ujscie.petla('warp:tunel', 'warpTunel', U.tunelGlos, x, y);
    if (p === null || p === s) return;
    if (s === 'charging' && p === 'idle') { stats.warpLadowanie++; ujscie.graj('warpLadowanie', x, y, 1); }
    else if (s === 'active' && p !== 'active') { stats.warpSkok++; ujscie.graj('warpKop', x, y, 1); }
    else if (p === 'active' && s !== 'active') { stats.warpZejscie++; ujscie.graj('warpZejscie', x, y, 1); }
    else if (p === 'charging' && s === 'idle') stats.warpPrzerwane++;
  }

  // --- warp NPC (oś przylotu / odlotu w rejestrze warpTraffic)
  const widzianyZwiastun = new WeakSet();
  const widzianyWyrzut = new WeakSet();
  function zdarzenieOsi(zbior, fx, t, czas, nazwa, id, x, y) {
    if (!(czas >= t) || zbior.has(fx)) return;
    zbior.add(fx);
    if (czas - t > U.spoznienieS) { stats.spoznione++; return; }
    stats[nazwa]++;
    ujscie.graj(id, x, y, 1);
  }
  function osieWarpa(rekordy, czas) {
    if (!rekordy) return;
    for (let i = 0; i < rekordy.length; i++) {
      const rec = rekordy[i];
      const fx = rec ? rec.fx : null;
      if (!fx) continue;
      if (rec.kind === 'arrival') {
        zdarzenieOsi(widzianyZwiastun, fx, fx.t0, czas, 'przylotZwiastun', 'warpZwiastun', fx.x, fx.y);
        zdarzenieOsi(widzianyWyrzut, fx, fx.tBrake, czas, 'przylotWyrzut', 'przylotWyrzut', fx.x, fx.y);
      } else if (rec.kind === 'departure') {
        zdarzenieOsi(widzianyZwiastun, fx, fx.t0, czas, 'odlotLadowanie', 'warpZwiastun', fx.x, fx.y);
        zdarzenieOsi(widzianyWyrzut, fx, fx.tDive, czas, 'odlotSkok', 'warpKop',
          Number.isFinite(fx.cx) ? fx.cx : fx.x, Number.isFinite(fx.cy) ? fx.cy : fx.y);
      }
    }
  }

  // --- maskowanie gracza
  let maskaPoprz = null;
  let zerwaniePoprz = null;
  function maskowanieGracza(stan, ostatnieZerwanie, x, y) {
    const s = stan || 'off';
    const p = maskaPoprz;
    const z = ostatnieZerwanie || null;
    const zPoprz = zerwaniePoprz;
    maskaPoprz = s;
    zerwaniePoprz = z;
    if (p === null) return;
    // `lastBreak` dostaje też ręczne wyłączenie (`forced: false`) — zerwanie to tylko `forced: true` (cloak.js)
    if (z && z !== zPoprz && z.forced) { stats.maskowanieZerwane++; ujscie.graj('maskaZerwanie', x, y, 1); return; }
    if (p === s) return;
    if (s === 'engaging' && p !== 'on') { stats.maskowanieWl++; ujscie.graj('maskaWl', x, y, 1); }
    else if (s === 'revealing') { stats.maskowanieWyl++; ujscie.graj('maskaWyl', x, y, 1); }
  }
  /** Maskowanie innej jednostki z gotowej szyny (fregata zwiadu, `ScoutBay.on`): 'wl' | 'wyl' | 'zerwanie'. */
  function maskowanieZdarzenie(rodzaj, x, y) {
    if (rodzaj === 'wl') { stats.maskowanieWl++; ujscie.graj('maskaWl', x, y, 1); }
    else if (rodzaj === 'wyl') { stats.maskowanieWyl++; ujscie.graj('maskaWyl', x, y, 1); }
    else if (rodzaj === 'zerwanie') { stats.maskowanieZerwane++; ujscie.graj('maskaZerwanie', x, y, 1); }
  }

  // --- rdzeń reaktora
  const slotHost = new Array(SLOTY_RDZENIA).fill(null);
  const slotT0 = new Float64Array(SLOTY_RDZENIA);
  const slotDur = new Float64Array(SLOTY_RDZENIA);
  const poz = { x: 0, y: 0 };
  /** Hak `ReactorGame` `onState` z `to === 'meltdown'`: `czas` — zegar gry [s], `trwanie` — `ev.duration`. */
  function rdzenStopienie(host, czas, trwanie) {
    if (!host) return;
    let wolny = -1;
    for (let i = 0; i < SLOTY_RDZENIA; i++) {
      if (slotHost[i] === host) { wolny = i; break; }
      if (wolny < 0 && slotHost[i] === null) wolny = i;
    }
    if (wolny < 0) return;
    if (slotHost[wolny] !== host) stats.rdzenStopienie++;
    slotHost[wolny] = host;
    slotT0[wolny] = czas;
    slotDur[wolny] = Math.max(0.05, Number(trwanie) || 0);
  }
  /** Hak `onDetonate(ev)`: wybuch w (x, y); pętle stopienia gospodarza gasną (brak odświeżenia). */
  function rdzenDetonacja(host, x, y) {
    for (let i = 0; i < SLOTY_RDZENIA; i++) if (slotHost[i] === host && host) slotHost[i] = null;
    stats.rdzenDetonacja++;
    ujscie.graj('reaktorWybuch', x, y, 1);
  }

  // --- tło mostka, klik
  function tloMostka(obecnosc) {
    const g = Math.max(0, Math.min(1, Number(obecnosc) || 0)) * U.mostekGlos;
    if (g > 0.003) ujscie.petla('mostek', 'mostek', g, NaN, NaN);
  }
  function klik() {
    stats.klik++;
    ujscie.graj('klik', NaN, NaN, 1);
  }

  // --- etap 2: rakiety w gracza, hipercruise, silniki obcych
  function ostrzezenieRakiet(liczba, glos = 1) {
    if (!(liczba > 0)) return;
    stats.rakietyKlatki++;
    ujscie.petla('rakiety', 'rakietyOstrzezenie', glos, NaN, NaN);
  }

  let alarmPoprz = ALARM.NONE;
  /** Alarm okrętu gracza z szyny `ShipAlarm` (stan co klatkę): `id`, `aktywny`, `glos` — `state.volume`. */
  function alarmOkretu(id, aktywny, glos) {
    const a = aktywny ? id | 0 : ALARM.NONE;
    const g = glos > 0 ? glos : 0;
    if (a !== ALARM.NONE) stats.alarmKlatki++;
    if (a === ALARM.MISSILE) ujscie.petla('rakiety', 'rakietyOstrzezenie', g, NaN, NaN);
    else if (a === ALARM.HULL || a === ALARM.REACTOR) ujscie.petla('alarm', 'alarm', g, NaN, NaN);
    if (a !== alarmPoprz && (a === ALARM.BRIDGE || a === ALARM.SHIELD || a === ALARM.DETECTED)) {
      stats.alarmKomunikat++;
      ujscie.graj('komunikat', NaN, NaN, g > 0.35 ? g : 0.35);
    }
    alarmPoprz = a;
  }

  let hcPoprz = null;
  function hipercruise(stan, x, y) {
    const s = stan || 'idle';
    const p = hcPoprz;
    hcPoprz = s;
    if (s === 'active') ujscie.petla('hc:lot', 'hcLot', 1, x, y);
    if (p === null || p === s) return;
    if (s === 'spool') { stats.hcRozruch++; ujscie.graj('hcRozruch', x, y, 1); }
    else if (s === 'active' && p === 'spool') { stats.hcWejscie++; ujscie.graj('hcKop', x, y, 1); }
    else if (p === 'active') { stats.hcWyjscie++; ujscie.graj('hcWyjscie', x, y, 1); }
    else if (p === 'spool' && s === 'idle') stats.hcPrzerwany++;
  }

  const wybrane = new Array(8).fill(null);
  const wybraneD = new Float64Array(8);
  /**
   * Silniki obcych okrętów: z `npcs` do `silnikMaks` najbliższych środka kadru (cx, cy) okrętów z ciągiem MAIN
   * (`ciag(npc)` ≥ próg) w zasięgu `silnikZasieg` × półprzekątna `polD`; `slyszalny(npc)` — filtr kleju (żywy, nie
   * ukryty mgłą ani maską, nie gracz). Ujście `silnik(npc, ciąg, dopalacz, x, y)`.
   */
  function silnikiObcych(npcs, cx, cy, polD, ciag, dopalacz, slyszalny, silnik) {
    const maks = Math.min(wybrane.length, U.silnikMaks | 0);
    let n = 0;
    const zasieg = U.silnikZasieg * polD;
    const z2 = zasieg * zasieg;
    if (npcs) for (let i = 0; i < npcs.length; i++) {
      const e = npcs[i];
      if (!e || !slyszalny(e)) continue;
      const c = ciag(e);
      if (!(c >= U.silnikProg)) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (!(d2 <= z2)) continue;
      // wstawienie do krótkiej listy najbliższych (posortowanej rosnąco)
      let k = n < maks ? n++ : maks;
      if (k === maks && !(d2 < wybraneD[maks - 1])) continue;
      if (k === maks) k = maks - 1;
      while (k > 0 && wybraneD[k - 1] > d2) { wybrane[k] = wybrane[k - 1]; wybraneD[k] = wybraneD[k - 1]; k--; }
      wybrane[k] = e;
      wybraneD[k] = d2;
    }
    for (let i = 0; i < n; i++) {
      const e = wybrane[i];
      silnik(e, ciag(e), dopalacz(e), e.x, e.y);
      wybrane[i] = null;
    }
    return n;
  }

  // --- etap 3: przelot myśliwca blisko środka kadru
  const przeloty = new WeakMap(); // myśliwiec → { d, t } (poprzednia odległość, czas ostatniego przelotu)
  let przelotOstatni = -1e9;
  /**
   * @param {object[]} lista myśliwce (encje z x, y, vx, vy); `slyszalny(e)` — filtr kleju (żywy, nie ukryty, myśliwiec)
   * @param {number} czas zegar gry [s]
   */
  function przelotyMysliwcow(lista, cx, cy, polD, czas, slyszalny) {
    if (!lista) return;
    const R = U.przelotPromien * polD;
    const v2min = U.przelotMinV * U.przelotMinV;
    for (let i = 0; i < lista.length; i++) {
      const e = lista[i];
      if (!e || !slyszalny(e)) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let st = przeloty.get(e);
      if (!st) { st = { d, t: -1e9 }; przeloty.set(e, st); continue; }
      const vx = Number(e.vx) || 0;
      const vy = Number(e.vy) || 0;
      // najbliższe podejście: poprzednio bliżej niż R, teraz dalej (oddala się), z prędkością
      if (st.d < R && d > st.d && vx * vx + vy * vy >= v2min && czas - st.t >= U.przelotOdstep
        && czas - przelotOstatni >= U.przelotGlobalny) {
        st.t = czas;
        przelotOstatni = czas;
        stats.mysliwiecPrzelot++;
        ujscie.graj('mysliwiecPrzelot', e.x, e.y, 1);
      }
      st.d = d;
    }
  }

  // --- etap 4: pierścienie zdarzeń (kopalnia, drony naprawcze)
  const kursory = new WeakMap(); // pierścień (tablica `fx`) → przeczytane do
  function czytajPierscien(fx, zapis, naZdarzenie) {
    if (!fx || !fx.length) return;
    let cur = kursory.get(fx);
    if (cur === undefined) { kursory.set(fx, zapis); return; }
    const cap = fx.length;
    if (zapis - cur > cap) cur = zapis - cap;
    for (; cur < zapis; cur++) naZdarzenie(fx[cur % cap]);
    kursory.set(fx, cur);
  }
  const zdarzenieKopalni = (e) => {
    const x = e.x;
    const y = -e.y; // układ skał → świat gry
    switch (e.kind) {
      case FX_KOPALNI.BLAST: stats.skalaWybuch++; ujscie.graj('skalaWybuch', x, y, 1); break;
      case FX_KOPALNI.CONTAINED: stats.skalaWybuch++; ujscie.graj('skalaWybuch', x, y, 0.55); break;
      case FX_KOPALNI.SPLIT: stats.skalaPekniecie++; ujscie.graj('skalaPekniecie', x, y, 1); break;
      case FX_KOPALNI.COLLECT: stats.urobekZbior++; ujscie.graj('urobekZbior', x, y, 1); break;
      default: break;
    }
  };
  /** Kopalnia gracza (`MiningRig`): pętle pracy i pierścień zdarzeń. (x, y) — statek (pętle). */
  function kopalnia(rig, x, y) {
    if (!rig) return;
    if (rig.firing && rig.drones) {
      for (let i = 0; i < rig.drones.length; i++) {
        if (rig.drones[i] && rig.drones[i].laserOn) { ujscie.petla('kopalnia:laser', 'kopalniaLaser', 1, x, y); break; }
      }
    }
    if (rig.saw && rig.saw.active && !rig.saw.done) ujscie.petla('kopalnia:pila', 'kopalniaPila', 1, x, y);
    if (rig.tractorOn) ujscie.petla('kopalnia:wiazka', 'wiazkaZbiorki', 1, x, y);
    czytajPierscien(rig.fx, rig.fxWrite, zdarzenieKopalni);
  }
  /** Wiązka ZBIÓRKA łupu: pętla, dopóki ma cele. */
  function zbiorka(liczbaCelow, x, y) {
    if (liczbaCelow > 0) ujscie.petla('zbiorka', 'wiazkaZbiorki', 1, x, y);
  }

  const zdarzenieDrona = (f) => {
    switch (f.kind) {
      case FX_DRONOW.LAUNCH: stats.dronWylot++; ujscie.graj('dronWylot', f.x, f.y, 1); break;
      case FX_DRONOW.DOCK: stats.dronDok++; ujscie.graj('dronDok', f.x, f.y, 1); break;
      case FX_DRONOW.REGROWN: stats.dronLata++; ujscie.graj('dronLata', f.x, f.y, 1); break;
      case FX_DRONOW.DRONE_LOST: stats.dronUtracony++; ujscie.graj('wybuchMaly', f.x, f.y, 0.7); break;
      default: break;
    }
  };
  const kluczeSpawu = new WeakMap(); // rig → klucz pętli (tekst raz na rig)
  let nrSpawu = 0;
  /** Drony naprawcze wszystkich rigów (`RepairSwarm.rigs`): pierścienie zdarzeń i pętla spawu. */
  function dronyNaprawcze(rigs) {
    if (!rigs) return;
    for (let r = 0; r < rigs.length; r++) {
      const rig = rigs[r];
      if (!rig) continue;
      czytajPierscien(rig.fx, rig.fxWrite, zdarzenieDrona);
      const dr = rig.drones;
      if (!dr) continue;
      for (let i = 0; i < dr.length; i++) {
        const d = dr[i];
        if (!d || d.state !== DRON_PRACA) continue;
        let k = kluczeSpawu.get(rig);
        if (k === undefined) { k = 'spaw:' + (nrSpawu++); kluczeSpawu.set(rig, k); }
        ujscie.petla(k, 'dronSpaw', 1, d.wx, d.wy);
        break;
      }
    }
  }

  let kapsulyPending = -1;
  let kapsulyCoast = 0;
  /** Kapsuły ratunkowe (pula `stepEscapePods`: `count`, `state[i]`, `x[i]`, `y[i]`). */
  function kapsuly(st) {
    if (!st) return;
    let nP = 0, nC = 0, iC = -1, iF = -1;
    for (let i = 0; i < st.count; i++) {
      const s = st.state[i];
      if (s === KAPSULA.PENDING) nP++;
      else if (s === KAPSULA.COAST) { nC++; if (iC < 0) iC = i; }
      else if (s === KAPSULA.FLY && iF < 0) iF = i;
    }
    if (kapsulyPending < 0) { kapsulyPending = nP; kapsulyCoast = nC; return; }
    const wyrzut = kapsulyPending > nP ? kapsulyPending - nP : 0;
    const zaplon = kapsulyCoast + wyrzut > nC ? kapsulyCoast + wyrzut - nC : 0;
    kapsulyPending = nP;
    kapsulyCoast = nC;
    if (wyrzut > 0 && iC >= 0) { stats.kapsulaWyrzut += wyrzut; ujscie.graj('kapsulaWyrzut', st.x[iC], st.y[iC], 1); }
    if (zaplon > 0 && iF >= 0) { stats.kapsulaSilnik += zaplon; ujscie.graj('kapsulaSilnik', st.x[iF], st.y[iF], 1); }
  }

  /** Raz na klatkę: pętle stopienia (głośność z postępu, położenie gospodarza). `czas` — zegar gry [s]. */
  function klatka(czas) {
    for (let i = 0; i < SLOTY_RDZENIA; i++) {
      const h = slotHost[i];
      if (h === null) continue;
      const u = (czas - slotT0[i]) / slotDur[i];
      if (u > 1 + U.stopienieZapas / slotDur[i] || u < -0.5 || !pozycja(h, poz)) { slotHost[i] = null; continue; }
      const k = u < 0 ? 0 : u > 1 ? 1 : u;
      ujscie.petla(KLUCZE_RDZENIA[i], 'reaktorStopienie', U.stopienieMin + (1 - U.stopienieMin) * k, poz.x, poz.y);
    }
  }

  function wyzeruj() {
    warpPoprz = null;
    maskaPoprz = null;
    zerwaniePoprz = null;
    hcPoprz = null;
    kapsulyPending = -1;
    alarmPoprz = ALARM.NONE;
    for (let i = 0; i < SLOTY_RDZENIA; i++) slotHost[i] = null;
  }

  return {
    warpGracza, osieWarpa, maskowanieGracza, maskowanieZdarzenie, rdzenStopienie, rdzenDetonacja, tloMostka, klik,
    ostrzezenieRakiet, alarmOkretu, hipercruise, silnikiObcych, przelotyMysliwcow, kopalnia, zbiorka, dronyNaprawcze, kapsuly,
    klatka, wyzeruj, stats, ustawienia: U
  };
}

/**
 * Wrogie rakiety i torpedy z celem = gracz w buforze zagrożeń obrony punktowej (`_pdEnemyRocketBuffer` w `ciwsStep`;
 * rakieta 3D — cel w `rb.slot.target`, pocisk z `bullets` — `rb.target`). Bez alokacji.
 */
export function liczRakietyNaGracza(bufor, gracz) {
  if (!bufor || !gracz) return 0;
  let n = 0;
  for (let i = 0; i < bufor.length; i++) {
    const rb = bufor[i];
    if (!rb || rb.dead || !(rb.life > 0)) continue;
    const cel = rb.rocket3d ? (rb.slot ? rb.slot.target : null) : rb.target;
    if (cel === gracz) n++;
  }
  return n;
}
