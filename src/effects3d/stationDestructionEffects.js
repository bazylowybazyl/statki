import * as THREE from "three";

const noiseChunk = `
float hash(float n) { return fract(sin(n) * 43758.5453123); }
float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0 + 113.0 * p.z;
    return mix(mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
                   mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
               mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                   mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
}
float fbm(vec3 p) {
    float f = 0.0;
    f += 0.5000 * noise(p); p *= 2.02;
    f += 0.2500 * noise(p); p *= 2.03;
    f += 0.1250 * noise(p); p *= 2.01;
    return f;
}
`;

class GPUInstancedParticleManager {
    constructor(scene, maxParticles, blendingType) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0;
        this.drawCount = 0;
        this.dirty = false;

        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute("position", baseGeo.attributes.position);
        geo.setAttribute("uv", baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4);
        this.extra = new Float32Array(maxParticles * 4);

        this.startPosAttr = new THREE.InstancedBufferAttribute(this.startPos, 3).setUsage(THREE.DynamicDrawUsage);
        this.startVelAttr = new THREE.InstancedBufferAttribute(this.startVel, 3).setUsage(THREE.DynamicDrawUsage);
        this.dataAttr = new THREE.InstancedBufferAttribute(this.dataInfo, 4).setUsage(THREE.DynamicDrawUsage);
        this.extraAttr = new THREE.InstancedBufferAttribute(this.extra, 4).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aStartPos", this.startPosAttr);
        geo.setAttribute("aStartVel", this.startVelAttr);
        geo.setAttribute("aData", this.dataAttr);
        geo.setAttribute("aExtra", this.extraAttr);
        geo.instanceCount = 0;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
attribute vec3 aStartPos;
attribute vec3 aStartVel;
attribute vec4 aData;
attribute vec4 aExtra;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
varying float vType;
varying float vAgeNorm;
varying float vSeed;
varying vec4 vExtra;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
    vUv = uv;
    vType = aData.w;
    vSeed = hash(aData.x + aExtra.w * 17.13);
    vExtra = aExtra;
    float age = uTime - aData.x;
    if (age < 0.0 || age > aData.y) {
        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
        return;
    }
    float ratio = 1.0 - (age / aData.y);
    vAgeNorm = age / aData.y;
    vec3 pos = aStartPos + aStartVel * age;
    float sz = aData.z;
    vec4 mvp;

