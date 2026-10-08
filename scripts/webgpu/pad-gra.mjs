// Sterowanie padem w PRAWDZIWEJ grze (docs/PLAN-pad.md § 6, etap 1 — warstwa wejścia src/input/).
// Vite + headless Chrome z WebGPU (CDP); pad = atrapa (scripts/webgpu/pad-atrapa.js podmienia navigator.getGamepads).
//
//   node scripts/webgpu/pad-gra.mjs [--tryb pad] [--out .tmp/pad-gra] [--rozmiar 1600x900]
//   node scripts/webgpu/pad-gra.mjs --tryb klawiatura [--zpadem] [--out .tmp/pad-gra/klawiatura]
//   node scripts/webgpu/pad-gra.mjs --porownaj A.json,B.json
//
// --tryb pad (domyślnie, czas rzeczywisty): menu padem (A — Nowa gra, A — Jedna osoba; kampania), odprawa w doku
//   (A — dalej, B trzymane — pomiń), panel stanowiska (A — ODDOKUJ), wylot z hali K-7 lewą gałką (pilot P harnessu
//   prowadzi gałkę na punkt za bramą G-01) aż do fazy misji „course”. Po drodze: odczyty navigator.getGamepads na
//   klatkę (ma być 1), Y trzymany = warp ładuje się raz, Menu = pauza i menu, pad nie działa pod menu (Y, B, RT),
//   klawiatura z padem: Shift (dopalacz) i S (wsteczny). Wynik: <out>/*.png, <out>/raport.json.
// --tryb split: podzielony ekran — padem „Podzielony ekran”, przypisanie (A zamykające menu nie przypisuje),
//   klawiatura jako gracz 2, wybór statku padem, w grze: gałka leci graczem 1, W klawiatury — graczem 2.
// --tryb klawiatura (zegar harnessu, deterministycznie): gra swobodna, skrypt klawiszy (lot W/S/A/D/Q/E, Shift,
//   stabilizator, damper, grupy broni, warp, pauza, CIC, flota, skan, szarża …) — co klatkę wejście lotu, ruch statku
//   i stan przełączników. --zpadem: to samo z podłączonym, nieruszanym padem. Ślad: <out>/slad.json.
//   Regresja klawiatury: ślad przed zmianą i po zmianie → --porownaj (ma wyjść „identyczne”).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();

// ------------------------------------------------------------------ porównanie śladów
if (args.porownaj) {
  const [fa, fb] = String(args.porownaj).split(',').map((p) => resolve(repo, p));
  const A = JSON.parse(readFileSync(fa, 'utf8'));
  const B = JSON.parse(readFileSync(fb, 'utf8'));
  const res = compareTraces(A, B);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.identyczne ? 0 : 1);
}

function compareTraces(A, B) {
  const fields = A.pola || [];
  const n = Math.min(A.klatki.length, B.klatki.length);
  const out = { klatkiA: A.klatki.length, klatkiB: B.klatki.length, pierwszaRoznica: null, maksRoznice: {}, stany: [] };
  for (let i = 0; i < n; i++) {
    const a = A.klatki[i];
    const b = B.klatki[i];
    // pole 0 = numer klatki gry: zależy od długości ładowania (inny w każdym przebiegu) — porównujemy resztę
    for (let k = 1; k < fields.length; k++) {
      const va = a[k];
      const vb = b[k];
      if (va === vb) continue;
      const d = (typeof va === 'number' && typeof vb === 'number') ? Math.abs(va - vb) : 1;
      if (!out.pierwszaRoznica) out.pierwszaRoznica = { klatka: i, krok: A.kroki?.[i] ?? null, pole: fields[k], a: va, b: vb };
      out.maksRoznice[fields[k]] = Math.max(out.maksRoznice[fields[k]] || 0, d);
    }
  }
  const sa = A.stany || [];
  const sb = B.stany || [];
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (JSON.stringify(sa[i]) !== JSON.stringify(sb[i])) out.stany.push({ i, a: sa[i], b: sb[i] });
  }
  out.identyczne = !out.pierwszaRoznica && !out.stany.length && A.klatki.length === B.klatki.length && sa.length === sb.length;
  return out;
}

