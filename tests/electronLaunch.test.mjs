// Ustawienia startu Electrona (electron/main.js, electron/preload.js) — VSync: wybór z pliku
// Dokumenty\HULLFALL\uruchomienie.json → flagi Chromium przed `ready`, nadpisanie HULLFALL_VSYNC, most IPC (stan na
// start strony, zapis wyboru, ponowne uruchomienie, odmowa obcym stronom), preload na tych samych kanałach. main.js
// i preload.js ładowane z atrapą modułu `electron` (bez Electrona).
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const MAIN = fileURLToPath(new URL('../electron/main.js', import.meta.url));
const PRELOAD = fileURLToPath(new URL('../electron/preload.js', import.meta.url));
const GAME = { senderFrame: { url: 'app://bundle/index.html' } };
const STRANGER = { senderFrame: { url: 'https://example.com/' } };

// Ładuje plik CommonJS z atrapą `electron` (Module._load) i ze zmiennymi środowiska tylko na czas ładowania.
function loadWithElectron(file, electron, env = {}) {
  const orig = Module._load;
  const keep = {};
  for (const [k, v] of Object.entries(env)) {
    keep[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    return orig.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[file];
    require(file);
  } finally {
    Module._load = orig;
    delete require.cache[file];
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function loadMain({ launch = undefined, vsyncEnv = undefined } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'hullfall-uruchomienie-'));
  const dataDir = path.join(root, 'documents', 'HULLFALL');
  const file = path.join(dataDir, 'uruchomienie.json');
  if (launch !== undefined) { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, typeof launch === 'string' ? launch : JSON.stringify(launch)); }
  const switches = [];
  const on = new Map();
  const handle = new Map();
  const calls = { relaunch: 0, quit: 0, flush: 0 };
  const electron = {
    app: {
      getPath: (name) => path.join(root, name),
      setPath() {},
      commandLine: { appendSwitch: (s, v) => switches.push(v === undefined ? s : `${s}=${v}`) },
      whenReady: () => new Promise(() => {}),   // okno nie powstaje
      on() {},
      relaunch: () => { calls.relaunch++; },
      quit: () => { calls.quit++; }
    },
    BrowserWindow: class {},
    net: {},
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    ipcMain: { on: (ch, fn) => on.set(ch, fn), handle: (ch, fn) => handle.set(ch, fn) },
    session: { defaultSession: { flushStorageData: () => { calls.flush++; } } }
  };
  loadWithElectron(MAIN, electron, { HULLFALL_VSYNC: vsyncEnv, PORTABLE_EXECUTABLE_FILE: undefined });
  const launchState = (event = GAME) => { const e = { ...event, returnValue: undefined }; on.get('hullfall:launch-state')(e); return e.returnValue; };
  const readFile = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  return { root, file, switches, on, handle, calls, launchState, readFile, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const VSYNC_OFF_SWITCHES = ['disable-frame-rate-limit', 'disable-gpu-vsync'];

test('VSync domyślnie wł.: bez pliku ustawień startu żadnych flag, stan dla strony gry', (t) => {
  const m = loadMain();
  t.after(m.cleanup);
  assert.deepEqual(m.switches, []);
  assert.deepEqual(m.launchState(), { vsync: true, vsyncSaved: true, portable: false });
  assert.equal(m.launchState(STRANGER), null, 'obca strona nie dostaje stanu');
  assert.equal(m.launchState({ senderFrame: null }), null);
});

test('plik { vsync: false } → flagi bez limitu klatek przed ready; zepsuty plik = domyślne', (t) => {
  const off = loadMain({ launch: { vsync: false } });
  t.after(off.cleanup);
  assert.deepEqual([...off.switches].sort(), [...VSYNC_OFF_SWITCHES].sort());
  assert.deepEqual(off.launchState(), { vsync: false, vsyncSaved: false, portable: false });

  const on = loadMain({ launch: { vsync: true } });
  t.after(on.cleanup);
  assert.deepEqual(on.switches, []);

  const bad = loadMain({ launch: '{zepsute' });
  t.after(bad.cleanup);
  assert.deepEqual(bad.switches, []);
  assert.deepEqual(bad.launchState(), { vsync: true, vsyncSaved: true, portable: false });
});

test('HULLFALL_VSYNC nadpisuje wybór na to uruchomienie (bez zapisu)', (t) => {
  const forcedOn = loadMain({ launch: { vsync: false }, vsyncEnv: '1' });
  t.after(forcedOn.cleanup);
  assert.deepEqual(forcedOn.switches, []);
  assert.deepEqual(forcedOn.launchState(), { vsync: true, vsyncSaved: false, portable: false });

  const forcedOff = loadMain({ vsyncEnv: '0' });
  t.after(forcedOff.cleanup);
  assert.deepEqual([...forcedOff.switches].sort(), [...VSYNC_OFF_SWITCHES].sort());
  assert.deepEqual(forcedOff.launchState(), { vsync: false, vsyncSaved: true, portable: false });
  assert.equal(forcedOff.readFile(), null, 'nadpisanie nie pisze pliku');
});

test('hullfall:set-vsync zapisuje wybór (inne pola pliku zostają), obcej stronie odmawia', async (t) => {
  const m = loadMain({ launch: { vsync: true, inne: 7 } });
  t.after(m.cleanup);
  const setVsync = m.handle.get('hullfall:set-vsync');
  assert.equal(await setVsync(GAME, false), false);
  assert.deepEqual(m.readFile(), { vsync: false, inne: 7 });
  assert.equal(m.launchState().vsyncSaved, false, 'stan na start strony czyta świeży plik');
  assert.equal(m.launchState().vsync, true, 'VSync tego uruchomienia bez zmian');
  assert.equal(await setVsync(GAME, true), true);
  assert.deepEqual(m.readFile(), { vsync: true, inne: 7 });
  assert.equal(await setVsync(STRANGER, false), null);
  assert.deepEqual(m.readFile(), { vsync: true, inne: 7 });
  // bez pliku: tworzy katalog i plik
  const fresh = loadMain();
  t.after(fresh.cleanup);
  assert.equal(await fresh.handle.get('hullfall:set-vsync')(GAME, false), false);
  assert.deepEqual(fresh.readFile(), { vsync: false });
});

test('hullfall:relaunch: zapis localStorage na dysk, app.relaunch + łagodne app.quit; obcej stronie odmawia', async (t) => {
  const m = loadMain();
  t.after(m.cleanup);
  const relaunch = m.handle.get('hullfall:relaunch');
  assert.equal(await relaunch(STRANGER), false);
  assert.equal(await relaunch(GAME), true);
  assert.deepEqual(m.calls, { relaunch: 0, quit: 0, flush: 0 }, 'odpowiedź wraca do strony przed zamknięciem');
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(m.calls, { relaunch: 1, quit: 1, flush: 1 });
  const src = readFileSync(MAIN, 'utf8');
  assert.ok(!/app\.exit\(/.test(src), 'app.exit pominąłby beforeunload strony (zapis wyposażenia) i dopisanie localStorage');
  // wersja przenośna: start przez .exe obudowy po jej końcu (obudowa NSIS kasuje rozpakowany katalog po wyjściu gry)
  assert.match(src, /PORTABLE_EXECUTABLE_FILE/);
  assert.match(src, /Wait-Process -Id \$\{process\.ppid\}/);
});

test('okno: preload z mostem, sandbox zostaje; preload pakowany', () => {
  const src = readFileSync(MAIN, 'utf8');
  assert.match(src, /preload: path\.join\(__dirname, 'preload\.js'\)/);
  assert.match(src, /sandbox: true/);
  assert.match(src, /contextIsolation: true/);
  assert.match(src, /nodeIntegration: false/);
  // flagi przed app.whenReady (Chromium czyta je przy starcie procesu)
  assert.ok(src.indexOf("appendSwitch('disable-frame-rate-limit')") < src.indexOf('app.whenReady('));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('electron/**/*'), 'electron/preload.js w paczce');
});

test('preload: window.hullfallApp z kanałów main.js; bez stanu (obca strona) — brak mostu', async () => {
  const exposeOf = (state) => {
    const exposed = {};
    const sent = [];
    const electron = {
      contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
      ipcRenderer: {
        sendSync: (ch) => { sent.push(['sendSync', ch]); return state; },
        invoke: (ch, ...args) => { sent.push(['invoke', ch, ...args]); return Promise.resolve(args[0] ?? true); }
      }
    };
    loadWithElectron(PRELOAD, electron);
    return { app: exposed.hullfallApp, sent };
  };
  const { app, sent } = exposeOf({ vsync: false, vsyncSaved: true, portable: true });
  assert.equal(app.vsync, false);
  assert.equal(app.vsyncSaved, true);
  assert.equal(app.portable, true);
  await app.setVsync(false);
  await app.setVsync(undefined);
  await app.relaunch();
  assert.deepEqual(sent, [
    ['sendSync', 'hullfall:launch-state'],
    ['invoke', 'hullfall:set-vsync', false],
    ['invoke', 'hullfall:set-vsync', true],
    ['invoke', 'hullfall:relaunch']
  ]);
  // te same kanały rejestruje main.js
  const m = loadMain();
  try {
    assert.ok(m.on.has('hullfall:launch-state'));
    assert.ok(m.handle.has('hullfall:set-vsync') && m.handle.has('hullfall:relaunch'));
  } finally { m.cleanup(); }
  assert.equal(exposeOf(null).app, undefined, 'bez stanu z main.js strona zachowuje się jak w przeglądarce');
});
