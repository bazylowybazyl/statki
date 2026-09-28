// Narzędzie dema ładowni WebGPU (dema/ladownia-webgpu.html): Vite + headless Chrome na prawdziwym GPU.
//
//   node scripts/webgpu/ladownia-demo.mjs --tryb test
//        każda scena po kolei (galeria, wrota, załadunek, rozładunek) na kilku kadłubach; błędy konsoli,
//        walidacji WebGPU / WGSL i panelu błędów dema, statystyki
//   node scripts/webgpu/ladownia-demo.mjs --tryb zrzuty [--out katalog] [--tylko galeria,wrota]
//        zrzuty scen tym samym widokiem, który da się wyklikać w demie (przyciski scen, kadłuby, F — kadr)
//   node scripts/webgpu/ladownia-demo.mjs --tryb wydajnosc
//        czas rzeczywisty (pętla rAF bez vsync): FPS, CPU klatki, GPU (znaczniki czasu), draw calle na scenę
//
// Opcje: --w 1920 --h 1080, --port 5402. Wyniki: .tmp/webgpu/zadania/26/ (poza repo, .gitignore).
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const mode = args.tryb || 'test';
const W = Number(args.w || 1920);
const H = Number(args.h || 1080);
const out = resolve(repo, args.out || '.tmp/webgpu/zadania/26');
const only = args.tylko ? String(args.tylko).split(',') : null;

const { server, base } = await startVite(Number(args.port || 5402));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
let failed = false;
const report = { mode, runs: [] };

const panelErrors = () => evaluate(cdp, 'document.getElementById("err")?.textContent || ""');
// Klatki przez step (test=1): scena i czas ustawione, n klatek, potem zrzut.
async function show(js, frames = 4) {
  await evaluate(cdp, `(async () => { ${js}; await window.__demo.step(${frames}); return true; })()`, 120000);
}
async function shot(name, js, frames = 4) {
  if (only && !only.some((o) => name.includes(o))) return;
  await show(js, frames);
  await sleep(120);
  const f = join(out, `${name}.png`);
  await screenshotPng(cdp, f);
  const st = JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__demo.stats())'));
  report.runs.push({ shot: name, file: f, ...st });
  console.log('zrzut', name, `kontenery ${st.containers ?? 0} · drony ${st.drones ?? 0} · draw ${st.drawCalls}`);
  const e = await panelErrors();
  if (e) { console.log(`BŁĄD dema przy ${name}:\n${e.slice(0, 2000)}`); failed = true; }
}

