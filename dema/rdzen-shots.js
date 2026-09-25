// Zrzuty i pomiary dema rdzenia: Vite + headless Chrome (prawdziwe GPU przez
// D3D11, WebGPU dla solvera sprężyn). Wyniki: .tmp/rdzen/*.png + shots.json.
//   node dema/rdzen-shots.js                  → wszystkie ujęcia
//   node dema/rdzen-shots.js --only hulls,exposed
//   node dema/rdzen-shots.js --perf           → koszt detonacji (1/3/6 naraz)
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startChrome, startVite, evaluate, navigateAndWait, sleep, repo } from './rdzen-cdp.js';

const argv = process.argv.slice(2);
const arg = (n, f = null) => { const i = argv.indexOf(`--${n}`); return i < 0 ? f : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1'); };
const outDir = resolve(repo, arg('out', '.tmp/rdzen'));
mkdirSync(outDir, { recursive: true });
const [W, H] = (arg('size', '1600x900')).split('x').map(Number);
const only = arg('only') ? new Set(arg('only').split(',')) : null;

const results = {};
let ch = null;
let vite = null;

async function shot(name) {
  const png = await ch.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(outDir, `${name}.png`), Buffer.from(png.data, 'base64'));
  return `${name}.png`;
}

const ev = (expr) => evaluate(ch.cdp, expr, 600000);

async function open(scene, extra = '') {
  const ok = await navigateAndWait(ch.cdp, `${vite.base}/dema/rdzen-demo.html?scene=${scene}&shot=1${extra}`, '!!(window.__rdzen && window.__rdzen.ready)', 120000);
  if (!ok) throw new Error(`demo nie wstało: ${scene}`);
  await sleep(600);
  await ev(`(() => { const R = window.__rdzen; R.setOpt('ov-chamber', false); R.setOpt('ov-probe', false); R.setOpt('ov-state', false); R.renderFrames(2); return true; })()`);
}

// okno HDR wokół rdzenia celu (promień × k)
async function coreHdr(k = 1.4, i = null) {
  return ev(`(() => { const R = window.__rdzen; const c = R.coreScreen(${i ?? 'undefined'}); const r = Math.max(24, c.r * ${k}); return R.measureHDR({ x0: c.x - r, y0: c.y - r, w: 2 * r, h: 2 * r }); })()`);
}

