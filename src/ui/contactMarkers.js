// src/ui/contactMarkers.js
// Taktyczne znaczniki kontaktów w przestrzeni gry — widoczne, gdy CIC jest zamknięte.
// Kontakty poza kadrem (GHOST+): grot przy krawędzi ekranu w stronę kontaktu, obok symbol śladu jak na
// radarze kokpitu (romb wroga, przerywany romb ducha, kwadrat z krzyżem stacji — src/ui/radar/radarSymbols.js)
// i odczyt: numer śladu z radaru + kod klasy („T07 DD”) oraz odległość („12,4 km”). Bez ramek i płytek —
// tekst z ciemnym obrysem jak odczyty kokpitu (przebudowa 2026-10-07; dawniej szewrony z ramkami „CAP 12.4k”).
// Kontakty w kadrze (drawOnscreen): narożniki celownika i ten sam odczyt.

import { RADAR_RGB, formatRadarDistance, radarClassCode } from './radar/radarConfig.js';
import { drawRadarSymbol, drawRadarText, radarColor, strokeRadarBrackets } from './radar/radarSymbols.js';

const AWARENESS = { HIDDEN: 0, GHOST: 1, DETECTED: 2, TRACKED: 3 };

// Myśliwce zaśmiecają UI — nie pokazujemy ich w znacznikach
const FIGHTER_TYPES = new Set(['fighter', 'interceptor', 'drone']);
function isFighterClass(type) {
  return FIGHTER_TYPES.has(String(type || '').toLowerCase());
}

const MC = {
  minAwareness: 1, // GHOST
  bracketMinSize: 18,
  capitalMult: 1.55,
  ghostAlpha: 0.45,
  edgeMargin: 36,
  onscreenThreshold: 56, // px od krawędzi — poniżej = "na ekranie"
  stackSpacing: 34,
  // Przy górnej / dolnej krawędzi odczyt leży nad / pod symbolem — sąsiedzi stosu dalej od siebie.
  stackSpacingTopBot: 58,
  // Limity znaczników: w dużej bitwie każdy wróg poza kadrem dawał znacznik
  // z etykietą, a stos przy krawędzi rósł w głąb ekranu. Najbliższe wygrywają,
  // nadmiar na krawędzi pokazuje licznik „+N”.
  maxArrows: 24,
  maxArrowsPerEdgeSlot: 3,
  pulseFreq: 2.4,
  font: '700 10px Consolas, "Courier New", monospace',
  fontSmall: '10px Consolas, "Courier New", monospace',
};

// ── Pomocnicze: zaciśnij punkt do krawędzi ekranu ──────────────────────────
function clampToEdgeInto(sx, sy, dx, dy, W, H, margin, out, bottomMargin = margin) {
  const left = margin, right = W - margin, top = margin, bottom = H - bottomMargin;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (right  - sx) / dx);
  else if (dx < 0) t = Math.min(t, (left   - sx) / dx);
  if (dy > 0) t = Math.min(t, (bottom - sy) / dy);
  else if (dy < 0) t = Math.min(t, (top    - sy) / dy);
  out.x = sx + dx * t;
  out.y = sy + dy * t;
  return out;
}

// Grupowanie znaczników przy tym samym odcinku krawędzi (klucz liczbowy, bez
// sklejania stringów na kontakt).
function edgeBucketKey(ex, ey, H, bottomMargin = MC.edgeMargin) {
  const m = MC.edgeMargin, sp = MC.stackSpacing;
  if (ey <= m + 2)     return Math.round(ex / sp) * 4;
  if (ey >= H - bottomMargin - 2) return Math.round(ex / sp) * 4 + 1;
  if (ex <= m + 2)     return Math.round(ey / sp) * 4 + 2;
  return Math.round(ey / sp) * 4 + 3;
}

