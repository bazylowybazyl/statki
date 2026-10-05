// Sceny pokazu dema mostków (klawisze 1–6). Każda: ustawienie (okręty, działo, kamera) i oś czasu
// w czasie symulacji (`tick(D, t, dt)` — D: demo: świat, działo, kamera, pomocnicze), opcjonalnie
// pętla. Strzały idą zwykłą ścieżką trafień gry (krater, mapa ran, noteBridgeHit); mostek pada
// z logiki (shipBridgeBeams.js), agonia i wrak — jak w grze.

// Kolejka kadłubów sceny „utrata dowodzenia” (od dużych do małych; Atlas ma własną scenę).
export const KILL_ORDER = ['battleship', 'pirate_battleship', 'terran_supercapital', 'destroyer', 'pirate_destroyer',
  'terran_carrier', 'pirate_supercapital', 'megafreighter', 'frigate', 'pirate_frigate'];

// Broń do kopania tunelu wg wielkości kadłuba. Lekkie działa (działko, railgun Mk II) na belkach
// tylko wgniatają blachę — tunel kopie ciężka broń z kraterem na miarę rany (pomiar w demie:
// Bellator — armata 23 strzały / ~7 s, Valkyrie ~6 s, Yamato ~3 s).
function weaponFor(len) {
  return len < 900 ? 'armata_mk1' : 'special_valkyrie_railgun';
}

// Działo z boku (burta), w odległości ~1,6 długości kadłuba od mostka.
function placeGunBeside(D, e, side = 1) {
  const p = D.bridgeCenter(e, 0);
  const len = D.hullLength(e);
  const a = (e.angle || 0) + side * Math.PI * 0.5;
  D.gun.place(p.x + Math.cos(a) * len * 0.9, p.y + Math.sin(a) * len * 0.9);
  D.gun.weaponId = weaponFor(len);
  D.gun.rateMul = 0.12;
}

