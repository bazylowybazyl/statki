// Most gra ↔ Electron (okno z sandbox: tylko contextBridge i ipcRenderer). Strona widzi window.hullfallApp — czyta je
// blok „OPCJE GRAFIKI” w index.html (VSync) i pierwszy moduł strony (wybór VSync z pliku ustawień startu).
// W przeglądarce (serwer dev) obiektu nie ma: VSync ustawia tam przeglądarka.
const { contextBridge, ipcRenderer } = require('electron');

let state = null;
try { state = ipcRenderer.sendSync('hullfall:launch-state'); } catch { state = null; }

if (state && typeof state === 'object') {
  contextBridge.exposeInMainWorld('hullfallApp', {
    // VSync tego uruchomienia (flagi Chromium ustawione przy starcie procesu)
    vsync: state.vsync !== false,
    // wybór zapisany na następne uruchomienie (Dokumenty\HULLFALL\uruchomienie.json)
    vsyncSaved: state.vsyncSaved !== false,
    // wersja przenośna (restart przez .exe obudowy — dłuższy start)
    portable: state.portable === true,
    /** Zapis wyboru VSync na następne uruchomienie → Promise<boolean> (zapisany stan; null — odmowa). */
    setVsync: (on) => ipcRenderer.invoke('hullfall:set-vsync', on !== false),
    /** Ponowne uruchomienie aplikacji (nowe flagi startu). */
    relaunch: () => ipcRenderer.invoke('hullfall:relaunch')
  });
}
