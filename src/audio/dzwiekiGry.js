// Warstwa dźwięku gry (Web Audio, wątek gry). Render działa w workerze i dźwięku nie gra — ten moduł nie
// importuje niczego z src/3d ani src/vfx, a gra woła go z kleju w index.html (blok „DŹWIĘKI SCENY”).
//
// Decyzje (co zagrać, wariant, limit, położenie, poziom) liczy czysta logika `dzwiekiLogika.js`; tu są tylko węzły:
//   głosy → wejście → [pomiar przed] → kompresor (klej sumy) → limiter → głośność → [pomiar po] → wyjście
// Dźwięki z plików: public/sounds/ai/ (manifest.json — dźwięki ROBOCZE z generatora AI), wczytane i
// zdekodowane tylko te z tabeli `DZWIEKI`, poziom wyrównany przy wczytaniu (pomiar → wzmocnienie kategorii),
// pętle z bufora bez szwu (obcięta cisza MP3 + przenikanie końca w początek). Silnik MAIN i seria CIWS — synteza
// (`synteza.js` + `przepisySyntezy.js`) z wyjściem na to samo wejście szyny.
//
// Bez alokacji na klatkę: `klatka()` chodzi po tablicach, pomiar szczytu w tablicach wielokrotnego użytku; źródło
// Web Audio jest jednorazowe z natury — ogranicza je limit głosów, węzły głośności i panoramy są w puli.

import {
  DZWIEKI, DZWIEKI_SYNTEZY, ZDARZENIA, KATEGORIE, STRZAL_GRACZA, jestCiws, kategoriaBroniNpc, idPlikowSceny,
  zmierzPoziom, wzmocnienieWyrownania, buforPetliBezSzwu, wybierzWariant, utworzLimitGlosow, sciszenieTloku,
  polozenie, liniaWyboru, dbToGain, gainToDb
} from './dzwiekiLogika.js';
import { SoundEngine, paramDefaults } from './synteza.js';
import { engineMain, engineSide, gatling } from './przepisySyntezy.js';

const CZAS_PETLI_BEZ_ODSWIEZENIA = 0.25; // s — pętla nieodświeżona tyle czasu gaśnie (zdarzenie się skończyło)
const CZAS_WYGASZENIA_BEZ_KLATKI = 0.4; // s — pętla gaśnie w wątku audio, gdy klatki gry przestaną ją odświeżać
const CZAS_CIWS_BEZ_STRZALU = 0.16; // s — seria CIWS wygasa, gdy tyle nie było strzału
// Podbicie cichego sygnału przez kompresor + limiter szyny [dB] — z pomiaru 2026-11-11 (szum −50 dBFS przez te same
// nastawy w OfflineAudioContext: −50,0 → −42,8 dB; sam kompresor +6,1, sam limiter +1,1). Zmiana nastaw kompresora
// albo limitera = nowy pomiar tej stałej.
const PODBICIE_SZYNY_DB = 7.2;
// Poziom szyny [dB] po zdjęciu podbicia — zero: szyna tylko zdejmuje własne podbicie i nic nie ścisza (dodatkowe
// −4 dB z dnia naprawy cofnięte na polecenie użytkownika razem ze ściszeniami tabeli). Głośność ustawia suwak opcji.
const POZIOM_SZYNY_DB = 0;
const PROG_CIAGU_SIDE = 0.05; // ciąg burty, od którego silniki SIDE grają
const CZAS_SIDE_BEZ_CIAGU = 0.18; // s — silniki SIDE gasną, gdy tyle nie było ciągu (impulsy automatu dysz to jedna praca)

/**
 * @param {{ ctx: AudioContext, rand: () => number, kadr: () => ({x,y,polW,polH,zoom}), baza?: string,
 *           log?: Console, glosnosc?: number, tabela?: object }} opts
 * `tabela` — tabela dźwięków warstwy (domyślnie `DZWIEKI` sceny; hala K-7 — `DZWIEKI_HALI`); synteza (silnik,
 * CIWS) tylko w warstwie z tabelą sceny.
 */
