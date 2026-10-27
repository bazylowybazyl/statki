// KONTENERY-ŁUP w PRAWDZIWEJ grze (K1, docs/PROPOZYCJA-kontenery-lup.md): statek ruchu z ładunkiem przy Ziemi
// zestrzelony przez gracza (jednym strzałem — encja bez awansu; railgunem — awansowany NPC) gubi paczki kontenerów,
// wiązka gniazda ZBIÓRKA (Atlas fabrycznie) ściąga je do ładowni, puste gniazdo nie zbiera (podpowiedź HUD).
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu.
//
//   node scripts/webgpu/kontenery-gra.mjs [--query renderWorker=1] [--out .tmp/kontenery] [--port 5463]
//        [--rozgrzewka 1500]
//
// Wynik: <out>/raport.json, zrzuty <out>/*.png (podgląd K1 — paczki i wiązka na kanwie 2D).
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/kontenery');
mkdirSync(out, { recursive: true });
const query = `&${args.query || 'renderWorker=1'}`;
const WARM = Number(args.rozgrzewka || 1500);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5463));
const chrome = await startChrome({ width: 1600, height: 900 });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 20) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { query, etapy: {} };
const workerLogs = [];
let msgId = 900000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const sessionId = msg.params.sessionId;
    for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 4000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 4000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const syncWorker = () => workerLogs.filter((l) => l.includes('pipeline sync')).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''));
const syncPage = () => ev(`(() => { const p = window.__harness && window.__harness.pipes; return p ? p.list.filter((e) => e.sync).map((e) => e.nazwa) : []; })()`);

async function waitGame(seconds) {
  let left = Math.max(1, Math.round(seconds * 60));
  while (left > 0) {
    const n = Math.min(120, left);
    await ev(`window.__harness.step(${n}).then(() => true)`, 600000);
    left -= n;
  }
}
const ZOOM = (z) => `(() => { const c = window.camera; c.minZoom = 0.003; c.manualZoom = true;
  c.zoom = c.targetZoom = c.zoomBase = ${z}; window.DevScene?.syncCamera?.(); return true; })()`;
// Stan łupu: paczki, statystyki, ładownia, komunikaty HUD.
const lootState = () => ev(`(() => {
  const L = window.LootContainers, p = L.pool;
  let units = 0, tractor = 0, cx = 0, cy = 0, vx = 0, vy = 0;
  for (let i = 0; i < p.count; i++) {
    units += p.units[i]; cx += p.x[i] / p.count; cy += p.y[i] / p.count; vx += p.vx[i] / p.count; vy += p.vy[i] / p.count;
    if (p.flags[i] & 1) tractor++;
  }
  return { paczek: p.count, sztuk: units, wWiazce: tractor, srodek: p.count ? { x: cx, y: cy, vx, vy } : null,
    stats: L.stats, ladownia: L.hold, sprzet: L.gear ? { ...L.gear } : null, komunikaty: (window.__lootAlerts || []).slice(-8) };
})()`);
// Cel: statek z manifestem, wolny (postój albo < 250 j./s), najbliżej gracza, poza megafrachtowcem.
const PICK = (minHp) => `(() => {
  const tb = window.TrafficBubble, br = window.TrafficV2, s = window.ship;
  const list = tb.list.filter((a) => a.alive && br.actorManifests.has(a.id) && !(a.flags & (64 | 256))
    && a.hullId !== 'megafreighter' && a.maxHp >= ${minHp} && Math.hypot(a.vx, a.vy) < 250);
  list.sort((a, b) => Math.hypot(a.cx - s.pos.x, a.cy - s.pos.y) - Math.hypot(b.cx - s.pos.x, b.cy - s.pos.y));
  const a = list[0];
  if (!a) return null;
  const earth = br.getStation('earth');
  const ox = a.cx - earth.x, oy = a.cy - earth.y, od = Math.hypot(ox, oy) || 1;
  window.devTeleportTo(a.cx + ox / od * 2500, a.cy + oy / od * 2500, { angle: Math.atan2(-oy, -ox), quiet: true });
  window.ship.vel.x = a.vx; window.ship.vel.y = a.vy;
  return { id: a.id, hull: a.hullId, hp: Math.round(a.hp), maxHp: a.maxHp, phase: a.phase, x: a.cx, y: a.cy, manifest: br.actorManifests.get(a.id) };
})()`;
const FIRE_AT = (id, w) => `(() => {
  const a = window.TrafficBubble.byId.get(${id});
  const npc = (a && a.alive) ? null : (window.TrafficPromotion?.alive.get(${id}) || null);
  if (!(a && a.alive) && !(npc && !npc.dead)) return null;
  const x = npc ? npc.x : a.cx, y = npc ? npc.y : a.cy;
  const s = window.ship;
  const dx = x - s.pos.x, dy = y - s.pos.y, d = Math.hypot(dx, dy) || 1;
  window.fireWeaponCore(s, null, ${JSON.stringify(w)},
    { pos: { x: s.pos.x, y: s.pos.y }, dir: { x: dx / d, y: dy / d }, baseVel: { x: s.vel.x, y: s.vel.y } });
  return npc ? 'npc' : 'encja';
})()`;
// Gracz obok paczek (poza ich chmurą), z ich średnią prędkością (< limitu wiązki).
const NEAR_LOOT = (dist) => `(() => {
  const p = window.LootContainers.pool;
  if (!p.count) return null;
  let cx = 0, cy = 0, vx = 0, vy = 0;
  for (let i = 0; i < p.count; i++) { cx += p.x[i] / p.count; cy += p.y[i] / p.count; vx += p.vx[i] / p.count; vy += p.vy[i] / p.count; }
  window.devTeleportTo(cx + ${dist}, cy, { angle: Math.PI, quiet: true });
  window.ship.vel.x = vx; window.ship.vel.y = vy;
  return { x: cx, y: cy, v: Math.hypot(vx, vy) };
})()`;

