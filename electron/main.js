const { app, BrowserWindow } = require('electron');
const path = require('path');

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
      webSecurity: false,   // allow file:// asset loading
    },
    autoHideMenuBar: true,
  });

  win.loadFile(path.join(__dirname, '../dist/index.html'));

  // DevTools w osobnym oknie — zamknij po debugowaniu
  win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
