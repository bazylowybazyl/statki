// Warstwa dźwięku sceny — czysta logika (src/audio/dzwiekiLogika.js): mapa zdarzeń, limit głosów, wyrównanie
// poziomów, pętla bez szwu, wybór wariantu, położenie. Dźwięku nikt tu nie słyszy — sprawdzamy liczby.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DZWIEKI, DZWIEKI_SYNTEZY, ZDARZENIA, STRZAL_GRACZA, KATEGORIE, kategoriaBroniNpc, jestCiws, zmierzPoziom,
  wzmocnienieWyrownania, buforPetliBezSzwu, wybierzWariant, utworzLimitGlosow, sciszenieTloku, polozenie,
  liniaWyboru, gainToDb, SZCZYT_PO_WYROWNANIU_DB, MAX_PODBICIE_DB
} from '../src/audio/dzwiekiLogika.js';

const manifest = JSON.parse(readFileSync(new URL('../public/sounds/ai/manifest.json', import.meta.url), 'utf8'));
const idManifestu = new Set(manifest.pliki.map((f) => f.id));

test('każdy dźwięk z tabeli sceny i z mapy zdarzeń jest w manifeście (pętle zgodne)', () => {
  for (const id of Object.keys(DZWIEKI)) {
    assert.ok(idManifestu.has(id), `brak ${id} w manifest.json`);
    const f = manifest.pliki.find((p) => p.id === id);
    assert.equal(!!DZWIEKI[id].petla, !!f.petla, `pętla ${id} niezgodna z manifestem`);
    assert.ok(KATEGORIE[DZWIEKI[id].kat], `kategoria ${id}`);
  }
  for (const [zd, id] of Object.entries(ZDARZENIA)) assert.ok(DZWIEKI[id], `zdarzenie ${zd} → ${id} spoza tabeli`);
  for (const [bron, id] of Object.entries(STRZAL_GRACZA)) assert.ok(DZWIEKI[id], `strzał ${bron} → ${id}`);
  assert.ok(DZWIEKI_SYNTEZY.silnikMain && DZWIEKI_SYNTEZY.gatling);
});

test('mapa zdarzeń: wymagane z opisu zadania', () => {
  const oczekiwane = {
    trafienie: 'trafienie', trafieniePlazma: 'trafieniePlazma', trafienieGracza: 'kadlub', rykoszet: 'rykoszet',
    tarczaTrafiona: 'tarcza', tarczaWlaczona: 'tarczaWl', tarczaWylaczona: 'tarczaWyl', tarczaZapadnieta: 'tarczaPekniecie',
    rakietaTrafila: 'wybuchRakiety', supernovaDetonacja: 'supernovaWybuch', rakietaZestrzelona: 'wybuchMaly',
    smiercOkretu: 'wybuchOkretu', wybuchWtorny: 'wybuch', kontaktKadlubow: 'uderzenieKadluba', zgniotKadluba: 'zgniot',
    taran: 'taran', dyszaBoczna: 'rcs', zmianaGrupy: 'grupa', ogienAutoWl: 'potwierdzenie', odmowa: 'blad',
    namiar: 'namiar', malowanieCelu: 'malowanie'
  };
  for (const [k, v] of Object.entries(oczekiwane)) assert.equal(ZDARZENIA[k], v, k);
  assert.equal(STRZAL_GRACZA.special_yamato_cannon, 'yamato');
  assert.equal(STRZAL_GRACZA.missile_rack, 'rakieta');
  assert.equal(STRZAL_GRACZA.supernova_missile, 'supernovaStart');
  assert.ok(jestCiws('ciws_mk2') && jestCiws('ciws_mk1') && !jestCiws('railgun_mk1'));
});

