// Warstwa dźwięku gry — czysta logika (bez Web Audio, bez DOM; testy w node: tests/dzwiekiLogika.test.mjs).
//
// Tu żyje wszystko, co da się policzyć bez słuchania: tabela dźwięków (kategoria, limit głosów, odstęp startów,
// wariacja), mapa zdarzeń gry → id dźwięku, klasyfikacja broni NPC, wyrównanie poziomów plików (pomiar głośnej
// części pliku → wzmocnienie do poziomu kategorii), bufor pętli bez szwu, wybór wariantu i położenie w kadrze.
// Moduł Web Audio (src/audio/dzwiekiGry.js) tylko wykonuje te decyzje.
//
// Dźwięki z plików to ROBOCZE nagrania z generatora AI (public/sounds/ai/, manifest.json — pochodzenie);
// dwa dźwięki są z syntezy (src/audio/przepisySyntezy.js): silnik MAIN i seria CIWS.

import { tabelaDzwiekowBroni, wystrzalBroni, MYSLIWIEC_DZIALKO, dzialkoMysliwca } from './dzwiekiBroni.js';
import { DZWIEKI_SWIATA, ZDARZENIA_SWIATA, SYNTEZA_SWIATA } from './dzwiekiSwiata.js';

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Kategorie i poziom docelowy (dB RMS głośnej części pliku, przed szyną). Kolejność głośności z opisu zadania:
 * superbronie i duże wybuchy najgłośniej, potem działa, trafienia, drobne, interfejs najciszej.
 */
// Poziomy pierwotne. Skargi „wszystko jest za głośne” (2026-11-11) brały się z podbicia szyny (`PODBICIE_SZYNY_DB`
// w dzwiekiGry.js), nie z tej tabeli — ściszenia dokładane wtedy tutaj są cofnięte na polecenie użytkownika:
// „skoro bug był w podbijaniu głośności — usuń wcześniejsze modyfikacje dźwięku, bo po naprawie bugu wcale nie
// słyszę silników”. Nie ściszaj tabeli „na zapas”: najpierw sprawdź szynę i suwak efektów w opcjach.
export const KATEGORIE = Object.freeze({
  superbron: { cel: -13, opis: 'superbronie, duże wybuchy' },
  dzialo: { cel: -17, opis: 'działa, rakiety, wybuchy, taran' },
  trafienie: { cel: -21, opis: 'trafienia, tarcza, kadłub' },
  drobne: { cel: -25, opis: 'drobne: dysze, małe wybuchy, tarcie' },
  interfejs: { cel: -28, opis: 'interfejs' },
  // Hala K-7 (warstwa hali, tabela DZWIEKI_HALI): głos spikera ma być zrozumiały, tło hali — ciche łóżko pod resztą.
  glos: { cel: -25, opis: 'głos spikera' },
  tlo: { cel: -34, opis: 'tło miejsca (hala)' }
});

/** Poprawka wystrzałów [dB] względem kategorii — zero (ściszenie −6 dB cofnięte razem z resztą, patrz wyżej). */
export const POZIOM_WYSTRZALU = 0;
/** Broń specjalna (Yamato, Supernova) — użytkownik: „specjalne delikatnie głośniejsze niż main”: +3 dB nad main. */
export const POZIOM_SPECJALNEJ = POZIOM_WYSTRZALU + 3;

/** Najwięcej, ile wyrównanie podbija cichy plik [dB] (powyżej — podbijałoby szum i ogon). */
export const MAX_PODBICIE_DB = 18;
/** Szczyt pliku po wyrównaniu nie wyżej niż tyle [dBFS] — reszta zapasu dla sumy i limitera. */
export const SZCZYT_PO_WYROWNANIU_DB = -3;

/**
 * Tabela dźwięków sceny: kategoria, limit równoczesnych głosów, minimalny odstęp startów [ms], wariacja wysokości
 * i głośności na strzał (±), pętla. `odstep` + `zwloka` dają salwę: starty w tym samym oknie przesuwają się o odstęp
 * (kilka wież = „ta-ta-ta-ta”, nie jeden przester), a dalej niż `zwloka` odstępów — odrzucone.
 */
