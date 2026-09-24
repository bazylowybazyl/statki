// src/ui/contactMarkers.js
// Taktyczne znaczniki kontaktów w przestrzeni 3D gry — widoczne gdy CIC jest zamknięte.
// Pokazuje wszystkie wykryte kontakty (GHOST+): naziemne klamry celownicze
// dla kontaktów na ekranie oraz strzałki na krawędzi ekranu dla tych poza widokiem.

const AWARENESS = { HIDDEN: 0, GHOST: 1, DETECTED: 2, TRACKED: 3 };

// Myśliwce zaśmiecają UI — nie pokazujemy ich w znacznikach
const FIGHTER_TYPES = new Set(['fighter', 'interceptor', 'drone']);
function isFighterClass(type) {
  return FIGHTER_TYPES.has(String(type || '').toLowerCase());
}

const MC = {
  minAwareness: 1, // GHOST
  colors: {
    hostile: '#ef4444',   // czerwony — kontakty wrogie
    ghost:   '#6b7280',   // szary   — utracone kontakty (ghost)
    station: '#f97316',   // pomarańczowy — stacja piracka
  },
  bracketDepth: 9,
  bracketMinSize: 18,
  capitalMult: 1.55,
  ghostAlpha: 0.40,
  edgeMargin: 36,
  onscreenThreshold: 56, // px od krawędzi — poniżej = "na ekranie"
  arrowSize: 13,
  arrowCapitalMult: 1.35,
  stackSpacing: 28,
  // Limity strzałek: w dużej bitwie każdy wróg poza kadrem dawał strzałkę
  // z etykietą, a stos przy krawędzi rósł w głąb ekranu. Najbliższe wygrywają,
  // nadmiar na krawędzi pokazuje licznik „+N”.
  maxArrows: 24,
  maxArrowsPerEdgeSlot: 3,
  pulseFreq: 2.4,
  font: '10px monospace',
  fontSmall: '9px monospace',
};

// ── Pomocnicze: zaciśnij punkt do krawędzi ekranu ──────────────────────────
function clampToEdgeInto(sx, sy, dx, dy, W, H, margin, out) {
  const left = margin, right = W - margin, top = margin, bottom = H - margin;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (right  - sx) / dx);
  else if (dx < 0) t = Math.min(t, (left   - sx) / dx);
  if (dy > 0) t = Math.min(t, (bottom - sy) / dy);
  else if (dy < 0) t = Math.min(t, (top    - sy) / dy);
  out.x = sx + dx * t;
  out.y = sy + dy * t;
  return out;
}

