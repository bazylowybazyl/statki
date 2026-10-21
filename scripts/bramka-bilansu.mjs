/**
 * BRAMKA BILANSU — czy zmiana gospodarki może wejść do main (plan
 * `docs/PLAN-ekonomia-rynki.md` § 5).
 *
 * Puszcza świat ruchu v2 na kilku ziarnach (domyślnie 7, 11, 23; 240 min gry,
 * presja piratów ×1, magazyny ×4, gospodarka ×60), w trakcie biegu mierzy to,
 * czego nie widać w stanie końcowym (najdłuższy głód, kolejki na redzie, czas
 * ticku), i porównuje z progami. Wynik idzie do `.tmp/bramka-bilansu/*.json`,
 * a niezaliczenie kończy proces kodem 1.
 *
 *   node scripts/bramka-bilansu.mjs                         bramka na 3 ziarnach
 *   node scripts/bramka-bilansu.mjs --etykieta baza         nazwa pliku wyniku
 *   node scripts/bramka-bilansu.mjs --ziarna 7 --minuty 120 szybki przebieg roboczy
 *   node scripts/bramka-bilansu.mjs --rownolegle            ziarna naraz (czas ticku traci sens)
 *
 * Każde ziarno idzie w OSOBNYM procesie: moduły ruchu trzymają liczniki na
 * poziomie modułu (np. id agentów), więc drugi świat w tym samym procesie nie
 * byłby tym samym światem co pierwszy.
 *
 * Definicje progów (propozycja E4, akceptuje użytkownik):
 *   przechwyty  — przechwycone kursy Z ŁADUNKIEM / (dostarczone + przechwycone
 *                 z ładunkiem + bez paliwa). Puste przeloty (repozycjonowanie
 *                 floty) idą osobno: dyspozytor liczy stracone do przechwytów,
 *                 a udanych nie liczy wcale, więc w jednym worku zawyżały wynik
 *   głód        — najdłuższy CIĄGŁY czas, w którym surowiec chciany przez stację
 *                 (`stationWantsResource`) stoi poniżej 1% magazynu; liczone tylko
 *                 dla surowców, które ktoś w układzie wytwarza albo wydobywa
 *                 (złom bierze się z wraków gracza — jak w `symulacja-ruchu.mjs`)
 *   stocznia    — najdłuższy ciągły czas z pustymi pochylniami (nic w budowie)
 *   kolejka     — średnia liczba kursów na redzie portu w czasie biegu
 *   tick        — średni czas kroku świata w krokach, w których w powietrzu jest
 *                 co najmniej 90% szczytu kursów
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const PROGI = Object.freeze({
  /** Udział przechwyconych wśród rozstrzygniętych kursów (presja ×1). */
  przechwytyMax: 0.15,
  /** Najdłuższy ciągły głód chcianego surowca, minuty gry. */
  glodMinMax: 30,
  /** Najdłuższy ciągły postój stoczni bez niczego na pochylni, minuty gry. */
  stoczniaMinMax: 30,
  /** Średnia kolejka na redzie w każdym porcie. */
  kolejkaMax: 2,
  /** Średni tick przy szczycie kursów, ms. */
  tickMsMax: 25
});

/** Zapełnienie, poniżej którego surowiec liczy się jako „na zerze”. */
const PUSTO = 0.01;

function parseArgs(argv) {
  const out = {
    minuty: 240, presja: 1, magazyny: 4, skala: 60, ziarna: [7, 11, 23],
    etykieta: '', rownolegle: false, dziecko: null, wynik: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--minuty') out.minuty = Number(next());
    else if (a === '--presja') out.presja = Number(next());
    else if (a === '--magazyny') out.magazyny = Number(next());
    else if (a === '--skala') out.skala = Number(next());
    else if (a === '--ziarna') out.ziarna = String(next()).split(',').map(Number).filter(Number.isFinite);
    else if (a === '--etykieta') out.etykieta = String(next());
    else if (a === '--rownolegle') out.rownolegle = true;
    else if (a === '--dziecko') out.dziecko = Number(next());
    else if (a === '--wynik') out.wynik = String(next());
  }
  return out;
}

// ============================================================
// Jeden bieg (proces potomny)
// ============================================================