export const DZWIEKI = Object.freeze({
  // Działa gracza
  tempestIon: { kat: 'dzialo', limit: 6, odstep: 28, zwloka: 4, ton: 0.05, glos: 0.12, poziom: POZIOM_WYSTRZALU },
  yamato: { kat: 'dzialo', limit: 4, odstep: 60, zwloka: 3, ton: 0.03, glos: 0.08, poziom: POZIOM_SPECJALNEJ },
  rakieta: { kat: 'dzialo', limit: 6, odstep: 45, zwloka: 4, ton: 0.06, glos: 0.12, poziom: POZIOM_WYSTRZALU },
  supernovaStart: { kat: 'dzialo', limit: 3, odstep: 90, zwloka: 3, ton: 0.04, glos: 0.08, poziom: POZIOM_SPECJALNEJ },
  // Broń piratów (wg kategorii broni)
  autocannon: { kat: 'dzialo', limit: 6, odstep: 35, zwloka: 2, ton: 0.07, glos: 0.15, poziom: POZIOM_WYSTRZALU },
  dzialo: { kat: 'dzialo', limit: 5, odstep: 50, zwloka: 3, ton: 0.05, glos: 0.12, poziom: POZIOM_WYSTRZALU },
  railgun: { kat: 'dzialo', limit: 4, odstep: 60, zwloka: 3, ton: 0.04, glos: 0.1, poziom: POZIOM_WYSTRZALU },
  laserPD: { kat: 'drobne', limit: 6, odstep: 30, zwloka: 2, ton: 0.06, glos: 0.15 },
  flak: { kat: 'dzialo', limit: 4, odstep: 60, zwloka: 2, ton: 0.06, glos: 0.12, poziom: POZIOM_WYSTRZALU },
  wiazka: { kat: 'dzialo', petla: true, limit: 4, poziom: POZIOM_WYSTRZALU },
  // Trafienia
  trafienie: { kat: 'trafienie', limit: 6, odstep: 25, zwloka: 2, ton: 0.08, glos: 0.18 },
  trafieniePlazma: { kat: 'trafienie', limit: 4, odstep: 50, zwloka: 2, ton: 0.05, glos: 0.12 },
  kadlub: { kat: 'trafienie', limit: 4, odstep: 45, zwloka: 2, ton: 0.06, glos: 0.15 },
  rykoszet: { kat: 'drobne', limit: 3, odstep: 70, zwloka: 1, ton: 0.08, glos: 0.15 },
  // Tarcza
  // Użytkownik 2026-11-11: tarcza „łagodniejsza i szybsza”, wzorzec — Starsector: krótki plik (0,5 s), ciszej.
  // Potem: „tarcza teraz jest zbyt delikatna” — plik krótki, ale wyraźny (0,6 s) i poziom jak trafienie w kadłub.
  tarcza: { kat: 'trafienie', limit: 5, odstep: 35, zwloka: 2, ton: 0.06, glos: 0.15 },
  tarczaWl: { kat: 'interfejs', limit: 1, odstep: 200, zwloka: 0, ton: 0, glos: 0, ui: true, poziom: 6 },
  tarczaWyl: { kat: 'interfejs', limit: 1, odstep: 200, zwloka: 0, ton: 0, glos: 0, ui: true, poziom: 6 },
  // Użytkownik 2026-11-11: rozbicie tarczy „zbyt energetyczne” — spokojne gaśnięcie pola, poziom trafienia (+1 dB).
  tarczaPekniecie: { kat: 'trafienie', limit: 2, odstep: 300, zwloka: 0, ton: 0.03, glos: 0.08, poziom: 1 },
  // Rakiety i wybuchy
  wybuchRakiety: { kat: 'dzialo', limit: 5, odstep: 40, zwloka: 3, ton: 0.07, glos: 0.15 },
  supernovaWybuch: { kat: 'superbron', limit: 3, odstep: 80, zwloka: 2, ton: 0.04, glos: 0.08 },
  wybuchMaly: { kat: 'drobne', limit: 5, odstep: 40, zwloka: 2, ton: 0.08, glos: 0.15 },
  wybuchOkretu: { kat: 'superbron', limit: 2, odstep: 250, zwloka: 2, ton: 0.04, glos: 0.08 },
  wybuch: { kat: 'dzialo', limit: 4, odstep: 70, zwloka: 3, ton: 0.06, glos: 0.12 },
  // Kadłuby
  uderzenieKadluba: { kat: 'dzialo', limit: 3, odstep: 120, zwloka: 1, ton: 0.05, glos: 0.1 },
  zgrzytPetla: { kat: 'drobne', petla: true, limit: 2 },
  zgniot: { kat: 'dzialo', limit: 3, odstep: 150, zwloka: 1, ton: 0.06, glos: 0.12 },
  taran: { kat: 'superbron', limit: 2, odstep: 400, zwloka: 0, ton: 0.04, glos: 0.08 },
  // Okręt: silnik MAIN i silniki SIDE są z syntezy (DZWIEKI_SYNTEZY); syk `rcs` z plików wypadł ze sceny.
  // Interfejs (bez położenia: środek, pełna głośność)
  grupa: { kat: 'interfejs', limit: 2, odstep: 60, zwloka: 0, ton: 0, glos: 0, ui: true },
  potwierdzenie: { kat: 'interfejs', limit: 2, odstep: 60, zwloka: 0, ton: 0, glos: 0, ui: true },
  blad: { kat: 'interfejs', limit: 2, odstep: 120, zwloka: 0, ton: 0, glos: 0, ui: true },
  namiar: { kat: 'interfejs', limit: 1, odstep: 300, zwloka: 0, ton: 0, glos: 0, ui: true },
  malowanie: { kat: 'interfejs', limit: 3, odstep: 60, zwloka: 1, ton: 0, glos: 0, ui: true },
  alarm: { kat: 'interfejs', petla: true, limit: 1, ui: true },
  // Uzbrojenie: rodziny broni × wielkość, wiązki, superbronie (src/audio/dzwiekiBroni.js)
  ...tabelaDzwiekowBroni({ wystrzal: POZIOM_WYSTRZALU, specjalna: POZIOM_SPECJALNEJ }),
  ...DZWIEKI_SWIATA // obszary gry: warp, przyloty, maskowanie, rdzeń reaktora… (src/audio/dzwiekiSwiata.js)
});

