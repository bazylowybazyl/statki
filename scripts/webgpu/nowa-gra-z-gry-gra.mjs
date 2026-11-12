// „Nowa gra” z menu pauzy w PRAWDZIWEJ grze (blok „NOWA GRA W TRAKCIE GRY” w index.html): gra swobodna → Esc (menu
// pauzy) → „Nowa gra” → Start: Kampania → „Jeden gracz” → strona przeładowuje się i sama startuje kampanię. Sprawdza
// też, że znacznik przeładowania działa raz (zwykłe F5 po nim zostaje w menu).
//
//   node scripts/webgpu/nowa-gra-z-gry-gra.mjs [--port 5372] [--out .tmp/nowa-gra-z-gry] [--query renderWorker=1]
//
// Wynik: <out>/wynik.json i zrzut po starcie kampanii; kod wyjścia 1, gdy coś się nie zgadza.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, repo, sleep } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5372);
const outDir = resolve(repo, args.out || '.tmp/nowa-gra-z-gry');
mkdirSync(outDir, { recursive: true });
const extraQuery = args.query ? `?${args.query}` : '';

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;

const chrome = await startChrome({ width: 1280, height: 720 });
const { cdp } = chrome;
const logs = await attachLogs(chrome);
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const result = { ok: true, kroki: [], bledy: [] };
const check = (name, cond, detail) => {
  result.kroki.push({ name, ok: !!cond, detail });
  if (!cond) result.ok = false;
  console.log(`${cond ? 'OK ' : 'ŹLE'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
};
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
};

// Menu gotowe na NOWEJ stronie (bez znacznika starej), gra w toku = klatki pętli gry.
const menuReady = '!window.__staraStrona && document.readyState === "complete" && !!window.StoryGame && !!document.getElementById("btn-mode-single")';
const gameRunning = (n) => `(window.__frameId | 0) > ${n}`;
const menuVisible = '!document.getElementById("main-menu").classList.contains("hidden")';
const menuHidden = `!(${menuVisible})`;
const loadingHidden = 'document.getElementById("loading").classList.contains("hidden")';

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html${extraQuery}` });
  await waitFor(cdp, menuReady, 180000);
  // 1. Gra swobodna z menu.
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]').click(); document.getElementById('btn-mode-single').click(); return true; })()`);
  await waitFor(cdp, gameRunning(30), 240000);
  check('gra swobodna ruszyła', await ev('!window.StoryGame.active'));

  // 2. Menu pauzy (Esc) → „Nowa gra” → Kampania → „Jeden gracz”.
  await ev('window.__staraStrona = 1');
  await key('Escape', 'Escape', 27);
  check('Esc otwiera menu pauzy', await waitFor(cdp, menuVisible, 10000));
  await ev(`(() => { document.getElementById('btn-new-game').click(); return true; })()`);
  await sleep(300);
  check('panel trybu gry', await ev('document.getElementById("menu-gamemode-view").classList.contains("active")'));
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]').click(); document.getElementById('btn-mode-single').click(); return true; })()`);

  // 3. Przeładowanie i samoczynny start kampanii.
  check('strona przeładowana', await waitFor(cdp, menuReady, 180000));
  check('znacznik zdjęty po odczycie', await ev('sessionStorage.getItem("hullfall.newGameRelaunch") === null'));
  // kampania stoi w odprawie (świat zamrożony — licznik klatek gry nie rośnie): start = fabuła aktywna, menu i ekran
  // ładowania schowane
  check('kampania wystartowała sama', await waitFor(cdp, `window.StoryGame.active && ${menuHidden} && ${loadingHidden}`, 300000));
  const st = await ev('({ faza: window.StoryGame.phase, kampania: localStorage.getItem("sc_story_campaign") })');
  check('kampania od początku', st.kampania === '1', st);
  await sleep(1500);
  await screenshotPng(cdp, join(outDir, 'kampania-po-nowej-grze.png'));

  // 4. Zwykłe F5 po tym zostaje w menu (znacznik działa raz).
  await ev('window.__staraStrona = 1');
  await cdp.send('Page.reload', {});
  await waitFor(cdp, menuReady, 180000);
  await sleep(4000);
  check('F5 po nowej grze — menu, bez startu', await ev(`!window.StoryGame.active && !window.__startSteps && ${menuVisible}`),
    await ev('({ start: !!window.__startSteps, story: !!window.StoryGame.active })'));
} catch (err) {
  result.ok = false;
  result.bledy.push(String(err?.stack || err));
  console.error(err);
} finally {
  result.logi = logs.errors().slice(0, 40);
  writeJson(join(outDir, 'wynik.json'), result);
  console.log(result.ok ? 'WYNIK: OK' : 'WYNIK: BŁĄD', '—', join(outDir, 'wynik.json'));
  await chrome.close();
  await server.close();
  process.exit(result.ok ? 0 : 1);
}
