// GPU W POLU ASTEROID Z GAZEM przy rozdzielczości monitora użytkownika — tryb gracza (render w workerze). Zgłoszenie
// 2026-10-29 (5120 × 1440 @ 240 Hz, RTX 5080, 7800X3D): „pole asteroid dropi do 100 fps” — PerfHUD: strona 96 kl/s,
// „Obraz 3D (worker) 96 kl/s · wiek 5 · CPU 3,1 · GPU 0,5+1,5 · kolejka 86 ms”; „gazy i mgła w polu asteroid mocno
// drżą”; „na oddalonej kamerze nie widać wypychania gazu, ogon za statkiem szybko znika”.
// Vite + Chrome z WebGPU (CDP), gra swobodna, Atlas w gęstym polu pasa (miejsce „pole” dema asteroid, jak
// gaz-kosmos-gra.mjs), Atlas nieśmiertelny. Szkielet pomiaru: gpu-baza-gra.mjs (sonda GPU workera, ślad Chrome,
// nvidia-smi, rytm złożeń).
//
//   node scripts/webgpu/gpu-pas-gra.mjs [--okno 0|1] [--rozmiar 5120x1440] [--out .tmp/gpu-pas-baza] [--query grafika=wysoka]
//        [--rytm 1] [--slad 3] [--oknoS 5] [--zoomBlisko 0.3413] [--zoomSrednio 0.15] [--zoomDaleko 0.0667] [--zoomMaks 0.035]
//        [--ab 1|0|G0,B1,…] [--abBlisko G0,B0,…] [--abLot G0,B0,…] [--abS 3.5] [--abPowt 1] [--balastGb N]
//        [--chrome harness|gracz] [--devFeatures 1] [--cisza 30] [--ciszaMaks 1200] [--okna postoj-blisko,…] [--kolkoAb S2]
//        [--rzedniecie 60] [--zoomRz 0.1] [--obrazAB CRoff,…] [--zrzutyAB .tmp/gpu-pas-ab] [--zoomyAB blisko,srednio,daleko,max]
//        [--lotAB 4] [--rampaAB 1]
//
// Okna główne (każde: złożenia obrazu / s, klatki strony / s, klatki workera / s, CPU workera p50 / p95, sonda GPU
// workera — GPU render / compute wg passów, kroków Core3D.fx i modułów, opóźnienie kolejki GPU śr / p95 / maks, wysyłki
// wg etykiet, nowe zasoby, pamięć gry od instalacji sondy, passy, rozwiązania MSAA i czyszczenia three; nvidia-smi:
// zajętość, pamięć, moc, PCIe; liczniki Windows: pamięć dedykowana / współdzielona procesu GPU Chrome i karty, silniki;
// rytm złożeń strony; dziennik drżenia gazu klatka po klatce w workerze; dane oddalenia — zanik obrazu gazu, pokrycie
// kadru oknem pola, płaty mgły pasa):
//   postoj-blisko  — Atlas trzymany w gęstym gazie, zoom domyślny Atlasa (kadłub 20% szerokości);
//   postoj-daleko  — to samo przy zoomie z zrzutu użytkownika (okręt ~200 px na 5120 px);
//   ciag-blisko / ciag-srednio / ciag-daleko / ciag-max — przelot przez gaz (W) od tego samego miejsca przy 4 zoomach
//                    (ostatni — oddalenie maksymalne); po oknie zrzut PNG i przekroje kanału za rufą (odczyt pola).
// A/B (--ab): w tym samym położeniu (zoom daleki, Atlas trzymany z ciągiem W) warianty przełączane w workerze albo na
//   stronie po kolei, każdy z oknem --abS s i oknem bazy przed nim; potem podzbiór przy zoomie bliskim (--abBlisko) i
//   w przelocie (--abLot). Liczby wariantu wobec średniej sąsiednich okien bazy.
// Warianty S0–S5 (2026-10-29): DAWNE zachowanie gazu i mgły na żywo (S0 zegar, S1 okno przy kamerze, S2 bez drabiny map
//   i ośrodka, S3 ciśnienie od zera, S4 klatka Core3D.fx po taktach rAF workera, S5 dawny zanik) — baza = nowy kod;
//   --kolkoAb S2 powtarza okno ząbków kółka z wariantem.
// Warianty poprawek wydajności pola (2026-10-29, docs/AUDYT-wydajnosc-baza-gpu-2026-10-28.md § 9) — DAWNE zachowanie:
//   C5off (passy czyszczenia three), R1off (rozwiązanie MSAA w każdym passie), CRoff (oba), L0 (kolejka koszyków LOD),
//   Z0 (bez znaczka głębi skał gry), V0 (dawna zasłona), STARE (wszystkie). Sondy kosztu skał: LODREV, SORT, FLATB, FLATP
//   (trywialny fragment skał tła / gry — koszt fragmentów). Po oknach postoju: rozkład skał w kadrze (STAT_SKAL — koszyki
//   LOD, suma pól rzutów, drobne skały).
// --obrazAB Z0,V0,…: obraz A/B w pauzie — bufor sceny odczytany w workerze (A, A2 — kontrola, B — wariant; równe odstępy),
//   piksele różne, siatka 16 × 4, próbki i nakładanie masek różnic wariantów (np. Z0 ∩ B1p — pokrycie skał gry).
// --zrzutyAB <katalog>: zrzuty PNG A/B przełączników zmian wyglądu (stara wartość ↔ nowa) w tym samym kadrze — opis przy
//   ZAB_PAUZA niżej (w pauzie: zanik S5, obwiednia, brzeg pyłu, drabina S2, poprawki pola STARE; w locie: okno pola S1,
//   ciśnienie S3; --rampaAB 1 — rampa zoomu w pauzie dla drabiny teksla). Bez okien: --okna brak --kolko 0 --ab 0.
// --okno 0 (domyślnie, 2026-10-29: „testy rób headless, bo pracuję”) — Chrome headless: bez okna na ekranie i bez vsync,
//   więc obraz / s nie ma sufitu 240 i przy karcie zajętej w 100% ms na obraz (1000 / obraz) = czas karty na klatkę razem
//   z pracą bez znaczników (porównuj czasy GPU / CPU, kolejkę, wysyłki i A/B, nie kl/s z monitorem 240 Hz).
//   --okno 1 — pełnoekranowe okno z vsync jak u gracza (tylko przy wolnym komputerze: zasłania ekran).
// --chrome gracz: Chrome bez flag harnessu (--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU) — jak u gracza.
// --devFeatures 1 (domyślnie): --enable-webgpu-developer-features (znaczniki czasu GPU bez kwantyzacji do 100 µs).
// --balastGb N: osobny Chrome zajmuje N GB pamięci karty (balastVram.mjs) przed oknami głównymi.
// --cisza S: przed startem czeka, aż przez S s nie działa żaden inny harness (`node scripts/….mjs`, Chrome z
//   --remote-debugging-port), sprawdzając co 5 s; zajęta maszyna — czeka najwyżej --ciszaMaks s (co 30 s).
// Raport: <out>/raport.json (+ zrzuty PNG). Pomiar tylko przy wolnej maszynie (stan nvidia-smi i procesy w raporcie).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { parseArgs, startVite, startChrome, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { SONDA_INSTALUJ, SONDA_CZYTAJ, stanMaszyny, analizaSladu } from './sondaGpuWorkera.mjs';
import { startVramBallast } from './balastVram.mjs';

