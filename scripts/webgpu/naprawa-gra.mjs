// Rój dronów naprawczych (src/game/repairRig.js, src/game/repairSwarm.js, obraz src/3d/repair/) w PRAWDZIWEJ grze:
// Vite + headless Chrome z GPU (CDP), strona harnessu (zegar wirtualny, klatki na żądanie).
// Atlas gracza w pustce dostaje kratery na miarę rany (Yamato, armata, Goliath) i rzaz przez rufę (odcięta sekcja —
// wrak odsunięty), w ładowni zapas materiału (złom + stal), potem klawisz R (prawdziwe zdarzenie klawiatury → akcja
// 'ship.repair'):
//   • drony startują z doku na grzbiecie, prostują wgniecenia, spawają łaty (zrzuty w trakcie i zbliżenie spawania),
//   • co sekundę: udział żywych węzłów, punkty kadłuba, materiał (komórki), drony w powietrzu / przy pracy, postęp,
//   • ostrzał drona prawdziwym pociskiem wroga (window.aiSpawnBullet — pętla pocisków gry, repairDroneBulletHit): przy
//     działającej tarczy pocisk i wybuch nie ranią drona, przy zgaszonej — dron zestrzelony,
//   • koszt CPU kroku rojów (RepairSwarm.step w physicsStep) i rysunku (syncRepairDrones3D), pipeline'y tworzone
//     synchronicznie w klatkach roju (ma być 0), błędy konsoli,
//   • po naprawie: łaty (podkład ze spawami) i A/B łata ↔ farba (HULL_PATCH.uOn = 0 — ten sam kadr farbą sprite'a),
//   • drugie R w trakcie (powrót do doku) i ponowny start.
//
//   node scripts/webgpu/naprawa-gra.mjs [--out .tmp/naprawa/gra] [--rozmiar 1600x900] [--zoom 0.42] [--modele 0]
//
// Wynik: <out>/*.png, <out>/raport.json.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const zoom = Number(args.zoom || 0.42);
const models = args.modele === '1';
const out = resolve(repo, args.out || (models ? '.tmp/naprawa/gra-modele' : '.tmp/naprawa/gra'));
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const { server, base } = await startVite(Number(args.port || 5398));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { ustawienia: { W, H, zoom, modele: models }, zrzuty: {}, przebieg: [] };

// Stan kadłuba gracza i roju.
const STATE = `(() => {
  const s = window.ship, st = window.HullBodies.structuralState(s) || {}, rig = window.playerRepairRig, r = rig.stats;
  return { udzial: +(st.ratio ?? -1).toFixed(4), zywe: st.active, wezly: st.total, punkty: +s.hull.val.toFixed(0), max: s.hull.max,
    latki: window.HullBodies.patchedCount(s), material: r.materialCells, drony: r.alive + '/' + r.total, wPowietrzu: r.out,
    przyPracy: r.working, postep: +r.progress.toFixed(2), aktywny: rig.launched, odbudowane: r.cellsRegrown,
    prostowania: r.straightenJobs, zestrzelone: r.dronesLost, ladownia: JSON.stringify(window.PLAYER_CARGO_DEBUG?.() || {}) };
})()`;

// Poza gracza i kamera stoją (trafienia i rzaz pchają statek) — zrzuty porównywalne.
const POSE = `(() => {
  const s = window.ship, p = window.__naprawaPose;
  s.pos.x = s.x = p.x; s.pos.y = s.y = p.y; s.vel.x = s.vx = 0; s.vel.y = s.vy = 0; s.angle = p.a; s.angVel = 0;
  window.__harness.scene.cam(p.cx ?? p.x, p.cy ?? p.y, p.zoom ?? ${zoom});
  return true;
})()`;

async function shot(name, opis) {
  await ev(POSE);
  await ev('(async () => { await window.__harness.frames(3); return true; })()');
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...(await ev(STATE)) };
  console.log('zrzut', name.padEnd(24), JSON.stringify(report.zrzuty[name]));
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
    window.applyDamageToPlayer?.(dmg, { bypassShield: true, combat: false });
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