export const SCENES = {
  kill: {
    title: 'Utrata dowodzenia',
    hint: 'Ostrzał z burty z namiarem na mostek (tryb „wyrwa”): tunel → wyrwy w modelu → mostek pada → agonia (wyrzut atmosfery, przepięcia, okna gasną falą, dysze się dławią, światła pozycyjne gasną) → wrak bez wybuchu.',
    start(D, run) {
      const key = D.hullPick() || KILL_ORDER[run % KILL_ORDER.length];
      const e = D.world.add(key, { x: 0, y: 0, angle: -0.12, vx: 6, vy: -2 });
      D.state.target = e;
      placeGunBeside(D, e, 1);
      D.fitOn(e, 'auto');
      D.setSceneTitle(`Utrata dowodzenia — ${e.__label}`);
    },
    tick(D, t) {
      const e = D.state.target;
      if (t >= 0.6 && !D.state.lost) D.fireAtBridge(e);
      if (!D.state.lost && e.bridgeState?.commandLost) { D.state.lost = t; D.focusBridge(e, null, 1.2); }
      if (D.state.lost && !D.state.doneAt && e.dead) D.state.doneAt = t;
      if ((D.state.doneAt && t > D.state.doneAt + 2.2) || t > 40) D.nextRun();
    }
  },
  atlas: {
    title: 'Atlas: mostek zapasowy',
    hint: 'Atlas ma dwa mostki — rufowy i zapasowy na dziobie. Pierwszy pada, okna gasną jego falą, dowodzenie przejmuje zapasowy; dopiero utrata obu zabija okręt.',
    start(D) {
      const e = D.world.add('atlas', { x: 0, y: 0, angle: 0.05 });
      D.state.target = e;
      D.state.phase = 0;
      const p = D.bridgeCenter(e, 0);
      D.gun.place(p.x, p.y + 900);
      D.gun.weaponId = 'special_valkyrie_railgun';
      D.gun.rateMul = 0.12;
      D.fitOn(e, 'auto');
    },
    tick(D, t) {
      const e = D.state.target;
      const st = e.bridgeState;
      if (!st) { if (t > 30) D.nextRun(); return; }
      if (D.state.phase === 0 && st.bridges[0].dead) {
        D.state.phase = 1;
        D.state.phase1At = t;
        const p = D.bridgeCenter(e, 1);
        D.gun.place(p.x, p.y + 700);
      }
      if (t >= 0.6 && !st.commandLost) {
        if (D.state.phase === 0) D.fireAtBridge(e, st.bridges[0].id);
        else if (t > D.state.phase1At + 1.6) D.fireAtBridge(e, st.bridges[1].id);
      }
      if (st.commandLost && !D.state.doneAt) D.state.doneAt = t;
      if ((D.state.doneAt && t > D.state.doneAt + 6.5) || t > 60) D.nextRun();
    }
  },
  sever: {
    title: 'Odcięcie mostka (Hexlance)',
    hint: 'Rzaz z pędem w poprzek kadłuba przed nadbudówką: rufa z mostkiem odlatuje jako odłam — kadłub-matka traci dowodzenie, a model mostka zostaje na odłamie bez zasilania.',
    start(D, run) {
      const key = ['battleship', 'pirate_battleship', 'terran_carrier', 'pirate_supercapital'][run % 4];
      const e = D.world.add(key, { x: 0, y: 0, angle: 0.08 });
      D.state.target = e;
      D.fitOn(e, 'auto');
      D.setSceneTitle(`Odcięcie mostka — ${e.__label}`);
    },
    tick(D, t) {
      const e = D.state.target;
      if (D.once('lance', t >= 0.9)) D.severBridge(e);
      if (t > 9.5) D.nextRun();
    }
  },
  fleet: {
    title: 'Flota: wszystkie mostki',
    hint: 'Jedenaście kadłubów z modelami 3D mostków (Terra Nova, piraci, Atlas, lokomotywa). Co chwilę pada mostek kolejnego okrętu — agonie obok siebie w skali bitwy.',
    start(D) {
      const keys = ['atlas', 'megafreighter', 'terran_supercapital', 'pirate_supercapital', 'terran_carrier',
        'battleship', 'pirate_battleship', 'destroyer', 'pirate_destroyer', 'frigate', 'pirate_frigate'];
      const rows = [[0, 1, 2], [3, 4, 5, 6], [7, 8, 9, 10]];
      const rowY = [-1100, 300, 1100];
      const gapX = [3600, 2400, 900];
      D.state.ships = [];
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let i = 0; i < row.length; i++) {
          const x = (i - (row.length - 1) * 0.5) * gapX[r];
          D.state.ships.push(D.world.add(keys[row[i]], { x, y: rowY[r], angle: 0 }));
        }
      }
      D.state.next = 0;
      D.setCamera(0, 0, 0.13);
    },
    tick(D, t) {
      const ships = D.state.ships;
      const k = Math.floor((t - 1.5) / 1.1);
      if (k >= 0 && k < ships.length && D.once(`kill${k}`, true)) D.killBridge(ships[ships.length - 1 - k]);
      if (t > 1.5 + ships.length * 1.1 + 6) D.nextRun();
    }
  },
  close: {
    title: 'Zbliżenie: wyrwy w modelu',
    hint: 'Iron Skull z bliska, czas ×0,4: wyrwy w modelu idą po komórkach kadłuba (poszarpany, przypalony brzeg, żar świeżego cięcia), okna nad wybitymi komórkami gasną błyskiem pomieszczenia.',
    start(D, run) {
      const key = ['pirate_battleship', 'battleship', 'terran_supercapital'][run % 3];
      const e = D.world.add(key, { x: 0, y: 0, angle: 0.15 });
      D.state.target = e;
      placeGunBeside(D, e, -1);
      D.gun.weaponId = 'heavy_autocannon';
      D.focusBridge(e, 1.7);
      D.setTimeScale(0.4);
    },
    tick(D, t) {
      const e = D.state.target;
      if (D.once('open', t >= 0.3)) {
        // Działo na osi kanału, za jego wylotem — pociski idą kanałem prosto w nadbudówkę.
        const ch = D.openToBridge(e, -1);
        if (ch) D.gun.place(ch.ax + (ch.ax - ch.bx) * 1.5, ch.ay + (ch.ay - ch.by) * 1.5);
        D.state.channel = ch;
      }
      // Wiertło: co 0,3 s mały krater w komórce mostka najbliższej działu (wyrwa poszerza się
      // od kanału; komórki znikają z modelu po kolei z poszarpanym, przypalonym brzegiem).
      if (t >= 0.8 && !e.bridgeState?.commandLost && t >= (D.state.nextDrill || 0)) {
        D.state.nextDrill = t + 0.3;
        D.drillBridge(e, D.state.channel);
      }
      if (e.bridgeState?.commandLost && !D.state.doneAt) D.state.doneAt = t;
      if ((D.state.doneAt && t > D.state.doneAt + 4.6) || t > 45) D.nextRun();
    },
    end(D) { D.setTimeScale(1); }
  },
  range: {
    title: 'Strzelnica',
    hint: 'LPM — strzał w kursor (albo w mostek: T — namiar), 1–5 broń, G — ogień ciągły, X — Hexlance od działa przez kursor, PPM — działo w kursor.',
    start(D) {
      const key = D.hullPick() || 'battleship';
      const e = D.world.add(key, { x: 0, y: 0, angle: -0.1 });
      D.state.target = e;
      placeGunBeside(D, e, 1);
      D.gun.rateMul = 0.35;
      D.fitOn(e, 'auto');
    },
    tick() {}
  }
};
