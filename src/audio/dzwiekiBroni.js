// Dźwięki uzbrojenia — czysta logika (bez Web Audio i DOM; testy: tests/dzwiekiBroni.test.mjs).
//
// RODZINY × WIELKOŚĆ: jedna rodzina broni (działka, armata, Helios, railguny snajperskie, flak, rakiety, torpedy) ma
// wspólny rdzeń opisu w generatorze (scripts/dzwieki-elevenlabs.lista-bronie.mjs), wielkość S / M / L / Capital zmienia
// ciężar, nie charakter. JEDNA mapa broń → dźwięk dla gracza i NPC (`WYSTRZAL_BRONI`): każda broń z `MASTER_WEAPONS`
// ma wpis — id dźwięku, seria z syntezy (`SERIA`), pętla wiązki (`PETLA_WIAZKI`) albo jawne `null` z powodem w
// `BEZ_DZWIEKU` (strażnik w teście). Broń spoza mapy (nowa) gra dźwiękiem kategorii (`kategoriaBroniNpc`).
//
// Moduł nie importuje dzwiekiLogika.js (ta dokleja tabelę `tabelaDzwiekowBroni(...)` do `DZWIEKI` — import w drugą
// stronę dałby cykl i martwą strefę stałych przy ewaluacji).

/** Seria CIWS / Vulcan z syntezy (gra, dopóki broń strzela) — ocena użytkownika: dobra. */
export const SERIA = 'seria';
/** Pętla wiązki ciągłej (`wiazka`) pod kluczem strzelca, dopóki wiązka strzela. */
export const PETLA_WIAZKI = 'wiazka';

/**
 * Broń → dźwięk wystrzału. Rakiety i torpedy: dźwięk STARTU każdej rakiety (adapter efektów rakiet), nie salwy.
 * Superbronie z ładowaniem mają osobno ładowanie (`LADOWANIE_BRONI`) i strzał (tu).
 */
export const WYSTRZAL_BRONI = Object.freeze({
  // Tempest Ion (szyny jonowe; własny dźwięk sprzed rodzin — wszystkie wielkości jednym plikiem)
  railgun_mk1: 'tempestIon',
  railgun_mk2: 'tempestIon',
  tempest_ion_s: 'tempestIon',
  tempest_ion_l: 'tempestIon',
  // Działka: seria z syntezy dla szybkostrzelnych (Vulcan 0,07 s, Gatling 0,09 s — jak CIWS), reszta z plików
  vulcan_minigun: SERIA,
  gatling_s: SERIA,
  gunship_autocannon: 'dzialkoS',
  heavy_autocannon: 'dzialkoM',
  heavy_autocannon_l: 'dzialkoL',
  special_goliath_autocannon: 'dzialkoC',
  // Obrona punktowa
  ciws_mk1: SERIA,
  ciws_mk2: SERIA,
  laser_pd_mk1: 'laserPD',
  // Armata
  armata_mk1: 'armataL',
  // Plazma
  helios_laser_s: 'heliosS',
  helios_laser: 'heliosM',
  helios_lance_l: 'heliosL',
  special_plasma_gatling: 'plazmaGatling',
  special_yamato_cannon: 'yamato',
  special_yamato_l: 'yamatoL',
  // Railguny snajperskie (Valkyrie, Lanca — ta sama receptura obrazu)
  special_valkyrie_s: 'snajperS',
  special_valkyrie_m: 'snajperM',
  lance_rail_m: 'snajperM',
  lance_rail_l: 'snajperL',
  special_valkyrie_railgun: 'snajperC',
  // Superbronie (ładowanie osobno)
  siege_railgun: 'mjolnirStrzal',
  hexlance_siege: 'hexlanceStrzal',
  death_ray: 'promienStrzal',
  // Wiązki
  beam_continuous: PETLA_WIAZKI,
  beam_pulse: 'wiazkaPuls',
  // Flak
  flak_s: 'flakS',
  flak_m: 'flakM',
  flak_l: 'flakL',
  flak_capital: 'flakC',
  // Rakiety (start rakiety)
  osa_micro_missile: 'rakietaS',
  roj_pod: 'rakietaS',
  fast_missile_rack: 'rakietaS',
  aerial_torpedo: 'rakietaS',
  missile_rack: 'rakieta',
  hydra_mirv: 'rakieta',
  grad_launcher: 'rakietaL',
  supernova_missile: 'supernovaStart',
  // Torpedy
  siege_torpedo: 'torpeda',
  torpedo_salvo: 'torpeda',
  siege_torpedo_mk2: 'torpedaC',
  // Bez dźwięku wystrzału (powód w BEZ_DZWIEKU)
  fighter_bay: null,
  fighter_squad_interceptor: null,
  fighter_squad_multirole: null,
  fighter_squad_strike: null,
  fighter_squad_bomber: null,
  fighter_squad_torpedo: null,
  fighter_squad_gunship: null,
  fighter_bomb: null
});