/**
 * Dźwięki HALI K-7 (osobna warstwa `utworzDzwiekiGry({ tabela: DZWIEKI_HALI })`, reżyser `src/game/k7HallSound.js`):
 * tło i pompy, przepływ paliwa, ramiona w ruchu, syk zaworów i upustu (pętle z głośnością z pozy / obwiedni zaworu),
 * złączki, zaciski, gong i głos spikera. Gra w zwykłej grze (kampania i swobodna), gdy kamera jest przy hali —
 * niezależnie od sceny dźwięków. `szyna: 'megafon'` — głos idzie przez filtr głośnika i echo hali.
 * Proporcje w hali (cel kategorii + `poziom`, dB): tło −34, pompownia −31, przepływ −33, serwo i syk −31, buch pary
 * −27, zapięcie złączki −29, zaciski −25, gong −30, spiker −25 — zaciski nie głośniej niż równoczesny komunikat
 * („Magnetic clamps released…”). Kategorie wspólne ze sceną wróciły 2026-11-11 do poziomów pierwotnych (+4 dB po
 * naprawie podbicia szyny), więc mechanizmy hali mają tu −4 dB względem kategorii — proporcje bez zmian.
 */
export const DZWIEKI_HALI = Object.freeze({
  halaTlo: { kat: 'tlo', petla: true, limit: 1, ui: true },
  halaMaszyny: { kat: 'tlo', petla: true, limit: 1, poziom: 3 },
  przeplyw: { kat: 'drobne', petla: true, limit: 4, poziom: -8 },
  serwo: { kat: 'drobne', petla: true, limit: 4, poziom: -6 },
  syk: { kat: 'drobne', petla: true, limit: 6, poziom: -6 },
  buchPary: { kat: 'drobne', limit: 4, odstep: 60, zwloka: 2, ton: 0.05, glos: 0.1, poziom: -2 },
  zlaczeZapiecie: { kat: 'drobne', limit: 4, odstep: 60, zwloka: 2, ton: 0.05, glos: 0.1, poziom: -4 },
  zaciskiZwolnienie: { kat: 'trafienie', limit: 2, odstep: 200, zwloka: 2, ton: 0.03, glos: 0.08, poziom: -4 },
  zaciskiZalaczenie: { kat: 'trafienie', limit: 2, odstep: 200, zwloka: 2, ton: 0.03, glos: 0.08, poziom: -4 },
  gong: { kat: 'interfejs', limit: 1, odstep: 1500, zwloka: 0, ton: 0, glos: 0, ui: true, poziom: -2 },
  // Spiker hali (głos z syntezy mowy ElevenLabs): statusy ringu co 40–75 s, komunikaty obsługi stanowiska gracza.
  spikerStatus: { kat: 'glos', limit: 1, odstep: 3000, zwloka: 0, ton: 0, glos: 0, ui: true, szyna: 'megafon' },
  spikerOdcumowanie: { kat: 'glos', limit: 1, odstep: 3000, zwloka: 0, ton: 0, glos: 0, ui: true, szyna: 'megafon' },
  spikerMocowania: { kat: 'glos', limit: 1, odstep: 3000, zwloka: 0, ton: 0, glos: 0, ui: true, szyna: 'megafon' },
  spikerDokowanie: { kat: 'glos', limit: 1, odstep: 3000, zwloka: 0, ton: 0, glos: 0, ui: true, szyna: 'megafon' }
});

