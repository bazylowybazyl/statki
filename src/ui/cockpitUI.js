import { drawCicHudRadarSurface } from './cicDisplay.js';
import cockpitCssUrl from '../../assets/css/cockpit-ui.css?url';
import terranFrigateSprite from '../assets/ships/terranfrigate.png';
import terranDestroyerSprite from '../assets/ships/terrandestroyer.png';
import terranBattleshipSprite from '../assets/ships/terranbattleship.png';
import terranCarrierSprite from '../assets/ships/terrancarrier.png';
import terranSupercapitalSprite from '../assets/ships/terransupercapital.png';
import pirateFrigateSprite from '../assets/ships/piratefrigate.png';
import pirateDestroyerSprite from '../assets/ships/piratedestroyer.png';
import pirateBattleshipSprite from '../assets/ships/piratebattleship.png';
import atlasSprite from '../../assets/capital_ship_rect_v1.png';
import megafreighterSprite from '../../assets/megafreighter.png';
import { CAPITAL_SHIP_TEMPLATES, SUPPORT_SHIP_TEMPLATES } from '../data/ships.js';
import { DRIVE_RPM_MAX, TRAVEL_SHIFT_RPM } from '../game/flight/driveTransmission.js';
import {
  formatLocalDistance,
  formatNavigationDistance,
  formatVelocity,
  getVelocityDisplay
} from '../config/units.js';

// HUD „jeden klaster + kontekst” (makieta: dema/hud-koncept.html).
// Warstwy: stałe (klaster, paski broni/umiejętności, komunikaty, kontrolki),
// kontekstowe (karta celu, skrzydło, wyniki skanu — same się pokazują),
// na żądanie (Alt przełącza tryb interfejsu: rezerwa, overview, panel centralny;
// CapsLock = łączność, J = misje, Tab = CIC).

const RADAR_RANGES = Object.freeze([5000, 10000, 20000, 40000, 60000]);
const MODE_ORDER = Object.freeze(['combat', 'maneuver', 'travel']);
const MODE_META = Object.freeze({
  combat: { label: 'BOJOWY', gear: 'B', angle: -48, uiMode: 'combat' },
  maneuver: { label: 'MANEWROWY', gear: 'M', angle: 0, uiMode: 'agility' },
  travel: { label: 'PODRÓŻ', gear: 'P', angle: 48, uiMode: 'travel' }
});

const STATION_TABS = Object.freeze([
  { id: 'hangar', label: 'HANGAR' },
  { id: 'trade', label: 'HANDEL' },
  { id: 'cantina', label: 'KANTYNA' },
  { id: 'mechanic', label: 'MECHANIK' },
  { id: 'infrastructure', label: 'INFRASTRUKTURA' }
]);

// Rezerwa: Terra Nova to na razie zastępstwo docelowej rezerwy gracza (jednostki
// zbudowane we własnej bazie). Piraci, Niezależni i tryb LINIE to spawner testowy — tylko z ?dev.
const SUPPORT_FACTIONS = Object.freeze({
  terran: {
    label: 'Terra Nova', dataFaction: 'terra-nova', mode: 'friendly',
    roster: [
      { key: 'frigate_pd', name: 'Custos', role: 'Fregata PD', count: '×50', icon: 'frigate' },
      { key: 'destroyer', name: 'Hasta', role: 'Niszczyciel', count: '×5', icon: 'destroyer' },
      { key: 'battleship', name: 'Bellator', role: 'Pancernik', count: '×5', icon: 'battleship' },
      { key: 'carrier', name: 'Citadella', role: 'Lotniskowiec', count: '×1', icon: 'carrier' },
      { key: 'supercapital', name: 'Colossus', role: 'Supercapital', count: '×1', icon: 'supercapital' },
      { key: 'fighter', name: 'Fighter Wing', role: 'Skrzydło myśliwców', count: '×200', icon: 'fighter', click: true }
    ]
  },
  pirate: {
    label: 'Piraci', dataFaction: 'pirates', mode: 'pirate', devOnly: true,
    roster: [
      { key: 'frigate_pd', name: 'Pirate Frigate', role: 'Fregata rajderska', count: '×50', icon: 'frigate' },
      { key: 'destroyer', name: 'Pirate Destroyer', role: 'Niszczyciel rajderski', count: '×5', icon: 'destroyer' },
      { key: 'pirate_battleship', name: 'Pirate Battleship', role: 'Pancernik rajderski', count: '×1', icon: 'battleship' }
    ]
  },
  independent: {
    label: 'Niezależni', dataFaction: 'independent', mode: 'dummy', devOnly: true,
    roster: [
      { key: 'atlas', name: 'Atlas', role: 'Niezależny supercapital', count: '×1', icon: 'supercapital' },
      { key: 'megafreighter', name: 'Megafreighter', role: 'Jednostka użytkowa', count: '×1', icon: 'carrier' }
    ]
  }
});
const SUPPORT_ORDER_LABELS = Object.freeze({ guard: 'ESKORTA', engage: 'ATAK', hold: 'STÓJ' });

// Pasek broni: te same klawisze 1–6 co dotąd; stan z buildWeaponHudState() w index.html.
const WEAPON_SLOTS = Object.freeze([
  { key: '1', type: 'main', label: 'GŁÓWNA', icon: '◆', code: 'Digit1' },
  { key: '2', type: 'special', label: 'SPECJAL', icon: '✦', code: 'Digit2' },
  { key: '3', type: 'missile', label: 'RAKIETY', icon: '➤', code: 'Digit3' },
  { key: '4', type: 'builtin', label: 'WBUDOWANA', icon: '⌁', code: 'Digit4' },
  { key: '5', type: 'special_missile', label: 'SPEC. RAK.', icon: '◇', code: 'Digit5' },
  { key: '6', label: 'ENERGY', icon: 'ϟ', action: 'energy', title: 'Energy Shot [6] — +50% tarczy' }
]);
const ABILITY_SLOTS = Object.freeze([
  { key: 'X', id: 'scan', label: 'SKAN', icon: '◎', code: 'KeyX', title: 'Aktywny skan — impuls [X]' },
  { key: 'F', id: 'salvo', label: 'SALWA', icon: '➶', code: 'KeyF', title: 'Salwa rakiet w stronę kursora [F]' },
  { key: 'Z', id: 'hangar', label: 'MYŚLIWCE', icon: '▲', code: 'KeyZ', title: 'Start / powrót myśliwców [Z]' },
  { key: 'R', id: 'repair', label: 'NAPRAWA', icon: '✚', code: 'KeyR', title: 'Naprawa kadłuba — wł./wył. [R]' }
]);
// Kontrolki jak w aucie: świecą tylko włączone systemy.
const TELLTALES = Object.freeze([
  { id: 'auto', label: 'AUTO', color: '#8fd0ff', title: 'Skrzynia automatyczna [7]' },
  { id: 'stab', label: 'STAB', color: '#60e8ff', title: 'Stabilizator kursu [B]' },
  { id: 'damp', label: 'DAMP', color: '#b58cff', title: 'Tłumik grawitacyjny [C]' },
  { id: 'boost', label: 'BOOST', color: '#ffb347', title: 'Dopalacz / boost po zmianie biegu' },
  { id: 'warp', label: 'WARP', color: '#6fd3ff', title: 'Napęd warp [9]' }
]);
const ALERT_TONES = Object.freeze({
  status: 'info', info: 'info', orbit: 'info',
  good: 'good', ok: 'good', reward: 'good',
  warn: 'warn', warning: 'warn',
  bad: 'bad', danger: 'bad', alert: 'bad'
});

// Okno zmiany biegu z tej samej tabeli, którą ocenia shiftDriveUp().
const RPM_WINDOW = Object.freeze({
  cue: TRAVEL_SHIFT_RPM.cueStart / DRIVE_RPM_MAX,
  perfectStart: TRAVEL_SHIFT_RPM.greenFull / DRIVE_RPM_MAX,
  perfectEnd: TRAVEL_SHIFT_RPM.redBlendStart / DRIVE_RPM_MAX,
  late: TRAVEL_SHIFT_RPM.late / DRIVE_RPM_MAX
});

// Klaster w jednostkach projektowych (pole 340×340, skalowane przez --s).
// Kąty "zegarowe": 0 = godz. 12, rosną zgodnie ze wskazówkami.
// Góra = przetrwanie (kadłub ↖, tarcza ↗ — spływają od góry), dół = napęd (prędkość ↙, obroty ↘).
const CLUSTER = Object.freeze({ box: 340, center: 170, ring: 150, radar: 118 });
const CLUSTER_ARCS = Object.freeze({
  hull: Object.freeze({ anchor: 275, span: 75, reverse: false }),
  shield: Object.freeze({ anchor: 85, span: 75, reverse: true }),
  speed: Object.freeze({ anchor: 190, span: 73, reverse: false }),
  rpm: Object.freeze({ anchor: 170, span: 73, reverse: true })
});
const VITAL_STYLE = Object.freeze({
  hull: Object.freeze({ color: '#ff2d36', track: 'rgba(255, 45, 54, 0.13)', ghost: 'rgba(255, 190, 190, 0.5)' }),
  shield: Object.freeze({ color: '#2f7dff', track: 'rgba(47, 125, 255, 0.14)', ghost: 'rgba(190, 210, 255, 0.5)' })
});
const DRIVE_GLOW = Object.freeze({ normal: '#ff6600', cue: '#38e08a', danger: '#ff3a2a', warp: '#4fb8ff' });
const READY_FLASH = Object.freeze([
  { boxShadow: '0 0 0 1px #ff6600, 0 0 18px rgba(255, 102, 0, 0.65)' },
  { boxShadow: '0 0 0 1px rgba(255, 102, 0, 0), 0 0 0 rgba(255, 102, 0, 0)' }
]);
const READY_FLASH_TIMING = Object.freeze({ duration: 550, easing: 'ease-out' });
const SCAN_RESULTS_MS = 10000;
const MODE_PANEL_MS = 2200;
const FEED_LIVE = 4;
const FEED_HISTORY = 16;
const FEED_LIFE_MS = 16000;
const TAU = Math.PI * 2;

const SUPPORT_SPRITES = Object.freeze({
  terran: Object.freeze({
    fighter: terranFrigateSprite,
    frigate_pd: terranFrigateSprite,
    destroyer: terranDestroyerSprite,
    battleship: terranBattleshipSprite,
    carrier: terranCarrierSprite,
    supercapital: terranSupercapitalSprite
  }),
  pirate: Object.freeze({
    frigate_pd: pirateFrigateSprite,
    destroyer: pirateDestroyerSprite,
    pirate_battleship: pirateBattleshipSprite
  }),
  independent: Object.freeze({
    atlas: atlasSprite,
    megafreighter: megafreighterSprite
  })
});

const SUPPORT_CLASS_META = Object.freeze({
  fighter: { label: 'Fighter', code: 'FF', hardpoints: 2 },
  frigate_pd: { label: 'Frigate', code: 'F', hardpoints: 2 },
  destroyer: { label: 'Destroyer', code: 'D', hardpoints: 2 },
  battleship: { label: 'Battleship', code: 'B', hardpoints: 2 },
  pirate_battleship: { label: 'Battleship', code: 'B', hardpoints: 2 },
  carrier: { label: 'Carrier', code: 'CV', hardpoints: 4 },
  supercapital: { label: 'Supercapital', code: 'SC', hardpoints: 8 },
  atlas: { label: 'Supercapital', code: 'SC', hardpoints: 8 },
  megafreighter: { label: 'Megafreighter', code: 'MF', hardpoints: 0 }
});

function perfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function isDevMode() {
  try {
    return new URLSearchParams(window.location.search).has('dev');
  } catch {
    return false;
  }
}

function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}

function getEntityPosition(entity) {
  return {
    x: Number(entity?.pos?.x ?? entity?.worldX ?? entity?.x) || 0,
    y: Number(entity?.pos?.y ?? entity?.worldY ?? entity?.y) || 0
  };
}

function getEntityLabel(entity, fallback = 'Kontakt') {
  const value = entity?.displayName || entity?.label || entity?.name || entity?.squadronName || entity?.id || entity?.type;
  return String(value || fallback);
}

function isEntityGone(entity) {
  return !entity || entity.dead || entity.destroyed || entity._destroyed3D;
}

function getSupportDetails(item) {
  const supportTemplate = SUPPORT_SHIP_TEMPLATES[item.key] || null;
  const capitalTemplate = CAPITAL_SHIP_TEMPLATES[item.key] || null;
  const template = capitalTemplate || supportTemplate || {};
  const classMeta = SUPPORT_CLASS_META[item.key] || { label: item.role, code: '—', hardpoints: 0 };
  const hardpointDef = capitalTemplate?.hardpoints;
  const hardpoints = hardpointDef
    ? Object.values(hardpointDef).reduce((sum, value) => sum + (Number(value) || 0), 0)
    : classMeta.hardpoints;
  return {
    classLabel: classMeta.label,
    classCode: classMeta.code,
    hardpoints,
    hp: Number(capitalTemplate?.hull ?? supportTemplate?.stats?.hp) || 0,
    shield: Number(capitalTemplate?.shield ?? supportTemplate?.shield?.max) || 0,
    speed: Number(template?.maxSpeed ?? template?.stats?.maxSpeed) || 0,
    mass: Number(template?.mass ?? template?.stats?.mass) || 0
  };
}

// Sprite dla karty celu / skrzydła — najlepsze dopasowanie po typie kadłuba.
function spriteForEntity(entity) {
  const type = String(entity?.type || entity?.templateKey || '').toLowerCase();
  const faction = String(entity?.faction || '').toLowerCase();
  const pirate = !!entity?.isPirate || faction.includes('pira');
  if (type.includes('megafreighter')) return megafreighterSprite;
  if (type.includes('supercap') || type.includes('capital') || type.includes('atlas')) return pirate ? pirateBattleshipSprite : terranSupercapitalSprite;
  if (type.includes('carrier')) return pirate ? pirateBattleshipSprite : terranCarrierSprite;
  if (type.includes('battleship')) return pirate ? pirateBattleshipSprite : terranBattleshipSprite;
  if (type.includes('destroyer')) return pirate ? pirateDestroyerSprite : terranDestroyerSprite;
  if (type.includes('frigate') || type.includes('fighter') || type.includes('interceptor') || type.includes('corvette')) {
    return pirate ? pirateFrigateSprite : terranFrigateSprite;
  }
  return null;
}

function shortWeaponName(name, fallback) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return (first.length >= 3 ? first : fallback).toUpperCase();
}

function formatInt(value) {
  return Math.round(Number(value) || 0).toLocaleString('pl-PL');
}

// Polska odmiana: 1 węzeł, 2–4 węzły, 5+ węzłów (12–14 też "węzłów").
function plural(count, one, few, many) {
  const n = Math.abs(Math.trunc(Number(count) || 0));
  if (n === 1) return one;
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}

