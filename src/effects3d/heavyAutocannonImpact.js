import * as THREE from "three";

const sharedTextures = {
  flash: null,
  ember: null,
  smoke: null,
};

function ensureTextures() {
  if (!sharedTextures.flash) {
    sharedTextures.flash = makeRadialTexture(384, "#fff5dc", "rgba(255,192,110,0.92)", "rgba(255,128,64,0)");
  }
  if (!sharedTextures.ember) {
    sharedTextures.ember = makeRadialTexture(256, "#ffe7c0", "rgba(255,168,64,0.8)", "rgba(255,110,40,0)");
  }
  if (!sharedTextures.smoke) {
    sharedTextures.smoke = makeSmokeTexture(256);
  }
}

export function createHeavyAutocannonImpactFactory(scene) {
  ensureTextures();

  return function spawn({ x = 0, y = 0, z, size = 42 } = {}) {
    const group = new THREE.Group();
    group.position.set(x, 0, z !== undefined ? z : y);
    group.scale.setScalar(size);
    scene.add(group);

    const flashMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.flash,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.92,
      color: 0xffffff,
    });
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(2.4);
    flash.position.y = 0.15;
    group.add(flash);

    const emberMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.ember,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.85,
      color: 0xffffff,
    });
    const ember = new THREE.Sprite(emberMaterial);
    ember.scale.setScalar(1.3);
    ember.position.y = 0.4;
    group.add(ember);

    const shockGeometry = new THREE.RingGeometry(0.4, 0.48, 32);
    const shockMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc27a,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shock = new THREE.Mesh(shockGeometry, shockMaterial);
    shock.rotation.x = -Math.PI / 2;
    shock.position.y = 0.02;
    group.add(shock);

    const sparkCount = 28;
    const sparkGeometry = new THREE.PlaneGeometry(1, 0.18);
    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd4a0,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, sparkCount);
    sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    sparks.frustumCulled = false;
    group.add(sparks);

    const sparkTransform = new THREE.Object3D();
    const sparkData = new Array(sparkCount).fill(null).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 65;
      const life = 0.16 + Math.random() * 0.2;
      const length = 1.6 + Math.random() * 1.6;
      const thickness = 0.16 + Math.random() * 0.12;
      const tilt = -Math.PI / 2;
      return { angle, speed, life, age: 0, length, thickness, tilt };
    });

    sparkData.forEach((data, i) => {
      sparkTransform.position.set(0, 0.08, 0);
      sparkTransform.rotation.set(data.tilt, 0, -data.angle);
      sparkTransform.scale.set(data.length, data.thickness, 1);
      sparkTransform.updateMatrix();
      sparks.setMatrixAt(i, sparkTransform.matrix);
    });
    sparks.instanceMatrix.needsUpdate = true;

    const smokes = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sharedTextures.smoke,
        color: 0xcfd7e6,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      });
      const smoke = new THREE.Sprite(mat);
      smoke.position.set((Math.random() - 0.5) * 0.5, 0.04 + Math.random() * 0.12, (Math.random() - 0.5) * 0.5);
      const scale = 0.9 + Math.random() * 0.8;
      smoke.scale.setScalar(scale);
      smoke.userData = {
        vx: (Math.random() - 0.5) * 4,
        vz: (Math.random() - 0.5) * 4,
        growth: 0.8 + Math.random() * 0.6,
        age: 0,
        life: 0.8 + Math.random() * 0.5,
      };
      smokes.push(smoke);
      group.add(smoke);
    }

    const light = new THREE.PointLight(0xffc88a, 60, 90 * size, 2.4);
    light.position.set(0, 4, 0);
    group.add(light);

    const duration = 0.55;
    let time = 0;
    let disposed = false;
    const sizeBoost = Math.sqrt(size / 42);

    function update(dt) {
      if (disposed) return;
      time += dt;

      const flashFade = Math.max(0, 1 - time / 0.12);
      flashMaterial.opacity = 0.92 * flashFade;
      flash.scale.setScalar(2.4 + time * 16);

      const emberFade = Math.max(0, 1 - time / 0.2);
      emberMaterial.opacity = 0.85 * emberFade;
      ember.scale.setScalar(1.3 + time * 4);

      const ringScale = 0.4 + time * 3.6;
      shock.scale.setScalar(ringScale);
      shockMaterial.opacity = 0.65 * Math.max(0, 1 - time / 0.3);

      for (let i = 0; i < sparkData.length; i++) {
        const data = sparkData[i];
        data.age += dt;
        const ageNorm = Math.max(0, 1 - data.age / data.life);
        const dist = data.speed * data.age * 0.015;
        const px = Math.cos(data.angle) * dist;
        const pz = Math.sin(data.angle) * dist;
        sparkTransform.position.set(px, 0.08, pz);
        sparkTransform.rotation.set(data.tilt, 0, -data.angle);
        sparkTransform.scale.set(
          data.length * (0.6 + 0.4 * ageNorm),
          data.thickness * (0.6 + 0.4 * ageNorm),
          1,
        );
        sparkTransform.updateMatrix();
        sparks.setMatrixAt(i, sparkTransform.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;
      sparkMaterial.opacity = 0.85 * Math.max(0, 1 - time / 0.24);

      for (let i = smokes.length - 1; i >= 0; i--) {
        const smoke = smokes[i];
        const state = smoke.userData;
        state.age += dt;
        smoke.position.x += state.vx * dt * 0.5;
        smoke.position.z += state.vz * dt * 0.5;
        smoke.scale.multiplyScalar(1 + state.growth * dt * 0.6);
        const lifeT = Math.min(1, state.age / state.life);
        smoke.material.opacity = 0.18 * (1 - lifeT) * Math.max(0, 1 - time / 0.5);
        if (state.age >= state.life) {
          group.remove(smoke);
          smoke.material.dispose();
          smokes.splice(i, 1);
        }
      }

      light.intensity = 80 * sizeBoost * Math.max(0, 1 - time / 0.18);

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
      flashMaterial.dispose();
      emberMaterial.dispose();
      shockGeometry.dispose();
      shockMaterial.dispose();
      sparks.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      smokes.forEach((smoke) => {
        smoke.material.dispose();
      });
    }

    return { update, dispose, group };
  };
}

function makeRadialTexture(size = 256, inner = "#ffe5b5", mid = "rgba(255,164,72,0.85)", outer = "rgba(255,96,32,0)") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.36, mid);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSmokeTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.48);
  gradient.addColorStop(0, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
