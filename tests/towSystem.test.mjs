import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TowConstraintSystem,
  areTowBodiesCollisionDisabled
} from '../src/game/towSystem.js';
import {
  MEGAFREIGHTER_COUPLER_ANCHOR,
  MEGAFREIGHTER_COUPLER_LENGTH,
  MEGAFREIGHTER_MAX_PIVOT_ANGLE,
  MEGAFREIGHTER_MODULE_SPACING,
  MEGAFREIGHTER_TRAIN_MODULES,
  MEGAFREIGHTER_WAGON_COUNT,
  MEGAFREIGHTER_YAW_ASSIST,
  buildMegafreighterTrainLayout,
  createMegafreighterCouplerOptions,
  getMegafreighterTrainModules,
  stepMegafreighterTrainKinematics
} from '../src/game/megafreighterTrain.js';

function body(x, y, mass = 100) {
  return { x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass, radius: 5 };
}

test('tow rope remains slack and never pushes connected bodies', () => {
  const system = new TowConstraintSystem();
  const a = body(0, 0);
  const b = body(5, 0);
  system.attach(a, b, { length: 10 });

  system.update(1 / 120);

  assert.equal(a.vx, 0);
  assert.equal(b.vx, 0);
  assert.equal(a.x, 0);
  assert.equal(b.x, 5);
});

test('taut rope transfers velocity and closes excess distance for both rigid bodies', () => {
  const system = new TowConstraintSystem({ iterations: 4 });
  const a = body(0, 0, 100);
  const b = body(20, 0, 100);
  system.attach(a, b, {
    length: 10,
    stiffness: 0.3,
    damping: 0.9,
    positionCorrection: 0.2
  });

  system.update(1 / 120);

  assert.ok(a.vx > 0, `body A should be pulled right, vx=${a.vx}`);
  assert.ok(b.vx < 0, `body B should be pulled left, vx=${b.vx}`);
  assert.ok((b.x - a.x) < 20, 'position correction should reduce stretch');
  assert.ok(Math.abs(a.vx + b.vx) < 1e-9, 'equal masses should conserve linear momentum');
});

test('off-centre local anchor applies angular impulse', () => {
  const system = new TowConstraintSystem();
  const a = body(0, 0, 100);
  const b = body(30, 0, 100);
  system.attach(a, b, {
    length: 10,
    localAnchorA: { x: 0, y: 5 },
    localAnchorB: { x: 0, y: 0 },
    positionCorrection: 0
  });

  system.update(1 / 120);

  assert.ok(a.angVel < 0, `upper anchor pulled right should rotate clockwise, angVel=${a.angVel}`);
});

test('break force detaches an overloaded rope and calls onBreak once', () => {
  const system = new TowConstraintSystem();
  const a = body(0, 0, 1000);
  const b = body(100, 0, 1000);
  let breakCalls = 0;
  system.attach(a, b, {
    length: 1,
    breakForce: 10,
    onBreak: () => { breakCalls++; }
  });

  system.update(1 / 120);

  assert.equal(system.size, 0);
  assert.equal(breakCalls, 1);
});

test('connected-body collision exclusion exists only for lifetime of the coupler', () => {
  const system = new TowConstraintSystem();
  const a = body(0, 0);
  const b = body(20, 0);
  const rope = system.attach(a, b, { length: 10, collideConnected: false });

  assert.equal(areTowBodiesCollisionDisabled(a, b), true);
  assert.equal(areTowBodiesCollisionDisabled(b, a), true);
  system.detach(rope);
  assert.equal(areTowBodiesCollisionDisabled(a, b), false);
  assert.equal(areTowBodiesCollisionDisabled(b, a), false);
});

