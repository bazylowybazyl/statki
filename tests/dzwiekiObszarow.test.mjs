// Dźwięki obszarów gry (reguła `dzwiek`): tabela src/audio/dzwiekiSwiata.js zgodna z manifestem i tabelą warstwy,
// reżyser src/game/dzwiekiObszarow.js — zdarzenia z różnicy stanu (warp gracza, osie warpa NPC, maskowanie, rdzeń).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DZWIEKI_SWIATA, ZDARZENIA_SWIATA } from '../src/audio/dzwiekiSwiata.js';
import { DZWIEKI, ZDARZENIA, KATEGORIE } from '../src/audio/dzwiekiLogika.js';
import { utworzRezyserObszarow } from '../src/game/dzwiekiObszarow.js';

const manifest = JSON.parse(readFileSync(new URL('../public/sounds/ai/manifest.json', import.meta.url), 'utf8'));

test('tabela obszarów: w tabeli warstwy, pliki i warianty w manifeście, kategoria, obszar', () => {
  for (const [id, d] of Object.entries(DZWIEKI_SWIATA)) {
    assert.equal(DZWIEKI[id], d, `${id} poza tabelą warstwy`);
    assert.ok(KATEGORIE[d.kat], `kategoria ${id}`);
    assert.ok(typeof d.obszar === 'string' && d.obszar, `obszar ${id}`);
    const pliki = manifest.pliki.filter((p) => p.id === id);
    assert.ok(pliki.length, `brak ${id} w manifeście`);
    for (const p of pliki) assert.equal(!!p.petla, !!d.petla, `pętla ${p.plik}`);
    if (d.warianty) {
      assert.ok(d.warianty.length >= 1);
      for (const w of d.warianty) assert.ok(pliki.some((p) => p.wariant === w), `${id}: brak wariantu ${w}`);
    }
  }
  for (const [zd, id] of Object.entries(ZDARZENIA_SWIATA)) {
    assert.equal(ZDARZENIA[zd], id, `zdarzenie ${zd} poza ZDARZENIA`);
    assert.ok(DZWIEKI_SWIATA[id], `zdarzenie ${zd} → ${id} spoza tabeli obszarów`);
  }
});

test('poziomy: tło mostka najciszej, detonacja rdzenia w superbroniach, klik w interfejsie', () => {
  assert.equal(DZWIEKI_SWIATA.mostek.kat, 'tlo');
  assert.equal(DZWIEKI_SWIATA.reaktorWybuch.kat, 'superbron');
  assert.equal(DZWIEKI_SWIATA.klik.kat, 'interfejs');
  assert.ok(DZWIEKI_SWIATA.mostek.ui && DZWIEKI_SWIATA.klik.ui, 'bez położenia');
});

function ujscie() {
  const graj = [];
  const petle = [];
  return {
    graj, petle,
    u: { graj: (id, x, y, g) => { graj.push(id); return true; }, petla: (k, id, g, x, y) => { petle.push([k, id, g]); } }
  };
}

test('warp gracza: ładowanie, skok, tunel co klatkę, zejście; pierwszy odczyt cicho, przerwane ładowanie cicho', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  r.warpGracza('active', 0, 0); // zastany w warpie: tylko pętla
  assert.deepEqual(s.graj, []);
  assert.equal(s.petle.length, 1);
  r.warpGracza('idle', 0, 0);
  r.warpGracza('charging', 0, 0);
  r.warpGracza('idle', 0, 0); // przerwane
  r.warpGracza('charging', 0, 0);
  r.warpGracza('charging', 0, 0);
  r.warpGracza('active', 0, 0);
  r.warpGracza('active', 0, 0);
  r.warpGracza('idle', 0, 0);
  assert.deepEqual(s.graj, ['warpZejscie', 'warpLadowanie', 'warpLadowanie', 'warpKop', 'warpZejscie']);
  assert.equal(r.stats.warpPrzerwane, 1);
  assert.equal(s.petle.filter((p) => p[1] === 'warpTunel').length, 3);
});

