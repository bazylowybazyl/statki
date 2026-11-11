// Kursor = centralne miejsce informacji (2026-11-11): koło ładowania warpa i rozruchu hipercruise'u na pierścieniu
// celownika ze „skokiem kompletności” oraz streszczenie stanu skoku pod celownikiem (dawna ramka u góry ekranu —
// src/ui/warpCourseOverlay.js, src/ui/cursorChargeRing.js) w PRAWDZIWEJ grze. Vite + headless Chrome z WebGPU (CDP),
// gra swobodna, Atlas w próżni, kursor i klawisze jak od gracza.
//
//   node scripts/webgpu/kursor-naped-gra.mjs [--out .tmp/kursor-naped] [--rozmiar 1600x900] [--query renderWorker=1]
//
// Zrzuty: warp-1-kurs (kurs OK), warp-2-ladowanie (koło w połowie), warp-3-skok-* (skok kompletności po starcie),
// warp-4-lot (wyjście za…), hiper-1-rozruch (koło w połowie), hiper-2-skok-* (skok po starcie lotu). Do tego
// <out>/raport.json: stan koła i napisy pod kursorem w każdej chwili, ramka u góry (ma jej nie być), błędy konsoli.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/kursor-naped');
mkdirSync(out, { recursive: true });
const query = args.query ? `&${args.query}` : '';

const { server, base } = await startVite(Number(args.port || 5391));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { probki: [], bledy: [] };

const key = (type, k, code, n) => cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: n, nativeVirtualKeyCode: n });
const tap = async (k, code, n) => { await key('keyDown', k, code, n); await sleep(50); await key('keyUp', k, code, n); };
const mouse = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
const pauza = (on) => ev(`window.__setGamePaused(${on}); true`);

// Gra swobodna bez kampanii (StoryOptions czyta klucz RAZ przy starcie strony — przed nawigacją). Podsłuch napisów
// HUD-u i prostokątów u góry ekranu (ramka warpa stała na y 118 — ma jej nie być).
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {}
  const P = CanvasRenderingContext2D.prototype, ft = P.fillText, fr = P.fillRect, ar = P.arc, st = P.stroke;
  window.__hud = { text: [], topRects: 0, ring: null };
  // Łuki koła przy kursorze (skok kompletności): promień i barwa każdej kreski w pobliżu kursora.
  P.arc = function (x, y, r, ...a) { this.__arc = { x, y, r }; return ar.call(this, x, y, r, ...a); };
  P.stroke = function (...a) {
    const R = window.__hud.ring, c = this.__arc;
    if (R && c && Math.abs(c.x - R.x) < 2 && Math.abs(c.y - R.y) < 2) {
      R.list.push({ r: +c.r.toFixed(1), color: String(this.strokeStyle), alpha: +this.globalAlpha.toFixed(2), t: Math.round(performance.now() - R.t0) });
    }
    return st.apply(this, a);
  };
  P.fillText = function (t, ...a) { if (window.__hud.on) window.__hud.text.push(String(t)); return ft.call(this, t, ...a); };
  P.fillRect = function (x, y, w, h, ...r) {
    if (window.__hud.on && this.canvas && this.canvas.id === 'c' && y > 100 && y < 140 && h > 90 && h < 120 && w > 200) window.__hud.topRects++;
    return fr.call(this, x, y, w, h, ...r);
  };
})();` });

const stan = () => ev(`(() => {
  const w = window.warp, hc = window.hypercruise;
  return { warp: w.state, ladowanie: w.chargeTime > 0 ? +(w.charge / w.chargeTime).toFixed(2) : null, rampa: !!w.exitRamp?.active,
    hiper: hc.state, rozruch: +(hc.t / Math.max(1e-3, hc.spoolNow || 1)).toFixed(2) };
})()`);

// Napisy jednej klatki: włącz podsłuch, poczekaj dwie klatki, wyłącz.
async function napisy() {
  await ev(`(() => { window.__hud.text.length = 0; window.__hud.topRects = 0; window.__hud.on = true; return true; })()`);
  await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`, 5000).catch(() => {});
  await sleep(60);
  return ev(`(() => { window.__hud.on = false; const t = window.__hud.text.filter((s) => /WARP|HIPERCRUISE|KURS|CAPS|MINIĘCIE| km$| m$/.test(s));
    return { napisy: [...new Set(t)].slice(0, 12), ramkaUGory: window.__hud.topRects }; })()`);
}

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
  const s = await stan();
  const h = await napisy();
  report.probki.push({ name, ...s, ...h });
  console.log(name.padEnd(22), JSON.stringify({ ...s, ...h }));
}

