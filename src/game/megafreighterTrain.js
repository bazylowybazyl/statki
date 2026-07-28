export const MEGAFREIGHTER_MODULE_LENGTH = 2760;
export const MEGAFREIGHTER_MODULE_SPACING = 2920;
export const MEGAFREIGHTER_COUPLER_ANCHOR = MEGAFREIGHTER_MODULE_SPACING * 0.5;
export const MEGAFREIGHTER_COUPLER_LENGTH = 0;
// Wagony prowadzi sztywna kinematyka =o= (stepMegafreighterTrainKinematics),
// więc głowa nie ciągnie przez sprzęgi żadnej dodatkowej bezwładności i nie
// potrzebuje asysty skrętu.
export const MEGAFREIGHTER_YAW_ASSIST = 1;
// Ile wagonów towarowych między lokomotywą a modułem ogonowym.
export const MEGAFREIGHTER_WAGON_COUNT = 6;
// Maksymalne zgięcie przegubu =o= (~82°, jak w symulacji referencyjnej).
// Ogranicznik zapobiega scyzorykowi i wjeżdżaniu modułów w siebie przy
// cofaniu/pchaniu składu.
export const MEGAFREIGHTER_MAX_PIVOT_ANGLE = Math.PI / 2.2;

const MEGAFREIGHTER_FRONT_SPRITE = new URL('../../assets/megafreighterfront.png', import.meta.url).href;
const MEGAFREIGHTER_WAGON_SPRITE = new URL('../../assets/megafreighterwagon.png', import.meta.url).href;
const MEGAFREIGHTER_BACK_SPRITE = new URL('../../assets/megafrieghterback.png', import.meta.url).href;

const MEGAFREIGHTER_FRONT_MODULE = Object.freeze({
  role: 'front',
  type: 'megafreighter_front',
  displayName: 'Megafreighter locomotive',
  spriteSrc: MEGAFREIGHTER_FRONT_SPRITE,
  hull: 160000,
  mass: 900000,
  radius: 760,
  renderWidth: MEGAFREIGHTER_MODULE_LENGTH,
  renderHeight: 1554
});

const MEGAFREIGHTER_WAGON_MODULE = Object.freeze({
  role: 'wagon',
  type: 'megafreighter_wagon',
  displayName: 'Megafreighter cargo wagon',
  spriteSrc: MEGAFREIGHTER_WAGON_SPRITE,
  hull: 120000,
  mass: 650000,
  radius: 760,
  renderWidth: MEGAFREIGHTER_MODULE_LENGTH,
  renderHeight: 1554
});

const MEGAFREIGHTER_BACK_MODULE = Object.freeze({
  role: 'back',
  type: 'megafreighter_back',
  displayName: 'Megafreighter rear module',
  // Existing asset keeps the historical filename typo; changing it would
  // invalidate old saves and cached URLs.
  spriteSrc: MEGAFREIGHTER_BACK_SPRITE,
  hull: 140000,
  mass: 780000,
  radius: 760,
  renderWidth: MEGAFREIGHTER_MODULE_LENGTH,
  renderHeight: 1554
});

export function getMegafreighterTrainModules(wagonCount = MEGAFREIGHTER_WAGON_COUNT) {
  const count = Math.max(0, wagonCount | 0);
  const modules = [Object.freeze({ ...MEGAFREIGHTER_FRONT_MODULE, offset: 0 })];
  for (let i = 0; i < count; i++) {
    modules.push(Object.freeze({
      ...MEGAFREIGHTER_WAGON_MODULE,
      offset: -MEGAFREIGHTER_MODULE_SPACING * (i + 1)
    }));
  }
  modules.push(Object.freeze({
    ...MEGAFREIGHTER_BACK_MODULE,
    offset: -MEGAFREIGHTER_MODULE_SPACING * (count + 1)
  }));
  return Object.freeze(modules);
}

export const MEGAFREIGHTER_TRAIN_MODULES = getMegafreighterTrainModules();

function wrapAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * Sztywna kinematyka przyczepy =o= (1:1 z symulacji referencyjnej):
 * każdy wagon celuje dziobem w zaczep poprzednika (tylna kotwica sprzęgu),
 * zgięcie przegubu jest ograniczone do ±maxPivotAngle, a środek wagonu jest
 * ustawiany DOKŁADNIE tak, by jego przednia kotwica leżała na zaczepie.
 * Wagony nie mają własnej dynamiki — vx/vy/angVel są raportowane z delty
 * kolejnych póz (dla pocisków, traili i destruktora), nie odwrotnie.
 *
 * modules[0] to głowa (statek gracza lub NPC) — tylko czytana. Martwy moduł
 * zrywa łańcuch: reszta składu przestaje być prowadzona (jedzie balistycznie).
 */
