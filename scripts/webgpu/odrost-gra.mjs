// Odrost zniszczonych węzłów kadłuba (src/game/hullBodies.js § ODROST: regrowCandidates / regrowCell / restoreHull)
// w PRAWDZIWEJ grze: Vite + headless Chrome z GPU (CDP), strona harnessu (zegar wirtualny, klatki na żądanie).
// Atlas gracza w pustce dostaje kratery na miarę rany (Yamato, armata, Goliath) i rzaz przez rufę (odcięta sekcja —
// wrak odsunięty, żeby nie stał w miejscu odrostu), potem:
//  A) FRONT ODROSTU jak przyszły rój dronów: naprawa R prostuje wgniecenia, co klatkę regrowCell kilkudziesięciu
//     komórek frontu (regrowCandidates) — czas CPU, komórki na klatkę; na końcu mapa ran wyleczona
//     (HullDamageMap.heal — dziś rany po odroście zostają, czyści je dopiero remont),
//  B) REMONT W DOKU: hangar stacji, przycisk „Napraw” (handleRepair → HullBodies.restoreHull + pełne punkty).
// Sprawdza: udział żywych węzłów wraca do 1, punkty kadłuba pełne i sufit konstrukcji (enforceNpcHexIntegrityBalance
// w krokach fizyki) ich nie cofa, skóra bez dziur (obraz po odroście ≈ obraz nietkniętego kadłuba: różnica pikseli
// w obrysie kadłuba na poziomie szumu klatek, uszkodzonego — wyraźna), pipeline'y tworzone synchronicznie w klatkach
// odrostu i remontu (ma być 0), błędy konsoli. --modele 1 — to samo w wariancie „Statki 3D” (skóra modelu).
//
//   node scripts/webgpu/odrost-gra.mjs [--out .tmp/odrost/gra] [--rozmiar 1600x900] [--zoom 0.42] [--modele 0]
//        [--na-klatke 40]
//
// Wynik: <out>/*.png, <out>/raport.json.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';
import { decodePng } from './png.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const zoom = Number(args.zoom || 0.42);
const models = args.modele === '1';
const perFrame = Math.max(1, Number(args['na-klatke'] || 40) | 0);
const out = resolve(repo, args.out || (models ? '.tmp/odrost/gra-modele' : '.tmp/odrost/gra'));
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { server, base } = await startVite(Number(args.port || 5397));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { ustawienia: { W, H, zoom, modele: models, naKlatke: perFrame }, zrzuty: {}, porownania: {} };

// Stan kadłuba gracza: udział żywych węzłów, punkty i sufit konstrukcji, magazyn, wraki rodu.
const STATE = `(() => {
  const s = window.ship, h = s.beamHull, st = window.HullBodies.structuralState(s) || {};
  const cap = s.hull.max * Math.pow(Math.max(0, Math.min(1, st.ratio ?? 0)), 2.35);
  return { udzial: +(st.ratio ?? -1).toFixed(5), zywe: st.active, wezly: st.total, magazyn: h?.body.nodeStore.count,
    punkty: +s.hull.val.toFixed(2), max: s.hull.max, sufit: +cap.toFixed(2), zniszczony: !!s.destroyed,
    rewizja: h?.revision, wrakiRodu: (window.wrecks || []).filter((w) => !w.dead && w.beamHull?.dmgKey === h?.dmgKey).length };
})()`;

// Poza gracza i kamera RTS jak przy nietkniętym kadłubie (trafienia i rzaz pchają statek) — zrzuty porównywalne.
// Odłamki zniszczonych węzłów (hullDebris3D) wygaszone jak po końcu życia: statek stoi, więc odłamki rzazu wisiałyby
// wzdłuż linii cięcia i w porównaniu obrazu udawały szew skóry.
const POSE = `(() => {
  const s = window.ship, p = window.__odrostPose;
  s.pos.x = s.x = p.x; s.pos.y = s.y = p.y; s.vel.x = s.vx = 0; s.vel.y = s.vy = 0; s.angle = p.a; s.angVel = 0;
  window.__harness.scene.cam(p.x, p.y, ${zoom});
  for (const b of window.HullDebris3D?.batches || []) { b.alive = 0; b.cursor = 0; b.highWater = 0; b.geometry.instanceCount = 0; b.mesh.visible = false; }
  return true;
})()`;

async function shot(name, opis) {
  await ev(POSE);
  await ev('window.__harness.step(2)');
  await ev(POSE);
  await ev('(async () => { await window.__harness.frames(4); return true; })()');
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...(await ev(STATE)) };
  console.log('zrzut', name.padEnd(22), JSON.stringify(report.zrzuty[name]));
}

