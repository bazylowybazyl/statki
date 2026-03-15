import { 
    BULLET_STRIDE, B_ACTIVE, B_X, B_Y, B_VX, B_VY, B_LIFE, B_R, B_DMG, B_OWNER, B_PENETRATION,
    ENTITY_STRIDE, E_ACTIVE, E_X, E_Y, E_R, E_OWNER, E_ID 
} from "./PhysicsState.js";

// Funkcja, która zostanie wysłana do Workera w tle
export async function runPhysicsWorker(bMutex, eMutex, hitTx, dt) {
    // 1. Zablokuj pamięć na czas trwania pętli (manualny dispose dla czystego JS)
    const bGuard = await bMutex.lock();
    const eGuard = await eMutex.lock();

    try {
        const bullets = bGuard.value;
        const entities = eGuard.value;

        // 2. Iterujemy po wszystkich slotach pocisków
        for (let i = 0; i < bullets.length; i += BULLET_STRIDE) {
            if (bullets[i + B_ACTIVE] === 0) continue; // Pusty slot, omijamy

            // Aktualizacja pozycji pocisku
            bullets[i + B_X] += bullets[i + B_VX] * dt;
            bullets[i + B_Y] += bullets[i + B_VY] * dt;
            bullets[i + B_LIFE] -= dt;

            // Śmierć pocisku ze starości
            if (bullets[i + B_LIFE] <= 0) {
                bullets[i + B_ACTIVE] = 0;
                continue;
            }

            // === NARROWPHASE KOLIZJE ===
            let hitDetected = false;
            let hitEntityId = -1;

            // Sprawdzamy kolizję z każdym żywym statkiem
            for (let e = 0; e < entities.length; e += ENTITY_STRIDE) {
                if (entities[e + E_ACTIVE] === 0) continue;

                // Ignoruj Friendly Fire
                if (bullets[i + B_OWNER] === entities[e + E_OWNER]) continue;

                const dx = bullets[i + B_X] - entities[e + E_X];
                const dy = bullets[i + B_Y] - entities[e + E_Y];
                const rSum = bullets[i + B_R] + entities[e + E_R];

                // Szybki test odległości kołowej (Pitagonras bez pierwiastka)
                if (dx * dx + dy * dy <= rSum * rSum) {
                    hitDetected = true;
                    hitEntityId = entities[e + E_ID];
                    break; 
                }
            }

            // Obsługa trafienia
            if (hitDetected) {
                // Wyślij sygnał do głównego wątku (non-blocking)
                hitTx.trySend({
                    entityId: hitEntityId,
                    damage: bullets[i + B_DMG],
                    x: bullets[i + B_X],
                    y: bullets[i + B_Y]
                });

                // Sprawdź penetrację (np. dla Railguna)
                bullets[i + B_PENETRATION] -= 1;
                if (bullets[i + B_PENETRATION] <= 0) {
                    bullets[i + B_ACTIVE] = 0; // Usunięcie pocisku z pamięci
                }
            }
        }
    } finally {
        // Obowiązkowo zwalniamy Mutexy, żeby główny wątek mógł dodać nowe pociski
        eGuard.dispose();
        bGuard.dispose();
    }
    
    return true; // Krok zakończony
}