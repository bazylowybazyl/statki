// src/render/frameWake.worker.js — wątek budzika limitu klatek bez VSync (src/render/frameWake.js, strategia 'worker').
//
// Zamówienie [seq, waitMs, spinMs]: sen setTimeout do chwili należnej − spinMs, ostatni odcinek pętlą na TYM wątku (bez
// zadań i alokacji — wątek strony nie dopina czekania kolejką), potem jeden komunikat [seq, ms pętli] do strony. Zegar
// workera ma inny początek niż zegar strony — czas względny (przesył zamówienia, ~0,05 ms, dochodzi do spóźnienia).
// Wiadomość bez zamówienia (0) — anuluje sen. Zamówienie przychodzi zadaniem wiadomości, więc setTimeout nie jest
// zagnieżdżony (bez progu 4 ms).

let timer = 0;
let seq = 0;
let due = 0;

function fire() {
  timer = 0;
  const t0 = performance.now();
  let t = t0;
  while (t < due) t = performance.now();
  self.postMessage([seq, t - t0]);
}

self.onmessage = (e) => {
  const m = e.data;
  if (timer) { clearTimeout(timer); timer = 0; }
  if (!m || !(m[0] > 0)) return;
  seq = m[0];
  due = performance.now() + m[1];
  const sleep = Math.floor(m[1] - m[2]);
  if (sleep >= 1) timer = setTimeout(fire, sleep);
  else fire();
};