export function stepMegafreighterTrainKinematics(modules, dt, opts = {}) {
  if (!Array.isArray(modules) || modules.length < 2) return;
  const head = modules[0];
  if (!head || head.dead === true || head.removed === true) return;

  const anchor = Number.isFinite(Number(opts.anchor))
    ? Number(opts.anchor)
    : MEGAFREIGHTER_COUPLER_ANCHOR;
  const maxPivot = Number.isFinite(Number(opts.maxPivotAngle))
    ? Number(opts.maxPivotAngle)
    : MEGAFREIGHTER_MAX_PIVOT_ANGLE;
  const step = Number(dt);
  const invDt = step > 1e-9 ? 1 / step : 0;

  let leaderX = (head.pos && Number.isFinite(Number(head.pos.x))) ? Number(head.pos.x) : (Number(head.x) || 0);
  let leaderY = (head.pos && Number.isFinite(Number(head.pos.y))) ? Number(head.pos.y) : (Number(head.y) || 0);
  let leaderAngle = Number(head.angle) || 0;

  for (let i = 1; i < modules.length; i++) {
    const wagon = modules[i];
    if (!wagon || wagon.dead === true || wagon.removed === true) break;

    const hitchX = leaderX - Math.cos(leaderAngle) * anchor;
    const hitchY = leaderY - Math.sin(leaderAngle) * anchor;

    // Delta liczona względem poprzedniej pozy KINEMATYCZNEJ, nie surowego
    // x/y — pętla NPC dointegrowuje vx*dt przed tym krokiem i liczenie delty
    // z tego położenia dawałoby oscylujący odczyt prędkości.
    const prevX = Number.isFinite(wagon.__trainPrevX) ? wagon.__trainPrevX : (Number(wagon.x) || 0);
    const prevY = Number.isFinite(wagon.__trainPrevY) ? wagon.__trainPrevY : (Number(wagon.y) || 0);
    const prevAngle = Number.isFinite(wagon.__trainPrevAngle) ? wagon.__trainPrevAngle : (Number(wagon.angle) || 0);

    let dx = prevX - hitchX;
    let dy = prevY - hitchY;
    if ((dx * dx + dy * dy) < 1e-12) {
      dx = -Math.cos(prevAngle);
      dy = -Math.sin(prevAngle);
    }

    // Wagon celuje dziobem w zaczep, którym jest holowany.
    let angle = Math.atan2(-dy, -dx);
    const bend = wrapAngle(angle - leaderAngle);
    if (bend > maxPivot) angle = leaderAngle + maxPivot;
    else if (bend < -maxPivot) angle = leaderAngle - maxPivot;
    angle = wrapAngle(angle);

    const x = hitchX - Math.cos(angle) * anchor;
    const y = hitchY - Math.sin(angle) * anchor;

    wagon.x = x;
    wagon.y = y;
    wagon.angle = angle;
    if (invDt > 0) {
      wagon.vx = (x - prevX) * invDt;
      wagon.vy = (y - prevY) * invDt;
      wagon.angVel = wrapAngle(angle - prevAngle) * invDt;
    }
    wagon.__trainPrevX = x;
    wagon.__trainPrevY = y;
    wagon.__trainPrevAngle = angle;

    leaderX = x;
    leaderY = y;
    leaderAngle = angle;
  }
}

export function buildMegafreighterTrainLayout(origin, angle, out = [], modules = MEGAFREIGHTER_TRAIN_MODULES) {
  const ox = Number(origin?.x) || 0;
  const oy = Number(origin?.y) || 0;
  const heading = Number(angle) || 0;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  out.length = modules.length;

  for (let i = 0; i < modules.length; i++) {
    const module = modules[i];
    let pose = out[i];
    if (!pose) pose = out[i] = { x: 0, y: 0, angle: 0, module: null };
    pose.x = ox + cos * module.offset;
    pose.y = oy + sin * module.offset;
    pose.angle = heading;
    pose.module = module;
  }
  return out;
}

// Opcje sprzęgu impulsowego (TowConstraintSystem). Pociąg NIE używa ich już do
// prowadzenia wagonów — od trybu =o= robi to stepMegafreighterTrainKinematics.
// Zostają dla przyszłego trybu holowania liną i jako scenariusz testowy
// solvera punktowego.
export const MEGAFREIGHTER_COUPLER_OPTIONS = Object.freeze({
  constraintType: 'point',
  length: MEGAFREIGHTER_COUPLER_LENGTH,
  stiffness: 0.92,
  damping: 0.985,
  angularStiffness: 0,
  hingeFriction: 0.12,
  jointLimit: 0.61,
  limitStiffness: 0.5,
  maxTorque: 2.4e13,
  positionCorrection: 1,
  maxCorrectionSpeed: 100000,
  maxForce: Infinity,
  breakForce: Infinity,
  collideConnected: false
});

export function createMegafreighterCouplerOptions(index, overrides = null) {
  const options = {
    ...MEGAFREIGHTER_COUPLER_OPTIONS,
    localAnchorA: { x: -MEGAFREIGHTER_COUPLER_ANCHOR, y: 0 },
    localAnchorB: { x: MEGAFREIGHTER_COUPLER_ANCHOR, y: 0 },
    tag: `megafreighter-coupler-${index}`
  };
  if (overrides) Object.assign(options, overrides);
  return options;
}
