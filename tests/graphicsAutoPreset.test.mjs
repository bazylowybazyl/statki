// Dobór presetu grafiki przy pierwszym uruchomieniu (src/game/graphicsAutoPreset.js): reguły ogólne z adapter.info
// (producent, rodzina architektury, fallback, limity) i rozdzielczości ekranu; nierozpoznane — Wysoka; Ultra nigdy.
// Klej: hak Core3D.onAdapter przed urządzeniem (MSAA presetu w celach sceny), zapis i informacja w opcjach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const A = await import('../src/game/graphicsAutoPreset.js');
const G = await import('../src/game/graphicsQuality.js');
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const adapter = (info, limits = {}) => ({ info, limits: { maxTextureDimension2D: 16384, ...limits } });
const pick = (info, env = {}, limits) => A.pickGfxPresetAuto(A.describeGpuAdapter(adapter(info, limits)), { screenW: 1920, screenH: 1080, ...env });
const FHD = { screenW: 1920, screenH: 1080 };
const QHD = { screenW: 2560, screenH: 1440 };
const UHD = { screenW: 3840, screenH: 2160 };

test('opis adaptera: info z Chrome (małe litery), fallback, limit tekstury; brak danych — puste', () => {
  const d = A.describeGpuAdapter(adapter({ vendor: 'NVIDIA', architecture: 'Blackwell', device: '', description: '' }));
  assert.equal(d.vendor, 'nvidia');
  assert.equal(d.architecture, 'blackwell');
  assert.equal(d.fallback, false);
  assert.equal(d.maxTexture2D, 16384);
  assert.equal(A.describeGpuAdapter({ info: { isFallbackAdapter: true } }).fallback, true);
  assert.equal(A.describeGpuAdapter({ isFallbackAdapter: true }).fallback, true, 'dawne pole adaptera');
  const none = A.describeGpuAdapter(null);
  assert.deepEqual([none.vendor, none.architecture, none.fallback, none.maxTexture2D], ['', '', false, 0]);
});

test('klasy kart: producent i rodzina architektury, bez list modeli', () => {
  const tier = (info) => A.classifyGpu(A.describeGpuAdapter(adapter(info))).tier;
  assert.equal(tier({ vendor: 'nvidia', architecture: 'blackwell' }), 'discrete');
  assert.equal(tier({ vendor: 'nvidia', architecture: 'turing' }), 'discrete');
  assert.equal(tier({ vendor: 'nvidia', architecture: 'pascal' }), 'discreteOld');
  assert.equal(tier({ vendor: 'nvidia', architecture: 'maxwell' }), 'discreteOld');
  assert.equal(tier({ vendor: 'nvidia', architecture: 'nowa-generacja' }), 'discrete', 'nieznana nowsza rodzina — nowa');
  assert.equal(tier({ vendor: 'amd', architecture: 'rdna-3' }), 'discrete');
  assert.equal(tier({ vendor: 'amd', architecture: 'gcn-5' }), 'discreteOld');
  assert.equal(tier({ vendor: 'intel', architecture: 'gen-12lp' }), 'integratedOld');
  assert.equal(tier({ vendor: 'intel', architecture: 'gen-9' }), 'integratedOld');
  assert.equal(tier({ vendor: 'intel', architecture: 'xe-lpg' }), 'integrated');
  assert.equal(tier({ vendor: 'intel', architecture: 'xe-2lpg' }), 'integrated');
  assert.equal(tier({ vendor: 'intel', architecture: 'xe-hpg' }), 'discreteOld', 'Arc (Xe-HPG) — dyskretna');
  assert.equal(tier({ vendor: 'intel', architecture: 'xe-2hpg' }), 'discreteOld');
  assert.equal(tier({ vendor: 'intel', architecture: 'gen-12hp' }), 'discreteOld');
  assert.equal(tier({ vendor: 'apple', architecture: 'metal-3' }), 'integrated');
  assert.equal(tier({ vendor: 'qualcomm', architecture: 'adreno-7xx' }), 'integrated');
  assert.equal(tier({ vendor: 'arm', architecture: 'valhall' }), 'mobile');
  assert.equal(tier({ vendor: 'google', architecture: 'swiftshader' }), 'software');
  assert.equal(tier({ vendor: 'microsoft', architecture: '' }), 'software', 'WARP / Basic Render');
  assert.equal(tier({ vendor: '', architecture: '', description: 'llvmpipe (LLVM 15.0.7, 256 bits)' }), 'software');
  assert.equal(tier({ vendor: 'nvidia', architecture: 'ampere', isFallbackAdapter: true }), 'software', 'fallback bije producenta');
  assert.equal(tier({ vendor: '', architecture: '', description: 'NVIDIA GeForce RTX 4070' }), 'discrete', 'producent z opisu');
  assert.equal(tier({ vendor: '', architecture: '' }), 'unknown');
  assert.equal(tier({ vendor: 'nowa-firma', architecture: 'x' }), 'unknown');
});

