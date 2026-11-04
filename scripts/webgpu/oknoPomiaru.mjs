// Okno pomiaru z vsync (--okno 1 w narzędziach GPU gry): Chrome z widocznym oknem na cały ekran. Windows oznacza okno
// jako ZASŁONIĘTE, gdy ekran zgasł po bezczynności albo inne okno leży na wierzchu (zasłanianie okien Chrome:
// CalculateNativeWinOcclusion) — strona dostaje visibilityState 'hidden', rAF staje na stronie i w workerze renderu,
// a gra stoi na ekranie ładowania (startGame czeka na nextFrame; 2026-10-29 gpu-pas-gra, 2026-11-04 gpu-baza-gra:
// „faza shipyard nie ruszyła”). Headless tego nie ma (bez okna systemu). Pomocniki (wzór gpu-pas-gra.mjs):
//   OKNO_FLAGI         — flagi Chrome: zasłonięte okno nie traci klatek;
//   startEkran()       — ekran włączony do końca przebiegu (SetThreadExecutionState + ruch myszy o 0 px);
//   oknoNaEkran(port, W, H) — okno przeglądarki harnessu (port debugowania) na (0, 0, W, H) i nad innymi;
//   WIDOCZNOSC         — wyrażenie strony: { stan: visibilityState, rafNa1s } (licznik window.__rafRec, gdy jest).
import { spawn, execFile } from 'node:child_process';

export const OKNO_FLAGI = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion'];

export function psRun(cmd, timeoutMs = 30000) {
  return new Promise((ok) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { maxBuffer: 64 << 20, windowsHide: true, timeout: timeoutMs },
      (err, stdout) => ok(String(stdout || '')));
  });
}

export function startEkran() {
  const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class KeepScreen { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(int f); [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e); }'; [void][KeepScreen]::SetThreadExecutionState(-2147483645); [KeepScreen]::mouse_event(1, 0, 0, 0, [IntPtr]::Zero); 'ekran: ok'; while ($true) { Start-Sleep -Seconds 20; [void][KeepScreen]::SetThreadExecutionState(-2147483645) }`;
  let proc = null;
  try { proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true }); } catch (_) { proc = null; }
  return { stop() { try { proc && proc.kill(); } catch (_) {} } };
}

export async function oknoNaEkran(port, W, H) {
  if (!port) return 'brak portu debugowania';
  const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinPos { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'; $b = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1; if (-not $b) { 'brak procesu'; exit }; $h = [IntPtr](Get-Process -Id $b.ProcessId).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { 'brak okna'; exit }; [void][WinPos]::ShowWindow($h, 9); [void][WinPos]::SetWindowPos($h, [IntPtr](-1), 0, 0, ${W}, ${H}, 0x0040); $r = New-Object WinPos+RECT; [void][WinPos]::GetWindowRect($h, [ref]$r); "okno $($r.L),$($r.T),$($r.R),$($r.B) widoczne=$([WinPos]::IsWindowVisible($h)) pierwszy_plan=$([WinPos]::GetForegroundWindow() -eq $h)"`;
  return (await psRun(ps)).trim();
}

/** Port debugowania z adresu WebSocket CDP (ws://127.0.0.1:<port>/devtools/…). */
export function portDebugowania(cdp) {
  try { return Number(/:(\d+)\//.exec(cdp.ws.url)[1]); } catch (_) { return null; }
}

export const WIDOCZNOSC = `new Promise((ok) => { const R = window.__rafRec, n0 = R ? R.n : 0;
  setTimeout(() => ok({ stan: document.visibilityState, rafNa1s: R ? R.n - n0 : null }), 1000); })`;
