// src/ui/devTools.js — panel F12: kredyty, spawn jednostek, zerowanie zapisu.
//
// Odchudzony 2026-10-19 (decyzja użytkownika: „zostaw kredyty, spawn i zerowanie zapisu”). Wyleciały sekcje martwe
// (suwaki bez obsługi, przyciski paneli, których już nie ma), zdublowane (edytor hardpointów jest w menu głównym,
// Performance = PerfHUD pod P) i psujące świat (promienie i orbity planet zmieniane w trakcie gry). Suwaków renderu
// tu nie dokładaj: obraz rysuje worker renderu, a panel działałby na Core3D strony — strojenie idzie z konsoli
// (`*Tune`, `DevVFX.bloom`, `CameraRig.tune`).
// Lista jednostek = karty Rezerwy kokpitu (src/data/supportRoster.js), więc nowa karta trafia tu sama.

import { SUPPORT_FACTIONS } from '../data/supportRoster.js';

const STYLES = `
#devtools { position: fixed; right: 16px; top: 16px; width: 340px; max-height: 80vh; overflow: auto; padding: 14px; border-radius: 12px; background: rgba(10, 14, 25, .92); border: 1px solid #1b2337; color: #dfe7ff; z-index: 1000; font-family: Inter, system-ui, Segoe UI, Roboto, Arial; display: none }
#devtools h3 { margin: 0 0 8px 0; font-size: 16px; letter-spacing: .04em; text-transform: uppercase; color: #8fb5ff }
#devtools .group { margin: 12px 0; padding: 10px; background: #0b0f1a; border: 1px solid #1b2337; border-radius: 10px }
#devtools .row { display: flex; align-items: center; gap: 8px; margin: 6px 0 }
#devtools .dt-row { display: flex; align-items: center; gap: 6px; margin-top: 6px }
#devtools .small { opacity: .7; font-size: 12px }
#devtools .muted { color: #9fb0d8 }
#devtools .dt-btn { padding: 4px 8px; border: 1px solid #2a3a5a; border-radius: 8px; background: #0a1020; color: #dfe7ff; cursor: pointer; white-space: nowrap }
#devtools .dt-btn:hover { background: #18233c }
#devtools .dt-field { background: #060e1c; color: #fff; border: 1px solid #2a3a5a; padding: 4px; border-radius: 4px; min-width: 0 }
#devtools #dt-status { min-height: 1.3em; margin: 8px 0 4px }
`;

const HTML = `
<h3>DevTools</h3>
<div class="group">
  <div class="row"><strong>Kredyty</strong></div>
  <div class="dt-row">
    <input id="dt-add-credits-amount" class="dt-field" type="number" min="1" step="100" value="1000" style="flex:1; text-align:right;">
    <button id="dt-add-credits-btn" class="dt-btn">Dodaj CR</button>
  </div>
</div>
<div class="group">
  <div class="row"><strong>Floty</strong></div>
  <div class="dt-row">
    <button id="dt-spawn-pirate-fleet-btn" class="dt-btn" style="flex:1;">Flota piratów</button>
    <button id="dt-spawn-enemy-fighters-btn" class="dt-btn" style="flex:1;">Wrogie myśliwce</button>
  </div>
  <div class="dt-row">
    <button id="dt-spawn-support-fleet-btn" class="dt-btn" style="flex:1;">Flota wsparcia</button>
  </div>
  <div class="small muted">Przed dziobem gracza: ciężka flota piracka z warpa, 16 wrogich myśliwców albo wsparcie Terra Nova (lotniskowiec, pancernik, niszczyciel, fregata, myśliwce).</div>
</div>
<div class="group">
  <div class="row"><strong>Jednostki</strong></div>
  <div class="dt-row">
    <select id="dt-spawn-unit-type" class="dt-field" style="flex:1;"></select>
  </div>
  <div class="dt-row">
    <select id="dt-spawn-unit-side" class="dt-field" style="flex:1;">
      <option value="auto" selected>Strona: jak karta</option>
      <option value="friendly">Sojusznik</option>
      <option value="pirate">Pirat</option>
      <option value="dummy">Neutralny</option>
    </select>
    <input id="dt-spawn-unit-count" class="dt-field" type="number" min="1" max="20" value="1" style="width:56px;">
    <button id="dt-spawn-unit-btn" class="dt-btn">Spawn</button>
  </div>
  <div class="small muted">Karty Rezerwy kokpitu ze wszystkich frakcji (bez ?dev). Stają od razu przed dziobem, bez przylotu tunelem; holownik leci do Atlasa. Kadłuby cywilne są bez AI i broni — dryfują i słuchają rozkazów RTS.</div>
</div>
<div class="group">
  <div class="row"><strong>Zapis gry</strong> <span class="small muted">(localStorage)</span></div>
  <div class="row"><button id="dt-reset-save-btn" class="dt-btn" style="width:100%;">Wyzeruj zapis i przeładuj</button></div>
  <div class="small muted" id="dt-reset-save-status">To samo co index.html?reset — kasuje układ gniazd z edytora, fit i ustawienia.</div>
</div>
<div class="small muted" id="dt-status"></div>
<div class="small muted">F12 — pokaż / ukryj panel</div>
`;

