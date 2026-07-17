const { app, BrowserWindow, net, protocol } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_SCHEME = 'app';
const APP_HOST = 'bundle';
const DIST_ROOT = path.resolve(__dirname, '../dist');

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
  const response = await net.fetch(pathToFileURL(bundledPath).toString());
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
    title: 'Statki Demo',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
    autoHideMenuBar: true,
  });

  win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);

  // DevTools w osobnym oknie — zamknij po debugowaniu
  win.webContents.openDevTools({ mode: 'detach' });
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
