import { Mutex, channel } from "multithreading";

// === KANAŁ KOMUNIKACYJNY (Z Workera do Głównego Wątku) ===
// Używamy MPMC Channel z multithreading, by Worker krzyczał: "Trafiłem statek X!"
export const [hitSender, hitReceiver] = channel(4096);

// === BUFOR POCISKÓW ===
export const MAX_BULLETS = 5000;
export const BULLET_STRIDE = 10; // Każdy pocisk zajmuje 10 miejsc w tablicy
// Offsety (indeksy) właściwości wewnątrz stride'a:
export const B_ACTIVE = 0;
export const B_X = 1;
export const B_Y = 2;
export const B_VX = 3;
export const B_VY = 4;
export const B_R = 5;
export const B_DMG = 6;
export const B_OWNER = 7; // 1 = player, 2 = npc
export const B_PENETRATION = 8;
export const B_LIFE = 9;

// Tworzymy współdzieloną pamięć
const bulletBuffer = new SharedArrayBuffer(MAX_BULLETS * BULLET_STRIDE * 4); // 4 bajty na Float32
export const bulletData = new Float32Array(bulletBuffer);
export const bulletMutex = new Mutex(bulletData);

// === BUFOR ENCJI (Statki do kolizji) ===
// Główny wątek wpisuje tu tylko X, Y i promień statków, żeby Worker wiedział w co uderzać.
export const MAX_ENTITIES = 1000;
export const ENTITY_STRIDE = 8;
export const E_ACTIVE = 0;
export const E_X = 1;
export const E_Y = 2;
export const E_R = 3;
export const E_SHIELD = 4;
export const E_OWNER = 5; 
export const E_ID = 6; // Oryginalny indeks statku w tablicy npcs

const entityBuffer = new SharedArrayBuffer(MAX_ENTITIES * ENTITY_STRIDE * 4);
export const entityData = new Float32Array(entityBuffer);
export const entityMutex = new Mutex(entityData);