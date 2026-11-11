// Dźwięki hali K-7 — reżyser (src/game/k7HallSound.js): co i gdzie gra przy pozach obsługi stanowisk, zaworach
// i spikerze. Dźwięku nikt tu nie słyszy — sprawdzamy wywołania ujścia warstwy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createK7HallSound, stepK7HallSound, queueK7HallVoice, K7_HALL_SOUND_TUNE, K7_HALL_VOICE, K7_HALL_SOUND_LAYOUT
} from '../src/game/k7HallSound.js';
import {
  K7_SERVICE_DOCK, K7_SERVICE_UNDOCK, K7_CONNECTED_POSE, k7ServiceConnectPose, k7ServiceDisconnectPose
} from '../src/3d/haloRing/haloPortK7Layout.js';
import { k7VentEnvelope } from '../src/3d/haloRing/haloPortK7Lights.js';
import { readFileSync } from 'node:fs';
import { DZWIEKI_HALI, KATEGORIE } from '../src/audio/dzwiekiLogika.js';
import { allocatedBytes, untilSteady } from './helpers/alokacje.mjs';

// Hala z przekształceniem prostym: gra (x, y) = hala (x, −z).
function hall(poses = new Map()) {
  const owner = { index: 0, frame: { origin: { x: 0, y: 0 }, tx: 1, ty: 0, rx: 0, ry: 1 }, poses };
  return { owner, rings: [{ collider: { place: { x: 0, y: 0, cos: 1, sin: 0 }, registry: { halls: [owner] } } }] };
}

function sink() {
  const s = { graj: [], petla: [] };
  s.graj = [];
  s.petla = [];
  return {
    log: s,
    graj(id, x, y, g) { s.graj.push({ id, x, y, g }); },
    petla(klucz, id, g, x, y) { s.petla.push({ klucz, id, g, x, y }); }
  };
}

const C01 = K7_HALL_SOUND_LAYOUT.berths[0];
const IN_HALL = { camX: C01.x, camY: -C01.z, viewHalf: 3000, clock: 0, playerX: C01.x, playerY: -C01.z };

function run(st, out, rings, seconds, poseAt, extra = {}) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    if (poseAt) poseAt(t);
    stepK7HallSound(st, out, { ...IN_HALL, ...extra, rings, dt, clock: (extra.clock || 0) + t });
  }
}

test('tabela hali zgodna z manifestem dźwięków (pliki, pętle, kategorie); głos spikera nad tłem', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/sounds/ai/manifest.json', import.meta.url), 'utf8'));
  for (const id of Object.keys(DZWIEKI_HALI)) {
    const pliki = manifest.pliki.filter((f) => f.id === id);
    assert.ok(pliki.length, `brak ${id} w manifest.json`);
    for (const f of pliki) assert.equal(!!f.petla, !!DZWIEKI_HALI[id].petla, `pętla ${f.plik}`);
    assert.ok(KATEGORIE[DZWIEKI_HALI[id].kat], `kategoria ${id}`);
  }
  // spiker: kwestia na wariant, polskie teksty w manifeście (pochodzenie: synteza mowy)
  const status = manifest.pliki.filter((f) => f.id === K7_HALL_VOICE.status);
  assert.ok(status.length >= 5 && status.every((f) => typeof f.tekst === 'string' && f.tekst.length > 20));
  const cel = (id) => KATEGORIE[DZWIEKI_HALI[id].kat].cel + (DZWIEKI_HALI[id].poziom || 0);
  assert.ok(cel(K7_HALL_VOICE.status) > cel('halaTlo') + 6, 'głos wyraźnie nad tłem hali');
  // zwolnienie zacisków gra razem z komunikatem o mocowaniach — nie może go zagłuszyć; mechanizmy nad tłem
  assert.ok(cel('zaciskiZwolnienie') <= cel(K7_HALL_VOICE.clamps), 'zaciski nie głośniej niż spiker');
  for (const id of ['serwo', 'syk', 'buchPary', 'zaciskiZwolnienie']) assert.ok(cel(id) > cel('halaTlo'), `${id} nad tłem`);
});

