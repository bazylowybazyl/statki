// src/game/fighterLaunch.js
//
// Geometria startu myśliwców z hangarów: kolejność wyrzutni, wektor katapulty
// i sloty klina (chevron) wzdłuż burty. Czyste funkcje — bez dostępu do stanu
// gry — żeby dało się to przetestować i użyć zarówno dla gracza, jak i dla
// nosicieli NPC.
//
// Układ lokalny kadłuba: +x = dziób, +y = prawa burta.

export const FIGHTER_LAUNCH = Object.freeze({
  INTERVAL: 0.26,       // odstęp startów z JEDNEJ wyrzutni [s]
  SPEED: 620,           // impuls katapulty [u/s]
  FORWARD: 0.35,        // jaka część impulsu idzie do przodu
  CHEVRON_ROW_GAP: 210, // krok wzdłuż kadłuba między rzędami klina
  CHEVRON_WING_GAP: 130,// krok w bok między skrzydłowymi
  CHEVRON_STANDOFF: 340,// prześwit od burty do klina
  CHEVRON_GAP: 220,     // odstęp między kolejnymi klinami tej samej burty
  MIN_CLEARANCE: 40     // minimalne wysunięcie punktu startu poza hardpoint
});

/**
 * Porządkuje wyrzutnie: od dziobu do rufy, i nadaje każdej `sideRank` — numer
 * w obrębie własnej burty. sideRank decyduje, jak daleko z tyłu stoi klin danej
 * wyrzutni, żeby eskadry z kilku hangarów tej samej burty się nie nakładały.
 *
 * @param {Array<{local:{x:number,y:number}}>} tubes
 */
export function orderHangarTubes(tubes) {
  const out = tubes.filter(t => t && t.local && Number.isFinite(t.local.x) && Number.isFinite(t.local.y));
  for (const tube of out) {
    if (tube.side !== 1 && tube.side !== -1) tube.side = tube.local.y >= 0 ? 1 : -1;
  }
  out.sort((a, b) => (b.local.x - a.local.x) || (a.local.y - b.local.y));
  let portRank = 0;
  let starboardRank = 0;
  for (const tube of out) {
    tube.sideRank = tube.side === 1 ? starboardRank++ : portRank++;
  }
  return out;
}

/**
 * Slot w klinie zakotwiczonym wzdłuż burty. Slot 0 to dziób klina, kolejne
 * schodzą parami do tyłu i na boki.
 */
export function chevronFormationOffset(sideRank, side, slot, squadSize, halfBeam, cfg = FIGHTER_LAUNCH) {
  const s = (side === 1 || side === -1) ? side : 1;
  const idx = Math.max(0, Math.floor(slot) || 0);
  const row = Math.ceil(idx / 2);
  const wing = (idx === 0) ? 0 : ((idx % 2 === 1) ? -1 : 1);
  const rows = Math.ceil(Math.max(0, (squadSize || 1) - 1) / 2);
  const chevronLen = rows * cfg.CHEVRON_ROW_GAP;
  const anchorX = -Math.max(0, sideRank || 0) * (chevronLen + cfg.CHEVRON_GAP);

  // Ramię wewnętrzne klina nie może wejść w obrys kadłuba. Zamiast rozdymać
  // prześwit pod najliczniejszą eskadrę, ŚCISKAMY krok do wewnątrz tak, żeby
  // ostatni rząd wypadł tuż przy burcie — klin robi się lekko asymetryczny,
  // ale zostaje zwarty i zawsze poza kadłubem, niezależnie od liczebności.
  const inwardBudget = Math.max(0, cfg.CHEVRON_STANDOFF - cfg.MIN_CLEARANCE);
  const inwardStep = rows > 0
    ? Math.min(cfg.CHEVRON_WING_GAP, inwardBudget / rows)
    : cfg.CHEVRON_WING_GAP;
  const step = (wing < 0) ? inwardStep : cfg.CHEVRON_WING_GAP;

  return {
    x: anchorX - row * cfg.CHEVRON_ROW_GAP,
    y: s * (halfBeam + cfg.CHEVRON_STANDOFF + wing * row * step)
  };
}

/**
 * Pozycja i prędkość wyrzutu z danej wyrzutni. Myśliwiec wychodzi BURTĄ:
 * normalna burty to lokalne (0, side) obrócone o kąt kadłuba.
 *
 * @returns {{x:number,y:number,vx:number,vy:number,angle:number,nx:number,ny:number}}
 */
export function computeLaunchVector(carrier, tube, halfBeam, cfg = FIGHTER_LAUNCH) {
  const angle = Number(carrier.angle) || 0;
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  const baseX = Number.isFinite(carrier.x) ? carrier.x : 0;
  const baseY = Number.isFinite(carrier.y) ? carrier.y : 0;
  const cvx = Number(carrier.vx) || 0;
  const cvy = Number(carrier.vy) || 0;

  const nx = -tube.side * s;
  const ny = tube.side * c;

  const clearance = Math.max(cfg.MIN_CLEARANCE, (halfBeam - Math.abs(tube.local.y)) * 0.75);
  const x = baseX + (tube.local.x * c - tube.local.y * s) + nx * clearance;
  const y = baseY + (tube.local.x * s + tube.local.y * c) + ny * clearance;

  const vx = cvx + nx * cfg.SPEED + c * cfg.SPEED * cfg.FORWARD;
  const vy = cvy + ny * cfg.SPEED + s * cfg.SPEED * cfg.FORWARD;

  return { x, y, vx, vy, angle: Math.atan2(vy - cvy, vx - cvx), nx, ny };
}

/**
 * Rozpisuje salwę na wyrzutnie: każda pracuje RÓWNOLEGLE i wypuszcza pojedynczo
 * co INTERVAL. Zwraca listę zleceń z opóźnieniem startu.
 *
 * @param {Array} tubes         wyrzutnie (po orderHangarTubes)
 * @param {(tube:any)=>Array}   squadronsOf  co startuje z danej wyrzutni
 */
export function buildLaunchPlan(tubes, squadronsOf, cfg = FIGHTER_LAUNCH) {
  const plan = [];
  let globalIndex = 0;
  for (let ti = 0; ti < tubes.length; ti++) {
    const tube = tubes[ti];
    const squadrons = squadronsOf(tube) || [];
    let slotInTube = 0;
    for (let si = 0; si < squadrons.length; si++) {
      const squadron = squadrons[si];
      const count = Math.max(1, Number(squadron?.squadSize) || 1);
      for (let i = 0; i < count; i++) {
        plan.push({
          tube,
          tubeIndex: ti,
          squadron,
          squadronIndex: si,
          slotInTube,
          globalIndex: globalIndex++,
          // Faza między wyrzutniami rozbija wrażenie jednej zsynchronizowanej
          // salwy, ale musi zmieścić się PONIŻEJ jednego interwału — inaczej
          // pierwsza fala przestaje być "po jednym z każdego hangaru naraz".
          delay: slotInTube * cfg.INTERVAL + (tubes.length > 1 ? (ti / tubes.length) * cfg.INTERVAL * 0.5 : 0)
        });
        slotInTube++;
      }
    }
  }
  return plan;
}