function countLabel(count, one, few, many) {
  return `${count} ${plural(count, one, few, many)}`;
}

const clockRad = deg => (deg - 90) * Math.PI / 180;

function arcPath(ctx, cx, cy, radius, fromDeg, toDeg) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, clockRad(fromDeg), clockRad(toDeg), false);
}

function arcPoint(arc, fraction) {
  return arc.reverse ? arc.anchor - arc.span * fraction : arc.anchor + arc.span * fraction;
}

function arcSegment(arc, fraction) {
  const end = arcPoint(arc, fraction);
  return arc.reverse ? [end, arc.anchor] : [arc.anchor, end];
}

function createVitalMotion() {
  return { ready: false, shown: 1, ghost: 1, target: 1, hold: 0, hit: 0 };
}

// Pełne i spokojne łuki przygasają; poniżej 25% pulsują.
function vitalAlpha(motion, calm, now) {
  let alpha = motion.target > 0.985 ? 1 - 0.55 * calm : 1;
  if (motion.target < 0.25) alpha *= 0.6 + 0.4 * Math.abs(Math.sin(now * 0.0044));
  return alpha;
}

// Poświata bez shadowBlur (rozmycie gaussowskie co klatkę jest drogie):
// dwa szersze, półprzezroczyste pociągnięcia pod właściwym łukiem.
function strokeGlowArc(ctx, fromDeg, toDeg, width, style, alpha, glow = 1) {
  const center = CLUSTER.center;
  arcPath(ctx, center, center, CLUSTER.ring, fromDeg, toDeg);
  ctx.strokeStyle = style;
  if (glow > 0) {
    ctx.globalAlpha = alpha * 0.16 * glow;
    ctx.lineWidth = width + 12;
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.32 * glow;
    ctx.lineWidth = width + 5;
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawVitalArc(ctx, arc, motion, style, alpha) {
  ctx.save();
  ctx.lineCap = 'round';
  if (motion.ghost > motion.shown + 0.002) {
    const [from, to] = arcSegment(arc, motion.ghost);
    arcPath(ctx, CLUSTER.center, CLUSTER.center, CLUSTER.ring, from, to);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 11;
    ctx.strokeStyle = style.ghost;
    ctx.stroke();
  }
  if (motion.shown > 0.002) {
    const [from, to] = arcSegment(arc, motion.shown);
    strokeGlowArc(ctx, from, to, 11, style.color, alpha, 1 + motion.hit * 2);
    if (motion.hit > 0) {
      ctx.globalAlpha = alpha * Math.min(1, motion.hit * 2.4);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      arcPath(ctx, CLUSTER.center, CLUSTER.center, CLUSTER.ring, from, to);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function cockpitMarkup(devMode) {
  const devControls = devMode ? `
            <div class="faction-tabs" id="supportFactions">
              <button type="button" class="faction-tab active" data-faction="terra-nova" data-key="terran">TERRA NOVA</button>
              <button type="button" class="faction-tab" data-faction="pirates" data-key="pirate">PIRACI</button>
              <button type="button" class="faction-tab" data-faction="independent" data-key="independent">NIEZALEŻNI</button>
              <button type="button" class="faction-tab line-tab" id="lineModeBtn" title="Masowy spawn: wybierz typ, przeciągnij LPM po mapie">LINIE</button>
            </div>
            <div class="line-bar" id="lineBar">
              <label class="line-width-label" for="lineWidth">SZER.</label>
              <input class="line-width-slider" type="range" id="lineWidth" min="25" max="100" step="5" value="100" title="Mniejsza szerokość = gęściej statki w linii">
              <span class="line-width-value" id="lineWidthValue">100%</span>
              <span class="line-hint" id="lineHint">Wybierz typ jednostki</span>
            </div>` : '';
  return `
    <link rel="stylesheet" href="${cockpitCssUrl}">
    <div class="app" id="app" data-mode="combat">
      <div class="pointer-veil"></div>
      <div class="deploy-banner">WEKTOR ROZMIESZCZENIA — UPUŚĆ NA MAPĘ LUB RADAR, ABY ROZPOCZĄĆ WARP</div>
      <div class="pointer-banner">ALT · TRYB INTERFEJSU — wolna mysz, panele klikalne</div>

      <div class="safe-area">
        <section class="feed" id="feed">
          <div class="feed-zone"><i></i><span id="feedZone">Przestrzeń międzyplanetarna</span></div>
          <div class="feed-lines" id="feedLines"></div>
        </section>

        <div class="hud-col left" id="leftCol">
          <section class="hud-panel on-demand comm-panel" id="commPanel" hidden>
            <header class="panel-head"><div class="panel-title"><strong>Łączność</strong><small>UPLINK / STACJE</small></div><span class="comm-net" id="commNet">SKAN SIECI…</span></header>
            <div class="comm-body" id="commBody"></div>
            <footer class="comm-foot"><span>CAPS / ESC — zamknij</span><button type="button" class="term-btn" id="commClose">Rozłącz</button></footer>
          </section>
          <section class="hud-panel context wing-panel" id="wingPanel" hidden>
            <header class="panel-head"><div class="panel-title"><strong>Skrzydło</strong><small id="activeCount">0 JEDN.</small></div><span class="wing-order" id="wingOrder">ESKORTA</span></header>
            <div class="unit-list" id="unitList"></div>
            <footer class="panel-orders pointer-only" id="supportOrders">
              <button class="tech-button active" type="button" data-order="guard">ESKORTA</button>
              <button class="tech-button" type="button" data-order="engage">ATAK</button>
              <button class="tech-button" type="button" data-order="hold">STÓJ</button>
            </footer>
            <div class="panel-hint no-pointer"><kbd>Alt</kbd> rozkazy skrzydła</div>
          </section>
          <section class="hud-panel pointer-only reserve-panel" id="reservePanel">
            <header class="panel-head"><div class="panel-title"><strong>Rezerwa</strong><small id="reserveFaction">TERRA NOVA</small></div><span class="panel-count" id="reserveCount">${devMode ? 'DEV' : 'GOTOWOŚĆ'}</span></header>${devControls}
            <div class="reserve-grid" id="reserveGrid"></div>
            <div class="panel-hint">Przeciągnij kartę na mapę lub radar.</div>
          </section>
        </div>

        <div class="hud-col right" id="rightCol">
          <section class="hud-panel context target-panel" id="targetPanel" hidden><div id="targetBody"></div></section>
          <div class="lock-chips" id="lockChips"></div>
          <section class="hud-panel context scan-panel" id="scanPanel" hidden>
            <header class="panel-head"><div class="panel-title"><strong>Skan</strong><small id="scanCount">0 KONTAKTÓW</small></div><span class="panel-count">X</span></header>
            <div class="scan-timer" id="scanTimer"></div>
            <div class="contact-rows" id="scanRows"></div>
            <div class="panel-hint"><kbd>Alt</kbd> pełna lista · <kbd>Tab</kbd> CIC</div>
          </section>
          <section class="hud-panel pointer-only overview-panel" id="overviewPanel">
            <header class="panel-head"><div class="panel-title"><strong>Overview</strong><small>KONTAKTY PASYWNE + AKTYWNE</small></div><span class="panel-count" id="contactCount">0 KONTAKTÓW</span></header>
            <div class="scanner-filters" id="scannerFilters">
              <button type="button" class="filter-button active" data-filter="all">WSZYSTKO</button>
              <button type="button" class="filter-button" data-filter="hostile">WRÓG</button>
              <button type="button" class="filter-button" data-filter="friendly">SOJUSZ</button>
              <button type="button" class="filter-button" data-filter="station">STACJE</button>
              <button type="button" class="filter-button" data-filter="asteroid">ZASOBY</button>
            </div>
            <div class="contact-rows" id="contactRows"></div>
          </section>
        </div>

        <div class="key-hints">
          <span><kbd>Tab</kbd>CIC / flota</span>
          <span><kbd>Caps</kbd>Łączność</span>
          <span><kbd>J</kbd>Misje</span>
          <span><kbd>Alt</kbd>Panele</span>
        </div>
      </div>

      <section class="hud-bottom" id="hudBottom">
        <div class="slot-bar weapons" id="weaponBar"></div>
        <div class="cluster" id="cluster">
          <div class="alert-line" id="alertLine"></div>
          <div class="telltales" id="telltales"></div>
          <canvas id="clusterCanvas" aria-hidden="true"></canvas>
          <canvas id="radarCanvas" class="hud-radar-canvas" aria-label="Radar"></canvas>
          <div class="vital-readout hp" id="roHp"><small>KADŁUB</small><b id="vitalHpValue">0</b></div>
          <div class="vital-readout shield" id="roShield"><small>TARCZA</small><b id="vitalShieldValue">0</b></div>
          <button type="button" class="radar-top" id="radarTop" title="Zasięg radaru — kliknij lub kółko myszy nad radarem"><span class="hostile" id="rdHostile">CZYSTO</span><span id="rdRange">20K</span></button>
          <div class="drive-readout speed"><small>PRĘDKOŚĆ</small><span class="drive-value"><b id="spValue">0</b><span class="drive-unit" id="spSpeedUnit">M/S</span></span></div>
          <div class="drive-readout rpm"><small>OBROTY</small><span class="drive-value"><b id="spRpm">0</b><span class="drive-unit">RPM</span></span><span class="gear-readout" id="spGearWrap" hidden>BIEG <b id="spGear">1/1</b></span></div>
          <span class="mode-badge" id="spMode" title="Tryb napędu — V zmienia">B</span>
        </div>
        <div class="slot-bar abilities" id="abilityBar"></div>
        <section class="cockpit-module mode-panel" id="modePanel">
          <span class="module-label">PANEL CENTRALNY / TRYB</span>
          <div class="infotainment-screen"><div class="screen-content" id="modeTrack"><div class="menu-item active" data-mode="combat">BOJOWY</div><div class="menu-item" data-mode="maneuver">MANEWROWY</div><div class="menu-item" data-mode="travel">PODRÓŻ</div></div><div class="selection-indicator"></div></div>
          <div class="controls-area">
            <div class="btn-group"><button type="button" class="physical-btn" id="pbComm" title="[CapsLock]"><span>Łączność</span><div class="led-indicator blue"></div></button><button type="button" class="physical-btn" id="pbMissions" title="[J]"><span>Misje</span><div class="led-indicator orange"></div></button></div>
            <div class="center-console"><button type="button" class="shortcut-btn pos-t" id="scScan" title="[X]">Skan</button><button type="button" class="shortcut-btn pos-b" id="scLock" title="Namierz / zwolnij cel">Cel</button><button type="button" class="shortcut-btn pos-l" id="scAuto" title="[7]">Auto</button><button type="button" class="shortcut-btn pos-r" id="scStab" title="[B]">Stab</button><div class="rotary-knob" id="rotaryKnob" title="Przeciągnij lub użyj kółka; V zmienia tryb"><div class="knob-indicator"></div><div class="knob-touchpad"><div class="knob-center-logo">///</div></div></div></div>
            <div class="btn-group"><button type="button" class="physical-btn" id="pbShip"><span>Statek</span><div class="led-indicator green"></div></button><button type="button" class="physical-btn" id="pbMap" title="[Tab / M]"><span>CIC</span><div class="led-indicator red"></div></button></div>
          </div>
        </section>
      </section>

      <section class="station-tablet" id="stationTablet" aria-hidden="true">
        <div class="tablet-frame">
          <header class="tablet-head"><div class="tablet-id"><span class="tl-label" id="tabletLabel">Terminal stacji / usługi dokowe</span><strong id="tabletTitle">—</strong><small id="tabletSub">BRAK POŁĄCZENIA</small></div><div class="tablet-link"><span class="link-dot"></span><span id="tabletLinkText">ŁĄCZE AKTYWNE</span></div><button type="button" class="physical-btn tablet-close active" id="tabletClose"><span>Zamknij</span><div class="led-indicator red"></div></button></header>
          <nav class="tablet-tabsbar" id="stationTabsBar"><button type="button" class="tab-arrow" id="tabPrev" title="Poprzednia zakładka">‹</button><div class="tablet-tabs" id="tabletTabs"><div class="screen-content" id="tabletTabTrack"></div><div class="selection-indicator"></div></div><button type="button" class="tab-arrow" id="tabNext" title="Następna zakładka">›</button></nav>
          <div class="tablet-screen" id="tabletScreen"><div class="screen-glare"></div><div class="tablet-pane active" id="stationPane"><slot name="station-panel"></slot></div><div class="mission-layout" id="missionPane" hidden><aside class="mission-sidebar"><div class="mission-filters" id="missionFilters"><button type="button" class="mission-filter active" data-filter="active">AKTYWNE</button><button type="button" class="mission-filter" data-filter="completed">UKOŃCZONE</button><button type="button" class="mission-filter" data-filter="all">WSZYSTKIE</button></div><div class="mission-list" id="missionList"></div></aside><section class="mission-detail" id="missionDetail"><div class="mission-empty">Wybierz wpis z dziennika misji.</div></section></div></div>
          <footer class="tablet-foot"><span id="tabletFootLeft">KREDYTY <b id="tabletCredits">0 CR</b></span><span id="tabletFootCenter">TERMINAL GOTOWY</span><span id="tabletFootRight">ŁADOWNIA <b id="tabletCargo">0 / 0</b></span></footer>
        </div>
      </section>
      <div class="support-tooltip" id="supportTooltip" hidden></div><div class="drag-ghost" id="dragGhost"></div><div class="deployment-reticle" id="deployReticle"></div>
    </div>`;
}

export class CockpitUI {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.els = {};
    this.startedAt = perfNow();
    this.viewRange = 20000;
    this.radarModel = null;
    this.contactFilter = 'all';
    this.selectedContact = null;
    this.supportFaction = 'terran';
    this.missionFilter = 'active';
    this.selectedMissionId = null;
    this.missionOpen = false;
    this.commOpen = false;
    this.commBootUntil = 0;
    this.commDirectory = [];
    this.drag = null;
    this.pendingDrag = null;
    this.supportTooltipTimer = null;
    // Tryb LINIE — masowy spawn wzdluz przeciaganej linii. Sama mechanika
    // (drag po canvasie, podglad, spawn) siedzi w index.html jako window.LineSpawn;
    // tutaj trzymamy tylko stan przyciskow i zaznaczenie karty.
    this.lineMode = false;
    this.lineKey = null;
    this.logs = [];
    this.cache = Object.create(null);
    this.lastRadarDraw = 0;
    this.lastListRefresh = 0;
    this.lastUpdateAt = 0;
    this.lastRingFlightSync = 0;
    this.lastStationOpen = false;
    this.lastStationTab = 'hangar';
    this.devMode = isDevMode();
    // Alt = przełącznik trybu interfejsu (wolna mysz + panele na żądanie).
    this.pointerMode = false;
    this.altArmed = false;
    this.scale = 1;
    this.vitals = { hull: createVitalMotion(), shield: createVitalMotion() };
    this.calmTime = 0;
    this.drive = { speed: 0, limit: 1, rpm: 0, tone: 0, shiftWindow: false, warp: false };
    this.clusterValues = new Float64Array(14);
    this.clusterPrev = new Int32Array(14).fill(-1 << 30);
    this.clusterForce = true;
    this.clusterStatic = null;
    this.gradients = null;
    this.target = null;
    this.lockedTargets = [];
    this.targetEntity = null;
    this.targetSignature = '';
    this.targetRefs = null;
    this.scanSerial = null;
    this.scanUntil = 0;
    this.modePanelUntil = 0;
    this.ringFlightAvailable = null;
    this.slots = [];
    this.telltaleEls = [];
    this.lastAlertText = '';
    this.lastAlertAt = 0;
  }

  init() {
    if (this.host) return this;
    let host = document.getElementById('cockpit-ui-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'cockpit-ui-host';
      document.body.appendChild(host);
    }
    this.host = host;
    this.shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = cockpitMarkup(this.devMode);
    this.cacheElements();
    this.mountStationContent();
    this.retireLegacyHud();
    this.buildSlots();
    this.buildTelltales();
    this.renderSupportRoster();
    this.bindControls();
    this.bindPointerModeKey();
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    this.log('Inicjalizacja systemów kokpitu — OK', 'ok');
    this.log('Alt przełącza tryb interfejsu. CapsLock otwiera łączność ze stacjami.', 'orbit');
    window.CockpitUI = this;
    window.cockpitUI = this;
    return this;
  }

  cacheElements() {
    const ids = [
      'app', 'feed', 'feedZone', 'feedLines', 'leftCol', 'rightCol', 'commPanel', 'commNet', 'commBody', 'commClose',
      'wingPanel', 'activeCount', 'wingOrder', 'unitList', 'supportOrders', 'reservePanel', 'reserveFaction', 'reserveCount',
      'supportFactions', 'lineModeBtn', 'lineBar', 'lineWidth', 'lineWidthValue', 'lineHint', 'reserveGrid',
      'targetPanel', 'targetBody', 'lockChips', 'scanPanel', 'scanCount', 'scanTimer', 'scanRows', 'overviewPanel',
      'contactCount', 'scannerFilters', 'contactRows', 'hudBottom', 'weaponBar', 'abilityBar', 'cluster', 'alertLine',
      'telltales', 'clusterCanvas', 'radarCanvas', 'roHp', 'roShield', 'vitalHpValue', 'vitalShieldValue', 'radarTop',
      'rdHostile', 'rdRange', 'spMode', 'spValue', 'spSpeedUnit', 'spRpm', 'spGearWrap', 'spGear', 'modePanel', 'modeTrack',
      'pbComm', 'pbMissions', 'pbShip', 'pbMap', 'scScan', 'scLock', 'scAuto', 'scStab', 'rotaryKnob',
      'stationTablet', 'tabletLabel', 'tabletTitle', 'tabletSub', 'tabletLinkText', 'tabletClose', 'stationTabsBar',
      'tabletTabs', 'tabletTabTrack', 'tabPrev', 'tabNext', 'stationPane', 'missionPane', 'missionFilters', 'missionList',
      'missionDetail', 'tabletCredits', 'tabletCargo', 'tabletFootLeft', 'tabletFootCenter', 'tabletFootRight',
      'supportTooltip', 'dragGhost', 'deployReticle'
    ];
    for (const id of ids) this.els[id] = this.shadow.getElementById(id);
    this.radarCtx = this.els.radarCanvas?.getContext('2d') || null;
    this.clusterCtx = this.els.clusterCanvas?.getContext('2d') || null;
  }

  mountStationContent() {
    const stationHost = document.getElementById('hud-top-container');
    if (!stationHost) return;
    stationHost.slot = 'station-panel';
    stationHost.classList.add('cockpit-station-slot');
    this.host.appendChild(stationHost);
  }

  retireLegacyHud() {
    for (const id of ['side-panels-container', 'right-panels-container', 'hud-bottom-container', 'hud-topbar', 'ui', 'hover-info']) {
      document.getElementById(id)?.remove();
    }
  }

  applyScale() {
    if (!this.host) return;
    const width = window.innerWidth || 1920;
    const height = window.innerHeight || 1080;
    // Skala od wysokości (1080p = 1), ale dolny rząd (broń + klaster + umiejętności
    // + ściąga klawiszy) nie może wyjść poza szerokość ekranu.
    this.scale = clamp(Math.min(height / 1080, width / 1380), 0.66, 1.6);
    this.host.style.setProperty('--s', this.scale.toFixed(4));
    this.clusterForce = true;
    this.lastRadarDraw = 0;
  }

  bindControls() {
    this.els.supportFactions?.addEventListener('click', event => {
      const button = event.target.closest('[data-key]');
      if (!button) return;
      this.setSupportFaction(button.dataset.key);
    });
    this.els.supportOrders?.addEventListener('click', event => {
      const button = event.target.closest('[data-order]');
      if (!button) return;
      this.setSupportOrder(button.dataset.order);
    });
    this.els.lineModeBtn?.addEventListener('click', () => this.toggleLineMode());
    this.els.lineWidth?.addEventListener('input', () => {
      const applied = window.LineSpawn?.setWidth?.(this.els.lineWidth.value);
      if (Number.isFinite(applied)) this.els.lineWidth.value = String(applied);
      this.updateLineHint();
    });
    this.els.scannerFilters?.addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      this.contactFilter = button.dataset.filter || 'all';
      for (const item of this.els.scannerFilters.querySelectorAll('[data-filter]')) {
        item.classList.toggle('active', item === button);
      }
      this.renderContacts(true);
    });
    this.els.contactRows?.addEventListener('click', event => {
      const row = event.target.closest('[data-contact-index]');
      if (!row) return;
      const contacts = this.getOverviewContacts();
      const contact = contacts[Number(row.dataset.contactIndex)] || null;
      if (contact) this.selectContact(contact);
    });
    this.els.targetBody?.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'lock') this.lockCurrentTarget();
      if (action === 'uplink') this.openCommForStation(this.targetEntity);
    });

    this.els.pbComm?.addEventListener('click', () => this.toggleComm());
    this.els.commClose?.addEventListener('click', () => this.closeComm());
    this.els.commBody?.addEventListener('click', event => {
      const connect = event.target.closest('[data-connect]');
      const service = event.target.closest('[data-service]');
      if (connect) this.connectStationById(connect.dataset.connect);
      if (service) this.openStationService(service.dataset.service);
    });

    this.els.pbMissions?.addEventListener('click', () => this.toggleMissionJournal());
    this.els.pbShip?.addEventListener('click', () => this.launchRingCityFlight());
    this.els.pbMap?.addEventListener('click', () => this.dispatchGameKey('KeyM', 'm'));
    this.els.scScan?.addEventListener('click', () => this.dispatchGameKey('KeyX', 'x'));
    this.els.scLock?.addEventListener('click', () => this.lockCurrentTarget());
    this.els.scAuto?.addEventListener('click', () => window.shipDriveControls?.toggleAuto?.());
    this.els.scStab?.addEventListener('click', () => this.dispatchGameKey('KeyB', 'b'));
    this.els.modeTrack?.addEventListener('click', event => {
      const mode = event.target.closest('[data-mode]')?.dataset.mode;
      if (mode) this.setDriveMode(mode);
    });
    this.bindKnob();

    this.els.radarTop?.addEventListener('click', () => this.cycleRadarRange(1, true));
    this.els.radarCanvas?.addEventListener('click', event => this.selectRadarContact(event));
    this.els.radarCanvas?.addEventListener('wheel', event => {
      event.preventDefault();
      this.cycleRadarRange(event.deltaY > 0 ? 1 : -1, false);
    }, { passive: false });

    this.els.tabletClose?.addEventListener('click', () => this.closeTablet());
    this.els.tabletTabTrack?.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]')?.dataset.tab;
      if (tab) this.selectStationTab(tab);
    });
    this.els.tabletTabs?.addEventListener('wheel', event => {
      event.preventDefault();
      this.stepStationTab(event.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    this.els.tabPrev?.addEventListener('click', () => this.stepStationTab(-1));
    this.els.tabNext?.addEventListener('click', () => this.stepStationTab(1));
    this.els.missionFilters?.addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      this.missionFilter = button.dataset.filter || 'active';
      for (const item of this.els.missionFilters.querySelectorAll('[data-filter]')) {
        item.classList.toggle('active', item === button);
      }
      this.renderMissionJournal();
    });
    this.els.missionList?.addEventListener('click', event => {
      const card = event.target.closest('[data-mission-id]');
      if (!card) return;
      this.selectedMissionId = card.dataset.missionId;
      this.renderMissionJournal();
    });

    window.addEventListener('pointermove', event => this.updateSupportDrag(event), { passive: true });
    window.addEventListener('pointerup', event => this.finishSupportDrag(event), true);
    window.addEventListener('pointercancel', () => this.cancelSupportDrag(), true);
  }

  // Alt przełącza tryb tylko "czystym" tapnięciem lewego Alta: Alt+Tab, Alt+F4
  // i AltGr (polskie znaki = ControlLeft + AltRight) nie ruszają trybu.
  bindPointerModeKey() {
    window.addEventListener('keydown', event => {
      if (event.code === 'AltLeft') {
        event.preventDefault();
        if (!event.repeat) this.altArmed = !isTypingTarget(event.target) && !event.ctrlKey;
        return;
      }
      if (event.altKey || event.code === 'AltRight') this.altArmed = false;
    }, true);
    window.addEventListener('keyup', event => {
      if (event.code !== 'AltLeft') return;
      event.preventDefault();
      const armed = this.altArmed;
      this.altArmed = false;
      if (armed && !this.host?.hidden) this.setPointerMode(!this.pointerMode);
    }, true);
    window.addEventListener('pointerdown', () => { this.altArmed = false; }, true);
    window.addEventListener('blur', () => { this.altArmed = false; });
  }

  setPointerMode(enabled) {
    const next = !!enabled;
    if (this.pointerMode === next) return;
    this.pointerMode = next;
    this.els.app?.classList.toggle('pointer', next);
    if (!next) {
      this.cancelSupportDrag();
      this.hideSupportTooltip();
    }
    this.renderFeed();
    this.renderContacts(true);
    this.renderScanList(perfNow());
  }

  bindKnob() {
    const knob = this.els.rotaryKnob;
    if (!knob) return;
    let dragging = false;
    let centerX = 0;
    let centerY = 0;
    const applyPointer = event => {
      const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI + 90;
      const normalized = clamp(angle, -48, 48);
      knob.style.transform = `rotate(${normalized}deg)`;
      const mode = normalized < -16 ? 'combat' : normalized > 16 ? 'travel' : 'maneuver';
      this.setDriveMode(mode);
    };
    knob.addEventListener('pointerdown', event => {
      const rect = knob.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      dragging = true;
      knob.setPointerCapture?.(event.pointerId);
      applyPointer(event);
    });
    knob.addEventListener('pointermove', event => { if (dragging) applyPointer(event); });
    const release = event => {
      if (!dragging) return;
      dragging = false;
      knob.releasePointerCapture?.(event.pointerId);
      this.syncDriveMode(true);
    };
    knob.addEventListener('pointerup', release);
    knob.addEventListener('pointercancel', release);
    knob.addEventListener('wheel', event => {
      event.preventDefault();
      const state = window.shipDriveControls?.getState?.() || {};
      const modes = state.availableModes?.length ? state.availableModes : MODE_ORDER;
      const current = state.mode || modes[0];
      const index = Math.max(0, modes.indexOf(current));
      const next = clamp(index + (event.deltaY > 0 ? 1 : -1), 0, modes.length - 1);
      this.setDriveMode(modes[next]);
    }, { passive: false });
  }

  buildSlots() {
    const make = (definition, root, kind) => {
      if (!root) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      button.title = definition.title || `${definition.label} [${definition.key}]`;
      button.innerHTML = '<span class="slot-led"></span><span class="slot-key"></span><span class="slot-auto">AUTO</span><span class="slot-icon"></span><span class="slot-name"></span><span class="slot-mask"></span>';
      button.querySelector('.slot-key').textContent = definition.key;
      button.querySelector('.slot-icon').textContent = definition.icon;
      const name = button.querySelector('.slot-name');
      name.textContent = definition.label;
      button.addEventListener('click', () => this.useSlot(definition));
      root.appendChild(button);
      this.slots.push({ definition, kind, button, name, mask: button.querySelector('.slot-mask'), state: Object.create(null) });
    };
    for (const definition of WEAPON_SLOTS) make(definition, this.els.weaponBar, 'weapon');
    for (const definition of ABILITY_SLOTS) make(definition, this.els.abilityBar, 'ability');
  }

  useSlot(definition) {
    if (definition.action === 'energy') window.triggerEnergyShot?.();
    else if (definition.code) this.dispatchGameKey(definition.code, definition.key.toLowerCase());
  }

  setSlotState(slot, key, value, apply) {
    if (slot.state[key] === value) return;
    slot.state[key] = value;
    apply(value);
  }

  updateSlots(environment, now) {
    const weaponHud = environment.weaponHud || null;
    const hangar = environment.hangar || null;
    for (const slot of this.slots) {
      const definition = slot.definition;
      let empty = false;
      let charge = 1;
      let auto = false;
      let on = false;
      let label = definition.label;
      let title = definition.title || `${definition.label} [${definition.key}]`;
      if (slot.kind === 'weapon' && definition.type) {
        const state = weaponHud?.[definition.type];
        const weapon = state?.weapon || null;
        empty = !!weaponHud && !weapon;
        charge = clamp(state?.charge ?? 1, 0, 1);
        // Dla broni "enabled" = auto-fire (poza wbudowaną, gdzie to gotowość).
        // Wyłączony auto-fire to NIE jest "niedostępna" — slot zostaje klikalny.
        auto = !!weapon && definition.type !== 'builtin' && !!state?.enabled;
        if (weapon?.name) {
          label = shortWeaponName(weapon.name, definition.label);
          title = `${definition.label} [${definition.key}] — ${weapon.name}${auto ? ' · auto-fire' : ''}`;
        }
      } else if (definition.id === 'repair') {
        on = !!environment.repairActive;
      } else if (definition.id === 'hangar') {
        empty = !!hangar && !(Number(hangar.mounted) > 0);
        on = Number(hangar?.out) > 0;
      } else if (definition.id === 'scan') {
        on = now < this.scanUntil;
      }
      const cooling = !empty && charge < 0.995;
      this.setSlotState(slot, 'empty', empty, value => slot.button.classList.toggle('empty', value));
      this.setSlotState(slot, 'auto', auto, value => slot.button.classList.toggle('auto', value));
      this.setSlotState(slot, 'on', on, value => slot.button.classList.toggle('on', value));
      this.setSlotState(slot, 'cool', cooling, value => slot.button.classList.toggle('cool', value));
      this.setSlotState(slot, 'mask', cooling ? Math.round((1 - charge) * 100) : 0, value => { slot.mask.style.height = `${value}%`; });
      this.setSlotState(slot, 'label', label, value => { slot.name.textContent = value; });
      this.setSlotState(slot, 'title', title, value => { slot.button.title = value; });
      if (slot.state.wasCooling && !cooling && !empty) slot.button.animate?.(READY_FLASH, READY_FLASH_TIMING);
      slot.state.wasCooling = cooling;
    }
  }

  buildTelltales() {
    const root = this.els.telltales;
    if (!root) return;
    for (const definition of TELLTALES) {
      const element = document.createElement('span');
      element.className = 'telltale';
      element.style.setProperty('--c', definition.color);
      element.title = definition.title;
      element.textContent = definition.label;
      root.appendChild(element);
      this.telltaleEls.push({ definition, element, on: null, blink: null });
    }
  }

  updateTelltales(systems, environment) {
    const warpState = String(systems.warpState || 'idle');
    for (const item of this.telltaleEls) {
      let on = false;
      let blink = false;
      switch (item.definition.id) {
        case 'auto': on = !!systems.driveAuto; break;
        case 'stab': on = !!window.flightAssist?.stabilizer; break;
        case 'damp': on = !!window.flightAssist?.damper; break;
        case 'boost': on = !!environment.boostActive || !!systems.driveShiftBoost; break;
        case 'warp': on = warpState === 'active' || warpState === 'charging'; blink = warpState === 'charging'; break;
        default: break;
      }
      if (item.on !== on) { item.on = on; item.element.classList.toggle('on', on); }
      if (item.blink !== blink) { item.blink = blink; item.element.classList.toggle('blink', blink); }
    }
  }

  cycleRadarRange(direction, wrap) {
    const index = Math.max(0, RADAR_RANGES.indexOf(this.viewRange));
    let next = index + direction;
    if (wrap) next = (next + RADAR_RANGES.length) % RADAR_RANGES.length;
    this.setRadarRange(RADAR_RANGES[clamp(next, 0, RADAR_RANGES.length - 1)]);
  }

  setRadarRange(range) {
    if (!RADAR_RANGES.includes(range)) return;
    this.viewRange = range;
    if (this.els.rdRange) this.els.rdRange.textContent = `${range / 1000}K`;
    this.lastRadarDraw = 0;
  }

  getRadarRange() {
    return this.viewRange;
  }

  setDriveMode(mode) {
    const normalized = MODE_META[mode] ? mode : 'combat';
    window.shipDriveControls?.setMode?.(normalized);
    this.syncDriveMode(true);
  }

  syncDriveMode(force = false) {
    const state = window.shipDriveControls?.getState?.() || {};
    const mode = MODE_META[state.mode] ? state.mode : 'combat';
    const availableModes = state.availableModes?.length ? state.availableModes : MODE_ORDER;
    const modeCacheKey = `${mode}:${availableModes.join(',')}`;
    if (!force && this.cache.driveModeKey === modeCacheKey) return;
    const previousMode = this.cache.driveMode;
    this.cache.driveModeKey = modeCacheKey;
    this.cache.driveMode = mode;
    // Zmiana trybu (V, pokrętło, auto) wysuwa PANEL CENTRALNY na chwilę.
    if (previousMode && previousMode !== mode) this.modePanelUntil = perfNow() + MODE_PANEL_MS;
    const meta = MODE_META[mode];
    this.els.app.dataset.mode = meta.uiMode;
    if (this.els.rotaryKnob) this.els.rotaryKnob.style.transform = `rotate(${meta.angle}deg)`;
    for (const item of this.els.modeTrack?.querySelectorAll('[data-mode]') || []) {
      item.hidden = !availableModes.includes(item.dataset.mode);
      item.classList.toggle('active', item.dataset.mode === mode);
    }
    if (this.els.scAuto) this.els.scAuto.hidden = !availableModes.includes('travel');
    if (this.els.spMode) this.els.spMode.textContent = meta.gear;
    requestAnimationFrame(() => this.centerModeTrack());
  }

  // Aktywny tryb ląduje nad wskaźnikiem ekranu (jak przesuwne menu infotainment).
  centerModeTrack() {
    const track = this.els.modeTrack;
    const active = track?.querySelector('.menu-item.active');
    if (!track || !active || !track.offsetWidth) return;
    const offset = track.offsetWidth / 2 - (active.offsetLeft + active.offsetWidth / 2);
    track.style.transform = `translateX(${Math.round(offset)}px)`;
  }

  syncModePanel(now) {
    const show = this.pointerMode || now < this.modePanelUntil;
    if (this.cache.modePanelShow === show) return;
    this.cache.modePanelShow = show;
    this.els.modePanel?.classList.toggle('show', show);
    if (show) requestAnimationFrame(() => this.centerModeTrack());
  }

  // "Pokazuj zmianę, nie stan": w podróży bez wrogów pasek broni przygasa.
  syncCalmState(systems) {
    const hostile = Number(this.radarModel?.counts?.hostile) || 0;
    const calm = systems.driveMode === 'travel' && hostile === 0;
    this.toggleCached('appCalm', this.els.app, 'calm', calm);
  }

  dispatchGameKey(code, key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    requestAnimationFrame(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })));
  }

  update(ship, systems = {}, environment = {}) {
    if (!this.host) return;
    const now = perfNow();
    const dt = this.lastUpdateAt > 0 ? clamp((now - this.lastUpdateAt) / 1000, 0, 0.2) : 0;
    this.lastUpdateAt = now;
    const menuVisible = !document.getElementById('main-menu')?.classList.contains('hidden');
    if (this.cache.menuVisible !== menuVisible) {
      this.cache.menuVisible = menuVisible;
      this.host.toggleAttribute('hidden', menuVisible);
    }
    if (menuVisible) return;

    this.radarModel = environment.radar || this.radarModel;
    this.target = environment.target || null;
    this.lockedTargets = Array.isArray(environment.lockedTargets) ? environment.lockedTargets : [];
    this.updateScanSerial(environment.scanSerial, now);
    this.updateVitals(ship, dt);
    this.updateDrive(ship, systems);
    this.updateSlots(environment, now);
    this.updateTelltales(systems, environment);
    this.syncRingCityFlightButton();
    this.syncDriveMode();
    this.syncModePanel(now);
    this.syncCalmState(systems);
    this.updateLocation(environment.locationName);
    this.updateRadar(now);
    this.drawCluster(now);
    this.syncTablet();

    if (now - this.lastListRefresh > 350) {
      this.lastListRefresh = now;
      this.pruneFeed(now);
      this.renderActiveUnits();
      this.renderTarget();
      this.renderLockChips();
      this.renderContacts();
      this.renderScanList(now);
      if (this.missionOpen) this.renderMissionJournal();
      if (this.commOpen) this.renderComm();
    }
  }

  updateVitals(ship, dt) {
    const hullMax = Math.max(1, Number(ship?.hull?.max) || 1);
    const hullVal = Math.max(0, Number(ship?.hull?.val) || 0);
    const shieldMax = Math.max(1, Number(ship?.shield?.max) || 1);
    const shieldVal = Math.max(0, Number(ship?.shield?.val) || 0);
    this.calmTime += dt;
    this.stepVital(this.vitals.hull, hullVal / hullMax, dt);
    this.stepVital(this.vitals.shield, shieldVal / shieldMax, dt);
    const hull = this.vitals.hull;
    const shield = this.vitals.shield;
    // Liczby odświeżamy ~8×/s — płynną zmianę pokazuje łuk, a zapis tekstu co klatkę to layout co klatkę.
    const now = perfNow();
    if (now - (this.cache.vitalTextAt || 0) > 120) {
      this.cache.vitalTextAt = now;
      const hullText = formatInt(hull.shown * hullMax);
      const shieldText = formatInt(shield.shown * shieldMax);
      if (this.cache.hullText !== hullText) { this.cache.hullText = hullText; this.els.vitalHpValue.textContent = hullText; }
      if (this.cache.shieldText !== shieldText) { this.cache.shieldText = shieldText; this.els.vitalShieldValue.textContent = shieldText; }
    }
    const calm = this.calmTime > 3;
    this.toggleCached('roHpCalm', this.els.roHp, 'calm', calm && hull.target > 0.985);
    this.toggleCached('roShieldCalm', this.els.roShield, 'calm', calm && shield.target > 0.985);
    this.toggleCached('roHpCrit', this.els.roHp, 'crit', hull.target < 0.25);
    this.toggleCached('roShieldCrit', this.els.roShield, 'crit', shield.target < 0.25);
  }

  stepVital(motion, ratio, dt) {
    const target = clamp(ratio, 0, 1);
    if (!motion.ready) {
      motion.ready = true;
      motion.shown = motion.ghost = motion.target = target;
      return;
    }
    if (target < motion.target - 0.0005) {
      motion.hit = 0.32;
      motion.hold = 0.45;
      this.calmTime = 0;
    }
    motion.target = target;
    const blend = dt > 0 ? 1 - Math.exp(-(target < motion.shown ? 15 : 7) * dt) : 1;
    motion.shown += (target - motion.shown) * blend;
    if (Math.abs(target - motion.shown) < 0.0005) motion.shown = target;
    motion.hold = Math.max(0, motion.hold - dt);
    if (target >= motion.ghost) motion.ghost = target;
    else if (motion.hold <= 0) motion.ghost = Math.max(target, motion.ghost - dt * 0.25);
    motion.hit = Math.max(0, motion.hit - dt);
  }

  toggleCached(key, element, className, value) {
    if (!element || this.cache[key] === value) return;
    this.cache[key] = value;
    element.classList.toggle(className, value);
  }

  updateDrive(ship, systems) {
    const speed = Math.hypot(Number(ship?.vel?.x) || 0, Number(ship?.vel?.y) || 0);
    const warpActive = systems.warpState === 'active';
    const now = perfNow();
    if (now - (this.cache.speedTextAt || 0) > 90) {
      this.cache.speedTextAt = now;
      const speedDisplay = getVelocityDisplay(speed, { warp: warpActive });
      const unit = String(speedDisplay.unit || '').toUpperCase();
      if (this.cache.speedValue !== speedDisplay.value) { this.cache.speedValue = speedDisplay.value; this.els.spValue.textContent = speedDisplay.value; }
      if (this.cache.speedUnit !== unit) { this.cache.speedUnit = unit; this.els.spSpeedUnit.textContent = unit; }
    }

    const limit = Number(systems.driveSpeedLimit) || 0;
    const modeMax = Math.max(1, Number(systems.driveModeMaxSpeed) || limit || speed || 1);
    const gear = Math.max(1, Number(systems.driveGear) || 1);
    const gearCount = Math.max(gear, Number(systems.driveGearCount) || 1);
    const shiftWindow = systems.driveMode === 'travel' && gear < gearCount && !warpActive;
    const cue = clamp(systems.driveShiftCueIntensity, 0, 1);
    const danger = clamp(systems.driveShiftCueDanger, 0, 1);
    const drive = this.drive;
    drive.speed = warpActive ? 1 : clamp(speed / modeMax, 0, 1);
    drive.limit = limit > 0 ? clamp(limit / modeMax, 0, 1) : 1;
    drive.rpm = clamp(systems.driveRpm, 0, 1);
    drive.tone = !shiftWindow ? 0 : danger > 0.35 ? 2 : cue > 0.35 ? 1 : 0;
    drive.shiftWindow = shiftWindow;
    drive.warp = warpActive;

    // Obroty liczbowo przy łuku obrotów; kolor = podpowiedź zmiany biegu (zielony / czerwony).
    if (this.cache.speedTextAt === now) {
      const rpmText = formatInt(Math.round(drive.rpm * DRIVE_RPM_MAX / 50) * 50);
      if (this.cache.rpmText !== rpmText) { this.cache.rpmText = rpmText; this.els.spRpm.textContent = rpmText; }
    }
    this.toggleCached('rpmCue', this.els.spRpm, 'cue', drive.tone === 1);
    this.toggleCached('rpmDanger', this.els.spRpm, 'danger', drive.tone === 2);

    const gearText = gearCount > 1 ? `${gear}/${gearCount}` : '';
    if (this.cache.gearText !== gearText) {
      this.cache.gearText = gearText;
      this.els.spGear.textContent = gearText;
      this.els.spGearWrap.hidden = !gearText;
    }
  }

  getGradients(ctx) {
    if (this.gradients) return this.gradients;
    const center = CLUSTER.center;
    const radius = CLUSTER.ring;
    const make = (bottom, top) => {
      const gradient = ctx.createLinearGradient(0, center + radius, 0, center - 10);
      gradient.addColorStop(0, bottom);
      gradient.addColorStop(1, top);
      return gradient;
    };
    this.gradients = {
      normal: make('#ff3300', '#ff8a1a'),
      cue: make('#1fbf6a', '#5dffa8'),
      danger: make('#ff2200', '#ff5a3a'),
      warp: make('#1c6cff', '#7fe3ff')
    };
    return this.gradients;
  }

  drawBand(ctx, arc, fromFraction, toFraction, color) {
    const a = arcPoint(arc, fromFraction);
    const b = arcPoint(arc, toFraction);
    arcPath(ctx, CLUSTER.center, CLUSTER.center, CLUSTER.ring + 9, Math.min(a, b), Math.max(a, b));
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // Warstwa statyczna klastra (podkładka, tory łuków, podziałka, podpisy):
  // rysowana raz na rozmiar płótna, potem tylko drawImage.
  buildClusterStatic(size) {
    const layer = this.clusterStatic || (this.clusterStatic = document.createElement('canvas'));
    layer.width = size;
    layer.height = size;
    const ctx = layer.getContext('2d');
    const scale = size / CLUSTER.box;
    const center = CLUSTER.center;
    const radius = CLUSTER.ring;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, CLUSTER.box, CLUSTER.box);
    ctx.beginPath();
    ctx.arc(center, center, radius + 14, 0, TAU);
    ctx.arc(center, center, CLUSTER.radar + 1, 0, TAU, true);
    ctx.fillStyle = 'rgba(3, 5, 8, 0.64)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(center, center, radius + 14, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.lineCap = 'round';
    for (const [arc, width, color] of [
      [CLUSTER_ARCS.hull, 11, VITAL_STYLE.hull.track],
      [CLUSTER_ARCS.shield, 11, VITAL_STYLE.shield.track],
      [CLUSTER_ARCS.speed, 7, 'rgba(255, 255, 255, 0.08)'],
      [CLUSTER_ARCS.rpm, 7, 'rgba(255, 255, 255, 0.08)']
    ]) {
      const [from, to] = arcSegment(arc, 1);
      arcPath(ctx, center, center, radius, from, to);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    for (const [arc, ticks] of [[CLUSTER_ARCS.speed, 6], [CLUSTER_ARCS.rpm, 8]]) {
      for (let index = 0; index <= ticks; index += 1) {
        const angle = clockRad(arcPoint(arc, index / ticks));
        const major = index % 2 === 0;
        const inner = radius - (major ? 18 : 14);
        const outer = radius - 9;
        ctx.lineWidth = major ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
        ctx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
        ctx.stroke();
      }
    }
  }

  // Łuk napędu w stylu modułu PRĘDKOŚĆ: żar gradientu i biała kropka na końcu.
  drawDriveArc(ctx, arc, value, options) {
    const center = CLUSTER.center;
    const radius = CLUSTER.ring;
    ctx.save();
    if (options.window) {
      // Okno zmiany biegu: jasna zieleń = PERFECT, blada = BOOST, czerwień = ZA PÓŹNO.
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      const perfect = value >= RPM_WINDOW.perfectStart && value <= RPM_WINDOW.perfectEnd;
      const good = value >= RPM_WINDOW.cue && value <= RPM_WINDOW.late;
      this.drawBand(ctx, arc, RPM_WINDOW.cue, RPM_WINDOW.late, good ? 'rgba(56, 224, 138, 0.55)' : 'rgba(56, 224, 138, 0.22)');
      this.drawBand(ctx, arc, RPM_WINDOW.perfectStart, RPM_WINDOW.perfectEnd, perfect ? '#5dffa8' : 'rgba(56, 224, 138, 0.5)');
      this.drawBand(ctx, arc, RPM_WINDOW.late, 1, value > RPM_WINDOW.late ? 'rgba(255, 64, 64, 0.95)' : 'rgba(255, 64, 64, 0.28)');
    }
    if (value > 0.003) {
      const tone = options.warp ? 'warp' : options.tone === 1 ? 'cue' : options.tone === 2 ? 'danger' : 'normal';
      const [from, to] = arcSegment(arc, value);
      ctx.lineCap = 'round';
      strokeGlowArc(ctx, from, to, 7, this.getGradients(ctx)[tone], 1);
      const tip = clockRad(arcPoint(arc, value));
      const tipX = center + Math.cos(tip) * radius;
      const tipY = center + Math.sin(tip) * radius;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = DRIVE_GLOW[tone];
      ctx.beginPath();
      ctx.arc(tipX, tipY, 8.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(tipX, tipY, 4.6, 0, TAU);
      ctx.fill();
    }
    if (options.notch != null) {
      const angle = clockRad(arcPoint(arc, options.notch));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(center + Math.cos(angle) * (radius + 5), center + Math.sin(angle) * (radius + 5));
      ctx.lineTo(center + Math.cos(angle) * (radius + 13), center + Math.sin(angle) * (radius + 13));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCluster(now) {
    const canvas = this.els.clusterCanvas;
    const ctx = this.clusterCtx;
    if (!canvas || !ctx) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const size = Math.max(1, Math.round(CLUSTER.box * this.scale * dpr));
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
      this.buildClusterStatic(size);
      this.clusterForce = true;
    }
    const hull = this.vitals.hull;
    const shield = this.vitals.shield;
    const drive = this.drive;
    const calm = clamp((this.calmTime - 2) / 2, 0, 1);
    const hullAlpha = vitalAlpha(hull, calm, now);
    const shieldAlpha = vitalAlpha(shield, calm, now);
    // Rysujemy tylko przy zmianie — bez alokacji klucza co klatkę.
    const values = this.clusterValues;
    values[0] = hull.shown; values[1] = hull.ghost; values[2] = hull.hit; values[3] = hullAlpha;
    values[4] = shield.shown; values[5] = shield.ghost; values[6] = shield.hit; values[7] = shieldAlpha;
    values[8] = drive.speed; values[9] = drive.limit; values[10] = drive.rpm; values[11] = drive.tone;
    values[12] = drive.shiftWindow ? 1 : 0; values[13] = drive.warp ? 1 : 0;
    let changed = this.clusterForce;
    const previous = this.clusterPrev;
    for (let index = 0; index < values.length; index += 1) {
      const quantized = Math.round(values[index] * 400);
      if (quantized !== previous[index]) {
        previous[index] = quantized;
        changed = true;
      }
    }
    if (!changed) return;
    this.clusterForce = false;

    const scale = size / CLUSTER.box;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (!this.clusterStatic || this.clusterStatic.width !== size) this.buildClusterStatic(size);
    ctx.drawImage(this.clusterStatic, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawVitalArc(ctx, CLUSTER_ARCS.hull, hull, VITAL_STYLE.hull, hullAlpha);
    drawVitalArc(ctx, CLUSTER_ARCS.shield, shield, VITAL_STYLE.shield, shieldAlpha);
    this.drawDriveArc(ctx, CLUSTER_ARCS.speed, drive.speed, { notch: drive.limit < 0.995 ? drive.limit : null, warp: drive.warp });
    this.drawDriveArc(ctx, CLUSTER_ARCS.rpm, drive.rpm, { window: drive.shiftWindow, tone: drive.tone });
  }

  updateLocation(locationName) {
    const location = String(locationName || 'Przestrzeń międzyplanetarna');
    if (this.cache.location === location || !this.els.feedZone) return;
    this.cache.location = location;
    this.els.feedZone.textContent = location;
  }

  updateRadar(now) {
    const drawIntervalMs = this.viewRange >= 60000 ? 100 : this.viewRange >= 40000 ? 80 : 66;
    if (!this.radarCtx || !this.els.radarCanvas || now - this.lastRadarDraw < drawIntervalMs) return;
    this.lastRadarDraw = now;
    const canvas = this.els.radarCanvas;
    // Rozmiar z tej samej skali co CSS (średnica radaru = 2 × 118 × --s) — bez
    // getBoundingClientRect w pętli, który po zapisach DOM wymuszał layout.
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(CLUSTER.radar * 2 * this.scale * dpr));
    const height = width;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    drawCicHudRadarSurface(this.radarCtx, width, height, this.radarModel, { range: this.viewRange });
    const hostile = Number(this.radarModel?.counts?.hostile) || 0;
    const hostileText = hostile > 0 ? `WRÓG ${hostile}` : 'CZYSTO';
    if (this.cache.rdHostile !== hostileText && this.els.rdHostile) {
      this.cache.rdHostile = hostileText;
      this.els.rdHostile.textContent = hostileText;
      this.els.rdHostile.classList.toggle('clear', hostile === 0);
    }
    const rangeText = `${this.viewRange / 1000}K`;
    if (this.cache.rdRange !== rangeText && this.els.rdRange) {
      this.cache.rdRange = rangeText;
      this.els.rdRange.textContent = rangeText;
    }
  }

  updateScanSerial(serial, now) {
    const value = Number(serial) || 0;
    if (this.scanSerial === null) {
      this.scanSerial = value;
      return;
    }
    if (value === this.scanSerial) return;
    this.scanSerial = value;
    this.scanUntil = now + SCAN_RESULTS_MS;
    this.cache.scanKey = '';
    this.els.scanTimer?.getAnimations?.().forEach(animation => animation.cancel());
    this.els.scanTimer?.animate?.([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: SCAN_RESULTS_MS, fill: 'forwards' });
    this.renderScanList(now);
  }

  getOverviewContacts() {
    const base = Array.isArray(this.radarModel?.contacts) ? this.radarModel.contacts.map(contact => ({
      entity: contact.entity || null,
      type: contact.isAsteroid ? 'asteroid' : contact.friendly ? 'friendly' : 'hostile',
      label: getEntityLabel(contact.entity, contact.type || 'Kontakt'),
      distance: Math.hypot(Number(contact.dx) || 0, Number(contact.dy) || 0),
      locked: !!contact.locked,
      raw: contact
    })) : [];
    const ship = window.ship;
    if (ship?.pos && Array.isArray(window.stations)) {
      for (const station of window.stations) {
        if (!station || station._destroyed3D) continue;
        const pos = getEntityPosition(station);
        const distance = Math.hypot(pos.x - ship.pos.x, pos.y - ship.pos.y);
        if (distance > this.viewRange * 3) continue;
        base.push({ entity: station, type: 'station', label: getEntityLabel(station, 'Stacja'), distance, locked: false, raw: null });
      }
    }
    base.sort((a, b) => a.distance - b.distance);
    return base;
  }

  buildContactRow(contact, index) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'contact-row';
    row.dataset.contactIndex = String(index);
    row.classList.toggle('selected', !!contact.entity && (this.targetEntity === contact.entity || this.selectedContact?.entity === contact.entity));
    const code = document.createElement('span');
    code.className = `tone-${contact.type}`;
    code.textContent = contact.type === 'hostile' ? 'WRG' : contact.type === 'friendly' ? 'SOJ' : contact.type === 'station' ? 'STA' : 'AST';
    const name = document.createElement('span');
    name.className = 'contact-name';
    name.textContent = contact.label;
    const distance = document.createElement('span');
    distance.className = 'dist-cell';
    distance.textContent = formatLocalDistance(contact.distance);
    const lock = document.createElement('span');
    lock.className = 'lock-cell';
    lock.textContent = contact.locked ? 'LCK' : '';
    row.append(code, name, distance, lock);
    return row;
  }

  renderContacts(force = false) {
    const root = this.els.contactRows;
    if (!root || (!this.pointerMode && !force)) return;
    const contacts = this.getOverviewContacts();
    const visible = contacts.filter(contact => this.contactFilter === 'all' || contact.type === this.contactFilter).slice(0, 40);
    const key = `${this.contactFilter}|${visible.map(c => `${c.type}:${c.label}:${Math.round(c.distance / 100)}:${c.locked ? 1 : 0}`).join('|')}`;
    if (!force && this.cache.contactsKey === key) return;
    this.cache.contactsKey = key;
    root.textContent = '';
    for (const contact of visible) root.appendChild(this.buildContactRow(contact, contacts.indexOf(contact)));
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'panel-empty';
      empty.textContent = 'Brak kontaktów w zasięgu.';
      root.appendChild(empty);
    }
    if (this.els.contactCount) this.els.contactCount.textContent = countLabel(contacts.length, 'KONTAKT', 'KONTAKTY', 'KONTAKTÓW');
  }

  // Wyniki skanu: pokazują się same po impulsie X i gasną po 10 s.
  renderScanList(now) {
    const panel = this.els.scanPanel;
    if (!panel) return;
    const visible = !this.pointerMode && now < this.scanUntil;
    if (panel.hidden === visible) panel.hidden = !visible;
    if (!visible) return;
    const contacts = this.getOverviewContacts();
    const rows = contacts.slice(0, 6);
    const key = `${contacts.length}|${rows.map(c => `${c.type}:${c.label}:${Math.round(c.distance / 100)}`).join('|')}`;
    if (this.cache.scanKey === key) return;
    this.cache.scanKey = key;
    this.els.scanCount.textContent = countLabel(contacts.length, 'KONTAKT', 'KONTAKTY', 'KONTAKTÓW');
    const root = this.els.scanRows;
    root.textContent = '';
    rows.forEach((contact, index) => root.appendChild(this.buildContactRow(contact, index)));
    if (contacts.length > rows.length) {
      const more = document.createElement('div');
      more.className = 'panel-empty';
      more.textContent = `+${contacts.length - rows.length} więcej`;
      root.appendChild(more);
    }
  }

  selectContact(contact) {
    this.selectedContact = contact;
    window.CockpitBridge?.selectTarget?.(contact.entity);
    this.renderContacts(true);
  }

  lockCurrentTarget() {
    const entity = this.target || this.selectedContact?.entity || null;
    if (entity) window.CockpitBridge?.toggleLock?.(entity);
    else this.pushAlert('Brak wybranego celu', { tone: 'warn', duration: 1.4 });
  }

  selectRadarContact(event) {
    const contacts = Array.isArray(this.radarModel?.contacts) ? this.radarModel.contacts : [];
    if (!contacts.length) return;
    const rect = this.els.radarCanvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    const ny = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
    // drawCicHudRadarSurface: zasięg = 0.475 szerokości płótna.
    const worldToUnit = 0.475 / this.viewRange;
    let best = null;
    let bestScore = 0.004;
    for (const raw of contacts) {
      const dx = (Number(raw.dx) || 0) * worldToUnit - nx;
      const dy = (Number(raw.dy) || 0) * worldToUnit - ny;
      const score = dx * dx + dy * dy;
      if (score < bestScore) { bestScore = score; best = raw; }
    }
    if (best) this.selectContact({ entity: best.entity, type: best.isAsteroid ? 'asteroid' : best.friendly ? 'friendly' : 'hostile', label: getEntityLabel(best.entity, best.type), distance: Math.hypot(best.dx || 0, best.dy || 0), locked: !!best.locked, raw: best });
  }

  describeTarget(target) {
    const bridged = window.CockpitBridge?.describeTarget?.(target);
    if (bridged) return bridged;
    const pos = getEntityPosition(target);
    const ship = window.ship;
    const station = Array.isArray(window.stations) && window.stations.includes(target);
    return {
      name: getEntityLabel(target),
      unitClass: station ? 'STACJA' : String(target?.type || 'KONTAKT').toUpperCase(),
      kind: station ? 'station' : target?.friendly ? 'friendly' : 'hostile',
      distance: ship?.pos ? Math.hypot(pos.x - ship.pos.x, pos.y - ship.pos.y) : 0,
      hp: Number(target?.hp ?? target?.hull?.val),
      hpMax: Number(target?.maxHp ?? target?.hull?.max) || 0,
      shield: Number(target?.shield?.val),
      shieldMax: Number(target?.shield?.max) || 0,
      locked: this.lockedTargets.includes(target)
    };
  }

  // Karta celu: tylko gdy gra ma wybrany lub namierzony cel.
  renderTarget() {
    const panel = this.els.targetPanel;
    if (!panel) return;
    const target = isEntityGone(this.target) ? null : this.target;
    if (!target) {
      if (this.targetEntity) {
        this.targetEntity = null;
        this.targetSignature = '';
        this.targetRefs = null;
        this.els.targetBody.textContent = '';
      }
      panel.hidden = true;
      return;
    }
    const info = this.describeTarget(target);
    const signature = `${info.kind}|${info.locked ? 1 : 0}|${info.name}|${info.unitClass}`;
    if (target !== this.targetEntity || signature !== this.targetSignature) {
      this.targetEntity = target;
      this.targetSignature = signature;
      this.buildTargetCard(target, info);
    }
    this.updateTargetLive(info);
    panel.hidden = false;
  }

  buildTargetCard(target, info) {
    const root = this.els.targetBody;
    root.textContent = '';
    const kind = info.kind || 'hostile';
    const head = document.createElement('header');
    head.className = 'panel-head';
    const title = document.createElement('div');
    title.className = 'panel-title';
    const strong = document.createElement('strong');
    strong.textContent = kind === 'station' ? 'Stacja' : kind === 'asteroid' ? 'Zasoby' : 'Cel';
    const small = document.createElement('small');
    small.textContent = info.locked ? 'NAMIERZONY' : 'WYBRANY';
    title.append(strong, small);
    head.appendChild(title);
    if (info.locked) {
      const badge = document.createElement('span');
      badge.className = 'lock-badge';
      badge.textContent = 'LCK';
      head.appendChild(badge);
    }

    const main = document.createElement('div');
    main.className = 'target-main';
    const portrait = document.createElement('div');
    portrait.className = `target-portrait tone-${kind}`;
    const sprite = kind === 'station' || kind === 'asteroid' ? null : spriteForEntity(target);
    if (sprite) {
      const image = document.createElement('img');
      image.src = sprite;
      image.alt = '';
      portrait.appendChild(image);
    } else {
      const glyph = document.createElement('span');
      glyph.className = 'target-glyph';
      glyph.textContent = kind === 'station' ? '⬢' : kind === 'asteroid' ? '◆' : '▲';
      portrait.appendChild(glyph);
    }
    const infoBox = document.createElement('div');
    infoBox.className = 'target-info';
    const name = document.createElement('div');
    name.className = 'target-name';
    name.textContent = info.name;
    const cls = document.createElement('div');
    cls.className = `target-class tone-${kind}`;
    const side = kind === 'hostile' ? 'WRÓG' : kind === 'friendly' ? 'SOJUSZNIK' : '';
    cls.textContent = [info.unitClass, side].filter(Boolean).join(' · ');
    const meta = document.createElement('div');
    meta.className = 'target-meta';
    infoBox.append(name, cls, meta);
    main.append(portrait, infoBox);
    root.append(head, main);

    const refs = { meta, hullFill: null, hullText: null, shieldFill: null, shieldText: null };
    const hasHull = Number.isFinite(info.hp) && info.hpMax > 0;
    const hasShield = Number.isFinite(info.shield) && info.shieldMax > 0;
    if (hasHull || hasShield) {
      const bars = document.createElement('div');
      bars.className = 'target-bars';
      const makeBar = (label, color) => {
        const row = document.createElement('div');
        row.className = 'target-bar';
        row.style.setProperty('--c', color);
        const caption = document.createElement('span');
        caption.textContent = label;
        const track = document.createElement('div');
        track.className = 'track';
        const fill = document.createElement('div');
        fill.className = 'fill';
        track.appendChild(fill);
        const value = document.createElement('b');
        row.append(caption, track, value);
        bars.appendChild(row);
        return { fill, value };
      };
      if (hasHull) { const bar = makeBar('KADŁUB', '#ff2d36'); refs.hullFill = bar.fill; refs.hullText = bar.value; }
      if (hasShield) { const bar = makeBar('TARCZA', '#2f7dff'); refs.shieldFill = bar.fill; refs.shieldText = bar.value; }
      root.appendChild(bars);
    }

    const actions = document.createElement('div');
    actions.className = 'target-actions pointer-only';
    if (kind !== 'station' && kind !== 'asteroid') {
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'tech-button';
      lock.dataset.action = 'lock';
      lock.textContent = info.locked ? 'ZWOLNIJ' : 'NAMIERZ';
      actions.appendChild(lock);
    }
    if (kind === 'station') {
      const uplink = document.createElement('button');
      uplink.type = 'button';
      uplink.className = 'tech-button';
      uplink.dataset.action = 'uplink';
      uplink.textContent = 'POŁĄCZ · UPLINK';
      actions.appendChild(uplink);
    }
    if (actions.children.length) root.appendChild(actions);
    const hint = document.createElement('div');
    hint.className = 'panel-hint no-pointer';
    hint.innerHTML = kind === 'station' ? '<kbd>Alt</kbd> uplink · <kbd>Caps</kbd> łączność' : '<kbd>Alt</kbd> akcje celu';
    root.appendChild(hint);
    this.targetRefs = refs;
  }

  updateTargetLive(info) {
    const refs = this.targetRefs;
    if (!refs) return;
    const meta = formatLocalDistance(info.distance);
    if (refs.meta.textContent !== meta) refs.meta.textContent = meta;
    const setBar = (fill, text, value, max) => {
      if (!fill || !text) return;
      const pct = Math.round(clamp(value / Math.max(1, max), 0, 1) * 100);
      const width = `${pct}%`;
      if (fill.style.width !== width) {
        fill.style.width = width;
        text.textContent = width;
      }
    };
    setBar(refs.hullFill, refs.hullText, info.hp, info.hpMax);
    setBar(refs.shieldFill, refs.shieldText, info.shield, info.shieldMax);
  }

  renderLockChips() {
    const root = this.els.lockChips;
    if (!root) return;
    const others = this.lockedTargets.filter(target => target && target !== this.targetEntity && !isEntityGone(target)).slice(0, 3);
    const described = others.map(target => this.describeTarget(target));
    const key = described.map(info => `${info.name}:${Math.round(info.distance / 100)}`).join('|');
    if (this.cache.lockKey === key) return;
    this.cache.lockKey = key;
    root.textContent = '';
    for (const info of described) {
      const chip = document.createElement('div');
      chip.className = 'lock-chip';
      chip.textContent = `LCK · ${info.name} · ${formatLocalDistance(info.distance)}`;
      root.appendChild(chip);
    }
  }

  setSupportFaction(faction) {
    let normalized = SUPPORT_FACTIONS[faction] ? faction : 'terran';
    if (SUPPORT_FACTIONS[normalized].devOnly && !this.devMode) normalized = 'terran';
    this.supportFaction = normalized;
    window.CockpitSupport?.setFaction?.(normalized);
    for (const button of this.els.supportFactions?.querySelectorAll('[data-key]') || []) button.classList.toggle('active', button.dataset.key === normalized);
    if (this.els.reserveFaction) this.els.reserveFaction.textContent = SUPPORT_FACTIONS[normalized].label.toUpperCase();
    // Wybrany typ linii moze nie istniec w rosterze nowej frakcji
    // (np. 'battleship' Terra Novy vs 'pirate_battleship' piratow).
    if (this.lineMode && this.lineKey && !SUPPORT_FACTIONS[normalized].roster.some(i => i.key === this.lineKey)) {
      const first = SUPPORT_FACTIONS[normalized].roster.find(i => window.LineSpawn?.supportsType?.(i.key));
      this.lineKey = (first && window.LineSpawn?.setType?.(first.key)) ? first.key : null;
      if (!this.lineKey) window.LineSpawn?.setType?.(null);
    }
    this.renderSupportRoster();
    this.updateLineHint();
  }

  setSupportOrder(order) {
    const normalized = order === 'engage' ? 'engage' : order === 'hold' ? 'hold' : 'guard';
    window.CockpitSupport?.setOrder?.(normalized);
    this.syncSupportOrderButtons(normalized);
    this.log(`Rozkaz skrzydła: ${SUPPORT_ORDER_LABELS[normalized]}`, 'orbit');
  }

  syncSupportOrderButtons(order) {
    if (this.cache.supportOrder === order) return;
    this.cache.supportOrder = order;
    for (const button of this.els.supportOrders?.querySelectorAll('[data-order]') || []) button.classList.toggle('active', button.dataset.order === order);
    if (this.els.wingOrder) this.els.wingOrder.textContent = SUPPORT_ORDER_LABELS[order] || 'ESKORTA';
  }

  toggleLineMode() {
    if (!this.devMode) return;
    if (!window.LineSpawn) {
      this.toast('Tryb LINIE niedostępny', 'bad');
      return;
    }
    this.lineMode = window.LineSpawn.toggle() === true;
    this.lineKey = this.lineMode ? (window.LineSpawn.getType?.() || null) : null;
    // Domyślny wybór z toggle() może nie należeć do rosteru tej frakcji.
    if (this.lineMode && !SUPPORT_FACTIONS[this.supportFaction]?.roster.some(i => i.key === this.lineKey)) {
      this.lineKey = null;
      window.LineSpawn.setType?.(null);
    }
    if (this.lineMode && !this.lineKey) {
      const first = SUPPORT_FACTIONS[this.supportFaction]?.roster.find(i => window.LineSpawn.supportsType?.(i.key));
      if (first) this.lineKey = window.LineSpawn.setType?.(first.key) ? first.key : null;
    }
    this.els.lineModeBtn?.classList.toggle('active', this.lineMode);
    // Pasek suwaka to osobny wiersz panelu — klasa go pokazuje tylko w trybie LINIE.
    this.els.reservePanel?.classList.toggle('line-on', this.lineMode);
    this.cancelSupportDrag();
    this.renderSupportRoster();
    this.updateLineHint();
    this.log(this.lineMode ? 'Tryb LINIE: ON — przeciągnij LPM po mapie' : 'Tryb LINIE: OFF', 'orbit');
  }

  selectLineType(key) {
    if (window.LineSpawn?.setType?.(key) !== true) return;
    this.lineKey = key;
    for (const card of this.els.reserveGrid?.querySelectorAll('.reserve-card') || []) {
      card.classList.toggle('line-selected', card.dataset.supportKey === key);
    }
    this.updateLineHint();
  }

  updateLineHint() {
    const width = window.LineSpawn?.getWidth?.() ?? 100;
    if (this.els.lineWidthValue) this.els.lineWidthValue.textContent = `${width}%`;
    if (this.els.lineWidth && this.els.lineWidth.value !== String(width)) this.els.lineWidth.value = String(width);

    const hint = this.els.lineHint;
    if (!hint) return;
    if (!this.lineKey) {
      hint.textContent = 'Wybierz typ jednostki';
      return;
    }
    const item = SUPPORT_FACTIONS[this.supportFaction]?.roster.find(i => i.key === this.lineKey);
    const max = window.LineSpawn?.tierMax?.(this.lineKey) || 0;
    hint.textContent = `${item?.name || this.lineKey}: ekran = ${max} szt.`;
  }

  renderSupportRoster() {
    const root = this.els.reserveGrid;
    const faction = SUPPORT_FACTIONS[this.supportFaction];
    if (!root || !faction) return;
    root.textContent = '';
    for (const item of faction.roster) {
      const sprite = SUPPORT_SPRITES[this.supportFaction]?.[item.key] || terranFrigateSprite;
      const details = getSupportDetails(item);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'reserve-card';
      card.dataset.supportKey = item.key;
      card.dataset.faction = faction.dataFaction;
      card.innerHTML = `<span class="reserve-portrait"><img class="reserve-sprite" alt=""><span class="support-class-icon"></span></span><span><span class="reserve-name"></span><span class="reserve-role"></span><span class="reserve-count"></span></span>`;
      const image = card.querySelector('.reserve-sprite');
      image.src = sprite;
      image.alt = item.name;
      const classIcon = card.querySelector('.support-class-icon');
      classIcon.textContent = details.classCode;
      classIcon.title = details.classLabel;
      card.querySelector('.reserve-name').textContent = item.name;
      card.querySelector('.reserve-role').textContent = item.role;
      card.querySelector('.reserve-count').textContent = item.count;
      card.title = `${item.name} · ${details.classLabel} · HP ${details.hp.toLocaleString('pl-PL')} · Shield ${details.shield.toLocaleString('pl-PL')} · Hardpointy ${details.hardpoints}`;
      const lineable = window.LineSpawn?.supportsType?.(item.key) === true;
      if (this.lineMode && lineable) {
        // W trybie LINIE karta nie spawnuje ani nie startuje przeciagania —
        // tylko wybiera typ, ktory potem ciagniemy po mapie.
        card.classList.add('line-pick');
        if (item.key === this.lineKey) card.classList.add('line-selected');
        card.addEventListener('click', () => this.selectLineType(item.key));
      } else if (this.lineMode) {
        card.classList.add('line-blocked');
        card.addEventListener('click', () => this.toast(`${item.name}: brak trybu LINIE`, 'warn'));
      } else if (item.click) {
        card.addEventListener('click', () => this.spawnSupport(item.key, null));
      } else {
        card.addEventListener('pointerdown', event => this.prepareSupportDrag(event, item, card));
      }
      card.addEventListener('pointerenter', event => this.scheduleSupportTooltip(item, sprite, event));
      card.addEventListener('pointermove', event => this.positionSupportTooltip(event.clientX, event.clientY));
      card.addEventListener('pointerleave', () => this.hideSupportTooltip());
      card.addEventListener('focus', () => {
        const rect = card.getBoundingClientRect();
        this.showSupportTooltip(item, sprite, rect.right, rect.top + rect.height / 2);
      });
      card.addEventListener('blur', () => this.hideSupportTooltip());
      root.appendChild(card);
    }
  }

  scheduleSupportTooltip(item, sprite, event) {
    this.hideSupportTooltip();
    const x = event.clientX;
    const y = event.clientY;
    this.supportTooltipTimer = setTimeout(() => this.showSupportTooltip(item, sprite, x, y), 380);
  }

  showSupportTooltip(item, sprite, clientX, clientY) {
    const root = this.els.supportTooltip;
    if (!root || this.drag) return;
    const details = getSupportDetails(item);
    root.textContent = '';
    const preview = document.createElement('div');
    preview.className = 'tooltip-sprite';
    const image = document.createElement('img');
    image.src = sprite;
    image.alt = item.name;
    preview.appendChild(image);
    const main = document.createElement('div');
    main.className = 'tooltip-main';
    const name = document.createElement('div'); name.className = 'tooltip-name'; name.textContent = item.name;
    const className = document.createElement('div'); className.className = 'tooltip-class'; className.textContent = `${details.classCode} · ${details.classLabel}`;
    const stats = document.createElement('div'); stats.className = 'tooltip-stats';
    const statRows = [
      ['HP', details.hp.toLocaleString('pl-PL')],
      ['Shield', details.shield.toLocaleString('pl-PL')],
      ['Hardpointy', details.hardpoints],
      ['V-max', details.speed ? formatVelocity(details.speed) : '—'],
      ['Masa', details.mass ? details.mass.toLocaleString('pl-PL') : '—']
    ];
    for (const [label, value] of statRows) {
      const row = document.createElement('span'); row.textContent = `${label} `;
      const strong = document.createElement('b'); strong.textContent = String(value); row.appendChild(strong); stats.appendChild(row);
    }
    const hint = document.createElement('div'); hint.className = 'tooltip-hint'; hint.textContent = item.click ? 'Kliknij, aby przyzwać skrzydło.' : 'Przeciągnij statek na mapę lub radar.';
    main.append(name, className, stats, hint);
    root.append(preview, main);
    root.hidden = false;
    this.positionSupportTooltip(clientX, clientY);
  }

  positionSupportTooltip(clientX, clientY) {
    const root = this.els.supportTooltip;
    if (!root || root.hidden) return;
    const width = 290;
    const height = 136;
    const left = clamp(clientX + 18, 8, Math.max(8, window.innerWidth - width - 8));
    const top = clamp(clientY - height / 2, 8, Math.max(8, window.innerHeight - height - 8));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  hideSupportTooltip() {
    if (this.supportTooltipTimer) clearTimeout(this.supportTooltipTimer);
    this.supportTooltipTimer = null;
    if (this.els.supportTooltip) this.els.supportTooltip.hidden = true;
  }

  prepareSupportDrag(event, item, card) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.pendingDrag = {
      item,
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    card.setPointerCapture?.(event.pointerId);
  }

  beginSupportDrag(event) {
    if (!this.pendingDrag) return;
    const { item, pointerId, card } = this.pendingDrag;
    this.drag = { item, pointerId, card };
    this.pendingDrag = null;
    this.hideSupportTooltip();
    this.els.app.classList.add('dragging');
    this.els.dragGhost.classList.add('visible');
    const sprite = SUPPORT_SPRITES[this.supportFaction]?.[item.key] || terranFrigateSprite;
    this.els.dragGhost.innerHTML = `<img class="reserve-sprite" alt=""><span><strong></strong><small></small></span>`;
    this.els.dragGhost.querySelector('img').src = sprite;
    this.els.dragGhost.querySelector('img').alt = item.name;
    this.els.dragGhost.querySelector('strong').textContent = item.name;
    this.els.dragGhost.querySelector('small').textContent = item.role;
    this.updateSupportDrag(event);
  }

  updateSupportDrag(event) {
    if (this.pendingDrag) {
      const dx = event.clientX - this.pendingDrag.startX;
      const dy = event.clientY - this.pendingDrag.startY;
      if (dx * dx + dy * dy >= 64) this.beginSupportDrag(event);
    }
    if (!this.drag) return;
    this.els.dragGhost.style.left = `${event.clientX}px`;
    this.els.dragGhost.style.top = `${event.clientY}px`;
    this.els.deployReticle.style.left = `${event.clientX}px`;
    this.els.deployReticle.style.top = `${event.clientY}px`;
    this.els.deployReticle.classList.add('visible');
  }

  finishSupportDrag(event) {
    if (this.pendingDrag) {
      this.pendingDrag.card?.releasePointerCapture?.(this.pendingDrag.pointerId);
      this.pendingDrag = null;
      return;
    }
    if (!this.drag) return;
    const item = this.drag.item;
    const canvas = document.getElementById('c');
    const rect = canvas?.getBoundingClientRect();
    let spawnPos = null;
    if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
      spawnPos = window.screenToWorld?.(event.clientX - rect.left, event.clientY - rect.top) || null;
    }
    this.cancelSupportDrag();
    if (spawnPos) this.spawnSupport(item.key, spawnPos);
  }

  cancelSupportDrag() {
    if (this.pendingDrag) {
      this.pendingDrag.card?.releasePointerCapture?.(this.pendingDrag.pointerId);
      this.pendingDrag = null;
    }
    if (!this.drag) return;
    this.drag.card?.releasePointerCapture?.(this.drag.pointerId);
    this.drag = null;
    this.els.app.classList.remove('dragging');
    this.els.dragGhost.classList.remove('visible');
    this.els.deployReticle.classList.remove('visible');
  }

  spawnSupport(key, spawnPos) {
    const faction = SUPPORT_FACTIONS[this.supportFaction];
    const result = window.spawnCallInShip?.(key, { mode: faction.mode, ...(spawnPos ? { spawnPos, pos: spawnPos } : {}) });
    if (result) {
      // Rozkaz skrzydła zostaje, jaki był — dawniej przyzwanie przestawiało całe
      // skrzydło na ESKORTĘ i kasowało wcześniej kliknięty ATAK.
      this.toast(`${faction.label}: ${key} — call-in`, 'good');
      this.log(`Wsparcie ${faction.label}: przyzwano ${key}`, 'ok');
    }
  }

  // Skrzydło: panel istnieje tylko wtedy, gdy są przyzwane jednostki.
  renderActiveUnits() {
    const root = this.els.unitList;
    if (!root) return;
    const support = Array.isArray(window.SupportWing?.units) ? window.SupportWing.units : [];
    const units = support.map(entry => entry?.npc).filter(unit => unit && !unit.dead);
    const order = window.SupportWing?.order || 'guard';
    this.syncSupportOrderButtons(order);
    const shipPos = window.ship?.pos || null;
    const key = units.map(unit => {
      const pos = getEntityPosition(unit);
      const distance = shipPos ? Math.round(Math.hypot(pos.x - shipPos.x, pos.y - shipPos.y) / 200) : 0;
      return `${unit.id || unit.type}:${Math.round(unit.hp || 0)}:${Math.round(unit.shield?.val || 0)}:${distance}`;
    }).join('|');
    if (this.cache.unitsKey === key) return;
    this.cache.unitsKey = key;
    if (this.els.wingPanel) this.els.wingPanel.hidden = units.length === 0;
    root.textContent = '';
    for (const unit of units.slice(0, 8)) {
      const card = document.createElement('div'); card.className = 'unit-card';
      const portrait = document.createElement('span'); portrait.className = 'unit-portrait';
      const sprite = spriteForEntity(unit) || terranFrigateSprite;
      const image = document.createElement('img'); image.src = sprite; image.alt = ''; portrait.appendChild(image);
      const info = document.createElement('span'); info.className = 'unit-info';
      const name = document.createElement('span'); name.className = 'unit-name'; name.textContent = getEntityLabel(unit, 'Jednostka');
      const meta = document.createElement('span'); meta.className = 'unit-meta'; meta.textContent = String(unit.type || 'wsparcie').replace(/_/g, ' ');
      const bars = document.createElement('span'); bars.className = 'unit-bars';
      const hp = clamp((Number(unit.hp) || 0) / Math.max(1, Number(unit.maxHp) || 1), 0, 1);
      const sh = clamp((Number(unit.shield?.val) || 0) / Math.max(1, Number(unit.shield?.max) || 1), 0, 1);
      bars.innerHTML = `<span class="micro-bar"><span style="--value:${Math.round(hp * 100)}%;--bar-color:#ff2d36"></span></span><span class="micro-bar"><span style="--value:${Math.round(sh * 100)}%;--bar-color:#2f7dff"></span></span>`;
      info.append(name, meta, bars);
      const distance = document.createElement('span'); distance.className = 'unit-distance';
      const pos = getEntityPosition(unit);
      distance.textContent = shipPos ? formatLocalDistance(Math.hypot(pos.x - shipPos.x, pos.y - shipPos.y)) : '—';
      card.append(portrait, info, distance);
      root.appendChild(card);
    }
    if (units.length > 8) {
      const more = document.createElement('div');
      more.className = 'panel-empty';
      more.textContent = `+${units.length - 8} jedn. · pełny skład w CIC`;
      root.appendChild(more);
    }
    if (this.els.activeCount) this.els.activeCount.textContent = `${units.length} JEDN.`;
  }

  toggleComm(force = null) {
    if (window.stationUI?.open || this.missionOpen) return false;
    const open = force == null ? !this.commOpen : !!force;
    if (!open) { this.closeComm(); return false; }
    this.commOpen = true;
    this.commBootUntil = perfNow() + 1200;
    this.commDirectory = this.getStationDirectory();
    if (this.els.commPanel) this.els.commPanel.hidden = false;
    this.els.pbComm?.classList.add('active');
    this.renderComm();
    this.log('Uplink: skanowanie lokalnych węzłów stacji…', 'orbit');
    return true;
  }

  closeComm() {
    if (!this.commOpen) return;
    this.commOpen = false;
    window.closeStationTerminal?.();
    if (this.els.commPanel) this.els.commPanel.hidden = true;
    this.els.pbComm?.classList.remove('active');
    this.log('Uplink: połączenie zamknięte.', 'warn');
  }

  getStationDirectory() {
    const ship = window.ship;
    if (!ship?.pos || !Array.isArray(window.stations)) return [];
    return window.stations.filter(station => station && !station._destroyed3D).map(station => {
      const pos = getEntityPosition(station);
      return { station, distance: Math.hypot(pos.x - ship.pos.x, pos.y - ship.pos.y) };
    }).sort((a, b) => a.distance - b.distance).slice(0, 6);
  }

  renderComm() {
    if (!this.commOpen || !this.els.commBody) return;
    const now = perfNow();
    const data = window.getStationTerminalUIData?.() || {};
    const root = this.els.commBody;
    root.textContent = '';
    if (now < this.commBootUntil) {
      if (this.els.commNet) this.els.commNet.textContent = 'BOOTING / SCAN…';
      const text = document.createElement('div'); text.className = 'term-text blink'; text.textContent = '> sys.init()…  > uplink.scan()… PENDING'; root.appendChild(text); return;
    }
    if (data.open && (data.phase === 'connecting' || data.phase === 'loading')) {
      if (this.els.commNet) this.els.commNet.textContent = data.phase === 'loading' ? 'ŁADOWANIE USŁUGI' : 'HANDSHAKE';
      const text = document.createElement('div'); text.className = 'term-text blink'; text.textContent = data.line || '> Łączenie…'; root.appendChild(text); return;
    }
    if (data.open && data.phase === 'connected') {
      if (this.els.commNet) this.els.commNet.textContent = `CONNECTED · ${data.stationName || 'STACJA'}`;
      const text = document.createElement('div'); text.className = 'term-text'; text.textContent = '> POŁĄCZENIE USTANOWIONE. DOSTĘPNE USŁUGI:'; root.appendChild(text);
      const grid = document.createElement('div'); grid.className = 'term-grid';
      for (const service of data.services || STATION_TABS) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'term-btn large'; button.dataset.service = service.id; button.textContent = service.label; grid.appendChild(button);
      }
      root.appendChild(grid); return;
    }
    if (this.els.commNet) this.els.commNet.textContent = countLabel(this.commDirectory.length, 'WĘZEŁ', 'WĘZŁY', 'WĘZŁÓW');
    const intro = document.createElement('div'); intro.className = 'term-text'; intro.textContent = '> LOCAL NETWORK NODES FOUND:'; root.appendChild(intro);
    if (!this.commDirectory.length) {
      const empty = document.createElement('div'); empty.className = 'term-text'; empty.textContent = 'NO SIGNAL DETECTED'; root.appendChild(empty); return;
    }
    for (const [entryIndex, { station, distance }] of this.commDirectory.entries()) {
      const row = document.createElement('div'); row.className = 'term-row';
      const target = document.createElement('span'); target.className = 'term-target'; target.textContent = `[${station.id ?? 'STA'}] ${getEntityLabel(station, 'Stacja')} — ${formatNavigationDistance(distance)}`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'term-btn'; button.dataset.connect = String(station.id ?? entryIndex); button.textContent = 'CONNECT';
      row.append(target, button); root.appendChild(row);
    }
  }

  connectStationById(id) {
    const key = String(id);
    const entry = this.commDirectory.find(item => String(item.station?.id) === key) || this.commDirectory[Number(id)] || null;
    if (!entry?.station) return false;
    window.openStationTerminal?.(entry.station);
    if (this.els.commNet) this.els.commNet.textContent = 'HANDSHAKE';
    this.log(`Uplink: handshake z [${entry.station.id ?? 'STA'}] ${getEntityLabel(entry.station, 'Stacja')}`, 'orbit');
    this.renderComm();
    return true;
  }

  openCommForStation(station) {
    if (!station) return;
    this.toggleComm(true);
    this.commBootUntil = 0;
    this.commDirectory = [{ station, distance: 0 }, ...this.getStationDirectory().filter(item => item.station !== station)];
    this.connectStationById(station.id);
  }

  openStationService(tab) {
    if (!STATION_TABS.some(item => item.id === tab)) return;
    if (window.selectStationTerminalService?.(tab)) {
      this.log(`Uplink: ładowanie modułu ${tab.toUpperCase()}`, 'ok');
      this.renderComm();
    }
  }

  toggleMissionJournal(force = null) {
    const open = force == null ? !this.missionOpen : !!force;
    if (!open) { this.closeMissionJournal(); return false; }
    if (window.stationUI?.open) window.closeStationUI?.();
    this.closeComm();
    this.missionOpen = true;
    this.els.stationTablet?.classList.add('open', 'missions');
    this.els.stationTablet?.setAttribute('data-view', 'missions');
    this.els.stationTablet?.setAttribute('aria-hidden', 'false');
    this.els.stationTabsBar.hidden = true;
    this.els.stationPane.hidden = true;
    this.els.missionPane.hidden = false;
    this.els.tabletLabel.textContent = 'Dziennik misji / operacje';
    this.els.tabletTitle.textContent = 'CENTRUM OPERACYJNE';
    this.els.tabletSub.textContent = 'ZSYNCHRONIZOWANO Z SYSTEMEM MISJI';
    this.els.tabletLinkText.textContent = 'ŁĄCZE TAKTYCZNE';
    this.els.pbMissions?.classList.add('active');
    this.syncTabletOpenClass();
    this.renderMissionJournal();
    return true;
  }

  closeMissionJournal() {
    if (!this.missionOpen) return;
    this.missionOpen = false;
    this.els.pbMissions?.classList.remove('active');
    this.els.stationTablet?.classList.remove('missions', 'open');
    this.els.stationTablet?.removeAttribute('data-view');
    this.els.stationTablet?.setAttribute('aria-hidden', 'true');
    this.els.missionPane.hidden = true;
    this.els.stationPane.hidden = false;
    this.els.stationTabsBar.hidden = false;
    this.syncTabletOpenClass();
  }

  getMissionSnapshot() {
    const snapshot = window.MissionJournal?.getSnapshot?.();
    return Array.isArray(snapshot) ? snapshot : [];
  }

  renderMissionJournal() {
    if (!this.missionOpen || !this.els.missionList || !this.els.missionDetail) return;
    const missions = this.getMissionSnapshot();
    const filtered = missions.filter(mission => this.missionFilter === 'all' || mission.status === this.missionFilter);
    if (!filtered.some(mission => String(mission.id) === String(this.selectedMissionId))) this.selectedMissionId = filtered[0]?.id ?? null;
    this.els.missionList.textContent = '';
    if (!filtered.length) {
      const empty = document.createElement('div'); empty.className = 'mission-empty'; empty.textContent = this.missionFilter === 'completed' ? 'Brak ukończonych misji.' : 'Brak aktywnych misji.'; this.els.missionList.appendChild(empty);
    }
    for (const mission of filtered) {
      const card = document.createElement('button'); card.type = 'button'; card.className = `mission-card mission-faction-${mission.faction || 'independent'} ${mission.status || 'active'}`; card.dataset.missionId = String(mission.id); card.classList.toggle('selected', String(mission.id) === String(this.selectedMissionId));
      const kicker = document.createElement('span'); kicker.className = 'mission-kicker';
      const type = document.createElement('span'); type.textContent = String(mission.type || 'MISJA').toUpperCase();
      const status = document.createElement('span'); status.textContent = mission.status === 'completed' ? 'UKOŃCZONA' : 'AKTYWNA'; kicker.append(type, status);
      const title = document.createElement('span'); title.className = 'mission-title'; title.textContent = mission.title || 'Bez nazwy';
      const summary = document.createElement('span'); summary.className = 'mission-summary'; summary.textContent = mission.objective || mission.description || 'Brak opisu celu.';
      const progress = document.createElement('span'); progress.className = 'mission-progress'; const fill = document.createElement('span'); fill.style.setProperty('--progress', `${Math.round(clamp(mission.progress ?? (mission.status === 'completed' ? 1 : 0), 0, 1) * 100)}%`); progress.appendChild(fill);
      card.append(kicker, title, summary, progress); this.els.missionList.appendChild(card);
    }
    const selected = missions.find(mission => String(mission.id) === String(this.selectedMissionId)) || null;
    this.renderMissionDetail(selected);
    const activeCount = missions.filter(mission => mission.status === 'active').length;
    const completedCount = missions.filter(mission => mission.status === 'completed').length;
    this.els.tabletFootLeft.innerHTML = `AKTYWNE <b>${activeCount}</b>`;
    this.els.tabletFootCenter.textContent = `UKOŃCZONE ${completedCount}`;
    this.els.tabletFootRight.innerHTML = `ŁĄCZNY REWARD <b>${missions.reduce((sum, mission) => sum + (mission.status === 'completed' ? Number(mission.rewardCredits) || 0 : 0), 0).toLocaleString('pl-PL')} CR</b>`;
  }

  renderMissionDetail(mission) {
    const root = this.els.missionDetail;
    root.textContent = '';
    if (!mission) { const empty = document.createElement('div'); empty.className = 'mission-empty'; empty.textContent = 'Wybierz wpis z dziennika misji.'; root.appendChild(empty); return; }
    const head = document.createElement('div'); head.className = 'mission-detail-head';
    const eyebrow = document.createElement('div'); eyebrow.className = 'mission-eyebrow'; eyebrow.textContent = `${mission.factionLabel || mission.faction || 'INDEPENDENT'} / ${mission.type || 'MISJA'}`;
    const title = document.createElement('h2'); title.className = 'mission-detail-title'; title.textContent = mission.title || 'Misja';
    const status = document.createElement('span'); status.className = 'mission-status'; status.textContent = mission.status === 'completed' ? 'UKOŃCZONA' : 'AKTYWNA'; head.append(eyebrow, title, status);
    const body = document.createElement('div'); body.className = 'mission-detail-body';
    const description = document.createElement('p'); description.className = 'mission-description'; description.textContent = mission.description || 'Brak dodatkowego opisu.'; body.appendChild(description);
    const objectiveTitle = document.createElement('div'); objectiveTitle.className = 'mission-section-title'; objectiveTitle.textContent = 'CELE'; body.appendChild(objectiveTitle);
    const objectives = document.createElement('ul'); objectives.className = 'mission-objectives';
    const objectiveItems = Array.isArray(mission.objectives) && mission.objectives.length ? mission.objectives : [{ text: mission.objective || 'Wykonaj zadanie.', done: mission.status === 'completed' }];
    for (const objective of objectiveItems) { const item = document.createElement('li'); item.className = `mission-objective ${objective.done ? 'done' : 'current'}`; item.textContent = objective.text || String(objective); objectives.appendChild(item); }
    body.appendChild(objectives);
    const rewardTitle = document.createElement('div'); rewardTitle.className = 'mission-section-title'; rewardTitle.textContent = 'NAGRODA'; body.appendChild(rewardTitle);
    const rewards = document.createElement('div'); rewards.className = 'mission-rewards'; const reward = document.createElement('span'); reward.className = 'mission-reward'; reward.textContent = `${(Number(mission.rewardCredits) || 0).toLocaleString('pl-PL')} CR`; rewards.appendChild(reward);
    if (mission.location) { const location = document.createElement('span'); location.className = 'mission-reward'; location.textContent = mission.location; rewards.appendChild(location); }
    body.appendChild(rewards);
    const actions = document.createElement('div'); actions.className = 'mission-actions';
    if (mission.pos && mission.status === 'active') { const map = document.createElement('button'); map.type = 'button'; map.className = 'physical-btn'; map.textContent = 'Pokaż w CIC'; map.addEventListener('click', () => { this.closeMissionJournal(); this.dispatchGameKey('KeyM', 'm'); }); actions.appendChild(map); }
    root.append(head, body, actions);
  }

  syncTablet() {
    const stationUI = window.stationUI;
    const stationOpen = !!stationUI?.open && !this.missionOpen;
    if (stationOpen !== this.lastStationOpen) {
      this.lastStationOpen = stationOpen;
      this.els.stationTablet?.classList.toggle('open', stationOpen);
      this.els.stationTablet?.setAttribute('aria-hidden', stationOpen ? 'false' : 'true');
      this.els.stationTabsBar.hidden = !stationOpen;
      this.els.stationPane.hidden = !stationOpen;
      if (stationOpen) {
        this.closeComm();
        this.log(`Terminal stacji otwarty — ${getEntityLabel(stationUI.station, 'Stacja')}`, 'ok');
      } else if (!this.missionOpen) {
        this.log('Terminal stacji zamknięty.', 'warn');
      }
      this.syncTabletOpenClass();
    }
    if (!stationOpen) return;
    const station = stationUI.station;
    this.els.tabletLabel.textContent = 'Terminal stacji / usługi dokowe';
    this.els.tabletTitle.textContent = getEntityLabel(station, 'Stacja orbitalna');
    this.els.tabletSub.textContent = `[${station?.id ?? 'STA'}] POŁĄCZONO`;
    this.els.tabletLinkText.textContent = 'ŁĄCZE AKTYWNE';
    const activeTab = stationUI.tab || 'hangar';
    if (this.lastStationTab !== activeTab || !this.els.tabletTabTrack.children.length) {
      this.lastStationTab = activeTab;
      this.renderStationTabs(activeTab);
    }
    const credits = window.DevEconomy?.getCredits?.() ?? 0;
    this.els.tabletCredits.textContent = `${Math.round(credits).toLocaleString('pl-PL')} CR`;
    this.els.tabletCargo.textContent = window.CockpitBridge?.getCargoLabel?.() || '—';
    this.els.tabletFootCenter.textContent = `MODUŁ ${activeTab.toUpperCase()}`;
  }

  // Otwarty tablet (stacja albo dziennik misji) chowa HUD lotu pod spodem.
  syncTabletOpenClass() {
    const open = !!(this.missionOpen || this.lastStationOpen);
    if (this.cache.tabletOpen === open) return;
    this.cache.tabletOpen = open;
    this.els.app?.classList.toggle('tablet-open', open);
  }

  renderStationTabs(activeTab) {
    const root = this.els.tabletTabTrack;
    if (!root) return;
    root.textContent = '';
    root.style.transform = 'translateX(0px)';
    for (const tab of STATION_TABS) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'menu-item'; button.dataset.tab = tab.id; button.textContent = tab.label; button.classList.toggle('active', tab.id === activeTab); root.appendChild(button);
    }
    requestAnimationFrame(() => this.centerStationTab(activeTab));
  }

  centerStationTab(activeTab) {
    const root = this.els.tabletTabTrack;
    const viewport = this.els.tabletTabs;
    if (!root || !viewport) return;
    const button = [...root.children].find(item => item.dataset.tab === activeTab);
    if (!button) return;
    const offset = root.offsetWidth / 2 - (button.offsetLeft + button.offsetWidth / 2);
    root.style.transform = `translateX(${Math.round(offset)}px)`;
  }

  selectStationTab(tab) {
    if (!STATION_TABS.some(item => item.id === tab) || !window.stationUI?.open) return;
    window.CockpitBridge?.selectStationTab?.(tab);
    if (window.stationUI) window.stationUI.tab = tab;
    this.lastStationTab = '';
  }

  stepStationTab(direction) {
    const current = window.stationUI?.tab || 'hangar';
    const index = Math.max(0, STATION_TABS.findIndex(tab => tab.id === current));
    const next = (index + direction + STATION_TABS.length) % STATION_TABS.length;
    this.selectStationTab(STATION_TABS[next].id);
  }

  closeTablet() {
    if (this.missionOpen) this.closeMissionJournal();
    else window.closeStationUI?.();
  }

  syncRingCityFlightButton(force = false) {
    const button = this.els.pbShip;
    if (!button) return;
    const now = perfNow();
    if (!force && now - this.lastRingFlightSync < 250) return;
    this.lastRingFlightSync = now;
    const status = window.RingCityFlight?.getLaunchStatus?.() || {
      available: false,
      reason: 'Moduł lotu Ring City nie jest gotowy.'
    };
    const available = !!status.available;
    // Pierścień w zasięgu to kontekst — mówimy o nim raz, zamiast trzymać stały przycisk na widoku.
    if (available && this.ringFlightAvailable === false) {
      this.pushAlert('Pierścień w zasięgu · Alt → Statek: lot po Ring City', { tone: 'info', duration: 3.2 });
    }
    this.ringFlightAvailable = available;
    button.disabled = !available;
    button.classList.toggle('ring-flight-ready', available);
    button.classList.toggle('ring-flight-loading', !!status.loading);
    button.title = status.reason || 'Eksperymentalny lot po Ring City';
    const label = button.querySelector('span');
    if (label) label.textContent = status.loading ? 'Ładowanie…' : 'Statek';
  }

  launchRingCityFlight() {
    const controller = window.RingCityFlight;
    if (!controller?.requestLaunch) {
      this.toast('Moduł lotu Ring City nie jest gotowy.', 'bad');
      return;
    }
    const status = controller.getLaunchStatus?.();
    if (!status?.available) {
      this.log(status?.reason || 'Lot po Ring City jest teraz niedostępny.', 'warn');
      this.toast(status?.reason || 'Podejdź bliżej ringu.', 'bad');
      this.syncRingCityFlightButton(true);
      return;
    }
    controller.requestLaunch();
    this.syncRingCityFlightButton(true);
  }

  // Komunikaty statku (pushZoneMessage, toasty) — linia nad klastrem, max 2 naraz.
  pushAlert(text, options = {}) {
    const message = String(text || '').trim();
    const root = this.els.alertLine;
    if (!message || !root) return;
    const rawTone = String(options.tone || 'status').toLowerCase();
    // Wejście do strefy obsługuje dziennik (logZone) i nagłówek lokalizacji.
    if (rawTone === 'sector') return;
    if (options.label === 'APPROACH VECTOR') {
      this.log(`NAWIGACJA — zbliżanie: ${message}`, 'orbit');
      return;
    }
    const now = perfNow();
    if (message === this.lastAlertText && now - this.lastAlertAt < 400) return;
    this.lastAlertText = message;
    this.lastAlertAt = now;
    const tone = ALERT_TONES[rawTone] || 'info';
    const seconds = clamp(Number(options.duration) || 2.2, 1.2, 6) + 0.8;
    const item = document.createElement('div');
    item.className = `alert-item ${tone}`;
    item.style.setProperty('--dur', `${seconds.toFixed(2)}s`);
    item.textContent = message;
    root.appendChild(item);
    while (root.children.length > 2) root.firstElementChild?.remove();
    setTimeout(() => item.remove(), seconds * 1000 + 80);
  }

  createFeedLine(entry, live, now = perfNow()) {
    const line = document.createElement('div');
    line.className = `feed-line ${entry.tone || ''}${live ? ' live' : ''}`.trim();
    line.dataset.at = String(entry.at);
    if (live) line.style.animationDelay = `${-Math.max(0, now - entry.at)}ms`;
    const time = document.createElement('span');
    time.className = 'ts';
    time.textContent = `[${entry.timestamp}]`;
    line.append(time, document.createTextNode(entry.text));
    return line;
  }

  // Poza trybem interfejsu: kilka świeżych wpisów, które same gasną.
  // W trybie interfejsu (Alt): historia z przewijaniem.
  renderFeed() {
    const root = this.els.feedLines;
    if (!root) return;
    root.textContent = '';
    const now = perfNow();
    if (this.pointerMode) {
      for (const entry of this.logs.slice(-FEED_HISTORY)) root.appendChild(this.createFeedLine(entry, false, now));
      // Po zmianie klasy .pointer pudełko dostaje max-height dopiero w następnym layoucie.
      requestAnimationFrame(() => { root.scrollTop = root.scrollHeight; });
      return;
    }
    for (const entry of this.logs.slice(-FEED_LIVE)) {
      if (now - entry.at < FEED_LIFE_MS) root.appendChild(this.createFeedLine(entry, true, now));
    }
  }

  pruneFeed(now) {
    const root = this.els.feedLines;
    if (!root || this.pointerMode) return;
    while (root.firstElementChild && now - Number(root.firstElementChild.dataset.at) > FEED_LIFE_MS) {
      root.firstElementChild.remove();
    }
  }

  log(message, tone = '') {
    const text = String(message || '').trim();
    if (!text) return;
    const now = perfNow();
    const elapsed = Math.floor((now - this.startedAt) / 1000);
    const timestamp = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    const entry = { text, tone, timestamp, at: now };
    this.logs.push(entry);
    if (this.logs.length > 80) this.logs.splice(0, this.logs.length - 80);
    const root = this.els.feedLines;
    if (!root) return;
    root.appendChild(this.createFeedLine(entry, !this.pointerMode, now));
    const limit = this.pointerMode ? FEED_HISTORY : FEED_LIVE;
    while (root.children.length > limit) root.firstElementChild?.remove();
    if (this.pointerMode) root.scrollTop = root.scrollHeight;
  }

  logZone(label, zoneId = '') {
    const text = String(label || '').trim();
    if (!text) return;
    const missionZone = String(zoneId).startsWith('pirate_');
    this.log(`${missionZone ? 'STREFA MISJI' : 'NAWIGACJA'} — wejście: ${text}`, missionZone ? 'mission' : 'orbit');
  }

  onMissionUpdated(mission, event = 'updated') {
    if (event === 'started') this.log(`MISJA PRZYJĘTA — ${mission.title}`, 'mission');
    if (event === 'completed') {
      this.log(`MISJA UKOŃCZONA — ${mission.title}`, 'ok');
      this.log(`NAGRODA — ${(Number(mission.rewardCredits) || 0).toLocaleString('pl-PL')} CR`, 'reward');
      this.toast(`Misja ukończona · +${(Number(mission.rewardCredits) || 0).toLocaleString('pl-PL')} CR`, 'good');
    }
    if (this.missionOpen) this.renderMissionJournal();
  }

  toast(message, tone = '') {
    this.pushAlert(message, { tone: tone || 'info', duration: 2.6 });
  }
}
