// Lampki gotowości przy wieżach broni w PRAWDZIWEJ grze (decyzja użytkownika 2026-11-11: „zielona gotowa, bursztynowa
// przy przeładowaniu, czerwona pusta — z góry dobrze widoczne”; src/data/turretReadyLamp.js). Atlas gracza i pancernik
// Terra Novy (eskorta) w głębokim kosmosie, kadr bliski na każdy okręt i kadr ogólny:
//   1 gotowe — wszystkie wieże naładowane (zielone);
//   2 przeładowanie — stan po salwie: działa główne i specjalne gracza, wszystkie wieże NPC w przeładowaniu (bursztyn);
//   3 pusta — magazynki na zero (czerwone);
//   4 mieszane — co trzecia wieża: gotowa / przeładowanie / pusta (porównanie barw obok siebie);
//   5 wyłączony — oba okręty bez zasilania: bez lampek, akcenty wież przygaszone;
//   6 po rozruchu — lampki wracają.
// Na każdym etapie: kody lampek z rekordów wież (strona gry, oba tryby), w trybie `off` także pula lampek i akcenty
// partii wież (Core3D strony); pipeline'y synchroniczne strony i workera (ma być 0).
//
//   node scripts/webgpu/lampki-wiez-gra.mjs [--out .tmp/webgpu/lampki-wiez-gra] [--port 5366] [--query renderWorker=1]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const port = Number(args.port || 5366);
const query = args.query ? `&${args.query}` : '';
const out = resolve(repo, args.out || '.tmp/webgpu/lampki-wiez-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };
const ZOOM_NEAR = Number(args.zoom || 0.9);
const ZOOM_FAR = Number(args.daleko || 0.42);

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

const result = { tryb: args.query || 'off', etapy: {}, zrzuty: [], bledyAsercji: [] };
const check = (ok, what) => { if (!ok) result.bledyAsercji.push(what); console.log(ok ? 'OK  ' : 'BŁĄD', what); };
const WORKER = /renderWorker=1/.test(args.query || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await ev('window.__harness.frames(4)');
  if (WORKER) {
    // Worker renderuje strony asynchronicznie, a strona składa bitmapę dopiero w następnych klatkach (FramePacer) —
    // przy stojącym czasie gry: przerwa na render workera i kilka klatek na złożenie (inaczej zrzut z kadru poprzedniego).
    await sleep(600);
    await ev('window.__harness.frames(4)');
    await sleep(300);
    await ev('window.__harness.frames(3)');
  }
  const file = join(out, `${name}.png`);
  await screenshotPng(cdp, file);
  result.zrzuty.push(name);
};
const stepSec = (s) => ev(`window.__harness.step(${Math.round(s * 60)})`, 300000);

// Stan lampek: kody z rekordów Turret2D tej klatki (strona gry) i — w trybie off — pula lampek i akcenty partii wież.
const STAN = `(async () => {
  await window.__harness.frames(2);
  const T = (await import('/src/vfx/turret2D.js')).Turret2D;
  const hist = (e) => { const h = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }; for (const r of (T.recordsFor(e) || [])) h[r.ready] = (h[r.ready] || 0) + 1; return h; };
  const S = window.__LampScene;
  const C = window.Core3D, sc = C && C.scene;
  let lamps = null, glow = null;
  if (sc && C.renderer) {
    const m = sc.children.find((c) => c.name === 'wieże 3D: lampki gotowości');
    lamps = m ? { n: m.visible ? m.geometry.instanceCount : 0 } : { n: 0 };
    let lo = Infinity, hi = -Infinity, n = 0;
    for (const b of sc.children) {
      if (!b.name || !b.name.startsWith('wieże 3D: ') || b === m || !b.visible) continue;
      const g = b.geometry, a = g.getAttribute('iTurLook');
      if (!a) continue;
      for (let i = 0; i < g.instanceCount; i++) { const v = a.data.array[i * a.data.stride + a.offset]; lo = Math.min(lo, v); hi = Math.max(hi, v); n++; }
    }
    glow = n ? { n, min: +lo.toFixed(3), max: +hi.toFixed(3) } : null;
  }
  return { gracz: hist(ship), npc: S.ally ? hist(S.ally) : null, lamps, glow,
    pwr: [ship.shipPower ? ship.shipPower.state : 2, S.ally && S.ally.shipPower ? S.ally.shipPower.state : 2] };
})()`;

// Kadry: bliski na Atlasa, bliski na NPC, ogólny.
async function kadry(etap) {
  const pos = await ev(`(() => { const a = window.__LampScene.ally; return { sx: ship.pos.x, sy: ship.pos.y, ax: a ? a.x : 0, ay: a ? a.y : 0 }; })()`);
  await ev(`window.__harness.scene.cam(${pos.sx}, ${pos.sy}, ${ZOOM_NEAR})`);
  await shot(`${etap}-atlas`);
  if (pos.ax) {
    await ev(`window.__harness.scene.cam(${pos.ax}, ${pos.ay}, ${ZOOM_NEAR})`);
    await shot(`${etap}-npc`);
  }
  await ev(`window.__harness.scene.cam(${(pos.sx + (pos.ax || pos.sx)) / 2}, ${(pos.sy + (pos.ay || pos.sy)) / 2}, ${ZOOM_FAR})`);
  await shot(`${etap}-ogolny`);
  if (etap.startsWith('4-')) {
    // daleki kadr (LOD lampek: małe wieże bez lampki, duże jeszcze z nią)
    await ev(`window.__harness.scene.cam(${(pos.sx + (pos.ax || pos.sx)) / 2}, ${(pos.sy + (pos.ay || pos.sy)) / 2}, ${ZOOM_FAR * 0.5})`);
    await shot(`${etap}-daleko`);
  }
  const s = await ev(STAN);
  result.etapy[etap] = s;
  console.log(etap, JSON.stringify(s));
  return s;
}

// Przestawienia stanu broni (jak po salwie / przy pustym magazynku) — wprost na polach, które czyta kod lampki gry.
const SET = (body) => ev(`(() => { const S = window.__LampScene; const P = ship.weapons || {};
  const slots = [...(P.main || []), ...(P.special || []), ...(P.missile || []), ...(P.special_missile || []), ...(P.aux || [])].filter((s) => s && s.weapon && s.hp);
  const npcW = (S.ally && S.ally.autoWeapons) || [];
  ${body}
  return { slots: slots.length, npc: npcW.length };
})()`);

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
  // Pipeline'y sprzed tej chwili (menu, ekran ładowania, mapa otoczenia modeli) — osobno od tych z klatek gry.
  result.pipesStart = await ev('(window.__harness?.pipes?.list || []).length');

  // Atlas w głębokim kosmosie, pancernik Terra Novy (eskorta — mózg i wieże NPC) 1,6 km obok, bez wrogów.
  result.scena = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x1a3b);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    ship.angle = 0; if (ship.vel) { ship.vel.x = 0; ship.vel.y = 0; }
    const spawn = (key, mode, x, y) => { const before = new Set(npcs); spawnCallInShip(key, { mode, pos: { x, y }, spawnPos: { x, y }, spawnAngle: 0 }); return npcs.find((n) => !before.has(n)); };
    const ally = spawn('battleship', 'friendly', ${DEEP.x} + 200, ${DEEP.y} - 1700);
    window.__LampScene = { ally };
    for (let it = 0; it < 400 && !S.hullsReady(); it++) await H.frames(2);
    await H.step(150);
    return { ally: !!ally, wiezeNpc: ally && ally.autoWeapons ? ally.autoWeapons.length : 0 };
  })()`, 300000);
  console.log('scena', JSON.stringify(result.scena));
  check(result.scena.ally && result.scena.wiezeNpc > 0, `NPC z wieżami (${result.scena.wiezeNpc})`);

  // 1 — gotowe
  await SET(`for (const s of slots) { s.hp.fcCd = 0; s.hp.specialCd = 0; s.hp.missileCd = 0; }
    for (const c of (ship.ciws || [])) c.cd = 0; for (const w of npcW) w.cd = -1;`);
  let s = await kadry('1-gotowe');
  check(s.gracz[1] > 0 && !s.gracz[2] && !s.gracz[4], `gracz: zielone ${JSON.stringify(s.gracz)}`);
  check(s.npc && s.npc[1] > 0 && !s.npc[4], `NPC: zielone ${JSON.stringify(s.npc)}`);
  if (s.lamps) check(s.lamps.n === (s.gracz[1] + s.gracz[2] + s.gracz[3] + (s.npc ? s.npc[1] + s.npc[2] + s.npc[3] : 0)) || s.lamps.n > 0, `pula lampek (off): ${s.lamps.n}`);

  // 2 — przeładowanie po salwie
  await SET(`for (const s of slots) { const cd = Math.max(1, Number(s.weapon.cooldown) || 1) * 0.9; if (P.main && P.main.includes(s)) s.hp.fcCd = cd; s.hp.specialCd = cd; s.hp.missileCd = cd; }
    for (const w of npcW) w.cd = Math.max(4, (Number(w.def.cooldown) || 2) * 0.9);`);
  s = await kadry('2-przeladowanie');
  check(s.gracz[2] > 0, `gracz: bursztynowe ${JSON.stringify(s.gracz)}`);
  check(s.npc && s.npc[2] > 0, `NPC: bursztynowe ${JSON.stringify(s.npc)}`);

  // 3 — pusta (magazynki na zero)
  await SET(`window.__LampAmmo = { p: slots.map((s) => s.hp.ammo), n: npcW.map((w) => w.ammo) };
    for (const s of slots) { s.hp.fcCd = 0; s.hp.specialCd = 0; s.hp.missileCd = 0; s.hp.ammo = 0; }
    for (const c of (ship.ciws || [])) c.cd = 0; for (const w of npcW) { w.cd = -1; w.ammo = 0; }`);
  s = await kadry('3-pusta');
  check(s.gracz[3] > 0 && !s.gracz[1] && !s.gracz[2], `gracz: czerwone ${JSON.stringify(s.gracz)}`);
  check(s.npc && s.npc[3] > 0 && !s.npc[1], `NPC: czerwone ${JSON.stringify(s.npc)}`);

  // 4 — mieszane: co trzecia wieża gotowa / przeładowanie / pusta
  await SET(`const A = window.__LampAmmo;
    slots.forEach((s, i) => { s.hp.ammo = i % 3 === 2 ? 0 : A.p[i]; const cd = i % 3 === 1 ? Math.max(1, Number(s.weapon.cooldown) || 1) : 0; if (P.main && P.main.includes(s)) s.hp.fcCd = cd; s.hp.specialCd = cd; s.hp.missileCd = cd; });
    (ship.ciws || []).forEach((c) => { c.cd = 0; });
    npcW.forEach((w, i) => { w.ammo = i % 3 === 2 ? 0 : A.n[i]; w.cd = i % 3 === 1 ? 4 : -1; });`);
  s = await kadry('4-mieszane');
  check(s.npc && s.npc[1] > 0 && s.npc[2] > 0 && s.npc[3] > 0, `NPC: trzy barwy ${JSON.stringify(s.npc)}`);

  // 5 — wyłączony okręt (gracz i NPC): bez lampek, akcenty przygaszone
  await SET(`const A = window.__LampAmmo; slots.forEach((s, i) => { s.hp.ammo = A.p[i]; }); npcW.forEach((w, i) => { w.ammo = A.n[i]; w.cd = -1; });`);
  await ev(`(async () => { window.PlayerPower.off(); window.ShipPower.off(window.__LampScene.ally); await window.__harness.step(150); return true; })()`);
  s = await kadry('5-wylaczony');
  check(s.pwr[0] === 0 && s.pwr[1] === 0, `oba WYŁ. (${s.pwr})`);
  check(!s.gracz[1] && !s.gracz[2] && !s.gracz[3] && s.gracz[4] > 0, `gracz: bez lampek ${JSON.stringify(s.gracz)}`);
  check(s.npc && !s.npc[1] && !s.npc[2] && !s.npc[3] && s.npc[4] > 0, `NPC: bez lampek ${JSON.stringify(s.npc)}`);
  if (s.lamps) check(s.lamps.n === 0, `pula lampek pusta (off): ${s.lamps.n}`);
  if (s.glow) check(s.glow.max < 0.2, `akcenty wież przygaszone (off): ${JSON.stringify(s.glow)}`);

  // 6 — po rozruchu
  await ev(`(async () => { window.PlayerPower.on(); window.ShipPower.on(window.__LampScene.ally); await window.__harness.step(345); return true; })()`);
  await SET(`for (const s of slots) { s.hp.fcCd = 0; s.hp.specialCd = 0; s.hp.missileCd = 0; } for (const c of (ship.ciws || [])) c.cd = 0; for (const w of npcW) w.cd = -1;`);
  s = await kadry('6-po-rozruchu');
  check(s.pwr[0] === 2 && s.pwr[1] === 2, `oba w PRACY (${s.pwr})`);
  check(s.gracz[1] > 0 && !s.gracz[4], `gracz: lampki wróciły ${JSON.stringify(s.gracz)}`);
  if (s.glow) check(s.glow.min > 0.9, `akcenty wież świecą (off): ${JSON.stringify(s.glow)}`);

  const pipes = JSON.parse(await ev(`JSON.stringify((window.__harness?.pipes?.list || []).map((p, i) => ({ i, nazwa: p.nazwa, sync: !!p.sync && !p.compute && !p.budowa })))`));
  result.pipelineStronaPrzedGra = pipes.filter((p) => p.sync && p.i < result.pipesStart).map((p) => p.nazwa);
  result.pipelineStrona = pipes.filter((p) => p.sync && p.i >= result.pipesStart).map((p) => p.nazwa);
  console.log('pipeline sync strona w grze:', result.pipelineStrona.length, result.pipelineStrona.slice(0, 12),
    '| przed grą (menu, ładowanie):', result.pipelineStronaPrzedGra.length, result.pipelineStronaPrzedGra.slice(0, 6));
  check(result.pipelineStrona.length === 0, `pipeline'y synchroniczne strony w klatkach gry: ${result.pipelineStrona.length}`);
} finally {
  result.bledy = logs.errors().slice(0, 40);
  result.bledyWorkera = workerLogs.filter((l) => /\[error\]|\[exception\]/.test(l)).slice(0, 40);
  const syncLines = workerLogs.filter((l) => /pipeline sync/.test(l));
  result.pipelineWorker = syncLines.length;
  result.pipelineWorkerLista = syncLines.slice(0, 20);
  console.log('błędy konsoli:', result.bledy.length, 'workera:', result.bledyWorkera.length, 'pipeline sync workera:', syncLines.length);
  for (const e of [...result.bledy, ...result.bledyWorkera].slice(0, 10)) console.log('  ', String(e).slice(0, 300));
  console.log('asercje nieudane:', result.bledyAsercji.length);
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(result, null, 2));
  await chrome.close();
  await server.close();
}