/** Dźwięki z syntezy (nie z plików) — w panelu bez wariantów, tylko wyciszenie. */
export const DZWIEKI_SYNTEZY = Object.freeze({
  // Synteza nie przechodzi przez wyrównanie plików — `poziom` to cała jej głośność [dB].
  // Poziomy pierwotne (silnik −6, CIWS −4): po naprawie podbicia szyny ściszony silnik (−22 dB) był niesłyszalny.
  silnikMain: { kat: 'drobne', nazwa: 'Silnik MAIN (synteza)', poziom: -6 },
  // Silniki SIDE: praca ciągła jak MAIN, nie pojedynczy syk (decyzja użytkownika 2026-11-11); 2 dB pod MAIN.
  silnikSide: { kat: 'drobne', nazwa: 'Silniki SIDE (synteza)', poziom: -8 },
  gatling: { kat: 'dzialo', nazwa: 'CIWS / Vulcan (synteza)', poziom: -4 },
  ...SYNTEZA_SWIATA
});

/**
 * Zdarzenie gry → id dźwięku (opis zadania „Zdarzenie → dźwięk”). Klucze to nazwy zdarzeń, które klej w
 * index.html zgłasza do warstwy (`zdarzenie(nazwa, x, y, opcje)`); wartość null = zdarzenie bez dźwięku.
 */
export const ZDARZENIA = Object.freeze({
  trafienie: 'trafienie',
  trafieniePlazma: 'trafieniePlazma',
  trafienieGracza: 'kadlub',
  rykoszet: 'rykoszet',
  tarczaTrafiona: 'tarcza',
  tarczaWlaczona: 'tarczaWl',
  tarczaWylaczona: 'tarczaWyl',
  tarczaZapadnieta: 'tarczaPekniecie',
  rakietaTrafila: 'wybuchRakiety',
  supernovaDetonacja: 'supernovaWybuch',
  rakietaZestrzelona: 'wybuchMaly',
  smiercOkretu: 'wybuchOkretu',
  wybuchWtorny: 'wybuch',
  kontaktKadlubow: 'uderzenieKadluba',
  zgniotKadluba: 'zgniot',
  taran: 'taran',
  zmianaGrupy: 'grupa',
  ogienAutoWl: 'potwierdzenie',
  odmowa: 'blad',
  namiar: 'namiar',
  malowanieCelu: 'malowanie',
  ...ZDARZENIA_SWIATA
});

/** Strzał broni gracza / piratów → id dźwięku. Broń wiązki (pętla) i CIWS (synteza) obsługuje warstwa osobno. */
export const STRZAL_GRACZA = Object.freeze({
  // Tempest Ion (MASTER_WEAPONS: railgun_mk1 / mk2 to „Tempest Ion Mk I / II”, plus S i L)
  railgun_mk1: 'tempestIon',
  railgun_mk2: 'tempestIon',
  tempest_ion_s: 'tempestIon',
  tempest_ion_l: 'tempestIon',
  special_yamato_cannon: 'yamato',
  special_yamato_l: 'yamato',
  missile_rack: 'rakieta',
  supernova_missile: 'supernovaStart'
});

/** Broń z serią CIWS z syntezy (dopóki strzela). */
export function jestCiws(weaponId) {
  return typeof weaponId === 'string' && /^ciws/.test(weaponId);
}

/**
 * Broń NPC → dźwięk kategorii (`autocannon`, `dzialo`, `railgun`, `laserPD`, `flak`, `wiazka`, rakiety → `rakieta`)
 * z pola `category` wpisu `MASTER_WEAPONS` (rail, autocannon, armata, plasma, beam, flak, rocket, torpedo…);
 * bez wpisu — z samego id.
 */
