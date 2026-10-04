// Sekwencje rakiet i torped w PRAWDZIWEJ grze (Core3D, WebGPU, stojący czas harnessu — 2026-09-30, „feel” rakiet):
// klatki w stałych chwilach od strzału / wybuchu. Opcje: --bron <id> (salwa, zbliżenie), --bronie a,b (wachlarz),
// --torpeda <id>, --zoom (wachlarz), --port. Zrzuty do .tmp (nie do repo); montaż arkuszy — dowolnym PIL-em.
// Zrzuty sekwencji rakiet w PRAWDZIWEJ grze (Core3D, WebGPU, stojący czas harnessu):
//   node scripts/webgpu/rakiety-sekwencje.mjs --out .tmp/webgpu/rakiety --sceny nova,salwa,wachlarz,zblizenie,torpedy,obciazenie
// Sceny: nova (Supernowa w pancernik: klatki po detonacji), salwa (wyrzut z Atlasa: klatki
// od strzału), grad (salwa Grad, jeśli broń istnieje), wachlarz (widok z daleka na całą salwę).
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const outDir = resolve(repo, args.out || '.tmp/webgpu/rakiety-sekwencje');
const port = Number(args.port || 5371);
const sceny = new Set(String(args.sceny || 'nova,salwa').split(','));
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