test('osie warpa NPC: zwiastun i wyrzut raz na oś, odlot ładowanie i skok, spóźnione bez dźwięku', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  const przylot = { kind: 'arrival', fx: { t0: 1, tBrake: 3.5, x: 10, y: 20 } };
  const piraci = { kind: 'arrival', fx: { t0: 1, tBrake: Infinity, x: 0, y: 0 } };
  const odlot = { kind: 'departure', fx: { t0: 2, tDive: 4.2, x: 0, y: 0, cx: 100, cy: 0 } };
  const rek = [przylot, piraci, odlot];
  for (let t = 0; t <= 5; t += 0.1) r.osieWarpa(rek, t);
  assert.equal(r.stats.przylotZwiastun, 2);
  assert.equal(r.stats.przylotWyrzut, 1);
  assert.equal(r.stats.odlotLadowanie, 1);
  assert.equal(r.stats.odlotSkok, 1);
  // zastane po czasie (np. zapis wczytany w trakcie osi) — bez dźwięku
  const r2 = utworzRezyserObszarow(ujscie().u);
  r2.osieWarpa([{ kind: 'arrival', fx: { t0: 0, tBrake: 1, x: 0, y: 0 } }], 10);
  assert.equal(r2.stats.przylotWyrzut, 0);
  assert.equal(r2.stats.spoznione, 2);
});

test('maskowanie: włączenie, wyłączenie, zerwanie (forced) zamiast wyłączenia', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  const c = { state: 'off', lastBreak: null };
  const krok = () => r.maskowanieGracza(c.state, c.lastBreak, 0, 0);
  krok();
  c.state = 'engaging'; krok();
  c.state = 'on'; krok();
  c.state = 'revealing'; c.lastBreak = { reason: 'manual', forced: false }; krok();
  c.state = 'off'; krok();
  c.state = 'engaging'; krok();
  c.state = 'on'; krok();
  c.state = 'cooldown'; c.lastBreak = { reason: 'fire', forced: true }; krok();
  krok();
  assert.deepEqual(s.graj, ['maskaWl', 'maskaWyl', 'maskaWl', 'maskaZerwanie']);
});

test('rdzeń: pętla stopienia narasta z postępem, gaśnie przy detonacji, detonacja gra wybuch', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  const host = { x: 5, y: 6 };
  r.rdzenStopienie(host, 10, 2.5);
  r.klatka(10);
  r.klatka(11.25);
  r.klatka(12.5);
  const g = s.petle.map((p) => p[2]);
  assert.equal(s.petle[0][1], 'reaktorStopienie');
  assert.ok(g[0] < g[1] && g[1] < g[2] && g[2] <= 1, `narastanie ${g}`);
  r.rdzenDetonacja(host, 5, 6);
  r.klatka(12.6);
  assert.equal(s.petle.length, 3, 'po detonacji pętla bez odświeżenia');
  assert.deepEqual(s.graj, ['reaktorWybuch']);
  // śmierć z puli HP: detonacja bez stopienia
  r.rdzenDetonacja({ x: 0, y: 0 }, 0, 0);
  assert.equal(r.stats.rdzenDetonacja, 2);
  // stopienie bez detonacji (gospodarz zniknął) — slot się zwalnia
  const h2 = { x: 0, y: 0 };
  r.rdzenStopienie(h2, 20, 1.5);
  h2.dead = true;
  r.klatka(20.5);
  assert.equal(s.petle.length, 3);
});

test('tło mostka i klik bez położenia', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  r.tloMostka(0);
  r.tloMostka(0.8);
  r.klik();
  assert.deepEqual(s.petle.map((p) => p[1]), ['mostek']);
  assert.deepEqual(s.graj, ['klik']);
});