test('tabela hali ma wszystkie dźwięki reżysera (pętle i jednorazowe)', () => {
  for (const id of ['halaTlo', 'halaMaszyny', 'przeplyw', 'serwo', 'syk']) assert.ok(DZWIEKI_HALI[id]?.petla, `pętla ${id}`);
  for (const id of ['buchPary', 'zlaczeZapiecie', 'zaciskiZwolnienie', 'zaciskiZalaczenie', 'gong']) assert.ok(DZWIEKI_HALI[id] && !DZWIEKI_HALI[id].petla, id);
  for (const id of Object.values(K7_HALL_VOICE)) {
    assert.ok(DZWIEKI_HALI[id], `głos ${id}`);
    assert.equal(DZWIEKI_HALI[id].szyna, 'megafon', `${id} przez megafon`);
    assert.ok(DZWIEKI_HALI[id].ui, `${id} bez położenia`);
  }
});

test('poza halą i w pauzie — cisza; w hali — tło i pompownia', () => {
  const { rings } = hall();
  const st = createK7HallSound();
  const out = sink();
  stepK7HallSound(st, out, { ...IN_HALL, rings, dt: 1 / 60, camX: 200000, camY: 0 });
  assert.equal(st.presence, 0);
  assert.equal(out.log.petla.length + out.log.graj.length, 0);
  stepK7HallSound(st, out, { ...IN_HALL, rings, dt: 1 / 60, paused: true });
  assert.equal(out.log.petla.length + out.log.graj.length, 0);
  stepK7HallSound(st, out, { ...IN_HALL, rings, dt: 1 / 60 });
  assert.equal(st.presence, 1);
  const tlo = out.log.petla.find((p) => p.id === 'halaTlo');
  assert.ok(tlo && tlo.g === 1 && Number.isNaN(tlo.x), 'tło bez położenia, pełne');
  const m = out.log.petla.find((p) => p.id === 'halaMaszyny');
  assert.ok(m && Number.isFinite(m.x), 'pompownia z położeniem');
  // obecność gaśnie za obrysem hali
  const st2 = createK7HallSound();
  stepK7HallSound(st2, sink(), { ...IN_HALL, rings, dt: 1 / 60, camX: 0, camY: -(7400 + K7_HALL_SOUND_TUNE.reach / 2) });
  assert.ok(st2.presence > 0.4 && st2.presence < 0.6, `obecność w pół drogi ${st2.presence}`);
});

test('statek zastany przypięty: bez zdarzeń; odcumowanie — buch pary, zaciski, serwo, upust i komunikaty', () => {
  const pose = { ...K7_CONNECTED_POSE };
  const poses = new Map([[C01.id, pose]]);
  const { rings } = hall(poses);
  const st = createK7HallSound();
  const out = sink();
  run(st, out, rings, 2, null);
  assert.equal(out.log.graj.filter((g) => g.id !== 'gong' && g.id !== K7_HALL_VOICE.status).length, 0, 'stan zastany bez zdarzeń');
  assert.ok(out.log.petla.some((p) => p.id === 'przeplyw' && p.klucz.includes(C01.id)), 'przepływ podpiętego stanowiska');
  // ODDOKOWANIE: sekwencja fabuły od pozy podpiętej
  const out2 = sink();
  const t0 = st.time;
  run(st, out2, rings, 12, (t) => k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, pose));
  const ile = (id) => out2.log.graj.filter((g) => g.id === id).length;
  assert.equal(ile('buchPary'), 1, 'jeden buch pary przy odryglowaniu');
  assert.equal(ile('zaciskiZwolnienie'), 1, 'jedno zwolnienie zacisków');
  assert.equal(ile('zaciskiZalaczenie') + ile('zlaczeZapiecie'), 0);
  assert.ok(out2.log.petla.some((p) => p.id === 'serwo'), 'serwo ramion w ruchu');
  assert.ok(out2.log.petla.some((p) => p.id === 'syk' && p.klucz.startsWith('hala:upust')), 'syk kontrolowanego upustu');
  assert.equal(ile(K7_HALL_VOICE.undock), 1, 'komunikat odcumowania');
  assert.equal(ile(K7_HALL_VOICE.clamps), 1, 'komunikat zwolnienia mocowań');
  // gong przed odcumowaniem, głosy się nie nakładają
  const glosy = out2.log.graj.filter((g) => g.id === K7_HALL_VOICE.undock || g.id === K7_HALL_VOICE.clamps);
  assert.ok(ile('gong') >= 1);
  assert.ok(st.time - t0 > 0);
  // buch pary przy słupkach stanowiska (z + fuelZ), zaciski na środku stanowiska
  const buch = out2.log.graj.find((g) => g.id === 'buchPary');
  assert.equal(buch.x, C01.x);
  assert.equal(buch.y, -(C01.z + K7_HALL_SOUND_LAYOUT.fuelZ));
  const zac = out2.log.graj.find((g) => g.id === 'zaciskiZwolnienie');
  assert.equal(zac.y, -C01.z);
  assert.equal(glosy.length, 2);
});

