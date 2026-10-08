// Narzędzie dema roju WebGPU (dema/roj-webgpu.html): Vite + headless Chrome na prawdziwym GPU.
//
//   node scripts/webgpu/roj-demo.mjs --tryb test
//        każda scena po kolei: kilkaset klatek, błędy konsoli / walidacji WebGPU / WGSL, statystyki
//   node scripts/webgpu/roj-demo.mjs --tryb metryki [--sceny atlas,wymiana] [--wieza smart,naive] [--limit 900] [--tune orcaTau=1.5,margin=2]
//        przebieg scenariusza do końca (tempo ×4): czas, puste przeloty, wyważenie, zderzenia
//        (obrysy z kursem), najmniejsza przerwa, najbliższe pary wg faz, zastoje
//   node scripts/webgpu/roj-demo.mjs --tryb zrzuty [--out katalog] [--tylko galeria,wymiana]
//   node scripts/webgpu/roj-demo.mjs --tryb wydajnosc
//
// Opcje: --w 1920 --h 1080, --port 5410. Wyniki: .tmp/webgpu/roj/ (poza repo).
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const mode = args.tryb || 'test';
const W = Number(args.w || 1920);
const H = Number(args.h || 1080);
const out = resolve(repo, args.out || '.tmp/webgpu/roj');
const only = args.tylko ? String(args.tylko).split(',') : null;

const { server, base } = await startVite(Number(args.port || 5410));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
let failed = false;
const report = { mode, runs: [] };

const panelErrors = () => evaluate(cdp, 'document.getElementById("err")?.textContent || ""');
const stats = async () => JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__demo.stats())'));
async function steps(js, frames = 4, dt = 1 / 60) {
  await evaluate(cdp, `(async () => { ${js}; await window.__demo.step(${frames}, ${dt}); return true; })()`, 600000);
}
async function shot(name, js, frames = 4) {
  if (only && !only.some((o) => name.includes(o))) return;
  await steps(js, frames);
  await sleep(150);
  const f = join(out, `${name}.png`);
  await screenshotPng(cdp, f);
  const st = await stats();
  report.runs.push({ shot: name, file: f, ...st });
  console.log('zrzut', name, `drony ${st.drones} · kontenery ${st.containers} · ${st.done ?? '-'} / ${st.total ?? '-'} · draw ${st.drawCalls}`);
  const e = await panelErrors();
  if (e) { console.log(`BŁĄD dema przy ${name}:\n${e.slice(0, 2000)}`); failed = true; }
}