// Zaraz po starcie napędu: podsłuch łuków przy kursorze przez 0,9 s (skok kompletności trwa 0,55 s w czasie
// rzeczywistym — zrzut trwa ~0,4 s, więc dowodem jest zapis rysunku) i jeden zrzut na początku.
async function burst(prefix, cx, cy) {
  await ev(`(() => { window.__hud.ring = { x: ${cx}, y: ${cy}, t0: performance.now(), list: [] }; return true; })()`);
  await screenshotPng(cdp, join(out, `${prefix}.png`));
  await sleep(900);
  const ring = await ev(`(() => { const R = window.__hud.ring; window.__hud.ring = null; return R.list; })()`);
  const flash = ring.filter((a) => a.color === '#ffffff' && a.r > 0);
  const colored = ring.filter((a) => a.color === '#c4abff' || a.color === '#7fd8ff');
  const maxR = colored.reduce((m, a) => Math.max(m, a.r), 0);
  const lastT = colored.reduce((m, a) => Math.max(m, a.t), 0);
  const wynik = { name: prefix, lukow: ring.length, blyskow: flash.length, maxBlyskR: flash.reduce((m, a) => Math.max(m, a.r), 0),
    maxKoloR: maxR, kolor: colored[0]?.color || '', ostatniLukMs: lastT, probka: colored.filter((_, i) => i % 4 === 0).slice(0, 12) };
  report.probki.push(wynik);
  console.log(prefix.padEnd(22), JSON.stringify({ ...wynik, probka: undefined }));
}

try {
  await (await import('../../dema/rdzen-cdp.js')).navigateAndWait(cdp, `${base}/index.html?dev=1${query}`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 240000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera && !!window.ship?.beamHull && !!window.PlayerHypercruise', 240000)) throw new Error('gra nie wstała');
  await sleep(1500);

  // Atlas w próżni (10% świata od rogu — poza studniami), cel TRAVEL TO 500 km dalej; D przerywa automat (cel zostaje).
  await ev(`(() => {
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    const x = window.WORLD.w * 0.1, y = window.WORLD.h * 0.1;
    window.devTeleportTo(x, y, { angle: 0, quiet: true });
    window.DevFlags.unlimitedWarp = true;
    window.setTravelTarget(x + 500000, y, 'TEST WARP');
    return true;
  })()`);
  await key('keyDown', 'd', 'KeyD', 68);
  await waitFor(cdp, '!window.travelNav.active && !!window.travelNav.target', 10000, 50);
  await key('keyUp', 'd', 'KeyD', 68);
  await pauza(true);
  await ev(`(() => { const s = window.ship, l = window.travelNav.leg, p = s.pos;
    s.vel.x = s.vel.y = 0; s.angle = Math.atan2(l.y - p.y, l.x - p.x) + 0.02; s.angVel = 0; return l.kind; })()`);
  const MX = Math.round(W * 0.66), MY = Math.round(H * 0.4);
  await mouse(MX, MY);
  await sleep(400);
  await shot('warp-1-kurs');

  // Ładowanie: 9, pauza w połowie (koło stoi), potem start skoku — skok kompletności.
  await pauza(false);
  for (let i = 0; i < 40 && (await stan()).warp !== 'charging'; i++) { await tap('9', 'Digit9', 57); await sleep(250); }
  await pauza(true);
  await ev(`(() => { const w = window.warp; w.charge = w.chargeTime * 0.55; return true; })()`);
  await sleep(300);
  await shot('warp-2-ladowanie');
  await pauza(false);
  if (!await waitFor(cdp, "window.warp.state === 'active'", 20000, 10)) throw new Error('warp nie ruszył');
  await burst('warp-3-skok', MX, MY);
  await sleep(900);
  await shot('warp-4-lot');
  await waitFor(cdp, "window.warp.state === 'idle' && !window.warp.exitRamp?.active && !window.warp.exitSlide", 60000, 100);
  await sleep(800);

  // Hipercruise: Mk III, kurs skasowany (sam rozruch), pauza w połowie rozruchu, potem start lotu.
  await ev(`(() => { window.cancelTravel(null); const s = window.ship; s.hypercruiseEngine = 'hypercruise_mk3';
    s.vel.x = s.vel.y = 0; window.__hypercruiseReset(); return true; })()`);
  for (let i = 0; i < 40 && (await stan()).hiper !== 'spool'; i++) { await ev('window.PlayerHypercruise.start({ quiet: true }); true'); await sleep(250); }
  await pauza(true);
  await ev(`(() => { const hc = window.hypercruise; hc.t = hc.spoolNow * 0.5; return true; })()`);
  await sleep(300);
  await shot('hiper-1-rozruch');
  await pauza(false);
  if (!await waitFor(cdp, "window.hypercruise.state === 'active'", 30000, 10)) throw new Error('hipercruise nie ruszył');
  await burst('hiper-2-skok', MX, MY);
  await sleep(700);
  await shot('hiper-3-lot');
  await ev(`window.PlayerHypercruise.stop('manual'); true`);
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  console.log('raport:', join(out, 'raport.json'));
  await chrome.close();
  await server.close();
}