test('presety: zintegrowana / mało pamięci → Niska lub Średnia, dyskretna → Wysoka, nierozpoznana → Wysoka', () => {
  // Mocna dyskretna — Wysoka (= gra sprzed opcji) do 1440p / ultrawide; 4K — Średnia (85%).
  assert.equal(pick({ vendor: 'nvidia', architecture: 'blackwell' }, FHD).preset, 'high');
  assert.equal(pick({ vendor: 'amd', architecture: 'rdna-2' }, QHD).preset, 'high');
  assert.equal(pick({ vendor: 'nvidia', architecture: 'ampere' }, { screenW: 3440, screenH: 1440 }).preset, 'high');
  assert.equal(pick({ vendor: 'nvidia', architecture: 'lovelace' }, UHD).preset, 'medium');
  // Starsza dyskretna: 1080p — Wysoka, 1440p — Średnia, 4K — Niska.
  assert.equal(pick({ vendor: 'nvidia', architecture: 'pascal' }, FHD).preset, 'high');
  assert.equal(pick({ vendor: 'nvidia', architecture: 'pascal' }, QHD).preset, 'medium');
  assert.equal(pick({ vendor: 'amd', architecture: 'gcn-4' }, UHD).preset, 'low');
  // Zintegrowana: 1080p — Średnia, wyżej — Niska; starsza zintegrowana, mobilna, programowa — Niska.
  assert.equal(pick({ vendor: 'intel', architecture: 'xe-lpg' }, FHD).preset, 'medium');
  assert.equal(pick({ vendor: 'intel', architecture: 'xe-lpg' }, QHD).preset, 'low');
  assert.equal(pick({ vendor: 'apple', architecture: 'metal-3' }, { screenW: 1512, screenH: 982 }).preset, 'medium');
  assert.equal(pick({ vendor: 'intel', architecture: 'gen-12lp' }, FHD).preset, 'low');
  assert.equal(pick({ vendor: 'arm', architecture: 'valhall' }, FHD).preset, 'low');
  assert.equal(pick({ vendor: 'google', architecture: 'swiftshader' }, FHD).preset, 'low');
  // Nierozpoznana — Wysoka (bezpieczny wynik domyślny), bez względu na ekran.
  assert.equal(pick({ vendor: '', architecture: '' }, UHD).preset, 'high');
  assert.equal(A.pickGfxPresetAuto(A.describeGpuAdapter(null), {}).preset, 'high');
  // Mało pamięci RAM — stopień niżej; limit tekstury < 16384 — najwyżej Średnia.
  const mem = pick({ vendor: 'nvidia', architecture: 'ampere' }, { ...FHD, deviceMemory: 2 });
  assert.equal(mem.preset, 'medium');
  assert.ok(mem.reasons.some((r) => /pamięci/.test(r)));
  assert.equal(pick({ vendor: 'intel', architecture: 'xe-lpg' }, { ...FHD, deviceMemory: 2 }).preset, 'low');
  assert.equal(pick({ vendor: 'nvidia', architecture: 'ampere' }, { ...FHD, deviceMemory: 8 }).preset, 'high');
  assert.equal(pick({ vendor: 'nvidia', architecture: 'ampere' }, FHD, { maxTextureDimension2D: 8192 }).preset, 'medium');
  // Okno większe niż zgłoszony ekran (wiele monitorów) — liczy się większe.
  assert.equal(pick({ vendor: 'intel', architecture: 'xe-lpg' }, { screenW: 1280, screenH: 720, viewW: 2560, viewH: 1440 }).preset, 'low');
});