// ------------------------------------------------------------------ wspólne
const tryb = args.tryb || 'pad';
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || (tryb === 'klawiatura' ? `.tmp/pad-gra/klawiatura${args.zpadem ? '-zpadem' : ''}` : '.tmp/pad-gra'));
mkdirSync(out, { recursive: true });
const ATRAPA = readFileSync(join(repo, 'scripts/webgpu/pad-atrapa.js'), 'utf8');

// Klawisze CDP: key, code, kod wirtualny.
const KEY = {
  w: ['w', 'KeyW', 87], s: ['s', 'KeyS', 83], a: ['a', 'KeyA', 65], d: ['d', 'KeyD', 68], q: ['q', 'KeyQ', 81], e: ['e', 'KeyE', 69],
  b: ['b', 'KeyB', 66], c: ['c', 'KeyC', 67], l: ['l', 'KeyL', 76], y: ['y', 'KeyY', 89], v: ['v', 'KeyV', 86], m: ['m', 'KeyM', 77],
  g: ['g', 'KeyG', 71], x: ['x', 'KeyX', 88], k: ['k', 'KeyK', 75], i: ['i', 'KeyI', 73], n: ['n', 'KeyN', 78], f: ['f', 'KeyF', 70],
  t: ['t', 'KeyT', 84], u: ['u', 'KeyU', 85], h: ['h', 'KeyH', 72], r: ['r', 'KeyR', 82], j: ['j', 'KeyJ', 74], o: ['o', 'KeyO', 79],
  1: ['1', 'Digit1', 49], 2: ['2', 'Digit2', 50], 3: ['3', 'Digit3', 51], 4: ['4', 'Digit4', 52], 5: ['5', 'Digit5', 53],
  6: ['6', 'Digit6', 54], 7: ['7', 'Digit7', 55], 8: ['8', 'Digit8', 56], 9: ['9', 'Digit9', 57],
  shift: ['Shift', 'ShiftLeft', 16], ctrl: ['Control', 'ControlLeft', 17], capslock: ['CapsLock', 'CapsLock', 20],
  space: [' ', 'Space', 32], tab: ['Tab', 'Tab', 9], home: ['Home', 'Home', 36], escape: ['Escape', 'Escape', 27],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37], arrowup: ['ArrowUp', 'ArrowUp', 38], arrowright: ['ArrowRight', 'ArrowRight', 39], arrowdown: ['ArrowDown', 'ArrowDown', 40]
};
// Jak pozostałe skrypty gry (celownik-gra, ogien-gra): keyDown / keyUp bez `text`; przy trzymanym Shift
// litera wielka i modyfikator (e.shiftKey), jak z prawdziwej klawiatury.
let shiftHeld = false;
async function key(cdp, type, name) {
  const [k0, code, vk] = KEY[name];
  if (name === 'shift') shiftHeld = type === 'keyDown';
  const k = shiftHeld && k0.length === 1 ? k0.toUpperCase() : k0;
  await cdp.send('Input.dispatchKeyEvent', {
    type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shiftHeld ? 8 : 0
  });
}

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { tryb, bledy: [], kroki: [] };

try {
  if (tryb === 'klawiatura') await runKeyboardTrace();
  else if (tryb === 'split') await runSplitScenario();
  else await runPadScenario();
  if (report.porazki) process.exitCode = 1;
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
  process.exitCode = 1;
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}