async function jedenBieg(args) {
  const { RESOURCES, RESOURCE_KEYS, RECIPES, PLANET_YIELD } = await import('../src/data/resources.js');
  const { stationWantsResource } = await import('../src/game/stationEconomy.js');
  const { directorSnapshot } = await import('../src/game/traffic/trafficDirector.js');
  const { summarizeShipyards } = await import('../src/game/traffic/shipyards.js');
  const { summarizeAgents } = await import('../src/game/traffic/agentFleets.js');
  const { summarizePiracy } = await import('../src/game/traffic/piracy.js');
  const { summarizeWar } = await import('../src/game/traffic/warDispatcher.js');
  const { getCourse } = await import('../src/game/traffic/courseRegistry.js');
  const { buildTrafficWorld, stepTrafficWorld, TRAFFIC_STEP_SECONDS } =
    await import('../src/game/traffic/trafficWorld.js');

  const world = buildTrafficWorld({
    economyScale: args.skala,
    capacityMultiplier: args.magazyny,
    piracyPressure: args.presja,
    piracyEnabled: args.presja > 0,
    seed: args.dziecko
  });
  const { stations, economies, registry, director, shipyards, network } = world;
  const STEP = TRAFFIC_STEP_SECONDS;

  // Co da się w ogóle zdobyć — ta sama definicja co w `symulacja-ruchu.mjs`.
  const obtainable = new Set();
  for (const recipe of Object.values(RECIPES)) for (const id of Object.keys(recipe.out)) obtainable.add(id);
  for (const entry of Object.values(PLANET_YIELD)) {
    if (entry.rate > 0) for (const id of Object.keys(entry.yields)) obtainable.add(id);
  }
  for (const field of network.fields) for (const id of Object.keys(field.yields || {})) obtainable.add(id);

  // Pary stacja × surowiec do śledzenia: stacja frakcyjna, surowiec chciany
  // i możliwy do zdobycia. Liczone raz po budowie — stocznie i wojna dopisują
  // `extraDemand` właśnie przy budowie świata.
  const pary = [];
  for (const station of stations) {
    if (!station.factionId) continue;
    const econ = economies.get(station.id);
    if (!econ) continue;
    for (const id of RESOURCE_KEYS) {
      if (!obtainable.has(id)) continue;
      if (!(Number(econ.capacity?.[id]) > 0)) continue;
      if (!stationWantsResource(station, id)) continue;
      pary.push({ stationId: station.id, econ, id, od: -1, max: 0, sumaPusto: 0 });
    }
  }
  const stocznie = shipyards.yards.map(yard => ({ yard, od: -1, max: 0, sumaPusto: 0 }));
  const kolejki = new Map();

  const totalSeconds = args.minuty * 60;
  const tickMs = [];
  const aktywne = [];
  let peak = 0;
  let t = 0;
  // Udane puste przeloty: dyspozytor ich nie liczy do dostaw, a stracone
  // liczy do przechwytów — bez nich udział przechwyconych jest zawyżony.
  let pustePrzeloty = 0;
  let pusteStracone = 0;
  const wrakiWidziane = new Set();
  for (let elapsed = 0; elapsed < totalSeconds; elapsed += STEP) {
    const t0 = process.hrtime.bigint();
    const wynikKroku = stepTrafficWorld(world, STEP);
    for (const ev of wynikKroku.events || []) {
      if (ev.type === 'done' && ev.course?.payload?.deadhead) pustePrzeloty++;
    }
    for (const wrak of director.wrecks) {
      if (wrakiWidziane.has(wrak.courseId)) continue;
      wrakiWidziane.add(wrak.courseId);
      if (wrak.reason === 'pirate' && getCourse(registry, wrak.courseId)?.payload?.deadhead) pusteStracone++;
    }
    tickMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    t = registry.clock;
    const czynne = registry.active.length;
    aktywne.push(czynne);
    if (czynne > peak) peak = czynne;

    for (const p of pary) {
      const cap = Number(p.econ.capacity[p.id]) || 0;
      const fill = cap > 0 ? (Number(p.econ.resources[p.id]) || 0) / cap : 1;
      if (fill < PUSTO) {
        if (p.od < 0) p.od = t - STEP;
        p.sumaPusto += STEP;
        p.max = Math.max(p.max, t - p.od);
      } else p.od = -1;
    }
    for (const s of stocznie) {
      if (s.yard.building.length === 0) {
        if (s.od < 0) s.od = t - STEP;
        s.sumaPusto += STEP;
        s.max = Math.max(s.max, t - s.od);
      } else s.od = -1;
    }
    for (const [stationId] of world.docks) {
      const q = director.portQueue.get(String(stationId)) || 0;
      kolejki.set(stationId, (kolejki.get(stationId) || 0) + q);
    }
  }

  const snap = directorSnapshot(director);
  const kroki = tickMs.length;
  const progSzczytu = peak * 0.9;
  let sumaSzczyt = 0, nSzczyt = 0;
  for (let i = 0; i < kroki; i++) {
    if (aktywne[i] >= progSzczytu) { sumaSzczyt += tickMs[i]; nSzczyt++; }
  }
  const zLadunkiem = snap.stats.lost - pusteStracone;
  const rozstrzygniete = snap.stats.delivered + zLadunkiem + snap.stats.stranded;
  const glod = pary
    .filter(p => p.max > 0)
    .map(p => ({
      stacja: p.stationId, surowiec: p.id, short: RESOURCES[p.id].short,
      maxMin: Math.round(p.max / 60 * 10) / 10,
      razemMin: Math.round(p.sumaPusto / 60 * 10) / 10
    }))
    .sort((a, b) => b.maxMin - a.maxMin);
  const sy = summarizeShipyards(shipyards);
  const ag = summarizeAgents(world.agents);
  const pir = summarizePiracy(world.piracy);
  const wojna = summarizeWar(world.war);

  return {
    ziarno: args.dziecko,
    kursy: {
      przewozy: snap.stats.hauls, wydobycie: snap.stats.mining,
      dostarczone: snap.stats.delivered, przechwycone: snap.stats.lost,
      bezPaliwa: snap.stats.stranded,
      pustePrzeloty, pusteStracone,
      udzialPrzechwyconych: rozstrzygniete > 0 ? zLadunkiem / rozstrzygniete : 0,
      /** Dawna miara planu (§ 2): wszystkie przechwyty / (dostarczone + przechwyty). */
      udzialPrzechwyconychDawny: (snap.stats.delivered + snap.stats.lost) > 0
        ? snap.stats.lost / (snap.stats.delivered + snap.stats.lost) : 0,
      skutecznosc: (snap.stats.hauls + snap.stats.mining) > 0
        ? snap.stats.delivered / (snap.stats.hauls + snap.stats.mining) : 0,
      szczyt: peak
    },
    glod: glod.slice(0, 40),
    glodNajdluzszyMin: glod[0]?.maxMin || 0,
    glodPozycjiPonadProg: glod.filter(g => g.maxMin > PROGI.glodMinMax).length,
    stocznie: stocznie.map(s => ({
      stacja: s.yard.stationId, frakcja: s.yard.factionId,
      bezPochylniMaxMin: Math.round(s.max / 60 * 10) / 10,
      bezPochylniRazemMin: Math.round(s.sumaPusto / 60 * 10) / 10
    })).sort((a, b) => b.bezPochylniMaxMin - a.bezPochylniMaxMin),
    zwodowane: sy.stats.built, zwodowaneWgKlas: sy.stats.byClass,
    kolejki: [...kolejki].map(([stacja, suma]) => ({
      stacja, srednia: Math.round(suma / Math.max(1, kroki) * 100) / 100,
      koniec: director.portQueue.get(String(stacja)) || 0
    })).sort((a, b) => b.srednia - a.srednia),
    tick: {
      sredniMs: tickMs.reduce((a, b) => a + b, 0) / Math.max(1, kroki),
      przySzczycieMs: nSzczyt ? sumaSzczyt / nSzczyt : 0
    },
    agenci: { kursy: ag.stats.hauls, bezOkazji: ag.stats.idle, straty: ag.stats.losses, kapital: ag.capital },
    piractwo: {
      rejdy: pir.stats.raidsLaunched, lup: Math.round(pir.stats.lootValue),
      przemyt: pir.stats.smugglesRun, wpadlo: pir.stats.smugglesCaught,
      polowania: pir.stats.huntsLaunched, ubici: pir.stats.raidsKilled
    },
    wojna: { wyprawy: wojna.stats.launched, bitwy: wojna.stats.battles, stracone: wojna.stats.shipsLost }
  };
}