// Pule rekordów — draw() przechodzi co klatkę po wszystkich wrogich kontaktach,
// więc świeże obiekty na kontakt to setki alokacji na klatkę w dużej bitwie.
const _contactPool = [];
let _contactPoolUsed = 0;
function acquireContact() {
  let c = _contactPool[_contactPoolUsed];
  if (!c) {
    c = { entity: null, x: 0, y: 0, radius: 0, awareness: 0, isGhost: false, isCapital: false, isStation: false, type: '', sx: 0, sy: 0, dist: 0 };
    _contactPool.push(c);
  }
  _contactPoolUsed++;
  c.entity = null;
  return c;
}
const _bucketPool = [];
let _bucketPoolUsed = 0;
function acquireBucket(ex, ey, onTopBot, rgb) {
  let b = _bucketPool[_bucketPoolUsed];
  if (!b) { b = { x: 0, y: 0, onTopBot: false, rgb: '', count: 0, drawn: 0, hidden: 0 }; _bucketPool.push(b); }
  _bucketPoolUsed++;
  b.x = ex; b.y = ey; b.onTopBot = onTopBot; b.rgb = rgb;
  b.count = 0; b.drawn = 0; b.hidden = 0;
  return b;
}
const _contacts = [];
const _onscreen = [];
const _offscreen = [];
const _edgeBuckets = new Map();
const _edgePt = { x: 0, y: 0 };

// Najpierw „żywe” kontakty, potem duchy; w obrębie — bliższe pierwsze.
function compareOffscreenContacts(a, b) {
  if (a.isGhost !== b.isGhost) return a.isGhost ? 1 : -1;
  return a.dist - b.dist;
}

function contactRgb(c) {
  return c.isStation ? RADAR_RGB.station
       : c.isGhost  ? RADAR_RGB.ghost
       : RADAR_RGB.hostile;
}

// Odczyt: numer śladu z radaru kokpitu (gdy jest) i kod klasy; duch — „?”.
function contactCode(c) {
  if (c.isStation) return 'ST';
  const cls = radarClassCode(c.type, { isCapitalShip: c.isCapital });
  if (c.isGhost) return `${cls} ?`;
  const no = c.entity ? (globalThis.window?.cockpitUI?.radar?.tracker?.tracks?.get(c.entity)?.no || 0) : 0;
  return no ? `T${no < 10 ? '0' + no : no} ${cls}` : cls;
}

// Grot przy krawędzi ekranu w stronę kontaktu (jeden obrót na znacznik).
function drawEdgeCaret(ctx, x, y, angle, rgb, alpha, capital) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const s = capital ? 1.25 : 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5 * s, -7 * s);
  ctx.lineTo(4 * s, 0);
  ctx.lineTo(-5 * s, 7 * s);
  if (capital) {
    ctx.moveTo(-10 * s, -6 * s);
    ctx.lineTo(-2 * s, 0);
    ctx.lineTo(-10 * s, 6 * s);
  }
  ctx.strokeStyle = radarColor(RADAR_RGB.outline, 0.6 * alpha);
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.strokeStyle = radarColor(rgb, alpha);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────────