test('kategoria broni NPC (z pola category MASTER_WEAPONS)', async () => {
  const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
  const k = (id) => kategoriaBroniNpc(id, MASTER_WEAPONS[id]);
  assert.equal(k('railgun_mk2'), 'railgun');
  assert.equal(k('flak_m'), 'flak');
  assert.equal(k('laser_pd_mk1'), 'laserPD');
  assert.equal(k('beam_continuous'), 'wiazka');
  assert.equal(k('heavy_autocannon'), 'autocannon');
  assert.equal(k('armata_mk1'), 'dzialo');
  assert.equal(k('missile_rack'), 'rakieta');
  assert.equal(kategoriaBroniNpc('nieznana', { cooldown: 2 }), 'dzialo');
  assert.equal(kategoriaBroniNpc('nieznana', { fireRate: 8 }), 'autocannon');
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) assert.ok(DZWIEKI[kategoriaBroniNpc(id, def)], id);
  for (const id of ['railgun_mk1', 'railgun_mk2', 'tempest_ion_s', 'tempest_ion_l']) assert.equal(STRZAL_GRACZA[id], 'tempestIon');
});

test('limit głosów: salwa czterech wież przesuwa starty o odstęp, piąta ponad zwłokę odpada', () => {
  const tab = { a: { limit: 6, odstep: 30, zwloka: 3 } };
  const L = utworzLimitGlosow(tab);
  const z = [];
  for (let i = 0; i < 5; i++) z.push(L.przyjmij('a', 10, 1));
  assert.deepEqual(z.slice(0, 4).map((v) => Math.round(v * 1000)), [0, 30, 60, 90]);
  assert.equal(z[4], -1);
  assert.equal(L.statystyki('a').odrzuconeOdstep, 1);
  assert.equal(L.statystyki('a').przesuniete, 3);
});

test('limit głosów: najwyżej `limit` równoczesnych, po końcu głosu miejsce wraca', () => {
  const L = utworzLimitGlosow({ b: { limit: 2, odstep: 0, zwloka: 0 } });
  const w = { aktywne: 0 };
  assert.equal(L.przyjmij('b', 0, 1, w), 0);
  assert.equal(w.aktywne, 0);
  assert.equal(L.przyjmij('b', 0.1, 1, w), 0);
  assert.equal(w.aktywne, 1);
  assert.equal(L.przyjmij('b', 0.2, 1), -1);
  assert.equal(L.statystyki('b').odrzuconeLimit, 1);
  assert.equal(L.przyjmij('b', 1.05, 1), 0, 'pierwszy głos skończył się w 1,0 s');
});

test('ściszenie tłoku: suma n głosów rośnie wolniej niż n', () => {
  let suma = 0;
  for (let n = 0; n < 6; n++) suma += sciszenieTloku(n);
  assert.ok(suma < 4.5, `suma ${suma}`);
  assert.equal(sciszenieTloku(0), 1);
});

function sinus(n, amp, sr = 48000, f = 440) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * f * i) / sr);
  return a;
}

test('wyrównanie: cichy i głośny plik tej samej kategorii kończą na tym samym poziomie (z sufitem szczytu)', () => {
  const sr = 48000;
  const cichy = zmierzPoziom([sinus(sr, 0.02)], sr);
  const glosny = zmierzPoziom([sinus(sr, 0.9)], sr);
  const gc = wzmocnienieWyrownania(cichy, 'trafienie');
  const gg = wzmocnienieWyrownania(glosny, 'trafienie');
  const po = (p, g) => p.rmsDb + gainToDb(g);
  assert.ok(Math.abs(po(cichy, gc) - KATEGORIE.trafienie.cel) < 0.2, `cichy ${po(cichy, gc)}`);
  assert.ok(Math.abs(po(glosny, gg) - KATEGORIE.trafienie.cel) < 0.2, `głośny ${po(glosny, gg)}`);
  // szczyt nie wyżej niż sufit
  const ostry = { rms: 0.05, rmsDb: gainToDb(0.05), szczyt: 1, szczytDb: 0 };
  const g = wzmocnienieWyrownania(ostry, 'superbron');
  assert.ok(ostry.szczytDb + gainToDb(g) <= SZCZYT_PO_WYROWNANIU_DB + 1e-9);
  // podbicie z sufitem
  const szept = { rms: 1e-4, rmsDb: -80, szczyt: 2e-4, szczytDb: gainToDb(2e-4) };
  assert.ok(gainToDb(wzmocnienieWyrownania(szept, 'dzialo')) <= MAX_PODBICIE_DB + 1e-9);
  // kolejność kategorii: superbronie najgłośniej, interfejs najciszej
  const cele = ['superbron', 'dzialo', 'trafienie', 'drobne', 'interfejs'].map((k) => KATEGORIE[k].cel);
  for (let i = 1; i < cele.length; i++) assert.ok(cele[i] < cele[i - 1]);
});

