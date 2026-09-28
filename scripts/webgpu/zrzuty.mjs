// Harness zrzutów PRAWDZIWEJ gry dla portu WebGPU: te same sceny na WebGL (baza) i WebGPU.
// Vite + headless Chrome (CDP, prawdziwe GPU); do strony PRZED jej skryptami trafia
// scripts/webgpu/harness-strona.js (zegar wirtualny, Math.random z ziarnem, CSS bez animacji),
// więc gra startuje w stojącym czasie, a sceny ustawiają świat i kroczą go o stałe klatki.
//
//   node scripts/webgpu/zrzuty.mjs [--backend webgl|webgpu|oba] [--sceny menu,hud,…] [--out katalog]
//        [--rozmiar 1920x1080] [--port 5340] [--baza katalog] [--powtorz N] [--wydajnosc] [--seed n]
//        [--bok 24] [--tylko-wydajnosc] ["--chrome=--flaga …"]
//
// --teren-ringu: w ring-z02 / ring-z1 / k7-hala dodatkowo wariant `<scena>__teren` — tylko siatka terenu ringu
//            (zadanie 07; reszta sceny Core3D ukryta). Dokłada klatki, więc porównuj z przebiegiem z tą samą opcją
//            (baza: ten sam skrypt w worktree z tagu webgl-baseline, --backend webgl).
// --czesci-ringu [nazwy]: jak --teren-ringu, ale wybrane części ringu (zadanie 08; domyślnie teren, konstrukcja
//            z górną ścianą FG, chmury i powłoka powietrza — nazwy siatek po przecinku) → wariant `<scena>__ring`,
//            a w scenach z warstwami także `__ring-tlo` (warstwa 1) i `__ring-fg` (warstwa 2). Też dokłada klatki.
// --backend: nazywa katalog wyniku i dopisuje ?renderer=<backend> do adresu. Gra flagi NIE czyta (jedna ścieżka
//            renderu: tag webgl-baseline = WebGL, main od zadania 01 = WebGPU) — faktyczny renderer zapisuje się
//            w wyniki.json (pole `renderer`), więc pomyłka w etykiecie wychodzi od razu.
// --out:     domyślnie .tmp/webgpu/zrzuty/<data-godzina>; wynik: <out>/<backend>[/pN]/<scena>.png + wyniki.json
// --baza:    katalog bazy (np. .tmp/webgpu/baseline/webgl/p1) — po zrzutach porównanie (porownaj.mjs) z raportem;
//            osobne sesje w worktree podają bazę z głównego katalogu (tam jest .tmp/).
// --powtorz: N przebiegów (p1…pN) — do progu szumu bazy.
// --wydajnosc: dodatkowo bitwa w czasie rzeczywistym (CPU/GPU ms, draw calle) → <out>/<backend>/wydajnosc.json
// --uuid osobne|wspolne: skąd three bierze losowania na UUID. „osobne” — z własnego strumienia strony
//            (osobneLosowanieUuid w wspolne.mjs): liczba obiektów three (u WebGPU tysiące węzłów TSL) nie
//            przesuwa Math.random gry, więc WebGL i WebGPU generują ten sam świat (planety, wraki, warp).
//            „wspolne” — jak baza z Fazy 0 (UUID z Math.random gry). Domyślnie: tryb bazy z --baza (pole
//            `losowanieUuid` w jej wyniki.json; baza bez pola = „wspolne”), bez --baza „osobne”.
//            Tryb zapisuje się w wyniki.json (`losowanieUuid`); porównanie z bazą ma sens tylko w tym samym.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';
import { compareDirs } from './porownaj.mjs';

const args = parseArgs();
const backends = (args.backend || 'webgl') === 'oba' ? ['webgl', 'webgpu'] : [args.backend || 'webgl'];
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5340);
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outRoot = resolve(repo, args.out || `.tmp/webgpu/zrzuty/${stamp}`);
const repeats = Math.max(1, Number(args.powtorz || 1));
const seed = Number(args.seed || 0x5eed1234);
const extraArgs = args.chrome ? args.chrome.split(/\s+/).filter(Boolean) : [];
const onlyScenes = args.sceny ? new Set(args.sceny.split(',')) : null;
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
// Losowanie UUID three (patrz --uuid w nagłówku): jawna flaga > tryb bazy > „osobne”.
const uuidMode = (() => {
  if (args.uuid) {
    if (args.uuid !== 'osobne' && args.uuid !== 'wspolne') throw new Error(`--uuid: osobne albo wspolne, nie „${args.uuid}”`);
    return args.uuid;
  }
  if (args.baza) {
    const f = join(resolve(repo, args.baza), 'wyniki.json');
    try { return JSON.parse(readFileSync(f, 'utf8')).losowanieUuid || 'wspolne'; } catch { return 'wspolne'; }
  }
  return 'osobne';
})();
// Przed Page.navigate: w trybie „osobne” podmiana generateUUID w odpowiedziach serwera.
const prepareUuid = (cdp) => (uuidMode === 'osobne' ? osobneLosowanieUuid(cdp) : null);
const checkUuid = (stat) => {
  if (stat && stat.podmienione < 1) throw new Error(`--uuid osobne: nie znaleziono generateUUID three w ${stat.skrypty} skryptach (zmienił się kod three?)`);
};
const PERF_SIDE = Math.max(2, Number(args.bok || 24));