/** Broń jawnie bez dźwięku wystrzału — powód (strażnik: każde `null` w mapie ma tu wpis). */
export const BEZ_DZWIEKU = Object.freeze({
  fighter_bay: 'hangar — wyrzut myśliwców robi sesja „Dźwięki pozostałych obszarów gry”',
  fighter_squad_interceptor: 'hangar — jw.',
  fighter_squad_multirole: 'hangar — jw.',
  fighter_squad_strike: 'hangar — jw.',
  fighter_squad_bomber: 'hangar — jw.',
  fighter_squad_torpedo: 'hangar — jw.',
  fighter_squad_gunship: 'hangar — jw.',
  fighter_bomb: 'zrzut bomby myśliwca — dźwięk ma wybuch bomby, nie zrzut'
});

/** Ładowanie broni (narastanie od pierwszej próbki, gaśnie przy przerwaniu): broń → id. */
export const LADOWANIE_BRONI = Object.freeze({
  siege_railgun: 'mjolnirLadowanie',
  hexlance_siege: 'hexlanceLadowanie',
  death_ray: 'promienLadowanie'
});

/** Hexlance naładowany (okno strzału do 5 s) — pętla. */
export const HEXLANCE_GOTOWY = 'hexlanceGotowy';

/** Wiązka trafia: pętla w miejscu trafienia, dopóki trafia (kadłub / tarcza). */
export const WIAZKA_TRAFIENIE = Object.freeze({ kadlub: 'wiazkaKadlub', tarcza: 'wiazkaTarcza' });
/** Początek wiązki ciągłej (raz, potem pętla `wiazka`). */
export const WIAZKA_START = 'wiazkaStart';
/** Rozerwanie pocisku flak (zapalnik). */
export const FLAK_ROZPRYSK = 'flakRozprysk';

/**
 * Działko myśliwca: strzelec z `type` `fighter` / `interceptor` strzelający bronią lufową (nie rakietą, torpedą ani
 * bombą — te zostają na swoich ścieżkach) gra `mysliwiecDzialko` zamiast dźwięku broni okrętowej. Id i plik należą do
 * warstwy dźwięków świata (src/audio/dzwiekiSwiata.js); dopóki id nie ma w tabeli warstwy — dźwięk broni z mapy.
 */
export const MYSLIWIEC_DZIALKO = 'mysliwiecDzialko';
const BEZ_DZIALKA_MYSLIWCA = new Set(['rocket', 'torpedo', 'bomb', 'hangar']);
/** Czy strzelec to myśliwiec (pole `type` encji). */
export function jestMysliwcem(strzelec) {
  const t = strzelec ? strzelec.type : null;
  return t === 'fighter' || t === 'interceptor';
}
/** Czy broń myśliwca to działko (nie rakieta, torpeda, bomba). */
export function dzialkoMysliwca(def) {
  return !BEZ_DZIALKA_MYSLIWCA.has(String(def?.category || ''));
}

/** Rodziny plazmy — trafienie pociskiem w kadłub gra `trafieniePlazma` zamiast kinetycznego `trafienie`. */
const PLAZMA = new Set(['helios_laser_s', 'helios_laser', 'helios_lance_l', 'special_plasma_gatling', 'special_yamato_cannon', 'special_yamato_l']);

/**
 * Dźwięk wystrzału broni z mapy: id dźwięku z pliku, `SERIA`, `PETLA_WIAZKI`, `null` (jawnie bez dźwięku) albo
 * `undefined` (broni nie ma w mapie — klej bierze dźwięk kategorii).
 */
export function wystrzalBroni(weaponId) {
  return Object.prototype.hasOwnProperty.call(WYSTRZAL_BRONI, weaponId) ? WYSTRZAL_BRONI[weaponId] : undefined;
}

/** Zdarzenie trafienia pocisku broni w kadłub: plazma → `trafieniePlazma`, reszta → `trafienie`. */
export function zdarzenieTrafienia(weaponId) {
  return PLAZMA.has(weaponId) ? 'trafieniePlazma' : 'trafienie';
}

