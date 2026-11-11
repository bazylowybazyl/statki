// Dźwięki uzbrojenia (src/audio/dzwiekiBroni.js): mapa broń → dźwięk dla gracza i NPC, rodziny × wielkość, ładowanie
// superbroni, poziomy i opisy generatora. Dźwięku nikt tu nie słyszy — sprawdzamy mapę, tabelę i manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { DZWIEKI, KATEGORIE, dzwiekStrzalu } from '../src/audio/dzwiekiLogika.js';
import {
  WYSTRZAL_BRONI, BEZ_DZWIEKU, LADOWANIE_BRONI, HEXLANCE_GOTOWY, WIAZKA_TRAFIENIE, WIAZKA_START, FLAK_ROZPRYSK,
  SERIA, PETLA_WIAZKI, wystrzalBroni, zdarzenieTrafienia, MYSLIWIEC_DZIALKO, jestMysliwcem, dzialkoMysliwca
} from '../src/audio/dzwiekiBroni.js';
import { DZWIEKI_BRONI } from '../scripts/dzwieki-elevenlabs.lista-bronie.mjs';
import { DZWIEKI as LISTA } from '../scripts/dzwieki-elevenlabs.lista.mjs';

const manifest = JSON.parse(readFileSync(new URL('../public/sounds/ai/manifest.json', import.meta.url), 'utf8'));
const cel = (id) => KATEGORIE[DZWIEKI[id].kat].cel + (DZWIEKI[id].poziom || 0);

test('każda broń z MASTER_WEAPONS ma dźwięk wystrzału albo jawne „bez dźwięku” z powodem', () => {
  for (const id of Object.keys(MASTER_WEAPONS)) {
    assert.ok(Object.prototype.hasOwnProperty.call(WYSTRZAL_BRONI, id), `${id} bez wpisu w WYSTRZAL_BRONI`);
    const d = WYSTRZAL_BRONI[id];
    if (d === null) assert.ok(BEZ_DZWIEKU[id], `${id}: null bez powodu w BEZ_DZWIEKU`);
    else if (d !== SERIA) assert.ok(DZWIEKI[d], `${id} → ${d} spoza tabeli DZWIEKI`);
  }
  for (const id of Object.keys(WYSTRZAL_BRONI)) assert.ok(MASTER_WEAPONS[id], `martwy wpis mapy: ${id}`);
  for (const id of Object.keys(BEZ_DZWIEKU)) assert.equal(WYSTRZAL_BRONI[id], null, `${id} w BEZ_DZWIEKU, a ma dźwięk`);
  assert.equal(wystrzalBroni('nowa_bron_bez_wpisu'), undefined, 'broń spoza mapy — dźwięk kategorii w kleju');
});

test('seria z syntezy tylko dla szybkostrzelnych działek i CIWS, wiązka ciągła — pętla', () => {
  for (const [id, d] of Object.entries(WYSTRZAL_BRONI)) {
    if (d === SERIA) assert.ok(Number(MASTER_WEAPONS[id].cooldown) <= 0.1, `${id}: seria przy cooldown ${MASTER_WEAPONS[id].cooldown}`);
    if (d === PETLA_WIAZKI) assert.equal(MASTER_WEAPONS[id].beamMode, 'continuous', id);
  }
  assert.equal(WYSTRZAL_BRONI.beam_continuous, PETLA_WIAZKI);
  assert.ok(DZWIEKI[PETLA_WIAZKI].petla);
});