test('hard point coupler transfers braking without elastic slack', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = body(0, 0, 900000);
  const wagon = body(-20, 0, 650000);
  locomotive.vx = 0;
  wagon.vx = 100;
  system.attach(locomotive, wagon, {
    constraintType: 'point',
    localAnchorA: { x: -10, y: 0 },
    localAnchorB: { x: 10, y: 0 },
    stiffness: 0.92,
    damping: 0.985,
    positionCorrection: 0.88,
    maxCorrectionSpeed: 12000
  });

  system.update(1 / 120);

  assert.ok(locomotive.vx > 30, `locomotive should receive wagon momentum, vx=${locomotive.vx}`);
  assert.ok(wagon.vx < 60, `wagon should brake through the coupler, vx=${wagon.vx}`);
});

test('hard point coupler applies angular velocity to an articulated wagon', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = body(0, 0, 900000);
  const wagon = body(-20, 0, 650000);
  locomotive.angle = 0.12;
  system.attach(locomotive, wagon, {
    constraintType: 'point',
    localAnchorA: { x: -10, y: 0 },
    localAnchorB: { x: 10, y: 0 },
    stiffness: 0.92,
    damping: 0.985,
    angularStiffness: 0.24,
    angularDamping: 0.96,
    positionCorrection: 0.88,
    maxCorrectionSpeed: 12000
  });

  system.update(1 / 120);

  // The rotated locomotive's rear anchor sits below the axis, so the pin must
  // drag the wagon bow downward (negative spin). The magnitude is modest since
  // the Baumgarte bias is capped at gap-per-frame closing speed.
  assert.ok(wagon.angVel < -5e-4, `wagon should rotate toward the pin pull, angVel=${wagon.angVel}`);
});

test('all rigid modules and owned fragments in one train ignore self-collisions', () => {
  const head = { ...body(0, 0), towTrainId: 'train-a' };
  const tail = { ...body(-40, 0), towTrainId: 'train-a' };
  const fragment = { ...body(-20, 0), owner: tail };
  const foreign = { ...body(0, 40), towTrainId: 'train-b' };

  assert.equal(areTowBodiesCollisionDisabled(head, tail), true);
  assert.equal(areTowBodiesCollisionDisabled(head, fragment), true);
  assert.equal(areTowBodiesCollisionDisabled(head, foreign), false);
});

test('dead tow body is removed without touching the remaining body', () => {
  const system = new TowConstraintSystem();
  const a = body(0, 0);
  const b = body(20, 0);
  system.attach(a, b, { length: 10 });
  b.dead = true;

  system.update(1 / 120);

  assert.equal(system.size, 0);
  assert.equal(a.vx, 0);
});

test('megafreighter layout places head, wagons and back on one heading', () => {
  const layout = buildMegafreighterTrainLayout({ x: 100, y: 200 }, Math.PI / 2);

  assert.equal(layout.length, MEGAFREIGHTER_WAGON_COUNT + 2);
  assert.equal(MEGAFREIGHTER_TRAIN_MODULES[0].role, 'front');
  for (let i = 1; i <= MEGAFREIGHTER_WAGON_COUNT; i++) {
    assert.equal(MEGAFREIGHTER_TRAIN_MODULES[i].role, 'wagon');
  }
  assert.equal(MEGAFREIGHTER_TRAIN_MODULES[layout.length - 1].role, 'back');
  assert.ok(MEGAFREIGHTER_YAW_ASSIST >= 1);
  for (let i = 0; i < layout.length; i++) {
    assert.ok(Math.abs(layout[i].x - 100) < 1e-9);
    assert.ok(Math.abs(layout[i].y - (200 - MEGAFREIGHTER_MODULE_SPACING * i)) < 1e-9);
  }
});

test('getMegafreighterTrainModules builds a custom-length consist', () => {
  const modules = getMegafreighterTrainModules(3);

  assert.equal(modules.length, 5);
  assert.equal(modules[0].role, 'front');
  assert.equal(modules[1].role, 'wagon');
  assert.equal(modules[3].role, 'wagon');
  assert.equal(modules[4].role, 'back');
  for (let i = 0; i < modules.length; i++) {
    assert.ok(Math.abs(modules[i].offset + MEGAFREIGHTER_MODULE_SPACING * i) < 1e-9);
  }
});

