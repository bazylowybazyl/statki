// Narzędzie dema broni WebGPU (dema/bronie-webgpu.html): Vite + headless Chrome na prawdziwym GPU.
//
//   node scripts/webgpu/bronie-demo.mjs --tryb test [--gniazda all] [--czekaj 2500]
//        każda broń po kolei; błędy konsoli, walidacji WebGPU i panelu błędów dema, statystyki
//   node scripts/webgpu/bronie-demo.mjs --tryb zrzuty --bronie railgun_mk1,armata_mk1 --ujecia muzzle:0.03,target:0.9
//        zrzuty zsynchronizowane ze strzałem: kam:opóźnienie [s czasu symulacji]; „p0.01” = od sekwencji
//        przed strzałem (cewki Tempesta); kamery: auto, muzzle, target, follow
//   node scripts/webgpu/bronie-demo.mjs --tryb wydajnosc --bronie vulcan_minigun,flak_capital --gniazda all
//
// Opcje: --gniazda one|pair|all, --tempo 0.3, --w 1920 --h 1080, --rozgrzewka 1200 [ms], --out katalog.
// Wyniki: .tmp/bronie-webgpu/<tryb>/ (poza repo, patrz .gitignore).
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const mode = args.tryb || 'test';
const W = Number(args.w || 1920);
const H = Number(args.h || 1080);
const out = resolve(repo, args.out || `.tmp/bronie-webgpu/${mode}`);
const warm = Number(args.rozgrzewka || 1200);

const { server, base } = await startVite(Number(args.port || 5396));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
let failed = false;
const report = { mode, weapons: [] };
try {
  let list = String(args.bronie || 'all').split(',');
  const q = new URLSearchParams({ pokaz: '0', bron: list[0] === 'all' ? 'railgun_mk1' : list[0], tempo: String(args.tempo || 1) });
  if (args.gniazda) q.set('gniazda', args.gniazda);
  await cdp.send('Page.navigate', { url: `${base}/dema/bronie-webgpu.html?${q}` });
  if (!await waitFor(cdp, 'window.__demo && window.__demo.S.ready', 90000)) {
    throw new Error(`demo nie wstało: ${await evaluate(cdp, 'document.getElementById("errors")?.textContent || document.getElementById("loading")?.textContent').catch((e) => e.message)}`);
  }
  if (list[0] === 'all') list = await evaluate(cdp, 'window.__demo.weapons()');
  const panelErrors = () => evaluate(cdp, 'document.getElementById("errors")?.textContent || ""');

  for (const id of list) {
    await evaluate(cdp, `window.__demo.resume(); window.__demo.select(${JSON.stringify(id)}); true`);
    if (mode === 'zrzuty') {
      const shots = String(args.ujecia || 'muzzle:0.03,target:0.9').split(',').map((s) => {
        const [kam, d = '0.05'] = s.split(':');
        const pre = d.startsWith('p');
        return { kam, pre, d: Number(pre ? d.slice(1) : d), tag: d.replace('.', '_') };
      });
      for (const s of shots) {
        await evaluate(cdp, `window.__demo.setCam(${JSON.stringify(s.kam)}); window.__demo.resume(); true`);
        await sleep(warm);
        const ok = await evaluate(cdp, `window.__demo.${s.pre ? 'waitPre' : 'waitShot'}(${s.d}, 30000)`, 60000);
        await sleep(150);
        const f = join(out, `${id}_${s.kam}_${s.tag}.png`);
        await screenshotPng(cdp, f);
        console.log(ok ? 'ok  ' : 'brak strzału  ', f);
      }
      await evaluate(cdp, 'window.__demo.resume(); true');
    } else {
      await sleep(Number(args.czekaj || (mode === 'wydajnosc' ? 5000 : 2500)));
      const st = JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__demo.stats())'));
      const rates = Object.fromEntries(Object.entries(st.rates).map(([k, v]) => [k, Math.round(v)]));
      report.weapons.push({ id, ...st, rates });
      console.log(id.padEnd(28), `FPS ${st.fps} · CPU ${st.cpuMs} ms · GPU ${st.gpuRenderMs}+${st.gpuComputeMs} ms · draw ${st.drawCalls} · światła ${st.lights} · pociski ${st.projectiles}`, JSON.stringify(rates));
    }
    const e = await panelErrors();
    if (e) { console.log(`BŁĄD przy ${id}:\n${e.slice(0, 2000)}`); failed = true; break; }
  }
} catch (err) {
  console.log(String(err.stack || err));
  failed = true;
} finally {
  // Ostrzeżenie o puli zapytań czasu GPU to warnOnce przy nielimitowanym FPS headless — nie błąd dema.
  const errs = logs.errors().filter((l) => !/TimestampQueryPool/.test(l));
  report.errors = errs;
  console.log(`błędy konsoli / WebGPU: ${errs.length}`);
  for (const e of errs.slice(0, 30)) console.log('  ', e.slice(0, 1200));
  if (mode !== 'zrzuty') writeJson(join(out, 'wyniki.json'), report);
  await chrome.close();
  await server.close();
}
process.exit(failed || report.errors?.length ? 1 : 0);