test('odstęp komunikatów: drugi głos nie wcześniej niż voiceGap po pierwszym', () => {
  const pose = { ...K7_CONNECTED_POSE };
  const { rings } = hall(new Map([[C01.id, pose]]));
  const st = createK7HallSound();
  const out = sink();
  const czasy = [];
  const s = { graj(id) { if (id.startsWith('spiker')) czasy.push(st.time); }, petla() {} };
  run(st, out, rings, 0.5, null);
  run(st, s, rings, 14, (t) => k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, pose));
  assert.equal(czasy.length, 2);
  // pierwszy głos startuje w klatce po swojej chwili (do 1/60 s później)
  assert.ok(czasy[1] - czasy[0] >= K7_HALL_SOUND_TUNE.voiceGap - 1 / 30, `odstęp ${czasy[1] - czasy[0]}`);
});

test('długa kwestia (warstwa podaje długość): następny komunikat i jego gong dopiero po jej końcu', () => {
  const pose = { ...K7_CONNECTED_POSE };
  const { rings } = hall(new Map([[C01.id, pose]]));
  const st = createK7HallSound();
  const DL = 11;
  const zdarzenia = [];
  const s = {
    ostatniaDlugosc: 0,
    graj(id) { zdarzenia.push([id, st.time]); this.ostatniaDlugosc = id === 'gong' ? 2 : DL; return true; },
    petla() {}
  };
  run(st, sink(), rings, 0.5, null);
  run(st, s, rings, 30, (t) => k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, pose));
  const odc = zdarzenia.find(([id]) => id === K7_HALL_VOICE.undock);
  const moc = zdarzenia.find(([id]) => id === K7_HALL_VOICE.clamps);
  assert.ok(odc && moc);
  assert.ok(moc[1] - odc[1] >= DL + K7_HALL_SOUND_TUNE.voicePad - 1 / 30, `mocowania po końcu odcumowania: ${moc[1] - odc[1]}`);
  // żaden gong w trakcie kwestii
  for (const [id, t] of zdarzenia) {
    if (id !== 'gong') continue;
    assert.ok(!(t > odc[1] && t < odc[1] + DL), `gong w trakcie kwestii (${t})`);
  }
});

