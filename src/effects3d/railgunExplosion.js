import * as THREE from './three.module.js';

let sharedTextures = null;

function ensureTextures() {
  if (sharedTextures) return;
  const loader = new THREE.TextureLoader();
  sharedTextures = {
    flash: loader.load('./assets/tex/flash01.png'),
    smoke: loader.load('./assets/tex/smoke04.png'),
  };
}

export function createRailgunExplosionFactory(scene) {
  ensureTextures();

  // Materiały współdzielone (bez zmian, są wydajne)
  const flashMaterial = new THREE.SpriteMaterial({
    map: sharedTextures.flash,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    opacity: 0.85,
    color: 0xffffff,
  });

  const coreMaterial = new THREE.SpriteMaterial({
    map: sharedTextures.flash,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    opacity: 0.95,
    color: 0x99e6ff,
  });

  // Geometria iskry (baza)
  const sparkGeometry = new THREE.PlaneGeometry(1, 0.14);
  const sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xb0f2ff,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  const baseSmokeMaterial = new THREE.SpriteMaterial({
    map: sharedTextures.smoke,
    color: 0xdde6ff,
    transparent: true,
    depthWrite: false,
    opacity: 0.22,
  });

  // Helper object do macierzy
  const dummyObj = new THREE.Object3D();

  return function spawn({ x = 0, y = 0, z, size = 50 } = {}) {
    const group = new THREE.Group();
    group.position.set(x, 0, z !== undefined ? z : y);
    // Opcjonalnie: globalne zmniejszenie skali całego efektu
    // group.scale.setScalar(size * 0.7); 
    group.scale.setScalar(size);
    scene.add(group);

    // --- ZMNIEJSZENIE BŁYSKU CENTRALEGO ---
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(1.5); // Było 3
    flash.position.y = 0.25;
    group.add(flash);

    const core = new THREE.Sprite(coreMaterial);
    core.scale.setScalar(0.8); // Było 1.6
    core.position.y = 0.7;
    group.add(core);

    // --- ZMNIEJSZENIE LICZBY ISKIER ---
    const sparkCount = 10; // Było 32 (drastyczna redukcja)
    const sparks = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, sparkCount);
    sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(sparks);

    const sparkData = new Array(sparkCount);
    for(let i=0; i<sparkCount; i++) {
        sparkData[i] = {
            angle: Math.random() * Math.PI * 2,
            // Mniejsze prędkości = mniejszy zasięg
            speed: 40 + Math.random() * 80, // Było 70 + ... 140
            life: 0.14 + Math.random() * 0.22,
            // Krótsze i cieńsze iskry
            length: 1.5 + Math.random() * 3.0, // Było 2.6 + ... 6.0
            thickness: 0.10 + Math.random() * 0.12, // Było 0.18 + ... 0.18
            elevation: 0.15 + Math.random() * 0.4,
            age: 0
        };
        // Inicjalizacja poza widokiem
        dummyObj.scale.set(0, 0, 0); 
        dummyObj.updateMatrix();
        sparks.setMatrixAt(i, dummyObj.matrix);
    }

    const smokes = [];
    // Zmniejszona liczba dymków (już było w poprzednim kroku, ale utrzymujemy)
    for (let i = 0; i < 6; i++) {
      const mat = baseSmokeMaterial.clone(); 
      const smoke = new THREE.Sprite(mat);
      // Mniejszy rozrzut początkowy dymu
      smoke.position.set((Math.random() - 0.5) * 0.5, 0.1, (Math.random() - 0.5) * 0.5);
      // Mniejsza skala początkowa dymu
      const scale = 0.8 + Math.random() * 1.0; // Było 1.1 + ... 1.5
      smoke.scale.setScalar(scale);
      smoke.userData = {
        vx: (Math.random() - 0.5) * 8,
        vz: (Math.random() - 0.5) * 8,
        // Wolniejszy wzrost dymu
        growth: 0.8 + Math.random() * 0.4, // Było 1.3 + ... 0.6
        age: 0,
        life: 0.7 + Math.random() * 0.5,
      };
      smokes.push(smoke);
      group.add(smoke);
    }

    const duration = 0.6;
    let time = 0;
    let disposed = false;

    function update(dt) {
      if (disposed) return;
      time += dt;

      // --- MNIEJSZY WZROST BŁYSKU W CZASIE ---
      const flashFade = Math.max(0, 1 - time / 0.09);
      // Wolniejszy wzrost
      flash.scale.setScalar(1.5 + time * 15); // Było 3 + time * 26
      if (flashFade <= 0) flash.visible = false;
      
      const coreFade = Math.max(0, 1 - time / 0.16);
      // Wolniejszy wzrost i mniejsza baza
      const coreScale = 0.8 + Math.max(0, 0.6 - time * 2.0); // Było 1.6 + ... time * 2.5
      core.scale.setScalar(coreScale);
      if (coreFade <= 0) core.visible = false;

      // Sparks logic
      for (let i = 0; i < sparkCount; i++) {
        const data = sparkData[i];
        data.age += dt;
        const ageNorm = Math.max(0, 1 - data.age / data.life);
        
        if (data.age < data.life) {
            // Mnożnik 0.015 zamiast 0.02 zmniejsza dystans
            const dist = data.speed * data.age * 0.015; 
            const px = Math.cos(data.angle) * dist;
            const pz = Math.sin(data.angle) * dist;

            dummyObj.position.set(px, 0.12, pz);
            dummyObj.rotation.set(-Math.PI / 2, 0, -data.angle);
            dummyObj.scale.set(
              data.length * (0.5 + 0.5 * ageNorm),
              data.thickness * (0.7 + 0.3 * ageNorm),
              1
            );
        } else {
            dummyObj.scale.set(0,0,0);
        }
        dummyObj.updateMatrix();
        sparks.setMatrixAt(i, dummyObj.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;

      // Smokes logic
      for (let i = smokes.length - 1; i >= 0; i--) {
        const smoke = smokes[i];
        const state = smoke.userData;
        state.age += dt;
        smoke.position.x += state.vx * dt;
        smoke.position.z += state.vz * dt;
        // Wzrost zdefiniowany przy spawnie (teraz mniejszy)
        smoke.scale.multiplyScalar(1 + state.growth * dt);
        const lifeT = Math.min(1, state.age / state.life);
        smoke.material.opacity = 0.22 * (1 - lifeT) * Math.max(0, 1 - time / 0.55);
        if (state.age >= state.life) {
          group.remove(smoke);
          smoke.material.dispose();
          smokes.splice(i, 1);
        }
      }

      if (time > duration + 0.6) {
        dispose();
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) {
        group.parent.remove(group);
      }
      smokes.forEach((smoke) => {
        if(smoke.material) smoke.material.dispose();
      });
    }

    return { update, dispose, group };
  };
}