// Karty, które w szeregu potrzebują więcej miejsca (lotniskowce, supercapitale, Atlas, megafrachtowiec).
const BIG_ICONS = new Set(['carrier', 'supercapital']);
const SIDE_LABELS = Object.freeze({ friendly: 'sojusznik', pirate: 'pirat', dummy: 'neutralny' });

export function initDevTools() {
  if (document.getElementById('devtools')) return;
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);
  const container = document.createElement('div');
  container.id = 'devtools';
  container.innerHTML = HTML;
  document.body.appendChild(container);

  const q = (id) => container.querySelector(`#${id}`);
  const statusEl = q('dt-status');
  const status = (text) => {
    if (statusEl) statusEl.textContent = text;
    console.info(`[DevTools] ${text}`);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F12') return;
    e.preventDefault();
    container.style.display = container.style.display === 'block' ? 'none' : 'block';
  });
  // Pola panelu nie oddają klawiszy grze (jej skróty słuchają na window): wpisanie „1000” w kwotę przełączało
  // grupę broni (1) i trzy razy silniki (0). keyup przechodzi — puszczenie klawisza, którego gra nie dostała, nic
  // nie robi, a klawisz wciśnięty przed wejściem w pole puści się normalnie.
  container.addEventListener('keydown', (e) => {
    if (e.code === 'F12') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) e.stopPropagation();
  });
  // Przycisk po kliknięciu oddaje fokus — inaczej Spacja (pauza gry) i Enter klikałyby go jeszcze raz.
  container.addEventListener('click', (e) => { e.target.closest?.('button')?.blur(); });

  wireCredits(q, status);
  wireFleets(q, status);
  wireUnitSpawner(q, status);
  wireResetSave(q);
}

function wireCredits(q, status) {
  const amountEl = q('dt-add-credits-amount');
  q('dt-add-credits-btn')?.addEventListener('click', () => {
    const raw = Number(amountEl?.value);
    const amount = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
    if (amount <= 0) return;
    if (amountEl) amountEl.value = String(amount);
    const addCredits = window.DevEconomy?.addCredits;
    if (typeof addCredits !== 'function') {
      status('Brak DevEconomy.addCredits — gra jeszcze nie wstała.');
      return;
    }
    const next = Number(addCredits(amount));
    if (Number.isFinite(next)) status(`Dodano ${amount.toLocaleString('pl-PL')} CR — saldo ${Math.round(next).toLocaleString('pl-PL')} CR`);
  });
}

const NOT_IN_GAME = 'Spawn działa w grze — zamknij menu.';