// Punkt w próżni między Ziemią a Wenus (~500 tys. j. od obu, z dala od stacji i ruchu).
const DEEP = { x: 6210000, y: 5330000 };

// Warianty scen z jednym zestawem warstw Core3D (__harness.scene.isolate): 1 tło, 3/5/6 planety
// z halo i ring-planetami, 0/7 świat ortho z tarczami, 2 FG. Numery warstw zostają po porcie.
const PASS_VARIANTS = [
  ['tlo', [1]],
  ['planety', [3, 5, 6]],
  ['ortho', [0, 7]],
  ['fg', [2]]
];
// Sceny z terenem ringu Ziemi w kadrze (opcja --teren-ringu → wariant `__teren`, --czesci-ringu → `__ring`).
const TEREN_RINGU_SCENES = new Set(['ring-z02', 'ring-z1', 'k7-hala', 'ring-dach', 'ring-dach-z01', 'ring-habitat']);
// Części ringu przeniesione do zadania 08 (nazwy siatek w scenie Core3D).
const CZESCI_RINGU = args['czesci-ringu']
  ? (args['czesci-ringu'] === '1' ? ['HaloTerrain', 'HaloStructure', 'HaloStructure_topWall', 'HaloClouds', 'HaloAirShell'] : args['czesci-ringu'].split(','))
  : null;