test('rodziny × wielkość: litera dźwięku = rozmiar broni, większa broń ma dłuższy (cięższy) dźwięk', () => {
  const LITERA = { S: 'S', M: 'M', L: 'L', Capital: 'C' };
  for (const [id, d] of Object.entries(WYSTRZAL_BRONI)) {
    const m = typeof d === 'string' && /^(dzialko|helios|snajper|flak|rakieta|torpeda|armata|yamato)(S|M|L|C)$/.exec(d);
    if (m) assert.equal(m[2], LITERA[MASTER_WEAPONS[id].size], `${id} (${MASTER_WEAPONS[id].size}) → ${d}`);
  }
  const s = (id) => DZWIEKI_BRONI.find((w) => w.id === id).s;
  for (const rodzina of [['dzialkoS', 'dzialkoM', 'dzialkoL', 'dzialkoC'], ['heliosS', 'heliosM', 'heliosL'],
    ['snajperS', 'snajperM', 'snajperL', 'snajperC'], ['flakS', 'flakM', 'flakL', 'flakC'], ['rakietaS', 'rakietaL'], ['torpeda', 'torpedaC']]) {
    for (let i = 1; i < rodzina.length; i++) assert.ok(s(rodzina[i]) > s(rodzina[i - 1]), `${rodzina[i]} nie dłuższy niż ${rodzina[i - 1]}`);
  }
});

test('ładowanie superbroni: osobny plik narastania, tylko broń z chargeTime; strzał osobno', () => {
  for (const [bron, id] of Object.entries(LADOWANIE_BRONI)) {
    assert.ok(Number(MASTER_WEAPONS[bron].chargeTime) > 0, `${bron} bez chargeTime`);
    assert.ok(DZWIEKI[id]?.narastanie && !DZWIEKI[id].petla, `${id}: narastanie, nie pętla`);
    assert.notEqual(WYSTRZAL_BRONI[bron], id, `${bron}: strzał ≠ ładowanie`);
    // plik ładowania trwa co najmniej tyle, co ładowanie w grze (nie kończy się przed strzałem)
    const s = DZWIEKI_BRONI.find((w) => w.id === id).s;
    assert.ok(s >= Number(MASTER_WEAPONS[bron].chargeTime), `${id}: ${s} s < ładowanie ${MASTER_WEAPONS[bron].chargeTime} s`);
  }
  assert.ok(DZWIEKI[HEXLANCE_GOTOWY].petla);
  for (const id of [WIAZKA_TRAFIENIE.kadlub, WIAZKA_TRAFIENIE.tarcza]) assert.ok(DZWIEKI[id]?.petla, id);
  assert.ok(DZWIEKI[WIAZKA_START] && DZWIEKI[FLAK_ROZPRYSK]);
});

test('poziomy: broń specjalna 0–4 dB nad main tej rodziny, lekka S nie głośniej niż M, superbronie w kategorii superbroni', () => {
  for (const [spec, main] of [['dzialkoC', 'dzialkoL'], ['plazmaGatling', 'heliosL'], ['yamatoL', 'heliosL'], ['snajperC', 'snajperL']]) {
    const d = cel(spec) - cel(main);
    assert.ok(d > 0 && d <= 4, `${spec} − ${main} = ${d} dB`);
  }
  for (const [lekka, srednia] of [['dzialkoS', 'dzialkoM'], ['heliosS', 'heliosM'], ['flakS', 'flakM'], ['rakietaS', 'rakieta']]) {
    assert.ok(cel(lekka) <= cel(srednia), `${lekka} głośniej niż ${srednia}`);
  }
  for (const id of ['mjolnirStrzal', 'hexlanceStrzal', 'promienStrzal']) assert.equal(DZWIEKI[id].kat, 'superbron', id);
  for (const id of Object.values(LADOWANIE_BRONI)) assert.ok(cel(id) < cel('tempestIon'), `${id}: ładowanie pod wystrzałem`);
  // nowe wystrzały na poziomie swojej kategorii — bez ściszania i podbijania całych grup ponad ±3 dB
  for (const w of DZWIEKI_BRONI) assert.ok(Math.abs(DZWIEKI[w.id].poziom || 0) <= 3, `${w.id}: poprawka ${DZWIEKI[w.id].poziom}`);
});