async function shootDown(name, weapon, minHp, shots) {
  const target = await ev(PICK(minHp));
  if (!target) return { cel: null };
  await ev(ZOOM(0.25));
  await waitGame(0.5);
  const before = await lootState();
  const kinds = [];
  for (let k = 0; k < shots; k++) {
    const kind = await ev(FIRE_AT(target.id, weapon));
    if (!kind) break;
    kinds.push(kind);
    await waitGame(0.25);
  }
  await waitGame(1.5);
  const after = await lootState();
  await screenshotPng(cdp, join(out, `${name}-zrzut.png`));
  return { cel: target, bron: weapon, strzaly: kinds.length, wNpc: kinds.filter((k) => k === 'npc').length, przed: before, po: after };
}

async function tractorRun(name, seconds) {
  const at = await ev(NEAR_LOOT(1500));
  if (!at) return { paczek: 0 };
  await ev(ZOOM(0.3));
  const t0 = await lootState();
  const rows = [];
  for (let t = 0; t < seconds; t += 2) {
    await waitGame(2);
    const s = await lootState();
    rows.push({ t: t + 2, paczek: s.paczek, wWiazce: s.wWiazce, ladownia: s.ladownia });
    if (t === 2) await screenshotPng(cdp, join(out, `${name}-wiazka.png`));
  }
  const t1 = await lootState();
  await screenshotPng(cdp, join(out, `${name}-koniec.png`));
  return { gracz: at, przed: t0, po: t1, przebieg: rows };
}

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&trafficSeed=7${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  report.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  if (!await waitFor(cdp, '!!(window.TrafficV2 && window.TrafficV2.ready && window.TrafficV2.tables && window.TrafficV2.tables.bubblePorts && window.TrafficV2.tables.bubblePorts.earth)', 120000, 300)) throw new Error('ruch v2 nie wstał');
  report.syncStart = syncWorker();
  report.syncStronaStart = await syncPage();
  // Komunikaty HUD (pushZoneMessage → hudSystem.pushAlert) do raportu.
  await ev(`(() => { window.__lootAlerts = []; const h = window.hudSystem; if (h && h.pushAlert && !h.__lootWrapped) {
    const f = h.pushAlert.bind(h); h.pushAlert = (t, o) => { window.__lootAlerts.push(String(t)); return f(t, o); }; h.__lootWrapped = true; }
    return true; })()`);
  await ev('window.__harness.hold(true)');
  console.log('tryb', report.tryb);

  const tw0 = Date.now();
  await ev(`(async () => { for (let i = 0; i < ${Math.ceil(WARM / 5)}; i++) { window.TrafficV2.advance(5); if (i % 40 === 39) await new Promise((r) => setTimeout(r, 0)); } return true; })()`, 600000);
  if (!await waitFor(cdp, `(window.TrafficV2.clock || 0) >= ${WARM - 30}`, 600000, 500)) throw new Error('worker ruchu nie nadrobił rozgrzewki');
  console.log('rozgrzewka świata', WARM, 's w', Date.now() - tw0, 'ms');

  report.spot = await ev(`(() => {
    const berths = window.TrafficV2.tables.bubblePorts.earth;
    const earth = window.TrafficV2.getStation('earth');
    const b = berths.find((x) => x.hall === 'ZATOKA') || berths[0];
    const dx = b.x - earth.x, dy = b.y - earth.y, d = Math.hypot(dx, dy);
    window.devTeleportTo(b.x + dx / d * 7000, b.y + dy / d * 7000, { angle: Math.atan2(-dy, -dx), quiet: true });
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return { berth: b.id };
  })()`);
  await ev(ZOOM(0.045));
  await waitGame(6);
  report.manifesty = await ev(`(() => { const m = [...window.TrafficV2.actorManifests.values()];
    return { encji: window.TrafficBubble.list.length, zManifestem: m.length, przyklad: m.slice(0, 3) }; })()`);
  console.log('manifesty', JSON.stringify(report.manifesty));

  // 1) Jeden strzał superbroni: encja bez awansu → wybuch, paczki z manifestu, kara reputacji.
  const superWeapon = await ev(`(() => { const W = window.MASTER_WEAPONS || {};
    const ids = Object.keys(W).filter((k) => !W[k].npcOnly && (W[k].baseDamage || 0) >= 5000);
    return ids.sort((a, b) => (W[b].baseDamage || 0) - (W[a].baseDamage || 0))[0] || null; })()`);
  report.etapy.bezAwansu = await shootDown('01-bez-awansu', superWeapon, 0, 3);
  console.log('bez awansu:', JSON.stringify({ cel: report.etapy.bezAwansu.cel?.hull, manifest: report.etapy.bezAwansu.cel?.manifest,
    paczek: report.etapy.bezAwansu.po?.paczek, sztuk: report.etapy.bezAwansu.po?.sztuk }));

  // 2) Wiązka Atlasa (fabrycznie): gracz 1,5 km od paczek, 24 s gry.
  report.etapy.wiazka = await tractorRun('02', 24);
  console.log('wiązka:', JSON.stringify({ przed: report.etapy.wiazka.przed?.ladownia, po: report.etapy.wiazka.po?.ladownia,
    paczek: report.etapy.wiazka.po?.paczek, stats: report.etapy.wiazka.po?.stats, komunikaty: report.etapy.wiazka.po?.komunikaty }));

  // 3) Puste gniazdo ZBIÓRKA: nic nie wchodzi, HUD podpowiada WYPOSAŻENIE.
  await ev(`(() => { window.LootContainers.devSpill({ chips: 60, steel: 200 }, 2500); return window.PlayerFit.setLootGear(null); })()`);
  report.etapy.pusteGniazdo = await tractorRun('03-puste', 12);
  await ev(`window.PlayerFit.setLootGear('loot_tractor')`);
  console.log('puste gniazdo:', JSON.stringify({ sprzet: report.etapy.pusteGniazdo.po?.sprzet, przed: report.etapy.pusteGniazdo.przed?.ladownia,
    po: report.etapy.pusteGniazdo.po?.ladownia, komunikaty: report.etapy.pusteGniazdo.po?.komunikaty }));

  // 4) Awansowany NPC: railgun aż do śmierci — paczki z kopii manifestu na NPC.
  const rail = await ev(`(() => { const W = window.MASTER_WEAPONS || {};
    if (W.special_valkyrie_railgun) return 'special_valkyrie_railgun';
    const ids = Object.keys(W).filter((k) => W[k].category === 'rail' && !W[k].npcOnly && (W[k].baseDamage || 0) <= 600);
    return ids.sort((a, b) => (W[b].baseDamage || 0) - (W[a].baseDamage || 0))[0] || null; })()`);
  report.etapy.awans = await shootDown('04-awans', rail, 1000, 120);
  report.etapy.awans.promocja = await ev('({ ...window.TrafficPromotion.stats })');
  console.log('awans:', JSON.stringify({ cel: report.etapy.awans.cel?.hull, strzaly: report.etapy.awans.strzaly, wNpc: report.etapy.awans.wNpc,
    promocja: report.etapy.awans.promocja, paczekPrzed: report.etapy.awans.przed?.paczek, paczekPo: report.etapy.awans.po?.paczek }));

  report.syncKoniec = syncWorker();
  report.syncStronaKoniec = await syncPage();
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(report.blad);
} finally {
  report.bledyStrony = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
  report.bledyWorkera = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
  console.log('pipeline sync workera: start', report.syncStart?.length ?? '-', '| koniec', report.syncKoniec?.length ?? '-');
  console.log('pipeline sync strony: start', report.syncStronaStart?.length ?? '-', '| koniec', report.syncStronaKoniec?.length ?? '-');
  console.log('błędy strony', report.bledyStrony.length, '| workera', report.bledyWorkera.length);
  for (const l of [...report.bledyStrony, ...report.bledyWorkera].slice(0, 8)) console.log('  ', l.slice(0, 300));
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
clearTimeout(guard);
process.exit(0);
