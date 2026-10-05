const { app, BrowserWindow, net, protocol } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_SCHEME = 'app';
const APP_HOST = 'bundle';
const DIST_ROOT = path.resolve(__dirname, '../dist');

// Katalog danych (localStorage: zapisy, edytor gniazd) z czasów nazwy "Statki Demo" — zmiana productName
// na HULLFALL przeniosłaby go do nowego folderu i zgubiła zapisy.
app.setPath('userData', path.join(app.getPath('appData'), 'Statki Demo'));

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