// Grupowanie strzałek przy tym samym odcinku krawędzi (klucz liczbowy, bez
// sklejania stringów na kontakt).
function edgeBucketKey(ex, ey, H) {
  const m = MC.edgeMargin, sp = MC.stackSpacing;
  if (ey <= m + 2)     return Math.round(ex / sp) * 4;
  if (ey >= H - m - 2) return Math.round(ex / sp) * 4 + 1;
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
    c = { x: 0, y: 0, radius: 0, awareness: 0, isGhost: false, isCapital: false, isStation: false, type: '', sx: 0, sy: 0, dist: 0 };
    _contactPool.push(c);
  }
  _contactPoolUsed++;
  return c;
}
const _bucketPool = [];
let _bucketPoolUsed = 0;
function acquireBucket(ex, ey, onTopBot, color) {
  let b = _bucketPool[_bucketPoolUsed];
  if (!b) { b = { x: 0, y: 0, onTopBot: false, color: '', count: 0, drawn: 0, hidden: 0 }; _bucketPool.push(b); }
  _bucketPoolUsed++;
  b.x = ex; b.y = ey; b.onTopBot = onTopBot; b.color = color;
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

function contactColor(c) {
  return c.isStation ? MC.colors.station
       : c.isGhost  ? MC.colors.ghost
       : MC.colors.hostile;
}

// ── Klamry celownicze (4 rogi L-kształtne) ────────────────────────────────
function drawBrackets(ctx, cx, cy, gap, depth, isCapital) {
  const s = isCapital ? gap * MC.capitalMult : gap;
  const d = depth;
  ctx.beginPath();
  // lewy-górny
  ctx.moveTo(cx - s - d, cy - s); ctx.lineTo(cx - s, cy - s); ctx.lineTo(cx - s, cy - s + d);
  // prawy-górny
  ctx.moveTo(cx + s + d, cy - s); ctx.lineTo(cx + s, cy - s); ctx.lineTo(cx + s, cy - s + d);
  // lewy-dolny
  ctx.moveTo(cx - s - d, cy + s); ctx.lineTo(cx - s, cy + s); ctx.lineTo(cx - s, cy + s - d);
  // prawy-dolny
  ctx.moveTo(cx + s + d, cy + s); ctx.lineTo(cx + s, cy + s); ctx.lineTo(cx + s, cy + s - d);
  ctx.stroke();
}

// ── Ikona stacji (kwadrat + krzyż) ────────────────────────────────────────
function drawStationIcon(ctx, cx, cy) {
  const h = 7;
  ctx.beginPath();
  ctx.rect(cx - h, cy - h, h * 2, h * 2);
  ctx.moveTo(cx - h, cy); ctx.lineTo(cx + h, cy);
  ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy + h);
  ctx.stroke();
}

