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

export const DZWIEKI_OBSZAROW_DOMYSLNE = Object.freeze({
  spoznienieS: 0.6,          // zdarzenie osi warpa NPC zastane później — bez dźwięku
  stopienieMin: 0.45,        // głośność pętli stopienia na starcie (rośnie do 1 przy detonacji)
  stopienieZapas: 0.35,      // pętla gra jeszcze tyle po planowanym końcu stopienia (detonacja w następnym kroku)
  tunelGlos: 1,
  mostekGlos: 1
});

const SLOTY_RDZENIA = 8;
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
    rdzenStopienie: 0, rdzenDetonacja: 0, klik: 0
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
    for (let i = 0; i < SLOTY_RDZENIA; i++) slotHost[i] = null;
  }

  return {
    warpGracza, osieWarpa, maskowanieGracza, maskowanieZdarzenie, rdzenStopienie, rdzenDetonacja, tloMostka, klik,
    klatka, wyzeruj, stats, ustawienia: U
  };
}