/**
 * Wpisy tabeli dźwięków uzbrojenia (doklejane do `DZWIEKI` w dzwiekiLogika.js). `p.wystrzal` — poprawka wystrzałów
 * (`POZIOM_WYSTRZALU`), `p.specjalna` — broń specjalna (`POZIOM_SPECJALNEJ`, +3 dB nad main). Poziomy z kategorii:
 * wystrzały `dzialo`, broń S o 3 dB ciszej (lekka i szybkostrzelna), superbronie `superbron`, ładowanie 3 dB pod
 * wystrzałem, pętle trafień wiązki `trafienie`, rozerwania flaku i pętla naładowanego Hexlance'a `drobne`.
 * `narastanie: true` — grane przez `petla` od początku pliku, bez zapętlenia (ładowanie), gaśnie bez odświeżenia.
 */
export function tabelaDzwiekowBroni(p) {
  const W = p.wystrzal;
  const S = p.specjalna;
  const lekka = -3;
  const st = (limit, odstep, zwloka, poziom, ton = 0.05, glos = 0.12) => ({ kat: 'dzialo', limit, odstep, zwloka, ton, glos, poziom });
  return {
    // Działka
    dzialkoS: st(6, 30, 3, W + lekka, 0.07, 0.15),
    dzialkoM: st(6, 35, 3, W, 0.06, 0.14),
    dzialkoL: st(5, 45, 3, W, 0.05, 0.12),
    dzialkoC: st(5, 45, 3, S, 0.04, 0.1),
    armataL: st(4, 60, 3, W, 0.04, 0.1),
    // Plazma
    heliosS: st(6, 30, 3, W + lekka, 0.06, 0.14),
    heliosM: st(6, 35, 3, W, 0.05, 0.12),
    heliosL: st(5, 45, 3, W, 0.04, 0.1),
    plazmaGatling: st(5, 40, 3, S, 0.05, 0.12),
    yamatoL: st(4, 60, 3, S, 0.03, 0.08),
    // Railguny snajperskie
    snajperS: st(3, 60, 3, S + lekka, 0.04, 0.1),
    snajperM: st(4, 60, 3, W, 0.04, 0.1),
    snajperL: st(4, 60, 3, W, 0.03, 0.08),
    snajperC: st(3, 80, 3, S, 0.03, 0.08),
    // Superbronie
    mjolnirLadowanie: { kat: 'dzialo', narastanie: true, limit: 2, poziom: W - 3 },
    mjolnirStrzal: { kat: 'superbron', limit: 2, odstep: 120, zwloka: 2, ton: 0.02, glos: 0.06 },
    hexlanceLadowanie: { kat: 'dzialo', narastanie: true, limit: 2, poziom: W - 3 },
    hexlanceGotowy: { kat: 'drobne', petla: true, limit: 1 },
    hexlanceStrzal: { kat: 'superbron', limit: 3, odstep: 200, zwloka: 2, ton: 0.02, glos: 0.06 },
    promienLadowanie: { kat: 'dzialo', narastanie: true, limit: 2, poziom: W - 3 },
    promienStrzal: { kat: 'superbron', limit: 2, odstep: 300, zwloka: 1, ton: 0.02, glos: 0.06 },
    // Wiązki
    wiazkaStart: st(4, 60, 1, W, 0.04, 0.1),
    wiazkaPuls: st(5, 40, 3, W, 0.05, 0.12),
    wiazkaKadlub: { kat: 'trafienie', petla: true, limit: 4 },
    wiazkaTarcza: { kat: 'trafienie', petla: true, limit: 4 },
    // Flak
    flakS: st(5, 45, 2, W + lekka, 0.06, 0.12),
    flakM: st(4, 55, 2, W, 0.06, 0.12),
    flakL: st(4, 65, 2, W, 0.05, 0.1),
    flakC: st(3, 80, 2, W, 0.04, 0.1),
    flakRozprysk: { kat: 'drobne', limit: 6, odstep: 40, zwloka: 2, ton: 0.1, glos: 0.2 },
    // Rakiety i torpedy
    rakietaS: st(6, 40, 4, W + lekka, 0.07, 0.14),
    rakietaL: st(5, 60, 4, W, 0.05, 0.12),
    torpeda: st(3, 120, 3, W, 0.04, 0.1),
    torpedaC: st(3, 150, 3, W, 0.03, 0.08)
  };
}