function kinematicTrain(origin = { x: 0, y: 0 }, heading = 0) {
  return buildMegafreighterTrainLayout(origin, heading).map(pose => ({
    x: pose.x,
    y: pose.y,
    angle: pose.angle,
    vx: 0,
    vy: 0,
    angVel: 0
  }));
}

function frontAnchor(body) {
  return {
    x: body.x + Math.cos(body.angle) * MEGAFREIGHTER_COUPLER_ANCHOR,
    y: body.y + Math.sin(body.angle) * MEGAFREIGHTER_COUPLER_ANCHOR
  };
}

function rearHitch(body) {
  const bx = body.pos ? body.pos.x : body.x;
  const by = body.pos ? body.pos.y : body.y;
  return {
    x: bx - Math.cos(body.angle) * MEGAFREIGHTER_COUPLER_ANCHOR,
    y: by - Math.sin(body.angle) * MEGAFREIGHTER_COUPLER_ANCHOR
  };
}

test('kinematic =o= link keeps every wagon bow pinned to the leader hitch', () => {
  const modules = kinematicTrain();
  // Głowa jak statek gracza: pozycja w pos{}, nie w x/y.
  const head = { pos: { x: 0, y: 0 }, angle: 0 };
  modules[0] = head;

  const dt = 1 / 60;
  for (let f = 0; f < 120; f++) {
    head.angle += (f < 60 ? 0.006 : 0);
    head.pos.x += Math.cos(head.angle) * 4000 * dt;
    head.pos.y += Math.sin(head.angle) * 4000 * dt;
    stepMegafreighterTrainKinematics(modules, dt);

    for (let i = 1; i < modules.length; i++) {
      const hitch = rearHitch(modules[i - 1]);
      const bow = frontAnchor(modules[i]);
      const error = Math.hypot(bow.x - hitch.x, bow.y - hitch.y);
      assert.ok(error < 1e-6, `link ${i} must stay rigid, error=${error}`);
    }
  }
});

test('kinematic wagons snake along the path and the tail follows the turn', () => {
  const modules = kinematicTrain();
  const head = modules[0];

  const dt = 1 / 60;
  let minTailAngle = 0;
  for (let f = 0; f < 700; f++) {
    if (f < 90) head.angle += 0.008; // skręt w dół (+y)
    head.x += Math.cos(head.angle) * 3000 * dt;
    head.y += Math.sin(head.angle) * 3000 * dt;
    stepMegafreighterTrainKinematics(modules, dt);
    minTailAngle = Math.min(minTailAngle, modules[modules.length - 1].angle);
  }

  assert.ok(modules[1].angle > 0.5, `first wagon must follow the turn, angle=${modules[1].angle}`);
  for (let i = 1; i < modules.length; i++) {
    assert.ok(modules[i].angle > 0.25, `wagon ${i} must eventually follow the turn, angle=${modules[i].angle}`);
  }
  // Chwilowe zarzucenie ogona w przeciwną stronę jest częścią mechanizmu =o=
  // (obracający się lider zamiata swoim zaczepem) — ma być małe i ograniczone,
  // w odróżnieniu od dawnego trwałego "banana" z serwa kątowego.
  assert.ok(minTailAngle > -0.35, `transient tail kick must stay bounded, min=${minTailAngle}`);
});

test('kinematic pivot clamp stops a folded joint at the =o= limit', () => {
  const modules = kinematicTrain().slice(0, 2);
  const head = modules[0];
  const wagon = modules[1];
  const bend = 2.97; // ~170° — wagon niemal złożony na głowę
  const hitch = rearHitch(head);
  wagon.angle = bend;
  wagon.x = hitch.x - Math.cos(bend) * MEGAFREIGHTER_COUPLER_ANCHOR;
  wagon.y = hitch.y - Math.sin(bend) * MEGAFREIGHTER_COUPLER_ANCHOR;

  stepMegafreighterTrainKinematics(modules, 1 / 60);

  const rel = Math.abs(wagon.angle - head.angle);
  assert.ok(rel <= MEGAFREIGHTER_MAX_PIVOT_ANGLE + 1e-9, `bend must clamp, rel=${rel}`);
  const bow = frontAnchor(wagon);
  assert.ok(Math.hypot(bow.x - hitch.x, bow.y - hitch.y) < 1e-6, 'bow stays on the hitch after clamping');
});