export function kategoriaBroniNpc(weaponId, def = null) {
  const id = String(weaponId || '').toLowerCase();
  const kat = String(def?.category || '').toLowerCase();
  const ciagla = def?.beam || def?.isBeam || /continuous/.test(id) || def?.beamMode === 'continuous';
  switch (kat) {
    case 'rail': return 'railgun';
    case 'autocannon': return 'autocannon';
    case 'armata': return 'dzialo';
    case 'flak': return 'flak';
    case 'ciws': return 'autocannon';
    case 'rocket': case 'torpedo': return 'rakieta';
    case 'beam': return ciagla ? 'wiazka' : 'laserPD';
    case 'plasma': return /helios|laser|lance/.test(id) ? 'laserPD' : 'dzialo';
    case 'superweapon': return 'wiazka';
    default: break;
  }
  if (ciagla || /beam_cont|death_ray/.test(id)) return 'wiazka';
  if (/flak/.test(id)) return 'flak';
  if (/rail|gauss|tempest|lance/.test(id)) return 'railgun';
  if (/laser|_pd|helios/.test(id)) return 'laserPD';
  if (/autocannon|gatling|vulcan|minigun|ciws/.test(id)) return 'autocannon';
  if (/missile|rocket|torped|rack/.test(id)) return 'rakieta';
  const szybkostrzelna = Number(def?.fireRate) > 3 || (Number(def?.cooldown) > 0 && Number(def.cooldown) < 0.35);
  return szybkostrzelna ? 'autocannon' : 'dzialo';
}

/**
 * Strzał z szyny broni → id dźwięku: najpierw mapa uzbrojenia (`WYSTRZAL_BRONI` — id, `'seria'` CIWS z syntezy,
 * `'wiazka'`, `null` = bez dźwięku); broń spoza mapy — gracz `STRZAL_GRACZA`, reszta dźwiękiem kategorii jak NPC.
 * `mysliwiec` — strzelec to myśliwiec: działko gra `mysliwiecDzialko`, gdy to id jest w tabeli warstwy (`tabela`);
 * bez niego — jak wyżej (rakieta, torpeda i bomba myśliwca zawsze jak wyżej).
 */
export function dzwiekStrzalu(weaponId, def, gracza, mysliwiec = false, tabela = DZWIEKI) {
  if (mysliwiec && tabela && tabela[MYSLIWIEC_DZIALKO] && dzialkoMysliwca(def)) return MYSLIWIEC_DZIALKO;
  // Mapa uzbrojenia (src/audio/dzwiekiBroni.js) — jedna dla gracza i NPC: id, 'seria', 'wiazka' albo null (bez dźwięku).
  const zMapy = wystrzalBroni(weaponId);
  if (zMapy !== undefined) return zMapy;
  if (gracza) {
    const id = STRZAL_GRACZA[weaponId];
    if (id) return id;
  }
  return kategoriaBroniNpc(weaponId, def);
}

/**
 * Słyszalność bez pracy: punkt dalej od środka kadru niż `zasieg` półprzekątnych (jak w `polozenie`) odpada,
 * zanim warstwa zrobi cokolwiek innego. Bez pozycji (NaN) — słyszalne (interfejs, zdarzenia gracza).
 */
export function slyszalne(x, y, kadr, zasieg = 3.2) {
  if (!kadr || !(x === x) || !(y === y)) return true;
  const ex = (x - kadr.x) / Math.max(1, kadr.polW);
  const ey = (y - kadr.y) / Math.max(1, kadr.polH);
  return ex * ex + ey * ey < 2 * zasieg * zasieg;
}

// ---------------------------------------------------------------------------------------------------------------
// Wybór wariantów i głośność w zapisie przeglądarki

/** Klucz `localStorage` wyboru wariantów i wyciszeń z panelu sceny (nie zapis gracza). */
export const KLUCZ_WYBORU = 'sc_dzwieki_wybor';

/**
 * Zapisany wybór → `{ wybor: { id: 1…9 }, wycisz: { id: true } }` tylko dla znanych id (`znane` — obiekt z id jako
 * kluczami); śmieci, nieznane id i złe wartości odpadają (stary zapis po zmianie tabeli nie psuje warstwy).
 */