// ============================================================
// Ocena
// ============================================================

function ocen(bieg) {
  const kolejkaMax = bieg.kolejki[0]?.srednia || 0;
  const stoczniaMax = bieg.stocznie[0]?.bezPochylniMaxMin || 0;
  const wyniki = [
    { prog: 'przechwyty', wartosc: bieg.kursy.udzialPrzechwyconych, limit: PROGI.przechwytyMax,
      opis: `${(bieg.kursy.udzialPrzechwyconych * 100).toFixed(1)}% kursów z ładunkiem (≤ ${PROGI.przechwytyMax * 100}%); `
        + `dawna miara ${(bieg.kursy.udzialPrzechwyconychDawny * 100).toFixed(1)}%, `
        + `puste przeloty ${bieg.kursy.pustePrzeloty} (stracone ${bieg.kursy.pusteStracone})` },
    { prog: 'głód', wartosc: bieg.glodNajdluzszyMin, limit: PROGI.glodMinMax,
      opis: `${bieg.glodNajdluzszyMin} min (${bieg.glod[0] ? `${bieg.glod[0].stacja} ${bieg.glod[0].short}` : '—'}), `
        + `${bieg.glodPozycjiPonadProg} pozycji > ${PROGI.glodMinMax} min` },
    { prog: 'stocznie', wartosc: stoczniaMax, limit: PROGI.stoczniaMinMax,
      opis: `${stoczniaMax} min (${bieg.stocznie[0]?.stacja || '—'})` },
    { prog: 'kolejka', wartosc: kolejkaMax, limit: PROGI.kolejkaMax,
      opis: `${kolejkaMax} (${bieg.kolejki[0]?.stacja || '—'})` },
    { prog: 'tick', wartosc: bieg.tick.przySzczycieMs, limit: PROGI.tickMsMax,
      opis: `${bieg.tick.przySzczycieMs.toFixed(1)} ms przy szczycie ${bieg.kursy.szczyt}` }
  ];
  for (const w of wyniki) w.ok = w.wartosc <= w.limit;
  return wyniki;
}