// ── Strzałka NATO-style (fill + stroke, podwójny chevron dla capitala) ───
function drawArrow(ctx, x, y, angle, size, color, variant, glowAlpha = 0) {
  // variant: 'ship' | 'capital' | 'station' | 'ghost'
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const s = variant === 'capital' ? size * MC.arrowCapitalMult : size;

  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (variant === 'station') {
    // Romb + krzyż — wyróżnia stację
    ctx.moveTo(s, 0);
    ctx.lineTo(0, s * 0.85);
    ctx.lineTo(-s, 0);
    ctx.lineTo(0, -s * 0.85);
  } else {
    // Chevron podstawowy — bardziej strzeliste proporcje
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.6,  s * 0.7);
    ctx.lineTo(-s * 0.25, 0);
    ctx.lineTo(-s * 0.6, -s * 0.7);
  }
  ctx.closePath();

  // Poświata szerszą, półprzezroczystą linią zamiast shadowBlur — rozmycie
  // cienia szło osobno na każdy fill i stroke każdej strzałki.
  if (glowAlpha > 0) {
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * glowAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.globalAlpha = prevAlpha;
  }

  ctx.fillStyle = color + '55';     // ~33% alpha fill
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.fill(); ctx.stroke();

  if (variant === 'station') {
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, 0); ctx.lineTo(s * 0.5, 0);
    ctx.moveTo(0, -s * 0.45); ctx.lineTo(0, s * 0.45);
    ctx.stroke();
  } else {
    // Capital: drugi chevron z tyłu (podwójny wskaźnik)
    if (variant === 'capital') {
      const off = -s * 0.75;
      ctx.beginPath();
      ctx.moveTo(s + off, 0);
      ctx.lineTo(-s * 0.6 + off,  s * 0.6);
      ctx.lineTo(-s * 0.25 + off, 0);
      ctx.lineTo(-s * 0.6 + off, -s * 0.6);
      ctx.closePath();
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ── Etykieta dystansu ─────────────────────────────────────────────────────
function fmtDist(wx, wy, shipX, shipY) {
  const d = Math.hypot(wx - shipX, wy - shipY);
  return d >= 10000 ? (d / 1000).toFixed(1) + 'k' : Math.round(d) + 'u';
}

// ── Skrót klasy statku (3-znakowy kod NATO-style) ────────────────────────
function typeAbbrev(c) {
  if (c.isStation) return 'STACJA';
  if (c.isCapital) return 'CAP';
  const t = String(c.type || '').toLowerCase();
  if (t.includes('battleship')) return 'BBS';
  if (t.includes('destroyer'))  return 'DES';
  if (t.includes('frigate'))    return 'FRG';
  if (t.includes('carrier'))    return 'CAR';
  if (t.includes('cruiser'))    return 'CRU';
  return (t.slice(0, 3).toUpperCase()) || '???';
}

// ── Tekst z ciemnym tłem (jedna linia) ───────────────────────────────────
function drawLabel(ctx, text, x, y, color, align = 'center') {
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const tw = ctx.measureText(text).width;
  const offX = align === 'center' ? -tw / 2 : align === 'right' ? -tw : 0;
  ctx.fillStyle = 'rgba(4,8,18,0.65)';
  ctx.fillRect(x + offX - 2, y - 1, tw + 4, 12);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ── Wielolinijkowy label z ramką w kolorze kontaktu ──────────────────────
function drawStackedLabel(ctx, lines, x, y, color, align = 'left') {
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const lineH = 11;
  const padX = 4, padY = 2;
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
  const bgW = maxW + padX * 2;
  const bgH = lines.length * lineH + padY * 2;
  const bgX = align === 'right'  ? x - bgW + padX
            : align === 'center' ? x - bgW / 2
            : x - padX;
  // tło
  ctx.fillStyle = 'rgba(4,8,18,0.78)';
  ctx.fillRect(bgX, y - padY, bgW, bgH);
  // ramka
  ctx.strokeStyle = color + '66';
  ctx.lineWidth = 1;
  ctx.strokeRect(bgX + 0.5, y - padY + 0.5, bgW - 1, bgH - 1);
  // tekst
  ctx.fillStyle = color;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineH);
  }
}

// ──────────────────────────────────────────────────────────────────────────

export const ContactMarkers = {

  draw(ctx, W, H, ship, SensorSystem, gameTime, camera, mercMission, drawOnscreen = true) {
    if (!ship || !SensorSystem) return;
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
        const c = acquireContact();
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
      if (inBounds) {
        if (drawOnscreen) onscreen.push(c);
      } else {
        c.dist = Math.hypot(c.x - shipX, c.y - shipY);
        offscreen.push(c);
      }
    }
    if (!onscreen.length && !offscreen.length) return;

    ctx.save();
    ctx.resetTransform();

    // ── RYSUJ KONTAKTY NA EKRANIE ────────────────────────────────────────

    if (drawOnscreen) {
      for (const c of onscreen) {
        const cx = c.sx, cy = c.sy;
        const alpha = c.isGhost ? MC.ghostAlpha : 1.0;
        const color = c.isStation ? MC.colors.station
                    : c.isGhost  ? MC.colors.ghost
                    : MC.colors.hostile;

        const gap = Math.max(MC.bracketMinSize, c.radius * camera.zoom + 4);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        if (c.isGhost) ctx.setLineDash([4, 3]);

        // Pulsujące świecenie dla wrogich TRACKED
        if (!c.isGhost && c.awareness === AWARENESS.TRACKED) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 6 + 3 * pulse;
        }

        drawBrackets(ctx, cx, cy, gap, MC.bracketDepth, c.isCapital || c.isStation);
        if (c.isStation) drawStationIcon(ctx, cx, cy);
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Etykieta dystansu (pod klamrami)
        const outerGap = (c.isCapital || c.isStation) ? gap * MC.capitalMult : gap;
        const labelY = cy + outerGap + MC.bracketDepth + 4;
        ctx.font = MC.fontSmall;
        drawLabel(ctx, fmtDist(c.x, c.y, shipX, shipY), cx, labelY, color, 'center');

        // Etykieta typu (nad klamrami) — tylko TRACKED
        if (c.awareness === AWARENESS.TRACKED) {
          const tlabel = c.isStation ? 'STACJA PIRATÓW'
                       : c.isCapital ? 'CAPITAL'
                       : c.type.toUpperCase();
          const labelY2 = cy - outerGap - MC.bracketDepth - 14;
          ctx.font = MC.font;
          drawLabel(ctx, tlabel, cx, labelY2, color, 'center');
        }

        ctx.restore();
      }
    }

    // ── RYSUJ STRZAŁKI NA KRAWĘDZI EKRANU ───────────────────────────────

    if (offscreen.length) {
      // Kolejność = priorytet przy limicie: najbliższe żywe kontakty dostają
      // strzałki pierwsze, dalekie duchy odpadają jako pierwsze.
      offscreen.sort(compareOffscreenContacts);
      const shipScr = wts(shipX, shipY, camera);
      const edgeBuckets = _edgeBuckets;
      edgeBuckets.clear();
      _bucketPoolUsed = 0;
      let drawn = 0;
      const glowAlpha = 0.28 + 0.12 * pulse;

      for (let k = 0; k < offscreen.length; k++) {
        const c = offscreen[k];
        const dx = c.sx - shipScr.x;
        const dy = c.sy - shipScr.y;
        if (dx === 0 && dy === 0) continue;
        const edgePt = clampToEdgeInto(shipScr.x, shipScr.y, dx, dy, W, H, MC.edgeMargin, _edgePt);
        const onTopBot = edgePt.y <= MC.edgeMargin + 3 || edgePt.y >= H - MC.edgeMargin - 3;
        const color = contactColor(c);

        const key = edgeBucketKey(edgePt.x, edgePt.y, H);
        let bucket = edgeBuckets.get(key);
        if (!bucket) {
          bucket = acquireBucket(edgePt.x, edgePt.y, onTopBot, color);
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
        const ax = edgePt.x + (onTopBot ? i * MC.stackSpacing : 0);
        const ay = edgePt.y + (onTopBot ? 0 : i * MC.stackSpacing);

        const variant = c.isStation ? 'station'
                      : c.isGhost  ? 'ghost'
                      : c.isCapital ? 'capital'
                      : 'ship';

        ctx.save();
        ctx.globalAlpha = c.isGhost ? MC.ghostAlpha : 1.0;
        if (c.isGhost) ctx.setLineDash([4, 3]);

        drawArrow(ctx, ax, ay, angle, MC.arrowSize, color, variant, c.isGhost ? 0 : glowAlpha);

        ctx.setLineDash([]);
        ctx.font = MC.fontSmall;

        // Label: typ + dystans, przesunięty prostopadle od strzałki
        const arrowRadius = variant === 'capital' ? MC.arrowSize * MC.arrowCapitalMult + 8
                                                   : MC.arrowSize + 6;
        const perpX = Math.cos(angle + Math.PI * 0.5) * arrowRadius;
        const perpY = Math.sin(angle + Math.PI * 0.5) * arrowRadius;
        const lx = ax + perpX;
        const ly = ay + perpY - 10;
        const lines = [typeAbbrev(c), fmtDist(c.x, c.y, shipX, shipY)];
        drawStackedLabel(ctx, lines, lx, ly, color, lx > ax ? 'left' : 'right');

        ctx.restore();
      }

      // Nadmiar przy krawędzi: licznik w miejscu następnej strzałki stosu.
      // Kontakty bez żadnej strzałki na swoim odcinku (limit globalny) to
      // najdalsze — przy 24 bliższych zagrożeniach ich nie pokazujemy.
      ctx.font = MC.fontSmall;
      for (const bucket of edgeBuckets.values()) {
        if (bucket.hidden <= 0 || bucket.drawn <= 0) continue;
        const lx = bucket.x + (bucket.onTopBot ? bucket.drawn * MC.stackSpacing : 0);
        const ly = bucket.y + (bucket.onTopBot ? 0 : bucket.drawn * MC.stackSpacing) - 6;
        drawLabel(ctx, '+' + bucket.hidden, lx, ly, bucket.color, 'center');
      }
    }

    ctx.restore();
  },
};
