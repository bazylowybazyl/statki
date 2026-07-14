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
    label: 'Pirates', dataFaction: 'pirates', mode: 'pirate',
    roster: [
      { key: 'frigate_pd', name: 'Pirate Frigate', role: 'Fregata rajderska', count: '×50', icon: 'frigate' },
      { key: 'destroyer', name: 'Pirate Destroyer', role: 'Niszczyciel rajderski', count: '×5', icon: 'destroyer' },
      { key: 'pirate_battleship', name: 'Pirate Battleship', role: 'Pancernik rajderski', count: '×1', icon: 'battleship' }
    ]
  },
  independent: {
    label: 'Independent', dataFaction: 'independent', mode: 'dummy',
    roster: [
      { key: 'atlas', name: 'Atlas', role: 'Niezależny supercapital', count: '×1', icon: 'supercapital' },
      { key: 'megafreighter', name: 'Megafreighter', role: 'Jednostka użytkowa', count: '×1', icon: 'carrier' }
    ]
  }
});

const HOTKEYS = Object.freeze([
  { key: '1', label: 'GŁÓWNA', icon: '◆', type: 'main', code: 'Digit1' },
  { key: '2', label: 'SPECJAL', icon: '✦', type: 'special', code: 'Digit2' },
  { key: '3', label: 'RAKIETY', icon: '➤', type: 'missile', code: 'Digit3' },
  { key: '4', label: 'WBUDOWANA', icon: '⌁', type: 'builtin', code: 'Digit4' },
  { key: '5', label: 'SPEC. MISS', icon: '◇', type: 'special_missile', code: 'Digit5' },
  { key: '6', label: 'ENERGY SHOT', icon: 'ϟ', action: 'energy' },
  { key: 'X', label: 'SKAN', icon: '◎', code: 'KeyX' },
  { key: 'R', label: 'NAPRAWA', icon: '✚', code: 'KeyR' }
]);

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function formatDistance(value) {
  const d = Math.max(0, Number(value) || 0);
  if (d >= 1000000) return `${(d / 1000000).toFixed(1)}M`;
  if (d >= 1000) return `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)}K`;
  return `${Math.round(d)}`;
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

function shipSilhouette(kind = 'frigate') {
  const safe = ['fighter', 'frigate', 'destroyer', 'battleship', 'carrier', 'supercapital'].includes(kind)
    ? kind
    : 'frigate';
  return `<span class="ship-silhouette ${safe}" aria-hidden="true"></span>`;
}

function cockpitMarkup() {
  return `
    <link rel="stylesheet" href="${cockpitCssUrl}">
    <div class="app" id="app" data-mode="combat">
      <div class="glass-vignette"></div>
      <div class="glass-scanlines"></div>
      <div class="map-overlay"><span class="map-caption">Mapa taktyczna / pole warp</span></div>
      <div class="deploy-banner">WEKTOR ROZMIESZCZENIA — UPUŚĆ NA MAPĘ LUB RADAR, ABY ROZPOCZĄĆ WARP</div>

      <aside class="side-stack left-stack" id="leftStack">
        <section class="hud-panel active-panel">
          <header class="panel-head">
            <div class="panel-title"><strong>Aktywne skrzydło</strong><small>PRZYZWANE / W POLU WALKI</small></div>
            <span class="panel-count" id="activeCount">0 JEDN.</span>
          </header>
          <div class="panel-body unit-list" id="unitList"></div>
          <footer class="panel-orders" id="supportOrders">
            <button class="tech-button active" type="button" data-order="guard">ESKORTA</button>
            <button class="tech-button" type="button" data-order="engage">ATAK</button>
            <button class="tech-button" type="button" data-order="hold">STÓJ</button>
          </footer>
        </section>

        <section class="hud-panel reserve-panel">
          <header class="panel-head">
            <div class="panel-title"><strong>Wsparcie</strong><small>FLEET CALL-IN / REZERWA</small></div>
            <span class="panel-count" id="reserveCount">GOTOWOŚĆ</span>
          </header>
          <div class="faction-tabs" id="supportFactions">
            <button type="button" class="faction-tab active" data-faction="terra-nova" data-key="terran">TERRA NOVA</button>
            <button type="button" class="faction-tab" data-faction="pirates" data-key="pirate">PIRATES</button>
            <button type="button" class="faction-tab" data-faction="independent" data-key="independent">INDEPENDENT</button>
          </div>
          <div class="panel-body"><div class="reserve-grid" id="reserveGrid"></div></div>
        </section>
      </aside>

      <aside class="side-stack right-stack" id="rightStack">
        <section class="hud-panel overview-panel">
          <header class="panel-head">
            <div class="panel-title"><strong>Overview / Scanner</strong><small>KONTAKTY PASYWNE + AKTYWNE</small></div>
            <span class="panel-count" id="contactCount">0 KONTAKTÓW</span>
          </header>
          <div class="scanner-filters" id="scannerFilters">
            <button type="button" class="filter-button active" data-filter="all">WSZYSTKO</button>
            <button type="button" class="filter-button" data-filter="hostile">WRÓG</button>
            <button type="button" class="filter-button" data-filter="asteroid">ZASOBY</button>
            <button type="button" class="filter-button" data-filter="station">STACJE</button>
            <button type="button" class="filter-button" data-filter="friendly">SOJUSZ</button>
          </div>
          <div class="panel-body">
            <div class="contact-table-head"><span>TYP</span><span>NAZWA</span><span class="dist-cell">DYST</span><span>LCK</span></div>
            <div id="contactRows"></div>
          </div>
        </section>
        <section class="hud-panel selected-panel">
          <header class="panel-head"><div class="panel-title"><strong>Selected object</strong><small id="selKind">—</small></div></header>
          <div id="selBody"><div class="sel-empty">Brak wybranego obiektu.</div></div>
        </section>
      </aside>

      <section id="cockpit">
        <div class="cockpit-shell"></div><div class="shell-accent l"></div><div class="shell-accent r"></div>
        <div class="ck-left">
          <section class="cockpit-module systems-module">
            <span class="module-label">SYSTEMY</span>
            <div class="vertical-bars">
              <div class="vital-column hp" id="vitalHp"><span class="vital-value">100</span><div class="vital-track"><div class="vital-ghost"></div><div class="vital-fill"></div></div><span class="vital-label">HP</span></div>
              <div class="vital-column shield" id="vitalShield"><span class="vital-value">100</span><div class="vital-track"><div class="vital-ghost"></div><div class="vital-fill"></div></div><span class="vital-label">TARCZA</span></div>
              <div class="vital-column core" id="vitalCore"><span class="vital-value">100</span><div class="vital-track"><div class="vital-ghost"></div><div class="vital-fill"></div></div><span class="vital-label">RDZEŃ</span></div>
            </div>
          </section>
          <section class="cockpit-module primary-module">
            <span class="module-label">TERMINAL POKŁADOWY / UZBROJENIE</span>
            <div class="primary-layout">
              <div class="screen-bezel" id="screenBezel">
                <div class="screen-glare"></div>
                <div class="term-sidebar">
                  <button type="button" class="nav-icon active" id="navLog" title="Dziennik pokładowy"><svg viewBox="0 0 24 24"><path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z"/></svg></button>
                  <button type="button" class="nav-icon" id="navMissions" title="Dziennik misji [J]"><svg viewBox="0 0 24 24"><path d="M6 2h9l4 4v16H6zm8 2v4h4M9 12h7M9 16h7"/></svg></button>
                  <button type="button" class="nav-icon" id="navShip" title="Systemy"><svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9 4c0 .5-.05 1-.14 1.5l2.11 1.65-2 3.46-2.49-1a8 8 0 01-2.6 1.5L15.5 22h-4l-.38-2.89a8 8 0 01-2.6-1.5l-2.49 1-2-3.46 2.11-1.65A8 8 0 016 12c0-.5.05-1 .14-1.5L4.03 8.85l2-3.46 2.49 1a8 8 0 012.6-1.5L11.5 2h4l.38 2.89a8 8 0 012.6 1.5l2.49-1 2 3.46-2.11 1.65c.09.5.14 1 .14 1.5z"/></svg></button>
                  <button type="button" class="nav-icon" id="navComm" title="Uplink — łączność ze stacjami [CapsLock]"><svg viewBox="0 0 24 24"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg></button>
                </div>
                <div class="term-main"><div class="console-status" id="consoleStatus"></div><div class="console-log" id="consoleLog"></div></div>
                <div class="term-widget"><div class="widget-header">Informacje</div><div class="clock-content"><div class="clock-time" id="termClock">00:00</div><div class="clock-date" id="termDate">—</div><div class="clock-loc" id="termLoc"><small>Pozycja</small>PRZESTRZEŃ MIĘDZYPLANETARNA</div></div></div>
                <div class="term-comm" id="termComm"><div class="comm-head"><span class="comm-title">UPLINK TERMINAL v1.0</span><span class="comm-net" id="commNet">SKAN SIECI…</span><button type="button" class="term-btn" id="commClose">0 · ROZŁĄCZ</button></div><div class="comm-body" id="commBody"></div><div class="comm-foot"><span>CAPS / ESC — zamknij terminal</span><span>ŁĄCZE TAKTYCZNE</span></div></div>
              </div>
              <div class="hardware-panel" id="hotkeyGrid"></div>
            </div>
          </section>
        </div>
        <div id="radarPod" aria-label="CIC radar"><canvas id="radarCanvas" class="hud-radar-canvas"></canvas><div class="rp-readout hud-radar-readout"><span id="rdTotal" class="total">C:00</span><span class="h hostile" id="rdHostile">H:00</span><span id="rdAst" class="asteroid">A:00</span><span class="r range" id="rdRange">20K</span></div><div class="rp-ranges hud-radar-controls" id="radarRanges"></div></div>
        <div class="ck-right">
          <section class="cockpit-module speed-module"><span class="module-label">NAPĘD / PRĘDKOŚĆ</span><div class="speed-layout"><div class="speed-stage"><canvas id="speedCanvas" aria-label="Prędkość i obroty napędu"></canvas><div class="gauge-readout speed-readout"><span class="gauge-label">PRĘDKOŚĆ</span><span class="gauge-number" id="spValue">0</span><span class="gauge-unit">U/S</span></div><div class="gauge-readout rpm-readout"><span class="gauge-label">OBROTY</span><span class="gauge-number" id="spRpm">0.0</span><span class="gauge-unit">×1000 RPM</span></div><div class="drive-mode-badge" id="spMode">B</div><div class="speed-trip"><span>ODO</span><span class="trip-value" id="spOdo">0 u</span><span>TRIP</span><span class="trip-value" id="spTrip">0 u</span></div></div><div class="speed-bottom"><span>CIĄG <b id="thrPct">0%</b></span><span id="spState">REJS</span><span>LIMIT <b id="spLimit">0</b></span></div><div class="speed-pedals"><button type="button" class="pedal" id="thrPlus">W · Gaz</button><button type="button" class="pedal" id="thrMinus">S · Hamulec</button></div></div></section>
          <section class="cockpit-module control-module"><span class="module-label">PANEL CENTRALNY / MODE</span><div class="console-layout"><div class="infotainment-screen"><div class="screen-content" id="modeTrack"><div class="menu-item active" data-mode="combat">BOJOWY</div><div class="menu-item" data-mode="maneuver">MANEWROWY</div><div class="menu-item" data-mode="travel">PODRÓŻ</div></div><div class="selection-indicator"></div></div><div class="controls-area"><div class="btn-group"><button type="button" class="physical-btn" id="pbComm"><span>Komunikacja</span><div class="led-indicator blue"></div></button><button type="button" class="physical-btn" id="pbMissions"><span>Misje</span><div class="led-indicator orange"></div></button></div><div class="center-console"><button type="button" class="shortcut-btn pos-t" id="scScan" title="[X]">Skan</button><button type="button" class="shortcut-btn pos-b" id="scLock" title="[T]">Cel</button><button type="button" class="shortcut-btn pos-l" id="scAuto" title="[7]">Auto</button><button type="button" class="shortcut-btn pos-r" id="scStab" title="[B]">Stab</button><div class="rotary-knob" id="rotaryKnob" title="Przeciągnij lub użyj kółka; V zmienia tryb"><div class="knob-indicator"></div><div class="knob-touchpad"><div class="knob-center-logo">///</div></div></div></div><div class="btn-group"><button type="button" class="physical-btn" id="pbShip"><span>Statek</span><div class="led-indicator green"></div></button><button type="button" class="physical-btn" id="pbMap"><span>Mapa</span><div class="led-indicator red"></div></button></div></div></div></section>
        </div>
      </section>

      <section class="station-tablet" id="stationTablet" aria-hidden="true">
        <div class="tablet-frame">
          <header class="tablet-head"><div class="tablet-id"><span class="tl-label" id="tabletLabel">Terminal stacji / usługi dokowe</span><strong id="tabletTitle">—</strong><small id="tabletSub">BRAK POŁĄCZENIA</small></div><div class="tablet-link"><span class="link-dot"></span><span id="tabletLinkText">ŁĄCZE AKTYWNE</span></div><button type="button" class="physical-btn tablet-close active" id="tabletClose"><span>Zamknij</span><div class="led-indicator red"></div></button></header>
          <nav class="tablet-tabsbar" id="stationTabsBar"><button type="button" class="tab-arrow" id="tabPrev" title="Poprzednia zakładka">‹</button><div class="tablet-tabs" id="tabletTabs"><div class="screen-content" id="tabletTabTrack"></div><div class="selection-indicator"></div></div><button type="button" class="tab-arrow" id="tabNext" title="Następna zakładka">›</button></nav>
          <div class="tablet-screen" id="tabletScreen"><div class="screen-glare"></div><div class="tablet-pane active" id="stationPane"><slot name="station-panel"></slot></div><div class="mission-layout" id="missionPane" hidden><aside class="mission-sidebar"><div class="mission-filters" id="missionFilters"><button type="button" class="mission-filter active" data-filter="active">AKTYWNE</button><button type="button" class="mission-filter" data-filter="completed">UKOŃCZONE</button><button type="button" class="mission-filter" data-filter="all">WSZYSTKIE</button></div><div class="mission-list" id="missionList"></div></aside><section class="mission-detail" id="missionDetail"><div class="mission-empty">Wybierz wpis z dziennika misji.</div></section></div></div>
          <footer class="tablet-foot"><span id="tabletFootLeft">KREDYTY <b id="tabletCredits">0 CR</b></span><span id="tabletFootCenter">TERMINAL GOTOWY</span><span id="tabletFootRight">ŁADOWNIA <b id="tabletCargo">0 / 0</b></span></footer>
        </div>
      </section>
      <div class="support-tooltip" id="supportTooltip" hidden></div><div class="drag-ghost" id="dragGhost"></div><div class="deployment-reticle" id="deployReticle"></div><div class="toast-stack" id="toastStack"></div>
    </div>`;
}

export class CockpitUI {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.els = {};
    this.startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
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
    this.logs = [];
    this.cache = Object.create(null);
    this.lastRadarDraw = 0;
    this.lastListRefresh = 0;
    this.lastClockRefresh = 0;
    this.lastSpeed = 0;
    this.odometer = 0;
    this.trip = 0;
    this.lastUpdateAt = 0;
    this.lastStationOpen = false;
    this.lastStationTab = 'hangar';
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
    this.shadow.innerHTML = cockpitMarkup();
    this.cacheElements();
    this.mountStationContent();
    this.retireLegacyHud();
    this.buildHotkeys();
    this.buildRadarRanges();
    this.renderSupportRoster();
    this.bindControls();
    this.updateClock(true);
    this.log('Inicjalizacja systemów kokpitu — OK', 'ok');
    this.log('Łącze taktyczne gotowe. CapsLock otwiera terminal stacji.', 'orbit');
    window.CockpitUI = this;
    window.cockpitUI = this;
    return this;
  }

  cacheElements() {
    const ids = [
      'app', 'leftStack', 'rightStack', 'unitList', 'activeCount', 'supportOrders', 'supportFactions', 'reserveGrid',
      'scannerFilters', 'contactRows', 'contactCount', 'selBody', 'selKind', 'screenBezel', 'consoleStatus',
      'consoleLog', 'termClock', 'termDate', 'termLoc', 'termComm', 'commNet', 'commBody', 'commClose', 'hotkeyGrid',
      'radarCanvas', 'radarRanges', 'rdTotal', 'rdHostile', 'rdAst', 'rdRange', 'speedCanvas', 'spValue', 'spRpm', 'spMode',
      'spOdo', 'spTrip', 'thrPct', 'spState', 'spLimit', 'thrPlus', 'thrMinus', 'modeTrack', 'rotaryKnob',
      'pbComm', 'pbMissions', 'pbShip', 'pbMap', 'scScan', 'scLock', 'scAuto', 'scStab', 'navComm',
      'navMissions', 'navShip', 'navLog', 'stationTablet', 'tabletLabel', 'tabletTitle', 'tabletSub', 'tabletLinkText',
      'tabletClose', 'stationTabsBar', 'tabletTabs', 'tabletTabTrack', 'tabPrev', 'tabNext', 'stationPane', 'missionPane',
      'missionFilters', 'missionList', 'missionDetail', 'tabletCredits', 'tabletCargo', 'tabletFootLeft',
      'tabletFootCenter', 'tabletFootRight', 'supportTooltip', 'dragGhost', 'deployReticle', 'toastStack', 'vitalHp', 'vitalShield', 'vitalCore'
    ];
    for (const id of ids) this.els[id] = this.shadow.getElementById(id);
    this.radarCtx = this.els.radarCanvas?.getContext('2d') || null;
    this.speedCtx = this.els.speedCanvas?.getContext('2d') || null;
  }

  mountStationContent() {
    const stationHost = document.getElementById('hud-top-container');
    if (!stationHost) return;
    stationHost.slot = 'station-panel';
    stationHost.classList.add('cockpit-station-slot');
    this.host.appendChild(stationHost);
  }

  retireLegacyHud() {
    for (const id of ['side-panels-container', 'right-panels-container', 'hud-bottom-container', 'hud-topbar', 'ui', 'planet-radar', 'hover-info']) {
      document.getElementById(id)?.remove();
    }
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
    this.els.selBody?.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'lock') this.lockSelectedContact();
      if (action === 'uplink') this.openCommForStation(this.selectedContact?.entity);
    });

    this.els.pbComm?.addEventListener('click', () => this.toggleComm());
    this.els.navComm?.addEventListener('click', () => this.toggleComm());
    this.els.commClose?.addEventListener('click', () => this.closeComm());
    this.els.commBody?.addEventListener('click', event => {
      const connect = event.target.closest('[data-connect]');
      const service = event.target.closest('[data-service]');
      if (connect) this.connectStationById(connect.dataset.connect);
      if (service) this.openStationService(service.dataset.service);
    });

    this.els.pbMissions?.addEventListener('click', () => this.toggleMissionJournal());
    this.els.navMissions?.addEventListener('click', () => this.toggleMissionJournal());
    this.els.pbShip?.addEventListener('click', () => this.logShipStatus());
    this.els.navShip?.addEventListener('click', () => this.logShipStatus());
    this.els.navLog?.addEventListener('click', () => this.closeComm());
    this.els.pbMap?.addEventListener('click', () => this.dispatchGameKey('KeyM', 'm'));
    this.els.scScan?.addEventListener('click', () => this.dispatchGameKey('KeyX', 'x'));
    this.els.scLock?.addEventListener('click', () => this.lockSelectedContact());
    this.els.scAuto?.addEventListener('click', () => window.shipDriveControls?.toggleAuto?.());
    this.els.scStab?.addEventListener('click', () => this.dispatchGameKey('KeyB', 'b'));
    this.bindHoldButton(this.els.thrPlus, 'KeyW', 'w', 'active-w');
    this.bindHoldButton(this.els.thrMinus, 'KeyS', 's', 'active-s');
    this.bindKnob();

    this.els.radarRanges?.addEventListener('click', event => {
      const button = event.target.closest('[data-radar-range]');
      if (button) this.setRadarRange(Number(button.dataset.radarRange));
    });
    this.els.radarCanvas?.addEventListener('click', event => this.selectRadarContact(event));

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
      const current = window.shipDriveControls?.getState?.()?.mode || 'combat';
      const index = Math.max(0, MODE_ORDER.indexOf(current));
      const next = clamp(index + (event.deltaY > 0 ? 1 : -1), 0, MODE_ORDER.length - 1);
      this.setDriveMode(MODE_ORDER[next]);
    }, { passive: false });
  }

  bindHoldButton(button, code, key, activeClass) {
    if (!button) return;
    const down = event => {
      event.preventDefault();
      button.classList.add(activeClass);
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    };
    const up = event => {
      event.preventDefault();
      button.classList.remove(activeClass);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', event => { if (event.buttons) up(event); });
  }

  buildHotkeys() {
    const root = this.els.hotkeyGrid;
    if (!root) return;
    root.textContent = '';
    for (const definition of HOTKEYS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phys-btn';
      button.dataset.hotkey = definition.key;
      if (definition.type) button.dataset.weaponType = definition.type;
      const key = document.createElement('span');
      key.className = 'hk-key';
      key.textContent = definition.key;
      const icon = document.createElement('span');
      icon.className = 'hk-ico';
      icon.textContent = definition.icon;
      const label = document.createElement('span');
      label.className = 'hk-label';
      label.textContent = definition.label;
      const mask = document.createElement('span');
      mask.className = 'cooldown-mask';
      button.append(key, icon, label, mask);
      button.addEventListener('click', () => {
        if (definition.action === 'energy') window.triggerEnergyShot?.();
        else if (definition.code) this.dispatchGameKey(definition.code, definition.key.toLowerCase());
      });
      root.appendChild(button);
    }
  }

  updateHotkeys(weaponHud) {
    if (!weaponHud || !this.els.hotkeyGrid) return;
    for (const button of this.els.hotkeyGrid.querySelectorAll('[data-weapon-type]')) {
      const state = weaponHud[button.dataset.weaponType];
      const charge = clamp(state?.charge ?? 0, 0, 1);
      button.classList.toggle('unavailable', state ? !state.enabled : false);
      button.classList.toggle('cooling', charge < 0.995);
      const mask = button.querySelector('.cooldown-mask');
      if (mask) mask.style.height = `${Math.round((1 - charge) * 100)}%`;
      const label = button.querySelector('.hk-label');
      if (label && state?.weapon?.name) label.textContent = state.weapon.name;
    }
  }

  buildRadarRanges() {
    const root = this.els.radarRanges;
    if (!root) return;
    root.textContent = '';
    for (const range of RADAR_RANGES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'range-button hud-radar-range-btn';
      button.dataset.radarRange = String(range);
      button.setAttribute('aria-pressed', range === this.viewRange ? 'true' : 'false');
      button.textContent = `${range / 1000}K`;
      button.classList.toggle('active', range === this.viewRange);
      root.appendChild(button);
    }
  }

  setRadarRange(range) {
    if (!RADAR_RANGES.includes(range)) return;
    this.viewRange = range;
    for (const button of this.els.radarRanges?.querySelectorAll('[data-radar-range]') || []) {
      const active = Number(button.dataset.radarRange) === range;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    this.lastRadarDraw = 0;
  }

  getRadarRange() {
    return this.viewRange;
  }

  setDriveMode(mode) {
    const normalized = MODE_META[mode] ? mode : 'combat';
    window.shipDriveControls?.setMode?.(normalized);
    this.syncDriveMode(true, normalized);
  }

  syncDriveMode(force = false, explicitMode = null) {
    const state = window.shipDriveControls?.getState?.() || {};
    const mode = MODE_META[explicitMode] ? explicitMode : (MODE_META[state.mode] ? state.mode : 'combat');
    if (!force && this.cache.driveMode === mode) return;
    this.cache.driveMode = mode;
    const meta = MODE_META[mode];
    this.els.app.dataset.mode = meta.uiMode;
    if (this.els.rotaryKnob) this.els.rotaryKnob.style.transform = `rotate(${meta.angle}deg)`;
    for (const item of this.els.modeTrack?.querySelectorAll('[data-mode]') || []) {
      item.classList.toggle('active', item.dataset.mode === mode);
    }
    if (this.els.spMode) this.els.spMode.textContent = meta.gear;
  }

  dispatchGameKey(code, key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    requestAnimationFrame(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })));
  }

  update(ship, systems = {}, environment = {}) {
    if (!this.host) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.lastUpdateAt > 0 ? clamp((now - this.lastUpdateAt) / 1000, 0, 0.2) : 0;
    this.lastUpdateAt = now;
    const menuVisible = !document.getElementById('main-menu')?.classList.contains('hidden');
    this.host.toggleAttribute('hidden', menuVisible);
    if (menuVisible) return;

    this.radarModel = environment.radar || this.radarModel;
    this.updateVitals(ship, systems);
    this.updateSpeed(ship, systems, dt);
    this.updateHotkeys(environment.weaponHud);
    this.syncDriveMode();
    this.updateConsoleStatus(systems, environment);
    this.updateClock(now - this.lastClockRefresh > 1000, environment.locationName);
    this.updateRadar(now);
    this.syncTablet();

    if (now - this.lastListRefresh > 450) {
      this.lastListRefresh = now;
      this.renderActiveUnits();
      this.renderContacts();
      if (this.missionOpen) this.renderMissionJournal();
      if (this.commOpen) this.renderComm();
    }
  }

  updateVitals(ship, systems) {
    const hullMax = Math.max(1, Number(ship?.hull?.max) || 1);
    const hullVal = Math.max(0, Number(ship?.hull?.val) || 0);
    const shieldMax = Math.max(1, Number(ship?.shield?.max) || 1);
    const shieldVal = Math.max(0, Number(ship?.shield?.val) || 0);
    this.setVital(this.els.vitalHp, hullVal / hullMax, Math.round(hullVal));
    this.setVital(this.els.vitalShield, shieldVal / shieldMax, Math.round(shieldVal));
    this.setVital(this.els.vitalCore, clamp((systems.core ?? 100) / 100, 0, 1), Math.round(systems.core ?? 100));
  }

  setVital(root, ratio, value) {
    if (!root) return;
    const percent = Math.round(clamp(ratio, 0, 1) * 100);
    root.style.setProperty('--value', `${percent}%`);
    for (const fill of root.querySelectorAll('.vital-fill,.vital-ghost')) fill.style.setProperty('--value', `${percent}%`);
    const valueEl = root.querySelector('.vital-value');
    if (valueEl) valueEl.textContent = String(value);
    root.classList.toggle('crit', percent < 25);
  }

  updateSpeed(ship, systems, dt) {
    const speed = Math.hypot(Number(ship?.vel?.x) || 0, Number(ship?.vel?.y) || 0);
    const rpm = clamp(systems.driveRpm, 0, 1);
    this.odometer += speed * dt;
    this.trip += speed * dt;
    this.lastSpeed = speed;
    if (this.els.spValue) this.els.spValue.textContent = String(Math.round(speed));
    if (this.els.spRpm) this.els.spRpm.textContent = (rpm * 8).toFixed(1);
    if (this.els.spOdo) this.els.spOdo.textContent = `${Math.round(this.odometer).toLocaleString('pl-PL')} u`;
    if (this.els.spTrip) this.els.spTrip.textContent = `${Math.round(this.trip).toLocaleString('pl-PL')} u`;
    if (this.els.thrPct) this.els.thrPct.textContent = `${Math.round(clamp(systems.power, 0, 100))}%`;
    if (this.els.spLimit) this.els.spLimit.textContent = String(Math.round(Number(systems.driveSpeedLimit) || 0));
    if (this.els.spState) this.els.spState.textContent = systems.driveAuto ? 'AUTO' : systems.warpState === 'active' ? 'WARP' : 'REJS';
    this.els.scAuto?.classList.toggle('on', !!systems.driveAuto);
    this.drawSpeedGauge(speed, Number(systems.driveSpeedLimit) || Math.max(1, speed), rpm);
  }

  drawSpeedGauge(speed, limit, rpm) {
    const canvas = this.els.speedCanvas;
    const ctx = this.speedCtx;
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.clearRect(0, 0, width, height);
    const scale = Math.max(0.08, Math.min(height / 600, width / 1000));
    const cx = width / 2;
    const cy = height / 2;
    this.drawDriveGaugeArc(ctx, cx - 240 * scale, cy, scale, false, speed, limit, false);
    this.drawDriveGaugeArc(ctx, cx + 240 * scale, cy, scale, true, rpm, 1, true);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = Math.max(1, dpr * 0.7);
    ctx.beginPath();
    ctx.moveTo(cx - 74 * scale, cy - 170 * scale);
    ctx.lineTo(cx - 42 * scale, cy - 184 * scale);
    ctx.lineTo(cx + 42 * scale, cy - 184 * scale);
    ctx.lineTo(cx + 74 * scale, cy - 170 * scale);
    ctx.stroke();
    ctx.restore();
  }

  drawDriveGaugeArc(ctx, x, y, scale, flipped, value, maxValue, rpmGauge) {
    ctx.save();
    ctx.translate(x, y);
    if (flipped) ctx.scale(-1, 1);

    const radius = 250 * scale;
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 1.55;
    const angleRange = endAngle - startAngle;
    const progress = clamp(value / Math.max(0.0001, maxValue), 0, 1);
    const currentAngle = endAngle - progress * angleRange;
    const lineWidth = Math.max(2, 15 * scale);

    ctx.lineCap = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath();
    ctx.arc(0, 0, radius, startAngle, endAngle);
    ctx.stroke();

    const tickCount = rpmGauge ? 8 : 6;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,.38)';
    ctx.lineWidth = Math.max(1, 3 * scale);
    for (let index = 0; index <= tickCount; index += 1) {
      const angle = startAngle + (index / tickCount) * angleRange;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (radius - 16 * scale), Math.sin(angle) * (radius - 16 * scale));
      ctx.lineTo(Math.cos(angle) * (radius + 6 * scale), Math.sin(angle) * (radius + 6 * scale));
      ctx.stroke();
    }

    if (progress > 0.002) {
      const hot = rpmGauge && progress > 0.82;
      const gradient = ctx.createLinearGradient(0, -radius, 0, radius);
      gradient.addColorStop(0, hot ? '#ff2200' : '#ff7700');
      gradient.addColorStop(1, hot ? '#ff7700' : '#ff3300');
      ctx.lineCap = 'round';
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = gradient;
      ctx.shadowColor = hot ? '#ff2200' : '#ff6600';
      ctx.shadowBlur = Math.max(3, 18 * scale);
      ctx.beginPath();
      ctx.arc(0, 0, radius, currentAngle, endAngle);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(Math.cos(currentAngle) * radius, Math.sin(currentAngle) * radius, Math.max(2, 9 * scale), 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#ff6600';
      ctx.shadowBlur = Math.max(3, 12 * scale);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  updateConsoleStatus(systems, environment) {
    const mode = MODE_META[systems.driveMode]?.label || MODE_META[this.cache.driveMode]?.label || 'BOJOWY';
    const damper = window.flightAssist?.damper ? 'WŁ' : 'WYŁ';
    const stabilizer = window.flightAssist?.stabilizer ? 'WŁ' : 'WYŁ';
    const html = `<span>TRYB <b>${mode}</b></span><span>AUTO <b>${systems.driveAuto ? 'WŁ' : 'WYŁ'}</b></span><span>DAMPER <b>${damper}</b></span><span>STAB <b>${stabilizer}</b></span>`;
    if (this.cache.consoleStatus !== html && this.els.consoleStatus) {
      this.cache.consoleStatus = html;
      this.els.consoleStatus.innerHTML = html;
    }
    const location = environment.locationName || 'Przestrzeń międzyplanetarna';
    if (this.cache.location !== location && this.els.termLoc) {
      this.cache.location = location;
      this.els.termLoc.innerHTML = '<small>Pozycja</small>';
      this.els.termLoc.appendChild(document.createTextNode(location.toUpperCase()));
    }
  }

  updateClock(force = false, location = null) {
    if (!force) return;
    this.lastClockRefresh = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const now = new Date();
    if (this.els.termClock) this.els.termClock.textContent = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    if (this.els.termDate) this.els.termDate.textContent = now.toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase();
    if (location && this.els.termLoc) {
      this.els.termLoc.innerHTML = '<small>Pozycja</small>';
      this.els.termLoc.appendChild(document.createTextNode(String(location).toUpperCase()));
    }
  }

  updateRadar(now) {
    if (!this.radarCtx || !this.els.radarCanvas || now - this.lastRadarDraw < 66) return;
    this.lastRadarDraw = now;
    const canvas = this.els.radarCanvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    drawCicHudRadarSurface(this.radarCtx, width, height, this.radarModel, { range: this.viewRange });
    const counts = this.radarModel?.counts || {};
    if (this.els.rdTotal) this.els.rdTotal.textContent = `C:${String(Number(counts.total) || 0).padStart(2, '0')}`;
    if (this.els.rdHostile) this.els.rdHostile.textContent = `H:${String(Number(counts.hostile) || 0).padStart(2, '0')}`;
    if (this.els.rdAst) this.els.rdAst.textContent = `A:${String(Number(counts.asteroid) || 0).padStart(2, '0')}`;
    if (this.els.rdRange) this.els.rdRange.textContent = `${this.viewRange / 1000}K`;
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

  renderContacts(force = false) {
    const root = this.els.contactRows;
    if (!root) return;
    const contacts = this.getOverviewContacts();
    const visible = contacts.filter(contact => this.contactFilter === 'all' || contact.type === this.contactFilter).slice(0, 36);
    const key = `${this.contactFilter}|${visible.map(c => `${c.type}:${c.label}:${Math.round(c.distance / 100)}:${c.locked ? 1 : 0}`).join('|')}`;
    if (!force && this.cache.contactsKey === key) return;
    this.cache.contactsKey = key;
    root.textContent = '';
    const all = contacts;
    for (const contact of visible) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'contact-row';
      row.dataset.contactIndex = String(all.indexOf(contact));
      row.classList.toggle('selected', this.selectedContact?.entity === contact.entity);
      const code = document.createElement('span');
      code.className = `tone-${contact.type}`;
      code.textContent = contact.type === 'hostile' ? 'WRG' : contact.type === 'friendly' ? 'SOJ' : contact.type === 'station' ? 'STA' : 'AST';
      const name = document.createElement('span'); name.textContent = contact.label;
      const distance = document.createElement('span'); distance.className = 'dist-cell'; distance.textContent = formatDistance(contact.distance);
      const lock = document.createElement('span'); lock.className = 'lock-cell'; lock.textContent = contact.locked ? 'LCK' : '–';
      row.append(code, name, distance, lock);
      root.appendChild(row);
    }
    if (this.els.contactCount) this.els.contactCount.textContent = `${contacts.length} KONTAKTÓW`;
  }

  selectContact(contact) {
    this.selectedContact = contact;
    window.CockpitBridge?.selectTarget?.(contact.entity);
    this.renderSelectedContact();
    this.renderContacts(true);
  }

  renderSelectedContact() {
    const root = this.els.selBody;
    const contact = this.selectedContact;
    if (!root) return;
    root.textContent = '';
    if (!contact) {
      const empty = document.createElement('div'); empty.className = 'sel-empty'; empty.textContent = 'Brak wybranego obiektu.'; root.appendChild(empty); return;
    }
    if (this.els.selKind) this.els.selKind.textContent = contact.type.toUpperCase();
    const body = document.createElement('div'); body.className = 'sel-body';
    const name = document.createElement('div'); name.className = `sel-name tone-${contact.type}`; name.textContent = contact.label;
    const sub = document.createElement('div'); sub.className = 'sel-sub'; sub.textContent = `${contact.type} · ${formatDistance(contact.distance)} u`;
    const entity = contact.entity;
    const hull = Number(entity?.hp ?? entity?.hull?.val);
    const shield = Number(entity?.shield?.val);
    const grid = document.createElement('div'); grid.className = 'sel-grid';
    const hullRow = document.createElement('span'); hullRow.textContent = 'KADŁUB '; const hullVal = document.createElement('b'); hullVal.textContent = Number.isFinite(hull) ? Math.round(hull) : '—'; hullRow.appendChild(hullVal);
    const shieldRow = document.createElement('span'); shieldRow.textContent = 'TARCZA '; const shieldVal = document.createElement('b'); shieldVal.textContent = Number.isFinite(shield) ? Math.round(shield) : '—'; shieldRow.appendChild(shieldVal);
    grid.append(hullRow, shieldRow);
    const actions = document.createElement('div'); actions.className = 'sel-actions';
    if (contact.type !== 'station' && contact.type !== 'asteroid') {
      const lock = document.createElement('button'); lock.type = 'button'; lock.className = 'tech-button'; lock.dataset.action = 'lock'; lock.textContent = contact.locked ? 'NAMIERZONO' : 'NAMIERZ'; actions.appendChild(lock);
    }
    if (contact.type === 'station') {
      const uplink = document.createElement('button'); uplink.type = 'button'; uplink.className = 'tech-button'; uplink.dataset.action = 'uplink'; uplink.textContent = 'POŁĄCZ · UPLINK'; actions.appendChild(uplink);
    }
    body.append(name, sub, grid, actions); root.appendChild(body);
  }

  lockSelectedContact() {
    const entity = this.selectedContact?.entity;
    if (entity) window.CockpitBridge?.toggleLock?.(entity);
    else this.dispatchGameKey('KeyT', 't');
  }

  selectRadarContact(event) {
    const contacts = Array.isArray(this.radarModel?.contacts) ? this.radarModel.contacts : [];
    if (!contacts.length) return;
    const rect = this.els.radarCanvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    const ny = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
    let best = null;
    let bestScore = 0.004;
    for (const raw of contacts) {
      const dx = (Number(raw.dx) || 0) / (this.viewRange * 2) - nx;
      const dy = (Number(raw.dy) || 0) / (this.viewRange * 2) - ny;
      const score = dx * dx + dy * dy;
      if (score < bestScore) { bestScore = score; best = raw; }
    }
    if (best) this.selectContact({ entity: best.entity, type: best.isAsteroid ? 'asteroid' : best.friendly ? 'friendly' : 'hostile', label: getEntityLabel(best.entity, best.type), distance: Math.hypot(best.dx || 0, best.dy || 0), locked: !!best.locked, raw: best });
  }

  setSupportFaction(faction) {
    const normalized = SUPPORT_FACTIONS[faction] ? faction : 'terran';
    this.supportFaction = normalized;
    window.CockpitSupport?.setFaction?.(normalized);
    for (const button of this.els.supportFactions?.querySelectorAll('[data-key]') || []) button.classList.toggle('active', button.dataset.key === normalized);
    this.renderSupportRoster();
  }

  setSupportOrder(order) {
    const normalized = order === 'engage' ? 'engage' : order === 'hold' ? 'hold' : 'guard';
    window.CockpitSupport?.setOrder?.(normalized);
    for (const button of this.els.supportOrders?.querySelectorAll('[data-order]') || []) button.classList.toggle('active', button.dataset.order === normalized);
    this.log(`Rozkaz skrzydła: ${normalized.toUpperCase()}`, 'orbit');
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
      if (item.click) card.addEventListener('click', () => this.spawnSupport(item.key, null));
      else card.addEventListener('pointerdown', event => this.prepareSupportDrag(event, item, card));
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
      ['V-max', details.speed ? `${details.speed} u/s` : '—'],
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
    const width = 270;
    const height = 128;
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
      if (faction.mode === 'friendly') window.CockpitSupport?.setOrder?.('guard');
      this.toast(`${faction.label}: ${key} — call-in`, 'good');
      this.log(`Wsparcie ${faction.label}: przyzwano ${key}`, 'ok');
    }
  }

  renderActiveUnits() {
    const root = this.els.unitList;
    if (!root) return;
    const support = Array.isArray(window.SupportWing?.units) ? window.SupportWing.units : [];
    const units = support.map(entry => entry?.npc).filter(unit => unit && !unit.dead);
    const key = units.map(unit => `${unit.id || unit.type}:${Math.round(unit.hp || 0)}:${Math.round(unit.shield?.val || 0)}`).join('|');
    if (this.cache.unitsKey === key) return;
    this.cache.unitsKey = key;
    root.textContent = '';
    if (!units.length) {
      const empty = document.createElement('div'); empty.className = 'unit-empty'; empty.textContent = 'Brak przyzwanych jednostek. Przeciągnij wsparcie na mapę lub radar.'; root.appendChild(empty);
    }
    for (const unit of units.slice(0, 24)) {
      const card = document.createElement('div'); card.className = 'unit-card';
      const portrait = document.createElement('span'); portrait.className = 'unit-portrait'; portrait.innerHTML = shipSilhouette(unit.fighter ? 'fighter' : String(unit.type || '').includes('destroyer') ? 'destroyer' : String(unit.type || '').includes('battleship') ? 'battleship' : 'frigate');
      const info = document.createElement('span'); info.className = 'unit-info';
      const name = document.createElement('span'); name.className = 'unit-name'; name.textContent = getEntityLabel(unit, 'Jednostka');
      const meta = document.createElement('span'); meta.className = 'unit-meta'; meta.textContent = `${unit.type || 'wsparcie'} · ${window.SupportWing?.order || 'guard'}`;
      const bars = document.createElement('span'); bars.className = 'unit-bars';
      const hp = clamp((Number(unit.hp) || 0) / Math.max(1, Number(unit.maxHp) || 1), 0, 1);
      const sh = clamp((Number(unit.shield?.val) || 0) / Math.max(1, Number(unit.shield?.max) || 1), 0, 1);
      bars.innerHTML = `<span class="micro-bar"><span style="--value:${Math.round(hp * 100)}%;--bar-color:#ff6600"></span></span><span class="micro-bar"><span style="--value:${Math.round(sh * 100)}%;--bar-color:#0088ff"></span></span>`;
      info.append(name, meta, bars);
      const distance = document.createElement('span'); distance.className = 'unit-distance';
      const pos = getEntityPosition(unit); distance.textContent = window.ship?.pos ? formatDistance(Math.hypot(pos.x - window.ship.pos.x, pos.y - window.ship.pos.y)) : '—';
      card.append(portrait, info, distance); root.appendChild(card);
    }
    if (this.els.activeCount) this.els.activeCount.textContent = `${units.length} JEDN.`;
  }

  toggleComm(force = null) {
    if (window.stationUI?.open || this.missionOpen) return false;
    const open = force == null ? !this.commOpen : !!force;
    if (!open) { this.closeComm(); return false; }
    this.commOpen = true;
    this.commBootUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 1200;
    this.commDirectory = this.getStationDirectory();
    this.els.screenBezel?.classList.add('comm-active');
    this.els.pbComm?.classList.add('active');
    this.els.navComm?.classList.add('active');
    this.renderComm();
    this.log('Uplink: skanowanie lokalnych węzłów stacji…', 'orbit');
    return true;
  }

  closeComm() {
    if (!this.commOpen) return;
    this.commOpen = false;
    window.closeStationTerminal?.();
    this.els.screenBezel?.classList.remove('comm-active');
    this.els.pbComm?.classList.remove('active');
    this.els.navComm?.classList.remove('active');
    this.els.navLog?.classList.add('active');
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
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
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
    if (this.els.commNet) this.els.commNet.textContent = `${this.commDirectory.length} WĘZŁÓW`;
    const intro = document.createElement('div'); intro.className = 'term-text'; intro.textContent = '> LOCAL NETWORK NODES FOUND:'; root.appendChild(intro);
    if (!this.commDirectory.length) {
      const empty = document.createElement('div'); empty.className = 'term-text'; empty.textContent = 'NO SIGNAL DETECTED'; root.appendChild(empty); return;
    }
    for (const [entryIndex, { station, distance }] of this.commDirectory.entries()) {
      const row = document.createElement('div'); row.className = 'term-row';
      const target = document.createElement('span'); target.className = 'term-target'; target.textContent = `[${station.id ?? 'STA'}] ${getEntityLabel(station, 'Stacja')} — ${formatDistance(distance)} u`;
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
    if (mission.pos && mission.status === 'active') { const map = document.createElement('button'); map.type = 'button'; map.className = 'physical-btn'; map.textContent = 'Pokaż na mapie'; map.addEventListener('click', () => { this.closeMissionJournal(); this.dispatchGameKey('KeyM', 'm'); }); actions.appendChild(map); }
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

  logShipStatus() {
    const ship = window.ship;
    if (!ship) return;
    this.log(`STATEK — HP ${Math.round(ship.hull?.val || 0)}/${Math.round(ship.hull?.max || 0)} · TARCZA ${Math.round(ship.shield?.val || 0)}/${Math.round(ship.shield?.max || 0)}`, 'ok');
  }

  log(message, tone = '') {
    const text = String(message || '').trim();
    if (!text) return;
    const elapsed = Math.floor(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.startedAt) / 1000);
    const timestamp = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    this.logs.push({ text, tone, timestamp });
    if (this.logs.length > 80) this.logs.splice(0, this.logs.length - 80);
    const root = this.els.consoleLog;
    if (!root) return;
    const line = document.createElement('span'); line.className = `console-line ${tone}`.trim();
    const time = document.createElement('span'); time.className = 'ts'; time.textContent = `[${timestamp}]`;
    line.append(time, document.createTextNode(text)); root.appendChild(line);
    while (root.children.length > 80) root.firstElementChild?.remove();
    root.scrollTop = root.scrollHeight;
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
    const root = this.els.toastStack;
    if (!root) return;
    const item = document.createElement('div'); item.className = `toast ${tone}`.trim(); item.textContent = String(message || ''); root.appendChild(item);
    while (root.children.length > 4) root.firstElementChild?.remove();
    setTimeout(() => item.remove(), 3100);
  }
}