test('hipercruise: rozruch, wejście, pętla lotu, wyjście; przerwany rozruch cicho', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  for (const st of ['idle', 'spool', 'idle', 'spool', 'active', 'active', 'drop', 'idle']) r.hipercruise(st, 0, 0);
  assert.deepEqual(s.graj, ['hcRozruch', 'hcRozruch', 'hcKop', 'hcWyjscie']);
  assert.equal(r.stats.hcPrzerwany, 1);
  assert.equal(s.petle.filter((p) => p[1] === 'hcLot').length, 2);
});

test('ostrzeżenie o rakietach: pętla tylko przy rakietach w gracza; licznik po buforze zagrożeń', async () => {
  const { liczRakietyNaGracza } = await import('../src/game/dzwiekiObszarow.js');
  const gracz = {};
  const inny = {};
  const bufor = [
    { rocket3d: true, slot: { target: gracz }, life: 3 },
    { rocket3d: false, target: gracz, life: 1 },
    { rocket3d: false, target: inny, life: 1 },
    { rocket3d: false, target: gracz, life: 0 },
    { rocket3d: true, slot: { target: gracz }, life: 2, dead: true }
  ];
  assert.equal(liczRakietyNaGracza(bufor, gracz), 2);
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  r.ostrzezenieRakiet(0);
  r.ostrzezenieRakiet(2);
  assert.deepEqual(s.petle.map((p) => p[1]), ['rakietyOstrzezenie']);
});

test('silniki obcych: najbliższe z ciągiem, w zasięgu, najwyżej maks', () => {
  const r = utworzRezyserObszarow(ujscie().u, { ustawienia: { silnikMaks: 3 } });
  const npcs = [
    { x: 500, y: 0, c: 1 }, { x: 100, y: 0, c: 0.5 }, { x: 50, y: 0, c: 0.01 }, { x: 300, y: 0, c: 0.8 },
    { x: 200, y: 0, c: 0.9, ukryty: true }, { x: 5000, y: 0, c: 1 }, { x: 400, y: 0, c: 0.7 }
  ];
  const grane = [];
  const n = r.silnikiObcych(npcs, 0, 0, 1000, (e) => e.c, () => false, (e) => !e.ukryty, (e, c) => grane.push(e.x));
  assert.equal(n, 3);
  assert.deepEqual(grane, [100, 300, 400]);
});

test('przelot myśliwca: raz przy najbliższym podejściu, z prędkością, w promieniu, z odstępem', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u, { ustawienia: { przelotPromien: 0.4, przelotMinV: 150, przelotOdstep: 2.5 } });
  const f = { x: -400, y: 50, vx: 400, vy: 0 };
  const wolny = { x: -400, y: 60, vx: 50, vy: 0 };
  const daleki = { x: -400, y: 900, vx: 400, vy: 0 };
  const lista = [f, wolny, daleki];
  let t = 0;
  for (let k = 0; k < 40; k++, t += 0.05) {
    for (const e of lista) e.x += e.vx * 0.05;
    r.przelotyMysliwcow(lista, 0, 0, 1000, t, () => true);
  }
  assert.deepEqual(s.graj, ['mysliwiecPrzelot']);
  // zawraca w ciągu 2,5 s — bez drugiego przelotu
  f.vx = -400;
  for (let k = 0; k < 20; k++, t += 0.05) { f.x += f.vx * 0.05; r.przelotyMysliwcow(lista, 0, 0, 1000, t, () => true); }
  assert.equal(r.stats.mysliwiecPrzelot, 1);
});

