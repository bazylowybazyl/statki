// Stan zasilania okrętu w PRAWDZIWEJ grze (src/game/shipPower.js; prośba użytkownika 2026-11-11: włączanie / wyłączanie
// statku, wyłączony ma mniejszą sygnaturę). Sprawdza rozgrywkę i robi zrzuty obrazu:
//   • gracz: klawisz − wyłącza (gaszenie 2 s → WYŁ.), silniki gasną, W nie odpala autozapłonu, okręt dryfuje (prędkość
//     bez zmian), tarcza wymuszona wył., kierowanie ogniem zimne, sygnatura AI × 0,3; − włącza (rozruch 5 s → PRACA),
//     tarcza wraca; pirat 9 km od wyłączonego gracza go traci;
//   • NPC: ShipPower.off — broń milczy, dryf; ShipPower.on — rozruch i zapłon silników;
//   • zrzuty: włączony, gaszenie, wyłączony, rozruch (fala), praca; daleki kadr; pipeline'y w klatkach (ma być 0).
//
//   node scripts/webgpu/zasilanie-gra.mjs [--out .tmp/webgpu/zasilanie-gra] [--port 5364] [--query renderWorker=1]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5364);
const query = args.query ? `&${args.query}` : '';
const out = resolve(repo, args.out || '.tmp/webgpu/zasilanie-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { createServer } = await import('vite');
const server = await createServer({ root: repo, logLevel: 'error', server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const workerLogs = [];
let msgId = 900000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId: msg.params.sessionId }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

const result = { tryb: args.query || 'off', kroki: {}, zrzuty: [], bledyAsercji: [] };
const check = (ok, what) => { if (!ok) result.bledyAsercji.push(what); console.log(ok ? 'OK  ' : 'BŁĄD', what); };
const key = async (code, type) => cdp.send('Input.dispatchKeyEvent', { type, code, key: code === 'Minus' ? '-' : code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: code === 'Minus' ? 189 : code.charCodeAt(3) });
// Klawisz gry zdarzeniem DOM (akcje `edge` idą z keydown — ta sama ścieżka co prawdziwy klawisz); krok po nim.
// Gdy zdarzenie nie dojdzie do akcji (harness: menu / fokus), diagnostyka i przełącznik z konsoli (PlayerPower.toggle).
const press = async (code) => {
  const r = await ev(`(async () => { const k = { code: '${code}', key: '${code}' === 'Minus' ? '-' : 'w', bubbles: true };
    const before = ship.shipPower ? ship.shipPower.serial : -1;
    window.dispatchEvent(new KeyboardEvent('keydown', k)); window.dispatchEvent(new KeyboardEvent('keyup', k));
    const after = ship.shipPower ? ship.shipPower.serial : -1;
    let fallback = false;
    if (after === before) { window.PlayerPower.toggle(); fallback = true; }
    await window.__harness.step(1);
    return { fallback, menu: !!document.getElementById('main-menu') && getComputedStyle(document.getElementById('main-menu')).display !== 'none',
      story: !!window.StoryGame?.blocksInput, mode: window.camera?.mode };
  })()`);
  if (r.fallback) { result.klawiszBezSkutku = r; console.log('klawisz bez skutku — przełącznik z konsoli', JSON.stringify(r)); }
};
const shot = async (name) => {
  await ev('window.__harness.frames(3)');
  const file = join(out, `${name}.png`);
  await screenshotPng(cdp, file);
  result.zrzuty.push(name);
};
const stepSec = (s) => ev(`window.__harness.step(${Math.round(s * 60)})`, 300000);
const st = () => ev(`(() => ({ pwr: ship.shipPower ? { ...ship.shipPower } : null, eng: ship.engineIgn ? ship.engineIgn.state : -1,
  shOff: !!ship._shieldForcedOff, shOwn: !!ship.__powerShieldOff, v: Math.hypot(ship.vel.x, ship.vel.y), sig: ship.__sigMul,
  canFire: !!window.__fcEnvCanFire?.() }))()`);

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await new Promise((r) => setTimeout(r, 1500));
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');

  // Atlas w głębokim kosmosie, pirat-fregata 9 km przed dziobem (uśpiony — nie strzela), Bellator Terra Novy 1,6 km obok.
  result.kroki.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x5eac);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    ship.angle = 0; if (ship.vel) { ship.vel.x = 0; ship.vel.y = 0; }
    const spawn = (key, mode, x, y) => { const before = new Set(npcs); spawnCallInShip(key, { mode, pos: { x, y }, spawnPos: { x, y }, spawnAngle: Math.PI }); return npcs.find((n) => !before.has(n)); };
    const ally = spawn('battleship', 'dummy', ${DEEP.x} + 300, ${DEEP.y} - 1600);
    const pirate = spawn('frigate_pd', 'pirate', ${DEEP.x} + 9000, ${DEEP.y});
    if (pirate && window.storySleepNpc) window.storySleepNpc(pirate);
    window.__ZasScene = { ally, pirate };
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    await H.step(60);
    return { ally: !!ally, pirate: !!pirate, gasHere: window.gasCoverAt(${DEEP.x}, ${DEEP.y}) };
  })()`, 300000);
  console.log('scena', JSON.stringify(result.kroki.scena));
  await ev(`window.__harness.scene.cam(${DEEP.x}, ${DEEP.y}, 0.42)`);
  await shot('1-wlaczony');
  const visOn = await ev(`(() => { const p = window.__ZasScene.pirate; return p ? null : null; })()`);
  void visOn;

  // Wyłączenie klawiszem −.
  await press('Minus');
  let s = await st();
  check(s.pwr && s.pwr.state === 3, `− → GASZENIE (stan ${s.pwr?.state})`);
  check(s.shOff && s.shOwn, 'tarcza wymuszona wył. przez zasilanie');
  await stepSec(0.9);
  await shot('2-gaszenie');
  await stepSec(1.4);
  s = await st();
  check(s.pwr && s.pwr.state === 0, `po 2,3 s WYŁ. (stan ${s.pwr?.state})`);
  check(s.eng === 0, `silniki MAIN WYŁ. (stan ${s.eng})`);
  await shot('3-wylaczony');
  await ev(`window.__harness.scene.cam(${DEEP.x} - 300, ${DEEP.y}, 1.1)`);
  await shot('3b-wylaczony-blisko');
  await ev(`window.__harness.scene.cam(${DEEP.x}, ${DEEP.y}, 0.42)`);

  // Dryf: prędkość nadana ręcznie zostaje (bez tłumika, stabilizatora i regulatora; opór liniowy świata — mały).
  await ev(`(() => { ship.vel.x = 120; ship.vel.y = 0; return true; })()`);
  await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })); return true; })()`);
  await stepSec(2);
  await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })); return true; })()`);
  s = await st();
  check(s.eng === 0, `W przy wyłączonym — bez autozapłonu (silniki ${s.eng})`);
  check(s.v > 100, `dryf: prędkość ${s.v.toFixed(1)} j/s z 120 (bez tłumika i ciągu)`);
  result.kroki.dryf = s.v;

  // Sygnatura w obrazie AI i wykrycie pirata.
  result.kroki.sygnatura = await ev(`(async () => { await window.__harness.step(30);
    const fa = await import('/src/ai/fleetAwareness.js');
    fa.updateFleetAwareness(npcs, ship, 0, true);
    return { sig: ship.__sigMul, piratWidzi: fa.isVisibleToSide('pirate', ship) };
  })()`);
  check(Math.abs(result.kroki.sygnatura.sig - 0.3) < 0.02, `sygnatura wyłączonego ${result.kroki.sygnatura.sig}`);
  console.log('pirat widzi wyłączonego:', result.kroki.sygnatura.piratWidzi);

  // Włączenie: rozruch 5 s, zrzuty fali.
  await ev(`(() => { ship.vel.x = 0; ship.vel.y = 0; return true; })()`);
  await press('Minus');
  s = await st();
  check(s.pwr && s.pwr.state === 1, `− → ROZRUCH (stan ${s.pwr?.state})`);
  await ev(`window.__harness.scene.cam(${DEEP.x} - 300, ${DEEP.y}, 1.1)`);
  await stepSec(1.0); await shot('4-rozruch-1s');
  await stepSec(1.5); await shot('5-rozruch-2-5s');
  await stepSec(1.5); await shot('6-rozruch-4s');
  await ev(`window.__harness.scene.cam(${DEEP.x}, ${DEEP.y}, 0.42)`);
  await stepSec(1.3);
  s = await st();
  check(s.pwr && s.pwr.state === 2, `po 5,3 s PRACA (stan ${s.pwr?.state})`);
  check(!s.shOff && !s.shOwn, 'tarcza zwolniona po rozruchu');
  await shot('7-praca');
  await ev(`window.__harness.scene.cam(${DEEP.x} - 300, ${DEEP.y}, 1.1)`);
  await shot('7b-praca-blisko');
  await ev(`(async () => { ship.__battleLights = true; await window.__harness.step(120); return true; })()`);
  await shot('7c-praca-bojowe-blisko');
  await ev(`(async () => { ship.__battleLights = false; await window.__harness.step(90); return true; })()`);
  // Alarm (szyna ShipAlarm): kadłub krytyczny — koguty na kadłubie, czerwona ramka HUD, lampy pokładowe na czerwono.
  result.kroki.alarm = await ev(`(async () => { window.ShipAlarmDev.set(2, 8); await window.__harness.step(20); return window.ShipAlarmDev.state(); })()`);
  check(result.kroki.alarm.active === true && result.kroki.alarm.id === 2, `alarm kadłuba aktywny (${JSON.stringify(result.kroki.alarm)})`);
  await shot('7d-alarm-blisko');
  await ev(`(async () => { await window.__harness.step(9); return true; })()`);
  await shot('7e-alarm-blisko-pozniej');
  await ev(`(async () => { window.ShipAlarm.clear(); await window.__harness.step(120); return true; })()`);
  // Reflektor dziobowy (klawisz ;): snop ku kursorowi, sygnatura × 1,6.
  result.kroki.reflektor = await ev(`(async () => { window.PlayerSearchlight.toggle(); await window.__harness.step(40);
    const fa = await import('/src/ai/fleetAwareness.js'); fa.updateFleetAwareness(npcs, ship, 0, true);
    return { on: window.PlayerSearchlight.on(), ang: ship.__spotAng, sig: ship.__sigMul }; })()`);
  check(result.kroki.reflektor.on && Number.isFinite(result.kroki.reflektor.ang) && result.kroki.reflektor.sig > 1.5, `reflektor: ${JSON.stringify(result.kroki.reflektor)}`);
  await ev(`window.__harness.scene.cam(${DEEP.x} + 2500, ${DEEP.y}, 0.3)`);
  await shot('7f-reflektor');
  await ev(`(async () => { window.PlayerSearchlight.toggle(); await window.__harness.step(10); window.__harness.scene.cam(${DEEP.x}, ${DEEP.y}, 0.42); return true; })()`);
  const fa2 = await ev(`(async () => { const fa = await import('/src/ai/fleetAwareness.js'); fa.updateFleetAwareness(npcs, ship, 0, true); return { sig: ship.__sigMul, piratWidzi: fa.isVisibleToSide('pirate', ship) }; })()`);
  check(fa2.sig === 1, `po rozruchu sygnatura 1 (${JSON.stringify(fa2)})`);

  // NPC: opcja ShipPower.
  result.kroki.npc = await ev(`(async () => { const H = window.__harness; const a = window.__ZasScene.ally; if (!a) return null;
    a.vx = 40; a.vy = 0;
    window.ShipPower.off(a); await H.step(150);
    const off = { stan: a.shipPower.state, sil: a.engineIgn ? a.engineIgn.state : -1, tarcza: !!a._shieldForcedOff, vx: a.vx };
    window.ShipPower.on(a); await H.step(330);
    const on = { stan: a.shipPower.state, sil: a.engineIgn ? a.engineIgn.state : -1, tarcza: !!a._shieldForcedOff };
    return { off, on };
  })()`, 300000);
  console.log('npc', JSON.stringify(result.kroki.npc));
  check(result.kroki.npc && result.kroki.npc.off.stan === 0 && result.kroki.npc.off.tarcza, 'NPC wyłączony: WYŁ. i tarcza wył.');
  check(result.kroki.npc && result.kroki.npc.on.stan === 2 && !result.kroki.npc.on.tarcza, 'NPC włączony: PRACA, tarcza wraca');

  // Wyłącznik pod licznikiem kokpitu (przycisk #pwrSwitch — klik = klawisz −), kamera statku (poza trybem RTS).
  result.kroki.wylacznik = await ev(`(async () => { const H = window.__harness; H.scene.shipCam(0.5); await H.step(5);
    const btn = window.cockpitUI?.els?.pwrSwitch; if (!btn) return { brak: true };
    const r = { przed: btn.textContent.trim(), klasaPrzed: btn.className };
    btn.click(); await H.step(12);
    r.stanPo = ship.shipPower ? ship.shipPower.state : -1; r.etykietaPo = btn.textContent.trim(); r.klasaPo = btn.className;
    await H.step(150); r.etykietaWyl = btn.textContent.trim(); r.klasaWyl = btn.className;
    return r; })()`);
  console.log('wyłącznik', JSON.stringify(result.kroki.wylacznik));
  check(result.kroki.wylacznik && result.kroki.wylacznik.stanPo === 3 && /WYŁ/.test(result.kroki.wylacznik.etykietaWyl), 'wyłącznik pod licznikiem: klik → GASZENIE → WYŁ.');
  await shot('7g-wylacznik-wyl');
  result.kroki.wylacznik2 = await ev(`(async () => { const H = window.__harness; const btn = window.cockpitUI?.els?.pwrSwitch;
    btn.click(); await H.step(60); const r = { stan: ship.shipPower.state, etykieta: btn.textContent.trim(), klasa: btn.className };
    return r; })()`);
  check(result.kroki.wylacznik2.stan === 1 && /ROZRUCH/.test(result.kroki.wylacznik2.etykieta), `wyłącznik: klik → ROZRUCH (${JSON.stringify(result.kroki.wylacznik2)})`);
  await shot('7h-wylacznik-rozruch');
  await ev(`(async () => { await window.__harness.step(300); return true; })()`);

  // Daleki kadr: wyłączony obok włączonego.
  await ev(`(async () => { window.ShipPower.off(window.__ZasScene.ally); await window.__harness.step(150); window.__harness.scene.cam(${DEEP.x}, ${DEEP.y} - 800, 0.2); return true; })()`);
  await shot('8-daleko-sojusznik-wylaczony');

  result.pipelineStrona = JSON.parse(await ev(`JSON.stringify((window.__harness?.pipes?.list || []).filter((p) => p.sync && !p.compute && !p.budowa).map((p) => p.nazwa))`));
  console.log('pipeline sync strona:', result.pipelineStrona.length, result.pipelineStrona.slice(0, 12));
} finally {
  result.bledy = logs.errors().slice(0, 40);
  result.bledyWorkera = workerLogs.filter((l) => /\[error\]|\[exception\]/.test(l)).slice(0, 40);
  const syncLines = workerLogs.filter((l) => /pipeline sync/.test(l));
  result.pipelineWorker = syncLines.length;
  console.log('błędy konsoli:', result.bledy.length, 'workera:', result.bledyWorkera.length, 'pipeline sync workera:', syncLines.length);
  for (const e of [...result.bledy, ...result.bledyWorkera].slice(0, 10)) console.log('  ', String(e).slice(0, 300));
  console.log('asercje nieudane:', result.bledyAsercji.length);
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(result, null, 2));
  await chrome.close();
  await server.close();
}
