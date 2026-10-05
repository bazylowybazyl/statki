// Maskowanie okrętu (2026-10-04, efekt jak w Crysis) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU (CDP).
// Gra swobodna, Atlas gracza; fazy ustawiane wprost na `ship.cloak` (pauza gry — render biegnie dalej, wygląd
// liczy się z poziomu maskowania), potem przebieg na żywo klawiszem I i zerwanie strzałem.
//
//   node scripts/webgpu/maskowanie-gra.mjs [--out .tmp/maskowanie] [--rozmiar 1600x900] [--zoom 0.9]
//                                          [--tlo mglawica|ziemia] [--tylko faza1,faza2]
//
// Wynik: <out>/*.png i <out>/raport.json (stan wyglądu: faza, front, widoczność, refrakcja; błędy konsoli,
// koszt klatki).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/maskowanie');
mkdirSync(out, { recursive: true });
const ZOOM = Number(args.zoom || 0.9);
const only = args.tylko ? new Set(String(args.tylko).split(',')) : null;

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { zdjecia: [], bledy: [] };

const KEY = (k) => {
  const up = k.toUpperCase();
  return { key: k, code: /^[a-z]$/.test(k) ? `Key${up}` : `Digit${k}`, windowsVirtualKeyCode: up.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0) };
};
const tap = async (k) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY(k) });
  await sleep(60);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY(k) });
};

const state = () => ev(`(() => {
  const s = window.ship, c = s.cloak, l = s.__cloakLook;
  return {
    stan: c ? c.state : null, poziom: c ? +c.level.toFixed(3) : null, energia: c ? Math.round(c.energy) : null,
    faza: l ? l.phase : '-', aktywny: !!(l && l.active), front: l ? +l.front.toFixed(3) : null,
    widocznosc: l ? +l.vis.toFixed(3) : null, kierunek: l ? l.dir : 0, zaklocenie: l ? +l.glitch.toFixed(3) : 0,
    impuls: l ? +l.pulse.toFixed(3) : 0, ruch: l ? +l.motion.toFixed(2) : 0,
    ekrany: l ? { pas: +l.e.x.toFixed(3), strona: l.e.y, utrata: +l.e.z.toFixed(3) } : null,
    dist: !!window.__hullCloak?.distLive, warstwaDist: !!window.Core3D?.fxStats?.distortLayer,
    v: Math.round(Math.hypot(s.vel.x, s.vel.y)),
    rysunki: window.__rendererInfo?.calls ?? null, klatkaMs: +(window.Core3D?.lastFramePerf?.renderTotalMs ?? 0).toFixed(2)
  };
})()`);

// Zrzut CDP w headless trwa ~1 s — dłużej niż impuls siatki i zakłócenie po zerwaniu. Na czas zrzutu zegar
// strony (performance.now) stoi: wygląd maskowania i shadery widzą tę samą chwilę.
const freezeClock = (on) => ev(on
  ? '(() => { const p = window.performance; if (!p.__nowOrig) { p.__nowOrig = p.now.bind(p); const t = p.__nowOrig(); p.now = () => t; } return true; })()'
  : '(() => { const p = window.performance; if (p.__nowOrig) { p.now = p.__nowOrig; delete p.__nowOrig; } return true; })()');

async function shot(name, frozen = false) {
  if (only && !only.has(name.split('-')[0])) return;
  if (frozen) await freezeClock(true);
  await screenshotPng(cdp, join(out, `${name}.png`));
  if (frozen) await freezeClock(false);
  const s = await state();
  report.zdjecia.push({ name, ...s });
  console.log(('[' + name + ']').padEnd(26), JSON.stringify(s));
}