// ------------------------------------------------------------------ ślad klawiatury (deterministyczny)
async function runKeyboardTrace() {
  const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
  await osobneLosowanieUuid(cdp);
  // Gra swobodna (kampania jest domyślna i zatrzymuje start w doku) — przed skryptami strony.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {}\n`
      + `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}\n${args.zpadem ? ATRAPA : ''}`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  if (!await waitFor(cdp, 'window.__harness.scene.hullsReady()', 120000, 250)) throw new Error('kadłuby');
  if (args.zpadem) await ev('window.__fakePad.connect()');
  await ev('window.__harness.hold(true)');
  // Rejestrator klatki (po pętli gry w tej samej klatce): wejście lotu, ruch statku, stan napędu.
  const FIELDS = ['klatka', 'thrustX', 'thrustY', 'main', 'retro', 'leftSide', 'rightSide', 'torque', 'x', 'y', 'vx', 'vy', 'kat', 'omega',
    'warp', 'warpCharge', 'boost', 'boostFuel', 'szarza', 'kamX', 'kamY', 'pauza'];
  await ev(`(async () => {
    const { GameState } = await import('/src/game/gameState.js');
    window.__padTrace = [];
    window.__padTraceOn = true;
    const rec = () => {
      if (window.__padTraceOn) {
        const s = window.ship, inp = s.thrusterInput || {}, wp = window.warp, b = GameState.boost, c = window.camera;
        window.__padTrace.push([window.__frameId | 0, s.input.thrustX, s.input.thrustY, inp.main, inp.retro, inp.leftSide, inp.rightSide, inp.torque,
          s.pos.x, s.pos.y, s.vel.x, s.vel.y, s.angle, s.angVel, wp.state, wp.charge, b ? b.state : null, b ? b.fuel : null,
          !!window.ramBurn?.active, c.x, c.y, window.__isGamePaused()]);
      }
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    window.__harness.reseed(0x9ad1);
    return true;
  })()`);
  const stateSig = () => ev(`(() => {
    const fc = window.fireControl, fa = window.flightAssist, m = window.shipModes, d = window.shipDriveState;
    return { damper: !!fa.damper, stab: !!fa.stabilizer, swiatla: !!window.ship.roadLightsOff, wReku: fc.inHand, postawa: fc.posture ?? null,
      tryb: m.current, stance: m.stance, kamera: window.camera.mode, cic: !!window.CICDisplay?.active, pauza: window.__isGamePaused(),
      naped: d.mode ?? null, auto: d.auto ?? null, bieg: d.gear ?? null, warp: window.warp.state, szarza: !!window.ramBurn?.active,
      mask: window.ship.cloak ? window.ship.cloak.state : null };
  })()`);
  const steps = [];
  const stany = [];
  const frames = async (n) => { await ev(`window.__harness.step(${n})`); };
  // Skrypt: [polecenie, argument]. down / up — klawisz, tap — down+up, f — klatki, s — zapis stanu przełączników.
  const SCRIPT = [
    ['f', 10],
    ['down', 'w'], ['f', 90], ['up', 'w'], ['f', 30],
    ['down', 's'], ['f', 120], ['up', 's'], ['f', 20],
    ['down', 'a'], ['f', 45], ['up', 'a'], ['f', 10],
    ['down', 'd'], ['f', 45], ['up', 'd'], ['f', 10],
    ['down', 'q'], ['f', 30], ['up', 'q'], ['f', 10],
    ['down', 'e'], ['f', 30], ['up', 'e'], ['f', 10],
    ['down', 'w'], ['down', 'shift'], ['f', 60], ['up', 'shift'], ['f', 30], ['up', 'w'], ['f', 20],
    ['down', 'w'], ['down', 's'], ['f', 30], ['up', 's'], ['f', 10], ['up', 'w'], ['f', 10],
    ['down', 'a'], ['down', 'd'], ['f', 20], ['up', 'a'], ['f', 10], ['up', 'd'], ['f', 10],
    ['tap', 'b'], ['s'], ['down', 'a'], ['f', 40], ['up', 'a'], ['f', 60], ['tap', 'b'], ['s'], ['f', 10],
    ['tap', 'c'], ['s'], ['f', 30], ['tap', 'c'], ['s'], ['f', 10],
    ['tap', 'l'], ['s'], ['f', 2], ['tap', 'l'], ['s'],
    ['tap', '1'], ['s'], ['f', 2], ['tap', '2'], ['s'], ['f', 2], ['tap', '3'], ['s'], ['f', 2], ['tap', '1'], ['s'],
    ['tap', 'y'], ['s'], ['f', 2], ['tap', 'y'], ['s'], ['f', 2], ['tap', 'y'], ['s'],
    ['tap', 'v'], ['s'], ['f', 2], ['tap', 'v'], ['s'], ['f', 2], ['tap', '7'], ['s'], ['f', 2], ['tap', '7'], ['s'],
    ['down', 'ctrl'], ['f', 2], ['up', 'ctrl'], ['s'],
    ['tap', 'capslock'], ['s'], ['f', 30], ['tap', 'capslock'], ['s'], ['f', 20],
    ['tap', '9'], ['s'], ['f', 10], ['tap', '9'], ['s'], ['f', 10],
    ['tap', 'space'], ['s'], ['f', 5], ['down', 'w'], ['f', 5], ['up', 'w'], ['tap', 'space'], ['s'], ['f', 5],
    ['tap', 'm'], ['s'], ['f', 5], ['down', 'w'], ['f', 10], ['up', 'w'], ['tap', 'm'], ['s'], ['f', 5],
    ['tap', 'tab'], ['s'], ['f', 5], ['tap', 'tab'], ['s'], ['f', 5],
    ['tap', 'g'], ['s'], ['f', 10], ['down', 'w'], ['down', 'd'], ['f', 20], ['up', 'w'], ['up', 'd'], ['tap', 'g'], ['s'], ['f', 10],
    ['tap', 'x'], ['s'], ['f', 10],
    ['tap', 'k'], ['s'], ['f', 5], ['down', 'arrowleft'], ['f', 15], ['up', 'arrowleft'], ['tap', 'home'], ['s'], ['f', 5],
    ['tap', 'i'], ['s'], ['f', 30], ['tap', 'i'], ['s'], ['f', 10],
    ['tap', 'n'], ['s'], ['f', 10], ['tap', 'n'], ['s'], ['f', 5],
    ['down', 'w'], ['f', 30], ['tap', 'f'], ['s'], ['f', 40], ['down', 's'], ['f', 10], ['s'], ['up', 's'], ['up', 'w'], ['f', 30],
    ['down', 't'], ['f', 10], ['up', 't'], ['s'], ['f', 5],
    ['tap', 'r'], ['f', 5], ['tap', 'r'], ['f', 5],
    ['f', 30]
  ];
  for (const [cmd, a] of SCRIPT) {
    if (cmd === 'f') { await frames(a); steps.push(`f${a}`); continue; }
    if (cmd === 's') { stany.push(await stateSig()); continue; }
    if (cmd === 'down') await key(cdp, 'keyDown', a);
    else if (cmd === 'up') await key(cdp, 'keyUp', a);
    else if (cmd === 'tap') { await key(cdp, 'keyDown', a); await key(cdp, 'keyUp', a); }
    steps.push(`${cmd} ${a}`);
  }
  const klatki = await ev('window.__padTrace');
  const trace = { pola: FIELDS, klatki, stany, kroki: steps, zpadem: !!args.zpadem };
  writeFileSync(join(out, 'slad.json'), JSON.stringify(trace));
  report.klatki = klatki.length;
  report.stany = stany;
  console.log(`ślad: ${klatki.length} klatek, ${stany.length} stanów → ${join(out, 'slad.json')}`);
}