test('wynik: zawsze preset z listy (nigdy Ultra), powody po polsku, mp ekranu', () => {
  const vendors = ['nvidia', 'amd', 'intel', 'apple', 'qualcomm', 'arm', 'google', 'microsoft', '', 'x'];
  const archs = ['', 'blackwell', 'pascal', 'rdna-3', 'gcn-5', 'gen-9', 'xe-lpg', 'xe-hpg', 'metal-3', 'swiftshader'];
  const screens = [[0, 0], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [7680, 4320]];
  for (const vendor of vendors) for (const architecture of archs) for (const [screenW, screenH] of screens) {
    for (const deviceMemory of [undefined, 1, 8]) {
      const r = A.pickGfxPresetAuto(A.describeGpuAdapter(adapter({ vendor, architecture })), { screenW, screenH, deviceMemory });
      assert.ok(['low', 'medium', 'high'].includes(r.preset), `${vendor}/${architecture} ${screenW}: ${r.preset}`);
      assert.ok(r.reasons.length >= 1 && typeof r.label === 'string' && r.label.length > 0);
    }
  }
  const r = pick({ vendor: 'intel', architecture: 'xe-lpg' }, FHD);
  assert.equal(r.mp, 2.07);
  assert.match(r.label, /karta zintegrowana Intel, ekran 1920×1080/);
});

test('?grafikaAuto= — bez doboru / wymuszony dobór', () => {
  assert.equal(A.gfxAutoFromQuery('?grafikaAuto=0'), 'off');
  assert.equal(A.gfxAutoFromQuery('?dev=1&grafikaAuto=1'), 'force');
  assert.equal(A.gfxAutoFromQuery('?grafikaAuto=tak'), 'force');
  assert.equal(A.gfxAutoFromQuery('?dev=1'), null);
  assert.equal(A.gfxAutoFromQuery(''), null);
});

test('pierwsze uruchomienie = brak sc_gfx i dawnych kluczy opcji', () => {
  const st = (init) => ({ getItem: (k) => (k in init ? init[k] : null) });
  assert.equal(G.hasSavedGfx(st({})), false);
  assert.equal(G.hasSavedGfx(st({ sc_audio: '1', sc_gfx_auto: '{}' })), false, 'inne klucze i informacja o doborze nie liczą się');
  assert.equal(G.hasSavedGfx(st({ sc_gfx: '{}' })), true);
  assert.equal(G.hasSavedGfx(st({ sc_hull_light: 'classic' })), true, 'dawny wybór sprzed presetów');
  assert.equal(G.hasSavedGfx(st({ sc_space_dust: 'off' })), true);
  assert.equal(G.hasSavedGfx(null), false);
});

test('klej: hak adaptera przed urządzeniem, MSAA presetu do celów sceny, informacja w opcjach', () => {
  const core = src('src/3d/core3d.js');
  const hook = core.indexOf('this.onAdapter?.(adapter)');
  const lock = core.indexOf('this._msaaLocked = true;');
  const dev = core.indexOf('new THREE.WebGPURenderer(');
  assert.ok(hook > 0 && hook < lock && lock < dev, 'onAdapter, potem blokada próbek, potem urządzenie');
  assert.match(core, /if \(msaa !== undefined && !this\._msaaLocked\) \{/);
  assert.match(core, /if \(this\.isInitialized\) this\.setMsaaEnabled\(this\.msaaBoot > 0, 4\);/);
  const html = src('index.html');
  assert.match(html, /Core3D\.onAdapter = \(adapter\) => \{/);
  assert.match(html, /!urlPreset && autoMode !== 'off' && \(autoMode === 'force' \|\| !hasSavedGfx\(localStorage\)\)/);
  assert.ok(html.includes('data-gfx-auto hidden'), 'informacja „dobrane automatycznie” w opcjach');
  assert.ok(html.includes("'sc_gfx', 'sc_gfx_auto'"), 'reset zapisu zna klucz doboru');
});