// Kratery na miarę rany (punkt wejścia z sondy od burty) i rzaz przez rufę; wraki rodu odsunięte.
const DAMAGE = `(() => {
  const HB = window.HullBodies, M = window.HullDamageMap, s = window.ship;
  const a = s.angle || 0, c = Math.cos(a), sn = Math.sin(a);
  const hit = (along, side, dmg, weapon, craterR) => {
    const nx = -sn * side, ny = c * side, px = s.pos.x + c * along, py = s.pos.y + sn * along, L = 1200;
    const sw = HB.sweep(s, px + nx * L, py + ny * L, px - nx * L, py - ny * L, 0);
    if (!sw) return 0;
    M.setSource(weapon);
    try { HB.impact(s, sw.worldX, sw.worldY, dmg, { x: -nx * 2000, y: -ny * 2000 }, { craterRadius: craterR }); }
    finally { M.clearSource(); }
    return HB.impactResult.killed;
  };
  let killed = 0;
  killed += hit(-430, 1, 1400, 'special_yamato_cannon', 60);
  killed += hit(-150, -1, 1400, 'special_yamato_cannon', 55);
  killed += hit(160, 1, 300, 'armata_mk1', 30);
  killed += hit(380, -1, 300, 'armata_mk1', 34);
  killed += hit(600, 1, 900, 'special_goliath_autocannon', 42);
  const tail = -(s.beamHull.radius || 900) * 0.7;
  const tx = s.pos.x + c * tail, ty = s.pos.y + sn * tail;
  const cut = HB.cutSegment(s, tx - sn * 1200, ty + c * 1200, tx + sn * 1200, ty - c * 1200, 22);
  return { zabiteKratery: killed, rzaz: cut };
})()`;
const MOVE_WRECKS = `(() => {
  const key = window.ship.beamHull.dmgKey; let n = 0;
  for (const w of window.wrecks || []) {
    if (w.dead || w.beamHull?.dmgKey !== key) continue;
    w.x += 30000; w.y += 30000; w.vx = 0; w.vy = 0; w.angVel = 0; n++;
  }
  return n;
})()`;

async function damage(tag) {
  const r = await ev(DAMAGE);
  await ev('window.__harness.step(30)');           // rozpad (co 10 kroków silnika) i sufit punktów (co 3. podkrok)
  r.odsunieteWraki = await ev(MOVE_WRECKS);
  await ev('window.__harness.step(4)');
  report[`uszkodzenia${tag}`] = { ...r, ...(await ev(STATE)) };
  console.log('uszkodzenia', tag, JSON.stringify(report[`uszkodzenia${tag}`]));
}