const args = parseArgs();
const [W, H] = String(args.rozmiar || '5120x1440').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/gpu-pas-baza');
mkdirSync(out, { recursive: true });
const QUERY = args.query !== undefined ? String(args.query) : 'grafika=wysoka';
const query = QUERY ? `&${QUERY}` : '';
const OKNO = String(args.okno ?? '0') === '1';
const RYTM = String(args.rytm ?? '1') === '1';
const SLAD = Number(args.slad ?? 3);
const OKNO_S = Number(args.oknoS || 5);
const AB_S = Number(args.abS || 3.5);
const AB_POWT = Number(args.abPowt || 1);
const ATLAS_LEN = 3000;   // HULL_RENDER_PROFILES.atlas.length
const ZB = Number(args.zoomBlisko || (0.2 * W / ATLAS_LEN));   // domyślny kadr Atlasa (cameraRig hullScreenFraction 0,2)
const ZS = Number(args.zoomSrednio || 0.15);
const ZD = Number(args.zoomDaleko || (200 / ATLAS_LEN));        // okręt ~200 px — zrzut użytkownika
const ZM = Number(args.zoomMaks || 0.035);                       // minZoom kamery
const CHROME_TRYB = String(args.chrome || 'harness');
const DEV_FEATURES = String(args.devFeatures ?? '1') === '1';
const CISZA = Number(args.cisza ?? 30);
const CISZA_MAKS = Number(args.ciszaMaks ?? 1200);
const BALAST_GB = Number(args.balastGb || 0);
const listaArg = (v, def) => (v === undefined || v === '1' ? def : v === '0' ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const tStart = Date.now();
let balast = null;
// strażnik czasu liczony od końca czekania na ciszę (czekanie trwa do --ciszaMaks s)
let watchdog = null;

// ── WARIANTY A/B (kod workera: C = Core3D workera, S = stan workera; kod strony — w oknie strony) ─────────────────
const C5_KOD = `const r = C.renderer; if (!r.__c5) { const o = r.__c5 = { clear: r.clear, render: r.render, pend: null };
  r.clear = function (c = true, d = true, s = true) { if (d && this.getRenderTarget() === C.composerTarget) { o.pend = { c: !!c, s: !!s }; return this; } return o.clear.call(this, c, d, s); };
  r.render = function (scene, camera) { const p = o.pend; if (!p || this.getRenderTarget() !== C.composerTarget) return o.render.call(this, scene, camera);
    o.pend = null; const a = [this.autoClear, this.autoClearColor, this.autoClearDepth, this.autoClearStencil];
    this.autoClear = true; this.autoClearColor = p.c; this.autoClearDepth = true; this.autoClearStencil = p.s;
    try { return o.render.call(this, scene, camera); } finally { this.autoClear = a[0]; this.autoClearColor = a[1]; this.autoClearDepth = a[2]; this.autoClearStencil = a[3]; } }; }`;
const C5_PRZYWROC = `const r = C.renderer, o = r.__c5; if (o) { r.clear = o.clear; r.render = o.render; delete r.__c5; }`;
const WARIANTY = {
  G0: { opis: 'gaz wył. (wejście gry; płytka mgła pasa wraca)', strona: 'window.SpaceGasInputTune.enabled = false', stronaPrzywroc: 'window.SpaceGasInputTune.enabled = true', po: 4 },
  G1: { opis: 'pył gazu wył.', wk: 'S.spaceGas.tune.dust = false', wkPrzywroc: 'S.spaceGas.tune.dust = true' },
  G2: { opis: 'pole gazu wył. (samo pole dalekie, bez pyłu)', wk: 'S.spaceGas.tune.sim = false', wkPrzywroc: 'S.spaceGas.tune.sim = true', po: 2 },
  G3: { opis: 'warstwy gazu niewidoczne (pole, mapy i pył liczone)', wk: 'S.spaceGas.layer.setVisible = function () { this.lower.visible = this.upper.visible = false; }', wkPrzywroc: 'delete S.spaceGas.layer.setVisible' },
  G4: { opis: 'obraz gazu zgaszony fadeView (pole i mapy liczone, płytka mgła wraca)', wk: 'S.spaceGas.tune.fadeView = [1, 2]', wkPrzywroc: 'S.spaceGas.tune.fadeView = [40000, 80000]' },
  B0: { opis: 'pas wył.', wk: 'S.belt.setEnabled(false)', wkPrzywroc: 'S.belt.setEnabled(true)', ustal: 3, po: 5 },
  B1: { opis: 'skały i minerały niewidoczne', wk: 'S.belt.layers.forEach((L) => L.setVisible(false))', wkPrzywroc: 'S.belt.layers.forEach((L) => L.setVisible(true))', po: 2 },
  B1t: { opis: 'warstwy skał w perspektywie (RUBBLE, MID, DEEP) niewidoczne', wk: 'S.belt.layers.slice(1).forEach((L) => L.setVisible(false))', wkPrzywroc: 'S.belt.layers.slice(1).forEach((L) => L.setVisible(true))', po: 2 },
  // rozbicie skał na warstwy (pass gry: PLAY + minerały; pass tła: RUBBLE / MID / DEEP osobno)
  B1p: { opis: 'warstwa skał PLAY (pass gry) z minerałami niewidoczna', wk: 'S.belt.layers[0].setVisible(false)', wkPrzywroc: 'S.belt.layers[0].setVisible(true)', po: 2 },
  B1m: { opis: 'minerały warstwy PLAY niewidoczne', wk: 'S.belt.playMinerals.setVisible(false)', wkPrzywroc: 'S.belt.playMinerals.setVisible(true)', po: 1 },
  B1r: { opis: 'warstwa skał RUBBLE (tło) niewidoczna', wk: 'S.belt.layers[1].setVisible(false)', wkPrzywroc: 'S.belt.layers[1].setVisible(true)', po: 2 },
  B1s: { opis: 'warstwa skał MID (tło) niewidoczna', wk: 'S.belt.layers[2].setVisible(false)', wkPrzywroc: 'S.belt.layers[2].setVisible(true)', po: 2 },
  B1d: { opis: 'warstwa skał DEEP (tło) niewidoczna', wk: 'S.belt.layers[3].setVisible(false)', wkPrzywroc: 'S.belt.layers[3].setVisible(true)', po: 2 },
  FX: { opis: 'klatka Core3D.fx przy KAŻDYM renderze workera (bez pomijania przy tym samym info.frame)', gaz: true,
    wk: 'const fx = C.fx; if (!fx.__f0) { const f0 = fx.__f0 = fx.frame; fx.frame = function () { this.frameId = -1; return f0.apply(this, arguments); }; }',
    wkPrzywroc: 'const fx = C.fx; if (fx.__f0) { fx.frame = fx.__f0; delete fx.__f0; }' },
  B2: { opis: 'płaty mgły pasa wył.', wk: 'S.belt.fog.setVisible(false)', wkPrzywroc: 'S.belt.fog.setVisible(true)' },
  // poprawki gazu i mgły 2026-10-29 — DAWNE zachowanie na żywo (wariant = stary kod, baza = nowy)
  S0: { opis: 'gaz: dawny zegar (dt strony, własny akumulator kroku)', gaz: true, wk: 'S.spaceGas.tune.clock = false', wkPrzywroc: 'S.spaceGas.tune.clock = true' },
  S1: { opis: 'gaz: dawne okno pola przy kamerze (bez wstrząsu)', gaz: true, sladRufa: true, strona: 'window.SpaceGasInputTune.followShip = false', stronaPrzywroc: 'window.SpaceGasInputTune.followShip = true', po: 2 },
  S2: { opis: 'gaz i ośrodek pasa: teksel / kolumna wprost z kadru (bez drabiny)', gaz: true, wk: 'S.spaceGas.tune.texelLadder = false; S.belt.volume.tune.cellLadder = false', wkPrzywroc: 'S.spaceGas.tune.texelLadder = true; S.belt.volume.tune.cellLadder = true' },
  S3: { opis: 'gaz: przesunięcie okna zeruje ciśnienie', gaz: true, wk: 'S.spaceGas.sim.tune.shiftPrs = 0; S.spaceGas.sim.syncTune()', wkPrzywroc: 'S.spaceGas.sim.tune.shiftPrs = 1; S.spaceGas.sim.syncTune()' },
  S4: { opis: 'klatka Core3D.fx po taktach rAF workera (dawniej — bez klucza strony)', gaz: true, wk: 'S.fxPerPage = false', wkPrzywroc: 'S.fxPerPage = true' },
  S5: { opis: 'gaz: dawny zanik max(pół szer., pół wys.)', gaz: true, wk: 'S.spaceGas.tune.fadeAspect = 0', wkPrzywroc: 'S.spaceGas.tune.fadeAspect = 16 / 9' },
  B3: { opis: 'ośrodek objętościowy pasa wył.', wk: 'S.belt.volume.setVisible(false)', wkPrzywroc: 'S.belt.volume.setVisible(true)' },
  B4: { opis: 'zasłona pasa wył.', wk: 'S.belt._updateVeil = function () { this.veil.setVisible(false); }', wkPrzywroc: 'delete S.belt._updateVeil' },
  B6: { opis: 'atlas cieni reflektorów wył.', wk: 'S.belt.atlas.enabled = false', wkPrzywroc: 'S.belt.atlas.enabled = true' },
  B8: { opis: 'pole przesłaniania słońca wył.', wk: 'C.__sof = C.setSunOcclusionField; C.setSunOcclusionField = function () {}; C.clearSunOcclusionField()', wkPrzywroc: 'C.setSunOcclusionField = C.__sof' },
  B9: { opis: 'burza pasa wył.', wk: 'S.belt.storm.setVisible(false)', wkPrzywroc: 'S.belt.storm.setVisible(true)' },
  K0: { opis: 'pas i gaz wył. (sam okręt w próżni)', strona: 'window.SpaceGasInputTune.enabled = false', stronaPrzywroc: 'window.SpaceGasInputTune.enabled = true',
    wk: 'S.belt.setEnabled(false)', wkPrzywroc: 'S.belt.setEnabled(true)', ustal: 3, po: 5 },
  C1: { opis: 'bloom wył.', wk: 'C.perfToggles.bloom = false', wkPrzywroc: 'C.perfToggles.bloom = true' },
  C2: { opis: 'smugi cieni (maska słońca) wył.', wk: 'C.perfToggles.shadowShafts = false', wkPrzywroc: 'C.perfToggles.shadowShafts = true' },
  C3: { opis: 'pass tła wył.', wk: 'C.perfToggles.bgPass = false; C._passTogglesDirty = true', wkPrzywroc: 'C.perfToggles.bgPass = true; C._passTogglesDirty = true' },
  C4: { opis: 'skala renderu 0,5', wk: 'C.__rs = C.renderScale; C.setRenderScale(0.5)', wkPrzywroc: 'C.setRenderScale(C.__rs)', ustal: 2, po: 2 },
  C5: { opis: 'czyszczenie w passie sceny (bez passów clear three i ich rozwiązań MSAA)', wk: C5_KOD, wkPrzywroc: C5_PRZYWROC },
  P1: { opis: 'HUD strony ukryty (nakładki 2D)', strona: 'window.StoryGame.hudHidden = true', stronaPrzywroc: 'window.StoryGame.hudHidden = false' },
  P2: { opis: 'pacer: wiek obrazu najwyżej 3', strona: 'const p = window.RenderWorkerHost.pacer; p.__ma = p.maxAge; p.maxAge = 3; if (p.age > 3) p.age = 3;',
    stronaPrzywroc: 'const p = window.RenderWorkerHost.pacer; p.maxAge = p.__ma;', ustal: 2 },
  // ── POPRAWKI WYDAJNOŚCI POLA (2026-10-29) — DAWNE zachowanie na żywo (wariant = stary kod, baza = nowy) ──
  C5off: { opis: 'dawne passy czyszczenia three (renderer.clear przed passem sceny)', wk: 'C.clearInPass = false', wkPrzywroc: 'C.clearInPass = true' },
  R1off: { opis: 'dawne rozwiązanie MSAA celu sceny w KAŻDYM passie', wk: 'C.msaaResolveOnce = false', wkPrzywroc: 'C.msaaResolveOnce = true' },
  CRoff: { opis: 'dawne czyszczenie i rozwiązania MSAA (C5off + R1off)', wk: 'C.clearInPass = false; C.msaaResolveOnce = false', wkPrzywroc: 'C.clearInPass = true; C.msaaResolveOnce = true' },
  L0: { opis: 'dawna kolejka koszyków LOD skał (najmniejsze pierwsze)', wk: 'S.belt.setRockOrder(false)', wkPrzywroc: 'S.belt.setRockOrder(true)' },
  Z0: { opis: 'bez znaczka głębi skał gry przed passem tła', wk: 'S.belt.stampEnabled = false', wkPrzywroc: 'S.belt.stampEnabled = true' },
  V0: { opis: 'dawna zasłona pola (przed skałami, bez testu głębi)', wk: 'S.belt.veil.setDepthCull(false)', wkPrzywroc: 'S.belt.veil.setDepthCull(true)', ustal: 2.5, po: 2 },
  STARE: { opis: 'wszystkie poprawki pola wył. (CRoff + L0 + Z0 + V0)', ustal: 2.5, po: 2,
    wk: 'C.clearInPass = false; C.msaaResolveOnce = false; S.belt.setRockOrder(false); S.belt.stampEnabled = false; S.belt.veil.setDepthCull(false)',
    wkPrzywroc: 'C.clearInPass = true; C.msaaResolveOnce = true; S.belt.setRockOrder(true); S.belt.stampEnabled = true; S.belt.veil.setDepthCull(true)' },
  // wszystkie poprawki gazu i mgły naraz (dawne zachowanie z przełączników: S0–S5, obwiednia, brzeg pyłu) i razem z
  // poprawkami pola (STARE) — przestoje klatek workera i koszt CPU dawnego kodu w tym samym przebiegu
  GSTARE: { opis: 'wszystkie poprawki gazu wył. (S0–S5 + obwiednia + brzeg pyłu)', gaz: true, ustal: 2, po: 2,
    strona: 'window.SpaceGasInputTune.followShip = false; window.SpaceGasInputTune.envCover = false',
    stronaPrzywroc: 'window.SpaceGasInputTune.followShip = true; window.SpaceGasInputTune.envCover = true',
    wk: 'S.spaceGas.tune.clock = false; S.spaceGas.tune.texelLadder = false; S.belt.volume.tune.cellLadder = false; S.spaceGas.sim.tune.shiftPrs = 0; S.spaceGas.sim.syncTune(); S.fxPerPage = false; S.spaceGas.tune.fadeAspect = 0; S.spaceGas.tune.dustEdge = false',
    wkPrzywroc: 'S.spaceGas.tune.clock = true; S.spaceGas.tune.texelLadder = true; S.belt.volume.tune.cellLadder = true; S.spaceGas.sim.tune.shiftPrs = 1; S.spaceGas.sim.syncTune(); S.fxPerPage = true; S.spaceGas.tune.fadeAspect = 16 / 9; S.spaceGas.tune.dustEdge = true' },
  WSZYSTKO: { opis: 'wszystkie poprawki gazu i pola wył. (GSTARE + STARE)', gaz: true, ustal: 2.5, po: 2,
    strona: 'window.SpaceGasInputTune.followShip = false; window.SpaceGasInputTune.envCover = false',
    stronaPrzywroc: 'window.SpaceGasInputTune.followShip = true; window.SpaceGasInputTune.envCover = true',
    wk: 'S.spaceGas.tune.clock = false; S.spaceGas.tune.texelLadder = false; S.belt.volume.tune.cellLadder = false; S.spaceGas.sim.tune.shiftPrs = 0; S.spaceGas.sim.syncTune(); S.fxPerPage = false; S.spaceGas.tune.fadeAspect = 0; S.spaceGas.tune.dustEdge = false; C.clearInPass = false; C.msaaResolveOnce = false; S.belt.setRockOrder(false); S.belt.stampEnabled = false; S.belt.veil.setDepthCull(false)',
    wkPrzywroc: 'S.spaceGas.tune.clock = true; S.spaceGas.tune.texelLadder = true; S.belt.volume.tune.cellLadder = true; S.spaceGas.sim.tune.shiftPrs = 1; S.spaceGas.sim.syncTune(); S.fxPerPage = true; S.spaceGas.tune.fadeAspect = 16 / 9; S.spaceGas.tune.dustEdge = true; C.clearInPass = true; C.msaaResolveOnce = true; S.belt.setRockOrder(true); S.belt.stampEnabled = true; S.belt.veil.setDepthCull(true)' },
  // pseudo-wariant bez przełączeń — okna nowego kodu w sekwencji --oknaWariant (np. WSZYSTKO,NOWE,WSZYSTKO)
  NOWE: { opis: 'nowy kod (bez przełączeń)' },
  // ── SONDY KOSZTU SKAŁ (2026-10-29, poprawki wydajności pola): kolejka rysowania skał i koszt fragmentów ──
  // LODREV: koszyki LOD każdej warstwy od NAJWIĘKSZYCH na ekranie (renderOrder) — dziś lod0 (najmniejsze) idą pierwsze,
  //   więc duże skały przykrywają już cieniowane małe (early-z nie odrzuca).
  LODREV: { opis: 'sonda: koszyki LOD skał od największych na ekranie (renderOrder)',
    wk: 'const B = S.belt; B.__ro = []; B.layers.forEach((L, li) => { const base = li === 0 ? 1 : 2 + (li - 1) * 0.1; for (const bk of [L.buckets, L.moonBuckets]) for (const d of bk.lods) { B.__ro.push([d.mesh, d.mesh.renderOrder]); d.mesh.renderOrder = base + (5 - d.index) * 0.01; } })',
    wkPrzywroc: 'for (const [m, r] of S.belt.__ro) m.renderOrder = r; S.belt.__ro = []' },
  // SORT: instancje w każdym koszyku od najbliższych kamerze (z + r malejąco) — przebudowa koszyków wymuszona
  SORT: { opis: 'sonda: instancje w koszykach skał od najbliższych (z + r)', ustal: 1.5, po: 1.5,
    wk: `const B = S.belt; const sortB = (lv) => { const n = lv.count; if (n < 2) return; const d = lv.data, F = 20; const key = new Float32Array(n); const idx = []; for (let i = 0; i < n; i++) { idx.push(i); key[i] = d[i * F + 2] + d[i * F + 3]; } idx.sort((a, b) => key[b] - key[a]); const c = d.slice(0, n * F); for (let j = 0; j < n; j++) d.set(c.subarray(idx[j] * F, idx[j] * F + F), j * F); };
      for (const L of B.layers) { const bk = L.buckets; if (!bk.__c0) { bk.__c0 = bk.commit; bk.commit = function () { for (const lv of this.lods) sortB(lv); return this.__c0(); }; } L._built.version = -1; }`,
    wkPrzywroc: 'for (const L of S.belt.layers) { const bk = L.buckets; if (bk.__c0) { delete bk.commit; delete bk.__c0; } L._built.version = -1; }' },
  // FLATB / FLATP: skały tła / PLAY z trywialnym fragmentem (materiał mapy cienia — te same wierzchołki, ta sama kolejka
  //   i stan głębi) — koszt fragmentów skał = baza − sonda (reszta: wierzchołki, raster, nadmiarowe cieniowanie kwadów).
  //   Nowe pipeline'y kompilują się synchronicznie przy pierwszym rysunku (sonda — nie w grze).
  FLATB: { opis: 'sonda: skały tła z trywialnym fragmentem (koszt fragmentów)', ustal: 3, po: 1.5,
    wk: 'const B = S.belt, SM = B.atlas.maps[0].mesh.material.constructor; B.__fm = B.__fm || []; for (const L of B.layers.slice(1)) { const m = L.__flat || (L.__flat = new SM(L.material)); m.transparent = true; m.blending = 0; m.depthWrite = true; m.depthTest = true; m.name = "sonda:flatB"; for (const bk of [L.buckets, L.moonBuckets]) for (const d of bk.lods) { B.__fm.push([d.mesh, d.mesh.material]); d.mesh.material = m; } }',
    wkPrzywroc: 'for (const [m, mat] of S.belt.__fm) m.material = mat; S.belt.__fm = []' },
  FLATP: { opis: 'sonda: skały PLAY z trywialnym fragmentem (koszt fragmentów)', ustal: 3, po: 1.5,
    wk: 'const B = S.belt, SM = B.atlas.maps[0].mesh.material.constructor; B.__fm = B.__fm || []; const L = B.layers[0]; const m = L.__flat || (L.__flat = new SM(L.material)); m.name = "sonda:flatP"; for (const bk of [L.buckets, L.moonBuckets]) for (const d of bk.lods) { B.__fm.push([d.mesh, d.mesh.material]); d.mesh.material = m; }',
    wkPrzywroc: 'for (const [m, mat] of S.belt.__fm) m.material = mat; S.belt.__fm = []' }
};

// OBRAZ A/B W PAUZIE (--obrazAB CRoff,…): bufor sceny (composerTarget po passach — HDR przed postem) odczytany w workerze:
// A, A2 (kontrola — co rusza się w pauzie: zegar efektów biegnie), B z wariantem — odstępy A → A2 i A2 → B równe (czas
// ustalenia wariantu). Wynik: piksele różne (którykolwiek kanał RGB) i największa różnica (półfloat) A–A2 oraz A2–B.
// Wariant bez zmiany obrazu: A2–B na poziomie kontroli A–A2.
const OBRAZ_CZYTAJ = (slot) => `(async () => {
  const C = globalThis.__C3, R = C.renderer, rt = C.composerTarget;
  const a = await R.readRenderTargetPixelsAsync(rt, 0, 0, rt.width, rt.height);
  (globalThis.__obraz || (globalThis.__obraz = {}))['${slot}'] = a;
  return { n: a.length, typ: a.constructor.name, w: rt.width, h: rt.height };
})()`;
const OBRAZ_ROZNICA = (s1, s2, maska = '') => `(() => {
  const O = globalThis.__obraz || {}, a = O['${s1}'], b = O['${s2}'];
  if (!a || !b || a.length !== b.length) return { blad: 'brak odczytu' };
  const M = '${maska}' ? ((globalThis.__obrazMaski || (globalThis.__obrazMaski = {}))['${maska}'] = new Uint8Array(a.length >> 2)) : null;
  const h2f = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024); };
  const half = a instanceof Uint16Array, val = (x) => (half ? h2f(x) : x);
  const W = globalThis.__C3.composerTarget.width, GX = 16, GY = 4, siatka = new Array(GX * GY).fill(0), probki = [];
  let px = 0, maks = 0, sum = 0; const n = a.length >> 2;
  for (let i = 0; i < n; i++) {
    const o = i * 4; let diff = false, dm = 0;
    for (let c = 0; c < 3; c++) if (a[o + c] !== b[o + c]) { diff = true; const d = Math.abs(val(a[o + c]) - val(b[o + c])); if (d > maks) maks = d; if (d > dm) dm = d; sum += d; }
    if (diff) {
      px++;
      if (M) M[i] = 1;
      const x = i % W, y = (i / W) | 0;
      siatka[Math.min(GY - 1, (y * GY / (n / W)) | 0) * GX + Math.min(GX - 1, (x * GX / W) | 0)]++;
      if (probki.length < 24 && (px % 97) === 1) probki.push([x, y, +dm.toFixed(4), [0, 1, 2].map((c) => +val(a[o + c]).toFixed(4)), [0, 1, 2].map((c) => +val(b[o + c]).toFixed(4))]);
    }
  }
  return { pikseli: n, rozne: px, rozneProc: +(100 * px / n).toFixed(4), maks: +maks.toFixed(5), srednia: +(sum / n).toFixed(7), siatka16x4: siatka, probki };
})()`;

// Rozkład skał w kadrze (koniec okna): instancje na koszyk LOD, suma pól rzutów [px bufora] wobec ekranu (nadmiar
// rysowania), liczba skał drobnych (promień < 2 / 4 / 9 px — trójkąty siatki LOD0 mniejsze od kwadu 2 × 2)
const STAT_SKAL = `(() => {
  const S = globalThis.__ST, C = globalThis.__C3, B = S.belt;
  if (!B || !B.layers) return null;
  const f = B._frame, v = B._view, zoom = v.zoom, focal = f.focalPx, camZ = focal / zoom;
  const W = C.composerTarget.width, H = C.composerTarget.height;
  const out = { ekranPx: W * H, zoom: +zoom.toFixed(4), camZ: Math.round(camZ), warstwy: [] };
  B.layers.forEach((L) => {
    const persp = L.perspective;
    const w = { pasmo: L.band.id, lod: [0, 0, 0, 0, 0, 0], poleLod: [0, 0, 0, 0, 0, 0], pole: 0, ponizej2px: 0, ponizej4px: 0, ponizej9px: 0, n: 0 };
    for (const bk of [L.buckets, L.moonBuckets]) bk.lods.forEach((d, i) => {
      let area = 0;
      for (let s = 0; s < d.count; s++) {
        const b = s * 20, r = d.data[b + 3], z = d.data[b + 2];
        const rPx = r * (persp ? focal / Math.max(1, camZ - z) : zoom);
        const st = (d.data[b + 16] + d.data[b + 17] + d.data[b + 18]) / 3;
        area += Math.PI * rPx * rPx * st * st;
        if (rPx < 2) w.ponizej2px++; else if (rPx < 4) w.ponizej4px++; else if (rPx < 9) w.ponizej9px++;
      }
      w.lod[i] += d.count; w.poleLod[i] = Math.round(w.poleLod[i] + area); w.pole += area; w.n += d.count;
    });
    w.pole = Math.round(w.pole); w.udzialEkranu = +(w.pole / (W * H)).toFixed(3);
    out.warstwy.push(w);
  });
  return out;
})()`;
// ── ZRZUTY A/B (--zrzutyAB <katalog>, 2026-10-29): przełączniki zmian wyglądu poprawek gazu i pola (stara wartość ↔ nowa)
// w tym samym kadrze — zrzuty PNG strony do oceny okiem, z danymi kadru (zanik, pokrycie kadru oknem, płaty mgły, ślad za
// rufą). Dla każdego zoomu z --zoomyAB (blisko, srednio, daleko, max):
//  1) przelot od miejsca „pole”: pole gazu od nowa (requestReset; sprężyna śladu okna na stronie wyzerowana w trzymaniu —
//     każdy przelot startuje z tego samego stanu), rozgrzanie 3 s, ciąg W przez --lotAB s, PAUZA (ten sam stan gry i kadr):
//     `nowe`, `nowe-kontrola` (szum pauzy — zegar efektów biegnie), dla każdego przełącznika ZAB_PAUZA `<n>-stare` (potem
//     przywrócenie), `nowe-koniec`;
//  2) przełączniki zależne od historii pola (ZAB_LOT: S1 — okno pola przy kamerze, S3 — ciśnienie od zera przy
//     przesunięciu) — drugi przelot ze starą wartością i trzeci (kontrola lot ↔ lot) z nową, pauza po tym samym czasie;
//  3) --rampaAB 1: rampa zoomu w pauzie przy zoomie bliskim (drabina teksla S2: okręt trzymany, zoom × 1,006 na kadr —
//     tempo sprężyny po ząbku kółka) dla nowe i stare, kadry `rampa-<strona>-NN` z kamerą (obróbka: skrypt poza grą).
const ZAB_PAUZA = [
  { n: 'S5', opis: 'gaz: dawny zanik przy oddaleniu — max(pół szer., pół wys.): 32:9 gaśnie od zoomu 0,064, płytkie płaty mgły pasa wracają', wk: 'S.spaceGas.tune.fadeAspect = 0', wkP: 'S.spaceGas.tune.fadeAspect = 16 / 9' },
  { n: 'ENV', opis: 'gaz: dawna siatka obwiedni (samo okno × 1,3 — przy oddaleniu mapa sięga poza siatkę, pole dalekie z rozmazanego brzegu)', strona: 'window.SpaceGasInputTune.envCover = false', stronaP: 'window.SpaceGasInputTune.envCover = true', ustal: 2.5 },
  { n: 'PYL', opis: 'pył gazu: dawny twardy brzeg okna pola', wk: 'S.spaceGas.tune.dustEdge = false', wkP: 'S.spaceGas.tune.dustEdge = true' },
  { n: 'S2', opis: 'gaz i ośrodek pasa: teksel map / kolumna ośrodka wprost z kadru (bez drabiny) — w pauzie tylko inny teksel; drganie widać w rampie', wk: 'S.spaceGas.tune.texelLadder = false; S.belt.volume.tune.cellLadder = false', wkP: 'S.spaceGas.tune.texelLadder = true; S.belt.volume.tune.cellLadder = true' },
  { n: 'STARE', opis: 'poprawki wydajności pola wył. (CRoff + L0 + Z0 + V0) — obraz ma być ten sam', wk: 'C.clearInPass = false; C.msaaResolveOnce = false; S.belt.setRockOrder(false); S.belt.stampEnabled = false; S.belt.veil.setDepthCull(false)',
    wkP: 'C.clearInPass = true; C.msaaResolveOnce = true; S.belt.setRockOrder(true); S.belt.stampEnabled = true; S.belt.veil.setDepthCull(true)', ustal: 2.5 }
];
const ZAB_LOT = { blisko: ['S3'], srednio: ['S1'], daleko: ['S1'], max: ['S1'] };
const AB_DALEKO = listaArg(args.ab, ['G0', 'G1', 'G2', 'G3', 'G4', 'B0', 'B1', 'B1t', 'B1p', 'B1m', 'B1r', 'B1s', 'B1d', 'B2', 'B3', 'B4', 'B6', 'B8', 'B9', 'K0', 'C1', 'C2', 'C3', 'C4', 'C5', 'P1', 'P2', 'FX']);
const AB_BLISKO = args.ab === '0' ? [] : listaArg(args.abBlisko, ['G0', 'B0', 'B1', 'B1p', 'B1t', 'B2', 'B3', 'K0', 'C3', 'C4', 'C5']);
const AB_LOT = args.ab === '0' ? [] : listaArg(args.abLot, ['G0', 'B0', 'K0', 'C5', 'FX']);
const AB_SLAD = new Set(String(args.abSlad || 'baza,G0,B0,K0,C5').split(','));
for (const n of [...AB_DALEKO, ...AB_BLISKO, ...AB_LOT]) if (!WARIANTY[n]) { console.error('nieznany wariant', n); process.exit(1); }

const report = {
  args, tryb: OKNO ? 'okno z vsync' : 'headless (bez vsync)', rozmiar: [W, H], zoomy: { blisko: ZB, srednio: ZS, daleko: ZD, maks: ZM }, chrome: CHROME_TRYB, devFeatures: DEV_FEATURES,
  cisza: null, maszynaStart: null, okna: [], slady: {}, ab: [], abPodsumowanie: [], gaz: {}, oddalenie: {}, slad: {}, skaly: {}, obrazAB: [], zrzuty: [],
  obceWTrakcie: [], wkLogi: [], strona: [], bledy: []
};

// ── maszyna: obce harnessy, nvidia-smi, liczniki Windows ─────────────────────────────────────────────────────────
function psRun(cmd, timeoutMs = 30000) {
  return new Promise((ok) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { maxBuffer: 64 << 20, windowsHide: true, timeout: timeoutMs },
      (err, stdout) => ok(String(stdout || '')));
  });
}
let mojPort = null;
async function obceProcesy() {
  const txt = await psRun(`Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='chrome.exe' OR Name='electron.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.CommandLine)" }`);
  const rows = [];
  for (const line of txt.split(/\r?\n/)) {
    const i1 = line.indexOf('|'), i2 = line.indexOf('|', i1 + 1);
    if (i1 < 0 || i2 < 0) continue;
    const pid = Number(line.slice(0, i1)), name = line.slice(i1 + 1, i2).toLowerCase(), cmd = line.slice(i2 + 1);
    if (!cmd || pid === process.pid) continue;
    if (name === 'node.exe' && /scripts[\\/][^"'\s]*\.mjs/i.test(cmd) && !/scripts[\\/]webgpu[\\/]gpu-pas-gra\.mjs/i.test(cmd)) rows.push({ pid, cmd: cmd.slice(0, 220) });
    else if (name === 'node.exe' && /scripts[\\/]webgpu[\\/]gpu-pas-gra\.mjs/i.test(cmd)) rows.push({ pid, cmd: cmd.slice(0, 220) });   // drugi egzemplarz tego narzędzia
    else if (name !== 'node.exe') {
      const m = /--remote-debugging-port=(\d+)/.exec(cmd);
      if (m && (mojPort === null || Number(m[1]) !== mojPort)) rows.push({ pid, cmd: cmd.slice(0, 220) });
    }
  }
  return rows;
}
async function czekajNaCisze() {
  if (!(CISZA > 0)) return { pominieta: true };
  const t0 = Date.now();
  let quietFrom = Date.now(), last = [];
  const log = [];
  for (;;) {
    const obce = await obceProcesy();
    if (obce.length) {
      last = obce;
      if (!log.length || log[log.length - 1].n !== obce.length) log.push({ s: Math.round((Date.now() - t0) / 1000), n: obce.length, obce: obce.slice(0, 4) });
      console.log(`cisza: zajęte (${obce.length}) — ${obce.slice(0, 2).map((o) => o.cmd.slice(0, 90)).join(' | ')}`);
      if (Date.now() - t0 > CISZA_MAKS * 1000) return { czekano_s: Math.round((Date.now() - t0) / 1000), zajete: true, log, ostatnie: last };
      await sleep(30000);
      quietFrom = Date.now();
      continue;
    }
    if (Date.now() - quietFrom >= CISZA * 1000) return { czekano_s: Math.round((Date.now() - t0) / 1000), zajete: false, log };
    await sleep(5000);
  }
}
async function topCpu() {
  const txt = await psRun(`Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 | ForEach-Object { "$($_.Name)|$([math]::Round($_.CPU,0))|$([int]($_.WorkingSet64/1MB))" }`);
  return txt.split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
}

/** nvidia-smi: zajętość, pamięć, moc, zegary, PCIe (co ms) + dmon (rxpci / txpci MB/s, sm %, mem %). */
function startSmi(ms = 500) {
  const samples = [], dm = [];
  const procs = [];
  try {
    const p = spawn('nvidia-smi', ['--query-gpu=utilization.gpu,utilization.memory,memory.used,power.draw,clocks.gr,clocks.mem,temperature.gpu,pcie.link.gen.current,pcie.link.width.current',
      '--format=csv,noheader,nounits', '-lms', String(ms)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    procs.push(p);
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const [u, um, mem, pw, clk, mclk, temp, gen, width] = line.split(',').map((x) => Number(x.trim()));
        if (Number.isFinite(u)) samples.push({ t: Date.now(), u, um, mem, pw, clk, mclk, temp, gen, width });
      }
    });
  } catch (_) { /* brak nvidia-smi */ }
  try {
    const p = spawn('nvidia-smi', ['dmon', '-s', 'ut', '-d', '1'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    procs.push(p);
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line || line.startsWith('#')) continue;
        const v = line.split(/\s+/).map(Number);
        // idx sm mem enc dec jpg ofa rxpci txpci
        if (v.length >= 9 && Number.isFinite(v[1])) dm.push({ t: Date.now(), sm: v[1], mem: v[2], rx: v[7], tx: v[8] });
      }
    });
  } catch (_) { /* brak dmon */ }
  return {
    samples, dm,
    okno(t0, t1 = Date.now()) {
      const a = samples.filter((s) => s.t >= t0 && s.t <= t1);
      const b = dm.filter((s) => s.t >= t0 && s.t <= t1 + 1000);
      if (!a.length) return null;
      const avg = (arr, k) => (arr.length ? +(arr.reduce((x, s) => x + (Number.isFinite(s[k]) ? s[k] : 0), 0) / arr.length).toFixed(1) : null);
      const max = (arr, k) => (arr.length ? Math.max(...arr.map((s) => (Number.isFinite(s[k]) ? s[k] : 0))) : null);
      return { n: a.length, zajetosc: avg(a, 'u'), zajetoscMaks: max(a, 'u'), pamiecKontr: avg(a, 'um'), pamiecMB: avg(a, 'mem'), pamiecMaksMB: max(a, 'mem'),
        mocW: avg(a, 'pw'), zegarMHz: avg(a, 'clk'), zegarPamMHz: avg(a, 'mclk'), pcie: a[a.length - 1].gen + 'x' + a[a.length - 1].width,
        dmon: b.length ? { n: b.length, sm: avg(b, 'sm'), mem: avg(b, 'mem'), rxMBs: avg(b, 'rx'), txMBs: avg(b, 'tx'), rxMaks: max(b, 'rx'), txMaks: max(b, 'tx') } : null };
    },
    stop() { for (const p of procs) { try { p.kill(); } catch (_) {} } }
  };
}