// Spawn tylko w grze: w menu (przed startem i pod Esc) statek gracza już istnieje, ale jednostka trafiłaby do świata
// sprzed startu albo za zasłonę menu.
function inMainMenu() {
  const menu = document.getElementById('main-menu');
  return !!menu && !menu.classList.contains('hidden');
}

// Punkt `dist` przed dziobem gracza (null w menu i przed startem gry).
function pointAhead(dist) {
  const ship = window.ship;
  if (!ship?.pos || inMainMenu()) return null;
  const angle = Number(ship.angle) || 0;
  return {
    x: (Number(ship.pos.x) || 0) + Math.cos(angle) * dist,
    y: (Number(ship.pos.y) || 0) + Math.sin(angle) * dist,
    angle
  };
}

function shockwave(p, maxR, w, maxLife, color) {
  if (typeof window.spawnShockwave === 'function') window.spawnShockwave(p.x, p.y, { maxR, w, maxLife, color });
}

function wireFleets(q, status) {
  q('dt-spawn-pirate-fleet-btn')?.addEventListener('click', () => {
    const p = pointAhead(3500);
    if (!p || typeof window.spawnPirateHeavyFleet !== 'function') return status(NOT_IN_GAME);
    shockwave(p, 2000, 15, 1.5, 'rgba(255, 50, 50,');
    window.spawnPirateHeavyFleet({ x: p.x, y: p.y, r: 100 });
    status('Ciężka flota piratów wychodzi z warpa przed dziobem.');
  });

  q('dt-spawn-enemy-fighters-btn')?.addEventListener('click', () => {
    const p = pointAhead(3200);
    if (!p || typeof window.spawnPirateSquad !== 'function') return status(NOT_IN_GAME);
    const beacon = { x: p.x, y: p.y, r: 180 };
    shockwave(p, 1200, 10, 0.8, 'rgba(255, 80, 80,');
    window.spawnPirateSquad(beacon, 'interceptor', 8, 'attack', { radius: 260, speed: 0.42 });
    window.spawnPirateSquad(beacon, 'fighter', 8, 'attack', { radius: 320, speed: 0.38 });
    status('Wrogie eskadry: 8 przechwytujących + 8 myśliwców.');
  });

  q('dt-spawn-support-fleet-btn')?.addEventListener('click', () => {
    const p = pointAhead(2600);
    const spawnSupport = window.spawnSupportShip;
    const spawnCarrier = window.spawnFriendlyCarrier;
    if (!p || typeof spawnSupport !== 'function' || typeof spawnCarrier !== 'function') {
      return status(NOT_IN_GAME);
    }
    const spawnPos = { x: p.x, y: p.y };
    spawnCarrier({ pos: spawnPos });
    spawnSupport('battleship', { spawnPos, spawnOffset: { x: -280, y: -420 } });
    spawnSupport('destroyer', { spawnPos, spawnOffset: { x: -220, y: 260 } });
    spawnSupport('frigate_pd', { spawnPos, spawnOffset: { x: -360, y: 520 } });
    spawnSupport('fighter', { spawnPos, spawnOffset: { x: -480, y: 0 } });
    shockwave(p, 1400, 12, 1.0, 'rgba(120, 220, 255,');
    status('Flota wsparcia Terra Nova przybyła.');
  });
}