// Różnica obrazów w kwadracie wokół środka kadru (kadłub): udział pikseli > próg i średnia różnica.
function diff(a, b, halfPx) {
  const A = decodePng(readFileSync(join(out, `${a}.png`))), B = decodePng(readFileSync(join(out, `${b}.png`)));
  const cx = A.width >> 1, cy = A.height >> 1;
  const x0 = Math.max(0, cx - halfPx), x1 = Math.min(A.width, cx + halfPx);
  const y0 = Math.max(0, cy - halfPx), y1 = Math.min(A.height, cy + halfPx);
  let n = 0, over = 0, sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * A.width + x) * 4;
      const d = Math.max(Math.abs(A.data[o] - B.data[o]), Math.abs(A.data[o + 1] - B.data[o + 1]), Math.abs(A.data[o + 2] - B.data[o + 2]));
      n++; sum += d; if (d > 12) over++;
    }
  }
  return { ponadProg: +(over / n * 100).toFixed(3) + '%', srednia: +(sum / n).toFixed(3) };
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x0d0157};
(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();
${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness && window.setVisualMode)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { window.setVisualMode(${models}, false); document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');

  // Scena: Atlas w pustce, bez HUD; kadłub gracza buduje się od nowa po wczytaniu sprite'a — czekamy, aż klucz
  // mapy ran stoi przez 60 klatek.
  report.start = await ev(`(async () => {
    const S = window.__harness.scene, H = window.__harness; H.reseed(0x0d0157); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = window.ship;
    let key = s.beamHull?.dmgKey, stable = 0;
    for (let it = 0; it < 1200 && stable < 60; it++) {
      await H.step(2);
      const k = s.beamHull?.dmgKey;
      stable = (k && k === key && s.spriteReady) ? stable + 2 : 0;
      key = k;
    }
    window.__odrostPose = { x: s.pos.x, y: s.pos.y, a: s.angle || 0 };
    const h = s.beamHull;
    return { kadlub: !!h, klucz: h?.dmgKey, wezly: h?.body.activeNodes, keepLayout: h?.body.keepLayout, punkty: s.hull.val,
      max: s.hull.max, promien: Math.round(h?.radius || 0), model3D: ${models} };
  })()`, 300000);
  console.log('start', JSON.stringify(report.start));
  const halfPx = Math.min(H >> 1, Math.round((report.start.promien || 900) * zoom));

  await shot('00-nietkniety', 'Atlas nietknięty (odniesienie)');
  await ev('window.__harness.step(20)');
  await shot('00b-nietkniety-2', 'Atlas nietknięty, drugi zrzut po 20 klatkach (szum klatek)');

  // ---------- A) front odrostu ----------
  await damage('A');
  await shot('01-uszkodzony', 'Kratery (Yamato, armata, Goliath) i odcięta rufa; punkty na suficie konstrukcji');
  report.naprawaR = await ev(`(() => {
    const H = window.__harness, t0 = H.realNow(); let steps = 0;
    while (window.HullBodies.repair([window.ship], 1 / 60) && steps < 4000) steps++;
    return { kroki: steps, ms: +(H.realNow() - t0).toFixed(1) };
  })()`);
  const begA = await ev('window.__harness.frameLog.n');
  const frames = [];
  for (let f = 0; f < 400; f++) {
    const r = await ev(`(async () => {
      const HB = window.HullBodies, s = window.ship, H = window.__harness;
      const list = window.__odrostOut || (window.__odrostOut = []);
      const t0 = H.realNow();
      const front = HB.regrowCandidates(s, list);
      const t1 = H.realNow();
      let grown = 0;
      for (let k = 0; k < list.length && grown < ${perFrame}; k += 2) if (HB.regrowCell(s, list[k], list[k + 1])) grown++;
      const t2 = H.realNow();
      await H.frames(1);
      return { front, grown, frontMs: +(t1 - t0).toFixed(3), odrostMs: +(t2 - t1).toFixed(3) };
    })()`);
    frames.push(r);
    if (frames.length === 6) await shot('02-odrost-w-trakcie', `Front odrostu po ${frames.reduce((a, x) => a + x.grown, 0)} komórkach (${perFrame} na klatkę)`);
    if (r.front === 0 || r.grown === 0) break;
  }
  report.frontA = {
    klatki: frames.length, odrosle: frames.reduce((a, x) => a + x.grown, 0),
    frontMsMaks: Math.max(...frames.map((x) => x.frontMs)), odrostMsMaks: Math.max(...frames.map((x) => x.odrostMs)),
    odrostMsSrednio: +(frames.reduce((a, x) => a + x.odrostMs, 0) / Math.max(1, frames.length)).toFixed(3),
    pipeline: (await ev(`window.__harness.frameStats(${begA})`)).pipeline
  };
  console.log('front A', JSON.stringify(report.frontA));
  await shot('03-po-froncie', 'Po froncie odrostu: konstrukcja cała, rany z mapy ran zostają (dno leja, osmalenie)');
  await ev('(() => { window.HullDamageMap.heal(window.ship.beamHull.dmgKey, 1); return true; })()');
  await ev('window.__harness.step(10)');
  await shot('04-po-froncie-bez-ran', 'Po froncie odrostu i wyleczeniu mapy ran — jak nietknięty');
  await ev('window.__harness.step(120)');
  report.poFrontachKroki = await ev(STATE);

  // ---------- B) remont w doku ----------
  await damage('B');
  await shot('05-uszkodzony-2', 'Drugie uszkodzenia (te same kratery i rzaz) przed remontem');
  const begB = await ev('window.__harness.frameLog.n');
  report.dok = await ev(`(async () => {
    const H = window.__harness, s = window.ship;
    window.DevAddCredits?.(50000);
    const station = (window.stations || []).find((st) => st && st.factionId == null) || { id: 'odrost-test', name: 'Test', factionId: null };
    window.openStationUI(station, 'hangar');
    await H.frames(4);
    const btn = document.querySelector('#tab-hangar button[data-hangar-action="repair"]');
    const before = { punkty: s.hull.val, kredyty: window.DevEconomy?.getCredits?.() };
    const t0 = H.realNow();
    if (btn) btn.click();
    const ms = +(H.realNow() - t0).toFixed(2);
    const after = { punkty: s.hull.val, kredyty: window.DevEconomy?.getCredits?.() };
    window.closeStationUI();
    await H.frames(2);
    return { przycisk: !!btn, wylaczony: !!btn?.disabled, ms, przed: before, po: after };
  })()`);
  report.dok.pipeline = (await ev(`window.__harness.frameStats(${begB})`)).pipeline;
  console.log('dok', JSON.stringify(report.dok));
  await ev('window.__harness.step(10)');
  await shot('06-po-doku', 'Po remoncie w doku: kadłub = szablon, mapa ran wyczyszczona, punkty pełne');
  await ev('window.__harness.step(180)');
  report.poDokuKroki = await ev(STATE);
  console.log('po doku + 3 s fizyki', JSON.stringify(report.poDokuKroki));

  report.porownania = {
    szum: diff('00-nietkniety', '00b-nietkniety-2', halfPx),
    uszkodzony: diff('00-nietkniety', '01-uszkodzony', halfPx),
    poFroncie: diff('00-nietkniety', '03-po-froncie', halfPx),
    poFroncieBezRan: diff('00-nietkniety', '04-po-froncie-bez-ran', halfPx),
    uszkodzony2: diff('00-nietkniety', '05-uszkodzony-2', halfPx),
    poDoku: diff('00-nietkniety', '06-po-doku', halfPx)
  };
  console.log('porównania (kwadrat ±' + halfPx + ' px):', JSON.stringify(report.porownania));
  report.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  report.blad = String(err?.stack || err);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