/** Liczniki Windows (Get-Counter co 1 s): pamięć GPU procesu GPU Chrome i karty (dedykowana / współdzielona), silniki. */
function startLiczniki(gpuPid) {
  const samples = [];
  const dwmPs = '(Get-Process dwm | Select-Object -First 1).Id';
  // bez pid procesu GPU Chrome (0) — tylko karta i dwm (ścieżka bez instancji psuje całe Get-Counter)
  const procCnt = gpuPid > 0 ? `('\\GPU Process Memory(pid_{0}_*)\\Dedicated Usage' -f $gp), ('\\GPU Process Memory(pid_{0}_*)\\Shared Usage' -f $gp), ('\\GPU Engine(pid_{0}_*)\\Utilization Percentage' -f $gp), ` : '';
  const ps = `$gp = ${gpuPid}; $d = ${dwmPs}; $c = @(${procCnt}'\\GPU Adapter Memory(*)\\Dedicated Usage', '\\GPU Adapter Memory(*)\\Shared Usage', ('\\GPU Engine(pid_{0}_*engtype_3D)\\Utilization Percentage' -f $d)); Get-Counter -Counter $c -SampleInterval 1 -Continuous -ErrorAction SilentlyContinue | ForEach-Object { $t = [DateTimeOffset]::new($_.Timestamp).ToUnixTimeMilliseconds(); foreach ($s in $_.CounterSamples) { '{0}|{1}|{2}' -f $t, $s.Path, [math]::Round($s.CookedValue, 1) } }`;
  let proc = null;
  try {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const p = line.split('|');
        if (p.length !== 3) continue;
        const t = Number(p[0]), v = Number(String(p[2]).replace(',', '.'));
        if (Number.isFinite(t) && Number.isFinite(v)) samples.push({ t, path: p[1].toLowerCase(), v });
      }
    });
  } catch (_) { proc = null; }
  return {
    samples,
    okno(t0, t1 = Date.now()) {
      const a = samples.filter((s) => s.t >= t0 - 500 && s.t <= t1 + 500);
      if (!a.length) return null;
      const byT = new Map();
      for (const s of a) { let m = byT.get(s.t); if (!m) byT.set(s.t, m = []); m.push(s); }
      const rows = [];
      for (const [, list] of byT) {
        const r = { chromeDed: 0, chromeShared: 0, kartaDed: 0, kartaShared: 0, dwm3D: 0, silniki: {} };
        for (const s of list) {
          if (s.path.includes('gpu process memory') && s.path.includes('dedicated usage')) r.chromeDed = Math.max(r.chromeDed, s.v);
          else if (s.path.includes('gpu process memory') && s.path.includes('shared usage')) r.chromeShared = Math.max(r.chromeShared, s.v);
          else if (s.path.includes('gpu adapter memory') && s.path.includes('dedicated usage')) r.kartaDed = Math.max(r.kartaDed, s.v);
          else if (s.path.includes('gpu adapter memory') && s.path.includes('shared usage')) r.kartaShared = Math.max(r.kartaShared, s.v);
          else if (s.path.includes('gpu engine')) {
            const m = /pid_(\d+)_.*engtype_([a-z0-9_]+)\)/.exec(s.path);
            if (!m) continue;
            if (Number(m[1]) === gpuPid) r.silniki[m[2]] = (r.silniki[m[2]] || 0) + s.v;
            else r.dwm3D += s.v;
          }
        }
        rows.push(r);
      }
      const n = rows.length;
      const avg = (k) => +(rows.reduce((x, r) => x + r[k], 0) / n);
      const sil = {};
      for (const r of rows) for (const [k, v] of Object.entries(r.silniki)) sil[k] = (sil[k] || 0) + v / n;
      for (const k of Object.keys(sil)) sil[k] = +sil[k].toFixed(1);
      const MB = 1048576;
      return { n, chromeDedMB: Math.round(avg('chromeDed') / MB), chromeSharedMB: Math.round(avg('chromeShared') / MB),
        kartaDedMB: Math.round(avg('kartaDed') / MB), kartaSharedMB: Math.round(avg('kartaShared') / MB), dwm3D: +avg('dwm3D').toFixed(1), silnikiChrome: sil };
    },
    stop() { try { proc && proc.kill(); } catch (_) {} }
  };
}
// Ekran włączony na czas pomiaru (--okno 1): Chrome oznacza okno jako zasłonięte, gdy ekran zgasł po bezczynności
// (visibilityState 'hidden', rAF stoi — 2026-10-29 przebieg próbny stał na ekranie ładowania). Pomocnik trzyma
// SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) do końca przebiegu i budzi ekran
// ruchem myszy o 0 px (bez zmiany ustawień zasilania; po zamknięciu pomocnika system wraca do swoich limitów).
function startEkran() {
  const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class KeepScreen { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(int f); [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e); }'; [void][KeepScreen]::SetThreadExecutionState(-2147483645); [KeepScreen]::mouse_event(1, 0, 0, 0, [IntPtr]::Zero); 'ekran: ok'; while ($true) { Start-Sleep -Seconds 20; [void][KeepScreen]::SetThreadExecutionState(-2147483645) }`;
  let proc = null;
  try { proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true }); } catch (_) { proc = null; }
  return { stop() { try { proc && proc.kill(); } catch (_) {} } };
}
// Okno przeglądarki harnessu na cały ekran (0, 0, W, H) i nad innymi — --start-fullscreen bywa ignorowane, gdy Chrome
// startuje przy zgaszonym ekranie albo w tle innego okna.
async function oknoNaEkran(port) {
  const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinPos { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'; $b = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1; if (-not $b) { 'brak procesu'; exit }; $h = [IntPtr](Get-Process -Id $b.ProcessId).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { 'brak okna'; exit }; [void][WinPos]::ShowWindow($h, 9); [void][WinPos]::SetWindowPos($h, [IntPtr](-1), 0, 0, ${W}, ${H}, 0x0040); $r = New-Object WinPos+RECT; [void][WinPos]::GetWindowRect($h, [ref]$r); "okno $($r.L),$($r.T),$($r.R),$($r.B) widoczne=$([WinPos]::IsWindowVisible($h)) pierwszy_plan=$([WinPos]::GetForegroundWindow() -eq $h)"`;
  return (await psRun(ps)).trim();
}
// Proces GPU Chrome harnessu: dziecko procesu przeglądarki z naszym portem debugowania; zapasowo — proces GPU
// utworzony po starcie narzędzia (przebieg próbny 2026-10-29 nie znalazł dziecka po ParentProcessId → liczniki null).
async function znajdzProcesGpu(port) {
  const txt = await psRun(`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object { $t = 0; try { $t = [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } catch {}; "$($_.ProcessId)|$($_.ParentProcessId)|$t|$($_.CommandLine)" }`);
  const all = [];
  for (const line of txt.split(/\r?\n/)) {
    const p = line.split('|');
    if (p.length < 4) continue;
    all.push({ pid: Number(p[0]), ppid: Number(p[1]), t0: Number(p[2]), cmd: p.slice(3).join('|') });
  }
  const browsers = all.filter((r) => r.cmd.includes(`--remote-debugging-port=${port}`) && !/--type=/.test(r.cmd)).map((r) => r.pid);
  const gpus = all.filter((r) => /--type=gpu-process/.test(r.cmd));
  const ours = new Set(browsers);
  // potomkowie przeglądarki harnessu (gdyby proces GPU wisiał pod procesem pośrednim)
  for (let changed = true; changed;) {
    changed = false;
    for (const r of all) if (!ours.has(r.pid) && ours.has(r.ppid)) { ours.add(r.pid); changed = true; }
  }
  let gpu = gpus.find((r) => browsers.includes(r.ppid)) || gpus.find((r) => ours.has(r.pid)) || null;
  let jak = gpu ? 'rodzic' : null;
  if (!gpu) {
    const nowe = gpus.filter((r) => r.t0 >= tStart - 2000).sort((a, b) => b.t0 - a.t0);
    if (nowe.length) { gpu = nowe[0]; jak = nowe.length > 1 ? 'czas-niepewny' : 'czas'; }
  }
  return { browser: browsers[0] ?? null, browsers, gpu: gpu ? gpu.pid : null, jak,
    kandydaci: gpus.map((r) => ({ pid: r.pid, ppid: r.ppid, sOdStartu: Math.round((r.t0 - tStart) / 1000) })) };
}

// ── Vite, Chrome, CDP ───────────────────────────────────────────────────────────────────────────────────────────
report.cisza = await czekajNaCisze();
console.log('cisza:', JSON.stringify(report.cisza));
if (report.cisza.zajete) { console.error('maszyna zajęta przez inne pomiary — przerywam bez pomiaru'); writeJson(join(out, 'raport.json'), report); process.exit(3); }
watchdog = setTimeout(() => { console.error('STRAŻNIK: przebieg > 45 min — koniec'); report.bledy.push('strażnik czasu 45 min'); finish(2); }, 45 * 60 * 1000);
report.maszynaStart = { ...(await stanMaszyny()), topCpu: await topCpu() };
console.log('maszyna:', JSON.stringify(report.maszynaStart.gpu), report.maszynaStart.topCpu.slice(0, 5).map((r) => r.join(':')).join(' '));
const smi = startSmi(500);
const ekran = OKNO ? startEkran() : null;
const { server, base } = await startVite(Number(args.port || 5397));
const extraArgs = ['--no-first-run', '--no-default-browser-check'];
if (OKNO) extraArgs.push('--window-position=0,0', '--start-fullscreen', '--disable-backgrounding-occluded-windows');
if (DEV_FEATURES) extraArgs.push('--enable-webgpu-developer-features');
if (args.chromeArgs) extraArgs.push(...String(args.chromeArgs).split(' ').filter(Boolean));
const chrome = await startChrome({ width: W, height: H, renderMode: 'worker', headless: OKNO ? false : undefined,
  webgpu: CHROME_TRYB === 'gracz' ? false : undefined, extraArgs });
const { cdp } = chrome;
try { mojPort = Number(/:(\d+)\//.exec(cdp.ws.url)[1]); } catch (_) { mojPort = null; }
const ev = (e, t = 120000) => evaluate(cdp, e, t);
let liczniki = null;

const wk = { sid: null, id: 8000000 };
const wkSend = (method, params = {}, timeoutMs = 60000) => new Promise((ok, reject) => {
  if (!wk.sid) { reject(new Error('brak sesji workera')); return; }
  const id = ++wk.id;
  const timer = setTimeout(() => { cdp.pending.delete(id); reject(new Error(`limit ${method}`)); }, timeoutMs);
  cdp.pending.set(id, { ok: (r) => { clearTimeout(timer); ok(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  cdp.ws.send(JSON.stringify({ id, method, params, sessionId: wk.sid }));
});
const wkEval = async (expression, timeoutMs = 60000) => {
  const r = await wkSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const ti = msg.params?.targetInfo;
    if (ti?.type === 'worker' && /render\.worker/.test(ti.url || '')) { wk.sid = msg.params.sessionId; wkSend('Runtime.enable').catch(() => {}); }
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400);
    const row = { s: +((Date.now() - tStart) / 1000).toFixed(1), type: msg.params.type, text };
    if (msg.sessionId && msg.sessionId === wk.sid) { if (report.wkLogi.length < 400) report.wkLogi.push(row); }
    else if (!msg.sessionId && /warn|error/.test(msg.params.type) && report.strona.length < 200) report.strona.push(row);
  }
  if (msg.method === 'Runtime.exceptionThrown' && report.strona.length < 200) {
    report.strona.push({ s: +((Date.now() - tStart) / 1000).toFixed(1), type: 'exception', text: String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text).slice(0, 400) });
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
// gra swobodna (kampania domyślna blokuje start) + rejestrator odstępów rAF strony (histogram w odświeżeniach 240 Hz)
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}
(() => {
  const R = window.__rafRec = { n: 0, max: 0, slow: 0, last: 0, h: new Int32Array(10) };
  const raf = (t) => { if (R.last) { const d = t - R.last; R.n++; if (d > R.max) R.max = d; if (d > 50) R.slow++; R.h[Math.min(9, Math.round(d / (1000 / 240)))]++; } R.last = t; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
})();` });

const KEYS = { w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 } };
const down = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k] });
const up = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k] });

const GUARD = `(() => {
  if (window.__guard) return true;
  window.__guard = setInterval(() => {
    const s = window.ship;
    if (!s) return;
    if (s.hull) s.hull.val = s.hull.max;
    if (s.shield) s.shield.val = s.shield.max;
    if (window.fireControl) window.fireControl.posture = 'hold';
  }, 100);
  return true;
})()`;

// Atlas w gęstym polu (miejsce „pole” dema asteroid), trzymany pętlą rAF (__hold), kamera statku z zadanym zoomem
const NA_MIEJSCE = (z) => `(async () => {
  const Wd = await import('/dema/asteroidy-webgpu/world.js');
  const s = Wd.SPOTS.field;
  window.__hold = { x: s.x, y: s.y, heading: -0.4, on: true };
  if (!window.__holdLoop) {
    window.__holdLoop = true;
    const tick = () => {
      const H = window.__hold;
      if (H && H.on) { const p = window.ship; p.pos.x = H.x; p.pos.y = H.y; p.vel.x = 0; p.vel.y = 0; p.angle = H.heading; if (p.angVel !== undefined) p.angVel = 0; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  window.DevScene.teleport(s.x, s.y, -0.4);
  window.DevScene.syncCamera();
  const c = window.camera;
  if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode();
  c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z};
  return { x: Math.round(s.x), y: Math.round(s.y) };
})()`;
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.maxZoom = Math.max(c.maxZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);

// Stan strony: złożenia, klatki, wiek i liczniki pacera, wiersz workera PerfHUD (kolejka), rAF, statek, kamera
const PAGE_STATE = `(() => {
  const H = window.RenderWorkerHost;
  if (H && typeof H.readStats === 'function') H.readStats();
  const R = window.__rafRec;
  const raf = R ? { n: R.n, max: +R.max.toFixed(1), slow: R.slow, hist: Array.from(R.h) } : null;
  if (R) { R.n = 0; R.max = 0; R.slow = 0; R.h.fill(0); }
  const s = window.ship, c = window.camera, P = H && H.pacer;
  return { t: performance.now(), f: window.__frameId | 0, composed: H ? H.composed : -1, age: P ? P.age : -1,
    pacer: P ? { arrived: P.stats.arrived, late: P.stats.late, raised: P.stats.raised, lowered: P.stats.lowered, ageHist: Array.from(P.stats.ageHist).slice(0, 8) } : null,
    hud: H ? { cpu: +(H.stats[6] || 0).toFixed(2), gpuR: +(H.stats[0] || 0).toFixed(2), gpuC: +(H.stats[1] || 0).toFixed(2), fxMs: +(H.stats[11] || 0).toFixed(2),
      kolejka: +(H.stats[20] || 0).toFixed(1), skala: +(H.stats[12] || 0).toFixed(3) } : null,
    wk: H ? { takty: H.stats[13] | 0, czekania: H.stats[14] | 0, porzucone: H.stats[15] | 0, rendery: H.stats[16] | 0, zWiadomosci: H.stats[17] | 0 } : null,
    raf, statek: s ? { x: s.pos.x, y: s.pos.y, vx: s.vel.x, vy: s.vel.y, a: s.angle } : null,
    watekGry: window.__PH ? { ms: +(window.__PH.display.frameMs || 0).toFixed(2), p50: +(window.__PH.display.frameP50 || 0).toFixed(2), p95: +(window.__PH.display.frameP95 || 0).toFixed(2),
      fizyka: +(window.__PH.display.physicsTime || 0).toFixed(2) } : null,
    kamera: c ? { x: c.x, y: c.y, zoom: c.zoom } : null, wejscieZablokowane: window.__blokadaWejscia ? window.__blokadaWejscia.n : null };
})()`;

// Blokada wejścia użytkownika w oknie harnessu (przebieg bazowy 2026-10-29: kółko myszy na pełnoekranowym oknie
// zmieniło zoom w połowie A/B — 0,0667 → 0,22 → 0,078 → 0,43 → 0,12). Faza przechwytywania na window, przed
// obsługą gry; przepuszcza tylko W (ciąg wysyłany przez CDP). Licznik zablokowanych zdarzeń idzie do każdego okna.
const BLOKADA_WEJSCIA = `(() => {
  if (window.__blokadaWejscia) return 'już';
  const B = window.__blokadaWejscia = { n: 0 };
  const stop = (e) => { if ((e.type === 'keydown' || e.type === 'keyup') && e.code === 'KeyW') return; B.n++; e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); };
  for (const t of ['wheel', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup'])
    window.addEventListener(t, stop, { capture: true, passive: false });
  return 'ok';
})()`;

const WK_FRAMES = `(() => {
  const f = globalThis.__rwFrameTimes;
  const n = f ? f.n : 0, from = Math.max(globalThis.__wkSeenN || 0, n - 8192);
  globalThis.__wkSeenN = n;
  const a = [];
  for (let i = from; i < n; i++) a.push(f.ms[i & 8191]);
  a.sort((x, y) => x - y);
  const q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(2) : 0);
  // klatki workera z CPU > 8 / 12 / 20 ms (przestoje pojedynczych klatek — max okna to jedna próbka)
  let g8 = 0, g12 = 0, g20 = 0;
  for (let i = a.length - 1; i >= 0 && a[i] > 8; i--) { g8++; if (a[i] > 12) g12++; if (a[i] > 20) g20++; }
  return { n: a.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: a.length ? +a[a.length - 1].toFixed(1) : 0, ponad8: g8, ponad12: g12, ponad20: g20 };
})()`;

// Rozszerzenie sondy: grupy wiązań, setBindGroup / setPipeline, passy render i ich rozwiązania MSAA, passy czyszczenia
// three (enkoder 'clear'), passy compute — średnie na klatkę workera (granica: renderSingle, jak sonda)
const SONDA_EXT = `(() => {
  const P = globalThis.__gpuProbe, C = globalThis.__C3;
  if (!P) return 'brak sondy';
  if (P.ext) return 'już';
  const dev = C.renderer.backend.device;
  const X = P.ext = { klatki: 0, bindGroupy: 0, setBindGroup: 0, setPipeline: 0, passy: 0, rozwiazania: 0, czyszczenia: 0, rozwiazaniaCzyszczen: 0, passyCompute: 0 };
  const w = (o, n, mk) => { const f = o && o[n]; if (typeof f === 'function') o[n] = mk(f); };
  w(dev, 'createBindGroup', (f) => function () { X.bindGroupy++; return f.apply(this, arguments); });
  for (const E of [GPURenderPassEncoder, GPUComputePassEncoder]) {
    w(E.prototype, 'setBindGroup', (f) => function () { X.setBindGroup++; return f.apply(this, arguments); });
    w(E.prototype, 'setPipeline', (f) => function () { X.setPipeline++; return f.apply(this, arguments); });
  }
  w(GPUCommandEncoder.prototype, 'beginRenderPass', (f) => function (d) {
    let r = 0; const a = d && d.colorAttachments;
    if (a) for (const c of a) if (c && c.resolveTarget) r++;
    X.passy++; X.rozwiazania += r;
    if (this.label === 'clear' || (d && d.label === 'clear')) { X.czyszczenia++; X.rozwiazaniaCzyszczen += r; }
    return f.apply(this, arguments);
  });
  w(GPUCommandEncoder.prototype, 'beginComputePass', (f) => function () { X.passyCompute++; return f.apply(this, arguments); });
  // klatka Core3D.fx pominięta (FxFrame.frame: ten sam renderer.info.frame co w poprzednim renderze — info.frame liczy
  // takty rAF pętli three w workerze, a worker rysuje z wiadomości strony)
  X.fxPominiete = 0;
  const FX = C.fx;
  if (FX && typeof FX.frame === 'function') { const ff = FX.frame; FX.frame = function () { const r = ff.apply(this, arguments); if (r === false) X.fxPominiete++; return r; }; }
  const rs = C.renderSingle;
  C.renderSingle = function () { X.klatki++; return rs.apply(this, arguments); };
  return 'ok';
})()`;
const SONDA_EXT_CZYTAJ = `(() => {
  const X = globalThis.__gpuProbe && globalThis.__gpuProbe.ext;
  if (!X) return null;
  const n = Math.max(1, X.klatki), o = { klatki: X.klatki };
  for (const k in X) if (k !== 'klatki') { o[k] = +(X[k] / n).toFixed(2); X[k] = 0; }
  X.klatki = 0;
  return o;
})()`;

// ── dziennik drżenia gazu (klatka po klatce w workerze; opakowanie SpaceGas._update) ────────────────────────────
const GL = { K: 0, WALL: 1, FDT: 2, TG: 3, ALPHA: 4, SER: 5, DTG: 6, ACT: 7, ACC: 8, W1: 9, SUB: 10, SHIFT: 11, RESET: 12, OX: 13, OY: 14,
  CX: 15, CY: 16, TX: 17, TY: 18, CAMX: 19, CAMY: 20, ZOOM: 21, ROLL: 22, NSX: 23, NSY: 24, CTXDT: 25, NOW: 26, VCELL: 27, VLOC: 28,
  CPU: 29, STEPS: 30, HW: 31, HH: 32, SIMR: 33, FADE: 34, WARM: 35, SIM: 36, DISP: 37, F: 38 };
const GAZ_LOG_INSTALUJ = `(() => {
  const S = globalThis.__ST;
  if (!S || !S.spaceGas) return 'brak spaceGas';
  if (globalThis.__sgLog) return 'już';
  const SG = S.spaceGas, H = S.mods.layoutMod.HEAD, F = ${GL.F}, N = 16384;
  const L = globalThis.__sgLog = { n: 0, rn: 0, F, N, a: new Float64Array(N * F), err: null };
  const up0 = SG._update;
  SG._update = function (ctx) {
    const sim = this.sim, sh0 = sim ? sim.stats.shifts : 0, rs0 = sim ? sim.stats.resets : 0;
    const res = up0.call(this, ctx);
    try {
      const page = S.reader && S.reader.page;
      if (!page || !sim) return res;
      const h = page.head, IN = this.input, a = L.a, o = (L.n % N) * F, b = S.belt, T = this.maps && this.maps.U && this.maps.U.texel.value;
      a[o] = h[H.K]; a[o + 1] = h[H.WALL]; a[o + 2] = h[H.FRAME_DT]; a[o + 3] = h[H.T_GAME]; a[o + 4] = h[H.ALPHA];
      // dt, które gaz naprawdę wziął (od 2026-10-29 zegar gry — przyrost czasu renderu przez pominięte strony; dawniej dt strony)
      a[o + 5] = IN[0]; a[o + 6] = Number.isFinite(this.stats.dt) ? this.stats.dt : IN[3]; a[o + 7] = IN[1];
      a[o + 8] = sim.acc; a[o + 9] = sim.image.w1; a[o + 10] = this.stats.active ? sim.stats.substeps : 0; a[o + 11] = sim.stats.shifts - sh0; a[o + 12] = sim.stats.resets - rs0;
      a[o + 13] = sim.ox; a[o + 14] = sim.oy; a[o + 15] = IN[6]; a[o + 16] = IN[7];
      a[o + 17] = T ? T.x : NaN; a[o + 18] = T ? T.y : NaN;
      a[o + 19] = h[H.CAM_X]; a[o + 20] = h[H.CAM_Y]; a[o + 21] = h[H.CAM_ZOOM]; a[o + 22] = h[H.CAM_ROLL] || 0; a[o + 23] = h[H.CAMNS_X]; a[o + 24] = h[H.CAMNS_Y];
      a[o + 25] = ctx ? ctx.dt : NaN; a[o + 26] = performance.now();
      a[o + 27] = b && b.volume && b.volume.U && b.volume.U.cell ? b.volume.U.cell.value.x : NaN; a[o + 28] = b ? h[H.CAM_X] - b._originX : NaN;
      a[o + 29] = this.stats.cpuMs; a[o + 30] = sim.steps; a[o + 31] = IN[8]; a[o + 32] = IN[9]; a[o + 33] = h[H.SIM_RENDER];
      a[o + 34] = this.layer ? this.layer.L.fade.value : NaN; a[o + 35] = sim.warmLeft; a[o + 36] = h[H.SIM]; a[o + 37] = this.stats.dispatches;
      L.n++;
    } catch (e) { L.err = String(e); }
    return res;
  };
  return 'ok';
})()`;
const GAZ_LOG_CZYTAJ = (wiersze) => `(() => {
  const L = globalThis.__sgLog;
  if (!L) return null;
  const from = Math.max(L.rn, L.n - L.N + 1), r = [];
  if (${wiersze ? 'true' : 'false'}) for (let i = from; i < L.n; i++) { const o = (i % L.N) * L.F; r.push(Array.from(L.a.subarray(o, o + L.F))); }
  const n = L.n - from;
  L.rn = L.n;
  return { n, wiersze: r, blad: L.err };
})()`;

// Dane oddalenia (koniec okna): zanik obrazu gazu, okno pola wobec kadru, teksel i LOD faktury, obwiednia, płaty mgły
const ODDALENIE = `(() => {
  const S = globalThis.__ST, g = S.spaceGas, b = S.belt;
  if (!g || !g.sim) return null;
  const IN = g.input, s = g.sim, C = s.cell, N = s.N, T = g.tune;
  const x0 = s.ox * C, y0 = s.oy * C, x1 = x0 + N * C, y1 = y0 + N * C;
  const cx = IN[6], cy = IN[7], hw = IN[8], hh = IN[9];
  const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const covX = ov(x0, x1, cx - hw, cx + hw) / (2 * hw), covY = ov(y0, y1, cy - hh, cy + hh) / (2 * hh);
  const half = Math.max(hw, hh), f = T.fadeView;
  const viewFade = Number.isFinite(g.stats.viewFade) ? g.stats.viewFade : 1 - Math.min(1, Math.max(0, (half - f[0]) / (f[1] - f[0])));
  const Tx = g.maps.U.texel.value, U = g.maps.U;
  const sm = (a, c, x) => { const q = Math.min(1, Math.max(0, (x - a) / (c - a))); return q * q * (3 - 2 * q); };
  const fog = b && b.fog ? b.fog.slices.map((sl) => [sl.def.fg ? 1 : 0, sl.mesh.visible ? 1 : 0, +sl.S.alpha.value.toFixed(3)]) : null;
  return { aktywny: !!g.stats.active, scena: IN[2], viewFade: +viewFade.toFixed(3), fadeWarstwy: +g.layer.L.fade.value.toFixed(3), fadeSkoku: +g.stats.fade.toFixed(3),
    warstwyWidoczne: !!g.layer.lower.visible, pylWidoczny: g.dust ? !!g.dust.mesh.visible : null,
    pokrycie: +(covX * covY).toFixed(3), pokrycieX: +covX.toFixed(3), pokrycieY: +covY.toFixed(3), oknoJ: N * C, polKadru: [Math.round(hw), Math.round(hh)],
    kotwica: [IN[4], IN[5]], okno: [x0, y0, x1, y1], kamera: [cx, cy], srodekOkna: [IN[31], IN[32]], zegar: !!g.stats.clock, dyszePominiete: g.stats.jetsSkipped,
    teksel: [+Tx.x.toFixed(2), +Tx.y.toFixed(2)], lodFaktury: +sm(U.lodLo.value, U.lodHi.value, Math.max(Tx.x, Tx.y)).toFixed(3),
    obwiedniaPol: IN[17] * 16, mapaPolX: Math.round(hw * 1.08), mapaPolY: Math.round(hh * 1.08),
    zrodla: g.stats.sources, kadluby: g.stats.hulls, odgazowanie: g.stats.vents, kroki: g.stats.substeps, dispatche: g.stats.dispatches, cpuMs: +g.stats.cpuMs.toFixed(3),
    mgla: fog,
    pas: b ? { aktywny: !!b.stats.active, cpuMs: +b.stats.cpuMs.toFixed(2), swiatla: b.stats.lights, mapyCienia: b.stats.shadowMaps, rzucajacy: b.stats.shadowCasters,
      kolumny: b.stats.volumeColumns, kolumnaJ: b.volume && b.volume.U.cell ? +b.volume.U.cell.value.x.toFixed(1) : null, skaly: [...b.stats.rocks], mineraly: b.stats.minerals,
      oczekujace: b.stats.pending, warstwy: b.layers.map((L) => [L.stats.instances, L.stats.drawn, L.stats.cells]), olbrzymy: b._giantViews.size,
      zaslona: b.veil && b.veil.u ? +b.veil.u.veil.value.toFixed(3) : null, burza: +(b.stats.storm || 0).toFixed(3), tryb: b.stats.warpMode, zanik: b.stats.fade } : null };
})()`;

// Przekroje kanału za rufą (po oknie przelotu): gęstość / gęstość odniesienia w pasie ±600 j. wobec boków 1000–1400 j.
const SLAD_GAZU = (sx, sy, vx, vy, zoom) => `(async () => {
  const g = globalThis.__ST.spaceGas, s = g && g.sim;
  if (!s) return null;
  const R = globalThis.__C3.renderer, IN = g.input, C = s.cell, N = s.N;
  const x0 = s.ox * C, y0 = s.oy * C, x1 = x0 + N * C, y1 = y0 + N * C;
  const px = ${sx} - IN[4], py = ${sy} - IN[5], vx = ${vx}, vy = ${vy}, v = Math.hypot(vx, vy) || 1;
  const ux = -vx / v, uy = -vy / v, nx = -uy, ny = ux;
  const edge = Math.min(ux > 0 ? (x1 - px) / ux : ux < 0 ? (x0 - px) / ux : 1e9, uy > 0 ? (y1 - py) / uy : uy < 0 ? (y0 - py) / uy : 1e9);
  const den = new Float32Array(await R.getArrayBufferAsync(s.buf.denA.value));
  const rest = new Float32Array(await R.getArrayBufferAsync(s.buf.restA.value));
  const rel = (x, y) => { const i = Math.floor((x - x0) / C), j = Math.floor((y - y0) / C); if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) return null; const k = (j * N + i) * 4; return (den[k] + den[k + 1] + den[k + 2] + den[k + 3]) / Math.max(rest[k + 2], 1e-3); };
  const przekroje = [500, 1000, 2000, 3000, 4500, 6000, 9000, 12000, 16000].map((d) => {
    let mn = Infinity, side = 0, ns = 0, poza = 0;
    for (let t = -1400; t <= 1400; t += 64) { const r = rel(px + ux * d + nx * t, py + uy * d + ny * t); if (r === null) { poza++; continue; } if (Math.abs(t) <= 600) mn = Math.min(mn, r); else if (Math.abs(t) >= 1000) { side += r; ns++; } }
    return [d, poza > 20 || !ns ? 'poza oknem' : +(mn / Math.max(side / ns, 1e-3)).toFixed(2)];
  });
  const cx = IN[6], cy = IN[7];
  return { zoom: ${zoom}, v: Math.round(v), statekWOknie: px > x0 && px < x1 && py > y0 && py < y1, statekOdSrodkaOkna: [Math.round(px - (x0 + x1) / 2), Math.round(py - (y0 + y1) / 2)],
    kameraOdStatku: Math.round(Math.hypot(cx - px, cy - py)), doTylnejKrawedziOkna: Math.round(edge), doTylnejKrawedziPx: Math.round(edge * ${zoom}), przekroje };
})()`;

// Rzednięcie okna na postoju (--rzedniecie S): średnie ρ / ρ_ref w głębi okna pola (≥ 32 komórki od brzegu) i przy brzegu
// (≤ 12 komórek — dopływ pola dalekiego). Zanik kanałów (look.decay) działa w całym oknie, a ciśnienie nie wyrównuje
// równomiernego niedoboru w głębi — przy oddaleniu okno mniejsze od kadru mogłoby się odcinać jako rzadszy prostokąt.
const RZEDNIECIE = `(async () => {
  const g = globalThis.__ST.spaceGas, s = g && g.sim;
  if (!s) return null;
  const R = globalThis.__C3.renderer, N = s.N;
  const den = new Float32Array(await R.getArrayBufferAsync(s.buf.denA.value));
  const rest = new Float32Array(await R.getArrayBufferAsync(s.buf.restA.value));
  let a = 0, n = 0, e = 0, ne = 0;
  for (let j = 4; j < N - 4; j += 2) for (let i = 4; i < N - 4; i += 2) {
    const k = (j * N + i) * 4, ref = rest[k + 2];
    if (!(ref > 0.05)) continue;
    const r = (den[k] + den[k + 1] + den[k + 2] + den[k + 3]) / ref;
    const edge = Math.min(i, j, N - 1 - i, N - 1 - j);
    if (edge >= 32) { a += r; n++; } else if (edge <= 12) { e += r; ne++; }
  }
  return { glab: n ? +(a / n).toFixed(3) : null, brzeg: ne ? +(e / ne).toFixed(3) : null, komorek: n, krokow: s.steps };
})()`;

// --rytm: dziennik zegarów strony (jak gpu-baza-gra.mjs) — rAF opakowany (znacznik klatki), SimClock.beginRender,
// postFrame (numer strony), ring.compose (która strona w tej klatce ekranu)
const RYTM_INSTALL = `(() => {
  if (window.__rytmZ) return 'już';
  const H = window.RenderWorkerHost, P = window.RenderSnapshot && window.RenderSnapshot.packer, SC = window.SimClock;
  if (!H || !P || !SC || !H.ring) return 'brak';
  const N = 16384, M = N - 1;
  const R = window.__rytmZ = { n: 0, rn: 0, k: new Int32Array(N), ts: new Float64Array(N), pk: new Float64Array(N),
    sim: new Float64Array(N), rend: new Float64Array(N), cn: 0, rcn: 0, cK: new Int32Array(N), cTs: new Float64Array(N), cur: -1 };
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf0((ts) => { window.__rytmTs = ts; cb(ts); });
  const br0 = SC.beginRender;
  SC.beginRender = function (a, d, p) { br0.call(SC, a, d, p); const i = R.n & M; R.k[i] = -1; R.ts[i] = window.__rytmTs;
    R.pk[i] = performance.now(); R.sim[i] = SC.sim; R.rend[i] = SC.render; R.cur = i; R.n++; };
  const pf0 = H.postFrame;
  H.postFrame = function () { if (R.cur >= 0) R.k[R.cur] = P.k; return pf0.apply(this, arguments); };
  const rc0 = H.ring.compose;
  H.ring.compose = function (k) { const i = R.cn & M; R.cK[i] = k; R.cTs[i] = window.__rytmTs; R.cn++; return rc0.call(this, k); };
  return 'ok';
})()`;
const RYTM_CZYTAJ = `(() => {
  const R = window.__rytmZ; if (!R) return null;
  const M = R.k.length - 1, o = { k: [], ts: [], pk: [], sim: [], rend: [], cK: [], cTs: [] };
  for (let i = Math.max(R.rn, R.n - M); i < R.n; i++) { const j = i & M; o.k.push(R.k[j]); o.ts.push(R.ts[j]); o.pk.push(R.pk[j]); o.sim.push(R.sim[j]); o.rend.push(R.rend[j]); }
  for (let i = Math.max(R.rcn, R.cn - M); i < R.cn; i++) { const j = i & M; o.cK.push(R.cK[j]); o.cTs.push(R.cTs[j]); }
  R.rn = R.n; R.rcn = R.cn;
  return o;
})()`;
const stAbs = (arr) => {
  const a = arr.map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return null;
  const sr = a.reduce((s, v) => s + v, 0) / a.length;
  return { n: a.length, sr: +sr.toFixed(2), p95: +a[Math.min(a.length - 1, Math.floor(0.95 * a.length))].toFixed(2), ponad1ms: +(100 * a.filter((v) => v > 1).length / a.length).toFixed(1) };
};
const kwantyle = (arr) => {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const q = (p) => +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3);
  return { n: a.length, sr: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3), p50: q(0.5), p95: q(0.95), maks: +a[a.length - 1].toFixed(3) };
};
// błąd przesunięcia treści na złożenie (vsync): przyrost zegara treści między złożonymi stronami − odstęp złożeń [ms]
function rytmStat(d) {
  if (!d || !d.cK || d.cK.length < 3) return null;
  const byK = new Map();
  for (let i = 0; i < d.k.length; i++) if (d.k[i] >= 0) byK.set(d.k[i], i);
  const e = { kadluby: [], efektyNowy: [], pociskiNpcKrok: [] };
  let zlozen = 0, powt = 0, przesk = 0;
  const odstep = [];
  for (let j = 1; j < d.cK.length; j++) {
    const dv = d.cTs[j] - d.cTs[j - 1];
    if (!(dv > 0) || dv > 50) continue;
    zlozen++;
    odstep.push(dv);
    const k0 = d.cK[j - 1], k1 = d.cK[j];
    if (k1 === k0) powt++;
    else if (k1 - k0 >= 2) przesk++;
    const a = byK.get(k0), b = byK.get(k1);
    if (a === undefined || b === undefined) continue;
    const kad = (d.rend[b] - d.rend[a]) * 1000;
    e.kadluby.push(kad - dv);
    e.efektyNowy.push(d.ts[b] - d.ts[a] - dv);
    e.pociskiNpcKrok.push((d.sim[b] - d.sim[a]) * 1000 - dv);
  }
  const vs = 1000 / 240, hist = [0, 0, 0, 0, 0, 0];
  for (const v of odstep) hist[Math.min(5, Math.round(v / vs))]++;
  const out = { zlozen, powtorzone: powt, przeskoczone: przesk, odstepZlozenWOdswiezeniach: hist };
  for (const [k, v] of Object.entries(e)) out[k] = stAbs(v);
  return out;
}

// Statystyki dziennika gazu (+ złączenie ze złożeniami strony po K: zegar treści gazu wobec odstępu złożeń)
function gazStat(rows, rr) {
  const n = rows.length;
  if (n < 3) return { klatek: n };
  const SUB = 1 / 60;
  const dur = (rows[n - 1][GL.NOW] - rows[0][GL.NOW]) / 1000;
  const dk = [0, 0, 0, 0];
  let sumTg = 0, sumDtg = 0;
  const clkCtx = [], clkCtxSkip = [], clkGas = [];
  let rephMove = 0, rephMoveN = 0, rephStat = 0, rephStatN = 0, rephVMove = 0, rephVMoveN = 0, rephVStat = 0, rephVStatN = 0;
  let shifts = 0, resets = 0, steps = 0, aktywne = 0, warm = 0;
  const stepHist = [0, 0, 0, 0, 0];
  const shiftEv = [];
  const shake = [], cpu = [], disp = [], fade = [], tekselX = [], tekselY = [];
  let phC = 0, phS = 0, phN = 0;
  const zoomRuch = [];
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    if (r[GL.ACT] > 0.5) aktywne++;
    if (r[GL.WARM] > 0) warm++;
    steps += r[GL.SUB];
    stepHist[Math.max(0, Math.min(4, r[GL.SUB] | 0))]++;
    shifts += r[GL.SHIFT]; resets += r[GL.RESET];
    cpu.push(r[GL.CPU]); disp.push(r[GL.DISP]); fade.push(r[GL.FADE]); tekselX.push(r[GL.TX]); tekselY.push(r[GL.TY]);
    shake.push(Math.hypot(r[GL.CAMX] - r[GL.NSX], r[GL.CAMY] - r[GL.NSY]) * r[GL.ZOOM]);
    if (r[GL.ACT] > 0.5 && !(r[GL.WARM] > 0)) {
      const ph = (((r[GL.ACC] * 60 - r[GL.ALPHA]) % 1) + 1) % 1;
      phC += Math.cos(2 * Math.PI * ph); phS += Math.sin(2 * Math.PI * ph); phN++;
    }
    if (i === 0) continue;
    const p = rows[i - 1];
    const d = r[GL.K] - p[GL.K];
    dk[Math.max(0, Math.min(3, d))]++;
    const dTg = r[GL.TG] - p[GL.TG];
    const fresh = r[GL.SER] !== p[GL.SER];
    sumTg += dTg;
    if (fresh) sumDtg += r[GL.DTG];
    const dWall = (r[GL.WALL] - p[GL.WALL]) / 1000;
    (d === 1 ? clkCtx : clkCtxSkip).push((r[GL.CTXDT] - dWall) * 1000);
    if (d === 1 && fresh) clkGas.push((r[GL.DTG] - dTg) * 1000);
    zoomRuch.push(Math.abs(r[GL.ZOOM] / p[GL.ZOOM] - 1));
    if (r[GL.ACT] > 0.5 && p[GL.ACT] > 0.5 && r[GL.TX] > 0 && p[GL.TX] > 0) {
      const rx = Math.abs(r[GL.CX]) * Math.abs(r[GL.TX] / p[GL.TX] - 1) / r[GL.TX];
      const ry = Math.abs(r[GL.CY]) * Math.abs(r[GL.TY] / p[GL.TY] - 1) / r[GL.TY];
      const moving = Math.abs(r[GL.ZOOM] / p[GL.ZOOM] - 1) > 1e-5 || r[GL.ROLL] !== p[GL.ROLL];
      const bad = Math.max(rx, ry) > 0.25;
      if (moving) { rephMoveN++; if (bad) rephMove++; } else { rephStatN++; if (bad) rephStat++; }
    }
    if (r[GL.VCELL] > 0 && p[GL.VCELL] > 0 && Number.isFinite(r[GL.VLOC])) {
      const rv = Math.abs(r[GL.VLOC]) * Math.abs(r[GL.VCELL] / p[GL.VCELL] - 1) / r[GL.VCELL];
      const moving = Math.abs(r[GL.ZOOM] / p[GL.ZOOM] - 1) > 1e-5;
      if (moving) { rephVMoveN++; if (rv > 0.25) rephVMove++; } else { rephVStatN++; if (rv > 0.25) rephVStat++; }
    }
    if (r[GL.SHIFT] > 0) shiftEv.push([i, r[GL.OX] - p[GL.OX], r[GL.OY] - p[GL.OY]]);
  }
  let pingPong = 0;
  for (let j = 1; j < shiftEv.length; j++) {
    const a = shiftEv[j - 1], b = shiftEv[j];
    if (b[0] - a[0] <= 3 && (a[1] * b[1] < 0 || a[2] * b[2] < 0)) pingPong++;
  }
  // zegar treści gazu przy złożeniach strony: Δ(kroki/60 + akumulator) między złożonymi stronami − odstęp złożeń
  let zlozenia = null;
  if (rr && rr.cK && rr.cK.length > 3) {
    const byK = new Map();
    for (const r of rows) byK.set(r[GL.K], r);
    const eg = [], eh = [], egh = [];
    let brak = 0;
    for (let j = 1; j < rr.cK.length; j++) {
      const dv = rr.cTs[j] - rr.cTs[j - 1];
      if (!(dv > 0) || dv > 50) continue;
      const a = byK.get(rr.cK[j - 1]), b = byK.get(rr.cK[j]);
      if (!a || !b) { brak++; continue; }
      if (a[GL.WARM] > 0 || b[GL.WARM] > 0 || b[GL.RESET] > 0 || !(a[GL.ACT] > 0.5) || !(b[GL.ACT] > 0.5)) continue;
      const dg = ((b[GL.STEPS] - a[GL.STEPS]) * SUB + (b[GL.ACC] - a[GL.ACC])) * 1000;
      const dh = (b[GL.SIMR] - a[GL.SIMR]) * 1000;
      eg.push(dg - dv); eh.push(dh - dv); egh.push(dg - dh);
    }
    zlozenia = { gaz: stAbs(eg), kadluby: stAbs(eh), gazWzglKadlubow: stAbs(egh), bezWierszaWorkera: brak };
  }
  const R = phN ? Math.hypot(phC, phS) / phN : null;
  return {
    klatek: n, s: +dur.toFixed(2), klatekNaS: dur > 0 ? +(n / dur).toFixed(1) : null, aktywne, rozgrzanie: warm,
    deltaK: { '1': dk[1], '2': dk[2], '3+': dk[3], '0': dk[0] },
    utrataCzasuGazu: sumTg > 0 ? +((sumTg - sumDtg) / sumTg).toFixed(3) : null,
    zegary: { ctxDtMinusWall_K1: stAbs(clkCtx), ctxDtMinusWall_pominiete: stAbs(clkCtxSkip), dtGazuMinusTGry_K1: stAbs(clkGas) },
    kroki: { suma: steps, naS: dur > 0 ? +(steps / dur).toFixed(1) : null, hist012_34: stepHist },
    oknoPola: { przesuniecia: shifts, naS: dur > 0 ? +(shifts / dur).toFixed(2) : null, resety: resets, pingPong },
    wstrzasPx: kwantyle(shake),
    przeprobkowanieMap: { klatkiZoomRuch: rephMoveN, zlychZoomRuch: rephMove, klatkiStale: rephStatN, zlychStale: rephStat,
      udzialZoomRuch: rephMoveN ? +(rephMove / rephMoveN).toFixed(3) : null, udzialStale: rephStatN ? +(rephStat / rephStatN).toFixed(3) : null },
    przeprobkowanieOsrodka: { klatkiZoomRuch: rephVMoveN, zlychZoomRuch: rephVMove, klatkiStale: rephVStatN, zlychStale: rephVStat },
    zoomZmianaNaKlatke: kwantyle(zoomRuch),
    fazaGazWzglFizyki_R: R === null ? null : +R.toFixed(3),
    cpuGazuMs: kwantyle(cpu), dispatcheNaKlatke: kwantyle(disp), fadeWarstwy: kwantyle(fade), teksel: [kwantyle(tekselX), kwantyle(tekselY)],
    zlozenia
  };
}

// ── ślad Chrome (po oknie): zajętość wątków, najdroższe zdarzenia, zdarzenia procesu GPU wg wzorców ───────────────
const WZORY = { sharedImage: /SharedImage/i, rezydencja: /Residen|Evict|MakeResident|Paging/i, tworzenie: /CreateTexture|CreateBuffer|CreateBindGroup/i,
  wysylki: /WriteBuffer|WriteTexture|CopyBuffer|CopyTexture/i, prezentacja: /Present|SwapBuffers|DrawAndSwap/i, czyszczenie: /Clear|Resolve/i,
  pipeline: /Pipeline/i, submit: /Submit/i, raster: /Raster/i, dawn: /Dawn|WebGPU|Wire/i };
async function slad(s, kategorie = ['viz', 'gpu.service']) {
  const events = [];
  let done = null;
  const handler = (msg) => {
    if (msg.method === 'Tracing.dataCollected') { for (const e of msg.params.value) if (e.ph === 'X' || e.ph === 'M') events.push(e); }
    else if (msg.method === 'Tracing.tracingComplete' && done) { const f = done; done = null; f(); }
  };
  cdp.on(handler);
  const licz = () => ev('(() => { const h = window.RenderWorkerHost; return { f: window.__frameId | 0, c: h ? h.composed : 0, t: performance.now() }; })()');
  try {
    const fin = new Promise((ok) => { done = ok; });
    const a0 = await licz();
    await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible',
      includedCategories: ['toplevel', '__metadata', 'gpu', 'gpu.dawn', ...kategorie], excludedCategories: ['*'] }, transferMode: 'ReportEvents' });
    await sleep(s * 1000);
    await cdp.send('Tracing.end');
    const a1 = await licz();
    await Promise.race([fin, sleep(30000)]);
    const A = analizaSladu(events, a0, a1);
    // zdarzenia CrGpuMain i VizCompositorThread wg wzorców (sumy zdarzeń o pasujących nazwach — zagnieżdżone liczą się
    // podwójnie; to wskaźnik rodzaju pracy, nie zajętość)
    const tname = new Map();
    for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') tname.set(`${e.pid}:${e.tid}`, e.args?.name);
    const keys = { gpuMain: null, viz: null };
    for (const [k, n] of tname) { if (n === 'CrGpuMain') keys.gpuMain = k; if (n === 'VizCompositorThread') keys.viz = k; }
    const obrazy = Math.max(1, (a1.c - a0.c) || 1);
    const wg = {};
    for (const [nm, key] of Object.entries(keys)) {
      if (!key) continue;
      const m = {};
      for (const e of events) {
        if (e.ph !== 'X' || !(e.dur > 0) || `${e.pid}:${e.tid}` !== key) continue;
        for (const [w, re] of Object.entries(WZORY)) if (re.test(e.name)) { const r = m[w] || (m[w] = [0, 0]); r[0] += e.dur / 1000; r[1]++; }
      }
      for (const w of Object.keys(m)) m[w] = { msNaObraz: +(m[w][0] / obrazy).toFixed(3), naObraz: +(m[w][1] / obrazy).toFixed(2) };
      wg[nm] = m;
    }
    return { ...A, wzorce: wg, zdarzen: events.length };
  } finally {
    const i = cdp.handlers ? cdp.handlers.indexOf(handler) : -1;
    if (i >= 0) cdp.handlers.splice(i, 1);
  }
}

// ── okno pomiaru ────────────────────────────────────────────────────────────────────────────────────────────────
const dtW = (p0, p1) => Math.max(1e-3, (p1.t - p0.t) / 1000);
async function okno(label, sekundy, { sladS = 0, gaz = false, oddalenie = false } = {}) {
  const p0 = await ev(PAGE_STATE);
  if (wk.sid) {
    await wkEval(WK_FRAMES).catch(() => null);
    await wkEval(SONDA_CZYTAJ).catch(() => null);
    await wkEval(SONDA_EXT_CZYTAJ).catch(() => null);
    await wkEval(GAZ_LOG_CZYTAJ(false)).catch(() => null);
  }
  if (RYTM) await ev(RYTM_CZYTAJ).catch(() => null);
  const t0 = Date.now();
  await sleep(sekundy * 1000);
  const t1 = Date.now();
  const rr = RYTM ? await ev(RYTM_CZYTAJ, 60000).catch(() => null) : null;
  const p1 = await ev(PAGE_STATE);
  const wf = wk.sid ? await wkEval(WK_FRAMES).catch((e) => ({ err: e.message })) : null;
  const sonda = wk.sid ? await wkEval(SONDA_CZYTAJ).catch((e) => ({ err: e.message })) : null;
  const ext = wk.sid ? await wkEval(SONDA_EXT_CZYTAJ).catch((e) => ({ err: e.message })) : null;
  const glog = wk.sid ? await wkEval(GAZ_LOG_CZYTAJ(gaz), 60000).catch((e) => ({ err: e.message })) : null;
  const odd = wk.sid && (gaz || oddalenie) ? await wkEval(ODDALENIE).catch((e) => ({ err: e.message })) : null;
  const rytm = rr ? rytmStat(rr) : null;
  const g = gaz && glog && glog.wiersze ? gazStat(glog.wiersze, rr) : null;
  let sl = null;
  if (sladS > 0 && SLAD > 0) {
    sl = await slad(sladS).catch((e) => ({ blad: String(e) }));
    report.slady[label] = sl;
  }
  const dt = Math.max(1e-3, (p1.t - p0.t) / 1000);
  const so = sonda && !sonda.err ? sonda : null;
  const pac = p1.pacer && p0.pacer ? { przyjscia: p1.pacer.arrived - p0.pacer.arrived, spoznione: p1.pacer.late - p0.pacer.late,
    podniesienia: p1.pacer.raised - p0.pacer.raised, obnizenia: p1.pacer.lowered - p0.pacer.lowered } : null;
  const wkLicz = p1.wk && p0.wk ? { taktyRafS: +((p1.wk.takty - p0.wk.takty) / dtW(p0, p1)).toFixed(1), renderyS: +((p1.wk.rendery - p0.wk.rendery) / dtW(p0, p1)).toFixed(1),
    zWiadomosciS: +((p1.wk.zWiadomosci - p0.wk.zWiadomosci) / dtW(p0, p1)).toFixed(1), czekaniaS: +((p1.wk.czekania - p0.wk.czekania) / dtW(p0, p1)).toFixed(1),
    porzucone: p1.wk.porzucone - p0.wk.porzucone } : null;
  const zlozeniaS = +((p1.composed - p0.composed) / dt).toFixed(1);
  // ms na obraz (1000 / obraz): przy karcie w 100% (headless — bez sufitu vsync) to czas karty na klatkę razem z pracą
  // bez znaczników (czyszczenia three z rozwiązaniem MSAA, kopie, składanie strony); poza znacznikami = reszta po passach
  const msNaObraz = zlozeniaS > 0 ? +(1000 / zlozeniaS).toFixed(3) : null;
  const znacznikiMs = so ? +((so.gpuRender.msNaKlatke || 0) + (so.gpuCompute.msNaKlatke || 0)).toFixed(3) : null;
  const row = {
    okno: label, s: +((Date.now() - tStart) / 1000).toFixed(1), dt: +dt.toFixed(2),
    zlozeniaS, klatkiStronyS: +((p1.f - p0.f) / dt).toFixed(1),
    msNaObraz, znacznikiMs, pozaZnacznikamiMs: msNaObraz !== null && znacznikiMs !== null ? +(msNaObraz - znacznikiMs).toFixed(3) : null,
    workerKlatkiS: wf && !wf.err ? +(wf.n / dt).toFixed(1) : null, workerMs: wf, wiek: p1.age, pacer: pac, workerLiczniki: wkLicz, hud: p1.hud, raf: p1.raf,
    watekGry: p1.watekGry,
    statek: p1.statek, kamera: p1.kamera,
    // zoom na początku i końcu okna (zmiana > 1% = okno z ruchem kamery — kółko, reżyser kadru) i zablokowane zdarzenia
    zoomPK: p0.kamera && p1.kamera ? [+p0.kamera.zoom.toFixed(4), +p1.kamera.zoom.toFixed(4)] : null,
    zoomZmiana: p0.kamera && p1.kamera ? Math.abs(p1.kamera.zoom / p0.kamera.zoom - 1) > 0.01 : null,
    wejscieZablokowane: p1.wejscieZablokowane !== null && p0.wejscieZablokowane !== null ? p1.wejscieZablokowane - p0.wejscieZablokowane : null,
    nvidia: smi.okno(t0, t1), liczniki: liczniki ? liczniki.okno(t0, t1) : null,
    kolejka: so ? { sr: so.sr.lat, p95: so.p95.lat, maks: so.latMax } : null,
    gpuRender: so ? so.gpuRender.msNaKlatke : null, gpuCompute: so ? so.gpuCompute.msNaKlatke : null,
    passy: ext && !ext.err ? ext : null, sonda, rytm, gaz: g, oddalenie: odd, gazLogBlad: glog && glog.blad ? glog.blad : undefined,
    slad: sl ? true : undefined
  };
  report.okna.push(row);
  if (g) report.gaz[label] = g;
  if (odd) report.oddalenie[label] = odd;
  const f1 = (v) => (v === null || v === undefined ? '-' : v);
  console.log(`${label.padEnd(18)} obraz ${String(row.zlozeniaS).padStart(6)}/s  strona ${String(row.klatkiStronyS).padStart(6)}/s  wk ${String(row.workerKlatkiS).padStart(6)}/s  cpuWk ${f1(wf?.p50)}/${f1(wf?.p95)}`
    + `  gpuR ${f1(row.gpuRender)}  gpuC ${f1(row.gpuCompute)}  ms/obraz ${f1(row.msNaObraz)} (poza znacznikami ${f1(row.pozaZnacznikamiMs)})  kolejka ${so ? so.sr.lat + '/' + so.p95.lat + '/' + so.latMax : '-'} (HUD ${f1(p1.hud?.kolejka)}, HUD GPU ${f1(p1.hud?.gpuR)}+${f1(p1.hud?.gpuC)})  wiek ${p1.age}`
    + `  wysyłki ${so ? ((so.sr.wbB + so.sr.wtB + so.sr.ceB) / 1024).toFixed(0) + ' KB' : '-'}  nowe ${so ? ((so.sr.nbB + so.sr.ntB) / 1024).toFixed(0) + ' KB' : '-'}`
    + `  rys ${so ? so.sr.draws : '-'} rp ${so ? so.sr.rp : '-'} disp ${so ? so.sr.disp : '-'}  pipe s/a ${so ? so.suma.psync + '/' + so.suma.pasync : '-'}`
    + `  GPU% ${row.nvidia ? row.nvidia.zajetosc + ' ' + row.nvidia.mocW + 'W ' + row.nvidia.pamiecMB + 'MB' : '-'}`);
  if (so) {
    if (so.wysylkiBuforow && so.wysylkiBuforow.length) console.log('   wysyłki B:', so.wysylkiBuforow.slice(0, 6).map((w) => `${w[0]} ${(w[1] / 1024).toFixed(0)}KB×${w[2]}`).join(' | '));
    if (so.wysylkiTekstur && so.wysylkiTekstur.length) console.log('   wysyłki T:', so.wysylkiTekstur.slice(0, 4).map((w) => `${w[0]} ${(w[1] / 1024).toFixed(0)}KB×${w[2]}`).join(' | '));
    console.log('   render:', so.gpuRender.wiersze.slice(0, 7).map((w) => `${w[0]} ${w[1]}`).join(' | '));
    console.log('   compute:', so.gpuCompute.wiersze.slice(0, 6).map((w) => `${w[0]} ${w[1]}`).join(' | '));
  }
  if (row.passy) console.log('   passy:', JSON.stringify(row.passy), ' worker:', JSON.stringify(wkLicz));
  if (row.liczniki) console.log('   liczniki:', JSON.stringify(row.liczniki), ' pcie', JSON.stringify(row.nvidia?.dmon || null));
  if (rytm) {
    const f = (o) => (o ? `${o.sr}/${o.p95}/${o.ponad1ms}%` : '-');
    console.log(`   rytm: złożeń ${rytm.zlozen}, powt. ${rytm.powtorzone}, przesk. ${rytm.przeskoczone}, odstępy [vsync] ${JSON.stringify(rytm.odstepZlozenWOdswiezeniach)} | kadłuby ${f(rytm.kadluby)}, efekty ${f(rytm.efektyNowy)}`);
  }
  if (g) console.log(`   gaz: ΔK ${JSON.stringify(g.deltaK)} utrata ${g.utrataCzasuGazu} kroki/s ${g.kroki?.naS} okno ${JSON.stringify(g.oknoPola)} wstrząs ${g.wstrzasPx?.sr}px faza R ${g.fazaGazWzglFizyki_R} | złożenia gaz ${g.zlozenia?.gaz ? g.zlozenia.gaz.sr + '/' + g.zlozenia.gaz.p95 + '/' + g.zlozenia.gaz.ponad1ms + '%' : '-'} wzgl. kadłubów ${g.zlozenia?.gazWzglKadlubow ? g.zlozenia.gazWzglKadlubow.sr + '/' + g.zlozenia.gazWzglKadlubow.ponad1ms + '%' : '-'} | przepróbk. map ruch ${g.przeprobkowanieMap.udzialZoomRuch} stałe ${g.przeprobkowanieMap.udzialStale}`);
  if (odd && !odd.err) console.log(`   oddalenie: viewFade ${odd.viewFade} pokrycie ${odd.pokrycie} (x ${odd.pokrycieX}, y ${odd.pokrycieY}) teksel ${odd.teksel} lod ${odd.lodFaktury} mgła ${JSON.stringify(odd.mgla)} źródła ${odd.zrodla} kadłuby ${odd.kadluby} | pas ${odd.pas ? JSON.stringify({ sw: odd.pas.swiatla, mc: odd.pas.mapyCienia, rz: odd.pas.rzucajacy, kol: odd.pas.kolumny, sk: odd.pas.skaly, mi: odd.pas.mineraly, ocz: odd.pas.oczekujace }) : '-'}`);
  if (sl && !sl.blad) console.log('   ślad: zajętość', JSON.stringify(sl.zajetosc), 'wątki', JSON.stringify(sl.watki?.slice(0, 6)), '\n   top GPU:', sl.topGpuMain.slice(0, 6).map((r) => `${r[0]} ${r[1]}ms/${r[2]}`).join(' | '), '\n   wzorce:', JSON.stringify(sl.wzorce));
  // raport cząstkowy po każdym oknie (przerwany przebieg zostawia liczby, nie same zrzuty)
  try { report.czasS = Math.round((Date.now() - tStart) / 1000); writeJson(join(out, 'raport.json'), report); } catch (_) { /* zapis w finish */ }
  return row;
}

async function obceTeraz(gdzie) {
  const o = await obceProcesy().catch(() => []);
  if (o.length) { report.obceWTrakcie.push({ gdzie, s: Math.round((Date.now() - tStart) / 1000), obce: o.slice(0, 5) }); console.log(`UWAGA: obce procesy pomiarowe (${gdzie}):`, o.map((x) => x.cmd.slice(0, 80)).join(' | ')); }
  return o;
}

// Przelot od miejsca „pole” przy zoomie z: teleport, trzymanie, W, puszczenie (zwraca po `rozped` s ruchu)
async function przelotStart(z, { trzymaj = 3, rozped = 2 } = {}) {
  await up('w').catch(() => {});
  await ev(NA_MIEJSCE(z));
  await sleep(trzymaj * 1000);
  await down('w');
  await ev('(() => { window.__hold.on = false; return true; })()');
  await sleep(rozped * 1000);
}
async function sladZaRufa(label) {
  const st = await ev('(() => { const s = window.ship, c = window.camera; return { x: s.pos.x, y: s.pos.y, vx: s.vel.x, vy: s.vel.y, zoom: c.zoom }; })()');
  const r = await wkEval(SLAD_GAZU(st.x, st.y, st.vx, st.vy, st.zoom), 60000).catch((e) => ({ blad: e.message }));
  report.slad[label] = r;
  console.log(`   ślad za rufą (${label}):`, JSON.stringify(r));
  return r;
}
async function zrzut(name) {
  const f = join(out, `${name}.png`);
  await screenshotPng(cdp, f).catch((e) => console.log('zrzut', name, e.message));
  report.zrzuty.push(f);
}

const wkKod = (kod) => wkEval(`(() => { const C = globalThis.__C3, S = globalThis.__ST; ${kod}; return true; })()`);
const stronaKod = (kod) => ev(`(() => { ${kod}; return true; })()`);
async function wariant(nazwa, prefix, r, przygotuj = null) {
  const v = WARIANTY[nazwa];
  try {
    if (v.strona) await stronaKod(v.strona);
    if (v.wk) await wkKod(v.wk);
  } catch (e) { console.log('ab', nazwa, e.message); report.bledy.push(`ab ${nazwa}: ${e.message}`); }
  // przelot: świeży start od miejsca „pole” już z wariantem (teleport + trzymanie + rozpęd = czas ustalenia)
  if (przygotuj) await przygotuj();
  else { await sleep((v.ustal ?? 1.2) * 1000); await zoomSerii(); }
  const row = await okno(`${prefix}-${nazwa}-${r}`, AB_S, { sladS: AB_SLAD.has(nazwa) ? SLAD : 0, gaz: !!v.gaz });
  if (v.sladRufa) row.sladRufa = await sladZaRufa(`${prefix}-${nazwa}-${r}`);
  try {
    if (v.wkPrzywroc) await wkKod(v.wkPrzywroc);
    if (v.stronaPrzywroc) await stronaKod(v.stronaPrzywroc);
  } catch (e) { console.log('ab przywróć', nazwa, e.message); report.bledy.push(`ab przywróć ${nazwa}: ${e.message}`); }
  await sleep((v.po ?? 1) * 1000);
  return row;
}
const abWiersz = (wariant, gdzie, r, row) => ({ wariant, gdzie, r, obraz: row.zlozeniaS, msObraz: row.msNaObraz, strona: row.klatkiStronyS, wk: row.workerKlatkiS, cpuWk: row.workerMs?.p50,
  cpuWkP95: row.workerMs?.p95, cpuWkMax: row.workerMs?.max, cpuWk8: row.workerMs?.ponad8 ?? null,
  kolejkaSr: row.kolejka?.sr, kolejkaP95: row.kolejka?.p95, kolejkaMaks: row.kolejka?.maks, kolejkaHud: row.hud?.kolejka, gpuR: row.gpuRender, gpuC: row.gpuCompute,
  nv: row.nvidia?.zajetosc, mocW: row.nvidia?.mocW, rys: row.sonda?.sr?.draws, rp: row.sonda?.sr?.rp, passy: row.passy?.passy, rozw: row.passy?.rozwiazania, czysc: row.passy?.czyszczenia,
  wysylkiKB: row.sonda?.sr ? +((row.sonda.sr.wbB + row.sonda.sr.wtB + row.sonda.sr.ceB) / 1024).toFixed(0) : null,
  gpuMain: report.slady[row.okno]?.zajetosc?.gpuMain ?? null, wiek: row.wiek,
  fxPomin: row.passy?.fxPominiete ?? null, utrataGazu: row.gaz?.utrataCzasuGazu ?? null, krokiGazuS: row.gaz?.kroki?.naS ?? null });
// zoom serii A/B w miejscu (null — przelot: zoom ustawia przelotStart) przywracany przed każdym oknem
let zoomAB = null;
async function zoomSerii() { if (zoomAB !== null) { await setZoom(zoomAB); await sleep(400); } }
async function seriaAB(gdzie, lista, przygotuj) {
  for (let r = 0; r < AB_POWT; r++) {
    for (const nazwa of lista) {
      if (przygotuj) await przygotuj(); else await zoomSerii();
      const b = await okno(`ab-${gdzie}-baza-${nazwa}-${r}`, AB_S, { sladS: AB_SLAD.has('baza') && nazwa === lista[0] ? SLAD : 0, gaz: !!WARIANTY[nazwa].gaz });
      if (WARIANTY[nazwa].sladRufa) b.sladRufa = await sladZaRufa(`ab-${gdzie}-baza-${nazwa}-${r}`);
      report.ab.push(abWiersz('baza', gdzie, r, b));
      const v = await wariant(nazwa, `ab-${gdzie}`, r, przygotuj);
      report.ab.push(abWiersz(nazwa, gdzie, r, v));
    }
    if (przygotuj) await przygotuj(); else await zoomSerii();
    const b = await okno(`ab-${gdzie}-baza-koniec-${r}`, AB_S);
    report.ab.push(abWiersz('baza', gdzie, r, b));
  }
}
function podsumujAB() {
  const rows = report.ab;
  const outRows = [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    if (v.wariant === 'baza') continue;
    // baza przed (i − 1) i po (następna baza tej samej serii)
    const b0 = rows[i - 1] && rows[i - 1].wariant === 'baza' && rows[i - 1].gdzie === v.gdzie ? rows[i - 1] : null;
    let b1 = null;
    for (let j = i + 1; j < rows.length; j++) { if (rows[j].gdzie !== v.gdzie) break; if (rows[j].wariant === 'baza') { b1 = rows[j]; break; } }
    const bs = [b0, b1].filter(Boolean);
    const sr = (k) => { const a = bs.map((b) => b[k]).filter(Number.isFinite); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
    const d = (k) => { const b = sr(k); return Number.isFinite(v[k]) && b !== null ? +(v[k] - b).toFixed(2) : null; };
    outRows.push({ wariant: v.wariant, opis: WARIANTY[v.wariant]?.opis, gdzie: v.gdzie, r: v.r,
      obraz: v.obraz, obrazBaza: sr('obraz') !== null ? +sr('obraz').toFixed(1) : null, dObraz: d('obraz'),
      // ms na obraz wobec bazy: przy karcie w 100% (headless) = koszt podsystemu w czasie karty na klatkę, ze wszystkim
      // (także praca bez znaczników); dMsObraz − (dGpuR + dGpuC) = część poza znacznikami
      msObraz: v.msObraz, msObrazBaza: sr('msObraz') !== null ? +sr('msObraz').toFixed(3) : null, dMsObraz: d('msObraz'),
      kolejka: v.kolejkaSr, kolejkaBaza: sr('kolejkaSr') !== null ? +sr('kolejkaSr').toFixed(1) : null, dKolejka: d('kolejkaSr'), dKolejkaP95: d('kolejkaP95'),
      dGpuR: d('gpuR'), dGpuC: d('gpuC'), dNv: d('nv'), dMoc: d('mocW'), dCpuWk: d('cpuWk'), dRys: d('rys'), dRozw: d('rozw'), dCzysc: d('czysc'), dWysylkiKB: d('wysylkiKB'),
      gpuMain: v.gpuMain, wiek: v.wiek, fxPomin: v.fxPomin, fxPominBaza: sr('fxPomin'), utrataGazu: v.utrataGazu, krokiGazuS: v.krokiGazuS,
      utrataGazuBaza: b0 ? b0.utrataGazu : null, krokiGazuSBaza: b0 ? b0.krokiGazuS : null });
  }
  report.abPodsumowanie = outRows;
  console.log('\nA/B (wariant wobec średniej sąsiednich baz): obraz/s, Δobraz, kolejka śr (Δ), ΔGPU R/C, Δnvidia%, ΔW, ΔCPU wk, Δrys, Δrozw/czyszcz.');
  for (const r of outRows) console.log(`  ${r.gdzie.padEnd(7)} ${r.wariant.padEnd(4)} ${String(r.obraz).padStart(6)} (${r.dObraz >= 0 ? '+' : ''}${r.dObraz})  ms/obraz ${r.msObraz} (Δ ${r.dMsObraz})  kol ${r.kolejka} (${r.dKolejka})  GPU ${r.dGpuR}/${r.dGpuC}  nv ${r.dNv}  W ${r.dMoc}  cpu ${r.dCpuWk}  rys ${r.dRys}  rozw ${r.dRozw}/${r.dCzysc}  wysyłki ${r.dWysylkiKB} KB  CrGpuMain ${r.gpuMain ?? '-'}  fx pomin. ${r.fxPomin ?? '-'} (baza ${r.fxPominBaza ?? '-'})${r.utrataGazu !== null && r.utrataGazu !== undefined ? `  gaz: utrata ${r.utrataGazu} (baza ${r.utrataGazuBaza}), kroki/s ${r.krokiGazuS} (baza ${r.krokiGazuSBaza})` : ''}  — ${r.opis}`);
}

// ── ZRZUTY A/B (--zrzutyAB) — opis przy ZAB_PAUZA ──
const ZAB_DIR = args.zrzutyAB && args.zrzutyAB !== '0' ? resolve(repo, String(args.zrzutyAB)) : null;
const KAMERA = '(() => { const c = window.camera, s = window.ship; return { x: c.x, y: c.y, zoom: c.zoom, roll: c.roll || 0, statek: s ? { x: s.pos.x, y: s.pos.y, vx: s.vel.x, vy: s.vel.y, a: s.angle } : null }; })()';
const pauza = (on) => ev(`(() => { window.__setGamePaused(${on ? 'true' : 'false'}); return true; })()`);
async function zrzutAB(name, extra = {}) {
  const f = join(ZAB_DIR, `${name}.png`);
  const kam = await ev(KAMERA).catch(() => null);
  const odd = wk.sid ? await wkEval(ODDALENIE).catch((e) => ({ err: e.message })) : null;
  await screenshotPng(cdp, f).catch((e) => console.log('zrzut A/B', name, e.message));
  const row = { plik: f, nazwa: name, kamera: kam, ...extra,
    gaz: odd && !odd.err ? { viewFade: odd.viewFade, fadeWarstwy: odd.fadeWarstwy, pokrycie: odd.pokrycie, pokrycieX: odd.pokrycieX, pokrycieY: odd.pokrycieY,
      teksel: odd.teksel, lodFaktury: odd.lodFaktury, obwiedniaPol: odd.obwiedniaPol, mapaPolX: odd.mapaPolX, srodekOkna: odd.srodekOkna, kamera: odd.kamera, mgla: odd.mgla,
      kolumnaJ: odd.pas ? odd.pas.kolumnaJ : null, zrodla: odd.zrodla, kadluby: odd.kadluby } : odd };
  report.zrzutyAB.push(row);
  return row;
}
// przelot do zrzutu: teleport + trzymanie (pole gazu od nowa, sprężyna śladu okna zgaszona szybkim zanikiem), ciąg W
// przez lotS s, pauza
async function przelotAB(z, lotS) {
  await up('w').catch(() => {});
  await stronaKod('window.SpaceGasInputTune.__tauDown = window.SpaceGasInputTune.__tauDown ?? window.SpaceGasInputTune.wakeTauDown; window.SpaceGasInputTune.wakeTauDown = 0.05');
  await ev(NA_MIEJSCE(z));
  await sleep(600);
  await wkKod('S.spaceGas.sim.requestReset(S.spaceGas.tune.warmStart)');
  await sleep(3000);
  await stronaKod('window.SpaceGasInputTune.wakeTauDown = window.SpaceGasInputTune.__tauDown');
  await down('w');
  await ev('(() => { window.__hold.on = false; return true; })()');
  await sleep(lotS * 1000);
  await pauza(true);
  await sleep(1500);
}
async function wznowAB() { await pauza(false); await up('w').catch(() => {}); await sleep(300); }
async function przelacz(p, stare) {
  try {
    if (stare) { if (p.strona) await stronaKod(p.strona); if (p.wk) await wkKod(p.wk); }
    else { if (p.wkP) await wkKod(p.wkP); if (p.stronaP) await stronaKod(p.stronaP); }
  } catch (e) { console.log('zrzuty A/B', p.n, e.message); report.bledy.push(`zrzuty A/B ${p.n}: ${e.message}`); }
}
async function zrzutyAB() {
  report.zrzutyAB = [];
  mkdirSync(ZAB_DIR, { recursive: true });
  const LOT_S = Number(args.lotAB || 4);
  const ZOOMY = { blisko: ZB, srednio: ZS, daleko: ZD, max: ZM };
  const lista = listaArg(args.zoomyAB, ['blisko', 'srednio', 'daleko', 'max']).filter((n) => ZOOMY[n] !== undefined);
  report.zrzutyABOpis = { lotS: LOT_S, zoomy: Object.fromEntries(lista.map((n) => [n, ZOOMY[n]])), pauza: ZAB_PAUZA.map((p) => ({ n: p.n, opis: p.opis })),
    lot: Object.fromEntries(lista.map((n) => [n, (ZAB_LOT[n] || []).map((v) => ({ n: v, opis: WARIANTY[v].opis }))])) };
  for (const nazwa of lista) {
    const z = ZOOMY[nazwa];
    // 1) przelot z nowymi wartościami, w pauzie przełączniki po kolei
    await przelotAB(z, LOT_S);
    await zrzutAB(`${nazwa}-nowe`, { zoom: z, strona: 'nowe' });
    const sl = await sladZaRufa(`zab-${nazwa}-nowe`);
    report.zrzutyAB[report.zrzutyAB.length - 1].slad = sl;
    await sleep(1500);
    await zrzutAB(`${nazwa}-nowe-kontrola`, { zoom: z, strona: 'nowe', kontrola: true });
    for (const p of ZAB_PAUZA) {
      const ustal = (p.ustal ?? 1.5) * 1000;
      await przelacz(p, true);
      await sleep(ustal);
      await zrzutAB(`${nazwa}-${p.n}-stare`, { zoom: z, strona: 'stare', przelacznik: p.n });
      await przelacz(p, false);
      await sleep(ustal);
    }
    await zrzutAB(`${nazwa}-nowe-koniec`, { zoom: z, strona: 'nowe', kontrola: true });
    await wznowAB();
    // 2) przełączniki zależne od historii pola: przelot ze starą wartością, potem kontrola lot ↔ lot z nową
    for (const v of ZAB_LOT[nazwa] || []) {
      const W0 = WARIANTY[v];
      const p = { n: v, strona: W0.strona, stronaP: W0.stronaPrzywroc, wk: W0.wk, wkP: W0.wkPrzywroc };
      await przelacz(p, true);
      await przelotAB(z, LOT_S);
      await zrzutAB(`${nazwa}-${v}-stare`, { zoom: z, strona: 'stare', przelacznik: v, lot: true });
      report.zrzutyAB[report.zrzutyAB.length - 1].slad = await sladZaRufa(`zab-${nazwa}-${v}-stare`);
      await wznowAB();
      await przelacz(p, false);
      await przelotAB(z, LOT_S);
      await zrzutAB(`${nazwa}-${v}-nowe-lot2`, { zoom: z, strona: 'nowe', przelacznik: v, lot: true, kontrola: true });
      report.zrzutyAB[report.zrzutyAB.length - 1].slad = await sladZaRufa(`zab-${nazwa}-${v}-nowe-lot2`);
      await wznowAB();
    }
    console.log(`zrzuty A/B ${nazwa}: ${report.zrzutyAB.filter((r) => r.zoom === z).length} plików`);
  }
  // 3) rampa zoomu w pauzie (drabina teksla map i kolumny ośrodka — S2)
  if (String(args.rampaAB ?? '1') === '1') {
    const S2 = ZAB_PAUZA.find((p) => p.n === 'S2');
    const N = Number(args.rampaN || 16), K = Number(args.rampaKrok || 1.006);
    await up('w').catch(() => {});
    await ev(NA_MIEJSCE(ZB));
    await sleep(600);
    await wkKod('S.spaceGas.sim.requestReset(S.spaceGas.tune.warmStart)');
    await sleep(4500);
    await pauza(true);
    // --rampaUkryj B1,C3,P1: na czas rampy schowane warianty (skały, pass tła, HUD) — w kadrze sam gaz z mgłą i okręt;
    // przy normalizacji skali paralaksa warstw w perspektywie i HUD przypięty do ekranu zagłuszają drganie map gazu
    const ukryj = listaArg(args.rampaUkryj, []).filter((n) => WARIANTY[n]);
    for (const n of ukryj) await przelacz({ n, strona: WARIANTY[n].strona, stronaP: WARIANTY[n].stronaPrzywroc, wk: WARIANTY[n].wk, wkP: WARIANTY[n].wkPrzywroc }, true);
    report.zrzutyABOpis.rampaUkryj = ukryj;
    await sleep(1500);
    for (const strona of ['nowe', 'stare']) {
      if (strona === 'stare') await przelacz(S2, true);
      for (let i = 0; i < N; i++) {
        await setZoom(ZB * Math.pow(K, i));
        await sleep(i === 0 ? 1500 : 400);
        await zrzutAB(`rampa-${strona}-${String(i).padStart(2, '0')}`, { zoom: ZB * Math.pow(K, i), strona, rampa: i });
      }
      if (strona === 'stare') await przelacz(S2, false);
      await setZoom(ZB);
    }
    for (const n of [...ukryj].reverse()) await przelacz({ n, strona: WARIANTY[n].strona, stronaP: WARIANTY[n].stronaPrzywroc, wk: WARIANTY[n].wk, wkP: WARIANTY[n].wkPrzywroc }, false);
    await pauza(false);
  }
  writeJson(join(out, 'raport.json'), report);
}

function finish(code = 0) {
  try { smi.stop(); liczniki?.stop(); ekran?.stop(); report.nvidiaProbki = smi.samples.length; report.czasS = Math.round((Date.now() - tStart) / 1000); writeJson(join(out, 'raport.json'), report); } catch (e) { console.error(e); }
  if (balast) { const b = balast; balast = null; b.stop().catch(() => {}); }
  Promise.resolve(chrome.close?.()).finally(() => Promise.resolve(server.close?.()).finally(() => process.exit(code)));
}

try {
  // menu → gra swobodna (bez kampanii), pas wczytany
  if (OKNO) { report.oknoPrzegladarki = await oknoNaEkran(mojPort).catch((e) => String(e)); console.log('okno przeglądarki:', report.oknoPrzegladarki); }
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.ship && window.DevScene && window.RenderWorkerHost)', 240000, 400)) throw new Error('gra nie wstała (albo bez workera renderu)');
  report.widocznosc = await ev(`new Promise((ok) => { const R = window.__rafRec, n0 = R ? R.n : 0; setTimeout(() => ok({ stan: document.visibilityState, rafNa1s: R ? R.n - n0 : null }), 1000); })`).catch((e) => ({ blad: e.message }));
  console.log('widoczność strony:', JSON.stringify(report.widocznosc));
  if (OKNO && report.widocznosc && report.widocznosc.stan !== 'visible') {
    report.oknoPrzegladarki2 = await oknoNaEkran(mojPort).catch((e) => String(e));
    await sleep(2000);
    report.widocznosc2 = await ev(`new Promise((ok) => { const R = window.__rafRec, n0 = R ? R.n : 0; setTimeout(() => ok({ stan: document.visibilityState, rafNa1s: R ? R.n - n0 : null }), 1000); })`).catch((e) => ({ blad: e.message }));
    console.log('widoczność strony (po ponownym ustawieniu okna):', JSON.stringify(report.widocznosc2), report.oknoPrzegladarki2);
    if (report.widocznosc2.stan !== 'visible') throw new Error('strona niewidoczna (ekran zgaszony albo okno zasłonięte) — pomiar okna z vsync niemożliwy');
  }
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 120000, 500);
  // obsługa przycisków menu rejestruje się pod koniec modułu index.html (po await-ach startu) — klik wcześniej ginie:
  // klikaj, aż widok trybu gry będzie aktywny, potem start, aż menu zniknie
  for (let i = 0; i < 120; i++) {
    const v = await ev(`(() => { document.getElementById('btn-new-game')?.click(); return !!document.getElementById('menu-gamemode-view')?.classList.contains('active'); })()`).catch(() => false);
    if (v) break;
    await sleep(1000);
  }
  await sleep(600);
  for (let i = 0; i < 60; i++) {
    // startGame dodaje „is-launching” synchronicznie (przed pierwszym await) — drugi klik startu już nie pójdzie
    const v = await ev(`(() => { const mm = document.getElementById('main-menu');
      if (mm && (mm.classList.contains('is-launching') || mm.classList.contains('hidden'))) return true;
      document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click();
      return !!mm && (mm.classList.contains('is-launching') || mm.classList.contains('hidden')); })()`).catch(() => false);
    if (v) break;
    await sleep(1000);
  }
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib && !!window.camera && !!window.__beltWorld", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  for (let i = 0; i < 40 && !wk.sid; i++) await sleep(250);
  console.log('sesja workera:', !!wk.sid, 'czas startu', ((Date.now() - tStart) / 1000).toFixed(0), 's');
  if (!wk.sid) throw new Error('bez sesji workera renderu — narzędzie mierzy tryb gracza');
  await ev(`(window.RenderWorkerHost.dev({ eval: 'globalThis.__C3 = Core3D; globalThis.__ST = st;' }), true)`);
  let inst = '';
  for (let i = 0; i < 20 && inst !== 'ok' && inst !== 'już'; i++) { await sleep(500); inst = await wkEval(SONDA_INSTALUJ).catch((e) => e.message); }
  console.log('sonda:', inst, '| rozszerzenie:', await wkEval(SONDA_EXT).catch((e) => e.message));
  await ev(GUARD);
  // wejście użytkownika w oknie harnessu zablokowane (--blokada 0 — bez blokady)
  if (String(args.blokada ?? '1') === '1') { report.blokadaWejscia = await ev(BLOKADA_WEJSCIA).catch((e) => e.message); console.log('blokada wejścia:', report.blokadaWejscia); }
  // PerfHUD strony (czas wątku gry na klatkę) — ten sam moduł co index.html
  await ev(`(async () => { try { window.__PH = (await import('/src/ui/perfHud.js')).PerfHUD; } catch (e) { window.__PH = null; } return !!window.__PH; })()`).catch(() => false);
  if (RYTM) console.log('rytm:', await ev(RYTM_INSTALL));
  report.adapter = await wkEval(`(async () => { const C = globalThis.__C3, d = C.renderer.backend.device, a = C.renderer.backend.adapter;
    let info = null; try { info = a && a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description } : null; } catch (_) {}
    return { info, features: d ? [...d.features].filter((f) => /timestamp|shader-f16|subgroups/.test(f)) : null, msaa: C.msaaSamples, renderScale: C.renderScale, pixelRatio: C.pixelRatio,
      cel: C.composerTarget ? [C.composerTarget.width, C.composerTarget.height, C.composerTarget.samples] : null, halo: C.planetHaloTarget ? [C.planetHaloTarget.width, C.planetHaloTarget.height] : null }; })()`).catch((e) => ({ blad: e.message }));
  console.log('adapter / cele:', JSON.stringify(report.adapter));

  // Atlas w gęstym polu, zoom bliski; rozgrzanie pola gazu (3 s × 4), komórki pasa
  report.miejsce = await ev(NA_MIEJSCE(ZB));
  console.log('miejsce:', JSON.stringify(report.miejsce), 'zoomy', JSON.stringify(report.zoomy));
  await sleep(8000);
  let gl = '';
  for (let i = 0; i < 20 && gl !== 'ok' && gl !== 'już'; i++) { gl = await wkEval(GAZ_LOG_INSTALUJ).catch((e) => e.message); if (gl !== 'ok' && gl !== 'już') await sleep(500); }
  console.log('dziennik gazu:', gl);
  const proc = await znajdzProcesGpu(mojPort).catch((e) => ({ blad: String(e) }));
  report.procesy = proc;
  // bez procesu GPU Chrome liczniki karty (pamięć dedykowana / współdzielona adaptera, 3D dwm) i tak się przydają
  liczniki = startLiczniki(proc.gpu || 0);
  await sleep(2500);
  console.log('proces GPU Chrome:', JSON.stringify(proc), 'liczniki:', !!liczniki);
  if (BALAST_GB > 0) {
    balast = await startVramBallast({ gb: BALAST_GB, port: 5700 + Math.floor(Math.random() * 200) });
    report.balast = { info: balast.info, gb: BALAST_GB };
    console.log('balast VRAM:', JSON.stringify(balast.info));
    await sleep(3000);
  }
  await obceTeraz('start');

  // ── okna główne (--okna lista: postoj-blisko,postoj-daleko,ciag-blisko,ciag-srednio,ciag-daleko,ciag-max,kolko) ──
  const OKNA = args.okna ? new Set(String(args.okna).split(',').map((s) => s.trim())) : null;
  const okn = (n) => !OKNA || OKNA.has(n);
  const statSkal = async (label) => {
    const r = await wkEval(STAT_SKAL).catch((e) => ({ blad: e.message }));
    report.skaly[label] = r;
    if (r && r.warstwy) console.log(`   skały (${label}): ekran ${r.ekranPx} px, zoom ${r.zoom}`, r.warstwy.map((w) => `${w.pasmo}: n ${w.n} lod ${JSON.stringify(w.lod)} pole/ekran ${w.udzialEkranu} (<2px ${w.ponizej2px}, <4px ${w.ponizej4px}, <9px ${w.ponizej9px}) pole lod ${JSON.stringify(w.poleLod)}`).join(' | '));
    else console.log(`   skały (${label}):`, JSON.stringify(r));
  };
  if (okn('postoj-blisko')) {
    await okno('postoj-blisko', OKNO_S, { sladS: SLAD, gaz: true });
    await statSkal('postoj-blisko');
    await zrzut('01-postoj-blisko');
  }
  if (okn('postoj-daleko')) {
    await ev(NA_MIEJSCE(ZD));
    await sleep(3000);
    await okno('postoj-daleko', OKNO_S, { sladS: SLAD, gaz: true });
    await statSkal('postoj-daleko');
  }
  // obraz A/B w pauzie (--obrazAB lista wariantów) przy bieżącym kadrze
  const OBRAZ_AB = listaArg(args.obrazAB, []).filter((n) => WARIANTY[n]);
  if (OBRAZ_AB.length) {
    await ev('(() => { window.__setGamePaused(true); return true; })()');
    await sleep(1500);
    for (const nazwa of OBRAZ_AB) {
      const v = WARIANTY[nazwa];
      try {
        // kontrola A → A2 i wariant A2 → B w tym samym odstępie (czas ustalenia wariantu): to, co rusza się w pauzie
        // (zegar efektów), zmienia oba porównania tak samo
        const ustal = (v.ustal ?? 1.2) * 1000;
        await wkEval(OBRAZ_CZYTAJ('A'), 60000);
        await sleep(ustal);
        await wkEval(OBRAZ_CZYTAJ('A2'), 60000);
        if (v.strona) await stronaKod(v.strona);
        if (v.wk) await wkKod(v.wk);
        await sleep(ustal);
        await wkEval(OBRAZ_CZYTAJ('B'), 60000);
        if (v.wkPrzywroc) await wkKod(v.wkPrzywroc);
        if (v.stronaPrzywroc) await stronaKod(v.stronaPrzywroc);
        const kontrola = await wkEval(OBRAZ_ROZNICA('A', 'A2', 'k-' + nazwa), 60000);
        const wynik = await wkEval(OBRAZ_ROZNICA('A2', 'B', nazwa), 60000);
        report.obrazAB.push({ wariant: nazwa, opis: v.opis, kontrola, wynik });
        console.log(`obraz A/B ${nazwa}: kontrola A–A2 ${JSON.stringify(kontrola)} | A2–B ${JSON.stringify(wynik)} — ${v.opis}`);
      } catch (e) { console.log('obraz A/B', nazwa, e.message); report.bledy.push(`obraz A/B ${nazwa}: ${e.message}`); }
      await sleep((v.po ?? 1) * 1000);
    }
    // nakładanie się masek różnic wariantów (np. Z0 wobec B1p — pokrycie skałami gry): |A ∩ B| / |A|
    report.obrazMaski = await wkEval(`(() => { const M = globalThis.__obrazMaski || {}, k = Object.keys(M), o = {};
      for (const a of k) for (const b of k) if (a !== b) { const x = M[a], y = M[b]; let n = 0, w = 0; for (let i = 0; i < x.length; i++) if (x[i]) { n++; if (y[i]) w++; } o[a + '∩' + b] = n ? +(w / n).toFixed(3) : null; }
      globalThis.__obrazMaski = null; return o; })()`, 60000).catch((e) => ({ blad: e.message }));
    console.log('obraz A/B — nakładanie masek różnic |A∩B|/|A|:', JSON.stringify(report.obrazMaski));
    await wkEval('(() => { globalThis.__obraz = null; return true; })()').catch(() => {});
    await ev('(() => { window.__setGamePaused(false); return true; })()');
    await sleep(1000);
  }
  const PRZELOTY = [['blisko', ZB, '02'], ['srednio', ZS, '03'], ['daleko', ZD, '04'], ['max', ZM, '05']].filter((p) => okn(`ciag-${p[0]}`));
  for (const [nazwa, z, nr] of PRZELOTY) {
    await przelotStart(z);
    await okno(`ciag-${nazwa}`, OKNO_S, { gaz: true });
    await zrzut(`${nr}-ciag-${nazwa}`);
    await sladZaRufa(`ciag-${nazwa}`);
    if (nazwa === 'daleko' && SLAD > 0) {
      const sl = await slad(SLAD).catch((e) => ({ blad: String(e) }));
      report.slady['ciag-daleko-po'] = sl;
      if (sl && !sl.blad) console.log('   ślad (przelot daleko):', JSON.stringify(sl.zajetosc), sl.topGpuMain.slice(0, 5).map((r) => `${r[0]} ${r[1]}ms/${r[2]}`).join(' | '));
    }
    await up('w');
  }
  // ząbki kółka (3 × przybliżenie, 3 × oddalenie, co 0,7 s — sprężyna zoomu): mapy gazu i ośrodek pasa
  // przepróbkowywane przy każdej zmianie zoomu (dziennik gazu: przeprobkowanieMap / przeprobkowanieOsrodka)
  if (String(args.kolko ?? '1') === '1' && okn('kolko')) {
    await up('w').catch(() => {});
    await ev(NA_MIEJSCE(ZB));
    await sleep(3000);
    await ev(`(() => { window.__kolkoN = 0; window.__kolko = setInterval(() => { const c = window.camera, k = ++window.__kolkoN;
      c.targetZoom = c.targetZoom * (Math.floor((k - 1) / 3) % 2 === 0 ? 1 / 1.15 : 1.15); }, 700); return true; })()`);
    await okno('kolko-blisko', OKNO_S, { gaz: true });
    await ev('(() => { clearInterval(window.__kolko); return window.__kolkoN; })()');
    // --kolkoAb S2,…: te same ząbki kółka z wariantem (dawne zachowanie) — przepróbkowanie map i ośrodka przy ruchu zoomu
    for (const nazwa of listaArg(args.kolkoAb, []).filter((n) => WARIANTY[n])) {
      const v = WARIANTY[nazwa];
      await ev(NA_MIEJSCE(ZB));
      if (v.strona) await stronaKod(v.strona);
      if (v.wk) await wkKod(v.wk);
      await sleep(3000);
      await ev(`(() => { window.__kolkoN = 0; window.__kolko = setInterval(() => { const c = window.camera, k = ++window.__kolkoN;
        c.targetZoom = c.targetZoom * (Math.floor((k - 1) / 3) % 2 === 0 ? 1 / 1.15 : 1.15); }, 700); return true; })()`);
      await okno(`kolko-blisko-${nazwa}`, OKNO_S, { gaz: true });
      await ev('(() => { clearInterval(window.__kolko); return window.__kolkoN; })()');
      if (v.wkPrzywroc) await wkKod(v.wkPrzywroc);
      if (v.stronaPrzywroc) await stronaKod(v.stronaPrzywroc);
    }
  }
  // --oknaWariant WSZYSTKO,NOWE,…: po oknach głównych okna postoju i przelotu przy zoomie dalekim (--oknoS s) po kolei
  // z wariantem włączonym na cały czas okien (nie naprzemiennie co 15 s — przestoje klatek workera bez przejść po
  // przełączeniach: 3 s zapasu po włączeniu i po przywróceniu)
  for (const nazwa of listaArg(args.oknaWariant, []).filter((n) => WARIANTY[n])) {
    const v = WARIANTY[nazwa];
    const p = { n: nazwa, strona: v.strona, stronaP: v.stronaPrzywroc, wk: v.wk, wkP: v.wkPrzywroc };
    await przelacz(p, true);
    await sleep((v.ustal ?? 1.2) * 1000 + 3000);
    await ev(NA_MIEJSCE(ZD));
    await sleep(3000);
    await okno(`postoj-daleko-${nazwa}`, OKNO_S, { gaz: true });
    await przelotStart(ZD);
    await okno(`ciag-daleko-${nazwa}`, OKNO_S, { gaz: true });
    await up('w');
    await przelacz(p, false);
    await sleep((v.po ?? 1) * 1000 + 3000);
  }
  if (String(args.oknaWariant || '') !== '') await obceTeraz('po oknach z wariantem');
  if (ZAB_DIR) {
    await zrzutyAB();
    await obceTeraz('po zrzutach A/B');
  }

  // ── A/B ──
  if (AB_DALEKO.length) {
    await up('w');
    await ev(NA_MIEJSCE(ZD));
    await down('w');   // ciąg w miejscu (dysze pchają gaz), kamera stoi
    await sleep(4000);
    zoomAB = ZD;
    await seriaAB('daleko', AB_DALEKO);
    zoomAB = null;
    await up('w');
    await obceTeraz('po A/B daleko');
  }
  if (AB_BLISKO.length) {
    await ev(NA_MIEJSCE(ZB));
    await down('w');
    await sleep(4000);
    zoomAB = ZB;
    await seriaAB('blisko', AB_BLISKO);
    zoomAB = null;
    await up('w');
    await obceTeraz('po A/B blisko');
  }
  if (AB_LOT.length) {
    // w przelocie: przed każdym oknem (baza i wariant) świeży przelot od miejsca „pole” przy zoomie dalekim
    await seriaAB('lot', AB_LOT, () => przelotStart(ZD, { trzymaj: 2.5, rozped: 1.5 }));
    await up('w');
  }
  if (report.ab.length) podsumujAB();
  // ── balast VRAM po A/B (--balastPo N GB): te same okna postoju i przelotu przy zoomie dalekim pod presją pamięci
  // karty (u gracza: dwm ~3,8 GB + inne programy) — kolejka GPU rośnie przy małych znacznikach = stronicowanie ──
  // ── rzednięcie okna na długim postoju (--rzedniecie S, zoom --zoomRz 0.1) ──
  const RZ_S = Number(args.rzedniecie || 0);
  if (RZ_S > 0) {
    await up('w').catch(() => {});
    const zr = Number(args.zoomRz || 0.1);
    await ev(NA_MIEJSCE(zr));
    const t0 = Date.now(), pomiary = [];
    for (const t of [5, RZ_S / 2, RZ_S]) {
      const czekaj = t * 1000 - (Date.now() - t0);
      if (czekaj > 0) await sleep(czekaj);
      const r = await wkEval(RZEDNIECIE, 60000).catch((e) => ({ blad: e.message }));
      pomiary.push({ s: Math.round((Date.now() - t0) / 1000), ...r });
      console.log(`rzednięcie okna (zoom ${zr}): ${JSON.stringify(pomiary.at(-1))}`);
    }
    report.rzedniecie = { zoom: zr, pomiary };
    await zrzut('06-postoj-dlugi');
  }
  const BALAST_PO = Number(args.balastPo || 0);
  if (BALAST_PO > 0) {
    await up('w').catch(() => {});
    balast = await startVramBallast({ gb: BALAST_PO, port: 5700 + Math.floor(Math.random() * 200) });
    report.balastPo = { info: balast.info, gb: BALAST_PO };
    console.log('balast VRAM (po A/B):', JSON.stringify(balast.info));
    await sleep(5000);
    await ev(NA_MIEJSCE(ZD));
    await sleep(3000);
    await okno('balast-postoj-daleko', OKNO_S, { sladS: SLAD, gaz: true });
    await przelotStart(ZD);
    await okno('balast-ciag-daleko', OKNO_S, { gaz: true });
    await up('w');
    report.balastPoStan = await balast.stan().catch(() => null);
    const b = balast; balast = null;
    await b.stop().catch(() => {});
    await sleep(5000);
    await ev(NA_MIEJSCE(ZD));
    await sleep(3000);
    await okno('po-balascie-postoj-daleko', OKNO_S, { gaz: true });
  }
} catch (err) {
  console.error(err);
  report.bledy.push(String(err?.stack || err));
} finally {
  clearTimeout(watchdog);
  await up('w').catch(() => {});
  report.obceKoniec = await obceProcesy().catch(() => null);
  report.maszynaKoniec = await stanMaszyny().catch(() => null);
  if (balast) { report.balastKoniec = await balast.stan().catch(() => null); }
  const other = report.wkLogi.filter((l) => /warn|error|exception|pipeline sync|kompilacja w grze/.test(l.type + ' ' + l.text));
  for (const l of other.slice(0, 20)) console.log('  wk', l.type, l.s, l.text.slice(0, 220));
  for (const l of report.strona.slice(0, 10)) console.log('  strona', l.type, l.s, l.text.slice(0, 220));
  console.log('raport:', join(out, 'raport.json'));
  finish(0);
}
