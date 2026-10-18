const { app, BrowserWindow, ipcMain, net, protocol, session } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_SCHEME = 'app';
const APP_HOST = 'bundle';
const DIST_ROOT = path.resolve(__dirname, '../dist');

// Katalog danych (localStorage: zapisy, edytor gniazd, opcje + profil Chromium) — Dokumenty\HULLFALL.
// Do 2026-10-07 był w %APPDATA%\Statki Demo: pierwsze uruchomienie kopiuje stamtąd Local Storage
// (same zapisy — cache shaderów i reszta profilu odbudują się same). Stary folder zostaje nietknięty.
const USER_DATA_DIR = path.join(app.getPath('documents'), 'HULLFALL');
const LEGACY_USER_DATA_DIR = path.join(app.getPath('appData'), 'Statki Demo');

function migrateLegacySaves() {
  const from = path.join(LEGACY_USER_DATA_DIR, 'Local Storage');
  const to = path.join(USER_DATA_DIR, 'Local Storage');
  if (fs.existsSync(to) || !fs.existsSync(from)) return;
  // Kopia do folderu roboczego i zmiana nazwy — przerwana kopia nie zostawi połowy bazy LevelDB.
  const tmp = `${to}.migracja`;
  try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.cpSync(from, tmp, { recursive: true });
    fs.renameSync(tmp, to);
  } catch (err) {
    console.warn(`[zapisy] nie udało się skopiować zapisów z ${from}:`, err);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* zostaje do następnej próby */ }
  }
}

migrateLegacySaves();
app.setPath('userData', USER_DATA_DIR);

// Ustawienia startu — to, co Chromium czyta tylko przy uruchomieniu procesu: Dokumenty\HULLFALL\uruchomienie.json.
// Pisze je gra (Opcje → Grafika, blok „OPCJE GRAFIKI” w index.html) przez preload (window.hullfallApp). Dziś: VSync.
const LAUNCH_FILE = path.join(USER_DATA_DIR, 'uruchomienie.json');

function readLaunchSettings() {
  try {
    const v = JSON.parse(fs.readFileSync(LAUNCH_FILE, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeLaunchSettings(next) {
  const tmp = `${LAUNCH_FILE}.tmp`;
  try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, LAUNCH_FILE);
    return true;
  } catch (err) {
    console.warn(`[uruchomienie] nie udało się zapisać ${LAUNCH_FILE}:`, err);
    return false;
  }
}

// VSync (domyślnie wł.). Wył. = rAF strony i workera renderu oraz kompozytor bez taktu odświeżania ekranu
// (disable-frame-rate-limit), prezentacja bez czekania na vsync (disable-gpu-vsync) — gra rysuje tyle klatek, ile
// zdąży. Flagi działają tylko od startu procesu, więc zmiana w opcjach = ponowne uruchomienie gry.
// HULLFALL_VSYNC=0 | 1 — nadpisanie na to uruchomienie, bez zapisu (narzędzia, pomiary).
const VSYNC_ENV = process.env.HULLFALL_VSYNC;
const VSYNC = VSYNC_ENV === '0' ? false : VSYNC_ENV === '1' ? true : readLaunchSettings().vsync !== false;
if (!VSYNC) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true
    }
  }
]);

function resolveBundledPath(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== APP_HOST) return null;
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const resolved = path.resolve(DIST_ROOT, `.${pathname}`);
  const relative = path.relative(DIST_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return resolved === path.join(DIST_ROOT, 'index.html') ? resolved : null;
  }
  return resolved;
}

async function handleAppRequest(request) {
  const bundledPath = resolveBundledPath(request.url);
  if (!bundledPath) return new Response('Not found', { status: 404 });
  let response;
  try {
    response = await net.fetch(pathToFileURL(bundledPath).toString());
  } catch (err) {
    console.warn(`[app://] brak pliku: ${path.relative(DIST_ROOT, bundledPath)}`);
    return new Response('Not found', { status: 404 });
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// --- Most gra ↔ Electron (electron/preload.js → window.hullfallApp) ---
// Tylko strona gry z app://bundle/ (inna treść w oknie nic nie zmieni).
const GAME_URL_PREFIX = `${APP_SCHEME}://${APP_HOST}/`;
function fromGame(event) {
  const url = event && event.senderFrame ? event.senderFrame.url : '';
  return typeof url === 'string' && url.startsWith(GAME_URL_PREFIX);
}

// Stan na start strony (preload pyta synchronicznie — przy każdym wczytaniu strony świeży plik): VSync tego
// uruchomienia i wybór zapisany na następne.
ipcMain.on('hullfall:launch-state', (event) => {
  event.returnValue = fromGame(event)
    ? { vsync: VSYNC, vsyncSaved: readLaunchSettings().vsync !== false, portable: !!process.env.PORTABLE_EXECUTABLE_FILE }
    : null;
});

ipcMain.handle('hullfall:set-vsync', (event, on) => {
  if (!fromGame(event)) return null;
  const cur = readLaunchSettings();
  const want = on !== false;
  if ((cur.vsync !== false) !== want) writeLaunchSettings({ ...cur, vsync: want });
  return readLaunchSettings().vsync !== false;
});

// Ponowne uruchomienie (nowe flagi startu). Zamknięcie łagodne (app.quit): beforeunload strony zapisuje wyposażenie,
// localStorage dopisany na dysk.
function relaunchApp() {
  try { session.defaultSession.flushStorageData(); } catch { /* i tak przy zamknięciu */ }
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExe) {
    // Wersja przenośna: obudowa NSIS czeka na grę (ExecWait) i potem kasuje rozpakowany katalog %TEMP%\HULLFALL-portable,
    // więc app.relaunch() uruchomiłby grę z katalogu, który za chwilę zniknie. Nowy start przez .exe obudowy, dopiero
    // gdy stara obudowa (proces-rodzic) skończy sprzątać.
    const script = `Wait-Process -Id ${process.ppid} -ErrorAction SilentlyContinue; Start-Process -FilePath '${portableExe.replace(/'/g, "''")}'`;
    try {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (err) {
      console.warn('[restart] wersja przenośna: nie udało się zaplanować startu:', err);
    }
  } else {
    app.relaunch();
  }
  app.quit();
}

ipcMain.handle('hullfall:relaunch', (event) => {
  if (!fromGame(event)) return false;
  // odpowiedź wraca do strony przed zamknięciem okna
  setTimeout(relaunchApp, 50);
  return true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'HULLFALL',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
  });

  win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);

  // Demo: DevTools tylko na żądanie — Ctrl+Shift+F12 (samo F12 to panel gry) albo zmienna HULLFALL_DEVTOOLS=1.
  if (process.env.HULLFALL_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && input.control && input.shift) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, handleAppRequest);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