export function parsujWybor(tekst, znane) {
  const out = { wybor: {}, wycisz: {} };
  let z = null;
  try { z = typeof tekst === 'string' ? JSON.parse(tekst) : tekst; } catch { return out; }
  if (!z || typeof z !== 'object') return out;
  const ok = (id) => typeof id === 'string' && (!znane || Object.prototype.hasOwnProperty.call(znane, id));
  if (z.wybor && typeof z.wybor === 'object') {
    for (const [id, w] of Object.entries(z.wybor)) {
      const n = Number(w);
      if (ok(id) && Number.isInteger(n) && n >= 1 && n <= 9) out.wybor[id] = n;
    }
  }
  if (z.wycisz && typeof z.wycisz === 'object') {
    for (const [id, b] of Object.entries(z.wycisz)) if (ok(id) && b === true) out.wycisz[id] = true;
  }
  return out;
}

/** Wybór do zapisu: tylko warianty stałe (≥ 1) i wyciszenia — losowo i „słychać” to brak wpisu. */
export function tekstZapisuWyboru(wybor, wycisz) {
  const out = { wybor: {}, wycisz: {} };
  for (const [id, w] of Object.entries(wybor || {})) if ((Number(w) | 0) >= 1) out.wybor[id] = Number(w) | 0;
  for (const [id, b] of Object.entries(wycisz || {})) if (b === true) out.wycisz[id] = true;
  return JSON.stringify(out);
}

/** Domyślna głośność główna gry (dawniej 0 — gra startowała niema). */
export const GLOSNOSC_GLOWNA_DOMYSLNA = 0.7;

/**
 * Jednorazowa migracja zapisanej głośności głównej: 0 było wartością DOMYŚLNĄ opcji, nie wyborem gracza — zapisane
 * dokładnie 0 bez znacznika migracji → `GLOSNOSC_GLOWNA_DOMYSLNA`. Znacznik stawia się zawsze (po migracji 0 ustawione
 * przez gracza zostaje zerem). Zwraca `{ master, oznacz }` (`oznacz` — zapisz znacznik).
 */
export function migrujGlosnoscGlowna(zapisanaGlowna, znacznik) {
  const v = Number(zapisanaGlowna);
  if (znacznik) return { master: Number.isFinite(v) ? clamp(v, 0, 1) : GLOSNOSC_GLOWNA_DOMYSLNA, oznacz: false };
  if (!Number.isFinite(v) || v === 0) return { master: GLOSNOSC_GLOWNA_DOMYSLNA, oznacz: true };
  return { master: clamp(v, 0, 1), oznacz: true };
}

/** Wszystkie id plików potrzebne w scenie (dekodujemy tylko je). */
export function idPlikowSceny() {
  return Object.keys(DZWIEKI);
}

// ---------------------------------------------------------------------------------------------------------------
// Wyrównanie poziomów

/**
 * Pomiar pliku: szczyt i RMS GŁOŚNEJ części (okna `oknoS`, średnia mocy z górnych `gora` okien) — krótki strzał
 * z długą ciszą w ogonie nie dostaje przez ciszę wielkiego podbicia. Kanały liczą się razem (średnia mocy).
 * @param {Float32Array[]} kanaly
 */
export function zmierzPoziom(kanaly, sampleRate, { oknoS = 0.05, gora = 0.25 } = {}) {
  const n = kanaly.length ? kanaly[0].length : 0;
  if (!n) return { szczyt: 0, rms: 0, szczytDb: -Infinity, rmsDb: -Infinity };
  const okno = Math.max(1, Math.round(sampleRate * oknoS));
  const liczbaOkien = Math.ceil(n / okno);
  const moce = new Float64Array(liczbaOkien);
  let szczyt = 0;
  for (let w = 0; w < liczbaOkien; w++) {
    const a = w * okno;
    const b = Math.min(n, a + okno);
    let s = 0;
    for (const ch of kanaly) {
      for (let i = a; i < b; i++) {
        const v = ch[i];
        s += v * v;
        const av = v < 0 ? -v : v;
        if (av > szczyt) szczyt = av;
      }
    }
    moce[w] = s / ((b - a) * kanaly.length);
  }
  moce.sort();
  const k = Math.max(1, Math.round(liczbaOkien * gora));
  let suma = 0;
  for (let i = liczbaOkien - k; i < liczbaOkien; i++) suma += moce[i];
  const rms = Math.sqrt(suma / k);
  return { szczyt, rms, szczytDb: gainToDb(szczyt), rmsDb: gainToDb(rms) };
}

/**
 * Wzmocnienie pliku do poziomu kategorii: cel − RMS głośnej części (+ poprawka dźwięku `poziom` w dB), z sufitem
 * podbicia i z szczytem po wzmocnieniu ≤ `SZCZYT_PO_WYROWNANIU_DB`.
 */