export const ContactMarkers = {

  // layout: { bottom, skip(entity) } — dolny margines znaczników [px] (pasek broni i kopuła kokpitu przy dolnej
  // krawędzi); skip — byt ma własny znacznik (cele misji: missionTargetMarkers).
  draw(ctx, W, H, ship, SensorSystem, gameTime, camera, mercMission, drawOnscreen = true, layout = null) {
    if (!ship || !SensorSystem) return;
    const bottomMargin = Math.max(MC.edgeMargin, Number(layout?.bottom) || 0);
    const wts = window.worldToScreen;
    if (!wts) return;

    const shipX = ship.pos.x;
    const shipY = ship.pos.y;
    const pulse = Math.sin(gameTime * MC.pulseFreq * Math.PI * 2);

    // ── ZBIERZ KONTAKTY ─────────────────────────────────────────────────

    _contactPoolUsed = 0;
    const contacts = _contacts;
    contacts.length = 0;

    // 1. Żywe NPC (wrogie + wykryte)
    const npcs = window.npcs;
    if (Array.isArray(npcs)) {
      for (const npc of npcs) {
        if (!npc || npc.dead || npc.friendly) continue;
        const aw = npc._sensorAwareness || 0;
        if (aw < MC.minAwareness) continue;
        // Pomijamy myśliwce — zaśmiecają UI (capital nigdy nie jest fighter, safe check)
        if (!npc.isCapitalShip && isFighterClass(npc.type)) continue;
        if (layout?.skip?.(npc)) continue;
        const c = acquireContact();
        c.entity = npc;
        c.x = npc.x; c.y = npc.y;
        c.radius = npc.radius || npc.r || 14;
        c.awareness = aw;
        c.isGhost = false;
        c.isCapital = !!npc.isCapitalShip;
        c.isStation = false;
        c.type = npc.type || '';
        contacts.push(c);
      }
    }

    // 2. Ghost kontakty (ostatnia znana pozycja)
    for (const [, g] of SensorSystem.getGhosts()) {
      if (!g.isCapital && isFighterClass(g.type)) continue;
      const c = acquireContact();
      c.x = g.x; c.y = g.y;
      c.radius = g.radius || 14;
      c.awareness = AWARENESS.GHOST;
      c.isGhost = true;
      c.isCapital = !!g.isCapital;
      c.isStation = false;
      c.type = g.type || '';
      contacts.push(c);
    }

    // 3. Stacja piracka (nie jest w tablicy npcs)
    if (mercMission && mercMission.station && mercMission.station.hp > 0) {
      const st = mercMission.station;
      // Sprawdź czy jakakolwiek źródło sensorowe widzi stację
      const sources = SensorSystem.getSensorSources();
      let bestAw = 0;
      for (const src of sources) {
        const d = Math.hypot(st.x - src.x, st.y - src.y);
        const effectiveRange = src.range * 1.5; // stacje są duże
        if (d < effectiveRange * 0.75) { bestAw = AWARENESS.TRACKED; break; }
        if (d < effectiveRange)        bestAw = Math.max(bestAw, AWARENESS.DETECTED);
      }
      if (bestAw >= MC.minAwareness) {
        const c = acquireContact();
        c.entity = st;
        c.x = st.x; c.y = st.y;
        c.radius = st.r || st.baseR || 120;
        c.awareness = bestAw;
        c.isGhost = false;
        c.isCapital = false;
        c.isStation = true;
        c.type = 'station';
        contacts.push(c);
      }
    }

    if (!contacts.length) return;

    // ── PODZIEL NA EKRANIE / POZA EKRANEM ───────────────────────────────

    const thresh = MC.onscreenThreshold;
    const onscreen  = _onscreen;
    const offscreen = _offscreen;
    onscreen.length = 0;
    offscreen.length = 0;

    for (const c of contacts) {
      const scr = wts(c.x, c.y, camera);
      c.sx = scr.x;
      c.sy = scr.y;
      const inBounds = scr.x > thresh && scr.x < W - thresh
                    && scr.y > thresh && scr.y < H - thresh;
      c.dist = Math.hypot(c.x - shipX, c.y - shipY);
      if (inBounds) {
        if (drawOnscreen) onscreen.push(c);
      } else {
        offscreen.push(c);
      }
    }
    if (!onscreen.length && !offscreen.length) return;

    ctx.save();
    ctx.resetTransform();

    // ── KONTAKTY NA EKRANIE: narożniki celownika i odczyt ────────────────

    if (drawOnscreen) {
      for (const c of onscreen) {
        const alpha = c.isGhost ? MC.ghostAlpha : 0.9 + 0.1 * pulse;
        const rgb = contactRgb(c);
        const gap = Math.max(MC.bracketMinSize, c.radius * camera.zoom + 4) * ((c.isCapital || c.isStation) ? MC.capitalMult : 1);
        ctx.strokeStyle = radarColor(rgb, alpha);
        ctx.lineWidth = 1.5;
        if (c.isGhost) ctx.setLineDash([4, 3]);
        strokeRadarBrackets(ctx, c.sx, c.sy, gap, Math.max(6, gap * 0.4));
        ctx.setLineDash([]);
        ctx.font = MC.font;
        drawRadarText(ctx, contactCode(c), c.sx, c.sy - gap - 7, rgb, alpha, 'center', 'bottom');
        ctx.font = MC.fontSmall;
        drawRadarText(ctx, formatRadarDistance(c.dist), c.sx, c.sy + gap + 6, RADAR_RGB.label, alpha * 0.9, 'center', 'top');
      }
    }

    // ── ZNACZNIKI NA KRAWĘDZI EKRANU ─────────────────────────────────────

    if (offscreen.length) {
      // Kolejność = priorytet przy limicie: najbliższe żywe kontakty dostają
      // znaczniki pierwsze, dalekie duchy odpadają jako pierwsze.
      offscreen.sort(compareOffscreenContacts);
      const shipScr = wts(shipX, shipY, camera);
      const sx0 = shipScr.x;
      const sy0 = shipScr.y;
      const edgeBuckets = _edgeBuckets;
      edgeBuckets.clear();
      _bucketPoolUsed = 0;
      let drawn = 0;

      for (let k = 0; k < offscreen.length; k++) {
        const c = offscreen[k];
        const dx = c.sx - sx0;
        const dy = c.sy - sy0;
        if (dx === 0 && dy === 0) continue;
        const edgePt = clampToEdgeInto(sx0, sy0, dx, dy, W, H, MC.edgeMargin, _edgePt, bottomMargin);
        const onTop = edgePt.y <= MC.edgeMargin + 3;
        const onBottom = edgePt.y >= H - bottomMargin - 3;
        const onTopBot = onTop || onBottom;
        const rgb = contactRgb(c);

        const key = edgeBucketKey(edgePt.x, edgePt.y, H, bottomMargin);
        let bucket = edgeBuckets.get(key);
        if (!bucket) {
          bucket = acquireBucket(edgePt.x, edgePt.y, onTopBot, rgb);
          edgeBuckets.set(key, bucket);
        }
        const i = bucket.count++;
        if (i >= MC.maxArrowsPerEdgeSlot || drawn >= MC.maxArrows) {
          bucket.hidden++;
          continue;
        }
        drawn++;
        bucket.drawn++;

        const angle = Math.atan2(dy, dx);
        // Przesunięcie stosu: wzdłuż krawędzi
        const ax = edgePt.x + (onTopBot ? i * MC.stackSpacingTopBot : 0);
        const ay = edgePt.y + (onTopBot ? 0 : i * MC.stackSpacing);
        const alpha = c.isGhost ? MC.ghostAlpha : 1;

        drawEdgeCaret(ctx, ax, ay, angle, rgb, alpha, c.isCapital);

        // Symbol śladu (jak na radarze) od strony środka ekranu, prosto (bez obrotu).
        const ix = ax - Math.cos(angle) * 15;
        const iy = ay - Math.sin(angle) * 15;
        drawRadarSymbol(ctx, ix, iy, {
          kind: c.isStation ? 'station' : 'ship', aff: 'hostile', rgb,
          s: c.isStation ? 4.6 : (c.isCapital ? 4.8 : 3.8), alpha, fill: c.isGhost ? 0 : 0.25,
          dashed: c.isGhost, capital: c.isCapital, lw: 1.3
        });

        // Odczyt w stronę środka ekranu: przy bocznej krawędzi obok symbolu, przy górnej / dolnej — pod / nad
        // nim (stos idzie wzdłuż krawędzi, odczyty obok siebie wchodziłyby na sąsiadów).
        ctx.font = MC.font;
        const code = contactCode(c);
        const dist = formatRadarDistance(c.dist);
        if (onTop) {
          drawRadarText(ctx, code, ix, iy + 8, rgb, alpha, 'center', 'top');
          ctx.font = MC.fontSmall;
          drawRadarText(ctx, dist, ix, iy + 19, RADAR_RGB.label, alpha * 0.9, 'center', 'top');
        } else if (onBottom) {
          drawRadarText(ctx, code, ix, iy - 19, rgb, alpha, 'center', 'bottom');
          ctx.font = MC.fontSmall;
          drawRadarText(ctx, dist, ix, iy - 8, RADAR_RGB.label, alpha * 0.9, 'center', 'bottom');
        } else {
          const leftSide = ax < W / 2;
          const tx = ix + (leftSide ? 9 : -9);
          const align = leftSide ? 'left' : 'right';
          drawRadarText(ctx, code, tx, iy - 1, rgb, alpha, align, 'bottom');
          ctx.font = MC.fontSmall;
          drawRadarText(ctx, dist, tx, iy + 1, RADAR_RGB.label, alpha * 0.9, align, 'top');
        }
      }

      // Nadmiar przy krawędzi: licznik w miejscu następnego znacznika stosu.
      // Kontakty bez żadnego znacznika na swoim odcinku (limit globalny) to
      // najdalsze — przy 24 bliższych zagrożeniach ich nie pokazujemy.
      ctx.font = MC.font;
      for (const bucket of edgeBuckets.values()) {
        if (bucket.hidden <= 0 || bucket.drawn <= 0) continue;
        const lx = bucket.x + (bucket.onTopBot ? bucket.drawn * MC.stackSpacingTopBot : 0);
        const ly = bucket.y + (bucket.onTopBot ? 0 : bucket.drawn * MC.stackSpacing) - 6;
        drawRadarText(ctx, '+' + bucket.hidden, lx, ly, bucket.rgb, 0.9, 'center', 'middle');
      }
    }

    ctx.restore();
  },
};