    if (vType < 1.5) {
        sz = aData.z * (0.3 + pow(1.0 - ratio, 0.25) * 0.7);
        vec3 tint = (length(aExtra.xyz) > 0.01) ? aExtra.xyz : vec3(1.5, 1.2, 0.7);
        vColor = mix(vec3(1.6, 1.4, 1.0), tint, vAgeNorm) * 2.0;
        vAlpha = pow(ratio, 3.0);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += position.xy * sz;
    } else if (vType < 2.5) {
        sz = aData.z * (0.4 + pow(vAgeNorm, 0.4) * 1.4);
        vec3 tint = (length(aExtra.xyz) > 0.01) ? aExtra.xyz : vec3(1.0, 0.55, 0.25);
        vec3 hc = vec3(1.8, 1.4, 0.9);
        vec3 mf = tint;
        vec3 de = vec3(0.15, 0.06, 0.02);
        vColor = (vAgeNorm < 0.25) ? mix(hc, mf, vAgeNorm / 0.25) : mix(mf, de, (vAgeNorm - 0.25) / 0.75);
        vColor *= 1.4;
        vAlpha = pow(ratio, 1.4);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += position.xy * sz;
    } else if (vType < 3.5) {
        float drag = 1.5 + vSeed * 1.5;
        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
        vec3 cv = aStartVel * exp(-age * drag);
        float spd = length(cv);
        vColor = mix(vec3(1.4, 1.1, 0.8), vec3(0.6, 0.2, 0.05), pow(vAgeNorm, 0.5)) * 1.4;
        vAlpha = pow(ratio, 0.7);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        vec3 viewVel3 = (modelViewMatrix * vec4(cv, 0.0)).xyz;
        vec2 dir = normalize(viewVel3.xy);
        if (length(viewVel3.xy) < 0.1) dir = vec2(0.0, 1.0);
        float w = aData.z * 0.4;
        float str = aData.z * spd * 0.0022;
        float tf = 0.5 - position.y;
        vec2 so;
        so.x = position.x * w;
        so.y = -tf * str;
        mvp.xy += vec2(so.x * dir.y + so.y * dir.x, -so.x * dir.x + so.y * dir.y);
    } else if (vType < 4.5) {
        float drag = 0.6 + vSeed * 0.6;
        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
        vec3 tint = (length(aExtra.xyz) > 0.01) ? aExtra.xyz : vec3(1.2, 0.8, 0.3);
        vColor = mix(tint, vec3(0.4, 0.1, 0.02), pow(vAgeNorm, 0.5)) * 1.6;
        vAlpha = pow(ratio, 0.4);
        sz = aData.z * (1.0 - vAgeNorm * 0.3);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += position.xy * sz;
    } else if (vType < 5.5) {
        sz = aData.z * (0.5 + vAgeNorm * 0.5);
        vec3 tint = (length(aExtra.xyz) > 0.01) ? aExtra.xyz : vec3(1.1, 0.85, 0.55);
        vColor = tint * 5.5;
        vAlpha = pow(ratio, 4.0);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += position.xy * sz;
    } else if (vType < 6.5) {
        sz = aData.z * pow(vAgeNorm, 0.3);
        vec3 tint = (length(aExtra.xyz) > 0.01) ? aExtra.xyz : vec3(1.0, 0.55, 0.3);
        vColor = tint * 2.8;
        vAlpha = pow(1.0 - vAgeNorm, 2.0);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += position.xy * sz;
    } else if (vType < 7.5) {
        float drag = 1.0 + vSeed;
        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
        vec3 h = vec3(1.6, 1.2, 0.6);
        vec3 m = vec3(0.9, 0.3, 0.1);
        vec3 c = vec3(0.1, 0.03, 0.01);
        vColor = (vAgeNorm < 0.3) ? mix(h, m, vAgeNorm / 0.3) : mix(m, c, (vAgeNorm - 0.3) / 0.7);
        vColor *= 1.3;
        vAlpha = pow(ratio, 0.7);
        sz = aData.z * (1.0 - vAgeNorm * 0.5);
        float sp = (vSeed - 0.5) * 12.0;
        float cn = cos(age * sp);
        float sn = sin(age * sp);
        vec2 rp = vec2(position.x * cn - position.y * sn, position.x * sn + position.y * cn);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += rp * sz;
    } else if (vType < 8.5) {
        float drag = 0.8 + vSeed * 0.5;
        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
        vec3 cv = aStartVel * exp(-age * drag);
        float spd = length(cv);
        vec3 tint = (length(aExtra.xyz) > 0.01) ? aExtra.xyz : vec3(1.4, 1.0, 0.55);
        vColor = mix(vec3(2.0, 1.6, 0.9), tint, pow(vAgeNorm, 0.5)) * 1.6;
        vColor = mix(vColor, vec3(0.25, 0.06, 0.02), pow(vAgeNorm, 1.4));
        vAlpha = pow(ratio, 0.75);
        sz = aData.z * (0.6 + vAgeNorm * 0.9);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        vec3 viewVel3 = (modelViewMatrix * vec4(cv, 0.0)).xyz;
        vec2 dir = normalize(viewVel3.xy);
        if (length(viewVel3.xy) < 0.1) dir = vec2(0.0, 1.0);
        float w = sz * 0.55;
        float str = sz * spd * 0.0040;
        float tf = 0.5 - position.y;
        vec2 so;
        so.x = position.x * w;
        so.y = -tf * str;
        mvp.xy += vec2(so.x * dir.y + so.y * dir.x, -so.x * dir.x + so.y * dir.y);
    } else if (vType < 9.5) {
        float drag = 0.3 + vSeed * 0.25;
        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
        vAlpha = pow(ratio, 0.55);
        vec3 h = vec3(1.8, 1.2, 0.45);
        vec3 m = vec3(1.0, 0.4, 0.1);
        vec3 c = vec3(0.25, 0.05, 0.015);
        vColor = (vAgeNorm < 0.35) ? mix(h, m, vAgeNorm / 0.35) : mix(m, c, (vAgeNorm - 0.35) / 0.65);
        vColor *= 2.2;
        float spinSpeed = (vSeed - 0.5) * 14.0 + aExtra.z;
        float spin = age * spinSpeed;
        float cs = cos(spin);
        float sn = sin(spin);
        float squish = 0.55 + 0.45 * cos(age * (spinSpeed * 1.3) + aExtra.w * 6.28);
        vec2 rp = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
        rp.y *= squish;
        sz = aData.z * (1.0 - vAgeNorm * 0.25);
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += rp * sz;
    } else if (vType < 10.5) {
        float drag = 0.9 + vSeed * 0.4;
        pos = aStartPos + aStartVel * ((1.0 - exp(-age * drag)) / drag);
        sz = aData.z * (0.7 + 0.3 * sin(age * 10.0 + vSeed * 12.0));
        vec3 h = vec3(1.6, 0.8, 0.25);
        vec3 c = vec3(0.5, 0.08, 0.01);
        vColor = mix(h, c, pow(vAgeNorm, 0.4)) * 1.4;
        float flick = 0.55 + 0.45 * sin(age * 14.0 + vSeed * 9.0);
        vAlpha = pow(ratio, 1.2) * flick;
        mvp = modelViewMatrix * vec4(pos, 1.0);
        mvp.xy += position.xy * sz;
    } else {
        vec3 n = normalize(aExtra.xyz + vec3(0.0, 0.0001, 0.0));
        vec3 up = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 e1 = normalize(cross(up, n));
        vec3 e2 = cross(n, e1);
        sz = aData.z * pow(vAgeNorm, 0.45);
        vec3 fp = pos + (e1 * position.x + e2 * position.y) * sz;
        vec3 tint = vec3(1.2, 0.95, 0.55);
        vColor = tint * 3.2;
        vAlpha = pow(1.0 - vAgeNorm, 1.4);
        mvp = modelViewMatrix * vec4(fp, 1.0);
    }