test('dokowanie (automat stanowisk): załączenie zacisków, zapięcie złączki, komunikat zacumowania', () => {
  const pose = { clamp: 0, extension: 0, seat: 0, lock: 0, flow: 0, vent: 0 };
  const { rings } = hall(new Map([[C01.id, pose]]));
  const st = createK7HallSound();
  const out = sink();
  run(st, out, rings, 0.2, null);
  run(st, out, rings, 16, (t) => k7ServiceConnectPose(K7_SERVICE_DOCK, t, null, pose));
  const ile = (id) => out.log.graj.filter((g) => g.id === id).length;
  assert.equal(ile('zaciskiZalaczenie'), 1);
  assert.equal(ile('zlaczeZapiecie'), 1);
  assert.equal(ile('buchPary') + ile('zaciskiZwolnienie'), 0);
  assert.equal(ile(K7_HALL_VOICE.docked), 1);
});

test('obce stanowisko: dźwięki mechanizmów są, komunikatów obsługi nie ma', () => {
  const C02 = K7_HALL_SOUND_LAYOUT.berths[1];
  const pose = { ...K7_CONNECTED_POSE };
  const { rings } = hall(new Map([[C02.id, pose]]));
  const st = createK7HallSound();
  const out = sink();
  run(st, out, rings, 0.2, null);
  run(st, out, rings, 12, (t) => k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, pose));
  const ile = (id) => out.log.graj.filter((g) => g.id === id).length;
  assert.equal(ile('zaciskiZwolnienie'), 1);
  assert.equal(ile(K7_HALL_VOICE.undock) + ile(K7_HALL_VOICE.clamps), 0);
});

test('zawory hali: syk w oknie gazu harmonogramu (ta sama faza co kogut i para)', () => {
  const { rings } = hall();
  const st = createK7HallSound();
  const vents = K7_HALL_SOUND_LAYOUT.vents;
  const env = { warn: 0, gas: 0, u: 0 };
  // chwila gazu i chwila ciszy pierwszego zaworu
  const v = vents[0];
  let tGaz = -1, tCisza = -1;
  for (let t = 0; t < v.period; t += 0.05) {
    k7VentEnvelope(t, v.phase, v.period, env);
    if (tGaz < 0 && env.gas > 0.9) tGaz = t;
    if (tCisza < 0 && env.gas === 0 && env.warn === 0) tCisza = t;
  }
  assert.ok(tGaz >= 0 && tCisza >= 0);
  const klucz = `hala:zawor:${v.id}`;
  const a = sink();
  stepK7HallSound(st, a, { ...IN_HALL, rings, dt: 1 / 60, clock: tGaz });
  assert.ok(a.log.petla.some((p) => p.klucz === klucz && p.id === 'syk' && p.g > 0.4), 'syk w oknie gazu');
  const b = sink();
  stepK7HallSound(st, b, { ...IN_HALL, rings, dt: 1 / 60, clock: tCisza });
  assert.ok(!b.log.petla.some((p) => p.klucz === klucz), 'cisza poza oknem');
  // przez dwa najdłuższe okresy syczy każdy zawór
  const syczy = new Set();
  const c = { graj() {}, petla(k) { if (k.startsWith('hala:zawor:')) syczy.add(k); } };
  for (let t = 0; t < 96; t += 0.1) stepK7HallSound(st, c, { ...IN_HALL, rings, dt: 0.1, clock: t });
  assert.equal(syczy.size, vents.length);
});

test('spiker: status ringu w hali po annFirst, potem co annMin…annMax; komunikat obsługi wypiera czekający status', () => {
  const { rings } = hall();
  const st = createK7HallSound({ rand: () => 0 });
  const czasy = [];
  const s = { graj(id) { if (id === K7_HALL_VOICE.status) czasy.push(st.time); }, petla() {} };
  for (let t = 0; t < 100; t += 0.1) stepK7HallSound(st, s, { ...IN_HALL, rings, dt: 0.1 });
  assert.ok(czasy.length >= 2);
  // krok 0,1 s: kolejka i start głosu przesuwają się najwyżej o trzy kroki
  assert.ok(Math.abs(czasy[0] - (K7_HALL_SOUND_TUNE.annFirst + K7_HALL_SOUND_TUNE.gongLead)) < 0.35, `pierwszy ${czasy[0]}`);
  assert.ok(czasy[1] - czasy[0] >= K7_HALL_SOUND_TUNE.annMin - 0.2);
  // urgent: status w kolejce znika
  const st2 = createK7HallSound();
  queueK7HallVoice(st2, K7_HALL_VOICE.status, { gong: true });
  queueK7HallVoice(st2, K7_HALL_VOICE.undock, { gong: true, urgent: true });
  assert.ok(!st2.qId.includes(K7_HALL_VOICE.status));
  assert.ok(st2.qId.includes(K7_HALL_VOICE.undock));
});