export function utworzDzwiekiGry(opts) {
  const ctx = opts.ctx;
  const TAB = opts.tabela || DZWIEKI;
  const zSynteza = TAB === DZWIEKI;
  const rand = opts.rand;
  const log = opts.log || console;
  const baza = opts.baza || '/sounds/ai/';
  const kadrFn = opts.kadr;

  // --- szyna
  const wejscie = ctx.createGain();
  const pomiarPrzed = ctx.createAnalyser();
  pomiarPrzed.fftSize = 2048;
  const komp = ctx.createDynamicsCompressor();
  komp.threshold.value = -16;
  komp.knee.value = 6;
  komp.ratio.value = 4;
  komp.attack.value = 0.004;
  komp.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  // Kompresor przeglądarki (DynamicsCompressorNode) sam dokłada wzmocnienie wyrównujące zależne od progu i stopnia:
  // ta para (kompresor + limiter) podbija wszystko poniżej progu o `PODBICIE_SZYNY_DB`. Bez korekty silnik
  // i pojedyncze strzały grały o tyle głośniej, niż mówi tabela poziomów, a duże wybuchy (ściskane) prawie wcale —
  // miks był głośny i płaski (użytkownik: „wszystko jest za głośno, dopiero 30% głośności efektów było w miarę”).
  // `korekta` zdejmuje podbicie i ustawia poziom szyny (`POZIOM_SZYNY_DB`).
  const korekta = ctx.createGain();
  korekta.gain.value = dbToGain(POZIOM_SZYNY_DB - PODBICIE_SZYNY_DB);
  const glosnosc = ctx.createGain();
  glosnosc.gain.value = Number.isFinite(opts.glosnosc) ? opts.glosnosc : 1;
  const pomiarPo = ctx.createAnalyser();
  pomiarPo.fftSize = 2048;
  wejscie.connect(pomiarPrzed);
  wejscie.connect(komp);
  komp.connect(limiter);
  limiter.connect(korekta);
  korekta.connect(glosnosc);
  glosnosc.connect(pomiarPo);
  pomiarPo.connect(ctx.destination);
  const probkiPrzed = new Float32Array(pomiarPrzed.fftSize);
  const probkiPo = new Float32Array(pomiarPo.fftSize);

  // --- stan
  const dzwieki = new Map(); // id → { pliki: [nazwa], bufory: [AudioBuffer], wzm: [gain], pomiary, poprzedni }
  const wybor = Object.create(null); // id → 0 (losowo) | 1…n
  const wycisz = Object.create(null); // id → bool
  const zagral = Object.create(null);
  const ostrzezone = new Set();
  const limit = utworzLimitGlosow(TAB);
  const wynikLimitu = { aktywne: 0 };
  const poz = { glos: 1, pan: 0 };
  const stat = { szczytPrzed: 0, szczytPo: 0, przester: 0, glosyMax: 0, bledy: 0, zdarzenia: Object.create(null) };
  let glosyAktywne = 0;
  let wczytane = false;
  let ostatniaDlugosc = 0;
  let wylaczony = false;

  // --- szyna megafonu (spiker hali): pasmo głośnika, lekkie przesterowanie, echo wielkiej hali → wejście szyny
  let megafon = null;
  function wejscieMegafonu() {
    if (megafon) return megafon;
    const wej = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    hp.Q.value = 0.8;
    const pik = ctx.createBiquadFilter();
    pik.type = 'peaking';
    pik.frequency.value = 2000;
    pik.Q.value = 0.9;
    pik.gain.value = 5;
    const ksztalt = ctx.createWaveShaper();
    const krzywa = new Float32Array(1024);
    for (let i = 0; i < krzywa.length; i++) {
      const x = (i / (krzywa.length - 1)) * 2 - 1;
      krzywa[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
    }
    ksztalt.curve = krzywa;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.Q.value = 0.7;
    wej.connect(hp);
    hp.connect(pik);
    pik.connect(ksztalt);
    ksztalt.connect(lp);
    lp.connect(wejscie);
    // echo hali: dwa odbicia z gasnącym sprzężeniem przez dolnoprzepustowy (dalsze ściany, głośniki w głębi hali)
    for (const [czas, wet, fb] of [[0.21, 0.32, 0.3], [0.47, 0.2, 0.22]]) {
      const d = ctx.createDelay(1);
      d.delayTime.value = czas;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2400;
      const gw = ctx.createGain();
      gw.gain.value = wet;
      const gf = ctx.createGain();
      gf.gain.value = fb;
      lp.connect(d);
      d.connect(f);
      f.connect(gw);
      gw.connect(wejscie);
      f.connect(gf);
      gf.connect(d);
    }
    megafon = wej;
    return megafon;
  }

  // --- pula węzłów głosu jednorazowego (głośność + panorama), osobna na szynę (zwykła / megafon)
  const pule = { zwykla: [], megafon: [] };
  function wezGlos(szyna) {
    const naMegafon = szyna === 'megafon';
    const pula = naMegafon ? pule.megafon : pule.zwykla;
    let w = pula.pop();
    if (!w) {
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      g.connect(p);
      p.connect(naMegafon ? wejscieMegafonu() : wejscie);
      w = { g, p, src: null, koniec: null };
      w.koniec = () => {
        if (w.src) {
          try { w.src.disconnect(); } catch { /* już odłączony */ }
          w.src.onended = null;
          w.src = null;
        }
        glosyAktywne--;
        pula.push(w);
      };
    }
    return w;
  }

  function ostrzez(klucz, tekst) {
    if (ostrzezone.has(klucz)) return;
    ostrzezone.add(klucz);
    log.warn(`[Dźwięki] ${tekst}`);
  }

  // --- wczytanie
  async function wczytaj(ids = TAB === DZWIEKI ? idPlikowSceny() : Object.keys(TAB)) {
    let manifest = null;
    try {
      const r = await fetch(`${baza}manifest.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      manifest = await r.json();
    } catch (err) {
      ostrzez('manifest', `brak ${baza}manifest.json (${err?.message || err}) — scena bez dźwięków z plików`);
      wczytane = true;
      return;
    }
    const plikiId = new Map();
    for (const f of manifest?.pliki || []) {
      if (!f || !f.id || !f.plik) continue;
      if (!plikiId.has(f.id)) plikiId.set(f.id, []);
      plikiId.get(f.id).push(f);
    }
    const zadania = [];
    for (const id of ids) {
      const lista = (plikiId.get(id) || []).slice().sort((a, b) => (a.wariant || 0) - (b.wariant || 0));
      if (!lista.length) {
        ostrzez(`id:${id}`, `brak dźwięku "${id}" w manifest.json — cisza`);
        continue;
      }
      const d = TAB[id] || {};
      const wpis = { id, pliki: lista.map((f) => f.plik), bufory: new Array(lista.length).fill(null), wzm: new Array(lista.length).fill(1), pomiary: new Array(lista.length).fill(null), poprzedni: -1, petla: !!d.petla };
      dzwieki.set(id, wpis);
      lista.forEach((f, i) => {
        zadania.push((async () => {
          try {
            const r = await fetch(`${baza}${f.plik}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            let buf = await ctx.decodeAudioData(await r.arrayBuffer());
            const kanaly = [];
            for (let c = 0; c < buf.numberOfChannels; c++) kanaly.push(buf.getChannelData(c));
            if (wpis.petla) {
              const petla = buforPetliBezSzwu(kanaly, buf.sampleRate);
              const nb = ctx.createBuffer(petla.length, petla[0].length, buf.sampleRate);
              petla.forEach((ch, c) => nb.copyToChannel(ch, c));
              buf = nb;
              kanaly.length = 0;
              for (const ch of petla) kanaly.push(ch);
            }
            const pomiar = zmierzPoziom(kanaly, buf.sampleRate);
            wpis.pomiary[i] = { rmsDb: round1(pomiar.rmsDb), szczytDb: round1(pomiar.szczytDb) };
            wpis.wzm[i] = wzmocnienieWyrownania(pomiar, d.kat, d.poziom || 0);
            wpis.bufory[i] = buf;
          } catch (err) {
            stat.bledy++;
            ostrzez(`plik:${f.plik}`, `nie wczytano ${f.plik} (${err?.message || err}) — ten wariant gra ciszę`);
          }
        })());
      });
    }
    await Promise.all(zadania);
    wczytane = true;
  }

  // --- odtwarzanie jednorazowe
  /**
   * @param {string} id
   * @param {number} x @param {number} y — pozycja w świecie (NaN — środek, pełna głośność)
   * @param {number} [glos] mnożnik głośności zdarzenia (0…)
   * @returns {boolean} czy zagrał
   */
  function graj(id, x, y, glos = 1) {
    if (wylaczony || wycisz[id]) return false;
    const wpis = dzwieki.get(id);
    if (!wpis) {
      if (wczytane && !TAB[id]) ostrzez(`graj:${id}`, `dźwięk "${id}" spoza tabeli warstwy — cisza`);
      return false;
    }
    const d = TAB[id];
    let g = glos;
    let pan = 0;
    if (!d.ui) {
      polozenie(x, y, kadrFn ? kadrFn() : null, poz);
      g *= poz.glos;
      pan = poz.pan;
    }
    if (!(g > 0.003)) return false;
    const wi = wybierzWariant(wpis.pliki.length, wybor[id], rand(), wpis.poprzedni);
    const buf = wi >= 0 ? wpis.bufory[wi] : null;
    if (!buf) return false;
    const ton = d.ton ? 1 + (rand() - 0.5) * 2 * d.ton : 1;
    const teraz = ctx.currentTime;
    const zwloka = limit.przyjmij(id, teraz, buf.duration / ton, wynikLimitu);
    if (zwloka < 0) return false;
    wpis.poprzedni = wi;
    if (d.glos) g *= 1 + (rand() - 0.5) * 2 * d.glos;
    g *= sciszenieTloku(wynikLimitu.aktywne) * wpis.wzm[wi];
    const w = wezGlos(d.szyna);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (ton !== 1) src.playbackRate.value = ton;
    w.g.gain.value = g;
    w.p.pan.value = pan;
    src.connect(w.g);
    w.src = src;
    src.onended = w.koniec;
    src.start(teraz + zwloka);
    glosyAktywne++;
    if (glosyAktywne > stat.glosyMax) stat.glosyMax = glosyAktywne;
    zagral[id] = (zagral[id] || 0) + 1;
    ostatniaDlugosc = zwloka + buf.duration / ton;
    return true;
  }

  /** Zdarzenie gry (klucz `ZDARZENIA`) → dźwięk. Liczy zdarzenia także wtedy, gdy dźwięk nie zagrał. */
  function zdarzenie(nazwa, x, y, glos = 1) {
    stat.zdarzenia[nazwa] = (stat.zdarzenia[nazwa] || 0) + 1;
    const id = ZDARZENIA[nazwa];
    if (!id) return false;
    return graj(id, x, y, glos);
  }

  // --- pętle z plików (wiązka, tarcie, alarm)
  const petle = []; // { klucz, id, src, g, p, ostatnio, cel }
  /**
   * Pętla `id` pod kluczem `klucz` (np. 'zgrzyt', 'alarm', 'wiazka:12'): wołana co klatkę, dopóki zdarzenie trwa;
   * pierwsze wołanie startuje, brak odświeżenia przez `CZAS_PETLI_BEZ_ODSWIEZENIA` — wygasza.
   */
  function petla(klucz, id, glos, x, y) {
    if (wylaczony) return;
    const teraz = ctx.currentTime;
    let L = null;
    for (let i = 0; i < petle.length; i++) if (petle[i].klucz === klucz) { L = petle[i]; break; }
    const d = TAB[id] || {};
    let g = wycisz[id] ? 0 : glos;
    let pan = 0;
    if (!d.ui) {
      polozenie(x, y, kadrFn ? kadrFn() : null, poz);
      g *= poz.glos;
      pan = poz.pan;
    }
    if (!L) {
      if (!(g > 0.003)) return;
      const wpis = dzwieki.get(id);
      if (!wpis) return;
      let aktywne = 0;
      for (let i = 0; i < petle.length; i++) if (petle[i].id === id && petle[i].src) aktywne++;
      if (aktywne >= (d.limit || 2)) return;
      const wi = wybierzWariant(wpis.pliki.length, wybor[id], rand(), wpis.poprzedni);
      const buf = wi >= 0 ? wpis.bufory[wi] : null;
      if (!buf) return;
      wpis.poprzedni = wi;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true; // bufor przycięty i przenikający się (buforPetliBezSzwu) — pętla bez szwu
      const gn = ctx.createGain();
      gn.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(gn);
      gn.connect(p);
      p.connect(wejscie);
      src.start(teraz, rand() * buf.duration * 0.9);
      L = { klucz, id, src, g: gn, p, ostatnio: teraz, wzm: wpis.wzm[wi] };
      petle.push(L);
      glosyAktywne++;
      zagral[id] = (zagral[id] || 0) + 1;
    }
    L.ostatnio = teraz;
    // Bezpiecznik w wątku audio: każde odświeżenie odkłada wygaszenie o CZAS_WYGASZENIA_BEZ_KLATKI — gdy klatki gry
    // staną (karta w tle, wyjście do menu) i `klatka()` nie zatrzyma pętli, pętla gaśnie sama, nie gra w nieskończoność.
    L.g.gain.cancelScheduledValues(teraz);
    L.g.gain.setTargetAtTime(g * L.wzm, teraz, 0.06);
    L.g.gain.setTargetAtTime(0, teraz + CZAS_WYGASZENIA_BEZ_KLATKI, 0.1);
    L.p.pan.setTargetAtTime(pan, teraz, 0.05);
  }

  function zatrzymajPetle(i, teraz) {
    const L = petle[i];
    L.g.gain.cancelScheduledValues(teraz);
    L.g.gain.setTargetAtTime(0, teraz, 0.08);
    try { L.src.stop(teraz + 0.5); } catch { /* już zatrzymana */ }
    const src = L.src, g = L.g, p = L.p;
    src.onended = () => { try { src.disconnect(); g.disconnect(); p.disconnect(); } catch { /* ok */ } };
    glosyAktywne--;
    petle[i] = petle[petle.length - 1];
    petle.length--;
  }

  // --- synteza: silnik MAIN i CIWS
  let syntezator = null;
  function E() {
    if (!syntezator) syntezator = new SoundEngine(ctx, { rand, destination: wejscie, bypassMaster: true, reverb: 0.25 });
    return syntezator;
  }
  let silnik = null;
  let silnikCiag = -1;
  let silnikDopal = -1;
  /** Silnik MAIN gracza: ciąg 0…1, dopalacz (bool). Wołane co klatkę w scenie. */
  function silnikMain(ciag, dopalacz = false) {
    if (wylaczony) return;
    const c = Math.max(0, Math.min(1, Number(ciag) || 0));
    const b = dopalacz ? 1 : 0;
    if (wycisz.silnikMain) {
      if (silnik) { silnik.release(); silnik = null; zagral.silnikMain = zagral.silnikMain || 0; }
      return;
    }
    if (!silnik) {
      silnik = engineMain.play(E(), paramDefaults(engineMain, { throttle: c, boost: b }), { dist: 0, pan: 0, gain: dbToGain(DZWIEKI_SYNTEZY.silnikMain.poziom), reverb: 0.4 });
      silnikCiag = c;
      silnikDopal = b;
      zagral.silnikMain = (zagral.silnikMain || 0) + 1;
      return;
    }
    if (Math.abs(c - silnikCiag) > 0.02) { silnik.set('throttle', c); silnikCiag = c; }
    if (b !== silnikDopal) { silnik.set('boost', b); silnikDopal = b; }
  }

  let side = null;
  let sideCiag = -1;
  let sideOstatnio = 0;
  /**
   * Silniki SIDE gracza — praca ciągła (silnik rakietowy, nie syk): ciąg 0…1 mocniejszej burty, wołane co krok
   * fizyki w scenie. Poniżej progu nic nie gasi od razu: `klatka()` wygasza po `CZAS_SIDE_BEZ_CIAGU`, żeby
   * impulsy automatu dysz nie odpalały zapłonu raz za razem.
   */
  function silnikSide(ciag) {
    if (wylaczony) return;
    if (wycisz.silnikSide) {
      if (side) { side.release(); side = null; }
      return;
    }
    const c = Math.max(0, Math.min(1, Number(ciag) || 0));
    if (c < PROG_CIAGU_SIDE) return;
    sideOstatnio = ctx.currentTime;
    if (!side) {
      side = engineSide.play(E(), paramDefaults(engineSide, { throttle: c }), { dist: 0, pan: 0, gain: dbToGain(DZWIEKI_SYNTEZY.silnikSide.poziom), reverb: 0.3 });
      sideCiag = c;
      zagral.silnikSide = (zagral.silnikSide || 0) + 1;
      return;
    }
    if (Math.abs(c - sideCiag) > 0.03) { side.set('throttle', c); sideCiag = c; }
  }

  const ciws = []; // { klucz, h, ostatnio }
  /** Strzał CIWS strzelca `klucz` — seria z syntezy trwa, dopóki przychodzą strzały. */
  function ciwsStrzal(klucz, x, y) {
    if (wylaczony || wycisz.gatling) return;
    const teraz = ctx.currentTime;
    for (let i = 0; i < ciws.length; i++) {
      if (ciws[i].klucz === klucz) { ciws[i].ostatnio = teraz; return; }
    }
    if (ciws.length >= 3) return;
    const d = DZWIEKI_SYNTEZY.gatling;
    polozenie(x, y, kadrFn ? kadrFn() : null, poz);
    if (!(poz.glos > 0.01)) return;
    const h = gatling.play(E(), paramDefaults(gatling, {}), { dist: Math.max(0, 1 - poz.glos) * 0.6, pan: poz.pan, gain: dbToGain(d.poziom) * poz.glos });
    ciws.push({ klucz, h, ostatnio: teraz });
    zagral.gatling = (zagral.gatling || 0) + 1;
  }

  /** Strzał z szyny broni → dźwięk (gracz: tabela `STRZAL_GRACZA`; NPC: kategoria broni). */
  function strzal(weaponId, def, x, y, gracza, kluczStrzelca, isBeam = false) {
    stat.zdarzenia.strzal = (stat.zdarzenia.strzal || 0) + 1;
    if (jestCiws(weaponId)) { ciwsStrzal(`${kluczStrzelca}:${weaponId}`, x, y); return; }
    let id = gracza ? STRZAL_GRACZA[weaponId] : null;
    if (!id) id = kategoriaBroniNpc(weaponId, def);
    if (id === 'wiazka' || isBeam) { petla(`wiazka:${kluczStrzelca}`, 'wiazka', 1, x, y); return; }
    graj(id, x, y, 1);
  }

  // --- klatka
  function klatka() {
    const teraz = ctx.currentTime;
    for (let i = petle.length - 1; i >= 0; i--) {
      if (teraz - petle[i].ostatnio > CZAS_PETLI_BEZ_ODSWIEZENIA) zatrzymajPetle(i, teraz);
    }
    for (let i = ciws.length - 1; i >= 0; i--) {
      if (teraz - ciws[i].ostatnio > CZAS_CIWS_BEZ_STRZALU || wycisz.gatling) {
        ciws[i].h.release();
        ciws[i] = ciws[ciws.length - 1];
        ciws.length--;
      }
    }
    if (side && teraz - sideOstatnio > CZAS_SIDE_BEZ_CIAGU) { side.release(); side = null; }
    pomiarPrzed.getFloatTimeDomainData(probkiPrzed);
    pomiarPo.getFloatTimeDomainData(probkiPo);
    let a = 0, b = 0;
    for (let i = 0; i < probkiPrzed.length; i++) { const v = Math.abs(probkiPrzed[i]); if (v > a) a = v; }
    for (let i = 0; i < probkiPo.length; i++) { const v = Math.abs(probkiPo[i]); if (v > b) b = v; }
    if (a > stat.szczytPrzed) stat.szczytPrzed = a;
    if (b > stat.szczytPo) stat.szczytPo = b;
    if (b > 0.995) stat.przester++;
    stat.ostatniPrzed = a;
    stat.ostatniPo = b;
  }

  /** Wycisza wszystko (koniec sceny): pętle, seria, silnik. */
  function zatrzymajWszystko() {
    const teraz = ctx.currentTime;
    for (let i = petle.length - 1; i >= 0; i--) zatrzymajPetle(i, teraz);
    for (const c of ciws) c.h.release();
    ciws.length = 0;
    if (silnik) { silnik.release(); silnik = null; }
    if (side) { side.release(); side = null; }
    if (syntezator) syntezator.stopAll();
  }

  function statystyki() {
    const odrzucone = limit.wszystkie();
    const id = Object.create(null);
    for (const [k, w] of dzwieki) {
      id[k] = {
        zagral: zagral[k] || 0,
        warianty: w.pliki.length,
        wczytane: w.bufory.filter(Boolean).length,
        wzmocnienieDb: w.wzm.map((g) => round1(gainToDb(g))),
        pomiar: w.pomiary,
        ...(odrzucone[k] || {})
      };
    }
    if (zSynteza) for (const k of Object.keys(DZWIEKI_SYNTEZY)) id[k] = { zagral: zagral[k] || 0, synteza: true };
    return {
      wczytane, wylaczony, glosyAktywne, glosyMax: stat.glosyMax, petle: petle.length, ciws: ciws.length,
      silnik: !!silnik, szczytPrzed: round3(stat.szczytPrzed), szczytPo: round3(stat.szczytPo),
      szczytPrzedDb: round1(gainToDb(stat.szczytPrzed)), szczytPoDb: round1(gainToDb(stat.szczytPo)),
      przester: stat.przester, bledy: stat.bledy, zdarzenia: { ...stat.zdarzenia }, ostrzezenia: [...ostrzezone],
      kontekst: ctx.state, dzwieki: id
    };
  }

  function wyzerujStatystyki() {
    for (const k of Object.keys(zagral)) zagral[k] = 0;
    for (const k of Object.keys(stat.zdarzenia)) delete stat.zdarzenia[k];
    stat.szczytPrzed = 0;
    stat.szczytPo = 0;
    stat.przester = 0;
    stat.glosyMax = glosyAktywne;
    limit.wyzeruj();
    // dźwięki ciągłe, które grają w chwili zerowania, liczą się jako jedno odtworzenie
    if (silnik) zagral.silnikMain = 1;
    if (side) zagral.silnikSide = 1;
    for (const c of ciws) zagral.gatling = (zagral.gatling || 0) + 1;
    for (const L of petle) zagral[L.id] = (zagral[L.id] || 0) + 1;
  }

  /** Lista dźwięków sceny dla panelu: id, warianty, wybór, wyciszenie. */
  function lista() {
    const out = [];
    for (const id of Object.keys(TAB)) {
      const w = dzwieki.get(id);
      out.push({ id, kat: TAB[id].kat, pliki: w ? w.pliki : [], wybor: wybor[id] | 0, wyciszony: !!wycisz[id], synteza: false });
    }
    if (zSynteza) for (const id of Object.keys(DZWIEKI_SYNTEZY)) {
      out.push({ id, kat: DZWIEKI_SYNTEZY[id].kat, nazwa: DZWIEKI_SYNTEZY[id].nazwa, pliki: [], wybor: 0, wyciszony: !!wycisz[id], synteza: true });
    }
    // kolejność kategorii (od najgłośniejszej), w kategorii — kolejność tabeli
    const rank = Object.keys(KATEGORIE);
    return out.map((r, i) => ({ r, i })).sort((a, b) => (rank.indexOf(a.r.kat) - rank.indexOf(b.r.kat)) || (a.i - b.i)).map((x) => x.r);
  }

  function tekstWyboru() {
    const linie = [];
    for (const r of lista()) {
      if (r.synteza) linie.push(`${r.id}: ${r.wyciszony ? 'żaden — wyciszony w scenie' : 'synteza'}`);
      else linie.push(liniaWyboru(r.id, r.wybor, r.pliki, r.wyciszony));
    }
    return linie.join('\n');
  }

  /**
   * Odsłuch z panelu sceny (przycisk ▶): dźwięk ze środka kadru, BEZ limitu głosów i odstępu startów — każde kliknięcie
   * to osobny głos (kilka kliknięć = kilka nałożonych dźwięków); wybrany wariant albo losowo, poziom po wyrównaniu,
   * ta sama szyna co w grze, także gdy dźwięk jest wyciszony w scenie. Pętla gra jeden obieg bufora; synteza — krótki
   * pokaz (silniki na 80% ciągu, seria CIWS).
   */
  const ODSLUCH_SYNTEZY = { silnikMain: 2.5, silnikSide: 2, gatling: 1.2 };
  function odsluch(id) {
    if (wylaczony) return false;
    if (zSynteza && Object.prototype.hasOwnProperty.call(ODSLUCH_SYNTEZY, id) && DZWIEKI_SYNTEZY[id]) {
      const at = { dist: 0, pan: 0, gain: dbToGain(DZWIEKI_SYNTEZY[id].poziom), reverb: 0.3 };
      const h = id === 'silnikMain' ? engineMain.play(E(), paramDefaults(engineMain, { throttle: 0.8, boost: 0 }), at)
        : id === 'silnikSide' ? engineSide.play(E(), paramDefaults(engineSide, { throttle: 0.8 }), at)
          : gatling.play(E(), paramDefaults(gatling, {}), at);
      if (!h) return false;
      setTimeout(() => h.release(), ODSLUCH_SYNTEZY[id] * 1000);
      zagral[id] = (zagral[id] || 0) + 1;
      return true;
    }
    const wpis = dzwieki.get(id);
    if (!wpis) return false;
    const wi = wybierzWariant(wpis.pliki.length, wybor[id], rand(), wpis.poprzedni);
    const buf = wi >= 0 ? wpis.bufory[wi] : null;
    if (!buf) return false;
    wpis.poprzedni = wi;
    const w = wezGlos(TAB[id]?.szyna);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    w.g.gain.value = wpis.wzm[wi];
    w.p.pan.value = 0;
    src.connect(w.g);
    w.src = src;
    src.onended = w.koniec;
    src.start(ctx.currentTime + 0.01);
    glosyAktywne++;
    if (glosyAktywne > stat.glosyMax) stat.glosyMax = glosyAktywne;
    zagral[id] = (zagral[id] || 0) + 1;
    return true;
  }

  return {
    ctx, wczytaj, graj, zdarzenie, petla, silnikMain, silnikSide, ciwsStrzal, strzal, klatka, zatrzymajWszystko,
    statystyki, wyzerujStatystyki, lista, tekstWyboru, odsluch,
    ustawWybor(id, w) { wybor[id] = Math.max(0, Number(w) | 0); },
    ustawWyciszenie(id, b) { wycisz[id] = !!b; },
    ustawGlosnosc(v) { glosnosc.gain.setTargetAtTime(Math.max(0, Number(v) || 0), ctx.currentTime, 0.05); },
    wylacz() { zatrzymajWszystko(); wylaczony = true; },
    wlacz() { wylaczony = false; },
    get wczytane() { return wczytane; },
    get wylaczony() { return wylaczony; },
    /** Długość [s] ostatniego dźwięku, który zagrał `graj` (z przesunięciem startu) — kolejka spikera hali. */
    get ostatniaDlugosc() { return ostatniaDlugosc; }
  };
}

function round1(x) { return Number.isFinite(x) ? Math.round(x * 10) / 10 : x; }
function round3(x) { return Math.round(x * 1000) / 1000; }
