@echo off
rem Dwuklik: buduje przenosny exe gry bez instalacji (dist-electron\HULLFALL-Portable-X.Y.Z.exe).
rem Pyta o wersje jak instalator; "t" = ta sama wersja (bez podbicia).
rem Szczegoly i opcje: scripts\wydanie.mjs
chcp 65001 >nul
cd /d "%~dp0"
node scripts\wydanie.mjs --portable %*
echo.
pause
