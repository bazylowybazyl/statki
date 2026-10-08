@echo off
rem Dwuklik: podbija wersje gry i buduje instalator (dist-electron\HULLFALL-Setup-X.Y.Z.exe).
rem Szczegoly i opcje: scripts\wydanie.mjs
chcp 65001 >nul
cd /d "%~dp0"
node scripts\wydanie.mjs %*
echo.
pause