// Gniazda broni gracza: zniszczone (z bronią, którą straciły, i jej sztukami w inwentarzu), z bronią, puste; gniazda
// przywrócone przez drony (decyzja 4: gniazdo wraca, broń tylko z inwentarza).
const SOCKETS = `(() => {
  const hps = window.Game?.player?.hardpoints || [], inv = window.Game?.player?.inventory;
  const zniszczone = [];
  let zBronia = 0, puste = 0;
  hps.forEach((hp, i) => {
    if (!hp) return;
    if (hp.destroyed) zniszczone.push(i + ':' + (hp.__lostMount || '-') + '×' + (hp.__lostMount ? (inv?.count?.(hp.__lostMount) ?? 0) : 0));
    else if (hp.mount) zBronia++;
    else puste++;
  });
  return { gniazda: hps.length, zBronia, puste, zniszczone, przywroconeDrony: window.playerRepairRig?.stats?.sockets ?? 0 };
})()`;

// Klawisz R (prawdziwe zdarzenie — warstwa wejścia mapuje KeyR na akcję 'ship.repair').
const PRESS_R = `(() => {
  const opt = { key: 'r', code: 'KeyR', bubbles: true, cancelable: true };
  window.dispatchEvent(new KeyboardEvent('keydown', opt));
  window.dispatchEvent(new KeyboardEvent('keyup', opt));
  return window.playerRepairRig.launched;
})()`;

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x0d0158};
(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();
${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness && window.setVisualMode)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { window.setVisualMode(${models}, false); document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');

  // Scena: Atlas w pustce, bez HUD-u; kadłub gracza buduje się od nowa po wczytaniu sprite'a.
  report.start = await ev(`(async () => {
    const S = window.__harness.scene, H = window.__harness; H.reseed(0x0d0158); S.hideHud(true);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    const s = window.ship;
    let key = s.beamHull?.dmgKey, stable = 0;
    for (let it = 0; it < 1200 && stable < 60; it++) {
      await H.step(2);
      const k = s.beamHull?.dmgKey;
      stable = (k && k === key && s.spriteReady) ? stable + 2 : 0;
      key = k;
    }
    window.__naprawaPose = { x: s.pos.x, y: s.pos.y, a: s.angle || 0 };
    // Ładownia: materiał naprawczy (złom najpierw, potem stal) — reszta ładowni pusta.
    const cargo = window.playerRepairRig.cargo;
    for (const k of Object.keys(cargo)) delete cargo[k];
    cargo.scrap = 4; cargo.steel = 12;
    window.PLAYER_CARGO_DEBUG = () => ({ scrap: cargo.scrap || 0, steel: cargo.steel || 0, hull_plate: cargo.hull_plate || 0 });
    const h = s.beamHull;
    return { kadlub: !!h, wezly: h?.body.activeNodes, punkty: s.hull.val, max: s.hull.max, drony: window.playerRepairRig.drones.length,
      materialKomorki: window.playerRepairRig.materialCells() };
  })()`, 300000);
  console.log('start', JSON.stringify(report.start));

  await shot('00-nietkniety', 'Atlas nietknięty (odniesienie)');

  // ---------- uszkodzenia ----------
  report.uszkodzenia = await ev(DAMAGE);
  await ev('window.__harness.step(30)');
  report.uszkodzenia.odsunieteWraki = await ev(MOVE_WRECKS);
  await ev('window.__harness.step(4)');
  Object.assign(report.uszkodzenia, await ev(STATE));
  report.gniazdaPrzed = await ev(SOCKETS);
  console.log('gniazda po uszkodzeniu', JSON.stringify(report.gniazdaPrzed));
  console.log('uszkodzenia', JSON.stringify(report.uszkodzenia));
  await shot('01-uszkodzony', 'Kratery (Yamato, armata, Goliath) i odcięta rufa');

  // ---------- R: drony startują ----------
  // Koszt: opakowanie kroku rojów i rysunku (tylko pomiar czasu).
  await ev(`(() => {
    const S = window.RepairSwarm, t = window.__naprawaT = { step: 0, steps: 0, stepMax: 0 }, now = window.__harness.realNow;
    const orig = S.step.bind(S);
    S.step = (dt) => { const t0 = now(); const r = orig(dt); const ms = now() - t0; t.step += ms; t.steps++; if (ms > t.stepMax) t.stepMax = ms; return r; };
    return true;
  })()`);
  const begR = await ev('window.__harness.frameLog.n');
  report.startR = await ev(PRESS_R);
  console.log('R →', report.startR);
  for (let sec = 1; sec <= 120; sec++) {
    await ev(POSE);
    await ev('window.__harness.step(60)');
    const st = await ev(STATE);
    report.przebieg.push({ t: sec, ...st });
    if (sec === 2) await shot('02-start-dronow', 'Drony startują z doku na grzbiecie (2 s po R)');
    if (sec === 8) await shot('03-praca', 'Drony przy pracy: prostowanie przy dziurach, spawanie łat (8 s)');
    if (sec === 9) {
      // Zbliżenie spawania: kamera nad pracującym dronem.
      const w = await ev(`(() => { const d = window.playerRepairRig.drones.find((x) => x.state === 2 && x.job === 2) || window.playerRepairRig.drones.find((x) => x.state === 2);
        return d ? { x: d.wx, y: d.wy } : null; })()`);
      if (w) {
        await ev(`(() => { Object.assign(window.__naprawaPose, { cx: ${w.x}, cy: ${w.y}, zoom: 2.4 }); return true; })()`);
        await shot('04-spawanie-zblizenie', 'Zbliżenie: dron z płytą łaty, iskry i łuk palnika');
        await ev('(() => { const p = window.__naprawaPose; delete p.cx; delete p.cy; delete p.zoom; return true; })()');
      }
    }
    if (sec === 12) {
      // Ostrzał drona prawdziwym pociskiem wroga (pętla pocisków gry): A — tarcza Atlasa działa (pocisk kończy się na jej
      // obrysie, wybuch przy dronie go nie rani), B — tarcza zgaszona (pocisk zestrzeliwuje drona).
      report.ostrzal = await ev(`(async () => {
        const rig = window.playerRepairRig, H = window.__harness, S = window.RepairSwarm;
        const s = window.ship, HB = window.HullBodies, R = window.RepairTune.hitRadius, sh = s.shield;
        // Pocisk leci w płaszczyźnie gry — blacha kadłuba zatrzymuje go na brzegu, więc dron nad wnętrzem kadłuba jest
        // osłonięty, a dron spawający brzeg dziury od strony burty — odsłonięty. Szukamy drona i kierunku, z którego pocisk
        // dochodzi do koła drona bez trafienia blachy (sweep jak w pętli pocisków); spawające (stoją w miejscu) pierwsze.
        const aim = async () => {
          let czekano = 0;
          for (let tries = 0; tries < 60; tries++) {
            const order = rig.drones.filter((x) => x.state === 2).concat(rig.drones.filter((x) => x.state === 1));
            for (const x of order) {
              for (let k = 0; k < 48; k++) {
                const a = k / 48 * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
                const sx = x.wx + ux * 260, sy = x.wy + uy * 260;
                if (!HB.sweep(s, sx, sy, x.wx + ux * R * 0.6, x.wy + uy * R * 0.6, 2)) {
                  return { d: x, czekano, shooter: { x: sx, y: sy, vx: 0, vy: 0, friendly: false, isPirate: true, radius: 10 } };
                }
              }
            }
            await H.step(6); czekano += 6;
          }
          return null;
        };
        const fire = async (t, n) => {
          const lost0 = rig.stats.dronesLost, hp0 = t.d.hp;
          for (let k = 0; k < n && t.d.state !== 4; k++) {
            window.aiSpawnBullet(null, t.shooter, { x: t.d.wx, y: t.d.wy }, { speed: 3200, range: 900, dmg: 30, spread: 0, name: 'Railgun' });
            await H.step(14);
          }
          await H.step(6);
          return { dron: t.d.index, czekano: t.czekano, hpPrzed: hp0, hpPo: t.d.hp, zestrzelone: rig.stats.dronesLost - lost0 };
        };
        const alive0 = rig.stats.alive;
        // A: tarcza działa.
        const tA = await aim();
        if (!tA) return { brak: 'bez czystej linii do drona' };
        const A = { tarcza: +(sh.val || 0).toFixed(0), podTarcza: !!S.shielded(s, tA.d.wx, tA.d.wy),
          wybuch: S.blast(tA.d.wx, tA.d.wy, 20, 5, false), ...(await fire(tA, 3)) };
        // B: tarcza zgaszona (bez regeneracji na czas próby).
        const val0 = sh.val;
        sh.val = 0; sh.regenTimer = 60;
        await H.step(2);
        const tB = await aim();
        if (!tB) { sh.val = val0; sh.regenTimer = 0; return { A, brak: 'B: bez czystej linii do drona' }; }
        const B = { tarcza: 0, podTarcza: !!S.shielded(s, tB.d.wx, tB.d.wy),
          wybuch: S.blast(tB.d.wx, tB.d.wy, 20, 5, false), ...(await fire(tB, 6)) };
        sh.val = val0; sh.regenTimer = 0;
        await H.step(4);
        return { A, B, zywePrzed: alive0, zywePo: rig.stats.alive, zestrzeloneRazem: rig.stats.dronesLost };
      })()`);
      console.log('ostrzał', JSON.stringify(report.ostrzal));
      await shot('05-po-ostrzale', 'Po zestrzeleniu drona (wybuch z pul broni, reszta pracuje)');
    }
    if (sec % 10 === 0) console.log('t', sec, JSON.stringify(st));
    if (!st.aktywny && sec > 3) break;
  }
  report.klatkiRoju = await ev(`window.__harness.frameStats(${begR})`);
  report.koszt = await ev(`(() => { const t = window.__naprawaT; return { krokMsSrednio: +(t.step / Math.max(1, t.steps)).toFixed(4), krokMsMaks: +t.stepMax.toFixed(3), kroki: t.steps,
    rysunek: window.Core3D ? undefined : null }; })()`);
  report.pipeline = report.klatkiRoju.pipeline;
  console.log('koszt', JSON.stringify(report.koszt), 'pipeline', JSON.stringify(report.pipeline));
  await ev('window.__harness.step(30)');
  await shot('06-po-naprawie', 'Po naprawie: konstrukcja cała, łaty — szary podkład ze spawami (bez farby)');
  await ev(`(() => { window.__hullPatchUniforms?.uOn && (window.__hullPatchUniforms.uOn.value = 0); return !!window.__hullPatchUniforms; })()`);
  await shot('07-po-naprawie-farba', 'A/B: te same łaty rysowane farbą sprite’a (HULL_PATCH.uOn = 0)');
  await ev(`(() => { window.__hullPatchUniforms?.uOn && (window.__hullPatchUniforms.uOn.value = 1); return true; })()`);
  // Zbliżenie łat po naprawie (rufa — odcięta sekcja).
  await ev(`(() => { const s = window.ship, a = s.angle || 0, r = (s.beamHull.radius || 900) * 0.62;
    Object.assign(window.__naprawaPose, { cx: s.pos.x - Math.cos(a) * r, cy: s.pos.y - Math.sin(a) * r, zoom: 1.3 }); return true; })()`);
  await shot('08-latki-zblizenie', 'Zbliżenie łat na odbudowanej rufie');
  await ev('(() => { const p = window.__naprawaPose; delete p.cx; delete p.cy; delete p.zoom; return true; })()');
  await ev('window.__harness.step(180)');
  report.po3s = await ev(STATE);
  report.gniazdaPo = await ev(SOCKETS);
  console.log('gniazda po naprawie', JSON.stringify(report.gniazdaPo));

  // ---------- drugie R w trakcie: powrót ----------
  report.dok = await ev(`(async () => {
    const H = window.__harness, rig = window.playerRepairRig, s = window.ship, HB = window.HullBodies;
    const a = s.angle || 0, c = Math.cos(a), sn = Math.sin(a);
    const sw = HB.sweep(s, s.pos.x + sn * 900, s.pos.y - c * 900, s.pos.x - sn * 900, s.pos.y + c * 900, 0);
    if (sw) HB.impact(s, sw.worldX, sw.worldY, 800, { x: 0, y: 1500 }, { craterRadius: 40 });
    await H.step(20);
    const opt = { key: 'r', code: 'KeyR', bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keydown', opt)); window.dispatchEvent(new KeyboardEvent('keyup', opt));
    const started = rig.launched;
    await H.step(90);
    window.dispatchEvent(new KeyboardEvent('keydown', opt)); window.dispatchEvent(new KeyboardEvent('keyup', opt));
    const recalled = rig.recalling;
    await H.step(360);
    return { start: started, odwolane: recalled, poPowrocieAktywny: rig.launched, wDoku: rig.drones.filter((d) => d.state === 0).length,
      zestrzelone: rig.missing() };
  })()`);
  console.log('drugie R', JSON.stringify(report.dok));
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
