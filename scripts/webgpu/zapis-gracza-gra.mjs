// Zapis gracza w PRAWDZIWEJ grze (src/game/playerSave.js, blok „ZAPIS GRACZA” w index.html): nowa gra swobodna →
// zmiana kredytów, ładowni, doświadczenia i miejsca Atlasa → zapis (window.PlayerSave.write) → przeładowanie strony →
// „Wczytaj” w menu → porównanie stanu. Sprawdza też, że ziarno świata (układ planet) przeżywa przeładowanie, przycisk
// „Wczytaj” jest wyłączony bez zapisu i włączony z zapisem, a „Nowa gra” kasuje zapis.
//
//   node scripts/webgpu/zapis-gracza-gra.mjs [--port 5371] [--out .tmp/zapis-gracza] [--query renderWorker=1]
//
// Wynik: <out>/wynik.json i zrzut po wczytaniu; kod wyjścia 1, gdy coś się nie zgadza.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5371);
const outDir = resolve(repo, args.out || '.tmp/zapis-gracza');
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

// Gra swobodna (bez kampanii) — zapis pozycji dotyczy gry swobodnej; kampania wznawia od początku misji.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('sc_story_campaign', '0'); } catch (e) {}" });

const menuReady = '!!window.PlayerSave && !!document.getElementById("btn-mode-single") && !!document.getElementById("btn-load-game")';
const gameRunning = (n) => `(window.__frameId | 0) > ${n}`;

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html${extraQuery}` });
  await waitFor(cdp, menuReady, 180000);
  const seed1 = await ev('window.WORLD_SEED');
  check('bez zapisu „Wczytaj” wyłączony', await ev('document.getElementById("btn-load-game").disabled === true'));

  await ev('document.getElementById("btn-mode-single").click()');
  await waitFor(cdp, gameRunning(30), 240000);
  check('nowa gra: zapis gracza pusty (Nowa gra kasuje)', await ev('localStorage.getItem("game") === null'));

  // Stan do zapisu: kredyty, ładownia, EXP, miejsce 3 tys. j. od startu, kurs.
  const want = await ev(`(() => {
    const s = window.ship;
    s.pos.x += 2500; s.pos.y -= 1500; s.vel.x = 0; s.vel.y = 0; s.angle = 1.25;
    return window.PlayerSave.set({ credits: 98765, cargo: { steel: 7, ice: 3.5 }, exp: 1600 });
  })()`);
  const f0 = await ev('window.__frameId | 0');
  await waitFor(cdp, gameRunning(f0 + 20), 60000);
  const saved = await ev('(() => { window.PlayerSave.write(); return JSON.parse(localStorage.getItem("game")); })()');
  check('zapis: kredyty, ładownia, EXP', saved?.player?.credits === 98765 && saved.player.cargo.steel === 7 && saved.player.progress.exp === 1600, saved?.player);
  check('zapis: ziarno świata i układ', saved?.worldSeed === seed1 && saved?.systemId === 'sol', { seed: saved?.worldSeed, seed1, systemId: saved?.systemId });
  const placed = await ev('window.PlayerSave.player()');

  // Przeładowanie strony (beforeunload też zapisuje) → menu → „Wczytaj”.
  await cdp.send('Page.reload', { ignoreCache: false });
  await waitFor(cdp, menuReady, 180000);
  const seed2 = await ev('window.WORLD_SEED');
  check('ziarno świata przeżywa F5', seed2 === seed1, { seed1, seed2 });
  const btn = await ev('(() => { const b = document.getElementById("btn-load-game"); return { disabled: b.disabled, hint: b.dataset.hint, tag: b.querySelector(".mm-go, .mm-tag")?.textContent }; })()');
  check('z zapisem „Wczytaj” włączony', btn.disabled === false, btn);

  await ev('document.getElementById("btn-load-game").click()');
  await waitFor(cdp, gameRunning(30), 240000);
  const got = await ev('window.PlayerSave.player()');
  const dist = Math.hypot(got.x - placed.x, got.y - placed.y);
  check('po wczytaniu: kredyty', got.credits === 98765, got.credits);
  check('po wczytaniu: ładownia', got.cargo.steel === 7 && got.cargo.ice === 3.5, got.cargo);
  check('po wczytaniu: EXP', got.exp === 1600, got.exp);
  check('po wczytaniu: miejsce (< 200 j. od zapisanego)', dist < 200, { dist: Math.round(dist), got: [Math.round(got.x), Math.round(got.y)], placed: [Math.round(placed.x), Math.round(placed.y)] });
  check('po wczytaniu: kurs', Math.abs(got.angle - want.angle) < 0.05 || Math.abs(got.angle - 1.25) < 0.05, got.angle);
  check('po wczytaniu: zapis nie skasowany', await ev('localStorage.getItem("game") !== null'));
  await screenshotPng(cdp, join(outDir, 'po-wczytaniu.png'));
} catch (err) {
  result.ok = false;
  result.wyjatek = String(err?.stack || err);
  console.error(err);
} finally {
  result.bledy = logs.errors().slice(0, 30);
  writeJson(join(outDir, 'wynik.json'), result);
  console.log(result.ok ? 'WYNIK: OK' : 'WYNIK: BŁĘDY', '—', join(outDir, 'wynik.json'));
  if (result.bledy.length) console.log('błędy strony:', result.bledy.slice(0, 8));
  await chrome.close();
  await server.close();
  process.exitCode = result.ok ? 0 : 1;
}