test('dead module breaks the kinematic chain behind it', () => {
  const modules = kinematicTrain();
  const head = modules[0];
  modules[2].dead = true;
  const frozen = { x: modules[3].x, y: modules[3].y, angle: modules[3].angle };

  head.x += 500;
  stepMegafreighterTrainKinematics(modules, 1 / 60);

  assert.ok(Math.abs(modules[1].x - (head.x - MEGAFREIGHTER_MODULE_SPACING)) < 1e-6, 'wagon 1 still follows');
  assert.equal(modules[3].x, frozen.x);
  assert.equal(modules[3].y, frozen.y);
  assert.equal(modules[3].angle, frozen.angle);
});

test('megafreighter coupler length matches the gap between local anchors', () => {
  const options = createMegafreighterCouplerOptions(1);
  const anchorGap = MEGAFREIGHTER_MODULE_SPACING
    - Math.abs(options.localAnchorA.x)
    - Math.abs(options.localAnchorB.x);

  assert.equal(anchorGap, MEGAFREIGHTER_COUPLER_LENGTH);
  assert.equal(options.constraintType, 'point');
  assert.equal(options.positionCorrection, 1);
  assert.equal(options.maxForce, Infinity);
  assert.equal(options.breakForce, Infinity);
  assert.equal(options.collideConnected, false);
  assert.equal(options.tag, 'megafreighter-coupler-1');
});

test('megafreighter coupler is a damped free hinge, not an orientation servo', () => {
  const options = createMegafreighterCouplerOptions(0);

  assert.equal(options.angularStiffness, 0, 'no straightening spring in the coupler');
  assert.ok(options.hingeFriction > 0, 'hinge needs bearing friction to settle oscillation');
  assert.ok(options.jointLimit > 0 && options.jointLimit < Math.PI / 2, 'mechanical stop within a sane cone');
});

function trainModuleBody(x, y, mass) {
  return { x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass, radius: 760, w: 2760, h: 1554 };
}

test('free hinge does not straighten an articulated joint at rest', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = trainModuleBody(0, 0, 900000);
  const bend = 0.3;
  // Wagon rotated AROUND THE PIN so the pin itself is satisfied: only the
  // relative angle differs. A servo would torque this straight; a hinge not.
  const wagon = trainModuleBody(
    -1460 - 1460 * Math.cos(bend),
    -1460 * Math.sin(bend),
    650000
  );
  wagon.angle = bend;
  system.attach(locomotive, wagon, createMegafreighterCouplerOptions(0));

  for (let i = 0; i < 30; i++) system.update(1 / 60);

  assert.ok(Math.abs(locomotive.angVel) < 1e-6, `hinge must not torque the locomotive, angVel=${locomotive.angVel}`);
  assert.ok(Math.abs(wagon.angVel) < 1e-6, `hinge must not torque the wagon, angVel=${wagon.angVel}`);
  assert.ok(Math.abs(wagon.angle - bend) < 1e-6, `bend angle must persist, angle=${wagon.angle}`);
});

test('hinge friction bleeds relative angular velocity through the coupler', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = trainModuleBody(0, 0, 900000);
  const wagon = trainModuleBody(-2920, 0, 650000);
  locomotive.angVel = 0.5;
  wagon.angVel = -0.5;
  system.attach(locomotive, wagon, createMegafreighterCouplerOptions(0));

  system.update(1 / 60);

  const relative = wagon.angVel - locomotive.angVel;
  assert.ok(Math.abs(relative) < 0.5, `relative spin must decay from -1, got ${relative}`);
  assert.ok(Number.isFinite(relative));
});