function wireUnitSpawner(q, status) {
  const typeEl = q('dt-spawn-unit-type');
  if (typeEl) {
    for (const [factionId, faction] of Object.entries(SUPPORT_FACTIONS)) {
      const group = document.createElement('optgroup');
      group.label = faction.label;
      for (const item of faction.roster) {
        const opt = document.createElement('option');
        opt.value = `${factionId}:${item.key}`;
        opt.textContent = `${item.name} — ${item.role}`;
        group.appendChild(opt);
      }
      typeEl.appendChild(group);
    }
  }

  q('dt-spawn-unit-btn')?.addEventListener('click', () => {
    const [factionId, key] = String(typeEl?.value || '').split(':');
    const faction = SUPPORT_FACTIONS[factionId];
    const item = faction?.roster.find((it) => it.key === key);
    if (!item) return;
    const side = q('dt-spawn-unit-side')?.value || 'auto';
    const mode = side === 'auto' ? faction.mode : side;
    const count = Math.max(1, Math.min(20, Math.round(Number(q('dt-spawn-unit-count')?.value) || 1)));
    const ship = window.ship;
    if (!ship?.pos || inMainMenu()) return status(NOT_IN_GAME);

    // Holownik serwisowy ma własną misję (naprawa rojem, transport do K-7): przylot do Atlasa, jeden naraz.
    if (key === 'service_tug') {
      const res = typeof window.callServiceTug === 'function' ? window.callServiceTug({ target: ship }) : null;
      if (!res) return status('Holownik: brak celu.');
      return status(res.existing ? 'Holownik już jest w drodze albo przy pracy.' : `Holownik leci do Atlasa (przylot za ${(Number(res.eta) || 0).toFixed(1).replace('.', ',')} s).`);
    }

    const spawnFn = window.spawnCallInShip;
    if (typeof spawnFn !== 'function') return status('Brak spawnCallInShip — gra jeszcze nie wstała.');
    // Szereg w poprzek kursu, przed dziobem gracza; jednostki dziobem do gracza.
    const big = BIG_ICONS.has(item.icon);
    const center = pointAhead(big ? 6000 : 3000);
    const spacing = big ? 2200 : 900;
    const px = -Math.sin(center.angle);
    const py = Math.cos(center.angle);
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) * 0.5) * spacing;
      const pos = { x: center.x + px * off, y: center.y + py * off };
      const result = spawnFn(key, { spawnPos: pos, pos, spawnAngle: center.angle + Math.PI, singleModule: false, mode });
      if (Array.isArray(result) ? result.length : result) spawned++;
    }
    status(`Spawn: ${count}× ${item.name} (${SIDE_LABELS[mode] || mode})${spawned < count ? ` — udane: ${spawned}` : ''}`);
  });
}

// Zerowanie zapisu wiąże się niezależnie od reszty: ma działać zwłaszcza wtedy, gdy gra wstała połamana. Kasowanie
// jest nieodwracalne, więc przycisk uzbraja się na pierwsze kliknięcie i rozbraja sam po 4 s. W Electronie to jedyna
// droga bez konsoli (?reset wymaga paska adresu).
function wireResetSave(q) {
  const btn = q('dt-reset-save-btn');
  const statusEl = q('dt-reset-save-status');
  if (!btn) return;
  const DISARM_MS = 4000;
  const idleLabel = btn.textContent;
  const idleHint = statusEl ? statusEl.textContent : '';
  let armedAt = 0;
  const disarm = () => {
    armedAt = 0;
    btn.textContent = idleLabel;
    btn.style.borderColor = '';
    btn.style.color = '';
    if (statusEl) statusEl.textContent = idleHint;
  };
  btn.addEventListener('click', () => {
    if (!armedAt || Date.now() - armedAt > DISARM_MS) {
      armedAt = Date.now();
      btn.textContent = 'Na pewno? Kliknij ponownie';
      btn.style.borderColor = '#b4452f';
      btn.style.color = '#ffb4a2';
      if (statusEl) statusEl.textContent = 'Fit, hardpointy z edytora i ustawienia znikną bezpowrotnie.';
      setTimeout(disarm, DISARM_MS);
      return;
    }
    // hardResetGameSave (skrypt w <head> index.html) zamyka zapisy na klucz, żeby beforeunload -> saveLoadout
    // nie odtworzył właśnie skasowanego fitu, i dopiero wtedy przeładowuje.
    if (typeof window.hardResetGameSave === 'function') {
      window.hardResetGameSave('all');
      return;
    }
    window.__SAVE_LOCKED = true;
    try { localStorage.clear(); } catch { }
    location.reload();
  });
}
