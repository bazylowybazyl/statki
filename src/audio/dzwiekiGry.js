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
  DZWIEKI, DZWIEKI_SYNTEZY, ZDARZENIA, STRZAL_GRACZA, jestCiws, kategoriaBroniNpc, idPlikowSceny,
  zmierzPoziom, wzmocnienieWyrownania, buforPetliBezSzwu, wybierzWariant, utworzLimitGlosow, sciszenieTloku,
  polozenie, liniaWyboru, dbToGain, gainToDb
} from './dzwiekiLogika.js';
import { SoundEngine, paramDefaults } from './synteza.js';
import { engineMain, gatling } from './przepisySyntezy.js';

const CZAS_PETLI_BEZ_ODSWIEZENIA = 0.25; // s — pętla nieodświeżona tyle czasu gaśnie (zdarzenie się skończyło)
const CZAS_CIWS_BEZ_STRZALU = 0.16; // s — seria CIWS wygasa, gdy tyle nie było strzału

/**
 * @param {{ ctx: AudioContext, rand: () => number, kadr: () => ({x,y,polW,polH,zoom}), baza?: string,
 *           log?: Console, glosnosc?: number }} opts
 */
export function utworzDzwiekiGry(opts) {
  const ctx = opts.ctx;
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
  const glosnosc = ctx.createGain();
  glosnosc.gain.value = Number.isFinite(opts.glosnosc) ? opts.glosnosc : 1;
  const pomiarPo = ctx.createAnalyser();
  pomiarPo.fftSize = 2048;
  wejscie.connect(pomiarPrzed);
  wejscie.connect(komp);
  komp.connect(limiter);
  limiter.connect(glosnosc);
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
  const limit = utworzLimitGlosow(DZWIEKI);
  const wynikLimitu = { aktywne: 0 };
  const poz = { glos: 1, pan: 0 };
  const stat = { szczytPrzed: 0, szczytPo: 0, przester: 0, glosyMax: 0, bledy: 0, zdarzenia: Object.create(null) };
  let glosyAktywne = 0;
  let wczytane = false;
  let wylaczony = false;

  // --- pula węzłów głosu jednorazowego (głośność + panorama)
  const pula = [];
  function wezGlos() {
    let w = pula.pop();
    if (!w) {
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      g.connect(p);
      p.connect(wejscie);
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
  async function wczytaj(ids = idPlikowSceny()) {
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
      const d = DZWIEKI[id] || {};
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
      if (wczytane && !DZWIEKI[id]) ostrzez(`graj:${id}`, `dźwięk "${id}" spoza tabeli sceny — cisza`);
      return false;
    }
    const d = DZWIEKI[id];
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
    const w = wezGlos();
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
    const d = DZWIEKI[id] || {};
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
    L.g.gain.setTargetAtTime(g * L.wzm, teraz, 0.06);
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
    for (const k of Object.keys(DZWIEKI_SYNTEZY)) id[k] = { zagral: zagral[k] || 0, synteza: true };
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
  }

  /** Lista dźwięków sceny dla panelu: id, warianty, wybór, wyciszenie. */
  function lista() {
    const out = [];
    for (const id of Object.keys(DZWIEKI)) {
      const w = dzwieki.get(id);
      out.push({ id, kat: DZWIEKI[id].kat, pliki: w ? w.pliki : [], wybor: wybor[id] | 0, wyciszony: !!wycisz[id], synteza: false });
    }
    for (const id of Object.keys(DZWIEKI_SYNTEZY)) {
      out.push({ id, kat: DZWIEKI_SYNTEZY[id].kat, nazwa: DZWIEKI_SYNTEZY[id].nazwa, pliki: [], wybor: 0, wyciszony: !!wycisz[id], synteza: true });
    }
    return out;
  }

  function tekstWyboru() {
    const linie = [];
    for (const r of lista()) {
      if (r.synteza) linie.push(`${r.id}: ${r.wyciszony ? 'żaden — wyciszony w scenie' : 'synteza'}`);
      else linie.push(liniaWyboru(r.id, r.wybor, r.pliki, r.wyciszony));
    }
    return linie.join('\n');
  }

  return {
    ctx, wczytaj, graj, zdarzenie, petla, silnikMain, ciwsStrzal, strzal, klatka, zatrzymajWszystko,
    statystyki, wyzerujStatystyki, lista, tekstWyboru,
    ustawWybor(id, w) { wybor[id] = Math.max(0, Number(w) | 0); },
    ustawWyciszenie(id, b) { wycisz[id] = !!b; },
    ustawGlosnosc(v) { glosnosc.gain.setTargetAtTime(Math.max(0, Number(v) || 0), ctx.currentTime, 0.05); },
    wylacz() { zatrzymajWszystko(); wylaczony = true; },
    wlacz() { wylaczony = false; },
    get wczytane() { return wczytane; },
    get wylaczony() { return wylaczony; }
  };
}

function round1(x) { return Number.isFinite(x) ? Math.round(x * 10) / 10 : x; }
function round3(x) { return Math.round(x * 1000) / 1000; }