// ── Sceny ─────────────────────────────────────────────────────────────────────
// js: ciało funkcji async w stronie (S = pomocniki scen, H = zegar); hud: czy zostawić HUD DOM;
// warm: prawdziwe klatki przy stojącym czasie przed zrzutem (kompilacja, wgrywanie tekstur).
const SCENES = {
  menu: {
    opis: 'Menu główne: Ziemia z ringiem w kamerze kinowej (MenuBackdrop3D), intro po 150 klatkach',
    hud: true, warm: 60,
    js: `await H.step(150);`
  },
  hud: {
    opis: 'Gra przy Ziemi: kamera nad statkiem (RTS — rig kamery statku przy stojącym czasie nie dojeżdża), HUD kokpitu nad 3D',
    hud: true, warm: 45,
    js: `S.cam(ship.pos.x, ship.pos.y, 1.0);`
  },
  'ring-z02': {
    opis: 'Ring Ziemi z zewnątrz (tło ringu + górna ściana FG), zoom 0,2',
    hud: false, warm: 45, warstwy: true,
    js: `S.cam(ship.pos.x, ship.pos.y, 0.2);`
  },
  'ring-z1': {
    opis: 'Przy ścianie ringu, zoom 1',
    hud: false, warm: 45,
    js: `S.cam(ship.pos.x, ship.pos.y, 1.0);`
  },
  'k7-hala': {
    opis: 'Hala K-7 (statek w hali: wycięcie dachu, lampy), zoom 0,35, 90 klatek na zanik dachu',
    hud: false, warm: 45, warstwy: true,
    js: `HaloRingDebug.goto('earth', 'hall'); S.cam(ship.pos.x, ship.pos.y, 0.35); H.reseed(0x4b7); await H.step(90); S.cam(ship.pos.x, ship.pos.y, 0.35);`
  },
  // Zadanie 08: widoki ringu Ziemi z dala od portu (osobna sesja — nie przesuwają scen sesji „ziemia”; baza z tagu
  // przez `baza.mjs --dopisz`). W scenach przy porcie konstrukcji i atmosfery prawie nie widać (dach nad halą
  // wycięty, przy zoomie 0,2 dach nad wąwozem schowany), tu: górna ściana z dachem w FG i habitat z boku.
  'ring-dach': {
    opis: 'Ring Ziemi z daleka (zoom 0,05), 0,3 rad od portu: górna ściana z dachem w FG (odcisk brył, pasy świateł), kadłub, chmury',
    hud: false, warm: 45, warstwy: true,
    js: `const pl = planets.find((p) => p.id === 'earth'); const st = stations.find((s) => s.ringPort === 'earth');
         const R = window.__haloRings.entries.find((e) => e.key === 'earth').ring.layout.radii;
         const a = st.angle + 0.3, r = 0.5 * (R.back + R.rim);
         S.cam(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r, 0.05);`
  },
  'ring-dach-z01': {
    opis: 'Jak ring-dach, zoom 0,1: dach nad wąwozem w trakcie zaniku (przerzedzenie IGN górnej ściany w FG)',
    hud: false, warm: 45, warstwy: true,
    js: `const pl = planets.find((p) => p.id === 'earth'); const st = stations.find((s) => s.ringPort === 'earth');
         const R = window.__haloRings.entries.find((e) => e.key === 'earth').ring.layout.radii;
         const a = st.angle + 0.3, r = 0.5 * (R.back + R.rim);
         S.cam(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r, 0.1);`
  },
  'ring-habitat': {
    opis: 'Habitat ringu Ziemi z kamery gry poza ringiem (zoom 0,34), 0,3 rad od portu: podłoga, ściany od środka, chmury, powietrze, krawędź dachu w FG',
    hud: false, warm: 45, warstwy: true,
    js: `const pl = planets.find((p) => p.id === 'earth'); const st = stations.find((s) => s.ringPort === 'earth');
         const R = window.__haloRings.entries.find((e) => e.key === 'earth').ring.layout.radii;
         const a = st.angle + 0.3, r = R.rim + 1800;
         S.cam(pl.x + Math.cos(a) * r, pl.y + Math.sin(a) * r, 0.34);`
  },
  'planeta-cien': {
    opis: 'Wenus: tarcza planety (dzień/noc, halo) i jej cień na tle (shadow shafts), zoom 0,05',
    hud: false, warm: 60, warstwy: true,
    js: `const v = planets.find((p) => p.id === 'venus'); const dx = v.x - SUN.x, dy = v.y - SUN.y, d = Math.hypot(dx, dy);
         S.cam(v.x + dx / d * 7000, v.y + dy / d * 7000, 0.05);`
  },
  rozgrzewka: {
    opis: 'Bez zrzutu: ta sama bitwa 300 tys. j. dalej, walka i zniszczenie — zasoby efektów (sprite\'y, tekstury wybuchów) wczytane przed scenami',
    capture: false, warm: 10,
    js: `DevScene.teleport(${DEEP.x + 300000}, ${DEEP.y}, 0);
         const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
         const made = [];
         const put = (k, mode, p, a) => { const r = spawnCallInShip(k, { mode, spawnPos: p, spawnAngle: a }); if (Array.isArray(r)) made.push(...r); else if (r) made.push(r); };
         put('destroyer', 'pirate', at(3000, -900), Math.PI); put('pirate_battleship', 'pirate', at(4000, 0), Math.PI);
         put('destroyer', 'friendly', at(600, -1200), 0); put('battleship', 'friendly', at(-300, 1100), 0);
         S.cam(s.pos.x + 1800, s.pos.y, 0.3);
         for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);
         await H.step(150);
         for (const n of made) if (!n.dead) applyDamageToNPC(n, 1e9, 'harness');
         await H.step(90);
         for (let i = 0; i < 60; i++) { await H.frames(5); if (S.uploadsIdle()) break; }`
  },
  'mars-ring': {
    opis: 'Ring Marsa (archetyp ECUMENE) przy porcie K-7, zoom 0,2',
    hud: false, warm: 45, warstwy: true,
    js: `S.cam(ship.pos.x, ship.pos.y, 0.2);`
  },
  'jowisz-ring': {
    opis: 'Ring Jowisza (archetyp Fable) przy porcie K-7, zoom 0,2',
    hud: false, warm: 45, warstwy: true,
    js: `S.cam(ship.pos.x, ship.pos.y, 0.2);`
  },
  kalibracja: {
    opis: 'Kalibracja tolerancji portu: same wbudowane materiały three (Standard, Basic HDR, addytywny, tekstura-gradient) na warstwie 0 — wariant __ortho nie ma zamienników już po zadaniach 01–02',
    hud: false, warm: 30, warstwy: true,
    js: `DevScene.teleport(${DEEP.x}, ${DEEP.y + 60000}, 0);
         const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/three\\.js(\\?|$)|three\\.module\\.js/.test(n));
         const T = await import(url);
         const root = new T.Group(); root.name = 'harness-kalibracja';
         const x0 = ship.pos.x, y0 = -ship.pos.y;
         const add = (mesh, dx, dy) => { mesh.position.set(x0 + dx, y0 + dy, 20); mesh.layers.set(0); root.add(mesh); };
         add(new T.Mesh(new T.SphereGeometry(160, 48, 24), new T.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.45, metalness: 0.3 })), -600, 150);
         add(new T.Mesh(new T.SphereGeometry(110, 48, 24), new T.MeshStandardMaterial({ color: 0x202020, emissive: new T.Color(1, 0.45, 0.1), emissiveIntensity: 4 })), -200, 150);
         const hdr = new T.MeshBasicMaterial(); hdr.color.setRGB(3.0, 1.5, 0.6);
         add(new T.Mesh(new T.PlaneGeometry(220, 60), hdr), 200, 180);
         const add2 = new T.MeshBasicMaterial({ transparent: true, blending: T.AdditiveBlending, depthWrite: false }); add2.color.setRGB(0.2, 0.6, 1.2);
         add(new T.Mesh(new T.CircleGeometry(120, 48), add2), 260, 120);
         const W = 256, px = new Uint8Array(W * 4 * 4);
         for (let y = 0; y < 4; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; px[i] = x; px[i + 1] = y < 2 ? x : 255 - x; px[i + 2] = 128; px[i + 3] = 255; }
         const tex = new T.DataTexture(px, W, 4, T.RGBAFormat); tex.colorSpace = T.SRGBColorSpace; tex.needsUpdate = true;
         add(new T.Mesh(new T.PlaneGeometry(900, 90), new T.MeshBasicMaterial({ map: tex })), -100, -200);
         const alfa = new T.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.5 });
         add(new T.Mesh(new T.PlaneGeometry(300, 160), alfa), 450, -120);
         Core3D.scene.add(root); root.updateMatrixWorld(true);
         window.__harnessKalibracja = root;
         S.cam(ship.pos.x, ship.pos.y, 1.0);`
  },
  'kalibracja-sprzatanie': {
    opis: 'Bez zrzutu: usunięcie obiektów kalibracji ze sceny',
    capture: false, warm: 2,
    js: `const r = window.__harnessKalibracja; if (r) { r.parent?.remove(r); r.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); }); window.__harnessKalibracja = null; }`
  },
  slonce: {
    opis: 'Słońce (kula, korona, bloom HDR), zoom 0,035',
    hud: false, warm: 45,
    js: `S.cam(SUN.x, SUN.y, 0.035);`
  },
  bitwa: {
    opis: 'Bitwa w próżni: 3 piratów vs 2 Terra Nova, 180 klatek walki (pociski, wiązki, tarcze, dysze, bloom)',
    hud: false, warm: 45, warstwy: true,
    js: `DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
         const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
         spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
         spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, 900), spawnAngle: Math.PI });
         spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
         spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
         spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
         // kamera nad bitwą PRZED czekaniem: kadłuby NPC powstają w drawNPCPretty (NPC w kadrze)
         S.cam(s.pos.x + 1800, s.pos.y, 0.3);
         let it = 0; for (; it < 400 && !S.hullsReady(); it++) await H.frames(2);
         window.__harnessDiag = { czekanie: it, kadluby: S.hullsReady(), sumaPrzed: +npcs.reduce((a, n) => a + n.x + n.y, 0).toFixed(6) };
         H.reseed(0xb17a);
         await H.step(180);
         S.cam(s.pos.x + 1800, s.pos.y, 0.3);`
  },
  'bitwa-blisko': {
    opis: 'Największy pirat z bliska (zoom 1): kadłub, wieżyczki, trafienia w tarczę, lakier, cienie SDF',
    hud: false, warm: 30,
    js: `const e = npcs.filter((n) => !n.dead && !n.friendly).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
         if (e) S.cam(e.x, e.y, 1.0);`
  },
  wybuch: {
    opis: 'Zniszczenie największego pirata: wybuch 15 klatek po (overlay3D, fala uderzeniowa, iskry), zoom 0,5',
    hud: false, warm: 30,
    js: `const e = npcs.filter((n) => !n.dead && !n.friendly).sort((a, b) => (b.radius || 0) - (a.radius || 0))[0];
         if (e) { window.__harnessCel = { x: e.x, y: e.y }; H.reseed(0x3a11); applyDamageToNPC(e, 1e9, 'harness'); await H.step(15); S.cam(e.x, e.y, 0.5); }`
  },
  wraki: {
    opis: 'Ten sam wrak 150 klatek po zniszczeniu: kadłub-wrak, szczątki, żar ran (błysk już zgasł), zoom 0,6',
    hud: false, warm: 30, warstwy: true,
    js: `const c = window.__harnessCel; await H.step(135); if (c) S.cam(c.x, c.y, 0.6);`
  },
  warp: {
    opis: 'Ładowanie skoku: plazma WARP z dysz MAIN (na WebGPU bez starej soczewki — porównanie tylko na WebGL)',
    hud: false, warm: 30,
    js: `H.reseed(0x3a2d); DevFlags.unlimitedWarp = true; warp.state = 'charging'; warp.charge = 0; await H.step(75); S.cam(ship.pos.x, ship.pos.y, 0.6);`
  },
  split: {
    opis: 'Podzielony ekran (dwa renderSingle + wycinki), obie kamery na statkach, zoom 0,5',
    hud: false, warm: 45,
    js: `for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);
         S.cam(ship.pos.x, ship.pos.y, 0.5);
         const c2 = window.camera2, p2 = window.player2Ship;
         if (c2 && p2) { c2.transition = null; c2.x = c2.targetX = p2.pos.x; c2.y = c2.targetY = p2.pos.y; c2.zoom = c2.targetZoom = 0.5; }`
  },
  // ── Warp „Nurt” (zadanie 22) — osobna sesja (świeża strona: nie przesuwa scen innych sesji). Skok
  // gracza na automacie gry (ładowanie 0,8 s → skok → lot → wyjście), kamera statku zoom 0,1; przylot
  // i odlot NPC przez API WarpNurt (plan z wyprzedzeniem: zwiastun → szczelina → wyrzut), kamera RTS.
  // Nowe sceny — bez bazy w tagu (inny warp); zestawienie obok zrzutów dema: warp-demo-zrzuty.mjs.
  'warp-ladowanie': {
    opis: 'Warp „Nurt”: ładowanie gracza (75%) — płaty ośrodka (turkus z przodu, pomarańcz z tyłu), gwiazdy płasko, soczewka mgławicy, plazma WARP; zoom 0,1',
    hud: false, warm: 20,
    js: `DevScene.teleport(${DEEP.x - 250000}, ${DEEP.y + 150000}, -0.35); DevFlags.unlimitedWarp = true; S.shipCam(0.1); DevScene.aimWarp(-0.35);
         for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);
         H.reseed(0x22a1); await H.step(20); warp.state = 'charging'; warp.charge = 0; await H.step(36); S.shipCam(0.1);`
  },
  'warp-skok': {
    opis: 'Warp „Nurt”: 0,2 s po kopnięciu — smugi gwiazd z przestrzałem, fala w punkcie skoku (refrakcja), błysk za rufą, ośrodek rusza',
    hud: false, warm: 20,
    js: `await H.step(24); S.shipCam(0.1);`
  },
  'warp-lot': {
    opis: 'Warp „Nurt”: podróż (1,5 s po skoku) — opływ bańki, strugi w talii, pomarańczowy warkocz, płaskie smugi gwiazd',
    hud: false, warm: 20,
    js: `await H.step(90); S.shipCam(0.1);`
  },
  'warp-wyjscie': {
    opis: 'Warp „Nurt”: wyjście (0,1 s) — front od dziobu: smugi gwiazd wracają do punktów, bańka zapada się, szew i żar brzegu, błysk przy dziobie, fala',
    hud: false, warm: 20,
    js: `DevScene.exitWarp(); await H.step(6); S.shipCam(0.1);`
  },
  'warp-po-wyjsciu': {
    opis: 'Warp „Nurt”: 0,75 s po wyjściu — biały → pomarańczowy żar brzegu kadłuba, ośrodek gaśnie',
    hud: false, warm: 20,
    js: `await H.step(39); S.shipCam(0.1);`
  },
  'warp-zwiastun': {
    opis: 'Przylot NPC tunelem (plan z wyprzedzeniem, WarpNurt.planArrival): zwiastun 2,5 s — nić ośrodka do punktu wyjścia, punkt zbierania, szczelina się otwiera; kamera RTS 0,13',
    hud: false, warm: 20,
    js: `DevScene.teleport(${DEEP.x - 250000}, ${DEEP.y + 190000}, -0.35);
         const X = ${DEEP.x - 250000}, Y = ${DEEP.y + 190000};
         S.cam(X - 900, Y - 900, 0.13); H.reseed(0x22b2); await H.step(30);
         window.__warpRec = WarpNurt.planArrival({ x: X - 2300, y: Y - 1700, angle: -0.5, hullLength: 1560, hullWidth: 620, palette: 'magenta', burstIn: 3.0 });
         await H.step(150); S.cam(X - 900, Y - 900, 0.13);`
  },
  'warp-przylot': {
    opis: 'Przylot NPC: wyrzut (0,15 s) — superkapitał wypada z szczeliny: odsłanianie od dziobu, szew, żar, smuga sylwetki, błysk i linia blasku w ujściu, fala, iskry ośrodka',
    hud: false, warm: 20,
    js: `const X = ${DEEP.x - 250000}, Y = ${DEEP.y + 190000};
         await H.step(30);
         const at = { x: X - 2300, y: Y - 1700 };
         const r = spawnCallInShip('supercapital', { mode: 'friendly', spawnPos: at, pos: at, spawnAngle: -0.5 });
         const npc = Array.isArray(r) ? r[0] : r; window.__warpNpc = npc;
         if (npc) { npc.angle = -0.5; npc.vx = 0; npc.vy = 0; npc.command = { type: 'hold', faceAngle: -0.5 }; WarpNurt.attach(window.__warpRec, npc); }
         for (let i = 0; i < 400 && !S.hullsReady(); i++) await H.frames(2);
         if (npc) WarpNurt.attach(window.__warpRec, npc);
         await H.step(9); S.cam(X - 900, Y - 900, 0.13);`
  },
  'warp-odlot-ladowanie': {
    opis: 'Odlot NPC tunelem (WarpNurt.depart): ładowanie — punkt skoku przed dziobem, ośrodek zbierany, szczelina otwiera się przed dziobem',
    hud: false, warm: 20,
    js: `const X = ${DEEP.x - 250000}, Y = ${DEEP.y + 190000};
         await H.step(150);
         const npc = window.__warpNpc; window.__warpDep = npc ? WarpNurt.depart(npc, { drive: true }) : null;
         const d = window.__warpDep?.fx; const n = d ? Math.round((d.tDive - 0.15 - WarpNurt.time) * 60) : 60;
         await H.step(Math.max(1, n)); S.cam(X - 900, Y - 900, 0.13);`
  },
  'warp-odlot': {
    opis: 'Odlot NPC: wejście w szczelinę (0,2 s) — kadłub znika od dziobu za płaszczyzną ujścia, smuga, błysk w ujściu, fala',
    hud: false, warm: 20,
    js: `const X = ${DEEP.x - 250000}, Y = ${DEEP.y + 190000};
         await H.step(21); S.cam(X - 900, Y - 900, 0.13);`
  }
};