// Reżyser sam nie alokuje; jedyny koszt to granica ujścia: `sink.petla(…, głośność, x, y)` z liczbami double poza
// wklejeniem pakuje argumenty (w grze tak samo na granicy warstwy Web Audio). Strażnik: 12 hal jak w grze (3 ringi ×
// 4 hale) — wyszukiwanie hali przy kamerze ma być bez alokacji (dawniej ~60 B na halę), a całość pod budżetem
// kilkunastu wywołań ujścia na klatkę.
test('klatka reżysera: bez alokacji na halę, budżet granicy ujścia (stan ustalony)', async () => {
  // pozy policzone z góry (zapis pozy kluczem w teście sam pakuje liczby — mierzymy reżysera, nie pisarza póz)
  const keys = ['clamp', 'extension', 'seat', 'lock', 'flow', 'vent'];
  const table = [];
  for (let k = 0; k < 1800; k++) {
    const t = (k % 900) / 60;
    const p = k < 900 ? k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, {}) : k7ServiceConnectPose(K7_SERVICE_DOCK, t, null, {});
    const q = { clamp: 0.5, extension: 0.5, seat: 0.5, lock: 0.5, flow: 0.5, vent: 0.5 };
    for (const key of keys) q[key] = p[key];
    table.push(q);
  }
  const poses = new Map([[C01.id, table[0]]]);
  const { rings: one } = hall(poses);
  // 3 ringi × 4 hale: hala z pozami przy kamerze, reszta 50–200 tys. j. dalej
  const rings = [];
  for (let r = 0; r < 3; r++) {
    const halls = [];
    for (let k = 0; k < 4; k++) {
      if (r === 0 && k === 0) { halls.push(one[0].collider.registry.halls[0]); continue; }
      halls.push({ index: k, frame: { origin: { x: 50000 * (r + 1) + 12000 * k, y: 0 }, tx: 1, ty: 0, rx: 0, ry: 1 }, poses: new Map() });
    }
    rings.push({ collider: { place: { x: 0, y: 0, cos: 1, sin: 0 }, registry: { halls } } });
  }
  const st = createK7HallSound();
  let calls = 0;
  const s = { graj() { calls++; return true; }, petla() { calls++; }, ostatniaDlugosc: 6 };
  const o = { ...IN_HALL, rings, dt: 1 / 60, clock: 0 };
  let n = 0;
  // ruch ramion i rygli w pętli (odcumowanie ↔ dokowanie), zawory i spiker — cała ścieżka klatki
  const step = () => {
    poses.set(C01.id, table[n % 1800]);
    o.clock = n / 60;
    stepK7HallSound(st, s, o);
    n++;
  };
  for (let i = 0; i < 4000; i++) step();
  calls = 0;
  for (let i = 0; i < 1800; i++) step();
  const callsPerFrame = calls / 1800;
  // ≤ 3 liczby double na wywołanie ujścia (≤ 16 B każda) + zapas na stałe obciążenie klatki
  const budget = callsPerFrame * 48 + 32;
  const best = await untilSteady(() => allocatedBytes(step, 2000) / 2000, (b) => b < budget, { warm: () => { for (let k = 0; k < 400; k++) step(); } });
  assert.ok(best < budget, `klatka alokuje ${best.toFixed(1)} B przy ${callsPerFrame.toFixed(1)} wywołaniach ujścia (budżet ${budget.toFixed(0)} B)`);
});
