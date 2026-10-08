// WYPOSAŻENIE (docs/PLAN-fitowanie.md, etapy 0 i 2–6) w PRAWDZIWEJ grze: karty konfiguracji, refit ręczny, zakup
// w porcie, zapis i F5. Własny Vite (bez HMR — inne sesje edytują moduły, a pełny reload strony w połowie scenariusza
// gubi stan), headless Chrome z GPU, gra swobodna (kampania wyłączona w localStorage PRZED nawigacją), zakładka
// WYPOSAŻENIE w tablecie kokpitu. Sprawdza:
//  1) czysty start = karta UNIWERSALNA z kompletów (misja startowa), komplety pozostałych kart w hangarze,
//  2) ekran: 4 karty + REFIT RĘCZNY w tablecie (bez przewijania w poziomie, profile ognia narysowane),
//  3) karty z magazynu: BLISKI TANK (tarcza ×1,4), SNAJPER (Lanca Ciężka 15 km, silniki manewrowe), RAKIETOWIEC
//     (bateria → wyrzutnie, magazynki ×1,5), powrót UNIWERSALNA — magazyn + zamontowane = const,
//  4) refit ręczny: grupa DZIAŁA → broń z listy na wszystkie gniazda, ZAPISZ JAKO WŁASNĄ,
//  5) karta z zakupem w porcie (broń, której nie ma w hangarze): cena, kredyty, fit,
//  6) F5: fit, moduł, system F, magazyn i części z zapisu; ekran po F5,
//  7) pasek stanu: UZUPEŁNIJ AMUNICJĘ i NAPRAW (zniszczone gniazdo wraca puste),
//  8) 1280×720: karty i refit ręczny bez przewijania w poziomie; błędy konsoli.
//
//   node scripts/webgpu/wyposazenie-gra.mjs [--out .tmp/wyposazenie] [--rozmiar 1920x1080] [--port 5398]
//
// Wynik: <out>/*.png, <out>/raport.json; kod wyjścia 1 przy niespełnionym sprawdzeniu.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wyposazenie');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5398));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { ustawienia: { W, H }, sprawdzenia: [] };
const check = (name, ok, detail) => {
  report.sprawdzenia.push({ name, ok: !!ok, detail });
  console.log(ok ? 'OK  ' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
};

// Stan fitu gracza: magazyn, broń / typ / amunicja per id gniazda, stan wyposażenia (PlayerFit.state).
const FIT = `(() => {
  const p = window.Game.player;
  return {
    stock: p.inventory.toObject(),
    mounts: Object.fromEntries(p.hardpoints.map((h) => [h.id, h.mount || null])),
    types: Object.fromEntries(p.hardpoints.map((h) => [h.id, h.type])),
    ammo: Object.fromEntries(p.hardpoints.filter((h) => typeof h.maxAmmo === 'number').map((h) => [h.id, [h.ammo, h.maxAmmo]])),
    fit: window.PlayerFit.state(),
    system: window.playerShipSystem()?.id || null,
    shield: window.ship.shield ? Math.round(window.ship.shield.max) : null,
    gniazd: p.hardpoints.length
  };
})()`;

// Pomocniki w stronie (po każdym załadowaniu).
const HELPERS = `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pane = () => document.querySelector('#tab-mechanic-html');
  window.__fitT = {
    sleep,
    pane,
    // Stacja do doku: najpierw te, w których port złoży broń kart (ceny w WYPOSAŻENIU); wrogi dok nie wpuszcza —
    // próbujemy po kolei.
    candidates: () => {
      const list = (window.stations || []).filter((s) => s && !s.mission);
      const price = (s) => window.PlayerFit.weaponPrice('heavy_autocannon_l', s) != null;
      return [...list.filter(price), ...list.filter((s) => !price(s))];
    },
    open: async (tab = 'mechanic') => {
      if (!window.isStationUIOpen()) {
        for (const s of window.__fitT.candidates()) {
          window.openStationUI(s, tab);
          if (window.isStationUIOpen()) { window.__fitT.dock = s; break; }
        }
      } else {
        window.openStationUI(window.__fitT.dock, tab);
      }
      await sleep(900);
      return !!document.querySelector(tab === 'mechanic' ? '#tab-mechanic-html.active.fit-mode' : '#tab-' + tab + '.active');
    },
    cards: () => [...pane().querySelectorAll('.fit-cards > .fit-card')],
    card: (name) => window.__fitT.cards().find((c) => c.querySelector('.fit-card-name')?.textContent.trim() === name),
    clickCard: async (name, act) => {
      const c = window.__fitT.card(name);
      const b = c?.querySelector('button[data-act="' + act + '"]');
      if (!b || b.disabled) return false;
      b.click();
      await sleep(300);
      return true;
    },
    slots: (type) => window.Game.player.hardpoints.filter((h) => h.type === type),
    baseSlots: (type) => window.Game.player.hardpoints.filter((h) => (h.baseType || h.type) === type),
    count: (slots) => slots.reduce((m, h) => { if (h.mount) m[h.mount] = (m[h.mount] || 0) + 1; return m; }, {}),
    totals: () => {
      const p = window.Game.player;
      const out = { ...p.inventory.toObject() };
      for (const h of p.hardpoints) if (h.mount && h.type !== 'hangar') out[h.mount] = (out[h.mount] || 0) + 1;
      return Object.fromEntries(Object.entries(out).filter(([id, n]) => n > 0 && !id.startsWith('fighter_')).sort());
    },
    layout: () => {
      const root = pane().querySelector('.fit-root');
      const r = root.getBoundingClientRect();
      const viewOn = root.querySelector('.fit-view.on');
      const kids = [...viewOn.querySelectorAll('.fit-card, .fit-manual > *, .fit-diff')];
      const outside = kids.filter((k) => {
        const q = k.getBoundingClientRect();
        return q.width > 0 && (q.left < r.left - 1 || q.right > r.right + 1 || q.bottom > r.bottom + 1);
      }).map((k) => k.className);
      // Profil ognia narysowany = niezerowe piksele kanwy.
      // Tryb kompaktowy chowa mapy kart — liczą się kanwy widoczne.
      const visible = [...viewOn.querySelectorAll('canvas')].filter((cv) => cv.getBoundingClientRect().width > 0);
      const drawn = visible.map((cv) => {
        if (!cv.width || !cv.height) return 0;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
        return n;
      });
      return {
        root: [Math.round(r.width), Math.round(r.height)],
        scrollX: root.scrollWidth - root.clientWidth,
        outside,
        canvases: drawn.length,
        empty: drawn.filter((n) => n === 0).length
      };
    }
  };
  return true;
})()`;

const READY = '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship '
  + '&& window.Game?.player?.hardpoints?.length && window.ship.spriteReady && window.openStationUI && window.PlayerFit)';

async function startFreeGame(label) {
  if (!await waitFor(cdp, READY, 240000, 400)) throw new Error(`${label}: gra nie wstała`);
  // Wczytany sprite przebudowuje tablicę gniazd (tryPreserveMounts) — chwila na koniec obsługi zdarzenia.
  await sleep(500);
  const menuFit = await ev(FIT);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error(`${label}: gra nie ruszyła`);
  await ev(HELPERS);
  return menuFit;
}

const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

let failed = false;
try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();`
  });
  await cdp.send('Page.navigate', { url: `${base}/index.html` });
  const first = await startFreeGame('start');
  const start = await ev(FIT);
  report.start = start;
  const mainStart = Object.entries(start.types).filter(([, t]) => t === 'main').map(([id]) => start.mounts[id]);
  check('czysty start: UNIWERSALNA z kompletów (15× Tempest Ciężki), komplety w hangarze',
    first.gniazd === 45 && mainStart.length === 15 && mainStart.every((m) => m === 'tempest_ion_l')
      && start.fit.kitsGranted && start.fit.hullPresets.atlas === 'universal' && start.stock.heavy_autocannon_l === 15
      && start.fit.partStock.shield_booster === 1 && start.fit.partStock.maneuver === 1,
    { gniazd: first.gniazd, karta: start.fit.hullPresets, czesci: start.fit.partStock, ha: start.stock.heavy_autocannon_l });
  const totals0 = await ev('window.__fitT.totals()');

  // ---------- 2) ekran ----------
  check('zakładka WYPOSAŻENIE otwarta (panel kart)', await ev('window.__fitT.open("mechanic")'));
  await sleep(400);
  const screen = await ev(`(() => ({
    karty: window.__fitT.cards().map((c) => c.querySelector('.fit-card-name')?.textContent.trim()),
    aktywna: window.__fitT.cards().find((c) => c.querySelector('.fit-tag:not(.later)'))?.querySelector('.fit-card-name')?.textContent.trim(),
    status: window.__fitT.pane().querySelector('.fit-status')?.textContent.replace(/\\s+/g, ' ').trim(),
    zakladka: [...document.querySelectorAll('.tablet-tabs .menu-item, .station-tab-btn')].map((b) => b.textContent.trim()).filter((t) => /WYPOSA|Wyposa/.test(t)),
    layout: window.__fitT.layout()
  }))()`);
  report.ekran = screen;
  check('4 karty + REFIT RĘCZNY, aktywna UNIWERSALNA',
    same(screen.karty, ['UNIWERSALNA', 'BLISKI TANK', 'SNAJPER', 'RAKIETOWIEC', 'REFIT RĘCZNY']) && screen.aktywna === 'UNIWERSALNA', screen.karty);
  check('zakładka nazywa się WYPOSAŻENIE', screen.zakladka.length > 0, screen.zakladka);
  check('karty mieszczą się w tablecie, profile i mapy narysowane',
    screen.layout.scrollX <= 1 && !screen.layout.outside.length && screen.layout.empty === 0, screen.layout);
  await screenshotPng(cdp, join(out, '01-karty.png'));

  // ---------- 3) karty z magazynu ----------
  await ev(`(async () => { window.__fitT.card('BLISKI TANK').click(); await window.__fitT.sleep(300); return true; })()`);
  const diff = await ev(`window.__fitT.pane().querySelector('.fit-diff')?.textContent.replace(/\\s+/g, ' ').trim()`);
  check('wybór karty pokazuje pasek ZMIAN', /ZMIANY · BLISKI TANK/.test(diff || '') && /wszystko w hangarze/.test(diff || ''), diff?.slice(0, 160));
  await screenshotPng(cdp, join(out, '02-tank-zmiany.png'));
  await ev(`(async () => { window.__fitT.pane().querySelector('.fit-diff [data-act="diff-apply"]').click(); await window.__fitT.sleep(400); return true; })()`);
  const tank = await ev(FIT);
  const tankMain = await ev(`window.__fitT.count(window.__fitT.slots('main'))`);
  check('BLISKI TANK: 15× HA, Wzmacniacz tarcz (tarcza ×1,4), szarża',
    same(tankMain, { heavy_autocannon_l: 15 }) && tank.fit.hullModules.atlas === 'shield_booster'
      && tank.shield === Math.round(start.shield * 1.4) && tank.system === 'ram_burn' && tank.fit.hullPresets.atlas === 'tank',
    { tankMain, modul: tank.fit.hullModules, tarcza: [start.shield, tank.shield], system: tank.system });
  check('BLISKI TANK: magazyn + zamontowane = const', same(await ev('window.__fitT.totals()'), totals0));
  await screenshotPng(cdp, join(out, '03-tank-zalozony.png'));

  check('karta SNAJPER: przycisk ZASTOSUJ (z hangaru, 0 CR)', await ev(`window.__fitT.clickCard('SNAJPER', 'card-buy')`));
  const sniper = await ev(FIT);
  const sniperRange = await ev(`({ lanca: window.PlayerFit.range('lance_rail_l'), tempest: window.PlayerFit.range('tempest_ion_l'), mjolnir: window.PlayerFit.range('siege_railgun') })`);
  check('SNAJPER: Komputer balistyczny (Lanca Ciężka 15 km, Mjolnir bez zmian), silniki manewrowe',
    sniper.fit.hullModules.atlas === 'ballistic_computer' && sniper.system === 'maneuver' && sniperRange.lanca === 15000
      && sniperRange.mjolnir === 20000 && sniper.shield === start.shield,
    { modul: sniper.fit.hullModules, system: sniper.system, zasiegi: sniperRange });
  check('SNAJPER: magazyn + zamontowane = const', same(await ev('window.__fitT.totals()'), totals0));
  await screenshotPng(cdp, join(out, '04-snajper.png'));

  check('karta RAKIETOWIEC: ZASTOSUJ', await ev(`window.__fitT.clickCard('RAKIETOWIEC', 'card-buy')`));
  const missile = await ev(`(() => ({
    bateria: window.__fitT.count(window.__fitT.baseSlots('special')),
    typy: [...new Set(window.__fitT.baseSlots('special').map((h) => h.type))],
    wyrzutnie: window.__fitT.count(window.__fitT.baseSlots('missile')),
    magazynki: window.__fitT.slots('missile').map((h) => [h.mount, h.maxAmmo]),
    modul: window.PlayerFit.module(),
    system: window.playerShipSystem()?.id
  }))()`);
  const ammoOk = missile.magazynki.every(([id, max]) => max === Math.round(({ missile_rack: 8, grad_launcher: 8, hydra_mirv: 10 })[id] * 1.5));
  check('RAKIETOWIEC: bateria → wyrzutnie (4× Cruise, 2× Grad), 2× Hydra, magazynki ×1,5',
    same(missile.bateria, { missile_rack: 4, grad_launcher: 2 }) && same(missile.typy, ['missile'])
      && same(missile.wyrzutnie, { hydra_mirv: 2 }) && ammoOk && missile.modul === 'missile_cells' && missile.system === 'maneuver', missile);
  check('RAKIETOWIEC: magazyn + zamontowane = const', same(await ev('window.__fitT.totals()'), totals0));
  await screenshotPng(cdp, join(out, '05-rakietowiec.png'));

  check('karta UNIWERSALNA: ZASTOSUJ', await ev(`window.__fitT.clickCard('UNIWERSALNA', 'card-buy')`));
  const back = await ev(FIT);
  check('UNIWERSALNA: ten sam fit co na starcie, części w hangarze, bateria wraca',
    same(back.mounts, start.mounts) && same(back.types, start.types) && same(back.fit.partStock, start.fit.partStock)
      && back.system === 'ram_burn' && back.shield === start.shield, { czesci: back.fit.partStock });

  // ---------- 4) refit ręczny ----------
  await ev(`(async () => { window.__fitT.pane().querySelector('[data-act="open-manual"]').click(); await window.__fitT.sleep(500); return true; })()`);
  const manual = await ev(`(async () => {
    const pane = window.__fitT.pane();
    const grp = [...pane.querySelectorAll('.fit-m-tools .fit-seg')].find((b) => b.textContent.startsWith('DZIAŁA'));
    grp.click();
    await window.__fitT.sleep(300);
    const rows = [...pane.querySelectorAll('.fit-wlist .fit-wrow[data-id]')].map((r) => r.dataset.id);
    pane.querySelector('.fit-wlist .fit-wrow[data-id="railgun_mk2"]').click();
    await window.__fitT.sleep(300);
    const main = window.__fitT.count(window.__fitT.slots('main'));
    const toast = pane.querySelector('.fit-toast')?.textContent;
    return { widok: !!pane.querySelector('.fit-view.on[data-view="manual"]'), rows, main, toast, layout: window.__fitT.layout() };
  })()`);
  check('refit ręczny: grupa DZIAŁA → Tempest Mk II na 15 gniazd', manual.widok && same(manual.main, { railgun_mk2: 15 })
    && manual.rows.includes('lance_rail_l') && /Zamontowano 15×/.test(manual.toast || ''), { main: manual.main, toast: manual.toast });
  check('refit ręczny: układ bez wyjścia poza tablet', manual.layout.scrollX <= 1 && !manual.layout.outside.length && manual.layout.empty === 0, manual.layout);
  check('refit ręczny: magazyn + zamontowane = const', same(await ev('window.__fitT.totals()'), totals0));
  // Klik w gniazdo burtowe na sylwetce (mysz CDP, nie dispatchEvent — tak jak gracz): SYMETRIA zaznacza parę.
  const slotPt = await ev(`(() => {
    const cv = window.__fitT.pane().querySelector('canvas.fit-hull');
    const r = cv.getBoundingClientRect();
    const s = Math.min((r.width - 36) / window.ship.w, (r.height - 36) / window.ship.h);
    const hp = window.__fitT.slots('main').find((h) => Math.abs(h.pos.y) > 1);
    return { x: r.left + r.width / 2 + hp.pos.x * s, y: r.top + r.height / 2 + hp.pos.y * s, id: hp.id };
  })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: slotPt.x, y: slotPt.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
  await sleep(300);
  const picked = await ev(`window.__fitT.pane().querySelector('.fit-sel-head')?.textContent.replace(/\\s+/g, ' ').trim()`);
  check('refit ręczny: klik myszą w gniazdo na sylwetce zaznacza parę (SYMETRIA)', /ZAZNACZONE: 2 × DZIAŁA/.test(picked || ''), { picked, slotPt });
  await screenshotPng(cdp, join(out, '06-refit-reczny.png'));
  const custom = await ev(`(async () => {
    const pane = window.__fitT.pane();
    pane.querySelector('[data-act="save-custom"]').click();
    await window.__fitT.sleep(300);
    const toast = pane.querySelector('.fit-toast')?.textContent;
    pane.querySelector('[data-act="back"]').click();
    await window.__fitT.sleep(500);
    return { toast, kafel: pane.querySelector('.fit-card.refit')?.textContent.replace(/\\s+/g, ' ').trim(), aktywna: window.PlayerFit.state().hullPresets.atlas };
  })()`);
  check('ZAPISZ JAKO WŁASNĄ: konfiguracja na kaflu REFIT RĘCZNY', /Zapisano jako WŁASNA 1/.test(custom.toast || '') && /WŁASNA 1/.test(custom.kafel || '')
    && String(custom.aktywna).startsWith('own_'), custom);

  // ---------- 5) karta z zakupem w porcie ----------
  const buy = await ev(`(async () => {
    const p = window.Game.player;
    // Później w grze: broni BLISKIEGO TANKA nie ma już w hangarze (sprzedana / zniszczona).
    p.inventory.set('heavy_autocannon_l', 0);
    p.inventory.set('special_plasma_gatling', 0);
    const plan = window.PlayerFit.plan('tank', 'buy');
    window.DevAddCredits(Math.max(0, plan.price + 1000 - window.DevEconomy.getCredits()));
    // Przerysowanie kart po zmianie magazynu i kredytów (w grze — przy każdej akcji w panelu).
    window.__fitT.card('UNIWERSALNA').click();
    await window.__fitT.sleep(200);
    window.__fitT.card('UNIWERSALNA').click();
    await window.__fitT.sleep(300);
    const card = window.__fitT.card('BLISKI TANK');
    const foot = card.querySelector('.fit-card-foot')?.textContent.replace(/\\s+/g, ' ').trim();
    const c0 = window.DevEconomy.getCredits();
    const clicked = await window.__fitT.clickCard('BLISKI TANK', 'card-buy');
    await window.__fitT.sleep(300);
    return {
      plan: { kupno: Object.fromEntries(plan.buy), cena: plan.price, blok: plan.blocked },
      foot, clicked, koszt: c0 - window.DevEconomy.getCredits(),
      main: window.__fitT.count(window.__fitT.slots('main')),
      bateria: window.__fitT.count(window.__fitT.slots('special'))
    };
  })()`);
  report.zakup = buy;
  check('karta z zakupem: cena braków na karcie, KUP, zapłata = cena planu',
    !buy.plan.blok && same(buy.plan.kupno, { heavy_autocannon_l: 15, special_plasma_gatling: 6 }) && /DO KUPIENIA/.test(buy.foot || '')
      && buy.clicked && buy.koszt === buy.plan.cena && same(buy.main, { heavy_autocannon_l: 15 }) && same(buy.bateria, { special_plasma_gatling: 6 }), buy);
  await screenshotPng(cdp, join(out, '07-po-zakupie.png'));

  // ---------- 6) F5 ----------
  const beforeF5 = await ev(FIT);
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(1500);
  const menuAfterF5 = await startFreeGame('po F5');
  const afterF5 = await ev(FIT);
  check('F5: fit, typy gniazd i amunicja z zapisu', same(menuAfterF5.mounts, beforeF5.mounts) && same(menuAfterF5.types, beforeF5.types)
    && same(menuAfterF5.ammo, beforeF5.ammo));
  check('F5: magazyn, moduł, system F, części, karty i własne konfiguracje z zapisu',
    same(menuAfterF5.stock, beforeF5.stock) && same(menuAfterF5.fit, beforeF5.fit) && menuAfterF5.system === beforeF5.system
      && menuAfterF5.shield === beforeF5.shield, { przed: beforeF5.fit, po: menuAfterF5.fit });
  check('F5 + start gry: bez zmian', same(afterF5.mounts, beforeF5.mounts) && same(afterF5.stock, beforeF5.stock) && same(afterF5.fit, beforeF5.fit));
  check('zakładka WYPOSAŻENIE po F5', await ev('window.__fitT.open("mechanic")'));
  await sleep(300);
  const screen2 = await ev(`(() => ({ aktywna: window.__fitT.cards().find((c) => c.querySelector('.fit-tag:not(.later)'))?.querySelector('.fit-card-name')?.textContent.trim(), layout: window.__fitT.layout() }))()`);
  check('po F5: aktywna BLISKI TANK, ekran narysowany', screen2.aktywna === 'BLISKI TANK' && screen2.layout.empty === 0, screen2);

  // ---------- 7) pasek stanu: amunicja i naprawa ----------
  const service = await ev(`(async () => {
    const p = window.Game.player, pane = window.__fitT.pane();
    const mags = p.hardpoints.filter((h) => h.mount && typeof h.maxAmmo === 'number' && h.maxAmmo > 0);
    for (const h of mags) h.ammo = Math.floor(h.maxAmmo / 4);
    const aux = window.__fitT.slots('aux')[2];
    aux.destroyed = true; aux.mount = null; aux.ammo = null; aux.maxAmmo = null;
    window.syncWeaponSystems?.();
    window.DevAddCredits(5000);
    // Pasek stanu sam odświeża cenę naprawy (tick co ~0,5 s) i amunicję (co klatkę).
    await window.__fitT.sleep(900);
    const status = pane.querySelector('.fit-status')?.textContent.replace(/\\s+/g, ' ').trim();
    const ammoBtn = pane.querySelector('.fit-status [data-act="ammo"]');
    const ammoOn = !ammoBtn.disabled;
    const repairText = pane.querySelector('.fit-status [data-act="repair"]').textContent.trim();
    ammoBtn.click();
    await window.__fitT.sleep(300);
    const full = mags.every((h) => h.ammo === h.maxAmmo);
    const c0 = window.DevEconomy.getCredits();
    pane.querySelector('.fit-status [data-act="repair"]').click();
    await window.__fitT.sleep(300);
    return { status, ammoOn, full, repairText, koszt: c0 - window.DevEconomy.getCredits(), gniazdo: [aux.destroyed, aux.mount] };
  })()`);
  report.uslugi = service;
  check('UZUPEŁNIJ AMUNICJĘ: przycisk aktywny przy niepełnych magazynkach, napełnia', service.ammoOn && service.full, service);
  check('NAPRAW: cena z gniazdem, gniazdo wraca puste', /NAPRAW · /.test(service.repairText) && service.koszt > 0
    && service.gniazdo[0] === false && service.gniazdo[1] === null, service);
  await screenshotPng(cdp, join(out, '08-po-naprawie.png'));

  // ---------- 8) 1280×720 ----------
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  const small = await ev(`(() => window.__fitT.layout())()`);
  check('1280×720: karty bez wyjścia poza tablet', small.scrollX <= 1 && !small.outside.length && small.empty === 0, small);
  await screenshotPng(cdp, join(out, '09-karty-1280.png'));
  const smallManual = await ev(`(async () => {
    window.__fitT.pane().querySelector('[data-act="open-manual"]').click();
    await window.__fitT.sleep(600);
    return window.__fitT.layout();
  })()`);
  check('1280×720: refit ręczny bez wyjścia poza tablet', smallManual.scrollX <= 1 && !smallManual.outside.length && smallManual.empty === 0, smallManual);
  await screenshotPng(cdp, join(out, '10-refit-1280.png'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await ev('window.closeStationUI?.()');

  report.bledy = logs.errors().filter((line) => !/favicon\.ico/.test(line));   // 404 favicon z serwera dev — nie gra
  console.log(`błędy konsoli: ${report.bledy.length}`);
  for (const line of report.bledy.slice(0, 20)) console.log('  ', line);
  check('konsola bez błędów', report.bledy.length === 0, report.bledy.slice(0, 5));
} catch (err) {
  failed = true;
  report.wyjatek = String(err?.stack || err);
  console.error(err);
  try { await screenshotPng(cdp, join(out, '99-blad.png')); } catch { /* */ }
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  await chrome.close();
  await server.close();
}
const bad = report.sprawdzenia.filter((c) => !c.ok);
console.log(`sprawdzenia: ${report.sprawdzenia.length - bad.length}/${report.sprawdzenia.length} OK → ${out}`);
process.exit(failed || bad.length ? 1 : 0);