function uruchomDziecko(args, ziarno, plik) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(import.meta.url),
      '--dziecko', String(ziarno), '--wynik', plik,
      '--minuty', String(args.minuty), '--presja', String(args.presja),
      '--magazyny', String(args.magazyny), '--skala', String(args.skala)
    ], { stdio: ['ignore', 'inherit', 'inherit'], cwd: ROOT });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`ziarno ${ziarno}: kod ${code}`)));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.dziecko !== null) {
    const bieg = await jedenBieg(args);
    writeFileSync(args.wynik, JSON.stringify(bieg));
    return;
  }

  const katalog = path.join(ROOT, '.tmp', 'bramka-bilansu');
  mkdirSync(katalog, { recursive: true });
  const t0 = Date.now();
  console.log(`\n  BRAMKA BILANSU: ziarna ${args.ziarna.join(', ')}, ${args.minuty} min, presja ×${args.presja}, `
    + `magazyny ×${args.magazyny}, gospodarka ×${args.skala}${args.rownolegle ? ', równolegle' : ''}\n`);

  const pliki = args.ziarna.map(z => path.join(katalog, `.bieg-${process.pid}-${z}.json`));
  if (args.rownolegle) {
    await Promise.all(args.ziarna.map((z, i) => uruchomDziecko(args, z, pliki[i])));
  } else {
    for (let i = 0; i < args.ziarna.length; i++) await uruchomDziecko(args, args.ziarna[i], pliki[i]);
  }
  const biegi = pliki.map(p => JSON.parse(readFileSync(p, 'utf8')));
  for (const p of pliki) rmSync(p, { force: true });

  let wszystko = true;
  for (const bieg of biegi) {
    bieg.ocena = ocen(bieg);
    const k = bieg.kursy;
    console.log(`  ziarno ${bieg.ziarno}: dostawy ${k.dostarczone}, przechwycone ${k.przechwycone}, `
      + `skuteczność ${(k.skutecznosc * 100).toFixed(1)}%, zwodowane ${bieg.zwodowane}, `
      + `agenci ${bieg.agenci.kursy} kursów`);
    for (const w of bieg.ocena) {
      if (!w.ok) wszystko = false;
      console.log(`    ${w.ok ? 'OK  ' : 'ŹLE '} ${w.prog.padEnd(11)} ${w.opis}`);
    }
    const glodne = bieg.glod.filter(g => g.maxMin > PROGI.glodMinMax).slice(0, 8)
      .map(g => `${g.stacja} ${g.short} ${g.maxMin}m`).join(', ');
    if (glodne) console.log(`         głód: ${glodne}`);
    const stoczne = bieg.stocznie.filter(s => s.bezPochylniMaxMin > PROGI.stoczniaMinMax)
      .map(s => `${s.stacja} ${s.bezPochylniMaxMin}m`).join(', ');
    if (stoczne) console.log(`         stocznie: ${stoczne}`);
    const kolejne = bieg.kolejki.filter(q => q.srednia > PROGI.kolejkaMax)
      .map(q => `${q.stacja} ${q.srednia}`).join(', ');
    if (kolejne) console.log(`         kolejki: ${kolejne}`);
  }

  const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const nazwa = `${args.etykieta ? `${args.etykieta}-` : ''}${stempel}.json`;
  const plik = path.join(katalog, nazwa);
  writeFileSync(plik, JSON.stringify({
    kiedy: new Date().toISOString(), parametry: { ...args, dziecko: undefined, wynik: undefined },
    progi: PROGI, zaliczona: wszystko, sekundy: Math.round((Date.now() - t0) / 1000), biegi
  }, null, 2));
  console.log(`\n  ${wszystko ? 'BRAMKA ZALICZONA' : 'BRAMKA NIEZALICZONA'} — wynik: ${path.relative(ROOT, plik)}\n`);
  process.exitCode = wszystko ? 0 : 1;
}

main().catch(err => { console.error(err); process.exitCode = 2; });