export function wzmocnienieWyrownania(pomiar, kat, poprawkaDb = 0) {
  const cel = (KATEGORIE[kat]?.cel ?? KATEGORIE.drobne.cel) + (Number(poprawkaDb) || 0);
  if (!(pomiar && pomiar.rms > 0)) return 1;
  let db = cel - pomiar.rmsDb;
  if (db > MAX_PODBICIE_DB) db = MAX_PODBICIE_DB;
  const zapasSzczytu = SZCZYT_PO_WYROWNANIU_DB - pomiar.szczytDb;
  if (db > zapasSzczytu) db = zapasSzczytu;
  return dbToGain(db);
}

// ---------------------------------------------------------------------------------------------------------------
// Pętla bez szwu

/**
 * Bufor pętli bez szwu z zdekodowanego MP3: obcina ciszę na początku i końcu (opóźnienie kodera MP3 i dopełnienie
 * ramki dają szczelinę przy gołym `loop = true`), a koniec przenika w początek (równa moc, `fadeS` s) — ostatnia
 * próbka nowego bufora przechodzi gładko w pierwszą. Zwraca nowe tablice kanałów.
 * @param {Float32Array[]} kanaly
 */
export function buforPetliBezSzwu(kanaly, sampleRate, { fadeS = 0.3, prog = 1e-3 } = {}) {
  const n = kanaly[0]?.length || 0;
  let a = 0;
  let b = n;
  const glosne = (i) => {
    for (const ch of kanaly) if (Math.abs(ch[i]) > prog) return true;
    return false;
  };
  while (a < b && !glosne(a)) a++;
  while (b > a && !glosne(b - 1)) b--;
  const len = b - a;
  if (len < 64) return kanaly.map((ch) => ch.slice());
  const fade = Math.max(1, Math.min(Math.round(sampleRate * fadeS), Math.floor(len / 3)));
  const outLen = len - fade;
  return kanaly.map((ch) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = ch[a + i];
    // początek = przenikanie: ogon (który by wypadł) gaśnie, początek narasta
    for (let i = 0; i < fade; i++) {
      const w = (i + 0.5) / fade;
      out[i] = ch[a + i] * Math.sqrt(w) + ch[a + outLen + i] * Math.sqrt(1 - w);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Wybór wariantu

/**
 * Wariant do zagrania (indeks 0…liczba−1). `wybor` 1…n — stały wariant z panelu; 0 / brak — losowo, bez
 * powtórzenia poprzedniego, gdy wariantów jest więcej niż jeden.
 */
export function wybierzWariant(liczba, wybor, los, poprzedni = -1) {
  if (!(liczba > 0)) return -1;
  const w = Number(wybor) | 0;
  if (w >= 1) return Math.min(w, liczba) - 1;
  if (liczba === 1) return 0;
  let i = Math.min(liczba - 1, Math.floor(los * liczba));
  if (i === poprzedni) i = (i + 1 + Math.min(liczba - 2, Math.floor(los * 7919) % (liczba - 1))) % liczba;
  return i;
}

// ---------------------------------------------------------------------------------------------------------------
// Limit głosów i odstęp startów

/**
 * Limit głosów: na dźwięk najwyżej `limit` równoczesnych głosów i odstęp `odstep` ms między startami. Start w
 * oknie odstępu przesuwa się na następny wolny moment (salwa), dalej niż `zwloka` odstępów — odrzucony. Bez
 * alokacji po rozgrzaniu (tablica końców na dźwięk). Czas w sekundach (zegar AudioContext).
 */
export function utworzLimitGlosow(tabela = DZWIEKI) {
  const stany = new Map();
  const stan = (id) => {
    let s = stany.get(id);
    if (!s) {
      const d = tabela[id] || {};
      s = {
        limit: Math.max(1, d.limit | 0 || 4),
        odstep: Math.max(0, Number(d.odstep) || 0) / 1000,
        zwloka: Math.max(0, Number(d.zwloka) || 0),
        konce: new Float64Array(Math.max(1, d.limit | 0 || 4)).fill(-Infinity),
        ostatniStart: -Infinity,
        odrzuconeLimit: 0,
        odrzuconeOdstep: 0,
        przesuniete: 0
      };
      stany.set(id, s);
    }
    return s;
  };
  return {
    /**
     * @returns {number} zwłoka startu [s] (≥ 0) albo −1 (odrzucony). `wynik.aktywne` — głosy grające w chwili startu.
     */
    przyjmij(id, teraz, dlugoscS, wynik = null) {
      const s = stan(id);
      let aktywne = 0;
      let wolny = -1;
      for (let i = 0; i < s.konce.length; i++) {
        if (s.konce[i] > teraz) aktywne++;
        else if (wolny < 0) wolny = i;
      }
      if (wolny < 0) {
        s.odrzuconeLimit++;
        return -1;
      }
      let start = teraz;
      const nastepny = s.ostatniStart + s.odstep;
      if (nastepny > teraz) {
        if (nastepny - teraz > s.odstep * s.zwloka + 1e-9) {
          s.odrzuconeOdstep++;
          return -1;
        }
        start = nastepny;
        s.przesuniete++;
      }
      s.ostatniStart = start;
      s.konce[wolny] = start + Math.max(0.01, Number(dlugoscS) || 0);
      if (wynik) wynik.aktywne = aktywne;
      return start - teraz;
    },
    statystyki(id) {
      const s = stany.get(id);
      return s ? { odrzuconeLimit: s.odrzuconeLimit, odrzuconeOdstep: s.odrzuconeOdstep, przesuniete: s.przesuniete } : null;
    },
    wszystkie() {
      const out = {};
      for (const [id, s] of stany) out[id] = { odrzuconeLimit: s.odrzuconeLimit, odrzuconeOdstep: s.odrzuconeOdstep, przesuniete: s.przesuniete };
      return out;
    },
    wyzeruj() {
      stany.clear();
    }
  };
}

/** Ściszenie kolejnego głosu tego samego dźwięku, gdy grają już inne: suma rośnie jak √n, nie jak n. */
export function sciszenieTloku(aktywne) {
  return 1 / Math.sqrt(1 + 0.6 * Math.max(0, aktywne | 0));
}

// ---------------------------------------------------------------------------------------------------------------
// Położenie

/**
 * Głośność i panorama źródła w świecie gry względem kadru. `kadr`: { x, y } — środek kamery, `polW` / `polH` —
 * połowa szerokości / wysokości kadru w jednostkach świata, `zoom` — przybliżenie (piksele na jednostkę).
 * Panorama z położenia na ekranie (poza kadrem — przy krawędzi), głośność: w kadrze pełna, dalej gaśnie do zera
 * na `zasieg` półprzekątnych; oddalenie (mały zoom) ścisza wszystko łagodnie (`zoomRef` — przybliżenie bez ściszenia).
 */
export function polozenie(x, y, kadr, out = { glos: 1, pan: 0 }, { zasieg = 3.2, zoomRef = 0.35, zoomMin = 0.45 } = {}) {
  if (!kadr || !Number.isFinite(x) || !Number.isFinite(y)) {
    out.glos = 1;
    out.pan = 0;
    return out;
  }
  const polW = Math.max(1, kadr.polW || 1);
  const polH = Math.max(1, kadr.polH || 1);
  const dx = x - kadr.x;
  const dy = y - kadr.y;
  const sx = dx / polW;
  out.pan = clamp(sx * 0.75, -0.85, 0.85);
  const e = Math.sqrt((dx / polW) * (dx / polW) + (dy / polH) * (dy / polH)) / Math.SQRT2;
  let g;
  if (e <= 0.75) g = 1;
  else if (e >= zasieg) g = 0;
  else {
    const t = (e - 0.75) / (zasieg - 0.75);
    g = (1 - t) * (1 - t);
  }
  const z = Number(kadr.zoom);
  const gz = Number.isFinite(z) && z > 0 ? clamp(Math.sqrt(z / zoomRef), zoomMin, 1) : 1;
  out.glos = g * gz;
  return out;
}

/**
 * Linia „id: plik” do schowka — format strony dema/dzwieki-ai.html (`id: pliki, …` albo `id: żaden — uwaga`):
 * stały wariant → jeden plik; losowo → wszystkie warianty z uwagą „losowo”; wyciszony → „żaden”.
 */
export function liniaWyboru(id, wybor, pliki, wyciszony = false) {
  if (wyciszony) return `${id}: żaden — wyciszony w scenie`;
  const w = Number(wybor) | 0;
  if (w >= 1 && pliki && pliki[w - 1]) return `${id}: ${pliki[w - 1]}`;
  return `${id}: ${(pliki || []).join(', ')} — losowo`;
}