const SCENARIOS = {
  // Trzy kadłuby z komorami, kandydatami i hardpointami (widok ogólny)
  async hulls() {
    await open('trio', '&hud=1');
    await ev(`(() => { const R = window.__rdzen; for (const [k, v] of [['ov-chamber', true], ['ov-state', true], ['ov-cands', true], ['ov-hp', true]]) R.setOpt(k, v); R.fit(); R.renderFrames(3); return true; })()`);
    results.hulls = { png: await shot('01-trzy-kadluby-komory'), counts: await ev('window.__rdzen.hexCounts()') };
    // zbliżenia na każdy kadłub z nakładkami
    for (const [id, name] of [['battleship', '02-bellator-komora'], ['pirate_battleship', '03-ironskull-komora'], ['atlas', '04-atlas-komora']]) {
      await open(id, '&hud=1');
      await ev(`(() => { const R = window.__rdzen; for (const [k, v] of [['ov-chamber', true], ['ov-state', true], ['ov-probe', true], ['ov-cands', true], ['ov-hp', true], ['ov-bugs', true]]) R.setOpt(k, v); R.fit(); R.renderFrames(3); return true; })()`);
      results[name] = { png: await shot(name) };
    }
  },

  // Nietknięty kadłub: rdzenia NIE widać (histogram w komorze = sam pancerz)
  async nominal() {
    await open('battleship');
    await ev(`(() => { const R = window.__rdzen; const c = R.S.ships[0].shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x, w.y, 2.2); R.renderFrames(3); return true; })()`);
    results.nominal = { png: await shot('05-nominalny-zblizenie'), hdr: await coreHdr() };
  },

  // Kanał wykopany Valkyrie z burty do ODSŁONIĘCIA, potem KRYTYCZNY i STOPIENIE
  async exposed() {
    await open('battleship', '&weapon=special_valkyrie_railgun');
    await ev(`window.__rdzen.setOpt('hp-off', true)`);
    const r = await ev(`window.__rdzen.fireUntil('exposed', 600)`);
    await ev(`(() => { const R = window.__rdzen; R.pause(true); const c = R.S.ships[0].shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x, w.y + 40, 2.2); R.renderFrames(4); return true; })()`);
    results.exposed = { fire: r, png: await shot('06-odsloniety-valkyrie'), hdr: await coreHdr() };
    await ev(`window.__rdzen.pause(false)`);
    const r2 = await ev(`window.__rdzen.fireUntil('critical', 600)`);
    await ev(`(() => { const R = window.__rdzen; R.pause(true); R.renderFrames(4); return true; })()`);
    results.critical = { fire: r2, png: await shot('07-krytyczny'), hdr: await coreHdr() };
    await ev(`window.__rdzen.pause(false)`);
    const r3 = await ev(`window.__rdzen.fireUntil('meltdown', 600)`);
    // połowa odliczania: klatki w czasie rzeczywistym, żeby żar i wyrzuty żyły
    await ev(`(() => { const R = window.__rdzen; R.pause(false); R.setTimeScale(1); return true; })()`);
    const half = await ev(`window.__rdzen.S.ships[0].shipCores[0].meltdownDuration * 0.5`);
    await sleep(half * 1000);
    await ev(`(() => { const R = window.__rdzen; R.pause(true); R.renderFrames(2); return true; })()`);
    results.meltdown = { fire: r3, png: await shot('08-stopienie-polowa'), hdr: await coreHdr(1.8) };
    await ev(`(() => { const R = window.__rdzen; R.pause(false); return true; })()`);
    await sleep(Math.max(0, half * 1000 - 900));
    await ev(`(() => { const R = window.__rdzen; R.pause(true); R.renderFrames(2); return true; })()`);
    results.meltdownEnd = { png: await shot('09-stopienie-koniec'), hdr: await coreHdr(2.2) };
    await ev(`(() => { const R = window.__rdzen; R.pause(false); R.setCamera(R.S.cam.x, R.S.cam.y, 0.45); return true; })()`);
    await sleep(1300);
    results.detonation = { png: await shot('10-detonacja'), summary: await ev('window.__rdzen.summary()') };
    await sleep(1500);
    results.aftermath = { png: await shot('11-po-detonacji') };
  },

  // Iron Skull i Atlas: odsłonięcie z bliska (wyrwa robiona wprost w komorze)
  async others() {
    for (const [id, name] of [['pirate_battleship', '12-ironskull-odsloniety'], ['atlas', '13-atlas-odsloniety']]) {
      await open(id);
      await ev(`(() => { const R = window.__rdzen; R.setOpt('hp-off', true); R.openChamber(0.45); R.stepSim(0.3); const c = R.S.ships[0].shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x, w.y, 2.4); R.pause(true); R.renderFrames(4); return true; })()`);
      results[name] = { png: await shot(name), hdr: await coreHdr(), core: await ev('window.__rdzen.summary().ships[0].cores[0]') };
    }
    // Atlas jako gracz: alarm stopienia
    await ev(`(() => { const R = window.__rdzen; R.pause(false); R.forceMeltdown(0); R.setCamera(R.S.cam.x, R.S.cam.y, 0.9); return true; })()`);
    await sleep(1600);
    await ev(`window.__rdzen.pause(true)`);
    await ev(`document.body.classList.remove('shot'); window.__rdzen.renderFrames(2); true`);
    results.atlasAlarm = { png: await shot('14-atlas-alarm-gracza') };
  },

  // Formacja: detonacja Bellatora A → fala na komory sąsiadów → łańcuch
  async formation() {
    await open('formation', '&hud=1');
    await ev(`(() => { const R = window.__rdzen; R.setOpt('ov-chamber', true); R.setOpt('ov-state', true); R.setOpt('ov-blast', true); R.fit(); R.renderFrames(2); return true; })()`);
    results.formationStart = { png: await shot('15-formacja-start') };
    await ev(`(() => { const R = window.__rdzen; R.forceMeltdown(0); return true; })()`);
    await sleep(3200);
    results.formationBlast = { png: await shot('16-formacja-wybuch-A'), summary: await ev('window.__rdzen.summary()') };
    await sleep(1500);
    results.formationChain = { png: await shot('17-formacja-lancuch'), summary: await ev('window.__rdzen.summary()') };
    await sleep(4000);
    results.formationEnd = { png: await shot('18-formacja-koniec'), summary: await ev('window.__rdzen.summary()') };
  },

  // Pasma HDR w powtarzalnym ujęciu: komora otwierana od środka (openChamber),
  // każdy stan na każdym kadłubie. Kanał kopany bronią (scenariusz `exposed`)
  // wypada za każdym razem inaczej, więc do porównań pasm się nie nadaje.
  async bands() {
    const rows = [];
    for (const id of ['battleship', 'pirate_battleship', 'atlas']) {
      await open(id);
      await ev(`(() => { const R = window.__rdzen; R.setOpt('hp-off', true); const c = R.S.ships[0].shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x, w.y, 2.2); return true; })()`);
      const measure = async (state, k) => {
        const hdr = await coreHdr(k);
        const core = await ev('window.__rdzen.summary().ships[0].cores[0]');
        rows.push({ hull: id, state, coreState: core.state, integrity: +core.integrity.toFixed(3), dead: core.dead, ...hdr, hist: Object.fromEntries(hdr.hist.map((b) => [`${b.from}-${b.to}`, b.count])) });
      };
      // ODSŁONIĘTY: 25% komory od środka (osłona ~0,75 — powyżej progu KRYTYCZNEGO)
      await ev(`(async () => { const R = window.__rdzen; R.openChamber(0.25); await R.runFrames(20, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      await measure('exposed', 1.4);
      if (id === 'battleship') await shot('20-pasma-bellator-odsloniety');
      await ev(`(async () => { const R = window.__rdzen; R.pause(false); R.openChamber(0.3); await R.runFrames(20, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      await measure('critical', 1.4);
      const dur = await ev(`(() => { const R = window.__rdzen; R.pause(false); R.forceMeltdown(0); return R.S.ships[0].shipCores[0].meltdownDuration; })()`);
      await ev(`(async () => { const R = window.__rdzen; await R.runFrames(${Math.round(dur * 0.5 * 60)}, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      await measure('meltdown-50', 1.8);
      // 70%: crescendo rdzenia przed błyskiem reactorblow (startuje chargeTime
      // 0,8 s przed końcem — overlay to osobny renderer, pomiar HDR go nie widzi)
      await ev(`(async () => { const R = window.__rdzen; R.pause(false); await R.runFrames(${Math.round(dur * 0.2 * 60)}, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      if (id === 'battleship') await shot('21-pasma-bellator-stopienie-70');
      await ev(`(async () => { const R = window.__rdzen; R.pause(false); await R.runFrames(${Math.round(dur * 0.2 * 60)}, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      await measure('meltdown-90', 2.2);
      // udziały: bez wyrzutów, bez żaru (reszta = kadłub + rozgrzany brzeg rany)
      for (const [key, label] of [['vents', 'meltdown-90 bez wyrzutów'], ['glow', 'meltdown-90 bez żaru']]) {
        await ev(`(() => { const R = window.__rdzen; R.coreFx.debug.${key} = false; R.renderFrames(1); return true; })()`);
        await measure(label, 2.2);
        await ev(`(() => { const R = window.__rdzen; R.coreFx.debug.${key} = true; R.renderFrames(1); return true; })()`);
      }
    }
    results.bands = rows;
    for (const r of rows) console.log(`  ${r.hull.padEnd(18)} ${r.state.padEnd(12)} (${r.coreState} ${Math.round(r.integrity * 100)}%)  max ${r.max.toFixed(2)}  p99 ${r.p99.toFixed(2)}  >0,9: ${r.over09}  ≥6: ${r.white}  hist ${JSON.stringify(r.hist)}`);
  },

  // Warianty detonacji: każdy na świeżym Bellatorze, trzy ujęcia na zegarze
  // ręcznym (błysk, rozpad albo strumień/kula w locie, koniec).
  async variants() {
    const rows = [];
    // Czas od wywołania; stopienie 0,9 s, więc błysk reactorblow (chargeTime 0,8 s
    // przed końcem odliczania) wypada na detonację. Błysk capital trwa 1,2 s.
    const ZOOM = { shatter: 0.36, halves: 0.36, thirds: 0.36, hole: 0.4, jet: 0.24, orb: 0.3 };
    const BASE_TIMES = [['a-wybuch', 1.05], ['b-po', 2.3], ['c-koniec', 3.9]];
    // wyrzut i kula: dodatkowa klatka w trakcie cięcia / wytapiania wyjścia
    const TIMES_FOR = { jet: [['a-wybuch', 1.05], ['a2-ciecie', 1.5], ['b-po', 2.3], ['c-koniec', 3.9]], orb: [['a-wybuch', 1.05], ['a2-topi', 1.5], ['b-po', 2.3], ['c-koniec', 3.9]] };
    let n = 0;
    for (const id of ['shatter', 'halves', 'thirds', 'hole', 'jet', 'orb']) {
      n++;
      // pierwszy start Vite potrafi przeładować stronę (optymalizacja zależności)
      // w środku ujęcia — wtedy jedno ponowienie od zera
      for (let attempt = 0; ; attempt++) {
        try { await variantShots(id, n); break; } catch (e) {
          if (attempt >= 1) throw e;
          console.log(`  ${id}: ponawiam (${String(e.message).split('\n')[0]})`);
        }
      }
    }
    results.variants = rows;
    results.variantsHdr = rows.hdr || null;
    for (const [k, h] of Object.entries(rows.hdr || {})) console.log(`  HDR ${k}: max ${h.max.toFixed(2)} p99 ${h.p99.toFixed(2)} >0,9: ${h.over09} ≥6: ${h.white} hist ${JSON.stringify(h.hist.map((b) => b.count))}`);

    async function variantShots(id, n) {
      await open('battleship');
      await ev(`(() => { const R = window.__rdzen; R.setOpt('det-secondary', 'always'); const t = R.S.ships[0]; const c = t.shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x + 200, w.y, ${ZOOM[id]}); R.detonateAs('${id}', 0, 0.9); return true; })()`);
      let tPrev = 0;
      const shots = [];
      for (const [tag, at] of (TIMES_FOR[id] || BASE_TIMES)) {
        await ev(`window.__rdzen.runFrames(${Math.round((at - tPrev) * 60)}, 60, { realtime: true }).then(() => true)`);
        tPrev = at;
        const name = `v${n}-${id}-${tag}`;
        shots.push(await shot(name));
        // pasma HDR strumienia i kuli w szerokim oknie wokół wyrwy
        if (tag === 'b-po' && (id === 'jet' || id === 'orb')) rows.hdr = { ...(rows.hdr || {}), [id]: await coreHdr(8) };
      }
      const info = await ev(`(() => { const R = window.__rdzen; return { hazards: R.hazards(), destructibles: R.S.destructibles.length, wrecks: R.S.destructibles.filter((e) => e.isWreck).length, log: R.S.log.map((l) => l.text).slice(-5) }; })()`);
      rows.push({ id, shots, ...info });
      console.log(`  ${id.padEnd(8)} wraków ${info.wrecks} · ${info.log.filter((l) => /DETONACJA|KULA/.test(l)).map((l) => l.replace(/^\s*[0-9.]+s\s+/, '')).join(' | ').slice(0, 230)}`);
    }
  },

  // Modele reaktora: prześwietlenie (cały model nad kadłubem), potem przez
  // wyrwę w trzech stanach z pomiarem HDR, na koniec wrak reaktora po wyrzucie.
  async reactorModels() {
    const rows = [];
    let n = 0;
    for (const [id, kind] of [['battleship', 'terran'], ['pirate_battleship', 'pirate'], ['atlas', 'atlas']]) {
      n++;
      await open(id);
      await ev(`(() => { const R = window.__rdzen; R.setOpt('hp-off', true); R.setOpt('model-xray', true); const c = R.S.ships[0].shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x, w.y, 2.2); R.renderFrames(3); return true; })()`);
      await shot(`m${n}-${kind}-a-przeswietlenie`);
      // zbliżenie na komorę (×8): sam model w prześwietleniu, potem przez wyrwę
      await ev(`(() => { const R = window.__rdzen; const c = R.S.ships[0].shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x, w.y, 8); R.renderFrames(3); return true; })()`);
      await shot(`m${n}-${kind}-a2-przeswietlenie-zblizenie`);
      await ev(`(() => { const R = window.__rdzen; R.setOpt('model-xray', false); R.renderFrames(2); return true; })()`);
      const measure = async (state, k) => {
        const hdr = await coreHdr(k);
        const core = await ev('window.__rdzen.summary().ships[0].cores[0]');
        rows.push({ hull: id, kind, state, coreState: core.state, integrity: +core.integrity.toFixed(3), ...hdr, hist: Object.fromEntries(hdr.hist.map((b) => [`${b.from}-${b.to}`, b.count])) });
      };
      await ev(`(async () => { const R = window.__rdzen; R.openChamber(0.25); await R.runFrames(20, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      await measure('exposed', 1.4);
      await shot(`m${n}-${kind}-b-odsloniety`);
      await ev(`(async () => { const R = window.__rdzen; R.pause(false); R.openChamber(0.35); await R.runFrames(20, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      await measure('critical', 1.4);
      await shot(`m${n}-${kind}-c-krytyczny`);
      // wariant bez reactorblow (wyrzut): błysk capital startuje 0,8 s przed
      // wybuchem i przy zbliżeniu ×8 zalewałby klatkę stopienia
      const dur = await ev(`(() => { const R = window.__rdzen; R.pause(false); R.forceMeltdown(0); const c = R.S.ships[0].shipCores[0]; c.pendingVariant = 'jet'; return c.meltdownDuration; })()`);
      await ev(`(async () => { const R = window.__rdzen; await R.runFrames(${Math.round(dur * 0.8 * 60)}, 60); R.pause(true); R.renderFrames(2); return true; })()`);
      await measure('meltdown-80', 2.0);
      await shot(`m${n}-${kind}-d-stopienie`);
      // wrak reaktora po wyrzucie (plazma zgasła, łuk rozerwany, żar stygnie)
      await ev(`(async () => { const R = window.__rdzen; R.pause(false); R.setOpt('det-secondary', 'never'); const c = R.S.ships[0].shipCores[0]; c.meltdownRemaining = 0.05; $('det-variant').value = 'jet'; c.pendingVariant = 'jet'; await R.runFrames(150, 60); R.pause(true); R.renderFrames(2); return true; })()`.replace('$(', 'document.getElementById('));
      // odrzut przesunął i obrócił kadłub — kamera wraca na rdzeń
      await ev(`(() => { const R = window.__rdzen; const c = R.S.ships[0].shipCores[0]; const w = R.SC.getCoreWorld(c, {}); R.setCamera(w.x, w.y, 5); R.renderFrames(2); return true; })()`);
      await shot(`m${n}-${kind}-e-wrak-po-wyrzucie`);
      await ev(`(() => { const R = window.__rdzen; R.setOpt('model-xray', true); R.renderFrames(2); return true; })()`);
      await shot(`m${n}-${kind}-f-wrak-przeswietlenie`);
      await ev(`(() => { const R = window.__rdzen; R.setOpt('model-xray', false); R.pause(false); return true; })()`);
      const st = await ev('window.__rdzen.reactor3D.stats');
      console.log(`  ${kind}: model ${JSON.stringify(st)}`);
    }
    results.reactorModels = rows;
    for (const r of rows) console.log(`  ${r.kind.padEnd(7)} ${r.state.padEnd(12)} (${r.coreState} ${Math.round(r.integrity * 100)}%)  max ${r.max.toFixed(2)}  p99 ${r.p99.toFixed(2)}  >0,9: ${r.over09}  ≥6: ${r.white}  hist ${JSON.stringify(r.hist)}`);
  },

  // Kula wycelowana w sąsiada (formacja): topi wyjście z Bellatora A, leci
  // i przetapia się przez Iron Skulla C; strumień z A tnie Bellatora B.
  async formationHazards() {
    const rows = {};
    for (const [id, aim, tag, times, zoom] of [
      ['orb', 2, 'v7-kula-topi', [['a-wyjscie', 1.45], ['b-lot', 2.1], ['c-w-celu', 2.7], ['d-koniec', 3.7]], 0.3],
      ['jet', 1, 'v8-strumien-tnie', [['a-start', 1.1], ['b-ciecie', 1.6], ['c-koniec', 2.8]], 0.3]
    ]) {
      for (let attempt = 0; ; attempt++) {
        try {
          await open('formation');
          await ev(`(() => { const R = window.__rdzen; R.setOpt('det-secondary', 'never'); const a = R.S.ships[0]; const b = R.S.ships[${aim}]; const w = R.SC.getCoreWorld(a.shipCores[0], {}); R.setCamera((w.x + b.x) / 2, (w.y + b.y) / 2, ${zoom}); R.detonateAs('${id}', 0, 0.9, ${aim}); return true; })()`);
          let tPrev = 0;
          const shots = [];
          for (const [t, at] of times) {
            await ev(`window.__rdzen.runFrames(${Math.round((at - tPrev) * 60)}, 60, { realtime: true }).then(() => true)`);
            tPrev = at;
            shots.push(await shot(`${tag}-${t}`));
          }
          const info = await ev(`(() => { const R = window.__rdzen; return { log: R.S.log.map((l) => l.text).slice(-6), ships: R.S.ships.map((s) => ({ label: s.__label, hexes: s.hexGrid ? s.hexGrid.shards.filter((h) => h.active && !h.isDebris).length : 0 })) }; })()`);
          rows[tag] = { shots, ...info };
          console.log(`  ${tag}: ${info.ships.map((x) => `${x.label} ${x.hexes}`).join(' · ')}`);
          for (const l of info.log.filter((l) => /DETONACJA|KULA|STOPIENIE|ODSŁ|KRYT/.test(l))) console.log(`    ${l.replace(/^\s*[0-9.]+s\s+/, '').slice(0, 200)}`);
          break;
        } catch (e) {
          if (attempt >= 1) throw e;
          console.log(`  ${tag}: ponawiam (${String(e.message).split('\n')[0]})`);
        }
      }
    }
    results.formationHazards = rows;
  },

  // Koszt detonacji: 1, 3, 6 kapitalnych naraz (czas klatki, draw calle)
  async perf() {
    const rows = [];
    for (const n of [1, 3, 6]) {
      await open('battleship');
      await ev(`window.__rdzen.setOpt('ov-chamber', false)`);
      rows.push(await ev(`window.__rdzen.perfDetonations(${n}, 4)`));
      if (n === 6) await shot('19-perf-6-detonacji');
    }
    results.perf = rows;
  }
};

async function main() {
  vite = await startVite(5270);
  ch = await startChrome({ width: W, height: H });
  try {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
      if (only && !only.has(name)) continue;
      if (!only && name === 'perf' && !arg('perf')) continue;
      const t0 = Date.now();
      ch.logs.length = 0;
      try {
        await fn();
        console.log(`${name}: OK (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      } catch (err) {
        console.log(`${name}: BŁĄD ${err.message}`);
        results[`${name}_error`] = String(err.stack || err);
      }
      const errs = ch.logs.filter((l) => /\[(error|exception)\]/.test(l));
      if (errs.length) results[`${name}_logs`] = errs.slice(0, 20);
    }
  } finally {
    writeFileSync(resolve(outDir, 'shots.json'), JSON.stringify(results, null, 2));
    await ch.close();
    await vite.server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