test('coupler mechanical stop pushes a jackknifed joint back inside its cone', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = trainModuleBody(0, 0, 900000);
  const bend = 0.9;
  const wagon = trainModuleBody(
    -1460 - 1460 * Math.cos(bend),
    -1460 * Math.sin(bend),
    650000
  );
  wagon.angle = bend;
  system.attach(locomotive, wagon, createMegafreighterCouplerOptions(0, {
    referenceAngle: 0
  }));

  system.update(1 / 60);

  const relativeRate = wagon.angVel - locomotive.angVel;
  assert.ok(relativeRate < 0, `stop must drive the 0.9 rad bend back under jointLimit, relative rate=${relativeRate}`);
});

test('coupler settles a spawn gap without shudder (stability regression)', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = trainModuleBody(0, 0, 900000);
  // 40u of slack in the coupler: the fix must close it once, not ping-pong.
  const wagon = trainModuleBody(-2960, 0, 650000);
  system.attach(locomotive, wagon, createMegafreighterCouplerOptions(0));

  const dt = 1 / 60;
  let maxLateGap = 0;
  for (let i = 0; i < 60; i++) {
    locomotive.x += locomotive.vx * dt;
    locomotive.y += locomotive.vy * dt;
    wagon.x += wagon.vx * dt;
    wagon.y += wagon.vy * dt;
    system.update(dt);
    if (i >= 30) {
      maxLateGap = Math.max(maxLateGap, Math.abs((locomotive.x - wagon.x) - 2920));
    }
  }

  assert.ok(maxLateGap < 0.5, `coupler gap must settle instead of oscillating, late gap=${maxLateGap}`);
  assert.ok(
    Math.abs(locomotive.vx - wagon.vx) < 0.5,
    `no residual ping-pong velocity, dv=${locomotive.vx - wagon.vx}`
  );
});

test('train follows sustained locomotive thrust without shaking in place', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = trainModuleBody(0, 0, 900000);
  const wagon = trainModuleBody(-2920, 0, 650000);
  system.attach(locomotive, wagon, createMegafreighterCouplerOptions(0));

  const dt = 1 / 60;
  let maxLateGap = 0;
  for (let i = 0; i < 180; i++) {
    locomotive.vx += 80 * dt;
    locomotive.x += locomotive.vx * dt;
    wagon.x += wagon.vx * dt;
    system.update(dt);
    if (i >= 60) {
      maxLateGap = Math.max(maxLateGap, Math.abs((locomotive.x - wagon.x) - 2920));
    }
  }

  assert.ok(locomotive.vx > 100, `train must actually accelerate, vx=${locomotive.vx}`);
  assert.ok(wagon.vx > locomotive.vx * 0.9, `wagon must track the head, vx=${wagon.vx} vs ${locomotive.vx}`);
  assert.ok(maxLateGap < 1, `coupler must stay closed under thrust, late gap=${maxLateGap}`);
});

test('wagon noses toward the pull instead of counter-rotating (banana regression)', () => {
  const system = new TowConstraintSystem({ iterations: 8 });
  const locomotive = trainModuleBody(0, 0, 900000);
  const wagon = trainModuleBody(-2920, 0, 650000);
  // Locomotive path curves downward (+y) while the wagon still travels
  // straight — the drawbar must rotate the wagon bow DOWN, following the
  // pull, never the other way.
  locomotive.vx = 600;
  locomotive.vy = 240;
  wagon.vx = 600;
  wagon.vy = 0;
  system.attach(locomotive, wagon, createMegafreighterCouplerOptions(0));

  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) {
    locomotive.x += locomotive.vx * dt;
    locomotive.y += locomotive.vy * dt;
    locomotive.angle += locomotive.angVel * dt;
    wagon.x += wagon.vx * dt;
    wagon.y += wagon.vy * dt;
    wagon.angle += wagon.angVel * dt;
    system.update(dt);
  }

  assert.ok(wagon.angle > 0.01, `wagon bow must rotate toward the pull (+y), angle=${wagon.angle}`);
  assert.ok(wagon.angle < 0.61 + 0.1, `wagon must stay inside the coupler cone, angle=${wagon.angle}`);
  assert.ok(wagon.vy > 0, `wagon must be dragged onto the new path, vy=${wagon.vy}`);
});
