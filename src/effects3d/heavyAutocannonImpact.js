import * as THREE from "three";

const sharedTextures = {
  flash: null,
  ember: null,
  smoke: null,
};

const effectPool = [];

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
    const instance = effectPool.pop() || buildEffect();
    instance.reset({ x, y, z, size });
    scene.add(instance.group);

    const fx = {
      group: instance.group,
      update(dt) {
        if (instance.done) {
          if (instance.group.parent) {
            instance.group.parent.remove(instance.group);
          }
          if (!fx._returned) {
            fx._returned = true;
            effectPool.push(instance);
          }
          return;
        }

        instance.update(dt);

        if (instance.done && instance.group.parent) {
          instance.group.parent.remove(instance.group);
        }

        if (instance.done && !fx._returned) {
          fx._returned = true;
          effectPool.push(instance);
        }
      },
      dispose() {
        if (instance.group.parent) {
          instance.group.parent.remove(instance.group);
        }
        if (!fx._returned) {
          instance.dispose();
          fx._returned = true;
        }
      },
      _returned: false,
    };

    return fx;
  };
}

function buildEffect() {
  const group = new THREE.Group();

  const flashMaterial = new THREE.SpriteMaterial({
    map: sharedTextures.flash,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    opacity: 0.88,
    color: 0xffffff,
  });
  const flash = new THREE.Sprite(flashMaterial);
  flash.scale.setScalar(2);
  flash.position.y = 0.14;
  group.add(flash);

  const emberMaterial = new THREE.SpriteMaterial({
    map: sharedTextures.ember,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    opacity: 0.8,
    color: 0xffffff,
  });
  const ember = new THREE.Sprite(emberMaterial);
  ember.scale.setScalar(1.1);
  ember.position.y = 0.34;
  group.add(ember);

  const shockGeometry = new THREE.RingGeometry(0.34, 0.46, 28);
  const shockMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc27a,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shock = new THREE.Mesh(shockGeometry, shockMaterial);
  shock.rotation.x = -Math.PI / 2;
  shock.position.y = 0.02;
  group.add(shock);

  const sparkCount = 18;
  const sparkGeometry = new THREE.PlaneGeometry(1, 0.18);
  const sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd4a0,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, sparkCount);
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparks.frustumCulled = false;
  group.add(sparks);

  const sparkTransform = new THREE.Object3D();
  const sparkData = new Array(sparkCount).fill(null).map(() => ({
    angle: 0,
    speed: 0,
    life: 0,
    age: 0,
    length: 0,
    thickness: 0,
    tilt: -Math.PI / 2,
  }));

  const smokes = new Array(4).fill(null).map(() => {
    const mat = new THREE.SpriteMaterial({
      map: sharedTextures.smoke,
      color: 0xcfd7e6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.userData = { vx: 0, vz: 0, growth: 1, age: 0, life: 1 };
    group.add(sprite);
    return sprite;
  });

  const light = new THREE.PointLight(0xffc88a, 40, 80, 2.2);
  light.position.set(0, 3.2, 0);
  group.add(light);

  const state = {
    size: 42,
    time: 0,
    duration: 0.48,
    endDelay: 0.42,
    done: false,
  };

  function reset({ x = 0, y = 0, z, size = 42 }) {
    group.position.set(x, 0, z !== undefined ? z : y);
    group.scale.setScalar(size);

    state.size = size;
    state.time = 0;
    state.done = false;

    flashMaterial.opacity = 0.88;
    flash.scale.setScalar(2);

    emberMaterial.opacity = 0.8;
    ember.scale.setScalar(1.1);

    shockMaterial.opacity = 0.6;
    shock.scale.setScalar(1);

    const sizeFactor = Math.sqrt(size / 42);

    for (let i = 0; i < sparkData.length; i++) {
      const data = sparkData[i];
      data.angle = Math.random() * Math.PI * 2;
      data.speed = 38 + Math.random() * 56 * sizeFactor;
      data.life = 0.14 + Math.random() * 0.18;
      data.age = 0;
      data.length = 1.4 + Math.random() * 1.2;
      data.thickness = 0.14 + Math.random() * 0.1;

      sparkTransform.position.set(0, 0.08, 0);
      sparkTransform.rotation.set(data.tilt, 0, -data.angle);
      sparkTransform.scale.set(data.length, data.thickness, 1);
      sparkTransform.updateMatrix();
      sparks.setMatrixAt(i, sparkTransform.matrix);
    }
    sparks.instanceMatrix.needsUpdate = true;
    sparkMaterial.opacity = 0.95;

    smokes.forEach((sprite) => {
      const scale = 0.8 + Math.random() * 0.6 * sizeFactor;
      sprite.position.set(
        (Math.random() - 0.5) * 0.4,
        0.04 + Math.random() * 0.08,
        (Math.random() - 0.5) * 0.4,
      );
      sprite.scale.setScalar(scale);
      sprite.userData.vx = (Math.random() - 0.5) * 2.8;
      sprite.userData.vz = (Math.random() - 0.5) * 2.8;
      sprite.userData.growth = 0.6 + Math.random() * 0.45;
      sprite.userData.age = 0;
      sprite.userData.life = 0.7 + Math.random() * 0.36;
      sprite.material.opacity = 0.14;
    });

    light.intensity = 55 * sizeFactor;
    light.distance = 70 * sizeFactor;
  }

  function update(dt) {
    if (state.done) return;

    state.time += dt;
    const sizeFactor = Math.sqrt(state.size / 42);

    const flashFade = Math.max(0, 1 - state.time / 0.1);
    flashMaterial.opacity = 0.88 * flashFade;
    flash.scale.setScalar(2 + state.time * 12 * sizeFactor);

    const emberFade = Math.max(0, 1 - state.time / 0.18);
    emberMaterial.opacity = 0.8 * emberFade;
    ember.scale.setScalar(1.1 + state.time * 3.4);

    const ringScale = 0.38 + state.time * 3.1;
    shock.scale.setScalar(ringScale);
    shockMaterial.opacity = 0.6 * Math.max(0, 1 - state.time / 0.26);

    for (let i = 0; i < sparkData.length; i++) {
      const data = sparkData[i];
      data.age += dt;
      const lifeT = Math.max(0, 1 - data.age / data.life);
      const dist = data.speed * data.age * 0.014 * sizeFactor;
      const px = Math.cos(data.angle) * dist;
      const pz = Math.sin(data.angle) * dist;
      sparkTransform.position.set(px, 0.08, pz);
      sparkTransform.rotation.set(data.tilt, 0, -data.angle);
      sparkTransform.scale.set(
        data.length * (0.55 + 0.45 * lifeT),
        data.thickness * (0.55 + 0.45 * lifeT),
        1,
      );
      sparkTransform.updateMatrix();
      sparks.setMatrixAt(i, sparkTransform.matrix);
    }
    sparks.instanceMatrix.needsUpdate = true;
    sparkMaterial.opacity = 0.95 * Math.max(0, 1 - state.time / 0.22);

    smokes.forEach((sprite) => {
      const data = sprite.userData;
      data.age += dt;
      sprite.position.x += data.vx * dt * 0.4;
      sprite.position.z += data.vz * dt * 0.4;
      sprite.scale.multiplyScalar(1 + data.growth * dt * 0.5);
      const lifeT = Math.min(1, data.age / data.life);
      sprite.material.opacity = 0.14 * (1 - lifeT) * Math.max(0, 1 - state.time / 0.44);
    });

    light.intensity = 55 * sizeFactor * Math.max(0, 1 - state.time / 0.16);

    if (state.time > state.duration + state.endDelay) {
      state.done = true;
    }
  }

  function dispose() {
    state.done = true;
    sparkGeometry.dispose();
    sparkMaterial.dispose();
    shockGeometry.dispose();
    shockMaterial.dispose();
    flashMaterial.dispose();
    emberMaterial.dispose();
    smokes.forEach((sprite) => {
      sprite.material.dispose();
    });
  }

  return {
    group,
    reset,
    update,
    dispose,
    get done() {
      return state.done;
    },
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