try {
  const realtime = mode === 'wydajnosc';
  await cdp.send('Page.navigate', { url: `${base}/dema/roj-webgpu.html?${realtime ? '' : 'test=1&'}dpr=1` });
  if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || window.__demo.error)', 120000)) throw new Error('demo nie wstało (timeout)');
  const ready = await evaluate(cdp, 'window.__demo.ready === true');
  if (!ready) throw new Error(`demo nie wstało: ${await evaluate(cdp, 'JSON.stringify(window.__demo)')} ${await panelErrors()}`);

  if (mode === 'wydajnosc') {
    const cases = [['galeria', ''], ['wymiana', ''], ['port', ''], ['roj', ''], ['mega', '']];
    for (const [sc] of cases) {
      await evaluate(cdp, `window.__demo.scene(${JSON.stringify(sc)}); window.__demo.speed(2); true`);
      await sleep(9000);
      const st = await stats();
      report.runs.push({ scene: sc, ...st });
      console.log(`${sc.padEnd(11)} FPS ${st.fps.toFixed(0).padStart(4)} · CPU ${st.cpuMs.toFixed(2)} ms · GPU ${st.gpuMs.toFixed(2)} ms · compute ${st.gpuComputeMs?.toFixed?.(2) ?? '—'} ms · draw ${st.drawCalls} · drony ${st.drones} · ${st.done ?? '-'} / ${st.total ?? '-'}`);
    }
    throw null;
  }

  // Rozgrzewka: pierwsze klatki budują potoki.
  await steps('window.__demo.scene("galeria")', 8);

  if (mode === 'test') {
    for (const sc of ['galeria', 'atlas', 'wymiana', 'przeladunek', 'mega', 'port', 'roj']) {
      await steps(`window.__demo.scene(${JSON.stringify(sc)}); window.__demo.speed(2)`, 240);
      const st = await stats();
      report.runs.push({ scene: sc, ...st });
      console.log(`${sc.padEnd(11)} drony ${String(st.drones).padStart(5)} · w locie ${String((st.drones ?? 0) - (st.parked ?? 0)).padStart(5)} · ${st.done ?? '-'} / ${st.total ?? '-'} · wolny ${st.free ?? '-'} · tor ${st.guided ?? '-'} · ` +
        `najbliżej ${st.metrics?.minSep?.toFixed?.(2) ?? '-'} · draw ${st.drawCalls} · CPU ${st.cpuMs.toFixed(2)} ms`);
      const e = await panelErrors();
      if (e) { console.log(`BŁĄD dema przy ${sc}:\n${e.slice(0, 3000)}`); failed = true; break; }
    }
  } else if (mode === 'metryki') {
    const scenes = args.sceny ? String(args.sceny).split(',') : ['atlas', 'wymiana', 'przeladunek', 'mega', 'port', 'roj'];
    const towers = args.wieza ? String(args.wieza).split(',') : ['smart', 'naive'];
    const limit = Number(args.limit || 900);
    for (const sc of scenes) {
      for (const tw of towers) {
        await evaluate(cdp, `window.__demo.scene(${JSON.stringify(sc)}, { mode: ${JSON.stringify(tw)} }); window.__demo.speed(4); true`);
        // --tune klucz=wartość,… — strojenie symulacji (SWARM_SIM_TUNE) na czas przebiegu.
        if (args.tune) await evaluate(cdp, `(() => { for (const kv of ${JSON.stringify(String(args.tune))}.split(',')) { const [k, v] = kv.split('='); window.__demo.sim.setTune(k, Number(v)); } return true; })()`);
        let st = null;
        const t0 = Date.now();
        for (;;) {
          await steps('', 240);
          st = await stats();
          if (st.doneAt !== null && st.doneAt !== undefined) break;
          if (st.simTime > limit) break;
          if (st.metrics?.stall > Number(args.zastoj || 60)) break;
        }
        const r = {
          scene: sc, mode: tw, done: st.done, total: st.total, time: (st.endTime ?? st.simTime) - (st.startTime ?? 0),
          emptyShare: st.emptyShare, maxTrim: st.maxTrim, direct: st.direct, minSep: st.metrics?.minSep, nearMax: st.metrics?.nearMax,
          nearSum: st.metrics?.nearSum, deepSum: st.metrics?.deepSum, stall: st.metrics?.stall, overflow: st.metrics?.overflowMax, wallS: (Date.now() - t0) / 1000,
          minGap: st.metrics?.minGap, collisionSum: st.metrics?.collisionSum, collisionFrames: st.metrics?.collisionFrames, collisionMax: st.metrics?.collisionMax
        };
        report.runs.push(r);
        console.log(`${sc.padEnd(11)} ${tw.padEnd(5)} ${st.done}/${st.total} w ${r.time.toFixed(1)} s · puste ${(r.emptyShare * 100).toFixed(1)}% · wyważenie max ${(r.maxTrim * 100).toFixed(1)}% · ` +
          `statek→statek ${r.direct} · ZDERZENIA Σ ${r.collisionSum} (klatek ${r.collisionFrames}, max ${r.collisionMax}) · najmniejsza przerwa ${r.minGap?.toFixed?.(1)} j. · ` +
          `okręgi: ${r.minSep?.toFixed?.(2)} × obrysu, naruszeń Σ ${r.nearSum} · zastój ${r.stall?.toFixed?.(0)} s · przepełnienie siatki ${r.overflow} · ${r.wallS.toFixed(0)} s`);
        // Najgorsze pary: histogram (faza i, faza j, ładunek, klasy) — gdzie unikanie zawodzi.
        const worst = st.metrics?.worst || [];
        if (worst.length) {
          const PH = ['PARK', 'START', 'DO_ŹR', 'WYR_Ź', 'ZEJ_Ź', 'CHWYT', 'WZN_Ź', 'DO_CEL', 'WYR_C', 'ZEJ_C', 'ODŁÓŻ', 'WZN_C', 'POWRÓT', 'LĄD'];
          const hist = new Map();
          for (const w of worst) {
            const k = `${PH[w.pi] || w.pi}${w.li ? '+' : ''} × ${PH[w.pj] || w.pj}${w.lj ? '+' : ''} (kl ${w.ci}/${w.cj})`;
            const h = hist.get(k) || { n: 0, min: 9 };
            h.n++; h.min = Math.min(h.min, w.r);
            hist.set(k, h);
          }
          const top = [...hist.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
          console.log('   najbliższe pary (faza drona × faza sąsiada, + = z ładunkiem; przerwa w j., < 0 = nakładanie):');
          for (const [k, h] of top) console.log(`     ${String(h.n).padStart(4)} × ${k}  min ${h.min.toFixed(2)}`);
          r.worst = top.map(([k, h]) => ({ pair: k, ...h }));
        }
        const e = await panelErrors();
        if (e) { console.log(`BŁĄD dema przy ${sc}:\n${e.slice(0, 3000)}`); failed = true; }
        if (st.done < st.total) {
          failed = true;
          // Zastój: aktywne drony (faza, zadanie, kolumny, wysokości i zamki) — do diagnozy.
          const dump = JSON.parse(await evaluate(cdp, `(async () => {
            const d = window.__demo; const sim = d.sim; const r = d.renderer;
            const D = new Float32Array(await r.getArrayBufferAsync(sim.drones.value));
            const T = new Float32Array(await r.getArrayBufferAsync(sim.tasks.value));
            const C = new Uint32Array(await r.getArrayBufferAsync(sim.cols.value));
            const P = d.S.scene.planner; const out = [];
            for (let i = 0; i < sim.count; i++) {
              const o = i * 44; const ph = D[o + 12]; if (ph === 0) continue;
              const ser = D[o + 14] % 2; const q = (i * 2 + ser) * 32; const pc = T[q + 14] | 0; const dc = T[q + 15] | 0;
              out.push({ i, ph, t: +D[o + 13].toFixed(1), p: [D[o], D[o + 1], D[o + 2]].map((v) => +v.toFixed(1)), v: [D[o + 4], D[o + 5], D[o + 6]].map((v) => +v.toFixed(1)),
                yaw: +D[o + 3].toFixed(2), slotYaw: [+T[q + 3].toFixed(2), +T[q + 7].toFixed(2)], aux: [D[o + 40], D[o + 41], +D[o + 42].toFixed(2), D[o + 43]], leg: [D[o + 36], D[o + 37], D[o + 38], D[o + 39]].map((v) => +v.toFixed(0)),
                ser: D[o + 14], task: T[q + 13], cols: [pc, dc], lev: [T[q + 16], T[q + 17]], h: [C[pc * 2], C[dc * 2]], lock: [C[pc * 2 + 1], C[dc * 2 + 1]],
                entry: [+T[q + 8].toFixed(1), +T[q + 9].toFixed(1)], band: [+T[q + 20].toFixed(1), +T[q + 21].toFixed(1)], counts: [P.counts[pc], P.counts[dc]], n: T[q + 12] });
            }
            const locks = []; for (let c = 0; c < C.length / 2; c++) if (C[c * 2 + 1]) locks.push([c, C[c * 2 + 1]]);
            return JSON.stringify({ out, locks });
          })()`, 120000));
          console.log(`   ZASTÓJ — aktywne drony (${dump.out.length}), zamki ${JSON.stringify(dump.locks)}:`);
          for (const q of dump.out.slice(0, 24)) console.log(`     ${JSON.stringify(q)}`);
          r.stallDump = dump;
        }
      }
    }
  } else {
    // Zrzuty: widoki, które da się wyklikać (przyciski scen, F, C, T, kółko).
    await shot('01-galeria', 'window.__demo.scene("galeria"); window.__demo.speed(1)', 150);
    await shot('02-galeria-chwyt', 'window.__demo.scene("galeria"); window.__demo.speed(1)', 200);
    await shot('03-galeria-z-gory', 'window.__demo.scene("galeria"); window.__demo.tilt(0, 0); window.__demo.frame()', 190);
    for (const k of [0, 2, 3]) await shot(`04-galeria-zblizenie-${k}`, `window.__demo.scene("galeria"); window.__demo.tilt(50, -30); window.__demo.focusItem(${k})`, 200);
    await evaluate(cdp, 'window.__demo.tilt(0, 0); true');
    for (const [name, sc, secs, speed] of [['10-atlas', 'atlas', 20, 2], ['11-wymiana', 'wymiana', 30, 4], ['12-przeladunek', 'przeladunek', 30, 4],
      ['13-mega', 'mega', 40, 4], ['14-port', 'port', 40, 4], ['15-roj', 'roj', 25, 4]]) {
      if (only && !only.some((o) => name.includes(o))) continue;
      await evaluate(cdp, `window.__demo.scene(${JSON.stringify(sc)}); true`);
      await evaluate(cdp, `window.__demo.run(${secs}, ${speed})`, 600000);
      await shot(name, 'window.__demo.speed(1)', 2);
      await shot(`${name}-kino`, 'window.__demo.tilt(48, -20)', 3);
      await evaluate(cdp, 'window.__demo.tilt(0, 0); true');
    }
    // Zbliżenia (ładownia frachtowca w trakcie wymiany, rój w krzyżowaniu strumieni).
    if (!only || only.some((o) => 'zblizenia'.includes(o) || o === 'zblizenia')) {
      await evaluate(cdp, 'window.__demo.scene("wymiana"); true');
      await evaluate(cdp, 'window.__demo.run(40, 4)', 600000);
      await shot('20-wymiana-ladownia', 'window.__demo.speed(1); window.__demo.lookAt(-130, 700, 2.4)', 2);
      await shot('21-wymiana-plac', 'window.__demo.lookAt(-80, 40, 2.6)', 2);
      await shot('22-wymiana-kino-blisko', 'window.__demo.lookAt(-100, 420, 1.6); window.__demo.tilt(55, -25)', 3);
      await evaluate(cdp, 'window.__demo.tilt(0, 0); true');
      await evaluate(cdp, 'window.__demo.scene("roj"); true');
      await evaluate(cdp, 'window.__demo.run(30, 4)', 600000);
      await shot('23-roj-srodek', 'window.__demo.speed(1); window.__demo.lookAt(0, 0, 1.2)', 2);
      await shot('24-roj-kino', 'window.__demo.lookAt(0, 0, 0.6); window.__demo.tilt(58, -30)', 3);
      await evaluate(cdp, 'window.__demo.tilt(0, 0); true');
    }
  }
} catch (err) {
  if (err !== null) {
    console.log(String(err.stack || err));
    failed = true;
  }
} finally {
  const errs = logs.errors().filter((l) => !/TimestampQueryPool/.test(l));
  report.errors = errs;
  console.log(`błędy konsoli / WebGPU: ${errs.length}`);
  for (const e of errs.slice(0, 30)) console.log('  ', e.slice(0, 1500));
  writeJson(join(out, `${mode}.json`), report);
  await chrome.close();
  await server.close();
}
process.exit(failed || report.errors?.length ? 1 : 0);