mkdirSync(outDir, { recursive: true });
const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const shot = async (name) => { const f = join(outDir, `${name}.png`); await screenshotPng(cdp, f); console.log('  ', name); };
try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1919};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y');
  await ev('window.__harness.hold(true)');
  await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
    DevFlags.globalShieldsOff = true;
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
    { const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/three\\.js(\\?|$)|three\\.module\\.js|three\\.webgpu/.test(n));
      const T = await import(url);
      const bd = new T.Mesh(new T.PlaneGeometry(2000000, 2000000), new T.MeshBasicMaterial({ color: 0x000000 }));
      bd.position.set(ship.pos.x, -ship.pos.y, -900); bd.renderOrder = -1000; bd.layers.set(0); bd.name = 'harness-czern';
      Core3D.scene.add(bd); bd.updateMatrixWorld(true); }
    const s = ship; const made = [];
    const put = (k, x, y, a) => { const r = spawnCallInShip(k, { mode: 'pirate', spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); for (const n of (Array.isArray(r) ? r : [r])) if (n) { n.ai = null; made.push(n); } };
    put('pirate_battleship', 5200, -300, Math.PI); put('destroyer', 4400, 1300, Math.PI + 0.2); put('destroyer', 4800, -1800, Math.PI - 0.15);
    window.__rkCele = made;
    S.cam(s.pos.x + 2000, s.pos.y, 0.3);
    for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);
    for (const n of made) { n.hp = 1e9; n.maxHp = 1e9; }
    return true; })()`, 300000);
  await ev('window.__harness.frames(30)');

  const clean = `for (let q = 0; q < 2400 && (rocketSystem3D.activeRockets > 0 || window.__rocketFx?.smoke.highWater > 0 || window.__rocketFx?.nebula.live || window.__rocketFx?.director.busy); q++) await H.step(1);`;

  if (sceny.has('nova')) {
    // Supernowa: rakieta w pancernik, klatki od detonacji.
    await ev(`(async () => { const H = window.__harness, S = H.scene; ${clean}
      const t = window.__rkCele[0]; H.reseed(0x51a3);
      rocketSystem3D.fire(t.x - 2600, t.y - 500, t, 1, MASTER_WEAPONS.supernova_missile, 'blue', 0, 0);
      for (let i = 0; i < 900 && rocketSystem3D.activeRockets > 0; i++) { await H.step(1); if (i % 10 === 0) S.cam(t.x - 300, t.y, 0.3); }
      window.__novaXY = { x: t.x, y: t.y };
      return true; })()`);
    let tPrev = 0;
    for (const tt of [0.3, 0.7, 1.2, 1.8, 2.6, 3.4, 4.2, 5.0]) {
      const n = Math.round((tt - tPrev) * 60);
      tPrev = tt;
      await ev(`(async () => { const H = window.__harness, S = H.scene; await H.step(${n}); const p = window.__rkCele[0]; S.cam(p.x - 300, p.y, 0.3); await H.frames(2); return true; })()`);
      await shot(`nova_${String(tt.toFixed(1)).replace('.', '_')}s`);
    }
  }

  if (sceny.has('salwa')) {
    // Salwa z Atlasa: wszystkie zaczepy rakietowe gracza, cel pancernik, klatki od strzału.
    const weapon = String(args.bron || 'missile_rack');
    await ev(`(async () => { const H = window.__harness, S = H.scene; ${clean}
      const t = window.__rkCele[0]; H.reseed(0x51a5);
      const hps = (Game.player.weapons?.missile || []);
      const W = MASTER_WEAPONS['${weapon}'];
      const ctrl = window.p1WeaponCtrl || null;
      window.__salwaInfo = { hps: hps.length, ctrl: !!ctrl };
      for (const lo of hps) {
        if (!lo.hp) continue;
        const m = ctrl ? ctrl.computeMountedMuzzle(lo) : { pos: { x: ship.pos.x, y: ship.pos.y }, dir: { x: 1, y: 0 }, baseVel: { x: 0, y: 0 } };
        m.emitterUid = 'harness';
        fireWeaponCore(ship, t, W.id, m);
      }
      S.cam(ship.pos.x + 800, ship.pos.y, 0.45);
      return window.__salwaInfo; })()`);
    let tPrev = 0;
    for (const tt of [0.05, 0.15, 0.3, 0.45, 0.6, 0.8, 1.1, 1.5, 2.0, 2.6]) {
      const n = Math.max(1, Math.round((tt - tPrev) * 60));
      tPrev = tt;
      await ev(`(async () => { const H = window.__harness, S = H.scene; await H.step(${n}); S.cam(ship.pos.x + 900, ship.pos.y, 0.45); await H.frames(2); return true; })()`);
      await shot(`salwa_${weapon}_${String(tt.toFixed(2)).replace('.', '_')}s`);
    }
  }

  for (const weapon of (sceny.has('wachlarz') ? String(args.bronie || args.bron || 'grad_launcher').split(',') : [])) {
    // Cała salwa z oddali: wszystkie zaczepy rakietowe gracza bronią, kamera między statkiem a celami.
    const zoom = Number(args.zoom || 0.2);
    await ev(`(async () => { const H = window.__harness, S = H.scene; ${clean}
      const t = window.__rkCele[0]; H.reseed(0x51a7);
      const ctrl = window.p1WeaponCtrl;
      for (const lo of (Game.player.weapons?.missile || [])) {
        if (!lo.hp) continue;
        const m = ctrl.computeMountedMuzzle(lo); m.emitterUid = 'harness';
        fireWeaponCore(ship, t, MASTER_WEAPONS['${weapon}'].id, m);
      }
      S.cam(ship.pos.x + 2400, ship.pos.y, ${zoom});
      return true; })()`);
    let tPrev = 0;
    for (const tt of [0.2, 0.45, 0.8, 1.2, 1.7, 2.3, 3.0, 3.8]) {
      const n = Math.max(1, Math.round((tt - tPrev) * 60));
      tPrev = tt;
      await ev(`(async () => { const H = window.__harness, S = H.scene; await H.step(${n}); S.cam(ship.pos.x + 2400, ship.pos.y, ${zoom}); await H.frames(2); return true; })()`);
      await shot(`wachlarz_${weapon}_${String(tt.toFixed(2)).replace('.', '_')}s`);
    }
  }

  if (sceny.has('torpedy')) {
    // Tryb torped (WoWS): wyrzutnie torped na zaczepach rakietowych, niszczyciel płynie w poprzek,
    // kursor na jego duchu; nakładka, potem wachlarz w locie.
    const weapon = String(args.torpeda || 'torpedo_salvo');
    await ev(`(async () => { const H = window.__harness, S = H.scene; ${clean}
      H.reseed(0x51a8);
      DevScene.mountMissile('${weapon}');
      const t = window.__rkCele[1];
      t.x = ship.pos.x + 6500; t.y = ship.pos.y - 2600; t.vx = 0; t.vy = 520; t.angle = Math.PI / 2;
      window.__torpCel = t;
      S.shipCam(0.16);
      window.setTorpedoMode(true);
      return true; })()`);
    const aimGhost = `(() => { const t = window.__torpCel; const lead = { }; const sp = MASTER_WEAPONS['${weapon}'].baseSpeed;
      const dx = t.x - ship.pos.x, dy = t.y - ship.pos.y; const d = Math.hypot(dx, dy); const tt = d / sp;
      DevScene.pointerAt(t.x + t.vx * tt * 1.15, t.y + t.vy * tt * 1.15); return true; })()`;
    for (let k = 0; k < 4; k++) {
      await ev(aimGhost);
      await ev(`(async () => { const H = window.__harness, S = H.scene; await H.step(20); S.shipCam(0.16); await H.frames(2); return true; })()`);
    }
    await shot(`torpedy_${weapon}_celowanie`);
    await ev(`(() => { window.torpedoAim.wide = true; return true; })()`);
    await ev(`(async () => { const H = window.__harness, S = H.scene; await H.step(2); S.shipCam(0.16); await H.frames(2); return true; })()`);
    await shot(`torpedy_${weapon}_szeroki`);
    await ev(`(() => { window.torpedoAim.wide = false; return window.fireTorpedoSalvos(); })()`);
    let tPrev = 0;
    for (const tt of [0.3, 1.2, 2.5, 4.0, 5.5]) {
      const n = Math.max(1, Math.round((tt - tPrev) * 60));
      tPrev = tt;
      await ev(`(async () => { const H = window.__harness, S = H.scene; await H.step(${n}); S.shipCam(0.16); await H.frames(2); return true; })()`);
      await shot(`torpedy_${weapon}_lot_${String(tt.toFixed(1)).replace('.', '_')}s`);
    }
    await ev(`(() => { window.setTorpedoMode(false); return true; })()`);
  }

  if (sceny.has('obciazenie')) {
    // 8 salw Gradu naraz (192 mikrorakiety) z wirtualnych wyrzutni wokół statku w pancernik; pomiar klatki.
    const r0 = await ev(`(async () => { const H = window.__harness, S = H.scene; ${clean}
      H.reseed(0x51a9);
      const t = window.__rkCele[0]; const W = MASTER_WEAPONS.grad_launcher;
      S.cam(ship.pos.x + 2600, ship.pos.y, 0.2);
      const base = await S.perf(60);
      for (let k = 0; k < 8; k++) {
        const sh = { x: ship.pos.x - 600 + k * 180, y: ship.pos.y + (k % 2 ? 300 : -300), angle: 0, vx: 0, vy: 0 };
        rocketSystem3D.fireSalvo(sh, sh.x, sh.y, t, 1, W, 'blue', 0, 0, 24, W.burstDelay, 0, 0);
      }
      await H.step(60);
      const lot = await S.perf(60);
      const aktywne = rocketSystem3D.activeRockets;
      const dym = window.__rocketFx?.smoke?.highWater;
      const fxMs = window.__rocketFx?.stats?.cpuMs;
      return { base, lot, aktywne, dym, fxMs };
    })()`, 300000);
    console.log('OBCIĄŻENIE', JSON.stringify(r0));
    await shot('obciazenie_grad_x8');
  }

  if (sceny.has('zblizenie')) {
    // Wyrzut z bliska: zaczep rakietowy Atlasa przy zoomie 1,4.
    const weapon = String(args.bron || 'missile_rack');
    await ev(`(async () => { const H = window.__harness, S = H.scene; ${clean}
      const t = window.__rkCele[0]; H.reseed(0x51a6);
      const lo = (Game.player.weapons?.missile || [])[0];
      const ctrl = window.p1WeaponCtrl;
      const m = ctrl.computeMountedMuzzle(lo);
      window.__zbl = { x: m.pos.x, y: m.pos.y };
      m.emitterUid = 'harness';
      fireWeaponCore(ship, t, MASTER_WEAPONS['${weapon}'].id, m);
      S.cam(window.__zbl.x + 60, window.__zbl.y, 1.4);
      return true; })()`);
    let tPrev = 0;
    for (const tt of [0.05, 0.12, 0.2, 0.28, 0.36, 0.45, 0.55, 0.7, 0.9]) {
      const n = Math.max(1, Math.round((tt - tPrev) * 60));
      tPrev = tt;
      await ev(`(async () => { const H = window.__harness, S = H.scene; await H.step(${n}); S.cam(window.__zbl.x + 60, window.__zbl.y, 1.4); await H.frames(2); return true; })()`);
      await shot(`zblizenie_${weapon}_${String(tt.toFixed(2)).replace('.', '_')}s`);
    }
  }
  const errs = logs.all ? logs.all().filter((l) => /error|exception/i.test(l)).slice(0, 20) : [];
  if (errs.length) console.log('BŁĘDY:', errs);
} catch (err) {
  console.error('BŁĄD', err);
} finally {
  try { await chrome.close(); } catch { /* */ }
  try { await server.close(); } catch { /* */ }
}
process.exit(0);