// ------------------------------------------------------------------ scenariusz padem (czas rzeczywisty)
async function runPadScenario() {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); } catch {}\n${ATRAPA}`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame && window.__fakePad)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  const pad = (o) => ev(`window.__fakePad.set(${JSON.stringify(o)})`);
  const tap = async (b, ms = 120) => { await ev(`window.__fakePad.press(${b})`); await sleep(ms); await ev(`window.__fakePad.release(${b})`); await sleep(120); };
  const note = (name, extra = {}) => { report.kroki.push({ name, ...extra }); console.log(name.padEnd(28), JSON.stringify(extra)); };
  const shot = (name) => screenshotPng(cdp, join(out, `${name}.png`));
  const check = (name, ok, extra = {}) => { note(`${ok ? 'OK ' : 'ŹLE'} ${name}`, extra); if (!ok) report.porazki = (report.porazki || 0) + 1; return ok; };

  // 1) Menu: pad podłączony (Chrome pokazuje go stronie po naciśnięciu przycisku), A — „Nowa gra”, A — „Jedna osoba”.
  await ev('window.__fakePad.connect()');
  await sleep(600);
  const focus0 = await ev(`document.querySelector('#main-menu .gamepad-focus')?.id || null`);
  check('menu: fokus na Nowej grze', focus0 === 'btn-new-game', { fokus: focus0 });
  await shot('00-menu');
  await tap(0);
  await sleep(500);
  const view1 = await ev(`document.getElementById('main-menu')?.dataset.view || null`);
  check('A → widok trybu gry', view1 === 'gamemode', { widok: view1 });
  await tap(13); // D-pad w dół → podzielony ekran
  await tap(12); // i z powrotem
  const focus1 = await ev(`document.querySelector('#main-menu .gamepad-focus')?.id || null`);
  check('D-pad: fokus wraca na Jedną osobę', focus1 === 'btn-mode-single', { fokus: focus1 });
  await tap(0);
  if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.flight)', 300000, 200)) throw new Error('brak lotu intro (start kampanii)');
  check('A → start kampanii', true);

  // 2) Intro: lot kamery na koniec, szybkie otwarcie dachu.
  await ev(`(() => { const S = window.StoryGame; S.REVEAL_SEC = 0.4; S.REVEAL_DELAY_SEC = 0; const f = window.__menuBackdrop.flight; f.devTime = NaN; f.t = f.duration; return true; })()`);
  if (!await waitFor(cdp, '!!window.StoryGame.dialogue.current && window.StoryGame.dialogue.mode === "scene"', 120000, 200)) throw new Error('brak odprawy');
  await sleep(800);
  await shot('10-odprawa');
  // A: odsłoń tekst / dalej (dwa razy); potem B trzymane 0,8 s — pomiń całą scenę.
  const line0 = await ev('window.StoryGame.dialogue.index');
  await tap(0); await tap(0); await tap(0);
  const line1 = await ev('window.StoryGame.dialogue.index');
  check('A w dialogu przewija kwestie', line1 > line0, { przed: line0, po: line1 });
  await ev('window.__fakePad.press(1)');
  await sleep(250);
  const stillOn = await ev('window.StoryGame.dialogue.active');
  await sleep(650);
  await ev('window.__fakePad.release(1)');
  await sleep(200);
  const sceneAfter = await ev('window.StoryGame.dialogue.active && window.StoryGame.dialogue.mode === "scene"');
  check('B: po 0,25 s scena trwa, po 0,9 s pominięta', stillOn && !sceneAfter, { po025: stillOn, po09: sceneAfter });

  // 3) Panel stanowiska: A — ODDOKUJ.
  if (!await waitFor(cdp, "window.StoryGame.phase === 'undock' && !!window.StoryGame.ui.action && !window.StoryGame.letterbox", 60000, 200)) throw new Error('brak panelu ODDOKUJ');
  await sleep(600);
  await shot('20-panel-oddokuj');
  await tap(0);
  await sleep(300);
  check('A → ODDOKUJ', await ev('!!window.StoryGame.ui.action?.pressed'));
  await shot('21-odcumowanie');
  if (!await waitFor(cdp, "window.StoryGame.phase === 'undock' && !window.StoryGame.lock && !window.StoryGame.blocksInput", 60000, 300)) throw new Error('stery nie wróciły do gracza');
  note('stery u gracza');

  // 4) Odczyty pada na klatkę (ma być 1).
  const r0 = await ev('({ r: window.__fakePad.state.reads, f: window.__frameId | 0 })');
  await sleep(1500);
  const r1 = await ev('({ r: window.__fakePad.state.reads, f: window.__frameId | 0 })');
  const perFrame = (r1.r - r0.r) / Math.max(1, r1.f - r0.f);
  report.odczytyNaKlatke = +perFrame.toFixed(3);
  check('navigator.getGamepads raz na klatkę', perFrame > 0.95 && perFrame < 1.05, { naKlatke: report.odczytyNaKlatke });

  // 5) Wylot z hali: pilot P na punkt za bramą G-01 (k7Dock.js — ten sam co api.dock.approachPoint()).
  await ev(`(async () => {
    const k = await import('/src/game/story/k7Dock.js');
    const S = window.StoryGame;
    const earth = S._earth();
    const frame = k.k7FrameFor(earth, 0);
    const l = k.k7LayoutTemplate();
    window.__padGoal = k.k7HubToGame(earth, frame, -810, l.frontZ + l.apronDepth + 3500, {});
    return true;
  })()`);
  const t0 = Date.now();
  const track = [];
  let outside = false;
  while (Date.now() - t0 < 120000) {
    const s = await ev(`(() => {
      const s = window.ship, g = window.__padGoal;
      const want = Math.atan2(g.y - s.pos.y, g.x - s.pos.x);
      let d = want - s.angle; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const turn = Math.max(-1, Math.min(1, d * 2.2 - s.angVel * 1.6));
      const fwd = Math.abs(d) < 0.5 ? 1 : 0.25;
      window.__fakePad.set({ axes: [turn, -fwd, 0, 0] });
      return { faza: window.StoryGame.phase, x: Math.round(s.pos.x), y: Math.round(s.pos.y), v: Math.round(Math.hypot(s.vel.x, s.vel.y)),
        d: +d.toFixed(3), dist: Math.round(Math.hypot(g.x - s.pos.x, g.y - s.pos.y)), thrustY: +(s.input.thrustY || 0).toFixed(3), torque: +(s.thrusterInput?.torque || 0).toFixed(3) };
    })()`);
    track.push(s);
    if (s.faza !== 'undock') { outside = true; break; }
    await sleep(100);
  }
  await pad({ axes: [0, 0, 0, 0] });
  report.wylot = { s: +((Date.now() - t0) / 1000).toFixed(1), probki: track.filter((_, i) => i % 5 === 0) };
  check('wylot z hali K-7 lewą gałką', outside, { faza: track.at(-1)?.faza, sek: report.wylot.s, v: track.at(-1)?.v });
  await sleep(1500);
  await shot('30-za-brama');

  // 6) Y trzymany 1,2 s = warp ładuje się raz (B1); ponowne stuknięcie — anuluj.
  const w0 = await ev('window.warp.state');
  await ev('window.__fakePad.press(3)');
  const ys = [];
  for (let i = 0; i < 12; i++) { await sleep(100); ys.push(await ev('window.warp.state')); }
  await ev('window.__fakePad.release(3)');
  report.warpY = { przed: w0, stany: ys };
  // zmiany stanu w trakcie trzymania: idle → charging (→ active po naładowaniu) — bez powrotu do idle
  const backToIdle = ys.some((v, i) => i > 0 && v === 'idle' && ys[i - 1] !== 'idle');
  check('Y trzymany: warp ładuje się raz (bez migania)', w0 === 'idle' && ys.at(-1) !== 'idle' && !backToIdle, { stany: ys.join(' ') });
  await sleep(200);
  if (await ev("window.warp.state !== 'idle'")) { await tap(3); await sleep(300); }
  note('warp po drugim Y', { warp: await ev('window.warp.state') });

  // 7) Menu na padzie: Menu — menu i pauza; Y / B / RT pod menu nic nie robią (B6); Menu — powrót.
  await waitFor(cdp, "window.warp.state === 'idle' && !(window.warp.exitRamp && window.warp.exitRamp.active)", 20000, 200);
  await tap(9);
  await sleep(300);
  const menuOn = await ev(`!document.getElementById('main-menu').classList.contains('hidden') && window.__isGamePaused()`);
  check('Menu → menu i pauza', menuOn);
  await shot('40-menu-w-grze');
  await tap(3);
  await ev('window.__fakePad.press(7)'); await sleep(200);
  const underMenu = await ev('({ warp: window.warp.state, spust: !!window.fcTrigger?.pad })');
  await ev('window.__fakePad.release(7)');
  check('pod menu: Y i RT nie działają', underMenu.warp === 'idle' && !underMenu.spust, underMenu);
  await tap(9);
  await sleep(300);
  check('Menu → powrót do gry', await ev(`document.getElementById('main-menu').classList.contains('hidden') && !window.__isGamePaused()`));

  // 8) Klawiatura z podłączonym padem (B2, B5): Shift = dopalacz trwa, S = wsteczny.
  await sleep(400);
  await key(cdp, 'keyDown', 'w');
  await key(cdp, 'keyDown', 'shift');
  await sleep(600);
  const boost = await ev(`(async () => { const { GameState } = await import('/src/game/gameState.js'); return GameState.boost.state; })()`);
  await key(cdp, 'keyUp', 'shift');
  await key(cdp, 'keyUp', 'w');
  check('Shift z padem: dopalacz trwa', boost === 'active', { boost });
  await sleep(300);
  await key(cdp, 'keyDown', 's');
  let retro = 0;
  for (let i = 0; i < 40 && retro < 0.05; i++) { await sleep(100); retro = await ev('Number(window.ship.thrusterInput?.retro) || 0'); }
  const thrustY = await ev('window.ship.input.thrustY');
  await key(cdp, 'keyUp', 's');
  check('S z padem: wsteczny (thrustY −1, retro)', thrustY === -1 && retro > 0.05, { thrustY, retro: +retro.toFixed(3) });

  // 9) RT = spust grupy w ręku (fcTrigger.pad).
  await ev('window.__fakePad.press(7, 0.9)');
  await sleep(200);
  const trig = await ev('!!window.fcTrigger?.pad');
  await ev('window.__fakePad.release(7)');
  await sleep(200);
  check('RT → spust grupy w ręku', trig && !(await ev('!!window.fcTrigger?.pad')));
  report.wibracje = await ev('window.__fakePad.rumble.length');
}

// ------------------------------------------------------------------ podzielony ekran (czas rzeczywisty)
async function runSplitScenario() {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: ATRAPA });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.__fakePad)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  const tap = async (b, ms = 120) => { await ev(`window.__fakePad.press(${b})`); await sleep(ms); await ev(`window.__fakePad.release(${b})`); await sleep(150); };
  const note = (name, extra = {}) => { report.kroki.push({ name, ...extra }); console.log(name.padEnd(36), JSON.stringify(extra)); };
  const check = (name, ok, extra = {}) => { note(`${ok ? 'OK ' : 'ŹLE'} ${name}`, extra); if (!ok) report.porazki = (report.porazki || 0) + 1; return ok; };
  const tapKey = async (k) => { await key(cdp, 'keyDown', k); await sleep(60); await key(cdp, 'keyUp', k); await sleep(120); };
  await ev('window.__fakePad.connect()');
  await sleep(400);
  await tap(0);                       // Nowa gra
  await sleep(300);
  await tap(13);                      // D-pad ↓ — Podzielony ekran
  check('fokus na „Podzielony ekran”', await ev(`document.querySelector('#main-menu .gamepad-focus')?.id === 'btn-mode-split'`));
  // A zamyka menu i otwiera przypisanie — ten sam (trzymany) A nie może przypisać pada (zjedzony)
  await ev('window.__fakePad.press(0)');
  await sleep(400);
  const held = await ev('({ aktywne: window.controllerAssignment.active, p1: window.controllerAssignment.p1 })');
  await ev('window.__fakePad.release(0)');
  await sleep(200);
  check('przypisanie: A, które otworzyło ekran, nie przypisuje', held.aktywne && held.p1 === null, held);
  await tap(0);
  check('A przypisuje pad graczowi 1', await ev(`window.controllerAssignment.p1 === 'pad0'`));
  await tapKey('space');
  check('klawiatura — gracz 2', await ev(`window.controllerAssignment.p2 === 'keyboard'`));
  await ev(`document.getElementById('ctrl-confirm-btn')?.click()`);
  await sleep(400);
  const name0 = await ev(`document.getElementById('p1-ship-name')?.textContent || ''`);
  await tap(15);                      // D-pad → — następny statek gracza 1
  const name1 = await ev(`document.getElementById('p1-ship-name')?.textContent || ''`);
  check('wybór statku: D-pad → zmienia statek gracza 1', !!name0 && name0 !== name1, { przed: name0, po: name1 });
  await tap(0);                       // gotowy
  await tapKey('space');              // gracz 2 gotowy (klawiatura)
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.player2Ship && window.splitScreenMode === true", 300000, 400)) throw new Error('podzielony ekran nie ruszył');
  note('gra na podzielonym ekranie', { statekP1: await ev('window.PLAYER?.activeHullId || null') });
  await sleep(2500);
  // gałka — gracz 1; W klawiatury — gracz 2 (nie gracz 1)
  await ev('window.__fakePad.set({ axes: [0, -1, 0, 0] })');
  await key(cdp, 'keyDown', 'w');
  await sleep(500);
  const st = await ev('({ p1: window.ship.input.thrustY, p2: window.player2Ship.input.thrustY })');
  await key(cdp, 'keyUp', 'w');
  await ev('window.__fakePad.set({ axes: [0, 0, 0, 0] })');
  check('gałka leci graczem 1, W — graczem 2', st.p1 > 0.9 && st.p2 === 1, st);
  await sleep(300);
  const after = await ev('({ p1: window.ship.input.thrustY, p2: window.player2Ship.input.thrustY })');
  check('puszczone: oba stoją', after.p1 === 0 && after.p2 === 0, after);
  await ev('window.__fakePad.press(7, 0.9)');
  await sleep(200);
  check('RT gracza 1 → spust', await ev('!!window.fcTrigger.pad'));
  await ev('window.__fakePad.release(7)');
  await sleep(200);
}
