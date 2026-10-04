// Sceny pokazu dema rdzenia (klawisze 1–6). Każda: ustawienie (okręty, kamera) i oś czasu
// w czasie symulacji (`tick(D, t)` — D: demo: świat, kamera, broń, pomocnicze), opcjonalnie
// pętla (`loop` s — scena od nowa). Sceny odsłaniają komorę rzazem od burty (widać reaktor
// w wyrwie), wymuszają stopienie z wybranym wariantem i zostawiają resztę logice rdzenia.

export const VARIANTS = ['shatter', 'halves', 'thirds', 'hole', 'jet', 'orb'];
const GALLERY_HULLS = ['battleship', 'pirate_battleship', 'atlas'];
export const VARIANT_LABEL = Object.freeze({
  shatter: 'rozprysk', halves: 'przełamanie na pół', thirds: 'rozerwanie na trzy',
  hole: 'wyrwa bez rozpadu', jet: 'wyrzut strumienia plazmy', orb: 'kula plazmy'
});

export const SCENES = {
  gallery: {
    title: 'Galeria wybuchów',
    hint: 'Każdy wariant detonacji po kolei, na zmianę Terra Nova (błękit), piraci (czerwień) i Atlas (fiolet). V — wymuś wariant.',
    loop: 9.5,
    start(D, run) {
      const k = run % VARIANTS.length;
      const variant = D.variantPick() || VARIANTS[k];
      const hull = GALLERY_HULLS[run % GALLERY_HULLS.length];
      const e = D.world.add(hull, { x: 0, y: 0, angle: -0.12 + 0.05 * (run % 3) });
      D.state.variant = variant;
      D.state.target = e;
      D.world.exitAim = null;
      D.fitOn(e, hull === 'atlas' ? 0.3 : 0.52);
      D.setSceneTitle(`Galeria: ${VARIANT_LABEL[variant]}`);
    },
    tick(D, t) {
      const e = D.state.target;
      if (D.once('cut', t >= 0.35)) D.openChamber(e);
      if (D.once('melt', t >= 1.0)) D.meltdown(e, 2.6, D.state.variant);
    }
  },
  meltdown: {
    title: 'Stopienie z bliska',
    hint: 'Iron Skull: reaktor w wyrwie, języki plazmy, łuki po poszyciu, płyta nad komorą rozgrzewa się do bieli; na końcu implozja i rozprysk.',
    loop: 12,
    start(D) {
      const e = D.world.add('pirate_battleship', { x: 0, y: 0, angle: 0.18 });
      D.state.target = e;
      D.world.exitAim = null;
      D.focusCore(e, 1.35);
    },
    tick(D, t) {
      const e = D.state.target;
      if (D.once('cut', t >= 0.2)) D.openChamber(e);
      if (D.once('melt', t >= 1.2)) D.meltdown(e, 6.0, D.variantPick() || 'shatter');
      if (D.once('back', t >= 7.1)) D.fitOn(e, 0.42, 0.9);
    }
  },
  chain: {
    title: 'Łańcuch w formacji',
    hint: 'Wybuch A falą osłabia komory sąsiadów — przez dziury widać ich reaktory; ogniwo łańcucha detonuje słabiej.',
    loop: 14,
    start(D) {
      const w = D.world;
      const a = w.add('battleship', { x: 0, y: 0, angle: 0, label: 'Bellator A' });
      w.add('battleship', { x: -700, y: 0, angle: Math.PI, label: 'Bellator B' });
      w.add('pirate_battleship', { x: -300, y: 720, angle: 0.1, label: 'Iron Skull C' });
      w.add('pirate_battleship', { x: -300, y: -720, angle: -0.1, label: 'Iron Skull D' });
      D.state.target = a;
      w.exitAim = null;
      D.setCamera(-320, 0, 0.27);
    },
    tick(D, t) {
      const a = D.state.target;
      if (D.once('cut', t >= 0.3)) D.openChamber(a);
      if (D.once('melt', t >= 0.8)) D.meltdown(a, 2.2, D.variantPick() || 'shatter');
    }
  },
  jet: {
    title: 'Strumień plazmy tnie sąsiada',
    hint: 'Pole pęka z jednej strony: strumień wypala kanał i bije w Iron Skulla obok — rzaz z pędem, odrzut obraca wrak.',
    loop: 11,
    start(D) {
      const w = D.world;
      const a = w.add('battleship', { x: 0, y: 0, angle: 0.25, label: 'Bellator' });
      const b = w.add('pirate_battleship', { x: 1250, y: -120, angle: 1.35, label: 'Iron Skull' });
      D.state.target = a;
      w.exitAim = { x: b.x, y: b.y };
      D.setCamera(620, -40, 0.34);
    },
    tick(D, t) {
      const a = D.state.target;
      if (D.once('cut', t >= 0.3)) D.openChamber(a);
      if (D.once('melt', t >= 0.8)) D.meltdown(a, 2.0, 'jet');
    }
  },
  orb: {
    title: 'Kula plazmy przetapia sąsiada',
    hint: 'Torus wypada z komory jako kula: topi własny kadłub, którym wychodzi, potem wszystko na drodze — i wybucha po zapalniku.',
    loop: 12,
    start(D) {
      const w = D.world;
      const a = w.add('pirate_battleship', { x: 0, y: 0, angle: -0.2, label: 'Iron Skull' });
      const b = w.add('battleship', { x: 60, y: 820, angle: 0.1, label: 'Bellator' });
      D.state.target = a;
      w.exitAim = { x: b.x, y: b.y };
      D.setCamera(30, 420, 0.36);
    },
    tick(D, t) {
      const a = D.state.target;
      if (D.once('cut', t >= 0.3)) D.openChamber(a);
      if (D.once('melt', t >= 0.8)) D.meltdown(a, 1.8, 'orb');
    }
  },
  range: {
    title: 'Strzelnica — odsłoń rdzeń',
    hint: 'LPM strzela (z lockiem — w komorę). Wyrwa → ODSŁONIĘTY, osłona < 60% → KRYTYCZNY, ≤ 30% → STOPIENIE. K — kanał tnący.',
    loop: 0,
    start(D) {
      const e = D.world.add(D.hullPick(), { x: 0, y: 0, angle: 0 });
      D.state.target = e;
      D.world.exitAim = null;
      D.gun.place(0, 1300);
      D.setCamera(0, 420, 0.45);
    },
    tick() {}
  }
};