test('pomiar: głośna część pliku, nie średnia z ciszą', () => {
  const sr = 48000;
  const a = new Float32Array(sr * 2);
  a.set(sinus(sr / 2, 0.5), 0); // 0,5 s dźwięku, 1,5 s ciszy
  const p = zmierzPoziom([a], sr);
  assert.ok(p.rmsDb > -10, `rms głośnej części ${p.rmsDb}`);
});

test('pętla bez szwu: obcięta cisza, koniec przechodzi gładko w początek', () => {
  const sr = 48000;
  const n = sr * 2;
  const raw = new Float32Array(n + 3000);
  // 1500 próbek ciszy (opóźnienie MP3), szum, 1500 ciszy na końcu
  let s = 12345;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 1500; i < 1500 + n; i++) raw[i] = 0.5 * r();
  const [out] = buforPetliBezSzwu([raw], sr, { fadeS: 0.2 });
  assert.ok(out.length < n && out.length > n * 0.8, `długość ${out.length}`);
  assert.ok(Math.abs(out[0]) > 0 || Math.abs(out[1]) > 0, 'bez ciszy na początku');
  // skok na szwie (ostatnia → pierwsza próbka) nie większy niż typowy skok w środku
  const skok = Math.abs(out[out.length - 1] - out[0]);
  assert.ok(skok < 1.5, `skok ${skok}`);
  // przenikanie: początek bufora to mieszanka z dalszym ciągiem końca (ciągłość z ostatnią próbką)
  const sinT = sinus(n, 0.5, sr, 220);
  const [ps] = buforPetliBezSzwu([sinT], sr, { fadeS: 0.25 });
  const d = Math.abs(ps[ps.length - 1] - ps[0]);
  const krok = (2 * Math.PI * 220 * 0.5) / sr;
  assert.ok(d < krok * 3, `szew sinusa ${d} > ${krok * 3}`);
});

test('wybór wariantu: stały z panelu, losowy bez powtórzenia', () => {
  assert.equal(wybierzWariant(3, 2, 0.1), 1);
  assert.equal(wybierzWariant(3, 9, 0.1), 2);
  assert.equal(wybierzWariant(0, 0, 0.5), -1);
  assert.equal(wybierzWariant(1, 0, 0.99), 0);
  let pop = -1;
  for (let i = 0; i < 200; i++) {
    const w = wybierzWariant(3, 0, (i * 0.618) % 1, pop);
    assert.ok(w >= 0 && w < 3);
    assert.notEqual(w, pop);
    pop = w;
  }
});

test('położenie: w kadrze pełna głośność, poza kadrem gaśnie, panorama ze strony ekranu, oddalenie ścisza', () => {
  const kadr = { x: 0, y: 0, polW: 1000, polH: 500, zoom: 0.5 };
  const p = polozenie(0, 0, kadr);
  assert.equal(p.glos, 1);
  assert.equal(p.pan, 0);
  assert.ok(polozenie(800, 0, kadr).pan > 0.5);
  assert.ok(polozenie(-800, 0, kadr).pan < -0.5);
  assert.ok(polozenie(5000, 0, kadr).glos < 0.5);
  assert.equal(polozenie(50000, 0, kadr).glos, 0);
  const daleko = polozenie(0, 0, { ...kadr, zoom: 0.02 });
  assert.ok(daleko.glos < 1 && daleko.glos >= 0.45);
  assert.equal(polozenie(NaN, 0, kadr).glos, 1);
});

test('linia wyboru w formacie strony odsłuchu', () => {
  assert.equal(liniaWyboru('kadlub', 2, ['kadlub_1.mp3', 'kadlub_2.mp3']), 'kadlub: kadlub_2.mp3');
  assert.equal(liniaWyboru('kadlub', 0, ['kadlub_1.mp3', 'kadlub_2.mp3']), 'kadlub: kadlub_1.mp3, kadlub_2.mp3 — losowo');
  assert.equal(liniaWyboru('kadlub', 1, ['kadlub_1.mp3'], true), 'kadlub: żaden — wyciszony w scenie');
});