test('stałe reżysera = stałe modułów gry (kopalnia, drony, kapsuły)', async () => {
  const { FX_KOPALNI, FX_DRONOW, DRON_PRACA, KAPSULA } = await import('../src/game/dzwiekiObszarow.js');
  const { MINING_FX } = await import('../src/game/asteroidMiningRig.js');
  const { REPAIR_FX, DRONE_STATE } = await import('../src/game/repairRig.js');
  const { POD_STATE } = await import('../src/game/escapePods.js');
  assert.deepEqual({ ...FX_KOPALNI }, { ...MINING_FX });
  assert.deepEqual({ ...FX_DRONOW }, { ...REPAIR_FX });
  assert.equal(DRON_PRACA, DRONE_STATE.WORK);
  assert.deepEqual({ ...KAPSULA }, { ...POD_STATE });
});

test('kopalnia: pętle pracy, pierścień zdarzeń od kursora (stare pomijane), układ skał → świat', () => {
  const s = ujscie();
  const pozycje = [];
  s.u.graj = (id, x, y) => { s.graj.push(id); pozycje.push([x, y]); return true; };
  const r = utworzRezyserObszarow(s.u);
  const fx = [];
  for (let i = 0; i < 4; i++) fx.push({ kind: 0, x: 0, y: 0 });
  const rig = { firing: true, drones: [{ laserOn: false }, { laserOn: true }], saw: { active: true, done: false }, tractorOn: false, fx, fxWrite: 0 };
  const dodaj = (kind, x, y) => { const e = fx[rig.fxWrite % fx.length]; e.kind = kind; e.x = x; e.y = y; rig.fxWrite++; };
  dodaj(1, 0, 0); // przed pierwszym odczytem — pominięte
  r.kopalnia(rig, 0, 0);
  dodaj(1, 10, 20); dodaj(3, 1, 1); dodaj(4, 2, 2); dodaj(2, 3, 3);
  r.kopalnia(rig, 0, 0);
  assert.deepEqual(s.graj, ['skalaWybuch', 'skalaPekniecie', 'urobekZbior', 'skalaWybuch']);
  assert.deepEqual(pozycje[0], [10, -20]);
  assert.deepEqual([...new Set(s.petle.map((p) => p[1]))], ['kopalniaLaser', 'kopalniaPila']);
});

test('drony naprawcze: zdarzenia pierścienia i pętla spawu na rig', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  const fx = [{ kind: 0, x: 0, y: 0 }, { kind: 0, x: 0, y: 0 }, { kind: 0, x: 0, y: 0 }];
  const rig = { fx, fxWrite: 0, drones: [{ state: 1, wx: 0, wy: 0 }, { state: 2, wx: 5, wy: 6 }] };
  r.dronyNaprawcze([rig]);
  for (const k of [3, 1, 4, 2]) { const e = fx[rig.fxWrite % 3]; e.kind = k; rig.fxWrite++; }
  r.dronyNaprawcze([rig]);
  // 4 zdarzenia przy pierścieniu 3 — najstarsze przepadło
  assert.deepEqual(s.graj, ['dronLata', 'dronDok', 'wybuchMaly']);
  assert.equal(s.petle.filter((p) => p[1] === 'dronSpaw').length, 2);
});

test('kapsuły: wyrzut z liczności PENDING, zapłon COAST → FLY', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  const st = { count: 3, state: [0, 0, 0], x: [1, 2, 3], y: [0, 0, 0] };
  r.kapsuly(st);
  st.state[0] = 1;
  r.kapsuly(st);
  st.state[1] = 1; st.state[2] = 1;
  r.kapsuly(st);
  st.state[0] = 2;
  r.kapsuly(st);
  assert.deepEqual(s.graj, ['kapsulaWyrzut', 'kapsulaWyrzut', 'kapsulaSilnik']);
  assert.equal(r.stats.kapsulaWyrzut, 3);
});

test('zbiórka łupu: pętla tylko z celami', () => {
  const s = ujscie();
  const r = utworzRezyserObszarow(s.u);
  r.zbiorka(0, 0, 0);
  r.zbiorka(2, 0, 0);
  assert.deepEqual(s.petle.map((p) => p[1]), ['wiazkaZbiorki']);
});
