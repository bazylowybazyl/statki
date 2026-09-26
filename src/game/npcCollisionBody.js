// src/game/npcCollisionBody.js
//
// NPC w kolizjach ze światem: płyta ringu „Halo” (haloRingCollision.js)
// i asteroidy (AsteroidField.checkShipBodyCollisions). Z12, 2026-09-26.
//
// Kolizje ze światem ruszają statek przez pos/vel — tak żyje gracz (i P2).
// NPC całkują ruch w x/y/vx/vy: npcStep, stepShipFlight (shipFlightModel.js)
// i applyNpcFlightControl (npcFlight.js) czytają x/vx, a pos/vel z
// syncNpcFlightState to tylko lustro, które następny krok nadpisuje. Dawne
// pętle brały więc tylko NPC z lustrem i wypychały lustro — wypchnięcie
// ginęło w następnym kroku, a NPC bez lustra (większość) przelatywały przez
// ring i skały. Teraz NPC idzie do kolizji przez widok kinematyki:
// x/y/vx/vy → body.pos/vel, a wypchnięcie i nowa prędkość wracają do
// x/y/vx/vy i do lustra. Zero alokacji: jeden widok na pętlę.

// Widok kinematyki NPC — pola, które czytają kolizje ringu i asteroid.
export function createNpcCollisionBody() {
  return {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    angle: 0,
    radius: 0,
    w: 0,
    h: 0,
    mass: 0,
    rammingMass: 0
  };
}

// Czy ruch NPC prowadzi fizyka — tylko wtedy ring i skały go ograniczają.
// Poza tym zostają: martwe, duchy (isCollidable === false, np. przylot
// z warpa 'warping_in'), skok tranzytu (phase 'warping': prosta brama → brama
// bez omijania ringu; stop na płycie wstrzymałby frachtowiec i jego zlecenie,
// którego postęp liczy się z pozycji), dok (pozycja przypięta do portu)
// i wagon megafrachtowca (poza z zaczepu — wypchnięcie i tak by przepadło).
export function npcCollidesWithWorld(npc) {
  return !!npc && !npc.dead
    && npc.isCollidable !== false
    && npc.phase !== 'warping'
    && !npc.docking
    && !npc.towTrainChild;
}

// x/y/vx/vy i wymiary NPC → widok. Zero zamiast brakującego pola działa
// w kolizjach jak brak (promień, masa i obrys biorą swoje domyślne).
export function loadNpcCollisionBody(body, npc) {
  body.pos.x = Number(npc.x) || 0;
  body.pos.y = Number(npc.y) || 0;
  body.vel.x = Number(npc.vx) || 0;
  body.vel.y = Number(npc.vy) || 0;
  body.angle = Number(npc.angle) || 0;
  body.radius = Number(npc.radius) || 0;
  body.w = Number(npc.w) || 0;
  body.h = Number(npc.h) || 0;
  body.mass = Number(npc.mass) || 0;
  body.rammingMass = Number(npc.rammingMass) || 0;
  return body;
}

// Wynik kolizji → x/y/vx/vy NPC i lustro pos/vel, jeśli jest (HullBodies
// i część AI czytają pos przed x). Lustra nie zakładamy.
export function storeNpcCollisionBody(body, npc) {
  npc.x = body.pos.x;
  npc.y = body.pos.y;
  npc.vx = body.vel.x;
  npc.vy = body.vel.y;
  if (npc.pos) { npc.pos.x = npc.x; npc.pos.y = npc.y; }
  if (npc.vel) { npc.vel.x = npc.vx; npc.vel.y = npc.vy; }
}