// Faza maskowania wprost (pauza): stan i poziom; zerwanie — nowy obiekt lastBreak (look wykrywa zmianę).
const setCloak = (st, level, extra = '') => ev(`(() => {
  const c = window.ship.cloak;
  c.state = '${st}'; c.level = ${level}; ${extra}
  return true;
})()`);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  report.start = await ev(`(() => ({ cloak: !!window.ship.cloak, x: Math.round(window.ship.pos.x), y: Math.round(window.ship.pos.y), zoom: window.camera.zoom }))()`);
  console.log('start:', JSON.stringify(report.start));
  if (!report.start.cloak) await ev(`(async () => { const m = await import('/src/game/cloak.js'); window.ship.cloak = m.createCloak(); return true; })()`);

  // Tło: 'start' — miejsce startu (ciemne niebo), 'ziemia' — tarcza Ziemi za okrętem (refrakcja widać na
  // strukturze tła; gra zatrzymana na zdjęcia, więc ring w płaszczyźnie gry nie przeszkadza).
  const tlo = args.tlo || 'start';
  report.tlo = await ev(`(() => {
    const s = window.ship;
    if ('${tlo}' === 'ziemia') {
      const e = (window.planets || []).find((p) => /earth|ziemia/i.test(String(p.name || p.label || p.id || '')));
      if (e) {
        // strona dzienna: w stronę słońca, ułamek promienia od środka (--limb)
        const sun = window.SUN || { x: 0, y: 0 };
        const a = Math.atan2(sun.y - e.y, sun.x - e.x) + ${Number(args.kat || 0.35)};
        const k = ${Number(args.limb || 0.6)};
        window.DevScene?.teleport?.(e.x + Math.cos(a) * e.r * k, e.y + Math.sin(a) * e.r * k, -0.35);
        window.DevScene?.syncCamera?.();
        return { planeta: e.name || e.label, r: Math.round(e.r) };
      }
    }
    // --dx / --dy: przesunięcie od miejsca startu [j. świata] (np. mgławica za okrętem)
    window.DevScene?.teleport?.(s.pos.x + ${Number(args.dx || 0)}, s.pos.y + ${Number(args.dy || 0)}, -0.35);
    window.DevScene?.syncCamera?.();
    return { planeta: null };
  })()`);
  console.log('tło:', JSON.stringify(report.tlo));
  if (args.kukla) {
    // Kukła NPC częściowo pod okrętem gracza: refrakcja cudzego kadłuba (na jednolitym tle soczewki nie widać).
    report.kukla = await ev(`(() => {
      const s = window.ship;
      const a = s.angle + Math.PI / 2;
      const d = ${Number(args.kuklaD ?? 140)};
      const list = window.spawnCallInShip('${args.kukla === '1' ? 'destroyer' : args.kukla}', { mode: 'dummy', spawnPos: { x: s.pos.x + Math.cos(a) * d - Math.cos(s.angle) * 250, y: s.pos.y + Math.sin(a) * d - Math.sin(s.angle) * 250 }, spawnAngle: s.angle + 0.5 });
      return Array.isArray(list) ? list.length : !!list;
    })()`);
  }
  await ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${ZOOM}); c.maxZoom = Math.max(c.maxZoom, ${ZOOM}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${ZOOM}; return true; })()`);
  if (tlo === 'ziemia') await ev('window.__setGamePaused(true)');
  await sleep(2500);
  await ev('window.__setGamePaused(true)');
  await sleep(400);

  await shot('00-przed');

  // Włączanie: impuls siatki, fala od środka (poziomy jak w stepCloak: 1,6 s ładowania). Impuls trwa ~0,4 s —
  // krócej niż zrzut CDP: przed zrzutem zegar impulsu cofnięty do szczytu obwiedni.
  await setCloak('engaging', 0.05);
  await sleep(90);
  await ev('(() => { const l = window.ship.__cloakLook; if (l) l.pulseT = 0.24; return true; })()');
  await shot('01-impuls', true);
  // Włączanie: komórki gasną w losowej kolejności na całym kadłubie (bez fali), soczewka rośnie z postępem.
  for (const [lvl, name] of [[0.3, '02-wlaczanie-30'], [0.5, '03-wlaczanie-50'], [0.7, '04-wlaczanie-70'], [0.88, '05-wlaczanie-88']]) {
    await setCloak('engaging', lvl);
    await sleep(350);
    await shot(name);
  }
  await setCloak('on', 1);
  await sleep(1200);
  await shot('06-ukryty');
  // Ukryty w ruchu (ruch wygładzony w wyglądzie ustawiony wprost, zegar stoi): mocniejsza soczewka i brzeg.
  await ev('(() => { const l = window.ship.__cloakLook; if (l) l.motion = 1; return true; })()');
  await freezeClock(true);
  await sleep(250);
  await shot('06b-ukryty-ruch', true);
  await freezeClock(false);
  await sleep(1300);
  await shot('07-ukryty-pozniej');
  // Końcówka energii: migotanie komórek.
  await ev('(() => { window.ship.cloak.energy = 2; return true; })()');
  await sleep(500);
  await shot('08-koncowka-energii');
  await ev('(() => { window.ship.cloak.energy = 40; return true; })()');

  // Powrót (ręczne wyłączenie): fala odsłaniania.
  await setCloak('revealing', 1, "c.lastBreak = { reason: 'manual', time: c.time, forced: false };");
  await sleep(120);
  for (const [lvl, name] of [[0.7, '09-powrot-70'], [0.45, '10-powrot-45'], [0.2, '11-powrot-20']]) {
    await setCloak('revealing', lvl);
    await sleep(300);
    await shot(name);
    if (lvl === 0.7) {
      // Zbliżenie na heksy-ekrany przed powrotem komórek (każdy pokazuje inny wycinek kadru).
      await ev(`(() => { const c = window.camera; const z = ${ZOOM * 2.4}; c.maxZoom = Math.max(c.maxZoom, z); c.zoom = c.targetZoom = c.zoomBase = z; return true; })()`);
      await sleep(400);
      await shot('09b-ekrany-zblizenie', true);
      await ev(`(() => { const c = window.camera; c.zoom = c.targetZoom = c.zoomBase = ${ZOOM}; return true; })()`);
      await sleep(400);
    }
  }
  await setCloak('off', 0);
  await sleep(500);

  // Zerwanie (strzał): zakłócenie po pełnym ukryciu.
  await setCloak('on', 1);
  await sleep(600);
  await setCloak('cooldown', 0, "c.cooldown = 8; c.lastBreak = { reason: 'fire', time: c.time, forced: true };");
  await sleep(60);
  // zakłócenie (0,85 s) krótsze niż zrzut — przed zrzutem zegar cofnięty (pełne i w połowie)
  await ev('(() => { const l = window.ship.__cloakLook; if (l) l.glitchT = 0.78; return true; })()');
  await shot('12-zerwanie-a', true);
  await ev('(() => { const l = window.ship.__cloakLook; if (l) l.glitchT = 0.4; return true; })()');
  await shot('13-zerwanie-b', true);
  await sleep(500);
  await shot('14-po-zerwaniu');
  await setCloak('off', 0, 'c.cooldown = 0;');
  await sleep(300);
  if (tlo === 'ziemia' || args.kukla) {
    // przy Ziemi i z kukłą bez części „na żywo” (ring w płaszczyźnie gry, kadłuby na sobie — kolizje)
    report.bledy = logs.errors().slice(0, 80);
    throw Object.assign(new Error('koniec (tło ziemia)'), { koniec: true });
  }

  // Na żywo: klawisz I (pełny automat gry), lot do przodu w ukryciu.
  await ev('window.__setGamePaused(false)');
  await sleep(300);
  await tap('i');
  await sleep(700);
  await shot('15-zywo-wlaczanie');
  await sleep(1400);
  await shot('16-zywo-ukryty');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY('w') });
  await sleep(1800);
  await shot('17-zywo-ruch');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY('w') });
  await tap('i');
  await sleep(250);
  await shot('18-zywo-powrot');
  await sleep(900);
  await shot('19-zywo-widoczny');

  report.koszt = await ev(`(() => ({ hullCloak: { aktywne: window.__hullCloak?.active, fx: window.__hullCloak?.fx?.stats } }))()`);
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  if (!err?.koniec) {
    report.wyjatek = String(err?.stack || err);
    report.logi = logs.all().slice(-80);
    console.error(err);
    console.log(report.logi.join('\n'));
  } else if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
