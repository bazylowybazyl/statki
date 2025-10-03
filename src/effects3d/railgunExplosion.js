import * as THREE from "three";

const sharedTextures = {
  flash: null,
  smoke: null,
};

function ensureTextures() {
  if (!sharedTextures.flash) {
    sharedTextures.flash = makeRadialTexture(512);
  }
  if (!sharedTextures.smoke) {
    sharedTextures.smoke = makeSmokeTexture(256);
  }
}

export function createRailgunExplosionFactory(scene) {
  ensureTextures();

  return function spawn({ x = 0, y = 0, z } = {}) {
    const group = new THREE.Group();
    group.position.set(x, y, z !== undefined ? z : 0);
    scene.add(group);

    const flashMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.flash,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.85,
      color: 0xffffff,
    });
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(3);
    flash.position.y = 0.25;
    group.add(flash);

    const coreMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.flash,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.95,
      color: 0x99e6ff,
    });
    const core = new THREE.Sprite(coreMaterial);
    core.scale.setScalar(1.6);
    core.position.y = 0.7;
    group.add(core);

    const sparkCount = 54;
    const sparkGeometry = new THREE.PlaneGeometry(1, 0.14);
    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: 0xb0f2ff,
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
      const speed = 70 + Math.random() * 140;
      const life = 0.14 + Math.random() * 0.22;
      const length = 2.6 + Math.random() * 6.0;
      const thickness = 0.18 + Math.random() * 0.18;
      const elevation = 0.15 + Math.random() * 0.4;
      return {
        angle,
        speed,
        life,
        age: 0,
        length,
        thickness,
        elevation,
      };
    });

    sparkData.forEach((data, i) => {
      sparkTransform.position.set(0, data.elevation, 0);
      sparkTransform.rotation.set(-Math.PI / 2, 0, -data.angle);
      sparkTransform.scale.set(data.length, data.thickness, 1);
      sparkTransform.updateMatrix();
      sparks.setMatrixAt(i, sparkTransform.matrix);
    });
    sparks.instanceMatrix.needsUpdate = true;

    const baseSmokeMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.smoke,
      color: 0xdde6ff,
      transparent: true,
      depthWrite: false,
      opacity: 0.22,
    });

    const smokes = [];
    for (let i = 0; i < 10; i++) {
      const mat = baseSmokeMaterial.clone();
      const smoke = new THREE.Sprite(mat);
      smoke.position.set((Math.random() - 0.5) * 0.8, 0.1, (Math.random() - 0.5) * 0.8);
      const scale = 1.1 + Math.random() * 1.5;
      smoke.scale.setScalar(scale);
      smoke.userData = {
        vx: (Math.random() - 0.5) * 8,
        vz: (Math.random() - 0.5) * 8,
        growth: 1.3 + Math.random() * 0.6,
        age: 0,
        life: 0.7 + Math.random() * 0.5,
      };
      smokes.push(smoke);
      group.add(smoke);
    }

    const light = new THREE.PointLight(0x9ad9ff, 120, 110, 2);
    light.position.set(0, 6, 0);
    group.add(light);

    const duration = 0.6;
    let time = 0;
    let disposed = false;

    function update(dt) {
      if (disposed) return;
      time += dt;

      const flashFade = Math.max(0, 1 - time / 0.09);
      flashMaterial.opacity = 0.85 * flashFade;
      const flashScale = 3 + time * 26;
      flash.scale.setScalar(flashScale);

      const coreFade = Math.max(0, 1 - time / 0.16);
      coreMaterial.opacity = 0.95 * coreFade;
      const coreScale = 1.6 + Math.max(0, 0.6 - time * 2.5);
      core.scale.setScalar(coreScale);

      for (let i = 0; i < sparkData.length; i++) {
        const data = sparkData[i];
        data.age += dt;
        const ageNorm = Math.max(0, 1 - data.age / data.life);
        const dist = data.speed * data.age * 0.02;
        const px = Math.cos(data.angle) * dist;
        const pz = Math.sin(data.angle) * dist;

        sparkTransform.position.set(px, 0.12, pz);
        sparkTransform.rotation.set(-Math.PI / 2, 0, -data.angle);
        sparkTransform.scale.set(
          data.length * (0.5 + 0.5 * ageNorm),
          data.thickness * (0.7 + 0.3 * ageNorm),
          1,
        );
        sparkTransform.updateMatrix();
        sparks.setMatrixAt(i, sparkTransform.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;
      sparkMaterial.opacity = 0.9 * Math.max(0, 1 - time / 0.22);

      for (let i = smokes.length - 1; i >= 0; i--) {
        const smoke = smokes[i];
        const state = smoke.userData;
        state.age += dt;
        smoke.position.x += state.vx * dt;
        smoke.position.z += state.vz * dt;
        smoke.scale.multiplyScalar(1 + state.growth * dt);
        const lifeT = Math.min(1, state.age / state.life);
        smoke.material.opacity = 0.22 * (1 - lifeT) * Math.max(0, 1 - time / 0.55);
        if (state.age >= state.life) {
          group.remove(smoke);
          smoke.material.dispose();
          smokes.splice(i, 1);
        }
      }

      light.intensity = 140 * Math.max(0, 1 - time / 0.12);

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
      coreMaterial.dispose();
      sparks.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      smokes.forEach((smoke) => {
        smoke.material.dispose();
      });
      baseSmokeMaterial.dispose();
    }

    return { update, dispose, group };
  };
}

function makeRadialTexture(size = 256, inner = "#eaffff", mid = "rgba(120,220,255,0.9)", outer = "rgba(0,180,255,0)") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.32, mid);
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
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.48);
  gradient.addColorStop(0, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