try {
  const realtime = mode === 'wydajnosc';
  await cdp.send('Page.navigate', { url: `${base}/dema/ladownia-webgpu.html?${realtime ? '' : 'test=1&'}dpr=1` });
  if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || window.__demo.error)', 120000)) {
    throw new Error('demo nie wstało (timeout)');
  }
  const ready = await evaluate(cdp, 'window.__demo.ready === true');
  if (!ready) throw new Error(`demo nie wstało: ${await evaluate(cdp, 'JSON.stringify(window.__demo)')} ${await panelErrors()}`);
  if (realtime) {
    // Czas rzeczywisty (pętla rAF, bez vsync w headless): średnie z panelu po 3 s na scenę.
    const cases = [['galeria', 'atlas', 'frame()'], ['galeria', 'atlas', 'focus("atlas")'], ['otwieranie', 'atlas', ''],
      ['zaladunek', 'atlas', ''], ['rozladunek', 'atlas', ''], ['zaladunek', 'heavy_freighter', ''], ['otwieranie', 'megafreighter_wagon', '']];
    for (const [scene, hull, cam] of cases) {
      await evaluate(cdp, `window.__demo.scene(${JSON.stringify(scene)}, ${JSON.stringify(hull)}); window.__demo.setTime(20); ${cam ? `window.__demo.${cam};` : ''} true`);
      await sleep(3500);
      const st = JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__demo.stats())'));
      report.runs.push({ scene, hull, cam, ...st });
      console.log(`${scene.padEnd(11)} ${hull.padEnd(20)} ${cam.padEnd(16)} FPS ${st.fps.toFixed(0).padStart(4)} · CPU ${st.cpuMs.toFixed(2)} ms · GPU ${st.gpuMs.toFixed(2)} ms · draw ${st.drawCalls} · kontenery ${st.containers} · drony ${st.drones ?? 0}`);
    }
    throw null;
  }
  // Rozgrzewka: pierwsze klatki budują potoki.
  await show('window.__demo.scene("galeria", "atlas")', 6);

  if (mode === 'test') {
    const cases = [
      ['galeria', 'atlas', 0], ['otwieranie', 'atlas', 4], ['otwieranie', 'terran_carrier', 4], ['otwieranie', 'pirate_battleship', 3],
      ['zaladunek', 'atlas', 30], ['rozladunek', 'atlas', 30], ['zaladunek', 'heavy_freighter', 30], ['zaladunek', 'terran_frigate', 10],
      ['rozladunek', 'megafreighter_wagon', 30]
    ];
    for (const [scene, hull, t] of cases) {
      await show(`window.__demo.scene(${JSON.stringify(scene)}, ${JSON.stringify(hull)}); window.__demo.setTime(${t})`, 6);
      const st = JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__demo.stats())'));
      report.runs.push({ scene, hull, t, ...st });
      console.log(`${scene.padEnd(11)} ${hull.padEnd(22)} t=${String(t).padStart(3)} kontenery ${st.containers} drony ${st.drones ?? 0} ` +
        `światła ${st.lights} cienie ${st.shadows} draw ${st.drawCalls} CPU ${st.cpuMs.toFixed(2)} ms`);
      const e = await panelErrors();
      if (e) { console.log(`BŁĄD dema przy ${scene}/${hull}:\n${e.slice(0, 3000)}`); failed = true; break; }
    }
  } else {
    // 1. Galeria: całość i zbliżenia (jak klik kadłuba w panelu).
    await shot('01-galeria-calosc', 'window.__demo.scene("galeria", "atlas"); window.__demo.frame()', 5);
    await shot('02-galeria-atlas', 'window.__demo.scene("galeria", "atlas")', 5);
    await shot('03-galeria-atlas-blisko', 'window.__demo.scene("galeria", "atlas"); window.__demo.focus("atlas", 2.6)', 5);
    for (const id of ['terran_carrier', 'terran_supercapital', 'pirate_battleship', 'heavy_freighter', 'terran_battleship', 'container_ship']) {
      await shot(`04-galeria-${id}`, `window.__demo.scene("galeria", ${JSON.stringify(id)})`, 5);
    }
    await shot('05-galeria-kino', 'window.__demo.scene("galeria", "atlas"); window.__demo.focus("atlas", 1.6); window.__demo.tilt(42, -20)', 5);
    await evaluate(cdp, 'window.__demo.tilt(0, 0); true');
    // 2. Sekwencja otwierania Atlasa: klatki na osi przebiegu wrót (setTime w pętli sceny).
    const T = await evaluate(cdp, '(() => { window.__demo.scene("otwieranie", "atlas"); return window.__demo.S.scene.T; })()');
    const t0 = 1.2;
    const seq = [0, 0.14, 0.3, 0.45, 0.62, 0.8, 1.0].map((f) => t0 + f * T);
    for (let i = 0; i < seq.length; i++) {
      await shot(`10-wrota-atlas-${i}`, `window.__demo.scene("otwieranie", "atlas"); window.__demo.pause(true); window.__demo.setTime(${seq[i].toFixed(3)})`, 3);
    }
    await shot('11-wrota-atlas-kino', `window.__demo.scene("otwieranie", "atlas"); window.__demo.pause(true); window.__demo.setTime(${(t0 + 0.55 * T).toFixed(3)}); window.__demo.tilt(40, -15)`, 3);
    await evaluate(cdp, 'window.__demo.tilt(0, 0); true');
    // Kieszeń (pocket): lotniskowiec (dwa pokłady) i luk IRON SKULL — w połowie przejazdu i po otwarciu.
    for (const [hull, tag] of [['terran_carrier', 'citadella'], ['pirate_battleship', 'iron-skull'], ['container_ship', 'kontenerowiec']]) {
      for (const f of [0.62, 1.0]) {
        await shot(`12-wrota-${tag}-${Math.round(f * 100)}`,
          `window.__demo.scene("otwieranie", ${JSON.stringify(hull)}); window.__demo.pause(true); window.__demo.setTime(1.2 + window.__demo.S.scene.T * ${f})`, 3);
      }
    }
    // 3. Załadunek i rozładunek (Atlas): środek przeładunku, drony w locie i w ładowni.
    for (const [name, sc, tt] of [['20-zaladunek-start', 'zaladunek', 12], ['21-zaladunek-srodek', 'zaladunek', 40], ['22-zaladunek-koniec', 'zaladunek', 78],
      ['30-rozladunek-srodek', 'rozladunek', 34], ['31-rozladunek-pozno', 'rozladunek', 62]]) {
      await shot(name, `window.__demo.scene(${JSON.stringify(sc)}, "atlas"); window.__demo.pause(true); window.__demo.setTime(${tt})`, 3);
    }
    await shot('23-zaladunek-blisko', 'window.__demo.scene("zaladunek", "atlas"); window.__demo.pause(true); window.__demo.setTime(40); window.__demo.lookAt(31, -60, 2.2)', 3);
    await shot('24-zaladunek-kino', 'window.__demo.scene("zaladunek", "atlas"); window.__demo.pause(true); window.__demo.setTime(44); window.__demo.lookAt(31, -140, 0.9); window.__demo.tilt(45, -10)', 3);
    await evaluate(cdp, 'window.__demo.tilt(0, 0); true');
    await shot('25-zaladunek-frachtowiec', 'window.__demo.scene("zaladunek", "heavy_freighter"); window.__demo.pause(true); window.__demo.setTime(45)', 3);
  }
} catch (err) {
  // throw null — koniec trybu wydajności (bez błędu).
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