// Sesje = jedno wczytanie strony; sceny w sesji idą po kolei (kolejność ma znaczenie).
const SESSIONS = [
  { id: 'menu', query: 'dev=1', start: null, scenes: ['menu'] },
  { id: 'ziemia', query: 'dev=1&haloTest=earth&haloAt=port', start: 'single', ring: 'earth', scenes: ['hud', 'ring-z02', 'ring-z1', 'k7-hala', 'planeta-cien', 'slonce'] },
  { id: 'ziemia-ring', query: 'dev=1&haloTest=earth&haloAt=port', start: 'single', ring: 'earth', scenes: ['ring-dach', 'ring-dach-z01', 'ring-habitat'] },
  { id: 'mars', query: 'dev=1&haloTest=mars&haloAt=port', start: 'single', ring: 'mars', scenes: ['mars-ring'] },
  { id: 'jowisz', query: 'dev=1&haloTest=jupiter&haloAt=port', start: 'single', ring: 'jupiter', scenes: ['jowisz-ring'] },
  { id: 'kosmos', query: 'dev=1', start: 'single', sprites: true, scenes: ['kalibracja', 'kalibracja-sprzatanie', 'bitwa', 'bitwa-blisko', 'wybuch', 'wraki', 'warp'] },
  { id: 'split', query: 'dev=1', start: 'split', sprites: true, scenes: ['split'] },
  { id: 'warp', query: 'dev=1', start: 'single', sprites: true, scenes: ['warp-ladowanie', 'warp-skok', 'warp-lot', 'warp-wyjscie', 'warp-po-wyjsciu', 'warp-zwiastun', 'warp-przylot', 'warp-odlot-ladowanie', 'warp-odlot'] }
];

