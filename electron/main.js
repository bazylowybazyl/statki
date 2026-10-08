const { app, BrowserWindow, net, protocol } = require('electron');
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
