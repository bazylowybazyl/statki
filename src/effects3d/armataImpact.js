import * as THREE from "three";

const sharedTextures = {
  flash: null,
  smoke: null,
};

function ensureTextures() {
  if (!sharedTextures.flash) {
    sharedTextures.flash = makeRadialTexture(512, "#fff9d6", "rgba(255,170,70,0.95)", "rgba(120,40,0,0)");
  }
  if (!sharedTextures.smoke) {
    sharedTextures.smoke = makeSmokeTexture(256);
  }
}

export function createArmataImpactFactory(scene) {
  ensureTextures();

  return function spawn({ x = 0, y = 0, z, size = 70 } = {}) {
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
      opacity: 0.95,
      color: 0xffdf9a,
    });
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(3.4);
    flash.position.y = 0.22;
    group.add(flash);

    const coreMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.flash,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 1.0,
      color: 0xffae4d,
    });
    const core = new THREE.Sprite(coreMaterial);
    core.scale.setScalar(1.8);
    core.position.y = 0.4;
    group.add(core);

    const ringGeometry = new THREE.RingGeometry(0.22, 0.52, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc067,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    const shardCount = 42;
    const shardGeometry = new THREE.PlaneGeometry(0.18, 0.9);
    const shardMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff5d6,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, shardCount);
    shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shards.frustumCulled = false;
    group.add(shards);

    const shardTransform = new THREE.Object3D();
    const shardData = new Array(shardCount).fill(null).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 55 + Math.random() * 160;
      const life = 0.2 + Math.random() * 0.28;
      const tilt = (Math.random() - 0.5) * 0.8;
      const length = 2.4 + Math.random() * 2.2;
      return {
        angle,
        speed,
        life,
        age: 0,
        tilt,
        length,
      };
    });

    shardData.forEach((data, i) => {
      shardTransform.position.set(0, 0.2, 0);
      shardTransform.rotation.set(-Math.PI / 2 + data.tilt, 0, -data.angle);
      shardTransform.scale.set(data.length, 0.4, 1);
      shardTransform.updateMatrix();
      shards.setMatrixAt(i, shardTransform.matrix);
    });
    shards.instanceMatrix.needsUpdate = true;

    const embers = [];
    const emberMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.flash,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      color: 0xffe0a0,
      opacity: 0.85,
    });
    for (let i = 0; i < 18; i++) {
      const ember = new THREE.Sprite(emberMaterial.clone());
      ember.scale.setScalar(0.35 + Math.random() * 0.4);
      ember.position.set((Math.random() - 0.5) * 0.6, 0.18 + Math.random() * 0.2, (Math.random() - 0.5) * 0.6);
      ember.userData = {
        vx: (Math.random() - 0.5) * 26,
        vz: (Math.random() - 0.5) * 26,
        life: 0.4 + Math.random() * 0.28,
        age: 0,
      };
      embers.push(ember);
      group.add(ember);
    }

    const smokeMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.smoke,
      color: 0x3b2a1c,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const smokes = [];
    for (let i = 0; i < 12; i++) {
      const smoke = new THREE.Sprite(smokeMaterial.clone());
      smoke.position.set((Math.random() - 0.5) * 0.7, 0.05, (Math.random() - 0.5) * 0.7);
      const s = 0.9 + Math.random() * 1.3;
      smoke.scale.setScalar(s);
      smoke.userData = {
        vx: (Math.random() - 0.5) * 4,
        vz: (Math.random() - 0.5) * 4,
        rise: 0.4 + Math.random() * 0.4,
        growth: 1.1 + Math.random() * 0.6,
        life: 0.8 + Math.random() * 0.6,
        age: 0,
      };
      smokes.push(smoke);
      group.add(smoke);
    }

    const light = new THREE.PointLight(0xffb060, 140, 150 * size, 1.8);
    light.position.set(0, 5, 0);
    group.add(light);

    let time = 0;
    let disposed = false;

    function update(dt) {
      if (disposed) return;
      time += dt;

      const flashFade = Math.max(0, 1 - time / 0.12);
      flashMaterial.opacity = 0.95 * flashFade;
      flash.scale.setScalar(3.4 + time * 24);

      const coreFade = Math.max(0, 1 - time / 0.18);
      coreMaterial.opacity = 1.0 * coreFade;
      core.scale.setScalar(Math.max(0.6, 1.8 - time * 3.4));

      ring.scale.setScalar(0.4 + time * 5.6);
      ringMaterial.opacity = 0.9 * Math.max(0, 1 - time / 0.32);

      for (let i = 0; i < shardData.length; i++) {
        const data = shardData[i];
        data.age += dt;
        const t = Math.min(1, data.age / data.life);
        const dist = data.speed * data.age * 0.02;
        const px = Math.cos(data.angle) * dist;
        const pz = Math.sin(data.angle) * dist;
        shardTransform.position.set(px, 0.18 + data.age * 0.6, pz);
        shardTransform.rotation.set(-Math.PI / 2 + data.tilt, 0, -data.angle);
        const fade = 1 - t;
        shardTransform.scale.set(data.length * fade, 0.4 * fade, 1);
        shardTransform.updateMatrix();
        shards.setMatrixAt(i, shardTransform.matrix);
      }
      shards.instanceMatrix.needsUpdate = true;
      shardMaterial.opacity = Math.max(0, 1 - time / 0.22);

      for (let i = embers.length - 1; i >= 0; i--) {
        const ember = embers[i];
        const state = ember.userData;
        state.age += dt;
        ember.position.x += state.vx * dt * 0.04;
        ember.position.z += state.vz * dt * 0.04;
        ember.position.y += 0.4 * dt;
        const fade = Math.max(0, 1 - state.age / state.life);
        ember.material.opacity = 0.85 * fade * Math.max(0, 1 - time / 0.4);
        if (state.age >= state.life) {
          group.remove(ember);
          ember.material.dispose();
          embers.splice(i, 1);
        }
      }

      for (let i = smokes.length - 1; i >= 0; i--) {
        const smoke = smokes[i];
        const state = smoke.userData;
        state.age += dt;
        smoke.position.x += state.vx * dt * 0.3;
        smoke.position.z += state.vz * dt * 0.3;
        smoke.position.y += state.rise * dt * 0.4;
        smoke.scale.multiplyScalar(1 + state.growth * dt * 0.6);
        const fade = Math.max(0, 1 - state.age / state.life);
        smoke.material.opacity = 0.32 * fade * Math.max(0, 1 - time / 0.7);
        if (state.age >= state.life) {
          group.remove(smoke);
          smoke.material.dispose();
          smokes.splice(i, 1);
        }
      }

      light.intensity = 140 * Math.max(0, 1 - time / 0.18);

      if (time > 1.0) {
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
      ringGeometry.dispose();
      ringMaterial.dispose();
      shards.dispose();
      shardGeometry.dispose();
      shardMaterial.dispose();
      embers.forEach((ember) => {
        ember.material.dispose();
      });
      smokes.forEach((smoke) => {
        smoke.material.dispose();
      });
      smokeMaterial.dispose();
    }

    return { group, update, dispose };
  };
}

function makeRadialTexture(size = 256, inner = "#fff2c2", mid = "rgba(255,150,40,0.9)", outer = "rgba(120,40,0,0)") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.28, mid);
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
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
  gradient.addColorStop(0, "rgba(90,50,30,0.55)");
  gradient.addColorStop(1, "rgba(90,50,30,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