// Ostrzeżenia/błędy bez znaczenia dla portu (środowisko headless, zasoby spoza renderu).
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/,
  /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

function gitInfo() {
  const git = (...a) => { try { return execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
  return { commit: git('rev-parse', '--short', 'HEAD'), dirty: !!git('status', '--porcelain', '--untracked-files=no') };
}

async function runSession(session, backend, outDir, base) {
  const chrome = await startChrome({ width: W, height: H, extraArgs });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 180000) => evaluate(cdp, e, t);
  const results = [];
  const t0 = Date.now();
  try {
    const uuidStat = await prepareUuid(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${seed};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?${session.query}&renderer=${backend}` });
    // gpuReady: na WebGPU urządzenie powstaje w tle po Core3D.init() (na tagu pola nie ma — undefined).
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała (Core3D/ship/urządzenie)');
    checkUuid(uuidStat);
    const rendererKind = await ev('(() => { const r = window.Core3D.renderer; return r?.isWebGPURenderer ? (r.backend?.isWebGPUBackend ? "webgpu" : "webgpu-webgl2") : "webgl"; })()');
    if (!session.start) {
      if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 400)) throw new Error('tło menu nie gotowe');
    } else {
      if (session.start === 'single') await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
      else if (session.start === 'split') await ev(`(() => { window.DevScene.startSplit(); return true; })()`);
      if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła (__frameId)');
      // Ring buduje się leniwie, gdy środek kadru jest bliżej planety niż 420 tys. j. — przy stojącym
      // czasie kamera nie dojedzie do statku sama (Mars, Jowisz; ring Ziemi piecze się już w menu).
      if (session.ring) await ev('(() => { window.__harness.scene.cam(window.ship.pos.x, window.ship.pos.y, 0.2); return true; })()');
      if (session.ring && !await waitFor(cdp, `window.__harness.scene.ringReady('${session.ring}')`, 240000, 400)) throw new Error(`ring ${session.ring} bez map`);
      if (session.sprites && !await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('nie wczytano sprite’ów kadłubów');
    }
    // Od tej chwili strona dostaje klatki tylko na żądanie (step/frames) — powtarzalna liczba klatek.
    if (!args['bez-hold']) await ev('window.__harness.hold(true)');
    for (const id of session.scenes) {
      const sc = SCENES[id];
      // sceny bez zrzutu (rozgrzewka) idą zawsze, gdy sesja jest w użyciu
      if (onlyScenes && !onlyScenes.has(id) && sc.capture !== false) continue;
      logs.clear();
      const ts = Date.now();
      let error = null;
      try {
        // Ziarno na starcie sceny (skrót nazwy): spawny losują rozrzut, a wcześniejsze klatki
        // (ładowanie, czekanie na gotowość) zużywają losowania w zmiennej liczbie.
        const sceneSeed = [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
        await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; window.__harnessDiag = null; H.reseed(${sceneSeed}); S.hideHud(${!sc.hud});\n${sc.js}\n return true; })()`, 300000);
        await ev(`window.__harness.frames(${sc.warm || 30})`);
        await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
        await ev('window.__harness.frames(10)');
      } catch (err) {
        error = String(err?.message || err).slice(0, 500);
      }
      if (sc.capture === false) { console.log(`  ${id.padEnd(14)} ${error ? 'BŁĄD ' + error : '(bez zrzutu)'}`); continue; }
      const png = join(outDir, `${id}.png`);
      await screenshotPng(cdp, png);
      let census = null;
      try { census = await ev('window.__harness.scene.census()'); } catch (err) { census = { error: String(err?.message || err) }; }
      // Warianty „jeden pass Core3D” (tło / planety / ortho / FG) — zadania portu sprawdzają swój pass,
      // zanim cała scena przestanie mieć zamienniki. Zawsze te same klatki (bez opcji wyłączenia),
      // bo liczba klatek wpływa na kolejne sceny sesji.
      if (sc.warstwy) {
        for (const [nazwa, layers] of PASS_VARIANTS) {
          await ev(`window.__harness.scene.isolate(${JSON.stringify(layers)})`);
          await ev('window.__harness.frames(3)');
          await screenshotPng(cdp, join(outDir, `${id}__${nazwa}.png`));
        }
        await ev('window.__harness.scene.isolate(null)');
        await ev('window.__harness.frames(3)');
      }
      // --teren-ringu (zadanie 07): wariant `__teren` — tylko siatka terenu ringu Ziemi (reszta sceny
      // Core3D ukryta), w worktree z tagu tak samo; dodatkowe klatki przesuwają kolejne sceny sesji,
      // więc porównuj tylko z przebiegiem z tą samą opcją.
      if (args['teren-ringu'] && TEREN_RINGU_SCENES.has(id)) {
        const n = await ev(`window.__harness.scene.onlyNamed(['HaloTerrain'])`);
        await ev('window.__harness.frames(3)');
        await screenshotPng(cdp, join(outDir, `${id}__teren.png`));
        await ev('window.__harness.scene.onlyNamed(null)');
        await ev('window.__harness.frames(3)');
        if (!n) console.log(`  ${id}: brak siatki HaloTerrain w scenie`);
      }
      // --czesci-ringu (zadanie 08): wybrane części ringu, cała klatka i (sceny z warstwami) tło / FG osobno.
      if (CZESCI_RINGU && TEREN_RINGU_SCENES.has(id)) {
        const n = await ev(`window.__harness.scene.onlyNamed(${JSON.stringify(CZESCI_RINGU)})`);
        await ev('window.__harness.frames(3)');
        await screenshotPng(cdp, join(outDir, `${id}__ring.png`));
        if (sc.warstwy) {
          for (const [nazwa, layers] of [['tlo', [1]], ['fg', [2]]]) {
            await ev(`window.__harness.scene.isolate(${JSON.stringify(layers)})`);
            await ev('window.__harness.frames(3)');
            await screenshotPng(cdp, join(outDir, `${id}__ring-${nazwa}.png`));
          }
          await ev('window.__harness.scene.isolate(null)');
        }
        await ev('window.__harness.scene.onlyNamed(null)');
        await ev('window.__harness.frames(3)');
        if (!n) console.log(`  ${id}: brak części ringu ${CZESCI_RINGU.join(', ')} w scenie`);
      }
      let perf = null; let hdr = null; let state = null;
      try { perf = await ev('window.__harness.scene.perf(60)'); } catch (err) { perf = { error: String(err?.message || err) }; }
      try { hdr = await ev('window.__harness.scene.hdr(3)'); } catch (err) { hdr = { error: String(err?.message || err) }; }
      try {
        state = await ev(`(() => ({ t: +window.__harness.clock.t.toFixed(3), kroki: window.__harness.clock.steppedFrames,
          npc: (window.npcs || []).filter((n) => !n.dead).length, wraki: (window.wrecks || []).length, pociski: (window.bullets || []).length,
          kamera: [Math.round(window.camera.x), Math.round(window.camera.y), +window.camera.zoom.toFixed(4), window.camera.mode],
          hud: getComputedStyle(document.getElementById('cockpit-ui-host') || document.body).opacity,
          diag: window.__harnessDiag || null,
          kadluby: window.__harness.scene.hullsReady(), bezKadluba: (window.npcs || []).filter((n) => !n.dead && !n.fighter && !n.beamHull).length,
          suma: +((window.npcs || []).reduce((a, n) => a + (n.dead ? 0 : n.x + n.y), 0) % 100000).toFixed(4) }))()`);
      } catch { /* */ }
      const all = logs.all().filter((l) => !IGNORE.some((re) => re.test(l)));
      const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
      const warnings = all.filter((l) => /^\[(warning|log:warning)\]/.test(l));
      const row = { scena: id, opis: sc.opis, sesja: session.id, backend, renderer: rendererKind, png: png.replace(repo + '\\', '').split('\\').join('/'),
        sekundy: +((Date.now() - ts) / 1000).toFixed(1), blad: error, perf, hdr, stan: state, spis: census, bledy: errors, ostrzezenia: warnings };
      results.push(row);
      const tag = error || errors.length ? 'BŁĄD' : 'ok';
      console.log(`  ${id.padEnd(14)} ${tag.padEnd(5)} ${rendererKind} | ${perf?.drawCalls ?? '?'} dc, ${perf?.coreRenderMs ?? '?'} ms CPU, GPU ${perf?.gpuMs ?? '?'} ms | HDR max ${hdr?.max ?? '?'} >0,9 ${hdr?.overFraction ?? '?'} NaN ${hdr?.nanOrInf ?? '?'}${error ? ' | ' + error : ''}${errors.length ? ' | ' + errors.slice(0, 3).join(' ; ') : ''}`);
    }
  } catch (err) {
    console.log(`  sesja ${session.id}: BŁĄD ${err.message}`);
    results.push({ sesja: session.id, backend, blad: String(err.message), bledy: logs.errors().slice(0, 20) });
  } finally {
    await chrome.close();
  }
  console.log(`  (sesja ${session.id}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return results;
}

// Bitwa w czasie rzeczywistym: PerfHUD (klatka, fizyka, rysowanie) + Core3D (CPU renderu, GPU, draw calle).
async function runPerf(backend, outDir, base) {
  const chrome = await startChrome({ width: W, height: H, extraArgs });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 180000) => evaluate(cdp, e, t);
  try {
    const uuidStat = await prepareUuid(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${seed};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&renderer=${backend}` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    checkUuid(uuidStat);
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
    await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);
    const spawned = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
      DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
      const s = ship; let n = 0; const put = (k, mode, x, y, a) => { const r = spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); n += Array.isArray(r) ? r.length : (r ? 1 : 0); };
      // ${PERF_SIDE} okrętów na stronę: 17% pancerników, reszta niszczyciele (jak profil-bitwy.mjs)
      const side = ${PERF_SIDE}, nb = Math.max(1, Math.round(side * 0.17)), nd = side - nb;
      for (let i = 0; i < nd; i++) put('destroyer', 'pirate', 6000 + (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, Math.PI);
      for (let i = 0; i < nb; i++) put('pirate_battleship', 'pirate', 9000, -(nb * 1300) + i * 2600, Math.PI);
      for (let i = 0; i < nd; i++) put('destroyer', 'friendly', 800 - (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, 0);
      for (let i = 0; i < nb; i++) put('battleship', 'friendly', -2600, -(nb * 1300) + i * 2600, 0);
      S.cam(s.pos.x + 3500, s.pos.y, 0.12);
      for (let i = 0; i < 900 && !S.hullsReady(); i++) await H.frames(2);
      H.clock.mode = 'real';
      return n; })()`, 300000);
    await sleep(6000);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      samples.push(await ev(`(() => { const d = window.__PH?.display || {}; const C = window.Core3D; const r = window.__rendererInfo || {};
        return { fps: d.fps, klatka: d.frameMs, p95: d.frameP95, fizyka: d.physicsTime, rysowanie: d.drawTime, uHex: d.render3dHexUpdateTime,
          coreRender: d.render3dCoreRenderTime, coreRenderTotal: C.lastFramePerf?.renderTotalMs, gpu: C.gpuFrameMs, drawCalls: r.calls, trojkaty: r.triangles,
          fxMs: C.fxStats?.cpuMs, gpuCompute: C.gpuComputeMs,
          npc: (window.npcs || []).filter((n) => !n.dead).length, pociski: (window.bullets || []).length, wraki: (window.wrecks || []).length }; })()`));
    }
    const med = (k) => { const v = samples.map((s) => Number(s[k])).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length / 2)].toFixed(3) : null; };
    const summary = Object.fromEntries(['fps', 'klatka', 'p95', 'fizyka', 'rysowanie', 'uHex', 'coreRender', 'coreRenderTotal', 'gpu', 'fxMs', 'gpuCompute', 'drawCalls', 'trojkaty', 'npc', 'pociski', 'wraki'].map((k) => [k, med(k)]));
    const res = { backend, spawned, mediana: summary, probki: samples, bledy: logs.errors().filter((l) => !IGNORE.some((re) => re.test(l))).slice(0, 20) };
    writeJson(join(outDir, 'wydajnosc.json'), res);
    console.log(`  wydajność ${backend}: ${JSON.stringify(summary)}`);
    return res;
  } finally {
    await chrome.close();
  }
}

// ── Przebieg ──────────────────────────────────────────────────────────────────
const { server, base } = await startVite(port);
const env = { when: new Date().toISOString(), ...gitInfo(), rozmiar: `${W}x${H}`, seed, losowanieUuid: uuidMode, chrome: extraArgs };
console.log(`losowanie UUID three: ${uuidMode}${args.uuid ? '' : args.baza ? ' (jak baza)' : ' (domyślne)'}`);
const summary = {};
try {
  for (const backend of backends) {
    for (let rep = 1; rep <= repeats; rep++) {
      const outDir = repeats > 1 ? join(outRoot, backend, `p${rep}`) : join(outRoot, backend);
      mkdirSync(outDir, { recursive: true });
      console.log(`== ${backend}${repeats > 1 ? ` przebieg ${rep}/${repeats}` : ''} → ${outDir}`);
      const rows = [];
      for (const session of SESSIONS) {
        if (args['tylko-wydajnosc']) break;
        if (onlyScenes && !session.scenes.some((s) => onlyScenes.has(s))) continue;
        rows.push(...await runSession(session, backend, outDir, base));
      }
      writeJson(join(outDir, 'wyniki.json'), { ...env, backend, sceny: rows });
      summary[`${backend}${repeats > 1 ? `/p${rep}` : ''}`] = { outDir, bledy: rows.filter((r) => r.blad || r.bledy?.length).map((r) => r.scena || r.sesja) };
    }
    if (args.wydajnosc) await runPerf(backend, join(outRoot, backend), base);
  }
} finally {
  await server.close();
}

// Porównania: powtórzenia między sobą (szum) i z bazą.
if (repeats > 1) {
  for (const backend of backends) {
    const rep = compareDirs(join(outRoot, backend, 'p1'), join(outRoot, backend, 'p2'), join(outRoot, backend, 'szum-p1-p2'));
    console.log(`szum ${backend} p1↔p2: ${rep.md}`);
  }
}
if (args.baza) {
  const bazaDir = resolve(repo, args.baza);
  let bazaUuid = 'wspolne';
  try { bazaUuid = JSON.parse(readFileSync(join(bazaDir, 'wyniki.json'), 'utf8')).losowanieUuid || 'wspolne'; } catch { /* baza bez wyniki.json */ }
  if (bazaUuid !== uuidMode) console.log(`UWAGA: baza ma losowanie UUID „${bazaUuid}”, przebieg „${uuidMode}” — świat (planety, wraki, warp) inny, porównanie tylko orientacyjne`);
  for (const backend of backends) {
    const dir = repeats > 1 ? join(outRoot, backend, 'p1') : join(outRoot, backend);
    if (!existsSync(bazaDir)) { console.log(`brak bazy ${bazaDir}`); break; }
    const rep = compareDirs(bazaDir, dir, join(outRoot, backend, 'porownanie-z-baza'), { progi: join(repo, 'docs/webgpu/baseline.json') });
    console.log(`porównanie ${backend} z bazą: ${rep.md}`);
  }
}
writeFileSync(join(outRoot, 'podsumowanie.json'), JSON.stringify({ ...env, summary }, null, 2) + '\n');
console.log('gotowe:', outRoot);
process.exit(0);