test('trafienie: plazma gra trafienie plazmy, kinetyczne — zwykłe', () => {
  assert.equal(zdarzenieTrafienia('helios_laser'), 'trafieniePlazma');
  assert.equal(zdarzenieTrafienia('special_yamato_l'), 'trafieniePlazma');
  assert.equal(zdarzenieTrafienia('heavy_autocannon'), 'trafienie');
});

test('lista generatora: każdy dźwięk uzbrojenia w liście, tabeli i manifeście; wystrzały z atakiem, bez słów z ocen', () => {
  const zLista = new Set(LISTA.map((w) => w.id));
  const ZAKAZANE = /\b(massive|huge|cinematic|thunderous|dull thud|resonating|muffled|subtle)\b/i;
  for (const w of DZWIEKI_BRONI) {
    assert.ok(zLista.has(w.id), `${w.id} nie dołączony do listy generatora`);
    assert.ok(DZWIEKI[w.id], `${w.id} bez wpisu w tabeli`);
    const pliki = manifest.pliki.filter((p) => p.id === w.id);
    assert.ok(pliki.length >= 2, `${w.id}: ${pliki.length} plików w manifeście`);
    for (const p of pliki) assert.ok(!ZAKAZANE.test(p.prompt), `${p.plik}: opis ze słowem z ocen użytkownika`);
    assert.equal(!!w.petla, !!DZWIEKI[w.id].petla, `${w.id}: pętla niezgodna`);
    const strzal = !w.petla && !DZWIEKI[w.id].narastanie;
    if (strzal) assert.match(w.prompt, /instant attack/, `${w.id}: wystrzał / trafienie bez „instant attack”`);
  }
});

test('działko myśliwca: `mysliwiecDzialko`, gdy jest w tabeli warstwy; bez niego — dźwięk broni z mapy (oba stany)', () => {
  assert.ok(jestMysliwcem({ type: 'fighter' }) && jestMysliwcem({ type: 'interceptor' }));
  assert.ok(!jestMysliwcem({ type: 'npc' }) && !jestMysliwcem(null));
  assert.ok(dzialkoMysliwca(MASTER_WEAPONS.gunship_autocannon) && !dzialkoMysliwca(MASTER_WEAPONS.aerial_torpedo) && !dzialkoMysliwca(MASTER_WEAPONS.fighter_bomb));
  const W = MASTER_WEAPONS.gunship_autocannon;
  const zId = { ...DZWIEKI, [MYSLIWIEC_DZIALKO]: { kat: 'dzialo' } };
  const bezId = { ...DZWIEKI };
  delete bezId[MYSLIWIEC_DZIALKO];
  // id jest w tabeli: działko myśliwca → mysliwiecDzialko; rakieta, torpeda, bomba myśliwca — swoja ścieżka
  assert.equal(dzwiekStrzalu('gunship_autocannon', W, false, true, zId), MYSLIWIEC_DZIALKO);
  assert.equal(dzwiekStrzalu('heavy_autocannon', MASTER_WEAPONS.heavy_autocannon, false, true, zId), MYSLIWIEC_DZIALKO);
  assert.equal(dzwiekStrzalu('aerial_torpedo', MASTER_WEAPONS.aerial_torpedo, false, true, zId), 'rakietaS');
  assert.equal(dzwiekStrzalu('fighter_bomb', MASTER_WEAPONS.fighter_bomb, false, true, zId), null);
  // id nie ma: dźwięk broni z mapy, bez wyjątku
  assert.equal(dzwiekStrzalu('gunship_autocannon', W, false, true, bezId), 'dzialkoS');
  // okręt (nie myśliwiec) nigdy nie gra dźwięku myśliwca
  assert.equal(dzwiekStrzalu('gunship_autocannon', W, false, false, zId), 'dzialkoS');
  // stan bieżącej tabeli (przed i po scaleniu dźwięków świata) — wynik zawsze grywalny
  const d = dzwiekStrzalu('gunship_autocannon', W, false, true);
  assert.equal(d, DZWIEKI[MYSLIWIEC_DZIALKO] ? MYSLIWIEC_DZIALKO : 'dzialkoS');
});
