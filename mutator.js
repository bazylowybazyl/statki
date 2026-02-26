const fs = require('fs');

let input = fs.readFileSync('index.html', 'utf-8');
let lines = input.split('\n');

function replaceBlock(regexStart, regexEnd, newContentOrLines) {
    let start = -1;
    let end = -1;
    for (let i = 0; i < lines.length; i++) {
        if (start < 0 && regexStart.test(lines[i])) {
            start = i;
        }
        if (start >= 0 && end < 0 && regexEnd.test(lines[i])) {
            end = i;
            break;
        }
    }

    if (start >= 0 && end >= 0) {
        typeof newContentOrLines === 'string'
            ? lines.splice(start, end - start + 1, newContentOrLines)
            : lines.splice(start, end - start + 1, ...newContentOrLines);
        console.log(`Replaced block from ${start} to ${end}.`);
    } else {
        console.log(`Failed to find block: start=${start}, end=${end}`);
    }
}

// 1. KROK 1: IMPORT WEAPONS
replaceBlock(
    /import \{ WEAPONS, WEAPON_ICON_PATHS, AISPACE_GUNS/,
    /import \{ WEAPONS, WEAPON_ICON_PATHS, AISPACE_GUNS/,
    `    import { MASTER_WEAPONS, WEAPON_ICON_PATHS } from "./src/data/weapons.js";\r\n\r\n    // Alias dla kompatybilności starego ekwipunku gracza, dopóki go nie zaktualizujemy\r\n    const WEAPONS = MASTER_WEAPONS; \r\n    window.MASTER_WEAPONS = MASTER_WEAPONS;`
);

// 2. KROK 2: Wielkie usuwanie staroci
replaceBlock(
    /const AISPACE_FLAK = \{/,
    /mergedInventory\.add\(weaponId\);/,
    ``
);
// usuwamy pozostalość po "}" z pętli mergedInventory.add
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('// ===================================') &&
        lines[i - 1].trim() === '}') {
        lines.splice(i - 1, 1);
        break;
    }
}

// 3. Adapter strzelania
const adapterNew = `// ============================================================================
// NOWY RDZEŃ STRZELANIA (Obsługuje Gracza i NPC)
// ============================================================================
window.fireWeaponCore = function (shooter, target, weaponId, muzzleData) {
    const weapon = MASTER_WEAPONS[weaponId];
    if (!weapon) return null;

    // 1. Aplikowanie modyfikatorów statku (jeśli istnieją)
    const mods = shooter.modifiers || {};
    const range = (weapon.baseRange || 1000) * (mods.range || 1.0);
    const damage = (weapon.baseDamage || 10) * (mods.damage || 1.0);
    const speed = (weapon.baseSpeed || 1000) * (mods.projectileSpeed || 1.0);
    const cd = (weapon.cooldown || 1.0) * (mods.fireRate || 1.0);

    const burstCount = weapon.burstCount || 1;
    const spreadRad = weapon.spread || 0;

    // 2. Celowanie
    let aimPoint;
    if (target && !target.dead) {
        aimPoint = (weapon.category === 'beam') 
            ? { x: target.x, y: target.y } // Lasery uderzają natychmiast, bez wyprzedzenia
            : window.getLeadAim(muzzleData.pos, target, speed); // Pociski biorą poprawkę na ruch
    } else {
        // Strzał w ciemno (przed siebie)
        aimPoint = { 
            x: muzzleData.pos.x + muzzleData.dir.x * range, 
            y: muzzleData.pos.y + muzzleData.dir.y * range 
        };
    }

    const baseAngle = Math.atan2(aimPoint.y - muzzleData.pos.y, aimPoint.x - muzzleData.pos.x);

    // 3. Wystrzał (obsługa salwy / burst)
    for (let i = 0; i < burstCount; i++) {
        const finalAngle = baseAngle + (Math.random() - 0.5) * spreadRad;
        const dirX = Math.cos(finalAngle);
        const dirY = Math.sin(finalAngle);

        if (weapon.category === 'beam') {
            // --- LOGIKA HITSCAN (LASERY) ---
            const endX = muzzleData.pos.x + dirX * range;
            const endY = muzzleData.pos.y + dirY * range;
            
            // Rysowanie lasera
            spawnLaserBeam(muzzleData.pos, { x: endX, y: endY }, weapon.size === 'L' ? 12 : 5, {
                life: weapon.duration || 0.12,
                colorOuter: weapon.vfxColor,
                colorInner: '#ffffff',
                glowColor: weapon.vfxColor,
                glowBlur: 20
            });

            // Natychmiastowe obrażenia
            if (target && !target.dead) {
                const distToTarget = Math.hypot(target.x - muzzleData.pos.x, target.y - muzzleData.pos.y);
                if (distToTarget <= range) {
                    if (target === window.ship) applyDamageToPlayer(damage);
                    else if (target.isStation) applyDamageToStation(target, damage);
                    else if (target.isPlatform) applyDamageToPlatform(target, damage);
                    else applyDamageToNPC(target, damage, 'beam');

                    spawnWeaponImpactFromPreset('beam', weapon.vfxColor, 1.0, target.x, target.y);
                }
            }
        } else {
            // --- LOGIKA POCISKÓW I RAKIET ---
            const life = range / Math.max(speed, 1);
            
            window.bullets.push({
                x: muzzleData.pos.x,
                y: muzzleData.pos.y,
                vx: dirX * speed + (muzzleData.baseVel?.x || 0) * 0.2,
                vy: dirY * speed + (muzzleData.baseVel?.y || 0) * 0.2,
                life: life,
                r: weapon.size === 'L' ? 6 : (weapon.size === 'M' ? 4 : 2),
                owner: shooter.friendly ? 'player' : 'npc',
                damage: damage,
                type: weapon.category, // 'rail', 'plasma', 'rocket', etc.
                color: weapon.vfxColor,
                source: shooter,
                penetration: weapon.penetration || 0,
                explodeRadius: weapon.explodeRadius || 0,
                
                // Specyficzne dla rakiet
                target: weapon.category === 'rocket' ? target : null,
                turnRate: weapon.turnRate ? (weapon.turnRate * Math.PI / 180) : 0,
                homingDelay: weapon.homingDelay || 0,
                vfxKey: weapon.id
            });
        }
    }

    // 4. Efekty wizualne wystrzału i dźwięk
    window.dispatchEvent(new CustomEvent('game_weapon_fired', { 
        detail: { weaponId: weapon.id, x: muzzleData.pos.x, y: muzzleData.pos.y } 
    }));

    // Zwracamy obliczony czas przeładowania, żeby wieżyczka wiedziała kiedy znowu strzelić
    return cd;
};

// Pomocniczy Wrapper dla AI (żeby nie przerabiać od razu wszystkich plików AI)
window.spawnBulletAdapter = function(owner, target, weaponDef, opts = {}) {
    const muzzle = {
        pos: opts.origin || owner,
        dir: { x: Math.cos(opts.angleOverride || owner.angle || 0), y: Math.sin(opts.angleOverride || owner.angle || 0) },
        baseVel: opts.originVel || { x: owner.vx || 0, y: owner.vy || 0 }
    };
    // AI podaje nam obiekt z aiUtils, bierzemy jego ID i wywołujemy nowy rdzeń
    window.fireWeaponCore(owner, target, weaponDef.id, muzzle);
};`;
replaceBlock(
    /window\.spawnBulletAdapter = function \(owner, target/,
    /      }\r?\n    };\r?\n/,  // we look for the end of spawnBulletAdapter
    adapterNew
);