    gl_Position = projectionMatrix * mvp;
}
`,
            fragmentShader: `
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
varying float vType;
varying float vAgeNorm;
varying float vSeed;
varying vec4 vExtra;
uniform float uTime;
${noiseChunk}
void main() {
    vec2 uv = vUv - vec2(0.5);
    float dist = length(uv) * 2.0;
    if (vType < 1.5) {
        float c = max(0.0, 1.0 - smoothstep(0.0, 0.4, dist));
        float sy = max(0.0, 1.0 - smoothstep(0.0, 0.05, abs(uv.y))) * (1.0 - abs(uv.x) * 1.6);
        float sx = max(0.0, 1.0 - smoothstep(0.0, 0.05, abs(uv.x))) * (1.0 - abs(uv.y) * 1.6);
        gl_FragColor = vec4(vColor, (c * 1.5 + sy + sx * 0.6) * vAlpha);
    } else if (vType < 2.5) {
        if (dist > 1.0) discard;
        float n = fbm(vec3(uv * 3.0, vSeed * 50.0 + uTime * 0.5));
        float l = smoothstep(0.0, 0.6, n + max(0.0, 1.0 - dist) * 0.7 - 0.4);
        gl_FragColor = vec4(vColor, l * vAlpha);
    } else if (vType < 3.5) {
        vec2 pt = vUv - vec2(0.5);
        float gx = pow(max(0.0, 0.5 - abs(pt.x)) * 2.0, 2.5);
        float fy = smoothstep(1.0, 0.85, vUv.y) * smoothstep(0.0, 0.15, vUv.y);
        float hd = smoothstep(0.6, 0.95, vUv.y) * 1.5;
        gl_FragColor = vec4(vColor, gx * (fy + hd) * vAlpha);
    } else if (vType < 4.5) {
        if (dist > 1.0) discard;
        float c = max(0.0, 1.0 - smoothstep(0.0, 0.6, dist));
        float h = max(0.0, 1.0 - smoothstep(0.0, 1.0, dist)) * 0.3;
        gl_FragColor = vec4(vColor, (c + h) * vAlpha);
    } else if (vType < 5.5) {
        float c = max(0.0, 1.0 - smoothstep(0.0, 0.25, dist));
        float fy = max(0.0, 1.0 - smoothstep(0.0, 0.015, abs(uv.y)));
        float fx = max(0.0, 1.0 - smoothstep(0.0, 0.55, abs(uv.x)));
        float fi = max(0.0, c + fy * fx * 2.5 + max(0.0, 1.0 - dist) * 0.5);
        gl_FragColor = vec4(vColor * fi, fi * vAlpha);
    } else if (vType < 6.5) {
        if (dist > 1.0) discard;
        float e = max(0.0, 1.0 - smoothstep(0.0, 0.06, abs(dist - 0.85)));
        float n = 0.7 + 0.3 * fbm(vec3(atan(uv.y, uv.x) * 8.0, dist * 3.0, uTime * 0.3));
        gl_FragColor = vec4(vColor, e * n * vAlpha);
    } else if (vType < 7.5) {
        float n = fbm(vec3(uv * 4.0, vSeed * 30.0));
        float ch = smoothstep(0.45, 0.65, n * 0.6 + max(0.0, 1.0 - dist * 1.2));
        if (ch < 0.05) discard;
        gl_FragColor = vec4(vColor + vec3(0.5, 0.25, 0.08) * max(0.0, 1.0 - smoothstep(0.0, 0.4, dist)) * 1.3, ch * vAlpha);
    } else if (vType < 8.5) {
        vec2 pt = vUv - vec2(0.5);
        float gx = pow(max(0.0, 0.5 - abs(pt.x)) * 2.0, 3.0);
        float fy = smoothstep(1.0, 0.70, vUv.y) * smoothstep(0.0, 0.10, vUv.y);
        float hd = smoothstep(0.55, 1.0, vUv.y) * 2.2;
        float n = fbm(vec3(vUv * 6.0, vSeed * 40.0 + uTime * 1.5));
        float streak = gx * (fy + hd) * (0.55 + 0.9 * n);
        gl_FragColor = vec4(vColor, streak * vAlpha);
    } else if (vType < 9.5) {
        if (dist > 1.0) discard;
        vec2 ruv = uv * 1.8;
        float n = fbm(vec3(ruv * 2.5 + vSeed * 50.0, vSeed * 20.0 + uTime * 0.3));
        float body = smoothstep(0.95, 0.15, dist) * (0.4 + 0.7 * n);
        float rim = smoothstep(0.55, 0.95, dist) * (1.0 - smoothstep(0.95, 1.0, dist));
        rim *= 1.5;
        float a = body + rim;
        if (a < 0.05) discard;
        vec3 col = vColor + vec3(0.8, 0.35, 0.1) * rim * 1.5;
        gl_FragColor = vec4(col, a * vAlpha);
    } else if (vType < 10.5) {
        if (dist > 1.0) discard;
        float c = max(0.0, 1.0 - smoothstep(0.0, 0.5, dist));
        float h = max(0.0, 1.0 - smoothstep(0.0, 1.0, dist)) * 0.35;
        gl_FragColor = vec4(vColor, (c * 1.3 + h) * vAlpha);
    } else {
        if (dist > 1.0) discard;
        float ring = max(0.0, 1.0 - smoothstep(0.0, 0.12, abs(dist - 0.82)));
        float inner = max(0.0, 1.0 - smoothstep(0.0, 0.82, dist)) * 0.15;
        float n = 0.6 + 0.4 * fbm(vec3(atan(uv.y, uv.x) * 7.0, dist * 4.0, uTime * 0.5));
        gl_FragColor = vec4(vColor, (ring * n + inner) * vAlpha);
    }
}
`,
            blending: blendingType,
            depthWrite: false,
            depthTest: false,
            transparent: true,
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1000;
        scene.add(this.mesh);
    }

    spawn(x, y, z, vx, vy, vz, size, life, type, gt, ex = 0, ey = 0, ez = 0, ew = 0) {
        const i = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        const i3 = i * 3;
        const i4 = i * 4;
        this.startPos[i3] = x;
        this.startPos[i3 + 1] = y;
        this.startPos[i3 + 2] = z;
        this.startVel[i3] = vx;
        this.startVel[i3 + 1] = vy;
        this.startVel[i3 + 2] = vz;
        this.dataInfo[i4] = gt;
        this.dataInfo[i4 + 1] = life;
        this.dataInfo[i4 + 2] = size;
        this.dataInfo[i4 + 3] = type;
        this.extra[i4] = ex;
        this.extra[i4 + 1] = ey;
        this.extra[i4 + 2] = ez;
        this.extra[i4 + 3] = ew;
        this.startPosAttr.addUpdateRange(i3, 3);
        this.startVelAttr.addUpdateRange(i3, 3);
        this.dataAttr.addUpdateRange(i4, 4);
        this.extraAttr.addUpdateRange(i4, 4);
        if (this.drawCount < this.maxParticles) {
            this.drawCount = Math.max(this.drawCount, i + 1);
            this.mesh.geometry.instanceCount = this.drawCount;
        }
        this.dirty = true;
    }

    update(gt) {
        this.material.uniforms.uTime.value = gt;
        if (!this.dirty) return;
        this.startPosAttr.needsUpdate = true;
        this.startVelAttr.needsUpdate = true;
        this.dataAttr.needsUpdate = true;
        this.extraAttr.needsUpdate = true;
        this.dirty = false;
    }

    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

class GPUParticleManager {
    constructor(scene, maxParticles, blendingType) {
        this.maxParticles = maxParticles;
        this.activeIndex = 0;
        this.drawCount = 0;
        this.dirty = false;

        const baseGeo = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = baseGeo.index;
        geo.setAttribute("position", baseGeo.attributes.position);
        geo.setAttribute("uv", baseGeo.attributes.uv);

        this.startPos = new Float32Array(maxParticles * 3);
        this.startVel = new Float32Array(maxParticles * 3);
        this.dataInfo = new Float32Array(maxParticles * 4);
        this.startPosAttr = new THREE.InstancedBufferAttribute(this.startPos, 3).setUsage(THREE.DynamicDrawUsage);
        this.startVelAttr = new THREE.InstancedBufferAttribute(this.startVel, 3).setUsage(THREE.DynamicDrawUsage);
        this.dataAttr = new THREE.InstancedBufferAttribute(this.dataInfo, 4).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aStartPos", this.startPosAttr);
        geo.setAttribute("aStartVel", this.startVelAttr);
        geo.setAttribute("aData", this.dataAttr);
        geo.instanceCount = 0;

        this.material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
attribute vec3 aStartPos;
attribute vec3 aStartVel;
attribute vec4 aData;
uniform float uTime;
varying float vAlpha;
varying vec2 vUv;
varying float vAgeNorm;
void main() {
    vUv = uv;
    float age = uTime - aData.x;
    if (age < 0.0 || age > aData.y) {
        gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
        return;
    }
    vAgeNorm = age / aData.y;
    vec3 pos = aStartPos + aStartVel * age;
    float sz = aData.z * (0.6 + vAgeNorm * 1.4);
    vAlpha = pow(1.0 - vAgeNorm, 1.6) * 0.38;
    vec4 mvp = modelViewMatrix * vec4(pos, 1.0);
    mvp.xy += position.xy * sz;
    gl_Position = projectionMatrix * mvp;
}
`,
            fragmentShader: `
varying float vAlpha;
varying vec2 vUv;
varying float vAgeNorm;
uniform float uTime;
${noiseChunk}
void main() {
    vec2 uv = vUv - vec2(0.5);
    float dist = length(uv) * 2.0;
    if (dist > 1.0) discard;
    float n = fbm(vec3(uv * 3.0, uTime * 0.2 + vAgeNorm * 4.0));
    float a = smoothstep(1.0, 0.15, dist) * (0.45 + n * 0.55) * vAlpha;
    vec3 col = mix(vec3(0.08, 0.07, 0.065), vec3(0.34, 0.13, 0.05), max(0.0, 1.0 - vAgeNorm * 1.8));
    gl_FragColor = vec4(col, a);
}
`,
            blending: blendingType,
            depthWrite: false,
            depthTest: false,
            transparent: true,
        });

        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 999;
        scene.add(this.mesh);
    }

    spawn(x, y, z, vx, vy, vz, size, life, type, gt) {
        const i = this.activeIndex;
        this.activeIndex = (this.activeIndex + 1) % this.maxParticles;
        const i3 = i * 3;
        const i4 = i * 4;
        this.startPos[i3] = x;
        this.startPos[i3 + 1] = y;
        this.startPos[i3 + 2] = z;
        this.startVel[i3] = vx;
        this.startVel[i3 + 1] = vy;
        this.startVel[i3 + 2] = vz;
        this.dataInfo[i4] = gt;
        this.dataInfo[i4 + 1] = life;
        this.dataInfo[i4 + 2] = size;
        this.dataInfo[i4 + 3] = type;
        this.startPosAttr.addUpdateRange(i3, 3);
        this.startVelAttr.addUpdateRange(i3, 3);
        this.dataAttr.addUpdateRange(i4, 4);
        if (this.drawCount < this.maxParticles) {
            this.drawCount = Math.max(this.drawCount, i + 1);
            this.mesh.geometry.instanceCount = this.drawCount;
        }
        this.dirty = true;
    }

    update(gt) {
        this.material.uniforms.uTime.value = gt;
        if (!this.dirty) return;
        this.startPosAttr.needsUpdate = true;
        this.startVelAttr.needsUpdate = true;
        this.dataAttr.needsUpdate = true;
        this.dirty = false;
    }

    dispose() {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

function randomSphereDir(out = new THREE.Vector3()) {
    const a = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    return out.set(
        Math.sin(phi) * Math.cos(a),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(a)
    );
}

function addTrackedEffect(activeEffects, effect) {
    activeEffects.push(effect);
    return effect;
}

export function createStationDestructionEffectsFactory(scene, opts = {}) {
    const fireSystem = new GPUInstancedParticleManager(scene, opts.maxFireParticles ?? 32000, THREE.AdditiveBlending);
    const smokeSystem = new GPUParticleManager(scene, opts.maxSmokeParticles ?? 8000, THREE.NormalBlending);
    const activeEffects = [];
    const tmpDir = new THREE.Vector3();
    const tmpDir2 = new THREE.Vector3();

    function spawnModulePop({ pos, color = null, size = 1.0, gt = null, detail = 1.0 }) {
        const gt0 = gt ?? performance.now() / 1000;
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;
        const tintR = color ? color.r : 1.4;
        const tintG = color ? color.g : 0.7;
        const tintB = color ? color.b : 0.25;

        fireSystem.spawn(x, y, z, 0, 0, 0, 14 * size, 0.12, 1, gt0, tintR * 1.2, tintG, tintB * 0.7, 0);
        const detailMul = THREE.MathUtils.clamp(detail, 0.35, 1.0);
        const coreCount = Math.max(2, Math.round(4 * detailMul));
        const sparkCount = Math.max(8, Math.round(24 * detailMul));
        const smokeCount = Math.max(1, Math.round(3 * detailMul));

        for (let i = 0; i < coreCount; i++) {
            randomSphereDir(tmpDir);
            const sp = (6 + Math.random() * 12) * size;
            fireSystem.spawn(x, y, z, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (9 + Math.random() * 6) * size, 0.28 + Math.random() * 0.15, 2, gt0, tintR, tintG * 0.9, tintB * 0.9, 0);
        }
        for (let i = 0; i < sparkCount; i++) {
            randomSphereDir(tmpDir);
            const sp = (40 + Math.random() * 90) * size;
            fireSystem.spawn(x, y, z, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (0.9 + Math.random() * 0.7) * size, 0.22 + Math.random() * 0.22, 4, gt0, tintR * 1.1, tintG * 1.1, tintB * 0.6, 0);
        }
        fireSystem.spawn(x, y, z, 0, 0, 0, 40 * size, 0.35, 6, gt0, tintR, tintG * 0.9, tintB * 0.8, 0);
        for (let i = 0; i < smokeCount; i++) {
            randomSphereDir(tmpDir);
            const sp = (2 + Math.random() * 4) * size;
            smokeSystem.spawn(x, y, z, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (16 + Math.random() * 10) * size, 0.7 + Math.random() * 0.35, 1, gt0);
        }
    }

    function spawnChainReaction({ center, count = 8, radius = 280, duration = 0.8, color = null, size = 1.0, detail = 0.65 }) {
        const gt0 = performance.now() / 1000;
        const popSchedule = [];
        for (let i = 0; i < count; i++) {
            randomSphereDir(tmpDir);
            const delay = Math.random() * duration;
            const r = Math.pow(Math.random(), 0.6) * radius;
            const pos = center.clone().addScaledVector(tmpDir, r);
            const c = color ? color.clone() : new THREE.Color(1.4, 0.7, 0.25);
            c.r *= 0.85 + Math.random() * 0.3;
            c.g *= 0.85 + Math.random() * 0.3;
            c.b *= 0.85 + Math.random() * 0.3;
            popSchedule.push({ delay, pos, color: c, size: size * (0.75 + Math.random() * 0.5) });
        }
        popSchedule.sort((a, b) => a.delay - b.delay);

        const light = new THREE.PointLight(0xff8833, 4, radius * 3.0);
        light.position.copy(center);
        scene.add(light);

        let disposed = false;
        let fired = 0;
        const effect = {
            update() {
                if (disposed) return;
                const gt = performance.now() / 1000;
                const t = gt - gt0;
                while (fired < popSchedule.length && popSchedule[fired].delay <= t) {
                    const p = popSchedule[fired++];
                    spawnModulePop({ pos: p.pos, color: p.color, size: p.size, gt, detail });
                }
                if (t < duration + 0.3) {
                    light.intensity = (3 + Math.random() * 3) * Math.max(0, 1 - t / (duration + 0.3));
                    light.position.set(
                        center.x + (Math.random() - 0.5) * radius * 0.3,
                        center.y + (Math.random() - 0.5) * radius * 0.3,
                        center.z + (Math.random() - 0.5) * radius * 0.3
                    );
                } else {
                    light.intensity = 0;
                }
                if (t >= duration + 1.5) this.dispose();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                if (light.parent) light.parent.remove(light);
                const idx = activeEffects.indexOf(effect);
                if (idx !== -1) activeEffects.splice(idx, 1);
            },
        };
        return addTrackedEffect(activeEffects, effect);
    }

    function spawnCutBlast({ pos, cutAxis = new THREE.Vector3(1, 0, 0), size = 1.0 }) {
        const gt0 = performance.now() / 1000;
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;
        const axis = cutAxis.clone().normalize();
        if (axis.lengthSq() < 0.001) axis.set(1, 0, 0);

        const light = new THREE.PointLight(0xff9944, 12, 2200 * Math.max(1, size));
        light.position.set(x, y, z);
        scene.add(light);

        fireSystem.spawn(x, y, z, 0, 0, 0, 180 * size, 0.22, 5, gt0, 1.3, 1.05, 0.65, 0);
        fireSystem.spawn(x, y, z, 0, 0, 0, 90 * size, 0.14, 1, gt0, 1.6, 1.2, 0.75, 0);

        for (let i = 0; i < 30; i++) {
            randomSphereDir(tmpDir);
            const sp = (8 + Math.random() * 18) * size;
            fireSystem.spawn(
                x + (Math.random() - 0.5) * 40 * size,
                y + (Math.random() - 0.5) * 40 * size,
                z + (Math.random() - 0.5) * 40 * size,
                tmpDir.x * sp,
                tmpDir.y * sp * 0.4 + Math.random() * 5 * size,
                tmpDir.z * sp,
                (40 + Math.random() * 40) * size,
                0.6 + Math.random() * 0.45,
                2,
                gt0,
                1.0,
                0.55,
                0.25,
                0
            );
        }

        const up = Math.abs(axis.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const perp1 = new THREE.Vector3().crossVectors(up, axis).normalize();
        const perp2 = new THREE.Vector3().crossVectors(axis, perp1).normalize();

        for (let side = 0; side < 2; side++) {
            const sign = side === 0 ? 1 : -1;
            for (let i = 0; i < 140; i++) {
                const spread = 0.35;
                const ang = Math.random() * Math.PI * 2;
                const rad = Math.pow(Math.random(), 1.6) * spread;
                tmpDir.copy(axis).multiplyScalar(sign)
                    .addScaledVector(perp1, Math.cos(ang) * rad)
                    .addScaledVector(perp2, Math.sin(ang) * rad)
                    .normalize();
                const spd = (200 + Math.random() * 650) * size;
                fireSystem.spawn(
                    x + tmpDir.x * 20 * size + (Math.random() - 0.5) * 15 * size,
                    y + tmpDir.y * 20 * size + (Math.random() - 0.5) * 15 * size,
                    z + tmpDir.z * 20 * size + (Math.random() - 0.5) * 15 * size,
                    tmpDir.x * spd,
                    tmpDir.y * spd,
                    tmpDir.z * spd,
                    (8 + Math.random() * 10) * size,
                    0.55 + Math.random() * 0.65,
                    8,
                    gt0,
                    1.3 + Math.random() * 0.3,
                    0.85 + Math.random() * 0.2,
                    0.45 + Math.random() * 0.2,
                    Math.random()
                );
            }
        }

        for (let i = 0; i < 200; i++) {
            const sideSign = Math.random() < 0.5 ? 1 : -1;
            const ang = Math.random() * Math.PI * 2;
            const rad = Math.pow(Math.random(), 1.6) * 0.7;
            tmpDir.copy(axis).multiplyScalar(sideSign)
                .addScaledVector(perp1, Math.cos(ang) * rad)
                .addScaledVector(perp2, Math.sin(ang) * rad)
                .normalize();
            const spd = (90 + Math.random() * 380) * size;
            fireSystem.spawn(x, y, z, tmpDir.x * spd, tmpDir.y * spd, tmpDir.z * spd, (0.9 + Math.random() * 0.9) * size, 0.5 + Math.random() * 0.6, 4, gt0, 1.3, 0.85, 0.4, 0);
        }

        fireSystem.spawn(x, y, z, 0, 0, 0, 1200 * size, 0.55, 11, gt0, axis.x, axis.y, axis.z, 0);

        for (let i = 0; i < 96; i++) {
            const ang = (i / 96) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;
            tmpDir.copy(perp1).multiplyScalar(Math.cos(ang)).addScaledVector(perp2, Math.sin(ang)).normalize();
            const spd = (260 + Math.random() * 280) * size;
            fireSystem.spawn(x, y, z, tmpDir.x * spd, tmpDir.y * spd, tmpDir.z * spd, (2.2 + Math.random() * 1.6) * size, 0.55 + Math.random() * 0.35, 4, gt0, 1.5, 1.1, 0.55, 0);
        }
        fireSystem.spawn(x, y, z, 0, 0, 0, 900 * size, 0.7, 6, gt0, 1.2, 0.75, 0.35, 0);

        for (let i = 0; i < 40; i++) {
            const ang = Math.random() * Math.PI * 2;
            const rad = Math.pow(Math.random(), 0.6) * 0.7;
            tmpDir.copy(axis).multiplyScalar(Math.random() < 0.5 ? 1 : -1)
                .addScaledVector(perp1, Math.cos(ang) * rad)
                .addScaledVector(perp2, Math.sin(ang) * rad)
                .normalize();
            const sp = (3 + Math.random() * 8) * size;
            smokeSystem.spawn(x, y, z, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (60 + Math.random() * 60) * size, 1.4 + Math.random() * 0.8, 1, gt0);
        }

        let disposed = false;
        let sec2Fired = false;
        const effect = {
            update() {
                if (disposed) return;
                const gt = performance.now() / 1000;
                const t = gt - gt0;
                light.intensity = Math.max(0, 12 * (1 - t / 0.5));
                if (!sec2Fired && t >= 0.18) {
                    fireSystem.spawn(x, y, z, 0, 0, 0, 1800 * size, 0.75, 11, gt, axis.x, axis.y, axis.z, 0);
                    fireSystem.spawn(x, y, z, 0, 0, 0, 1500 * size, 0.9, 6, gt, 1.0, 0.7, 0.4, 0);
                    for (let i = 0; i < 48; i++) {
                        const ang = (i / 48) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
                        tmpDir.copy(perp1).multiplyScalar(Math.cos(ang)).addScaledVector(perp2, Math.sin(ang)).normalize();
                        const spd = (180 + Math.random() * 180) * size;
                        fireSystem.spawn(x, y, z, tmpDir.x * spd, tmpDir.y * spd, tmpDir.z * spd, (1.8 + Math.random() * 1.2) * size, 0.5 + Math.random() * 0.3, 4, gt, 1.3, 0.9, 0.4, 0);
                    }
                    sec2Fired = true;
                }
                if (t >= 2.2) this.dispose();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                if (light.parent) light.parent.remove(light);
                const idx = activeEffects.indexOf(effect);
                if (idx !== -1) activeEffects.splice(idx, 1);
            },
        };
        return addTrackedEffect(activeEffects, effect);
    }

    function spawnFinalScatter({ pos, modelRadius = 300, size = 1.0 }) {
        const gt0 = performance.now() / 1000;
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;

        const light = new THREE.PointLight(0xffaa66, 18, 3500 * Math.max(1, size));
        light.position.set(x, y, z);
        scene.add(light);

        fireSystem.spawn(x, y, z, 0, 0, 0, 220 * size, 0.15, 1, gt0, 1.7, 1.3, 0.85, 0);
        fireSystem.spawn(x, y, z, 0, 0, 0, 320 * size, 0.35, 5, gt0, 1.2, 0.95, 0.6, 0);
        fireSystem.spawn(x, y, z, 0, 0, 0, 280 * size, 0.5, 5, gt0, 1.15, 0.8, 0.55, 0);
        fireSystem.spawn(x, y, z, 0, 0, 0, 1400 * size, 1.0, 6, gt0, 1.3, 0.75, 0.35, 0);
        fireSystem.spawn(x, y, z, 0, 0, 0, 2000 * size, 1.6, 6, gt0, 1.1, 0.55, 0.25, 0);

        const sphereAxes = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 1),
        ];
        for (const axis of sphereAxes) {
            const up = Math.abs(axis.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
            const p1 = new THREE.Vector3().crossVectors(up, axis).normalize();
            const p2 = new THREE.Vector3().crossVectors(axis, p1).normalize();
            for (let i = 0; i < 48; i++) {
                const ang = (i / 48) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;
                tmpDir.copy(p1).multiplyScalar(Math.cos(ang)).addScaledVector(p2, Math.sin(ang)).normalize();
                const spd = (280 + Math.random() * 220) * size;
                fireSystem.spawn(x, y, z, tmpDir.x * spd, tmpDir.y * spd, tmpDir.z * spd, (1.8 + Math.random() * 1.6) * size, 0.7 + Math.random() * 0.45, 4, gt0, 1.4, 0.95, 0.45, 0);
            }
        }

        for (let i = 0; i < 80; i++) {
            randomSphereDir(tmpDir);
            const sp = (20 + Math.random() * 85) * size;
            const r = Math.random() * modelRadius * 0.6;
            fireSystem.spawn(x + tmpDir.x * r, y + tmpDir.y * r, z + tmpDir.z * r, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (40 + Math.random() * 60) * size, 1.0 + Math.random() * 0.8, 2, gt0, 1.0, 0.5, 0.2, 0);
        }

        for (let i = 0; i < 45; i++) {
            randomSphereDir(tmpDir);
            const r0 = modelRadius * (0.3 + Math.random() * 0.55);
            const sp = (130 + Math.random() * 320) * size;
            const spinBoost = (Math.random() - 0.5) * 8.0;
            fireSystem.spawn(
                x + tmpDir.x * r0,
                y + tmpDir.y * r0,
                z + tmpDir.z * r0,
                tmpDir.x * sp + (Math.random() - 0.5) * 40 * size,
                tmpDir.y * sp + (Math.random() - 0.5) * 40 * size,
                tmpDir.z * sp + (Math.random() - 0.5) * 40 * size,
                (20 + Math.random() * 22) * size,
                2.4 + Math.random() * 0.8,
                9,
                gt0,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                spinBoost,
                Math.random()
            );
        }

        for (let i = 0; i < 180; i++) {
            randomSphereDir(tmpDir);
            const sp = (40 + Math.random() * 180) * size;
            const r = Math.random() * modelRadius * 0.4;
            fireSystem.spawn(x + tmpDir.x * r, y + tmpDir.y * r, z + tmpDir.z * r, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (3 + Math.random() * 4) * size, 0.8 + Math.random() * 0.6, 3, gt0);
        }

        for (let i = 0; i < 400; i++) {
            randomSphereDir(tmpDir);
            const sp = (60 + Math.random() * 420) * size;
            fireSystem.spawn(x, y, z, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (1.1 + Math.random() * 1.0) * size, 0.8 + Math.random() * 0.8, 4, gt0, 1.2, 0.8, 0.35, 0);
        }

        for (let i = 0; i < 250; i++) {
            randomSphereDir(tmpDir);
            const sp = (20 + Math.random() * 180) * size;
            const r = Math.random() * modelRadius * 0.5;
            fireSystem.spawn(x + tmpDir.x * r, y + tmpDir.y * r, z + tmpDir.z * r, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (0.9 + Math.random() * 1.2) * size, 3.0 + Math.random() * 3.0, 10, gt0);
        }

        for (let i = 0; i < 200; i++) {
            randomSphereDir(tmpDir);
            const sp = (4 + Math.random() * 12) * size;
            const r = Math.random() * modelRadius * 0.5;
            smokeSystem.spawn(x + tmpDir.x * r, y + tmpDir.y * r, z + tmpDir.z * r, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, (80 + Math.random() * 100) * size, 2.5 + Math.random() * 1.5, 1, gt0);
        }

        const secondaries = [
            { t: 0.25, offset: 0.4, sizeScale: 0.6, sub: 28 },
            { t: 0.45, offset: 0.5, sizeScale: 0.5, sub: 22 },
            { t: 0.70, type: "shock", sizeScale: 1.3 },
            { t: 1.05, offset: 0.35, sizeScale: 0.4, sub: 18 },
        ];
        let secIdx = 0;
        let disposed = false;
        const effect = {
            update() {
                if (disposed) return;
                const gt = performance.now() / 1000;
                const t = gt - gt0;
                light.intensity = Math.max(0, 18 * (1 - t / 0.7));
                while (secIdx < secondaries.length && secondaries[secIdx].t <= t) {
                    const s = secondaries[secIdx++];
                    if (s.type === "shock") {
                        fireSystem.spawn(x, y, z, 0, 0, 0, 2400 * size * s.sizeScale, 1.5, 6, gt, 0.75, 0.95, 1.2, 0);
                    } else {
                        randomSphereDir(tmpDir);
                        const orr = Math.random() * modelRadius * s.offset;
                        const px = x + tmpDir.x * orr;
                        const py = y + tmpDir.y * orr;
                        const pz = z + tmpDir.z * orr;
                        const ss = s.sizeScale;
                        fireSystem.spawn(px, py, pz, 0, 0, 0, 120 * size * ss, 0.14, 1, gt, 1.6, 1.2, 0.7, 0);
                        fireSystem.spawn(px, py, pz, 0, 0, 0, 180 * size * ss, 0.3, 6, gt, 1.2, 0.7, 0.3, 0);
                        for (let k = 0; k < Math.round(s.sub * 0.4); k++) {
                            randomSphereDir(tmpDir2);
                            const sp = (10 + Math.random() * 30) * size * ss;
                            fireSystem.spawn(px, py, pz, tmpDir2.x * sp, tmpDir2.y * sp, tmpDir2.z * sp, (18 + Math.random() * 20) * size * ss, 0.5 + Math.random() * 0.5, 2, gt, 1.0, 0.5, 0.2, 0);
                        }
                        for (let k = 0; k < s.sub; k++) {
                            randomSphereDir(tmpDir2);
                            const sp = (50 + Math.random() * 180) * size * ss;
                            fireSystem.spawn(px, py, pz, tmpDir2.x * sp, tmpDir2.y * sp, tmpDir2.z * sp, (0.8 + Math.random() * 0.6) * size, 0.6 + Math.random() * 0.5, 4, gt, 1.2, 0.8, 0.35, 0);
                        }
                    }
                }
                if (t >= 6.2) this.dispose();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                if (light.parent) light.parent.remove(light);
                const idx = activeEffects.indexOf(effect);
                if (idx !== -1) activeEffects.splice(idx, 1);
            },
        };
        return addTrackedEffect(activeEffects, effect);
    }

    return {
        spawnModulePop,
        spawnChainReaction,
        spawnCutBlast,
        spawnFinalScatter,
        update() {
            const gt = performance.now() / 1000;
            fireSystem.update(gt);
            smokeSystem.update(gt);
            for (let i = activeEffects.length - 1; i >= 0; i--) {
                activeEffects[i].update();
            }
        },
        dispose() {
            for (let i = activeEffects.length - 1; i >= 0; i--) activeEffects[i].dispose?.();
            fireSystem.dispose();
            smokeSystem.dispose();
        },
    };
}