// 4. BASE_MAIN_BEHAVIOR usuwanie staroci gracza
replaceBlock(
    /const BASE_MAIN_BEHAVIOR = \{/,
    /for \(const \[weaponId, weapon\] of Object\.entries\(AISPACE_HARDPOINT_WEAPONS\)\) \{/,
    ``
);
// usunąć if i MAIN_WEAPON_BEHAVIOR.railgun_mk1 = MAIN_WEAPON_BEHAVIOR.default;
replaceBlock(
    /if \(weapon\.type === HP\.MAIN && weapon\.aispaceDef\) \{/,
    /MAIN_WEAPON_BEHAVIOR\.railgun_mk1 = MAIN_WEAPON_BEHAVIOR\.default;/,
    ""
);

// Pytanie brzmiało też o "Naprawa błędu składni (samotny nawias) i kolejki Railguna" (KROK 1)
// Zastąp: const rail = { do }
replaceBlock(
    /const rail = \{/,
    /behaviorId: MAIN_WEAPON_BEHAVIOR\.default\.id,/,
    `    // =============== Rail (Kolejka strzałów gracza) ===============\r\n    const RAIL_SPEED = 2600; \r\n\r\n    const rail = {\r\n      cd: [0, 0],\r\n      cdMax: 0.15,\r\n      shotGap: 0.08,\r\n      burstGap: 0.2,\r\n      burstsPerClick: 1,\r\n      barrelsPerShot: 2,\r\n      queue: [],\r\n      nextStart: 0,\r\n      behaviorId: 'default',\r\n    };`
);


// KROK 2 USER: Usunięcie starego przypisywania zachowań (ok linii 1023)
replaceBlock(
    /function getMainWeaponBehaviorForWeaponId\(id\) \{/,
    /rail\.barrelsPerShot = behavior\.barrelsPerShot \?\? MAIN_WEAPON_BEHAVIOR\.default\.barrelsPerShot;\r?\n\s*\}/,
    `    function updateMainWeaponBehavior() {\r\n        const mainWeapons = Game.player.weapons?.[HP.MAIN] || [];\r\n        let cdMax = 0.15;\r\n        let barrels = 2;\r\n\r\n        if (mainWeapons.length) {\r\n            const weapon = mainWeapons[0].weapon; \r\n            if (weapon) {\r\n                cdMax = weapon.cooldown || 0.15;\r\n                barrels = weapon.size === 'L' ? 1 : 2;\r\n            }\r\n        }\r\n\r\n        rail.cdMax = cdMax;\r\n        rail.shotGap = 0.08;\r\n        rail.burstGap = cdMax;\r\n        rail.burstsPerClick = 1;\r\n        rail.barrelsPerShot = barrels;\r\n    }`
);

// KROK 3 USER: renderer PRIORYTETY
replaceBlock(
    /const weaponId = loadout\?\.weapon\?\.id;\r?\n\s*const behavior = getMainWeaponBehaviorForWeaponId\(weaponId\);/,
    /\/\/ PRIORYTET 1: RAILGUN/,
    `        // Pobieramy dane broni\r\n        const weaponData = loadout?.weapon;\r\n        const weaponId = weaponData?.id;\r\n\r\n        // =========================================================\r\n        // PRIORYTET 1: RAILGUN`
);

replaceBlock(
    /const barrelsPerShot = Math\.max\(1, behavior\.barrelsPerShot \?\? BASE_MAIN_BEHAVIOR\.barrelsPerShot\);/,
    /const barrelsPerShot = Math\.max\(1, behavior\.barrelsPerShot \?\? BASE_MAIN_BEHAVIOR\.barrelsPerShot\);/,
    `          const barrelsPerShot = (weaponData && weaponData.size === 'L') ? 1 : 2;`
);

// KROK 4 USER: fireRailBarrel
replaceBlock(
    /function fireRailBarrel\(barIndex, specificWeaponIdx = -1\) \{/,
    /rail\.cd\[barIndex\] = maxCooldown \|\| rail\.cdMax;\r?\n\s*\}/,
    `    function fireRailBarrel(barIndex, specificWeaponIdx = -1) {\r\n        const mainWeapons = Game.player.weapons?.[HP.MAIN] || [];\r\n        if (!mainWeapons.length) return;\r\n        \r\n        const turrets = [ship.turret, ship.turret2, ship.turret3, ship.turret4];\r\n        let maxCooldown = 0;\r\n\r\n        for (let i = 0; i < mainWeapons.length; i++) {\r\n            if (specificWeaponIdx !== -1 && i !== specificWeaponIdx) continue;\r\n            \r\n            const weaponData = mainWeapons[i]?.weapon;\r\n            if (!weaponData) continue;\r\n\r\n            const hpOffset = mainWeapons[i]?.hp?.pos;\r\n            const turretIndex = hpOffset ? getNearestTurretIndex(hpOffset, turrets) : (i % turrets.length);\r\n            const t = turrets[turretIndex];\r\n            const aimAngle = t?.angle ?? ship.angle;\r\n            const muzzleOffset = hpOffset || t?.offset;\r\n\r\n            // Zakładamy na razie 1-2 lufy na wieżyczkę (rozbudujemy to w Etapie 2 przy Broadside)\r\n            const barrelsPerShot = weaponData.size === 'L' ? 1 : 2; \r\n            \r\n            const muzzle = computeMainMuzzle(muzzleOffset, aimAngle, barIndex, barrelsPerShot);\r\n\r\n            // Używamy nowego rdzenia strzelania!\r\n            const cd = window.fireWeaponCore(ship, lockedTarget, weaponData.id, muzzle);\r\n            \r\n            // Zarządzanie odrzutem wizualnym\r\n            const recoilKick = weaponData.category === 'beam' ? 6 : 12;\r\n            const recoilMax = 18;\r\n            if (t && Array.isArray(t.recoil)) {\r\n                const idx = barIndex % 2;\r\n                t.recoil[idx] = Math.min(t.recoil[idx] + recoilKick, recoilMax);\r\n            } else if (t) {\r\n                t.recoil = Math.min(t.recoil + recoilKick, recoilMax);\r\n            }\r\n\r\n            maxCooldown = Math.max(maxCooldown, cd || rail.cdMax);\r\n        }\r\n        rail.cd[barIndex] = maxCooldown || rail.cdMax;\r\n    }`
);

fs.writeFileSync('index.html', lines.join('\n'));
console.log('Modification completed!');
